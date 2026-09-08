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

  /* This tab's identity, and the reason it needs one.
   *
   * Two tabs of this app on one browser profile each hold their own Clinic,
   * their own RM counter and their own idea of how much of the chain is on
   * disk. Left alone they reissue the same No. RM to two different people,
   * overwrite each other's snapshot wholesale, and interleave their writes
   * into the shared `audit` store until the persisted chain is a mixture of
   * two — at which point a third tab boots straight into "Rantai PUTUS" after
   * entirely ordinary use, with nothing on screen saying why.
   *
   * A single-tab demo cannot merge two divergent clinics, and pretending to
   * would be worse than refusing. So it detects instead: the tab that owns the
   * database stamps its id on every save, and a tab that finds someone else's
   * id stops writing and says so. */
  var TAB_ID = 'tab-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);

  var state = {
    available: null,   // null = untested, true/false after the first open
    reason: '',
    persistedAudit: 0, // how many chain entries are already on disk
    owner: null,       // tab id last seen owning the database
    locked: false,     // another tab owns it; this tab is memory-only
    lockReason: ''
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
    return tx(['snapshot', 'audit', 'meta'], 'readonly', function (t) {
      var out = { snap: null, audit: [], owner: null };
      reqp(t.objectStore('snapshot').get('state')).then(function (v) { out.snap = v; });
      reqp(t.objectStore('meta').get('owner')).then(function (v) { out.owner = v || null; });
      t.objectStore('audit').openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (c) { out.audit.push(c.value); c.continue(); }
      };
      return out;
    }).then(function (out) {
      // A recent stamp from a DIFFERENT tab id means that tab is live and
      // owns the database. Stale stamps (a tab that was simply closed) are
      // taken over, otherwise the app would lock itself out forever.
      if (out.owner && out.owner.tab && out.owner.tab !== TAB_ID &&
          Date.now() - (out.owner.at || 0) < OWNER_TTL) {
        state.locked = true;
        state.owner = out.owner.tab;
        state.lockReason = 'Klinik ini sudah terbuka di tab lain pada peramban yang sama.';
      }
      if (!out.snap || !out.snap.data) return { ok: false, reason: 'empty', locked: state.locked };
      // Cursor order over an integer key path is ascending, but sort anyway:
      // the verifier's contiguity check must fail because of tampering, never
      // because of an ordering assumption made here.
      out.audit.sort(function (a, b) { return a.seq - b.seq; });
      state.persistedAudit = out.audit.length;
      return { ok: true, state: out.snap.data, auditEntries: out.audit, locked: state.locked };
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    });
  }

  // A tab that has not stamped the database for this long is presumed gone,
  // so a browser that was simply closed does not lock the clinic out forever.
  var OWNER_TTL = 15000;

  /**
   * heartbeat() — refresh this tab's ownership stamp, and notice if someone
   * else has taken it. Called on a timer by the app, because ownership that is
   * only refreshed on save would expire during a quiet afternoon and let a
   * second tab claim a database that is still very much in use.
   */
  function heartbeat() {
    return tx(['meta'], 'readwrite', function (t) {
      var store = t.objectStore('meta');
      var out = { stolenBy: null };
      reqp(store.get('owner')).then(function (v) {
        if (v && v.tab && v.tab !== TAB_ID && Date.now() - (v.at || 0) < OWNER_TTL) {
          out.stolenBy = v.tab;
          if (!state.locked) {
            state.locked = true;
            state.owner = v.tab;
            state.lockReason = 'Tab lain mengambil alih basis data klinik ini.';
          }
          return;
        }
        if (!state.locked) store.put({ k: 'owner', tab: TAB_ID, at: Date.now() });
      });
      return out;
    }).then(function (out) {
      return { ok: true, locked: state.locked, stolenBy: out.stolenBy };
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
    if (state.locked) {
      return Promise.resolve({
        ok: false, locked: true,
        reason: state.lockReason + ' Tab ini berjalan dari memori dan sengaja tidak menulis ke basis data — dua tab yang menulis bergantian akan menerbitkan ulang No. RM yang sama dan memutus rantai audit yang tersimpan.'
      });
    }
    var snap, entries, head;
    try {
      snap = JSON.parse(JSON.stringify(clinic.snapshot()));
      entries = clinic.chain.entries;
      head = clinic.chain.head();
    } catch (e) {
      return Promise.resolve({ ok: false, reason: 'Gagal menyalin state: ' + e.message });
    }
    return tx(['snapshot', 'audit', 'meta'], 'readwrite', function (t) {
      t.objectStore('snapshot').put({ k: 'state', data: snap, at: Date.now() });
      var store = t.objectStore('audit');
      for (var i = state.persistedAudit; i < entries.length; i++) {
        store.put(JSON.parse(JSON.stringify(entries[i])));
      }
      var meta = t.objectStore('meta');
      meta.put({ k: 'version', value: DB_VERSION, at: Date.now() });
      // The commitment that makes tail deletion visible: how long the chain is
      // supposed to be and what it is supposed to end with, written outside
      // the chain itself on every save.
      meta.put({ k: 'chain', count: entries.length, head: head, at: Date.now() });
      meta.put({ k: 'owner', tab: TAB_ID, at: Date.now() });
      return entries.length;
    }).then(function (n) {
      state.persistedAudit = n;
      state.owner = TAB_ID;
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

  /**
   * truncate(n) — delete the n HIGHEST-seq audit records straight out of the
   * object store, in-memory chain untouched.
   *
   * The counterpart to tamper(): editing a row is the expensive attack and
   * deleting the tail is the cheap one, so both are demonstrable. This is what
   * "delete the rows that record what I just did" looks like, and without the
   * head commitment in `meta` the verifier used to walk the shortened chain,
   * run out of rows and report it perfectly intact.
   */
  function truncate(n) {
    var count = Math.max(1, n || 1);
    return tx(['audit'], 'readwrite', function (t) {
      var store = t.objectStore('audit');
      var removed = [];
      store.openCursor(null, 'prev').onsuccess = function (ev) {
        var c = ev.target.result;
        if (!c || removed.length >= count) return;
        removed.push(c.value.seq);
        c.delete();
        c.continue();
      };
      return removed;
    }).then(function (removed) {
      return removed.length
        ? { ok: true, removed: removed }
        : { ok: false, reason: 'Tidak ada entri yang dapat dihapus.' };
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    });
  }

  /** Read the audit log straight off disk, bypassing memory, together with the
   *  length/head commitment the verifier compares it against. */
  function readAudit() {
    return tx(['audit', 'meta'], 'readonly', function (t) {
      var out = { rows: [], commit: null };
      reqp(t.objectStore('meta').get('chain')).then(function (v) { out.commit = v || null; });
      t.objectStore('audit').openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (c) { out.rows.push(c.value); c.continue(); }
      };
      return out;
    }).then(function (out) {
      out.rows.sort(function (a, b) { return a.seq - b.seq; });
      return {
        ok: true, entries: out.rows,
        expected: out.commit ? { count: out.commit.count, head: out.commit.head } : null
      };
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
        req.onsuccess = function () { state.persistedAudit = 0; state.locked = false; state.lockReason = ''; resolve({ ok: true }); };
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
    load: load, save: save, tamper: tamper, truncate: truncate, readAudit: readAudit, wipe: wipe,
    heartbeat: heartbeat,
    prefGet: prefGet, prefSet: prefSet,
    tabId: TAB_ID,
    isLocked: function () { return state.locked; },
    lockInfo: function () { return { locked: state.locked, owner: state.owner, reason: state.lockReason }; },
    // Taking over is a deliberate act by the person looking at the screen, not
    // something the app decides on its own: whichever tab takes over wins, and
    // the other tab's unsaved work is gone.
    takeOver: function () { state.locked = false; state.lockReason = ''; state.persistedAudit = 0; },
    status: function () { return { available: state.available, reason: state.reason, persistedAudit: state.persistedAudit, locked: state.locked }; },
    resetPersistedCount: function () { state.persistedAudit = 0; }
  };
})(typeof self !== 'undefined' ? self : this);
