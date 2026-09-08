/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — store.js
 * IndexedDB, and only for the things a person actually changed.
 *
 * The 46k synthetic marks and 160k attendance rows are DERIVED (see data.js),
 * so the database holds deltas: a teacher's edited mark, a corrected presence,
 * a saved timetable, the assessment weighting, a recorded SPP payment. That
 * keeps the write path small enough to reason about and means a wipe genuinely
 * restores the demo to first-paint state.
 *
 * Every storage call is wrapped. localStorage and indexedDB both THROW outright
 * when a browser is set to block site data, and one unguarded access is enough
 * to blank a page — this site has shipped that bug once already. When the
 * database is unavailable the app keeps running against an in-memory map and
 * says so in the header rather than dying.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'siakad-db';
  var DB_VERSION = 2;
  /* v2 adds 'sikap' (penilaian sikap and the wali's catatan) and renames the
   * fee store to 'komite'. onupgradeneeded creates whatever is missing, so a
   * browser still holding a v1 database is upgraded in place rather than
   * losing the teacher's edits. */
  var STORES = ['nilai', 'presensi', 'konfig', 'jadwal', 'komite', 'sikap', 'audit'];

  var St = {};
  root.SIAKAD_STORE = St;

  var dbp = null;
  var mem = {};                 // fallback: same shape, no persistence
  STORES.forEach(function (s) { mem[s] = {}; });
  St.mode = 'idb';              // 'idb' | 'memori'
  St.reason = '';

  function memFallback(reason) {
    if (St.mode !== 'memori') {
      St.mode = 'memori';
      St.reason = reason;
    }
    return null;
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var req;
      if (!root.indexedDB) { memFallback('indexedDB tidak tersedia di konteks ini'); resolve(null); return; }
      try {
        req = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        memFallback('indexedDB.open melempar: ' + (e && e.name || e));
        resolve(null); return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        for (var i = 0; i < STORES.length; i++) {
          if (db.objectStoreNames.contains(STORES[i])) continue;
          if (STORES[i] === 'audit') db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
          else db.createObjectStore(STORES[i], { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () {
        memFallback('akses IndexedDB ditolak browser (' + (req.error && req.error.name) + ')');
        resolve(null);
      };
      req.onblocked = function () { memFallback('IndexedDB terkunci tab lain'); resolve(null); };
    });
    return dbp;
  }
  St.open = open;

  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var t;
        try { t = db.transaction(store, mode); }
        catch (e) { memFallback('transaction gagal: ' + (e && e.name || e)); resolve(fn(null)); return; }
        var os = t.objectStore(store);
        var out;
        try { out = fn(os); } catch (e2) { reject(e2); return; }
        t.oncomplete = function () { resolve(out && out.__req ? out.__req.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('aborted')); };
      });
    }).catch(function (e) {
      memFallback('operasi IndexedDB gagal: ' + (e && e.name || e));
      return fn(null);
    });
  }

  St.put = function (store, rec) {
    if (St.mode === 'memori') { mem[store][rec.k] = rec; return Promise.resolve(rec); }
    return tx(store, 'readwrite', function (os) {
      if (!os) { mem[store][rec.k] = rec; return rec; }
      os.put(rec);
      return rec;
    });
  };

  St.del = function (store, k) {
    if (St.mode === 'memori') { delete mem[store][k]; return Promise.resolve(); }
    return tx(store, 'readwrite', function (os) {
      if (!os) { delete mem[store][k]; return; }
      os.delete(k);
    });
  };

  St.all = function (store) {
    if (St.mode === 'memori') {
      return Promise.resolve(Object.keys(mem[store]).map(function (k) { return mem[store][k]; }));
    }
    return tx(store, 'readonly', function (os) {
      if (!os) return Object.keys(mem[store]).map(function (k) { return mem[store][k]; });
      var r = os.getAll ? os.getAll() : null;
      if (r) return { __req: r };
      var acc = [];
      os.openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (c) { acc.push(c.value); c.continue(); }
      };
      return acc;
    });
  };

  St.clearAll = function () {
    STORES.forEach(function (s) { mem[s] = {}; });
    if (St.mode === 'memori') return Promise.resolve();
    return open().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve, reject) {
        var t;
        try { t = db.transaction(STORES, 'readwrite'); }
        catch (e) { resolve(); return; }
        for (var i = 0; i < STORES.length; i++) t.objectStore(STORES[i]).clear();
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    }).catch(function () { });
  };

  /* An append-only trail of who changed what. A school system without one is
   * unauditable, and "the grade changed and nobody knows who" is the single
   * complaint that ends a contract. */
  St.audit = function (rec) {
    rec.at = Date.now();
    if (St.mode === 'memori') {
      rec.id = Object.keys(mem.audit).length + 1;
      mem.audit[rec.id] = rec;
      return Promise.resolve(rec);
    }
    return tx('audit', 'readwrite', function (os) {
      if (!os) { rec.id = Object.keys(mem.audit).length + 1; mem.audit[rec.id] = rec; return rec; }
      os.add(rec);
      return rec;
    });
  };

  /* localStorage is used ONLY for the theme, so that it can be applied before
   * first paint without waiting on an async database. Wrapped, obviously. */
  St.readLocal = function (key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  };
  St.writeLocal = function (key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = St;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
