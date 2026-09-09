/*!
 * Rombak — tests.worker.js
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — the assertion suite, off the main thread.
 *
 * The suite takes about twenty seconds: it boots SQLite, seeds ~48,000 rows,
 * walks the nine-version ladder twice over to prove each step is a no-op the
 * second time, and runs four full table rebuilds. That is honest work and it is
 * not going to get much faster.
 *
 * Run on the main thread it is also twenty seconds of frozen page. Measured, on
 * this machine: one 23.6-second block during which nothing scrolls and no tab
 * responds. Yielding between groups does not fix it either — two groups are over
 * seven seconds each on their own, so the page would still lock up for seven.
 *
 * A page that locks up reads as broken, and that is a worse first impression
 * than having no lab at all. So the whole engine goes into a worker. Every file
 * below is DOM-free by design — only app.js and store.js touch the document or
 * storage — which is what makes this possible without changing any of them.
 *
 * The main thread keeps ROMBAK_TESTS exactly as it was. That matters: the CI
 * runner calls ROMBAK_TESTS.run() in the page, not here, so nothing about this
 * file changes what CI proves. It is also the fallback when Worker is missing or
 * a worker fails to start.
 *
 * The wasm arrives as base64 in a plain script, same as on the page, so the
 * worker makes no network request either — importScripts of a same-origin file
 * is not fetch, and connect-src 'none' still holds.
 */
'use strict';

importScripts(
  'vendor/sqlite-wasm-base64.js',
  'vendor/sql-wasm.js',
  'domain.js',
  'schema.js',
  'plans.js',
  'seed.js',
  'census.js',
  'engine.js',
  'runner.js',
  'tests.js'
);

self.onmessage = function (e) {
  if (!e || !e.data || e.data.cmd !== 'run') return;

  var t0 = Date.now();
  try {
    self.ROMBAK_TESTS.run().then(function (r) {
      /* Only cloneable values cross this boundary. The suite already guarantees
         that — CI passes the same object through page.evaluate, which uses the
         same structured-clone rules — but a Uint8Array or an Error slipping into
         results would fail here as a DataCloneError rather than as a test
         failure, so the shape is rebuilt explicitly rather than trusted. */
      self.postMessage({
        ok: true,
        result: {
          results: (r.results || []).map(function (x) {
            return { group: String(x.group), name: String(x.name), ok: !!x.ok, message: x.message == null ? '' : String(x.message) };
          }),
          passed: r.passed, failed: r.failed, total: r.total,
          properties: r.properties, executions: r.executions, negatives: r.negatives,
          groups: r.groups,
          byGroup: r.byGroup ? JSON.parse(JSON.stringify(r.byGroup)) : [],
          noise: r.noise,
          ms: r.ms || (Date.now() - t0)
        }
      });
    })['catch'](function (err) {
      self.postMessage({ ok: false, error: String(err && err.stack || err), ms: Date.now() - t0 });
    });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.stack || err), ms: Date.now() - t0 });
  }
};
