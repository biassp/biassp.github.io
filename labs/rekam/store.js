/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — store.js
 * IndexedDB persistence. Everything the clinic knows lives in this tab and
 * nowhere else — no server, no sync, no export unless a human clicks one.
 *
 * TWO STORES, ON PURPOSE.
 *   snapshot  the whole clinical state as one record. It is small (tens of
 *             kilobytes) and always written whole, so a half-applied write can
 *             never leave patients and visits disagreeing.
 *   audit     ONE RECORD PER CHAIN ENTRY, keyed by seq. Append-only in normal
 *             operation: entries are written once and never rewritten.
 *
 * Splitting the audit out is not premature structure. It is what makes the
 * tamper demonstration honest: "Rusak satu entri" in the UI writes a modified
 * record straight into this object store, exactly as someone with devtools or
 * database access would, and the verifier then has to catch it by reading the
 * chain back off disk. If the audit lived inside the snapshot blob the demo
 * would be tampering with an in-memory array and proving nothing.
 *
 * EVERY storage call is wrapped. localStorage and indexedDB both THROW outright
 * when site data is blocked (Firefox in strict mode, Chrome with third-party
 * data disabled in an embedded context, Safari private browsing historically),
 * and one unguarded access kills the whole script block that contains it. This
 * repository has already shipped that bug once on its own homepage; the app
 * degrades to memory-only with a visible banner instead.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});

  var DB_NAME = 'rekam-db';
  var DB_VERSION = 1;

  var state = {
    available: null,   // null = untested, true/false after the first open
    reason: '',
    persistedAudit: 0  // how many chain entries are already on disk
  };

  var dbp = null;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var idb;
      try {
        idb = root.indexedDB;
      } catch (e) {
        // Accessing the property itself can throw where site data is blocked.
        state.available = false;
        state.reason = 'Akses IndexedDB diblokir oleh pengaturan browser.';
        reject(new Error(state.reason));
        return;
      }
      if (!idb) {
        state.available = false;
        state.reason = 'Browser ini tidak menyediakan IndexedDB pada konteks saat ini.';
        reject(new Error(state.reason));
        return;
      }
      var req;
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (e2) {
        state.available = false;
        state.reason = 'IndexedDB menolak dibuka: ' + (e2 && e2.message ? e2.message : e2);
        reject(e2);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { keyPath: 'seq' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () {
          try { db.close(); } catch (e3) { /* already closing */ }
          dbp = null;
        };
        state.available = true;
        resolve(db);
      };
      req.onerror = function () {
        dbp = null;
        state.available = false;
        state.reason = 'Gagal membuka basis data: ' + (req.error && req.error.message ? req.error.message : 'tidak diketahui');
        reject(req.error || new Error(state.reason));
      };
      req.onblocked = function () {
        state.reason = 'Basis data terkunci oleh tab lain yang masih terbuka.';
      };
    });
    return dbp;
  }

  function tx(names, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t;
        try {
          t = db.transaction(names, mode);
        } catch (e) { reject(e); return; }
        var out;
        t.oncomplete = function () { resolve(out); };
        t.onabort = function () { reject(t.error || new Error('transaksi dibatalkan')); };
        t.onerror = function () { reject(t.error || new Error('transaksi gagal')); };
        try {
          out = fn(t);
        } catch (e2) {
          try { t.abort(); } catch (e3) { /* already aborting */ }
          reject(e2);
        }
      });
    });
  }

  function reqp(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /**
   * load() -> Promise<{ ok, state?, auditEntries?, reason? }>
   * Never rejects. A missing or unreadable database is a normal outcome that
   * the caller answers by seeding fresh data.
   */
  function load() {
    return tx(['snapshot', 'audit'], 'readonly', function (t) {
      var out = { snap: null, audit: [] };
      reqp(t.objectStore('snapshot').get('state')).then(function (v) { out.snap = v; });
      t.objectStore('audit').openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (c) { out.audit.push(c.value); c.continue(); }
      };
      return out;
    }).then(function (out) {
      if (!out.snap || !out.snap.data) return { ok: false, reason: 'empty' };
      // Cursor order over an integer key path is ascending, but sort anyway:
      // the verifier's contiguity check must fail because of tampering, never
      // because of an ordering assumption made here.
      out.audit.sort(function (a, b) { return a.seq - b.seq; });
      state.persistedAudit = out.audit.length;
      return { ok: true, state: out.snap.data, auditEntries: out.audit };
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    });
  }

  /**
   * save(clinic) — writes the snapshot and any chain entries not yet on disk.
   * Existing audit records are never rewritten; the chain is append-only here
   * as well as in memory.
   */
  function save(clinic) {
    var snap, entries;
    try {
      snap = JSON.parse(JSON.stringify(clinic.snapshot()));
      entries = clinic.chain.entries;
    } catch (e) {
      return Promise.resolve({ ok: false, reason: 'Gagal menyalin state: ' + e.message });
    }
    return tx(['snapshot', 'audit', 'meta'], 'readwrite', function (t) {
      t.objectStore('snapshot').put({ k: 'state', data: snap, at: Date.now() });
      var store = t.objectStore('audit');
      for (var i = state.persistedAudit; i < entries.length; i++) {
        store.put(JSON.parse(JSON.stringify(entries[i])));
      }
      t.objectStore('meta').put({ k: 'version', value: DB_VERSION, at: Date.now() });
      return entries.length;
    }).then(function (n) {
      state.persistedAudit = n;
      return { ok: true, entries: n };
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    });
  }

  /**
   * tamper(seq, mutate) — deliberately corrupt one stored audit record.
   *
   * This exists so the verify button can be demonstrated failing rather than
   * merely asserted to work. It writes through the object store directly and
   * does not touch the in-memory chain, which is precisely the attack the hash
   * chain is designed to catch: someone who can reach the database but not the
   * running application.
   */
  function tamper(seq, mutate) {
    return tx(['audit'], 'readwrite', function (t) {
      var store = t.objectStore('audit');
      var result = { found: false };
      reqp(store.get(seq)).then(function (row) {
        if (!row) return;
        result.found = true;
        result.before = JSON.parse(JSON.stringify(row));
        mutate(row);
        result.after = JSON.parse(JSON.stringify(row));
        store.put(row);
      });
      return result;
    }).then(function (r) {
      return r.found ? { ok: true, before: r.before, after: r.after } : { ok: false, reason: 'Entri #' + seq + ' tidak ada di basis data.' };
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    });
  }

  /** Read the audit log straight off disk, bypassing memory. */
  function readAudit() {
    return tx(['audit'], 'readonly', function (t) {
      var rows = [];
      t.objectStore('audit').openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (c) { rows.push(c.value); c.continue(); }
      };
      return rows;
    }).then(function (rows) {
      rows.sort(function (a, b) { return a.seq - b.seq; });
      return { ok: true, entries: rows };
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    });
  }

  function wipe() {
    return new Promise(function (resolve) {
      function drop() {
        var req;
        try {
          req = root.indexedDB.deleteDatabase(DB_NAME);
        } catch (e) { resolve({ ok: false, reason: String(e) }); return; }
        req.onsuccess = function () { state.persistedAudit = 0; resolve({ ok: true }); };
        req.onerror = function () { resolve({ ok: false, reason: 'penghapusan gagal' }); };
        req.onblocked = function () { resolve({ ok: false, reason: 'penghapusan diblokir oleh tab lain' }); };
      }
      if (!dbp) { drop(); return; }
      dbp.then(function (db) {
        try { db.close(); } catch (e) { /* already closed */ }
        dbp = null;
        drop();
      }, function () { dbp = null; drop(); });
    });
  }

  /* Small guarded preference store. The theme and the active role live here,
   * and every single access is wrapped — see the file header for why. */
  function prefGet(key, dflt) {
    try {
      var v = root.localStorage.getItem('rekam.' + key);
      return v == null ? dflt : v;
    } catch (e) { return dflt; }
  }
  function prefSet(key, value) {
    try { root.localStorage.setItem('rekam.' + key, String(value)); return true; }
    catch (e) { return false; }
  }

  R.store = {
    DB_NAME: DB_NAME,
    load: load, save: save, tamper: tamper, readAudit: readAudit, wipe: wipe,
    prefGet: prefGet, prefSet: prefSet,
    status: function () { return { available: state.available, reason: state.reason, persistedAudit: state.persistedAudit }; },
    resetPersistedCount: function () { state.persistedAudit = 0; }
  };
})(typeof self !== 'undefined' ? self : this);
