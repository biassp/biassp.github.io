/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — app.js
 * The UI. Every rule it enforces lives in domain.js / ledger.js / proses.js;
 * this file renders them and never re-implements one. In particular it never
 * computes a cost, never adds up a balance, and never writes a stock figure —
 * it appends entries and asks the engine what everything is worth.
 *
 * Five things this file has to get right that are easy to miss:
 *  1. Every render tears the panel down and rebuilds it. That throws keyboard
 *     focus to <body>, which breaks the cashier flow for anyone not using a
 *     mouse. Focus is captured by a stable data-fkey before the teardown and
 *     restored after it — and when the captured control no longer exists
 *     (activating it removed it), focus falls back to the panel's anchor rather
 *     than to the document.
 *  2. Values commit on `input`, never on `change`. `change` fires DURING the
 *     focus transfer, so the teardown it triggers races the browser: focus
 *     lands on <body> and a click on the next button is swallowed between
 *     mousedown and mouseup. See numInput.
 *  3. A rebuild announces nothing to a screen reader. The posted document, the
 *     refusal and its reason, the recomputed HPP and the running total are all
 *     written into one polite live region.
 *  4. Where an action is denied, the control is still RENDERED and the reason
 *     printed next to it. A warehouse user who cannot see the rule cannot work
 *     with it either — they just find someone whose password works.
 *  5. The badges in the header mean two different things and are kept apart:
 *     `uji` is the assertion suite over a book rebuilt from the seed, `buku
 *     hidup` is the same invariants over the book actually loaded, rerun after
 *     every mutation. A suite that builds its own book cannot see a corrupted
 *     live one.
 */
(function () {
  'use strict';

  var D = window.GUDANG_DOMAIN;
  var L = window.GUDANG_LEDGER;
  var P = window.GUDANG_PROSES;
  var S = window.GUDANG_SEED;
  var St = window.GUDANG_STORE;
  var T = window.GUDANG_TESTS;

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
   * while(firstChild) removeChild loop is not equivalent: removing a FOCUSED
   * input fires blur synchronously, the blur handler re-renders, and the loop
   * then tries to remove a node that is no longer its child and throws. */
  function clear(el) { el.textContent = ''; }

  function tableOf(headers, rows, opts) {
    opts = opts || {};
    var thead = h('tr');
    headers.forEach(function (x) {
      thead.appendChild(h('th', { class: x.num ? 'num' : null, text: x.label !== undefined ? x.label : x }));
    });
    var tb = h('tbody');
    rows.forEach(function (r) { tb.appendChild(r); });
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
   * 1. COMMIT ON `input`, NEVER ON `change`. `change` on a field fires while the
   *    browser is transferring focus away from it. The handler re-renders, which
   *    tears the panel down; at that instant document.activeElement is <body>, so
   *    the focus snapshot is empty and focus lands on the document. Worse, a
   *    mouse user's click on the next button is swallowed, because the button is
   *    destroyed between mousedown and mouseup — "Tutup transaksi" did nothing
   *    the first time it was pressed, and Tab out of any quantity box dumped the
   *    cashier back at the skip link.
   *
   * 2. type="text" WITH inputmode="numeric", not type="number". Every keystroke
   *    re-renders the panel, so the caret has to be restored afterwards — and
   *    Chromium throws on selectionStart/setSelectionRange for input[type=number].
   *    With a number field the caret silently went back to position 0 and typing
   *    "30" produced 3. A text field with a numeric inputmode still brings up the
   *    numeric keypad on a phone, and the min/max/step semantics were never a
   *    control anyway: the clamp lives in the handler, and the real limit is
   *    enforced again at posting time.
   *    ArrowUp / ArrowDown are re-implemented here, because that affordance is
   *    the one genuinely useful thing type=number provided.
   *
   * While a field is being edited its raw text is kept, so clearing it to type a
   * new number does not fight a re-render that has already written "0" back —
   * unless the model clamped the value, in which case the clamped figure wins
   * and is shown, because a box that displays 999 while the app holds 6 is lying.
   */
  var editRaw = { key: null, text: '' };

  function numInput(value, onchange, attrs) {
    var a = attrs || {};
    var key = a['data-fkey'] || null;
    a.type = 'text';
    a.inputmode = 'numeric';
    a.autocomplete = 'off';
    a.class = 'nilai-input';
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

  /* Where focus goes when the control that had it no longer exists. Activating a
   * search-result chip or a per-line "Hapus" removes the very element that was
   * focused; without a fallback the user lands on <body> and re-Tabs from the
   * skip link. The anchor is the control the next action needs anyway. */
  var FOKUS_ANCHOR = { kasir: 'ks:cari', penerimaan: 'pn:po', transfer: 'tr:tambah', opname: 'op:sheet', kartu: 'kartu:sku' };

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
    /* Write lock. Entry ids come from a counter in the book and the book lives
     * in this tab, so exactly one tab may post; the others are read-only and the
     * context bar says so. See St.lock. */
    tulis: true,
    tabId: 'T' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
    lockPemilik: null,
    lockPesan: '',
    lockBebas: false,
    periksa: null,          // live-book invariant run, recomputed after every mutation
    fokusKe: null,          // data-fkey to focus after the next render
    metode: 'fifo',
    peran: 'supervisor',
    ppnInklusif: true,
    hasil: {},              // metode -> costing result (cache, invalidated on post)
    view: 'beranda',
    tests: null,
    pesan: null,            // { jenis:'ok'|'tolak', judul, isi:[..] }
    sel: {
      cariProduk: '', kategori: 'semua',
      kartuSku: '', kartuGudang: 'semua',
      hppSku: '',
      poId: '', poFilter: 'semua',
      terimaPo: '', terimaTgl: '',
      trDari: 'GD-PUSAT', trKe: 'GD-TOKO', trTgl: '',
      opnameId: '',
      kasirGudang: 'GD-TOKO', kasirCari: '', returNota: '',
      laporanGudang: 'semua', laporanPeriode: '',
      mundurSku: '', mundurGudang: '', mundurTgl: '2026-06-10', mundurQty: 0, mundurHarga: 0
    },
    keranjang: [],
    bayar: { tunai: 0, transfer: 0, qris: 0 },
    struk: null,
    mundurHasil: null,
    trDraft: [],
    terimaDraft: null,
    returDraft: null
  };

  function db() { return state.db; }
  function prod(sku) { return state.db.produkBySku[sku]; }

  /* Costing results are cached per method and thrown away the moment the ledger
   * changes. Recomputing both methods over the whole book takes tens of
   * milliseconds, which is cheap enough that no screen ever shows a stale
   * number — and a stale number is how a stock system loses an argument. */
  function invalidate() { state.hasil = {}; state.mundurHasil = null; state.periksa = null; }

  /* The invariants, over the book that is actually loaded — seeded documents plus
   * everything posted in this tab — recomputed after every mutation. The
   * assertion suite in tests.js builds its own fresh book and therefore cannot
   * see a corrupted live one; that is precisely how a green badge came to sit
   * above a negative stock balance. This is the badge that means what a reader
   * assumes it means. */
  function periksaHidup() {
    if (state.periksa) return state.periksa;
    var out = { metode: {}, gagal: 0, total: 0, lulus: 0, error: null };
    try {
      var s = sortedEntries();
      ['fifo', 'rata'].forEach(function (m) {
        var pb = L.periksaBuku(hasil(m), s);
        out.metode[m] = pb;
        out.total += pb.total; out.lulus += pb.lulus; out.gagal += pb.gagal;
      });
    } catch (e) {
      out.error = String(e && e.message || e);
      out.gagal++; out.total++;
    }
    state.periksa = out;
    return out;
  }

  function hasil(metode) {
    metode = metode || state.metode;
    if (!state.hasil[metode]) {
      /* periksaUrutan re-derives the oldest layer key inside the consumption
       * loop instead of trusting the queue, on every render rather than only in
       * the test suite — the layer-discipline check on the live book is worth
       * more than the microseconds it costs. */
      state.hasil[metode] = L.replay(L.urut(state.db.buku.entries), {
        metode: metode, hargaAcuan: state.db.hargaAcuan, periksaUrutan: true
      });
    }
    return state.hasil[metode];
  }

  function sortedEntries() { return L.urut(state.db.buku.entries); }

  function gudangNama(id) {
    if (id === D.TRANSIT) return 'Dalam perjalanan';
    for (var i = 0; i < state.db.gudang.length; i++) if (state.db.gudang[i].id === id) return state.db.gudang[i].nama;
    return id;
  }

  function fmtQty(sku, base) {
    var pr = prod(sku);
    if (!pr) return D.angka(base);
    return D.fmtPecah(pr, base);
  }

  function qtyCell(sku, base, cls) {
    var pr = prod(sku);
    var basis = pr ? D.satuanBasis(pr).kode.toLowerCase() : 'unit';
    return h('td', { class: 'num ' + (cls || ''), title: pr ? D.fmtPecah(pr, base) : '' },
      D.angka(base) + ' ' + basis);
  }

  /* ------------------------------------------------------------- header */

  function paintNet() {
    var g = window.GUDANG_GUARD;
    var n = g ? g.total() : 0;
    $('netCount').textContent = 'panggilan jaringan: ' + n;
    $('netBadge').className = 'netbadge' + (n ? ' bad' : '');
  }

  function paintTests() {
    var b = $('testBadge'), t = $('testText');
    if (!state.tests) { b.className = 'testbadge busy'; t.textContent = 'uji: berjalan…'; return; }
    b.className = 'testbadge' + (state.tests.failed ? ' bad' : '');
    t.textContent = state.tests.failed
      ? 'uji: ' + state.tests.failed + ' GAGAL'
      : 'uji: ' + state.tests.passed + '/' + state.tests.total + ' lulus';
  }

  /* The live-book badge. Distinct from the assertion badge on purpose: that one
   * says "the engine is correct on a book built from the seed", this one says
   * "the book in front of you satisfies its invariants right now". */
  function paintBuku() {
    var b = $('bukuBadge'), t = $('bukuText');
    if (!b || !t) return;
    if (!state.db) { b.className = 'testbadge busy'; t.textContent = 'buku: memeriksa…'; return; }
    var pr = periksaHidup();
    b.className = 'testbadge' + (pr.gagal ? ' bad' : '');
    t.textContent = pr.gagal
      ? 'buku hidup: ' + pr.gagal + ' INVARIAN GAGAL'
      : 'buku hidup: ' + pr.lulus + '/' + pr.total + ' invarian';
  }

  function paintTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var btn = $('themeBtn');
    // The visible word IS the accessible name (WCAG 2.5.3): a speech-input user
    // saying "click Terang" has to hit the button they can see.
    btn.textContent = dark ? 'Terang' : 'Gelap';
    btn.setAttribute('aria-pressed', dark ? 'false' : 'true');
    btn.setAttribute('title', dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
  }

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    St.writeLocal('gudang.theme', next);
    paintTheme();
    say(next === 'dark' ? 'Tema gelap aktif.' : 'Tema terang aktif.');
  }

  /* ------------------------------------------------------------ context */

  function renderCtxBar() {
    var bar = $('ctxbar');
    clear(bar);

    bar.appendChild(field('Metode penilaian', select(
      D.METODE.map(function (m) { return { value: m.id, label: m.label }; }),
      state.metode,
      function (v) {
        state.metode = v;
        simpanKonfig();
        say('Metode ' + v + '. Seluruh HPP dan nilai persediaan di layar dihitung ulang.');
        renderAll();
      }, { 'data-fkey': 'ctx:metode' }
    )));

    bar.appendChild(field('Masuk sebagai', select(
      D.ROLES.map(function (r) { return { value: r.id, label: r.label }; }),
      state.peran,
      function (v) {
        state.peran = v;
        simpanKonfig();
        say('Peran: ' + v);
        renderAll();
      }, { 'data-fkey': 'ctx:peran' }
    )));

    bar.appendChild(field('PPN 11%', select(
      [{ value: 'inklusif', label: 'Harga sudah termasuk PPN' }, { value: 'eksklusif', label: 'Harga belum termasuk PPN' }],
      state.ppnInklusif ? 'inklusif' : 'eksklusif',
      function (v) {
        state.ppnInklusif = (v === 'inklusif');
        simpanKonfig();
        say(state.ppnInklusif ? 'PPN inklusif.' : 'PPN eksklusif.');
        renderAll();
      }, { 'data-fkey': 'ctx:ppn' }
    )));

    if (!state.tulis) {
      bar.appendChild(h('div', { class: 'callout bad', style: 'margin:8px 0 0' },
        h('b', { text: 'Tab ini hanya bisa membaca. ' }),
        state.lockPesan || pesanKunci(state.lockPemilik),
        state.lockBebas ? h('div', { style: 'margin-top:6px' },
          h('button', {
            class: 'btn small primary', type: 'button', 'data-fkey': 'ctx:muatulang',
            onclick: function () { location.reload(); }
          }, 'Kunci sudah bebas — muat ulang')) : null));
    }

    var r = D.ROLES.filter(function (x) { return x.id === state.peran; })[0];
    bar.appendChild(h('p', { class: 'ctx-note' },
      h('span', { class: 'perchip', text: r ? r.label : state.peran }), ' ', r ? r.ket : '',
      ' Tanggal laporan dipatok ', h('b', { text: D.tglPanjang(state.db.hariIni) }),
      ' supaya angka di layar tidak berubah besok.'));
  }

  /* --------------------------------------------------------- persistence */

  function simpanKonfig() {
    if (!state.tulis) return;
    St.put('konfig', { k: 'konfig', v: { metode: state.metode, peran: state.peran, ppnInklusif: state.ppnInklusif } });
  }

  /* An entry is written with add(), not put(): its key is its id, an id is
   * append-only, and a colliding key means something upstream is wrong. A
   * rejected write is shown, never swallowed. */
  function simpanEntry(e) {
    St.add('entri', { k: e.id, v: e }).catch(function (err) {
      state.tulis = false;
      state.lockPesan = 'Penulisan entry ' + e.id + ' ditolak penyimpanan (' + (err && err.name || err) +
        '). Tab ini berhenti menulis supaya tidak menimpa dokumen tab lain. Muat ulang halaman.';
      tolak('Penyimpanan gagal', [state.lockPesan]);
      renderAll();
    });
    simpanBuku();
  }

  /* The counters only. tutup — which periods are closed — is a SEPARATE record
   * written only by togglePeriode: folding it into the blob every posting writes
   * meant any unrelated posting from a stale tab silently reverted a
   * supervisor's period close. */
  function simpanBuku() {
    if (!state.tulis) return;
    St.put('konfig', { k: 'buku', v: { seqBerikut: state.db.buku.seqBerikut, dokBerikut: state.db.buku.dokBerikut } });
  }
  function simpanTutup() {
    if (!state.tulis) return;
    St.put('konfig', { k: 'tutup', v: { tutup: state.db.buku.tutup } });
  }
  function simpanOpname(op) {
    if (!state.tulis) return;
    St.put('opname', { k: op.id, v: { id: op.id, status: op.status, baris: op.baris, tglPosting: op.tglPosting || null, entries: op.entries || null } });
  }
  function audit(aksi, detail) {
    St.audit({ aksi: aksi, detail: detail, peran: state.peran });
  }

  function muat() {
    return Promise.all([St.all('entri'), St.all('konfig'), St.all('opname')]).then(function (res) {
      var entri = res[0] || [], konfig = res[1] || [], opn = res[2] || [];
      konfig.forEach(function (rec) {
        if (rec.k === 'konfig' && rec.v) {
          if (rec.v.metode) state.metode = rec.v.metode;
          if (rec.v.peran) state.peran = rec.v.peran;
          if (typeof rec.v.ppnInklusif === 'boolean') state.ppnInklusif = rec.v.ppnInklusif;
        }
        if (rec.k === 'buku' && rec.v) {
          if (rec.v.dokBerikut) state.db.buku.dokBerikut = rec.v.dokBerikut;
          /* Older builds wrote tutup inside this record. Honour it if it is the
           * only copy, but the dedicated record below always wins. */
          if (rec.v.tutup) state.db.buku.tutup = rec.v.tutup;
        }
        if (rec.k === 'tutup' && rec.v && rec.v.tutup) state.db.buku.tutup = rec.v.tutup;
      });
      /* Entries posted by the user are pushed back onto the seeded book with
       * their ORIGINAL seq. Re-assigning sequence numbers on reload would move
       * a backdated document's position in the fold and silently change every
       * HPP after it — the one thing this app must never do. */
      entri.sort(function (a, b) { return (a.v.seq || 0) - (b.v.seq || 0); });
      var maxSeq = state.db.buku.seqBerikut - 1;
      entri.forEach(function (rec) {
        if (!rec.v || !rec.v.id) return;
        state.db.buku.entries.push(rec.v);
        if (rec.v.seq > maxSeq) maxSeq = rec.v.seq;
      });
      state.db.buku.seqBerikut = maxSeq + 1;
      opn.forEach(function (rec) {
        for (var i = 0; i < state.db.opname.length; i++) {
          if (state.db.opname[i].id !== rec.k) continue;
          state.db.opname[i].status = rec.v.status;
          state.db.opname[i].baris = rec.v.baris;
          state.db.opname[i].tglPosting = rec.v.tglPosting;
          state.db.opname[i].entries = rec.v.entries;
        }
      });
      invalidate();
    }).catch(function () { invalidate(); });
  }

  /* ------------------------------------------------------------- pesan */

  function tolak(judul, alasan) {
    state.pesan = { jenis: 'tolak', judul: judul, isi: alasan };
    say(judul + '. ' + alasan.join(' '));
  }
  function sukses(judul, isi) {
    state.pesan = { jenis: 'ok', judul: judul, isi: isi || [] };
    say(judul);
  }
  /* A refusal must not outlive the condition that caused it. "Pembayaran belum
   * sah — kurang Rp3.900" sitting on screen after the cashier has fixed the
   * payment is worse than no message: it says the till is refusing when it is
   * not. Every input that can change the answer clears it. */
  function lupakanPesan() { state.pesan = null; }

  function renderPesan(p) {
    if (!state.pesan) return;
    var m = state.pesan;
    var box = h('div', { class: m.jenis === 'ok' ? 'terima-ok' : 'tolak' },
      h('b', { text: m.judul + (m.isi.length ? ' — ' : '') }));
    if (m.isi.length === 1) box.appendChild(document.createTextNode(m.isi[0]));
    else if (m.isi.length > 1) {
      var ul = h('ul', { style: 'margin:6px 0 0 18px' });
      m.isi.forEach(function (x) { ul.appendChild(h('li', { text: x })); });
      box.appendChild(ul);
    }
    box.appendChild(h('div', { class: 'no-print', style: 'margin-top:6px' },
      h('button', {
        class: 'btn small ghost no-print', type: 'button', 'data-fkey': 'pesan:tutup',
        onclick: function () { state.pesan = null; renderPanel(state.view); }
      }, 'Tutup')));
    p.appendChild(box);
    /* A refusal that renders below the fold is a refusal nobody reads. block:
     * 'nearest' does not move the page when the box is already visible, and the
     * default instant behaviour respects prefers-reduced-motion by construction. */
    if (box.scrollIntoView) { try { box.scrollIntoView({ block: 'nearest' }); } catch (e) { } }
  }

  /* Guard for every mutating action: checks the role, prints the reason when it
   * refuses, and returns a boolean the caller can branch on. */
  function bolehkah(aksi) {
    if (!bolehTulis()) return false;
    var res = D.izin(state.peran, aksi);
    if (!res.ok) tolak('Aksi ditolak', [res.alasan]);
    return res.ok;
  }

  /* The second gate, in front of the role gate: this tab may not hold the write
   * lock. Refusing here — with the reason — is the alternative to two tabs
   * minting the same entry id and one of them silently destroying the other's
   * document. */
  function bolehTulis() {
    if (state.tulis) return true;
    tolak('Tab ini hanya bisa membaca', [state.lockPesan ||
      ('Tab lain pada peramban ini sedang memegang kunci tulis (' + (state.lockPemilik || 'tidak diketahui') + '). ' +
        'Nomor urut entry buku besar berasal dari pencacah di dalam buku, jadi dua tab yang memposting ' +
        'bersamaan akan mencetak id yang sama dan yang kedua menimpa dokumen yang pertama. ' +
        'Tutup tab lain itu, lalu muat ulang halaman ini.')]);
    return false;
  }

  /* ================================================================ BERANDA */

  function statTile(k, v, n) {
    return h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), n ? h('div', { class: 'n', text: n }) : null);
  }

  /* The live-book invariant card. Same function on Beranda and in the Uji tab, so
   * the two cannot drift apart. */
  function kartuPeriksaHidup() {
    var pr = periksaHidup();
    var card = h('div', { class: 'card' },
      h('h3', { text: 'Pemeriksaan buku yang sedang dimuat' }),
      h('p', { class: 'note' },
        'Yang di badge header sebelah kiri (', h('b', { text: 'uji' }), ') adalah rangkaian assertion atas buku ',
        'yang dibangun ulang dari seed — ia tidak pernah melihat dokumen yang baru Anda posting. Yang di sini (',
        h('b', { text: 'buku hidup' }), ') dijalankan atas buku yang ada di layar sekarang, di kedua metode, ',
        'setiap kali sesuatu diposting. Kalau salah satu baris di bawah merah, angka di halaman ini tidak boleh dipercaya.'));
    if (pr.error) {
      card.appendChild(h('div', { class: 'tolak' }, h('b', { text: 'Pemeriksaan melempar exception. ' }), pr.error));
      return card;
    }
    ['fifo', 'rata'].forEach(function (m) {
      var pb = pr.metode[m];
      if (!pb) return;
      var box = h('div', { class: 'tgroup' });
      box.appendChild(h('h4', { text: (m === 'fifo' ? 'FIFO' : 'Rata-rata tertimbang') + '  ' + pb.lulus + '/' + pb.total }));
      pb.cek.forEach(function (c) {
        box.appendChild(h('div', { class: 'tcase ' + (c.ok ? 'ok' : 'no') },
          h('span', { class: 'mk', text: c.ok ? '✓' : '✗' }),
          h('span', { style: 'white-space:normal', text: c.nama }),
          h('span', { class: 'msg', style: 'white-space:normal', text: c.pesan })));
      });
      card.appendChild(box);
    });
    return card;
  }

  function renderBeranda(p) {
    var d = db(), hf = hasil('fifo'), hr = hasil('rata'), H = hasil();
    var kons = L.konservasi(H);
    var pos = L.posisi(H);
    var transit = 0;
    for (var i = 0; i < pos.length; i++) if (pos[i].gudang === D.TRANSIT) transit += pos[i].nilai;

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Persediaan hari ini' }),
      h('p', { class: 'note' },
        'Tidak ada satu pun angka di bawah ini yang tersimpan di mana-mana. Semuanya dilipat dari ',
        h('b', { text: D.angka(d.buku.entries.length) + ' entry buku besar' }),
        ' setiap kali halaman ini digambar ulang. Stok bukan medan yang bisa ditulis; stok adalah jumlah pergerakan.'));

    var sum = h('div', { class: 'summary' },
      statTile('Nilai persediaan', D.rupiah(H.akhir.nilai), 'metode ' + (state.metode === 'fifo' ? 'FIFO' : 'rata-rata')),
      statTile('HPP penjualan', D.rupiah(H.total.hppJual), D.periodeLabel('2026-03') + ' – ' + D.periodeLabel('2026-09')),
      statTile('Peredaran bruto', D.rupiah(H.total.penjualanBruto), D.angka(d.kasir.length) + ' nota kasir'),
      statTile('Dalam perjalanan', D.rupiah(transit), 'antargudang, belum tiba'),
      statTile('SKU aktif', D.angka(d.produk.length), d.gudang.length + ' gudang + TRANSIT'),
      statTile('Entry buku besar', D.angka(d.buku.entries.length), 'append-only, tidak pernah disunting'));
    card.appendChild(sum);
    p.appendChild(card);
    renderPesan(p);

    /* The reconciliation, on the front page, because it is the claim the whole
     * app rests on and it should not need hunting for. */
    var rk = h('div', { class: 'card' },
      h('h3', { text: 'Identitas nilai — dibuktikan, bukan dijanjikan' }),
      h('p', { class: 'note' },
        'Setiap rupiah yang pernah masuk ke persediaan harus berakhir di salah satu dari dua tempat: ',
        'sudah menjadi harga pokok penjualan, atau masih berupa barang di rak. Kalau jumlahnya tidak ',
        'tepat, sistem sedang berbohong tentang uang.'));
    var baris = [
      ['Saldo awal 1 Maret 2026', kons.saldoAwal, 1],
      ['Pembelian (penerimaan barang)', kons.pembelian, 1],
      ['Retur penjualan masuk kembali', kons.returJual, 1],
      ['Penyesuaian opname — lebih', kons.adjMasuk, 1],
      ['Transfer masuk (termasuk ke TRANSIT)', kons.transferMasuk, 1],
      ['Retur pembelian ke supplier', kons.returBeli, -1],
      ['Harga pokok penjualan', kons.hppJual, -1],
      ['Penyesuaian opname — kurang', kons.adjKeluar, -1],
      ['Transfer keluar (termasuk dari TRANSIT)', kons.transferKeluar, -1]
    ];
    var box = h('div', { class: 'rekon' });
    baris.forEach(function (b) {
      box.appendChild(h('div', { class: 'rekon-baris' },
        h('span', { text: (b[2] > 0 ? '+ ' : '− ') + b[0] }),
        h('span', { class: 'n', text: D.rupiah(b[1]) })));
    });
    box.appendChild(h('div', { class: 'rekon-baris total' },
      h('span', { text: '= Nilai persediaan akhir (dihitung dari identitas)' }),
      h('span', { class: 'n', text: D.rupiah(kons.kiri) })));
    box.appendChild(h('div', { class: 'rekon-baris total' },
      h('span', { text: 'Nilai persediaan akhir (dijumlah dari lapisan/saldo tiap gudang)' }),
      h('span', { class: 'n', text: D.rupiah(kons.persediaanAkhir) })));
    box.appendChild(h('div', { class: 'rekon-baris total sisa' + (kons.selisih ? ' rusak' : '') },
      h('span', { text: kons.selisih ? 'SELISIH — ada yang salah' : 'Selisih' }),
      h('span', { class: 'n', text: D.rupiah(kons.selisih) })));
    /* The verdict is kons.seimbang, not kons.selisih. A book can close to Rp0
     * overall while transfer masuk and transfer keluar disagree — the two errors
     * offset — so the identity that is claimed on screen has to be the identity
     * that is actually tested. */
    box.appendChild(h('div', { class: 'rekon-baris total sisa' + (kons.seimbang ? '' : ' rusak') },
      h('span', { text: kons.seimbang ? 'Kedua identitas terpenuhi' : 'SALAH SATU IDENTITAS TIDAK TERPENUHI' }),
      h('span', { class: 'n', text: kons.seimbang ? 'ya' : 'tidak' })));
    rk.appendChild(box);

    /* Two figures and an explicit comparison, not one figure and a sentence
     * claiming they are equal. */
    rk.appendChild(h('div', { class: kons.transferSeimbang ? 'terima-ok' : 'tolak' },
      h('b', { text: kons.transferSeimbang ? 'Transfer masuk = transfer keluar' : 'TRANSFER MASUK ≠ TRANSFER KELUAR' }),
      ' — masuk ' + D.rupiah(kons.transferMasuk) + ', keluar ' + D.rupiah(kons.transferKeluar) +
      ', selisih ' + D.rupiah(kons.transferMasuk - kons.transferKeluar) +
      '. Barang di perjalanan membawa biayanya; nilai yang tiba harus sama dengan nilai yang berangkat, ' +
      'per dokumen, bukan hanya secara agregat.'));

    var negKunci = [];
    for (var nk in H.st) {
      if (!Object.prototype.hasOwnProperty.call(H.st, nk)) continue;
      if (H.st[nk].qty < 0 || H.st[nk].nilai < 0) negKunci.push(nk.replace('|', ' di ') + ' = ' + D.angka(H.st[nk].qty) + ' unit / ' + D.rupiah(H.st[nk].nilai));
    }
    if (negKunci.length || H.defisit.length) {
      rk.appendChild(h('div', { class: 'tolak' },
        h('b', { text: 'Buku ini tidak sehat. ' }),
        (negKunci.length ? negKunci.length + ' pasangan SKU×gudang bersaldo negatif (' + negKunci.slice(0, 3).join('; ') + '). ' : '') +
        (H.defisit.length ? H.defisit.length + ' pengeluaran dinilai pada harga acuan karena stoknya tidak ada — nilai itu dikarang, bukan diperoleh. ' : '') +
        'Saldo negatif tidak pernah boleh muncul di bawah tulisan hijau; itulah kenapa angka ini dicetak di sini.'));
    }
    p.appendChild(rk);

    p.appendChild(kartuPeriksaHidup());

    var bd = h('div', { class: 'card' },
      h('h3', { text: 'FIFO dan rata-rata tertimbang, di atas buku yang sama' }),
      h('p', { class: 'note' }, D.CATATAN_LIFO));
    var g = h('div', { class: 'banding' });
    [['fifo', hf], ['rata', hr]].forEach(function (pair) {
      var m = pair[0], hh = pair[1];
      var lain = m === 'fifo' ? hr : hf;
      g.appendChild(h('div', { class: 'metode-kartu' + (state.metode === m ? ' aktif' : '') },
        h('h4', { text: m === 'fifo' ? 'FIFO' : 'Rata-rata tertimbang' }),
        h('div', { class: 'kecil', text: 'Harga pokok penjualan' }),
        h('div', { class: 'angka', text: D.rupiah(hh.total.hppJual) }),
        h('div', { class: 'kecil', style: 'margin-top:8px', text: 'Nilai persediaan akhir' }),
        h('div', { class: 'angka', text: D.rupiah(hh.akhir.nilai) }),
        h('div', { class: 'kecil', style: 'margin-top:8px' },
          'Selisih HPP terhadap metode lain: ',
          h('b', { text: D.rupiah(hh.total.hppJual - lain.total.hppJual) })),
        h('div', { style: 'margin-top:10px' },
          h('button', {
            class: 'btn small' + (state.metode === m ? ' primary' : ''), type: 'button',
            'data-fkey': 'beranda:metode:' + m, 'aria-pressed': state.metode === m ? 'true' : 'false',
            onclick: function () { state.metode = m; simpanKonfig(); say('Metode ' + m); renderAll(); }
          }, state.metode === m ? 'Metode aktif' : 'Pakai metode ini'))));
    });
    bd.appendChild(g);
    bd.appendChild(h('p', { class: 'hint' },
      'Kuantitas keluar identik di kedua metode — ', D.angka(hf.total.qtyKeluar), ' unit dasar. ',
      'Yang berbeda hanya pembagian nilai antara HPP dan persediaan akhir, dan jumlah keduanya tetap sama. ',
      'Buka tab HPP & Metode untuk melihatnya per SKU.'));
    p.appendChild(bd);

    var apa = h('div', { class: 'card' },
      h('h3', { text: 'Yang membedakan ini dari tabel produk dengan tombol tambah' }),
      h('ul', { style: 'margin:6px 0 0 18px; font-size:13px; line-height:1.75' },
        h('li', null, h('b', { text: 'Buku besar adalah kebenarannya. ' }), 'Tidak ada medan stok. Saldo apa pun, kapan pun, adalah hasil lipatan pergerakan.'),
        h('li', null, h('b', { text: 'Lapisan biaya FIFO yang nyata. ' }), 'Setiap penerimaan membuat lapisan; setiap pengeluaran memakan lapisan tertua dan memecahnya kalau perlu.'),
        h('li', null, h('b', { text: 'Dokumen bertanggal mundur menghitung ulang. ' }), 'Menyisipkan pembelian minggu lalu membatalkan setiap angka HPP sesudahnya, dan aplikasi ini menunjukkan mana yang berubah.'),
        h('li', null, h('b', { text: 'Opname memposting jurnal, bukan menimpa saldo. ' }), 'Selisih fisik menjadi entry penyesuaian bertanda alasan, dan gerakan selama penghitungan tidak dihitung dua kali.'),
        h('li', null, h('b', { text: 'Barang di perjalanan ada tempatnya. ' }), 'Sudah keluar dari gudang A, belum sampai gudang B, tetap terlihat dan terhitung tepat sekali.'),
        h('li', null, h('b', { text: 'Satuan berjenjang dikonversi di pintu masuk. ' }), 'Beli dus, jual pcs, hitung campur — semuanya disimpan dalam satuan dasar sebagai bilangan bulat.')));
    p.appendChild(apa);

    var pv = h('div', { class: 'card' },
      h('h3', { text: 'Di mana data ini berada' }),
      h('p', { class: 'note' },
        'Di tab ini. Buku demo dibangun ulang dari satu bilangan seed (', h('code', { text: String(d.seed) }),
        ') setiap kali halaman dimuat; hanya yang Anda posting sendiri yang disimpan, di IndexedDB, di peramban ini. ',
        'Penyimpanan sekarang: ', h('b', { text: St.mode === 'idb' ? 'IndexedDB' : 'memori (' + St.reason + ')' }), '. ',
        'Penghitung di header menghitung setiap percobaan panggilan jaringan dan tetap di nol.'),
      h('div', { style: 'margin-top:10px; display:flex; gap:8px; flex-wrap:wrap' },
        h('button', {
          class: 'btn small', type: 'button', 'data-fkey': 'beranda:hapus',
          onclick: function () {
            if (!bolehTulis()) { renderPanel('beranda'); return; }
            St.clearAll().then(function () {
              state.db = S.build();
              state.keranjang = []; state.struk = null; state.trDraft = [];
              invalidate();
              sukses('Data lokal dihapus', ['Buku kembali ke keadaan awal hasil seed. Tidak ada yang perlu diunduh: datanya memang dibangun ulang di sini.']);
              renderAll();
            });
          }
        }, 'Hapus data lokal & bangun ulang')));
    p.appendChild(pv);
  }

  /* ================================================================= PRODUK */

  function renderProduk(p) {
    var d = db(), H = hasil();
    var cari = state.sel.cariProduk.toLowerCase();
    var kat = state.sel.kategori;

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Produk' }),
      h('p', { class: 'note' },
        'Kolom stok bukan angka yang tersimpan. Untuk setiap baris di bawah ini, saldo dan nilainya ',
        'dihitung dari buku besar pada saat tabel ini digambar. Satuan berjenjang ditampilkan penuh: ',
        'sistem menyimpan satuan dasar, dan menunjukkan pecahannya.'));

    var ctl = h('div', { class: 'controls' });
    var inp = h('input', {
      class: 'cari', type: 'search', placeholder: 'Cari nama, SKU atau barcode…',
      value: state.sel.cariProduk, 'data-fkey': 'produk:cari', 'aria-label': 'Cari produk'
    });
    inp.addEventListener('input', function () { state.sel.cariProduk = inp.value; renderPanel('produk'); });
    ctl.appendChild(inp);
    ctl.appendChild(select([{ value: 'semua', label: 'Semua kategori' }].concat(d.kategori.map(function (k) { return { value: k.id, label: k.nama }; })),
      kat, function (v) { state.sel.kategori = v; renderPanel('produk'); }, { 'data-fkey': 'produk:kat' }));
    card.appendChild(ctl);

    var rows = [], tampil = 0, totalNilai = 0;
    for (var i = 0; i < d.produk.length; i++) {
      var pr = d.produk[i];
      if (kat !== 'semua' && pr.kategori !== kat) continue;
      if (cari && (pr.nama + ' ' + pr.sku + ' ' + pr.barcode).toLowerCase().indexOf(cari) < 0) continue;
      var pos = L.posisiSku(H, pr.sku);
      totalNilai += pos.nilai;
      tampil++;
      if (tampil > 60) continue;
      var tangga = pr.satuan.map(function (s) { return s.kode + '=' + D.angka(s.faktor); }).join(' · ');
      (function (pr, pos, tangga) {
        var tr = h('tr', null,
          h('td', null, h('button', {
            class: 'linkbtn sku', type: 'button', 'data-fkey': 'produk:sku:' + fkey(pr.sku),
            onclick: function () { state.sel.kartuSku = pr.sku; state.sel.hppSku = pr.sku; switchTab('kartu'); }
          }, pr.sku)),
          h('td', { class: 'wrap-normal', style: 'white-space:normal;min-width:190px' }, pr.nama,
            h('div', { class: 'bc', text: pr.barcode })),
          h('td', { class: 'wrap-normal', text: pr.kategoriNama }),
          h('td', { class: 'bc', text: tangga }),
          tdRp(pr.hargaBeli), tdRp(pr.hargaJual),
          qtyCell(pr.sku, pos.qty, pos.qty <= 0 ? 'nol' : (pos.qty < pr.minStok ? 'minus' : '')),
          h('td', { class: 'bc', text: D.fmtPecah(pr, pos.qty) }),
          tdRp(pos.unit), tdRp(pos.nilai));
        rows.push(tr);
      })(pr, pos, tangga);
    }
    card.appendChild(tableOf(
      ['SKU', 'Nama', 'Kategori', 'Tangga satuan', { label: 'Harga beli', num: 1 }, { label: 'Harga jual', num: 1 },
        { label: 'Saldo', num: 1 }, 'Pecahan', { label: 'HPP/unit', num: 1 }, { label: 'Nilai', num: 1 }],
      rows, { minWidth: '1080px' }));
    card.appendChild(h('p', { class: 'hint' },
      tampil + ' produk cocok' + (tampil > 60 ? ' (60 pertama ditampilkan)' : '') +
      ' · total nilai persediaan yang cocok: ' + D.rupiah(totalNilai) +
      ' · HPP/unit dihitung dengan metode ' + (state.metode === 'fifo' ? 'FIFO' : 'rata-rata') + '.'));
    p.appendChild(card);
    renderPesan(p);

    var bawah = h('div', { class: 'card' },
      h('h3', { text: 'Produk di bawah stok minimum' }));
    var kurang = [];
    for (i = 0; i < d.produk.length; i++) {
      var pr2 = d.produk[i];
      var pos2 = L.posisiSku(H, pr2.sku);
      if (pos2.qty < pr2.minStok) kurang.push({ pr: pr2, pos: pos2 });
    }
    kurang.sort(function (a, b) { return (a.pos.qty / a.pr.minStok) - (b.pos.qty / b.pr.minStok); });
    var rows2 = [];
    for (i = 0; i < Math.min(kurang.length, 14); i++) {
      var kq = kurang[i];
      var persen = kq.pr.minStok ? Math.min(100, Math.round(100 * Math.max(0, kq.pos.qty) / kq.pr.minStok)) : 100;
      rows2.push(h('tr', null,
        h('td', { class: 'sku', text: kq.pr.sku }),
        h('td', { class: 'wrap-normal', style: 'white-space:normal', text: kq.pr.nama }),
        qtyCell(kq.pr.sku, kq.pos.qty, kq.pos.qty <= 0 ? 'minus' : ''),
        qtyCell(kq.pr.sku, kq.pr.minStok),
        h('td', null, h('div', { class: 'meter', title: persen + '%' },
          h('i', { class: persen < 40 ? 'bahaya' : '', style: 'width:' + persen + '%' })))));
    }
    bawah.appendChild(tableOf(['SKU', 'Nama', { label: 'Saldo', num: 1 }, { label: 'Minimum', num: 1 }, 'Terisi'], rows2, { minWidth: '640px' }));
    bawah.appendChild(h('p', { class: 'hint', text: kurang.length + ' SKU berada di bawah stok minimum. Minimum ini juga fabrikasi — dibangkitkan dari seed, bukan hasil analisis permintaan.' }));
    p.appendChild(bawah);
  }

  /* ============================================================ KARTU STOK */

  function renderKartu(p) {
    var d = db(), H = hasil(), s = sortedEntries();
    if (!state.sel.kartuSku) state.sel.kartuSku = d.produk[0].sku;
    var sku = state.sel.kartuSku, gud = state.sel.kartuGudang;
    var pr = prod(sku);

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Kartu stok' }),
      h('p', { class: 'note' },
        'Ini bukan laporan yang dibuat dari saldo; ini saldonya. Setiap baris membawa saldo awal, ',
        'mutasi dan saldo akhirnya sendiri, sehingga invarian ',
        h('b', { text: 'saldo akhir = saldo awal + masuk − keluar' }),
        ' bisa dibaca langsung di layar, baris demi baris — bukan hanya dipercaya dari tab Uji.'));

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('Produk', select(
      d.produk.map(function (x) { return { value: x.sku, label: x.sku + ' — ' + x.nama }; }),
      sku, function (v) { state.sel.kartuSku = v; renderPanel('kartu'); }, { 'data-fkey': 'kartu:sku' })));
    ctl.appendChild(field('Gudang', select(
      [{ value: 'semua', label: 'Semua lokasi' }].concat(d.gudang.map(function (g) { return { value: g.id, label: g.nama }; }))
        .concat([{ value: D.TRANSIT, label: 'Dalam perjalanan (TRANSIT)' }]),
      gud, function (v) { state.sel.kartuGudang = v; renderPanel('kartu'); }, { 'data-fkey': 'kartu:gudang' })));
    card.appendChild(ctl);

    var kartu = L.kartuStok(s, H, sku, gud === 'semua' ? null : gud);
    var rows = [], rusak = 0, negBaris = 0, mulai = Math.max(0, kartu.baris.length - 90);
    for (var i = mulai; i < kartu.baris.length; i++) {
      var b = kartu.baris[i];
      if (b.awalQty + b.masukQty - b.keluarQty !== b.akhirQty) rusak++;
      /* The row arithmetic can be perfectly consistent and the balance still be
       * impossible. A negative saldo means goods left a bin that did not hold
       * them, and it must never appear under the words "Invarian terpenuhi". */
      if (b.akhirQty < 0) negBaris++;
      var e = b.entry;
      rows.push(h('tr', null,
        h('td', { class: 'bc', text: D.tglPanjang(e.tgl) }),
        h('td', null, h('span', { class: 'gerak ' + e.jenis, text: D.JENIS[e.jenis].label })),
        h('td', { class: 'sku', text: e.dok }),
        gud === 'semua' ? h('td', { class: 'wrap-normal', text: gudangNama(e.gudang) }) : null,
        tdNum(b.awalQty),
        h('td', { class: 'num rp plus', text: b.masukQty ? D.angka(b.masukQty) : '—' }),
        h('td', { class: 'num rp minus', text: b.keluarQty ? D.angka(b.keluarQty) : '—' }),
        tdNum(b.akhirQty),
        h('td', { class: 'num', text: b.unit ? D.rupiah(b.unit) : '—' }),
        tdRp(b.akhirNilai),
        h('td', { class: 'wrap-normal', style: 'white-space:normal;max-width:220px', text: e.catatan || (e.alasan ? D.alasanLabel(e.alasan) : '') })));
    }
    var kolom = ['Tanggal', 'Jenis', 'Dokumen'];
    if (gud === 'semua') kolom.push('Lokasi');
    kolom = kolom.concat([{ label: 'Saldo awal', num: 1 }, { label: 'Masuk', num: 1 }, { label: 'Keluar', num: 1 },
    { label: 'Saldo akhir', num: 1 }, { label: 'HPP/unit', num: 1 }, { label: 'Nilai saldo', num: 1 }, 'Keterangan']);
    card.appendChild(tableOf(kolom, rows, { minWidth: '1020px' }));
    card.appendChild(h('div', { class: (rusak || negBaris || kartu.akhir.qty < 0) ? 'tolak' : 'terima-ok' },
      h('b', {
        text: rusak ? rusak + ' BARIS MELANGGAR INVARIAN'
          : (negBaris || kartu.akhir.qty < 0)
            ? (negBaris || 1) + ' BARIS BERSALDO NEGATIF — stok tidak mungkin negatif'
            : 'Invarian terpenuhi'
      }),
      ' — ' + kartu.baris.length + ' baris diperiksa untuk ' + sku + ' di ' +
      (gud === 'semua' ? 'seluruh lokasi' : gudangNama(gud)) +
      '; saldo akhir ' + D.angka(kartu.akhir.qty) + ' ' + D.satuanBasis(pr).kode.toLowerCase() +
      ' (' + D.fmtPecah(pr, kartu.akhir.qty) + ') senilai ' + D.rupiah(kartu.akhir.nilai) + '.' +
      (kartu.baris.length > 90 ? ' Ditampilkan 90 baris terakhir.' : '')));
    p.appendChild(card);
    renderPesan(p);

    // Cost layers for this SKU, per warehouse.
    var lay = h('div', { class: 'card' },
      h('h3', { text: state.metode === 'fifo' ? 'Lapisan biaya FIFO' : 'Nilai tercatat (rata-rata tertimbang)' }),
      h('p', { class: 'note' }, state.metode === 'fifo'
        ? 'Antrean nyata, bukan gambar. Lapisan teratas adalah yang akan dimakan pengeluaran berikutnya; kuncinya adalah (tanggal, nomor urut) dokumen penerimaan yang membuatnya.'
        : 'Metode rata-rata tidak menyimpan lapisan sama sekali. Yang dibawa hanyalah kuantitas dan total nilai per gudang; HPP per unit adalah pembagian keduanya, dibulatkan sekali.'));
    var adaLay = false;
    for (var gi = 0; gi < d.gudang.length + 1; gi++) {
      var gid = gi < d.gudang.length ? d.gudang[gi].id : D.TRANSIT;
      var st = H.st[sku + '|' + gid];
      if (!st || (st.qty === 0 && st.nilai === 0)) continue;
      adaLay = true;
      var blok = h('div', { style: 'margin-bottom:12px' },
        h('h4', { style: 'font-size:13px', text: gudangNama(gid) + ' — ' + D.fmtPecah(pr, st.qty) + ' senilai ' + D.rupiah(st.nilai) }));
      if (state.metode === 'fifo') {
        var maks = 1;
        for (var li = 0; li < st.layers.length; li++) maks = Math.max(maks, st.layers[li].qty);
        var stack = h('div', { class: 'lapisan' });
        for (li = 0; li < Math.min(st.layers.length, 12); li++) {
          var ly = st.layers[li];
          stack.appendChild(h('div', { class: 'lapis' + (li === 0 ? ' berikut' : '') },
            h('span', { class: 'kecil', text: ly.tgl || '—' }),
            h('div', { class: 'lapis-bar', style: 'width:' + Math.max(4, Math.round(100 * ly.qty / maks)) + '%' }),
            h('span', { text: D.angka(ly.qty) + ' @ ' + D.rupiah(ly.unitCost) }),
            h('span', { class: 'kecil', text: ly.srcDok || '' })));
        }
        blok.appendChild(stack);
        if (st.layers.length > 12) blok.appendChild(h('p', { class: 'hint', text: st.layers.length + ' lapisan, 12 tertua ditampilkan.' }));
        if (st.layers.length && li > 0) blok.appendChild(h('p', { class: 'hint', text: 'Lapisan bergaris merah adalah yang akan dikonsumsi lebih dulu.' }));
      } else {
        blok.appendChild(h('dl', { class: 'kv2' },
          h('dt', { text: 'Kuantitas' }), h('dd', { text: D.angka(st.qty) }),
          h('dt', { text: 'Nilai tercatat' }), h('dd', { text: D.rupiah(st.nilai) }),
          h('dt', { text: 'HPP per unit' }), h('dd', { text: D.rupiah(st.qty ? D.divRound(st.nilai, st.qty) : 0) })));
      }
      lay.appendChild(blok);
    }
    if (!adaLay) lay.appendChild(h('div', { class: 'empty', text: 'Tidak ada saldo untuk SKU ini di lokasi mana pun.' }));
    p.appendChild(lay);
  }

  /* =========================================================== HPP & METODE */

  function renderHpp(p) {
    var d = db(), hf = hasil('fifo'), hr = hasil('rata');
    var kf = L.konservasi(hf), kr = L.konservasi(hr);

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Metode penilaian persediaan, berdampingan' }),
      h('p', { class: 'note' },
        'Buku yang sama, dilipat dua kali. Bedanya bukan tampilan: FIFO menyimpan antrean lapisan biaya ',
        'nyata dan memakannya dari yang tertua, rata-rata membawa satu total nilai per gudang dan ',
        'menghitung ulang HPP setiap kali ada penerimaan. Karena harga beli memang bergerak (± 4% per PO ',
        'di data demo), keduanya menghasilkan angka yang berbeda — dan itulah keputusannya.'));

    var g = h('div', { class: 'banding' });
    [['fifo', hf, kf], ['rata', hr, kr]].forEach(function (t3) {
      var m = t3[0], hh = t3[1], kk = t3[2], lain = m === 'fifo' ? hr : hf;
      g.appendChild(h('div', { class: 'metode-kartu' + (state.metode === m ? ' aktif' : '') },
        h('h4', { text: m === 'fifo' ? 'FIFO — masuk pertama, keluar pertama' : 'Rata-rata tertimbang' }),
        h('dl', { class: 'kv2' },
          h('dt', { text: 'HPP penjualan' }), h('dd', { text: D.rupiah(hh.total.hppJual) }),
          h('dt', { text: 'Persediaan akhir' }), h('dd', { text: D.rupiah(hh.akhir.nilai) }),
          h('dt', { text: 'Penjualan (DPP, neto retur)' }), h('dd', { text: D.rupiah(L.labaKotor(hh).penjualan) }),
          h('dt', { text: 'HPP neto retur' }), h('dd', { text: D.rupiah(L.labaKotor(hh).hpp) }),
          h('dt', { text: 'Laba kotor' }), h('dd', { text: D.rupiah(L.labaKotor(hh).laba) + ' (' + L.marginTeks(L.labaKotor(hh).marginBp) + ')' }),
          h('dt', { text: 'Retur pembelian' }), h('dd', { text: D.rupiah(hh.total.returBeli) }),
          h('dt', { text: 'Penyesuaian bersih' }), h('dd', { text: D.rupiah(hh.total.adjMasuk - hh.total.adjKeluar) }),
          h('dt', { text: 'Selisih identitas' }), h('dd', { text: D.rupiah(kk.selisih) })),
        h('p', { class: 'kecil', style: 'margin-top:8px' },
          'Terhadap metode lain: HPP ', h('b', { text: D.rupiah(hh.total.hppJual - lain.total.hppJual) }),
          ', persediaan akhir ', h('b', { text: D.rupiah(hh.akhir.nilai - lain.akhir.nilai) })),
        h('div', { style: 'margin-top:10px' },
          h('button', {
            class: 'btn small' + (state.metode === m ? ' primary' : ''), type: 'button',
            'data-fkey': 'hpp:metode:' + m,
            onclick: function () { state.metode = m; simpanKonfig(); say('Metode ' + m); renderAll(); }
          }, state.metode === m ? 'Metode aktif' : 'Pakai metode ini'))));
    });
    card.appendChild(g);
    card.appendChild(h('p', { class: 'hint' },
      'Perhatikan bahwa selisih HPP dan selisih persediaan akhir saling meniadakan: ',
      D.rupiah((hf.total.hppJual - hr.total.hppJual) + (hf.akhir.nilai - hr.akhir.nilai)),
      ' setelah memperhitungkan retur dan penyesuaian yang ikut berubah. Metode biaya membagi nilai yang ',
      'sama secara berbeda; ia tidak menciptakan atau menghilangkan rupiah.'));
    p.appendChild(card);
    renderPesan(p);

    var pol = h('div', { class: 'card' },
      h('h3', { text: 'Kebijakan pembulatan, ditulis sekali' }),
      h('p', { class: 'note' },
        'Semua pembagian melewati satu fungsi, ', h('code', { text: 'divRound(a, b)' }),
        ', yang menerima dua bilangan bulat dan mengembalikan bilangan bulat, dibulatkan ',
        h('b', { text: 'setengah menjauhi nol' }), ' — 1.500/1.000 menjadi 2, 2.500/1.000 menjadi 3, ',
        '−1.500/1.000 menjadi −2. Bukan pembulatan bankir, karena itu yang dilakukan praktik dagang ',
        'Indonesia dan contoh perhitungan DJP, dan karena reviewer yang mengecek dengan kalkulator akan ',
        'membulatkan begitu.'),
      h('p', { class: 'note' },
        h('b', { text: 'Yang dibawa mesin rata-rata adalah TOTAL NILAI, bukan HPP per unit yang sudah dibulatkan. ' }),
        'Rumus bukunya tetap dihormati — HPP baru = (qty lama × hpp lama + qty masuk × harga masuk) / ',
        '(qty lama + qty masuk) — tetapi pembilang itu persis "nilai lama + nilai masuk", jadi mesin ',
        'menyimpan pembilangnya. Kalau HPP per unit yang dibulatkan dikalikan ulang di setiap ',
        'pengeluaran, sisa pembulatan lolos keluar: pembelian berhenti sama dengan HPP ditambah ',
        'persediaan akhir, beberapa rupiah per transaksi, selamanya. Dengan membawa nilai, sisa itu ',
        'tinggal di dalam nilai persediaan — tempatnya memang di situ — dan ketika unit terakhir keluar, ',
        'qty keluar sama dengan qty tersedia sehingga nilainya jatuh tepat ke nol.'),
      h('p', { class: 'note' }, D.CATATAN_LIFO));
    p.appendChild(pol);

    // Per-SKU comparison for the SKUs where the two methods disagree most.
    var baris = [];
    for (var i = 0; i < d.produk.length; i++) {
      var sku = d.produk[i].sku;
      var pf = L.posisiSku(hf, sku), pgr = L.posisiSku(hr, sku);
      if (pf.qty === 0 && pgr.qty === 0) continue;
      baris.push({ sku: sku, nama: d.produk[i].nama, qty: pf.qty, f: pf, r: pgr, beda: Math.abs(pf.nilai - pgr.nilai) });
    }
    baris.sort(function (a, b) { return b.beda - a.beda; });
    var rows = [];
    for (i = 0; i < Math.min(baris.length, 25); i++) {
      var b = baris[i];
      rows.push(h('tr', null,
        h('td', null, h('button', {
          class: 'linkbtn sku', type: 'button', 'data-fkey': 'hpp:sku:' + fkey(b.sku),
          onclick: (function (sk) { return function () { state.sel.kartuSku = sk; switchTab('kartu'); }; })(b.sku)
        }, b.sku)),
        h('td', { class: 'wrap-normal', style: 'white-space:normal', text: b.nama }),
        qtyCell(b.sku, b.qty),
        tdRp(b.f.unit), tdRp(b.f.nilai),
        tdRp(b.r.unit), tdRp(b.r.nilai),
        h('td', { class: 'num rp ' + (b.f.nilai - b.r.nilai > 0 ? 'plus' : b.f.nilai - b.r.nilai < 0 ? 'minus' : 'nol'), text: D.rupiah(b.f.nilai - b.r.nilai) })));
    }
    var tab = h('div', { class: 'card' },
      h('h3', { text: 'Di SKU mana kedua metode paling berbeda' }),
      h('p', { class: 'note' }, 'Diurutkan menurut selisih nilai persediaan akhir. Selisih terbesar selalu jatuh pada SKU yang harga belinya paling bergerak dan perputarannya paling cepat.'));
    tab.appendChild(tableOf(['SKU', 'Nama', { label: 'Saldo', num: 1 },
      { label: 'FIFO /unit', num: 1 }, { label: 'FIFO nilai', num: 1 },
      { label: 'Rata /unit', num: 1 }, { label: 'Rata nilai', num: 1 }, { label: 'Selisih', num: 1 }],
      rows, { minWidth: '980px' }));
    p.appendChild(tab);
  }

  /* ========================================================= TANGGAL MUNDUR */

  function renderMundur(p) {
    var d = db(), s = sortedEntries();

    if (!state.sel.mundurSku) {
      var saran = L.saranSkenarioMundur(s, state.sel.mundurTgl);
      if (saran.length) {
        state.sel.mundurSku = saran[0].sku;
        state.sel.mundurGudang = saran[0].gudang;
        var pr0 = prod(saran[0].sku);
        state.sel.mundurQty = D.mul(20, pr0.satuan[0].faktor);
        state.sel.mundurHarga = D.divRound(D.mul(pr0.hargaBeli, 13000), 10000);
      }
    }

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Menyisipkan dokumen bertanggal mundur' }),
      h('p', { class: 'note' },
        h('b', { text: 'Ini bagian yang paling sering salah di sistem persediaan. ' }),
        'Memasukkan pembelian bertanggal minggu lalu membatalkan setiap angka HPP sesudahnya: ',
        'pengeluaran yang menyusul memakan lapisan yang kini tidak lagi ada dalam urutan yang sama, dan ',
        'di bawah rata-rata mereka dinilai terhadap rata-rata yang tidak pernah terjadi. Banyak sistem ',
        'diam-diam membiarkan angka lama, atau menghitung ulang tanpa memberi tahu apa yang berubah.'),
      h('p', { class: 'note' },
        'Yang dilakukan mesin ini: mengambil snapshot keadaan biaya di setiap batas periode, memulai ',
        'hitung ulang dari snapshot terakhir sebelum tanggal dokumen, lalu ',
        h('b', { text: 'membandingkan hasilnya dokumen demi dokumen' }),
        '. Tab Uji membuktikan hasil inkremental itu identik dengan replay penuh — tanpa itu, jalur ',
        'inkremental hanyalah harapan.'));

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('Produk', select(
      d.produk.map(function (x) { return { value: x.sku, label: x.sku + ' — ' + x.nama }; }),
      state.sel.mundurSku, function (v) {
        state.sel.mundurSku = v; state.mundurHasil = null;
        var pp = prod(v);
        state.sel.mundurQty = D.mul(20, pp.satuan[0].faktor);
        state.sel.mundurHarga = D.divRound(D.mul(pp.hargaBeli, 13000), 10000);
        renderPanel('mundur');
      }, { 'data-fkey': 'mundur:sku' })));
    ctl.appendChild(field('Gudang', select(
      d.gudang.map(function (g) { return { value: g.id, label: g.nama }; }),
      state.sel.mundurGudang, function (v) { state.sel.mundurGudang = v; state.mundurHasil = null; renderPanel('mundur'); },
      { 'data-fkey': 'mundur:gudang' })));
    var tglInp = h('input', { type: 'date', value: state.sel.mundurTgl, min: '2026-03-01', max: d.hariIni, 'data-fkey': 'mundur:tgl' });
    tglInp.addEventListener('change', function () { state.sel.mundurTgl = tglInp.value; state.mundurHasil = null; renderPanel('mundur'); });
    ctl.appendChild(field('Tanggal dokumen', tglInp));
    ctl.appendChild(field('Kuantitas (satuan dasar)', numInput(state.sel.mundurQty, function (v) {
      state.sel.mundurQty = parseInt(v, 10) || 0; state.mundurHasil = null; renderPanel('mundur');
    }, { 'data-fkey': 'mundur:qty', min: 1, step: 1, style: 'width:110px' })));
    ctl.appendChild(field('Harga beli / unit dasar', numInput(state.sel.mundurHarga, function (v) {
      state.sel.mundurHarga = parseInt(v, 10) || 0; state.mundurHasil = null; renderPanel('mundur');
    }, { 'data-fkey': 'mundur:harga', min: 0, step: 25, style: 'width:120px' })));
    card.appendChild(ctl);

    var calon = {
      tgl: state.sel.mundurTgl, sku: state.sel.mundurSku, gudang: state.sel.mundurGudang,
      arah: 1, qty: state.sel.mundurQty, jenis: 'terima', harga: state.sel.mundurHarga
    };
    var cek = L.periksaPosting(d.buku, calon, { peran: state.peran, hariIni: d.hariIni });

    var act = h('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; margin-top:10px' },
      h('button', {
        class: 'btn primary', type: 'button', 'data-fkey': 'mundur:simulasi',
        onclick: function () { simulasiMundur(calon); renderPanel('mundur'); }
      }, 'Simulasikan penghitungan ulang'),
      h('button', {
        class: 'btn', type: 'button', 'data-fkey': 'mundur:posting',
        onclick: function () { postingMundur(calon); }
      }, 'Posting sungguhan ke buku'));
    card.appendChild(act);

    if (!cek.ok) {
      card.appendChild(h('div', { class: 'tolak' },
        h('b', { text: 'Dokumen ini akan DITOLAK: ' }),
        h('ul', { style: 'margin:6px 0 0 18px' }, cek.alasan.map(function (a) { return h('li', { text: a }); }))));
    } else if (cek.peringatan.length) {
      card.appendChild(h('div', { class: 'terima-ok' },
        h('b', { text: 'Diterima, dengan catatan: ' }), cek.peringatan.join(' ')));
    }

    var per = D.periodeOf(state.sel.mundurTgl);
    var tutupList = Object.keys(d.buku.tutup).sort();
    card.appendChild(h('p', { class: 'hint' },
      'Periode tertutup: ', tutupList.length ? tutupList.map(D.periodeLabel).join(', ') : '(tidak ada'
      , tutupList.length ? '' : ')', '. Periode dokumen ini: ', h('b', { text: D.periodeLabel(per) }),
      d.buku.tutup[per] ? ' — TERTUTUP.' : ' — terbuka.'));

    var tutupCtl = h('div', { class: 'chips' });
    ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].forEach(function (pe) {
      tutupCtl.appendChild(h('button', {
        class: 'chip', type: 'button', 'aria-pressed': d.buku.tutup[pe] ? 'true' : 'false',
        'data-fkey': 'mundur:tutup:' + pe,
        onclick: function () { togglePeriode(pe); }
      }, D.periodeLabel(pe) + (d.buku.tutup[pe] ? ' · tertutup' : ' · terbuka')));
    });
    card.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: 'Buka atau tutup periode (hanya supervisor):' }));
    card.appendChild(tutupCtl);
    p.appendChild(card);
    renderPesan(p);

    if (state.mundurHasil) renderHasilMundur(p, state.mundurHasil);
  }

  function togglePeriode(pe) {
    var d = db();
    var aksi = d.buku.tutup[pe] ? 'periode.buka' : 'periode.tutup';
    if (!bolehkah(aksi)) { renderPanel('mundur'); return; }
    if (d.buku.tutup[pe]) delete d.buku.tutup[pe];
    else d.buku.tutup[pe] = { oleh: state.peran, tgl: d.hariIni };
    simpanTutup();
    audit(aksi, { periode: pe });
    sukses(d.buku.tutup[pe] ? 'Periode ' + D.periodeLabel(pe) + ' ditutup' : 'Periode ' + D.periodeLabel(pe) + ' dibuka kembali',
      [d.buku.tutup[pe]
        ? 'Dokumen bertanggal di dalamnya tidak bisa diposting lagi sampai dibuka.'
        : 'Dokumen bertanggal di dalamnya kini bisa diposting, dan HPP setelahnya akan dihitung ulang.']);
    renderPanel('mundur');
  }

  function simulasiMundur(calon) {
    var d = db();
    var opts = { metode: state.metode, hargaAcuan: d.hargaAcuan };
    var s = sortedEntries();
    var sebelum = L.replay(s, opts);
    var salinan = { entries: d.buku.entries.slice(), seqBerikut: d.buku.seqBerikut, tutup: d.buku.tutup, dokBerikut: {} };
    var baru;
    try {
      baru = L.tambah(salinan, {
        tgl: calon.tgl, sku: calon.sku, gudang: calon.gudang, arah: 1, qty: calon.qty,
        jenis: 'terima', dok: 'PN-SIMULASI', harga: calon.harga, mundur: true
      });
    } catch (e) {
      tolak('Simulasi gagal', [String(e.message || e)]);
      return;
    }
    var s2 = L.urut(salinan.entries);
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var inc = L.hitungUlangDari(sebelum, s2, calon.tgl, opts);
    var tInc = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
    var penuh = L.replay(s2, opts);
    var tPenuh = ((window.performance && performance.now) ? performance.now() : Date.now()) - t1;

    var tidakCocok = 0, dicek = 0;
    for (var id in penuh.hasil) {
      if (!Object.prototype.hasOwnProperty.call(penuh.hasil, id)) continue;
      dicek++;
      var a = penuh.hasil[id], b = inc.hasil.hasil[id];
      if (!b || a.nilai !== b.nilai || a.unit !== b.unit) tidakCocok++;
    }
    var diff = L.bandingkan(sebelum, penuh, L.layerKunci(calon.tgl, baru.seq));
    state.mundurHasil = {
      sebelum: sebelum, sesudah: penuh, diff: diff, inc: inc,
      cocok: tidakCocok === 0, dicek: dicek, tInc: Math.round(tInc), tPenuh: Math.round(tPenuh),
      konsSebelum: L.konservasi(sebelum), konsSesudah: L.konservasi(penuh),
      calon: calon, metode: state.metode
    };
    say('Simulasi selesai. ' + diff.jumlah + ' dokumen berubah HPP-nya, ' + diff.berubahSebelumBatas + ' di antaranya sebelum titik sisip.');
  }

  function postingMundur(calon) {
    var d = db();
    if (!bolehkah('mundur.posting')) { renderPanel('mundur'); return; }
    var cek = L.periksaPosting(d.buku, calon, { peran: state.peran, hariIni: d.hariIni });
    if (!cek.ok) { tolak('Penerimaan bertanggal mundur ditolak', cek.alasan); renderPanel('mundur'); return; }
    var sebelum = hasil(state.metode);
    var e;
    try {
      e = L.tambah(d.buku, {
        tgl: calon.tgl, sku: calon.sku, gudang: calon.gudang, arah: 1, qty: calon.qty,
        jenis: 'terima', dok: L.nomorDok(d.buku, 'PN'), harga: calon.harga, mundur: true,
        catatan: 'penerimaan bertanggal mundur, diposting ' + D.tglPanjang(d.hariIni)
      });
    } catch (err) { tolak('Posting gagal', [String(err.message || err)]); renderPanel('mundur'); return; }
    simpanEntry(e);
    audit('mundur.posting', { entry: e.id, tgl: e.tgl, sku: e.sku, gudang: e.gudang, qty: e.qty, harga: e.harga });
    invalidate();
    var sesudah = hasil(state.metode);
    var diff = L.bandingkan(sebelum, sesudah, L.layerKunci(calon.tgl, e.seq));
    state.mundurHasil = {
      sebelum: sebelum, sesudah: sesudah, diff: diff, inc: null,
      cocok: true, dicek: Object.keys(sesudah.hasil).length, tInc: null, tPenuh: null,
      konsSebelum: L.konservasi(sebelum), konsSesudah: L.konservasi(sesudah),
      calon: calon, metode: state.metode, diposting: e.dok
    };
    sukses('Penerimaan ' + e.dok + ' diposting bertanggal ' + D.tglPanjang(calon.tgl),
      [diff.jumlah + ' dokumen setelahnya dihitung ulang. ' + diff.berubahSebelumBatas + ' dokumen sebelum titik sisip berubah (harus nol).']);
    renderPanel('mundur');
  }

  function renderHasilMundur(p, R) {
    var diff = R.diff;
    var card = h('div', { class: 'card' },
      h('h3', { text: R.diposting ? 'Sudah diposting: ' + R.diposting : 'Hasil simulasi' }),
      h('p', { class: 'note' },
        'Metode ', h('b', { text: R.metode === 'fifo' ? 'FIFO' : 'rata-rata' }), '. ',
        'Penerimaan ', D.angka(R.calon.qty), ' unit dasar @ ', D.rupiah(R.calon.harga),
        ' bertanggal ', D.tglPanjang(R.calon.tgl), ' di ', gudangNama(R.calon.gudang), '.'));

    var sum = h('div', { class: 'summary' },
      statTile('Dokumen berubah', D.angka(diff.jumlah), 'dari ' + D.angka(R.dicek) + ' dokumen berbiaya'),
      statTile('Berubah SEBELUM titik sisip', D.angka(diff.berubahSebelumBatas), diff.berubahSebelumBatas === 0 ? 'dua replay penuh dibandingkan' : 'SALAH'),
      statTile('HPP total', D.rupiah(diff.hppSesudah), 'sebelumnya ' + D.rupiah(diff.hppSebelum)),
      statTile('Persediaan akhir', D.rupiah(diff.akhirSesudah), 'sebelumnya ' + D.rupiah(diff.akhirSebelum)),
      statTile('Selisih identitas', D.rupiah(R.konsSesudah.selisih), R.konsSesudah.selisih === 0 ? 'tetap tertutup' : 'RUSAK'));
    card.appendChild(sum);

    if (R.inc) {
      /* This is the check that carries the information, and the panel says so.
       * "Nothing before the insertion point changed" is compared between two
       * INDEPENDENT full replays; the reused pre-boundary results are deep-copied
       * out of the previous run (L.cloneHasil) precisely so that a comparison
       * against them cannot be a comparison of an object with itself. */
      card.appendChild(h('div', { class: R.cocok ? 'terima-ok' : 'tolak' },
        h('b', { text: R.cocok ? 'Jalur inkremental diverifikasi terhadap replay penuh' : 'JALUR INKREMENTAL TIDAK COCOK' }),
        ' — ' + D.angka(R.dicek) + ' dokumen dibandingkan satu per satu, nilai demi nilai, antara hitung ulang ' +
        'inkremental dan replay penuh dari buku kosong. Hitung ulang dimulai dari snapshot ' +
        (R.inc.dariSnapshot ? D.periodeLabel(R.inc.dariSnapshot) : '(awal buku)') + ', ' +
        D.angka(R.inc.entriDipakaiUlang) + ' dokumen sebelum batas dipakai ulang — disalin, bukan dipakai bersama, ' +
        'supaya perbandingannya membandingkan angka dan bukan objek yang sama. ' +
        'Inkremental ' + R.tInc + ' ms, replay penuh ' + R.tPenuh + ' ms.'));
    }

    var kons = h('div', { class: 'rekon' });
    [['Pembelian', R.konsSebelum.pembelian, R.konsSesudah.pembelian],
    ['HPP penjualan', R.konsSebelum.hppJual, R.konsSesudah.hppJual],
    ['Persediaan akhir', R.konsSebelum.persediaanAkhir, R.konsSesudah.persediaanAkhir],
    ['Retur penjualan', R.konsSebelum.returJual, R.konsSesudah.returJual],
    ['Penyesuaian keluar', R.konsSebelum.adjKeluar, R.konsSesudah.adjKeluar]].forEach(function (b) {
      kons.appendChild(h('div', { class: 'rekon-baris' },
        h('span', { text: b[0] }),
        h('span', { class: 'n', text: D.rupiah(b[1]) + '  →  ' + D.rupiah(b[2]) + '   (' + D.rupiah(b[2] - b[1]) + ')' })));
    });
    kons.appendChild(h('div', { class: 'rekon-baris total sisa' + (R.konsSesudah.selisih ? ' rusak' : '') },
      h('span', { text: 'Selisih identitas nilai sesudah' }),
      h('span', { class: 'n', text: D.rupiah(R.konsSesudah.selisih) })));
    card.appendChild(kons);
    p.appendChild(card);

    var lst = h('div', { class: 'card' },
      h('h3', { text: 'Dokumen yang HPP-nya berubah' }),
      h('p', { class: 'note' },
        'Hanya dokumen setelah titik sisip yang boleh muncul di sini. Kalau ada satu saja dokumen ',
        'bertanggal lebih awal, hitung ulangnya bukan lokal dan angka yang sudah dilaporkan ikut bergerak.'));
    if (!diff.berubah.length) {
      lst.appendChild(h('div', { class: 'empty' },
        'Tidak ada dokumen yang berubah. Di bawah FIFO ini bisa benar-benar terjadi: kalau antrean ' +
        'lapisan SKU itu tidak pernah habis sampai ke titik sisip, lapisan baru duduk di belakang ' +
        'lapisan lama dan tidak ada pengeluaran yang menyentuhnya. Coba SKU yang saldonya pernah ' +
        'menyentuh nol, atau ganti metode ke rata-rata — di sana setiap penerimaan menggeser rata-rata.'));
    } else {
      var box = h('div');
      for (var i = 0; i < Math.min(diff.berubah.length, 60); i++) {
        var b = diff.berubah[i];
        box.appendChild(h('div', { class: 'diff-baris' },
          h('span', { class: 'n', text: b.tgl }),
          h('span', null, h('span', { class: 'gerak ' + b.jenis, text: D.JENIS[b.jenis].label }), ' ', h('span', { class: 'sku', text: b.id })),
          h('span', { class: 'n', text: D.rupiah(b.nilaiSebelum) }),
          h('span', { class: 'panah', text: '→' }),
          h('span', { class: 'n ' + (b.delta > 0 ? 'naik' : 'turun'), text: D.rupiah(b.nilaiSesudah) + '  (' + (b.delta > 0 ? '+' : '') + D.rupiah(b.delta) + ')' })));
      }
      lst.appendChild(box);
      if (diff.berubah.length > 60) lst.appendChild(h('p', { class: 'hint', text: diff.berubah.length + ' dokumen berubah, 60 pertama ditampilkan.' }));
      lst.appendChild(h('p', { class: 'hint', text: 'Total pergeseran nilai dokumen: ' + D.rupiah(diff.deltaTotal) + '.' }));
    }
    p.appendChild(lst);
  }

  /* ============================================================= PEMBELIAN */

  function renderPembelian(p) {
    var d = db();
    var card = h('div', { class: 'card' },
      h('h3', { text: 'Purchase order dan pencocokan tiga arah' }),
      h('p', { class: 'note' },
        'PO → penerimaan → faktur supplier. Penerimaan sebagian diizinkan dan PO-nya tetap terbuka. ',
        'Faktur dicocokkan terhadap ', h('b', { text: 'yang benar-benar diterima' }),
        ', bukan terhadap yang dipesan, dan setiap selisih kuantitas atau harga ditandai beserta dampak ',
        'rupiahnya. Sistem yang diam-diam menerima faktur di atas harga PO adalah sistem yang membayar ',
        'berapa pun yang ditagihkan.'));

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('Tampilkan', select(
      [{ value: 'semua', label: 'Semua PO' }, { value: 'selisih', label: 'Hanya yang berselisih' },
      { value: 'parsial', label: 'Belum diterima penuh' }, { value: 'cocok', label: 'Cocok sempurna' }],
      state.sel.poFilter, function (v) { state.sel.poFilter = v; renderPanel('pembelian'); }, { 'data-fkey': 'po:filter' })));
    card.appendChild(ctl);

    var rows = [], hitung = { cocok: 0, selisih: 0, parsial: 0, menunggu: 0 }, tampil = 0;
    for (var i = d.po.length - 1; i >= 0; i--) {
      var po = d.po[i];
      var terima = d.penerimaan.filter(function (x) { return x.poId === po.id; });
      var fak = null;
      for (var j = 0; j < d.faktur.length; j++) if (d.faktur[j].poId === po.id) fak = d.faktur[j];
      var m = P.cocokTigaArah(po, terima, fak);
      if (m.status === 'cocok') hitung.cocok++;
      else if (m.status === 'selisih') hitung.selisih++;
      else if (m.status === 'parsial') hitung.parsial++;
      else hitung.menunggu++;
      if (state.sel.poFilter === 'selisih' && m.status !== 'selisih') continue;
      if (state.sel.poFilter === 'cocok' && m.status !== 'cocok') continue;
      if (state.sel.poFilter === 'parsial' && m.status === 'cocok') continue;
      tampil++;
      if (tampil > 40) continue;
      var st = P.statusPo(po, terima);
      var sup = d.supplier.filter(function (x) { return x.id === po.supplierId; })[0];
      (function (po, m, st, sup, terima, fak) {
        rows.push(h('tr', { class: state.sel.poId === po.id ? 'sel' : null },
          h('td', null, h('button', {
            class: 'linkbtn sku', type: 'button', 'data-fkey': 'po:' + fkey(po.id),
            onclick: function () { state.sel.poId = state.sel.poId === po.id ? '' : po.id; renderPanel('pembelian'); }
          }, po.id)),
          h('td', { class: 'bc', text: po.tgl }),
          h('td', { class: 'wrap-normal', style: 'white-space:normal', text: sup ? sup.nama : po.supplierId }),
          h('td', { text: gudangNama(po.gudangId) }),
          tdNum(po.baris.length),
          h('td', null, h('span', { class: 'pill ' + (st.kode === 'penuh' ? 'ok' : st.kode === 'lebih' ? 'bad' : 'warn'), text: st.label })),
          h('td', null, h('span', {
            class: 'pill ' + (m.status === 'cocok' ? 'ok' : m.status === 'selisih' ? 'bad' : 'info'),
            text: m.status === 'cocok' ? 'Cocok' : m.status === 'selisih' ? 'Selisih' : m.status === 'parsial' ? 'Parsial' : 'Menunggu faktur'
          })),
          h('td', { class: 'wrap-normal', text: m.flags.join(', ') || '—' }),
          h('td', { class: 'num rp ' + (m.dampakRupiah ? 'minus' : 'nol'), text: fak ? D.rupiah(m.dampakRupiah) : '—' })));
      })(po, m, st, sup, terima, fak);
    }
    card.appendChild(tableOf(['PO', 'Tanggal', 'Supplier', 'Gudang', { label: 'Baris', num: 1 }, 'Penerimaan', 'Pencocokan', 'Bendera', { label: 'Dampak', num: 1 }],
      rows, { minWidth: '1000px' }));
    card.appendChild(h('p', { class: 'hint' },
      hitung.cocok + ' cocok · ' + hitung.selisih + ' berselisih · ' + hitung.parsial + ' diterima sebagian · ' +
      hitung.menunggu + ' menunggu faktur. Klik nomor PO untuk melihat pencocokan barisnya.'));
    p.appendChild(card);
    renderPesan(p);

    if (state.sel.poId) {
      var po2 = null;
      for (i = 0; i < d.po.length; i++) if (d.po[i].id === state.sel.poId) po2 = d.po[i];
      if (po2) {
        var terima2 = d.penerimaan.filter(function (x) { return x.poId === po2.id; });
        var fak2 = null;
        for (j = 0; j < d.faktur.length; j++) if (d.faktur[j].poId === po2.id) fak2 = d.faktur[j];
        var m2 = P.cocokTigaArah(po2, terima2, fak2);
        var det = h('div', { class: 'card' },
          h('h3', { text: 'Pencocokan tiga arah — ' + po2.id }),
          h('div', { class: 'jalur' },
            h('span', { class: 'titik aktif', text: 'PO ' + po2.id }), h('span', { class: 'anak', text: '→' }),
            h('span', { class: 'titik' + (terima2.length ? ' aktif' : ''), text: terima2.length ? terima2.length + ' penerimaan' : 'belum diterima' }),
            h('span', { class: 'anak', text: '→' }),
            h('span', { class: 'titik' + (fak2 ? ' aktif' : ''), text: fak2 ? 'Faktur ' + fak2.id : 'faktur belum masuk' })));
        var rows2 = [];
        for (i = 0; i < m2.baris.length; i++) {
          var b = m2.baris[i];
          var pr = prod(b.sku);
          rows2.push(h('tr', null,
            h('td', { class: 'sku', text: b.sku }),
            h('td', { class: 'wrap-normal', style: 'white-space:normal', text: pr ? pr.nama : '' }),
            tdNum(b.qtyPo), tdNum(b.qtyTerima), tdNum(b.qtyFaktur),
            h('td', { class: 'num rp ' + (b.selisihQty ? 'minus' : 'nol'), text: fak2 ? D.angka(b.selisihQty) : '—' }),
            tdRp(b.hargaPo), h('td', { class: 'num', text: b.hargaFaktur === null ? '—' : D.rupiah(b.hargaFaktur) }),
            h('td', { class: 'num rp ' + (b.selisihHargaUnit ? 'minus' : 'nol'), text: fak2 ? D.rupiah(b.selisihHargaUnit) : '—' }),
            h('td', { class: 'wrap-normal', text: b.flags.join(', ') || 'cocok' })));
        }
        det.appendChild(tableOf(['SKU', 'Nama', { label: 'Qty PO', num: 1 }, { label: 'Qty terima', num: 1 }, { label: 'Qty faktur', num: 1 },
          { label: 'Selisih qty', num: 1 }, { label: 'Harga PO', num: 1 }, { label: 'Harga faktur', num: 1 },
          { label: 'Selisih harga', num: 1 }, 'Temuan'], rows2, { minWidth: '980px' }));
        if (fak2) {
          var nilaiFaktur = 0;
          for (i = 0; i < m2.baris.length; i++) nilaiFaktur += m2.baris[i].nilaiFaktur;
          var pjk = D.hitungPpn(nilaiFaktur, false);
          det.appendChild(h('dl', { class: 'kv2' },
            h('dt', { text: 'Nomor faktur pajak' }), h('dd', { text: fak2.noFaktur }),
            h('dt', { text: 'DPP' }), h('dd', { text: D.rupiah(pjk.dpp) }),
            h('dt', { text: 'PPN 11%' }), h('dd', { text: D.rupiah(pjk.ppn) }),
            h('dt', { text: 'Total tagihan' }), h('dd', { text: D.rupiah(pjk.total) }),
            h('dt', { text: 'Nilai yang benar-benar diterima' }), h('dd', { text: D.rupiah(nilaiFaktur - m2.dampakRupiah) })));
          det.appendChild(h('div', { class: m2.adaMasalah ? 'tolak' : 'terima-ok' },
            h('b', { text: m2.adaMasalah ? 'Faktur ini TIDAK boleh dibayar apa adanya. ' : 'Faktur cocok. ' }),
            m2.adaMasalah
              ? ('Selisihnya ' + D.rupiah(m2.dampakRupiah) + ' terhadap barang yang benar-benar diterima (' + m2.flags.join(', ') + ').')
              : 'Kuantitas dan harga sama persis dengan penerimaan dan PO.'));
          det.appendChild(h('p', { class: 'hint' },
            'Faktur supplier di sini selalu dihitung eksklusif — harga di faktur adalah DPP dan PPN ditambahkan di atasnya. ',
            'Setelan inklusif/eksklusif di bilah konteks berlaku untuk harga jual di kasir, bukan untuk faktur pembelian.'));
        }
        p.appendChild(det);
      }
    }
  }

  /* ============================================================ PENERIMAAN */

  function renderPenerimaan(p) {
    var d = db();
    if (!state.sel.terimaTgl) state.sel.terimaTgl = d.hariIni;

    var terbuka = [];
    for (var i = 0; i < d.po.length; i++) {
      var po = d.po[i];
      var terima = d.penerimaan.filter(function (x) { return x.poId === po.id; });
      var st = P.statusPo(po, terima);
      if (st.kode === 'terbuka' || st.kode === 'parsial') terbuka.push({ po: po, terima: terima, st: st });
    }

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Penerimaan barang' }),
      h('p', { class: 'note' },
        'Menerima barang menulis entry ', h('code', { text: 'terima' }), ' ke buku besar pada harga PO-nya, ',
        'dan penerimaan itulah yang membuat lapisan biaya FIFO. Penerimaan sebagian diizinkan; sisanya ',
        'tetap terbuka sampai datang atau sampai PO ditutup. ',
        h('b', { text: 'Yang menerima fisik barang adalah orang gudang' }), ', bukan orang yang memesannya — ',
        'coba ganti peran ke Pembelian dan tombolnya akan menolak, dengan alasannya.'));

    var izin = D.izin(state.peran, 'beli.terima');
    if (!izin.ok) card.appendChild(h('div', { class: 'tolak' }, h('b', { text: 'Peran saat ini tidak bisa memposting penerimaan. ' }), izin.alasan));

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('PO terbuka', select(
      [{ value: '', label: '— pilih PO —' }].concat(terbuka.map(function (x) {
        return { value: x.po.id, label: x.po.id + ' · ' + x.po.tgl + ' · ' + x.st.label + ' (' + D.angka(x.st.terima) + '/' + D.angka(x.st.pesan) + ')' };
      })),
      state.sel.terimaPo, function (v) { state.sel.terimaPo = v; renderPanel('penerimaan'); }, { 'data-fkey': 'pn:po' })));
    var tglI = h('input', { type: 'date', value: state.sel.terimaTgl, min: '2026-03-01', max: d.hariIni, 'data-fkey': 'pn:tgl' });
    tglI.addEventListener('change', function () { state.sel.terimaTgl = tglI.value; renderPanel('penerimaan'); });
    ctl.appendChild(field('Tanggal terima', tglI));
    card.appendChild(ctl);

    var pilih = null;
    for (i = 0; i < terbuka.length; i++) if (terbuka[i].po.id === state.sel.terimaPo) pilih = terbuka[i];
    if (pilih) {
      var sisa = {};
      for (i = 0; i < pilih.po.baris.length; i++) sisa[pilih.po.baris[i].sku] = pilih.po.baris[i].qtyBase;
      for (i = 0; i < pilih.terima.length; i++)
        for (var j = 0; j < pilih.terima[i].baris.length; j++)
          sisa[pilih.terima[i].baris[j].sku] -= pilih.terima[i].baris[j].qtyBase;

      if (!state.terimaDraft || state.terimaDraft.poId !== pilih.po.id) {
        state.terimaDraft = { poId: pilih.po.id, qty: {}, izinkanLebih: false };
        for (i = 0; i < pilih.po.baris.length; i++) state.terimaDraft.qty[pilih.po.baris[i].sku] = Math.max(0, sisa[pilih.po.baris[i].sku]);
      }
      var rows = [];
      for (i = 0; i < pilih.po.baris.length; i++) {
        (function (b) {
          var pr = prod(b.sku);
          var sisaB = Math.max(0, sisa[b.sku]);
          rows.push(h('tr', null,
            h('td', { class: 'sku', text: b.sku }),
            h('td', { class: 'wrap-normal', style: 'white-space:normal', text: pr.nama }),
            h('td', { class: 'bc', text: b.satuan + ' = ' + D.angka(D.satuanByKode(pr, b.satuan).faktor) + ' ' + D.satuanBasis(pr).kode.toLowerCase() }),
            tdNum(b.qtyBase), tdNum(sisaB),
            tdRp(b.hargaBase),
            h('td', null, numInput(state.terimaDraft.qty[b.sku], function (v) {
              /* The max attribute is a hint, not a control: a typed value is
               * accepted verbatim by input[type=number] and nothing here runs
               * form validation. Clamped here AND checked again in
               * postingPenerimaan, because one 24-unit line absorbed 999.999
               * units and Rp23 billion of fabricated inventory in one click. */
              var q0 = Math.max(0, parseInt(v, 10) || 0);
              state.terimaDraft.qty[b.sku] = state.terimaDraft.izinkanLebih ? q0 : Math.min(sisaB, q0);
              renderPanel('penerimaan');
            }, {
              'data-fkey': 'pn:qty:' + fkey(b.sku), min: 0, max: state.terimaDraft.izinkanLebih ? null : sisaB, step: 1,
              'aria-label': 'Kuantitas diterima untuk ' + pr.nama + ', dalam ' + D.satuanBasis(pr).kode.toLowerCase()
            })),
            h('td', { class: 'bc', text: D.fmtPecah(pr, state.terimaDraft.qty[b.sku] || 0) }),
            tdRp(D.mul(state.terimaDraft.qty[b.sku] || 0, b.hargaBase))));
        })(pilih.po.baris[i]);
      }
      card.appendChild(tableOf(['SKU', 'Nama', 'Satuan beli', { label: 'Qty PO', num: 1 }, { label: 'Sisa', num: 1 },
        { label: 'Harga/unit dasar', num: 1 }, { label: 'Terima sekarang', num: 1 }, 'Pecahan', { label: 'Nilai', num: 1 }],
        rows, { minWidth: '980px' }));

      var totalNilai = 0, totalQty = 0;
      for (i = 0; i < pilih.po.baris.length; i++) {
        var q = state.terimaDraft.qty[pilih.po.baris[i].sku] || 0;
        totalQty += q;
        totalNilai += D.mul(q, pilih.po.baris[i].hargaBase);
      }
      card.appendChild(h('p', { class: 'hint', text: 'Total penerimaan: ' + D.angka(totalQty) + ' unit dasar senilai ' + D.rupiah(totalNilai) + '.' }));

      /* Over-receipt is a real thing that happens — a supplier ships a full
       * carton against a part-order — so it is possible, but it is a deliberate,
       * named, supervisor-only act, not a typo that goes through unnoticed and
       * surfaces on a three-way-match screen the receiver never opens. */
      var bolehLebih = state.peran === 'supervisor';
      var cbWrap = h('label', { class: 'field', style: 'flex-direction:row; align-items:center; gap:8px; margin-top:8px' });
      var cb = h('input', {
        type: 'checkbox', 'data-fkey': 'pn:lebih', checked: state.terimaDraft.izinkanLebih ? true : null,
        disabled: bolehLebih ? null : true
      });
      cb.addEventListener('change', function () {
        state.terimaDraft.izinkanLebih = !!cb.checked;
        renderPanel('penerimaan');
      });
      cbWrap.appendChild(cb);
      cbWrap.appendChild(h('span', {
        style: 'font-size:12px',
        text: bolehLebih
          ? 'Izinkan terima melebihi sisa PO (over-terima) — akan ditandai di pencocokan tiga arah'
          : 'Terima melebihi sisa PO hanya boleh disahkan Supervisor'
      }));
      card.appendChild(cbWrap);

      card.appendChild(h('div', { style: 'margin-top:8px' },
        h('button', {
          class: 'btn primary', type: 'button', 'data-fkey': 'pn:posting',
          onclick: function () { postingPenerimaan(pilih, sisa); }
        }, 'Posting penerimaan')));
    } else {
      card.appendChild(h('div', { class: 'empty', text: terbuka.length ? 'Pilih PO yang masih terbuka di atas.' : 'Tidak ada PO terbuka.' }));
    }
    p.appendChild(card);
    renderPesan(p);

    var lst = h('div', { class: 'card' }, h('h3', { text: 'Penerimaan terakhir' }));
    var rows2 = [];
    for (i = d.penerimaan.length - 1; i >= Math.max(0, d.penerimaan.length - 25); i--) {
      var pn = d.penerimaan[i];
      var nilai = 0, qty = 0;
      for (j = 0; j < pn.baris.length; j++) { nilai += D.mul(pn.baris[j].qtyBase, pn.baris[j].hargaBase); qty += pn.baris[j].qtyBase; }
      rows2.push(h('tr', null,
        h('td', { class: 'sku', text: pn.id }),
        h('td', { class: 'bc', text: pn.tgl }),
        h('td', { class: 'sku', text: pn.poId }),
        h('td', { text: gudangNama(pn.gudangId) }),
        tdNum(pn.baris.length), tdNum(qty), tdRp(nilai)));
    }
    lst.appendChild(tableOf(['Penerimaan', 'Tanggal', 'PO', 'Gudang', { label: 'Baris', num: 1 }, { label: 'Qty dasar', num: 1 }, { label: 'Nilai', num: 1 }],
      rows2, { minWidth: '720px' }));
    p.appendChild(lst);
  }

  function postingPenerimaan(pilih, sisa) {
    var d = db();
    if (!bolehkah('beli.terima')) { renderPanel('penerimaan'); return; }
    var tgl = state.sel.terimaTgl;
    var baris = [], alasan = [];
    var izinLebih = !!(state.terimaDraft && state.terimaDraft.izinkanLebih) && state.peran === 'supervisor';
    for (var i = 0; i < pilih.po.baris.length; i++) {
      var b = pilih.po.baris[i];
      var q = state.terimaDraft.qty[b.sku] || 0;
      if (q <= 0) continue;
      var sisaB2 = Math.max(0, (sisa && sisa[b.sku] !== undefined) ? sisa[b.sku] : b.qtyBase);
      if (q > sisaB2 && !izinLebih) {
        alasan.push(b.sku + ': ' + pilih.po.id + ' memesan ' + D.angka(b.qtyBase) + ' unit dasar dan sisa yang belum diterima ' +
          D.angka(sisaB2) + '; penerimaan ' + D.angka(q) + ' melebihi sisa itu sebanyak ' + D.angka(q - sisaB2) +
          ' unit (' + D.rupiah(D.mul(q - sisaB2, b.hargaBase)) + '). Over-terima harus disahkan Supervisor dengan mencentang kotak di layar penerimaan.');
        continue;
      }
      var cek = L.periksaPosting(d.buku, {
        tgl: tgl, sku: b.sku, gudang: pilih.po.gudangId, arah: 1, qty: q, jenis: 'terima', harga: b.hargaBase
      }, { peran: state.peran, hariIni: d.hariIni });
      if (!cek.ok) alasan = alasan.concat(cek.alasan.map(function (a) { return b.sku + ': ' + a; }));
      else baris.push({ sku: b.sku, qtyBase: q, hargaBase: b.hargaBase });
    }
    if (!baris.length && !alasan.length) { tolak('Tidak ada yang diposting', ['Semua baris berkuantitas nol.']); renderPanel('penerimaan'); return; }
    if (alasan.length) { tolak('Penerimaan ditolak', alasan); renderPanel('penerimaan'); return; }
    var pn = { id: L.nomorDok(d.buku, 'PN'), poId: pilih.po.id, tgl: tgl, gudangId: pilih.po.gudangId, supplierId: pilih.po.supplierId, baris: [] };
    for (i = 0; i < baris.length; i++) {
      var e = L.tambah(d.buku, {
        tgl: tgl, sku: baris[i].sku, gudang: pn.gudangId, arah: 1, qty: baris[i].qtyBase,
        jenis: 'terima', dok: pn.id, harga: baris[i].hargaBase, catatan: 'atas ' + pilih.po.id
      });
      baris[i].entryId = e.id;
      pn.baris.push(baris[i]);
      simpanEntry(e);
    }
    d.penerimaan.push(pn);
    audit('beli.terima', { pn: pn.id, po: pilih.po.id, baris: pn.baris.length, tgl: tgl });
    invalidate();
    state.terimaDraft = null;
    state.sel.terimaPo = '';
    sukses('Penerimaan ' + pn.id + ' diposting',
      [pn.baris.length + ' baris masuk ke ' + gudangNama(pn.gudangId) + ' bertanggal ' + D.tglPanjang(tgl) +
        '. Setiap baris membuat lapisan biaya FIFO baru pada harga PO-nya.']);
    renderPanel('penerimaan');
  }

  /* ============================================================== TRANSFER */

  function renderTransfer(p) {
    var d = db(), H = hasil();
    if (!state.sel.trTgl) state.sel.trTgl = d.hariIni;

    var jalan = d.transfer.filter(function (x) { return x.status === 'jalan'; });

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Barang dalam perjalanan' }),
      h('p', { class: 'note' },
        'Barang yang sudah keluar dari gudang asal dan belum sampai di gudang tujuan bukan tidak ada ',
        'di mana-mana. Ia ada di lokasi bernama ', h('code', { text: 'TRANSIT' }),
        ', yang merupakan gudang kelas satu di buku besar. Karena itu pengiriman menulis dua entry ',
        '(keluar dari asal, masuk ke TRANSIT) dan kedatangan menulis dua lagi — nilainya dibawa, tidak ',
        'dihitung ulang di tujuan, dan stoknya terhitung tepat sekali sepanjang perjalanan.'));

    var rows = [];
    for (var i = 0; i < jalan.length; i++) {
      (function (tr) {
        var qty = 0, nilai = 0;
        for (var j = 0; j < tr.baris.length; j++) {
          qty += tr.baris[j].qtyBase;
          var hh = H.hasil[tr.baris[j].entryTransit];
          if (hh) nilai += hh.nilai;
        }
        var izin = D.izin(state.peran, 'transfer.terima');
        rows.push(h('tr', null,
          h('td', { class: 'sku', text: tr.id }),
          h('td', { class: 'bc', text: tr.tglKirim }),
          h('td', { text: gudangNama(tr.dariGudang) + ' → ' + gudangNama(tr.keGudang) }),
          tdNum(tr.baris.length), tdNum(qty), tdRp(nilai),
          h('td', null, h('button', {
            class: 'btn small' + (izin.ok ? ' primary' : ''), type: 'button', 'data-fkey': 'tr:terima:' + fkey(tr.id),
            title: izin.ok ? 'Catat kedatangan' : izin.alasan,
            onclick: function () { terimaTransfer(tr); }
          }, 'Terima di tujuan'))));
      })(jalan[i]);
    }
    if (!rows.length) card.appendChild(h('div', { class: 'empty', text: 'Tidak ada transfer dalam perjalanan.' }));
    else card.appendChild(tableOf(['Transfer', 'Dikirim', 'Rute', { label: 'Baris', num: 1 }, { label: 'Qty dasar', num: 1 }, { label: 'Nilai di jalan', num: 1 }, ''],
      rows, { minWidth: '840px' }));
    p.appendChild(card);
    renderPesan(p);

    // Kirim baru
    var kirim = h('div', { class: 'card' }, h('h3', { text: 'Kirim transfer baru' }));
    var izinK = D.izin(state.peran, 'transfer.kirim');
    if (!izinK.ok) kirim.appendChild(h('div', { class: 'tolak' }, h('b', { text: 'Peran saat ini tidak bisa mengirim transfer. ' }), izinK.alasan));
    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('Dari', select(d.gudang.map(function (g) { return { value: g.id, label: g.nama }; }),
      state.sel.trDari, function (v) { state.sel.trDari = v; state.trDraft = []; renderPanel('transfer'); }, { 'data-fkey': 'tr:dari' })));
    ctl.appendChild(field('Ke', select(d.gudang.map(function (g) { return { value: g.id, label: g.nama }; }),
      state.sel.trKe, function (v) { state.sel.trKe = v; renderPanel('transfer'); }, { 'data-fkey': 'tr:ke' })));
    var tglT = h('input', { type: 'date', value: state.sel.trTgl, min: '2026-03-01', max: d.hariIni, 'data-fkey': 'tr:tgl' });
    tglT.addEventListener('change', function () { state.sel.trTgl = tglT.value; renderPanel('transfer'); });
    ctl.appendChild(field('Tanggal kirim', tglT));

    var pilihSku = select([{ value: '', label: '— tambah SKU —' }].concat(
      d.produk.filter(function (x) { return (H.st[x.sku + '|' + state.sel.trDari] || { qty: 0 }).qty > 0; })
        .map(function (x) {
          var q = H.st[x.sku + '|' + state.sel.trDari].qty;
          return { value: x.sku, label: x.sku + ' — ' + x.nama + ' (' + D.angka(q) + ')' };
        })), '', function (v) {
          if (!v) return;
          var ada = false;
          for (var z = 0; z < state.trDraft.length; z++) if (state.trDraft[z].sku === v) ada = true;
          if (!ada) state.trDraft.push({ sku: v, qtyBase: Math.min((H.st[v + '|' + state.sel.trDari] || { qty: 0 }).qty, prod(v).satuan[0].faktor) });
          renderPanel('transfer');
        }, { 'data-fkey': 'tr:tambah' });
    ctl.appendChild(field('Tambah baris', pilihSku));
    kirim.appendChild(ctl);

    if (state.trDraft.length) {
      var rows2 = [];
      for (i = 0; i < state.trDraft.length; i++) {
        (function (b, idx) {
          var pr = prod(b.sku);
          var ada = (H.st[b.sku + '|' + state.sel.trDari] || { qty: 0 }).qty;
          rows2.push(h('tr', null,
            h('td', { class: 'sku', text: b.sku }),
            h('td', { class: 'wrap-normal', style: 'white-space:normal', text: pr.nama }),
            tdNum(ada),
            h('td', null, numInput(b.qtyBase, function (v) { b.qtyBase = Math.max(0, parseInt(v, 10) || 0); renderPanel('transfer'); },
              {
                'data-fkey': 'tr:qty:' + fkey(b.sku), min: 0, max: ada, step: 1,
                'aria-label': 'Kuantitas dikirim untuk ' + pr.nama + ', dalam ' + D.satuanBasis(pr).kode.toLowerCase()
              })),
            h('td', { class: 'bc', text: D.fmtPecah(pr, b.qtyBase) }),
            h('td', null, h('button', {
              class: 'btn small ghost', type: 'button', 'data-fkey': 'tr:hapus:' + fkey(b.sku),
              onclick: function () { state.trDraft.splice(idx, 1); renderPanel('transfer'); }
            }, 'Hapus'))));
        })(state.trDraft[i], i);
      }
      kirim.appendChild(tableOf(['SKU', 'Nama', { label: 'Tersedia', num: 1 }, { label: 'Kirim', num: 1 }, 'Pecahan', ''], rows2, { minWidth: '720px' }));
      kirim.appendChild(h('div', { style: 'margin-top:8px' },
        h('button', { class: 'btn primary', type: 'button', 'data-fkey': 'tr:kirim', onclick: kirimTransfer }, 'Kirim')));
    } else {
      kirim.appendChild(h('div', { class: 'empty', text: 'Belum ada baris. Tambahkan SKU dari gudang asal.' }));
    }
    p.appendChild(kirim);

    var riw = h('div', { class: 'card' }, h('h3', { text: 'Riwayat transfer' }));
    var rows3 = [];
    for (i = d.transfer.length - 1; i >= Math.max(0, d.transfer.length - 25); i--) {
      var tr2 = d.transfer[i];
      var q2 = 0;
      for (var j2 = 0; j2 < tr2.baris.length; j2++) q2 += tr2.baris[j2].qtyBase;
      rows3.push(h('tr', null,
        h('td', { class: 'sku', text: tr2.id }),
        h('td', { text: gudangNama(tr2.dariGudang) + ' → ' + gudangNama(tr2.keGudang) }),
        h('td', { class: 'bc', text: tr2.tglKirim }),
        h('td', { class: 'bc', text: tr2.tglTerima || '—' }),
        tdNum(tr2.baris.length), tdNum(q2),
        h('td', null, h('span', { class: 'pill ' + (tr2.status === 'tiba' ? 'ok' : 'warn'), text: tr2.status === 'tiba' ? 'Tiba' : 'Dalam perjalanan' }))));
    }
    riw.appendChild(tableOf(['Transfer', 'Rute', 'Kirim', 'Tiba', { label: 'Baris', num: 1 }, { label: 'Qty', num: 1 }, 'Status'], rows3, { minWidth: '760px' }));
    p.appendChild(riw);
  }

  function kirimTransfer() {
    var d = db();
    if (!bolehkah('transfer.kirim')) { renderPanel('transfer'); return; }
    if (state.sel.trDari === state.sel.trKe) { tolak('Transfer ditolak', ['Gudang asal dan tujuan sama.']); renderPanel('transfer'); return; }
    var alasan = [], baris = [];
    for (var i = 0; i < state.trDraft.length; i++) {
      var b = state.trDraft[i];
      if (b.qtyBase <= 0) continue;
      var cek = L.periksaPosting(d.buku, {
        tgl: state.sel.trTgl, sku: b.sku, gudang: state.sel.trDari, arah: -1, qty: b.qtyBase, jenis: 'transfer-keluar', harga: null
      }, { peran: state.peran, hariIni: d.hariIni });
      if (!cek.ok) alasan = alasan.concat(cek.alasan.map(function (a) { return b.sku + ': ' + a; }));
      else baris.push({ sku: b.sku, qtyBase: b.qtyBase });
    }
    if (alasan.length) { tolak('Transfer ditolak', alasan); renderPanel('transfer'); return; }
    if (!baris.length) { tolak('Transfer ditolak', ['Tidak ada baris berkuantitas positif.']); renderPanel('transfer'); return; }
    var tr = {
      id: L.nomorDok(d.buku, 'TR'), dariGudang: state.sel.trDari, keGudang: state.sel.trKe,
      tglKirim: state.sel.trTgl, tglTerima: null, status: 'draf', baris: baris
    };
    var es = P.kirimTransfer(d.buku, tr);
    for (i = 0; i < es.length; i++) simpanEntry(es[i]);
    d.transfer.push(tr);
    audit('transfer.kirim', { tr: tr.id, dari: tr.dariGudang, ke: tr.keGudang, baris: baris.length });
    invalidate();
    state.trDraft = [];
    sukses('Transfer ' + tr.id + ' dikirim',
      [baris.length + ' baris keluar dari ' + gudangNama(tr.dariGudang) + ' dan kini tercatat di TRANSIT. ' +
        'Nilainya tetap ada di neraca sampai tiba di ' + gudangNama(tr.keGudang) + '.']);
    renderPanel('transfer');
  }

  function terimaTransfer(tr) {
    var d = db();
    if (!bolehkah('transfer.terima')) { renderPanel('transfer'); return; }
    var alasan = [];
    for (var i = 0; i < tr.baris.length; i++) {
      var cek = L.periksaPosting(d.buku, {
        tgl: d.hariIni, sku: tr.baris[i].sku, gudang: D.TRANSIT, arah: -1, qty: tr.baris[i].qtyBase, jenis: 'transfer-keluar', harga: null
      }, { peran: state.peran, hariIni: d.hariIni });
      if (!cek.ok) alasan = alasan.concat(cek.alasan);
    }
    if (alasan.length) { tolak('Kedatangan ditolak', alasan); renderPanel('transfer'); return; }
    var es = P.terimaTransfer(d.buku, tr, d.hariIni);
    for (i = 0; i < es.length; i++) simpanEntry(es[i]);
    audit('transfer.terima', { tr: tr.id, tgl: d.hariIni });
    invalidate();
    sukses('Transfer ' + tr.id + ' tiba di ' + gudangNama(tr.keGudang),
      ['TRANSIT kembali kosong untuk baris-baris ini, dan biaya perolehan aslinya ikut pindah — bukan dihargai ulang.']);
    renderPanel('transfer');
  }

  /* ================================================================ OPNAME */

  function renderOpname(p) {
    var d = db();
    if (!state.sel.opnameId) state.sel.opnameId = d.opname[d.opname.length - 1].id;
    var op = null;
    for (var i = 0; i < d.opname.length; i++) if (d.opname[i].id === state.sel.opnameId) op = d.opname[i];

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Stock opname' }),
      h('p', { class: 'note' },
        'Lembar opname dibekukan pada saat dibuka — menurut ', h('b', { text: 'nomor urut buku besar' }),
        ', bukan menurut tanggal, karena dokumen yang di-backdate ke dalam masa penghitungan tetap ',
        'kejadian pasca-hitung bagi orang yang memegang papan jalan. Selisih dihitung terhadap buku beku ',
        'itu. Yang bergerak selagi orang berjalan di lorong dicatat di kolom tersendiri dan ',
        h('b', { text: 'tidak' }), ' ikut menjadi selisih. Posting menulis satu entry penyesuaian sebesar ',
        '(fisik − buku beku) — tidak pernah menimpa saldo.'));

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('Lembar', select(
      d.opname.map(function (o) { return { value: o.id, label: o.id + ' · ' + gudangNama(o.gudang) + ' · ' + o.tglMulai + ' · ' + o.status }; }),
      state.sel.opnameId, function (v) { state.sel.opnameId = v; renderPanel('opname'); }, { 'data-fkey': 'op:sheet' })));
    card.appendChild(ctl);

    if (!op) { card.appendChild(h('div', { class: 'empty', text: 'Lembar tidak ditemukan.' })); p.appendChild(card); return; }

    var v = P.variansOpname(d.buku, op);
    var terkunci = op.status === 'diposting';
    var rows = [];
    for (i = 0; i < v.baris.length; i++) {
      (function (b, idx) {
        var pr = prod(b.sku);
        var cls = b.varians === null ? '' : b.varians > 0 ? 'varians-lebih' : b.varians < 0 ? 'varians-kurang' : '';
        rows.push(h('tr', null,
          h('td', { class: 'sku', text: b.sku }),
          h('td', { class: 'wrap-normal', style: 'white-space:normal;min-width:170px', text: pr ? pr.nama : '' }),
          tdNum(b.bukuQty),
          h('td', { class: 'num' }, terkunci
            ? document.createTextNode(b.fisikQty === null ? '—' : D.angka(b.fisikQty))
            : numInput(b.fisikQty === null ? '' : b.fisikQty, function (val) {
              var n = val === '' ? null : parseInt(val, 10);
              op.baris[idx].fisikQty = (n === null || isNaN(n)) ? null : n;
              simpanOpname(op);
              renderPanel('opname');
            }, {
              'data-fkey': 'op:fisik:' + fkey(b.sku), min: 0, step: 1,
              'aria-label': 'Kuantitas fisik hasil hitung untuk ' + (pr ? pr.nama : b.sku)
            })),
          h('td', { class: 'num ' + cls, text: b.varians === null ? '—' : (b.varians > 0 ? '+' : '') + D.angka(b.varians) }),
          h('td', { class: 'bc', text: b.varians === null ? '' : D.fmtPecah(pr, b.varians) }),
          h('td', { class: 'num rp ' + (b.pascaHitung ? 'minus' : 'nol'), text: b.pascaHitung ? D.angka(b.pascaHitung) : '—' }),
          h('td', { class: 'num', text: b.saldoSetelahPosting === null ? '—' : D.angka(b.saldoSetelahPosting) }),
          h('td', null, terkunci || b.varians === 0 || b.varians === null
            ? document.createTextNode(D.alasanLabel(b.alasan))
            : select([{ value: '', label: '— pilih alasan —' }].concat(D.ALASAN_SELISIH.map(function (a) { return { value: a.kode, label: a.label }; })),
              b.alasan || '', function (val) { op.baris[idx].alasan = val || null; simpanOpname(op); renderPanel('opname'); },
              {
                'data-fkey': 'op:alasan:' + fkey(b.sku),
                'aria-label': 'Kode alasan selisih untuk ' + (pr ? pr.nama : b.sku)
              }))));
      })(v.baris[i], i);
    }
    card.appendChild(tableOf(['SKU', 'Nama', { label: 'Buku (beku)', num: 1 }, { label: 'Fisik', num: 1 },
      { label: 'Selisih', num: 1 }, 'Pecahan selisih', { label: 'Gerak pasca-hitung', num: 1 },
      { label: 'Saldo setelah posting', num: 1 }, 'Alasan'], rows, { minWidth: '1020px' }));

    card.appendChild(h('p', { class: 'hint' },
      v.ringkas.dihitung + ' dari ' + op.baris.length + ' baris sudah dihitung · ' +
      v.ringkas.selisih + ' berselisih (' + v.ringkas.lebih + ' lebih, ' + v.ringkas.kurang + ' kurang) · ' +
      'kelebihan ' + D.angka(v.ringkas.qtyLebih) + ' unit, kekurangan ' + D.angka(v.ringkas.qtyKurang) + ' unit.'));

    var izin = D.izin(state.peran, 'opname.posting');
    if (terkunci) {
      card.appendChild(h('div', { class: 'terima-ok' },
        h('b', { text: 'Lembar sudah diposting ' + (op.tglPosting ? D.tglPanjang(op.tglPosting) : '') + '. ' }),
        (op.entries ? op.entries.length : 0) + ' entry penyesuaian ditulis ke buku besar. Lembar opname tidak bisa diposting dua kali, dan angkanya tidak bisa disunting lagi — koreksinya adalah opname berikutnya.'));
    } else {
      card.appendChild(h('div', { style: 'margin-top:10px' },
        h('button', {
          class: 'btn primary', type: 'button', 'data-fkey': 'op:posting',
          title: izin.ok ? 'Posting penyesuaian' : izin.alasan,
          onclick: function () { postingOpname(op); }
        }, 'Posting penyesuaian')));
      if (!izin.ok) card.appendChild(h('div', { class: 'tolak' }, h('b', { text: 'Peran saat ini tidak bisa memposting. ' }), izin.alasan));
    }
    p.appendChild(card);
    renderPesan(p);

    if (op.entries && op.entries.length) {
      var H = hasil();
      var det = h('div', { class: 'card' }, h('h3', { text: 'Entry penyesuaian yang ditulis lembar ini' }));
      var rows2 = [];
      for (i = 0; i < op.entries.length; i++) {
        var e = null;
        for (var j = 0; j < d.buku.entries.length; j++) if (d.buku.entries[j].id === op.entries[i]) e = d.buku.entries[j];
        if (!e) continue;
        var hh = H.hasil[e.id];
        rows2.push(h('tr', null,
          h('td', { class: 'sku', text: e.id }),
          h('td', { class: 'bc', text: e.tgl }),
          h('td', { class: 'sku', text: e.sku }),
          h('td', null, h('span', { class: 'gerak adjust', text: e.arah > 0 ? 'Lebih' : 'Kurang' })),
          tdNum(e.qty),
          h('td', { text: D.alasanLabel(e.alasan) }),
          tdRp(hh ? hh.nilai : 0)));
      }
      det.appendChild(tableOf(['Entry', 'Tanggal', 'SKU', 'Arah', { label: 'Qty', num: 1 }, 'Alasan', { label: 'Nilai', num: 1 }],
        rows2, { minWidth: '700px' }));
      det.appendChild(h('p', { class: 'hint' },
        'Selisih kurang dinilai dengan memakan lapisan biaya seperti pengeluaran biasa; selisih lebih ',
        'dinilai pada biaya tercatat berjalan SKU itu di gudang itu — bukan pada harga jual, dan bukan nol. ',
        'Identitas nilai tetap tertutup setelahnya, dan tab Uji memeriksanya.'));
      p.appendChild(det);
    }
  }

  function postingOpname(op) {
    var d = db();
    if (!bolehTulis()) { renderPanel('opname'); return; }
    var res = P.postingOpname(d.buku, op, { peran: state.peran, tgl: op.tglMulai, oleh: state.peran, hariIni: d.hariIni });
    if (!res.ok) { tolak('Posting opname ditolak', res.alasan); renderPanel('opname'); return; }
    for (var i = 0; i < res.entries.length; i++) simpanEntry(res.entries[i]);
    simpanOpname(op);
    audit('opname.posting', { opname: op.id, entries: res.entries.length });
    invalidate();
    sukses('Opname ' + op.id + ' diposting',
      [res.entries.length + ' entry penyesuaian ditulis ke buku besar. Tidak ada saldo yang ditimpa: ' +
        'saldo baru adalah hasil lipatan buku, yaitu kuantitas fisik ditambah gerakan pasca-hitung.']);
    renderPanel('opname');
  }

  /* ================================================================= KASIR */

  function keranjangTotal() {
    return P.totalKeranjang(state.keranjang, { ppnInklusif: state.ppnInklusif });
  }

  function renderKasir(p) {
    var d = db(), H = hasil();
    var gud = state.sel.kasirGudang;

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Kasir' }),
      h('p', { class: 'note' },
        'Cari dengan barcode, SKU atau nama. Kuantitas boleh dimasukkan dalam satuan mana pun; yang ',
        'disimpan selalu satuan dasar. PPN 11% dihitung sekali per nota, bukan per baris, dan setelan ',
        h('b', { text: state.ppnInklusif ? 'inklusif (harga di rak sudah termasuk PPN)' : 'eksklusif (PPN ditambahkan di atas harga)' }),
        ' di bilah konteks benar-benar mengubah angkanya — bukan sekadar label.'));

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('Gudang / kasir', select(
      S.GUDANG_JUAL.map(function (g) { return { value: g, label: gudangNama(g) }; }),
      gud, function (v) { state.sel.kasirGudang = v; state.keranjang = []; renderPanel('kasir'); }, { 'data-fkey': 'ks:gudang' })));
    /* ONE hit list, computed once, sorted once, used by both the chips and the
     * Enter key. Sorting a copy for display and re-running the search inside the
     * keydown handler is how Enter came to ring up a different product from the
     * one shown first — an out-of-stock SKU, at that, because master order puts
     * it there. */
    var hits = cariProduk(state.sel.kasirCari);
    /* In-stock first. A cashier scanning a shelf label wants the thing they can
     * actually sell at the top; an out-of-stock SKU still appears, marked habis,
     * because pretending it does not exist is worse than saying no. */
    hits.sort(function (a, b) {
      var qa = (H.st[a.sku + '|' + gud] || { qty: 0 }).qty;
      var qb = (H.st[b.sku + '|' + gud] || { qty: 0 }).qty;
      if ((qa > 0) !== (qb > 0)) return qa > 0 ? -1 : 1;
      return 0;
    });

    var cari = h('input', {
      class: 'cari', type: 'search', placeholder: 'Scan barcode, atau ketik SKU / nama lalu tekan Enter',
      value: state.sel.kasirCari, 'data-fkey': 'ks:cari',
      'aria-label': 'Cari produk untuk keranjang — scan barcode, atau ketik SKU atau nama lalu tekan Enter untuk mengambil hasil pertama'
    });
    cari.addEventListener('input', function () { state.sel.kasirCari = cari.value; lupakanPesan(); renderPanel('kasir'); });
    cari.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      if (hits.length) tambahKeranjang(hits[0].sku);
    });
    ctl.appendChild(field('Cari produk', cari, 'field-cari'));
    card.appendChild(ctl);

    if (state.sel.kasirCari) {
      var chips = h('div', { class: 'chips' });
      for (var i = 0; i < Math.min(hits.length, 8); i++) {
        (function (pr, pertama) {
          var q = (H.st[pr.sku + '|' + gud] || { qty: 0 }).qty;
          chips.appendChild(h('button', {
            /* The chip Enter will pick is marked, so what the cashier sees and
             * what the key does cannot drift apart again. */
            class: 'chip' + (pertama ? ' pilihan' : ''), type: 'button', 'data-fkey': 'ks:hit:' + fkey(pr.sku),
            'aria-selected': pertama ? 'true' : 'false',
            title: (pertama ? 'Enter mengambil ini. ' : '') + (q > 0 ? D.fmtPecah(pr, q) + ' tersedia di ' + gudangNama(gud) : 'Habis di ' + gudangNama(gud)),
            onclick: function () { tambahKeranjang(pr.sku); }
          }, (pertama ? '⏎ ' : '') + pr.sku + ' · ' + pr.nama + ' · ' + (q > 0 ? D.angka(q) + ' tersedia' : 'habis')));
        })(hits[i], i === 0);
      }
      if (!hits.length) chips.appendChild(h('span', { class: 'hint', text: 'Tidak ada yang cocok.' }));
      card.appendChild(chips);
    }

    var grid = h('div', { class: 'kasir-grid' });
    var kiri = h('div');
    var rows = [];
    for (i = 0; i < state.keranjang.length; i++) {
      (function (b, idx) {
        var pr = prod(b.sku);
        var ada = (H.st[b.sku + '|' + gud] || { qty: 0 }).qty;
        var satuanOpt = pr.satuan.map(function (s) { return { value: s.kode, label: s.kode.toLowerCase() }; });
        rows.push(h('tr', null,
          h('td', { class: 'sku', text: b.sku }),
          h('td', { class: 'wrap-normal', style: 'white-space:normal;min-width:150px', text: pr.nama }),
          h('td', null, numInput(b.qtySatuan, function (v) {
            b.qtySatuan = Math.max(1, parseInt(v, 10) || 1);
            b.qty = D.toBase(pr, b.qtySatuan, b.satuan);
            lupakanPesan();
            renderPanel('kasir');
          }, {
            'data-fkey': 'ks:qty:' + fkey(b.sku), min: 1, step: 1, style: 'width:66px',
            'aria-label': 'Kuantitas ' + pr.nama
          })),
          h('td', null, select(satuanOpt, b.satuan, function (v) {
            b.satuan = v;
            b.qty = D.toBase(pr, b.qtySatuan, v);
            renderPanel('kasir');
          }, { 'data-fkey': 'ks:sat:' + fkey(b.sku), 'aria-label': 'Satuan untuk ' + pr.nama })),
          h('td', { class: 'num bc', text: D.angka(b.qty) }),
          tdRp(b.harga),
          h('td', { class: 'num rp' + (b.qty > ada ? ' minus' : ''), text: D.angka(ada) }),
          tdRp(P.jumlahBaris(b)),
          h('td', null, h('button', {
            class: 'btn small ghost', type: 'button', 'data-fkey': 'ks:hapus:' + fkey(b.sku),
            onclick: function () { state.keranjang.splice(idx, 1); lupakanPesan(); renderPanel('kasir'); }
          }, 'Hapus'))));
      })(state.keranjang[i], i);
    }
    if (!rows.length) kiri.appendChild(h('div', { class: 'empty', text: 'Keranjang kosong. Cari produk di atas.' }));
    else kiri.appendChild(tableOf(['SKU', 'Nama', { label: 'Qty', num: 1 }, 'Satuan', { label: 'Unit dasar', num: 1 },
      { label: 'Harga/unit', num: 1 }, { label: 'Stok', num: 1 }, { label: 'Jumlah', num: 1 }, ''], rows, { minWidth: '820px' }));
    grid.appendChild(kiri);

    var tot = keranjangTotal();
    var kanan = h('div', { class: 'total-blok' },
      h('div', { class: 'baris' }, h('span', { text: 'Subtotal' }), h('span', { class: 'rp', text: D.rupiah(tot.subtotal) })),
      h('div', { class: 'baris' }, h('span', { text: 'DPP' }), h('span', { class: 'rp', text: D.rupiah(tot.dpp) })),
      h('div', { class: 'baris' }, h('span', { text: 'PPN 11% (' + (state.ppnInklusif ? 'inklusif' : 'eksklusif') + ')' }), h('span', { class: 'rp', text: D.rupiah(tot.ppn) })),
      h('div', { style: 'margin:8px 0 2px', class: 'hint', text: 'Total yang harus dibayar' }),
      h('div', { class: 'besar', text: D.rupiah(tot.total) }));

    ['tunai', 'transfer', 'qris'].forEach(function (j) {
      kanan.appendChild(h('div', { class: 'bayar-baris' },
        h('span', { text: j === 'qris' ? 'QRIS' : j.charAt(0).toUpperCase() + j.slice(1) }),
        numInput(state.bayar[j], function (v) { state.bayar[j] = Math.max(0, parseInt(v, 10) || 0); lupakanPesan(); renderPanel('kasir'); },
          {
            'data-fkey': 'ks:bayar:' + j, min: 0, step: 1000, style: 'width:100%',
            'aria-label': 'Nominal pembayaran ' + (j === 'qris' ? 'QRIS' : j) + ' dalam rupiah'
          }),
        h('button', {
          class: 'btn small ghost', type: 'button', 'data-fkey': 'ks:pas:' + j,
          /* WCAG 2.5.3: the visible word must be INSIDE the accessible name, or a
           * speech-input user saying "click Pas" hits nothing. */
          'aria-label': 'Pas — isi ' + (j === 'qris' ? 'QRIS' : j) + ' sebesar total nota',
          onclick: function () {
            state.bayar = { tunai: 0, transfer: 0, qris: 0 };
            state.bayar[j] = tot.total;
            lupakanPesan();
            renderPanel('kasir');
          }
        }, 'Pas')));
    });

    var bayarList = [
      { jenis: 'tunai', jumlah: state.bayar.tunai },
      { jenis: 'transfer', jumlah: state.bayar.transfer },
      { jenis: 'qris', jumlah: state.bayar.qris }
    ].filter(function (x) { return x.jumlah > 0; });
    var bay = P.hitungBayar(tot.total, bayarList);
    kanan.appendChild(h('div', { class: 'baris', style: 'margin-top:6px' },
      h('span', { text: 'Dibayar' }), h('span', { class: 'rp', text: D.rupiah(bay.dibayar) })));
    kanan.appendChild(h('div', { class: 'baris' },
      h('span', { text: bay.ok ? 'Kembalian' : 'Kurang' }),
      h('span', { class: 'rp ' + (bay.ok ? 'plus' : 'minus'), text: D.rupiah(bay.ok ? bay.kembali : bay.kurang) })));
    if (!bay.ok && bayarList.length) kanan.appendChild(h('div', { class: 'tolak', text: bay.alasan }));
    kanan.appendChild(h('div', { style: 'margin-top:10px' },
      h('button', {
        class: 'btn primary', type: 'button', 'data-fkey': 'ks:bayar',
        onclick: function () { tutupNota(bayarList, tot, bay); }
      }, 'Tutup transaksi')));
    grid.appendChild(kanan);
    card.appendChild(grid);
    p.appendChild(card);
    renderPesan(p);

    if (state.struk) p.appendChild(renderStruk(state.struk));

    // Retur penjualan
    var ret = h('div', { class: 'card' },
      h('h3', { text: 'Retur penjualan' }),
      h('p', { class: 'note' },
        'Retur mengembalikan stok ', h('b', { text: 'pada lapisan biaya aslinya' }),
        ' — bukan pada biaya hari ini. Karena entry retur menunjuk dokumen penjualannya dan bukan sebuah ',
        'angka beku, pembelian bertanggal mundur yang mengubah HPP nota itu juga mengubah nilai returnya. ',
        'Mengembalikan barang pada harga hari ini akan membukukan laba atau rugi atas transaksi yang justru dibatalkan.'));
    var notaTerakhir = d.kasir.slice(Math.max(0, d.kasir.length - 40)).reverse();
    ret.appendChild(field('Nota', select(
      [{ value: '', label: '— pilih nota —' }].concat(notaTerakhir.map(function (n) {
        return { value: n.id, label: n.id + ' · ' + n.tgl + ' · ' + gudangNama(n.gudang) + ' · ' + D.rupiah(n.total) };
      })), state.sel.returNota, function (v) { state.sel.returNota = v; renderPanel('kasir'); }, { 'data-fkey': 'ks:retur' })));
    var nota = null;
    for (i = 0; i < d.kasir.length; i++) if (d.kasir[i].id === state.sel.returNota) nota = d.kasir[i];
    if (nota) {
      if (!state.returDraft || state.returDraft.notaId !== nota.id) state.returDraft = { notaId: nota.id, qty: {} };
      var rows3 = [], adaSisa = false;
      for (i = 0; i < nota.baris.length; i++) {
        (function (b) {
          var pr = prod(b.sku);
          var hh = H.hasil[b.entryId];
          /* Cumulative, from the ledger. The input caps at what is LEFT, and the
           * posting refuses anything above it — a per-posting cap alone let the
           * same line be returned in full over and over. */
          var sudah = sudahDiretur(b.entryId);
          var sisaR = Math.max(0, b.qty - sudah);
          if (sisaR > 0) adaSisa = true;
          if ((state.returDraft.qty[b.sku] || 0) > sisaR) state.returDraft.qty[b.sku] = sisaR;
          rows3.push(h('tr', null,
            h('td', { class: 'sku', text: b.sku }),
            h('td', { class: 'wrap-normal', style: 'white-space:normal', text: pr.nama }),
            tdNum(b.qty), tdRp(b.harga), tdRp(D.mul(b.qty, b.harga)),
            tdRp(hh ? hh.nilai : 0),
            h('td', { class: 'num' + (sudah ? ' rp minus' : ''), text: D.angka(sudah) }),
            h('td', { class: 'num', text: D.angka(sisaR) }),
            h('td', null, sisaR === 0
              ? h('span', { class: 'pill warn', text: 'sudah diretur penuh' })
              : numInput(state.returDraft.qty[b.sku] || 0, function (v) {
                state.returDraft.qty[b.sku] = Math.min(sisaR, Math.max(0, parseInt(v, 10) || 0));
                lupakanPesan();
                renderPanel('kasir');
              }, {
                'data-fkey': 'ks:returqty:' + fkey(b.sku), min: 0, max: sisaR, step: 1,
                'aria-label': 'Kuantitas diretur untuk ' + pr.nama + ', maksimum ' + sisaR + ' unit dasar yang belum diretur'
              }))));
        })(nota.baris[i]);
      }
      ret.appendChild(tableOf(['SKU', 'Nama', { label: 'Qty jual', num: 1 }, { label: 'Harga', num: 1 },
        { label: 'Nilai jual', num: 1 }, { label: 'HPP nota', num: 1 }, { label: 'Sudah diretur', num: 1 },
        { label: 'Sisa boleh retur', num: 1 }, { label: 'Retur', num: 1 }], rows3, { minWidth: '960px' }));
      if (!adaSisa) ret.appendChild(h('div', { class: 'callout warn', text: 'Seluruh baris nota ini sudah diretur penuh. Batas retur bersifat kumulatif: dihitung dari entry retur yang sudah ada di buku besar, bukan per posting.' }));
      ret.appendChild(h('div', { style: 'margin-top:8px' },
        h('button', { class: 'btn primary', type: 'button', 'data-fkey': 'ks:returposting', onclick: function () { postingRetur(nota); } }, 'Posting retur')));
    }
    p.appendChild(ret);
  }

  function cariProduk(q) {
    var d = db(), s = String(q).toLowerCase().trim(), out = [];
    if (!s) return out;
    if (d.barcodeIndex[s]) return [prod(d.barcodeIndex[s])];
    for (var i = 0; i < d.produk.length; i++) {
      var pr = d.produk[i];
      if ((pr.sku + ' ' + pr.nama + ' ' + pr.barcode).toLowerCase().indexOf(s) >= 0) out.push(pr);
      if (out.length >= 30) break;
    }
    return out;
  }

  /* Stock is checked at SCAN time, not only when the nota is closed. Adding a
   * zero-stock line with a cheerful "ditambahkan." and refusing the whole basket
   * at the payment step is the wrong place to say no: 99 of 120 SKU are out of
   * stock at the shop till, so the cashier meets this constantly. The line is
   * still added — the close-time check in L.periksaPosting remains the backstop —
   * but the announcement says what the screen shows. */
  function stokTersedia(sku) {
    var st = hasil().st[sku + '|' + state.sel.kasirGudang];
    return st ? st.qty : 0;
  }

  function tambahKeranjang(sku) {
    var pr = prod(sku);
    var ada = stokTersedia(sku);
    var lokasi = gudangNama(state.sel.kasirGudang);
    lupakanPesan();
    for (var i = 0; i < state.keranjang.length; i++) {
      if (state.keranjang[i].sku !== sku) continue;
      state.keranjang[i].qtySatuan++;
      state.keranjang[i].qty = D.toBase(pr, state.keranjang[i].qtySatuan, state.keranjang[i].satuan);
      state.sel.kasirCari = '';
      var q2 = state.keranjang[i].qty;
      say(pr.nama + ' menjadi ' + state.keranjang[i].qtySatuan + ' ' + state.keranjang[i].satuan.toLowerCase() +
        (q2 > ada ? '. Stok di ' + lokasi + ' hanya ' + D.angka(ada) + ' — baris ini akan ditolak saat nota ditutup.' : ''));
      renderPanel('kasir');
      return;
    }
    var basis = D.satuanBasis(pr).kode;
    state.keranjang.push({ sku: sku, satuan: basis, qtySatuan: 1, qty: 1, harga: pr.hargaJual, diskon: 0 });
    state.sel.kasirCari = '';
    if (ada <= 0) {
      tolak('Habis di ' + lokasi, [pr.nama + ' (' + sku + ') tidak bersaldo di ' + lokasi +
        '. Barisnya tetap ditambahkan supaya terlihat, tetapi nota tidak akan bisa ditutup selama baris ini ada: ' +
        'stok tidak boleh negatif. Hapus barisnya, atau pindah gudang.']);
    } else {
      say(pr.nama + ' ditambahkan. Stok ' + lokasi + ': ' + D.angka(ada) + '.');
    }
    renderPanel('kasir');
  }

  function tutupNota(bayarList, tot, bay) {
    var d = db();
    if (!bolehkah('pos.jual')) { renderPanel('kasir'); return; }
    if (!state.keranjang.length) { tolak('Tidak ada yang dijual', ['Keranjang kosong.']); renderPanel('kasir'); return; }
    if (!bay.ok) { tolak('Pembayaran belum sah', [bay.alasan]); renderPanel('kasir'); return; }
    var gud = state.sel.kasirGudang, alasan = [];
    for (var i = 0; i < state.keranjang.length; i++) {
      var b = state.keranjang[i];
      var cek = L.periksaPosting(d.buku, {
        tgl: d.hariIni, sku: b.sku, gudang: gud, arah: -1, qty: b.qty, jenis: 'jual', harga: null
      }, { peran: state.peran, hariIni: d.hariIni });
      if (!cek.ok) alasan = alasan.concat(cek.alasan.map(function (a) { return b.sku + ': ' + a; }));
    }
    if (alasan.length) { tolak('Transaksi ditolak', alasan); renderPanel('kasir'); return; }

    var nota = {
      id: L.nomorDok(d.buku, 'KS'), tgl: d.hariIni, gudang: gud, kasir: 'KSR-01',
      pelangganId: 'PLG-000', baris: [], bayar: bayarList.slice(), ppnInklusif: state.ppnInklusif,
      total: tot.total, dpp: tot.dpp, ppn: tot.ppn, subtotal: tot.subtotal, kembali: bay.kembali
    };
    for (i = 0; i < state.keranjang.length; i++) {
      var b2 = state.keranjang[i];
      /* The DPP share of this line, allocated from the nota's ONE rounded DPP
       * (P.totalKeranjang / D.alokasi). The entry has to carry it: PPN is a
       * document-level figure, and a report that subtracts cost from revenue
       * needs both sides on the same tax base. */
      var dppBaris = (tot.baris[i] && D.isInt(tot.baris[i].dpp)) ? tot.baris[i].dpp : null;
      var e = L.tambah(d.buku, {
        tgl: d.hariIni, sku: b2.sku, gudang: gud, arah: -1, qty: b2.qty,
        jenis: 'jual', dok: nota.id, nilaiJual: P.jumlahBaris(b2), nilaiDpp: dppBaris
      });
      simpanEntry(e);
      nota.baris.push({
        sku: b2.sku, satuan: b2.satuan, qtySatuan: b2.qtySatuan, qty: b2.qty,
        harga: b2.harga, diskon: 0, entryId: e.id, nilaiDpp: dppBaris
      });
    }
    d.kasir.push(nota);
    audit('pos.jual', { nota: nota.id, baris: nota.baris.length, total: nota.total });
    invalidate();
    state.keranjang = [];
    state.bayar = { tunai: 0, transfer: 0, qris: 0 };
    state.struk = nota;
    /* The next thing that happens is another scan. */
    state.fokusKe = 'ks:cari';
    sukses('Nota ' + nota.id + ' ditutup', ['Total ' + D.rupiah(nota.total) + ', kembalian ' + D.rupiah(nota.kembali) + '.']);
    renderPanel('kasir');
  }

  /* How much of one sale line has already come back. Counted from the LEDGER, not
   * from a flag on the nota: the ledger is the only record that survives a reload,
   * and it is the record the costing engine reads. */
  function sudahDiretur(entryId) {
    var d = db(), n = 0;
    if (!entryId) return 0;
    for (var i = 0; i < d.buku.entries.length; i++) {
      var e = d.buku.entries[i];
      if (e.jenis === 'retur-jual' && e.ref === entryId) n += e.qty;
    }
    return n;
  }

  function postingRetur(nota) {
    var d = db();
    if (!bolehkah('pos.retur')) { renderPanel('kasir'); return; }
    var baris = [], alasan = [];
    for (var i = 0; i < nota.baris.length; i++) {
      var b = nota.baris[i];
      var q = (state.returDraft.qty[b.sku] || 0);
      if (q <= 0) continue;
      /* The per-posting clamp on the input is not a control: nothing stopped the
       * same nota being returned in full a second, third or hundredth time,
       * creating stock and rupiah out of nothing. The limit is cumulative and it
       * is checked here, at posting time. */
      var sudah = sudahDiretur(b.entryId);
      var sisaR = b.qty - sudah;
      if (q > sisaR) {
        alasan.push(b.sku + ': nota ' + nota.id + ' menjual ' + D.angka(b.qty) + ' unit dasar dan ' +
          D.angka(sudah) + ' sudah diretur sebelumnya, jadi sisa yang boleh diretur ' + D.angka(sisaR) +
          ' — bukan ' + D.angka(q) + '. Meretur lebih dari yang dijual akan menciptakan stok dan nilai dari udara.');
        continue;
      }
      /* Retur was the only posting path in this file with no periksaPosting call
       * at all, so a closed period or a non-integer quantity did not stop it. */
      var cek = L.periksaPosting(d.buku, {
        tgl: d.hariIni, sku: b.sku, gudang: nota.gudang, arah: 1, qty: q, jenis: 'retur-jual', harga: null
      }, { peran: state.peran, hariIni: d.hariIni });
      if (!cek.ok) { alasan = alasan.concat(cek.alasan.map(function (a) { return b.sku + ': ' + a; })); continue; }
      baris.push({
        sku: b.sku, qtyBase: q, refEntry: b.entryId, nilaiJual: D.mul(q, b.harga),
        nilaiDpp: D.isInt(b.nilaiDpp) ? D.divRound(D.mul(b.nilaiDpp, q), b.qty) : null
      });
    }
    if (alasan.length) { tolak('Retur ditolak', alasan); renderPanel('kasir'); return; }
    if (!baris.length) { tolak('Retur ditolak', ['Tidak ada baris dengan kuantitas retur.']); renderPanel('kasir'); return; }
    var rj = { id: L.nomorDok(d.buku, 'RJ'), tgl: d.hariIni, notaId: nota.id, gudang: nota.gudang, baris: baris };
    var es = P.returPenjualan(d.buku, { id: nota.id, gudang: nota.gudang }, baris, d.hariIni, rj.id);
    for (i = 0; i < es.length; i++) simpanEntry(es[i]);
    rj.entries = es.map(function (x) { return x.id; });
    d.returJual.push(rj);
    audit('pos.retur', { rj: rj.id, nota: nota.id, baris: baris.length });
    invalidate();
    var H = hasil();
    var nilai = 0;
    for (i = 0; i < es.length; i++) nilai += H.hasil[es[i].id].nilai;
    state.returDraft = null;
    state.fokusKe = 'ks:cari';
    sukses('Retur ' + rj.id + ' diposting',
      ['Stok kembali senilai ' + D.rupiah(nilai) + ' — pada biaya lapisan aslinya, bukan pada biaya hari ini. ' +
        'Sisa yang masih boleh diretur atas nota ini berkurang sebanyak yang baru diposting.']);
    renderPanel('kasir');
  }

  function renderStruk(nota) {
    var d = db();
    var wrap = h('div', { class: 'card struk-wrap' },
      h('h3', { class: 'no-print', text: 'Struk' }),
      h('p', { class: 'note no-print' }, 'Ini yang tercetak. Tekan tombol cetak dan hanya struk yang keluar; sisa halaman disembunyikan oleh aturan cetak di ', h('code', { text: 'app.css' }), '.'));
    var s = h('div', { class: 'struk' },
      h('h4', { text: 'GUDANG — DEMO FABRIKASI' }),
      h('div', { class: 'kecil', style: 'text-align:center', text: gudangNama(nota.gudang) + ' · ' + nota.kasir }),
      h('div', { class: 'pisah' }),
      h('div', { class: 'b' }, h('span', { text: nota.id }), h('span', { text: D.tglPanjang(nota.tgl) })));
    for (var i = 0; i < nota.baris.length; i++) {
      var b = nota.baris[i];
      var pr = prod(b.sku);
      s.appendChild(h('div', { style: 'margin-top:5px' },
        h('div', { class: 'kecil', text: pr.nama }),
        h('div', { class: 'b' },
          h('span', { text: D.angka(b.qtySatuan) + ' ' + b.satuan.toLowerCase() + ' x ' + D.rupiah(b.harga) }),
          h('span', { text: D.rupiah(D.mul(b.qty, b.harga)) }))));
    }
    s.appendChild(h('div', { class: 'pisah' }));
    s.appendChild(h('div', { class: 'b' }, h('span', { text: 'Subtotal' }), h('span', { text: D.rupiah(nota.subtotal) })));
    s.appendChild(h('div', { class: 'b' }, h('span', { text: 'DPP' }), h('span', { text: D.rupiah(nota.dpp) })));
    s.appendChild(h('div', { class: 'b' }, h('span', { text: 'PPN 11%' }), h('span', { text: D.rupiah(nota.ppn) })));
    s.appendChild(h('div', { class: 'b', style: 'font-weight:700' }, h('span', { text: 'TOTAL' }), h('span', { text: D.rupiah(nota.total) })));
    for (i = 0; i < nota.bayar.length; i++) {
      s.appendChild(h('div', { class: 'b' },
        h('span', { text: nota.bayar[i].jenis === 'qris' ? 'QRIS' : nota.bayar[i].jenis }),
        h('span', { text: D.rupiah(nota.bayar[i].jumlah) })));
    }
    s.appendChild(h('div', { class: 'b' }, h('span', { text: 'Kembali' }), h('span', { text: D.rupiah(nota.kembali) })));
    s.appendChild(h('div', { class: 'pisah' }));
    s.appendChild(h('div', { class: 'kecil', style: 'text-align:center' },
      nota.ppnInklusif ? 'Harga sudah termasuk PPN 11%.' : 'Harga belum termasuk PPN 11%.'));
    s.appendChild(h('div', { class: 'kecil', style: 'text-align:center', text: 'Data fabrikasi — bukan bukti transaksi yang sah.' }));
    wrap.appendChild(s);
    wrap.appendChild(h('div', { class: 'no-print', style: 'margin-top:10px; display:flex; gap:8px' },
      h('button', { class: 'btn', type: 'button', 'data-fkey': 'ks:cetak', onclick: function () { window.print(); } }, 'Cetak struk'),
      h('button', { class: 'btn ghost', type: 'button', 'data-fkey': 'ks:tutupstruk', onclick: function () { state.struk = null; renderPanel('kasir'); } }, 'Tutup')));
    return wrap;
  }

  /* =============================================================== LAPORAN */

  function renderLaporan(p) {
    var d = db(), H = hasil(), hf = hasil('fifo'), hr = hasil('rata');
    var pos = L.posisi(H);

    var perGudang = {}, i;
    for (i = 0; i < pos.length; i++) {
      var g = pos[i].gudang;
      if (!perGudang[g]) perGudang[g] = { qty: 0, nilai: 0, sku: 0 };
      perGudang[g].qty += pos[i].qty;
      perGudang[g].nilai += pos[i].nilai;
      if (pos[i].qty > 0) perGudang[g].sku++;
    }

    var card = h('div', { class: 'card' },
      h('h3', { text: 'Posisi persediaan per lokasi' }),
      h('p', { class: 'note' },
        'TRANSIT muncul sebagai lokasi tersendiri, bukan disembunyikan atau dilebur ke gudang tujuan. ',
        'Barang yang ada di truk tetap milik perusahaan dan tetap ada nilainya di neraca; ',
        'menyembunyikannya adalah cara paling umum sebuah laporan persediaan salah.'));
    var rows = [];
    var totalNilai = 0, totalQty = 0;
    var urut = d.gudang.map(function (x) { return x.id; }).concat([D.TRANSIT]);
    for (i = 0; i < urut.length; i++) {
      var gg = perGudang[urut[i]] || { qty: 0, nilai: 0, sku: 0 };
      totalNilai += gg.nilai; totalQty += gg.qty;
      rows.push(h('tr', null,
        h('td', { text: gudangNama(urut[i]) }),
        h('td', { class: 'bc', text: urut[i] }),
        tdNum(gg.sku), tdNum(gg.qty), tdRp(gg.nilai)));
    }
    rows.push(h('tr', { style: 'font-weight:600' },
      h('td', { text: 'Total' }), h('td'), h('td'), tdNum(totalQty), tdRp(totalNilai)));
    card.appendChild(tableOf(['Lokasi', 'Kode', { label: 'SKU bersaldo', num: 1 }, { label: 'Qty dasar', num: 1 }, { label: 'Nilai', num: 1 }],
      rows, { minWidth: '620px' }));
    card.appendChild(h('p', { class: 'hint', text: 'Total ini sama dengan nilai persediaan akhir pada rekonsiliasi di Beranda: ' + D.rupiah(H.akhir.nilai) + '.' }));
    p.appendChild(card);
    renderPesan(p);

    // Mutasi per periode
    /* Both sides of the margin have to be on the same tax base and both sides
     * have to be net of returns. Revenue is the DPP the entry carries (never the
     * PPN-inclusive nilaiJual) and a retur penjualan subtracts from revenue AND
     * from cost, because a cancelled sale is not profit. */
    var mut = {}, s = sortedEntries();
    for (i = 0; i < s.length; i++) {
      var e = s[i], per = D.periodeOf(e.tgl), hh = H.hasil[e.id];
      if (!mut[per]) mut[per] = { masuk: 0, keluar: 0, hpp: 0, jual: 0, bruto: 0, beli: 0, adj: 0 };
      if (!hh) continue;
      if (e.arah > 0) mut[per].masuk += hh.nilai; else mut[per].keluar += hh.nilai;
      if (e.jenis === 'jual') {
        mut[per].hpp += hh.nilai;
        mut[per].jual += L.dppEntry(e);
        mut[per].bruto += (e.nilaiJual || 0);
      }
      if (e.jenis === 'retur-jual') {
        mut[per].hpp -= hh.nilai;
        mut[per].jual -= L.dppEntry(e);
        mut[per].bruto -= (e.nilaiJual || 0);
      }
      if (e.jenis === 'terima') mut[per].beli += hh.nilai;
      if (e.jenis === 'adjust') mut[per].adj += e.arah * hh.nilai;
    }
    var perList = Object.keys(mut).sort();
    var rows2 = [], saldo = 0;
    for (i = 0; i < perList.length; i++) {
      var m = mut[perList[i]];
      var awal = saldo;
      saldo = saldo + m.masuk - m.keluar;
      var laba = m.jual - m.hpp;
      rows2.push(h('tr', null,
        h('td', { text: D.periodeLabel(perList[i]) }),
        tdRp(awal), tdRp(m.beli), tdRp(m.hpp), tdRp(m.adj),
        tdRp(saldo),
        tdRp(m.bruto),
        tdRp(m.jual),
        h('td', { class: 'num rp ' + (laba > 0 ? 'plus' : 'minus'), text: D.rupiah(laba) }),
        h('td', { class: 'num', text: m.jual ? L.marginTeks(D.divRound(D.mul(laba, 10000), m.jual)) : '—' })));
    }
    var mutCard = h('div', { class: 'card' },
      h('h3', { text: 'Mutasi dan laba kotor per bulan' }),
      h('p', { class: 'note' },
        'Saldo awal setiap bulan adalah saldo akhir bulan sebelumnya, dihitung dari buku yang sama — ',
        'bukan angka yang disalin. Metode ', h('b', { text: state.metode === 'fifo' ? 'FIFO' : 'rata-rata' }),
        '; ganti metode di bilah konteks dan kolom HPP serta laba kotornya akan bergeser.'));
    mutCard.appendChild(tableOf(['Periode', { label: 'Persediaan awal', num: 1 }, { label: 'Pembelian', num: 1 },
      { label: 'HPP neto retur', num: 1 }, { label: 'Penyesuaian', num: 1 }, { label: 'Persediaan akhir', num: 1 },
      { label: 'Penjualan bruto', num: 1 }, { label: 'Penjualan DPP', num: 1 }, { label: 'Laba kotor', num: 1 }, { label: 'Margin', num: 1 }],
      rows2, { minWidth: '1080px' }));
    var lkT = L.labaKotor(H);
    mutCard.appendChild(h('p', { class: 'hint' },
      'Laba kotor di sini adalah ', h('b', { text: 'penjualan DPP − HPP' }), ', keduanya neto retur. ',
      'Kolom bruto berisi PPN keluaran ', h('b', { text: D.rupiah(lkT.ppnKeluaran) }),
      ' yang bukan pendapatan: menguranginya dengan HPP yang tidak pernah memuat PPN akan melaporkan ',
      'laba kotor ', h('b', { text: D.rupiah(lkT.penjualanBruto - lkT.hpp) }), ' padahal yang benar ',
      h('b', { text: D.rupiah(lkT.laba) }), ' (' + L.marginTeks(lkT.marginBp) + '). ',
      'Retur penjualan (', D.rupiah(lkT.penjualanBruto === 0 ? 0 : H.total.returJualBruto),
      ' nilai jual, ', D.rupiah(H.total.returJual), ' biaya) dikeluarkan dari kedua sisi.'));
    var tutupList = Object.keys(d.buku.tutup).sort().map(D.periodeLabel);
    mutCard.appendChild(h('p', { class: 'hint', text: 'Periode tertutup: ' + (tutupList.length ? tutupList.join(', ') : 'tidak ada') + '. Dokumen bertanggal di dalamnya tidak bisa diposting sampai supervisor membukanya.' }));
    p.appendChild(mutCard);

    // PPN
    var brutoJual = H.total.penjualanBruto;
    var pjkInk = D.hitungPpn(brutoJual, true), pjkEks = D.hitungPpn(brutoJual, false);
    var ppnCard = h('div', { class: 'card' },
      h('h3', { text: 'PPN 11% — akibat setelan inklusif dan eksklusif' }),
      h('p', { class: 'note' },
        'Angka penjualan yang sama, ditafsirkan dua cara. Kalau harga di rak sudah termasuk PPN, ',
        'peredaran bruto ', D.rupiah(brutoJual), ' berisi PPN ', D.rupiah(pjkInk.ppn),
        ' dan DPP-nya ', D.rupiah(pjkInk.dpp), '. Kalau belum termasuk, PPN-nya ', D.rupiah(pjkEks.ppn),
        ' harus ditambahkan di atasnya dan total tagihannya ', D.rupiah(pjkEks.total),
        '. Selisih antara dua tafsir itu ', h('b', { text: D.rupiah(pjkEks.total - brutoJual) }),
        ' — dan itulah kenapa setelan ini tidak boleh ditebak.'),
      h('div', { class: 'banding' },
        h('div', { class: 'metode-kartu' + (state.ppnInklusif ? ' aktif' : '') },
          h('h4', { text: 'Inklusif — harga sudah termasuk PPN' }),
          h('dl', { class: 'kv2' },
            h('dt', { text: 'Peredaran bruto' }), h('dd', { text: D.rupiah(brutoJual) }),
            h('dt', { text: 'DPP' }), h('dd', { text: D.rupiah(pjkInk.dpp) }),
            h('dt', { text: 'PPN keluaran' }), h('dd', { text: D.rupiah(pjkInk.ppn) }),
            h('dt', { text: 'Total dibayar pembeli' }), h('dd', { text: D.rupiah(pjkInk.total) }))),
        h('div', { class: 'metode-kartu' + (!state.ppnInklusif ? ' aktif' : '') },
          h('h4', { text: 'Eksklusif — PPN ditambahkan' }),
          h('dl', { class: 'kv2' },
            h('dt', { text: 'DPP' }), h('dd', { text: D.rupiah(pjkEks.dpp) }),
            h('dt', { text: 'PPN keluaran' }), h('dd', { text: D.rupiah(pjkEks.ppn) }),
            h('dt', { text: 'Total dibayar pembeli' }), h('dd', { text: D.rupiah(pjkEks.total) }),
            h('dt', { text: 'Selisih vs inklusif' }), h('dd', { text: D.rupiah(pjkEks.total - pjkInk.total) })))));
    p.appendChild(ppnCard);

    // ABC
    var jualPerSku = {};
    for (i = 0; i < s.length; i++) {
      if (s[i].jenis === 'jual') jualPerSku[s[i].sku] = (jualPerSku[s[i].sku] || 0) + L.dppEntry(s[i]);
      else if (s[i].jenis === 'retur-jual') jualPerSku[s[i].sku] = (jualPerSku[s[i].sku] || 0) - L.dppEntry(s[i]);
    }
    var abc = [];
    for (var sk in jualPerSku) if (Object.prototype.hasOwnProperty.call(jualPerSku, sk)) abc.push({ sku: sk, nilai: jualPerSku[sk] });
    abc.sort(function (a, b) { return b.nilai - a.nilai; });
    var totalJual = 0;
    for (i = 0; i < abc.length; i++) totalJual += abc[i].nilai;
    var kum = 0, rows3 = [];
    for (i = 0; i < Math.min(abc.length, 20); i++) {
      kum += abc[i].nilai;
      var pr = prod(abc[i].sku);
      var kelas = kum <= D.divRound(D.mul(totalJual, 80), 100) ? 'A' : kum <= D.divRound(D.mul(totalJual, 95), 100) ? 'B' : 'C';
      rows3.push(h('tr', null,
        h('td', { class: 'num', text: String(i + 1) }),
        h('td', { class: 'sku', text: abc[i].sku }),
        h('td', { class: 'wrap-normal', style: 'white-space:normal', text: pr ? pr.nama : '' }),
        tdRp(abc[i].nilai),
        h('td', { class: 'num', text: totalJual ? (D.divRound(D.mul(abc[i].nilai, 1000), totalJual) / 10).toFixed(1) + '%' : '—' }),
        h('td', null, h('span', { class: 'pill ' + (kelas === 'A' ? 'ok' : kelas === 'B' ? 'info' : 'warn'), text: 'Kelas ' + kelas }))));
    }
    var abcCard = h('div', { class: 'card' },
      h('h3', { text: 'Kontribusi penjualan (analisis ABC)' }),
      h('p', { class: 'note' }, 'Diurutkan menurut nilai penjualan DPP, neto retur — dasar yang sama dengan laba kotor, ' +
        'bukan angka bruto yang memuat PPN keluaran. Kelas A adalah SKU yang menyumbang 80% pertama, B sampai 95%, ' +
        'sisanya C — batas konvensional, bukan hasil optimasi.'));
    abcCard.appendChild(tableOf([{ label: '#', num: 1 }, 'SKU', 'Nama', { label: 'Nilai jual', num: 1 }, { label: 'Porsi', num: 1 }, 'Kelas'],
      rows3, { minWidth: '720px' }));
    p.appendChild(abcCard);
  }

  /* =================================================================== UJI */

  function renderUji(p) {
    var card = h('div', { class: 'card' },
      h('h3', { text: 'Assertion suite' }),
      h('p', { class: 'note' },
        'Berkas yang sama (', h('code', { text: 'tests.js' }), ') berjalan di halaman ini dan di bawah node. ',
        'Yang paling menanggung beban, berurutan: identitas nilai tertutup ke rupiah di bawah kedua metode ',
        'termasuk setelah sisipan bertanggal mundur; invarian kartu stok diperiksa baris demi baris pada ',
        'setiap pasangan SKU×gudang dan disilangkan dengan saldo yang dijumlah murni dari buku tanpa ',
        'menyentuh mesin biaya; lapisan FIFO diambil paling tua lebih dulu — diperiksa ulang di dalam ',
        'gelung konsumsi dengan mencari kunci terkecil sendiri, bukan dengan memercayai antrean; dan hasil ',
        'hitung ulang inkremental dibandingkan dokumen demi dokumen dengan replay penuh.'));

    p.appendChild(kartuPeriksaHidup());

    if (!state.tests) {
      card.appendChild(h('div', { class: 'empty', text: 'Uji sedang berjalan…' }));
      p.appendChild(card);
      return;
    }
    var run = state.tests;
    var sum = h('div', { class: 'test-summary' },
      h('span', { class: 'pillbig ' + (run.failed ? 'fail' : 'pass'), text: run.failed ? run.failed + ' GAGAL' : run.passed + ' LULUS' }),
      h('span', { class: 'hint', text: run.passed + ' dari ' + run.total + ' assertion di ' + T.groups.length + ' grup · ' + run.ms + ' ms' }),
      h('button', {
        class: 'btn small', type: 'button', 'data-fkey': 'uji:ulang', onclick: function () {
          state.tests = null; paintTests(); renderPanel('uji');
          setTimeout(runTests, 20);
        }
      }, 'Jalankan ulang'));
    card.appendChild(sum);

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
          x.ok ? null : h('span', { class: 'msg', text: x.message })));
      });
      card.appendChild(box);
    });
    p.appendChild(card);
  }

  function runTests() {
    var t0 = Date.now();
    var run;
    try { run = T.run(); }
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
    beranda: renderBeranda, produk: renderProduk, kartu: renderKartu, hpp: renderHpp,
    mundur: renderMundur, pembelian: renderPembelian, penerimaan: renderPenerimaan,
    transfer: renderTransfer, opname: renderOpname, kasir: renderKasir,
    laporan: renderLaporan, uji: renderUji
  };

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel) return;
    /* Every render is a teardown, and a teardown throws keyboard focus to
     * <body>. Capturing the focused element's stable key first and restoring it
     * afterwards is the difference between a usable cashier keyboard path and
     * one where entering a quantity costs the user twelve Tab presses. */
    var snap = captureFocus();
    clear(panel);
    try { RENDER[name](panel); }
    catch (e) {
      panel.appendChild(h('div', { class: 'callout bad' },
        h('b', { text: 'Panel gagal dirender. ' }), String(e && e.message || e)));
      if (window.console) console.error(e);
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
    /* Arriving at the till, the first thing that happens is a scan. Nothing else
     * on the panel wants focus, and without this the cashier walks the header,
     * three selects and a twelve-tab strip to reach the barcode box. */
    if (name === 'kasir' && !state.keranjang.length) state.fokusKe = 'ks:cari';
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
    var snap = captureFocus();
    renderCtxBar();
    renderPanel(state.view);
    restoreFocus(snap);
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
      });
    });
  }

  /* ================================================================ boot == */

  /* One tab writes; the others read. Taking the lock is the first thing boot
   * does, before anything can be posted, and the holder refreshes it on a timer
   * so a tab that dies frees it within the ttl instead of locking the profile
   * out for good. */
  var LOCK_TTL = 9000, lockTimer = null;

  function pesanKunci(holder) {
    return 'Tab lain pada peramban ini sedang memegang kunci tulis' + (holder ? ' (' + holder + ')' : '') + '. ' +
      'Nomor urut entry buku besar berasal dari pencacah di dalam buku, jadi dua tab yang memposting bersamaan ' +
      'akan mencetak id yang sama dan yang kedua akan menimpa dokumen yang pertama — dokumen hilang, stok bisa ' +
      'negatif. Tab ini karena itu hanya membaca. Tutup tab yang lain, lalu muat ulang halaman ini.';
  }

  function ambilKunci() {
    return St.lock(state.tabId, LOCK_TTL).then(function (r) {
      var dulu = state.tulis;
      state.tulis = !!r.ok;
      state.lockPemilik = r.holder;
      state.lockPesan = r.ok ? '' : pesanKunci(r.holder);
      if (dulu && !r.ok) {
        say('Kunci tulis diambil tab lain. Tab ini sekarang hanya membaca.');
        renderAll();
      }
      return r;
    });
  }

  function mulaiDenyutKunci() {
    if (lockTimer) return;
    lockTimer = setInterval(function () {
      if (state.tulis) { ambilKunci(); return; }
      /* Read-only: watch for the lock going free, then invite a reload rather
       * than promoting silently — this tab's book does not contain whatever the
       * other tab posted, and posting on top of a stale book is the bug. */
      St.get('konfig', 'lock').then(function (rec) {
        var v = rec && rec.v;
        var bebas = !v || !v.tab || (Date.now() - (v.at || 0)) > LOCK_TTL;
        if (bebas && !state.lockBebas) {
          state.lockBebas = true;
          renderCtxBar();
          say('Kunci tulis sudah bebas. Muat ulang halaman untuk mulai memposting.');
        }
      });
    }, 3000);
  }

  function boot() {
    state.db = S.build();
    state.sel.kartuSku = state.db.produk[0].sku;

    paintTheme();
    $('themeBtn').addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('testBadge').addEventListener('click', function () { switchTab('uji'); });
    $('bukuBadge').addEventListener('click', function () { switchTab('uji'); });
    if (window.GUDANG_GUARD) window.GUDANG_GUARD.onchange = paintNet;
    paintNet();
    paintTests();
    wireTabs();

    ambilKunci().then(function () {
      return muat();
    }).then(function () {
      renderAll();
      mulaiDenyutKunci();
      setTimeout(runTests, 30);
    });

    window.addEventListener('pagehide', function () {
      if (state.tulis) St.unlock(state.tabId);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
