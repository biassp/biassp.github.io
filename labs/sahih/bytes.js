/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — bytes.js
 * The pure byte layer. No DOM, no storage, no crypto.subtle, no clock. Every
 * function here is total: same input, same output, on any machine, forever.
 *
 * Two decoders ship side by side and that is the point of the file. The loose
 * one is the three-line route every tutorial prints — atob with two character
 * substitutions — and it is kept because the page SHOWS it accepting inputs the
 * strict one refuses. Deleting it would turn every refusal below from a
 * decision this repository made into an unfalsifiable claim about a platform.
 *
 * Measured in this repository's own Chromium before any of this was written:
 * atob silently strips embedded \n, \r\n, \t and spaces; it happily eats the
 * standard-alphabet '+' and '/' that have no business inside a JWS segment; and
 * atob('QQ') === atob('QR') is TRUE, because the four low bits of the second
 * character never reach the output. That last one is the whole exposure. It is
 * not forgery — JWS signs the encoded STRING, so a MAC over the twin fails, and
 * correctly. It is that a jti store, a replay cache, an idempotency key or a log
 * line keyed on the DECODED payload disagrees with the MAC about how many
 * distinct tokens exist.
 *
 * The strict decoder is stricter than the ecosystem. Real JWT libraries accept
 * non-canonical tails. That is a decision made in this repository, and
 * interoperability is what it costs; the card on the page says so out loud
 * rather than presenting the strictness as a discovered law.
 *
 * P256_N and the byte arithmetic below are here for the malleation card. They
 * are duplicated, deliberately and with a copy that does not move with this
 * one, in the verification firewall — so corrupting one byte of the order in
 * this file turns the s + s' = n check RED instead of moving both sides of the
 * comparison together. A check computed once by one route is a decoration.
 */
(function (root) {
  'use strict';

  var NS = {};

  var B64U_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /* Reverse table built once. Index by charCode; -1 means "not in the alphabet".
     A table rather than indexOf so that the refusal is a lookup and not a scan,
     and so that every code point above 127 is refused by construction rather
     than by a range test somebody has to keep correct. */
  var B64U_REVERSE = (function () {
    var t = [], i;
    for (i = 0; i < 128; i++) t[i] = -1;
    for (i = 0; i < B64U_ALPHABET.length; i++) t[B64U_ALPHABET.charCodeAt(i)] = i;
    return t;
  }());

  /* The four reasons the strict decoder refuses, as this lab's own codes. The
     page and the suite pin THESE, never a message the engine wrote: a browser
     release must not be able to turn a security suite red for a reason that has
     nothing to do with the code under test. */
  var B64_CHARSET = 'not base64url';
  var B64_WHITESPACE = 'whitespace inside a segment';
  var B64_LENGTH = 'impossible length';
  var B64_TAIL = 'non-canonical tail';

  var B64_CODE = {
    'not base64url': 'E_B64_CHARSET',
    'whitespace inside a segment': 'E_B64_WHITESPACE',
    'impossible length': 'E_B64_LENGTH',
    'non-canonical tail': 'E_B64_TAIL'
  };

  function refuse(reason, saw) {
    var e = new Error('sahih: b64u refuses. ' + reason);
    e.b64uRefusal = true;
    e.reason = reason;
    e.code = B64_CODE[reason];
    e.saw = saw === undefined ? '' : String(saw);
    throw e;
  }

  function toBytes(bytes) {
    /* Accepts a Uint8Array, an Array, or anything array-like with a length, so
       callers never have to convert before crossing into this file. */
    var out, i;
    if (bytes && typeof bytes.length === 'number') {
      out = new Uint8Array(bytes.length);
      for (i = 0; i < bytes.length; i++) out[i] = bytes[i] & 255;
      return out;
    }
    return new Uint8Array(0);
  }

  /* ------------------------------------------------------------ base64url */

  function b64uEncode(bytes) {
    var b = toBytes(bytes), out = '', i, n, c;
    for (i = 0; i + 2 < b.length; i += 3) {
      n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      out += B64U_ALPHABET.charAt((n >> 18) & 63) + B64U_ALPHABET.charAt((n >> 12) & 63) +
        B64U_ALPHABET.charAt((n >> 6) & 63) + B64U_ALPHABET.charAt(n & 63);
    }
    c = b.length - i;
    if (c === 1) {
      n = b[i] << 16;
      out += B64U_ALPHABET.charAt((n >> 18) & 63) + B64U_ALPHABET.charAt((n >> 12) & 63);
    } else if (c === 2) {
      n = (b[i] << 16) | (b[i + 1] << 8);
      out += B64U_ALPHABET.charAt((n >> 18) & 63) + B64U_ALPHABET.charAt((n >> 12) & 63) +
        B64U_ALPHABET.charAt((n >> 6) & 63);
    }
    /* No '=' is emitted, ever. RFC 7515 §2 defines a base64url segment as
       unpadded, so padding here is not a formatting preference — it is a
       different string, and the signature is over the string. */
    return out;
  }

  function b64uDecodeStrict(s) {
    var str, i, code, v, acc, bits, out, tailBits;
    if (typeof s !== 'string') refuse(B64_CHARSET, Object.prototype.toString.call(s));
    str = s;

    /* Whitespace first, so it gets its own reason rather than being swallowed
       by the charset rule. atob strips these silently; there is no reading of
       RFC 7515 under which a segment contains one. */
    for (i = 0; i < str.length; i++) {
      code = str.charCodeAt(i);
      if (code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12) {
        refuse(B64_WHITESPACE, 'index ' + i);
      }
    }

    for (i = 0; i < str.length; i++) {
      code = str.charCodeAt(i);
      if (code > 127 || B64U_REVERSE[code] === -1) refuse(B64_CHARSET, str.charAt(i));
    }

    /* Length 1 mod 4 carries six bits of a byte that will never arrive. atob
       refuses a lone 'A' and accepts other shapes of the same mistake; this
       refuses all of them by arithmetic. */
    if (str.length % 4 === 1) refuse(B64_LENGTH, 'length ' + str.length);

    acc = 0; bits = 0; out = [];
    for (i = 0; i < str.length; i++) {
      v = B64U_REVERSE[str.charCodeAt(i)];
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 255);
      }
    }

    /* The tail check, and the reason this file exists. Two, four or six bits
       are left over depending on the length; every one of them must be zero for
       the string to be the canonical encoding of the bytes it produced. The
       equivalent statement is the one asserted: re-encoding the output must
       reproduce the input exactly. Both are computed because the arithmetic
       says WHY and the round trip says WHETHER. */
    tailBits = acc & ((1 << bits) - 1);
    if (bits > 0 && tailBits !== 0) refuse(B64_TAIL, 'the last ' + bits + ' bits are not zero');
    if (b64uEncode(out) !== str) refuse(B64_TAIL, 'it re-encodes to a different string');

    return new Uint8Array(out);
  }

  /* The vulnerable route, kept so the page can show it accepting what the strict
     one refuses. It is the exact three lines a tutorial prints. Its failure mode
     is not that it throws — it is that it does not. */
  function b64uDecodeLoose(s) {
    var t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(t), out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }

  /* ------------------------------------------------------------------ utf8 */

  /* Hand-written rather than TextEncoder, because this is the file that claims
     to be the byte layer and a claim about bytes should not delegate the bytes.
     Lone surrogates are encoded as U+FFFD, which is what TextEncoder does and
     what the JSON on this page can never contain anyway. */
  function utf8Encode(str) {
    var s = String(str), out = [], i, c, c2;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; }
        else c = 0xfffd;
      } else if (c >= 0xd800 && c <= 0xdfff) {
        c = 0xfffd;
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    var b = toBytes(bytes), out = '', i = 0, c, n, need, cp;
    while (i < b.length) {
      c = b[i++];
      if (c < 0x80) { out += String.fromCharCode(c); continue; }
      if (c >= 0xc0 && c < 0xe0) { cp = c & 31; need = 1; }
      else if (c >= 0xe0 && c < 0xf0) { cp = c & 15; need = 2; }
      else if (c >= 0xf0 && c < 0xf8) { cp = c & 7; need = 3; }
      else { out += '�'; continue; }
      if (i + need > b.length) { out += '�'; break; }
      for (n = 0; n < need; n++) {
        if ((b[i] & 0xc0) !== 0x80) { cp = -1; break; }
        cp = (cp << 6) | (b[i++] & 63);
      }
      if (cp < 0) { out += '�'; continue; }
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------- hex */

  var HEX = '0123456789abcdef';

  function hex(bytes) {
    var b = toBytes(bytes), out = '', i;
    for (i = 0; i < b.length; i++) out += HEX.charAt(b[i] >> 4) + HEX.charAt(b[i] & 15);
    return out;
  }

  function unhex(str) {
    var s = String(str), out, i, v;
    if (s.length % 2 !== 0) throw new Error('sahih: unhex refuses. an odd number of hex digits');
    /* parseInt is not a validator: parseInt('fz', 16) is 15, not NaN, because it
       reads the leading digit and stops. A pair whose SECOND character is not
       hex would therefore have been accepted and silently truncated to its
       first nibble — the exact class of quiet corruption this lab exists to
       argue against. The characters are checked before any of them is parsed. */
    if (!/^[0-9a-fA-F]*$/.test(s)) {
      throw new Error('sahih: unhex refuses. a character that is not a hex digit');
    }
    out = new Uint8Array(s.length / 2);
    for (i = 0; i < out.length; i++) {
      v = parseInt(s.substr(i * 2, 2), 16);
      if (v !== v) throw new Error('sahih: unhex refuses. a character that is not a hex digit');
      out[i] = v;
    }
    return out;
  }

  /* -------------------------------------------------- fixed-width integers */

  /* The order of the P-256 group, published in FIPS 186-4 / SEC 2 and reprinted
     in every ECDSA reference. Frozen, because the malleation card's arithmetic
     is only interesting if this side of it cannot drift. */
  var P256_N_HEX = 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551';
  var P256_N = unhex(P256_N_HEX);
  /* Not Object.freeze'd, and not by oversight: freezing a Uint8Array that has
     elements throws TypeError ("Cannot freeze array buffer views with
     elements") — its indices cannot be made non-configurable. Confirmed in this
     repository's node and its Chromium before the line was left out. The hex
     string above IS frozen in the only sense a string can be, and the mutation
     gate corrupts a byte here on purpose to prove the firewall's own copy of
     the order does not move with it. */

  function cmpBytes(a, b) {
    var x = toBytes(a), y = toBytes(b), n = Math.max(x.length, y.length), i, xv, yv;
    for (i = 0; i < n; i++) {
      xv = i < n - x.length ? 0 : x[i - (n - x.length)];
      yv = i < n - y.length ? 0 : y[i - (n - y.length)];
      if (xv !== yv) return xv < yv ? -1 : 1;
    }
    return 0;
  }

  /* Big-endian, fixed width, borrow and carry reported rather than swallowed.
     A subtraction that silently wrapped would make n - s look right for an s
     larger than n, which is exactly the input a malleation panel must not lie
     about. */
  function subBytes(a, b) {
    var x = toBytes(a), y = toBytes(b), n = Math.max(x.length, y.length);
    var out = new Uint8Array(n), i, xi, yi, d, borrow = 0;
    for (i = n - 1; i >= 0; i--) {
      xi = i < n - x.length ? 0 : x[i - (n - x.length)];
      yi = i < n - y.length ? 0 : y[i - (n - y.length)];
      d = xi - yi - borrow;
      if (d < 0) { d += 256; borrow = 1; } else { borrow = 0; }
      out[i] = d;
    }
    return { bytes: out, borrow: borrow };
  }

  function addBytes(a, b) {
    var x = toBytes(a), y = toBytes(b), n = Math.max(x.length, y.length);
    var out = new Uint8Array(n), i, xi, yi, s, carry = 0;
    for (i = n - 1; i >= 0; i--) {
      xi = i < n - x.length ? 0 : x[i - (n - x.length)];
      yi = i < n - y.length ? 0 : y[i - (n - y.length)];
      s = xi + yi + carry;
      out[i] = s & 255;
      carry = s > 255 ? 1 : 0;
    }
    return { bytes: out, carry: carry };
  }

  /* ------------------------------------------------- ECDSA signature shapes */

  /* JWS carries an ECDSA signature as raw r||s, fixed width, no ASN.1 (RFC 7515
     §3.4). Nearly everything else on a server — OpenSSL, X.509, most language
     standard libraries — carries the DER SEQUENCE. The two conversions live
     here so the shape panel can show the same signature in both forms and so
     nobody is tempted to write a third conversion inline. */
  function rawToDer(sig) {
    var raw = toBytes(sig), half = raw.length / 2, i;
    if (raw.length === 0 || raw.length % 2 !== 0) {
      throw new Error('sahih: rawToDer refuses. a raw JWS signature is r||s of equal width');
    }
    var parts = [], body = [];
    for (i = 0; i < 2; i++) {
      var v = [], j, k = 0;
      for (j = i * half; j < (i + 1) * half; j++) v.push(raw[j]);
      while (k < v.length - 1 && v[k] === 0) k++;
      v = v.slice(k);
      /* DER INTEGER is signed: a leading byte >= 0x80 needs a zero in front or
         the value reads as negative. */
      if (v[0] & 0x80) v.unshift(0);
      parts.push(v);
    }
    body = [0x02, parts[0].length].concat(parts[0], [0x02, parts[1].length], parts[1]);
    return new Uint8Array([0x30, body.length].concat(body));
  }

  function derToRaw(sig, width) {
    var d = toBytes(sig), w = width || 32, i = 0, out = new Uint8Array(w * 2), k, len, v, j;
    if (d[i++] !== 0x30) throw new Error('sahih: derToRaw refuses. not a DER SEQUENCE');
    i++; /* short-form length only; a P-256 signature never reaches 128 bytes */
    for (k = 0; k < 2; k++) {
      if (d[i++] !== 0x02) throw new Error('sahih: derToRaw refuses. not a DER INTEGER');
      len = d[i++];
      v = [];
      for (j = 0; j < len; j++) v.push(d[i + j]);
      i += len;
      while (v.length > 1 && v[0] === 0) v.shift();
      if (v.length > w) throw new Error('sahih: derToRaw refuses. an integer wider than the curve');
      for (j = 0; j < v.length; j++) out[k * w + (w - v.length) + j] = v[j];
    }
    return out;
  }

  /* --------------------------------------------------------- TOTP counters */

  /* RFC 4226 §5.1: the HOTP counter is eight bytes, big-endian. The RFC 6238
     table does not pin that width — every published row has a counter below
     2^32, and an implementation that writes only the low four bytes reproduces
     all eighteen. beCounter4 IS that implementation, kept as a named negative
     control so the Vectors tab can show a table passing under a bug and then
     show the synthetic row above 2^32 that separates them. A control that has
     never been seen to disagree is not a control. */
  function beCounter8(n) {
    var out = new Uint8Array(8), hi = Math.floor(n / 4294967296), lo = n >>> 0, i;
    for (i = 3; i >= 0; i--) { out[i] = hi & 255; hi = Math.floor(hi / 256); }
    for (i = 7; i >= 4; i--) { out[i] = lo & 255; lo = Math.floor(lo / 256); }
    return out;
  }

  function beCounter4(n) {
    var out = new Uint8Array(8), lo = n >>> 0, i;
    for (i = 7; i >= 4; i--) { out[i] = lo & 255; lo = Math.floor(lo / 256); }
    return out;
  }

  /* ------------------------------------------------------------ truncation */

  /* RFC 4226 §5.3 dynamic truncation, and the modulo that turns 31 bits into a
     printable code. It lives in the byte layer because it is arithmetic over a
     MAC's output and nothing here needs a key. */
  function dynamicTruncate(macBytes) {
    var b = toBytes(macBytes), off = b[b.length - 1] & 15;
    return ((b[off] & 0x7f) << 24) | ((b[off + 1] & 255) << 16) |
      ((b[off + 2] & 255) << 8) | (b[off + 3] & 255);
  }

  function otpDigits(truncated, digits) {
    var mod = Math.pow(10, digits), s = String(truncated % mod);
    while (s.length < digits) s = '0' + s;
    return s;
  }

  /* --------------------------------------------------------------- exports */

  NS.b64uEncode = b64uEncode;
  NS.b64uDecodeStrict = b64uDecodeStrict;
  NS.b64uDecodeLoose = b64uDecodeLoose;
  NS.utf8Encode = utf8Encode;
  NS.utf8Decode = utf8Decode;
  NS.hex = hex;
  NS.unhex = unhex;
  NS.P256_N = P256_N;
  NS.P256_N_HEX = P256_N_HEX;
  NS.addBytes = addBytes;
  NS.subBytes = subBytes;
  NS.cmpBytes = cmpBytes;
  NS.rawToDer = rawToDer;
  NS.derToRaw = derToRaw;
  NS.beCounter8 = beCounter8;
  NS.beCounter4 = beCounter4;
  NS.dynamicTruncate = dynamicTruncate;
  NS.otpDigits = otpDigits;
  NS.B64_CHARSET = B64_CHARSET;
  NS.B64_WHITESPACE = B64_WHITESPACE;
  NS.B64_LENGTH = B64_LENGTH;
  NS.B64_TAIL = B64_TAIL;

  root.SAHIH_BYTES = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_BYTES;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
