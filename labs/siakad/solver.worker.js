/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — solver.worker.js
 * The timetable search runs here so a 2-second backtracking run cannot freeze
 * the tab. It loads the SAME solver.js the page and the test suite load — the
 * worker adds message plumbing and nothing else, so there is no second
 * implementation to drift.
 *
 * Egress guards, and why they are here and not only in guard.js: a
 * Content-Security-Policy delivered through <meta http-equiv> applies to the
 * DOCUMENT, not to a dedicated worker's global scope. The page's
 * `connect-src 'none'` therefore does not cover this file, and the header's
 * "panggilan jaringan" counter would have been a claim about the document while
 * the footer sentence talked about the whole page. So the worker wraps the same
 * four APIs itself and posts any attempt back to the page to be counted. This
 * file makes no network call of its own — importScripts of a same-origin file
 * is not one — and the wrappers exist so that claim is enforced rather than
 * asserted.
 */
/* global importScripts, SIAKAD_SOLVER */
(function () {
  'use strict';
  function lapor(kind, target) {
    try { self.postMessage({ type: 'net', kind: kind, target: String(target).slice(0, 200) }); } catch (e) { }
  }
  if (typeof self.fetch === 'function') {
    var realFetch = self.fetch;
    self.fetch = function (input) { lapor('fetch', (input && input.url) || input); return realFetch.apply(this, arguments); };
  }
  if (self.XMLHttpRequest && self.XMLHttpRequest.prototype) {
    var realOpen = self.XMLHttpRequest.prototype.open;
    self.XMLHttpRequest.prototype.open = function (method, url) { lapor('xhr', method + ' ' + url); return realOpen.apply(this, arguments); };
  }
  if (typeof self.WebSocket === 'function') {
    var RealWS = self.WebSocket;
    var WrappedWS = function (url, protocols) {
      lapor('websocket', url);
      return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
    };
    WrappedWS.prototype = RealWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WrappedWS[k] = RealWS[k]; });
    self.WebSocket = WrappedWS;
  }
  if (typeof self.EventSource === 'function') {
    var RealES = self.EventSource;
    var WrappedES = function (url, cfg) { lapor('eventsource', url); return new RealES(url, cfg); };
    WrappedES.prototype = RealES.prototype;
    self.EventSource = WrappedES;
  }
})();

importScripts('solver.js');

self.onmessage = function (ev) {
  var msg = ev.data || {};
  if (msg.type !== 'solve') return;
  var t0 = Date.now();
  try {
    var res = SIAKAD_SOLVER.solve(msg.spec, msg.opts || {});
    self.postMessage({
      type: 'result', reqId: msg.reqId, ok: res.ok, assign: res.assign,
      stats: res.stats, soft: res.soft || null, diagnosis: res.diagnosis || null,
      wallMs: Date.now() - t0
    });
  } catch (e) {
    self.postMessage({
      type: 'error', reqId: msg.reqId,
      message: String(e && e.message || e), stack: String(e && e.stack || '')
    });
  }
};
