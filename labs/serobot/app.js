/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — app.js
 * The only file on this page that touches the DOM. It renders what the ten
 * engine modules compute and it computes nothing they could have: it never
 * re-derives a balance, never recomputes a shortfall, never invents an
 * expectation and never rewrites a refusal code. The engines return values and
 * this file puts them on screen unchanged.
 *
 * Eleven things this file has to get right, every one of them measured rather
 * than reasoned about:
 *
 *  1. EVERY FIGURE, SOURCE LINE AND ERROR CODE ARRIVES THROUGH textContent,
 *     which is why all seven panels ship empty in index.html. An arm body read
 *     back with Function.prototype.toString contains `<` before a letter and a
 *     raw `&&`; written into the markup that is an html-validate
 *     no-raw-characters violation and a parse5
 *     invalid-first-character-of-tag-name error at the same time, and a literal
 *     script tag in prose is additionally harvested by test/syntax.test.js and
 *     handed to node --check. Through textContent the same string cannot be
 *     markup at all — which on a page whose whole argument is "what is on
 *     screen is what ran" removes a class of bug rather than avoiding a lint.
 *
 *  2. THE TWO ROUTES MUST STAY APART, AND THIS FILE IS WHERE THEY WOULD MERGE.
 *     Wherever a pair of figures appears with a difference beside it, the
 *     comment above the pair names both producers. Route A is db.js reading the
 *     stores back; route B is saksi.js handed an injected reader, a snapshot
 *     VALUE, and W and n as two separate integers it multiplies itself. The
 *     natural bug here — the one this repository has shipped four times — is to
 *     compute one side in this file from the other, at which point the
 *     difference column can only ever be zero. Not one figure in a .wit row is
 *     produced here.
 *
 *  3. RUN() IS ONCE PER PAGE LOAD, BY CONTRACT. tests.js holds a single-flight
 *     latch and hands every caller the identical promise for the life of the
 *     page — measured with four callers, three in one turn. The badge run and
 *     CI's page.evaluate are therefore ONE run. The Tests tab's control
 *     re-renders the result it already has and says so; it cannot re-run the
 *     suite, and a button that claimed to would be lying about which run the
 *     numbers came from.
 *
 *  4. THIS FILE'S OWN DEMONSTRATIONS RUN STRICTLY AFTER THAT SUITE, NEVER
 *     BESIDE IT. Two runs on one page destroy each other: measured, one run's
 *     deleteDatabase fires onversionchange on the other's connection, that
 *     connection closes itself, and the next transaction dies as a page error
 *     with every assertion green. The suite owns its run id, its database names
 *     and its lock prefix; this file waits, then takes its own.
 *
 *  5. NOTHING ON THIS PAGE ATTEMPTS EGRESS, not even to demonstrate the counter
 *     in the header. Every refusal the browser issues writes a console error and
 *     the automation runner counts one console error as a broken page — so a
 *     "press to prove the counter works" button would fail the build with every
 *     assertion green. This file only ever READS the guard's total, and folds
 *     each worker's self-reported total into it through the guard's own
 *     noteExternal rather than writing to its counters from outside.
 *
 *  6. NO RACE OUTCOME IS EVER PRINTED WITHOUT ITS BADGE. Two words carry it:
 *     `asserted` for a figure the suite pins, `measured` for one nothing
 *     touches. Every free-mode container this file builds goes through seal(),
 *     so if a future contributor moves one into an assertion helper the tripwire
 *     in tests.js fails on the first run instead of flaking on somebody else's
 *     laptop six months later.
 *
 *  7. THE MAIN THREAD STAYS FREE, AND IT IS MEASURED WITH requestAnimationFrame.
 *     A setInterval gap detector reports 0 ms for a real 788 ms block, because
 *     the callback cannot fire during the block and clearing the timer in the
 *     same turn discards the late tick — the lab two doors down froze for 23.6
 *     seconds and four separate reviews passed it. The monitor here is pantau's,
 *     it forces a microtask yield before reading the clock, it runs across the
 *     whole boot, and the longest gap is printed on the Limits tab as an
 *     observation. It is never asserted: a threshold is a timing pin.
 *
 *  8. FOCUS SURVIVES A RE-RENDER. Every control carries a data-fkey; the key and
 *     the caret are captured before a panel is torn down and restored after. The
 *     sliders on two tabs re-render their own panel on every input event, and a
 *     panel that drops focus to <body> under the reader's hands is unusable with
 *     a keyboard.
 *
 *  9. A THROWING RENDERER MUST NOT REACH THE CONSOLE, for the same reason as 5.
 *     renderPanel wraps each renderer and prints the failure as a card in place.
 *
 * 10. guard.js RECORDS A TAB CLICK THAT LANDED BEFORE THIS FILE EXISTED, on
 *     <html> as data-serobot-pending-tab, and stands down the moment <html>
 *     carries the class `ready`. So: read the attribute, honour it, THEN add
 *     `ready`. The other order silently discards the click the mechanism exists
 *     to catch.
 *
 * 11. THE THEME BUTTON LABELS THE ACTION AND CARRIES NO aria-pressed. It ships
 *     reading "Light"; in the light theme it must read "Dark". No validator
 *     catches that, which is exactly the class of defect the "not built" list
 *     names: nothing automated watches this file.
 */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var DB = root.SEROBOT_DB;
  var ARMS = root.SEROBOT_ARMS;
  var UTAS = root.SEROBOT_UTAS;
  var IDEM = root.SEROBOT_IDEM;
  var KUNCI = root.SEROBOT_KUNCI;
  var PANTAU = root.SEROBOT_PANTAU;
  var SAKSI = root.SEROBOT_SAKSI;
  var T = root.SEROBOT_TESTS;

  var WORKER_URL = 'kerja.worker.js';

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
     while(firstChild) removeChild loop is not equivalent: removing a FOCUSED
     input fires blur synchronously, and a blur handler that re-renders leaves
     the loop removing a node that is no longer its child. */
  function clear(el) { el.textContent = ''; }

  /* Every figure on this page is a small integer count of a fabricated unit, so
     there is no thousands separator to get wrong and no float to round. A value
     this function cannot state as an integer prints as an em dash rather than
     as a zero, because a zero here is a real and interesting answer. */
  function int(n) {
    if (n === null || n === undefined) return '—';
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return String(n);
  }

  function now() {
    try { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
    catch (e) { return Date.now(); }
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

  function pill(text, cls) { return h('span', { class: 'pill' + (cls ? ' ' + cls : ''), text: text }); }

  /* The two badge words from the lede, and the two quieter ones beside them.
     The chip prints the WORD, so the distinction survives monochrome, a reader
     with a colour deficiency, and a stylesheet that failed to load. Colour is
     never the only carrier anywhere on this page. */
  function kind(k) {
    if (k === 'asserted') return h('span', { class: 'kind asserted', text: 'asserted', title: 'the suite pins this figure and CI goes red if it moves' });
    if (k === 'diukur') return h('span', { class: 'kind diukur', text: 'diukur', title: 'measured and shown, deliberately not asserted: the specification permits this outcome rather than requiring it' });
    if (k === 'none') return h('span', { class: 'kind none', text: 'unasserted', title: 'nothing in the suite reads this figure' });
    return h('span', { class: 'kind measured', text: 'measured', title: 'a real number from a real run; no assertion touches it' });
  }

  function btn(label, onclick, cls, fkey) {
    return h('button', {
      type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), 'data-fkey': fkey || null, onclick: onclick
    }, label);
  }

  function stat(k, v, n, cls) {
    return h('div', { class: 'stat' + (cls ? ' ' + cls : '') },
      h('div', { class: 'k', text: k }),
      h('div', { class: 'v', text: v }),
      n ? h('div', { class: 'n', text: n }) : null);
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

  function srcbox(text) {
    return h('pre', { class: 'srcbox', text: text === null || text === undefined ? '—' : String(text) });
  }

  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { text: label }), control);
  }

  function slider(value, min, max, fkey, oninput) {
    return h('input', {
      type: 'range', value: String(value), min: String(min), max: String(max), step: '1',
      'data-fkey': fkey, oninput: oninput
    });
  }

  var sayTimer = null;
  function say(text) {
    var el = $('say');
    if (!el || !text) return;
    /* Cleared first and set on a timer: a live region whose text is replaced in
       the same task is not re-announced by every screen reader. */
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
    } catch (e) { /* selectionStart throws on a range input, which is most of them here */ }
    return snap;
  }

  /* Where focus goes when the control that had it no longer exists. The anchor
     is the control the next action needs anyway, so a keyboard reader is never
     dropped onto <body> in the middle of a card. */
  var FOCUS_ANCHOR = {
    ledgers: 'ledgers:again', thread: 'thread:run',
    queue: 'queue:again', tests: 'tests:again'
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
    if (el === document.activeElement) return;
    try { el.focus({ preventScroll: true }); } catch (e2) { try { el.focus(); } catch (e3) { return; } }
    if (snap.selStart !== undefined) {
      var n = (el.value === undefined || el.value === null) ? 0 : String(el.value).length;
      var a = Math.min(snap.selStart, n), b2 = Math.min(snap.selEnd === undefined ? a : snap.selEnd, n);
      try { el.setSelectionRange(a, b2); } catch (e4) { /* not a text control */ }
    }
  }

  /* --------------------------------------------------------------- state */

  var state = {
    view: 'ledgers',
    step: 'waiting for the engine files',
    runId: '',
    prefix: '',
    seq: 0,               // one counter per run of this page, so no two demo databases share a name
    W: 2, n: 20,          // the rendezvous, clamped and asserted; set from pantau at boot
    hc: 1,                // the RAW core count, printed and never asserted
    freeW: 2, freeN: 20, freeBatch: 3,
    tW: 2, tN: 10, tStrat: 'polos',
    busy: '',             // a non-empty string disables every control that would start work
    mesin: null,
    atomik: null,
    rafH: null,
    raf: null,
    src: null,
    tests: null, testsMs: 0, testsBusy: false, testsErr: '', testsAll: false,
    pusat: null, pusatErr: '',
    bebas: { samples: [], batches: 0, err: '' },
    utas: null, utasErr: '', utasOne: null,
    batas: null, urut: null,
    idem: null, idemErr: '',
    kunci: null, kunciErr: '',
    antrean: null,
    audit: null, auditErr: ''
  };

  /* ---------------------------------------------------------- the badges */

  /* READ, never written. The guard counts attempts this page does not make, and
     the repaint is wired so that a count nobody expected still shows up. The
     worker halves are folded in by pantau.js through the guard's own
     noteExternal at the moment of the attempt, not by arithmetic here. */
  function paintNet() {
    var g = root.SEROBOT_GUARD;
    var n = g ? g.total() : 0;
    var el = $('netCount');
    if (el) el.textContent = 'network calls from this page: ' + n;
    var b = $('netBadge');
    if (b) b.className = 'netbadge' + (n ? ' bad' : '');
  }

  function paintTests() {
    var b = $('testBadge'), t = $('testText');
    if (!b || !t) return;
    if (state.testsErr) {
      b.className = 'testbadge bad';
      t.textContent = 'tests: could not run';
      return;
    }
    if (state.testsBusy || !state.tests) {
      b.className = 'testbadge busy';
      t.textContent = state.testsBusy ? 'tests: running…' : 'tests: waiting…';
      return;
    }
    var r = state.tests;
    /* THE BADGE SHOWS PROPERTIES. The labs hub shows executions. They are
       different numbers on purpose and adding them together is the one thing
       the assertion plan forbids by name: a property run once per arm and once
       per writer count is still one claim.
       `noise` is the guard's own total as the suite found it — page realm plus
       every worker's self-reported count — and not a console tally. It can only
       be non-zero if something here attempted egress, which nothing does, so a
       positive value is a defect and reads as one. */
    b.className = 'testbadge' + ((r.failed || r.noise) ? ' bad' : '');
    t.textContent = r.failed
      ? 'tests: ' + r.failed + ' FAILED'
      : 'tests: ' + r.properties + ' properties, ' + r.passed + '/' + r.total + ' passed';
  }

  function paintTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var b = $('themeBtn');
    if (!b) return;
    /* The visible word IS the accessible name and it names the ACTION. No
       aria-pressed: a state bit contradicts an action label, and two sibling
       labs learned that the hard way — "Dark, pressed" announced while the page
       was light. The change is announced through the live region instead, which
       says what happened rather than what the control is. */
    b.textContent = dark ? 'Light' : 'Dark';
    b.removeAttribute('aria-pressed');
    b.setAttribute('title', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  }

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    /* RAW 'light'/'dark', never JSON. A save() helper that wrote '"light"' is
       the exact bug guard.js heals in place on the next load; reintroducing it
       here would make the heal permanent rather than historical. */
    try { root.localStorage.setItem('serobot.theme', next); } catch (e) { /* private mode, quota, disabled */ }
    paintTheme();
    say(next === 'dark' ? 'Dark theme.' : 'Light theme.');
  }

  /* ------------------------------------------------------------ plumbing */

  var RENDER = {};

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel || !RENDER[name]) return;
    var snap = captureFocus();
    clear(panel);
    try { RENDER[name](panel); }
    catch (e) {
      /* The last line of defence. A renderer that throws must not become a
         console error: the runner counts one as a failed lab, and it would fail
         it for a reason that has nothing to do with any claim on this page. */
      panel.appendChild(callout('bad', 'This panel failed to render.',
        String((e && e.name) || '') + ' ' + String((e && e.message) || e)));
    }
    restoreFocus(snap);
  }

  function rerender() { renderPanel(state.view); }

  function renderIfVisible(name) { if (state.view === name) renderPanel(name); }

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
    /* Only on a click. Keyboard focus already announces the tab, and saying it
       twice is worse than not saying it at all. The VISIBLE label, never the
       internal key: announcing "ledgers tab" names something that appears
       nowhere on the page, to the one visitor who cannot see which tab moved. */
    if (!fromKeyboard) {
      var lab = $('tab-' + name);
      say((lab ? lab.textContent.trim() : name) + ' tab.');
    }
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
           and renders the panel, and focusing first lets the render move focus
           again. */
        next.focus();
        showTab(next);
      });
    });
  }

  /* Blink does not scroll a PARTIALLY visible element into view when it takes
     focus, and the strip is an overflow-x scroller: at 390px the Tests tab is
     genuinely off-screen right, and arrowing onto it leaves it there with its
     focus ring outside the box. */
  function showTab(el) {
    if (!el.scrollIntoView) return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (e) { /* the older signature takes a boolean and would scroll the page */ }
  }

  function waiting(p, what) {
    p.appendChild(h('div', { class: 'empty', text: what }));
  }

  function busyNote(p) {
    if (!state.busy) return;
    p.appendChild(callout('measured', 'Running:', state.busy +
      '. Controls that would start a second run are disabled until it finishes — two runs on one page share one storage engine and destroy each other.'));
  }

  /* ------------------------------------------------- shared render pieces */

  /* THE INDEPENDENCE TABLE. Route A is db.js reading the stores back through
     its own cursor; route B is saksi.js, which received an injected reader, a
     snapshot VALUE and two separate integers, and which shares no code with
     route A below IDBObjectStore. Nothing in this function computes either
     column: `banding` arrives from saksi.js already paired, and the difference
     column is rendered even when it is zero, because a difference column that
     only appears when it is non-zero is a column nobody checks. */
  function witTable(banding, note) {
    var box = h('div');
    box.appendChild(h('div', { class: 'wit' },
      h('span', { text: 'figure' }),
      h('span', { class: 'a', text: 'route A · engine' }),
      h('span', { class: 'b', text: 'route B · witness' }),
      h('span', { class: 'd', text: 'difference' })));
    banding.rows.forEach(function (r) {
      box.appendChild(h('div', { class: 'wit' + (r.differs ? ' differs' : '') },
        h('span', { text: r.label }),
        h('span', { class: 'a', text: int(r.a) }),
        h('span', { class: 'b', text: int(r.b) }),
        h('span', { class: 'd', text: (r.d > 0 ? '+' : '') + int(r.d) })));
    });
    box.appendChild(h('p', { class: 'sharedbottom' },
      'sharedBottom: ' + banding.sharedBottom + ' — both routes end in the same object store and the same scheduler.'));
    if (note) box.appendChild(h('p', { class: 'small', text: note }));
    return box;
  }

  /* The limit, printed BESIDE the agreement and never underneath it. Quantified
     during the build rather than hedged: a witness handed the engine's own
     cached rows instead of reading them back detects nothing, because they are
     the same rows. Falsify one of those rows and twelve properties go red. */
  function firewallNote() {
    return callout('measured', 'What the second route can and cannot catch.',
      'Both routes bottom out in the same IDBObjectStore and the same scheduler; there is no second storage ' +
      'engine in a browser and saksi.js is not one. Measured on the shipped suite: a witness that folds the ' +
      'engine\'s cached row array instead of reading the store back turns 0 of 173 properties red. Corrupt one ' +
      'row inside that cache and 12 go red. The separation catches a mistake in this lab\'s arithmetic; it ' +
      'cannot catch a lie told by the browser\'s own transaction manager.');
  }

  function refusalRow(label, slot, want) {
    var got = slot && slot.ditolak ? slot.nama : (slot ? 'did not refuse' : '—');
    return h('tr', null,
      h('td', { text: label }),
      h('td', null, h('code', { text: want })),
      h('td', null, got === want ? pill(got, 'ok') : pill(got, 'bad')));
  }

  function machineStrip() {
    var m = state.mesin;
    if (!m) return null;
    /* A race result without a machine is not a result. This also pre-empts "it
       didn't reproduce for me": of course it didn't, and the page said which
       machine it was on. */
    return h('p', { class: 'small' },
      h('b', { text: 'The machine, read at runtime: ' }),
      'hardwareConcurrency ' + int(m.hardwareConcurrency) +
      ' · deviceMemory ' + String(m.deviceMemory) +
      ' · visibilityState ' + String(m.visibilityState) +
      ' · crossOriginIsolated ' + String(m.crossOriginIsolated) + '. ',
      kind('none'));
  }

  /* ======================================================== TWO LEDGERS === */

  /* The arm columns. The class is named after the OUTCOME and not after the
     arm, so this file never hardcodes which arm loses: `short` is whatever came
     in under the expectation, and the engine is what said so. The word is in
     the markup beside the rule. */
  function armColumn(name, got, expected, blurb, badge) {
    var short = got !== expected;
    var cls = badge === 'measured' ? 'measured' : (short ? 'short' : 'exact');
    return h('div', { class: 'arm ' + cls },
      h('h4', { text: name }),
      h('div', { class: 'big', text: int(got) }),
      h('div', { class: 'sub-n', text: (short ? 'short by ' + int(expected - got) + ' of ' : 'all ') + int(expected) + ' credits' }),
      h('p', { class: 'small' }, kind(badge || 'asserted'), ' ', blurb));
  }

  function renderLedgers(p) {
    busyNote(p);
    p.appendChild(renderPusat());
    p.appendChild(renderBebas());
    p.appendChild(renderSumber());
  }
  RENDER.ledgers = renderLedgers;

  function renderPusat() {
    var c = card('The rendezvous — the loss as an exact integer',
      'Four write shapes, one file, one switch, all four credited inside one loop iteration of one worker ' +
      'against the same clock. A two-phase rendezvous holds every writer until all of them have read, and ' +
      'again until all of them have written, so the worst interleaving happens on every round instead of ' +
      'sometimes. That is where the exactness comes from: it is a message count, not a delay.');

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('writers, W · ' + state.W,
      slider(state.W, 1, 8, 'ledgers:W', function (e) {
        state.W = parseInt(e.target.value, 10) || 2; renderIfVisible('ledgers');
      })));
    ctl.appendChild(field('rounds, n · ' + state.n,
      slider(state.n, 1, 60, 'ledgers:n', function (e) {
        state.n = parseInt(e.target.value, 10) || 1; renderIfVisible('ledgers');
      })));
    ctl.appendChild(btn('Run the rendezvous again', function () { again('pusat'); },
      'primary' + (state.busy ? ' small' : ''), 'ledgers:again'));
    c.appendChild(ctl);
    c.appendChild(h('p', { class: 'hint', text: 'W ' + state.W + ' · n ' + state.n + ' · expected ' +
      (state.W * state.n) + ' credits per arm. The suite drives this at the clamped writer count, ' +
      'max(2, min(8, hardwareConcurrency)) = ' + int(state.mesin ? state.mesin.clampW : 2) +
      ', and asserts the clamp; the sliders are yours. At W = 1 the whole thesis collapses into a ' +
      'tautology that passes — the unsafe arm and the safe arm both end at n — which is exactly why ' +
      'the suite clamps and this control does not.' }));
    if (state.busy) disableIn(c);

    if (state.pusatErr) { c.appendChild(callout('bad', 'The rendezvous did not complete.', state.pusatErr)); return c; }
    if (!state.pusat) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return c; }

    var P = state.pusat, res = P.res, v = P.verdict, m = P.mesin;
    var exp = m.expected;

    var sum = h('div', { class: 'summary' });
    sum.appendChild(stat('writers, W', int(res.W), 'clamped from hardwareConcurrency ' + int(state.hc), 'exact'));
    sum.appendChild(stat('rounds, n', int(res.n), 'each writer, each arm', 'exact'));
    sum.appendChild(stat('expected per arm', int(exp), 'W × n, multiplied twice by two files', 'exact'));
    sum.appendChild(stat('workers spawned', int(res.spawned), int(res.terminated) + ' terminated, ' + int(res.done) + ' reported done'));
    sum.appendChild(stat('rendezvous releases', int(res.released), 'arms × phases × rounds', 'exact'));
    sum.appendChild(stat('worker errors', int(res.errs.length), int(res.urj.length) + ' unhandled rejections, ' + int(res.msgerr) + ' clone failures'));
    c.appendChild(sum);

    var arms = h('div', { class: 'arms' });
    arms.appendChild(armColumn('pisah', m['K-pisah'] - (P.before.akun['K-pisah'] | 0), exp,
      'Read in one transaction, written in a later one. The read-set spans a transaction boundary and that is the entire bug.'));
    arms.appendChild(armColumn('satu', m['K-satu'] - (P.before.akun['K-satu'] | 0), exp,
      'The same read and the same write, inside one transaction. There is no reachable point between them.'));
    arms.appendChild(armColumn('jurnal', v.buku.jurnal ? v.buku.jurnal.total : 0, exp,
      'No read at all, so there is nothing to go stale. add(), never put(), so a replayed key throws instead of overwriting.'));
    arms.appendChild(armColumn('kunci', m['K-kunci'] - (P.before.akun['K-kunci'] | 0), exp,
      'The pisah body verbatim, wrapped in a real Web Lock. Advisory, and it works because every writer asks.'));
    c.appendChild(arms);

    c.appendChild(callout('exact', 'pisah ends at n, not at W × n, and it does so independently of W.',
      'Every writer reads the same value in a round and every writer stores that value plus one, so a round ' +
      'advances the column by exactly one however many writers there were. The same loss on one event loop with ' +
      'no workers at all is the panel one tab over, and there it is exact too — parallelism makes the ' +
      'interleaving easy to hit, not possible.'));

    c.appendChild(h('h4', { text: 'The same figures, twice, from two routes that share no code' }));
    c.appendChild(h('p', { class: 'note' },
      'Route A is db.js reading the stores back. Route B is saksi.js, handed a reader function, the "before" ' +
      'snapshot as a value, and W and n as two separate integers it multiplies itself — it never receives a ' +
      'database, a transaction, a lock, a worker or a port, and it could not open one if it wanted to. ',
      h('code', { text: "grep -o 'SEROBOT_[A-Z]*' labs/serobot/saksi.js | sort -u" }),
      ' prints one line.'));
    c.appendChild(witTable(P.banding,
      P.banding.ok ? 'The two routes agree on every figure above.' :
        'The two routes disagree on ' + P.banding.differs + ' figure(s). That is a defect in this lab, not a result.'));
    c.appendChild(firewallNote());

    if (v.alasan.length) {
      c.appendChild(callout('bad', 'The witness refused to certify part of this run.',
        v.alasan.join(' · ')));
    }
    return c;
  }

  /* --------------------------------------------------- free mode, in order */

  /* §7's order, top to bottom, and the order is the argument: batch size before
     the batch, then every sample, then the spread, then the machine, then the
     slot the shortfall would have occupied whether or not there was one. A
     panel that assumed a shortfall would print an empty one on a fast box, and
     the first thing a hostile reader does is look for exactly that. */
  function renderBebas() {
    var c = card('The same four arms with nothing synchronising them — measured, and pinned by nothing',
      'Identical code, identical workload, identical seconds. The only difference is that no rendezvous holds ' +
      'anyone: the writers interleave however this machine happens to schedule them. Nothing below is asserted ' +
      'anywhere, and the suite would not notice if every figure changed.');

    var B = state.bebas;

    /* 1. The batch size, printed before the batch starts. There is no retry
       policy on this page and nothing loops until it sees a loss. */
    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('batch size · ' + state.freeBatch,
      slider(state.freeBatch, 1, 20, 'bebas:batch', function (e) {
        state.freeBatch = parseInt(e.target.value, 10) || 1; renderIfVisible('ledgers');
      })));
    /* Moving either of these changes the experiment, so the samples already on
       screen stop being samples of it. They are cleared rather than appended to:
       a strip mixing two configurations has a min, a median and a max that
       describe nothing. */
    ctl.appendChild(field('writers, W · ' + state.freeW,
      slider(state.freeW, 1, 8, 'bebas:W', function (e) {
        var v = parseInt(e.target.value, 10) || 1;
        if (v !== state.freeW) { state.freeW = v; state.bebas = { samples: [], batches: 0, err: '' }; }
        renderIfVisible('ledgers');
      })));
    ctl.appendChild(field('rounds each, n · ' + state.freeN,
      slider(state.freeN, 1, 20, 'bebas:n', function (e) {
        var v = parseInt(e.target.value, 10) || 1;
        if (v !== state.freeN) { state.freeN = v; state.bebas = { samples: [], batches: 0, err: '' }; }
        renderIfVisible('ledgers');
      })));
    ctl.appendChild(btn('Run another batch of ' + state.freeBatch, function () { again('bebas'); }, '', 'bebas:go'));
    c.appendChild(ctl);
    c.appendChild(h('p', { class: 'hint' },
      'Batch of ' + state.freeBatch + ', W ' + state.freeW +
      (state.freeW === state.hc ? ' (the raw core count, unclamped — free mode never clamps and asserts nothing)'
        : ' (you moved this; the raw core count here is ' + int(state.hc) + ')') +
      ', n ' + state.freeN + ', expected ' + (state.freeW * state.freeN) + ' per arm. ',
      B.batches ? String(B.samples.length) + ' sample(s) so far, across ' + B.batches + ' batch(es). ' : '',
      'Nothing here retries and nothing here loops until it sees a loss.'));
    if (state.busy) disableIn(c);

    if (B.err) c.appendChild(callout('bad', 'A free-running batch did not complete.', B.err));
    if (!B.samples.length) {
      c.appendChild(h('div', { class: 'empty', text: state.busy ? 'Building: ' + state.step :
        'The batch above has not run at this configuration yet. Press the button.' }));
      return c;
    }

    var exp = B.samples[0].expected;
    var vals = [], i;
    for (i = 0; i < B.samples.length; i++) vals.push(B.samples[i].pisah);
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var full = 0;
    for (i = 0; i < vals.length; i++) if (vals[i] === exp) full++;

    /* 2. Every sample, as a strip. Not a summary: a histogram hides the run that
       reached the correct answer, and that run is the honest half of the claim. */
    c.appendChild(h('h4', { text: 'pisah — every sample in the batch, in order' }));
    var strip = h('div', { class: 'strip' });
    B.samples.forEach(function (s, idx) {
      strip.appendChild(h('span', {
        class: 's' + (s.pisah === s.expected ? ' full' : ''),
        title: 'sample ' + (idx + 1) + ': ' + s.pisah + ' of ' + s.expected +
          (s.pisah === s.expected ? ' — this run lost nothing' : ''),
        text: String(s.pisah)
      }));
    });
    c.appendChild(strip);
    c.appendChild(h('p', { class: 'small' }, kind('measured'), ' ',
      'A sample marked with a rule reached ' + int(exp) + ' — the correct answer — and lost nothing at all.'));

    /* 3. Min / median / max and the count that lost nothing, printed whether it
       is zero or the whole batch. Never hidden, never a fallback branch. */
    var sum = h('div', { class: 'summary' });
    sum.appendChild(stat('samples', int(vals.length), 'across ' + int(B.batches) + ' batch(es)', 'measured'));
    sum.appendChild(stat('minimum', int(sorted[0]), 'of ' + int(exp) + ' expected', 'measured'));
    sum.appendChild(stat('median', int(sorted[Math.floor((sorted.length - 1) / 2)]), 'of ' + int(exp), 'measured'));
    sum.appendChild(stat('maximum', int(sorted[sorted.length - 1]), 'of ' + int(exp), 'measured'));
    sum.appendChild(stat('runs that lost nothing', int(full), int(vals.length - full) + ' came up short', 'measured'));
    c.appendChild(sum);

    /* 4. The machine beside it. */
    var ms = machineStrip();
    if (ms) c.appendChild(ms);

    /* 5. The slot the shortfall sentence occupies. Both branches are real prose
       generated from the batch — the page cannot claim a shortfall the batch did
       not find, and it cannot hide one it did. */
    if (full === vals.length) {
      c.appendChild(h('p', { class: 'noloss' },
        'No loss observed on this machine today. ' + int(vals.length) + ' of ' + int(vals.length) +
        ' samples reached ' + int(exp) + '. That is not a run in which nothing could be lost — it is a run in ' +
        'which nothing was. The rendezvous above forces the worst case every time, and that is the number this ' +
        'lab asserts.'));
    } else {
      c.appendChild(h('p', { class: 'noloss' },
        'Short by ' + int(exp - sorted[0]) + ' at worst and ' + int(exp - sorted[sorted.length - 1]) +
        ' at best, across ' + int(vals.length) + ' samples, of which ' + int(full) + ' lost nothing. ' +
        'Press the button again and these numbers will move. That is the point, and it is why nothing here is ' +
        'asserted: a suite that requires a race to go a particular way goes red on somebody else\'s laptop.'));
    }

    /* 6. The control, in the SAME batch, in the same seconds, with the same
       parameters — not safe-then-unsafe. All three arms run inside one loop
       iteration of one worker, so the safe columns below were produced by the
       same scheduler, in the same milliseconds, under the same contention. */
    c.appendChild(h('h4', { text: 'The control, in the same batch and the same seconds' }));
    c.appendChild(tableOf(
      ['sample', { label: 'pisah — read and write in separate transactions', num: true },
        { label: 'satu — one transaction', num: true },
        { label: 'jurnal — append-only, folded on read', num: true },
        { label: 'expected', num: true }],
      B.samples.map(function (s, idx) {
        return h('tr', null,
          h('td', { text: String(idx + 1) }),
          h('td', { class: 'num', text: int(s.pisah) }),
          h('td', { class: 'num', text: int(s.satu) }),
          h('td', { class: 'num', text: int(s.jurnal) }),
          h('td', { class: 'num', text: int(s.expected) }));
      }), { minWidth: '520px' }));
    c.appendChild(h('p', { class: 'small' }, kind('measured'), ' ',
      'The three arms are credited one after another inside one loop iteration of one worker, so the safe ' +
      'columns are not a later, calmer run — they are the same milliseconds. satu and jurnal do not move.'));

    /* 8. The barrier column beside it. */
    if (state.pusat) {
      c.appendChild(callout('exact', 'And the same four arms under the rendezvous, for comparison:',
        'pisah ' + int(state.pusat.mesin['K-pisah'] - (state.pusat.before.akun['K-pisah'] | 0)) +
        ' of ' + int(state.pusat.mesin.expected) + ', satu ' +
        int(state.pusat.mesin['K-satu'] - (state.pusat.before.akun['K-satu'] | 0)) + ', jurnal ' +
        int(state.pusat.verdict.buku.jurnal ? state.pusat.verdict.buku.jurnal.total : 0) + ', kunci ' +
        int(state.pusat.mesin['K-kunci'] - (state.pusat.before.akun['K-kunci'] | 0)) +
        '. The rendezvous forces the worst case on every round, runs in all four arms, and three of them lose nothing.'));
    }
    return c;
  }

  /* --------------------------------------- 7. the diff, from live functions */

  function renderSumber() {
    var c = card('The three write shapes, read back out of the running functions',
      'There is no build step in this repository, so the bodies below are byte-for-byte what ran. They are ' +
      'read at runtime with Function.prototype.toString and put on screen through textContent.');
    var S = state.src;
    if (!S) { c.appendChild(h('div', { class: 'empty', text: 'Reading the arm bodies…' })); return c; }

    ARMS.NAMES.forEach(function (nm) {
      c.appendChild(h('h4', { text: nm }));
      c.appendChild(srcbox(S.src[nm]));
    });

    c.appendChild(h('h4', { text: 'pisah against satu, line by line' }));
    c.appendChild(h('p', { class: 'note', text:
      'The two bodies differ on ' + S.diff.length + ' lines once indentation is normalised — they are ' +
      'genuinely different code, which is the point of the panel, and hiding that behind a "one-line diff" ' +
      'would be the page overstating itself. What IS one line is the account key. Three of the bodies name ' +
      'exactly ONE account key and none of the others, so no two arms can be writing the same field — one ' +
      'field cannot end at both n and W times n, which is why there is a key per arm and why the page says so ' +
      'here rather than hiding it. The journal arm names no account key at all: it writes rows instead of a ' +
      'column, and that is the entire difference the panel above is about. ' + S.keys + '.' }));
    var dl = h('div', { class: 'difflines' });
    S.render.forEach(function (row) {
      dl.appendChild(h('span', { class: 'dl ' + row.cls, text: row.text }));
    });
    c.appendChild(dl);

    c.appendChild(callout(S.timer.ok ? 'exact' : 'bad',
      'artificialDelayMs: 0, in every arm.',
      'The shipped bodies were scanned at runtime for a timer call and ' +
      (S.timer.ok ? 'none was found' : 'the following were found: ' + S.timer.hits.join(', ')) +
      '. The same claim by a route that needs no trust: '));
    c.appendChild(h('p', { class: 'small' }, h('code', { text: "grep -n 'setTimeout\\|setInterval' labs/serobot/arms.js" }),
      ' prints nothing. The rendezvous is a message count; the barrier phase deadline is a timer function passed ' +
      'in from the worker, because a file that named one could not make that grep quiet.'));
    /* The second route for "what is on screen is what ran" is a grep a stranger
       can run in three seconds. It is NOT `toString()`: the live read is
       String(credit), which is the same call spelled the shorter way, and a
       README that shipped the other grep would ship a check that prints nothing
       and looks like it passed. */
    c.appendChild(h('p', { class: 'small' },
      'And the boxes above are read live rather than transcribed: ',
      h('code', { text: "grep -n 'String(credit)' labs/serobot/arms.js" }),
      ' prints the one line that produces every one of them.'));
    return c;
  }

  /* ========================================================= ONE THREAD === */

  function renderThread(p) {
    busyNote(p);
    p.appendChild(renderUtas());
    p.appendChild(renderLangkah());
    p.appendChild(renderBatas());
    p.appendChild(renderUrut());
  }
  RENDER.thread = renderThread;

  function renderUtas() {
    var c = card('Five strategies over one plain variable, on one event loop',
      'No workers, no parallelism, nothing running beside anything else — and the same money gone. Every ' +
      'figure below is exact and every one of them is pinned by the suite. The naive strategy ends at n ' +
      'whatever W is: ten writers doing ten increments each produce ten, not one hundred.');

    if (state.utasErr) { c.appendChild(callout('bad', 'The single-thread engine did not complete.', state.utasErr)); return c; }
    if (!state.utas) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return c; }

    c.appendChild(tableOf(
      ['strategy', { label: 'W', num: true }, { label: 'n', num: true },
        { label: 'expected', num: true }, { label: 'final', num: true },
        { label: 'reads', num: true }, { label: 'writes', num: true },
        { label: 'retries', num: true }, 'what it is'],
      state.utas.map(function (row) {
        var r = row.res;
        var lost = r.expected - r.final;
        return h('tr', null,
          h('td', null, h('code', { text: r.strategy })),
          h('td', { class: 'num', text: int(r.W) }),
          h('td', { class: 'num', text: int(r.n) }),
          h('td', { class: 'num', text: int(r.expected) }),
          h('td', { class: 'num' }, h('b', { text: int(r.final) })),
          h('td', { class: 'num', text: int(r.reads) }),
          h('td', { class: 'num', text: int(r.writes) }),
          h('td', { class: 'num', text: int(r.retries) }),
          h('td', null, lost ? pill('lost ' + lost, 'bad') : pill('correct', 'ok')));
      }), { minWidth: '640px' }));

    c.appendChild(h('p', { class: 'small' }, kind('asserted'), ' ',
      'Every row above is one execution of a property the suite drives with the same numbers. ' +
      'compare-and-set retries are TRIANGULAR — W(W−1)/2 · n, not (W−1)·n; the two formulas agree only at ' +
      'W = 2, and the shipped run above is the arithmetic, not a transcription of it.'));

    c.appendChild(callout('warn', 'The retry loop refuses to be unbounded.',
      'cas() throws E_CAS_NO_CAP synchronously when it is asked for a retry loop with no cap. An unbounded ' +
      'retry loop is a livelock waiting for a slow writer, and inside an automation evaluate — which has no ' +
      'timeout of its own — it is a job that hangs to the runner\'s cap with no diagnostic. The cap is proved ' +
      'to fire by injecting a version source that always reports a conflict: deterministic, and no race.'));

    var ctl = h('div', { class: 'controls' });
    var sel = h('select', { 'data-fkey': 'thread:strat', onchange: function (e) { state.tStrat = e.target.value; renderIfVisible('thread'); } });
    UTAS.NAMES.forEach(function (nm) {
      sel.appendChild(h('option', { value: nm, selected: nm === state.tStrat ? true : null, text: nm }));
    });
    ctl.appendChild(field('strategy', sel));
    ctl.appendChild(field('writers, W · ' + state.tW, slider(state.tW, 2, 10, 'thread:W', function (e) {
      state.tW = parseInt(e.target.value, 10) || 2; renderIfVisible('thread');
    })));
    ctl.appendChild(field('increments each, n · ' + state.tN, slider(state.tN, 1, 25, 'thread:n', function (e) {
      state.tN = parseInt(e.target.value, 10) || 1; renderIfVisible('thread');
    })));
    ctl.appendChild(btn('Run ' + state.tStrat + ' at W ' + state.tW + ', n ' + state.tN,
      function () { again('utasOne'); }, 'primary', 'thread:run'));
    c.appendChild(ctl);
    if (state.busy) disableIn(c);

    if (state.utasOne) {
      var o = state.utasOne;
      if (o.err) c.appendChild(callout('bad', 'That configuration refused.', o.err));
      else {
        var a = o.audit;
        var s2 = h('div', { class: 'summary' });
        s2.appendChild(stat('final', int(o.res.final), 'expected ' + int(o.res.expected), o.res.final === o.res.expected ? 'exact' : 'short'));
        s2.appendChild(stat('reads / writes', int(o.res.reads) + ' / ' + int(o.res.writes), 'every write has a read standing behind it: ' + String(a.paired)));
        s2.appendChild(stat('retries', int(o.res.retries), 'triangular for this W and n: ' + int(o.res.triangular)));
        s2.appendChild(stat('log', int(a.entries) + ' entries', 'ordered ' + String(a.ordered) + ' · gapless ' + String(a.gapless) + ' · clock-free ' + String(a.clockFree)));
        c.appendChild(s2);
      }
    }
    return c;
  }

  function renderLangkah() {
    var c = card('The step log — two awaits are the entire bug',
      'A sequence number is issued at every await boundary. They are INTEGERS from the lab\'s own counter, ' +
      'never timestamps: a guard refuses a clock reading handed in as an ordering key, and that refusal is one ' +
      'of the negatives the suite drives.');
    if (!state.utas) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return c; }
    var kecil = null, i;
    for (i = 0; i < state.utas.length; i++) {
      if (state.utas[i].res.strategy === 'polos' && state.utas[i].res.W === 2 && state.utas[i].res.n === 1) kecil = state.utas[i];
    }
    if (!kecil) { c.appendChild(h('div', { class: 'empty', text: 'The minimal case did not run.' })); return c; }

    c.appendChild(h('p', { class: 'note' }, h('b', { text: 'The minimal case: ' }),
      'two writers, one increment each, and the answer is one. ',
      h('code', { text: UTAS.tulis(kecil.res, 12) })));

    var box = h('div', { class: 'steps' });
    kecil.res.log.forEach(function (e) {
      box.appendChild(h('div', { class: 'st' + (e.act === 'read' ? ' read' : '') },
        h('span', { class: 'seq', text: String(e.s) }),
        h('span', { class: 'who', text: 'writer ' + String.fromCharCode(65 + (e.w % 26)) }),
        h('span', { class: 'op', text: e.act + ' ' + String(e.v) })));
    });
    c.appendChild(box);

    var a = kecil.audit;
    c.appendChild(h('p', { class: 'small' }, kind('asserted'), ' ',
      'Asserted over the WHOLE log and never per entry: total order ' + String(a.ordered) +
      ' · sequence numbers unique ' + String(a.unique) + ' and gapless ' + String(a.gapless) +
      ' · every read matched to a write by the same writer ' + String(a.paired) +
      ' · the log\'s own fold equals the variable ' + String(a.foldMatchesFinal) +
      ' · nothing in it is a clock reading ' + String(a.clockFree) + '. Two hundred increments is one property, not two hundred.'));
    return c;
  }

  function renderBatas() {
    var c = card('The transaction-death boundary — measured in Chromium',
      'Inside a live readwrite transaction: read, await something, then write. What is awaited decides whether ' +
      'the write survives. The transaction reports success either way, which is the part worth staring at.');
    if (!state.batas) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return c; }
    /* The six kinds share ONE database, so the record climbs as the surviving
       ones commit. Both ends of it are printed rather than the last value alone:
       the claim is that the write moved the record by one or by nothing, and a
       single "after" column would make the third microtask row look like a
       failure and the three dead rows look like successes. */
    c.appendChild(tableOf(
      ['awaited', 'put', 'error name', 'oncomplete', 'onabort', 'tx.error',
        { label: 'record before', num: true }, { label: 'record after', num: true }, 'the write'],
      DB.WAITS.map(function (k) {
        var r = state.batas[k];
        if (!r) return null;
        var moved = r.final - r.before;
        return h('tr', null,
          h('td', null, h('code', { text: k })),
          h('td', null, r.putOk ? pill('accepted', 'ok') : pill('threw', 'bad')),
          h('td', null, (!r.name || r.name === '-') ? h('span', { class: 'small', text: '—' }) : h('code', { text: r.name })),
          h('td', { text: String(r.completed) }),
          h('td', { text: String(r.aborted) }),
          h('td', { text: String(r.txError) }),
          h('td', { class: 'num', text: int(r.before) }),
          h('td', { class: 'num', text: int(r.final) }),
          h('td', null, moved ? pill('landed, +' + moved, 'ok') : pill('gone, +0', 'bad')));
      }), { minWidth: '760px' }));
    c.appendChild(callout('measured', 'The rule, as measured here and not as a portable promise.',
      'A transaction survives any number of awaits that settle in a MICROTASK — one hundred thousand chained ' +
      'ones cost about ten milliseconds and the write lands — and dies the instant control reaches the TASK ' +
      'queue. setTimeout(0), MessageChannel and requestAnimationFrame are all task-queue boundaries and all ' +
      'three kill it. oncomplete fires anyway, onabort never fires, tx.error stays null, and the record is ' +
      'gone. The specification ties deactivation to returning control to the event loop and other engines have ' +
      'historically differed, so this page does not upgrade it to a portable rule.'));
    c.appendChild(h('p', { class: 'small' }, kind('asserted'), ' ',
      'The microtask row and the setTimeout and MessageChannel rows are pinned by the suite, by DOMException ' +
      'NAME and never by Chromium\'s message text — that message is 74 characters long and only its length was ' +
      'ever recorded.'));
    return c;
  }

  function renderUrut() {
    var c = card('Transaction ordering — only what the specification forces is asserted',
      'Two transactions opened in one turn, with integer sequence numbers taken at open, at first read and at ' +
      'completion. B.open is always 2 because both objects are constructed synchronously, so an assertion on ' +
      'it could never fail — every ordering claim here uses B\'s FIRST READ instead.');
    if (!state.urut) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return c; }
    c.appendChild(tableOf(
      ['configuration', { label: 'A open', num: true }, { label: 'B open', num: true },
        { label: 'A first read', num: true }, { label: 'B first read', num: true },
        { label: 'A done', num: true }, { label: 'B done', num: true }, 'serialised', 'kind'],
      DB.URUT.map(function (k) {
        var r = state.urut[k];
        if (!r) return null;
        return h('tr', null,
          h('td', null, h('code', { text: k })),
          h('td', { class: 'num', text: int(r.aOpen) }),
          h('td', { class: 'num', text: int(r.bOpen) }),
          h('td', { class: 'num', text: int(r.aFirst) }),
          h('td', { class: 'num', text: int(r.bFirst) }),
          h('td', { class: 'num', text: int(r.aDone) }),
          h('td', { class: 'num', text: int(r.bDone) }),
          h('td', { text: String(r.serialised) }),
          h('td', null, r.paksa ? kind('asserted') : kind('diukur')));
      }), { minWidth: '700px' }));
    c.appendChild(h('p', { class: 'small' },
      'The two rows marked ', kind('diukur'), ' — disjoint readwrite pairs, and two readonly transactions on ' +
      'one store — held on every run at every throttle rate this was measured at, and are still not asserted. ' +
      'They assert that the scheduler CHOSE to interleave; the specification permits concurrency for ' +
      'non-overlapping scope, it does not require it, and a browser is free to serialise. The two the ' +
      'specification forces are pinned.'));
    return c;
  }

  /* ======================================================= EXACTLY ONCE === */

  function renderOnce(p) {
    busyNote(p);
    var c = card('The same fabricated webhook, delivered twice, concurrently',
      'One integer amount, one idempotency key, two deliveries racing on ONE event loop — deterministic, ' +
      'nothing timing-dependent. Four services, four different ideas of what "exactly once" means. Each mode ' +
      'runs against its own freshly created database, because a mode that credits an account another mode ' +
      'already credited is measuring somebody else\'s arithmetic.');
    p.appendChild(c);

    if (state.idemErr) { c.appendChild(callout('bad', 'The idempotency modes did not complete.', state.idemErr)); return; }
    if (!state.idem) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return; }

    var I = state.idem;
    c.appendChild(tableOf(
      ['mode', 'ledger', { label: 'stored', num: true }, { label: 'ledger rows', num: true },
        { label: 'derived from rows', num: true }, 'refused', 'transactions', 'critical section'],
      IDEM.MODES.map(function (m) {
        var r = I.mode[m];
        if (!r) return null;
        return h('tr', null,
          h('td', null, h('code', { text: m })),
          h('td', null, h('code', { text: r.ledger || '—' })),
          h('td', { class: 'num' }, h('b', { text: int(r.stored) })),
          h('td', { class: 'num', text: int(r.rows) }),
          h('td', { class: 'num', text: int(r.derived) }),
          h('td', null, (r.refused && r.refused.length) ? pill(r.refused.join(', '), 'ok') : h('span', { class: 'small', text: 'nothing' })),
          h('td', { text: int(r.tx) }),
          h('td', null, h('code', { text: String(r.holdKind || '—') })));
      }), { minWidth: '720px' }));

    c.appendChild(h('p', { class: 'small' }, kind('asserted'), ' ',
      'Every figure in that table is pinned. holdKind “kunci” means the critical section was a real Web Lock ' +
      'that idem.js resolved for itself; “rantai” would mean it fell back to a promise chain, and the sentence ' +
      '"with a real lock around the write" would then be false.'));

    var per = I.mode['periksa-saja'], at = I.mode.atomik, pis = I.mode['pisah-txn'], tan = I.mode['tanpa-kunci'];
    if (per) {
      c.appendChild(callout('short', 'A check is not a constraint.',
        'periksa-saja reads the index, sees nothing, then inserts and credits — WITH a mutex around the ' +
        'write. Both deliveries read before either wrote, so it credited ' + int(per.stored) + ' and left ' +
        int(per.rows) + ' rows carrying the same key. Serialising the write did not help, because the CHECK ' +
        'was outside the critical section. Its ledger index is deliberately non-unique: with a unique one the ' +
        'second insert aborts the transaction and this mode cannot be demonstrated at all.'));
    }
    if (at) {
      c.appendChild(callout('exact', 'What actually makes an idempotency key work.',
        'atomik puts the key insert AND the effect in one transaction: ' + int(at.stored) + ' stored, ' +
        int(at.rows) + ' row, ' + int(at.derived) + ' derived, and the second delivery refused with ' +
        (at.refused.join(', ') || 'nothing') + '. Necessary and sufficient — a unique index alone is neither.'));
    }
    if (pis) {
      c.appendChild(callout('warn', 'The seam, shown rather than staged.',
        'pisah-txn writes the key in transaction A and credits in transaction B: ' + int(pis.stored) +
        ' stored, ' + int(pis.rows) + ' row, ' + int(pis.derived) + ' derived, and ' + int(pis.tx) +
        ' transactions were opened. Nothing here is wrong on this run. The failure it warns about needs the ' +
        'process to die between the two, at which point the payment is marked processed forever and no retry ' +
        'can repair it — and this lab cannot kill a process, so it prints the seam and names the consequence ' +
        'instead of faking the outcome.'));
    }
    if (tan) {
      c.appendChild(callout('measured', 'The right answer out of two live bugs cancelling.',
        'tanpa-kunci carries no key at all and is built on the pisah read-modify-write. The missing key should ' +
        'have doubled the credit to ' + int(2 * IDEM.AMOUNT) + '; the lost update ate the second one, so the ' +
        'account holds ' + int(tan.stored) + ' and the ledger holds ' + int(tan.rows) + ' rows worth ' +
        int(tan.derived) + '. The stored column and the ledger disagree, and that disagreement is the finding. ' +
        'You cannot see the idempotency bug until you have fixed the concurrency bug.'));
    }

    var c2 = card('add() against put(), because it is the fix this repository already made',
      'Two writes of the same row id into an append-only store. put() over an existing key overwrites in ' +
      'silence and returns success; add() refuses.');
    p.appendChild(c2);
    if (I.pasangan) {
      c2.appendChild(tableOf(['call', 'outcome', 'what the store held afterwards'], [
        h('tr', null, h('td', null, h('code', { text: 'add() with a key already present' })),
          h('td', null, pill(String(I.pasangan.addKedua), 'ok')),
          h('td', { text: int(I.pasangan.rowsAfterAdd) + ' row(s) — the second write never happened' })),
        h('tr', null, h('td', null, h('code', { text: 'put() with the same key' })),
          h('td', null, pill(String(I.pasangan.putKedua), 'bad')),
          h('td', { text: 'the row now reads ' + int(I.pasangan.deltaAfterPut) + ' — the first value is gone and nothing said so' }))
      ], { minWidth: '520px' }));
    }

    var c3 = card('The bounded replay window',
      'A peer record that remembers the last N idempotency keys it has seen is not a constraint either: it is ' +
      'a cache, and a key that comes back after N other operations is accepted a second time.');
    p.appendChild(c3);
    if (I.jendelaKecil && I.jendelaBesar) {
      c3.appendChild(tableOf(['window', 'operations', { label: 'applied', num: true }, { label: 'absorbed as duplicates', num: true }, 'replayed'], [
        h('tr', null, h('td', { text: 'window of ' + int(I.jendelaKecil.win) }),
          h('td', { text: int(I.jendelaKecil.ops) + ' keys, the first repeated at the end' }),
          h('td', { class: 'num', text: int(I.jendelaKecil.applied) }),
          h('td', { class: 'num', text: int(I.jendelaKecil.absorbed) }),
          h('td', null, I.jendelaKecil.replayed.length ? pill(I.jendelaKecil.replayed.join(', '), 'bad') : h('span', { text: '—' }))),
        h('tr', null, h('td', { text: 'window of ' + int(I.jendelaBesar.win) }),
          h('td', { text: int(I.jendelaBesar.ops) + ' keys, the same key twice in a row' }),
          h('td', { class: 'num', text: int(I.jendelaBesar.applied) }),
          h('td', { class: 'num', text: int(I.jendelaBesar.absorbed) }),
          h('td', null, I.jendelaBesar.replayed.length ? pill(I.jendelaBesar.replayed.join(', '), 'bad') : h('span', { text: '—' })))
      ], { minWidth: '560px' }));
      c3.appendChild(h('p', { class: 'small' },
        'This is not hypothetical: it is the shape ', h('code', { text: 'labs/saku/sync.js:47' }),
        ' ships, with a window of fifty. The Audit tab quotes it.'));
    }
  }
  RENDER.once = renderOnce;

  /* =========================================================== THE QUEUE === */

  var PERILAKU_COPY = {
    urutan: ['Two exclusive holders, one name', 'The second callback does not start until the first has returned. The order string is read off the callbacks themselves, not off a clock.'],
    tersedia: ['ifAvailable while the lock is held', 'The callback RUNS, the lock argument is null, and whatever it returns propagates. A request that "failed" still executed — code that assumes otherwise runs its critical section outside the lock.'],
    sinyal: ['An aborted AbortSignal', 'The request rejects with AbortError.'],
    waktu: ['AbortSignal.timeout', 'A different name — TimeoutError — for what looks like the same thing. Both are stable and both are pinned.'],
    modeSalah: ['mode: "nonsense"', 'The browser refuses with TypeError. The helper passes mode through unvalidated on purpose, so what you see is Chromium\'s refusal rather than this lab\'s.'],
    tersediaCuri: ['ifAvailable together with steal', 'NotSupportedError. They cannot be combined.'],
    sinyalCuri: ['signal together with steal', 'NotSupportedError as well — so a steal fixture cannot be "hardened" by giving it a deadline.'],
    curi: ['steal: true', 'It acquires the lock in exclusive mode and the existing holder is broken with AbortError. This is the two-parties-both-believe situation that fencing tokens exist for, constructed on purpose.'],
    berbagi: ['shared, shared, exclusive, shared', 'Strict FIFO. The trailing shared request does NOT join the two shared holders ahead of the queued exclusive one.'],
    bentuk: ['The shape of query()', 'Two arrays, held and pending, and every entry carries clientId, mode and name. Paste await navigator.locks.query() into a console mid-hold and you get the same thing back.'],
    klien: ['clientId is per CLIENT, not per request', 'Two pending requests from ONE document report ONE distinct clientId, and it is the same one as the holder. An on-screen queue cannot be labelled by requester inside a single document, which is why every queued participant here is its own worker.'],
    sarangBerbatas: ['A same-name request from inside the holder', 'The inner request never gets the lock — the outer one still has it — and it is the AbortSignal, not the browser, that ends the wait. Web Locks has no deadlock detector.'],
    buntu: ['The same nesting with no deadline at all', 'Nothing settles. held 1, pending 1, zero errors, zero console output, forever.']
  };

  function renderQueue(p) {
    busyNote(p);

    var c = card('navigator.locks, thirteen behaviours, and the browser\'s own queue',
      'kunci.js is the only file in this lab that asks navigator.locks for one — one grep proves it — and it ' +
      'refuses synchronously any request that carries neither an AbortSignal nor ifAvailable nor steal. That ' +
      'refusal is the structural reason a lock in this lab cannot hang the page.');
    p.appendChild(c);
    /* The sentence above deliberately does not spell the call itself. The grep
       beside it is over EVERY file in the directory, and a page that named the
       method in its own prose would make that grep print this file too — the
       same trap the worker avoids with the error-logging call it promises never
       to make. The command string below carries a backslash before the dot, so
       it does not match itself either. */
    c.appendChild(h('p', { class: 'note' }, h('code', { text: "grep -ln 'locks\\.request' labs/serobot/*.js" }),
      ' prints one file. Every request here carries a deadline of ' + int(KUNCI.BUDGET) + ' ms.'));

    if (state.kunciErr) { c.appendChild(callout('bad', 'The lock fixtures did not complete.', state.kunciErr)); }
    if (!state.kunci) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return; }

    var K = state.kunci;
    c.appendChild(tableOf(['behaviour', 'what came back', 'what it means'],
      KUNCI.PERILAKU.map(function (nm) {
        var r = K.p[nm];
        var copy = PERILAKU_COPY[nm] || [nm, ''];
        var saw;
        if (!r) saw = h('span', { class: 'small', text: nm === 'buntu' ? 'not run — it costs three seconds to watch nothing happen' : 'not run' });
        else if (r.gagal) saw = pill(String(r.gagal), 'bad');
        else saw = h('code', { text: describeBehaviour(nm, r) });
        return h('tr', null,
          h('td', null, h('b', { text: copy[0] }), h('div', { class: 'small', text: nm })),
          h('td', null, saw),
          h('td', { class: 'small', text: copy[1] }));
      }), { minWidth: '680px', prose: true }));

    c.appendChild(h('p', { class: 'small' }, kind('asserted'), ' ',
      'Twelve of the thirteen are pinned by the suite — by DOMException NAME and never by message text — and ' +
      'the assertions are scoped to THIS LAB\'S reaction to a probe, never to the browser\'s own correctness. ' +
      'Nothing here asserts that Web Locks works; that is Chromium\'s test, not this repository\'s.'));

    /* THE UNBOUNDED SELF-DEADLOCK. A button rather than a boot step, because it
       is three seconds of watching nothing happen and it must not be on the path
       to a first paint. */
    var c4 = card('The unbounded version, on request',
      'The same nesting with no signal and no deadline. It is bounded here only by this fixture\'s own abort ' +
      'afterwards, which is a separate field and is not the result — the demonstration is what happens in the ' +
      'window, and what happens is nothing at all.');
    p.appendChild(c4);
    var cb = h('div', { class: 'controls' });
    cb.appendChild(btn('Watch nothing happen for 3 seconds', function () { again('buntu'); }, '', 'queue:buntu'));
    c4.appendChild(cb);
    if (state.busy) disableIn(c4);
    if (K.buntu) {
      c4.appendChild(tableOf(['field', 'value', 'what it says'], [
        h('tr', null, h('td', { text: 'settled' }), h('td', null, h('code', { text: String(K.buntu.settled) })), h('td', { class: 'small', text: 'the nested request never settled inside the window' })),
        h('tr', null, h('td', { text: 'held / pending' }), h('td', null, h('code', { text: int(K.buntu.held) + ' / ' + int(K.buntu.pending) })), h('td', { class: 'small', text: 'the browser\'s own queue, read through query()' })),
        h('tr', null, h('td', { text: 'window' }), h('td', null, h('code', { text: int(K.buntu.window) + ' ms' })), h('td', { class: 'small', text: 'zero errors and zero console output for the whole of it' })),
        h('tr', null, h('td', { text: 'bersih — the cleanup' }), h('td', null, h('code', { text: String(K.buntu.bersih) })), h('td', { class: 'small', text: 'this fixture aborting its own request afterwards. NOT the result: it is how the page tidies up' }))
      ], { minWidth: '520px', prose: true }));
      c4.appendChild(h('p', { class: 'small' }, kind('none'), ' ',
        'Nothing above is asserted. Web Locks has no deadlock detector and no default timeout; that is the ' +
        'counterweight paragraph to "just use a lock".'));
    }

    /* THE LIVE QUEUE. Route A is this lab's own register of what it asked for;
       route B is navigator.locks.query(), which is the browser's queue and needs
       no cooperation from any code here. A visitor can paste the same call into
       a console while a hold is open and get the same two arrays. */
    var c2 = card('The browser\'s queue, live',
      'One dedicated worker takes the lock; two requests from this page queue behind it; then query() is read. ' +
      'The holder is a worker because clientId is per-client — two pending requests from this document are ' +
      'indistinguishable in the answer, and the page says so rather than inventing a label.');
    p.appendChild(c2);
    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(btn('Take the lock and read the queue again', function () { again('antrean'); }, 'primary', 'queue:again'));
    c2.appendChild(ctl);
    if (state.busy) disableIn(c2);

    var A = state.antrean;
    if (!A) { c2.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); }
    else if (A.err) { c2.appendChild(callout('bad', 'The queue snapshot did not complete.', A.err)); }
    else {
      c2.appendChild(h('p', { class: 'note' }, h('b', { text: 'lock name: ' }), h('code', { text: A.name }),
        ' — prefixed per run, so two runs on one machine cannot serialise against each other by accident.'));
      var q = h('div');
      A.snap.held.forEach(function (e) {
        q.appendChild(h('div', { class: 'qrow held' },
          h('span', { class: 'mk', text: 'held' }),
          h('span', { class: 'nm', text: e.name }),
          h('span', { text: e.mode }),
          h('span', { class: 'small', text: 'client ' + shortId(e.clientId) })));
      });
      A.snap.pending.forEach(function (e) {
        q.appendChild(h('div', { class: 'qrow pending' },
          h('span', { class: 'mk', text: 'queued' }),
          h('span', { class: 'nm', text: e.name }),
          h('span', { text: e.mode }),
          h('span', { class: 'small', text: 'client ' + shortId(e.clientId) })));
      });
      if (!A.snap.held.length && !A.snap.pending.length) q.appendChild(h('div', { class: 'empty', text: 'The queue was empty at the moment it was read.' }));
      c2.appendChild(q);
      c2.appendChild(h('div', { class: 'wit' },
        h('span', { text: 'figure' }),
        h('span', { class: 'a', text: 'route A · this page\'s register' }),
        h('span', { class: 'b', text: 'route B · query()' }),
        h('span', { class: 'd', text: 'difference' })));
      c2.appendChild(h('div', { class: 'wit' },
        h('span', { text: 'holders of ' + A.bare }),
        h('span', { class: 'a', text: int(A.mine) }),
        h('span', { class: 'b', text: int(A.hitung.held) }),
        h('span', { class: 'd', text: int(A.mine - A.hitung.held) })));
      c2.appendChild(h('p', { class: 'small' },
        'Route A is this page\'s own register of what it asked for; route B is ',
        h('code', { text: 'navigator.locks.query()' }), ', the browser\'s queue. ',
        'Distinct clientIds in the answer: ' + int(A.distinct) + ' across ' +
        int(A.snap.held.length + A.snap.pending.length) + ' entries. ', kind('measured')));
      if (A.pekerja) {
        c2.appendChild(callout('measured', 'terminate() releases a worker\'s lock, and the deadline is printed rather than asserted.',
          'A worker took the lock, query() saw ' + int(A.pekerja.hidup) + ' holder, the worker was terminated, ' +
          'and a bounded poll found ' + int(A.pekerja.mati) + ' holders after ' + int(A.pekerja.tries) +
          ' poll(s) inside a ' + int(A.pekerja.budget) + ' ms budget. There is no specified synchronisation ' +
          'point between terminate() returning and the lock being released, so asserting the first poll would ' +
          'be asserting how fast this machine got round to it.'));
      }
    }

    /* THE LEASE COMPARISON. Two columns, not a takedown. */
    var c3 = card('A Web Lock against a nine-second TTL lease',
      'The lease is the shape labs/gudang/ ships. Neither mechanism dominates the other, and the page says so ' +
      'rather than picking a winner.');
    p.appendChild(c3);
    c3.appendChild(tableOf(['situation', 'Web Lock', '9-second TTL lease'], [
      h('tr', null, h('td', { text: 'the agent dies' }), h('td', null, pill('released by the browser', 'ok')), h('td', null, pill('lapses after the TTL', 'warn'))),
      h('tr', null, h('td', { text: 'the agent is frozen but alive' }), h('td', null, pill('held indefinitely, no timeout', 'bad')), h('td', null, pill('lapses, and the holder resumes believing it still holds', 'bad'))),
      h('tr', null, h('td', { text: 'the tab reloads' }), h('td', null, pill('released', 'ok')), h('td', null, pill('lapses', 'warn'))),
      h('tr', null, h('td', { text: 'a fencing token is needed' }), h('td', { class: 'small', text: 'not for the lock itself — but steal:true constructs the same two-parties-believe situation' }), h('td', { class: 'small', text: 'yes, and gudang has none' }))
    ], { minWidth: '600px', prose: true }));
    /* PROVENANCE, because this table is the one place on the page where a row
       can look like a measurement and not be one. Two of its four rows were
       demonstrated here; the other two are read off the two specifications, and
       a page that promises every figure came from this run has to say which is
       which rather than let four pills imply the same standing. */
    c3.appendChild(h('p', { class: 'small' },
      'Two of those rows were demonstrated on this page and two were not. A worker holding a lock, ' +
      'terminated, and the lock gone from the browser\'s own queue is on the tab above; a holder kept ' +
      'alive with no timeout of any kind is the three-second observation on this one; and the stale ' +
      'fencing token is refused in the fixture below. Nothing here reloads a tab or kills an agent — ' +
      'this lab cannot kill a process at all — and the lease\'s TTL lapses against an integer handed to ' +
      'the fixture, never against a wall clock. Those two rows are what the two specifications say, not ' +
      'what this run saw. ', kind('none')));
    if (state.audit && state.audit.sewa) {
      var S = state.audit.sewa;
      c3.appendChild(callout('exact', 'The fencing token, refused when it is stale.',
        'The first taker got the lease (' + String(S.pertama.why) + '); the second was refused (' +
        String(S.kedua.why) + '); and a token from before the lease moved was rejected with ' +
        String(S.basi) + '. Nothing in that fixture reads a clock — "now" arrives as an integer and a ' +
        'timestamp handed in where an ordering key belongs is refused outright.'));
    }
  }
  RENDER.queue = renderQueue;

  function shortId(id) {
    var s = String(id || '');
    return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(s.length - 4) : s;
  }

  /* Every behaviour returns a different shape, and this file prints what the
     fixture reported rather than deciding what it meant. */
  function describeBehaviour(nm, r) {
    if (r.order !== undefined) return r.order;
    if (r.name !== undefined && r.name !== '') return r.name + (r.sync === false ? ' (a rejection, not a synchronous throw)' : '');
    if (nm === 'tersedia') return 'callback ran, lock === ' + String(r.lockNull ? 'null' : 'a Lock') + ', returned "' + String(r.value) + '"';
    if (nm === 'curi') return 'stole in mode ' + String(r.mode) + ', holder broken with ' + String(r.holder);
    if (nm === 'bentuk') return '{' + (r.top || []).join(', ') + '} · entry {' + (r.entry || []).join(', ') + '} · held ' + int(r.held);
    if (nm === 'klien') return int(r.pending) + ' pending, ' + int(r.distinct) + ' distinct clientId, same as the holder: ' + String(r.sameAsHeld);
    if (nm === 'sarangBerbatas') return 'inner ' + String(r.inner) + ', outer completed: ' + String(r.outer);
    return JSON.stringify(r);
  }

  /* ============================================================= AUDIT === */

  function renderAudit(p) {
    busyNote(p);
    var c = card('Two write shapes this repository already ships, transcribed and measured',
      'Not imported and not linked against — transcribed, quoted with a file and a line, and run through the ' +
      'same rendezvous as the centrepiece. One of them turns out to be correct and has never been measured; ' +
      'the other has a shape this lab loses money with.');
    p.appendChild(c);

    if (state.auditErr) { c.appendChild(callout('bad', 'The audit fixtures did not complete.', state.auditErr)); return; }
    if (!state.audit) { c.appendChild(h('div', { class: 'empty', text: 'Building: ' + state.step })); return; }
    var A = state.audit;

    c.appendChild(h('h4', { text: KUNCI.KUTIPAN.gudang.file + ':' + KUNCI.KUTIPAN.gudang.line }));
    c.appendChild(h('blockquote', { class: 'callout exact' }, h('p', { text: '“' + KUNCI.KUTIPAN.gudang.text + '”' })));
    c.appendChild(h('p', { class: 'note', text:
      'A prose claim in a comment, load-bearing, never measured. It is correct. Under the rendezvous, with ' +
      'every contender released at the same instant, exactly one of them takes the lease:' }));
    c.appendChild(tableOf([{ label: 'contenders, W', num: true }, { label: 'winners', num: true }, 'holder', { label: 'fencing token', num: true }, 'verdict'], [
      auditRow(A.gudang2), auditRow(A.gudang4)
    ], { minWidth: '520px' }));
    c.appendChild(h('p', { class: 'small' }, kind('asserted'), ' ',
      'One holder across every contender, at both writer counts. The read, the decision and the write are in ' +
      'ONE readwrite transaction, and IndexedDB will not start a second overlapping readwrite transaction ' +
      'until it finishes — that is the property, and it is the specification\'s, not this lab\'s.'));
    c.appendChild(h('h5', { text: 'the shape, read back out of the running function' }));
    c.appendChild(srcbox(A.srcGudang));

    c.appendChild(h('h4', { text: KUNCI.KUTIPAN.saku.file + ':' + KUNCI.KUTIPAN.saku.line }));
    c.appendChild(h('blockquote', { class: 'callout short' }, h('p', { text: '“' + KUNCI.KUTIPAN.saku.text + '”' })));
    c.appendChild(h('p', { class: 'note', text:
      'A read in a readonly transaction, a decision, and a write in a LATER readwrite transaction — character ' +
      'for character the shape the centrepiece loses updates with. Under the rendezvous the duplicates are ' +
      'not absorbed:' }));
    c.appendChild(tableOf([{ label: 'contenders, W', num: true }, { label: 'applied', num: true }, { label: 'absorbed as duplicates', num: true }, { label: 'intended', num: true }, 'verdict'], [
      sakuRow(A.saku2), sakuRow(A.saku4)
    ], { minWidth: '520px' }));
    c.appendChild(h('h5', { text: 'the shape, read back out of the running function' }));
    c.appendChild(srcbox(A.srcSaku));

    c.appendChild(callout('warn', 'Stated at the right size, and this is the whole of the claim.',
      'drain() applies operations through a strictly sequential reduce, so within one drain these calls never ' +
      'overlap. Two overlapping drains would reach it. This lab reproduces the SHAPE and shows what it costs; ' +
      'it does not claim labs/saku/ loses data today, and no live path that does was found. labs/saku/ is a ' +
      'demo lab whose "peer" is local IndexedDB and never a network, and it is absent from the automated ' +
      'runner — so this is a reading of the source, not a test result. Both findings are recorded in that ' +
      'lab\'s own README, in the same commit; a finding announced and not filed is worse than one not made.'));
  }
  RENDER.audit = renderAudit;

  function auditRow(r) {
    if (!r) return null;
    return h('tr', null,
      h('td', { class: 'num', text: int(r.W) }),
      h('td', { class: 'num' }, h('b', { text: int(r.winners) })),
      h('td', null, h('code', { text: String(r.holder || '—') })),
      h('td', { class: 'num', text: int(r.token) }),
      h('td', null, r.ok ? pill('exactly one holder', 'ok') : pill('not one holder', 'bad')));
  }

  function sakuRow(r) {
    if (!r) return null;
    return h('tr', null,
      h('td', { class: 'num', text: int(r.W) }),
      h('td', { class: 'num' }, h('b', { text: int(r.applied) })),
      h('td', { class: 'num', text: int(r.absorbed) }),
      h('td', { class: 'num', text: int(r.intended) }),
      h('td', null, r.applied === r.intended ? pill('absorbed', 'ok') : pill('applied ' + int(r.applied) + ' times', 'bad')));
  }

  /* ============================================================ LIMITS === */

  function renderLimits(p) {
    var c = card('What this browser will not do',
      'Read from the runtime as this tab rendered, and printed again here beside what it costs. None of it is ' +
      'asserted: a machine description is an observation, and pinning one is how a suite goes red on somebody ' +
      'else\'s laptop. The one figure derived from it that IS asserted is the clamp.');
    p.appendChild(c);
    var m = state.mesin;
    if (!m) { c.appendChild(h('div', { class: 'empty', text: 'The capability probe did not run.' })); return; }

    var sum = h('div', { class: 'summary' });
    sum.appendChild(stat('crossOriginIsolated', String(m.crossOriginIsolated), 'and it can never be true on a static host', 'measured'));
    sum.appendChild(stat('SharedArrayBuffer', String(m.sharedArrayBuffer), 'so: no spinlock, no futex, no seqlock, no ring buffer', 'measured'));
    sum.appendChild(stat('hardwareConcurrency', int(m.hardwareConcurrency), 'raw, printed, asserted nowhere', 'measured'));
    sum.appendChild(stat('clamped writer count', int(m.clampW), 'max(2, min(8, hardwareConcurrency)) — this one IS asserted', 'exact'));
    sum.appendChild(stat('deviceMemory', String(m.deviceMemory), 'as reported', 'measured'));
    sum.appendChild(stat('visibilityState', String(m.visibilityState), 'a hidden tab is throttled and produces different numbers', 'measured'));
    sum.appendChild(stat('isSecureContext', String(m.isSecureContext), 'navigator.locks needs one', 'measured'));
    sum.appendChild(stat('navigator.locks', String(m.locks), 'feature-detected before the first call', 'measured'));
    c.appendChild(sum);
    c.appendChild(h('p', { class: 'mesin-ua', text: m.ua }));

    c.appendChild(callout('measured', 'Why the clamp is asserted and the raw value is not.',
      'hardwareConcurrency legitimately returns 1 or 2 inside a constrained container. At W = 1 the whole ' +
      'thesis degenerates into a tautology that passes: the unsafe arm and the safe arm both end at n, nothing ' +
      'is lost, and the audit\'s "one winner out of W" becomes one out of one. Clamping the rendezvous to at ' +
      'least two writers is what stops that, and the clamp is the assertion. Free mode uses the raw value and ' +
      'asserts nothing at all.'));

    /* The count in this sentence is the probe's, not a remembered one. The
       revision this replaced said "six of eight" directly above a table with
       nine rows in it — the card disagreed with itself, and nothing could see
       it because the number was a literal on both sides of its own assertion. */
    var a = state.atomik;
    var c2 = card('Atomics is not inert, and a reader with a console will check',
      a
        ? ('On a plain Int32Array over a non-shared ArrayBuffer, ' + int(a.bekerja) + ' of the ' +
           int(a.diprobe) + ' members probed below returned a value, out of the ' + int(a.anggota) +
           ' function members this Atomics carries. Every call is wrapped, so a member that began ' +
           'refusing would show up in its own row as a refusal rather than taking this line down.')
        : 'On a plain Int32Array over a non-shared ArrayBuffer, most members return a value.');
    p.appendChild(c2);
    if (a) {
      c2.appendChild(tableOf(['member', 'what it returned here'], [
        atomRow('Atomics.add', a.add), atomRow('Atomics.load', a.load),
        atomRow('Atomics.compareExchange', a.compareExchange), atomRow('Atomics.store', a.store),
        atomRow('Atomics.exchange', a.exchange), atomRow('Atomics.notify', a.notify),
        atomRow('Atomics.isLockFree(4)', a.isLockFree), atomRow('Atomics.wait', a.wait),
        atomRow('Atomics.waitAsync', a.waitAsync)
      ], { minWidth: '420px' }));
      c2.appendChild(h('p', { class: 'small' },
        'Only wait and waitAsync refuse, and Atomics.notify returns 0 rather than throwing. What Atomics gives ' +
        'you here is a genuine compare-and-swap over memory no other thread can reach, which is x++ with ' +
        'ceremony. ', kind('measured')));
    }

    var c3 = card('The main thread, measured with requestAnimationFrame',
      'A lab that spawns workers has no excuse for freezing the tab, and a setInterval gap detector cannot see ' +
      'a freeze at all — the callback cannot fire during the block and clearing the timer in the same turn ' +
      'discards the late tick. This monitor is rAF-based and forces a microtask yield before reading the clock, ' +
      'so what it reports is when the page actually got back to work.');
    p.appendChild(c3);
    var r = state.raf;
    if (!r) { c3.appendChild(h('div', { class: 'empty', text: 'Still measuring: ' + state.step })); }
    else {
      var s3 = h('div', { class: 'summary' });
      s3.appendChild(stat('longest gap', int(r.max) + ' ms', 'across the whole boot, the suite and every demonstration on this page', 'measured'));
      s3.appendChild(stat('p95 gap', int(r.p95) + ' ms', 'ninety-fifth percentile', 'measured'));
      s3.appendChild(stat('median gap', int(r.median) + ' ms', 'the ordinary frame', 'measured'));
      s3.appendChild(stat('gaps over 100 ms', int(r.over100), 'frames a human would notice', 'measured'));
      s3.appendChild(stat('frames observed', int(r.frames), 'animation callbacks that ran', 'measured'));
      c3.appendChild(s3);
      c3.appendChild(h('p', { class: 'small' }, kind('none'), ' ',
        'Not asserted, and deliberately: a threshold is a timing pin, and this repository has a standing rule ' +
        'against those. What IS asserted is structural — every engine file is DOM-free, the write loops execute ' +
        'in a worker and not on this page, and this file is the only one that touches the DOM. The figure is ' +
        'published in the README as a range with the machine named.'));
    }

    var c4 = card('This page ships no tests.worker.js, and that is measured rather than assumed',
      'Its heavy work is I/O-bound by construction — it awaits messages and IndexedDB transactions — so moving ' +
      'it off the main thread would move nothing. The build gate was: if the longest gap during a full run had ' +
      'exceeded 100 ms, the suite moved into a worker before shipping.');
    p.appendChild(c4);
    if (state.tests) {
      c4.appendChild(h('p', { class: 'note', text:
        'And the single-flight latch is the responsiveness win: the badge run and the automated run are ONE ' +
        'run, so this page does half the work its noisiest sibling does while being the one whose subject is ' +
        'workers. The suite above took ' + int(Math.round(state.testsMs)) + ' ms, timed from outside it — the ' +
        'suite itself is forbidden from reading a clock and reports ms as 0.' }));
    }
  }
  RENDER.limits = renderLimits;

  function atomRow(name, v) {
    var threw = String(v) === 'TypeError';
    return h('tr', null, h('td', null, h('code', { text: name })),
      h('td', null, threw ? pill('threw TypeError', 'warn') : pill(String(v), 'ok')));
  }

  /* ============================================================= TESTS === */

  function caseRow(x) {
    return h('div', { class: 'tcase ' + (x.ok ? 'ok' : 'no') },
      h('span', { class: 'mk', text: x.ok ? '✓' : '✗' }),
      h('span', { class: 'nm', text: x.name }),
      x.ok ? null : h('span', { class: 'msg', text: x.message }));
  }

  function renderTests(p) {
    var c = card('The assertion suite, as it ran in this tab',
      'The same file the automated runner drives, against a database this run created and destroyed. It runs ' +
      'ONCE per page load by contract: the latch inside it hands every caller the identical promise, so the ' +
      'badge above and the automated run are one run and not two.');
    p.appendChild(c);

    if (state.testsErr) { c.appendChild(callout('bad', 'The suite could not run.', state.testsErr)); return; }
    if (!state.tests) { c.appendChild(h('div', { class: 'empty', text: state.testsBusy ? 'The suite is running…' : 'Waiting for the suite…' })); return; }
    var r = state.tests;

    var head = h('div', { class: 'test-summary' });
    head.appendChild(h('span', { class: 'pillbig ' + (r.failed ? 'fail' : 'pass'), text: r.failed ? r.failed + ' FAILED' : 'all passed' }));
    head.appendChild(h('span', { class: 'mono', text: r.passed + ' / ' + r.total }));
    head.appendChild(pill(r.properties + ' properties', 'info'));
    head.appendChild(pill(r.negatives + ' of them negative', 'info'));
    head.appendChild(pill(r.executions + ' executions', 'info'));
    head.appendChild(pill(r.groups + ' groups', 'info'));
    head.appendChild(pill(r.noise ? r.noise + ' network attempts' : 'no network attempt', r.noise ? 'bad' : 'ok'));
    c.appendChild(head);
    var ctl = h('div', { class: 'controls' });
    /* There is no "run again" here and there cannot be one. run() holds a
       single-flight latch and hands every caller the identical promise for the
       life of the page — measured with four callers — so a control that claimed
       to re-run the suite would be lying about which run the numbers came from.
       This one re-renders the result that exists. */
    ctl.appendChild(btn('Re-render this result', function () { renderIfVisible('tests'); }, 'small', 'tests:again'));
    /* And this one is a responsiveness decision, not a tidiness one. Every
       execution as its own row is 2,028 nodes, and building them cost 385 ms of
       blocked main thread at 8x CPU throttle — a jank a human notices on a slow
       phone. Folded, the same panel is a claim per line with its execution count
       beside it, and the rows that FAILED are always shown whichever way this
       sits. */
    ctl.appendChild(btn(state.testsAll ? 'Fold the executions away' : 'Show all ' + r.executions + ' executions',
      function () { state.testsAll = !state.testsAll; renderIfVisible('tests'); }, 'small ghost', 'tests:all'));
    c.appendChild(ctl);

    c.appendChild(h('p', { class: 'note', text:
      'Properties and executions are two different numbers and adding them together is the one thing this ' +
      'lab\'s assertion plan forbids by name. A property run once per arm and once per writer count is one ' +
      'claim executed several times. The badge in the header shows properties; the labs index shows ' +
      'executions. ' + Math.round(1000 * r.negatives / (r.properties || 1)) / 10 + '% of the properties pass ' +
      'only when something refuses.' }));

    c.appendChild(h('p', { class: 'small', text:
      'Timed from outside: ' + int(Math.round(state.testsMs)) + ' ms. The suite reports ms as ' + int(r.ms) +
      ' because it is forbidden from reading a clock at all — a suite that times itself has a wall-clock ' +
      'reading in its result, and the first thing anybody does with one is assert it.' }));

    if (r.noise) {
      c.appendChild(callout('bad', 'Something on this page attempted egress.',
        'noise is the guard\'s own total as the suite found it — the page realm plus every worker\'s ' +
        'self-reported count. Nothing here is supposed to move it off zero, so a positive value is a defect ' +
        'and is rendered as a failure rather than as a statistic.'));
    }

    /* Properties are nested under their claims by WALKING results in order:
       props[i] owns results[from .. from + executions - 1]. Grouping by name
       instead would silently merge properties that share a short execution
       name, and several deliberately do. */
    var props = (T && T.props) || [];
    (r.byGroup || []).forEach(function (g) {
      var box = h('div', { class: 'tgroup' });
      box.appendChild(h('h4', { text: g.group + '   ' + g.passed + '/' + g.executions }));
      box.appendChild(h('p', { class: 'hint', text: g.properties + ' properties, ' + g.negatives +
        ' of them negative, ' + g.executions + ' executions' + (g.failed ? ', ' + g.failed + ' FAILED' : '') }));
      var mine = props.filter(function (x) { return x.group === g.group; });
      if (!mine.length) {
        r.results.forEach(function (x) { if (x.group === g.group && (state.testsAll || !x.ok)) box.appendChild(caseRow(x)); });
      } else {
        mine.forEach(function (pr) {
          var own = r.results.slice(pr.from, pr.from + pr.executions);
          var bad = own.filter(function (x) { return !x.ok; }).length;
          box.appendChild(h('p', { class: 'small' },
            h('span', { class: 'mk', text: bad ? '✗ ' : '✓ ' }),
            pr.negative ? pill('refusal', 'warn') : null, ' ', pr.name,
            h('span', { class: 'hint', text: '  ' + pr.executions + (pr.executions === 1 ? ' execution' : ' executions') })));
          own.forEach(function (x) { if (state.testsAll || !x.ok) box.appendChild(caseRow(x)); });
        });
      }
      p.appendChild(box);
    });
  }
  RENDER.tests = renderTests;

  /* ========================================================== THE WORK === */

  function disableIn(el) {
    var n = el.querySelectorAll('input, button, select'), i;
    for (i = 0; i < n.length; i++) n[i].disabled = true;
  }

  function tmr(cb, ms) { return root.setTimeout(cb, ms); }
  function untmr(id) { return root.clearTimeout(id); }

  function delay(ms) { return new Promise(function (res) { root.setTimeout(function () { res(null); }, ms); }); }

  /* A yielded frame between every unit of work. Nothing on this page is
     compute-bound, but the boot chain is long, and a chain that never returns to
     the event loop paints nothing between its first card and its last. */
  function breathe() {
    return new Promise(function (res) {
      if (root.requestAnimationFrame) root.requestAnimationFrame(function () { root.setTimeout(function () { res(null); }, 0); });
      else root.setTimeout(function () { res(null); }, 0);
    });
  }

  function newName(tag) {
    state.seq = state.seq + 1;
    return DB.nameFor(state.runId + '-' + tag + state.seq);
  }

  function bikinDb(nama) {
    return DB.fresh(nama).then(function (db) {
      return DB.seed(db).then(function () { return db; });
    });
  }

  /* Every exit path closes before deleting. deleteDatabase behind an open
     connection does not fail — onblocked fires and onsuccess never does — so a
     forgotten close is not an error, it is a page that never finishes. */
  function tutupHapus(db, nama) {
    try { db.close(); } catch (e) { /* already closed */ }
    return DB.drop(nama, KODE.ANGKA.deleteBudget)['catch'](function () { return null; });
  }

  function reason(e) {
    var nm = KODE.nameOf(e);
    var code = KODE.codeOf(e);
    if (nm && code && nm !== code) return nm + ' (' + code + ')';
    return nm || code || String(e);
  }

  /* One flag, on <body>, so that whatever is driving this page from outside —
     an automated run, a screenshot pass, a human with a keyboard — can tell the
     difference between "still working" and "finished with nothing to show".
     Without it the only signal is the absence of a spinner, and an absence is
     not a signal. */
  function flag(v) {
    try { document.body.setAttribute('data-serobot-idle', v); } catch (e) { /* body gone */ }
  }

  function step(what) {
    state.step = what;
    state.busy = what;
    flag('0');
    renderIfVisible(state.view);
  }

  function idle() {
    state.busy = '';
    state.step = 'ready';
    flag('1');
    renderIfVisible(state.view);
  }

  /* ---------------------------------------------------------- the demos */

  /* ROUTE A. Every figure here came off db.js reading the stores back, and not
     one of them came out of the workers' summary message. Route B is built by
     saksi.js from an injected reader and never sees this object. */
  function routeA(db, before, res) {
    var m = { expected: res.W * res.n };
    return DB.rowsVia(db, 'jurnal', 'objectStore', null).then(function (env) {
      var deltas = [], i;
      for (i = 0; i < env.rows.length; i++) deltas.push(env.rows[i].delta);
      m['jurnal.rows'] = env.count;
      m['jurnal.total'] = KODE.jumlah(deltas, 'the engine\'s own fold over the ledger');
      return DB.read(db, 'akun', 'K-pisah');
    }).then(function (v) {
      m['K-pisah'] = v === null ? 0 : v;
      m['delta.K-pisah'] = m['K-pisah'] - (before.akun['K-pisah'] | 0);
      m['kurang.K-pisah'] = m.expected - m['delta.K-pisah'];
      return DB.read(db, 'akun', 'K-satu');
    }).then(function (v) {
      m['K-satu'] = v === null ? 0 : v;
      m['delta.K-satu'] = m['K-satu'] - (before.akun['K-satu'] | 0);
      return DB.read(db, 'akun', 'K-kunci');
    }).then(function (v) {
      m['K-kunci'] = v === null ? 0 : v;
      m['delta.K-kunci'] = m['K-kunci'] - (before.akun['K-kunci'] | 0);
      return m;
    });
  }

  function demoPusat() {
    var nama = newName('c');
    var db = null, before = null, res = null, t0 = now();
    state.pusatErr = '';
    step('the rendezvous, W ' + state.W + ' and n ' + state.n);
    return bikinDb(nama).then(function (d) {
      db = d;
      return DB.snapshot(db);
    }).then(function (s) {
      before = s;
      return PANTAU.regu({
        url: WORKER_URL, W: state.W, n: state.n, arms: ARMS.NAMES,
        mode: 'hadang', db: nama, lockPrefix: state.prefix, runId: state.runId,
        budget: 30000, timer: tmr, untimer: untmr
      });
    }).then(function (r) {
      res = r;
      /* ROUTE B. An injected reader, the snapshot as a VALUE, and W and n as
         two separate integers this file does not multiply. */
      return SAKSI.fold(DB.reader(db), before, r.W, r.n, ['led_n', 'led_u']);
    }).then(function (v) {
      return routeA(db, before, res).then(function (m) {
        state.pusat = {
          res: res, verdict: v, mesin: m, before: before,
          banding: SAKSI.banding(m, v), ms: now() - t0
        };
        return null;
      });
    })['catch'](function (e) {
      state.pusatErr = reason(e);
      return null;
    }).then(function () {
      return db ? tutupHapus(db, nama) : null;
    });
  }

  function demoBebas(count) {
    var left = count, chain = Promise.resolve(null);
    state.bebas.err = '';
    function one(idx) {
      var nama = newName('f');
      var db = null, before = null, res = null;
      step('a free-running batch, sample ' + idx + ' of ' + count);
      return bikinDb(nama).then(function (d) {
        db = d;
        return DB.snapshot(db);
      }).then(function (s) {
        before = s;
        return PANTAU.regu({
          url: WORKER_URL, W: state.freeW, n: state.freeN, arms: ['pisah', 'satu', 'jurnal'],
          mode: 'lepas', db: nama, lockPrefix: state.prefix, runId: state.runId,
          budget: 30000, timer: tmr, untimer: untmr
        });
      }).then(function (r) {
        /* seal() is the only constructor of a free-mode container and it is
           applied by the ENGINE, never by this file's own hand on a literal.
           Everything downstream of this line is refused as an assertion operand
           by every helper in tests.js, so a future contributor who moves one of
           these samples into a property gets a red run on the first attempt
           rather than a flake on somebody else's laptop. */
        res = ARMS.seal('lepas', r);
        return SAKSI.fold(DB.reader(db), before, res.W, res.n, ['led_n', 'led_u']);
      }).then(function (v) {
        state.bebas.samples.push(KODE.seal('lepas', {
          W: res.W, n: res.n, expected: res.W * res.n,
          pisah: v.delta['K-pisah'],
          satu: v.delta['K-satu'],
          jurnal: v.buku.jurnal ? v.buku.jurnal.total : 0,
          rows: v.buku.jurnal ? v.buku.jurnal.deltaRows : 0
        }));
        return null;
      })['catch'](function (e) {
        state.bebas.err = reason(e);
        return null;
      }).then(function () {
        return db ? tutupHapus(db, nama) : null;
      });
    }
    for (var i = 1; i <= left; i++) {
      (function (idx) { chain = chain.then(function () { return one(idx); }); })(i);
    }
    return chain.then(function () {
      state.bebas.batches = state.bebas.batches + 1;
      renderIfVisible('ledgers');
      return null;
    });
  }

  function demoUtas() {
    var rows = [], chain = Promise.resolve(null);
    state.utasErr = '';
    step('five strategies on one event loop');
    UTAS.RENCANA.forEach(function (plan) {
      chain = chain.then(function () {
        return UTAS.run(plan.strategy, plan.W, plan.n, {}).then(function (res) {
          rows.push({ plan: plan, res: res, audit: UTAS.audit(res) });
          return null;
        });
      });
    });
    return chain.then(function () {
      state.utas = rows;
      renderIfVisible('thread');
      return null;
    })['catch'](function (e) { state.utasErr = reason(e); return null; });
  }

  function demoUtasOne() {
    step('one strategy, on request');
    var out = { err: '' };
    return UTAS.run(state.tStrat, state.tW, state.tN, {}).then(function (res) {
      out.res = res; out.audit = UTAS.audit(res);
      state.utasOne = out;
      return null;
    }, function (e) {
      out.err = reason(e);
      state.utasOne = out;
      return null;
    });
  }

  function demoBatas() {
    var nama = newName('p'), db = null;
    step('the transaction-death boundary');
    var batas = {}, urut = {};
    return bikinDb(nama).then(function (d) {
      db = d;
      var c = Promise.resolve(null);
      DB.WAITS.forEach(function (k) {
        c = c.then(function () { return DB.batasTx(db, k).then(function (r) { batas[k] = r; return null; }); });
      });
      DB.URUT.forEach(function (k) {
        c = c.then(function () { return DB.urutTx(db, k).then(function (r) { urut[k] = r; return null; }); });
      });
      return c;
    }).then(function () {
      state.batas = batas;
      state.urut = urut;
      renderIfVisible('thread');
      return null;
    })['catch'](function (e) {
      state.batas = state.batas || null;
      state.utasErr = state.utasErr || reason(e);
      return null;
    }).then(function () { return db ? tutupHapus(db, nama) : null; });
  }

  function demoIdem() {
    var out = { mode: {}, pasangan: null, jendelaKecil: null, jendelaBesar: null };
    var chain = Promise.resolve(null);
    state.idemErr = '';
    IDEM.MODES.forEach(function (mode) {
      chain = chain.then(function () {
        var nama = newName('i'), db = null;
        step('exactly once: ' + mode);
        return bikinDb(nama).then(function (d) {
          db = d;
          /* NO hold is injected. idem.js resolves the lock helper itself and
             reports holdKind 'kunci', which is what makes "with a real Web Lock
             around the write" true through the lab's own route rather than
             through one this file handed it. */
          return IDEM.run(db, mode, {});
        }).then(function (r) {
          out.mode[mode] = r;
          return null;
        }, function (e) {
          out.mode[mode] = { why: reason(e), ledger: IDEM.LEDGER[mode] };
          return null;
        }).then(function () { return db ? tutupHapus(db, nama) : null; });
      });
    });
    chain = chain.then(function () {
      var nama = newName('i'), db = null;
      step('add() against put()');
      return bikinDb(nama).then(function (d) {
        db = d;
        return IDEM.pasangan(db);
      }).then(function (r) { out.pasangan = r; return null; },
        function (e) { state.idemErr = reason(e); return null; })
        .then(function () { return db ? tutupHapus(db, nama) : null; });
    });
    return chain.then(function () {
      out.jendelaKecil = IDEM.jendela(3, ['IDEM-FIKTIF-000A', 'IDEM-FIKTIF-000B', 'IDEM-FIKTIF-000C', 'IDEM-FIKTIF-000D', 'IDEM-FIKTIF-000A']);
      out.jendelaBesar = IDEM.jendela(50, ['IDEM-FIKTIF-000A', 'IDEM-FIKTIF-000A']);
      state.idem = out;
      renderIfVisible('once');
      return null;
    });
  }

  function demoKunci() {
    var out = { p: {}, buntu: null };
    var chain = Promise.resolve(null);
    state.kunciErr = '';
    if (!KUNCI.ada()) {
      state.kunciErr = 'navigator.locks is not available in this browser or this context, so every lock ' +
        'fixture on this page reports E_KUNCI_TIADA rather than pretending to run.';
      state.kunci = out;
      return Promise.resolve(null);
    }
    KUNCI.PERILAKU.forEach(function (nm) {
      /* buntu is left out of the boot chain on purpose: it is three seconds of
         watching nothing happen, and it belongs behind a button and not on the
         path to a first paint. */
      if (nm === 'buntu') return;
      chain = chain.then(function () {
        step('the queue: ' + nm);
        return KUNCI.perilaku(nm).then(function (r) { out.p[nm] = r; return null; },
          function (e) { out.p[nm] = { gagal: reason(e) }; return null; });
      });
    });
    return chain.then(function () {
      state.kunci = out;
      renderIfVisible('queue');
      return null;
    });
  }

  function demoBuntu() {
    step('the unbounded self-deadlock, three seconds of nothing');
    return KUNCI.perilaku('buntu').then(function (r) {
      if (state.kunci) state.kunci.buntu = r;
      return null;
    }, function (e) {
      if (state.kunci) state.kunci.buntu = null;
      state.kunciErr = reason(e);
      return null;
    });
  }

  /* THE LIVE QUEUE. Route A is this page's own register — it asked for exactly
     one worker-held lock and two page-side requests, and it knows that because
     it issued them. Route B is navigator.locks.query(), the browser's own queue,
     which needs no cooperation from any code here and which a visitor can read
     from a console while the hold is open. */
  function demoAntrean() {
    var bare = 'antre';
    var full = KUNCI.nama(bare);
    var out = { name: full, bare: bare, mine: 0, err: '', snap: { held: [], pending: [] }, hitung: { held: 0, pending: 0 }, distinct: 0, pekerja: null };
    var g = null, a = null, b = null;
    if (!KUNCI.ada() || typeof root.Worker !== 'function') {
      out.err = 'This context has no navigator.locks or no Worker constructor, so there is no queue to read.';
      state.antrean = out;
      return Promise.resolve(null);
    }
    step('a worker takes a lock and the browser is asked for its queue');
    return PANTAU.antreanPekerja({
      url: WORKER_URL, name: 'pekerja', lockPrefix: state.prefix,
      budget: KODE.ANGKA.lockDeadline, step: 25
    }).then(function (r) { out.pekerja = r; return null; }, function () { return null; })
      .then(function () {
        return PANTAU.penjaga({ url: WORKER_URL, name: bare, lockPrefix: state.prefix });
      }).then(function (rec) {
        g = rec;
        out.mine = 1;
        /* Two requests from THIS document, queued behind the worker. Each
           carries its own deadline, so neither can outlive the snapshot even if
           everything after this line fails. */
        a = KUNCI.tahan(bare, { signal: AbortSignal.timeout(1500) });
        b = KUNCI.tahan(bare, { signal: AbortSignal.timeout(1500) });
        return delay(120);
      }).then(function () {
        return KUNCI.lihat();
      }).then(function (snap) {
        out.snap = snap;
        out.hitung = KUNCI.hitung(snap, full);
        out.distinct = KUNCI.klienUnik((snap.held || []).concat(snap.pending || []));
        return null;
      })['catch'](function (e) {
        out.err = reason(e);
        return null;
      }).then(function () {
        /* Everything this fixture took is given back before it returns. A leaked
           holder deadlocks every later request on the same name silently, with
           no error and no console output — which is precisely the failure the
           panel above exists to warn about. */
        if (g) { try { g.matikan(); } catch (e) { /* already gone */ } }
        if (a) a.lepas();
        if (b) b.lepas();
        return Promise.race([
          Promise.all([a ? a.selesai : null, b ? b.selesai : null]),
          delay(1800)
        ])['catch'](function () { return null; });
      }).then(function () {
        state.antrean = out;
        renderIfVisible('queue');
        return null;
      });
  }

  function demoAudit() {
    var nama = newName('a'), db = null;
    var out = { gudang2: null, gudang4: null, saku2: null, saku4: null, sewa: null, srcGudang: '', srcSaku: '' };
    state.auditErr = '';
    step('the two shapes this repository already ships');
    try {
      out.srcGudang = KUNCI.sumberAudit('gudang');
      out.srcSaku = KUNCI.sumberAudit('saku');
    } catch (e) { out.srcGudang = out.srcGudang || ''; }
    return bikinDb(nama).then(function (d) {
      db = d;
      return KUNCI.auditGudang(db, 2, { now: 1, barrier: rendezvous(2) });
    }).then(function (r) {
      out.gudang2 = r;
      /* Re-seeded between runs, deliberately: a lease that is already held is
         the thing being demonstrated, so these fixtures are not idempotent and
         are not meant to be. */
      return DB.seed(db);
    }).then(function () {
      return KUNCI.auditGudang(db, 4, { now: 1, barrier: rendezvous(4) });
    }).then(function (r) {
      out.gudang4 = r;
      return DB.seed(db);
    }).then(function () {
      return KUNCI.sewaDemo(db, 1);
    }).then(function (r) {
      out.sewa = r;
      return KUNCI.auditSaku(db, 2, { barrier: rendezvous(2), idem: 'IDEM-FIKTIF-0011' });
    }).then(function (r) {
      out.saku2 = r;
      return KUNCI.auditSaku(db, 4, { barrier: rendezvous(4), idem: 'IDEM-FIKTIF-0012' });
    }).then(function (r) {
      out.saku4 = r;
      return null;
    })['catch'](function (e) {
      state.auditErr = reason(e);
      return null;
    }).then(function () {
      state.audit = out;
      renderIfVisible('audit');
      renderIfVisible('queue');
      return db ? tutupHapus(db, nama) : null;
    });
  }

  /* A rendezvous built out of promise plumbing and nothing else: no timer, no
     jitter, no repetition until it fails. Every participant arrives, and none
     proceeds until all W of them have. */
  function rendezvous(W) {
    var tiba = 0, buka = null;
    var pintu = new Promise(function (r) { buka = r; });
    return function () {
      tiba++;
      if (tiba >= W) buka(null);
      return pintu;
    };
  }

  /* ------------------------------------------------------- the re-runs */

  var JOBS = {
    pusat: function () { return demoPusat(); },
    bebas: function () { return demoBebas(state.freeBatch); },
    utasOne: function () { return demoUtasOne(); },
    buntu: function () { return demoBuntu(); },
    antrean: function () { return demoAntrean(); }
  };

  function again(what) {
    if (state.busy || !JOBS[what]) return;
    /* Marked busy SYNCHRONOUSLY, in the same turn as the press. A flag set
       inside the promise chain leaves one frame in which a second press is
       accepted, and two of these running at once is the failure the whole
       ordering on this page exists to prevent. */
    step('a re-run of ' + what);
    say('Running: ' + what + '.');
    breathe().then(function () { return JOBS[what](); })['catch'](function (e) {
      /* A rejection that escaped here would be a page error, and one page error
         fails this lab however green every assertion is. */
      state.step = 'a demonstration failed: ' + reason(e);
      return null;
    }).then(function () {
      idle();
      say('Finished.');
      return null;
    });
  }

  /* ============================================================== BOOT === */

  function renderMesin() {
    var body = $('mesinBody');
    if (!body) return;
    var m = state.mesin;
    clear(body);
    if (!m) {
      body.appendChild(h('p', { class: 'empty', text: 'The capability probe did not run.' }));
      return;
    }
    var g = h('div', { class: 'mesin-grid' });
    function cell(k, v) { g.appendChild(h('div', null, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }))); }
    cell('crossOriginIsolated', String(m.crossOriginIsolated));
    cell('SharedArrayBuffer', String(m.sharedArrayBuffer));
    cell('SharedWorker', String(m.sharedWorker));
    cell('Worker', String(m.worker));
    cell('isSecureContext', String(m.isSecureContext));
    cell('navigator.locks', String(m.locks));
    cell('indexedDB', String(m.indexedDB));
    cell('hardwareConcurrency', int(m.hardwareConcurrency));
    cell('clamped writers', int(m.clampW));
    cell('deviceMemory', String(m.deviceMemory));
    cell('visibilityState', String(m.visibilityState));
    body.appendChild(g);
    body.appendChild(h('p', { class: 'mesin-ua', text: m.ua }));
  }

  function buildSumber() {
    var out = { src: {}, diff: [], render: [], keys: '', timer: { ok: true, hits: [] } };
    ARMS.NAMES.forEach(function (nm) { out.src[nm] = ARMS.source(nm); });
    out.diff = KODE.lineDiffTrim(out.src.pisah, out.src.satu);
    out.timer = ARMS.assertNoTimer();

    /* THE KEY CLAIM, structurally: each printed body names exactly one of the
       four account keys and none of the others. That is what "the arms differ by
       one line" means once it is stated honestly — the bodies themselves differ
       on more lines than that, and the panel prints both facts. */
    var parts = [];
    ARMS.NAMES.forEach(function (nm) {
      var body = out.src[nm], found = [];
      ARMS.NAMES.forEach(function (other) {
        if (body.indexOf("'K-" + other + "'") >= 0) found.push('K-' + other);
      });
      parts.push(nm + ': ' + (found.length ? found.join(' + ') : 'no account key'));
    });
    out.keys = 'Measured just now — ' + parts.join(', ');

    /* The rendered diff walks BOTH bodies line by line and marks the ones the
       engine's own lineDiff reported. Colour is never the only carrier: the a/b
       lines get a rule and a leading marker character in the text. */
    var la = norm(out.src.pisah), lb = norm(out.src.satu), i;
    var mark = {};
    for (i = 0; i < out.diff.length; i++) mark[out.diff[i].i] = true;
    var n = Math.max(la.length, lb.length);
    for (i = 0; i < n; i++) {
      if (!mark[i]) { out.render.push({ cls: 'same', text: '  ' + (la[i] === undefined ? '' : la[i]) }); continue; }
      if (la[i] !== undefined) out.render.push({ cls: 'a', text: '- ' + la[i] });
      if (lb[i] !== undefined) out.render.push({ cls: 'b', text: '+ ' + lb[i] });
    }
    return out;
  }

  function norm(s) {
    var l = String(s).split('\n'), o = [], i, t;
    for (i = 0; i < l.length; i++) { t = l[i].replace(/^\s+|\s+$/g, ''); if (t) o.push(t); }
    return o;
  }

  function runTests() {
    if (!T || typeof T.run !== 'function') {
      state.testsErr = 'tests.js did not load, so nothing on this page has been checked.';
      paintTests();
      return Promise.resolve(null);
    }
    state.testsBusy = true;
    /* The controls that would start a second run are disabled for the whole of
       it. A visitor who presses one while the suite is mid-flight would be
       starting a second run on the same page, which is the failure this whole
       ordering exists to prevent. */
    step('the assertion suite');
    paintTests();
    renderIfVisible('tests');
    var t0 = now();
    /* Timed from OUTSIDE. The suite is forbidden from reading a clock and pins
       its own ms field to 0; the figure here is a display and is asserted by
       nothing. */
    return T.run().then(function (r) {
      state.tests = r;
      state.testsMs = now() - t0;
      state.testsBusy = false;
      paintTests();
      paintNet();
      renderIfVisible('tests');
      say(r.failed ? 'Assertions: ' + r.failed + ' failed.' :
        'Assertions: ' + r.properties + ' properties, ' + r.passed + ' of ' + r.total + ' executions passed.');
      return null;
    })['catch'](function (e) {
      state.testsErr = reason(e);
      state.testsBusy = false;
      paintTests();
      renderIfVisible('tests');
      return null;
    });
  }

  /* Everything this file drives runs STRICTLY AFTER the suite has settled, on
     its own run id, its own database names and its own lock prefix. Two runs on
     one page share one storage engine and destroy each other: measured, one
     run's deleteDatabase fires onversionchange on the other's connection, that
     connection closes itself, and the next transaction dies as a page error with
     every assertion still green. */
  function work() {
    state.runId = DB.runId();
    state.prefix = DB.lockPrefix(state.runId);
    KUNCI.pakaiAwalan(state.prefix);

    var chain = Promise.resolve(null);
    function stage(fn) {
      chain = chain.then(function () { return breathe(); }).then(function () {
        return fn()['catch'](function (e) { state.step = reason(e); return null; });
      });
    }
    stage(demoPusat);
    stage(function () { return demoBebas(state.freeBatch); });
    stage(demoUtas);
    stage(demoBatas);
    stage(demoIdem);
    stage(demoKunci);
    stage(demoAntrean);
    stage(demoAudit);
    return chain.then(function () {
      idle();
      /* The monitor covered the whole of it — boot, the suite, and every
         demonstration above — and the longest gap is whatever it is. */
      state.raf = PANTAU.rafSelesai(state.rafH);
      state.rafH = null;
      paintNet();
      renderIfVisible('limits');
      say('Every demonstration on this page has finished.');
      return null;
    });
  }

  function boot() {
    paintTheme();
    var tb = $('themeBtn');
    if (tb) tb.addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    var bt = $('testBadge');
    if (bt) bt.addEventListener('click', function () { switchTab('tests'); });
    if (root.SEROBOT_GUARD) root.SEROBOT_GUARD.onchange = paintNet;
    paintNet();
    paintTests();
    wireTabs();

    /* The capability line is the first live thing on the page, because a senior
       reader types crossOriginIsolated into a console within twenty seconds of
       arriving and leading with the answer buys the rest of the visit. */
    try { state.mesin = PANTAU.mesin(); } catch (e) { state.mesin = null; }
    try { state.atomik = PANTAU.atomik(); } catch (e2) { state.atomik = null; }
    if (state.mesin) {
      state.hc = state.mesin.hardwareConcurrency;
      state.W = state.mesin.clampW;
      state.n = KODE.ANGKA.barrierN[String(state.W)] || KODE.ANGKA.barrierN['4'];
      state.freeW = state.hc > 0 ? state.hc : 1;
    }
    state.freeN = KODE.ANGKA.freeN;
    state.freeBatch = KODE.ANGKA.freeBatch;
    renderMesin();

    try { state.src = buildSumber(); } catch (e3) { state.src = null; }

    /* guard.js records a tab click that landed before this file existed and
       stands down the moment <html> carries `ready`. Read it, honour it, THEN
       set the class — the other order silently discards the one click the whole
       mechanism exists to catch. */
    var pending = document.documentElement.getAttribute('data-serobot-pending-tab');
    document.documentElement.removeAttribute('data-serobot-pending-tab');
    document.documentElement.classList.add('ready');
    state.step = 'the assertion suite';
    if (pending && $('panel-' + pending)) switchTab(pending);
    else renderPanel('ledgers');

    /* The monitor starts here and runs across everything: the suite, all eight
       demonstrations, and the renders between them. It is rAF-based because a
       setInterval gap detector reports 0 ms for a real block — the callback
       cannot fire during it and clearing the timer in the same turn discards the
       late tick. */
    try { state.rafH = PANTAU.rafMulai(); } catch (e4) { state.rafH = null; }

    /* A yielded frame before any of it: the page is scrollable and clickable
       from the first paint. */
    breathe().then(function () { return runTests(); }).then(function () { return work(); })
    ['catch'](function (e) {
      state.step = reason(e);
      idle();
      return null;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
