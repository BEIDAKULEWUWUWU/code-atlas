(() => {
  'use strict';
  const $ = (id) => document.getElementById(id); const canvas = $('map'); const context = canvas.getContext('2d');

  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  let nodesById = [];
  const state = { root: null, current: null, selected: null, query: '', zoom: 1, offset: { x: 0, y: 0 }, nodes: [], expanded: new Set(), dragging: false, dragStart: null, clickNode: null, datasetLabel: '', rootPath: '', relations: new Map(), byPath: new Map(), relationMode: 'import', relationLines: [], lang: 'zh' };
  const NODE_TYPES = ['project', 'module', 'file'];

  function normalize(node, parent = null, depth = 0) { node.parent = parent; node.depth = depth; node.id = nodesById.push(node) - 1; node.children = Array.isArray(node.children) ? node.children.map((child) => normalize(child, node, depth + 1)) : []; node.type = NODE_TYPES.includes(node.type) ? node.type : (parent ? (node.children.length ? 'module' : 'file') : 'project'); effectiveSize(node); return node; }
  function count(node, type) { return node.type === type ? 1 : node.children.reduce((total, child) => total + count(child, type), 0); }
  function descendants(node) { return node.children.flatMap((child) => [child, ...descendants(child)]); }
  /* Read back out of this file by a regex in check.js, so keep this one flat object literal on a
     single declaration, with no brace-nesting inside it. Same for the font ladders below. */
  const LAYOUT = { marginMax: 28, marginRatio: .04, minCell: 3600, maxDepth: 12, minContentW: 44, minContentH: 26, insetCoef: .045, insetMin: 1, insetMax: 8, labelPad: 8, titleGap: 2, leafTint: .26, blockTint: .3, bandTint: .1, dimAlpha: .28 };
  const TITLE_FONTS = [['700 13px Manrope', 17], ['700 11px Manrope', 14], ['600 9px Manrope', 12]];

  const META_FONTS = [['10px IBM Plex Mono', 13], ['9px IBM Plex Mono', 12], ['8px IBM Plex Mono', 11]];
  const LADDER_FONTS = [...TITLE_FONTS, ...META_FONTS];

  const RELATION_COLORS = { import: '#1f6feb', shared: '#b45309' };
  const textCache = new Map(); const fontMetrics = new Map();
  let currentFont = ''; let textEnabled = true; let debugColors = false; let headsEnabled = true; let nodeIndex = 0; let textQueue = [];

  /* The four @*:pure markers are load-bearing: check.js and tools/scan.js lift the code between
     them out of this file with indexOf. Renaming one disarms every verification run. */
  /* @model:pure:start */
  const LANG_BY_EXT = {
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
    ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
    py: 'Python', pyi: 'Python', rs: 'Rust', go: 'Go', java: 'Java',
    kt: 'Kotlin', kts: 'Kotlin', c: 'C', h: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
    cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift', m: 'Objective-C', mm: 'Objective-C',
    scala: 'Scala', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', bat: 'Shell',
    sql: 'SQL', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
    vue: 'Vue', svelte: 'Svelte', lua: 'Lua', dart: 'Dart', ex: 'Elixir', exs: 'Elixir',
    erl: 'Erlang', clj: 'Clojure', cljs: 'Clojure', hs: 'Haskell', ml: 'OCaml', mli: 'OCaml',
    r: 'R', jl: 'Julia', pl: 'Perl', pm: 'Perl', zig: 'Zig', nim: 'Nim',
    f90: 'Fortran', f: 'Fortran', asm: 'Assembly', s: 'Assembly', groovy: 'Groovy',
    md: 'Markdown', mdx: 'Markdown', txt: 'Text', json: 'JSON', jsonc: 'JSON',
    yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'Config', cfg: 'Config', env: 'Config',
    xml: 'XML', svg: 'SVG', csv: 'CSV', tsv: 'CSV', proto: 'Protobuf',
    graphql: 'GraphQL', gql: 'GraphQL', tf: 'Terraform', gradle: 'Gradle',
    ipynb: 'Notebook', lock: 'Lockfile', png: 'Image', jpg: 'Image', jpeg: 'Image',
    gif: 'Image', webp: 'Image', ico: 'Image', bmp: 'Image',
    woff: 'Font', woff2: 'Font', ttf: 'Font', otf: 'Font', eot: 'Font',

    wxml: 'WXML', wxss: 'WXSS', wxs: 'WXS',
    ino: 'Arduino', pde: 'Arduino',
    conf: 'Config', properties: 'Config', desktop: 'Config', service: 'Config',
    rst: 'RST', tex: 'TeX', adoc: 'Text', org: 'Text',
    ejs: 'Template', hbs: 'Template', handlebars: 'Template', mustache: 'Template',
    pug: 'Template', jade: 'Template', twig: 'Template', liquid: 'Template',
    njk: 'Template', erb: 'Template', tpl: 'Template',
    j2: 'Template', jinja: 'Template', jinja2: 'Template',
    cshtml: 'Razor', razor: 'Razor', vb: 'Visual Basic',
    fs: 'F#', fsi: 'F#', fsx: 'F#',
    mk: 'Makefile', cmake: 'CMake', ninja: 'Ninja', bazel: 'Bazel', bzl: 'Bazel',
    zip: 'Binary', tar: 'Binary', gz: 'Binary', tgz: 'Binary', bz2: 'Binary', xz: 'Binary',
    '7z': 'Binary', rar: 'Binary', pdf: 'Binary', wasm: 'Binary', psd: 'Binary',
    exe: 'Binary', dll: 'Binary', so: 'Binary', dylib: 'Binary', bin: 'Binary', dat: 'Binary',
    o: 'Binary', a: 'Binary', lib: 'Binary', obj: 'Binary', class: 'Binary',
    jar: 'Binary', pyc: 'Binary', pyo: 'Binary',
    pem: 'Certificate', crt: 'Certificate', cer: 'Certificate', p12: 'Certificate', pfx: 'Certificate',
    sqlite: 'Database', sqlite3: 'Database', db: 'Database',
    log: 'Log', diff: 'Diff', patch: 'Diff', map: 'Source Map',
    bak: 'Backup', orig: 'Backup', tmp: 'Temp', swp: 'Temp'
  };

  const LANG_BY_NAME = {
    dockerfile: 'Docker', containerfile: 'Docker', makefile: 'Makefile', 'cmakelists.txt': 'CMake',
    rakefile: 'Ruby', gemfile: 'Ruby', 'go.mod': 'Go', 'cargo.toml': 'Rust',
    'package.json': 'JSON', 'tsconfig.json': 'JSON', procfile: 'Config',
    'go.sum': 'Lockfile', 'cargo.lock': 'Lockfile', 'package-lock.json': 'Lockfile', 'yarn.lock': 'Lockfile',
    license: 'Text', notice: 'Text', readme: 'Text',
    gitignore: 'Config', gitattributes: 'Config', editorconfig: 'Config', npmrc: 'Config', nvmrc: 'Config',
    gitkeep: 'Text', gitmodules: 'Config', envrc: 'Shell', htaccess: 'Config',
    babelrc: 'Config', eslintrc: 'Config', prettierrc: 'Config', stylelintrc: 'Config',
    browserslistrc: 'Config', dockerignore: 'Docker', justfile: 'Makefile',
    'poetry.lock': 'Lockfile', 'pipfile.lock': 'Lockfile', 'composer.lock': 'Lockfile',
    'gemfile.lock': 'Lockfile', 'pnpm-lock.yaml': 'Lockfile', 'uv.lock': 'Lockfile',
    'bun.lockb': 'Lockfile', 'mix.lock': 'Lockfile', 'bazelrc': 'Bazel'
  };

  const LANG_ORDER = ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java', 'C', 'C++', 'C#', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'Shell', 'HTML', 'CSS', 'Markdown', 'JSON', 'YAML', 'SQL'];
  const LANG_COLORS = ['#d99a3c', '#3b7dd8', '#3ca887', '#3c9fc4', '#d2603c', '#9a6cd0', '#7d8b99', '#cc5c72', '#5aa85f', '#c74a44', '#6a6cd4', '#a8b83c', '#c4609f', '#6f8f3c', '#d4693c', '#4a7fd4', '#8b9aa6', '#96a3ad', '#a8894a', '#b0723c'];
  /* Both a data value and a display sentinel — this is what tools/scan.js writes into the JSON, and
     three code paths branch on it. Never translate it; langText() maps it for the reader instead. */
  const OTHER_LANG = '其他';
  function hashOf(text) { let hash = 2166136261; for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
  function extensionOf(name) { const base = String(name).toLowerCase(); const dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(dot + 1) : ''; }

  function langFromName(name) {
    const base = String(name).toLowerCase();
    const bare = base.replace(/^\./, '');

    if (/^\.env(\b|$)/.test(base)) return 'Config';
    return LANG_BY_NAME[base] || LANG_BY_NAME[bare] || LANG_BY_EXT[extensionOf(base)] || LANG_BY_EXT[bare] || OTHER_LANG;
  }

  function langOf(node) { return node && node.lang ? node.lang : langFromName(node ? node.name : ''); }

  function langLabel(node) { const lang = langOf(node); if (lang !== OTHER_LANG) return lang; const ext = extensionOf(node.name); return ext ? `${OTHER_LANG} (.${ext})` : OTHER_LANG; }

  const OTHER_COLOR = '#22262a';
  function langColor(lang) {
    if (lang === OTHER_LANG) return OTHER_COLOR;
    const index = LANG_ORDER.indexOf(lang);
    return LANG_COLORS[(index >= 0 ? index : hashOf(String(lang))) % LANG_COLORS.length];
  }

  const SKIP_DIRS = ['node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.cache', '.parcel-cache', '.svelte-kit', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.gradle', '.terraform', 'coverage', 'dist', 'build', 'target', 'vendor', 'Pods', 'DerivedData', '.idea', '.vscode'];
  const SKIP_FILES = ['.ds_store', 'thumbs.db', 'desktop.ini'];
  function isIgnoredPath(parts) { const base = String(parts[parts.length - 1] || '').toLowerCase(); return SKIP_DIRS.includes(base) || SKIP_FILES.includes(base); }

  function toKb(bytes) { return Math.max(0.1, Math.round((Number(bytes) || 0) / 1024 * 10) / 10); }

  function treeFromEntries(entries, rootName, options) {
    const all = !!(options && options.all);
    const root = { name: String(rootName || 'project'), type: 'project', children: [] };

    const rootPath = normaliseRootPath(options && options.rootPath);
    if (rootPath) root.rootPath = rootPath;
    const dirs = new Map();
    for (const entry of entries) {
      const parts = String(entry.path || '').replace(/\\/g, '/').split('/').filter(Boolean);
      if (!parts.length || (!all && parts.some((_, index) => isIgnoredPath(parts.slice(0, index + 1))))) continue;
      const file = parts.pop();
      let parent = root, prefix = '';
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        let dir = dirs.get(prefix);
        if (!dir) { dir = { name: part, type: 'module', children: [] }; dirs.set(prefix, dir); parent.children.push(dir); }
        parent = dir;
      }
      parent.children.push({ name: file, type: 'file', size: toKb(entry.size), lang: langFromName(file), children: [] });
    }

    const prune = (node) => { node.children = node.children.filter((child) => child.type === 'file' || prune(child)); return node.children.length > 0; };
    prune(root);
    return root;
  }

  function normaliseRootPath(value) {
    if (typeof value !== 'string') return '';
    let text = value.trim().replace(/^file:\/\//i, '').replace(/^["']+|["']+$/g, '').trim();
    if (/^\/+[A-Za-z]:\//.test(text)) text = text.replace(/^\/+/, '');
    const trimmed = text.replace(/\\/g, '/').replace(/\/+$/, '');
    return trimmed || (text.startsWith('/') ? '/' : '');
  }

  function nodeRelPath(node) { const parts = []; for (let walk = node; walk && walk.parent; walk = walk.parent) parts.push(walk.name); return parts.reverse().join('/'); }
  function nodeAbsPath(node, rootPath) { const base = normaliseRootPath(rootPath); const relative = nodeRelPath(node); if (!base) return relative; if (!relative) return base; return base === '/' ? `/${relative}` : `${base}/${relative}`; }
  /* @model:pure:end */
  /* @graph:pure:start */

  const UNREADABLE_LANGS = new Set(['Binary', 'Image', 'Font', 'Database', 'Certificate', 'Source Map', 'Lockfile', 'Backup', 'Temp', 'Notebook']);

  const RELATION_MAX_BYTES = 512 * 1024;
  const LITERAL_MIN = 3;

  const RELATION_FANOUT_RATIO = .3;
  const RELATION_KINDS = ['import', 'shared'];

  const DIRECTED_KINDS = new Set(['import']);
  function relationSource(lang, bytes) { return !UNREADABLE_LANGS.has(lang) && Number(bytes) <= RELATION_MAX_BYTES; }

  function normaliseLiteral(raw) {
    let text = raw;
    const scheme = text.indexOf('://');
    if (scheme > 0 && scheme < 12) { const slash = text.indexOf('/', scheme + 3); text = slash >= 0 ? text.slice(slash) : '/'; }
    if (text.length > 1) text = text.replace(/\/+$/, '');
    return text;
  }

  function stringLiterals(text) {
    const found = new Set();
    for (const match of text.matchAll(/["']([^"'\n\r]{3,160})["']/g)) {
      const raw = match[1];
      if (!/^[A-Za-z0-9_\-./:~%?&=+]+$/.test(raw)) continue;
      if (!/[/:_.-]/.test(raw)) continue;
      if (/^\d/.test(raw)) continue;
      const value = normaliseLiteral(raw);
      if (value.length >= LITERAL_MIN) found.add(value);
    }
    return found;
  }

  function importSpecifiers(text, lang) {
    const found = [];
    if (lang === 'Python') {
      for (const match of text.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+/gm)) found.push(match[1]);
      for (const match of text.matchAll(/^[ \t]*import[ \t]+([\w.]+)/gm)) found.push(match[1]);
    } else if (lang === 'JavaScript' || lang === 'TypeScript' || lang === 'Vue' || lang === 'Svelte') {
      for (const match of text.matchAll(/\bfrom[ \t]*['"]([^'"]+)['"]/g)) found.push(match[1]);
      for (const match of text.matchAll(/\brequire[ \t]*\([ \t]*['"]([^'"]+)['"]/g)) found.push(match[1]);
      for (const match of text.matchAll(/\bimport[ \t]*\([ \t]*['"]([^'"]+)['"]/g)) found.push(match[1]);
    }
    return found;
  }

  function importCandidates(base) { return [base, `${base}.py`, `${base}/__init__.py`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}.vue`, `${base}.svelte`, `${base}/index.js`, `${base}/index.ts`, `${base}/index.tsx`]; }
  function joinRelPath(dir, relative) { const parts = dir ? dir.split('/') : []; for (const segment of relative.split('/')) { if (!segment || segment === '.') continue; if (segment === '..') parts.pop(); else parts.push(segment); } return parts.join('/'); }

  function relativeBase(dir, spec) {
    const lead = /^\.+/.exec(spec)[0].length;
    const rest = spec[lead] === '/' ? spec.slice(lead) : `/${spec.slice(lead).split('.').join('/')}`;
    return joinRelPath(dir, '../'.repeat(Math.max(0, lead - 1)) + rest);
  }

  function resolveSpecifier(spec, fromPath, exists) {
    if (!spec || spec.startsWith('node:')) return null;
    const dir = fromPath.replace(/\/[^/]*$/, '');
    const bases = [];
    if (spec[0] === '.') bases.push(relativeBase(dir, spec));
    else if (/^[\w.]+$/.test(spec)) { const dotted = spec.split('.').join('/'); bases.push(joinRelPath(dir, dotted), dotted); }
    else return null;
    for (const base of bases) for (const candidate of importCandidates(base)) if (exists(candidate)) return candidate;
    return null;
  }

  function sharedWeight(users) { return 1 / (users - 1); }

  function buildRelations(files) {
    const paths = new Set(files.map((file) => file.path));
    const exists = (path) => paths.has(path);
    const imports = new Map(), literalUsers = new Map();
    for (const file of files) {
      for (const spec of importSpecifiers(file.text, file.lang)) {
        const target = resolveSpecifier(spec, file.path, exists);
        if (target && target !== file.path) { const key = `${file.path}\u0000${target}`; imports.set(key, (imports.get(key) || 0) + 1); }
      }
      for (const literal of stringLiterals(file.text)) { if (!literalUsers.has(literal)) literalUsers.set(literal, new Set()); literalUsers.get(literal).add(file.path); }
    }
    const fanoutCap = Math.max(3, Math.ceil(files.length * RELATION_FANOUT_RATIO));
    const shared = new Map(), dropped = [];
    for (const [literal, users] of literalUsers) {
      if (users.size < 2) continue;
      if (users.size > fanoutCap) { dropped.push([literal, users.size]); continue; }
      const list = [...users].sort(), weight = sharedWeight(list.length);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}\u0000${list[j]}`;
        if (!shared.has(key)) shared.set(key, { weight: 0, labels: [] });
        const edge = shared.get(key);
        edge.weight += weight;
        edge.labels.push({ literal, weight });
      }
    }
    const edges = [];
    for (const [key, count] of imports) { const [from, to] = key.split('\u0000'); edges.push({ from, to, kind: 'import', weight: count }); }
    for (const [key, edge] of shared) {
      const [from, to] = key.split('\u0000');

      const labels = edge.labels.sort((a, b) => b.weight - a.weight || a.literal.localeCompare(b.literal)).map((item) => item.literal);
      edges.push({ from, to, kind: 'shared', weight: Math.round(edge.weight * 100) / 100, labels });
    }
    return { edges, dropped };
  }

  function relationIndex(edges) {
    const index = new Map();
    for (const edge of edges || []) {
      if (!edge || !RELATION_KINDS.includes(edge.kind) || typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
      const directed = DIRECTED_KINDS.has(edge.kind);
      if (!index.has(edge.from)) index.set(edge.from, []);
      if (!index.has(edge.to)) index.set(edge.to, []);
      index.get(edge.from).push({ path: edge.to, kind: edge.kind, weight: edge.weight || 1, labels: edge.labels || [], dir: directed ? 'out' : null });
      index.get(edge.to).push({ path: edge.from, kind: edge.kind, weight: edge.weight || 1, labels: edge.labels || [], dir: directed ? 'in' : null });
    }
    return index;
  }
  /* @graph:pure:end */
  /* @layout:pure:start */
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  function typeColor(type) { return { project: '#e06b3c', module: '#178f89', file: '#d49b39' }[type] || '#708090'; }

  function formatSize(size) { const value = Number(size) || 0; if (value >= 1024) return `${(value / 1024).toFixed(1)} MB`; return `${Math.round(value * 10) / 10} KB`; }

  function effectiveSize(node) { if (typeof node.effSize === 'number') return node.effSize; const own = Number(node && node.size); if (Number.isFinite(own) && own > 0) { node.effSize = own; return own; } const total = (node && node.children ? node.children : []).reduce((sum, child) => sum + effectiveSize(child), 0); node.effSize = total > 0 ? total : 0; return node.effSize; }
  function fallbackPx(font) { const match = /(\d+(?:\.\d+)?)px/.exec(font); return match ? Number(match[1]) : 12; }
  function ascent(font) { const metrics = fontMetrics.get(font); return metrics ? metrics.ascent : fallbackPx(font) * .8; }
  function descent(font) { const metrics = fontMetrics.get(font); return metrics ? metrics.descent : fallbackPx(font) * .2; }

  function worstAt(sum, max, min, side) { const s2 = sum * sum, w2 = side * side; return Math.max(w2 * max / s2, s2 / (w2 * min)); }

  function preparedItems(children, rectArea) { const raw = children.map(effectiveSize); const total = raw.reduce((sum, value) => sum + value, 0); if (!(total > 0)) return children.map((child) => ({ node: child, raw: 0, floored: false, area: rectArea / children.length })); const minShare = Math.min(LAYOUT.minCell / Math.max(rectArea, 1), 1 / (children.length + 1)); const floorWeight = total * minShare; const items = children.map((child, index) => ({ node: child, raw: raw[index], floored: raw[index] < floorWeight, weight: Math.max(raw[index], floorWeight) })); const weightSum = items.reduce((sum, item) => sum + item.weight, 0); return items.map((item) => ({ node: item.node, raw: item.raw, floored: item.floored, area: item.weight / weightSum * rectArea })).sort((a, b) => b.area - a.area || b.raw - a.raw); }

  function squarify(items, x, y, width, height, out) { let rest = items, rx = x, ry = y, rw = width, rh = height; while (rest.length && rw > .01 && rh > .01) { const side = Math.min(rw, rh); let count = 1, sum = rest[0].area, max = rest[0].area, best = worstAt(sum, max, rest[0].area, side); while (count < rest.length) { const next = rest[count].area, nextSum = sum + next, candidate = worstAt(nextSum, max, next, side); if (candidate > best) break; sum = nextSum; best = candidate; count++; } const run = rest.slice(0, count); rest = rest.slice(count); if (rw >= rh) { const columnWidth = sum / rh; let cursor = ry; run.forEach((item) => { const cellHeight = item.area / sum * rh; out.push({ node: item.node, raw: item.raw, floored: item.floored, x: rx, y: cursor, width: columnWidth, height: cellHeight }); cursor += cellHeight; }); rx += columnWidth; rw -= columnWidth; } else { const rowHeight = sum / rw; let cursor = rx; run.forEach((item) => { const cellWidth = item.area / sum * rw; out.push({ node: item.node, raw: item.raw, floored: item.floored, x: cursor, y: ry, width: cellWidth, height: rowHeight }); cursor += cellWidth; }); ry += rowHeight; rh -= rowHeight; } } return out; }

  function boxMetrics(width, height) { return { inset: clamp(LAYOUT.insetCoef * Math.min(width, height), LAYOUT.insetMin, LAYOUT.insetMax) }; }
  function titleTier(height, width) { return height >= 78 && width >= 120 ? 0 : height >= 48 && width >= 76 ? 1 : height >= 30 && width >= 40 ? 2 : -1; }
  function metaTier(height, width) { return height >= 78 && width >= 110 ? 0 : height >= 44 && width >= 72 ? 1 : height >= 28 && width >= 50 ? 2 : -1; }
  const stackHeight = (lines) => lines.reduce((total, line) => total + line.lineHeight, 0) + (lines.length - 1) * LAYOUT.titleGap;
  function fitText(text, font, maxWidth, measure) { if (maxWidth < 12) return null; const key = `${font}|${Math.round(maxWidth)}|${text}`; if (textCache.has(key)) return textCache.get(key); let out; if (measure(text, font) <= maxWidth) out = text; else { let low = 0, high = text.length; while (low < high) { const mid = (low + high + 1) >> 1; if (measure(text.slice(0, mid) + '…', font) <= maxWidth) low = mid; else high = mid - 1; } out = low > 0 ? text.slice(0, low) + '…' : null; } if (textCache.size > 4000) textCache.clear(); textCache.set(key, out); return out; }

  /* shareText and metaText arrive already worded by the caller — this function decides which lines
     fit, never what they say. metaText deliberately has no default: a default would quietly keep
     Chinese in an English interface. */
  function planText(node, rect, shareText, pad, measure, reserve = 0, metaText) { const innerWidth = Math.max(0, rect.width - pad * 2), innerHeight = Math.max(0, rect.height - pad * 2); const titleIndex = titleTier(rect.height, rect.width), metaIndex = metaTier(rect.height, rect.width); if (titleIndex < 0 || innerWidth < 28 || innerHeight < 10) return []; const candidates = [{ key: 'name', font: TITLE_FONTS[titleIndex][0], lineHeight: TITLE_FONTS[titleIndex][1], text: node.name }]; if (metaIndex >= 0) { if (shareText) candidates.push({ key: 'share', font: META_FONTS[metaIndex][0], lineHeight: META_FONTS[metaIndex][1], text: shareText }); candidates.push({ key: 'meta', font: META_FONTS[metaIndex][0], lineHeight: META_FONTS[metaIndex][1], text: metaText }); } const budget = innerHeight - pad - reserve; while (candidates.length > 1 && stackHeight(candidates) > budget) candidates.pop(); if (stackHeight(candidates) > (candidates.length > 1 ? budget : innerHeight)) return [];
  const lines = []; let top = pad; for (const line of candidates) { let text; if (line.key === 'name') { text = fitText(line.text, line.font, innerWidth, measure); if (text === null) return []; } else { if (measure(line.text, line.font) > innerWidth) continue; text = line.text; } const baseline = top + ascent(line.font); lines.push({ key: line.key, font: line.font, lineHeight: line.lineHeight, text, x: pad, baseline, bottom: baseline + descent(line.font) }); top += line.lineHeight + LAYOUT.titleGap; } return lines; }

  function layoutChildren(node, x, y, width, height) { const children = node.children; if (!children.length) return []; const only = children.length === 1; return squarify(preparedItems(children, Math.max(1, width * height)), x, y, width, height, []).map((box) => { const inset = boxMetrics(box.width, box.height).inset; const gutter = only ? 0 : inset; return { node: box.node, x: box.x + gutter, y: box.y + gutter, width: Math.max(1, box.width - gutter * 2), height: Math.max(1, box.height - gutter * 2), inset }; }); }

  function countMatches(node, matches) { return (matches(node) ? 1 : 0) + node.children.reduce((total, child) => total + countMatches(child, matches), 0); }

  function langTotals(node, totals = new Map()) { if (!node.children.length) { const key = langOf(node); totals.set(key, (totals.get(key) || 0) + effectiveSize(node)); return totals; } node.children.forEach((child) => langTotals(child, totals)); return totals; }
  function dominantLang(node) { let best = null, bestSize = -1; for (const [lang, size] of langTotals(node)) if (size > bestSize) { best = lang; bestSize = size; } return best; }

  function otherBreakdown(node, totals = new Map()) {
    if (!node.children.length) {
      if (langOf(node) === OTHER_LANG) { const ext = extensionOf(node.name); const key = ext ? `.${ext}` : node.name; totals.set(key, (totals.get(key) || 0) + effectiveSize(node)); }
      return totals;
    }
    node.children.forEach((child) => otherBreakdown(child, totals));
    return totals;
  }
  /* @layout:pure:end */
  /* @i18n:pure:start */
  const I18N = {
    zh: {

      appTitle: '代码地图',
      appDescription: 'Code Atlas：用一张图理解项目结构、规模和模块关系。',
      brandHome: '代码地图首页',
      searchPlaceholder: '搜索文件、模块...',
      searchLabel: '搜索项目节点',
      chooseFolder: '选择文件夹',
      importJson: '导入 JSON',
      removeDataset: '移除已导入的数据',
      langGroup: '界面语言',
      langZh: '中文界面',
      langEn: '英文界面',
      noProject: '还没有项目',
      noProjectHint: '导入项目后，这里会列出<br>规模、语言构成和目录结构',
      languagesHeading: '语言构成',
      structureHeading: '目录结构',
      expandAll: '展开全部',
      clickTip: '点击地图节点查看详情',
      viewHeading: '结构视图',
      backLabel: '返回上一级',
      zoomOut: '缩小',
      zoomIn: '放大',
      relationLayer: '关系图层',
      modeImport: '依赖',
      modeImportTitle: '谁 import 谁 —— 箭头指向被依赖的一方，两头都有箭头就是互相引用',
      modeShared: '共享',
      modeSharedTitle: '两个文件都提到的同一个名字 —— 数据契约',
      modeOff: '关',
      modeOffTitle: '关掉关系图层',
      reset: '重置',
      mapLabel: '项目结构可视化地图',
      noMatch: '没有匹配的节点',
      noMatchHint: '试试其他关键词',
      welcomeTitle: '导入一个项目',
      welcomeHint: '把项目文件夹或 JSON 文件拖到页面上，或者',
      welcomeJson: '选择 JSON',
      statusPreparing: '正在准备地图...',
      inspectorEmptyTitle: '选择一个节点',
      inspectorEmptyHint: '查看它的类型、规模和下属内容',

      typeProject: '项目',
      typeModule: '模块',
      typeFile: '文件',
      statSize: '规模',
      otherLang: '其他',
      notImported: '尚未导入数据',
      importedData: '导入的数据',
      unnamedProject: '项目',
      nothingSelected: '未选择节点',
      dataSource: '数据来源：{name}',
      listSeparator: '、',
      moreKinds: '还有 {n} 种',
      otherLangs: '另有 {n} 种：{list}',
      fileProtocol: '以 file:// 打开无法读取数据文件 · 请运行 npm start，或点上方的「导入 JSON」选择本地文件',
      loadFailed: '无法读取 {path}（{message}）· 可点上方的「导入 JSON」选择本地文件',
      badJson: 'JSON 格式无法解析，请检查文件',
      noReadableFiles: '「{name}」里没有可显示的文件 —— 可能是空的，或者只有依赖与构建产物（node_modules、dist 等）',
      shareOf: '占项目 {pct}%',
      statusChildren: '{name} · {n} 个子节点',
      statusDrawn: ' · 已显示 {shown}/{total}，其余因深度或尺寸未绘制',
      groupImports: '依赖',
      groupImportsNote: '这个节点引用',
      groupImportedBy: '被依赖',
      groupImportedByNote: '引用这个节点',
      groupShares: '共享',
      groupSharesNote: '提到同一个名字',
      moreUnlisted: '另有 {n} 个未列出',
      relationsHeading: '关系',
      nFiles: '{n} 个文件',
      locationHeading: '位置',
      codeSize: '代码规模',
      childCount: '子节点',
      depthLabel: '层级',
      mainLanguage: '主要语言',
      languageLabel: '语言',
      containsHeading: '包含内容',
      nothingInside: '暂无下属内容',
      copy: '复制',
      copyPathTitle: '复制项目相对路径',
      openInEditor: '在 VS Code 中打开',
      changePath: '更改路径',
      changePathTitle: '这个链接由项目根路径拼出来，路径不对就点这里改',
      setRootPath: '设置项目根路径',
      rootPathHint: '这份数据没有记录项目根路径，所以拼不出文件在磁盘上的位置。扫描时带上它，或在这里设置一次（会记住）。',
      openNothingSelected: '先选中一个节点，再打开它的源码',
      openContainer: '「{name}」是容器，没有源码文件可打开 · 选中一个文件，或在右侧展开它',
      openNoRoot: '这份数据没有记录项目根路径，拼不出文件位置 · 让扫描器带上它，或在右侧点「设置项目根路径」',
      promptPath: '「{name}」在磁盘上的完整路径',
      promptNote: '（只在本地使用，用来拼出文件的绝对位置。粘贴也行 —— 资源管理器「复制路径」带的引号会自动去掉）',
      promptGuess: '预填的是上次项目所在目录 + 这个文件夹名，不对就改掉',
      rootPathCleared: '已清除项目根路径',
      copied: '已复制 {text}',
      copyBlocked: '浏览器不允许自动复制 · 路径就显示在右侧，可以手动选中'
    },
    en: {
      appTitle: 'Code Atlas',
      appDescription: 'Code Atlas: a project\'s structure, size and module relations in one picture.',
      brandHome: 'Code Atlas home',
      searchPlaceholder: 'Search files, modules...',
      searchLabel: 'Search project nodes',
      chooseFolder: 'Choose folder',
      importJson: 'Import JSON',
      removeDataset: 'Remove the imported data',
      langGroup: 'Interface language',
      langZh: 'Chinese interface',
      langEn: 'English interface',
      noProject: 'No project yet',
      noProjectHint: 'Once a project is open, this column lists<br>its size, languages and structure',
      languagesHeading: 'Languages',
      structureHeading: 'Structure',
      expandAll: 'Expand all',
      clickTip: 'Click a tile to see its details',
      viewHeading: 'Structure',
      backLabel: 'Up one level',
      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      relationLayer: 'Relation layer',
      modeImport: 'Imports',
      modeImportTitle: 'Who imports whom — the arrow points at the imported side, and an arrow at each end is a cycle',
      modeShared: 'Shares',
      modeSharedTitle: 'A name two files both mention — a data contract',
      modeOff: 'Off',
      modeOffTitle: 'Turn the relation layer off',
      reset: 'Reset',
      mapLabel: 'Treemap of the project structure',
      noMatch: 'No matching node',
      noMatchHint: 'Try another search term',
      welcomeTitle: 'Import a project',
      welcomeHint: 'Drop a project folder or a JSON file onto the page, or',
      welcomeJson: 'Choose JSON',
      statusPreparing: 'Preparing the map...',
      inspectorEmptyTitle: 'Select a node',
      inspectorEmptyHint: 'Its type, size and contents show up here',
      typeProject: 'Project',
      typeModule: 'Module',
      typeFile: 'File',
      statSize: 'Size',
      otherLang: 'Other',
      notImported: 'Nothing imported yet',
      importedData: 'Imported data',
      unnamedProject: 'Project',
      nothingSelected: 'Nothing selected',
      dataSource: 'Source: {name}',
      listSeparator: ', ',
      moreKinds: '{n} more',
      otherLangs: '{n} more: {list}',
      fileProtocol: 'A page opened over file:// cannot fetch a data file · run npm start, or use Import JSON above',
      loadFailed: 'Could not read {path} ({message}) · use Import JSON above to pick a local file instead',
      badJson: 'That JSON could not be parsed — check the file',
      noReadableFiles: 'No displayable file in "{name}" — it may be empty, or hold nothing but dependencies and build output (node_modules, dist and the like)',
      shareOf: '{pct}% of project',
      statusChildren: '{name} · {n} child nodes',
      statusDrawn: ' · showing {shown}/{total}, the rest too deep or too small to draw',
      groupImports: 'Imports',
      groupImportsNote: 'this node imports',
      groupImportedBy: 'Imported by',
      groupImportedByNote: 'imports this node',
      groupShares: 'Shares',
      groupSharesNote: 'mentions a name in common',
      moreUnlisted: '{n} more not listed',
      relationsHeading: 'Relations',
      nFiles: '{n} files',
      locationHeading: 'Location',
      codeSize: 'Code size',
      childCount: 'Children',
      depthLabel: 'Depth',
      mainLanguage: 'Main language',
      languageLabel: 'Language',
      containsHeading: 'Contains',
      nothingInside: 'Nothing inside',
      copy: 'Copy',
      copyPathTitle: 'Copy the project-relative path',
      openInEditor: 'Open in VS Code',
      changePath: 'Change path',
      changePathTitle: 'This link is built from the project root path — fix it here if it is wrong',
      setRootPath: 'Set the project root path',
      rootPathHint: 'This dataset records no project root path, so there is no absolute location to build a link from. Scan with it, or set it here once — it is remembered.',
      openNothingSelected: 'Select a node first, then open its source',
      openContainer: '"{name}" is a container and has no source file to open · select one of the files inside it',
      openNoRoot: 'This dataset records no project root path, so there is no file to open · scan it with the path, or use Set the project root path on the right',
      promptPath: 'The full path of "{name}" on disk',
      promptNote: '(Used locally to build absolute links. Pasting is fine — the quotes Explorer adds are stripped.)',
      promptGuess: 'Prefilled with the last project folder plus this folder name — correct it if wrong',
      rootPathCleared: 'Project root path cleared',
      copied: 'Copied {text}',
      copyBlocked: 'The browser blocked the copy · the path is in the panel on the right, select it by hand'
    }
  };
  /* @i18n:pure:end */
  const LANGS = ['zh', 'en'];

  function t(key, values) {

    const table = I18N[state.lang] || I18N.zh;
    const value = table[key];
    if (value === undefined) return key;
    return values ? value.replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match) : value;
  }

  function langText(label) {
    const text = String(label);
    if (text === OTHER_LANG) return t('otherLang');

    return text.startsWith(`${OTHER_LANG} (`) ? t('otherLang') + text.slice(OTHER_LANG.length) : text;
  }

  const TYPE_LABEL_KEYS = { project: 'typeProject', module: 'typeModule', file: 'typeFile' };
  function typeLabel(type) { return TYPE_LABEL_KEYS[type] ? t(TYPE_LABEL_KEYS[type]) : type; }

  const I18N_SLOTS = [['data-i18n', 'textContent'], ['data-i18n-html', 'innerHTML'], ['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-label', 'aria-label'], ['data-i18n-content', 'content']];
  function applyStaticText() {

    for (const [attribute, slot] of I18N_SLOTS) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        const value = t(element.getAttribute(attribute));
        if (slot === 'aria-label' || slot === 'content') element.setAttribute(slot, value);
        else element[slot] = value;
      }
    }
  }

  const LANG_KEY = 'codeAtlas.lang';
  function readLang() { try { return localStorage.getItem(LANG_KEY) || ''; } catch (_) { return ''; } }
  function rememberLang(value) { try { localStorage.setItem(LANG_KEY, value); } catch (_) {  } }
  function browserLang() { return /^zh/i.test(String(navigator.language || '')) ? 'zh' : 'en'; }

  function initialLang() {
    const requested = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(requested)) return { lang: requested, remember: false };
    const remembered = readLang();
    if (LANGS.includes(remembered)) return { lang: remembered, remember: false };
    return { lang: browserLang(), remember: true };
  }

  function setDocumentLang() { document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en'; }
  function setLang(lang) {
    const next = LANGS.includes(lang) ? lang : 'zh';
    if (next === state.lang) return;
    state.lang = next;
    setDocumentLang();
    rememberLang(state.lang);
    applyStaticText();
    renderAll();
  }
  function pathOf(node) { return node ? [...pathOf(node.parent), node] : []; }

  function findNode(id) { return nodesById[id]; }

  const ROOT_PATH_KEY = 'codeAtlas.rootPath';
  const ROOT_HISTORY_KEY = 'codeAtlas.rootHistory';
  /* Storage is best-effort throughout: a browser that refuses it must not stop the viewer working. */
  function readRootPathMemory() { try { return JSON.parse(localStorage.getItem(ROOT_PATH_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function rememberedRootPath(label) { return normaliseRootPath(readRootPathMemory()[label]); }
  function rememberRootPath(label, value) { try { const all = readRootPathMemory(); if (value) all[label] = value; else delete all[label]; localStorage.setItem(ROOT_PATH_KEY, JSON.stringify(all)); } catch (_) {  } }

  function readRootHistory() { try { const parsed = JSON.parse(localStorage.getItem(ROOT_HISTORY_KEY) || '[]'); return Array.isArray(parsed) ? parsed.filter((path) => typeof path === 'string' && path) : []; } catch (_) { return []; } }
  function rememberRootHistory(value) { try { localStorage.setItem(ROOT_HISTORY_KEY, JSON.stringify([value, ...readRootHistory().filter((path) => path !== value)].slice(0, 6))); } catch (_) {  } }

  function rootPathGuess(label) {
    const history = readRootHistory();
    const sameName = history.find((path) => path.split('/').pop() === label);
    if (sameName) return sameName;
    const last = history[0];
    if (!last || !label || !last.includes('/')) return '';
    const parent = last.replace(/\/[^/]*$/, '');
    return parent && parent !== '/' ? `${parent}/${label}` : '';
  }

  function editorUri(node, rootPath = state.rootPath) {
    if (!node || node.children.length) return null;
    const base = normaliseRootPath(rootPath);
    if (!base) return null;
    const absolute = nodeAbsPath(node, base);
    return absolute && absolute !== base ? `vscode://file/${encodeURI(absolute)}` : null;
  }
  function load(data, label) {
    nodesById = [];
    state.root = normalize(data);

    state.byPath = new Map();
    const indexPath = (node) => { state.byPath.set(nodeRelPath(node), node); node.children.forEach(indexPath); };
    indexPath(state.root);
    state.relations = relationIndex(data && data.relations);
    state.current = state.root;
    state.selected = state.root;
    state.expanded = new Set([state.root]);
    state.datasetLabel = label || t('importedData');
    state.rootPath = normaliseRootPath(data && data.rootPath) || rememberedRootPath(state.datasetLabel);

    if (state.rootPath) rememberRootHistory(state.rootPath);
    state.query = '';
    state.zoom = 1;
    state.offset = { x: 0, y: 0 };
    $('search').value = '';
    setNotice('');
    renderAll();
  }

  function unload() { nodesById = []; state.root = null; state.current = null; state.selected = null; state.expanded = new Set(); state.nodes = []; state.datasetLabel = ''; state.rootPath = ''; state.query = ''; state.zoom = 1; state.offset = { x: 0, y: 0 }; state.relations = new Map(); state.byPath = new Map(); $('search').value = ''; setNotice(''); renderAll(); }
  function setTextEnabled(value) { textEnabled = value; draw(); }

  function renderRelationToggle() {
    const host = $('relation-toggle');
    host.hidden = !state.root || state.relations.size === 0;
    for (const button of host.querySelectorAll('[data-relation-mode]')) button.classList.toggle('active', button.dataset.relationMode === state.relationMode);
  }
  function setDebugColors(value) { debugColors = value; draw(); }

  function setHeadsEnabled(value) { headsEnabled = value; draw(); }
  const ZOOM_MIN = .35, ZOOM_MAX = 8, ZOOM_STEP = 1.25;
  function setZoom(next, anchorX, anchorY) {
    const clamped = clamp(next, ZOOM_MIN, ZOOM_MAX);
    if (clamped === state.zoom) return;

    if (anchorX !== undefined) {
      const rect = canvas.getBoundingClientRect();
      const vx = anchorX - rect.left - rect.width / 2, vy = anchorY - rect.top - rect.height / 2;
      const ratio = clamped / state.zoom;
      state.offset.x = vx - (vx - state.offset.x) * ratio;
      state.offset.y = vy - (vy - state.offset.y) * ratio;
    }
    state.zoom = clamped;
    $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
    hideTooltip();
    draw();
  }
  function changeZoom(factor) { setZoom(state.zoom * factor); }

  window.__codeAtlas = { state, LAYOUT, layoutChildren, planText, boxMetrics, countMatches, effectiveSize, measureTextWidth, draw, setTextEnabled, setDebugColors, setHeadsEnabled, langOf, langColor, langFromName, langLabel, langTotals, dominantLang, otherBreakdown, treeFromEntries, nodeKind, formatSize, normalize, LANG_ORDER, LANG_COLORS, NODE_TYPES, SKIP_DIRS, changeZoom, setZoom, OTHER_COLOR, ZOOM_MIN, ZOOM_MAX, nodeRelPath, nodeAbsPath, normaliseRootPath, editorUri, openInEditor, load, rootPathGuess, buildRelations, relationIndex, relationSource, stringLiterals, importSpecifiers, resolveSpecifier, relationTargets, relationPartners, drawRelations, renderRelationToggle, select, RELATION_COLORS, RELATION_MAX_BYTES, UNREADABLE_LANGS, setLang, I18N, LANGS, langText, t, applyStaticText, typeLabel };

  function setNotice(text) { const el = $('notice'); el.textContent = text || ''; el.hidden = !text; }

  async function init() { const requested = new URLSearchParams(location.search).get('data'); if (requested) { if (location.protocol === 'file:') { setNotice(t('fileProtocol')); } else { try {  const response = await fetch(requested); if (!response.ok) throw new Error(`HTTP ${response.status}`); load(await response.json(), requested.split('/').pop()); } catch (error) { setNotice(t('loadFailed', { path: requested, message: error.message })); } } } primeFontMetrics(); renderAll(); Promise.all(LADDER_FONTS.map(([font]) => document.fonts.load(font))).then(() => document.fonts.ready).then(() => { fontMetrics.clear(); textCache.clear(); primeFontMetrics(); draw(); }).catch(() => {}); }
  const INSPECTOR_EMPTY = () => `<div class="col-empty"><span class="col-empty-glyph">◎</span><strong>${escapeHtml(t('inspectorEmptyTitle'))}</strong><p>${escapeHtml(t('inspectorEmptyHint'))}</p></div>`;

  function renderLangToggle() { for (const button of $('lang-toggle').querySelectorAll('[data-lang]')) button.classList.toggle('active', button.dataset.lang === state.lang); }
  function renderAll() { const loaded = !!state.root; renderLangToggle(); $('welcome').hidden = loaded; $('dataset-chip').hidden = !loaded;  $('sidebar').classList.toggle('is-empty', !loaded); if (loaded) {  $('dataset-name').textContent = state.root.name; $('dataset-chip').title = state.datasetLabel ? t('dataSource', { name: state.datasetLabel }) : ''; } renderOverview(); renderLanguages(); renderTree(); renderBreadcrumbs(); renderInspector(); renderLegend(); renderRelationToggle(); draw(); }

  function renderLanguages() {
    const host = $('languages');
    if (!state.root) { host.innerHTML = ''; return; }
    const rows = [...langTotals(state.root)].sort((a, b) => b[1] - a[1]);
    const total = effectiveSize(state.root);
    const shown = rows.slice(0, 12), rest = rows.slice(12);

    const detail = () => {
      const items = [...otherBreakdown(state.root)].sort((a, b) => b[1] - a[1]);
      if (!items.length) return '';
      const top = items.slice(0, 5), more = items.length - top.length;
      return `<div class="lang-detail">${top.map(([ext, size]) => `<span><b>${escapeHtml(ext)}</b> ${formatSize(size)}</span>`).join('')}${more > 0 ? `<span>${escapeHtml(t('moreKinds', { n: more }))}</span>` : ''}</div>`;
    };
    host.innerHTML = shown.map(([lang, size]) => { const share = total > 0 ? size / total * 100 : 0; const color = langColor(lang); return `<div class="lang-row" data-lang="${escapeHtml(lang)}"><div class="lang-head"><i class="lang-chip" style="background:${color}"></i><b>${escapeHtml(langText(lang))}</b><span>${share.toFixed(1)}%</span></div><div class="lang-bar"><i style="width:${Math.max(1, share).toFixed(1)}%;background:${color}"></i></div></div>` + (lang === OTHER_LANG ? detail() : ''); }).join('')

      /* data-langs is read by a data-only check, so it joins on a comma; the visible line beside it
         uses the language's own list separator. A display character must not decide a data format. */
      + (rest.length ? `<p class="lang-more" data-langs="${escapeHtml(rest.map(([lang]) => lang).join(','))}">${escapeHtml(t('otherLangs', { n: rest.length, list: rest.map(([lang, size]) => `${langText(lang)} ${(total > 0 ? size / total * 100 : 0).toFixed(1)}%`).join(t('listSeparator')) }))}</p>` : '');
  }

  function renderLegend() {
    const host = $('legend');
    if (!state.root) { host.innerHTML = ''; return; }
    const rows = [...langTotals(state.root)].sort((a, b) => b[1] - a[1]);
    const shown = rows.slice(0, 5);
    host.innerHTML = `<span><i class="dot project"></i>${escapeHtml(t('typeProject'))}</span><span><i class="dot module"></i>${escapeHtml(t('typeModule'))}</span>`
      + shown.map(([lang]) => `<span><i class="dot" style="background:${langColor(lang)}"></i>${escapeHtml(langText(lang))}</span>`).join('')
      + (rows.length > shown.length ? `<span>+${rows.length - shown.length}</span>` : '');
  }
  function renderOverview() { if (!state.root) { $('stats').innerHTML = ''; return; } $('stats').innerHTML =[[t('typeProject'), count(state.root, 'project')], [t('typeModule'), count(state.root, 'module')], [t('typeFile'), count(state.root, 'file')], [t('statSize'), formatSize(effectiveSize(state.root))]].map(([label, value]) => `<div class="stat"><b>${value}</b><span>${escapeHtml(label)}</span></div>`).join(''); }
  function renderTree() { if (!state.root) { $('tree').innerHTML = `<p class="tree-empty">${escapeHtml(t('notImported'))}</p>`; return; } const walk = (node) => { const active = node === state.current ? ' active' : ''; const hasChildren = node.children.length > 0; const open = state.expanded.has(node); const row = `<button class="tree-row${active}" data-node="${node.id}" style="padding-left:${5 + node.depth * 13}px"><span class="tree-icon">${hasChildren ? (open ? '⌄' : '›') : '·'}</span><span>${escapeHtml(node.name)}</span></button>`; return row + (hasChildren && open ? node.children.map(walk).join('') : ''); }; $('tree').innerHTML = walk(state.root); }

  function renderBreadcrumbs() { if (!state.current) { $('breadcrumbs').innerHTML = ''; return; } const trail = pathOf(state.current).slice(1); $('breadcrumbs').innerHTML = trail.map((node, index) => `<button class="crumb" data-node="${node.id}">${escapeHtml(node.name)}${index < trail.length - 1 ? ' /' : ''}</button>`).join(''); }

  function relationsSection(node) {
    const partners = relationPartners(node);
    if (!partners.length) return '';

    const groups = [
      { key: 'out', title: t('groupImports'), note: t('groupImportsNote'), entries: partners.filter((entry) => entry.out > 0), count: (entry) => entry.out },
      { key: 'in', title: t('groupImportedBy'), note: t('groupImportedByNote'), entries: partners.filter((entry) => entry.in > 0), count: (entry) => entry.in },
      { key: 'shared', title: t('groupShares'), note: t('groupSharesNote'), entries: partners.filter((entry) => entry.mutual > 0), count: (entry) => entry.mutual }
    ].filter((group) => group.entries.length);
    const body = groups.map((group) => {
      const shown = group.entries.slice(0, 8), rest = group.entries.length - shown.length;
      const items = shown.map((entry) => {
        const times = group.count(entry);
        const labels = entry.labels.length ? `<small>${escapeHtml(entry.labels.slice(0, 3).join(' · '))}${entry.labels.length > 3 ? ` +${entry.labels.length - 3}` : ''}</small>` : '';
        return `<button class="relation-item" type="button" data-node="${entry.node.id}" title="${escapeHtml(nodeRelPath(entry.node))}"><b>${escapeHtml(entry.node.name)}</b><span>${times > 1 ? `×${times}` : ''}</span>${labels}</button>`;
      }).join('');
      return `<div class="relation-group-title">${escapeHtml(group.title)}<span class="section-note">${escapeHtml(group.note)} · ${group.entries.length}</span></div>`
        + `<div class="relation-list">${items}</div>`
        + (rest > 0 ? `<p class="path-hint">${escapeHtml(t('moreUnlisted', { n: rest }))}</p>` : '');
    }).join('');
    return `<div class="inspect-section"><h3>${escapeHtml(t('relationsHeading'))} <span class="section-note">${escapeHtml(t('nFiles', { n: partners.length }))}</span></h3>${body}</div>`;
  }
  function locationSection(node) {
    const relative = nodeRelPath(node);
    const uri = editorUri(node);

    const open = uri
      ? `<div class="open-row"><a class="button open-source" id="open-source" href="${escapeHtml(uri)}" title="${escapeHtml(nodeAbsPath(node, state.rootPath))}">${escapeHtml(t('openInEditor'))}</a><button class="button-ghost" data-set-root="1" title="${escapeHtml(t('changePathTitle'))}">${escapeHtml(t('changePath'))}</button></div>`
      : `<button class="button-ghost" data-set-root="1">${escapeHtml(t('setRootPath'))}</button>`;
    const explanation = uri ? '' : `<p class="path-hint">${escapeHtml(t('rootPathHint'))}</p>`;
    return `<div class="inspect-section"><h3>${escapeHtml(t('locationHeading'))}</h3><div class="path-row"><code id="node-path">${escapeHtml(relative || node.name)}</code>`
      + `<button class="button-ghost copy-path" data-copy-path="1" title="${escapeHtml(t('copyPathTitle'))}">${escapeHtml(t('copy'))}</button></div>${open}${explanation}</div>`;
  }
  function renderInspector() { const node = state.selected; if (!node) { $('inspector').innerHTML = INSPECTOR_EMPTY(); $('selection-status').textContent = t('nothingSelected'); return; } const children = node.children.length ? node.children.map((child) => `<div class="child-item"><b>${escapeHtml(child.name)}</b><span>${escapeHtml(nodeKind(child))}</span></div>`).join('') : `<div class="child-item">${escapeHtml(t('nothingInside'))}</div>`; const language = node.children.length ? (dominantLang(node) || '—') : langLabel(node); $('inspector').innerHTML = `<div class="inspect-kicker">${escapeHtml(nodeKind(node))}</div><h2 class="inspect-title">${escapeHtml(node.name)}</h2><div class="inspect-meta"><div class="meta-cell"><small>${escapeHtml(t('codeSize'))}</small><b>${formatSize(effectiveSize(node))}</b></div><div class="meta-cell"><small>${escapeHtml(t('childCount'))}</small><b>${node.children.length}</b></div><div class="meta-cell"><small>${escapeHtml(t('depthLabel'))}</small><b>${node.depth}</b></div><div class="meta-cell"><small>${escapeHtml(node.children.length ? t('mainLanguage') : t('languageLabel'))}</small><b><i class="lang-chip" style="background:${langColor(language)}"></i>${escapeHtml(langText(language))}</b></div></div><div class="inspect-section"><h3>${escapeHtml(t('containsHeading'))}</h3><div class="child-list">${children}</div></div>${relationsSection(node)}${locationSection(node)}`; $('selection-status').textContent = `${nodeKind(node)} · ${node.name}`; }

  function hideTooltip() { $('tooltip').hidden = true; }
  function showTooltip(event, box) {
    const tip = $('tooltip'); const node = box.node;

    if (node === state.selected && state.relationLines.length) { tip.hidden = true; return; }
    const rootSize = state.root ? effectiveSize(state.root) : 0;
    const share = rootSize > 0 ? effectiveSize(node) / rootSize * 100 : 0;
    tip.innerHTML = `<b>${escapeHtml(node.name)}</b><span>${escapeHtml(nodeKind(node))} · ${formatSize(effectiveSize(node))} · ${escapeHtml(t('shareOf', { pct: share.toFixed(1) }))}</span>`;
    tip.hidden = false;
    const stage = $('stage').getBoundingClientRect();
    const width = tip.offsetWidth, height = tip.offsetHeight;

    tip.style.left = `${Math.max(6, Math.min(event.clientX - stage.left + 14, stage.width - width - 6))}px`;
    tip.style.top = `${Math.max(6, Math.min(event.clientY - stage.top + 18, stage.height - height - 6))}px`;
  }
  function useFont(font) { if (currentFont !== font) { context.font = font; currentFont = font; } }
  function measureTextWidth(text, font) { useFont(font); return context.measureText(text).width; }
  function primeFontMetrics() { for (const [font] of LADDER_FONTS) { const size = fallbackPx(font); useFont(font); const probe = context.measureText('Hg'); fontMetrics.set(font, { ascent: probe.fontBoundingBoxAscent || size * .8, descent: probe.fontBoundingBoxDescent || size * .2 }); } currentFont = ''; }
  function shareTextOf(node) { const total = effectiveSize(state.root); return t('shareOf', { pct: total > 0 ? (effectiveSize(node) / total * 100).toFixed(1) : '0' }); }

  function nodeKind(node) { return node.children.length ? typeLabel(node.type) : langText(langLabel(node)); }

  function drawRelations(focus, rect) {
    const boxes = new Map();
    for (const item of state.nodes) boxes.set(item.node, item);
    const source = boxes.get(focus.selected);
    if (!source) return;

    const lines = new Map();
    for (const target of focus.targets) {
      const attach = boxes.has(target.node) ? target.node : topBranchOf(target.node);
      if (!attach || attach === focus.selected) continue;
      if (!lines.has(attach)) lines.set(attach, { node: attach, weight: 0, edges: 0, out: 0, in: 0, exact: attach === target.node });
      const entry = lines.get(attach);
      entry.weight += target.weight;
      entry.edges += target.edges;

      entry.out += target.out;
      entry.in += target.in;
      if (attach === target.node) entry.exact = true;
    }
    if (!lines.size) return;
    const pivotX = rect.width / 2, pivotY = rect.height / 2;
    const toScreen = (x, y) => ({ x: (x - pivotX) * state.zoom + pivotX + state.offset.x, y: (y - pivotY) * state.zoom + pivotY + state.offset.y });
    const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

    const anchor = (box, toward) => {
      const from = centre(box);
      if (!box.node.children.length) return from;
      const dx = toward.x - from.x, dy = toward.y - from.y;
      if (!dx && !dy) return from;
      const halfW = box.width / 2 || 1, halfH = box.height / 2 || 1;
      const scale = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
      return { x: from.x + dx * scale, y: from.y + dy * scale };
    };

    const HEAD_AT = { far: .62, near: .38 };

    const arrow = (apex, back, size) => {
      const perpendicular = { x: -back.y, y: back.x };
      const tail = { x: apex.x + back.x * size, y: apex.y + back.y * size };
      const half = size * .5;
      context.beginPath();
      context.moveTo(apex.x, apex.y);
      context.lineTo(tail.x + perpendicular.x * half, tail.y + perpendicular.y * half);
      context.lineTo(tail.x - perpendicular.x * half, tail.y - perpendicular.y * half);
      context.closePath();
      context.fill();

      context.lineWidth = Math.max(1.2, Math.min(2.4, size * .16));
      context.strokeStyle = '#ffffff';
      context.stroke();
    };
    const color = RELATION_COLORS[state.relationMode];
    context.save();
    context.lineCap = 'round';
    for (const target of lines.values()) {
      const box = boxes.get(target.node);
      if (!box) continue;

      const near = anchor(source, centre(box));
      const far = anchor(box, centre(source));
      const from = toScreen(near.x, near.y);
      const to = toScreen(far.x, far.y);
      const middle = toScreen(centre(box).x, centre(box).y);
      const wide = Math.max(1, box.width * state.zoom), tall = Math.max(1, box.height * state.zoom);
      const dx = to.x - from.x, dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;

      const bow = Math.min(70, length * .18);
      const controlX = (from.x + to.x) / 2 - dy / length * bow;
      const controlY = (from.y + to.y) / 2 + dx / length * bow;

      const headOn = (t, toward) => {
        const u = 1 - t;
        const apex = { x: u * u * from.x + 2 * u * t * controlX + t * t * to.x, y: u * u * from.y + 2 * u * t * controlY + t * t * to.y };
        const tx = 2 * u * (controlX - from.x) + 2 * t * (to.x - controlX);
        const ty = 2 * u * (controlY - from.y) + 2 * t * (to.y - controlY);
        const len = Math.hypot(tx, ty) || 1;
        const sign = toward === 'far' ? 1 : -1;
        return { apex, back: { x: -tx / len * sign, y: -ty / len * sign } };
      };

      const stroke = Math.min(4.5, 1.8 + Math.log2(1 + target.weight) * .55);
      const opacity = Math.min(.95, .62 + Math.log2(1 + target.weight) * .1);
      context.globalAlpha = opacity;
      context.strokeStyle = color;
      context.lineWidth = stroke;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.quadraticCurveTo(controlX, controlY, to.x, to.y);
      context.stroke();

      const size = clamp(stroke * 4.6, 13, 20);
      const heads = { far: null, near: null };
      context.globalAlpha = Math.min(.95, .62 + Math.log2(1 + target.weight) * .1);
      context.fillStyle = color;
      if (headsEnabled) {
        if (target.out > 0) { const head = headOn(HEAD_AT.far, 'far'); arrow(head.apex, head.back, size); heads.far = { apex: head.apex, back: head.back, size, t: HEAD_AT.far }; }
        if (target.in > 0) { const head = headOn(HEAD_AT.near, 'near'); arrow(head.apex, head.back, size); heads.near = { apex: head.apex, back: head.back, size, t: HEAD_AT.near }; }
      }

      const corner = toScreen(box.x, box.y);
      context.lineWidth = 2;
      context.strokeStyle = color;
      context.strokeRect(corner.x + 1, corner.y + 1, Math.max(1, wide - 2), Math.max(1, tall - 2));

      if (!heads.near) {
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(from.x, from.y, 3.5, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = '#ffffff';
        context.stroke();
      }

      state.relationLines.push({
        node: target.node, exact: target.exact, weight: target.weight, from, to, out: target.out, in: target.in, heads,

        control: { x: controlX, y: controlY },

        mid: { x: middle.x, y: middle.y, w: wide, h: tall }
      });
    }
    context.restore();
  }
  function draw() { const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1; const backingWidth = Math.round(rect.width * ratio), backingHeight = Math.round(rect.height * ratio); if (canvas.width !== backingWidth || canvas.height !== backingHeight) { canvas.width = backingWidth; canvas.height = backingHeight; currentFont = ''; } context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height); context.textBaseline = 'alphabetic'; state.nodes = []; state.relationLines = []; nodeIndex = 0; if (!state.current) { $('empty-state').hidden = true; $('status').textContent = t('notImported'); return; } const matches = (node) => !state.query || node.name.toLowerCase().includes(state.query);  const focus = relationTargets();
    const lit = focus ? new Set([focus.selected, ...focus.targets.flatMap((target) => { const branch = topBranchOf(target.node); return branch && branch !== target.node ? [target.node, branch] : [target.node]; })]) : null; const margin = clamp(Math.min(rect.width, rect.height) * LAYOUT.marginRatio, 8, LAYOUT.marginMax); textQueue = []; context.save(); context.translate(rect.width / 2 + state.offset.x, rect.height / 2 + state.offset.y); context.scale(state.zoom, state.zoom); context.translate(-rect.width / 2, -rect.height / 2); const rootWidth = Math.max(1, rect.width - margin * 2), rootHeight = Math.max(1, rect.height - margin * 2); drawTree(state.current, margin, margin, rootWidth, rootHeight, boxMetrics(rootWidth, rootHeight).inset, 0, matches, state.zoom, lit); context.restore(); if (focus) drawRelations(focus, rect);  const pivotX = rect.width / 2, pivotY = rect.height / 2; for (const line of textQueue) { useFont(line.font); context.fillStyle = line.key === 'name' ? '#17202a' : '#708090'; context.fillText(line.text, (line.x - pivotX) * state.zoom + pivotX + state.offset.x, (line.y - pivotY) * state.zoom + pivotY + state.offset.y); } $('empty-state').hidden = !state.query || countMatches(state.root, matches) > 0; const subtree = 1 + descendants(state.current).length; $('status').textContent = t('statusChildren', { name: state.current.name, n: state.current.children.length }) + (state.nodes.length < subtree ? t('statusDrawn', { shown: state.nodes.length, total: subtree }) : ''); }

  /* Two things here are easy to undo by accident. Labels are queued and drawn LATER, outside the
     zoom transform, so they rasterise at true pixel size instead of being magnified as a bitmap.
     And a container keeps the plan its band was sized for while a leaf re-plans at screen size —
     letting a container grow a title on zoom would shove its children sideways. */
  function drawTree(node, x, y, width, height, inset, depth, matches, scale, lit) { const isLeaf = node.children.length === 0; const base = matches(node) && (!lit || lit.has(node)) ? 1 : LAYOUT.dimAlpha;  const color = isLeaf ? langColor(langOf(node)) : typeColor(node.type); const selected = node === state.selected; const debugColor = debugColors ? `rgb(255,${Math.floor(nodeIndex / 256) % 256},${nodeIndex % 256})` : null; nodeIndex++; const recurses = !isLeaf && depth < LAYOUT.maxDepth; const reserve = recurses ? LAYOUT.minContentH : 0; const shareText = isLeaf ? shareTextOf(node) : '';  const metaText = `${typeLabel(node.type)} · ${formatSize(effectiveSize(node))}`; const layoutLines = debugColor ? [] : planText(node, { x, y, width, height }, shareText, LAYOUT.labelPad, measureTextWidth, reserve, metaText); const band = layoutLines.length ? LAYOUT.labelPad + stackHeight(layoutLines) + LAYOUT.labelPad : inset;  const replanned = !debugColor && scale !== 1; const screenLines = replanned ? planText(node, { x, y, width: width * scale, height: height * scale }, shareText, LAYOUT.labelPad * scale, measureTextWidth, reserve * scale, metaText) : layoutLines; const lines = isLeaf ? screenLines : layoutLines;  const textUnit = isLeaf && replanned ? scale : 1;  state.nodes.push({ node, x, y, width, height, debugColor, lines, band }); if (debugColor) { context.globalAlpha = 1; context.fillStyle = debugColor; context.fillRect(x, y, width, height); } else { context.globalAlpha = base; context.fillStyle = '#ffffff'; context.fillRect(x, y, width, height); context.fillStyle = color;  context.globalAlpha = base * (isLeaf ? LAYOUT.leafTint : LAYOUT.blockTint); context.fillRect(x, y, width, height); if (!isLeaf) { context.globalAlpha = base * LAYOUT.bandTint; context.fillRect(x, y, width, band); } context.globalAlpha = base; const lineWidth = selected ? 3 : 1.5; if (selected || (width >= 6 && height >= 6)) { context.lineWidth = lineWidth; context.strokeStyle = color; context.strokeRect(x + lineWidth / 2, y + lineWidth / 2, Math.max(1, width - lineWidth), Math.max(1, height - lineWidth)); } if (textEnabled) for (const line of lines) textQueue.push({ x: x + line.x / textUnit, y: y + line.baseline / textUnit, text: line.text, font: line.font, key: line.key }); } if (recurses) { const contentWidth = width - inset * 2, contentHeight = height - band - inset; if (contentWidth >= LAYOUT.minContentW && contentHeight >= LAYOUT.minContentH) for (const box of layoutChildren(node, x + inset, y + band, contentWidth, contentHeight)) drawTree(box.node, box.x, box.y, box.width, box.height, box.inset, depth + 1, matches, scale, lit); } context.globalAlpha = 1; }
  function hit(event) { const rect = canvas.getBoundingClientRect(); const screenX = event.clientX - rect.left; const screenY = event.clientY - rect.top; const x = (screenX - rect.width / 2 - state.offset.x) / state.zoom + rect.width / 2; const y = (screenY - rect.height / 2 - state.offset.y) / state.zoom + rect.height / 2; return [...state.nodes].reverse().find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height); }

  function topBranchOf(node) {
    const root = state.current;
    if (!root || node === root) return null;
    let walk = node;
    while (walk.parent && walk.parent !== root) walk = walk.parent;
    return walk.parent === root ? walk : null;
  }

  function relationPartners(node) {
    if (!node || !state.relations.size) return [];
    const inside = new Set([node, ...descendants(node)]);
    const found = new Map();
    for (const file of inside) {
      for (const edge of state.relations.get(nodeRelPath(file)) || []) {
        const target = state.byPath.get(edge.path);
        if (!target || inside.has(target)) continue;
        if (!found.has(edge.path)) found.set(edge.path, { node: target, weight: 0, out: 0, in: 0, mutual: 0, labels: [] });
        const entry = found.get(edge.path);
        entry.weight += edge.weight;
        if (edge.dir === 'out') entry.out++;
        else if (edge.dir === 'in') entry.in++;
        else entry.mutual++;
        for (const label of edge.labels) if (!entry.labels.includes(label)) entry.labels.push(label);
      }
    }
    return [...found.values()].sort((a, b) => b.weight - a.weight);
  }

  function relationTargets() {
    const selected = state.selected;
    if (!selected || state.relationMode === 'off' || !state.relations.size) return null;
    const inside = new Set([selected, ...descendants(selected)]);
    const found = new Map();
    for (const file of inside) {
      for (const edge of state.relations.get(nodeRelPath(file)) || []) {
        if (edge.kind !== state.relationMode) continue;
        const target = state.byPath.get(edge.path);

        if (!target || inside.has(target)) continue;

        if (!topBranchOf(target)) continue;
        if (!found.has(target)) found.set(target, { node: target, weight: 0, edges: 0, out: 0, in: 0 });
        const entry = found.get(target);
        entry.weight += edge.weight;
        entry.edges++;
        if (edge.dir === 'out') entry.out++;
        else if (edge.dir === 'in') entry.in++;
      }
    }
    if (!found.size) return null;
    return { selected, targets: [...found.values()].sort((a, b) => b.weight - a.weight) };
  }
  function select(node) { state.selected = node; state.current = node.type === 'file' ? node.parent || node : node; state.expanded.add(node); renderAll(); }

  function openInEditor(node) {
    if (!node) { setNotice(t('openNothingSelected')); return; }
    const uri = editorUri(node);

    if (!uri) { setNotice(node.children.length ? t('openContainer', { name: node.name }) : t('openNoRoot')); return; }
    setNotice('');
    const link = $('open-link');
    link.href = uri;
    link.click();
  }

  /* Folder pickers and drag-and-drop cannot supply an absolute path — the browser's File API does
     not expose one — so that route has to ask for it. */
  function askForRootPath() {
    const guess = rootPathGuess(state.datasetLabel);
    const prefilled = state.rootPath || guess;
    const answer = window.prompt(`${t('promptPath', { name: state.datasetLabel })}\n`
      + t('promptNote')
      + (guess && !state.rootPath ? `\n${t('promptGuess')}` : ''), prefilled);
    if (answer === null) return;
    const next = normaliseRootPath(answer);
    state.rootPath = next;
    rememberRootPath(state.datasetLabel, next);
    if (next) rememberRootHistory(next);
    setNotice(next ? '' : t('rootPathCleared'));
    renderInspector();
  }
  function copyText(text) {

    const fallback = () => { const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(area); area.select(); let copied = false; try { copied = document.execCommand('copy'); } catch (_) { copied = false; } area.remove(); return copied; };
    const finish = (copied) => setNotice(copied ? t('copied', { text }) : t('copyBlocked'));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => finish(true), () => finish(fallback()));
    else finish(fallback());
  }
  function reset() { state.zoom = 1; state.offset = { x: 0, y: 0 }; state.query = ''; $('search').value = ''; $('zoom-label').textContent = '100%'; state.current = state.root; state.selected = state.root; renderAll(); }
  $('search').addEventListener('input', (event) => { state.query = event.target.value.trim().toLowerCase(); draw(); }); $('search').addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.target.value = ''; state.query = ''; draw(); } }); $('zoom-in').addEventListener('click', () => changeZoom(ZOOM_STEP)); $('zoom-out').addEventListener('click', () => changeZoom(1 / ZOOM_STEP));

    canvas.addEventListener('wheel', (event) => { if (!state.current) return; event.preventDefault(); setZoom(state.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), event.clientX, event.clientY); }, { passive: false }); $('reset-button').addEventListener('click', reset); $('relation-toggle').addEventListener('click', (event) => { const button = event.target.closest('[data-relation-mode]'); if (!button) return; state.relationMode = button.dataset.relationMode; renderRelationToggle(); draw(); }); $('back-button').addEventListener('click', () => { if (state.current.parent) { state.current = state.current.parent; state.selected = state.current; renderAll(); } }); $('expand-button').addEventListener('click', () => { descendants(state.root).forEach((node) => state.expanded.add(node)); renderTree(); }); $('import-button').addEventListener('click', () => $('file-input').click()); $('welcome-import').addEventListener('click', () => $('file-input').click()); $('folder-button').addEventListener('click', () => $('folder-input').click()); $('welcome-folder').addEventListener('click', () => $('folder-input').click()); $('remove-button').addEventListener('click', unload); $('lang-toggle').addEventListener('click', (event) => { const button = event.target.closest('[data-lang]'); if (button) setLang(button.dataset.lang); });
  const importFile = async (file) => { if (!file) return; try { load(JSON.parse(await file.text()), file.name); } catch (_) { setNotice(t('badJson')); } };

  async function readRelationCorpus(entries) {
    const picked = [];
    for (const entry of entries) {
      if (!entry.file) continue;
      const lang = langFromName(entry.path.split('/').pop());
      if (!relationSource(lang, entry.size)) continue;
      picked.push({ path: entry.path, lang, file: entry.file });
    }
    const texts = new Array(picked.length).fill(null);
    for (let start = 0; start < picked.length; start += 64) {
      const chunk = picked.slice(start, start + 64);
      const read = await Promise.all(chunk.map((item) => item.file.text().catch(() => null)));
      read.forEach((text, offset) => { texts[start + offset] = text; });
    }

    return picked.map((item, index) => ({ path: item.path, lang: item.lang, text: texts[index] })).filter((item) => typeof item.text === 'string' && !item.text.includes('\u0000'));
  }
  const importEntries = async (entries, rootName) => {
    const root = treeFromEntries(entries, rootName);
    if (!root.children.length) { setNotice(t('noReadableFiles', { name: rootName })); return; }
    const corpus = await readRelationCorpus(entries);
    if (corpus.length) root.relations = buildRelations(corpus).edges;
    load(root, rootName);
  };
  $('file-input').addEventListener('change', async (event) => { await importFile(event.target.files[0]); event.target.value = ''; });

  $('folder-input').addEventListener('change', async (event) => { const files = [...event.target.files]; event.target.value = ''; if (!files.length) return; const rootName = (files[0].webkitRelativePath || '').split('/')[0] || t('unnamedProject'); await importEntries(files.map((file) => ({ path: (file.webkitRelativePath || file.name).split('/').slice(1).join('/'), size: file.size, file })), rootName); });
  canvas.addEventListener('pointerleave', hideTooltip);

  function readAllEntries(reader) { return new Promise((resolve) => { const found = []; const step = () => reader.readEntries((batch) => { if (!batch.length) return resolve(found); found.push(...batch); step(); }, () => resolve(found)); step(); }); }
  async function collectEntry(entry, prefix, out) {
    if (entry.isFile) { const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null))); if (file) out.push({ path: prefix + entry.name, size: file.size, file }); return; }
    if (!entry.isDirectory || isIgnoredPath(`${prefix}${entry.name}`.split('/'))) return;
    const next = `${prefix}${entry.name}/`;
    for (const child of await readAllEntries(entry.createReader())) await collectEntry(child, next, out);
  }

  document.addEventListener('dragover', (event) => { event.preventDefault(); });
  document.addEventListener('drop', (event) => {
    event.preventDefault();

    const entries = [...(event.dataTransfer?.items || [])].map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)).filter(Boolean);
    const folders = entries.filter((entry) => entry.isDirectory);
    if (folders.length) { (async () => { const out = []; for (const folder of folders) await collectEntry(folder, '', out); await importEntries(out, folders[0].name); })(); return; }
    const file = event.dataTransfer?.files?.[0];
    if (file) importFile(file);
  });
  document.addEventListener('click', (event) => { const target = event.target.closest('[data-node]'); if (target) { const node = findNode(Number(target.dataset.node)); if (node) { state.current = node.type === 'file' ? node.parent : node; state.expanded.add(node); select(node); } return; } if (event.target.closest('[data-set-root]')) { askForRootPath(); return; } if (event.target.closest('[data-copy-path]')) { if (state.selected) copyText(nodeRelPath(state.selected)); } }); canvas.addEventListener('click', (event) => { if (state.dragging) return; const found = hit(event); if (event.detail === 1) state.clickNode = found ? found.node : null; if (found) select(found.node); });

  canvas.addEventListener('dblclick', () => { if (state.clickNode) openInEditor(state.clickNode); }); canvas.addEventListener('pointerdown', (event) => { state.dragging = false; state.dragStart = { x: event.clientX, y: event.clientY, ox: state.offset.x, oy: state.offset.y }; canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); }); canvas.addEventListener('pointermove', (event) => { if (state.dragStart) { const dx = event.clientX - state.dragStart.x; const dy = event.clientY - state.dragStart.y; if (Math.abs(dx) + Math.abs(dy) > 4) state.dragging = true; state.offset.x = state.dragStart.ox + dx; state.offset.y = state.dragStart.oy + dy; hideTooltip(); draw(); return; } const found = hit(event); if (found) showTooltip(event, found); else hideTooltip(); }); canvas.addEventListener('pointerup', () => { state.dragStart = null; canvas.classList.remove('dragging'); }); window.addEventListener('resize', draw); document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLElement && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable); if (event.key === 'Escape') { $('search').value = ''; state.query = ''; draw(); return; } if (typing) return; if (event.key === '0') reset(); if (event.key === 'Enter') { event.preventDefault(); openInEditor(state.selected); } });

  const boot = initialLang();
  state.lang = boot.lang;
  if (boot.remember) rememberLang(state.lang);
  setDocumentLang();
  applyStaticText();
  init();
})();
