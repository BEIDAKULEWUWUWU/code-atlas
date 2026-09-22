#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'viewer', 'app.js');

/* The scanner runs the viewer's own language table and folder-to-tree code, lifted out of app.js
   between the @model and @graph markers, so a rule fixed here cannot drift from the browser's. */
async function loadModel() {
  const source = await readFile(APP, 'utf8');
  const region = (marker) => {
    const start = source.indexOf(`/* @${marker}:pure:start`);
    if (start < 0) throw new Error(`missing /* @${marker}:pure:start marker in viewer/app.js`);
    const body = source.indexOf('*/', start) + 2;
    const end = source.indexOf(`/* @${marker}:pure:end */`);
    if (end < 0) throw new Error(`missing /* @${marker}:pure:end */ marker in viewer/app.js`);
    return source.slice(body, end);
  };

  return new Function(`${region('model')}
${region('graph')}
    return { langFromName, treeFromEntries, isIgnoredPath, SKIP_DIRS, LANG_ORDER, buildRelations, relationSource };`)();
}

const USAGE = `Code Atlas scanner

  node tools/scan.js <dir> [options]

  --out <file>       write the JSON here (default: stdout)
  --name <name>      name for the root node (default: the directory's name)
  --all              do not skip dependencies or build output
  --ignore <name>    skip this file or directory name; repeatable, and outranks --all
  --max-depth <n>    stop descending past this depth (default: 24)
  --no-root-path     do not record the absolute path of the scanned folder
  --no-relations     do not read file contents; sizes and colours only
  --quiet            only print errors
`;

function parseArgs(argv) {
  const options = { dir: '.', out: null, name: null, all: false, ignore: [], maxDepth: 24, quiet: false, rootPath: true, relations: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') options.out = argv[++i];
    else if (arg === '--name') options.name = argv[++i];
    else if (arg === '--all') options.all = true;
    else if (arg === '--ignore') options.ignore.push(argv[++i]);
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--no-root-path') options.rootPath = false;
    else if (arg === '--no-relations') options.relations = false;
    else if (arg === '--max-depth') options.maxDepth = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }
    else if (arg.startsWith('-')) { console.error(`unknown option ${arg}\n\n${USAGE}`); process.exit(2); }
    else options.dir = arg;
  }
  if (!Number.isFinite(options.maxDepth) || options.maxDepth < 1) { console.error('--max-depth must be a positive number'); process.exit(2); }
  if (options.ignore.some((name) => !name)) { console.error('--ignore needs a file or directory name'); process.exit(2); }
  return options;
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; out[index] = await worker(items[index]); }
  });
  await Promise.all(runners);
  return out;
}

async function readCorpus(found, sizes, model) {
  const picked = [];
  found.forEach((entry, index) => {
    const lang = model.langFromName(entry.path.split('/').pop());
    if (!model.relationSource(lang, sizes[index])) return;
    picked.push({ path: entry.path, lang, full: entry.full });
  });
  const texts = await mapLimit(picked, 32, async (item) => {
    const buffer = await readFile(item.full).catch(() => null);
    return buffer ? buffer.toString('utf8') : null;
  });

  return picked
    .map((item, index) => ({ path: item.path, lang: item.lang, text: texts[index] }))
    .filter((item) => item.text !== null && item.text.indexOf('\u0000') < 0);
}

async function collect(dir, prefix, depth, options, model, found, skipped, notes) {
  if (depth > options.maxDepth) { notes.depthStopped.add(prefix || '.'); return; }
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { notes.unreadable.push(`${prefix || '.'} — ${error.code}`); return; }
  for (const entry of entries) {

    if (entry.isSymbolicLink()) { notes.symlinks++; continue; }

    const ignored = options.ignore.includes(entry.name) || (!options.all && model.isIgnoredPath([entry.name]));
    if (entry.isDirectory()) {
      if (ignored) { skipped.add(entry.name); continue; }
      await collect(join(dir, entry.name), `${prefix}${entry.name}/`, depth + 1, options, model, found, skipped, notes);
    } else if (entry.isFile()) {
      if (ignored) { notes.skippedFiles++; continue; }
      found.push({ full: join(dir, entry.name), path: prefix + entry.name });
    }
  }
}

function humanSize(kb) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb * 10) / 10} KB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const model = await loadModel();

  const root = resolve(options.dir);
  const info = await stat(root).catch(() => null);
  if (!info) { console.error(`no such directory: ${root}`); process.exit(2); }
  if (!info.isDirectory()) { console.error(`not a directory: ${root} — this scanner takes a project folder, not a single file`); process.exit(2); }

  const found = [];
  const skipped = new Set();
  const notes = { symlinks: 0, skippedFiles: 0, unreadable: [], depthStopped: new Set() };
  const started = Date.now();
  await collect(root, '', 1, options, model, found, skipped, notes);

  const sizes = await mapLimit(found, 32, async (entry) => (await stat(entry.full).catch(() => ({ size: 0 }))).size);
  const entries = found.map((entry, index) => ({ path: entry.path, size: sizes[index] }));

  const name = options.name || basename(root) || 'project';

  const tree = model.treeFromEntries(entries, name, { all: options.all, rootPath: options.rootPath ? root : '' });

  const corpus = options.relations ? await readCorpus(found, sizes, model) : [];
  const relations = options.relations ? model.buildRelations(corpus) : { edges: [], dropped: [] };
  if (relations.edges.length) tree.relations = relations.edges;
  const json = JSON.stringify(tree);

  if (options.out) {
    const target = resolve(options.out);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, json, 'utf8');
  }

  if (!options.quiet) {

    const say = (line = '') => process.stderr.write(`${line}\n`);

    let drawn = 0, totalKb = 0;
    const languages = new Map();
    const tally = (node) => {
      if (!node.children.length) { drawn++; totalKb += node.size; languages.set(node.lang, (languages.get(node.lang) || 0) + node.size); return; }
      node.children.forEach(tally);
    };
    tally(tree);

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    say(`\n\x1b[1m${name}\x1b[0m — ${root}`);
    say(`  ${drawn} files · ${humanSize(totalKb)} · ${elapsed}s`);
    say(`  languages  ${[...languages].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([lang, kb]) => `${lang} ${humanSize(kb)}`).join(' · ')}`);

    if (options.relations) {
      const imports = relations.edges.filter((edge) => edge.kind === 'import').length;
      const shared = relations.edges.length - imports;
      say(`  relations  ${imports} import · ${shared} shared, from ${corpus.length} files read`);
      const dropped = relations.dropped;
      if (dropped.length) say(`  vocabulary ${dropped.length} name${dropped.length === 1 ? '' : 's'} too common to mean a coupling (${dropped.slice(0, 3).map(([name, users]) => `${name} ×${users}`).join(', ')})`);
    }
    const skippedFrom = entries.length - drawn;
    if (skipped.size) say(`  skipped    ${[...skipped].sort().join(', ')}${skippedFrom > 0 ? ` — ${skippedFrom} files not drawn` : ''}`);
    if (notes.skippedFiles) say(`  skipped    ${notes.skippedFiles} individual files by name`);
    if (notes.symlinks) say(`  symlinks   ${notes.symlinks} not followed`);
    if (notes.depthStopped.size) say(`  depth      stopped below ${[...notes.depthStopped].slice(0, 4).join(', ')}`);
    for (const problem of notes.unreadable.slice(0, 4)) say(`  \x1b[33munreadable\x1b[0m ${problem}`);
    if (!skipped.size && !options.all) say(`  skipped    nothing`);
    if (options.out) {
      const file = relative(process.cwd(), resolve(options.out)).split('\\').join('/');
      say(`\n  wrote ${file} (${humanSize(json.length / 1024)})`);

      const reachable = !isAbsolute(file) && !file.startsWith('..');
      if (reachable) {
        const deep = file.split('/').length - 1;
        say(`  open  http://localhost:8123/viewer/index.html?data=${'../'.repeat(deep)}${file}`);
      } else {
        say(`  note  ${file} is outside the served folder, so ?data= cannot reach it —`);
        say(`        scan into a path under ${process.cwd()} to get a link,`);
        say(`        or drag the file onto the page / use 「导入 JSON」 instead.`);
      }
    }
  }

  if (!options.out) process.stdout.write(json);
}

try {
  await main();
} catch (error) {
  console.error(`\n\x1b[31mscan failed:\x1b[0m ${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  process.exit(2);
}
