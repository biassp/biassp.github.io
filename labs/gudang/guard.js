/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — guard.js
 * Loaded first, before anything else, for two jobs.
 *
 * 1. Theme, applied before first paint so there is no flash of the wrong one.
 *    Every storage access is wrapped: localStorage THROWS outright where a
 *    browser is set to block site data, and one unguarded read is enough to
 *    blank a whole page. This site has shipped that bug once already.
 *
 * 2. The egress counter. This app holds a business's purchase prices, margins
 *    and supplier terms — the three things a shop owner would least like to see
 *    leave the building. The page's CSP already sets connect-src 'none', so the
 *    browser refuses outbound connections whatever the JavaScript does; this
 *    wraps the five APIs that could try anyway and counts attempts, so the
 *    header shows a number a visitor can check against their own DevTools
 *    Network tab.
 *
 * Scope note, stated plainly: this is a claim about THIS page. The CV homepage
 * at biassp.github.io does call api.github.com for its repo feed. This lab does
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
  var stored = readTheme('gudang.theme') || readTheme('theme');
  var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.add('js');

  var counts = { fetch: 0, xhr: 0, beacon: 0, websocket: 0, eventsource: 0 };
  var log = [];
  function note(kind, target, asal) {
    if (counts[kind] === undefined) counts[kind] = 0;
    counts[kind]++;
    log.push({ kind: kind, target: String(target).slice(0, 200), asal: asal || 'halaman', at: Date.now() });
    if (window.GUDANG_GUARD && typeof window.GUDANG_GUARD.onchange === 'function') {
      try { window.GUDANG_GUARD.onchange(); } catch (e) { }
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

  window.GUDANG_GUARD = {
    counts: counts, log: log,
    noteExternal: function (kind, target, asal) { note(kind, target, asal || 'luar'); },
    total: function () {
      var n = 0;
      for (var k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) n += counts[k];
      return n;
    },
    onchange: null
  };
})();
