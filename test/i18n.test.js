/**
 * Translation-key check for the two bilingual pages.
 *
 *   npm run test:i18n
 *
 * The CV and the labs index are English-first with an EN/ID toggle. Both work by
 * stamping `data-i18n` (textContent) or `data-i18n-html` (innerHTML) on an
 * element and looking the key up in a dictionary in the same file.
 *
 * A key present in the markup but missing from the dictionary fails in the worst
 * possible way: nothing breaks in English, and the element goes BLANK the moment
 * a visitor presses the language button. No validator catches it, no assertion
 * suite covers it, and the English reader — which includes whoever is editing the
 * page — never sees it. It is found by a stranger, in the other language.
 *
 * So this checks five things per page:
 *   - every key used in the markup exists in the dictionary
 *   - every dictionary entry has a non-empty `en` AND a non-empty `id`
 *   - `data-i18n-html` and `data-i18n` keys do not overlap, since one is
 *     interpolated as markup and the other as text
 *   - the English in the markup MATCHES the dictionary's `en` for the same key.
 *     This is the sneakier version of the same bug and it has already happened here:
 *     the markup was reworded and the dictionary was not, so the page read correctly
 *     in English until someone pressed the language button, at which point it
 *     silently reverted to the previous wording — a stale claim, restored by a
 *     toggle, in the language the author does not read back.
 *   - dictionary entries that nothing references are reported, because a stale
 *     key is usually the fossil of markup that was reworded on one side only
 *
 * The dictionaries are object literals inside an inline <script>, not JSON, so
 * they are located by brace balance and evaluated. That is safe here and only
 * here: the input is two files in this repository, read from disk.
 *
 * Nothing in this file is shipped to the site.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');

const ROOT = path.join(__dirname, '..');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

/* Each page declares its dictionary under a different variable name, and the CV
   writes entries on one line while the labs index spreads them over three. Both
   are found the same way: locate the declaration, then balance braces. */
const PAGES = [
  { file: 'index.html', decl: /var\s+I18N\s*=\s*\{/ },
  { file: 'labs/index.html', decl: /var\s+I18N\s*=\s*\{/ },
  /* The hire page and the case studies share ../case/case.js, which reads
     window.PAGE_I18N instead of a local var. Their entries are written with
     backticks rather than quotes, which is why the brace walker below has to
     know about template literals — it silently mis-balanced on them before,
     and that is exactly how these pages went unchecked for so long. */
  { file: 'hire/index.html', decl: /window\.PAGE_I18N\s*=\s*\{/ },
  { file: 'case/bioage/index.html', decl: /window\.PAGE_I18N\s*=\s*\{/ },
  { file: 'case/radar-duit/index.html', decl: /window\.PAGE_I18N\s*=\s*\{/ },
  { file: 'case/cek-aman/index.html', decl: /window\.PAGE_I18N\s*=\s*\{/ },
  { file: 'case/penyidik/index.html', decl: /window\.PAGE_I18N\s*=\s*\{/ },
  { file: 'case/repbout/index.html', decl: /window\.PAGE_I18N\s*=\s*\{/ },
];

function extractDict(src, decl, rel) {
  const m = decl.exec(src);
  if (!m) throw new Error(rel + ': no dictionary declaration found');

  /* Balance from the opening brace of the literal, not from the match start. */
  const open = src.indexOf('{', m.index);
  let depth = 0;
  let end = -1;
  let inStr = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error(rel + ': dictionary literal is unbalanced');

  const literal = src.slice(open, end + 1);
  // eslint-disable-next-line no-eval
  return eval('(' + literal + ')');
}

let failures = 0;

for (const page of PAGES) {
  const full = path.join(ROOT, page.file);
  const src = fs.readFileSync(full, 'utf8');

  let dict;
  try {
    dict = extractDict(src, page.decl, page.file);
  } catch (err) {
    failures++;
    console.log(RED + '✗ ' + page.file + OFF + '  ' + err.message);
    continue;
  }

  const textKeys = new Set();
  const htmlKeys = new Set();
  for (const m of src.matchAll(/data-i18n="([^"]+)"/g)) textKeys.add(m[1]);
  for (const m of src.matchAll(/data-i18n-html="([^"]+)"/g)) htmlKeys.add(m[1]);
  const used = new Set([...textKeys, ...htmlKeys]);

  const declared = new Set(Object.keys(dict));
  const problems = [];

  for (const key of used) {
    if (!declared.has(key)) problems.push('markup key "' + key + '" is not in the dictionary — the element blanks on the ID toggle');
  }
  for (const key of declared) {
    const entry = dict[key];
    if (!entry || typeof entry.en !== 'string' || entry.en === '') problems.push('"' + key + '" has no en text');
    if (!entry || typeof entry.id !== 'string' || entry.id === '') problems.push('"' + key + '" has no id text');
  }
  for (const key of textKeys) {
    if (htmlKeys.has(key)) problems.push('"' + key + '" is used as both data-i18n and data-i18n-html; one is interpolated as markup and the other as text');
  }

  /* The markup IS the English source, so if it disagrees with the dictionary's en,
     one of the two is stale — and the toggle will serve the stale one. Whitespace
     is normalised because the markup wraps and the dictionary does not. */
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const doc = parse5.parse(src);
  const walk = (node, fn) => { fn(node); for (const c of node.childNodes || []) walk(c, fn); };
  walk(doc, (el) => {
    if (!el.attrs) return;
    const get = (n) => { const a = el.attrs.find((x) => x.name === n); return a ? a.value : null; };
    const textKey = get('data-i18n');
    const htmlKey = get('data-i18n-html');
    const key = textKey || htmlKey;
    if (!key || !dict[key] || typeof dict[key].en !== 'string') return;

    let rendered;
    if (htmlKey) {
      rendered = (el.childNodes || []).map((c) => parse5.serialize({ childNodes: [c] })).join('');
    } else {
      let acc = '';
      walk(el, (n) => { if (n.nodeName === '#text') acc += n.value; });
      rendered = acc;
    }
    if (norm(rendered) !== norm(dict[key].en)) {
      problems.push('"' + key + '" markup and dictionary en disagree — the toggle would serve the stale one' +
        '\n        markup: ' + norm(rendered).slice(0, 100) +
        '\n        dict  : ' + norm(dict[key].en).slice(0, 100));
    }
  });

  /* Some keys are never stamped on an element — the toggle reads them by name,
     and it does so through expressions a narrow pattern would miss, such as
     I18N[light ? 'theme.dark' : 'theme.light']. So rather than matching access
     forms, a key counts as referenced when its quoted name appears in the file
     more than once: the dictionary entry itself is the first occurrence, and any
     second one is a use. This can only under-report orphans, never invent a
     failure — and orphans are advisory anyway. */
  const occurrences = (k) => {
    let n = 0;
    let from = 0;
    for (;;) {
      const at = src.indexOf(k, from);
      if (at < 0) return n;
      n++;
      from = at + k.length;
    }
  };
  const orphans = [...declared].filter((k) => !used.has(k) && occurrences(k) <= 1);

  if (problems.length) {
    failures++;
    console.log(RED + '✗ ' + page.file + OFF);
    for (const p of problems) console.log('    ' + p);
  } else {
    console.log(
      GREEN + '✓' + OFF + ' ' + page.file.padEnd(16) +
      String(used.size).padStart(3) + ' keys in markup, ' + declared.size + ' in the dictionary, ' +
      'all with en + id' + (orphans.length ? DIM + '  (' + orphans.length + ' unreferenced: ' + orphans.join(', ') + ')' + OFF : '')
    );
  }
}

if (failures > 0) {
  console.log('\n' + RED + failures + ' page(s) have translation gaps.' + OFF);
  process.exit(1);
}
console.log('\nEvery translation key resolves in both languages.');
