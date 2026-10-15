#!/usr/bin/env node

import { readFile, writeFile, mkdir, rm, mkdtemp, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const APP = join(HERE, '..', 'app.js');
const SCANNER = join(ROOT, 'tools', 'scan.js');
const POLYGLOT = join(ROOT, 'samples', 'polyglot');
const POLYGLOT_JSON = join(ROOT, 'samples', 'polyglot.json');
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const DEFAULT_DATASET = '../sample-project/data/test-project.json';

let failures = 0;
let checks = 0;

function annotate(level, message) {
  if (!process.env.GITHUB_ACTIONS) return;
  const text = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::${level}::${text}`);
}

function drain() {
  return Promise.all([process.stdout, process.stderr].map((stream) => new Promise((resolve) => {
    if (stream.writableLength === 0) resolve();
    else stream.write('', resolve);
  })));
}

function ok(name, condition, detail = '') {
  checks++;
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (condition) console.log(`  \x1b[32mPASS\x1b[0m ${line}`);
  else { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${line}`); annotate('error', `FAIL ${line}`); }
}

function note(text) { console.log(`  \x1b[33mNOTE\x1b[0m ${text}`); }

async function loadPureRegion() {
  const source = await readFile(APP, 'utf8');

  /* The four @*:pure markers in app.js are the contract between this harness and the viewer. The
     body of each opens after the marker's own closing comment, so a marker has to stay a comment. */
  const region = (marker) => {
    const startAt = source.indexOf(`/* @${marker}:pure:start`);
    if (startAt < 0) throw new Error(`missing /* @${marker}:pure:start marker in app.js`);
    const bodyStart = source.indexOf('*/', startAt) + 2;
    const end = source.indexOf(`/* @${marker}:pure:end */`);
    if (end < 0) throw new Error(`missing /* @${marker}:pure:end */ marker in app.js`);
    return source.slice(bodyStart, end);
  };
  const model = region('model');

  const graph = region('graph');
  const pure = region('layout');

  const i18n = region('i18n');

  const literal = (name) => {
    const match = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]|\\{[^}]*\\});`).exec(source);
    if (!match) throw new Error(`could not read ${name} from app.js`);
    return match[1];
  };
  const prelude = `
    const LAYOUT = ${literal('LAYOUT')};
    const TITLE_FONTS = ${literal('TITLE_FONTS')};
    const META_FONTS = ${literal('META_FONTS')};
    const textCache = new Map();
    const fontMetrics = new Map();
    ${model}
    ${graph}
    ${i18n}
    ${pure}
    return { LAYOUT, TITLE_FONTS, META_FONTS, I18N, clamp, preparedItems, squarify, boxMetrics, effectiveSize, planText, layoutChildren, stackHeight, countMatches,
      langFromName, langColor, langOf, langLabel, treeFromEntries, isIgnoredPath, toKb, LANG_ORDER, LANG_COLORS, SKIP_DIRS, dominantLang, langTotals, otherBreakdown, formatSize,
      nodeRelPath, nodeAbsPath, normaliseRootPath,
      buildRelations, relationIndex, relationSource, stringLiterals, importSpecifiers, resolveSpecifier, normaliseLiteral, sharedWeight,
      RELATION_MAX_BYTES, UNREADABLE_LANGS, RELATION_FANOUT_RATIO };
  `;
  return new Function(prelude)();
}

function makeFixtures() {
  const deep = (n) => ({ name: 'level' + n, type: n === 12 ? 'file' : 'module', size: 12 - n, ...(n === 12 ? {} : { children: [deep(n + 1)] }) });
  const files = (n, pick) => Array.from({ length: n }, (_, i) => ({ name: `f${String(i + 1).padStart(3, '0')}.js`, type: 'file', size: pick(i), children: [] }));
  const wrap = (children, name = 'fixture') => ({ name, type: 'project', size: 0, children });
  return {
    twoChildren: wrap([{ name: 'huge', type: 'module', size: 100, children: [] }, { name: 'tiny', type: 'module', size: 1, children: [] }]),
    thirtyFiles: wrap(files(30, (i) => (i % 7) + 1)),
    nineModules: wrap(files(9, (i) => 12 - i)),
    deepChain: wrap([deep(1)]),
    hundredTwenty: wrap(files(120, (i) => (i % 7) + 1)),
    oneBigManyTiny: wrap([{ name: 'big', type: 'module', size: 500, children: [] }, ...files(199, () => 1)]),
    equalSizes: wrap(files(30, () => 4)),
    missingSizes: wrap([{ name: 'a', type: 'module', children: [{ name: 'a1', type: 'file', size: 5, children: [] }] }, { name: 'b', type: 'file', size: 0, children: [] }]),
    skewedParent: wrap([{ name: 'p', type: 'module', size: 900, children: [{ name: 'c1', type: 'file', size: 1, children: [] }, { name: 'c2', type: 'file', size: 2, children: [] }] }])
  };
}

function area(rect) { return rect.width * rect.height; }

function intersectArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function layerModel(A) {
  console.log('\n\x1b[1mModel — language tables and folder import (pure)\x1b[0m');

  const expected = [
    ['index.ts', 'TypeScript'], ['main.rs', 'Rust'], ['util.py', 'Python'], ['main.go', 'Go'],
    ['app.rb', 'Ruby'], ['style.css', 'CSS'], ['index.html', 'HTML'], ['config.yaml', 'YAML'],
    ['query.sql', 'SQL'], ['Dockerfile', 'Docker'], ['Makefile', 'Makefile'], ['Cargo.toml', 'Rust'],
    ['README.md', 'Markdown'], ['.gitignore', 'Config'], ['notes.txt', 'Text'],
    ['Component.tsx', 'TypeScript'], ['Main.java', 'Java'], ['lib.cpp', 'C++'], ['run.sh', 'Shell']
  ];
  const wrong = expected.filter(([name, lang]) => A.langFromName(name) !== lang);
  ok('M1 language inference by name and extension', wrong.length === 0,
    wrong.length ? wrong.map(([name, lang]) => `${name} -> ${A.langFromName(name)} (want ${lang})`).join(', ') : `${expected.length} names`);

  ok('M2 unknown extensions fall back to a single bucket', A.langFromName('data.zzz') === '其他' && A.langFromName('noextension') === '其他',
    `data.zzz -> ${A.langFromName('data.zzz')}`);

  const palette = A.LANG_ORDER.map((lang) => A.langColor(lang));
  ok('M3 the ordered palette has no duplicate colours', new Set(palette).size === palette.length,
    `${palette.length} languages, ${new Set(palette).size} distinct colours`);

  ok('M4 a language always maps to the same colour', A.langColor('Rust') === A.langColor('Rust') && A.langColor('Rust') === palette[A.LANG_ORDER.indexOf('Rust')],
    `Rust ${A.langColor('Rust')}`);

  const entries = [
    { path: 'src/index.ts', size: 5120 },
    { path: 'src/deep/nested/util.py', size: 2048 },
    { path: 'node_modules/left-pad/index.js', size: 999999 },
    { path: 'dist/bundle.js', size: 888888 },
    { path: 'README.md', size: 300 },
    { path: '.DS_Store', size: 100 }
  ];
  const tree = A.treeFromEntries(entries, 'my-repo');

  const names = [];
  const collect = (node, prefix) => { names.push(prefix + node.name); node.children.forEach((child) => collect(child, `${prefix}${node.name}/`)); };
  collect(tree, '');

  ok('M5 folder import builds the tree from relative paths',
    names.includes('my-repo/src/index.ts') && names.includes('my-repo/src/deep/nested/util.py'),
    names.join(' '));
  ok('M6 dependencies and build output are excluded',
    !names.some((name) => name.includes('node_modules') || name.includes('dist/')),
    names.filter((name) => name.includes('node_modules') || name.includes('dist/')).join(' ') || 'none present');

  const allNames = [];
  const collectAll = (node, prefix) => { allNames.push(prefix + node.name); node.children.forEach((child) => collectAll(child, `${prefix}${node.name}/`)); };
  collectAll(A.treeFromEntries(entries, 'my-repo', { all: true }), '');
  ok('M7 `all` includes what the default skips', allNames.some((name) => name.includes('node_modules')) && allNames.some((name) => name.includes('dist/')),
    `${allNames.length} nodes vs ${names.length} by default`);

  const leafSizes = [];
  const leaves = (node) => { if (!node.children.length) { leafSizes.push(node.size); return; } node.children.forEach(leaves); };
  leaves(tree);

  ok('M8 sub-KB files keep a non-zero proportional size',
    leafSizes.every((size) => size > 0) && new Set(leafSizes).size === leafSizes.length,
    `${leafSizes.length} leaves: ${leafSizes.join(', ')} KB`);

  const modules = [];
  const walkModules = (node) => { if (node.type === 'module') modules.push(node); node.children.forEach(walkModules); };
  walkModules(tree);

  ok('M9 directories become modules, files stay files',
    modules.length === 3 && tree.type === 'project' && tree.children.filter((child) => child.type === 'file').length === 1,
    `${modules.length} modules, ${tree.children.filter((child) => child.type === 'file').length} root file`);

  const pruned = A.treeFromEntries([{ path: 'src/a.ts', size: 100 }, { path: 'empty-dir/.DS_Store', size: 10 }], 'p');
  ok('M10 directories emptied by the ignore list are pruned',
    !JSON.stringify(pruned).includes('empty-dir'), JSON.stringify(pruned.children.map((child) => child.name)));

  ok('M11 size formatting floors fractions instead of showing 0 KB',
    A.formatSize(0.1) === '0.1 KB' && A.formatSize(18) === '18 KB' && A.formatSize(2048) === '2.0 MB',
    `${A.formatSize(0.1)} / ${A.formatSize(18)} / ${A.formatSize(2048)}`);

  const classified = {
    'index.wxss': 'WXSS', 'index.wxml': 'WXML', 'app.wxs': 'WXS',
    'sketch.ino': 'Arduino', 'nginx.conf': 'Config', 'gradle.properties': 'Config',
    'notes.rst': 'RST', 'paper.tex': 'TeX', 'page.ejs': 'Template', 'card.hbs': 'Template',
    'view.cshtml': 'Razor', 'Program.vb': 'Visual Basic', 'Types.fs': 'F#',
    'rules.mk': 'Makefile', 'bundle.zip': 'Binary', 'lib.so': 'Binary',
    'cert.pem': 'Certificate', 'cache.sqlite': 'Database', 'run.log': 'Log',
    'fix.patch': 'Diff', 'app.js.map': 'Source Map'
  };
  const misclassified = Object.entries(classified).filter(([name, want]) => A.langFromName(name) !== want)
    .map(([name, want]) => `${name} -> ${A.langFromName(name)} (want ${want})`);
  ok('M12 the extensions real projects kept losing are classified', misclassified.length === 0,
    `${Object.keys(classified).length - misclassified.length}/${Object.keys(classified).length} recognised${misclassified.length ? ` — ${misclassified.join('; ')}` : ''}`);

  const envCase = { '.env': 'Config', '.env.example': 'Config', '.env.local': 'Config', '.env.production': 'Config', 'env.js': 'JavaScript', '.envrc': 'Shell', '.environment.ts': 'TypeScript' };
  const envWrong = Object.entries(envCase).filter(([name, want]) => A.langFromName(name) !== want)
    .map(([name, want]) => `${name} -> ${A.langFromName(name)} (want ${want})`);
  ok('M13 the .env family is Config without swallowing env.js', envWrong.length === 0,
    envWrong.length ? envWrong.join('; ') : `${Object.keys(envCase).length} names, including the env.js guard`);

  const polyglot = A.treeFromEntries([
    { path: 'src/app.py', size: 100 }, { path: 'ui/index.wxml', size: 40 },
    { path: 'ui/index.wxss', size: 30 }, { path: 'hw/sketch.ino', size: 20 },
    { path: 'src/notes.qqq', size: 10240 }
  ], 'p');
  const breakdown = [...A.otherBreakdown(polyglot)].sort((a, b) => b[1] - a[1]);
  const wantBreakdown = [['.qqq', 10]];
  ok('M14 其他 breaks down by extension instead of staying opaque',
    JSON.stringify(breakdown) === JSON.stringify(wantBreakdown),
    breakdown.length ? breakdown.map(([ext, kb]) => `${ext} ${kb}KB`).join(', ') : '(empty)');

  const unknownLeaf = polyglot.children.find((c) => c.name === 'src').children.find((c) => c.name === 'notes.qqq');
  ok('M15 an unclassified file names its own extension when labelled',
    A.langLabel(unknownLeaf) === '其他 (.qqq)',
    `${unknownLeaf.name} -> ${A.langLabel(unknownLeaf)}`);

  const linked = (node, parent = null) => { node.parent = parent; node.children.forEach((child) => linked(child, node)); return node; };
  const jumpTree = linked(A.treeFromEntries([
    { path: 'src/app.ts', size: 10 }, { path: 'src/util/helpers.ts', size: 5 }, { path: 'README.md', size: 1 }
  ], 'demo', { rootPath: 'F:\\work\\demo\\' }));
  const find = (name) => { let found = null; const walk = (node) => { if (node.name === name) found = node; node.children.forEach(walk); }; walk(jumpTree); return found; };

  ok('M16 the scanner\'s root path survives into the tree, in one spelling',
    jumpTree.rootPath === 'F:/work/demo', `${JSON.stringify(jumpTree.rootPath)} from a backslash path with a trailing separator`);
  ok('M17 the root node contributes nothing to a path',
    A.nodeRelPath(find('app.ts')) === 'src/app.ts',
    `root name "${jumpTree.name}" must not appear: ${A.nodeRelPath(find('app.ts'))}`);
  ok('M18 an absolute path is the root path plus the relative one',
    A.nodeAbsPath(find('helpers.ts'), jumpTree.rootPath) === 'F:/work/demo/src/util/helpers.ts',
    A.nodeAbsPath(find('helpers.ts'), jumpTree.rootPath));

  ok('M19 a filesystem root is not normalised away',
    A.normaliseRootPath('/') === '/' && A.normaliseRootPath('F:/') === 'F:' && A.normaliseRootPath('  ') === '',
    `"/" -> ${JSON.stringify(A.normaliseRootPath('/'))}, "F:/" -> ${JSON.stringify(A.normaliseRootPath('F:/'))}`);
  ok('M20 joining onto a bare "/" does not double the separator',
    A.nodeAbsPath(find('app.ts'), '/') === '/src/app.ts', A.nodeAbsPath(find('app.ts'), '/'));

  ok('M21 an absent root path yields the relative path, not a fake absolute one',
    A.treeFromEntries([{ path: 'src/app.ts', size: 10 }], 'demo').rootPath === undefined &&
    A.nodeAbsPath(find('app.ts'), undefined) === 'src/app.ts',
    A.nodeAbsPath(find('app.ts'), undefined));

  const pasted = {
    'F:\\work\\api': 'F:/work/api', '  F:/work/api/  ': 'F:/work/api',
    '"F:\\work\\api"': 'F:/work/api', "'F:/work/api'": 'F:/work/api',
    'file:///F:/work/api': 'F:/work/api', 'file://F:/work/api': 'F:/work/api',

    '\\\\server\\share\\proj': '//server/share/proj', '//server/share/proj': '//server/share/proj'
  };
  const wrongPaste = Object.entries(pasted).filter(([input, want]) => A.normaliseRootPath(input) !== want)
    .map(([input, want]) => `${JSON.stringify(input)} -> ${JSON.stringify(A.normaliseRootPath(input))} (want ${want})`);
  ok('M22 a pasted path from Explorer or an address bar is accepted', wrongPaste.length === 0,
    wrongPaste.length ? wrongPaste.join('; ') : `${Object.keys(pasted).length} spellings of the same directory`);
}

async function layerScan() {
  console.log('\n\x1b[1mScanner — tools/scan.js as a real process\x1b[0m');

  const { stdout, stderr } = await exec(process.execPath, [SCANNER, POLYGLOT, '--no-root-path'], { maxBuffer: 64 * 1024 * 1024 });
  let tree = null;
  try { tree = JSON.parse(stdout); } catch (error) {  }
  ok('S1 stdout is valid JSON even with the report enabled', !!tree,
    tree ? `parsed ${stdout.length}B, report went to stderr (${stderr.split('\n').filter(Boolean).length} lines)` : `stdout did not parse: ${stdout.slice(0, 80)}`);

  if (tree) {

    await mkdir(dirname(POLYGLOT_JSON), { recursive: true });
    await writeFile(POLYGLOT_JSON, stdout, 'utf8');

    const leaves = [];
    const walk = (node) => { if (!node.children.length) { leaves.push(node); return; } node.children.forEach(walk); };
    walk(tree);

    const countFiles = async (dir) => {
      let total = 0;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) total += await countFiles(join(dir, entry.name));
        else if (entry.isFile()) total++;
      }
      return total;
    };
    const onDisk = await countFiles(POLYGLOT);
    ok('S2 every file in the folder reaches the tree', leaves.length === onDisk, `${leaves.length} leaves vs ${onDisk} files on disk`);
    ok('S3 root is named after the folder and typed as a project', tree.name === 'polyglot' && tree.type === 'project', `${tree.name} / ${tree.type}`);

    const langs = new Set(leaves.map((leaf) => leaf.lang));
    const wanted = ['TypeScript', 'Python', 'Rust', 'Go', 'Ruby', 'Markdown', 'CSS', 'HTML', 'YAML', 'SQL', 'Shell'];
    const missing = wanted.filter((lang) => !langs.has(lang));
    ok('S4 the scan is genuinely multi-language', missing.length === 0, `${langs.size} languages: ${[...langs].sort().join(', ')}${missing.length ? ` — missing ${missing.join(', ')}` : ''}`);
    ok('S5 every leaf carries a positive size and a language', leaves.every((leaf) => leaf.size > 0 && !!leaf.lang),
      `${leaves.filter((leaf) => !(leaf.size > 0 && leaf.lang)).length} bad leaves`);
  }

  const scratch = await mkdtemp(join(tmpdir(), 'atlas-scan-'));
  try {
    for (const [path, body] of [['src/a.ts', 'const a = 1;'], ['src/b.ts', 'const b = 2;'], ['keep.css', 'body{}'], ['node_modules/dep/index.js', 'module.exports = 1;'], ['dist/bundle.js', 'x'], ['.git/HEAD', 'ref: refs/heads/main']]) {
      await mkdir(join(scratch, dirname(path)), { recursive: true });
      await writeFile(join(scratch, path), body, 'utf8');
    }
    const read = async (args) => JSON.parse((await exec(process.execPath, [SCANNER, scratch, '--quiet', ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout);
    const names = (node, prefix = '') => [prefix + node.name, ...node.children.flatMap((child) => names(child, `${prefix}${node.name}/`))];

    const ignored = names(await read([]));
    ok('S6 node_modules, dist and .git are skipped on a real directory',
      ignored.some((name) => name.endsWith('src/a.ts')) && !ignored.some((name) => /node_modules|dist|\.git/.test(name)),
      ignored.join(' '));

    const everything = names(await read(['--all']));
    ok('S7 --all reaches what the default skips', everything.some((name) => name.includes('node_modules')) && everything.some((name) => name.includes('dist')),
      `${everything.length} nodes vs ${ignored.length} by default`);

    const recorded = await read([]);
    const withoutRoot = await read(['--no-root-path']);
    ok('S8 the scan records the absolute path of the folder it scanned',
      recorded.rootPath === scratch.split('\\').join('/'),
      `${JSON.stringify(recorded.rootPath)} vs ${scratch.split('\\').join('/')}`);
    ok('S9 --no-root-path leaves it out', !('rootPath' in withoutRoot), JSON.stringify(withoutRoot.rootPath));

    const dropped = names(await read(['--ignore', 'src']));
    ok('S10 --ignore drops the directory it names, and only that',
      !dropped.some((name) => name.includes('/src/')) && dropped.some((name) => name.endsWith('keep.css')),
      dropped.join(' '));

    const override = names(await read(['--all', '--ignore', 'node_modules', '--ignore', 'keep.css']));
    ok('S11 --ignore outranks --all, and names files as well as directories',
      !override.some((name) => name.includes('node_modules')) && !override.some((name) => name.endsWith('keep.css'))
        && override.some((name) => name.endsWith('dist/bundle.js')),
      override.join(' '));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const CJK = /[⺀-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/;

/* Ranges, not one range: 、 and 「」 sit outside U+4E00–U+9FFF, and a scan that only looked at
   ideographs would walk straight past a Chinese list separator. */
/* The attribute-to-property map applyStaticText() walks. Duplicated here on purpose: a list that
   lived only in the code under test would quietly shrink with it. */
const I18N_SLOTS_SOURCE = [['data-i18n', 'textContent'], ['data-i18n-html', 'innerHTML'], ['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-label', 'aria-label'], ['data-i18n-content', 'content']];

/* A key present in one language and missing from the other does not look like a bug on screen — it
   renders as the other language, mid-sentence, and reads as a translator who stopped halfway. */
async function layerWords(A) {
  console.log('\n\x1b[1mWords — the two language tables (pure)\x1b[0m');
  const source = await readFile(APP, 'utf8');
  const body = (marker) => {
    const startAt = source.indexOf(`/* @${marker}:pure:start`);
    const bodyStart = source.indexOf('*/', startAt) + 2;
    const end = source.indexOf(`/* @${marker}:pure:end */`);
    return source.slice(bodyStart, end);
  };

  const code = body('layout').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const leaked = code.match(new RegExp(CJK.source, 'g')) || [];
  ok('U1 the layout region holds no interface text, so no language can reach the layout maths',
    leaked.length === 0,
    leaked.length
      ? `found ${[...new Set(leaked)].join('')} in @layout:pure — a string here also lands in tools/scan.js output`
      : 'no CJK outside comments in @layout:pure');

  const zh = Object.keys(A.I18N.zh);
  const en = Object.keys(A.I18N.en);
  const missing = [...zh.filter((key) => !(key in A.I18N.en)), ...en.filter((key) => !(key in A.I18N.zh))];
  ok('U2 the two tables carry the same keys', missing.length === 0,
    missing.length ? `${missing.length} key${missing.length === 1 ? '' : 's'} on one side only: ${missing.join(', ')}` : `${zh.length} keys in both`);

  const braces = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
  const crooked = zh.filter((key) => braces(A.I18N.zh[key]) !== braces(A.I18N.en[key]))
    .map((key) => `${key}: {${braces(A.I18N.zh[key])}} vs {${braces(A.I18N.en[key])}}`);
  ok('U3 the two languages fill the same placeholders', crooked.length === 0,
    crooked.length ? crooked.join(' · ') : `${zh.filter((key) => braces(A.I18N.zh[key])).length} entries carry a value`);

  const blank = [], echoed = [];
  for (const lang of ['zh', 'en']) for (const [key, value] of Object.entries(A.I18N[lang])) {
    if (!String(value).trim()) blank.push(`${lang}.${key}`);

    if (value === key) echoed.push(`${lang}.${key}`);
  }
  ok('U4 no entry is blank, and none is spelled the same as its own key',
    blank.length === 0 && echoed.length === 0,
    blank.length || echoed.length ? [...blank, ...echoed].join(', ') : `${Object.keys(A.I18N.zh).length * 2} values`);
}

async function layerDocs() {
  console.log('\n\x1b[1mDocs — what the README and CI tell people to run, and where they send them\x1b[0m');
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const scripts = new Set(Object.keys(pkg.scripts || {}));

  const ALIASES = new Set(['start', 'test', 'stop', 'restart']);
  const sources = ['README.md', '.github/workflows/check.yml'];
  const bare = [];
  const wrong = [];
  for (const name of sources) {
    const text = await readFile(join(ROOT, name), 'utf8');
    for (const [, ran, word] of text.matchAll(/\bnpm\s+(run\s+)?([A-Za-z][\w:-]*)/g)) {
      if (ran) { if (!scripts.has(word)) wrong.push(`${name}: npm run ${word}`); }
      else if (scripts.has(word) && !ALIASES.has(word)) bare.push(`${name}: npm ${word}`);
    }
  }
  ok('D1 a package script is never invoked as `npm <name>`, which npm rejects outright', bare.length === 0,
    bare.length ? `use \`npm run\`: ${bare.join(', ')}` : `${sources.length} files, ${scripts.size} scripts`);
  ok('D2 every `npm run <name>` in the docs names a script that exists', wrong.length === 0,
    wrong.length ? wrong.join(', ') : `${[...scripts].join(', ')}`);

  const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
  const outward = [...new Set([...readme.matchAll(/https?:\/\/[^\s)>"`]+/g)].map((match) => match[0]))]
    .filter((link) => /viewer\/index\.html/.test(link) && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(link));
  const prefilled = outward.filter((link) => link.includes('?'));
  ok('D3 every link to the published viewer opens empty, the way the README says it does', prefilled.length === 0,
    prefilled.length
      ? `${prefilled.join(', ')} — drop the query string, or the demo arrives with someone else's project already open`
      : `${outward.length} outward viewer link${outward.length === 1 ? '' : 's'}, all bare`);

  const claimed = [
    { name: 'README.md', pattern: /(\d+)\s*项，不需要浏览器/g, text: readme },
    { name: '.github/workflows/check.yml', pattern: /纯层\s*(\d+)\s*项检查/g, text: await readFile(join(ROOT, '.github/workflows/check.yml'), 'utf8') }
  ].map(({ name, pattern, text }) => {
    const hits = [...text.matchAll(pattern)];
    return { name, found: hits.length, n: hits.length === 1 ? Number(hits[0][1]) : null };
  });

  const expected = checks + 1;
  const off = claimed.filter((item) => item.n !== expected);
  ok('D4 the check count in the docs is the count this run performed', off.length === 0,
    off.length
      ? off.map((item) => `${item.name} says ${item.n === null ? `${item.found} matches, wanted 1` : item.n}, this run says ${expected}`).join(' · ')
      : `${claimed.map((item) => item.name).join(' and ')} both say ${expected}`);
}

function layer1(A) {
  const W = 976, H = 595;
  const fixtures = makeFixtures();

  console.log('\n\x1b[1mLayer 1 — squarify invariants (pure, no browser)\x1b[0m');

  for (const [name, tree] of Object.entries(fixtures)) {

    const normalise = (node, parent = null, depth = 0) => {
      node.parent = parent; node.depth = depth;
      node.children = Array.isArray(node.children) ? node.children.map((c) => normalise(c, node, depth + 1)) : [];
      A.effectiveSize(node);
      return node;
    };
    normalise(tree);

    const rect = { x: 0, y: 0, width: W, height: H };
    const boxes = A.squarify(A.preparedItems(tree.children, area(rect)), 0, 0, W, H, []);

    const covered = boxes.reduce((sum, box) => sum + area(box), 0);
    const partitionError = Math.abs(covered / area(rect) - 1);
    ok(`${name}: I1 exact partition`, partitionError < 1e-9, `error ${partitionError.toExponential(2)}`);

    let worstOverlap = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) worstOverlap = Math.max(worstOverlap, intersectArea(boxes[i], boxes[j]));
    ok(`${name}: I2 non-overlap`, worstOverlap === 0, `max overlap ${worstOverlap}`);

    const outside = boxes.filter((b) => b.x < -1e-6 || b.y < -1e-6 || b.x + b.width > W + 1e-6 || b.y + b.height > H + 1e-6).length;
    ok(`${name}: I3 containment`, outside === 0, `${outside} boxes outside`);

    let worstRatio = 0;
    const unfloored = boxes.filter((b) => !b.floored && b.raw > 0);
    for (let i = 0; i < unfloored.length; i++) for (let j = i + 1; j < unfloored.length; j++) {
      const want = unfloored[i].raw / unfloored[j].raw;
      const got = area(unfloored[i]) / area(unfloored[j]);
      worstRatio = Math.max(worstRatio, Math.abs(got / want - 1));
    }
    ok(`${name}: I4a cell area ∝ weight`, worstRatio < 1e-9, `max drift ${(worstRatio * 100).toFixed(4)}%`);

    const aboveFloor = boxes.filter((b) => !b.floored);

    const raws0 = tree.children.map((child) => A.effectiveSize(child));
    const total0 = raws0.reduce((sum, value) => sum + value, 0);
    const floorW = total0 * Math.min(A.LAYOUT.minCell / area(rect), 1 / (raws0.length + 1));
    const weightSum = raws0.reduce((sum, value) => sum + Math.max(value, floorW), 0);
    const floorArea = floorW / weightSum * area(rect);
    const skimpiest = aboveFloor.reduce((min, b) => Math.min(min, area(b)), Infinity);
    ok(`${name}: I5a unfloored cell area >= floor`, !Number.isFinite(skimpiest) || skimpiest >= floorArea * (1 - 1e-9),
      `smallest ${Number.isFinite(skimpiest) ? skimpiest.toFixed(0) + 'px²' : 'n/a'} vs floor ${floorArea.toFixed(0)}px²`);

    const raws = boxes.map((b) => b.raw).filter((value) => value > 0);
    const ratio = raws.length ? Math.max(...raws) / Math.min(...raws) : 1;

    const tightest = aboveFloor.reduce((min, b) => Math.min(min, Math.min(b.width, b.height)), Infinity);
    const flooredCount = boxes.length - aboveFloor.length;
    if (ratio <= 20) ok(`${name}: I5b readable shape (ratio ${ratio.toFixed(0)}:1)`, tightest >= 20,
      `tightest min(w,h) ${tightest.toFixed(1)}px, floored ${flooredCount}/${boxes.length}`);
    else console.log(`  \x1b[33mNOTE\x1b[0m ${name}: I5b sibling ratio ${ratio.toFixed(0)}:1 exceeds the 20:1 shape bound — tightest min(w,h) ${tightest.toFixed(1)}px, area still exact`);
  }
}

let connection = null;

async function cdp(url) {
  if (connection) return connection;

  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  } catch (cause) {
    throw new Error(`nothing listening on port ${CDP_PORT}, so the browser checks cannot run.\n` +
      `Start headless Chrome first:\n\n` +
      `  chrome --headless=new --remote-debugging-port=${CDP_PORT} --user-data-dir=%TEMP%\\atlas-cdp about:blank\n\n` +
      `Then re-run with --url. The pure-layer checks (no --url) need no browser.`, { cause });
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`Chrome is on port ${CDP_PORT} but has no page target — open a tab, or start it without --headless`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); socket.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
    return result.result?.result?.value;
  };

  /* Every navigation names the language it means. The viewer falls back to navigator.language, and
     what a build machine's browser reports is not something this file controls — without the pin, a
     browser that says `en` runs every Chinese-text assertion below against an English page, and the
     failure reads as a broken viewer rather than as a harness that forgot to say what it wanted. */
  const navigate = async (target, lang = 'zh') => {
    const pinned = lang ? `${target}${target.includes('?') ? '&' : '?'}lang=${lang}` : target;
    await send('Page.navigate', { url: pinned });
    for (let attempt = 0; attempt < 200; attempt++) {
      const ready = await evaluate('!!(window.__codeAtlas && document.readyState === "complete")').catch(() => false);
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`the viewer never finished loading ${target}`);
  };
  await navigate(url);
  connection = { evaluate, send, navigate };
  return connection;
}

function hash32(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}

async function layerShell(url) {
  console.log('\n\x1b[1mLayer 3a — the sidebar with and without a project (CDP)\x1b[0m');
  const bare = url.split('?')[0];
  const { evaluate, navigate } = await cdp(bare);

  const probe = () => evaluate(`(() => {
    const visible = (el) => el.offsetParent !== null;
    const named = (el) => (el.className || '') + ':' + el.textContent.trim().slice(0, 10);

    const col = (sel) => {
      const card = document.querySelector(sel);
      const strong = document.querySelector(sel + ' strong');
      const glyph = document.querySelector(sel + ' .col-empty-glyph');
      if (!card || !strong || !glyph || card.offsetParent === null) return null;
      const g = glyph.getBoundingClientRect();
      const host = card.closest('.sidebar, .inspector').getBoundingClientRect();
      return {
        y: Math.round(g.y),
        size: Math.round(g.width),
        off: Math.round(g.x + g.width / 2 - (host.x + host.width / 2)),
        font: getComputedStyle(strong).fontSize,
        shares: card.classList.contains('col-empty')
      };
    };
    return {
      marked: document.getElementById('sidebar').classList.contains('is-empty'),
      blocks: [...document.querySelectorAll('.side-section, .side-tip')].filter(visible).map(named),
      counters: document.getElementById('stats').children.length,
      says: document.querySelector('.side-empty').textContent.trim(),
      welcome: !document.getElementById('welcome').hidden,
      cols: [col('.side-empty'), col('.inspector .col-empty')]
    };
  })()`);

  await navigate(bare);
  const none = await probe();
  ok('E1 with nothing imported the sidebar shows no section headings',
    none.marked === true && none.blocks.length === 0 && none.counters === 0 && none.welcome === true,
    none.blocks.length ? `still showing ${none.blocks.join(', ')}` : `${none.says.replace(/\s+/g, ' ')} · ${none.counters} counters`);

  const [left, right] = none.cols;
  const describe = (col) => col ? `${col.size}px at y${col.y} (${col.off}px off centre, title ${col.font})` : 'none';

  const forked = [left, right].filter((col) => col && !col.shares).length;
  ok('E3 the two empty columns are one block seen twice, not two that happen to resemble each other',
    !!left && !!right && left.shares && right.shares && left.y === right.y
      && left.size === right.size && left.font === right.font
      && Math.abs(left.off) <= 1 && Math.abs(right.off) <= 1,
    `left ${describe(left)} · right ${describe(right)}`
      + (forked ? ` · ${forked} of them carry a copied rule set instead of the shared class` : ''));

  await navigate(`${bare}?data=${DEFAULT_DATASET}`);
  const some = await probe();
  ok('E2 the same sidebar returns once a project is open',
    some.marked === false && some.blocks.length === 3 && some.counters === 4 && some.welcome === false,
    `is-empty ${some.marked}, visible blocks ${some.blocks.length}, counters ${some.counters}`);
}

async function layer3(url) {
  console.log('\n\x1b[1mLayer 3 — real rendered output over CDP\x1b[0m');

  const requested = new URL(url).searchParams.get('data') || DEFAULT_DATASET;
  const target = new URL(url).searchParams.has('data') ? url
    : `${url}${url.includes('?') ? '&' : '?'}data=${DEFAULT_DATASET}`;
  const { evaluate, navigate } = await cdp(target);

  await navigate(target);

  const expected = await readFile(APP, 'utf8');
  const served = await evaluate(`fetch('../viewer/app.js').then((r) => r.text()).then((t) => ({ len: t.length, hash: (() => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); })() })).catch((e) => ({ error: String(e) }))`);
  ok('preflight: served app.js is this checkout', served && served.hash === hash32(expected),
    served?.error ? served.error : `served ${served?.len}B/${served?.hash} vs source ${expected.length}B/${hash32(expected)}`);

  const dataset = await evaluate(`(() => { const A = window.__codeAtlas; const n = document.getElementById('notice'); return { root: A.state.root.name, tiles: A.state.nodes.length, notice: n.hidden ? '' : n.textContent }; })()`);
  console.log(`  \x1b[36mDATA\x1b[0m root "${dataset.root}" · ${dataset.tiles} tiles drawn`);

  const wanted = await (await fetch(new URL(requested, target).href)).json().catch((error) => ({ __error: String(error) }));
  ok('preflight: the page loaded the dataset it was asked for', !wanted.__error && dataset.root === wanted.name,
    wanted.__error ? `${new URL(requested, target).href} — ${wanted.__error}`
      : `asked for "${wanted.name}", page shows "${dataset.root}"${dataset.notice ? ` · notice: ${dataset.notice}` : ''}`);

  const fontReady = await evaluate('document.fonts.ready.then(() => document.fonts.check("700 13px Manrope"))');
  ok('D font readiness', fontReady === true, 'Manrope loaded before measuring');

  const inference = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const tree = A.normalize({ name: 'root', children: [
      { name: 'dir', children: [{ name: 'a.py', type: 'file', size: 1 }] },
      { name: 'declared', type: 'module', children: [] },
      { name: 'odd', type: 'directory', children: [{ name: 'b.py', size: 2 }] },
      { name: 'leaf.js', size: 3 }
    ] });
    const types = {}; tree.children.forEach((c) => { types[c.name] = c.type; });
    return { root: tree.type, types, kinds: tree.children.map((c) => String(A.nodeKind(c))) };
  })()`);

  const wantTypes = { dir: 'module', declared: 'module', odd: 'module', 'leaf.js': 'file' };
  const badTypes = Object.entries(wantTypes).filter(([name, want]) => inference.types[name] !== want)
    .map(([name, want]) => `${name} -> ${inference.types[name]} (want ${want})`);
  ok('N1 a missing or unknown `type` is inferred from structure', inference.root === 'project' && badTypes.length === 0,
    `root: ${inference.root}, ${Object.entries(inference.types).map(([k, v]) => `${k}=${v}`).join(' ')}${badTypes.length ? ` — wrong: ${badTypes.join('; ')}` : ''}`);

  ok('N2 no container is labelled with the string "undefined"',
    inference.kinds.every((kind) => kind !== 'undefined' && kind.length > 0),
    `kinds: ${inference.kinds.join(', ')}`);

  const geometry = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const measure = A.measureTextWidth;
    let textViolations = [], lines = 0, badRects = 0;
    const groups = new Map();
    for (const box of A.state.nodes) {
      const node = box.node;
      if (box.width < 1 || box.height < 1) badRects++;
      const isLeaf = node.children.length === 0;
      // box.lines is what the renderer actually painted, captured at draw time. Recomputing here
      // would verify the harness's idea of the layout rather than the layout that reached pixels.
      // Line offsets are planned against the tile's ON-SCREEN size while box.{x,y,width,height} are
      // layout units, so the comparison runs in layout units: divide the line geometry by the zoom
      // the box was drawn at. At zoom 1 this is the identity, which is the case every other check
      // runs in.
      const z = A.state.zoom || 1;
      for (const line of (box.lines || [])) {
        lines++;
        const w = measure(line.text, line.font) / z;
        const right = box.x + line.x / z + w, left = box.x + line.x / z;
        const baseline = box.y + line.baseline / z;
        const glyphTop = baseline - (line.bottom - line.baseline) / z;
        if (right > box.x + box.width - 1 || left < box.x + 1 || glyphTop < box.y + 1 || baseline > box.y + box.height - 1)
          textViolations.push({ node: node.name, text: line.text, overflowRight: +(right - (box.x + box.width)).toFixed(2) });
      }
      if (isLeaf) {
        const key = node.parent ? node.parent.name : 'root';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ name: node.name, area: box.width * box.height, raw: A.effectiveSize(node) });
      }
    }
    return { tiles: A.state.nodes.length, lines, textViolations: textViolations.slice(0, 8), textViolationCount: textViolations.length, badRects, groups: [...groups].map(([parent, kids]) => ({ parent, kids })) };
  })()`);

  ok('I6 no text drawn outside its tile', geometry.textViolationCount === 0, `${geometry.lines} lines over ${geometry.tiles} tiles${geometry.textViolationCount ? ' — ' + JSON.stringify(geometry.textViolations) : ''}`);
  ok('I8 every tile has a positive size', geometry.badRects === 0, `${geometry.badRects} degenerate rects`);

  let worstDrift = 0, sample = '';
  for (const group of geometry.groups) {
    const kids = group.kids.filter((k) => k.raw > 0);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const want = kids[i].raw / kids[j].raw, got = kids[i].area / kids[j].area;
      const drift = Math.abs(got / want - 1);
      if (drift > worstDrift) { worstDrift = drift; sample = `${group.parent}: ${kids[i].name}/${kids[j].name}`; }
    }
  }
  ok('I4b painted area ∝ size (siblings)', worstDrift < 0.15, `max drift ${(worstDrift * 100).toFixed(1)}%${sample ? ` (${sample})` : ''}`);

  const pixels = await evaluate(`(async () => {
    const A = window.__codeAtlas;
    A.setDebugColors(true);
    const canvas = document.getElementById('map');
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = [];
    for (const box of A.state.nodes) {
      if (box.node.children.length) continue;
      const rgb = box.debugColor ? box.debugColor.replace(/^rgba?\\(|\\)$/g, '') : null;
      const x0 = Math.floor(box.x * ratio) + 2, x1 = Math.ceil((box.x + box.width) * ratio) - 2;
      const y0 = Math.floor(box.y * ratio) + 2, y1 = Math.ceil((box.y + box.height) * ratio) - 2;
      let painted = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] + ',' + data[i + 1] + ',' + data[i + 2] === rgb) painted++;
      }
      out.push({ name: box.node.name, parent: box.node.parent ? box.node.parent.name : null,
        raw: A.effectiveSize(box.node), w: box.width, h: box.height,
        painted, window: Math.max(0, x1 - x0) * Math.max(0, y1 - y0) });
    }
    A.setDebugColors(false);
    return out;
  })()`);

  const leaves = pixels.filter((p) => p.window > 0);

  let worstA1 = 0, a1Tile = '';
  for (const p of leaves) {
    const off = Math.abs(p.painted - p.window);
    if (off > worstA1) { worstA1 = off; a1Tile = `${p.name} ${p.w.toFixed(1)}x${p.h.toFixed(1)}: painted ${p.painted}, window ${p.window}`; }
  }
  ok('A1 painted pixels exactly fill the tile the layout produced', worstA1 <= 2, `worst off by ${worstA1}px — ${a1Tile}`);

  let worstA2 = 0, a2Sample = '';
  const byParent = new Map();
  for (const p of leaves) { const key = p.parent ?? '·root'; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(p); }
  for (const [parent, kids] of byParent) {
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const want = kids[i].window / kids[j].window, got = kids[i].painted / kids[j].painted;
      const drift = Math.abs(got / want - 1);
      if (drift > worstA2) { worstA2 = drift; a2Sample = `${parent}: ${kids[i].name} vs ${kids[j].name} (window ${want.toFixed(3)}x, painted ${got.toFixed(3)}x)`; }
    }
  }
  ok('A2 every tile fills its window uniformly', worstA2 < 0.01, `max drift ${(worstA2 * 100).toFixed(2)}% — ${a2Sample}`);

  const HOLESLOP = 6;
  const blank = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const canvas = document.getElementById('map');
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const root = A.state.nodes[0];
    const x0 = Math.ceil(root.x * ratio), y0 = Math.ceil(root.y * ratio);
    const x1 = Math.floor((root.x + root.width) * ratio), y1 = Math.floor((root.y + root.height) * ratio);
    const data = ctx.getImageData(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)).data;
    const bg = getComputedStyle(document.querySelector('.stage')).backgroundColor.match(/\\d+/g).map(Number);
    const histogram = new Map();
    let holes = 0, pale = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total++;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = r + ',' + g + ',' + b;
      histogram.set(key, (histogram.get(key) || 0) + 1);
      if (Math.abs(r - bg[0]) <= ${HOLESLOP} && Math.abs(g - bg[1]) <= ${HOLESLOP} && Math.abs(b - bg[2]) <= ${HOLESLOP}) holes++;
      if (Math.min(r, g, b) >= 235) pale++;
    }
    const top = [...histogram].sort((a, b) => b[1] - a[1]).slice(0, 4);
    return { total, holes, pale, bg, share: total ? holes / total : 0, dominant: top[0], palette: top };
  })()`);
  ok('E no blank space inside the project rectangle', blank.share < 0.001,
    `${(blank.share * 100).toFixed(3)}% of ${blank.total}px within ${HOLESLOP} of the ${blank.bg.join(',')} stage background`);
  note(`E paleness (reported, not asserted) — ${(blank.pale / blank.total * 100).toFixed(1)}% of the map is at min-channel >= 235 · dominant fill rgb(${blank.dominant?.[0]}) at ${(blank.dominant?.[1] / blank.total * 100).toFixed(1)}%`);

  const search = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const drawn = new Set(A.state.nodes.map((b) => b.node));
    let drawnLeaf = null, hiddenLeaf = null;
    const walk = (n) => {
      if (!n.children.length) { if (!drawnLeaf) drawnLeaf = n; if (!drawn.has(n) && !hiddenLeaf) hiddenLeaf = n; }
      n.children.forEach(walk);
    };
    walk(A.state.root);
    const set = (q) => { A.state.query = q; A.draw(); return document.getElementById('empty-state').hidden; };
    const out = { totalNodes: A.countMatches(A.state.root, () => true), drawnTiles: A.state.nodes.length, belowCutoff: [] };
    // Use the full name, not a prefix: a prefix like "leve" matches every drawn levelN and the
    // check would pass without ever exercising the below-cutoff path it exists to guard.
    if (drawnLeaf) { const q = drawnLeaf.name.toLowerCase(); out.drawnQuery = q; out.drawnHidden = set(q); }
    if (hiddenLeaf) {
      const q = hiddenLeaf.name.toLowerCase();
      out.cutoffQuery = q; out.cutoffNode = hiddenLeaf.name;
      out.cutoffAlsoDrawn = A.state.nodes.some((b) => b.node.name.toLowerCase().includes(q));
      out.cutoffHidden = set(q);
    }
    out.noMatchHidden = set('zzzzzz-not-a-node');
    set('');
    return out;
  })()`);

  ok('C a query matching a drawn node hides the empty state', search.drawnHidden === true, `"${search.drawnQuery}"`);
  ok('C a query matching nothing shows the empty state', search.noMatchHidden === false);
  if (search.cutoffHidden === undefined) {
    console.log('  \x1b[33mSKIP\x1b[0m C below-cutoff query — this dataset draws every leaf');
  } else {
    ok('C the below-cutoff query really is below the cutoff', search.cutoffAlsoDrawn === false,
      `"${search.cutoffQuery}" -> ${search.cutoffNode}${search.cutoffAlsoDrawn ? ' — also matches a drawn node, so the next check would be vacuous' : ' — matches nothing on screen'}`);
    ok('C query matching ONLY below the depth cutoff still hides the empty state', search.cutoffHidden === true,
      `countMatches walks the tree, not the canvas`);
  }

  return geometry;
}

async function layerLanguages(url) {
  console.log('\n\x1b[1mLayer 3b — language colouring over CDP\x1b[0m');
  const target = new URL('../samples/polyglot.json', url).href;
  const { evaluate, navigate } = await cdp(url);
  await navigate(`${url.split('?')[0]}?data=../samples/polyglot.json`);

  const loaded = await evaluate(`(() => { const A = window.__codeAtlas; const n = document.getElementById('notice'); return { root: A.state.root && A.state.root.name, tiles: A.state.nodes.length, notice: n.hidden ? '' : n.textContent }; })()`);

  ok('preflight: the polyglot dataset loaded', loaded.root === 'polyglot',
    `page shows "${loaded.root}" (${loaded.tiles} tiles)${loaded.notice ? ` · notice: ${loaded.notice}` : ''} → ${target}`);

  const sampled = await evaluate(`(() => {
    const A = window.__codeAtlas;

    A.setTextEnabled(false);
    const canvas = document.getElementById('map');
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const out = [];
    for (const box of A.state.nodes) {
      if (box.node.children.length) continue;
      const x = Math.round((box.x + box.width / 2) * ratio);
      const y = Math.round((box.y + box.height / 2) * ratio);
      if (x < 1 || y < 1 || x >= canvas.width - 1 || y >= canvas.height - 1) continue;
      const d = ctx.getImageData(x, y, 1, 1).data;
      out.push({ name: box.node.name, lang: A.langOf(box.node), tint: A.LAYOUT.leafTint, painted: [d[0], d[1], d[2]] });
    }
    A.setTextEnabled(true);

    const overflow = document.querySelector('#languages .lang-more');
    return { leaves: out, legend: [...document.querySelectorAll('#legend .dot')].map((el) => ({ label: el.parentElement.textContent.trim(), color: getComputedStyle(el).backgroundColor })),
      otherDetail: [...document.querySelectorAll('#languages .lang-detail span')].map((el) => el.textContent.trim()),
      sidebar: [...document.querySelectorAll('#languages .lang-row')].map((el) => el.dataset.lang),

      sidebarOverflow: (overflow ? overflow.dataset.langs || '' : '').split(',').filter(Boolean),
      sidebarOverflowText: overflow ? overflow.textContent.trim() : '',
      distinctLangs: [...new Set(out.map((leaf) => leaf.lang))] };
  })()`);

  ok('L1 the polyglot sample really is multi-language on screen', sampled.distinctLangs.length >= 5,
    `${sampled.distinctLangs.length} languages over ${sampled.leaves.length} drawn leaves: ${sampled.distinctLangs.join(', ')}`);

  const byLang = new Map();
  for (const leaf of sampled.leaves) { if (!byLang.has(leaf.lang)) byLang.set(leaf.lang, leaf); }
  const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  const collisions = [];
  const distinct = [...byLang.values()];
  for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
    if (hex(distinct[i].painted) === hex(distinct[j].painted)) collisions.push(`${distinct[i].lang}=${distinct[j].lang}`);
  }
  ok('L2 leaves of different languages are painted different colours', collisions.length === 0,
    `${distinct.length} languages, ${new Set(distinct.map((leaf) => hex(leaf.painted))).size} distinct fills${collisions.length ? ` — ${collisions.join(', ')}` : ''}`);

  const wrongFill = [];
  for (const leaf of sampled.leaves) {
    const want = await evaluate(`(() => { const c = window.__codeAtlas.langColor(${JSON.stringify(leaf.lang)}); return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); })()`);
    const alpha = leaf.tint;
    const expected = want.map((v) => Math.round(v * alpha + 255 * (1 - alpha)));
    if (expected.some((v, index) => Math.abs(v - leaf.painted[index]) > 1)) wrongFill.push(`${leaf.name}(${leaf.lang}) painted ${hex(leaf.painted)} want ${hex(expected)}`);
  }
  ok('L3 each tile is painted exactly its language colour', wrongFill.length === 0,
    `${sampled.leaves.length} leaves checked${wrongFill.length ? ` — ${wrongFill.slice(0, 4).join('; ')}` : ''}`);

  const legendLangs = sampled.legend.filter((entry) => entry.label !== '项目' && entry.label !== '模块').map((entry) => entry.label);
  const drawn = new Set(sampled.leaves.map((leaf) => leaf.lang));
  const invented = legendLangs.filter((label) => label.startsWith('+') ? false : !drawn.has(label));
  ok('L4 the legend names only languages that are on the map', invented.length === 0,
    `legend: ${sampled.legend.map((entry) => `${entry.label}${entry.color ? '' : ''}`).join(' / ')}${invented.length ? ` — invented ${invented.join(', ')}` : ''}`);

  const named = new Set([...sampled.sidebar, ...sampled.sidebarOverflow]);
  const missingSidebar = [...drawn].filter((lang) => !named.has(lang));
  ok('L5 the sidebar discloses every language the map draws', missingSidebar.length === 0,
    `${sampled.sidebar.length} rows + ${sampled.sidebarOverflow.length} named in overflow`
    + ` (${sampled.sidebarOverflowText || 'none'})`
    + `${missingSidebar.length ? ` — missing ${missingSidebar.join(', ')}` : ''}`);

  const otherRow = sampled.sidebar.includes('其他');
  const otherNamed = sampled.otherDetail.join(' ');
  ok('L8 the 其他 bucket names what is inside it', otherRow && sampled.otherDetail.length > 0 && otherNamed.includes('.qqq'),
    otherRow ? `其他: ${otherNamed || '(no detail rendered)'}` : `其他 is not in the sidebar: ${sampled.sidebar.join(', ')}`);

  const zoomProbe = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const cv = document.querySelector('canvas'), ctx = cv.getContext('2d');
    const entries = [];
    for (let d = 0; d < 5; d++) {
      entries.push({ path: 'core' + d + '/index.ts', size: 90000 });
      entries.push({ path: 'core' + d + '/util.ts', size: 45000 });
      for (let f = 0; f < 24; f++) entries.push({ path: 'core' + d + '/part' + f + '.py', size: 1200 + f * 90 });
    }
    const tree = A.normalize(A.treeFromEntries(entries, 'dense'));
    A.state.root = tree; A.state.current = tree; A.state.selected = tree;
    A.state.offset = { x: 0, y: 0 };
    const at = (z) => { A.state.zoom = z; A.draw(); return A.state.nodes.slice(); };
    const named = (nodes) => nodes.filter((b) => b.lines.some((l) => l.key === 'name')).map((b) => b.node.name);
    const rects = (nodes) => nodes.map((b) => [b.node.name, b.x.toFixed(3), b.y.toFixed(3), b.width.toFixed(3), b.height.toFixed(3)].join('|')).join(';');
    const fits = (nodes, scale) => { const bad = []; for (const b of nodes) for (const l of b.lines) if (l.x + A.measureTextWidth(l.text, l.font) > b.width * scale - 1 || l.bottom > b.height * scale - 1 || l.x < 1) bad.push(b.node.name + ': ' + l.text); return bad; };
    const numericTruncation = (nodes) => { const bad = []; for (const b of nodes) for (const l of b.lines) if (l.key !== 'name' && l.text.indexOf('\\u2026') >= 0) bad.push(b.node.name + ': ' + l.text); return bad; };

    const one = at(1), two = at(2), four = at(4), eight = at(8);

    const grab = () => ctx.getImageData(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2, AX = 120, AY = 90;
    const ink = (t, zoom) => {
      A.state.zoom = zoom;
      A.state.offset = { x: AX - (t.x - cx) * zoom - cx, y: AY - (t.y - cy) * zoom - cy };
      A.setTextEnabled(true); A.draw(); const a = grab();

      const live = A.state.nodes.find((b) => b.node === t.node);
      const labelled = !!(live && live.lines.some((l) => l.key === 'name'));
      A.setTextEnabled(false); A.draw(); const b = grab();
      A.setTextEnabled(true);
      const sw = t.width * zoom, sh = t.height * zoom;
      let inTile = 0, minX = 1e9, maxX = -1e9, maxY = -1e9;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) continue;
        if (x < AX || x > AX + sw || y < AY || y > AY + sh) continue;
        inTile++;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
      return { name: t.node.name, zoom, labelled, inTile, dx: inTile ? minX - AX : null,
               limit: Math.round(A.LAYOUT.labelPad * zoom) + 8,
               spillsRight: inTile ? maxX > AX + sw + 1 : null,
               spillsBottom: inTile ? maxY > AY + sh + 1 : null };
    };
    const leaves = four.filter((b) => !b.node.children.length);

    const byArea = leaves.slice().sort((p, q) => p.width * p.height - q.width * q.height);
    const picks = [byArea[0], byArea[byArea.length - 1], four[0]].filter(Boolean);
    const samples = [];
    for (const t of picks) samples.push(ink(t, 1), ink(t, 4), ink(t, 8));

    const spreadAt = (zoom) => {
      A.state.zoom = zoom; A.state.offset = { x: 0, y: 0 };
      A.setTextEnabled(true); A.draw(); const a = grab();
      const live = A.state.nodes.filter((b) => b.lines.some((l) => l.key === 'name'));
      A.setTextEnabled(false); A.draw(); const b = grab();
      A.setTextEnabled(true);
      const rows = [];
      for (const t of live) {
        const sx = (t.x - cx) * zoom + cx, sy = (t.y - cy) * zoom + cy;
        const x1 = Math.max(0, Math.floor(sx)), x2 = Math.min(cv.width - 1, Math.ceil(sx + t.width * zoom));
        const y1 = Math.max(0, Math.floor(sy)), y2 = Math.min(cv.height - 1, Math.ceil(sy + t.height * zoom));
        let minX = 1e9, minY = 1e9;
        for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
          const i = (y * cv.width + x) * 4;
          if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) continue;
          if (x < minX) minX = x; if (y < minY) minY = y;
        }

        rows.push({ name: t.node.name, inset: +A.boxMetrics(t.width, t.height).inset.toFixed(2),
          dx: minX === 1e9 ? null : +(minX - sx).toFixed(1), dy: minY === 1e9 ? null : +(minY - sy).toFixed(1) });
      }
      return rows;
    };
    const spread = spreadAt(1);

    A.state.zoom = 1; A.state.offset = { x: 0, y: 0 }; A.draw();
    return {
      tiles: one.length,
      labelledOne: named(one).length, labelledTwo: named(two).length,
      labelledFour: named(four).length, labelledEight: named(eight).length,
      gained: named(four).filter((n) => !named(one).includes(n)).length,
      reflow: rects(one) !== rects(four),
      numOne: numericTruncation(one), numFour: numericTruncation(four),
      fitsOne: fits(one, 1), fitsFour: fits(four, 4),
      pad: A.LAYOUT.labelPad,
      padXs: [...new Set(one.flatMap((b) => b.lines.map((l) => +l.x.toFixed(3))))].sort((p, q) => p - q),
      spread,
      samples
    };
  })()`);

  ok('L6 zooming in reveals labels that had no room at 100%',
    zoomProbe.labelledFour > zoomProbe.labelledOne && zoomProbe.gained > 0,
    `${zoomProbe.labelledOne}/${zoomProbe.tiles} labelled at 100% → ${zoomProbe.labelledFour} at 400%`
    + ` (+${zoomProbe.gained}; ${zoomProbe.labelledTwo} at 200%, ${zoomProbe.labelledEight} at 800%)`);

  ok('L7 zoom does not reflow the map — the geometry is identical at 100% and 400%',
    !zoomProbe.reflow,
    zoomProbe.reflow ? 'tile positions differ between zoom levels' : `${zoomProbe.tiles} tiles unchanged`);

  ok('L9 no label is ever truncated mid-number, at any zoom',
    zoomProbe.numOne.length === 0 && zoomProbe.numFour.length === 0,
    [...zoomProbe.numOne, ...zoomProbe.numFour].length ? [...zoomProbe.numOne, ...zoomProbe.numFour].slice(0, 5).join('; ') : 'no share/size line carries an ellipsis');

  ok('L10 re-planned labels still fit inside their tiles at 400%',
    zoomProbe.fitsFour.length === 0 && zoomProbe.fitsOne.length === 0,
    [...zoomProbe.fitsOne, ...zoomProbe.fitsFour].length ? [...zoomProbe.fitsOne, ...zoomProbe.fitsFour].slice(0, 5).join('; ') : 'all lines within bounds at both zooms');

  const expectInk = zoomProbe.samples.filter((s) => s.labelled);
  const unlabelled = zoomProbe.samples.length - expectInk.length;
  const lostInk = expectInk.filter((s) => s.inTile === 0);
  const strayInk = expectInk.filter((s) => s.inTile > 0 && (s.dx > s.limit || s.spillsRight || s.spillsBottom));
  ok('L11 every label is painted inside its own tile, at every zoom',
    expectInk.length > 0 && lostInk.length === 0 && strayInk.length === 0,
    expectInk.length + ' labelled tile/zoom samples (of ' + zoomProbe.samples.length
    + '; ' + unlabelled + ' had no label at that zoom by design): '
    + expectInk.map((s) => `${s.name}@${s.zoom}x=${s.inTile}px/dx${s.dx}`).join(', ')
    + (lostInk.length ? ` — no ink found for ${lostInk.map((s) => s.name + '@' + s.zoom).join(', ')}` : '')
    + (strayInk.length ? ` — strayed: ${strayInk.map((s) => s.name + '@' + s.zoom + ' dx' + s.dx + '>' + s.limit).join(', ')}` : ''));

  const measuredPad = zoomProbe.spread.filter((r) => r.dx !== null);
  const padDxs = measuredPad.map((r) => r.dx);
  const padSpread = padDxs.length ? +(Math.max(...padDxs) - Math.min(...padDxs)).toFixed(1) : 0;
  const insetsSeen = [...new Set(zoomProbe.spread.map((r) => r.inset))].sort((p, q) => p - q);
  const planPadXs = zoomProbe.padXs.filter((x) => x !== zoomProbe.pad);
  ok('L12 every label sits the same distance from its own tile corner, whatever the tile size',
    measuredPad.length >= 8 && planPadXs.length === 0 && padSpread <= 3 && Math.min(...padDxs) >= zoomProbe.pad - 1,
    `${measuredPad.length} labelled tiles of ${zoomProbe.spread.length} at 100% (tile insets ${insetsSeen.join('/')}px): `
    + `ink starts ${Math.min(...padDxs)}–${Math.max(...padDxs)}px from the corner, spread ${padSpread}px against a pad of ${zoomProbe.pad}px`
    + (planPadXs.length ? ` — planned x values other than ${zoomProbe.pad}: ${planPadXs.join(', ')}` : ''));
}

async function layerJump(url) {
  console.log('\n\x1b[1mLayer 3c — jumping from a tile to its source file (CDP)\x1b[0m');
  const { evaluate, navigate } = await cdp(url);
  await navigate(url.includes('?') ? url : `${url}?data=${DEFAULT_DATASET}`);

  await evaluate(`(() => {
    const A = window.__codeAtlas;
    const cv = document.querySelector('canvas');
    const target = (x, y) => document.elementFromPoint(x, y) || document.body;
    const fire = (el, type, x, y, detail) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mousedown' ? 1 : 0, detail: detail || 1 }));
    window.__jumpTest = {
      entries: [{ path: 'src/index.ts', size: 12000 }, { path: 'src/util/helpers.ts', size: 4000 }, { path: 'README.md', size: 900 }],
      load(rootPath) {
        A.load(A.treeFromEntries(this.entries, 'demo', { rootPath }), 'demo');
        document.getElementById('welcome').hidden = true;
        A.draw();
      },

      point(name, offY) {
        const box = A.state.nodes.find((b) => b.node.name === name);
        if (!box) return null;
        const rect = cv.getBoundingClientRect();
        const lx = box.x + box.width / 2, ly = box.y + (offY === undefined ? box.height / 2 : offY);
        return { x: (lx - rect.width / 2) * A.state.zoom + rect.width / 2 + A.state.offset.x + rect.left,
                 y: (ly - rect.height / 2) * A.state.zoom + rect.height / 2 + A.state.offset.y + rect.top };
      },
      hitNameAt(x, y) {
        const rect = cv.getBoundingClientRect();
        const lx = ((x - rect.left) - rect.width / 2 - A.state.offset.x) / A.state.zoom + rect.width / 2;
        const ly = ((y - rect.top) - rect.height / 2 - A.state.offset.y) / A.state.zoom + rect.height / 2;
        const hit = [...A.state.nodes].reverse().find((b) => lx >= b.x && lx <= b.x + b.width && ly >= b.y && ly <= b.y + b.height);
        return hit ? hit.node.name : null;
      },
      click(x, y, detail) { const el = target(x, y); fire(el, 'mousedown', x, y, detail); fire(el, 'mouseup', x, y, detail); fire(el, 'click', x, y, detail); return el.tagName + (el.id ? '#' + el.id : ''); },
      dbl(x, y) { this.click(x, y, 1); this.click(x, y, 2); const el = target(x, y); fire(el, 'dblclick', x, y, 2); return el.tagName; },
      key(selector, key, code) { const el = document.querySelector(selector); el.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })); return true; },
      clear() { document.getElementById('open-link').removeAttribute('href'); },
      state() {
        const link = document.getElementById('open-source');
        const button = document.querySelector('[data-set-root]');
        const notice = document.getElementById('notice');
        return { path: (document.getElementById('node-path') || {}).textContent || null,
          href: link ? link.getAttribute('href') : null,
          openLink: document.getElementById('open-link').getAttribute('href'),
          button: button ? button.textContent : null,
          hint: (document.querySelector('.path-hint') || {}).textContent || null,
          notice: notice.hidden ? null : notice.textContent,
          selected: A.state.selected ? A.state.selected.name : null,
          current: A.state.current ? A.state.current.name : null,
          zoom: A.state.zoom, offset: A.state.offset };
      }
    };
    return true;
  })()`);

  const T = async (expression) => evaluate(`window.__jumpTest.${expression}`);
  const ROOT = 'F:/代码/demo project';
  const LEAF_URI = `vscode://file/F:/%E4%BB%A3%E7%A0%81/demo%20project/src/util/helpers.ts`;

  await evaluate('window.__jumpTest.load("F:/代码/demo project")');
  let p = await T('point("helpers.ts")');

  const over = await evaluate(`(() => { const el = document.elementFromPoint(${p.x}, ${p.y}); return el ? el.tagName + (el.id ? '#' + el.id : '') : null; })()`);
  ok('J1 the point aimed at is over the canvas', over === 'CANVAS#map', `${over} at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);

  console.log(`  \x1b[36mDATA\x1b[0m root path ${JSON.stringify(ROOT)}`);
  await T(`click(${p.x}, ${p.y})`);
  let s = await T('state()');
  ok('J2 clicking a file selects it and shows its project-relative path',
    s.selected === 'helpers.ts' && s.path === 'src/util/helpers.ts', `${s.selected} · ${s.path}`);
  ok('J3 the open link is percent-encoded — the space and the Chinese directory survive',
    s.href === LEAF_URI, `${s.href}`);

  await T('clear()');
  await T(`dbl(${p.x}, ${p.y})`);
  s = await T('state()');
  ok('J4 double-clicking a file hands the same URL to the editor', s.openLink === LEAF_URI, `${s.openLink}`);

  await evaluate('window.__jumpTest.load("F:/代码/demo project")');
  p = await T('point("src", 6)');
  const stripHit = await T(`hitNameAt(${p.x}, ${p.y})`);
  await T(`click(${p.x}, ${p.y})`);
  await T('clear()');
  await T('key("body", "Enter", "Enter")');
  s = await T('state()');
  ok('J5 a container refuses to open and says why',
    stripHit === 'src' && s.selected === 'src' && (s.openLink === null || s.openLink === undefined) && /容器/.test(s.notice || ''),
    `hit ${stripHit}, selected ${s.selected}, notice "${s.notice}"`);

  await evaluate('window.__jumpTest.load("F:/代码/demo project")');
  p = await T('point("src", 6)');
  await T('clear()');
  await T(`dbl(${p.x}, ${p.y})`);
  s = await T('state()');
  ok('J6 double-clicking a container descends instead of opening a file nobody pointed at',
    (s.openLink === null || s.openLink === undefined) && s.current === 'src', `openLink ${s.openLink} · current ${s.current}`);

  await evaluate('window.__jumpTest.load("F:/代码/demo project")');
  p = await T('point("helpers.ts")');
  await T(`click(${p.x}, ${p.y})`);
  await T('clear()');
  await T('key("body", "Enter", "Enter")');
  s = await T('state()');
  ok('J7 Enter opens the selected file', s.openLink === LEAF_URI, `${s.openLink}`);

  const before = await T('state()');
  const zoomButton = await evaluate(`(() => { const r = document.getElementById('zoom-in').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await T(`click(${zoomButton.x}, ${zoomButton.y})`);
  await evaluate('window.__codeAtlas.state.offset = { x: 40, y: 25 }; window.__codeAtlas.draw()');
  const searchBox = await evaluate(`(() => { const r = document.getElementById('search').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await T(`click(${searchBox.x}, ${searchBox.y})`);
  await evaluate('(() => { const s = document.getElementById("search"); s.value = "0"; s.dispatchEvent(new Event("input", { bubbles: true })); })()');
  await T('key("#search", "0", "Digit0")');
  s = await T('state()');
  ok('J8 typing 0 in the search box filters instead of resetting the view',
    s.zoom !== before.zoom && s.zoom === 1.25 && s.offset.x === 40 && s.offset.y === 25 && (await evaluate('window.__codeAtlas.state.query')) === '0',
    `zoom ${before.zoom} -> ${s.zoom}, offset ${JSON.stringify(s.offset)}, query "${await evaluate('window.__codeAtlas.state.query')}"`);

  await evaluate('window.__jumpTest.load(undefined)');
  p = await T('point("helpers.ts")');
  await T(`click(${p.x}, ${p.y})`);
  s = await T('state()');
  ok('J9 without a root path the inspector offers to set one instead of a dead link',
    s.href === null && s.button === '设置项目根路径' && /拼不出文件/.test(s.hint || ''),
    `href ${s.href}, button "${s.button}", hint "${s.hint}"`);
  ok('J10 the relative path is still shown, so the file is still identifiable', s.path === 'src/util/helpers.ts', `${s.path}`);

  await T('clear()');
  await T(`dbl(${p.x}, ${p.y})`);
  s = await T('state()');
  ok('J11 double-clicking with no root path explains the fix rather than opening a broken link',
    (s.openLink === null || s.openLink === undefined) && /根路径/.test(s.notice || '') && /扫描器/.test(s.notice || ''),
    `openLink ${s.openLink} · notice "${s.notice}"`);

  await evaluate('window.prompt = () => "D:/somewhere/demo"');
  const buttonPoint = async () => evaluate(`(() => { const b = document.querySelector('[data-set-root]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  let bp = await buttonPoint();
  await T(`click(${bp.x}, ${bp.y})`);
  s = await T('state()');
  ok('J12 setting the root path by hand produces a working link',
    s.href === 'vscode://file/D:/somewhere/demo/src/util/helpers.ts', `${s.href}`);
  ok('J13 it is remembered under the dataset label',
    (await evaluate('JSON.parse(localStorage.getItem("codeAtlas.rootPath")||"{}").demo')) === 'D:/somewhere/demo',
    await evaluate('localStorage.getItem("codeAtlas.rootPath")'));
  bp = await buttonPoint();
  ok('J14 the edit button survives the path being set, so a typo stays correctable', !!bp && s.button === '更改路径', bp ? `"${s.button}"` : 'no button left');

  await evaluate('window.prompt = () => "  "');
  await T(`click(${bp.x}, ${bp.y})`);
  s = await T('state()');
  ok('J15 a blank answer clears the path rather than storing it',
    s.href === null && s.button === '设置项目根路径' && (await evaluate('localStorage.getItem("codeAtlas.rootPath")')) === '{}',
    `href ${s.href}, button "${s.button}", storage ${await evaluate('localStorage.getItem("codeAtlas.rootPath")')}`);

  await evaluate('localStorage.removeItem("codeAtlas.rootPath")');

  await evaluate('localStorage.removeItem("codeAtlas.rootPath"); localStorage.removeItem("codeAtlas.rootHistory")');
  await evaluate('window.__jumpTest.load("F:/代码/demo project")');
  p = await T('point("helpers.ts")');
  await T(`click(${p.x}, ${p.y})`);
  await evaluate('window.prompt = () => "F:/work/atlas-todo-cli"');
  let guessButton = await buttonPoint();
  await T(`click(${guessButton.x}, ${guessButton.y})`);

  const sibling = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const entries = [{ path: 'app.js', size: 100 }];
    A.load(A.treeFromEntries(entries, 'code-map-v2'), 'code-map-v2');
    return A.rootPathGuess('code-map-v2');
  })()`);
  ok('J16 a different project beside the last one is guessed from the parent it already knows',
    sibling === 'F:/work/code-map-v2', sibling);

  const repeat = await evaluate('window.__codeAtlas.rootPathGuess("atlas-todo-cli")');
  ok('J17 the same folder name seen before is offered as itself', repeat === 'F:/work/atlas-todo-cli', repeat);

  const none = await evaluate(`(() => { localStorage.removeItem("codeAtlas.rootHistory"); return window.__codeAtlas.rootPathGuess("anything"); })()`);
  ok('J18 with nothing remembered the prompt is not prefilled with a guess', none === '', JSON.stringify(none));

  await evaluate('localStorage.removeItem("codeAtlas.rootPath")');
  await evaluate('localStorage.setItem("codeAtlas.rootHistory", JSON.stringify(["F:/work/other"]))');
  await evaluate('window.__jumpTest.load(undefined)');
  p = await T('point("helpers.ts")');
  await T(`click(${p.x}, ${p.y})`);
  const asked = await evaluate(`(() => {
    let seen = null;
    window.prompt = (message, value) => { seen = { message, value }; return null; };
    const b = document.querySelector('[data-set-root]');
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + 2, detail: 1 }));
    return seen;
  })()`);
  ok('J19 the prompt arrives prefilled and says where the value came from',
    asked && asked.value === 'F:/work/demo' && /预填/.test(asked.message || ''),
    asked ? `prefilled ${JSON.stringify(asked.value)}` : 'the prompt never opened');

  await evaluate('localStorage.removeItem("codeAtlas.rootPath"); localStorage.removeItem("codeAtlas.rootHistory")');
}

async function table(url) {
  const { evaluate } = await cdp(url);
  const rows = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const total = A.effectiveSize(A.state.root);
    const depth = new Map();
    const walk = (n, d) => { depth.set(n, d); n.children.forEach((c) => walk(c, d + 1)); };
    walk(A.state.root, 0);
    return A.state.nodes.map((b) => ({ depth: depth.get(b.node), name: b.node.name,
      x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      cellShare: +(b.width * b.height / (A.state.nodes[0].width * A.state.nodes[0].height) * 100).toFixed(1),
      sizeShare: total > 0 ? +(A.effectiveSize(b.node) / total * 100).toFixed(1) : 0,
      leaf: b.node.children.length === 0 }));
  })()`);
  console.log(`\n\x1b[1mI7 geometry table\x1b[0m`);
  console.log('  depth  name                  x       y       w       h    cell%  size%  kind');
  for (const r of rows) {
    console.log(`  ${String(r.depth).padStart(5)}  ${r.name.padEnd(20)} ${String(r.x).padStart(6)}  ${String(r.y).padStart(6)}  ${String(r.w).padStart(6)}  ${String(r.h).padStart(6)}  ${String(r.cellShare).padStart(5)}  ${String(r.sizeShare).padStart(5)}  ${r.leaf ? 'leaf' : 'box'}`);
  }
}

function layerGraph(A) {
  console.log('\n\x1b[1mGraph — relations between files (pure)\x1b[0m');

  const edgesOf = (...files) => A.buildRelations(files.map(([path, lang, text]) => ({ path, lang, text }))).edges;
  const find = (edges, from, to, kind) => edges.find((e) => e.kind === kind && ((e.from === from && e.to === to) || (e.from === to && e.to === from)));

  const flat = edgesOf(['a/main.py', 'Python', 'from helper import thing\n'], ['a/helper.py', 'Python', 'thing = 1\n']);
  ok('G1 `from helper import thing` resolves to the sibling file', !!find(flat, 'a/main.py', 'a/helper.py', 'import'),
    flat.length ? `${flat[0].from} -> ${flat[0].to}` : 'no edge');

  const nested = edgesOf(['pkg/main.py', 'Python', 'from llm.advisor import A\nimport config\n'], ['pkg/llm/advisor.py', 'Python', ''], ['pkg/config.py', 'Python', '']);
  ok('G2 a dotted import resolves to a nested module', !!find(nested, 'pkg/main.py', 'pkg/llm/advisor.py', 'import'), `got ${nested.length}`);
  ok('G2b a bare `import config` resolves to the sibling', !!find(nested, 'pkg/main.py', 'pkg/config.py', 'import'), `got ${nested.length}`);

  const relative = edgesOf(['pkg/sub/main.py', 'Python', 'from ..core import c\nfrom .util import u\n'], ['pkg/core.py', 'Python', ''], ['pkg/sub/util.py', 'Python', '']);
  ok('G3 `from ..core` climbs one level', !!find(relative, 'pkg/sub/main.py', 'pkg/core.py', 'import'), `got ${relative.length}`);
  ok('G3b `from .util` stays in the same package', !!find(relative, 'pkg/sub/main.py', 'pkg/sub/util.py', 'import'), `got ${relative.length}`);

  const external = edgesOf(['a/main.py', 'Python', 'from fastapi import FastAPI\nimport numpy\n']);
  ok('G4 an import that matches no file produces no edge', external.length === 0, `${external.length} edges`);
  ok('G4b an aliased specifier produces no edge', edgesOf(['a/main.js', 'JavaScript', "import x from '@/components/x'\n"]).length === 0, 'alias resolved');
  ok('G4c a file importing itself produces no edge', edgesOf(['a/main.js', 'JavaScript', "import './main'\n"]).length === 0, 'self edge');

  const js = edgesOf(['src/app.ts', 'TypeScript', "import { x } from './util/helpers'\nimport {\n  a,\n  b\n} from '../lib/core'\nconst y = require('./legacy')\n"],
    ['src/util/helpers.ts', 'TypeScript', ''], ['lib/core.ts', 'TypeScript', ''], ['src/legacy.js', 'JavaScript', '']);
  ok('G5 a single-line TS import resolves', !!find(js, 'src/app.ts', 'src/util/helpers.ts', 'import'), `got ${js.length}`);
  ok('G5b a multi-line TS import resolves', !!find(js, 'src/app.ts', 'lib/core.ts', 'import'), `got ${js.length}`);
  ok('G5c require() resolves and finds a .js for a .ts importer', !!find(js, 'src/app.ts', 'src/legacy.js', 'import'), `got ${js.length}`);

  const url = A.normaliseLiteral('http://127.0.0.1:8000/api/healthdesk/control');
  ok('G6 a URL folds to its path', url === '/api/healthdesk/control', `got ${url}`);
  ok('G6b a URL with no path folds to /', A.normaliseLiteral('https://api.example.com') === '/', `got ${A.normaliseLiteral('https://api.example.com')}`);
  ok('G6c a trailing slash is dropped', A.normaliseLiteral('api/v1/') === 'api/v1', `got ${A.normaliseLiteral('api/v1/')}`);

  const client = ['edge/config.py', 'Python', 'CONTROL_URL = "http://127.0.0.1:8000/api/healthdesk/control"\n'];
  const server = ['backend/app.py', 'Python', '@app.get("/api/healthdesk/control")\ndef control(): pass\n'];
  const loop = edgesOf(client, server);
  ok('G6d the client URL meets the server route across directories',
    !!find(loop, 'edge/config.py', 'backend/app.py', 'shared'),
    loop.length ? `${loop[0].kind}: ${loop[0].from} -> ${loop[0].to}` : 'no edge — the fold is not working');
  ok('G6e those two files have no import between them', !loop.some((e) => e.kind === 'import'),
    'an import edge appeared, so this fixture no longer tests the shared signal');

  const pair = find(edgesOf(['a.py', 'Python', 'x = "alpha_beta"\n'], ['b.py', 'Python', 'y = "alpha_beta"\n']), 'a.py', 'b.py', 'shared');
  ok('G7 a name shared by exactly two files weighs 1', pair && pair.weight === 1, pair ? `weight ${pair.weight}` : 'no edge');

  const wide = Array.from({ length: 12 }, (_, i) => [`f${String(i).padStart(2, '0')}.py`, 'Python', i < 4 ? 'x = "alpha_beta"\n' : 'y = 1\n']);
  const spread = edgesOf(...wide);
  const weak = find(spread, 'f00.py', 'f01.py', 'shared');

  ok('G7b a name shared by four of twelve files weighs 1/3 per pair', weak && weak.weight === 0.33, weak ? `weight ${weak.weight}` : 'no edge');

  ok('G7c that group produces a full clique of 6 pairs', spread.filter((e) => e.kind === 'shared').length === 6, `${spread.filter((e) => e.kind === 'shared').length} pairs`);

  const everywhere = A.buildRelations(Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.py`, lang: 'Python', text: 'x = "shared_everywhere"\n' })));
  ok('G8 a name above the fan-out cap is dropped, not drawn', everywhere.edges.length === 0 && everywhere.dropped.length === 1,
    `${everywhere.edges.length} edges, ${everywhere.dropped.length} dropped`);

  const literals = A.stringLiterals('a = "hello world"\nb = "error"\nc = "ab"\nd = "HUAWEI_DEVICE_ID"\ne = "health_status"\nf = "/api/v1/control"\n');
  ok('G9 prose, bare words and short strings are not names',
    !literals.has('hello world') && !literals.has('error') && !literals.has('ab') && literals.has('HUAWEI_DEVICE_ID') && literals.has('health_status') && literals.has('/api/v1/control'),
    `got ${[...literals].join(', ')}`);

  const polyglot = edgesOf(['a/main.zig', 'Zig', 'const key = "device_shadow_key";\n'], ['b/reader.rs', 'Rust', 'let k = "device_shadow_key";\n']);
  ok('G10 a language with no import rules still yields shared edges',
    polyglot.length === 1 && polyglot[0].kind === 'shared', `got ${polyglot.length} edges, kinds ${[...new Set(polyglot.map((e) => e.kind))].join('/')}`);

  ok('G11 binary, image and lockfile languages are not read',
    !A.relationSource('Binary', 100) && !A.relationSource('Image', 100) && !A.relationSource('Lockfile', 100) && !A.relationSource('Font', 100),
    'a binary language would have been read as text');
  ok('G11b an oversized source file is not read', A.relationSource('Python', A.RELATION_MAX_BYTES + 1) === false, `cap is ${A.RELATION_MAX_BYTES}`);
  ok('G11c an ordinary source file is read', A.relationSource('Python', 4096) && A.relationSource('Markdown', 4096), 'a readable file was refused');

  const index = A.relationIndex([{ from: 'a.py', to: 'b.py', kind: 'shared', weight: 2, labels: ['x_y'] }, { from: 'a.py', to: 'b.py', kind: 'nonsense' }, { from: 'a.py' }, null]);
  ok('G12 an edge is visible from both of its ends',
    index.get('a.py').length === 1 && index.get('b.py').length === 1 && index.get('b.py')[0].path === 'a.py',
    `${index.get('a.py').length} / ${index.get('b.py').length}`);
  ok('G12b malformed edges are skipped rather than thrown', !index.has(undefined) && index.size === 2, `index has ${index.size} entries`);

  const both = A.relationIndex([
    { from: 'a.py', to: 'b.py', kind: 'import', weight: 1 },
    { from: 'a.py', to: 'b.py', kind: 'shared', weight: 1, labels: ['x_y'] }
  ]);
  const fromA = both.get('a.py'), fromB = both.get('b.py');
  const importA = fromA.find((e) => e.kind === 'import'), importB = fromB.find((e) => e.kind === 'import');
  ok('G13 the index says which end of an edge each entry is',
    importA.dir === 'out' && importB.dir === 'in' && importA.path === 'b.py' && importB.path === 'a.py',
    `a.py holds ${importA.path}/${importA.dir}, b.py holds ${importB.path}/${importB.dir}`);

  const sharedA = fromA.find((e) => e.kind === 'shared'), sharedB = fromB.find((e) => e.kind === 'shared');
  ok('G13b an undirected edge claims no direction at either end',
    sharedA.dir === null && sharedB.dir === null,
    `shared entries carry dir ${JSON.stringify(sharedA.dir)} and ${JSON.stringify(sharedB.dir)}`);

  const resolveFiles = new Set(['src/index.js', 'src/store.js', 'pkg/mod.py', 'pkg/util.py', 'pkg/sub/deep.py', 'pkg/core.py']);
  const resolveExists = (path) => resolveFiles.has(path);
  const resolved = [
    ['./store.js', 'src/index.js', 'src/store.js'],
    ['.util', 'pkg/mod.py', 'pkg/util.py'],
    ['..core', 'pkg/sub/deep.py', 'pkg/core.py']
  ].map(([spec, from, want]) => ({ spec, got: A.resolveSpecifier(spec, from, resolveExists), want }));
  ok('G14 both import dialects resolve a relative specifier to the file that exists',
    resolved.every((item) => item.got === item.want),
    resolved.map((item) => `${item.spec} → ${item.got === null ? 'null' : item.got}${item.got === item.want ? '' : ` (wanted ${item.want})`}`).join(' · '));

  const outside = ['node:fs/promises', 'lodash', '@scope/pkg'].map((spec) => ({ spec, got: A.resolveSpecifier(spec, 'src/index.js', resolveExists) }));
  ok('G14b a specifier naming nothing in the tree stays external',
    outside.every((item) => item.got === null),
    outside.map((item) => `${item.spec} → ${item.got === null ? 'null' : item.got}`).join(' · '));
}

async function layerRelations(url) {
  console.log('\n\x1b[1mLayer 3d — the relation overlay (CDP)\x1b[0m');
  const { evaluate, navigate } = await cdp(url);
  await navigate(url.includes('?') ? url : `${url}?data=${DEFAULT_DATASET}`);

  await evaluate(`(() => {
    const A = window.__codeAtlas;
    const files = [
      { path: 'edge/config.py', lang: 'Python', text: 'CONTROL_URL = "http://127.0.0.1:8000/api/healthdesk/control"\\n' },
      { path: 'backend/app.py', lang: 'Python', text: '@app.get("/api/healthdesk/control")\\ndef control(): pass\\n' },
      { path: 'edge/main.py', lang: 'Python', text: 'from health_logic import HealthLogic\\ncontrol = "http://127.0.0.1:8000/api/healthdesk/control"\\n' },
      { path: 'edge/health_logic.py', lang: 'Python', text: 'class HealthLogic: pass\\n' },
      { path: 'notes.txt', lang: 'Text', text: 'nothing in common with anything\\n' }
    ];

    const chain = Array.from({ length: 11 }, (_, i) => 'l' + (i + 1)).join('/');
    const lift = [
      { path: 'top/main.py', lang: 'Python', text: 'URL = "http://svc.local/api/zzz"\\n' },
      { path: 'deep/' + chain + '/leaf.py', lang: 'Python', text: 'URL = "http://svc.local/api/zzz"\\n' }
    ];
    const canvas = document.querySelector('canvas');

    const mutual = [
      { path: 'm/a.py', lang: 'Python', text: 'import b\\n' },
      { path: 'm/b.py', lang: 'Python', text: 'import a\\n' }
    ];
    window.__relTest = {
      files,
      lift,
      mutual,
      load(fixture) {
        const list = fixture || this.files;
        const root = A.treeFromEntries(list.map((f) => ({ path: f.path, size: f.text.length })), 'demo');
        root.relations = A.buildRelations(list).edges;
        A.load(root, 'demo');
      },
      find(name) { const walk = (node) => (node.name === name ? node : node.children.reduce((hit, child) => hit || walk(child), null)); return walk(A.state.root); },
      select(name) { const node = this.find(name); if (!node) return null; A.select(node); return A.state.selected.name; },

      box(name) {
        const node = this.find(name);
        const item = (A.state.nodes || []).find((entry) => entry.node === node);
        if (!item) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + (item.x + item.width / 2 - rect.width / 2) * A.state.zoom + rect.width / 2 + A.state.offset.x,
          y: rect.top + (item.y + item.height / 2 - rect.height / 2) * A.state.zoom + rect.height / 2 + A.state.offset.y
        };
      },

      hover(name) {
        const at = this.box(name);
        if (!at) return null;
        canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, pointerId: 1, isPrimary: true }));
        return this.tip();
      },
      tip() {
        const el = document.getElementById('tooltip');
        return { hidden: el.hidden, text: el.hidden ? '' : el.textContent.trim().replace(/\s+/g, ' ') };
      },

      atRoot(name) { const picked = this.select(name); A.state.current = A.state.root; A.draw(); return picked; },

      lit() {
        const focus = A.relationTargets();
        if (!focus) return null;
        const drawn = A.state.relationLines || [];
        return {
          source: focus.selected.name,
          targets: focus.targets.map((t) => t.node.name),
          edges: focus.targets.reduce((n, t) => n + t.edges, 0),
          ringed: drawn.map((line) => line.node.name),
          lifted: drawn.filter((line) => !line.exact).map((line) => line.node.name)
        };
      },

      arrows() {
        const offCurve = (line, apex) => {
          let best = Infinity, prev = { x: line.from.x, y: line.from.y };
          for (let i = 1; i <= 200; i++) {
            const t = i / 200, u = 1 - t;
            const p = { x: u * u * line.from.x + 2 * u * t * line.control.x + t * t * line.to.x, y: u * u * line.from.y + 2 * u * t * line.control.y + t * t * line.to.y };
            const dx = p.x - prev.x, dy = p.y - prev.y;
            const len2 = dx * dx + dy * dy || 1;
            const s = Math.max(0, Math.min(1, ((apex.x - prev.x) * dx + (apex.y - prev.y) * dy) / len2));
            best = Math.min(best, Math.hypot(apex.x - prev.x - dx * s, apex.y - prev.y - dy * s));
            prev = p;
          }
          return best;
        };

        const read = (line, head, toward) => {
          if (!head) return null;
          const goal = toward === 'far' ? line.to : line.from;
          const gx = goal.x - head.apex.x, gy = goal.y - head.apex.y;
          const glen = Math.hypot(gx, gy) || 1;
          const forward = { x: -head.back.x, y: -head.back.y };
          return {
            t: head.t,
            on: Number(offCurve(line, head.apex).toFixed(2)),
            aim: Number(((forward.x * gx + forward.y * gy) / glen).toFixed(3))
          };
        };
        return (A.state.relationLines || []).map((line) => ({
          node: line.node.name,
          out: line.out,
          in: line.in,
          far: read(line, line.heads.far, 'far'),
          near: read(line, line.heads.near, 'near')
        }));
      },

      headInk(mode) {
        const line = (A.state.relationLines || []).find((item) => item.heads.far || item.heads.near);
        if (!line) return null;
        const head = line.heads.far || line.heads.near;
        const ctx = canvas.getContext('2d');
        const grab = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        A.state.relationMode = mode;
        A.setHeadsEnabled(false);
        const off = grab();
        A.setHeadsEnabled(true);
        const on = grab();
        const perpendicular = { x: -head.back.y, y: head.back.x };
        const points = [];
        for (const depth of [.72, .84, .96]) for (const side of [-1, 1]) {
          const px = Math.round(head.apex.x + head.back.x * head.size * depth + perpendicular.x * head.size * .26 * side);
          const py = Math.round(head.apex.y + head.back.y * head.size * depth + perpendicular.y * head.size * .26 * side);

          if (Math.hypot(px - line.from.x, py - line.from.y) < 10) continue;
          if (px < 1 || py < 1 || px >= canvas.width - 1 || py >= canvas.height - 1) continue;
          points.push([px, py]);
        }
        let changed = 0;
        for (const [px, py] of points) {
          const i = (py * canvas.width + px) * 4;
          if (off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) changed++;
        }
        return { changed, sampled: points.length, node: line.node.name, end: line.heads.far ? 'far' : 'near' };
      },

      groups() {
        const out = {};
        let title = null;
        for (const el of document.querySelectorAll('#inspector .relation-group-title, #inspector .relation-item')) {
          if (el.classList.contains('relation-group-title')) { title = el.firstChild.textContent.trim(); out[title] = []; }
          else if (title) out[title].push(el.querySelector('b').textContent);
        }
        return out;
      },

      landing() {
        return (A.state.relationLines || []).map((line) => ({
          node: line.node.name,
          exact: line.exact,
          offCentre: Math.round(Math.hypot(line.to.x - line.mid.x, line.to.y - line.mid.y)),
          halfShort: Math.round(Math.min(line.mid.w, line.mid.h) / 2)
        }));
      },

      ringInk(mode) {
        const line = (A.state.relationLines || [])[0];
        if (!line) return null;
        const ctx = canvas.getContext('2d');
        const grab = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        A.state.relationMode = 'off'; A.draw();
        const off = grab();
        A.state.relationMode = mode; A.draw();
        const on = grab();
        const x0 = Math.round(line.mid.x - line.mid.w / 2), x1 = Math.round(line.mid.x + line.mid.w / 2);
        const y0 = Math.round(line.mid.y - line.mid.h / 2), y1 = Math.round(line.mid.y + line.mid.h / 2);

        const points = [];
        for (let x = x0 + 1; x <= x1 - 1; x += 2) points.push([x, y0 + 1], [x, y1 - 1]);
        for (let y = y0 + 3; y < y1 - 1; y += 2) points.push([x0 + 1, y], [x1 - 1, y]);
        let changed = 0, sampled = 0;
        for (const [px, py] of points) {
          if (px < 1 || py < 1 || px >= canvas.width - 1 || py >= canvas.height - 1) continue;
          if (Math.hypot(px - line.to.x, py - line.to.y) < 60) continue;
          sampled++;
          const i = (py * canvas.width + px) * 4;
          if (off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) changed++;
        }
        return { changed, sampled, box: line.node.name };
      },

      endpointDim() {
        const line = (A.state.relationLines || [])[0];
        if (!line) return null;
        const ctx = canvas.getContext('2d');
        const mode = A.state.relationMode;

        const guard = Math.max(8, Math.min(line.mid.w, line.mid.h) * .25);
        const spots = [];
        for (const fx of [.32, .5, .68]) for (const fy of [.32, .5, .68]) {
          const px = Math.round(line.mid.x - line.mid.w / 2 + line.mid.w * fx), py = Math.round(line.mid.y - line.mid.h / 2 + line.mid.h * fy);
          if (Math.hypot(px - line.to.x, py - line.to.y) < guard) continue;
          spots.push([px, py]);
        }
        const grab = () => spots.map(([px, py]) => { const d = ctx.getImageData(px, py, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; });
        A.state.relationMode = mode; A.draw();
        const on = grab();
        A.state.relationMode = 'off'; A.draw();
        const off = grab();
        A.state.relationMode = mode; A.draw();
        return { node: line.node.name, changed: on.filter((value, i) => value !== off[i]).length, spots: spots.length };
      },
      mode(mode) { A.state.relationMode = mode; A.renderRelationToggle(); A.draw(); return this.activeMode(); },
      activeMode() { const el = document.querySelector('.relation-mode.active'); return el ? el.textContent : null; },
      toggleVisible() { return !document.getElementById('relation-toggle').hidden; },
      rows() { return [...document.querySelectorAll('.relation-item')].map((el) => el.querySelector('b').textContent); },
      labels() { return [...document.querySelectorAll('.relation-item small')].map((el) => el.textContent); },
      snapshot() { return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.slice(); },

      coreInk() { const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] - d[i] > 120) n++; return n; },

      overlayPixels(mode) {
        A.state.relationMode = 'off'; A.draw();
        const off = this.snapshot();
        A.state.relationMode = mode; A.draw();
        const on = this.snapshot();
        let changed = 0;
        for (let i = 0; i < off.length; i += 4) if (off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) changed++;
        const focus = A.relationTargets();
        const endpoints = (focus ? 1 + focus.targets.length : 1);
        return { changed, endpoints, lineBudget: Math.round(endpoints * (Math.hypot(canvas.width, canvas.height) * 6 + 60)) };
      }
    };
    return true;
  })()`);

  const T = async (expression) => evaluate(`window.__relTest.${expression}`);
  await evaluate('window.__relTest.load()');

  ok('R1 the layer switch appears when a dataset carries relations', await T('toggleVisible()') === true, `visibly hidden is ${await T('toggleVisible()')}`);
  ok('R1b it opens on the import layer', await T('activeMode()') === '依赖', `active is ${await T('activeMode()')}`);

  await T('select("main.py")');
  const focus = await T('lit()');
  ok('R2 selecting an importer lights exactly the file it imports',
    focus && focus.source === 'main.py' && focus.targets.join(',') === 'health_logic.py',
    focus ? `${focus.source} -> ${focus.targets.join(', ')}` : 'nothing lit');

  ok('R2b the line ends on the imported file itself',
    focus && focus.targets.join(',') === 'health_logic.py' && focus.ringed.join(',') === 'health_logic.py' && focus.lifted.length === 0,
    focus ? `targets ${focus.targets.join(', ')} · ringed ${focus.ringed.join(', ') || 'nothing'} · lifted ${focus.lifted.join(', ') || 'nothing'}` : 'nothing lit');

  await T("mode('shared')");
  await T('atRoot("config.py")');
  const cross = await T('lit()');
  ok('R3 a client and a server meet on a shared route across directories',
    cross && cross.targets.includes('app.py'),
    cross ? `targets ${cross.targets.join(', ')}` : 'nothing lit');

  await T('load(window.__relTest.lift)');
  await T("mode('shared')");
  await T('atRoot("main.py")');
  const deep = await T('lit()');
  ok('R2c an undrawn target lifts to the block that contains it, and is recorded as lifted',
    deep && deep.targets.join(',') === 'leaf.py' && deep.ringed.join(',') === 'deep' && deep.lifted.join(',') === 'deep',
    deep ? `targets ${deep.targets.join(', ')} · ringed ${deep.ringed.join(', ') || 'nothing'} · lifted ${deep.lifted.join(', ') || 'nothing'}` : 'nothing lit');

  const landings = await T('landing()');
  const land = landings && landings[0];
  ok('R2d a line to a block stops at its edge, not at its centre',
    land && land.exact === false && land.offCentre >= land.halfShort - 1 && land.halfShort >= 8,
    land ? `far end is ${land.offCentre}px from the centre of a box whose short half-side is ${land.halfShort}px` : 'no lines drawn');

  const ring = await T("ringInk('shared')");
  ok('R2f the box the line lands on is outlined, not merely dotted',
    ring && ring.sampled > 20 && ring.changed > ring.sampled * 0.5,
    ring ? `${ring.changed} of ${ring.sampled} boundary samples repainted around ${ring.box}` : 'no lines drawn');

  await T('load(window.__relTest.files)');
  await T("mode('import')");
  await T('atRoot("main.py")');
  const fileLanding = (await T('landing()'))[0];
  ok('R2e a line to a file runs to its middle, where nothing can be mistaken for it',
    fileLanding && fileLanding.exact === true && fileLanding.offCentre === 0,
    fileLanding ? `far end is ${fileLanding.offCentre}px from the centre of ${fileLanding.node}` : 'no lines drawn');

  const endpoint = await T('endpointDim()');
  ok('R2g the file the line points at is not itself dimmed',
    endpoint && endpoint.changed === 0,
    endpoint ? `${endpoint.changed} of ${endpoint.spots} samples inside ${endpoint.node} changed when the layer came on` : 'no lines drawn');

  await T("mode('shared')");

  await T('select("config.py")');
  const near = await T('lit()');
  const rows = await T('rows()');
  ok('R4 a partner outside the current view is listed but not drawn',
    near && near.targets.join(',') === 'main.py' && rows.includes('app.py'),
    `drawn ${JSON.stringify(near && near.targets)}, inspector ${rows.join(', ')}`);

  await T('atRoot("config.py")');
  const painted = await T('overlayPixels("shared")');
  ok('R5 the overlay both draws its lines and dims the rest',
    painted.changed > painted.lineBudget,
    `${painted.changed} pixels changed over ${painted.endpoints} endpoints, against a line-only ceiling of ${painted.lineBudget}`);

  await T("mode('import')");
  await T('atRoot("main.py")');
  const inkOn = await T('coreInk()');
  await T("mode('off')");
  const inkOff = await T('coreInk()');
  ok('R5b the import line is painted in its own colour', inkOn >= 5 && inkOff === 0,
    `${inkOn} strongly blue pixels with the layer on, ${inkOff} with it off`);

  const quiet = await T('select("notes.txt")');
  const quietPixels = await T('overlayPixels("shared")');
  ok('R6 a node with no relations lights nothing and dims nothing',
    quiet === 'notes.txt' && await T('lit()') === null && quietPixels.changed === 0,
    `${quiet}: ${await T('lit()') === null ? 'nothing lit' : 'lit something'}, ${quietPixels.changed} pixels changed`);

  await T('atRoot("config.py")');
  const offLabel = await T("mode('off')");
  const offFocus = await T('lit()');
  const offPixels = await T('overlayPixels("off")');
  ok('R7 the switch turns the layer off entirely', offLabel === '关' && offFocus === null && offPixels.changed === 0,
    `active is ${offLabel}, lit ${JSON.stringify(offFocus)}, ${offPixels.changed} pixels`);

  await T("mode('shared')");
  await T('atRoot("config.py")');
  const labels = await T('labels()');
  ok('R8 the inspector names the shared literals', labels.length > 0 && labels[0].includes('/api/healthdesk/control'),
    labels.length ? labels[0] : 'no labels');

  const aimed = (head, toward) => head && head.on < .5 && head.aim > .9 && (toward === 'far' ? head.t > .5 : head.t < .5);
  const show = (line) => `${line.node} out${line.out}/in${line.in} far ${line.far ? `t${line.far.t} on${line.far.on} aim${line.far.aim}` : 'none'} near ${line.near ? `t${line.near.t} on${line.near.on} aim${line.near.aim}` : 'none'}`;
  await T('load(window.__relTest.files)');
  await T("mode('import')");
  await T('atRoot("main.py")');
  const outgoing = await T('arrows()');
  ok('R9 an importing file\'s arrows point at what it imports, and only there',
    outgoing.length === 1 && outgoing.every((line) => line.out > 0 && line.in === 0 && aimed(line.far, 'far') && line.near === null),
    outgoing.length ? outgoing.map(show).join(', ') : 'no lines drawn');

  await T('atRoot("health_logic.py")');
  const incoming = await T('arrows()');
  ok('R10 the imported file\'s arrows point back at it, not away',
    incoming.length === 1 && incoming.every((line) => line.in > 0 && line.out === 0 && aimed(line.near, 'near') && line.far === null),
    incoming.length ? incoming.map(show).join(', ') : 'no lines drawn');

  await T('load(window.__relTest.mutual)');
  await T('atRoot("a.py")');
  const cycle = await T('arrows()');
  ok('R11 a mutual pair gets an arrow at each end of the one line between them',
    cycle.length === 1 && cycle[0].out > 0 && cycle[0].in > 0 && aimed(cycle[0].far, 'far') && aimed(cycle[0].near, 'near')
      && Math.abs(cycle[0].far.t - cycle[0].near.t) > .1,
    cycle.length ? `${show(cycle[0])} (gap ${Math.abs(cycle[0].far.t - cycle[0].near.t).toFixed(2)})` : 'no lines drawn');

  await T('load(window.__relTest.files)');
  await T('atRoot("main.py")');
  const head = await T("headInk('import')");
  ok('R12 the arrowhead itself is painted, not merely recorded',
    head && head.sampled >= 4 && head.changed >= head.sampled * .75,
    head ? `${head.changed} of ${head.sampled} samples inside the head repainted at the ${head.end} end of ${head.node}` : 'no lines drawn');

  await T('atRoot("health_logic.py")');
  const filed = await T('groups()');

  const listed = filed && Object.keys(filed).length;
  ok('R13 the inspector files each partner under the direction it actually runs',
    filed && Array.isArray(filed['被依赖']) && filed['被依赖'].includes('main.py') && !filed['依赖'],
    listed ? Object.entries(filed).map(([title, names]) => `${title}: ${names.join(', ')}`).join(' · ')
      : 'the relation section rendered no groups at all');

  await T('load(window.__relTest.files)');
  await T("mode('import')");
  await T('atRoot("main.py")');

  const hovered = await T('hover("health_logic.py")');
  ok('T1 hovering a node that is not the selection still opens the tooltip',
    hovered && !hovered.hidden && hovered.text.includes('health_logic.py'),
    hovered ? (hovered.hidden ? `hidden while hovering health_logic.py` : hovered.text) : 'health_logic.py is not on the canvas');

  const overSelected = await T('hover("main.py")');
  ok('T2 hovering the selected node drops the panel that would cover its own lines',
    overSelected && overSelected.hidden === true,
    overSelected ? (overSelected.hidden ? 'hidden' : `shown over the lines: ${overSelected.text}`) : 'main.py is not on the canvas');

  await T("mode('off')");
  const uncovered = await T('hover("main.py")');
  ok('T3 with the layer off the same hover opens it again, so the rule is about the lines',
    uncovered && !uncovered.hidden && uncovered.text.includes('main.py'),
    uncovered ? (uncovered.hidden ? "hidden with the layer off, so the selected node is barred rather than unoccluded" : uncovered.text) : 'main.py is not on the canvas');
  await T("mode('import')");
}

/* The strongest check here is the empty page: with nothing imported, every character on screen is
   interface copy, so the scan can be the whole document instead of a list of places someone
   remembered to look. The switch's own 中 / EN labels are the one exemption — they are the names of
   the two languages, not interface copy, and a switcher that renamed itself would be unusable. */
async function layerText(url) {
  console.log('\n\x1b[1mLayer 3e — the interface language switch (CDP)\x1b[0m');
  const bare = url.split('?')[0];
  const { evaluate, navigate } = await cdp(bare);

  const scan = (roots, exempt) => `(() => {
    const CJK = new RegExp(${JSON.stringify(CJK.source)});
    const skip = new Set(${exempt ? `[...document.querySelectorAll(${JSON.stringify(exempt)})]` : '[]'});
    const found = [];
    const add = (where, text) => {
      const value = String(text == null ? '' : text);
      if (CJK.test(value)) found.push(where + ' = ' + JSON.stringify(value.replace(/\\s+/g, ' ').trim().slice(0, 70)));
    };
    const ATTRIBUTES = /^(placeholder|title|aria-label|alt|content)$/;
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { if (!skip.has(child.parentElement)) add(child.parentElement.id || child.parentElement.className || child.parentElement.tagName.toLowerCase(), child.nodeValue); continue; }
        if (child.nodeType !== 1) continue;
        if (skip.has(child) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
        for (const attribute of child.attributes) if (ATTRIBUTES.test(attribute.name)) add(child.tagName.toLowerCase() + '[' + attribute.name + ']', attribute.value);
        walk(child);
      }
    };
    for (const selector of ${JSON.stringify(roots)}) { const host = document.querySelector(selector); if (host) walk(host); else found.push('missing ' + selector); }
    return { found: found, docLang: document.documentElement.lang };
  })()`;

  await navigate(bare, 'en');
  const english = await evaluate(scan(['html'], '#lang-toggle'));
  ok('U5 in English the empty page says nothing in Chinese but the two switch labels',
    english.found.length === 0 && english.docLang === 'en',
    english.found.length
      ? `${english.found.length} left: ${english.found.slice(0, 6).join(' · ')}`
      : `whole document clean, <html lang="${english.docLang}">`);

  await navigate(bare, 'zh');
  const drift = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const SLOTS = ${JSON.stringify(I18N_SLOTS_SOURCE)};
    const out = [];
    for (const [attribute, slot] of SLOTS) for (const element of document.querySelectorAll('[' + attribute + ']')) {
      if (element.id === 'status') continue;
      const key = element.getAttribute(attribute);
      const want = A.I18N.zh[key];
      const got = element[slot] === undefined ? element.getAttribute(slot) : element[slot];
      if (want === undefined) out.push(key + ' is not in the zh table');
      else if (String(got).trim() !== String(want).trim()) out.push(key + ': markup "' + String(got).trim() + '" vs table "' + want + '"');
    }
    return { drift: out, docLang: document.documentElement.lang };
  })()`);
  ok('U6 the Chinese in the markup and the Chinese in the table are the same sentences',
    drift.drift.length === 0 && drift.docLang === 'zh-CN',
    drift.drift.length ? drift.drift.join(' · ') : `every data-i18n attribute agrees, <html lang="${drift.docLang}">`);

  await navigate(bare, 'en');
  const loaded = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const entries = [];
    for (let group = 0; group < 6; group++) for (let file = 0; file < 6; file++) entries.push({ path: 'group' + group + '/file' + file + '.ts', size: 3000 + file * 400 });
    entries.push({ path: 'api/app.py', size: 9000 }, { path: 'api/boot.py', size: 2000 }, { path: 'api/routes/tasks.py', size: 4000 }, { path: 'api/db/models.py', size: 5000 });
    const tree = A.treeFromEntries(entries, 'ascii-demo');

    tree.relations = [
      { from: 'api/app.py', to: 'api/routes/tasks.py', kind: 'import', weight: 2 },
      { from: 'api/boot.py', to: 'api/app.py', kind: 'import', weight: 1 },
      { from: 'api/app.py', to: 'api/db/models.py', kind: 'shared', weight: 1, labels: ['/api/tasks'] }
    ];
    A.load(tree, 'ascii-demo');
    A.select(A.state.byPath.get('api/app.py'));
    return { groups: document.querySelectorAll('#inspector .relation-group-title').length, hint: !!document.querySelector('#inspector .path-hint') };
  })()`);
  const residue = await evaluate(scan(['#sidebar', '#inspector', '.statusbar'], ''));
  ok('U7 an imported project leaves no Chinese in the sidebar, the inspector or the status bar',
    residue.found.length === 0 && loaded.groups === 3 && loaded.hint,
    residue.found.length
      ? `${residue.found.length} left: ${residue.found.slice(0, 6).join(' · ')}`
      : `${loaded.groups} relation headings${loaded.hint ? ' and the root-path hint' : ' but NO path hint'}, all English`);

  const flip = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const read = () => ['#sidebar', '#inspector', '#status', '#legend'].map((selector) => document.querySelector(selector).textContent.replace(/\\s+/g, ' ').trim()).join(' | ');

    A.setLang('zh');
    const zh = read();
    A.setLang('en');
    const en = read();
    A.setLang('zh');
    return { zh: zh, en: en, back: read(), docLang: document.documentElement.lang };
  })()`);
  ok('U8 switching re-renders every panel, and switching back restores what was there',
    flip.zh !== flip.en && flip.back === flip.zh && flip.docLang === 'zh-CN',
    flip.zh === flip.en ? 'the English page reads exactly like the Chinese one'
      : `en differs by ${flip.en.length - flip.zh.length} chars, back ${flip.back === flip.zh ? 'identical' : 'DIFFERENT'}`);

  const label = await evaluate(`(() => {
    const A = window.__codeAtlas;
    const entries = [];
    for (let group = 0; group < 6; group++) for (let file = 0; file < 6; file++) entries.push({ path: 'group' + group + '/file' + file + '.ts', size: 3000 + file * 400 });
    A.load(A.treeFromEntries(entries, 'labels'), 'labels');

    const meta = () => {
      const box = A.state.nodes.find((tile) => tile.node.type === 'module' && tile.node.children.length && tile.lines.some((line) => line.key === 'meta'));
      return box ? box.lines.find((line) => line.key === 'meta').text : null;
    };
    const zh = meta();
    A.setLang('en');
    const en = meta();
    A.setLang('zh');
    localStorage.removeItem('codeAtlas.lang');
    return { zh: zh, en: en, back: meta() };
  })()`);
  ok('U11 a tile label follows the language, down to the line the layout region used to write itself',
    !!label.zh && label.zh.startsWith('模块 · ') && !!label.en && label.en.startsWith('Module · ')
      && label.back === label.zh,
    `zh "${label.zh}" · en "${label.en}" · back "${label.back}"`);

  await navigate(bare, 'zh');
  await evaluate('localStorage.removeItem("codeAtlas.lang")');
  await evaluate('document.querySelector("#lang-toggle [data-lang=\\"en\\"]").click()');
  const stored = await evaluate('localStorage.getItem("codeAtlas.lang")');
  await navigate(bare, '');
  const remembered = await evaluate('window.__codeAtlas.state.lang');
  await navigate(bare, 'zh');
  const pinned = await evaluate('window.__codeAtlas.state.lang');
  const survived = await evaluate('localStorage.getItem("codeAtlas.lang")');
  await evaluate('localStorage.removeItem("codeAtlas.lang")');
  ok('U9 the choice survives a reload, and ?lang= overrides it without overwriting it',
    stored === 'en' && remembered === 'en' && pinned === 'zh' && survived === 'en',
    `the switch stored "${stored}", a plain reload showed "${remembered}", ?lang=zh showed "${pinned}" and left storage at "${survived}"`);
}

const urlIndex = process.argv.indexOf('--url');
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : null;

try {
  const A = await loadPureRegion();
  layer1(A);
  layerModel(A);
  layerGraph(A);
  await layerScan();

  await layerWords(A);
  await layerDocs();
  if (url) {
    await layerShell(url);
    await layer3(url);

    if (process.argv.includes('--table')) await table(url);
    await layerLanguages(url);
    await layerJump(url);
    await layerRelations(url);

    await layerText(url);
  } else console.log('\n(pass --url <viewer url> to also run the browser checks)');

  console.log(`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} checks passed\x1b[0m\n`);

  annotate(failures ? 'error' : 'notice', failures
    ? `${failures} of ${checks} checks failed on ${process.platform} node ${process.version}, tmpdir ${tmpdir()}`
    : `${checks}/${checks} checks passed on ${process.platform} node ${process.version}`);
  await drain();
  process.exit(failures === 0 ? 0 : 1);
} catch (error) {
  console.error(`\n\x1b[31mcould not run:\x1b[0m ${error.message}\n`);
  annotate('error', `could not run on ${process.platform} node ${process.version}: ${error.message}`);
  if (process.env.DEBUG) console.error(error);
  await drain();
  process.exit(2);
}
