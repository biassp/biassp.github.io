/**
 * Internal link and asset check.
 *
 *   npm run test:links
 *
 * The CV links out to /labs/ and /case/ with relative paths, and those pages
 * link back. A rename breaks them silently: GitHub Pages serves a 404 page that
 * nobody visits deliberately, so a dead portfolio link can sit there for months.
 * Nothing else in this repo would catch it.
 *
 * Checked here:
 *   - every relative href/src resolves to a file that exists on disk
 *     (a directory counts when it holds an index.html, which is how Pages
 *     serves it)
 *   - every same-page fragment (#id) has an element with that id
 *
 * External links are deliberately NOT fetched: a CI job that fails because
 * someone else's server is down is a job people learn to ignore.
 *
 * Nothing here is shipped to the site.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');

const ROOT = path.join(__dirname, '..');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

const SKIP_DIRS = new Set(['node_modules', '.git', '.pwtmp', 'assets']);
const EXTERNAL = /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/* parse5's tree is plain objects, so the walk is explicit rather than a
   querySelectorAll. It also means no DOM implementation is needed. */
function elements(node, out) {
  if (node.tagName) out.push(node);
  for (const child of node.childNodes || []) elements(child, out);
  return out;
}

function attr(el, name) {
  const found = (el.attrs || []).find((a) => a.name === name);
  return found ? found.value : null;
}

let broken = 0;
let checked = 0;
const FILES = walk(ROOT, []).sort();

for (const file of FILES) {
  const rel = path.relative(ROOT, file);
  const doc = parse5.parse(fs.readFileSync(file, 'utf8'), { sourceCodeLocationInfo: true });
  const els = elements(doc, []);
  const ids = new Set(els.map((el) => attr(el, 'id')).filter(Boolean));
  const problems = [];

  for (const el of els) {
    for (const name of ['href', 'src']) {
      const raw = attr(el, name);
      if (raw === null || raw === '') continue;
      if (EXTERNAL.test(raw)) continue;
      checked++;

      const [target, frag] = raw.split('#');

      /* A bare #id points inside this same document. */
      if (target === '') {
        if (frag && !ids.has(frag)) {
          problems.push(name + '="' + raw + '" → tidak ada elemen dengan id itu');
        }
        continue;
      }

      /* Absolute site paths are served from the repository root by Pages. */
      const base = target.startsWith('/') ? ROOT : path.dirname(file);
      let resolved = path.join(base, target.replace(/^\//, ''));
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        resolved = path.join(resolved, 'index.html');
      }
      if (!fs.existsSync(resolved)) {
        /* data-optional marks a figure that is meant to vanish when its image
           is not in the repository yet; case.js hides it at runtime. */
        if (attr(el, 'data-optional') !== null) continue;
        problems.push(name + '="' + raw + '" → ' + path.relative(ROOT, resolved) + ' tidak ada');
      }
    }
  }

  if (problems.length) {
    broken += problems.length;
    console.log(RED + '✗ ' + rel + OFF);
    for (const p of problems) console.log('    ' + p);
  }
}

console.log(
  (broken === 0 ? GREEN + '✓' : RED + '✗') + OFF +
  ' ' + checked + ' tautan internal diperiksa di ' + FILES.length + ' berkas, ' +
  broken + ' rusak ' + DIM + '(tautan eksternal sengaja tidak dihubungi)' + OFF
);

if (broken > 0) process.exit(1);
