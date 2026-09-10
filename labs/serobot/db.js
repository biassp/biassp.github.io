/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — db.js
 * The schema, the run-scoped database, and the four one-line IndexedDB verbs the
 * rest of the lab is written in. This is the only file besides the renderer that
 * touches storage, and every store it creates is destroyed and rebuilt on each
 * run: visitor residue is a real bug in a lab whose whole subject is "the number
 * should be N", and a leftover row from yesterday reads exactly like a lost write.
 *
 * FIVE THINGS IN HERE ARE SCAR TISSUE, not preference.
 *
 * 1. THE DATABASE NAME CARRIES A RUN ID. Measured in this repository: two
 *    overlapping runs on one page destroy each other. The badge run and the
 *    automation's own call are concurrent by construction, and when they shared a
 *    database name, run B's delete fired onversionchange on run A's connection, A
 *    closed it, A's next transaction threw "the database connection is closing",
 *    and the whole evaluate died — a page error, with every assertion green. A
 *    single-flight latch upstream is the first defence; this name is the second,
 *    so a bypassed latch still cannot make two runs collide.
 *
 * 2. deleteDatabase HANGS FOREVER BEHIND AN OPEN CONNECTION. Measured with a
 *    2 000 ms budget: onblocked fires, onsuccess never does, and the automation's
 *    evaluate has no timeout of its own — so the ceiling is the job's 15-minute
 *    cap and the diagnostic is nothing at all. Hence a bounded fallback on the
 *    delete request and an explicit E_DB_BLOCKED, and hence onversionchange
 *    closing every connection the moment somebody else wants the version.
 *
 * 3. TWO LEDGER STORES, NOT ONE. The four idempotency modes cannot share a
 *    ledger: the mode that models a service with only a CHECK must be able to
 *    write two rows carrying one idempotency key — that is the entire point, that
 *    a check is not a constraint — and a unique index makes that impossible. The
 *    first attempt died on ConstraintError at every throttle rate. So led_n has
 *    the index without the constraint and led_u has it with, and each mode names
 *    which service it is modelling.
 *
 * 4. THE JOURNAL IS WRITTEN THROUGH add(), NEVER put(). put() over an existing
 *    key overwrites silently; add() throws ConstraintError. This portfolio has
 *    already shipped the other one: ledger ids from a per-tab counter used as a
 *    key, one tab destroying another tab's entries, fixed by exactly this change.
 *
 * 5. THE RAW READER IS AN OBJECT-STORE CURSOR AND SAYS SO IN ITS ENVELOPE. An
 *    index-backed read with a range would see a subset of the rows and report a
 *    perfectly clean fold over it, which is the one failure the witness route
 *    exists to make impossible. So provenance travels with the rows as a plain
 *    string the reader cannot lie about without being edited.
 *
 * DOM-free. Requires cleanly under node, where indexedDB is absent — every entry
 * point resolves the global lazily and refuses with E_DB_TIADA rather than
 * throwing at load time.
 */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var NS = {};

  /* §3.0. The keyPath and index columns are data because the page prints this
     table and the suite asserts against the same object: a schema described in
     prose beside a schema in code is two schemas. */
  var SCHEMA = [
    { store: 'akun', keyPath: 'k', indexes: [] },
    { store: 'jurnal', keyPath: 'id', indexes: [{ name: 'by_idem', on: 'idem', unique: true }] },
    { store: 'led_n', keyPath: 'id', indexes: [{ name: 'by_idem', on: 'idem', unique: false }] },
    { store: 'led_u', keyPath: 'id', indexes: [{ name: 'by_idem', on: 'idem', unique: true }] },
    { store: 'acc', keyPath: 'k', indexes: [] },
    { store: 'sewa', keyPath: 'k', indexes: [] }
  ];
  NS.SCHEMA = SCHEMA;

  /* One key per arm. One field cannot end at both n and W*n, and the attempt to
     make it do so is the first thing that was tried and the first thing that
     failed. The keys differ; the page prints the difference above the arms
     rather than hiding it. */
  NS.KEYS = ['K-pisah', 'K-satu', 'K-kunci', 'K-batas'];
  NS.AKUN = 'AKUN-FIKTIF-01';
  NS.SEWA = 'SEWA-FIKTIF-01';
  NS.HAPUS_BUDGET = 3000;

  function idb() {
    var v = null;
    try { v = root.indexedDB; } catch (e) { v = null; }
    return v || null;
  }
  NS.ada = function () { return !!idb(); };

  /* A fresh id per run, from the clock and the random source together: the clock
     alone collides inside one millisecond and the random source alone is
     unreadable in a devtools listing where a visitor is looking for their own
     run. Never used as an ordering key — nothing in this lab orders by time. */
  NS.runId = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
  NS.nameFor = function (runId) { return 'serobot-' + String(runId); };
  NS.lockPrefix = function (runId) { return 'srb-' + String(runId) + '-'; };

  /* ---------------------------------------------------------------- open */

  function open(dbName) {
    var api = idb();
    if (!api) return Promise.reject(KODE.refuse('E_DB_TIADA', 'IndexedDB is not available in this realm'));
    return new Promise(function (resolve, reject) {
      var req;
      try { req = api.open(String(dbName), 1); }
      catch (e) { reject(KODE.refuse('E_DB_TIADA', 'IndexedDB open threw synchronously')); return; }
      req.onupgradeneeded = function () {
        var db = req.result, i, j, s, os;
        for (i = 0; i < SCHEMA.length; i++) {
          s = SCHEMA[i];
          os = db.objectStoreNames.contains(s.store)
            ? req.transaction.objectStore(s.store)
            : db.createObjectStore(s.store, { keyPath: s.keyPath });
          for (j = 0; j < s.indexes.length; j++) {
            if (!os.indexNames.contains(s.indexes[j].name)) {
              os.createIndex(s.indexes[j].name, s.indexes[j].on, { unique: s.indexes[j].unique });
            }
          }
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        /* Somebody else wants the version. Holding the connection open here is
           how a delete becomes a fifteen-minute job with no diagnostic. */
        db.onversionchange = function () { db.close(); };
        resolve(db);
      };
      req.onerror = function () {
        reject(KODE.refuse('E_DB_TIADA', 'IndexedDB open was refused: ' + KODE.nameOf(req.error)));
      };
      req.onblocked = function () {
        reject(KODE.refuse('E_DB_BLOCKED', 'IndexedDB open blocked by another connection'));
      };
    });
  }
  NS.open = open;

  /* The delete, with the two mitigations that were measured to work: a real
     onblocked path, and a bounded fallback so a blocked delete becomes a report
     instead of a hang. The caller closes its own connections and terminates its
     own workers first — terminate() was measured to release, close() was
     measured to unblock, and neither happens by itself. */
  function drop(dbName, budget) {
    var api = idb();
    if (!api) return Promise.reject(KODE.refuse('E_DB_TIADA', 'IndexedDB is not available in this realm'));
    var ms = KODE.bulat(budget) && budget > 0 ? budget : NS.HAPUS_BUDGET;
    return new Promise(function (resolve, reject) {
      var settled = false, blocked = false, timer = null;
      function done(fn, v) {
        if (settled) return;
        settled = true;
        if (timer !== null) { root.clearTimeout(timer); timer = null; }
        fn(v);
      }
      var req;
      try { req = api.deleteDatabase(String(dbName)); }
      catch (e) { done(reject, KODE.refuse('E_DB_BLOCKED', 'deleteDatabase threw synchronously')); return; }
      req.onsuccess = function () { done(resolve, { deleted: true, blocked: blocked }); };
      req.onerror = function () {
        done(reject, KODE.refuse('E_DB_BLOCKED', 'deleteDatabase failed: ' + KODE.nameOf(req.error)));
      };
      req.onblocked = function () { blocked = true; };
      timer = root.setTimeout(function () {
        done(reject, KODE.refuse('E_DB_BLOCKED', 'deleteDatabase did not settle inside its budget'));
      }, ms);
    });
  }
  NS.drop = drop;

  /* A run always starts from a database that did not exist a moment ago. The
     starting value is asserted to be zero afterwards, never assumed here. */
  NS.fresh = function (dbName) {
    return drop(dbName)['catch'](function (e) {
      /* A delete of a database nobody ever created cannot be blocked; anything
         else here is worth reporting rather than swallowing. */
      if (KODE.codeOf(e) === 'E_DB_TIADA') throw e;
      throw e;
    }).then(function () { return open(dbName); });
  };

  /* ------------------------------------------------------------ the verbs */

  /* The transaction's own .error is still null while a request's error event is
     bubbling — it is set when the abort happens, one event later — so the name a
     request actually failed with has to be read off the event that carries it. A
     ConstraintError read the other way arrives as a generic refusal, and the
     negative assertion that pins it can then never be satisfied while still
     looking like a negative in the count. Measured here before it was written. */
  function sebab(ev, t, code, msg) {
    var e = null;
    try { e = ev && ev.target ? ev.target.error : null; } catch (x) { e = null; }
    return e || (t && t.error) || KODE.refuse(code, msg);
  }

  function txDone(t, out) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(out()); };
      t.onerror = function (ev) { reject(sebab(ev, t, 'E_DB_TIADA', 'transaction error')); };
      t.onabort = function (ev) { reject(sebab(ev, t, 'E_DB_TIADA', 'transaction aborted')); };
    });
  }

  /* One read, in its own readonly transaction. In the broken arm this is the
     whole first half of the bug: the transaction ends here, and the value the
     caller now holds is a value about the past. */
  NS.read = function (db, store, key) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, 'readonly');
      var g = t.objectStore(store).get(key);
      var v = null;
      g.onsuccess = function () { v = g.result ? g.result.v : null; };
      txDone(t, function () { return v; }).then(resolve, reject);
    });
  };

  NS.write = function (db, store, key, v) {
    KODE.rupiah(v, store + '.' + key);
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, 'readwrite');
      t.objectStore(store).put({ k: key, v: v });
      txDone(t, function () { return v; }).then(resolve, reject);
    });
  };

  /* Read and write inside ONE transaction, with nothing between them that could
     reach the event loop. The specification requires read-write transactions with
     overlapping scope to start in creation order and not run concurrently, so
     this pair cannot interleave with another copy of itself. That is the whole
     claim, and it is narrower than "IndexedDB is ACID". */
  NS.rmwOne = function (db, store, key) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, 'readwrite');
      var os = t.objectStore(store);
      var g = os.get(key);
      var next = null;
      g.onsuccess = function () {
        var v = g.result ? g.result.v : 0;
        next = v + 1;
        os.put({ k: key, v: next });
      };
      txDone(t, function () { return next; }).then(resolve, reject);
    });
  };

  /* add(), not put(). A replayed idempotency key must be refused, not absorbed. */
  NS.append = function (db, id, idem, delta, akun) {
    KODE.rupiah(delta, 'jurnal.delta');
    return new Promise(function (resolve, reject) {
      var t = db.transaction('jurnal', 'readwrite');
      var row = {
        id: String(id),
        akun: String(akun || NS.AKUN),
        delta: delta,
        idem: String(idem),
        at: 0
      };
      t.objectStore('jurnal').add(row);
      /* No handler on the request itself. The error event bubbles to the
         transaction, which is the one place this file settles a promise from —
         two rejection paths for one failure is one unhandled rejection, and one
         of those is a page error that fails the lab with everything green. */
      txDone(t, function () { return row; }).then(resolve, function (e) {
        if (KODE.nameOf(e) === 'ConstraintError') {
          reject(KODE.refuse('E_JURNAL_GANDA', 'a journal row with that key already exists'));
        } else { reject(e); }
      });
    });
  };

  /* ------------------------------------------------------- the raw reader */

  /* Injected into the witness route. It hands over rows and a provenance string
     and nothing else — no connection, no transaction, no cursor, no promise the
     witness could use to ask this file a question. */
  function rowsVia(db, store, via, indexName) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, 'readonly');
      var os = t.objectStore(store);
      var src = via === 'index' ? os.index(indexName || 'by_idem') : os;
      var acc = [];
      var c = src.openCursor();
      c.onsuccess = function () {
        var cur = c.result;
        if (!cur) return;
        acc.push(cur.value);
        cur['continue']();
      };
      txDone(t, function () {
        return { store: String(store), via: String(via), count: acc.length, rows: acc };
      }).then(resolve, reject);
    });
  }
  NS.rowsVia = rowsVia;

  NS.reader = function (db) {
    return function (store) { return rowsVia(db, store, 'objectStore', null); };
  };

  /* The planted wrong reader. It exists so the witness's own provenance refusal
     can be proved to fire rather than assumed to: a check that has never been
     seen to go red is not a check. */
  NS.readerIndex = function (db) {
    return function (store) { return rowsVia(db, store, 'index', 'by_idem'); };
  };

  /* ------------------------------------------------------------- seeding */

  NS.seed = function (db) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(['akun', 'acc', 'sewa'], 'readwrite');
      var a = t.objectStore('akun'), i;
      for (i = 0; i < NS.KEYS.length; i++) a.put({ k: NS.KEYS[i], v: 0 });
      t.objectStore('acc').put({ k: NS.AKUN, v: 0 });
      /* The lease fixture the queue tab compares a Web Lock against. Fabricated,
         and its ttl is the nine seconds the shipped one in this repository uses. */
      t.objectStore('sewa').put({ k: NS.SEWA, v: { holder: '', at: 0, ttl: 9000, token: 0 } });
      txDone(t, function () { return true; }).then(resolve, reject);
    });
  };

  /* The "before" snapshot, taken as a VALUE and read back out of the store rather
     than reported from the writes above. Capturing "before" after the fact, or
     as a closure that re-reads, is the second most popular way to build a proof
     that cannot fail. */
  NS.snapshot = function (db) {
    var out = { akun: {}, acc: 0, jurnal: 0, led_n: 0, led_u: 0 };
    var read = NS.reader(db);
    return read('akun').then(function (e) {
      var i;
      for (i = 0; i < e.rows.length; i++) out.akun[e.rows[i].k] = e.rows[i].v;
      return read('acc');
    }).then(function (e) {
      out.acc = e.rows.length ? e.rows[0].v : 0;
      return read('jurnal');
    }).then(function (e) {
      out.jurnal = e.count;
      return read('led_n');
    }).then(function (e) {
      out.led_n = e.count;
      return read('led_u');
    }).then(function (e) {
      out.led_u = e.count;
      return out;
    });
  };

  /* ------------------------------------------- the transaction-death line */

  /* The portfolio's signature bug, occurring inside Chromium rather than inside
     this repository's code. Read a record inside a live readwrite transaction,
     yield, then write. Measured: any number of awaits that settle in a MICROTASK
     survive — one hundred thousand chained ones cost 10 ms and the write lands —
     and the transaction dies the instant control reaches the TASK queue. The put
     throws TransactionInactiveError into your own async function, oncomplete
     fires anyway, onabort never fires, tx.error stays null, and the record is
     unchanged. The transaction reports success and the write is gone.
     MessageChannel is a task, not a microtask, which kills the idea of using it
     as a throttle-proof boundary inside a transaction.
     Stated on the page as measured in Chromium and not as a portable rule: the
     specification ties deactivation to returning control to the event loop, and
     engines have historically differed. */
  var WAITS = ['none', 'micro1', 'micro100k', 'task', 'msgchan', 'raf'];
  NS.WAITS = WAITS;

  function waitFor(kind) {
    var i, p;
    if (kind === 'none') return null;
    if (kind === 'micro1') return Promise.resolve();
    if (kind === 'micro100k') {
      p = Promise.resolve();
      for (i = 0; i < 100000; i++) p = p.then(function () { });
      return p;
    }
    if (kind === 'task') {
      return new Promise(function (res) { root.setTimeout(res, 0); });
    }
    if (kind === 'msgchan') {
      return new Promise(function (res) {
        var ch = new root.MessageChannel();
        ch.port1.onmessage = function () { ch.port1.close(); res(null); };
        ch.port2.postMessage(1);
      });
    }
    if (kind === 'raf') {
      if (typeof root.requestAnimationFrame !== 'function') return null;
      return new Promise(function (res) { root.requestAnimationFrame(function () { res(null); }); });
    }
    throw KODE.refuse('E_MODE', 'unknown wait kind');
  }

  NS.batasTx = function (db, kind) {
    if (WAITS.indexOf(kind) < 0) return Promise.reject(KODE.refuse('E_MODE', 'unknown wait kind'));
    var out = {
      kind: String(kind), putOk: false, name: '', completed: false,
      aborted: false, txError: '', before: 0, final: 0, supported: true
    };
    if (kind === 'raf' && typeof root.requestAnimationFrame !== 'function') {
      out.supported = false;
      return Promise.resolve(out);
    }
    return NS.read(db, 'akun', 'K-batas').then(function (b) {
      out.before = b === null ? 0 : b;
      return new Promise(function (resolve) {
        var t = db.transaction('akun', 'readwrite');
        var os = t.objectStore('akun');
        var g = os.get('K-batas');
        var seen = 0;
        t.oncomplete = function () { out.completed = true; out.txError = KODE.nameOf(t.error); resolve(out); };
        t.onabort = function () { out.aborted = true; out.txError = KODE.nameOf(t.error); resolve(out); };
        g.onsuccess = function () {
          seen = g.result ? g.result.v : 0;
          var w = waitFor(kind);
          if (!w) {
            try { os.put({ k: 'K-batas', v: seen + 1 }); out.putOk = true; }
            catch (e) { out.name = KODE.nameOf(e); }
            return;
          }
          w.then(function () {
            try { os.put({ k: 'K-batas', v: seen + 1 }); out.putOk = true; }
            catch (e) { out.name = KODE.nameOf(e); }
          })['catch'](function (e) { out.name = KODE.nameOf(e); });
        };
      });
    }).then(function () {
      return NS.read(db, 'akun', 'K-batas');
    }).then(function (f) {
      out.final = f === null ? 0 : f;
      return out;
    });
  };

  /* ------------------------------------------ the two spec-forced orderings */

  /* Route B for the ordering panel, and the reason it exists is a falsified
     claim rather than a missing feature. The obvious probe records when each
     transaction was CONSTRUCTED and asserts that B was constructed before A
     finished — and both objects are constructed in the same synchronous turn,
     so B's number is always the second one issued and the claim cannot fail.
     Measured, all four configurations: B-open is 2 every time.

     Every number below is therefore taken at B's FIRST READ, which is the
     earliest moment B can be shown to have been given the store, and the
     sequence numbers are integers issued by this run rather than clock
     readings — two events inside one turn share a millisecond, and a worker's
     clock has a different origin from the page's.

     Only two of the four are ORDERING CLAIMS THE SPECIFICATION FORCES: two
     readwrite transactions over the same store, and a readonly followed by a
     readwrite over the same store. The other two ask whether the scheduler
     CHOSE to interleave where it was permitted to, which a conforming engine
     may decline to do, so they are measured and shown and never asserted. */
  var URUT = ['rwrw_same', 'rwrw_disjoint', 'roro_same', 'rorw_same'];
  NS.URUT = URUT;

  NS.urutTx = function (db, kind) {
    if (URUT.indexOf(kind) < 0) return Promise.reject(KODE.refuse('E_MODE', 'unknown ordering kind'));
    var seq = KODE.urut();
    var out = {
      kind: String(kind), aOpen: 0, bOpen: 0, aFirst: 0, bFirst: 0,
      aDone: 0, bDone: 0, serialised: false, paksa: kind === 'rwrw_same' || kind === 'rorw_same'
    };

    var aStore = 'akun';
    var bStore = kind === 'rwrw_disjoint' ? 'acc' : 'akun';
    var aMode = kind === 'roro_same' || kind === 'rorw_same' ? 'readonly' : 'readwrite';
    var bMode = kind === 'roro_same' ? 'readonly' : 'readwrite';
    var aKey = 'K-batas';
    var bKey = bStore === 'acc' ? NS.AKUN : 'K-batas';

    return new Promise(function (resolve, reject) {
      var left = 2;
      function maybe() { left = left - 1; if (left === 0) { out.serialised = out.bFirst > out.aDone; resolve(out); } }
      function fail(e) { reject(e); }

      /* BOTH TRANSACTIONS ARE CONSTRUCTED IN THIS ONE TURN, deliberately: that
         is what "two requests arriving at once" means on a single-threaded
         runtime, and it is the only part of the setup that is arranged. */
      var ta = db.transaction(aStore, aMode);
      out.aOpen = seq.next();
      var tb = db.transaction(bStore, bMode);
      out.bOpen = seq.next();

      var ga = ta.objectStore(aStore).get(aKey);
      ga.onsuccess = function () { if (!out.aFirst) out.aFirst = seq.next(); };
      var gb = tb.objectStore(bStore).get(bKey);
      gb.onsuccess = function () { if (!out.bFirst) out.bFirst = seq.next(); };

      ta.oncomplete = function () { out.aDone = seq.next(); maybe(); };
      ta.onabort = function (ev) { fail(sebab(ev, ta, 'E_DB_TIADA', 'the first transaction aborted')); };
      tb.oncomplete = function () { out.bDone = seq.next(); maybe(); };
      tb.onabort = function (ev) { fail(sebab(ev, tb, 'E_DB_TIADA', 'the second transaction aborted')); };
    });
  };

  root.SEROBOT_DB = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
