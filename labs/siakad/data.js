/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — data.js
 * The whole school, fabricated from one integer seed.
 *
 * NOTHING IN HERE IS REAL. No name, no NISN, no parent, no mark, no fee. Names
 * are assembled syllable-by-syllable from invented phonotactics rather than
 * taken from any list of people; NISN values come from a synthetic block that
 * this file allocates itself. Children's records are the most sensitive
 * category a school system holds after medical data, so the demo does not
 * contain any — and it deliberately contains NO identifier that could collide
 * with a living person's:
 *
 *   - no NIK at all: there is no structurally safe way to fabricate one;
 *   - no NIP either: a syntactically valid 18-digit NIP is a real civil
 *     servant's number with high probability, and NIPs are published in SK, so
 *     an obviously ABSENT NIP is safer than a fabricated one. The Guru tab says
 *     so out loud rather than showing a wrong-length placeholder;
 *   - no parent phone number: an 08xx number in the live Indonesian mobile
 *     numbering space is the one field in a fake school that can dial a real
 *     human being. The field is not generated at all.
 *
 * KURIKULUM: Kurikulum 2013 for SMP, and consistently so — the JP allocation
 * below is the Permendikbud 35/2018 structure (38 JP intrakurikuler + 2 JP
 * muatan lokal), and the assessment apparatus that goes with it (KKM, predikat
 * A–D derived from KKM, KI-3/KI-4 split) lives in domain.js. A wakasek
 * kurikulum reads the JP table before anything else, because it is what they
 * build the jadwal from, so it has to be a table they recognise.
 *
 * Design note worth reading: marks and attendance are NOT stored. They are
 * pure functions of (nisn, mapel, tahun ajaran, semester, aspek, komponen) and
 * of (nisn, tanggal) via a hash. ~300 students x 11 subjects x 2 aspects x 4
 * components x 2 semesters x 2 years is ~100k marks; deriving them means first
 * paint is instant, a reload cannot drift, and the only thing the database has
 * to hold is the teacher's *edits* — which is the only genuinely user data.
 */
(function (root) {
  'use strict';

  var D = root.SIAKAD_DOMAIN;
  var S = {};
  root.SIAKAD_DATA = S;

  /* A fixed reference date, so the demo behaves identically whenever it is
   * opened. Everything time-dependent (which komite months are due, which
   * semester has actually happened, which penilaian windows have closed) is
   * measured against this and the UI says so.
   *
   * It sits in the week the ganjil rapor is issued: PAS finished on 4 December
   * 2026, so semester ganjil is complete and its rapor is real, while semester
   * genap has not started at all — which is what makes the "a rapor for a
   * semester that has not happened is refused, not fabricated" behaviour
   * visible in one click on the Semester selector. */
  S.SEKARANG = Date.UTC(2026, 11, 11);
  S.SEKARANG_LABEL = '11 Desember 2026';

  S.TA_LALU = '2025/2026';
  S.TA_AKTIF = '2026/2027';
  S.SEMESTER_AKTIF = 'ganjil';

  /* ------------------------------------------------------------ kalender --
   * A five-day week (sekolah lima hari), which is why Senin-Kamis are long:
   * 11 JP of 40 minutes, 07.00 to 14.50, with two breaks — after JP 3
   * (istirahat pertama) and after JP 7 (istirahat dan salat zuhur). Jum'at is
   * short and ends before Jumatan.
   *
   * `breakAfter` splits a day into segments, and a lesson block may never
   * straddle one — a 3-JP block cannot have istirahat in the middle of it. The
   * segment widths are load-bearing for feasibility, not cosmetic: with breaks
   * after JP 4 and JP 8 the day would be 4/4/3 and only two segments per day
   * could hold a 3-JP block flush, which is not enough for a 40-JP week. 3/4/4
   * gives three, and 50 slots against 40 JP leaves the ten periods of slack a
   * real school keeps for upacara, projek and remedial.
   */
  S.HARI = [
    { id: 'senin', label: 'Senin', slots: 11, breakAfter: [3, 7] },
    { id: 'selasa', label: 'Selasa', slots: 11, breakAfter: [3, 7] },
    { id: 'rabu', label: 'Rabu', slots: 11, breakAfter: [3, 7] },
    { id: 'kamis', label: 'Kamis', slots: 11, breakAfter: [3, 7] },
    { id: 'jumat', label: "Jum'at", slots: 6, breakAfter: [3] }
  ];
  S.JP_MENIT = 40;
  S.JAM_MULAI = 7 * 60; // 07:00

  // Wall-clock label for a slot, breaks included, so the printed jadwal looks
  // like the one on the wall rather than like an array index.
  S.jamSlot = function (hariIdx, slot) {
    var h = S.HARI[hariIdx];
    var mins = S.JAM_MULAI;
    for (var i = 1; i < slot; i++) {
      mins += S.JP_MENIT;
      if (h.breakAfter.indexOf(i) >= 0) mins += 15;
    }
    var end = mins + S.JP_MENIT;
    function fmt(m) {
      return String(Math.floor(m / 60)).padStart(2, '0') + '.' + String(m % 60).padStart(2, '0');
    }
    return fmt(mins) + '–' + fmt(end);
  };

  S.segments = function (hariIdx) {
    var h = S.HARI[hariIdx], segs = [], start = 1;
    for (var s = 1; s <= h.slots; s++) {
      if (h.breakAfter.indexOf(s) >= 0 || s === h.slots) {
        segs.push({ from: start, to: s });
        start = s + 1;
      }
    }
    return segs;
  };

  /* ================================================ kalender akademik ==
   * Presensi in this app is anchored to a DATE, not to a session ordinal. That
   * is the difference between a system that can print "Sakit 4 hari" on a rapor
   * — which is what an Indonesian rapor's Ketidakhadiran block actually
   * contains — and one that can only print a sum of independent per-subject
   * draws that reconcile with no day count at all, and cannot answer "was my
   * child at school on 14 September".
   *
   * Structure of a semester here:
   *   21 calendar weeks from the start Monday
   *   -  3 libur weeks (jeda tengah semester and two national/religious breaks)
   *   = 18 pekan efektif, of which pekan 9 is PTS and pekan 18 is PAS
   *   => 16 pekan KBM of ordinary lessons, and 90 hari efektif of presensi
   */
  S.PEKAN_EFEKTIF = 18;
  S.PEKAN_KBM = 16;
  S.PEKAN_PTS = 9;
  S.PEKAN_PAS = 18;
  var LIBUR_SPAN = [7, 10, 16];   // 1-based positions in the 21-week span

  var kalenderCache = {};

  S.kalenderSemester = function (ta, semester) {
    var ck = ta + '|' + semester;
    if (kalenderCache[ck]) return kalenderCache[ck];
    var p = D.parseTahunAjaran(ta);
    if (!p) return null;
    var awal = semester === 'ganjil'
      ? D.seninBerikut(Date.UTC(p.start, 6, 13))   // pertengahan Juli
      : D.seninBerikut(Date.UTC(p.end, 0, 4));     // awal Januari

    var pekan = [], tanggalKbm = [], tanggalUjian = [];
    var kbmNo = 0;
    var spanTotal = S.PEKAN_EFEKTIF + LIBUR_SPAN.length;
    for (var w = 1; w <= spanTotal; w++) {
      var senin = D.addDays(awal, (w - 1) * 7);
      if (LIBUR_SPAN.indexOf(w) >= 0) {
        pekan.push({ span: w, no: null, jenis: 'libur', senin: senin });
        continue;
      }
      kbmNo++;
      var jenis = kbmNo === S.PEKAN_PTS ? 'pts' : (kbmNo === S.PEKAN_PAS ? 'pas' : 'kbm');
      var hari = [];
      for (var d = 0; d < 5; d++) hari.push(D.ymd(D.addDays(senin, d)));
      pekan.push({ span: w, no: kbmNo, jenis: jenis, senin: senin, hari: hari });
      if (jenis === 'kbm') tanggalKbm = tanggalKbm.concat(hari);
      else tanggalUjian = tanggalUjian.concat(hari);
    }
    var semuaHari = [];
    pekan.forEach(function (pk) { if (pk.hari) semuaHari = semuaHari.concat(pk.hari); });

    var out = {
      ta: ta, semester: semester,
      mulai: semuaHari[0],
      selesai: semuaHari[semuaHari.length - 1],
      mulaiTs: D.parseYmd(semuaHari[0]),
      selesaiTs: D.parseYmd(semuaHari[semuaHari.length - 1]),
      pekan: pekan,
      hariEfektif: semuaHari,       // 90 hari, presensi dihitung di sini
      tanggalKbm: tanggalKbm,       // 80 hari pembelajaran biasa
      tanggalUjian: tanggalUjian    // 10 hari PTS + PAS
    };
    out.pembagianRapor = D.ymd(D.addDays(out.selesaiTs, 7));
    kalenderCache[ck] = out;
    return out;
  };

  // 'belum-mulai' | 'berjalan' | 'selesai'
  S.statusSemester = function (ta, semester, now) {
    now = now === undefined ? S.SEKARANG : now;
    var k = S.kalenderSemester(ta, semester);
    if (!k) return 'belum-mulai';
    if (now < k.mulaiTs) return 'belum-mulai';
    if (now > k.selesaiTs) return 'selesai';
    return 'berjalan';
  };

  // Effective days that have actually happened as of `now`.
  S.hariEfektifHingga = function (ta, semester, now) {
    now = now === undefined ? S.SEKARANG : now;
    var k = S.kalenderSemester(ta, semester);
    if (!k) return [];
    return k.hariEfektif.filter(function (t) { return D.parseYmd(t) <= now; });
  };

  /* ---- penilaian windows ----
   * Each component becomes available only after its assessment window closes.
   * Before that the cell is empty and says "belum dinilai"; it is NOT a zero,
   * and no nilai akhir is produced from a partial set. The komite ledger is
   * already scrupulous about not dunning a month that has not fallen due — the
   * gradebook has to be equally scrupulous about not grading a term that has
   * not happened.
   */
  S.JENDELA_KOMPONEN = {
    peng: { tugas: 4, uh: 6, pts: S.PEKAN_PTS, pas: S.PEKAN_PAS },
    ket: { praktik: 5, produk: 9, proyek: 14, porto: S.PEKAN_PAS }
  };

  S.pekanSelesaiTs = function (ta, semester, pekanNo) {
    var k = S.kalenderSemester(ta, semester);
    if (!k) return null;
    for (var i = 0; i < k.pekan.length; i++) {
      if (k.pekan[i].no === pekanNo && k.pekan[i].hari) {
        return D.parseYmd(k.pekan[i].hari[k.pekan[i].hari.length - 1]);
      }
    }
    return null;
  };

  S.komponenSiap = function (ta, semester, aspekId, komponenId, now) {
    now = now === undefined ? S.SEKARANG : now;
    var tabel = S.JENDELA_KOMPONEN[aspekId] || S.JENDELA_KOMPONEN.peng;
    var pekanNo = tabel[komponenId];
    if (pekanNo === undefined) return false;
    var ts = S.pekanSelesaiTs(ta, semester, pekanNo);
    if (ts === null) return false;
    return now >= ts;
  };

  S.komponenBelumLabel = function (ta, semester, aspekId, komponenId) {
    var tabel = S.JENDELA_KOMPONEN[aspekId] || S.JENDELA_KOMPONEN.peng;
    var pekanNo = tabel[komponenId];
    var ts = S.pekanSelesaiTs(ta, semester, pekanNo);
    if (ts === null) return 'jadwal penilaian belum ditetapkan';
    return 'dijadwalkan selesai ' + D.tanggalPanjang(ts) + ' (pekan efektif ke-' + pekanNo + ')';
  };

  /* -------------------------------------------------------------- mapel --
   * Struktur Kurikulum 2013 SMP/MTs (Permendikbud 35/2018): 38 JP
   * intrakurikuler, plus 2 JP muatan lokal Bahasa Jawa yang ditambahkan
   * satuan pendidikan — 40 JP per minggu.
   *
   * `blok` is how the weekly JP are cut into lessons: 6 JP of Bahasa Indonesia
   * is two 3-JP lessons, not six scattered singles. `ruang` marks a lesson that
   * must run somewhere specific — the IPA practical needs the lab, Informatika
   * needs the computer room, PJOK needs the field or the hall.
   *
   * Informatika sits in the "Prakarya dan/atau Informatika" slot that K13
   * revisi gives the school a choice over; this school chose Informatika, so
   * Prakarya is not offered. Offering BOTH at 2 JP each, as an earlier draft of
   * this file did, is 2 JP more than the structure allows.
   *
   * `materi` feeds the deskripsi capaian on the rapor — a K13 rapor never
   * prints a bare number.
   */
  S.MAPEL = [
    {
      id: 'pabp', kode: 'PABP', nama: 'Pendidikan Agama dan Budi Pekerti', kelompok: 'A',
      jp: 3, blok: [{ len: 3 }], kkm: 75, berat: false,
      materi: ['iman kepada kitab Allah', 'perilaku jujur dan amanah', 'tata cara salat sunah', 'sejarah peradaban Islam']
    },
    {
      id: 'ppkn', kode: 'PPKn', nama: 'Pendidikan Pancasila dan Kewarganegaraan', kelompok: 'A',
      jp: 3, blok: [{ len: 3 }], kkm: 72, berat: false,
      materi: ['norma dan keadilan', 'perumusan dan penetapan Pancasila', 'keberagaman masyarakat Indonesia', 'kerja sama dalam berbagai bidang']
    },
    {
      id: 'bind', kode: 'B.IND', nama: 'Bahasa Indonesia', kelompok: 'A',
      jp: 6, blok: [{ len: 2 }, { len: 2 }, { len: 2 }], kkm: 72, berat: true,
      materi: ['teks berita', 'teks eksposisi', 'teks eksplanasi', 'puisi dan majas']
    },
    {
      id: 'mtk', kode: 'MTK', nama: 'Matematika', kelompok: 'A',
      jp: 5, blok: [{ len: 3 }, { len: 2 }], kkm: 68, berat: true,
      materi: ['bilangan bulat dan pecahan', 'bentuk aljabar', 'persamaan linear satu variabel', 'perbandingan dan skala']
    },
    {
      id: 'ipa', kode: 'IPA', nama: 'Ilmu Pengetahuan Alam', kelompok: 'A',
      jp: 5, blok: [{ len: 3 }, { len: 2, ruang: 'lab-ipa' }], kkm: 68, berat: true,
      materi: ['pengukuran dan besaran', 'klasifikasi makhluk hidup', 'suhu dan kalor', 'sistem organisasi kehidupan']
    },
    {
      id: 'ips', kode: 'IPS', nama: 'Ilmu Pengetahuan Sosial', kelompok: 'A',
      jp: 4, blok: [{ len: 2 }, { len: 2 }], kkm: 70, berat: false,
      materi: ['interaksi sosial', 'kondisi geografis Indonesia', 'kegiatan ekonomi masyarakat', 'kehidupan masa praaksara']
    },
    {
      id: 'bing', kode: 'B.ING', nama: 'Bahasa Inggris', kelompok: 'A',
      jp: 4, blok: [{ len: 2 }, { len: 2 }], kkm: 70, berat: true,
      materi: ['introducing self and others', 'descriptive text', 'simple present tense', 'procedure text']
    },
    {
      id: 'seni', kode: 'SBK', nama: 'Seni Budaya', kelompok: 'B',
      jp: 3, blok: [{ len: 3 }], kkm: 75, berat: false,
      materi: ['menggambar ragam hias', 'menyanyi lagu daerah', 'tari tradisional', 'seni peran']
    },
    {
      id: 'pjok', kode: 'PJOK', nama: 'Pendidikan Jasmani, Olahraga dan Kesehatan', kelompok: 'B',
      jp: 3, blok: [{ len: 3, ruang: 'lapangan' }], kkm: 75, berat: false,
      materi: ['permainan bola besar', 'atletik nomor lari', 'kebugaran jasmani', 'pola hidup sehat']
    },
    {
      id: 'infm', kode: 'INF', nama: 'Informatika', kelompok: 'B',
      jp: 2, blok: [{ len: 2, ruang: 'lab-komputer' }], kkm: 70, berat: false,
      pilihan: 'Prakarya dan/atau Informatika — satuan pendidikan ini memilih Informatika',
      materi: ['berpikir komputasional', 'sistem komputer', 'analisis data dengan spreadsheet', 'algoritma dan pemrograman blok']
    },
    {
      id: 'bjaw', kode: 'B.JAW', nama: 'Bahasa Jawa', kelompok: 'mulok',
      jp: 2, blok: [{ len: 2 }], kkm: 70, berat: false,
      materi: ['unggah-ungguh basa', 'geguritan', 'aksara Jawa', 'cerita rakyat']
    }
  ];

  S.JP_INTRA = 38;   // kelompok A + B menurut struktur K13 SMP
  S.JP_MULOK = 2;    // tambahan satuan pendidikan (Pergub muatan lokal)

  /* ---- guru ----
   * Fourteen teachers for eight rombel, not twenty-four. Total demand is
   * 8 x 40 = 320 JP; the 24-JP minimum that governs tunjangan sertifikasi puts
   * a full load at 24, so the honest headcount is about thirteen and a half.
   * Staffing it with twenty-four made every teacher's week half empty, which
   * quietly removed the constraint that makes a real jadwal hard.
   *
   * `kedua` is a second subject the teacher also holds. That is not a
   * modelling convenience: Informatika is chronically short-staffed and is
   * usually picked up by retrained Matematika/IPA teachers, and mulok Bahasa
   * Jawa is usually carried by IPS staff. The two Bahasa Inggris teachers land
   * at 16 JP and the app REPORTS that rather than hiding it — being under 24 JP
   * is exactly why such a teacher also teaches at another school, which is one
   * of the unavailability reasons in the data.
   */
  var GURU_ROSTER = [
    { mapel: 'pabp', jumlah: 1 },
    { mapel: 'ppkn', jumlah: 1 },
    { mapel: 'bind', jumlah: 2 },
    { mapel: 'mtk', jumlah: 2, kedua: 'infm' },
    { mapel: 'ipa', jumlah: 2, kedua: 'infm' },
    { mapel: 'ips', jumlah: 2, kedua: 'bjaw' },
    { mapel: 'bing', jumlah: 2 },
    { mapel: 'seni', jumlah: 1 },
    { mapel: 'pjok', jumlah: 1 }
  ];
  S.JP_MINIMAL_SERTIFIKASI = 24;

  S.RUANG_TIPE = {
    'kelas': 'Ruang kelas',
    'lab-ipa': 'Laboratorium IPA',
    'lab-komputer': 'Laboratorium Komputer',
    'lapangan': 'Lapangan / aula'
  };

  /* ------------------------------------------------------------- cohorts --
   * Rombel belong to a tahun ajaran. The 2026/2027 kelas 7 simply does not
   * exist in 2025/2026 — those children were still in SD — and the 2025/2026
   * kelas 9 does not exist in 2026/2027, because they left. Both cases are in
   * the data on purpose: they are what breaks a system that models "current
   * class" as a column on the student row.
   *
   * The third case, and the one that actually breaks naive schemas, is a child
   * whose tingkat does NOT follow from their angkatan. So the data also carries
   * one repeater, one mid-year transfer in and one transfer out — see MUTASI.
   */
  var COHORTS = [
    { angkatan: 2023, n: 58, status: 'lulus' },
    { angkatan: 2024, n: 54, status: 'aktif' },
    { angkatan: 2025, n: 90, status: 'aktif' },
    { angkatan: 2026, n: 96, status: 'aktif' }   // diisi dari hasil PPDB
  ];

  var HURUF = ['A', 'B', 'C', 'D', 'E', 'F'];
  var KAPASITAS_ROMBEL = 32;

  function tingkatNormal(angkatan, ta) {
    var p = D.parseTahunAjaran(ta);
    if (!p) return null;
    var t = 7 + (p.start - angkatan);
    return (t >= 7 && t <= 9) ? t : null;
  }

  /* ============================================================== build == */

  S.build = function (seed) {
    seed = seed === undefined ? 20260915 : seed;
    var rnd = D.mulberry32(seed);
    var registry = new D.NisnRegistry(seed ^ 0x5eed);
    var i, j, k;

    var sekolah = {
      seed: seed,
      nama: 'SMP Negeri Nusa Kenanga (satuan pendidikan fiktif)',
      bentuk: 'negeri',
      npsn: '00000000',
      alamat: 'Jl. Contoh Nomor 0, Kota Demo',
      kepala: D.fabricateNamaGuru(rnd, 'ppkn'),
      taList: [S.TA_LALU, S.TA_AKTIF],
      taAktif: S.TA_AKTIF,
      semesterAktif: S.SEMESTER_AKTIF,
      kurikulum: D.KURIKULUM
    };

    /* ---- ruang ---- */
    var ruang = [];
    for (i = 0; i < 8; i++) ruang.push({ id: 'R' + (i + 1), nama: 'Ruang ' + (i + 1), tipe: 'kelas' });
    ruang.push({ id: 'LAB-IPA', nama: 'Lab. IPA', tipe: 'lab-ipa' });
    ruang.push({ id: 'LAB-KOM', nama: 'Lab. Komputer', tipe: 'lab-komputer' });
    ruang.push({ id: 'LAP', nama: 'Lapangan', tipe: 'lapangan' });
    ruang.push({ id: 'AULA', nama: 'Aula serbaguna', tipe: 'lapangan' });

    /* ---- guru ---- */
    var guru = [], guruByMapel = {};
    S.MAPEL.forEach(function (m) { guruByMapel[m.id] = []; });
    var gi = 0;
    for (i = 0; i < GURU_ROSTER.length; i++) {
      var slot = GURU_ROSTER[i];
      for (j = 0; j < slot.jumlah; j++) {
        gi++;
        var g = {
          id: 'G' + String(gi).padStart(2, '0'),
          // Deliberately no NIP — see the header note. The UI explains the gap.
          nama: D.fabricateNamaGuru(rnd, slot.mapel),
          mapelUtama: slot.mapel,
          mapelKedua: slot.kedua || null,
          maxJamHarian: 7 + Math.floor(rnd() * 2),   // 7..8 JP in one day
          tidakTersedia: []
        };
        guru.push(g);
        guruByMapel[slot.mapel].push(g.id);
        if (slot.kedua) guruByMapel[slot.kedua].push(g.id);
      }
    }

    /* Declared unavailability. Real and mundane: study leave, a certification
     * day, a teacher shared with another school, Friday prayers duty. Kept to a
     * handful of teachers so the instance stays satisfiable — the Jadwal view
     * has a button that adds an impossible one on purpose. */
    var ALASAN = [
      'tugas belajar (kuliah S2) — Senin pagi',
      'mengajar di sekolah lain — Rabu siang',
      'pendampingan MGMP — Kamis akhir',
      'petugas Jumat — Jumat akhir',
      'dinas kedinasan — Selasa pagi'
    ];
    var pola = [
      { hari: 0, from: 1, to: 3 },
      { hari: 2, from: 8, to: 10 },
      { hari: 3, from: 9, to: 10 },
      { hari: 4, from: 4, to: 6 },
      { hari: 1, from: 1, to: 3 }
    ];
    for (i = 0; i < guru.length; i++) {
      var pIdx;
      // The under-loaded Bahasa Inggris staff are the ones who genuinely teach
      // elsewhere; that is the same fact as their 16-JP load, not a coincidence.
      if (guru[i].mapelUtama === 'bing') pIdx = 1;
      else if (rnd() > 0.28) continue;
      else pIdx = Math.floor(rnd() * pola.length);
      var p = pola[pIdx];
      for (k = p.from; k <= p.to; k++) guru[i].tidakTersedia.push({ hari: p.hari, slot: k });
      guru[i].alasanTidakTersedia = ALASAN[pIdx];
    }

    /* ---- PPDB first: the intake DEFINES the kelas 7, it does not describe it --
     * Running the selection after the roster was fixed produced two screens
     * that contradicted each other for a third of the intake: children enrolled
     * in 7A appeared on the PPDB tab as tidak-diterima, and thirty accepted
     * applicants were enrolled nowhere. A kepala sekolah checking one child
     * across two screens finds that in under a minute. So the selection runs
     * first, and the winners become the students. */
    var ppdb = buildPpdb(rnd, registry);

    /* ---- siswa ---- */
    var siswa = {}, nisnUrut = [];

    function tambahSiswa(rec) { siswa[rec.nisn] = rec; nisnUrut.push(rec.nisn); return rec; }

    function siswaBaru(nisn, nama, angkatan, seq, status, opts) {
      opts = opts || {};
      var lahirTahun = opts.lahirTahun !== undefined ? opts.lahirTahun : angkatan - 12 - Math.floor(rnd() * 2);
      return tambahSiswa({
        nisn: nisn,
        nis: D.makeNis(angkatan, seq),
        nama: nama,
        jk: opts.jk || (rnd() < 0.5 ? 'L' : 'P'),
        angkatan: angkatan,
        status: status,
        catatan: opts.catatan || '',
        tglLahir: opts.tglLahir || (lahirTahun + '-' + String(1 + Math.floor(rnd() * 12)).padStart(2, '0') +
          '-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0')),
        ayah: D.fabricateNama(rnd),
        ibu: D.fabricateNama(rnd),
        // No parent phone number is generated: see the header note.
        alamat: 'Dusun ' + D.fabricateWord(rnd, 2, 3) + ' RT ' + String(1 + Math.floor(rnd() * 9)).padStart(2, '0'),
        jarakMeter: opts.jarakMeter !== undefined ? opts.jarakMeter : 200 + Math.floor(rnd() * 9000),
        kip: opts.kip !== undefined ? opts.kip : rnd() < 0.14,
        enrol: {}
      });
    }

    for (j = 0; j < COHORTS.length; j++) {
      var co = COHORTS[j];
      if (co.angkatan === 2026) continue;   // comes from PPDB below
      for (i = 0; i < co.n; i++) {
        siswaBaru(registry.issue('siswa'), D.fabricateNama(rnd), co.angkatan, i + 1, co.status);
      }
    }

    // The accepted candidates ARE the kelas-7 students: same NISN, because a
    // child arriving from SD already has one. That is the point of a national
    // number — the school does not mint a new identity on admission.
    var diterima = ppdb.hasil.filter(function (h) { return h.status === 'diterima'; });
    diterima.sort(function (a, b) { return a.nama < b.nama ? -1 : (a.nama > b.nama ? 1 : 0); });
    for (i = 0; i < diterima.length; i++) {
      var c = diterima[i].ref;
      siswaBaru(c.nisn, c.nama, 2026, i + 1, 'aktif', {
        jk: c.jk, tglLahir: c.tglLahir, jarakMeter: c.jarakMeter, kip: c.kip,
        catatan: 'diterima PPDB jalur ' + c.jalur
      });
    }

    /* ---- mutasi: the three cases that break tingkat = f(angkatan) ---- */
    var aktif2024 = nisnUrut.filter(function (n) { return siswa[n].angkatan === 2024; });
    var aktif2025 = nisnUrut.filter(function (n) { return siswa[n].angkatan === 2025; });
    var mutasi = {
      tinggalKelas: aktif2024[Math.floor(D.det(seed + '|tinggal') * aktif2024.length)],
      keluar: aktif2024[Math.floor(D.det(seed + '|keluar') * aktif2024.length)],
      masukNisn: null
    };
    if (mutasi.keluar === mutasi.tinggalKelas) {
      mutasi.keluar = aktif2024[(aktif2024.indexOf(mutasi.tinggalKelas) + 7) % aktif2024.length];
    }
    // One child arrives mid-career from another SMP, carrying their own NISN.
    var pindahMasuk = siswaBaru(registry.issue('mutasi'), D.fabricateNama(rnd), 2025, aktif2025.length + 1, 'aktif', {
      catatan: 'mutasi masuk dari SMP lain pada ' + S.TA_AKTIF
    });
    mutasi.masukNisn = pindahMasuk.nisn;
    siswa[mutasi.tinggalKelas].catatan = 'tinggal kelas — mengulang tingkat 8 pada ' + S.TA_AKTIF;
    siswa[mutasi.keluar].catatan = 'mutasi keluar setelah ' + S.TA_LALU;
    siswa[mutasi.keluar].status = 'pindah';

    /* ---- enrolment, per tahun ajaran ----
     * tingkat is a PER-YEAR FACT, not a function of angkatan. The repeater
     * proves it: they are in tingkat 8 in both years, which no formula over
     * (angkatan, ta) can express.
     */
    function tingkatPada(nisn, ta) {
      var s = siswa[nisn];
      if (nisn === mutasi.keluar && ta === S.TA_AKTIF) return null;
      if (nisn === mutasi.masukNisn && ta === S.TA_LALU) return null;
      if (nisn === mutasi.tinggalKelas && ta === S.TA_AKTIF) return 8;
      return tingkatNormal(s.angkatan, ta);
    }

    var rombelByTa = {};
    for (i = 0; i < sekolah.taList.length; i++) {
      var ta = sekolah.taList[i];
      var perTingkat = { 7: [], 8: [], 9: [] };
      for (j = 0; j < nisnUrut.length; j++) {
        var tk = tingkatPada(nisnUrut[j], ta);
        if (tk) perTingkat[tk].push(nisnUrut[j]);
      }
      rombelByTa[ta] = [];
      [7, 8, 9].forEach(function (tingkat) {
        var anggota = perTingkat[tingkat];
        if (!anggota.length) return;
        var jumlahRombel = Math.max(1, Math.ceil(anggota.length / KAPASITAS_ROMBEL));
        /* Rombel are RESHUFFLED at kenaikan kelas — every SMP does this, and it
         * is what makes the "nomor absen is re-derived annually and is never an
         * identity" claim observable instead of merely asserted. The shuffle key
         * contains the tahun ajaran, so the same child lands in a different
         * rombel letter, at a different roster number, next year. */
        var urut = anggota.slice().sort(function (a, b) {
          var ka = D.det(a + '|' + ta + '|bagi'), kb = D.det(b + '|' + ta + '|bagi');
          return ka !== kb ? ka - kb : (a < b ? -1 : 1);
        });
        var buckets = [];
        for (var q = 0; q < jumlahRombel; q++) buckets.push([]);
        for (q = 0; q < urut.length; q++) buckets[q % jumlahRombel].push(urut[q]);
        for (q = 0; q < jumlahRombel; q++) {
          var nama = tingkat + HURUF[q];
          // Roster number is alphabetical INSIDE this rombel, this year.
          buckets[q].sort(function (a, b) {
            var na = siswa[a].nama, nb = siswa[b].nama;
            return na < nb ? -1 : (na > nb ? 1 : (a < b ? -1 : 1));
          });
          var rb = {
            ta: ta, nama: nama, tingkat: tingkat, id: D.rombelKey(ta, nama),
            siswa: buckets[q], waliGuruId: null, ruangId: null
          };
          for (var z = 0; z < buckets[q].length; z++) {
            siswa[buckets[q][z]].enrol[ta] = {
              rombelNama: nama, rombelId: rb.id, tingkat: tingkat, absen: z + 1
            };
          }
          rombelByTa[ta].push(rb);
        }
      });
    }

    /* ---- ruang kelas ---- */
    var kelasRuang = ruang.filter(function (r) { return r.tipe === 'kelas'; });
    for (i = 0; i < sekolah.taList.length; i++) {
      var t3 = sekolah.taList[i];
      for (j = 0; j < rombelByTa[t3].length; j++) {
        rombelByTa[t3][j].ruangId = kelasRuang[j % kelasRuang.length].id;
      }
    }

    /* ---- pengampu: who teaches which subject in which rombel ---- */
    // Round-robin inside each subject's teacher pool so the weekly load is even.
    var pengampu = {};
    for (i = 0; i < sekolah.taList.length; i++) {
      var t4 = sekolah.taList[i];
      var rot = {};
      for (j = 0; j < rombelByTa[t4].length; j++) {
        var rb2 = rombelByTa[t4][j];
        for (k = 0; k < S.MAPEL.length; k++) {
          var mid = S.MAPEL[k].id;
          var pool = guruByMapel[mid];
          rot[mid] = (rot[mid] || 0);
          pengampu[t4 + '|' + rb2.nama + '|' + mid] = pool[rot[mid] % pool.length];
          rot[mid]++;
        }
      }
    }

    /* ---- wali kelas ----
     * A wali kelas is ALWAYS one of their own rombel's pengampu. The whole
     * point of the role is that they teach the children, know them, and can
     * defend the rapor they sign — and this app's own rule is that a wali
     * writes only their own mapel, so a wali who teaches nothing in their class
     * has zero write authority anywhere in it. Assigning wali by rombel index
     * left four of eight rombel in exactly that state.
     */
    for (i = 0; i < sekolah.taList.length; i++) {
      var t5 = sekolah.taList[i];
      var terpakai = {};
      var daftar = rombelByTa[t5];
      for (j = 0; j < daftar.length; j++) {
        var rb3 = daftar[j];
        var kandidat = [];
        for (k = 0; k < S.MAPEL.length; k++) {
          var gid = pengampu[t5 + '|' + rb3.nama + '|' + S.MAPEL[k].id];
          if (gid && kandidat.indexOf(gid) < 0) kandidat.push(gid);
        }
        // Deterministic preference order, then first unused teacher.
        kandidat.sort(function (a, b) {
          var ka = D.det(a + '|' + rb3.id + '|wali'), kb = D.det(b + '|' + rb3.id + '|wali');
          return ka - kb;
        });
        var pilih = null;
        for (k = 0; k < kandidat.length; k++) {
          if (!terpakai[kandidat[k]]) { pilih = kandidat[k]; break; }
        }
        if (!pilih) pilih = kandidat[0];      // more rombel than pengampu: cannot happen here
        terpakai[pilih] = true;
        rb3.waliGuruId = pilih;
      }
    }

    var school = {
      sekolah: sekolah, ruang: ruang, guru: guru, guruByMapel: guruByMapel,
      mapel: S.MAPEL, rombelByTa: rombelByTa, siswa: siswa, nisnUrut: nisnUrut,
      pengampu: pengampu, ppdb: ppdb, registry: registry, mutasi: mutasi,
      /* Assessment configuration is stored PER TAHUN AJARAN, exactly like nilai
       * and presensi. A school revises its KKM in the KOSP every year and the
       * previous year's rapor must keep the KKM it was signed under; a single
       * global bobot/KKM map means one edit on the Konfigurasi tab silently
       * rewrites every rapor ever issued. */
      kkm: {},
      bobot: {}
    };
    sekolah.taList.forEach(function (t) {
      school.kkm[t] = {};
      school.bobot[t] = {};
      S.MAPEL.forEach(function (m) {
        // Last year's KKM sat a little lower for the heavy subjects, which is
        // both realistic and makes the year-scoping visible on screen.
        school.kkm[t][m.id] = t === S.TA_LALU && m.berat ? m.kkm - 2 : m.kkm;
        school.bobot[t][m.id] = {
          peng: { tugas: 20, uh: 30, pts: 20, pas: 30 },
          ket: { praktik: 35, produk: 25, proyek: 25, porto: 15 }
        };
      });
    });

    school.bebanGuru = S.hitungBebanGuru(school, S.TA_AKTIF);
    return school;
  };

  /* Weekly teaching load per teacher, and whether it clears the 24-JP minimum
   * that governs tunjangan sertifikasi. Reported, not hidden: being under it is
   * a real and common situation, and it is the reason a teacher also works at
   * another school — which is one of the unavailability constraints the solver
   * has to respect. */
  S.hitungBebanGuru = function (school, ta) {
    var out = {}, rombel = school.rombelByTa[ta] || [];
    school.guru.forEach(function (g) { out[g.id] = { id: g.id, jp: 0, rombel: [], mapel: {} }; });
    rombel.forEach(function (rb) {
      S.MAPEL.forEach(function (m) {
        var gid = school.pengampu[ta + '|' + rb.nama + '|' + m.id];
        if (!gid || !out[gid]) return;
        out[gid].jp += m.jp;
        if (out[gid].rombel.indexOf(rb.nama) < 0) out[gid].rombel.push(rb.nama);
        out[gid].mapel[m.id] = (out[gid].mapel[m.id] || 0) + m.jp;
      });
    });
    school.guru.forEach(function (g) {
      out[g.id].memenuhiMinimal = out[g.id].jp >= S.JP_MINIMAL_SERTIFIKASI;
      out[g.id].kurang = Math.max(0, S.JP_MINIMAL_SERTIFIKASI - out[g.id].jp);
    });
    return out;
  };

  /* ---------------------------------------------------------------- PPDB -- */
  function buildPpdb(rnd, registry) {
    var kuota = 3 * KAPASITAS_ROMBEL;          // 3 rombel kelas 7 x 32
    var tanggalAcuan = D.ppdbTanggalAcuan(S.TA_AKTIF);   // 1 Juli 2026
    var base = Date.UTC(2026, 4, 4);
    var pendaftar = [];
    var TOTAL = 162;

    for (var i = 0; i < TOTAL; i++) {
      var nisn = registry.issue('pendaftar');
      var kip = D.det(nisn + '|kip') < 0.18;
      var u = D.det(nisn + '|jalur');
      var jalur;
      if (kip) jalur = u < 0.78 ? 'afirmasi' : 'zonasi';
      else if (u < 0.55) jalur = 'zonasi';
      else if (u < 0.90) jalur = 'prestasi';
      else if (u < 0.96) jalur = 'perpindahan';
      else jalur = 'zonasi';

      /* Date of birth is carried on the applicant, because PPDB has a hard
       * maximum-age rule (SMP: at most 15 on 1 Juli of the year of entry) and a
       * selection that cannot check it is not a selection. Three candidates are
       * deliberately over-age so the refusal is visible on the tab rather than
       * merely implemented. */
      var lahirTahun, lahirBulan;
      if (i % 54 === 7) { lahirTahun = 2009; lahirBulan = 1 + Math.floor(D.det(nisn + '|bln') * 6); }
      else {
        lahirTahun = 2013 + (D.det(nisn + '|thn') < 0.35 ? -1 : 0);
        lahirBulan = 1 + Math.floor(D.det(nisn + '|bln') * 12);
      }
      var lahirHari = 1 + Math.floor(D.det(nisn + '|hr') * 28);

      pendaftar.push({
        nisn: nisn,
        nama: D.fabricateNama(rnd),
        jk: D.det(nisn + '|jk') < 0.5 ? 'L' : 'P',
        tglLahir: lahirTahun + '-' + String(lahirBulan).padStart(2, '0') + '-' + String(lahirHari).padStart(2, '0'),
        jalur: jalur,
        jarakMeter: 200 + Math.floor(D.det(nisn + '|jarak') * 9600),
        nilaiRapor: D.round2(70 + D.det(nisn + '|rapor') * 28),
        poinPrestasi: Math.floor(D.det(nisn + '|prestasi') * 30),
        daftarAt: base + Math.floor(D.det(nisn + '|daftar') * 10 * 86400000),
        asalSekolah: 'SD Fiktif ' + (1 + Math.floor(D.det(nisn + '|sd') * 12)),
        kip: kip,
        index: i
      });
    }
    for (i = 0; i < pendaftar.length; i++) {
      pendaftar[i].skor = D.round2(pendaftar[i].nilaiRapor * 0.7 + pendaftar[i].poinPrestasi);
      pendaftar[i].usia = D.usiaTahun(pendaftar[i].tglLahir, tanggalAcuan);
    }

    var hasil = D.seleksiPpdb(pendaftar, kuota, 5, { tanggalAcuan: tanggalAcuan });
    return {
      ta: S.TA_AKTIF,
      kuotaTotal: kuota,
      tanggalAcuan: tanggalAcuan,
      rombelTujuan: ['7A', '7B', '7C'],
      pendaftar: pendaftar,
      hasil: hasil.hasil,
      ringkas: hasil.ringkas,
      kuota: hasil.kuota,
      gugur: hasil.gugur,
      periksa: D.periksaKuota(hasil.kuota, kuota)
    };
  }

  /* ============================================ derived marks & presence ==
   * Pure. Same inputs, same output, forever — that is what makes the "rapor
   * recomputes deterministically" assertion something other than a slogan.
   */

  // A student's underlying ability, 0..1, stable for life.
  S.kemampuan = function (nisn) { return D.det(nisn + '|abil'); };

  S.nilaiKomponen = function (nisn, mapelId, ta, semester, aspekId, komponenId) {
    var key = nisn + '|' + mapelId + '|' + ta + '|' + semester + '|' + aspekId + '|' + komponenId;
    var abil = S.kemampuan(nisn);                              // 0..1
    var affin = D.detNormal(nisn + '|' + mapelId) * 7;         // subject affinity, +/-7
    // Students improve slightly across a year; the genap semester sits above
    // ganjil for the same child so the two years read like a trajectory.
    var lift = (semester === 'genap' ? 1.6 : 0) + (ta === S.TA_AKTIF ? 1.2 : 0);
    /* Keterampilan is a different competence from pengetahuan and correlates
     * only loosely with it: a child who is average on paper is often strong in
     * praktik. Modelled as its own per-(child, subject) tilt on top of the
     * shared ability, which is why the two columns on the rapor disagree in the
     * way a real ledger's do. */
    var aspekTilt = aspekId === 'ket'
      ? 2.2 + D.detNormal(nisn + '|' + mapelId + '|ket') * 6
      : 0;
    // Exams are harder than coursework, which is why the weighting matters.
    var offset = {
      tugas: 6, uh: 0, pts: -3, pas: -2,
      praktik: 3, produk: 2, proyek: -1, porto: 4
    }[komponenId] || 0;
    var noise = D.detNormal(key) * 6;
    var v = 67 + abil * 28 + affin + lift + aspekTilt + offset + noise;
    return Math.round(D.clamp(v, 0, 100));
  };

  /* All four components of one aspect. Components whose assessment window has
   * not closed yet come back as null, NOT as zero and not as a fabricated
   * number: `now` is the demo's fixed reference date, so this stays pure. */
  S.nilaiMapel = function (nisn, mapelId, ta, semester, aspekId, now) {
    var komponen = D.komponenAspek(aspekId);
    var o = {};
    for (var i = 0; i < komponen.length; i++) {
      var kid = komponen[i].id;
      o[kid] = S.komponenSiap(ta, semester, aspekId, kid, now)
        ? S.nilaiKomponen(nisn, mapelId, ta, semester, aspekId, kid)
        : null;
    }
    return o;
  };

  /* ---- sikap (wali kelas) ---- */
  S.sikapDerived = function (nisn, ta, semester, dimensi) {
    var u = D.det(nisn + '|' + ta + '|' + semester + '|sikap-' + dimensi);
    var abil = S.kemampuan(nisn);
    var v = u * 0.65 + abil * 0.35;
    var pred = v > 0.72 ? 'A' : v > 0.34 ? 'B' : v > 0.12 ? 'C' : 'D';
    return {
      predikat: pred,
      deskripsi: D.deskripsiSikap(dimensi, pred, nisn + '|' + ta + '|' + semester + '|' + dimensi)
    };
  };

  /* ================================================= presensi, per HARI ==
   * The stored fact is (nisn, tanggal). A per-subject session is a VIEW over
   * dated facts, not a storage grain of its own — which is what makes the
   * whole thing coherent: a child who was ill on Tuesday is 'S' in every
   * subject taught that Tuesday, the rapor's Ketidakhadiran block can be
   * counted in hari (which is the unit an Indonesian rapor uses), and "anak
   * saya izin hari Selasa" becomes a query the system can answer.
   */
  S.presensiHari = function (nisn, tanggal) {
    var d = D.det(nisn + '|hadir');
    var pAbsen = 0.02 + 0.40 * Math.pow(d, 6);
    var u = D.det(nisn + '|' + tanggal + '|hadir');
    if (u >= pAbsen) return 'H';
    var w = u / pAbsen;
    if (w < 0.35) return 'A';
    if (w < 0.78) return 'S';
    return 'I';
  };

  // Every effective day of the semester that has actually happened.
  S.presensiHarian = function (nisn, ta, semester, now) {
    var hari = S.hariEfektifHingga(ta, semester, now);
    var out = [];
    for (var i = 0; i < hari.length; i++) {
      out.push({ tgl: hari[i], status: S.presensiHari(nisn, hari[i]) });
    }
    return out;
  };

  /* Which weekdays a subject meets a rombel on. Derived from a deterministic
   * REFERENCE distribution rather than from the solved timetable, on purpose:
   * attendance is history, and history must not move when somebody re-runs the
   * solver or drags a lesson to another day. The jadwal says where the class is
   * next week; the presensi register says where the child was last September. */
  S.hariPertemuan = function (rombelNama, mapel) {
    var n = mapel.blok.length;
    var urut = D.detShuffle(rombelNama + '|' + mapel.id + '|hari', 5).slice(0, n);
    urut.sort(function (a, b) { return a - b; });
    return urut;
  };

  S.pertemuanPerSemester = function (mapel) { return mapel.blok.length * S.PEKAN_KBM; };

  /* The dated session list for one (rombel, mapel, ta, semester), truncated at
   * `now`. Each entry knows its date, its weekday and its ordinal. */
  S.sesiMapel = function (rombelNama, mapel, ta, semester, now) {
    now = now === undefined ? S.SEKARANG : now;
    var kal = S.kalenderSemester(ta, semester);
    if (!kal) return [];
    var hariIdx = S.hariPertemuan(rombelNama, mapel);
    var out = [], n = 0;
    for (var i = 0; i < kal.pekan.length; i++) {
      var pk = kal.pekan[i];
      if (!pk.hari || pk.jenis !== 'kbm') continue;
      for (var j = 0; j < hariIdx.length; j++) {
        var tgl = pk.hari[hariIdx[j]];
        n++;
        if (D.parseYmd(tgl) > now) continue;
        out.push({ n: n, tgl: tgl, hariIdx: hariIdx[j], pekan: pk.no });
      }
    }
    return out;
  };

  /* ---- iuran komite ----
   * This is a SMP NEGERI, so there is no SPP. What the komite agrees with
   * parents is a voluntary monthly contribution: no arrears status, no demand
   * letter, no consequence for a child whose family does not pay, and KIP
   * holders exempt as income support rather than as a fee waiver.
   */
  S.TARIF_KOMITE = { 7: 75000, 8: 75000, 9: 85000 };

  S.komiteLedger = function (siswaRec, ta) {
    var enrol = siswaRec.enrol[ta];
    if (!enrol) return [];
    var tarif = S.TARIF_KOMITE[enrol.tingkat] || 75000;
    var months = D.tahunAjaranMonths(ta);
    /* Most families contribute every month; a minority is genuinely stretched.
     * Modelled as a threshold rather than a flat probability, because a uniform
     * "42% chance of missing a month" produces a school where two thirds of
     * every class is behind, which is not what a komite book looks like. */
    var kesulitan = Math.max(0, (D.det(siswaRec.nisn + '|komite') - 0.72) / 0.28);
    var out = [];
    for (var i = 0; i < months.length; i++) {
      var mm = months[i];
      var due = Date.UTC(mm.year, mm.month - 1, 10);
      var entry = { year: mm.year, month: mm.month, tarif: tarif, bebas: !!siswaRec.kip, paidAt: null };
      if (!entry.bebas && due <= S.SEKARANG) {
        var u = D.det(siswaRec.nisn + '|komite|' + mm.year + '-' + mm.month);
        if (u > kesulitan * 0.8) entry.paidAt = due - 3 * 86400000;
      }
      out.push(entry);
    }
    return out;
  };

  /* ================================================= timetable instance ==
   * Turns the school into the CSP the solver understands. One variable per
   * lesson block, so the weekly JP of every subject is met by construction —
   * there is no code path that can emit a week with 5 JP of Matematika when
   * the curriculum says 5 and the blocks say [3, 2].
   */
  S.buildJadwalSpec = function (school, ta) {
    var rombel = school.rombelByTa[ta] || [];
    var sesi = [], wajibJp = {};
    for (var i = 0; i < rombel.length; i++) {
      var rb = rombel[i];
      for (var j = 0; j < S.MAPEL.length; j++) {
        var m = S.MAPEL[j];
        var guruId = school.pengampu[ta + '|' + rb.nama + '|' + m.id];
        wajibJp[rb.id + '|' + m.id] = m.jp;
        for (var k = 0; k < m.blok.length; k++) {
          var b = m.blok[k];
          sesi.push({
            id: rb.nama + '.' + m.id + '.' + (k + 1),
            rombelId: rb.id, rombelNama: rb.nama, tingkat: rb.tingkat,
            mapelId: m.id, mapelNama: m.nama, mapelKode: m.kode,
            guruId: guruId, len: b.len,
            ruangTipe: b.ruang || null, homeRuangId: rb.ruangId
          });
        }
      }
    }
    return {
      ta: ta,
      hari: S.HARI,
      ruang: school.ruang,
      guru: school.guru,
      mapel: S.MAPEL,
      sesi: sesi,
      wajibJp: wajibJp
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
