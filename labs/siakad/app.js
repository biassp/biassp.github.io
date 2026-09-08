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

  /* --------------------------------------------------------------- state */

  var state = {
    school: null,
    ta: S.TA_AKTIF,
    semester: S.SEMESTER_AKTIF,
    role: 'admin',
    guruId: null,
    rombelId: null,
    nisn: null,
    konfig: { bobot: {}, kkm: {} },
    nilaiOverrides: {},
    presensiOverrides: {},
    sppOverrides: {},
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
      rombel: '', mapel: 'mtk', jadwalMode: 'rombel', jadwalKey: '',
      raporNisn: '', pertemuan: 1, sppRombel: '', ppdbJalur: 'semua',
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
      presensiOverrides: state.presensiOverrides
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
        renderAll();
      }
    }, label || ('Masuk sebagai pengampu (' + (guruById(pengampuId) || {}).nama + ')'));
  }

  /* -------------------------------------------------------- persistence */

  function loadAll() {
    return Promise.all([
      St.all('konfig'), St.all('nilai'), St.all('presensi'),
      St.all('jadwal'), St.all('spp'), St.all('audit')
    ]).then(function (r) {
      (r[0] || []).forEach(function (rec) {
        if (rec.k === 'bobot' && rec.v) state.konfig.bobot = rec.v;
        if (rec.k === 'kkm' && rec.v) state.konfig.kkm = rec.v;
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
      (r[4] || []).forEach(function (rec) { state.sppOverrides[rec.k] = rec; });
      state.audit = (r[5] || []).slice(-40).reverse();
    }).catch(function () { });
  }

  function saveKonfig() {
    St.put('konfig', { k: 'bobot', v: state.konfig.bobot });
    St.put('konfig', { k: 'kkm', v: state.konfig.kkm });
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

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    St.writeLocal('siakad.theme', next);
    $('themeBtn').textContent = next === 'dark' ? 'Terang' : 'Gelap';
  }

  /* ------------------------------------------------------------ ctx bar */

  function renderCtxBar() {
    var bar = $('ctxbar');
    clear(bar);

    bar.appendChild(field('Tahun ajaran', select(
      state.school.sekolah.taList.map(function (t) { return { value: t, label: t }; }),
      state.ta,
      function (v) { state.ta = v; state.sel.rombel = ''; state.sel.sppRombel = ''; state.sel.raporNisn = ''; state.picked = null; renderAll(); }
    )));

    bar.appendChild(field('Semester', select(
      [{ value: 'ganjil', label: 'Ganjil (Jul–Des)' }, { value: 'genap', label: 'Genap (Jan–Jun)' }],
      state.semester,
      function (v) { state.semester = v; renderAll(); }
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
        savePeran(); renderAll();
      }
    )));

    if (state.role === 'guru') {
      bar.appendChild(field('Guru', select(
        state.school.guru.map(function (g) { return { value: g.id, label: g.id + ' — ' + g.nama }; }),
        state.guruId, function (v) { state.guruId = v; savePeran(); renderAll(); }
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
        }
      )));
    } else if (state.role === 'ortu') {
      var opts = [];
      rombelList(state.ta).forEach(function (r) {
        r.siswa.forEach(function (n) { opts.push({ value: n, label: r.nama + ' — ' + state.school.siswa[n].nama }); });
      });
      bar.appendChild(field('Anak', select(opts, state.nisn, function (v) { state.nisn = v; state.sel.raporNisn = v; savePeran(); renderAll(); })));
    }

    var roleDef = null;
    D.ROLES.forEach(function (r) { if (r.id === state.role) roleDef = r; });
    bar.appendChild(h('p', { class: 'ctx-note' },
      h('span', { class: 'rolechip', text: roleDef.label }), ' ', roleDef.note,
      h('br'),
      h('span', { class: 'small', text: 'Tanggal acuan demo: ' + S.SEKARANG_LABEL + ' · penyimpanan: ' + (St.mode === 'idb' ? 'IndexedDB' : 'memori (' + St.reason + ')') })
    ));
  }

  /* ============================================================ BERANDA == */

  function renderBeranda(p) {
    var sc = state.school;
    var rb = rombelList(state.ta);
    var aktif = rb.reduce(function (a, r) { return a + r.siswa.length; }, 0);
    var totalJp = sc.mapel.reduce(function (a, m) { return a + m.jp; }, 0);
    var jd = state.jadwal[state.ta];

    var stats = h('div', { class: 'summary' });
    function stat(k, v, n) { stats.appendChild(h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), n ? h('div', { class: 'n', text: n }) : null)); }
    stat('Tahun ajaran', state.ta, 'semester ' + state.semester);
    stat('Peserta didik', String(aktif), 'terdaftar pada ' + state.ta);
    stat('Rombel', String(rb.length), rb.map(function (r) { return r.nama; }).join(' '));
    stat('Guru', String(sc.guru.length), 'pengampu ' + sc.mapel.length + ' mapel');
    stat('Beban kurikulum', totalJp + ' JP', 'per rombel per minggu');
    stat('Jadwal', jd ? 'tersusun' : 'belum', jd ? (jd.stats.msTotal + ' ms · skor lunak ' + jd.stats.softAkhir) : 'buka tab Jadwal');
    p.appendChild(stats);

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Apa yang sebenarnya dikerjakan aplikasi ini' }),
      h('p', { class: 'note', text: 'Bagian tersulitnya bukan CRUD siswa. Tiga hal di bawah ini yang menentukan apakah sebuah SIAKAD bisa dipakai sekolah sungguhan.' }),
      h('div', { class: 'grid2' },
        h('div', null,
          h('p', null, h('b', { text: '1. Jadwal sebagai constraint satisfaction problem. ' }),
            'Guru tidak bisa berada di dua ruang sekaligus, rombel tidak bisa mengikuti dua mapel sekaligus, ruang tidak bisa dipakai dua kelas sekaligus, ketidaksediaan guru harus dihormati, dan JP tiap mapel harus terpenuhi persis. Solver di sini backtracking dengan forward checking dan heuristik most-constrained-variable — bukan penempatan acak yang lalu ditambal.'),
          h('p', { style: 'margin-top:8px' }, h('b', { text: '2. Semuanya berlingkup tahun ajaran. ' }),
            'Rombel 8B tahun 2025/2026 dan 8B tahun 2026/2027 adalah dua objek berbeda berisi anak berbeda. Riwayat menempel pada tahunnya. Siswa kelas 7 sekarang tidak punya rapor tahun lalu, dan aplikasi mengatakannya, bukan menampilkan rapor kosong.')),
        h('div', null,
          h('p', null, h('b', { text: '3. Penilaian terbobot yang bisa diperiksa. ' }),
            'Tugas / UH / PTS / PAS dengan bobot yang wajib berjumlah tepat 100%, KKM per mapel, predikat A–D yang diturunkan dari KKM (bukan tabel tetap), dan rapor yang menunjukkan aritmetikanya baris demi baris. Perhitungan ulang selalu memberi angka yang sama — ada assertion yang mengunci itu.'),
          h('p', { style: 'margin-top:8px' }, h('b', { text: 'Identitas. ' }),
            'NISN (nasional, 10 digit, sekali seumur hidup), NIS (lokal sekolah) dan nomor absen (posisi di rombel, berubah tiap tahun) adalah tiga hal berbeda. Menyamakannya sama saja dengan memakai nomor ranjang sebagai nomor rekam medis.')))));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Privasi: ini catatan anak' }),
      h('p', { class: 'note' },
        'Data peserta didik adalah kategori paling sensitif setelah rekam medis. Karena itu: seluruh isi halaman ini fabrikasi, tidak ada NIK sama sekali, tidak ada satu pun byte yang meninggalkan tab ini, dan penghitung jaringan di header tetap ',
        h('b', { text: 'nol' }),
        '. Suntingan Anda tersimpan di IndexedDB peramban ini saja. Tombol di bawah menghapusnya kembali ke keadaan awal.'),
      h('div', { class: 'controls' },
        h('button', {
          class: 'btn', type: 'button', onclick: function () {
            St.clearAll().then(function () {
              state.nilaiOverrides = {}; state.presensiOverrides = {}; state.sppOverrides = {};
              state.jadwal = {}; state.audit = [];
              state.konfig = { bobot: JSON.parse(JSON.stringify(state.school.bobot)), kkm: JSON.parse(JSON.stringify(state.school.kkm)) };
              renderAll();
            });
          }
        }, 'Hapus seluruh data tersimpan'),
        h('span', { class: 'hint', text: 'Data turunan (nilai & presensi sintetis) dibangun ulang dari seed ' + state.school.seed + ', jadi halaman tetap hidup setelah dihapus.' }))));

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
      h('p', { class: 'note', text: 'Setiap perubahan nilai, presensi, jadwal, bobot dan pembayaran ditulis ke jejak append-only. Sistem sekolah tanpa jejak audit tidak bisa dipertanggungjawabkan: "nilainya berubah dan tidak ada yang tahu siapa" adalah keluhan yang mengakhiri satu kontrak.' }),
      auditRows.length
        ? tableOf(['Waktu', 'Peran', 'Aktor', 'Aksi', 'Detail'], auditRows)
        : h('div', { class: 'empty', text: 'Belum ada perubahan. Coba sunting nilai di tab Penilaian atau pindahkan sesi di tab Jadwal.' })));
  }

  /* ====================================================== PESERTA DIDIK == */

  function renderSiswa(p) {
    var can = D.can(user(), 'siswa.read', {});
    if (!can.allowed) {
      p.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Daftar peserta didik' }), denial(can),
        h('p', { class: 'hint', text: 'Akun orang tua tetap bisa membuka rapor dan SPP anaknya sendiri di tab masing-masing.' })));
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
          '. Registry menolak menerbitkan nomor yang sama dua kali, dan tab Uji membuktikannya dengan 3.000 penerbitan berturut-turut.'))));

    var rb = rombelList(state.ta);
    var opts = [{ value: 'semua', label: 'Semua rombel (' + state.ta + ')' }].concat(
      rb.map(function (r) { return { value: r.nama, label: r.nama + ' (' + r.siswa.length + ')' }; }));

    var kontrol = h('div', { class: 'controls' },
      field('Rombel', select(opts, state.sel.siswaRombel, function (v) { state.sel.siswaRombel = v; renderPanel('siswa'); })),
      field('Cari nama / NISN / NIS', h('input', {
        type: 'search', value: state.sel.cari, placeholder: 'ketik untuk menyaring',
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
            ? lain.map(function (t) { return t + ': ' + s.enrol[t].rombelNama; }).join(' · ')
            : h('span', { class: 'hint', text: 'tidak ada riwayat tahun lain' })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Peserta didik — ' + state.ta }),
        h('span', { class: 'hint', text: list.length + ' siswa' + (list.length > 260 ? ' (260 pertama ditampilkan)' : '') })),
      h('p', { class: 'note', text: 'Kolom "Riwayat" menunjukkan rombel anak yang sama pada tahun ajaran lain. Kolom itu kosong untuk siswa kelas 7 karena mereka memang belum ada di sekolah ini tahun lalu — bukan karena datanya hilang.' }),
      kontrol,
      rows.length
        ? tableOf([{ label: 'Absen', num: true }, 'Nama', 'NISN', 'NIS', 'Rombel', 'JK', 'Tgl lahir', '', 'Riwayat'], rows, { minWidth: '860px' })
        : h('div', { class: 'empty', text: 'Tidak ada yang cocok.' })));
  }

  /* ================================================================ GURU == */

  function renderGuru(p) {
    var spec = state.spec[state.ta];
    var beban = {};
    if (spec) spec.sesi.forEach(function (s) { beban[s.guruId] = (beban[s.guruId] || 0) + s.len; });

    var rows = state.school.guru.map(function (g) {
      var m = mapelById(g.mapelUtama);
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
      return h('tr', null,
        h('td', { class: 'mono', text: g.id }),
        h('td', { style: 'white-space:normal', text: g.nama }),
        h('td', { text: m ? m.nama : '' }),
        h('td', { class: 'num', text: String(beban[g.id] || 0) }),
        h('td', { class: 'num', text: String(g.maxJamHarian) }),
        h('td', { text: wali.join(', ') || '—' }),
        h('td', { style: 'white-space:normal' },
          ringkas ? h('span', null, ringkas, g.alasanTidakTersedia ? h('span', { class: 'hint', text: ' — ' + g.alasanTidakTersedia }) : null) : h('span', { class: 'hint', text: 'selalu tersedia' })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Guru dan ketidaksediaan' }),
      h('p', { class: 'note', text: 'Kolom "Tidak tersedia" adalah kendala keras H4 pada solver jadwal: slot itu tidak boleh dipakai, apa pun konsekuensinya terhadap kualitas jadwal. Alasannya biasa saja dan nyata — tugas belajar, mengajar di sekolah lain, MGMP, petugas Jumat. Kolom "Beban" dihitung dari jadwal yang sedang tersusun, bukan diketik.' }),
      tableOf(['ID', 'Nama', 'Mapel utama', { label: 'Beban JP/mgg', num: true }, { label: 'Maks JP/hari', num: true }, 'Wali kelas', 'Tidak tersedia'], rows, { minWidth: '840px' })));
  }

  /* ============================================================== ROMBEL == */

  function renderRombel(p) {
    var rows = rombelList(state.ta).map(function (r) {
      var wali = guruById(r.waliGuruId);
      var ruang = null;
      state.school.ruang.forEach(function (x) { if (x.id === r.ruangId) ruang = x; });
      var l = 0, pr = 0;
      r.siswa.forEach(function (n) { if (state.school.siswa[n].jk === 'L') l++; else pr++; });
      return h('tr', null,
        h('td', null, h('b', { text: r.nama })),
        h('td', { class: 'num', text: String(r.tingkat) }),
        h('td', { class: 'num', text: String(r.siswa.length) }),
        h('td', { class: 'num mono', text: l + ' / ' + pr }),
        h('td', { style: 'white-space:normal', text: wali ? wali.nama : '—' }),
        h('td', { text: ruang ? ruang.nama : '—' }),
        h('td', { class: 'mono small', text: r.id }));
    });

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Rombongan belajar — ' + state.ta }),
      h('p', { class: 'note' }, 'Kunci rombel adalah pasangan ', h('code', { text: '(tahun ajaran, nama)' }),
        ', bukan nama saja. Kolom terakhir memperlihatkan kuncinya apa adanya: 8B tahun ini dan 8B tahun lalu adalah dua baris berbeda berisi anak berbeda. Ini yang membuat rapor lama tidak tertimpa ketika anak naik kelas.'),
      tableOf(['Rombel', { label: 'Tingkat', num: true }, { label: 'Siswa', num: true }, { label: 'L/P', num: true }, 'Wali kelas', 'Ruang', 'Kunci internal'], rows, { minWidth: '740px' })));

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

  function ensureWorker() {
    if (worker || workerBroken) return worker;
    try {
      worker = new Worker('solver.worker.js');
      worker.onmessage = onWorkerMessage;
      worker.onerror = function () { workerBroken = true; worker = null; };
    } catch (e) { workerBroken = true; worker = null; }
    return worker;
  }

  function onWorkerMessage(ev) {
    var m = ev.data || {};
    if (m.type === 'error') {
      state.solving = false;
      state.solveNote = 'Worker melempar: ' + m.message;
      renderPanel('jadwal');
      return;
    }
    finishSolve(m);
  }

  // Applies whatever the solver produced, but only after re-verifying it here,
  // in the page, against the spec the page holds. A schedule that fails is
  // reported, never rendered.
  function finishSolve(m) {
    state.solving = false;
    var spec = state.spec[state.ta];
    if (m.ok) {
      var check = SV.verify(spec, m.assign);
      if (!check.ok) {
        state.solveNote = 'Jadwal ditolak di sisi halaman: ' + check.violations[0].pesan;
        renderPanel('jadwal');
        return;
      }
      state.jadwal[state.ta] = {
        assign: m.assign, stats: m.stats, soft: m.soft,
        skenario: state.sel.skenario, at: Date.now(), verifikasi: check
      };
      St.put('jadwal', { k: state.ta, v: state.jadwal[state.ta] });
      state.solveNote = '';
      audit('jadwal disusun', state.ta + ' · skenario ' + state.sel.skenario + ' · ' + m.stats.msTotal + ' ms');
    } else {
      state.jadwal[state.ta] = { assign: null, stats: m.stats, diagnosis: m.diagnosis, skenario: state.sel.skenario, at: Date.now() };
      state.solveNote = '';
    }
    renderPanel('jadwal');
  }

  var SKENARIO = [
    { id: 'normal', label: 'Normal (ketidaksediaan seperti yang dideklarasikan guru)', apply: null },
    {
      id: 'rapat', label: 'Rapat dinas seluruh guru — Senin JP 1–4',
      apply: function (g) { for (var s = 1; s <= 4; s++) g.tidakTersedia.push({ hari: 0, slot: s }); g.alasanTidakTersedia = 'rapat dinas Senin pagi'; }
    },
    {
      id: 'padat', label: 'Jam terakhir Senin–Kamis ditiadakan (kapasitas nyaris habis)',
      apply: function (g) { for (var d = 0; d < 4; d++) g.tidakTersedia.push({ hari: d, slot: 10 }); g.alasanTidakTersedia = 'jam ke-10 ditiadakan'; }
    },
    {
      id: 'cuti', label: 'Guru Informatika cuti sebulan (mustahil, terbukti)',
      apply: function (g) {
        if (g.mapelUtama !== 'infm') return;
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
    if (!can.allowed) { state.solveNote = can.reason; renderPanel('jadwal'); return; }
    var spec = buildSpec(state.ta, state.sel.skenario);
    state.spec[state.ta] = spec;
    state.picked = null; state.moveMsg = null;
    state.solving = true;
    state.solveNote = '';
    renderPanel('jadwal');

    var opts = { budgetMs: 8000, optimiseMs: 2500, seed: (Date.now() % 100000) | 0, maxRestarts: 300 };
    var w = ensureWorker();
    if (w) {
      w.postMessage({ type: 'solve', reqId: ++reqSeq, spec: spec, opts: opts });
    } else {
      // Worker unavailable (some file:// contexts, some hardened browsers).
      // Same solver, main thread, and the UI says so rather than pretending.
      state.solveNote = 'Web Worker tidak tersedia; solver dijalankan di thread utama.';
      setTimeout(function () { finishSolve(SV.solve(spec, opts)); }, 20);
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
    } else {
      state.moveMsg = {
        ok: false,
        judul: 'Perpindahan ditolak: ' + sesi.mapelKode + ' ' + sesi.rombelNama + ' → ' + S.HARI[hari].label + ' JP ' + slot,
        detail: 'Kendala keras yang dilanggar:',
        violations: res.violations
      };
    }
    state.picked = null;
    renderPanel('jadwal');
  }

  function renderJadwal(p) {
    var jd = state.jadwal[state.ta];
    if (!state.spec[state.ta]) state.spec[state.ta] = buildSpec(state.ta, (jd && jd.skenario) || 'normal');
    var spec = state.spec[state.ta];
    var canSolve = D.can(user(), 'jadwal.solve', {});

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
            h('li', null, h('code', { text: 'H5' }), ' JP per mapel per rombel terpenuhi persis (38 JP/minggu)'),
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
          h('p', { class: 'hint', style: 'margin-top:6px' }, 'Algoritma: backtracking dengan forward checking. Urutan variabel dom/wdeg — jumlah nilai tersisa dibagi bobot konflik yang terkumpul, sehingga blok yang benar-benar sering menyebabkan jalan buntu dicoba lebih dulu; seri dipecah oleh panjang blok lalu derajat. Urutan nilai memakai biaya lunak ditambah petunjuk pengepakan segmen. Restart sering, dan bobot konflik dibawa MELINTASI restart — itu yang membuat restart menjadi pembelajaran, bukan sekadar pengocokan ulang. Setelah solusi pertama, hill-climb min-conflicts berbatas waktu yang hanya bergerak di antara keadaan yang tetap sah. Semuanya berjalan di Web Worker.')))));

    /* --- controls --- */
    var kontrol = h('div', { class: 'controls' },
      field('Skenario kendala', select(SKENARIO.map(function (s) { return { value: s.id, label: s.label }; }),
        state.sel.skenario, function (v) { state.sel.skenario = v; })),
      h('button', {
        class: 'btn primary', type: 'button', disabled: state.solving ? true : null,
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
      if (st.softAwal !== null) sstat('Skor lunak', st.softAwal + ' → ' + st.softAkhir, st.langkahOptimasi + ' langkah perbaikan');
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
      p.appendChild(h('div', { class: 'movebox ' + (mm.ok ? 'ok' : 'bad') },
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
        })),
        field(state.sel.jadwalMode === 'rombel' ? 'Rombel' : state.sel.jadwalMode === 'guru' ? 'Guru' : 'Ruang',
          select(keyOpts, state.sel.jadwalKey, function (v) { state.sel.jadwalKey = v; state.picked = null; renderPanel('jadwal'); })),
        state.picked ? h('button', { class: 'btn small', type: 'button', onclick: function () { state.picked = null; renderPanel('jadwal'); } }, 'Batal pilih') : null));

    gridCard.appendChild(buildGrid(spec, jd.assign, state.sel.jadwalMode, state.sel.jadwalKey));
    gridCard.appendChild(h('p', { class: 'hint', style: 'margin-top:10px' },
      'Sel bergaris putus-putus adalah slot kosong; garis diagonal berarti hari itu memang sudah selesai. ',
      'Garis horizontal tebal menandai batas istirahat — Senin–Kamis setelah JP 4 dan JP 8, Jum\'at setelah JP 3 — dan sebuah blok tidak boleh melewatinya. ',
      'Setiap perpindahan diperiksa ulang terhadap ketujuh kendala keras, lalu seluruh papan diverifikasi ulang dari nol, bukan hanya sel yang disentuh.'));
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
    grid.appendChild(h('div', { class: 'jadwal-head', style: 'grid-column:1;grid-row:1', text: 'JP' }));
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
    var ruangNama = se.ruangTipe ? val.ruangId : val.ruangId;
    state.school.ruang.forEach(function (r) { if (r.id === val.ruangId) ruangNama = r.nama; });
    var sub = mode === 'guru' ? se.rombelNama : (g ? g.nama.replace(/,.*$/, '') : se.guruId);
    var jam = S.jamSlot(d, slot).split('–')[0] + '–' + S.jamSlot(d, slot + se.len - 1).split('–')[1];
    var el = h('button', {
      type: 'button',
      draggable: 'true',
      class: 'lesson ' + MP_CLASS[se.mapelId] + (state.picked === se.id ? ' picked' : '') + (brk ? ' brk-before' : ''),
      style: pos + ';grid-row-end: span ' + se.len,
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

  function renderPresensi(p) {
    var rbs = rombelList(state.ta);
    if (state.role === 'ortu') return renderPresensiOrtu(p);
    if (!state.sel.rombel || !rombelByName(state.ta, state.sel.rombel)) state.sel.rombel = rbs[0].nama;
    var rb = rombelByName(state.ta, state.sel.rombel);
    var mp = mapelById(state.sel.mapel) || state.school.mapel[0];
    var pengampuId = pengampuOf(state.ta, rb.nama, mp.id);
    var pengampu = guruById(pengampuId);
    var can = D.can(user(), 'presensi.write', { pengampuGuruId: pengampuId, pengampuNama: pengampu && pengampu.nama, rombelId: rb.id });
    var totalPertemuan = S.pertemuanPerSemester(mp);
    if (state.sel.pertemuan > totalPertemuan) state.sel.pertemuan = 1;

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Presensi per sesi' }),
      h('p', { class: 'note' },
        'Empat status, dan tidak saling menggantikan: ', h('b', { text: 'Hadir' }), ', ', h('b', { text: 'Sakit' }), ', ',
        h('b', { text: 'Izin' }), ' (ketiganya berbeda perlakuan) dan ', h('b', { text: 'Alpa' }), ' (tanpa keterangan). ',
        'Jumlah pertemuan per semester diturunkan dari jadwal: ', h('code', { text: mp.blok.length + ' sesi/minggu × ' + S.PEKAN_EFEKTIF + ' pekan efektif = ' + totalPertemuan + ' pertemuan' }),
        '. Ambang kelayakan ' + D.MIN_KEHADIRAN + '% dihitung dari kehadiran, bukan dari ketidakhadiran yang berizin.'),
      h('div', { class: 'controls' },
        field('Rombel', select(rbs.map(function (r) { return { value: r.nama, label: r.nama }; }), rb.nama,
          function (v) { state.sel.rombel = v; renderPanel('presensi'); })),
        field('Mapel', select(state.school.mapel.map(function (m) { return { value: m.id, label: m.nama }; }), mp.id,
          function (v) { state.sel.mapel = v; state.sel.pertemuan = 1; renderPanel('presensi'); })),
        field('Pertemuan ke-', select(
          (function () { var o = []; for (var i = 1; i <= totalPertemuan; i++) o.push({ value: i, label: String(i) }); return o; })(),
          state.sel.pertemuan, function (v) { state.sel.pertemuan = +v; renderPanel('presensi'); })),
        h('span', { class: 'hint', text: 'Pengampu: ' + (pengampu ? pengampu.nama : '—') })),
      can.allowed ? null : h('div', { class: 'callout warn' }, h('b', { text: 'Tindakan ditolak. ' }), can.reason,
        h('div', { style: 'margin-top:7px' }, jadiPengampu(pengampuId)))));

    var rows = rb.siswa.map(function (nisn) {
      var s = state.school.siswa[nisn];
      var recs = A.presensiEfektif(state.presensiOverrides, nisn, mp, state.ta, state.semester);
      var roll = D.rollupPresensi(recs);
      var cur = recs[state.sel.pertemuan - 1];
      var bar = h('div', { class: 'bar' });
      ['H', 'S', 'I', 'A'].forEach(function (k) {
        var pct = roll.total ? (roll[k] / roll.total * 100) : 0;
        if (pct > 0) bar.appendChild(h('i', { class: k.toLowerCase(), style: 'width:' + pct + '%' }));
      });
      return h('tr', null,
        h('td', { class: 'num', text: String(s.enrol[state.ta].absen) }),
        h('td', { style: 'white-space:normal', text: s.nama }),
        h('td', { class: 'mono small', text: s.nisn }),
        h('td', null, select(
          D.PRESENSI.map(function (x) { return { value: x.id, label: x.id + ' — ' + x.label }; }),
          cur.status,
          function (v) {
            var key = A.presensiKey(state.ta, state.semester, nisn, mp.id, state.sel.pertemuan);
            var rec = { k: key, status: v, oleh: state.guruId || 'TU', pada: Date.now() };
            state.presensiOverrides[key] = rec;
            St.put('presensi', rec);
            audit('presensi diubah', s.nama + ' · ' + mp.kode + ' · pertemuan ' + state.sel.pertemuan + ' → ' + v);
            setTimeout(function () { renderPanel('presensi'); }, 0);
          },
          { disabled: can.allowed ? null : true, 'aria-label': 'Status kehadiran ' + s.nama })),
        h('td', { class: 'num', text: String(roll.H) }),
        h('td', { class: 'num', text: String(roll.S) }),
        h('td', { class: 'num', text: String(roll.I) }),
        h('td', { class: 'num', text: String(roll.A) }),
        h('td', { class: 'num mono', text: roll.persen.toFixed(2) + '%' }),
        h('td', { style: 'min-width:110px' }, bar),
        h('td', null, roll.memenuhiSyarat
          ? h('span', { class: 'pill ok', text: 'layak' })
          : h('span', { class: 'pill bad', text: '< ' + D.MIN_KEHADIRAN + '%' })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Rekap ' + mp.nama + ' — ' + rb.nama + ' — semester ' + state.semester }),
        h('div', { class: 'legend' }, h('span', { class: 'lh', text: 'Hadir' }), h('span', { class: 'ls', text: 'Sakit' }),
          h('span', { class: 'li', text: 'Izin' }), h('span', { class: 'la', text: 'Alpa' }))),
      tableOf([{ label: 'Abs', num: true }, 'Nama', 'NISN', 'Pertemuan ' + state.sel.pertemuan,
      { label: 'H', num: true }, { label: 'S', num: true }, { label: 'I', num: true }, { label: 'A', num: true },
      { label: '% hadir', num: true }, 'Sebaran', 'Kelayakan'], rows, { minWidth: '900px' })));
  }

  function renderPresensiOrtu(p) {
    var nisn = state.nisn;
    var s = state.school.siswa[nisn];
    var e = s.enrol[state.ta];
    if (!e) {
      p.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Presensi' }),
        h('div', { class: 'callout warn', text: s.nama + ' tidak terdaftar pada tahun ajaran ' + state.ta + '.' })));
      return;
    }
    var rows = state.school.mapel.map(function (m) {
      var roll = D.rollupPresensi(A.presensiEfektif(state.presensiOverrides, nisn, m, state.ta, state.semester));
      return h('tr', null,
        h('td', { text: m.nama }),
        h('td', { class: 'num', text: String(roll.H) }), h('td', { class: 'num', text: String(roll.S) }),
        h('td', { class: 'num', text: String(roll.I) }), h('td', { class: 'num', text: String(roll.A) }),
        h('td', { class: 'num mono', text: roll.persen.toFixed(2) + '%' }));
    });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Presensi ' + s.nama + ' — ' + e.rombelNama + ' — semester ' + state.semester }),
      h('p', { class: 'note', text: 'Tampilan orang tua bersifat baca-saja dan hanya memuat satu anak. Mengganti anak di bilah atas akan ditolak untuk NISN yang bukan miliknya.' }),
      tableOf(['Mapel', { label: 'H', num: true }, { label: 'S', num: true }, { label: 'I', num: true }, { label: 'A', num: true }, { label: '% hadir', num: true }], rows)));
  }

  /* =========================================================== PENILAIAN == */

  function bobotOf(mapelId) {
    return (state.konfig.bobot && state.konfig.bobot[mapelId]) || state.school.bobot[mapelId];
  }
  function kkmOf(mapelId) {
    var v = state.konfig.kkm && state.konfig.kkm[mapelId];
    return v === undefined ? state.school.kkm[mapelId] : v;
  }

  function renderPenilaian(p) {
    if (state.role === 'ortu') {
      p.appendChild(h('div', { class: 'card' }, h('h3', { text: 'Penilaian' }),
        denial(D.can(user(), 'nilai.write', { pengampuGuruId: 'x' })),
        h('p', { class: 'hint', text: 'Nilai anak Anda tersedia di tab Rapor.' })));
      return;
    }
    var rbs = rombelList(state.ta);
    if (!state.sel.rombel || !rombelByName(state.ta, state.sel.rombel)) state.sel.rombel = rbs[0].nama;
    var rb = rombelByName(state.ta, state.sel.rombel);
    var mp = mapelById(state.sel.mapel) || state.school.mapel[0];
    var pengampuId = pengampuOf(state.ta, rb.nama, mp.id);
    var pengampu = guruById(pengampuId);
    var canWrite = D.can(user(), 'nilai.write', { pengampuGuruId: pengampuId, pengampuNama: pengampu && pengampu.nama, rombelId: rb.id });
    var canConfig = D.can(user(), 'config.write', {});

    var bobot = bobotOf(mp.id), kkm = kkmOf(mp.id);
    var v = D.validateBobot(bobot);
    var bands = D.predikatBands(kkm);

    /* --- weighting editor --- */
    var draft = { tugas: bobot.tugas, uh: bobot.uh, pts: bobot.pts, pas: bobot.pas };
    var totalEl = h('span', { class: 'pill ' + (v.ok ? 'ok' : 'bad'), text: 'total ' + v.total + '%' });
    var errEl = h('div');

    function recheck() {
      var vv = D.validateBobot(draft);
      totalEl.textContent = 'total ' + vv.total + '%';
      totalEl.className = 'pill ' + (vv.ok ? 'ok' : 'bad');
      clear(errEl);
      if (!vv.ok) errEl.appendChild(h('div', { class: 'callout bad' }, h('b', { text: 'Bobot ditolak. ' }), vv.errors.join(' ')));
      return vv;
    }

    var row = h('div', { class: 'bobot-row' });
    D.KOMPONEN.forEach(function (k) {
      row.appendChild(field(k.label, h('input', {
        type: 'number', min: '0', max: '100', step: '1', value: String(draft[k.id]),
        disabled: canConfig.allowed ? null : true,
        oninput: function (e) { draft[k.id] = e.target.value === '' ? '' : Number(e.target.value); recheck(); }
      })));
    });
    row.appendChild(field('KKM', h('input', {
      type: 'number', min: String(D.KKM_MIN), max: String(D.KKM_MAX), value: String(kkm),
      disabled: canConfig.allowed ? null : true,
      oninput: function (e) { draft.__kkm = Number(e.target.value); }
    })));
    row.appendChild(totalEl);
    row.appendChild(h('button', {
      class: 'btn primary', type: 'button', disabled: canConfig.allowed ? null : true,
      onclick: function () {
        var vv = recheck();
        if (!vv.ok) return;
        state.konfig.bobot[mp.id] = { tugas: Number(draft.tugas), uh: Number(draft.uh), pts: Number(draft.pts), pas: Number(draft.pas) };
        if (draft.__kkm !== undefined && isFinite(draft.__kkm)) {
          state.konfig.kkm[mp.id] = D.clamp(draft.__kkm, D.KKM_MIN, D.KKM_MAX);
        }
        saveKonfig();
        audit('bobot penilaian diubah', mp.nama + ' → ' + JSON.stringify(state.konfig.bobot[mp.id]) + ' KKM ' + kkmOf(mp.id));
        renderPanel('penilaian');
      }
    }, 'Simpan bobot'));

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Bobot penilaian & KKM — ' + mp.nama }),
      h('p', { class: 'note' },
        'Sekolah menetapkan bobot komponennya sendiri dan bisa berbeda antar mapel. Satu aturan yang tidak pernah lentur: ',
        h('b', { text: 'totalnya harus tepat 100%' }),
        '. Antarmuka yang membiarkan 90% atau 110% tersimpan diam-diam akan menskalakan ulang nilai setiap anak. Di sini bobot yang tidak sah ditolak dan tidak ada angka yang dihitung sama sekali.'),
      h('div', { class: 'controls' },
        field('Rombel', select(rbs.map(function (r) { return { value: r.nama, label: r.nama }; }), rb.nama,
          function (val) { state.sel.rombel = val; renderPanel('penilaian'); })),
        field('Mapel', select(state.school.mapel.map(function (m) { return { value: m.id, label: m.nama }; }), mp.id,
          function (val) { state.sel.mapel = val; renderPanel('penilaian'); })),
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

    /* --- marks --- */
    var rows = rb.siswa.map(function (nisn) {
      var s = state.school.siswa[nisn];
      var eff = A.nilaiEfektif(state.nilaiOverrides, nisn, mp.id, state.ta, state.semester);
      var hasil = D.hitungNilaiAkhir(eff.nilai, bobot, kkm);
      var naEl = h('td', { class: 'num mono', text: hasil.ok ? hasil.nilai.toFixed(2) : '—' });
      var prEl = h('td', null, hasil.ok ? h('span', { class: 'pred ' + hasil.predikat, text: hasil.predikat }) : '—');
      var tuEl = h('td', null, hasil.ok ? (hasil.tuntas ? h('span', { class: 'pill ok', text: 'tuntas' }) : h('span', { class: 'pill bad', text: 'remedial' })) : '');
      var rincianEl = h('td', { class: 'rincian', style: 'white-space:normal' },
        hasil.ok ? hasil.rincian.map(function (r) { return r.nilai + '×' + r.bobot + '%=' + r.kontribusi.toFixed(2); }).join(' + ') : '');

      var inputs = D.KOMPONEN.map(function (k) {
        return h('td', null, h('input', {
          class: 'nilai-input' + (eff.diubah[k.id] ? ' edited' : ''),
          type: 'number', min: '0', max: '100', value: String(eff.nilai[k.id]),
          disabled: canWrite.allowed ? null : true,
          'aria-label': k.label + ' ' + s.nama,
          onchange: function (e) {
            var val2 = e.target.value === '' ? null : D.clamp(Number(e.target.value), 0, 100);
            var key = A.nilaiKey(state.ta, state.semester, nisn, mp.id);
            var rec = state.nilaiOverrides[key] || { k: key, nilai: {}, oleh: state.guruId || 'TU' };
            rec.nilai[k.id] = val2;
            rec.oleh = state.guruId || 'TU';
            rec.pada = Date.now();
            state.nilaiOverrides[key] = rec;
            St.put('nilai', rec);
            audit('nilai diubah', s.nama + ' · ' + mp.kode + ' · ' + k.label + ' → ' + val2);
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
          onclick: function () { state.sel.raporNisn = nisn; switchTab('rapor'); }
        })),
        h('td', { class: 'mono small', text: s.nisn }));
      inputs.forEach(function (x) { tr.appendChild(x); });
      tr.appendChild(naEl); tr.appendChild(prEl); tr.appendChild(tuEl); tr.appendChild(rincianEl);
      return tr;
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: mp.nama + ' — ' + rb.nama + ' — semester ' + state.semester + ' — ' + state.ta }),
        h('span', { class: 'hint', text: 'Nilai ungu = sudah disunting dan tersimpan.' })),
      canWrite.allowed
        ? h('div', { class: 'callout ok' }, h('b', { text: 'Anda pengampu kelas ini. ' }), 'Suntingan tercatat di jejak audit atas nama ' + (guruById(state.guruId) || {}).nama + '.')
        : h('div', { class: 'callout warn' }, h('b', { text: 'Tindakan ditolak. ' }), canWrite.reason,
          h('div', { style: 'margin-top:7px' }, jadiPengampu(pengampuId))),
      h('p', { class: 'note' },
        'Kolom terakhir memperlihatkan aritmetikanya. Pembulatan dilakukan ',
        h('b', { text: 'sekali, di akhir' }), ' — membulatkan tiap kontribusi lebih dulu bisa menggeser nilai sampai 2 poin dan membuat penjumlahan yang tercetak tidak cocok dengan hasilnya.'),
      tableOf([{ label: 'Abs', num: true }, 'Nama', 'NISN', 'Tugas', 'UH', 'PTS', 'PAS',
      { label: 'Nilai akhir', num: true }, 'Predikat', 'Status', 'Perhitungan'], rows, { minWidth: '920px' })));
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
          { disabled: state.role === 'ortu' ? true : null })),
        h('button', { class: 'btn', type: 'button', onclick: function () { window.print(); } }, 'Cetak rapor'),
        h('span', { class: 'hint', text: 'Cetak memakai @media print: bilah, tab dan tombol dihilangkan.' })),
      canRead.allowed ? null : denial(canRead)));

    if (!canRead.allowed) return;

    var r = A.hitungRapor(ctx(), nisn, state.ta, state.semester);
    if (!r.ok) {
      p.appendChild(h('div', { class: 'card' },
        h('h3', { text: 'Rapor tidak tersedia' }),
        h('div', { class: 'callout warn', text: r.alasan }),
        h('p', { class: 'hint', text: 'Ini bukan galat. Rapor berlingkup tahun ajaran; anak yang belum terdaftar tahun itu memang tidak punya rapor tahun itu, dan menampilkan rapor kosong akan jauh lebih berbahaya daripada menolak.' })));
      return;
    }

    var leger = A.legerKelas(ctx(), rombelByName(state.ta, r.rombelNama), state.ta, state.semester);
    var peringkat = null;
    leger.forEach(function (x) { if (x.nisn === nisn) peringkat = x.peringkat; });

    var head = h('div', { class: 'rapor-head' },
      h('div', null,
        h('h3', { text: 'Laporan Hasil Belajar' }),
        h('p', { class: 'hint', text: state.school.sekolah.nama }),
        h('dl', { class: 'kv', style: 'margin-top:8px' },
          h('dt', { text: 'Nama' }), h('dd', { style: 'font-family:inherit', text: siswa.nama }),
          h('dt', { text: 'NISN' }), h('dd', { text: siswa.nisn }),
          h('dt', { text: 'NIS' }), h('dd', { text: siswa.nis }),
          h('dt', { text: 'Rombel' }), h('dd', { text: r.rombelNama + ' · absen ' + r.absen }))),
      h('div', null,
        h('dl', { class: 'kv' },
          h('dt', { text: 'Tahun ajaran' }), h('dd', { text: r.ta }),
          h('dt', { text: 'Semester' }), h('dd', { text: r.semester }),
          h('dt', { text: 'Wali kelas' }), h('dd', { style: 'font-family:inherit', text: (guruById(rombelByName(state.ta, r.rombelNama).waliGuruId) || {}).nama }),
          h('dt', { text: 'Rata-rata' }), h('dd', { text: r.rekap.rata.toFixed(2) }),
          h('dt', { text: 'Peringkat' }), h('dd', { text: peringkat + ' dari ' + leger.length }))));

    var rows = r.baris.map(function (b) {
      return h('tr', null,
        h('td', { style: 'white-space:normal', text: b.mapel.nama }),
        h('td', { class: 'num', text: String(b.kkm) }),
        h('td', { class: 'num', text: String(b.komponen.tugas) }),
        h('td', { class: 'num', text: String(b.komponen.uh) }),
        h('td', { class: 'num', text: String(b.komponen.pts) }),
        h('td', { class: 'num', text: String(b.komponen.pas) }),
        h('td', { class: 'rincian', style: 'white-space:normal', text: b.hasil.rincian.map(function (x) { return x.nilai + '×' + x.bobot + '%'; }).join(' + ') }),
        h('td', { class: 'num mono', text: b.hasil.nilai.toFixed(2) }),
        h('td', null, h('span', { class: 'pred ' + b.hasil.predikat, text: b.hasil.predikat }),
          h('span', { class: 'hint', text: ' ' + D.PREDIKAT_LABEL[b.hasil.predikat] })),
        h('td', null, b.hasil.tuntas ? h('span', { class: 'pill ok', text: 'tuntas' }) : h('span', { class: 'pill bad', text: 'remedial' })),
        h('td', { class: 'num mono', text: b.presensi.persen.toFixed(0) + '%' }));
    });

    var bar = h('div', { class: 'bar', style: 'max-width:320px' });
    ['H', 'S', 'I', 'A'].forEach(function (k) {
      var pct = r.presensi.total ? (r.presensi[k] / r.presensi.total * 100) : 0;
      if (pct > 0) bar.appendChild(h('i', { class: k.toLowerCase(), style: 'width:' + pct + '%' }));
    });

    p.appendChild(h('div', { class: 'rapor' }, head,
      tableOf(['Mata pelajaran', { label: 'KKM', num: true }, { label: 'Tugas', num: true }, { label: 'UH', num: true },
      { label: 'PTS', num: true }, { label: 'PAS', num: true }, 'Perhitungan', { label: 'Nilai', num: true },
        'Predikat', 'Status', { label: 'Hadir', num: true }], rows, { minWidth: '860px' }),
      h('div', { class: 'grid2', style: 'margin-top:16px' },
        h('div', null,
          h('h4', { style: 'font-size:13px;margin-bottom:6px', text: 'Ketidakhadiran' }),
          bar,
          h('div', { class: 'legend' },
            h('span', { class: 'lh', text: 'Hadir ' + r.presensi.H }),
            h('span', { class: 'ls', text: 'Sakit ' + r.presensi.S }),
            h('span', { class: 'li', text: 'Izin ' + r.presensi.I }),
            h('span', { class: 'la', text: 'Alpa ' + r.presensi.A })),
          h('p', { class: 'hint', style: 'margin-top:6px', text: 'Dari ' + r.presensi.total + ' pertemuan pada semester ini, kehadiran ' + r.presensi.persen.toFixed(2) + '%.' }),
          r.syaratKehadiran.terpenuhi
            ? h('p', { class: 'pill ok', text: 'memenuhi syarat kehadiran ≥ ' + D.MIN_KEHADIRAN + '%' })
            : h('div', { class: 'callout bad' }, h('b', { text: 'Kehadiran di bawah ambang. ' }),
              'Kehadiran ' + r.presensi.persen.toFixed(2) + '% berada di bawah ' + D.MIN_KEHADIRAN + '%. Aplikasi menandai, tidak memutuskan: keputusan kenaikan kelas ada pada rapat dewan guru.')),
        h('div', null,
          h('h4', { style: 'font-size:13px;margin-bottom:6px', text: 'Rekapitulasi' }),
          h('dl', { class: 'kv' },
            h('dt', { text: 'Mapel tuntas' }), h('dd', { text: r.rekap.tuntas + ' dari ' + r.rekap.mapelCount }),
            h('dt', { text: 'Perlu remedial' }), h('dd', { text: String(r.rekap.belumTuntas) }),
            h('dt', { text: 'Rata-rata' }), h('dd', { text: r.rekap.rata.toFixed(2) }),
            h('dt', { text: 'Peringkat' }), h('dd', { text: peringkat + ' / ' + leger.length })),
          h('p', { class: 'hint', style: 'margin-top:8px', text: 'Nilai dasar dihasilkan dari fungsi hash atas (NISN, mapel, tahun ajaran, semester, komponen). Karena itu perhitungan ulang selalu memberi angka yang sama, dan tab Uji membandingkan dua rapor hasil pembangunan sekolah yang berbeda untuk membuktikannya.' })))));
  }

  /* ================================================================ PPDB == */

  function renderPpdb(p) {
    var can = D.can(user(), 'ppdb.decide', {});
    var sc = state.school;
    var hasil = D.seleksiPpdb(sc.ppdb.pendaftar, sc.ppdb.kuotaTotal, 5);

    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'PPDB — penerimaan peserta didik baru ' + S.TA_AKTIF }),
      h('p', { class: 'note' },
        'Seleksi dilakukan ', h('b', { text: 'per jalur' }), ', bukan satu peringkat global, dan tiap jalur memakai kriteria sendiri: zonasi dan afirmasi diurutkan dari jarak terdekat, prestasi dari skor tertinggi, perpindahan tugas dari tanggal daftar. Kursi yang tidak terisi di satu jalur dilimpahkan ke zonasi — bukan hangus. Pemecah seri selalu deterministik (tanggal daftar lalu NISN); seleksi yang berubah urutan saat halaman dimuat ulang tidak bisa dipertanggungjawabkan ke orang tua.'),
      h('p', { class: 'hint' }, 'Yang diterima memakai ', h('b', { text: 'NISN yang sudah mereka bawa dari SD' }),
        ' — sekolah tidak menerbitkan identitas baru saat menerima anak. Pendaftar yang tidak diterima tetap memegang NISN-nya; nomor itu terpakai seumur hidup di mana pun ia bersekolah.'),
      can.allowed ? null : denial(can)));

    var rows = hasil.ringkas.map(function (r) {
      return h('tr', null,
        h('td', null, h('b', { text: r.label })),
        h('td', { class: 'num', text: String(r.kuota) }),
        h('td', { class: 'num', text: String(r.pendaftar) }),
        h('td', { class: 'num', text: String(r.diterima) }),
        h('td', { class: 'num', text: String(r.cadangan) }),
        h('td', { class: 'num mono', text: r.pendaftar ? (r.diterima / r.pendaftar * 100).toFixed(0) + '%' : '—' }),
        h('td', { style: 'white-space:normal', text: r.kriteria }));
    });
    p.appendChild(h('div', { class: 'card' },
      h('h3', { text: 'Kuota per jalur — total ' + sc.ppdb.kuotaTotal + ' kursi untuk ' + sc.ppdb.rombelTujuan.join(', ') }),
      tableOf(['Jalur', { label: 'Kuota', num: true }, { label: 'Pendaftar', num: true }, { label: 'Diterima', num: true },
      { label: 'Cadangan', num: true }, { label: 'Terima', num: true }, 'Kriteria peringkat'], rows, { minWidth: '760px' })));

    var jalurOpts = [{ value: 'semua', label: 'Semua jalur' }].concat(D.JALUR.map(function (j) { return { value: j.id, label: j.label }; }));
    var list = hasil.hasil.filter(function (x) { return state.sel.ppdbJalur === 'semua' || x.jalur === state.sel.ppdbJalur; });
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
        h('td', { class: 'num mono', text: x.ref.nilaiRapor.toFixed(1) }),
        h('td', { class: 'num mono', text: String(x.ref.poinPrestasi) }),
        h('td', { class: 'num mono', text: x.ref.skor.toFixed(1) }),
        h('td', { text: x.ref.asalSekolah }),
        h('td', null, h('span', { class: 'pill ' + pill, text: x.status })));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: 'Peringkat pendaftar' }),
        field('Jalur', select(jalurOpts, state.sel.ppdbJalur, function (v) { state.sel.ppdbJalur = v; renderPanel('ppdb'); }))),
      h('p', { class: 'note', text: 'Kolom skor hanya dipakai jalur prestasi; jalur zonasi dan afirmasi mengabaikannya sepenuhnya dan diurut jarak. Itu terlihat dari peringkatnya.' }),
      tableOf([{ label: '#', num: true }, 'Nama', 'NISN', 'Jalur', { label: 'Jarak', num: true },
      { label: 'Rapor', num: true }, { label: 'Prestasi', num: true }, { label: 'Skor', num: true }, 'Asal sekolah', 'Status'],
        rows2, { minWidth: '900px' })));
  }

  /* ================================================================= SPP == */

  function sppLedgerEfektif(siswa, ta) {
    var base = S.sppLedger(siswa, ta);
    for (var i = 0; i < base.length; i++) {
      var k = ta + '|' + siswa.nisn + '|' + base[i].year + '-' + base[i].month;
      var ov = state.sppOverrides[k];
      if (ov) base[i].paidAt = ov.paidAt;
    }
    return base;
  }

  function renderSpp(p) {
    var canWrite = D.can(user(), 'spp.write', {});
    var daftar;
    if (state.role === 'ortu') daftar = [state.nisn];
    else {
      var rbs = rombelList(state.ta);
      if (!state.sel.sppRombel || !rombelByName(state.ta, state.sel.sppRombel)) state.sel.sppRombel = rbs[0].nama;
      daftar = rombelByName(state.ta, state.sel.sppRombel).siswa;
    }

    var head = h('div', { class: 'card' },
      h('h3', { text: 'SPP — buku besar bulanan ' + state.ta }),
      h('p', { class: 'note' },
        'Dua belas bulan tagihan, Juli sampai Juni, mengikuti tahun ajaran dan bukan tahun kalender. ',
        h('b', { text: 'Bulan yang belum jatuh tempo bukan tunggakan' }),
        ' — itu bug yang selalu ada di laporan tunggakan yang ditulis buru-buru, dan akibatnya adalah surat tagihan ke orang tua untuk bulan yang belum terjadi. Tanggal acuan demo: ' + S.SEKARANG_LABEL + '. Penerima KIP dibebaskan dan tidak pernah muncul sebagai penunggak.'),
      state.role === 'ortu' ? null : h('div', { class: 'controls' },
        field('Rombel', select(rombelList(state.ta).map(function (r) { return { value: r.nama, label: r.nama }; }),
          state.sel.sppRombel, function (v) { state.sel.sppRombel = v; renderPanel('spp'); }))),
      canWrite.allowed ? null : denial(canWrite));
    p.appendChild(head);

    var totalTunggakan = 0, penunggak = 0;
    var rows = daftar.map(function (nisn) {
      var s = state.school.siswa[nisn];
      var ledger = sppLedgerEfektif(s, state.ta);
      var roll = D.rollupSpp(ledger, S.SEKARANG);
      totalTunggakan += roll.nominalTunggakan;
      if (roll.tunggakan) penunggak++;
      var grid = h('div', { class: 'spp-grid' });
      roll.bulan.forEach(function (b) {
        var cls = b.status === 'lunas' ? 'lunas' : b.status === 'tunggakan' ? 'tunggakan' : b.status === 'bebas' ? 'bebas' : '';
        grid.appendChild(h('div', {
          class: 'spp-m ' + cls,
          title: D.NAMA_BULAN[b.month] + ' ' + b.year + ' — ' + b.status,
          text: D.NAMA_BULAN[b.month].slice(0, 3)
        }));
      });
      return h('tr', null,
        h('td', { class: 'num', text: String(s.enrol[state.ta].absen) }),
        h('td', { style: 'white-space:normal', text: s.nama }),
        h('td', { class: 'mono small', text: s.nisn }),
        h('td', null, s.kip ? h('span', { class: 'pill info', text: 'KIP' }) : ''),
        h('td', { style: 'min-width:300px' }, grid),
        h('td', { class: 'num', text: String(roll.lunas) }),
        h('td', { class: 'num', text: String(roll.tunggakan) }),
        h('td', { class: 'num mono', text: roll.nominalTunggakan ? D.rupiah(roll.nominalTunggakan) : '—' }),
        h('td', { class: 'no-print' }, roll.tunggakan && canWrite.allowed
          ? h('button', {
            class: 'btn small', type: 'button', onclick: function () {
              var target = null;
              roll.bulan.forEach(function (b) { if (!target && b.status === 'tunggakan') target = b; });
              if (!target) return;
              var k = state.ta + '|' + nisn + '|' + target.year + '-' + target.month;
              var rec = { k: k, paidAt: S.SEKARANG, oleh: 'TU' };
              state.sppOverrides[k] = rec;
              St.put('spp', rec);
              audit('pembayaran SPP dicatat', s.nama + ' · ' + D.NAMA_BULAN[target.month] + ' ' + target.year);
              renderPanel('spp');
            }
          }, 'Catat 1 bulan')
          : ''));
    });

    p.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row-between' },
        h('h3', { text: state.role === 'ortu' ? 'Tagihan anak Anda' : 'Rombel ' + state.sel.sppRombel }),
        h('span', { class: 'hint', text: penunggak + ' penunggak · total ' + D.rupiah(totalTunggakan) })),
      h('div', { class: 'legend', style: 'margin-bottom:8px' },
        h('span', { style: 'color:var(--ok)', text: '■ lunas' }),
        h('span', { style: 'color:var(--bad)', text: '■ tunggakan' }),
        h('span', { style: 'color:var(--info)', text: '■ bebas (KIP)' }),
        h('span', { class: 'hint', text: '□ belum jatuh tempo' })),
      tableOf([{ label: 'Abs', num: true }, 'Nama', 'NISN', '', 'Jul → Jun',
      { label: 'Lunas', num: true }, { label: 'Tunggak', num: true }, { label: 'Nominal', num: true }, ''],
        rows, { minWidth: '900px' })));
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
        class: 'btn small', type: 'button', onclick: function () {
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
    if (state.view === 'uji') renderPanel('uji');
  }

  /* ============================================================= plumbing */

  var RENDER = {
    beranda: renderBeranda, siswa: renderSiswa, guru: renderGuru, rombel: renderRombel,
    jadwal: renderJadwal, presensi: renderPresensi, penilaian: renderPenilaian,
    rapor: renderRapor, ppdb: renderPpdb, spp: renderSpp, uji: renderUji
  };

  function renderPanel(name) {
    var panel = $('panel-' + name);
    if (!panel) return;
    clear(panel);
    try { RENDER[name](panel); }
    catch (e) {
      panel.appendChild(h('div', { class: 'callout bad' },
        h('b', { text: 'Panel gagal dirender. ' }), String(e && e.message || e)));
      if (window.console) console.error(e);
    }
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
    renderCtxBar();
    renderPanel(state.view);
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
    state.konfig = {
      bobot: JSON.parse(JSON.stringify(state.school.bobot)),
      kkm: JSON.parse(JSON.stringify(state.school.kkm))
    };
    state.guruId = state.school.guru[3].id;
    state.rombelId = rombelList(state.ta)[0].id;
    state.nisn = rombelList(state.ta)[0].siswa[0];
    state.sel.rombel = rombelList(state.ta)[0].nama;
    state.sel.sppRombel = rombelList(state.ta)[0].nama;

    $('themeBtn').textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Terang' : 'Gelap';
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
      // Tests first (they are the badge), then the timetable so the Jadwal tab
      // is alive without a click.
      setTimeout(function () {
        runTests();
        setTimeout(function () {
          if (!state.jadwal[state.ta]) solveJadwal();
          else { state.spec[state.ta] = buildSpec(state.ta, state.jadwal[state.ta].skenario || 'normal'); renderPanel(state.view); }
        }, 30);
      }, 30);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
