/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — guard.js
 * Loaded first, before anything else, for two jobs.
 *
 * 1. Theme, applied before first paint so there is no flash. Every storage
 *    access is wrapped: localStorage THROWS outright where site data is
 *    blocked, and one unguarded read is enough to blank a whole page.
 *
 * 2. The egress counter. This app holds children's records. The page's CSP
 *    already sets connect-src 'none', so the browser refuses outbound
 *    connections whatever the JavaScript does; this wraps the four APIs that
 *    could try anyway and counts attempts, so the header shows a number a
 *    visitor can check against their own DevTools Network tab.
 *
 * Scope note: this is a claim about THIS page. The CV homepage at
 * biassp.github.io does call api.github.com for its repo feed. This lab does
 * not call anything, ever.
 */
(function () {
  'use strict';

  function readTheme(key) {
    var v = null;
    try { v = localStorage.getItem(key); } catch (e) { return null; }
    if (v == null) return null;
    v = String(v).replace(/^"+|"+$/g, '');
    return (v === 'light' || v === 'dark') ? v : null;
  }
  var stored = readTheme('siakad.theme') || readTheme('theme');
  var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.add('js');

  var counts = { fetch: 0, xhr: 0, beacon: 0, websocket: 0, eventsource: 0 };
  var log = [];
  function note(kind, target, asal) {
    if (counts[kind] === undefined) counts[kind] = 0;
    counts[kind]++;
    log.push({ kind: kind, target: String(target).slice(0, 200), asal: asal || 'halaman', at: Date.now() });
    if (window.SIAKAD_GUARD && typeof window.SIAKAD_GUARD.onchange === 'function') {
      try { window.SIAKAD_GUARD.onchange(); } catch (e) { }
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

  window.SIAKAD_GUARD = {
    counts: counts, log: log,
    /* The page's meta CSP does not reach a dedicated worker's global scope, so
     * solver.worker.js installs the same wrappers there and posts any attempt
     * back for counting here. Without this the badge would be a claim about the
     * document while the footer talks about the whole page. */
    noteExternal: function (kind, target, asal) { note(kind, target, asal || 'worker'); },
    total: function () {
      var n = 0;
      for (var k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) n += counts[k];
      return n;
    },
    onchange: null
  };
})();
