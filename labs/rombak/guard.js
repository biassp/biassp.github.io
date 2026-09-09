/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — guard.js
 * Loaded first, before anything else, and the only <script> in <head>.
 * Two jobs.
 *
 * 1. Theme, applied before first paint so there is no flash of the wrong one.
 *    Every storage access is wrapped: localStorage THROWS outright where a
 *    browser is set to block site data, and one unguarded read is enough to
 *    blank a whole page.
 *
 * 2. The egress counter, which this lab needs more than any of its siblings.
 *    This page ships 878KB of vendored WebAssembly, and the whole reason it is
 *    base64 in a <script> rather than a .wasm behind fetch() is that fetching it
 *    is a network request. The counter is the evidence: it wraps the five APIs
 *    that could reach out anyway and counts ATTEMPTS, not successes, so a
 *    fallback path inside sql.js that quietly tried to fetch its own binary
 *    would show up here as a 1 even though the CSP refused it. If it ever reads
 *    anything but 0 after boot, the claim on eight lab pages is false and the
 *    page says so instead of hiding it.
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
  var stored = readTheme('rombak.theme') || readTheme('theme');
  // Dark by default, exactly like the CV, which also ignores prefers-color-scheme
  // so that a visitor who chose a theme there sees the same one here.
  var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
  // Self-heal a legacy quoted value so it stops shadowing the CV key on later loads.
  try {
    var raw = localStorage.getItem('rombak.theme');
    if (raw != null && raw !== 'light' && raw !== 'dark') localStorage.setItem('rombak.theme', theme);
  } catch (e3) { /* site data blocked */ }
  // Guarded so the file can be require()d by a test without a DOM. In the page
  // this branch is always taken, and taken before the stylesheet paints.
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.add('js');
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
    if (root.ROMBAK_GUARD && typeof root.ROMBAK_GUARD.onchange === 'function') {
      try { root.ROMBAK_GUARD.onchange(); } catch (e) { }
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
    // there are none today, and the hook exists so that adding one cannot be
    // done without it appearing in the header.
    noteExternal: function (kind, target, asal) { note(kind, target, asal || 'luar'); },
    total: function () {
      var n = 0;
      for (var k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) n += counts[k];
      return n;
    },
    onchange: null
  };

  root.ROMBAK_GUARD = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
