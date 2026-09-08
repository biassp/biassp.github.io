/*!
 * Buku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Buku — store.js
 * IndexedDB, and only for the things a person actually did.
 *
 * The demo book — a full year, 478 entries, three depreciation schedules — is
 * DERIVED from one seed integer (see seed.js), so there is no point storing it.
 * What gets stored is the delta: entries the user posted, drafts a staf wrote,
 * period locks a supervisor opened or closed, the role they are working as, and
 * an append-only audit trail. That keeps the write path small enough to reason
 * about and means "hapus data" genuinely returns the page to first-paint state
 * rather than to some half-migrated hybrid.
 *
 * WHAT IS STORED IS ENTRIES, NEVER BALANCES. That is invariant I7 reaching all
 * the way down to the persistence layer: on reload the entries are replayed into
 * a book rebuilt from the seed and every figure is recomputed. There is no
 * schema here that could hold a stale trial balance, because there is no field
 * for one.
 *
 * Every storage call is wrapped. localStorage and indexedDB BOTH throw outright
 * when a browser is set to block site data, and one unguarded access blanks the
 * page. When the database is unavailable the app keeps running against an
 * in-memory map and says so in the context bar instead of dying.
 *
 * Nothing here leaves the browser. There is no sync, no export endpoint, no
 * telemetry, and the counter in the header is there so you do not have to take
 * that on faith.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'buku-db';
  var DB_VERSION = 1;
  var STORES = ['entri', 'draf', 'konfig', 'audit'];

  var St = {};
  root.BUKU_STORE = St;

  var dbp = null;
  var mem = {};
  STORES.forEach(function (s) { mem[s] = {}; });
  St.mode = 'idb';
  St.reason = '';

  /* Falling back to the in-memory map is a ONE-WAY, WHOLE-STORE decision, so it
   * must only ever be taken for "IndexedDB is not available here" — never for
   * "this one write failed". Taking it on an in-flight transaction error was the
   * bug that made the append-only guarantee decorative: a duplicate-key
   * ConstraintError aborted the transaction, the abort was caught, the store
   * silently degraded to volatile memory for the rest of the page's life, and the
   * write was re-run against the map and RESOLVED AS SUCCESS. Every entry posted
   * afterwards was reported saved and was gone on reload.
   *
   * onChange lets the page repaint the "penyimpanan: memori" pill the moment the
   * mode flips rather than at the next unrelated render — a page that has quietly
   * stopped persisting must say so immediately. */
  St.onChange = null;
  function memFallback(reason) {
    if (St.mode !== 'memori') {
      St.mode = 'memori';
      St.reason = reason;
      if (typeof St.onChange === 'function') {
        try { St.onChange(St.mode, St.reason); } catch (e) { /* a repaint must never break a write */ }
      }
    }
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
      /* NARROW on purpose. Everything that means "IndexedDB is unavailable" is
       * already handled inline above and in open() — a missing indexedDB, an
       * open() that throws or errors, a transaction() that cannot be constructed.
       * What reaches here is a rejection from a transaction that DID start:
       * t.onerror, t.onabort, or fn() throwing. Those are failures of one
       * operation, and the caller has to see them. Converting them into a
       * memory-mode success is what killed St.add()'s duplicate-key protection
       * and, with it, the last line of defence against two tabs minting the same
       * document number.
       *
       * The one thing still worth catching: a request that races the mode
       * flipping to memory underneath it, in which case retrying against the map
       * is right. */
      if (St.mode === 'memori') return fn(null);
      throw e;
    });
  }

  /* Best-effort writes — the role preference, a draft, the audit trail, the
   * period-lock map. A failure here is worth RECORDING and worth SHOWING, but it
   * is not worth rejecting a promise nobody awaits: an unhandled rejection is a
   * console message, which is exactly the kind of silence this file is trying to
   * get rid of. So the failure lands in St.gagalTerakhir and pokes onChange, and
   * the resolved value says plainly whether it was written.
   *
   * St.add('entri') is deliberately NOT in this category: a posted journal entry
   * that failed to store must reach the caller as a rejection, because the user
   * has to be told before they reload. */
  St.gagalTerakhir = null;
  function bestEffort(p, apa) {
    return p.then(function (r) { return { ok: true, hasil: r }; }, function (e) {
      St.gagalTerakhir = apa + ': ' + (e && (e.name || e.message) || e);
      if (typeof St.onChange === 'function') {
        try { St.onChange(St.mode, St.reason); } catch (e2) { }
      }
      return { ok: false, error: e };
    });
  }
  St.bestEffort = bestEffort;

  St.put = function (store, rec) {
    if (St.mode === 'memori') { mem[store][rec.k] = rec; return Promise.resolve({ ok: true, hasil: rec }); }
    return bestEffort(tx(store, 'readwrite', function (os) {
      if (!os) { mem[store][rec.k] = rec; return rec; }
      os.put(rec);
      return rec;
    }), 'gagal menyimpan ' + store + '/' + rec.k);
  };

  /* add(), not put(). A journal entry is append-only, and its key is the entry
   * id: if a key already exists, something has gone wrong upstream and the right
   * answer is a rejected promise the caller can show the user — not a silent
   * overwrite that destroys a posted document. An accounting system that can
   * lose a posted entry on a reload is not an accounting system. */
  St.add = function (store, rec) {
    if (St.mode === 'memori') {
      if (Object.prototype.hasOwnProperty.call(mem[store], rec.k)) {
        return Promise.reject(new Error('kunci ' + rec.k + ' sudah ada di ' + store));
      }
      mem[store][rec.k] = rec;
      return Promise.resolve(rec);
    }
    var bentrok = false;
    return tx(store, 'readwrite', function (os) {
      if (!os) {
        if (Object.prototype.hasOwnProperty.call(mem[store], rec.k)) throw new Error('kunci ' + rec.k + ' sudah ada di ' + store);
        mem[store][rec.k] = rec;
        return rec;
      }
      var req = os.add(rec);
      /* Observed, not prevented. The request error is left unhandled on purpose
       * so the transaction still aborts and nothing is written; this handler only
       * records WHY, so the rejection the caller sees names the collision instead
       * of saying "aborted". */
      req.onerror = function () {
        if (req.error && req.error.name === 'ConstraintError') bentrok = true;
      };
      return rec;
    }).catch(function (e) {
      if (bentrok || (e && e.name === 'ConstraintError')) {
        throw new Error('kunci ' + rec.k + ' sudah ada di ' + store +
          ' — tidak ditimpa, dan record ini TIDAK tersimpan');
      }
      throw e;
    });
  };

  /* ------------------------------------------------------- kunci tulis */

  /* ONE tab writes. Entry ids and document numbers come from counters that live
   * in the book, and a book lives in a tab: two tabs both minting JU-0479 and
   * both calling put() means the second write destroys the first — a posted
   * journal entry vanishing on reload, or two entries sharing one number, which
   * in a set of books is the failure that ends the argument.
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
    if (St.mode === 'memori') { delete mem[store][k]; return Promise.resolve({ ok: true }); }
    return bestEffort(tx(store, 'readwrite', function (os) {
      if (!os) { delete mem[store][k]; return; }
      os.delete(k);
    }), 'gagal menghapus ' + store + '/' + k);
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

  /* Who posted what, when, and under which role. A set of books without one
   * cannot answer "who reopened March and what changed afterwards", and that is
   * the first question anyone reviewing a reopened period will ask. */
  St.audit = function (rec) {
    rec.at = Date.now();
    if (St.mode === 'memori') {
      rec.id = Object.keys(mem.audit).length + 1;
      mem.audit[rec.id] = rec;
      return Promise.resolve(rec);
    }
    return bestEffort(tx('audit', 'readwrite', function (os) {
      if (!os) { rec.id = Object.keys(mem.audit).length + 1; mem.audit[rec.id] = rec; return rec; }
      os.add(rec);
      return rec;
    }), 'gagal mencatat jejak audit');
  };

  /* The write lock's holder id, kept in sessionStorage.
   *
   * sessionStorage is scoped to ONE TAB and survives a reload of that tab. That
   * is exactly the semantics the write lock needs: pressing F5 must reclaim the
   * lock the same tab already held, while a genuinely different tab must still be
   * refused. Without this, `pagehide` fires an async IndexedDB release that the
   * browser does not wait for, so a reload raced its own teardown and the fresh
   * page sat read-only for the nine-second lock TTL — measured, not theorised.
   *
   * Wrapped, like every other storage access here: sessionStorage throws outright
   * where a browser is set to block site data, and a fresh random id is a perfectly
   * good fallback. */
  St.tabId = function () {
    var id = null;
    try { id = sessionStorage.getItem('buku.tab'); } catch (e) { id = null; }
    if (id) return id;
    id = 'T' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    try { sessionStorage.setItem('buku.tab', id); } catch (e2) { /* private mode: a per-load id still works */ }
    return id;
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
