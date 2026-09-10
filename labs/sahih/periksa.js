/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — periksa.js
 * THE VERIFICATION FIREWALL. Route B, and the reason the Verify tab's "both
 * routes agree" is worth reading rather than worth trusting.
 *
 * This portfolio has shipped a proof that could only pass three times, and when
 * eleven mutations were injected into the previous lab, seven checks stayed
 * green while their subject was corrupted. In a token lab that mistake is a
 * one-liner: verify a signature with the same live key object, through the same
 * helper, that produced it. That proof cannot fail, and from the outside it is
 * indistinguishable from a proof that passed.
 *
 * So the defence is structural, not careful. This file knows exactly one name
 * from the rest of the lab: its own. Take the lab's prefix, uppercase, grep this
 * file for it and unique the result — one line comes back, and a second line
 * means this file has been compromised. That is the whole test, and it is a test
 * a stranger can run without reading a word of this. It is also why not one
 * comment below spells a sibling out: a comment naming one would make the grep
 * print it, and a check you have to interpret is a check nobody runs.
 *
 * Holding that line costs about twenty lines of duplication, paid four times:
 *
 *   1. a table-driven base64url decoder, written from scratch here;
 *   2. the order of the P-256 curve as this file's own 32-byte literal;
 *   3. a byte-wise adder;
 *   4. a hex encoder.
 *
 * The two decoders, and the two copies of the order, are cross-checked against
 * RFC 7515 A.1's published segment and against the published order — never
 * against each other. General agreement between the two decoders would collapse
 * the firewall into one route wearing two names. It is also what makes
 * corrupting the order in the pure byte layer turn the s + s' = n panel RED:
 * this copy does not move with it, and neither does the RFC.
 *
 * INJECTED, NEVER REACHED FOR. crypto.subtle arrives as an argument. Tokens
 * arrive as opaque STRINGS which this file re-splits and re-decodes from raw
 * bytes. Keys arrive as JWK JSON TEXT which it re-parses and re-imports itself,
 * so no CryptoKey ever crosses the seam. Every "before" snapshot arrives as a
 * VALUE, never a getter and never a lazy closure: capturing "before" after the
 * fact is the second most popular way to build a proof that cannot fail.
 *
 * WHAT THIS FILE REFUSES TO CLAIM. Both routes bottom out in the same
 * crypto.subtle.verify. There is no second signature implementation in a
 * browser, this file is not one, and pretending otherwise would be the exact
 * vice the page attacks — so every verdict it returns carries the string
 * 'crypto.subtle.verify' in a sharedBottom field, for the page to print beside
 * the agreement rather than underneath it. The frozen RFC vectors are the only
 * genuinely external oracle in this lab. What the two routes really do not share
 * is decoding, parsing, key caching, claim extraction and arithmetic — which is
 * where all seven of the previous lab's silent passes lived.
 *
 * REFUSAL IS A FIRST-CLASS OUTCOME, NOT AN EXCEPTION PATH. Six inputs make this
 * file throw before it will build a verdict at all, and all six throw
 * SYNCHRONOUSLY, before any promise exists. That is not a style preference: a
 * rejected promise handed to a synchronous throws() helper is recorded as "did
 * not throw" and then dropped, and a dropped rejection is a pageerror, which
 * fails the whole lab with every assertion green.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------- refusals */

  function refuse(message) {
    var e = new Error('sahih: periksa refuses. ' + message);
    e.periksaRefusal = true;
    throw e;
  }

  /* A base64url refusal carries a machine-readable reason as well, because the
     verdict builder below has to turn it into a checklist row and reading the
     sentence back out of the message would be one more thing to get wrong. */
  function refuseB64(reason) {
    var e = new Error('sahih: periksa refuses. a segment is not base64url (' + reason + ')');
    e.periksaRefusal = true;
    e.b64Reason = reason;
    throw e;
  }

  function notThenable(v) {
    if (v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function') {
      refuse('a settled value was expected and a promise arrived');
    }
  }

  /* Any measurement produced anywhere in this lab wears a brand. This file will
     not take one as an argument at all: confirming a wall-clock figure is the
     one job it could appear to do honestly and could not actually do, because
     the second route would be measuring the same clock on the same thread. */
  function notTiming(v) {
    if (v && typeof v === 'object' && v.__waktu__ === true) {
      refuse('this file will not confirm a wall-clock measurement');
    }
  }

  /* A CryptoKey answers to type, algorithm and extractable, all three off its
     prototype, so the in operator is the test and hasOwnProperty is not. If one arrives here the
     firewall has already been breached: something handed route B an object route
     A was holding, and every figure downstream of it is one route printed twice. */
  function notLiveKey(v) {
    if (v && typeof v === 'object' && 'type' in v && 'algorithm' in v && 'extractable' in v) {
      refuse('that is a live key object, which means this file reached into the lab\'s key cache');
    }
  }

  function clean(v) { notThenable(v); notTiming(v); notLiveKey(v); return v; }

  function needToken(t) {
    clean(t);
    if (typeof t !== 'string') refuse('a token must arrive as a string');
    return t;
  }

  function needSubtle(s) {
    clean(s);
    if (!s || typeof s.importKey !== 'function' || typeof s.verify !== 'function') {
      refuse('crypto.subtle must arrive as an argument; this file never reaches for a global');
    }
    return s;
  }

  /* One message covers "not text", "not JSON", "not an object" and "no kty",
     because from here they are the same mistake: something that is not a key as
     this file defines a key. The private-component refusal is separate and fires
     BEFORE any import call, so it is this repository's decision rather than a
     report of what the platform happened to do with it. */
  function needPublicJwkText(text) {
    var jwk = null;
    clean(text);
    if (typeof text !== 'string') refuse('a key must arrive as JWK JSON text with a kty member');
    try { jwk = JSON.parse(text); } catch (e) { jwk = null; }
    if (!jwk || typeof jwk !== 'object' ||
      Object.prototype.toString.call(jwk) === '[object Array]' ||
      typeof jwk.kty !== 'string' || jwk.kty === '') {
      refuse('a key must arrive as JWK JSON text with a kty member');
    }
    if (Object.prototype.hasOwnProperty.call(jwk, 'd')) {
      refuse('a verification key must not carry a private component');
    }
    return jwk;
  }

  function needExpectation(x) {
    var k;
    clean(x);
    if (!x || typeof x !== 'object' || Object.prototype.toString.call(x) === '[object Array]') {
      refuse('an expectation must arrive as a plain object of values');
    }
    for (k in x) {
      if (Object.prototype.hasOwnProperty.call(x, k)) {
        notThenable(x[k]);
        notTiming(x[k]);
        notLiveKey(x[k]);
        /* The key has its own argument. Accepting one here too would give a
           caller a way to hand this file a key it did not parse itself. */
        if (k === 'jwk' && x[k] !== null && x[k] !== undefined) {
          refuse('the verification key arrives as JSON text in its own argument, not inside the expectation');
        }
      }
    }
    return x;
  }

  /* ------------------------------------------- own copy 1: the decoder */

  var B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  var UNMAP = (function () {
    var t = [], i;
    for (i = 0; i < 128; i++) t.push(-1);
    for (i = 0; i < B64U.length; i++) t[B64U.charCodeAt(i)] = i;
    return t;
  }());

  /* This decoder is deliberately NOT the strict one. It refuses a wrong
     alphabet, refuses whitespace and refuses an impossible length — and then
     drops the spare bits of a non-canonical tail exactly the way the platform's
     own decoder does, because the twin panel's whole claim is that two different
     strings decode to identical bytes. A decoder that refused the twin could not
     demonstrate that the twin exists. Canonicality is a separate question, asked
     one layer up by re-encoding, where it belongs: it is a property of the
     STRING, and this function's job is the bytes. */
  function decode(seg) {
    var out, i, c, v, acc = 0, bits = 0, n = 0;
    clean(seg);
    if (typeof seg !== 'string') refuse('a segment must arrive as a string');
    if (/\s/.test(seg)) refuseB64('whitespace inside a segment');
    if (seg.length % 4 === 1) refuseB64('impossible length');
    out = new Uint8Array(Math.floor(seg.length * 3 / 4));
    for (i = 0; i < seg.length; i++) {
      c = seg.charCodeAt(i);
      v = c < 128 ? UNMAP[c] : -1;
      if (v < 0) refuseB64('not base64url');
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 255; }
    }
    return out.subarray(0, n);
  }

  /* Not exported. It exists for one purpose — asking a segment whether it is the
     only spelling of its own bytes — and an exported encoder would be a second
     place for a token to be built. */
  function encode(bytes) {
    var out = '', i, n, rem;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64U.charAt((n >> 18) & 63) + B64U.charAt((n >> 12) & 63) +
        B64U.charAt((n >> 6) & 63) + B64U.charAt(n & 63);
    }
    rem = bytes.length - i;
    if (rem === 1) {
      n = bytes[i] << 16;
      out += B64U.charAt((n >> 18) & 63) + B64U.charAt((n >> 12) & 63);
    } else if (rem === 2) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64U.charAt((n >> 18) & 63) + B64U.charAt((n >> 12) & 63) + B64U.charAt((n >> 6) & 63);
    }
    return out;
  }

  /* ------------------------------------------- own copy 2: hex, and bytes */

  var HEXD = '0123456789abcdef';

  function toBytes(v, what) {
    var out, i, c;
    clean(v);
    if (typeof v === 'string') {
      if (v.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(v)) {
        refuse(what + ' takes bytes or an even-length hex string');
      }
      out = new Uint8Array(v.length / 2);
      for (i = 0; i < out.length; i++) out[i] = parseInt(v.substr(i * 2, 2), 16);
      return out;
    }
    if (!v || typeof v.length !== 'number') refuse(what + ' takes bytes or an even-length hex string');
    out = new Uint8Array(v.length);
    for (i = 0; i < v.length; i++) {
      c = v[i];
      if (typeof c !== 'number' || c < 0 || c > 255 || c !== Math.floor(c)) {
        refuse(what + ' was handed something that is not a byte');
      }
      out[i] = c;
    }
    return out;
  }

  function hexOf(v) {
    var b = toBytes(v, 'hexOf'), out = '', i;
    for (i = 0; i < b.length; i++) out += HEXD.charAt((b[i] >> 4) & 15) + HEXD.charAt(b[i] & 15);
    return out;
  }

  /* ------------------------------------------- own copy 3: the curve order */

  /* The order of the P-256 group, byte by byte, typed out here rather than
     derived from anything. SEC 2 §2.4.2, FIPS 186-4 D.1.2.3, RFC 5480. The
     malleation panel's claim is s + s' = n; if this array were computed from the
     same literal the other route uses, that claim would be one number compared
     with itself and the panel would stay green through a corrupted curve. */
  var N_BYTES = [
    0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84,
    0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51
  ];

  var P256_N_HEX = hexOf(N_BYTES);

  /* ------------------------------------------- own copy 4: the adder */

  /* Big-endian, right-aligned, and it hands back HEX rather than bytes. The
     shape is deliberately not the shape of the other adder: a caller cannot
     substitute one for the other by accident, and a hex string survives the
     crossing into a test result, where a typed array silently becomes an
     object with numeric keys and every assertion over it goes green. */
  function addBytes(a, b) {
    var x = toBytes(a, 'addBytes'), y = toBytes(b, 'addBytes');
    var w = Math.max(x.length, y.length), out = new Uint8Array(w), i, s, carry = 0;
    for (i = 1; i <= w; i++) {
      s = (i <= x.length ? x[x.length - i] : 0) + (i <= y.length ? y[y.length - i] : 0) + carry;
      out[w - i] = s & 255;
      carry = s > 255 ? 1 : 0;
    }
    return { hex: hexOf(out), carry: carry, width: w };
  }

  /* ------------------------------------------------------------- text */

  function utf8(bytes) {
    var out = '', i = 0, c, c2, c3, c4, cp;
    while (i < bytes.length) {
      c = bytes[i++];
      if (c < 0x80) { out += String.fromCharCode(c); }
      else if (c >= 0xc0 && c < 0xe0) {
        out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      } else if (c >= 0xe0 && c < 0xf0) {
        c2 = bytes[i++] & 63; c3 = bytes[i++] & 63;
        out += String.fromCharCode(((c & 15) << 12) | (c2 << 6) | c3);
      } else if (c >= 0xf0) {
        c2 = bytes[i++] & 63; c3 = bytes[i++] & 63; c4 = bytes[i++] & 63;
        cp = (((c & 7) << 18) | (c2 << 12) | (c3 << 6) | c4) - 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else { out += '�'; }
    }
    return out;
  }

  /* The signing input is the two segments and the dot BETWEEN THEM, as a string,
     never a re-serialisation of anything parsed out of them. Both segments have
     already been through the alphabet table, so anything outside ASCII here
     means a segment was rewritten after it was decoded. */
  function ascii(s) {
    var out = new Uint8Array(s.length), i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c > 127) refuse('a signing input must be ASCII; this one is not, so a segment was rewritten');
      out[i] = c;
    }
    return out;
  }

  function jsonObject(bytes) {
    var v = null;
    try { v = JSON.parse(utf8(bytes)); } catch (e) { return null; }
    if (!v || typeof v !== 'object' || Object.prototype.toString.call(v) === '[object Array]') return null;
    return v;
  }

  /* ------------------------------------------------------- the algorithms */

  /* The endpoint names the algorithm. This table is indexed by what the CALLER
     pinned, never by anything read out of a token — which is why the confusion
     rung has no mechanism on this route at all, and why saying so is worth more
     than demonstrating it here. */
  var ALGS = {
    HS256: { kty: 'oct', raw: true, imp: { name: 'HMAC', hash: { name: 'SHA-256' } }, op: { name: 'HMAC' } },
    RS256: { kty: 'RSA', raw: false, imp: { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, op: { name: 'RSASSA-PKCS1-v1_5' } },
    PS256: { kty: 'RSA', raw: false, imp: { name: 'RSA-PSS', hash: { name: 'SHA-256' } }, op: { name: 'RSA-PSS', saltLength: 32 } },
    ES256: { kty: 'EC', raw: false, imp: { name: 'ECDSA', namedCurve: 'P-256' }, op: { name: 'ECDSA', hash: { name: 'SHA-256' } } },
    EdDSA: { kty: 'OKP', raw: false, imp: { name: 'Ed25519' }, op: { name: 'Ed25519' } }
  };

  /* ------------------------------------------------------- the checklist */

  /* Fifteen rows, not sixteen. The row the other route spends on refusing a
     private JWK is missing here on purpose: this file refuses that input before
     it will build a verdict at all, so a row for it could only ever be green.
     A check that cannot go red is the thing this file exists to prevent, and
     leaving a permanently-green row in the list to make two lengths match would
     be the cosmetic version of exactly that. */
  var CHECKS = [
    { name: 'three segments', code: 'E_SEGMENTS' },
    { name: 'segments are strict base64url', code: 'E_B64' },
    { name: 'header parses as a JSON object', code: 'E_JSON' },
    { name: 'header.typ', code: 'E_TYP' },
    { name: 'header.alg equals the pinned algorithm', code: 'E_ALG' },
    { name: 'header supplies no key material', code: 'E_HDR_KEY' },
    { name: 'header.kid resolves in the fixed keyring', code: 'E_KID' },
    { name: 'signature verifies', code: 'E_SIG' },
    { name: 'exp is present', code: 'E_EXP_MISSING' },
    { name: 'exp is in the future', code: 'E_EXPIRED' },
    { name: 'the lifetime is bounded', code: 'E_LIFETIME' },
    { name: 'nbf', code: 'E_NBF' },
    { name: 'iss', code: 'E_ISS' },
    { name: 'aud', code: 'E_AUD' },
    { name: 'jti', code: 'E_REVOKED' }
  ];

  var KEY_MEMBERS = ['jwk', 'jku', 'x5u', 'x5c'];

  function blankRows() {
    var rows = [], i;
    for (i = 0; i < CHECKS.length; i++) {
      rows.push({
        name: CHECKS[i].name, code: null, ok: null, reached: false,
        saw: 'not reached', skipped: false
      });
    }
    return rows;
  }

  function pass(out, i, saw) {
    out.checks[i].ok = true; out.checks[i].reached = true; out.checks[i].saw = String(saw);
    return true;
  }

  /* Skipped, never omitted. A checklist whose length moves with its
     configuration cannot be the thing a heading counts. */
  function skip(out, i, saw) {
    out.checks[i].ok = true; out.checks[i].reached = true;
    out.checks[i].skipped = true; out.checks[i].saw = String(saw);
    return true;
  }

  function fail(out, i, message, saw) {
    var code = CHECKS[i].code;
    out.checks[i].ok = false; out.checks[i].reached = true;
    out.checks[i].code = code; out.checks[i].saw = String(saw);
    out.ok = false; out.code = code; out.reason = code + ': ' + message;
    out.failedAt = i + 1;
    return out;
  }

  function settle(out) {
    if (out.code === null) { out.ok = true; out.failedAt = 0; }
    return out;
  }

  function audText(a) {
    if (Object.prototype.toString.call(a) === '[object Array]') return a.join(',');
    return String(a);
  }

  function audHas(a, want) {
    var i;
    if (Object.prototype.toString.call(a) === '[object Array]') {
      for (i = 0; i < a.length; i++) if (a[i] === want) return true;
      return false;
    }
    return a === want;
  }

  function inList(list, want) {
    var i;
    if (!list || typeof list.length !== 'number') return false;
    for (i = 0; i < list.length; i++) if (list[i] === want) return true;
    return false;
  }

  /* ------------------------------------------------------------- check */

  /* check(subtle, token, jwkText, expect) -> Promise of a verdict.
   *
   * Everything that can be decided about the SHAPE of the call is decided
   * synchronously, above the first Promise, and refused by throwing. Everything
   * that can be decided about the CONTENT of the token is a verdict, never a
   * throw. The line between those two is the whole API: a caller misusing this
   * file gets an exception it cannot mistake for a result, and a bad token gets
   * a result it cannot mistake for an exception. */
  function check(subtle, token, jwkText, expect) {
    var jwk, x, d, out, parts, i, dec = [], hdr, payload, claimsOn, now, skew, sigMsg;

    needSubtle(subtle);
    needToken(token);
    jwk = needPublicJwkText(jwkText);
    x = needExpectation(expect);
    d = ALGS[x.alg];
    if (!d) refuse('this route does not verify alg="' + String(x.alg) + '"');

    out = {
      ok: false, code: null, reason: null, failedAt: 0, checks: blankRows(),
      header: null, claims: null, route: 'B', errName: null,
      sharedBottom: 'crypto.subtle.verify'
    };

    claimsOn = x.claims !== false;
    now = (typeof x.now === 'number') ? x.now : null;
    skew = (typeof x.skewSec === 'number') ? x.skewSec : 0;

    /* 1 — three segments. An empty signature segment passes here and is refused
       four rows down at the algorithm: a checklist that blamed an unsecured
       token's SHAPE would be pointing at the wrong thing on the one card where
       the algorithm is the whole story. Empty segment 0 or 1 is still a shape
       problem and is still refused here. */
    parts = token.split('.');
    if (parts.length !== 3 || parts[0] === '' || parts[1] === '') {
      return Promise.resolve(fail(out, 0,
        'a compact JWS has three segments; this one has ' + parts.length,
        parts.length + ' segments, lengths ' + parts.join('.').length));
    }
    pass(out, 0, 'segment lengths ' + parts[0].length + '/' + parts[1].length + '/' + parts[2].length);

    /* 2 — the alphabet, the length, and then canonicality by re-encoding. The
       re-encode is the half that catches the twin, and it is asked here rather
       than inside the decoder because it is a question about the string. */
    for (i = 0; i < 3; i++) {
      try {
        dec[i] = decode(parts[i]);
      } catch (e) {
        if (!e.b64Reason) throw e;
        return Promise.resolve(fail(out, 1,
          'segment ' + i + ' is not strict base64url (' + e.b64Reason + ')',
          'segment ' + i + ': ' + e.b64Reason));
      }
      if (encode(dec[i]) !== parts[i]) {
        return Promise.resolve(fail(out, 1,
          'segment ' + i + ' is not canonical base64url (it re-encodes to a different string)',
          'segment ' + i + ' re-encodes to ' + encode(dec[i])));
      }
    }
    pass(out, 1, 'all three segments re-encode to themselves');

    /* 3 — both JSON objects, parsed from bytes this file decoded itself. */
    hdr = jsonObject(dec[0]);
    if (!hdr) return Promise.resolve(fail(out, 2, 'the header did not parse as a JSON object', 'segment 0'));
    payload = jsonObject(dec[1]);
    if (!payload) return Promise.resolve(fail(out, 2, 'the payload did not parse as a JSON object', 'segment 1'));
    out.header = hdr;
    out.claims = payload;
    pass(out, 2, 'header keys: ' + keysOf(hdr).join(','));

    /* 4 */
    if (hdr.typ !== 'JWT') {
      return Promise.resolve(fail(out, 3,
        'header typ=' + js(hdr.typ) + ', this endpoint accepts only "JWT"', js(hdr.typ)));
    }
    pass(out, 3, 'JWT');

    /* 5 — a plain string compare against what the CALLER pinned. Nothing below
       this line consults the token about which algorithm to use, and the row
       below it printing "not reached" is how the page proves that. */
    if (hdr.alg !== x.alg) {
      return Promise.resolve(fail(out, 4,
        'token declares alg=' + js(hdr.alg) + ', this endpoint accepts only ' + x.alg, js(hdr.alg)));
    }
    pass(out, 4, x.alg);

    /* 6 */
    for (i = 0; i < KEY_MEMBERS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(hdr, KEY_MEMBERS[i])) {
        return Promise.resolve(fail(out, 5,
          'the header carries a "' + KEY_MEMBERS[i] + '" member; this endpoint takes its key from its own ' +
          'configuration and never from the token', KEY_MEMBERS[i] + ' present'));
      }
    }
    pass(out, 5, 'none of ' + KEY_MEMBERS.join('/'));

    /* 7 — an unknown kid refuses. It never falls back to a default, because a
       fallback makes the kid decorative and every unknown key a valid one. */
    if (x.kid === null || x.kid === undefined) {
      skip(out, 6, 'no kid pinned');
    } else if (hdr.kid !== x.kid) {
      return Promise.resolve(fail(out, 6,
        'kid=' + js(hdr.kid) + ' is not the key this endpoint verifies with (' + x.kid + ')', js(hdr.kid)));
    } else {
      pass(out, 6, x.kid);
    }

    sigMsg = ascii(parts[0] + '.' + parts[1]);

    /* 8 — the signature, under the key this file parsed and imported itself,
       out of JSON text, under the algorithm the caller named. */
    return Promise.resolve(subtle.importKey('jwk', jwk, d.imp, false, ['verify']))
      ['catch'](function (e) { return { periksaKeyFailed: true, err: e }; })
      .then(function (key) {
        if (key && key.periksaKeyFailed) {
          out.errName = key.err && key.err.name ? String(key.err.name) : 'Error';
          return fail(out, 7,
            'the verification key would not import under ' + x.alg,
            'importKey rejected: ' + out.errName);
        }
        return Promise.resolve(subtle.verify(d.op, key, dec[2], sigMsg))
          ['catch'](function (e) { return { periksaVerifyFailed: true, err: e }; })
          .then(function (v) {
            if (v && typeof v === 'object' && v.periksaVerifyFailed) {
              out.errName = v.err && v.err.name ? String(v.err.name) : 'Error';
              return fail(out, 7,
                'the signature does not verify under ' + x.alg + ' and the configured key',
                'verify rejected: ' + out.errName);
            }
            if (v !== true) {
              return fail(out, 7,
                'the signature does not verify under ' + x.alg + ' and the configured key', 'false');
            }
            pass(out, 7, 'true, ' + dec[2].length + ' signature bytes');
            return claimsOn ? claimRows(out, payload, x, now, skew) : skipClaims(out);
          });
      })
      ['catch'](function (e) {
        /* Nothing above should arrive here — both crypto calls are caught where
           they are made. If something does, it is recorded rather than dropped,
           because a dropped rejection is a pageerror and a pageerror fails the
           lab with every assertion still green. */
        out.errName = e && e.name ? String(e.name) : 'Error';
        if (out.code === null) {
          out.ok = false;
          out.code = 'E_SIG';
          out.reason = 'E_SIG: route B threw before it reached a verdict';
          out.failedAt = 8;
        }
        return out;
      });
  }

  function skipClaims(out) {
    var i;
    for (i = 8; i < CHECKS.length; i++) skip(out, i, 'claims not checked on this call');
    return settle(out);
  }

  /* Every claim row below is arithmetic over an INJECTED number. There is no
     clock in this file and there is no clock in this lab's verification path:
     "now" is a value the caller chose, which is what lets the Klaim tab put a
     slider on it and what lets this suite produce the same verdict in CI in a
     year's time. */
  function claimRows(out, p, x, now, skew) {
    var life;

    if (now === null) { skip(out, 8, 'no clock supplied'); skip(out, 9, 'no clock supplied'); }
    else if (typeof p.exp !== 'number') { return fail(out, 8, 'no exp claim', typeof p.exp); }
    else {
      pass(out, 8, String(p.exp));
      if (!(now < p.exp + skew)) {
        return fail(out, 9,
          'exp=' + p.exp + ', now=' + now + ', expired ' + (now - p.exp) + 's ago', String(p.exp));
      }
      pass(out, 9, 'exp-now=' + (p.exp - now) + 's');
    }

    if (typeof x.maxLifetimeSec !== 'number') { skip(out, 10, 'no maximum lifetime configured'); }
    else if (typeof p.iat !== 'number') {
      return fail(out, 10, 'no iat claim, so the lifetime this token claims is unbounded', typeof p.iat);
    } else {
      life = p.exp - p.iat;
      if (life > x.maxLifetimeSec) {
        return fail(out, 10,
          'exp-iat=' + life + 's exceeds the ' + x.maxLifetimeSec + 's maximum this endpoint issues',
          life + 's');
      }
      pass(out, 10, life + 's');
    }

    if (typeof p.nbf !== 'number') { skip(out, 11, 'no nbf claim'); }
    else if (now === null) { skip(out, 11, 'no clock supplied'); }
    else if (now < p.nbf - skew) {
      return fail(out, 11, 'not valid for another ' + (p.nbf - now) + 's', String(p.nbf));
    } else { pass(out, 11, String(p.nbf)); }

    if (x.iss === null || x.iss === undefined) { skip(out, 12, 'no issuer pinned'); }
    else if (p.iss !== x.iss) {
      return fail(out, 12, 'iss=' + js(p.iss) + ', expected ' + js(x.iss), js(p.iss));
    } else { pass(out, 12, x.iss); }

    if (x.aud === null || x.aud === undefined) { skip(out, 13, 'no audience pinned'); }
    else if (!audHas(p.aud, x.aud)) {
      return fail(out, 13, 'aud=' + js(audText(p.aud)) + ', expected ' + js(x.aud), js(audText(p.aud)));
    } else { pass(out, 13, audText(p.aud)); }

    /* Keyed on jti, and the malleation panel is the reason. A denylist keyed on
       the token string misses a token whose signature was rewritten and whose
       payload is byte-identical — same claims, same subject, different string. */
    if (!x.denylist || typeof x.denylist.length !== 'number' || x.denylist.length === 0) {
      skip(out, 14, 'no denylist configured');
    } else if (typeof p.jti !== 'string') {
      return fail(out, 14, 'no jti claim, so this token cannot be revoked individually', typeof p.jti);
    } else if (inList(x.denylist, p.jti)) {
      return fail(out, 14, 'jti=' + js(p.jti) + ' is on the denylist', js(p.jti));
    } else { pass(out, 14, p.jti); }

    return settle(out);
  }

  /* ------------------------------------------------------------- checkAs */

  /* checkAs(subtle, alg, keyMaterial, token) -> Promise of a verdict.
   *
   * Route B's answer to "is this forgery accepted", recomputed from the
   * attacker's own bytes rather than read back off the verifier that was fooled.
   * It asks one question — does the signature on this string verify under these
   * bytes, read as this algorithm — and it asks it with the algorithm as an
   * ARGUMENT. That is the shape the whole lab is arguing for, and it is why the
   * confusion attack has no purchase here: there is no polymorphic key parameter
   * for a token to steer.
   *
   * It refuses alg "none" outright. An unsecured token has nothing to verify,
   * and returning a cheerful ok:false for it would file "there was no signature"
   * under the same heading as "the signature was wrong", which are the two
   * facts the first rung of the ladder exists to keep apart. */
  function checkAs(subtle, alg, keyMaterial, token) {
    var d, parts, sig, msg, out, importing;

    needSubtle(subtle);
    clean(alg);
    if (typeof alg !== 'string') refuse('an algorithm must arrive as a string this endpoint chose');
    if (alg.toLowerCase() === 'none') {
      refuse('an unsecured token has nothing to verify; name the algorithm this endpoint accepts');
    }
    d = ALGS[alg];
    if (!d) refuse('this route does not verify alg="' + alg + '"');
    clean(keyMaterial);
    needToken(token);

    out = {
      ok: false, why: null, alg: alg, keySource: d.raw ? 'raw bytes' : 'JWK JSON text',
      keyBytes: null, sigBytes: null, errName: null, route: 'B',
      sharedBottom: 'crypto.subtle.verify'
    };

    parts = token.split('.');
    if (parts.length !== 3 || parts[0] === '' || parts[1] === '') {
      out.why = 'segments';
      return Promise.resolve(out);
    }
    try {
      sig = decode(parts[2]);
    } catch (e) {
      if (!e.b64Reason) throw e;
      out.why = 'segments';
      out.errName = 'E_B64';
      return Promise.resolve(out);
    }
    out.sigBytes = sig.length;
    msg = ascii(parts[0] + '.' + parts[1]);

    if (d.raw) {
      /* Any byte string imports as a raw MAC key. That is not a refusal to
         demonstrate — it is the mechanism the confusion rung depends on, and
         this route reproduces it from the attacker's bytes so the naive
         verifier's acceptance is confirmed by something that never called it. */
      importing = toBytes(keyMaterial, 'checkAs');
      out.keyBytes = importing.length;
      importing = Promise.resolve(subtle.importKey('raw', importing, d.imp, false, ['verify']));
    } else {
      importing = needPublicJwkText(keyMaterial);
      out.keyBytes = null;
      importing = Promise.resolve(subtle.importKey('jwk', importing, d.imp, false, ['verify']));
    }

    return importing['catch'](function (e) { return { periksaKeyFailed: true, err: e }; })
      .then(function (key) {
        if (key && key.periksaKeyFailed) {
          out.why = 'key';
          out.errName = key.err && key.err.name ? String(key.err.name) : 'Error';
          return out;
        }
        return Promise.resolve(subtle.verify(d.op, key, sig, msg))
          ['catch'](function (e) { return { periksaVerifyFailed: true, err: e }; })
          .then(function (v) {
            if (v && typeof v === 'object' && v.periksaVerifyFailed) {
              out.why = 'signature';
              out.errName = v.err && v.err.name ? String(v.err.name) : 'Error';
              return out;
            }
            out.ok = v === true;
            out.why = out.ok ? 'the signature verifies under the bytes the caller supplied' : 'signature';
            return out;
          });
      })
      ['catch'](function (e) {
        out.why = 'key';
        out.errName = e && e.name ? String(e.name) : 'Error';
        return out;
      });
  }

  /* ------------------------------------------------------------- jtiOf */

  /* Re-extracted from the raw payload segment this file decoded itself, never
     read off a claims object somebody else parsed. The revocation panel's claim
     is that a jti-keyed denylist catches a malleated token that a token-keyed
     one misses; taking the jti from the verifier's own output would make that
     claim a statement about one parse repeated twice. */
  function jtiOf(token) {
    var parts, payload;
    needToken(token);
    parts = token.split('.');
    if (parts.length !== 3) refuse('a compact JWS has three segments; this one has ' + parts.length);
    payload = jsonObject(decode(parts[1]));
    if (!payload) refuse('the payload did not parse as a JSON object');
    return typeof payload.jti === 'string' ? payload.jti : null;
  }

  /* ------------------------------------------------------------- plumbing */

  function keysOf(o) {
    var out = [], k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out.push(k);
    return out;
  }

  /* Quoting for refusal text. JSON.stringify is the only thing here that can be
     handed a value it dislikes, so it is wrapped: a verdict must never fail to
     be produced because the reason it was refused could not be spelled. */
  function js(v) {
    var s;
    try { s = JSON.stringify(v); } catch (e) { s = null; }
    return s === undefined || s === null ? String(v) : s;
  }

  var NS = {
    check: check,
    checkAs: checkAs,
    decode: decode,
    addBytes: addBytes,
    hexOf: hexOf,
    jtiOf: jtiOf,
    refuse: refuse,
    P256_N_HEX: P256_N_HEX
  };

  root.SAHIH_PERIKSA = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_PERIKSA;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
