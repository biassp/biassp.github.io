/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — utas.js
 * ONE EVENT LOOP. No workers, no parallelism, and the same money gone.
 *
 * This is the panel that matters most to a working engineer, and the one whose
 * numbers are EXACT where the worker panel's are only interesting. Read a value,
 * await anything that reaches the task queue, write the value back, and the
 * outcome is not a distribution — it is n, whatever W is:
 *
 *     naive W=2  n=1  -> 1      W=2  n=10 -> 10     W=2  n=50 -> 50
 *     naive W=3  n=10 -> 10     W=4  n=25 -> 25     W=5  n=20 -> 20
 *     naive W=8  n=5  -> 5      W=10 n=10 -> 10
 *     the same code with no await at all              -> W*n every time
 *
 * TEN WRITERS DOING TEN INCREMENTS EACH PRODUCE TEN, NOT ONE HUNDRED. That is
 * the correction this file exists to carry: OS-thread parallelism is NOT what
 * causes a lost update. The cause is a read-set that spans an await. Parallelism
 * makes the interleaving easy to hit; it is not what makes it possible. The
 * minimal case is W=2, n=1 -> 1, and two awaits are the entire bug.
 *
 * FIVE STRATEGIES, ONE VARIABLE, and the differences are all in one place:
 *
 *   polos   read, await a task, write            BROKEN     final === n
 *   noio    the identical code with no await     control    final === W*n
 *   mutex   a promise-chain critical section     correct    final === W*n
 *   cas     version compare-and-set with retry   correct    final === W*n
 *   tambah  append to a log, total on read       correct    final === W*n, 0 reads
 *
 * THE RETRY COUNT IS TRIANGULAR, NOT (W-1)n. That was the shape everybody
 * expected and it is wrong the moment W exceeds two: at W=4 n=25 the real figure
 * is 150 and (W-1)n predicts 75. Each sweep in which every writer lands exactly
 * one success costs (W-1) + (W-2) + ... + 1 retries, because the losers re-read
 * and re-queue behind each other in order, so the total is W(W-1)/2 * n. The two
 * formulas coincide only at W=2, which is why nobody noticed.
 *
 * THERE IS NO BARRIER IN HERE, deliberately. A barriered compare-and-set
 * deadlocks: the retry loop makes arrivals-per-round variable, so the winner
 * advances while the losers wait on a count that will never reach W. The event
 * loop's own lockstep supplies all the determinism this panel needs.
 *
 * THE RETRY LOOP IS CAPPED AND THE CAP IS NOT OPTIONAL. An unbounded retry loop
 * is a livelock waiting for a slow writer, and inside an automation evaluate —
 * which has no timeout of its own — it is a job that hangs to the fifteen-minute
 * cap with no diagnostic at all. A caller asking for no cap is refused
 * synchronously with E_CAS_NO_CAP, and the cap firing is proved by INJECTING a
 * version source that always reports a conflict, which is deterministic and
 * needs no race.
 *
 * DOM-free, storage-free. The only host facility it reaches for is the task
 * queue, because the task queue is the subject.
 */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var NS = {};

  NS.NAMES = ['polos', 'noio', 'mutex', 'cas', 'tambah'];
  NS.CAP = 1000;

  /* The await under test, and the reason it is a TASK is narrower than the
     reason this comment used to give. It used to say a microtask "would not do"
     for the interleave. That is false and it was measured false: with a
     microtask yield in this exact position, every (W, n) pair still ends at n,
     because all W writers are STARTED in one turn and a microtask is enough of a
     boundary for the next one to read before this one writes. The read-set
     spanning ANY await is the bug, which is the whole of the correction the
     centrepiece panel makes about parallelism, applied to itself.

     A task boundary is used anyway, for a different and real reason: it is the
     one boundary that also kills an IndexedDB transaction (a hundred thousand
     chained microtasks do not), so the single-thread panel and the
     transaction-death panel one card below are separated by exactly one variable
     instead of two. */
  function tugas() {
    return new Promise(function (res) { root.setTimeout(res, 0); });
  }
  NS.tugas = tugas;

  /* ------------------------------------------------------- the step log */

  /* Integer sequence numbers, issued here, one per await boundary. Nothing in
     this lab is ordered by a clock: two events inside one turn share a
     millisecond, and the guard below refuses a reading handed in as a key. */
  function jejak(limit) {
    var s = KODE.urut();
    var cap = KODE.bulat(limit) && limit > 0 ? limit : 4000;
    var out = { entries: [], dropped: 0 };
    out.push = function (w, act, v) {
      if (out.entries.length >= cap) { out.dropped = out.dropped + 1; return null; }
      var e = { s: s.next(), w: w, act: act, v: KODE.rupiah(v, 'log.v') };
      out.entries.push(e);
      return e;
    };
    /* The refusal, reachable from outside so the negative is a real execution
       and not a comment: hand it a clock reading and it goes red. */
    out.key = function (k) { return KODE.kunciUrut(k); };
    return out;
  }
  NS.jejak = jejak;

  /* ------------------------------------------------------- the strategies */

  function polos(W, n, J, opts) {
    var cell = { v: 0 };
    var reads = 0, writes = 0;
    function writer(w) {
      var i = 0;
      function step() {
        if (i >= n) return Promise.resolve(null);
        i = i + 1;
        /* The read-set is one integer and it is captured HERE. Everything after
           the await is arithmetic on a value about the past. */
        var v = cell.v;
        reads = reads + 1;
        J.push(w, 'read', v);
        return tugas().then(function () {
          cell.v = v + 1;
          writes = writes + 1;
          J.push(w, 'write', cell.v);
          return step();
        });
      }
      return step();
    }
    return all(W, writer).then(function () {
      return { final: cell.v, reads: reads, writes: writes, retries: 0, foldKind: 'last' };
    });
  }

  function noio(W, n, J) {
    var cell = { v: 0 };
    var reads = 0, writes = 0, w, i, v;
    /* The identical body with the await removed. Nothing yields, so no writer
       can be interleaved with another, and this is the control that proves the
       await is the variable and the loop is not. */
    for (w = 0; w < W; w++) {
      for (i = 0; i < n; i++) {
        v = cell.v;
        reads = reads + 1;
        J.push(w, 'read', v);
        cell.v = v + 1;
        writes = writes + 1;
        J.push(w, 'write', cell.v);
      }
    }
    return Promise.resolve({ final: cell.v, reads: reads, writes: writes, retries: 0, foldKind: 'last' });
  }

  function mutex(W, n, J) {
    var cell = { v: 0 };
    var reads = 0, writes = 0;
    /* A critical section built out of the one ordering primitive a single event
       loop already has: a promise chain. Every section is appended to the tail,
       so the read and the write of one section cannot be separated by another
       section's read even though the await between them is still there. */
    var tail = Promise.resolve(null);
    function guard(fn) {
      var r = tail.then(fn);
      tail = r['catch'](function () { return null; });
      return r;
    }
    function writer(w) {
      var i = 0;
      function step() {
        if (i >= n) return Promise.resolve(null);
        i = i + 1;
        return guard(function () {
          var v = cell.v;
          reads = reads + 1;
          J.push(w, 'read', v);
          return tugas().then(function () {
            cell.v = v + 1;
            writes = writes + 1;
            J.push(w, 'write', cell.v);
          });
        }).then(step);
      }
      return step();
    }
    return all(W, writer).then(function () {
      return { final: cell.v, reads: reads, writes: writes, retries: 0, foldKind: 'last' };
    });
  }

  function cas(W, n, cap, J, opts) {
    /* No cap, no loop. An unbounded retry loop is a livelock waiting for a slow
       writer, and inside an evaluate with no timeout it is a job that hangs to the
       fifteen-minute cap with no diagnostic. */
    if (!(cap > 0)) throw KODE.refuse('E_CAS_NO_CAP', 'a retry loop was requested with no cap');
    var cell = { v: 0, ver: 0 };
    var reads = 0, writes = 0, retries = 0;
    var versi = opts && typeof opts.versi === 'function' ? opts.versi : null;
    function ver() { return versi ? versi(cell) : cell.ver; }
    function writer(w) {
      var ok = 0, run = 0;
      function step() {
        if (ok >= n) return Promise.resolve(null);
        var v = cell.v, seen = ver();
        reads = reads + 1;
        J.push(w, 'read', v);
        return tugas().then(function () {
          if (ver() === seen) {
            cell.v = v + 1;
            cell.ver = cell.ver + 1;
            ok = ok + 1;
            run = 0;
            writes = writes + 1;
            J.push(w, 'write', cell.v);
          } else {
            retries = retries + 1;
            run = run + 1;
            if (run > cap) throw KODE.refuse('E_CAS_CAP', 'the retry cap was reached');
          }
          return step();
        });
      }
      return step();
    }
    return all(W, writer).then(function () {
      return { final: cell.v, reads: reads, writes: writes, retries: retries, foldKind: 'last' };
    });
  }

  function tambah(W, n, J) {
    /* Nothing reads the total before writing, so there is no read-set to go
       stale. The total is a fold over the log at read time, and the log is
       append-only: the same shape the ledger arm uses one tab over, minus the
       transaction. */
    var log = [];
    var reads = 0, writes = 0;
    function writer(w) {
      var i = 0;
      function step() {
        if (i >= n) return Promise.resolve(null);
        i = i + 1;
        return tugas().then(function () {
          log.push({ w: w, delta: 1 });
          writes = writes + 1;
          J.push(w, 'write', 1);
          return step();
        });
      }
      return step();
    }
    return all(W, writer).then(function () {
      var t = 0, i;
      for (i = 0; i < log.length; i++) t = t + log[i].delta;
      return { final: t, reads: reads, writes: writes, retries: 0, rows: log.length, foldKind: 'sum' };
    });
  }

  function all(W, writer) {
    var ps = [], w;
    /* Every writer is started in ONE synchronous turn. That is not a trick to
       force the race — it is what "two requests arriving at once" means on a
       single-threaded runtime, and it is the only part of the setup that is
       arranged. */
    for (w = 0; w < W; w++) ps.push(writer(w));
    return Promise.all(ps);
  }

  /* --------------------------------------------------------------- run */

  NS.run = function (strategy, W, n, opts) {
    opts = opts || {};
    if (NS.NAMES.indexOf(strategy) < 0) {
      return Promise.reject(KODE.refuse('E_MODE', 'unknown single-thread strategy'));
    }
    if (!KODE.bulat(W) || W < 1) return Promise.reject(KODE.refuse('E_MODE', 'W must be a positive integer'));
    if (!KODE.bulat(n) || n < 1) return Promise.reject(KODE.refuse('E_MODE', 'n must be a positive integer'));
    var J = jejak(opts.logCap);
    var started;
    try {
      if (strategy === 'polos') started = polos(W, n, J, opts);
      else if (strategy === 'noio') started = noio(W, n, J);
      else if (strategy === 'mutex') started = mutex(W, n, J);
      else if (strategy === 'cas') started = cas(W, n, KODE.bulat(opts.cap) ? opts.cap : NS.CAP, J, opts);
      else started = tambah(W, n, J);
    } catch (e) {
      /* A synchronous refusal stays synchronous all the way to the caller's
         catch. Wrapping it in a rejected promise here would hand a thenable to a
         synchronous throws() helper, which records "did not throw" and then drops
         the rejection — and a dropped rejection is a page error that fails the
         whole lab with every assertion green. */
      throw e;
    }
    return started.then(function (r) {
      var out = {
        strategy: String(strategy),
        W: W,
        n: n,
        expected: W * n,
        final: r.final,
        reads: r.reads,
        writes: r.writes,
        retries: r.retries,
        triangular: (W * (W - 1) / 2) * n,
        lost: r.foldKind === 'sum' ? 0 : (W * n) - r.final,
        rows: KODE.bulat(r.rows) ? r.rows : 0,
        foldKind: r.foldKind,
        entries: J.entries.length,
        dropped: J.dropped,
        log: J.entries,
        why: 'ok'
      };
      return out;
    });
  };

  /* ------------------------------------------------------------- audit */

  /* A handful of properties over the WHOLE log, never one per entry. Two hundred
     increments is one property, not two hundred, and a suite that counted them
     the other way would be reporting its loop bounds as evidence. */
  NS.audit = function (res) {
    var log = res && res.log ? res.log : [];
    var i, e, prev = 0;
    var ordered = true, unique = true, clockFree = true;
    var seen = {};
    var per = {};
    var reads = 0, writes = 0;
    var fold = 0, lastWrite = null;
    for (i = 0; i < log.length; i++) {
      e = log[i];
      if (!(e.s > prev)) ordered = false;
      prev = e.s;
      if (seen[e.s]) unique = false;
      seen[e.s] = true;
      if (!KODE.bulat(e.s) || e.s >= 1e11) clockFree = false;
      if (!per[e.w]) per[e.w] = { w: e.w, reads: 0, writes: 0, orphans: 0, dangling: false, held: false };
      if (e.act === 'read') {
        reads = reads + 1;
        per[e.w].reads = per[e.w].reads + 1;
        /* A second read with no write between them is a compare-and-set that
           lost and went round again. It is not an unmatched read. */
        per[e.w].held = true;
      } else {
        writes = writes + 1;
        per[e.w].writes = per[e.w].writes + 1;
        if (per[e.w].reads > 0 && !per[e.w].held) per[e.w].orphans = per[e.w].orphans + 1;
        per[e.w].held = false;
        lastWrite = e.v;
        fold = fold + e.v;
      }
    }
    var perList = [], k, paired = true;
    for (k in per) {
      if (!Object.prototype.hasOwnProperty.call(per, k)) continue;
      per[k].dangling = per[k].held;
      perList.push(per[k]);
      /* "Every write matched to a read by the same writer." A write with no read
         standing behind it is the property going red; a read with no write is a
         retry, and the arithmetic below is what says how many of those there were
         supposed to be. A strategy with no reads at all — the append-only one —
         is paired by having nothing to match. */
      if (per[k].reads !== 0 && (per[k].orphans > 0 || per[k].dangling)) paired = false;
    }
    perList.sort(function (a, b) { return a.w - b.w; });
    var replay = res.foldKind === 'sum' ? writes : (lastWrite === null ? 0 : lastWrite);
    return {
      entries: log.length,
      dropped: res.dropped || 0,
      ordered: ordered,
      unique: unique,
      gapless: log.length === 0 ? true : (log[0].s === 1 && log[log.length - 1].s === log.length),
      clockFree: clockFree,
      reads: reads,
      writes: writes,
      countsAgree: reads === res.reads && writes === res.writes,
      perWriter: perList,
      paired: paired,
      /* reads - writes is the number of attempts that lost, and the engine
         counted those independently. Two routes to one integer. */
      retriesAgree: reads === 0 ? true : (reads - writes) === (res.retries || 0),
      fold: replay,
      sumOfWrites: fold,
      foldMatchesFinal: replay === res.final
    };
  };

  /* The printed log, for the panel and for a reader who wants to see the shape
     rather than the number: read A(0) · read B(0) · write A(1) · write B(1). */
  NS.tulis = function (res, limit) {
    var log = res && res.log ? res.log : [];
    var cap = KODE.bulat(limit) && limit > 0 ? limit : 12;
    var out = [], i;
    for (i = 0; i < log.length && i < cap; i++) {
      out.push(log[i].act + ' ' + String.fromCharCode(65 + (log[i].w % 26)) + '(' + log[i].v + ')');
    }
    if (log.length > cap) out.push('…');
    return out.join(' · ') + ' · final ' + res.final + ' of ' + res.expected;
  };

  /* What CI drives, as data. Every expectation here is EXACT and was measured
     30/30 at 1x and at 8x CPU throttle; none of it is a range and none of it is a
     duration. A pair is one property executed twice, not two properties. */
  NS.RENCANA = [
    { strategy: 'polos', W: 2, n: 1, final: 1 },
    { strategy: 'polos', W: 2, n: 10, final: 10 },
    { strategy: 'polos', W: 3, n: 10, final: 10 },
    { strategy: 'polos', W: 4, n: 25, final: 25 },
    { strategy: 'polos', W: 5, n: 20, final: 20 },
    { strategy: 'polos', W: 10, n: 10, final: 10 },
    { strategy: 'noio', W: 2, n: 50, final: 100 },
    { strategy: 'mutex', W: 3, n: 10, final: 30 },
    { strategy: 'cas', W: 2, n: 10, final: 20, retries: 10 },
    { strategy: 'cas', W: 4, n: 10, final: 40, retries: 60 },
    { strategy: 'tambah', W: 4, n: 25, final: 100 }
  ];

  root.SEROBOT_UTAS = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
