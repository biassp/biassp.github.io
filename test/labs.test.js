/**
 * Headless runner for the in-page assertion suites that ship with every lab.
 *
 *   npm install            # dev-only; the labs themselves have zero dependencies
 *   npm run test:labs
 *
 * Each lab under /labs/ carries a tests.js that runs twice: once in the page,
 * driving the badge in its header, and once here. This file is the "once here".
 *
 * It loads the lab's real index.html in Chromium over a local static server —
 * not a hand-rebuilt script order under node — so the run also proves the page
 * boots at all: correct script order, no CSP violation, no console error. A lab
 * whose engine is green but whose page throws on load is still broken, and only
 * this route can see that.
 *
 * Nothing in here is shipped to the site.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

/* Every lab that ships assertions, with the entry point its tests.js exports.
   saku is absent on purpose: it is a PWA share-target demo, not an engine. */
const LABS = [
  { dir: 'rekam', call: 'REKAM.runTests()' },
  { dir: 'siakad', call: 'SIAKAD_TESTS.run()' },
  { dir: 'gudang', call: 'GUDANG_TESTS.run()' },
  { dir: 'payroll', call: 'PAYROLL_TESTS.run()' },
  { dir: 'buku', call: 'BUKU_TESTS.run()' },
  { dir: 'harvest', call: 'HARVEST.runTests()' },
  { dir: 'rombak', call: 'ROMBAK_TESTS.run()' },
  { dir: 'sahih', call: 'SAHIH_TESTS.run()' },
  { dir: 'serobot', call: 'SEROBOT_TESTS.run()' },
  { dir: 'sepakat', call: 'SEPAKAT_TESTS.run()' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* file:// gives an opaque origin, and every lab ships a CSP of script-src 'self'
   — which no file:// page can satisfy. So the pages are served over http from
   the working tree, the same way GitHub Pages serves them. */
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* CI installs the browser Playwright asks for, so nothing is set and the default
   applies. CHROMIUM_PATH is the escape hatch for a machine that already has a
   Chromium of a different build than this Playwright expects. */
function launchOptions() {
  const exe = process.env.CHROMIUM_PATH;
  return exe ? { executablePath: exe } : {};
}

async function main() {
  const { server, port } = await serve();
  const browser = await chromium.launch(launchOptions());
  let totalPassed = 0;
  let totalFailed = 0;
  let pagesBroken = 0;

  for (const lab of LABS) {
    const page = await browser.newPage();

    /* A console error or an unhandled rejection during load is a failure in its
       own right, even when every assertion afterwards passes. */
    const noise = [];
    page.on('console', (m) => { if (m.type() === 'error') noise.push('console: ' + m.text()); });
    page.on('pageerror', (e) => noise.push('pageerror: ' + (e && e.message)));

    /* Egress, policed at the network layer rather than by asking the page.
       This matters more than it looks: a <meta http-equiv="Content-Security-
       Policy"> does NOT reach a worker realm. Measured under the labs' own CSP,
       a fetch from the page is refused with connect-src 'none' while the
       IDENTICAL fetch from inside a worker resolves — silently, no console
       error, and nothing window.<DIR>_GUARD can see, because that object lives
       in the page realm only. Asking the workers directly does not work either:
       at the moment this runner checks, the lab's worker has not spawned yet,
       and by the time it has it has already terminated itself.
       page.on('request') sees every realm, needs no cooperation from the code
       under test, and cannot be fooled by an instrumented object that lies. */
    const egressed = [];
    const EGRESS_TYPES = new Set(['fetch', 'xhr', 'websocket', 'eventsource', 'ping']);
    page.on('request', (r) => {
      if (EGRESS_TYPES.has(r.resourceType())) egressed.push(r.resourceType() + ' ' + r.url());
    });

    const url = 'http://127.0.0.1:' + port + '/labs/' + lab.dir + '/';
    let out;
    try {
      await page.goto(url, { waitUntil: 'load' });
      out = await page.evaluate(lab.call);

      /* The egress claim, checked rather than eyeballed. Every lab wraps
         fetch/XHR/WebSocket/EventSource/sendBeacon and shows the count in its
         header; until now nothing proved it stayed at zero under CI. A lab with
         no guard object reports -1, which is not a failure — only a positive
         count is. */
      const guardName = lab.dir.toUpperCase() + '_GUARD';
      const egress = await page.evaluate(
        (g) => (window[g] ? window[g].total() : -1), guardName);
      if (egress > 0) noise.push('egress: ' + egress + ' network call(s) from ' + lab.dir);

      for (const e of egressed) noise.push('egress: ' + lab.dir + ' requested ' + e);
    } catch (err) {
      console.log(RED + '✗ ' + lab.dir + OFF + '  page failed to load: ' + err.message);
      pagesBroken++;
      await page.close();
      continue;
    }

    const failed = out.results.filter((r) => !r.ok);
    totalPassed += out.passed;
    totalFailed += out.failed;

    const ok = out.failed === 0 && noise.length === 0;
    console.log(
      (ok ? GREEN + '✓' : RED + '✗') + OFF + ' ' + lab.dir.padEnd(8) +
      String(out.passed).padStart(5) + ' passed, ' + out.failed + ' failed ' +
      DIM + '(' + out.total + ' assertions)' + OFF
    );
    for (const f of failed.slice(0, 20)) {
      console.log('    ' + RED + f.group + ' → ' + f.name + OFF + '\n      ' + f.message);
    }
    if (failed.length > 20) console.log('    ' + DIM + '… ' + (failed.length - 20) + ' more failures' + OFF);
    for (const n of noise) console.log('    ' + RED + n + OFF);
    if (noise.length) pagesBroken++;

    await page.close();
  }

  await browser.close();
  server.close();

  console.log('\n' + totalPassed + ' assertions passed, ' + totalFailed + ' failed, across ' + LABS.length + ' labs.');
  if (totalFailed > 0 || pagesBroken > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
