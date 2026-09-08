/*!
 * Payroll — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Payroll — app.js
 * The UI. Eleven panels, one live region, one render function per panel, and a
 * focus discipline that survives a full teardown on every keystroke.
 *
 * THREE THINGS THIS FILE EXISTS TO GET RIGHT, all of them learned from bugs
 * this site has already shipped once:
 *
 * 1. FOCUS. Every state change tears the whole panel down and rebuilds it. At
 *    the instant of teardown document.activeElement is <body>, so the focused
 *    control's stable key is captured BEFORE and restored AFTER, caret position
 *    included. Numeric fields commit on `input`, never on `change`: `change`
 *    fires while the browser is transferring focus away, the handler
 *    re-renders, the button the user was clicking is destroyed between
 *    mousedown and mouseup, and the click is swallowed.
 *
 * 2. NO HORIZONTAL OVERFLOW AT 390px, WITH DATA PRESENT. Every table lives
 *    inside its own `overflow-x:auto` wrapper and every grid track carries
 *    min-width:0, because a grid track defaults to min-width:auto and a wide
 *    table escapes its wrapper through it. A sibling lab passed an empty-panel
 *    check and still blew out to 846px the moment one row existed.
 *
 * 3. THE INVARIANTS ARE RECOMPUTED, NOT REMEMBERED. The badge in the header
 *    re-derives every invariant from the raw payslip records held in the runs
 *    on every state change. It never reads a cached total, so it can catch the
 *    app disagreeing with itself.
 */
(function () {
  'use strict';

  var D = window.PAYROLL_DOMAIN;
  var T = window.PAYROLL_PAJAK;
  var P = window.PAYROLL_ENGINE;
  var S = window.PAYROLL_SEED;
  var St = window.PAYROLL_STORE;
  var UJI = window.PAYROLL_TESTS;

  /* ------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag), i, k;
    if (attrs) {
      for (k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  /* textContent = '' detaches every child in one operation. The obvious
   * while(firstChild) removeChild loop is NOT equivalent: removing a FOCUSED
   * input fires blur synchronously, the blur handler re-renders, and the loop
   * then tries to remove a node that is no longer its child and throws. */
  function clear(el) { el.textContent = ''; }

  function tableOf(headers, rows, opts) {
    opts = opts || {};
    var thead = h('tr');
    headers.forEach(function (x) {
      thead.appendChild(h('th', {
        class: x.num ? 'num' : (x.cls || null),
        scope: 'col',
        title: x.title || null,
        text: x.label !== undefined ? x.label : x
      }));
    });
    var tb = h('tbody');
    rows.forEach(function (r) { if (r) tb.appendChild(r); });
    var tbl = h('table', { style: opts.minWidth ? 'min-width:' + opts.minWidth : null }, h('thead', null, thead), tb);
    return h('div', { class: 'tbl-wrap' + (opts.mini ? ' mini-tabel' : '') }, tbl);
  }

  function field(label, control, cls) {
    return h('label', { class: 'field' + (cls ? ' ' + cls : '') }, h('span', { text: label }), control);
  }

  function select(options, value, onchange, attrs) {
    var sel = h('select', attrs || {});
    options.forEach(function (o) {
      sel.appendChild(h('option', { value: o.value, selected: String(o.value) === String(value) ? true : null, text: o.label }));
    });
    sel.addEventListener('change', function () { onchange(sel.value); });
    return sel;
  }

  /* The numeric fields, and the two things they have to get right.
   *
   * 1. COMMIT ON `input`, NEVER ON `change`. See the file header. A sibling lab
   *    committed numeric fields on `change` and Tab out of any amount box
   *    dumped the user back at the skip link.
   *
   * 2. type="text" WITH inputmode="numeric", not type="number". Every keystroke
   *    re-renders the panel, so the caret has to be restored afterwards — and
   *    Chromium throws on selectionStart/setSelectionRange for
   *    input[type=number]. With a number field the caret silently returned to
   *    position 0 and typing "30" produced 3. A text field with a numeric
   *    inputmode still raises the numeric keypad on a phone, and the min/max
   *    semantics were never a control anyway: the clamp lives in the handler
   *    and is enforced again at posting time.
   *
   * While a field is being edited its raw text is kept, so clearing it to type
   * a new figure does not fight a re-render that has already written "0" back —
   * unless the model clamped the value, in which case the clamped figure wins
   * and is shown, because a box displaying 999 while the app holds 6 is lying.
   */
  var editRaw = { key: null, text: '' };

  function numInput(value, onchange, attrs) {
    var a = attrs || {};
    var key = a['data-fkey'] || null;
    a.type = 'text';
    a.inputmode = 'numeric';
    a.autocomplete = 'off';
    a.class = 'nilai-input' + (a.sempit ? ' sempit' : '');
    delete a.sempit;
    var tampil = String(value);
    if (key && editRaw.key === key) {
      var mentah = editRaw.text;
      var angka = parseInt(mentah, 10);
      if (mentah === '' || (!isNaN(angka) && String(angka) === String(value))) tampil = mentah;
      else editRaw = { key: null, text: '' };
    }
    a.value = tampil;
    var el = h('input', a);
    el.addEventListener('input', function () {
      if (key) editRaw = { key: key, text: el.value };
      onchange(el.value);
    });
    el.addEventListener('blur', function () {
      if (key && editRaw.key === key) editRaw = { key: null, text: '' };
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      var langkah = parseInt(a.step, 10);
      if (!langkah || isNaN(langkah)) langkah = 1;
      var kini = parseInt(el.value, 10);
      if (isNaN(kini)) kini = 0;
      var baru = kini + (ev.key === 'ArrowUp' ? langkah : -langkah);
      if (key) editRaw = { key: key, text: String(baru) };
      onchange(String(baru));
    });
    return el;
  }

  function kelasUang(n, jenis) {
    if (n === 0) return 'nol';
    if (jenis) return jenis;
    return n < 0 ? 'minus' : 'plus';
  }
  function rp(n, cls) { return h('span', { class: 'rp ' + (cls || ''), text: D.rupiah(n) }); }
  function td(v, cls) { return h('td', { class: cls || null }, typeof v === 'string' || typeof v === 'number' ? String(v) : v); }
  function tdNum(v, cls) { return h('td', { class: 'num ' + (cls || ''), text: typeof v === 'number' ? D.angka(v) : String(v) }); }
  function tdRp(n, cls) { return h('td', { class: 'num ' + (cls || ''), text: D.rupiah(n) }); }

  var sayTimer = null;
  function say(text) {
    var el = $('say');
    if (!el || !text) return;
    el.textContent = '';
    if (sayTimer) clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { el.textContent = text; }, 40);
  }

  function fkey(s) { return String(s).replace(/["'\\]/g, '_'); }

  function captureFocus() {
    var el = document.activeElement;
    if (!el || el === document.body || !el.getAttribute) return null;
    var key = el.getAttribute('data-fkey');
    if (!key) return null;
    var snap = { key: key };
    try {
      if (el.selectionStart !== undefined && el.selectionStart !== null) {
        snap.selStart = el.selectionStart; snap.selEnd = el.selectionEnd;
      }
    } catch (e) { /* selectionStart throws on number inputs in some engines */ }
    return snap;
  }

  /* Where focus goes when the control that had it no longer exists. Activating
   * a row button or a per-line action removes the very element that was
   * focused; without a fallback the user lands on <body> and re-Tabs from the
   * skip link. The anchor is the control the next action needs anyway. */
  var FOKUS_ANCHOR = {
    karyawan: 'kar:cari', absensi: 'abs:karyawan', cuti: 'cuti:karyawan',
    run: 'run:bulan', slip: 'slip:karyawan', pph: 'pph:karyawan',
    bpjs: 'bpjs:upah', thr: 'thr:cari', laporan: 'lap:bulan'
  };

  function restoreFocus(snap) {
    if (!snap) return;
    var el = null;
    try { el = document.querySelector('[data-fkey="' + snap.key + '"]'); } catch (e) { el = null; }
    if (!el) {
      var anchor = FOKUS_ANCHOR[state.view];
      if (anchor) { try { el = document.querySelector('[data-fkey="' + anchor + '"]'); } catch (e0) { el = null; } }
      if (!el) el = $('panel-' + state.view);
      if (el) { try { el.focus({ preventScroll: true }); } catch (e1) { try { el.focus(); } catch (e1b) { } } }
      return;
    }
    try { el.focus({ preventScroll: true }); } catch (e2) { try { el.focus(); } catch (e3) { return; } }
    if (snap.selStart !== undefined) {
      try { el.setSelectionRange(snap.selStart, snap.selEnd); } catch (e4) { /* not a text input */ }
    }
  }

  /* --------------------------------------------------------------- state */

  var state = {
    db: null,
    ctx: null,
    runs: {},
    /* Default role is the payroll officer, because that is whose screen this
     * mostly is. The role picker sits in the context bar and every refusal
     * names the role that would be allowed, with a button to become it. */
    peran: 'payroll',
    view: 'beranda',
    tests: null,
    periksa: null,
    pesan: null,
    fokusKe: null,
    diedit: {},           /* nip -> 1, master-data rows the user changed */
    runDisimpan: false,   /* has the run history been frozen to storage yet */
    audit: [],            /* newest first; written by audit(), read by the Payroll Run tab */
    sel: {
      karyawan: null, cariKaryawan: '', divisi: '', urut: 'nip',
      bulan: 12, runId: null, slipNip: null, slipBulan: 12,
      pphNip: null, pphSim: null,
      bpjsUpah: 10000000, bpjsKelas: 'III',
      absNip: null, absBulan: 1,
      cutiNip: null, cutiHari: 1, cutiOverride: false,
      lapBulan: 12, lapMode: 'divisi'
    }
  };

  function ctx() { return state.ctx; }
  function cfg() { return state.ctx.cfg; }
  function emp(nip) { return state.ctx.byNip[nip]; }
  function runIds() { return Object.keys(state.runs).sort(); }
  function runOf(y, m, jenis) { return state.runs[P.runId(y, m, jenis || 'reguler')] || null; }

  function invalidate() { state.periksa = null; }

  /* The live cross-check. Recomputed from the raw payslip records, never from a
   * cached total, so it is capable of catching the app disagreeing with itself.
   * Memoised only until the next mutation. */
  function periksaHidup() {
    if (state.periksa) return state.periksa;
    try { state.periksa = P.periksa(state.ctx, state.runs); }
    catch (e) {
      state.periksa = {
        cek: [{ nama: 'pemeriksaan invarian melempar', ok: false, pesan: String(e && e.message || e) }],
        total: 1, gagal: 1, lulus: 0, slip: 0, run: 0, tahunLengkap: 0
      };
    }
    return state.periksa;
  }

  /* ------------------------------------------------------------- badges */

  function paintNet() {
    var g = window.PAYROLL_GUARD;
    var n = g ? g.total() : 0;
    $('netCount').textContent = 'panggilan jaringan: ' + n;
    $('netBadge').className = 'netbadge' + (n ? ' bad' : '');
  }

  function paintTests() {
    var b = $('testBadge'), t = $('testText');
    if (!state.tests) { b.className = 'testbadge busy'; t.textContent = 'uji: berjalan…'; return; }
    var r = state.tests;
    b.className = 'testbadge' + (r.failed ? ' bad' : '');
    t.textContent = r.failed ? ('uji: ' + r.failed + ' gagal') : ('uji: ' + r.passed + ' lulus');
  }

  function paintBuku() {
    var pr = periksaHidup();
    var b = $('bukuBadge'), t = $('bukuText');
    b.className = 'testbadge' + (pr.gagal ? ' bad' : '');
    t.textContent = 'invarian hidup: ' + pr.lulus + '/' + pr.total;
    b.title = 'Dihitung ulang dari ' + pr.slip + ' catatan slip gaji di ' + pr.run +
      ' run yang sedang dimuat, bukan dari total yang di-cache. Klik untuk rinciannya.';
  }

  function paintTheme() {
    var mode = document.documentElement.getAttribute('data-theme');
    var btn = $('themeBtn');
    btn.textContent = mode === 'dark' ? 'Terang' : 'Gelap';
    btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
    btn.title = mode === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap';
  }

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    St.writeLocal('payroll.theme', next);
    paintTheme();
  }

  /* --------------------------------------------------------- persistence */

  function audit(aksi, detail) {
    var rec = { aksi: aksi, peran: state.peran, detail: detail || '' };
    St.audit(rec);
    /* Mirrored in memory as well as written, so the trail is readable even
     * where IndexedDB is blocked and the app is running on the memory
     * fallback — which is exactly the session in which somebody is most likely
     * to want to know what they have done. */
    state.audit.unshift({ at: rec.at || Date.now(), aksi: aksi, peran: state.peran, detail: detail || '' });
    if (state.audit.length > 200) state.audit.length = 200;
  }

  function muatAudit() {
    return St.all('audit').then(function (rows) {
      var out = (rows || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      if (out.length) state.audit = out.slice(0, 200);
      return state.audit;
    }).catch(function () { return state.audit; });
  }

  function simpanKonfig() {
    St.put('konfig', { k: 'peran', v: state.peran });
    St.put('konfig', { k: 'cfg', v: { umk: cfg().umk, makanHarian: cfg().makanHarian, thrBulan: cfg().thrBulan, thrTanggal: cfg().thrTanggal } });
  }

  function simpanKaryawan(nip) {
    var e = emp(nip);
    state.diedit[nip] = 1;
    St.put('karyawan', {
      k: nip,
      v: { gajiPokok: e.gajiPokok, tunjanganTetap: e.tunjanganTetap, ptkp: e.ptkp, risiko: e.risiko, selesai: e.selesai }
    });
  }

  /* Freezing the run history. The demo runs are DERIVED from the seed, so on a
   * fresh load they are rebuilt from it — which is fine until somebody changes
   * a salary, because then a rebuild would retroactively rewrite eleven locked
   * payslips that were signed for. So the first time master data is touched,
   * every existing run is written to IndexedDB as it stands. After that the
   * history is a stored record rather than a function of the seed, which is
   * what a locked run is supposed to be. */
  /* `kecuali` names the run ids the CALLER is about to write itself. Without it
   * the freeze and that write race over one record: both hold the same live run
   * object, the freeze's IndexedDB put serialises it AFTER simpanRun has already
   * bumped its `rev`, so the stored revision equals the one being written and the
   * staleness guard refuses the caller's own write — a fresh profile's very first
   * "Hitung ulang" then reported "Tulisan ditolak oleh penyimpanan" and left the
   * run uncomputed. The derived history is what the freeze is for; the document
   * this action is posting belongs to the action. */
  function bekukanRun(kecuali) {
    if (state.runDisimpan) return Promise.resolve();
    state.runDisimpan = true;
    St.put('konfig', { k: 'runDibekukan', v: 1 });
    return simpanSemuaRun(kecuali);
  }

  /* The freeze writes the DERIVED runs to storage for the first time. It must
   * never blind-write a run id that is already stored: a record another tab
   * posted or locked is a fact, and a run rebuilt from the seed is a
   * derivation. The derivation never wins. */
  function simpanSemuaRun(kecuali) {
    var lewati = {};
    (kecuali || []).forEach(function (id) { lewati[id] = 1; });
    var ids = runIds(), p = [];
    for (var i = 0; i < ids.length; i++) {
      if (lewati[ids[i]]) continue;
      (function (id) {
        p.push(St.putGuarded('run', { k: id, v: state.runs[id] }, function (ada) { return !ada || !ada.v; })
          .then(function (res) {
            if (res && !res.ok && res.ada && res.ada.v) terapkanRunTersimpan(res.ada.v, true);
          }));
      })(ids[i]);
    }
    return Promise.all(p).catch(function () { });
  }

  /* WRITING ONE RUN IS A CHECKED OPERATION, not an assignment.
   *
   * The refusal is decided from the record IN STORAGE, inside the same
   * transaction that would do the write, because the tab's own copy of a run
   * proves nothing about what another tab has done to it since. Two rules:
   * a stored run that is `terkunci` may not be overwritten by anything except
   * the very act of locking it, and a stored run whose revision is ahead of
   * ours belongs to a tab that knows more than we do. Either way the stored
   * record wins, this tab adopts it, and the user is told — instead of a signed
   * December quietly becoming a draft with different money in it. */
  function simpanRun(run) {
    run.rev = (run.rev || 0) + 1;
    return St.putGuarded('run', { k: run.id, v: run }, function (ada) {
      if (!ada || !ada.v) return true;
      var t = ada.v;
      if (t.status === 'terkunci' && !(run.status === 'terkunci' && run.dikunciAt === t.dikunciAt && run.dikunciOleh === t.dikunciOleh)) return false;
      if ((t.rev || 0) >= (run.rev || 0) && (t.rev || 0) > 0) return false;
      return true;
    }).then(function (res) {
      if (res && res.ok) { siarkanRun(run.id); return true; }
      if (res && res.ada && res.ada.v) {
        terapkanRunTersimpan(res.ada.v, false);
        tolak('Tulisan ditolak oleh penyimpanan.',
          'Run ' + run.id + ' di IndexedDB sudah berubah — kemungkinan besar dari tab lain di peramban yang sama' +
          (res.ada.v.status === 'terkunci' ? ', dan kini berstatus TERKUNCI oleh ' + (res.ada.v.dikunciOleh || 'finance approver') : '') +
          '. Tab ini memakai catatan yang tersimpan itu, bukan menimpanya. Periksa angkanya sebelum menghitung ulang.');
        renderPanel(state.view);
        renderCtxBar();
      }
      return false;
    }).catch(function () { return false; });
  }

  /* Adopt a stored run over the in-memory one. `diam` for the freeze path,
   * which is expected to lose a race and has nothing to report. */
  function terapkanRunTersimpan(rec, diam) {
    if (!rec || !rec.id) return;
    state.runs[rec.id] = rec;
    invalidate();
    if (!diam) paintBuku();
  }

  /* Other tabs of this origin share one database, so they are told when a run
   * moves and re-read it rather than carrying on with a stale copy that the
   * next write would have to refuse. Wrapped: BroadcastChannel is absent in
   * older engines and throws where site data is blocked. */
  var kanal = null;
  try {
    if (window.BroadcastChannel) {
      kanal = new BroadcastChannel('payroll-run');
      kanal.onmessage = function (ev) {
        var id = ev && ev.data && ev.data.id;
        if (!id) return;
        St.get('run', id).then(function (rec) {
          if (!rec || !rec.v) return;
          terapkanRunTersimpan(rec.v, false);
          renderPanel(state.view);
          renderCtxBar();
          say('Run ' + id + ' diperbarui dari tab lain; tab ini memuat ulang catatan tersimpannya.');
        });
      };
    }
  } catch (e) { kanal = null; }
  function siarkanRun(id) {
    if (!kanal) return;
    try { kanal.postMessage({ id: id, at: Date.now() }); } catch (e) { }
  }

  function simpanCuti(rec) { return St.put('cuti', { k: rec.id, v: rec }).catch(function () { }); }

  function muat() {
    return Promise.all([St.all('karyawan'), St.all('run'), St.all('cuti'), St.all('konfig')])
      .then(function (res) {
        var kar = res[0] || [], runs = res[1] || [], cuti = res[2] || [], konf = res[3] || [];
        konf.forEach(function (r) {
          if (r.k === 'peran' && P.PERAN[r.v]) state.peran = r.v;
          if (r.k === 'runDibekukan') state.runDisimpan = true;
          if (r.k === 'cfg' && r.v) {
            if (D.isInt(r.v.umk)) cfg().umk = r.v.umk;
            if (D.isInt(r.v.makanHarian)) cfg().makanHarian = r.v.makanHarian;
            if (D.isInt(r.v.thrBulan)) cfg().thrBulan = r.v.thrBulan;
            if (r.v.thrTanggal) cfg().thrTanggal = r.v.thrTanggal;
          }
        });
        kar.forEach(function (r) {
          var e = emp(r.k);
          if (!e || !r.v) return;
          state.diedit[r.k] = 1;
          if (D.isInt(r.v.gajiPokok)) e.gajiPokok = r.v.gajiPokok;
          if (D.isInt(r.v.tunjanganTetap)) e.tunjanganTetap = r.v.tunjanganTetap;
          if (r.v.ptkp && D.PTKP[r.v.ptkp]) e.ptkp = r.v.ptkp;
          if (r.v.risiko && D.JKK_KELAS[r.v.risiko]) e.risiko = r.v.risiko;
          if (r.v.selesai !== undefined) e.selesai = r.v.selesai;
        });
        cuti.forEach(function (r) {
          if (!r.v) return;
          var ada = state.ctx.cuti.some(function (c) { return c.id === r.k; });
          if (!ada) state.ctx.cuti.push(r.v);
        });
        /* Stored runs REPLACE the derived ones for the same id. A run the user
         * posted or locked is a record; a run rebuilt from the seed is a
         * derivation, and the record wins. */
        runs.forEach(function (r) { if (r.v && r.v.id) state.runs[r.v.id] = r.v; });
        invalidate();
      })
      .catch(function () { /* storage unavailable: the derived company still runs */ });
  }

  /* ----------------------------------------------------------- messages */

  function tolak(judul, alasan) {
    state.pesan = { jenis: 'tolak', judul: judul, isi: alasan };
    say(judul + '. ' + alasan);
  }
  function sukses(judul, isi) {
    state.pesan = { jenis: 'ok', judul: judul, isi: isi || '' };
    say(judul + (isi ? '. ' + isi : ''));
  }
  function lupakanPesan() { state.pesan = null; }

  function renderPesan(p) {
    if (!state.pesan) return;
    var m = state.pesan;
    p.appendChild(h('div', { class: m.jenis === 'tolak' ? 'tolak' : 'terima-ok' },
      h('b', { text: m.judul + ' ' }), m.isi,
      ' ',
      h('button', {
        class: 'btn small no-print', type: 'button', 'data-fkey': 'pesan:tutup',
        onclick: function () { lupakanPesan(); renderPanel(state.view); }
      }, 'Tutup')));
  }

  /* Permission gate, with a refusal that names the role that could do it and
   * offers to become it. A dialog that says "denied" and nothing else teaches
   * the user only that the software dislikes them. */
  function bolehkah(aksi) {
    if (P.boleh(state.peran, aksi)) return true;
    tolak('Ditolak.', P.tolakan(state.peran, aksi));
    return false;
  }

  function gantiPeran(baru) {
    state.peran = baru;
    simpanKonfig();
    lupakanPesan();
    say('Peran sekarang ' + P.PERAN[baru].label + '. ' + P.PERAN[baru].catatan);
    renderAll();
  }

  /* ------------------------------------------------------------- ctxbar */

  function renderCtxBar() {
    var bar = $('ctxbar');
    clear(bar);

    var peranChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Peran' });
    P.DAFTAR_PERAN.forEach(function (p) {
      peranChips.appendChild(h('button', {
        type: 'button', class: 'chip', 'aria-pressed': state.peran === p ? 'true' : 'false',
        'data-fkey': 'peran:' + p, title: P.PERAN[p].catatan,
        onclick: function () { gantiPeran(p); }
      }, P.PERAN[p].label));
    });
    bar.appendChild(field('Peran aktif', peranChips));

    bar.appendChild(field('Tahun pajak', h('span', { class: 'perchip', text: String(cfg().tahun) })));
    bar.appendChild(field('Perusahaan', h('span', { class: 'small', text: cfg().perusahaan + ' · NPWP ' + cfg().npwpPerusahaan })));

    var pr = periksaHidup();
    bar.appendChild(field('Invarian', h('span', {
      class: 'pill ' + (pr.gagal ? 'bad' : 'ok'),
      text: pr.lulus + '/' + pr.total + ' · ' + pr.slip + ' slip'
    })));

    if (pr.drift && pr.drift.length) {
      bar.appendChild(field('Tertunggak', h('span', {
        class: 'pill warn',
        title: 'Data induk yang dibaca perhitungan setahun (status PTKP) atau lantai UMK Kesehatan berubah setelah bulan rekonsiliasinya diposting. Bukan invarian yang gagal — koreksi yang belum dijalankan.',
        text: pr.drift.length + ' koreksi'
      })));
    }

    bar.appendChild(field('Penyimpanan', h('span', {
      class: 'pill ' + (St.mode === 'idb' ? 'info' : 'warn'),
      title: St.mode === 'idb' ? 'Perubahan Anda tersimpan di IndexedDB peramban ini' : St.reason,
      text: St.mode === 'idb' ? 'IndexedDB' : 'memori saja'
    })));

    bar.appendChild(h('p', { class: 'ctx-note' },
      P.PERAN[state.peran].catatan, ' ',
      h('button', {
        class: 'linkbtn', type: 'button', 'data-fkey': 'ctx:reset',
        onclick: function () {
          St.clearAll().then(function () {
            audit('hapus-data');
            state.db = S.build();
            state.ctx = state.db.ctx;
            state.runs = state.db.runs;
            state.diedit = {};
            state.runDisimpan = false;
            state.audit = [];
            state.sel.karyawan = state.ctx.karyawan[0].nip;
            state.sel.pphNip = state.ctx.karyawan[0].nip;
            state.sel.slipNip = state.ctx.karyawan[0].nip;
            state.sel.pphSim = null;
            invalidate();
            sukses('Data lokal dihapus.', 'Halaman kembali ke keadaan cat pertama: perusahaan demo dibangun ulang dari satu bilangan seed.');
            renderAll();
          });
        }
      }, 'Hapus data lokal')));
  }

  /* ================================================================ tiles */

  function statTile(k, v, n, cls) {
    return h('div', { class: 'stat' + (cls ? ' ' + cls : '') },
      h('div', { class: 'k', text: k }),
      h('div', { class: 'v', text: v }),
      n ? h('div', { class: 'n', text: n }) : null);
  }

  /* Outstanding corrections, shown as work to do rather than as a violation.
   * A red badge for an ordinary HR edit would be a lie about the ledger; a
   * to-do with the fix one click away is the truth. */
  function kartuTertunggak() {
    var pr = periksaHidup();
    if (!pr.drift || !pr.drift.length) return null;
    var y = cfg().tahun;
    var bulan = {};
    pr.drift.forEach(function (d) { bulan[d.bulan] = 1; });
    var daftar = Object.keys(bulan).map(Number).sort(function (a2, b2) { return a2 - b2; });
    var nPtkp = pr.drift.filter(function (d) { return d.jenis !== 'umk'; }).length;
    var nUmk = pr.drift.filter(function (d) { return d.jenis === 'umk'; }).length;

    var box = h('div', { class: 'callout warn' },
      h('b', { text: pr.drift.length + ' koreksi tertunggak. ' }),
      /* TWO master-data fields can move under a posted payslip: the PTKP status
       * the annual formula reads, and the minimum-wage reference the BPJS
       * Kesehatan floor reads. Both are reported the same way and for the same
       * reason — the ledger is not broken, a correction is outstanding. */
      (nPtkp ? nPtkp + ' status PTKP' : '') + (nPtkp && nUmk ? ' dan ' : '') + (nUmk ? nUmk + ' iuran Kesehatan yang terdampak perubahan lantai UMK' : '') +
      ' berubah setelah bulan rekonsiliasinya diposting, jadi kewajiban yang tercatat bukan lagi kewajiban ' +
      'yang tersirat dari data induk sekarang. Ini BUKAN invarian yang gagal — angka yang sudah dipotong ' +
      'tetap konsisten dengan fakta yang tercatat saat itu, dan run yang sudah dikunci memang tidak boleh ' +
      'bergerak. Yang tertunggak adalah run penyesuaian. ',
      h('br'),
      h('span', { class: 'small' }, pr.drift.slice(0, 6).map(function (d) {
        return d.nip + ' ' + d.nama + ': ' + (d.label || (d.direkam + ' → ' + d.sekarang)) + ' (' + d.runId + ') ';
      }).join(' · ') + (pr.drift.length > 6 ? ' dan ' + (pr.drift.length - 6) + ' lainnya' : '')));

    box.appendChild(h('div', { class: 'chips' }, daftar.map(function (m) {
      /* A DRAFT MONTH IS RECOMPUTED, NOT ADJUSTED. Posting an adjustment
       * against an unlocked draft strands it: the regular run can then never be
       * recomputed again (that would double-count the delta), which is the only
       * sensible thing to do with a draft, and neither document can be signed
       * until both are. An adjustment run is the answer to a LOCKED month;
       * where the month is still a draft the honest repair is to run it again. */
      var reg = runOf(y, m);
      var adaAdj = runIds().some(function (id) {
        return state.runs[id].tahun === y && state.runs[id].bulan === m && state.runs[id].jenis === 'penyesuaian';
      });
      var draft = reg && reg.status !== 'terkunci' && !adaAdj;
      return h('button', {
        class: 'btn small', type: 'button', 'data-fkey': 'drift:adj:' + m,
        disabled: !P.boleh(state.peran, 'run.jalankan') ? true : null,
        title: draft
          ? 'Run ' + D.namaBulan(m) + ' masih draft dan belum ditandatangani siapa pun, jadi koreksinya diserap dengan menghitung ulang run itu sendiri — bukan dengan menumpuk selisih di atasnya'
          : 'Buat run penyesuaian ' + D.namaBulan(m) + ' — selisihnya saja; run yang terkunci tidak disentuh',
        onclick: function () { jalankanRun(y, m, draft ? 'reguler' : 'penyesuaian'); }
      }, (draft ? 'Hitung ulang ' : 'Jalankan penyesuaian ') + D.namaBulan(m));
    })));
    if (!P.boleh(state.peran, 'run.jalankan')) {
      box.appendChild(h('p', { class: 'hint' },
        'Menjalankan dan mengoreksi run milik payroll officer. ',
        h('button', { class: 'linkbtn', type: 'button', 'data-fkey': 'drift:jadiPayroll', onclick: function () { gantiPeran('payroll'); } }, 'Ganti ke payroll officer')));
    }
    return box;
  }

  function kartuInvarian() {
    var pr = periksaHidup();
    var card = h('div', { class: 'card' },
      h('h3', null, 'Pemeriksaan invarian hidup ',
        h('span', { class: 'pill ' + (pr.gagal ? 'bad' : 'ok'), text: pr.lulus + '/' + pr.total })),
      h('p', { class: 'note' },
        'Dihitung ulang dari ' + pr.slip + ' catatan slip gaji di ' + pr.run + ' run yang sedang dimuat — ',
        'termasuk run yang baru Anda jalankan dan perubahan data induk yang baru Anda simpan. ',
        'Setiap baris menjumlah ulang dari slipnya sendiri, tidak satu pun membaca total yang sudah di-cache, ',
        'sehingga pemeriksaan ini bisa menangkap aplikasi yang bertentangan dengan dirinya sendiri.'));
    pr.cek.forEach(function (c) {
      card.appendChild(h('div', { class: 'tcase ' + (c.ok ? 'ok' : 'no') },
        h('span', { class: 'mk', text: c.ok ? '✓' : '✗' }),
        h('span', { style: 'white-space:normal', text: c.nama }),
        h('span', { class: 'msg', style: 'white-space:normal', text: c.pesan })));
    });
    return card;
  }

  /* ============================================================= BERANDA */

  function renderBeranda(p) {
    renderPesan(p);
    var y = cfg().tahun;
    var des = runOf(y, 12);
    var totalTahun = P.totalKosong();
    runIds().forEach(function (id) {
      var r = state.runs[id];
      P.KOLOM.forEach(function (c) { totalTahun[c] += r.total[c]; });
    });
    var aktifDes = des ? des.slips.length : 0;

    var sum = h('div', { class: 'summary' });
    sum.appendChild(statTile('Karyawan', String(ctx().karyawan.length), aktifDes + ' aktif di Desember'));
    sum.appendChild(statTile('Bruto setahun', D.rupiah(totalTahun.bruto), 'yang dibayarkan ke karyawan', 'plus'));
    sum.appendChild(statTile('PPh 21 setahun', D.rupiah(totalTahun.dedPph21), 'dipotong dan disetor', 'pajak'));
    sum.appendChild(statTile('Potongan pekerja', D.rupiah(totalTahun.dedTotal), 'BPJS pekerja + PPh 21', 'minus'));
    sum.appendChild(statTile('Beban pemberi kerja', D.rupiah(totalTahun.ptgTotal), 'BUKAN potongan karyawan', 'pemberi'));
    sum.appendChild(statTile('Biaya total', D.rupiah(totalTahun.bruto + totalTahun.ptgTotal), 'bruto + iuran pemberi'));
    p.appendChild(sum);

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Apa yang sebenarnya sulit di payroll Indonesia' }),
      h('p', { class: 'note' },
        'Menjumlahkan gaji bukan pekerjaan. Yang tidak bisa diperiksa sendiri oleh klien — dan karena itu ',
        'yang dibayarnya — adalah PPh 21 dan BPJS. Tiga hal yang dikerjakan halaman ini dan sering salah ',
        'di tempat lain:'),
      h('div', { class: 'grid3' },
        h('div', { class: 'kat-kartu' },
          h('h4', { text: '1. TER lalu rekonsiliasi Desember' }),
          h('p', { class: 'small' },
            'Sejak PP 58/2023 potongan bulanan adalah satu pencarian tarif efektif dari tabel kategori PTKP. ',
            'Itu sengaja hanya pendekatan. Di bulan Desember — atau di bulan terakhir bekerja bagi yang ',
            'berhenti — seluruh perhitungan setahun diulang dan selisihnya masuk bulan itu. Bisa negatif, ',
            'dan itu restitusi lewat payroll.'),
          h('button', {
            class: 'btn small', type: 'button', 'data-fkey': 'br:pph',
            onclick: function () { switchTab('pph'); }
          }, 'Lihat hitungannya')),
        h('div', { class: 'kat-kartu' },
          h('h4', { text: '2. Plafon yang berbeda-beda' }),
          h('p', { class: 'small' },
            'BPJS Kesehatan berplafon upah ' + D.rupiah(D.KESEHATAN.batasAtas) + ' dan berlantai UMK. ',
            'JP punya plafonnya sendiri, ' + D.rupiah(D.JP.batasAtas) + ', yang disetel ulang BPJS setiap ',
            'tahun. JHT tidak punya plafon sama sekali. Jadi ada rentang upah di mana JP sudah tertahan ',
            'sementara Kesehatan belum, dan JHT terus naik.'),
          h('button', {
            class: 'btn small', type: 'button', 'data-fkey': 'br:bpjs',
            onclick: function () { switchTab('bpjs'); }
          }, 'Uji plafonnya')),
        h('div', { class: 'kat-kartu' },
          h('h4', { text: '3. Dua kolom yang tidak boleh bertemu' }),
          h('p', { class: 'small' },
            'Iuran pemberi kerja (Kesehatan 4%, JHT 3,7%, JP 2%, JKK, JKM) adalah biaya perusahaan, bukan ',
            'potongan karyawan. Sebagiannya — Kesehatan pemberi, JKK, JKM — tetap obyek pajak bagi karyawan ',
            'dan karena itu masuk bruto pajak tanpa pernah mengurangi neto. Software yang mencampur keduanya ',
            'adalah bug termahal di bidang ini.'),
          h('button', {
            class: 'btn small', type: 'button', 'data-fkey': 'br:slip',
            onclick: function () { switchTab('slip'); }
          }, 'Buka slip gaji')))));

    /* The December state, called out, because it is the point of the demo.
     * The FIGURE is the effective one — the regular run plus every adjustment
     * posted against December — because that is what December actually paid.
     * Reading the regular run alone made this tile stale the moment a
     * correction existed, and disagree with the annual tile directly above it. */
    if (des) {
      var efDes = P.efektifBulan(state.runs, y, 12);
      var pajakDes = efDes ? efDes.total.dedPph21 : des.total.dedPph21;
      var nDokDes = efDes ? efDes.runs.length : 1;
      p.appendChild(h('div', { class: 'callout pajak' },
        h('b', { text: 'Run Desember ' + y + ' berstatus ' + des.status + '. ' }),
        (nDokDes > 1 ? 'Bulan itu punya ' + nDokDes + ' dokumen (run reguler + penyesuaian), dan angka di bawah adalah jumlah seluruhnya. ' : '') +
        'Total PPh 21 bulan itu ' + D.rupiah(pajakDes) +
        (pajakDes < 0 ? ' — NEGATIF, karena rekonsiliasi setahun mengembalikan kelebihan potong yang ditimbulkan TER di bulan THR. ' : '. ') +
        'Jumlah dua belas potongan bulanan setiap karyawan sama dengan perhitungan setahunnya, tepat ke rupiah; ' +
        'itulah baris I3 di kartu invarian di bawah. ',
        h('button', {
          class: 'linkbtn', type: 'button', 'data-fkey': 'br:run',
          onclick: function () { switchTab('run'); }
        }, 'Buka Payroll Run')));
    }

    var todo = kartuTertunggak();
    if (todo) p.appendChild(todo);
    p.appendChild(kartuInvarian());

    /* Statutory vintage, on the front page rather than buried in a README. */
    var vin = h('div', { class: 'card' },
      h('h3', { text: 'Aturan dan tarif yang dikodekan, beserta vintage-nya' }),
      h('p', { class: 'note' },
        'Tabel pajak berubah. Ini demo, bukan nasihat pajak. Yang dikodekan di halaman ini, per 8 September 2026, ',
        'untuk tahun pajak ' + y + ':'));
    var baris = [
      ['PPh 21 tarif tahunan', '5% / 15% / 25% / 30% / 35%', 'UU 7/2021 (HPP) Pasal 17 ayat (1) huruf a'],
      ['Tarif Efektif Rata-rata', 'TER A 44 baris, TER B 40, TER C 41 — 0% s.d. 34%', 'PP 58/2023 Lampiran; mekanisme PMK 168/2023'],
      ['PTKP', 'TK/0 ' + D.rupiah(54000000) + ' s.d. K/3 ' + D.rupiah(72000000), 'PMK 101/PMK.010/2016'],
      ['Biaya jabatan', '5%, plafon ' + D.rupiah(D.BIAYA_JABATAN_CAP_BULAN) + '/bulan (' + D.rupiah(6000000) + '/tahun)', 'PMK 250/PMK.03/2008'],
      ['BPJS Kesehatan', '1% pekerja + 4% pemberi, plafon upah ' + D.rupiah(D.KESEHATAN.batasAtas) + ', lantai UMK ' + D.rupiah(cfg().umk), 'Perpres 82/2018 s.d.t.d Perpres 64/2020'],
      ['JHT', '2% pekerja + 3,7% pemberi, tanpa plafon', 'PP 46/2015'],
      ['JP', '1% pekerja + 2% pemberi, plafon upah ' + D.rupiah(D.JP.batasAtas) + ' (penyesuaian ' + D.JP.tahunBatas + ')', 'PP 45/2015'],
      ['JKK', 'kelas I 0,24% s.d. kelas V 1,74%, pemberi kerja', 'PP 44/2015'],
      ['JKM', '0,30%, pemberi kerja', 'PP 44/2015'],
      ['Lembur', '1/173 upah sebulan; hari kerja 1,5x lalu 2x; hari libur 2x s.d. jam 8, 3x jam 9, 4x jam 10–11', 'Kepmenaker 102/MEN/VI/2004'],
      ['Cuti tahunan', '12 hari kerja setelah 12 bulan masa kerja', 'UU 13/2003 Pasal 79, diubah UU 6/2023'],
      ['THR', '1 bulan upah pada masa kerja 12 bulan, prorata di bawahnya', 'PP 36/2021 Pasal 9; Permenaker 6/2016']
    ];
    vin.appendChild(tableOf(
      [{ label: 'Komponen' }, { label: 'Yang dikodekan' }, { label: 'Dasar hukum' }],
      baris.map(function (b) {
        return h('tr', null,
          td(h('b', { text: b[0] })),
          td(h('span', { class: 'wrap-normal', text: b[1] })),
          td(h('span', { class: 'small wrap-normal', text: b[2] })));
      }), { minWidth: '720px' }));
    p.appendChild(vin);
  }

  /* ============================================================ KARYAWAN */

  function karyawanTersaring() {
    var q = state.sel.cariKaryawan.toLowerCase().trim();
    var div = state.sel.divisi;
    var out = ctx().karyawan.filter(function (e) {
      if (div && e.divisi !== div) return false;
      if (!q) return true;
      return (e.nama + ' ' + e.nip + ' ' + e.jabatan + ' ' + e.divisi + ' ' + e.ptkp).toLowerCase().indexOf(q) >= 0;
    });
    var u = state.sel.urut;
    out.sort(function (a, b) {
      if (u === 'upah') return (b.gajiPokok + b.tunjanganTetap) - (a.gajiPokok + a.tunjanganTetap);
      if (u === 'nama') return a.nama < b.nama ? -1 : 1;
      if (u === 'divisi') return a.divisi === b.divisi ? (a.nip < b.nip ? -1 : 1) : (a.divisi < b.divisi ? -1 : 1);
      return a.nip < b.nip ? -1 : 1;
    });
    return out;
  }

  function ubahKaryawan(nip, fn, label) {
    if (!bolehkah('karyawan.ubah')) { renderPanel(state.view); return; }
    var e = emp(nip);
    fn(e);
    bekukanRun();
    simpanKaryawan(nip);
    audit('ubah-karyawan', nip + ' ' + (label || ''));
    invalidate();
    renderPanel(state.view);
    paintBuku();
  }

  function renderKaryawan(p) {
    renderPesan(p);
    var boleh = P.boleh(state.peran, 'karyawan.ubah');

    var divisiOpt = [{ value: '', label: 'Semua divisi' }];
    var seen = {};
    ctx().karyawan.forEach(function (e) { if (!seen[e.divisi]) { seen[e.divisi] = 1; divisiOpt.push({ value: e.divisi, label: e.divisi }); } });

    var ctl = h('div', { class: 'controls' },
      field('Cari', h('input', {
        type: 'search', 'data-fkey': 'kar:cari', value: state.sel.cariKaryawan,
        placeholder: 'nama, NIP, jabatan, status PTKP',
        style: 'min-width:220px',
        oninput: function (ev) { state.sel.cariKaryawan = ev.target.value; renderPanel('karyawan'); }
      }), 'grow'),
      field('Divisi', select(divisiOpt, state.sel.divisi, function (v) { state.sel.divisi = v; renderPanel('karyawan'); }, { 'data-fkey': 'kar:divisi' })),
      field('Urut', select([
        { value: 'nip', label: 'NIP' }, { value: 'nama', label: 'Nama' },
        { value: 'divisi', label: 'Divisi' }, { value: 'upah', label: 'Upah tertinggi' }
      ], state.sel.urut, function (v) { state.sel.urut = v; renderPanel('karyawan'); }, { 'data-fkey': 'kar:urut' })));

    var daftar = karyawanTersaring();
    var rows = daftar.map(function (e) {
      var upah = e.gajiPokok + e.tunjanganTetap;
      var b = P.bpjs(upah, e.risiko, cfg());
      var kat = D.kategoriTER(e.ptkp);
      var aktif = P.bulanAktif(e, cfg().tahun);
      return h('tr', { class: state.sel.karyawan === e.nip ? 'sel' : null },
        td(h('button', {
          class: 'linkbtn nip', type: 'button', 'data-fkey': 'kar:pilih:' + fkey(e.nip),
          onclick: function () { state.sel.karyawan = e.nip; state.sel.pphNip = e.nip; state.sel.slipNip = e.nip; renderPanel('karyawan'); }
        }, e.nip)),
        td(h('div', { class: 'stack' },
          h('span', { class: 'wrap-normal', text: e.nama }),
          h('span', { class: 'small', style: 'color:var(--faint)', text: e.jabatan + ' · ' + e.divisi }))),
        td(boleh
          ? select(D.STATUS_PTKP.map(function (s) { return { value: s, label: s }; }), e.ptkp, function (v) {
            ubahKaryawan(e.nip, function (x) { x.ptkp = v; }, 'PTKP -> ' + v);
            say('Status PTKP ' + e.nama + ' menjadi ' + v + ', kategori TER ' + D.kategoriTER(v) + '. Run yang belum dikunci akan memakainya saat dijalankan ulang.');
          }, { 'data-fkey': 'kar:ptkp:' + fkey(e.nip), 'aria-label': 'Status PTKP ' + e.nama })
          : h('span', { class: 'mono', text: e.ptkp })),
        td(h('span', { class: 'pill', text: 'TER ' + kat })),
        td(boleh
          ? select(D.KELAS_RISIKO.map(function (k) { return { value: k, label: k }; }), e.risiko, function (v) {
            ubahKaryawan(e.nip, function (x) { x.risiko = v; }, 'risiko -> ' + v);
          }, { 'data-fkey': 'kar:risiko:' + fkey(e.nip), 'aria-label': 'Kelas risiko JKK ' + e.nama })
          : h('span', { class: 'mono', text: e.risiko })),
        h('td', { class: 'num' }, boleh
          ? numInput(e.gajiPokok, function (v) {
            var n = parseInt(v, 10);
            if (isNaN(n) || n < 0) n = 0;
            if (n > 500000000) n = 500000000;
            ubahKaryawan(e.nip, function (x) { x.gajiPokok = n; }, 'pokok -> ' + n);
          }, { 'data-fkey': 'kar:pokok:' + fkey(e.nip), step: '100000', 'aria-label': 'Gaji pokok ' + e.nama })
          : h('span', { text: D.rupiah(e.gajiPokok) })),
        h('td', { class: 'num' }, boleh
          ? numInput(e.tunjanganTetap, function (v) {
            var n = parseInt(v, 10);
            if (isNaN(n) || n < 0) n = 0;
            if (n > 500000000) n = 500000000;
            ubahKaryawan(e.nip, function (x) { x.tunjanganTetap = n; }, 'tetap -> ' + n);
          }, { 'data-fkey': 'kar:tetap:' + fkey(e.nip), step: '50000', 'aria-label': 'Tunjangan tetap ' + e.nama })
          : h('span', { text: D.rupiah(e.tunjanganTetap) })),
        tdRp(upah),
        td(h('div', { class: 'stack' },
          h('span', { class: 'small', text: (b.kesKena ? 'Kes: plafon' : 'Kes: upah') + ' · ' + (b.jpKena ? 'JP: plafon' : 'JP: upah') }),
          b.kesDasar > upah ? h('span', { class: 'pill warn', text: 'dasar diangkat ke UMK' }) : null)),
        td(h('span', { class: 'small', text: D.tglPanjang(e.mulai) })),
        td(e.selesai
          ? h('span', { class: 'pill bad', text: 'berhenti ' + D.tglPanjang(e.selesai) })
          : h('span', { class: 'pill ' + (aktif.length === 12 ? 'ok' : 'info'), text: aktif.length === 12 ? 'setahun penuh' : aktif.length + ' bulan' })),
        td(state.diedit[e.nip] ? h('span', { class: 'pill warn', text: 'diubah' }) : h('span', { class: 'small', style: 'color:var(--faint)', text: '—' })));
    });

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Data induk karyawan — ' + daftar.length + ' dari ' + ctx().karyawan.length }),
      h('p', { class: 'note' },
        'Milik HR admin. Status PTKP menentukan DUA hal sekaligus: kategori tabel TER yang dipakai setiap ',
        'bulan, dan jumlah PTKP yang dikurangkan pada perhitungan setahun. Ubah satu status di sini lalu buka ',
        'tab PPh 21 untuk melihat kedua-duanya bergerak. Kelas risiko JKK mengikuti pekerjaannya, bukan ',
        'pangkatnya: pemetik barang di gudang duduk di kelas lebih tinggi daripada manajer keuangan bergaji ',
        'empat kali lipat. ',
        boleh ? null : h('b', { text: 'Peran ' + P.PERAN[state.peran].label + ' hanya membaca di sini.' })),
      ctl,
      daftar.length ? tableOf([
        { label: 'NIP' }, { label: 'Nama / jabatan' }, { label: 'PTKP' }, { label: 'Kategori' },
        { label: 'JKK' }, { label: 'Gaji pokok', num: true }, { label: 'Tunj. tetap', num: true },
        { label: 'Upah sebulan', num: true }, { label: 'Dasar iuran' }, { label: 'Mulai' },
        { label: 'Status ' + cfg().tahun }, { label: 'Induk' }
      ], rows, { minWidth: '1180px' })
        : h('div', { class: 'empty', text: 'Tidak ada karyawan yang cocok dengan saringan itu.' }));
    p.appendChild(card);

    if (state.sel.karyawan && emp(state.sel.karyawan)) p.appendChild(kartuKaryawan(emp(state.sel.karyawan)));
  }

  function kartuKaryawan(e) {
    var upah = e.gajiPokok + e.tunjanganTetap;
    var b = P.bpjs(upah, e.risiko, cfg());
    var c = P.cuti(ctx(), e, cfg().tahun, 12);
    var aktif = P.bulanAktif(e, cfg().tahun);
    var kv = h('dl', { class: 'kv2' });
    function row(k, v) { kv.appendChild(h('dt', { text: k })); kv.appendChild(h('dd', { class: 'wrap-normal', text: v })); }
    row('NIP', e.nip);
    row('NIK (fabrikasi, awalan 99)', e.nik);
    row('NPWP (fabrikasi, awalan 99)', e.npwp);
    row('BPJS Kesehatan / TK (fabrikasi)', e.bpjsKes + ' / ' + e.bpjsTk);
    row('Rekening (fabrikasi, awalan 0000)', e.rekening);
    row('Jabatan', e.jabatan + ' · ' + e.divisi + ' · ' + e.levelNama);
    row('Status PTKP', e.ptkp + ' — ' + D.PTKP[e.ptkp].label);
    row('PTKP setahun', D.rupiah(D.ptkpOf(e.ptkp)));
    row('Kategori TER', D.kategoriTER(e.ptkp) + ' — ' + T.KATEGORI_ISI[D.kategoriTER(e.ptkp)].status.join(', '));
    row('Upah sebulan (dasar lembur, BPJS, THR)', D.rupiah(upah));
    row('Tarif lembur sejam (1/173)', D.rupiah(D.divRound(upah, D.LEMBUR_DIVISOR)));
    row('Kelas risiko JKK', e.risiko + ' — ' + D.JKK_KELAS[e.risiko].label);
    row('Masa kerja per akhir tahun', D.bulanMasaKerja(e.mulai, cfg().tahun + '-12-31') + ' bulan sejak ' + D.tglPanjang(e.mulai));
    row('Bulan aktif ' + cfg().tahun, aktif.length ? aktif.map(function (m) { return D.BULAN_PENDEK[m - 1]; }).join(' ') : 'tidak aktif');
    row('Bulan rekonsiliasi PPh 21', P.bulanKoreksi(e, cfg().tahun) ? D.namaBulan(P.bulanKoreksi(e, cfg().tahun)) : '—');
    row('Saldo cuti', c.akrual + ' akrual − ' + c.diambil + ' diambil = ' + c.saldo + ' hari' + (c.override ? ' (ada override)' : ''));
    row('Dasar BPJS Kesehatan', D.rupiah(b.kesDasar) + (b.kesKena ? ' (plafon menggigit)' : b.kesDasar > upah ? ' (diangkat ke UMK)' : ''));
    row('Dasar JP', D.rupiah(b.jpDasar) + (b.jpKena ? ' (plafon menggigit)' : ''));
    row('Dasar JHT', D.rupiah(b.jhtDasar) + ' (tanpa plafon)');

    return h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: e.nama }),
        h('div', { class: 'chips' },
          h('button', { class: 'btn small', type: 'button', 'data-fkey': 'kar:keSlip', onclick: function () { state.sel.slipNip = e.nip; switchTab('slip'); } }, 'Slip gaji'),
          h('button', { class: 'btn small', type: 'button', 'data-fkey': 'kar:kePph', onclick: function () { state.sel.pphNip = e.nip; state.sel.pphSim = null; switchTab('pph'); } }, 'PPh 21 setahun'),
          h('button', { class: 'btn small', type: 'button', 'data-fkey': 'kar:keCuti', onclick: function () { state.sel.cutiNip = e.nip; switchTab('cuti'); } }, 'Cuti'))),
      h('p', { class: 'note' },
        'Setiap pengenal di bawah ini fabrikasi dan dibangun supaya bentuknya benar sementara isinya mustahil, ',
        'sehingga tidak satu pun bisa menunjuk orang, wajib pajak, peserta BPJS atau rekening yang nyata.'),
      kv);
  }

  /* =========================================================== ABSENSI */

  function renderAbsensi(p) {
    renderPesan(p);
    if (!state.sel.absNip) state.sel.absNip = ctx().karyawan[0].nip;
    var e = emp(state.sel.absNip) || ctx().karyawan[0];
    var y = cfg().tahun;
    var upah = e.gajiPokok + e.tunjanganTetap;
    var tarifJam = D.divRound(upah, D.LEMBUR_DIVISOR);

    var opt = ctx().karyawan.map(function (x) { return { value: x.nip, label: x.nip + ' — ' + x.nama + ' (' + x.divisi + ')' }; });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Absensi dan lembur' }),
      h('p', { class: 'note' },
        'Lembur dihitung dari KEJADIAN yang tercatat, bukan dari tunjangan gelondongan. Itu penting karena ',
        'tangga pengalinya berlaku per hari: dua hari masing-masing tiga jam TIDAK sama dengan satu hari enam ',
        'jam, sebab jam pertama setiap hari adalah jam 1,5x. Upah sejam adalah 1/173 upah sebulan ',
        '(Kepmenaker 102/2004 Pasal 8) — untuk ' + e.nama + ' itu ' + D.rupiah(tarifJam) + '. ',
        'Absen tanpa upah mengurangi UPAH-nya, jadi ia baris pendapatan negatif dan pembaginya hari kerja ',
        'nyata bulan itu, bukan 21 atau 22 yang biasa ditebak.'),
      h('div', { class: 'controls' },
        field('Karyawan', select(opt, e.nip, function (v) { state.sel.absNip = v; renderPanel('absensi'); }, { 'data-fkey': 'abs:karyawan', style: 'max-width:340px' }), 'grow'),
        field('Upah sebulan', h('span', { class: 'mono', text: D.rupiah(upah) })),
        field('Tarif lembur / jam', h('span', { class: 'mono', text: D.rupiah(tarifJam) })))));

    var aktif = P.bulanAktif(e, y);
    if (!aktif.length) {
      p.appendChild(h('div', { class: 'empty', text: e.nama + ' tidak aktif di tahun ' + y + '.' }));
      return;
    }

    var rows = [], totJam = 0, totLembur = 0, totTanpaUpah = 0, totPotongan = 0;
    aktif.forEach(function (m) {
      var per = D.periode(y, m);
      var abs = (ctx().absensi[e.nip] && ctx().absensi[e.nip][per]) || { hariKerja: D.hariKerja(y, m), hadir: D.hariKerja(y, m), tanpaUpah: 0, cuti: 0, sakit: 0 };
      var kejadian = (ctx().lembur[e.nip] && ctx().lembur[e.nip][per]) || [];
      var lem = P.lembur(upah, kejadian);
      var hk = D.hariKerja(y, m);
      var potongan = abs.tanpaUpah ? -D.divRound(D.mul(upah, abs.tanpaUpah), hk) : 0;
      var jam = kejadian.reduce(function (a, c) { return a + c.jam; }, 0);
      totJam += jam; totLembur += lem.total; totTanpaUpah += abs.tanpaUpah || 0; totPotongan += potongan;
      rows.push(h('tr', null,
        td(D.BULAN[m - 1]),
        tdNum(hk),
        tdNum(abs.hadir),
        tdNum(abs.cuti || 0),
        tdNum(abs.sakit || 0),
        tdNum(abs.tanpaUpah || 0),
        tdRp(potongan, potongan ? 'minus' : 'nol'),
        tdNum(kejadian.length),
        tdNum(jam),
        td(h('div', { class: 'stack' }, lem.baris.map(function (b) {
          return h('span', { class: 'small mono' },
            h('span', { text: D.hariDari(b.tgl) + '/' + m + ' ' + b.jam + 'j ' }),
            h('span', { class: 'pill ' + (b.libur ? 'warn' : 'info'), text: b.libur ? 'libur' : 'kerja' }),
            h('span', { text: ' ×' + (b.bobot / 100) + ' = ' + D.rupiah(b.rupiah) }));
        }))),
        tdRp(lem.total, lem.total ? 'plus' : 'nol')));
    });
    rows.push(h('tr', { class: 'total-row' },
      td('Setahun'), td(''), td(''), td(''), td(''),
      tdNum(totTanpaUpah), tdRp(totPotongan, 'minus'), td(''), tdNum(totJam), td(''), tdRp(totLembur, 'plus')));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Rekaman ' + y + ' — ' + e.nama }),
      tableOf([
        { label: 'Bulan' }, { label: 'Hari kerja', num: true }, { label: 'Hadir', num: true },
        { label: 'Cuti', num: true }, { label: 'Sakit', num: true }, { label: 'Tanpa upah', num: true },
        { label: 'Pengurang upah', num: true }, { label: 'Kejadian', num: true }, { label: 'Jam', num: true },
        { label: 'Rincian pengali' }, { label: 'Upah lembur', num: true }
      ], rows, { minWidth: '1080px' })));

    /* The multiplier ladder, spelled out, plus a live calculator. */
    var kalk = h('div', { class: 'card' },
      h('h3', { text: 'Tangga pengali lembur, dan kalkulatornya' }),
      h('p', { class: 'note' },
        'Kepmenaker 102/2004 Pasal 11. Perusahaan demo ini memakai pekan lima hari kerja delapan jam, jadi ',
        'tangga hari libur bertumpu pada jam kedelapan. Angka di kolom kanan dihitung dari upah sebulan ',
        D.rupiah(upah) + '.'));
    var lrows = [];
    for (var j = 1; j <= 11; j++) {
      (function (j) {
        lrows.push(h('tr', null,
          tdNum(j),
          td(j === 1 ? '1,5x' : '2x'),
          tdNum(D.bobotLembur(j, false) / 100 + 'x'),
          tdRp(D.upahLembur(upah, j, false)),
          td(j <= 8 ? '2x' : (j === 9 ? '3x' : '4x')),
          tdNum(D.bobotLembur(j, true) / 100 + 'x'),
          tdRp(D.upahLembur(upah, j, true))));
      })(j);
    }
    kalk.appendChild(tableOf([
      { label: 'Jam ke-', num: true }, { label: 'Hari kerja: pengali jam itu' }, { label: 'Kumulatif', num: true },
      { label: 'Upah hari kerja', num: true }, { label: 'Hari libur: pengali jam itu' },
      { label: 'Kumulatif', num: true }, { label: 'Upah hari libur', num: true }
    ], lrows, { minWidth: '860px' }));
    p.appendChild(kalk);
  }

  /* ============================================================== CUTI */

  function renderCuti(p) {
    renderPesan(p);
    var y = cfg().tahun;
    var boleh = P.boleh(state.peran, 'cuti.putuskan');

    var rows = ctx().karyawan.map(function (e) {
      var c = P.cuti(ctx(), e, y, 12);
      return h('tr', { class: state.sel.cutiNip === e.nip ? 'sel' : null },
        td(h('button', {
          class: 'linkbtn nip', type: 'button', 'data-fkey': 'cuti:pilih:' + fkey(e.nip),
          onclick: function () { state.sel.cutiNip = e.nip; renderPanel('cuti'); }
        }, e.nip)),
        td(h('span', { class: 'wrap-normal', text: e.nama })),
        td(h('span', { class: 'small', text: e.divisi })),
        td(h('span', { class: 'small', text: D.tglPanjang(e.mulai) })),
        tdNum(D.bulanMasaKerja(e.mulai, y + '-12-31')),
        tdNum(c.akrual),
        tdNum(c.diambil),
        h('td', { class: 'num ' + (c.saldo < 0 ? 'minus' : '') , text: String(c.saldo) }),
        td(c.negatifTanpaIzin
          ? h('span', { class: 'pill bad', text: 'negatif TANPA izin' })
          : c.saldo < 0 ? h('span', { class: 'pill warn', text: 'negatif, ber-override' })
            : c.akrual === 0 ? h('span', { class: 'pill', text: 'belum berhak' })
              : h('span', { class: 'pill ok', text: 'wajar' })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Cuti tahunan — akrual, pengambilan dan saldo' }),
      h('p', { class: 'note' },
        'UU 13/2003 Pasal 79 sebagaimana diubah UU 6/2023: 12 hari kerja setelah 12 bulan masa kerja ',
        'berturut-turut. Halaman ini mengakru satu hari per bulan penuh setelah syarat itu terpenuhi, dengan ',
        'batas ' + D.CUTI_HAK_TAHUNAN + ' + ' + D.CUTI_CARRY_MAKS + ' hari carry-over. Saldo = akrual − diambil, ',
        'dan tidak boleh negatif tanpa override yang tercatat — invarian I6. Cuti sakit tidak mengurangi saldo ',
        'cuti tahunan; absen tanpa upah adalah hal yang lain lagi dan mengurangi upah, bukan saldo.'),
      tableOf([
        { label: 'NIP' }, { label: 'Nama' }, { label: 'Divisi' }, { label: 'Mulai' },
        { label: 'Masa kerja (bln)', num: true }, { label: 'Akrual', num: true },
        { label: 'Diambil', num: true }, { label: 'Saldo', num: true }, { label: 'Status' }
      ], rows, { minWidth: '900px' })));

    var e = state.sel.cutiNip ? emp(state.sel.cutiNip) : null;
    if (!e) {
      p.appendChild(h('div', { class: 'empty', text: 'Pilih satu NIP di atas untuk melihat riwayat cutinya dan mengajukan pengambilan.' }));
      return;
    }
    var c = P.cuti(ctx(), e, y, 12);
    var hari = state.sel.cutiHari;
    var izin = P.bolehAmbilCuti(ctx(), e, y, 12, hari, state.sel.cutiOverride);

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Riwayat dan pengajuan — ' + e.nama }),
      h('div', { class: 'summary' },
        statTile('Akrual', String(c.akrual) + ' hari', 'per Desember ' + y),
        statTile('Diambil', String(c.diambil) + ' hari', 'cuti tahunan saja', 'minus'),
        statTile('Saldo', String(c.saldo) + ' hari', c.saldo < 0 ? 'negatif — ada override' : 'akrual − diambil', c.saldo < 0 ? 'minus' : 'plus')));

    var hrows = c.riwayat.slice().sort(function (a, b) { return a.mulai < b.mulai ? -1 : 1; }).map(function (r) {
      return h('tr', null,
        td(h('span', { class: 'mono small', text: r.id })),
        td(D.tglPanjang(r.mulai)),
        td(h('span', {
          class: 'pill ' + (r.jenis === 'tahunan' ? 'info' : r.jenis === 'sakit' ? 'ok' : 'warn'),
          text: r.jenis === 'tahunan' ? 'cuti tahunan' : r.jenis === 'sakit' ? 'sakit' : 'tanpa upah'
        })),
        tdNum(r.hari),
        td(r.override ? h('span', { class: 'pill warn', text: 'override' }) : h('span', { class: 'small', style: 'color:var(--faint)', text: '—' })),
        td(h('span', { class: 'small wrap-normal', text: r.alasan || '' })));
    });
    card.appendChild(hrows.length
      ? tableOf([{ label: 'ID' }, { label: 'Mulai' }, { label: 'Jenis' }, { label: 'Hari', num: true }, { label: 'Izin' }, { label: 'Catatan' }], hrows, { minWidth: '700px' })
      : h('div', { class: 'empty', text: 'Belum ada pengambilan cuti tercatat untuk ' + e.nama + '.' }));

    card.appendChild(h('h4', { style: 'margin-top:14px;font-size:13px', text: 'Ajukan pengambilan cuti tahunan' }));
    card.appendChild(h('div', { class: 'controls' },
      field('Jumlah hari', numInput(hari, function (v) {
        var n = parseInt(v, 10);
        if (isNaN(n)) n = 0;
        if (n > 60) n = 60;
        state.sel.cutiHari = n;
        renderPanel('cuti');
      }, { 'data-fkey': 'cuti:hari', sempit: true, step: '1' })),
      field('Override saldo', h('button', {
        type: 'button', class: 'chip', 'aria-pressed': state.sel.cutiOverride ? 'true' : 'false',
        'data-fkey': 'cuti:override',
        title: 'Tanpa ini, permintaan yang melebihi saldo ditolak. Dengan ini, saldo boleh negatif dan alasannya tercatat.',
        onclick: function () { state.sel.cutiOverride = !state.sel.cutiOverride; renderPanel('cuti'); }
      }, state.sel.cutiOverride ? 'override AKTIF' : 'override nonaktif')),
      h('button', {
        class: 'btn primary', type: 'button', 'data-fkey': 'cuti:ajukan',
        disabled: !boleh || !izin.ok ? true : null,
        onclick: function () {
          if (!bolehkah('cuti.putuskan')) { renderPanel('cuti'); return; }
          if (state.sel.cutiOverride && !bolehkah('cuti.override')) { renderPanel('cuti'); return; }
          var cek = P.bolehAmbilCuti(ctx(), e, y, 12, state.sel.cutiHari, state.sel.cutiOverride);
          if (!cek.ok) { tolak('Pengajuan ditolak.', cek.alasan); renderPanel('cuti'); return; }
          var rec = {
            id: 'CT-' + e.nip + '-M' + (ctx().cuti.length + 1), nip: e.nip, jenis: 'tahunan',
            mulai: y + '-12-15', hari: state.sel.cutiHari, override: state.sel.cutiOverride,
            status: 'disetujui',
            alasan: state.sel.cutiOverride ? 'Melebihi saldo, disetujui dengan override oleh ' + P.PERAN[state.peran].label + '.' : ''
          };
          ctx().cuti.push(rec);
          simpanCuti(rec);
          audit('cuti-setujui', rec.id + ' ' + rec.hari + ' hari' + (rec.override ? ' (override)' : ''));
          invalidate();
          sukses('Cuti dicatat.', rec.hari + ' hari untuk ' + e.nama + '. Saldo kini ' + P.cuti(ctx(), e, y, 12).saldo + ' hari.');
          renderPanel('cuti');
          paintBuku();
        }
      }, 'Catat pengambilan')));

    card.appendChild(h('div', { class: izin.ok ? 'terima-ok' : 'tolak' },
      izin.ok
        ? [h('b', { text: 'Diizinkan. ' }), 'Saldo ' + c.saldo + ' hari, setelah pengambilan ' + izin.sisa + ' hari' + (state.sel.cutiOverride ? ' — dengan override, jadi boleh negatif dan alasannya akan tercatat.' : '.')]
        : [h('b', { text: 'Ditolak. ' }), izin.alasan]));
    if (!boleh) {
      card.appendChild(h('p', { class: 'hint', style: 'margin-top:8px' },
        'Keputusan cuti milik HR admin. Peran aktif ' + P.PERAN[state.peran].label + ' hanya membaca. ',
        h('button', { class: 'linkbtn', type: 'button', 'data-fkey': 'cuti:jadiHr', onclick: function () { gantiPeran('hr'); } }, 'Ganti ke HR admin')));
    }
    p.appendChild(card);
  }

  /* ======================================================== PAYROLL RUN */

  /* Re-read this month's documents from storage BEFORE computing anything, so a
   * tab that has been sitting open while another tab locked the month computes
   * against the record rather than against its own stale memory. The guarded
   * write would refuse the result anyway; refusing before the work is done
   * means the user is never shown a run that was never posted. */
  function jalankanRun(y, m, jenis) {
    var ids = [P.runId(y, m, 'reguler')];
    runIds().forEach(function (id) {
      if (state.runs[id].tahun === y && state.runs[id].bulan === m && ids.indexOf(id) < 0) ids.push(id);
    });
    Promise.all(ids.map(function (id) { return St.get('run', id); })).then(function (recs) {
      var berubah = false;
      recs.forEach(function (rec) {
        if (!rec || !rec.v || !rec.v.id) return;
        var kini = state.runs[rec.v.id];
        if (!kini || (rec.v.rev || 0) > (kini.rev || 0) || rec.v.status !== kini.status) { state.runs[rec.v.id] = rec.v; berubah = true; }
      });
      if (berubah) invalidate();
      jalankanRunSekarang(y, m, jenis);
    }).catch(function () { jalankanRunSekarang(y, m, jenis); });
  }

  function jalankanRunSekarang(y, m, jenis) {
    if (!bolehkah('run.jalankan')) { renderPanel(state.view); return; }
    var lama = runOf(y, m, jenis);
    if (lama && lama.status === 'terkunci') {
      tolak('Run terkunci.', 'Run ' + lama.id + ' sudah dikunci ' + lama.dikunciOleh + '. Perbaikan harus lewat run penyesuaian baru — menulis ulang dokumen yang sudah ditandatangani menghapus arti tanda tangannya.');
      renderPanel('run');
      return;
    }
    var seri = 1;
    if (jenis === 'penyesuaian') {
      while (state.runs[P.runId(y, m, 'penyesuaian', seri)]) seri++;
    }
    var run;
    try {
      run = P.jalankan(ctx(), state.runs, y, m, { jenis: jenis, seri: seri, oleh: state.peran, at: D.ymd(Date.now()) });
    } catch (err) {
      tolak('Gagal menjalankan run.', String(err && err.message || err));
      renderPanel('run');
      return;
    }
    state.runs[run.id] = run;
    state.sel.runId = run.id;
    state.sel.bulan = m;

    /* A mid-year correction changes the year's accumulated withholding, so the
     * month that carries the annual recomputation stops reconciling unless it
     * is corrected too. The follow-on runs are created in the same action —
     * but IN TAX-ONLY MODE.
     *
     * They used to be ordinary delta runs, which re-priced those months'
     * EARNINGS as well. A raise the officer applied to April was then paid
     * again in August and in December, months nobody named, while May to July
     * and September to November went unpaid; the invariant badge stayed green
     * throughout because the result was internally consistent. That is money
     * moved without authority under a green tick. A follow-on now carries the
     * re-placed annual true-up and nothing else, and if the month's earnings
     * HAVE moved that is reported as outstanding work for the officer to
     * decide on — deliberately, month by month — rather than posted for them. */
    var ikut = [], lewat = [];
    if (jenis === 'penyesuaian') {
      P.koreksiTertinggal(ctx(), state.runs, y, m).forEach(function (c) {
        if (!runOf(y, c)) return;
        var seriC = 1;
        while (state.runs[P.runId(y, c, 'penyesuaian', seriC)]) seriC++;
        var rc;
        try { rc = P.jalankan(ctx(), state.runs, y, c, { jenis: 'penyesuaian', seri: seriC, pajakSaja: true, oleh: state.peran, at: D.ymd(Date.now()), catatan: 'Koreksi PAJAK SAJA: menempatkan ulang rekonsiliasi setahun setelah ' + run.id + '. Tidak satu pun baris upah bulan ini bergerak.' }); }
        catch (e2) { return; }
        if (!rc.slips.length) return;          /* nothing to re-place: no document */
        state.runs[rc.id] = rc;
        ikut.push(rc);
      });
      /* Months whose earnings would move if they were recomputed today. Named,
       * never posted. */
      for (var mm = 1; mm <= 12; mm++) {
        if (mm === m) continue;
        if (!runOf(y, mm)) continue;
        var sisa = P.selisihUpahTertinggal(ctx(), state.runs, y, mm);
        if (sisa.length) lewat.push({ bulan: mm, n: sisa.length });
      }
    }

    bekukanRun([run.id].concat(ikut.map(function (r) { return r.id; })));
    simpanRun(run);
    ikut.forEach(function (r) { simpanRun(r); });
    audit('jalankan-run', run.id + ' ' + run.slips.length + ' slip' + (ikut.length ? ' + ' + ikut.length + ' koreksi pajak lanjutan' : ''));
    invalidate();
    var koreksi = run.slips.filter(function (s) { return s.pajak.metode === 'setahun'; }).length;
    var restitusi = run.slips.filter(function (s) { return s.k.dedPph21 < 0; }).length;
    sukses('Run ' + run.id + ' dijalankan.',
      run.slips.length + ' slip, ' + (jenis === 'penyesuaian' ? 'SELISIH neto ' : 'neto ') + D.rupiah(run.total.neto) +
      ', PPh 21 ' + D.rupiah(run.total.dedPph21) + '. ' +
      (koreksi ? koreksi + ' slip memakai rekonsiliasi setahun' + (restitusi ? ', ' + restitusi + ' di antaranya restitusi (PPh 21 negatif).' : '.') : 'Seluruhnya memakai tarif TER bulanan.') +
      (ikut.length
        ? ' Karena koreksi ini mengubah akumulasi setahun, bulan rekonsiliasi ikut dikoreksi otomatis — PAJAK SAJA, tidak satu pun baris upah bergerak: ' +
        ikut.map(function (r) { return r.id + ' (' + D.rupiah(r.total.dedPph21) + ')'; }).join(', ') + '.'
        : (jenis === 'penyesuaian' ? ' Tidak ada bulan rekonsiliasi yang perlu ikut dikoreksi.' : '')) +
      (lewat.length
        ? ' Bulan ' + lewat.map(function (x) { return D.namaBulan(x.bulan) + ' (' + x.n + ' orang)'; }).join(', ') +
        ' juga akan berubah kalau dihitung ulang dari data induk sekarang. Itu TIDAK dikerjakan di sini: hanya bulan yang Anda sebut yang dikoreksi. Jalankan penyesuaian bulan-bulan itu satu per satu kalau perubahan upahnya memang berlaku untuk bulan-bulan itu.'
        : ''));
    renderPanel('run');
    paintBuku();
  }

  function statusPill(run) {
    if (run.status === 'terkunci') return h('span', { class: 'pill ok', text: 'terkunci · ' + (run.dikunciOleh || '') });
    if (run.status === 'ditinjau') return h('span', { class: 'pill info', text: 'ditinjau · ' + (run.ditinjauOleh || '') });
    return h('span', { class: 'pill warn', text: 'draft' });
  }

  function renderRun(p) {
    renderPesan(p);
    var y = cfg().tahun;
    var todo = kartuTertunggak();
    if (todo) p.appendChild(todo);

    /* ONE ROW PER RUN DOCUMENT, not one row per month.
     *
     * Two things were wrong with a month-shaped table. First, an adjustment run
     * appeared only as an inert "1 penyesuaian" pill: it could never be
     * reviewed, never be locked, and after the click that created it never even
     * be opened again — so the document that actually corrects a signed run was
     * one no approver could sign, which hollows out the separation of duties it
     * exists to preserve. Second, the month rows showed the REGULAR run while
     * the Setahun row summed every run, so once a correction existed the table
     * disagreed with its own total. Every document now gets its own row, its own
     * status and its own buttons, the rows add up to the Setahun row by
     * construction, and a month carrying more than one document gets an
     * explicit "efektif" subtotal so the month's real figure is never implied. */
    function barisAksi(r, isReg, adaAdj) {
      var chips = h('div', { class: 'chips' });
      if (isReg && r.status !== 'terkunci') {
        chips.appendChild(h('button', {
          class: 'btn small', type: 'button', 'data-fkey': 'run:jalankan:' + r.bulan,
          disabled: (!P.boleh(state.peran, 'run.jalankan') || adaAdj) ? true : null,
          title: adaAdj
            ? 'Bulan ini sudah punya run penyesuaian. Menghitung ulang run reguler-nya akan menghitung penyesuaian itu dua kali, jadi jalurnya adalah run penyesuaian berikutnya.'
            : 'Hitung ulang run draft ini dari data induk saat ini',
          onclick: function () { jalankanRun(y, r.bulan, 'reguler'); }
        }, 'Hitung ulang'));
      }
      if (r.status === 'draft') {
        chips.appendChild(h('button', {
          class: 'btn small', type: 'button', 'data-fkey': 'run:tinjau:' + r.id,
          disabled: !P.boleh(state.peran, 'run.tinjau') ? true : null,
          onclick: function () {
            if (!bolehkah('run.tinjau')) { renderPanel('run'); return; }
            try { P.tinjau(r, state.peran, P.PERAN[state.peran].label); }
            catch (e) { tolak('Gagal.', String(e.message)); renderPanel('run'); return; }
            simpanRun(r); audit('tinjau-run', r.id); invalidate();
            sukses('Run ' + r.id + ' ditinjau.', 'Kini menunggu persetujuan finance approver.');
            renderPanel('run'); paintBuku();
          }
        }, 'Tinjau'));
      }
      if (r.status === 'ditinjau') {
        chips.appendChild(h('button', {
          class: 'btn primary small', type: 'button', 'data-fkey': 'run:kunci:' + r.id,
          disabled: !P.boleh(state.peran, 'run.kunci') ? true : null,
          onclick: function () {
            if (!bolehkah('run.kunci')) { renderPanel('run'); return; }
            try { P.kunci(r, state.peran, P.PERAN[state.peran].label); }
            catch (e) { tolak('Gagal mengunci.', String(e.message)); renderPanel('run'); return; }
            simpanRun(r); audit('kunci-run', r.id); invalidate();
            sukses('Run ' + r.id + ' dikunci.', 'Totalnya dihitung ulang dari slipnya saat dikunci. Perbaikan setelah ini harus lewat run penyesuaian.');
            renderPanel('run'); paintBuku();
          }
        }, 'Kunci'));
      }
      if (isReg && r.status === 'terkunci') {
        chips.appendChild(h('button', {
          class: 'btn small', type: 'button', 'data-fkey': 'run:adj:' + r.bulan,
          disabled: !P.boleh(state.peran, 'run.penyesuaian') ? true : null,
          title: 'Buat run penyesuaian terpisah; run yang terkunci tidak disentuh',
          onclick: function () { jalankanRun(y, r.bulan, 'penyesuaian'); }
        }, 'Penyesuaian'));
      }
      return chips;
    }

    function barisRun(r, labelBulan, isReg, adaAdj) {
      return h('tr', { class: state.sel.runId === r.id ? 'sel' : null },
        td(labelBulan
          ? h('b', { text: labelBulan })
          : h('span', { class: 'small', style: 'color:var(--faint)', text: '↳' })),
        td(h('span', null,
          h('button', {
            class: 'linkbtn nip', type: 'button', 'data-fkey': 'run:buka:' + r.id,
            onclick: function () { state.sel.runId = r.id; state.sel.bulan = r.bulan; renderPanel('run'); }
          }, r.id),
          r.jenis === 'penyesuaian'
            ? h('span', { class: 'pill warn', style: 'margin-left:6px', text: r.pajakSaja ? 'pajak saja' : 'penyesuaian' })
            : null)),
        td(statusPill(r)),
        tdNum(r.slips.length),
        tdRp(r.total.bruto, r.total.bruto ? 'plus' : 'nol'),
        tdRp(r.total.dedPph21, r.total.dedPph21 < 0 ? 'minus' : 'pajak'),
        tdRp(r.total.dedTotal, 'minus'),
        tdRp(r.total.neto),
        tdRp(r.total.ptgTotal, r.total.ptgTotal ? 'pemberi' : 'nol'),
        td(barisAksi(r, isReg, adaAdj)));
    }

    var rows = [];
    for (var m = 1; m <= 12; m++) {
      (function (m) {
        var reg = runOf(y, m);
        var adj = runIds()
          .filter(function (id) { return state.runs[id].tahun === y && state.runs[id].bulan === m && state.runs[id].jenis === 'penyesuaian'; })
          .map(function (id) { return state.runs[id]; });
        if (!reg && !adj.length) {
          rows.push(h('tr', null,
            td(h('b', { text: D.BULAN[m - 1] })),
            td(h('span', { class: 'small', style: 'color:var(--faint)', text: 'belum dijalankan' })),
            td(h('span', { class: 'pill', text: '—' })),
            tdNum(0), tdRp(0, 'nol'), tdRp(0, 'nol'), tdRp(0, 'nol'), tdRp(0, 'nol'), tdRp(0, 'nol'),
            td(h('div', { class: 'chips' }, h('button', {
              class: 'btn small', type: 'button', 'data-fkey': 'run:jalankan:' + m,
              disabled: !P.boleh(state.peran, 'run.jalankan') ? true : null,
              onclick: function () { jalankanRun(y, m, 'reguler'); }
            }, 'Jalankan')))));
          return;
        }
        var pertama = true;
        if (reg) { rows.push(barisRun(reg, D.BULAN[m - 1], true, adj.length > 0)); pertama = false; }
        adj.forEach(function (r) {
          rows.push(barisRun(r, pertama ? D.BULAN[m - 1] : null, false, true));
          pertama = false;
        });
        if ((reg ? 1 : 0) + adj.length > 1) {
          var ef = P.efektifBulan(state.runs, y, m);
          rows.push(h('tr', { class: 'sub-row' },
            td(''),
            td(h('span', { class: 'small', text: 'efektif ' + D.BULAN[m - 1] + ' (jumlah seluruh dokumennya)' })),
            td(''), tdNum(ef.slip),
            tdRp(ef.total.bruto), tdRp(ef.total.dedPph21), tdRp(ef.total.dedTotal),
            tdRp(ef.total.neto), tdRp(ef.total.ptgTotal), td('')));
        }
      })(m);
    }

    var totalTahun = P.totalKosong();
    runIds().forEach(function (id) {
      if (state.runs[id].tahun !== y) return;
      P.KOLOM.forEach(function (c) { totalTahun[c] += state.runs[id].total[c]; });
    });
    rows.push(h('tr', { class: 'total-row' },
      td('Setahun'), td(h('span', { class: 'small', text: 'seluruh dokumen' })), td(''), tdNum(0),
      tdRp(totalTahun.bruto), tdRp(totalTahun.dedPph21),
      tdRp(totalTahun.dedTotal), tdRp(totalTahun.neto), tdRp(totalTahun.ptgTotal), td('')));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Payroll run ' + y }),
      h('p', { class: 'note' },
        'Tiga peran, tiga tanda tangan: payroll officer MENGHITUNG dan MENINJAU, finance approver ',
        'MENGUNCI, HR admin tidak menyentuh keduanya. Run yang terkunci tidak bisa diubah — perbaikan ',
        'membuat run PENYESUAIAN terpisah dengan id sendiri, yang menjalani daur hidup yang sama persis: ',
        'draft → ditinjau → terkunci. Satu baris di sini adalah satu DOKUMEN, bukan satu bulan, sehingga ',
        'baris-barisnya menjumlah tepat ke baris Setahun dan koreksi tidak pernah tersembunyi di balik ',
        'angka bulan yang sudah usang. Peran aktif: ',
        h('b', { text: P.PERAN[state.peran].label }), '. ', P.PERAN[state.peran].catatan),
      tableOf([
        { label: 'Bulan' }, { label: 'Run' }, { label: 'Status' }, { label: 'Slip', num: true },
        { label: 'Bruto', num: true }, { label: 'PPh 21', num: true }, { label: 'Potongan', num: true },
        { label: 'Neto', num: true }, { label: 'Beban pemberi', num: true }, { label: 'Aksi' }
      ], rows, { minWidth: '1120px' })));

    var run = state.sel.runId ? state.runs[state.sel.runId] : runOf(y, 12);
    if (run) p.appendChild(kartuRun(run));
    else p.appendChild(h('div', { class: 'empty', text: 'Pilih satu run di atas, atau jalankan salah satu bulan.' }));
    p.appendChild(kartuJejak());
  }

  /* THE AUDIT TRAIL, READ BACK.
   * Every privileged action was already being written to the `audit` object
   * store, and nothing in the app ever read one row of it — so the question
   * store.js says the trail exists to answer, "who approved the November run",
   * could not be answered from the app that recorded the answer. It is a table
   * over data that was already there. */
  function kartuJejak() {
    var rows = state.audit.slice(0, 60).map(function (r) {
      var t = new Date(r.at || 0);
      var jam = isNaN(t.getTime()) ? '—' : (D.ymd(t.getTime()) + ' ' +
        ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2));
      var peran = P.PERAN[r.peran];
      return h('tr', null,
        td(h('span', { class: 'mono small', text: jam })),
        td(h('span', { class: 'pill info', text: peran ? peran.label : (r.peran || '—') })),
        td(h('span', { class: 'mono small', text: r.aksi })),
        td(h('span', { class: 'small wrap-normal', text: r.detail || '' })));
    });
    return h('div', { class: 'card' },
      h('h3', { text: 'Jejak audit — siapa melakukan apa, di peran apa' }),
      h('p', { class: 'note' },
        '"Siapa menyetujui run November" adalah pertanyaan pertama seorang auditor, dan satu-satunya alasan ',
        'kunci itu berarti. Setiap tindakan berhak — mengubah data induk, menyetujui cuti, menjalankan, ',
        'meninjau dan mengunci run, menghapus data lokal — ditulis ke object store ',
        h('code', { text: 'audit' }), ' dan dibaca kembali di sini, terbaru di atas. Jejak ini ikut terhapus ',
        'kalau Anda menekan "Hapus data lokal", karena ia bagian dari data lokal Anda dan tidak pernah ke mana pun.'),
      rows.length
        ? tableOf([{ label: 'Waktu' }, { label: 'Peran' }, { label: 'Aksi' }, { label: 'Rincian' }], rows, { minWidth: '760px' })
        : h('div', { class: 'empty', text: 'Belum ada tindakan tercatat di sesi ini. Jalankan, tinjau atau kunci sebuah run dan barisnya muncul di sini.' }));
  }

  function kartuRun(run) {
    var t = run.total;
    var hitungUlang = P.totalDari(run.slips);
    var cocok = P.KOLOM.every(function (c) { return t[c] === hitungUlang[c]; });
    var koreksi = run.slips.filter(function (s) { return s.pajak.metode === 'setahun'; });
    var restitusi = run.slips.filter(function (s) { return s.k.dedPph21 < 0; });

    var card = h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', null, run.id + ' — ' + D.namaBulan(run.bulan) + ' ' + run.tahun + ' ',
          run.jenis === 'penyesuaian' ? h('span', { class: 'pill warn', text: 'penyesuaian' }) : null),
        h('div', { class: 'chips' }, statusPill(run),
          h('span', { class: 'pill ' + (cocok ? 'ok' : 'bad'), text: cocok ? 'I2 total = Σ slip' : 'I2 GAGAL' }))),
      h('p', { class: 'note' },
        run.slips.length + ' slip. Dibuat oleh ' + run.dibuatOleh + (run.dibuatAt ? ' pada ' + run.dibuatAt : '') +
        (run.ditinjauOleh ? '; ditinjau ' + run.ditinjauOleh : '') +
        (run.dikunciOleh ? '; dikunci ' + run.dikunciOleh + (run.dikunciAt ? ' pada ' + run.dikunciAt : '') : '') + '. ' +
        (run.catatan || '')));

    if (run.jenis === 'penyesuaian') {
      card.appendChild(h('div', { class: 'callout warn' },
        h('b', { text: 'Angka di run ini adalah SELISIH, bukan penggantian. ' }),
        'Setiap kolom berisi (bulan yang dihitung ulang − yang sudah diposting untuk bulan itu), karena yang ' +
        'dibayarkan sebuah payroll koreksi memang hanya selisihnya. Menaruh angka penuh untuk kedua kalinya ' +
        'akan membuat tahun itu menghitung bulan ini dua kali, membuat rekonsiliasi Desember bertumpu pada ' +
        'riwayat yang tidak pernah dipotong, dan mematahkan invarian I3. Run yang sudah dikunci tidak ' +
        'disentuh sama sekali.'));
    }
    var sum = h('div', { class: 'summary' });
    sum.appendChild(statTile(run.jenis === 'penyesuaian' ? 'Selisih bruto' : 'Bruto dibayar', D.rupiah(t.bruto), 'jumlah baris pendapatan', 'plus'));
    sum.appendChild(statTile('Bruto pajak', D.rupiah(t.brutoPajak), '+ premi pemberi yang obyek pajak', 'pajak'));
    sum.appendChild(statTile('PPh 21', D.rupiah(t.dedPph21), koreksi.length + ' slip rekonsiliasi setahun', 'pajak'));
    sum.appendChild(statTile('Potongan pekerja', D.rupiah(t.dedTotal), 'BPJS + PPh 21', 'minus'));
    sum.appendChild(statTile('Neto', D.rupiah(t.neto), 'bruto − potongan'));
    sum.appendChild(statTile('Beban pemberi', D.rupiah(t.ptgTotal), 'bukan potongan karyawan', 'pemberi'));
    card.appendChild(sum);

    /* The identity, written out line by line rather than implied. */
    var rekon = h('div', { class: 'rekon' });
    function rk(l, n, cls) {
      rekon.appendChild(h('div', { class: 'rekon-baris ' + (cls || '') },
        h('span', { class: 'l', text: l }), h('span', { class: 'n', text: D.rupiah(n) })));
    }
    P.KOLOM_PENDAPATAN.forEach(function (c) { rk(P.LABEL[c], t[c]); });
    rk('Bruto', t.bruto, 'total');
    P.KOLOM_POTONGAN.forEach(function (c) { rk('− ' + P.LABEL[c], -t[c], 'kurang'); });
    rk('Neto dibayarkan', t.neto, 'total');
    var selisih = t.neto - (t.bruto - t.dedTotal);
    rekon.appendChild(h('div', { class: 'rekon-baris sisa' + (selisih ? ' rusak' : '') },
      h('span', { class: 'l', text: 'Selisih terhadap bruto − potongan (invarian I1, harus nol)' }),
      h('span', { class: 'n', text: D.rupiah(selisih) })));
    card.appendChild(h('h4', { style: 'margin-top:12px;font-size:13px', text: 'Rekonsiliasi run' }));
    card.appendChild(rekon);

    if (koreksi.length) {
      card.appendChild(h('div', { class: 'callout pajak', style: 'margin-top:12px' },
        h('b', { text: koreksi.length + ' slip di run ini memakai perhitungan setahun, bukan TER. ' }),
        'Itu bulan rekonsiliasi mereka: Desember bagi yang masih bekerja, bulan terakhir bagi yang berhenti. ' +
        (restitusi.length ? restitusi.length + ' di antaranya menghasilkan PPh 21 NEGATIF — restitusi lewat payroll, karena TER memotong lebih banyak dari kewajiban setahun, hampir selalu akibat bulan THR.' : '')));
    }

    var rows = run.slips.map(function (s) {
      return h('tr', null,
        td(h('button', {
          class: 'linkbtn nip', type: 'button', 'data-fkey': 'run:slip:' + fkey(s.nip),
          onclick: function () { state.sel.slipNip = s.nip; state.sel.slipBulan = run.bulan; switchTab('slip'); }
        }, s.nip)),
        td(h('span', { class: 'wrap-normal', text: s.nama })),
        td(h('span', { class: 'mono small', text: s.ptkp })),
        tdRp(s.k.bruto, 'plus'),
        tdRp(s.k.lembur, s.k.lembur ? 'plus' : 'nol'),
        tdRp(s.k.thr, s.k.thr ? 'plus' : 'nol'),
        tdRp(s.k.potonganAbsen, s.k.potonganAbsen ? 'minus' : 'nol'),
        tdRp(s.k.brutoPajak, 'pajak'),
        td(h('span', { class: 'pill ' + (s.pajak.metode === 'setahun' ? 'setahun' : 'ter'), text: s.pajak.metode === 'setahun' ? 'setahun' : 'TER ' + s.pajak.kategori + ' ' + D.persen(s.pajak.bp) })),
        tdRp(s.k.dedPph21, s.k.dedPph21 < 0 ? 'minus' : 'pajak'),
        tdRp(s.k.dedTotal, 'minus'),
        tdRp(s.k.neto),
        tdRp(s.k.ptgTotal, 'pemberi'));
    });
    var t2 = P.totalDari(run.slips);
    rows.push(h('tr', { class: 'total-row' },
      td('TOTAL'), td(run.slips.length + ' slip'), td(''),
      tdRp(t2.bruto), tdRp(t2.lembur), tdRp(t2.thr), tdRp(t2.potonganAbsen), tdRp(t2.brutoPajak), td(''),
      tdRp(t2.dedPph21), tdRp(t2.dedTotal), tdRp(t2.neto), tdRp(t2.ptgTotal)));
    card.appendChild(h('h4', { style: 'margin-top:14px;font-size:13px', text: 'Slip di run ini' }));
    card.appendChild(tableOf([
      { label: 'NIP' }, { label: 'Nama' }, { label: 'PTKP' }, { label: 'Bruto', num: true },
      { label: 'Lembur', num: true }, { label: 'THR', num: true }, { label: 'Absen', num: true },
      { label: 'Bruto pajak', num: true }, { label: 'Metode' }, { label: 'PPh 21', num: true },
      { label: 'Potongan', num: true }, { label: 'Neto', num: true }, { label: 'Beban pemberi', num: true }
    ], rows, { minWidth: '1240px' }));
    return card;
  }

  /* ============================================================ SLIP GAJI */

  function renderSlip(p) {
    renderPesan(p);
    var y = cfg().tahun;
    if (!state.sel.slipNip) state.sel.slipNip = ctx().karyawan[0].nip;
    var e = emp(state.sel.slipNip) || ctx().karyawan[0];
    var m = state.sel.slipBulan;

    var opt = ctx().karyawan.map(function (x) { return { value: x.nip, label: x.nip + ' — ' + x.nama }; });
    p.appendChild(h('div', { class: 'card no-print' },
      h('h3', { text: 'Slip gaji' }),
      h('p', { class: 'note' },
        'Tiga kolom yang tidak boleh bertemu: pendapatan, potongan pekerja, dan beban pemberi kerja. ',
        'Neto adalah pendapatan dikurangi potongan pekerja, dan hanya itu — beban pemberi kerja ditotal ',
        'terpisah dan tidak pernah menyentuh angka yang masuk rekening. Cetak halaman ini (Ctrl+P) dan hanya ',
        'slip ini yang keluar, di A4, dengan seluruh kolomnya utuh.'),
      h('div', { class: 'controls' },
        field('Karyawan', select(opt, e.nip, function (v) { state.sel.slipNip = v; renderPanel('slip'); }, { 'data-fkey': 'slip:karyawan', style: 'max-width:340px' }), 'grow'),
        field('Bulan', select(D.BULAN.map(function (b, i) { return { value: i + 1, label: b }; }), m, function (v) { state.sel.slipBulan = parseInt(v, 10); renderPanel('slip'); }, { 'data-fkey': 'slip:bulan' })),
        h('button', { class: 'btn', type: 'button', 'data-fkey': 'slip:cetak', onclick: function () { try { window.print(); } catch (err) { } } }, 'Cetak A4'))));

    /* EVERY DOCUMENT OF THE MONTH, not just the regular run. A payslip printed
     * from the regular run after a correction has been posted against that
     * month is a superseded document that contradicts the ledger the same app
     * shows two tabs away — and it says so nowhere on the paper. */
    var dok = P.slipTerposting(state.runs, e.nip, y, m);
    var run = runOf(y, m);
    if (!dok.length) {
      p.appendChild(h('div', { class: 'empty' },
        !run
          ? 'Run ' + D.namaBulan(m) + ' ' + y + ' belum dijalankan. Buka tab Payroll Run untuk menjalankannya.'
          : e.nama + ' tidak ada di run ' + D.namaBulan(m) + ' ' + y + ' — ia belum masuk atau sudah berhenti pada bulan itu.'));
      /* Never let a print produce a blank sheet without saying why. */
      p.appendChild(kartuCetakKosong('Tidak ada slip gaji untuk ' + e.nama + ' di ' + D.namaBulan(m) + ' ' + y + '.'));
      return;
    }
    var utama = null;
    dok.forEach(function (x) { if (x.run.jenis !== 'penyesuaian' && !utama) utama = x; });
    if (!utama) utama = dok[0];
    var koreksiDok = dok.filter(function (x) { return x !== utama; });
    p.appendChild(kartuSlip(utama.slip, utama.run, koreksiDok));
  }

  /* A print-only line, hidden on screen, so that printing a tab which has no
   * payslip on it produces a sheet that explains itself instead of a blank A4. */
  function kartuCetakKosong(pesan) {
    return h('div', { class: 'no-slip-print' },
      h('b', { text: 'Tidak ada slip gaji untuk dicetak. ' }), pesan, ' ',
      'Halaman ini hanya mencetak slip gaji dan rekapitulasi 1721-A1 di tab Laporan. ',
      'Buka tab Slip Gaji, pilih karyawan dan bulan yang punya run, lalu cetak.');
  }

  function kartuSlip(s, run, koreksiDok) {
    var k = s.k;
    koreksiDok = koreksiDok || [];
    var wrap = h('div', { class: 'slip-wrap' });
    var slip = h('div', { class: 'slip' });

    slip.appendChild(h('div', { class: 'slip-head' },
      h('div', null,
        h('h3', { text: 'Slip Gaji — ' + D.namaBulan(s.bulan) + ' ' + s.tahun }),
        h('div', { class: 'kecil', text: cfg().perusahaan + ' · NPWP ' + cfg().npwpPerusahaan }),
        h('div', { class: 'kecil', text: 'Dokumen demo atas data fabrikasi. Bukan slip gaji sebenarnya.' })),
      h('div', { class: 'slip-id' },
        h('div', { text: run.id + (run.jenis === 'penyesuaian' ? ' (penyesuaian)' : '') }),
        h('div', { text: 'status ' + run.status }),
        h('div', { text: 'dikunci: ' + (run.dikunciOleh || '—') }))));

    /* IF THIS MONTH HAS BEEN CORRECTED, THE PAPER SAYS SO. A printed payslip
     * that quietly disagrees with the ledger is the one document an employee
     * will keep and bring back. */
    if (koreksiDok.length) {
      var efek = P.sudahDiposting(state.runs, s.nip, s.tahun, s.bulan);
      var kor = h('div', { class: 'callout warn slip-koreksi' },
        h('b', { text: 'Slip ini SUDAH DIKOREKSI oleh ' + koreksiDok.length + ' run penyesuaian. ' }),
        'Angka di bawah adalah run ' + run.id + ' seperti diposting; yang benar-benar dibayarkan untuk ' +
        D.namaBulan(s.bulan) + ' ' + s.tahun + ' adalah jumlah dokumen-dokumen bulan ini.');
      koreksiDok.forEach(function (x) {
        kor.appendChild(h('div', { class: 'kol-baris' },
          h('span', { class: 'l', text: x.run.id + (x.run.pajakSaja ? ' (pajak saja)' : '') + ' — status ' + x.run.status }),
          h('span', { class: 'n', text: 'PPh 21 ' + D.rupiah(x.slip.k.dedPph21) + ' · neto ' + D.rupiah(x.slip.k.neto) })));
      });
      kor.appendChild(h('div', { class: 'kol-baris jumlah' },
        h('span', { class: 'l', text: 'Efektif dibayarkan bulan ini (seluruh dokumen)' }),
        h('span', { class: 'n', text: 'PPh 21 ' + D.rupiah(efek.dedPph21) + ' · neto ' + D.rupiah(efek.neto) })));
      slip.appendChild(kor);
    }

    var kv = h('dl', { class: 'kv2' });
    function row(a, b) { kv.appendChild(h('dt', { text: a })); kv.appendChild(h('dd', { class: 'wrap-normal', text: b })); }
    row('Nama', s.nama);
    row('NIP', s.nip);
    row('Jabatan', s.jabatan + ' · ' + s.divisi);
    row('NPWP', s.npwp);
    row('Rekening', s.rekening);
    row('Status PTKP', s.ptkp + ' (kategori TER ' + D.kategoriTER(s.ptkp) + ', PTKP setahun ' + D.rupiah(D.ptkpOf(s.ptkp)) + ')');
    row('Upah sebulan', D.rupiah(s.upahSebulan) + ' — dasar lembur, BPJS dan THR');
    row('Kehadiran', s.hariHadir + ' hadir dari ' + (s.prorata ? s.hariKerjaAktif + ' hari kerja masa aktif (' + s.hariKerja + ' hari kerja sebulan)' : s.hariKerja + ' hari kerja') + ' · cuti ' + s.hariCuti + ' · sakit ' + s.hariSakit + ' · tanpa upah ' + s.hariTanpaUpah);
    if (s.prorata) {
      row('Prorata bulan pertama/terakhir',
        s.hariKerjaAktif + ' dari ' + s.hariKerja + ' hari kerja. Gaji pokok dan tunjangan tetap dibayar ' +
        s.hariKerjaAktif + '/' + s.hariKerja + ' — dasar BPJS, lembur dan THR tetap upah sebulan penuh ' + D.rupiah(s.upahSebulan) + '.');
    }
    row('Kelas risiko JKK', s.risiko + ' (' + D.persen(D.JKK_KELAS[s.risiko].bp) + ')');
    slip.appendChild(kv);

    var kolom = h('div', { class: 'slip-kolom', style: 'margin-top:14px' });

    var kp = h('div', { class: 'kol-blok pendapatan' }, h('h4', { text: 'Pendapatan' }));
    P.KOLOM_PENDAPATAN.forEach(function (c) {
      if (k[c] === 0 && c !== 'pokok') return;
      kp.appendChild(h('div', { class: 'kol-baris' },
        h('span', { class: 'l', text: P.LABEL[c] }),
        h('span', { class: 'n rp ' + kelasUang(k[c]), text: D.rupiah(k[c]) })));
    });
    kp.appendChild(h('div', { class: 'kol-baris jumlah' },
      h('span', { class: 'l', text: 'Bruto' }), h('span', { class: 'n', text: D.rupiah(k.bruto) })));
    kolom.appendChild(kp);

    var kd = h('div', { class: 'kol-blok potongan' }, h('h4', { text: 'Potongan pekerja' }));
    P.KOLOM_POTONGAN.forEach(function (c) {
      kd.appendChild(h('div', { class: 'kol-baris' },
        h('span', { class: 'l', text: P.LABEL[c] }),
        h('span', { class: 'n rp ' + (k[c] < 0 ? 'plus' : kelasUang(k[c], 'minus')), text: D.rupiah(k[c]) })));
    });
    kd.appendChild(h('div', { class: 'kol-baris jumlah' },
      h('span', { class: 'l', text: 'Total potongan' }), h('span', { class: 'n', text: D.rupiah(k.dedTotal) })));
    kolom.appendChild(kd);

    var ke = h('div', { class: 'kol-blok pemberi' }, h('h4', { text: 'Beban pemberi kerja' }));
    P.KOLOM_PEMBERI.forEach(function (c) {
      ke.appendChild(h('div', { class: 'kol-baris' },
        h('span', { class: 'l', text: P.LABEL[c] }),
        h('span', { class: 'n rp pemberi', text: D.rupiah(k[c]) })));
    });
    ke.appendChild(h('div', { class: 'kol-baris jumlah' },
      h('span', { class: 'l', text: 'Total beban' }), h('span', { class: 'n', text: D.rupiah(k.ptgTotal) })));
    ke.appendChild(h('div', { class: 'kol-baris' },
      h('span', { class: 'l', text: 'Tidak dipotong dari karyawan' }), h('span', { class: 'n', text: 'Rp0' })));
    kolom.appendChild(ke);
    slip.appendChild(kolom);

    slip.appendChild(h('div', { class: 'neto-blok' },
      h('div', { class: 'k', style: 'font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint)', text: 'Diterima (neto)' }),
      h('div', { class: 'besar', text: D.rupiah(k.neto) }),
      /* A December refund can exceed the BPJS deductions, which makes TOTAL
       * deductions negative and net pay LARGER than gross. That is arithmetically
       * right and it is what the employee's bank account will show, but printing
       * it as "bruto − -Rp787.648" reads like a typo, so the sign is folded into
       * the operator and the reason is stated. */
      h('div', { class: 'rumus', text: k.dedTotal < 0
        ? D.rupiah(k.bruto) + ' + ' + D.rupiah(-k.dedTotal) + ' = ' + D.rupiah(k.neto)
        : D.rupiah(k.bruto) + ' − ' + D.rupiah(k.dedTotal) + ' = ' + D.rupiah(k.neto) }),
      k.dedTotal < 0
        ? h('div', { class: 'rumus', style: 'color:var(--warn)', text: 'Total potongan NEGATIF: restitusi PPh 21 ' + D.rupiah(-k.dedPph21) + ' melebihi iuran BPJS pekerja ' + D.rupiah(k.dedKes + k.dedJht + k.dedJp) + ', jadi neto bulan ini di atas bruto.' })
        : null,
      h('div', { class: 'rumus', style: 'color:var(--faint)', text: 'Biaya total pemberi kerja atas slip ini: ' + D.rupiah(k.bruto) + ' + ' + D.rupiah(k.ptgTotal) + ' = ' + D.rupiah(k.bruto + k.ptgTotal) })));

    /* The tax working, on the payslip, because an employee who cannot see how
     * their PPh 21 was reached has to take it on trust. */
    var pj = s.pajak;
    var tb = h('div', { class: 'kol-blok', style: 'margin-top:12px' },
      h('h4', { text: 'Dasar PPh 21 bulan ini' }));
    function tbrow(a, b, cls) {
      tb.appendChild(h('div', { class: 'kol-baris ' + (cls || '') },
        h('span', { class: 'l', text: a }), h('span', { class: 'n', text: b })));
    }
    tbrow('Bruto yang dibayarkan', D.rupiah(k.bruto));
    tbrow('+ BPJS Kesehatan pemberi 4% (obyek pajak)', D.rupiah(k.premiKes));
    tbrow('+ JKK ' + D.persen(D.JKK_KELAS[s.risiko].bp) + ' (obyek pajak)', D.rupiah(k.premiJkk));
    tbrow('+ JKM 0,30% (obyek pajak)', D.rupiah(k.premiJkm));
    tbrow('JHT dan JP pemberi kerja TIDAK ditambahkan', 'Rp0');
    tbrow('Bruto pajak', D.rupiah(k.brutoPajak), 'jumlah');
    if (pj.metode === 'ter') {
      tbrow('Kategori TER (dari status ' + s.ptkp + ')', pj.kategori);
      tbrow('Band bruto ' + D.rupiah(pj.band.dari) + ' – ' + (pj.band.sampai === null ? 'ke atas' : D.rupiah(pj.band.sampai)), D.persen(pj.bp));
      tbrow('PPh 21 = ' + D.persen(pj.bp) + ' × ' + D.rupiah(k.brutoPajak) + ', dibulatkan ke bawah', D.rupiah(k.dedPph21), 'jumlah');
      tb.appendChild(h('p', { class: 'hint', style: 'margin-top:6px;white-space:normal' },
        'Ini pencarian tabel, bukan perhitungan setahun. Rekonsiliasi setahunnya terjadi di bulan ' +
        D.namaBulan(s.bulanKoreksi) + ', dan selisih yang terkumpul sepanjang tahun masuk di sana.'));
    } else {
      var th = pj.tahunan;
      tbrow('Bruto pajak setahun (' + pj.bulanKerja + ' bulan kerja)', D.rupiah(th.brutoTahun));
      tbrow('− biaya jabatan 5%' + (th.biayaJabatanKena ? ' (kena plafon ' + D.rupiah(th.biayaJabatanCap) + ')' : ''), D.rupiah(-th.biayaJabatan));
      tbrow('− JHT pekerja setahun', D.rupiah(-th.jhtPekerja));
      tbrow('− JP pekerja setahun', D.rupiah(-th.jpPekerja));
      tbrow('Penghasilan neto setahun', D.rupiah(th.neto), 'jumlah');
      tbrow('− PTKP ' + s.ptkp, D.rupiah(-th.ptkp));
      tbrow('PKP (dibulatkan ke bawah ribuan penuh)', D.rupiah(th.pkp), 'jumlah');
      th.lapis.forEach(function (l) {
        tbrow('   ' + D.persen(l.bp) + ' × ' + D.rupiah(l.dasar), D.rupiah(l.pajak));
      });
      tbrow('PPh 21 setahun', D.rupiah(th.pph), 'jumlah');
      tbrow('− sudah dipotong bulan sebelumnya (TER)', D.rupiah(-pj.sudahDipotong));
      tbrow('PPh 21 bulan ini (rekonsiliasi)', D.rupiah(k.dedPph21), 'jumlah');
      tb.appendChild(h('p', { class: 'hint', style: 'margin-top:6px;white-space:normal' },
        pj.pph21 < 0
          ? 'Angka ini NEGATIF: sepanjang tahun tarif TER memotong lebih banyak dari kewajiban setahun — ' +
          'hampir selalu karena bulan THR mendorong bruto ke band TER yang jauh lebih tinggi — dan kelebihannya ' +
          'dikembalikan lewat payroll bulan ini. Seandainya bulan ini juga dihitung dengan TER, potongannya ' +
          D.rupiah(pj.terSeandainya) + '.'
          : 'Seandainya bulan ini juga dihitung dengan TER, potongannya ' + D.rupiah(pj.terSeandainya) +
          '; selisih ' + D.rupiah(k.dedPph21 - pj.terSeandainya) + ' adalah koreksi yang terkumpul sepanjang tahun.'));
    }
    slip.appendChild(tb);

    /* Overtime detail, when there is any. */
    if (s.lemburBaris.length) {
      var lb = h('div', { class: 'kol-blok', style: 'margin-top:12px' }, h('h4', { text: 'Rincian lembur (Kepmenaker 102/2004)' }));
      lb.appendChild(h('div', { class: 'kol-baris' },
        h('span', { class: 'l', text: 'Upah sejam = 1/173 × ' + D.rupiah(s.upahSebulan) }),
        h('span', { class: 'n', text: D.rupiah(D.divRound(s.upahSebulan, D.LEMBUR_DIVISOR)) })));
      s.lemburBaris.forEach(function (b) {
        lb.appendChild(h('div', { class: 'kol-baris' },
          h('span', { class: 'l', text: D.tglPanjang(b.tgl) + ' · ' + b.jam + ' jam · ' + (b.libur ? 'hari libur' : 'hari kerja') + ' · pengali ' + (b.bobot / 100) + 'x' }),
          h('span', { class: 'n', text: D.rupiah(b.rupiah) })));
      });
      lb.appendChild(h('div', { class: 'kol-baris jumlah' },
        h('span', { class: 'l', text: 'Total lembur' }), h('span', { class: 'n', text: D.rupiah(k.lembur) })));
      slip.appendChild(lb);
    }

    if (s.thrInfo) {
      var tr = h('div', { class: 'kol-blok', style: 'margin-top:12px' }, h('h4', { text: 'THR (PP 36/2021 Pasal 9)' }));
      tr.appendChild(h('div', { class: 'kol-baris' },
        h('span', { class: 'l', text: 'Masa kerja per Hari Raya ' + D.tglPanjang(s.thrInfo.tglHariRaya || s.thrInfo.tglBayar) + ' (Pasal 2 dan 3)' }),
        h('span', { class: 'n', text: s.thrInfo.bulanMasaKerja + ' bulan' })));
      tr.appendChild(h('div', { class: 'kol-baris' },
        h('span', { class: 'l', text: 'Dibayarkan pada ' + D.tglPanjang(s.thrInfo.tglBayar) + ' — batas akhir tujuh hari sebelum Hari Raya (Pasal 5 ayat 4)' }),
        h('span', { class: 'n', text: '' })));
      tr.appendChild(h('div', { class: 'kol-baris' },
        h('span', { class: 'l', text: s.thrInfo.penuh ? 'Hak penuh: satu bulan upah' : (s.thrInfo.nihil ? 'Belum satu bulan masa kerja: belum berhak' : 'Prorata ' + s.thrInfo.bulanMasaKerja + '/12 × ' + D.rupiah(s.upahSebulan)) }),
        h('span', { class: 'n', text: D.rupiah(k.thr) })));
      slip.appendChild(tr);
    }

    if (s.hariTanpaUpah) {
      slip.appendChild(h('div', { class: 'kol-blok', style: 'margin-top:12px' },
        h('h4', { text: 'Pengurang absen tanpa upah' }),
        h('div', { class: 'kol-baris' },
          h('span', { class: 'l', text: s.hariTanpaUpah + ' hari dari ' + s.hariKerja + ' hari kerja bulan ini × ' + D.rupiah(s.upahSebulan) }),
          h('span', { class: 'n', text: D.rupiah(k.potonganAbsen) })),
        h('p', { class: 'hint', style: 'white-space:normal' },
          'Pembaginya hari kerja NYATA bulan ini, bukan 21 atau 22. Ia mengurangi upah, jadi tampil sebagai ' +
          'baris pendapatan negatif dan ikut menurunkan dasar pajak — bukan sebagai potongan setelah pajak.')));
    }

    wrap.appendChild(slip);
    return wrap;
  }

  /* ============================================================== PPh 21 */

  function renderPph(p) {
    renderPesan(p);
    var y = cfg().tahun;
    if (!state.sel.pphNip) state.sel.pphNip = ctx().karyawan[0].nip;
    var e = emp(state.sel.pphNip) || ctx().karyawan[0];
    var statusEfektif = state.sel.pphSim || e.ptkp;
    var kategori = D.kategoriTER(statusEfektif);

    var opt = ctx().karyawan.map(function (x) { return { value: x.nip, label: x.nip + ' — ' + x.nama + ' (' + x.ptkp + ')' }; });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'PPh 21 di bawah rezim TER — dan rekonsiliasi setahunnya' }),
      h('p', { class: 'note' },
        'Sejak PP 58/2023 potongan bulanan Januari–November adalah SATU PENCARIAN: status PTKP memilih satu ',
        'dari tiga tabel Tarif Efektif Rata-rata, bruto bulan itu memilih satu band di dalamnya, dan tarif ',
        'band itu dikenakan langsung. Sengaja hanya pendekatan. Di bulan Desember — atau di bulan terakhir ',
        'bekerja bagi yang berhenti — perhitungan setahun penuh diulang dan potongan bulan itu ditetapkan ',
        'sebagai selisihnya. Jumlah dua belas potongan karena itu SAMA DENGAN perhitungan setahun, tepat ke ',
        'rupiah. Itulah invarian I3, dan itulah yang salah di software payroll.'),
      h('div', { class: 'controls' },
        field('Karyawan', select(opt, e.nip, function (v) {
          state.sel.pphNip = v; state.sel.pphSim = null; renderPanel('pph');
        }, { 'data-fkey': 'pph:karyawan', style: 'max-width:340px' }), 'grow'),
        field('Status PTKP (simulasi)', select(D.STATUS_PTKP.map(function (s) {
          return { value: s, label: s + ' — ' + D.rupiah(D.ptkpOf(s)) + ' · TER ' + D.kategoriTER(s) };
        }), statusEfektif, function (v) {
          state.sel.pphSim = (v === e.ptkp) ? null : v;
          renderPanel('pph');
          say('Simulasi status ' + v + ', kategori TER ' + D.kategoriTER(v) + '. Seluruh proyeksi dua belas bulan dihitung ulang.');
        }, { 'data-fkey': 'pph:sim' })),
        state.sel.pphSim
          ? h('button', {
            class: 'btn', type: 'button', 'data-fkey': 'pph:terapkan',
            disabled: !P.boleh(state.peran, 'karyawan.ubah') ? true : null,
            title: 'Simpan ke data induk. Run yang sudah dikunci tidak berubah; rekonsiliasi Desember menyerap selisihnya.',
            onclick: function () {
              var baru = state.sel.pphSim;
              ubahKaryawan(e.nip, function (x) { x.ptkp = baru; }, 'PTKP -> ' + baru);
              state.sel.pphSim = null;
              sukses('Status PTKP ' + e.nama + ' menjadi ' + baru + '.',
                'Run yang sudah dikunci TIDAK berubah — itu memang benar. Jalankan ulang Desember di tab Payroll Run dan rekonsiliasinya akan menyerap seluruh selisihnya.');
              renderPanel('pph');
            }
          }, 'Terapkan ke data induk')
          : null),
      state.sel.pphSim
        ? h('div', { class: 'callout warn' },
          h('b', { text: 'Mode simulasi. ' }),
          'Status ' + statusEfektif + ' hanya dipakai untuk proyeksi di halaman ini; data induk ' + e.nama +
          ' masih ' + e.ptkp + ' dan run yang sudah dijalankan tidak bergerak. Bandingkan angkanya, lalu ' +
          'terapkan kalau memang mau.')
        : null));

    /* Which TER category, and why. */
    var banding = h('div', { class: 'banding' });
    T.KATEGORI.forEach(function (kat) {
      var isi = T.KATEGORI_ISI[kat];
      banding.appendChild(h('div', { class: 'kat-kartu' + (kat === kategori ? ' aktif' : '') },
        h('h4', null, 'TER ' + kat, kat === kategori ? h('span', { class: 'pill info', text: ' dipakai' }) : null),
        h('div', { class: 'kecil', text: 'PTKP ' + isi.ptkp.map(function (n) { return D.rupiah(n); }).join(' dan ') }),
        h('div', { class: 'kecil', text: 'Status: ' + isi.status.join(', ') }),
        h('div', { class: 'angka', text: T.TER[kat].length + ' band' }),
        h('div', { class: 'kecil', text: 'bebas potongan s.d. ' + D.rupiah(T.TER[kat][0].sampai) })));
    });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Kategori TER ' + kategori + ' — dari status ' + statusEfektif }),
      h('p', { class: 'note' },
        'PP 58/2023 mengelompokkan delapan status PTKP ke tiga kategori MENURUT JUMLAH PTKP-nya, bukan menurut ',
        'bentuk keluarganya. Karena itu K/0 dan TK/1 mendarat di kategori yang sama (keduanya ' +
        D.rupiah(58500000) + '), dan begitu juga TK/3 dengan K/2. Itu isi peraturannya, bukan penyederhanaan.'),
      banding));

    /* The full year: TER months, the correction month, and the reconciliation. */
    var aktif = P.bulanAktif(e, y);
    if (!aktif.length) {
      p.appendChild(h('div', { class: 'empty', text: e.nama + ' tidak aktif di tahun ' + y + '.' }));
      return;
    }
    var riwayat = P.riwayatPajak(state.runs, e.nip, y);
    /* Collapse a month's records into one. A month that has been corrected has
     * TWO records — the locked regular run and the adjustment run's delta — and
     * the twelve-row ladder is a view of twelve MONTHS, not of however many
     * documents happened to touch them. Summing is the right merge precisely
     * because an adjustment carries a delta. */
    var perBulan = {}, urutBulan = [];
    riwayat.forEach(function (r) {
      if (!perBulan[r.bulan]) { perBulan[r.bulan] = { bulan: r.bulan, brutoPajak: 0, jhtPekerja: 0, jpPekerja: 0, dipotong: 0, n: 0, dok: [] }; urutBulan.push(r.bulan); }
      var g = perBulan[r.bulan];
      g.brutoPajak += r.brutoPajak; g.jhtPekerja += r.jhtPekerja; g.jpPekerja += r.jpPekerja;
      /* WHAT WAS ACTUALLY WITHHELD, carried alongside the recomputation. */
      g.dipotong += r.pph21; g.n++; g.dok.push(r.runId);
    });
    urutBulan.sort(function (a2, b2) { return a2 - b2; });
    var bulanan = urutBulan.map(function (m2) { return perBulan[m2]; });
    var adaKoreksiDok = urutBulan.some(function (m2) { return perBulan[m2].n > 1; });
    if (!bulanan.length) {
      p.appendChild(h('div', { class: 'empty', text: 'Belum ada run yang memuat ' + e.nama + '. Jalankan payroll di tab Payroll Run.' }));
      return;
    }
    var rencana = T.rencanaTahun({ status: statusEfektif, bulanan: bulanan, bulanKoreksi: P.bulanKoreksi(e, y) });

    /* TWO COLUMNS, NAMED: what this page RECOMPUTES ("seharusnya") and what the
     * ledger actually WITHHELD ("dipotong"). They were one column before, and
     * the reconciliation row underneath compared the recomputation against
     * itself: rencanaTahun sets the correction month to (annual − accumulated),
     * so the difference was zero by construction and the row labelled
     * "invarian I3, harus nol" was arithmetically incapable of being anything
     * else. It stayed green through a ledger with a million rupiah missing from
     * it while the header badge — which reads the raw records — went red. */
    var ladder = h('div', null);
    rencana.bulanan.forEach(function (b) {
      var koreksi = b.metode === 'setahun';
      var nyata = perBulan[b.bulan] ? perBulan[b.bulan].dipotong : 0;
      var beda = nyata !== b.pph21;
      ladder.appendChild(h('div', { class: 'ter-baris' + (koreksi ? ' koreksi' : '') },
        h('span', { class: 'bl', text: D.BULAN_PENDEK[b.bulan - 1] }),
        h('span', { class: 'n', style: 'white-space:normal' },
          h('span', { text: D.rupiah(b.brutoPajak) + ' · ' }),
          koreksi
            ? h('span', { class: 'pill setahun', text: 'setahun' })
            : h('span', { class: 'pill ter', text: 'TER ' + b.kategori + ' ' + D.persen(b.bp) }),
          koreksi ? null : h('span', { class: 'bl', text: ' band ' + D.rupiah(b.band.dari) + '–' + (b.band.sampai === null ? '∞' : D.rupiah(b.band.sampai)) }),
          perBulan[b.bulan] && perBulan[b.bulan].n > 1
            ? h('span', { class: 'bl', text: ' · ' + perBulan[b.bulan].n + ' dokumen' }) : null),
        h('span', { class: 'n', style: 'white-space:normal', text: 'seharusnya ' + D.rupiah(b.pph21) }),
        h('span', {
          class: 'n rp ' + (beda ? 'minus' : (nyata < 0 ? 'minus' : 'pajak')),
          title: beda ? 'Yang dipotong berbeda dari perhitungan ulang halaman ini' : 'Dipotong sesuai perhitungan',
          text: 'dipotong ' + D.rupiah(nyata) + (beda ? ' ≠' : '')
        })));
    });

    var th = rencana.tahunan;
    var rekon = h('div', { class: 'rekon' });
    function rk(l, n, cls) {
      rekon.appendChild(h('div', { class: 'rekon-baris ' + (cls || '') },
        h('span', { class: 'l', text: l }), h('span', { class: 'n', text: typeof n === 'string' ? n : D.rupiah(n) })));
    }
    rk('Bruto pajak setahun (' + th.bulanKerja + ' bulan kerja)', th.brutoTahun);
    rk('− biaya jabatan 5% = ' + D.rupiah(th.biayaJabatanKotor) + (th.biayaJabatanKena ? ', dibatasi plafon ' + D.rupiah(th.biayaJabatanCap) + ' (' + th.bulanKerja + ' × ' + D.rupiah(D.BIAYA_JABATAN_CAP_BULAN) + ')' : ''), -th.biayaJabatan, 'kurang');
    rk('− JHT pekerja 2% setahun', -th.jhtPekerja, 'kurang');
    rk('− JP pekerja 1% setahun', -th.jpPekerja, 'kurang');
    rk('Penghasilan neto setahun', th.neto, 'total');
    rk('− PTKP ' + statusEfektif + ' (tidak diprorata)', -th.ptkp, 'kurang');
    rk('PKP sebelum pembulatan', th.pkpKasar);
    rk('PKP dibulatkan ke bawah ribuan penuh (UU PPh Pasal 17 ayat 4)', th.pkp, 'total');
    th.lapis.forEach(function (l) {
      rk('   lapisan ' + D.persen(l.bp) + ' atas ' + D.rupiah(l.dasar), l.pajak);
    });
    rk('PPh 21 SETAHUN', th.pph, 'total');
    rk('Sudah dipotong Januari–' + D.BULAN_PENDEK[rencana.bulanKoreksi - 2 < 0 ? 0 : rencana.bulanKoreksi - 2] + ' dengan TER', -rencana.akumTer, 'kurang');
    rk('Koreksi di bulan ' + D.namaBulan(rencana.bulanKoreksi), rencana.koreksi, 'total');

    /* THE ROW THAT CAN ACTUALLY GO RED. It reads the same records P.periksa
     * reads — the PPh 21 withheld in every posted document of the year — and
     * compares them against the annual liability computed at the status AS
     * WITHHELD, which is the one input the checker deliberately does not take
     * from live master data. Simulating a different status is a projection and
     * is labelled as one; it is not evidence that the ledger is broken. */
    var dipotongNyata = 0;
    riwayat.forEach(function (r) { dipotongNyata += r.pph21; });
    var statusWithheld = P.statusDipakai(state.runs, e, y);
    var brutoNyata = 0, jhtNyata = 0, jpNyata = 0;
    riwayat.forEach(function (r) { brutoNyata += r.brutoPajak; jhtNyata += r.jhtPekerja; jpNyata += r.jpPekerja; });
    var bulanAda = {};
    riwayat.forEach(function (r) { bulanAda[r.bulan] = 1; });
    var tahunLengkap = aktif.every(function (mm) { return bulanAda[mm]; });
    var thNyata = T.pph21Tahunan({
      status: statusWithheld, brutoTahun: brutoNyata, bulanKerja: aktif.length,
      jhtPekerja: jhtNyata, jpPekerja: jpNyata
    });
    var selisih = dipotongNyata - thNyata.pph;
    var i3Hijau = tahunLengkap && selisih === 0;

    rekon.appendChild(h('div', { class: 'rekon-baris' },
      h('span', { class: 'l', text: 'Σ PPh 21 yang BENAR-BENAR dipotong, dari ' + riwayat.length + ' dokumen slip di ledger' }),
      h('span', { class: 'n', text: D.rupiah(dipotongNyata) })));
    rekon.appendChild(h('div', { class: 'rekon-baris' },
      h('span', { class: 'l', text: '− PPh 21 setahun pada status SEBAGAIMANA DIPOTONG (' + statusWithheld + ')' + (statusWithheld !== e.ptkp ? ' — data induk kini ' + e.ptkp + ', itu koreksi tertunggak, bukan selisih aritmetik' : '') }),
      h('span', { class: 'n', text: D.rupiah(-thNyata.pph) })));
    rekon.appendChild(h('div', { class: 'rekon-baris sisa' + (i3Hijau ? '' : ' rusak') },
      h('span', { class: 'l', text: 'Selisih (invarian I3, harus nol)' + (tahunLengkap ? '' : ' — tahun belum lengkap, ' + Object.keys(bulanAda).length + ' dari ' + aktif.length + ' bulan diposting') }),
      h('span', { class: 'n', text: D.rupiah(selisih) })));
    if (state.sel.pphSim) {
      rekon.appendChild(h('div', { class: 'rekon-baris' },
        h('span', { class: 'l', text: 'Tangga dan perhitungan di atas memakai status SIMULASI ' + statusEfektif + ' — proyeksi, bukan yang dipotong' }),
        h('span', { class: 'n', text: D.rupiah(rencana.totalDipotong) + ' proyeksi' })));
    }

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Dua belas bulan ' + e.nama + ' — ' + statusEfektif + ', TER ' + kategori }),
        h('span', {
          class: 'pill ' + (i3Hijau ? 'ok' : (tahunLengkap ? 'bad' : 'warn')),
          text: i3Hijau ? 'I3 terpenuhi' : (tahunLengkap ? 'I3 GAGAL ' + D.rupiah(selisih) : Object.keys(bulanAda).length + '/' + aktif.length + ' bulan')
        })),
      adaKoreksiDok
        ? h('div', { class: 'callout warn' },
          h('b', { text: 'Sebagian bulan punya lebih dari satu dokumen. ' }),
          'Run penyesuaian mencatat SELISIH terhadap apa yang sudah diposting bulan itu, jadi tangga di ' +
          'bawah menjumlahkan dokumen-dokumen tiap bulan menjadi satu baris per bulan. Yang direkonsiliasi ' +
          'adalah dua belas BULAN, bukan sekian dokumen yang kebetulan menyentuhnya.')
        : null,
      h('p', { class: 'note' },
        'Bulan rekonsiliasi ' + e.nama + ' adalah ' + D.namaBulan(rencana.bulanKoreksi) +
        (e.selesai ? ' — bulan terakhir ia bekerja, bukan Desember, karena rekonsiliasi Desember untuk orang yang berhenti Agustus tidak akan pernah terjadi.' : '.') +
        ' Baris yang bertepi kuning adalah bulan itu.'),
      ladder,
      h('h4', { style: 'margin-top:14px;font-size:13px', text: 'Perhitungan setahun, baris demi baris' }),
      rekon,
      rencana.restitusi
        ? h('div', { class: 'callout warn', style: 'margin-top:10px' },
          h('b', { text: 'Koreksinya negatif: ' + D.rupiah(rencana.koreksi) + '. ' }),
          'Tarif TER memotong lebih banyak dari kewajiban setahun, dan kelebihannya dikembalikan lewat ' +
          'payroll bulan ' + D.namaBulan(rencana.bulanKoreksi) + '. Penyebab paling umum adalah bulan THR: ' +
          'satu bulan upah tambahan mendorong bruto ke band TER yang jauh lebih tinggi, padahal tarif ' +
          'efektif setahunnya jauh lebih rendah — di sini ' + D.persen(th.efektifBp) + '.')
        : h('div', { class: 'callout ok', style: 'margin-top:10px' },
          h('b', { text: 'Koreksinya ' + D.rupiah(rencana.koreksi) + '. ' }),
          'Tarif efektif setahun ' + D.persen(th.efektifBp) + ', tarif marginal ' + D.persen(th.marginalBp) + '.')));

    /* The category's own table, with the rows around this employee highlighted. */
    var tab = T.TER[kategori];
    var brutoTerakhir = bulanan[bulanan.length - 1].brutoPajak;
    var bandKini = T.band(kategori, brutoTerakhir);
    var trows = tab.map(function (b, i) {
      var dari = i === 0 ? 0 : tab[i - 1].sampai + 1;
      return h('tr', { class: i === bandKini.i ? 'sel' : null },
        tdNum(i + 1),
        tdRp(dari),
        td(h('span', { class: 'num mono', text: b.sampai === null ? 'ke atas' : D.rupiah(b.sampai) })),
        h('td', { class: 'num pajak', text: D.persen(b.bp) }),
        td(i === bandKini.i ? h('span', { class: 'pill info', text: 'bruto ' + D.rupiah(brutoTerakhir) } ) : ''));
    });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Tabel TER ' + kategori + ' selengkapnya — ' + tab.length + ' band' }),
      h('p', { class: 'note' },
        'Ditranskripsi dari Lampiran PP 58/2023. Band dinyatakan "di atas X sampai dengan Y", jadi bruto yang ',
        'TEPAT di sebuah batas masuk band BAWAH. Setiap batas dari ketiga tabel diuji di kedua sisinya di tab ',
        'Uji, karena salah satu langkah di sana tidak terlihat pada agregat tetapi salah tepat untuk karyawan ',
        'yang gajinya angka bulat.'),
      tableOf([
        { label: 'No', num: true }, { label: 'Bruto dari', num: true }, { label: 'Bruto s.d.', num: true },
        { label: 'Tarif efektif', num: true }, { label: '' }
      ], trows, { minWidth: '640px' })));
  }

  /* ================================================================ BPJS */

  function renderBpjs(p) {
    renderPesan(p);
    var upah = state.sel.bpjsUpah;
    var kelas = state.sel.bpjsKelas;
    var b = P.bpjs(upah, kelas, cfg());

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'BPJS — plafon yang berbeda-beda, dan dua kolom yang terpisah' }),
      h('p', { class: 'note' },
        'Empat program, empat aturan dasar yang tidak sama. Kesehatan berplafon upah ' +
        D.rupiah(D.KESEHATAN.batasAtas) + ' DAN berlantai UMK. JP punya plafonnya sendiri, ' +
        D.rupiah(D.JP.batasAtas) + ', yang lebih rendah dan disetel ulang BPJS setiap tahun — jadi ada ' +
        'rentang upah di mana JP sudah tertahan sementara Kesehatan belum. JHT tidak punya plafon sama ' +
        'sekali. JKK dan JKM sepenuhnya beban pemberi kerja. Geser upah di bawah ini dan lihat mana yang ' +
        'berhenti naik dan kapan.'),
      h('div', { class: 'controls' },
        field('Upah sebulan', numInput(upah, function (v) {
          var n = parseInt(v, 10);
          if (isNaN(n) || n < 0) n = 0;
          if (n > 500000000) n = 500000000;
          state.sel.bpjsUpah = n;
          renderPanel('bpjs');
        }, { 'data-fkey': 'bpjs:upah', step: '500000' })),
        field('Kelas risiko JKK', select(D.KELAS_RISIKO.map(function (k) { return { value: k, label: D.JKK_KELAS[k].label }; }), kelas, function (v) { state.sel.bpjsKelas = v; renderPanel('bpjs'); }, { 'data-fkey': 'bpjs:kelas' })),
        field('UMK acuan (lantai Kesehatan)', numInput(cfg().umk, function (v) {
          if (!bolehkah('konfig.ubah')) { renderPanel('bpjs'); return; }
          var n = parseInt(v, 10);
          if (isNaN(n) || n < 0) n = 0;
          if (n > 50000000) n = 50000000;
          cfg().umk = n;
          simpanKonfig();
          invalidate();
          renderPanel('bpjs');
        }, { 'data-fkey': 'bpjs:umk', step: '100000' })),
        h('div', { class: 'chips' }, [12000000, 10547400, 5000000, 30000000].map(function (v) {
          return h('button', {
            class: 'chip', type: 'button', 'data-fkey': 'bpjs:cepat:' + v,
            onclick: function () { state.sel.bpjsUpah = v; renderPanel('bpjs'); }
          }, D.rupiah(v));
        })))));

    function baris(nama, dasar, kena, batas, bpPekerja, bpPemberi, nPekerja, nPemberi, catatan) {
      var frac = batas ? Math.min(100, Math.round(dasar * 100 / batas)) : Math.min(100, Math.round(dasar * 100 / 60000000));
      return h('tr', null,
        td(h('b', { text: nama })),
        td(h('span', { class: 'small wrap-normal', text: batas ? 'plafon ' + D.rupiah(batas) : 'tanpa plafon' })),
        tdRp(dasar),
        td(h('div', { class: 'plafon-bar' }, h('i', { class: kena ? 'kena' : '', style: 'width:' + frac + '%' }))),
        td(kena ? h('span', { class: 'pill warn', text: 'plafon menggigit' }) : h('span', { class: 'pill ok', text: 'atas upah penuh' })),
        td(bpPekerja === null ? h('span', { class: 'small', style: 'color:var(--faint)', text: '—' }) : h('span', { class: 'mono', text: D.persen(bpPekerja) })),
        tdRp(nPekerja, nPekerja ? 'minus' : 'nol'),
        td(h('span', { class: 'mono', text: D.persen(bpPemberi) })),
        tdRp(nPemberi, 'pemberi'),
        td(h('span', { class: 'small wrap-normal', text: catatan })));
    }

    var rows = [
      baris('Kesehatan', b.kesDasar, b.kesKena, D.KESEHATAN.batasAtas, D.KESEHATAN.bpPekerja, D.KESEHATAN.bpPemberi, b.kesPekerja, b.kesPemberi,
        (b.kesDasar > upah ? 'Dasar DIANGKAT ke UMK ' + D.rupiah(cfg().umk) + '. ' : '') + 'Perpres 64/2020. Premi pemberi kerja adalah obyek pajak bagi karyawan.'),
      baris('JHT', b.jhtDasar, false, null, D.JHT.bpPekerja, D.JHT.bpPemberi, b.jhtPekerja, b.jhtPemberi,
        'PP 46/2015. Tanpa plafon — satu-satunya iuran yang terus naik bersama gaji. Iuran pekerjanya mengurangi penghasilan bruto pada perhitungan setahun.'),
      baris('JP', b.jpDasar, b.jpKena, D.JP.batasAtas, D.JP.bpPekerja, D.JP.bpPemberi, b.jpPekerja, b.jpPemberi,
        'PP 45/2015, plafon penyesuaian ' + D.JP.tahunBatas + '. Iuran pekerjanya juga mengurangi penghasilan bruto.'),
      baris('JKK ' + kelas, b.jkkDasar, false, null, null, b.jkkBp, 0, b.jkk,
        'PP 44/2015, menurut risiko pekerjaan. Sepenuhnya pemberi kerja, dan obyek pajak bagi karyawan.'),
      baris('JKM', upah, false, null, null, D.JKM.bpPemberi, 0, b.jkm,
        'Sepenuhnya pemberi kerja, dan obyek pajak bagi karyawan.')
    ];
    rows.push(h('tr', { class: 'total-row' },
      td('TOTAL'), td(''), td(''), td(''), td(''), td(''),
      tdRp(b.pekerjaTotal, 'minus'), td(''), tdRp(b.pemberiTotal, 'pemberi'), td('')));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Iuran atas upah ' + D.rupiah(upah) + ', kelas risiko ' + kelas }),
      tableOf([
        { label: 'Program' }, { label: 'Aturan dasar' }, { label: 'Dasar iuran', num: true },
        { label: 'Dasar vs plafon' }, { label: 'Status plafon' },
        { label: 'Tarif pekerja', num: true }, { label: 'Iuran pekerja', num: true },
        { label: 'Tarif pemberi', num: true }, { label: 'Iuran pemberi', num: true }, { label: 'Catatan' }
      ], rows, { minWidth: '1180px' }),
      h('div', { class: 'callout' },
        h('b', { text: 'Potongan pekerja ' + D.rupiah(b.pekerjaTotal) + ', beban pemberi kerja ' + D.rupiah(b.pemberiTotal) + '. ' }),
        'Kedua angka itu tidak pernah dijumlahkan menjadi satu potongan. Yang keluar dari gaji karyawan hanya ' +
        'yang pertama; yang kedua adalah biaya perusahaan. Sebagian dari yang kedua — Kesehatan pemberi ' +
        D.rupiah(b.kesPemberi) + ', JKK ' + D.rupiah(b.jkk) + ', JKM ' + D.rupiah(b.jkm) + ', jumlahnya ' +
        D.rupiah(b.kesPemberi + b.jkk + b.jkm) + ' — tetap ditambahkan ke BRUTO PAJAK karyawan karena ia ' +
        'premi asuransi yang dibayar atas namanya, sementara JHT dan JP pemberi kerja tidak. Itu menaikkan ' +
        'pajaknya tanpa pernah menurunkan netonya.')));

    /* The sweep: what the contribution does as the wage crosses each ceiling. */
    var titik = [4000000, 5000000, 5396761, 7000000, 9000000, 10000000, 10547400, 10547401, 11000000, 11999999, 12000000, 12000001, 15000000, 25000000, 50000000];
    var srows = titik.map(function (u) {
      var x = P.bpjs(u, kelas, cfg());
      return h('tr', { class: u === upah ? 'sel' : null },
        td(h('button', {
          class: 'linkbtn mono', type: 'button', 'data-fkey': 'bpjs:sweep:' + u,
          onclick: function () { state.sel.bpjsUpah = u; renderPanel('bpjs'); }
        }, D.rupiah(u))),
        tdRp(x.kesPekerja, x.kesKena ? 'nol' : 'minus'),
        td(x.kesKena ? h('span', { class: 'pill warn', text: 'rata' }) : (x.kesDasar > u ? h('span', { class: 'pill info', text: 'lantai UMK' }) : '')),
        tdRp(x.jhtPekerja, 'minus'),
        td(h('span', { class: 'pill ok', text: 'naik terus' })),
        tdRp(x.jpPekerja, x.jpKena ? 'nol' : 'minus'),
        td(x.jpKena ? h('span', { class: 'pill warn', text: 'rata' }) : ''),
        tdRp(x.pekerjaTotal, 'minus'),
        tdRp(x.pemberiTotal, 'pemberi'));
    });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Sapuan upah melewati setiap plafon' }),
      h('p', { class: 'note' },
        'Perhatikan tiga hal. Di ' + D.rupiah(D.JP.batasAtas) + ' iuran JP berhenti naik dan tidak bergerak ',
        'lagi selamanya. Di ' + D.rupiah(D.KESEHATAN.batasAtas) + ' Kesehatan melakukan hal yang sama, jadi ',
        'seorang direktur bergaji lima puluh juta membayar premi Kesehatan yang PERSIS SAMA dengan seorang ',
        'supervisor bergaji dua belas juta. Dan JHT tidak pernah berhenti — plafon yang tersalin ke JHT ',
        'adalah bug bayangan yang akan lolos dari uji "plafon sudah diterapkan".'),
      tableOf([
        { label: 'Upah sebulan', num: true }, { label: 'Kesehatan pekerja', num: true }, { label: '' },
        { label: 'JHT pekerja', num: true }, { label: '' }, { label: 'JP pekerja', num: true }, { label: '' },
        { label: 'Total pekerja', num: true }, { label: 'Total pemberi', num: true }
      ], srows, { minWidth: '1000px' })));

    /* Where the demo company actually sits. */
    var atas = 0, hanyaJp = 0, bawah = 0;
    ctx().karyawan.forEach(function (e) {
      var u = e.gajiPokok + e.tunjanganTetap;
      if (u > D.KESEHATAN.batasAtas) atas++;
      else if (u > D.JP.batasAtas) hanyaJp++;
      if (u < cfg().umk) bawah++;
    });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Di perusahaan demo ini' }),
      h('div', { class: 'summary' },
        statTile('Di atas plafon Kesehatan', String(atas) + ' orang', 'premi Kesehatan rata ' + D.rupiah(D.bpRound(D.KESEHATAN.batasAtas, 100))),
        statTile('Hanya JP tertahan', String(hanyaJp) + ' orang', 'antara ' + D.rupiah(D.JP.batasAtas) + ' dan ' + D.rupiah(D.KESEHATAN.batasAtas)),
        statTile('Di bawah UMK acuan', String(bawah) + ' orang', 'dasar Kesehatan diangkat ke ' + D.rupiah(cfg().umk)))));
  }

  /* ================================================================= THR */

  function renderThr(p) {
    renderPesan(p);
    var y = cfg().tahun;
    var tgl = cfg().thrTanggal;
    var run = runOf(y, cfg().thrBulan);

    var rows = ctx().karyawan.map(function (e) {
      var upah = e.gajiPokok + e.tunjanganTetap;
      var bulan = D.bulanMasaKerja(e.mulai, tgl);
      var thr = D.thr(upah, bulan);
      var dibayar = null;
      if (run) run.slips.forEach(function (s) { if (s.nip === e.nip) dibayar = s.k.thr; });
      var cocok = dibayar === null ? null : dibayar === thr;
      return h('tr', null,
        td(h('span', { class: 'nip', text: e.nip })),
        td(h('span', { class: 'wrap-normal', text: e.nama })),
        td(h('span', { class: 'small', text: D.tglPanjang(e.mulai) })),
        tdNum(bulan),
        tdRp(upah),
        td(h('span', { class: 'small mono wrap-normal', text: bulan >= 12 ? '1 × upah' : (bulan < 1 ? 'belum berhak' : bulan + '/12 × upah') })),
        tdRp(thr, thr ? 'plus' : 'nol'),
        td(bulan >= 12 ? h('span', { class: 'pill ok', text: 'penuh' }) : bulan < 1 ? h('span', { class: 'pill bad', text: 'nihil' }) : h('span', { class: 'pill info', text: 'prorata' })),
        td(dibayar === null
          ? h('span', { class: 'small', style: 'color:var(--faint)', text: 'run belum ada' })
          : h('span', { class: 'pill ' + (cocok ? 'ok' : 'bad'), text: cocok ? 'cocok dengan slip' : 'BEDA: slip ' + D.rupiah(dibayar) })));
    });
    var total = 0;
    ctx().karyawan.forEach(function (e) { total += D.thr(e.gajiPokok + e.tunjanganTetap, D.bulanMasaKerja(e.mulai, tgl)); });
    rows.push(h('tr', { class: 'total-row' }, td('TOTAL'), td(''), td(''), td(''), td(''), td(''), tdRp(total, 'plus'), td(''), td('')));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'THR ' + y + ' — dibayar dalam run ' + D.namaBulan(cfg().thrBulan) },
        run ? h('span', { class: 'pill info', text: 'total slip ' + D.rupiah(run.total.thr) }) : null),
      h('p', { class: 'note' },
        'PP 36/2021 Pasal 9: masa kerja 12 bulan atau lebih berhak satu bulan upah; satu bulan sampai kurang ',
        'dari dua belas bulan berhak prorata (masa kerja ÷ 12) × satu bulan upah; di bawah satu bulan belum ',
        'berhak. Dibayarkan paling lambat tujuh hari sebelum hari raya keagamaan — di sini ' + D.tglPanjang(tgl) +
        ', jadi ia masuk run ' + D.namaBulan(cfg().thrBulan) + '. Masa kerja diukur ke TANGGAL PEMBAYARAN, ' +
        'bukan ke akhir tahun; selisih dua hari di sana mengubah proratanya satu per dua belas. ' +
        '"Upah" adalah upah pokok DITAMBAH tunjangan tetap, bukan bruto yang memuat lembur.'),
      h('div', { class: 'callout pajak' },
        h('b', { text: 'THR adalah obyek PPh 21 di bulan ia dibayarkan. ' }),
        'Karena itu bruto pajak bulan ' + D.namaBulan(cfg().thrBulan) + ' melonjak dan tarif TER bulan itu ' +
        'ikut melonjak ke band yang jauh lebih tinggi — sering dua kali tarif bulan biasa. Itu bukan salah ' +
        'hitung; itu memang cara TER bekerja, dan itulah sebab paling umum rekonsiliasi Desember berujung ' +
        'RESTITUSI. Buka tab PPh 21 untuk satu karyawan dan lihat baris Maret melonjak lalu Desember negatif.'),
      tableOf([
        { label: 'NIP' }, { label: 'Nama' }, { label: 'Mulai kerja' },
        { label: 'Masa kerja (bln)', num: true }, { label: 'Upah sebulan', num: true },
        { label: 'Rumus' }, { label: 'THR', num: true }, { label: 'Hak' }, { label: 'Silang dengan slip' }
      ], rows, { minWidth: '1020px' })));

    /* The proration formula, asserted rather than asserted-in-prose. */
    var upahContoh = 12000000;
    var prows = [];
    for (var b = 0; b <= 13; b++) {
      (function (b) {
        prows.push(h('tr', null,
          tdNum(b),
          td(h('span', { class: 'mono small', text: b < 1 ? 'nihil' : (b >= 12 ? '1 × ' + D.rupiah(upahContoh) : b + '/12 × ' + D.rupiah(upahContoh)) })),
          tdRp(D.thr(upahContoh, b), D.thr(upahContoh, b) ? 'plus' : 'nol'),
          td(h('span', { class: 'small', text: b >= 12 ? 'dibatasi satu bulan upah' : (b < 1 ? 'belum ada hak' : '') }))));
      })(b);
    }
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Rumus proratanya, atas contoh upah ' + D.rupiah(upahContoh) }),
      h('p', { class: 'note' },
        'Perhatikan bahwa 13 bulan tidak memberi lebih dari 12: hak penuh adalah SATU bulan upah, dan masa ',
        'kerja di atas dua belas bulan tidak menambahnya. Perhatikan juga bahwa 0 bulan bukan 0/12 dari ',
        'sesuatu — di bawah satu bulan masa kerja belum ada hak sama sekali.'),
      tableOf([{ label: 'Masa kerja (bln)', num: true }, { label: 'Rumus' }, { label: 'THR', num: true }, { label: '' }], prows, { minWidth: '540px' })));
  }

  /* ============================================================= LAPORAN */

  function renderLaporan(p) {
    renderPesan(p);
    var y = cfg().tahun;
    var m = state.sel.lapBulan;
    var run = runOf(y, m);

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Laporan' }),
      h('p', { class: 'note' },
        'Tiga angka yang harus dilaporkan terpisah dan sering dijadikan satu: bruto yang dibayarkan ke ',
        'karyawan, potongan yang disetor atas nama karyawan, dan iuran yang dibayar perusahaan atas namanya ',
        'sendiri. Biaya mempekerjakan seseorang adalah bruto DITAMBAH yang ketiga, dan itu bukan bruto.'),
      h('div', { class: 'controls' },
        field('Bulan', select(D.BULAN.map(function (b, i) { return { value: i + 1, label: b }; }), m, function (v) { state.sel.lapBulan = parseInt(v, 10); renderPanel('laporan'); }, { 'data-fkey': 'lap:bulan' })),
        field('Kelompokkan', select([
          { value: 'divisi', label: 'per divisi' }, { value: 'ptkp', label: 'per status PTKP' },
          { value: 'kategori', label: 'per kategori TER' }, { value: 'risiko', label: 'per kelas risiko JKK' }
        ], state.sel.lapMode, function (v) { state.sel.lapMode = v; renderPanel('laporan'); }, { 'data-fkey': 'lap:mode' })))));

    if (!run) {
      p.appendChild(h('div', { class: 'empty', text: 'Run ' + D.namaBulan(m) + ' ' + y + ' belum dijalankan.' }));
    } else {
      var mode = state.sel.lapMode;
      var grup = {}, urut = [];
      run.slips.forEach(function (s) {
        var kunci = mode === 'divisi' ? s.divisi
          : mode === 'ptkp' ? s.ptkp
            : mode === 'kategori' ? ('TER ' + D.kategoriTER(s.ptkp))
              : ('kelas ' + s.risiko);
        if (!grup[kunci]) { grup[kunci] = { n: 0, slips: [] }; urut.push(kunci); }
        grup[kunci].n++;
        grup[kunci].slips.push(s);
      });
      urut.sort();
      var rows = urut.map(function (kunci) {
        var g = grup[kunci];
        var t = P.totalDari(g.slips);
        return h('tr', null,
          td(h('b', { text: kunci })),
          tdNum(g.n),
          tdRp(t.pokok), tdRp(t.tunjanganTetap), tdRp(t.lembur), tdRp(t.thr),
          tdRp(t.bruto, 'plus'), tdRp(t.brutoPajak, 'pajak'),
          tdRp(t.dedKes + t.dedJht + t.dedJp, 'minus'), tdRp(t.dedPph21, t.dedPph21 < 0 ? 'minus' : 'pajak'),
          tdRp(t.neto), tdRp(t.ptgTotal, 'pemberi'), tdRp(t.bruto + t.ptgTotal));
      });
      var tt = P.totalDari(run.slips);
      rows.push(h('tr', { class: 'total-row' },
        td('TOTAL'), tdNum(run.slips.length),
        tdRp(tt.pokok), tdRp(tt.tunjanganTetap), tdRp(tt.lembur), tdRp(tt.thr),
        tdRp(tt.bruto), tdRp(tt.brutoPajak), tdRp(tt.dedKes + tt.dedJht + tt.dedJp), tdRp(tt.dedPph21),
        tdRp(tt.neto), tdRp(tt.ptgTotal), tdRp(tt.bruto + tt.ptgTotal)));
      p.appendChild(h('div', { class: 'card' },
        h('h3', { text: D.namaBulan(m) + ' ' + y + ' — ' + (mode === 'divisi' ? 'per divisi' : mode === 'ptkp' ? 'per status PTKP' : mode === 'kategori' ? 'per kategori TER' : 'per kelas risiko JKK') }),
        tableOf([
          { label: 'Kelompok' }, { label: 'Orang', num: true }, { label: 'Pokok', num: true },
          { label: 'Tunj. tetap', num: true }, { label: 'Lembur', num: true }, { label: 'THR', num: true },
          { label: 'Bruto', num: true }, { label: 'Bruto pajak', num: true },
          { label: 'BPJS pekerja', num: true }, { label: 'PPh 21', num: true },
          { label: 'Neto', num: true }, { label: 'Beban pemberi', num: true }, { label: 'Biaya total', num: true }
        ], rows, { minWidth: '1320px' })));
    }

    /* The twelve-month roll-up, which is where the December refund becomes
     * visible as a company-wide number. */
    var mrows = [];
    var tot = P.totalKosong();
    for (var mm = 1; mm <= 12; mm++) {
      (function (mm) {
        /* THE EFFECTIVE MONTH: every document posted against it, summed. The
         * roll-up used to read the regular run only while the Beranda tile
         * summed every run, so the two tabs printed two different annual PPh 21
         * figures for one dataset the moment a correction existed. */
        var ef = P.efektifBulan(state.runs, y, mm);
        if (!ef) { mrows.push(h('tr', null, td(D.BULAN[mm - 1]), td(h('span', { class: 'small', style: 'color:var(--faint)', text: 'belum dijalankan' })), td(''), td(''), td(''), td(''), td(''), td(''))); return; }
        var r = { total: ef.total, slips: { length: ef.slip } };
        P.KOLOM.forEach(function (c) { tot[c] += r.total[c]; });
        mrows.push(h('tr', null,
          td(h('span', null, D.BULAN[mm - 1],
            ef.runs.length > 1 ? h('span', { class: 'pill warn', style: 'margin-left:6px', text: ef.runs.length + ' dokumen' }) : null)),
          tdNum(r.slips.length),
          tdRp(r.total.bruto, 'plus'),
          tdRp(r.total.thr, r.total.thr ? 'plus' : 'nol'),
          tdRp(r.total.brutoPajak, 'pajak'),
          tdRp(r.total.dedPph21, r.total.dedPph21 < 0 ? 'minus' : 'pajak'),
          tdRp(r.total.neto),
          tdRp(r.total.ptgTotal, 'pemberi')));
      })(mm);
    }
    mrows.push(h('tr', { class: 'total-row' },
      td('Setahun'), td(''), tdRp(tot.bruto), tdRp(tot.thr), tdRp(tot.brutoPajak), tdRp(tot.dedPph21), tdRp(tot.neto), tdRp(tot.ptgTotal)));
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Dua belas bulan ' + y }),
      h('p', { class: 'note' },
        'Kolom PPh 21 adalah tempat rezim TER paling terlihat: bulan THR melonjak karena band TER-nya ',
        'melonjak, dan bulan rekonsiliasi bisa NEGATIF karena kelebihan potong sepanjang tahun dikembalikan. ',
        'Setiap baris menjumlahkan SELURUH dokumen bulan itu — run reguler ditambah setiap run penyesuaian ',
        'yang diposting terhadapnya — sehingga angkanya sama dengan yang ditampilkan Beranda dan tab ',
        'Payroll Run, bukan angka bulan yang sudah disusul koreksi.'),
      tableOf([
        { label: 'Bulan' }, { label: 'Slip', num: true }, { label: 'Bruto', num: true },
        { label: 'THR', num: true }, { label: 'Bruto pajak', num: true }, { label: 'PPh 21', num: true },
        { label: 'Neto', num: true }, { label: 'Beban pemberi', num: true }
      ], mrows, { minWidth: '860px' })));

    /* The annual tax picture per employee — the 1721-A1 shape. */
    var arows = ctx().karyawan.map(function (e) {
      var rw = P.riwayatPajak(state.runs, e.nip, y);
      if (!rw.length) return null;
      var bruto = 0, jht = 0, jp = 0, pot = 0;
      rw.forEach(function (r) { bruto += r.brutoPajak; jht += r.jhtPekerja; jp += r.jpPekerja; pot += r.pph21; });
      var aktif = P.bulanAktif(e, y);
      /* DISTINCT MONTHS, not records — the same rule P.periksa applies. Counting
       * documents made one adjustment run print "15/12 bulan" and switch the
       * reconciliation off exactly when corrections exist, which is when it
       * matters most. */
      var bulanAda = {};
      rw.forEach(function (r) { bulanAda[r.bulan] = 1; });
      var nBulan = Object.keys(bulanAda).length;
      var lengkap = aktif.every(function (mm) { return bulanAda[mm]; });
      /* THE STATUS AS WITHHELD, which is what the checker reads. Reconciling
       * against the CURRENT master status printed a red "BEDA" for the exact
       * case the Beranda card declares in bold is not a failure — two surfaces
       * of one app giving opposite verdicts on the same fact in the same
       * second. A changed status is a pending correction, and it is shown as
       * one. */
      var statusW = P.statusDipakai(state.runs, e, y);
      var th = T.pph21Tahunan({ status: statusW, brutoTahun: bruto, bulanKerja: aktif.length, jhtPekerja: jht, jpPekerja: jp });
      var cocok = pot === th.pph;
      var driftStatus = statusW !== e.ptkp;
      return h('tr', null,
        td(h('button', {
          class: 'linkbtn nip', type: 'button', 'data-fkey': 'lap:pph:' + fkey(e.nip),
          onclick: function () { state.sel.pphNip = e.nip; state.sel.pphSim = null; switchTab('pph'); }
        }, e.nip)),
        td(h('span', { class: 'wrap-normal', text: e.nama })),
        td(h('span', { class: 'mono small', text: statusW + ' / TER ' + D.kategoriTER(statusW) + (driftStatus ? ' (induk kini ' + e.ptkp + ')' : '') })),
        tdNum(nBulan),
        tdRp(bruto, 'pajak'),
        tdRp(th.biayaJabatan),
        tdRp(th.pkp),
        tdRp(th.pph, 'pajak'),
        tdRp(pot, 'pajak'),
        td(h('span', { class: 'mono', text: D.persen(th.efektifBp) })),
        td(!lengkap
          ? h('span', { class: 'pill warn', text: nBulan + '/' + aktif.length + ' bulan' })
          : !cocok
            ? h('span', { class: 'pill bad', text: 'BEDA ' + D.rupiah(pot - th.pph) })
            : driftStatus
              ? h('span', { class: 'pill warn', text: 'I3 tepat · koreksi tertunggak' })
              : h('span', { class: 'pill ok', text: 'I3 tepat' })));
    }).filter(function (x) { return x; });
    p.appendChild(h('div', { class: 'card cetak-laporan' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Rekapitulasi PPh 21 setahun per karyawan (bentuk 1721-A1)' }),
        h('button', {
          class: 'btn small no-print', type: 'button', 'data-fkey': 'lap:cetak',
          title: 'Mencetak rekapitulasi ini saja, di A4',
          onclick: function () { try { window.print(); } catch (err) { } }
        }, 'Cetak A4')),
      h('p', { class: 'note' },
        'Kolom terakhir menghitung ulang perhitungan setahun dari catatan slip yang tersimpan dan ',
        'membandingkannya dengan jumlah yang benar-benar dipotong. Keduanya harus sama ke rupiah untuk ',
        'setiap orang, joiner tengah tahun dan yang berhenti termasuk. Itulah yang dilaporkan ke DJP, dan ',
        'itulah selisih yang ditemukan pemeriksaan pajak kalau ada. Kolom Bulan menghitung BULAN yang ',
        'terisi, bukan dokumen: satu bulan yang dikoreksi punya dua dokumen dan tetap satu bulan. Status ',
        'PTKP yang dipakai adalah status SEBAGAIMANA DIPOTONG di bulan rekonsiliasi — sama dengan yang ',
        'dibaca pemeriksa invarian — sehingga perubahan status di data induk tampil sebagai koreksi ',
        'tertunggak, bukan sebagai selisih aritmetik.'),
      tableOf([
        { label: 'NIP' }, { label: 'Nama' }, { label: 'PTKP' }, { label: 'Bulan', num: true },
        { label: 'Bruto pajak setahun', num: true }, { label: 'Biaya jabatan', num: true },
        { label: 'PKP', num: true }, { label: 'PPh 21 setahun', num: true },
        { label: 'Σ dipotong', num: true }, { label: 'Tarif efektif', num: true }, { label: 'I3' }
      ], arows, { minWidth: '1140px' })));
  }

  /* ================================================================== UJI */

  function renderUji(p) {
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Assertion suite' }),
      h('p', { class: 'note' },
        'Berkas yang sama (', h('code', { text: 'tests.js' }), ') berjalan di halaman ini dan di bawah node. ',
        'Yang paling menanggung beban, berurutan: jumlah dua belas potongan PPh 21 sama dengan perhitungan ',
        'setahun untuk setiap karyawan — diperiksa terhadap perhitungan ulang yang MANDIRI, bukan terhadap ',
        'laporan mesin tentang dirinya sendiri, dan termasuk joiner tengah tahun serta yang berhenti Agustus; ',
        'neto sama dengan bruto dikurangi potongan pekerja di setiap slip setiap bulan; total run sama dengan ',
        'jumlah slipnya di setiap kolom; iuran pemberi kerja tidak pernah bisa menggerakkan neto; setiap ',
        'plafon BPJS diuji dengan menyapu upah melewati batasnya satu rupiah sekali; dan pemilihan band TER ',
        'diuji di SETIAP batas ketiga tabel, di kedua sisinya.')));

    var todoUji = kartuTertunggak();
    if (todoUji) p.appendChild(todoUji);
    p.appendChild(kartuInvarian());

    var card = h('div', { class: 'card' });
    if (!state.tests) {
      card.appendChild(h('div', { class: 'empty', text: 'Uji sedang berjalan…' }));
      p.appendChild(card);
      return;
    }
    var run = state.tests;
    card.appendChild(h('div', { class: 'test-summary' },
      h('span', { class: 'pillbig ' + (run.failed ? 'fail' : 'pass'), text: run.failed ? run.failed + ' GAGAL' : run.passed + ' LULUS' }),
      h('span', { class: 'hint', text: run.passed + ' dari ' + run.total + ' assertion di ' + UJI.groups.length + ' grup · ' + run.ms + ' ms' }),
      h('button', {
        class: 'btn small', type: 'button', 'data-fkey': 'uji:ulang', onclick: function () {
          state.tests = null; paintTests(); renderPanel('uji');
          setTimeout(runTests, 20);
        }
      }, 'Jalankan ulang')));

    var byGroup = {}, order = [];
    run.results.forEach(function (r) {
      if (!byGroup[r.group]) { byGroup[r.group] = []; order.push(r.group); }
      byGroup[r.group].push(r);
    });
    order.forEach(function (g) {
      var list = byGroup[g];
      var gagal = list.filter(function (x) { return !x.ok; }).length;
      var box = h('div', { class: 'tgroup' });
      box.appendChild(h('h4', { text: g + '  ' + (list.length - gagal) + '/' + list.length }));
      list.forEach(function (x) {
        box.appendChild(h('div', { class: 'tcase ' + (x.ok ? 'ok' : 'no') },
          h('span', { class: 'mk', text: x.ok ? '✓' : '✗' }),
          h('span', { style: 'white-space:normal', text: x.name }),
          x.ok ? null : h('span', { class: 'msg', style: 'white-space:normal', text: x.message })));
      });
      card.appendChild(box);
    });
    p.appendChild(card);
  }

  function runTests() {
    var t0 = Date.now();
    var run;
    try { run = UJI.run(); }
    catch (e) {
      run = { results: [{ group: 'runner', name: 'suite melempar', ok: false, message: String(e && e.stack || e) }], passed: 0, failed: 1, total: 1 };
    }
    run.ms = Date.now() - t0;
    state.tests = run;
    paintTests();
    say(run.failed ? ('Uji: ' + run.failed + ' gagal.') : ('Uji: ' + run.passed + ' assertion lulus.'));
    if (state.view === 'uji') renderPanel('uji');
  }

  /* ============================================================= plumbing */

  var RENDER = {
    beranda: renderBeranda, karyawan: renderKaryawan, absensi: renderAbsensi, cuti: renderCuti,
    run: renderRun, slip: renderSlip, pph: renderPph, bpjs: renderBpjs, thr: renderThr,
    laporan: renderLaporan, uji: renderUji
  };

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel) return;
    /* Every render is a teardown, and a teardown throws keyboard focus to
     * <body>. Capturing the focused element's stable key first and restoring it
     * afterwards is the difference between a usable keyboard path and one where
     * entering a salary costs the user twelve Tab presses. */
    var snap = captureFocus();
    /* THE CONTEXT BAR IS PART OF EVERY RENDER, not of renderAll alone.
     * It was reachable only from a role change and the reset button, so its
     * live indicators — the invariant count, the outstanding-corrections pill,
     * the storage-mode pill — froze at whatever they said when the role was
     * last switched and then contradicted the panel underneath them for the
     * rest of the session, in both directions: no "tertunggak" pill while the
     * panel showed a pending correction, and a stale one after it was cleared;
     * "IndexedDB" while the app had already fallen back to memory and was
     * saving nothing. Repainting it here, inside the same focus window, means
     * the next handler somebody adds cannot reopen the same hole. */
    renderCtxBar();
    clear(panel);
    try { RENDER[name](panel); }
    catch (e) {
      panel.appendChild(h('div', { class: 'callout bad' },
        h('b', { text: 'Panel gagal dirender. ' }), String(e && e.message || e)));
      if (window.console) console.error(e);
    }
    /* PRINTING FROM ANYWHERE MUST NOT PRODUCE A BLANK SHEET. The print
     * stylesheet is an allow-list — deliberately, because the deny-list version
     * in a sibling lab leaked two blocks onto the paper — but an allow-list
     * that matches nothing on the current tab yields a silent empty A4. Every
     * panel without a printable artefact gets a print-only line saying where
     * the printable ones are. */
    if (name !== 'slip' && name !== 'laporan') {
      panel.appendChild(kartuCetakKosong('Tab ' + name + ' tidak dicetak.'));
    }
    restoreFocus(snap);
    if (state.fokusKe) {
      var kk = state.fokusKe;
      state.fokusKe = null;
      var el2 = null;
      try { el2 = document.querySelector('[data-fkey="' + kk + '"]'); } catch (e2) { el2 = null; }
      if (el2) { try { el2.focus({ preventScroll: true }); } catch (e3) { try { el2.focus(); } catch (e4) { } } }
    }
    paintBuku();
  }

  function switchTab(name) {
    state.view = name;
    var tabs = document.querySelectorAll('#tabs .tab');
    for (var i = 0; i < tabs.length; i++) {
      var id = tabs[i].id.replace('tab-', '');
      var on = id === name;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
      $('panel-' + id).hidden = !on;
    }
    renderPanel(name);
  }

  function renderAll() {
    /* renderPanel now repaints the context bar itself, inside its own focus
     * window, so this is just "render everything" for the callers that mean it. */
    renderPanel(state.view);
    paintBuku();
  }

  function wireTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#tabs .tab'));
    tabs.forEach(function (btn, idx) {
      btn.addEventListener('click', function () { switchTab(btn.id.replace('tab-', '')); });
      btn.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var next = tabs[(idx + d + tabs.length) % tabs.length];
        next.focus();
        switchTab(next.id.replace('tab-', ''));
        /* focus() scrolls the strip, but switchTab re-renders immediately
         * afterwards and the browser's scroll landed 27px short of the maximum
         * at 390px — enough to clip the last tab's label and the right half of
         * its 2px focus ring. Scrolling AFTER the re-render puts it back. */
        try { next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e2) { }
      });
    });
  }

  /* ================================================================ boot */

  function boot() {
    state.db = S.build();
    state.ctx = state.db.ctx;
    state.runs = state.db.runs;
    var first = state.ctx.karyawan[0];
    state.sel.karyawan = first.nip;
    state.sel.pphNip = first.nip;
    state.sel.slipNip = first.nip;
    state.sel.absNip = first.nip;
    state.sel.cutiNip = first.nip;
    state.sel.runId = P.runId(cfg().tahun, 12);
    state.sel.bulan = 12;
    state.sel.slipBulan = 12;
    state.sel.lapBulan = 12;

    paintTheme();
    $('themeBtn').addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('testBadge').addEventListener('click', function () { switchTab('uji'); });
    $('bukuBadge').addEventListener('click', function () { switchTab('uji'); });
    if (window.PAYROLL_GUARD) window.PAYROLL_GUARD.onchange = paintNet;
    paintNet();
    paintTests();
    wireTabs();

    Promise.all([muat(), muatAudit()]).then(function () {
      invalidate();
      renderAll();
      /* The suite runs after first paint so the page is usable immediately; the
       * badge says "berjalan…" until it finishes. */
      setTimeout(runTests, 30);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
