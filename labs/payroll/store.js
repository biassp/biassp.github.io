/*!
 * Payroll — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Payroll — store.js
 * IndexedDB, and only for the things a person actually did.
 *
 * The demo company — 62 employees, a year of attendance, overtime and leave,
 * twelve payroll runs — is DERIVED from one seed integer (see seed.js), so
 * storing it would be storing a function of a number. What gets stored is the
 * delta: master-data edits, payroll runs the user posted or locked, leave
 * decisions, the role they are acting as, config changes, and an append-only
 * audit trail. That keeps the write path small enough to reason about, and it
 * means "hapus data" genuinely returns the page to first-paint state rather
 * than to some half-migrated hybrid.
 *
 * WHY INDEXEDDB AND NOT localStorage FOR THE PAYROLL ITSELF: salaries are the
 * most sensitive table a company has, and localStorage is a synchronous string
 * store that every script on the origin can read at once. IndexedDB is not a
 * security boundary either, but the payroll data here never leaves the tab at
 * all, and a payroll run is a structured record with nested payslips that
 * would have to be JSON round-tripped through localStorage on every keystroke.
 * localStorage is used for exactly one thing: the theme, so it can be applied
 * before first paint without awaiting an async open.
 *
 * EVERY storage call is wrapped. localStorage and indexedDB BOTH throw
 * outright when a browser is set to block site data, and one unguarded access
 * blanks the page. When the database is unavailable the app keeps running
 * against an in-memory map and says so in the header instead of dying.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'payroll-db';
  var DB_VERSION = 1;
  var STORES = ['run', 'karyawan', 'cuti', 'konfig', 'audit'];

  var St = {};
  root.PAYROLL_STORE = St;

  var dbp = null;
  var mem = {};
  STORES.forEach(function (s) { mem[s] = {}; });
  St.mode = 'idb';
  St.reason = '';

  function memFallback(reason) {
    if (St.mode !== 'memori') { St.mode = 'memori'; St.reason = reason; }
    return null;
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var req;
      if (!root.indexedDB) { memFallback('indexedDB tidak tersedia di konteks ini'); resolve(null); return; }
      try { req = root.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { memFallback('indexedDB.open melempar: ' + (e && e.name || e)); resolve(null); return; }
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

  /* A READ AND A WRITE INSIDE ONE TRANSACTION, with the caller deciding from
   * the stored record whether the write may happen at all.
   *
   * This exists because a lock enforced only against the tab's own copy of a
   * run is not a lock. Two tabs of the same origin share one IndexedDB: tab A
   * locks December and tab B, still holding December as the draft it loaded
   * before the lock, writes its draft straight over the signed record. Nobody
   * is told, the invariant checker sees a run that is simply no longer locked
   * and has nothing left to check, and the finance approver's signature is
   * gone along with the figure it was over. `izin(tersimpan)` is evaluated
   * against what is IN THE STORE at write time, and returns false to refuse.
   * Resolves { ok, ada } so the caller can surface the conflict and reload
   * rather than pretend the write happened. */
  St.putGuarded = function (store, rec, izin) {
    function pakaiMem() {
      var ada = mem[store][rec.k] || null;
      if (!izin(ada)) return { ok: false, ada: ada };
      mem[store][rec.k] = rec;
      return { ok: true, ada: ada };
    }
    if (St.mode === 'memori') return Promise.resolve(pakaiMem());
    return tx(store, 'readwrite', function (os) {
      if (!os) return pakaiMem();
      var out = { ok: false, ada: null };
      var g = os.get(rec.k);
      g.onsuccess = function () {
        out.ada = g.result || null;
        var lolos = false;
        try { lolos = !!izin(out.ada); } catch (e) { lolos = false; }
        if (lolos) { os.put(rec); out.ok = true; }
      };
      return out;
    }).catch(function () { return pakaiMem(); });
  };

  St.del = function (store, k) {
    if (St.mode === 'memori') { delete mem[store][k]; return Promise.resolve(); }
    return tx(store, 'readwrite', function (os) {
      if (!os) { delete mem[store][k]; return; }
      os.delete(k);
    });
  };

  St.get = function (store, k) {
    if (St.mode === 'memori') return Promise.resolve(mem[store][k] || null);
    return tx(store, 'readonly', function (os) {
      if (!os) return mem[store][k] || null;
      return { __req: os.get(k) };
    }).then(function (r) { return r || null; }).catch(function () { return null; });
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
    }).then(function (r) { return r || []; }).catch(function () { return []; });
  };

  St.clearAll = function () {
    STORES.forEach(function (s) { mem[s] = {}; });
    if (St.mode === 'memori') return Promise.resolve();
    return open().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var t;
        try { t = db.transaction(STORES, 'readwrite'); }
        catch (e) { resolve(); return; }
        for (var i = 0; i < STORES.length; i++) t.objectStore(STORES[i]).clear();
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { resolve(); };
      });
    }).catch(function () { });
  };

  /* Who ran what, who locked it, and under which role. A payroll system
   * without this cannot answer "who approved the November run", which is the
   * first question an auditor asks and the only reason the lock means
   * anything. */
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
    }).catch(function () { return rec; });
  };

  St.readLocal = function (key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  };
  St.writeLocal = function (key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = St;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
