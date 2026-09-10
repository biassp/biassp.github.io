/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — saksi.js
 * THE FIREWALL. Route B, and the reason the panels' "both routes agree" line is
 * worth reading rather than worth trusting.
 *
 * This repository has shipped a proof that could only pass five times. On a page
 * about lost updates the mistake wears its most natural costume yet, and it is a
 * one-liner:
 *
 *     lost = expected - final
 *
 * where `final` is the number the writers put in their own summary message and
 * `expected` is the product they computed on the way in. Both operands come from
 * the same sentence, so the difference can only ever be what the writers said it
 * was. It agrees with itself forever, and from the outside it is indistinguish-
 * able from a difference that was measured.
 *
 * So the defence here is structural, not careful. This file knows exactly one
 * name from the rest of the lab: its own. Take the lab's prefix, uppercase, grep
 * this file for it with -o and unique the result — one line comes back, and a
 * second line means this file has been compromised. The exact command ships in
 * the README and in the independence table; it is deliberately NOT written out
 * here, because the pattern is itself a match and a header that quoted it would
 * make its own check print two lines. That is the whole test, it takes three
 * seconds, and it needs none of this paragraph read first. It is also why not
 * one comment below spells a sibling out: a comment naming one would make the
 * grep print it, and a check you have to interpret is a check nobody runs.
 *
 * Holding that line costs about a hundred lines of deliberate duplication:
 *
 *   1. its own refusal codes, as string literals, with no registry consulted;
 *   2. its own walk over a row list, with an explicit index and a hole check,
 *      rather than map/reduce/forEach or any helper from anywhere else;
 *   3. its own integer adder, which accumulates the positive and the negative
 *      parts separately so its answer cannot depend on encounter order even in
 *      principle, cross-checked at load against two fixed vectors written into
 *      this file — never against the other adder. General agreement between the
 *      two would collapse the firewall into one route wearing two names;
 *   4. its own table of which store has which shape, which is where the worklist
 *      comes from.
 *
 * INJECTED, NEVER REACHED FOR. Rows arrive through a reader function handed in
 * as an argument. No database handle, no transaction, no lock, no worker and no
 * port ever crosses this seam — this file cannot open a transaction and cannot
 * ask the engine a question, so there is nothing here for a caller to steer.
 *
 * THE "BEFORE" SNAPSHOT IS A VALUE. Not a getter, not a lazy closure, not a
 * re-read. Capturing "before" after the fact is the second most popular way to
 * build a proof that cannot fail, and a getter is how it gets in.
 *
 * IT MULTIPLIES W BY n ITSELF. It takes two integers. There is no parameter
 * anywhere in this file that accepts a precomputed expectation, because the
 * moment there is one, the panel is comparing a number to itself again.
 *
 * IT PICKS ITS OWN WORKLIST. There is no `stores` argument. The list is the
 * intersection of this file's own shape table with the keys of the "before"
 * value, so the thing being verified does not get to choose what gets verified,
 * and a key in "before" that this file has no shape for is reported by name and
 * makes the verdict not-ok rather than being quietly skipped.
 *
 * WHAT IT REFUSES TO CLAIM. Both routes bottom out in the same IDBObjectStore
 * and the same scheduler. There is no second storage engine in a browser, this
 * file is not one, and the physical cursor belongs to the reader, not to this
 * file — what this file owns is the walk, the key extraction and the arithmetic.
 * Pretending otherwise would be the exact vice the page attacks, so every
 * verdict carries sharedBottom: 'IDBObjectStore' for the page to print BESIDE
 * the agreement and not underneath it. The honest size of the guarantee: the
 * route separation catches a mistake in this lab's arithmetic; it cannot catch a
 * lie told by the browser's own transaction manager.
 *
 * REFUSAL IS A FIRST-CLASS OUTCOME. Every refusal about an ARGUMENT is raised
 * SYNCHRONOUSLY, before any promise exists, in both entry points. That is not a
 * style preference: a rejected promise handed to a synchronous throws() helper
 * is recorded as "did not throw" and then dropped, and a dropped rejection is a
 * page error that fails the whole lab with every assertion green. A refusal
 * about the CONTENT of a row can only be raised once the row exists, so the
 * synchronous entry point takes materialised envelopes and throws, and the
 * promise entry point is a thin wrapper over it — the negatives are pinned
 * against the synchronous one.
 *
 * The division of labour between a throw and a not-ok verdict: a THROW means the
 * inputs were the wrong kind of thing and no witnessing happened. A not-ok
 * VERDICT means the witnessing happened and what it saw does not hold together.
 * Six codes exist and none is invented on the spot.
 *
 * DOM-free, storage-free, clock-free, and safe to require() under node.
 */
(function (root) {
  'use strict';

  var NS = {};

  /* ------------------------------------------------------------- refusals */

  /* The code lives in .name. Measured on this repository's own automation
     route: an Error handed back across it arrives as {"name":"Error"} with the
     message destroyed, so a code that lives in a message is a code no negative
     can pin, and every negative here would silently degrade to "something
     threw". The same string is repeated into .code for the same-realm reader. */
  var CODES = [
    'E_SAKSI_THENABLE',
    'E_SAKSI_UKUR',
    'E_SAKSI_PEGANGAN',
    'E_SAKSI_GETTER',
    'E_SAKSI_PECAHAN',
    'E_SAKSI_KOSONG'
  ];
  NS.CODES = CODES;

  function tolak(code, msg) {
    var e = new Error('serobot: saksi refuses. ' + String(msg));
    e.name = code;
    e.code = code;
    e.tolak = true;
    e.saksi = true;
    throw e;
  }
  NS.tolak = tolak;

  /* --------------------------------------------------- the argument gate */

  var AMAN = 9007199254740991;

  var POLOS = {
    '[object Object]': true,
    '[object Array]': true,
    '[object String]': true,
    '[object Number]': true,
    '[object Boolean]': true,
    '[object Null]': true,
    '[object Undefined]': true
  };

  function jenis(v) { return Object.prototype.toString.call(v); }

  /* A promise arriving where a settled value was expected is the shape of a
     caller that has not finished doing the thing it is asking to have witnessed.
     Checked first, and checked on functions too, because a function with a then
     is a thenable and would otherwise be read as a getter below. */
  function bukanThenable(v, what) {
    if (v && (typeof v === 'object' || typeof v === 'function')) {
      var t = null;
      try { t = v.then; } catch (e) { t = null; }
      if (typeof t === 'function') {
        tolak('E_SAKSI_THENABLE', what + ' arrived as a promise where a settled value was expected');
      }
    }
  }

  /* Anything produced by a free-running race, and anything read off a clock,
     wears a brand. This file will not take one as an operand at all: confirming
     a figure that moves is the one job it could appear to do honestly and could
     not actually do, because the second route would be watching the same race on
     the same thread. Inherited counts, so `in` is the test and hasOwnProperty is
     not — a brand hidden on a prototype is still a brand. */
  function bukanUkuran(v, what) {
    if (v && typeof v === 'object') {
      if (('__lomba__' in v) || ('__waktu__' in v)) {
        tolak('E_SAKSI_UKUR', what + ' carries a race or timing brand, and this file will not witness one');
      }
    }
  }

  /* A live handle is how the firewall gets breached: something hands route B an
     object route A is still holding, and every figure downstream of it is one
     route printed twice. The test is the tag, not a list of constructor names,
     so an IDB handle, a lock, a worker, a port, a DOMException, a Map, a Set, a
     RegExp, a Date and an ArrayBuffer are all refused by one rule and no future
     platform type gets in through a gap in an allow-list. */
  function bukanPegangan(v, what) {
    if (!POLOS[jenis(v)]) {
      tolak('E_SAKSI_PEGANGAN', what + ' is a ' + jenis(v) + ', and this file takes plain values only');
    }
  }

  function utuh(v, what) {
    if (typeof v !== 'number') {
      tolak('E_SAKSI_PECAHAN', what + ' is a ' + (typeof v) + ' where an integer was required');
    }
    /* NaN and Infinity are caught here rather than by a range test, because the
       automation boundary turns both into null and a null that reached a numeric
       field would otherwise be read as a legitimate zero. */
    if (!isFinite(v) || v !== Math.floor(v)) {
      tolak('E_SAKSI_PECAHAN', what + ' is not a whole number');
    }
    if (v > AMAN || v < -AMAN) {
      tolak('E_SAKSI_PECAHAN', what + ' is outside the range where integer arithmetic is exact');
    }
    return v;
  }
  NS.utuh = utuh;

  /* The recursive gate over a value that claims to be a snapshot. Depth is
     capped because a snapshot of integers is two levels deep and a cycle at any
     depth is not a snapshot at all. */
  function bersih(v, what, dalam) {
    var k, d;
    if (dalam > 6) {
      tolak('E_SAKSI_PEGANGAN', what + ' is nested deeper than a snapshot of integers can be');
    }
    bukanThenable(v, what);
    bukanUkuran(v, what);
    if (typeof v === 'function') {
      tolak('E_SAKSI_GETTER', what + ' is a function, and a snapshot that has to be called is not a snapshot');
    }
    bukanPegangan(v, what);
    if (jenis(v) === '[object Object]' || jenis(v) === '[object Array]') {
      for (k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) {
          /* An accessor is the lazy re-read wearing a plain-object costume: it
             looks like a value in every log and answers a different number every
             time it is asked. Refused by shape, before it is ever read. */
          d = null;
          try { d = Object.getOwnPropertyDescriptor(v, k); } catch (e) { d = null; }
          if (d && (typeof d.get === 'function' || typeof d.set === 'function')) {
            tolak('E_SAKSI_GETTER', what + '.' + k + ' is an accessor, so it is a re-read and not a value');
          }
          bersih(v[k], what + '.' + k, dalam + 1);
        }
      }
    }
    return v;
  }
  NS.bersih = function (v, what) { return bersih(v, String(what || 'the value'), 0); };

  /* ------------------------------------------- own copy 1: the walk */

  /* Hand-written, with an explicit index, and it refuses a hole. forEach and
     map both skip a hole in silence, and a fold that silently skips a row is
     precisely the failure this file exists to catch when it happens anywhere
     else. Nothing array-LIKE is accepted either: the tag is the test. */
  function imbas(rows, what, kunjung) {
    var i, n;
    if (jenis(rows) !== '[object Array]') {
      tolak('E_SAKSI_PEGANGAN', what + ' must arrive as a real array of rows');
    }
    n = rows.length;
    utuh(n, what + '.length');
    for (i = 0; i < n; i++) {
      if (!Object.prototype.hasOwnProperty.call(rows, i)) {
        tolak('E_SAKSI_KOSONG', what + ' has a hole at index ' + i + ', so a fold over it would skip a row in silence');
      }
      kunjung(rows[i], i);
    }
    return n;
  }
  NS.imbas = imbas;

  /* ------------------------------------------- own copy 2: the adder */

  /* Order-independent by construction rather than by argument. The positive and
     the negative parts are accumulated apart and combined once, so there is no
     ordering of the input that can produce a different answer, and the range
     check on each part catches an overflow before it becomes a wrong total
     rather than after.

     THE EMPTY FOLD IS A REFUSAL. Zero rows folding to zero is exactly what a
     reader that read nothing produces, and it is indistinguishable from a store
     that is genuinely empty. So the zero has to be asked for by name. */
  function tambah(list, nol) {
    var pos = 0, neg = 0, hasil;
    if (jenis(list) !== '[object Array]') {
      tolak('E_SAKSI_PEGANGAN', 'the fold takes a real array of integers');
    }
    if (list.length === 0) {
      if (arguments.length < 2 || nol !== 0) {
        tolak('E_SAKSI_KOSONG', 'an empty fold was asked for a total and no explicit zero was supplied');
      }
      return 0;
    }
    imbas(list, 'the fold input', function (v, i) {
      utuh(v, 'the value at index ' + i);
      if (v < 0) { neg = neg - v; } else { pos = pos + v; }
      if (pos > AMAN || neg > AMAN) {
        tolak('E_SAKSI_PECAHAN', 'the running total left the range where integer arithmetic is exact');
      }
    });
    hasil = pos - neg;
    utuh(hasil, 'the fold total');
    return hasil;
  }
  NS.tambah = tambah;

  /* The adder is checked at load against three fixed vectors written into this
     file, and never against the other adder in this lab: general agreement
     between two adders would collapse the firewall into one route wearing two
     names, while a vector is an oracle that does not move when either of them
     does. The second vector lands the positive accumulator exactly ON the
     exact-integer boundary, because that is where a hand-written accumulator
     goes wrong and stays plausible. Order independence is checked by folding the
     first vector four ways: as given, reversed, rotated and sorted. */
  var VEKTOR = [0, 1, -1, 7, 12, -3, 1000, -999, 5];
  var VEKTOR_JUMLAH = 22;
  var BATAS = [4503599627370495, 4503599627370496, -3];
  var BATAS_JUMLAH = 9007199254740988;
  /* The price of splitting the accumulation, stated as a vector rather than as a
     caveat: a list whose POSITIVE part alone leaves the exact range is refused
     even when its total would have been safe. The load check pins the refusal,
     so the trade is visible to anyone who reads the file and cannot be lost in a
     later edit. This vector totals 5 and is refused. */
  var TAKMUAT = [9007199254740991, 9007199254740991, -9007199254740991, -9007199254740986];

  function putar(list, k) {
    var out = [], i;
    for (i = 0; i < list.length; i++) out.push(list[(i + k) % list.length]);
    return out;
  }

  function balik(list) {
    var out = [], i;
    for (i = list.length - 1; i >= 0; i--) out.push(list[i]);
    return out;
  }

  function urutNaik(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) out.push(list[i]);
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  NS.SENDIRI = (function () {
    var out = {
      vektor: VEKTOR.length, harapan: VEKTOR_JUMLAH, batasHarapan: BATAS_JUMLAH,
      maju: 0, mundur: 0, geser: 0, urut: 0, batas: 0,
      adilOrder: false, jumlahOk: false, batasOk: false,
      kosongDitolak: false, takmuatDitolak: false, ok: false, alasan: []
    };
    function coba(nama, fn) {
      try { return fn(); } catch (e) {
        out.alasan.push(nama + ': ' + (e && e.name ? String(e.name) : 'threw'));
        return null;
      }
    }
    coba('fold', function () {
      out.maju = tambah(VEKTOR);
      out.mundur = tambah(balik(VEKTOR));
      out.geser = tambah(putar(VEKTOR, 4));
      out.urut = tambah(urutNaik(VEKTOR));
      out.adilOrder = out.maju === out.mundur && out.maju === out.geser && out.maju === out.urut;
      out.jumlahOk = out.maju === VEKTOR_JUMLAH;
      return null;
    });
    coba('boundary', function () {
      out.batas = tambah(BATAS);
      out.batasOk = out.batas === BATAS_JUMLAH;
      return null;
    });
    try { tambah([]); } catch (e1) { out.kosongDitolak = e1 && e1.name === 'E_SAKSI_KOSONG'; }
    try { tambah(TAKMUAT); } catch (e2) { out.takmuatDitolak = e2 && e2.name === 'E_SAKSI_PECAHAN'; }
    out.ok = out.adilOrder && out.jumlahOk && out.batasOk &&
      out.kosongDitolak === true && out.takmuatDitolak === true && out.alasan.length === 0;
    if (!out.ok && out.alasan.length === 0) {
      out.alasan.push('this file\'s own adder disagrees with the vectors written into it');
    }
    return out;
  }());

  /* ------------------------------------------- own copy 3: the shapes */

  /* The worklist comes from here and from the keys of the snapshot, and from
     nowhere else. `awal` says what the snapshot holds for that store, which is
     not uniform: a balance store is snapshotted as its values, a ledger as its
     row count. Getting that wrong silently turns a delta into a count. */
  var TOKO = [
    { store: 'akun', bentuk: 'saldo', awal: 'peta' },
    { store: 'acc', bentuk: 'saldo', awal: 'nilai' },
    { store: 'jurnal', bentuk: 'buku', awal: 'cacah' },
    { store: 'led_n', bentuk: 'buku', awal: 'cacah' },
    { store: 'led_u', bentuk: 'buku', awal: 'cacah' }
  ];
  NS.TOKO = TOKO;

  function bentukOf(store) {
    var i;
    for (i = 0; i < TOKO.length; i++) if (TOKO[i].store === store) return TOKO[i];
    return null;
  }

  /* The one string this file will accept as the provenance of a row list. An
     index-backed read with a range sees a subset and folds it cleanly, and a
     clean fold over a subset is a green panel over missing money. There is no
     code in this lab for "wrong provenance", so it is raised as the handle
     refusal: the only thing this file will take rows from is the store. */
  var ASAL = 'objectStore';
  NS.BAWAH = 'IDBObjectStore';

  /* ---------------------------------------------------- the expectation */

  /* The only place a product is produced in this file, and it is produced from
     two integers this file was handed separately. There is no argument anywhere
     that accepts one already multiplied. */
  function harap(W, n) {
    utuh(W, 'the writer count');
    utuh(n, 'the round count');
    if (W < 0 || n < 0) tolak('E_SAKSI_PECAHAN', 'a writer or round count below zero is not a count');
    var e = W * n;
    utuh(e, 'the expectation');
    return e;
  }
  NS.harap = harap;

  /* A snapshot is integers all the way down. A string, a boolean, a null or an
     array anywhere in it is a value that cannot be subtracted, and finding that
     out at subtraction time is finding it out one seam too late. */
  function angkaSaja(v, what, dalam) {
    var k;
    if (jenis(v) === '[object Object]') {
      if (dalam > 2) {
        tolak('E_SAKSI_PEGANGAN', what + ' nests deeper than a snapshot of balances does');
      }
      for (k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) {
          angkaSaja(v[k], what + '.' + k, dalam + 1);
        }
      }
      return v;
    }
    utuh(v, what);
    return v;
  }

  /* --------------------------------------------------------- the plan */

  function daftarKosong(kosong) {
    var out = [], seen = {};
    if (kosong === null || kosong === undefined) return out;
    bersih(kosong, 'the empty-store declaration', 0);
    if (jenis(kosong) !== '[object Array]') {
      tolak('E_SAKSI_PEGANGAN', 'the empty-store declaration must be an array of store names');
    }
    imbas(kosong, 'the empty-store declaration', function (v, i) {
      if (typeof v !== 'string' || v === '') {
        tolak('E_SAKSI_PEGANGAN', 'the empty-store declaration at index ' + i + ' is not a store name');
      }
      if (!seen[v]) { seen[v] = true; out.push(v); }
    });
    return out;
  }

  /* Synchronous, total, and shared by both entry points, so neither can be given
     an argument the other would have refused. */
  function siap(before, W, n, kosong) {
    var plan = { W: 0, n: 0, expected: 0, worklist: [], unknown: [], kosong: [] };
    var k, shape, names = [], i;

    bersih(before, 'the before snapshot', 0);
    if (jenis(before) !== '[object Object]') {
      tolak('E_SAKSI_PEGANGAN', 'the before snapshot must be a plain object of integers');
    }
    /* Every leaf of the snapshot is proved to be a whole number HERE, in the
       synchronous half, and not later where the delta is taken. Found the hard
       way in this file's own probe: with the check downstream, a fractional
       balance in the snapshot came back as a REJECTED PROMISE, which a
       synchronous throws() helper records as "did not throw" and then drops —
       and the dropped rejection is a page error that fails the lab with every
       assertion green. That is the precise failure this file exists to refuse,
       so it is not allowed to happen inside it. */
    angkaSaja(before, 'the before snapshot', 0);

    plan.W = utuh(W, 'the writer count');
    plan.n = utuh(n, 'the round count');
    plan.expected = harap(W, n);
    plan.kosong = daftarKosong(kosong);

    for (k in before) {
      if (Object.prototype.hasOwnProperty.call(before, k)) names.push(k);
    }
    names.sort();
    for (i = 0; i < names.length; i++) {
      shape = bentukOf(names[i]);
      if (shape) { plan.worklist.push(names[i]); } else { plan.unknown.push(names[i]); }
    }
    if (plan.worklist.length === 0) {
      tolak('E_SAKSI_KOSONG', 'the before snapshot names no store this file has a shape for, so there is nothing to witness');
    }
    return plan;
  }

  /* ------------------------------------------------------ the envelopes */

  function ambilAmplop(bukti, store) {
    var amp, k;
    if (!Object.prototype.hasOwnProperty.call(bukti, store)) {
      tolak('E_SAKSI_KOSONG', 'no rows arrived for ' + store + ', and this file picked that store itself');
    }
    amp = bukti[store];
    bukanThenable(amp, 'the rows for ' + store);
    bukanUkuran(amp, 'the rows for ' + store);
    if (typeof amp === 'function') {
      tolak('E_SAKSI_GETTER', 'the rows for ' + store + ' arrived as a function');
    }
    if (jenis(amp) !== '[object Object]') {
      tolak('E_SAKSI_PEGANGAN', 'the rows for ' + store + ' did not arrive in a plain envelope');
    }
    if (typeof amp.store !== 'string' || amp.store !== store) {
      tolak('E_SAKSI_PEGANGAN', 'the envelope for ' + store + ' names a different store');
    }
    if (typeof amp.via !== 'string' || amp.via !== ASAL) {
      tolak('E_SAKSI_PEGANGAN', 'the rows for ' + store + ' came via ' +
        (typeof amp.via === 'string' ? amp.via : jenis(amp.via)) +
        ' and not from the object store, so this file cannot establish they are all of them');
    }
    utuh(amp.count, 'the row count reported for ' + store);
    if (jenis(amp.rows) !== '[object Array]') {
      tolak('E_SAKSI_PEGANGAN', 'the rows for ' + store + ' are not a real array');
    }
    if (amp.count !== amp.rows.length) {
      tolak('E_SAKSI_KOSONG', 'the envelope for ' + store + ' reports ' + amp.count +
        ' rows and carries ' + amp.rows.length + ', so a fold over it would agree with a number nobody produced');
    }
    /* Every row is walked by the gate before a single figure is taken off it. A
       Map, a live handle or a float reaching the arithmetic is a wrong answer
       that looks like a right one. */
    k = imbas(amp.rows, store + '.rows', function (row, i) {
      bersih(row, store + '.rows[' + i + ']', 1);
      if (jenis(row) !== '[object Object]') {
        tolak('E_SAKSI_PEGANGAN', store + '.rows[' + i + '] is not a plain row');
      }
    });
    if (k !== amp.count) {
      tolak('E_SAKSI_KOSONG', 'the walk over ' + store + ' visited ' + k + ' rows of a reported ' + amp.count);
    }
    return amp;
  }

  function bolehKosong(plan, store) {
    var i;
    for (i = 0; i < plan.kosong.length; i++) if (plan.kosong[i] === store) return true;
    return false;
  }

  function totalKosong(plan, store, list, what) {
    if (list.length === 0) {
      if (!bolehKosong(plan, store)) {
        tolak('E_SAKSI_KOSONG', store + ' yielded no rows and no explicit zero was declared for it, so ' +
          what + ' would be a zero nobody asked for');
      }
      return tambah([], 0);
    }
    return tambah(list);
  }

  /* ------------------------------------------------------- the readings */

  function bacaSaldo(plan, amp, alasan) {
    var out = { store: amp.store, via: amp.via, rows: amp.count, saldo: {}, keys: [], total: 0 };
    var nilai = [];
    imbas(amp.rows, amp.store + '.rows', function (row, i) {
      var k = row.k;
      if (typeof k !== 'string' || k === '') {
        tolak('E_SAKSI_PEGANGAN', amp.store + '.rows[' + i + '] carries no string key');
      }
      utuh(row.v, amp.store + '.rows[' + i + '].v');
      if (Object.prototype.hasOwnProperty.call(out.saldo, k)) {
        alasan.push(amp.store + ' carries two rows for key ' + k + ', so no single balance can be read from it');
      }
      out.saldo[k] = row.v;
      out.keys.push(k);
      nilai.push(row.v);
    });
    out.keys.sort();
    out.total = totalKosong(plan, amp.store, nilai, 'its balance');
    return out;
  }

  function bacaBuku(plan, amp) {
    var out = {
      store: amp.store, via: amp.via, rows: amp.count, total: 0,
      unik: 0, ganda: 0, tanpaKunci: 0, negatif: 0
    };
    var delta = [], hitung = {}, kunci = [], i;
    imbas(amp.rows, amp.store + '.rows', function (row, i2) {
      var d = row.delta, id = row.id, key;
      utuh(d, amp.store + '.rows[' + i2 + '].delta');
      if (typeof id !== 'string' && typeof id !== 'number') {
        tolak('E_SAKSI_PEGANGAN', amp.store + '.rows[' + i2 + '] carries no readable row id');
      }
      if (d < 0) out.negatif++;
      delta.push(d);
      if (!Object.prototype.hasOwnProperty.call(row, 'idem') || row.idem === undefined) {
        out.tanpaKunci++;
        return;
      }
      key = row.idem;
      if (typeof key !== 'string' || key === '') {
        tolak('E_SAKSI_PEGANGAN', amp.store + '.rows[' + i2 + '].idem is not a key');
      }
      if (Object.prototype.hasOwnProperty.call(hitung, key)) {
        hitung[key] = hitung[key] + 1;
      } else {
        hitung[key] = 1;
        kunci.push(key);
      }
    });
    out.total = totalKosong(plan, amp.store, delta, 'its ledger total');
    for (i = 0; i < kunci.length; i++) {
      out.unik++;
      if (hitung[kunci[i]] > 1) out.ganda += hitung[kunci[i]] - 1;
    }
    return out;
  }

  /* ------------------------------------------------------- the verdict */

  /* SYNCHRONOUS. Envelopes arrive materialised, every refusal is a throw, and
     nothing here returns a promise. The negatives in the suite are pinned
     against this function for that reason. */
  NS.periksa = function (bukti, before, W, n, kosong) {
    var plan, hasil, i, store, shape, amp, baca, k, kk;

    bersih(bukti, 'the rows', 0);
    if (jenis(bukti) !== '[object Object]') {
      tolak('E_SAKSI_PEGANGAN', 'the rows must arrive as a plain map of store name to envelope');
    }
    plan = siap(before, W, n, kosong);

    hasil = {
      sharedBottom: NS.BAWAH,
      worklist: plan.worklist,
      unknown: plan.unknown,
      diabaikan: [],
      kosongDinyatakan: plan.kosong,
      W: plan.W,
      n: plan.n,
      expected: plan.expected,
      saldo: {},
      awal: {},
      delta: {},
      kurang: {},
      acc: { after: 0, before: 0, delta: 0, ada: false },
      buku: {},
      toko: {},
      adder: NS.SENDIRI.ok,
      ok: false,
      alasan: []
    };

    for (k in bukti) {
      if (Object.prototype.hasOwnProperty.call(bukti, k) && !bentukOf(k)) {
        hasil.diabaikan.push(k);
      }
    }
    hasil.diabaikan.sort();

    for (i = 0; i < plan.worklist.length; i++) {
      store = plan.worklist[i];
      shape = bentukOf(store);
      amp = ambilAmplop(bukti, store);
      hasil.toko[store] = { store: amp.store, via: amp.via, rows: amp.count };

      if (shape.bentuk === 'saldo') {
        baca = bacaSaldo(plan, amp, hasil.alasan);
        if (shape.awal === 'peta') {
          /* A balance store snapshotted as a map. Every key present now must
             have been present in the snapshot, or the delta is being measured
             against a number that was never taken. */
          if (jenis(before[store]) !== '[object Object]') {
            tolak('E_SAKSI_PEGANGAN', 'the before snapshot for ' + store + ' is not a map of balances');
          }
          for (kk = 0; kk < baca.keys.length; kk++) {
            k = baca.keys[kk];
            hasil.saldo[k] = baca.saldo[k];
            if (!Object.prototype.hasOwnProperty.call(before[store], k)) {
              hasil.alasan.push('the before snapshot has no value for ' + store + '.' + k +
                ', so its delta cannot be established');
              continue;
            }
            hasil.awal[k] = utuh(before[store][k], 'the before value for ' + store + '.' + k);
            hasil.delta[k] = hasil.saldo[k] - hasil.awal[k];
            utuh(hasil.delta[k], 'the delta for ' + store + '.' + k);
            hasil.kurang[k] = plan.expected - hasil.delta[k];
          }
        } else {
          hasil.acc.ada = true;
          hasil.acc.after = baca.total;
          hasil.acc.before = utuh(before[store], 'the before value for ' + store);
          hasil.acc.delta = hasil.acc.after - hasil.acc.before;
          utuh(hasil.acc.delta, 'the delta for ' + store);
        }
      } else {
        baca = bacaBuku(plan, amp);
        baca.awalRows = utuh(before[store], 'the before row count for ' + store);
        baca.deltaRows = baca.rows - baca.awalRows;
        baca.kurangRows = plan.expected - baca.deltaRows;
        baca.kurangTotal = plan.expected - baca.total;
        utuh(baca.deltaRows, 'the row delta for ' + store);
        hasil.buku[store] = baca;
        if (baca.deltaRows < 0) {
          hasil.alasan.push(store + ' holds fewer rows than the snapshot recorded, so a row was removed from an append-only store');
        }
      }
    }

    if (hasil.unknown.length) {
      hasil.alasan.push('the before snapshot carries ' + hasil.unknown.join(', ') +
        ', which this file has no independent route to and therefore will not certify');
    }
    if (!NS.SENDIRI.ok) {
      hasil.alasan.push('this file\'s own adder failed its load-time check against its own vectors');
    }
    hasil.ok = hasil.alasan.length === 0;
    return hasil;
  };

  /* ---------------------------------------------------- the promise form */

  /* A thin wrapper. Every argument refusal above fires here too, before the
     first read is issued and therefore before any promise exists — a rejected
     promise handed to a synchronous throws() helper is recorded as "did not
     throw" and then dropped, and the drop is a page error with every assertion
     green. The reads are sequential on purpose: this file is a witness, not a
     second workload, and overlapping its own reads with the engine's would put
     it in the race it is describing. */
  NS.fold = function (read, before, W, n, kosong) {
    var plan, bukti = {}, chain, i;

    bukanThenable(read, 'the reader');
    bukanUkuran(read, 'the reader');
    if (typeof read !== 'function') {
      tolak('E_SAKSI_PEGANGAN', 'row access arrives as a reader function; this file never reaches for a handle');
    }
    plan = siap(before, W, n, kosong);

    chain = Promise.resolve(null);
    for (i = 0; i < plan.worklist.length; i++) {
      chain = chain.then(minta(read, plan.worklist[i], bukti));
    }
    return chain.then(function () {
      return NS.periksa(bukti, before, W, n, kosong);
    });
  };

  function minta(read, store, bukti) {
    return function () {
      return Promise.resolve(read(store)).then(function (amp) {
        bukti[store] = amp;
        return null;
      });
    };
  }

  /* -------------------------------------------------------- the compare */

  /* The row shape the page prints: what the engine said, what this file derived,
     and the difference. It takes the engine's figures as bare integers — never
     its result object — so nothing with behaviour crosses back the other way
     either, and it refuses a label it cannot produce independently. A witness
     that will "confirm" any label it is handed is a witness that confirms
     whatever it is told. */
  function ambilAngka(hasil, label) {
    var dot = label.indexOf('.'), head, tail;
    if (label === 'expected') return hasil.expected;
    if (label === 'acc') return hasil.acc.ada ? hasil.acc.after : null;
    if (label === 'acc.delta') return hasil.acc.ada ? hasil.acc.delta : null;
    if (dot < 0) {
      if (Object.prototype.hasOwnProperty.call(hasil.saldo, label)) return hasil.saldo[label];
      return null;
    }
    head = label.slice(0, dot);
    tail = label.slice(dot + 1);
    if (Object.prototype.hasOwnProperty.call(hasil.buku, head)) {
      if (tail === 'rows') return hasil.buku[head].rows;
      if (tail === 'total') return hasil.buku[head].total;
      if (tail === 'unik') return hasil.buku[head].unik;
      if (tail === 'ganda') return hasil.buku[head].ganda;
      if (tail === 'deltaRows') return hasil.buku[head].deltaRows;
      return null;
    }
    if (head === 'delta' && Object.prototype.hasOwnProperty.call(hasil.delta, tail)) {
      return hasil.delta[tail];
    }
    if (head === 'kurang' && Object.prototype.hasOwnProperty.call(hasil.kurang, tail)) {
      return hasil.kurang[tail];
    }
    return null;
  }

  NS.banding = function (mesin, hasil) {
    var out = { sharedBottom: NS.BAWAH, rows: [], differs: 0, ok: false }, names = [], k, i, a, b;

    bersih(mesin, 'the engine figures', 0);
    if (jenis(mesin) !== '[object Object]') {
      tolak('E_SAKSI_PEGANGAN', 'the engine figures must arrive as a plain object of integers');
    }
    bukanThenable(hasil, 'the verdict');
    bukanUkuran(hasil, 'the verdict');
    if (!hasil || jenis(hasil) !== '[object Object]' || hasil.sharedBottom !== NS.BAWAH) {
      tolak('E_SAKSI_PEGANGAN', 'the second operand is not a verdict this file produced');
    }

    for (k in mesin) {
      if (Object.prototype.hasOwnProperty.call(mesin, k)) names.push(k);
    }
    names.sort();
    if (names.length === 0) {
      tolak('E_SAKSI_KOSONG', 'no figure was offered for comparison');
    }
    for (i = 0; i < names.length; i++) {
      a = utuh(mesin[names[i]], 'the engine figure for ' + names[i]);
      b = ambilAngka(hasil, names[i]);
      if (b === null) {
        tolak('E_SAKSI_KOSONG', 'this file has no independent route to ' + names[i] +
          ', so there is nothing to compare it against');
      }
      utuh(b, 'the witnessed figure for ' + names[i]);
      out.rows.push({ label: names[i], a: a, b: b, d: a - b, differs: a !== b });
      if (a !== b) out.differs++;
    }
    out.ok = out.differs === 0;
    return out;
  };

  root.SEROBOT_SAKSI = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SEROBOT_SAKSI;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
