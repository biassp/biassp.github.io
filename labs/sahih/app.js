/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — app.js
 * The only file on this page that touches the DOM. It renders what the other
 * nine modules compute and it never computes anything they could have: it does
 * not decide whether a token verified, does not re-derive a refusal code, and
 * does not rewrite a reason string. jose.js returns a verdict, periksa.js
 * returns a second one, vectors.js returns a literal, and this file puts them
 * on screen unchanged.
 *
 * Nine things this file has to get right that are easy to miss:
 *
 *  1. EVERY TOKEN, HEADER AND HEX BLOB ARRIVES THROUGH textContent, which is
 *     why all six panels are empty in index.html. A JSON header fragment with a
 *     raw `<` before a letter is an html-validate no-raw-characters violation
 *     and a parse5 invalid-first-character-of-tag-name error at once, and a
 *     literal script tag in prose is additionally harvested by
 *     test/syntax.test.js and handed to node --check. Through textContent the
 *     same string cannot be markup at all — which on a page about defence
 *     removes a class of bug rather than avoiding a lint.
 *
 *  2. THE TWO ROUTES MUST STAY APART. Wherever this file shows a pair of
 *     verdicts with an agreement column, the comment above the pair names both
 *     producers and they share no code below crypto.subtle.verify — route A is
 *     SAHIH_JOSE over a key it imported itself, route B is SAHIH_PERIKSA handed
 *     a token STRING and a JWK as JSON TEXT. If either half were computed here
 *     the difference could only ever be zero, which is the bug this repository
 *     has shipped four times. Where route B genuinely cannot be built without
 *     this file becoming a second forger, the card says so instead of faking a
 *     second opinion — see the rung-2 note.
 *
 *  3. NOTHING ON THIS PAGE ATTEMPTS EGRESS, not even to demonstrate the counter
 *     in the header. Measured under this page's own CSP, every blocked attempt
 *     logs a console error, and test/labs.test.js counts one console error as a
 *     broken lab — so a "press to prove the counter works" button would fail CI
 *     with every assertion green. The counter's arithmetic is exercised inside
 *     tests.js on a throwaway object. This file only ever READS
 *     SAHIH_GUARD.total().
 *
 *  4. EVERY subtle CALL CARRIES A .catch. An unhandled rejection is a
 *     pageerror, and one pageerror fails the lab however green the assertions
 *     are. The boot chain's catch is not decoration: it is the only thing
 *     between a browser with no Web Crypto and a red CI run for the wrong
 *     reason.
 *
 *  5. BOOT IS CHUNKED AND MEASURED. The lab next door blocked the main thread
 *     for 23.6 seconds on load and every review passed it, because each review
 *     asked "does it finish" and never "can the page be scrolled while it
 *     runs". So the first paint happens before the fixture is built, the
 *     fixture and the suite are each preceded by a yielded frame, and the
 *     longest main-thread block during boot is measured with
 *     requestAnimationFrame rather than assumed. The figures are in the README.
 *
 *  6. FOCUS SURVIVES A RE-RENDER. Every control that can be pressed twice
 *     carries a data-fkey; the key and the caret are captured before a panel is
 *     torn down and restored after. A panel that re-renders under the reader's
 *     hands and drops focus to <body> is unusable with a keyboard, and the
 *     clock slider on the Klaim tab re-renders on every change.
 *
 *  7. A THROWING RENDERER MUST NOT REACH THE CONSOLE. renderPanel wraps each
 *     renderer and prints the failure as a red card in place, for the same
 *     reason as 3.
 *
 *  8. THE VERDICT COLOURS ARE NAMED BY WHAT THE VERIFIER DID, never by whether
 *     that was good. On the Periksa tab a refusal is the failure; on the Palsu
 *     tab an acceptance is the failure; on rung 5 an acceptance is correct. So
 *     the colour never carries the verdict on its own: the word, the lab's own
 *     error code, and — where the page made a prediction — a ✓/✗ beside it do.
 *
 *  9. §8's honesty section and §9's footer are STATIC MARKUP in index.html and
 *     are not re-rendered here. Rendering them would be the page arguing with
 *     itself, and they must be readable with JavaScript off.
 */
(function (root) {
  'use strict';

  var B = root.SAHIH_BYTES;
  var V = root.SAHIH_VECTORS;
  var J = root.SAHIH_JOSE;
  var PK = root.SAHIH_PERIKSA;
  var FX = root.SAHIH_FIXTURE;
  var St = root.SAHIH_STORE;
  var T = root.SAHIH_TESTS;

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
   * input fires blur synchronously, and a blur handler that re-renders leaves
   * the loop removing a node that is no longer its child. */
  function clear(el) { el.textContent = ''; }

  function num(n) {
    if (n === null || n === undefined) return '—';
    var s = String(Math.abs(Math.round(n))), out = '', i, c = 0;
    for (i = s.length - 1; i >= 0; i--) { out = s.charAt(i) + out; if (++c % 3 === 0 && i > 0) out = '.' + out; }
    return (n < 0 ? '-' : '') + out;
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

  function btn(label, onclick, cls, fkey) {
    return h('button', {
      type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), 'data-fkey': fkey || null, onclick: onclick
    }, label);
  }

  function stat(k, v, n) {
    return h('div', { class: 'stat' },
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

  /* One box for every token, JWK, signing input, segment and hex blob on this
   * page. Never an inline <code>: the RS256 signature from RFC 7515 A.2 is 342
   * characters, and in running prose that is a horizontal scrollbar on the whole
   * document at phone width. */
  function tokenbox(text) { return h('pre', { class: 'tokenbox', text: text === null || text === undefined ? '—' : String(text) }); }

  function segBox(label, text, cls) {
    return h('div', { class: 'seg' + (cls ? ' ' + cls : '') },
      h('div', { class: 'k', text: label }), tokenbox(text));
  }

  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { text: label }), control);
  }

  function textInput(value, fkey, oninput) {
    return h('input', { type: 'text', value: value, 'data-fkey': fkey, spellcheck: 'false', oninput: oninput });
  }

  /* The word carries the verdict and the colour only repeats it. On this page a
   * refusal is the desired outcome about as often as an acceptance is, so a
   * red/green matrix would train the reader backwards inside two cards. */
  function verdictPill(ok) {
    return ok ? pill('accepted', 'accepted') : pill('refused', 'refused');
  }

  /* ✓/✗ says whether the outcome was the one the page predicted; the pill says
   * what the verifier actually did. Two different facts, two different glyphs,
   * and a reader in monochrome gets both. */
  function predictionMark(asExpected) {
    return h('span', { class: 'mk ' + (asExpected ? 'v-pinned' : 'v-refused'), text: asExpected ? '✓' : '✗' });
  }

  function pairRow(label, a, b, agree) {
    return h('tr', null,
      h('td', { text: label }),
      h('td', null, tokenbox(a)),
      h('td', null, tokenbox(b)),
      h('td', null, agree ? pill('agree', 'pinned') : pill('DIFFER', 'bad')));
  }

  var sayTimer = null;
  function say(text) {
    var el = $('say');
    if (!el || !text) return;
    /* Cleared first and set on a timer: a live region whose text is replaced in
     * the same task is not re-announced by every screen reader. */
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
    } catch (e) { /* selectionStart throws on a range input */ }
    return snap;
  }

  /* Where focus goes when the control that had it no longer exists. The anchor
   * is the control the next action needs anyway, so a keyboard reader is never
   * dropped onto <body> in the middle of a card. */
  var FOCUS_ANCHOR = {
    issue: 'issue:reissue', verify: 'verify:reset', forge: 'forge:rung5',
    claims: 'claims:clock', vectors: 'vectors:top', tests: 'tests:again'
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
    view: 'issue',
    fx: null,                 // the fixture, once built
    fxErr: null,
    booting: true,
    bootStep: 'waiting for crypto.subtle',
    secretAt: 0,              // when getRandomValues produced the HS256 secret
    waktu: null,              // the visitor's own clock, branded
    webauthn: 'not asked yet',
    routes: null,             // route-B probes this file drives itself
    issue: null,              // the token the Terbit tab last minted
    issueErr: null,
    twice: null,
    form: null,
    verify: null,             // the Periksa tab's two verdicts
    probe: 'clean',           // clean | sig | payload | alg
    firewall: null,
    forgeB: null,             // route-B recomputation for the ladder
    clockNow: null,           // the Klaim tab's injected clock
    claims: null,
    revoked: false,
    vectorsB: null,
    tests: null,
    testsBusy: false,
    testsMs: 0
  };

  function api() {
    /* One reach for the global, in one place, in a try/catch: a browser with the
     * API behind a flag throws on property access rather than returning
     * undefined, and an uncaught throw here would blank the page. */
    try { return root.crypto && root.crypto.subtle ? root.crypto.subtle : null; }
    catch (e) { return null; }
  }

  /* ---------------------------------------------------------- the badges */

  function paintNet() {
    var g = root.SAHIH_GUARD;
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
    /* noise is SAHIH_GUARD.total() as the suite found it, not a console count:
     * it can only be non-zero if something in this lab attempted egress, which
     * nothing here does. A positive value is a defect and reads as one. */
    b.className = 'testbadge' + ((r.failed || r.noise) ? ' bad' : '');
    t.textContent = r.failed
      ? 'tests: ' + r.failed + ' FAILED'
      : 'tests: ' + r.passed + '/' + r.total + ' passed';
  }

  function paintTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var b = $('themeBtn');
    if (!b) return;
    /* The visible word IS the accessible name (WCAG 2.5.3), and it names the
     * ACTION. No aria-pressed: a state bit contradicts an action label, and the
     * sibling labs already learned that the hard way — "Dark, pressed" announced
     * while the page was light. The change is announced through the live region
     * instead, which says what happened. */
    b.textContent = dark ? 'Light' : 'Dark';
    b.removeAttribute('aria-pressed');
    b.setAttribute('title', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  }

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    if (St) St.writeTheme(next);
    paintTheme();
    say(next === 'dark' ? 'Dark theme.' : 'Light theme.');
  }

  /* ------------------------------------------------------------ plumbing */

  var RENDER = {};

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel) return;
    var snap = captureFocus();
    clear(panel);
    try { RENDER[name](panel); }
    catch (e) {
      /* The last line of defence. A renderer that throws must not become a
       * console error: test:labs counts one as a failed lab. */
      panel.appendChild(callout('bad', 'This panel failed to render.', String(e && e.message || e)));
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
     * twice is worse than not saying it at all. The VISIBLE label, never the
     * internal key: the strip reads Terbit / Periksa / Palsu, and announcing
     * "forge tab" names something that appears nowhere on the page, to the one
     * visitor who cannot see which tab moved. */
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
         * and renders the panel, and focusing first lets the render move focus
         * again. */
        next.focus();
        showTab(next);
      });
    });
  }

  /* Blink does not scroll a PARTIALLY visible element into view when it takes
   * focus, and the strip is an overflow-x scroller: at 390px the Tests tab is
   * genuinely off-screen right, and arrowing onto it left it there with its
   * focus ring outside the box. Measured, then measured again after this line. */
  function showTab(el) {
    if (!el.scrollIntoView) return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (e) { /* the older signature takes a boolean and would scroll the page */ }
  }

  function waiting(p, what) {
    p.appendChild(h('div', { class: 'empty', text: state.fxErr ? state.fxErr : 'Building ' + what + '…' }));
  }

  function needFixture(p, what) {
    if (state.fxErr) {
      p.appendChild(callout('bad', 'This page has no fixture to render.', state.fxErr));
      return false;
    }
    if (!state.fx) { waiting(p, what); return false; }
    return true;
  }

  /* ------------------------------------------------- shared render pieces */

  /* One row per entry in a verifier's own checks array. The array is data and
   * the count is never typed: a heading that said "sixteen checks" would be a
   * literal this page cannot keep honest, so every heading prints
   * checks.length. */
  function checkRows(checks) {
    var box = h('div');
    checks.forEach(function (c, i) {
      var didNotRun = c.ok === null || c.reached === false;
      var cls = 'checkrow' + (didNotRun ? ' inapplicable' : '');
      var mark, mcls, codeText, codeCls;
      if (didNotRun) { mark = '–'; mcls = 'v-inapplicable'; codeText = 'not reached'; codeCls = 'v-inapplicable'; }
      else if (c.skipped) { mark = '·'; mcls = 'v-inapplicable'; codeText = 'not configured'; codeCls = 'v-inapplicable'; }
      else if (c.ok) { mark = '✓'; mcls = 'v-accepted'; codeText = 'passed'; codeCls = 'v-accepted'; }
      else { mark = '✗'; mcls = 'v-refused'; codeText = c.code || 'refused'; codeCls = 'v-refused'; }
      box.appendChild(h('div', { class: cls },
        h('span', { class: 'mk ' + mcls, text: mark }),
        h('span', { class: 'rung-n', text: String(i + 1) }),
        h('span', { class: 'nm', text: c.name }),
        h('span', { class: 'code ' + codeCls, text: codeText }),
        h('span', { class: 'saw', text: c.saw })));
    });
    return box;
  }

  function verdictLine(v, label) {
    var line = h('p', { class: 'note' },
      h('b', { text: label + ': ' }), verdictPill(v.ok), ' ');
    line.appendChild(h('span', { class: v.ok ? 'v-accepted' : 'v-refused',
      text: v.ok ? 'no check refused it' : v.reason }));
    return line;
  }

  function tokenTriple(token, cmp) {
    var s = String(token).split('.');
    var wrap = h('div', { class: 'segs' });
    var names = ['header segment', 'payload segment', 'signature segment'];
    var i;
    for (i = 0; i < 3; i++) {
      var cls = null;
      if (cmp) cls = (s[i] === cmp[i]) ? 'same' : 'differs';
      wrap.appendChild(segBox(names[i] + ' — ' + (s[i] === undefined ? 0 : s[i].length) + ' chars',
        s[i] === undefined ? '(absent)' : (s[i] === '' ? '(empty)' : s[i]), cls));
    }
    return wrap;
  }

  /* The refusal is the last element of every card on this page. Not a
   * convention: §9.3's rule, and it is checkable by looking at the last child. */
  function terminal(lead, body) {
    return h('div', { class: 'terminal' },
      h('div', { class: 'lead', text: lead }), body);
  }

  /* ============================================================ TERBIT === */

  function defaultForm() {
    var F = state.fx;
    var p = F ? F.legit.payload : { sub: 'u_FIKTIF_1042', role: 'member', iss: 'https://sahih.invalid', aud: 'sahih-toy' };
    return {
      sub: p.sub, role: p.role, iss: p.iss, aud: p.aud,
      alg: 'ES256', lifetime: 600
    };
  }

  function formPayload() {
    var F = state.fx, f = state.form;
    var now = F ? F.meta.now : 0;
    /* iat is a minute in the past because a token nobody has carried anywhere is
       not the interesting case. exp is measured FROM iat, not from now: the field
       is labelled "exp — iat" and row 12 bounds exp-iat against maxLifetimeSec,
       so anchoring exp to now would silently add that minute to every lifetime
       and put the refusal boundary sixty seconds below the endpoint's own
       published maximum. Type 900 and 900 is what the checklist reads. */
    return {
      sub: f.sub, role: f.role, iss: f.iss, aud: f.aud,
      iat: now - 60, exp: (now - 60) + (parseInt(f.lifetime, 10) || 0),
      jti: F ? F.meta.revokedJti : 'jti_FIKTIF_a3f1'
    };
  }

  function privJwkFor(alg) {
    var F = state.fx;
    if (alg === 'HS256') return JSON.parse(F.keys.hs.jwkText);
    if (alg === 'RS256') return JSON.parse(F.keys.rs.privJwkText);
    return JSON.parse(F.keys.es.privJwkText);
  }

  function pubTextFor(alg) {
    var F = state.fx;
    if (alg === 'HS256') return F.keys.hs.jwkText;
    if (alg === 'RS256') return F.keys.rs.pubJwkText;
    return F.keys.es.pubJwkText;
  }

  function doIssue(announce) {
    var subtle = api(), F = state.fx;
    if (!subtle || !F) return;
    var alg = state.form.alg, payload = formPayload(), token;
    state.issueErr = null;
    /* The issuer's refusals are SYNCHRONOUS and land before any key work: no
     * promise exists yet, so this try/catch is the whole of the error path and
     * the reader sees the refusal rather than a rejected promise nobody read. */
    try { token = J.issue(subtle, privJwkFor(alg), alg, payload); }
    catch (e) {
      state.issueErr = String(e && e.message || e);
      state.issue = null;
      renderIfVisible('issue');
      say('The issuer refused. ' + state.issueErr);
      return;
    }
    token.then(function (tok) {
      var segs = tok.split('.');
      var out = {
        alg: alg, token: tok, payload: payload,
        headerJson: B.utf8Decode(B.b64uDecodeStrict(segs[0])),
        payloadJson: B.utf8Decode(B.b64uDecodeStrict(segs[1])),
        signingInput: segs[0] + '.' + segs[1],
        signingInputBytes: B.utf8Encode(segs[0] + '.' + segs[1]).length,
        sigHex: B.hex(B.b64uDecodeStrict(segs[2])),
        sigBytes: B.b64uDecodeStrict(segs[2]).length,
        segLens: [segs[0].length, segs[1].length, segs[2].length],
        routeA: null, routeB: null
      };
      /* ROUTE A — SAHIH_JOSE.verifyStrict, which imported the key from the same
       *           JWK object the issuer signed with, in this task.
       * ROUTE B — SAHIH_PERIKSA.check, handed the token as a STRING and the
       *           public key as JWK JSON TEXT. It re-splits, re-decodes with its
       *           own decoder, re-parses and re-imports. The two files share no
       *           identifier: grep -o 'SAHIH_[A-Z]*' periksa.js prints one name. */
      var expA = FX.expectation({ alg: alg, kid: null, jwk: JSON.parse(pubTextFor(alg)) });
      var expB = FX.expectation({ alg: alg, kid: null, jwk: null });
      return J.verifyStrict(subtle, tok, expA).then(function (a) {
        out.routeA = { ok: a.ok, code: a.code, reason: a.reason, checks: a.checks.length };
        return PK.check(subtle, tok, pubTextFor(alg), expB);
      }).then(function (b2) {
        out.routeB = { ok: b2.ok, code: b2.code, reason: b2.reason, checks: b2.checks.length, route: b2.route };
        state.issue = out;
        renderIfVisible('issue');
        if (announce) {
          say('Token issued under ' + alg + '. Signing input ' + out.signingInputBytes +
            ' bytes, signature ' + out.sigBytes + ' bytes. Both routes ' +
            (out.routeA.ok === out.routeB.ok ? 'agree.' : 'DISAGREE.'));
        }
      });
    })['catch'](function (e) {
      state.issueErr = 'The issuer or a verifier rejected: ' + String(e && e.name || '') + ' ' + String(e && e.message || e);
      state.issue = null;
      renderIfVisible('issue');
    });
  }

  /* Twice under the same key over the same bytes. HS256 is deterministic and
   * ES256 is not, and the reader performs that difference rather than reading a
   * sentence claiming it. */
  function doTwice(alg) {
    var subtle = api(), F = state.fx;
    if (!subtle || !F) return;
    var payload = formPayload();
    var jwk = privJwkFor(alg);
    J.issue(subtle, jwk, alg, payload).then(function (t1) {
      return J.issue(subtle, jwk, alg, payload).then(function (t2) {
        var a = t1.split('.')[2], b2 = t2.split('.')[2];
        state.twice = {
          alg: alg, sigA: a, sigB: b2, identical: a === b2,
          expected: alg === 'ES256' ? 'different' : 'identical'
        };
        renderIfVisible('issue');
        say(alg + ' signed the same bytes twice: the two signatures are ' +
          (state.twice.identical ? 'identical.' : 'different.'));
      });
    })['catch'](function (e) {
      state.twice = { alg: alg, error: String(e && e.name || e) };
      renderIfVisible('issue');
    });
  }

  function renderIssue(p) {
    p.appendChild(h('h2', { text: 'Terbit — the authority, built in front of you' }));
    if (!needFixture(p, 'the keys and the first token')) return;
    var F = state.fx;
    if (!state.form) state.form = defaultForm();
    if (!state.issue && !state.issueErr) doIssue(false);

    /* ---- the three keyrings ---- */
    var kc = card('Three keyrings, and where each key came from',
      'A key with no provenance is a key you are asked to trust. Each of these says how it came to exist, ' +
      'in one of two forms: generated in this tab moments ago, or published in an RFC ten years ago and ' +
      'therefore incapable of protecting anything.');
    var ring = h('div', { class: 'segs' });
    [['es', 'ES256 — the endpoint key'], ['rs', 'RS256'], ['hs', 'HS256']].forEach(function (pairv) {
      var k = F.keys[pairv[0]];
      var prov = k.provenance === 'live'
        ? 'crypto.getRandomValues, this tab, ' + Math.max(0, Date.now() - state.secretAt) + ' ms ago'
        : k.provenanceSource + ', published ' + k.provenanceYear;
      var boxWrap = h('div', { class: 'seg' },
        h('div', { class: 'k', text: pairv[1] + ' · kid ' + k.kid }),
        tokenbox(pairv[0] === 'hs' ? k.jwkText : (pairv[0] === 'es' ? k.pubJwkText : k.pubJwkText)),
        h('p', { class: 'small' }, h('span', { class: 'v-pinned', text: prov })));
      if (pairv[0] === 'hs') {
        boxWrap.appendChild(h('p', { class: 'small',
          text: 'This is the whole secret, on screen, because it is 256 bits that will not outlive the tab. ' +
            k.secretBytes + ' bytes.' }));
      }
      ring.appendChild(boxWrap);
    });
    kc.appendChild(ring);
    kc.appendChild(h('p', { class: 'hint',
      text: 'The ES256 and RS256 keys are RFC 7515\'s own published test keys. They are printed here with ' +
        'their public half only; the private halves exist in this tab and sign nothing that exists, because ' +
        'the issuer refuses any iss outside RFC 2606\'s reserved .invalid.' }));
    kc.appendChild(terminal('what a provenance label is for',
      h('span', null, h('b', { text: 'Two of these keys cannot protect anything and the third will not outlive this tab. ' }),
        'That is the only honest posture for a lab: the sibling that holds a stranger\'s capture ships a JWT ' +
        'decoder which never verifies a signature, because verification needs a key it must not ask for. ' +
        'This page closes that half-sentence by making the keys itself, milliseconds ago, in front of you.')));
    p.appendChild(kc);

    /* ---- the claims editor ---- */
    var ec = card('This page\'s own payload, before this page\'s own issuer signs it',
      'There is no paste box on this page and nowhere to point it. What is editable is the payload this ' +
      'page is about to sign, and the issuer refuses two of the fields outright.');
    var f = state.form;
    var row = h('div', { class: 'controls' });
    row.appendChild(field('sub', textInput(f.sub, 'issue:sub', function (e) { f.sub = e.target.value; })));
    row.appendChild(field('role', textInput(f.role, 'issue:role', function (e) { f.role = e.target.value; })));
    row.appendChild(field('iss', textInput(f.iss, 'issue:iss', function (e) { f.iss = e.target.value; })));
    row.appendChild(field('aud', textInput(f.aud, 'issue:aud', function (e) { f.aud = e.target.value; })));
    var sel = h('select', { 'data-fkey': 'issue:alg', onchange: function (e) { f.alg = e.target.value; doIssue(true); } });
    ['ES256', 'RS256', 'HS256'].forEach(function (a) {
      sel.appendChild(h('option', { value: a, selected: f.alg === a ? true : null, text: a }));
    });
    row.appendChild(field('alg', sel));
    row.appendChild(field('exp — iat, seconds', h('input', {
      type: 'number', value: String(f.lifetime), min: '1', max: '100000', 'data-fkey': 'issue:life',
      oninput: function (e) { f.lifetime = e.target.value; }
    })));
    ec.appendChild(row);
    ec.appendChild(h('div', { class: 'controls no-print' },
      btn('Issue this payload', function () { doIssue(true); }, 'primary small', 'issue:reissue'),
      btn('Sign the same bytes twice', function () { doTwice(f.alg); }, 'small', 'issue:twice'),
      /* Each of these two restores the OTHER field before it breaks its own.
         The issuer checks iss first and returns on the first refusal, so leaving
         a bad iss in place made the sub button report the iss rule — a button
         that demonstrates the wrong refusal is worse than no button. */
      btn('Ask for an iss that is not .invalid', function () {
        f.sub = F.legit.payload.sub;
        f.iss = 'https://bank.example';
        doIssue(true);
      }, 'small ghost', 'issue:badiss'),
      btn('Ask for a sub that is not fabricated', function () {
        f.iss = F.meta.iss;
        f.sub = 'user-1042';
        doIssue(true);
      }, 'small ghost', 'issue:badsub'),
      btn('Put both back', function () {
        f.iss = F.meta.iss; f.sub = F.legit.payload.sub; doIssue(true);
      }, 'small ghost', 'issue:reset')));

    if (state.issueErr) {
      ec.appendChild(callout('warn', 'The issuer refused, and it refused before any key was touched.',
        state.issueErr));
      ec.appendChild(h('p', { class: 'hint',
        text: 'Both rules: ' + F.meta.issRule + '; ' + F.meta.subRule + '. They are enforced in jose.js and ' +
          'not promised in prose, which is the only version of that promise worth anything.' }));
    }
    if (state.twice) {
      var tw = state.twice;
      if (tw.error) {
        ec.appendChild(callout('bad', 'That signing pair could not be produced.', tw.error));
      } else {
        ec.appendChild(callout(tw.identical === (tw.expected === 'identical') ? 'ok' : 'bad',
          tw.alg + ' signed the same bytes twice and the two signatures are ' +
          (tw.identical ? 'byte-identical.' : 'different.'),
          tw.alg === 'ES256'
            ? 'ECDSA draws a fresh random nonce per signature, so a correct implementation cannot reproduce ' +
              'its own output. That is why no assertion in this lab pins an ES256 signature to a literal, and ' +
              'why RFC 7515 Appendix A.3 is a verify-only vector.'
            : 'HMAC and PKCS#1 v1.5 are deterministic: the same key over the same bytes is the same ' +
              'signature every time, which is what makes A.1 and A.2 pinnable by equality.'));
        ec.appendChild(h('div', { class: 'segs' },
          segBox('first signature', tw.sigA, tw.identical ? 'same' : 'differs'),
          segBox('second signature', tw.sigB, tw.identical ? 'same' : 'differs')));
      }
    }
    ec.appendChild(terminal('the refusal, enforced rather than promised',
      h('span', null,
        h('span', { class: 'v-refused', text: 'issue refuses. ' }),
        F.meta.issRule + ', and ' + F.meta.subRule + '. Both are throws from jose.js that land before a key ' +
        'is imported — press either grey button above and the refusal is on screen, not in a paragraph.')));
    p.appendChild(ec);

    /* ---- the token, dissected ---- */
    var dc = card('The token this page just minted, dissected');
    if (!state.issue) {
      dc.appendChild(h('div', { class: 'empty', text: 'Signing…' }));
      p.appendChild(dc);
      return;
    }
    var t = state.issue;
    dc.appendChild(tokenTriple(t.token));
    dc.appendChild(h('div', { class: 'summary' },
      stat('alg', t.alg, 'chosen by the endpoint, then written into the header'),
      stat('signing input', t.signingInputBytes + ' bytes', 'b64u(header) + "." + b64u(payload)'),
      stat('signature', t.sigBytes + ' bytes', t.alg === 'ES256' ? 'raw r || s, not DER' :
        (t.alg === 'HS256' ? 'HMAC-SHA-256 output' : 'PKCS#1 v1.5 over a 2048-bit modulus')),
      stat('segment lengths', t.segLens.join(' / '), 'header / payload / signature, in characters')));
    dc.appendChild(h('p', { class: 'note', text: 'The exact string that was signed:' }));
    dc.appendChild(tokenbox(t.signingInput));
    dc.appendChild(h('p', { class: 'hint',
      text: 'That string is the message. Not the header object, not the payload object — the concatenation ' +
        'of the two encoded segments with a dot between them. A verifier that re-serialises what it parsed ' +
        'and MACs the result is verifying a different message, and the Rujukan tab has the vector that ' +
        'proves it: RFC 7515 A.1\'s header segment only reproduces because its CRLF is preserved.' }));
    dc.appendChild(h('div', { class: 'segs' },
      segBox('header, decoded', t.headerJson),
      segBox('payload, decoded', t.payloadJson)));
    dc.appendChild(h('p', { class: 'note', text: 'Signature, as hex:' }));
    dc.appendChild(tokenbox(t.sigHex));

    /* ROUTE A — SAHIH_JOSE.verifyStrict, holding the key object it imported.
     * ROUTE B — SAHIH_PERIKSA.check: token as a string, key as JWK JSON text,
     *           its own base64url decoder, its own fifteen-row checklist. */
    if (t.routeA && t.routeB) {
      dc.appendChild(h('p', { class: 'note' }, h('b', { text: 'The same claim, twice, by two files that share no identifier. ' }),
        'Route A is the issuer\'s own verifier holding the key it imported. Route B is periksa.js, handed the ' +
        'token as a string and the public key as JWK JSON text.'));
      /* A red pill and nothing else is the one thing this page must not ship.
         The Periksa card names the row that refused; this cell did not, so a
         payload the reader had just typed came back refused with the reason
         reachable only from the console. */
      var routeCell = function (r, tail) {
        var cell = h('td', null, verdictPill(r.ok), h('div', { class: 'small', text: tail }));
        /* r.reason already opens with the code, the way the Periksa card prints it. */
        if (!r.ok) cell.appendChild(h('div', { class: 'small v-refused', text: r.reason }));
        return cell;
      };
      dc.appendChild(tableOf(['claim', 'route A — SAHIH_JOSE.verifyStrict', 'route B — SAHIH_PERIKSA.check', 'agree'], [
        h('tr', null,
          h('td', { text: 'this token\'s signature is over this signing input' }),
          routeCell(t.routeA, t.routeA.checks + ' checks'),
          routeCell(t.routeB, t.routeB.checks + ' checks, route ' + t.routeB.route),
          h('td', null, t.routeA.ok === t.routeB.ok ? pill('agree', 'pinned') : pill('DIFFER', 'bad')))
      ], { prose: true, minWidth: '640px' }));
      dc.appendChild(h('p', { class: 'hint',
        text: 'The two checklists are different lengths — ' + t.routeA.checks + ' rows and ' + t.routeB.checks +
          ' rows — because route B has no "the verification key is a public key" row: it refuses a JWK ' +
          'carrying a d member before it starts, and a check that cannot be reached is not a check. Both ' +
          'routes bottom out in the same crypto.subtle.verify, which is said here rather than hidden: there ' +
          'is no second signature implementation in a browser.' }));
    }
    dc.appendChild(terminal('the issuer\'s own rule',
      h('span', null, h('b', { text: 'Nothing this issuer signs can claim to be real. ' }),
        F.meta.issRule + ', and ' + F.meta.subRule + '. Press either grey button above and read the refusal: ' +
        'it is a throw from jose.js before a key is imported, not a string in a paragraph.')));
    p.appendChild(dc);
  }
  RENDER.issue = renderIssue;

  /* =========================================================== PERIKSA === */

  /* The four states of the Periksa tab. Each one changes exactly one thing, so
   * that the checklist's response can be attributed: a list that reddens
   * everything at once is one boolean wearing sixteen labels. */
  function probeToken() {
    var F = state.fx, segs = F.legit.token.split('.');
    if (state.probe === 'sig') {
      /* The FIRST character of the signature segment, not the last: only the
       * last carries spare bits, so flipping the first leaves the segment
       * canonical base64url and the refusal is about the signature and not
       * about the encoding. */
      var c = segs[2].charAt(0);
      return { token: segs[0] + '.' + segs[1] + '.' + (c === 'A' ? 'B' : 'A') + segs[2].slice(1),
        note: 'one character of the signature segment replaced' };
    }
    if (state.probe === 'payload') {
      /* Re-encoded rather than character-flipped, deliberately: flipping the
       * first character of the payload segment changes the first byte, the JSON
       * stops parsing, and the run stops at E_JSON — which proves nothing about
       * the signature. Rewriting one character INSIDE a value keeps every row
       * above the signature row green, which is the thing worth seeing. */
      var pj = JSON.parse(B.utf8Decode(B.b64uDecodeStrict(segs[1])));
      pj.role = String(pj.role).slice(0, -1) + 'q';
      var seg = B.b64uEncode(B.utf8Encode(JSON.stringify(pj)));
      return { token: segs[0] + '.' + seg + '.' + segs[2],
        note: 'the payload rewritten (role "' + F.legit.payload.role + '" became "' + pj.role +
          '") and the original signature kept' };
    }
    return { token: F.legit.token, note: 'the legitimate token, exactly as the issuer produced it' };
  }

  function refreshVerify() {
    var subtle = api(), F = state.fx;
    if (!subtle || !F) return;
    var pt = probeToken();
    var pinned = state.probe === 'alg' ? 'HS256' : 'ES256';
    var esPub = JSON.parse(F.keys.es.pubJwkText);
    var expA = FX.expectation({ alg: pinned, jwk: esPub });
    var expB = FX.expectation({ alg: pinned, jwk: null });
    var out = { token: pt.token, note: pt.note, pinned: pinned, probe: state.probe };
    /* ROUTE A — SAHIH_JOSE.verifyStrict: this lab's decoder, a CryptoKey it
     *           imported from the JWK object, sixteen rows.
     * ROUTE B — SAHIH_PERIKSA.check: the token re-split from the string, its own
     *           decoder, the JWK re-parsed from JSON text and re-imported,
     *           fifteen rows. Different row COUNT, different row INDEX for the
     *           signature — 9 on route A, 8 on route B — so a card that assumed
     *           a shared index would be wrong rather than merely fragile. */
    J.verifyStrict(subtle, pt.token, expA).then(function (a) {
      out.a = a;
      return PK.check(subtle, pt.token, F.keys.es.pubJwkText, expB);
    }).then(function (b2) {
      out.b = b2;
      return J.verifyNaive(subtle, pt.token, { 'k_FIKTIF_es': esPub, 'default': esPub });
    }).then(function (n) {
      out.naive = n;
      state.verify = out;
      renderIfVisible('verify');
      say(out.note + '. Route A ' + (out.a.ok ? 'accepted' : 'refused with ' + out.a.code) +
        '; route B ' + (out.b.ok ? 'accepted' : 'refused with ' + out.b.code) + '.');
    })['catch'](function (e) {
      state.verify = { error: String(e && e.name || '') + ' ' + String(e && e.message || e) };
      renderIfVisible('verify');
    });
  }

  /* The naive verifier has three checks and no list, so its list is built here
   * from the one string it returns. Nothing is inferred that it did not say:
   * `why` names the check that stopped it, and every row after that one is not
   * reached. */
  function naiveRows(n) {
    var rows = [
      { name: 'split on "." and refuse unless there are three segments', code: 'segments' },
      { name: 'base64url-decode segment 0 and JSON.parse it', code: 'header' },
      { name: 'verify under the algorithm and the key the TOKEN named', code: 'signature' }
    ];
    var stopAt = -1, i;
    for (i = 0; i < rows.length; i++) if (rows[i].code === n.why || (n.why === 'key' && i === 2)) stopAt = i;
    var unsecured = String(n.why).indexOf('alg=none') === 0;
    return rows.map(function (r, ix) {
      if (unsecured && ix === 2) {
        return { name: r.name, ok: null, reached: false, skipped: false, code: null,
          saw: 'the alg=none branch returned before this line' };
      }
      /* Only the last row is the one the verdict came from. Painting `why` into
       * all three made the split and the JSON parse both report "signature
       * verified under …", which is a row claiming to have observed something
       * it never looked at — the exact misreading the strict list's "not
       * reached" state exists to prevent. */
      if (stopAt === -1) {
        return { name: r.name, ok: true, reached: true, skipped: false, code: null,
          saw: ix === rows.length - 1 ? n.why : 'passed' };
      }
      if (ix < stopAt) return { name: r.name, ok: true, reached: true, skipped: false, code: null, saw: 'passed' };
      if (ix === stopAt) return { name: r.name, ok: false, reached: true, skipped: false, code: n.why, saw: n.why };
      return { name: r.name, ok: null, reached: false, skipped: false, code: null, saw: 'not reached' };
    });
  }

  /* Every row in verifyStrict's list that the naive verifier has no counterpart
   * for. Computed by name, from the arrays themselves, so it cannot drift. */
  function whatNaiveNeverLooksAt(checks) {
    var covered = { 'three segments': 1, 'header parses as a JSON object': 1, 'signature verifies': 1 };
    return checks.filter(function (c) { return !covered[c.name]; }).map(function (c) { return c.name; });
  }

  function measureClock() {
    /* The visitor's clock, measured at render time and never in prose. Branded
     * __waktu__ so that no assertion in this lab can take it as an operand even
     * by accident — the suite's third tripwire fails loudly if one tries. */
    var N = 2000, samples = new Array(N), i, distinct = {}, d = 0, minDelta = null, nonZero = 0;
    for (i = 0; i < N; i++) samples[i] = root.performance && root.performance.now ? root.performance.now() : 0;
    for (i = 0; i < N; i++) if (!distinct[samples[i]]) { distinct[samples[i]] = 1; d++; }
    for (i = 1; i < N; i++) {
      var delta = samples[i] - samples[i - 1];
      if (delta > 0) { nonZero++; if (minDelta === null || delta < minDelta) minDelta = delta; }
    }
    var spinPerf = 0, t0 = root.performance && root.performance.now ? root.performance.now() : 0;
    while (root.performance && root.performance.now && root.performance.now() === t0 && spinPerf < 5000000) spinPerf++;
    var spinDate = 0, d0 = Date.now();
    while (Date.now() === d0 && spinDate < 5000000) spinDate++;
    return {
      __waktu__: true, n: N, distinct: d, nonZeroDeltas: nonZero,
      minNonZeroDelta: minDelta, spinBeforePerformanceNowMoves: spinPerf,
      spinBeforeDateNowMoves: spinDate,
      mean: 0, samples: [],
      crossOriginIsolated: !!root.crossOriginIsolated,
      sharedArrayBuffer: typeof root.SharedArrayBuffer !== 'undefined'
    };
  }

  /* Route B's refusals, driven from this file on purpose. Agreement on good
   * input is worth nothing on its own: if periksa.js could be handed the same
   * objects jose.js holds, it would not be a second route. Each of these is a
   * SYNCHRONOUS throw from periksa.js carrying its own message, and the message
   * is periksa's own — not Chromium's — which is what makes it quotable. */
  function probeFirewall() {
    var subtle = api(), F = state.fx;
    if (!subtle || !F) { state.firewall = null; return; }
    var rows = [];
    function attempt(label, fn) {
      try {
        var r = fn();
        if (r && typeof r.then === 'function') {
          /* It returned a promise instead of throwing, which is a pass this
           * panel must not silently claim. Swallow it — a dropped rejection is
           * a pageerror — and record what happened. */
          r['catch'](function () { });
          rows.push({ label: label, refused: false, message: 'it returned a promise instead of refusing' });
          return;
        }
        rows.push({ label: label, refused: false, message: 'it did not refuse' });
      } catch (e) {
        rows.push({ label: label, refused: e && e.periksaRefusal === true, message: String(e && e.message || e) });
      }
    }
    var tok = F.legit.token, expB = FX.expectation({ jwk: null });
    attempt('a token that is not a string', function () { return PK.check(subtle, 42, F.keys.es.pubJwkText, expB); });
    attempt('a JWK with no kty member', function () { return PK.check(subtle, tok, '{"x":"no kty here"}', expB); });
    attempt('a private JWK offered as a verification key', function () { return PK.check(subtle, tok, F.keys.es.privJwkText, expB); });
    attempt('the verification key hidden inside the expectation', function () {
      return PK.check(subtle, tok, F.keys.es.pubJwkText, FX.expectation({ jwk: JSON.parse(F.keys.es.pubJwkText) }));
    });
    attempt('a promise where a settled value belongs', function () {
      return PK.check(subtle, tok, F.keys.es.pubJwkText, FX.expectation({ jwk: null, now: Promise.resolve(1) }));
    });
    attempt('a wall-clock measurement offered as a fact', function () {
      return PK.check(subtle, tok, F.keys.es.pubJwkText, FX.expectation({ jwk: null, now: state.waktu }));
    });
    attempt('an unsecured token handed to the recompute route', function () {
      return PK.checkAs(subtle, 'none', F.keys.es.pubJwkText, tok);
    });
    /* The one that needs a real object: a live CryptoKey, which is exactly the
     * thing route A holds and route B must never be given. */
    J.importJwk(subtle, JSON.parse(F.keys.es.pubJwkText), 'ES256', ['verify']).then(function (key) {
      attempt('a live CryptoKey out of the lab\'s own key cache', function () { return PK.check(subtle, tok, key, expB); });
      state.firewall = rows;
      renderIfVisible('verify');
    })['catch'](function () {
      state.firewall = rows;
      renderIfVisible('verify');
    });
  }

  function renderVerify(p) {
    p.appendChild(h('h2', { text: 'Periksa — the checklist, one row per check' }));
    if (!needFixture(p, 'the token and both verifiers')) return;
    var F = state.fx;
    if (!state.verify) refreshVerify();
    if (!state.firewall) probeFirewall();

    var c = card('One thing changed at a time, and the list answers in one place',
      'Each button below alters exactly one thing about the input or the endpoint\'s configuration. A ' +
      'checklist that reddens everywhere at once is one boolean wearing sixteen labels, so the interesting ' +
      'part of this card is which rows do NOT move.');
    c.appendChild(h('div', { class: 'controls no-print' },
      btn('The legitimate token', function () { state.probe = 'clean'; refreshVerify(); }, 'small' + (state.probe === 'clean' ? ' primary' : ''), 'verify:reset'),
      btn('Flip one character of the signature', function () { state.probe = 'sig'; refreshVerify(); }, 'small' + (state.probe === 'sig' ? ' primary' : ''), 'verify:sig'),
      btn('Rewrite one character of the payload', function () { state.probe = 'payload'; refreshVerify(); }, 'small' + (state.probe === 'payload' ? ' primary' : ''), 'verify:payload'),
      btn('Pin the endpoint to HS256', function () { state.probe = 'alg'; refreshVerify(); }, 'small' + (state.probe === 'alg' ? ' primary' : ''), 'verify:alg')));

    var vv = state.verify;
    if (!vv) { c.appendChild(h('div', { class: 'empty', text: 'Verifying…' })); p.appendChild(c); return; }
    if (vv.error) { c.appendChild(callout('bad', 'Neither route could be run.', vv.error)); p.appendChild(c); return; }

    c.appendChild(h('p', { class: 'note' }, h('b', { text: 'Input: ' }), vv.note,
      '. The endpoint is pinned to ', h('code', { text: vv.pinned }), '.'));
    c.appendChild(tokenTriple(vv.token, F.legit.token.split('.')));
    c.appendChild(h('p', { class: 'hint',
      text: 'A segment with a rule down its left edge is byte-identical to the legitimate token\'s; the other ' +
        'colour means it differs. Both are stated by the border and by this sentence, because a colour alone ' +
        'is not a claim.' }));

    c.appendChild(h('h4', { text: 'Route A — SAHIH_JOSE.verifyStrict, ' + vv.a.checks.length + ' rows' }));
    c.appendChild(checkRows(vv.a.checks));
    c.appendChild(verdictLine(vv.a, 'route A'));

    c.appendChild(h('h4', { text: 'Route B — SAHIH_PERIKSA.check, ' + vv.b.checks.length + ' rows' }));
    c.appendChild(checkRows(vv.b.checks));
    c.appendChild(verdictLine(vv.b, 'route B'));

    var agree = (vv.a.ok === vv.b.ok) && (String(vv.a.code) === String(vv.b.code));
    c.appendChild(h('div', { class: 'summary' },
      stat('route A', vv.a.ok ? 'accepted' : String(vv.a.code), vv.a.ok ? 'no row refused' : 'row ' + vv.a.failedAt + ' of ' + vv.a.checks.length),
      stat('route B', vv.b.ok ? 'accepted' : String(vv.b.code), vv.b.ok ? 'no row refused' : 'row ' + vv.b.failedAt + ' of ' + vv.b.checks.length),
      stat('agreement', agree ? 'agree' : 'DIFFER', 'same verdict and the same code'),
      stat('shared bottom', vv.b.sharedBottom, 'the one thing both routes do call')));
    c.appendChild(h('p', { class: 'hint',
      text: 'The two routes differ in decoding, in parsing, in key caching and in claim extraction, and they ' +
        'both bottom out in the same crypto.subtle.verify. There is no second signature implementation in a ' +
        'browser, and pretending otherwise would be the exact vice this page attacks. The frozen RFC vectors ' +
        'on the Rujukan tab are the only genuinely external oracle in this lab. Note also that the signature ' +
        'row is row 9 on route A and row 8 on route B: the lists are not the same list, and a card that ' +
        'shared an index between them would be wrong rather than merely brittle.' }));
    c.appendChild(terminal('the line that answers, and the rows that do not move',
      h('span', null,
        h('span', { class: vv.a.ok ? 'v-accepted' : 'v-refused',
          text: vv.a.ok ? 'accepted, and every row above says why. ' : vv.a.code + ' at row ' + vv.a.failedAt + ' of ' + vv.a.checks.length + '. ' }),
        vv.a.ok ? 'Change one thing with a button above and exactly one row should move.'
          : vv.a.reason + ' Everything above that row passed, and everything below it is marked not reached ' +
            'rather than counted as a pass — which is the difference between a checklist and one boolean.')));
    p.appendChild(c);

    /* ---- the naive verifier's three rows, and the difference ---- */
    var nc = card('The same token through the vulnerable verifier, whose list is three rows long',
      'This is the diff this whole lab is about. Not "one verifier is better" — the shape of what the ' +
      'short list never asks.');
    nc.appendChild(checkRows(naiveRows(vv.naive)));
    nc.appendChild(h('p', { class: 'note' }, h('b', { text: 'Naive verdict: ' }),
      verdictPill(vv.naive.ok), ' ', h('span', { class: vv.naive.ok ? 'v-accepted' : 'v-refused', text: vv.naive.why })));
    var missing = whatNaiveNeverLooksAt(vv.a.checks);
    nc.appendChild(h('p', { class: 'note', text: 'What the short list never looks at — ' + missing.length +
      ' of route A\'s ' + vv.a.checks.length + ' rows:' }));
    var ul = h('ul', { class: 'refuses' });
    missing.forEach(function (m) { ul.appendChild(h('li', { text: m })); });
    nc.appendChild(ul);
    nc.appendChild(terminal('the difference, in one sentence',
      h('span', null, h('b', { text: 'The short verifier is not broken at signature checking. ' }),
        'It refuses a corrupt signature, a truncated token and a header that is not JSON — the Palsu tab ' +
        'shows it doing all three before it is shown taking a forgery. What it does not do is decide the ' +
        'algorithm, decide the key, or ask a single question about the claims, and every one of the ' +
        missing.length + ' rows above is a decision that has to be made somewhere.')));
    p.appendChild(nc);

    /* ---- the firewall ---- */
    if (state.firewall) {
      var fc = card('What route B refuses to be handed',
        'Two routes that agree on good input have proved nothing if one can be fed the other\'s objects. ' +
        'periksa.js takes a token as a string and a key as JSON text, and refuses everything else with its ' +
        'own message — not with a TypeError from somewhere deeper.');
      var frows = state.firewall.map(function (r) {
        return h('tr', null,
          h('td', null, predictionMark(r.refused), ' ', r.label),
          h('td', null, r.refused ? pill('refused', 'refused') : pill('NOT REFUSED', 'bad')),
          h('td', null, tokenbox(r.message)));
      });
      fc.appendChild(tableOf(['what this page tried to hand it', 'outcome', 'periksa.js\'s own words'], frows,
        { prose: true, minWidth: '700px' }));
      fc.appendChild(terminal('why this panel exists',
        h('span', null, h('b', { text: 'Every row here is a refusal this repository wrote. ' }),
          'None of them is a browser behaviour, which is what makes them assertable: the suite pins these ' +
          'messages, and it pins no Chromium wording anywhere.')));
      p.appendChild(fc);
    }

    /* ---- the clock ---- */
    var wc = card('Your clock, measured when this tab rendered',
      'Not mine, and not the README\'s. These figures come from the browser you are reading this in, and ' +
      'they are the reason this page ships no timing attack.');
    var w = state.waktu;
    if (!w) {
      wc.appendChild(h('div', { class: 'empty', text: 'Not measured.' }));
    } else {
      /* num() groups thousands with a dot, which is this portfolio's house
       * style and is fine on a row of counts. It is NOT fine here: "2.000
       * samples" and "1.824 spins" sit one tile away from "0.0999… ms", and a
       * reader who takes the dot for a decimal point reads two as the sample
       * count on the one card whose argument is that a number needs to be read
       * exactly. These five are printed unseparated for that reason. */
      wc.appendChild(h('div', { class: 'summary' },
        stat('samples', String(w.n), 'back-to-back performance.now() calls'),
        stat('distinct values', String(w.distinct), 'out of ' + String(w.n)),
        stat('smallest non-zero step', w.minNonZeroDelta === null ? 'none observed' : String(w.minNonZeroDelta) + ' ms',
          String(w.nonZeroDeltas) + ' of ' + String(w.n - 1) + ' consecutive pairs moved at all'),
        stat('spin before it moves', String(w.spinBeforePerformanceNowMoves), 'iterations of an empty loop'),
        stat('spin before Date.now moves', String(w.spinBeforeDateNowMoves), 'the coarser of the two clocks'),
        stat('crossOriginIsolated', String(w.crossOriginIsolated), 'SharedArrayBuffer: ' + String(w.sharedArrayBuffer))));
      wc.appendChild(h('p', { class: 'note',
        text: 'A better clock needs crossOriginIsolated, which needs COOP and COEP response headers, and ' +
          'GitHub Pages cannot set response headers. So this page can never have one, no matter what it ' +
          'does. A real measurement takes roughly a thousand batched repetitions per sample and a rank test ' +
          'that handles heavy ties — stated here rather than run, because a timing result from this clock ' +
          'would be a number with no meaning wearing the clothes of evidence.' }));
      wc.appendChild(h('p', { class: 'hint',
        text: 'This measurement is branded __waktu__ inside the lab, and every assertion helper in the suite ' +
          'inspects its operands for that brand and fails loudly if one arrives. That is how "no assertion ' +
          'pins a timing" is enforced rather than promised.' }));
    }
    wc.appendChild(terminal('the limit, stated',
      h('span', null, h('b', { text: 'Nothing on this page is a constant-time comparison. ' }),
        'crypto.subtle.verify performs the signature comparison and this page cannot see inside it. There ' +
        'is no crypto.subtle.timingSafeEqual: SubtleCrypto.prototype has ' + F.subtleMethods.length +
        ' members and it is not among them.')));
    p.appendChild(wc);

    /* ---- capability boundary ---- */
    var cc = card('What this browser will not do, as observed data',
      'These are Chromium\'s refusals, not this lab\'s. The names are stable enough to assert; the wording ' +
      'is Chromium\'s and carries no stability contract, so it is printed and never pinned.');
    /* Two of these thirteen rows carry no assertion, and the column used to
     * say all thirteen did. One is Chromium's own refusal of a private JWK,
     * which the lab is forbidden to pin because it then makes its own
     * E_PRIVATE_KEY rule instead; the other answers a different err.name under
     * node than under Chromium. A header that overstates the pin by two rows on
     * the tab that exists to separate observed data from asserted data is the
     * exact error this tab is about, so the pin is marked per row from the
     * fixture rather than announced once at the top. */
    var unpinned = 0;
    var crows = F.capability.map(function (r) {
      if (!r.asserted) unpinned++;
      return h('tr', null,
        h('td', null, tokenbox(r.call)),
        h('td', null, r.threw ? pill(r.name, 'refused') : pill('did not throw', 'accepted')),
        h('td', null, r.asserted ? pill('pinned', 'pinned') : pill('not pinned', 'inapplicable')),
        h('td', { class: 'small', text: r.message }));
    });
    cc.appendChild(tableOf(['the call', 'err.name', 'in the suite?', 'the message — printed, never asserted'],
      crows, { prose: true, minWidth: '760px' }));
    cc.appendChild(h('p', { class: 'hint',
      text: (F.capability.length - unpinned) + ' of the ' + F.capability.length + ' names above are pinned by ' +
        'an assertion. The other ' + unpinned + ' are printed and nothing more: one is Chromium\'s refusal of a ' +
        'private JWK offered for verification, which this lab answers with a rule of its own instead of ' +
        'borrowing the browser\'s, and one answers a different name under node than under Chromium. Both would ' +
        'be assertions about somebody else\'s code.' }));
    cc.appendChild(h('p', { class: 'hint',
      text: 'Argon2id, scrypt, bcrypt, BLAKE2b, SHA3-256 and MD5 are all Unrecognized name here. That is why ' +
        'this page runs no PBKDF2 cost curve and ships no password panel: the only memory-hard function a ' +
        'browser could offer, it does not offer. WebAuthn: ' + state.webauthn + '.' }));
    cc.appendChild(terminal('and the honest reading of it',
      h('span', null, h('b', { text: 'A capability table is not a security property. ' }),
        'It says what this build of one browser refuses today. The suite asserts err.name and at most one ' +
        'lowercase substring, because a browser release must not be able to turn this lab red for a reason ' +
        'that has nothing to do with its code.')));
    p.appendChild(cc);
  }
  RENDER.verify = renderVerify;

  /* ============================================================= PALSU === */

  /* Route B for the ladder, driven from this file. Read the comment on each
   * entry: two of the five rungs can be independently recomputed from strings
   * this page already holds, one can be recomputed from the key the TOKEN
   * carries, and rung 2 cannot be — and that is said on the card instead of
   * being papered over with a second copy of route A. */
  function probeForge() {
    var subtle = api(), F = state.fx;
    if (!subtle || !F || !F.forge || F.forge.pending) { return; }
    var out = { rung1: null, rung2: null, rung3: null, rung5: null };

    /* RUNG 1. Route A is SAHIH_JOSE.verifyNaive, which took the token. Route B
     * is SAHIH_PERIKSA.checkAs, which REFUSES to verify an unsecured token at
     * all — synchronously, before a key exists. The divergence is the point:
     * one route has an alg=none branch and the other has no such concept. */
    try {
      PK.checkAs(subtle, 'none', F.keys.es.pubJwkText, F.forge.rung1.token);
      out.rung1 = { refused: false, message: 'route B did not refuse' };
    } catch (e) {
      out.rung1 = { refused: e && e.periksaRefusal === true, message: String(e && e.message || e) };
    }

    var seq = Promise.resolve();

    /* RUNG 2. Route B is handed the endpoint's algorithm — RS256 — and the real
     * public JWK as text, which is the whole of C4's correction: subtle.verify
     * takes the algorithm and the key as arguments the token cannot reach. It
     * says false, while route A's naive verifier said yes to one of the six. */
    seq = seq.then(function () {
      var accepted = null, i;
      for (i = 0; i < F.forge.rung2.candidates.length; i++) {
        if (F.forge.rung2.candidates[i].naiveAccepted) accepted = F.forge.rung2.candidates[i];
      }
      if (!accepted) return null;
      return PK.checkAs(subtle, 'RS256', F.keys.rs.pubJwkText, accepted.token).then(function (r) {
        out.rung2 = { candidate: accepted.candidate, ok: r.ok, why: r.why, keySource: r.keySource, sigBytes: r.sigBytes };
      });
    });

    /* RUNG 3. The attacker's public key is inside the token, so route B can be
     * built without this page handing it anything: periksa decodes segment 0
     * with its OWN decoder, and the JWK it finds there is re-serialised and
     * handed back to periksa as text. Route A said the signature verifies;
     * route B agrees, and the agreement is the finding — the token really is
     * correctly signed, by a key nobody authorised. */
    seq = seq.then(function () {
      var hdrText = B.utf8Decode(PK.decode(F.forge.rung3.token.split('.')[0]));
      var hdr = JSON.parse(hdrText);
      return PK.checkAs(subtle, 'ES256', JSON.stringify(hdr.jwk), F.forge.rung3.token).then(function (r) {
        out.rung3 = { ok: r.ok, why: r.why, keySource: r.keySource, decodedBy: 'SAHIH_PERIKSA.decode',
          jwkText: JSON.stringify(hdr.jwk) };
      });
    });

    /* RUNG 5. Two independent arithmetic facts. periksa.addBytes over periksa's
     * OWN copy of n — corrupting either copy must turn this red from its own
     * side, which is why the two copies exist — and periksa.jtiOf, which
     * re-extracts the jti from the payload segment it decoded itself rather
     * than from any claims object the lab already parsed. */
    seq = seq.then(function () {
      var sum = PK.addBytes(F.forge.rung5.sHex, F.forge.rung5.sPrimeHex);
      out.rung5 = {
        sumHex: sum.hex, carry: sum.carry, width: sum.width,
        periksaOrder: PK.P256_N_HEX,
        matchesPeriksaOrder: sum.hex === PK.P256_N_HEX,
        bytesOrder: B.P256_N_HEX,
        twoCopiesAgree: PK.P256_N_HEX === B.P256_N_HEX,
        jtiOriginal: PK.jtiOf(F.forge.rung5.original),
        jtiMalleated: PK.jtiOf(F.forge.rung5.malleated),
        jtiSurvived: PK.jtiOf(F.forge.rung5.original) === PK.jtiOf(F.forge.rung5.malleated)
      };
    });

    seq.then(function () {
      state.forgeB = out;
      renderIfVisible('forge');
    })['catch'](function (e) {
      out.error = String(e && e.name || '') + ' ' + String(e && e.message || e);
      state.forgeB = out;
      renderIfVisible('forge');
    });
  }

  function rung(n, title, defect) {
    var r = h('section', { class: 'rung' });
    r.appendChild(h('div', { class: 'rung-n', text: 'rung ' + n + ' of 5' }));
    r.appendChild(h('h3', { text: title }));
    if (defect) r.appendChild(h('p', { class: 'note', text: defect }));
    return r;
  }

  function refusalTerminal(strict) {
    return terminal('the line that stops it',
      h('span', null,
        h('span', { class: 'v-refused', text: strict.code + ' ' }),
        h('span', { text: 'at check ' + strict.failedAt + ' of ' + strict.checks.length + '. ' }),
        h('span', { text: strict.reason })));
  }

  function renderForge(p) {
    p.appendChild(h('h2', { text: 'Palsu — five rungs, and the line that stops each one' }));
    if (!needFixture(p, 'the five forgeries')) return;
    var F = state.fx;
    if (F.forge.pending) {
      p.appendChild(callout('bad', 'The forger did not load.',
        'fixture.js reports ' + F.forge.pending + ' missing, so this tab has nothing to show. That is a load ' +
        'order problem in index.html, not a state this page can recover from.'));
      return;
    }
    if (!state.forgeB) probeForge();
    var RB = state.forgeB;

    /* ---------------------------------------------------------- rung 1 --- */
    var r1 = rung(1, F.forge.rung1.label,
      'Three lines of tutorial code, and one of them asks the token which algorithm to use. No key is ' +
      'involved in building what it accepts.');

    /* §2.6, and it is above the forgery on purpose: a vulnerable verifier that
     * says yes to everything proves nothing about any attack. */
    /* Counted, never spelled. Every number in this card's prose used to be a
       word — "five bad tokens", "three spellings and misses two" — and a word
       cannot disagree with the table under it, which is exactly the failure a
       page like this one is arguing against. */
    var dRefused = 0, dAccepted = 0, dEngineErr = 0;
    F.discriminate.forEach(function (d) {
      if (d.ok) dAccepted++; else dRefused++;
      if (d.errName) dEngineErr++;
    });
    r1.appendChild(h('h4', { text: 'First: the same short verifier refusing ' + num(dRefused) + ' bad tokens' }));
    var drows = F.discriminate.map(function (d) {
      return h('tr', { class: d.ok === d.expectedAccepted ? null : 'sel' },
        h('td', null, predictionMark(d.ok === d.expectedAccepted), ' ', d.label),
        h('td', null, verdictPill(d.ok)),
        h('td', { class: 'small', text: d.why }),
        h('td', { class: 'small', text: d.errName ? d.errName : 'none' }));
    });
    r1.appendChild(tableOf(['input', 'the naive verifier said', 'why', 'engine error'], drows,
      { prose: true, minWidth: '640px' }));
    r1.appendChild(h('p', { class: 'hint',
      text: num(dRefused) + ' refusals and ' + num(dAccepted) + ' acceptance, and the acceptance is the ' +
        'legitimate token. The function on the next line is not a straw man: it checks the segment count, ' +
        'it parses the header, and it really does verify a signature — every refusal above is its own ' +
        'verdict and not an import that could never have worked, which is what the ' + num(dEngineErr) +
        ' engine errors in that column mean. A row whose key was simply the wrong TYPE would read exactly ' +
        'the same and would prove nothing about signatures.' }));

    r1.appendChild(h('h4', { text: 'Now the token it takes, built by string concatenation with no key at all' }));
    r1.appendChild(tokenTriple(F.forge.rung1.token));
    r1.appendChild(h('p', { class: 'note' }, h('b', { text: 'The naive verifier: ' }),
      verdictPill(F.forge.rung1.naive.ok), ' ',
      h('span', { class: 'v-accepted', text: F.forge.rung1.naive.why }),
      ' — and it read role "' + F.forge.rung1.roleForged + '".'));
    r1.appendChild(h('p', { class: 'note', text: 'The strict verifier\'s list, in full. Rows 1 to ' +
      (F.forge.rung1.strict.failedAt - 1) + ' pass, row ' + F.forge.rung1.strict.failedAt + ' refuses, and ' +
      'every row below it is marked not reached rather than quietly passing:' }));
    r1.appendChild(checkRows(F.forge.rung1.strict.checks));

    var cvAll = F.forge.rung1.caseVariants.length, cvHit = 0, cvMiss = 0;
    F.forge.rung1.caseVariants.forEach(function (r) { if (r.naiveAccepted) cvHit++; else cvMiss++; });
    var cv = h('div');
    cv.appendChild(h('h4', { text: 'A sub-panel that is an admission about my own code' }));
    cv.appendChild(h('p', { class: 'note',
      text: 'The naive verifier\'s unsecured-token branch is a three-way string comparison. Of the ' +
        num(cvAll) + ' spellings tried it accepts ' + num(cvHit) + ' and misses ' + num(cvMiss) + '. This ' +
        'is here as the shape a real library had the bug in, not as a measurement of anything.' }));
    var vrows = F.forge.rung1.caseVariants.map(function (r) {
      return h('tr', null, h('td', null, tokenbox(r.spelling)),
        h('td', null, verdictPill(r.naiveAccepted)), h('td', { class: 'small', text: r.why }));
    });
    cv.appendChild(tableOf(['header alg spelled', 'the naive verifier said', 'why'], vrows, { prose: true }));
    r1.appendChild(cv);

    var da = F.forge.rung1.duplicateAlg;
    r1.appendChild(h('h4', { text: 'And a header whose first eight characters are a lie' }));
    r1.appendChild(tokenbox(da.headerText));
    r1.appendChild(h('div', { class: 'summary' },
      stat('the first characters read', da.firstEightChars, 'which looks pinned to ES256'),
      stat('JSON.parse(...).alg is', da.parsedAlg, 'the last key wins, so this is an unsecured token'),
      stat('the naive verifier', da.naive.ok ? 'accepted' : 'refused', da.naive.why),
      stat('the strict verifier', String(da.strict.code), 'the same refusal, at the same row')));
    if (RB && RB.rung1) {
      r1.appendChild(h('p', { class: 'hint',
        text: 'Route B on this rung is a divergence and not a confirmation: SAHIH_PERIKSA.checkAs has no ' +
          'unsecured branch to have a bug in, and refuses the request before a key exists — "' +
          RB.rung1.message + '". Two routes that both had an alg=none branch would be one route written ' +
          'twice.' }));
    }
    /* Last on the card, and it is the rule §9.3 asks a reviewer to check by eye:
       every card here ends on the line that refuses, never on the attack. */
    r1.appendChild(refusalTerminal(F.forge.rung1.strict));
    p.appendChild(r1);

    /* ---------------------------------------------------------- rung 2 --- */
    var r2 = rung(2, F.forge.rung2.label,
      'The endpoint\'s public key is public. Under a verifier with one key parameter, publishing it hands ' +
      'out the MAC secret as well.');
    r2.appendChild(h('p', { class: 'note' },
      h('b', { text: 'Say this first, because the folk version of this attack is the wrong way round. ' }),
      'crypto.subtle is the one place this attack is structurally impossible: ',
      h('code', { text: 'subtle.verify(algorithm, key, …)' }),
      ' takes both as arguments the token cannot reach. The vulnerable thing is a library API of the shape ',
      h('code', { text: 'jwt.verify(token, keyOrSecret)' }),
      ' — one parameter that is a secret or a public key depending on what the token says. The naive ' +
      'verifier on this page is a hand-built model of that shape, and this rung is a fact about that shape.'));
    var c2rows = F.forge.rung2.candidates.map(function (r) {
      return h('tr', { class: r.naiveAccepted ? 'sel' : null },
        h('td', { text: r.candidate }),
        h('td', { class: 'num', text: num(r.bytes) }),
        h('td', null, r.importsAsRawHmacKey ? pill('imports', 'accepted') : pill(r.errName || 'refused', 'refused')),
        h('td', null, verdictPill(!!r.naiveAccepted)),
        h('td', null, pill(String(r.strictCode), 'refused')));
    });
    r2.appendChild(tableOf(['candidate byte string the attacker tried', { label: 'bytes', num: true },
      'imports as a raw HMAC key', 'the naive verifier said', 'the strict verifier said'],
      c2rows, { prose: true, minWidth: '780px' }));
    r2.appendChild(h('div', { class: 'summary' },
      stat('candidates tried', String(F.forge.rung2.candidateCount), 'plausible serialisations of one public key'),
      stat('accepted', String(F.forge.rung2.acceptedCount), 'the one that matched the stored bytes exactly'),
      stat('the endpoint stores', F.forge.rung2.storedForm, 'chosen by this page, which is why exactly one row matches'),
      stat('DER SPKI', num(F.forge.rung2.spkiBytes) + ' bytes', 'the same key with no PEM wrapper at all')));
    r2.appendChild(h('p', { class: 'hint',
      text: 'The row that works is the one that matched the server\'s stored bytes down to the trailing ' +
        'newline. This is a guessing game with a handful of plausible candidates, not magic — and this page ' +
        'chose which bytes the endpoint stores, so exactly one row had to match. What makes it worth showing ' +
        'is that six is a small number.' }));
    if (RB && RB.rung2) {
      r2.appendChild(h('p', { class: 'note' },
        h('b', { text: 'Route B on this rung, and what it deliberately is not. ' }),
        'The accepted token is handed to SAHIH_PERIKSA.checkAs with the algorithm the ENDPOINT chose (RS256) ' +
        'and the real public key as JWK JSON text. It answers ',
        h('span', { class: RB.rung2.ok ? 'v-accepted' : 'v-refused', text: RB.rung2.ok ? 'accepted' : RB.rung2.why }),
        ' — the accepted token is not a valid RS256 token and never was. What that shows is narrow and worth ' +
        'stating narrowly: the acceptance on the row above survives only while the algorithm is read off the ' +
        'token, and disappears the moment the endpoint names one. It is not evidence about RSA. ' +
        'Route B is not handed the endpoint\'s stored bytes, because a page that ' +
        'reconstructed them here would be a second forger living in the file that draws the screen. That ' +
        'limit is stated rather than hidden behind a second opinion that was really the first one.'));
    }
    r2.appendChild(refusalTerminal({
      code: F.forge.rung2.candidates[0].strictCode,
      failedAt: 5, checks: F.forge.rung1.strict.checks,
      reason: F.forge.rung2.candidates[0].strictReason + ' — on all ' + F.forge.rung2.candidateCount +
        ' candidates, because the algorithm was decided before the token was read.'
    }));
    p.appendChild(r2);

    /* ---------------------------------------------------------- rung 3 --- */
    var r3 = rung(3, F.forge.rung3.label,
      'The attacker needs no secret of yours at all. They bring their own key and put it in the envelope.');
    r3.appendChild(h('p', { class: 'note',
      text: 'The attacker generates their own P-256 pair in their own tab, puts the public half in the header ' +
        'as a jwk member, and signs with the private half. No server secret is involved anywhere, which is ' +
        'what makes this rung real rather than arranged.' }));
    r3.appendChild(tokenTriple(F.forge.rung3.token));
    r3.appendChild(h('p', { class: 'note' }, h('b', { text: 'The naive verifier: ' }),
      verdictPill(F.forge.rung3.naive.ok), ' ',
      h('span', { class: 'v-accepted', text: F.forge.rung3.naive.why }),
      ' — role "' + F.forge.rung3.roleForged + '". It resolves hdr.jwk first, and the signature genuinely ' +
      'verifies, because the attacker held the matching private key.'));
    if (RB && RB.rung3) {
      r3.appendChild(h('p', { class: 'note' },
        h('b', { text: 'Route B, independently: ' }),
        'periksa.js decoded segment 0 with its own decoder, took the JWK it found there, and re-verified from ' +
        'that text alone. It says ',
        h('span', { class: RB.rung3.ok ? 'v-accepted' : 'v-refused', text: RB.rung3.ok ? 'the signature verifies under the bytes the caller supplied' : RB.rung3.why }),
        '. The two routes agree, and the agreement is the finding: the token is correctly signed by a key ' +
        'nobody authorised.'));
      r3.appendChild(tokenbox(RB.rung3.jwkText));
    }
    var sib = F.forge.rung3.siblings.map(function (s) {
      return h('tr', null, h('td', null, tokenbox(s.member)),
        h('td', null, pill(s.code, 'refused')), h('td', { class: 'small', text: s.structuralNote }));
    });
    sib.push(h('tr', null, h('td', null, tokenbox('kid = ' + F.forge.rung3.unknownKid.kid)),
      h('td', null, pill(F.forge.rung3.unknownKid.code, 'refused')),
      h('td', { class: 'small', text: 'the strict verifier does not fall back to a default. The naive one, on ' +
        'this same token — genuinely signed by the endpoint under a kid the keyring has never heard of — ' +
        (F.forge.rung3.unknownKid.naiveAccepted ? 'accepted it: "' + F.forge.rung3.unknownKid.naiveWhy + '". '
          : 'refused it: "' + F.forge.rung3.unknownKid.naiveWhy + '". ') +
        'That single || is the whole difference, and it is run here rather than described' })));
    sib.push(h('tr', null, h('td', null, tokenbox('a JWK carrying d')),
      h('td', null, pill(F.forge.rung3.privateKeyOffered.code, 'refused')),
      h('td', { class: 'small', text: 'this lab\'s own rule, fired before importKey is called: ' +
        String(F.forge.rung3.privateKeyOffered.firedBeforeImportKey) })));
    r3.appendChild(h('p', { class: 'note', text: 'Three siblings and two neighbours, refused by the same part of the list:' }));
    r3.appendChild(tableOf(['header member', 'refused with', 'and the honest reason'], sib, { prose: true, minWidth: '640px' }));
    r3.appendChild(h('p', { class: 'hint',
      text: 'jku and x5u name a URL to fetch a key set from. This page ships connect-src \'none\' and could ' +
        'not fetch one if it wanted to, so the refusal here is free — which is exactly why it is worth ' +
        'pointing at. On a real server that refusal is a decision somebody has to remember to make.' }));
    r3.appendChild(refusalTerminal(F.forge.rung3.strict));
    p.appendChild(r3);

    /* ---------------------------------------------------------- rung 4 --- */
    var r4 = rung(4, F.forge.rung4.label,
      'Nothing here is forged, which is why it has its own tab.');
    r4.appendChild(h('p', { class: 'note' },
      'Six tokens, each signed by this page\'s own real key over a payload this page chose. Nothing is ' +
      'forged: crypto.subtle.verify returns true for all six. They have their own tab because the raw ' +
      'boolean beside a red row is the whole point. ',
      h('button', { type: 'button', class: 'linkbtn', 'data-fkey': 'forge:toclaims',
        onclick: function () { switchTab('claims'); }
      }, 'Open the Klaim tab')));
    r4.appendChild(terminal('the line that stops them',
      h('span', null, h('b', { text: 'Not the signature check. ' }),
        'Six different claim rules, one of which — a maximum lifetime — most verifiers do not have at all.')));
    p.appendChild(r4);

    /* ---------------------------------------------------------- rung 5 --- */
    var r5 = rung(5, F.forge.rung5.label,
      'And this one is not a forgery either. It is the same claims, correctly signed, under a different ' +
      'token string — which is a fact about ECDSA and a problem for anything keyed on that string.');
    var g5 = F.forge.rung5;
    r5.appendChild(h('p', { class: 'note',
      text: 'SAHIH_PALSU.malleate takes a string and nothing else — it can see no key, and its whole ' +
        'signature is malleate(tokenString). It splits, decodes the 64-byte signature, replaces the low 32 ' +
        'bytes s with n − s by byte-wise borrow subtraction, re-encodes, re-joins. It never touches the ' +
        'payload.' }));
    r5.appendChild(h('div', { class: 'segs' },
      segBox('the original token', g5.original),
      segBox('after malleation', g5.malleated)));
    r5.appendChild(tokenTriple(g5.malleated, g5.original.split('.')));
    r5.appendChild(h('div', { class: 'summary' },
      stat('the two token strings', g5.tokensDiffer ? 'differ' : 'IDENTICAL', 'so every string-keyed lookup sees a new token'),
      stat('payload segment', g5.payloadSegmentIdentical ? 'byte-identical' : 'CHANGED', 'the same sub, the same jti, the same role'),
      stat('header segment', g5.headerSegmentIdentical ? 'byte-identical' : 'CHANGED', 'nothing above the signature moved'),
      stat('signature segment', g5.sigSegmentsDiffer ? 'differs' : 'IDENTICAL', 'the only part that changed')));

    r5.appendChild(h('p', { class: 'note' }, h('b', { text: 'Both verifiers, on both tokens. ' }),
      'The strict verifier accepts the malleated token, and it is right to: nothing about the token is ' +
      'wrong.'));
    /* NOT labelled "route B". The naive verifier lives in jose.js beside
     * verifyStrict, so calling it a second route would claim a firewall exactly
     * where there is none — on the one page whose headline is that two routes
     * share no code. Route B on this rung is periksa, and it appears below. */
    r5.appendChild(tableOf(['token', 'route A — SAHIH_JOSE.verifyStrict', 'the naive verifier, same file', 'claims read'], [
      h('tr', null, h('td', { text: 'the original' }), h('td', null, verdictPill(g5.strictOriginal.ok)),
        h('td', { text: '—' }), h('td', { class: 'small', text: 'sub ' + g5.strictOriginal.claims.sub + ', role ' + g5.strictOriginal.claims.role })),
      h('tr', null, h('td', { text: 'the malleated one' }), h('td', null, verdictPill(g5.strictMalleated.ok)),
        h('td', null, verdictPill(g5.naiveMalleated.ok)),
        h('td', { class: 'small', text: 'sub ' + g5.strictMalleated.claims.sub + ', role ' + g5.strictMalleated.claims.role }))
    ], { prose: true, minWidth: '680px' }));

    r5.appendChild(h('h4', { text: 'The arithmetic, and it is checked from two sides' }));
    r5.appendChild(h('div', { class: 'segs' },
      segBox('r — untouched', g5.rHex, 'same'),
      segBox('s — the original low half', g5.sHex, 'differs'),
      segBox('s\' = n − s', g5.sPrimeHex, 'differs')));
    if (RB && RB.rung5) {
      /* ROUTE A — SAHIH_PALSU.malleate computed s' from SAHIH_BYTES.P256_N.
       * ROUTE B — SAHIH_PERIKSA.addBytes adds s and s' over periksa's OWN 32-byte
       *           copy of n. Corrupting either copy turns this red from its own
       *           side; that is the entire reason there are two copies, and each
       *           is compared against the published order rather than against
       *           the other. */
      r5.appendChild(tableOf(['s + s\'', 'value', 'equals the published order'], [
        h('tr', null, h('td', { text: 'route A — SAHIH_BYTES.addBytes, over bytes.js\'s n' }),
          h('td', null, tokenbox(g5.sumHex)),
          h('td', null, g5.sumEqualsOrder ? pill('yes, carry ' + g5.sumCarry, 'pinned') : pill('NO', 'bad'))),
        h('tr', null, h('td', { text: 'route B — SAHIH_PERIKSA.addBytes, over periksa.js\'s own n' }),
          h('td', null, tokenbox(RB.rung5.sumHex)),
          h('td', null, RB.rung5.matchesPeriksaOrder ? pill('yes, carry ' + RB.rung5.carry, 'pinned') : pill('NO', 'bad'))),
        h('tr', null, h('td', { text: 'FIPS 186-4 / SEC 2, the published order n' }),
          h('td', null, tokenbox(RB.rung5.periksaOrder)),
          h('td', null, pill('the oracle', 'pinned')))
      ], { prose: true, minWidth: '740px' }));
      r5.appendChild(h('p', { class: 'hint',
        text: 'periksa.js carries its own copy of n and its own byte adder, and knows exactly one global: ' +
          'itself. grep -o \'SAHIH_[A-Z]*\' labs/sahih/periksa.js | sort -u prints one name. Each copy is ' +
          'compared with the published order and never with the other copy, so corrupting either one turns ' +
          'a row red instead of moving both halves of a difference together.' }));
    }

    r5.appendChild(h('h4', { text: 'What signs the same bytes the same way, and what does not' }));
    var drow = F.determinism.map(function (d) {
      return h('tr', null,
        h('td', null, predictionMark(d.agreesWithExpectation), ' ', d.label),
        h('td', null, d.expectedDeterministic ? pill('deterministic', 'pinned') : pill('randomised', 'info')),
        h('td', null, d.identical ? pill('identical', 'accepted') : pill('different', 'refused')),
        h('td', { class: 'num', text: d.sigBytes === null ? '—' : String(d.sigBytes) }));
    });
    r5.appendChild(tableOf(['algorithm', 'expected', 'two signatures over the same bytes',
      { label: 'bytes', num: true }], drow, { prose: true, minWidth: '600px' }));
    r5.appendChild(h('p', { class: 'hint',
      text: 'And ES256 five times over identical bytes: ' + F.es256Distinct.distinct + ' distinct signatures ' +
        'out of ' + F.es256Distinct.n + '. No assertion in this lab pins an ES256 or PS256 signature to a ' +
        'literal, because a suite that did would pass on the machine that wrote it and fail once, later, on ' +
        'somebody else\'s.' }));

    /* §2.7's layout rule, and §9.3's: the LAST element on the card is the
     * denylist refusing, not the attack. If a reader leaves this card
     * remembering the arithmetic instead of the jti, the card is laid out
     * wrong. */
    var term = h('div', { class: 'terminal' });
    term.appendChild(h('div', { class: 'lead', text: 'the line that stops it, and it is not at the verifier' }));
    term.appendChild(tableOf(['a revocation list keyed on', 'the malleated token', 'why'], [
      h('tr', null, h('td', { text: g5.denylistOnTokenString.keyedOn }),
        h('td', null, pill('ALLOWED', 'bad')),
        h('td', { class: 'small', text: g5.denylistOnTokenString.note + ' — list size ' + g5.denylistOnTokenString.listSize })),
      h('tr', null, h('td', { text: g5.denylistOnJti.keyedOn }),
        h('td', null, pill('REFUSED', 'refused')),
        h('td', { class: 'small', text: g5.denylistOnJti.reason }))
    ], { prose: true, minWidth: '620px' }));
    if (RB && RB.rung5) {
      term.appendChild(h('p', { class: 'small',
        text: 'The jti is re-extracted by SAHIH_PERIKSA.jtiOf from the payload segment it decoded itself: "' +
          RB.rung5.jtiMalleated + '" on the malleated token, "' + RB.rung5.jtiOriginal + '" on the original, ' +
          'identical: ' + String(RB.rung5.jtiSurvived) + '. Route A read it from the claims object the lab ' +
          'already had.' }));
    }
    /* This used to read "four rungs are stopped by one line", which the rung-4
     * terminal three cards above contradicts in as many words: that rung is
     * stopped by six different claim rules, and its tokens are not forgeries at
     * all. Counting them into a "one line" total flatters the verifier and
     * makes the page disagree with itself. */
    term.appendChild(h('p', { class: 'note' },
      h('b', { text: 'Rungs 1 to 3 are each stopped by a single line at the verifier — two of them by the ' +
        'same line, the one that decides the algorithm before reading the token. Rung 4 takes six separate ' +
        'claim rules, one of which most verifiers do not have. ' }),
      'The fifth is not stopped by anything a verifier can do, because nothing is wrong with the token. It ' +
      'is stopped by a decision made somewhere else entirely — key your revocation on a claim inside what ' +
      'was signed — and no amount of care in the verification code would have found it. A signature is not ' +
      'a name. Signature-as-identity was already wrong before malleability arrived; malleability is just ' +
      'the cheapest proof.'));
    term.appendChild(h('p', { class: 'hint',
      text: 'The 2026 answer to this class is a sender-constrained token — DPoP (RFC 9449, 2023) or ' +
        'mutual-TLS-bound (RFC 8705, 2020) — which binds the token to a key the holder must prove ' +
        'possession of on every request. Neither is demonstrable here: both need a server and a second ' +
        'party, and both are named in the not-built list below.' }));
    r5.appendChild(term);
    p.appendChild(r5);
  }
  RENDER.forge = renderForge;

  /* ============================================================= KLAIM === */

  function refreshClaims() {
    var subtle = api(), F = state.fx;
    if (!subtle || !F) return;
    if (state.clockNow === null) state.clockNow = F.meta.now;
    var esPub = JSON.parse(F.keys.es.pubJwkText);
    var rows = F.forge.rung4.rows, out = [], seq = Promise.resolve();
    /* ROUTE A — SAHIH_JOSE.verifyStrict against the clock the slider is at, with
     *           the key it imported from the JWK object.
     * ROUTE B — SAHIH_PERIKSA.check with every claim check disabled, so it
     *           reports the signature bit and nothing else. That is the column
     *           the reader is watching stay true while the row goes red. */
    rows.forEach(function (r) {
      seq = seq.then(function () {
        var expA = FX.expectation({ jwk: esPub, now: state.clockNow });
        return J.verifyStrict(subtle, r.token, expA).then(function (a) {
          return PK.check(subtle, r.token, F.keys.es.pubJwkText,
            FX.expectation({ jwk: null, claims: false, now: state.clockNow })).then(function (b2) {
            out.push({
              label: r.label, token: r.token, subtleVerify: r.subtleVerify,
              expectedCode: r.expectedCode, ok: a.ok, code: a.code, reason: a.reason,
              routeBOk: b2.ok, routeBCode: b2.code, routeBChecks: b2.checks.length,
              /* The payload text and the jti both come out of the RAW segment,
                 decoded by periksa.js — not out of any claims object route A
                 parsed. A revocation check that read the lab's own parsed claims
                 would be checking the lab against itself. */
              jti: PK.jtiOf(r.token),
              payloadJson: B.utf8Decode(PK.decode(r.token.split('.')[1]))
            });
          });
        });
      });
    });
    seq.then(function () {
      state.claims = out;
      renderIfVisible('claims');
    })['catch'](function (e) {
      state.claims = null;
      state.claimsErr = String(e && e.name || '') + ' ' + String(e && e.message || e);
      renderIfVisible('claims');
    });
  }

  function renderClaims(p) {
    p.appendChild(h('h2', { text: 'Klaim — the signature is valid, and the answer is still wrong' }));
    if (!needFixture(p, 'the six claim rows')) return;
    var F = state.fx;
    if (state.clockNow === null) state.clockNow = F.meta.now;
    if (!state.claims) refreshClaims();

    var c = card('Six tokens this page signed itself, over payloads this page chose',
      'Nothing on this card is forged. Each token carries a real signature from the lab\'s own key, and ' +
      'crypto.subtle.verify returns true for every one of them. The boolean is in its own column so that a ' +
      'reader can watch the signature check pass while the row is red.');
    if (state.claimsErr) c.appendChild(callout('bad', 'The rows could not be recomputed.', state.claimsErr));
    if (!state.claims) {
      c.appendChild(h('div', { class: 'empty', text: 'Verifying six tokens…' }));
      p.appendChild(c);
      return;
    }
    var rows = state.claims.map(function (r) {
      return h('tr', { class: r.ok ? 'sel' : null },
        h('td', { text: r.label }),
        h('td', null, r.subtleVerify ? pill('true', 'accepted') : pill('false', 'bad')),
        h('td', null, r.routeBOk ? pill('true', 'accepted') : pill('false', 'bad')),
        h('td', null, r.ok ? pill('accepted', 'accepted') : pill(String(r.code), 'refused')),
        h('td', { class: 'small', text: r.ok ? 'at this clock, nothing refuses it' : r.reason }));
    });
    c.appendChild(tableOf(['token', 'route A — subtle.verify', 'route B — signature bit only',
      'the strict verdict', 'the reason, in the lab\'s own words'], rows, { prose: true, minWidth: '860px' }));
    /* The payloads live under the table rather than in it: a pre.tokenbox is
       white-space:pre and will not shrink, so a sixth column of them squeezes
       every other column into one character per line. Measured at 1360px before
       this was moved. */
    c.appendChild(h('p', { class: 'note',
      text: 'And the six payloads, each decoded out of its own raw segment by periksa.js — not read off any ' +
        'claims object route A had already parsed:' }));
    var payloads = h('div', { class: 'segs' });
    state.claims.forEach(function (r) { payloads.appendChild(segBox(r.label, r.payloadJson)); });
    c.appendChild(payloads);
    c.appendChild(h('p', { class: 'hint',
      text: 'Route B is SAHIH_PERIKSA.check with every claim row switched off — ' +
        (state.claims[0] ? state.claims[0].routeBChecks : 15) + ' rows configured, the claim ones skipped — ' +
        'so it reports the signature and nothing else, from a token it re-split and a JWK it re-parsed from ' +
        'text. Two files, one boolean, and it is true on all six.' }));
    c.appendChild(terminal('the line that stops them',
      h('span', null, h('b', { text: 'Six red rows, and not one of them is a signature failure. ' }),
        'The signature check passed every time. What refused was a claim rule the endpoint decided on ' +
        'before it ever saw a token.')));
    p.appendChild(c);

    /* ---- the clock, which is a control and not a decoration ---- */
    var slider = h('input', {
      type: 'range', min: String(F.meta.now - 7200), max: String(F.meta.now + 7200), step: '30',
      value: String(state.clockNow), 'data-fkey': 'claims:clock',
      'aria-label': 'the injected clock, in seconds',
      oninput: function (e) {
        state.clockNow = parseInt(e.target.value, 10);
        var read = $('clockRead');
        if (read) read.textContent = clockLabel();
      },
      onchange: function (e) {
        state.clockNow = parseInt(e.target.value, 10);
        refreshClaims();
        say('Clock moved to ' + clockLabel() + '.');
      }
    });
    var kc = card('The clock is an injected number, and it is a control',
      'Every claim check on this page reads expect.now, which is an argument. Date.now() is not called in ' +
      'jose.js, palsu.js, periksa.js, fixture.js or tests.js at all. Drag this and watch which rows change ' +
      'their minds — a table that is really a static image cannot do that.');
    kc.appendChild(field('expect.now', slider));
    kc.appendChild(h('p', { class: 'note', id: 'clockRead', text: clockLabel() }));
    kc.appendChild(h('div', { class: 'controls no-print' },
      btn('Back to the fixture clock', function () {
        state.clockNow = F.meta.now; refreshClaims(); say('Clock back to the fixture value.');
      }, 'small ghost', 'claims:clockreset'),
      btn('One hour later', function () {
        state.clockNow = F.meta.now + 3600; refreshClaims(); say('Clock moved an hour forward.');
      }, 'small ghost', 'claims:clockfwd')));
    kc.appendChild(terminal('why the clock is an argument',
      h('span', null, h('b', { text: 'A table that cannot change its mind is a screenshot. ' }),
        'Drag the slider below exp and the expired row goes green; drag it below nbf and a different row goes ' +
        'red. Neither could happen if the clock were read from the machine, and neither could be asserted in ' +
        'CI on somebody else\'s hardware.')));
    p.appendChild(kc);

    /* ---- the ms-exp two facts ---- */
    var ms = F.forge.rung4.msExpWithoutLifetimeRule;
    /* Read out of the fixture and converted here rather than typed. It was
     * typed once, as "the year 58579", and the real answer is 58661 — a
     * falsifiable number, invented, on the one page whose argument is that
     * every number on it came from a run. */
    var msYear = ms && typeof ms.expSeconds === 'number'
      ? new Date(ms.expSeconds * 1000).getUTCFullYear() : null;
    var mc = card('The row that is caught by a rule most verifiers do not have',
      'A token whose exp was written in milliseconds expires' +
      (msYear ? ' in the year ' + msYear : ' tens of thousands of years from now') +
      '. The expiry check does not catch it — the expiry check passes. These are two separate facts ' +
      'and they are asserted separately.');
    mc.appendChild(tableOf(['the endpoint\'s configuration', 'verdict', 'code', 'reason'], [
      h('tr', null, h('td', { text: 'no maximum-lifetime rule' }),
        h('td', null, verdictPill(ms.withoutMaxLifetime.ok)),
        h('td', { text: String(ms.withoutMaxLifetime.code) }),
        h('td', { class: 'small', text: 'the expiry check passes: ' + String(ms.expiryCheckPasses) })),
      h('tr', null, h('td', { text: 'a ' + F.meta.maxLifetimeSec + '-second maximum lifetime' }),
        h('td', null, verdictPill(ms.withMaxLifetime.ok)),
        h('td', null, pill(String(ms.withMaxLifetime.code), 'refused')),
        h('td', { class: 'small', text: ms.withMaxLifetime.reason }))
    ], { prose: true, minWidth: '700px' }));
    mc.appendChild(terminal('the line that stops it',
      h('span', null,
        h('span', { class: 'v-refused', text: String(ms.withMaxLifetime.code) + ' '}),
        'and not the expiry check, which passed. Two separate facts, asserted separately, because a suite ' +
        'that only checked "it was refused" would be green with the wrong rule doing the work.')));
    p.appendChild(mc);

    /* ---- revocation ---- */
    var rc = card('Revocation, and the price of each way of doing it',
      'One Map in one process, with no replication lag and no cache. The hard version — a denylist read by ' +
      'twelve API instances behind a load balancer with a thirty-second cache TTL — is where revocation ' +
      'actually fails, and it needs the thing this page does not have.');
    var remaining = F.legit.payload.exp - state.clockNow;
    rc.appendChild(h('div', { class: 'controls no-print' },
      btn(state.revoked ? 'This jti is revoked — put it back' : 'Revoke this token\'s jti', function () {
        state.revoked = !state.revoked;
        rerender();
        say(state.revoked ? 'The jti is on the denylist. The stateless route has not noticed.'
          : 'The denylist is empty again.');
      }, 'small' + (state.revoked ? ' danger' : ''), 'claims:revoke')));
    rc.appendChild(h('div', { class: 'summary' },
      stat('the jti', F.meta.revokedJti, 'read out of the signed payload, not off the token string'),
      stat('opaque-store route', state.revoked ? 'denied on the next call' : 'allowed',
        'one store write, effective immediately'),
      stat('stateless route', state.revoked ? (remaining > 0 ? 'still works for ' + num(remaining) + ' s' : 'expired anyway')
        : 'allowed', 'nothing to write to; it works until exp'),
      stat('exp − now', num(remaining) + ' s', 'move the slider above and this moves with it')));
    rc.appendChild(tableOf(['mitigation', { label: 'store reads per request', num: true }, 'what it buys'], [
      h('tr', null, h('td', { text: 'short exp plus a refresh token' }), h('td', { class: 'num', text: '0' }),
        h('td', { class: 'small', text: 'the token still works for exp − now, which is exactly the window above' })),
      h('tr', null, h('td', { text: 'a jti denylist' }), h('td', { class: 'num', text: '1' }),
        h('td', { class: 'small', text: 'refused immediately, and the cost grows with the number of outstanding tokens' })),
      h('tr', null, h('td', { text: 'a token_version claim' }), h('td', { class: 'num', text: '1' }),
        h('td', { class: 'small', text: 'refused, and it is a read of the USER record — so the cost does not grow with outstanding tokens' }))
    ], { prose: true, minWidth: '700px' }));
    rc.appendChild(h('p', { class: 'hint',
      text: 'Each price is one store read per request, which is the thing statelessness was supposed to buy. ' +
        'That is the trade, stated as a number rather than as a preference.' }));
    rc.appendChild(terminal('the line that stops it',
      h('span', null,
        h('span', { class: 'v-refused', text: F.forge.rung5.denylistOnJti.code + ' ' }),
        F.forge.rung5.denylistOnJti.reason +
        ' — keyed on a claim inside what was signed, which is the only key that survives the last rung of the Palsu tab.')));
    p.appendChild(rc);
  }
  RENDER.claims = renderClaims;

  function clockLabel() {
    var F = state.fx;
    if (!F) return '';
    var d = state.clockNow - F.meta.now;
    return 'expect.now = ' + state.clockNow + ' (' + (d === 0 ? 'the fixture\'s own clock' :
      (d > 0 ? '+' + num(d) + ' s' : '−' + num(-d) + ' s') + ' from it') + '). Nothing here reads the wall clock.';
  }

  /* =========================================================== RUJUKAN === */

  /* ROUTE A — this lab's own composition: bytes.js encodes, jose.js concatenates
   *           and signs, and the result is the "computed" column.
   * ROUTE B — the frozen literal in vectors.js, which is a file with no code in
   *           it at all, plus SAHIH_PERIKSA.decode over each computed segment so
   *           the byte comparison does not route through this lab's decoder
   *           twice. */
  function probeVectors() {
    var F = state.fx;
    if (!F) return;
    var rows = [];
    function row(label, computedSeg, publishedSeg) {
      var a = null, b2 = null, err = null;
      try { a = B.hex(B.b64uDecodeStrict(computedSeg)); } catch (e) { err = String(e && e.message || e); }
      try { b2 = PK.hexOf(PK.decode(publishedSeg)); } catch (e2) { err = String(e2 && e2.message || e2); }
      rows.push({ label: label, routeA: a, routeB: b2, agree: a !== null && a === b2, error: err,
        bytes: a === null ? null : a.length / 2 });
    }
    row('RFC 7515 A.1 header segment', F.vectors.a1.headerSegComputed, V.JWS_A1.headerSeg);
    row('RFC 7515 A.1 payload segment', F.vectors.a1.payloadSegComputed, V.JWS_A1.payloadSeg);
    row('RFC 7515 A.2 header segment', F.vectors.a2.headerSegComputed, V.JWS_A2.headerSeg);
    row('RFC 7515 A.2 signature', F.vectors.a2.signatureComputed, V.JWS_A2.signature);
    row('RFC 7515 A.3 header segment', F.vectors.a3.headerSegComputed, V.JWS_A3.headerSeg);
    row('RFC 7515 A.3 published signature', V.JWS_A3.signature, V.JWS_A3.signature);
    state.vectorsB = rows;
  }

  function eqPill(same) { return same ? pill('=', 'pinned') : pill('≠', 'refused'); }

  /* The figures come out of the run object or they are not printed at all.
     Counting the rows on screen and calling the total "executions" would be a
     number this file invented, on the one tab whose whole job is being an
     external oracle. */
  function vectorGroupNote() {
    var r = state.tests, i, g = null;
    if (r && r.byGroup) {
      for (i = 0; i < r.byGroup.length; i++) if (r.byGroup[i].group.indexOf('G10') === 0) g = r.byGroup[i];
    }
    if (!g) return 'A handful of properties cover every published row on this tab';
    return 'In this suite ' + g.properties + ' properties cover all ' + g.executions +
      ' of the vector executions';
  }

  function renderVectors(p) {
    p.appendChild(h('h2', { text: 'Rujukan — the only external oracle in this lab' }));
    if (!needFixture(p, 'the published vectors')) return;
    var F = state.fx;
    if (!state.vectorsB) probeVectors();

    var intro = card('Published value beside this page\'s computation, per row',
      'Every table on this tab pins this lab\'s own composition — my base64url, my signing-input ' +
      'concatenation, my compact serialisation, my counter framing, my dynamic truncation. None of them is ' +
      'a test of HMAC or of RSA. A published vector that only proved Chromium works would be four hundred ' +
      'free assertions and no evidence.');
    intro.appendChild(h('p', { class: 'hint', id: 'vectors-top',
      text: 'The published column is a literal in vectors.js, a file with no code in it. Where a byte ' +
        'comparison appears, the computed segment is decoded a second time by periksa.js\'s own decoder, so ' +
        'the comparison does not pass through this lab\'s decoder twice.' }));
    intro.appendChild(terminal('what a published vector is allowed to prove here',
      h('span', null, h('b', { text: 'No assertion in this suite may have the Web Crypto API\'s own correctness as its subject. ' }),
        'RFC 4231 and RFC 6238 together would yield four hundred free assertions in an afternoon and would ' +
        'report a number proving Chromium works. ' + vectorGroupNote() + ' — which is why properties and ' +
        'executions are printed as separate figures everywhere on this page.')));
    p.appendChild(intro);

    /* ---- RFC 7515 ---- */
    var jc = card('RFC 7515 — JSON Web Signature, Appendices A.1, A.2, A.3');
    var a1 = F.vectors.a1, a2 = F.vectors.a2, a3 = F.vectors.a3;
    jc.appendChild(h('h4', { text: a1.rfc + ' ' + a1.section + ' — HS256' }));
    jc.appendChild(tableOf(['what', 'published', 'computed here', ''], [
      h('tr', null, h('td', { text: 'header segment' }), h('td', null, tokenbox(a1.headerSegPublished)),
        h('td', null, tokenbox(a1.headerSegComputed)), h('td', null, eqPill(a1.headerSegMatches))),
      h('tr', null, h('td', { text: 'payload segment' }), h('td', null, tokenbox(a1.payloadSegPublished)),
        h('td', null, tokenbox(a1.payloadSegComputed)), h('td', null, eqPill(a1.payloadSegMatches))),
      h('tr', null, h('td', { text: 'signature, ' + a1.sigBytes + ' bytes' }), h('td', null, tokenbox(a1.signaturePublished)),
        h('td', null, tokenbox(a1.signatureComputed)), h('td', null, eqPill(a1.signatureMatches)))
    ], { prose: true, minWidth: '780px' }));
    jc.appendChild(h('p', { class: 'hint',
      text: 'The A.1 header segment only reproduces because the RFC\'s own JSON carries a CRLF and a leading ' +
        'space, and this page preserved them. Re-serialise the parsed object and the bytes change: ' +
        F.bytes.reserialised.originalBytes + ' bytes become ' + F.bytes.reserialised.reserialisedBytes +
        ', the segment changes, and a verifier that MACs what it re-encoded is verifying a different ' +
        'message. That is the whole reason JWS signs the string.' }));
    jc.appendChild(h('div', { class: 'segs' },
      segBox('the RFC\'s own JSON', F.bytes.reserialised.originalJson, 'same'),
      segBox('the same object, re-serialised', F.bytes.reserialised.reserialisedJson, 'differs')));

    jc.appendChild(h('h4', { text: a2.rfc + ' ' + a2.section + ' — RS256, ' + a2.sigChars + ' characters' }));
    jc.appendChild(tableOf(['what', 'published', 'computed here', ''], [
      h('tr', null, h('td', { text: 'header segment' }), h('td', null, tokenbox(a2.headerSegPublished)),
        h('td', null, tokenbox(a2.headerSegComputed)), h('td', null, eqPill(a2.headerSegMatches))),
      h('tr', null, h('td', { text: 'signature, ' + a2.sigBytes + ' bytes' }), h('td', null, tokenbox(a2.signaturePublished)),
        h('td', null, tokenbox(a2.signatureComputed)), h('td', null, eqPill(a2.signatureMatches)))
    ], { prose: true, minWidth: '780px' }));
    jc.appendChild(h('p', { class: 'hint',
      text: 'PKCS#1 v1.5 is deterministic, so this one is pinnable by equality. RSA-PSS is not, and appears ' +
        'in this lab only on the determinism table where it is asserted NOT to reproduce.' }));

    jc.appendChild(h('h4', { text: a3.rfc + ' ' + a3.section + ' — ES256, and it is verify-only' }));
    jc.appendChild(tableOf(['what', 'value', 'outcome'], [
      h('tr', null, h('td', { text: 'the published signature, verified under the published public JWK' }),
        h('td', null, tokenbox(a3.signaturePublished)),
        h('td', null, a3.publishedVerifies ? pill('verifies', 'pinned') : pill('DOES NOT VERIFY', 'bad'))),
      h('tr', null, h('td', { text: 'this page re-signs the same input, once' }),
        h('td', null, tokenbox(a3.resignA)),
        h('td', null, a3.resignADiffersFromPublished ? pill('differs', 'refused') : pill('IDENTICAL', 'bad'))),
      h('tr', null, h('td', { text: 'and again' }),
        h('td', null, tokenbox(a3.resignB)),
        h('td', null, a3.resignsDifferFromEachOther ? pill('differs from the first', 'refused') : pill('IDENTICAL', 'bad')))
    ], { prose: true, minWidth: '780px' }));
    jc.appendChild(h('p', { class: 'note',
      text: 'The asymmetry is stated rather than glossed: ECDSA draws a random nonce, so a correct ' +
        'implementation cannot reproduce a published ECDSA signature. Any page that claims to has either a ' +
        'deterministic-nonce implementation or is lying. That asymmetry is itself asserted in the suite — ' +
        'the two re-signings must differ from the published value and from each other.' }));
    jc.appendChild(terminal('the pin, and what it pins',
      h('span', null,
        h('span', { class: 'v-pinned', text: 'A.1 and A.2 reproduce byte for byte; A.3 verifies and cannot reproduce. ' }),
        'What that pins is this page\'s base64url, its signing-input concatenation and its compact ' +
        'serialisation — not HMAC, not RSA, and not ECDSA.')));
    p.appendChild(jc);

    /* ---- the two-route byte comparison ---- */
    if (state.vectorsB) {
      var bc = card('The same bytes, decoded by two decoders that share no code',
        'The computed segment goes through bytes.js. The published segment goes through periksa.js, which ' +
        'carries its own base64url decoder and knows no other global. If both columns came from one decoder ' +
        'the difference could only ever be zero.');
      bc.appendChild(tableOf(['segment', 'route A — SAHIH_BYTES.b64uDecodeStrict', 'route B — SAHIH_PERIKSA.decode', ''],
        state.vectorsB.map(function (r) {
          return h('tr', null, h('td', { text: r.label + (r.bytes === null ? '' : ' — ' + r.bytes + ' bytes') }),
            h('td', null, tokenbox(r.error ? r.error : r.routeA)),
            h('td', null, tokenbox(r.error ? r.error : r.routeB)),
            h('td', null, eqPill(r.agree)));
        }), { prose: true, minWidth: '820px' }));
      bc.appendChild(h('p', { class: 'hint',
        text: 'The two decoders are NOT asserted to agree in general, and they must not be: periksa\'s is ' +
          'tail-permissive by design, exactly as atob is, which is what lets it decode the twin the strict ' +
          'decoder refuses. They are pinned on the published vectors only.' }));
      bc.appendChild(terminal('the firewall, in one grep',
        h('span', null,
          h('code', { text: "grep -o 'SAHIH_[A-Z]*' labs/sahih/periksa.js | sort -u" }),
          ' prints one name. periksa.js carries its own decoder, its own byte adder and its own copy of the ' +
          'P-256 order, which costs about twenty lines and is the only reason a difference on this page can ' +
          'be something other than zero.')));
      p.appendChild(bc);
    }

    /* ---- RFC 4231 ---- */
    var hc = card('RFC 4231 — HMAC-SHA-256 test cases 1 to 7');
    hc.appendChild(tableOf(['case', 'note', { label: 'key', num: true }, { label: 'data', num: true },
      'published MAC', 'computed here', ''],
      F.vectors.hmac4231.map(function (r) {
        return h('tr', null, h('td', { class: 'num', text: String(r.n) }), h('td', { class: 'small', text: r.note }),
          h('td', { class: 'num', text: r.keyBytes + ' B' }), h('td', { class: 'num', text: r.dataBytes + ' B' }),
          h('td', null, tokenbox(r.published)), h('td', null, tokenbox(r.computed)),
          h('td', null, eqPill(r.matches)));
      }), { prose: true, minWidth: '900px' }));
    hc.appendChild(h('p', { class: 'hint',
      text: 'Seven rows, one property. Case 5 is truncated to 16 bytes by the RFC and is the only row whose ' +
        'length differs, which is the part of this table that pins something about this page rather than ' +
        'about SHA-256.' }));
    hc.appendChild(terminal('one property, seven executions',
      h('span', null, h('b', { text: 'Seven rows is not seven claims. ' }),
        'Counting each published row as an author\'s own property is the padding this page refuses by name, ' +
        'and it is why the badge above prints properties and executions as two figures.')));
    p.appendChild(hc);

    /* ---- RFC 6238 ---- */
    var tc = card('RFC 6238 — TOTP, Appendix B, all ' + F.vectors.totpSummary.rows + ' rows',
      'The RFC prints ' + F.vectors.totpSummary.digits + '-digit codes. The six-digit column beside them is ' +
      'this lab\'s own truncation and appears in no RFC, which is worth saying plainly: a table whose ' +
      '"published" column carries a value the RFC does not print is falsifiable with a copy of the RFC, in ' +
      'the one tab whose whole job is being an external oracle.');
    /* T and the counter are printed ungrouped, unlike every other count on this
     * page. They are values a reader checks against RFC 6238's own table, and
     * the RFC prints 1111111109, not 1.111.111.109. Reformatting a published
     * number on the one tab whose whole job is being an external oracle makes
     * the comparison the tab exists for harder to do. */
    tc.appendChild(tableOf(['T', 'mode', { label: 'counter', num: true }, 'published',
      'computed here', '', 'this lab\'s six digits', 'a 32-bit counter would print'],
      F.vectors.totp.map(function (r) {
        return h('tr', null,
          h('td', { class: 'num', text: String(r.t) }), h('td', { text: r.mode }),
          h('td', { class: 'num', text: String(r.counter) }),
          h('td', null, tokenbox(r.published)), h('td', null, tokenbox(r.computed)),
          h('td', null, eqPill(r.matches)),
          h('td', { class: 'num', text: r.sixDigitThisLab }),
          h('td', { class: 'num', text: r.counter32Bug }));
      }), { prose: true, minWidth: '900px' }));
    tc.appendChild(callout('warn', 'What this table does NOT pin, and it is the least convenient fact on the tab.',
      'A counter implementation that writes only 32 bits into the low half of the 8-byte buffer matches ' +
      F.vectors.totpSummary.matched32Bug + ' of ' + F.vectors.totpSummary.rows + ' published rows — all of ' +
      'them. The largest counter the RFC prints is ' + String(F.vectors.totpSummary.largestPublishedCounter) +
      ' = ' + F.vectors.totpSummary.largestPublishedCounterHex + ', which fits in four bytes with room to ' +
      'spare. So this table pins the seed handling, the HMAC, the dynamic truncation and the modulo, and it ' +
      'pins the 8-byte big-endian path not at all.'));
    var syn = F.vectors.totpSynthetic;
    tc.appendChild(h('h4', { text: 'One synthetic row that separates them — a self-consistency check, not a published pin' }));
    tc.appendChild(tableOf(['t', { label: 'counter', num: true }, 'counter as 8 bytes', 'counter as 32 bits',
      '8-byte code', '32-bit code', 'separates'], [
      h('tr', null, h('td', { class: 'num', text: String(syn.t) }), h('td', { class: 'num', text: String(syn.counter) }),
        h('td', null, tokenbox(syn.counter8Hex)), h('td', null, tokenbox(syn.counter4Hex)),
        h('td', null, tokenbox(syn.computed8)), h('td', null, tokenbox(syn.computed32Bug)),
        h('td', null, syn.separates ? pill('yes', 'pinned') : pill('no', 'bad')))
    ], { prose: true, minWidth: '760px' }));
    tc.appendChild(h('p', { class: 'hint',
      text: 'T = 2^32 exactly. No RFC publishes a vector above that, so this row is labelled published: ' +
        String(syn.published) + ' and is a check that this page agrees with itself, nothing more. The ' +
        'published table separating the two implementations: ' + String(syn.publishedTableSeparatesThem) + '.' }));
    tc.appendChild(terminal('what the table pins, stated as a limit',
      h('span', null,
        h('span', { class: 'v-pinned', text: F.vectors.totpSummary.matched8 + ' of ' + F.vectors.totpSummary.rows + ' rows reproduce. ' }),
        'And a 32-bit counter reproduces ' + F.vectors.totpSummary.matched32Bug + ' of ' +
        F.vectors.totpSummary.rows + ' as well, so the published table pins the seed handling, the HMAC, the ' +
        'truncation and the modulo — and the 8-byte counter path not at all. The row that separates them is ' +
        'this page\'s own, and it is labelled as this page\'s own.')));
    p.appendChild(tc);

    /* ---- the negative control ---- */
    var mr = F.vectors.totpMisread;
    var nc = card('The negative control, and it is this tab\'s real argument',
      'A table of matching rows proves nothing until it has been shown capable of not matching. The widely ' +
      'repeated misreading of RFC 6238 is that all three hash modes share the 20-byte ASCII seed. ' +
      'Recomputed under that misreading, here is what happens.');
    nc.appendChild(h('div', { class: 'summary' },
      stat('rows matching under the misreading', mr.matched + ' of ' + mr.of, 'expected ' + mr.expectedMatches),
      stat('every match is a SHA-1 row', String(mr.everyMatchIsSha1), 'for SHA-1 the misread seed IS the correct seed'),
      stat('T=' + mr.workedRow.t + ' ' + mr.workedRow.mode, mr.workedRow.misread, 'against the published ' + mr.workedRow.publishedValue),
      stat('rows that fail', String(mr.of - mr.matched), 'and they are exactly the twelve SHA-2 rows')));
    nc.appendChild(tableOf(['T', 'mode', 'published', 'under the misreading', ''],
      mr.rows.map(function (r) {
        return h('tr', { class: r.matches ? null : 'sel' },
          h('td', { class: 'num', text: String(r.t) }), h('td', { text: r.mode }),
          h('td', null, tokenbox(r.published)), h('td', null, tokenbox(r.computed)),
          h('td', null, eqPill(r.matches)));
      }), { prose: true, minWidth: '700px' }));
    nc.appendChild(terminal('what the control actually controls',
      h('span', null, h('b', { text: 'Six of those matches are guaranteed by construction. ' }),
        'For SHA-1 the misread seed is the correct seed, so the control only controls the twelve SHA-2 rows. ' +
        'Twelve failing rows in a partial-failure pattern that tracks the spec\'s own seed-length boundary ' +
        'is a table that has been shown capable of failing — which is the entire reason it ships.')));
    p.appendChild(nc);
  }
  RENDER.vectors = renderVectors;

  /* ============================================================= TESTS === */

  function runTests() {
    if (!T) return;
    state.testsBusy = true;
    paintTests();
    renderIfVisible('tests');
    /* A yielded frame before the run, and the badge already says "running":
     * §5 forbids tests.js a clock, so the elapsed figure is measured here. */
    setTimeout(function () {
      var t0 = Date.now();
      T.run().then(function (r) {
        state.tests = r;
        state.testsMs = Date.now() - t0;
        state.testsBusy = false;
        paintTests();
        paintNet();
        renderIfVisible('tests');
        /* The Rujukan tab prints G10's own property and execution counts out of
           this object, so it is repainted when the object arrives. */
        renderIfVisible('vectors');
        say(r.failed ? r.failed + ' assertions FAILED.'
          : r.passed + ' assertions passed: ' + r.properties + ' properties, ' + r.negatives +
            ' of them negative, ' + r.executions + ' executions.');
      })['catch'](function (e) {
        /* Not optional. run() resolves on every ordinary path, but a browser with
         * no Web Crypto API makes it reject — and an unhandled rejection here is
         * a pageerror, which fails the lab with every assertion green. */
        state.tests = {
          results: [{ group: 'runner', name: 'the suite threw', ok: false,
            message: String(e && e.message || e) }],
          passed: 0, failed: 1, total: 1, properties: 0, executions: 1, negatives: 0,
          groups: 0, byGroup: [], noise: 0, ms: 0
        };
        state.testsMs = Date.now() - t0;
        state.testsBusy = false;
        paintTests();
        renderIfVisible('tests');
      });
    }, 30);
  }

  function caseRow(x) {
    return h('div', { class: 'tcase ' + (x.ok ? 'ok' : 'no') },
      h('span', { class: 'mk', text: x.ok ? '✓' : '✗' }),
      h('span', { text: x.name }),
      x.ok ? null : h('span', { class: 'msg', text: x.message }));
  }

  function renderTests(p) {
    p.appendChild(h('h2', { text: 'Every assertion, grouped, passing ones included' }));
    var c = card('The suite, over a fixture rebuilt from frozen RFC vectors and keys made in this tab',
      'This is the same file test/labs.test.js runs in headless Chromium on every push to the repository. ' +
      'The figures below are computed from the property registry the suite builds while it runs, not typed ' +
      'into this file.');
    if (state.testsBusy || !state.tests) {
      c.appendChild(h('div', { class: 'empty', text: state.testsBusy
        ? 'Running. It builds the fixture — two keypairs, an HMAC secret, about forty sign and verify calls, ' +
          'five forgeries and a malleation — and then runs twelve groups of synchronous assertions over the ' +
          'result.'
        : 'Waiting for crypto.subtle.' }));
      p.appendChild(c);
      return;
    }
    var r = state.tests;

    /* Three separate figures, never one. Nine properties cover eighty-eight of
     * the vector executions on the Rujukan tab, and a badge that folded them
     * into one number would inflate the headline by a factor of four. */
    c.appendChild(h('div', { class: 'test-summary' },
      h('span', { class: 'pillbig ' + (r.failed ? 'fail' : 'pass'),
        text: r.failed ? r.failed + ' FAILED' : r.passed + ' PASSED' }),
      h('span', { class: 'hint', text: num(r.properties) + ' distinct properties · ' + num(r.negatives) +
        ' of them pass only because something was REFUSED · ' + num(r.executions) + ' executions · ' +
        r.groups + ' groups · ' + num(state.testsMs) + ' ms · egress attempts during the run: ' + r.noise }),
      btn('Run again', function () { state.tests = null; runTests(); }, 'small no-print', 'tests:again')));
    c.appendChild(h('div', { class: 'summary' },
      stat('properties', num(r.properties), 'distinct claims, and the denominator for everything else'),
      stat('negatives', num(r.negatives), Math.round(1000 * r.negatives / (r.properties || 1)) / 10 +
        '% — each one passes only when something was refused'),
      stat('executions', num(r.executions), 'one property can execute eighteen times'),
      stat('egress', String(r.noise), 'SAHIH_GUARD.total() as the suite found it')));
    if (r.noise) {
      c.appendChild(callout('bad', 'Something in this lab attempted to reach the network.',
        'That figure is the egress counter, not a console count, and nothing on this page is supposed to be ' +
        'able to move it. A non-zero value here is a defect.'));
    }
    c.appendChild(h('p', { class: 'hint',
      text: 'Properties and executions are different numbers and both come from the run object rather than ' +
        'from a literal in this file. The negative share is deliberately over half: in this domain nearly ' +
        'every real claim is a refusal, and a security suite that is mostly positive assertions is testing ' +
        'the happy path of a login form.' }));
    c.appendChild(terminal('what a green badge here does and does not mean',
      h('span', null, h('b', { text: 'It means the properties I chose held on this machine, this time. ' }),
        'Nobody has reviewed this code, the suite cannot see a bug it was not written to look for, and the ' +
        'only genuinely external oracle in the whole lab is the frozen RFC column on the Rujukan tab.')));
    p.appendChild(c);

    /* Nested by property, using SAHIH_TESTS.props: property k owns
     * results[from .. from + executions - 1]. Grouping by result name instead
     * would silently merge properties that share a short execution name, and
     * several deliberately do. */
    var props = (T && T.props) || [];
    (r.byGroup || []).forEach(function (g) {
      var box = h('div', { class: 'tgroup' });
      box.appendChild(h('h4', { text: g.group + '   ' + g.passed + '/' + g.executions }));
      box.appendChild(h('p', { class: 'hint', text: g.properties + ' properties, ' + g.negatives +
        ' of them negative, ' + g.executions + ' executions' + (g.failed ? ', ' + g.failed + ' FAILED' : '') }));
      var mine = props.filter(function (x) { return x.group === g.group; });
      if (!mine.length) {
        r.results.forEach(function (x) { if (x.group === g.group) box.appendChild(caseRow(x)); });
      } else {
        mine.forEach(function (pr) {
          var own = r.results.slice(pr.from, pr.from + pr.executions);
          var bad = own.filter(function (x) { return !x.ok; }).length;
          box.appendChild(h('p', { class: 'small' },
            h('span', { class: 'mk', text: bad ? '✗ ' : '✓ ' }),
            pr.negative ? pill('refusal', 'refused') : null, ' ', pr.name));
          own.forEach(function (x) { box.appendChild(caseRow(x)); });
        });
      }
      p.appendChild(box);
    });
  }
  RENDER.tests = renderTests;

  /* ============================================================== BOOT === */

  /* One WebAuthn call, and it is not in the assertion count. Registration is not
   * attempted: this repository's harness serves from 127.0.0.1, an IP literal
   * cannot be a Relying Party ID, and a virtual authenticator over CDP does not
   * fix that. */
  function probeWebAuthn() {
    var PC = root.PublicKeyCredential;
    if (!PC || typeof PC.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      state.webauthn = 'PublicKeyCredential is not present in this browser';
      return;
    }
    var t0 = Date.now();
    PC.isUserVerifyingPlatformAuthenticatorAvailable().then(function (v) {
      state.webauthn = 'isUserVerifyingPlatformAuthenticatorAvailable() answered ' + String(v) +
        ' in about ' + (Date.now() - t0) + ' ms, and it is not in the assertion count';
      renderIfVisible('verify');
    })['catch'](function (e) {
      state.webauthn = 'isUserVerifyingPlatformAuthenticatorAvailable() rejected with ' + String(e && e.name || e);
      renderIfVisible('verify');
    });
  }

  function buildFixture() {
    var subtle = api();
    if (!subtle || !FX) {
      state.fxErr = subtle
        ? 'fixture.js did not load, so this page has no token to show at all.'
        : 'This browser exposes no crypto.subtle, so there is nothing on this page that could run. ' +
          'It needs a secure context: over http that means 127.0.0.1 or localhost.';
      state.booting = false;
      rerender();
      say(state.fxErr);
      /* The suite still runs. With no crypto.subtle its promise REJECTS, the
         boot catch below turns that into the one-red-result object §3.10 pins,
         and the badge settles on a failure instead of saying "waiting…" for the
         life of the page — which is what a broken page looks like to a reader
         and to nobody else. */
      setTimeout(runTests, 0);
      return;
    }
    /* The HS256 demo secret is generated HERE, not in the fixture: fixture.js
     * reaches for no global at all, and "crypto.getRandomValues, this tab, N ms
     * ago" is only true if this file is the one that called it. */
    var opts = {};
    try {
      var raw = new Uint8Array(32);
      root.crypto.getRandomValues(raw);
      opts.hsSecretB64u = B.b64uEncode(raw);
      state.secretAt = Date.now();
    } catch (e) { /* the fixture falls back to subtle.generateKey and records that it did */ }

    state.bootStep = 'building the fixture';
    FX.build(subtle, opts).then(function (F) {
      state.fx = F;
      state.clockNow = F.meta.now;
      state.booting = false;
      state.bootStep = 'ready';
      rerender();
      /* The panel the visitor is already on goes from "Building …" to a full
       * card, and nothing says so. A sighted reader watches it happen; the live
       * region is the only place anyone else can hear it, and until this line
       * the only announcement on a good load came a second later and was about
       * the assertion count. */
      var readyTab = $('tab-' + state.view);
      say((readyTab ? readyTab.textContent.trim() : state.view) + ' is ready.');
      /* Route-B probes and the suite each get their own task. Neither is on the
       * path to first paint, and running them in this one would put the whole
       * boot in a single block. */
      setTimeout(function () {
        probeFirewall();
        probeForge();
        probeVectors();
        renderIfVisible(state.view);
        setTimeout(runTests, 0);
      }, 0);
    })['catch'](function (e) {
      state.fxErr = 'The fixture could not be built: ' + String(e && e.name || '') + ' ' + String(e && e.message || e);
      state.booting = false;
      rerender();
      say(state.fxErr);
      setTimeout(runTests, 0);
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
    /* Read, never written: the guard counts calls this page does not make, and
     * the repaint is wired so that a count nobody expected still shows up. */
    if (root.SAHIH_GUARD) root.SAHIH_GUARD.onchange = paintNet;
    paintNet();
    paintTests();
    wireTabs();

    /* Cheap, and it belongs on the first paint: the Periksa tab's clock box is a
     * statement of a limit, and a limit that arrives late reads like a result. */
    state.waktu = measureClock();
    probeWebAuthn();

    /* guard.js records a tab click that landed before this file existed, and the
     * class it is waiting for is set here — one statement after the strip is
     * actually wired, so the window in which the markup lies about being live is
     * as short as this page can make it. Honouring the click matters more than
     * it looks: every panel already has a "Building …" state, so a visitor who
     * asked for Palsu during the load gets Palsu, waiting, rather than Terbit
     * and no explanation. */
    var pending = document.documentElement.getAttribute('data-sahih-pending-tab');
    document.documentElement.removeAttribute('data-sahih-pending-tab');
    document.documentElement.classList.add('ready');
    if (pending && $('panel-' + pending)) switchTab(pending);
    else renderPanel('issue');

    /* A yielded frame before any crypto: the page is scrollable and clickable
     * from the first paint, and the fixture build starts after the browser has
     * had a chance to draw. */
    if (root.requestAnimationFrame) root.requestAnimationFrame(function () { setTimeout(buildFixture, 0); });
    else setTimeout(buildFixture, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
