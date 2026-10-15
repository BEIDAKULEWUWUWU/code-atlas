#!/usr/bin/env node

import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const FIXTURE = '.shot-fixture.json';

function parseArgs(argv) {
  const options = { out: join(ROOT, 'screenshots'), port: 8123, width: 1440, height: 900, cdp: Number(process.env.CDP_PORT || 9222) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') options.out = resolve(argv[++i]);
    else if (argv[i] === '--port') options.port = Number(argv[++i]);
    else if (argv[i] === '--width') options.width = Number(argv[++i]);
    else if (argv[i] === '--height') options.height = Number(argv[++i]);
  }
  return options;
}

let connection = null;

async function cdp(port) {
  if (connection) return connection;
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch (cause) {
    throw new Error(`nothing listening on port ${port}, so no screenshot can be taken.\n` +
      `Start headless Chrome first:\n\n` +
      `  chrome --headless=new --remote-debugging-port=${port} --user-data-dir=%TEMP%\\atlas-cdp --hide-scrollbars about:blank\n`, { cause });
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error(`Chrome is on port ${port} but has no page target — open a tab, or start it without --headless`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await new Promise((ok, fail) => { socket.addEventListener('open', ok); socket.addEventListener('error', fail); });
  const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); socket.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const bad = result.result?.exceptionDetails;
    if (bad) throw new Error(bad.exception?.description || bad.text);
    return result.result?.result?.value;
  };
  connection = { send, evaluate };
  return connection;
}

async function until(evaluate, expression, what, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await evaluate(expression).catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((ok) => setTimeout(ok, 100));
  }
}

async function shoot({ send, evaluate }, width, height, file) {

  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(file, Buffer.from(shot.result.data, 'base64'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = `http://127.0.0.1:${options.port}/viewer/index.html`;

  await mkdir(options.out, { recursive: true });
  const staged = async (dir, name) => {
    const staging = join(tmpdir(), `atlas-shot-${process.pid}.json`);
    await run(process.execPath, [join(ROOT, 'tools', 'scan.js'), dir, '--out', staging, '--name', name,
      '--ignore', basename(options.out), '--quiet'], { cwd: ROOT, maxBuffer: 1 << 26 });
    await writeFile(join(ROOT, FIXTURE), await readFile(staging));
    await unlink(staging);

    /* Pinned, not inherited: the README screenshots are Chinese, and the language a build machine's
       browser reports is not something this script controls. ?lang= is a view of one load only and
       is never written to storage, so running this does not change what the reader sees next time. */
    return `${url}?data=../${FIXTURE}&lang=zh`;
  };

  const browser = await cdp(options.cdp);
  const { evaluate } = browser;

  try {
    await browser.send('Page.navigate', { url: await staged(join(ROOT, 'samples', 'taskflow'), 'taskflow') });
    await until(evaluate, 'typeof window.__codeAtlas === "object" && !!window.__codeAtlas.state.root', 'the fixture to load');

    await until(evaluate, 'document.fonts.status === "loaded" && document.fonts.check("700 13px Manrope")', 'the webfonts');
    await evaluate('window.__codeAtlas.draw()');

    await evaluate('window.__codeAtlas.state.selected = null; window.__codeAtlas.state.relationMode = "off"; window.__codeAtlas.draw()');
    await shoot(browser, options.width, options.height, join(options.out, 'hero.png'));

    const shotUrl = await staged(join(ROOT, 'samples', 'taskflow'), 'taskflow');
    await browser.send('Page.navigate', { url: shotUrl });
    await until(evaluate, 'typeof window.__codeAtlas === "object" && !!window.__codeAtlas.state.root', 'taskflow to load');
    await until(evaluate, 'document.fonts.status === "loaded" && document.fonts.check("700 13px Manrope")', 'the webfonts');
    const pick = await evaluate(`(() => {
      const A = window.__codeAtlas;
      A.state.relationMode = 'import';
      /* state.nodes holds layout boxes, not nodes — each entry is { node, x, y, width, height, ... }.
         Reading .name off a box yields undefined, and the loop then silently finds nothing. */
      let best = null;
      for (const box of A.state.nodes) {
        if (box.node.children.length) continue;
        A.select(box.node);
        A.draw();
        const lines = A.state.relationLines;
        if (!lines.length) continue;
        /* The arrows are what the shot is about, so they outrank the lines; both ends on one line
           is the case worth showing, since an arrow at each end is the whole direction claim. */
        let arrows = 0, both = 0;
        for (const line of lines) {
          const heads = (line.heads.far ? 1 : 0) + (line.heads.near ? 1 : 0);
          arrows += heads;
          if (heads === 2) both++;
        }
        const rank = [both, arrows, lines.length];
        if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && (rank[1] > best.rank[1] || (rank[1] === best.rank[1] && rank[2] > best.rank[2])))) {
          best = { path: A.nodeRelPath(box.node), rank, lines: lines.length, arrows };
        }
      }
      return best && { path: best.path, lines: best.lines, arrows: best.arrows };
    })()`);
    if (!pick) throw new Error('taskflow has no relations at all — the relation screenshot would show an empty layer');

    await evaluate(`(() => {
      const A = window.__codeAtlas;
      const box = A.state.nodes.find((b) => A.nodeRelPath(b.node) === ${JSON.stringify(pick.path)});
      A.state.relationMode = 'import';
      A.select(box.node);
      A.draw();
    })()`);
    await shoot(browser, options.width, options.height, join(options.out, 'relations.png'));

    await browser.send('Page.navigate', { url: `${url}?lang=zh` });
    await until(evaluate, 'typeof window.__codeAtlas === "object"', 'the viewer');
    await until(evaluate, 'document.fonts.status === "loaded" && document.fonts.check("700 13px Manrope")', 'the webfonts');
    await shoot(browser, options.width, options.height, join(options.out, 'empty.png'));

    console.log(`wrote hero.png, relations.png, empty.png to ${options.out}`);
    console.log(`  relations shot is ${pick.path} (${pick.lines} lines, ${pick.arrows} arrows)`);
  } finally {
    await unlink(join(ROOT, FIXTURE)).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(`\x1b[31mFAIL\x1b[0m ${error.message}`); process.exit(1); });
