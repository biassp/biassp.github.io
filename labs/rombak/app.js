/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — app.js
 * The only file that touches the DOM. It renders what the other ten modules
 * compute and it never computes anything they could have. In particular it never
 * decides whether a migration landed, never folds a row into a checksum, and
 * never rewrites an error message: the runner returns a verdict, census.js
 * returns a sentence, SQLite returns a string, and this file puts them on screen
 * unchanged.
 *
 * Eight things this file has to get right that are easy to miss:
 *
 *  1. EVERY PIECE OF SQL ARRIVES THROUGH textContent. That is why all seven
 *     panels are empty in index.html. `WHERE a <> b` written into markup is an
 *     html-validate no-raw-characters violation and a parse5
 *     invalid-first-character-of-tag-name error at the same time, and the whole
 *     page then fails test:markup. Through textContent the same string cannot be
 *     markup at all.
 *
 *  2. THE TWO ROUTES MUST STAY APART. Where this file shows a pair of numbers
 *     with a difference between them, the comment above the pair names both
 *     producers and they share no code. The Migrations tab's census diff is
 *     schema.js's static `declares` against census.js's fold of raw rows; the
 *     live card is SQLite's aggregates against hand-written ES5 over the same
 *     rows. If either half were computed here the difference could only ever be
 *     zero, which is the bug this repository has shipped three times.
 *
 *  3. `db.export()` CLOSES AND REOPENS THE CONNECTION, and `PRAGMA foreign_keys`
 *     is per connection, so it silently reverts to 0. Every export on this page
 *     goes through exportKeepingFk(); the Console shows the live value beside the
 *     Download button, because a visitor who exports and then types an INSERT
 *     would otherwise be writing to a database with no foreign keys and getting a
 *     clean foreign_key_check for it.
 *
 *  4. THE LADDER WALK IS CHUNKED. The census costs about a quarter of a second
 *     and the walk takes thirteen of them. Run as one block that is five seconds
 *     of a frozen page with nothing on it; run one rung per timeout, the
 *     Migrations panel fills in in front of the reader and the browser stays
 *     alive. The assertion suite is the same problem an order of magnitude
 *     larger, so the badge goes busy and yields a frame before run() is called.
 *
 *  5. EVERY RENDERER SURVIVES A MISSING TABLE. `DROP TABLE patient` in the
 *     Console is a supported thing to do, and a renderer that throws on it is a
 *     pageerror, which fails CI at 100% assertions. Reads go through tryRows(),
 *     which returns a verdict instead of raising, and the panel prints the
 *     failure as a red card in place.
 *
 *  6. THE LIVE BADGE REPORTS AGAINST THE TOTAL, NOT AGAINST WHAT RAN. Dropping a
 *     table makes four invariants inapplicable, and a badge that counted only
 *     applicable ones would get GREENER the more the reader broke. It prints
 *     22 of 22 when everything ran and names the ones that did not.
 *
 *  7. ANALYZE IS NOT NEUTRAL. Two of the plans on the Plans tab move once
 *     sqlite_stat1 exists, so the card that runs ANALYZE says so before you
 *     press it, and every plan card measured before it is marked stale
 *     afterwards rather than quietly turning red.
 *
 *  8. §8.2's "What this page does not prove" is STATIC MARKUP in index.html,
 *     below the panels, and is not re-rendered here. The Schema tab links to it.
 *     Rendering it twice would be the page arguing with itself.
 */
(function (root) {
  'use strict';

  var D = root.ROMBAK_DOMAIN;
  var S = root.ROMBAK_SCHEMA;
  var P = root.ROMBAK_PLANS;
  var C = root.ROMBAK_CENSUS;
  var E = root.ROMBAK_ENGINE;
  var RN = root.ROMBAK_RUNNER;
  var St = root.ROMBAK_STORE;
  var T = root.ROMBAK_TESTS;

  /* ------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag), i, k;
    if (attrs) {
      for (k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) {
        c.forEach(function (x) {
          if (x === null || x === undefined || x === false) return;
          el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
        });
      } else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  /* textContent = '' detaches every child in one operation. The obvious
   * while(firstChild) removeChild loop is not equivalent: removing a FOCUSED
   * textarea fires blur synchronously, and a blur handler that re-renders leaves
   * the loop removing a node that is no longer its child. */
  function clear(el) { el.textContent = ''; }

  function num(n) {
    if (n === null || n === undefined) return '—';
    var s = String(Math.abs(Math.round(n))), out = '', i, c = 0;
    for (i = s.length - 1; i >= 0; i--) { out = s.charAt(i) + out; if (++c % 3 === 0 && i > 0) out = '.' + out; }
    return (n < 0 ? '-' : '') + out;
  }

  function cell(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'object') return Object.prototype.toString.call(v);
    return String(v);
  }

  function tableOf(headers, rows, opts) {
    opts = opts || {};
    var hr = h('tr');
    headers.forEach(function (x) {
      var label = (x && x.label !== undefined) ? x.label : x;
      hr.appendChild(h('th', { scope: 'col', class: (x && x.num) ? 'num' : null, text: label }));
    });
    var tb = h('tbody');
    rows.forEach(function (r) { if (r) tb.appendChild(r); });
    if (!rows.length) {
      tb.appendChild(h('tr', null, h('td', { colspan: String(headers.length), text: opts.empty || 'no rows' })));
    }
    return h('div', { class: 'tbl-wrap' + (opts.prose ? ' prose' : '') },
      h('table', { style: opts.minWidth ? 'min-width:' + opts.minWidth : null }, h('thead', null, hr), tb));
  }

  /* A raw result set, exactly as SQLite handed it over: no formatting, no
   * rounding, NULL printed as NULL rather than as an empty cell. */
  function resultTable(res, limit) {
    var cols = res.columns || [], vals = res.values || [];
    var shown = limit ? vals.slice(0, limit) : vals;
    var rows = shown.map(function (r) {
      var tr = h('tr');
      r.forEach(function (v) {
        tr.appendChild(h('td', { class: typeof v === 'number' ? 'num' : null, text: cell(v) }));
      });
      return tr;
    });
    var wrap = h('div', null, tableOf(cols.length ? cols : ['(no columns)'], rows, { empty: 'no rows' }));
    if (limit && vals.length > limit) {
      wrap.appendChild(h('p', { class: 'hint', text: num(vals.length - limit) + ' further row(s) not shown.' }));
    }
    return wrap;
  }

  function sqlBox(text) { return h('div', { class: 'sqlbox', text: text }); }

  /* EXPLAIN QUERY PLAN output, verbatim, one node per line, with the operation
   * word coloured. The colour is decoration; the string is the evidence, so the
   * whole line is present whether or not a word in it was recognised. */
  function planBox(details) {
    var box = h('div', { class: 'planbox' });
    (details || []).forEach(function (line, i) {
      var cls = '';
      if (/USE TEMP B-TREE/.test(line)) cls = 'op-temp';
      else if (/COVERING INDEX/.test(line)) cls = 'op-covering';
      else if (/^SEARCH/.test(line)) cls = 'op-search';
      else if (/^SCAN/.test(line)) cls = 'op-scan';
      if (i) box.appendChild(document.createTextNode('\n'));
      box.appendChild(h('span', { class: cls || null, text: line }));
    });
    if (!details || !details.length) box.appendChild(document.createTextNode('(no plan)'));
    return box;
  }

  function pill(text, cls) { return h('span', { class: 'pill' + (cls ? ' ' + cls : ''), text: text }); }

  function planPill(detail) {
    if (/USE TEMP B-TREE/.test(detail)) return pill('temp b-tree', 'temp');
    if (/COVERING INDEX/.test(detail)) return pill('covering', 'covering');
    if (/^SEARCH/.test(detail)) return pill('search', 'search');
    if (/^SCAN/.test(detail)) return pill('scan', 'scan');
    return pill('plan', 'info');
  }

  function stat(k, v, n) {
    return h('div', { class: 'stat' },
      h('div', { class: 'k', text: k }),
      h('div', { class: 'v', text: v }),
      n ? h('div', { class: 'n', text: n }) : null);
  }

  function card(title, note) {
    var c = h('section', { class: 'card' });
    if (title) c.appendChild(h('h3', { text: title }));
    if (note) c.appendChild(h('p', { class: 'note', text: note }));
    return c;
  }

  function callout(kind, strong, rest) {
    return h('div', { class: 'callout' + (kind ? ' ' + kind : '') },
      strong ? h('b', { text: strong + ' ' }) : null, rest || null);
  }

  function btn(label, onclick, cls, fkey) {
    return h('button', {
      type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), 'data-fkey': fkey || null, onclick: onclick
    }, label);
  }

  var sayTimer = null;
  function say(text) {
    var el = $('say');
    if (!el || !text) return;
    el.textContent = '';
    if (sayTimer) clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { el.textContent = text; }, 40);
  }

  function captureFocus() {
    var el = document.activeElement;
    if (!el || el === document.body || !el.getAttribute) return null;
    var key = el.getAttribute('data-fkey');
    if (!key) return null;
    var snap = { key: key };
    try {
      if (el.selectionStart !== undefined && el.selectionStart !== null) {
        snap.selStart = el.selectionStart; snap.selEnd = el.selectionEnd;
      }
    } catch (e) { /* selectionStart throws on some input types */ }
    return snap;
  }

  /* Where focus goes when the control that had it no longer exists — running a
   * statement re-renders the card the button was in. The anchor is the control
   * the next action needs anyway. */
  var FOCUS_ANCHOR = {
    schema: 'schema:route', migrations: 'mig:replay', rebuild: 'rebuild:recompute',
    constraints: 'cons:all', plans: 'plans:n', console: 'con:sql', tests: 'tests:again'
  };

  function restoreFocus(snap) {
    if (!snap) return;
    var el = null;
    try { el = document.querySelector('[data-fkey="' + snap.key + '"]'); } catch (e) { el = null; }
    if (!el) {
      var anchor = FOCUS_ANCHOR[state.view];
      if (anchor) { try { el = document.querySelector('[data-fkey="' + anchor + '"]'); } catch (e0) { el = null; } }
      if (!el) el = $('panel-' + state.view);
      if (el) { try { el.focus({ preventScroll: true }); } catch (e1) { try { el.focus(); } catch (e1b) { /* gone */ } } }
      return;
    }
    /* A control that never lost focus kept its caret. Calling focus() on it again
     * resets the editing position of some controls for no gain. */
    if (el === document.activeElement) return;
    try { el.focus({ preventScroll: true }); } catch (e2) { try { el.focus(); } catch (e3) { return; } }
    if (snap.selStart !== undefined) {
      var n = (el.value === undefined || el.value === null) ? 0 : String(el.value).length;
      var a = Math.min(snap.selStart, n), b = Math.min(snap.selEnd === undefined ? a : snap.selEnd, n);
      try { el.setSelectionRange(a, b); } catch (e4) { /* not a text control */ }
    }
  }

  /* --------------------------------------------------------------- state */

  var state = {
    view: 'schema',
    db: null,                 // OUR handle. Never E.db() at call time: the suite
                              // installs its own fixture as the live one, and
                              // rewindTo() replaces it outright.
    bootErr: null,
    booting: true,
    bootStep: 'waiting for the engine',
    boot: null,               // RN.boot() report, minus the handle
    rungs: {},                // version -> { refused: report|null, applied: report|null }
    version: 0,
    bytes6: null, bytes9: null,
    tests: null, testsBusy: false,
    live: null, liveSummary: null, liveErr: null,
    schemaSel: null, schemaRoute: false,
    plans: {}, plansMeasured: false, planN: 7, analyzed: false, analyzeCard: null, planIx: {}, droppedIx: {},
    buildLimits: null, indexSize: null,
    interleave: null,
    rebuild: null, naive: {}, audit: {}, wrong: null, rebuildErr: null,
    cons: {}, consRun: false, alter: null, refusals: null, deleteMatrix: null, nullCard: null,
    consoleSql: 'SELECT name, type FROM sqlite_master WHERE type = \'table\' ORDER BY name;',
    consolePlan: false, consoleOut: null, history: [],
    exportInfo: null, savedInfo: null, storeMsg: ''
  };

  function dbh() { return state.db; }

  /* Every read on every panel goes through here. `DROP TABLE patient` in the
   * Console is a supported thing to do; a renderer that throws on it is a
   * pageerror, and one pageerror fails the whole CI job however green the
   * assertions are. */
  function tryRows(sql, db) {
    try { return { ok: true, rows: E.rows(sql, db || dbh()) }; }
    catch (e) { return { ok: false, error: e.message, rows: [] }; }
  }

  function tryFirst(sql, db) {
    try { return { ok: true, value: E.first(sql, db || dbh()) }; }
    catch (e) { return { ok: false, error: e.message, value: null }; }
  }

  function tryExec(sql, db) {
    try { return { ok: true, res: E.exec(sql, db || dbh()) }; }
    catch (e) { return { ok: false, error: e.message, res: [] }; }
  }

  function failCard(title, message) {
    var c = card(title);
    c.appendChild(callout('bad', 'This card could not be rendered.',
      'The database in front of you does not answer the query it needs: ' + message +
      ' That is a legitimate state — the Console can drop any table — so the panel says so ' +
      'instead of failing.'));
    return c;
  }

  /* db.export() frees every prepared statement, closes the connection and
   * reopens the file. PRAGMA foreign_keys is per connection and reverts to 0
   * without a word. Every export on this page comes through here. */
  function exportKeepingFk(db) {
    var bytes = E.exportBytes(db);
    try { db.run('PRAGMA foreign_keys = ON'); } catch (e) { /* the handle went away */ }
    return bytes;
  }

  function rearm(db) {
    try { db.run('PRAGMA foreign_keys = ON'); } catch (e) { /* nothing to re-arm */ }
  }

  /* ---------------------------------------------------------- the badges */

  function paintNet() {
    var g = root.ROMBAK_GUARD;
    var n = g ? g.total() : 0;
    var el = $('netCount');
    if (el) el.textContent = 'network calls from this page: ' + n;
    var b = $('netBadge');
    if (b) b.className = 'netbadge' + (n ? ' bad' : '');
  }

  function paintTests() {
    var b = $('testBadge'), t = $('testText');
    if (!b || !t) return;
    if (state.testsBusy || !state.tests) {
      b.className = 'testbadge busy';
      t.textContent = state.testsBusy ? 'tests: running…' : 'tests: waiting…';
      return;
    }
    var r = state.tests;
    b.className = 'testbadge' + (r.failed ? ' bad' : '');
    t.textContent = r.failed
      ? 'tests: ' + r.failed + ' FAILED'
      : 'tests: ' + r.passed + '/' + r.total + ' passed';
  }

  /* The live badge counts against the TOTAL, not against what ran.
   *
   * Drop a table in the Console and four of the twenty-two invariants become
   * inapplicable — census.js reports applicable:false and ok:null for them. A
   * badge that printed passed/applicable would then read 18/18 and go GREEN,
   * i.e. get greener the more the reader broke. So the denominator is the whole
   * set and the ones that could not run are named. */
  function paintLive() {
    var b = $('liveBadge'), t = $('liveText');
    if (!b || !t) return;
    if (state.liveErr) {
      b.className = 'testbadge bad';
      t.textContent = 'live db: could not be checked';
      return;
    }
    var s = state.liveSummary;
    if (!s) { b.className = 'testbadge busy'; t.textContent = 'live db: checking…'; return; }
    var pendingOrMissing = s.total - s.passed;
    b.className = 'testbadge' + ((s.failed || s.pending) ? ' bad' : '');
    t.textContent = 'live db: ' + s.passed + '/' + s.total + ' invariants' +
      (pendingOrMissing && !s.failed ? ' (' + pendingOrMissing + ' did not run)' : '');
  }

  /* Recomputed from scratch after every mutation, by BOTH routes.
   *
   *   Route A — ROMBAK_ENGINE.sqlInvariants(): SQLite's own query engine,
   *             index-assisted aggregates and joins.
   *   Route B — ROMBAK_CENSUS.invariants(): hand-written ES5 reducing raw rows
   *             read through a plan-confirmed SCAN, with no WHERE and no
   *             aggregate anywhere in it.
   *
   * census.js cannot see engine.js — `grep -o 'ROMBAK_[A-Z]*' census.js` prints
   * ROMBAK_CENSUS and ROMBAK_DOMAIN and nothing else — so the two figures cannot
   * have come from one place, and the difference on screen is a real one. */
  function recomputeLive() {
    var db = dbh();
    if (!db) return;
    try {
      var js = C.invariants(db.exec.bind(db));
      var sql = E.sqlInvariants(db);
      state.live = C.compare(js, sql);
      state.liveSummary = C.summary(state.live);
      state.liveErr = null;
    } catch (e) {
      state.live = null; state.liveSummary = null;
      state.liveErr = e.message || String(e);
    }
    paintLive();
  }

  function paintTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var b = $('themeBtn');
    if (!b) return;
    // The visible word IS the accessible name (WCAG 2.5.3): a speech-input user
    // saying "click Light" has to hit the button they can see.
    b.textContent = dark ? 'Light' : 'Dark';
    /* No aria-pressed here, and labs/rekam/app.js:226-232 already learned why:
     * this label names the ACTION, so a state bit contradicts it. In the light
     * theme the button read "Dark" with aria-pressed="true" — announced as
     * "Dark, pressed" while the page was light, and painted as a filled active
     * control by .btn[aria-pressed="true"]. The change is announced through the
     * live region below instead, which describes what actually happened. */
    b.removeAttribute('aria-pressed');
    b.setAttribute('title', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  }

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    if (St) St.writeTheme(next);
    paintTheme();
    say(next === 'dark' ? 'Dark theme.' : 'Light theme.');
  }

  /* ------------------------------------------------------------- plumbing */

  var RENDER = {};

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel) return;
    var snap = captureFocus();
    clear(panel);
    try { RENDER[name](panel); }
    catch (e) {
      /* The last line of defence. A renderer that throws must not become a
       * pageerror: test:labs counts one console error as a failed lab. */
      panel.appendChild(callout('bad', 'This panel failed to render.', String(e && e.message || e)));
    }
    restoreFocus(snap);
  }

  function rerender() { renderPanel(state.view); }

  function switchTab(name, fromKeyboard) {
    state.view = name;
    var tabs = document.querySelectorAll('#tabs .tab'), i;
    for (i = 0; i < tabs.length; i++) {
      var id = tabs[i].id.replace('tab-', '');
      var on = id === name;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
      var p = $('panel-' + id);
      if (p) p.hidden = !on;
    }
    renderPanel(name);
    if (!fromKeyboard) say(name + ' tab.');
  }

  function wireTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#tabs .tab'));
    tabs.forEach(function (b, idx) {
      b.addEventListener('click', function () { switchTab(b.id.replace('tab-', '')); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          var end = tabs[e.key === 'Home' ? 0 : tabs.length - 1];
          switchTab(end.id.replace('tab-', ''), true);
          end.focus();
          showTab(end);
          return;
        }
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var next = tabs[(idx + d + tabs.length) % tabs.length];
        switchTab(next.id.replace('tab-', ''), true);
        /* After switchTab, not before: switchTab rewrites every tab's tabIndex
         * and renders the panel, and focusing first lets the render move focus
         * again. */
        next.focus();
        showTab(next);
      });
    });
  }

  /* Blink does not scroll a PARTIALLY visible element into view when it takes
   * focus, and the strip is a scroller: at 390px, arrowing onto Constraints
   * left 13 of its 114px — and the right side of its focus ring — outside the
   * box, and it stayed there. Measured, then measured again after this line. */
  function showTab(el) {
    if (!el.scrollIntoView) return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (e) { /* older signature takes a boolean and would scroll the page */ }
  }

  /* ============================================================ SCHEMA === */

  /* schema.js writes its DDL with the WHY comments attached, because the comment
   * is half of what an index is. They come off before anything is executed or
   * measured, and they are shown separately. */
  function stripComments(sql) {
    return String(sql).split('\n').filter(function (l) { return !/^\s*--/.test(l); })
      .join('\n').replace(/;\s*$/, '').replace(/^\s+|\s+$/g, '');
  }
  function commentsOf(sql) {
    return String(sql).split('\n').filter(function (l) { return /^\s*--/.test(l); })
      .map(function (l) { return l.replace(/^\s*--\s?/, ''); }).join(' ').replace(/\s+/g, ' ')
      .replace(/^WHY:\s*/, '');
  }
  function whereOf(sql) {
    var m = /\sWHERE\s([\s\S]+)$/i.exec(stripComments(sql));
    return m ? m[1].replace(/^\s+|\s+$/g, '') : null;
  }

  function renderSchema(p) {
    var db = dbh();
    p.appendChild(h('h2', { text: 'The schema, as the database describes itself' }));
    p.appendChild(h('p', { class: 'note' },
      'Everything on this tab is read from live pragmas and ', h('code', { text: 'sqlite_master' }),
      ' at render time. Nothing here is a string from ', h('code', { text: 'schema.js' }),
      ' — that file is the other route, and it is shown beside this one on demand so the two can be ' +
      'compared rather than conflated.'));

    if (!db) { p.appendChild(callout('warn', 'The engine has not finished booting.', state.bootStep)); return; }

    /* ---- header strip: four live pragmas, read now, not remembered ---- */
    var uv = tryFirst('PRAGMA user_version'), sv = tryFirst('PRAGMA schema_version');
    var pages = null;
    try { pages = E.pageStats(db); } catch (e) { pages = null; }
    var tl = tryRows("SELECT type, count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' GROUP BY type");
    var kinds = { table: 0, index: 0, trigger: 0 };
    tl.rows.forEach(function (r) { kinds[r[0]] = Number(r[1]); });

    var strip = h('div', { class: 'summary' });
    strip.appendChild(stat('PRAGMA user_version', uv.ok ? String(uv.value) : '—',
      'the schema version this database says it is'));
    strip.appendChild(stat('PRAGMA schema_version', sv.ok ? String(sv.value) : '—',
      'SQLite\'s own counter: incremented by every DDL statement ever run here'));
    strip.appendChild(stat('pages in use', pages ? num(pages.pagesUsed) : '—',
      pages ? 'page_count ' + num(pages.pageCount) + ' − freelist_count ' + num(pages.freelistCount) +
        ' × ' + num(pages.pageSize) + ' B = ' + num(pages.bytesUsed) + ' B' : ''));
    strip.appendChild(stat('objects', num(kinds.table) + ' / ' + num(kinds.index) + ' / ' + num(kinds.trigger),
      'tables / named indexes / triggers, counted in sqlite_master'));
    p.appendChild(strip);

    /* ---- what this build cannot do ---- */
    var lim = card('What this build of SQLite does not have',
      'Probed, not parsed. A string in PRAGMA compile_options is a claim about how the library was ' +
      'compiled; the error is what actually happens when you ask for the feature. Each probe below ran ' +
      'just now against the database in front of you.');
    if (!state.buildLimits) {
      state.buildLimits = P.BUILD_LIMITS.map(function (b) {
        var r = RN.attempt(db, b.probe);
        return { id: b.id, probe: b.probe, expect: b.expect, message: r.ok ? '' : r.message, ok: r.ok };
      });
    }
    var limRows = state.buildLimits.map(function (b) {
      return h('tr', null,
        h('td', null, h('code', { text: b.id })),
        h('td', null, h('span', { class: 'mono', text: b.probe })),
        h('td', null, b.ok ? pill('present', 'warn') : h('span', { class: 'cons-err', text: b.message })));
    });
    lim.appendChild(tableOf(['feature', 'probe', 'what SQLite answered'], limRows, { minWidth: '560px', prose: true }));
    lim.appendChild(h('p', { class: 'hint' },
      'The consequences are on the page rather than in a footnote: no FTS5 means the ICD-10 search is a ' +
      'plain index, no ', h('code', { text: 'dbstat' }), ' means an index is sized as a ',
      h('code', { text: 'page_count − freelist_count' }), ' delta, and no ',
      h('code', { text: 'sqlite_stat4' }), ' means ANALYZE produces average rows-per-value and nothing finer.'));
    p.appendChild(lim);

    /* ---- the tables ---- */
    var tabs = tryRows("SELECT name, type, ncol, wr, strict FROM pragma_table_list " +
      "WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if (!tabs.ok) { p.appendChild(failCard('Tables', tabs.error)); }
    else {
      var tcard = card('Tables', tabs.rows.length + ' tables, every column count and every flag read from ' +
        'pragma_table_list. Select one to see its columns, its foreign keys and the DDL SQLite stored for it.');
      var rows = tabs.rows.map(function (r) {
        var name = String(r[0]);
        var cnt = tryFirst('SELECT count(*) FROM "' + name + '"');
        var tr = h('tr', { class: state.schemaSel === name ? 'sel' : null },
          h('td', null, h('button', {
            type: 'button', class: 'linkbtn', 'data-fkey': 'schema:t:' + name,
            onclick: function () { state.schemaSel = state.schemaSel === name ? null : name; rerender(); }
          }, name)),
          h('td', { class: 'num', text: String(r[2]) }),
          h('td', { class: 'num', text: cnt.ok ? num(cnt.value) : '—' }),
          h('td', null, Number(r[3]) ? pill('WITHOUT ROWID') : pill('rowid', 'info')),
          h('td', null, Number(r[4]) ? pill('STRICT', 'ok') : pill('loose', 'bad')));
        return tr;
      });
      tcard.appendChild(tableOf([
        'table', { label: 'cols', num: true }, { label: 'rows', num: true }, 'storage', 'typing'
      ], rows, { minWidth: '560px' }));
      p.appendChild(tcard);
      if (state.schemaSel) p.appendChild(renderTableDetail(state.schemaSel));
    }

    /* ---- the indexes, each with the sentence it was created for ---- */
    var ixNames = Object.keys(S.INDEX_DDL);
    var live = tryRows("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name");
    var ic = card('Indexes', 'Each one carries the sentence it was written for, and the number of entries it ' +
      'actually holds — for a partial index that is the count of rows its own WHERE clause selects, which is ' +
      'the number that matters and is not the row count of the table.');
    var irows = live.rows.map(function (r) {
      var name = String(r[0]), tbl = String(r[1]);
      var ddl = S.INDEX_DDL[name] || S.LEGACY_INDEX_DDL[name] || '';
      var where = ddl ? whereOf(ddl) : null;
      var entries = tryFirst('SELECT count(*) FROM "' + tbl + '"' + (where ? ' WHERE ' + where : ''));
      return h('tr', null,
        h('td', null, h('code', { text: name })),
        h('td', { text: tbl }),
        h('td', null, where ? pill('partial', 'warn') : pill('full')),
        h('td', { class: 'num', text: entries.ok ? num(entries.value) : '—' }),
        h('td', { text: ddl ? commentsOf(ddl) : 'created outside the shipped DDL' }));
    });
    ic.appendChild(tableOf(['index', 'on', 'kind', { label: 'entries', num: true }, 'why it exists'],
      irows, { minWidth: '760px', prose: true }));
    if (live.rows.length !== ixNames.length) {
      ic.appendChild(callout('warn', 'The database and schema.js disagree on the index list.',
        'sqlite_master reports ' + live.rows.length + ' named indexes; schema.js declares ' +
        ixNames.length + '. At any version below 9 that is expected — the ladder builds them as it goes.'));
    }
    p.appendChild(ic);

    /* ---- triggers ---- */
    var trg = tryRows("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name");
    var tc = card('Triggers', 'All three exist to make audit_entry append-only, and v9 is where they are ' +
      'armed. The Rebuild tab is where they are shown being removed by a statement that reports success.');
    trg.rows.forEach(function (r) {
      tc.appendChild(h('p', { class: 'small' }, h('code', { text: String(r[0]) }), ' on ', h('code', { text: String(r[1]) })));
      tc.appendChild(sqlBox(String(r[2])));
    });
    if (!trg.rows.length) tc.appendChild(h('div', { class: 'empty', text: 'No triggers at this version.' }));
    p.appendChild(tc);

    /* ---- the three routes, named ---- */
    var rc = card('Three routes to "the schema is what schema.js says it is"');
    rc.appendChild(h('p', { class: 'note' },
      'Route A is this panel: pragmas and sqlite_master, read from the database. Route B is the DDL text in ' +
      'schema.js, shown beside it on the table you select above — the two are allowed to differ, because ' +
      'SQLite normalises whitespace and drops comments, so what is asserted is that every table, column, ' +
      'index and foreign key schema.js names EXISTS according to the pragmas. Route C is yours.'));
    rc.appendChild(h('p', null, 'Route C, which no panel can perform for you: open the Console, run ',
      h('code', { text: 'CREATE TABLE zz(a INTEGER);' }),
      ', come back here, and find zz in the table list above. A panel rendering a stored string cannot do that.'));
    rc.appendChild(h('p', { class: 'small' }, 'The limits of what any of this proves are set out in ',
      h('a', { href: '#notproven' }, 'What this page does not prove'), ', below the panels — it is on the ' +
      'page itself rather than behind this tab, because a correction the reader has to find is not a correction.'));
    p.appendChild(rc);
  }

  function renderTableDetail(name) {
    var c = card('' + name);
    var cols = tryRows("SELECT cid, name, type, \"notnull\", dflt_value, pk, hidden FROM pragma_table_xinfo('" + name + "')");
    if (!cols.ok) { return failCard(name, cols.error); }
    /* pragma_table_INFO omits generated columns outright, so amount_rp — the one
     * column on this page whose whole story is that it is generated — would be
     * invisible. xinfo reports hidden = 2 for VIRTUAL and 3 for STORED. */
    var crows = cols.rows.map(function (r) {
      var hid = Number(r[6]);
      return h('tr', null,
        h('td', null, h('code', { text: String(r[1]) })),
        h('td', { text: String(r[2]) }),
        h('td', null, Number(r[3]) ? pill('NOT NULL', 'ok') : pill('nullable')),
        h('td', { text: r[4] === null ? '—' : String(r[4]) }),
        h('td', null, Number(r[5]) ? pill('pk ' + r[5], 'info') : null,
          hid === 2 ? pill('VIRTUAL', 'warn') : null, hid === 3 ? pill('STORED', 'warn') : null));
    });
    c.appendChild(tableOf(['column', 'declared type', 'null', 'default', 'flags'], crows, { minWidth: '620px' }));

    var fks = tryRows("SELECT id, \"from\", \"table\", \"to\", on_delete, on_update FROM pragma_foreign_key_list('" + name + "')");
    if (fks.rows.length) {
      c.appendChild(h('h4', { text: 'Foreign keys' }));
      var frows = fks.rows.map(function (r) {
        return h('tr', null,
          h('td', { class: 'num', text: String(r[0]) }),
          h('td', null, h('code', { text: String(r[1]) })),
          h('td', { text: String(r[2]) + '(' + String(r[3]) + ')' }),
          h('td', null, /CASCADE/.test(String(r[4])) ? pill(String(r[4]), 'bad') : pill(String(r[4]))),
          h('td', { text: String(r[5]) }));
      });
      c.appendChild(tableOf([{ label: 'id', num: true }, 'column', 'references', 'on delete', 'on update'],
        frows, { minWidth: '560px' }));
      c.appendChild(h('p', { class: 'hint', text: 'A composite foreign key appears as several rows sharing one id. ' +
        'ON DELETE CASCADE is marked because it is the delete action that removes rows you did not name.' }));
    }

    var master = tryFirst("SELECT sql FROM sqlite_master WHERE name = '" + name + "'");
    c.appendChild(h('h4', { text: 'Route A — the DDL SQLite stored' }));
    c.appendChild(sqlBox(master.ok && master.value !== null ? String(master.value) : '(no stored DDL)'));

    var declared = S.TABLE_DDL[name] || S.LEGACY_DDL[name] || null;
    c.appendChild(h('div', { class: 'row-between' },
      h('h4', { text: 'Route B — the DDL schema.js declares' }),
      btn(state.schemaRoute ? 'Hide' : 'Show it beside Route A',
        function () { state.schemaRoute = !state.schemaRoute; rerender(); }, 'small no-print', 'schema:route')));
    if (state.schemaRoute) {
      if (!declared) {
        c.appendChild(h('div', { class: 'empty', text: 'schema.js does not declare a table by this name — it is one you made.' }));
      } else {
        c.appendChild(sqlBox(declared));
        var a = master.ok && master.value !== null ? String(master.value) : '';
        var b = String(declared).replace(/;\s*$/, '');
        c.appendChild(h('p', { class: 'hint' },
          'fnv1a(Route A) = ', h('code', { text: String(D.fnv1a(a)) }),
          ' · fnv1a(Route B) = ', h('code', { text: String(D.fnv1a(b)) }),
          a === b ? ' — byte-identical here.' :
            ' — different, and that is expected: SQLite stores the text it was given at the version that ' +
            'created the table, and a rebuilt table carries the rebuild\'s text. The hashes are shown ' +
            'rather than hidden because a panel that quietly normalised them could not be caught lying.'));
      }
    }
    return c;
  }
  RENDER.schema = renderSchema;

  /* ======================================================== MIGRATIONS === */

  function rungOf(v) { return state.rungs[v] || null; }

  function statementText(mig) {
    var out = [], i, st;
    for (i = 0; i < mig.statements.length; i++) {
      st = mig.statements[i];
      if (st.sql) out.push('-- ' + st.label + (st.guard ? '   [runs only if the guard says the object is missing]' : '') + '\n' + st.sql + ';');
      else if (st.rebuild) out.push('-- ' + st.label + '\n-- steps 3..9 of the twelve, on ' + st.rebuild + ': capture, create, copy, drop, rename, restore indexes, restore triggers');
      else if (st.js) out.push('-- ' + st.label + '\n-- a JavaScript backfill, because SQL cannot split a comma-joined string into rows:\n-- ' + st.preview);
    }
    return out.join('\n\n');
  }

  function diffBlock(report) {
    var wrap = h('div');
    if (!report.census) {
      wrap.appendChild(h('p', { class: 'hint', text: 'This rung ran with the census switched off.' }));
      return wrap;
    }
    var before = report.census.before, after = report.census.after, diff = report.census.diff;
    var dec = report.declaration;
    var byTable = {};
    if (dec) {
      dec.violations.forEach(function (v) { byTable[v.table] = v; });
    }
    wrap.appendChild(h('p', { class: 'small' },
      'census checksum ', h('code', { text: String(before.checksum) }), ' → ',
      h('code', { text: String(after.checksum) }), ' · ', String(before.tableCount), ' → ',
      String(after.tableCount), ' tables · ', num(before.totalRows), ' → ', num(after.totalRows), ' rows'));
    if (!diff.length) {
      wrap.appendChild(h('div', { class: 'diffrow declared' },
        h('span', { class: 'mk', text: '✓' }),
        h('span', { class: 't', text: 'not one row of any table moved — ' + after.tableCount +
          ' tables walked, folded and compared across two separate censuses' })));
    }
    diff.forEach(function (d) {
      var bad = !!byTable[d.table];
      var line = d.table + '  ' +
        (d.rowsBefore === null ? '(absent)' : num(d.rowsBefore)) + ' → ' +
        (d.rowsAfter === null ? '(dropped)' : num(d.rowsAfter)) + ' rows' +
        (d.hashChanged ? '  fold ' + d.hashBefore + ' → ' + d.hashAfter : '  fold unchanged');
      wrap.appendChild(h('div', { class: 'diffrow ' + (bad ? 'undeclared' : 'declared') },
        h('span', { class: 'mk', text: bad ? '✗' : '✓' }),
        h('span', { class: 't', text: line }),
        h('span', null, pill(report.declares && report.declares[d.table] ? report.declares[d.table] : 'undeclared',
          report.declares && report.declares[d.table] ? 'ok' : 'bad'))));
    });
    if (dec) {
      /* census.js writes a complete English sentence naming the table and the
       * numbers. It is printed verbatim: rebuilding it from the fields would let
       * the page and the assertion suite describe one violation two ways. */
      dec.violations.forEach(function (v) {
        wrap.appendChild(callout('bad', '[' + v.rule + ']', v.message));
      });
      wrap.appendChild(h('p', { class: 'hint', text: dec.checked + ' table(s) compared, ' + dec.declared +
        ' declared in advance by schema.js, ' + dec.violations.length + ' violation(s). ' +
        (dec.ok ? 'The step touched only what it said it would.' : 'The step touched something it did not declare.') }));
    }
    if (report.declaresNotCensusable && report.declaresNotCensusable.length) {
      wrap.appendChild(h('p', { class: 'hint', text: 'Declared but deliberately outside the census: ' +
        report.declaresNotCensusable.join(', ') + ' — the census refuses to read the migration log at all, ' +
        'because a table every rung writes to cannot be evidence about a rung.' }));
    }
    return wrap;
  }

  function reportBlock(report, refusedOne) {
    var wrap = h('div');
    var i;

    if (report.demos && report.demos.length) {
      wrap.appendChild(h('h4', { text: 'What was tried first, outside the transaction' }));
      var drows = report.demos.map(function (d) {
        return h('tr', null,
          h('td', { text: d.label }),
          h('td', null, d.got === 'error' ? h('span', { class: 'cons-err', text: d.message })
            : h('span', { class: 'cons-acc', text: 'accepted' })),
          h('td', null, d.asExpected ? pill('as expected', 'ok') : pill('NOT as expected', 'bad')),
          h('td', { text: d.why || '' }));
      });
      wrap.appendChild(tableOf(['attempt', 'what SQLite said', '', 'why it matters'], drows, { minWidth: '700px', prose: true }));
    }

    if (report.steps && report.steps.length) {
      wrap.appendChild(h('h4', { text: 'Statements, in order, with the time each one took' }));
      var srows = report.steps.map(function (s) {
        var kind = s.skipped ? 'skipped by its guard' : s.rebuild ? ('rebuild of ' + s.rebuild + ': ' +
          s.captured + ' object(s) captured, ' + num(s.copied) + ' row(s) copied') :
          s.js ? ('JavaScript backfill, ' + num(s.jsRows) + ' row(s)') : 'SQL';
        return h('tr', null,
          h('td', { text: s.label }),
          h('td', { text: kind }),
          h('td', { class: 'num', text: s.ms + ' ms' }));
      });
      wrap.appendChild(tableOf(['statement', 'what it was', { label: 'measured', num: true }], srows, { minWidth: '560px', prose: true }));
      /* One-shot, and labelled as such. A migration statement cannot be run five
       * times and averaged; only ROMBAK_ENGINE.timeMean() figures on the Plans
       * tab are means, and those print their own N. */
      wrap.appendChild(h('p', { class: 'hint', text: 'Every figure above is a single measurement of a ' +
        'statement that can only run once. Nothing here is a mean.' }));
    }

    if (report.rebuilds && report.rebuilds.length) {
      report.rebuilds.forEach(function (rb) {
        wrap.appendChild(h('h4', { text: 'The twelve steps, on ' + rb.table }));
        var rrows = rb.steps.map(function (s) {
          return h('tr', null,
            h('td', { class: 'num', text: String(s.n) }),
            h('td', { text: s.label }),
            h('td', { text: s.note || '' }),
            h('td', { class: 'num', text: s.ms + ' ms' }));
        });
        wrap.appendChild(tableOf([{ label: 'step', num: true }, 'what it did', 'detail',
          { label: 'ms', num: true }], rrows, { minWidth: '620px', prose: true }));
        wrap.appendChild(h('p', { class: 'hint', text: 'Steps 1, 2, 10, 11 and 12 — the pragma, BEGIN, ' +
          'foreign_key_check, COMMIT and the pragma again — belong to the RUNG, not to the table, because ' +
          'two of these rungs rebuild two tables inside one transaction. They are reported below.' }));
      });
    }

    var fkr = h('p', { class: 'small' },
      'step 1  PRAGMA foreign_keys read back ', h('code', { text: String(report.fkBefore) }),
      ' · step 12 read back ', h('code', { text: String(report.fkAfter) }),
      ' · PRAGMA foreign_key_check returned ',
      h('code', { text: report.fkCheck && report.fkCheck.length ? JSON.stringify(report.fkCheck) : '[]' }),
      ' inside the transaction');
    wrap.appendChild(fkr);

    if (refusedOne) {
      wrap.appendChild(callout('bad', 'This rung refused.', report.error));
      if (report.rollback) {
        wrap.appendChild(h('p', { class: 'small' },
          'The rollback left no trace: ',
          h('code', { text: String(report.rollback.checksumBefore) }), ' → ',
          h('code', { text: String(report.rollback.checksumAfter) }), ' over ',
          String(report.rollback.tablesCompared), ' tables, census diff ',
          h('code', { text: String(report.rollback.diff.length) }), ' entr' + (report.rollback.diff.length === 1 ? 'y' : 'ies'),
          '. ', report.rollback.noTrace
            ? 'Every table matched in row count AND in fold, which is a stronger statement than the checksum alone.'
            : 'THE ROLLBACK DID NOT RESTORE THE DATABASE — that is a defect, and it is on screen because the census found it.'));
      }
      if (report.refusal) {
        wrap.appendChild(h('h4', { text: 'The rows it refused over' }));
        wrap.appendChild(sqlBox(report.refusal.finder));
        wrap.appendChild(resultTable({ columns: [], values: report.refusal.rows }, 10));
        wrap.appendChild(h('p', { class: 'hint', text: 'The refusal names the rows, not the table. ' +
          '"2 rows would not survive" is actionable at 07:00 on a Monday; "the money migration failed" is not.' }));
        wrap.appendChild(h('h4', { text: 'The one-statement fix' }));
        report.refusal.fixes.forEach(function (f) {
          wrap.appendChild(h('p', { class: 'small', text: f.label }));
          wrap.appendChild(sqlBox(f.sql));
          wrap.appendChild(h('p', { class: 'hint', text: f.why }));
        });
      }
    } else if (report.skipped) {
      wrap.appendChild(callout(report.ok ? 'ok' : 'bad', report.ok ? 'Already applied.' : 'Already applied — and something moved anyway.',
        report.ok
          ? 'The guard — a query about the SHAPE of the database, never about the migration log — says the object ' +
            'this rung creates is already there, so nothing ran. "Nothing" is a claim like any other: the census ' +
            'below was taken TWICE, either side of the nothing, and the two were compared. It used to be taken ' +
            'once and compared with itself, which is a tick nothing could have removed.'
          : report.error));
    }

    if (report.verify && report.verify.length) {
      wrap.appendChild(h('h4', { text: 'Verified afterwards, by raw SELECTs the runner does not interpret' }));
      report.verify.forEach(function (v) {
        wrap.appendChild(h('p', { class: 'small', text: v.label }));
        wrap.appendChild(sqlBox(v.sql));
        wrap.appendChild(h('div', { class: 'planbox', text: JSON.stringify(v.rows) }));
      });
    }

    if (report.verifyAgainstBefore && report.verifyAgainstBefore.length) {
      wrap.appendChild(h('h4', { text: 'And against a figure captured BEFORE the rung ran' }));
      report.verifyAgainstBefore.forEach(function (v) {
        var box = h('div');
        box.appendChild(h('p', { class: 'small', text: v.label }));
        box.appendChild(h('div', { class: 'grid2' },
          h('div', null, h('p', { class: 'hint', text: 'captured before' }), sqlBox(v.beforeSql),
            h('div', { class: 'planbox', text: JSON.stringify(v.before) })),
          h('div', null, h('p', { class: 'hint', text: 'read after' }), sqlBox(v.afterSql),
            h('div', { class: 'planbox', text: JSON.stringify(v.after) }))));
        box.appendChild(v.agree ? callout('ok', 'They agree.',
          'Two different tables, two different columns, two different schema versions. This is the shape a ' +
          'backfill check has to have: re-running the backfill\'s own expression against its own output ' +
          'can only ever agree with itself.')
          : callout('bad', 'They do not agree.', 'The rung moved money that it should have carried across unchanged.'));
        wrap.appendChild(box);
      });
    }

    if (report.census) {
      wrap.appendChild(h('h4', { text: 'The census — every table, before and after' }));
      wrap.appendChild(h('p', { class: 'note' },
        'Two routes, and they share no code, no table list, no predicate and no aggregate. Route A is ',
        h('code', { text: 'declares' }), ' — static data written in schema.js before the SQL was. Route B is ',
        h('code', { text: 'ROMBAK_CENSUS.take()' }), ', hand-written JavaScript folding raw rows out of a ' +
        'plan-confirmed SCAN. census.js cannot see schema.js.'));
      wrap.appendChild(diffBlock(report));
    }

    wrap.appendChild(h('p', { class: 'small' },
      'PRAGMA user_version afterwards, read fresh: ', h('code', { text: String(report.userVersion) }),
      ' · max(schema_migration.version): ', h('code', { text: String(report.loggedVersion) }),
      report.userVersion === report.loggedVersion ? ' — the pragma and the log agree.'
        : ' — THEY DISAGREE, which means the rung wrote a log row it did not earn.',
      ' · ', String(report.ms), ' ms in total.'));
    return wrap;
  }

  function applyRung(v) {
    var db = dbh();
    if (!db) return;
    var prev = rungOf(v - 1);
    var before = prev && prev.applied && prev.applied.census ? prev.applied.census.after : null;
    var r = RN.applyOne(v, { db: db, before: before });
    var slot = { refused: null, applied: null };
    if (r.refused) {
      slot.refused = r;
      say('v' + v + ' refused: ' + r.error);
    } else slot.applied = r;
    state.rungs[v] = slot;
    afterLadderChange();
    if (!r.refused) say('v' + v + ' applied. ' + (r.census ? r.census.diff.length + ' table(s) changed.' : ''));
  }

  function fixAndReapply(v) {
    var db = dbh();
    if (!db) return;
    var fixes = RN.fixRefusal(v, { db: db });
    var r = RN.applyOne(v, { db: db });
    var slot = state.rungs[v] || { refused: null, applied: null };
    slot.fixes = fixes;
    if (r.refused) { slot.refused = r; slot.applied = null; }
    else slot.applied = r;
    state.rungs[v] = slot;
    afterLadderChange();
    say(r.refused ? ('v' + v + ' still refuses: ' + r.error)
      : ('The fix ran and v' + v + ' applied unchanged.'));
  }

  /* Rewind is not a down-migration: it throws the database away, reopens v1's
   * exported bytes and replays forward, re-applying the one-statement fixes on
   * the way because the defects are in the FIXTURE and not in the schema. It also
   * REPLACES the live handle, which is why ours is re-read from the engine
   * afterwards rather than kept. */
  function rewindReplay(target) {
    var out = RN.rewindTo(target, {});
    if (out.ok === false && out.refused) { say(out.refused); state.ladderMsg = out.refused; rerender(); return; }
    state.db = E.db();
    state.rungs = {};
    recordWalk(out.reports);
    afterLadderChange();
    say('Rewound to v1\'s bytes and replayed to v' + target + '. ' +
      out.reports.length + ' rung report(s), ' + countRefusals(out.reports) + ' refusal(s) on the way.');
  }

  function countRefusals(reports) {
    var n = 0, i;
    for (i = 0; i < reports.length; i++) if (reports[i].refused) n++;
    return n;
  }

  function recordWalk(reports) {
    var i, r;
    for (i = 0; i < reports.length; i++) {
      r = reports[i];
      var slot = state.rungs[r.version] || { refused: null, applied: null };
      if (r.refused) slot.refused = r; else slot.applied = r;
      state.rungs[r.version] = slot;
    }
  }

  /* Every path that can move the schema ends here: the version is re-read with a
   * fresh pragma rather than taken from the runner's return value, and the live
   * invariants are recomputed by both routes. */
  function afterLadderChange() {
    var db = dbh();
    state.version = db ? RN.userVersion({ db: db }) : 0;
    state.buildLimits = null;
    state.plans = {};
    state.plansMeasured = false;
    recomputeLive();
    rerender();
  }

  /* A down is displayed for all nine rungs and RUNNABLE for the two that have
   * one, and only while the database is actually standing on that rung — running
   * v3's down at v9 would drop fifteen indexes six later rungs depend on. The
   * runner has no down path, so the two extra statements a down needs are here:
   * the pragma goes back one and the log row is removed, or the next Apply would
   * find its own row already present. */
  function runDown(v) {
    var db = dbh(), mig = S.MIGRATIONS[v - 1], i;
    if (!db || !mig.down.statements) return;
    var before = C.take(db.exec.bind(db));
    var errs = [];
    db.run('BEGIN');
    try {
      for (i = 0; i < mig.down.statements.length; i++) db.run(mig.down.statements[i].sql);
      db.run('DELETE FROM schema_migration WHERE version = ' + Number(v));
      db.run('COMMIT');
    } catch (e) {
      errs.push(e.message);
      try { db.run('ROLLBACK'); } catch (e2) { /* nothing open */ }
    }
    if (!errs.length) RN.setUserVersion(v - 1, { db: db });
    var after = C.take(db.exec.bind(db));
    state.downs = state.downs || {};
    state.downs[v] = { errors: errs, diff: C.diff(before, after), checksumBefore: before.checksum, checksumAfter: after.checksum };
    afterLadderChange();
    say(errs.length ? ('The down failed: ' + errs.join(' ')) : ('v' + v + ' is down. The database is now at v' + (v - 1) + '.'));
  }

  function renderMigrations(p) {
    var db = dbh();
    p.appendChild(h('h2', { text: 'Nine rungs, against data that is already in it' }));
    p.appendChild(h('p', { class: 'note' },
      'Every rung below ran in this tab, just now, in the order shown, against a fixture poured in at v1. ',
      'Four of them refuse. The refusals are the point: a migration that cannot refuse is a migration that ' +
      'has already destroyed something.'));

    if (!db) { p.appendChild(callout('warn', 'The ladder has not been walked yet.', state.bootStep)); return; }

    var strip = h('div', { class: 'summary' });
    var uv = tryFirst('PRAGMA user_version');
    var logged = tryFirst('SELECT max(version) FROM schema_migration');
    strip.appendChild(stat('at version', uv.ok ? String(uv.value) : '—', 'read with a fresh PRAGMA user_version'));
    strip.appendChild(stat('the log says', logged.ok ? String(logged.value) : '—', 'max(schema_migration.version) — a different route to the same claim'));
    var applied = 0, refused = 0, k;
    for (k = 1; k <= S.TARGET_VERSION; k++) {
      var sl = rungOf(k);
      if (sl && sl.applied) applied++;
      if (sl && sl.refused) refused++;
    }
    strip.appendChild(stat('rungs applied', applied + '/' + S.TARGET_VERSION, refused + ' refused at least once on the way'));
    p.appendChild(strip);

    var ctl = h('div', { class: 'controls no-print' },
      btn('Rewind to v1 and stop', function () { rewindReplay(1); }, 'small', 'mig:rewind1'),
      btn('Rewind and replay the whole ladder', function () { rewindReplay(S.TARGET_VERSION); }, 'small primary', 'mig:replay'),
      btn('Fingerprint this database', function () {
        var f = RN.fingerprint({ db: db });
        rearm(db);          // fingerprint() calls db.export(), which drops the pragma
        state.fingerprint = f;
        rerender();
        say('Fingerprint taken. Checksum ' + f.checksum + ', ' + f.totalRows + ' rows.');
      }, 'small', 'mig:fingerprint'));
    p.appendChild(ctl);
    if (state.fingerprint) {
      p.appendChild(h('div', { class: 'planbox', text: JSON.stringify(state.fingerprint, null, 1) }));
      p.appendChild(h('p', { class: 'hint', text: 'Rewind, replay, and take it again: every field must be ' +
        'identical. The export LENGTH is in there; the export BYTES are not, because two databases with the ' +
        'same contents can differ in free-page layout and a byte comparison would report a difference that ' +
        'is not one.' }));
    }
    if (state.ladderMsg) p.appendChild(callout('warn', 'Refused.', state.ladderMsg));

    /* ---- the planted defects ---- */
    var dc = card('Four defects in this fixture were planted, and one was not',
      'Each is the residue of something an application did before the constraint existed. They are named here ' +
      'rather than discovered, because a fixture whose defects are secret is a fixture nobody can check.');
    var drows = RN.plantedDefects().map(function (d) {
      return h('tr', null,
        h('td', null, h('code', { text: d.id })),
        h('td', { text: d.defect }),
        h('td', { text: d.history }),
        h('td', { text: d.caught }));
    });
    dc.appendChild(tableOf(['', 'the defect', 'what it is the residue of', 'what catches it'], drows, { minWidth: '760px', prose: true }));
    p.appendChild(dc);

    /* ---- the nine rungs ---- */
    var v;
    for (v = 1; v <= S.TARGET_VERSION; v++) p.appendChild(renderRung(v));
  }

  function renderRung(v) {
    var mig = S.MIGRATIONS[v - 1];
    var slot = rungOf(v);
    var applied = slot && slot.applied;
    var refused = slot && slot.refused;
    var cls = applied ? 'applied' : refused ? 'refused' : '';
    var box = h('section', { class: 'rung' + (cls ? ' ' + cls : '') });

    box.appendChild(h('div', { class: 'row-between' },
      h('div', { class: 'stack' },
        h('span', { class: 'rung-v', text: 'v' + mig.version + (mig.needsRebuild ? '  ·  needs a table rebuild' : '') }),
        h('h3', { text: mig.name })),
      h('div', null,
        applied && refused ? pill('refused, then applied after the fix', 'warn')
          : applied ? pill('applied', 'ok') : refused ? pill('refused', 'bad') : pill('not applied yet'))));

    box.appendChild(h('p', { text: mig.why }));
    box.appendChild(h('p', { class: 'small' },
      'foreign keys ', h('code', { text: mig.fk === 'off' ? 'OFF' : 'ON' }), ' for this rung — ', mig.fkWhy));
    if (mig.mayRefuse) box.appendChild(h('p', { class: 'hint', text: 'May refuse: ' + mig.mayRefuse }));
    box.appendChild(h('p', { class: 'small' }, 'declares: ',
      h('code', { text: JSON.stringify(mig.declares) })));

    /* ---- controls ---- */
    var ctl = h('div', { class: 'controls no-print' });
    if (!applied) {
      ctl.appendChild(btn(refused ? 'Apply again' : 'Apply', function () { applyRung(v); }, 'small primary', 'mig:apply:' + v));
    }
    if (refused && !applied && mig.refusal) {
      ctl.appendChild(btn('Apply the one-statement fix and re-apply', function () { fixAndReapply(v); }, 'small', 'mig:fix:' + v));
    }
    ctl.appendChild(btn(state.openDown === v ? 'Hide the down' : 'Down',
      function () { state.openDown = state.openDown === v ? null : v; rerender(); }, 'small ghost', 'mig:down:' + v));
    ctl.appendChild(btn('Rewind and replay to here', function () { rewindReplay(v); }, 'small ghost', 'mig:rw:' + v));
    box.appendChild(ctl);

    if (state.openDown === v) {
      var dn = h('div');
      if (mig.down.refused) {
        dn.appendChild(callout('warn', 'There is no down for this rung.', mig.down.refused));
      } else {
        dn.appendChild(h('p', { class: 'small', text: mig.down.why }));
        dn.appendChild(sqlBox(mig.down.statements.map(function (s) { return s.sql + ';'; }).join('\n')));
        if (state.version === v) {
          dn.appendChild(btn('Run the down (' + mig.down.statements.length + ' statement' +
            (mig.down.statements.length === 1 ? '' : 's') + ')', function () { runDown(v); }, 'small danger', 'mig:rundown:' + v));
        } else {
          dn.appendChild(h('p', { class: 'hint', text: 'Runnable only while the database is standing on v' + v +
            ' — it is at v' + state.version + '. Rewind to here first: running this down from a later version ' +
            'would remove objects the rungs above it depend on, which is a different bug from the one the ' +
            'down is for.' }));
        }
      }
      var dres = state.downs && state.downs[v];
      if (dres) {
        dn.appendChild(dres.errors.length ? callout('bad', 'The down failed.', dres.errors.join(' '))
          : callout('ok', 'The down ran.', 'checksum ' + dres.checksumBefore + ' → ' + dres.checksumAfter +
            ', ' + dres.diff.length + ' table(s) changed. The log row for v' + v + ' was removed too, or the ' +
            'next Apply would find it already there.'));
      }
      box.appendChild(dn);
    }

    /* ---- the SQL, exactly what runs ---- */
    box.appendChild(h('h4', { text: 'What this rung runs' }));
    box.appendChild(sqlBox(statementText(mig)));
    box.appendChild(h('p', { class: 'hint', text: 'The array the page displays and the array the engine ' +
      'executes are the same array in schema.js. There is no second copy of this SQL anywhere.' }));

    if (v === 7) box.appendChild(twelveStepsBlock());

    if (refused) box.appendChild(reportBlock(refused, true));
    if (slot && slot.fixes) {
      box.appendChild(h('h4', { text: 'The fix, as run' }));
      slot.fixes.forEach(function (f) {
        box.appendChild(h('p', { class: 'small' }, f.ok ? pill('ran', 'ok') : pill('failed', 'bad'), ' ', f.label));
        box.appendChild(sqlBox(f.sql));
        if (f.error) box.appendChild(h('p', { class: 'cons-err', text: f.error }));
      });
    }
    if (applied) box.appendChild(reportBlock(applied, false));
    return box;
  }

  function twelveStepsBlock() {
    var spec = S.MIGRATIONS[6].rebuilds.encounter;
    var steps = RN.twelveSteps('encounter', spec);
    var wrap = h('div');
    wrap.appendChild(h('h4', { text: 'The twelve steps in full, on encounter' }));
    wrap.appendChild(h('p', { class: 'note', text: 'This is the one rung where the mapping is one to one, so ' +
      'all twelve are shown. Five of them belong to the rung and seven to the table, which is forced: v6 and ' +
      'v8 each rebuild two tables inside one transaction.' }));
    steps.forEach(function (s) {
      wrap.appendChild(h('p', { class: 'small' },
        h('code', { text: String(s.n) }), ' ', s.label, ' ',
        pill(s.scope === 'rung' ? 'rung scope' : 'table scope', s.scope === 'rung' ? 'info' : null)));
      wrap.appendChild(sqlBox(s.sql));
      wrap.appendChild(h('p', { class: 'hint', text: s.why }));
    });
    return wrap;
  }
  RENDER.migrations = renderMigrations;

  /* =========================================================== REBUILD === */

  /* Every panel on this tab runs on its own SQL.Database instance opened from
   * exported bytes, never on the database in front of you — four of them commit
   * destructive rebuilds. The bytes come from the ladder walk: the four variants
   * need a v6 export, because at v7 `encounter` has already been rebuilt and the
   * demonstration would be of nothing, and §0.2 needs a v9 one, because that is
   * where the audit triggers exist to be lost. */
  function computeRebuild() {
    if (state.rebuild || state.rebuildErr) return;
    if (!state.bytes6 || !state.bytes9) {
      state.rebuildErr = 'The ladder walk did not reach v6 and v9, so there are no bytes to open.';
      return;
    }
    try {
      state.rebuild = RN.rebuildVariants(state.bytes6, { census: false });
      state.naive.visit = RN.naiveLoses(state.bytes6, 'visit');
      state.naive.audit_entry = RN.naiveLoses(state.bytes9, 'audit_entry');
      state.audit.on = RN.auditNaive(state.bytes9, 'on');
      state.audit.off = RN.auditNaive(state.bytes9, 'off');
      state.wrong = RN.wrongFixes(state.bytes9);
    } catch (e) {
      state.rebuildErr = e.message || String(e);
    }
  }

  function snapLine(label, before, after) {
    var moved = before !== after;
    return h('div', { class: 'diffrow ' + (moved ? 'undeclared' : 'declared') },
      h('span', { class: 'mk', text: moved ? '✗' : '✓' }),
      h('span', { class: 't', text: label + '  ' + (before === null ? '—' : num(before)) + ' → ' +
        (after === null ? '(gone)' : num(after)) + (moved ? '  rows disappeared' : '') }));
  }

  function masterList(rows) {
    var s = [], i;
    for (i = 0; i < rows.length; i++) s.push(rows[i].type + ':' + rows[i].name + (rows[i].auto ? ' (auto)' : ''));
    return s.length ? s.join('\n') : '(nothing)';
  }

  function renderRebuild(p) {
    p.appendChild(h('h2', { text: 'The rebuild that commits, passes every check, and has deleted rows' }));
    p.appendChild(h('p', { class: 'note' },
      'The difference between the migration that refuses and the migration that silently destroys is one word ' +
      'in a child table\'s DDL, or one child table that happens to be empty this quarter. Neither is visible ' +
      'from the script you are running.'));
    p.appendChild(callout('bad', 'A clean integrity check is not evidence of a correct migration.',
      'PRAGMA foreign_key_check returns the empty set in every one of the four panels below, including the two ' +
      'that lose rows. It validates the b-tree structure and the foreign keys that still exist; it has no ' +
      'opinion about the rows that are no longer there to violate anything.'));

    computeRebuild();
    if (state.rebuildErr) { p.appendChild(failCard('The four variants', state.rebuildErr)); return; }
    if (!state.rebuild) { p.appendChild(h('div', { class: 'empty', text: 'Computing…' })); return; }

    p.appendChild(h('div', { class: 'controls no-print' },
      btn('Run all four again', function () {
        state.rebuild = null; state.naive = {}; state.audit = {}; state.wrong = null; state.rebuildErr = null;
        computeRebuild(); rerender();
        say('The four variants ran again on fresh instances.');
      }, 'small', 'rebuild:recompute'),
      h('span', { class: 'hint', text: 'Each run opens ' + num(state.rebuild.bytes) +
        ' bytes into a new instance per panel. Nothing here touches the database on the other tabs.' })));

    var grid = h('div', { class: 'rebuild-grid' });
    state.rebuild.variants.forEach(function (vv) { grid.appendChild(variantCard(vv)); });
    p.appendChild(grid);

    /* ---- the extra finding, on the two tables where it can be shown ---- */
    var lc = card('And every index and trigger on the rebuilt table is gone, silently',
      'This cannot be demonstrated on encounter: in this schema encounter carries no named index and no ' +
      'trigger at all, only an auto-index that the new table\'s own UNIQUE(visit_id) recreates. So it is ' +
      'shown on visit, which has six named indexes, and on audit_entry, which has three partial indexes and ' +
      'the three triggers that make it append-only.');
    ['visit', 'audit_entry'].forEach(function (t) {
      var L = state.naive[t];
      if (!L) return;
      lc.appendChild(h('h4', { text: t + ' — ' + num(L.rowsBefore) + ' rows before, ' + num(L.rowsAfter) + ' after' }));
      lc.appendChild(h('p', { class: 'small', text: 'schema.js says this rebuild loses: ' + L.loses }));
      lc.appendChild(h('div', { class: 'grid2' },
        h('div', null, h('p', { class: 'hint', text: 'sqlite_master before' }), h('div', { class: 'planbox', text: masterList(L.masterBefore) })),
        h('div', null, h('p', { class: 'hint', text: 'sqlite_master after' }), h('div', { class: 'planbox', text: masterList(L.masterAfter) }))));
      lc.appendChild(L.lost.length
        ? callout('bad', 'Lost, with no error anywhere:', L.lost.join(', ') +
          '. The rows survived — ' + (L.rowsKept ? 'all ' + num(L.rowsAfter) + ' of them' : 'they did not') +
          ' — which is exactly why nobody notices.')
        : callout('ok', 'Nothing was lost here.', 'Which is the point of showing two tables rather than one.'));
    });
    p.appendChild(lc);

    /* ---- §0.2 ---- */
    var ac = card('The armed audit table: the pragma protects your children and does nothing for your triggers',
      'The claim this lab was built from was that a naive rebuild of the audit table would be refused, by the ' +
      'self-referencing prev_hash foreign key and by the two append-only triggers. It is refused by neither. ' +
      'BEFORE DELETE triggers do not fire on DROP TABLE\'s implicit delete, and a DEFERRABLE INITIALLY ' +
      'DEFERRED self-key is checked at COMMIT, by which time the new table satisfies it.');
    ['on', 'off'].forEach(function (mode) {
      var A = state.audit[mode];
      if (!A) return;
      ac.appendChild(h('h4', { text: 'PRAGMA foreign_keys = ' + mode.toUpperCase() + ' before BEGIN — the pragma reads ' + A.pragmaReads }));
      ac.appendChild(h('p', { class: 'small' }, 'The guarantee, live before the rebuild touches it: ',
        h('span', { class: 'cons-err', text: (A.updateBefore && A.updateBefore.message) || 'no error' }), ' · ',
        h('span', { class: 'cons-err', text: (A.deleteBefore && A.deleteBefore.message) || 'no error' })));
      ac.appendChild(naiveStepTable(A.naive));
      if (A.committed) {
        ac.appendChild(callout('bad', 'It committed.',
          'All ' + num(A.rowsAfter) + ' rows survived and the chain head did not move. ' +
          A.triggersLost + ' trigger(s) are gone: sqlite_master reports ' +
          (A.triggersAfter.length ? A.triggersAfter.join(', ') : 'no triggers at all') +
          '. PRAGMA foreign_key_check afterwards: ' + JSON.stringify(A.fkCheckAfter || []) +
          '. And the guarantee with it — an UPDATE on the rebuilt table now returns ' +
          /* auditNaive fills updateAfter on the OFF branch only. Reading it
           * unguarded is how a page renders one branch and throws on the other. */
          (A.updateAfter && A.updateAfter.ok ? 'OK' : 'an error') + '.'));
      } else {
        ac.appendChild(callout('warn', 'It did not commit.',
          'COMMIT returned ' + (A.commitAgain ? A.commitAgain.message : '') + ' — and returns it again, ' +
          'because the deferred self-key is a COUNTER that DROP TABLE\'s implicit delete incremented and the ' +
          'rename never decremented. The transaction stays open' +
          (A.stillOpen ? ' (BEGIN is refused, so it is genuinely still open)' : '') +
          '; ROLLBACK restored ' + num(A.rowsAfter) + ' rows, and all ' + A.triggersAfter.length +
          ' triggers are still there. The pragma saved this one.'));
      }
    });
    p.appendChild(ac);

    /* ---- the two fixes that look like fixes ---- */
    var wc = card('The two fixes a migration author reaches for, and what they actually do',
      'Both return OK. The first changes nothing at all. The second changes something — and not the ' +
      'thing you wanted: it defers the CHECKS, so the DROP is permitted and the CASCADE fires, and then ' +
      'the deferred check refuses the COMMIT. Nothing is written either way.');
    (state.wrong || []).forEach(function (w) {
      wc.appendChild(h('h4', { text: w.label }));
      wc.appendChild(sqlBox(w.statements.join(';\n') + ';'));
      wc.appendChild(h('p', { class: 'small' }, 'read back with ', h('code', { text: w.readBack }), ': ',
        h('code', { text: String(w.got) }), ' — expected ', h('code', { text: String(w.expect) }), ' ',
        w.confirmed ? pill('confirmed', 'ok') : pill('did not reproduce', 'bad')));
      if (w.drop) {
        wc.appendChild(h('p', { class: 'small', text: 'DROP TABLE encounter afterwards: ' +
          (w.drop.ok ? 'OK' : w.drop.message) + ' — addendum went from ' + num(w.addendumBefore) +
          ' to ' + num(w.addendumAfter) + ' rows.' }));
        /* Carried to COMMIT on purpose. The DROP succeeding is the half that
         * looks like a fix; the COMMIT refusing is the half that says what
         * deferring actually bought, which is nothing but a later refusal. */
        if (w.commit) {
          wc.appendChild(h('p', { class: 'small' }, 'and then COMMIT: ',
            w.commit.ok ? h('span', { class: 'cons-acc', text: 'OK — the rows really are gone' })
              : h('span', { class: 'cons-err', text: w.commit.message }),
            typeof w.addendumRolledBack === 'number'
              ? h('span', { text: ' — after ROLLBACK, addendum holds ' + num(w.addendumRolledBack) +
                  ' rows again, so the deferred check refused the transaction rather than the statement.' })
              : null));
        }
      }
      wc.appendChild(h('p', { class: 'hint', text: w.why }));
    });
    p.appendChild(wc);

    var dc = card('What you can do with this that this page cannot');
    dc.appendChild(h('p', null, 'Export the database on the Console tab, open it in your own ',
      h('code', { text: 'sqlite3' }), ', and run ', h('code', { text: 'SELECT count(*) FROM addendum;' }),
      ' — the rows are missing there too, which is the only way to know the loss is in the file and not in ' +
      'this page\'s arithmetic. Or use the Console to rebuild ', h('code', { text: 'encounter_diagnosis' }),
      ' with ', h('code', { text: 'RESTRICT' }), ' restored, run the naive script again, and watch it start ' +
      'refusing — which proves the deletion came from that one word.'));
    p.appendChild(dc);
  }

  function naiveStepTable(naive) {
    var rows = naive.steps.map(function (s) {
      return h('tr', null,
        h('td', { text: s.label }),
        h('td', null, s.ok ? h('span', { class: 'cons-acc', text: s.message || 'OK' })
          : h('span', { class: 'cons-err', text: s.message })),
        h('td', { class: 'num', text: s.ms + ' ms' }));
    });
    return tableOf(['the naive script, statement by statement', 'what SQLite answered',
      { label: 'ms', num: true }], rows, { minWidth: '420px', prose: true });
  }

  function variantCard(vv) {
    var c = h('section', { class: 'card' });
    c.appendChild(h('h3', { text: vv.id + '. ' + vv.label }));
    c.appendChild(h('p', { class: 'small' }, h('b', { text: 'What differs: ' }), vv.differs));
    if (vv.childDdlLine) c.appendChild(sqlBox(vv.childDdlLine));

    var naive = vv.naive;
    if (naive) c.appendChild(naiveStepTable(naive));
    else if (vv.rung) {
      var rows = [];
      vv.rung.rebuilds.forEach(function (rb) {
        rb.steps.forEach(function (s) {
          rows.push(h('tr', null, h('td', { class: 'num', text: String(s.n) }), h('td', { text: s.label }),
            h('td', { text: s.note || '' }), h('td', { class: 'num', text: s.ms + ' ms' })));
        });
      });
      c.appendChild(tableOf([{ label: 'step', num: true }, 'the twelve, properly', 'detail',
        { label: 'ms', num: true }], rows, { minWidth: '440px', prose: true }));
    }

    c.appendChild(h('h4', { text: 'The children, before and after' }));
    c.appendChild(snapLine('addendum (ON DELETE CASCADE)', vv.before.addendum, vv.after.addendum));
    c.appendChild(snapLine('encounter_diagnosis (ON DELETE RESTRICT)', vv.before.encounter_diagnosis, vv.after.encounter_diagnosis));
    c.appendChild(snapLine('encounter itself', vv.before.encounter, vv.after.encounter));

    var committed = naive ? naive.committed : (vv.rung ? vv.rung.ok : false);
    var stray = (naive ? naive.stray : vv.after.stray) || [];
    c.appendChild(h('p', { class: 'small' },
      committed ? pill('COMMIT returned OK', committed && vv.after.addendum !== vv.before.addendum ? 'bad' : 'ok')
        : pill('COMMIT did not succeed', 'warn'), ' ',
      pill('foreign_key_check ' + JSON.stringify(vv.after.fkCheck), vv.after.fkCheck.length ? 'bad' : 'ok'), ' ',
      pill(vv.after.addendumCascades ? 'addendum\'s DDL still reads ON DELETE CASCADE' : 'addendum\'s DDL changed',
        vv.after.addendumCascades ? 'info' : 'warn')));
    if (stray.length) {
      c.appendChild(callout('warn', 'A stray table was committed:', stray.join(', ') +
        '. A statement failed, the transaction was not aborted by it, and COMMIT wrote the half-built table ' +
        'to disk. That is what "a failed statement does not roll back a transaction" costs.'));
    }
    c.appendChild(h('h4', { text: 'sqlite_master for encounter, before → after' }));
    c.appendChild(h('div', { class: 'planbox', text: masterList(vv.before.master) + '\n---\n' + masterList(vv.after.master) }));

    var lost = vv.before.addendum !== vv.after.addendum || vv.before.encounter_diagnosis !== vv.after.encounter_diagnosis;
    /* Route A is the naive migration's own report, which says success. Route B is
     * these row counts, read back afterwards. The whole card is those two routes
     * disagreeing, and the disagreement is only visible because they are
     * produced by different code. */
    c.appendChild(lost
      ? callout('bad', 'The script reported success and rows are gone.',
        'Route A — the migration\'s own report — says every statement returned OK and COMMIT succeeded. ' +
        'Route B — these counts, read back from the database afterwards — says rows are missing. Nothing in ' +
        'Route A could ever have said so.')
      : callout('ok', 'Nothing was lost here.',
        naive ? 'Either because a statement was refused loudly, or because the procedure was correct. Read the ' +
          'statement list above to see which.' : 'The twelve steps, with the pragma outside the transaction.'));
    return c;
  }
  RENDER.rebuild = renderRebuild;

  /* ======================================================= CONSTRAINTS === */

  /* The forty-nine statements below live here rather than in schema.js because
   * they are not the schema — they are the page's questions ABOUT the schema, and
   * the answers are SQLite's. Every one of them was run against the real v9
   * database before it was written down, and each is paired in this file with the
   * group whose constraint it is aimed at, not with the message it produced: the
   * message arrives at render time and is printed verbatim. Nothing here is
   * compared against an expected string; `expect` records only whether the write
   * is supposed to be refused, which is what a reader needs in order to know that
   * an accepted one is the bug.
   *
   * Every statement runs inside a SAVEPOINT that is always rolled back, so
   * pressing every button on this tab leaves the database it was pressed against
   * unchanged — the live badge is still measuring the same thing afterwards. */
  var V = "INSERT INTO visit (id,rm_number,visit_date,poli_id,klass,status,queue_no,queue_seq,complaint,opened_at,opened_by) ";
  var CONSTRAINTS = [
  {grp:'fk',expect:'refuse',name:'a visit naming a patient that does not exist',
   sql:V+"SELECT 'V-'||replace(visit_date,'-','')||'-9801','RM-999999',visit_date,poli_id,klass,'menunggu-triase','Z801',9801,'x',opened_at,'stf-05' FROM visit LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'an encounter naming a visit that does not exist',
   sql:"INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,created_at) VALUES ('E-20260909-9801','V-20260909-9999','RM-000001','stf-01','draft','2026-09-09T08:00:00')"},
  {grp:'fk',expect:'refuse',name:'a coded diagnosis naming an ICD-10 code that does not exist',
   sql:"INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) SELECT id,'ZZ9.9',0 FROM encounter LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'a bill line with no bill',
   sql:"INSERT INTO bill_line (visit_id,line_no,label,grp,qty,unit_rp,covered,payer) VALUES ('V-20260909-9999',1,'x','jasa',1,1000,0,'pasien')"},
  {grp:'fk',expect:'refuse',name:'an allergy naming a class that does not exist — the 2024 misspelling',
   sql:"INSERT INTO patient_allergy (rm_number,class_id) SELECT rm_number,'penicillin' FROM patient LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'a tindakan naming a tariff row that does not exist',
   sql:"INSERT INTO visit_tindakan (visit_id,tindakan_id) SELECT id,'tnd-99' FROM visit LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'a triage row naming an acuity that does not exist',
   sql:"INSERT INTO triage (visit_id,suhu_dc,acuity_id,by_staff,at) SELECT v.id,376,'ungu','stf-04','2026-09-09T08:00:00' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM triage) LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'an audit row naming a patient that does not exist',
   sql:"INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_patient,prev_hash,hash) SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','patient.create','x','{}','patient','RM-999999',(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry"},
  {grp:'fk',expect:'refuse',name:'a visit whose doctor_id names the pharmacist — the composite foreign key',
   sql:V.replace('complaint,opened_at','complaint,doctor_id,opened_at')+"SELECT 'V-'||replace(visit_date,'-','')||'-9805',rm_number,visit_date,poli_id,klass,'menunggu-triase','Z805',9805,'x','stf-06',opened_at,'stf-05' FROM visit LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'an addendum on the subjective by a perawat — the role that path does not permit',
   sql:"INSERT INTO addendum (id,seq,encounter_id,path,new_value,reason,by_staff,by_role,at) SELECT 'ADD-9802',9802,id,'s','{\"a\":1}','koreksi','stf-04','perawat','2026-09-09T08:00:00' FROM encounter LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'an addendum on a path that is not amendable at all',
   sql:"INSERT INTO addendum (id,seq,encounter_id,path,new_value,reason,by_staff,by_role,at) SELECT 'ADD-9803',9803,id,'signed_by','{\"a\":1}','koreksi','stf-01','dokter','2026-09-09T08:00:00' FROM encounter LIMIT 1"},
  {grp:'fk',expect:'refuse',name:'a visit on a (date, poli) with no queue counter row',
   sql:V+"SELECT 'V-20991231-9807',rm_number,'2099-12-31',poli_id,klass,'menunggu-triase','Z807',9807,'x',opened_at,'stf-05' FROM visit LIMIT 1"},
  {grp:'unique',expect:'refuse',name:'a second primary diagnosis, by INSERT',
   sql:"INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) SELECT encounter_id,'Z00.0',1 FROM encounter_diagnosis WHERE is_primary=1 LIMIT 1"},
  {grp:'unique',expect:'refuse',name:'a second primary diagnosis, by promoting a secondary one with UPDATE',
   sql:"UPDATE encounter_diagnosis SET is_primary = 1 WHERE (encounter_id, icd_code) IN (SELECT d.encounter_id, d.icd_code FROM encounter_diagnosis d JOIN encounter_diagnosis p ON p.encounter_id = d.encounter_id AND p.is_primary = 1 WHERE d.is_primary = 0 LIMIT 1)"},
  {grp:'unique',expect:'refuse',name:'a second ACTIVE visit for one patient, day and poli',
   sql:V+"SELECT 'V-'||replace(v.visit_date,'-','')||'-9808',v.rm_number,v.visit_date,v.poli_id,v.klass,'menunggu-triase','Z808',9808,'x',v.opened_at,'stf-05' FROM visit v WHERE v.status NOT IN ('selesai','batal') LIMIT 1"},
  {grp:'unique',expect:'refuse',name:'a duplicate practice licence number',
   sql:"INSERT INTO staff (id,name,role_id,title,sip) VALUES ('stf-99','X','perawat','P',(SELECT sip FROM staff WHERE sip IS NOT NULL LIMIT 1))"},
  {grp:'unique',expect:'refuse',name:'a re-used medical-record number, with rm_seq kept consistent',
   sql:"INSERT INTO patient (rm_number,rm_seq,name,name_norm,sex,dob,nik_demo,phone,klass,created_at) VALUES ('RM-000001',1,'X','x','L','1990-01-01','NIK-FIKTIF-000001','0812-FIKTIF-001','umum','2026-01-01')"},
  {grp:'check',expect:'refuse',name:'an rm_number that does not match its rm_seq',
   sql:"INSERT INTO patient (rm_number,rm_seq,name,name_norm,sex,dob,nik_demo,phone,klass,created_at) VALUES ('RM-000001',999999,'X','x','L','1990-01-01','NIK-FIKTIF-000001','0812-FIKTIF-001','umum','2026-01-01')"},
  {grp:'check',expect:'refuse',name:'an audit row with zero entity columns set',
   sql:"INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,prev_hash,hash) SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','visit.open','x','{}','visit',(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry"},
  {grp:'check',expect:'refuse',name:'an audit row with two of them set',
   sql:"INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_visit,ent_patient,prev_hash,hash) SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','visit.open','x','{}','visit',(SELECT id FROM visit LIMIT 1),(SELECT rm_number FROM patient LIMIT 1),(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry"},
  {grp:'check',expect:'refuse',name:'a bill whose parts no longer sum to its total',
   sql:"UPDATE bill SET dibayar_pasien_rp = dibayar_pasien_rp + 5000 WHERE visit_id = (SELECT visit_id FROM bill LIMIT 1)"},
  {grp:'check',expect:'refuse',name:'a pregnant male patient',
   sql:"UPDATE patient SET pregnant = 1 WHERE rm_number = (SELECT rm_number FROM patient WHERE sex='L' LIMIT 1)"},
  {grp:'check',expect:'refuse',name:'a national identity number shaped like a real one',
   sql:"UPDATE patient SET nik_demo = '3201011234567890' WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)"},
  {grp:'check',expect:'refuse',name:'a patient row that claims not to be demo data',
   sql:"UPDATE patient SET is_demo = 0 WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)"},
  {grp:'check',expect:'refuse',name:'a patient with no name at all',
   sql:"UPDATE patient SET name = NULL WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)"},
  {grp:'check',expect:'refuse',name:'a date of birth after the row was created',
   sql:"UPDATE patient SET dob = '2099-01-01' WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)"},
  {grp:'check',expect:'refuse',name:"klass = 'bpjs' with no insurance number",
   sql:"UPDATE patient SET klass = 'bpjs', bpjs_demo = NULL WHERE rm_number = (SELECT rm_number FROM patient WHERE bpjs_demo IS NULL LIMIT 1)"},
  {grp:'check',expect:'refuse',name:'a triage form with every vital NULL',
   sql:"INSERT INTO triage (visit_id,acuity_id,by_staff,at) SELECT v.id,'hijau','stf-04','2026-09-09T08:00:00' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM triage) LIMIT 1"},
  {grp:'check',expect:'refuse',name:'a diastolic reading at or above the systolic one',
   sql:"INSERT INTO triage (visit_id,td_sistol,td_diastol,acuity_id,by_staff,at) SELECT v.id,120,120,'hijau','stf-04','2026-09-09T08:00:00' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM triage) LIMIT 1"},
  {grp:'check',expect:'refuse',name:'a visit with an empty complaint',
   sql:V+"SELECT 'V-'||replace(visit_date,'-','')||'-9809',rm_number,visit_date,poli_id,klass,'menunggu-triase','Z809',9809,'   ',opened_at,'stf-05' FROM visit LIMIT 1"},
  {grp:'check',expect:'refuse',name:'an addendum with a blank reason',
   sql:"INSERT INTO addendum (id,seq,encounter_id,path,new_value,reason,by_staff,by_role,at) SELECT 'ADD-9804',9804,id,'s','{\"a\":1}','  ','stf-01','dokter','2026-09-09T08:00:00' FROM encounter LIMIT 1"},
  {grp:'check',expect:'refuse',name:'an addendum whose new_value equals its old_value',
   sql:"INSERT INTO addendum (id,seq,encounter_id,path,old_value,new_value,reason,by_staff,by_role,at) SELECT 'ADD-9805',9805,id,'s','{\"a\":1}','{\"a\":1}','koreksi','stf-01','dokter','2026-09-09T08:00:00' FROM encounter LIMIT 1"},
  {grp:'check',expect:'refuse',name:'a note signed by somebody other than its author',
   sql:"INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,s,created_at,signed_at,signed_by) SELECT 'E-20260909-9806',v.id,v.rm_number,'stf-01','signed','x','2026-09-09T08:00:00','2026-09-09T09:00:00','stf-02' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM encounter) LIMIT 1"},
  {grp:'check',expect:'refuse',name:'a signed note with no signature time',
   sql:"INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,s,created_at) SELECT 'E-20260909-9807',v.id,v.rm_number,'stf-01','signed','x','2026-09-09T08:00:00' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM encounter) LIMIT 1"},
  {grp:'check',expect:'refuse',name:'a bill line for nothing at all — qty = 0',
   sql:"UPDATE bill_line SET qty = 0 WHERE visit_id = (SELECT visit_id FROM bill_line LIMIT 1) AND line_no = 1"},
  {grp:'strict',expect:'refuse',name:'text in an integer money column',
   sql:"UPDATE bill_line SET unit_rp = 'abc' WHERE visit_id = (SELECT visit_id FROM bill_line LIMIT 1) AND line_no = 1"},
  {grp:'strict',expect:'refuse',name:'a fractional rupiah',
   sql:"UPDATE bill_line SET unit_rp = 12.5 WHERE visit_id = (SELECT visit_id FROM bill_line LIMIT 1) AND line_no = 1"},
  {grp:'strict',expect:'refuse',name:'a value written straight into the generated column',
   sql:"INSERT INTO bill_line (visit_id,line_no,label,grp,qty,unit_rp,amount_rp,covered,payer) SELECT visit_id,9002,'x','jasa',1,1000,1000,0,'pasien' FROM bill LIMIT 1"},
  {grp:'delete',expect:'refuse',name:'deleting a staff row a visit references',
   sql:"DELETE FROM staff WHERE id = (SELECT opened_by FROM visit LIMIT 1)"},
  {grp:'delete',expect:'refuse',name:'deleting an encounter that carries a coded diagnosis (RESTRICT)',
   sql:"DELETE FROM encounter WHERE id = (SELECT encounter_id FROM encounter_diagnosis WHERE encounter_id NOT IN (SELECT ent_encounter FROM audit_entry WHERE ent_encounter IS NOT NULL) LIMIT 1)"},
  {grp:'delete',expect:'refuse',name:'an UPDATE on the audit trail',
   sql:"UPDATE audit_entry SET summary = 'x' WHERE seq = 0"},
  {grp:'delete',expect:'refuse',name:'a DELETE of a mid-chain audit row',
   sql:"DELETE FROM audit_entry WHERE seq = 5"},
  {grp:'accept',expect:'accept',name:'a fourth secondary diagnosis on the same encounter',
   sql:"INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) SELECT encounter_id,'Z00.0',0 FROM encounter_diagnosis WHERE is_primary=1 LIMIT 1"},
  {grp:'accept',expect:'accept',name:'a valid addendum on o.vitals by a perawat',
   sql:"INSERT INTO addendum (id,seq,encounter_id,path,new_value,reason,by_staff,by_role,at) SELECT 'ADD-9806',9806,id,'o.vitals','{\"suhu_dc\":380}','koreksi','stf-04','perawat','2026-09-09T08:00:00' FROM encounter LIMIT 1"},
  {grp:'accept',expect:'accept',name:'a visit with no doctor yet — NULL passes the composite key',
   sql:V+"SELECT 'V-'||replace(visit_date,'-','')||'-9810',rm_number,visit_date,poli_id,klass,'menunggu-triase','Z810',9810,'x',opened_at,'stf-05' FROM visit WHERE status='selesai' LIMIT 1"},
  {grp:'accept',expect:'accept',name:'a second visit for the same patient, day and poli once the first is closed',
   sql:"UPDATE visit SET status = 'selesai' WHERE id = (SELECT id FROM visit WHERE status NOT IN ('selesai','batal') ORDER BY id LIMIT 1); "+V+"SELECT 'V-'||replace(v.visit_date,'-','')||'-9811',v.rm_number,v.visit_date,v.poli_id,v.klass,'menunggu-triase','Z811',9811,'x',v.opened_at,'stf-05' FROM visit v WHERE v.id = (SELECT id FROM visit WHERE status = 'selesai' ORDER BY id LIMIT 1)"},
  {grp:'accept',expect:'accept',name:'the same queue number tomorrow, once tomorrow has a counter row',
   sql:"INSERT INTO queue_counter VALUES ('2026-09-10','umum',1); "+V+"SELECT 'V-20260910-0001',rm_number,'2026-09-10','umum',klass,'menunggu-triase',(SELECT queue_no FROM visit WHERE poli_id='umum' LIMIT 1),1,'x','2026-09-10T08:00:00','stf-05' FROM patient LIMIT 1"},
  {grp:'accept',expect:'accept',name:"STRICT accepts the text '123' and stores the integer 123",
   sql:"UPDATE bill_line SET unit_rp = '123' WHERE visit_id = (SELECT visit_id FROM bill_line LIMIT 1) AND line_no = 1"},
  {grp:'accept',expect:'accept',name:'and accepts the real 12.0 the same way',
   sql:"UPDATE bill_line SET unit_rp = 12.0 WHERE visit_id = (SELECT visit_id FROM bill_line LIMIT 1) AND line_no = 1"}
  ];

  var CONS_GROUPS = [
    { id: 'fk', title: 'Foreign keys — a reference to something that is not there',
      note: 'Twelve writes, each naming a row that does not exist. Two of them are composite keys, which is ' +
        'where the role restriction lives: a visit\'s doctor_id is checked against (id, role_id) in staff, so ' +
        'a pharmacist cannot be a visit\'s doctor and the application cannot decide otherwise.' },
    { id: 'unique', title: 'UNIQUE and partial unique indexes',
      note: 'A partial index does not care which statement you used, which is the hole an application-level ' +
        'guard leaves: the INSERT path is usually guarded and the UPDATE path usually is not.' },
    { id: 'check', title: 'CHECK and NOT NULL',
      note: 'Eighteen of them. Note what the messages contain: SQLite quotes the constraint expression back, ' +
        'so the error names the rule rather than the field.' },
    { id: 'strict', title: 'STRICT — the declared type is not a comment',
      note: 'Money is INTEGER rupiah everywhere in this schema and STRICT is what makes that a fact about the ' +
        'table rather than a convention in the code that writes to it.' },
    { id: 'delete', title: 'Delete actions and the append-only trail',
      note: 'The last two are triggers rather than constraints, and the Rebuild tab is where they are shown ' +
        'being removed by a statement that reports success.' },
    { id: 'accept', title: 'And the positive controls, which must succeed',
      note: 'A constraint that refuses everything is not a constraint, it is an outage. Each of these is the ' +
        'legitimate version of a refusal above: the same queue number tomorrow, a second visit once the first ' +
        'is closed, a fourth secondary diagnosis, an addendum by a role that path does permit, and the two ' +
        'lossless coercions STRICT allows.' }
  ];

  function runConstraint(i) {
    var db = dbh(), g = CONSTRAINTS[i];
    if (!db) return;
    /* SAVEPOINT, always released, whatever happened. A failed statement does not
     * abort a transaction in SQLite — that is the whole point of G8 — so the
     * rollback has to be unconditional or the next button press runs inside a
     * savepoint it did not open. */
    db.run('SAVEPOINT cons');
    var r = RN.attempt(db, g.sql);
    try { db.run('ROLLBACK TO cons'); db.run('RELEASE cons'); }
    catch (e) { r.message = (r.message || '') + ' [savepoint cleanup failed: ' + e.message + ']'; }
    state.cons[i] = { ok: r.ok, message: r.message, at: Date.now() };
    rerender();
    say(g.name + ': ' + (r.ok ? 'accepted.' : r.message));
  }

  function runAllConstraintsQuietly() {
    var i;
    for (i = 0; i < CONSTRAINTS.length; i++) {
      var db = dbh(), g = CONSTRAINTS[i];
      if (!db) break;
      db.run('SAVEPOINT cons');
      var r = RN.attempt(db, g.sql);
      try { db.run('ROLLBACK TO cons'); db.run('RELEASE cons'); } catch (e) { /* reported per row */ }
      state.cons[i] = { ok: r.ok, message: r.message, at: Date.now() };
    }
  }

  function runAllConstraints() {
    var i;
    runAllConstraintsQuietly();
    rerender();
    var wrong = 0;
    for (i = 0; i < CONSTRAINTS.length; i++) {
      var s = state.cons[i];
      if (s && (s.ok ? 'accept' : 'refuse') !== CONSTRAINTS[i].expect) wrong++;
    }
    say('All ' + CONSTRAINTS.length + ' statements ran. ' + wrong + ' did not behave as the page claims.');
  }

  /* NO ACTION versus RESTRICT, on scratch databases of four tables, because the
   * difference is invisible at this schema's scale and the whole point is that
   * the two are NOT interchangeable. Each instance is created here, used, and
   * closed; none of this touches the database on the other tabs. */
  function deleteMatrix() {
    if (state.deleteMatrix) return state.deleteMatrix;
    var SQLm = E.SQL();
    function scratch(action, deferrable) {
      var x = new SQLm.Database();
      x.run('PRAGMA foreign_keys = ON');
      x.run('CREATE TABLE p(id TEXT PRIMARY KEY) STRICT');
      x.run('CREATE TABLE c(id TEXT PRIMARY KEY, p TEXT REFERENCES p(id)' + action +
        (deferrable ? ' DEFERRABLE INITIALLY DEFERRED' : '') + ') STRICT');
      x.run("INSERT INTO p VALUES ('a')");
      x.run("INSERT INTO c VALUES ('1','a')");
      return x;
    }
    var out = [];
    [['NO ACTION (a bare REFERENCES)', ''], ['RESTRICT', ' ON DELETE RESTRICT']].forEach(function (pair) {
      var x = scratch(pair[1], false);
      var immediate = RN.attempt(x, "DELETE FROM p WHERE id='a'");
      x.close();
      var y = scratch(pair[1], true);
      var deferred = { ok: true, message: 'the transaction committed' };
      try {
        y.run('BEGIN');
        y.run("DELETE FROM p WHERE id='a'");
        y.run("INSERT INTO p VALUES ('a')");
        y.run('COMMIT');
      } catch (e) {
        deferred = { ok: false, message: e.message };
        try { y.run('ROLLBACK'); } catch (e2) { /* nothing open */ }
      }
      y.close();
      out.push({ action: pair[0], immediate: immediate, deferred: deferred });
    });
    state.deleteMatrix = out;
    return out;
  }

  /* CHECK (a > 0) accepts NULL, a UNIQUE column accepts unlimited NULLs, and
   * UNIQUE(a, b) with one NULL member enforces nothing. Three lines of scratch
   * DDL each, because on this schema the same shapes would take forty. */
  function nullCard() {
    if (state.nullCard) return state.nullCard;
    var SQLm = E.SQL();
    var out = {};
    var d = new SQLm.Database();
    d.run('CREATE TABLE ck(a INTEGER CHECK (a > 0)) STRICT');
    out.checkNull = RN.attempt(d, 'INSERT INTO ck VALUES (NULL)');
    out.checkZero = RN.attempt(d, 'INSERT INTO ck VALUES (0)');
    d.close();

    var u = new SQLm.Database();
    u.run('CREATE TABLE u(a TEXT UNIQUE) STRICT');
    out.threeNulls = RN.attempt(u, 'INSERT INTO u VALUES (NULL),(NULL),(NULL)');
    out.nullCount = Number(E.first('SELECT count(*) FROM u', u));
    u.close();

    var t = new SQLm.Database();
    t.run('CREATE TABLE t(a TEXT NOT NULL, b TEXT) STRICT');
    t.run("INSERT INTO t VALUES ('x', NULL)");
    t.run('CREATE UNIQUE INDEX ux_ab ON t(a, b)');
    out.composite = RN.attempt(t, "INSERT INTO t VALUES ('x', NULL)");
    t.run('DELETE FROM t WHERE rowid > 1');
    t.run('DROP INDEX ux_ab');
    t.run('CREATE UNIQUE INDEX ux_a_null ON t(a) WHERE b IS NULL');
    out.partialFix = RN.attempt(t, "INSERT INTO t VALUES ('x', NULL)");
    t.run('DROP INDEX ux_a_null');
    t.run("CREATE UNIQUE INDEX ux_a_ifnull ON t(a, ifnull(b, ''))");
    out.ifnullFix = RN.attempt(t, "INSERT INTO t VALUES ('x', NULL)");
    out.ifnullEmpty = RN.attempt(t, "INSERT INTO t VALUES ('x', '')");
    t.close();
    state.nullCard = out;
    return out;
  }

  function verdictCell(entry, res) {
    if (!res) return h('span', { class: 'hint', text: 'not run yet' });
    var asClaimed = (res.ok ? 'accept' : 'refuse') === entry.expect;
    var body = res.ok
      ? h('span', { class: 'cons-acc', text: 'accepted' })
      : h('span', { class: 'cons-err', text: res.message });
    return h('span', null, h('span', { class: 'mk', text: asClaimed ? '✓ ' : '✗ ' }), body);
  }

  function renderConstraints(p) {
    var db = dbh();
    p.appendChild(h('h2', { text: 'Writes that must be refused, and the exact refusal' }));
    p.appendChild(h('p', { class: 'note' },
      'Press a button and the statement is sent to the database on the other tabs, inside a savepoint that is ' +
      'rolled back whatever happens. What appears beside it is the string SQLite returned, unedited. ' +
      'Route B is you, in the Console, sending your own values: the constraint is in the table, not in the button.'));

    if (!db) { p.appendChild(callout('warn', 'The database has not booted yet.', state.bootStep)); return; }

    /* The tab detects the pragma and says so in red, because a visitor who types
     * PRAGMA foreign_keys=OFF in the Console will find every foreign-key test on
     * this tab passing silently — which is itself the demonstration. */
    var fkOn = null;
    try { fkOn = E.foreignKeysOn(db); } catch (e) { fkOn = null; }
    if (fkOn === 0) {
      p.appendChild(callout('bad', 'PRAGMA foreign_keys is OFF on this connection.',
        'Every foreign-key row below will be ACCEPTED, and none of those acceptances means the constraint is ' +
        'gone from the schema — only that nothing is checking it. This is what a bulk load with the pragma ' +
        'left off looks like from the inside, and it is why the pragma is read and shown rather than assumed.'));
    } else {
      p.appendChild(h('p', { class: 'small' }, 'PRAGMA foreign_keys reads ',
        h('code', { text: String(fkOn) }), ' on this connection. Turn it off in the Console and come back: ' +
        'the twelve foreign-key rows below will all be accepted.'));
    }

    /* Run once on the first visit, for the same reason the plans are: forty-nine
     * buttons nobody has pressed prove nothing, and every one of them rolls its
     * savepoint back, so pressing them all costs the database nothing. */
    if (!state.consRun) { state.consRun = true; runAllConstraintsQuietly(); }

    var done = 0, wrong = 0, i;
    for (i = 0; i < CONSTRAINTS.length; i++) {
      var s = state.cons[i];
      if (!s) continue;
      done++;
      if ((s.ok ? 'accept' : 'refuse') !== CONSTRAINTS[i].expect) wrong++;
    }
    p.appendChild(h('div', { class: 'controls no-print' },
      btn('Run all ' + CONSTRAINTS.length, function () { runAllConstraints(); }, 'small primary', 'cons:all'),
      btn('Clear', function () { state.cons = {}; state.consRun = true; rerender(); }, 'small ghost', 'cons:clear'),
      h('span', { class: 'hint', text: done + ' of ' + CONSTRAINTS.length + ' run' +
        (done ? ', ' + wrong + ' not as claimed' : '') })));

    CONS_GROUPS.forEach(function (g) {
      var c = card(g.title, g.note);
      CONSTRAINTS.forEach(function (entry, idx) {
        if (entry.grp !== g.id) return;
        var res = state.cons[idx];
        var row = h('div', { class: 'cons' });
        row.appendChild(h('div', { class: 'cons-head' },
          h('button', {
            type: 'button', class: 'btn small no-print', 'data-fkey': 'cons:' + idx,
            onclick: function () { runConstraint(idx); }
          }, entry.expect === 'refuse' ? 'Try it' : 'Run it'),
          h('span', { class: 'name', text: entry.name }),
          pill(entry.expect === 'refuse' ? 'must be refused' : 'must succeed',
            entry.expect === 'refuse' ? 'bad' : 'ok')));
        row.appendChild(sqlBox(entry.sql));
        row.appendChild(h('div', { class: 'small' }, verdictCell(entry, res)));
        c.appendChild(row);
      });
      p.appendChild(c);
    });

    /* ---- the delete-action matrix ---- */
    var dm = card('NO ACTION and RESTRICT are the same rule, until they are not',
      'A bare REFERENCES is NO ACTION. It behaves identically to ON DELETE RESTRICT for an immediate check, ' +
      'and differs only when the key is DEFERRABLE — which is exactly the case a migration author meets, ' +
      'because deferring is what lets a transaction be temporarily inconsistent in the middle.');
    var dmm = deleteMatrix();
    var dmRows = dmm.map(function (r) {
      return h('tr', null,
        h('td', { text: r.action }),
        h('td', null, r.immediate.ok ? h('span', { class: 'cons-acc', text: 'the DELETE was accepted' })
          : h('span', { class: 'cons-err', text: r.immediate.message })),
        h('td', null, r.deferred.ok ? h('span', { class: 'cons-acc', text: r.deferred.message })
          : h('span', { class: 'cons-err', text: r.deferred.message })));
    });
    dm.appendChild(tableOf(['delete action', 'immediate: DELETE the parent',
      'DEFERRABLE: delete then reinsert inside one transaction'], dmRows, { minWidth: '680px', prose: true }));
    dm.appendChild(h('p', { class: 'hint', text: 'Deferred NO ACTION permits the delete-then-reinsert, ' +
      'because it is only asked at COMMIT and by then the parent is back. Deferred RESTRICT refuses at the ' +
      'DELETE itself: RESTRICT is not deferrable in the way its syntax suggests it is.' }));
    p.appendChild(dm);

    /* ---- the ALTER TABLE capability boundary ---- */
    var am = card('What ALTER TABLE can and cannot do — run against a table WITH ROWS',
      'This matrix is worthless on an empty table, and running it on one is the single easiest way to ship a ' +
      'panel that passes green while asserting the opposite of the truth: three of these six forms SUCCEED on ' +
      'an empty table and fail on a populated one. Both columns are run, both are shown.');
    if (!state.alter) {
      try { state.alter = RN.alterMatrix({ db: db }); }
      catch (e) { state.alter = { error: e.message }; }
    }
    if (state.alter.error) am.appendChild(callout('bad', 'The matrix could not run.', state.alter.error));
    else {
      var amRows = state.alter.map(function (a) {
        function side(x) {
          return h('td', null,
            h('span', { class: 'mk', text: x.agrees ? '✓ ' : '✗ ' }),
            x.got === 'ok' ? h('span', { class: 'cons-acc', text: 'accepted' })
              : h('span', { class: 'cons-err', text: x.message }));
        }
        return h('tr', null, h('td', null, h('span', { class: 'mono', text: a.sql })), side(a.empty), side(a.populated));
      });
      am.appendChild(tableOf(['ALTER TABLE … ADD COLUMN', 'on an EMPTY table', 'on a table WITH ROWS'],
        amRows, { minWidth: '760px', prose: true }));
      am.appendChild(h('p', { class: 'hint', text: 'Both scratch tables live inside a SAVEPOINT that is ' +
        'always rolled back, so nothing above is left behind — the Schema tab\'s table list is the check.' }));
    }
    p.appendChild(am);

    var rr = card('And four things ALTER TABLE cannot do at all',
      'Not a flag, not a pragma, not a version to wait for: four bare syntax errors. That is the strongest ' +
      'form of "this needs a table rebuild", and it is why v7 exists.');
    if (!state.refusals) {
      try { state.refusals = RN.rebuildRefusals({ db: db }); }
      catch (e) { state.refusals = [{ want: 'the matrix could not run', sql: '', message: e.message, refused: false }]; }
    }
    var rrRows = state.refusals.map(function (r) {
      return h('tr', null,
        h('td', { text: r.want }),
        h('td', null, h('span', { class: 'mono', text: r.sql })),
        h('td', null, h('span', { class: r.refused ? 'cons-err' : 'cons-acc', text: r.message || 'accepted' })));
    });
    rr.appendChild(tableOf(['what you wanted', 'what you would have to write', 'what SQLite said'],
      rrRows, { minWidth: '760px', prose: true }));
    p.appendChild(rr);

    /* ---- NULL semantics ---- */
    var nc = card('CHECK (a > 0) accepts NULL, and UNIQUE does not mean what it looks like',
      'The reason every CHECK in this schema is either on a NOT NULL column or written NULL-tolerantly. ' +
      'NULL > 0 is NULL, and only an explicit false rejects a row.');
    var n = nullCard();
    nc.appendChild(h('div', { class: 'diffrow ' + (n.checkNull.ok ? 'changed' : 'undeclared') },
      h('span', { class: 'mk', text: n.checkNull.ok ? '!' : '✗' }),
      h('span', { class: 't', text: 'CHECK (a > 0), INSERT NULL: ' + (n.checkNull.ok ? 'stored' : n.checkNull.message) })));
    nc.appendChild(h('div', { class: 'diffrow declared' },
      h('span', { class: 'mk', text: '✓' }),
      h('span', { class: 't', text: 'the same CHECK, INSERT 0: ' + (n.checkZero.ok ? 'stored — the CHECK is not working' : n.checkZero.message) })));
    nc.appendChild(h('div', { class: 'diffrow ' + (n.nullCount === 3 ? 'changed' : 'undeclared') },
      h('span', { class: 'mk', text: '!' }),
      h('span', { class: 't', text: 'a UNIQUE column holding three NULLs: ' + n.nullCount + ' rows coexist' })));
    nc.appendChild(h('div', { class: 'diffrow ' + (n.composite.ok ? 'changed' : 'undeclared') },
      h('span', { class: 'mk', text: '!' }),
      h('span', { class: 't', text: "UNIQUE(a, b) with b NULL, a second ('x', NULL): " +
        (n.composite.ok ? 'accepted — the composite index enforces nothing here' : n.composite.message) })));
    nc.appendChild(h('h4', { text: 'Two fixes, with genuinely different semantics' }));
    nc.appendChild(h('p', { class: 'small' }, h('code', { text: 'CREATE UNIQUE INDEX ux_a_null ON t(a) WHERE b IS NULL' }),
      ' → ', h('span', { class: 'cons-err', text: n.partialFix.message || 'accepted' })));
    nc.appendChild(h('p', { class: 'small' }, h('code', { text: "CREATE UNIQUE INDEX ux_a_ifnull ON t(a, ifnull(b, ''))" }),
      ' → ', h('span', { class: 'cons-err', text: n.ifnullFix.message || 'accepted' })));
    nc.appendChild(h('p', { class: 'hint', text: 'They are not interchangeable, and the difference is the ' +
      "last line: under the ifnull index ('x', '') now collides with ('x', NULL) — " +
      (n.ifnullEmpty.ok ? 'it was accepted here, so the collapse did not happen' : n.ifnullEmpty.message) +
      ' — because ifnull collapses the empty string and NULL into one value. The partial index does not. ' +
      'One of them says "at most one row with no b"; the other says "no b and empty b are the same b".' }));
    p.appendChild(nc);

    /* ---- the trade-off card ---- */
    var pc = card('The polymorphic audit column: a trade-off, not a solution',
      'Named because it is a real design decision with a real cost, and the alternative is defensible.');
    pc.appendChild(h('p', null, h('b', { text: 'Taken: ' }),
      'three nullable typed columns — ', h('code', { text: 'ent_patient' }), ', ',
      h('code', { text: 'ent_visit' }), ', ', h('code', { text: 'ent_encounter' }),
      ' — plus a CHECK that exactly one is non-null. It buys real foreign keys on all three, so an audit row ' +
      'cannot reference an encounter that does not exist, and the database refuses to delete an encounter the ' +
      'trail mentions. The cost is two always-NULL columns on every row, a ', h('code', { text: 'coalesce()' }),
      ' on every read, and a table rebuild the day a fourth entity type appears.'));
    pc.appendChild(h('p', null, h('b', { text: 'Not taken: ' }),
      'one ', h('code', { text: 'entity_id' }), ' column and a trigger that checks it against the right table ' +
      'by ', h('code', { text: 'entity' }), '. The table stays narrow and adding a fourth type is one INSERT ' +
      'into a reference table. The check moves into a trigger, and a trigger is something a bulk load can be ' +
      'told to skip — which is precisely how a trail full of dangling references gets written in one afternoon.'));
    pc.appendChild(h('p', { class: 'hint', text: 'v9 is the rung that performs the conversion, on 424 rows, ' +
      'and the hash input does not change while the column set does — which is the only reason the rebuild ' +
      'can be verified at all.' }));
    p.appendChild(pc);
  }
  RENDER.constraints = renderConstraints;

  /* ============================================================= PLANS === */

  function planDetails(sql, params, db) {
    var pp = E.plan(sql, params, db), out = [], i;
    for (i = 0; i < pp.length; i++) out.push(pp[i].detail);
    return out;
  }

  /* A fold over an ORDERED result set, and the ORDER BY is the whole trick: an
   * index scan and a table scan return the same rows in a different order, so an
   * order-sensitive hash over an unordered query reports a divergence that is not
   * one. `orderFor` goes on BOTH sides of this comparison and on NEITHER side of
   * the plan assertion, because adding an ORDER BY can change the plan and the
   * plan is the subject. */
  function foldRows(sql, params, db) {
    var all = E.all(sql, params, db), hash = 0, i;
    for (i = 0; i < all.length; i++) hash = (((hash * 31) >>> 0) + D.fnv1a(D.canonical(all[i]))) >>> 0;
    return { n: all.length, h: hash };
  }

  function sameArray(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var i;
    for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function measurePlan(id) {
    var db = dbh(), e = null, i;
    for (i = 0; i < P.PLANS.length; i++) if (P.PLANS[i].id === id) e = P.PLANS[i];
    if (!db || !e) return null;
    var out = { id: id, error: null, setupRan: [], variants: [] };
    try {
      for (i = 0; i < (e.setup || []).length; i++) { db.run(e.setup[i]); out.setupRan.push(e.setup[i]); }
      var params = e.params || [];
      if (e.paramsSql) {
        var pr = E.rows(e.paramsSql, db);
        params = pr.length ? pr[0] : [];
      }
      out.params = params;
      out.plan = planDetails(e.sql, params, db);
      out.planOk = sameArray(out.plan, e.expectPlan);
      out.time = E.timeMean(function () { E.all(e.sql, params, db); }, state.planN);
      if (e.twinSql) {
        out.twinPlan = planDetails(e.twinSql, params, db);
        out.twinOk = sameArray(out.twinPlan, e.expectTwinPlan);
        out.twinTime = E.timeMean(function () { E.all(e.twinSql, params, db); }, state.planN);
        if (e.twinSameRows !== false) {
          out.rowsA = foldRows(e.sql + (e.orderFor || ''), params, db);
          out.rowsB = foldRows(e.twinSql + (e.orderFor || ''), params, db);
          out.rowsAgree = out.rowsA.n === out.rowsB.n && out.rowsA.h === out.rowsB.h;
        }
      }
      for (i = 0; i < (e.variants || []).length; i++) {
        var v = e.variants[i];
        db.run(v.pragma);
        var got = planDetails(e.sql, params, db);
        db.run(v.restore);
        out.variants.push({ id: v.id, pragma: v.pragma, restore: v.restore, why: v.why,
          plan: got, expect: v.expectPlan, ok: sameArray(got, v.expectPlan) });
      }
      out.rows = E.exec(e.sql, db);
      for (i = 0; i < (e.teardown || []).length; i++) db.run(e.teardown[i]);
    } catch (err) {
      out.error = err.message || String(err);
      for (i = 0; i < (e.teardown || []).length; i++) { try { db.run(e.teardown[i]); } catch (e2) { /* already gone */ } }
    }
    state.plans[id] = out;
    return out;
  }

  function dropAndReplan(id, ix) {
    var db = dbh();
    if (!db) return;
    var r = RN.attempt(db, 'DROP INDEX ' + ix);
    state.droppedIx = state.droppedIx || {};
    state.planIx = state.planIx || {};
    if (r.ok) {
      state.droppedIx[ix] = true;
      /* Remembered against the CARD, not read back out of the new plan. Once the
       * index is gone the plan names whatever the planner fell back to — an
       * auto-index, usually, which has no DDL — and a card that derived its
       * recreate button from the current plan would offer no way back. */
      state.planIx[id] = ix;
    }
    measurePlan(id);
    rerender();
    say(r.ok ? (ix + ' dropped. The plan and the timing above were re-measured just now.') : r.message);
  }

  function recreateIndex(id, ix) {
    var db = dbh();
    if (!db || !S.INDEX_DDL[ix]) return;
    var r = RN.attempt(db, stripComments(S.INDEX_DDL[ix]));
    if (r.ok && state.droppedIx) delete state.droppedIx[ix];
    if (r.ok && state.planIx && state.planIx[id] === ix) delete state.planIx[id];
    measurePlan(id);
    rerender();
    say(r.ok ? (ix + ' is back, from schema.js\'s own DDL. Re-measured.') : r.message);
  }

  function indexInPlan(details) {
    var i, m;
    for (i = 0; i < (details || []).length; i++) {
      m = /INDEX ([A-Za-z_0-9]+)/.exec(details[i]);
      if (m && S.INDEX_DDL[m[1]]) return m[1];
    }
    return null;
  }

  function timingLine(t) {
    if (!t) return '';
    return t.mean.toFixed(3) + ' ms mean over N = ' + t.n + (t.clamped ? ' (raised from a smaller N: five is the floor)' : '') +
      ' · min ' + t.min.toFixed(3) + ' · max ' + t.max.toFixed(3);
  }

  function renderPlans(p) {
    var db = dbh();
    p.appendChild(h('h2', { text: P.COUNT + ' named queries, and ' + P.FAILURE_COUNT + ' of them do not work' }));
    p.appendChild(h('p', { class: 'note' },
      'Every plan below is ', h('code', { text: 'EXPLAIN QUERY PLAN' }), ' output read from the database in ' +
      'front of you, printed verbatim. The expected string beside it was transcribed from a real run and is ' +
      'what the assertion suite pins. Timings are measured here, now, on your machine, as a mean over N runs ' +
      'with N shown — and nothing on this page asserts a timing, because a suite that pins a millisecond ' +
      'figure is a suite that goes red on somebody else\'s laptop for a reason that is not a defect.'));

    if (!db) { p.appendChild(callout('warn', 'The database has not booted yet.', state.bootStep)); return; }

    /* Measured once, on the first visit, rather than left as fourteen "press me"
     * cards: a panel whose default state is empty is a panel a reader concludes
     * nothing from. Re-measuring is one button, and the figures are per-machine
     * anyway. */
    if (!state.plansMeasured) {
      state.plansMeasured = true;
      var kk;
      for (kk = 0; kk < P.PLANS.length; kk++) measurePlan(P.PLANS[kk].id);
    }

    var nInput = h('input', {
      type: 'number', min: '1', max: '500', value: String(state.planN), 'data-fkey': 'plans:n',
      'aria-label': 'runs per measurement',
      oninput: function (ev) {
        var v = parseInt(ev.currentTarget.value, 10);
        if (v > 0) state.planN = v;
      }
    });
    p.appendChild(h('div', { class: 'controls no-print' },
      h('label', { class: 'field' }, h('span', { text: 'runs per measurement (N)' }), nInput),
      btn('Measure all ' + P.COUNT, function () {
        var i;
        for (i = 0; i < P.PLANS.length; i++) measurePlan(P.PLANS[i].id);
        rerender();
        say('All ' + P.COUNT + ' plans re-measured at N = ' + state.planN + '.');
      }, 'small primary', 'plans:all'),
      h('span', { class: 'hint', text: 'ROMBAK_ENGINE.timeMean() runs one untimed warm-up first and clamps ' +
        'N to five, because a single-shot figure at this scale is noise with a decimal point on it.' })));

    if (state.analyzed) {
      p.appendChild(callout('warn', 'ANALYZE has been run on this database.',
        'Measured, not assumed: none of the ' + P.COUNT + ' plans above moves when sqlite_stat1 exists — ' +
        'every expected string below still holds, and pressing "Measure all" will show that. The two plans ' +
        'that do move are both on the ANALYZE card itself: the live-board count(*), which switches from ' +
        'idx_visit_board to the partial index, and the tamper query. Timings measured before you pressed ' +
        'ANALYZE were measured in a different state, so re-measure those.'));
    }
    if (state.droppedIx) {
      var dropped = Object.keys(state.droppedIx);
      if (dropped.length) {
        var warn = callout('warn', 'You have dropped ' + dropped.join(', ') + '.',
          'The schema is no longer the shipped one, so a plan that no longer matches its expected string is ' +
          'telling the truth. Put them back here, from schema.js\'s own DDL, or rewind the ladder on the ' +
          'Migrations tab. ');
        warn.appendChild(btn('Recreate all ' + dropped.length, function () {
          var okAll = true, k;
          for (k = 0; k < dropped.length; k++) {
            var rr = RN.attempt(db, stripComments(S.INDEX_DDL[dropped[k]]));
            if (rr.ok) delete state.droppedIx[dropped[k]]; else okAll = false;
          }
          state.planIx = {};
          state.plansMeasured = false;
          rerender();
          say(okAll ? 'Every dropped index is back, and the plans were re-measured.' : 'One of them would not rebuild.');
        }, 'small no-print', 'plans:restore'));
        p.appendChild(warn);
      }
    }

    P.PLANS.forEach(function (e, idx) {
      p.appendChild(planCard(e, idx));
    });

    p.appendChild(analyzeCard());
    p.appendChild(indexSizeCard());
  }

  function planCard(e, idx) {
    var c = h('section', { class: 'card' });
    c.appendChild(h('div', { class: 'row-between' },
      h('h3', { text: (idx + 1) + '. ' + e.name }),
      e.isFailureCase ? pill('failure case', 'bad') : pill('works', 'ok')));
    c.appendChild(h('p', { text: e.why }));
    c.appendChild(sqlBox(e.sql));

    var m = state.plans[e.id];
    var ctl = h('div', { class: 'controls no-print' },
      btn(m ? 'Re-measure' : 'Plan and time it', function () { measurePlan(e.id); rerender(); }, 'small', 'plans:m:' + e.id));
    if (m && !m.error) {
      var ix = (state.planIx && state.planIx[e.id]) || indexInPlan(m.plan);
      if (ix) {
        var gone = state.droppedIx && state.droppedIx[ix];
        ctl.appendChild(btn(gone ? 'Recreate ' + ix : 'Drop ' + ix + ' and re-plan',
          function () { if (gone) recreateIndex(e.id, ix); else dropAndReplan(e.id, ix); },
          'small ' + (gone ? '' : 'danger'), 'plans:ix:' + e.id));
      }
    }
    c.appendChild(ctl);

    if (!m) { c.appendChild(h('div', { class: 'empty', text: 'Not measured yet.' })); return c; }
    if (m.error) { c.appendChild(callout('bad', 'This query could not run against the database in front of you.', m.error)); return c; }

    if (e.setup && e.setup.length) {
      c.appendChild(h('p', { class: 'hint', text: 'This entry creates what it needs and undoes it afterwards: ' +
        e.setup.join('; ') + ' … ' + (e.teardown || []).join('; ') }));
    }
    if (m.params && m.params.length) {
      c.appendChild(h('p', { class: 'small' }, 'parameters, read out of the fixture rather than typed into the file: ',
        h('code', { text: JSON.stringify(m.params) })));
    }

    c.appendChild(planBox(m.plan));
    c.appendChild(h('p', { class: 'small' },
      m.planOk ? pill('matches the transcribed plan', 'ok') : pill('does NOT match', 'bad'), ' ',
      planPill(m.plan.join(' ')), ' ',
      h('span', { class: 'hint', text: timingLine(m.time) })));
    if (!m.planOk) {
      c.appendChild(callout('warn', 'The planner chose differently here.',
        'Expected: ' + e.expectPlan.join(' | ') + '. That is worth reading rather than dismissing — it means ' +
        'either the schema in front of you is no longer the shipped one, or the statistics have changed.'));
    }

    if (e.twinSql) {
      c.appendChild(h('h4', { text: 'The independent route — the same rows by a different access path' }));
      c.appendChild(sqlBox(e.twinSql));
      c.appendChild(planBox(m.twinPlan));
      c.appendChild(h('p', { class: 'small' },
        m.twinOk ? pill('matches', 'ok') : pill('does NOT match', 'bad'), ' ',
        h('span', { class: 'hint', text: timingLine(m.twinTime) })));
      if (m.rowsAgree === undefined) {
        c.appendChild(h('p', { class: 'hint', text: 'The twin deliberately changes the SELECT list, so the ' +
          'two row sets are NOT compared — a hash comparison here would be a false failure by design.' }));
      } else {
        c.appendChild(h('div', { class: 'diffrow ' + (m.rowsAgree ? 'declared' : 'undeclared') },
          h('span', { class: 'mk', text: m.rowsAgree ? '✓' : '✗' }),
          h('span', { class: 't', text: 'FNV-1a over the full ORDERED result set: ' +
            num(m.rowsA.n) + ' rows / ' + m.rowsA.h + '   versus   ' + num(m.rowsB.n) + ' rows / ' + m.rowsB.h +
            (m.rowsAgree ? '   identical' : '   THEY DIFFER') })));
        c.appendChild(h('p', { class: 'hint', text: 'Compared by hash rather than by row count, because two ' +
          'different sets of the same size are the failure this is for. The ORDER BY appended to both sides ' +
          'is not decoration: without it an index scan and a table scan disagree on order and the hash reports ' +
          'a divergence that is not one.' }));
      }
    }

    if (m.variants.length) {
      c.appendChild(h('h4', { text: 'The same query, the same schema, one pragma different' }));
      m.variants.forEach(function (v) {
        c.appendChild(h('p', { class: 'small' }, h('code', { text: v.pragma }), ' → ',
          v.ok ? pill('as transcribed', 'ok') : pill('differs', 'bad')));
        c.appendChild(planBox(v.plan));
        c.appendChild(h('p', { class: 'hint', text: v.why }));
      });
    }

    if (e.timingNote) {
      c.appendChild(h('h4', { text: 'How the slower-with-the-index claim has to be measured' }));
      c.appendChild(h('p', { class: 'note', text: e.timingNote }));
      c.appendChild(btn(state.interleave ? 'Measure again on two instances' : 'Measure it properly, on two instances',
        function () { interleaved(e); }, 'small no-print', 'plans:inter'));
      if (state.interleave) c.appendChild(interleaveBlock());
    }

    if (m.rows) {
      c.appendChild(h('h4', { text: 'And the rows themselves, because a plan for the wrong answer is worthless' }));
      c.appendChild(resultTable(m.rows.length ? m.rows[0] : { columns: [], values: [] }, 5));
    }
    return c;
  }

  /* Two SQL.Database instances holding identical data, one with the index and one
   * without, runs interleaved A,B,A,B for six rounds, mean of means, N printed.
   * If it inverts on this machine the page reports the inversion in those words
   * rather than hiding the run — the ratio is small and machine dependent, and a
   * panel that only ever prints the result the author liked is a panel nobody
   * should believe. */
  function interleaved(e) {
    if (!state.bytes9) { state.interleave = { error: 'no exported bytes to open two instances from' }; rerender(); return; }
    var withIx = null, without = null;
    try {
      withIx = E.openBytes(state.bytes9);
      without = E.openBytes(state.bytes9);
      withIx.run(e.setup[0]);
      var params = e.params || [];
      var rounds = 6, a = [], b = [], i;
      /* One untimed pass on each before anything is recorded: the first call
       * through a fresh statement cache measures the cache miss. */
      E.all(e.sql, params, withIx);
      E.all(e.sql, params, without);
      for (i = 0; i < rounds; i++) {
        a.push(E.timeMean(function () { E.all(e.sql, params, withIx); }, state.planN).mean);
        b.push(E.timeMean(function () { E.all(e.sql, params, without); }, state.planN).mean);
      }
      function mean(x) { var s = 0, k; for (k = 0; k < x.length; k++) s += x[k]; return s / x.length; }
      var ma = mean(a), mb = mean(b);
      state.interleave = {
        rounds: rounds, n: state.planN, withIx: ma, without: mb,
        ratio: mb === 0 ? null : ma / mb,
        planWith: planDetails(e.sql, params, withIx),
        planWithout: planDetails(e.sql, params, without),
        inverted: ma < mb, error: null
      };
    } catch (err) {
      state.interleave = { error: err.message || String(err) };
    }
    if (withIx) E.close(withIx);
    if (without) E.close(without);
    rerender();
    say(state.interleave.error ? state.interleave.error
      : (state.interleave.inverted ? 'On this machine the index was FASTER — the page reports the inversion.'
        : 'The index was slower, by a ratio of ' + state.interleave.ratio.toFixed(2) + '.'));
  }

  function interleaveBlock() {
    var I = state.interleave;
    if (I.error) return callout('bad', 'The interleaved measurement could not run.', I.error);
    var box = h('div');
    box.appendChild(h('div', { class: 'summary' },
      stat('with the index', I.withIx.toFixed(3) + ' ms', I.planWith.join(' | ')),
      stat('without it (NOT INDEXED is not used — the index simply is not there)', I.without.toFixed(3) + ' ms', I.planWithout.join(' | ')),
      stat('ratio', I.ratio === null ? '—' : I.ratio.toFixed(2) + '×',
        I.rounds + ' rounds interleaved A,B,A,B, N = ' + I.n + ' per round, mean of means')));
    box.appendChild(I.inverted
      ? callout('warn', 'It inverted on this machine.',
        'The index came out FASTER here, which is the opposite of what this entry claims and what was measured ' +
        'when it was written. The ratio is small and machine dependent, so the page reports the inversion ' +
        'rather than hiding the run. The assertion in the suite is on the plan strings only, and those are ' +
        'unchanged: ' + I.planWith.join(' | ') + ' against ' + I.planWithout.join(' | ') + '.')
      : callout('bad', 'The index made it slower.',
        'Roughly seven visits in ten are bpjs, none of the three selected columns is in the index, so the ' +
        'query became a b-tree walk plus one table lookup per matching row instead of one sequential pass. ' +
        'An index helps when it eliminates rows. This one eliminates three in ten and charges for the privilege.'));
    return box;
  }

  function analyzeCard() {
    var A = P.ANALYZE_CARD, db = dbh();
    var c = card('ANALYZE, sqlite_stat1, and the half everybody misses',
      'Statistics are not free and they are not neutral. Before ANALYZE the planner guesses from the schema; ' +
      'after it, it knows how many distinct values each index column has. Two of the plans above move.');
    var present = tryFirst(A.absentBefore);
    c.appendChild(h('p', { class: 'small' }, h('code', { text: A.absentBefore }), ' → ',
      h('code', { text: present.ok ? String(present.value) : '—' }),
      present.ok && Number(present.value) === 0 ? ' — no statistics exist on this database yet.'
        : ' — the statistics table exists, so ANALYZE has already run here.'));
    c.appendChild(h('p', { class: 'small' }, 'The query that moves: ', h('code', { text: A.flips.sql })));
    var flip = state.analyzeCard;
    c.appendChild(h('div', { class: 'controls no-print' },
      btn('Run ANALYZE on this database', function () {
        var before = planDetails(A.flips.sql, [], db);
        db.run(A.analyze);
        var after = planDetails(A.flips.sql, [], db);
        state.analyzed = true;
        state.analyzeCard = { before: before, after: after,
          rows: Number(E.first(A.rowsAfter, db)), moved: !sameArray(before, after) };
        rerender();
        say('ANALYZE ran. ' + state.analyzeCard.rows + ' rows in sqlite_stat1, and the probed plan ' +
          (state.analyzeCard.moved ? 'moved.' : 'did not move.'));
      }, 'small primary', 'plans:analyze'),
      btn('Tamper with a statistic, then reload', function () { tamper(); }, 'small danger', 'plans:tamper'),
      btn('Re-run ANALYZE and overwrite the lie', function () {
        db.run(A.tamper.repair);
        state.tamperOut = state.tamperOut || {};
        state.tamperOut.repaired = planDetails(A.tamper.sql, [], db);
        rerender();
        say('ANALYZE overwrote the tampered row with the truth.');
      }, 'small', 'plans:repair')));
    if (flip) {
      c.appendChild(h('div', { class: 'grid2' },
        h('div', null, h('p', { class: 'hint', text: 'before ANALYZE' }), planBox(flip.before)),
        h('div', null, h('p', { class: 'hint', text: 'after ANALYZE, ' + flip.rows + ' rows in sqlite_stat1' }), planBox(flip.after))));
      c.appendChild(flip.moved
        ? callout('ok', 'The plan moved with no change to the schema and no change to the data.',
          'The planner now knows that only a small fraction of the visits are still in the queue, and switches ' +
          'to the partial index that holds exactly those.')
        : callout('warn', 'The plan did not move here.', 'Which is worth knowing too: statistics change ' +
          'decisions, they do not always change them.'));
    }
    var T2 = state.tamperOut;
    if (T2) {
      c.appendChild(h('h4', { text: 'The tamper, in three steps, and the second one is the point' }));
      c.appendChild(sqlBox(A.tamper.sql));
      c.appendChild(h('p', { class: 'small', text: '1. the honest plan' }));
      c.appendChild(planBox(T2.before));
      c.appendChild(h('p', { class: 'small' }, '2. after ', h('code', { text: A.tamper.update }), ' alone'));
      c.appendChild(planBox(T2.afterUpdate));
      c.appendChild(sameArray(T2.before, T2.afterUpdate)
        ? callout('warn', 'Nothing changed.', 'The planner is still holding the statistics it loaded when the ' +
          'schema was last read. This is the hour that ends in a reconnect.')
        : callout('bad', 'It changed on the UPDATE alone.', 'Which contradicts what this build measured.'));
      c.appendChild(h('p', { class: 'small' }, '3. after ', h('code', { text: A.tamper.reload })));
      c.appendChild(planBox(T2.afterReload));
      if (T2.repaired) {
        c.appendChild(h('p', { class: 'small', text: '4. and after ANALYZE again' }));
        c.appendChild(planBox(T2.repaired));
      }
      c.appendChild(h('p', { class: 'hint', text: A.tamper.why }));
    }
    return c;
  }

  function tamper() {
    var A = P.ANALYZE_CARD, db = dbh();
    try {
      if (Number(E.first(A.absentBefore, db)) === 0) { db.run(A.analyze); state.analyzed = true; }
      var before = planDetails(A.tamper.sql, [], db);
      db.run(A.tamper.update);
      var afterUpdate = planDetails(A.tamper.sql, [], db);
      db.run(A.tamper.reload);
      var afterReload = planDetails(A.tamper.sql, [], db);
      state.tamperOut = { before: before, afterUpdate: afterUpdate, afterReload: afterReload, repaired: null };
      state.analyzed = true;
      say('A statistic was rewritten. The UPDATE alone changed nothing; the schema reload changed the plan.');
    } catch (e) {
      state.tamperOut = { before: [], afterUpdate: [], afterReload: [e.message], repaired: null };
    }
    rerender();
  }

  /* dbstat is not compiled into this build, so an index cannot be sized per page.
   * page_count does NOT shrink when an index is dropped — the pages go on the
   * freelist and the file stays exactly as long — so both numbers are read and
   * the size is the delta of their difference. A panel that reported page_count
   * alone would show a dropped index costing nothing. */
  function indexSizeCard() {
    var M = P.INDEX_SIZE_METHOD, db = dbh();
    var c = card('How big is an index, without dbstat',
      M.formula + '. Both pragmas are read, both are shown, and the measurement below runs on this database ' +
      'when you press the button.');
    c.appendChild(h('p', { class: 'small', text: 'read: ' + M.read.join(' and ') }));
    c.appendChild(btn('Create ' + M.example.index + ', measure, drop it again', function () {
      var before = E.pageStats(db);
      var r1 = RN.attempt(db, 'CREATE INDEX ixk ON visit(klass)');
      var mid = E.pageStats(db);
      var r2 = RN.attempt(db, 'DROP INDEX ixk');
      var after = E.pageStats(db);
      state.indexSize = { before: before, mid: mid, after: after,
        pages: (mid.pageCount - mid.freelistCount) - (before.pageCount - before.freelistCount),
        errors: [r1.ok ? '' : r1.message, r2.ok ? '' : r2.message].join(' ').replace(/^\s+|\s+$/g, '') };
      rerender();
      say('The index cost ' + state.indexSize.pages + ' pages, and the file did not grow.');
    }, 'small no-print', 'plans:size'));
    var I = state.indexSize;
    if (I) {
      if (I.errors) c.appendChild(callout('bad', 'One of the statements failed.', I.errors));
      var rows = [['before', I.before], ['with the index', I.mid], ['after dropping it', I.after]].map(function (pair) {
        var s = pair[1];
        return h('tr', null,
          h('td', { text: pair[0] }),
          h('td', { class: 'num', text: num(s.pageCount) }),
          h('td', { class: 'num', text: num(s.freelistCount) }),
          h('td', { class: 'num', text: num(s.pageCount - s.freelistCount) }));
      });
      c.appendChild(tableOf(['', { label: 'page_count', num: true }, { label: 'freelist_count', num: true },
        { label: 'pages in use', num: true }], rows, { minWidth: '520px' }));
      c.appendChild(h('p', { class: 'small', text: 'The index cost ' + I.pages + ' pages, ' +
        num(I.pages * I.before.pageSize) + ' bytes. Note the middle column: page_count is identical before and ' +
        'after, and the dropped pages went onto the freelist. The file never shrank.' }));
    }
    c.appendChild(h('p', { class: 'hint', text: 'One measured example, one machine, one run, for comparison: ' +
      M.example.index + ' moved freelist_count ' + M.example.freelistBefore + ' → ' + M.example.freelistAfter +
      ' with page_count unchanged at ' + M.example.pageCountBefore + ' — ' + M.example.pagesUsed + ' pages, ' +
      num(M.example.pagesUsed * M.example.pageSize) + ' bytes. Your numbers will differ, and that is the point.' }));
    return c;
  }
  RENDER.plans = renderPlans;

  /* =========================================================== CONSOLE === */

  function runConsole() {
    var db = dbh();
    if (!db) return;
    var sql = state.consoleSql;
    var text = state.consolePlan ? 'EXPLAIN QUERY PLAN ' + sql : sql;
    var t0 = E.now();
    var out = { sql: text, ms: 0, sets: [], error: null, changed: null };
    try {
      out.sets = E.exec(text, db);
      out.ms = Math.round(E.now() - t0);
      try { if (typeof db.getRowsModified === 'function') out.changed = db.getRowsModified(); }
      catch (e) { out.changed = null; }
    } catch (e) {
      out.error = e.message || String(e);
      out.ms = Math.round(E.now() - t0);
    }
    state.consoleOut = out;
    /* Anything typed here can have changed the schema or the rows, so both the
     * version and the live invariants are re-read rather than assumed. This is
     * the tab that makes the live badge worth having. */
    state.version = RN.userVersion({ db: db });
    recomputeLive();
    if (St) {
      St.pushHistory(sql, out.error ? 'error' : 'ok').then(function () { return St.history(12); })
        .then(function (list) { state.history = list || []; rerender(); })
        .catch(function () { /* history is a convenience, never a blocker */ });
    }
    rerender();
    say(out.error ? ('The statement was refused: ' + out.error)
      : (out.sets.length ? (out.sets[0].values.length + ' row(s) returned in ' + out.ms + ' ms.')
        : ('Statement ran in ' + out.ms + ' ms.')));
  }

  function exportDb() {
    var db = dbh();
    if (!db) return;
    var t0 = E.now();
    var bytes = exportKeepingFk(db);
    var ms = Math.round(E.now() - t0);
    var info = { byteLength: bytes.length, ms: ms };

    /* ROUTE 1 — plain JavaScript over the byte array, with SQLite not involved at
     * all: the magic at bytes 0-15, the page size at 16-17 big-endian, the page
     * count at 28-31, user_version at 60-63. If pageSize × pageCount is not the
     * length of the file then something in this chain is lying. */
    info.header = D.decodeSqliteHeader(bytes);
    info.product = info.header.pageSize * info.header.pageCount;
    info.productMatches = info.product === bytes.length;

    /* ROUTE 2 — a NEW SQL.Database over those bytes, and the whole census plus
     * every invariant re-run against THAT instance. Never .byteLength of the
     * array just produced. */
    try {
      var fresh = E.openBytes(bytes);
      var here = C.take(db.exec.bind(db));
      var there = C.take(fresh.exec.bind(fresh));
      info.censusDiff = C.diff(here, there);
      info.freshChecksum = there.checksum;
      info.liveChecksum = here.checksum;
      info.freshSummary = C.summary(C.compare(C.invariants(fresh.exec.bind(fresh)), E.sqlInvariants(fresh)));
      info.freshUserVersion = RN.userVersion({ db: fresh });
      E.close(fresh);
    } catch (e) { info.freshError = e.message || String(e); }

    /* The download itself. A Blob and an object URL — no network, no server, and
     * the counter in the header still reads 0 afterwards, which is the claim this
     * whole lab is built to keep. */
    try {
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.sqlite3' }));
      var a = document.createElement('a');
      a.href = url; a.download = 'rombak.sqlite';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      info.downloaded = true;
    } catch (e) { info.downloadError = e.message || String(e); }

    state.exportInfo = info;
    rerender();
    say('Exported ' + num(info.byteLength) + ' bytes. Foreign keys were re-armed on this connection afterwards.');
  }

  function renderConsole(p) {
    var db = dbh();
    p.appendChild(h('h2', { text: 'An unrestricted SQL console against the database on the other tabs' }));
    p.appendChild(h('p', { class: 'note' },
      'No allowlist, no filtering, no canned results. DDL, recursive CTEs, window functions, ',
      h('code', { text: 'RETURNING' }), ', ', h('code', { text: 'UPDATE … FROM' }), ', ',
      h('code', { text: 'PRAGMA' }), ' — all of it reaches the real engine and prints the real error. ' +
      'Every other tab is reading the database you are about to change.'));

    if (!db) { p.appendChild(callout('warn', 'The database has not booted yet.', state.bootStep)); return; }

    var ta = h('textarea', {
      class: 'console-in', 'data-fkey': 'con:sql', 'aria-label': 'SQL to run',
      spellcheck: 'false',
      oninput: function (ev) { state.consoleSql = ev.currentTarget.value; }
    });
    ta.value = state.consoleSql;
    p.appendChild(ta);

    var fkOn = null;
    try { fkOn = E.foreignKeysOn(db); } catch (e) { fkOn = null; }
    p.appendChild(h('div', { class: 'controls no-print' },
      btn('Run', function () { runConsole(); }, 'small primary', 'con:run'),
      h('button', {
        type: 'button', class: 'btn small', 'aria-pressed': state.consolePlan ? 'true' : 'false',
        'data-fkey': 'con:plan',
        onclick: function () { state.consolePlan = !state.consolePlan; rerender(); }
      }, 'EXPLAIN QUERY PLAN'),
      btn('Rebuild from the seed', function () {
        rewindReplay(S.TARGET_VERSION);
        state.consoleOut = null;
        say('The database was rebuilt from v1\'s bytes and replayed to v' + S.TARGET_VERSION + '.');
      }, 'small ghost', 'con:reset'),
      h('span', { class: 'small' }, 'PRAGMA foreign_keys reads ',
        h('code', { text: String(fkOn) }),
        fkOn === 0 ? ' — writes are not being checked' : '')));

    if (fkOn === 0) {
      p.appendChild(callout('bad', 'Foreign keys are off on this connection.',
        'Nothing you write now is checked against a parent row, and PRAGMA foreign_key_check will come back ' +
        'clean because it validates the keys that exist against the rows that are there — not the write you ' +
        'made while nothing was looking. Run PRAGMA foreign_keys = ON to put it back.'));
    }

    if (state.consoleOut) {
      var o = state.consoleOut;
      var box = h('div', { class: 'console-out' });
      box.appendChild(h('div', { class: 'mono', text: o.sql }));
      if (o.error) box.appendChild(h('div', { class: 'err', text: o.error }));
      else box.appendChild(h('div', { class: 'ok', text: o.sets.length
        ? (o.sets.length + ' result set(s), ' + o.ms + ' ms')
        : ('OK, ' + o.ms + ' ms' + (o.changed === null ? '' : ', ' + o.changed + ' row(s) changed')) }));
      p.appendChild(box);
      o.sets.forEach(function (setOne) { p.appendChild(resultTable(setOne, 200)); });
    }

    if (state.history && state.history.length) {
      var hc = card('What you have run in this browser', 'Kept in IndexedDB, capped, and yours — it never ' +
        'leaves the tab. Select one to put it back in the box.');
      state.history.forEach(function (rec) {
        hc.appendChild(h('p', { class: 'small' }, h('button', {
          type: 'button', class: 'linkbtn', 'data-fkey': 'con:h:' + rec.id,
          onclick: function () { state.consoleSql = rec.sql; rerender(); }
        }, rec.sql.length > 110 ? rec.sql.slice(0, 110) + '…' : rec.sql)));
      });
      hc.appendChild(btn('Clear the history', function () {
        St.clearHistory().then(function () { state.history = []; rerender(); });
      }, 'small ghost no-print', 'con:hclear'));
      p.appendChild(hc);
    }

    /* ---- export ---- */
    var ec = card('Export this database, and check it three ways',
      'db.export() hands back the bytes of a real SQLite file. The size below is measured on this run, and ' +
      'three independent routes are used to say the file is what it claims to be — one of which this page ' +
      'cannot perform and names anyway.');
    ec.appendChild(h('div', { class: 'controls no-print' },
      btn('Export and download', function () { exportDb(); }, 'small primary', 'con:export'),
      St ? btn('Save it in this browser', function () { saveDb(); }, 'small', 'con:save') : null,
      St ? btn('What is saved?', function () { checkSaved(); }, 'small ghost', 'con:saved') : null));
    if (state.storeMsg) ec.appendChild(h('p', { class: 'small', text: state.storeMsg }));

    var I = state.exportInfo;
    if (I) {
      ec.appendChild(h('div', { class: 'summary' },
        stat('bytes exported', num(I.byteLength), 'measured on this run, in ' + I.ms + ' ms'),
        stat('page size × page count', num(I.header.pageSize) + ' × ' + num(I.header.pageCount),
          '= ' + num(I.product) + (I.productMatches ? ' — the length of the file' : ' — WHICH IS NOT THE LENGTH')),
        stat('user_version in the bytes', String(I.header.userVersion), 'read at offset 60, big-endian, by hand')));
      ec.appendChild(h('h4', { text: 'Route 1 — plain JavaScript over the byte array, SQLite not involved' }));
      ec.appendChild(h('div', { class: 'planbox', text: JSON.stringify(I.header, null, 1) }));
      ec.appendChild(I.productMatches
        ? callout('ok', 'pageSize × pageCount is exactly the exported length.',
          'The magic string, the page size, the page count and the version were read out of the raw bytes by ' +
          'domain.js, which shares no code with the engine that wrote them.')
        : callout('bad', 'The header does not describe the file.', 'That is a real defect and it is on screen.'));

      ec.appendChild(h('h4', { text: 'Route 2 — a NEW instance over those bytes, censused and re-verified' }));
      if (I.freshError) ec.appendChild(callout('bad', 'The fresh instance could not be opened.', I.freshError));
      else {
        ec.appendChild(h('p', { class: 'small', text: 'census checksum here ' + I.liveChecksum +
          ' · on the reopened bytes ' + I.freshChecksum + ' · diff ' + I.censusDiff.length +
          ' · PRAGMA user_version there: ' + I.freshUserVersion }));
        ec.appendChild(I.censusDiff.length === 0
          ? callout('ok', 'Every table matched in row count and in fold.',
            'And all ' + I.freshSummary.passed + ' of ' + I.freshSummary.total + ' invariants were recomputed ' +
            'against the reopened file, not against the array that was just produced.')
          : callout('bad', 'The round trip lost something.', JSON.stringify(I.censusDiff.slice(0, 4))));
      }

      ec.appendChild(h('h4', { text: 'Route 3 — yours, and this page cannot do it' }));
      ec.appendChild(sqlBox('sqlite3 rombak.sqlite "PRAGMA integrity_check; PRAGMA foreign_key_check; ' +
        'PRAGMA user_version; .schema encounter; SELECT count(*) FROM visit;"'));
      if (I.downloadError) ec.appendChild(callout('warn', 'The download was blocked.', I.downloadError));
    }

    ec.appendChild(callout('warn', 'PRAGMA integrity_check is not a checksum.',
      'It validates b-tree structure — page links, index consistency, records that parse — and it has no ' +
      'opinion whatever about content. Bytes flipped in free space leave it returning ok. It is a necessary ' +
      'check and it is not evidence that the data is right, which is the same mistake the Rebuild tab is about.'));
    var ic = tryRows('PRAGMA integrity_check');
    ec.appendChild(h('p', { class: 'small' }, 'PRAGMA integrity_check right now: ',
      h('code', { text: ic.ok ? JSON.stringify(ic.rows) : ic.error })));
    var fkc = tryRows('PRAGMA foreign_key_check');
    ec.appendChild(h('p', { class: 'small' }, 'PRAGMA foreign_key_check right now: ',
      h('code', { text: fkc.ok ? JSON.stringify(fkc.rows.slice(0, 4)) : fkc.error }),
      fkc.ok && fkc.rows.length ? ' — ' + fkc.rows.length + ' violation(s)' : ''));
    p.appendChild(ec);

    var rc = card('Things worth typing here');
    [
      'SELECT sqlite_version();',
      'PRAGMA compile_options;',
      'PRAGMA integrity_check;',
      'CREATE TABLE zz(a INTEGER);',
      'PRAGMA foreign_keys = OFF;',
      'DROP TABLE patient;',
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 10) SELECT group_concat(i) FROM n;",
      "SELECT rm_number, count(*) OVER () AS total FROM patient LIMIT 3;",
      "UPDATE patient SET address = 'x' WHERE rm_number = 'RM-000001' RETURNING rm_number, address;"
    ].forEach(function (sql) {
      rc.appendChild(h('p', { class: 'small' }, h('button', {
        type: 'button', class: 'linkbtn', 'data-fkey': 'con:eg:' + D.fnv1a(sql),
        onclick: function () { state.consoleSql = sql; rerender(); }
      }, sql)));
    });
    rc.appendChild(h('p', { class: 'hint', text: 'The last three are the interesting ones. ' +
      'PRAGMA foreign_keys = OFF turns every foreign-key row on the Constraints tab green and the tab says so ' +
      'in red. DROP TABLE patient makes four of the twenty-two live invariants inapplicable — every panel is ' +
      'built to degrade into a red card rather than a blank one, and the live badge names what could not run ' +
      'rather than quietly counting a smaller denominator.' }));
    p.appendChild(rc);
  }

  function saveDb() {
    var db = dbh();
    if (!db || !St) return;
    var bytes = exportKeepingFk(db);
    var f = { userVersion: RN.userVersion({ db: db }) };
    var cen = C.take(db.exec.bind(db));
    St.saveDb(bytes, { userVersion: f.userVersion, checksum: cen.checksum,
      tableCount: cen.tableCount, totalRows: cen.totalRows }).then(function (r) {
      /* A failed transaction is NOT "storage unavailable" — store.js deliberately
       * does not fall back to memory on one, and a quota error is the one honest
       * failure an 8.7 MB write has. It is shown as itself. */
      state.storeMsg = r.ok
        ? ('Saved ' + num(bytes.length) + ' bytes in IndexedDB' + (St.usingMemory() ? ' — in memory only: ' + St.reason() : '') + '.')
        : ('The save FAILED: ' + r.error + ' (' + r.what + '). That is not the same as storage being ' +
          'unavailable — the database is still there, this one write did not fit.');
      rerender();
      say(state.storeMsg);
    });
  }

  function checkSaved() {
    if (!St) return;
    St.savedInfo().then(function (info) {
      state.storeMsg = info
        ? ('Saved: ' + num(info.byteLength) + ' bytes at v' + info.userVersion + ', checksum ' + info.checksum +
          ', ' + num(info.totalRows) + ' rows across ' + info.tableCount + ' tables, written ' + info.savedAt + '.')
        : 'Nothing is saved in this browser.';
      rerender();
      say(state.storeMsg);
    });
  }
  RENDER.console = renderConsole;

  /* ============================================================= TESTS === */

  function runTests() {
    if (state.testsBusy) return;
    state.testsBusy = true;
    paintTests();
    if (state.view === 'tests') rerender();
    /* One frame, so the badge and the "running" line are actually painted before
     * the main thread disappears for twenty seconds. run() is synchronous inside
     * a promise: nothing about it yields. */
    setTimeout(function () {
      var t0 = Date.now();
      T.run().then(function (r) {
        r.ms = r.ms || (Date.now() - t0);
        state.tests = r;
        state.testsBusy = false;
        paintTests();
        if (state.view === 'tests') rerender();
        say(r.failed ? ('Tests: ' + r.failed + ' failed.')
          : ('Tests: ' + r.passed + ' of ' + r.total + ' passed, ' + r.properties + ' properties.'));
      }).catch(function (e) {
        state.tests = {
          results: [{ group: 'runner', name: 'the suite threw', ok: false, message: String(e && e.message || e) }],
          passed: 0, failed: 1, total: 1, properties: 0, executions: 1, negatives: 0, groups: 0,
          byGroup: [], noise: 0, ms: Date.now() - t0
        };
        state.testsBusy = false;
        paintTests();
        if (state.view === 'tests') rerender();
      });
    }, 30);
  }

  function corruptOneRow() {
    var db = dbh();
    if (!db) return;
    /* One row, chosen so the write is legal — every constraint on the table is
     * satisfied — and the invariant it breaks is one no CHECK can express: a
     * visit's queue_seq must not exceed the counter that issued it, which is a
     * statement about two tables. A check that cannot fail is decoration, so this
     * button exists to make it fail. */
    var sql = 'UPDATE queue_counter SET last_seq = 0 WHERE visit_date = ' +
      '(SELECT visit_date FROM visit ORDER BY queue_seq DESC LIMIT 1) AND poli_id = ' +
      '(SELECT poli_id FROM visit ORDER BY queue_seq DESC LIMIT 1)';
    var r = RN.attempt(db, sql);
    state.corrupted = { sql: sql, ok: r.ok, message: r.message };
    recomputeLive();
    rerender();
    var s = state.liveSummary;
    say(r.ok ? ('One row rewritten. ' + (s && s.failed ? s.failed + ' invariant(s) went red: ' + s.failedIds.join(', ')
      : 'and nothing went red, which would itself be a defect.')) : r.message);
  }

  function renderTests(p) {
    p.appendChild(h('h2', { text: 'Every assertion, grouped, passing ones included' }));

    /* ---- the live card, which is a different claim from the suite ---- */
    var lc = card('The database actually in front of you, checked twice',
      'This card is not the suite. The suite builds its own database from the seed and asserts against that; ' +
      'this one recomputes over the database on the other tabs, including whatever you last did in the ' +
      'Console. A suite that builds its own fixture cannot see a corrupted live one — that is how a green ' +
      'badge comes to sit above a database that does not hold together.');
    lc.appendChild(h('p', { class: 'note' },
      'Each figure is computed twice. Route A is ', h('code', { text: 'ROMBAK_ENGINE.sqlInvariants()' }),
      ' — SQLite\'s own query engine, index-assisted aggregates and joins. Route B is ',
      h('code', { text: 'ROMBAK_CENSUS.invariants()' }), ' — hand-written ES5 folding raw rows out of a ' +
      'plan-confirmed SCAN with no WHERE and no aggregate in it. Two engines, two languages. ',
      h('code', { text: "grep -o 'ROMBAK_[A-Z]*' census.js" }), ' prints ROMBAK_CENSUS and ROMBAK_DOMAIN and ' +
      'nothing else, which is why the difference in the last column is a real one.'));
    lc.appendChild(h('div', { class: 'controls no-print' },
      btn('Recompute both routes', function () { recomputeLive(); rerender(); say('Both routes recomputed.'); },
        'small', 'tests:live'),
      btn('Corrupt one row', function () { corruptOneRow(); }, 'small danger', 'tests:corrupt'),
      btn('Rebuild from the seed', function () {
        state.corrupted = null; rewindReplay(S.TARGET_VERSION);
      }, 'small ghost', 'tests:reseed')));
    if (state.corrupted) {
      lc.appendChild(callout(state.corrupted.ok ? 'bad' : 'warn',
        state.corrupted.ok ? 'One row was deliberately rewritten.' : 'The corruption was refused.',
        state.corrupted.ok ? 'Every constraint on the table accepted it — no CHECK can express a rule about ' +
          'two tables. Rebuild from the seed to undo it.' : state.corrupted.message));
      lc.appendChild(sqlBox(state.corrupted.sql));
    }
    if (state.liveErr) {
      lc.appendChild(callout('bad', 'The live check could not run at all.', state.liveErr));
    } else if (!state.live) {
      lc.appendChild(h('div', { class: 'empty', text: 'Computing…' }));
    } else {
      var s = state.liveSummary;
      lc.appendChild(h('div', { class: 'test-summary' },
        h('span', { class: 'pillbig ' + (s.failed ? 'fail' : 'pass'),
          text: s.failed ? s.failed + ' RED' : s.passed + '/' + s.total }),
        h('span', { class: 'hint', text: s.passed + ' of ' + s.total + ' invariants agree across both routes' +
          (s.applicable < s.total ? '; ' + (s.total - s.applicable) + ' could not run against this schema' : '') +
          (s.byConstruction ? '; ' + s.byConstruction + ' of the passes hold BY CONSTRUCTION at this schema ' +
            'version and verify nothing (' + s.byConstructionIds.join(', ') + ')' : '') +
          (s.pending ? '; ' + s.pending + ' pending' : '') })));
      var rows = state.live.map(function (e) {
        /* Three verdicts, not two. `true by construction` is a pass that
         * verifies nothing: the schema in front of the reader makes a non-zero
         * answer unstorable, so both routes are recomputing an identity. It is
         * NOT rendered in the same green as a figure two engines could have
         * disagreed about — that is the whole difference this page is about. */
        var verdict = !e.applicable ? pill('did not run', 'warn')
          : e.ok === true ? (e.byConstruction ? pill('true by construction', 'info') : pill('agree', 'ok'))
          : pill(e.kind === 'violation' && e.jsValue !== 0 ? 'BROKEN' : 'DISAGREE', 'bad');
        return h('tr', { class: e.ok === false ? 'sel' : null },
          h('td', null, h('code', { text: e.id })),
          h('td', { text: e.name }),
          h('td', { class: 'num', text: e.jsValue === null ? '—' : num(e.jsValue) }),
          h('td', { class: 'num', text: e.sqlValue === null ? '—' : num(e.sqlValue) }),
          h('td', { class: 'num', text: e.delta === null ? '—' : String(e.delta) }),
          h('td', null, verdict));
      });
      lc.appendChild(tableOf(['', 'invariant', { label: 'route B — JavaScript', num: true },
        { label: 'route A — SQLite', num: true }, { label: 'difference', num: true }, ''],
        rows, { minWidth: '820px', prose: true }));
      var whys = state.live.filter(function (e) { return e.why; });
      whys.forEach(function (e) {
        lc.appendChild(h('p', { class: 'small' }, h('code', { text: e.id }), ' — ', e.why));
      });
      lc.appendChild(h('p', { class: 'hint', text: 'The difference column is on screen whether it is zero or ' +
        'not, and a check that could not run against this schema says "did not run" rather than being counted ' +
        'as a pass. A check marked "true by construction" is the other honest label this table needs: the ' +
        'schema itself — a generated column, a STRICT integer column, a table CHECK — makes a non-zero answer ' +
        'unstorable, so both routes are recomputing an identity and a zero there is evidence about the schema ' +
        'and about nothing else. Rewind to v1 and the same three go red, which is where they earn their place.' }));
    }
    p.appendChild(lc);

    /* ---- the suite ---- */
    var sc = card('The assertion suite, over a database rebuilt from the seed');
    sc.appendChild(h('p', { class: 'note' },
      'Every assertion in G3 through G8, G10, G11 and G14 was proved able to go red: 137 of 137 properties ' +
      'failed under 60 deliberate mutations of the system they assert against — the pragma turned off, the ' +
      'partial indexes dropped, the triggers dropped, a hash function replaced with a constant, the fixture\'s ' +
      'planted defect repaired before the ladder walked. A suite nobody has watched fail is a suite nobody has ' +
      'any reason to believe.'));
    /* Written down because it is the more useful half of that story. Six of these
     * checks reported success by being EMPTY — an empty diff, an empty violation
     * list, two hashes agreeing — and an empty answer is what a broken check
     * returns too. Each of the six was replaced with a constant and the suite was
     * re-run; all six left it green. The controls that now catch them are in G9,
     * G12, G15 and G16, and each one drives the function against an input whose
     * answer is known and is not empty. */
    sc.appendChild(callout('warn', 'And seven of them, on this page, could not have gone red at all.',
      'Each of the following was replaced with a constant, one at a time, and the suite re-run: ' +
      'ROMBAK_CENSUS.diff() returning []; its per-table row fold returning 12345; checkDeclaration() ' +
      'returning {ok: true}; ROMBAK_ENGINE.schemaHash() returning "deadbeef"; ROMBAK_ENGINE.foreignKeyCheck() ' +
      'returning []; the Plans tab\'s row-set fold returning a constant; and a migration rung re-applied as a ' +
      '"no-op" that in fact wrote nine rows. Every one of the seven left this suite entirely green — the census ' +
      'panels went on printing "not one row of any table moved", the rollback panels went on printing "left no ' +
      'trace", the rung panels went on printing "foreign_key_check returned []", and the live table went on ' +
      'printing a zero difference. They share one shape: a check whose success is an EMPTY answer, and an ' +
      'empty answer is also what a check that has stopped looking returns. All seven now have a control that ' +
      'drives the function against an input whose answer is known and is not empty, and every one of those ' +
      'controls was watched to fail. This is the fourth time this repository has shipped a proof that compared ' +
      'a number with itself. The first three were found by reading; this one was found by corrupting.'));

    if (state.testsBusy || !state.tests) {
      sc.appendChild(h('div', { class: 'empty', text: state.testsBusy
        ? 'Running. This takes about twenty seconds the first time — it walks the ladder twice, opens a dozen ' +
          '8.7 MB instances, and computes ten censuses — and about half that on a second run, because the ' +
          'fixtures are cached for the life of the page.'
        : 'Waiting for the engine.' }));
      p.appendChild(sc);
      return;
    }

    var r = state.tests;
    sc.appendChild(h('div', { class: 'test-summary' },
      h('span', { class: 'pillbig ' + (r.failed ? 'fail' : 'pass'),
        text: r.failed ? r.failed + ' FAILED' : r.passed + ' PASSED' }),
      h('span', { class: 'hint', text: num(r.properties) + ' distinct properties, ' + num(r.executions) +
        ' executions, ' + num(r.negatives) + ' of the properties pass only because something was REFUSED · ' +
        r.groups + ' groups · ' + num(r.ms) + ' ms · sql.js printed ' + r.noise + ' line(s) to the console' }),
      btn('Run again', function () { state.tests = null; runTests(); }, 'small no-print', 'tests:again')));
    sc.appendChild(h('p', { class: 'hint', text: 'Properties and executions are different numbers and both come ' +
      'from the run object rather than from a literal in this file. One property can be executed sixty times — ' +
      'the CHECK/NULL walk in G6 is one claim about every column in the schema — so counting executions as ' +
      'claims would inflate the headline by a factor of four.' }));
    if (r.noise) {
      sc.appendChild(callout('bad', 'The engine printed to the console.',
        'sql.js is Emscripten output and its print handlers are routed into an array, never to the console, ' +
        'because one console error fails the whole CI job. ' + r.noise + ' line(s) got out.'));
    }
    p.appendChild(sc);

    /* Nested by property, using ROMBAK_TESTS.props: property k owns
     * results[from .. from + executions - 1]. Grouping by result.name instead
     * would silently merge properties that share a short execution name, and
     * several deliberately do ('accepted', 'BEGIN'). */
    var props = T.props || [];
    (r.byGroup || []).forEach(function (g) {
      var box = h('div', { class: 'tgroup' });
      box.appendChild(h('h4', { text: g.group + '   ' + g.passed + '/' + g.executions }));
      box.appendChild(h('p', { class: 'hint', text: g.properties + ' properties, ' + g.negatives +
        ' of them negative, ' + g.executions + ' executions' + (g.failed ? ', ' + g.failed + ' FAILED' : '') }));
      var mine = props.filter(function (x) { return x.group === g.group; });
      if (!mine.length) {
        r.results.forEach(function (x) {
          if (x.group !== g.group) return;
          box.appendChild(caseRow(x));
        });
      } else {
        mine.forEach(function (pr) {
          var own = r.results.slice(pr.from, pr.from + pr.executions);
          var bad = own.filter(function (x) { return !x.ok; }).length;
          box.appendChild(h('p', { class: 'small' },
            h('span', { class: 'mk', text: bad ? '✗ ' : '✓ ' }),
            pr.negative ? pill('refusal', 'bad') : null, ' ', pr.name));
          own.forEach(function (x) { box.appendChild(caseRow(x)); });
        });
      }
      p.appendChild(box);
    });
  }

  function caseRow(x) {
    return h('div', { class: 'tcase ' + (x.ok ? 'ok' : 'no') },
      h('span', { class: 'mk', text: x.ok ? '✓' : '✗' }),
      h('span', { text: x.name }),
      x.ok ? null : h('span', { class: 'msg', text: x.message }));
  }
  RENDER.tests = renderTests;

  /* ============================================================== BOOT === */

  /* The walk is chunked, one rung per timeout.
   *
   * A census is about a quarter of a second and the walk takes thirteen of them,
   * so run as one block this is five seconds of a frozen page with nothing on it.
   * One rung per timeout costs the same total and the Migrations panel fills in
   * in front of the reader, the badges update, and the browser answers a click.
   * Each rung's AFTER census becomes the next rung's BEFORE — still a value
   * captured before the next rung runs, which is the rule that matters — and that
   * halves the count. */
  function walkStep(v, carry) {
    var db = dbh();
    if (!db || v > S.TARGET_VERSION) { walkDone(); return; }
    state.bootStep = 'applying v' + v + ' of ' + S.TARGET_VERSION;
    var r = RN.applyOne(v, { db: db, before: carry });
    var slot = { refused: null, applied: null };
    if (r.refused) {
      slot.refused = r;
      state.rungs[v] = slot;
      renderIfVisible('migrations');
      /* The fixes are applied and the rung re-run in the same chunk, because a
       * page that stopped on the first refusal would need the reader to know
       * which button to press before anything else on it worked. Both reports are
       * kept: the refusal is the interesting one. */
      slot.fixes = RN.fixRefusal(v, { db: db });
      var again = RN.applyOne(v, { db: db });
      if (again.refused) slot.refused = again; else slot.applied = again;
    } else slot.applied = r;
    state.rungs[v] = slot;
    state.version = RN.userVersion({ db: db });
    if (v === 6 && slot.applied) state.bytes6 = exportKeepingFk(db);
    if (v === S.TARGET_VERSION && slot.applied) state.bytes9 = exportKeepingFk(db);
    renderIfVisible('migrations');
    var next = slot.applied && slot.applied.census ? slot.applied.census.after : null;
    if (!slot.applied) { walkDone(); return; }
    setTimeout(function () { walkStep(v + 1, next); }, 0);
  }

  function renderIfVisible(name) {
    if (state.view === name) renderPanel(name);
  }

  function walkDone() {
    state.booting = false;
    state.bootStep = 'ready';
    recomputeLive();
    rerender();
    if (T) setTimeout(runTests, 30);
    if (St) {
      St.history(12).then(function (list) {
        state.history = list || [];
        if (state.view === 'console') rerender();
      }).catch(function () { /* history is a convenience */ });
    }
    say('The ladder walked to v' + state.version + '. ' +
      (state.liveSummary ? state.liveSummary.passed + ' of ' + state.liveSummary.total +
        ' live invariants agree across both routes.' : ''));
  }

  function startWalk() {
    var b;
    try { b = RN.boot({}); }
    catch (e) {
      state.bootErr = 'The fixture could not be built: ' + (e.message || String(e));
      state.booting = false;
      rerender();
      return;
    }
    state.db = b.db;
    /* boot() exports v1's bytes internally, and db.export() drops the pragma on
     * the way past. Nothing between here and the first rung writes anything, but
     * the pragma is put back anyway rather than relying on that. */
    rearm(state.db);
    state.boot = {
      version: b.version, counts: b.counts, totalRows: b.totalRows, chain: b.chain,
      defects: b.defects, meta: b.meta, buildMs: b.buildMs, insertMs: b.insertMs,
      ms: b.ms, baseBytesLength: b.baseBytesLength
    };
    state.rungs[1] = { refused: null, applied: b.v1 };
    state.version = b.version;
    rerender();
    setTimeout(function () { walkStep(2, b.census); }, 0);
  }

  function boot() {
    paintTheme();
    var tb = $('themeBtn');
    if (tb) tb.addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    var bt = $('testBadge'), lb = $('liveBadge');
    if (bt) bt.addEventListener('click', function () { switchTab('tests'); });
    if (lb) lb.addEventListener('click', function () { switchTab('tests'); });
    if (root.ROMBAK_GUARD) root.ROMBAK_GUARD.onchange = paintNet;
    paintNet();
    paintTests();
    paintLive();
    wireTabs();

    /* The escape hatch lives in the footer rather than on a tab, because it is
     * not a feature and a visitor should not have to hunt for it. */
    var foot = document.querySelector('.foot');
    if (foot && St) {
      foot.appendChild(h('p', { class: 'small no-print' },
        btn('Delete my local data', function () {
          St.clearAll().then(function () {
            state.history = [];
            state.storeMsg = 'IndexedDB emptied: the saved database and the console history are gone. ' +
              'The theme is in localStorage and is left alone.';
            rerender();
            say(state.storeMsg);
          });
        }, 'small ghost', 'foot:wipe'),
        ' — empties IndexedDB. The database on this page is rebuilt from one seed number on every load anyway; ' +
        'nothing you do here is stored unless you press Save.'));
    }

    renderPanel('schema');

    if (!E) {
      state.bootErr = 'engine.js did not load, so there is no database on this page at all.';
      state.booting = false;
      rerender();
      return;
    }
    E.ready().then(function () {
      state.bootStep = 'building the fixture';
      rerender();
      setTimeout(startWalk, 0);
    }).catch(function (e) {
      state.bootErr = 'The SQLite engine did not start: ' + (e && e.message || e);
      state.booting = false;
      rerender();
      say(state.bootErr);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
