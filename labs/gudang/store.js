/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — store.js
 * IndexedDB, and only for the things a person actually did.
 *
 * The demo book — 120 SKU, three gudang, six months, a few thousand movements —
 * is DERIVED from one seed integer (see seed.js), so there is no point storing
 * it. What gets stored is the delta: ledger entries the user posted, opname
 * sheets they filled in, the costing method and PPN setting they chose, period
 * closes they made, and an append-only audit trail. That keeps the write path
 * small enough to reason about and means "hapus data" genuinely returns the
 * page to first-paint state rather than to some half-migrated hybrid.
 *
 * Every storage call is wrapped. localStorage and indexedDB BOTH throw outright
 * when a browser is set to block site data, and one unguarded access blanks the
 * page. When the database is unavailable the app keeps running against an
 * in-memory map and says so in the header instead of dying.
 *
 * Nothing here leaves the browser. There is no sync, no export endpoint, no
 * telemetry, and the counter in the header is there so you do not have to take
 * that on faith.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'gudang-db';
  var DB_VERSION = 1;
  var STORES = ['entri', 'opname', 'konfig', 'audit'];

  var St = {};
  root.GUDANG_STORE = St;

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

  /* add(), not put(). A ledger entry is append-only, and its key is the entry
   * id: if a key already exists, something has gone wrong upstream and the
   * right answer is a rejected promise the caller can show the user — not a
   * silent overwrite that destroys a posted document. */
  St.add = function (store, rec) {
    if (St.mode === 'memori') {
      if (Object.prototype.hasOwnProperty.call(mem[store], rec.k)) {
        return Promise.reject(new Error('kunci ' + rec.k + ' sudah ada di ' + store));
      }
      mem[store][rec.k] = rec;
      return Promise.resolve(rec);
    }
    return tx(store, 'readwrite', function (os) {
      if (!os) {
        if (Object.prototype.hasOwnProperty.call(mem[store], rec.k)) throw new Error('kunci ' + rec.k + ' sudah ada di ' + store);
        mem[store][rec.k] = rec;
        return rec;
      }
      os.add(rec);
      return rec;
    });
  };

  /* ------------------------------------------------------- kunci tulis */

  /* ONE tab writes. Entry ids come from a counter that lives in the book, and a
   * book lives in a tab: two tabs both minting E4199 and both calling put()
   * means the second write destroys the first — a posted document vanishing on
   * reload, two documents sharing one number, stock going negative. The counter
   * cannot be made safe by being careful with it, so instead exactly one tab
   * holds the write lock and the others are read-only and say so.
   *
   * The lock is a single record read and written inside ONE readwrite
   * transaction, and IndexedDB serialises overlapping readwrite transactions on
   * the same store, so the read-modify-write is atomic across tabs. It carries a
   * timestamp and the holder refreshes it; a lock older than ttl belongs to a
   * tab that is gone, and may be taken. */
  St.lock = function (tabId, ttl) {
    ttl = ttl || 9000;
    var out = { ok: false, holder: null, at: 0, mode: St.mode };
    if (St.mode === 'memori') { out.ok = true; out.holder = tabId; return Promise.resolve(out); }
    return tx('konfig', 'readwrite', function (os) {
      if (!os) { out.ok = true; out.holder = tabId; return out; }
      var g = os.get('lock');
      g.onsuccess = function () {
        var v = g.result && g.result.v, now = Date.now();
        if (!v || !v.tab || v.tab === tabId || (now - (v.at || 0)) > ttl) {
          out.ok = true; out.holder = tabId; out.at = now;
          try { os.put({ k: 'lock', v: { tab: tabId, at: now } }); } catch (e) { out.ok = false; }
        } else {
          out.ok = false; out.holder = v.tab; out.at = v.at || 0;
        }
      };
      return out;
    }).then(function (r) { return r || out; }).catch(function () { out.ok = false; return out; });
  };

  /* Best-effort release on unload so a second tab does not have to wait out the
   * ttl. Losing this (a crash, a killed tab) is survivable: the ttl expires. */
  St.unlock = function (tabId) {
    if (St.mode === 'memori') return Promise.resolve();
    return tx('konfig', 'readwrite', function (os) {
      if (!os) return null;
      var g = os.get('lock');
      g.onsuccess = function () {
        var v = g.result && g.result.v;
        if (v && v.tab === tabId) { try { os.put({ k: 'lock', v: { tab: null, at: 0 } }); } catch (e) { } }
      };
      return null;
    }).catch(function () { });
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
    });
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

  /* Who posted what, when, and under which role. An inventory system without
   * one cannot answer "who wrote off eight cartons last Thursday", and that is
   * the question the owner will eventually ask. */
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

  /* localStorage is used ONLY for the theme, so it can be applied before first
   * paint without waiting on an async database. Wrapped, obviously. */
  St.readLocal = function (key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  };
  St.writeLocal = function (key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = St;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
