/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — store.js
 * The only file besides app.js that touches storage, and it touches two kinds,
 * for two unrelated reasons.
 *
 * localStorage holds the THEME and nothing else, because the theme must be
 * applied before first paint and IndexedDB is asynchronous. guard.js reads it
 * ahead of paint from its own guarded copy of these accessors; this file writes
 * it and re-reads it at runtime. Every access is wrapped, because reading the
 * localStorage PROPERTY itself throws where site data is blocked (private
 * windows, third-party contexts, browsers set to refuse storage) — one
 * unguarded access takes the whole script block with it, and this repository
 * has shipped that exact bug on its own homepage once already.
 *
 * IndexedDB holds ONE demonstration: a non-extractable signing key, written,
 * then read back in a fresh transaction, still signing to the identical bytes
 * and still refusing to be exported. Ed25519 is used precisely because its
 * signatures are deterministic — the same key over the same message gives the
 * same bytes — so "identical after reload" is a statement about the key's
 * survival rather than about a nonce. This panel is labelled on the page as
 * running in the visitor's own browser and NOT in the CI-verified count: the
 * assertion suite is storage-free by design, and importing storage into it
 * would put a CryptoKey on the boundary CI's page.evaluate crosses, where a key
 * silently becomes {} and every assertion over it goes green forever. The
 * extractability half of the claim — a non-extractable key refuses export — is
 * crypto.subtle-only and IS in the count, through the fixture.
 *
 * This file reaches for no sibling global. subtle arrives as an argument when
 * the page runs the key demo; storage arrives through the wrapped accessors
 * below; and it is safe to require() with no DOM, which is why every load-time
 * side effect is guarded by a typeof document check.
 */
(function (root) {
  'use strict';

  var NS = {};

  var THEME_KEY = 'sahih.theme';
  var DB_NAME = 'sahih-keys';
  var DB_VERSION = 1;
  var STORE = 'keys';
  var DEMO_KEY = 'demo';

  NS.THEME_KEY = THEME_KEY;
  NS.DB_NAME = DB_NAME;
  NS.DB_VERSION = DB_VERSION;
  NS.STORE = STORE;

  /* ------------------------------------------------------- localStorage */

  NS.readLocal = function (key) {
    try { return root.localStorage.getItem(key); } catch (e) { return null; }
  };
  NS.writeLocal = function (key, value) {
    try { root.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  };
  NS.removeLocal = function (key) {
    try { root.localStorage.removeItem(key); return true; } catch (e) { return false; }
  };

  /* Raw values, stray quotes stripped, a legacy quoted value tolerated — the
     same contract guard.js applies before first paint, repeated rather than
     shared because guard.js must stand alone in <head> with no dependency. The
     unprefixed 'theme' fallback lets a visitor who chose a theme on a sibling
     lab see the same one here. */
  NS.readTheme = function () {
    var v = NS.readLocal(THEME_KEY);
    if (v === null) v = NS.readLocal('theme');
    if (v === null) return null;
    v = String(v).replace(/"/g, '');
    return v === 'light' || v === 'dark' ? v : null;
  };
  /* Written RAW ('light' / 'dark'), never JSON. guard.js self-heals a quoted
     value once per load, and writing JSON here would make it do that on every
     visit forever. */
  NS.writeTheme = function (theme) {
    if (theme !== 'light' && theme !== 'dark') return false;
    return NS.writeLocal(THEME_KEY, theme);
  };

  /* ------------------------------------------------------- IndexedDB */

  var dbp = null;
  var openConn = null;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var idb;
      try { idb = root.indexedDB; } catch (e) { reject(new Error('IndexedDB is blocked by a browser setting')); return; }
      if (!idb) { reject(new Error('this browser has no IndexedDB')); return; }
      var req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e2) { reject(e2); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'k' });
      };
      req.onsuccess = function () { openConn = req.result; resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB refused to open')); };
    });
    return dbp;
  }

  /* An open connection blocks deleteDatabase, so the escape hatch closes ours
     before it deletes. Guarded because close() on a half-open handle can throw. */
  function closeConn() {
    if (openConn) { try { openConn.close(); } catch (e) { /* already closing */ } openConn = null; }
    dbp = null;
  }

  function putRecord(db, rec) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(rec);
      t.oncomplete = function () { resolve(true); };
      t.onerror = function () { reject(t.error || new Error('write failed')); };
    });
  }

  function getRecord(db, key) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(STORE, 'readonly');
      var r = t.objectStore(STORE).get(key);
      r.onsuccess = function () { resolve(r.result || null); };
      r.onerror = function () { reject(r.error || new Error('read failed')); };
    });
  }

  function toHex(bytes) {
    var s = '', i, h;
    for (i = 0; i < bytes.length; i++) { h = bytes[i].toString(16); if (h.length < 2) h = '0' + h; s += h; }
    return s;
  }

  var DEMO_MSG = 'sahih: the key that will not leave the browser';

  /* The whole demonstration, returning a PLAIN object — no CryptoKey, no
     ArrayBuffer, no Error crosses back out. Generate a non-extractable Ed25519
     signing key, sign a fixed message, store the key, reopen it in a fresh
     transaction, sign the same message again, and try to export it. A key that
     survived the round trip signs to the identical hex; a non-extractable key
     refuses export with InvalidAccessError. Both halves are recorded, and the
     export error's NAME is kept while its wording is not, because the wording
     is the engine's and carries no stability contract. */
  NS.keyRoundTrip = function (subtle) {
    if (!subtle || typeof subtle.generateKey !== 'function') {
      return Promise.resolve({ ran: false, reason: 'crypto.subtle was not provided' });
    }
    var msg = null, key = null, hexBefore = null, db = null;
    try { msg = strToBytes(DEMO_MSG); } catch (e0) { return Promise.resolve({ ran: false, reason: 'could not encode the demo message' }); }

    return subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
      .then(function (pair) {
        key = pair.privateKey;
        return subtle.sign({ name: 'Ed25519' }, key, msg);
      })
      .then(function (sig) {
        hexBefore = toHex(new Uint8Array(sig));
        return openDB();
      })
      .then(function (opened) { db = opened; return putRecord(db, { k: DEMO_KEY, key: key, alg: 'Ed25519' }); })
      .then(function () { return getRecord(db, DEMO_KEY); })
      .then(function (rec) {
        if (!rec || !rec.key) throw new Error('the stored key did not come back');
        return subtle.sign({ name: 'Ed25519' }, rec.key, msg).then(function (sig2) {
          var hexAfter = toHex(new Uint8Array(sig2));
          return { rec: rec, hexAfter: hexAfter };
        });
      })
      .then(function (r) {
        /* The export attempt is expected to be refused; a resolution would mean
           the stored key came back extractable, which is its own finding. */
        return subtle.exportKey('raw', r.rec.key).then(
          function () {
            return finishRoundTrip(hexBefore, r.hexAfter, false, null);
          },
          function (e) {
            return finishRoundTrip(hexBefore, r.hexAfter, true, e && e.name ? String(e.name) : 'Error');
          }
        );
      })
      ['catch'](function (e) {
        return { ran: false, reason: 'IndexedDB was not available', errName: e && e.name ? String(e.name) : 'Error' };
      });
  };

  function finishRoundTrip(hexBefore, hexAfter, exportRefused, exportErrName) {
    return {
      ran: true,
      dbName: DB_NAME,
      alg: 'Ed25519',
      extractable: false,
      signedBeforeStore: hexBefore,
      signedAfterReload: hexAfter,
      identicalAfterReload: hexBefore === hexAfter,
      exportRefused: exportRefused,
      exportErrName: exportErrName,
      note: 'runs in your browser, not in the CI-verified count'
    };
  }

  function strToBytes(s) {
    /* A private UTF-8 encoder so this file needs no sibling for one string. The
       demo message is ASCII, but the loop is written for the general case. */
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) { out.push(c); }
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return new Uint8Array(out);
  }

  /* ------------------------------------------------------- the escape hatch */

  /* Deletes the IndexedDB database this lab created and clears every sahih.*
     localStorage entry EXCEPT the theme, which is a preference rather than data
     and whose removal would flash the page to the wrong colour on the way out.
     Resolves to a plain report; never rejects, because an escape hatch that can
     itself throw is not an escape hatch. */
  NS.deleteLocalData = function () {
    var removedKeys = [];
    try {
      var ls = root.localStorage, i, k;
      if (ls) {
        var toRemove = [];
        for (i = 0; i < ls.length; i++) {
          k = ls.key(i);
          if (k && k.indexOf('sahih.') === 0 && k !== THEME_KEY) toRemove.push(k);
        }
        for (i = 0; i < toRemove.length; i++) { NS.removeLocal(toRemove[i]); removedKeys.push(toRemove[i]); }
      }
    } catch (e) { /* storage blocked; nothing to remove, and that is fine */ }

    closeConn();
    return new Promise(function (resolve) {
      var idb;
      try { idb = root.indexedDB; } catch (e2) { resolve({ ok: true, removedKeys: removedKeys, idbDeleted: false, themeKept: true }); return; }
      if (!idb || typeof idb.deleteDatabase !== 'function') { resolve({ ok: true, removedKeys: removedKeys, idbDeleted: false, themeKept: true }); return; }
      var req;
      try { req = idb.deleteDatabase(DB_NAME); } catch (e3) { resolve({ ok: true, removedKeys: removedKeys, idbDeleted: false, themeKept: true }); return; }
      req.onsuccess = function () { resolve({ ok: true, removedKeys: removedKeys, idbDeleted: true, themeKept: true }); };
      req.onerror = function () { resolve({ ok: true, removedKeys: removedKeys, idbDeleted: false, themeKept: true }); };
      req.onblocked = function () { resolve({ ok: true, removedKeys: removedKeys, idbDeleted: false, themeKept: true, blocked: true }); };
    });
  };

  /* The button lives in the footer rather than on a tab, because a control that
     erases the visitor's data must not be the one tab nobody opens. Mounted at
     load when a DOM is present; a second call is a no-op so a reload or a
     double-load cannot plant two buttons. */
  NS.mountDeleteButton = function (footEl) {
    if (typeof document === 'undefined') return null;
    var foot = footEl || document.querySelector('.foot');
    if (!foot || foot.querySelector('[data-sahih-wipe]')) return null;

    var p = document.createElement('p');
    p.className = 'small no-print';
    var btn = document.createElement('button');
    btn.className = 'btn ghost small';
    btn.type = 'button';
    btn.setAttribute('data-sahih-wipe', '1');
    btn.textContent = 'Delete my local data';
    var status = document.createElement('span');
    status.className = 'small';

    btn.addEventListener('click', function () {
      btn.disabled = true;
      NS.deleteLocalData().then(function (r) {
        status.textContent = ' Local data deleted' + (r.idbDeleted ? ' (the demo key too)' : '') +
          '. Your theme preference is kept.';
        btn.disabled = false;
      })['catch'](function () {
        status.textContent = ' Nothing to delete.';
        btn.disabled = false;
      });
    });

    p.appendChild(btn);
    p.appendChild(status);
    foot.appendChild(p);
    return btn;
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { NS.mountDeleteButton(); });
    } else {
      NS.mountDeleteButton();
    }
  }

  root.SAHIH_STORE = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_STORE;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
