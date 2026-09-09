/**
 * Syntax check for every line of JavaScript this site actually ships.
 *
 *   npm run test:syntax
 *
 * Two sources, because the site has two kinds of script. Files under /labs/ and
 * /case/ are loaded with <script src>, so `node --check` reads them directly.
 * The CV itself keeps its script inline in index.html, where a stray bracket is
 * invisible to every file-based tool — so the inline blocks are concatenated in
 * document order and checked as one program, which is how the browser sees them.
 *
 * Vendored bundles under /assets/ are excluded: they are third-party artefacts,
 * not code written here, and a syntax verdict on them says nothing useful.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

const SKIP_DIRS = new Set(['node_modules', '.git', '.pwtmp', 'assets']);

function walk(dir, ext, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/* Blocks with a src attribute are separate files and get checked on their own;
   only the inline ones need stitching together here. */
function inlineScripts(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    if (/\btype\s*=\s*["']?(?!text\/javascript|module)/i.test(m[1])) continue;
    blocks.push(m[2]);
  }
  return blocks;
}

let failures = 0;
let checked = 0;

/* ------------------------------------------------------------ .js on disk */

for (const file of walk(ROOT, '.js', []).sort()) {
  const rel = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked++;
  } catch (err) {
    failures++;
    console.log(RED + '✗ ' + rel + OFF + '\n' + String(err.stderr || err.stdout).trim());
  }
}
console.log(GREEN + '✓' + OFF + ' ' + checked + ' berkas .js lolos node --check');

/* --------------------------------------------------- inline <script> blocks */

for (const file of walk(ROOT, '.html', []).sort()) {
  const rel = path.relative(ROOT, file);
  const blocks = inlineScripts(fs.readFileSync(file, 'utf8'));
  if (blocks.length === 0) continue;

  const tmp = path.join(os.tmpdir(), 'inline-' + rel.replace(/[\\/]/g, '_') + '.js');
  fs.writeFileSync(tmp, blocks.join('\n;\n'));
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(GREEN + '✓' + OFF + ' ' + rel + ' ' + DIM + '(' + blocks.length + ' blok inline, digabung)' + OFF);
  } catch (err) {
    failures++;
    console.log(RED + '✗ ' + rel + ' (inline)' + OFF + '\n' + String(err.stderr || err.stdout).trim());
  } finally {
    fs.unlinkSync(tmp);
  }
}

if (failures > 0) {
  console.log('\n' + RED + failures + ' berkas gagal.' + OFF);
  process.exit(1);
}
console.log('\nSemua JavaScript lolos pemeriksaan sintaks.');
