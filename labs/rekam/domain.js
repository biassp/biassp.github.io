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
            // A draft prescription is not a prescription. Letting the patient
            // walk to the counter with unsigned drug lines still on the visit
            // is how the cashier ends up charging for medicine that was never
            // reviewed, never dispensed and never handed over.
            if (ctx.prescription && ctx.prescription.status === 'draft' && (ctx.prescription.items || []).length) {
              return 'Masih ada draf resep berisi ' + ctx.prescription.items.length +
                ' item yang belum ditandatangani. Tandatangani resep lalu arahkan ke farmasi, atau kosongkan drafnya bila memang tidak jadi meresepkan — draf tidak pernah ditagihkan dan tidak pernah diserahkan.';
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
            // A prescription cancelled at the counter releases the patient:
            // there is nothing left to hand over, and nothing to bill.
            if (ctx.prescription.status === 'dibatalkan') return null;
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
      // Deliberately precise. "Tidak boleh membaca isi catatan klinis" was
      // more than the app delivers: an itemised bill that names the drug is
      // clinical information, and a cashier legitimately sees a bill. What is
      // actually enforced is the narrative — S, O, A and P — plus collapsing
      // the drug lines on the bill to a count and a total for this role.
      blurb: 'Mendaftarkan pasien, mengalokasikan No. RM, membuka kunjungan dan menutup tagihan. Tidak membaca narasi klinis (SOAP); pada tagihan, baris obat diringkas menjadi jumlah item tanpa nama obat.'
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

  /* PAEDIATRIC VITAL-SIGN BANDS.
   *
   * A heart rate of 130 and a respiratory rate of 35 are a well six-month-old
   * and a peri-arrest adult. Reading both off the same table is not a rounding
   * error: an infant scored against adult thresholds comes out hypotensive,
   * tachycardic and tachypnoeic all at once, which is a textbook description of
   * shock, and the triage suggestion that follows is "merah". The clinic seeds
   * roughly one patient in five under 13 and runs a KIA poli, so this is half
   * the triage desk, not an edge case.
   *
   * Bands below are the APLS/PALS ones a puskesmas triage card carries:
   * `hr` and `rr` are [normal-low, normal-high, red-low, red-high]. Anything
   * outside normal is flagged; anything outside the red pair drives an
   * emergency acuity suggestion.
   *
   * Age is in completed years, which is what the record actually holds. A
   * neonate needs age in days and is therefore NOT distinguished here — the
   * "< 1 tahun" band is deliberately the infant band, and the UI says so.
   */
  var VITAL_BANDS = [
    { maxAge: 0, label: 'bayi < 1 tahun', hr: [100, 160, 80, 190], rr: [30, 50, 20, 60] },
    { maxAge: 2, label: 'anak 1–2 tahun', hr: [90, 150, 70, 180], rr: [25, 35, 18, 50] },
    { maxAge: 5, label: 'anak 3–5 tahun', hr: [80, 140, 65, 170], rr: [22, 30, 15, 40] },
    { maxAge: 11, label: 'anak 6–11 tahun', hr: [70, 120, 55, 150], rr: [18, 25, 12, 32] },
    { maxAge: Infinity, label: 'usia ≥ 12 tahun / dewasa', hr: [60, 100, 45, 130], rr: [12, 20, 8, 24] }
  ];

  function vitalBand(age) {
    if (age == null) return VITAL_BANDS[VITAL_BANDS.length - 1];
    for (var i = 0; i < VITAL_BANDS.length; i++) {
      if (age <= VITAL_BANDS[i].maxAge) return VITAL_BANDS[i];
    }
    return VITAL_BANDS[VITAL_BANDS.length - 1];
  }

  function isPaediatric(age) { return age != null && age < 12; }

  /* Systolic hypotension threshold, PALS: < 70 in infancy, 70 + 2×age through
   * ten, < 90 from eleven up. This is the one paediatric blood-pressure rule
   * that can be computed without a chart, and it is the one that matters —
   * a hypotensive child is decompensating. */
  function hypotensionFloor(age) {
    if (age == null || age > 10) return 90;
    if (age < 1) return 70;
    return 70 + 2 * age;
  }

  /**
   * bpBand(sys, dia, age)
   *
   * Above the hypotension floor, paediatric blood pressure is NOT interpreted.
   * Paediatric hypertension is defined by percentile for age, sex and height;
   * there is no fixed 140/90 for a seven-year-old, and inventing one would be
   * worse than declining — exactly as the BMI bands already decline.
   */
  function bpBand(sys, dia, age) {
    if (sys == null || dia == null) return null;
    var floor = hypotensionFloor(age);
    if (isPaediatric(age)) {
      if (sys < floor) {
        return {
          label: 'Hipotensi anak (ambang sistol < ' + floor + ' mmHg untuk usia ' + age + ' th)',
          tone: 'bad', icd: null, pediatric: true
        };
      }
      return {
        label: 'Tidak diinterpretasi otomatis — hipertensi anak dinilai dengan kurva persentil usia/jenis kelamin/tinggi',
        tone: 'ok', icd: null, pediatric: true, undecided: true
      };
    }
    // R03.0 — and not I10 — is the code for a raised reading. A single office
    // measurement does not diagnose essential hypertension, and auto-coding it
    // as I10 would inflate the FKTP hypertension prevalence that BPJS reports
    // against. I10 is offered only when the patient already carries it.
    if (sys >= 180 || dia >= 110) return { label: 'Krisis hipertensi', tone: 'bad', icd: 'R03.0' };
    if (sys >= 160 || dia >= 100) return { label: 'Hipertensi derajat 2', tone: 'bad', icd: 'R03.0' };
    if (sys >= 140 || dia >= 90) return { label: 'Hipertensi derajat 1', tone: 'bad', icd: 'R03.0' };
    if (sys >= 130 || dia >= 85) return { label: 'Normal tinggi (pra-hipertensi)', tone: 'warn', icd: null };
    if (sys < 90 || dia < 60) return { label: 'Hipotensi', tone: 'warn', icd: null };
    return { label: 'Normal', tone: 'ok', icd: null };
  }

  /**
   * flagVitals(t, patientAge, opts) -> [{ key, label, value, tone, note }]
   * Flags only what is outside range; a normal set produces an empty list, so
   * the UI shows abnormalities rather than a wall of green.
   *
   * opts.knownHypertension flips the blood-pressure suggestion from R03.0
   * (raised reading, no diagnosis) to I10 (the patient already carries it).
   */
  function flagVitals(t, age, opts) {
    var out = [];
    if (!t) return out;
    opts = opts || {};
    var band = vitalBand(age);
    var ped = isPaediatric(age);
    var forAge = ped ? ' (normal ' : ' (normal dewasa ';

    var bp = bpBand(t.tdSistol, t.tdDiastol, age);
    if (bp && bp.tone !== 'ok') {
      out.push({
        key: 'td', label: 'Tekanan darah', value: t.tdSistol + '/' + t.tdDiastol + ' mmHg',
        tone: bp.tone, note: bp.label,
        suggestIcd: bp.icd === 'R03.0' && opts.knownHypertension ? 'I10' : bp.icd
      });
    }
    if (t.nadi != null) {
      var hrNote = forAge + band.hr[0] + '–' + band.hr[1] + ' x/menit untuk ' + band.label + ')';
      if (t.nadi > band.hr[1]) {
        out.push({ key: 'nadi', label: 'Nadi', value: t.nadi + ' x/menit', tone: t.nadi > band.hr[3] ? 'bad' : 'warn', note: 'Takikardia' + hrNote });
      } else if (t.nadi < band.hr[0]) {
        out.push({ key: 'nadi', label: 'Nadi', value: t.nadi + ' x/menit', tone: t.nadi < band.hr[2] ? 'bad' : 'warn', note: 'Bradikardia' + hrNote });
      }
    }
    if (t.suhu != null) {
      if (t.suhu >= 40) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'bad', note: 'Hiperpireksia', suggestIcd: 'R50.9' });
      else if (t.suhu >= 38) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'bad', note: 'Demam', suggestIcd: 'R50.9' });
      else if (t.suhu >= 37.5) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'warn', note: 'Subfebris' });
      else if (t.suhu < 36) out.push({ key: 'suhu', label: 'Suhu', value: t.suhu + ' °C', tone: 'warn', note: 'Hipotermia' });
    }
    if (t.rr != null) {
      var rrNote = forAge + band.rr[0] + '–' + band.rr[1] + ' x/menit untuk ' + band.label + ')';
      if (t.rr > band.rr[3]) out.push({ key: 'rr', label: 'Frekuensi napas', value: t.rr + ' x/menit', tone: 'bad', note: 'Takipnea' + rrNote });
      else if (t.rr > band.rr[1]) out.push({ key: 'rr', label: 'Frekuensi napas', value: t.rr + ' x/menit', tone: 'warn', note: 'Napas cepat' + rrNote });
      else if (t.rr < band.rr[2]) out.push({ key: 'rr', label: 'Frekuensi napas', value: t.rr + ' x/menit', tone: 'bad', note: 'Bradipnea' + rrNote });
      else if (t.rr < band.rr[0]) out.push({ key: 'rr', label: 'Frekuensi napas', value: t.rr + ' x/menit', tone: 'warn', note: 'Bradipnea' + rrNote });
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
      var bband = bmiBand(b);
      if (bband.tone !== 'ok') {
        out.push({ key: 'imt', label: 'IMT', value: b + ' kg/m²', tone: bband.tone, note: bband.label, suggestIcd: b >= 25 ? 'E66.9' : null });
      }
    }
    return out;
  }

  /* PLAUSIBILITY BOUNDS for what a nurse can type.
   *
   * These are not clinical ranges — they are the outer edge of what a human
   * being can measure. A SpO₂ of 500 %, a temperature of 999 °C and a height
   * of 1.7 (a nurse typing metres, which then reports an IMT of 242 214) are
   * all data-entry slips, and a triage screen that stores them and then
   * confidently interprets them is worse than one that refuses. Clinical
   * abnormality is the flagVitals job; this is the typo guard in front of it.
   */
  var VITAL_RANGES = {
    tdSistol: { min: 50, max: 300, label: 'Sistol', unit: 'mmHg' },
    tdDiastol: { min: 20, max: 200, label: 'Diastol', unit: 'mmHg' },
    nadi: { min: 20, max: 250, label: 'Nadi', unit: 'x/menit' },
    suhu: { min: 25, max: 45, label: 'Suhu', unit: '°C' },
    rr: { min: 4, max: 80, label: 'Frekuensi napas', unit: 'x/menit' },
    spo2: { min: 50, max: 100, label: 'SpO₂', unit: '%' },
    bb: { min: 0.5, max: 300, label: 'Berat badan', unit: 'kg' },
    tb: { min: 30, max: 250, label: 'Tinggi badan', unit: 'cm' }
  };

  /**
   * checkVitalRanges(t) -> null | { field, reason }
   * Returns the FIRST offending field, named, so the refusal can point at it.
   */
  function checkVitalRanges(t) {
    if (!t) return null;
    var keys = Object.keys(VITAL_RANGES);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = t[k], r = VITAL_RANGES[k];
      if (v == null) continue;
      if (typeof v !== 'number' || !isFinite(v)) {
        return { field: k, reason: r.label + ' bukan angka yang sah.' };
      }
      if (v < r.min || v > r.max) {
        return {
          field: k,
          reason: r.label + ' ' + v + ' ' + r.unit + ' berada di luar rentang yang mungkin diukur (' +
            r.min + '–' + r.max + ' ' + r.unit + '). Periksa kembali satuannya — tinggi badan dalam sentimeter, bukan meter.'
        };
      }
    }
    if (t.tdSistol != null && t.tdDiastol != null && t.tdDiastol >= t.tdSistol) {
      return { field: 'tdDiastol', reason: 'Diastol (' + t.tdDiastol + ') harus lebih kecil daripada sistol (' + t.tdSistol + ').' };
    }
    return null;
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

  /**
   * suggestAcuity(t, age)
   *
   * Age-banded, for the same reason flagVitals is: a well toddler scored on
   * adult thresholds comes out "merah", and a triage screen that cries wolf on
   * every healthy child is worse than no suggestion at all.
   *
   * hasMeasurement() exists because an EMPTY form must not come out "hijau".
   * Auto-downgrading a patient nobody measured is the hazard the design notes
   * warn about; with nothing measured there is nothing to suggest, and the
   * caller is expected to refuse the save.
   */
  function hasMeasurement(t) {
    if (!t) return false;
    var keys = ['tdSistol', 'tdDiastol', 'nadi', 'suhu', 'rr', 'spo2', 'bb', 'tb'];
    for (var i = 0; i < keys.length; i++) if (t[keys[i]] != null) return true;
    return false;
  }

  function suggestAcuity(t, age) {
    if (!t || !hasMeasurement(t)) return null;
    var band = vitalBand(age);
    var floor = hypotensionFloor(age);
    if ((t.spo2 != null && t.spo2 < 90) ||
        (t.tdSistol != null && (t.tdSistol < floor || (!isPaediatric(age) && t.tdSistol >= 180))) ||
        (t.rr != null && (t.rr > band.rr[3] || t.rr < band.rr[2])) ||
        (t.suhu != null && t.suhu >= 40) ||
        (t.nadi != null && (t.nadi > band.hr[3] || t.nadi < band.hr[2]))) return 'merah';
    if ((t.spo2 != null && t.spo2 < 95) ||
        (t.tdSistol != null && !isPaediatric(age) && t.tdSistol >= 160) ||
        (t.suhu != null && t.suhu >= 38.5) ||
        (t.rr != null && t.rr > band.rr[1]) ||
        (t.nadi != null && t.nadi > (isPaediatric(age) ? band.hr[1] : 110))) return 'kuning';
    return 'hijau';
  }

  /* =====================================================================
   * Tariffs and billing
   * ===================================================================== */

  var TARIF_PENDAFTARAN = 15000;

  /* THE EXCEPTION EVERY FKTP CASHIER MEETS WEEKLY.
   *
   * BPJS Kesehatan is not the first payer for an injury with an external
   * cause. A road traffic case is Jasa Raharja's up to its ceiling; a work
   * injury is BPJS Ketenagakerjaan's. A clinic system that quietly runs every
   * injury through capitation is telling the clinic it has been paid for work
   * it must actually claim somewhere else — and the chapter XX code the doctor
   * assigns is exactly what decides which. */
  var KECELAKAAN = [
    { id: '', label: '(bukan kasus kecelakaan)', payer: null },
    { id: 'lalu-lintas', label: 'Kecelakaan lalu lintas', payer: 'Jasa Raharja', hint: 'Penjamin pertama adalah Jasa Raharja sampai batas santunannya; BPJS Kesehatan baru menanggung selisih di atas plafon itu.' },
    { id: 'kerja', label: 'Kecelakaan kerja', payer: 'BPJS Ketenagakerjaan', hint: 'Kecelakaan kerja dan penyakit akibat kerja dijamin BPJS Ketenagakerjaan, bukan kapitasi BPJS Kesehatan.' }
  ];
  var KECELAKAAN_BY_ID = {};
  KECELAKAAN.forEach(function (k) { KECELAKAAN_BY_ID[k.id] = k; });

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

    /* BILL WHAT LEFT THE PHARMACY, NOT WHAT WAS TYPED.
     *
     * A draft prescription is a doctor thinking out loud. It has not been
     * signed, not been reviewed by the pharmacist and not been handed to
     * anyone, so charging for it at the counter bills the patient for medicine
     * they never received. Only 'diserahkan' produces drug lines — and the
     * lines are the ones actually dispensed, so a pharmacist substitution
     * (out of stock, generic swap) changes the amount as well as the label.
     */
    if (prescription && prescription.status === 'diserahkan' && prescription.items) {
      var subs = {};
      (prescription.substitutions || []).forEach(function (s) {
        if (s && s.from && s.to) subs[s.from] = s;
      });
      prescription.items.forEach(function (it) {
        var sub = subs[it.drugId];
        var d = R.rx && R.rx.drug(sub ? sub.to : it.drugId);
        if (!d) return;
        var qty = (sub && sub.qty != null ? sub.qty : it.qty) || 0;
        lines.push({
          label: d.name + ' ' + d.strength + (sub ? ' (substitusi)' : ''),
          qty: qty, unit: d.price,
          amount: qty * d.price, covered: d.bpjs, group: 'obat',
          substitutedFrom: sub ? sub.from : null
        });
      });
    }

    var kec = KECELAKAAN_BY_ID[visit.kecelakaan || ''] || KECELAKAAN[0];
    var thirdParty = !!kec.payer;

    var totalTarif = 0, ditanggung = 0, dibayarPasien = 0, ditanggungLain = 0;
    lines.forEach(function (l) {
      totalTarif += l.amount;
      if (thirdParty && l.covered) { ditanggungLain += l.amount; l.payer = 'penjamin-lain'; l.payerLabel = kec.payer; }
      else if (isBpjs && l.covered) { ditanggung += l.amount; l.payer = 'bpjs'; }
      else { dibayarPasien += l.amount; l.payer = isBpjs ? 'iur' : 'pasien'; }
    });

    return {
      klass: visit.klass,
      kecelakaan: kec.id || null,
      penjaminLain: kec.payer || null,
      lines: lines,
      totalTarif: totalTarif,
      ditanggung: ditanggung,
      ditanggungLain: ditanggungLain,
      dibayarPasien: dibayarPasien,
      note: thirdParty
        ? 'Kasus ' + kec.label.toLowerCase() + ': penjamin pertama adalah ' + kec.payer + ', bukan kapitasi BPJS Kesehatan. ' + kec.hint +
          ' Tagihan ini diajukan ke penjamin tersebut, jadi nilainya tidak boleh ikut dihitung sebagai layanan berkapitasi.'
        : isBpjs
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
  /* The `roles` field is the second half of the guarantee, and it was the
   * missing half: "a nurse may correct a mistyped vital sign" and "a nurse may
   * replace the coded diagnosis on a doctor's signed note" are not the same
   * permission, and 'soap.addendum' as a single yes/no could not tell them
   * apart. Per-path now, per-role, stated as data. */
  var ADDENDABLE = {
    's': { label: 'Subjective (anamnesis)', kind: 'text', roles: ['dokter'] },
    'o.exam': { label: 'Objective — pemeriksaan fisik', kind: 'text', roles: ['dokter'] },
    'o.vitals': { label: 'Objective — tanda vital', kind: 'vitals', roles: ['dokter', 'perawat'] },
    'a': { label: 'Assessment — diagnosis ICD-10', kind: 'assessment', roles: ['dokter'] },
    'p.plan': { label: 'Plan — tata laksana', kind: 'text', roles: ['dokter'] },
    'p.edukasi': { label: 'Plan — edukasi pasien', kind: 'text', roles: ['dokter'] }
  };

  /**
   * canAddendum(role, path) -> { ok, reason? }
   * Asked before the form is even drawn, so a nurse never sees a dropdown
   * offering "Assessment — diagnosis ICD-10".
   */
  function canAddendum(role, path) {
    var base = can(role, 'soap.addendum');
    if (!base.ok) return base;
    var spec = ADDENDABLE[path];
    if (!spec) return { ok: false, reason: 'Bagian "' + path + '" tidak dapat diadendum.' };
    if (spec.roles.indexOf(role) >= 0) return { ok: true };
    return {
      ok: false,
      reason: 'Peran ' + roleLabel(role) + ' tidak dapat mengadendum bagian "' + spec.label + '". Bagian ini hanya dapat dikoreksi oleh: ' +
        spec.roles.map(roleLabel).join(', ') + '. Perawat dapat mengoreksi tanda vital yang salah ketik; mengganti diagnosis berkode pada catatan yang ditandatangani dokter adalah tindakan klinis, bukan koreksi ketik.'
    };
  }

  function addendablePathsFor(role) {
    return Object.keys(ADDENDABLE).filter(function (p) { return canAddendum(role, p).ok; });
  }

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
    VITAL_BANDS: VITAL_BANDS, vitalBand: vitalBand, hypotensionFloor: hypotensionFloor,
    isPaediatric: isPaediatric, hasMeasurement: hasMeasurement,
    VITAL_RANGES: VITAL_RANGES, checkVitalRanges: checkVitalRanges,
    ACUITY: ACUITY, suggestAcuity: suggestAcuity,
    TINDAKAN: TINDAKAN, TINDAKAN_BY_ID: TINDAKAN_BY_ID,
    TARIF_PENDAFTARAN: TARIF_PENDAFTARAN,
    KECELAKAAN: KECELAKAAN, KECELAKAAN_BY_ID: KECELAKAAN_BY_ID,
    computeBill: computeBill, rupiah: rupiah,
    ADDENDABLE: ADDENDABLE, canAddendum: canAddendum, addendablePathsFor: addendablePathsFor,
    effectiveEncounter: effectiveEncounter, getPath: getPath,
    rng: rng, pick: pick, intBetween: intBetween
  };
})(typeof self !== 'undefined' ? self : this);
