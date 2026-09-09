/**
 * Markup validation for every HTML file on the site.
 *
 *   npm run test:markup
 *
 * Three validators, because they disagree about what "valid" means and the
 * disagreements are the point:
 *
 *   parse5        Spec-level HTML5 parse errors. Catches the class of mistake
 *                 the browser silently recovers from — a stray `&`, an
 *                 unescaped attribute, a tag closed in the wrong order — which
 *                 renders fine today and breaks on the one browser that
 *                 recovers differently.
 *   Nu (vnu.jar)  The W3C validator, the same engine behind validator.w3.org.
 *                 Conformance rather than parsing: wrong attributes for an
 *                 element, bad ARIA, duplicate ids.
 *   html-validate Rules the other two do not carry, notably accessibility ones.
 *                 Two style-preference rules are switched off in
 *                 .htmlvalidate.js, each with its reason written down.
 *
 * Nothing here is shipped to the site.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const parse5 = require('parse5');

const ROOT = path.join(__dirname, '..');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

const SKIP_DIRS = new Set(['node_modules', '.git', '.pwtmp', 'assets']);

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

const FILES = walk(ROOT, []).sort();
const REL = FILES.map((f) => path.relative(ROOT, f));
let failures = 0;

/* ------------------------------------------------------- 1. parse5, in-process */

let parseErrors = 0;
for (let i = 0; i < FILES.length; i++) {
  const errs = [];
  parse5.parse(fs.readFileSync(FILES[i], 'utf8'), {
    sourceCodeLocationInfo: true,
    onParseError: (e) => errs.push(e),
  });
  if (errs.length) {
    parseErrors += errs.length;
    console.log(RED + '✗ ' + REL[i] + OFF);
    for (const e of errs.slice(0, 10)) {
      console.log('    line ' + e.startLine + ':' + e.startCol + '  ' + e.code);
    }
  }
}
if (parseErrors === 0) {
  console.log(GREEN + '✓' + OFF + ' parse5        ' + FILES.length + ' files, 0 HTML5 parse errors');
} else {
  failures++;
  console.log(RED + '✗ parse5        ' + parseErrors + ' parse errors' + OFF);
}

/* -------------------------------------------------------------- 2. Nu, vnu.jar */

const VNU = path.join(ROOT, 'node_modules', 'vnu-jar', 'build', 'dist', 'vnu.jar');
if (!fs.existsSync(VNU)) {
  failures++;
  console.log(RED + '✗ vnu           vnu.jar not found — run npm install' + OFF);
} else {
  try {
    execFileSync('java', ['-jar', VNU, '--errors-only', '--format', 'gnu', ...FILES], { stdio: 'pipe' });
    console.log(GREEN + '✓' + OFF + ' vnu (W3C)     ' + FILES.length + ' files, 0 conformance errors');
  } catch (err) {
    failures++;
    /* JAVA_TOOL_OPTIONS prints a line to stderr on every JVM start on some
       machines; it is not a validation finding, so it is filtered out. */
    const out = String(err.stderr || err.stdout || '')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('Picked up JAVA_TOOL_OPTIONS'))
      .join('\n');
    console.log(RED + '✗ vnu (W3C)' + OFF + '\n' + out);
  }
}

/* --------------------------------------------------------- 3. html-validate CLI */

const HV = path.join(ROOT, 'node_modules', '.bin', 'html-validate');
try {
  execFileSync(HV, FILES, { stdio: 'pipe' });
  console.log(GREEN + '✓' + OFF + ' html-validate ' + FILES.length + ' files, 0 violations ' + DIM + '(preset recommended)' + OFF);
} catch (err) {
  failures++;
  console.log(RED + '✗ html-validate' + OFF + '\n' + String(err.stdout || err.stderr || '').trim());
}

if (failures > 0) {
  console.log('\n' + RED + failures + ' of 3 validators failed.' + OFF);
  process.exit(1);
}
console.log('\nAll markup passed all three validators.');
