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
 */
/* global importScripts, SIAKAD_SOLVER */
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
