/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — idem.js
 * EXACTLY ONCE. One fabricated webhook, one integer amount, delivered TWICE
 * CONCURRENTLY on one event loop — deterministic, no race, nothing to be lucky
 * about — and four services that each think they handle it.
 *
 *   periksa-saja  read the index, see nothing, then insert and credit, WITH A
 *                 LOCK AROUND THE WRITE          -> 1000 stored, 2 rows
 *   atomik        the key insert and the effect in ONE transaction
 *                                                -> 500 stored, 1 row, second
 *                                                   delivery refused
 *   pisah-txn     key in transaction A, credit in transaction B
 *                                                -> 500 stored, 1 row
 *   tanpa-kunci   no key at all, on the broken read-modify-write
 *                                                -> 500 stored, the RIGHT answer
 *                                                   out of two live bugs
 *
 * THE FIRST ONE IS THE LESSON. Both deliveries read the index before either one
 * wrote, so both saw nothing, and serialising the WRITE did not help because the
 * CHECK was outside the critical section. A CHECK IS NOT A CONSTRAINT. The lock
 * is real, it is held, it does exactly what a lock does, and the money still
 * doubles.
 *
 * THE LAST ONE IS THE ONE PEOPLE MISREAD. It reports the correct number from two
 * live bugs cancelling: the missing key should have doubled the balance to 1000,
 * and the lost update ate the second credit. The ledger beside it says so — two
 * rows, a derived total of 1000, a stored column of 500. YOU CANNOT SEE THE
 * IDEMPOTENCY BUG UNTIL YOU HAVE FIXED THE CONCURRENCY BUG.
 *
 * TWO LEDGER STORES, AND THAT IS NOT TIDINESS. The first attempt put all four
 * modes in one store behind one unique index and died on ConstraintError at every
 * throttle rate, because periksa-saja must be ABLE to write two rows under one
 * key — that is the whole point being demonstrated. So led_n has the index
 * without the constraint and models a service that has only a check, led_u has
 * the constraint, and each mode names which service it is.
 *
 * AND THE ANSWER TO "IS A UNIQUE INDEX ENOUGH?" — necessary, not sufficient.
 * periksa-saja double-credits with a mutex on the write, and pisah-txn splits the
 * guarantee across two transactions. What works is that the key insert and the
 * effect share one transaction.
 *
 * pisah-txn IS ASSERTED AT [500, 1, 500], not [0, 1, 500]. The loser is refused
 * by the constraint and the WINNER's later credit still runs. Getting a recorded
 * key with no money behind it needs the winner to die between its two
 * transactions, and this lab cannot kill a process. So the seam is shown — two
 * transactions, printed — and the consequence is named rather than staged: if the
 * process does die there, the payment is marked processed forever and no retry
 * can repair it.
 *
 * DOM-free. Storage goes through db.js and the lock arrives injected, because
 * exactly one file in this lab is allowed to ask the browser for a lock.
 */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var NS = {};

  NS.MODES = ['periksa-saja', 'atomik', 'pisah-txn', 'tanpa-kunci'];
  NS.AMOUNT = 500;
  NS.KEY = 'IDEM-FIKTIF-0001';
  NS.LEDGER = { 'periksa-saja': 'led_n', 'atomik': 'led_u', 'pisah-txn': 'led_u', 'tanpa-kunci': 'led_u' };

  function DB() { return root.SEROBOT_DB; }

  /* ------------------------------------------------------------ the key */

  /* Fabricated, and shaped so it cannot be mistaken for a credential by a human
     or by a secret scanner: a fixed visible prefix, a decimal counter, nothing
     with entropy in it. Push protection has rejected a push to this repository
     before, and a lab full of invented payment keys is exactly where that
     happens twice. */
  NS.buatKunci = function (seq) {
    KODE.rupiah(seq, 'idempotency sequence');
    var s = String(seq);
    while (s.length < 4) s = '0' + s;
    return 'IDEM-FIKTIF-' + s;
  };

  var BENTUK = /^IDEM-FIKTIF-[0-9]{4}$/;
  NS.bentuk = function (k) {
    if (typeof k !== 'string' || !BENTUK.test(k)) {
      throw KODE.refuse('E_KUNCI_BENTUK', 'an idempotency key must read IDEM-FIKTIF-nnnn');
    }
    return k;
  };

  /* ----------------------------------------------------------- plumbing */

  function tugas() {
    return new Promise(function (res) { root.setTimeout(res, 0); });
  }

  /* The failing request carries the name, not the transaction: t.error is still
     null while the error event bubbles. Read it the other way and the
     ConstraintError that IS the finding here arrives as a generic refusal. */
  function txDone(t, out) {
    function sebab(ev) {
      var e = null;
      try { e = ev && ev.target ? ev.target.error : null; } catch (x) { e = null; }
      return e || t.error || KODE.refuse('E_MODE', 'the transaction failed');
    }
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(out()); };
      t.onerror = function (ev) { reject(sebab(ev)); };
      t.onabort = function (ev) { reject(sebab(ev)); };
    });
  }

  /* The index read the first mode does. readonly, its own transaction, and — the
     whole point — finished long before anybody writes. */
  function lihatKunci(db, store, idem) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, 'readonly');
      var g = t.objectStore(store).index('by_idem').get(String(idem));
      var hit = null;
      g.onsuccess = function () { hit = g.result || null; };
      txDone(t, function () { return hit; }).then(resolve, reject);
    });
  }
  NS.lihatKunci = lihatKunci;

  function baris(id, idem, delta) {
    var row = { id: String(id), delta: KODE.rupiah(delta, 'ledger delta'), at: 0 };
    /* An absent index key is not indexed at all, which is how the no-key mode
       writes two rows into a store whose index is unique without touching the
       constraint. A null would not do it: null is not a valid key either, but
       writing one is a claim that a key exists and is empty. */
    if (idem !== null) row.idem = String(idem);
    return row;
  }

  /* The key insert and the effect in ONE transaction. This is the shape that
     works, and it is four lines. */
  function atomik1(db, store, id, idem, amount) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction([store, 'acc'], 'readwrite');
      t.objectStore(store).add(baris(id, idem, amount));
      var acc = t.objectStore('acc');
      var g = acc.get(DB().AKUN);
      g.onsuccess = function () {
        var v = g.result ? g.result.v : 0;
        acc.put({ k: DB().AKUN, v: v + amount });
      };
      txDone(t, function () { return true; }).then(resolve, reject);
    });
  }

  function tulisBaris(db, store, id, idem, amount) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, 'readwrite');
      t.objectStore(store).add(baris(id, idem, amount));
      txDone(t, function () { return true; }).then(resolve, reject);
    });
  }

  /* A credit that is itself safe: read and write inside one transaction. Used by
     every mode except the last, so that when a total is wrong the reason is the
     key handling and never the credit. */
  function kredit(db, amount) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction('acc', 'readwrite');
      var os = t.objectStore('acc');
      var g = os.get(DB().AKUN);
      var next = 0;
      g.onsuccess = function () {
        var v = g.result ? g.result.v : 0;
        next = v + amount;
        os.put({ k: DB().AKUN, v: next });
      };
      txDone(t, function () { return next; }).then(resolve, reject);
    });
  }

  /* The broken credit, kept in one place: read in one transaction, yield, write
     in a later one. The last mode is built on it on purpose. */
  function kreditPisah(db, amount) {
    return DB().read(db, 'acc', DB().AKUN).then(function (v) {
      var seen = v === null ? 0 : v;
      return tugas().then(function () {
        return DB().write(db, 'acc', DB().AKUN, seen + amount);
      });
    });
  }

  /* The critical section. A real Web Lock arrives injected, because exactly one
     file in this lab may call the browser's lock manager and this is not it. With
     nothing injected the fallback is a promise-chain section, which is genuine
     mutual exclusion on one event loop — and the mode's finding does not move
     either way, because what fails here is the check outside the section and not
     the section. The result says which one ran; the panel prints it. */
  function pegang(opts) {
    var injected = opts && typeof opts.hold === 'function' ? opts.hold : null;
    if (injected) return { kind: 'suntik', run: injected };
    var K = root.SEROBOT_KUNCI;
    if (K && typeof K.hold === 'function') {
      return {
        kind: 'kunci',
        run: function (name, fn) {
          return K.hold(name, { signal: AbortSignal.timeout(K.BUDGET) }, fn);
        }
      };
    }
    var tail = Promise.resolve(null);
    return {
      kind: 'rantai',
      run: function (name, fn) {
        var r = tail.then(fn);
        tail = r['catch'](function () { return null; });
        return r;
      }
    };
  }

  /* ------------------------------------------------------------ the modes */

  function deliver(db, mode, i, idem, amount, lock, out) {
    var store = NS.LEDGER[mode];
    var id = 'LED-FIKTIF-' + String(i);

    if (mode === 'periksa-saja') {
      /* Check, then act, with the act serialised and the check not. Both
         deliveries are already past the check before the first one takes the
         lock. */
      return lihatKunci(db, store, idem).then(function (hit) {
        out.saw.push(hit ? 1 : 0);
        if (hit) { out.absorbed = out.absorbed + 1; return 'duplicate'; }
        return lock.run('idem', function () {
          return tulisBaris(db, store, id, idem, amount).then(function () {
            return kredit(db, amount);
          });
        }).then(function () { out.applied = out.applied + 1; return 'applied'; });
      });
    }

    if (mode === 'atomik') {
      out.tx = out.tx + 1;
      return atomik1(db, store, id, idem, amount).then(function () {
        out.applied = out.applied + 1;
        return 'applied';
      });
    }

    if (mode === 'pisah-txn') {
      /* Transaction A records the key. Transaction B moves the money. Nothing
         binds them, and the gap between them is the seam. */
      out.tx = out.tx + 2;
      return tulisBaris(db, store, id, idem, amount).then(function () {
        return kredit(db, amount);
      }).then(function () { out.applied = out.applied + 1; return 'applied'; });
    }

    if (mode === 'tanpa-kunci') {
      /* No key at all, on the read-modify-write that spans a transaction
         boundary. Two bugs, and they cancel. */
      return tulisBaris(db, store, id, null, amount).then(function () {
        return kreditPisah(db, amount);
      }).then(function () { out.applied = out.applied + 1; return 'applied'; });
    }

    throw KODE.refuse('E_MODE', 'unknown idempotency mode');
  }

  NS.run = function (db, mode, opts) {
    opts = opts || {};
    if (NS.MODES.indexOf(mode) < 0) {
      return Promise.reject(KODE.refuse('E_MODE', 'unknown idempotency mode'));
    }
    var amount = KODE.bulat(opts.amount) ? opts.amount : NS.AMOUNT;
    KODE.rupiah(amount, 'webhook amount');
    var idem = NS.bentuk(opts.idem || NS.KEY);
    var store = NS.LEDGER[mode];
    var lock = pegang(opts);
    var out = {
      mode: String(mode),
      ledger: String(store),
      unique: store === 'led_u',
      amount: amount,
      idem: idem,
      deliveries: 2,
      applied: 0,
      absorbed: 0,
      refused: [],
      saw: [],
      tx: 0,
      holdKind: lock.kind,
      stored: 0,
      rows: 0,
      derived: 0,
      why: 'ok'
    };

    function guard(p) {
      return p['catch'](function (e) {
        /* Every refusal crosses as a NAME. Chromium's message text is 74
           characters of somebody else's prose and this lab never asserts it. */
        out.refused.push(String(KODE.nameOf(e)));
        return 'refused';
      });
    }

    /* BOTH DELIVERIES IN ONE SYNCHRONOUS TURN. That is what "arriving at once"
       means here, and it is the only thing arranged: no timer, no jitter, no
       repetition until it fails. */
    var a = guard(deliver(db, mode, 1, idem, amount, lock, out));
    var b = guard(deliver(db, mode, 2, idem, amount, lock, out));

    return Promise.all([a, b]).then(function () {
      return DB().read(db, 'acc', DB().AKUN);
    }).then(function (v) {
      out.stored = v === null ? 0 : v;
      return DB().rowsVia(db, store, 'objectStore', null);
    }).then(function (env) {
      var deltas = [], i;
      for (i = 0; i < env.rows.length; i++) deltas.push(env.rows[i].delta);
      out.rows = env.count;
      out.derived = KODE.jumlah(deltas, 'ledger deltas');
      out.agree = out.derived === out.stored;
      return out;
    });
  };

  /* ------------------------------------------------------- add() vs put() */

  /* The pair, because it is the fix this repository has already made once: a
     ledger id from a per-tab counter used as a key, one tab silently destroying
     another tab's entries, repaired by exactly this one-word change. put() over
     an existing key overwrites and tells nobody; add() throws. */
  NS.pasangan = function (db) {
    var out = { addKedua: '', putKedua: '', rowsAfterAdd: 0, deltaAfterPut: 0 };
    var id = 'LED-FIKTIF-pair';
    return tulisBaris(db, 'led_u', id, 'IDEM-FIKTIF-0002', 100).then(function () {
      return tulisBaris(db, 'led_u', id, 'IDEM-FIKTIF-0003', 900)['catch'](function (e) {
        out.addKedua = String(KODE.nameOf(e));
        return null;
      });
    }).then(function () {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('led_u', 'readwrite');
        t.objectStore('led_u').put({ id: id, idem: 'IDEM-FIKTIF-0004', delta: 900, at: 0 });
        txDone(t, function () { return true; }).then(resolve, reject);
      })['catch'](function (e) { out.putKedua = String(KODE.nameOf(e)); return null; });
    }).then(function () {
      return DB().rowsVia(db, 'led_u', 'objectStore', null);
    }).then(function (env) {
      var i;
      out.rowsAfterAdd = env.count;
      for (i = 0; i < env.rows.length; i++) if (env.rows[i].id === id) out.deltaAfterPut = env.rows[i].delta;
      if (!out.putKedua) out.putKedua = 'accepted';
      return out;
    });
  };

  /* -------------------------------------------------- the replay window */

  /* Transcribed from a shape that ships in this repository: a seen-list carried
     on the record, checked before applying, and TRUNCATED TO ITS LAST N ENTRIES
     so it cannot grow without bound. The truncation is the bug. A key that
     returns after N other operations is no longer in the window, so it is applied
     a second time — and unlike the check-then-act problem next door this one
     needs no concurrency at all. Pure; it never touches storage. */
  NS.jendela = function (win, keys) {
    if (!KODE.bulat(win) || win < 1) throw KODE.refuse('E_MODE', 'the window must be a positive integer');
    if (Object.prototype.toString.call(keys) !== '[object Array]') {
      throw KODE.refuse('E_MODE', 'the operation list must be an array');
    }
    var seen = [], applied = 0, absorbed = 0, replayed = [], everSeen = {}, i, k;
    for (i = 0; i < keys.length; i++) {
      k = String(keys[i]);
      if (seen.indexOf(k) >= 0) { absorbed = absorbed + 1; continue; }
      if (everSeen[k]) replayed.push(k);
      everSeen[k] = true;
      applied = applied + 1;
      seen.push(k);
      if (seen.length > win) seen = seen.slice(-win);
    }
    return { win: win, ops: keys.length, applied: applied, absorbed: absorbed, replayed: replayed, held: seen.length };
  };

  root.SEROBOT_IDEM = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
