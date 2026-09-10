/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — kerja.worker.js
 * ONE WRITER. It loads the same engine files the page loads — there is no
 * second implementation of the write shapes anywhere in this lab, so there is
 * nothing to drift — and adds message plumbing and nothing else.
 *
 * guard.js IS LOADED FIRST, AND THAT ORDER IS THE POINT. A
 * Content-Security-Policy delivered through a meta element applies to the
 * DOCUMENT, not to a dedicated worker's global scope, and the static host this
 * site runs on sends no policy header at all. So this realm has effectively no
 * policy: measured on this page's own CSP, a fetch from the page was refused
 * and wrote two console errors, while the IDENTICAL fetch from inside a worker
 * RESOLVED WITH THE BODY, silently, with nothing logged anywhere and the page's
 * own counter reading zero. Two labs in this repository already ship real
 * workers under a zero-network badge that only ever watched the main thread.
 * This one wraps the same five APIs inside the worker and posts its own total
 * back to be folded into the page's before anything is reported.
 *
 * THIS FILE NEVER WRITES TO THE ERROR CONSOLE, INCLUDING INSIDE A CATCH.
 * Measured: an error written to the console from inside a worker reaches the
 * automation boundary as a console error, and one console error is a broken
 * page there — independently of every assertion in the suite. Failures travel
 * as {t:'err', name, code} messages instead. The name of that logging call is
 * deliberately not spelled anywhere below, so the one-line grep that proves
 * this claim finds nothing rather than finding this paragraph.
 *
 * AND IT HANDLES ITS OWN UNHANDLED REJECTIONS. Measured, and it is the single
 * most expensive thing to get wrong here: a promise rejection inside a worker
 * does NOT fire worker.onerror on the page, does NOT fire an in-page
 * unhandledrejection listener, and is invisible to the page in every other way
 * — but it DOES reach the automation boundary as a page error, and the build
 * exits non-zero with every assertion green. Worse, a rejected DOMException
 * arrives there carrying its MESSAGE, while this lab's own codes are forbidden
 * from living in a message at all, so the failure would be unattributable.
 *
 * EVERY FIELD OF EVERY INBOUND MESSAGE IS REBUILT with String() and |0 rather
 * than trusted. postMessage refuses an unclonable value loudly with
 * DataCloneError; the boundary this run's result eventually crosses corrupts
 * silently instead. This lab crosses both, so nothing is trusted at either.
 */
/* global importScripts, SEROBOT_KODE, SEROBOT_DB, SEROBOT_ARMS, SEROBOT_KUNCI, SEROBOT_GUARD */
importScripts('guard.js', 'kode.js', 'db.js', 'kunci.js', 'arms.js');

(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var DB = root.SEROBOT_DB;
  var ARMS = root.SEROBOT_ARMS;
  var KUNCI = root.SEROBOT_KUNCI;
  var GUARD = root.SEROBOT_GUARD;

  var ctx = null;
  var db = null;
  var w = 0;
  var tahan = null;

  function kirim(m) {
    try { root.postMessage(m); } catch (e) { /* nothing to say and nowhere to say it */ }
  }

  function nama(e) { return KODE ? KODE.nameOf(e) : 'Error'; }
  function kode(e) { return KODE ? KODE.codeOf(e) : ''; }

  /* The listener that keeps a rejection out of the build. preventDefault stops
     it reaching the page as a page error; the postMessage is what makes it a
     result instead of a silence. */
  root.addEventListener('unhandledrejection', function (e) {
    try { e.preventDefault(); } catch (x) { }
    kirim({ t: 'urj', name: nama(e.reason), code: kode(e.reason), w: w });
  });

  /* An egress ATTEMPT anywhere in this realm becomes a message the page folds
     into its own count. Nothing here ever attempts one; the wiring exists so
     the claim is enforced rather than asserted. */
  if (GUARD) {
    GUARD.onchange = function () {
      var last = GUARD.log.length ? GUARD.log[GUARD.log.length - 1] : null;
      if (!last) return;
      kirim({ t: 'net', kind: String(last.kind), target: String(last.target).slice(0, 180) });
    };
  }

  /* Whether THIS realm is being counted at all, MEASURED here and reported
     rather than assumed by the page. A meta CSP does not reach a worker realm,
     so the only thing between this realm and a request that leaves the origin
     in silence is guard.js having been imported HERE and its wrappers having
     replaced the natives HERE. No page can check that from outside: there is no
     route from one realm into another realm's objects, which is the whole
     reason the fold exists. So the worker states it, and the suite pins the
     statement against the number of workers it spawned. Measured before this
     existed: a worker shipped with guard.js REMOVED from the import list above
     changed not one assertion in the suite. */
  function dijaga() {
    if (!GUARD || typeof GUARD.total !== 'function') return 0;
    var f = '';
    try { f = String(root.fetch); } catch (e) { return 0; }
    return f.indexOf('native code') < 0 ? 1 : 0;
  }

  function gagal(arm, e) {
    kirim({ t: 'err', arm: String(arm || ''), name: nama(e), code: kode(e), w: w });
  }

  function tutup() {
    if (db) { try { db.close(); } catch (e) { } db = null; }
  }

  function selesai() {
    tutup();
    kirim({ t: 'done', w: w, egress: GUARD ? GUARD.total() : 0, jaga: dijaga() });
  }

  function jalankan(m) {
    w = m.id;
    var n = m.n;
    var arms = m.arms;
    var mode = m.barrier ? 'hadang' : 'lepas';

    /* The run's own lock-name prefix, applied by the lock helper itself. Two
       runs sharing one lock name serialise against each other and the second
       one's numbers are the first one's. */
    if (KUNCI) KUNCI.pakaiAwalan(m.lockPrefix);

    try {
      ctx = ARMS.ctx({
        mode: mode,
        w: w,
        tag: 'R',
        post: kirim,
        /* THE BARRIER'S DEADLINE ARRIVES FROM HERE. arms.js cannot name a timer
           function without breaking the grep that proves it inserts no delay,
           so the phase deadline is injected by the only caller that has one.
           Without it a dropped release message hangs this worker until the
           squad's watchdog fires, instead of failing by name. */
        timer: function (cb, ms) { return root.setTimeout(cb, ms); },
        untimer: function (id) { return root.clearTimeout(id); },
        budget: KODE.ANGKA.barrierPhase
      });
    } catch (e) {
      gagal('', e);
      selesai();
      return;
    }

    DB.open(m.db).then(function (handle) {
      db = handle;
      return ARMS.putar(db, ctx, arms, n);
    }).then(function () {
      selesai();
    }, function (e) {
      /* One failure, one report, and the run still completes. A worker that
         goes quiet leaves the squad waiting on a count that will never arrive. */
      gagal('', e);
      selesai();
    });
  }

  /* The queue panel's participant. It takes a named lock and holds it until it
     is told to let go or the page terminates it — which is the only difference
     between a Web Lock and a lease that matters: this one is released by the
     browser when the agent dies, with no expiry window and nothing to wait for. */
  function pegangKunci(m) {
    if (!KUNCI || !KUNCI.ada()) {
      kirim({ t: 'kunci', state: 'failed', name: 'E_KUNCI_TIADA' });
      return;
    }
    KUNCI.pakaiAwalan(m.lockPrefix);
    tahan = KUNCI.tahan(m.name, { signal: AbortSignal.timeout(KUNCI.BUDGET * 30) });
    tahan.masukP.then(function (rec) {
      kirim({ t: 'kunci', state: rec.gagal ? 'failed' : 'held', name: rec.gagal || rec.name });
    });
    tahan.selesai.then(function (rec) {
      kirim({ t: 'kunci', state: 'released', name: rec.name });
    });
  }

  root.onmessage = function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    var t = String(d.t == null ? '' : d.t);

    if (t === 'go') {
      jalankan({
        id: d.id | 0,
        n: d.n | 0,
        arms: bersihArms(d.arms),
        barrier: !!d.barrier,
        db: String(d.db == null ? '' : d.db),
        lockPrefix: String(d.lockPrefix == null ? '' : d.lockPrefix),
        runId: String(d.runId == null ? '' : d.runId)
      });
      return;
    }
    if (t === 'jalan') {
      if (ctx) ctx.jalan(String(d.arm == null ? '' : d.arm), d.r | 0, String(d.p == null ? '' : d.p));
      return;
    }
    if (t === 'kunci-tahan') {
      pegangKunci({
        name: String(d.name == null ? 'antre' : d.name),
        lockPrefix: String(d.lockPrefix == null ? '' : d.lockPrefix)
      });
      return;
    }
    if (t === 'kunci-lepas') {
      if (tahan) tahan.lepas();
      return;
    }
  };

  function bersihArms(a) {
    var out = [], i;
    if (!a || typeof a.length !== 'number') return out;
    for (i = 0; i < a.length; i++) out.push(String(a[i]));
    return out;
  }

  root.onmessageerror = function () {
    kirim({ t: 'err', arm: '', name: 'DataCloneError', code: 'E_MODE', w: w });
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
