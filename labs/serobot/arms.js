/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — arms.js
 * THE CENTREPIECE. The same money, once as a stored column and once as an
 * append-only ledger, with the same writers racing both.
 *
 * THE ONE FILE. Three write shapes, one switch, twenty lines apart, so a reader
 * comparing them is comparing the shipped source and not a transcription of it.
 * The renderer prints these bodies with Function.prototype.toString and there is
 * no build step in this repository, so what is on screen is byte-for-byte what
 * ran. The keys differ per arm because one field cannot end at both n and W*n —
 * that was measured, it failed, and the page says so above the diff instead of
 * hiding it.
 *
 * WHY THE RENDEZVOUS IS NOT A DELAY. The barrier is a promise resolved by a
 * MESSAGE COUNT. There is no busy loop, no timer, no Atomics.wait — there is no
 * SharedArrayBuffer in this context to wait on. Two phases per round, and the
 * second one is load-bearing:
 *
 *     round r:  every writer READS v_r
 *               ---- barrier(arm, r, 'baca') ----  all reads done before any write
 *               every writer WRITES v_r + 1
 *               ---- barrier(arm, r, 'tulis') ---  all writes done before any read of r+1
 *
 * With only the read phase a fast writer opens round r+1's read before a slow
 * writer's round-r write has landed, and "final === n" quietly stops holding
 * while still looking deterministic across a few runs. Deleting the second phase
 * is one of the injected defects in the mutation gate, and it must go red.
 *
 * AND THE BARRIER CANNOT BE THE CAUSE OF THE LOSS, which is the objection this
 * design has to answer. It runs in ALL FOUR arms, the same number of times, in
 * the same rounds. Three of them lose nothing. What it does is force the
 * worst-case interleaving every time — a scheduler-forcing tool, not a fudge —
 * and the free column beside it is what happens when nobody is forcing anything.
 *
 * NO TIMER LIVES IN THIS FILE, and the check a stranger runs is the grep in the
 * build spec's independence table — the two timer-scheduling function names, over
 * this file — which must print NOTHING. That is why the needles assertNoTimer
 * looks for are assembled from halves below rather than written out: a file that
 * greps clean because it spells its own needles is a file that lies to the grep,
 * and neither the code nor these comments may name one. It is also why the
 * per-phase deadline arrives as an INJECTED timer function. The deadline is
 * real — five seconds, then E_HADANG_MATI, and the waiter is released rather
 * than left hanging — but the call that arms it belongs to the caller's realm.
 *
 * DOM-free, worker-free, and importScripts-able. Nothing in here knows whether
 * it is running on the page or inside a worker.
 */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var NS = {};

  NS.NAMES = ['pisah', 'satu', 'jurnal', 'kunci'];
  NS.BUDGET = 5000;

  /* The four verbs, resolved at CALL time and never at load time. The page loads
     this file before the lock helper and the worker imports it after — a file
     that only works in one of the two orders works by accident. */
  function read(db, store, key) { return root.SEROBOT_DB.read(db, store, key); }
  function write(db, store, key, v) { return root.SEROBOT_DB.write(db, store, key, v); }
  function rmwOne(db, store, key) { return root.SEROBOT_DB.rmwOne(db, store, key); }
  function append(db, id, idem, delta) { return root.SEROBOT_DB.append(db, id, idem, delta); }

  function lockHelper() {
    var K = root.SEROBOT_KUNCI;
    if (!K || typeof K.hold !== 'function') {
      throw KODE.refuse('E_KUNCI_TIADA', 'navigator.locks is not usable in this realm');
    }
    return K;
  }

  /* ---------------------------------------------------------- the switch */

  function credit(db, arm, ctx, r) {
    if (arm === 'pisah') {
      /* Read in one transaction. Write in a LATER one. The read-set spans a
         transaction boundary and that is the entire bug. */
      return read(db, 'akun', 'K-pisah').then(function (v) {
        return ctx.barrier(arm, r, 'baca').then(function () {
          return write(db, 'akun', 'K-pisah', v + 1);
        });
      }).then(function () { return ctx.barrier(arm, r, 'tulis'); });
    }
    if (arm === 'satu') {
      /* Same read, same write, ONE transaction. The rendezvous goes BEFORE the
         transaction opens, because there is no reachable point between this read
         and this write — which is what it means for a read-modify-write to be
         inside one transaction. Measured: a rendezvous placed inside throws
         TransactionInactiveError while oncomplete still fires. */
      return ctx.barrier(arm, r, 'baca').then(function () {
        return rmwOne(db, 'akun', 'K-satu');
      }).then(function () { return ctx.barrier(arm, r, 'tulis'); });
    }
    if (arm === 'jurnal') {
      /* No read. Nothing to be stale. add(), not put(), so a replayed
         idempotency key throws ConstraintError instead of overwriting. */
      return ctx.barrier(arm, r, 'baca').then(function () {
        return append(db, ctx.rowId(r), ctx.idem(r), 1);
      }).then(function () { return ctx.barrier(arm, r, 'tulis'); });
    }
    if (arm === 'kunci') {
      /* The pisah body verbatim, wrapped in an application-level lock. */
      var K = lockHelper();
      return ctx.barrier(arm, r, 'baca').then(function () {
        return K.hold('rmw', { signal: AbortSignal.timeout(K.BUDGET) }, function () {
          return read(db, 'akun', 'K-kunci').then(function (v) {
            return write(db, 'akun', 'K-kunci', v + 1);
          });
        });
      }).then(function () { return ctx.barrier(arm, r, 'tulis'); });
    }
    throw KODE.refuse('E_MODE', 'unknown arm');
  }
  NS.credit = credit;

  /* One loop iteration issues all of this run's credits, in this order, against
     the same clock — which is what lets the page claim the arms saw identical
     traffic. A per-arm loop would not be the same experiment. */
  NS.putar = function (db, ctx, arms, n) {
    var i = 0;
    function round(r) {
      if (r >= n) return Promise.resolve(ctx.w);
      var j = 0;
      function arm() {
        if (j >= arms.length) return round(r + 1);
        var a = arms[j];
        j = j + 1;
        return credit(db, a, ctx, r).then(arm);
      }
      return arm();
    }
    if (!KODE.bulat(n) || n < 1) return Promise.reject(KODE.refuse('E_MODE', 'n must be a positive integer'));
    for (i = 0; i < arms.length; i++) {
      if (NS.NAMES.indexOf(arms[i]) < 0) return Promise.reject(KODE.refuse('E_MODE', 'unknown arm'));
    }
    return round(0);
  };

  /* -------------------------------------------------- the barrier client */

  /* Free mode's barrier is an already-resolved promise, so the shape of every
     arm body is identical in both modes and the only thing that changes is
     whether anybody is waiting. */
  var DONE = Promise.resolve(null);

  NS.ctx = function (opts) {
    opts = opts || {};
    var mode = opts.mode === 'hadang' ? 'hadang' : 'lepas';
    var w = KODE.bulat(opts.w) ? opts.w : 0;
    var post = typeof opts.post === 'function' ? opts.post : null;
    var timer = typeof opts.timer === 'function' ? opts.timer : null;
    var budget = KODE.bulat(opts.budget) && opts.budget > 0 ? opts.budget : NS.BUDGET;
    var tag = String(opts.tag || 'R');
    var waits = {};

    if (mode === 'hadang' && !post) {
      throw KODE.refuse('E_MODE', 'barrier mode needs a post function');
    }

    function key(arm, r, p) { return String(arm) + '|' + String(r) + '|' + String(p); }

    var ctx = {
      w: w,
      mode: mode,
      /* Unique per writer per round, so the journal ends at exactly W*n rows and
         the unique index on the idempotency key is a real constraint rather than
         a decoration. */
      rowId: function (r) { return 'J-' + tag + '-w' + w + '-r' + r; },
      idem: function (r) { return 'IDEM-FIKTIF-' + tag + 'w' + w + 'r' + r; },
      barrier: function (arm, r, p) {
        if (mode === 'lepas') return DONE;
        var k = key(arm, r, p);
        if (waits[k]) return waits[k].promise;
        var slot = {};
        slot.promise = new Promise(function (resolve, reject) {
          slot.resolve = resolve;
          slot.reject = reject;
        });
        waits[k] = slot;
        if (timer) {
          slot.deadline = timer(function () {
            if (!waits[k]) return;
            delete waits[k];
            slot.reject(KODE.refuse('E_HADANG_MATI', 'a barrier phase never released'));
          }, budget);
        }
        post({ t: 'tiba', arm: String(arm), r: r, p: String(p), w: w });
        return slot.promise;
      },
      /* The coordinator's release, delivered as the plain message it arrived as. */
      jalan: function (arm, r, p) {
        var k = key(arm, r, p);
        var slot = waits[k];
        if (!slot) return false;
        delete waits[k];
        if (slot.deadline && typeof opts.untimer === 'function') opts.untimer(slot.deadline);
        slot.resolve(null);
        return true;
      },
      pending: function () {
        var n = 0, k;
        for (k in waits) if (Object.prototype.hasOwnProperty.call(waits, k)) n++;
        return n;
      }
    };
    return ctx;
  };

  /* ------------------------------------------------------ the coordinator */

  /* The other half of the rendezvous. It counts arrivals under a key of
     arm|round|phase and DELETES the key on release. An accumulating counter
     would release arm 1 on a mix of arm-1 and arm-2 arrivals and produce the
     right number most of the time, which is the worst possible failure mode: it
     happens to work because the barriers are totally ordered, and it stops
     working the moment they are not. */
  NS.coord = function (W, send) {
    if (!KODE.bulat(W) || W < 1) throw KODE.refuse('E_MODE', 'W must be a positive integer');
    if (typeof send !== 'function') throw KODE.refuse('E_MODE', 'the coordinator needs a send function');
    var counts = {};
    var released = 0;
    return {
      tiba: function (m) {
        if (!m || m.t !== 'tiba') throw KODE.refuse('E_MODE', 'not an arrival message');
        var k = String(m.arm) + '|' + String(m.r) + '|' + String(m.p);
        var c = (counts[k] || 0) + 1;
        counts[k] = c;
        if (c < W) return false;
        delete counts[k];
        released = released + 1;
        send({ t: 'jalan', arm: String(m.arm), r: m.r, p: String(m.p) });
        return true;
      },
      released: function () { return released; },
      open: function () {
        var n = 0, k;
        for (k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) n++;
        return n;
      }
    };
  };

  /* ------------------------------------------------- the on-screen source */

  /* Route B for "the arms differ by one line". Route A is the prose. This slices
     the live function's own text, so the two cannot drift apart without the
     assertion noticing. */
  NS.source = function (arm) {
    var all = String(credit);
    var needle = "if (arm === '" + arm + "')";
    var i = all.indexOf(needle);
    if (i < 0) throw KODE.refuse('E_MODE', 'unknown arm');
    var depth = 0, j, started = false;
    for (j = i; j < all.length; j++) {
      if (all.charAt(j) === '{') { depth++; started = true; }
      else if (all.charAt(j) === '}') { depth--; if (started && depth === 0) { j++; break; } }
    }
    return all.slice(i, j);
  };

  NS.sourceAll = function () { return String(credit); };

  /* No artificial DELAY, checked over the shipped text rather than promised in a
     comment. The needles are assembled from halves so that the grep in the
     independence table still prints nothing over this file.

     TWO KINDS OF CLOCK, AND CONFLATING THEM IS HOW A CHECK COMES TO CLAIM MORE
     THAN IT TESTS. A DELAY makes something happen later and would make the loss
     a property of the delay rather than of the code; those are `hits`, and one
     is a failure. A DEADLINE only fires when something has already gone wrong,
     changes nothing on the path that succeeds, and cannot manufacture an
     interleaving. There is exactly one on a write path — the lock request's
     AbortSignal.timeout in the kunci arm — it is visible in the body this file
     prints, and an earlier revision of this audit reported "no timer call was
     found" directly underneath it. So deadlines are now COUNTED AND NAMED
     rather than passed over: `tenggat` is the list, the suite pins its exact
     contents, and a second one appearing on a write path is a red line rather
     than a silence. */
  var TIMER_NEEDLES = [
    'set' + 'Timeout',
    'set' + 'Interval',
    'set' + 'Immediate',
    'request' + 'AnimationFrame',
    'Date' + '.now',
    'performance' + '.now',
    'while' + ' (Date'
  ];

  var DEADLINE_NEEDLES = [
    'Abort' + 'Signal.timeout',
    'Abort' + 'Controller'
  ];

  /* A FUNCTION is read back with Function.prototype.toString; a STRING is taken
     as already-read text; anything else audits the whole switch. The string case
     is here because it was missing and that was a footgun with a green face:
     handing this one arm's body in as text used to fall through to "audit
     everything", so an audit scoped to a single arm quietly answered about the
     file and agreed with itself. */
  NS.assertNoTimer = function (fn) {
    var text = typeof fn === 'string' ? fn : String(typeof fn === 'function' ? fn : NS.sourceAll());
    var hits = [], tenggat = [], i;
    for (i = 0; i < TIMER_NEEDLES.length; i++) {
      if (text.indexOf(TIMER_NEEDLES[i]) >= 0) hits.push(TIMER_NEEDLES[i]);
    }
    for (i = 0; i < DEADLINE_NEEDLES.length; i++) {
      if (text.indexOf(DEADLINE_NEEDLES[i]) >= 0) tenggat.push(DEADLINE_NEEDLES[i]);
    }
    return { ok: hits.length === 0, hits: hits, tenggat: tenggat };
  };

  /* ------------------------------------------------------- the W clamp */

  /* hardwareConcurrency legitimately returns 1 in a constrained container, and at
     W=1 the entire thesis collapses: pisah === satu, nothing is lost, and the
     audit's "duplicates were not absorbed" finding degenerates to 1 === 1.
     Measured, at W=1 n=20: pisah 20, satu 20. So barrier mode clamps, the CLAMP
     is what the suite asserts, and the raw value is printed beside it — no
     assertion in this lab reads hardwareConcurrency. */
  NS.clamp = function (hc) {
    if (!KODE.bulat(hc) || hc < 1) throw KODE.refuse('E_MODE', 'the core count must be a positive integer');
    return Math.max(KODE.ANGKA.clampMin, Math.min(KODE.ANGKA.clampMax, hc));
  };

  /* The only constructor of a free-mode container. Whatever assembles a free-mode
     result calls THIS and not the brand directly, so a container that reaches an
     assertion helper unbranded is a container that took a route that does not
     exist. */
  NS.seal = function (mode, out) { return KODE.seal(mode === 'lepas' ? 'lepas' : 'hadang', out); };

  root.SEROBOT_ARMS = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
