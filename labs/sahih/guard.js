/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — guard.js
 * Loaded first, before anything else, and the only <script> in <head>.
 * Two jobs.
 *
 * 1. Theme, applied before first paint so there is no flash of the wrong one.
 *    Every storage access is wrapped: localStorage THROWS outright where a
 *    browser is set to block site data, and one unguarded read is enough to
 *    blank a whole page.
 *
 * 2. The egress counter. This lab's whole argument is that the keys were made
 *    in your tab and nothing left it, so the counter is the evidence for the
 *    half of that sentence a reader cannot see. It wraps the five APIs that
 *    could reach out and counts ATTEMPTS.
 *
 *    The counter instruments the CALL and never the outcome. Measured under
 *    this page's own CSP: navigator.sendBeacon returns TRUE for a request
 *    connect-src 'none' refused, and the WebSocket and EventSource
 *    constructors both succeed — readyState 3 and 0 — with the refusal
 *    arriving asynchronously. A counter that trusted a return value, or the
 *    absence of a throw, would under-report a send the browser blocked.
 *
 *    The corollary, and it is why this file has no self-test: every refusal
 *    the browser issues also writes a console error, and the CI runner counts
 *    one console error as a broken page. So this lab makes no outbound attempt
 *    of any kind — not even a "press this to prove the counter works" button.
 *    The counter's arithmetic is asserted instead, in the suite, against a
 *    throwaway clone of this object.
 *
 * Scope note, stated plainly: this is a claim about THIS page. The CV homepage
 * at biassp.github.io does call api.github.com for its repo feed. This lab does
 * not call anything, ever.
 */
(function (root) {
  'use strict';

  /* ---- theme ---- */
  // Values are stored RAW ('light' / 'dark') by both this lab and the CV. An older
  // build of a sibling page wrote a JSON-encoded '"light"' through a save() helper,
  // which its reader never matched — so strip stray quotes and heal that value
  // instead of pinning a returning visitor to dark forever.
  function readTheme(key) {
    var v = null;
    try { v = localStorage.getItem(key); } catch (e) { return null; }
    if (v == null) return null;
    v = String(v).replace(/^"+|"+$/g, '');
    return (v === 'light' || v === 'dark') ? v : null;
  }
  // Anything unrecognised under our own key must fall through to the CV's shared
  // key, not be treated as a valid choice.
  var stored = readTheme('sahih.theme') || readTheme('theme');
  // Dark by default, exactly like the CV, which also ignores prefers-color-scheme
  // so that a visitor who chose a theme there sees the same one here.
  var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
  // Self-heal a legacy quoted value so it stops shadowing the CV key on later loads.
  try {
    var raw = localStorage.getItem('sahih.theme');
    if (raw != null && raw !== 'light' && raw !== 'dark') localStorage.setItem('sahih.theme', theme);
  } catch (e3) { /* site data blocked */ }
  // Guarded so the file can be require()d by a test without a DOM. In the page
  // this branch is always taken, and taken before the stylesheet paints.
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.add('js');
  }

  /* ---- a tab click that arrives before app.js does ---- */
  // The tab strip is in the markup, so the browser paints six buttons — cursor
  // and all — while the nine scripts below it are still arriving. Measured on
  // this machine: the strip is on screen and dead for 224 ms on a local load,
  // 1.9 s on a throttled 1.6 Mbit link and 6.4 s at 400 kbit. A click in that
  // window used to be discarded in silence and the page then opened on a tab the
  // visitor had not chosen, which is worse than a slow page: it is a page that
  // ignores you. This file is in <head>, so it is the only one that can hear the
  // click at all. It records the intent on the root element; app.js honours it
  // and marks the strip ready, after which this listener does nothing.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (e) {
      var el = e.target, hops = 0;
      if (document.documentElement.className.indexOf('ready') > -1) return;
      while (el && el.nodeType === 1 && hops < 6) {
        if (el.getAttribute && el.getAttribute('role') === 'tab' && el.id) {
          try { document.documentElement.setAttribute('data-sahih-pending-tab', el.id.replace('tab-', '')); }
          catch (e4) { /* nothing to do, and nothing to break */ }
          return;
        }
        el = el.parentNode; hops++;
      }
    }, true);
  }

  /* ---- egress counter ---- */
  var counts = { fetch: 0, xhr: 0, beacon: 0, websocket: 0, eventsource: 0 };
  var log = [];
  function note(kind, target, asal) {
    // An unknown kind still gets counted rather than incrementing NaN — total()
    // reads the object, so a silently-dropped attempt would understate the claim.
    if (counts[kind] === undefined) counts[kind] = 0;
    counts[kind]++;
    log.push({ kind: kind, target: String(target).slice(0, 200), asal: asal || 'halaman', at: Date.now() });
    if (root.SAHIH_GUARD && typeof root.SAHIH_GUARD.onchange === 'function') {
      try { root.SAHIH_GUARD.onchange(); } catch (e) { }
    }
  }

  if (typeof root.fetch === 'function') {
    var realFetch = root.fetch;
    root.fetch = function (input) {
      note('fetch', (input && input.url) || input);
      return realFetch.apply(this, arguments);
    };
  }
  if (root.XMLHttpRequest && root.XMLHttpRequest.prototype) {
    var realOpen = root.XMLHttpRequest.prototype.open;
    root.XMLHttpRequest.prototype.open = function (method, url) {
      note('xhr', method + ' ' + url);
      return realOpen.apply(this, arguments);
    };
  }
  if (root.navigator && typeof root.navigator.sendBeacon === 'function') {
    var realBeacon = root.navigator.sendBeacon.bind(root.navigator);
    // sendBeacon's return value is documented as "the user agent queued the
    // transfer". Under connect-src 'none' it still answers true. Count first.
    root.navigator.sendBeacon = function (url) { note('beacon', url); return realBeacon.apply(null, arguments); };
  }
  if (typeof root.WebSocket === 'function') {
    var RealWS = root.WebSocket;
    var WrappedWS = function (url, protocols) {
      note('websocket', url);
      return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
    };
    WrappedWS.prototype = RealWS.prototype;
    // The readyState constants live on the CONSTRUCTOR as well as the instance,
    // and code that compares against WebSocket.OPEN would read undefined off the
    // wrapper — which equals nothing, so every such comparison silently fails.
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WrappedWS[k] = RealWS[k]; });
    root.WebSocket = WrappedWS;
  }
  if (typeof root.EventSource === 'function') {
    var RealES = root.EventSource;
    var WrappedES = function (url, cfg) { note('eventsource', url); return new RealES(url, cfg); };
    WrappedES.prototype = RealES.prototype;
    // EventSource defines three, not four: it has no CLOSING state, because a
    // server-sent-events stream is closed by the client the moment it asks.
    ['CONNECTING', 'OPEN', 'CLOSED'].forEach(function (k) { WrappedES[k] = RealES[k]; });
    root.EventSource = WrappedES;
  }

  var NS = {
    counts: counts,
    log: log,
    // For an attempt this page makes on purpose and wants counted honestly —
    // there are none, and there will be none: an attempt the CSP refuses writes
    // a console error, and one console error fails this lab in CI. The hook
    // exists so that adding one cannot be done without it appearing in the
    // header, and so the suite can exercise the arithmetic on a clone.
    noteExternal: function (kind, target, asal) { note(kind, target, asal || 'luar'); },
    total: function () {
      var n = 0;
      for (var k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) n += counts[k];
      return n;
    },
    onchange: null
  };

  root.SAHIH_GUARD = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
