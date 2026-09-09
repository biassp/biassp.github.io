/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — domain.js
 * The pure layer. No DOM, no sql.js, no network, nothing that can fail for a
 * reason outside this file.
 *
 * WHY THIS FILE EXISTS AT ALL IN A DATABASE LAB.
 * Every headline figure on the page is computed twice: once by SQL and once by
 * folding raw rows in JavaScript. That is only worth anything if the two halves
 * share no code, so the JavaScript half needs its own arithmetic, its own
 * hashing and its own byte-level reader for the exported file. This is that
 * half. It must not learn what SQLite is.
 *
 * THREE THINGS HERE ARE DELIBERATELY NOT WHAT A MODERN CODEBASE WOULD REACH FOR:
 *  - SHA-256 is implemented by hand rather than through crypto.subtle, because
 *    the audit chain has to be computable SYNCHRONOUSLY. A migration step that
 *    rebuilds an audit table inside one SQLite transaction cannot await a
 *    Promise halfway through: sql.js is synchronous, and yielding to the event
 *    loop in the middle of a BEGIN is how you end up committing half a chain.
 *  - The PRNG is mulberry32 rather than Math.random, because a fixture that
 *    cannot be reproduced cannot be audited, and "run it again and see" is the
 *    only defence this page has against the accusation that its numbers were
 *    typed in.
 *  - Money is integer rupiah with no scaling factor. Indonesia has no
 *    circulating subunit. There is no cent to lose, so there is no float.
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- pinned */

  // Both halves of reproducibility. The PRNG seed fixes which patients exist;
  // the pinned date fixes when everything happened. Ages, visit ids, queue
  // dates and every timestamp in the audit chain derive from PINNED_TODAY, so
  // moving it one day changes the chain head — which is asserted, because a
  // fixture that is only half-pinned is a fixture that drifts overnight and
  // takes a morning to diagnose.
  var SEED = 20260908;
  var PINNED_TODAY = '2026-09-09';

  // The chain's zero. Sixty-four zeros, not the empty string: prev_hash is
  // CHECKed for 64 hex characters everywhere it is not NULL, and a sentinel
  // that fails its own column's CHECK is a sentinel you find out about in
  // production.
  var GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

  /* ------------------------------------------------------------------ PRNG */

  // mulberry32. Chosen over an LCG because the low bits of an LCG are visibly
  // periodic and a fixture built on them clusters — every third patient landing
  // in the same poli is the kind of artefact a reader notices and mistrusts.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A small envelope over the raw stream. Every draw goes through here so the
  // fixture builder never reaches for Math.random by accident — a single
  // unseeded draw anywhere destroys reproducibility and shows up only as a
  // checksum that changes on reload.
  function makeRng(seed) {
    var next = mulberry32(seed);
    function int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); }
    return {
      next: next,
      int: int,
      chance: function (p) { return next() < p; },
      pick: function (arr) { return arr[int(0, arr.length - 1)]; },
      // Weighted pick over [[value, weight], ...]. Integer weights only: a
      // float weight would make the fixture depend on float summation order.
      weighted: function (pairs) {
        var total = 0, i;
        for (i = 0; i < pairs.length; i++) total += pairs[i][1];
        var r = int(1, total);
        for (i = 0; i < pairs.length; i++) {
          r -= pairs[i][1];
          if (r <= 0) return pairs[i][0];
        }
        return pairs[pairs.length - 1][0];
      }
    };
  }

  /* -------------------------------------------------------------- integers */

  // Half-away-from-zero, and it THROWS rather than coercing. Math.round(-0.5)
  // is -0 in JavaScript — it rounds half towards +Infinity, so a naive
  // divRound gives you a different answer for a debit than for the credit that
  // reverses it, and a ledger that does not balance by one rupiah is a ledger
  // nobody trusts again. Throwing on fractional input is the other half: if a
  // float reaches this function the bug is upstream, and silently rounding it
  // hides the only evidence.
  function divRound(a, b) {
    if (typeof a !== 'number' || typeof b !== 'number') throw new Error('divRound: numbers only');
    if (!isFinite(a) || !isFinite(b)) throw new Error('divRound: finite numbers only');
    if (a !== Math.floor(a) || b !== Math.floor(b)) throw new Error('divRound: integer arguments only');
    if (b === 0) throw new Error('divRound: division by zero');
    var q = a / b;
    return q < 0 ? -Math.round(-q) : Math.round(q);
  }

  function pad(n, width) {
    var s = String(Math.abs(n));
    while (s.length < width) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  }

  // Indonesian grouping: a full stop every three digits, no subunit.
  function rupiah(n) {
    if (typeof n !== 'number' || n !== Math.floor(n)) throw new Error('rupiah: integer only');
    var neg = n < 0, s = String(Math.abs(n)), out = '';
    while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (neg ? '-Rp ' : 'Rp ') + s + out;
  }

  /* ----------------------------------------------------------- id formats */

  // These four are the only places the id shapes are written down in
  // JavaScript. Every CHECK in the schema restates them in SQL; the Schema tab
  // shows the pair side by side, because two independent statements of the same
  // rule that disagree is a bug you can see, and one statement of it is a bug
  // you cannot.
  function rmNumber(seq) { return 'RM-' + pad(seq, 6); }
  function rmSeq(rm) { return parseInt(String(rm).slice(3), 10); }
  function visitId(isoDate, seq) { return 'V-' + String(isoDate).replace(/-/g, '') + '-' + pad(seq, 4); }
  function encounterId(isoDate, seq) { return 'E-' + String(isoDate).replace(/-/g, '') + '-' + pad(seq, 4); }

  /* ------------------------------------------------------- vital scaling */

  // Named for their scale, so a column cannot be read as the wrong unit. The
  // database holds no REAL column anywhere and these are why it does not need
  // one: 37.6 C is 376 deci-celsius, and 376 is an integer.
  function dc(celsius) { return Math.round(celsius * 10); }
  function hg(kg) { return Math.round(kg * 10); }
  function mm(cm) { return Math.round(cm * 10); }
  function fromDc(v) { return v == null ? null : v / 10; }
  function fromHg(v) { return v == null ? null : v / 10; }
  function fromMm(v) { return v == null ? null : v / 10; }

  /* ------------------------------------------------------------ calendar */

  // Dates are handled as ISO strings through a UTC Date, never through local
  // time. A fixture generated in Asia/Jakarta and re-generated in CI's UTC must
  // produce the same bytes, and new Date('2026-09-09') read back with
  // getDate() does not give the same answer in both.
  function toUtc(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  function isoOf(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2);
  }

  function addDays(iso, n) { return isoOf(toUtc(iso) + n * 86400000); }

  function daysBetween(a, b) { return Math.round((toUtc(b) - toUtc(a)) / 86400000); }

  // Whole years completed, which is the only age a clinic writes down.
  function age(dobIso, onIso) {
    var d = String(dobIso).slice(0, 10).split('-');
    var o = String(onIso).slice(0, 10).split('-');
    var years = +o[0] - +d[0];
    if (+o[1] < +d[1] || (+o[1] === +d[1] && +o[2] < +d[2])) years--;
    return years;
  }

  // A timestamp with no zone suffix and no milliseconds. Every `at` column in
  // the schema is TEXT and sorts lexicographically, which is the only property
  // asked of it; inventing a timezone offset for a fabricated clinic would be a
  // detail that reads as real and is not.
  function stamp(iso, h, m, s) {
    return String(iso).slice(0, 10) + 'T' + pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s == null ? 0 : s, 2);
  }

  /* -------------------------------------------------- canonical JSON */

  // Sorted keys, no whitespace, undefined dropped. This is the exact algorithm
  // in labs/rekam/audit.js and it has to stay the exact algorithm: two systems
  // that disagree about what was hashed have a chain that is self-consistent
  // and worthless across an export. The agreement is pinned on six vectors in
  // the suite and re-checked against rekam's file by
  // tools/check-rekam-agreement.js.
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Object.prototype.toString.call(value) === '[object Array]') {
      var parts = [], i;
      for (i = 0; i < value.length; i++) parts.push(canonical(value[i]));
      return '[' + parts.join(',') + ']';
    }
    var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonical(value[k]);
    }).join(',') + '}';
  }

  /* --------------------------------------------------------- SHA-256 */

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  // Surrogate pairs are combined before encoding. TextEncoder is not used: it
  // is absent from no browser that matters, but it is also not needed, and one
  // fewer host API is one fewer thing that can behave differently between the
  // page and the node script that checks the page's arithmetic.
  function utf8Bytes(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        c2 = str.charCodeAt(i + 1);
        cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  // Straight FIPS 180-4, pinned against the standard vectors in the suite.
  // The length field is split into two 32-bit halves because a JavaScript
  // bitwise shift truncates to 32 bits and a message longer than 512 MiB would
  // otherwise hash as though it were short — an impossible input here, and
  // still not a shortcut worth taking in a file whose whole job is to be
  // trusted about hashes.
  function sha256(str) {
    var bytes = utf8Bytes(str);
    var len = bytes.length;
    var bitHi = Math.floor(len / 536870912);
    var bitLo = (len << 3) >>> 0;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push((bitHi >>> 24) & 255, (bitHi >>> 16) & 255, (bitHi >>> 8) & 255, bitHi & 255);
    bytes.push((bitLo >>> 24) & 255, (bitLo >>> 16) & 255, (bitLo >>> 8) & 255, bitLo & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    var off, t, s0, s1, a, b, c, d, e, f, g, h, S0, S1, ch, maj, t1, t2;

    for (off = 0; off < bytes.length; off += 64) {
      for (t = 0; t < 16; t++) {
        w[t] = ((bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) |
                (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (t = 0; t < 64; t++) {
        S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        ch = ((e & f) ^ (~e & g)) >>> 0;
        t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = '', i;
    for (i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8);
    return out;
  }

  /* ------------------------------------------------------- the chain */

  // The exact field set that is hashed, and the field NAMES are camelCase
  // rather than the column names on purpose: this object is the interchange
  // format shared with labs/rekam/audit.js, and it must not drift when a
  // column is renamed. entityId is the polymorphic single value — the schema
  // splits it into three typed columns at v9, and the hash input does not
  // change, which is the only reason the v9 rebuild can be verified at all.
  function commitment(entry) {
    return {
      seq: entry.seq,
      at: entry.at,
      actorId: entry.actorId,
      actorName: entry.actorName,
      actorRole: entry.actorRole,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      summary: entry.summary,
      detail: entry.detail === undefined ? null : entry.detail,
      prevHash: entry.prevHash === undefined ? null : entry.prevHash
    };
  }

  function hashEntry(entry) { return sha256(canonical(commitment(entry))); }

  /* ------------------------------------------------------------ FNV-1a */

  // 32-bit FNV-1a. Not a cryptographic choice and not pretending to be: the
  // census needs a cheap fold over every row of every table on every migration
  // step, and it needs the result to be a single comparable number. Collision
  // resistance is not the property being bought; "these bytes are not those
  // bytes" is.
  function fnv1a(str) {
    var h = 0x811c9dc5, i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /* ------------------------------------------------- the file header */

  // Reads the SQLite file header out of a plain byte array. This is the third
  // independent route on the Console tab and the only one that shares no code
  // with SQLite at all: if page size times page count does not equal the
  // exported length, either the export is truncated or the page is lying, and
  // the check costs four fields of arithmetic.
  //
  // Offsets are from the SQLite file-format document: magic 0..15, page size
  // 16..17 big-endian u16 (65536 is encoded as the value 1), page count 28..31,
  // freelist count 36..39, schema cookie 40..43, user_version 60..63.
  function decodeSqliteHeader(bytes) {
    // Sixteen bytes, and the sixteenth is a NUL. Written as an escape rather
  // than as a literal control character, because a raw NUL in a .js file makes
  // every text tool in the repository treat the file as binary: grep answers
  // "binary file matches" and stops being useful.
  var MAGIC = 'SQLite format 3\u0000';
    var magic = '', i;
    if (!bytes || bytes.length < 100) throw new Error('decodeSqliteHeader: need at least 100 bytes');
    for (i = 0; i < 16; i++) magic += String.fromCharCode(bytes[i]);
    function u16(o) { return (bytes[o] << 8) | bytes[o + 1]; }
    function u32(o) {
      return ((bytes[o] * 16777216) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3]) >>> 0;
    }
    var raw = u16(16);
    return {
      magic: magic,
      magicOk: magic === MAGIC,
      pageSize: raw === 1 ? 65536 : raw,
      pageCount: u32(28),
      freelistCount: u32(36),
      schemaCookie: u32(40),
      userVersion: u32(60),
      byteLength: bytes.length
    };
  }

  root.ROMBAK_DOMAIN = {
    SEED: SEED,
    PINNED_TODAY: PINNED_TODAY,
    GENESIS: GENESIS,
    mulberry32: mulberry32,
    makeRng: makeRng,
    divRound: divRound,
    pad: pad,
    rupiah: rupiah,
    rmNumber: rmNumber,
    rmSeq: rmSeq,
    visitId: visitId,
    encounterId: encounterId,
    dc: dc,
    hg: hg,
    mm: mm,
    fromDc: fromDc,
    fromHg: fromHg,
    fromMm: fromMm,
    addDays: addDays,
    daysBetween: daysBetween,
    age: age,
    stamp: stamp,
    canonical: canonical,
    sha256: sha256,
    sha256Hex: sha256,
    commitment: commitment,
    hashEntry: hashEntry,
    fnv1a: fnv1a,
    decodeSqliteHeader: decodeSqliteHeader
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.ROMBAK_DOMAIN;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
