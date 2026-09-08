/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — domain.js
 * The clinic model. No DOM, no storage, no rendering — everything here is
 * testable in node, and tests.js does exactly that.
 *
 * The modelling calls that matter, stated up front because they are the point
 * of this lab:
 *
 * 1. THREE DIFFERENT NUMBERS, THREE DIFFERENT LIFETIMES.
 *    No. RM      one per PATIENT, allocated once, never reused, never reissued.
 *    No. antrian one per VISIT per DAY per poli, resets every morning, reused
 *                every day, and meaningless outside today.
 *    ID kunjungan one per VISIT, unique forever, is what clinical records hang
 *                off.
 *    Conflating any two of these is the classic beginner error, and it is not
 *    a cosmetic one: reusing an RM merges two people's histories, and hanging
 *    a record off a queue number loses it at midnight.
 *
 * 2. THE RECORD IS THE HISTORY, NOT THE CURRENT STATE.
 *    A patient row holds identity and standing facts (allergies, chronic
 *    problems). Everything episodic — complaint, vitals, diagnosis, plan —
 *    lives on an encounter. Editing "the patient's diagnosis" is not a thing
 *    that exists in this model.
 *
 * 3. SIGNED MEANS FROZEN.
 *    An unsigned encounter is a draft and is freely editable. Signing is
 *    irreversible; after it, the only way to change anything is an addendum
 *    that supersedes without deleting. Both versions stay visible.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});

  /* =====================================================================
   * Identifiers
   * ===================================================================== */

  var RM_WIDTH = 6;

  function formatRM(n) {
    var s = String(n);
    while (s.length < RM_WIDTH) s = '0' + s;
    return 'RM-' + s;
  }

  function parseRM(rm) {
    var m = /^RM-(\d+)$/.exec(String(rm || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  var POLI = [
    { id: 'umum', label: 'Poli Umum', prefix: 'A', konsul: 40000 },
    { id: 'gigi', label: 'Poli Gigi', prefix: 'B', konsul: 65000 },
    { id: 'kia', label: 'KIA / KB', prefix: 'C', konsul: 40000 }
  ];
  var POLI_BY_ID = {};
  POLI.forEach(function (p) { POLI_BY_ID[p.id] = p; });

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  /* =====================================================================
   * Queue state machine
   * ===================================================================== */

  /* Each state names the transitions out of it, who may perform them, and
   * (where it exists) a guard that inspects the visit and refuses with a
   * reason. Refusal always says WHY — "peran salah", "belum ada tanda
   * tangan", "vital sign belum diisi" — because a queue board that silently
   * ignores a click is the single most common complaint about clinic
   * software. */
  var QUEUE = {
    'terdaftar': {
      label: 'Terdaftar',
      hint: 'Pasien sudah mendapat nomor antrian dan menunggu dipanggil ke triase.',
      next: {
        'triase': { roles: ['pendaftaran', 'perawat'] },
        'batal': { roles: ['pendaftaran'] }
      }
    },
    'triase': {
      label: 'Triase',
      hint: 'Perawat mengukur tanda vital dan menetapkan tingkat kegawatan.',
      next: {
        'menunggu-dokter': {
          roles: ['perawat'],
          guard: function (v) {
            var t = v.triage;
            if (!t || t.tdSistol == null || t.nadi == null || t.suhu == null) {
              return 'Tanda vital belum lengkap. Minimal tekanan darah, nadi dan suhu harus terisi sebelum pasien masuk daftar tunggu dokter.';
            }
            if (!t.acuity) return 'Tingkat kegawatan (triase) belum ditetapkan.';
            return null;
          }
        },
        'batal': { roles: ['pendaftaran'] }
      }
    },
    'menunggu-dokter': {
      label: 'Menunggu dokter',
      hint: 'Antrian poli. Dokter memanggil pasien dari daftar ini.',
      next: {
        'konsultasi': {
          roles: ['dokter'],
          guard: function (v) {
            return v.doctorId ? null : 'Belum ada dokter yang ditugaskan pada kunjungan ini.';
          }
        },
        'tidak-hadir': { roles: ['pendaftaran', 'perawat'] },
        'batal': { roles: ['pendaftaran'] }
      }
    },
    'konsultasi': {
      label: 'Dalam konsultasi',
      hint: 'Dokter mengisi SOAP, memberi kode diagnosis dan menuliskan resep.',
      next: {
        'farmasi': {
          roles: ['dokter'],
          guard: function (v, ctx) {
            if (!ctx.encounter || ctx.encounter.status !== 'signed') {
              return 'Catatan SOAP belum ditandatangani. Kunjungan tidak boleh berpindah ke farmasi dengan rekam medis yang masih berstatus draf.';
            }
            if (!ctx.prescription || ctx.prescription.status !== 'signed') {
              return 'Belum ada resep yang ditandatangani. Bila memang tidak ada resep, arahkan pasien langsung ke kasir.';
            }
            return null;
          }
        },
        'kasir': {
          roles: ['dokter'],
          guard: function (v, ctx) {
            if (!ctx.encounter || ctx.encounter.status !== 'signed') {
              return 'Catatan SOAP belum ditandatangani.';
            }
            if (ctx.prescription && ctx.prescription.status === 'signed') {
              return 'Kunjungan ini punya resep yang sudah ditandatangani — pasien harus melewati farmasi terlebih dahulu.';
            }
            return null;
          }
        }
      }
    },
    'farmasi': {
      label: 'Farmasi',
      hint: 'Apoteker melakukan telaah resep, menyiapkan dan menyerahkan obat.',
      next: {
        'kasir': {
          roles: ['apoteker'],
          guard: function (v, ctx) {
            if (!ctx.prescription) return 'Tidak ada resep pada kunjungan ini.';
            if (ctx.prescription.status !== 'diserahkan') {
              return 'Obat belum diserahkan. Status resep saat ini: ' + ctx.prescription.status + '.';
            }
            return null;
          }
        }
      }
    },
    'kasir': {
      label: 'Kasir',
      hint: 'Penyelesaian tagihan. Pasien BPJS di FKTP tidak membayar layanan yang dijamin.',
      next: {
        'selesai': { roles: ['pendaftaran'] }
      }
    },
    'selesai': { label: 'Selesai', hint: 'Kunjungan tertutup. Rekam medis hanya dapat dikoreksi lewat adendum.', next: {}, terminal: true },
    'batal': { label: 'Batal', hint: 'Kunjungan dibatalkan sebelum pelayanan.', next: {}, terminal: true },
    'tidak-hadir': {
      label: 'Tidak hadir',
      hint: 'Pasien dipanggil tetapi tidak ada di tempat. Bisa didaftarkan ulang hari ini.',
      next: { 'terdaftar': { roles: ['pendaftaran'] } }
    }
  };

  var QUEUE_ORDER = ['terdaftar', 'triase', 'menunggu-dokter', 'konsultasi', 'farmasi', 'kasir', 'selesai'];

  /**
   * canTransition(visit, to, role, ctx) -> { ok, reason?, code? }
   * Pure. Does not mutate anything.
   */
  function canTransition(visit, to, role, ctx) {
    ctx = ctx || {};
    var from = visit.status;
    var node = QUEUE[from];
    if (!node) return { ok: false, code: 'unknown-state', reason: 'Status "' + from + '" tidak dikenal.' };
    if (node.terminal) {
      return {
        ok: false, code: 'terminal',
        reason: 'Kunjungan sudah berstatus "' + node.label + '" dan tidak dapat diubah lagi. Koreksi terhadap rekam medis dilakukan lewat adendum, bukan dengan membuka kembali antrian.'
      };
    }
    var edge = node.next[to];
    if (!edge) {
      var allowed = Object.keys(node.next);
      return {
        ok: false, code: 'invalid-transition',
        reason: 'Perpindahan "' + node.label + '" → "' + (QUEUE[to] ? QUEUE[to].label : to) +
          '" tidak ada di alur. Dari "' + node.label + '" hanya bisa ke: ' +
          (allowed.length ? allowed.map(function (s) { return QUEUE[s].label; }).join(', ') : '(tidak ada)') + '.'
      };
    }
    if (edge.roles.indexOf(role) < 0) {
      return {
        ok: false, code: 'role',
        reason: 'Peran "' + roleLabel(role) + '" tidak berwenang melakukan perpindahan ini. Diperlukan: ' +
          edge.roles.map(roleLabel).join(' atau ') + '.'
      };
    }
    if (edge.guard) {
      var why = edge.guard(visit, ctx);
      if (why) return { ok: false, code: 'guard', reason: why };
    }
    return { ok: true };
  }

  /* =====================================================================
   * Roles
   * ===================================================================== */

  var ROLES = [
    {
      id: 'pendaftaran', label: 'Pendaftaran / Admin',
      blurb: 'Mendaftarkan pasien, mengalokasikan No. RM, membuka kunjungan dan menutup tagihan. Tidak boleh membaca isi catatan klinis.'
    },
    {
      id: 'perawat', label: 'Perawat (Triase)',
      blurb: 'Mengukur tanda vital, menetapkan tingkat kegawatan dan meneruskan pasien ke antrian dokter.'
    },
    {
      id: 'dokter', label: 'Dokter',
      blurb: 'Menulis dan menandatangani SOAP, memberi kode ICD-10, menulis resep, dan membuat adendum atas catatannya sendiri.'
    },
    {
      id: 'apoteker', label: 'Apoteker',
      blurb: 'Menelaah resep, menyiapkan dan menyerahkan obat. Melihat diagnosis dan alergi (dibutuhkan untuk telaah) tetapi bukan seluruh isi SOAP.'
    }
  ];
  var ROLE_BY_ID = {};
  ROLES.forEach(function (r) { ROLE_BY_ID[r.id] = r; });
  function roleLabel(id) { return ROLE_BY_ID[id] ? ROLE_BY_ID[id].label : id; }

  /* Access control is stated as data, not scattered through the UI, so that
   * "what can a pharmacist see" has exactly one answer and the test suite can
   * assert on it.
   *
   * The deliberate call: apoteker CAN read assessment (diagnosis codes) and
   * allergies, but NOT the subjective narrative. That is not squeamishness —
   * a pharmacist cannot do a clinical review of a prescription without knowing
   * the indication, and giving them the patient's account of their marital
   * problems serves no purpose. Minimum necessary, per-field. */
  var PERMISSIONS = {
    'pasien.daftar': ['pendaftaran'],
    'pasien.ubah-demografi': ['pendaftaran'],
    'pasien.lihat-demografi': ['pendaftaran', 'perawat', 'dokter', 'apoteker'],
    'pasien.lihat-alergi': ['pendaftaran', 'perawat', 'dokter', 'apoteker'],
    'kunjungan.buka': ['pendaftaran'],
    'antrian.lihat': ['pendaftaran', 'perawat', 'dokter', 'apoteker'],
    'triase.isi': ['perawat'],
    'soap.lihat-subjektif': ['perawat', 'dokter'],
    'soap.lihat-objektif': ['perawat', 'dokter'],
    'soap.lihat-asesmen': ['perawat', 'dokter', 'apoteker'],
    'soap.lihat-plan': ['perawat', 'dokter', 'apoteker'],
    'soap.tulis': ['dokter'],
    'soap.tandatangani': ['dokter'],
    'soap.addendum': ['dokter', 'perawat'],
    'resep.tulis': ['dokter'],
    'resep.tandatangani': ['dokter'],
    'resep.lihat': ['dokter', 'apoteker'],
    'resep.telaah': ['apoteker'],
    'resep.serahkan': ['apoteker'],
    'kasir.lihat': ['pendaftaran', 'apoteker'],
    'kasir.tutup': ['pendaftaran'],
    'audit.lihat': ['pendaftaran', 'perawat', 'dokter', 'apoteker'],
    'audit.verifikasi': ['pendaftaran', 'perawat', 'dokter', 'apoteker']
  };

  function can(role, perm) {
    var allowed = PERMISSIONS[perm];
    if (!allowed) return { ok: false, reason: 'Izin "' + perm + '" tidak terdaftar.' };
    if (allowed.indexOf(role) >= 0) return { ok: true };
    return {
      ok: false,
      reason: 'Peran ' + roleLabel(role) + ' tidak memiliki izin "' + perm + '". Izin ini dimiliki oleh: ' +
        allowed.map(roleLabel).join(', ') + '.'
    };
  }

  /* =====================================================================
   * Vitals interpretation
   * ===================================================================== */

  /* BMI cut-offs are the WHO ASIA-PACIFIC ones, not the global WHO ones.
   * Overweight starts at 23 and obesity at 25, not 25 and 30, because
   * cardiometabolic risk rises at a lower BMI in Asian populations. This is
   * what Kemenkes guidance uses, and a clinic system shipped in Indonesia that
   * calls a BMI of 26 "overweight" is telling the doctor the wrong thing. */
  var BMI_BANDS = [
    { max: 18.5, label: 'Berat badan kurang', tone: 'warn' },
    { max: 23, label: 'Normal', tone: 'ok' },
    { max: 25, label: 'Berisiko (overweight, kriteria Asia-Pasifik)', tone: 'warn' },
    { max: 30, label: 'Obesitas I', tone: 'bad' },
    { max: Infinity, label: 'Obesitas II', tone: 'bad' }
  ];

  function bmi(kg, cm) {
    if (!kg || !cm) return null;
    var m = cm / 100;
    return Math.round((kg / (m * m)) * 10) / 10;
  }

  function bmiBand(value) {
    if (value == null) return null;
    for (var i = 0; i < BMI_BANDS.length; i++) {
      if (value < BMI_BANDS[i].max) return BMI_BANDS[i];
    }
    return BMI_BANDS[BMI_BANDS.length - 1];
  }

  function bpBand(sys, dia) {
    if (sys == null || dia == null) return null;
    if (sys >= 180 || dia >= 110) return { label: 'Krisis hipertensi', tone: 'bad', icd: 'I10' };
    if (sys >= 160 || dia >= 100) return { label: 'Hipertensi derajat 2', tone: 'bad', icd: 'I10' };
    if (sys >= 140 || dia >= 90) return { label: 'Hipertensi derajat 1', tone: 'bad', icd: 'I10' };
    if (sys >= 130 || dia >= 85) return { label: 'Normal tinggi (pra-hipertensi)', tone: 'warn', icd: null };
    if (sys < 90 || dia < 60) return { label: 'Hipotensi', tone: 'warn', icd: null };
    return { label: 'Normal', tone: 'ok', icd: null };
  }

  /**
   * flagVitals(t, patientAge) -> [{ key, label, value, tone, note }]
   * Flags only what is outside range; a normal set produces an empty list, so
   * the UI shows abnormalities rather than a wall of green.
   */
  function flagVitals(t, age) {
    var out = [];
    if (!t) return out;
    var bp = bpBand(t.tdSistol, t.tdDiastol);
    if (bp && bp.tone !== 'ok') {
      out.push({ key: 'td', label: 'Tekanan darah', value: t.tdSistol + '/' + t.tdDiastol + ' mmHg', tone: bp.tone, note: bp.label, suggestIcd: bp.icd });
    }
    if (t.nadi != null) {
      if (t.nadi > 100) out.push({ key: 'nadi', label: 'Nadi', value: t.nadi + ' x/menit', tone: 'warn', note: 'Takikardia' });
      else if (t.nadi < 60) out.push({ key: 'nadi', label: 'Nadi', value: t.nadi + ' x/menit', tone: 'warn', note: 'Bradikardia' });
    }
    if (t.suhu != null) {
      if (t.suhu >= 40) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'bad', note: 'Hiperpireksia', suggestIcd: 'R50.9' });
      else if (t.suhu >= 38) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'bad', note: 'Demam', suggestIcd: 'R50.9' });
      else if (t.suhu >= 37.5) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'warn', note: 'Subfebris' });
      else if (t.suhu < 36) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'warn', note: 'Hipotermia' });
    }
    if (t.rr != null) {
      if (t.rr > 24) out.push({ key: 'rr', label: 'Frekuensi napas', value: t.rr + ' x/menit', tone: 'bad', note: 'Takipnea' });
      else if (t.rr > 20) out.push({ key: 'rr', label: 'Frekuensi napas', value: t.rr + ' x/menit', tone: 'warn', note: 'Napas cepat' });
      else if (t.rr < 12) out.push({ key: 'rr', label: 'Frekuensi napas', value: t.rr + ' x/menit', tone: 'warn', note: 'Bradipnea' });
    }
    if (t.spo2 != null) {
      if (t.spo2 < 90) out.push({ key: 'spo2', label: 'SpO₂', value: t.spo2 + ' %', tone: 'bad', note: 'Hipoksemia berat' });
      else if (t.spo2 < 95) out.push({ key: 'spo2', label: 'SpO₂', value: t.spo2 + ' %', tone: 'warn', note: 'Saturasi di bawah normal' });
    }
    var b = bmi(t.bb, t.tb);
    // The Asia-Pacific BMI bands are validated in adults; applying them to a
    // 6-year-old would be wrong, so paediatric anthropometry is deliberately
    // left to a growth chart this demo does not ship.
    if (b != null && (age == null || age >= 18)) {
      var band = bmiBand(b);
      if (band.tone !== 'ok') {
        out.push({ key: 'imt', label: 'IMT', value: b + ' kg/m²', tone: band.tone, note: band.label, suggestIcd: b >= 25 ? 'E66.9' : null });
      }
    }
    return out;
  }

  /* Triage acuity, the three-band scheme a klinik pratama actually runs (an
   * IGD would use five). Suggested from vitals, then confirmed by the nurse —
   * suggested, never auto-applied, because triage is a clinical judgement and
   * a machine that silently downgrades a sick patient is a hazard. */
  var ACUITY = [
    { id: 'merah', label: 'Merah — gawat darurat', tone: 'bad', note: 'Perlu penanganan segera / rujukan.' },
    { id: 'kuning', label: 'Kuning — darurat', tone: 'warn', note: 'Perlu dilihat dokter lebih awal dari antrian.' },
    { id: 'hijau', label: 'Hijau — tidak gawat', tone: 'ok', note: 'Dilayani sesuai urutan antrian.' }
  ];

  function suggestAcuity(t) {
    if (!t) return 'hijau';
    if ((t.spo2 != null && t.spo2 < 90) ||
        (t.tdSistol != null && (t.tdSistol >= 180 || t.tdSistol < 90)) ||
        (t.rr != null && t.rr > 24) ||
        (t.suhu != null && t.suhu >= 40) ||
        (t.nadi != null && (t.nadi > 130 || t.nadi < 45))) return 'merah';
    if ((t.spo2 != null && t.spo2 < 95) ||
        (t.tdSistol != null && t.tdSistol >= 160) ||
        (t.suhu != null && t.suhu >= 38.5) ||
        (t.nadi != null && t.nadi > 110)) return 'kuning';
    return 'hijau';
  }

  /* =====================================================================
   * Tariffs and billing
   * ===================================================================== */

  var TARIF_PENDAFTARAN = 15000;

  var TINDAKAN = [
    { id: 'none', label: '(tanpa tindakan)', price: 0, bpjs: true },
    { id: 'jahit-luka', label: 'Hecting luka ≤ 5 jahitan', price: 120000, bpjs: true },
    { id: 'ganti-verban', label: 'Perawatan luka / ganti verban', price: 45000, bpjs: true },
    { id: 'nebulizer', label: 'Nebulisasi', price: 85000, bpjs: true },
    { id: 'injeksi', label: 'Injeksi intramuskular', price: 35000, bpjs: true },
    { id: 'ekstraksi-gigi', label: 'Ekstraksi gigi permanen', price: 175000, bpjs: true },
    { id: 'tambal-gigi', label: 'Tumpatan gigi (GIC)', price: 150000, bpjs: true },
    { id: 'skeling', label: 'Skeling / pembersihan karang gigi', price: 250000, bpjs: false },
    { id: 'anc', label: 'Pemeriksaan kehamilan (ANC) terpadu', price: 60000, bpjs: true },
    { id: 'kb-suntik', label: 'KB suntik 3 bulan', price: 40000, bpjs: true },
    { id: 'gds', label: 'Pemeriksaan gula darah sewaktu', price: 25000, bpjs: true },
    { id: 'asam-urat', label: 'Pemeriksaan asam urat', price: 30000, bpjs: true },
    { id: 'kolesterol', label: 'Pemeriksaan kolesterol total', price: 35000, bpjs: true },
    { id: 'mcu-basic', label: 'Medical check-up dasar (surat sehat)', price: 90000, bpjs: false }
  ];
  var TINDAKAN_BY_ID = {};
  TINDAKAN.forEach(function (t) { TINDAKAN_BY_ID[t.id] = t; });

  /**
   * computeBill(visit, prescription) -> bill
   *
   * The Indonesian bit that a generic billing model gets wrong: at FKTP level
   * BPJS pays by CAPITATION, not per visit. The clinic is paid a monthly
   * per-enrolled-head amount whether the patient attends or not, so a covered
   * BPJS patient pays zero at the counter — there is no co-payment to collect
   * and no claim to submit per visit. What the patient DOES pay is "iur biaya"
   * on items outside the guarantee: non-formulary drugs, cosmetic dentistry,
   * a surat sehat for a job application.
   *
   * So the bill has to carry two totals that are genuinely different numbers:
   * the tariff value of everything delivered (what the clinic reports), and
   * what the person in front of the counter actually hands over.
   */
  function computeBill(visit, prescription) {
    var lines = [];
    var poli = POLI_BY_ID[visit.poli] || POLI[0];
    var isBpjs = visit.klass === 'bpjs';

    lines.push({ label: 'Biaya pendaftaran', qty: 1, unit: TARIF_PENDAFTARAN, amount: TARIF_PENDAFTARAN, covered: true, group: 'administrasi' });
    lines.push({ label: 'Konsultasi ' + poli.label, qty: 1, unit: poli.konsul, amount: poli.konsul, covered: true, group: 'jasa' });

    (visit.tindakan || []).forEach(function (id) {
      var t = TINDAKAN_BY_ID[id];
      if (!t || t.id === 'none') return;
      lines.push({ label: t.label, qty: 1, unit: t.price, amount: t.price, covered: t.bpjs, group: 'tindakan' });
    });

    if (prescription && prescription.items) {
      prescription.items.forEach(function (it) {
        var d = R.rx && R.rx.drug(it.drugId);
        if (!d) return;
        var qty = it.qty || 0;
        lines.push({
          label: d.name + ' ' + d.strength, qty: qty, unit: d.price,
          amount: qty * d.price, covered: d.bpjs, group: 'obat'
        });
      });
    }

    var totalTarif = 0, ditanggung = 0, dibayarPasien = 0;
    lines.forEach(function (l) {
      totalTarif += l.amount;
      if (isBpjs && l.covered) { ditanggung += l.amount; l.payer = 'bpjs'; }
      else { dibayarPasien += l.amount; l.payer = isBpjs ? 'iur' : 'pasien'; }
    });

    return {
      klass: visit.klass,
      lines: lines,
      totalTarif: totalTarif,
      ditanggung: ditanggung,
      dibayarPasien: dibayarPasien,
      note: isBpjs
        ? 'Pasien BPJS di FKTP: layanan yang dijamin dibayar lewat kapitasi bulanan, bukan klaim per kunjungan — pasien tidak membayar di kasir. Baris bertanda "iur biaya" berada di luar jaminan dan dibayar sendiri.'
        : 'Pasien umum (self-pay): seluruh tarif dibayar langsung di kasir.'
    };
  }

  function rupiah(n) {
    var s = String(Math.round(Math.abs(n || 0)));
    var out = '';
    while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (n < 0 ? '-Rp ' : 'Rp ') + s + out;
  }

  /* =====================================================================
   * Encounters, signing, addenda
   * ===================================================================== */

  /* Fields that an addendum may supersede. A closed list, because "addendum
   * on any path" would let a correction rewrite the signature block or the
   * encounter id, and at that point the immutability claim is theatre. */
  var ADDENDABLE = {
    's': { label: 'Subjective (anamnesis)', kind: 'text' },
    'o.exam': { label: 'Objective — pemeriksaan fisik', kind: 'text' },
    'o.vitals': { label: 'Objective — tanda vital', kind: 'vitals' },
    'a': { label: 'Assessment — diagnosis ICD-10', kind: 'assessment' },
    'p.plan': { label: 'Plan — tata laksana', kind: 'text' },
    'p.edukasi': { label: 'Plan — edukasi pasien', kind: 'text' }
  };

  function getPath(obj, path) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /**
   * effectiveEncounter(encounter, addenda) -> {
   *   values: { <path>: currentValue },
   *   original: { <path>: originalValue },
   *   supersededBy: { <path>: addendumId },
   *   trail: { <path>: [addendum, ...] }
   * }
   *
   * The original encounter object is never touched. This is a projection.
   */
  function effectiveEncounter(enc, addenda) {
    var mine = (addenda || [])
      .filter(function (a) { return a.encounterId === enc.id; })
      .slice()
      .sort(function (a, b) { return a.seq - b.seq; });

    var values = {}, original = {}, supersededBy = {}, trail = {};
    Object.keys(ADDENDABLE).forEach(function (p) {
      var v = getPath(enc, p);
      original[p] = v;
      values[p] = v;
      trail[p] = [];
    });
    mine.forEach(function (a) {
      if (!ADDENDABLE[a.path]) return;
      values[a.path] = a.newValue;
      supersededBy[a.path] = a.id;
      trail[a.path].push(a);
    });
    return { values: values, original: original, supersededBy: supersededBy, trail: trail, addenda: mine };
  }

  /* =====================================================================
   * Seeded PRNG — every piece of demo data comes from here
   * ===================================================================== */

  // mulberry32. Small, fast, and good enough that the demo data does not look
  // mechanical. Seeded so that the app is byte-identical on every load, which
  // is what makes the test suite able to assert on it.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rand, arr) { return arr[Math.floor(rand() * arr.length) % arr.length]; }
  function intBetween(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }

  R.domain = {
    formatRM: formatRM, parseRM: parseRM, pad: pad,
    POLI: POLI, POLI_BY_ID: POLI_BY_ID,
    QUEUE: QUEUE, QUEUE_ORDER: QUEUE_ORDER, canTransition: canTransition,
    ROLES: ROLES, ROLE_BY_ID: ROLE_BY_ID, roleLabel: roleLabel,
    PERMISSIONS: PERMISSIONS, can: can,
    bmi: bmi, bmiBand: bmiBand, bpBand: bpBand, flagVitals: flagVitals,
    ACUITY: ACUITY, suggestAcuity: suggestAcuity,
    TINDAKAN: TINDAKAN, TINDAKAN_BY_ID: TINDAKAN_BY_ID,
    TARIF_PENDAFTARAN: TARIF_PENDAFTARAN,
    computeBill: computeBill, rupiah: rupiah,
    ADDENDABLE: ADDENDABLE, effectiveEncounter: effectiveEncounter, getPath: getPath,
    rng: rng, pick: pick, intBetween: intBetween
  };
})(typeof self !== 'undefined' ? self : this);
