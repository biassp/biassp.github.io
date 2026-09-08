/*!
 * Saku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Saku — store.js
 * IndexedDB layer. Deliberately scope-agnostic: this file is loaded by the page
 * with <script src> AND by the service worker with importScripts(), because the
 * share-target POST is written to the database from inside the worker while the
 * page may not exist yet. Nothing here touches the DOM.
 */
(function (scope) {
  'use strict';

  var DB_NAME = 'saku-db';
  var DB_VERSION = 2;
  var LEASE_MS = 15000;

  var dbp = null;
  var migrationLog = [];

  function uid(prefix) {
    var c = scope.crypto;
    var s;
    if (c && typeof c.randomUUID === 'function') {
      s = c.randomUUID();
    } else if (c && c.getRandomValues) {
      var a = new Uint8Array(16);
      c.getRandomValues(a);
      s = Array.prototype.map.call(a, function (b) {
        return (b + 0x100).toString(16).slice(1);
      }).join('');
    } else {
      s = String(Date.now()) + Math.random().toString(16).slice(2);
    }
    return (prefix || '') + s;
  }

  function log(msg) {
    migrationLog.push({ t: Date.now(), msg: msg });
  }

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!scope.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser context'));
        return;
      }
      var req;
      try {
        req = scope.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function (ev) {
        var db = req.result;
        var tx = req.transaction;
        var from = ev.oldVersion;
        if (from < 1) {
          var entries = db.createObjectStore('entries', { keyPath: 'id' });
          entries.createIndex('byCreated', 'createdAt');
          var outbox = db.createObjectStore('outbox', { keyPath: 'id' });
          outbox.createIndex('byNextAt', 'nextAt');
          db.createObjectStore('peer', { keyPath: 'entryId' });
          db.createObjectStore('meta', { keyPath: 'k' });
          log('v0 → v1: created entries, outbox, peer, meta');
        }
        if (from < 2) {
          // v2 adds the merchant→category map, the conflict log, and a
          // sync-state index used by the outbox badge.
          if (!db.objectStoreNames.contains('merchants')) {
            db.createObjectStore('merchants', { keyPath: 'merchant' });
          }
          if (!db.objectStoreNames.contains('conflicts')) {
            db.createObjectStore('conflicts', { keyPath: 'id' });
          }
          if (tx && db.objectStoreNames.contains('entries')) {
            var st = tx.objectStore('entries');
            if (!st.indexNames.contains('bySynced')) st.createIndex('bySynced', 'synced');
          }
          log('v' + Math.max(from, 1) + ' → v2: added merchants, conflicts, entries.bySynced');
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { try { db.close(); } catch (e) {} dbp = null; };
        resolve(db);
      };
      req.onerror = function () { dbp = null; reject(req.error || new Error('open failed')); };
      req.onblocked = function () { log('open blocked by another tab holding an older version'); };
    });
    return dbp;
  }

  /* ---------- tiny promise wrappers ---------- */

  function reqp(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function withStore(names, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(names, mode);
        var out;
        var failure = null;
        tx.oncomplete = function () { resolve(out); };
        tx.onabort = function () { reject(failure || tx.error || new Error('transaction aborted')); };
        tx.onerror = function () { failure = failure || tx.error; };
        try {
          out = fn(tx, function (e) { failure = e; });
        } catch (e) {
          failure = e;
          try { tx.abort(); } catch (_) {}
        }
      });
    });
  }

  function all(storeName) {
    return withStore([storeName], 'readonly', function (tx) {
      var res = [];
      tx.objectStore(storeName).openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (c) { res.push(c.value); c.continue(); }
      };
      return res;
    });
  }

  /* ---------- meta ---------- */

  function metaGet(k, dflt) {
    return withStore(['meta'], 'readonly', function (tx) {
      var box = { v: dflt };
      reqp(tx.objectStore('meta').get(k)).then(function (r) {
        if (r && typeof r.v !== 'undefined') box.v = r.v;
      });
      return box;
    }).then(function (box) { return box.v; });
  }

  function metaSet(k, v) {
    return withStore(['meta'], 'readwrite', function (tx) {
      tx.objectStore('meta').put({ k: k, v: v });
      return v;
    });
  }

  var DEFAULT_CHAOS = {
    offline: false,
    latencyMs: 250,
    failRate: 0,
    duplicate: false,
    corrupt: false,
    quota: false,
    swThrow: false
  };

  function getChaos() {
    return metaGet('chaos', null).then(function (c) {
      var out = {};
      for (var k in DEFAULT_CHAOS) out[k] = (c && typeof c[k] !== 'undefined') ? c[k] : DEFAULT_CHAOS[k];
      return out;
    }).catch(function () {
      var out = {};
      for (var k in DEFAULT_CHAOS) out[k] = DEFAULT_CHAOS[k];
      return out;
    });
  }

  function setChaos(patch) {
    return getChaos().then(function (c) {
      for (var k in patch) c[k] = patch[k];
      return metaSet('chaos', c).then(function () { return c; });
    });
  }

  /* ---------- entries + outbox: the atomic write path ---------- */

  function quotaError() {
    var msg = 'QuotaExceededError (chaos-injected): the origin storage budget was ' +
      'exhausted mid-transaction';
    if (typeof DOMException === 'function') {
      try { return new DOMException(msg, 'QuotaExceededError'); } catch (e) {}
    }
    var err = new Error(msg);
    err.name = 'QuotaExceededError';
    return err;
  }

  function newEntry(seed) {
    var now = Date.now();
    return {
      id: uid('e_'),
      amount: seed.amount === null || typeof seed.amount === 'undefined' ? null : Number(seed.amount),
      currency: seed.currency || 'IDR',
      merchant: seed.merchant || 'Unknown',
      direction: seed.direction === 'in' ? 'in' : 'out',
      category: seed.category || null,
      note: seed.note || '',
      source: seed.source || 'manual',
      rawText: seed.rawText || '',
      rule: seed.rule || null,
      confidence: typeof seed.confidence === 'number' ? seed.confidence : null,
      occurredAt: seed.occurredAt || now,
      createdAt: now,
      updatedAt: now,
      photo: seed.photo || null,
      photoType: seed.photoType || null,
      photoBytes: seed.photoBytes || 0,
      trace: seed.trace || [],
      synced: 0,
      clock: 0,
      fc: {}
    };
  }

  var TRACKED = ['amount', 'currency', 'merchant', 'direction', 'category', 'note', 'occurredAt'];

  /**
   * commitEntry — the load-bearing transaction.
   * The entry row, its outbox job and the Lamport counter bump are committed in
   * ONE readwrite transaction spanning three stores. If anything throws (including
   * an injected QuotaExceededError) the transaction is aborted, so it is not
   * possible to end up with an entry nobody will sync, or an outbox job pointing
   * at a row that does not exist.
   */
  function commitEntry(seed, opts) {
    opts = opts || {};
    var record = seed && seed.__isEntry ? seed : newEntry(seed || {});
    var job = null;
    return getChaos().then(function (chaos) {
      var injectQuota = opts.injectQuota || chaos.quota;
      return withStore(['entries', 'outbox', 'meta'], 'readwrite', function (tx, fail) {
        var metaStore = tx.objectStore('meta');
        var r = metaStore.get('lamport');
        r.onsuccess = function () {
          try {
            var n = ((r.result && r.result.v) || 0) + 1;
            metaStore.put({ k: 'lamport', v: n });
            record.clock = n;
            record.updatedAt = Date.now();
            TRACKED.forEach(function (f) { record.fc[f] = n; });
            tx.objectStore('entries').put(record);
            if (injectQuota) {
              // Deliberately fail AFTER the entry put and BEFORE the outbox put:
              // if the abort did not work you would see an orphan entry.
              fail(quotaError());
              tx.abort();
              return;
            }
            job = {
              id: uid('ob_'),
              entryId: record.id,
              op: 'upsert',
              idem: uid('idem_'),
              attempts: 0,
              createdAt: Date.now(),
              nextAt: Date.now(),
              claimedBy: null,
              leaseUntil: 0,
              lastError: null
            };
            tx.objectStore('outbox').put(job);
          } catch (e) {
            fail(e);
            try { tx.abort(); } catch (_) {}
          }
        };
        r.onerror = function () { fail(r.error); };
        return record;
      });
    }).then(function (rec) {
      return { entry: rec, job: job };
    });
  }

  /**
   * updateEntry(id, patch, opts)
   * opts.forceFields: bump the Lamport clock for these fields even when the
   * value did not change. Conflict resolution needs this — "keep mine" must
   * still overtake the peer's clock, or the same conflict is raised forever.
   */
  function updateEntry(id, patch, opts) {
    opts = opts || {};
    var force = opts.forceFields || [];
    var updated = null;
    return withStore(['entries', 'outbox', 'meta'], 'readwrite', function (tx, fail) {
      var entries = tx.objectStore('entries');
      var metaStore = tx.objectStore('meta');
      var er = entries.get(id);
      er.onsuccess = function () {
        try {
          var e = er.result;
          if (!e) { fail(new Error('entry ' + id + ' not found')); tx.abort(); return; }
          var mr = metaStore.get('lamport');
          mr.onsuccess = function () {
            try {
              var n = ((mr.result && mr.result.v) || 0) + 1;
              metaStore.put({ k: 'lamport', v: n });
              var changed = [];
              Object.keys(patch).forEach(function (f) {
                if (e[f] !== patch[f]) changed.push(f);
                e[f] = patch[f];
              });
              force.forEach(function (f) { if (changed.indexOf(f) < 0) changed.push(f); });
              e.fc = e.fc || {};
              changed.forEach(function (f) { if (TRACKED.indexOf(f) >= 0) e.fc[f] = n; });
              e.clock = n;
              e.updatedAt = Date.now();
              e.synced = 0;
              entries.put(e);
              tx.objectStore('outbox').put({
                id: uid('ob_'), entryId: id, op: 'upsert', idem: uid('idem_'),
                attempts: 0, createdAt: Date.now(), nextAt: Date.now(),
                claimedBy: null, leaseUntil: 0, lastError: null
              });
              updated = e;
            } catch (e2) { fail(e2); try { tx.abort(); } catch (_) {} }
          };
          mr.onerror = function () { fail(mr.error); };
        } catch (e3) { fail(e3); try { tx.abort(); } catch (_) {} }
      };
      er.onerror = function () { fail(er.error); };
      return null;
    }).then(function () { return updated; });
  }

  function deleteEntry(id) {
    return withStore(['entries', 'outbox'], 'readwrite', function (tx) {
      tx.objectStore('entries').delete(id);
      var ob = tx.objectStore('outbox');
      ob.openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (!c) return;
        if (c.value.entryId === id) c.delete();
        c.continue();
      };
      return true;
    });
  }

  function getEntry(id) {
    return withStore(['entries'], 'readonly', function (tx) {
      var box = {};
      reqp(tx.objectStore('entries').get(id)).then(function (v) { box.v = v; });
      return box;
    }).then(function (b) { return b.v; });
  }

  function listEntries() {
    return all('entries').then(function (rows) {
      rows.sort(function (a, b) { return (b.occurredAt || b.createdAt) - (a.occurredAt || a.createdAt); });
      return rows;
    });
  }

  function putEntryRaw(entry) {
    return withStore(['entries'], 'readwrite', function (tx) {
      tx.objectStore('entries').put(entry);
      return entry;
    });
  }

  /* ---------- outbox ---------- */

  function outboxAll() {
    return all('outbox').then(function (rows) {
      rows.sort(function (a, b) { return a.nextAt - b.nextAt; });
      return rows;
    });
  }

  /**
   * claimJob — IndexedDB has no cross-tab lock, so two open tabs will happily
   * drain the same outbox row and double-send. The claim flag AND its lease
   * timestamp are re-read and written inside one readwrite transaction, which is
   * the only place the check and the write cannot be interleaved.
   */
  function claimJob(jobId, clientId, leaseMs) {
    var got = false;
    return withStore(['outbox'], 'readwrite', function (tx, fail) {
      var st = tx.objectStore('outbox');
      var r = st.get(jobId);
      r.onsuccess = function () {
        var job = r.result;
        if (!job) return;
        var now = Date.now();
        if (job.claimedBy && job.claimedBy !== clientId && job.leaseUntil > now) return;
        job.claimedBy = clientId;
        job.leaseUntil = now + (leaseMs || LEASE_MS);
        st.put(job);
        got = true;
      };
      r.onerror = function () { fail(r.error); };
      return null;
    }).then(function () { return got; });
  }

  function releaseJob(jobId, patch) {
    return withStore(['outbox'], 'readwrite', function (tx) {
      var st = tx.objectStore('outbox');
      st.get(jobId).onsuccess = function (ev) {
        var job = ev.target.result;
        if (!job) return;
        job.claimedBy = null;
        job.leaseUntil = 0;
        for (var k in patch) job[k] = patch[k];
        st.put(job);
      };
      return true;
    });
  }

  function completeJob(jobId, entryId, clock) {
    return withStore(['outbox', 'entries'], 'readwrite', function (tx) {
      tx.objectStore('outbox').delete(jobId);
      if (entryId) {
        var st = tx.objectStore('entries');
        st.get(entryId).onsuccess = function (ev) {
          var e = ev.target.result;
          if (!e) return;
          e.synced = 1;
          e.syncedClock = clock || e.clock;
          st.put(e);
        };
      }
      return true;
    });
  }

  /**
   * observeClock — Lamport rule on receive: local counter jumps to
   * max(local, remote) so a later local edit is provably newer than the peer
   * copy it is overwriting. Wall-clock time is never used for ordering, because
   * two devices' clocks disagree and a phone's clock can go backwards.
   */
  function observeClock(remote) {
    return withStore(['meta'], 'readwrite', function (tx) {
      var st = tx.objectStore('meta');
      st.get('lamport').onsuccess = function (ev) {
        var cur = (ev.target.result && ev.target.result.v) || 0;
        if (remote > cur) st.put({ k: 'lamport', v: remote });
      };
      return true;
    });
  }

  /* ---------- simulated peer (local IDB, never a network) ---------- */

  function peerGet(entryId) {
    return withStore(['peer'], 'readonly', function (tx) {
      var box = {};
      reqp(tx.objectStore('peer').get(entryId)).then(function (v) { box.v = v; });
      return box;
    }).then(function (b) { return b.v; });
  }

  function peerPut(rec) {
    return withStore(['peer'], 'readwrite', function (tx) {
      tx.objectStore('peer').put(rec);
      return rec;
    });
  }

  function peerAll() { return all('peer'); }

  /* ---------- conflicts ---------- */

  function conflictPut(c) {
    return withStore(['conflicts'], 'readwrite', function (tx) {
      tx.objectStore('conflicts').put(c);
      return c;
    });
  }
  function conflictAll() { return all('conflicts'); }
  function conflictDelete(id) {
    return withStore(['conflicts'], 'readwrite', function (tx) {
      tx.objectStore('conflicts').delete(id);
      return true;
    });
  }

  /* ---------- merchant -> category map (learned from corrections) ---------- */

  function merchantLearn(merchant, category) {
    if (!merchant || !category) return Promise.resolve(null);
    var key = String(merchant).toLowerCase().trim();
    return withStore(['merchants'], 'readwrite', function (tx) {
      var st = tx.objectStore('merchants');
      st.get(key).onsuccess = function (ev) {
        var row = ev.target.result || { merchant: key, category: category, hits: 0 };
        row.category = category;
        row.hits = (row.hits || 0) + 1;
        row.updatedAt = Date.now();
        st.put(row);
      };
      return true;
    });
  }

  function merchantLookup(merchant) {
    if (!merchant) return Promise.resolve(null);
    var key = String(merchant).toLowerCase().trim();
    return withStore(['merchants'], 'readonly', function (tx) {
      var box = {};
      reqp(tx.objectStore('merchants').get(key)).then(function (v) { box.v = v; });
      return box;
    }).then(function (b) { return b.v ? b.v.category : null; });
  }

  function merchantAll() { return all('merchants'); }

  /* ---------- schema introspection for the Engine console ---------- */

  function schema() {
    return openDB().then(function (db) {
      var names = [];
      for (var i = 0; i < db.objectStoreNames.length; i++) names.push(db.objectStoreNames[i]);
      return { name: db.name, version: db.version, stores: names, migrations: migrationLog.slice() };
    });
  }

  /* ---------- export / import / wipe ---------- */

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsDataURL(blob);
      } catch (e) { reject(e); }
    });
  }

  function dataURLToBlob(url) {
    var parts = String(url).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [null, 'application/octet-stream'])[1];
    var bin = atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function exportAll() {
    return Promise.all([listEntries(), outboxAll(), peerAll(), merchantAll(), all('meta'), conflictAll()])
      .then(function (r) {
        var entries = r[0];
        return Promise.all(entries.map(function (e) {
          var copy = {};
          for (var k in e) copy[k] = e[k];
          if (e.photo) {
            return blobToDataURL(e.photo).then(function (u) { copy.photo = u; copy.photoEncoded = 'data-url'; return copy; });
          }
          return copy;
        })).then(function (entriesOut) {
          return {
            format: 'saku-export',
            version: 2,
            exportedAt: new Date().toISOString(),
            note: 'All data is local. No server was ever contacted by this page.',
            entries: entriesOut, outbox: r[1], peer: r[2], merchants: r[3], meta: r[4], conflicts: r[5]
          };
        });
      });
  }

  function importAll(doc) {
    if (!doc || doc.format !== 'saku-export') return Promise.reject(new Error('not a Saku export file'));
    var entries = (doc.entries || []).map(function (e) {
      var copy = {};
      for (var k in e) copy[k] = e[k];
      if (copy.photoEncoded === 'data-url' && typeof copy.photo === 'string') {
        try { copy.photo = dataURLToBlob(copy.photo); } catch (err) { copy.photo = null; }
        delete copy.photoEncoded;
      }
      return copy;
    });
    return withStore(['entries', 'outbox', 'peer', 'merchants', 'conflicts'], 'readwrite', function (tx) {
      entries.forEach(function (e) { tx.objectStore('entries').put(e); });
      (doc.outbox || []).forEach(function (o) { tx.objectStore('outbox').put(o); });
      (doc.peer || []).forEach(function (p) { tx.objectStore('peer').put(p); });
      (doc.merchants || []).forEach(function (m) { tx.objectStore('merchants').put(m); });
      (doc.conflicts || []).forEach(function (c) { tx.objectStore('conflicts').put(c); });
      return entries.length;
    });
  }

  function clearAll() {
    return withStore(['entries', 'outbox', 'peer', 'merchants', 'conflicts', 'meta'], 'readwrite', function (tx) {
      ['entries', 'outbox', 'peer', 'merchants', 'conflicts', 'meta'].forEach(function (n) {
        tx.objectStore(n).clear();
      });
      return true;
    });
  }

  function deleteDatabase() {
    return openDB().then(function (db) {
      try { db.close(); } catch (e) {}
      dbp = null;
      return new Promise(function (resolve) {
        var r = scope.indexedDB.deleteDatabase(DB_NAME);
        r.onsuccess = r.onerror = r.onblocked = function () { resolve(true); };
      });
    }).catch(function () { return false; });
  }

  scope.SakuStore = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    LEASE_MS: LEASE_MS,
    TRACKED: TRACKED,
    uid: uid,
    openDB: openDB,
    schema: schema,
    newEntry: newEntry,
    commitEntry: commitEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    getEntry: getEntry,
    listEntries: listEntries,
    putEntryRaw: putEntryRaw,
    outboxAll: outboxAll,
    claimJob: claimJob,
    releaseJob: releaseJob,
    completeJob: completeJob,
    observeClock: observeClock,
    peerGet: peerGet,
    peerPut: peerPut,
    peerAll: peerAll,
    conflictPut: conflictPut,
    conflictAll: conflictAll,
    conflictDelete: conflictDelete,
    merchantLearn: merchantLearn,
    merchantLookup: merchantLookup,
    merchantAll: merchantAll,
    metaGet: metaGet,
    metaSet: metaSet,
    getChaos: getChaos,
    setChaos: setChaos,
    DEFAULT_CHAOS: DEFAULT_CHAOS,
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll,
    deleteDatabase: deleteDatabase,
    migrationLog: migrationLog
  };
})(typeof self !== 'undefined' ? self : this);
