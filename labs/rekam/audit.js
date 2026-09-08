/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — audit.js
 * Append-only, hash-chained audit trail.
 *
 * WHY A CHAIN AND NOT A LOG TABLE.
 * Indonesian law (Permenkes 24/2022 on rekam medis elektronik, and before it
 * Permenkes 269/2008) requires two things that pull in opposite directions: a
 * medical record must be CORRECTABLE, and it must not be silently rewritable.
 * The reconciliation is the same everywhere in the world: corrections are
 * additive. You never overwrite; you append an addendum that supersedes, and
 * both versions stay readable with who changed what, when and why.
 *
 * A plain audit table satisfies that only as long as nobody with database
 * access edits the table. Hash-chaining removes the "as long as" — each entry
 * commits to the hash of the one before it, so editing entry 7 invalidates 7
 * and every entry after it. That does not make tampering impossible (whoever
 * can edit row 7 can in principle recompute 8..n), but it makes SILENT
 * tampering impossible, and in a dispute that is the property that matters:
 * the record either verifies or names the exact entry where it stopped.
 *
 * A production system anchors the head hash somewhere the clinic does not
 * control — countersigned by a server key, or published daily — so that a
 * wholesale recomputation is also detectable. This demo verifies in-tab and
 * says so rather than pretending otherwise.
 *
 * IMPLEMENTATION NOTES.
 * - Hash input is CANONICAL JSON: keys sorted, no whitespace, numbers via
 *   JSON.stringify. Two systems must agree byte-for-byte on what was hashed or
 *   the chain is only self-consistent, which is worthless across an export.
 * - crypto.subtle.digest is the primary hasher. A pure-JS SHA-256 is included
 *   as a fallback for non-secure contexts (plain http on a LAN IP, where
 *   crypto.subtle is simply undefined) — and the test suite asserts the two
 *   agree on FIPS-180-4 vectors, because a fallback that disagrees would
 *   quietly split the chain in two.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});

  var GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

  /* ------------------------------------------------------- canonical JSON */

  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(canonical).join(',') + ']';
    }
    var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonical(value[k]);
    }).join(',') + '}';
  }

  /* --------------------------------------------------- SHA-256 (fallback) */

  // Straight FIPS 180-4. Used only when crypto.subtle is unavailable; the
  // suite pins it against the standard vectors and against crypto.subtle.
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

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }

  function sha256Hex(str) {
    var bytes = utf8Bytes(str);
    var len = bytes.length;
    var bitLenHi = Math.floor(len / 536870912);
    var bitLenLo = (len << 3) >>> 0;
    bytes = bytes.slice();
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255);
    bytes.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);

    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

    for (var off = 0; off < bytes.length; off += 64) {
      var t;
      for (t = 0; t < 16; t++) {
        w[t] = ((bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) |
                (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }

  /* ------------------------------------------------------------- hashing */

  var subtle = null;
  try {
    subtle = (root.crypto && root.crypto.subtle) || null;
  } catch (e) { subtle = null; }

  function hashBackend() {
    return subtle ? 'crypto.subtle (SHA-256)' : 'SHA-256 (implementasi JS internal)';
  }

  function digestHex(str) {
    if (!subtle) return Promise.resolve(sha256Hex(str));
    var enc;
    try {
      enc = new TextEncoder().encode(str);
    } catch (e) {
      return Promise.resolve(sha256Hex(str));
    }
    return subtle.digest('SHA-256', enc).then(function (buf) {
      var v = new Uint8Array(buf), out = '';
      for (var i = 0; i < v.length; i++) out += ('0' + v[i].toString(16)).slice(-2);
      return out;
      // Any failure inside subtle (revoked permission, exotic build) falls
      // back rather than leaving the chain un-hashable.
    }).catch(function () { return sha256Hex(str); });
  }

  /* -------------------------------------------------------------- entries */

  // The exact field set that is hashed. Anything outside this object is NOT
  // covered by the chain, so it lives here and nowhere else.
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
      prevHash: entry.prevHash
    };
  }

  function hashEntry(entry) {
    return digestHex(canonical(commitment(entry)));
  }

  /**
   * A Chain owns an ordered array of entries. It never mutates an existing
   * entry — the only mutation is push.
   */
  function Chain(existing) {
    this.entries = (existing || []).slice();
  }

  Chain.prototype.head = function () {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
  };

  Chain.prototype.nextSeq = function () {
    return this.entries.length ? this.entries[this.entries.length - 1].seq + 1 : 1;
  };

  /**
   * append(record) -> Promise<entry>
   * record: { at?, actorId, actorName, actorRole, action, entity, entityId,
   *           summary, detail? }
   */
  Chain.prototype.append = function (record) {
    var self = this;
    var entry = {
      seq: this.nextSeq(),
      at: record.at || new Date().toISOString(),
      actorId: record.actorId || 'unknown',
      actorName: record.actorName || 'Tidak diketahui',
      actorRole: record.actorRole || 'unknown',
      action: record.action,
      entity: record.entity,
      entityId: record.entityId == null ? null : String(record.entityId),
      summary: record.summary || '',
      detail: record.detail === undefined ? null : record.detail,
      prevHash: this.head(),
      hash: null
    };
    return hashEntry(entry).then(function (h) {
      entry.hash = h;
      self.entries.push(entry);
      return entry;
    });
  };

  /**
   * verify(entries, expected) -> Promise<{ ok, checked, brokenAt, reason, entry }>
   *
   * Walks from the genesis link forward and stops at the FIRST break, naming
   * the entry. Four distinct failure modes, each reported separately, because
   * "the chain is broken" is not an actionable report:
   *   link      prevHash does not match the previous entry's hash
   *             (an entry was deleted, inserted or reordered)
   *   hash      the entry's own hash does not match its contents
   *             (an entry was edited in place)
   *   sequence  seq is not contiguous
   *   truncated the chain is internally perfect but SHORTER than the length
   *             committed to outside it, or ends on a different head
   *
   * TRUNCATION IS THE CHEAP ATTACK, and until this argument existed the chain
   * could not see it at all. Editing entry 7 invalidates 7..n and requires
   * recomputing all of them; deleting the last three rows requires nothing —
   * the walk simply runs out of rows early and reports a perfect chain over
   * what is left. "Delete the rows that record what I just did" is also the
   * likeliest real tampering, far likelier than a wholesale rewrite.
   *
   * `expected` is the commitment held OUTSIDE the chain — { count, head } in
   * the `meta` store, rewritten on every save. It is not an external anchor:
   * whoever can delete audit rows can edit meta too. What it buys is that
   * truncation now costs the same as editing — you must forge the commitment
   * as well — instead of costing nothing.
   */
  function verify(entries, expected) {
    var list = entries || [];
    var i = 0;
    var expectedPrev = GENESIS;
    var expectedSeq = 1;

    function finish() {
      var head = list.length ? list[list.length - 1].hash : GENESIS;
      if (expected && expected.count != null && list.length !== expected.count) {
        var missing = expected.count - list.length;
        return {
          ok: false, checked: list.length, brokenAt: list.length, kind: 'truncated',
          entry: list.length ? list[list.length - 1] : null, head: head,
          reason: missing > 0
            ? 'Rantai terpotong: seharusnya ada ' + expected.count + ' entri yang berakhir pada hash ' +
              short(expected.head) + ', yang ditemukan hanya ' + list.length + ' (' + missing +
              ' entri terakhir hilang). Setiap entri yang tersisa sah — justru itu masalahnya: menghapus ekor rantai tidak memerlukan perhitungan ulang apa pun, jadi tanpa komitmen panjang di luar rantai penghapusan ini tidak terlihat.'
            : 'Rantai lebih panjang daripada komitmen tersimpan: tercatat ' + expected.count +
              ' entri, ditemukan ' + list.length + '. Ada entri yang ditambahkan tanpa melalui aplikasi, atau basis data ini ditulis oleh lebih dari satu tab.'
        };
      }
      if (expected && expected.head && head !== expected.head) {
        return {
          ok: false, checked: list.length, brokenAt: list.length, kind: 'truncated',
          entry: list.length ? list[list.length - 1] : null, head: head,
          reason: 'Hash kepala tidak cocok dengan komitmen tersimpan: tercatat ' + short(expected.head) +
            ', dihitung ' + short(head) + '. Isi rantai konsisten dengan dirinya sendiri tetapi bukan rantai yang terakhir disimpan.'
        };
      }
      return { ok: true, checked: list.length, brokenAt: -1, reason: null, entry: null, head: head };
    }

    function step() {
      if (i >= list.length) {
        return Promise.resolve(finish());
      }
      var e = list[i];

      if (e.seq !== expectedSeq) {
        return Promise.resolve({
          ok: false, checked: i, brokenAt: i, kind: 'sequence', entry: e,
          reason: 'Nomor urut tidak berurutan pada posisi ' + i + ': diharapkan seq ' +
            expectedSeq + ', ditemukan seq ' + e.seq + '. Ada entri yang dihapus atau disisipkan.'
        });
      }
      if (e.prevHash !== expectedPrev) {
        return Promise.resolve({
          ok: false, checked: i, brokenAt: i, kind: 'link', entry: e,
          reason: 'Rantai putus pada entri #' + e.seq + ': prevHash ' + short(e.prevHash) +
            ' tidak cocok dengan hash entri sebelumnya ' + short(expectedPrev) + '.'
        });
      }
      return hashEntry(e).then(function (h) {
        if (h !== e.hash) {
          return {
            ok: false, checked: i, brokenAt: i, kind: 'hash', entry: e,
            reason: 'Isi entri #' + e.seq + ' telah diubah: hash tersimpan ' + short(e.hash) +
              ', hash hasil hitung ulang ' + short(h) + '.'
          };
        }
        expectedPrev = e.hash;
        expectedSeq = e.seq + 1;
        i++;
        return step();
      });
    }
    return step();
  }

  function short(h) { return h ? String(h).slice(0, 12) + '…' : '(kosong)'; }

  R.audit = {
    GENESIS: GENESIS,
    Chain: Chain,
    verify: verify,
    canonical: canonical,
    sha256Hex: sha256Hex,
    digestHex: digestHex,
    hashEntry: hashEntry,
    commitment: commitment,
    hashBackend: hashBackend,
    hasSubtle: function () { return !!subtle; },
    short: short
  };
})(typeof self !== 'undefined' ? self : this);
