/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — app.js
 * The UI. Every rule it enforces lives in domain.js / solver.js / akademik.js;
 * this file renders them and never re-implements one. Where an action is
 * denied, the app renders the control and prints the reason instead of hiding
 * it — a school user who cannot see the rule cannot work around it either.
 *
 * Two things this file has to get right that are easy to miss:
 *  1. Every render tears the panel down and rebuilds it. That throws keyboard
 *     focus to <body>, which breaks the flagship timetable interaction for
 *     anyone not using a mouse. So focus is captured by a stable data-fkey
 *     before the teardown and restored after it.
 *  2. A rebuild announces nothing to a screen reader. The pick, the accept, the
 *     specific constraint rejection and the solver outcome are all written into
 *     one polite live region, because "the box turned red" is not an interface.
 */
(function () {
  'use strict';

  var D = window.SIAKAD_DOMAIN;
  var S = window.SIAKAD_DATA;
  var SV = window.SIAKAD_SOLVER;
  var A = window.SIAKAD_AKADEMIK;
  var St = window.SIAKAD_STORE;
  var T = window.SIAKAD_TESTS;

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
   * while(firstChild) removeChild(firstChild) loop is not equivalent: removing a
   * FOCUSED input fires blur synchronously, the blur handler re-renders, and the
   * loop then tries to remove a node that is no longer its child and throws. */
  function clear(el) { el.textContent = ''; }

  function tableOf(headers, rows, opts) {
    opts = opts || {};
    var thead = h('tr');
    headers.forEach(function (x) { thead.appendChild(h('th', { class: x.num ? 'num' : null, text: x.label !== undefined ? x.label : x })); });
    var tb = h('tbody');
    rows.forEach(function (r) { tb.appendChild(r); });
    var tbl = h('table', { style: opts.minWidth ? 'min-width:' + opts.minWidth : null }, h('thead', null, thead), tb);
    return h('div', { class: 'tbl-wrap' }, tbl);
  }

  function field(label, control) { return h('label', { class: 'field' }, h('span', { text: label }), control); }

  function select(options, value, onchange, attrs) {
    var sel = h('select', attrs || {});
    options.forEach(function (o) {
      sel.appendChild(h('option', { value: o.value, selected: String(o.value) === String(value) ? true : null, text: o.label }));
    });
    sel.addEventListener('change', function () { onchange(sel.value); });
    return sel;
  }

  var MP_CLASS = {};
  (function () {
    for (var i = 0; i < S.MAPEL.length; i++) MP_CLASS[S.MAPEL[i].id] = 'c' + ((i % 6) + 1);
  })();

  /* ------------------------------------------- focus & announcements ---- */

  // Focus keys must survive the attribute selector, so they carry no quotes.
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

  function restoreFocus(snap) {
    if (!snap) return;
    var el;
    try { el = document.querySelector('[data-fkey="' + snap.key + '"]'); } catch (e) { return; }
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e2) { try { el.focus(); } catch (e3) { return; } }
    if (snap.selStart !== undefined) {
      try { el.setSelectionRange(snap.selStart, snap.selEnd); } catch (e4) { /* not a text input */ }
    }
  }

  /* One polite live region for the whole app. Cleared first so that repeating
   * the same sentence (rejecting the same move twice) is still announced. */
  var sayTimer = null;
  function say(text) {
    var el = $('say');
    if (!el || !text) return;
    el.textContent = '';
    if (sayTimer) clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { el.textContent = text; }, 40);
  }

  /* --------------------------------------------------------------- state */

  var state = {
    school: null,
    ta: S.TA_AKTIF,
    semester: S.SEMESTER_AKTIF,
    role: 'admin',
    guruId: null,
    rombelId: null,
    nisn: null,
    // Keyed by tahun ajaran, exactly like nilai and presensi. See akademik.js.
    konfig: { bobot: {}, kkm: {} },
    nilaiOverrides: {},
    presensiOverrides: {},
    sikapOverrides: {},
    komiteOverrides: {},
    jadwal: {},        // ta -> { assign, stats, soft, skenario, at }
    spec: {},          // ta -> compiled-free spec used for rendering / validation
    picked: null,
    moveMsg: null,
    solving: false,
    solveNote: '',
    tests: null,
    audit: [],
    view: 'beranda',
    sel: {
      rombel: '', mapel: 'mtk', aspek: 'peng', jadwalMode: 'rombel', jadwalKey: '',
      raporNisn: '', pertemuan: 1, presensiMode: 'sesi', tanggal: '',
      komiteRombel: '', ppdbJalur: 'semua',
      cari: '', siswaRombel: 'semua', skenario: 'normal'
    }
  };

  function user() {
    if (state.role === 'guru') return { role: 'guru', guruId: state.guruId };
    if (state.role === 'wali') return { role: 'wali', guruId: state.guruId, rombelId: state.rombelId };
    if (state.role === 'ortu') return { role: 'ortu', nisn: state.nisn };
    return { role: 'admin' };
  }

  function ctx() {
    return {
      school: state.school,
      konfig: state.konfig,
      nilaiOverrides: state.nilaiOverrides,
      presensiOverrides: state.presensiOverrides,
      sikapOverrides: state.sikapOverrides
    };
  }

  function rombelList(ta) { return state.school.rombelByTa[ta] || []; }
  function rombelByName(ta, nama) {
    var l = rombelList(ta);
    for (var i = 0; i < l.length; i++) if (l[i].nama === nama) return l[i];
    return null;
  }
  function guruById(id) {
    for (var i = 0; i < state.school.guru.length; i++) if (state.school.guru[i].id === id) return state.school.guru[i];
    return null;
  }
  function mapelById(id) {
    for (var i = 0; i < state.school.mapel.length; i++) if (state.school.mapel[i].id === id) return state.school.mapel[i];
    return null;
  }
  function pengampuOf(ta, rombelNama, mapelId) {
    return state.school.pengampu[ta + '|' + rombelNama + '|' + mapelId];
  }
  function aspekDef(id) {
    for (var i = 0; i < D.ASPEK.length; i++) if (D.ASPEK[i].id === id) return D.ASPEK[i];
    return D.ASPEK[0];
  }

  function denial(res) {
    return h('div', { class: 'callout warn' },
      h('b', { text: 'Tindakan ditolak. ' }), res.reason);
  }

  /* A denial is only useful if the reader can see what the permitted path is.
   * This turns "you are not the pengampu" into one click that becomes them. */
  function jadiPengampu(pengampuId, label) {
    if (!pengampuId) return null;
    return h('button', {
      class: 'btn small', type: 'button',
      onclick: function () {
        state.role = 'guru';
        state.guruId = pengampuId;
        savePeran();
        say('Masuk sebagai ' + (guruById(pengampuId) || {}).nama);
        renderAll();
      }
    }, label || ('Masuk sebagai pengampu (' + (guruById(pengampuId) || {}).nama + ')'));
  }

  function jadiWali(rombel, label) {
    if (!rombel) return null;
    return h('button', {
      class: 'btn small', type: 'button',
      onclick: function () {
        state.role = 'wali';
        state.rombelId = rombel.id;
        state.guruId = rombel.waliGuruId;
        savePeran();
        say('Masuk sebagai wali kelas ' + rombel.nama);
        renderAll();
      }
    }, label || ('Masuk sebagai wali kelas ' + rombel.nama));
  }

  /* -------------------------------------------------------- persistence */

  function defaultKonfig() {
    return {
      bobot: JSON.parse(JSON.stringify(state.school.bobot)),
      kkm: JSON.parse(JSON.stringify(state.school.kkm))
    };
  }

  function loadAll() {
    return Promise.all([
      St.all('konfig'), St.all('nilai'), St.all('presensi'),
      St.all('jadwal'), St.all('komite'), St.all('audit'), St.all('sikap')
    ]).then(function (r) {
      (r[0] || []).forEach(function (rec) {
        if (!rec || !rec.k) return;
        var parts = String(rec.k).split('|');
        /* Records written before the configuration was year-scoped are dropped
         * rather than adopted: a bare 'bobot' record has no tahun ajaran and no
         * aspek, so there is no year it could honestly be applied to. */
        if ((rec.k === 'bobot' || rec.k === 'kkm') && !parts[1]) { St.del('konfig', rec.k); return; }
        if (parts[0] === 'bobot' && parts[1] && rec.v) state.konfig.bobot[parts[1]] = rec.v;
        if (parts[0] === 'kkm' && parts[1] && rec.v) state.konfig.kkm[parts[1]] = rec.v;
        if (rec.k === 'peran' && rec.v) {
          state.role = rec.v.role || 'admin';
          state.guruId = rec.v.guruId || null;
          state.rombelId = rec.v.rombelId || null;
          state.nisn = rec.v.nisn || null;
        }
      });
      (r[1] || []).forEach(function (rec) { state.nilaiOverrides[rec.k] = rec; });
      (r[2] || []).forEach(function (rec) { state.presensiOverrides[rec.k] = rec; });
      (r[3] || []).forEach(function (rec) { state.jadwal[rec.k] = rec.v; });
      (r[4] || []).forEach(function (rec) { state.komiteOverrides[rec.k] = rec; });
      state.audit = (r[5] || []).slice(-40).reverse();
      (r[6] || []).forEach(function (rec) { state.sikapOverrides[rec.k] = rec; });
    }).catch(function () { });
  }

  function saveKonfig(ta) {
    St.put('konfig', { k: 'bobot|' + ta, v: state.konfig.bobot[ta] });
    St.put('konfig', { k: 'kkm|' + ta, v: state.konfig.kkm[ta] });
  }
  function savePeran() {
    St.put('konfig', {
      k: 'peran',
      v: { role: state.role, guruId: state.guruId, rombelId: state.rombelId, nisn: state.nisn }
    });
  }
  function audit(aksi, detail) {
    var rec = { aksi: aksi, detail: detail, peran: state.role, aktor: state.guruId || state.nisn || 'TU', at: Date.now() };
    state.audit.unshift(rec);
    if (state.audit.length > 40) state.audit.pop();
    St.audit(rec);
  }

  /* ------------------------------------------------------------- header */

  function paintNet() {
    var g = window.SIAKAD_GUARD;
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
    St.writeLocal('siakad.theme', next);
    paintTheme();
    say(next === 'dark' ? 'Tema gelap aktif.' : 'Tema terang aktif.');
  }

  /* ------------------------------------------------------------ ctx bar */

  function renderCtxBar() {
    var bar = $('ctxbar');
    clear(bar);

    bar.appendChild(field('Tahun ajaran', select(
      state.school.sekolah.taList.map(function (t) { return { value: t, label: t }; }),
      state.ta,
      function (v) {
        state.ta = v; state.sel.rombel = ''; state.sel.komiteRombel = ''; state.sel.raporNisn = '';
        state.sel.tanggal = ''; state.picked = null;
        say('Tahun ajaran ' + v);
        renderAll();
      }, { 'data-fkey': 'ctx:ta' }
    )));

    var stG = S.statusSemester(state.ta, 'ganjil');
    var stP = S.statusSemester(state.ta, 'genap');
    function semLabel(base, st) {
      return base + (st === 'selesai' ? '' : st === 'berjalan' ? ' — sedang berjalan' : ' — belum mulai');
    }
    bar.appendChild(field('Semester', select(
      [{ value: 'ganjil', label: semLabel('Ganjil (Jul–Des)', stG) },
      { value: 'genap', label: semLabel('Genap (Jan–Jun)', stP) }],
      state.semester,
      function (v) {
        state.semester = v; state.sel.tanggal = ''; state.sel.pertemuan = 1;
        say('Semester ' + v + ', ' + S.statusSemester(state.ta, v));
        renderAll();
      }, { 'data-fkey': 'ctx:sem' }
    )));

    bar.appendChild(field('Masuk sebagai', select(
      D.ROLES.map(function (r) { return { value: r.id, label: r.label }; }),
      state.role,
      function (v) {
        state.role = v;
        if (v === 'guru' && !state.guruId) state.guruId = state.school.guru[3].id;
        if (v === 'wali') {
          var rb = rombelList(state.ta)[0];
          state.rombelId = rb.id; state.guruId = rb.waliGuruId;
        }
        if (v === 'ortu' && !state.nisn) state.nisn = rombelList(state.ta)[0].siswa[0];
        savePeran();
        say('Peran: ' + v);
        renderAll();
      }, { 'data-fkey': 'ctx:role' }
    )));

    if (state.role === 'guru') {
      bar.appendChild(field('Guru', select(
        state.school.guru.map(function (g) { return { value: g.id, label: g.id + ' — ' + g.nama }; }),
        state.guruId, function (v) { state.guruId = v; savePeran(); renderAll(); },
        { 'data-fkey': 'ctx:guru' }
      )));
    } else if (state.role === 'wali') {
      bar.appendChild(field('Wali kelas dari', select(
        rombelList(state.ta).map(function (r) { return { value: r.id, label: r.nama + ' — ' + (guruById(r.waliGuruId) || {}).nama }; }),
        state.rombelId, function (v) {
          state.rombelId = v;
          var rb = null;
          rombelList(state.ta).forEach(function (r) { if (r.id === v) rb = r; });
          if (rb) state.guruId = rb.waliGuruId;
          savePeran(); renderAll();
        }, { 'data-fkey': 'ctx:wali' }
      )));
    } else if (state.role === 'ortu') {
      var opts = [];
      rombelList(state.ta).forEach(function (r) {
        r.siswa.forEach(function (n) { opts.push({ value: n, label: r.nama + ' — ' + state.school.siswa[n].nama }); });
      });
      bar.appendChild(field('Anak', select(opts, state.nisn, function (v) {
        state.nisn = v; state.sel.raporNisn = v; savePeran(); renderAll();
      }, { 'data-fkey': 'ctx:anak' })));
    }

    var roleDef = null;
    D.ROLES.forEach(function (r) { if (r.id === state.role) roleDef = r; });
    bar.appendChild(h('p', { class: 'ctx-note' },
      h('span', { class: 'rolechip', text: roleDef.label }), ' ', roleDef.note,
      h('br'),
      h('span', {
        class: 'small',
        text: 'Tanggal acuan demo: ' + S.SEKARANG_LABEL + ' · ' + D.KURIKULUM.nama +
          ' · penyimpanan: ' + (St.mode === 'idb' ? 'IndexedDB' : 'memori (' + St.reason + ')')
      })
    ));
  }

  /* ============================================================ BERANDA == */

  function renderBeranda(p) {
    var sc = state.school;
    var rb = rombelList(state.ta);
    var aktif = rb.reduce(function (a, r) { return a + r.siswa.length; }, 0);
    var totalJp = sc.mapel.reduce(function (a, m) { return a + m.jp; }, 0);
    var jd = state.jadwal[state.ta];
    var kal = S.kalenderSemester(state.ta, state.semester);
    var stSem = S.statusSemester(state.ta, state.semester);

    var stats = h('div', { class: 'summary' });
    function stat(k, v, n) { stats.appendChild(h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), n ? h('div', { class: 'n', text: n }) : null)); }
    stat('Tahun ajaran', state.ta, 'semester ' + state.semester + ' — ' + stSem);
    stat('Peserta didik', String(aktif), 'terdaftar pada ' + state.ta);
    stat('Rombel', String(rb.length), rb.map(function (r) { return r.nama; }).join(' '));
    stat('Guru', String(sc.guru.length), 'mengampu ' + sc.mapel.length + ' mapel');
    stat('Beban kurikulum', totalJp + ' JP', S.JP_INTRA + ' intra + ' + S.JP_MULOK + ' mulok, per rombel/minggu');
    stat('Hari efektif', kal ? String(kal.hariEfektif.length) : '—', kal ? kal.mulai + ' → ' + kal.selesai : '');
    /* The live soft score is jd.soft, rescored after every accepted manual
     * move; jd.stats is the solver run's own report and does not follow the
     * board. Reading stats here is how this tile ends up quoting a figure the
     * move confirmation has already contradicted. */
    var jdSoft = jd && jd.soft ? jd.soft.total : (jd && jd.stats ? jd.stats.softAkhir : null);
    stat('Jadwal', jd ? (jd.assign ? 'tersusun' : 'gagal') : 'belum', jd && jd.stats ? (jd.stats.msTotal + ' ms · skor lunak ' + jdSoft) : 'buka tab Jadwal');
    p.appendChild(stats);

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Apa yang sebenarnya dikerjakan aplikasi ini' }),
      h('p', { class: 'note', text: 'Bagian tersulitnya bukan CRUD siswa. Empat hal di bawah ini yang menentukan apakah sebuah SIAKAD bisa dipakai sekolah sungguhan.' }),
      h('div', { class: 'grid2' },
        h('div', null,
          h('p', null, h('b', { text: '1. Jadwal sebagai constraint satisfaction problem. ' }),
            'Guru tidak bisa berada di dua ruang sekaligus, rombel tidak bisa mengikuti dua mapel sekaligus, ruang tidak bisa dipakai dua kelas sekaligus, ketidaksediaan guru harus dihormati, dan JP tiap mapel harus terpenuhi persis. Solver di sini backtracking dengan forward checking dan heuristik dom/wdeg — bukan penempatan acak yang lalu ditambal.'),
          h('p', { style: 'margin-top:8px' }, h('b', { text: '2. Semuanya berlingkup tahun ajaran — termasuk konfigurasinya. ' }),
            'Rombel 8B tahun 2025/2026 dan 8B tahun 2026/2027 adalah dua objek berbeda berisi anak berbeda. Bobot penilaian dan KKM juga disimpan per tahun ajaran, karena sekolah merevisi KKM di KOSP setiap tahun dan rapor yang sudah ditandatangani harus tetap memakai KKM yang berlaku saat itu. Satu peta bobot global berarti sekali sunting menulis ulang seluruh rapor yang pernah terbit.')),
        h('div', null,
          h('p', null, h('b', { text: '3. Penilaian K13 yang utuh. ' }),
            'Setiap mapel punya dua nilai yang tidak pernah bercampur: KI-3 pengetahuan (tugas/UH/PTS/PAS) dan KI-4 keterampilan (praktik/produk/proyek/portofolio), masing-masing dengan predikat dan deskripsi capaian sendiri, ditambah sikap spiritual dan sosial dari wali kelas. Rapor dengan satu angka per mapel bukan dokumen yang bisa diterbitkan SMP.'),
          h('p', { style: 'margin-top:8px' }, h('b', { text: '4. Waktu itu nyata. ' }),
            'Komponen penilaian baru muncul setelah jendela penilaiannya lewat, presensi hanya ada untuk hari yang benar-benar sudah terjadi, dan rapor untuk semester yang belum berjalan ditolak — bukan ditampilkan kosong. SIAKAD pada pekan keenam memang sebagian besar sel kosong.')))));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Identitas: tiga nomor yang sering dikira satu' }),
      h('p', { class: 'note' },
        'NISN (nasional, 10 digit, sekali seumur hidup), NIS (lokal sekolah) dan nomor absen (posisi di rombel, diturunkan ulang tiap tahun) adalah tiga hal berbeda. Menyamakannya sama saja dengan memakai nomor ranjang sebagai nomor rekam medis. Rombel di sekolah ini diacak ulang tiap kenaikan kelas, jadi ',
        h('b', { text: 'nomor absen anak yang sama memang berubah' }), ' antara ' + S.TA_LALU + ' dan ' + S.TA_AKTIF + ' — buka kolom Riwayat di tab Peserta Didik.')));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Privasi: ini catatan anak' }),
      h('p', { class: 'note' },
        'Data peserta didik adalah kategori paling sensitif setelah rekam medis. Karena itu: seluruh isi halaman ini fabrikasi, tidak ada NIK, tidak ada NIP, tidak ada nomor telepon orang tua sama sekali, dan tidak satu pun byte yang meninggalkan tab ini. Penghitung jaringan di header tetap ',
        h('b', { text: 'nol' }),
        '. Suntingan Anda tersimpan di IndexedDB peramban ini saja. Tombol di bawah menghapusnya kembali ke keadaan awal.'),
      h('div', { class: 'controls' },
        h('button', {
          class: 'btn', type: 'button', onclick: function () {
            /* Synchronously, before the clear even resolves: a solve still
             * running would otherwise put the timetable and an audit row back
             * into the store the visitor just emptied, and "dihapus" would be
             * a lie for as long as the search lasts. */
            liveReq = null;
            state.solving = false;
            state.solveNote = '';
            St.clearAll().then(function () {
              state.nilaiOverrides = {}; state.presensiOverrides = {};
              state.komiteOverrides = {}; state.sikapOverrides = {};
              state.jadwal = {}; state.audit = [];
              state.konfig = defaultKonfig();
              say('Seluruh data tersimpan dihapus.');
              renderAll();
            });
          }
        }, 'Hapus seluruh data tersimpan'),
        h('span', { class: 'hint', text: 'Data turunan (nilai & presensi sintetis) dibangun ulang dari seed ' + state.school.sekolah.seed + ', jadi halaman tetap hidup setelah dihapus.' }))));

    var auditRows = state.audit.slice(0, 12).map(function (a) {
      return h('tr', null,
        h('td', { class: 'mono', text: new Date(a.at).toLocaleString('id-ID') }),
        h('td', null, h('span', { class: 'pill', text: a.peran })),
        h('td', { text: a.aktor }),
        h('td', { text: a.aksi }),
        h('td', { style: 'white-space:normal', text: a.detail }));
    });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Jejak audit' }),
      h('p', { class: 'note', text: 'Setiap perubahan nilai, presensi, sikap, jadwal, bobot dan pembayaran ditulis ke jejak append-only. Sistem sekolah tanpa jejak audit tidak bisa dipertanggungjawabkan: "nilainya berubah dan tidak ada yang tahu siapa" adalah keluhan yang mengakhiri satu kontrak.' }),
      auditRows.length
        ? tableOf(['Waktu', 'Peran', 'Aktor', 'Aksi', 'Detail'], auditRows)
        : h('div', { class: 'empty', text: 'Belum ada perubahan. Coba sunting nilai di tab Penilaian atau pindahkan sesi di tab Jadwal.' })));
  }

  /* ====================================================== PESERTA DIDIK == */

  function renderSiswa(p) {
    var can = D.can(user(), 'siswa.read', {});
    if (!can.allowed) {
      p.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Daftar peserta didik' }), denial(can),
        h('p', { class: 'hint', text: 'Akun orang tua tetap bisa membuka rapor dan tagihan komite anaknya sendiri di tab masing-masing.' })));
      return;
    }

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Tiga nomor yang sering dikira satu' }),
      h('div', { class: 'grid2' },
        h('dl', { class: 'kv' },
          h('dt', { text: 'NISN' }), h('dd', { style: 'font-family:inherit' }, '10 digit, nasional, diterbitkan sekali seumur hidup dan tidak pernah dipakai ulang — termasuk setelah lulus atau pindah. Ini kunci gabung untuk apa pun yang bersifat riwayat.'),
          h('dt', { text: 'NIS' }), h('dd', { style: 'font-family:inherit' }, 'Nomor induk lokal sekolah, diberikan saat diterima, memuat tahun masuk. Unik di sekolah ini saja.'),
          h('dt', { text: 'Absen' }), h('dd', { style: 'font-family:inherit' }, 'Posisi urut abjad di dalam rombel. Diturunkan ulang setiap tahun ajaran, jadi berubah ketika rombelnya berubah. Bukan identitas.')),
        h('p', { class: 'hint' }, 'Di demo ini NISN berasal dari blok sintetis ', h('code', { text: '99xxxxxxxx' }),
          ' yang diterbitkan registry di dalam ', h('code', { text: 'domain.js' }),
          '. Registry menolak menerbitkan nomor yang sama dua kali, dan tab Uji membuktikannya dengan 3.000 penerbitan berturut-turut. Rombel diacak ulang tiap kenaikan kelas, jadi kolom Riwayat memperlihatkan anak yang sama dengan huruf rombel dan nomor absen yang berbeda.'))));

    var rb = rombelList(state.ta);
    var opts = [{ value: 'semua', label: 'Semua rombel (' + state.ta + ')' }].concat(
      rb.map(function (r) { return { value: r.nama, label: r.nama + ' (' + r.siswa.length + ')' }; }));

    var kontrol = h('div', { class: 'controls' },
      field('Rombel', select(opts, state.sel.siswaRombel, function (v) { state.sel.siswaRombel = v; renderPanel('siswa'); }, { 'data-fkey': 'siswa:rombel' })),
      field('Cari nama / NISN / NIS', h('input', {
        type: 'search', value: state.sel.cari, placeholder: 'ketik untuk menyaring',
        'data-fkey': 'siswa:cari',
        oninput: function (e) { state.sel.cari = e.target.value; renderPanel('siswa'); }
      })));

    var list = [];
    rb.forEach(function (r) {
      if (state.sel.siswaRombel !== 'semua' && r.nama !== state.sel.siswaRombel) return;
      r.siswa.forEach(function (n) { list.push({ nisn: n, rombel: r }); });
    });
    var q = state.sel.cari.trim().toLowerCase();
    if (q) list = list.filter(function (x) {
      var s = state.school.siswa[x.nisn];
      return s.nama.toLowerCase().indexOf(q) >= 0 || s.nisn.indexOf(q) >= 0 || s.nis.indexOf(q) >= 0;
    });

    var rows = list.slice(0, 260).map(function (x) {
      var s = state.school.siswa[x.nisn];
      var e = s.enrol[state.ta];
      var lain = Object.keys(s.enrol).filter(function (t) { return t !== state.ta; });
      return h('tr', null,
        h('td', { class: 'num', text: String(e.absen) }),
        h('td', null, h('button', {
          class: 'linkbtn', type: 'button', text: s.nama,
          'data-fkey': 'siswa:nama:' + fkey(s.nisn),
          onclick: function () { state.sel.raporNisn = s.nisn; switchTab('rapor'); }
        })),
        h('td', { class: 'mono', text: s.nisn }),
        h('td', { class: 'mono', text: s.nis }),
        h('td', { text: x.rombel.nama }),
        h('td', { text: s.jk }),
        h('td', { class: 'mono', text: s.tglLahir }),
        h('td', null, s.kip ? h('span', { class: 'pill info', text: 'KIP' }) : ''),
        h('td', { style: 'white-space:normal', class: 'small' },
          lain.length
            ? lain.map(function (t) { return t + ': ' + s.enrol[t].rombelNama + ' abs ' + s.enrol[t].absen; }).join(' · ')
            : h('span', { class: 'hint', text: 'tidak ada riwayat tahun lain' })),
        h('td', { style: 'white-space:normal', class: 'small' },
          s.catatan ? h('span', { class: 'pill warn', text: s.catatan }) : ''));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Peserta didik — ' + state.ta }),
        h('span', { class: 'hint', text: list.length + ' siswa' + (list.length > 260 ? ' (260 pertama ditampilkan)' : '') })),
      h('p', { class: 'note', text: 'Kolom "Riwayat" menunjukkan rombel dan nomor absen anak yang sama pada tahun ajaran lain — keduanya berubah, karena rombel diacak ulang setiap kenaikan kelas. Kolom itu kosong untuk siswa kelas 7 karena mereka memang belum ada di sekolah ini tahun lalu, bukan karena datanya hilang. Kolom "Catatan" memuat kasus yang mematahkan asumsi tingkat = fungsi(angkatan): satu anak tinggal kelas, satu mutasi masuk, satu mutasi keluar.' }),
      kontrol,
      rows.length
        ? tableOf([{ label: 'Absen', num: true }, 'Nama', 'NISN', 'NIS', 'Rombel', 'JK', 'Tgl lahir', '', 'Riwayat', 'Catatan'], rows, { minWidth: '960px' })
        : h('div', { class: 'empty', text: 'Tidak ada yang cocok.' })));
  }

  /* ================================================================ GURU == */

  function renderGuru(p) {
    var spec = state.spec[state.ta];
    var bebanJadwal = {};
    if (spec) spec.sesi.forEach(function (s) { bebanJadwal[s.guruId] = (bebanJadwal[s.guruId] || 0) + s.len; });
    var beban = S.hitungBebanGuru(state.school, state.ta);
    var kurang = state.school.guru.filter(function (g) { return !beban[g.id].memenuhiMinimal; });

    var rows = state.school.guru.map(function (g) {
      var m = mapelById(g.mapelUtama);
      var m2 = g.mapelKedua ? mapelById(g.mapelKedua) : null;
      var wali = [];
      rombelList(state.ta).forEach(function (r) { if (r.waliGuruId === g.id) wali.push(r.nama); });
      var un = g.tidakTersedia;
      var ringkas = '';
      if (un.length) {
        var byHari = {};
        un.forEach(function (u) { (byHari[u.hari] = byHari[u.hari] || []).push(u.slot); });
        ringkas = Object.keys(byHari).map(function (d) {
          var sl = byHari[d];
          return S.HARI[d].label + ' JP ' + Math.min.apply(null, sl) + '–' + Math.max.apply(null, sl);
        }).join(', ');
      }
      var b = beban[g.id];
      return h('tr', null,
        h('td', { class: 'mono', text: g.id }),
        h('td', { style: 'white-space:normal', text: g.nama }),
        h('td', { style: 'white-space:normal' }, m ? m.nama : '', m2 ? h('span', { class: 'hint', text: ' + ' + m2.nama } ) : null),
        h('td', { class: 'num', text: String(b.jp) }),
        h('td', null, b.memenuhiMinimal
          ? h('span', { class: 'pill ok', text: '≥ ' + S.JP_MINIMAL_SERTIFIKASI + ' JP' })
          : h('span', { class: 'pill warn', text: 'kurang ' + b.kurang + ' JP' })),
        h('td', { class: 'num', text: String(bebanJadwal[g.id] || 0) }),
        h('td', { class: 'num', text: String(g.maxJamHarian) }),
        h('td', { text: wali.join(', ') || '—' }),
        h('td', { style: 'white-space:normal' },
          ringkas ? h('span', null, ringkas, g.alasanTidakTersedia ? h('span', { class: 'hint', text: ' — ' + g.alasanTidakTersedia }) : null) : h('span', { class: 'hint', text: 'selalu tersedia' })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Guru, beban mengajar dan ketidaksediaan' }),
      h('p', { class: 'note', text: 'Empat belas guru untuk delapan rombel. Kebutuhan riil ' + (rombelList(state.ta).length * 40) + ' JP per minggu, dan batas beban penuh yang mengatur tunjangan sertifikasi adalah ' + S.JP_MINIMAL_SERTIFIKASI + ' JP — jadi jumlah guru yang jujur memang sekitar tiga belas setengah, bukan dua puluh empat. Beban yang longgar diam-diam menghapus kendala yang membuat penyusunan jadwal sulit.' }),
      kurang.length
        ? h('div', { class: 'callout warn' },
          h('b', { text: kurang.length + ' guru belum mencapai ' + S.JP_MINIMAL_SERTIFIKASI + ' JP. ' }),
          kurang.map(function (g) { return g.nama.replace(/,.*$/, ''); }).join(', ') +
          '. Ini bukan bug data: guru yang kekurangan jam memang lazim, dan itulah alasan mereka juga mengajar di sekolah lain — yang muncul kembali sebagai kendala ketidaksediaan pada solver jadwal.')
        : h('div', { class: 'callout ok' }, 'Seluruh guru memenuhi beban minimal ' + S.JP_MINIMAL_SERTIFIKASI + ' JP.'),
      h('p', { class: 'hint' },
        h('b', { text: 'Tidak ada kolom NIP, dan itu disengaja. ' }),
        'NIP yang benar 18 digit dan tersusun dari tanggal lahir, TMT, kode jenis kelamin dan nomor urut; NIP yang dipalsukan dengan bentuk yang benar berpeluang besar menjadi NIP pegawai sungguhan, dan NIP dipublikasikan di SK. NIP yang jelas-jelas tidak ada terbaca sebagai keputusan; NIP yang panjangnya salah terbaca sebagai ketidaktahuan.'),
      tableOf(['ID', 'Nama', 'Mapel diampu', { label: 'Beban kurikulum', num: true }, 'Status beban',
        { label: 'JP di jadwal', num: true }, { label: 'Maks JP/hari', num: true }, 'Wali kelas', 'Tidak tersedia'],
        rows, { minWidth: '980px' })));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Struktur kurikulum — ' + D.KURIKULUM.nama }),
      h('p', { class: 'note', text: D.KURIKULUM.dasar + '. ' + D.KURIKULUM.catatan }),
      tableOf(['Kelompok', 'Mata pelajaran', { label: 'JP/minggu', num: true }, 'Pemecahan blok', { label: 'KKM ' + state.ta, num: true }, 'Ruang khusus'],
        state.school.mapel.map(function (m) {
          return h('tr', null,
            h('td', { text: m.kelompok === 'mulok' ? 'Mulok' : 'Kelompok ' + m.kelompok }),
            h('td', { style: 'white-space:normal' }, m.nama, m.pilihan ? h('span', { class: 'hint', text: ' — ' + m.pilihan }) : null),
            h('td', { class: 'num', text: String(m.jp) }),
            h('td', { class: 'mono small', text: m.blok.map(function (b) { return b.len + ' JP'; }).join(' + ') }),
            h('td', { class: 'num', text: String(A.kkmFor(ctx(), state.ta, m.id)) }),
            h('td', { text: m.blok.filter(function (b) { return b.ruang; }).map(function (b) { return S.RUANG_TIPE[b.ruang]; }).join(', ') || '—' }));
        }).concat([h('tr', null,
          h('td', null, h('b', { text: 'Total' })), h('td', null, h('b', { text: S.JP_INTRA + ' JP intrakurikuler + ' + S.JP_MULOK + ' JP mulok' })),
          h('td', { class: 'num' }, h('b', { text: String(state.school.mapel.reduce(function (a, m) { return a + m.jp; }, 0)) })),
          h('td', { class: 'small', text: 'kapasitas kalender ' + S.HARI.reduce(function (a, x) { return a + x.slots; }, 0) + ' JP' }),
          h('td', ''), h('td', ''))]),
        { minWidth: '820px' })));
  }

  /* ============================================================== ROMBEL == */

  function renderRombel(p) {
    var rows = rombelList(state.ta).map(function (r) {
      var wali = guruById(r.waliGuruId);
      var ruang = null;
      state.school.ruang.forEach(function (x) { if (x.id === r.ruangId) ruang = x; });
      var l = 0, pr = 0;
      r.siswa.forEach(function (n) { if (state.school.siswa[n].jk === 'L') l++; else pr++; });
      var mapelWali = state.school.mapel.filter(function (m) {
        return pengampuOf(state.ta, r.nama, m.id) === r.waliGuruId;
      }).map(function (m) { return m.kode; });
      return h('tr', null,
        h('td', null, h('b', { text: r.nama })),
        h('td', { class: 'num', text: String(r.tingkat) }),
        h('td', { class: 'num', text: String(r.siswa.length) }),
        h('td', { class: 'num mono', text: l + ' / ' + pr }),
        h('td', { style: 'white-space:normal', text: wali ? wali.nama : '—' }),
        h('td', { class: 'mono small', text: mapelWali.join(' ') || '—' }),
        h('td', { text: ruang ? ruang.nama : '—' }),
        h('td', { class: 'mono small', text: r.id }));
    });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Rombongan belajar — ' + state.ta }),
      h('p', { class: 'note' }, 'Kunci rombel adalah pasangan ', h('code', { text: '(tahun ajaran, nama)' }),
        ', bukan nama saja. Kolom terakhir memperlihatkan kuncinya apa adanya: 8B tahun ini dan 8B tahun lalu adalah dua baris berbeda berisi anak berbeda. Ini yang membuat rapor lama tidak tertimpa ketika anak naik kelas.'),
      h('p', { class: 'note' }, h('b', { text: 'Wali kelas selalu salah satu pengampu rombelnya sendiri. ' }),
        'Kolom "Mapel wali di rombel ini" membuktikannya. Itu bukan kerapian: aturan aplikasi ini adalah wali kelas boleh membaca seluruh nilai rombelnya tapi hanya menulis mapelnya sendiri, jadi wali yang tidak mengajar apa pun di kelasnya tidak punya kewenangan tulis sama sekali di kelas yang rapornya ia tanda tangani.'),
      tableOf(['Rombel', { label: 'Tingkat', num: true }, { label: 'Siswa', num: true }, { label: 'L/P', num: true },
        'Wali kelas', 'Mapel wali di rombel ini', 'Ruang', 'Kunci internal'], rows, { minWidth: '820px' })));

    var lain = state.school.sekolah.taList.filter(function (t) { return t !== state.ta; });
    if (lain.length) {
      var rows2 = [];
      lain.forEach(function (t) {
        rombelList(t).forEach(function (r) {
          rows2.push(h('tr', null, h('td', { text: t }), h('td', { text: r.nama }),
            h('td', { class: 'num', text: String(r.siswa.length) }),
            h('td', { class: 'mono small', text: r.id })));
        });
      });
      p.appendChild(h('div', { class: 'card' },
        h('h3', { text: 'Rombel tahun ajaran lain' }),
        h('p', { class: 'note', text: 'Perhatikan bahwa jumlah rombel per tahun berbeda: angkatan yang lulus menghilang, angkatan baru muncul. Struktur sekolah bukan konstanta.' }),
        tableOf(['Tahun ajaran', 'Rombel', { label: 'Siswa', num: true }, 'Kunci internal'], rows2)));
    }
  }

  /* ============================================================== JADWAL == */

  var worker = null, workerBroken = false, reqSeq = 0;

  /* A solve takes seconds, and in those seconds the visitor can change the
   * tahun ajaran, change the skenario, or empty the store. So every request
   * carries a snapshot of what it actually asked for, and the result is judged
   * against that snapshot rather than against whatever the page holds when it
   * lands. pending maps reqId -> snapshot; liveReq is the one request whose
   * result is still wanted, and setting it to null is how a wipe cancels a
   * search that would otherwise write the timetable straight back. */
  var pending = {}, liveReq = null;

  function ensureWorker() {
    if (worker || workerBroken) return worker;
    try {
      worker = new Worker('solver.worker.js');
      worker.onmessage = onWorkerMessage;
      worker.onerror = function () { workerBroken = true; worker = null; };
    } catch (e) { workerBroken = true; worker = null; }
    return worker;
  }

  function noteWorkerNet(m) {
    if (window.SIAKAD_GUARD && window.SIAKAD_GUARD.noteExternal) {
      window.SIAKAD_GUARD.noteExternal(m.kind, m.target, 'worker');
    }
  }

  function onWorkerMessage(ev) {
    var m = ev.data || {};
    /* The page's meta CSP does NOT apply to a dedicated worker's global scope,
     * so the worker installs its own wrappers and reports attempts back here.
     * Without this the header counter would be a claim about the document only,
     * while the footer sentence talks about the whole page. */
    if (m.type === 'net') { noteWorkerNet(m); return; }
    var req = pending[m.reqId];
    delete pending[m.reqId];
    if (m.type === 'error') {
      if (req !== liveReq) return;
      liveReq = null;
      state.solving = false;
      state.solveNote = 'Worker melempar: ' + m.message;
      say('Penyusunan jadwal gagal: ' + m.message);
      paintSolveResult();
      return;
    }
    finishSolve(m, req);
  }

  /* The result can land while the visitor is reading another tab: the Beranda
   * tile and the jejak audit both report on the timetable, so redraw what is
   * actually on screen as well as the board itself. The visible panel goes
   * last, because every render restores keyboard focus. */
  function paintSolveResult() {
    renderPanel('jadwal');
    if (state.view !== 'jadwal') renderPanel(state.view);
  }

  // Applies whatever the solver produced, but only after re-verifying it here,
  // in the page, against the spec that was sent with the request. A schedule
  // that fails is reported, never rendered; a schedule belonging to a request
  // the page has since abandoned is dropped without a word.
  function finishSolve(m, req) {
    if (!req || req !== liveReq) return;
    liveReq = null;
    state.solving = false;
    var spec = req.spec;
    if (m.ok) {
      var check = SV.verify(spec, m.assign);
      if (!check.ok) {
        // Name the year and skenario: the visitor may well be looking at another.
        state.solveNote = 'Jadwal ' + req.ta + ' (skenario ' + req.skenario +
          ') ditolak di sisi halaman: ' + check.violations[0].pesan;
        say(state.solveNote);
        paintSolveResult();
        return;
      }
      // The board and the spec it is validated against have to be the same pair.
      state.spec[req.ta] = spec;
      state.jadwal[req.ta] = {
        assign: m.assign, stats: m.stats, soft: m.soft,
        skenario: req.skenario, at: Date.now(), verifikasi: check
      };
      St.put('jadwal', { k: req.ta, v: state.jadwal[req.ta] });
      state.solveNote = '';
      audit('jadwal disusun', req.ta + ' · skenario ' + req.skenario + ' · ' + m.stats.msTotal + ' ms');
      say('Jadwal ' + req.ta + ' tersusun dalam ' + m.stats.msTotal + ' milidetik, ' + m.stats.backtrack +
        ' backtrack. Verifikasi ulang: nol pelanggaran kendala keras.');
    } else {
      state.jadwal[req.ta] = { assign: null, stats: m.stats, diagnosis: m.diagnosis, skenario: req.skenario, at: Date.now() };
      state.solveNote = '';
      say('Jadwal ' + req.ta + ' tidak tersusun. ' + (m.diagnosis ? m.diagnosis.judul : ''));
    }
    paintSolveResult();
  }

  var SKENARIO = [
    { id: 'normal', label: 'Normal (ketidaksediaan seperti yang dideklarasikan guru)', apply: null },
    {
      id: 'rapat', label: 'Rapat dinas seluruh guru — Senin JP 1–4',
      apply: function (g) { for (var s = 1; s <= 4; s++) g.tidakTersedia.push({ hari: 0, slot: s }); g.alasanTidakTersedia = 'rapat dinas Senin pagi'; }
    },
    {
      id: 'padat', label: 'Jam terakhir Senin–Rabu ditiadakan (kapasitas nyaris habis)',
      apply: function (g) { for (var d = 0; d < 3; d++) g.tidakTersedia.push({ hari: d, slot: 11 }); g.alasanTidakTersedia = 'jam ke-11 ditiadakan'; }
    },
    {
      id: 'cuti', label: 'Guru PJOK cuti sebulan (mustahil, terbukti)',
      apply: function (g) {
        if (g.mapelUtama !== 'pjok') return;
        for (var d = 0; d < S.HARI.length; d++) for (var s = 1; s <= S.HARI[d].slots; s++) g.tidakTersedia.push({ hari: d, slot: s });
        g.alasanTidakTersedia = 'cuti sebulan';
      }
    }
  ];

  function buildSpec(ta, skenario) {
    var spec = S.buildJadwalSpec(state.school, ta);
    var sk = null;
    SKENARIO.forEach(function (x) { if (x.id === skenario) sk = x; });
    spec.guru = state.school.guru.map(function (g) {
      var copy = {
        id: g.id, nama: g.nama, mapelUtama: g.mapelUtama, maxJamHarian: g.maxJamHarian,
        tidakTersedia: g.tidakTersedia.slice(), alasanTidakTersedia: g.alasanTidakTersedia
      };
      if (sk && sk.apply) sk.apply(copy);
      return copy;
    });
    return spec;
  }

  function solveJadwal() {
    var can = D.can(user(), 'jadwal.solve', {});
    if (!can.allowed) { state.solveNote = can.reason; say(can.reason); renderPanel('jadwal'); return; }
    var spec = buildSpec(state.ta, state.sel.skenario);
    state.spec[state.ta] = spec;
    state.picked = null; state.moveMsg = null;
    state.solving = true;
    state.solveNote = '';
    say('Menyusun jadwal…');
    renderPanel('jadwal');

    /* Budget note: with the per-attempt backtrack ceiling actually working, a
     * hard instance can legitimately want more than 300 restarts and more than
     * 8 s of search — the 'rapat dinas' scenario failed on roughly 5% of seeds
     * at 8000/300 and on none of 40 at 12000/600. It runs in a Worker, so the
     * cost of the higher ceiling is a slightly longer 'Menyusun…', not a frozen
     * tab, and the alternative is telling a user a solvable week is impossible. */
    var opts = { budgetMs: 12000, optimiseMs: 2500, seed: (Date.now() % 100000) | 0, maxRestarts: 600 };
    var req = { id: ++reqSeq, ta: state.ta, skenario: state.sel.skenario, spec: spec };
    pending[req.id] = req;
    liveReq = req;
    var w = ensureWorker();
    if (w) {
      w.postMessage({ type: 'solve', reqId: req.id, spec: spec, opts: opts });
    } else {
      // Worker unavailable (some hardened browsers). Same solver, main thread,
      // and the UI says so rather than pretending. The try/catch matters: the
      // worker path already turns a throw into a typed message, and without the
      // same guard here an exception would strand state.solving === true and
      // leave the button reading "Menyusun…" forever.
      state.solveNote = 'Web Worker tidak tersedia; solver dijalankan di thread utama.';
      setTimeout(function () {
        delete pending[req.id];
        try {
          finishSolve(SV.solve(spec, opts), req);
        } catch (e) {
          if (req !== liveReq) return;
          liveReq = null;
          state.solving = false;
          state.solveNote = 'Solver melempar di thread utama: ' + String(e && e.message || e);
          say(state.solveNote);
          paintSolveResult();
        }
      }, 20);
    }
  }

  function attemptMove(sesiId, hari, slot) {
    var jd = state.jadwal[state.ta];
    if (!jd || !jd.assign) return;
    var spec = state.spec[state.ta];
    var cur = jd.assign[sesiId];
    var res = SV.validateMove(spec, jd.assign, sesiId, hari, slot, cur.ruangId);
    var sesi = null;
    spec.sesi.forEach(function (s) { if (s.id === sesiId) sesi = s; });
    if (res.ok) {
      jd.assign[sesiId] = { hari: hari, slot: slot, ruangId: cur.ruangId, ruangI: cur.ruangI };
      var ulang = SV.verify(spec, jd.assign);
      jd.soft = SV.softScore(spec, jd.assign);
      jd.verifikasi = ulang;
      state.moveMsg = {
        ok: true,
        judul: sesi.mapelKode + ' ' + sesi.rombelNama + ' dipindahkan ke ' + S.HARI[hari].label + ' JP ' + slot + '–' + (slot + sesi.len - 1),
        detail: ulang.ok
          ? 'Verifikasi ulang seluruh papan: 0 pelanggaran kendala keras. Skor lunak sekarang ' + jd.soft.total + '.'
          : 'PERINGATAN: verifikasi ulang menemukan ' + ulang.violations.length + ' pelanggaran.',
        violations: ulang.ok ? [] : ulang.violations
      };
      St.put('jadwal', { k: state.ta, v: jd });
      audit('sesi dipindahkan', sesi.id + ' → ' + S.HARI[hari].label + ' JP ' + slot);
      say('Diterima. ' + state.moveMsg.judul + '. ' + state.moveMsg.detail);
    } else {
      state.moveMsg = {
        ok: false,
        judul: 'Perpindahan ditolak: ' + sesi.mapelKode + ' ' + sesi.rombelNama + ' → ' + S.HARI[hari].label + ' JP ' + slot,
        detail: 'Kendala keras yang dilanggar:',
        violations: res.violations
      };
      say('Ditolak. ' + state.moveMsg.judul + '. ' +
        res.violations.map(function (v) { return v.jenis + ': ' + v.pesan; }).join(' '));
    }
    state.picked = null;
    renderPanel('jadwal');
  }

  function renderJadwal(p) {
    var jd = state.jadwal[state.ta];
    if (!state.spec[state.ta]) state.spec[state.ta] = buildSpec(state.ta, (jd && jd.skenario) || 'normal');
    var spec = state.spec[state.ta];
    var canSolve = D.can(user(), 'jadwal.solve', {});
    var totalJp = state.school.mapel.reduce(function (a, m) { return a + m.jp; }, 0);

    /* --- explainer --- */
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Penyusunan jadwal sebagai constraint satisfaction problem' }),
      h('div', { class: 'grid2' },
        h('div', null,
          h('p', { class: 'note', style: 'margin-bottom:6px' }, h('b', { text: 'Kendala keras — tidak boleh dilanggar sama sekali:' })),
          h('ul', { style: 'margin-left:18px;font-size:12.5px;color:var(--muted)' },
            h('li', null, h('code', { text: 'H1' }), ' seorang guru tidak berada di dua tempat pada JP yang sama'),
            h('li', null, h('code', { text: 'H2' }), ' satu rombel tidak mengikuti dua mapel sekaligus'),
            h('li', null, h('code', { text: 'H3' }), ' satu ruang tidak menampung dua rombel sekaligus'),
            h('li', null, h('code', { text: 'H4' }), ' slot ketidaksediaan guru dihormati'),
            h('li', null, h('code', { text: 'H5' }), ' JP per mapel per rombel terpenuhi persis (' + totalJp + ' JP/minggu)'),
            h('li', null, h('code', { text: 'H6' }), ' blok tidak terpotong istirahat dan tidak melewati jam terakhir'),
            h('li', null, h('code', { text: 'H7' }), ' praktikum IPA, Informatika dan PJOK mendapat ruang bertipe benar'))),
        h('div', null,
          h('p', { class: 'note', style: 'margin-bottom:6px' }, h('b', { text: 'Kendala lunak — diberi skor, bukan dipaksakan:' })),
          h('ul', { style: 'margin-left:18px;font-size:12.5px;color:var(--muted)' },
            h('li', null, 'jam kosong guru di tengah hari (penalti ' + SV.WEIGHTS.gapGuru + '/JP)'),
            h('li', null, 'mapel berat di jam terakhir (penalti ' + SV.WEIGHTS.beratAkhir + ')'),
            h('li', null, 'beban harian guru melampaui batasnya (penalti ' + SV.WEIGHTS.bebanHarian + '/JP)'),
            h('li', null, 'dua sesi mapel yang sama menumpuk pada satu hari (penalti ' + SV.WEIGHTS.mapelMenumpuk + ')'),
            h('li', null, 'PJOK setelah istirahat kedua (penalti ' + SV.WEIGHTS.pjokSiang + ')')),
          h('p', { class: 'hint', style: 'margin-top:6px' }, 'Algoritma: backtracking dengan forward checking. Urutan variabel dom/wdeg — jumlah nilai tersisa dibagi bobot konflik yang terkumpul, sehingga blok yang benar-benar sering menyebabkan jalan buntu dicoba lebih dulu; seri dipecah oleh panjang blok lalu derajat. Urutan nilai memakai biaya lunak ditambah petunjuk pengepakan segmen. Restart sering, dengan anggaran backtrack ',
            h('b', { text: 'per percobaan' }),
            ' yang benar-benar bertambah tiap restart, dan bobot konflik dibawa MELINTASI restart — itu yang membuat restart menjadi pembelajaran, bukan sekadar pengocokan ulang. Setelah solusi pertama, hill-climb min-conflicts berbatas waktu yang hanya bergerak di antara keadaan yang tetap sah. Semuanya berjalan di Web Worker.')))));

    /* --- controls --- */
    var kontrol = h('div', { class: 'controls' },
      field('Skenario kendala', select(SKENARIO.map(function (s) { return { value: s.id, label: s.label }; }),
        state.sel.skenario, function (v) { state.sel.skenario = v; }, { 'data-fkey': 'jadwal:skenario' })),
      h('button', {
        class: 'btn primary', type: 'button', disabled: state.solving ? true : null,
        'data-fkey': 'jadwal:susun',
        onclick: solveJadwal
      }, state.solving ? 'Menyusun…' : (jd ? 'Susun ulang' : 'Susun jadwal')),
      h('span', { class: 'hint', text: state.solving ? 'Solver berjalan di Web Worker; UI tetap responsif.' : '' }));

    var card = h('div', { class: 'card' },
      h('div', { class: 'row-between' }, h('h3', { text: 'Solver' }),
        jd && jd.assign ? h('span', { class: 'pill ok', text: 'terverifikasi: 0 pelanggaran' }) : null),
      canSolve.allowed ? null : denial(canSolve),
      kontrol,
      state.solveNote ? h('div', { class: 'callout warn', text: state.solveNote }) : null);

    if (jd && jd.stats) {
      var st = jd.stats;
      var box = h('div', { class: 'solver-stats' });
      function sstat(k, v, n) { box.appendChild(h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), n ? h('div', { class: 'n', text: n }) : null)); }
      sstat('Variabel', String(st.variabel), 'blok pelajaran');
      sstat('Kandidat', String(st.nilaiKandidat), 'total nilai domain');
      sstat('Node', String(st.node), 'keputusan penempatan');
      sstat('Backtrack', String(st.backtrack), st.restart ? st.restart + ' restart' : 'tanpa restart');
      sstat('Dipangkas', String(st.propagasiDibuang), 'nilai dibuang forward checking');
      sstat('Waktu', st.msTotal + ' ms', 'cari ' + st.msCari + ' · optimasi ' + st.msOptimasi);
      if (st.softAwal !== null && st.softAwal !== undefined) {
        // Board first, provenance underneath — after a manual move the pair the
        // solver finished on is history, not the score of what is on screen.
        var kini = jd.soft ? jd.soft.total : st.softAkhir;
        sstat('Skor lunak', String(kini), kini === st.softAkhir
          ? st.softAwal + ' → ' + st.softAkhir + ', ' + st.langkahOptimasi + ' langkah perbaikan'
          : 'solver ' + st.softAwal + ' → ' + st.softAkhir + ', lalu pemindahan manual');
      }
      card.appendChild(box);
    }

    if (jd && !jd.assign && jd.diagnosis) {
      var dg = jd.diagnosis;
      card.appendChild(h('div', { class: 'callout bad' },
        h('b', { text: dg.judul }), h('br'), dg.pesan,
        h('p', { style: 'margin-top:6px' }, h('b', { text: dg.sifat === 'terbukti' ? 'Terbukti mustahil. ' : 'Belum terbukti mustahil. ' }), dg.buktiKuat || ''),
        dg.anggaran ? h('p', { class: 'small', style: 'margin-top:4px', text: dg.anggaran }) : null,
        h('p', { style: 'margin-top:6px' }, h('b', { text: 'Saran: ' }), dg.saran)));
      card.appendChild(h('p', { class: 'hint', text: 'Perhatikan bahwa tidak ada jadwal setengah jadi yang ditampilkan. Solver mengembalikan null, dan aplikasi menolak menggambar apa pun.' }));
    }

    if (jd && jd.soft && jd.soft.detail && jd.soft.detail.length) {
      var det = jd.soft.detail.slice(0, 10).map(function (x) { return h('li', { text: x.pesan }); });
      card.appendChild(h('details', null,
        h('summary', { class: 'hint', text: 'Rincian pelanggaran lunak yang tersisa (' + jd.soft.detail.length + ')' }),
        h('ul', { style: 'margin:6px 0 0 18px;font-size:12.5px;color:var(--muted)' }, det)));
    }
    p.appendChild(card);

    if (!jd || !jd.assign) return;

    /* --- move feedback --- */
    if (state.moveMsg) {
      var mm = state.moveMsg;
      p.appendChild(h('div', { class: 'movebox ' + (mm.ok ? 'ok' : 'bad'), role: 'status' },
        h('b', { text: mm.judul }), h('br'), mm.detail,
        mm.violations.length
          ? h('ul', null, mm.violations.map(function (v) {
            return h('li', null, h('span', { class: 'viol-code', text: v.jenis }), v.pesan);
          }))
          : null));
    }

    /* --- view selector --- */
    var modeOpts = [{ value: 'rombel', label: 'Per rombel' }, { value: 'guru', label: 'Per guru' }, { value: 'ruang', label: 'Per ruang' }];
    var keyOpts;
    if (state.sel.jadwalMode === 'rombel') keyOpts = rombelList(state.ta).map(function (r) { return { value: r.id, label: r.nama }; });
    else if (state.sel.jadwalMode === 'guru') keyOpts = state.school.guru.map(function (g) { return { value: g.id, label: g.id + ' — ' + g.nama }; });
    else keyOpts = state.school.ruang.map(function (r) { return { value: r.id, label: r.nama }; });
    if (!keyOpts.some(function (o) { return o.value === state.sel.jadwalKey; })) state.sel.jadwalKey = keyOpts[0].value;

    var gridCard = h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Jadwal ' + state.ta }),
        h('span', { class: 'hint', text: 'Klik satu pelajaran lalu klik tujuan — sel kosong atau pelajaran lain. Atau seret. Semuanya divalidasi.' })),
      h('div', { class: 'controls' },
        field('Tampilan', select(modeOpts, state.sel.jadwalMode, function (v) {
          state.sel.jadwalMode = v; state.sel.jadwalKey = ''; state.picked = null; renderPanel('jadwal');
        }, { 'data-fkey': 'jadwal:mode' })),
        field(state.sel.jadwalMode === 'rombel' ? 'Rombel' : state.sel.jadwalMode === 'guru' ? 'Guru' : 'Ruang',
          select(keyOpts, state.sel.jadwalKey, function (v) { state.sel.jadwalKey = v; state.picked = null; renderPanel('jadwal'); },
            { 'data-fkey': 'jadwal:key' })),
        state.picked ? h('button', {
          class: 'btn small', type: 'button', 'data-fkey': 'jadwal:batal',
          onclick: function () { state.picked = null; say('Pilihan dibatalkan.'); renderPanel('jadwal'); }
        }, 'Batal pilih') : null));

    gridCard.appendChild(buildGrid(spec, jd.assign, state.sel.jadwalMode, state.sel.jadwalKey));
    gridCard.appendChild(h('p', { class: 'hint', style: 'margin-top:10px' },
      'Sel bergaris putus-putus adalah slot kosong; garis diagonal berarti hari itu memang sudah selesai. ',
      "Garis horizontal tebal menandai batas istirahat — Senin–Kamis setelah JP 3 dan JP 7, Jum'at setelah JP 3 — dan sebuah blok tidak boleh melewatinya. ",
      'Setiap perpindahan diperiksa ulang terhadap ketujuh kendala keras, lalu seluruh papan diverifikasi ulang dari nol, bukan hanya sel yang disentuh. ',
      'Dengan papan ketik: Tab ke satu pelajaran, Enter untuk memilih, lalu Tab ke tujuan dan Enter lagi — hasilnya diumumkan lewat live region, bukan hanya lewat warna.'));
    p.appendChild(gridCard);
  }

  function buildGrid(spec, assign, mode, key) {
    var maxSlots = 0;
    S.HARI.forEach(function (d) { maxSlots = Math.max(maxSlots, d.slots); });

    var sesiOf = {};   // "day:slot" -> sesi that starts there
    var covered = {};  // "day:slot" -> true
    spec.sesi.forEach(function (s) {
      var v = assign[s.id];
      if (!v) return;
      var match = mode === 'rombel' ? s.rombelId === key : mode === 'guru' ? s.guruId === key : v.ruangId === key;
      if (!match) return;
      sesiOf[v.hari + ':' + v.slot] = s;
      for (var k = 0; k < s.len; k++) covered[v.hari + ':' + (v.slot + k)] = true;
    });

    var grid = h('div', {
      class: 'jadwal-grid',
      style: 'grid-template-columns: 74px repeat(' + S.HARI.length + ', minmax(122px,1fr)); grid-template-rows: auto repeat(' + maxSlots + ', minmax(42px,auto));'
    });
    grid.appendChild(h('div', { class: 'jadwal-head corner', style: 'grid-column:1;grid-row:1', text: 'JP' }));
    S.HARI.forEach(function (d, i) {
      grid.appendChild(h('div', { class: 'jadwal-head', style: 'grid-column:' + (i + 2) + ';grid-row:1', text: d.label }));
    });

    for (var s = 1; s <= maxSlots; s++) {
      grid.appendChild(h('div', { class: 'jadwal-slot', style: 'grid-column:1;grid-row:' + (s + 1) }, h('b', { text: 'JP ' + s })));
    }

    S.HARI.forEach(function (day, d) {
      for (var slot = 1; slot <= maxSlots; slot++) {
        var pos = 'grid-column:' + (d + 2) + ';grid-row:' + (slot + 1);
        var brk = (day.breakAfter || []).indexOf(slot - 1) >= 0;
        if (slot > day.slots) {
          grid.appendChild(h('div', { class: 'cell libur' + (brk ? ' brk-before' : ''), style: pos, 'aria-hidden': 'true' }));
          continue;
        }
        var se = sesiOf[d + ':' + slot];
        if (se) {
          grid.appendChild(lessonEl(se, assign[se.id], d, slot, pos, mode));
          slot += se.len - 1;
          continue;
        }
        if (covered[d + ':' + slot]) continue;
        (function (dd, ss) {
          var lbl = day.label + ' JP ' + ss + ' kosong';
          grid.appendChild(h('button', {
            type: 'button',
            class: 'cell' + (brk ? ' brk-before' : '') + (state.picked ? ' target' : ''),
            style: pos,
            'data-fkey': 'cell:' + dd + ':' + ss,
            'aria-label': state.picked ? 'Pindahkan ke ' + lbl : lbl,
            onclick: function () { if (state.picked) attemptMove(state.picked, dd, ss); },
            ondragover: function (e) { if (state.picked) { e.preventDefault(); } },
            ondrop: function (e) { e.preventDefault(); if (state.picked) attemptMove(state.picked, dd, ss); }
          }));
        })(d, slot);
      }
    });

    return h('div', { class: 'jadwal-scroll', style: 'overflow-x:auto' }, grid);
  }

  function lessonEl(se, val, d, slot, pos, mode) {
    var brk = (S.HARI[d].breakAfter || []).indexOf(slot - 1) >= 0;
    var g = guruById(se.guruId);
    var ruangNama = val.ruangId;
    state.school.ruang.forEach(function (r) { if (r.id === val.ruangId) ruangNama = r.nama; });
    var sub = mode === 'guru' ? se.rombelNama : (g ? g.nama.replace(/,.*$/, '') : se.guruId);
    var jam = S.jamSlot(d, slot).split('–')[0] + '–' + S.jamSlot(d, slot + se.len - 1).split('–')[1];
    var el = h('button', {
      type: 'button',
      draggable: 'true',
      class: 'lesson ' + MP_CLASS[se.mapelId] + (state.picked === se.id ? ' picked' : '') + (brk ? ' brk-before' : ''),
      style: pos + ';grid-row-end: span ' + se.len,
      'data-fkey': 'lesson:' + fkey(se.id),
      'aria-pressed': state.picked === se.id ? 'true' : 'false',
      title: se.mapelNama + ' · ' + se.rombelNama + ' · ' + (g ? g.nama : '') + ' · ' + ruangNama + ' · ' + S.HARI[d].label + ' ' + jam,
      'aria-label': se.mapelNama + ', ' + se.rombelNama + ', ' + (g ? g.nama : '') + ', ' + ruangNama + ', ' +
        S.HARI[d].label + ' JP ' + slot + ' sampai ' + (slot + se.len - 1) +
        (state.picked === se.id ? ', terpilih untuk dipindahkan'
          : state.picked ? ', tekan untuk mencoba memindahkan pelajaran terpilih ke sini'
            : ', tekan untuk memilih'),
      // Clicking (or dropping) onto a lesson while another one is picked is a
      // deliberate path, not a dead end: it is how a user discovers WHY two
      // things cannot share a slot. The move is attempted and rejected with the
      // specific constraint, rather than silently ignored.
      onclick: function () {
        if (state.picked && state.picked !== se.id) { attemptMove(state.picked, d, slot); return; }
        state.picked = state.picked === se.id ? null : se.id;
        state.moveMsg = null;
        say(state.picked
          ? (se.mapelKode + ' ' + se.rombelNama + ' terpilih. Pilih slot tujuan, lalu tekan Enter.')
          : 'Pilihan dibatalkan.');
        renderPanel('jadwal');
      },
      ondragover: function (e) { if (state.picked && state.picked !== se.id) e.preventDefault(); },
      ondrop: function (e) {
        e.preventDefault();
        if (state.picked && state.picked !== se.id) attemptMove(state.picked, d, slot);
      },
      ondragstart: function (e) {
        state.picked = se.id;
        try { e.dataTransfer.setData('text/plain', se.id); e.dataTransfer.effectAllowed = 'move'; } catch (x) { }
      }
    },
      h('span', { class: 'kode', text: se.mapelKode + (se.len > 1 ? ' · ' + se.len + ' JP' : '') }),
      h('span', { class: 'who', text: sub }),
      h('span', { class: 'rm', text: ruangNama + ' · ' + jam }));
    return el;
  }

  /* ============================================================ PRESENSI == */

  function semesterBelumMulai(p, judul) {
    var kal = S.kalenderSemester(state.ta, state.semester);
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: judul }),
      h('div', { class: 'callout warn' },
        h('b', { text: 'Semester ' + state.semester + ' ' + state.ta + ' belum berjalan. ' }),
        'Dimulai ' + D.tanggalPanjang(kal.mulaiTs) + ', sedangkan tanggal acuan demo adalah ' + S.SEKARANG_LABEL + '.'),
      h('p', { class: 'hint', text: 'Ini bukan galat dan bukan kekosongan data. Aplikasi menolak menampilkan nilai atau presensi untuk hari yang belum terjadi — itu satu-satunya jawaban yang benar, dan kebalikannya (menampilkan PAS lengkap pada pekan keenam) adalah tanda paling jelas bahwa sebuah SIAKAD tidak pernah dipakai sekolah.' })));
  }

  function renderPresensi(p) {
    if (state.role === 'ortu') return renderPresensiOrtu(p);
    if (S.statusSemester(state.ta, state.semester) === 'belum-mulai') return semesterBelumMulai(p, 'Presensi');

    var rbs = rombelList(state.ta);
    if (!state.sel.rombel || !rombelByName(state.ta, state.sel.rombel)) state.sel.rombel = rbs[0].nama;
    var rb = rombelByName(state.ta, state.sel.rombel);

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Presensi — dua butir tampilan, satu fakta' }),
      h('p', { class: 'note' },
        'Fakta yang disimpan adalah pasangan ', h('code', { text: '(NISN, tanggal)' }),
        ' dari buku presensi harian wali kelas. Presensi per sesi mapel adalah ',
        h('b', { text: 'tampilan' }), ' atas fakta bertanggal itu, bukan gudang data tersendiri. ',
        'Karena itu anak yang sakit pada satu Selasa tercatat "S" di semua mapel yang diajarkan Selasa itu, ketidakhadiran di rapor bisa dihitung dalam ',
        h('b', { text: 'hari' }), ' (satuan yang dipakai rapor Indonesia), dan pertanyaan "anak saya izin hari Selasa" bisa dijawab sistem. ',
        'Empat status tidak saling menggantikan: ', h('b', { text: 'Hadir' }), ', ', h('b', { text: 'Sakit' }), ', ',
        h('b', { text: 'Izin' }), ' (berizin) dan ', h('b', { text: 'Alpa' }), ' (tanpa keterangan) — dan hanya alpa yang menentukan kelayakan.'),
      h('div', { class: 'controls' },
        field('Tampilan', select(
          [{ value: 'sesi', label: 'Per sesi mapel (guru pengampu)' }, { value: 'harian', label: 'Buku harian (wali kelas)' }],
          state.sel.presensiMode, function (v) { state.sel.presensiMode = v; renderPanel('presensi'); },
          { 'data-fkey': 'pres:mode' })),
        field('Rombel', select(rbs.map(function (r) { return { value: r.nama, label: r.nama }; }), rb.nama,
          function (v) { state.sel.rombel = v; renderPanel('presensi'); }, { 'data-fkey': 'pres:rombel' })))));

    if (state.sel.presensiMode === 'harian') return renderPresensiHarian(p, rb);
    return renderPresensiSesi(p, rb);
  }

  function statusSelect(nisn, nama, cur, disabled, fk, onchange) {
    return select(
      D.PRESENSI.map(function (x) { return { value: x.id, label: x.id + ' — ' + x.label }; }),
      cur, onchange,
      { disabled: disabled ? true : null, 'data-fkey': fk, 'aria-label': 'Status kehadiran ' + nama });
  }

  function kelayakanPill(roll) {
    return roll.memenuhiSyarat
      ? h('span', { class: 'pill ok', text: 'layak' })
      : h('span', { class: 'pill bad', text: 'alpa ' + roll.persenAlpa + '%' });
  }

  function renderPresensiSesi(p, rb) {
    var mp = mapelById(state.sel.mapel) || state.school.mapel[0];
    var pengampuId = pengampuOf(state.ta, rb.nama, mp.id);
    var pengampu = guruById(pengampuId);
    var can = D.can(user(), 'presensi.write', { pengampuGuruId: pengampuId, pengampuNama: pengampu && pengampu.nama, rombelId: rb.id });
    var sesi = S.sesiMapel(rb.nama, mp, state.ta, state.semester);
    var totalRencana = S.pertemuanPerSemester(mp);
    if (!sesi.length) {
      p.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty', text: 'Belum ada pertemuan ' + mp.nama + ' yang terjadi pada semester ini.' })));
      return;
    }
    if (state.sel.pertemuan > sesi.length || state.sel.pertemuan < 1) state.sel.pertemuan = sesi.length;
    var cur = sesi[state.sel.pertemuan - 1];
    var hariNama = S.HARI[cur.hariIdx].label;

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'controls' },
        field('Mapel', select(state.school.mapel.map(function (m) { return { value: m.id, label: m.nama }; }), mp.id,
          function (v) { state.sel.mapel = v; state.sel.pertemuan = 1; renderPanel('presensi'); }, { 'data-fkey': 'pres:mapel' })),
        field('Pertemuan ke-', select(
          sesi.map(function (s) { return { value: s.n, label: s.n + ' — ' + s.tgl + ' (' + S.HARI[s.hariIdx].label + ')' }; }),
          cur.n, function (v) { state.sel.pertemuan = +v; renderPanel('presensi'); }, { 'data-fkey': 'pres:pertemuan' })),
        h('span', { class: 'hint', text: 'Pengampu: ' + (pengampu ? pengampu.nama : '—') })),
      h('p', { class: 'note' },
        mp.nama + ' bertemu ' + rb.nama + ' setiap ' +
        S.hariPertemuan(rb.nama, mp).map(function (i) { return S.HARI[i].label; }).join(' dan ') +
        '. Sampai ' + S.SEKARANG_LABEL + ' sudah terjadi ' + sesi.length + ' dari ' + totalRencana +
        ' pertemuan yang direncanakan (' + mp.blok.length + ' sesi/minggu × ' + S.PEKAN_KBM + ' pekan KBM). ' +
        'Sesi yang sedang dibuka: ' + D.tanggalPanjang(cur.tgl) + '.'),
      can.allowed ? null : h('div', { class: 'callout warn' }, h('b', { text: 'Tindakan ditolak. ' }), can.reason,
        h('div', { style: 'margin-top:7px' }, jadiPengampu(pengampuId)))));

    var rows = rb.siswa.map(function (nisn) {
      var s = state.school.siswa[nisn];
      var recs = A.presensiEfektif(ctx(), nisn, mp, state.ta, state.semester, rb.nama);
      var roll = D.rollupPresensi(recs);
      var rec = recs[state.sel.pertemuan - 1];
      var bar = h('div', { class: 'bar' });
      ['H', 'S', 'I', 'A'].forEach(function (k) {
        var pct = roll.total ? (roll[k] / roll.total * 100) : 0;
        if (pct > 0) bar.appendChild(h('i', { class: k.toLowerCase(), style: 'width:' + pct + '%' }));
      });
      return h('tr', null,
        h('td', { class: 'num', text: String(s.enrol[state.ta].absen) }),
        h('td', { style: 'white-space:normal', text: s.nama }),
        h('td', { class: 'mono small', text: s.nisn }),
        h('td', null, statusSelect(nisn, s.nama, rec.status, !can.allowed,
          'pres:sel:' + fkey(nisn),
          function (v) {
            var key = A.presensiKey(state.ta, state.semester, nisn, mp.id, cur.tgl);
            var r2 = { k: key, status: v, oleh: state.guruId || 'TU', pada: Date.now() };
            state.presensiOverrides[key] = r2;
            St.put('presensi', r2);
            audit('presensi sesi diubah', s.nama + ' · ' + mp.kode + ' · ' + cur.tgl + ' → ' + v);
            say(s.nama + ': ' + v + ' pada ' + cur.tgl);
            setTimeout(function () { renderPanel('presensi'); }, 0);
          })),
        h('td', { class: 'small', text: rec.diubah ? 'koreksi sesi' : 'dari buku harian' }),
        h('td', { class: 'num', text: String(roll.H) }),
        h('td', { class: 'num', text: String(roll.S) }),
        h('td', { class: 'num', text: String(roll.I) }),
        h('td', { class: 'num', text: String(roll.A) }),
        h('td', { class: 'num mono', text: roll.persen.toFixed(2) + '%' }),
        h('td', { style: 'min-width:110px' }, bar),
        h('td', null, kelayakanPill(roll)));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Rekap ' + mp.nama + ' — ' + rb.nama + ' — semester ' + state.semester }),
        h('div', { class: 'legend' }, h('span', { class: 'lh', text: 'Hadir' }), h('span', { class: 'ls', text: 'Sakit' }),
          h('span', { class: 'li', text: 'Izin' }), h('span', { class: 'la', text: 'Alpa' }))),
      h('p', { class: 'hint', text: 'Kolom "Sumber" memperlihatkan mana yang berasal dari buku harian wali kelas dan mana yang sudah dikoreksi guru pengampu untuk sesi ini saja. Kelayakan dihitung dari alpa (maksimal ' + D.MAKS_ALPA_PERSEN + '% pertemuan), bukan dari total ketidakhadiran — anak dengan 30 hari sakit berdokumen bukan pembolos.' }),
      tableOf([{ label: 'Abs', num: true }, 'Nama', 'NISN', 'Pertemuan ' + cur.n + ' (' + cur.tgl + ')', 'Sumber',
      { label: 'H', num: true }, { label: 'S', num: true }, { label: 'I', num: true }, { label: 'A', num: true },
      { label: '% hadir', num: true }, 'Sebaran', 'Kelayakan'], rows, { minWidth: '980px' })));
  }

  function renderPresensiHarian(p, rb) {
    var can = D.can(user(), 'presensi.harian.write', { rombelId: rb.id });
    var hari = S.hariEfektifHingga(state.ta, state.semester);
    if (!hari.length) {
      p.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty', text: 'Belum ada hari efektif yang terjadi pada semester ini.' })));
      return;
    }
    if (hari.indexOf(state.sel.tanggal) < 0) state.sel.tanggal = hari[hari.length - 1];
    var tgl = state.sel.tanggal;

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'controls' },
        field('Tanggal', select(hari.slice().reverse().map(function (t) { return { value: t, label: t + ' — ' + D.NAMA_HARI[new Date(D.parseYmd(t)).getUTCDay()] }; }),
          tgl, function (v) { state.sel.tanggal = v; renderPanel('presensi'); }, { 'data-fkey': 'pres:tgl' })),
        h('span', { class: 'hint', text: 'Wali kelas ' + rb.nama + ': ' + (guruById(rb.waliGuruId) || {}).nama })),
      h('p', { class: 'note', text: 'Buku presensi harian adalah kewenangan wali kelas, dan inilah fakta yang dipakai rapor untuk menghitung Ketidakhadiran dalam hari. ' + D.tanggalPanjang(tgl) + ' — ' + hari.length + ' hari efektif sudah berjalan pada semester ini.' }),
      can.allowed ? null : h('div', { class: 'callout warn' }, h('b', { text: 'Tindakan ditolak. ' }), can.reason,
        h('div', { style: 'margin-top:7px' }, jadiWali(rb)))));

    var rows = rb.siswa.map(function (nisn) {
      var s = state.school.siswa[nisn];
      var harian = A.presensiHarianEfektif(ctx(), nisn, state.ta, state.semester);
      var roll = D.rollupPresensi(harian, 'hari');
      var idx = -1;
      for (var i = 0; i < harian.length; i++) if (harian[i].tgl === tgl) idx = i;
      var rec = harian[idx] || { status: 'H' };
      return h('tr', null,
        h('td', { class: 'num', text: String(s.enrol[state.ta].absen) }),
        h('td', { style: 'white-space:normal', text: s.nama }),
        h('td', null, statusSelect(nisn, s.nama, rec.status, !can.allowed,
          'presh:sel:' + fkey(nisn),
          function (v) {
            var key = A.presensiHariKey(state.ta, state.semester, nisn, tgl);
            var r2 = { k: key, status: v, oleh: state.guruId || 'wali', pada: Date.now() };
            state.presensiOverrides[key] = r2;
            St.put('presensi', r2);
            audit('presensi harian diubah', s.nama + ' · ' + tgl + ' → ' + v);
            say(s.nama + ': ' + v + ' pada ' + tgl + '. Berlaku untuk seluruh mapel hari itu.');
            setTimeout(function () { renderPanel('presensi'); }, 0);
          })),
        h('td', { class: 'num', text: String(roll.S) }),
        h('td', { class: 'num', text: String(roll.I) }),
        h('td', { class: 'num', text: String(roll.A) }),
        h('td', { class: 'num', text: String(roll.total) }),
        h('td', null, roll.A > D.MAKS_ALPA_HARI
          ? h('span', { class: 'pill bad', text: 'alpa > ' + D.MAKS_ALPA_HARI + ' hari' })
          : h('span', { class: 'pill ok', text: 'layak' })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Buku presensi harian — ' + rb.nama + ' — ' + tgl }),
      h('p', { class: 'hint', text: 'Mengubah status di sini mengubah hari itu untuk seluruh mapel, karena memang begitulah kenyataannya. Guru pengampu tetap bisa mengoreksi satu sesi saja lewat tampilan per mapel — koreksi itu menumpuk di atas fakta harian, tanpa menghapusnya.' }),
      tableOf([{ label: 'Abs', num: true }, 'Nama', 'Status ' + tgl,
      { label: 'Sakit (hari)', num: true }, { label: 'Izin (hari)', num: true }, { label: 'Alpa (hari)', num: true },
      { label: 'Hari efektif', num: true }, 'Kelayakan'], rows, { minWidth: '780px' })));
  }

  function renderPresensiOrtu(p) {
    if (S.statusSemester(state.ta, state.semester) === 'belum-mulai') return semesterBelumMulai(p, 'Presensi');
    var nisn = state.nisn;
    var s = state.school.siswa[nisn];
    var e = s.enrol[state.ta];
    if (!e) {
      p.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Presensi' }),
        h('div', { class: 'callout warn', text: s.nama + ' tidak terdaftar pada tahun ajaran ' + state.ta + '.' })));
      return;
    }
    var harian = A.presensiHarianEfektif(ctx(), nisn, state.ta, state.semester);
    var rollHari = D.rollupPresensi(harian, 'hari');
    var rows = state.school.mapel.map(function (m) {
      var roll = D.rollupPresensi(A.presensiEfektif(ctx(), nisn, m, state.ta, state.semester, e.rombelNama));
      return h('tr', null,
        h('td', { text: m.nama }),
        h('td', { class: 'num', text: String(roll.H) }), h('td', { class: 'num', text: String(roll.S) }),
        h('td', { class: 'num', text: String(roll.I) }), h('td', { class: 'num', text: String(roll.A) }),
        h('td', { class: 'num mono', text: roll.persen.toFixed(2) + '%' }));
    });
    var absen = harian.filter(function (x) { return x.status !== 'H'; });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Presensi ' + s.nama + ' — ' + e.rombelNama + ' — semester ' + state.semester }),
      h('p', { class: 'note', text: 'Tampilan orang tua bersifat baca-saja dan hanya memuat satu anak. Mengganti anak di bilah atas akan ditolak untuk NISN yang bukan miliknya.' }),
      h('p', { class: 'note', text: 'Dalam hari: sakit ' + rollHari.S + ', izin ' + rollHari.I + ', tanpa keterangan ' + rollHari.A + ', dari ' + rollHari.total + ' hari efektif.' }),
      absen.length
        ? h('details', null,
          h('summary', { class: 'hint', text: 'Tanggal ketidakhadiran (' + absen.length + ' hari)' }),
          h('ul', { style: 'margin:6px 0 0 18px;font-size:12.5px;color:var(--muted)' },
            absen.map(function (x) {
              return h('li', { text: D.tanggalPanjang(x.tgl) + ' — ' + (D.presensiDef(x.status) || {}).label });
            })))
        : h('p', { class: 'hint', text: 'Tidak ada ketidakhadiran tercatat.' }),
      tableOf(['Mapel', { label: 'H', num: true }, { label: 'S', num: true }, { label: 'I', num: true }, { label: 'A', num: true }, { label: '% hadir', num: true }], rows)));
  }

  /* =========================================================== PENILAIAN == */

  function renderPenilaian(p) {
    if (state.role === 'ortu') {
      p.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Penilaian' }),
        denial(D.can(user(), 'nilai.write', { pengampuGuruId: 'x' })),
        h('p', { class: 'hint', text: 'Nilai anak Anda tersedia di tab Rapor.' })));
      return;
    }
    if (S.statusSemester(state.ta, state.semester) === 'belum-mulai') return semesterBelumMulai(p, 'Penilaian');

    var rbs = rombelList(state.ta);
    if (!state.sel.rombel || !rombelByName(state.ta, state.sel.rombel)) state.sel.rombel = rbs[0].nama;
    var rb = rombelByName(state.ta, state.sel.rombel);
    var mp = mapelById(state.sel.mapel) || state.school.mapel[0];
    var asp = aspekDef(state.sel.aspek);
    var komponen = D.komponenAspek(asp.id);
    var pengampuId = pengampuOf(state.ta, rb.nama, mp.id);
    var pengampu = guruById(pengampuId);
    var canWrite = D.can(user(), 'nilai.write', { pengampuGuruId: pengampuId, pengampuNama: pengampu && pengampu.nama, rombelId: rb.id });
    var canConfig = D.can(user(), 'config.write', {});

    var bobot = A.bobotFor(ctx(), state.ta, mp.id, asp.id);
    var kkm = A.kkmFor(ctx(), state.ta, mp.id);
    var v = D.validateBobot(bobot, asp.id);
    var bands = D.predikatBands(kkm);

    /* --- weighting editor, scoped to the tahun ajaran --- */
    var draft = {};
    komponen.forEach(function (k) { draft[k.id] = bobot[k.id]; });
    var totalEl = h('span', { class: 'pill ' + (v.ok ? 'ok' : 'bad'), text: 'total ' + v.total + '%' });
    var errEl = h('div');

    function recheck() {
      var vv = D.validateBobot(draft, asp.id);
      totalEl.textContent = 'total ' + vv.total + '%';
      totalEl.className = 'pill ' + (vv.ok ? 'ok' : 'bad');
      clear(errEl);
      if (!vv.ok) errEl.appendChild(h('div', { class: 'callout bad' }, h('b', { text: 'Bobot ditolak. ' }), vv.errors.join(' ')));
      return vv;
    }

    var row = h('div', { class: 'bobot-row' });
    komponen.forEach(function (k) {
      row.appendChild(field(k.label, h('input', {
        type: 'number', min: '0', max: '100', step: '1', value: String(draft[k.id]),
        disabled: canConfig.allowed ? null : true,
        'data-fkey': 'bobot:' + asp.id + ':' + k.id,
        oninput: function (e) { draft[k.id] = e.target.value === '' ? '' : Number(e.target.value); recheck(); }
      })));
    });
    row.appendChild(field('KKM', h('input', {
      type: 'number', min: String(D.KKM_MIN), max: String(D.KKM_MAX), value: String(kkm),
      disabled: canConfig.allowed ? null : true,
      'data-fkey': 'bobot:kkm',
      oninput: function (e) { draft.__kkm = Number(e.target.value); }
    })));
    row.appendChild(totalEl);
    row.appendChild(h('button', {
      class: 'btn primary', type: 'button', disabled: canConfig.allowed ? null : true,
      'data-fkey': 'bobot:simpan',
      onclick: function () {
        var vv = recheck();
        if (!vv.ok) { say('Bobot ditolak: ' + vv.errors.join(' ')); return; }
        var ta = state.ta;
        if (!state.konfig.bobot[ta]) state.konfig.bobot[ta] = {};
        if (!state.konfig.kkm[ta]) state.konfig.kkm[ta] = {};
        if (!state.konfig.bobot[ta][mp.id]) {
          state.konfig.bobot[ta][mp.id] = JSON.parse(JSON.stringify(state.school.bobot[ta][mp.id]));
        }
        var simpan = {};
        komponen.forEach(function (k) { simpan[k.id] = Number(draft[k.id]); });
        state.konfig.bobot[ta][mp.id][asp.id] = simpan;
        if (draft.__kkm !== undefined && isFinite(draft.__kkm)) {
          state.konfig.kkm[ta][mp.id] = D.clamp(draft.__kkm, D.KKM_MIN, D.KKM_MAX);
        }
        saveKonfig(ta);
        audit('bobot penilaian diubah', ta + ' · ' + mp.nama + ' · ' + asp.label + ' → ' + JSON.stringify(simpan) +
          ' KKM ' + A.kkmFor(ctx(), ta, mp.id));
        say('Bobot ' + asp.label + ' ' + mp.nama + ' untuk tahun ajaran ' + ta + ' disimpan.');
        renderPanel('penilaian');
      }
    }, 'Simpan bobot ' + state.ta));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Bobot penilaian & KKM — ' + mp.nama + ' · ' + asp.ki + ' ' + asp.label }),
      h('div', { class: 'callout ok' },
        h('b', { text: 'Konfigurasi ini berlaku untuk tahun ajaran ' + state.ta + ' saja. ' }),
        'Sekolah merevisi KKM di KOSP setiap tahun, dan rapor yang sudah ditandatangani harus tetap memakai KKM yang berlaku saat itu. ' +
        'Menyimpan bobot atau KKM di sini tidak menyentuh rapor ' + (state.ta === S.TA_AKTIF ? S.TA_LALU : S.TA_AKTIF) +
        ' — silakan buktikan sendiri: ubah angkanya, lalu pindah tahun ajaran di bilah atas dan buka rapor tahun itu.'),
      h('p', { class: 'note' },
        'Satu aturan yang tidak pernah lentur: ', h('b', { text: 'totalnya harus tepat 100%' }),
        '. Antarmuka yang membiarkan 90% atau 110% tersimpan diam-diam akan menskalakan ulang nilai setiap anak. Di sini bobot yang tidak sah ditolak dan tidak ada angka yang dihitung sama sekali. ',
        'Komponennya berbeda per aspek, karena KI-3 dan KI-4 memang dinilai dengan instrumen berbeda.'),
      h('div', { class: 'controls' },
        field('Rombel', select(rbs.map(function (r) { return { value: r.nama, label: r.nama }; }), rb.nama,
          function (val) { state.sel.rombel = val; renderPanel('penilaian'); }, { 'data-fkey': 'nilai:rombel' })),
        field('Mapel', select(state.school.mapel.map(function (m) { return { value: m.id, label: m.nama }; }), mp.id,
          function (val) { state.sel.mapel = val; renderPanel('penilaian'); }, { 'data-fkey': 'nilai:mapel' })),
        field('Aspek', select(D.ASPEK.map(function (a) { return { value: a.id, label: a.ki + ' — ' + a.label }; }), asp.id,
          function (val) { state.sel.aspek = val; renderPanel('penilaian'); }, { 'data-fkey': 'nilai:aspek' })),
        h('span', { class: 'hint', text: 'Pengampu: ' + (pengampu ? pengampu.nama : '—') })),
      canConfig.allowed ? null : denial(canConfig),
      row, errEl,
      h('p', { class: 'hint' },
        'Predikat diturunkan dari KKM, bukan dari tabel tetap: interval = (100 − KKM) / 3. Dengan KKM ' + kkm + ' → ',
        h('b', { text: 'D < ' + bands.C }), ', ',
        h('b', { text: 'C ' + bands.C + '–' + bands.B }), ', ',
        h('b', { text: 'B ' + bands.B + '–' + bands.A }), ', ',
        h('b', { text: 'A ≥ ' + bands.A }),
        '. Nilai 82 adalah B pada mapel ber-KKM 70 tapi hanya C pada mapel ber-KKM 80 — itulah sebabnya predikat tidak boleh dipatok.')));

    /* --- which components are open at all --- */
    var belumList = komponen.filter(function (k) { return !S.komponenSiap(state.ta, state.semester, asp.id, k.id); });

    /* --- marks --- */
    var rows = rb.siswa.map(function (nisn) {
      var s = state.school.siswa[nisn];
      var eff = A.nilaiEfektif(state.nilaiOverrides, nisn, mp.id, state.ta, state.semester, asp.id);
      var hasil = D.hitungNilaiAkhir(eff.nilai, bobot, kkm, asp.id);
      var naEl = h('td', { class: 'num mono', text: hasil.lengkap ? hasil.nilai.toFixed(2) : '—' });
      var prEl = h('td', null, hasil.lengkap ? h('span', { class: 'pred ' + hasil.predikat, text: hasil.predikat }) : h('span', { class: 'hint', text: 'belum' }));
      var tuEl = h('td', null, hasil.lengkap
        ? (hasil.tuntas ? h('span', { class: 'pill ok', text: 'tuntas' }) : h('span', { class: 'pill bad', text: 'remedial' }))
        : '');
      var rincianEl = h('td', { class: 'rincian', style: 'white-space:normal' },
        hasil.lengkap
          ? hasil.rincian.map(function (r) { return r.nilai + '×' + r.bobot + '%=' + r.kontribusi.toFixed(2); }).join(' + ')
          : h('span', { class: 'hint', text: 'menunggu ' + hasil.belum.length + ' komponen' }));

      var inputs = komponen.map(function (k) {
        var siap = S.komponenSiap(state.ta, state.semester, asp.id, k.id);
        if (!siap) {
          return h('td', null, h('span', {
            class: 'hint', text: 'belum dinilai',
            title: S.komponenBelumLabel(state.ta, state.semester, asp.id, k.id)
          }));
        }
        return h('td', null, h('input', {
          class: 'nilai-input' + (eff.diubah[k.id] ? ' edited' : ''),
          type: 'number', min: '0', max: '100', value: String(eff.nilai[k.id]),
          disabled: canWrite.allowed ? null : true,
          'data-fkey': 'nilai:' + fkey(nisn) + ':' + k.id,
          'aria-label': k.label + ' ' + s.nama,
          onchange: function (e) {
            var val2 = e.target.value === '' ? null : D.clamp(Number(e.target.value), 0, 100);
            var key = A.nilaiKey(state.ta, state.semester, nisn, mp.id, asp.id);
            var rec = state.nilaiOverrides[key] || { k: key, nilai: {}, oleh: state.guruId || 'TU' };
            rec.nilai[k.id] = val2;
            rec.oleh = state.guruId || 'TU';
            rec.pada = Date.now();
            state.nilaiOverrides[key] = rec;
            St.put('nilai', rec);
            audit('nilai diubah', s.nama + ' · ' + mp.kode + ' · ' + asp.label + ' · ' + k.label + ' → ' + val2);
            // Deferred: this fires from a change event, and re-rendering the
            // panel synchronously would tear down the element still handling it.
            setTimeout(function () { renderPanel('penilaian'); }, 0);
          }
        }));
      });

      var tr = h('tr', null,
        h('td', { class: 'num', text: String(s.enrol[state.ta].absen) }),
        h('td', { style: 'white-space:normal' }, h('button', {
          class: 'linkbtn', type: 'button', text: s.nama,
          'data-fkey': 'nilai:nama:' + fkey(nisn),
          onclick: function () { state.sel.raporNisn = nisn; switchTab('rapor'); }
        })),
        h('td', { class: 'mono small', text: s.nisn }));
      inputs.forEach(function (x) { tr.appendChild(x); });
      tr.appendChild(naEl); tr.appendChild(prEl); tr.appendChild(tuEl); tr.appendChild(rincianEl);
      return tr;
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: mp.nama + ' — ' + asp.ki + ' ' + asp.label + ' — ' + rb.nama + ' — semester ' + state.semester + ' — ' + state.ta }),
        h('span', { class: 'hint', text: 'Nilai ungu = sudah disunting dan tersimpan.' })),
      canWrite.allowed
        ? h('div', { class: 'callout ok' }, h('b', { text: 'Anda pengampu kelas ini. ' }), 'Suntingan tercatat di jejak audit atas nama ' + (guruById(state.guruId) || {}).nama + '.')
        : h('div', { class: 'callout warn' }, h('b', { text: 'Tindakan ditolak. ' }), canWrite.reason,
          h('div', { style: 'margin-top:7px' }, jadiPengampu(pengampuId))),
      belumList.length
        ? h('div', { class: 'callout warn' },
          h('b', { text: belumList.length + ' komponen belum bisa dinilai. ' }),
          belumList.map(function (k) { return k.label + ' (' + S.komponenBelumLabel(state.ta, state.semester, asp.id, k.id) + ')'; }).join('; ') +
          '. Selama masih ada komponen yang kosong, nilai akhir tidak dihitung sama sekali — bukan dihitung dari sebagian bobot, dan bukan dianggap nol.')
        : null,
      h('p', { class: 'note' },
        'Kolom terakhir memperlihatkan aritmetikanya. Pembulatan dilakukan ',
        h('b', { text: 'sekali, di akhir' }), ' — membulatkan tiap kontribusi lebih dulu bisa menggeser nilai sampai 2 poin dan membuat penjumlahan yang tercetak tidak cocok dengan hasilnya.'),
      tableOf([{ label: 'Abs', num: true }, 'Nama', 'NISN']
        .concat(komponen.map(function (k) { return { label: k.label, num: true }; }))
        .concat([{ label: 'Nilai akhir', num: true }, 'Predikat', 'Status', 'Perhitungan']),
        rows, { minWidth: '960px' })));
  }

  /* =============================================================== RAPOR == */

  function renderRapor(p) {
    var pilihan = [];
    if (state.role === 'ortu') pilihan = [state.nisn];
    else rombelList(state.ta).forEach(function (r) { r.siswa.forEach(function (n) { pilihan.push(n); }); });
    if (!pilihan.length) { p.appendChild(h('div', { class: 'empty', text: 'Tidak ada peserta didik pada tahun ajaran ini.' })); return; }
    if (pilihan.indexOf(state.sel.raporNisn) < 0) state.sel.raporNisn = pilihan[0];
    var nisn = state.sel.raporNisn;
    var siswa = state.school.siswa[nisn];
    var enrol = siswa.enrol[state.ta];

    var canRead = D.can(user(), 'rapor.read', {
      nisn: nisn,
      rombelId: enrol ? enrol.rombelId : null,
      pengampuGuruId: enrol ? pengampuOf(state.ta, enrol.rombelNama, 'mtk') : null
    });

    var opts = pilihan.map(function (n) {
      var s = state.school.siswa[n];
      return { value: n, label: (s.enrol[state.ta] ? s.enrol[state.ta].rombelNama + ' · ' : '') + s.nama };
    });
    p.appendChild(h('div', { class: 'card no-print' },
      h('div', { class: 'controls' },
        field('Peserta didik', select(opts, nisn, function (v) { state.sel.raporNisn = v; renderPanel('rapor'); },
          { disabled: state.role === 'ortu' ? true : null, 'data-fkey': 'rapor:siswa' })),
        h('button', { class: 'btn', type: 'button', 'data-fkey': 'rapor:cetak', onclick: function () { window.print(); } }, 'Cetak rapor'),
        h('span', { class: 'hint', text: 'Cetak memakai @media print: bilah, tab dan tombol dihilangkan, palet dipaksa gelap-di-atas-putih, dan tabel dibuat mengalir agar tidak ada kolom yang terpotong tepi kertas.' })),
      canRead.allowed ? null : denial(canRead)));

    if (!canRead.allowed) return;

    var r = A.hitungRapor(ctx(), nisn, state.ta, state.semester);
    if (!r.ok) {
      p.appendChild(h('div', { class: 'card' },
        h('h3', { text: 'Rapor tidak tersedia' }),
        h('div', { class: 'callout warn', text: r.alasan }),
        h('p', {
          class: 'hint',
          text: r.sebab === 'semester-belum-mulai'
            ? 'Ini bukan galat. Rapor adalah dokumen akhir semester; semester ini belum berjalan satu hari pun, jadi tidak ada nilai, tidak ada presensi, dan menerbitkan rapor untuknya berarti mengarang dokumen tentang anak.'
            : 'Ini bukan galat. Rapor berlingkup tahun ajaran; anak yang belum terdaftar tahun itu memang tidak punya rapor tahun itu, dan menampilkan rapor kosong akan jauh lebih berbahaya daripada menolak.'
        })));
      return;
    }

    var leger = A.legerKelas(ctx(), rombelByName(state.ta, r.rombelNama), state.ta, state.semester);
    var peringkat = null;
    leger.forEach(function (x) { if (x.nisn === nisn) peringkat = x.peringkat; });
    var rombel = rombelByName(state.ta, r.rombelNama);

    var head = h('div', { class: 'rapor-head' },
      h('div', null,
        h('h3', { text: 'Laporan Hasil Belajar' }),
        h('p', { class: 'hint', text: state.school.sekolah.nama + ' · ' + D.KURIKULUM.nama }),
        h('dl', { class: 'kv', style: 'margin-top:8px' },
          h('dt', { text: 'Nama' }), h('dd', { style: 'font-family:inherit', text: siswa.nama }),
          h('dt', { text: 'NISN' }), h('dd', { text: siswa.nisn }),
          h('dt', { text: 'NIS' }), h('dd', { text: siswa.nis }),
          h('dt', { text: 'Rombel' }), h('dd', { text: r.rombelNama + ' · absen ' + r.absen }))),
      h('div', null,
        h('dl', { class: 'kv' },
          h('dt', { text: 'Tahun ajaran' }), h('dd', { text: r.ta }),
          h('dt', { text: 'Semester' }), h('dd', { text: r.semester }),
          h('dt', { text: 'Wali kelas' }), h('dd', { style: 'font-family:inherit', text: (guruById(rombel.waliGuruId) || {}).nama }),
          h('dt', { text: 'Rata-rata' }), h('dd', { text: r.rekap.rata === null ? '—' : r.rekap.rata.toFixed(2) }),
          h('dt', { text: 'Peringkat' }), h('dd', { text: peringkat ? (peringkat + ' dari ' + leger.length) : '—' }))));

    /* --- nilai: two aspects, never merged --- */
    var rows = r.baris.map(function (b) {
      function nilaiCell(a) {
        var hs = b.aspek[a];
        return hs.lengkap ? h('td', { class: 'num mono', text: hs.nilai.toFixed(2) }) : h('td', { class: 'hint', text: 'belum' });
      }
      function predCell(a) {
        var hs = b.aspek[a];
        return hs.lengkap ? h('td', null, h('span', { class: 'pred ' + hs.predikat, text: hs.predikat })) : h('td', { text: '—' });
      }
      return h('tr', null,
        h('td', { style: 'white-space:normal', text: b.mapel.nama }),
        h('td', { class: 'num', text: String(b.kkm) }),
        nilaiCell('peng'), predCell('peng'),
        nilaiCell('ket'), predCell('ket'),
        h('td', null, b.lengkap
          ? (b.tuntas ? h('span', { class: 'pill ok', text: 'tuntas' }) : h('span', { class: 'pill bad', text: 'remedial' }))
          : h('span', { class: 'hint', text: 'belum lengkap' })));
    });

    /* --- deskripsi capaian: the half of a K13 rapor that is not a number --- */
    var deskRows = [];
    r.baris.forEach(function (b) {
      D.ASPEK.forEach(function (a) {
        var hs = b.aspek[a.id];
        deskRows.push(h('tr', null,
          h('td', { style: 'white-space:normal', text: b.mapel.nama }),
          h('td', { text: a.ki + ' ' + a.label }),
          h('td', { style: 'white-space:normal', text: hs.lengkap ? hs.deskripsi : 'Deskripsi terbit setelah seluruh komponen penilaian selesai.' })));
      });
    });

    /* --- perhitungan --- */
    var hitungRows = [];
    r.baris.forEach(function (b) {
      D.ASPEK.forEach(function (a) {
        var hs = b.aspek[a.id];
        hitungRows.push(h('tr', null,
          h('td', { style: 'white-space:normal', text: b.mapel.nama }),
          h('td', { text: a.singkat }),
          h('td', { class: 'rincian', style: 'white-space:normal', text: hs.lengkap ? hs.rincian.map(function (x) { return x.nilai + '×' + x.bobot + '%'; }).join(' + ') : '—' }),
          h('td', { class: 'num mono', text: hs.lengkap ? hs.nilai.toFixed(2) : '—' })));
      });
    });

    /* --- sikap --- */
    var canSikap = D.can(user(), 'sikap.write', { rombelId: rombel.id });
    var sikapBox = h('div', null);
    D.SIKAP.forEach(function (dim) {
      var cur = r.sikap[dim.id];
      sikapBox.appendChild(h('div', { style: 'margin-bottom:8px' },
        h('div', { class: 'row-between' },
          h('b', { text: dim.label }),
          h('span', { class: 'pred ' + cur.predikat, text: cur.predikat + ' — ' + D.PREDIKAT_LABEL[cur.predikat] })),
        h('p', { class: 'note', style: 'margin-top:2px', text: cur.deskripsi }),
        canSikap.allowed
          ? h('div', { class: 'controls no-print' },
            field('Predikat ' + dim.label, select(
              D.PREDIKAT_SIKAP.map(function (x) { return { value: x, label: x + ' — ' + D.PREDIKAT_LABEL[x] }; }),
              cur.predikat,
              function (v) { simpanSikap(nisn, dim.id, v); },
              { 'data-fkey': 'sikap:' + dim.id })))
          : null));
    });

    function simpanSikap(nn, dim, pred) {
      var key = A.sikapKey(state.ta, state.semester, nn);
      var rec = state.sikapOverrides[key] || { k: key };
      rec[dim] = { predikat: pred };
      rec.oleh = state.guruId || 'wali';
      rec.pada = Date.now();
      state.sikapOverrides[key] = rec;
      St.put('sikap', rec);
      audit('sikap dinilai', siswa.nama + ' · ' + dim + ' → ' + pred);
      say('Sikap ' + dim + ' ' + siswa.nama + ' disimpan sebagai ' + pred);
      setTimeout(function () { renderPanel('rapor'); }, 0);
    }

    var catatanEl = canSikap.allowed
      ? h('textarea', {
        rows: '3', style: 'width:100%', 'data-fkey': 'sikap:catatan',
        placeholder: 'Catatan wali kelas untuk orang tua…',
        onchange: function (e) {
          var key = A.sikapKey(state.ta, state.semester, nisn);
          var rec = state.sikapOverrides[key] || { k: key };
          rec.catatanWali = e.target.value;
          rec.oleh = state.guruId || 'wali';
          rec.pada = Date.now();
          state.sikapOverrides[key] = rec;
          St.put('sikap', rec);
          audit('catatan wali disimpan', siswa.nama);
          say('Catatan wali disimpan.');
        }
      })
      : null;
    if (catatanEl) catatanEl.value = r.sikap.catatanWali;

    /* --- ketidakhadiran, in hari --- */
    var syarat = r.syaratKehadiran;
    var bar = h('div', { class: 'bar', style: 'max-width:320px' });
    ['H', 'S', 'I', 'A'].forEach(function (k) {
      var pct = r.presensi.total ? (r.presensi[k] / r.presensi.total * 100) : 0;
      if (pct > 0) bar.appendChild(h('i', { class: k.toLowerCase(), style: 'width:' + pct + '%' }));
    });

    p.appendChild(h('div', { class: 'rapor' }, head,

      r.lengkap ? null : h('div', { class: 'callout warn' },
        h('b', { text: 'Rapor sementara — semester masih berjalan. ' }),
        'Sebagian komponen penilaian belum melewati jendelanya, jadi nilai akhir, predikat dan peringkat belum diterbitkan untuk mapel yang bersangkutan.'),

      h('h4', { style: 'font-size:13px;margin:14px 0 6px', text: 'A. Nilai pengetahuan dan keterampilan' }),
      tableOf(['Mata pelajaran', { label: 'KKM', num: true },
        { label: 'KI-3 Nilai', num: true }, 'KI-3 Pred.',
        { label: 'KI-4 Nilai', num: true }, 'KI-4 Pred.', 'Status'],
        rows, { minWidth: '640px' }),
      h('p', { class: 'hint', style: 'margin-top:6px', text: 'Pengetahuan dan keterampilan adalah dua nilai yang tidak pernah dirata-ratakan menjadi satu. Sebuah rapor dengan satu angka per mapel bukan dokumen yang bisa diterbitkan SMP: keterampilan adalah separuh nilai di halaman ini.' }),

      h('h4', { style: 'font-size:13px;margin:16px 0 6px', text: 'B. Deskripsi capaian kompetensi' }),
      tableOf(['Mata pelajaran', 'Aspek', 'Deskripsi'], deskRows, { minWidth: '560px' }),

      h('h4', { style: 'font-size:13px;margin:16px 0 6px', text: 'C. Penilaian sikap (wali kelas)' }),
      sikapBox,
      canSikap.allowed ? null : h('p', { class: 'hint no-print', text: 'Predikat sikap hanya dapat diubah oleh wali kelas ' + r.rombelNama + '. ' + ((guruById(rombel.waliGuruId) || {}).nama || '') }),
      canSikap.allowed ? null : h('div', { class: 'no-print' }, jadiWali(rombel)),

      h('h4', { style: 'font-size:13px;margin:16px 0 6px', text: 'D. Ketidakhadiran (hari)' }),
      h('div', { class: 'grid2' },
        h('div', null,
          h('dl', { class: 'kv' },
            h('dt', { text: 'Sakit' }), h('dd', { text: syarat.sakitHari + ' hari' }),
            h('dt', { text: 'Izin' }), h('dd', { text: syarat.izinHari + ' hari' }),
            h('dt', { text: 'Tanpa keterangan' }), h('dd', { text: syarat.alpaHari + ' hari' }),
            h('dt', { text: 'Hari efektif' }), h('dd', { text: syarat.hariEfektif + ' hari' })),
          bar,
          h('div', { class: 'legend' },
            h('span', { class: 'lh', text: 'Hadir ' + r.presensi.H }),
            h('span', { class: 'ls', text: 'Sakit ' + r.presensi.S }),
            h('span', { class: 'li', text: 'Izin ' + r.presensi.I }),
            h('span', { class: 'la', text: 'Alpa ' + r.presensi.A }))),
        h('div', null,
          syarat.terpenuhi
            ? h('p', { class: 'pill ok', text: 'memenuhi kriteria: alpa ' + syarat.alpaHari + ' hari ≤ ' + syarat.maksAlpaHari + ' hari' })
            : h('div', { class: 'callout bad' }, h('b', { text: 'Kriteria ketidakhadiran tidak terpenuhi. ' }),
              syarat.alasan.join('; ') + '. Aplikasi menandai, tidak memutuskan: keputusan kenaikan kelas ada pada rapat dewan guru.'),
          h('p', { class: 'hint', style: 'margin-top:6px' },
            'Aturan yang menentukan adalah ketidakhadiran ', h('b', { text: 'tanpa keterangan' }),
            ' — itulah yang tertulis pada kriteria kenaikan kelas, dan itulah sebabnya sakit dan izin dicatat terpisah. ',
            'Sebagai informasi tersendiri, kehadiran murni ' + syarat.kehadiranPersen.toFixed(2) + '% terhadap ambang ' + syarat.minKehadiran + '%' +
            (syarat.kehadiranCukup ? ' (terpenuhi).' : ' (di bawah ambang — periksa apakah penyebabnya sakit berdokumen).')))),

      h('h4', { style: 'font-size:13px;margin:16px 0 6px', text: 'E. Catatan wali kelas' }),
      catatanEl
        ? h('div', null, catatanEl, h('p', { class: 'hint no-print', text: 'Tersimpan saat kolom kehilangan fokus, tercatat di jejak audit.' }))
        : h('p', { class: 'note', text: r.sikap.catatanWali || 'Belum ada catatan wali kelas.' }),

      h('h4', { style: 'font-size:13px;margin:16px 0 6px', text: 'F. Rekapitulasi dan perhitungan' }),
      h('div', { class: 'grid2' },
        h('div', null,
          h('dl', { class: 'kv' },
            h('dt', { text: 'Mapel tuntas' }), h('dd', { text: r.rekap.tuntas + ' dari ' + r.rekap.mapelCount }),
            h('dt', { text: 'Perlu remedial' }), h('dd', { text: String(r.rekap.belumTuntas) }),
            h('dt', { text: 'Rata-rata KI-3' }), h('dd', { text: r.rekap.rataPeng === null ? '—' : r.rekap.rataPeng.toFixed(2) }),
            h('dt', { text: 'Rata-rata KI-4' }), h('dd', { text: r.rekap.rataKet === null ? '—' : r.rekap.rataKet.toFixed(2) }),
            h('dt', { text: 'Peringkat' }), h('dd', { text: peringkat ? (peringkat + ' / ' + leger.length) : '—' }))),
        h('div', null,
          h('p', { class: 'hint', text: 'Nilai dasar dihasilkan dari fungsi hash atas (NISN, mapel, tahun ajaran, semester, aspek, komponen), dan presensi dari fungsi hash atas (NISN, tanggal). Karena itu perhitungan ulang selalu memberi angka yang sama, dan tab Uji membandingkan dua rapor hasil pembangunan sekolah yang berbeda untuk membuktikannya.' }))),
      tableOf(['Mata pelajaran', 'Aspek', 'Perhitungan', { label: 'Nilai', num: true }], hitungRows, { minWidth: '560px' }),
      h('p', { class: 'hint', style: 'margin-top:6px', text: 'Pembulatan dilakukan sekali, di akhir.' })));
  }

  /* ================================================================ PPDB == */

  function renderPpdb(p) {
    var can = D.can(user(), 'ppdb.decide', {});
    var sc = state.school;
    var ppdb = sc.ppdb;

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'PPDB — penerimaan peserta didik baru ' + ppdb.ta }),
      h('p', { class: 'note' },
        'Seleksi dilakukan ', h('b', { text: 'per jalur' }), ', bukan satu peringkat global, dan tiap jalur memakai kriteria sendiri: zonasi dan afirmasi diurutkan dari jarak terdekat, prestasi dari skor tertinggi, perpindahan tugas dari tanggal daftar. Kursi yang tidak terisi di satu jalur dilimpahkan ke zonasi — bukan hangus.'),
      h('p', { class: 'note' },
        h('b', { text: 'PPDB bukan siapa cepat dia dapat. ' }),
        'Tanggal daftar hanya menjadi kriteria di jalur perpindahan tugas, tempat tanggal memang aturannya. Di jalur lain seri dipecah oleh ',
        h('b', { text: 'usia lebih tua' }), ', lalu NISN — bukan urutan pendaftaran. Batas usia diperiksa lebih dulu: paling tinggi ' +
        D.PPDB_USIA_MAKS + ' tahun pada ' + D.tanggalPanjang(ppdb.tanggalAcuan) + ', dan pendaftar yang melampauinya tidak diberi peringkat sama sekali, melainkan ditolak dengan alasan yang disebut.'),
      h('p', { class: 'note' },
        h('b', { text: 'Yang tidak dimodelkan, dan sebaiknya disebut: ' }),
        'kelayakan zonasi sesungguhnya bertumpu pada alamat pada Kartu Keluarga yang terbit sekurang-kurangnya satu tahun sebelum pendaftaran, bukan pada angka jarak mentah seperti di sini. Jarak hanya menentukan urutan di dalam kelompok yang sudah dinyatakan layak; demo ini menyederhanakannya menjadi jarak saja, dan itu adalah penyederhanaan, bukan aturannya.'),
      h('p', { class: 'hint' }, 'Yang diterima memakai ', h('b', { text: 'NISN yang sudah mereka bawa dari SD' }),
        ' — sekolah tidak menerbitkan identitas baru saat menerima anak. Daftar kelas 7 pada tab Peserta Didik ',
        h('b', { text: 'diturunkan dari hasil seleksi ini' }),
        ', bukan digenerasi terpisah lalu dicocokkan: yang diterima di sini adalah persis yang terdaftar di sana, tidak kurang tidak lebih.'),
      can.allowed ? null : denial(can)));

    /* --- quota legality --- */
    var periksa = D.periksaKuota(ppdb.kuota, ppdb.kuotaTotal);
    var langgar = periksa.filter(function (x) { return !x.ok; });
    var rowsK = periksa.map(function (r) {
      var ring = null;
      ppdb.ringkas.forEach(function (x) { if (x.jalur === r.jalur) ring = x; });
      return h('tr', null,
        h('td', null, h('b', { text: r.label })),
        h('td', { class: 'num', text: String(r.kuota) }),
        h('td', { class: 'num mono', text: r.persen.toFixed(2) + '%' }),
        h('td', { text: r.aturan }),
        h('td', null, r.ok ? h('span', { class: 'pill ok', text: 'sesuai' }) : h('span', { class: 'pill bad', text: 'melanggar' })),
        h('td', { class: 'num', text: ring ? String(ring.pendaftar) : '—' }),
        h('td', { class: 'num', text: ring ? String(ring.diterima) : '—' }),
        h('td', { class: 'num', text: ring ? String(ring.cadangan) : '—' }),
        h('td', { style: 'white-space:normal', text: ring ? ring.kriteria : '' }));
    });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Kuota per jalur — total ' + ppdb.kuotaTotal + ' kursi untuk ' + ppdb.rombelTujuan.join(', ') }),
      h('p', { class: 'note' },
        'Porsi jalur adalah ', h('b', { text: 'batas, bukan target' }),
        ': zonasi dan afirmasi punya batas bawah, perpindahan tugas punya batas atas, dan prestasi adalah sisanya. Karena itu pembulatan batas bawah ke ',
        h('b', { text: 'atas' }), ', batas atas ke ', h('b', { text: 'bawah' }),
        ', dan sisa pembulatan diserap prestasi. Menyerapnya di jalur mana pun yang kebetulan terakhir dalam array menghasilkan 6 kursi perpindahan dari 96 (6,25%, di atas plafon 5%) dan 14 kursi afirmasi (14,58%, di bawah lantai 15%) — aritmetika yang membatalkan PPDB sebuah sekolah kalau digugat.'),
      langgar.length
        ? h('div', { class: 'callout bad' }, h('b', { text: langgar.length + ' jalur melanggar batas regulasi.' }))
        : h('div', { class: 'callout ok' }, h('b', { text: 'Seluruh jalur berada dalam batas regulasi.' }), ' Diperiksa oleh ', h('code', { text: 'D.periksaKuota' }), ', bukan diklaim.'),
      tableOf(['Jalur', { label: 'Kuota', num: true }, { label: 'Porsi', num: true }, 'Aturan', 'Status',
        { label: 'Pendaftar', num: true }, { label: 'Diterima', num: true }, { label: 'Cadangan', num: true }, 'Kriteria peringkat'],
        rowsK, { minWidth: '900px' })));

    if (ppdb.gugur.length) {
      p.appendChild(h('div', { class: 'card' },
        h('h3', { text: 'Gugur sebelum pemeringkatan — ' + ppdb.gugur.length + ' pendaftar' }),
        h('p', { class: 'note', text: 'Kelayakan usia diperiksa sebelum ranking, bukan sesudahnya. Pendaftar yang melampaui batas tidak ditaruh di peringkat terakhir; ia tidak diberi peringkat sama sekali, dengan alasan yang bisa dibacakan ke orang tua.' }),
        tableOf(['Nama', 'NISN', 'Jalur', { label: 'Usia 1 Juli', num: true }, 'Alasan'],
          ppdb.gugur.map(function (g) {
            return h('tr', null,
              h('td', { style: 'white-space:normal', text: g.nama }),
              h('td', { class: 'mono small', text: g.nisn }),
              h('td', { text: g.jalur }),
              h('td', { class: 'num', text: String(g.usia) }),
              h('td', { style: 'white-space:normal', text: g.alasan }));
          }), { minWidth: '640px' })));
    }

    var jalurOpts = [{ value: 'semua', label: 'Semua jalur' }].concat(D.JALUR.map(function (j) { return { value: j.id, label: j.label }; }));
    var list = ppdb.hasil.filter(function (x) {
      return (state.sel.ppdbJalur === 'semua' || x.jalur === state.sel.ppdbJalur) && x.status !== 'tidak-memenuhi-syarat';
    });
    list = list.slice().sort(function (a, b) {
      if (a.jalur !== b.jalur) return a.jalur < b.jalur ? -1 : 1;
      return a.peringkat - b.peringkat;
    });

    var rows2 = list.slice(0, 220).map(function (x) {
      var pill = x.status === 'diterima' ? 'ok' : x.status === 'cadangan' ? 'warn' : '';
      return h('tr', null,
        h('td', { class: 'num', text: String(x.peringkat) }),
        h('td', { style: 'white-space:normal', text: x.nama }),
        h('td', { class: 'mono small', text: x.nisn }),
        h('td', { text: x.jalur }),
        h('td', { class: 'num mono', text: (x.ref.jarakMeter / 1000).toFixed(2) + ' km' }),
        h('td', { class: 'mono small', text: x.ref.tglLahir }),
        h('td', { class: 'num', text: String(x.ref.usia) }),
        h('td', { class: 'num mono', text: x.ref.nilaiRapor.toFixed(1) }),
        h('td', { class: 'num mono', text: String(x.ref.poinPrestasi) }),
        h('td', { class: 'num mono', text: x.ref.skor.toFixed(1) }),
        h('td', { text: x.ref.asalSekolah }),
        h('td', null, h('span', { class: 'pill ' + pill, text: x.status })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Peringkat pendaftar' }),
        field('Jalur', select(jalurOpts, state.sel.ppdbJalur, function (v) { state.sel.ppdbJalur = v; renderPanel('ppdb'); }, { 'data-fkey': 'ppdb:jalur' }))),
      h('p', { class: 'note', text: 'Kolom skor hanya dipakai jalur prestasi; jalur zonasi dan afirmasi mengabaikannya sepenuhnya dan diurut jarak. Itu terlihat dari peringkatnya. Kolom usia dipakai sebagai pemecah seri, bukan sebagai kriteria utama.' }),
      tableOf([{ label: '#', num: true }, 'Nama', 'NISN', 'Jalur', { label: 'Jarak', num: true }, 'Tgl lahir',
      { label: 'Usia', num: true }, { label: 'Rapor', num: true }, { label: 'Prestasi', num: true },
      { label: 'Skor', num: true }, 'Asal sekolah', 'Status'],
        rows2, { minWidth: '1000px' })));
  }

  /* ============================================================== KOMITE == */

  function komiteLedgerEfektif(siswa, ta) {
    var base = S.komiteLedger(siswa, ta);
    for (var i = 0; i < base.length; i++) {
      var k = ta + '|' + siswa.nisn + '|' + base[i].year + '-' + base[i].month;
      var ov = state.komiteOverrides[k];
      if (ov) base[i].paidAt = ov.paidAt;
    }
    return base;
  }

  var KOMITE_GLYPH = { 'lunas': '✓', 'belum-dibayar': '·', 'bebas': '–', 'belum-jatuh-tempo': '○' };

  function renderKomite(p) {
    var canWrite = D.can(user(), 'komite.write', {});
    var daftar;
    if (state.role === 'ortu') daftar = [state.nisn];
    else {
      var rbs = rombelList(state.ta);
      if (!state.sel.komiteRombel || !rombelByName(state.ta, state.sel.komiteRombel)) state.sel.komiteRombel = rbs[0].nama;
      daftar = rombelByName(state.ta, state.sel.komiteRombel).siswa;
    }

    var head = h('div', { class: 'card' },
      h('h3', { text: 'Iuran komite — buku bulanan ' + state.ta }),
      h('div', { class: 'callout ok' },
        h('b', { text: 'Sekolah ini negeri, jadi tidak ada SPP. ' }),
        'SPP di SMP negeri sudah dihapus; yang tersisa adalah iuran komite yang disepakati bersama orang tua dan sifatnya ',
        h('b', { text: 'sukarela' }), '. Karena itu tidak ada status "tunggakan", tidak ada nominal tagihan, tidak ada surat penagihan, dan tidak ada konsekuensi apa pun bagi anak yang keluarganya tidak membayar. ' +
        'Memodelkannya sebagai tunggakan akan menggambarkan sekolah yang berbeda dari sekolah yang seleksi masuknya berjalan dengan zonasi — dua layar paling khas institusi di aplikasi ini harus bercerita tentang satu sekolah yang sama.'),
      h('p', { class: 'note' },
        'Dua belas bulan, Juli sampai Juni, mengikuti tahun ajaran dan bukan tahun kalender. Yang tetap dipertahankan dari buku tagihan adalah bagian yang memang jadi sumber bug: ',
        h('b', { text: 'bulan yang belum jatuh tempo bukan kekurangan' }),
        '. Tanggal acuan demo: ' + S.SEKARANG_LABEL + '. Penerima KIP dibebaskan — sebagai dukungan penghasilan, bukan sebagai keringanan tagihan.'),
      state.role === 'ortu' ? null : h('div', { class: 'controls' },
        field('Rombel', select(rombelList(state.ta).map(function (r) { return { value: r.nama, label: r.nama }; }),
          state.sel.komiteRombel, function (v) { state.sel.komiteRombel = v; renderPanel('komite'); }, { 'data-fkey': 'komite:rombel' }))),
      canWrite.allowed ? null : denial(canWrite));
    p.appendChild(head);

    var totalBelum = 0, jumlahBelum = 0;
    var rows = daftar.map(function (nisn) {
      var s = state.school.siswa[nisn];
      var ledger = komiteLedgerEfektif(s, state.ta);
      var roll = D.rollupKomite(ledger, S.SEKARANG);
      totalBelum += roll.nominalBelum;
      if (roll.belumDibayar) jumlahBelum++;
      var grid = h('div', { class: 'spp-grid' });
      roll.bulan.forEach(function (b) {
        var cls = b.status === 'lunas' ? 'lunas' : b.status === 'belum-dibayar' ? 'belum' : b.status === 'bebas' ? 'bebas' : '';
        var teks = D.NAMA_BULAN[b.month].slice(0, 3) + ' ' + KOMITE_GLYPH[b.status];
        // Status is carried by a glyph and an aria-label, not by colour alone:
        // a red/green colour-blind reader and a screen-reader user both need
        // the state, and `title` on a plain div reaches neither reliably.
        grid.appendChild(h('div', {
          class: 'spp-m ' + cls,
          title: D.NAMA_BULAN[b.month] + ' ' + b.year + ' — ' + D.KOMITE_STATUS_LABEL[b.status],
          'aria-label': D.NAMA_BULAN[b.month] + ' ' + b.year + ': ' + D.KOMITE_STATUS_LABEL[b.status],
          role: 'img',
          text: teks
        }));
      });
      return h('tr', null,
        h('td', { class: 'num', text: String(s.enrol[state.ta].absen) }),
        h('td', { style: 'white-space:normal', text: s.nama }),
        h('td', { class: 'mono small', text: s.nisn }),
        h('td', null, s.kip ? h('span', { class: 'pill info', text: 'KIP' }) : ''),
        h('td', { style: 'min-width:330px' }, grid),
        h('td', { class: 'num', text: String(roll.lunas) }),
        h('td', { class: 'num', text: String(roll.belumDibayar) }),
        h('td', { class: 'num mono', text: roll.nominalBelum ? D.rupiah(roll.nominalBelum) : '—' }),
        h('td', { class: 'no-print' }, roll.belumDibayar && canWrite.allowed
          ? h('button', {
            class: 'btn small', type: 'button', 'data-fkey': 'komite:catat:' + fkey(nisn),
            onclick: function () {
              var target = null;
              roll.bulan.forEach(function (b) { if (!target && b.status === 'belum-dibayar') target = b; });
              if (!target) return;
              var k = state.ta + '|' + nisn + '|' + target.year + '-' + target.month;
              var rec = { k: k, paidAt: S.SEKARANG, oleh: 'TU' };
              state.komiteOverrides[k] = rec;
              St.put('komite', rec);
              audit('iuran komite dicatat', s.nama + ' · ' + D.NAMA_BULAN[target.month] + ' ' + target.year);
              say('Iuran ' + D.NAMA_BULAN[target.month] + ' ' + s.nama + ' dicatat.');
              renderPanel('komite');
            }
          }, 'Catat 1 bulan')
          : ''));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: state.role === 'ortu' ? 'Iuran komite anak Anda' : 'Rombel ' + state.sel.komiteRombel }),
        h('span', { class: 'hint', text: jumlahBelum + ' peserta didik dengan bulan belum dibayar · ' + D.rupiah(totalBelum) + ' (bukan piutang)' })),
      h('div', { class: 'legend', style: 'margin-bottom:8px' },
        h('span', { style: 'color:var(--ok)', text: '✓ sudah dibayar' }),
        h('span', { style: 'color:var(--warn)', text: '· belum dibayar (sukarela)' }),
        h('span', { style: 'color:var(--info)', text: '– dibebaskan (KIP)' }),
        h('span', { class: 'hint', text: '○ belum jatuh tempo' })),
      tableOf([{ label: 'Abs', num: true }, 'Nama', 'NISN', '', 'Jul → Jun',
      { label: 'Dibayar', num: true }, { label: 'Belum', num: true }, { label: 'Nominal belum', num: true }, ''],
        rows, { minWidth: '940px' })));
  }

  /* ================================================================= UJI == */

  function renderUji(p) {
    var card = h('div', { class: 'card' },
      h('h3', { text: 'Assertion suite' }),
      h('p', { class: 'note' },
        'Berkas yang sama (', h('code', { text: 'tests.js' }), ') berjalan di halaman ini dan di bawah node. ',
        'Yang paling menanggung beban: assertion kendala keras tidak menanyakan pendapat solver, melainkan ',
        h('b', { text: 'membangun ulang seluruh minggu sel demi sel' }),
        ' dari beberapa solusi independen dan mencari tabrakan secara berpasangan. Kalau solver dan pemeriksa ini berbeda pendapat, pemeriksa ini yang benar.'));

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

  var ujiWorker = null, ujiWorkerBroken = false;

  /* The suite is 309 assertions with several full solver runs in it, well over
   * a second of straight-line work. Run on the main thread it did that a few
   * milliseconds after first paint: the page looked ready and then ignored
   * every click until the last assertion was in. So it runs in a Worker.
   *
   * There is no test worker file to point at, hence the Blob — and hence the
   * rebasing importScripts, because a blob: worker has no base URL that a bare
   * 'solver.js' can resolve against. solver.worker.js is imported first and on
   * purpose: this realm then carries the SAME egress wrappers the solver's
   * realm does, reported to the same counter, instead of a second copy of them
   * that could drift, or a third realm nothing is watching. */
  function ujiWorkerSource() {
    var base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    return 'var __base = ' + JSON.stringify(base) + ';\n' +
      'var __imp = self.importScripts;\n' +
      'self.importScripts = function () {\n' +
      '  var a = [], i, u;\n' +
      '  for (i = 0; i < arguments.length; i++) {\n' +
      '    u = String(arguments[i]);\n' +
      '    a.push(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : __base + u);\n' +
      '  }\n' +
      '  return __imp.apply(self, a);\n' +
      '};\n' +
      "self.importScripts('solver.worker.js', 'domain.js', 'data.js', 'akademik.js', 'tests.js');\n" +
      'self.addEventListener("message", function (ev) {\n' +
      '  var m = ev.data || {};\n' +
      '  if (m.type !== "uji") return;\n' +
      '  var t0 = Date.now();\n' +
      '  try {\n' +
      '    var run = SIAKAD_TESTS.run();\n' +
      '    run.ms = Date.now() - t0;\n' +
      '    self.postMessage({ type: "uji", run: run });\n' +
      '  } catch (e) {\n' +
      '    self.postMessage({ type: "uji-gagal", message: String(e && e.stack || e) });\n' +
      '  }\n' +
      '});\n';
  }

  function ensureUjiWorker() {
    if (ujiWorker || ujiWorkerBroken) return ujiWorker;
    try {
      var url = URL.createObjectURL(new Blob([ujiWorkerSource()], { type: 'text/javascript' }));
      ujiWorker = new Worker(url);
      ujiWorker.onmessage = function (ev) {
        var m = ev.data || {};
        if (m.type === 'net') { noteWorkerNet(m); return; }
        if (m.type === 'uji') { applyTests(m.run); return; }
        if (m.type === 'uji-gagal') {
          applyTests({
            results: [{ group: 'runner', name: 'suite melempar', ok: false, message: m.message }],
            passed: 0, failed: 1, total: 1, ms: 0
          });
        }
      };
      // An import that fails leaves the badge spinning forever unless the page
      // falls back, and a badge that never resolves is worse than a slow one.
      ujiWorker.onerror = function () {
        ujiWorkerBroken = true; ujiWorker = null;
        if (!state.tests) runTestsMainThread();
      };
    } catch (e) { ujiWorkerBroken = true; ujiWorker = null; }
    return ujiWorker;
  }

  function runTests() {
    var w = ensureUjiWorker();
    if (w) { w.postMessage({ type: 'uji' }); return; }
    runTestsMainThread();
  }

  // Same suite, same file, main thread — for a browser with no Worker or no
  // blob: URL. It blocks, and the page says nothing it cannot back up.
  function runTestsMainThread() {
    var t0 = Date.now();
    var run;
    try { run = T.run(); }
    catch (e) {
      run = { results: [{ group: 'runner', name: 'suite melempar', ok: false, message: String(e && e.stack || e) }], passed: 0, failed: 1, total: 1 };
    }
    run.ms = Date.now() - t0;
    applyTests(run);
  }

  function applyTests(run) {
    state.tests = run;
    paintTests();
    say(run.failed ? ('Uji: ' + run.failed + ' gagal.') : ('Uji: ' + run.passed + ' assertion lulus.'));
    if (state.view === 'uji') renderPanel('uji');
  }

  /* ============================================================= plumbing */

  var RENDER = {
    beranda: renderBeranda, siswa: renderSiswa, guru: renderGuru, rombel: renderRombel,
    jadwal: renderJadwal, presensi: renderPresensi, penilaian: renderPenilaian,
    rapor: renderRapor, ppdb: renderPpdb, komite: renderKomite, uji: renderUji
  };

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel) return;
    /* Every render is a teardown, and a teardown throws keyboard focus to
     * <body>. Capturing the focused element's stable key first and restoring it
     * afterwards is the difference between a usable keyboard path and one where
     * picking a lesson costs the user twelve Tab presses to get back. */
    var snap = captureFocus();
    clear(panel);
    try { RENDER[name](panel); }
    catch (e) {
      panel.appendChild(h('div', { class: 'callout bad' },
        h('b', { text: 'Panel gagal dirender. ' }), String(e && e.message || e)));
      if (window.console) console.error(e);
    }
    restoreFocus(snap);
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
    var snap = captureFocus();
    renderCtxBar();
    renderPanel(state.view);
    restoreFocus(snap);
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

  function boot() {
    state.school = S.build(20260915);
    state.konfig = defaultKonfig();
    state.guruId = state.school.guru[3].id;
    state.rombelId = rombelList(state.ta)[0].id;
    state.nisn = rombelList(state.ta)[0].siswa[0];
    state.sel.rombel = rombelList(state.ta)[0].nama;
    state.sel.komiteRombel = rombelList(state.ta)[0].nama;

    paintTheme();
    $('themeBtn').addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('testBadge').addEventListener('click', function () { switchTab('uji'); });
    if (window.SIAKAD_GUARD) window.SIAKAD_GUARD.onchange = paintNet;
    paintNet();
    paintTests();
    wireTabs();

    loadAll().then(function () {
      renderAll();
      // The suite drives the badge, the solver makes the Jadwal tab alive
      // without a click. Both hand their work to a Worker, so neither is in the
      // way of the visitor's first click.
      setTimeout(function () {
        runTests();
        if (!state.jadwal[state.ta]) solveJadwal();
        else { state.spec[state.ta] = buildSpec(state.ta, state.jadwal[state.ta].skenario || 'normal'); renderPanel(state.view); }
      }, 30);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
