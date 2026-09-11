/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — pantau.js
 * THE OBSERVATION DECK. Three jobs, and they belong together because all three
 * are about watching something this lab does not control.
 *
 * 1. WHAT THIS BROWSER WILL NOT DO, read live. crossOriginIsolated, the absent
 *    SharedArrayBuffer, Atomics member by member, hardwareConcurrency,
 *    deviceMemory, visibilityState, the user agent. A senior reader types
 *    crossOriginIsolated into their console within twenty seconds of arriving,
 *    so the page leads with the answer instead of being caught by it. None of
 *    it is transcribed and none of it is asserted: the suite asserts the LAB'S
 *    REACTION to these values, never the values.
 *
 * 2. HOW RESPONSIVE THE PAGE STAYED, on requestAnimationFrame and never on
 *    setInterval. This matters and it is measured, not assumed: a setInterval
 *    gap detector reports ZERO for a real seven-hundred-millisecond block,
 *    because its callback cannot fire during the block and clearing the timer
 *    in the same synchronous turn discards the late tick. A monitor that cannot
 *    see the thing it exists to see is worse than no monitor, because it ships
 *    a number. Every reading is printed and none is asserted — a threshold on a
 *    frame gap is a timing pin, and this repository has a standing rule against
 *    those.
 *
 * 3. THE WRITER SQUAD. Spawning the workers, wiring the three error channels a
 *    worker can fail through, driving the rendezvous, folding every worker's
 *    own egress count into the page's, and terminating on every exit path.
 *
 * WHY THE SQUAD IS HERE AND NOT IN THE WORKER FILE OR IN arms.js. §4 gives the
 * page-side spawn to app.js and the barrier client to arms.js, and leaves the
 * thing in between unnamed. It cannot live in arms.js: that file is
 * importScripts'd into the worker realm and must stay free of any timer name,
 * and a squad needs a watchdog. It cannot live in the worker: the worker is one
 * writer and has no view of the others. It cannot live in app.js: then the
 * suite could not drive it without touching the DOM. So it lives beside the
 * other two things on this page that watch a process nobody here controls.
 *
 * THREE ERROR CHANNELS, ALL WIRED, BECAUSE EACH IS INVISIBLE TO THE OTHER TWO —
 * every one of these was measured on this repository's own CI route:
 *
 *   - a synchronous throw inside a worker fires worker.onerror AND reaches
 *     page.on('pageerror'). ev.preventDefault() inside onerror suppresses the
 *     second. A sibling lab in this repository sets onerror without it and
 *     therefore ships a latent red build that fires only if its worker throws.
 *   - an unhandled promise rejection inside a worker does NOT fire
 *     worker.onerror and does NOT fire an in-page unhandledrejection listener.
 *     It reaches page.on('pageerror') and nothing else. The worker handles it
 *     itself and posts it back as data.
 *   - a value that fails to clone on receive fires onmessageerror and nothing
 *     else. Nobody wires it. It is wired here.
 *
 * AND THE EGRESS FOLD, which is the larger claim this lab makes and its
 * siblings do not. A Content-Security-Policy delivered through a meta element
 * covers the DOCUMENT and not a dedicated worker's global scope: measured, a
 * fetch from inside a worker RESOLVES under connect-src 'none', silently, and
 * the page's counter cannot see it. So the page total is the page's own count
 * PLUS every worker's reported count, folded in through the guard's own
 * noteExternal, and that sum is what gets reported. No page and no worker in
 * this lab ever attempts egress; the arithmetic is what is asserted.
 *
 * DOM: reads document.visibilityState and requestAnimationFrame behind typeof
 * checks. Writes nothing. No storage.
 */
/* global SEROBOT_KODE, SEROBOT_ARMS, SEROBOT_GUARD, SEROBOT_KUNCI */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var NS = {};

  function ARMS() { return root.SEROBOT_ARMS; }
  function GUARD() { return root.SEROBOT_GUARD; }
  function KUNCI() { return root.SEROBOT_KUNCI; }

  /* --------------------------------------------------- what this machine is */

  NS.clamp = function (hc) {
    var lo = (KODE && KODE.ANGKA) ? KODE.ANGKA.clampMin : 2;
    var hi = (KODE && KODE.ANGKA) ? KODE.ANGKA.clampMax : 8;
    var v = KODE.bulat(hc) ? hc : lo;
    return Math.max(lo, Math.min(hi, v));
  };

  NS.mesin = function () {
    var nav = null, doc = null;
    try { nav = root.navigator || null; } catch (e) { nav = null; }
    try { doc = (typeof root.document !== 'undefined') ? root.document : null; } catch (e2) { doc = null; }
    var hc = (nav && KODE.bulat(nav.hardwareConcurrency)) ? nav.hardwareConcurrency : 0;
    return {
      crossOriginIsolated: (typeof root.crossOriginIsolated === 'boolean') ? root.crossOriginIsolated : false,
      sharedArrayBuffer: typeof root.SharedArrayBuffer,
      sharedWorker: typeof root.SharedWorker,
      worker: typeof root.Worker,
      isSecureContext: !!root.isSecureContext,
      hardwareConcurrency: hc,
      /* The raw value and the clamp, side by side. The clamp is asserted; the
         raw value never is. On a box reporting 1 the whole thesis would
         degenerate into a tautology — pisah === satu, nothing lost, every
         assertion green — and the clamp is the only thing standing between this
         lab and that outcome. */
      clampW: NS.clamp(hc),
      deviceMemory: (nav && typeof nav.deviceMemory === 'number') ? nav.deviceMemory : null,
      visibilityState: doc ? String(doc.visibilityState) : 'n/a',
      /* Asked of the lock helper, not of navigator, so that the grep proving
         one file in this lab issues lock requests still prints one path. */
      locks: !!(KUNCI() ? KUNCI().ada() : (nav && nav.locks)),
      indexedDB: !!root.indexedDB,
      ua: nav ? String(nav.userAgent || '').slice(0, 180) : ''
    };
  };

  /* Atomics is not inert here, and a reader with a console will check — so this
     probe has to survive being wrong about itself. Every call is wrapped, the
     number of members that returned a value is COUNTED from the probe rather
     than typed into it, and the size of the Atomics surface is read off the
     object instead of being remembered.

     The revision this replaced assigned that count as a literal 6 beside a
     table on the same card listing nine rows. Three things were wrong with it
     at once: the number disagreed with the table, no test could see the
     disagreement because the assertion compared the literal with itself, and a
     member that began refusing would have taken the whole capability line down
     with an uncaught throw instead of being reported as refusing — which is the
     one outcome this probe exists to report.

     The sequence below is why each number is what it is: add returns the OLD
     value, and so do compareExchange and exchange. */
  NS.atomik = function () {
    var out = {
      ada: typeof root.Atomics !== 'undefined',
      add: null, load: null, compareExchange: null, store: null,
      exchange: null, notify: null, isLockFree: null,
      wait: '', waitAsync: '',
      /* bekerja counts what returned a value, diprobe counts what was asked,
         and anggota is how many function members this Atomics actually carries.
         All three are derived. None of them is a remembered number. */
      bekerja: 0, diprobe: 0, anggota: 0
    };
    if (!out.ada) return out;
    var A = root.Atomics;
    var a = new Int32Array(new ArrayBuffer(8));
    var jalan = 0, dicoba = 0;
    function coba(nama, fn) {
      dicoba++;
      try { out[nama] = fn(); jalan++; }
      catch (e) { out[nama] = KODE.nameOf(e); }
    }
    coba('add', function () { return A.add(a, 0, 5) | 0; });                           /* old value: 0 */
    coba('load', function () { return A.load(a, 0) | 0; });                            /* 5 */
    coba('compareExchange', function () { return A.compareExchange(a, 0, 5, 3) | 0; });/* old value: 5 */
    coba('store', function () { return A.store(a, 0, 3) | 0; });                       /* 3 */
    coba('exchange', function () { return A.exchange(a, 0, 3) | 0; });                 /* old value: 3 */
    coba('notify', function () { return A.notify(a, 0, 1) | 0; });                     /* 0 — returns, does not throw */
    coba('isLockFree', function () { return !!A.isLockFree(4); });
    coba('wait', function () { A.wait(a, 0, 3, 0); return 'RESOLVED'; });
    coba('waitAsync', function () { A.waitAsync(a, 0, 3, 0); return 'RESOLVED'; });
    out.bekerja = jalan;
    out.diprobe = dicoba;
    try {
      var ks = Object.getOwnPropertyNames(A), n = 0, i;
      for (i = 0; i < ks.length; i++) { if (typeof A[ks[i]] === 'function') n++; }
      out.anggota = n;
    } catch (e2) { out.anggota = 0; }
    return out;
  };

  /* ------------------------------------------------- the responsiveness monitor */

  NS.rafAda = function () { return typeof root.requestAnimationFrame === 'function'; };

  /* The monitor is meant to run for as long as the page is open, so the sample
     buffer is bounded: at sixty frames a second an unbounded array is both a
     leak and, worse, a sort inside a render that would itself become a gap.
     The figures that must stay exact over the WHOLE session — the longest gap,
     the count over 100 ms, the frame count — are accumulated as they arrive and
     never read from the buffer. Only the percentiles come from samples, and
     they say so when the buffer has wrapped. */
  var SAMPEL = 12000;

  NS.rafMulai = function () {
    var h = { jalan: true, gaps: [], frames: 0, max: 0, over100: 0, dibuang: 0, ada: NS.rafAda() };
    if (!h.ada) return h;
    var last = null;
    function frame() {
      /* THE FORCED YIELD. Reading the clock inside the animation callback
         measures when the callback was scheduled. Reading it after a yield
         measures when the page actually got back to work, which is the thing a
         human notices. */
      Promise.resolve().then(function () {
        var t = root.performance ? root.performance.now() : 0;
        if (last !== null) {
          var d = t - last;
          h.gaps.push(d);
          if (h.gaps.length > SAMPEL) { h.gaps.shift(); h.dibuang = h.dibuang + 1; }
          if (d > h.max) h.max = d;
          if (d > 100) h.over100 = h.over100 + 1;
        }
        last = t;
        h.frames = h.frames + 1;
        if (h.jalan) root.requestAnimationFrame(frame);
      });
    }
    root.requestAnimationFrame(frame);
    return h;
  };

  function ringkas(h) {
    var out = { ada: !!(h && h.ada), frames: 0, max: 0, p95: 0, median: 0, over100: 0, sampel: 0, penuh: false };
    if (!h || !h.ada) return out;
    out.frames = h.frames | 0;
    out.max = Math.round(h.max);
    out.over100 = h.over100 | 0;
    var g = h.gaps.slice().sort(function (a, b) { return a - b; });
    out.sampel = g.length;
    out.penuh = (h.dibuang | 0) > 0;
    if (!g.length) return out;
    out.median = Math.round(g[Math.floor((g.length - 1) / 2)]);
    out.p95 = Math.round(g[Math.min(g.length - 1, Math.floor(g.length * 0.95))]);
    return out;
  }

  /* Read the monitor WITHOUT stopping it. A one-shot summary taken when the
     boot chain ends describes a session the visitor has not started yet, and a
     panel that then keeps calling it "every demonstration on this page" is
     claiming coverage of runs that were never measured. */
  NS.rafBaca = function (h) { return ringkas(h); };

  NS.rafSelesai = function (h) {
    if (h) h.jalan = false;
    return ringkas(h);
  };

  /* ------------------------------------------------------------ the squad */

  /* Every inbound message is REBUILT field by field. postMessage throws
     DataCloneError on an unclonable value, but the automation boundary this
     result eventually crosses corrupts silently instead — a Map and a Set both
     arrive as {}, which is indistinguishable from a legitimately empty object,
     and a function vanishes key and all. This lab crosses both seams, so
     nothing is trusted at either. */
  function bersih(m) {
    if (!m || typeof m !== 'object') return null;
    return {
      t: String(m.t == null ? '' : m.t),
      arm: String(m.arm == null ? '' : m.arm),
      r: m.r | 0,
      p: String(m.p == null ? '' : m.p),
      w: m.w | 0,
      kind: String(m.kind == null ? '' : m.kind),
      target: String(m.target == null ? '' : m.target).slice(0, 180),
      name: String(m.name == null ? '' : m.name),
      code: String(m.code == null ? '' : m.code),
      state: String(m.state == null ? '' : m.state),
      egress: m.egress | 0,
      /* Two facts about the REPORT, kept separate from the number it carries.
         `egress: m.egress | 0` turns a worker that stopped reporting into a
         worker that reported nothing to report, which is the same shape of
         silence this lab exists to name. `lapor` is whether a number arrived at
         all; `jaga` is whether the realm that sent it was being counted. Both
         were measured invisible to the whole suite before they existed. */
      lapor: (typeof m.egress === 'number' && isFinite(m.egress)) ? 1 : 0,
      jaga: m.jaga | 0
    };
  }

  function timerOf(o) {
    return typeof o.timer === 'function' ? o.timer : function (cb, ms) { return root.setTimeout(cb, ms); };
  }
  function untimerOf(o) {
    return typeof o.untimer === 'function' ? o.untimer : function (id) { return root.clearTimeout(id); };
  }

  /* Squads are SERIALISED, never shared and never concurrent.

     Measured on this repository's own runner: the badge run starts on boot and
     the automated run evaluates the entry point immediately after load, so two
     runs overlap BY CONSTRUCTION. A sibling lab survives that because its runs
     are pure compute over independent instances. This one shares a database
     name, named locks and a worker pool — and when two of these runs did
     overlap, one run's deleteDatabase fired onversionchange on the other's
     connection, that connection closed itself, and the other run's next
     transaction died with InvalidStateError fifty writes into four hundred.
     Reproduced here before this queue was written.

     THE FIRST DESIGN OF THIS FUNCTION WAS A SINGLE-FLIGHT LATCH — the second
     caller receives the first caller's promise — and it was WRONG AT THIS
     LEVEL. Measured: two runs issued together, each with its own run-scoped
     database, and the second one received the first one's squad result while
     its own database sat untouched, which the witness then correctly refused
     for having no rows. A latch is right where both callers want THE SAME RUN,
     which is the suite entry point one level up. Down here the two callers may
     legitimately want different configurations, so what they need is a queue:
     nobody waits on the wrong answer, and no two squads are ever alive at once.
     puncak() is that claim as a number rather than as a sentence. */
  var rantai = Promise.resolve(null);
  var antre = 0;
  var aktif = 0;
  var puncak = 0;

  NS.reguSibuk = function () { return aktif > 0; };
  NS.reguAntre = function () { return antre; };
  NS.reguPuncak = function () { return puncak; };
  NS.reguReset = function () { puncak = 0; return puncak; };

  NS.regu = function (opts) {
    var o = opts || {};
    /* The refusals stay SYNCHRONOUS, before anything is queued. A rejected
       promise handed to a synchronous throws() helper is recorded as "did not
       throw" and then dropped, and a dropped rejection is a page error. */
    periksa(o);
    antre++;
    var p = rantai.then(function () { return null; }, function () { return null; })
      .then(function () {
        antre--;
        aktif++;
        if (aktif > puncak) puncak = aktif;
        return mulai(o).then(function (r) { aktif--; return r; }, function (e) { aktif--; throw e; });
      });
    rantai = p.then(function () { return null; }, function () { return null; });
    return p;
  };

  function periksa(o) {
    if (typeof root.Worker !== 'function') {
      throw KODE.refuse('E_MODE', 'this realm has no Worker constructor');
    }
    if (!ARMS()) throw KODE.refuse('E_MODE', 'the arm switch is not loaded');
    if (o.mode === 'hadang' && !(KODE.bulat(o.W) && o.W > 0)) {
      throw KODE.refuse('E_MODE', 'barrier mode needs a positive integer writer count');
    }
  }

  function mulai(o) {
    var A = ARMS();

    var W = (KODE.bulat(o.W) && o.W > 0) ? o.W : 2;
    var n = (KODE.bulat(o.n) && o.n > 0) ? o.n : 1;
    var mode = o.mode === 'hadang' ? 'hadang' : 'lepas';
    var url = String(o.url || 'kerja.worker.js');
    var arms = [];
    var i;
    for (i = 0; i < (o.arms || ['pisah', 'satu', 'jurnal']).length; i++) {
      arms.push(String((o.arms || ['pisah', 'satu', 'jurnal'])[i]));
    }
    var budget = (KODE.bulat(o.budget) && o.budget > 0) ? o.budget : 30000;
    var timer = timerOf(o);
    var untimer = untimerOf(o);

    var out = {
      mode: mode, W: W, n: n, arms: arms,
      spawned: 0, done: 0, released: 0, open: 0,
      egress: 0, lapor: 0, jaga: 0, msgerr: 0, terminated: 0,
      errs: [], urj: [], why: 'ok', ok: false
    };

    var ws = [];
    var settled = false;
    var watchdog = null;

    function kirim(msg) {
      var k;
      for (k = 0; k < ws.length; k++) {
        try { ws[k].postMessage(msg); } catch (e) { /* a terminated worker is not an error here */ }
      }
    }

    var coord = (mode === 'hadang') ? A.coord(W, kirim) : null;

    function bersihkan() {
      var k;
      if (watchdog !== null) { untimer(watchdog); watchdog = null; }
      for (k = 0; k < ws.length; k++) {
        try { ws[k].terminate(); out.terminated++; } catch (e) { /* already gone */ }
      }
      ws = [];
    }

    return new Promise(function (resolve) {
      function selesai(why) {
        if (settled) return;
        settled = true;
        out.why = String(why || 'ok');
        if (coord) { out.released = coord.released(); out.open = coord.open(); }
        out.ok = out.why === 'ok' && out.done === W && out.errs.length === 0 &&
          out.urj.length === 0 && out.msgerr === 0;
        /* TERMINATE ON EVERY EXIT PATH. A leaked worker holds an IndexedDB
           connection, and an open connection makes the next run's
           deleteDatabase hang forever behind it with onblocked firing and
           onsuccess never doing so. */
        bersihkan();
        resolve(out);
      }

      function pesan(ev) {
        var m = bersih(ev.data);
        if (!m) { out.msgerr++; return; }
        if (m.t === 'tiba') { if (coord) coord.tiba(m); return; }
        if (m.t === 'net') {
          /* The fold. Counted through the guard's own entry point rather than
             written into its counters from outside, so the page's arithmetic
             and the worker's arithmetic are the same arithmetic. */
          var g = GUARD();
          if (g && typeof g.noteExternal === 'function') g.noteExternal(m.kind, m.target, 'worker');
          return;
        }
        if (m.t === 'err') { out.errs.push({ arm: m.arm, name: m.name, code: m.code, w: m.w }); return; }
        if (m.t === 'urj') { out.urj.push({ name: m.name, code: m.code, w: m.w }); return; }
        if (m.t === 'done') {
          out.egress = out.egress + m.egress;
          out.lapor = out.lapor + m.lapor;
          out.jaga = out.jaga + m.jaga;
          out.done = out.done + 1;
          if (out.done >= W) selesai('ok');
          return;
        }
      }

      var k;
      for (k = 0; k < W; k++) {
        var w = new root.Worker(url);
        /* preventDefault, measured: without it a handled synchronous worker
           throw still reaches the automation boundary as a page error and the
           build goes red with every assertion green. */
        w.onerror = function (ev) {
          try { ev.preventDefault(); } catch (e) { }
          out.errs.push({ arm: '', name: 'WorkerError', code: 'E_MODE', w: 0 });
        };
        /* The only signal a clone failure on RECEIVE produces. Nobody wires it. */
        w.onmessageerror = function () { out.msgerr++; };
        w.onmessage = pesan;
        ws.push(w);
        out.spawned++;
      }

      for (k = 0; k < W; k++) {
        ws[k].postMessage({
          t: 'go',
          id: k + 1,
          n: n,
          arms: arms,
          barrier: mode === 'hadang',
          db: String(o.db || ''),
          lockPrefix: String(o.lockPrefix || ''),
          runId: String(o.runId || ''),
          /* Asks each worker to put ONE fabricated attempt through its own
             guard, so that the fold below is exercised rather than described.
             No request is made by it. Only the suite ever sets this. */
          uji: !!o.uji
        });
      }

      /* The squad's own ceiling, so a lost message becomes a report rather than
         a job that hangs to the runner's cap with no diagnostic. Every await
         underneath it carries its own shorter deadline, so this should never be
         the thing that fires — and if it does, what it records is a budget
         being exceeded and never a correctness claim. */
      watchdog = timer(function () { selesai('E_HADANG_MATI'); }, budget);
    });
  }

  /* --------------------------------------------- one worker, holding a lock */

  /* clientId is per-client and not per-request, so two queued requests from one
     document are indistinguishable in query()'s answer. The only way to put a
     labelled queue on screen is to give every queued participant its own
     worker, which is what this is for. */
  NS.penjaga = function (opts) {
    var o = opts || {};
    if (typeof root.Worker !== 'function') {
      return Promise.reject(KODE.refuse('E_MODE', 'this realm has no Worker constructor'));
    }
    var url = String(o.url || 'kerja.worker.js');
    var name = String(o.name || 'antre');
    var w = new root.Worker(url);
    var rec = { name: name, held: false, gagal: '', mati: false };

    return new Promise(function (resolve, reject) {
      var done = false;
      w.onerror = function (ev) {
        try { ev.preventDefault(); } catch (e) { }
        if (!done) { done = true; try { w.terminate(); } catch (e2) { } reject(KODE.refuse('E_KUNCI_TIADA', 'the guard worker failed')); }
      };
      w.onmessageerror = function () { };
      w.onmessage = function (ev) {
        var m = bersih(ev.data);
        if (!m || m.t !== 'kunci') return;
        if (m.state === 'held' && !done) {
          done = true;
          rec.held = true;
          rec.lepas = function () {
            try { w.postMessage({ t: 'kunci-lepas' }); } catch (e) { }
            return rec;
          };
          rec.matikan = function () {
            try { w.terminate(); } catch (e) { }
            rec.mati = true;
            return rec;
          };
          resolve(rec);
        }
        if (m.state === 'failed' && !done) {
          done = true;
          rec.gagal = m.name;
          try { w.terminate(); } catch (e) { }
          reject(KODE.refuse('E_KUNCI_TIADA', 'the guard worker could not take the lock'));
        }
      };
      w.postMessage({
        t: 'kunci-tahan',
        name: name,
        lockPrefix: String(o.lockPrefix || '')
      });
    });
  };

  /* A worker holds a lock; query() sees it; terminate() releases it. The second
     half is a BOUNDED POLL and its deadline is printed rather than asserted:
     there is no specified synchronisation point between terminate() returning
     and the lock being released, so an assertion on the first poll would be an
     assertion about how fast this machine got round to it. */
  NS.antreanPekerja = function (opts) {
    var o = opts || {};
    var K = KUNCI();
    if (!K) return Promise.reject(KODE.refuse('E_KUNCI_TIADA', 'the lock helper is not loaded'));
    var budget = (KODE.bulat(o.budget) && o.budget > 0) ? o.budget : 2000;
    var step = (KODE.bulat(o.step) && o.step > 0) ? o.step : 25;
    var timer = timerOf(o);
    var full = String(o.lockPrefix || '') + String(o.name || 'antre');
    var out = { name: full, hidup: 0, mati: 0, tries: 0, budget: budget, ok: false };
    var g = null;

    return NS.penjaga(o).then(function (rec) {
      g = rec;
      return K.lihat();
    }).then(function (snap) {
      out.hidup = K.hitung(snap, full).held;
      g.matikan();
      return new Promise(function (resolve) {
        var spent = 0;
        function poll() {
          K.lihat().then(function (s) {
            var c = K.hitung(s, full);
            if (c.held === 0 || spent >= budget) {
              out.mati = c.held;
              resolve(null);
              return;
            }
            out.tries++;
            spent = spent + step;
            timer(poll, step);
          });
        }
        poll();
      });
    }).then(function () {
      out.ok = out.hidup === 1 && out.mati === 0;
      return out;
    });
  };

  root.SEROBOT_PANTAU = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
