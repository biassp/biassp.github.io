/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — app.js
 * The view layer. All clinical rules live in domain.js / clinic.js / drugs.js;
 * nothing here decides whether an action is allowed, it only asks and renders
 * the answer.
 *
 * The rule this file follows everywhere: A REFUSAL IS RENDERED, NEVER HIDDEN.
 * Buttons for actions the current role cannot perform stay visible and
 * disabled with the reason attached, and whole panels a role may not use
 * explain what the role can do instead. Silently hiding a control is how a
 * clinic ends up with three people who each believe someone else can do the
 * thing nobody can do.
 */
(function () {
  'use strict';

  var R = window.REKAM;
  var D = R.domain, A = R.audit;

  /* ------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /**
   * h(tag, attrs, ...children) — the whole templating layer.
   * Text goes through textContent, so nothing user- or seed-supplied is ever
   * parsed as markup.
   */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') { el.textContent = String(v); return; }
      if (k === 'html') { return; } // deliberately unsupported
      if (k.slice(0, 2) === 'on' && typeof v === 'function') { el.addEventListener(k.slice(2), v); return; }
      if (k === 'class') { el.className = v; return; }
      if (v === true) { el.setAttribute(k, ''); return; }
      el.setAttribute(k, String(v));
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) {
        c.forEach(function (x) { if (x != null && x !== false) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
        continue;
      }
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function fmtDate(s) {
    if (!s) return '—';
    var p = String(s).slice(0, 10).split('-');
    if (p.length !== 3) return String(s);
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return D.pad(d.getHours(), 2) + ':' + D.pad(d.getMinutes(), 2);
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return fmtDate(d.getFullYear() + '-' + D.pad(d.getMonth() + 1, 2) + '-' + D.pad(d.getDate(), 2)) + ' ' + fmtTime(iso);
  }

  /* --------------------------------------------------------------- state */

  var clinic = null;
  var active = 'antrian';
  var selVisit = null;      // visit id the whole app is focused on
  var selRM = null;         // patient the Rekam Medis tab is showing
  var testRun = null;
  var testRunning = false;
  var chainVerdict = null;
  var tampered = false;     // has the demo corruption been applied this session
  var toast = { text: '', tone: '' };
  var icdQuery = '';
  var drugQuery = '';
  var addendumPath = 's';
  var patientQuery = '';

  function today() { return R.todayISO(new Date()); }

  function say(text, tone) {
    toast = { text: text, tone: tone || '' };
  }

  /* ------------------------------------------------------------ persistence */

  var saveTimer = null;
  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      R.store.save(clinic).then(function (res) {
        if (!res.ok) showStoreWarning('Perubahan tidak tersimpan ke IndexedDB: ' + res.reason + ' — aplikasi tetap berjalan dari memori.');
      });
    }, 250);
  }

  function showStoreWarning(msg) {
    var box = $('storeWarn');
    clear(box);
    box.hidden = false;
    box.className = 'warnbar';
    box.appendChild(h('span', {}, h('b', { text: 'Penyimpanan: ' }), msg));
  }

  /* -------------------------------------------------------------- egress */

  function renderNet() {
    var g = window.REKAM_GUARD;
    if (!g) return;
    var n = g.total();
    $('netCount').textContent = 'panggilan jaringan: ' + n;
    $('netBadge').className = n ? 'netbadge bad' : 'netbadge';
  }
  if (window.REKAM_GUARD) window.REKAM_GUARD.onchange = renderNet;

  /* ---------------------------------------------------------------- theme */

  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function applyThemeLabel() {
    $('themeBtn').textContent = currentTheme() === 'light' ? 'Gelap' : 'Terang';
  }
  $('themeBtn').addEventListener('click', function () {
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    R.store.prefSet('theme', next);
    applyThemeLabel();
  });
  applyThemeLabel();

  /* ----------------------------------------------------------------- tabs */

  var TABS = ['antrian', 'pendaftaran', 'rekam', 'konsultasi', 'farmasi', 'kasir', 'audit', 'uji'];

  function selectTab(name) {
    active = name;
    TABS.forEach(function (t) {
      var btn = $('tab-' + t), panel = $('panel-' + t);
      var on = t === name;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    renderPanel(name);
  }

  TABS.forEach(function (t) {
    $('tab-' + t).addEventListener('click', function () { selectTab(t); });
  });

  $('tabs').addEventListener('keydown', function (ev) {
    var i = TABS.indexOf(active);
    if (ev.key === 'ArrowRight') { ev.preventDefault(); var n = TABS[(i + 1) % TABS.length]; selectTab(n); $('tab-' + n).focus(); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); var p = TABS[(i - 1 + TABS.length) % TABS.length]; selectTab(p); $('tab-' + p).focus(); }
  });

  /* ---------------------------------------------------------------- roles */

  function renderRoles() {
    var box = $('roleOpts');
    clear(box);
    D.ROLES.forEach(function (role) {
      var staff = clinic.state.staff.filter(function (s) { return s.role === role.id; })[0];
      box.appendChild(h('button', {
        type: 'button', class: 'rolebtn',
        'aria-pressed': clinic.actor.role === role.id ? 'true' : 'false',
        onclick: function () {
          clinic.setActor(staff.id);
          R.store.prefSet('role', staff.id);
          say('Beralih peran ke ' + role.label + '. Perhatikan modul mana yang berubah.', 'good');
          renderAll();
        }
      }, role.label));
    });

    var who = $('whoAmI');
    clear(who);
    var role = D.ROLE_BY_ID[clinic.actor.role];
    var staff = clinic.staff(clinic.actor.id);
    who.appendChild(h('b', { text: clinic.actor.name + (staff && staff.sip ? ' · ' + staff.sip : '') }));
    who.appendChild(document.createTextNode(' — ' + (role ? role.blurb : '')));
  }

  /* --------------------------------------------------------- permission UI */

  function denyBox(perm, extra) {
    var v = D.can(clinic.actor.role, perm);
    if (v.ok) return null;
    return h('div', { class: 'denied' },
      h('b', { text: 'Akses ditolak. ' }),
      v.reason,
      extra ? ' ' + extra : null);
  }

  function allowed(perm) { return D.can(clinic.actor.role, perm).ok; }

  /* ------------------------------------------------------------- summary */

  function renderSummary() {
    var box = $('summary');
    clear(box);
    var t = today();
    var todays = clinic.state.visits.filter(function (v) { return v.date === t; });
    var waiting = todays.filter(function (v) { return ['terdaftar', 'triase', 'menunggu-dokter'].indexOf(v.status) >= 0; });
    var done = todays.filter(function (v) { return v.status === 'selesai'; });
    var rx = clinic.state.prescriptions.filter(function (p) {
      var v = clinic.visit(p.visitId);
      return v && v.date === t && ['signed', 'ditelaah'].indexOf(p.status) >= 0;
    });

    function stat(k, v, n) {
      box.appendChild(h('div', { class: 'stat' },
        h('div', { class: 'k', text: k }),
        h('div', { class: 'v', text: String(v) }),
        n ? h('div', { class: 'n', text: n }) : null));
    }
    stat('Antrian hari ini', todays.length, fmtDate(t));
    stat('Menunggu', waiting.length, 'belum diperiksa dokter');
    stat('Selesai', done.length, 'kunjungan tertutup');
    stat('Resep di farmasi', rx.length, 'menunggu telaah / serah');
    stat('Total pasien', clinic.state.patients.length, 'No. RM terpakai: ' + clinic.state.counters.rm);
    stat('Entri audit', clinic.chain.entries.length,
      chainVerdict ? (chainVerdict.ok ? 'rantai utuh' : 'RANTAI RUSAK') : 'belum diverifikasi');

    // Tab counters, so a pharmacist can see there is work without hunting.
    var farmasiCount = clinic.state.prescriptions.filter(function (p) {
      return ['signed', 'ditelaah'].indexOf(p.status) >= 0;
    }).length;
    var kasirCount = clinic.state.visits.filter(function (v) { return v.status === 'kasir'; }).length;
    setTabCount('farmasi', farmasiCount);
    setTabCount('kasir', kasirCount);
    setTabCount('antrian', waiting.length);
  }

  function setTabCount(tab, n) {
    var btn = $('tab-' + tab);
    var span = btn.querySelector('.count');
    if (!n) { if (span) span.remove(); return; }
    if (!span) { span = h('span', { class: 'count' }); btn.appendChild(span); }
    span.textContent = String(n);
  }

  /* =====================================================================
   * Panel: Antrian
   * ===================================================================== */

  var BOARD = ['terdaftar', 'triase', 'menunggu-dokter', 'konsultasi', 'farmasi', 'kasir'];

  function renderAntrian(panel) {
    var t = today();
    var todays = clinic.state.visits.filter(function (v) { return v.date === t; });

    panel.appendChild(h('div', { class: 'claim' },
      h('b', { text: 'Nomor antrian bukan nomor rekam medis. ' }),
      'Nomor antrian (A-001) berlaku satu hari untuk satu poli dan sengaja dipakai ulang besok. ' +
      'No. RM (RM-000123) melekat pada pasien seumur hidup dan tidak pernah dipakai ulang. ' +
      'ID kunjungan (V-20260908-0007) unik permanen dan menjadi tempat rekam medis digantungkan.'));

    var board = h('div', { class: 'qboard' });
    BOARD.forEach(function (st) {
      var col = h('div', { class: 'qcol' });
      var list = todays.filter(function (v) { return v.status === st; });
      col.appendChild(h('h4', {},
        h('span', { text: D.QUEUE[st].label }),
        h('span', { class: 'mono', text: String(list.length) })));
      col.appendChild(h('p', { class: 'hint', text: D.QUEUE[st].hint }));
      if (!list.length) {
        col.appendChild(h('p', { class: 'small muted', text: '— kosong —' }));
      }
      list.sort(function (a, b) { return a.queueSeq - b.queueSeq; }).forEach(function (v) {
        col.appendChild(queueCard(v));
      });
      board.appendChild(col);
    });
    panel.appendChild(board);

    var doneToday = todays.filter(function (v) { return ['selesai', 'batal', 'tidak-hadir'].indexOf(v.status) >= 0; });
    if (doneToday.length) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h3', { text: 'Sudah keluar hari ini (' + doneToday.length + ')' }));
      var wrap = h('div', { class: 'qboard' });
      var col2 = h('div', { class: 'qcol' });
      doneToday.forEach(function (v) { col2.appendChild(queueCard(v)); });
      wrap.appendChild(col2);
      card.appendChild(wrap);
      panel.appendChild(card);
    }

    panel.appendChild(actionPanel());
  }

  function queueCard(v) {
    var p = clinic.patient(v.rmNumber);
    var poli = D.POLI_BY_ID[v.poli];
    var acuity = v.triage && v.triage.acuity;
    return h('button', {
      type: 'button',
      class: 'qcard' + (selVisit === v.id ? ' sel' : ''),
      'aria-pressed': selVisit === v.id ? 'true' : 'false',
      onclick: function () { selVisit = v.id; selRM = v.rmNumber; renderAll(); }
    },
      h('div', { class: 'qno', text: v.queueNo }),
      h('div', { class: 'qname', text: p ? p.name : v.rmNumber }),
      h('div', { class: 'qmeta' },
        h('span', { class: 'pill', text: v.rmNumber }),
        h('span', { class: 'pill ' + v.klass, text: v.klass === 'bpjs' ? 'BPJS' : 'Umum' }),
        h('span', { class: 'pill', text: poli ? poli.label : v.poli }),
        acuity ? h('span', { class: 'tri ' + acuity, text: acuity }) : null,
        p && p.allergies && p.allergies.length ? h('span', { class: 'pill bad', text: 'alergi' }) : null));
  }

  /** The transition panel: every edge out of the current state, allowed or not,
   *  with the reason attached to the ones that are not. */
  function actionPanel() {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Aksi antrian' }));
    if (!selVisit) {
      card.appendChild(h('p', { class: 'note', text: 'Pilih satu kartu antrian di atas untuk melihat aksi yang tersedia.' }));
      return card;
    }
    var v = clinic.visit(selVisit);
    if (!v) {
      card.appendChild(h('p', { class: 'note', text: 'Kunjungan tidak ditemukan.' }));
      return card;
    }
    var p = clinic.patient(v.rmNumber);
    card.appendChild(h('p', { class: 'note' },
      h('b', { text: v.queueNo + ' · ' + (p ? p.name : v.rmNumber) }),
      ' — ' + v.id + ' · status ' + D.QUEUE[v.status].label + '. ' +
      'Tombol yang tidak dapat ditekan tetap ditampilkan beserta alasannya.'));

    var node = D.QUEUE[v.status];
    var targets = Object.keys(node.next);
    if (!targets.length) {
      card.appendChild(h('p', { class: 'small muted', text: 'Status "' + node.label + '" bersifat terminal — tidak ada perpindahan berikutnya.' }));
    }
    var row = h('div', { class: 'controls' });
    targets.forEach(function (to) {
      var verdict = D.canTransition(v, to, clinic.actor.role, clinic.ctxFor(v));
      var btn = h('button', {
        type: 'button',
        class: 'btn' + (verdict.ok ? ' primary' : ''),
        disabled: !verdict.ok,
        title: verdict.ok ? '' : verdict.reason,
        onclick: function () {
          clinic.transition(v.id, to).then(function (res) {
            say(res.ok ? ('Antrian ' + v.queueNo + ' → ' + D.QUEUE[to].label + '.') : res.reason, res.ok ? 'good' : 'err');
            persist();
            renderAll();
          });
        }
      }, '→ ' + D.QUEUE[to].label);
      row.appendChild(btn);
    });
    card.appendChild(row);

    targets.forEach(function (to) {
      var verdict = D.canTransition(v, to, clinic.actor.role, clinic.ctxFor(v));
      if (verdict.ok) return;
      card.appendChild(h('div', { class: 'denied' },
        h('b', { text: '→ ' + D.QUEUE[to].label + ' ditolak. ' }), verdict.reason));
    });

    var goto = h('div', { class: 'controls' });
    goto.appendChild(h('button', { type: 'button', class: 'btn small', onclick: function () { selectTab('konsultasi'); } }, 'Buka di Konsultasi'));
    goto.appendChild(h('button', { type: 'button', class: 'btn small', onclick: function () { selRM = v.rmNumber; selectTab('rekam'); } }, 'Buka Rekam Medis'));
    card.appendChild(goto);

    card.appendChild(historyList(v));
    return card;
  }

  function historyList(v) {
    var d = h('details', { class: 'more' });
    d.appendChild(h('summary', { text: 'Riwayat perpindahan antrian (' + v.history.length + ')' }));
    var wrap = h('div', { class: 'tblwrap' });
    var tbl = h('table');
    tbl.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Waktu' }), h('th', { text: 'Dari' }), h('th', { text: 'Ke' }), h('th', { text: 'Oleh' }))));
    var tb = h('tbody');
    v.history.forEach(function (e) {
      tb.appendChild(h('tr', {},
        h('td', { class: 'mono', text: fmtTime(e.at) }),
        h('td', { text: e.from ? D.QUEUE[e.from].label : '—' }),
        h('td', { text: D.QUEUE[e.to].label }),
        h('td', { text: (clinic.staff(e.by) || {}).name || e.by })));
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    d.appendChild(wrap);
    return d;
  }

  /* =====================================================================
   * Panel: Pendaftaran
   * ===================================================================== */

  function renderPendaftaran(panel) {
    var deny = denyBox('pasien.daftar', 'Beralih ke peran Pendaftaran / Admin di bagian atas halaman untuk mencoba modul ini.');
    if (deny) panel.appendChild(deny);

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Cari pasien' }));
    card.appendChild(h('p', { class: 'note', text: 'Cari dengan nama atau No. RM. Pendaftaran ulang selalu memakai No. RM yang sudah ada — nomor baru hanya untuk orang yang benar-benar belum pernah datang.' }));
    var input = h('input', {
      type: 'search', placeholder: 'Nama atau RM-000123', value: patientQuery,
      'aria-label': 'Cari pasien',
      oninput: function (ev) { patientQuery = ev.target.value; renderPanelOnly('pendaftaran', true); }
    });
    card.appendChild(h('div', { class: 'controls' }, input));
    card.appendChild(patientTable(matchPatients(patientQuery).slice(0, 12), true));
    panel.appendChild(card);

    if (selRM) panel.appendChild(openVisitCard(clinic.patient(selRM)));
    panel.appendChild(newPatientCard());
  }

  function matchPatients(q) {
    var s = String(q || '').toLowerCase().trim();
    var list = clinic.state.patients.slice().sort(function (a, b) {
      return D.parseRM(b.rmNumber) - D.parseRM(a.rmNumber);
    });
    if (!s) return list;
    return list.filter(function (p) {
      return p.name.toLowerCase().indexOf(s) >= 0 || p.rmNumber.toLowerCase().indexOf(s) >= 0;
    });
  }

  function patientTable(list, selectable) {
    if (!list.length) return h('p', { class: 'empty', text: 'Tidak ada pasien yang cocok.' });
    var wrap = h('div', { class: 'tblwrap' });
    var tbl = h('table');
    tbl.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'No. RM' }), h('th', { text: 'Nama' }), h('th', { text: 'L/P' }),
      h('th', { text: 'Usia' }), h('th', { text: 'Kelas' }), h('th', { text: 'Catatan' }))));
    var tb = h('tbody');
    list.forEach(function (p) {
      var tr = h('tr', {
        class: selectable ? 'clickable' : '',
        onclick: selectable ? function () { selRM = p.rmNumber; renderAll(); } : null
      },
        h('td', { class: 'mono', text: p.rmNumber }),
        h('td', { text: p.name }),
        h('td', { text: p.sex }),
        h('td', { class: 'num', text: String(clinic.age(p)) }),
        h('td', {}, h('span', { class: 'pill ' + p.klass, text: p.klass === 'bpjs' ? 'BPJS' : 'Umum' })),
        h('td', {},
          p.allergies.length ? h('span', { class: 'pill bad', text: 'alergi: ' + p.allergies.join(', ') }) : null,
          p.pregnant ? h('span', { class: 'pill warn', text: 'hamil' }) : null,
          p.chronic.length ? h('span', { class: 'pill', text: p.chronic.join(' ') }) : null));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    return wrap;
  }

  function openVisitCard(p) {
    var card = h('div', { class: 'card' });
    if (!p) { card.appendChild(h('p', { class: 'note', text: 'Pilih pasien dari tabel untuk membuka kunjungan.' })); return card; }
    card.appendChild(h('h3', { text: 'Buka kunjungan — ' + p.name + ' (' + p.rmNumber + ')' }));
    card.appendChild(h('p', { class: 'note', text: 'Nomor antrian dialokasikan saat kunjungan dibuka, per poli, per hari.' }));

    var poliSel = h('select', { 'aria-label': 'Poli tujuan' },
      D.POLI.map(function (x) { return h('option', { value: x.id, text: x.label }); }));
    var klassSel = h('select', { 'aria-label': 'Kelas pasien' },
      h('option', { value: 'bpjs', text: 'BPJS', selected: p.klass === 'bpjs' }),
      h('option', { value: 'umum', text: 'Umum (bayar sendiri)', selected: p.klass !== 'bpjs' }));
    var docSel = h('select', { 'aria-label': 'Dokter' },
      h('option', { value: '', text: '(tentukan nanti)' }),
      clinic.state.staff.filter(function (s) { return s.role === 'dokter'; })
        .map(function (s) { return h('option', { value: s.id, text: s.name }); }));
    var complaint = h('input', { type: 'text', placeholder: 'Keluhan utama', 'aria-label': 'Keluhan utama' });

    var grid = h('div', { class: 'formgrid' },
      h('div', { class: 'field' }, h('label', { text: 'Poli' }), poliSel),
      h('div', { class: 'field' }, h('label', { text: 'Kelas' }), klassSel),
      h('div', { class: 'field' }, h('label', { text: 'Dokter' }), docSel));
    card.appendChild(grid);
    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Keluhan utama' }), complaint));

    var can = D.can(clinic.actor.role, 'kunjungan.buka');
    card.appendChild(h('div', { class: 'controls' },
      h('button', {
        type: 'button', class: 'btn primary', disabled: !can.ok, title: can.ok ? '' : can.reason,
        onclick: function () {
          clinic.openVisit({
            rmNumber: p.rmNumber, poli: poliSel.value, klass: klassSel.value,
            doctorId: docSel.value || null, complaint: complaint.value
          }).then(function (res) {
            if (res.ok) {
              selVisit = res.visit.id;
              say('Kunjungan dibuka. Nomor antrian ' + res.visit.queueNo + ', ID kunjungan ' + res.visit.id + '.', 'good');
              persist();
              selectTab('antrian');
            } else {
              say(res.reason, 'err');
              renderAll();
            }
          });
        }
      }, 'Buka kunjungan & ambil nomor antrian')));
    if (!can.ok) card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), can.reason));
    return card;
  }

  function newPatientCard() {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Daftarkan pasien baru' }));
    card.appendChild(h('p', { class: 'note' },
      h('b', { text: 'No. RM dialokasikan sekali dan tidak pernah dipakai ulang. ' }),
      'Pencacah dinaikkan sebelum rekam pasien dibuat, sehingga kegagalan di tengah proses membuang satu nomor ' +
      'alih-alih berisiko menerbitkannya dua kali. Membuang nomor tidak ada biayanya; menerbitkannya dua kali ' +
      'menggabungkan riwayat medis dua orang.'));

    var name = h('input', { type: 'text', placeholder: 'Nama lengkap', 'aria-label': 'Nama lengkap' });
    var dob = h('input', { type: 'date', 'aria-label': 'Tanggal lahir', value: '1990-01-01' });
    var sex = h('select', { 'aria-label': 'Jenis kelamin' },
      h('option', { value: 'L', text: 'Laki-laki' }), h('option', { value: 'P', text: 'Perempuan' }));
    var klass = h('select', { 'aria-label': 'Kelas' },
      h('option', { value: 'bpjs', text: 'BPJS' }), h('option', { value: 'umum', text: 'Umum' }));
    var pregnant = h('input', { type: 'checkbox', id: 'np-pregnant' });

    card.appendChild(h('div', { class: 'formgrid' },
      h('div', { class: 'field' }, h('label', { text: 'Nama' }), name),
      h('div', { class: 'field' }, h('label', { text: 'Tanggal lahir' }), dob),
      h('div', { class: 'field' }, h('label', { text: 'Jenis kelamin' }), sex),
      h('div', { class: 'field' }, h('label', { text: 'Kelas' }), klass)));

    var allergyBoxes = [];
    var allergyWrap = h('div', { class: 'controls' });
    R.rx.allergyClasses.forEach(function (a) {
      var cb = h('input', { type: 'checkbox', id: 'alg-' + a.id });
      allergyBoxes.push({ id: a.id, cb: cb });
      allergyWrap.appendChild(h('label', { class: 'inline', for: 'alg-' + a.id }, cb, a.label));
    });
    card.appendChild(h('div', { class: 'field' },
      h('label', { text: 'Alergi obat (golongan, bukan merek)' }),
      allergyWrap,
      h('span', { class: 'help', text: 'Alergi dicatat sebagai GOLONGAN. "Alergi amoksisilin" harus ikut memblokir ampisilin dan ko-amoksiklav; sistem yang hanya mencocokkan nama produk gagal justru di kasus itu.' })));

    card.appendChild(h('div', { class: 'field' },
      h('label', { class: 'inline', for: 'np-pregnant' }, pregnant, 'Sedang hamil')));

    var can = D.can(clinic.actor.role, 'pasien.daftar');
    card.appendChild(h('div', { class: 'controls' },
      h('button', {
        type: 'button', class: 'btn primary', disabled: !can.ok, title: can.ok ? '' : can.reason,
        onclick: function () {
          clinic.registerPatient({
            name: name.value, dob: dob.value, sex: sex.value, klass: klass.value,
            allergies: allergyBoxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.id; }),
            allergyNote: '',
            pregnant: pregnant.checked
          }).then(function (res) {
            if (res.ok) {
              selRM = res.patient.rmNumber;
              patientQuery = '';
              say('Pasien terdaftar dengan ' + res.patient.rmNumber + '. Nomor ini tidak akan pernah dipakai ulang.', 'good');
              persist();
            } else {
              say(res.reason, 'err');
            }
            renderAll();
          });
        }
      }, 'Daftarkan & alokasikan No. RM')));
    return card;
  }

  /* =====================================================================
   * Panel: Rekam Medis
   * ===================================================================== */

  function renderRekam(panel) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Rekam medis pasien' }));
    card.appendChild(h('p', { class: 'note' },
      h('b', { text: 'Rekam medis adalah RIWAYAT, bukan keadaan sekarang. ' }),
      'Baris pasien hanya memuat identitas dan fakta yang menetap (alergi, penyakit kronis). ' +
      'Keluhan, tanda vital, diagnosis dan terapi selalu melekat pada satu kunjungan. ' +
      '"Mengubah diagnosis pasien" bukan operasi yang ada di model ini.'));
    var input = h('input', {
      type: 'search', placeholder: 'Cari pasien…', value: patientQuery, 'aria-label': 'Cari pasien',
      oninput: function (ev) { patientQuery = ev.target.value; renderPanelOnly('rekam', true); }
    });
    card.appendChild(h('div', { class: 'controls' }, input));
    card.appendChild(patientTable(matchPatients(patientQuery).slice(0, 10), true));
    panel.appendChild(card);

    if (!selRM) {
      panel.appendChild(h('p', { class: 'empty', text: 'Pilih pasien untuk membuka rekam medisnya.' }));
      return;
    }
    var p = clinic.patient(selRM);
    if (!p) return;

    var rec = h('div', { class: 'card' });
    rec.appendChild(patientHeader(p));
    var visits = clinic.visitsFor(p.rmNumber);
    if (!visits.length) {
      rec.appendChild(h('p', { class: 'empty', text: 'Belum ada kunjungan.' }));
    } else {
      rec.appendChild(h('p', { class: 'note', text: visits.length + ' kunjungan tercatat, terbaru di atas.' }));
      visits.forEach(function (v, i) {
        rec.appendChild(visitBlock(v, i === 0));
      });
    }
    panel.appendChild(rec);
  }

  function patientHeader(p) {
    var head = h('div', { class: 'phead' },
      h('div', {},
        h('div', { class: 'pname', text: p.name }),
        h('div', { class: 'prm mono', text: p.rmNumber }),
        h('div', { class: 'pmeta' },
          h('span', { text: (p.sex === 'P' ? 'Perempuan' : 'Laki-laki') + ', ' + clinic.age(p) + ' th' }),
          h('span', { text: 'lahir ' + fmtDate(p.dob) }),
          h('span', { class: 'pill ' + p.klass, text: p.klass === 'bpjs' ? 'BPJS' : 'Umum' }),
          p.pregnant ? h('span', { class: 'pill warn', text: 'hamil' }) : null,
          h('span', { class: 'pill', text: p.nikDemo }),
          p.klass === 'bpjs' ? h('span', { class: 'pill', text: p.bpjsDemo }) : null)));

    var box = h('div', {});
    box.appendChild(head);
    if (p.allergies.length) {
      box.appendChild(h('div', { class: 'alert-allergy' },
        h('b', { text: 'ALERGI OBAT: ' }),
        p.allergies.map(function (a) {
          var c = R.rx.allergyClasses.filter(function (x) { return x.id === a; })[0];
          return (c ? c.label : a);
        }).join(', '),
        p.allergyNote ? h('div', { class: 'small muted', text: p.allergyNote }) : null));
    }
    if (p.chronic.length) {
      box.appendChild(h('p', { class: 'small muted' },
        'Masalah kronis: ' + p.chronic.map(function (c) { return R.icd.label(c); }).join(' · ')));
    }
    return box;
  }

  function visitBlock(v, open) {
    var enc = clinic.encounterForVisit(v.id);
    var rx = clinic.prescriptionForVisit(v.id);
    var poli = D.POLI_BY_ID[v.poli];

    var det = h('details', { class: 'more', open: open ? true : null });
    det.appendChild(h('summary', {},
      fmtDate(v.date) + ' · ' + (poli ? poli.label : v.poli) + ' · ' + v.queueNo +
      ' · ' + D.QUEUE[v.status].label +
      (enc ? (enc.status === 'signed' ? ' · SOAP ditandatangani' : ' · SOAP draf') : ' · belum ada SOAP')));

    var body = h('div', { class: 'soap' });
    body.appendChild(h('p', { class: 'small muted', text: 'ID kunjungan ' + v.id + ' · dokter ' + ((clinic.staff(v.doctorId) || {}).name || '—') + (v.complaint ? ' · keluhan: ' + v.complaint : '') }));

    if (v.triage) body.appendChild(vitalsBlock(v.triage, clinic.age(clinic.patient(v.rmNumber))));

    if (!enc) {
      body.appendChild(h('p', { class: 'empty', text: 'Kunjungan ini belum memiliki catatan SOAP.' }));
    } else {
      body.appendChild(soapView(enc));
    }

    if (rx) body.appendChild(rxView(rx));
    if (v.billing) body.appendChild(billView(v.billing));

    det.appendChild(body);
    return det;
  }

  /** Renders a signed encounter with its addenda: original struck through,
   *  correction below it, reason attached. Never destructive. */
  function soapView(enc) {
    var eff = clinic.effective(enc.id);
    var wrap = h('div', { class: 'soap' });

    function section(pathKey, label, perm, renderValue) {
      var can = D.can(clinic.actor.role, perm);
      var sec = h('div', { class: 'soap-sec' });
      sec.appendChild(h('h4', {},
        h('span', { text: label }),
        eff.supersededBy[pathKey] ? h('span', { class: 'pill warn', text: 'diadendum' }) : null));
      if (!can.ok) {
        sec.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Tidak ditampilkan. ' }), can.reason));
        return sec;
      }
      var superseded = !!eff.supersededBy[pathKey];
      if (superseded) {
        sec.appendChild(h('div', { class: 'body superseded' }, renderValue(eff.original[pathKey])));
        eff.trail[pathKey].forEach(function (a, i) {
          var isLast = i === eff.trail[pathKey].length - 1;
          sec.appendChild(h('div', { class: 'addbox' },
            h('div', { class: 'ahead', text: 'Adendum ' + a.id + (isLast ? ' — berlaku' : ' — digantikan adendum berikutnya') }),
            h('div', { class: isLast ? 'body' : 'body superseded' }, renderValue(a.newValue)),
            h('div', { class: 'areason', text: '“' + a.reason + '”' }),
            h('div', { class: 'small muted', text: a.byName + ' · ' + D.roleLabel(a.byRole) + ' · ' + fmtDateTime(a.at) })));
        });
      } else {
        sec.appendChild(h('div', { class: 'body' }, renderValue(eff.values[pathKey])));
      }
      return sec;
    }

    function textVal(v) { return h('span', { text: v && String(v).trim() ? String(v) : '—' }); }

    function dxVal(list) {
      if (!list || !list.length) return h('span', { text: '—' });
      var box = h('div', {});
      list.forEach(function (d) {
        var e = R.icd.get(d.code);
        box.appendChild(h('div', { class: 'dxrow' },
          h('span', { class: 'dxcode', text: d.code }),
          h('span', { text: e ? e.id : '(kode tidak dikenal)' }),
          d.primary ? h('span', { class: 'dxprim', text: 'utama' }) : null,
          e ? h('span', { class: 'small muted', text: e.en }) : null,
          d.note ? h('span', { class: 'small muted', text: '— ' + d.note }) : null));
      });
      return box;
    }

    wrap.appendChild(section('s', 'S — Subjective (anamnesis)', 'soap.lihat-subjektif', textVal));
    wrap.appendChild(section('o.exam', 'O — Objective (pemeriksaan fisik)', 'soap.lihat-objektif', textVal));
    wrap.appendChild(section('a', 'A — Assessment (diagnosis ICD-10)', 'soap.lihat-asesmen', dxVal));
    wrap.appendChild(section('p.plan', 'P — Plan (tata laksana)', 'soap.lihat-plan', textVal));
    if (allowed('soap.lihat-plan') && enc.p.edukasi) {
      wrap.appendChild(h('div', { class: 'soap-sec' },
        h('h4', {}, h('span', { text: 'P — Edukasi' })),
        h('div', { class: 'body', text: enc.p.edukasi })));
    }

    wrap.appendChild(h('p', { class: 'small muted' },
      enc.status === 'signed'
        ? 'Ditandatangani ' + fmtDateTime(enc.signedAt) + ' oleh ' + ((clinic.staff(enc.signedBy) || {}).name || enc.signedBy) +
          '. Setelah tanda tangan, catatan ini tidak dapat diubah — hanya diadendum.'
        : 'Masih berstatus DRAF. Belum menjadi bagian rekam medis yang sah.'));
    return wrap;
  }

  function vitalsBlock(t, age) {
    var flags = D.flagVitals(t, age);
    var byKey = {};
    flags.forEach(function (f) { byKey[f.key] = f; });
    var wrap = h('div', { class: 'soap-sec' });
    wrap.appendChild(h('h4', {}, h('span', { text: 'Tanda vital (triase)' }),
      t.acuity ? h('span', { class: 'tri ' + t.acuity, text: 'triase ' + t.acuity }) : null));
    var grid = h('div', { class: 'vitals' });
    function vital(key, label, value, unit) {
      if (value == null) return;
      var f = byKey[key];
      grid.appendChild(h('div', { class: 'vital' + (f ? ' ' + f.tone : '') },
        h('div', { class: 'k', text: label }),
        h('div', { class: 'v', text: value + (unit ? ' ' + unit : '') }),
        h('div', { class: 'n', text: f ? f.note : 'normal' })));
    }
    vital('td', 'TD', t.tdSistol != null && t.tdDiastol != null ? t.tdSistol + '/' + t.tdDiastol : null, 'mmHg');
    vital('nadi', 'Nadi', t.nadi, 'x/mnt');
    vital('suhu', 'Suhu', t.suhu, '°C');
    vital('rr', 'RR', t.rr, 'x/mnt');
    vital('spo2', 'SpO₂', t.spo2, '%');
    vital('bb', 'BB', t.bb, 'kg');
    vital('tb', 'TB', t.tb, 'cm');
    var b = D.bmi(t.bb, t.tb);
    if (b != null) vital('imt', 'IMT', b, 'kg/m²');
    wrap.appendChild(grid);
    if (b != null && age != null && age >= 18) {
      wrap.appendChild(h('p', { class: 'small muted', text: 'Ambang IMT memakai kriteria Asia-Pasifik (berisiko ≥ 23; obesitas ≥ 25), bukan ambang WHO global — itu yang dipakai pedoman Kemenkes.' }));
    }
    return wrap;
  }

  function rxView(rx) {
    var wrap = h('div', { class: 'soap-sec' });
    var can = D.can(clinic.actor.role, 'resep.lihat');
    wrap.appendChild(h('h4', {},
      h('span', { text: 'Resep ' + rx.id }),
      h('span', { class: 'pill ' + (rx.status === 'diserahkan' ? 'ok' : 'warn'), text: rx.status })));
    if (!can.ok) {
      wrap.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Tidak ditampilkan. ' }), can.reason));
      return wrap;
    }
    var wrapT = h('div', { class: 'tblwrap' });
    var tbl = h('table');
    tbl.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Obat' }), h('th', { text: 'Dosis' }), h('th', { text: 'Frekuensi' }),
      h('th', { text: 'Durasi' }), h('th', { class: 'num', text: 'Jumlah' }))));
    var tb = h('tbody');
    rx.items.forEach(function (it) {
      var d = R.rx.drug(it.drugId);
      tb.appendChild(h('tr', {},
        h('td', {}, h('b', { text: d ? d.name : it.drugId }), h('div', { class: 'small muted', text: d ? d.form + ' ' + d.strength : '' })),
        h('td', { text: it.dose || '—' }),
        h('td', { text: it.freq || '—' }),
        h('td', { text: it.days ? it.days + ' hari' : '—' }),
        h('td', { class: 'num', text: String(it.qty || 0) })));
    });
    tbl.appendChild(tb);
    wrapT.appendChild(tbl);
    wrap.appendChild(wrapT);
    if (rx.overrides && rx.overrides.length) {
      rx.overrides.forEach(function (o) {
        wrap.appendChild(h('div', { class: 'finding mayor' },
          h('div', { class: 'fhead' }, h('span', { class: 'sev', text: 'override' }), h('span', { class: 'ftitle', text: o.title })),
          h('div', { class: 'fwhy', text: 'Alasan klinis tertulis: “' + o.reason + '” — ' + ((clinic.staff(o.by) || {}).name || o.by) + ', ' + fmtDateTime(o.at) })));
      });
    }
    if (rx.reviewedAt) {
      wrap.appendChild(h('p', { class: 'small muted', text: 'Telaah apoteker ' + fmtDateTime(rx.reviewedAt) + ' oleh ' + ((clinic.staff(rx.reviewedBy) || {}).name || rx.reviewedBy) + (rx.reviewNote ? ' — ' + rx.reviewNote : '') }));
    }
    if (rx.dispensedAt) {
      wrap.appendChild(h('p', { class: 'small muted', text: 'Obat diserahkan ' + fmtDateTime(rx.dispensedAt) + ' oleh ' + ((clinic.staff(rx.dispensedBy) || {}).name || rx.dispensedBy) }));
    }
    return wrap;
  }

  function billView(bill) {
    var wrap = h('div', { class: 'soap-sec' });
    wrap.appendChild(h('h4', {}, h('span', { text: 'Rincian tagihan' })));
    var wrapT = h('div', { class: 'tblwrap' });
    var tbl = h('table');
    tbl.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Uraian' }), h('th', { class: 'num', text: 'Qty' }),
      h('th', { class: 'num', text: 'Tarif' }), h('th', { text: 'Penjamin' }))));
    var tb = h('tbody');
    bill.lines.forEach(function (l) {
      tb.appendChild(h('tr', {},
        h('td', { text: l.label }),
        h('td', { class: 'num', text: String(l.qty) }),
        h('td', { class: 'num', text: D.rupiah(l.amount) }),
        h('td', {}, h('span', {
          class: 'pill ' + (l.payer === 'bpjs' ? 'ok' : l.payer === 'iur' ? 'warn' : ''),
          text: l.payer === 'bpjs' ? 'BPJS' : l.payer === 'iur' ? 'iur biaya' : 'pasien'
        }))));
    });
    tbl.appendChild(tb);
    wrapT.appendChild(tbl);
    wrap.appendChild(wrapT);
    wrap.appendChild(h('dl', { class: 'kv' },
      h('dt', { text: 'Total tarif' }), h('dd', { class: 'mono', text: D.rupiah(bill.totalTarif) }),
      h('dt', { text: 'Ditanggung' }), h('dd', { class: 'mono', text: D.rupiah(bill.ditanggung) }),
      h('dt', { text: 'Dibayar pasien' }), h('dd', { class: 'mono', text: D.rupiah(bill.dibayarPasien) })));
    wrap.appendChild(h('p', { class: 'small muted', text: bill.note }));
    return wrap;
  }

  /* =====================================================================
   * Panel: Konsultasi
   * ===================================================================== */

  function renderKonsultasi(panel) {
    if (!selVisit) {
      panel.appendChild(h('p', { class: 'empty', text: 'Pilih satu kunjungan di tab Antrian terlebih dahulu.' }));
      return;
    }
    var v = clinic.visit(selVisit);
    if (!v) { panel.appendChild(h('p', { class: 'empty', text: 'Kunjungan tidak ditemukan.' })); return; }
    var p = clinic.patient(v.rmNumber);

    var head = h('div', { class: 'card' });
    head.appendChild(patientHeader(p));
    head.appendChild(h('p', { class: 'small muted', text: v.queueNo + ' · ' + (D.POLI_BY_ID[v.poli] || {}).label + ' · ' + D.QUEUE[v.status].label + ' · ' + v.id }));
    panel.appendChild(head);

    panel.appendChild(triageCard(v, p));

    var enc = clinic.encounterForVisit(v.id);
    if (v.status === 'konsultasi' || enc) {
      panel.appendChild(soapCard(v, enc, p));
      if (enc && enc.status === 'signed') panel.appendChild(addendumCard(enc));
      if (enc && enc.status === 'signed') panel.appendChild(rxCard(v, p));
    } else {
      var c = h('div', { class: 'card' });
      c.appendChild(h('h3', { text: 'Catatan SOAP' }));
      c.appendChild(h('p', { class: 'note', text: 'Catatan dibuat setelah pasien dipanggil masuk konsultasi. Status kunjungan sekarang: ' + D.QUEUE[v.status].label + '.' }));
      var can = D.canTransition(v, 'konsultasi', clinic.actor.role, clinic.ctxFor(v));
      c.appendChild(h('div', { class: 'controls' }, h('button', {
        type: 'button', class: 'btn primary', disabled: !can.ok, title: can.ok ? '' : can.reason,
        onclick: function () {
          clinic.transition(v.id, 'konsultasi').then(function (res) {
            if (res.ok) return clinic.startEncounter(v.id);
            say(res.reason, 'err');
            return null;
          }).then(function () { persist(); renderAll(); });
        }
      }, 'Panggil pasien & mulai konsultasi')));
      if (!can.ok) c.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), can.reason));
      panel.appendChild(c);
    }
  }

  function triageCard(v, p) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Triase & tanda vital' }));
    var can = D.can(clinic.actor.role, 'triase.isi');
    var editable = can.ok && ['terdaftar', 'triase'].indexOf(v.status) >= 0;

    if (v.triage) card.appendChild(vitalsBlock(v.triage, clinic.age(p)));

    if (!can.ok) {
      card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Hanya dibaca. ' }), can.reason));
      return card;
    }
    if (!editable) {
      card.appendChild(h('p', { class: 'small muted', text: 'Triase hanya dapat diisi saat kunjungan berstatus Terdaftar atau Triase. Status sekarang: ' + D.QUEUE[v.status].label + '.' }));
      return card;
    }

    var fields = {};
    function nf(key, label, unit, step) {
      var input = h('input', {
        type: 'number', step: step || '1', 'aria-label': label,
        value: v.triage && v.triage[key] != null ? String(v.triage[key]) : ''
      });
      fields[key] = input;
      return h('div', { class: 'field' }, h('label', { text: label + (unit ? ' (' + unit + ')' : '') }), input);
    }
    card.appendChild(h('div', { class: 'formgrid' },
      nf('tdSistol', 'Sistol', 'mmHg'), nf('tdDiastol', 'Diastol', 'mmHg'),
      nf('nadi', 'Nadi', 'x/mnt'), nf('suhu', 'Suhu', '°C', '0.1'),
      nf('rr', 'RR', 'x/mnt'), nf('spo2', 'SpO₂', '%'),
      nf('bb', 'BB', 'kg', '0.1'), nf('tb', 'TB', 'cm')));

    var acuity = h('select', { 'aria-label': 'Tingkat kegawatan' },
      h('option', { value: '', text: '(hitung otomatis dari tanda vital)' }),
      D.ACUITY.map(function (a) { return h('option', { value: a.id, text: a.label }); }));
    card.appendChild(h('div', { class: 'field' },
      h('label', { text: 'Tingkat kegawatan' }), acuity,
      h('span', { class: 'help', text: 'Sistem hanya MENYARANKAN dari tanda vital. Keputusan triase tetap milik perawat — mesin yang diam-diam menurunkan derajat pasien berat adalah bahaya, bukan fitur.' })));

    card.appendChild(h('div', { class: 'controls' }, h('button', {
      type: 'button', class: 'btn primary',
      onclick: function () {
        var t = {};
        Object.keys(fields).forEach(function (k) { t[k] = fields[k].value; });
        t.acuity = acuity.value || null;
        clinic.recordTriage(v.id, t).then(function (res) {
          say(res.ok ? 'Tanda vital tersimpan. Triase: ' + res.visit.triage.acuity + '.' : res.reason, res.ok ? 'good' : 'err');
          persist(); renderAll();
        });
      }
    }, 'Simpan triase')));
    return card;
  }

  function soapCard(v, enc, p) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Catatan SOAP' }));

    var canWrite = D.can(clinic.actor.role, 'soap.tulis');
    if (!enc) {
      card.appendChild(h('p', { class: 'note', text: 'Belum ada catatan untuk kunjungan ini.' }));
      card.appendChild(h('div', { class: 'controls' }, h('button', {
        type: 'button', class: 'btn primary', disabled: !canWrite.ok, title: canWrite.ok ? '' : canWrite.reason,
        onclick: function () { clinic.startEncounter(v.id).then(function () { persist(); renderAll(); }); }
      }, 'Mulai catatan SOAP')));
      if (!canWrite.ok) card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), canWrite.reason));
      return card;
    }

    if (enc.status === 'signed' || !canWrite.ok) {
      if (!canWrite.ok) card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Hanya dibaca. ' }), canWrite.reason));
      else card.appendChild(h('p', { class: 'note', text: 'Catatan sudah ditandatangani dan bersifat tetap. Koreksi dilakukan lewat adendum di bawah.' }));
      card.appendChild(soapView(enc));
      return card;
    }

    card.appendChild(h('p', { class: 'note', text: 'Status DRAF — dapat diubah bebas. Penyuntingan draf sengaja TIDAK dicatat satu per satu ke rantai audit; peristiwa yang dicatat adalah tanda tangannya.' }));

    var sBox = h('textarea', { rows: 4, 'aria-label': 'Subjective', placeholder: 'Anamnesis: keluhan utama, riwayat, faktor yang memperberat…' });
    sBox.value = enc.s || '';
    var oBox = h('textarea', { rows: 3, 'aria-label': 'Objective', placeholder: 'Pemeriksaan fisik…' });
    oBox.value = enc.o.exam || '';
    var pBox = h('textarea', { rows: 3, 'aria-label': 'Plan', placeholder: 'Tata laksana, rencana kontrol…' });
    pBox.value = enc.p.plan || '';
    var eBox = h('textarea', { rows: 2, 'aria-label': 'Edukasi', placeholder: 'Edukasi yang diberikan…' });
    eBox.value = enc.p.edukasi || '';

    function flush() {
      return clinic.saveEncounter(enc.id, {
        s: sBox.value, exam: oBox.value, plan: pBox.value, edukasi: eBox.value
      });
    }
    [sBox, oBox, pBox, eBox].forEach(function (b) { b.addEventListener('change', function () { flush().then(persist); }); });

    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'S — Subjective (anamnesis)' }), sBox));
    if (v.triage) card.appendChild(vitalsBlock(v.triage, clinic.age(p)));
    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'O — Objective (pemeriksaan fisik)' }), oBox));

    /* ---- assessment: the ICD-10 picker ---- */
    var aSec = h('div', { class: 'field' });
    aSec.appendChild(h('label', { text: 'A — Assessment (wajib berkode ICD-10)' }));
    aSec.appendChild(h('span', { class: 'help', text: 'Assessment dikode, bukan diketik bebas. Diagnosis teks bebas tidak dapat dilaporkan, tidak dapat diklaimkan, dan tidak dapat dicari kembali. Tepat satu diagnosis ditandai sebagai utama.' }));

    var list = h('div', {});
    (enc.a || []).forEach(function (d, idx) {
      var e = R.icd.get(d.code);
      list.appendChild(h('div', { class: 'dxrow' },
        h('span', { class: 'dxcode', text: d.code }),
        h('span', { text: e ? e.id : '(tidak dikenal)' }),
        h('button', {
          type: 'button', class: 'btn small', 'aria-pressed': d.primary ? 'true' : 'false',
          onclick: function () {
            var next = (enc.a || []).map(function (x, i) {
              var copy = { code: x.code, primary: i === idx, note: x.note || '' };
              return copy;
            });
            clinic.saveEncounter(enc.id, { a: next }).then(function () { persist(); renderPanelOnly('konsultasi'); });
          }
        }, d.primary ? 'utama' : 'jadikan utama'),
        h('button', {
          type: 'button', class: 'btn small danger',
          'aria-label': 'Hapus diagnosis ' + d.code,
          onclick: function () {
            var next = (enc.a || []).filter(function (x, i) { return i !== idx; });
            clinic.saveEncounter(enc.id, { a: next }).then(function () { persist(); renderPanelOnly('konsultasi'); });
          }
        }, '×')));
    });
    if (!(enc.a || []).length) list.appendChild(h('p', { class: 'small muted', text: 'Belum ada diagnosis.' }));
    aSec.appendChild(list);

    var picker = h('div', { class: 'picker' });
    var search = h('input', {
      type: 'search', value: icdQuery, placeholder: 'Cari kode atau istilah — "ispa", "J06", "demam berdarah", "hipertensi"…',
      'aria-label': 'Cari kode ICD-10',
      oninput: function (ev) { icdQuery = ev.target.value; drawIcdResults(); }
    });
    var results = h('div', { class: 'picker-results' });
    picker.appendChild(search);
    picker.appendChild(results);

    function drawIcdResults() {
      clear(results);
      var hits = R.icd.search(icdQuery, 12);
      if (!hits.length) {
        results.appendChild(h('p', { class: 'small muted', text: 'Tidak ada kode yang cocok. Coba istilah lain atau awalan kodenya.' }));
        return;
      }
      hits.forEach(function (hit) {
        var e = hit.entry;
        results.appendChild(h('button', {
          type: 'button', class: 'picker-item',
          onclick: function () {
            var existing = enc.a || [];
            if (existing.some(function (x) { return x.code === e.code; })) {
              say('Kode ' + e.code + ' sudah ada pada assessment ini.', 'err');
              renderPanelOnly('konsultasi');
              return;
            }
            var next = existing.concat([{ code: e.code, primary: existing.length === 0, note: '' }]);
            icdQuery = '';
            clinic.saveEncounter(enc.id, { a: next }).then(function () { persist(); renderPanelOnly('konsultasi'); });
          }
        },
          h('span', { class: 'c', text: e.code }),
          h('span', { text: e.id }),
          h('span', { class: 'en', text: e.en }),
          h('span', { class: 'ch', text: 'Bab ' + e.chapterRoman + ' · ' + e.chapter })));
      });
    }
    drawIcdResults();
    aSec.appendChild(picker);
    card.appendChild(aSec);

    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'P — Plan' }), pBox));
    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'P — Edukasi pasien' }), eBox));

    var canSign = D.can(clinic.actor.role, 'soap.tandatangani');
    card.appendChild(h('div', { class: 'controls' },
      h('button', {
        type: 'button', class: 'btn primary', disabled: !canSign.ok, title: canSign.ok ? '' : canSign.reason,
        onclick: function () {
          flush().then(function () { return clinic.signEncounter(enc.id); }).then(function (res) {
            say(res.ok ? 'Catatan SOAP ditandatangani. Mulai sekarang hanya dapat diadendum.' : res.reason, res.ok ? 'good' : 'err');
            persist(); renderAll();
          });
        }
      }, 'Tandatangani catatan'),
      h('button', { type: 'button', class: 'btn', onclick: function () { flush().then(function () { persist(); say('Draf disimpan.', 'good'); renderAll(); }); } }, 'Simpan draf')));
    if (!canSign.ok) card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), canSign.reason));
    return card;
  }

  function addendumCard(enc) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Adendum (koreksi setelah tanda tangan)' }));
    card.appendChild(h('p', { class: 'note' },
      h('b', { text: 'Koreksi bersifat menambah, bukan menimpa. ' }),
      'Rekam medis wajib dapat dikoreksi tetapi tidak boleh dapat ditulis ulang diam-diam. ' +
      'Adendum membuat catatan BARU yang menggantikan sebuah bagian; nilai lama tetap terbaca, alasannya wajib ditulis, ' +
      'dan seluruhnya masuk ke rantai hash atas nama pembuatnya.'));

    var can = D.can(clinic.actor.role, 'soap.addendum');
    if (!can.ok) {
      card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), can.reason));
      return card;
    }

    var pathSel = h('select', { 'aria-label': 'Bagian yang dikoreksi', onchange: function (ev) { addendumPath = ev.target.value; renderPanelOnly('konsultasi'); } },
      Object.keys(D.ADDENDABLE)
        .filter(function (k) { return k !== 'o.vitals'; })
        .map(function (k) { return h('option', { value: k, text: D.ADDENDABLE[k].label, selected: k === addendumPath }); }));

    var eff = clinic.effective(enc.id);
    var current = eff.values[addendumPath];

    var valueInput;
    if (addendumPath === 'a') {
      valueInput = h('input', {
        type: 'text', 'aria-label': 'Kode diagnosis baru',
        placeholder: 'Kode ICD-10 dipisah spasi, yang pertama menjadi diagnosis utama — mis. "K21.9 K29.7"',
        value: (current || []).map(function (d) { return d.code; }).join(' ')
      });
    } else {
      valueInput = h('textarea', { rows: 3, 'aria-label': 'Isi baru' });
      valueInput.value = current == null ? '' : String(current);
    }
    var reason = h('textarea', { rows: 2, 'aria-label': 'Alasan koreksi', placeholder: 'Mengapa catatan ini dikoreksi? Wajib diisi.' });

    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Bagian' }), pathSel));
    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Nilai berlaku sekarang' }),
      h('div', { class: 'body small muted', text: addendumPath === 'a' ? (current || []).map(function (d) { return d.code; }).join(', ') || '—' : (current || '—') })));
    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Isi baru' }), valueInput));
    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Alasan koreksi (wajib)' }), reason));

    card.appendChild(h('div', { class: 'controls' }, h('button', {
      type: 'button', class: 'btn primary',
      onclick: function () {
        var newValue;
        if (addendumPath === 'a') {
          var codes = valueInput.value.toUpperCase().split(/[\s,]+/).filter(Boolean);
          var unknown = codes.filter(function (c) { return !R.icd.get(c); });
          if (unknown.length) { say('Kode tidak dikenal: ' + unknown.join(', ') + '.', 'err'); renderAll(); return; }
          if (!codes.length) { say('Isi minimal satu kode diagnosis.', 'err'); renderAll(); return; }
          newValue = codes.map(function (c, i) { return { code: c, primary: i === 0, note: '' }; });
        } else {
          newValue = valueInput.value;
        }
        clinic.addAddendum(enc.id, { path: addendumPath, newValue: newValue, reason: reason.value })
          .then(function (res) {
            say(res.ok ? ('Adendum ' + res.addendum.id + ' dibuat. Nilai lama tetap tersimpan dan tetap terbaca.') : res.reason, res.ok ? 'good' : 'err');
            persist(); renderAll();
          });
      }
    }, 'Buat adendum')));

    var mine = clinic.addendaFor(enc.id);
    if (mine.length) {
      card.appendChild(h('p', { class: 'small muted', text: mine.length + ' adendum pada catatan ini. Lihat hasilnya di bagian SOAP di atas dan di tab Rekam Medis.' }));
    }
    return card;
  }

  /* ------------------------------------------------------- prescribing */

  var rxDraft = null;   // working items for the visit being prescribed
  var rxDraftVisit = null;
  var overrideReason = '';

  function ensureDraft(v) {
    var existing = clinic.prescriptionForVisit(v.id);
    if (rxDraftVisit !== v.id) {
      rxDraftVisit = v.id;
      rxDraft = existing ? existing.items.map(function (i) {
        return { drugId: i.drugId, dose: i.dose, freq: i.freq, days: i.days, qty: i.qty, instruksi: i.instruksi || '' };
      }) : [];
      overrideReason = '';
    }
    return rxDraft;
  }

  function rxCard(v, p) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Resep' }));
    var existing = clinic.prescriptionForVisit(v.id);

    if (existing && existing.status !== 'draft') {
      card.appendChild(h('p', { class: 'note', text: 'Resep sudah ditandatangani (' + existing.status + ') dan tidak dapat diubah.' }));
      card.appendChild(rxView(existing));
      return card;
    }

    var canWrite = D.can(clinic.actor.role, 'resep.tulis');
    if (!canWrite.ok) {
      card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), canWrite.reason));
      return card;
    }

    var items = ensureDraft(v);
    var ctx = clinic.rxContext(v.id);

    card.appendChild(h('p', { class: 'note' },
      'Konteks telaah: usia ' + ctx.age + ' th' +
      (ctx.pregnant ? ', HAMIL' : '') +
      (ctx.allergies.length ? ', alergi ' + ctx.allergies.join('/') : ', tanpa alergi tercatat') +
      (ctx.diagnoses.length ? ', diagnosis aktif ' + ctx.diagnoses.join(' ') : '') + '.'));

    /* lines */
    var lines = h('div', {});
    lines.appendChild(h('div', { class: 'rxline rxhead' },
      h('span', { text: 'Obat' }), h('span', { text: 'Dosis' }), h('span', { text: 'Frekuensi' }),
      h('span', { text: 'Hari' }), h('span', { text: 'Jumlah' }), h('span', { text: '' })));

    items.forEach(function (it, idx) {
      var d = R.rx.drug(it.drugId);
      function bind(prop, node, asNumber) {
        node.addEventListener('change', function () {
          it[prop] = asNumber ? Number(node.value) : node.value;
          renderPanelOnly('konsultasi');
        });
        return node;
      }
      lines.appendChild(h('div', { class: 'rxline' },
        h('span', { class: 'dname' }, h('b', { text: d ? d.name : it.drugId }), h('small', { text: d ? d.form + ' ' + d.strength : '' })),
        h('span', { class: 'c-dose' }, bind('dose', h('input', { type: 'text', value: it.dose || '', 'aria-label': 'Dosis' }))),
        h('span', { class: 'c-freq' }, bind('freq', h('input', { type: 'text', value: it.freq || '', 'aria-label': 'Frekuensi' }))),
        h('span', { class: 'c-days' }, bind('days', h('input', { type: 'number', min: '1', value: it.days || '', 'aria-label': 'Durasi hari' }), true)),
        h('span', { class: 'c-qty' }, bind('qty', h('input', { type: 'number', min: '1', value: it.qty || '', 'aria-label': 'Jumlah' }), true)),
        h('span', { class: 'c-del' }, h('button', {
          type: 'button', class: 'btn small danger', 'aria-label': 'Hapus ' + (d ? d.name : it.drugId),
          onclick: function () { items.splice(idx, 1); renderPanelOnly('konsultasi'); }
        }, '×'))));
    });
    if (!items.length) lines.appendChild(h('p', { class: 'small muted', text: 'Belum ada obat pada resep ini.' }));
    card.appendChild(lines);

    /* drug picker */
    var picker = h('div', { class: 'picker' });
    picker.appendChild(h('input', {
      type: 'search', value: drugQuery, placeholder: 'Tambah obat — cari nama generik atau golongan…',
      'aria-label': 'Cari obat',
      oninput: function (ev) { drugQuery = ev.target.value; drawDrugs(); }
    }));
    var dres = h('div', { class: 'picker-results' });
    picker.appendChild(dres);
    function drawDrugs() {
      clear(dres);
      var hits = R.rx.search(drugQuery, 10);
      if (!hits.length) { dres.appendChild(h('p', { class: 'small muted', text: 'Tidak ada obat yang cocok.' })); return; }
      hits.forEach(function (d) {
        dres.appendChild(h('button', {
          type: 'button', class: 'picker-item',
          onclick: function () {
            items.push({ drugId: d.id, dose: '1 ' + d.form.toLowerCase(), freq: '3x sehari', days: 5, qty: 15, instruksi: '' });
            drugQuery = '';
            renderPanelOnly('konsultasi');
          }
        },
          h('span', { class: 'c', text: d.form.slice(0, 3).toUpperCase() }),
          h('span', { text: d.name + ' ' + d.strength }),
          h('span', { class: 'en', text: d.classes.join(' · ') + (d.bpjs ? '' : ' · di luar jaminan BPJS') })));
      });
    }
    drawDrugs();
    card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Tambah obat' }), picker));

    /* safety */
    var safety = R.rx.check(items, ctx);
    card.appendChild(safetyPanel(safety, items.length));

    var needOverride = safety.overridable.length > 0;
    if (needOverride) {
      var ta = h('textarea', {
        rows: 2, 'aria-label': 'Alasan klinis override',
        placeholder: 'Alasan klinis untuk tetap meresepkan meski ada peringatan mayor (minimal 10 karakter). Alasan ini masuk ke jejak audit atas nama Anda.'
      });
      ta.value = overrideReason;
      ta.addEventListener('change', function () { overrideReason = ta.value; });
      card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Alasan klinis (wajib untuk peringatan MAYOR)' }), ta));
    }

    var canSign = D.can(clinic.actor.role, 'resep.tandatangani');
    var blocked = safety.blocking.length > 0;
    card.appendChild(h('div', { class: 'controls' },
      h('button', {
        type: 'button', class: 'btn', onclick: function () {
          clinic.savePrescription(v.id, items).then(function () { persist(); say('Draf resep disimpan.', 'good'); renderAll(); });
        }
      }, 'Simpan draf resep'),
      h('button', {
        type: 'button', class: 'btn primary',
        disabled: !canSign.ok || blocked || !items.length,
        title: !canSign.ok ? canSign.reason : blocked ? 'Ada kontraindikasi absolut — tidak dapat ditandatangani.' : '',
        onclick: function () {
          clinic.savePrescription(v.id, items)
            .then(function (res) { return clinic.signPrescription(res.prescription.id, { overrideReason: overrideReason }); })
            .then(function (res) {
              say(res.ok ? 'Resep ditandatangani. Kirim pasien ke farmasi.' : res.reason, res.ok ? 'good' : 'err');
              if (res.ok) { rxDraftVisit = null; }
              persist(); renderAll();
            });
        }
      }, 'Tandatangani resep')));

    if (blocked) {
      card.appendChild(h('div', { class: 'denied' },
        h('b', { text: 'Tanda tangan diblokir. ' }),
        'Kontraindikasi absolut tidak dapat di-override dengan alasan apa pun. Ganti obatnya.'));
    }
    if (!canSign.ok) card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), canSign.reason));
    return card;
  }

  function safetyPanel(safety, itemCount) {
    var box = h('div', {});
    box.appendChild(h('h4', { class: 'rxhead', text: 'Telaah keamanan' }));
    if (!itemCount) {
      box.appendChild(h('p', { class: 'small muted', text: 'Belum ada obat untuk ditelaah.' }));
      return box;
    }
    if (!safety.findings.length) {
      box.appendChild(h('div', { class: 'finding minor' },
        h('div', { class: 'fhead' }, h('span', { class: 'sev', text: 'bersih' }), h('span', { class: 'ftitle', text: 'Tidak ada temuan' })),
        h('div', { class: 'fwhy', text: 'Tidak ditemukan interaksi, duplikasi golongan, kontraindikasi usia/kehamilan atau benturan alergi pada kombinasi ini.' })));
      return box;
    }
    safety.findings.forEach(function (f) {
      box.appendChild(h('div', { class: 'finding ' + f.sev },
        h('div', { class: 'fhead' },
          h('span', { class: 'sev', text: f.sev }),
          h('span', { class: 'ftitle', text: f.title })),
        h('div', { class: 'fwhy', text: f.why }),
        h('div', { class: 'fact', text: f.act })));
    });
    box.appendChild(h('p', { class: 'small muted' },
      'Kontraindikasi menolak tanda tangan tanpa jalan keluar. Mayor memerlukan alasan klinis tertulis yang ikut masuk ' +
      'ke jejak audit. Moderat dan minor bersifat memberi tahu. Basis aturan ini adalah demonstrasi bentuk telaah, ' +
      'bukan rujukan klinis — sistem nyata memakai basis data interaksi berlisensi yang dipelihara terus-menerus.'));
    return box;
  }

  /* =====================================================================
   * Panel: Farmasi
   * ===================================================================== */

  function renderFarmasi(panel) {
    var can = D.can(clinic.actor.role, 'resep.lihat');
    if (!can.ok) {
      panel.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Akses ditolak. ' }), can.reason));
      panel.appendChild(h('p', { class: 'note', text: 'Beralih ke peran Apoteker untuk melihat modul farmasi.' }));
      return;
    }

    panel.appendChild(h('div', { class: 'claim' },
      h('b', { text: 'Apoteker melihat diagnosis dan alergi, tetapi tidak melihat narasi subjektif. ' }),
      'Telaah resep tidak mungkin dilakukan tanpa mengetahui indikasi dan alergi; keterangan pribadi pasien di ' +
      'bagian Subjective tidak menambah apa pun pada telaah itu. Itu prinsip minimum necessary, diterapkan per bidang, ' +
      'bukan per layar.'));

    var pending = clinic.state.prescriptions.filter(function (p) {
      return ['signed', 'ditelaah'].indexOf(p.status) >= 0;
    }).sort(function (a, b) { return (a.signedAt || '') < (b.signedAt || '') ? -1 : 1; });

    if (!pending.length) {
      panel.appendChild(h('p', { class: 'empty', text: 'Tidak ada resep yang menunggu. Tandatangani resep dari tab Konsultasi untuk melihat alurnya.' }));
    }

    pending.forEach(function (rx) {
      var v = clinic.visit(rx.visitId);
      var p = clinic.patient(rx.rmNumber);
      var enc = clinic.encounterForVisit(rx.visitId);
      var card = h('div', { class: 'card' });
      card.appendChild(h('div', { class: 'row-between' },
        h('h3', { text: rx.id + ' · ' + (p ? p.name : rx.rmNumber) + ' (' + rx.rmNumber + ')' }),
        h('span', { class: 'pill ' + (rx.status === 'ditelaah' ? 'warn' : ''), text: rx.status })));
      card.appendChild(h('p', { class: 'small muted', text: (v ? v.queueNo + ' · ' + fmtDate(v.date) : '') + ' · ditandatangani ' + ((clinic.staff(rx.signedBy) || {}).name || '—') + ' ' + fmtTime(rx.signedAt) }));

      if (p && p.allergies.length) {
        card.appendChild(h('div', { class: 'alert-allergy' },
          h('b', { text: 'ALERGI: ' }),
          p.allergies.map(function (a) {
            var c = R.rx.allergyClasses.filter(function (x) { return x.id === a; })[0];
            return c ? c.label : a;
          }).join(', ')));
      }
      if (enc) {
        var eff = clinic.effective(enc.id);
        card.appendChild(h('p', { class: 'small' },
          h('b', { text: 'Indikasi: ' }),
          (eff.values.a || []).map(function (d) { return R.icd.label(d.code); }).join(' · ') || '—'));
      }

      card.appendChild(rxView(rx));

      var ctx = clinic.rxContext(rx.visitId);
      card.appendChild(safetyPanel(R.rx.check(rx.items, ctx), rx.items.length));

      var note = h('input', { type: 'text', placeholder: 'Catatan telaah / substitusi', 'aria-label': 'Catatan telaah' });
      var canReview = D.can(clinic.actor.role, 'resep.telaah');
      var canDispense = D.can(clinic.actor.role, 'resep.serahkan');
      card.appendChild(h('div', { class: 'field' }, h('label', { text: 'Catatan' }), note));
      card.appendChild(h('div', { class: 'controls' },
        h('button', {
          type: 'button', class: 'btn primary',
          disabled: !canReview.ok || rx.status !== 'signed',
          title: !canReview.ok ? canReview.reason : rx.status !== 'signed' ? 'Telaah sudah dilakukan.' : '',
          onclick: function () {
            clinic.reviewPrescription(rx.id, note.value).then(function (res) {
              say(res.ok ? 'Telaah resep dicatat.' : res.reason, res.ok ? 'good' : 'err');
              persist(); renderAll();
            });
          }
        }, 'Selesai telaah'),
        h('button', {
          type: 'button', class: 'btn primary',
          disabled: !canDispense.ok || rx.status !== 'ditelaah',
          title: !canDispense.ok ? canDispense.reason : rx.status !== 'ditelaah' ? 'Obat hanya boleh diserahkan setelah telaah.' : '',
          onclick: function () {
            clinic.dispense(rx.id, { note: note.value }).then(function (res) {
              if (!res.ok) { say(res.reason, 'err'); persist(); renderAll(); return; }
              return clinic.transition(rx.visitId, 'kasir').then(function (t) {
                say('Obat diserahkan. ' + (t.ok ? 'Pasien diarahkan ke kasir.' : t.reason), t.ok ? 'good' : 'err');
                persist(); renderAll();
              });
            });
          }
        }, 'Serahkan obat & kirim ke kasir')));
      if (!canReview.ok) card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), canReview.reason));
      panel.appendChild(card);
    });
  }

  /* =====================================================================
   * Panel: Kasir
   * ===================================================================== */

  function renderKasir(panel) {
    var can = D.can(clinic.actor.role, 'kasir.lihat');
    if (!can.ok) {
      panel.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Akses ditolak. ' }), can.reason));
      return;
    }
    panel.appendChild(h('div', { class: 'claim' },
      h('b', { text: 'BPJS di FKTP dibayar per kapitasi, bukan per kunjungan. ' }),
      'Klinik menerima pembayaran bulanan per peserta terdaftar, hadir atau tidak, sehingga pasien BPJS tidak ' +
      'membayar apa pun di loket untuk layanan yang dijamin dan tidak ada klaim per kunjungan yang diajukan. ' +
      'Yang dibayar pasien adalah IUR BIAYA atas hal di luar jaminan: obat non-formularium, skeling kosmetik, ' +
      'surat sehat untuk melamar kerja. Karena itu tagihan punya dua angka yang berbeda: nilai tarif dan ' +
      'yang benar-benar dibayar di loket.'));

    var atKasir = clinic.state.visits.filter(function (v) { return v.status === 'kasir'; });
    if (!atKasir.length) panel.appendChild(h('p', { class: 'empty', text: 'Tidak ada pasien di kasir.' }));

    atKasir.forEach(function (v) {
      var p = clinic.patient(v.rmNumber);
      var bill = D.computeBill(v, clinic.prescriptionForVisit(v.id));
      var card = h('div', { class: 'card' });
      card.appendChild(h('h3', { text: v.queueNo + ' · ' + (p ? p.name : v.rmNumber) + ' (' + v.rmNumber + ')' }));
      card.appendChild(billView(bill));
      var canClose = D.can(clinic.actor.role, 'kasir.tutup');
      card.appendChild(h('div', { class: 'controls' }, h('button', {
        type: 'button', class: 'btn primary', disabled: !canClose.ok, title: canClose.ok ? '' : canClose.reason,
        onclick: function () {
          clinic.closeBill(v.id).then(function (res) {
            if (!res.ok) { say(res.reason, 'err'); persist(); renderAll(); return; }
            return clinic.transition(v.id, 'selesai').then(function () {
              say('Tagihan ditutup dan kunjungan diselesaikan.', 'good');
              persist(); renderAll();
            });
          });
        }
      }, 'Tutup tagihan & selesaikan kunjungan')));
      if (!canClose.ok) card.appendChild(h('div', { class: 'denied' }, h('b', { text: 'Ditolak. ' }), canClose.reason));
      panel.appendChild(card);
    });

    var closed = clinic.state.visits.filter(function (v) { return v.billing && v.date === today(); });
    if (closed.length) {
      var card2 = h('div', { class: 'card' });
      card2.appendChild(h('h3', { text: 'Tagihan tertutup hari ini (' + closed.length + ')' }));
      var totalTarif = 0, totalBpjs = 0, totalPasien = 0;
      closed.forEach(function (v) {
        totalTarif += v.billing.totalTarif;
        totalBpjs += v.billing.ditanggung;
        totalPasien += v.billing.dibayarPasien;
      });
      card2.appendChild(h('dl', { class: 'kv' },
        h('dt', { text: 'Nilai tarif seluruh layanan' }), h('dd', { class: 'mono', text: D.rupiah(totalTarif) }),
        h('dt', { text: 'Ditanggung kapitasi BPJS' }), h('dd', { class: 'mono', text: D.rupiah(totalBpjs) }),
        h('dt', { text: 'Diterima tunai di loket' }), h('dd', { class: 'mono', text: D.rupiah(totalPasien) })));
      panel.appendChild(card2);
    }
  }

  /* =====================================================================
   * Panel: Jejak Audit
   * ===================================================================== */

  var auditFilter = '';

  function renderAudit(panel) {
    panel.appendChild(h('div', { class: 'claim' },
      h('b', { text: 'Mengapa rantai hash, bukan tabel log. ' }),
      'Rekam medis wajib dapat dikoreksi tetapi tidak boleh dapat ditulis ulang diam-diam. Sebuah tabel log memenuhi ' +
      'syarat itu hanya selama tidak ada orang yang menyunting tabelnya. Setiap entri di bawah membawa hash entri ' +
      'sebelumnya, jadi menyunting entri #7 membatalkan #7 dan seluruh entri sesudahnya. Itu tidak membuat perusakan ' +
      'mustahil — yang bisa menyunting baris 7 pada prinsipnya bisa menghitung ulang 8..n — tetapi membuat perusakan ' +
      'DIAM-DIAM mustahil, dan dalam sengketa justru sifat itulah yang berguna. Sistem produksi menambatkan hash ' +
      'kepala ke tempat di luar kendali klinik (ditandatangani kunci server, atau dipublikasikan harian); demo ini ' +
      'memverifikasi di dalam tab dan menyatakannya apa adanya.'));

    var state = h('div', { class: 'chainstate' + (chainVerdict ? (chainVerdict.ok ? ' good' : ' bad') : '') });
    state.appendChild(h('span', {
      class: 'verdict',
      text: chainVerdict ? (chainVerdict.ok ? 'RANTAI UTUH' : 'RANTAI RUSAK') : 'BELUM DIVERIFIKASI'
    }));
    state.appendChild(h('span', { class: 'detail' },
      chainVerdict
        ? (chainVerdict.ok
          ? chainVerdict.checked + ' entri diperiksa dari genesis. Hash kepala: ' + A.short(chainVerdict.head) +
            ' — dihitung dengan ' + A.hashBackend() + '.'
          : chainVerdict.reason)
        : 'Tekan "Verifikasi rantai" untuk menelusuri seluruh entri dari genesis dan menghitung ulang setiap hash.'));
    panel.appendChild(state);

    var controls = h('div', { class: 'controls' },
      h('button', {
        type: 'button', class: 'btn primary',
        onclick: function () { verifyFromDisk(); }
      }, 'Verifikasi rantai (baca ulang dari IndexedDB)'),
      h('button', {
        type: 'button', class: 'btn danger',
        title: 'Menulis entri yang sudah diubah langsung ke object store IndexedDB, melewati aplikasi.',
        onclick: function () { tamperDemo(); }
      }, 'Rusak satu entri di basis data'),
      h('button', {
        type: 'button', class: 'btn',
        onclick: function () {
          R.store.resetPersistedCount();
          R.store.wipe().then(function () { return R.store.save(clinic); }).then(function () {
            tampered = false;
            say('Basis data ditulis ulang dari state di memori. Verifikasi lagi untuk melihatnya utuh kembali.', 'good');
            verifyFromDisk();
          });
        }
      }, 'Pulihkan dari memori'));
    panel.appendChild(controls);

    if (tampered) {
      panel.appendChild(h('div', { class: 'denied' },
        h('b', { text: 'Basis data sedang dalam keadaan dirusak. ' }),
        'Satu entri audit yang tersimpan telah diubah langsung di IndexedDB, tanpa melalui aplikasi — persis serangan ' +
        'yang seharusnya ditangkap oleh rantai. Tekan "Verifikasi rantai" untuk melihat titik putusnya, lalu ' +
        '"Pulihkan dari memori" untuk mengembalikannya.'));
    }

    var card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'row-between' },
      h('h3', { text: 'Entri (' + clinic.chain.entries.length + ')' }),
      h('input', {
        type: 'search', value: auditFilter, placeholder: 'Saring: aksi, pelaku, entitas…', 'aria-label': 'Saring jejak audit',
        oninput: function (ev) { auditFilter = ev.target.value; renderPanelOnly('audit', true); }
      })));

    var brokenSeq = chainVerdict && !chainVerdict.ok && chainVerdict.entry ? chainVerdict.entry.seq : -1;
    var q = auditFilter.toLowerCase().trim();
    var rows = clinic.chain.entries.slice().reverse().filter(function (e) {
      if (!q) return true;
      return (e.action + ' ' + e.actorName + ' ' + e.actorRole + ' ' + e.entity + ' ' + e.entityId + ' ' + e.summary).toLowerCase().indexOf(q) >= 0;
    });

    if (!rows.length) card.appendChild(h('p', { class: 'empty', text: 'Tidak ada entri yang cocok.' }));

    /* The list is newest-first and capped, but a break can be anywhere in a
     * 600-entry chain. Reporting "rantai rusak pada #318" and then not showing
     * #318 would make the verification unfalsifiable, so the broken row is
     * pulled to the top — and it is the row AS STORED ON DISK, not the clean
     * copy still in memory, because the difference between the two is the
     * entire thing being demonstrated. */
    var shown = rows.slice(0, 120);
    if (brokenSeq >= 0) {
      shown = shown.filter(function (e) { return e.seq !== brokenSeq; });
      shown = [chainVerdict.entry].concat(shown.slice(0, 119));
      card.appendChild(h('p', { class: 'small muted', text: 'Entri #' + brokenSeq + ' ditarik ke atas — di situlah rantai putus. Yang ditampilkan adalah baris sebagaimana tersimpan di basis data.' }));
    }

    shown.forEach(function (e) {
      card.appendChild(h('div', { class: 'aentry' + (e.seq === brokenSeq ? ' broken' : '') },
        h('span', { class: 'aseq', text: '#' + e.seq }),
        h('span', { class: 'awho' },
          h('div', { text: e.actorName }),
          h('div', { class: 'small muted', text: D.roleLabel(e.actorRole) }),
          h('div', { class: 'small muted', text: fmtDateTime(e.at) })),
        h('span', { class: 'abody' },
          h('div', {}, h('span', { class: 'aact', text: e.action }), ' ', h('span', { text: e.summary })),
          h('div', { class: 'ahash', text: 'prev ' + A.short(e.prevHash) + '  ·  hash ' + A.short(e.hash) }),
          e.detail ? h('details', { class: 'more' },
            h('summary', { text: 'detail' }),
            h('pre', { class: 'small', text: JSON.stringify(e.detail, null, 2) })) : null)));
    });
    if (rows.length > 120) card.appendChild(h('p', { class: 'small muted', text: 'Menampilkan 120 dari ' + rows.length + ' entri. Gunakan kotak saring di atas.' }));
    panel.appendChild(card);
  }

  function verifyFromDisk() {
    say('Memverifikasi…', '');
    renderPanelOnly('audit');
    R.store.readAudit().then(function (res) {
      var entries = res.ok && res.entries.length ? res.entries : clinic.chain.entries;
      var source = res.ok && res.entries.length ? 'IndexedDB' : 'memori (basis data tidak terbaca)';
      return A.verify(entries).then(function (v) {
        chainVerdict = v;
        say(v.ok
          ? 'Rantai terverifikasi dari ' + source + ': ' + v.checked + ' entri, tidak ada penyimpangan.'
          : 'Rantai PUTUS pada entri #' + (v.entry ? v.entry.seq : '?') + ' — ' + v.reason,
          v.ok ? 'good' : 'err');
        renderAll();
      });
    });
  }

  function tamperDemo() {
    var target = Math.max(1, Math.floor(clinic.chain.entries.length / 2));
    R.store.save(clinic).then(function () {
      return R.store.tamper(target, function (row) {
        row.summary = row.summary + ' [DIUBAH LANGSUNG DI BASIS DATA]';
      });
    }).then(function (res) {
      if (!res.ok) { say('Tidak dapat merusak entri: ' + res.reason, 'err'); renderAll(); return; }
      tampered = true;
      chainVerdict = null;
      say('Entri #' + target + ' diubah langsung di IndexedDB, melewati aplikasi. Tekan "Verifikasi rantai".', 'err');
      renderAll();
    });
  }

  /* =====================================================================
   * Panel: Uji
   * ===================================================================== */

  function renderUji(panel) {
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Asersi dalam halaman' }));
    card.appendChild(h('p', { class: 'note' },
      'Berkas yang sama dijalankan di halaman ini dan di bawah node, dari sumber yang sama. Yang hijau di sini ' +
      'adalah rangkaian uji yang menggerbangi kodenya. Asersi yang paling menentukan: No. RM tidak pernah dipakai ' +
      'ulang bahkan setelah pasiennya dihapus; antrian menolak transisi tidak sah, peran salah dan penjaga yang ' +
      'belum terpenuhi dengan tiga alasan berbeda; rantai audit menemukan entri yang disunting, dihapus dan ditukar ' +
      'urutannya; adendum menggantikan tanpa memusnahkan nilai asli.'));

    var sum = h('div', { class: 'test-summary' });
    if (testRunning) {
      sum.appendChild(h('span', { class: 'pillbig run', text: 'MENJALANKAN…' }));
    } else if (testRun) {
      sum.appendChild(h('span', {
        class: 'pillbig ' + (testRun.failed ? 'fail' : 'pass'),
        text: testRun.failed ? testRun.failed + ' GAGAL' : testRun.passed + ' LULUS'
      }));
      sum.appendChild(h('span', { class: 'small muted', text: testRun.passed + ' dari ' + testRun.total + ' asersi pada ' + testRun.groups + ' kelompok.' }));
    } else {
      sum.appendChild(h('span', { class: 'pillbig run', text: 'BELUM DIJALANKAN' }));
    }
    sum.appendChild(h('button', {
      type: 'button', class: 'btn small', disabled: testRunning,
      onclick: function () { runSuite(); }
    }, 'Jalankan ulang'));
    card.appendChild(sum);

    if (testRun) {
      var byGroup = {}, order = [];
      testRun.results.forEach(function (r) {
        if (!byGroup[r.group]) { byGroup[r.group] = []; order.push(r.group); }
        byGroup[r.group].push(r);
      });
      order.forEach(function (g) {
        var list = byGroup[g];
        var failed = list.filter(function (r) { return !r.ok; }).length;
        var box = h('div', { class: 'tgroup' });
        box.appendChild(h('h4', { text: g + '  ' + (list.length - failed) + '/' + list.length }));
        list.forEach(function (r) {
          box.appendChild(h('div', { class: 'tcase ' + (r.ok ? 'ok' : 'no') },
            h('span', { class: 'mk', text: r.ok ? '✓' : '✗' }),
            h('span', { text: r.name }),
            r.ok ? null : h('span', { class: 'msg', text: r.message })));
        });
        card.appendChild(box);
      });
    }
    panel.appendChild(card);
  }

  function runSuite() {
    testRunning = true;
    testRun = null;
    renderPanelOnly('uji');
    R.runTests().then(function (res) {
      testRun = res;
      testRunning = false;
      renderPanelOnly('uji');
      renderSummary();
    }).catch(function (e) {
      testRunning = false;
      testRun = { results: [{ group: 'runner', name: 'rangkaian uji melempar kesalahan', ok: false, message: String(e && e.stack || e) }], passed: 0, failed: 1, total: 1, groups: 1 };
      renderPanelOnly('uji');
    });
  }

  /* =====================================================================
   * Render orchestration
   * ===================================================================== */

  var RENDERERS = {
    antrian: renderAntrian, pendaftaran: renderPendaftaran, rekam: renderRekam,
    konsultasi: renderKonsultasi, farmasi: renderFarmasi, kasir: renderKasir,
    audit: renderAudit, uji: renderUji
  };

  function renderPanel(name) { renderPanelOnly(name); }

  // keepFocus: when a keystroke triggered the re-render, put the caret back in
  // the search box the user was typing into rather than dropping it.
  function renderPanelOnly(name, keepFocus) {
    var panel = $('panel-' + name);
    var activeEl = document.activeElement;
    var focusSel = null, caret = null;
    if (keepFocus && activeEl && panel.contains(activeEl) && activeEl.tagName === 'INPUT') {
      focusSel = activeEl.getAttribute('aria-label');
      caret = activeEl.selectionStart;
    }
    var scroll = window.scrollY;
    clear(panel);

    if (toast.text) {
      panel.appendChild(h('p', { class: 'status ' + toast.tone, role: 'status', 'aria-live': 'polite', text: toast.text }));
    }
    try {
      RENDERERS[name](panel);
    } catch (e) {
      panel.appendChild(h('div', { class: 'empty', text: 'Tampilan ini gagal dirender: ' + (e && e.message) }));
      if (window.console) console.error(e);
    }
    if (focusSel) {
      var again = panel.querySelector('input[aria-label="' + focusSel.replace(/"/g, '\\"') + '"]');
      if (again) {
        again.focus();
        try { again.setSelectionRange(caret, caret); } catch (e2) { /* number inputs refuse */ }
      }
    }
    window.scrollTo(0, scroll);
  }

  function renderAll() {
    renderRoles();
    renderSummary();
    renderPanelOnly(active);
  }

  /* =====================================================================
   * Boot
   * ===================================================================== */

  function boot() {
    renderNet();
    R.store.load().then(function (res) {
      if (res.ok && res.state && res.state.patients && res.state.patients.length) {
        clinic = new R.Clinic({ state: res.state, auditEntries: res.auditEntries });
        clinic.state.staff = R.seed.STAFF.slice();
        say('Data dimuat dari IndexedDB tab ini (' + res.state.patients.length + ' pasien, ' + res.auditEntries.length + ' entri audit).', '');
        return clinic;
      }
      return R.seed.build({ today: new Date(), seed: 20260908 }).then(function (c) {
        clinic = c;
        say('Klinik contoh dibangkitkan dari PRNG bersemai. Seluruh data fiktif.', '');
        return R.store.save(clinic).then(function (s) {
          if (!s.ok) {
            showStoreWarning('IndexedDB tidak tersedia (' + s.reason + '). Aplikasi berjalan sepenuhnya dari memori — ' +
              'semuanya tetap berfungsi, tetapi hilang saat tab ditutup dan tombol perusakan basis data tidak dapat dipakai.');
          }
          return clinic;
        });
      });
    }).then(function () {
      var savedRole = R.store.prefGet('role', null);
      if (savedRole && clinic.staff(savedRole)) clinic.setActor(savedRole);
      else clinic.setActor('stf-03');

      // Focus the visit a doctor would actually be looking at.
      var t = today();
      var inConsult = clinic.state.visits.filter(function (v) { return v.date === t && v.status === 'konsultasi'; })[0];
      var waiting = clinic.state.visits.filter(function (v) { return v.date === t && v.status === 'menunggu-dokter'; })[0];
      var pick = inConsult || waiting || clinic.state.visits.filter(function (v) { return v.date === t; })[0];
      if (pick) { selVisit = pick.id; selRM = pick.rmNumber; }

      clinic.onChange = null;
      renderAll();
      // The suite and the chain check run unprompted, so the two claims a
      // reviewer would most want checked are already answered on arrival.
      runSuite();
      verifyFromDisk();
    }).catch(function (e) {
      if (window.console) console.error(e);
      var panel = $('panel-antrian');
      clear(panel);
      panel.appendChild(h('div', { class: 'empty', text: 'Gagal memulai aplikasi: ' + (e && e.message) }));
    });
  }

  boot();
})();
