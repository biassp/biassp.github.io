/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — domain.js
 * The school domain, with no DOM and no storage. Loaded by the page, by the
 * solver Worker and by node (tests run from the same source in all three).
 *
 * Everything here is deliberately pure so that the two claims the app makes
 * about itself can actually be checked: that a rapor recomputes deterministically
 * from its inputs, and that the identifier rules hold across academic years.
 *
 * CURRICULUM: this app models ONE curriculum, Kurikulum 2013 for SMP
 * (Permendikbud 35/2018), and is consistent with it end to end — subject names,
 * the JP allocation, the KKM/predikat apparatus and the two-aspek rapor
 * (KI-3 pengetahuan and KI-4 keterampilan) plus penilaian sikap. It is NOT a
 * K13/Merdeka hybrid: Merdeka replaced KKM with KKTP and drops the A–D
 * predikat, so mixing the two produces a rapor no school could issue.
 *
 * Vocabulary, because the code uses the school's words and not translations:
 *   tahun ajaran  academic year, e.g. "2025/2026" — runs July to June
 *   semester      "ganjil" (odd, Jul-Dec) or "genap" (even, Jan-Jun)
 *   rombel        rombongan belajar — a class group, e.g. 8B. Belongs to ONE
 *                 tahun ajaran; 8B in 2024/2025 and 8B in 2025/2026 are
 *                 different rombel holding different children.
 *   tingkat       grade level 7/8/9 (SMP)
 *   mapel         mata pelajaran — subject
 *   JP            jam pelajaran — one 40-minute teaching period
 *   KKM           kriteria ketuntasan minimal — the pass mark, set per subject
 *                 per tahun ajaran in the school's KOSP
 *   KI-3 / KI-4   kompetensi inti: pengetahuan and keterampilan. Two separate
 *                 marks per subject, each with its own predikat and deskripsi
 *   wali kelas    the homeroom teacher who owns a rombel and signs its rapor
 *   presensi      attendance; statuses are Hadir / Sakit / Izin / Alpa
 *   PPDB          penerimaan peserta didik baru — the new-intake process
 */
(function (root) {
  'use strict';

  var D = {};
  root.SIAKAD_DOMAIN = D;

  D.KURIKULUM = {
    id: 'k13',
    nama: 'Kurikulum 2013 (K13)',
    dasar: 'Permendikbud 35/2018 — struktur kurikulum SMP/MTs',
    catatan: 'Satu kurikulum, konsisten: KKM dan predikat A–D adalah perangkat K13, ' +
      'rapor memuat KI-3 (pengetahuan) dan KI-4 (keterampilan) terpisah, masing-masing ' +
      'dengan predikat dan deskripsi, ditambah penilaian sikap spiritual dan sosial dari wali kelas.'
  };

  /* ============================================================ 1. PRNG ==
   * Every fabricated record in this app comes out of here. mulberry32 is a
   * 32-bit state PRNG: same seed, same stream, on every machine and every
   * reload. That is what makes "the demo data is generated, not stored"
   * survivable — and what makes the determinism assertions meaningful.
   */
  D.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // FNV-1a. Used to derive a stable per-(student, subject, component) stream
  // without storing 200k rows: the grade IS the hash, so a reload cannot
  // produce different numbers and there is nothing to keep in sync.
  D.hash32 = function (str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  /* A deterministic uniform in [0,1) for an arbitrary key.
   *
   * The murmur3 finalizer is NOT decoration. FNV-1a on its own maps adjacent
   * keys to adjacent outputs — det('...|p1'), det('...|p2'), det('...|p3')
   * came out as 0.767, 0.763, 0.759, a monotone drift. Every attendance draw
   * for one (student, day) therefore sat in one narrow band, so a week was
   * either wholly present or absorbed every absence in the semester. The
   * marginal distribution was perfectly uniform and the sequences were still
   * useless; only avalanching the bits fixes it.
   */
  function fmix32(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  D.fmix32 = fmix32;
  D.det = function (key) { return fmix32(D.hash32(key)) / 4294967296; };

  // Deterministic normal-ish variate (sum of three uniforms, centred), so the
  // synthetic marks cluster instead of being flat noise.
  D.detNormal = function (key) {
    return (D.det(key + '|a') + D.det(key + '|b') + D.det(key + '|c')) / 3 * 2 - 1;
  };

  // A deterministic permutation of 0..n-1 for an arbitrary key. Used to spread
  // a subject's weekly meetings over distinct weekdays without storing a table.
  D.detShuffle = function (key, n) {
    var arr = [], i;
    for (i = 0; i < n; i++) arr.push(i);
    for (i = n - 1; i > 0; i--) {
      var j = Math.floor(D.det(key + '|s' + i) * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  D.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  D.round2 = function (v) { return Math.round(v * 100) / 100; };

  /* ================================================== 2. Tahun ajaran ==
   * A tahun ajaran is a string "YYYY/YYYY+1". Nothing in this app is stored
   * without one. The single most common defect in a school system is a grade,
   * a class membership OR A PIECE OF ASSESSMENT CONFIGURATION that silently
   * belongs to "now" instead of to the year it happened in — so the year is
   * part of every key, never a filter applied afterwards.
   */
  D.SEMESTER = ['ganjil', 'genap'];

  D.parseTahunAjaran = function (ta) {
    var m = /^(\d{4})\/(\d{4})$/.exec(String(ta || ''));
    if (!m) return null;
    var a = +m[1], b = +m[2];
    if (b !== a + 1) return null;
    return { start: a, end: b, label: ta };
  };

  D.tahunAjaranValid = function (ta) { return D.parseTahunAjaran(ta) !== null; };

  // Ganjil runs Jul..Dec of the first calendar year, genap Jan..Jun of the second.
  D.semesterMonths = function (ta, semester) {
    var p = D.parseTahunAjaran(ta);
    if (!p) return [];
    var out = [], i;
    if (semester === 'ganjil') {
      for (i = 7; i <= 12; i++) out.push({ year: p.start, month: i });
    } else {
      for (i = 1; i <= 6; i++) out.push({ year: p.end, month: i });
    }
    return out;
  };

  // The 12 billing months of a tahun ajaran, July first.
  D.tahunAjaranMonths = function (ta) {
    return D.semesterMonths(ta, 'ganjil').concat(D.semesterMonths(ta, 'genap'));
  };

  D.NAMA_BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  D.NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];

  /* Dates are handled as UTC-midnight timestamps and 'YYYY-MM-DD' strings and
   * NEVER as local Date objects: a local-time Date shifts a date by a day for
   * anyone east or west of the machine that generated it, and a school year
   * that moves when you open it in a different timezone is not a school year. */
  D.ymd = function (ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') +
      '-' + String(d.getUTCDate()).padStart(2, '0');
  };
  D.parseYmd = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  };
  D.tanggalPanjang = function (s) {
    var ts = typeof s === 'number' ? s : D.parseYmd(s);
    if (ts === null) return String(s);
    var d = new Date(ts);
    return D.NAMA_HARI[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' +
      D.NAMA_BULAN[d.getUTCMonth() + 1] + ' ' + d.getUTCFullYear();
  };
  D.addDays = function (ts, n) { return ts + n * 86400000; };
  // First Monday on or after ts.
  D.seninBerikut = function (ts) {
    var wd = new Date(ts).getUTCDay();       // 0 Sun .. 6 Sat
    var delta = (8 - wd) % 7;                 // 0 if already Monday
    if (wd === 1) delta = 0;
    return ts + delta * 86400000;
  };

  // Whole years elapsed between two dates. Used for the PPDB age ceiling, where
  // "15 tahun pada 1 Juli" means completed years, not a rounded fraction.
  D.usiaTahun = function (tglLahir, padaTs) {
    var lahir = typeof tglLahir === 'number' ? tglLahir : D.parseYmd(tglLahir);
    if (lahir === null || lahir === undefined) return null;
    var a = new Date(lahir), b = new Date(padaTs);
    var y = b.getUTCFullYear() - a.getUTCFullYear();
    var m = b.getUTCMonth() - a.getUTCMonth();
    if (m < 0 || (m === 0 && b.getUTCDate() < a.getUTCDate())) y--;
    return y;
  };

  // A rombel key is (tahun ajaran, name). Two different objects, deliberately.
  D.rombelKey = function (ta, nama) { return ta + '|' + nama; };

  /* ==================================================== 3. Identifiers ==
   * Three different numbers that people outside the domain assume are one:
   *
   *   NISN  Nomor Induk Siswa Nasional. Ten digits, issued nationally ONCE per
   *         human being, follows the child from SD to SMA and is never reused
   *         — not after graduation, not after a transfer out, not after death.
   *         It is the join key for anything historical.
   *   NIS   Nomor Induk Siswa. School-local, assigned on admission, encodes the
   *         intake year in this school's convention. Unique in the school only;
   *         another school's NIS 251007 is a different child.
   *   Absen Roster position inside a rombel. Re-derived every year from the
   *         alphabetical order of THAT rombel, so it changes when the class
   *         changes and must never be used as an identity.
   *
   * Confusing NISN with the roster number is the school-system equivalent of
   * using a bed number as a medical record number.
   *
   * The NISN values in this demo are structurally valid but come from a
   * synthetic block this file allocates; they were not issued by anyone and
   * do not belong to a real child. There is no NIK and no NIP anywhere in the
   * dataset — see the note in data.js for why fabricating those is not safe.
   */
  D.NISN_DEMO_PREFIX = '99';

  D.isValidNisn = function (v) { return /^\d{10}$/.test(String(v)); };
  D.isDemoNisn = function (v) {
    return D.isValidNisn(v) && String(v).slice(0, 2) === D.NISN_DEMO_PREFIX;
  };

  // A registry that refuses to hand the same NISN out twice, ever — including
  // to a student who has already left. Retiring a NISN keeps it burned.
  D.NisnRegistry = function (seed) {
    var rnd = D.mulberry32(seed >>> 0);
    var issued = Object.create(null);
    var order = [];
    return {
      issue: function (ownerId) {
        for (var guard = 0; guard < 100000; guard++) {
          var body = '';
          for (var i = 0; i < 8; i++) body += Math.floor(rnd() * 10);
          var nisn = D.NISN_DEMO_PREFIX + body;
          if (issued[nisn]) continue;          // collision: draw again
          issued[nisn] = ownerId || true;
          order.push(nisn);
          return nisn;
        }
        throw new Error('NISN space exhausted');
      },
      // Present tense "is this NISN spoken for", regardless of enrolment state.
      taken: function (nisn) { return !!issued[nisn]; },
      ownerOf: function (nisn) { return issued[nisn] || null; },
      count: function () { return order.length; },
      all: function () { return order.slice(); }
    };
  };

  // NIS convention used by this school: two digits of the intake year, then a
  // tingkat-independent sequence. 25 1042 = admitted in 2025, 42nd on that list.
  D.makeNis = function (intakeYear, seq) {
    return String(intakeYear % 100) + '1' + String(seq).padStart(3, '0');
  };

  /* ================================================ 4. Fabricated names ==
   * Names are assembled from invented syllables with Indonesian phonotactics,
   * not drawn from a list of real people. They read like names and are not
   * anyone's. Every screen that shows one also says the dataset is fabricated.
   */
  var ONSET = ['b', 'd', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'w', 'y',
    'br', 'dr', 'kr', 'pr', 'tr', 'ng', 'ny', 'sy', 'nd', 'mb'];
  var NUCLEUS = ['a', 'i', 'u', 'e', 'o', 'a', 'i', 'u', 'a', 'e'];
  var CODA = ['', '', '', 'n', 'r', 's', 'm', 'ng', 'h', 'l'];

  function syllable(rnd, allowCoda) {
    return ONSET[Math.floor(rnd() * ONSET.length)] +
      NUCLEUS[Math.floor(rnd() * NUCLEUS.length)] +
      (allowCoda ? CODA[Math.floor(rnd() * CODA.length)] : '');
  }

  function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  D.fabricateWord = function (rnd, minSyl, maxSyl) {
    var n = minSyl + Math.floor(rnd() * (maxSyl - minSyl + 1));
    var w = '';
    for (var i = 0; i < n; i++) w += syllable(rnd, i === n - 1 || rnd() < 0.25);
    return capitalise(w);
  };

  // Two or three parts, the way an Indonesian full name usually runs.
  D.fabricateNama = function (rnd) {
    var parts = [D.fabricateWord(rnd, 2, 3), D.fabricateWord(rnd, 2, 3)];
    if (rnd() < 0.45) parts.push(D.fabricateWord(rnd, 2, 3));
    return parts.join(' ');
  };

  var GELAR_DEPAN = ['', '', '', '', 'Drs. ', 'Dra. '];

  /* A teacher's degree follows the subject they were certified in, because a
   * kepala sekolah reads that column as "is this person actually qualified for
   * the mapel next to their name". A PPKn teacher with S.Ag. after their name
   * is the kind of detail that makes a reader stop trusting the whole table. */
  var GELAR_MAPEL = {
    pabp: [', S.Ag.', ', S.Pd.I.'],
    ppkn: [', S.Pd.', ', S.H.'],
    bind: [', S.Pd.', ', M.Pd.'],
    mtk: [', S.Pd.', ', S.Si.'],
    ipa: [', S.Pd.', ', S.Si.'],
    ips: [', S.Pd.', ', S.Sos.'],
    bing: [', S.Pd.', ', S.S.'],
    seni: [', S.Pd.', ', S.Sn.'],
    pjok: [', S.Pd.'],
    infm: [', S.Kom.', ', S.Pd.'],
    bjaw: [', S.Pd.']
  };

  D.gelarUntukMapel = function (rnd, mapelId) {
    var pool = GELAR_MAPEL[mapelId] || [', S.Pd.'];
    return pool[Math.floor(rnd() * pool.length)];
  };

  D.fabricateNamaGuru = function (rnd, mapelId) {
    var depan = GELAR_DEPAN[Math.floor(rnd() * GELAR_DEPAN.length)];
    var belakang = D.gelarUntukMapel(rnd, mapelId);
    // "Drs. X, S.Si." is not a combination that exists: Drs./Dra. IS the old
    // undergraduate title, so it pairs with a postgraduate one or with nothing.
    if (depan) belakang = rnd() < 0.5 ? ', M.Pd.' : '';
    return depan + D.fabricateNama(rnd) + belakang;
  };

  /* ================================================= 5. Penilaian model ==
   * K13 scores a subject on TWO aspects that never share a mark:
   *
   *   KI-3 Pengetahuan   tugas / ulangan harian / PTS / PAS
   *   KI-4 Keterampilan  praktik / produk / proyek / portofolio
   *
   * Each aspect gets its own weighted mark, its own predikat against the same
   * KKM, and its own deskripsi capaian. A rapor that carries one number per
   * subject is not a document an SMP can issue — keterampilan is half the marks
   * on the page and is the first thing a kepala sekolah looks for.
   *
   * The weighting is set by the school in the KOSP and differs per subject AND
   * per aspect. Two rules that never bend: the weights must total 100, and the
   * whole configuration is scoped to a tahun ajaran (see akademik.js) so that
   * revising the KKM this year cannot rewrite a rapor signed two years ago.
   */
  D.ASPEK = [
    { id: 'peng', label: 'Pengetahuan', ki: 'KI-3', singkat: 'P' },
    { id: 'ket', label: 'Keterampilan', ki: 'KI-4', singkat: 'K' }
  ];

  D.KOMPONEN_ASPEK = {
    peng: [
      { id: 'tugas', label: 'Tugas', note: 'tugas harian & pekerjaan rumah' },
      { id: 'uh', label: 'Ulangan Harian', note: 'rata-rata UH per KD' },
      { id: 'pts', label: 'PTS', note: 'penilaian tengah semester' },
      { id: 'pas', label: 'PAS', note: 'penilaian akhir semester' }
    ],
    ket: [
      { id: 'praktik', label: 'Praktik', note: 'unjuk kerja / kinerja' },
      { id: 'produk', label: 'Produk', note: 'hasil karya' },
      { id: 'proyek', label: 'Proyek', note: 'tugas berjangka' },
      { id: 'porto', label: 'Portofolio', note: 'kumpulan karya terpilih' }
    ]
  };

  D.komponenAspek = function (aspek) { return D.KOMPONEN_ASPEK[aspek] || D.KOMPONEN_ASPEK.peng; };
  D.aspekIds = D.ASPEK.map(function (a) { return a.id; });

  // Kept as the pengetahuan list for readability at the call sites that only
  // ever mean KI-3; nothing may assume it covers keterampilan.
  D.KOMPONEN = D.KOMPONEN_ASPEK.peng;

  D.BOBOT_DEFAULT = {
    peng: { tugas: 20, uh: 30, pts: 20, pas: 30 },
    ket: { praktik: 35, produk: 25, proyek: 25, porto: 15 }
  };

  // Returns {ok, total, errors[]}. Never throws — the caller is a form.
  D.validateBobot = function (bobot, aspek) {
    var komponen = D.komponenAspek(aspek || 'peng');
    var errors = [];
    var total = 0;
    for (var i = 0; i < komponen.length; i++) {
      var k = komponen[i].id;
      var v = bobot ? bobot[k] : undefined;
      if (v === undefined || v === null || v === '') {
        errors.push('Bobot ' + komponen[i].label + ' belum diisi.');
        continue;
      }
      var n = Number(v);
      if (!isFinite(n)) { errors.push('Bobot ' + komponen[i].label + ' bukan angka.'); continue; }
      if (n < 0) { errors.push('Bobot ' + komponen[i].label + ' tidak boleh negatif.'); continue; }
      if (n > 100) { errors.push('Bobot ' + komponen[i].label + ' melebihi 100.'); continue; }
      total += n;
    }
    // Compare on an integer scale: 33.33 + 33.33 + 33.34 must be accepted and
    // 0.1 + 0.2 arithmetic must not manufacture a rejection.
    var totalR = Math.round(total * 100) / 100;
    if (errors.length === 0 && totalR !== 100) {
      errors.push('Total bobot harus tepat 100%, saat ini ' + totalR + '%.');
    }
    return { ok: errors.length === 0, total: totalR, errors: errors };
  };

  D.KKM_MIN = 60;
  D.KKM_MAX = 85;

  /* Predikat. Schools derive A/B/C/D from the subject's own KKM rather than
   * from fixed cut-offs, because a KKM-70 subject and a KKM-80 subject are not
   * the same achievement at 82. The standard construction splits the interval
   * (100 - KKM) into three:
   *     D  nilai <  KKM                  (belum tuntas — must be remedial)
   *     C  KKM       <= nilai < KKM + i
   *     B  KKM + i   <= nilai < KKM + 2i
   *     A  KKM + 2i  <= nilai
   */
  D.predikatBands = function (kkm) {
    var i = (100 - kkm) / 3;
    return {
      kkm: kkm,
      interval: D.round2(i),
      C: D.round2(kkm),
      B: D.round2(kkm + i),
      A: D.round2(kkm + 2 * i)
    };
  };

  D.predikat = function (nilai, kkm) {
    var b = D.predikatBands(kkm);
    if (nilai < b.C) return 'D';
    if (nilai < b.B) return 'C';
    if (nilai < b.A) return 'B';
    return 'A';
  };

  D.PREDIKAT_LABEL = { A: 'Sangat Baik', B: 'Baik', C: 'Cukup', D: 'Perlu Bimbingan' };

  /* Nilai akhir. Deterministic, and it shows its arithmetic: the caller gets
   * the per-component contribution back so the rapor can print the working
   * instead of asking the parent to trust a single number.
   *
   * A component whose assessment window has NOT passed yet arrives as null.
   * That is not a zero. The function refuses to produce a nilai akhir at all
   * and reports which components are still outstanding — a SIAKAD in week six
   * of a semester is mostly empty cells, and one that prints a finished PAS is
   * the loudest possible tell that nobody has watched a school use one.
   */
  D.hitungNilaiAkhir = function (nilaiKomponen, bobot, kkm, aspek) {
    var komponen = D.komponenAspek(aspek || 'peng');
    var v = D.validateBobot(bobot, aspek || 'peng');
    if (!v.ok) {
      return { ok: false, lengkap: false, errors: v.errors, nilai: null, predikat: null, tuntas: null, rincian: [], belum: [] };
    }
    var rincian = [], sum = 0, belum = [];
    for (var i = 0; i < komponen.length; i++) {
      var k = komponen[i].id;
      var raw = nilaiKomponen ? nilaiKomponen[k] : undefined;
      var w = Number(bobot[k]);
      if (raw === null || raw === undefined || raw === '') {
        belum.push(k);
        rincian.push({ id: k, label: komponen[i].label, nilai: null, bobot: w, kontribusi: null });
        continue;
      }
      var n = Number(raw);
      if (!isFinite(n)) n = 0;
      n = D.clamp(n, 0, 100);
      var kontribusi = n * w / 100;
      sum += kontribusi;
      rincian.push({ id: k, label: komponen[i].label, nilai: n, bobot: w, kontribusi: D.round2(kontribusi) });
    }
    if (belum.length) {
      return {
        ok: true, lengkap: false, errors: [], nilai: null, predikat: null, tuntas: null,
        kkm: kkm, rincian: rincian, belum: belum
      };
    }
    // Round ONCE, at the end. Rounding each contribution first drifts by up to
    // 2 points across four components and makes the printed sum not add up.
    var nilai = D.round2(sum);
    return {
      ok: true,
      lengkap: true,
      errors: [],
      nilai: nilai,
      predikat: D.predikat(nilai, kkm),
      tuntas: nilai >= kkm,
      kkm: kkm,
      rincian: rincian,
      belum: []
    };
  };

  /* Deskripsi capaian kompetensi. A K13 rapor never prints a bare number: each
   * aspect carries a sentence naming what the child is strong and weak in.
   * Derived deterministically from (nisn, mapel, ta, semester, aspek) over the
   * subject's own materi list so the sentence is stable and specific rather
   * than a generic "sudah baik". */
  D.deskripsiCapaian = function (predikat, aspekId, materi, kunci) {
    if (!predikat) return '';
    var list = (materi && materi.length) ? materi : ['seluruh materi semester ini'];
    var n = list.length;
    var a = Math.floor(D.det(kunci + '|kuat') * n);
    var b = Math.floor(D.det(kunci + '|lemah') * n);
    if (n > 1 && b === a) b = (b + 1) % n;
    var kuat = list[a], lemah = list[b];
    var kk = aspekId === 'ket' ? 'terampil' : 'menguasai';
    var awal = {
      A: 'Sangat ' + (aspekId === 'ket' ? 'terampil' : 'baik') + ' dalam ',
      B: 'Baik dalam ' + (aspekId === 'ket' ? 'praktik ' : ''),
      C: 'Cukup ' + kk + ' ',
      D: 'Perlu bimbingan dalam '
    }[predikat];
    if (predikat === 'A') return awal + kuat + '; pertahankan ketelitian pada ' + lemah + '.';
    if (predikat === 'B') return awal + kuat + '; tingkatkan lagi pada ' + lemah + '.';
    if (predikat === 'C') return awal + kuat + ', masih perlu pendampingan pada ' + lemah + '.';
    return awal + lemah + '; mulai dari penguatan ' + kuat + ' sebelum remedial.';
  };

  /* --------------------------------------------------------- sikap (K13) --
   * Penilaian sikap is the wali kelas's, not the subject teacher's, and it is
   * a predikat plus a sentence — never a number. Two dimensions, spiritual and
   * sosial, exactly as the rapor form has them.
   */
  D.SIKAP = [
    { id: 'spiritual', label: 'Sikap Spiritual', butir: ['ketaatan beribadah', 'berdoa sebelum dan sesudah kegiatan', 'toleransi beragama', 'bersyukur'] },
    { id: 'sosial', label: 'Sikap Sosial', butir: ['jujur', 'disiplin', 'tanggung jawab', 'santun', 'peduli', 'percaya diri', 'gotong royong'] }
  ];
  D.PREDIKAT_SIKAP = ['A', 'B', 'C', 'D'];

  D.deskripsiSikap = function (dimensi, predikat, kunci) {
    var dim = null;
    for (var i = 0; i < D.SIKAP.length; i++) if (D.SIKAP[i].id === dimensi) dim = D.SIKAP[i];
    if (!dim) return '';
    var b = dim.butir;
    var a = Math.floor(D.det(kunci + '|s-kuat') * b.length);
    var c = Math.floor(D.det(kunci + '|s-lemah') * b.length);
    if (c === a) c = (c + 1) % b.length;
    if (predikat === 'A') return 'Sangat baik dalam ' + b[a] + ' dan ' + b[c] + '.';
    if (predikat === 'B') return 'Baik dalam ' + b[a] + '; perlu meningkatkan ' + b[c] + '.';
    if (predikat === 'C') return 'Mulai berkembang dalam ' + b[a] + '; perlu pembiasaan ' + b[c] + '.';
    return 'Perlu bimbingan dalam ' + b[c] + ', dengan penguatan pada ' + b[a] + '.';
  };

  /* ==================================================== 6. Presensi ==
   * Four statuses, and they are NOT interchangeable. Sakit and Izin are
   * excused; Alpa is not. That distinction is the whole point of recording four
   * statuses instead of a boolean, so the eligibility rule is written against
   * it: a child with thirty documented sakit days and zero alpa is not a
   * truant, and a system that flags them identically has thrown away the only
   * information it collected.
   *
   * The rule a school's kriteria kenaikan kelas actually carries is
   *   "ketidakhadiran tanpa keterangan tidak lebih dari X hari"
   * so THAT is what decides. Raw presence is reported alongside it as
   * information, under its own separate label, and the rapor says which of the
   * two rules tripped rather than printing one undifferentiated red box.
   */
  D.PRESENSI = [
    { id: 'H', label: 'Hadir', excused: true, present: true },
    { id: 'S', label: 'Sakit', excused: true, present: false },
    { id: 'I', label: 'Izin', excused: true, present: false },
    { id: 'A', label: 'Alpa', excused: false, present: false }
  ];

  D.presensiDef = function (id) {
    for (var i = 0; i < D.PRESENSI.length; i++) if (D.PRESENSI[i].id === id) return D.PRESENSI[i];
    return null;
  };
  D.isExcused = function (id) { var d = D.presensiDef(id); return !!(d && d.excused); };
  D.isPresent = function (id) { var d = D.presensiDef(id); return !!(d && d.present); };

  D.MIN_KEHADIRAN = 75;      // percent — informational, reported separately
  D.MAKS_ALPA_PERSEN = 10;   // percent of meetings, unexcused only — the rule that decides
  D.MAKS_ALPA_HARI = 12;     // days per semester, unexcused only — the day-grain rule

  function finishRollup(out, satuan) {
    out.hadirEfektif = out.H + out.S + out.I;   // present or excused
    out.tanpaKeterangan = out.A;
    out.persen = out.total ? D.round2(out.H / out.total * 100) : 0;
    out.persenAlpa = out.total ? D.round2(out.A / out.total * 100) : 0;
    out.persenBerizin = out.total ? D.round2((out.S + out.I) / out.total * 100) : 0;
    // Informational: raw presence, which excused absence legitimately reduces.
    out.kehadiranCukup = out.total === 0 ? true : out.persen >= D.MIN_KEHADIRAN;
    // Decisive: unexcused absence only.
    out.memenuhiSyarat = out.total === 0 ? true : out.persenAlpa <= D.MAKS_ALPA_PERSEN;
    if (satuan === 'hari') {
      out.alpaHari = out.A;
      out.memenuhiSyarat = out.memenuhiSyarat && out.A <= D.MAKS_ALPA_HARI;
    }
    out.satuan = satuan || 'sesi';
    return out;
  }

  D.rollupPresensi = function (records, satuan) {
    var out = { H: 0, S: 0, I: 0, A: 0, total: 0 };
    for (var i = 0; i < records.length; i++) {
      var s = records[i] && records[i].status;
      if (out[s] === undefined) continue;
      out[s]++;
      out.total++;
    }
    return finishRollup(out, satuan);
  };

  // Sums per-subject rollups into a semester rollup. Kept separate so the
  // assertion suite can check that the two agree instead of trusting one path.
  D.mergeRollups = function (rollups, satuan) {
    var out = { H: 0, S: 0, I: 0, A: 0, total: 0 };
    for (var i = 0; i < rollups.length; i++) {
      out.H += rollups[i].H; out.S += rollups[i].S;
      out.I += rollups[i].I; out.A += rollups[i].A;
      out.total += rollups[i].total;
    }
    return finishRollup(out, satuan);
  };

  /* Which rule, if any, tripped — so the callout can name it instead of
   * printing "kehadiran di bawah ambang" over a hospitalised child. */
  D.evaluasiKehadiran = function (rollHari) {
    var alasan = [];
    if (rollHari.A > D.MAKS_ALPA_HARI) {
      alasan.push('ketidakhadiran tanpa keterangan ' + rollHari.A + ' hari, melampaui batas ' + D.MAKS_ALPA_HARI + ' hari');
    }
    if (rollHari.total && rollHari.persenAlpa > D.MAKS_ALPA_PERSEN) {
      alasan.push('alpa ' + rollHari.persenAlpa + '% dari hari efektif, melampaui batas ' + D.MAKS_ALPA_PERSEN + '%');
    }
    return {
      terpenuhi: alasan.length === 0,
      alasan: alasan,
      alpaHari: rollHari.A,
      sakitHari: rollHari.S,
      izinHari: rollHari.I,
      hariEfektif: rollHari.total,
      maksAlpaHari: D.MAKS_ALPA_HARI,
      maksAlpaPersen: D.MAKS_ALPA_PERSEN,
      kehadiranPersen: rollHari.persen,
      minKehadiran: D.MIN_KEHADIRAN,
      kehadiranCukup: rollHari.kehadiranCukup
    };
  };

  /* =============================================== 7. Iuran komite ==
   * This school is a SMP NEGERI. It therefore does NOT levy SPP: SPP at a
   * state junior secondary school was abolished, and what remains is a
   * voluntary komite contribution agreed with parents. Voluntary means there
   * is no such thing as a tunggakan, no demand letter, and no sanction on a
   * child whose family does not pay — modelling it as arrears would describe a
   * different kind of school from the one whose intake runs on zonasi.
   *
   * What survives from the fee ledger, because it is the part that is actually
   * a bug magnet: a month that has not fallen due yet is NOT outstanding.
   */
  D.KOMITE_SIFAT = 'sukarela';

  D.komiteStatusBulan = function (entry, now) {
    if (entry.bebas) return 'bebas';
    if (entry.paidAt) return 'lunas';
    var due = Date.UTC(entry.year, entry.month - 1, 10);
    return (now >= due) ? 'belum-dibayar' : 'belum-jatuh-tempo';
  };

  D.rollupKomite = function (ledger, now) {
    var out = { lunas: 0, belumDibayar: 0, bebas: 0, belum: 0, nominalBelum: 0, bulan: [] };
    for (var i = 0; i < ledger.length; i++) {
      var e = ledger[i];
      var st = D.komiteStatusBulan(e, now);
      if (st === 'lunas') out.lunas++;
      else if (st === 'bebas') out.bebas++;
      else if (st === 'belum-dibayar') { out.belumDibayar++; out.nominalBelum += e.tarif; }
      else out.belum++;
      out.bulan.push({ year: e.year, month: e.month, status: st, tarif: e.tarif, paidAt: e.paidAt || null });
    }
    return out;
  };

  D.KOMITE_STATUS_LABEL = {
    'lunas': 'sudah dibayar',
    'belum-dibayar': 'belum dibayar (sukarela, tanpa sanksi)',
    'bebas': 'dibebaskan (pemegang KIP)',
    'belum-jatuh-tempo': 'belum jatuh tempo'
  };

  D.rupiah = function (n) {
    var s = String(Math.round(Math.abs(n)));
    var parts = [];
    while (s.length > 3) { parts.unshift(s.slice(-3)); s = s.slice(0, -3); }
    parts.unshift(s);
    return (n < 0 ? '-' : '') + 'Rp' + parts.join('.');
  };

  /* ========================================================= 8. PPDB ==
   * Selection is per jalur (pathway), not one global ranking, and each jalur
   * ranks on its own criterion. Modelled on the national PPDB split, and the
   * shares are BOUNDS, not targets — which is exactly where naive
   * implementations break the regulation:
   *
   *   zonasi       >= 50% of the intake, ranked by distance from home
   *   afirmasi     >= 15%, holders of a poverty/inclusion certificate, by distance
   *   perpindahan  <=  5%, parents relocated for work
   *   prestasi     the RESIDUAL — it absorbs the rounding remainder
   *
   * Absorbing the remainder in whichever jalur happens to sit last in the array
   * is how a school ends up publishing 6 perpindahan seats out of 96 (6.25%,
   * over a hard 5% ceiling) and 14 afirmasi seats (14.58%, under a 15% floor).
   * A published pengumuman with those numbers gets annulled on appeal, so the
   * floors round UP, the ceiling rounds DOWN, and prestasi takes what is left.
   *
   * PPDB is also explicitly NOT first-come-first-served. Registration order
   * decides nothing except inside jalur perpindahan, where the date IS the
   * criterion; everywhere else ties break on age, oldest first, which is what
   * juknis generally specify.
   */
  D.JALUR = [
    { id: 'zonasi', label: 'Zonasi', share: 0.50, batas: 'min', rank: 'jarak', note: 'terdekat lebih dulu; seri dipecah usia lebih tua' },
    { id: 'afirmasi', label: 'Afirmasi', share: 0.15, batas: 'min', rank: 'jarak', note: 'pemegang KIP/KPS, terdekat lebih dulu' },
    { id: 'prestasi', label: 'Prestasi', share: 0.30, batas: 'sisa', rank: 'skor', note: 'rapor + prestasi, skor tertinggi lebih dulu' },
    { id: 'perpindahan', label: 'Perpindahan Tugas', share: 0.05, batas: 'maks', rank: 'tanggal', note: 'pendaftar lebih awal lebih dulu (tanggal memang kriterianya di sini)' }
  ];

  D.PPDB_USIA_MAKS = 15;   // tahun, pada 1 Juli tahun masuk (SMP)
  D.PPDB_USIA_MIN = 11;    // tahun, batas bawah yang wajar untuk SMP

  // 1 Juli of the intake year — the date every PPDB age rule is measured on.
  D.ppdbTanggalAcuan = function (ta) {
    var p = D.parseTahunAjaran(ta);
    if (!p) return null;
    return Date.UTC(p.start, 6, 1);
  };

  /* Age eligibility, checked BEFORE ranking and refused by name. An applicant
   * who is over the ceiling is not ranked last, they are not ranked at all. */
  D.cekUsiaPendaftar = function (p, tanggalAcuan, usiaMaks, usiaMin) {
    usiaMaks = usiaMaks === undefined ? D.PPDB_USIA_MAKS : usiaMaks;
    usiaMin = usiaMin === undefined ? D.PPDB_USIA_MIN : usiaMin;
    if (!p.tglLahir) return { ok: true, usia: null, alasan: '' };
    var usia = D.usiaTahun(p.tglLahir, tanggalAcuan);
    if (usia > usiaMaks) {
      return {
        ok: false, usia: usia,
        alasan: 'Usia ' + usia + ' tahun pada 1 Juli melampaui batas ' + usiaMaks +
          ' tahun untuk jenjang SMP.'
      };
    }
    if (usia < usiaMin) {
      return {
        ok: false, usia: usia,
        alasan: 'Usia ' + usia + ' tahun pada 1 Juli di bawah batas wajar ' + usiaMin + ' tahun untuk jenjang SMP.'
      };
    }
    return { ok: true, usia: usia, alasan: '' };
  };

  function comparePendaftar(mode) {
    return function (a, b) {
      var d;
      if (mode === 'jarak') d = a.jarakMeter - b.jarakMeter;
      else if (mode === 'skor') d = b.skor - a.skor;
      else d = a.daftarAt - b.daftarAt;
      if (d !== 0) return d;
      /* Deterministic tie-break, and deliberately NOT registration order:
       * "PPDB bukan siapa cepat dia dapat". Older candidate first, then NISN.
       * A selection that reorders on reload cannot be defended to a parent. */
      var la = a.tglLahir ? D.parseYmd(a.tglLahir) : null;
      var lb = b.tglLahir ? D.parseYmd(b.tglLahir) : null;
      if (la !== null && lb !== null && la !== lb) return la - lb;   // earlier birth = older = first
      return a.nisn < b.nisn ? -1 : (a.nisn > b.nisn ? 1 : 0);
    };
  }
  D.comparePendaftar = comparePendaftar;

  /* Quota split honouring the bounds. Floors round up, the ceiling rounds down,
   * and the single 'sisa' jalur takes the remainder. */
  D.kuotaJalur = function (kuotaTotal) {
    var kuota = {}, allocated = 0, sisaId = null, i;
    for (i = 0; i < D.JALUR.length; i++) {
      var jl = D.JALUR[i];
      if (jl.batas === 'sisa') { sisaId = jl.id; continue; }
      var k = jl.batas === 'min'
        ? Math.ceil(kuotaTotal * jl.share)     // a floor in the regulation rounds UP
        : Math.floor(kuotaTotal * jl.share);   // a ceiling in the regulation rounds DOWN
      kuota[jl.id] = k;
      allocated += k;
    }
    if (sisaId) kuota[sisaId] = Math.max(0, kuotaTotal - allocated);
    return kuota;
  };

  D.seleksiPpdb = function (pendaftar, kuotaTotal, cadanganPerJalur, opts) {
    cadanganPerJalur = cadanganPerJalur === undefined ? 5 : cadanganPerJalur;
    opts = opts || {};
    var tanggalAcuan = opts.tanggalAcuan === undefined ? null : opts.tanggalAcuan;
    var kuota = D.kuotaJalur(kuotaTotal);
    var i, j;

    var byJalur = {}, hasil = [], ringkas = [], gugur = [];
    for (i = 0; i < D.JALUR.length; i++) byJalur[D.JALUR[i].id] = [];

    for (i = 0; i < pendaftar.length; i++) {
      var p = pendaftar[i];
      if (tanggalAcuan !== null) {
        var cek = D.cekUsiaPendaftar(p, tanggalAcuan, opts.usiaMaks, opts.usiaMin);
        if (!cek.ok) {
          gugur.push({ nisn: p.nisn, nama: p.nama, jalur: p.jalur, usia: cek.usia, alasan: cek.alasan, ref: p });
          continue;
        }
      }
      if (byJalur[p.jalur]) byJalur[p.jalur].push(p);
    }

    // Pass 1: fill each jalur, remember unused seats.
    var pending = [], sisaJalur = {};
    for (i = 0; i < D.JALUR.length; i++) {
      var jal = D.JALUR[i];
      var list = byJalur[jal.id].slice().sort(comparePendaftar(jal.rank));
      var take = Math.min(kuota[jal.id], list.length);
      sisaJalur[jal.id] = kuota[jal.id] - take;
      pending.push({ jalur: jal, list: list, take: take });
    }

    /* Pass 2: seats a jalur could not fill roll into zonasi, per the
     * regulation — they are not lost. Written as a single computation over the
     * rollover total rather than a loop that mutates the counter it reads, so
     * it stays correct whether or not zonasi happens to be oversubscribed. */
    var rollover = 0;
    for (i = 0; i < D.JALUR.length; i++) if (D.JALUR[i].id !== 'zonasi') rollover += sisaJalur[D.JALUR[i].id];
    var rolloverTerpakai = 0;
    if (rollover > 0) {
      for (i = 0; i < pending.length; i++) {
        if (pending[i].jalur.id !== 'zonasi') continue;
        rolloverTerpakai = Math.min(rollover, pending[i].list.length - pending[i].take);
        pending[i].take += rolloverTerpakai;
        sisaJalur.zonasi = (kuota.zonasi + rollover) - pending[i].take;
      }
    }

    for (i = 0; i < pending.length; i++) {
      var pd = pending[i];
      for (j = 0; j < pd.list.length; j++) {
        var status = j < pd.take ? 'diterima'
          : (j < pd.take + cadanganPerJalur ? 'cadangan' : 'tidak-diterima');
        hasil.push({
          nisn: pd.list[j].nisn, nama: pd.list[j].nama, jalur: pd.jalur.id,
          peringkat: j + 1, status: status, ref: pd.list[j]
        });
      }
      ringkas.push({
        jalur: pd.jalur.id, label: pd.jalur.label, kuota: kuota[pd.jalur.id],
        batas: pd.jalur.batas, share: pd.jalur.share,
        persen: kuotaTotal ? D.round2(kuota[pd.jalur.id] / kuotaTotal * 100) : 0,
        diterima: pd.take, pendaftar: pd.list.length,
        cadangan: Math.max(0, Math.min(cadanganPerJalur, pd.list.length - pd.take)),
        kriteria: pd.jalur.note
      });
    }
    gugur.forEach(function (g) {
      hasil.push({
        nisn: g.nisn, nama: g.nama, jalur: g.jalur, peringkat: null,
        status: 'tidak-memenuhi-syarat', alasan: g.alasan, ref: g.ref
      });
    });
    return {
      hasil: hasil, ringkas: ringkas, kuotaTotal: kuotaTotal, kuota: kuota,
      gugur: gugur, rolloverTerpakai: rolloverTerpakai
    };
  };

  /* Checks the published split against the regulation. The app runs this and
   * prints the result, because "we implemented the shares" and "the shares we
   * published are legal" are different claims. */
  D.periksaKuota = function (kuota, kuotaTotal) {
    var out = [];
    for (var i = 0; i < D.JALUR.length; i++) {
      var jl = D.JALUR[i];
      var k = kuota[jl.id] || 0;
      var persen = kuotaTotal ? k / kuotaTotal * 100 : 0;
      var ok = true, aturan = '';
      if (jl.batas === 'min') { ok = persen >= jl.share * 100 - 1e-9; aturan = 'minimal ' + (jl.share * 100) + '%'; }
      else if (jl.batas === 'maks') { ok = persen <= jl.share * 100 + 1e-9; aturan = 'maksimal ' + (jl.share * 100) + '%'; }
      else { aturan = 'sisa kuota'; }
      out.push({ jalur: jl.id, label: jl.label, kuota: k, persen: D.round2(persen), aturan: aturan, ok: ok });
    }
    return out;
  };

  /* ======================================================== 9. Roles ==
   * Four roles, and the interesting part is what each one may NOT do.
   * A denial returns a sentence, because "the button is missing" teaches a
   * user nothing and hides bugs — the app renders the control and explains.
   */
  D.ROLES = [
    { id: 'admin', label: 'Admin / TU', note: 'data induk, PPDB, iuran komite. Tidak boleh mengubah nilai.' },
    { id: 'guru', label: 'Guru Mapel', note: 'nilai & presensi untuk kelas yang ia ampu saja.' },
    { id: 'wali', label: 'Wali Kelas', note: 'seluruh nilai rombelnya untuk rapor, menulis mapelnya sendiri, sikap dan catatan.' },
    { id: 'ortu', label: 'Orang Tua', note: 'baca saja, satu anak.' }
  ];

  function deny(reason) { return { allowed: false, reason: reason }; }
  function allow(reason) { return { allowed: true, reason: reason || '' }; }

  /* can(user, action, ctx)
   *   user = { role, guruId?, rombelId?, nisn? }
   *   ctx  = { pengampuGuruId?, rombelId?, nisn?, ta?, mapelId? }
   */
  D.can = function (user, action, ctx) {
    user = user || {}; ctx = ctx || {};
    var role = user.role;

    if (role === 'admin') {
      if (action === 'nilai.write') {
        return deny('Admin/TU tidak berwenang mengubah nilai. Penilaian adalah kewenangan guru pengampu; TU hanya mengelola data induk, PPDB dan iuran komite. Minta guru pengampu yang mengubahnya.');
      }
      if (action === 'presensi.write') {
        return deny('Presensi per sesi diisi oleh guru pengampu mata pelajaran, bukan TU.');
      }
      if (action === 'presensi.harian.write') {
        return deny('Presensi harian dicatat wali kelas, bukan TU.');
      }
      if (action === 'sikap.write') {
        return deny('Penilaian sikap dan catatan wali adalah kewenangan wali kelas. TU tidak menilai anak.');
      }
      return allow();
    }

    if (role === 'guru' || role === 'wali') {
      if (action === 'sikap.write') {
        if (role !== 'wali') return deny('Penilaian sikap dan catatan rapor ditulis wali kelas, bukan guru mapel.');
        if (ctx.rombelId && ctx.rombelId !== user.rombelId) {
          return deny('Sikap hanya boleh ditulis oleh wali kelas rombel yang bersangkutan.');
        }
        return allow('wali kelas rombel ini');
      }
      if (action === 'presensi.harian.write') {
        if (role !== 'wali') return deny('Presensi harian (per hari, seluruh rombel) dicatat wali kelas; guru mapel mencatat presensi per sesi mapelnya.');
        if (ctx.rombelId && ctx.rombelId !== user.rombelId) {
          return deny('Presensi harian hanya boleh dicatat oleh wali kelas rombel yang bersangkutan.');
        }
        return allow('wali kelas rombel ini');
      }
      if (action === 'nilai.write' || action === 'presensi.write') {
        if (!ctx.pengampuGuruId) return deny('Tidak ada guru pengampu yang tercatat untuk kelas/mapel ini.');
        if (ctx.pengampuGuruId !== user.guruId) {
          return deny('Kelas ini diampu oleh guru lain (' + (ctx.pengampuNama || ctx.pengampuGuruId) +
            '). Seorang guru hanya boleh menulis nilai dan presensi untuk kelas yang ia ampu sendiri' +
            (role === 'wali' ? ' — status wali kelas memberi hak BACA seluruh rombel, bukan hak tulis.' : '.'));
        }
        return allow();
      }
      if (action === 'nilai.read' || action === 'rapor.read') {
        if (role === 'wali' && ctx.rombelId && ctx.rombelId === user.rombelId) return allow('wali kelas rombel ini');
        if (ctx.pengampuGuruId && ctx.pengampuGuruId === user.guruId) return allow('guru pengampu');
        if (action === 'rapor.read' && role === 'wali') {
          return deny('Rapor hanya dapat dibuka oleh wali kelas rombel yang bersangkutan.');
        }
        if (action === 'rapor.read') return deny('Guru mapel melihat nilai mapelnya sendiri; rapor utuh adalah kewenangan wali kelas.');
        return allow('nilai rombel dapat dibaca guru');
      }
      if (action === 'siswa.write' || action === 'ppdb.decide' || action === 'komite.write' || action === 'config.write') {
        return deny('Perubahan data induk, PPDB, iuran komite dan konfigurasi penilaian adalah kewenangan Admin/TU.');
      }
      if (action === 'jadwal.solve') {
        return deny('Penyusunan jadwal dilakukan oleh Admin/TU (biasanya Wakil Kurikulum). Guru mengajukan ketidaksediaan, tidak menjalankan solver.');
      }
      return allow();
    }

    if (role === 'ortu') {
      if (action.indexOf('.write') > 0 || action === 'ppdb.decide' || action === 'jadwal.solve') {
        return deny('Akun orang tua bersifat baca-saja.');
      }
      if (ctx.nisn && user.nisn && ctx.nisn !== user.nisn) {
        return deny('Akun orang tua hanya dapat melihat data anaknya sendiri (NISN ' + user.nisn + ').');
      }
      if (action === 'siswa.read' && !ctx.nisn) {
        return deny('Daftar seluruh peserta didik tidak terbuka untuk akun orang tua.');
      }
      return allow();
    }

    return deny('Peran tidak dikenal.');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
