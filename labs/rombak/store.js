/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — store.js
 * IndexedDB, for the two things worth keeping between visits: a database the
 * reader walked partway up the ladder, and what they typed into the Console.
 *
 * TWO STORES, AND THEY ARE NOT THE SAME KIND OF THING.
 *   konfig           keyed records. One of them, 'db', holds the exported SQLite
 *                    file as a Uint8Array — eight megabytes of it at v9 — plus
 *                    the version and checksum it was saved at, so a load can say
 *                    what it is loading before it opens it.
 *   console_history  one record per statement the reader ran, keyed by an
 *                    autoincrementing id. Append-only in ordinary use and capped,
 *                    because a scratchpad that grows without limit is a leak with
 *                    good manners.
 *
 * WHY THE DATABASE IS ONE RECORD AND NOT A ROW PER TABLE. It is written whole or
 * not at all. A half-written save that left `visit` from this session next to
 * `patient` from the last one would be a database that never existed, and the
 * census would be right to refuse it while nobody could tell which half was
 * wrong. SQLite already solved this; the store's job is not to un-solve it.
 *
 * EVERY ACCESS IS WRAPPED, AND THE FALLBACK IS ONE-WAY. `localStorage` and
 * `indexedDB` do not return null when site data is blocked — reading the PROPERTY
 * throws (Firefox in strict mode, Chrome with third-party data disabled inside a
 * frame, Safari private browsing historically), and one unguarded access kills
 * the entire script block around it. This repository has shipped that bug on its
 * own homepage once already.
 *
 * The important half of that rule is the second one: falling back to memory is a
 * decision about the ENVIRONMENT, taken when the database cannot be opened at
 * all, and it is never taken because a single transaction failed. A quota error
 * on an eight-megabyte save is a failed save — the caller is told so and the next
 * save may well succeed. Silently switching to memory there would tell the reader
 * their database is safe on disk when it is in a variable.
 *
 * localStorage holds the THEME and nothing else, because the theme has to be
 * applied before first paint and IndexedDB is asynchronous. guard.js reads it;
 * this file writes it.
 */
(function (root) {
  'use strict';

  var NS = {};

  var DB_NAME = 'rombak-db';
  var DB_VERSION = 1;
  var STORES = ['konfig', 'console_history'];
  var HISTORY_CAP = 200;
  var THEME_KEY = 'rombak.theme';

  NS.DB_NAME = DB_NAME;
  NS.DB_VERSION = DB_VERSION;
  NS.STORES = STORES;
  NS.HISTORY_CAP = HISTORY_CAP;
  NS.THEME_KEY = THEME_KEY;

  var mem = {};
  var memSeq = 1;
  var i;
  for (i = 0; i < STORES.length; i++) mem[STORES[i]] = {};

  var state = {
    available: null,      // null = never opened, true/false afterwards
    reason: '',
    memory: false
  };
  var dbp = null;

  NS.available = function () { return state.available; };
  NS.reason = function () { return state.reason; };
  NS.usingMemory = function () { return state.memory; };

  /* The one-way decision. Taken for an environment that cannot give us a
     database, never for a transaction that failed. */
  function memFallback(reason) {
    if (!state.memory) {
      state.memory = true;
      state.available = false;
      state.reason = reason;
    }
    return null;
  }

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var idb;
      try {
        idb = root.indexedDB;
      } catch (e) {
        // Reading the property itself threw. That is the case this file exists for.
        resolve(memFallback('IndexedDB is blocked by a browser setting'));
        return;
      }
      if (!idb) { resolve(memFallback('This browser has no IndexedDB')); return; }
      var req;
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (e2) {
        resolve(memFallback('IndexedDB refused to open: ' + e2.message));
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('konfig')) db.createObjectStore('konfig', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('console_history')) {
          db.createObjectStore('console_history', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () {
        state.available = true;
        state.memory = false;
        state.reason = '';
        resolve(req.result);
      };
      req.onerror = function () {
        resolve(memFallback('IndexedDB could not be opened' +
          (req.error && req.error.message ? ': ' + req.error.message : '')));
      };
      // Another tab holding an older version open. Not a broken environment, but
      // there is nothing to wait for either.
      req.onblocked = function () { resolve(memFallback('IndexedDB is locked by another tab')); };
    });
    return dbp;
  }
  NS.open = openDB;

  function tx(store, mode, fn) {
    return openDB().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var t, os, out;
        try {
          t = db.transaction(store, mode);
          os = t.objectStore(store);
        } catch (e) { reject(e); return; }
        out = fn(os);
        t.oncomplete = function () { resolve(out && out.__req ? out.__req.result : out); };
        t.onerror = function () { reject(t.error || new Error('transaction failed')); };
        t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
      });
    });
  }

  /* A failed WRITE is reported, not absorbed. `{ok:false, error}` is a fact the
     caller can put on screen; a silent memory fallback here would be a lie with
     a green tick on it. */
  function attempt(p, what) {
    return p.then(function (r) { return { ok: true, hasil: r }; }, function (e) {
      return { ok: false, error: (e && e.message) || String(e), what: what };
    });
  }

  NS.put = function (store, rec) {
    if (state.memory) { mem[store][rec.k !== undefined ? rec.k : (rec.id || memSeq++)] = rec; return Promise.resolve({ ok: true, hasil: null, memory: true }); }
    return attempt(tx(store, 'readwrite', function (os) {
      if (!os) { mem[store][rec.k !== undefined ? rec.k : memSeq++] = rec; return null; }
      return { __req: os.put(rec) };
    }), 'put ' + store);
  };

  NS.get = function (store, key) {
    if (state.memory) return Promise.resolve(mem[store][key] || null);
    return tx(store, 'readonly', function (os) {
      if (!os) return mem[store][key] || null;
      return { __req: os.get(key) };
    }).then(function (r) { return r || null; }, function () { return null; });
  };

  NS.all = function (store) {
    if (state.memory) return Promise.resolve(memList(store));
    return tx(store, 'readonly', function (os) {
      if (!os) return memList(store);
      var out = [];
      os.openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (!c) return;
        out.push(c.value);
        c.continue();
      };
      return out;
    }).then(function (r) { return r || []; }, function () { return []; });
  };

  function memList(store) {
    var k, out = [];
    for (k in mem[store]) {
      if (Object.prototype.hasOwnProperty.call(mem[store], k)) out.push(mem[store][k]);
    }
    return out;
  }

  NS.del = function (store, key) {
    if (state.memory) { delete mem[store][key]; return Promise.resolve({ ok: true }); }
    return attempt(tx(store, 'readwrite', function (os) {
      if (!os) { delete mem[store][key]; return null; }
      return { __req: os.delete(key) };
    }), 'delete ' + store);
  };

  NS.clearAll = function () {
    var s;
    for (s = 0; s < STORES.length; s++) mem[STORES[s]] = {};
    if (state.memory) return Promise.resolve({ ok: true });
    return attempt(openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORES, 'readwrite'), k;
        for (k = 0; k < STORES.length; k++) t.objectStore(STORES[k]).clear();
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error || new Error('clear failed')); };
      });
    }), 'clearAll');
  };

  /* ------------------------------------------------------- the database */

  /* The bytes go in as they came out of db.export(). No base64, no JSON: both
     would roughly double eight megabytes for no gain, and IndexedDB stores a
     typed array natively. The version and the census checksum ride along so a
     load can be described before it is opened — and so a save from an older
     build of the page can be recognised rather than fed to the engine and
     blamed on SQLite. */
  NS.saveDb = function (bytes, meta) {
    meta = meta || {};
    var rec = {
      k: 'db',
      bytes: bytes,
      byteLength: bytes ? bytes.length : 0,
      userVersion: meta.userVersion === undefined ? null : meta.userVersion,
      checksum: meta.checksum === undefined ? null : meta.checksum,
      tableCount: meta.tableCount === undefined ? null : meta.tableCount,
      totalRows: meta.totalRows === undefined ? null : meta.totalRows,
      savedAt: new Date().toISOString()
    };
    return NS.put('konfig', rec);
  };

  NS.loadDb = function () {
    return NS.get('konfig', 'db').then(function (rec) {
      if (!rec || !rec.bytes) return null;
      // Reconstruct the view: a structured clone can hand back an ArrayBuffer.
      var b = rec.bytes;
      if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
      return {
        bytes: b, byteLength: b.length, userVersion: rec.userVersion,
        checksum: rec.checksum, tableCount: rec.tableCount, totalRows: rec.totalRows,
        savedAt: rec.savedAt
      };
    });
  };

  NS.dropDb = function () { return NS.del('konfig', 'db'); };

  NS.savedInfo = function () {
    return NS.get('konfig', 'db').then(function (rec) {
      if (!rec) return null;
      return {
        byteLength: rec.byteLength, userVersion: rec.userVersion, checksum: rec.checksum,
        tableCount: rec.tableCount, totalRows: rec.totalRows, savedAt: rec.savedAt
      };
    });
  };

  /* ------------------------------------------------------- the console log */

  NS.pushHistory = function (sql, note) {
    var rec = { sql: String(sql), at: new Date().toISOString(), note: note ? String(note) : '' };
    if (state.memory) { rec.id = memSeq++; mem.console_history[rec.id] = rec; trimMemory(); return Promise.resolve({ ok: true }); }
    return attempt(tx('console_history', 'readwrite', function (os) {
      if (!os) { rec.id = memSeq++; mem.console_history[rec.id] = rec; return null; }
      return { __req: os.add(rec) };
    }), 'pushHistory').then(function (r) { NS.trimHistory(); return r; });
  };

  NS.history = function (limit) {
    return NS.all('console_history').then(function (list) {
      list.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
      if (limit && list.length > limit) list = list.slice(list.length - limit);
      return list;
    });
  };

  /* Capped from the front, oldest first. A scratchpad is not an archive. */
  NS.trimHistory = function () {
    return NS.all('console_history').then(function (list) {
      if (list.length <= HISTORY_CAP) return { ok: true, removed: 0 };
      list.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
      var over = list.slice(0, list.length - HISTORY_CAP), k, chain = Promise.resolve();
      for (k = 0; k < over.length; k++) {
        chain = chain.then(makeDeleter(over[k].id));
      }
      return chain.then(function () { return { ok: true, removed: over.length }; });
    });
  };
  function makeDeleter(id) { return function () { return NS.del('console_history', id); }; }

  NS.clearHistory = function () {
    mem.console_history = {};
    if (state.memory) return Promise.resolve({ ok: true });
    return attempt(tx('console_history', 'readwrite', function (os) {
      if (!os) return null;
      return { __req: os.clear() };
    }), 'clearHistory');
  };

  /* --------------------------------------------------------- localStorage */

  /* Theme only. Synchronous, tiny, and read by guard.js before first paint —
     which is the entire reason it is not in IndexedDB with everything else. */
  NS.readLocal = function (key) {
    try { return root.localStorage.getItem(key); } catch (e) { return null; }
  };
  NS.writeLocal = function (key, value) {
    try { root.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  };
  NS.readTheme = function () {
    var v = NS.readLocal(THEME_KEY);
    if (v === null) v = NS.readLocal('theme');
    if (v === null) return null;
    v = String(v).replace(/"/g, '');
    return v === 'light' || v === 'dark' ? v : null;
  };
  NS.writeTheme = function (theme) { return NS.writeLocal(THEME_KEY, theme); };

  function trimMemory() {
    var list = memList('console_history'), k;
    if (list.length <= HISTORY_CAP) return;
    list.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    for (k = 0; k < list.length - HISTORY_CAP; k++) delete mem.console_history[list[k].id];
  }

  root.ROMBAK_STORE = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
