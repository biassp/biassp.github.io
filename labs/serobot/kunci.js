/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — kunci.js
 * THE ONLY FILE IN THIS LAB THAT CALLS navigator.locks.request.
 *
 *   grep -ln 'locks\.request' labs/serobot/*.js
 *
 * prints one path. That is not tidiness. A lock is the one primitive on this
 * page that can hang the whole run with nothing on screen and nothing in the
 * console: a request that is never granted does not throw, does not log, does
 * not time out, and does not appear anywhere except as a job that eventually
 * hits the runner's cap with no diagnostic at all. Measured, on this page's own
 * Chromium: a same-name request issued from inside the holder sat for three
 * seconds with held 1, pending 1, zero errors and zero console output. There is
 * no deadlock detector in the Web Locks API and there is no default timeout.
 *
 * So every request in this lab passes through hold(), and hold() REFUSES,
 * synchronously, any request that could wait forever:
 *
 *   - an AbortSignal makes the wait bounded;
 *   - ifAvailable: true never waits at all — the callback runs immediately with
 *     null when the lock is taken;
 *   - steal: true never waits either — it takes the lock out of the current
 *     holder's hands on the spot.
 *
 * Anything else is E_KUNCI_TANPA_BATAS before a promise exists. That refusal is
 * the structural reason a lock in this lab cannot hang the run, and one file is
 * what makes the claim checkable by a stranger in three seconds.
 *
 * A SECOND MEASURED RULE, and it is why the bounded set is three items and not
 * one: the specification rejects a request carrying BOTH a signal and steal (or
 * ifAvailable) with NotSupportedError. A steal that also had to carry a signal
 * would therefore be unissuable, so the rule cannot simply be "always pass a
 * signal" — it has to be "never issue a request that can wait".
 *
 * THE HOLDER'S catch IS ATTACHED IN THE SAME EXPRESSION THAT CREATES THE
 * REQUEST. A holder whose lock is stolen has its promise rejected with
 * AbortError; a catch attached one turn later is a catch attached after the
 * unhandled-rejection checkpoint has already run, and an unhandled rejection on
 * this page is a page error that fails the lab with every assertion green.
 *
 * This file also carries three things that are about locking in the wide sense
 * and have nowhere else honest to live:
 *
 *   1. THE LEASE. labs/gudang/ protects a cross-tab critical section with a
 *      nine-second TTL record, not with a Web Lock. The comparison is a trade
 *      with two columns, not a takedown, so the lease is reproduced here as a
 *      fixture and both columns are measured. Its clock arrives as an integer
 *      argument. Nothing in this lab orders anything by a real clock.
 *   2. THE FENCING TOKEN. A lease that lapses under a holder who is frozen but
 *      alive produces two parties who both believe they hold it. steal: true
 *      constructs the same situation for a Web Lock. The fixture refuses a
 *      stale token with E_SEWA_KEDALUWARSA, which is the thing gudang has none
 *      of.
 *   3. THE TWO AUDIT SHAPES. Two write shapes transcribed out of this
 *      repository — gudang's single-transaction lock record and saku's
 *      peerApplyOne read-then-write — run through the same rendezvous the
 *      centrepiece uses. Transcribed, quoted with file and line, and never
 *      imported: a fixture that imported the real thing would be testing
 *      whatever that file happens to be today rather than the shape being
 *      discussed.
 *
 * DOM-free. Storage through db.js's connection and one small readwrite helper
 * of its own for the lease record, whose value is an object and therefore
 * cannot go through db.js's integer-only write().
 */
/* global SEROBOT_KODE */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var NS = {};

  /* ------------------------------------------------------------ the API */

  function locks() {
    var n = null;
    try { n = root.navigator; } catch (e) { n = null; }
    return (n && n.locks) ? n.locks : null;
  }

  function usable(l) {
    return !!(l && typeof l.request === 'function');
  }

  NS.ada = function () { return usable(locks()); };
  NS.sumber = function () { return locks(); };

  /* Every lock request in this lab carries this deadline. It lives in kode.js
     with the rest of §6.1's numbers so a suite can assert the two agree — a
     number is the cheapest thing here to give a second route. */
  NS.BUDGET = (KODE && KODE.ANGKA ? KODE.ANGKA.lockDeadline : 2000);

  /* The bounded self-deadlock's inner deadline. Short on purpose: the fixture
     is about the NAME the request fails with, never about how long it waited. */
  NS.SARANG = 300;

  /* ------------------------------------------------------- the run prefix */

  /* Two runs on one page sharing a lock name serialise against each other and
     the second one's numbers are the first one's numbers. Every name this file
     issues is prefixed with the run's own id, so two runs cannot collide even
     if the single-flight latch above them is ever bypassed. arms.js calls
     hold('rmw', …) with a BARE name, so the prefix is applied here and the
     printed arm body stays honest. */
  var awalan = '';

  NS.pakaiAwalan = function (p) {
    awalan = String(p == null ? '' : p);
    return awalan;
  };
  NS.awalan = function () { return awalan; };
  NS.nama = function (bare) { return awalan + String(bare); };

  /* ------------------------------------------------------------- hold() */

  /* Bounded means: this request cannot wait for another agent to finish.
     A signal bounds the wait; ifAvailable and steal do not wait at all. */
  function terbatas(o) {
    return !!(o && (o.signal || o.ifAvailable === true || o.steal === true));
  }

  function opsi(o) {
    var r = {};
    /* mode is passed through unvalidated on purpose, including 'nonsense':
       the page shows the browser's own refusal rather than this file's. */
    if (o.mode) r.mode = o.mode;
    if (o.ifAvailable === true) r.ifAvailable = true;
    if (o.steal === true) r.steal = true;
    if (o.signal) r.signal = o.signal;
    return r;
  }

  /* The injectable form. The negative that proves E_KUNCI_TIADA fires cannot
     delete navigator.locks out from under a live page, so the source arrives as
     an argument and the fixture passes null. A feature detection that has never
     been seen to refuse is not a feature detection. */
  NS.holdDengan = function (l, name, opts, fn) {
    if (typeof fn !== 'function') throw KODE.refuse('E_MODE', 'hold needs a callback');
    if (!usable(l)) throw KODE.refuse('E_KUNCI_TIADA', 'navigator.locks is not available in this realm');
    var o = opts || {};
    if (!terbatas(o)) {
      throw KODE.refuse('E_KUNCI_TANPA_BATAS', 'a lock request must carry an AbortSignal, ifAvailable or steal');
    }
    return l.request(NS.nama(name), opsi(o), fn);
  };

  NS.hold = function (name, opts, fn) {
    return NS.holdDengan(locks(), name, opts, fn);
  };

  /* The two-argument adapter idem.js asks for. It supplies the deadline itself
     rather than leaving one out, so the idempotency panel's "with a real Web
     Lock around the write" sentence is true and still cannot hang the run. */
  NS.pegang = function (name, fn) {
    return NS.hold(name, { signal: AbortSignal.timeout(NS.BUDGET) }, fn);
  };

  /* --------------------------------------------------- a holder, as data */

  /* A holder that is released by an explicit resolve rather than by a duration.
     A negative fixture whose holder is released by a timer inverts into a
     silent pass the moment the machine is slower than the timer. */
  NS.tahan = function (name, opts, catat) {
    var rec = {
      name: NS.nama(name),
      masuk: false,
      keluar: false,
      mode: '',
      nol: false,          /* the callback ran with lock === null (ifAvailable) */
      gagal: '',
      nilai: null
    };
    var buka = null, tanda = null;
    var dalam = new Promise(function (res) { buka = res; });
    var o = opts || { signal: AbortSignal.timeout(NS.BUDGET) };
    var lapor = typeof catat === 'function' ? catat : function () { };

    /* masukP settles on the callback itself, and also on a failure to be
       granted, so a waiter can never be left waiting on a request the browser
       already refused. Polling a boolean with a timer here would make every
       ordering result a function of how fast the machine polled. */
    rec.masukP = new Promise(function (res) { tanda = res; });

    /* The catch is part of the same expression that creates the request. */
    rec.selesai = NS.hold(name, o, function (lock) {
      rec.masuk = true;
      rec.nol = lock === null;
      rec.mode = lock ? String(lock.mode) : '';
      lapor('in', rec);
      tanda(rec);
      return dalam;
    }).then(function (v) {
      rec.keluar = true;
      rec.nilai = v === undefined ? null : v;
      lapor('out', rec);
      return rec;
    }, function (e) {
      rec.gagal = KODE.nameOf(e);
      lapor('fail', rec);
      tanda(rec);
      return rec;
    });

    rec.lepas = function (v) { buka(v === undefined ? null : v); return rec.selesai; };
    return rec;
  };

  /* ------------------------------------------------------------ query() */

  function entri(e) {
    return {
      clientId: String(e && e.clientId ? e.clientId : ''),
      mode: String(e && e.mode ? e.mode : ''),
      name: String(e && e.name ? e.name : '')
    };
  }

  function daftar(a) {
    var out = [], i;
    if (!a || typeof a.length !== 'number') return out;
    for (i = 0; i < a.length; i++) out.push(entri(a[i]));
    return out;
  }

  /* The browser's own queue, flattened to plain data. A visitor can paste
     await navigator.locks.query() into their console mid-hold and get the same
     two arrays back — which is the entire reason this panel is worth showing
     rather than a registry of our own requests wearing the browser's name. */
  NS.lihat = function () {
    var l = locks();
    if (!l || typeof l.query !== 'function') {
      return Promise.reject(KODE.refuse('E_KUNCI_TIADA', 'navigator.locks.query is not available'));
    }
    return l.query().then(function (s) {
      return { held: daftar(s && s.held), pending: daftar(s && s.pending) };
    });
  };

  NS.hitung = function (snap, name) {
    var out = { held: 0, pending: 0 }, i;
    var want = name == null ? null : String(name);
    if (!snap) return out;
    for (i = 0; i < (snap.held || []).length; i++) {
      if (want === null || snap.held[i].name === want) out.held++;
    }
    for (i = 0; i < (snap.pending || []).length; i++) {
      if (want === null || snap.pending[i].name === want) out.pending++;
    }
    return out;
  };

  NS.klienUnik = function (list) {
    var seen = {}, n = 0, i, c;
    for (i = 0; i < (list || []).length; i++) {
      c = list[i].clientId;
      if (!Object.prototype.hasOwnProperty.call(seen, c)) { seen[c] = 1; n++; }
    }
    return n;
  };

  /* ------------------------------------------------------------- timers */

  /* Injectable, so a caller that wants to drive the observation window itself
     can. Nothing here asserts a duration; the timers only bound observations. */
  function tunggu(ms, timer) {
    var t = typeof timer === 'function' ? timer : function (cb, d) { return root.setTimeout(cb, d); };
    return new Promise(function (res) { t(function () { res(null); }, ms); });
  }

  /* ------------------------------------------------- the thirteen behaviours */

  NS.PERILAKU = [
    'urutan', 'tersedia', 'sinyal', 'waktu', 'modeSalah', 'tersediaCuri',
    'sinyalCuri', 'curi', 'berbagi', 'bentuk', 'klien', 'sarangBerbatas', 'buntu'
  ];

  function sig() { return { signal: AbortSignal.timeout(NS.BUDGET) }; }
  function sigMode(m) { return { mode: m, signal: AbortSignal.timeout(NS.BUDGET) }; }

  /* A holder is "in" when its own callback has run — read off the callback, not
     off a poll. */
  function waitIn(rec) { return rec.masukP; }
  NS.waitIn = waitIn;

  /* 1. Two exclusive holders on one name serialise, and the string says so.
        Every entry in that string is a real event: the callback running, and the
        request promise settling. Nothing is logged in advance of the thing it
        claims to record. */
  NS.urutan = function () {
    var log = [];
    var a = null, b = null;
    function tag(t) { return function (ev) { log.push(t + '-' + ev); }; }
    a = NS.tahan('urut', sig(), tag('a'));
    return waitIn(a).then(function () {
      b = NS.tahan('urut', sig(), tag('b'));
      /* b is now pending behind a. Releasing a is what lets b in — nothing
         here waits for a duration and then hopes. */
      return a.lepas();
    }).then(function () {
      return waitIn(b);
    }).then(function () {
      return b.lepas();
    }).then(function () {
      return { order: log.join(','), ok: log.join(',') === 'a-in,a-out,b-in,b-out' };
    });
  };

  /* 2. ifAvailable while the name is held: the callback RUNS, with null. */
  NS.tersedia = function () {
    var a = NS.tahan('avail', sig());
    var out = { ran: false, lockNull: false, value: '' };
    return waitIn(a).then(function () {
      return NS.hold('avail', { ifAvailable: true }, function (lock) {
        out.ran = true;
        out.lockNull = lock === null;
        return 'ran';
      });
    }).then(function (v) {
      out.value = String(v);
      return a.lepas();
    }).then(function () {
      out.ok = out.ran && out.lockNull && out.value === 'ran';
      return out;
    });
  };

  /* 3. A signal aborted while the request is pending: AbortError. The holder is
        released by an explicit resolve AFTER the rejection is observed, never by
        a duration — a holder released by a timer turns this negative into a
        silent pass on a slow machine. */
  NS.sinyal = function () {
    var ctrl = new AbortController();
    var a = NS.tahan('sinyal', sig());
    var out = { name: '', ok: false };
    return waitIn(a).then(function () {
      var p = NS.hold('sinyal', { signal: ctrl.signal }, function () { return 'never'; })
        ['catch'](function (e) { return KODE.nameOf(e); });
      ctrl.abort();
      return p;
    }).then(function (n) {
      out.name = String(n);
      out.ok = out.name === 'AbortError';
      return a.lepas();
    }).then(function () { return out; });
  };

  /* 4. AbortSignal.timeout on a pending request: TimeoutError, a DIFFERENT name
        from the aborted case, and both are assertable. */
  NS.waktu = function () {
    var a = NS.tahan('waktu', sig());
    var out = { name: '', ok: false };
    return waitIn(a).then(function () {
      return NS.hold('waktu', { signal: AbortSignal.timeout(60) }, function () { return 'never'; })
        ['catch'](function (e) { return KODE.nameOf(e); });
    }).then(function (n) {
      out.name = String(n);
      out.ok = out.name === 'TimeoutError';
      return a.lepas();
    }).then(function () { return out; });
  };

  /* 5. An invalid mode. This file passes mode through rather than validating it,
        so what the page prints is Chromium's refusal and not ours. */
  NS.modeSalah = function () {
    var out = { name: '', sync: false };
    var p;
    try {
      p = NS.hold('mode', { mode: 'nonsense', signal: AbortSignal.timeout(NS.BUDGET) }, function () { return 1; });
    } catch (e) {
      out.name = KODE.nameOf(e);
      out.sync = true;
      return Promise.resolve(out);
    }
    return p.then(function () { return out; }, function (e) {
      out.name = KODE.nameOf(e);
      return out;
    });
  };

  /* 6. ifAvailable and steal together: NotSupportedError. */
  NS.tersediaCuri = function () {
    var out = { name: '', sync: false };
    var p;
    try {
      p = NS.hold('nosup', { ifAvailable: true, steal: true }, function () { return 1; });
    } catch (e) {
      out.name = KODE.nameOf(e); out.sync = true; return Promise.resolve(out);
    }
    return p.then(function () { return out; }, function (e) { out.name = KODE.nameOf(e); return out; });
  };

  /* 7. A signal together with steal: also NotSupportedError. This is the reason
        the bounded set has three members — a steal that had to carry a signal
        could not be issued at all. */
  NS.sinyalCuri = function () {
    var out = { name: '', sync: false };
    var p;
    try {
      p = NS.hold('nosup2', { steal: true, signal: AbortSignal.timeout(NS.BUDGET) }, function () { return 1; });
    } catch (e) {
      out.name = KODE.nameOf(e); out.sync = true; return Promise.resolve(out);
    }
    return p.then(function () { return out; }, function (e) { out.name = KODE.nameOf(e); return out; });
  };

  /* 8. steal takes the lock out of the holder's hands. The holder learns by
        rejection, which is exactly the two-parties-both-believe situation a
        fencing token exists for, constructed in a browser with two lines. */
  NS.curi = function () {
    var a = NS.tahan('curi', sig());
    var out = { mode: '', holder: '', ok: false };
    return waitIn(a).then(function () {
      return NS.hold('curi', { steal: true }, function (lock) {
        out.mode = lock ? String(lock.mode) : '';
        return 'stolen';
      });
    }).then(function () {
      return a.selesai;
    }).then(function (rec) {
      out.holder = rec.gagal;
      out.ok = out.mode === 'exclusive' && out.holder === 'AbortError';
      return out;
    });
  };

  /* 9. shared, shared, exclusive, shared — strict FIFO. The trailing shared does
        NOT join the two shared holders already inside; it waits behind the
        exclusive request that arrived before it. */
  NS.berbagi = function () {
    var log = [];
    function masuk(t) { return function (ev) { if (ev === 'in') log.push(t + '-in'); }; }
    var s1 = NS.tahan('bagi', sigMode('shared'), masuk('s1'));
    var s2 = NS.tahan('bagi', sigMode('shared'), masuk('s2'));
    var x1 = null, s3 = null;
    return waitIn(s1).then(function () { return waitIn(s2); }).then(function () {
      x1 = NS.tahan('bagi', sigMode('exclusive'), masuk('x1'));
      s3 = NS.tahan('bagi', sigMode('shared'), masuk('s3'));
      return s1.lepas();
    }).then(function () {
      return s2.lepas();
    }).then(function () {
      return waitIn(x1);
    }).then(function () {
      return x1.lepas();
    }).then(function () {
      return waitIn(s3);
    }).then(function () {
      return s3.lepas();
    }).then(function () {
      return { order: log.join(','), ok: log.join(',') === 's1-in,s2-in,x1-in,s3-in' };
    });
  };

  /* 10. The shape of query()'s answer, as keys rather than as prose. */
  NS.bentuk = function () {
    var a = NS.tahan('bentuk', sig());
    var out = { top: [], entry: [], held: 0 };
    return waitIn(a).then(function () {
      var l = locks();
      return l.query();
    }).then(function (s) {
      var k = [], e = null, i;
      for (i in s) if (Object.prototype.hasOwnProperty.call(s, i)) k.push(i);
      out.top = k.sort();
      for (i = 0; i < s.held.length; i++) {
        if (s.held[i].name === NS.nama('bentuk')) { e = s.held[i]; out.held++; }
      }
      if (e) {
        k = [];
        for (i in e) if (Object.prototype.hasOwnProperty.call(e, i)) k.push(i);
        out.entry = k.sort();
      }
      return a.lepas();
    }).then(function () { return out; });
  };

  /* 11. clientId is per-CLIENT, not per-request. Two pending requests issued
         from one document report ONE clientId, and it is the same id the held
         entry carries. So an on-screen queue cannot be labelled by requester
         inside one document — which is why every queued participant in this
         lab's queue panel is its own worker. The page says that rather than
         pretending query() can do more than it does. */
  NS.klien = function () {
    var a = NS.tahan('klien', sig());
    var b = null, c = null;
    var out = { pending: 0, distinct: 0, sameAsHeld: false };
    return waitIn(a).then(function () {
      b = NS.tahan('klien', sig());
      c = NS.tahan('klien', sig());
      return NS.lihat();
    }).then(function (snap) {
      var mine = [], held = null, i;
      for (i = 0; i < snap.pending.length; i++) {
        if (snap.pending[i].name === NS.nama('klien')) mine.push(snap.pending[i]);
      }
      for (i = 0; i < snap.held.length; i++) {
        if (snap.held[i].name === NS.nama('klien')) held = snap.held[i];
      }
      out.pending = mine.length;
      out.distinct = NS.klienUnik(mine);
      out.sameAsHeld = !!(held && mine.length && mine[0].clientId === held.clientId);
      return a.lepas();
    }).then(function () { return waitIn(b); }).then(function () { return b.lepas(); })
      .then(function () { return waitIn(c); }).then(function () { return c.lepas(); })
      .then(function () { return out; });
  };

  /* 12. The bounded self-deadlock. A same-name request issued from INSIDE the
         holder can never be granted, because the thing it waits for is the
         caller. With a deadline it fails by name and the outer holder still
         completes; that is the shape every request in this lab has. */
  NS.sarangBerbatas = function () {
    var out = { inner: '', outer: false, ok: false };
    return NS.hold('sarang', { signal: AbortSignal.timeout(NS.BUDGET) }, function () {
      return NS.hold('sarang', { signal: AbortSignal.timeout(NS.SARANG) }, function () { return 'never'; })
        ['catch'](function (e) { out.inner = KODE.nameOf(e); return null; });
    }).then(function () {
      out.outer = true;
      out.ok = out.inner === 'TimeoutError' && out.outer === true;
      return out;
    });
  };

  /* 13. The same deadlock without a deadline, observed rather than survived.
         For the whole observation window the inner request does not settle,
         query() reports held 1 and pending 1, and NOTHING is logged anywhere:
         no error, no warning, no rejection. That silence is the counterweight
         paragraph to "just use a lock".

         The inner request still carries a signal, because this file cannot
         issue one that does not — the fixture aborts it itself once the window
         closes. What is being shown is that the BROWSER never resolves it, not
         that a request can be made to hang forever here. */
  NS.buntu = function (ms, timer) {
    var win = KODE.bulat(ms) && ms > 0 ? ms : 3000;
    var ctrl = new AbortController();
    /* The live flag and the reported one are DIFFERENT FIELDS. The cleanup at
       the end of the window settles the inner request by aborting it, and a
       report that read one mutable flag would show the cleanup's answer while
       claiming to describe the window. */
    var hidup = { settled: false, name: '' };
    var out = { settled: false, name: '', held: 0, pending: 0, window: win, bersih: '', ok: false };
    var lepas = null;
    var dalam = new Promise(function (res) { lepas = res; });

    var luar = NS.hold('buntu', { signal: AbortSignal.timeout(win * 4) }, function () {
      /* The catch is attached in the same expression that creates it. */
      NS.hold('buntu', { signal: ctrl.signal }, function () { hidup.settled = true; return null; })
        .then(function () { hidup.settled = true; }, function (e) {
          hidup.settled = true;
          hidup.name = KODE.nameOf(e);
        });
      return dalam;
    });

    return tunggu(win, timer).then(function () {
      return NS.lihat();
    }).then(function (snap) {
      var c = NS.hitung(snap, NS.nama('buntu'));
      /* Everything reported is read BEFORE the cleanup runs. */
      out.settled = hidup.settled;
      out.name = hidup.name;
      out.held = c.held;
      out.pending = c.pending;
      out.ok = out.settled === false && out.held === 1 && out.pending === 1;
      ctrl.abort();
      lepas(null);
      return luar;
    }).then(function () {
      /* And this is what the cleanup produced, kept apart from the observation
         so the two can never be confused for each other. */
      out.bersih = hidup.name;
      return out;
    });
  };

  NS.perilaku = function (name) {
    if (NS.PERILAKU.indexOf(String(name)) < 0) {
      return Promise.reject(KODE.refuse('E_MODE', 'unknown lock behaviour'));
    }
    return NS[name]();
  };

  /* -------------------------------------------------------- the lease */

  /* labs/gudang/store.js:135-139, verbatim, and it is a prose claim that has
     never been measured anywhere in this repository until this lab: */
  NS.KUTIPAN = {
    gudang: {
      file: 'labs/gudang/store.js',
      line: '135-139',
      text: 'The lock is a single record read and written inside ONE readwrite transaction, ' +
        'and IndexedDB serialises overlapping readwrite transactions on the same store, ' +
        'so the read-modify-write is atomic across tabs.'
    },
    saku: {
      file: 'labs/saku/sync.js',
      line: '47',
      text: 'peerApplyOne reads the peer record through peerGet (a readonly transaction), ' +
        'decides whether the idempotency key was already seen, and writes the updated ' +
        'record back through peerPut (a later readwrite transaction). rec.seen is ' +
        'truncated to the last 50 entries.'
    }
  };

  NS.SEWA_TTL = 9000;
  NS.PEER = 'PEER-FIKTIF-01';

  /* db.js's write() takes an integer, because money in this lab is an integer.
     The lease record is an object, so this file opens its own transaction for
     the one store that holds one — and does it in gudang's exact shape, which
     is the point of the fixture. */
  function sewaKunci(db) {
    return (root.SEROBOT_DB && root.SEROBOT_DB.SEWA) ? root.SEROBOT_DB.SEWA : 'SEWA-FIKTIF-01';
  }

  function txSelesai(t, out) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(out()); };
      t.onerror = function (ev) {
        var e = null;
        try { e = ev && ev.target ? ev.target.error : null; } catch (x) { e = null; }
        reject(e || KODE.refuse('E_DB_TIADA', 'lease transaction error'));
      };
      t.onabort = function (ev) {
        var e = null;
        try { e = ev && ev.target ? ev.target.error : null; } catch (x) { e = null; }
        reject(e || KODE.refuse('E_DB_TIADA', 'lease transaction aborted'));
      };
    });
  }

  NS.sewaLihat = function (db) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction('sewa', 'readonly');
      var g = t.objectStore('sewa').get(sewaKunci(db));
      var v = null;
      g.onsuccess = function () { v = g.result ? g.result.v : null; };
      txSelesai(t, function () { return v; }).then(resolve, reject);
    });
  };

  /* THE GUDANG SHAPE. Read and write the lease record inside ONE readwrite
     transaction, with nothing between them that could reach the event loop.
     `now` is an integer this lab issues, never a clock: a fixture whose result
     depends on how fast the machine ran it is a fixture that reports the
     machine. */
  NS.sewaAmbil = function (db, who, now) {
    KODE.kunciUrut(now);
    return new Promise(function (resolve, reject) {
      var t = db.transaction('sewa', 'readwrite');
      var os = t.objectStore('sewa');
      var g = os.get(sewaKunci(db));
      var out = { ok: false, holder: '', at: 0, ttl: NS.SEWA_TTL, token: 0, why: '' };
      g.onsuccess = function () {
        var rec = g.result || { k: sewaKunci(db), v: { holder: '', at: 0, ttl: NS.SEWA_TTL, token: 0 } };
        var v = rec.v || { holder: '', at: 0, ttl: NS.SEWA_TTL, token: 0 };
        var free = !v.holder || (now - v.at) >= v.ttl;
        if (!free) {
          out.ok = false; out.holder = String(v.holder); out.at = v.at | 0;
          out.ttl = v.ttl | 0; out.token = v.token | 0; out.why = 'held';
          return;
        }
        out.ok = true;
        out.holder = String(who);
        out.at = now;
        out.ttl = v.ttl | 0;
        out.token = (v.token | 0) + 1;
        out.why = v.holder ? 'lapsed' : 'free';
        os.put({ k: sewaKunci(db), v: { holder: out.holder, at: out.at, ttl: out.ttl, token: out.token } });
      };
      txSelesai(t, function () { return out; }).then(resolve, reject);
    });
  };

  /* THE FENCING TOKEN, and the thing gudang has none of. A lease that lapses
     under a holder who is frozen but alive leaves two parties both believing
     they hold it; the token is what lets the resource tell them apart. A stale
     one is refused, synchronously, by name. */
  NS.pagar = function (token, terkini) {
    KODE.rupiah(token, 'fencing token');
    KODE.rupiah(terkini, 'current token');
    if (token < terkini) {
      throw KODE.refuse('E_SEWA_KEDALUWARSA', 'a write arrived carrying a lease token that has been superseded');
    }
    return token;
  };

  /* Both columns of the §3.4 table, executed rather than described: a lease
     taken, the same lease taken by somebody else once it has lapsed, and the
     first holder — alive the whole time, and still believing — refused. */
  NS.sewaDemo = function (db, now) {
    var t0 = KODE.bulat(now) ? now : 1;
    var out = { pertama: null, kedua: null, basi: '', ok: false };
    return NS.sewaAmbil(db, 'AGEN-FIKTIF-A', t0).then(function (a) {
      out.pertama = a;
      /* The first holder is never told. It is not dead, it is slow. */
      return NS.sewaAmbil(db, 'AGEN-FIKTIF-B', t0 + NS.SEWA_TTL);
    }).then(function (b) {
      out.kedua = b;
      try {
        NS.pagar(out.pertama.token, out.kedua.token);
      } catch (e) {
        out.basi = KODE.nameOf(e);
      }
      out.ok = out.pertama.ok === true && out.kedua.ok === true &&
        out.kedua.why === 'lapsed' && out.basi === 'E_SEWA_KEDALUWARSA';
      return out;
    });
  };

  /* --------------------------------------------------------- the audit */

  /* GUDANG'S SHAPE UNDER CONTENTION. W contenders, all released by the same
     rendezvous, each running the transcribed single-transaction take. The
     specification requires read-write transactions with overlapping scope to
     start in creation order and not run concurrently, so exactly one of them
     can find the record free. The comment quoted above is correct, and this is
     the first time anything in this repository has measured it. */
  NS.auditGudang = function (db, W, opts) {
    var o = opts || {};
    var now = KODE.bulat(o.now) ? o.now : 1;
    var hadang = typeof o.barrier === 'function' ? o.barrier : function () { return Promise.resolve(null); };
    var out = { W: W, winners: 0, holder: '', token: 0, hasil: [], ok: false };
    var jobs = [], i;

    if (!KODE.bulat(W) || W < 1) return Promise.reject(KODE.refuse('E_MODE', 'W must be a positive integer'));

    function one(w) {
      return hadang(w).then(function () {
        return NS.sewaAmbil(db, 'AGEN-FIKTIF-' + w, now);
      }).then(function (r) {
        return { w: w, ok: !!r.ok, why: String(r.why), token: r.token | 0 };
      });
    }
    for (i = 0; i < W; i++) jobs.push(one(i + 1));

    return Promise.all(jobs).then(function (rows) {
      var k;
      out.hasil = rows;
      for (k = 0; k < rows.length; k++) if (rows[k].ok) out.winners++;
      return NS.sewaLihat(db);
    }).then(function (v) {
      out.holder = String(v && v.holder ? v.holder : '');
      out.token = (v && v.token) | 0;
      out.ok = out.winners === 1 && out.token === 1;
      return out;
    });
  };

  /* SAKU'S SHAPE UNDER CONTENTION. peerGet in a readonly transaction, the seen
     check between the two, peerPut in a later readwrite one — character for
     character the shape the centrepiece loses updates with, and here it loses
     the deduplication instead of the money. Under the rendezvous every delivery
     reads before any delivery writes, so every delivery sees an empty `seen`
     and every one of them is applied: applied === W where 1 was intended.

     STATED AT THE RIGHT SIZE, here and on the page and in the README: the real
     drain() applies operations through a strictly sequential reduce, so within
     one drain these calls never overlap. Two overlapping drains would reach it.
     This reproduces the shape and shows what it costs. It does not claim that
     file loses data today, and no live path that does was found. */
  NS.auditSaku = function (db, W, opts) {
    var o = opts || {};
    var hadang = typeof o.barrier === 'function' ? o.barrier : function () { return Promise.resolve(null); };
    var idem = String(o.idem || 'IDEM-FIKTIF-0002');
    var out = { W: W, applied: 0, absorbed: 0, seen: 0, intended: 1, ok: false };
    var jobs = [], i;

    if (!KODE.bulat(W) || W < 1) return Promise.reject(KODE.refuse('E_MODE', 'W must be a positive integer'));

    function peerGet() {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('sewa', 'readonly');
        var g = t.objectStore('sewa').get(NS.PEER);
        var v = null;
        g.onsuccess = function () { v = g.result ? g.result.v : null; };
        txSelesai(t, function () { return v || { seen: [], applied: 0 }; }).then(resolve, reject);
      });
    }
    function peerPut(rec) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('sewa', 'readwrite');
        t.objectStore('sewa').put({ k: NS.PEER, v: rec });
        txSelesai(t, function () { return rec; }).then(resolve, reject);
      });
    }

    function one(w) {
      return hadang(w).then(function () {
        return peerGet();
      }).then(function (rec) {
        if (rec.seen.indexOf(idem) >= 0) { out.absorbed++; return 'duplicate-absorbed'; }
        rec.seen.push(idem);
        if (rec.seen.length > 50) rec.seen = rec.seen.slice(-50);
        rec.applied = (rec.applied | 0) + 1;
        out.applied++;
        return peerPut(rec).then(function () { return 'applied'; });
      });
    }

    return peerPut({ seen: [], applied: 0 }).then(function () {
      for (i = 0; i < W; i++) jobs.push(one(i + 1));
      return Promise.all(jobs);
    }).then(function () {
      return peerGet();
    }).then(function (rec) {
      out.seen = rec.seen.length;
      out.ok = out.applied === W && out.absorbed === 0;
      return out;
    });
  };

  /* The live bodies, for the page to print. What is on screen is what ran:
     there is no build step in this repository. */
  NS.sumberAudit = function (which) {
    if (which === 'gudang') return String(NS.sewaAmbil);
    if (which === 'saku') return String(NS.auditSaku);
    throw KODE.refuse('E_MODE', 'unknown audit shape');
  };

  root.SEROBOT_KUNCI = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
