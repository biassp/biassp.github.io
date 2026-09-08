/*!
 * Buku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Buku — app.js
 * The UI. Every rule it enforces lives in domain.js / ledger.js / sesuai.js;
 * this file renders them and never re-implements one. In particular it never
 * adds up a balance, never computes a statement line, and never decides whether
 * an entry balances — it hands a candidate entry to L.periksaEntri() and prints
 * the verdict.
 *
 * Six things this file has to get right that are easy to miss:
 *
 *  1. Every render tears the panel down and rebuilds it, which throws keyboard
 *     focus to <body>. A journal entry is a form with a dozen controls and it
 *     re-renders on every keystroke, so focus is captured by a stable
 *     data-fkey before the teardown and restored after it — and when the
 *     captured control no longer exists (deleting the line that had focus),
 *     focus falls back to the panel's anchor rather than to the document.
 *
 *  2. Values commit on `input`, never on `change`. `change` fires DURING the
 *     focus transfer, so the teardown it triggers races the browser: focus lands
 *     on <body> and a click on the next button is swallowed between mousedown
 *     and mouseup. A sibling lab shipped exactly that. See numInput.
 *
 *  3. A rebuild announces nothing to a screen reader. The posted entry and its
 *     document number, the refusal and the exact imbalance, the recomputed
 *     statements and the invariant count all go into one polite live region.
 *
 *  4. Where an action is denied by role or by a period lock, the control is
 *     still RENDERED and the reason printed next to it. A bookkeeper who cannot
 *     see the rule cannot work with it — they find someone whose login works.
 *
 *  5. The two badges in the header mean different things and are kept apart.
 *     `uji` is the assertion suite over books built from the seed; `buku hidup`
 *     is I1–I7 recomputed from the raw journal of the book actually on screen,
 *     rerun after every mutation. A suite that builds its own book cannot see a
 *     corrupted live one — that is how a green badge comes to sit above a
 *     balance sheet that does not balance.
 *
 *  6. Nothing rendered here is cached. Every figure on every panel is read
 *     through ledger.js at render time. There is no view model holding
 *     yesterday's totals, because that is the second copy of the truth that I7
 *     exists to forbid.
 */
(function () {
  'use strict';

  var D = window.BUKU_DOMAIN;
  var L = window.BUKU_LEDGER;
  var A = window.BUKU_SESUAI;
  var S = window.BUKU_SEED;
  var St = window.BUKU_STORE;
  var T = window.BUKU_TESTS;

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
      /* `cetakLepas` drops a column on PAPER only. A4's content box is about
       * 717px and a rupiah figure cannot be allowed to wrap mid-number, so a
       * nine- or ten-column table of money simply does not fit however hard the
       * names are wrapped — the last column falls off the sheet, and the last
       * column is usually the one the reader opened the table for. Rather than
       * shrink everything into illegibility, the columns that are working
       * intermediates or duplicate a figure already shown are left off the print. */
      var cls = (x.num ? 'num' : '') + (x.cetakLepas ? ' print-drop' : '');
      thead.appendChild(h('th', { class: cls.trim() || null, text: x.label !== undefined ? x.label : x }));
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
    /* Keyboard type-ahead. The browser's buffer lives on this element, so the
     * panel must not be rebuilt between the '5' and the '201' of an account code
     * — see the comment on jagaKetikan. 1200 ms is comfortably past Chromium's
     * own type-ahead timeout. */
    return jagaKetikan(sel, 1200);
  }

  /* The numeric fields, and the two things they have to get right.
   *
   * 1. COMMIT ON `input`, NEVER ON `change`. `change` on a field fires while the
   *    browser is transferring focus away from it. The handler re-renders, which
   *    tears the panel down; at that instant document.activeElement is <body>, so
   *    the focus snapshot is empty and focus lands on the document. Worse, a
   *    mouse user's click on the next button is swallowed, because the button is
   *    destroyed between mousedown and mouseup.
   *
   * 2. type="text" WITH inputmode="numeric", not type="number". Every keystroke
   *    re-renders the panel, so the caret has to be restored afterwards — and
   *    Chromium throws on selectionStart/setSelectionRange for input[type=number].
   *    With a number field the caret silently returns to position 0 and typing
   *    "1500000" produces 1. A text field with a numeric inputmode still brings
   *    up the numeric keypad on a phone.
   *
   * While a field is being edited its raw text is kept, so clearing it to type a
   * new figure does not fight a re-render that has already written "0" back. */
  var editRaw = { key: null, text: '' };

  /* Set while a panel is being torn down and rebuilt.
   *
   * THE BUG THIS EXISTS FOR, because it is subtle and it silently defeated the
   * caret machinery below until a Playwright run measured selectionStart and
   * found it at 7 in a 9-character string.
   *
   * Removing a FOCUSED input fires `blur` synchronously. The blur handler on a
   * numeric field clears editRaw — that is what it is for, when the user really
   * has left the field. But every keystroke re-renders the panel, and the
   * re-render's clear() removes the focused input, so blur fired on OUR OWN
   * teardown and editRaw was wiped before it could ever be read. The field then
   * rebuilt itself with the REFORMATTED value ("2.550.000", nine characters)
   * while the caret snapshot had been taken against the raw text ("2550000",
   * seven), and the caret landed two characters short of the end. Every
   * subsequent digit went into the middle of the number.
   *
   * So the blur handler ignores a blur that this file caused. A real blur — the
   * user tabbing away — still clears it, because sedangRender is false then. */
  var sedangRender = false;

  function angkaDari(v) {
    var t = String(v === null || v === undefined ? '' : v).replace(/[^\d]/g, '');
    if (t === '') return 0;
    var n = parseInt(t, 10);
    return isNaN(n) ? 0 : n;
  }

  function numInput(value, onchange, attrs) {
    var a = attrs || {};
    var key = a['data-fkey'] || null;
    a.type = 'text';
    a.inputmode = 'numeric';
    a.autocomplete = 'off';
    a.class = (a.class ? a.class + ' ' : '') + 'nilai-input';
    var tampil = value === 0 || value === '' || value === null || value === undefined ? '' : D.angka(value);
    if (key && editRaw.key === key) {
      var mentah = editRaw.text;
      if (mentah === '' || angkaDari(mentah) === angkaDari(value)) tampil = mentah;
      else editRaw = { key: null, text: '' };
    }
    a.value = tampil;
    var el = h('input', a);
    el.addEventListener('input', function () {
      if (key) editRaw = { key: key, text: el.value };
      onchange(angkaDari(el.value));
    });
    el.addEventListener('blur', function () {
      /* Not our own teardown — see sedangRender. */
      if (sedangRender) return;
      if (key && editRaw.key === key) editRaw = { key: null, text: '' };
    });
    return el;
  }

  /* ==================================== menahan render selama pengetikan ==
   *
   * Two controls keep editing state INSIDE THE BROWSER, on the element itself:
   *
   *   <select>           the type-ahead buffer. Type "5201" and Chromium keeps the
   *                      accumulated string for about a second so it can resolve
   *                      the whole code. The buffer belongs to the element.
   *   <input type=date>  the per-segment editing position, and the digits already
   *                      typed into the segment being edited.
   *
   * Both are destroyed when the element is replaced — and the date input's is
   * destroyed even by RE-FOCUSING the same element. Every render in this file
   * replaces the panel and these controls commit on every keystroke, so every
   * keystroke was treated as a fresh first keystroke. Measured against an
   * identical control on the same page with its listener removed: typing 5201
   * into the account picker selected 2101 Utang Usaha; typing a date produced a
   * different date. Not a speed race — 600 ms between keys failed identically.
   *
   * The fix is NOT to commit on `change` instead. `change` on both of these fires
   * mid-edit, on every segment and every type-ahead resolution, so it re-renders
   * just as often — and on a text field `change` fires DURING focus transfer,
   * which is the sibling-lab bug numInput exists to avoid.
   *
   * The fix is to HOLD THE RENDER while the browser's own buffer is alive. The
   * model is still committed on every keystroke, so validation, the invariant
   * count and everything downstream see the current value the moment it changes.
   * Only the DOM teardown waits — for a blur, for Enter, or until the buffer has
   * demonstrably expired. Nothing is lost, and no re-render can steal a control
   * the user is still typing into.
   *
   * The hold can only ever be held by the FOCUSED element, and it is released by
   * blur, by Enter, and unconditionally by a timer, so it cannot wedge the UI. */
  var tahan = { el: null, timer: null, tunda: null, tundaSemua: false, tungguKlik: false };

  function lepasTahan(tanpaRender) {
    if (tahan.timer) { clearTimeout(tahan.timer); tahan.timer = null; }
    tahan.tungguKlik = false;
    if (!tahan.el) return;
    tahan.el = null;
    var t = tahan.tunda, semua = tahan.tundaSemua;
    tahan.tunda = null; tahan.tundaSemua = false;
    if (tanpaRender) return;
    if (semua) renderAll();
    else if (t) renderPanel(t);
  }

  /* IS A CLICK IN FLIGHT?
   *
   * Releasing the hold from a blur handler and rendering there and then would
   * recreate, on the mouse path, exactly the bug the `input`-not-`change` rule
   * exists to prevent: mousedown on a button blurs the field, the render tears the
   * button out of the document, and the mouseup that would have completed the
   * click lands on nothing. So while a pointer button is down the release WAITS,
   * and it waits for `click` rather than `pointerup` — pointerup fires before
   * click, and tearing the button down there would swallow the click just the
   * same. The button's own handler runs first (it is on the button, this listener
   * is on the document), so whatever render it asks for is recorded and then
   * performed by the release. */
  var tikusTurun = false;
  document.addEventListener('pointerdown', function () { tikusTurun = true; }, true);
  document.addEventListener('pointercancel', function () { tikusTurun = false; }, true);
  document.addEventListener('click', function () {
    tikusTurun = false;
    if (tahan.tungguKlik) lepasTahan();
  }, false);
  /* A pointerup with no click at all — a drag that started on the control and
   * ended somewhere that swallows the click — must not leave the hold stuck. */
  document.addEventListener('pointerup', function () {
    tikusTurun = false;
    if (!tahan.tungguKlik) return;
    setTimeout(function () { if (tahan.tungguKlik) lepasTahan(); }, 0);
  }, true);

  /* Attach to a control whose in-element editing state must survive a keystroke.
   * `jeda` is how long the browser keeps its buffer alive with no further keys —
   * about a second for a select's type-ahead, longer for a date, whose segment
   * state never expires on its own. */
  function jagaKetikan(el, jeda) {
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { lepasTahan(); return; }
      if (ev.key === 'Tab' || ev.key === 'Escape') return;   // the blur that follows releases it
      var mengetik = (ev.key && ev.key.length === 1) ||
        ev.key === 'ArrowUp' || ev.key === 'ArrowDown' ||
        ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' ||
        ev.key === 'Backspace' || ev.key === 'Delete';
      if (!mengetik) return;
      if (tahan.el && tahan.el !== el) lepasTahan();
      tahan.el = el;
      if (tahan.timer) clearTimeout(tahan.timer);
      tahan.timer = setTimeout(function () { lepasTahan(); }, jeda);
    });
    el.addEventListener('blur', function () {
      if (tahan.el !== el) return;
      if (tikusTurun) { tahan.tungguKlik = true; return; }
      /* Deferred by one task so the browser finishes moving focus first: the
       * render's own focus snapshot is then taken against the control the user has
       * just moved TO, and it is that control which gets focus back. Rendering
       * synchronously inside blur destroyed the field the user was tabbing into. */
      setTimeout(function () { if (tahan.el === el) lepasTahan(); }, 0);
    });
    return el;
  }

  /* A date field that survives being typed into. Out-of-range intermediate values
   * are not committed — typing a year digit by digit passes through 0002-12-31 on
   * the way to 2025-12-31, and a report drawn up in the year 2 is not a state the
   * rest of the app should ever be asked to render. On blur an incomplete or
   * out-of-range value is put back to the value the model actually holds, so the
   * field can never sit there showing a date no statement was built from. */
  function tanggalInput(nilai, attrs, komit, nilaiSekarang) {
    var a = attrs || {};
    a.type = 'date';
    a.value = nilai;
    var el = h('input', a);
    el.addEventListener('input', function () {
      var v = el.value;
      if (!D.isTanggal(v)) return;
      if (a.min && v < a.min) return;
      if (a.max && v > a.max) return;
      komit(v);
    });
    el.addEventListener('blur', function () {
      var v = el.value, baik = nilaiSekarang ? nilaiSekarang() : nilai;
      if (!D.isTanggal(v) || (a.min && v < a.min) || (a.max && v > a.max)) el.value = baik;
    });
    return jagaKetikan(el, 2000);
  }

  function rp(n, cls) { return h('span', { class: 'rp ' + (cls || ''), text: D.rupiah(n) }); }
  function tdRp(n, cls) { return h('td', { class: 'num ' + (cls || ''), text: D.rupiah(n) }); }
  function tdAkun(n, cls) { return h('td', { class: 'num ' + (cls || ''), text: n === 0 ? '—' : D.angka(n) }); }

  function badgeTipe(tipe) { return h('span', { class: 'tipe ' + tipe, text: tipe }); }
  function badgeJenis(jenis) {
    var j = D.jenis(jenis);
    return h('span', { class: 'jns ' + jenis.replace('-', ''), text: j ? j.label : jenis });
  }

  var sayTimer = null;
  function say(text) {
    var el = $('say');
    if (!el || !text) return;
    el.textContent = '';
    if (sayTimer) clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { el.textContent = text; }, 40);
  }

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
    } catch (e) { /* selectionStart throws on number and date inputs in some engines */ }
    return snap;
  }

  /* Where focus goes when the control that had it no longer exists. Deleting a
   * journal line removes the very element that was focused; without a fallback
   * the user lands on <body> and re-Tabs from the skip link. The anchor is the
   * control the next action needs anyway. */
  var FOKUS_ANCHOR = {
    jurnal: 'ju:tambah', besar: 'bb:akun', saldo: 'ns:tahap', sesuai: 'js:semua',
    tutup: 'tp:posting', pajak: 'pj:tahun', laporan: 'lp:sampai', bagan: 'bg:cari'
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
    /* If it never lost focus, LEAVE IT ALONE. Calling focus() on an already-focused
     * <input type=date> resets its per-segment editing position in Chromium, so a
     * render triggered from a control OUTSIDE the panel being rebuilt — the
     * "Laporan per tanggal" field lives in the context bar, which renderPanel does
     * not touch — still broke the date being typed into it. Nothing to restore
     * either: a control that kept focus kept its caret. */
    if (el === document.activeElement) return;
    try { el.focus({ preventScroll: true }); } catch (e2) { try { el.focus(); } catch (e3) { return; } }
    if (snap.selStart !== undefined) {
      /* Clamp. The rebuilt control can legitimately hold a shorter string than
       * the one the snapshot was taken against — a value the model clamped, or a
       * figure that re-formatted — and setSelectionRange past the end silently
       * parks the caret at 0 in some engines rather than at the end. */
      var n = (el.value === undefined || el.value === null) ? 0 : String(el.value).length;
      var a = Math.min(snap.selStart, n), b = Math.min(snap.selEnd === undefined ? a : snap.selEnd, n);
      try { el.setSelectionRange(a, b); } catch (e4) { /* not a text input */ }
    }
  }

  /* --------------------------------------------------------------- state */

  function barisKosong() { return { akun: '', d: 0, k: 0 }; }

  var state = {
    db: null,
    tulis: true,
    /* From sessionStorage, so a reload of THIS tab reclaims the write lock it
     * already held instead of waiting out the TTL as a read-only page. */
    tabId: St.tabId(),
    lockPemilik: null, lockPesan: '', lockBebas: false,
    peran: 'akuntan',
    view: 'beranda',
    tests: null,
    periksa: null,        // live-book invariant run, recomputed after every mutation
    pesan: null,          // { jenis:'ok'|'tolak', judul, isi:[..] }
    fokusKe: null,
    sampai: '2025-12-31',
    draf: [],             // staf drafts, not in the book
    /* The entry being composed. Four rows to start, because most entries in this
     * book are three or four lines and an editor that starts at two makes the
     * user hunt for the add button before they can begin. */
    entri: { tgl: '2025-12-31', jenis: 'umum', memo: '', baris: [barisKosong(), barisKosong(), barisKosong(), barisKosong()] },
    koreksiUntuk: null,   // entry id being corrected
    sel: {
      bbAkun: '1101', bbDari: '2025-01-01', bbSampai: '2025-12-31',
      nsTahap: 'semua', nsNolPun: true,
      juFilter: 'semua', juCari: '', juBuka: {}, juBatas: 40,
      bgCari: '', bgTipe: 'semua',
      lpMana: 'semua',
      pjTahun: '2025',
      asetBuka: ''
    }
  };

  var TAHUN = '2025', AWAL = '2025-01-01', AKHIR = '2025-12-31';

  function buku() { return state.db.buku; }

  /* Every derived figure in the app comes through these, and none of them is
   * memoised across a mutation: invalidate() throws the invariant run away and
   * the statements are simply recomputed. On a 480-entry book a full set of four
   * statements plus the invariant sweep costs a few tens of milliseconds, which
   * is cheap enough that no screen ever shows a stale number — and a stale
   * number is how a set of books loses an argument. */
  function invalidate() { state.periksa = null; }

  function periksaHidup() {
    if (state.periksa) return state.periksa;
    var out = null;
    try {
      out = L.periksaBuku(buku(), { dari: AWAL, sampai: state.sampai, tahunDari: AWAL });
    } catch (e) {
      out = { cek: [], total: 1, lulus: 0, gagal: 1, error: String(e && e.message || e) };
    }
    state.periksa = out;
    return out;
  }

  function lr() { return L.labaRugi(buku(), AWAL, state.sampai); }
  function nr(l) { return L.neraca(buku(), state.sampai, { dari: AWAL, labaRugi: l || lr() }); }
  function pe(l) { return L.perubahanEkuitas(buku(), AWAL, state.sampai, { labaRugi: l || lr() }); }
  function ak(l) { return L.arusKas(buku(), AWAL, state.sampai, { labaRugi: l || lr() }); }

  function boleh(aksi) { return D.bolehkah(state.peran, aksi) && state.tulis; }

  function alasanTakBoleh(aksi) {
    if (!D.bolehkah(state.peran, aksi)) {
      var p = D.peran(state.peran);
      return 'Peran ' + (p ? p.label : state.peran) + ' tidak berwenang. ' + (p ? p.catatan : '');
    }
    if (!state.tulis) return state.lockPesan;
    return '';
  }

  /* -------------------------------------------------------------- pesan */

  function pesanOk(judul, isi) { state.pesan = { jenis: 'ok', judul: judul, isi: isi || [] }; }
  function pesanTolak(judul, isi) { state.pesan = { jenis: 'tolak', judul: judul, isi: isi || [] }; }
  function lupakanPesan() { state.pesan = null; }

  /* ONE place, not three panel renderers.
   *
   * renderPesan() used to be called from renderJurnal, renderSesuai and
   * renderTutup, and from nowhere else. The page boots on Beranda, so a message
   * raised during muat() — "N stored entries could not be replayed" — was written
   * into state.pesan and never rendered at all: the only visible consequence of a
   * dropped journal entry was a figure that had quietly changed. The container
   * lives outside the tab panels, so a message survives a tab switch and is
   * visible wherever the reader is standing. */
  function renderPesanBar() {
    var bar = $('pesanbar');
    if (!bar) return;
    sedangRender = true;
    try { clear(bar); } finally { sedangRender = false; }
    if (!state.pesan) { bar.hidden = true; return; }
    bar.hidden = false;
    var m = state.pesan;
    var box = h('div', { class: m.jenis === 'ok' ? 'terima-ok' : 'tolak' });
    box.appendChild(h('b', { text: m.judul + ' ' }));
    if (m.isi && m.isi.length) {
      var ul = h('ul');
      m.isi.forEach(function (x) { ul.appendChild(h('li', { class: 'wrap-normal', text: x })); });
      box.appendChild(ul);
    }
    box.appendChild(h('div', { class: 'no-print', style: 'margin-top:6px' },
      h('button', {
        class: 'btn small', type: 'button', 'data-fkey': 'pesan:tutup',
        onclick: function () { lupakanPesan(); renderPesanBar(); }
      }, 'Tutup')));
    bar.appendChild(box);
  }

  /* ------------------------------------------------------------- header */

  function paintNet() {
    var g = window.BUKU_GUARD;
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
   * "the seven invariants hold on the book in front of you, right now, recomputed
   * from its raw journal". */
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
    St.writeLocal('buku.theme', next);
    paintTheme();
    say(next === 'dark' ? 'Tema gelap aktif.' : 'Tema terang aktif.');
  }

  /* ------------------------------------------------------------ context */

  function renderCtxBar() {
    var bar = $('ctxbar');
    sedangRender = true;
    try { clear(bar); } finally { sedangRender = false; }

    bar.appendChild(field('Peran', select(
      D.PERAN.map(function (p) { return { value: p.id, label: p.label }; }),
      state.peran,
      function (v) {
        state.peran = v;
        St.put('konfig', { k: 'peran', v: v });
        lupakanPesan();
        say('Peran ' + (D.peran(v) ? D.peran(v).label : v) + '. ' + (D.peran(v) ? D.peran(v).catatan : ''));
        renderAll();
      }, { 'data-fkey': 'ctx:peran' }
    )));

    /* As-of date. Committed on `input` and only when the string is a complete
     * valid date, so half-typed "2025-1" never reaches the ledger and the
     * re-render never races a focus transfer the way a `change` handler would. */
    var tglInput = tanggalInput(state.sampai,
      { min: '2024-12-31', max: '2026-12-31', 'data-fkey': 'ctx:sampai' },
      function (v) {
        state.sampai = v;
        invalidate();
        say('Laporan disusun per ' + D.tglPanjang(v) + '.');
        renderPanel(state.view);
        paintBuku();
      },
      function () { return state.sampai; });
    bar.appendChild(field('Laporan per tanggal', tglInput));

    var chips = h('div', { class: 'stack' });
    var pr = D.peran(state.peran);
    chips.appendChild(h('span', { class: 'perchip', text: (pr ? pr.label : state.peran) + ' · ' + Object.keys(pr ? pr.boleh : {}).length + ' kewenangan' }));
    bar.appendChild(chips);

    var nota = h('div', { class: 'ctx-note' });
    if (!state.tulis) {
      nota.appendChild(h('div', { class: 'pill bad', text: 'hanya baca' }));
      nota.appendChild(h('div', { class: 'small wrap-normal', text: state.lockPesan }));
      if (state.lockBebas) nota.appendChild(h('div', { class: 'small', text: 'Kunci tulis sudah bebas — muat ulang halaman untuk mulai memposting.' }));
    } else {
      nota.appendChild(h('div', { class: 'small wrap-normal' },
        pr ? pr.catatan : '',
        St.mode === 'memori' ? h('div', { class: 'pill warn', style: 'margin-top:4px', text: 'penyimpanan: memori — ' + St.reason }) : null));
    }
    bar.appendChild(nota);
  }

  /* ============================================================ beranda */

  function kartuPeriksaHidup(ringkas) {
    var pr = periksaHidup();
    var card = h('div', { class: 'card' },
      h('h3', { text: 'Pemeriksaan buku yang sedang dimuat — I1 sampai I7' }),
      h('p', { class: 'note wrap-normal' },
        'Badge ', h('b', { text: 'uji' }), ' di header adalah rangkaian assertion atas buku yang dibangun ulang dari seed — ' +
        'ia tidak pernah melihat entri yang baru Anda posting. Yang di sini (', h('b', { text: 'buku hidup' }), ') ' +
        'dijalankan atas buku yang ada di layar sekarang, dihitung ulang dari ', h('b', { text: 'jurnal mentahnya' }),
        ', bukan dari total yang sudah tersimpan di mana pun — karena tidak ada total yang tersimpan di mana pun. ' +
        'Kalau satu baris di bawah merah, angka di halaman ini tidak boleh dipercaya.'));

    if (pr.error) {
      card.appendChild(h('div', { class: 'tolak' }, h('b', { text: 'Pemeriksaan melempar exception. ' }), pr.error));
      return card;
    }

    var sum = h('div', { class: 'test-summary' },
      h('span', { class: 'pillbig ' + (pr.gagal ? 'fail' : 'pass'), text: pr.gagal ? pr.gagal + ' GAGAL' : pr.lulus + ' / ' + pr.total + ' INVARIAN' }),
      h('span', { class: 'hint wrap-normal', text: 'dihitung ulang dari ' + buku().entries.length + ' entri jurnal, per ' + D.tglPanjang(state.sampai) }));
    card.appendChild(sum);

    var byInv = {}, urut = [];
    pr.cek.forEach(function (c) {
      if (!byInv[c.inv]) { byInv[c.inv] = []; urut.push(c.inv); }
      byInv[c.inv].push(c);
    });
    urut.sort();
    var JUDUL = {
      I1: 'I1 — setiap entri jurnal seimbang',
      I2: 'I2 — neraca saldo seimbang',
      I3: 'I3 — Aset = Liabilitas + Ekuitas, di setiap tanggal',
      I4: 'I4 — laba bersih menyatu di tiga laporan',
      I5: 'I5 — jurnal penutup menihilkan akun nominal',
      I6: 'I6 — arus kas rekonsiliasi ke saldo kas buku besar',
      I7: 'I7 — saldo diturunkan, tidak pernah disimpan'
    };
    urut.forEach(function (inv) {
      var list = byInv[inv];
      if (ringkas && list.every(function (c) { return c.ok; })) {
        var gg = list.filter(function (c) { return !c.ok; }).length;
        card.appendChild(h('div', { class: 'tcase ok' },
          h('span', { class: 'mk', text: '✓' }),
          h('span', { class: 'wrap-normal', text: (JUDUL[inv] || inv) + ' — ' + (list.length - gg) + '/' + list.length }),
          h('span', { class: 'msg wrap-normal', text: list[0].pesan })));
        return;
      }
      var gagal = list.filter(function (x) { return !x.ok; }).length;
      var box = h('div', { class: 'tgroup' });
      box.appendChild(h('h4', { class: 'wrap-normal', text: (JUDUL[inv] || inv) + '  ' + (list.length - gagal) + '/' + list.length }));
      list.forEach(function (x) {
        box.appendChild(h('div', { class: 'tcase ' + (x.ok ? 'ok' : 'no') },
          h('span', { class: 'mk', text: x.ok ? '✓' : '✗' }),
          h('span', { class: 'wrap-normal', text: x.nama }),
          h('span', { class: 'msg wrap-normal', text: x.pesan })));
      });
      card.appendChild(box);
    });
    return card;
  }

  function renderBeranda(p) {
    var l = lr(), n = nr(l), pers = L.persamaan(buku(), state.sampai);
    var kas = L.saldoKas(buku(), { sampai: state.sampai });

    var sum = h('div', { class: 'summary' },
      stat('Total aset', D.rupiah(n.totalAset), 'per ' + D.tglPendek(state.sampai)),
      stat('Liabilitas + ekuitas', D.rupiah(n.kanan), pers.seimbang ? 'seimbang, selisih Rp0' : 'SELISIH ' + D.rupiah(pers.selisih)),
      stat('Laba bersih', D.rupiah(l.labaNeto), 'tahun buku ' + TAHUN),
      stat('Kas dan setara kas', D.rupiah(kas.total), kas.rinci.map(function (r) { return r.akun.kode; }).join(' + ')),
      stat('Peredaran bruto', D.rupiah(l.peredaranBruto),
        'dasar PPh final 0,5% setelah Rp 500 juta yang tidak dikenai PPh: ' +
        D.rupiah(D.pphFinalDasar(0, l.peredaranBruto).kena)),
      stat('Entri jurnal', D.angka(buku().entries.length), 'termasuk yang Anda posting'));
    p.appendChild(sum);

    var prof = state.db.profil;
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: prof.nama + ' — ' + prof.bentuk }),
      h('p', { class: 'note wrap-normal', text: prof.bidang + '. Tahun buku ' + TAHUN + ', ' + D.tglPanjang(AWAL) + ' sampai ' + D.tglPanjang(AKHIR) + '.' }),
      h('dl', { class: 'kv2' },
        h('dt', { text: 'Standar' }), h('dd', { class: 'wrap-normal' }, h('b', { text: prof.standar }),
          ' — Laporan Posisi Keuangan, Laporan Laba Rugi dan Catatan atas Laporan Keuangan adalah yang diwajibkan SAK EMKM. ' +
          'Laporan Perubahan Ekuitas dan Laporan Arus Kas TIDAK diwajibkan untuk entitas mikro; keduanya disajikan di sini ' +
          'sebagai tambahan, dalam bentuk yang dipakai SAK ETAP, karena keduanya yang membuktikan laba dan kasnya menyatu.'),
        h('dt', { text: 'NPWP' }), h('dd', { class: 'wrap-normal' }, prof.npwp, h('div', { class: 'small', text: prof.npwpCatatan })),
        h('dt', { text: 'Bank' }), h('dd', { class: 'wrap-normal', text: prof.bank }),
        h('dt', { text: 'Status PPN' }), h('dd', { class: 'wrap-normal', text: prof.pkpCatatan }),
        h('dt', { text: 'Rezim PPh' }), h('dd', { class: 'wrap-normal', text: D.PPH_FINAL_LABEL + ' — 0,5% dari peredaran bruto per masa, final. Bukan PPh badan atas laba: bulan yang merugi pun tetap terutang.' }),
        h('dt', { text: 'Seed' }), h('dd', { text: String(state.db.seed) + ' (mulberry32)' }))));

    /* The tie-through panel: I4 made visible rather than only asserted. */
    var pEk = pe(l), aKas = ak(l);
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Satu angka laba bersih, empat laporan' }),
      h('p', { class: 'note wrap-normal', text: 'Laba bersih dihitung SEKALI, oleh labaRugi(). Ketiga laporan lain memakai angka itu — tidak menghitungnya ulang dengan caranya masing-masing lalu berharap sama. Baris terakhir di bawah menurunkannya ulang dari pergerakan ekuitas di neraca, lewat jalur yang tidak menyentuh labaRugi() sama sekali.' }),
      h('div', { class: 'rekon' },
        rekonBaris('Laba Rugi — laba neto', l.labaNeto),
        rekonBaris('Laporan Perubahan Ekuitas — baris laba', pEk.labaNeto),
        rekonBaris('Neraca — laba periode berjalan di ekuitas', n.labaBerjalan,
          n.labaBerjalan === 0 && L.sudahDitutup(buku(), state.sampai, AWAL) ? 'nol karena buku sudah ditutup: labanya sudah pindah ke Saldo Laba' : null),
        rekonBaris('Laporan Arus Kas — baris pembuka', aKas.labaNeto),
        rekonBaris('Diturunkan ulang: Δekuitas − setoran + prive', (pers.ekuitas - L.persamaan(buku(), null, { entries: L.pilih(buku(), { sebelum: AWAL }) }).ekuitas) - pEk.setoran + pEk.prive - pEk.lainEkuitas),
        h('div', { class: 'rekon-baris total sisa' + (l.labaNeto === pEk.labaNeto && pEk.labaNeto === aKas.labaNeto ? '' : ' rusak') },
          h('span', { text: 'Selisih antar laporan' }),
          h('span', { class: 'n', text: D.rupiah(Math.max(Math.abs(l.labaNeto - pEk.labaNeto), Math.abs(l.labaNeto - aKas.labaNeto))) })))));

    p.appendChild(kartuPeriksaHidup(true));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Buku ini sengaja ditinggalkan setengah jalan' }),
      h('p', { class: 'note wrap-normal', text: 'Yang di-seed adalah satu tahun transaksi biasa dan tidak lebih — persis seperti keadaan sebuah buku pada 31 Desember, sebelum akuntannya mulai bekerja. Empat langkah di bawah adalah pekerjaan yang tersisa, dan setiap langkah mengubah angkanya di depan mata Anda sementara ketujuh invarian tetap hijau.' }),
      h('ol', { class: 'note wrap-normal', style: 'margin-left:18px' },
        h('li', null, 'Buka ', h('b', { text: 'Neraca Saldo' }), ' — kolom “sebelum penyesuaian” sudah seimbang, tapi belum benar: belum ada penyusutan, belum ada beban akrual.'),
        h('li', null, 'Buka ', h('b', { text: 'Penyesuaian' }), ' dan posting kelimanya. Kolom “setelah penyesuaian” muncul, dan laba turun ' + D.rupiah(114642004 - 0) + ' worth of beban yang tadinya belum diakui.'),
        h('li', null, 'Buka ', h('b', { text: 'Laporan' }), ' — keempat laporan, dengan rekonsiliasi arus kas yang dihitung, bukan diplot.'),
        h('li', null, 'Ganti peran ke ', h('b', { text: 'Supervisor' }), ', buka ', h('b', { text: 'Penutup & Periode' }), ' dan tutup bukunya. Setiap akun nominal jadi nol dan neracanya tidak bergeser sepeser pun.')),
      h('p', { class: 'hint wrap-normal', text: 'Coba juga: sebagai Staf, posting apa pun — ditolak, dan draf Anda menunggu akuntan. Sebagai Akuntan, coba posting ke Maret — ditolak, periodenya terkunci. Ketik entri yang tidak seimbang — ditolak, dengan selisihnya disebut ke rupiah.' })));
  }

  function stat(k, v, n) {
    return h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), n ? h('div', { class: 'n wrap-normal', text: n }) : null);
  }

  function rekonBaris(label, nilai, catatan, cls) {
    return h('div', { class: 'rekon-baris ' + (cls || '') },
      h('span', { class: 'wrap-normal' }, label, catatan ? h('div', { class: 'small', text: catatan }) : null),
      h('span', { class: 'n', text: D.rupiah(nilai) }));
  }

  /* ========================================================== bagan akun */

  function renderBagan(p) {
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Bagan akun — lima tipe, dan saldo normal yang TIDAK bisa ditebak dari nomornya' }),
      h('p', { class: 'note wrap-normal' },
        'Digit pertama adalah tipenya: 1 Aset, 2 Liabilitas, 3 Ekuitas, 4 Pendapatan, 5 Beban. Tapi saldo normal ' +
        'bukan fungsi dari tipe itu, dan demo yang menurunkannya dari digit pertama salah pada dua akun di tabel ini: ',
        h('b', { text: '1602 Akumulasi Penyusutan' }), ' adalah Aset dengan saldo normal KREDIT, dan ',
        h('b', { text: '3102 Prive' }), ' adalah Ekuitas dengan saldo normal DEBIT. Keduanya ditandai kontra, dan ' +
        'karena tandanya diambil dari tipe — bukan dari akunnya — akumulasi penyusutan mengurangi aset dan prive ' +
        'mengurangi ekuitas tanpa satu pun ', h('code', { text: 'if (kontra)' }), ' di kode laporannya.')));

    var cari = state.sel.bgCari.toLowerCase();
    var box = h('div', { class: 'card' });
    var ctl = h('div', { class: 'controls' });
    var inp = h('input', { class: 'cari', type: 'search', value: state.sel.bgCari, placeholder: 'Cari kode atau nama akun…', 'data-fkey': 'bg:cari' });
    inp.addEventListener('input', function () { state.sel.bgCari = inp.value; renderPanel('bagan'); });
    ctl.appendChild(field('Cari', inp, 'field-cari'));
    ctl.appendChild(field('Tipe', select(
      [{ value: 'semua', label: 'Semua tipe' }].concat(D.TIPE.map(function (t) { return { value: t, label: t }; })),
      state.sel.bgTipe, function (v) { state.sel.bgTipe = v; renderPanel('bagan'); }, { 'data-fkey': 'bg:tipe' })));
    box.appendChild(ctl);

    var rows = [];
    D.TIPE.forEach(function (tipe) {
      if (state.sel.bgTipe !== 'semua' && state.sel.bgTipe !== tipe) return;
      var akun = D.akunTipe(tipe).filter(function (a) {
        if (!cari) return true;
        return a.kode.indexOf(cari) >= 0 || a.nama.toLowerCase().indexOf(cari) >= 0;
      });
      if (!akun.length) return;
      var totTipe = 0;
      var baris = akun.map(function (a) {
        var s = L.saldoAkun(buku(), a.kode, { sampai: state.sampai });
        totTipe += D.NORMAL_TIPE[tipe] === 'D' ? s.mentah : -s.mentah;
        return h('tr', null,
          h('td', null, h('span', { class: 'kode', text: a.kode })),
          h('td', { class: 'wrap-normal' }, a.nama, a.kontra ? h('span', { class: 'pill warn', style: 'margin-left:6px', text: 'kontra' }) : null),
          h('td', null, badgeTipe(a.tipe)),
          h('td', null, h('span', { class: 'mono', text: a.normal === 'D' ? 'Debit' : 'Kredit' })),
          h('td', null, h('span', { class: 'mono', text: a.kas ? 'kas' : a.arus })),
          h('td', { class: 'wrap-normal small', text: a.tipe === 'Aset' || a.tipe === 'Liabilitas' ? (a.lancar ? (a.tipe === 'Aset' ? 'lancar' : 'jangka pendek') : (a.tipe === 'Aset' ? 'tidak lancar' : 'jangka panjang')) : '—' }),
          tdRp(s.debit), tdRp(s.kredit),
          h('td', { class: 'num rp' + (s.saldo === 0 ? ' nol' : '') , text: D.rupiah(s.saldo) }));
      });
      rows.push(h('tr', { class: 'grupbaris' }, h('td', { colspan: '9', text: tipe + ' — saldo normal ' + (D.NORMAL_TIPE[tipe] === 'D' ? 'debit' : 'kredit') + ', ' + akun.length + ' akun' })));
      baris.forEach(function (r) { rows.push(r); });
      rows.push(h('tr', { class: 'jumlahbaris' },
        h('td', { colspan: '8', text: 'Jumlah ' + tipe + ' (arah pelaporan)' }),
        h('td', { class: 'num rp', text: D.rupiah(totTipe) })));
    });

    box.appendChild(tableOf(
      ['Kode', 'Nama akun', 'Tipe', 'Saldo normal', 'Arus kas', 'Klasifikasi', { label: 'Jumlah debit', num: true }, { label: 'Jumlah kredit', num: true }, { label: 'Saldo', num: true }],
      rows, { minWidth: '900px' }));
    box.appendChild(h('p', { class: 'hint wrap-normal', style: 'margin-top:8px', text: 'Kolom “Arus kas” adalah bucket laporan arus kas: O operasi, I investasi, F pendanaan. Akun kas tidak punya bucket — ia adalah kasnya. Setiap akun non-kas WAJIB punya salah satunya; kalau tidak, arusKas() melempar, karena akun tanpa klasifikasi akan hilang dari laporan dan rekonsiliasinya gagal tanpa penjelasan.' }));
    p.appendChild(box);
  }

  /* =========================================================== jurnal umum */

  function opsiAkun() {
    return [{ value: '', label: '— pilih akun —' }].concat(D.AKUN.map(function (a) {
      return { value: a.kode, label: a.kode + ' ' + a.nama };
    }));
  }

  function totalEntri(e) {
    var d = 0, k = 0;
    e.baris.forEach(function (b) { d += b.d || 0; k += b.k || 0; });
    return { d: d, k: k, selisih: d - k };
  }

  function renderEditor(p) {
    var e = state.entri;
    var t = totalEntri(e);
    var koreksiAsal = state.koreksiUntuk ? L.cari(buku(), state.koreksiUntuk) : null;

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: koreksiAsal ? 'Jurnal koreksi atas ' + koreksiAsal.no : (boleh('posting') ? 'Entri jurnal baru' : 'Draf entri jurnal') }));
    card.appendChild(h('p', { class: 'note wrap-normal' },
      koreksiAsal
        ? 'Koreksi meninggalkan TIGA dokumen: entri asli tetap apa adanya, satu jurnal pembalik menghapus pengaruhnya, dan entri di bawah ini menggantikannya. Entri asli tidak pernah diubah dan tidak pernah dihapus — itu bedanya jejak audit dengan cerita tentang jejak audit.'
        : 'Debit dan kredit harus sama. Angkanya dihitung ulang setiap ketikan dan diperiksa oleh validator yang sama dengan yang dipakai seed dan suite uji — tidak ada jalan masuk ke buku yang melewatinya.'));

    if (koreksiAsal) {
      card.appendChild(h('div', { class: 'callout' },
        h('b', { text: 'Entri asli: ' }), koreksiAsal.no + ' · ' + D.tglPanjang(koreksiAsal.tgl) + ' · ' + (koreksiAsal.memo || 'tanpa memo'),
        h('div', { class: 'small' }, koreksiAsal.baris.map(function (b) {
          return D.akun(b.akun).kode + ' ' + (b.d ? 'D ' + D.rupiah(b.d) : 'K ' + D.rupiah(b.k)) + '  ';
        }).join(''))));
    }

    var ctl = h('div', { class: 'controls' });
    var tglI = tanggalInput(e.tgl,
      { min: '2024-12-01', max: '2026-12-31', 'data-fkey': 'ju:tgl' },
      function (v) { e.tgl = v; lupakanPesan(); renderPanel('jurnal'); },
      function () { return e.tgl; });
    ctl.appendChild(field('Tanggal', tglI));

    var jenisOpsi = [{ value: 'umum', label: 'Jurnal umum' }];
    if (D.bolehkah(state.peran, 'penyesuaian')) jenisOpsi.push({ value: 'penyesuaian', label: 'Jurnal penyesuaian' });
    if (D.bolehkah(state.peran, 'penutup')) jenisOpsi.push({ value: 'penutup', label: 'Jurnal penutup' });
    if (koreksiAsal) jenisOpsi = [{ value: 'koreksi', label: 'Jurnal koreksi' }];
    ctl.appendChild(field('Jenis', select(jenisOpsi, koreksiAsal ? 'koreksi' : e.jenis, function (v) {
      e.jenis = v; lupakanPesan(); renderPanel('jurnal');
    }, { 'data-fkey': 'ju:jenis' })));

    var memoI = h('input', { type: 'text', value: e.memo, placeholder: 'Keterangan transaksi', style: 'width:100%', 'data-fkey': 'ju:memo' });
    memoI.addEventListener('input', function () { e.memo = memoI.value; });
    ctl.appendChild(field('Memo', memoI, 'field-cari'));
    card.appendChild(ctl);

    card.appendChild(h('div', { class: 'jhead' },
      h('span', { text: 'Akun' }), h('span', { text: 'Debit' }), h('span', { text: 'Kredit' }), h('span')));

    e.baris.forEach(function (b, i) {
      var row = h('div', { class: 'jbaris' });
      row.appendChild(select(opsiAkun(), b.akun, function (v) {
        b.akun = v; lupakanPesan(); renderPanel('jurnal');
      }, { 'data-fkey': 'ju:akun:' + i, 'aria-label': 'Akun baris ' + (i + 1), class: 'j-akun' }));
      /* Real per-row labels for the two amount fields, shown only on the narrow
       * layout where .jhead's column headers are display:none. They used to be
       * unlabelled there apart from a faint grey placeholder — and a placeholder
       * is not a label: it is the first thing to disappear the moment anything is
       * typed, and it was the only thing distinguishing the debit column from the
       * credit column on a phone. aria-hidden because each input already carries
       * its own aria-label; this is for people who can see the screen. */
      row.appendChild(h('span', { class: 'jlbl jlbl-d', 'aria-hidden': 'true', text: 'Debit' }));
      row.appendChild(numInput(b.d, function (v) {
        b.d = v;
        /* Typing into one side clears the other: a line carrying both a debit and
         * a credit is refused, and silently letting the user build one and then
         * refusing it is worse than not letting them build it. */
        if (v > 0) b.k = 0;
        lupakanPesan(); renderPanel('jurnal');
      }, { 'data-fkey': 'ju:d:' + i, placeholder: 'debit', 'aria-label': 'Debit baris ' + (i + 1), class: 'j-debit' }));
      row.appendChild(h('span', { class: 'jlbl jlbl-k', 'aria-hidden': 'true', text: 'Kredit' }));
      row.appendChild(numInput(b.k, function (v) {
        b.k = v;
        if (v > 0) b.d = 0;
        lupakanPesan(); renderPanel('jurnal');
      }, { 'data-fkey': 'ju:k:' + i, placeholder: 'kredit', 'aria-label': 'Kredit baris ' + (i + 1), class: 'j-kredit' }));
      row.appendChild(h('button', {
        class: 'btn small ghost hapus j-hapus', type: 'button', 'data-fkey': 'ju:hapus:' + i,
        'aria-label': 'Hapus baris ' + (i + 1), title: 'Hapus baris ' + (i + 1),
        disabled: e.baris.length <= 2 ? true : null,
        onclick: function () {
          e.baris.splice(i, 1);
          if (e.baris.length < 2) e.baris.push(barisKosong());
          lupakanPesan();
          state.fokusKe = 'ju:tambah';
          renderPanel('jurnal');
        }
      }, '×'));
      card.appendChild(row);
    });

    card.appendChild(h('div', { class: 'row-between no-print', style: 'margin-top:8px' },
      h('div', { class: 'chips' },
        h('button', {
          class: 'btn small', type: 'button', 'data-fkey': 'ju:tambah',
          onclick: function () { e.baris.push(barisKosong()); lupakanPesan(); renderPanel('jurnal'); }
        }, '+ Baris'),
        h('button', {
          class: 'btn small ghost', type: 'button', 'data-fkey': 'ju:kosongkan',
          onclick: function () {
            state.entri = { tgl: e.tgl, jenis: e.jenis, memo: '', baris: [barisKosong(), barisKosong(), barisKosong(), barisKosong()] };
            state.koreksiUntuk = null;
            lupakanPesan(); renderPanel('jurnal');
          }
        }, 'Kosongkan'),
        koreksiAsal ? h('button', {
          class: 'btn small ghost', type: 'button', 'data-fkey': 'ju:batalKoreksi',
          onclick: function () { state.koreksiUntuk = null; lupakanPesan(); renderPanel('jurnal'); }
        }, 'Batalkan koreksi') : null)));

    /* The live balance. The one readout in this app that must be impossible to
     * miss, because it is the difference between an entry that can be posted and
     * one that cannot. */
    var seimbang = t.selisih === 0 && t.d > 0;
    card.appendChild(h('div', { class: 'timbang' + (seimbang ? '' : ' pincang') },
      h('div', null, h('div', { class: 'lbl', text: 'Total debit' }), h('div', { class: 'angka', text: D.rupiah(t.d) })),
      h('div', null, h('div', { class: 'lbl', text: 'Total kredit' }), h('div', { class: 'angka', text: D.rupiah(t.k) })),
      h('div', null, h('div', { class: 'lbl', text: 'Selisih' }), h('div', { class: 'angka', text: D.rupiah(t.selisih) })),
      h('div', { class: 'verdict' + (seimbang ? ' ok' : '') },
        seimbang ? '✓ SEIMBANG'
          : (t.d === 0 && t.k === 0 ? 'belum ada nilai'
            : 'sisi ' + (t.selisih > 0 ? 'kredit' : 'debit') + ' kurang ' + D.rupiah(Math.abs(t.selisih))))));

    /* Validate live, against the engine, so the button's state and the refusal
     * message come from the same source as the posting itself. */
    var spec = {
      tgl: e.tgl, jenis: koreksiAsal ? 'koreksi' : e.jenis, memo: e.memo,
      ref: koreksiAsal ? koreksiAsal.id : null, baris: e.baris
    };
    var v = L.periksaEntri(buku(), spec, { peran: state.peran });
    var kunci = D.isTanggal(e.tgl) ? L.terkunci(buku(), e.tgl) : null;

    var aksi = h('div', { class: 'row-between no-print', style: 'margin-top:10px' });
    var kiri = h('div', { class: 'chips' });
    if (boleh('posting')) {
      kiri.appendChild(h('button', {
        class: 'btn primary', type: 'button', 'data-fkey': 'ju:posting', disabled: v.ok ? null : true,
        onclick: function () { postingEntri(spec, koreksiAsal); }
      }, koreksiAsal ? 'Posting pembalik + koreksi' : 'Posting ke buku'));
    }
    /* A staf gets the same editor and the same balance check, and their work goes
     * to a draft queue instead of the book. Hiding the form from them would just
     * mean the entry gets typed on somebody else's login. */
    kiri.appendChild(h('button', {
      class: 'btn' + (boleh('posting') ? ' ghost' : ' primary'), type: 'button', 'data-fkey': 'ju:draf',
      disabled: seimbang && D.isTanggal(e.tgl) ? null : true,
      onclick: function () { simpanDraf(spec); }
    }, 'Simpan sebagai draf'));
    aksi.appendChild(kiri);
    card.appendChild(aksi);

    if (!boleh('posting')) {
      card.appendChild(h('div', { class: 'callout warn wrap-normal' },
        h('b', { text: 'Tidak bisa memposting. ' }), alasanTakBoleh('posting'),
        ' Draf tetap bisa disimpan, dan akuntan bisa mempostingnya dari daftar di bawah.'));
    }
    if (kunci) {
      card.appendChild(h('div', { class: 'callout bad wrap-normal' },
        h('b', { text: 'Periode ' + D.periodeNama(D.periodeDari(e.tgl)) + ' terkunci. ' }),
        'Ditutup ' + kunci.pada + ' oleh ' + kunci.oleh + '. Entri bertanggal di dalamnya ditolak — dan ditolak oleh mesinnya, bukan oleh tombol yang disembunyikan. Hanya supervisor yang boleh membukanya, di tab Penutup & Periode.'));
    }
    if (!v.ok && (t.d > 0 || t.k > 0)) {
      var ul = h('ul');
      v.alasan.forEach(function (x) { ul.appendChild(h('li', { class: 'wrap-normal', text: x })); });
      card.appendChild(h('div', { class: 'tolak' }, h('b', { text: 'Entri ini akan ditolak: ' }), ul));
    }

    p.appendChild(card);
  }

  function postingEntri(spec, koreksiAsal) {
    try {
      var hasil;
      if (koreksiAsal) {
        hasil = L.koreksi(buku(), koreksiAsal.id, { tgl: spec.tgl, memo: spec.memo, baris: spec.baris },
          { peran: state.peran, oleh: state.peran, sumber: 'pengguna' });
        simpanEntri(hasil.pembalik); simpanEntri(hasil.koreksi);
        pesanOk('Koreksi diposting sebagai dua dokumen.', [
          'Pembalik ' + hasil.pembalik.no + ' menghapus pengaruh ' + koreksiAsal.no + '.',
          'Koreksi ' + hasil.koreksi.no + ' memuat angka penggantinya.',
          'Entri asli ' + koreksiAsal.no + ' tetap ada di buku, apa adanya. Buku ini tidak pernah menghapus.'
        ]);
        say('Koreksi diposting: ' + hasil.pembalik.no + ' dan ' + hasil.koreksi.no + '. Entri asli ' + koreksiAsal.no + ' tetap ada.');
        state.koreksiUntuk = null;
      } else {
        var e = L.tambah(buku(), spec, { peran: state.peran, oleh: state.peran });
        simpanEntri(e);
        var t = totalEntri(e);
        pesanOk('Entri ' + e.no + ' diposting.', [
          D.tglPanjang(e.tgl) + ' · ' + (D.jenis(e.jenis) || {}).label + ' · ' + e.baris.length + ' baris',
          'Debit ' + D.rupiah(t.d) + ' = kredit ' + D.rupiah(t.k) + '.',
          'Saldo akun, neraca saldo dan keempat laporan sudah dihitung ulang — tidak ada yang di-cache untuk di-invalidasi.'
        ]);
        say('Entri ' + e.no + ' diposting, debit ' + D.rupiah(t.d) + ' sama dengan kredit.');
      }
      state.entri = { tgl: spec.tgl, jenis: spec.jenis === 'koreksi' ? 'umum' : spec.jenis, memo: '', baris: [barisKosong(), barisKosong(), barisKosong(), barisKosong()] };
      invalidate();
      St.audit({ aksi: koreksiAsal ? 'koreksi' : 'posting', peran: state.peran, tgl: spec.tgl });
      state.fokusKe = 'ju:tgl';
      renderAll();
    } catch (err) {
      var isi = err.tolak ? err.tolak.alasan : [String(err && err.message || err)];
      pesanTolak('Entri DITOLAK, dan tidak ada apa pun yang masuk buku.', isi);
      say('Entri ditolak. ' + isi.join(' '));
      renderPanel('jurnal');
    }
  }

  function simpanDraf(spec) {
    var id = 'DR' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
    var rec = {
      id: id, tgl: spec.tgl, jenis: spec.jenis, memo: spec.memo,
      baris: spec.baris.filter(function (b) { return b.akun && (b.d || b.k); }).map(function (b) { return { akun: b.akun, d: b.d || 0, k: b.k || 0 }; }),
      oleh: state.peran
    };
    state.draf.push(rec);
    St.put('draf', { k: id, v: rec });
    pesanOk('Draf disimpan.', [
      'Draf TIDAK masuk buku, jadi tidak muncul di neraca saldo maupun di laporan mana pun.',
      'Akuntan atau supervisor bisa mempostingnya dari daftar draf di bawah.'
    ]);
    say('Draf disimpan. Draf tidak masuk buku sampai akuntan mempostingnya.');
    state.entri = { tgl: spec.tgl, jenis: spec.jenis, memo: '', baris: [barisKosong(), barisKosong(), barisKosong(), barisKosong()] };
    renderPanel('jurnal');
  }

  function renderDraf(p) {
    if (!state.draf.length) return;
    var card = h('div', { class: 'card' },
      h('h3', { text: 'Draf menunggu posting — ' + state.draf.length }),
      h('p', { class: 'note wrap-normal', text: 'Draf bukan bagian dari buku. Ia tidak punya nomor dokumen, tidak muncul di buku besar, tidak menyentuh neraca saldo dan tidak mengubah satu pun angka di laporan. Itulah arti pemisahan peran di sini: seorang staf tidak bisa menaruh angka di laporan keuangan sendirian.' }));
    var rows = state.draf.map(function (dr, i) {
      var td = dr.baris.reduce(function (s, b) { return s + b.d; }, 0);
      var v = L.periksaEntri(buku(), { tgl: dr.tgl, jenis: dr.jenis, memo: dr.memo, baris: dr.baris }, { peran: state.peran });
      return h('tr', null,
        h('td', null, h('span', { class: 'mono', text: D.tglPendek(dr.tgl) })),
        h('td', null, badgeJenis(dr.jenis)),
        h('td', { class: 'wrap-normal' }, dr.memo || h('span', { class: 'hint', text: 'tanpa memo' }),
          h('div', { class: 'small mono' }, dr.baris.map(function (b) { return b.akun + (b.d ? ' D' : ' K') + D.angka(b.d || b.k); }).join(' · '))),
        h('td', { class: 'mono small', text: dr.oleh }),
        tdRp(td),
        h('td', { class: 'no-print' },
          boleh('posting')
            ? h('button', {
              class: 'btn small primary', type: 'button', 'data-fkey': 'dr:post:' + i, disabled: v.ok ? null : true,
              title: v.ok ? 'Posting draf ini ke buku' : v.alasan.join(' | '),
              onclick: function () {
                try {
                  var e = L.tambah(buku(), { tgl: dr.tgl, jenis: dr.jenis, memo: dr.memo + ' (dari draf ' + dr.oleh + ')', baris: dr.baris },
                    { peran: state.peran, oleh: state.peran });
                  simpanEntri(e);
                  state.draf.splice(i, 1);
                  St.del('draf', dr.id);
                  invalidate();
                  pesanOk('Draf diposting sebagai ' + e.no + '.', ['Sekarang ia bagian dari buku, dan ikut ke neraca saldo dan keempat laporan.']);
                  say('Draf diposting sebagai ' + e.no + '.');
                  renderAll();
                } catch (err) {
                  pesanTolak('Draf ditolak saat diposting.', err.tolak ? err.tolak.alasan : [String(err && err.message || err)]);
                  renderPanel('jurnal');
                }
              }
            }, 'Posting')
            : h('span', { class: 'hint small wrap-normal', text: 'butuh akuntan' }),
          h('button', {
            class: 'btn small ghost', type: 'button', 'data-fkey': 'dr:hapus:' + i, style: 'margin-left:4px',
            onclick: function () {
              state.draf.splice(i, 1); St.del('draf', dr.id);
              say('Draf dibuang.');
              state.fokusKe = 'ju:tgl';
              renderPanel('jurnal');
            }
          }, 'Buang')));
    });
    card.appendChild(tableOf(['Tanggal', 'Jenis', 'Draf', 'Oleh', { label: 'Nilai', num: true }, ''], rows, { minWidth: '640px' }));
    p.appendChild(card);
  }

  function renderJurnal(p) {
    renderEditor(p);
    renderDraf(p);

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Jurnal umum' }));
    card.appendChild(h('p', { class: 'note wrap-normal', text: 'Append-only. Tidak ada tombol hapus dan tidak ada tombol ubah di seluruh aplikasi ini — yang ada adalah jurnal pembalik dan jurnal koreksi, dan keduanya menambah dokumen, tidak mengganti dokumen. Status “sudah dibalik” pun diturunkan dengan mencari entri yang menunjuk sebuah entri, bukan dari flag yang ditempelkan padanya.' }));

    var ctl = h('div', { class: 'controls' });
    var inp = h('input', { class: 'cari', type: 'search', value: state.sel.juCari, placeholder: 'Cari nomor, memo atau kode akun…', 'data-fkey': 'ju:cari' });
    inp.addEventListener('input', function () { state.sel.juCari = inp.value; renderPanel('jurnal'); });
    ctl.appendChild(field('Cari', inp, 'field-cari'));
    ctl.appendChild(field('Jenis', select(
      [{ value: 'semua', label: 'Semua jenis' }].concat(D.JENIS.map(function (j) { return { value: j.id, label: j.label }; })),
      state.sel.juFilter, function (v) { state.sel.juFilter = v; renderPanel('jurnal'); }, { 'data-fkey': 'ju:filter' })));
    card.appendChild(ctl);

    var cari = state.sel.juCari.toLowerCase();
    var semua = L.urut(buku().entries).slice().reverse().filter(function (e) {
      if (state.sel.juFilter !== 'semua' && e.jenis !== state.sel.juFilter) return false;
      if (!cari) return true;
      if (e.no.toLowerCase().indexOf(cari) >= 0) return true;
      if ((e.memo || '').toLowerCase().indexOf(cari) >= 0) return true;
      return e.baris.some(function (b) { return b.akun.indexOf(cari) >= 0 || D.akun(b.akun).nama.toLowerCase().indexOf(cari) >= 0; });
    });
    var tampil = semua.slice(0, state.sel.juBatas);

    var rows = [];
    tampil.forEach(function (e) {
      var t = totalEntri(e);
      var dibalik = L.pembalikDari(buku(), e.id);
      var dikoreksi = L.koreksiDari(buku(), e.id);
      var asal = e.ref ? L.cari(buku(), e.ref) : null;
      var buka = !!state.sel.juBuka[e.id];
      rows.push(h('tr', { class: buka ? 'sel' : null },
        h('td', null, h('button', {
          class: 'linkbtn dok', type: 'button', 'data-fkey': 'ju:buka:' + e.id,
          'aria-expanded': buka ? 'true' : 'false',
          onclick: function () {
            state.sel.juBuka[e.id] = !buka;
            renderPanel('jurnal');
          }
        }, (buka ? '▾ ' : '▸ ') + e.no)),
        h('td', null, h('span', { class: 'mono', text: D.tglPendek(e.tgl) })),
        h('td', null, badgeJenis(e.jenis)),
        h('td', { class: 'wrap-normal' },
          e.memo || h('span', { class: 'hint', text: 'tanpa memo' }),
          asal ? h('div', { class: 'small' }, 'acuan: ', h('span', { class: 'dok', text: asal.no })) : null,
          dibalik ? h('div', { class: 'small' }, h('span', { class: 'pill warn', text: 'dibalik oleh ' + dibalik.no })) : null,
          dikoreksi.length ? h('div', { class: 'small' }, h('span', { class: 'pill info', text: 'dikoreksi oleh ' + dikoreksi.map(function (x) { return x.no; }).join(', ') })) : null),
        h('td', { class: 'num', text: String(e.baris.length) }),
        tdRp(t.d),
        h('td', { class: 'no-print' },
          boleh('pembalik') && !dibalik
            ? h('button', {
              class: 'btn small ghost', type: 'button', 'data-fkey': 'ju:balik:' + e.id,
              title: 'Posting jurnal pembalik atas ' + e.no + ' — entri aslinya tetap ada',
              onclick: function () { balikEntri(e); }
            }, 'Balik')
            : null,
          boleh('koreksi')
            ? h('button', {
              class: 'btn small ghost', type: 'button', style: 'margin-left:4px', 'data-fkey': 'ju:koreksi:' + e.id,
              title: 'Susun jurnal koreksi atas ' + e.no,
              onclick: function () {
                state.koreksiUntuk = e.id;
                state.entri = {
                  tgl: state.sampai, jenis: 'koreksi', memo: '',
                  baris: e.baris.map(function (b) { return { akun: b.akun, d: b.d, k: b.k }; })
                };
                lupakanPesan();
                state.fokusKe = 'ju:d:0';
                renderPanel('jurnal');
                try { $('panel-jurnal').scrollIntoView({ block: 'start' }); } catch (e2) { }
              }
            }, 'Koreksi')
            : null)));
      if (buka) {
        e.baris.forEach(function (b) {
          var a = D.akun(b.akun);
          rows.push(h('tr', { class: 'sel' },
            h('td'),
            h('td', null, h('span', { class: 'kode', text: b.akun })),
            h('td', { class: 'wrap-normal', colspan: '2' },
              h('span', { style: b.k ? 'padding-left:18px' : '' , text: a.nama }),
              b.catatan ? h('div', { class: 'small', text: b.catatan }) : null),
            h('td', { class: 'num rp', text: b.d ? D.rupiah(b.d) : '' }),
            h('td', { class: 'num rp', text: b.k ? D.rupiah(b.k) : '' }),
            h('td')));
        });
        rows.push(h('tr', { class: 'jumlahbaris' },
          h('td'), h('td'), h('td', { colspan: '2', text: 'Jumlah entri ' + e.no }),
          h('td', { class: 'num rp', text: D.rupiah(t.d) }),
          h('td', { class: 'num rp', text: D.rupiah(t.k) }),
          h('td', null, h('span', { class: 'pill ok', text: 'seimbang' }))));
      }
    });

    card.appendChild(tableOf(['Nomor', 'Tanggal', 'Jenis', 'Keterangan', { label: 'Baris', num: true }, { label: 'Nilai', num: true }, ''], rows, { minWidth: '760px' }));
    if (semua.length > tampil.length) {
      card.appendChild(h('div', { class: 'row-between no-print', style: 'margin-top:8px' },
        h('span', { class: 'hint', text: 'Menampilkan ' + tampil.length + ' dari ' + semua.length + ' entri (terbaru dulu).' }),
        h('button', {
          class: 'btn small', type: 'button', 'data-fkey': 'ju:lebih',
          onclick: function () { state.sel.juBatas += 60; renderPanel('jurnal'); }
        }, 'Tampilkan 60 lagi')));
    } else {
      card.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: semua.length + ' entri cocok dengan filter ini, dari ' + buku().entries.length + ' entri di buku.' }));
    }
    p.appendChild(card);
  }

  function balikEntri(e) {
    try {
      var b = L.pembalik(buku(), e.id, state.sampai, { peran: state.peran, oleh: state.peran, sumber: 'pengguna' });
      simpanEntri(b);
      invalidate();
      St.audit({ aksi: 'pembalik', peran: state.peran, atas: e.no });
      pesanOk('Jurnal pembalik ' + b.no + ' diposting.', [
        'Entri asli ' + e.no + ' TETAP ada di buku, dengan angkanya yang semula. Tidak ada yang dihapus dan tidak ada flag yang ditempel padanya.',
        'Status “sudah dibalik” diturunkan dengan mencari entri yang menunjuk ' + e.no + ' — itu sebabnya ia tidak bisa dibalik dua kali.'
      ]);
      say('Pembalik ' + b.no + ' diposting. Entri asli ' + e.no + ' tetap ada.');
      renderAll();
    } catch (err) {
      pesanTolak('Pembalik ditolak.', err.tolak ? err.tolak.alasan : [String(err && err.message || err)]);
      renderPanel('jurnal');
    }
  }

  /* ============================================================ buku besar */

  function renderBesar(p) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Buku besar' }));
    card.appendChild(h('p', { class: 'note wrap-normal', text: 'Saldo berjalan, baris demi baris. Baris pertama adalah saldo awal periode — dihitung dari posting sebelum tanggal mulai, bukan diambil dari field saldo, karena tidak ada field saldo. Saldo akhir di bawah dicek ulang terhadap saldo akun yang dihitung lewat jalur terpisah; kalau keduanya beda, invarian I7 di header akan merah sebelum Anda sampai ke sini.' }));

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(field('Akun', select(
      D.AKUN.map(function (a) { return { value: a.kode, label: a.kode + ' ' + a.nama }; }),
      state.sel.bbAkun, function (v) { state.sel.bbAkun = v; renderPanel('besar'); }, { 'data-fkey': 'bb:akun' }), 'field-cari'));
    var d1 = tanggalInput(state.sel.bbDari,
      { min: '2024-12-01', max: '2026-12-31', 'data-fkey': 'bb:dari' },
      function (v) { state.sel.bbDari = v; renderPanel('besar'); },
      function () { return state.sel.bbDari; });
    ctl.appendChild(field('Dari', d1));
    var d2 = tanggalInput(state.sel.bbSampai,
      { min: '2024-12-01', max: '2026-12-31', 'data-fkey': 'bb:sampai' },
      function (v) { state.sel.bbSampai = v; renderPanel('besar'); },
      function () { return state.sel.bbSampai; });
    ctl.appendChild(field('Sampai', d2));
    card.appendChild(ctl);

    var bb = L.bukuBesar(buku(), state.sel.bbAkun, { dari: state.sel.bbDari, sampai: state.sel.bbSampai });
    var cek = L.saldoAkun(buku(), state.sel.bbAkun, { sampai: state.sel.bbSampai });

    card.appendChild(h('div', { class: 'row-between' },
      h('div', null,
        h('h4', { class: 'wrap-normal' }, h('span', { class: 'kode', text: bb.akun.kode }), ' ' + bb.akun.nama),
        h('div', { class: 'small' }, badgeTipe(bb.akun.tipe), ' saldo normal ' + (bb.akun.normal === 'D' ? 'debit' : 'kredit'),
          bb.akun.kontra ? h('span', { class: 'pill warn', style: 'margin-left:6px', text: 'akun kontra' }) : null)),
      h('div', { class: 'stack', style: 'text-align:right' },
        h('div', { class: 'lbl small', text: 'Saldo akhir' }),
        h('div', { class: 'rp', style: 'font-size:19px', text: D.rupiah(bb.saldoAkhir) }))));

    var rows = [h('tr', { class: 'nolbaris' },
      h('td', { class: 'mono', text: D.tglPendek(state.sel.bbDari) }),
      h('td', { colspan: '3', text: 'Saldo awal periode' }),
      h('td'), h('td'),
      h('td', { class: 'num rp', text: D.rupiah(bb.saldoAwal) }))];
    bb.baris.forEach(function (r) {
      rows.push(h('tr', null,
        h('td', { class: 'mono', text: D.tglPendek(r.tgl) }),
        h('td', null, h('span', { class: 'dok', text: r.no })),
        h('td', null, badgeJenis(r.jenis)),
        h('td', { class: 'wrap-normal' }, r.memo || r.catatan || '—',
          r.lawan.length ? h('div', { class: 'small mono', text: 'lawan: ' + r.lawan.join(', ') }) : null),
        h('td', { class: 'num rp', text: r.debit ? D.rupiah(r.debit) : '' }),
        h('td', { class: 'num rp', text: r.kredit ? D.rupiah(r.kredit) : '' }),
        h('td', { class: 'num rp', text: D.rupiah(r.saldo) })));
    });
    rows.push(h('tr', { class: 'jumlahbaris' },
      h('td', { colspan: '4', text: 'Jumlah mutasi ' + bb.baris.length + ' baris' }),
      h('td', { class: 'num rp', text: D.rupiah(bb.jumlahDebit) }),
      h('td', { class: 'num rp', text: D.rupiah(bb.jumlahKredit) }),
      h('td', { class: 'num rp', text: D.rupiah(bb.saldoAkhir) })));
    card.appendChild(tableOf(['Tanggal', 'Nomor', 'Jenis', 'Keterangan', { label: 'Debit', num: true }, { label: 'Kredit', num: true }, { label: 'Saldo', num: true }], rows, { minWidth: '780px' }));

    card.appendChild(h('div', { class: 'rekon' },
      rekonBaris('Saldo awal periode', bb.saldoAwal),
      rekonBaris('Jumlah debit', bb.jumlahDebit),
      rekonBaris('Jumlah kredit', bb.jumlahKredit),
      rekonBaris('Saldo akhir menurut saldo berjalan', bb.saldoAkhir, null, 'total'),
      h('div', { class: 'rekon-baris sisa' + (bb.saldoAkhir === cek.saldo ? '' : ' rusak') },
        h('span', { class: 'wrap-normal', text: 'Selisih terhadap saldo akun yang dihitung ulang lewat jalur terpisah' }),
        h('span', { class: 'n', text: D.rupiah(bb.saldoAkhir - cek.saldo) }))));
    p.appendChild(card);
  }

  /* ========================================================== neraca saldo */

  function renderSaldo(p) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Neraca saldo — sebelum penyesuaian, setelah penyesuaian, setelah penutupan' }));
    card.appendChild(h('p', { class: 'note wrap-normal' },
      'Tiga tahap berdampingan, supaya satu akun bisa diikuti melintasi ketiganya — dan supaya akun nominal ' +
      'bisa dilihat jatuh ke nol di kolom terakhir. Kedua kolom setiap tahap dijumlah dari posting mentah, ' +
      'bukan dari nol yang ditulis tangan: kalau ada yang salah, angkanya akan benar-benar selisih. ',
      h('b', { text: 'Yang membedakan tahapnya bukan tanggal, tapi jenis jurnalnya' }),
      ' — dan pembalik atas sebuah jurnal penyesuaian ikut dihitung sebagai penyesuaian, kalau tidak kolom ' +
      '“sebelum” akan memuat pembatalannya tanpa memuat yang dibatalkan.'));

    var tahap = ['sebelum', 'setelah', 'penutup'];
    var ns = {};
    tahap.forEach(function (t) { ns[t] = L.neracaSaldo(buku(), { sampai: state.sampai, tahap: t, semuaAkun: state.sel.nsNolPun }); });

    var ctl = h('div', { class: 'controls' });
    ctl.appendChild(h('button', {
      class: 'btn small', type: 'button', 'aria-pressed': state.sel.nsNolPun ? 'true' : 'false', 'data-fkey': 'ns:tahap',
      onclick: function () { state.sel.nsNolPun = !state.sel.nsNolPun; renderPanel('saldo'); }
    }, state.sel.nsNolPun ? 'Sembunyikan akun bersaldo nol' : 'Tampilkan semua akun bagan'));
    card.appendChild(ctl);

    var sum = h('div', { class: 'summary' });
    tahap.forEach(function (t) {
      var x = ns[t];
      sum.appendChild(stat(
        t === 'sebelum' ? 'Sebelum penyesuaian' : t === 'setelah' ? 'Setelah penyesuaian' : 'Setelah penutupan',
        D.rupiah(x.totalDebit),
        x.seimbang ? 'debit = kredit, selisih Rp0' : 'SELISIH ' + D.rupiah(x.selisih)));
    });
    card.appendChild(sum);

    var rows = [];
    D.TIPE.forEach(function (tipe) {
      var akun = D.akunTipe(tipe).filter(function (a) {
        return tahap.some(function (t) {
          return ns[t].baris.some(function (r) { return r.akun.kode === a.kode; });
        });
      });
      if (!akun.length) return;
      rows.push(h('tr', { class: 'grupbaris' }, h('td', { colspan: '8', text: tipe })));
      akun.forEach(function (a) {
        function cel(t, sisi) {
          var r = null;
          ns[t].baris.forEach(function (x) { if (x.akun.kode === a.kode) r = x; });
          if (!r) return h('td', { class: 'num', text: '' });
          var v = sisi === 'd' ? r.debit : r.kredit;
          return h('td', { class: 'num rp' + (v === 0 ? ' nol' : ''), text: v === 0 ? '—' : D.angka(v) });
        }
        var nolDiPenutup = D.isNominal(a);
        rows.push(h('tr', { class: nolDiPenutup ? 'nolbaris' : null },
          h('td', null, h('span', { class: 'kode', text: a.kode })),
          h('td', { class: 'wrap-normal' }, a.nama, a.kontra ? h('span', { class: 'pill warn', style: 'margin-left:5px', text: 'kontra' }) : null,
            D.isNominal(a) ? h('span', { class: 'pill', style: 'margin-left:5px', text: 'nominal' }) : null),
          cel('sebelum', 'd'), cel('sebelum', 'k'),
          cel('setelah', 'd'), cel('setelah', 'k'),
          cel('penutup', 'd'), cel('penutup', 'k')));
      });
    });
    rows.push(h('tr', { class: 'jumlahbaris' },
      h('td', { colspan: '2', text: 'JUMLAH' }),
      h('td', { class: 'num rp', text: D.angka(ns.sebelum.totalDebit) }),
      h('td', { class: 'num rp', text: D.angka(ns.sebelum.totalKredit) }),
      h('td', { class: 'num rp', text: D.angka(ns.setelah.totalDebit) }),
      h('td', { class: 'num rp', text: D.angka(ns.setelah.totalKredit) }),
      h('td', { class: 'num rp', text: D.angka(ns.penutup.totalDebit) }),
      h('td', { class: 'num rp', text: D.angka(ns.penutup.totalKredit) })));
    rows.push(h('tr', null,
      h('td', { colspan: '2', text: 'Selisih debit − kredit' }),
      h('td', { class: 'num rp', colspan: '2', text: D.rupiah(ns.sebelum.selisih) }),
      h('td', { class: 'num rp', colspan: '2', text: D.rupiah(ns.setelah.selisih) }),
      h('td', { class: 'num rp', colspan: '2', text: D.rupiah(ns.penutup.selisih) })));

    var wrap = h('div', { class: 'tigaKolom' }, tableOf(
      ['Kode', 'Nama akun',
        { label: 'Sblm: debit', num: true }, { label: 'Sblm: kredit', num: true },
        { label: 'Stlh: debit', num: true }, { label: 'Stlh: kredit', num: true },
        { label: 'Ttp: debit', num: true }, { label: 'Ttp: kredit', num: true }],
      rows, { minWidth: '860px' }));
    card.appendChild(wrap);

    var jpAda = L.pilih(buku(), { dari: AWAL, sampai: state.sampai, hanyaJenis: ['penyesuaian'] }).length;
    var jtAda = L.pilih(buku(), { dari: AWAL, sampai: state.sampai, hanyaJenis: ['penutup'], efektif: false }).length;
    card.appendChild(h('p', { class: 'hint wrap-normal', style: 'margin-top:8px' },
      jpAda ? (jpAda + ' jurnal penyesuaian sudah diposting, jadi kolom tengah benar-benar berbeda dari kolom kiri. ')
        : 'Belum ada jurnal penyesuaian yang diposting, jadi kolom kiri dan kolom tengah masih identik — buka tab Penyesuaian dan posting kelimanya untuk melihat keduanya berpisah. ',
      jtAda ? (jtAda + ' jurnal penutup sudah diposting: setiap akun nominal di kolom kanan bernilai nol.')
        : 'Belum ada jurnal penutup, jadi kolom kanan masih sama dengan kolom tengah. Tutup bukunya di tab Penutup & Periode dan lihat semua akun nominal jatuh ke nol tanpa satu pun angka neraca bergeser.'));
    p.appendChild(card);
  }

  /* =========================================================== penyesuaian */

  function renderSesuai(p) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Jurnal penyesuaian' }));
    card.appendChild(h('p', { class: 'note wrap-normal', text: 'Keenam rencana di bawah dihitung dari register — jadwal aset tetap, kontrak sewa dan asuransi, kontrak jasa dibayar di muka, daftar akrual, register pinjaman — bukan diketik. Masing-masing membawa rumusnya, jadi angkanya bisa diperiksa, bukan sekadar dipercaya. Tidak ada yang diposting sampai Anda mempostingnya, dan setiap rencana masuk lewat pintu yang sama dengan entri manual: kalau tidak seimbang, ia ditolak sama saja.' }));

    if (!D.bolehkah(state.peran, 'penyesuaian')) {
      card.appendChild(h('div', { class: 'callout warn wrap-normal' },
        h('b', { text: 'Peran ini tidak berwenang memposting jurnal penyesuaian. ' }), alasanTakBoleh('penyesuaian'),
        ' Rencananya tetap ditampilkan lengkap dengan angkanya — aturan yang tidak bisa dilihat tidak bisa dikerjakan.'));
    }

    var rencana = A.semuaRencana(state.db, AWAL, AKHIR);
    var belum = rencana.filter(function (r) { return !r.kosong && !A.sudahDiposting(buku(), r, AWAL, AKHIR); });

    card.appendChild(h('div', { class: 'row-between no-print' },
      h('span', { class: 'hint wrap-normal', text: belum.length ? belum.length + ' rencana belum diposting.' : 'Seluruh rencana penyesuaian sudah diposting.' }),
      h('button', {
        class: 'btn primary', type: 'button', 'data-fkey': 'js:semua',
        disabled: (boleh('penyesuaian') && belum.length) ? null : true,
        onclick: function () {
          try {
            var hasil = A.postingSemua(state.db, AWAL, AKHIR, { peran: state.peran, oleh: state.peran, sumber: 'pengguna' });
            hasil.forEach(function (x) { simpanEntri(x.entry); });
            invalidate();
            St.audit({ aksi: 'penyesuaian', peran: state.peran, jumlah: hasil.length });
            pesanOk(hasil.length + ' jurnal penyesuaian diposting.', hasil.map(function (x) {
              return x.entry.no + ' — ' + x.rencana.judul + ' ' + D.rupiah(x.rencana.jumlah);
            }).concat(['Neraca saldo sekarang punya dua kolom yang benar-benar berbeda. Laba turun, dan ketujuh invarian tetap hijau.']));
            say(hasil.length + ' jurnal penyesuaian diposting.');
            renderAll();
          } catch (err) {
            pesanTolak('Posting penyesuaian ditolak.', err.tolak ? err.tolak.alasan : [String(err && err.message || err)]);
            renderPanel('sesuai');
          }
        }
      }, 'Posting semua penyesuaian')));
    p.appendChild(card);

    rencana.forEach(function (r, i) {
      var sudah = A.sudahDiposting(buku(), r, AWAL, AKHIR);
      var box = h('div', { class: 'rencana' + (sudah ? ' sudah' : '') + (r.kosong ? ' kosong' : '') });
      box.appendChild(h('div', { class: 'row-between' },
        h('div', { style: 'min-width:0' },
          h('div', { class: 'judul wrap-normal', text: (sudah ? '✓ ' : '') + r.judul }),
          h('div', { class: 'sub2 wrap-normal', text: r.subjudul })),
        h('div', { style: 'text-align:right' },
          h('div', { class: 'nilai', text: D.rupiah(r.jumlah) }),
          sudah ? h('span', { class: 'dok', text: sudah.no }) : null)));
      box.appendChild(h('p', { class: 'note wrap-normal', style: 'margin:8px 0 6px', text: r.dasar }));

      if (r.rincian && r.rincian.length) {
        var rrows = r.rincian.map(function (x) {
          var nama = x.aset ? (x.aset.id + ' ' + x.aset.nama)
            : x.kontrak ? (x.kontrak.id + ' ' + x.kontrak.nama)
              : x.akrual ? (x.akrual.id + ' ' + x.akrual.nama)
                : x.pinjaman ? (x.pinjaman.id + ' ' + x.pinjaman.nama) : '—';
          var nilai = x.jumlah !== undefined ? x.jumlah : (x.terpakai !== undefined ? x.terpakai : x.diakui);
          return h('tr', null,
            h('td', { class: 'wrap-normal' }, nama,
              x.aset ? h('div', { class: 'small', text: x.aset.metode + ', umur ' + x.aset.umurBulan + ' bulan, mulai ' + D.periodeNama(x.aset.mulai) }) : null,
              x.kontrak ? h('div', { class: 'small', text: x.kontrak.catatan }) : null,
              x.akrual ? h('div', { class: 'small', text: x.akrual.catatan }) : null,
            x.pinjaman ? h('div', { class: 'small', text: x.pinjaman.catatan }) : null),
            h('td', { class: 'wrap-normal rumus small', text: x.rumus }),
            tdRp(nilai),
            h('td', { class: 'num rp', text: x.sisa !== undefined ? D.rupiah(x.sisa) : '—' }));
        });
        box.appendChild(tableOf(['Sumber', 'Rumus', { label: 'Periode ini', num: true }, { label: 'Sisa', num: true }], rrows, { minWidth: '600px', mini: true }));
      }
      if (r.id === 'JP-PPHFINAL' && r.kosong) {
        box.appendChild(h('p', { class: 'hint wrap-normal', text: 'Kosong sekarang, dan itu memang benar: angsuran bulanannya sudah tepat 0,5% dari peredaran bruto sejauh ini. Rencana ini akan muncul dengan sendirinya begitu jurnal pendapatan diterima di muka diposting, karena jurnal itu menambah peredaran bruto SETELAH angsurannya dihitung.' }));
      }

      if (r.baris.length) {
        var brows = r.baris.map(function (b) {
          return h('tr', null,
            h('td', null, h('span', { class: 'kode', text: b.akun })),
            h('td', { class: 'wrap-normal' }, D.akun(b.akun).nama, b.catatan ? h('div', { class: 'small', text: b.catatan }) : null),
            h('td', { class: 'num rp', text: b.d ? D.rupiah(b.d) : '' }),
            h('td', { class: 'num rp', text: b.k ? D.rupiah(b.k) : '' }));
        });
        brows.push(h('tr', { class: 'jumlahbaris' },
          h('td', { colspan: '2', text: 'Jumlah' }),
          h('td', { class: 'num rp', text: D.rupiah(r.baris.reduce(function (s, x) { return s + (x.d || 0); }, 0)) }),
          h('td', { class: 'num rp', text: D.rupiah(r.baris.reduce(function (s, x) { return s + (x.k || 0); }, 0)) })));
        box.appendChild(tableOf(['Akun', 'Nama', { label: 'Debit', num: true }, { label: 'Kredit', num: true }], brows, { minWidth: '520px', mini: true }));
      }

      box.appendChild(h('div', { class: 'row-between no-print', style: 'margin-top:8px' },
        h('span', { class: 'hint', text: sudah ? 'Sudah diposting sebagai ' + sudah.no + ' pada ' + D.tglPanjang(sudah.tgl) : (r.kosong ? 'Tidak ada yang perlu diposting.' : 'Belum diposting.') }),
        h('button', {
          class: 'btn small primary', type: 'button', 'data-fkey': 'js:post:' + i,
          disabled: (boleh('penyesuaian') && !r.kosong && !sudah) ? null : true,
          onclick: function () {
            try {
              var en = A.posting(buku(), r, { peran: state.peran, oleh: state.peran, sumber: 'pengguna' });
              simpanEntri(en);
              invalidate();
              pesanOk('Jurnal penyesuaian ' + en.no + ' diposting.', [r.judul + ' — ' + D.rupiah(r.jumlah)]);
              say('Penyesuaian ' + en.no + ' diposting, ' + D.rupiah(r.jumlah) + '.');
              renderAll();
            } catch (err) {
              pesanTolak('Penyesuaian ditolak.', err.tolak ? err.tolak.alasan : [String(err && err.message || err)]);
              renderPanel('sesuai');
            }
          }
        }, 'Posting')));
      p.appendChild(box);
    });

    /* Depreciation schedules, in full, because "straight line over 96 months"
     * only means something if the reader can see the 96 rows add up. */
    var jc = h('div', { class: 'card' });
    jc.appendChild(h('h3', { text: 'Jadwal penyusutan' }));
    jc.appendChild(h('p', { class: 'note wrap-normal', text: 'Garis lurus, per bulan, dan berjumlah TEPAT harga perolehan minus nilai residu. Sisa pembagian yang tidak habis dibagikan satu rupiah per bulan oleh alokasi(), tidak ditumpuk di bulan terakhir — kendaraan di bawah dasarnya Rp 220.000.000 dibagi 96 bulan, dan 64 dari 96 bulannya menerima satu rupiah tambahan.' }));
    var pj = A.periksaJadwal(state.db);
    jc.appendChild(h('div', { class: 'test-summary' },
      h('span', { class: 'pillbig ' + (pj.gagal ? 'fail' : 'pass'), text: pj.gagal ? pj.gagal + ' GAGAL' : pj.lulus + '/' + pj.total + ' LULUS' }),
      h('span', { class: 'hint wrap-normal', text: 'pemeriksaan jadwal: jumlah tepat, nilai buku akhir tepat residu, setiap angsuran bulat, selisih antar angsuran paling banyak satu rupiah, dan total register = saldo akun aset di buku besar' })));
    pj.cek.filter(function (c) { return !c.ok; }).forEach(function (c) {
      jc.appendChild(h('div', { class: 'tcase no' }, h('span', { class: 'mk', text: '✗' }), h('span', { class: 'wrap-normal', text: c.nama }), h('span', { class: 'msg wrap-normal', text: c.pesan })));
    });

    var arows = state.db.reg.aset.map(function (a) {
      var terbuka = state.sel.asetBuka === a.id;
      return h('tr', { class: terbuka ? 'sel' : null },
        h('td', null, h('button', {
          class: 'linkbtn dok', type: 'button', 'data-fkey': 'js:aset:' + a.id, 'aria-expanded': terbuka ? 'true' : 'false',
          onclick: function () { state.sel.asetBuka = terbuka ? '' : a.id; renderPanel('sesuai'); }
        }, (terbuka ? '▾ ' : '▸ ') + a.id)),
        h('td', { class: 'wrap-normal' }, a.nama, h('div', { class: 'small', text: a.catatan })),
        tdRp(a.harga), tdRp(a.residu),
        h('td', { class: 'num', text: a.umurBulan + ' bln' }),
        h('td', { class: 'mono', text: D.periodeNama(a.mulai) }),
        tdRp(a.akumAwal), tdRp(a.penyusutanTahun),
        tdRp(a.harga - a.akumAwal - a.penyusutanTahun));
    });
    jc.appendChild(tableOf(['Aset', 'Nama', { label: 'Harga perolehan', num: true }, { label: 'Residu', num: true },
      { label: 'Umur', num: true }, 'Mulai', { label: 'Akum. awal', num: true }, { label: 'Penyusutan ' + TAHUN, num: true },
      { label: 'Nilai buku akhir', num: true }], arows, { minWidth: '900px' }));

    if (state.sel.asetBuka) {
      var a = null;
      state.db.reg.aset.forEach(function (x) { if (x.id === state.sel.asetBuka) a = x; });
      if (a) {
        var jrows = a.jadwal.baris.map(function (b) {
          var diTahun = b.periode >= TAHUN + '-01' && b.periode <= TAHUN + '-12';
          return h('tr', { class: diTahun ? 'sel' : null },
            h('td', { class: 'num', text: String(b.no) }),
            h('td', { class: 'mono', text: b.periode }),
            tdRp(b.jumlah), tdRp(b.akumulasi), tdRp(b.nilaiBuku),
            h('td', null, diTahun ? h('span', { class: 'pill info', text: 'masuk ' + TAHUN }) : null));
        });
        jrows.push(h('tr', { class: 'jumlahbaris' },
          h('td', { colspan: '2', text: 'Jumlah ' + a.jadwal.baris.length + ' bulan' }),
          h('td', { class: 'num rp', text: D.rupiah(a.jadwal.totalPenyusutan) }),
          h('td', { colspan: '2', class: 'wrap-normal', text: 'harga perolehan ' + D.rupiah(a.harga) + ' − residu ' + D.rupiah(a.residu) + ' = ' + D.rupiah(a.harga - a.residu) }),
          h('td', null, h('span', { class: 'pill ' + (a.jadwal.totalPenyusutan === a.harga - a.residu ? 'ok' : 'bad'), text: a.jadwal.totalPenyusutan === a.harga - a.residu ? 'tepat' : 'SELISIH' }))));
        jc.appendChild(h('h4', { style: 'margin-top:12px', class: 'wrap-normal', text: 'Jadwal ' + a.id + ' — ' + a.jadwal.baris.length + ' bulan' }));
        jc.appendChild(tableOf([{ label: 'No', num: true }, 'Periode', { label: 'Penyusutan', num: true }, { label: 'Akumulasi', num: true }, { label: 'Nilai buku', num: true }, ''],
          jrows, { minWidth: '620px', mini: true }));
      }
    }
    p.appendChild(jc);

    /* The loan register, for the same reason the depreciation schedules are shown
     * in full: "the current portion is Rp 60.000.000" only means something if the
     * reader can see where the figure comes from. */
    var pc = h('div', { class: 'card' });
    pc.appendChild(h('h3', { text: 'Register pinjaman — dan bagian yang jatuh tempo dalam dua belas bulan' }));
    pc.appendChild(h('p', { class: 'note wrap-normal', text: 'Sebuah liabilitas yang diperkirakan diselesaikan dalam dua belas bulan sejak tanggal pelaporan adalah liabilitas JANGKA PENDEK. Bagan akun karena itu punya dua akun untuk satu pinjaman — 2201 untuk bagian di luar dua belas bulan dan 2106 untuk bagian lancarnya — dan angka pembaginya dihitung dari register ini beserta saldo buku besar pada tanggal laporan, bukan diketik. Tanpa akun bagian lancar, tidak ada porsi utang jangka panjang yang bisa disajikan sebagai lancar berapa pun tenornya, dan neracanya salah klasifikasi tanpa satu total pun bergeser — itu sebabnya tidak ada invarian yang menangkapnya.' }));
    var prows = [];
    (state.db.reg.pinjaman || []).forEach(function (k) {
      var sisaPanjang = L.saldoAkun(buku(), k.akunPokok, { sampai: state.sampai }).saldo;
      var sisaLancar = L.saldoAkun(buku(), k.akunLancar, { sampai: state.sampai }).saldo;
      var sisaPokok = D.add(sisaPanjang, sisaLancar);
      var tenor = (k.angsuran > 0 && sisaPokok > 0) ? D.divFloor(sisaPokok + k.angsuran - 1, k.angsuran) : 0;
      var wajib = Math.min(sisaPokok, D.mul(k.angsuran, 12));
      prows.push(h('tr', null,
        h('td', null, h('span', { class: 'kode', text: k.id })),
        /* The name only. The explanatory note goes on its own full-width row
         * below: ten columns of nowrap figures squeeze a prose cell down to a
         * hundred pixels, and a sentence rendered one word per line is not a
         * sentence anyone reads. */
        h('td', { class: 'wrap-normal', text: k.nama }),
        tdRp(k.pokokAwal, 'print-drop'), tdRp(k.angsuran),
        h('td', { class: 'num', text: tenor + ' bln' }),
        tdRp(sisaPokok), tdRp(wajib), tdRp(sisaLancar), tdRp(sisaPokok - wajib),
        h('td', { class: 'print-drop' }, h('span', { class: 'pill ' + (sisaLancar === wajib ? 'ok' : 'warn'), text: sisaLancar === wajib ? 'tersaji benar' : 'perlu reklasifikasi' }))));
      prows.push(h('tr', { class: 'catatanbaris' },
        h('td', { colspan: '10', class: 'wrap-normal small' },
          k.catatan + ' Rumus bagian lancar: min(sisa pokok ' + D.rupiah(sisaPokok) +
          '; 12 × ' + D.rupiah(k.angsuran) + ') = ' + D.rupiah(wajib) + '.')));
    });
    pc.appendChild(tableOf(['Pinjaman', 'Nama',
      { label: 'Pokok awal', num: true, cetakLepas: true }, { label: 'Angsuran/bulan', num: true },
      { label: 'Tenor sisa', num: true }, { label: 'Sisa pokok', num: true }, { label: 'Jatuh tempo ≤ 12 bln', num: true },
      { label: 'Tersaji di 2106', num: true }, { label: 'Jangka panjang', num: true },
      { label: '', cetakLepas: true }], prows, { minWidth: '1000px' }));
    p.appendChild(pc);
  }

  /* ============================================================== laporan */

  function lbaris(label, nilai, cls, tie, catatan) {
    return h('div', { class: 'lbaris ' + (cls || '') },
      h('span', { class: 't wrap-normal' }, label,
        tie ? h('span', { class: 'tie', text: tie }) : null,
        catatan ? h('div', { class: 'small', text: catatan }) : null),
      h('span', { class: 'n' + (nilai < 0 ? ' neg' : ''), text: nilai === null ? '' : D.rpAkun(nilai) }));
  }

  function lapJudul(nama, sub, std) {
    return h('div', { class: 'lap-judul' },
      h('div', { class: 'sub2', text: state.db.profil.nama }),
      h('h4', { text: nama }),
      h('div', { class: 'sub2', text: sub }),
      std ? h('div', { class: 'std wrap-normal', text: std }) : null);
  }

  function kartuLabaRugi(l) {
    var box = h('div', { class: 'card lap' });
    box.appendChild(lapJudul('LAPORAN LABA RUGI', 'Untuk tahun yang berakhir pada ' + D.tglPanjang(state.sampai),
      'Bentuk SAK EMKM. Laporan ini wajib bagi entitas mikro.'));
    box.appendChild(lbaris('PENDAPATAN', null, 'judul'));
    l.pendapatanUsaha.forEach(function (r) { box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci')); });
    box.appendChild(lbaris('Jumlah pendapatan usaha', l.totPendapatanUsaha, 'sub'));
    box.appendChild(lbaris('BEBAN POKOK PENJUALAN', null, 'judul'));
    l.hpp.forEach(function (r) { box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, -r.jumlah, 'rinci')); });
    box.appendChild(lbaris('LABA BRUTO', l.labaBruto, 'sub'));
    box.appendChild(lbaris('BEBAN USAHA', null, 'judul'));
    l.bebanUsaha.forEach(function (r) { box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, -r.jumlah, 'rinci')); });
    box.appendChild(lbaris('Jumlah beban usaha', -l.totBebanUsaha, 'sub'));
    box.appendChild(lbaris('LABA USAHA', l.labaUsaha, 'sub'));
    if (l.totPendapatanLain !== 0) {
      box.appendChild(lbaris('PENDAPATAN LAIN-LAIN', null, 'judul'));
      l.pendapatanLain.forEach(function (r) { box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci')); });
    }
    box.appendChild(lbaris('LABA SEBELUM PAJAK PENGHASILAN', l.labaSebelumPajak, 'sub'));
    box.appendChild(lbaris('BEBAN PAJAK PENGHASILAN', null, 'judul'));
    /* The caption used to state an equation it never checked: "0,5% × peredaran
     * bruto Rp X" printed beside whatever happened to be booked to 5301. Post one
     * ordinary sale after the monthly instalments were computed and the sentence
     * became arithmetically false on the face of the primary statement, while the
     * Pajak tab correctly reported the difference. A Laba Rugi shows what is
     * BOOKED — that part was right — so the fix is for the caption to compare the
     * two and say so when they differ, instead of asserting an identity. */
    var dasarPph = D.pphFinalDasar(0, l.peredaranBruto);
    var pphHitung = dasarPph.kena > 0 ? D.pphFinal(dasarPph.kena) : 0;
    var dasarTeks = '0,5% × dasar kena ' + D.rupiah(dasarPph.kena) +
      ' (peredaran bruto ' + D.rupiah(l.peredaranBruto) +
      ' − ' + D.rupiah(dasarPph.bebasDipakai) + ' yang tidak dikenai PPh bagi orang pribadi) = ' +
      D.rupiah(pphHitung) + '. PP 55/2022 Pasal 60 ayat (2). FINAL, dan dasarnya peredaran bruto — bukan laba di atas.';
    l.pajakFinal.forEach(function (r) {
      var beda = r.jumlah - pphHitung;
      box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, -r.jumlah, 'rinci', null,
        beda === 0 ? dasarTeks
          : 'Dibukukan ' + D.rupiah(r.jumlah) + '; ' + dasarTeks + ' Selisih ' + D.rupiah(beda) +
          ' belum disesuaikan — tab Penyesuaian menawarkan jurnal true-up-nya, tab Pajak merinci per masa.'));
    });
    box.appendChild(lbaris('LABA NETO TAHUN BERJALAN', l.labaNeto, 'total kunci', 'I4'));
    box.appendChild(h('p', { class: 'hint wrap-normal', style: 'margin-top:10px', text: 'PPN tidak muncul di laporan ini sama sekali, dan itu benar: PPN keluaran yang dipungut bukan pendapatan entitas dan PPN masukan yang dibayar bukan bebannya. Keduanya ada di neraca, sebagai liabilitas dan aset.' }));
    return box;
  }

  function kartuPerubahanEkuitas(pk) {
    var box = h('div', { class: 'card lap' });
    box.appendChild(lapJudul('LAPORAN PERUBAHAN EKUITAS', 'Untuk tahun yang berakhir pada ' + D.tglPanjang(state.sampai),
      'TIDAK diwajibkan SAK EMKM untuk entitas mikro; disajikan sebagai tambahan, dalam bentuk SAK ETAP.'));
    box.appendChild(lbaris('Ekuitas awal periode, ' + D.tglPanjang(AWAL), pk.ekuitasAwal, 'sub'));
    pk.komposisiAwal.forEach(function (r) {
      box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci'));
    });
    box.appendChild(lbaris('Setoran modal pemilik selama periode', pk.setoran, ''));
    box.appendChild(lbaris('Laba neto tahun berjalan', pk.labaNeto, 'kunci', 'I4'));
    box.appendChild(lbaris('Prive pemilik selama periode', -pk.prive, ''));
    if (pk.lainEkuitas !== 0) box.appendChild(lbaris('Perubahan ekuitas lainnya', pk.lainEkuitas, ''));
    box.appendChild(lbaris('EKUITAS AKHIR PERIODE, ' + D.tglPanjang(state.sampai), pk.ekuitasAkhir, 'total kunci', 'I4'));
    box.appendChild(h('div', { class: 'rekon' },
      h('div', { class: 'rekon-baris sisa' + (pk.cocok ? '' : ' rusak') },
        h('span', { class: 'wrap-normal', text: 'Periksa: awal + laba + setoran − prive, dikurangi ekuitas akhir menurut buku' }),
        h('span', { class: 'n', text: D.rupiah(pk.ekuitasAkhirHitung - pk.ekuitasAkhir) }))));
    if (pk.penutupPindah !== 0) {
      box.appendChild(h('p', { class: 'hint wrap-normal', style: 'margin-top:8px', text: 'Jurnal penutup memindahkan ' + D.rupiah(Math.abs(pk.penutupPindah)) + ' dari akun nominal ke akun ekuitas. Laporan ini tidak berubah karenanya, dan itu bukan kebetulan: pemindahan itu mengurangi bagian nominal dan menambah bagian akun ekuitas dengan jumlah yang sama, jadi ekuitas yang dilaporkan tidak bergerak sama sekali.' }));
    }
    return box;
  }

  function kartuNeraca(n, l) {
    var box = h('div', { class: 'card lap' });
    box.appendChild(lapJudul('LAPORAN POSISI KEUANGAN (NERACA)', 'Per ' + D.tglPanjang(state.sampai),
      'Bentuk SAK EMKM. Laporan ini wajib bagi entitas mikro.'));
    box.appendChild(lbaris('ASET', null, 'judul'));
    box.appendChild(lbaris('Aset lancar', null, 'judul'));
    n.asetLancar.baris.forEach(function (r) { box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci')); });
    box.appendChild(lbaris('Jumlah aset lancar', n.asetLancar.total, 'sub'));
    box.appendChild(lbaris('Aset tetap', null, 'judul'));
    n.asetTetap.baris.forEach(function (r) {
      box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci', null,
        r.akun.akumDari ? 'akun kontra: mengurangi aset, tanpa menghapus harga perolehannya' : null));
    });
    box.appendChild(lbaris('Jumlah aset tetap neto', n.asetTetap.total, 'sub'));
    box.appendChild(lbaris('JUMLAH ASET', n.totalAset, 'total kunci', 'I3'));

    box.appendChild(lbaris('LIABILITAS', null, 'judul'));
    box.appendChild(lbaris('Liabilitas jangka pendek', null, 'judul'));
    n.liabPendek.baris.forEach(function (r) { box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci')); });
    box.appendChild(lbaris('Jumlah liabilitas jangka pendek', n.liabPendek.total, 'sub'));
    if (n.liabPanjang.baris.length) {
      box.appendChild(lbaris('Liabilitas jangka panjang', null, 'judul'));
      n.liabPanjang.baris.forEach(function (r) { box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci')); });
    }
    box.appendChild(lbaris('Jumlah liabilitas', n.totalLiabilitas, 'sub'));

    box.appendChild(lbaris('EKUITAS', null, 'judul'));
    n.ekuitasAkun.baris.forEach(function (r) {
      box.appendChild(lbaris(r.akun.kode + ' ' + r.akun.nama, r.jumlah, 'rinci',
        r.akun.kode === '3201' ? null : null,
        r.akun.kontra ? 'akun kontra ekuitas: pengambilan pemilik mengurangi ekuitas' : null));
    });
    if (n.labaBerjalan !== 0 || !L.sudahDitutup(buku(), state.sampai, AWAL)) {
      box.appendChild(lbaris('Laba periode berjalan (belum ditutup)', n.labaBerjalan, 'rinci kunci', 'I4'));
    } else {
      box.appendChild(lbaris('Laba periode berjalan (belum ditutup)', 0, 'rinci', null,
        'Nol karena jurnal penutup sudah diposting: laba ' + D.rupiah(l.labaNeto) + ' sudah pindah ke 3201 Saldo Laba di atas. Total ekuitasnya tidak berubah sepeser pun.'));
    }
    box.appendChild(lbaris('JUMLAH EKUITAS', n.totalEkuitas, 'sub kunci', 'I4'));
    box.appendChild(lbaris('JUMLAH LIABILITAS DAN EKUITAS', n.kanan, 'total kunci', 'I3'));

    box.appendChild(h('div', { class: 'rekon' },
      rekonBaris('Jumlah aset', n.totalAset),
      rekonBaris('Jumlah liabilitas', n.totalLiabilitas),
      rekonBaris('Jumlah ekuitas', n.totalEkuitas),
      h('div', { class: 'rekon-baris total sisa' + (n.seimbang ? '' : ' rusak') },
        h('span', { class: 'wrap-normal', text: n.seimbang ? 'Aset − (Liabilitas + Ekuitas) — nol, sebagaimana harusnya' : 'TIDAK SEIMBANG. Selisih' }),
        h('span', { class: 'n', text: D.rupiah(n.selisih) }))));
    return box;
  }

  function kartuArusKas(a) {
    var box = h('div', { class: 'card lap' });
    box.appendChild(lapJudul('LAPORAN ARUS KAS — METODE TIDAK LANGSUNG', 'Untuk tahun yang berakhir pada ' + D.tglPanjang(state.sampai),
      'TIDAK diwajibkan SAK EMKM untuk entitas mikro; disajikan sebagai tambahan, dalam bentuk SAK ETAP.'));
    box.appendChild(lbaris('ARUS KAS DARI AKTIVITAS OPERASI', null, 'judul'));
    box.appendChild(lbaris('Laba neto tahun berjalan', a.labaNeto, 'rinci kunci', 'I4'));
    box.appendChild(lbaris('Penyesuaian untuk pos non-kas:', null, 'rinci'));
    a.rincianNonKas.forEach(function (r) { box.appendChild(lbaris(r.label, r.jumlah, 'rinci2')); });
    if (!a.rincianNonKas.length) box.appendChild(lbaris('tidak ada pos non-kas pada periode ini', 0, 'rinci2'));
    box.appendChild(lbaris('Perubahan modal kerja:', null, 'rinci'));
    a.modalKerja.forEach(function (r) {
      box.appendChild(lbaris((r.naik ? 'Kenaikan ' : 'Penurunan ') + r.akun.nama, r.jumlah, 'rinci2'));
    });
    if (!a.modalKerja.length) box.appendChild(lbaris('tidak ada pergerakan modal kerja', 0, 'rinci2'));
    box.appendChild(lbaris('Arus kas neto dari aktivitas operasi', a.operasi, 'sub kunci'));

    box.appendChild(lbaris('ARUS KAS DARI AKTIVITAS INVESTASI', null, 'judul'));
    a.rincianInvestasi.forEach(function (r) { box.appendChild(lbaris((r.jumlah < 0 ? 'Perolehan ' : 'Pelepasan ') + r.akun.nama, r.jumlah, 'rinci')); });
    if (!a.rincianInvestasi.length) box.appendChild(lbaris('tidak ada aktivitas investasi', 0, 'rinci'));
    box.appendChild(lbaris('Arus kas neto dari aktivitas investasi', a.investasi, 'sub kunci'));

    box.appendChild(lbaris('ARUS KAS DARI AKTIVITAS PENDANAAN', null, 'judul'));
    a.rincianPendanaan.forEach(function (r) { box.appendChild(lbaris(r.akun.nama, r.jumlah, 'rinci')); });
    if (!a.rincianPendanaan.length) box.appendChild(lbaris('tidak ada aktivitas pendanaan', 0, 'rinci'));
    box.appendChild(lbaris('Arus kas neto dari aktivitas pendanaan', a.pendanaan, 'sub kunci'));

    box.appendChild(lbaris('KENAIKAN (PENURUNAN) NETO KAS', a.totalArus, 'sub'));
    box.appendChild(lbaris('Kas dan setara kas awal periode', a.kasAwal, ''));
    box.appendChild(lbaris('KAS DAN SETARA KAS AKHIR PERIODE', a.kasAkhirHitung, 'total kunci', 'I6'));

    /* THE reconciliation. Two independently computed figures, and the difference
     * printed whether it is zero or not — a zero the reader can see is worth more
     * than a zero they have to assume. */
    box.appendChild(h('h4', { style: 'margin-top:14px', text: 'Rekonsiliasi terhadap buku besar' }));
    box.appendChild(h('p', { class: 'note wrap-normal', text: 'Sisi kiri disusun dari laporan di atas. Sisi kanan dijumlah langsung dari posting akun kas di buku besar, lewat jalur yang tidak menyentuh satu pun angka di atas. Kalau keduanya berbeda, selisihnya dicetak di baris terakhir, bukan disembunyikan.' }));
    box.appendChild(h('div', { class: 'rekon' },
      rekonBaris('Kas awal periode', a.kasAwal),
      rekonBaris('+ Arus kas operasi', a.operasi),
      rekonBaris('+ Arus kas investasi', a.investasi),
      rekonBaris('+ Arus kas pendanaan', a.pendanaan),
      rekonBaris('= Kas akhir menurut laporan arus kas', a.kasAkhirHitung, null, 'total'),
      rekonBaris('Kas akhir menurut saldo akun kas di buku besar', a.kasAkhir,
        a.kasAkhirRinci.map(function (r) { return r.akun.kode + ' ' + D.rupiah(r.jumlah); }).join('  +  ')),
      h('div', { class: 'rekon-baris total sisa' + (a.rekonsiliasi ? '' : ' rusak') },
        h('span', { class: 'wrap-normal', text: a.rekonsiliasi ? 'Selisih — nol. Laporan arus kas rekonsiliasi ke buku besar.' : 'SELISIH — laporan arus kas TIDAK rekonsiliasi' }),
        h('span', { class: 'n', text: D.rupiah(a.selisihRekonsiliasi) }))));

    box.appendChild(h('h4', { style: 'margin-top:14px', text: 'Mengapa rekonsiliasinya tidak bisa ditambal' }));
    box.appendChild(h('p', { class: 'note wrap-normal' },
      'Setiap entri seimbang, jadi di seluruh himpunan entri utuh, Σ(debit − kredit) atas SEMUA akun tepat nol. ' +
      'Pisahkan akun kas dari yang bukan, lalu pindahkan ruas: ',
      h('code', { text: 'Δkas = −Σ(debit − kredit) atas seluruh akun non-kas' }),
      ', tanpa suku sisa. Setiap akun non-kas punya tepat satu bucket O/I/F, jadi ketiga subtotalnya WAJIB ' +
      'berjumlah Δkas. Kelompokkan bucket operasi menjadi nominal, penyusutan dan modal kerja, dan metode tidak ' +
      'langsungnya keluar dari aljabar itu sendiri: ',
      h('code', { text: 'operasi = laba neto + penyusutan + Σ(kredit − debit) modal kerja' }), '.'));
    box.appendChild(h('div', { class: 'rekon' },
      rekonBaris('Bagian operasi menurut aljabar bucket', a.operasi),
      rekonBaris('Bagian operasi yang disajikan di atas', a.operasiSusun),
      h('div', { class: 'rekon-baris sisa' + (a.operasiSelisih === 0 ? '' : ' rusak') },
        h('span', { class: 'wrap-normal', text: 'Selisih penyajian terhadap aljabar' }),
        h('span', { class: 'n', text: D.rupiah(a.operasiSelisih) })),
      rekonBaris('Penyesuaian non-kas menurut akumulasi penyusutan', a.penyusutan),
      rekonBaris('Beban penyusutan menurut Laba Rugi', a.bebanPenyusutan),
      h('div', { class: 'rekon-baris sisa' + (a.penyusutan === a.bebanPenyusutan ? '' : ' rusak') },
        h('span', { class: 'wrap-normal', text: 'Selisih antara keduanya' }),
        h('span', { class: 'n', text: D.rupiah(a.penyusutan - a.bebanPenyusutan) }))));
    box.appendChild(h('p', { class: 'hint wrap-normal', style: 'margin-top:8px', text: 'Jurnal penutup dikecualikan dari laporan ini. Ia tidak pernah menyentuh kas — itu diperiksa sebagai invarian tersendiri — jadi mengecualikannya tidak mengganggu identitas di atas. Kalau IKUT dihitung, seluruh laba tahun ini akan salah masuk ke aktivitas pendanaan, karena jurnal penutup mendebit pendapatan (operasi) dan mengkredit Saldo Laba (pendanaan).' }));
    return box;
  }

  function renderLaporan(p) {
    var l = lr(), n = nr(l), pk = pe(l), a = ak(l);

    var ctl = h('div', { class: 'card' });
    ctl.appendChild(h('h3', { text: 'Laporan keuangan' }));
    ctl.appendChild(h('p', { class: 'note wrap-normal' },
      'Standar yang diikuti: ', h('b', { text: 'SAK EMKM' }), ' (Standar Akuntansi Keuangan Entitas Mikro, Kecil dan Menengah, ' +
      'berlaku sejak 1 Januari 2018). SAK EMKM mewajibkan tiga laporan bagi entitas mikro: Laporan Posisi Keuangan, ' +
      'Laporan Laba Rugi, dan Catatan atas Laporan Keuangan. Ia TIDAK mewajibkan Laporan Arus Kas maupun Laporan ' +
      'Perubahan Ekuitas. Keduanya tetap disajikan di sini — dalam bentuk yang dipakai SAK ETAP — karena keduanya ' +
      'justru yang membuktikan laba dan kasnya menyatu, dan itu yang sedang diperlihatkan halaman ini.'));
    var chips = h('div', { class: 'chips no-print' });
    [['semua', 'Semua laporan'], ['lr', 'Laba Rugi'], ['pe', 'Perubahan Ekuitas'], ['nr', 'Neraca'], ['ak', 'Arus Kas']].forEach(function (x) {
      chips.appendChild(h('button', {
        class: 'chip', type: 'button', 'aria-pressed': state.sel.lpMana === x[0] ? 'true' : 'false',
        'data-fkey': 'lp:mana:' + x[0],
        onclick: function () { state.sel.lpMana = x[0]; renderPanel('laporan'); }
      }, x[1]));
    });
    chips.appendChild(h('button', {
      class: 'btn small', type: 'button', 'data-fkey': 'lp:sampai',
      onclick: function () { try { window.print(); } catch (e) { } }
    }, 'Cetak'));
    ctl.appendChild(chips);
    ctl.appendChild(h('p', { class: 'hint wrap-normal', text: 'Tanda I3, I4 dan I6 menandai angka yang muncul di lebih dari satu laporan. Angka yang sama, bukan angka yang mirip: laba bersih dihitung sekali dan dipakai bertiga, dan baris rekonsiliasi di bawah setiap laporan mencetak selisihnya — nol pun dicetak, karena nol yang bisa dilihat lebih berharga daripada nol yang harus diandaikan.' }));
    p.appendChild(ctl);

    var mana = state.sel.lpMana;
    if (mana === 'semua') {
      p.appendChild(h('div', { class: 'duaLap' }, kartuLabaRugi(l), kartuPerubahanEkuitas(pk)));
      p.appendChild(h('div', { class: 'duaLap' }, kartuNeraca(n, l), kartuArusKas(a)));
    } else if (mana === 'lr') p.appendChild(kartuLabaRugi(l));
    else if (mana === 'pe') p.appendChild(kartuPerubahanEkuitas(pk));
    else if (mana === 'nr') p.appendChild(kartuNeraca(n, l));
    else p.appendChild(kartuArusKas(a));
  }

  /* ==================================================== penutup & periode */

  function renderTutup(p) {
    var l = lr();
    var rencana = L.rencanaPenutup(buku(), state.sampai, { dari: null });
    var sudah = L.sudahDitutup(buku(), state.sampai, AWAL);

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Jurnal penutup' }));
    card.appendChild(h('p', { class: 'note wrap-normal', text: 'Empat langkah, dalam urutan yang diajarkan setiap buku pembukuan Indonesia, dan masing-masing entri yang seimbang sendiri — bukan satu entri raksasa — supaya buku besarnya memperlihatkan apa yang ditutup dan kapan, dan supaya laba bisa diikuti dari akun pendapatan masuk ke Ikhtisar Laba Rugi lalu keluar lagi ke Saldo Laba.' }));
    card.appendChild(h('p', { class: 'note wrap-normal', text: 'Rencananya dibangun dari saldo yang sedang hidup, jadi ia idempoten: jalankan di buku yang sudah tertutup dan setiap saldonya nol, sehingga ia tidak menghasilkan entri apa pun. Itu yang menghentikan klik kedua dari menggandakan Saldo Laba.' }));

    if (!D.bolehkah(state.peran, 'penutup')) {
      card.appendChild(h('div', { class: 'callout warn wrap-normal' },
        h('b', { text: 'Hanya supervisor yang boleh memposting jurnal penutup. ' }), alasanTakBoleh('penutup'),
        ' Rencananya tetap ditampilkan penuh — termasuk setiap angkanya.'));
    }

    var sum = h('div', { class: 'summary' },
      stat('Laba neto Laba Rugi', D.rupiah(l.labaNeto), 'yang harus dipindahkan'),
      stat('Laba menurut rencana penutup', D.rupiah(rencana.laba), rencana.laba === l.labaNeto ? 'cocok ke rupiah' : 'SELISIH ' + D.rupiah(rencana.laba - l.labaNeto)),
      stat('Langkah', String(rencana.langkah.length), rencana.kosong ? 'tidak ada yang perlu ditutup' : 'siap diposting'),
      stat('Status', sudah ? 'sudah ditutup' : 'belum ditutup', sudah ? 'akun nominal sudah nol' : 'akun nominal masih bersaldo'));
    card.appendChild(sum);

    card.appendChild(h('div', { class: 'row-between no-print' },
      h('span', { class: 'hint wrap-normal', text: rencana.kosong ? 'Rencana kosong — buku pada tanggal ini sudah tertutup, jadi tidak ada yang bisa diposting dua kali.' : 'Menutup ke akun 3201 Saldo Laba.' }),
      h('button', {
        class: 'btn primary', type: 'button', 'data-fkey': 'tp:posting',
        disabled: (boleh('penutup') && !rencana.kosong) ? null : true,
        onclick: function () {
          var praN = L.neraca(buku(), state.sampai, { dari: AWAL });
          try {
            var hasil = L.postingPenutup(buku(), state.sampai, { peran: state.peran, oleh: state.peran, sumber: 'pengguna' });
            hasil.entries.forEach(function (e) { simpanEntri(e); });
            invalidate();
            St.audit({ aksi: 'penutup', peran: state.peran, entri: hasil.entries.length });
            var pascaN = L.neraca(buku(), state.sampai, { dari: AWAL });
            pesanOk(hasil.entries.length + ' jurnal penutup diposting.', [
              'Laba ' + D.rupiah(hasil.rencana.laba) + ' dipindahkan ke 3201 Saldo Laba.',
              'Setiap akun nominal sekarang bersaldo nol — lihat kolom kanan di tab Neraca Saldo.',
              'Total aset ' + D.rupiah(praN.totalAset) + ' → ' + D.rupiah(pascaN.totalAset) + '. Total ekuitas ' + D.rupiah(praN.totalEkuitas) + ' → ' + D.rupiah(pascaN.totalEkuitas) + '. Neracanya tidak bergeser sepeser pun.'
            ]);
            say('Buku ditutup. Laba ' + D.rupiah(hasil.rencana.laba) + ' pindah ke Saldo Laba, neraca tidak berubah.');
            renderAll();
          } catch (err) {
            pesanTolak('Jurnal penutup ditolak.', err.tolak ? err.tolak.alasan : [String(err && err.message || err)]);
            renderPanel('tutup');
          }
        }
      }, 'Posting jurnal penutup')));
    p.appendChild(card);

    if (!rencana.kosong) {
      var lc = h('div', { class: 'card' });
      lc.appendChild(h('h3', { text: 'Rencana — ' + rencana.langkah.length + ' langkah' }));
      rencana.langkah.forEach(function (lg) {
        var box = h('div', { class: 'langkah' });
        box.appendChild(h('div', { class: 'no', text: 'LANGKAH ' + lg.no }));
        box.appendChild(h('h4', { class: 'wrap-normal', text: lg.nama }));
        var rows = lg.baris.map(function (b) {
          return h('tr', null,
            h('td', null, h('span', { class: 'kode', text: b.akun })),
            h('td', { class: 'wrap-normal' }, D.akun(b.akun).nama, b.catatan ? h('div', { class: 'small', text: b.catatan }) : null),
            h('td', { class: 'num rp', text: b.d ? D.rupiah(b.d) : '' }),
            h('td', { class: 'num rp', text: b.k ? D.rupiah(b.k) : '' }));
        });
        var td_ = lg.baris.reduce(function (s, x) { return s + (x.d || 0); }, 0);
        var tk_ = lg.baris.reduce(function (s, x) { return s + (x.k || 0); }, 0);
        rows.push(h('tr', { class: 'jumlahbaris' },
          h('td', { colspan: '2', text: 'Jumlah langkah ' + lg.no }),
          h('td', { class: 'num rp', text: D.rupiah(td_) }),
          h('td', { class: 'num rp', text: D.rupiah(tk_) })));
        box.appendChild(tableOf(['Akun', 'Nama', { label: 'Debit', num: true }, { label: 'Kredit', num: true }], rows, { minWidth: '520px', mini: true }));
        box.appendChild(h('p', { class: 'hint', text: td_ === tk_ ? 'Seimbang sendiri: ' + D.rupiah(td_) + ' = ' + D.rupiah(tk_) + '.' : 'TIDAK SEIMBANG — akan ditolak.' }));
        lc.appendChild(box);
      });
      lc.appendChild(h('p', { class: 'hint wrap-normal', text: 'Langkah 4 menutup Prive ke Saldo Laba. Prive bukan akun nominal, tapi ia ditutup bersamaan di setiap penutupan buku perorangan, dan ia harus pergi ke suatu tempat atau akan menumpuk melintasi tahun. Ekuitas ke ekuitas, jadi totalnya tidak bergerak. Buku teks yang lain menutup Prive ke Modal Pemilik; tujuannya di sini satu konstanta.' }));
      p.appendChild(lc);
    }

    /* ---------------------------------------------------- kunci periode */
    var pc = h('div', { class: 'card' });
    pc.appendChild(h('h3', { text: 'Kunci periode' }));
    pc.appendChild(h('p', { class: 'note wrap-normal', text: 'Periode terkunci menolak posting baru, dan menolaknya di mesinnya — bukan dengan menyembunyikan tombol. Hanya supervisor yang boleh membuka kembali periode yang sudah terkunci, karena membuka periode berarti mengizinkan angka yang sudah dilaporkan berubah. Enam periode di bawah dikunci oleh seed setelah pelaporan SPT Masa-nya.' }));
    if (!D.bolehkah(state.peran, 'bukaPeriode')) {
      pc.appendChild(h('div', { class: 'callout warn wrap-normal' },
        h('b', { text: 'Peran ini tidak boleh mengunci maupun membuka periode. ' }), alasanTakBoleh('bukaPeriode')));
    }
    var grid = h('div', { class: 'periode-grid' });
    for (var m = 1; m <= 12; m++) {
      (function (mm) {
        var per = TAHUN + '-' + String(mm).padStart(2, '0');
        var t = buku().tutup[per];
        var jml = L.pilih(buku(), { dari: D.awalBulan(per), sampai: D.akhirBulan(per) }).length;
        var kk = h('div', { class: 'periode-kartu' + (t ? ' terkunci' : '') });
        kk.appendChild(h('div', { class: 'nm', text: D.BULAN_PENDEK[mm - 1] + ' ' + TAHUN }));
        kk.appendChild(h('div', { class: 'st' + (t ? '' : ' buka'), text: t ? '🔒 terkunci' : 'terbuka' }));
        kk.appendChild(h('div', { class: 'jml', text: jml + ' entri' }));
        if (t) kk.appendChild(h('div', { class: 'jml wrap-normal', text: 'oleh ' + t.oleh + ', ' + t.pada }));
        kk.appendChild(h('button', {
          class: 'btn small no-print', type: 'button', 'data-fkey': 'tp:per:' + per,
          disabled: boleh(t ? 'bukaPeriode' : 'tutupPeriode') ? null : true,
          title: t ? 'Buka kembali ' + D.periodeNama(per) : 'Kunci ' + D.periodeNama(per),
          onclick: function () {
            try {
              if (t) {
                L.bukaPeriode(buku(), per, { peran: state.peran, oleh: state.peran });
                simpanTutup();
                St.audit({ aksi: 'bukaPeriode', peran: state.peran, periode: per });
                pesanOk('Periode ' + D.periodeNama(per) + ' dibuka kembali.', [
                  'Posting bertanggal di dalamnya sekarang diterima lagi.',
                  'Ini satu-satunya tindakan di aplikasi ini yang hanya boleh dilakukan supervisor, dan ia tercatat di jejak audit.'
                ]);
                say('Periode ' + D.periodeNama(per) + ' dibuka kembali oleh supervisor.');
              } else {
                L.tutupPeriode(buku(), per, { peran: state.peran, oleh: state.peran, pada: '2026-01-15' });
                simpanTutup();
                St.audit({ aksi: 'tutupPeriode', peran: state.peran, periode: per });
                pesanOk('Periode ' + D.periodeNama(per) + ' dikunci.', ['Entri baru bertanggal di dalamnya akan ditolak, walaupun seimbang sempurna.']);
                say('Periode ' + D.periodeNama(per) + ' dikunci.');
              }
              invalidate();
              renderAll();
            } catch (err) {
              pesanTolak('Tidak bisa mengubah kunci periode.', [String(err && err.message || err)]);
              renderPanel('tutup');
            }
          }
        }, t ? 'Buka' : 'Kunci'));
        grid.appendChild(kk);
      })(m);
    }
    pc.appendChild(grid);
    pc.appendChild(h('p', { class: 'hint wrap-normal', style: 'margin-top:10px', text: 'Coba: kunci Juli, lalu buka tab Jurnal Umum dan posting entri seimbang bertanggal 15 Juli. Ia ditolak, dan alasannya menyebut siapa yang mengunci dan kapan. Pemeriksaan invarian di header juga menguji ini secara langsung: untuk setiap periode terkunci ia menawarkan satu entri percobaan yang seimbang dan memastikan entri itu kembali dalam keadaan ditolak.' }));
    p.appendChild(pc);
  }

  /* ================================================================ pajak */

  function renderPajak(p) {
    var l = lr();
    var pp = L.posisiPpn(buku(), { dari: AWAL, sampai: state.sampai });
    var pf = L.pphFinalBulanan(buku(), state.sel.pjTahun);

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'PPN — masukan dan keluaran, dua akun yang tidak pernah dijaringkan di buku' }));
    card.appendChild(h('p', { class: 'note wrap-normal' },
      h('b', { text: 'PPN Masukan (1501) adalah ASET' }), ' — pajak yang sudah dibayar atas pembelian dan bisa dikreditkan. ',
      h('b', { text: 'PPN Keluaran (2104) adalah LIABILITAS' }), ' — pajak yang dipungut atas penjualan dan terutang ke negara. ' +
      'Keduanya tidak pernah dijaringkan di dalam buku besar; yang dijaringkan adalah POSISI untuk suatu masa, dan tanda ' +
      'dari posisi itulah yang membedakan kurang bayar dari lebih bayar yang dikompensasikan ke masa berikutnya.'));
    card.appendChild(h('div', { class: 'summary' },
      stat('PPN Keluaran periode', D.rupiah(pp.keluaran), 'dipungut atas penjualan'),
      stat('PPN Masukan periode', D.rupiah(pp.masukan), 'dibayar atas pembelian'),
      stat('Posisi', D.rupiah(Math.abs(pp.net)), pp.posisi),
      stat('Saldo 2104 di neraca', D.rupiah(pp.saldoKeluaran), 'masa yang belum disetor'),
      stat('Saldo 1501 di neraca', D.rupiah(pp.saldoMasukan), 'masukan yang dikreditkan ke masa berikutnya')));
    card.appendChild(h('p', { class: 'hint wrap-normal' },
      'Tarif yang dipakai 11%. Untuk 2025 tarif nominalnya 12%, tetapi dikenakan atas DPP nilai lain sebesar 11/12 harga ' +
      'jual (PMK 131/2024), yang secara aritmetika sama dengan 11% dari harga jual — dan itu sebabnya setiap toko di ' +
      'Indonesia tetap mencetak 11%. Contoh, DPP Rp 12.000.000: DPP nilai lain 11/12 × 12.000.000 = ' +
      D.rupiah(D.dppNilaiLain(12000000)) + ', 12% atasnya = ' + D.rupiah(D.divRound(D.mul(D.dppNilaiLain(12000000), 12), 100)) +
      ', dan 11% × 12.000.000 = ' + D.rupiah(D.ppnDari(12000000)) + '. Angka fakturnya yang menang kalau pembulatan berantainya berbeda satu rupiah.'));
    p.appendChild(card);

    var pc = h('div', { class: 'card' });
    pc.appendChild(h('h3', { text: 'PPh final UMKM 0,5% — PP 55/2022' }));
    pc.appendChild(h('p', { class: 'note wrap-normal' },
      'Ini ', h('b', { text: 'BUKAN PPh badan atas laba' }), '. Tarifnya 0,5% dari ', h('b', { text: 'peredaran bruto' }),
      ' per masa, dan bersifat final: bulan yang merugi pun tetap terutang, dan besarnya tidak berubah kalau bebannya ' +
      'berubah. Itu sebabnya jurnal penyesuaian di tab sebelumnya menurunkan laba tetapi tidak menurunkan pajak ini ' +
      'sepeser pun — yang berubah hanya kalau PEREDARAN BRUTO-nya yang berubah.'));
    /* The exemption, stated on the face of the panel. The whole point of this
     * table is that the 0,5% is recomputed from turnover on screen, so the one
     * thing that must not be hidden is the part of the turnover the 0,5% is not
     * charged on. */
    pc.appendChild(h('div', { class: 'callout wrap-normal' },
      h('b', { text: 'Rp 500.000.000 pertama tidak dikenai PPh. ' }),
      state.db.profil.pphFinalBebasCatatan,
      h('div', { class: 'small', style: 'margin-top:4px', text: state.db.profil.nama + ' — ' + state.db.profil.bentuk +
        ', ' + state.db.profil.pemilik + ', wajib pajak ' + state.db.profil.wp + '. Kolom “bebas” dan “dasar kena” di ' +
        'tabel bawah memperlihatkan pembebasan itu terpakai kumulatif: habis di ' +
        (function () {
          var hab = null;
          pf.baris.forEach(function (r) { if (!hab && r.sisaBebas === 0 && r.bebasDipakai > 0) hab = r.periode; });
          return hab ? D.periodeNama(hab) : 'belum habis tahun ini';
        })() + '.' })));
    pc.appendChild(h('div', { class: 'summary' },
      stat('Peredaran bruto ' + state.sel.pjTahun, D.rupiah(pf.totalBruto), 'sebelum pembebasan'),
      stat('Tidak dikenai PPh', D.rupiah(pf.totalBebasDipakai), 'Rp 500 juta pertama, WP orang pribadi'),
      stat('Dasar kena', D.rupiah(pf.totalKena), 'peredaran bruto − bagian bebas'),
      stat('0,5% × dasar kena', D.rupiah(pf.totalSeharusnya), 'seharusnya dibebankan'),
      stat('Dibebankan di buku', D.rupiah(pf.totalDibukukan), pf.cocok ? 'cocok ke rupiah' : 'SELISIH ' + D.rupiah(pf.selisih)),
      stat('Batas rezim final', D.rupiah(pf.batas), pf.diBawahBatas ? 'masih di bawah batas — rezim 0,5% berlaku' : 'DI ATAS BATAS — rezim final tidak lagi berlaku'),
      stat('Utang PPh final', D.rupiah(L.saldoAkun(buku(), '2105', { sampai: state.sampai }).saldo), 'masa Desember belum jatuh tempo')));

    var rows = pf.baris.map(function (r) {
      return h('tr', { class: r.cocok ? null : 'sel' },
        h('td', { class: 'mono', text: D.periodeNama(r.periode) }),
        tdRp(r.bruto),
        tdRp(r.kumulatifSesudah, 'print-drop'),
        tdRp(r.bebasDipakai),
        tdRp(r.kena),
        tdRp(r.seharusnya),
        tdRp(r.dibukukan),
        h('td', { class: 'num rp' + (r.selisih === 0 ? ' nol' : ' minus'), text: D.rupiah(r.selisih) }),
        h('td', { class: 'print-drop' }, h('span', { class: 'pill ' + (r.cocok ? 'ok' : 'bad'), text: r.cocok ? 'cocok' : 'selisih' })));
    });
    rows.push(h('tr', { class: 'jumlahbaris' },
      h('td', { text: 'Setahun' }),
      h('td', { class: 'num rp', text: D.rupiah(pf.totalBruto) }),
      h('td', { class: 'num rp print-drop', text: D.rupiah(pf.totalBruto) }),
      h('td', { class: 'num rp', text: D.rupiah(pf.totalBebasDipakai) }),
      h('td', { class: 'num rp', text: D.rupiah(pf.totalKena) }),
      h('td', { class: 'num rp', text: D.rupiah(pf.totalSeharusnya) }),
      h('td', { class: 'num rp', text: D.rupiah(pf.totalDibukukan) }),
      h('td', { class: 'num rp', text: D.rupiah(pf.selisih) }),
      h('td', { class: 'print-drop' }, h('span', { class: 'pill ' + (pf.cocok ? 'ok' : 'bad'), text: pf.cocok ? 'cocok' : 'selisih' }))));
    pc.appendChild(tableOf(['Masa', { label: 'Peredaran bruto', num: true },
      { label: 'Kumulatif s.d. masa ini', num: true, cetakLepas: true },
      { label: 'Tidak dikenai PPh', num: true }, { label: 'Dasar kena', num: true }, { label: '0,5% seharusnya', num: true },
      { label: 'Dibebankan', num: true }, { label: 'Selisih', num: true }, { label: '', cetakLepas: true }],
      rows, { minWidth: '980px' }));

    pc.appendChild(h('p', { class: 'hint wrap-normal', style: 'margin-top:8px' },
      'Kolom “seharusnya” dihitung ulang dari peredaran bruto masanya — setelah pembebasan Rp 500 juta yang kolom ' +
      'kumulatif di sebelahnya perlihatkan terpakai — setiap kali tabel ini dirender, bukan diambil ' +
      'dari angka yang dibukukan. Kalau sebuah masa tidak cocok, tabel ini yang bilang, beserta besarnya. ',
      pf.cocok ? '' : 'Sekarang ada masa yang tidak cocok — rencana JP-PPHFINAL di tab Penyesuaian menghitung kekurangannya dan menawarkan jurnalnya.'));
    pc.appendChild(h('p', { class: 'hint wrap-normal' },
      h('b', { text: 'Satu keberatan yang jujur untuk disebut. ' }),
      'Jurnal penyesuaian pendapatan diterima di muka menambah peredaran bruto AKUNTANSI sebesar ' + D.rupiah(8000000) +
      ' pada 31 Desember, jadi 0,5%-nya (' + D.rupiah(40000) + ') baru dibebankan lewat penyesuaian. Ada argumen yang ' +
      'sama kuatnya bahwa 0,5% atas uang muka itu sudah terutang di masa November, saat uangnya diterima, karena rezim ' +
      'final dijalankan atas penerimaan bruto bulanan. Halaman ini mengambil pandangan peredaran-bruto-akuntansi dan ' +
      'menyebut angka keduanya, alih-alih memilih salah satu tanpa bilang.'));
    p.appendChild(pc);

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Mengapa entitas ini sekaligus PKP dan pemakai rezim final 0,5%' }),
      h('p', { class: 'note wrap-normal', text: state.db.profil.pkpCatatan }),
      h('div', { class: 'rekon' },
        rekonBaris('Peredaran bruto setahun', l.peredaranBruto),
        rekonBaris('Tidak dikenai PPh — Rp 500 juta pertama, WP orang pribadi', -D.pphFinalDasar(0, l.peredaranBruto).bebasDipakai),
        rekonBaris('Dasar kena PPh final', D.pphFinalDasar(0, l.peredaranBruto).kena),
        rekonBaris('Batas rezim final PPh (PP 55/2022)', D.PPH_FINAL_BATAS_OMZET),
        rekonBaris('Batas wajib PKP (PMK 197/2013)', D.PPH_FINAL_BATAS_OMZET),
        h('div', { class: 'rekon-baris total sisa', style: '' },
          h('span', { class: 'wrap-normal', text: 'Ruang di bawah batas' }),
          h('span', { class: 'n', text: D.rupiah(D.PPH_FINAL_BATAS_OMZET - l.peredaranBruto) }))),
      h('p', { class: 'hint wrap-normal', text: 'Kedua batas itu angkanya sama, Rp 4,8 miliar. Di bawahnya, rezim final 0,5% berlaku dan pengukuhan PKP tidak wajib — tapi boleh atas permintaan sendiri, dan banyak UMKM memilih itu karena pembeli korporatnya minta faktur pajak. Hasilnya kombinasi yang di atas kertas terlihat aneh dan di lapangan biasa: PPh final 0,5%, sekaligus wajib memungut PPN.' })));
  }

  /* ================================================================== uji */

  function renderUji(p) {
    p.appendChild(kartuPeriksaHidup(false));

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Assertion suite' }));
    card.appendChild(h('p', { class: 'note wrap-normal' },
      'Berkas yang sama (', h('code', { text: 'tests.js' }), ') berjalan di halaman ini dan di bawah node. ' +
      'Yang paling menanggung beban, berurutan: persamaan akuntansi di setiap tanggal, pada buku kecil yang setiap ' +
      'angkanya ditulis di dalam berkas uji supaya bisa dihitung di atas kertas, lalu pada buku demo; laba bersih ' +
      'yang menyatu di empat laporan dan diturunkan ulang lewat jalur kelima; arus kas yang rekonsiliasi ke saldo ' +
      'kas buku besar; penolakan entri tak seimbang beserta besar selisihnya; jurnal penutup yang menihilkan setiap ' +
      'akun nominal tanpa menggeser neraca; jadwal penyusutan yang berjumlah tepat harga perolehan minus residu; ' +
      'dan tidak satu nilai pun berupa pecahan, ditelusuri dalam ke seluruh laporan.'));

    if (!state.tests) {
      card.appendChild(h('div', { class: 'empty', text: 'Uji sedang berjalan…' }));
      p.appendChild(card);
      return;
    }
    var run = state.tests;
    card.appendChild(h('div', { class: 'test-summary' },
      h('span', { class: 'pillbig ' + (run.failed ? 'fail' : 'pass'), text: run.failed ? run.failed + ' GAGAL' : run.passed + ' LULUS' }),
      h('span', { class: 'hint wrap-normal', text: run.passed + ' dari ' + run.total + ' assertion di ' + T.groups.length + ' grup · ' + run.ms + ' ms' }),
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
      box.appendChild(h('h4', { class: 'wrap-normal', text: g + '  ' + (list.length - gagal) + '/' + list.length }));
      list.forEach(function (x) {
        box.appendChild(h('div', { class: 'tcase ' + (x.ok ? 'ok' : 'no') },
          h('span', { class: 'mk', text: x.ok ? '✓' : '✗' }),
          h('span', { class: 'wrap-normal', text: x.name }),
          x.ok ? null : h('span', { class: 'msg wrap-normal', text: x.message })));
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

  /* ========================================================= persistence */

  /* Only the delta is stored: what the person did. On reload the seed book is
   * rebuilt and these are replayed into it. */
  function simpanEntri(e) {
    /* refNo, NOT ref.
     *
     * `ref` is an entry id — 'E479' — and entry ids are minted from a counter in
     * the book, by REPLAY POSITION. On reload the stored records are replayed
     * into a freshly seeded book and every id is minted again, so a stored
     * 'E479' points at whichever entry happens to land in position 479 this
     * time. Post a reversal, then post something dated earlier, reload, and the
     * reversal's reference had silently moved onto the OTHER entry: the audit
     * trail said the wrong document had been reversed, the original lost its
     * "already reversed" badge, and it could be reversed a second time —
     * Rp 10.000.000 of revenue moving with no user action and a green invariant
     * badge above it.
     *
     * The document number is the stable identity: it is unique per prefix, it
     * never changes once a user has seen it, and it is already stored. So the
     * reference travels as a number and is resolved back to an id on replay. The
     * old positional `ref` is still written for one release so a book saved by an
     * older build keeps working — muat() prefers refNo and falls back. */
    var refNo = null;
    if (e.ref) {
      var asal = L.cari(buku(), e.ref);
      refNo = asal ? asal.no : null;
    }
    St.add('entri', {
      k: e.id + '|' + e.no,
      v: {
        no: e.no, tgl: e.tgl, jenis: e.jenis, memo: e.memo,
        ref: e.ref, refNo: refNo,
        seq: e.seq, baris: e.baris, oleh: e.oleh, peran: e.peran
      }
    }).catch(function (err) {
      /* An append that collides means two tabs minted the same id, which is what
       * the write lock exists to prevent — say so rather than losing the entry
       * silently. */
      pesanTolak('Entri diposting ke buku di tab ini tetapi GAGAL disimpan.', [
        String(err && err.message || err),
        'Muat ulang halaman: entri ini tidak akan ada lagi. Kalau ini terjadi, kemungkinan besar ada tab lain yang juga menulis.'
      ]);
      renderPanel(state.view);
    });
  }

  function simpanTutup() {
    St.put('konfig', { k: 'tutup', v: buku().tutup });
  }

  /* Document numbers and entry ids come from counters in the book. After
   * replaying stored entries — which keep their original numbers, because a
   * document number a user has seen must not change on reload — the counters have
   * to be pushed past everything replayed, or the next new entry collides. */
  function sinkronNomor(b) {
    var maxSeq = 0;
    b.entries.forEach(function (e) {
      if (e.seq > maxSeq) maxSeq = e.seq;
      var bagi = String(e.no).split('-');
      if (bagi.length !== 2) return;
      var n = parseInt(bagi[1], 10);
      if (isNaN(n)) return;
      if (!b.nomorBerikut[bagi[0]] || b.nomorBerikut[bagi[0]] <= n) b.nomorBerikut[bagi[0]] = n + 1;
    });
    if (b.seqBerikut <= maxSeq) b.seqBerikut = maxSeq + 1;
  }

  function muat() {
    return Promise.all([St.all('entri'), St.all('draf'), St.get('konfig', 'peran'), St.get('konfig', 'tutup')])
      .then(function (r) {
        var entri = r[0] || [], draf = r[1] || [];
        if (r[2] && D.peran(r[2].v)) state.peran = r[2].v;
        state.draf = draf.map(function (x) { return x.v; }).filter(Boolean);

        /* Replay in ORIGINAL POSTING ORDER, which is the sequence number in the
         * stored key ('E479|JB-0003'), not the entry date.
         *
         * Sorting by date first put a backdated reversal BEFORE the entry it
         * reverses — legitimate: balikEntri dates the reversal on the report
         * date, which can be earlier than the original — and its reference then
         * could not resolve, so periksaEntri refused it and muat() dropped it.
         * Silently, and on every subsequent reload: the record stayed in
         * IndexedDB, permanently unloadable, while reported revenue moved by
         * Rp 10.000.000. Replaying in posting order guarantees a record's
         * referent is always already in the book, because a reference can only
         * ever point backwards in posting order. */
        function urutanSimpan(rec) {
          if (D.isInt(rec.v && rec.v.seq)) return rec.v.seq;
          var m = /^E(\d+)/.exec(String(rec.k));
          return m ? parseInt(m[1], 10) : 0;
        }
        entri.sort(function (a, b) {
          var ua = urutanSimpan(a), ub = urutanSimpan(b);
          if (ua !== ub) return ua - ub;
          return a.k < b.k ? -1 : 1;
        });

        /* Stored document number → the id it has been given in THIS replay, and
         * the same for the old positional id, so a book written by an older build
         * still resolves. */
        var petaNo = {}, petaId = {};
        var gagal = 0, gagalNo = [];
        entri.forEach(function (rec) {
          var v = rec.v;
          var idLama = String(rec.k).split('|')[0];
          var spec = {
            no: v.no, tgl: v.tgl, jenis: v.jenis, memo: v.memo,
            baris: v.baris, oleh: v.oleh, peran: v.peran, ref: null
          };
          if (v.refNo && petaNo[v.refNo]) spec.ref = petaNo[v.refNo];
          else if (v.ref && petaId[v.ref]) spec.ref = petaId[v.ref];
          else if (v.refNo || v.ref) spec.ref = v.refNo || v.ref;   // unresolvable: let periksaEntri refuse it loudly
          try {
            /* izinTerkunci: these entries were validated against the lock state
             * that existed when they were posted. Re-applying today's locks to
             * yesterday's entries would silently drop them, which is worse than
             * either outcome the lock is meant to produce. */
            var en = L.tambah(buku(), spec, { izinTerkunci: true, peran: 'supervisor' });
            petaNo[en.no] = en.id;
            petaId[idLama] = en.id;
          } catch (e) { gagal++; gagalNo.push(String(v.no || rec.k)); }
        });
        if (r[3] && r[3].v) buku().tutup = r[3].v;
        sinkronNomor(buku());
        if (gagal) {
          /* Named, and sticky. The user's only other signal that a stored
           * document did not come back is a figure that quietly changed. */
          pesanTolak(gagal + ' entri tersimpan tidak bisa dimuat kembali: ' + gagalNo.join(', ') + '.', [
            'Dokumen itu TIDAK ada di buku yang sedang Anda lihat, jadi angka di setiap laporan di halaman ini ' +
            'tidak memuatnya. Recordnya masih ada di IndexedDB dan tidak hilang.',
            'Ini bisa terjadi kalau bagan akun berubah sejak entri itu diposting, atau kalau entri itu mengacu ke ' +
            'dokumen lain yang juga tidak bisa dimuat.'
          ]);
        }
        invalidate();
      }).catch(function () { invalidate(); });
  }

  function hapusData() {
    return St.clearAll().then(function () {
      state.db = S.build();
      state.draf = [];
      state.entri = { tgl: AKHIR, jenis: 'umum', memo: '', baris: [barisKosong(), barisKosong(), barisKosong(), barisKosong()] };
      state.koreksiUntuk = null;
      invalidate();
      pesanOk('Data lokal dihapus.', ['Halaman kembali ke keadaan cat pertama: buku demo dari seed, tanpa satu pun entri Anda.']);
      say('Data lokal dihapus. Buku kembali ke keadaan awal dari seed.');
      renderAll();
    });
  }

  /* ============================================================= plumbing */

  var RENDER = {
    beranda: renderBeranda, bagan: renderBagan, jurnal: renderJurnal, besar: renderBesar,
    saldo: renderSaldo, sesuai: renderSesuai, laporan: renderLaporan, tutup: renderTutup,
    pajak: renderPajak, uji: renderUji
  };

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel) return;
    /* A control is mid-keystroke and its editing state lives on the element.
     * Remember what wanted rendering and do it when the hold is released. */
    if (tahan.el) { tahan.tunda = name; return; }
    /* Every render is a teardown, and a teardown throws keyboard focus to
     * <body>. Capturing the focused element's stable key first and restoring it
     * afterwards is the difference between a usable journal editor and one where
     * entering an amount costs the user twelve Tab presses. */
    var snap = captureFocus();
    sedangRender = true;
    try {
      clear(panel);
      try { RENDER[name](panel); }
      catch (e) {
        panel.appendChild(h('div', { class: 'callout bad wrap-normal' },
          h('b', { text: 'Panel gagal dirender. ' }), String(e && e.message || e)));
        if (window.console) console.error(e);
      }
    } finally { sedangRender = false; }
    renderPesanBar();
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

  /* `dariPapan` — activated from the keyboard rather than by pointer.
   *
   * Selecting the Jurnal tab used to set state.fokusKe = 'ju:tgl', which pulls
   * focus out of the tablist and into the date field. With roving tabindex that
   * is a dead end: ArrowRight from Beranda reached Bagan Akun, then Jurnal, and
   * then nothing — the arrows were being eaten by the date control's own segment
   * navigation, and the remaining seven tabs could not be reached by keyboard at
   * all. Recovery was Shift+Tab twice, which nobody can guess.
   *
   * So the convenience only applies to a pointer activation, where focus was
   * never in the tablist to begin with. Keyboard activation leaves focus on the
   * tab, which is the standard ARIA tabs behaviour and what the other nine tabs
   * already did. */
  function switchTab(name, dariPapan) {
    lepasTahan(true);
    state.view = name;
    if (!dariPapan && name === 'jurnal' && !state.koreksiUntuk) state.fokusKe = 'ju:tgl';
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
    if (tahan.el) { tahan.tundaSemua = true; return; }
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
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          var ujung = tabs[e.key === 'Home' ? 0 : tabs.length - 1];
          switchTab(ujung.id.replace('tab-', ''), true);
          ujung.focus();
          return;
        }
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var next = tabs[(idx + d + tabs.length) % tabs.length];
        switchTab(next.id.replace('tab-', ''), true);
        /* After switchTab, not before: switchTab rewrites every tab's tabIndex and
         * renders the panel, and focusing first meant the render could move focus
         * again. */
        next.focus();
      });
    });
  }

  /* ================================================================ boot */

  /* ONE tab writes; the others read. Entry ids and document numbers come from
   * counters in the book, and a book lives in a tab: two tabs both minting
   * JU-0479 means the second write destroys the first. */
  var LOCK_TTL = 9000, lockTimer = null;

  function pesanKunci(holder) {
    return 'Tab lain pada peramban ini sedang memegang kunci tulis' + (holder ? ' (' + holder + ')' : '') + '. ' +
      'Nomor dokumen dan id entri berasal dari pencacah di dalam buku, jadi dua tab yang memposting bersamaan akan ' +
      'mencetak nomor yang sama dan yang kedua akan menimpa dokumen yang pertama — sebuah entri jurnal yang sudah ' +
      'diposting hilang, atau dua entri berbagi satu nomor. Tab ini karena itu hanya membaca. Tutup tab yang lain, ' +
      'lalu muat ulang halaman ini.';
  }

  function ambilKunci(awal) {
    if (!state.tulis && !awal) return Promise.resolve({ ok: false, holder: state.lockPemilik });
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
      lihatKunciBebas();
    }, 3000);
  }

  function lihatKunciBebas() {
    return St.get('konfig', 'lock').then(function (rec) {
      var v = rec && rec.v;
      var bebas = !v || !v.tab || (Date.now() - (v.at || 0)) > LOCK_TTL;
      if (bebas && !state.lockBebas) {
        state.lockBebas = true;
        renderCtxBar();
        say('Kunci tulis sudah bebas. Muat ulang halaman untuk mulai memposting.');
      }
    });
  }

  function boot() {
    state.db = S.build();
    state.sampai = AKHIR;
    state.entri.tgl = AKHIR;

    /* The storage mode can flip at any moment — a browser set to block site data,
     * a database that goes away mid-session. When it does, the "penyimpanan:
     * memori" pill has to appear immediately, not at the next unrelated render:
     * a page that has quietly stopped persisting is exactly the page a user is
     * about to lose work in. */
    St.onChange = function () {
      try { renderCtxBar(); } catch (e) { }
      say('Penyimpanan lokal beralih ke memori: ' + St.reason + '. Perubahan di tab ini tidak akan bertahan setelah dimuat ulang.');
    };

    paintTheme();
    $('themeBtn').addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('testBadge').addEventListener('click', function () { switchTab('uji'); });
    $('bukuBadge').addEventListener('click', function () { switchTab('uji'); });
    if (window.BUKU_GUARD) window.BUKU_GUARD.onchange = paintNet;
    paintNet();
    paintTests();
    wireTabs();

    /* Reset control lives in the footer rather than a panel, because it is not a
     * feature — it is an escape hatch, and one a visitor should be able to find
     * without hunting through tabs. */
    var foot = document.querySelector('.foot');
    if (foot) {
      foot.appendChild(h('p', { class: 'small no-print' },
        h('button', {
          class: 'btn small ghost', type: 'button',
          onclick: function () { hapusData(); }
        }, 'Hapus data lokal saya'),
        ' — mengosongkan IndexedDB dan mengembalikan halaman ke buku demo dari seed.'));
    }

    ambilKunci(true).then(function () {
      return muat();
    }).then(function () {
      renderAll();
      mulaiDenyutKunci();
      setTimeout(runTests, 30);
    });

    window.addEventListener('pagehide', function () {
      if (state.tulis) St.unlock(state.tabId);
    });

    /* A background tab's timers are throttled, so its heartbeat can be minutes
     * late and another tab may have taken the lock in the meantime. Re-checking
     * the moment this tab becomes visible closes almost all of that window; the
     * rest is caught by the append-only write itself, which fails loudly on a key
     * that already exists rather than overwriting it. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (state.tulis) ambilKunci(); else lihatKunciBebas();
    });
    window.addEventListener('focus', function () {
      if (state.tulis) ambilKunci(); else lihatKunciBebas();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
