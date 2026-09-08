/* HARvest - guard.js
 * Loaded first, before anything else, for two jobs.
 *
 * 1. Theme, applied before first paint so there is no flash. Every storage
 *    access is wrapped: localStorage THROWS outright where site data is blocked,
 *    and one unguarded read is enough to kill a whole script block.
 *
 * 2. The egress counter. The page's CSP already sets connect-src 'none', so the
 *    browser refuses outbound connections whatever the JavaScript does. This wraps
 *    the four APIs that could try anyway and counts attempts, so the header can
 *    show a number a visitor can check against their own DevTools Network tab.
 *
 * Scope note, because it matters: this is a claim about THIS page. The CV
 * homepage at biassp.github.io does call api.github.com for its repo feed. This
 * lab does not call anything.
 */
(function () {
  'use strict';

  /* ---- theme ---- */
  // Values are stored RAW ('light' / 'dark') by both this lab and the CV. An older
  // build of this page wrote a JSON-encoded '"light"' through a save() helper, which
  // this reader never matched - so strip stray quotes and heal that value instead of
  // pinning a returning visitor to dark forever.
  function readTheme(key) {
    var v = null;
    try { v = localStorage.getItem(key); } catch (e) { return null; }
    if (v == null) return null;
    v = String(v).replace(/^"+|"+$/g, '');
    return (v === 'light' || v === 'dark') ? v : null;
  }
  // Anything unrecognised under our own key must fall through to the CV's shared
  // key, not be treated as a valid choice.
  var stored = readTheme('harvest.theme') || readTheme('theme');
  // Dark by default, exactly like the CV, which also ignores prefers-color-scheme
  // so that a visitor who chose a theme there sees the same one here.
  var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
  // Self-heal a legacy quoted value so it stops shadowing the CV key on later loads.
  try {
    var raw = localStorage.getItem('harvest.theme');
    if (raw != null && raw !== 'light' && raw !== 'dark') localStorage.setItem('harvest.theme', theme);
  } catch (e3) { /* site data blocked */ }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.add('js');

  /* ---- egress counter ---- */
  var counts = { fetch: 0, xhr: 0, beacon: 0, websocket: 0, eventsource: 0 };
  var log = [];
  function note(kind, target) {
    counts[kind]++;
    log.push({ kind: kind, target: String(target).slice(0, 200), at: Date.now() });
    if (window.HARVEST_GUARD && typeof window.HARVEST_GUARD.onchange === 'function') {
      try { window.HARVEST_GUARD.onchange(); } catch (e) { }
    }
  }

  if (typeof window.fetch === 'function') {
    var realFetch = window.fetch;
    window.fetch = function (input) {
      note('fetch', (input && input.url) || input);
      return realFetch.apply(this, arguments);
    };
  }
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var realOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      note('xhr', method + ' ' + url);
      return realOpen.apply(this, arguments);
    };
  }
  if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
    var realBeacon = window.navigator.sendBeacon.bind(window.navigator);
    window.navigator.sendBeacon = function (url) { note('beacon', url); return realBeacon.apply(null, arguments); };
  }
  if (typeof window.WebSocket === 'function') {
    var RealWS = window.WebSocket;
    var WrappedWS = function (url, protocols) {
      note('websocket', url);
      return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
    };
    WrappedWS.prototype = RealWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WrappedWS[k] = RealWS[k]; });
    window.WebSocket = WrappedWS;
  }
  if (typeof window.EventSource === 'function') {
    var RealES = window.EventSource;
    var WrappedES = function (url, cfg) { note('eventsource', url); return new RealES(url, cfg); };
    WrappedES.prototype = RealES.prototype;
    window.EventSource = WrappedES;
  }

  window.HARVEST_GUARD = {
    counts: counts,
    log: log,
    total: function () {
      var n = 0;
      for (var k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) n += counts[k];
      return n;
    },
    onchange: null
  };
})();
