/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — kode.js
 * The vocabulary every other engine file in this lab shares: refusal codes, the
 * two brands, integer money, the line diff, and the ordering counter.
 *
 * Four decisions in here are not stylistic and cost real work to hold.
 *
 * 1. A REFUSAL CARRIES ITS CODE IN .name, NEVER IN .message. Measured on this
 *    repository's own CI route: an Error handed back through the automation
 *    boundary arrives as {"name":"Error"} and the message is destroyed, while a
 *    DOMException arrives as {"name":"ConstraintError"} at any nesting depth. So
 *    a lab code living in a message is a lab code that cannot be asserted, and
 *    every negative in this suite would silently degrade to "something threw".
 *    refuse() therefore builds a DOMException-SHAPED carrier: .name is the code,
 *    .code is the same string again as a plain field for the same-realm reader,
 *    and the human sentence goes in .message where nothing depends on it.
 *
 * 2. THE CODE REGISTRY IS CLOSED. refuse() with a string nobody registered
 *    returns E_KODE_TIDAK_TERDAFTAR instead of inventing a code, because a
 *    typo'd code in a negative assertion is a negative that can never be
 *    satisfied and reads green in the count of negatives.
 *
 * 3. MONEY IS AN INTEGER OR IT IS A REFUSAL. There is no rounding helper in this
 *    file and there is no float anywhere in the lab's arithmetic. A lab whose
 *    subject is a lost update cannot afford a second reason for two numbers to
 *    disagree.
 *
 * 4. THE BRANDS ARE APPLIED BY THE ENGINE AND NEVER BY THE CALLER. seal() is the
 *    only constructor of a free-mode container, and it OVERWRITES whatever brand
 *    a caller set rather than trusting it. The suite's helpers refuse any operand
 *    that is branded, so a future contributor cannot pin a race outcome — the
 *    attempt goes red on the first run with a message that says why. Lifted from
 *    the timing tripwire in labs/sahih/tests.js and widened from one brand to two.
 *
 * DOM-free, storage-free, clock-free, and safe to require() under node.
 */
(function (root) {
  'use strict';

  var NS = {};

  /* ------------------------------------------------------------- refusals */

  /* Every code this lab may raise. The list is the contract: a negative
     assertion pins one of these strings or a stable DOMException name, never
     Chromium's message text — the TransactionInactiveError message is 74
     characters of prose that belongs to the browser and not to this repository. */
  var CODES = [
    'E_MODE',
    'E_CAS_CAP',
    'E_CAS_NO_CAP',
    'E_URUT_JAM',
    'E_JURNAL_GANDA',
    'E_HADANG_MATI',
    'E_DB_BLOCKED',
    'E_DB_TIADA',
    'E_BUKAN_BULAT',
    'E_KUNCI_BENTUK',
    'E_KUNCI_TANPA_BATAS',
    'E_KUNCI_TIADA',
    'E_SEWA_KEDALUWARSA',
    'E_SAKSI_THENABLE',
    'E_SAKSI_UKUR',
    'E_SAKSI_PEGANGAN',
    'E_SAKSI_GETTER',
    'E_SAKSI_PECAHAN',
    'E_SAKSI_KOSONG',
    'E_KODE_TIDAK_TERDAFTAR'
  ];

  NS.CODES = CODES;

  NS.terdaftar = function (code) {
    return typeof code === 'string' && CODES.indexOf(code) >= 0;
  };

  /* The carrier. It is a real Error so that a throw from any depth still yields a
     stack in devtools, but its identity for every assertion in this lab is .name. */
  function refuse(code, msg) {
    var used = NS.terdaftar(code) ? code : 'E_KODE_TIDAK_TERDAFTAR';
    var e = new Error(String(msg || used));
    e.name = used;
    e.code = used;
    e.tolak = true;
    if (used !== code) e.asked = String(code);
    return e;
  }
  NS.refuse = refuse;

  /* Both readers are total: they never throw, whatever they are handed, because
     they run inside catch blocks and inside a worker's unhandledrejection
     listener where a second throw is a page error nobody can attribute. */
  NS.nameOf = function (e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    try { return typeof e.name === 'string' ? e.name : ''; } catch (x) { return ''; }
  };

  NS.codeOf = function (e) {
    if (!e) return '';
    try {
      if (typeof e.code === 'string') return e.code;
    } catch (x) { return ''; }
    return NS.nameOf(e);
  };

  /* Sanitiser for anything about to cross postMessage or the automation
     boundary. A DOMException survives that trip; an Error loses its message; a
     function disappears key and all. So nothing crosses as an object with
     behaviour — it crosses as two strings, rebuilt here. */
  NS.wire = function (e) {
    return { name: String(NS.nameOf(e)), code: String(NS.codeOf(e)) };
  };

  /* ---------------------------------------------------------- the brands */

  NS.LOMBA = '__lomba__';
  NS.WAKTU = '__waktu__';

  /* seal() is the ONLY constructor of a free-mode result. A caller-set brand is
     overwritten, which is itself a property in G0. */
  NS.seal = function (mode, out) {
    if (mode === 'lepas') out[NS.LOMBA] = true; else delete out[NS.LOMBA];
    return out;
  };

  /* A timing reading is branded the same way and refused by the same tripwire,
     which is why there is one predicate and not two. */
  NS.stamp = function (out) { out[NS.WAKTU] = true; return out; };

  NS.branded = function (v) {
    return !!(v && typeof v === 'object' && (v[NS.LOMBA] === true || v[NS.WAKTU] === true));
  };

  /* ------------------------------------------------------------- integers */

  function bulat(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }
  NS.bulat = bulat;

  /* NaN and Infinity are rejected here as well as in the suite's own walker,
     because a corrupted total arriving as null downstream is indistinguishable
     from a legitimate zero and reads as a pass. */
  NS.rupiah = function (v, what) {
    if (!bulat(v)) throw refuse('E_BUKAN_BULAT', (what || 'value') + ' is not an integer');
    return v;
  };

  /* Order-independent integer fold. Handed to nothing that also owns an adder:
     the witness file writes its own, on purpose, and never calls this one. */
  NS.jumlah = function (list, what) {
    var t = 0, i;
    if (!list || Object.prototype.toString.call(list) !== '[object Array]') {
      throw refuse('E_BUKAN_BULAT', (what || 'list') + ' is not an array');
    }
    for (i = 0; i < list.length; i++) {
      if (!bulat(list[i])) throw refuse('E_BUKAN_BULAT', (what || 'list') + '[' + i + '] is not an integer');
      t = t + list[i];
    }
    return t;
  };

  /* ------------------------------------------------------- the numbers */

  /* Every figure the suite drives, in ONE object, because a number that lives in
     two files drifts in one of them. The engines still carry their own literal
     defaults and the suite asserts the two agree — a number is the cheapest thing
     in this lab to give a second route, so it gets one. */
  NS.ANGKA = {
    barrierW: [2, 4],            /* clamp(hardwareConcurrency, 2, 8) picks between */
    barrierN: { '2': 20, '4': 15 },
    clampMin: 2,
    clampMax: 8,
    freeN: 20,
    freeBatch: 3,
    utasW: [2, 3, 4, 5, 10],
    utasN: [1, 10, 25],
    casCap: 1000,
    lockDeadline: 2000,          /* AbortSignal.timeout on every lock request */
    barrierPhase: 5000,          /* then E_HADANG_MATI, and the waiter is released */
    deleteBudget: 3000,          /* then E_DB_BLOCKED */
    watchdog: 90000             /* forty times the measured 8x cost of the whole run */
  };

  /* ------------------------------------------------- the ordering counter */

  /* Every ordering claim in this lab runs on integers issued here. The refusal
     exists because the obvious shortcut — hand in a clock reading as the sort key
     — is wrong in two ways at once: two events inside one turn share a
     millisecond, and a worker's performance.now() has a different time origin
     from the page's, measured 49 ms apart in one run. The boundary below is
     generous by eight orders of magnitude: an epoch-millisecond reading is about
     1.7e12 and the largest honest sequence number this lab issues is a few
     thousand. A float is refused outright, since performance.now() is one. */
  NS.kunciUrut = function (k) {
    if (Object.prototype.toString.call(k) === '[object Date]') {
      throw refuse('E_URUT_JAM', 'a Date was handed in as an ordering key');
    }
    if (!bulat(k)) {
      throw refuse('E_URUT_JAM', 'an ordering key must be an integer this run issued');
    }
    if (k < 0) throw refuse('E_URUT_JAM', 'an ordering key must not be negative');
    if (k >= 1e11) throw refuse('E_URUT_JAM', 'an ordering key that large is a clock reading');
    return k;
  };

  NS.urut = function () {
    var s = 0;
    return {
      next: function () { s = s + 1; return NS.kunciUrut(s); },
      peek: function () { return s; }
    };
  };

  /* ------------------------------------------------------------ line diff */

  /* Route B for the page's "the three arms differ by one line" claim. The prose
     is route A. This walks the two shipped function bodies and returns the
     differing lines as data, so the assertion is over a structure and not over a
     sentence somebody hoped stayed true. */
  NS.lineDiff = function (a, b) {
    var la = String(a).split('\n');
    var lb = String(b).split('\n');
    var n = Math.max(la.length, lb.length);
    var out = [], i, x, y;
    for (i = 0; i < n; i++) {
      x = i < la.length ? la[i] : null;
      y = i < lb.length ? lb[i] : null;
      if (x !== y) out.push({ i: i, a: x === null ? '' : x, b: y === null ? '' : y });
    }
    return out;
  };

  /* Whitespace-insensitive variant. The arms are indented differently inside
     their own if-blocks, and a diff that reported indentation would make the
     one-line claim look like a twelve-line claim. */
  NS.lineDiffTrim = function (a, b) {
    function norm(s) {
      var l = String(s).split('\n'), o = [], i, t;
      for (i = 0; i < l.length; i++) { t = l[i].replace(/^\s+|\s+$/g, ''); if (t) o.push(t); }
      return o.join('\n');
    }
    return NS.lineDiff(norm(a), norm(b));
  };

  root.SEROBOT_KODE = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
