/**
 * Headless tests for the live GitHub repositories feed in index.html.
 *
 *   npm install jsdom          # dev-only; the site itself has zero dependencies
 *   node test/repos.test.js
 *
 * The real index.html is loaded and its inline scripts executed under jsdom;
 * only `fetch` and `localStorage` are stubbed. Nothing here is shipped.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(INDEX, 'utf8');

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const OFF = '\u001b[0m';

/* ---------------------------------------------------------------- fixtures */

const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

// Deliberately mixed: curated + uncurated, a null description, a fork, an
// archived repo, a private repo, the HIDE-listed profile repo, and a language
// that is absent from the colour map (Elixir) plus one with no language at all.
const PAYLOAD = [
  {
    name: 'skillpath', html_url: 'https://github.com/biassp/skillpath',
    description: 'e-learning', language: 'JavaScript',
    stargazers_count: 4, forks_count: 2, pushed_at: iso(3),
    topics: ['spa', 'vanilla-js', 'e-learning', 'ignored-fourth'],
    fork: false, archived: false, private: false,
  },
  {
    name: 'quran-online', html_url: 'https://github.com/biassp/quran-online',
    // GitHub's own text is intentionally wrong here: CURATED must win.
    description: 'GITHUB TEXT SHOULD LOSE', language: 'JavaScript',
    stargazers_count: 1, forks_count: 0, pushed_at: iso(40),
    topics: [], fork: false, archived: false, private: false,
  },
  {
    name: 'aplikasi-pengarsipan-surat-php',
    html_url: 'https://github.com/biassp/aplikasi-pengarsipan-surat-php',
    description: null, language: 'PHP',
    stargazers_count: 0, forks_count: 1, pushed_at: iso(200),
    topics: ['php'], fork: false, archived: false, private: false,
  },
  {
    // uncurated + GitHub has a description -> title from slug, desc from GitHub
    name: 'radar-duit', html_url: 'https://github.com/biassp/radar-duit',
    description: 'Personal finance tracker for daily spending.', language: 'Dart',
    stargazers_count: 2, forks_count: 0, pushed_at: iso(10),
    topics: ['flutter'], fork: false, archived: false, private: false,
  },
  {
    // uncurated + description null -> placeholder sentence
    name: 'cek-aman', html_url: 'https://github.com/biassp/cek-aman',
    description: null, language: 'Elixir',
    stargazers_count: 0, forks_count: 0, pushed_at: iso(400),
    topics: [], fork: false, archived: false, private: false,
  },
  {
    // uncurated, no language at all -> falls into the "Other" chip
    name: 'dotfiles-backup', html_url: 'https://github.com/biassp/dotfiles-backup',
    description: 'Shell config backup.', language: null,
    stargazers_count: 0, forks_count: 0, pushed_at: iso(5),
    topics: [], fork: false, archived: false, private: false,
  },
  /* --- everything below must be filtered out --- */
  {
    name: 'someone-elses-lib', html_url: 'https://github.com/biassp/someone-elses-lib',
    description: 'A fork.', language: 'Go', stargazers_count: 999, forks_count: 999,
    pushed_at: iso(1), topics: [], fork: true, archived: false, private: false,
  },
  {
    name: 'old-experiment', html_url: 'https://github.com/biassp/old-experiment',
    description: 'Archived.', language: 'Ruby', stargazers_count: 500, forks_count: 500,
    pushed_at: iso(2), topics: [], fork: false, archived: true, private: false,
  },
  {
    name: 'secret-thing', html_url: 'https://github.com/biassp/secret-thing',
    description: 'Private.', language: 'Rust', stargazers_count: 300, forks_count: 300,
    pushed_at: iso(2), topics: [], fork: false, archived: false, private: true,
  },
  {
    name: 'biassp', html_url: 'https://github.com/biassp/biassp',
    description: 'Profile readme.', language: 'Markdown', stargazers_count: 7, forks_count: 7,
    pushed_at: iso(1), topics: [], fork: false, archived: false, private: false,
  },
  {
    // public and not a fork, but HIDE-listed: scratch repos kept off the CV
    name: 'wp1', html_url: 'https://github.com/biassp/wp1',
    description: null, language: 'Perl', stargazers_count: 4, forks_count: 4,
    pushed_at: iso(3), topics: [], fork: false, archived: false, private: false,
  },
  {
    name: 'WordPress', html_url: 'https://github.com/biassp/WordPress',
    description: 'wp scratch', language: 'Perl', stargazers_count: 4, forks_count: 4,
    pushed_at: iso(3), topics: [], fork: false, archived: false, private: false,
  },
  {
    // public, but kept off the CV on subject-matter grounds
    name: 'traffic', html_url: 'https://github.com/biassp/traffic',
    description: 'traffic', language: 'Perl', stargazers_count: 4, forks_count: 4,
    pushed_at: iso(2), topics: [], fork: false, archived: false, private: false,
  },
  {
    name: 'billy-kill-1', html_url: 'https://github.com/biassp/billy-kill-1',
    description: null, language: 'Perl', stargazers_count: 4, forks_count: 4,
    pushed_at: iso(2), topics: [], fork: false, archived: false, private: false,
  },
  {
    // public but EMPTY - must never be linked from the CV
    name: 'Movie-API', html_url: 'https://github.com/biassp/Movie-API',
    description: null, language: 'Perl', stargazers_count: 4, forks_count: 4,
    pushed_at: iso(2), topics: [], fork: false, archived: false, private: false,
  },
];

// The six survivors: skillpath, quran-online, aplikasi-pengarsipan-surat-php,
// radar-duit, cek-aman, dotfiles-backup.
const EXPECTED = {
  repos: 6,
  languages: 4,                   // JavaScript, PHP, Dart, Elixir (dotfiles-backup has none)
  stars: 4 + 1 + 0 + 2 + 0 + 0,   // 7
  forks: 2 + 0 + 1 + 0 + 0 + 0,   // 3
};

// Movie-API was removed from the fallback: the repo is empty, so the card sent
// recruiters to nothing. It is HIDE-listed too, so the live feed cannot resurrect it.
const FALLBACK_TITLES = [
  'Quran Online', 'Aplikasi Kasir Web', 'Arsip Surat (PHP)', 'Cloudflare WAF Rules',
  'CareerHigh Android', 'MySQL Converter Tool', 'Penerimaan Siswa Baru',
  'Kalkulator JavaScript',
];

/* ------------------------------------------------------------------ harness */

function memoryStorage(seed) {
  const map = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => (i < map.size ? Array.from(map.keys())[i] : null),
    get length() { return map.size; },
  };
}

async function settle() {
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Boot the real index.html with a stubbed fetch + localStorage.
 * `fetchStub` is called with (url, init) and must return a promise.
 */
async function boot(fetchStub, seedStorage) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    url: 'https://biassp.github.io/',
    runScripts: 'dangerously',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: memoryStorage(seedStorage), configurable: true, writable: true,
      });
      win.fetch = (url, init) => {
        calls.push({ url, init });
        return fetchStub(url, init);
      };
    },
  });

  await settle();

  const doc = dom.window.document;
  const all = () => Array.from(doc.querySelectorAll('#repoGrid .proj'));
  return {
    dom, doc, calls,
    grid: doc.getElementById('repoGrid'),
    stats: doc.getElementById('repoStats'),
    filters: doc.getElementById('repoFilters'),
    empty: doc.getElementById('repoEmpty'),
    note: doc.getElementById('repoNote'),
    cards: all,
    visible: () => all().filter((el) => !el.hidden),
    chips: () => Array.from(doc.querySelectorAll('#repoFilters .chip')),
    num: (id) => doc.getElementById(id).textContent,
  };
}

const ok = (payload) => () => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(payload),
});
const httpError = (status) => () => Promise.resolve({
  ok: false, status, json: () => Promise.reject(new Error('no body')),
});
const offline = () => () => Promise.reject(new TypeError('Failed to fetch'));

/* -------------------------------------------------------------------- tests */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const titles = (ctx) => ctx.cards().map((c) => c.querySelector('h3').textContent);
const cardFor = (ctx, title) => ctx.cards().find((c) => c.querySelector('h3').textContent === title);
const descOf = (ctx, title) => cardFor(ctx, title).querySelector('p').textContent;

test('a) healthy payload: filters, curated overrides, uncurated repos still render', async () => {
  const ctx = await boot(ok(PAYLOAD));

  // the request itself
  assert.strictEqual(ctx.calls.length, 1, 'fetch called exactly once');
  assert.match(ctx.calls[0].url,
    /^https:\/\/api\.github\.com\/users\/biassp\/repos\?per_page=100&sort=pushed$/);
  assert.strictEqual(ctx.calls[0].init.headers.Accept, 'application/vnd.github+json');

  const shown = titles(ctx);
  assert.strictEqual(shown.length, EXPECTED.repos, 'six repos survive filtering');

  // fork / archived / private / HIDE-listed are gone
  const hrefs = ctx.cards().map((c) => c.getAttribute('href'));
  for (const gone of ['someone-elses-lib', 'old-experiment', 'secret-thing']) {
    assert.ok(!hrefs.some((h) => h.includes(gone)), gone + ' must be filtered out');
  }
  // HIDE list: matched case-insensitively, and it beats every other signal
  // (wp1/WordPress are public, non-fork, and have more stars than anything else)
  for (const hidden of ['biassp', 'wp1', 'WordPress', 'traffic', 'billy-kill-1', 'Movie-API']) {
    assert.ok(!hrefs.includes('https://github.com/biassp/' + hidden), hidden + ' is HIDE-listed');
  }
  for (const t of ['Wp1', 'WordPress', 'Traffic', 'Billy Kill 1', 'Movie API']) {
    assert.ok(!titles(ctx).includes(t), t + ' must not render a card');
  }
  // ...and their stars/forks/language must not leak into the counters or chips
  assert.ok(!ctx.chips().map((c) => c.getAttribute('data-lang')).includes('Perl'),
    'a HIDE-listed repo contributes no language chip');

  // CURATED title and description beat GitHub's
  assert.ok(shown.includes('Quran Online'), 'curated title replaces the slug');
  const quran = descOf(ctx, 'Quran Online');
  assert.ok(!quran.includes('GITHUB TEXT SHOULD LOSE'), 'CURATED desc wins over GitHub');
  assert.ok(quran.startsWith('Web app for reading the Holy Quran'), quran);

  // uncurated repo renders, title-cased from the slug, GitHub's description used
  assert.ok(shown.includes('Radar Duit'), 'uncurated repo appears with a slug title');
  assert.strictEqual(descOf(ctx, 'Radar Duit'), 'Personal finance tracker for daily spending.');
  assert.ok(shown.includes('Dotfiles Backup'));
  assert.strictEqual(descOf(ctx, 'Dotfiles Backup'), 'Shell config backup.');

  // uncurated + null description -> placeholder, never the string "null"
  assert.ok(shown.includes('Cek Aman'));
  assert.match(descOf(ctx, 'Cek Aman'), /No description on GitHub yet/);
  for (const t of shown) {
    assert.ok(descOf(ctx, t).trim().length > 0 && descOf(ctx, t) !== 'null', t + ' has a description');
  }

  // curated desc still used when GitHub's is null
  assert.match(descOf(ctx, 'Arsip Surat (PHP)'), /letter archiving/);

  // ordering: weight desc, then stars desc, then pushed_at desc
  assert.deepStrictEqual(shown.slice(0, 3), ['SkillPath', 'Quran Online', 'Arsip Surat (PHP)']);
  assert.deepStrictEqual(shown.slice(3), ['Radar Duit', 'Dotfiles Backup', 'Cek Aman']);

  // topics capped at three, rendered as .proj-tags
  const skill = cardFor(ctx, 'SkillPath');
  assert.deepStrictEqual(
    Array.from(skill.querySelectorAll('.proj-tags span')).map((s) => s.textContent),
    ['spa', 'vanilla-js', 'e-learning']);
  assert.strictEqual(cardFor(ctx, 'Cek Aman').querySelectorAll('.proj-tags').length, 0,
    'no empty tag row when there are no topics');

  // meta row: language dot, non-zero metrics only, relative time
  const meta = skill.querySelector('.repo-meta').textContent;
  assert.ok(meta.includes('JavaScript') && meta.includes('4') && meta.includes('2'), meta);
  assert.match(meta, /today|yesterday|days ago|months ago|years ago/);
  assert.ok(skill.querySelector('.repo-lang .dot'), 'language colour dot present');
  assert.strictEqual(cardFor(ctx, 'Cek Aman').querySelectorAll('.repo-meta svg').length, 0,
    'zero stars and zero forks are hidden');
  assert.strictEqual(cardFor(ctx, 'Dotfiles Backup').querySelectorAll('.repo-lang').length, 0,
    'no language row when GitHub reports none');

  // relative time wording for a known age
  assert.match(cardFor(ctx, 'Cek Aman').querySelector('.repo-when').textContent, /year/);
  assert.match(cardFor(ctx, 'Arsip Surat (PHP)').querySelector('.repo-when').textContent, /months ago/);

  // reuses the existing portfolio classes
  ctx.cards().forEach((c) => {
    assert.ok(c.classList.contains('proj'));
    assert.ok(c.querySelector('.proj-body'), 'reuses .proj-body');
    assert.strictEqual(c.getAttribute('target'), '_blank');
    assert.strictEqual(c.getAttribute('rel'), 'noopener');
    assert.ok(c.getAttribute('href').startsWith('https://github.com/'));
  });

  // note points at the API, not the fallback CTA
  assert.match(ctx.note.textContent, /GitHub API/);
});

test('a2) hostile strings from the API are escaped, not injected', async () => {
  const nasty = [{
    name: 'xss-<img src=x onerror=alert(1)>',
    html_url: 'https://github.com/biassp/xss',
    description: '<script>window.__pwned = 1;</' + 'script>"quoted" & \'single\'',
    language: '"><b>bold</b>', stargazers_count: 1, forks_count: 1,
    pushed_at: iso(1), topics: ['<i>topic</i>'],
    fork: false, archived: false, private: false,
  }, {
    // a hostile href must not survive the https://github.com/ check
    name: 'evil', html_url: 'javascript:alert(1)', description: 'nope', language: 'JS',
    stargazers_count: 0, forks_count: 0, pushed_at: iso(1), topics: [],
    fork: false, archived: false, private: false,
  }];
  const ctx = await boot(ok(nasty));
  assert.strictEqual(ctx.dom.window.__pwned, undefined, 'no script executed');
  assert.strictEqual(ctx.grid.querySelectorAll('img, b, script').length, 0,
    'no markup smuggled through innerHTML');
  assert.strictEqual(ctx.cards().length, 1, 'the javascript: URL repo was dropped');
  assert.match(ctx.cards()[0].querySelector('p').textContent, /window\.__pwned/,
    'the payload is shown as literal text');
});

test('b) counter strip totals match the fixture', async () => {
  const ctx = await boot(ok(PAYLOAD));
  assert.strictEqual(ctx.stats.hidden, false, 'counter strip revealed');
  assert.strictEqual(ctx.num('repoStatCount'), String(EXPECTED.repos));
  assert.strictEqual(ctx.num('repoStatLangs'), String(EXPECTED.languages));
  assert.strictEqual(ctx.num('repoStatStars'), String(EXPECTED.stars));
  assert.strictEqual(ctx.num('repoStatForks'), String(EXPECTED.forks));
  // reuses the existing stats markup
  assert.ok(ctx.stats.classList.contains('stats'));
  assert.strictEqual(ctx.stats.querySelectorAll('.stat .num').length, 4);
  assert.strictEqual(ctx.stats.querySelectorAll('.stat .lbl').length, 4);
});

test('c) language chips are built from the payload, not a static list', async () => {
  const ctx = await boot(ok(PAYLOAD));
  assert.strictEqual(ctx.filters.hidden, false);
  const labels = ctx.chips().map((c) => c.getAttribute('data-lang'));
  assert.strictEqual(labels[0], '*', 'All chip comes first');
  assert.deepStrictEqual(labels.slice(1).slice().sort(),
    ['Dart', 'Elixir', 'JavaScript', 'Other', 'PHP']);

  // Elixir is absent from the colour map, so it can only have come from the payload
  assert.ok(labels.includes('Elixir'), 'unknown language still gets a chip');
  // languages that belong only to filtered-out repos must not appear
  for (const gone of ['Go', 'Ruby', 'Rust', 'Markdown']) {
    assert.ok(!labels.includes(gone), gone + ' belongs to a filtered repo');
  }

  // each chip carries its count, and aria-pressed marks exactly one active chip
  const byLang = {};
  ctx.chips().forEach((c) => { byLang[c.getAttribute('data-lang')] = c.querySelector('.n').textContent; });
  assert.strictEqual(byLang['*'], String(EXPECTED.repos));
  assert.strictEqual(byLang.JavaScript, '2');
  assert.strictEqual(byLang.PHP, '1');
  assert.strictEqual(byLang.Other, '1');
  assert.strictEqual(ctx.chips()[0].getAttribute('aria-pressed'), 'true');
  assert.strictEqual(ctx.chips().filter((c) => c.getAttribute('aria-pressed') === 'true').length, 1);

  // a different payload yields different chips — proof the list is data-driven
  const other = await boot(ok([{
    name: 'zig-thing', html_url: 'https://github.com/biassp/zig-thing',
    description: 'x', language: 'Zig', stargazers_count: 0, forks_count: 0,
    pushed_at: iso(1), topics: [], fork: false, archived: false, private: false,
  }]));
  assert.deepStrictEqual(other.chips().map((c) => c.getAttribute('data-lang')), ['*', 'Zig']);
});

test('d) clicking a chip filters the grid; All brings everything back', async () => {
  const ctx = await boot(ok(PAYLOAD));
  const chipFor = (lang) => ctx.chips().find((c) => c.getAttribute('data-lang') === lang);

  chipFor('JavaScript').click();
  assert.deepStrictEqual(ctx.visible().map((c) => c.querySelector('h3').textContent),
    ['SkillPath', 'Quran Online']);
  assert.strictEqual(ctx.cards().length, EXPECTED.repos, 'cards hidden, not removed');
  assert.strictEqual(chipFor('JavaScript').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(chipFor('*').getAttribute('aria-pressed'), 'false');
  assert.strictEqual(ctx.empty.hidden, true, 'no empty message while matches exist');

  chipFor('Other').click();
  assert.deepStrictEqual(ctx.visible().map((c) => c.querySelector('h3').textContent),
    ['Dotfiles Backup']);
  assert.strictEqual(ctx.chips().filter((c) => c.getAttribute('aria-pressed') === 'true').length, 1);

  // clicking the label's inner count span must still work (event delegation)
  chipFor('Dart').querySelector('.n').click();
  assert.deepStrictEqual(ctx.visible().map((c) => c.querySelector('h3').textContent), ['Radar Duit']);

  chipFor('*').click();
  assert.strictEqual(ctx.visible().length, EXPECTED.repos, 'All restores every card');
  assert.strictEqual(ctx.empty.hidden, true);
});

test('d2) a language with no matching cards shows the empty message', async () => {
  const ctx = await boot(ok(PAYLOAD));
  const dart = ctx.filters.querySelector('.chip[data-lang="Dart"]');
  // retarget the chip at a language no card carries
  cardFor(ctx, 'Radar Duit').setAttribute('data-lang', 'Dart-ish');
  dart.click();
  assert.strictEqual(ctx.visible().length, 0, 'nothing matches');
  assert.strictEqual(ctx.empty.hidden, false, 'empty message shown');
  ctx.filters.querySelector('.chip[data-lang="*"]').click();
  assert.strictEqual(ctx.visible().length, EXPECTED.repos);
  assert.strictEqual(ctx.empty.hidden, true, 'empty message hidden again');
});

/** shared assertions for every failure mode */
function assertFellBack(ctx, label) {
  const cards = ctx.cards();
  assert.strictEqual(cards.length, FALLBACK_TITLES.length,
    label + ': every hardcoded fallback card restored');
  assert.strictEqual(ctx.grid.querySelectorAll('.repo-skel').length, 0, label + ': no skeleton left');
  assert.strictEqual(ctx.grid.querySelectorAll('.ln').length, 0, label + ': no skeleton lines left');
  assert.strictEqual(ctx.grid.querySelectorAll('.reveal').length, 0,
    label + ': no .reveal, which would leave restored cards invisible forever');
  cards.forEach((c) => {
    assert.ok(!c.classList.contains('reveal'), label + ': card carries no .reveal');
    assert.strictEqual(c.hidden, false, label + ': cards visible');
    assert.ok(c.getAttribute('href').startsWith('https://github.com/biassp/'));
    assert.ok(c.querySelector('h3').textContent.trim().length > 0);
    assert.ok(c.querySelector('p').textContent.trim().length > 0);
  });
  assert.deepStrictEqual(cards.map((c) => c.querySelector('h3').textContent), FALLBACK_TITLES,
    label + ': the original fallback cards, in the original order');

  assert.strictEqual(ctx.stats.hidden, true, label + ': counter strip hidden');
  assert.strictEqual(ctx.filters.hidden, true, label + ': chips hidden');
  assert.strictEqual(ctx.empty.hidden, true, label + ': no empty message');
  assert.match(ctx.note.textContent, /github\.com\/biassp/, label + ': note points at the profile');
  assert.ok(ctx.note.querySelector('a[href*="biassp?tab=repositories"]'), label + ': CTA link present');
}

test('e) 403 rate limit: the hardcoded cards come back', async () => {
  assertFellBack(await boot(httpError(403)), '403');
  assertFellBack(await boot(httpError(429)), '429');
  assertFellBack(await boot(httpError(500)), '500');
});

test('e2) 200 with a nonsense payload also falls back', async () => {
  for (const body of [null, {}, [], 'not json', [{ nope: true }], [null, 7, 'x']]) {
    assertFellBack(await boot(ok(body)), 'payload ' + JSON.stringify(body));
  }
  // json() itself blowing up must be caught too
  assertFellBack(await boot(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad json')),
  })), 'broken json');
});

test('f) rejected promise (offline): identical behaviour', async () => {
  assertFellBack(await boot(offline()), 'offline');
  // a fetch that throws synchronously
  assertFellBack(await boot(() => { throw new TypeError('NetworkError'); }), 'throwing fetch');
});

test('f2) fetch missing entirely: still the hardcoded cards', async () => {
  const dom = new JSDOM(HTML, {
    url: 'https://biassp.github.io/',
    runScripts: 'dangerously',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', { value: memoryStorage(), configurable: true });
      Object.defineProperty(win, 'fetch', { value: undefined, configurable: true });
    },
  });
  await settle();
  const doc = dom.window.document;
  assert.strictEqual(doc.querySelectorAll('#repoGrid .proj').length, FALLBACK_TITLES.length);
  assert.strictEqual(doc.querySelectorAll('#repoGrid .repo-skel').length, 0);
  assert.strictEqual(doc.querySelectorAll('#repoGrid .reveal').length, 0);
});

test('g) fresh cache paints first, then the network refreshes it', async () => {
  const cached = [{
    name: 'radar-duit', url: 'https://github.com/biassp/radar-duit',
    desc: 'From the cache.', lang: 'Dart', stars: 1, forks: 0, pushed: iso(1), topics: [],
  }];
  const seed = { gh_repos_v1: JSON.stringify({ at: Date.now(), repos: cached }) };

  // fetch never settles -> what stays on screen is the cached render
  const pending = await boot(() => new Promise(() => {}), seed);
  assert.deepStrictEqual(titles(pending), ['Radar Duit']);
  assert.strictEqual(descOf(pending, 'Radar Duit'), 'From the cache.');
  assert.strictEqual(pending.grid.querySelectorAll('.repo-skel').length, 0,
    'a fresh cache skips the skeleton');
  assert.strictEqual(pending.calls.length, 1, 'still refreshes in the background');

  // fetch succeeds -> live data replaces the cached render and the cache is rewritten
  const refreshed = await boot(ok(PAYLOAD), seed);
  assert.strictEqual(refreshed.cards().length, EXPECTED.repos);
  assert.strictEqual(refreshed.num('repoStatCount'), String(EXPECTED.repos));
  const stored = JSON.parse(refreshed.dom.window.localStorage.getItem('gh_repos_v1'));
  assert.strictEqual(typeof stored.at, 'number', 'cache shape is {at, repos}');
  assert.strictEqual(stored.repos.length, EXPECTED.repos, 'cache holds the filtered list');

  // a failing background refresh must not wipe good data off the screen
  const kept = await boot(httpError(403), seed);
  assert.deepStrictEqual(titles(kept), ['Radar Duit'], 'cached render survives a failed refresh');
  assert.strictEqual(kept.stats.hidden, false);
});

test('h) stale cache is ignored for the first paint (6h TTL)', async () => {
  const stale = (hours) => ({
    gh_repos_v1: JSON.stringify({
      at: Date.now() - hours * 3600000,
      repos: [{
        name: 'radar-duit', url: 'https://github.com/biassp/radar-duit',
        desc: 'Stale.', lang: 'Dart', stars: 0, forks: 0, pushed: iso(9), topics: [],
      }],
    }),
  });

  const fresh = await boot(() => new Promise(() => {}), stale(5));
  assert.strictEqual(fresh.grid.querySelectorAll('.repo-skel').length, 0, '5h old cache is fresh');

  const old = await boot(() => new Promise(() => {}), stale(7));
  assert.strictEqual(old.grid.querySelectorAll('.repo-skel').length, 6,
    '7h old cache is stale -> skeleton');
  assert.strictEqual(old.cards().length, 6, 'skeletons reuse .proj');

  // corrupt cache entries are ignored rather than thrown on
  for (const raw of ['{{{', '{}', '[]', 'null', JSON.stringify({ at: 'now', repos: [] })]) {
    const ctx = await boot(() => new Promise(() => {}), { gh_repos_v1: raw });
    assert.strictEqual(ctx.grid.querySelectorAll('.repo-skel').length, 6, 'ignored: ' + raw);
  }
});

test('i) unreadable localStorage does not break the feed', async () => {
  const explode = () => { throw new Error('SecurityError: storage disabled'); };
  const dom = new JSDOM(HTML, {
    url: 'https://biassp.github.io/',
    runScripts: 'dangerously',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: { getItem: explode, setItem: explode, removeItem: explode },
        configurable: true,
      });
      win.fetch = ok(PAYLOAD);
    },
  });
  await settle();
  assert.strictEqual(dom.window.document.querySelectorAll('#repoGrid .proj').length, EXPECTED.repos);
});

test('j) the shipped markup keeps the fallback intact', () => {
  const section = HTML.slice(HTML.indexOf('id="repos"'), HTML.indexOf('id="skills"'));
  assert.strictEqual((section.match(/<a class="proj"/g) || []).length, FALLBACK_TITLES.length,
    'every fallback card still present in the static HTML');
  assert.ok(!HTML.includes('Movie-API'), 'the empty Movie-API repo is claimed nowhere');
  assert.ok(!HTML.includes("'movie-api': {"), 'and has no CURATED entry');
  assert.strictEqual((section.match(/class="proj reveal"/g) || []).length, 0,
    '.reveal removed from the fallback cards');
  for (const id of ['repoGrid', 'repoStats', 'repoFilters', 'repoEmpty', 'repoNote']) {
    assert.ok(section.includes('id="' + id + '"'), 'missing #' + id);
  }
  assert.ok(!HTML.includes('700&family='), 'Google Fonts ampersands escaped');
  assert.ok(HTML.includes('700&amp;family='));
  assert.ok(!HTML.includes('700&display='));
});

/* --------------------------------------------------------------------- run */

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('  ' + GREEN + 'PASS' + OFF + ' ' + name);
    } catch (err) {
      failed++;
      console.log('  ' + RED + 'FAIL' + OFF + ' ' + name);
      const msg = err && err.stack ? err.stack : String(err);
      console.log('       ' + msg.split('\n').slice(0, 6).join('\n       '));
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passing');
  process.exit(failed ? 1 : 0);
})();
