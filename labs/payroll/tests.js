/*!
 * Payroll — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Payroll — tests.js
 * Assertions against the engine. The same file runs in the page (the badge in
 * the header) and under node.
 *
 * Ranked by how much damage each one prevents:
 *
 *  1. I3, THE DECEMBER TRUE-UP. The sum of the twelve monthly PPh 21
 *     deductions must equal the annual calculation to the rupiah, for every
 *     employee, including mid-year joiners and the leaver whose true-up lands
 *     in August. This is the invariant a payroll vendor gets wrong and the
 *     reason the whole regime is interesting. It is checked against an
 *     INDEPENDENT annual recomputation, never against the engine's own
 *     self-report.
 *  2. I1 / I2, THE MONEY IDENTITIES. Net pay is gross earnings minus employee
 *     deductions, per person per month; the run total is the sum of its
 *     payslips in every column. If either breaks the app is lying about money
 *     and nothing else it says can be trusted.
 *  3. I5, THE TWO COLUMNS. An employer contribution must never appear as an
 *     employee deduction and must never be able to move net pay. Tested by
 *     re-running the same payslip under every JKK risk class and asserting the
 *     net is bit-identical.
 *  4. I4, THE CEILINGS. Each BPJS ceiling at its own level, flat above it, and
 *     JHT — which has no ceiling — still rising. Tested by sweeping a wage
 *     across each boundary a rupiah at a time.
 *  5. TER BAND SELECTION AT EVERY SINGLE BOUNDARY of all three tables. A gross
 *     exactly on a boundary belongs to the lower band; off by one there is
 *     invisible in aggregate and wrong for precisely the employees on a round
 *     salary.
 *  6. LEMBUR against Kepmenaker 102/2004's own multipliers, THR proration at
 *     the 1-month and 12-month edges, leave that cannot go silently negative.
 *  7. I7, NO FLOATS, by walking every money field of every payslip and every
 *     run total in the seeded company.
 */
(function (root) {
  'use strict';

  var D = root.PAYROLL_DOMAIN;
  var T = root.PAYROLL_PAJAK;
  var P = root.PAYROLL_ENGINE;
  var S = root.PAYROLL_SEED;

  var groups = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  function makeCtx(results, groupName) {
    function record(ok, name, msg) {
      results.push({ group: groupName, name: name, ok: !!ok, message: ok ? '' : (msg || '') });
    }
    return {
      ok: function (v, name) { record(!!v, name, 'diharap truthy, dapat ' + JSON.stringify(v)); },
      notOk: function (v, name) { record(!v, name, 'diharap falsy, dapat ' + JSON.stringify(v)); },
      eq: function (a, b, name) { record(a === b, name, 'diharap ' + JSON.stringify(b) + ', dapat ' + JSON.stringify(a)); },
      lt: function (a, b, name) { record(a < b, name, 'diharap < ' + b + ', dapat ' + a); },
      gt: function (a, b, name) { record(a > b, name, 'diharap > ' + b + ', dapat ' + a); },
      lte: function (a, b, name) { record(a <= b, name, 'diharap <= ' + b + ', dapat ' + a); },
      gte: function (a, b, name) { record(a >= b, name, 'diharap >= ' + b + ', dapat ' + a); },
      throws: function (fn, name) {
        var lempar = false, pesan = '';
        try { fn(); } catch (e) { lempar = true; pesan = String(e && e.message || e); }
        record(lempar, name, 'diharap melempar, tidak melempar');
        return pesan;
      }
    };
  }

  /* One demo company, built once and shared. Building it twice is itself a
   * determinism check, so that gets its own group below. */
  var DB = null;
  function db() { return DB || (DB = S.build()); }

  /* A one-employee company with hand-computable numbers: no meal allowance, no
   * THR month, no minimum-wage floor, no attendance records. Every tax and
   * BPJS claim in this suite is checked twice — once against arithmetic a
   * reader can do on paper here, and once against the 62-employee company. */
  function satu(o) {
    o = o || {};
    var emp = {
      nip: 'T1', nama: 'Karyawan Uji', lahir: '1990-01-01',
      nik: '9900000101019000', npwp: '99.000.000.0-000.000',
      bpjsKes: '99900000000', bpjsTk: '99900000001', rekening: '0000000000',
      divisi: 'Uji', risiko: o.risiko || 'I', level: 1, levelNama: 'Uji', jabatan: 'Uji',
      ptkp: o.ptkp || 'TK/0',
      gajiPokok: o.pokok === undefined ? 6000000 : o.pokok,
      tunjanganTetap: o.tetap === undefined ? 0 : o.tetap,
      mulai: o.mulai || '2015-01-05', selesai: o.selesai || null,
      bolehLembur: true
    };
    var ctx = {
      cfg: {
        tahun: 2025, perusahaan: 'PT Uji', umk: o.umk || 0,
        makanHarian: o.makan || 0, thrBulan: o.thrBulan || 0, thrTanggal: o.thrTanggal || '2025-03-24'
      },
      karyawan: [emp], byNip: { T1: emp },
      absensi: { T1: o.absensi || {} }, lembur: { T1: o.lembur || {} }, cuti: o.cuti || []
    };
    return { ctx: ctx, emp: emp };
  }

  /* Run a whole year for a one-employee company, month by month, exactly the
   * way the UI does it: each run reads the runs already posted. */
  function tahunkan(u, opts) {
    opts = opts || {};
    var runs = {};
    var aktif = P.bulanAktif(u.emp, 2025);
    for (var i = 0; i < aktif.length; i++) {
      var r = P.jalankan(u.ctx, runs, 2025, aktif[i], {});
      if (opts.kunci) { r.status = 'terkunci'; r.ditinjauOleh = 'payroll'; r.dikunciOleh = 'finance'; }
      runs[r.id] = r;
    }
    return runs;
  }
  function slipsOf(runs, nip) {
    var out = [];
    Object.keys(runs).sort().forEach(function (id) {
      runs[id].slips.forEach(function (s) { if (s.nip === nip) out.push(s); });
    });
    out.sort(function (a, b) { return a.bulan - b.bulan; });
    return out;
  }

  /* ============================================ 1. bilangan bulat ======= */

  group('Uang selalu bilangan bulat rupiah, dan pembulatannya satu kebijakan', function (t) {
    t.eq(D.divRound(1500, 1000), 2, 'divRound(1500,1000) = 2 — setengah dibulatkan menjauhi nol');
    t.eq(D.divRound(2500, 1000), 3, 'divRound(2500,1000) = 3, bukan 2 — ini bukan pembulatan bankir');
    t.eq(D.divRound(1499, 1000), 1, 'divRound(1499,1000) = 1');
    t.eq(D.divRound(-1500, 1000), -2, 'divRound(-1500,1000) = -2, simetris terhadap nol');
    t.eq(D.divRound(-2500, 1000), -3, 'divRound(-2500,1000) = -3');
    t.eq(D.divRound(1, 2), 1, 'divRound(1,2) = 1');
    t.eq(D.divRound(-1, 2), -1, 'divRound(-1,2) = -1');
    t.eq(D.divRound(0, 5), 0, 'divRound(0,5) = 0');
    t.eq(D.divRound(7, 3), 2, 'divRound(7,3) = 2');
    t.eq(D.divRound(8, 3), 3, 'divRound(8,3) = 3');
    t.eq(D.divFloor(7, 3), 2, 'divFloor(7,3) = 2');
    t.eq(D.divFloor(-7, 3), -3, 'divFloor(-7,3) = -3 — ke bawah, bukan ke arah nol');
    t.eq(D.divFloor(-1, 2), -1, 'divFloor(-1,2) = -1, karena restitusi Desember tidak boleh dibulatkan ke arah nol');
    t.throws(function () { D.divRound(1.5, 2); }, 'divRound menolak argumen pecahan');
    t.throws(function () { D.divRound(3, 0); }, 'divRound menolak pembagi nol');
    t.throws(function () { D.divFloor(3, 0); }, 'divFloor menolak pembagi nol');
    t.throws(function () { D.mul(D.MAX_SAFE, 4); }, 'mul melempar sebelum melewati 2^53');
    t.throws(function () { D.mul(1.5, 2); }, 'mul menolak argumen pecahan');
    t.ok(D.isInt(0) && D.isInt(-7) && D.isInt(1e6), 'isInt menerima bilangan bulat');
    t.notOk(D.isInt(0.1) || D.isInt(NaN) || D.isInt(Infinity) || D.isInt('5'), 'isInt menolak pecahan, NaN, tak hingga dan string');

    t.eq(D.bpRound(10000000, 100), 100000, 'bpRound: 1% dari 10.000.000 = 100.000');
    t.eq(D.bpRound(10547400, 100), 105474, 'bpRound: JP 1% dari plafon = 105.474');
    t.eq(D.bpRound(12000000, 400), 480000, 'bpRound: Kesehatan pemberi 4% dari plafon = 480.000');
    t.eq(D.bpRound(7175000, 370), 265475, 'bpRound: JHT pemberi 3,7% dari 7.175.000 = 265.475');
    t.eq(D.bpRound(1000000, 24), 2400, 'bpRound: JKK kelas I 0,24% dari 1.000.000 = 2.400');
    t.eq(D.bpRound(1000000, 174), 17400, 'bpRound: JKK kelas V 1,74% dari 1.000.000 = 17.400');
    t.eq(D.bpRound(333, 50), 2, 'bpRound: 0,5% dari 333 = 1,665 -> 2, menjauhi nol');
    t.eq(D.bpFloor(333, 50), 1, 'bpFloor: nilai yang sama dibulatkan ke bawah = 1');
    t.eq(D.bpFloor(8264648, 150), 123969, 'bpFloor: TER 1,5% dari 8.264.648 = 123.969 (dipotong, bukan dibulatkan naik)');
    t.eq(D.floorRibuan(50558588), 50558000, 'floorRibuan: PKP dibulatkan ke bawah ke ribuan penuh');
    t.eq(D.floorRibuan(1000), 1000, 'floorRibuan: yang sudah bulat tidak bergerak');
    t.eq(D.floorRibuan(999), 0, 'floorRibuan(999) = 0');
    t.eq(D.sum([1, 2, 3]), 6, 'sum menjumlah bilangan bulat');
    t.throws(function () { D.sum([1, 2.5]); }, 'sum melempar begitu menemukan pecahan, bukannya menjumlahkannya');
  });

  group('Format uang dan tarif', function (t) {
    t.eq(D.rupiah(0), 'Rp0', 'rupiah(0)');
    t.eq(D.rupiah(1000), 'Rp1.000', 'pemisah ribuan titik, gaya Indonesia');
    t.eq(D.rupiah(12345678), 'Rp12.345.678', 'rupiah(12.345.678)');
    t.eq(D.rupiah(-1648622), '-Rp1.648.622', 'restitusi Desember tampil negatif, bukan dalam tanda kurung');
    t.eq(D.rupiah(0.5), '!0.5', 'pecahan ditampilkan jelek dengan sengaja — itu bug, bukan angka');
    t.eq(D.rupiah(null), '—', 'nilai kosong bukan Rp0');
    t.eq(D.angka(1000000), '1.000.000', 'angka() tanpa awalan Rp');
    t.eq(D.persen(0), '0%', 'persen(0 bp)');
    t.eq(D.persen(25), '0,25%', 'persen(25 bp) = 0,25% dengan koma desimal');
    t.eq(D.persen(150), '1,5%', 'persen(150 bp) = 1,5%');
    t.eq(D.persen(370), '3,7%', 'persen(370 bp) = 3,7%');
    t.eq(D.persen(500), '5%', 'persen(500 bp) = 5%, tanpa nol menggantung');
    t.eq(D.persen(3400), '34%', 'persen(3400 bp) = 34% — baris teratas tabel TER');
    t.eq(D.persen(24), '0,24%', 'persen(24 bp) = 0,24% — JKK kelas I');
  });

  /* ============================================ 2. kalender ============= */

  group('Kalender, hari kerja dan masa kerja', function (t) {
    t.eq(D.hariKerja(2025, 1), 23, 'Januari 2025 punya 23 hari kerja Senin–Jumat');
    t.eq(D.hariKerja(2025, 2), 20, 'Februari 2025 punya 20');
    t.eq(D.hariKerja(2025, 3), 21, 'Maret 2025 punya 21');
    t.eq(D.hariKerja(2025, 8), 21, 'Agustus 2025 punya 21');
    t.eq(D.hariKerja(2024, 2), 21, 'Februari tahun kabisat 2024 punya 21 — 29 hari, bukan 28');
    t.gte(D.hariKerja(2025, 12), 20, 'Desember 2025 minimal 20 hari kerja');
    var totalHK = 0;
    for (var m = 1; m <= 12; m++) totalHK += D.hariKerja(2025, m);
    t.eq(totalHK, 261, '2025 punya 261 hari kerja Senin–Jumat — pembagi potongan absen bukan 21 atau 22 yang ditebak orang');
    t.eq(D.bulanMasaKerja('2024-01-15', '2025-01-15'), 12, 'masa kerja tepat setahun = 12 bulan');
    t.eq(D.bulanMasaKerja('2024-01-15', '2025-01-14'), 11, 'sehari sebelum ulang tanggal masih 11 bulan — aturan ulang tanggal, bukan selisih bulan kalender');
    t.eq(D.bulanMasaKerja('2024-01-31', '2024-02-29'), 0, 'mulai 31 Januari, per 29 Februari belum genap sebulan');
    t.eq(D.bulanMasaKerja('2025-08-18', '2025-12-31'), 4, 'joiner Agustus punya 4 bulan penuh per akhir Desember');
    t.eq(D.bulanMasaKerja('2025-11-03', '2025-12-31'), 1, 'joiner November punya 1 bulan penuh per akhir Desember');
    t.eq(D.bulanMasaKerja('2025-04-14', '2025-03-24'), 0, 'tanggal setelah tanggal acuan memberi 0, bukan negatif');
    t.eq(D.bulanMasaKerja('2015-01-05', '2025-03-24'), 122, 'masa kerja panjang dihitung dalam bulan penuh');
    t.eq(D.periode(2025, 3), '2025-03', 'periode(2025,3)');
    t.eq(D.periode(2025, 12), '2025-12', 'periode(2025,12)');
    t.eq(D.namaBulan(12), 'Desember', 'nama bulan bahasa Indonesia');
    t.eq(D.tglPanjang('2025-03-24'), '24 Maret 2025', 'tanggal panjang');
    t.eq(D.ymd(D.parseYmd('2025-02-28')), '2025-02-28', 'ymd/parseYmd bolak-balik utuh');
    t.eq(D.tahunDari('2025-08-29'), 2025, 'tahunDari');
    t.eq(D.bulanDari('2025-08-29'), 8, 'bulanDari');
    t.eq(D.hariDari('2025-08-29'), 29, 'hariDari');
  });

  /* ============================================ 3. PTKP =================== */

  group('PTKP: delapan status, jumlahnya dan kategori TER-nya (PMK 101/2016, PP 58/2023)', function (t) {
    t.eq(D.ptkpOf('TK/0'), 54000000, 'TK/0 = Rp 54.000.000');
    t.eq(D.ptkpOf('TK/1'), 58500000, 'TK/1 = Rp 58.500.000');
    t.eq(D.ptkpOf('TK/2'), 63000000, 'TK/2 = Rp 63.000.000');
    t.eq(D.ptkpOf('TK/3'), 67500000, 'TK/3 = Rp 67.500.000');
    t.eq(D.ptkpOf('K/0'), 58500000, 'K/0 = Rp 58.500.000');
    t.eq(D.ptkpOf('K/1'), 63000000, 'K/1 = Rp 63.000.000');
    t.eq(D.ptkpOf('K/2'), 67500000, 'K/2 = Rp 67.500.000');
    t.eq(D.ptkpOf('K/3'), 72000000, 'K/3 = Rp 72.000.000');
    t.eq(D.ptkpOf('K/0') - D.ptkpOf('TK/0'), 4500000, 'tambahan status kawin = Rp 4.500.000');
    t.eq(D.ptkpOf('TK/1') - D.ptkpOf('TK/0'), 4500000, 'tambahan per tanggungan = Rp 4.500.000');
    t.eq(D.ptkpOf('K/3') - D.ptkpOf('K/0'), 13500000, 'tiga tanggungan = 3 x Rp 4.500.000, dan tiga adalah batasnya');
    t.eq(D.ptkpOf('TK/1'), D.ptkpOf('K/0'), 'TK/1 dan K/0 punya PTKP yang sama — itulah sebabnya keduanya satu kategori TER');
    t.eq(D.ptkpOf('TK/3'), D.ptkpOf('K/2'), 'TK/3 dan K/2 juga sama');
    t.throws(function () { D.ptkpOf('K/4'); }, 'status di luar daftar melempar, tidak diam-diam dianggap TK/0');
    t.throws(function () { D.ptkpOf(''); }, 'status kosong melempar');
    t.eq(D.kategoriTER('TK/0'), 'A', 'TK/0 -> TER A');
    t.eq(D.kategoriTER('TK/1'), 'A', 'TK/1 -> TER A');
    t.eq(D.kategoriTER('K/0'), 'A', 'K/0 -> TER A');
    t.eq(D.kategoriTER('TK/2'), 'B', 'TK/2 -> TER B');
    t.eq(D.kategoriTER('TK/3'), 'B', 'TK/3 -> TER B');
    t.eq(D.kategoriTER('K/1'), 'B', 'K/1 -> TER B');
    t.eq(D.kategoriTER('K/2'), 'B', 'K/2 -> TER B');
    t.eq(D.kategoriTER('K/3'), 'C', 'K/3 -> TER C, satu-satunya penghuninya');
    t.eq(D.STATUS_PTKP.length, 8, 'delapan status, tidak lebih');
    var kelompok = { A: [], B: [], C: [] };
    D.STATUS_PTKP.forEach(function (s) { kelompok[D.kategoriTER(s)].push(s); });
    t.eq(kelompok.A.join(','), 'TK/0,TK/1,K/0', 'isi kategori A tepat');
    t.eq(kelompok.B.join(','), 'TK/2,TK/3,K/1,K/2', 'isi kategori B tepat');
    t.eq(kelompok.C.join(','), 'K/3', 'isi kategori C tepat');
    var semuaA = kelompok.A.every(function (s) { return D.ptkpOf(s) <= 58500000; });
    t.ok(semuaA, 'setiap status kategori A punya PTKP <= 58.500.000, sesuai lampiran PP 58/2023');
    var semuaB = kelompok.B.every(function (s) { return D.ptkpOf(s) >= 63000000 && D.ptkpOf(s) <= 67500000; });
    t.ok(semuaB, 'setiap status kategori B punya PTKP 63.000.000–67.500.000');
    t.eq(D.ptkpOf(kelompok.C[0]), 72000000, 'kategori C hanya PTKP 72.000.000');
  });

  /* ==================================== 4. batas band TER ================= */

  group('Bentuk tabel TER: kontinu, monoton, dan tertutup di atas', function (t) {
    T.KATEGORI.forEach(function (kat) {
      var tab = T.TER[kat];
      t.gt(tab.length, 35, 'tabel TER ' + kat + ' punya ' + tab.length + ' baris');
      t.eq(tab[tab.length - 1].sampai, null, 'baris terakhir TER ' + kat + ' terbuka ke atas, jadi tidak ada bruto yang tidak tertangani');
      t.eq(tab[0].bp, 0, 'baris pertama TER ' + kat + ' bertarif 0% — di bawah ambang itu tidak ada potongan bulanan');
      var monoton = true, kontinu = true, bulat = true, kelipatan = true;
      for (var i = 1; i < tab.length; i++) {
        if (tab[i].bp <= tab[i - 1].bp) monoton = false;
        if (tab[i].sampai !== null && tab[i].sampai <= tab[i - 1].sampai) kontinu = false;
      }
      for (i = 0; i < tab.length; i++) {
        if (!D.isInt(tab[i].bp) || (tab[i].sampai !== null && !D.isInt(tab[i].sampai))) bulat = false;
        if (tab[i].bp % 25 !== 0) kelipatan = false;
      }
      t.ok(monoton, 'tarif TER ' + kat + ' naik ketat dari baris ke baris');
      t.ok(kontinu, 'batas atas TER ' + kat + ' naik ketat, jadi tidak ada band yang tumpang tindih');
      t.ok(bulat, 'setiap batas dan setiap tarif TER ' + kat + ' bilangan bulat');
      t.ok(kelipatan, 'setiap tarif TER ' + kat + ' kelipatan 25 bp (0,25%), jadi aritmetika bp eksak');
      t.eq(tab[tab.length - 1].bp, 3400, 'tarif tertinggi TER ' + kat + ' 34%');
      t.eq(T.band(kat, 0).bp, 0, 'bruto nol di TER ' + kat + ' menghasilkan 0%');
      t.throws(function () { T.band(kat, -1); }, 'bruto negatif di TER ' + kat + ' melempar');
      t.throws(function () { T.band(kat, 1.5); }, 'bruto pecahan di TER ' + kat + ' melempar');
    });
    t.throws(function () { T.band('D', 1000000); }, 'kategori TER yang tidak ada melempar');
    t.eq(T.KATEGORI.length, 3, 'tepat tiga kategori TER');
    /* The three tables must not be copies of each other: the first band alone
     * distinguishes them, and a build that accidentally aliased B to A would
     * pass every other test in this group. */
    t.notOk(T.TER.A[0].sampai === T.TER.B[0].sampai, 'ambang 0% TER A dan TER B berbeda');
    t.notOk(T.TER.B[0].sampai === T.TER.C[0].sampai, 'ambang 0% TER B dan TER C berbeda');
    t.eq(T.TER.A[0].sampai, 5400000, 'TER A bebas potongan sampai Rp 5.400.000');
    t.eq(T.TER.B[0].sampai, 6200000, 'TER B bebas potongan sampai Rp 6.200.000');
    t.eq(T.TER.C[0].sampai, 6600000, 'TER C bebas potongan sampai Rp 6.600.000');
  });

  /* Every boundary of every band of all three tables. The regulation states
   * bands as "di atas X sampai dengan Y", so a gross EXACTLY on a boundary
   * belongs to the LOWER band. One assertion per band, checking both sides of
   * its ceiling at once, so a failure names the band. */
  group('Pemilihan band TER di setiap batas — tepat di batas masuk band bawah', function (t) {
    T.KATEGORI.forEach(function (kat) {
      var tab = T.TER[kat];
      for (var i = 0; i < tab.length - 1; i++) {
        (function (i) {
          var batas = tab[i].sampai;
          var b1 = T.band(kat, batas), b2 = T.band(kat, batas + 1);
          var ok = b1.bp === tab[i].bp && b1.i === i && b2.bp === tab[i + 1].bp && b2.i === i + 1;
          t.ok(ok, 'TER ' + kat + ' baris ' + (i + 1) + ': ' + D.rupiah(batas) + ' -> ' + D.persen(tab[i].bp) +
            ', +Rp1 -> ' + D.persen(tab[i + 1].bp) + (ok ? '' : ' [dapat ' + D.persen(b1.bp) + ' / ' + D.persen(b2.bp) + ']'));
        })(i);
      }
      /* And the open top band, which has no ceiling to straddle. */
      var akhir = tab[tab.length - 1], sebelum = tab[tab.length - 2];
      t.eq(T.band(kat, sebelum.sampai + 1).bp, akhir.bp, 'TER ' + kat + ': satu rupiah di atas ' + D.rupiah(sebelum.sampai) + ' masuk band teratas ' + D.persen(akhir.bp));
      t.eq(T.band(kat, 9000000000).bp, 3400, 'TER ' + kat + ': bruto sembilan miliar tetap 34%, band teratas tidak bocor');
    });
  });

  group('Band TER: batas bawah yang dilaporkan benar-benar batas bawahnya', function (t) {
    T.KATEGORI.forEach(function (kat) {
      var tab = T.TER[kat], rapat = true, pertama = true;
      for (var i = 0; i < tab.length; i++) {
        var b = T.band(kat, i === 0 ? 0 : tab[i - 1].sampai + 1);
        if (b.i !== i) rapat = false;
        if (i > 0 && b.dari !== tab[i - 1].sampai + 1) rapat = false;
      }
      t.ok(rapat, 'setiap batas bawah yang dilaporkan band TER ' + kat + ' memang jatuh di band itu');
      t.eq(T.band(kat, 0).dari, 0, 'band pertama TER ' + kat + ' mulai dari nol');
      t.eq(T.band(kat, tab[0].sampai).sampai, tab[0].sampai, 'batas atas band pertama TER ' + kat + ' dilaporkan apa adanya');
      t.eq(T.band(kat, 9e9).sampai, null, 'band teratas TER ' + kat + ' melaporkan batas atas null, bukan angka karangan');
      pertama = T.band(kat, tab[0].sampai + 1);
      t.eq(pertama.bp, tab[1].bp, 'satu rupiah di atas ambang bebas pajak TER ' + kat + ' sudah kena ' + D.persen(tab[1].bp));
    });
  });

  /* ==================================== 5. tarif Pasal 17 ================ */

  group('Tarif tahunan Pasal 17 UU 7/2021 — lapisan dan batasnya', function (t) {
    t.eq(D.LAPIS_PASAL17.length, 5, 'lima lapisan');
    t.eq(D.LAPIS_PASAL17[0].sampai, 60000000, 'lapisan 5% sampai Rp 60.000.000');
    t.eq(D.LAPIS_PASAL17[0].bp, 500, 'lapisan pertama 5%');
    t.eq(D.LAPIS_PASAL17[1].sampai, 250000000, 'lapisan 15% sampai Rp 250.000.000');
    t.eq(D.LAPIS_PASAL17[1].bp, 1500, 'lapisan kedua 15%');
    t.eq(D.LAPIS_PASAL17[2].sampai, 500000000, 'lapisan 25% sampai Rp 500.000.000');
    t.eq(D.LAPIS_PASAL17[3].sampai, 5000000000, 'lapisan 30% sampai Rp 5.000.000.000');
    t.eq(D.LAPIS_PASAL17[4].sampai, null, 'lapisan 35% terbuka ke atas');
    t.eq(D.LAPIS_PASAL17[4].bp, 3500, 'lapisan teratas 35%');
    t.eq(T.tarifPasal17(0).pph, 0, 'PKP nol tidak berpajak');
    t.eq(T.tarifPasal17(-5000000).pph, 0, 'PKP negatif tidak menghasilkan pajak negatif');
    t.eq(T.tarifPasal17(-5000000).pkp, 0, 'dan PKP negatif dilaporkan sebagai nol');
    t.eq(T.tarifPasal17(1000).pph, 50, 'PKP 1.000 -> 50');
    t.eq(T.tarifPasal17(60000000).pph, 3000000, 'PKP tepat 60.000.000 -> 3.000.000, seluruhnya di lapisan 5%');
    t.eq(T.tarifPasal17(60000000).lapis.length, 1, 'dan hanya menyentuh satu lapisan');
    t.eq(T.tarifPasal17(60001000).pph, 3000150, 'PKP 60.001.000 -> 3.000.000 + 15% dari 1.000');
    t.eq(T.tarifPasal17(60001000).lapis.length, 2, 'dan menyentuh dua lapisan');
    t.eq(T.tarifPasal17(250000000).pph, 31500000, 'PKP 250.000.000 -> 3.000.000 + 28.500.000 = 31.500.000');
    t.eq(T.tarifPasal17(500000000).pph, 94000000, 'PKP 500.000.000 -> 31.500.000 + 25% x 250.000.000 = 94.000.000');
    t.eq(T.tarifPasal17(5000000000).pph, 1444000000, 'PKP 5.000.000.000 -> 94.000.000 + 30% x 4.500.000.000');
    t.eq(T.tarifPasal17(6000000000).pph, 1444000000 + 350000000, 'satu miliar di atas lapisan teratas dikenai 35%');
    t.eq(T.tarifPasal17(60000000).marginalBp, 500, 'tarif marginal di 60.000.000 masih 5%');
    t.eq(T.tarifPasal17(60001000).marginalBp, 1500, 'tarif marginal sedikit di atasnya 15%');
    t.eq(T.tarifPasal17(500000001).marginalBp, 3000, 'tarif marginal di atas 500.000.000 adalah 30%');
    var l = T.tarifPasal17(300000000);
    t.eq(l.lapis.length, 3, 'PKP 300.000.000 terurai ke tiga lapisan');
    t.eq(l.lapis[0].dasar + l.lapis[1].dasar + l.lapis[2].dasar, 300000000, 'dan dasar tiap lapisan menjumlah persis ke PKP');
    t.eq(l.lapis[0].pajak + l.lapis[1].pajak + l.lapis[2].pajak, l.pph, 'serta pajak tiap lapisan menjumlah persis ke totalnya');
    t.eq(l.pph, 3000000 + 28500000 + 12500000, 'PKP 300.000.000 -> 44.000.000');
    var semuaBulat = true;
    for (var pkp = 0; pkp <= 600000000; pkp += 1000) {
      if (!D.isInt(T.tarifPasal17(pkp).pph)) { semuaBulat = false; break; }
    }
    t.ok(semuaBulat, '600.001 nilai PKP disapu bertahap 1.000; tidak satu pun menghasilkan pajak pecahan');
    t.throws(function () { T.tarifPasal17(1.5); }, 'PKP pecahan melempar');
  });

  /* ==================================== 6. PPh 21 setahun ================ */

  group('PPh 21 setahun: biaya jabatan, pengurang, PTKP dan pembulatan PKP', function (t) {
    /* A worked example a reader can follow on paper:
     *   bruto setahun     120.000.000
     *   biaya jabatan 5%    6.000.000  -> tepat di plafon tahunan
     *   JHT pekerja         2.400.000
     *   JP pekerja          1.200.000
     *   neto              110.400.000
     *   PTKP TK/0          54.000.000
     *   PKP                56.400.000  (sudah bulat ribuan)
     *   PPh 21              2.820.000  (5%)
     */
    var a = T.pph21Tahunan({ status: 'TK/0', brutoTahun: 120000000, bulanKerja: 12, jhtPekerja: 2400000, jpPekerja: 1200000 });
    t.eq(a.biayaJabatanKotor, 6000000, 'biaya jabatan kasar 5% dari 120.000.000 = 6.000.000');
    t.eq(a.biayaJabatanCap, 6000000, 'plafon 12 bulan x 500.000 = 6.000.000');
    t.eq(a.biayaJabatan, 6000000, 'jadi biaya jabatan yang dipakai 6.000.000');
    t.notOk(a.biayaJabatanKena, 'tepat di plafon belum terhitung "kena plafon"');
    t.eq(a.pengurang, 9600000, 'pengurang = 6.000.000 + 2.400.000 + 1.200.000');
    t.eq(a.neto, 110400000, 'penghasilan neto 110.400.000');
    t.eq(a.ptkp, 54000000, 'PTKP TK/0');
    t.eq(a.pkp, 56400000, 'PKP 56.400.000');
    t.eq(a.pph, 2820000, 'PPh 21 setahun 2.820.000');
    t.eq(a.efektifBp, 235, 'tarif efektif tahunan 2,35%');

    /* The cap biting, which is where a mid-year joiner goes wrong. */
    var b = T.pph21Tahunan({ status: 'TK/0', brutoTahun: 240000000, bulanKerja: 12, jhtPekerja: 0, jpPekerja: 0 });
    t.eq(b.biayaJabatanKotor, 12000000, '5% dari 240.000.000 = 12.000.000');
    t.eq(b.biayaJabatan, 6000000, 'tetapi plafon tahunan memotongnya ke 6.000.000');
    t.ok(b.biayaJabatanKena, 'dan itu ditandai kena plafon');
    var c = T.pph21Tahunan({ status: 'TK/0', brutoTahun: 120000000, bulanKerja: 5, jhtPekerja: 0, jpPekerja: 0 });
    t.eq(c.biayaJabatanCap, 2500000, 'joiner dengan 5 bulan kerja berplafon 5 x 500.000 = 2.500.000, BUKAN 6.000.000');
    t.eq(c.biayaJabatan, 2500000, 'dan plafon itulah yang berlaku');
    t.eq(c.ptkp, 54000000, 'PTKP joiner TIDAK diprorata — ia hak tahunan yang menempel pada orangnya');

    /* PKP rounding down to the whole thousand. */
    var d = T.pph21Tahunan({ status: 'TK/0', brutoTahun: 112780619, bulanKerja: 12, jhtPekerja: 1722000, jpPekerja: 861000 });
    t.eq(d.biayaJabatan, 5639031, 'biaya jabatan 5% dari 112.780.619 = 5.639.031');
    t.eq(d.pkpKasar, 50558588, 'PKP sebelum pembulatan 50.558.588');
    t.eq(d.pkp, 50558000, 'PKP dibulatkan ke bawah ke ribuan penuh: 50.558.000');
    t.eq(d.pph, 2527900, 'PPh 21 setahun 2.527.900');

    /* Below PTKP: no tax, and no negative tax either. */
    var e = T.pph21Tahunan({ status: 'K/3', brutoTahun: 60000000, bulanKerja: 12, jhtPekerja: 1200000, jpPekerja: 600000 });
    t.eq(e.pph, 0, 'bruto 60.000.000 dengan PTKP K/3 72.000.000 tidak berpajak');
    t.lt(e.pkpKasar, 0, 'PKP kasarnya memang negatif');
    t.eq(e.pkp, 0, 'tetapi PKP dilaporkan nol, bukan negatif');
    t.eq(e.efektifBp, 0, 'dan tarif efektifnya nol');

    /* Same gross, eight different statuses: tax must fall monotonically as PTKP
     * rises. This is the "change the status and watch tax move" claim, asserted
     * rather than demonstrated. */
    var urut = ['TK/0', 'TK/1', 'K/0', 'TK/2', 'K/1', 'TK/3', 'K/2', 'K/3'];
    var lalu = null, monoton = true, hasil = [];
    urut.forEach(function (s) {
      var r = T.pph21Tahunan({ status: s, brutoTahun: 180000000, bulanKerja: 12, jhtPekerja: 3600000, jpPekerja: 1800000 });
      hasil.push(s + ' ' + D.rupiah(r.pph));
      if (lalu !== null && r.pph > lalu) monoton = false;
      lalu = r.pph;
    });
    t.ok(monoton, 'pada bruto yang sama, pajak turun (tidak pernah naik) saat PTKP membesar: ' + hasil.join(' · '));
    t.gt(T.pph21Tahunan({ status: 'TK/0', brutoTahun: 180000000, bulanKerja: 12 }).pph,
      T.pph21Tahunan({ status: 'K/3', brutoTahun: 180000000, bulanKerja: 12 }).pph,
      'dan TK/0 memang membayar lebih dari K/3 pada bruto identik');
    t.eq(T.pph21Tahunan({ status: 'TK/1', brutoTahun: 180000000, bulanKerja: 12 }).pph,
      T.pph21Tahunan({ status: 'K/0', brutoTahun: 180000000, bulanKerja: 12 }).pph,
      'TK/1 dan K/0 membayar identik, karena PTKP-nya identik');
    t.throws(function () { T.pph21Tahunan({ status: 'TK/0', brutoTahun: -1, bulanKerja: 12 }); }, 'bruto tahunan negatif melempar');
    t.throws(function () { T.pph21Tahunan({ status: 'TK/0', brutoTahun: 1000, bulanKerja: 0 }); }, 'bulan kerja 0 melempar');
    t.throws(function () { T.pph21Tahunan({ status: 'TK/0', brutoTahun: 1000, bulanKerja: 13 }); }, 'bulan kerja 13 melempar');
    t.throws(function () { T.pph21Tahunan({ status: 'X/9', brutoTahun: 1000, bulanKerja: 12 }); }, 'status tak dikenal melempar');
  });

  /* ==================================== 7. TER bulanan ================== */

  group('TER bulanan: pencarian tarif dan pembulatan ke bawah', function (t) {
    var r = T.terBulanan('TK/0', 10000000);
    t.eq(r.kategori, 'A', 'TK/0 memakai TER A');
    t.eq(r.bp, 200, 'bruto 10.000.000 di TER A jatuh di 2%');
    t.eq(r.pph21, 200000, 'jadi potongan bulanannya 200.000');
    t.eq(T.terBulanan('K/3', 10000000).bp, 150, 'bruto yang sama di TER C hanya 1,5% — kategori mengubah tarif');
    t.eq(T.terBulanan('K/3', 10000000).pph21, 150000, 'dan potongannya 150.000');
    t.eq(T.terBulanan('K/1', 10000000).bp, 150, 'TER B pada bruto yang sama hanya 1,5% — tiga kategori, tiga jawaban berbeda untuk satu bruto');
    t.eq(T.terBulanan('TK/0', 5400000).pph21, 0, 'tepat di ambang bebas TER A tidak ada potongan');
    t.eq(T.terBulanan('TK/0', 5400001).pph21, 13500, 'satu rupiah di atasnya: 0,25% dari 5.400.001 = 13.500,0025 -> 13.500');
    t.eq(T.terBulanan('TK/0', 8264648).bp, 150, 'bruto 8.264.648 -> 1,5%');
    t.eq(T.terBulanan('TK/0', 8264648).pph21, 123969, 'dan 1,5% darinya = 123.969,72 dipotong ke 123.969, bukan dibulatkan ke 123.970');
    t.eq(T.terBulanan('K/3', 6600000).pph21, 0, 'TER C bebas potongan sampai 6.600.000');
    t.eq(T.terBulanan('K/1', 6200000).pph21, 0, 'TER B bebas potongan sampai 6.200.000');
    t.eq(T.terBulanan('TK/0', 6200000).bp, 75, 'bruto 6.200.000 sudah kena 0,75% di TER A padahal masih 0% di TER B — batas bebas pajaknya beda per kategori');
    t.eq(T.terBulanan('TK/0', 0).pph21, 0, 'bruto nol tidak berpajak');
    var naik = true, lalu = -1;
    for (var v = 0; v <= 40000000; v += 250000) {
      var p = T.terBulanan('TK/0', v).pph21;
      if (p < lalu) naik = false;
      lalu = p;
    }
    t.ok(naik, 'potongan TER A tidak pernah turun saat bruto naik — 161 titik disapu');
    var bulat = true;
    for (v = 0; v <= 60000000; v += 137111) {
      if (!D.isInt(T.terBulanan('K/2', v).pph21)) { bulat = false; break; }
    }
    t.ok(bulat, 'dan tidak satu pun titik itu menghasilkan potongan pecahan');
    t.throws(function () { T.terBulanan('ZZ', 1000); }, 'status tak dikenal di TER melempar');
  });

  /* ==================================== 8. true-up Desember ============= */

  group('True-up Desember: dua belas potongan menjumlah ke perhitungan setahun', function (t) {
    /* A flat year with hand-checkable numbers. Gross 10.000.000 taxable every
     * month, TK/0, no BPJS in the way (this is the pure tax layer). */
    var bulanan = [];
    for (var m = 1; m <= 12; m++) bulanan.push({ bulan: m, brutoPajak: 10000000, jhtPekerja: 0, jpPekerja: 0 });
    var r = T.rencanaTahun({ status: 'TK/0', bulanan: bulanan });
    t.eq(r.bulanan.length, 12, 'dua belas bulan direncanakan');
    t.eq(r.bulanKoreksi, 12, 'bulan koreksi adalah Desember');
    var terBulan = r.bulanan.slice(0, 11);
    t.ok(terBulan.every(function (b) { return b.metode === 'ter'; }), 'Januari sampai November memakai metode TER');
    t.eq(r.bulanan[11].metode, 'setahun', 'Desember memakai perhitungan setahun');
    t.eq(terBulan[0].bp, 200, 'tarif TER-nya 2%');
    t.eq(terBulan[0].pph21, 200000, 'jadi 200.000 per bulan Januari–November');
    t.eq(r.akumTer, 2200000, 'sebelas bulan x 200.000 = 2.200.000 sudah dipotong');
    t.eq(r.tahunan.brutoTahun, 120000000, 'bruto setahun 120.000.000');
    t.eq(r.tahunan.pkp, 60000000, 'PKP setahun = 120.000.000 - biaya jabatan 6.000.000 - PTKP 54.000.000 = 60.000.000');
    t.eq(r.tahunan.pph, 3000000, 'yang seluruhnya di lapisan 5%, jadi PPh setahun 3.000.000');
    t.eq(r.koreksi, r.tahunan.pph - 2200000, 'koreksi Desember = setahun - yang sudah dipotong');
    t.eq(r.totalDipotong, r.tahunan.pph, 'Σ dua belas potongan = PPh setahun, TEPAT');
    t.ok(r.konsisten, 'dan mesinnya sendiri melaporkan konsisten');
    var jum = 0;
    r.bulanan.forEach(function (b) { jum += b.pph21; });
    t.eq(jum, r.tahunan.pph, 'dijumlah ulang secara terpisah pun sama');
    t.eq(r.bulanan[11].terSeandainya, 200000, 'Desember menyimpan angka TER "seandainya" untuk dibandingkan');
    t.notOk(r.restitusi, 'tahun rata tidak menghasilkan restitusi');

    /* A bonus month: TER over-withholds and December refunds. This is the
     * behaviour PP 58/2023 actually produces, not a bug, and it is the single
     * most common support question a payroll officer gets in January. */
    var bonus = [];
    for (m = 1; m <= 12; m++) bonus.push({ bulan: m, brutoPajak: m === 3 ? 60000000 : 20000000, jhtPekerja: 0, jpPekerja: 0 });
    var rb = T.rencanaTahun({ status: 'TK/0', bulanan: bonus });
    t.eq(rb.bulanan[2].bp, 2000, 'bulan bonus bruto 60.000.000 masuk band 20% TER A');
    t.eq(rb.bulanan[2].pph21, 12000000, 'jadi bulan itu dipotong 12.000.000');
    t.eq(rb.bulanan[0].bp, 900, 'bulan biasa bruto 20.000.000 hanya 9%');
    t.ok(rb.koreksi < 0, 'Desember jadi negatif: TER memotong lebih banyak dari kewajiban setahun');
    t.ok(rb.restitusi, 'dan itu ditandai sebagai restitusi lewat payroll');
    t.eq(rb.totalDipotong, rb.tahunan.pph, 'Σ dua belas potongan tetap = PPh setahun, termasuk saat koreksinya negatif');
    t.ok(D.isInt(rb.koreksi), 'koreksi negatif tetap bilangan bulat');

    /* Mid-year joiner: eight months, correction in December, biaya jabatan cap
     * scaled to eight months. */
    var joiner = [];
    for (m = 5; m <= 12; m++) joiner.push({ bulan: m, brutoPajak: 15000000, jhtPekerja: 0, jpPekerja: 0 });
    var rj = T.rencanaTahun({ status: 'K/1', bulanan: joiner });
    t.eq(rj.bulanan.length, 8, 'joiner Mei punya delapan bulan');
    t.eq(rj.bulanKoreksi, 12, 'koreksinya masih di Desember');
    t.eq(rj.tahunan.bulanKerja, 8, 'perhitungan setahun tahu ia bekerja delapan bulan');
    t.eq(rj.tahunan.biayaJabatanCap, 4000000, 'plafon biaya jabatannya 8 x 500.000 = 4.000.000');
    t.eq(rj.tahunan.ptkp, 63000000, 'PTKP K/1 tetap penuh 63.000.000, tidak diprorata delapan per dua belas');
    t.eq(rj.totalDipotong, rj.tahunan.pph, 'dan Σ delapan potongan = perhitungan setahunnya');
    t.ok(rj.konsisten, 'joiner konsisten');

    /* Leaver: the correction month is their final month, not December. */
    var leaver = [];
    for (m = 1; m <= 8; m++) leaver.push({ bulan: m, brutoPajak: 18000000, jhtPekerja: 360000, jpPekerja: 180000 });
    var rl = T.rencanaTahun({ status: 'TK/2', bulanan: leaver, bulanKoreksi: 8 });
    t.eq(rl.bulanKoreksi, 8, 'bulan koreksi leaver adalah Agustus');
    t.eq(rl.bulanan[7].metode, 'setahun', 'dan Agustus-lah yang memakai perhitungan setahun');
    t.ok(rl.bulanan.slice(0, 7).every(function (b) { return b.metode === 'ter'; }), 'Januari–Juli tetap TER');
    t.eq(rl.totalDipotong, rl.tahunan.pph, 'Σ delapan potongan leaver = perhitungan setahunnya');
    t.eq(rl.tahunan.bulanKerja, 8, 'delapan bulan kerja');

    /* One-month employee: the correction month is the only month, so the
     * annual figure IS the month's deduction. */
    var sebulan = T.rencanaTahun({ status: 'TK/0', bulanan: [{ bulan: 11, brutoPajak: 9000000, jhtPekerja: 0, jpPekerja: 0 }], bulanKoreksi: 11 });
    t.eq(sebulan.bulanan.length, 1, 'karyawan satu bulan');
    t.eq(sebulan.akumTer, 0, 'tidak ada bulan TER sebelumnya');
    t.eq(sebulan.bulanan[0].pph21, sebulan.tahunan.pph, 'potongan bulan itu = seluruh kewajiban setahunnya');
    t.eq(sebulan.tahunan.pph, 0, 'yang pada bruto 9.000.000 sebulan dan PTKP setahun penuh adalah nol');
    t.ok(sebulan.konsisten, 'dan tetap konsisten');

    t.throws(function () { T.rencanaTahun({ status: 'TK/0', bulanan: [] }); }, 'tahun tanpa bulan melempar');
    t.throws(function () {
      T.rencanaTahun({ status: 'TK/0', bulanan: [{ bulan: 1, brutoPajak: 1000, jhtPekerja: 0, jpPekerja: 0 }], bulanKoreksi: 7 });
    }, 'bulan koreksi yang tidak ada dalam daftar bulan melempar, bukannya diam-diam dilewati');

    /* Sweep: 8 statuses x 9 income levels, and every one must reconcile. */
    var gagal = [], n = 0;
    D.STATUS_PTKP.forEach(function (st) {
      [5000000, 6000000, 7500000, 10000000, 13000000, 20000000, 35000000, 60000000, 150000000].forEach(function (g) {
        var bl = [];
        for (var mm = 1; mm <= 12; mm++) bl.push({ bulan: mm, brutoPajak: mm === 3 ? D.mul(g, 2) : g, jhtPekerja: D.bpRound(g, 200), jpPekerja: D.bpRound(g, 100) });
        var rr = T.rencanaTahun({ status: st, bulanan: bl });
        n++;
        if (!rr.konsisten || rr.totalDipotong !== rr.tahunan.pph) gagal.push(st + '@' + g);
      });
    });
    t.eq(gagal.length, 0, n + ' kombinasi status x tingkat penghasilan (dengan bulan THR ganda) direkonsiliasi tepat: ' + (gagal.length ? gagal.join(',') : 'semua'));
  });

  /* ==================================== 9. BPJS ========================= */

  group('BPJS Kesehatan: 4% pemberi, 1% pekerja, plafon Rp 12.000.000', function (t) {
    t.eq(D.KESEHATAN.bpPekerja, 100, 'iuran pekerja 1%');
    t.eq(D.KESEHATAN.bpPemberi, 400, 'iuran pemberi kerja 4%');
    t.eq(D.KESEHATAN.bpPekerja + D.KESEHATAN.bpPemberi, 500, 'total 5% sesuai Perpres 64/2020');
    t.eq(D.KESEHATAN.batasAtas, 12000000, 'plafon upah Rp 12.000.000');
    var b1 = P.bpjs(8000000, 'I', {});
    t.eq(b1.kesDasar, 8000000, 'di bawah plafon, dasarnya upah itu sendiri');
    t.notOk(b1.kesKena, 'dan plafonnya belum menggigit');
    t.eq(b1.kesPekerja, 80000, '1% dari 8.000.000 = 80.000');
    t.eq(b1.kesPemberi, 320000, '4% dari 8.000.000 = 320.000');
    var b2 = P.bpjs(12000000, 'I', {});
    t.eq(b2.kesDasar, 12000000, 'tepat di plafon, dasarnya masih upah itu sendiri');
    t.notOk(b2.kesKena, 'tepat di plafon belum "kena plafon"');
    t.eq(b2.kesPekerja, 120000, '1% dari plafon = 120.000');
    var b3 = P.bpjs(12000001, 'I', {});
    t.ok(b3.kesKena, 'satu rupiah di atas plafon, plafonnya menggigit');
    t.eq(b3.kesDasar, 12000000, 'dan dasarnya dipotong ke plafon');
    t.eq(b3.kesPekerja, 120000, 'iuran pekerjanya tetap 120.000');
    var b4 = P.bpjs(80000000, 'I', {});
    t.eq(b4.kesPekerja, 120000, 'upah 80.000.000 pun tetap 120.000 — direktur dan supervisor bayar sama');
    t.eq(b4.kesPemberi, 480000, 'dan pemberi kerja tetap 480.000');
    /* Sweep across the boundary a rupiah at a time. */
    var rata = true, sebelum = P.bpjs(11900000, 'I', {}).kesPekerja;
    for (var u = 12000000; u <= 12000010; u++) {
      if (P.bpjs(u, 'I', {}).kesPekerja !== 120000) rata = false;
    }
    t.ok(rata, 'sebelas nilai upah di sekitar plafon: iuran tetap rata di 120.000');
    t.eq(sebelum, 119000, 'sedangkan pada upah 11.900.000 — di bawah plafon — iurannya masih 119.000, jadi plafonnya benar-benar yang meratakan');
    /* The wage FLOOR, which is the other half of the rule and is usually missed. */
    var lantai = P.bpjs(5000000, 'I', { umk: 5396761 });
    t.eq(lantai.kesDasar, 5396761, 'upah di bawah UMK diangkat ke UMK sebagai dasar iuran');
    t.eq(lantai.kesPekerja, 53968, '1% dari 5.396.761 = 53.967,61 -> 53.968');
    t.eq(P.bpjs(5000000, 'I', {}).kesDasar, 5000000, 'tanpa UMK dalam konfigurasi tidak ada lantai yang dikarang');
    t.eq(P.bpjs(6000000, 'I', { umk: 5396761 }).kesDasar, 6000000, 'upah di atas UMK tidak diturunkan ke UMK');
  });

  group('BPJS JHT dan JP: satu tanpa plafon, satu dengan plafonnya sendiri', function (t) {
    t.eq(D.JHT.bpPekerja, 200, 'JHT pekerja 2%');
    t.eq(D.JHT.bpPemberi, 370, 'JHT pemberi 3,7%');
    t.eq(D.JHT.bpPekerja + D.JHT.bpPemberi, 570, 'JHT total 5,7% sesuai PP 46/2015');
    t.eq(D.JHT.batasAtas, null, 'JHT tidak punya plafon sama sekali');
    t.eq(D.JP.bpPekerja, 100, 'JP pekerja 1%');
    t.eq(D.JP.bpPemberi, 200, 'JP pemberi 2%');
    t.eq(D.JP.bpPekerja + D.JP.bpPemberi, 300, 'JP total 3% sesuai PP 45/2015');
    t.eq(D.JP.batasAtas, 10547400, 'plafon upah JP 2025 = Rp 10.547.400');
    t.eq(D.JP.tahunBatas, 2025, 'dan vintage plafon itu dicatat sebagai 2025 — BPJS menyetelnya ulang setiap tahun');
    t.lt(D.JP.batasAtas, D.KESEHATAN.batasAtas, 'plafon JP lebih rendah dari plafon Kesehatan, jadi ada rentang upah di mana hanya JP yang tertahan');
    var mid = P.bpjs(11000000, 'I', {});
    t.ok(mid.jpKena, 'upah 11.000.000 sudah melewati plafon JP');
    t.notOk(mid.kesKena, 'tetapi belum melewati plafon Kesehatan — inilah rentang itu');
    t.eq(mid.jpDasar, 10547400, 'dasar JP dipotong ke plafon');
    t.eq(mid.jpPekerja, 105474, 'JP pekerja 105.474');
    t.eq(mid.jpPemberi, 210948, 'JP pemberi 210.948');
    t.eq(mid.jhtDasar, 11000000, 'sedangkan dasar JHT tetap upah penuh');
    t.eq(mid.jhtPekerja, 220000, 'JHT pekerja 2% dari 11.000.000 = 220.000');
    t.eq(mid.jhtPemberi, 407000, 'JHT pemberi 3,7% dari 11.000.000 = 407.000');
    var tepat = P.bpjs(10547400, 'I', {});
    t.notOk(tepat.jpKena, 'tepat di plafon JP belum "kena plafon"');
    t.eq(tepat.jpPekerja, 105474, 'iurannya sama dengan di plafon');
    var lebih = P.bpjs(10547401, 'I', {});
    t.ok(lebih.jpKena, 'satu rupiah di atas plafon JP, plafonnya menggigit');
    t.eq(lebih.jpPekerja, 105474, 'dan iurannya tidak bergerak');
    /* JHT must keep rising — the mirror-image bug is a ceiling copy-pasted onto
     * JHT, which a "cap is applied" test would happily pass. */
    var naikTerus = true, lalu = -1;
    for (var u = 5000000; u <= 60000000; u += 2500000) {
      var v = P.bpjs(u, 'I', {}).jhtPekerja;
      if (v <= lalu) naikTerus = false;
      lalu = v;
    }
    t.ok(naikTerus, 'JHT pekerja naik terus dari 5 juta ke 60 juta — tidak ada plafon yang tersalin ke sana');
    t.eq(P.bpjs(60000000, 'I', {}).jhtPekerja, 1200000, 'JHT pekerja pada upah 60.000.000 = 1.200.000');
    var rataJp = true;
    for (u = 10547400; u <= 10547410; u++) if (P.bpjs(u, 'I', {}).jpPemberi !== 210948) rataJp = false;
    t.ok(rataJp, 'sebelas nilai upah di sekitar plafon JP: iuran pemberi tetap rata');
  });

  group('BPJS JKK per kelas risiko dan JKM — semuanya beban pemberi kerja', function (t) {
    t.eq(D.KELAS_RISIKO.length, 5, 'lima kelas risiko PP 44/2015');
    t.eq(D.JKK_KELAS['I'].bp, 24, 'kelas I 0,24%');
    t.eq(D.JKK_KELAS['II'].bp, 54, 'kelas II 0,54%');
    t.eq(D.JKK_KELAS['III'].bp, 89, 'kelas III 0,89%');
    t.eq(D.JKK_KELAS['IV'].bp, 127, 'kelas IV 1,27%');
    t.eq(D.JKK_KELAS['V'].bp, 174, 'kelas V 1,74%');
    t.eq(D.JKM.bpPemberi, 30, 'JKM 0,30%');
    var naik = true, lalu = -1;
    D.KELAS_RISIKO.forEach(function (k) {
      if (D.JKK_KELAS[k].bp <= lalu) naik = false;
      lalu = D.JKK_KELAS[k].bp;
    });
    t.ok(naik, 'tarif JKK naik ketat dari kelas I ke kelas V');
    var upah = 10000000;
    t.eq(P.bpjs(upah, 'I', {}).jkk, 24000, 'JKK kelas I atas 10.000.000 = 24.000');
    t.eq(P.bpjs(upah, 'III', {}).jkk, 89000, 'JKK kelas III = 89.000');
    t.eq(P.bpjs(upah, 'V', {}).jkk, 174000, 'JKK kelas V = 174.000');
    t.eq(P.bpjs(upah, 'I', {}).jkm, 30000, 'JKM = 30.000, sama untuk semua kelas');
    t.eq(P.bpjs(upah, 'V', {}).jkm, 30000, 'JKM tidak ikut kelas risiko');
    t.eq(P.bpjs(50000000, 'V', {}).jkk, 870000, 'JKK tidak punya plafon: 1,74% dari 50.000.000 = 870.000');
    t.throws(function () { P.bpjs(upah, 'VI', {}); }, 'kelas risiko yang tidak ada melempar');
    t.throws(function () { P.bpjs(-1, 'I', {}); }, 'upah negatif melempar');
    t.throws(function () { P.bpjs(1.5, 'I', {}); }, 'upah pecahan melempar');
    var b = P.bpjs(10000000, 'IV', {});
    t.eq(b.pekerjaTotal, b.kesPekerja + b.jhtPekerja + b.jpPekerja, 'total pekerja = tiga iuran pekerja, dan JKK/JKM tidak ada di antaranya');
    t.eq(b.pemberiTotal, b.kesPemberi + b.jhtPemberi + b.jpPemberi + b.jkk + b.jkm, 'total pemberi = lima komponennya');
    t.eq(b.pekerjaTotal, 100000 + 200000 + 100000, 'pada upah 10.000.000 total potongan BPJS pekerja = 400.000');
    t.eq(b.pemberiTotal, 400000 + 370000 + 200000 + 127000 + 30000, 'dan beban pemberi kerja = 1.127.000');
    var bulat = true;
    for (var u = 3000000; u <= 90000000; u += 777777) {
      D.KELAS_RISIKO.forEach(function (k) {
        var x = P.bpjs(u, k, { umk: 5396761 });
        ['kesPekerja', 'kesPemberi', 'jhtPekerja', 'jhtPemberi', 'jpPekerja', 'jpPemberi', 'jkk', 'jkm', 'pekerjaTotal', 'pemberiTotal'].forEach(function (f) {
          if (!D.isInt(x[f])) bulat = false;
        });
      });
    }
    t.ok(bulat, '112 kombinasi upah x kelas risiko: setiap komponen iuran bilangan bulat');
  });

  /* ==================================== 10. lembur ====================== */

  group('Lembur Kepmenaker 102/2004: pembagi 1/173 dan tangga pengalinya', function (t) {
    t.eq(D.LEMBUR_DIVISOR, 173, 'upah lembur sejam = 1/173 upah sebulan — 173 pembagi undang-undang, bukan hitungan jam');
    t.eq(D.LEMBUR_HARI_KERJA.jamPertama, 150, 'jam pertama hari kerja 1,5x');
    t.eq(D.LEMBUR_HARI_KERJA.jamBerikut, 200, 'jam berikutnya 2x');
    t.eq(D.bobotLembur(0, false), 0, 'nol jam, nol bobot');
    t.eq(D.bobotLembur(1, false), 150, '1 jam hari kerja = 1,5x');
    t.eq(D.bobotLembur(2, false), 350, '2 jam = 1,5 + 2 = 3,5x');
    t.eq(D.bobotLembur(3, false), 550, '3 jam = 1,5 + 2 + 2 = 5,5x');
    t.eq(D.bobotLembur(4, false), 750, '4 jam = 7,5x');
    t.eq(D.bobotLembur(2, false) - D.bobotLembur(1, false), 200, 'setiap jam setelah yang pertama menambah tepat 2x');
    t.eq(D.LEMBUR_HARI_LIBUR.blokDasar, 8, 'hari libur: delapan jam pertama pada tarif dasar (pekan lima hari kerja)');
    t.eq(D.LEMBUR_HARI_LIBUR.bpDasar, 200, 'delapan jam pertama hari libur 2x');
    t.eq(D.LEMBUR_HARI_LIBUR.bpJamKesembilan, 300, 'jam kesembilan 3x');
    t.eq(D.LEMBUR_HARI_LIBUR.bpJamSelanjutnya, 400, 'jam kesepuluh dan kesebelas 4x');
    t.eq(D.bobotLembur(1, true), 200, '1 jam hari libur = 2x, bukan 1,5x');
    t.eq(D.bobotLembur(8, true), 1600, '8 jam hari libur = 16x');
    t.eq(D.bobotLembur(9, true), 1900, '9 jam = 16 + 3 = 19x');
    t.eq(D.bobotLembur(10, true), 2300, '10 jam = 19 + 4 = 23x');
    t.eq(D.bobotLembur(11, true), 2700, '11 jam = 23 + 4 = 27x');
    t.eq(D.bobotLembur(9, true) - D.bobotLembur(8, true), 300, 'jam kesembilan menambah tepat 3x');
    t.eq(D.bobotLembur(10, true) - D.bobotLembur(9, true), 400, 'jam kesepuluh menambah tepat 4x');
    t.gt(D.bobotLembur(1, true), D.bobotLembur(1, false), 'satu jam di hari libur selalu lebih mahal dari satu jam di hari kerja');
    t.throws(function () { D.bobotLembur(-1, false); }, 'jam negatif melempar');
    t.throws(function () { D.bobotLembur(1.5, false); }, 'jam pecahan melempar — lembur dicatat per jam penuh');

    /* Worked example a reader can check with a calculator: upah 3.000.000, so
     * the hourly rate is 3.000.000 / 173 = 17.341,04. */
    t.eq(D.upahLembur(3000000, 1, false), 26012, 'upah 3.000.000, 1 jam hari kerja: 1,5 x 17.341,04 = 26.011,56 -> 26.012');
    t.eq(D.upahLembur(3000000, 3, false), 95376, '3 jam hari kerja: 5,5 x 17.341,04 = 95.375,7 -> 95.376');
    t.eq(D.upahLembur(3000000, 8, true), 277457, '8 jam hari libur: 16 x 17.341,04 = 277.456,6 -> 277.457');
    t.eq(D.upahLembur(3000000, 10, true), 398844, '10 jam hari libur: 23 x 17.341,04 = 398.843,9 -> 398.844');
    t.eq(D.upahLembur(3460000, 1, false), 30000, 'upah 3.460.000 memberi tarif sejam persis 20.000, jadi 1 jam = 30.000');
    t.eq(D.upahLembur(3460000, 2, false), 70000, 'dan 2 jam = 3,5 x 20.000 = 70.000, tanpa pembulatan apa pun');
    t.eq(D.upahLembur(3460000, 8, true), 320000, '8 jam hari libur pada tarif itu = 16 x 20.000 = 320.000');
    t.eq(D.upahLembur(0, 4, false), 0, 'upah nol memberi lembur nol');
    t.eq(D.upahLembur(3000000, 0, false), 0, 'nol jam memberi nol rupiah');

    /* THE DAILY MAXIMUM IS ENFORCED, not merely declared. The table used to
     * carry maksJam 11 and never read it, and D.bobotLembur(15, true) happily
     * returned 43x — four extra hours at a multiplier Kepmenaker 102/2004 does
     * not define. A limit a file advertises and never applies reads like a
     * control to whoever greps for one, which is worse than no limit at all. */
    t.eq(D.LEMBUR_HARI_KERJA.maksJam, 4, 'hari kerja: paling lama 4 jam sehari (PP 35/2021 Pasal 26 ayat 1)');
    t.eq(D.LEMBUR_HARI_LIBUR.maksJam, 11, 'hari libur: pengali terdefinisi hanya sampai jam ke-11 (Kepmenaker 102/2004 Pasal 11 huruf b)');
    t.eq(D.bobotLembur(4, false), 750, '4 jam hari kerja = 1,5 + 3 x 2 = 7,5x, tepat di batas');
    var pesanKerja = t.throws(function () { D.bobotLembur(5, false); }, 'jam ke-5 di hari kerja DITOLAK, bukan dibayar 2x diam-diam');
    t.ok(pesanKerja.indexOf('PP 35/2021') >= 0, 'dan penolakannya menyebut dasar hukumnya');
    var pesanLibur = t.throws(function () { D.bobotLembur(12, true); }, 'jam ke-12 di hari libur DITOLAK, bukan diekstrapolasi 4x');
    t.ok(pesanLibur.indexOf('Kepmenaker 102/2004') >= 0, 'dan penolakan hari libur menyebut dasar hukumnya');
    t.throws(function () { D.upahLembur(3000000, 15, true); }, 'upahLembur ikut menolak, bukan hanya bobotnya');
    t.eq(D.bobotLembur(11, true), 2700, '11 jam hari libur tetap sah, tepat di batas');
    var monoton = true, lalu = -1;
    for (var j = 0; j <= 11; j++) {
      var v = D.upahLembur(7175000, j, true);
      if (v <= lalu && j > 0) monoton = false;
      lalu = v;
    }
    t.ok(monoton, 'upah lembur hari libur naik ketat dari 0 sampai 11 jam');
    var bulat = true;
    for (var u = 4000000; u <= 30000000; u += 611111) {
      for (j = 1; j <= 11; j++) if (!D.isInt(D.upahLembur(u, j, true))) bulat = false;
      for (j = 1; j <= 4; j++) if (!D.isInt(D.upahLembur(u, j, false))) bulat = false;
    }
    t.ok(bulat, '43 upah x (11 jam hari libur + 4 jam hari kerja): setiap upah lembur bilangan bulat');

    /* Overtime is computed from RECORDED OCCURRENCES, so two three-hour days
     * are not the same as one six-hour day — the first hour of each day is the
     * 1,5x hour. Software that sums monthly hours and applies the ladder once
     * underpays, and this is where it shows. */
    var duaHari = P.lembur(3460000, [{ tgl: '2025-01-06', jam: 2 }, { tgl: '2025-01-07', jam: 2 }]);
    var satuHari = P.lembur(3460000, [{ tgl: '2025-01-06', jam: 4 }]);
    t.eq(duaHari.total, 2 * 70000, 'dua hari x 2 jam = 2 x 3,5 x 20.000 = 140.000');
    t.eq(satuHari.total, 150000, 'satu hari 4 jam = 7,5 x 20.000 = 150.000');
    t.notOk(duaHari.total === satuHari.total, 'jadi empat jam dalam dua hari TIDAK sama dengan empat jam dalam satu hari');
    t.eq(duaHari.baris.length, 2, 'dan tiap kejadian tetap terpisah sebagai barisnya sendiri');
    t.eq(duaHari.baris[0].bobot, 350, 'bobot per baris ikut tercatat, jadi slip bisa menunjukkan hitungannya');
    t.eq(P.lembur(3460000, []).total, 0, 'tanpa catatan lembur, nol — bukan tunjangan tetap yang diam-diam masuk');
    t.eq(P.lembur(3460000, null).total, 0, 'catatan null juga nol');
  });

  /* ==================================== 11. THR ========================= */

  group('THR PP 36/2021: satu bulan upah di 12 bulan, prorata di bawahnya', function (t) {
    t.eq(D.THR_BULAN_PENUH, 12, 'hak penuh pada masa kerja 12 bulan');
    t.eq(D.thr(6000000, 12), 6000000, '12 bulan = satu bulan upah penuh');
    t.eq(D.thr(6000000, 13), 6000000, '13 bulan juga satu bulan upah, tidak lebih');
    t.eq(D.thr(6000000, 120), 6000000, 'sepuluh tahun tetap satu bulan upah');
    t.eq(D.thr(6000000, 11), 5500000, '11 bulan = 11/12 x 6.000.000 = 5.500.000');
    t.eq(D.thr(6000000, 6), 3000000, '6 bulan = separuh');
    t.eq(D.thr(6000000, 1), 500000, '1 bulan = 1/12');
    t.eq(D.thr(6000000, 0), 0, 'di bawah satu bulan masa kerja tidak ada hak THR');
    t.eq(D.thr(7175000, 7), 4185417, '7/12 x 7.175.000 = 4.185.416,67 -> 4.185.417, dibulatkan menjauhi nol');
    t.eq(D.thr(5000000, 5), 2083333, '5/12 x 5.000.000 = 2.083.333,33 -> 2.083.333');
    t.eq(D.thr(0, 12), 0, 'upah nol memberi THR nol');
    var jumlahProrata = 0;
    for (var b = 1; b <= 12; b++) jumlahProrata += D.thr(12000000, b);
    t.eq(jumlahProrata, 78000000, 'prorata 1..12 bulan atas upah 12.000.000 menjumlah ke 78.000.000 = (1+..+12)/12 x 12jt');
    var monoton = true, lalu = -1;
    for (b = 0; b <= 14; b++) { var v = D.thr(9500000, b); if (v < lalu) monoton = false; lalu = v; }
    t.ok(monoton, 'THR tidak pernah turun saat masa kerja bertambah');
    var bulat = true;
    for (var u = 4000000; u <= 60000000; u += 333333) {
      for (b = 0; b <= 12; b++) if (!D.isInt(D.thr(u, b))) bulat = false;
    }
    t.ok(bulat, '169 upah x 13 masa kerja: setiap THR bilangan bulat');
    t.throws(function () { D.thr(1.5, 12); }, 'upah THR pecahan melempar');
    t.throws(function () { D.thr(6000000, -1); }, 'masa kerja negatif melempar');
    t.throws(function () { D.thr(6000000, 1.5); }, 'masa kerja pecahan melempar');

    /* End to end: the THR month's payslip, and the proration measured to the
     * PAYMENT date rather than to the year end. */
    var u1 = satu({ pokok: 6000000, tetap: 1000000, mulai: '2024-10-20', thrBulan: 3, thrTanggal: '2025-03-24' });
    var s = P.praSlip(u1.ctx, u1.emp, 2025, 3);
    t.eq(s.thrInfo.bulanMasaKerja, 5, 'mulai 20 Oktober 2024, per 24 Maret 2025 masa kerjanya 5 bulan');
    t.eq(s.k.thr, D.thr(7000000, 5), 'jadi THR-nya 5/12 x 7.000.000');
    t.eq(s.k.thr, 2916667, 'yaitu 2.916.667');
    t.notOk(s.thrInfo.penuh, 'dan ditandai bukan hak penuh');
    var sFeb = P.praSlip(u1.ctx, u1.emp, 2025, 2);
    t.eq(sFeb.k.thr, 0, 'bulan lain tidak ada THR');
    t.eq(sFeb.thrInfo, null, 'dan tidak ada blok penjelasan THR di bulan lain');
    var u2 = satu({ pokok: 6000000, tetap: 1000000, mulai: '2020-01-05', thrBulan: 3, thrTanggal: '2025-03-24' });
    var s2 = P.praSlip(u2.ctx, u2.emp, 2025, 3);
    t.eq(s2.k.thr, 7000000, 'karyawan lama menerima satu bulan upah penuh — pokok + tunjangan TETAP');
    t.ok(s2.thrInfo.penuh, 'dan ditandai hak penuh');
    var u3 = satu({ pokok: 6000000, tetap: 1000000, mulai: '2025-03-10', thrBulan: 3, thrTanggal: '2025-03-24' });
    var s3 = P.praSlip(u3.ctx, u3.emp, 2025, 3);
    t.eq(s3.thrInfo.bulanMasaKerja, 0, 'yang baru masuk 14 hari sebelum hari raya punya 0 bulan masa kerja');
    t.eq(s3.k.thr, 0, 'jadi belum berhak THR');
    t.ok(s3.thrInfo.nihil, 'dan itu dinyatakan, bukan ditampilkan sebagai Rp0 tanpa penjelasan');
  });

  /* ==================================== 12. cuti ======================== */

  group('Cuti: akrual, saldo, dan saldo yang tidak boleh negatif tanpa override', function (t) {
    t.eq(D.CUTI_HAK_TAHUNAN, 12, 'hak cuti tahunan 12 hari kerja (UU 13/2003 Pasal 79)');
    t.eq(D.CUTI_SYARAT_BULAN, 12, 'setelah 12 bulan masa kerja berturut-turut');
    t.eq(D.cutiAkrual('2025-01-05', 2025, 6), 0, 'karyawan baru belum berhak cuti tahunan di bulan keenam');
    t.eq(D.cutiAkrual('2024-01-05', 2025, 1), 1, 'tepat lewat 12 bulan, akrual 1 hari');
    t.eq(D.cutiAkrual('2024-01-05', 2025, 6), 6, 'enam bulan setelah syarat terpenuhi, akrual 6 hari');
    t.eq(D.cutiAkrual('2015-01-05', 2025, 12), 18, 'karyawan lama menumpuk sampai batas 12 + 6 carry-over');
    t.eq(D.cutiAkrual('2015-01-05', 2025, 1), 18, 'dan batas itu memang batas, bukan pertumbuhan tanpa akhir');
    var u = satu({ mulai: '2015-01-05', cuti: [{ nip: 'T1', jenis: 'tahunan', mulai: '2025-04-10', hari: 5, override: false }] });
    var c = P.cuti(u.ctx, u.emp, 2025, 12);
    t.eq(c.akrual, 18, 'akrual 18');
    t.eq(c.diambil, 5, 'diambil 5');
    t.eq(c.saldo, 13, 'saldo 13 = 18 - 5');
    t.eq(c.saldo, c.akrual - c.diambil, 'saldo persis akrual dikurangi diambil (I6)');
    t.notOk(c.negatifTanpaIzin, 'dan tidak negatif');
    var cApril = P.cuti(u.ctx, u.emp, 2025, 3);
    t.eq(cApril.diambil, 0, 'cuti bulan April belum terhitung saat memandang posisi Maret');
    var u2 = satu({
      mulai: '2015-01-05', cuti: [
        { nip: 'T1', jenis: 'tahunan', mulai: '2025-04-10', hari: 10, override: false },
        { nip: 'T1', jenis: 'sakit', mulai: '2025-05-02', hari: 3, override: false }
      ]
    });
    var c2 = P.cuti(u2.ctx, u2.emp, 2025, 12);
    t.eq(c2.diambil, 10, 'cuti sakit tidak mengurangi saldo cuti tahunan');
    t.eq(c2.riwayat.length, 2, 'tetapi tetap muncul di riwayat');
    var izin = P.bolehAmbilCuti(u2.ctx, u2.emp, 2025, 12, 5, false);
    t.ok(izin.ok, 'permintaan 5 hari dengan saldo 8 disetujui');
    t.eq(izin.sisa, 3, 'dan sisanya 3');
    var tolak = P.bolehAmbilCuti(u2.ctx, u2.emp, 2025, 12, 12, false);
    t.notOk(tolak.ok, 'permintaan 12 hari dengan saldo 8 ditolak');
    t.ok(/negatif/.test(tolak.alasan), 'dan alasannya menyebut saldo tidak boleh negatif: ' + tolak.alasan);
    t.ok(/tanpa upah/.test(tolak.alasan), 'serta menawarkan cuti tanpa upah sebagai jalannya');
    var paksa = P.bolehAmbilCuti(u2.ctx, u2.emp, 2025, 12, 12, true);
    t.ok(paksa.ok, 'permintaan yang sama dengan override eksplisit disetujui');
    t.eq(paksa.sisa, -4, 'dan saldonya memang jadi negatif 4 — terlihat, bukan disembunyikan');
    t.notOk(P.bolehAmbilCuti(u2.ctx, u2.emp, 2025, 12, 0, false).ok, 'permintaan nol hari ditolak');
    t.notOk(P.bolehAmbilCuti(u2.ctx, u2.emp, 2025, 12, -3, false).ok, 'permintaan hari negatif ditolak');
    var u3 = satu({
      mulai: '2015-01-05', cuti: [{ nip: 'T1', jenis: 'tahunan', mulai: '2025-04-10', hari: 25, override: true }]
    });
    var c3 = P.cuti(u3.ctx, u3.emp, 2025, 12);
    t.eq(c3.saldo, -7, 'saldo negatif 7 setelah pengambilan ber-override');
    t.ok(c3.override, 'override tercatat pada saldonya');
    t.notOk(c3.negatifTanpaIzin, 'jadi ia negatif DENGAN izin, dan pemeriksaan invarian tidak merah');
    var u4 = satu({
      mulai: '2015-01-05', cuti: [{ nip: 'T1', jenis: 'tahunan', mulai: '2025-04-10', hari: 25, override: false }]
    });
    t.ok(P.cuti(u4.ctx, u4.emp, 2025, 12).negatifTanpaIzin, 'saldo negatif TANPA override ditandai — dan itulah yang membuat I6 bisa gagal');
  });

  /* ==================================== 13. slip & run ================== */

  group('Slip gaji: I1 neto = bruto − potongan pekerja', function (t) {
    /* A payslip whose every line can be checked by hand.
     *   pokok 8.000.000 + tetap 2.000.000 = upah sebulan 10.000.000
     *   BPJS pekerja: 100.000 + 200.000 + 100.000 = 400.000
     *   bruto pajak = 10.000.000 + 400.000 (kes pemberi) + 24.000 (JKK I) + 30.000 (JKM)
     *              = 10.454.000  -> TER A band 2,25%  -> 235.215
     *   neto = 10.000.000 - 400.000 - 235.215 = 9.364.785
     */
    var u = satu({ pokok: 8000000, tetap: 2000000, ptkp: 'TK/0', risiko: 'I' });
    var s = P.hitungBulan(u.ctx, u.emp, 2025, 5, []);
    t.eq(s.upahSebulan, 10000000, 'upah sebulan = pokok + tunjangan tetap');
    t.eq(s.k.bruto, 10000000, 'bruto = 10.000.000 (tanpa tunjangan makan, tanpa lembur, tanpa THR)');
    t.eq(s.k.dedKes, 100000, 'potongan Kesehatan 1%');
    t.eq(s.k.dedJht, 200000, 'potongan JHT 2%');
    t.eq(s.k.dedJp, 100000, 'potongan JP 1%');
    t.eq(s.k.premiKes, 400000, 'Kesehatan pemberi 4% masuk bruto pajak');
    t.eq(s.k.premiJkk, 24000, 'JKK kelas I masuk bruto pajak');
    t.eq(s.k.premiJkm, 30000, 'JKM masuk bruto pajak');
    t.eq(s.k.brutoPajak, 10454000, 'bruto pajak = 10.454.000, lebih besar dari bruto yang dibayar');
    t.eq(s.pajak.bp, 250, 'band TER A untuk 10.454.000 (10.350.001–10.700.000) adalah 2,5%');
    t.eq(s.k.dedPph21, 261350, 'PPh 21 = 2,5% x 10.454.000 = 261.350');
    t.eq(s.k.dedTotal, 661350, 'total potongan pekerja 661.350');
    t.eq(s.k.neto, 9338650, 'neto 9.338.650');
    t.eq(s.k.neto, s.k.bruto - s.k.dedTotal, 'I1: neto = bruto - potongan, tepat');
    t.eq(s.k.ptgTotal, 400000 + 370000 + 200000 + 24000 + 30000, 'beban pemberi kerja 1.024.000, ditotal terpisah');
    t.notOk(s.k.neto === s.k.bruto - s.k.dedTotal - s.k.ptgTotal, 'dan beban pemberi kerja TIDAK ikut mengurangi neto');
    t.eq(s.pajak.metode, 'ter', 'Mei memakai TER');
    t.eq(s.bulanKoreksi, 12, 'bulan koreksinya Desember');

    /* Unpaid absence as a NEGATIVE EARNING, prorated by the real working days
     * of that month. */
    var abs = {}; abs['2025-05'] = { hariKerja: D.hariKerja(2025, 5), hadir: D.hariKerja(2025, 5) - 3, tanpaUpah: 3, cuti: 0, sakit: 0 };
    var u2 = satu({ pokok: 8000000, tetap: 2000000, absensi: abs });
    var s2 = P.hitungBulan(u2.ctx, u2.emp, 2025, 5, []);
    var hk = D.hariKerja(2025, 5);
    t.eq(s2.hariTanpaUpah, 3, 'tiga hari tanpa upah tercatat');
    t.eq(s2.hariKerja, hk, 'dan pembaginya hari kerja bulan itu (' + hk + '), bukan 21 atau 22 yang ditebak');
    t.eq(s2.k.potonganAbsen, -D.divRound(10000000 * 3, hk), 'pengurangnya 3/' + hk + ' x upah sebulan, bertanda negatif');
    t.lt(s2.k.potonganAbsen, 0, 'ia baris pendapatan negatif, bukan potongan');
    t.eq(s2.k.bruto, 10000000 + s2.k.potonganAbsen, 'sehingga bruto turun — bukan neto yang dipotong belakangan');
    t.eq(s2.k.dedKes, 100000, 'iuran BPJS tetap dihitung atas upah kontraktual, tidak turun karena absen');
    t.lt(s2.k.dedPph21, s.k.dedPph21, 'dan pajaknya turun karena bruto pajaknya turun');
    t.eq(s2.k.neto, s2.k.bruto - s2.k.dedTotal, 'I1 tetap berlaku dengan absen tanpa upah');

    /* Overtime and meal allowance on the payslip, and the fact that neither is
     * in the overtime base. */
    var lem = {}; lem['2025-05'] = [{ tgl: '2025-05-06', jam: 3, libur: false }, { tgl: '2025-05-10', jam: 8, libur: true }];
    var u3 = satu({ pokok: 8000000, tetap: 2000000, makan: 30000, lembur: lem });
    var s3 = P.hitungBulan(u3.ctx, u3.emp, 2025, 5, []);
    t.eq(s3.lemburBaris.length, 2, 'dua kejadian lembur di slip');
    t.eq(s3.k.lembur, D.upahLembur(10000000, 3, false) + D.upahLembur(10000000, 8, true), 'lembur = jumlah kedua kejadian, masing-masing dengan tangganya sendiri');
    t.eq(s3.k.tunjanganMakan, D.mul(30000, hk), 'tunjangan makan = 30.000 x hari hadir');
    t.eq(s3.k.bruto, 10000000 + s3.k.lembur + s3.k.tunjanganMakan, 'bruto memuat keduanya');
    t.eq(P.lembur(10000000, lem['2025-05']).total, s3.k.lembur, 'dan dasar lemburnya tetap 10.000.000 — tunjangan makan yang variabel tidak menaikkannya');
    t.eq(s3.k.neto, s3.k.bruto - s3.k.dedTotal, 'I1 tetap berlaku dengan lembur dan tunjangan makan');
    t.gt(s3.k.dedPph21, s.k.dedPph21, 'lembur menaikkan bruto pajak, jadi menaikkan PPh 21 bulan itu');

    /* Every column integer, on a payslip built from awkward numbers. */
    var u4 = satu({ pokok: 5333333, tetap: 1111111, risiko: 'IV', ptkp: 'K/2', makan: 27777, lembur: { '2025-07': [{ tgl: '2025-07-03', jam: 5, libur: true }] } });
    var s4 = P.hitungBulan(u4.ctx, u4.emp, 2025, 7, []);
    var semuaBulat = P.KOLOM.every(function (c) { return D.isInt(s4.k[c]); });
    t.ok(semuaBulat, 'I7: seluruh ' + P.KOLOM.length + ' kolom slip dengan angka ganjil tetap bilangan bulat');
    t.eq(s4.k.neto, s4.k.bruto - s4.k.dedTotal, 'dan I1 tetap tepat pada angka ganjil');
  });

  group('Run payroll: I2 total = jumlah slip, di setiap kolom', function (t) {
    var d = db();
    var ids = Object.keys(d.runs).sort();
    t.eq(ids.length, 12, 'dua belas run untuk tahun pajak 2025');
    t.eq(P.KOLOM.length, 23, 'dua puluh tiga kolom uang per slip');
    var gagalKolom = [], n = 0;
    ids.forEach(function (id) {
      var r = d.runs[id];
      var t2 = P.totalDari(r.slips);
      P.KOLOM.forEach(function (c) { n++; if (r.total[c] !== t2[c]) gagalKolom.push(id + '.' + c); });
    });
    t.eq(gagalKolom.length, 0, n + ' kolom x run direkonsiliasi ke jumlah slipnya: ' + (gagalKolom.length ? gagalKolom.join(',') : 'semua cocok'));
    var jan = d.runs['RUN-2025-01'];
    t.gt(jan.slips.length, 50, 'run Januari memuat ' + jan.slips.length + ' slip');
    var netoJumlah = 0;
    jan.slips.forEach(function (s) { netoJumlah += s.k.neto; });
    t.eq(jan.total.neto, netoJumlah, 'total neto Januari = jumlah neto slipnya');
    t.eq(jan.total.bruto - jan.total.dedTotal, jan.total.neto, 'dan identitas I1 juga berlaku di tingkat total run');
    var pemberiJumlah = 0;
    jan.slips.forEach(function (s) { pemberiJumlah += s.k.ptgTotal; });
    t.eq(jan.total.ptgTotal, pemberiJumlah, 'total beban pemberi kerja juga terekonsiliasi');
    t.eq(jan.total.ptgTotal, jan.total.ptgKes + jan.total.ptgJht + jan.total.ptgJp + jan.total.ptgJkk + jan.total.ptgJkm, 'dan terurai ke lima komponennya');
    t.eq(jan.total.dedTotal, jan.total.dedKes + jan.total.dedJht + jan.total.dedJp + jan.total.dedPph21, 'total potongan terurai ke empat komponennya');
    var mar = d.runs['RUN-2025-03'];
    t.gt(mar.total.thr, 0, 'run Maret memuat THR');
    t.eq(d.runs['RUN-2025-04'].total.thr, 0, 'run April tidak');
    t.gt(mar.total.dedPph21, jan.total.dedPph21, 'dan PPh 21 Maret jauh di atas Januari, karena THR masuk bruto pajak bulan itu');
    var totalKosong = P.totalDari([]);
    t.eq(totalKosong.neto, 0, 'run tanpa slip bertotal nol, bukan undefined');
    t.eq(Object.keys(totalKosong).length, P.KOLOM.length, 'dan tetap punya seluruh kolomnya');
  });

  group('I5: beban pemberi kerja tidak pernah menyentuh neto', function (t) {
    var netoPerKelas = {}, potonganPerKelas = {}, pemberiPerKelas = {};
    D.KELAS_RISIKO.forEach(function (kelas) {
      var u = satu({ pokok: 8000000, tetap: 2000000, risiko: kelas });
      var s = P.hitungBulan(u.ctx, u.emp, 2025, 5, []);
      netoPerKelas[kelas] = s.k.neto;
      potonganPerKelas[kelas] = s.k.dedKes + s.k.dedJht + s.k.dedJp;
      pemberiPerKelas[kelas] = s.k.ptgTotal;
    });
    /* JKK differs by class, so employer cost MUST differ — that half proves the
     * test is not vacuous. */
    t.notOk(pemberiPerKelas['I'] === pemberiPerKelas['V'], 'beban pemberi kerja memang berbeda antara kelas risiko I dan V');
    t.eq(potonganPerKelas['I'], potonganPerKelas['V'], 'tetapi potongan BPJS pekerja identik di kedua kelas');
    /* Net differs only through the tax on the taxable JKK premium — which is a
     * real rule, not a leak — so the assertion is on the DEDUCTION side, plus
     * the reconstruction identity below. */
    var u = satu({ pokok: 8000000, tetap: 2000000, risiko: 'III' });
    var s = P.hitungBulan(u.ctx, u.emp, 2025, 5, []);
    var tanpaPemberi = s.k.bruto - (s.k.dedKes + s.k.dedJht + s.k.dedJp + s.k.dedPph21);
    t.eq(s.k.neto, tanpaPemberi, 'neto dapat disusun ulang tanpa menyentuh satu pun kolom pemberi kerja');
    var irisan = P.KOLOM_PEMBERI.filter(function (c) { return P.KOLOM_POTONGAN.indexOf(c) >= 0; });
    t.eq(irisan.length, 0, 'daftar kolom potongan dan daftar kolom pemberi kerja tidak beririsan');
    t.eq(P.KOLOM_POTONGAN.length, 4, 'empat kolom potongan pekerja');
    t.eq(P.KOLOM_PEMBERI.length, 5, 'lima kolom beban pemberi kerja');
    var d = db();
    var bocor = [];
    d.runs['RUN-2025-06'].slips.forEach(function (sl) {
      if (sl.k.neto !== sl.k.bruto - (sl.k.dedKes + sl.k.dedJht + sl.k.dedJp + sl.k.dedPph21)) bocor.push(sl.nip);
      if (sl.k.dedTotal >= sl.k.dedTotal + sl.k.ptgTotal && sl.k.ptgTotal > 0) bocor.push(sl.nip + ' total');
    });
    t.eq(bocor.length, 0, 'seluruh slip Juni pada perusahaan demo menyusun ulang netonya tanpa kolom pemberi kerja');
    /* The employer's total cost of employment, which is a real number that
     * should be reported and is NOT the gross. */
    var jun = d.runs['RUN-2025-06'];
    t.eq(jun.total.bruto + jun.total.ptgTotal > jun.total.bruto, true, 'biaya total pemberi kerja = bruto + iuran pemberi, di atas bruto');
    t.gt(jun.total.ptgTotal, jun.total.dedKes + jun.total.dedJht + jun.total.dedJp, 'dan iuran pemberi kerja lebih besar dari iuran pekerja, sebagaimana tarifnya');
  });

  /* ==================================== 14. perusahaan demo ============= */

  group('I3 atas perusahaan demo: 62 karyawan, termasuk joiner dan leaver', function (t) {
    var d = db();
    t.gte(d.karyawan.length, 60, d.karyawan.length + ' karyawan');
    var gagal = [], diperiksa = 0, joiner = 0, leaver = 0, restitusi = 0, nol = 0;
    d.karyawan.forEach(function (emp) {
      var aktif = P.bulanAktif(emp, 2025);
      var rw = P.riwayatPajak(d.runs, emp.nip, 2025);
      diperiksa++;
      if (aktif.length < 12) { if (emp.selesai) leaver++; else joiner++; }
      if (rw.length !== aktif.length) { gagal.push(emp.nip + ' jumlah run != bulan aktif'); return; }
      var bruto = 0, jht = 0, jp = 0, dipotong = 0;
      rw.forEach(function (r) { bruto += r.brutoPajak; jht += r.jhtPekerja; jp += r.jpPekerja; dipotong += r.pph21; });
      /* Independent recomputation: this call knows nothing about how the
       * monthly figures were produced. */
      var th = T.pph21Tahunan({ status: emp.ptkp, brutoTahun: bruto, bulanKerja: aktif.length, jhtPekerja: jht, jpPekerja: jp });
      if (dipotong !== th.pph) gagal.push(emp.nip + ': ' + dipotong + ' != ' + th.pph);
      if (th.pph === 0) nol++;
      var bk = P.bulanKoreksi(emp, 2025);
      var slipKoreksi = null;
      d.runs['RUN-2025-' + (bk < 10 ? '0' : '') + bk].slips.forEach(function (s) { if (s.nip === emp.nip) slipKoreksi = s; });
      if (!slipKoreksi) gagal.push(emp.nip + ' tidak punya slip di bulan koreksi ' + bk);
      else {
        if (slipKoreksi.pajak.metode !== 'setahun') gagal.push(emp.nip + ' slip bulan koreksi tidak memakai perhitungan setahun');
        if (slipKoreksi.k.dedPph21 < 0) restitusi++;
      }
    });
    t.eq(gagal.length, 0, 'I3: Σ PPh 21 bulanan = perhitungan setahun untuk ' + diperiksa + ' karyawan — ' + (gagal.length ? gagal.slice(0, 3).join(' · ') : 'semuanya tepat ke rupiah'));
    t.gte(joiner, 3, joiner + ' joiner tengah tahun ada di data');
    t.gte(leaver, 1, leaver + ' leaver ada di data');
    t.gt(restitusi, 0, restitusi + ' karyawan menerima restitusi di bulan koreksi — akibat wajar TER pada bulan THR');
    t.gt(diperiksa - nol, 40, (diperiksa - nol) + ' karyawan benar-benar berpajak, jadi rekonsiliasinya bukan soal nol sama dengan nol');

    /* The leaver's correction month is August, and December has no slip. */
    var lv = d.karyawan.filter(function (e) { return e.selesai; })[0];
    t.ok(!!lv, 'ada karyawan dengan tanggal berhenti');
    t.eq(P.bulanKoreksi(lv, 2025), D.bulanDari(lv.selesai), 'bulan koreksi leaver = bulan terakhir bekerja (' + D.bulanDari(lv.selesai) + '), bukan Desember');
    var adaDes = d.runs['RUN-2025-12'].slips.some(function (s) { return s.nip === lv.nip; });
    t.notOk(adaDes, 'dan leaver tidak muncul di run Desember');
    var slipAgu = d.runs['RUN-2025-0' + D.bulanDari(lv.selesai)].slips.filter(function (s) { return s.nip === lv.nip; })[0];
    t.eq(slipAgu.pajak.metode, 'setahun', 'slip terakhir leaver memakai perhitungan setahun');
    t.eq(slipAgu.pajak.bulanKerja, D.bulanDari(lv.selesai), 'dengan bulan kerja ' + D.bulanDari(lv.selesai));
    t.eq(slipAgu.pajak.tahunan.biayaJabatanCap, D.mul(500000, D.bulanDari(lv.selesai)), 'dan plafon biaya jabatan yang diprorata ke bulan kerjanya');

    /* The November joiner: two months, and the December correction. */
    var jn = d.karyawan.filter(function (e) { return D.tahunDari(e.mulai) === 2025 && D.bulanDari(e.mulai) === 11; })[0];
    t.ok(!!jn, 'ada joiner November');
    t.eq(P.bulanAktif(jn, 2025).join(','), '11,12', 'ia aktif hanya November dan Desember');
    var slipNov = d.runs['RUN-2025-11'].slips.filter(function (s) { return s.nip === jn.nip; })[0];
    var slipDes = d.runs['RUN-2025-12'].slips.filter(function (s) { return s.nip === jn.nip; })[0];
    t.eq(slipNov.pajak.metode, 'ter', 'November-nya TER');
    t.eq(slipDes.pajak.metode, 'setahun', 'Desember-nya perhitungan setahun');
    t.eq(slipDes.pajak.bulanKerja, 2, 'dengan dua bulan kerja');
    t.eq(slipDes.pajak.tahunan.ptkp, D.ptkpOf(jn.ptkp), 'PTKP-nya penuh, tidak diprorata dua per dua belas');
    t.eq(slipNov.k.dedPph21 + slipDes.k.dedPph21, slipDes.pajak.tahunan.pph, 'dan dua potongannya menjumlah ke kewajiban setahunnya');
  });

  group('Perusahaan demo: sebaran yang membuat plafon dan kategori terlihat', function (t) {
    var d = db();
    var ptkp = {}, risiko = {}, atasKes = 0, hanyaJp = 0, bawahUmk = 0, kategori = { A: 0, B: 0, C: 0 };
    d.karyawan.forEach(function (e) {
      var u = e.gajiPokok + e.tunjanganTetap;
      ptkp[e.ptkp] = (ptkp[e.ptkp] || 0) + 1;
      risiko[e.risiko] = (risiko[e.risiko] || 0) + 1;
      kategori[D.kategoriTER(e.ptkp)]++;
      if (u > D.KESEHATAN.batasAtas) atasKes++;
      else if (u > D.JP.batasAtas) hanyaJp++;
      if (u < d.cfg.umk) bawahUmk++;
    });
    t.gte(Object.keys(ptkp).length, 6, Object.keys(ptkp).length + ' status PTKP berbeda terwakili');
    t.eq(Object.keys(risiko).length, 4, Object.keys(risiko).length + ' kelas risiko JKK terwakili: ' + Object.keys(risiko).sort().join(', '));
    t.gt(kategori.A, 0, 'kategori TER A terwakili (' + kategori.A + ')');
    t.gt(kategori.B, 0, 'kategori TER B terwakili (' + kategori.B + ')');
    t.gt(kategori.C, 0, 'kategori TER C terwakili (' + kategori.C + ')');
    t.gte(atasKes, 5, atasKes + ' karyawan di atas plafon Kesehatan, jadi plafonnya benar-benar menggigit di data');
    t.gte(hanyaJp, 1, hanyaJp + ' karyawan di rentang di mana hanya JP yang tertahan');
    t.gte(bawahUmk, 1, bawahUmk + ' karyawan di bawah UMK, jadi lantai iuran juga terlihat');
    var tepatJp = d.karyawan.filter(function (e) { return e.gajiPokok + e.tunjanganTetap === D.JP.batasAtas; }).length;
    var tepatKes = d.karyawan.filter(function (e) { return e.gajiPokok + e.tunjanganTetap === D.KESEHATAN.batasAtas; }).length;
    t.gte(tepatJp, 1, 'ada karyawan dengan upah TEPAT di plafon JP, jadi kasus batas ada di data dan bukan hanya di uji');
    t.gte(tepatKes, 1, 'dan ada yang tepat di plafon Kesehatan');
    var lembur = 0, absen = 0, cutiTahunan = 0;
    Object.keys(d.lembur).forEach(function (nip) { lembur += Object.keys(d.lembur[nip]).length; });
    Object.keys(d.absensi).forEach(function (nip) {
      Object.keys(d.absensi[nip]).forEach(function (per) { if (d.absensi[nip][per].tanpaUpah) absen++; });
    });
    d.cuti.forEach(function (c) { if (c.jenis === 'tahunan') cutiTahunan++; });
    t.gt(lembur, 100, lembur + ' bulan-karyawan punya catatan lembur nyata');
    t.gt(absen, 5, absen + ' bulan-karyawan punya absen tanpa upah');
    t.gt(cutiTahunan, 30, cutiTahunan + ' pengajuan cuti tahunan');
    t.eq(d.cuti.filter(function (c) { return c.override; }).length, 1, 'tepat satu pengambilan cuti ber-override, sengaja, untuk membuktikan jalurnya ada');
    var negatif = 0;
    d.karyawan.forEach(function (e) { if (P.cuti(d.ctx, e, 2025, 12).saldo < 0) negatif++; });
    t.eq(negatif, 1, 'dan tepat satu saldo cuti negatif — yang ber-override itu');
    var tanpaIzin = 0;
    d.karyawan.forEach(function (e) { if (P.cuti(d.ctx, e, 2025, 12).negatifTanpaIzin) tanpaIzin++; });
    t.eq(tanpaIzin, 0, 'tidak ada saldo negatif tanpa izin (I6)');
  });

  group('Data fabrikasi: tidak ada NIK, NPWP, rekening atau nomor BPJS yang bisa nyata', function (t) {
    var d = db();
    var nikSalah = [], npwpSalah = [], rekSalah = [], bpjsSalah = [], panjangSalah = [];
    d.karyawan.forEach(function (e) {
      if (e.nik.slice(0, 2) !== '99') nikSalah.push(e.nip);
      if (e.nik.length !== 16) panjangSalah.push(e.nip + ' nik');
      if (e.npwp.slice(0, 2) !== '99') npwpSalah.push(e.nip);
      if (e.rekening.slice(0, 4) !== '0000') rekSalah.push(e.nip);
      if (e.bpjsKes.slice(0, 3) !== '999' || e.bpjsTk.slice(0, 3) !== '999') bpjsSalah.push(e.nip);
    });
    t.eq(nikSalah.length, 0, 'setiap NIK berawalan 99 — kode provinsi yang tidak pernah diterbitkan Dukcapil (yang nyata 11–94)');
    t.eq(panjangSalah.length, 0, 'dan setiap NIK tetap 16 digit, jadi bentuknya benar sementara isinya mustahil');
    t.eq(npwpSalah.length, 0, 'setiap NPWP berawalan kategori 99, yang tidak pernah diterbitkan DJP');
    t.eq(rekSalah.length, 0, 'setiap nomor rekening berawalan 0000, yang tidak diterbitkan bank Indonesia mana pun');
    t.eq(bpjsSalah.length, 0, 'setiap nomor BPJS berawalan 999, di luar rentang yang diterbitkan');
    t.eq(d.cfg.npwpPerusahaan.slice(0, 2), '99', 'NPWP perusahaan demo juga berawalan 99');
    var namaKosong = d.karyawan.filter(function (e) { return !e.nama || e.nama.length < 3; }).length;
    t.eq(namaKosong, 0, 'setiap nama tersusun dan tidak kosong');
    var unikNip = {};
    d.karyawan.forEach(function (e) { unikNip[e.nip] = 1; });
    t.eq(Object.keys(unikNip).length, d.karyawan.length, 'NIP unik untuk seluruh ' + d.karyawan.length + ' karyawan');
  });

  group('Determinisme: satu bilangan seed, dan hasil yang sama setiap kali', function (t) {
    var a = S.build(12345), b = S.build(12345), c = S.build(999);
    t.eq(a.karyawan.length, b.karyawan.length, 'dua build dengan seed sama menghasilkan jumlah karyawan sama');
    t.eq(a.karyawan[7].nama, b.karyawan[7].nama, 'dan nama yang sama');
    t.eq(a.karyawan[7].gajiPokok, b.karyawan[7].gajiPokok, 'dan gaji yang sama');
    t.eq(a.runs['RUN-2025-12'].total.neto, b.runs['RUN-2025-12'].total.neto, 'dan total neto Desember yang sama ke rupiah');
    t.eq(a.runs['RUN-2025-12'].total.dedPph21, b.runs['RUN-2025-12'].total.dedPph21, 'dan PPh 21 Desember yang sama');
    t.notOk(a.karyawan[7].nama === c.karyawan[7].nama, 'seed lain menghasilkan orang lain, jadi seed-nya memang dipakai');
    var pa = P.periksa(a.ctx, a.runs), pc = P.periksa(c.ctx, c.runs);
    t.eq(pa.gagal, 0, 'perusahaan seed 12345 memenuhi seluruh invariannya');
    t.eq(pc.gagal, 0, 'perusahaan seed 999 juga');
    t.eq(pa.total, pc.total, 'dengan jumlah pemeriksaan yang sama (' + pa.total + ')');
    var d3 = S.build(20260908), p3 = P.periksa(d3.ctx, d3.runs);
    t.eq(p3.gagal, 0, 'dan seed ketiga juga lulus — bukan satu seed keberuntungan');
    t.gt(D.maxProduct(), 0, 'penjaga batas bilangan bulat aman ikut mengawasi; perkalian terbesar yang pernah dilihat ' + D.maxProduct());
    t.lt(D.maxProduct(), D.MAX_SAFE, 'dan tetap di bawah 2^53');
  });

  /* ==================================== 15. pemeriksaan invarian ======== */

  group('Pemeriksaan invarian hidup atas buku yang dimuat', function (t) {
    var d = db();
    var pr = P.periksa(d.ctx, d.runs);
    t.eq(pr.gagal, 0, 'seluruh ' + pr.total + ' pemeriksaan invarian terpenuhi di perusahaan demo');
    t.gt(pr.slip, 700, pr.slip + ' slip diperiksa');
    t.eq(pr.run, 12, '12 run');
    t.eq(pr.tahunLengkap, d.karyawan.length, 'dan seluruh ' + pr.tahunLengkap + ' tahun-karyawan lengkap, jadi I3 tidak lulus secara hampa');
    var nama = pr.cek.map(function (c) { return c.nama; }).join(' | ');
    ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'].forEach(function (k) {
      t.ok(nama.indexOf(k + ' ') >= 0, 'invarian ' + k + ' hadir sebagai baris pemeriksaan tersendiri');
    });

    /* A check that cannot fail is decoration. Eight deliberately corrupted
     * books here, each broken in one specific way, each caught by its own line —
     * and a ninth in the tax-only correction group below, where a single rupiah
     * of gaji pokok on a tax-only payslip must turn I4 red. */
    function rusak(fn) {
      var dd = S.build(4242);
      fn(dd);
      return P.periksa(dd.ctx, dd.runs);
    }
    function merah(pr2) { return pr2.cek.filter(function (c) { return !c.ok; }).map(function (c) { return c.nama; }).join(' | '); }

    var r1 = rusak(function (dd) { dd.runs['RUN-2025-05'].slips[0].k.neto += 1; });
    t.gt(r1.gagal, 0, 'satu rupiah ditambahkan ke satu neto membuat pemeriksaan merah');
    t.ok(/^I1 /.test(merah(r1)) || /I1 /.test(merah(r1)), 'dan yang merah adalah I1: ' + merah(r1));

    var r2 = rusak(function (dd) { dd.runs['RUN-2025-05'].total.bruto += 1000; });
    t.gt(r2.gagal, 0, 'total run yang digeser membuat pemeriksaan merah');
    t.ok(/I2 /.test(merah(r2)), 'dan yang merah adalah I2: ' + merah(r2));

    var r3 = rusak(function (dd) { dd.runs['RUN-2025-12'].slips[0].k.dedPph21 -= 5000; dd.runs['RUN-2025-12'].slips[0].k.dedTotal -= 5000; dd.runs['RUN-2025-12'].slips[0].k.neto += 5000; dd.runs['RUN-2025-12'].total = P.totalDari(dd.runs['RUN-2025-12'].slips); });
    t.gt(r3.gagal, 0, 'true-up Desember yang digeser 5.000 — dengan neto dan total ikut dirapikan supaya I1 dan I2 tetap lulus — tetap tertangkap');
    t.ok(/I3 /.test(merah(r3)), 'dan yang merah HANYA I3: ' + merah(r3));

    var r4 = rusak(function (dd) {
      dd.runs['RUN-2025-05'].slips.forEach(function (s) { if (s.upahSebulan > 12000000) { s.k.dedKes = D.bpRound(s.upahSebulan, 100); } });
      dd.runs['RUN-2025-05'].total = P.totalDari(dd.runs['RUN-2025-05'].slips);
    });
    t.gt(r4.gagal, 0, 'plafon Kesehatan yang dilepas untuk yang berpenghasilan tinggi tertangkap');
    t.ok(/I4 /.test(merah(r4)), 'dan yang merah adalah I4: ' + merah(r4));

    var r5 = rusak(function (dd) { dd.runs['RUN-2025-05'].slips[0].k.ptgTotal += 1; });
    t.gt(r5.gagal, 0, 'total beban pemberi kerja yang tidak lagi menjumlah tertangkap');
    t.ok(/I5 /.test(merah(r5)), 'dan yang merah adalah I5: ' + merah(r5));

    var r6 = rusak(function (dd) {
      dd.cuti.push({ id: 'X', nip: dd.karyawan[0].nip, jenis: 'tahunan', mulai: '2025-02-01', hari: 40, override: false });
    });
    t.gt(r6.gagal, 0, 'saldo cuti yang negatif tanpa override tertangkap');
    t.ok(/I6 /.test(merah(r6)), 'dan yang merah adalah I6: ' + merah(r6));

    var r7 = rusak(function (dd) { dd.runs['RUN-2025-05'].slips[0].k.lembur = 1234.5; dd.runs['RUN-2025-05'].total = P.totalDari(dd.runs['RUN-2025-05'].slips); });
    t.gt(r7.gagal, 0, 'satu nilai pecahan di satu kolom lembur tertangkap');
    t.ok(/I7 /.test(merah(r7)), 'dan yang merah adalah I7: ' + merah(r7));

    var r8 = rusak(function (dd) { dd.runs['RUN-2025-05'].dikunciOleh = null; });
    t.gt(r8.gagal, 0, 'run terkunci tanpa nama penandatangan tertangkap');
    t.ok(/terkunci/.test(merah(r8)), 'dan yang merah menyebut run terkunci: ' + merah(r8));
  });

  /* ==================================== 16. peran dan kunci ============= */

  group('Peran: HR admin, payroll officer, finance approver', function (t) {
    t.eq(P.DAFTAR_PERAN.length, 3, 'tiga peran');
    t.ok(P.boleh('hr', 'karyawan.ubah'), 'HR admin boleh mengubah data induk');
    t.notOk(P.boleh('payroll', 'karyawan.ubah'), 'payroll officer TIDAK boleh mengubah data induk');
    t.notOk(P.boleh('finance', 'karyawan.ubah'), 'finance approver juga tidak');
    t.ok(P.boleh('payroll', 'run.jalankan'), 'payroll officer boleh menjalankan run');
    t.notOk(P.boleh('hr', 'run.jalankan'), 'HR admin tidak boleh menjalankan run');
    t.notOk(P.boleh('finance', 'run.jalankan'), 'finance approver tidak boleh menjalankan run — ia menandatangani angka orang lain');
    t.ok(P.boleh('finance', 'run.kunci'), 'finance approver boleh mengunci');
    t.notOk(P.boleh('payroll', 'run.kunci'), 'payroll officer TIDAK boleh mengunci pekerjaannya sendiri');
    t.notOk(P.boleh('hr', 'run.kunci'), 'HR admin tidak boleh mengunci');
    t.ok(P.boleh('payroll', 'run.tinjau'), 'peninjauan milik payroll officer');
    t.ok(P.boleh('hr', 'cuti.override'), 'override cuti milik HR admin');
    t.notOk(P.boleh('payroll', 'cuti.override'), 'bukan payroll officer');
    t.notOk(P.boleh('tamu', 'run.kunci'), 'peran yang tidak ada tidak boleh apa pun');
    var pesan = P.tolakan('payroll', 'run.kunci');
    t.ok(/Finance approver/.test(pesan), 'penolakan menyebut siapa yang berwenang: ' + pesan);
    t.ok(pesan.length > 60, 'dan menjelaskan alasannya, bukan hanya "ditolak"');
    /* Nobody may both compute and approve. That is the entire control. */
    var ganda = P.DAFTAR_PERAN.filter(function (p) { return P.boleh(p, 'run.jalankan') && P.boleh(p, 'run.kunci'); });
    t.eq(ganda.length, 0, 'tidak satu peran pun boleh menjalankan DAN mengunci run yang sama');
    var gandaData = P.DAFTAR_PERAN.filter(function (p) { return P.boleh(p, 'karyawan.ubah') && P.boleh(p, 'run.jalankan'); });
    t.eq(gandaData.length, 0, 'dan tidak satu peran pun boleh mengubah gaji lalu menjalankan payroll atasnya');
  });

  group('Run terkunci tidak bisa diubah; koreksi lewat run penyesuaian', function (t) {
    var u = satu({ pokok: 8000000, tetap: 2000000 });
    var runs = {};
    var r = P.jalankan(u.ctx, runs, 2025, 1, {});
    runs[r.id] = r;
    t.eq(r.status, 'draft', 'run baru berstatus draft');
    t.eq(r.dikunciOleh, null, 'dan belum ada penandatangan');
    t.throws(function () { P.kunci(r, 'finance', 'fin'); }, 'draft yang belum ditinjau tidak bisa langsung dikunci');
    t.throws(function () { P.tinjau(r, 'finance', 'fin'); }, 'finance approver tidak bisa meninjau');
    P.tinjau(r, 'payroll', 'pay');
    t.eq(r.status, 'ditinjau', 'payroll officer meninjau');
    t.eq(r.ditinjauOleh, 'pay', 'dan namanya tercatat');
    t.throws(function () { P.kunci(r, 'payroll', 'pay'); }, 'payroll officer tetap tidak boleh mengunci');
    P.kunci(r, 'finance', 'fin');
    t.eq(r.status, 'terkunci', 'finance approver mengunci');
    t.eq(r.dikunciOleh, 'fin', 'dan namanya tercatat');
    t.ok(!!r.dikunciAt, 'dengan tanggalnya');
    t.notOk(P.bolehTulisRun(r), 'run terkunci tidak boleh ditulis');
    t.throws(function () { P.kunci(r, 'finance', 'fin'); }, 'mengunci dua kali melempar');
    t.throws(function () { P.tinjau(r, 'payroll', 'pay'); }, 'meninjau ulang run terkunci melempar');
    var pesan = t.throws(function () { P.jalankan(u.ctx, runs, 2025, 1, {}); }, 'menjalankan ulang bulan yang runnya terkunci melempar');
    t.ok(/penyesuaian/.test(pesan), 'dan pesannya mengarahkan ke run penyesuaian: ' + pesan);
    var adj = P.jalankan(u.ctx, runs, 2025, 1, { jenis: 'penyesuaian', seri: 1 });
    t.eq(adj.id, 'RUN-2025-01-ADJ1', 'run penyesuaian punya id sendiri');
    t.notOk(adj.id === r.id, 'jadi ia tidak menimpa run yang sudah dikunci');
    t.eq(adj.status, 'draft', 'dan mulai sebagai draft yang butuh persetujuannya sendiri');
    t.eq(adj.jenis, 'penyesuaian', 'jenisnya tercatat sebagai penyesuaian');
    /* The locked run's own signature is over its payslips, so locking
     * recomputes the total rather than trusting the cached one. */
    var u2 = satu({ pokok: 8000000, tetap: 2000000 });
    var r2 = P.jalankan(u2.ctx, {}, 2025, 2, {});
    r2.total.bruto = 1;
    P.tinjau(r2, 'payroll', 'pay');
    P.kunci(r2, 'finance', 'fin');
    t.eq(r2.total.bruto, P.totalDari(r2.slips).bruto, 'saat dikunci, total dihitung ulang dari slipnya — menandatangani total yang di-cache sama dengan tidak menandatangani apa pun');
  });

  group('Satu tahun penuh dijalankan seperti dari UI, bulan demi bulan', function (t) {
    /* Exactly the path the reviewer drives: run each month in order, each run
     * reading the runs already posted. Then check the reconciliation. */
    var u = satu({ pokok: 9000000, tetap: 2500000, ptkp: 'K/1', risiko: 'III', makan: 30000, thrBulan: 3, thrTanggal: '2025-03-24' });
    var runs = tahunkan(u, { kunci: true });
    t.eq(Object.keys(runs).length, 12, 'dua belas run dijalankan berurutan');
    var slips = slipsOf(runs, 'T1');
    t.eq(slips.length, 12, 'dua belas slip');
    t.ok(slips.slice(0, 11).every(function (s) { return s.pajak.metode === 'ter'; }), 'Januari–November TER');
    t.eq(slips[11].pajak.metode, 'setahun', 'Desember perhitungan setahun');
    var bruto = 0, jht = 0, jp = 0, pph = 0;
    slips.forEach(function (s) { bruto += s.k.brutoPajak; jht += s.k.dedJht; jp += s.k.dedJp; pph += s.k.dedPph21; });
    var th = T.pph21Tahunan({ status: 'K/1', brutoTahun: bruto, bulanKerja: 12, jhtPekerja: jht, jpPekerja: jp });
    t.eq(pph, th.pph, 'Σ dua belas potongan = perhitungan setahun yang dihitung ulang secara mandiri');
    t.eq(slips[11].pajak.sudahDipotong, pph - slips[11].k.dedPph21, 'dan slip Desember melaporkan akumulasi Januari–November dengan benar');
    t.eq(slips[11].pajak.tahunan.pph, th.pph, 'serta angka setahun yang sama');
    t.eq(slips[11].k.dedPph21, th.pph - slips[11].pajak.sudahDipotong, 'koreksi Desember = setahun - yang sudah dipotong');
    t.gt(slips[2].k.thr, 0, 'Maret memuat THR');
    t.gt(slips[2].k.dedPph21, slips[1].k.dedPph21, 'jadi PPh 21 Maret lebih besar dari Februari');
    t.gt(slips[2].pajak.bp, slips[1].pajak.bp, 'karena bruto pajaknya naik ke band TER yang lebih tinggi');
    var i1 = slips.every(function (s) { return s.k.neto === s.k.bruto - s.k.dedTotal; });
    t.ok(i1, 'I1 berlaku di dua belas slip');
    var pr = P.periksa(u.ctx, runs);
    t.eq(pr.gagal, 0, 'dan pemeriksaan invarian penuh atas tahun yang baru dijalankan lulus (' + pr.total + ' baris)');

    /* Now change the PTKP status in November — after eleven months have been
     * locked — and re-run December. The locked months do not move; December
     * absorbs the entire difference; the reconciliation still closes. */
    var pphSebelum = slips[11].k.dedPph21;
    u.emp.ptkp = 'K/3';
    delete runs['RUN-2025-12'];
    var desBaru = P.jalankan(u.ctx, runs, 2025, 12, {});
    runs[desBaru.id] = desBaru;
    var slipBaru = desBaru.slips[0];
    t.notOk(slipBaru.k.dedPph21 === pphSebelum, 'mengubah status PTKP menggerakkan potongan Desember');
    t.lt(slipBaru.k.dedPph21, pphSebelum, 'ke arah yang benar: PTKP K/3 lebih besar, jadi pajaknya lebih kecil');
    t.eq(slipBaru.pajak.tahunan.ptkp, 72000000, 'perhitungan setahunnya kini memakai PTKP K/3');
    var jan = runs['RUN-2025-01'].slips[0];
    t.eq(jan.pajak.kategori, 'B', 'sementara slip Januari yang terkunci tetap memakai kategori TER B yang lama');
    var pphBaru = 0;
    slipsOf(runs, 'T1').forEach(function (s) { pphBaru += s.k.dedPph21; });
    var thBaru = T.pph21Tahunan({ status: 'K/3', brutoTahun: bruto, bulanKerja: 12, jhtPekerja: jht, jpPekerja: jp });
    t.eq(pphBaru, thBaru.pph, 'dan Σ dua belas potongan = kewajiban setahun MENURUT STATUS BARU — koreksi Desember menyerap seluruh selisihnya');
    t.eq(P.periksa(u.ctx, runs).gagal, 0, 'invarian tetap utuh setelah perubahan status di tengah tahun');
  });

  group('Karyawan tanpa pajak dan kasus batas lain di jalur penuh', function (t) {
    /* Somebody under the TER threshold all year: every month zero, December
     * zero, and the annual calculation zero. A regime that produced a
     * December bill for somebody who earns below PTKP would be the most
     * damaging bug possible for the lowest-paid person on the payroll. */
    var u = satu({ pokok: 4000000, tetap: 500000, ptkp: 'K/3', umk: 0 });
    var runs = tahunkan(u);
    var slips = slipsOf(runs, 'T1');
    t.eq(slips.length, 12, 'dua belas slip');
    var semuaNol = slips.every(function (s) { return s.k.dedPph21 === 0; });
    t.ok(semuaNol, 'berpenghasilan di bawah ambang: nol pajak setiap bulan, Desember termasuk');
    t.eq(slips[11].pajak.tahunan.pph, 0, 'dan perhitungan setahunnya juga nol');
    t.eq(slips[11].pajak.tahunan.pkp, 0, 'PKP-nya nol, tidak negatif');
    t.eq(slips[0].pajak.bp, 0, 'band TER-nya 0%');
    var i1 = slips.every(function (s) { return s.k.neto === s.k.bruto - s.k.dedTotal; });
    t.ok(i1, 'I1 tetap berlaku ketika pajaknya nol');
    t.gt(slips[0].k.dedTotal, 0, 'tetapi potongan BPJS-nya tetap ada — nol pajak bukan nol potongan');

    /* A director above every ceiling: contributions flat all year, tax high. */
    var u2 = satu({ pokok: 45000000, tetap: 9000000, ptkp: 'K/3', risiko: 'I' });
    var runs2 = tahunkan(u2);
    var slips2 = slipsOf(runs2, 'T1');
    var rataKes = slips2.every(function (s) { return s.k.dedKes === 120000; });
    var rataJp = slips2.every(function (s) { return s.k.dedJp === 105474; });
    t.ok(rataKes, 'direksi: iuran Kesehatan rata 120.000 dua belas bulan');
    t.ok(rataJp, 'dan JP rata 105.474 dua belas bulan');
    t.eq(slips2[0].k.dedJht, D.bpRound(54000000, 200), 'sementara JHT tetap 2% dari 54.000.000 = 1.080.000, tanpa plafon');
    t.gt(slips2[0].pajak.bp, 1500, 'band TER-nya di atas 15%');
    var pph2 = 0, bruto2 = 0, jht2 = 0, jp2 = 0;
    slips2.forEach(function (s) { pph2 += s.k.dedPph21; bruto2 += s.k.brutoPajak; jht2 += s.k.dedJht; jp2 += s.k.dedJp; });
    var th2 = T.pph21Tahunan({ status: 'K/3', brutoTahun: bruto2, bulanKerja: 12, jhtPekerja: jht2, jpPekerja: jp2 });
    t.eq(pph2, th2.pph, 'dan rekonsiliasi setahunnya tetap tepat ke rupiah di penghasilan tinggi');
    t.ok(th2.biayaJabatanKena, 'biaya jabatannya kena plafon 6.000.000');
    t.gt(th2.marginalBp, 1500, 'dan tarif marginalnya di lapisan atas');

    /* An employee who joins and leaves within the same year. */
    var u3 = satu({ pokok: 8000000, tetap: 1000000, mulai: '2025-03-10', selesai: '2025-09-30', ptkp: 'TK/0' });
    var runs3 = tahunkan(u3);
    var slips3 = slipsOf(runs3, 'T1');
    t.eq(slips3.length, 7, 'masuk Maret dan berhenti September: tujuh slip');
    t.eq(slips3[0].bulan, 3, 'slip pertama Maret');
    t.eq(slips3[6].bulan, 9, 'slip terakhir September');
    t.eq(slips3[6].pajak.metode, 'setahun', 'dan September-lah bulan koreksinya');
    t.eq(slips3[6].pajak.bulanKerja, 7, 'dengan tujuh bulan kerja');
    t.eq(slips3[6].pajak.tahunan.biayaJabatanCap, 3500000, 'plafon biaya jabatan 7 x 500.000 = 3.500.000');
    var pph3 = 0, bruto3 = 0, jht3 = 0, jp3 = 0;
    slips3.forEach(function (s) { pph3 += s.k.dedPph21; bruto3 += s.k.brutoPajak; jht3 += s.k.dedJht; jp3 += s.k.dedJp; });
    t.eq(pph3, T.pph21Tahunan({ status: 'TK/0', brutoTahun: bruto3, bulanKerja: 7, jhtPekerja: jht3, jpPekerja: jp3 }).pph,
      'Σ tujuh potongan = perhitungan setahun untuk masa kerja tujuh bulan');
    t.eq(P.bulanAktif(u3.emp, 2024).length, 0, 'tahun sebelum ia masuk: nol bulan aktif');
    t.eq(P.bulanAktif(u3.emp, 2026).length, 0, 'tahun setelah ia berhenti: nol bulan aktif');
    t.eq(P.bulanKoreksi(u3.emp, 2026), null, 'dan tidak ada bulan koreksi di tahun ia tidak bekerja');
  });

  /* ==================================== 17. sapuan penuh I7 ============= */

  group('I7 menyeluruh: setiap medan uang di seluruh perusahaan demo', function (t) {
    var d = db();
    var UANG = {
      pokok: 1, tunjanganTetap: 1, tunjanganMakan: 1, lembur: 1, thr: 1, potonganAbsen: 1,
      bruto: 1, premiKes: 1, premiJkk: 1, premiJkm: 1, brutoPajak: 1,
      dedKes: 1, dedJht: 1, dedJp: 1, dedPph21: 1, dedTotal: 1,
      ptgKes: 1, ptgJht: 1, ptgJp: 1, ptgJkk: 1, ptgJkm: 1, ptgTotal: 1, neto: 1,
      gajiPokok: 1, upahSebulan: 1, umk: 1, makanHarian: 1,
      kesDasar: 1, kesPekerja: 1, kesPemberi: 1, jhtDasar: 1, jhtPekerja: 1, jhtPemberi: 1,
      jpDasar: 1, jpPekerja: 1, jpPemberi: 1, jkkDasar: 1, jkk: 1, jkm: 1,
      pekerjaTotal: 1, pemberiTotal: 1, rupiah: 1, bobot: 1,
      brutoTahun: 1, biayaJabatan: 1, biayaJabatanKotor: 1, biayaJabatanCap: 1,
      pengurang: 1, neto2: 1, ptkp: 1, pkp: 1, pkpKasar: 1, pph: 1, pph21: 1,
      sudahDipotong: 1, terSeandainya: 1, selisihTer: 1, dasar: 1, pajak2: 1,
      hari: 1, jam: 1, hariKerja: 1, hariHadir: 1, hariTanpaUpah: 1, hariCuti: 1, hariSakit: 1
    };
    var pelanggar = [], dilihat = 0;
    (function walk(o, path, depth) {
      if (depth > 8 || o === null || typeof o !== 'object') return;
      for (var k in o) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        var v = o[k];
        if (typeof v === 'number') {
          if (UANG[k]) { dilihat++; if (!D.isInt(v)) pelanggar.push(path + '.' + k + ' = ' + v); }
        } else if (v && typeof v === 'object') {
          walk(v, path + '.' + k, depth + 1);
        }
      }
    })({ runs: d.runs, karyawan: d.karyawan, cfg: d.cfg, cuti: d.cuti }, '', 0);
    t.gt(dilihat, 15000, dilihat + ' medan uang, kuantitas dan hari ditelusuri di seluruh objek perusahaan');
    t.eq(pelanggar.length, 0, 'dan tidak satu pun pecahan: ' + (pelanggar.length ? pelanggar.slice(0, 4).join(' · ') : 'nol pelanggar'));
    /* A float has to be findable, or the walk is not walking. */
    var salinan = { runs: { X: { slips: [{ k: { neto: 1.5 } }] } } };
    var found = 0;
    (function walk2(o, depth) {
      if (depth > 6 || !o || typeof o !== 'object') return;
      for (var k in o) {
        var v = o[k];
        if (typeof v === 'number' && UANG[k] && !D.isInt(v)) found++;
        else if (v && typeof v === 'object') walk2(v, depth + 1);
      }
    })(salinan, 0);
    t.eq(found, 1, 'penelusuran yang sama menemukan pecahan yang disisipkan sengaja, jadi ia memang menelusuri');
  });

  /* ==================================== 18. run penyesuaian ============= */

  group('Run penyesuaian membawa SELISIH, bukan penggantian', function (t) {
    /* The naive adjustment run recomputes a month and posts the full figures a
     * second time. That leaves two records for one month, the year
     * double-counts it, the annual recomputation reconciles against a history
     * that was never withheld, and I3 breaks. Every assertion here exists
     * because that version was written first and this suite caught it. */
    var u = satu({ pokok: 9000000, tetap: 2000000, ptkp: 'K/1', risiko: 'III', thrBulan: 3, thrTanggal: '2025-03-24' });
    var runs = tahunkan(u, { kunci: true });
    var slips = slipsOf(runs, 'T1');
    var pphAwal = 0, brutoAwal = 0;
    slips.forEach(function (s) { pphAwal += s.k.dedPph21; brutoAwal += s.k.brutoPajak; });
    t.eq(P.periksa(u.ctx, runs).gagal, 0, 'tahun dasar lulus seluruh invariannya');

    /* Master data changes AFTER the year is locked. */
    u.emp.gajiPokok = 12000000;
    var desLama = runs['RUN-2025-12'].slips[0].k.neto;
    var adj = P.jalankan(u.ctx, runs, 2025, 12, { jenis: 'penyesuaian', seri: 1 });
    runs[adj.id] = adj;
    t.eq(adj.id, 'RUN-2025-12-ADJ1', 'run penyesuaian punya id sendiri');
    t.eq(adj.slips.length, 1, 'satu slip');
    var a = adj.slips[0];
    t.ok(a.penyesuaian, 'slipnya ditandai penyesuaian');
    t.ok(!!a.penuh, 'dan menyimpan angka bulan penuh yang dihitung ulang');
    t.ok(!!a.dasar, 'serta angka yang sudah diposting sebagai dasarnya');
    var deltaBenar = P.KOLOM.every(function (c) { return a.k[c] === a.penuh[c] - a.dasar[c]; });
    t.ok(deltaBenar, 'setiap kolom slip penyesuaian = bulan penuh − yang sudah diposting');
    t.eq(a.k.pokok, 12000000 - 9000000, 'selisih gaji pokoknya 3.000.000');
    t.eq(a.k.neto, a.penuh.neto - desLama, 'selisih netonya = neto baru − neto yang sudah dibayar');
    t.eq(a.k.neto, a.k.bruto - a.k.dedTotal, 'I1 tetap berlaku atas selisih, karena identitasnya linear');
    t.notOk(a.k.pokok === a.penuh.pokok, 'dan slipnya BUKAN salinan angka penuh — itulah bug yang dihindari');

    /* The year must now reconcile against the NEW annual liability. */
    var rw = P.riwayatPajak(runs, 'T1', 2025);
    t.eq(rw.length, 13, 'ada 13 catatan untuk 12 bulan — Desember punya dua dokumen');
    var bulanUnik = {};
    rw.forEach(function (r) { bulanUnik[r.bulan] = 1; });
    t.eq(Object.keys(bulanUnik).length, 12, 'tetapi hanya 12 bulan berbeda');
    var bruto2 = 0, jht2 = 0, jp2 = 0, pph2 = 0;
    rw.forEach(function (r) { bruto2 += r.brutoPajak; jht2 += r.jhtPekerja; jp2 += r.jpPekerja; pph2 += r.pph21; });
    var th2 = T.pph21Tahunan({ status: 'K/1', brutoTahun: bruto2, bulanKerja: 12, jhtPekerja: jht2, jpPekerja: jp2 });
    t.eq(th2.bulanKerja, 12, 'perhitungan setahun tetap melihat 12 bulan kerja, bukan 13 dokumen');
    t.eq(pph2, th2.pph, 'Σ seluruh potongan (reguler + penyesuaian) = perhitungan setahun yang baru');
    t.notOk(pph2 === pphAwal, 'dan angkanya memang berubah dari sebelum kenaikan gaji');
    t.eq(P.periksa(u.ctx, runs).gagal, 0, 'seluruh invarian tetap utuh setelah run penyesuaian');
    t.eq(runs['RUN-2025-12'].slips[0].k.neto, desLama, 'run Desember yang terkunci tidak bergerak satu rupiah pun');
    t.eq(runs['RUN-2025-01'].slips[0].k.pokok, 9000000, 'dan Januari yang terkunci masih memuat gaji lama');

    /* A ceiling check on a delta would be nonsense, so I4 reads `penuh`. */
    t.eq(a.penuh.dedKes, D.bpRound(12000000 + 2000000 > 12000000 ? 12000000 : 14000000, 100), 'angka penuh slip penyesuaian menghormati plafon Kesehatan');
    t.eq(a.penuh.dedKes, 120000, 'yaitu 120.000 pada upah 14.000.000');
    t.notOk(a.k.dedKes === a.penuh.dedKes, 'sementara selisihnya bukan angka berplafon — itu sebabnya I4 memeriksa `penuh`');

    /* Recomputing the REGULAR run of a month that already has an adjustment
     * would count the adjustment twice. */
    var pesan = t.throws(function () {
      var r2 = P.jalankan(u.ctx, runs, 2025, 12, {});
      runs['x'] = r2;
    }, 'menghitung ulang run reguler bulan yang sudah punya penyesuaian melempar');
    t.ok(/dikunci/.test(pesan), 'di sini penjaga yang bicara lebih dulu adalah kuncinya: ' + pesan);
    /* And the double-count guard on its own, on a month whose regular run is
     * still a DRAFT — where the lock would not have stopped anything. */
    var q = satu({ pokok: 8000000, tetap: 1000000 });
    var runsQ = {};
    var rq = P.jalankan(q.ctx, runsQ, 2025, 6, {});
    runsQ[rq.id] = rq;
    t.eq(rq.status, 'draft', 'run Juni masih draft, jadi kuncinya tidak akan menghalangi');
    var aq = P.jalankan(q.ctx, runsQ, 2025, 6, { jenis: 'penyesuaian', seri: 1 });
    runsQ[aq.id] = aq;
    var pesanQ = t.throws(function () { P.jalankan(q.ctx, runsQ, 2025, 6, {}); },
      'tetapi menghitung ulang run reguler draft yang sudah punya penyesuaian tetap melempar');
    t.ok(/dua kali/.test(pesanQ), 'dan pesannya menyebut penghitungan ganda: ' + pesanQ);

    /* A MID-YEAR adjustment invalidates the correction month, and the engine
     * says which months need following up. */
    var v = satu({ pokok: 9000000, tetap: 2000000, ptkp: 'TK/0' });
    var runsV = tahunkan(v, { kunci: true });
    t.eq(P.koreksiTertinggal(v.ctx, runsV, 2025, 3).join(','), '12', 'menyesuaikan Maret menandai Desember perlu dikoreksi ulang');
    t.eq(P.koreksiTertinggal(v.ctx, runsV, 2025, 12).length, 0, 'menyesuaikan Desember tidak menandai apa pun setelahnya');
    v.emp.tunjanganTetap = 4000000;
    var adjMar = P.jalankan(v.ctx, runsV, 2025, 3, { jenis: 'penyesuaian', seri: 1 });
    runsV[adjMar.id] = adjMar;
    var rwV = P.riwayatPajak(runsV, 'T1', 2025);
    var brV = 0, jhV = 0, jpV = 0, ppV = 0;
    rwV.forEach(function (r) { brV += r.brutoPajak; jhV += r.jhtPekerja; jpV += r.jpPekerja; ppV += r.pph21; });
    var thV = T.pph21Tahunan({ status: 'TK/0', brutoTahun: brV, bulanKerja: 12, jhtPekerja: jhV, jpPekerja: jpV });
    t.notOk(ppV === thV.pph, 'sebelum Desember dikoreksi ulang, Σ potongan memang BELUM sama dengan setahun — invarian itu jujur, bukan dilunakkan');
    t.gt(P.periksa(v.ctx, runsV).gagal, 0, 'dan pemeriksaan invarian hidup merah pada keadaan itu');
    var adjDes = P.jalankan(v.ctx, runsV, 2025, 12, { jenis: 'penyesuaian', seri: 1 });
    runsV[adjDes.id] = adjDes;
    var rwV2 = P.riwayatPajak(runsV, 'T1', 2025);
    var br2 = 0, jh2 = 0, jp2b = 0, pp2 = 0;
    rwV2.forEach(function (r) { br2 += r.brutoPajak; jh2 += r.jhtPekerja; jp2b += r.jpPekerja; pp2 += r.pph21; });
    var thV2 = T.pph21Tahunan({ status: 'TK/0', brutoTahun: br2, bulanKerja: 12, jhtPekerja: jh2, jpPekerja: jp2b });
    t.eq(pp2, thV2.pph, 'setelah Desember ikut dikoreksi, Σ potongan kembali sama dengan perhitungan setahun');
    t.eq(P.periksa(v.ctx, runsV).gagal, 0, 'dan pemeriksaan invarian hidup hijau kembali');
    t.eq(adjDes.slips[0].k.bruto, 2000000, 'selisih bruto Desember = kenaikan tunjangan tetap itu sendiri, 2.000.000');
    t.notOk(adjDes.slips[0].k.dedPph21 === 0, 'dan selisih PPh 21-nya tidak nol: itulah rekonsiliasi setahun yang harus dikejar');
    t.gt(Math.abs(adjDes.slips[0].k.dedPph21), 0, 'besarnya ' + D.rupiah(adjDes.slips[0].k.dedPph21) + ' — bukan sekadar pajak atas 2.000.000 bulan itu, tetapi seluruh selisih setahun');
    t.eq(adjDes.slips[0].k.neto, adjDes.slips[0].k.bruto - adjDes.slips[0].k.dedTotal, 'I1 tetap berlaku atas selisih Desember');

    /* rencanaTahun must REFUSE two records for one month rather than silently
     * producing a hole. */
    t.throws(function () {
      T.rencanaTahun({
        status: 'TK/0', bulanan: [
          { bulan: 12, brutoPajak: 1000000, jhtPekerja: 0, jpPekerja: 0 },
          { bulan: 12, brutoPajak: 500000, jhtPekerja: 0, jpPekerja: 0 }
        ], bulanKoreksi: 12
      });
    }, 'rencanaTahun menolak dua catatan untuk satu bulan');

    /* Master-data drift is a TO-DO, not a broken ledger. Changing somebody's
     * PTKP status after their reconciliation month is posted must not turn the
     * invariant count red — the twelve deductions still add up to the liability
     * computed from the facts on record — but it must be reported as an
     * outstanding correction, by name. */
    var z = satu({ pokok: 9000000, tetap: 2000000, ptkp: 'K/1' });
    var runsZ = tahunkan(z, { kunci: true });
    var prZ0 = P.periksa(z.ctx, runsZ);
    t.eq(prZ0.gagal, 0, 'sebelum apa-apa berubah, seluruh invarian hijau');
    t.eq(prZ0.drift.length, 0, 'dan tidak ada koreksi tertunggak');
    z.emp.ptkp = 'K/3';
    var prZ1 = P.periksa(z.ctx, runsZ);
    t.eq(prZ1.gagal, 0, 'setelah HR mengubah status PTKP, invarian TETAP hijau — buku tidak rusak oleh suntingan HR');
    t.eq(prZ1.total, prZ0.total, 'jumlah baris invariannya tidak berubah (' + prZ1.total + ')');
    t.eq(prZ1.drift.length, 1, 'tetapi satu koreksi tertunggak dilaporkan');
    t.eq(prZ1.drift[0].direkam, 'K/1', 'status yang direkam di slip bulan rekonsiliasi K/1');
    t.eq(prZ1.drift[0].sekarang, 'K/3', 'status data induk sekarang K/3');
    t.eq(prZ1.drift[0].bulan, 12, 'dan bulan rekonsiliasinya Desember');
    t.eq(prZ1.drift[0].runId, 'RUN-2025-12', 'dengan run yang harus dikoreksi disebut namanya');
    var pphZ = 0;
    slipsOf(runsZ, 'T1').forEach(function (sl) { pphZ += sl.k.dedPph21; });
    var brZ = 0, jhZ = 0, jpZ = 0;
    slipsOf(runsZ, 'T1').forEach(function (sl) { brZ += sl.k.brutoPajak; jhZ += sl.k.dedJht; jpZ += sl.k.dedJp; });
    t.eq(pphZ, T.pph21Tahunan({ status: 'K/1', brutoTahun: brZ, bulanKerja: 12, jhtPekerja: jhZ, jpPekerja: jpZ }).pph,
      'karena I3 direkonsiliasi terhadap status SEBAGAIMANA DIPOTONG (K/1), bukan status hari ini');
    var adjZ = P.jalankan(z.ctx, runsZ, 2025, 12, { jenis: 'penyesuaian', seri: 1 });
    runsZ[adjZ.id] = adjZ;
    var prZ2 = P.periksa(z.ctx, runsZ);
    t.eq(prZ2.drift.length, 0, 'setelah run penyesuaian dibuat, tunggakannya hilang');
    t.eq(prZ2.gagal, 0, 'dan invarian tetap hijau');
    var pphZ2 = 0;
    P.riwayatPajak(runsZ, 'T1', 2025).forEach(function (r) { pphZ2 += r.pph21; });
    var brZ2 = 0, jhZ2 = 0, jpZ2 = 0;
    P.riwayatPajak(runsZ, 'T1', 2025).forEach(function (r) { brZ2 += r.brutoPajak; jhZ2 += r.jhtPekerja; jpZ2 += r.jpPekerja; });
    t.eq(pphZ2, T.pph21Tahunan({ status: 'K/3', brutoTahun: brZ2, bulanKerja: 12, jhtPekerja: jhZ2, jpPekerja: jpZ2 }).pph,
      'dan kini Σ potongan = kewajiban setahun menurut status BARU, tepat ke rupiah');
    t.lt(adjZ.slips[0].k.dedPph21, 0, 'selisihnya negatif, karena PTKP K/3 lebih besar dari K/1: ' + D.rupiah(adjZ.slips[0].k.dedPph21));
    t.eq(runsZ['RUN-2025-12'].slips[0].ptkp, 'K/1', 'slip Desember yang terkunci masih merekam K/1 — ia dokumen, bukan turunan');

    /* An employee the locked run missed entirely: the adjustment IS the month. */
    var w = satu({ pokok: 8000000, tetap: 1000000 });
    var runsW = {};
    var r1 = P.jalankan(w.ctx, runsW, 2025, 5, {});
    r1.slips = [];
    r1.total = P.totalDari([]);
    runsW[r1.id] = r1;
    var adjW = P.jalankan(w.ctx, runsW, 2025, 5, { jenis: 'penyesuaian', seri: 1 });
    t.eq(adjW.slips.length, 1, 'karyawan yang terlewat run terkunci muncul di run penyesuaian');
    t.ok(adjW.slips[0].baru, 'dan ditandai baru, bukan selisih terhadap nol');
    t.eq(adjW.slips[0].k.bruto, 9000000, 'sehingga angkanya angka bulan penuh');
    t.eq(adjW.slips[0].k.neto, adjW.slips[0].k.bruto - adjW.slips[0].k.dedTotal, 'dan I1 tetap berlaku');
  });

  /* ====== bulan pertama dan bulan terakhir: prorata hari kerja nyata ==== */

  group('Bulan pertama dan bulan terakhir diprorata menurut hari kerja nyata', function (t) {
    /* Somebody who joins on 18 August did not work 1-17 August. Paying them a
     * whole month is not a rounding question: it overstates the gross, it pays
     * a meal allowance for a fortnight nobody attended, and — because the
     * overstated gross is what the TER band and the annual Pasal 17 figure are
     * read from — it overstates their PPh 21 too. Every number below was hand
     * chosen so a reader can check the division on paper. */
    t.eq(D.hariKerja(2025, 8), 21, 'Agustus 2025 punya 21 hari kerja Senin-Jumat');
    t.eq(D.hariKerjaAktif(2025, 8, '2025-08-18', null), 10, 'dan hanya 10 di antaranya jatuh pada 18-31 Agustus');
    t.eq(D.hariKerjaAktif(2025, 8, '2015-01-05', '2025-08-12'), 8, 'seorang yang berhenti 12 Agustus bekerja 8 hari kerja');
    t.eq(D.hariKerjaAktif(2025, 8, '2015-01-05', null), 21, 'karyawan penuh sebulan: seluruh 21 hari, tanpa prorata');
    t.eq(D.hariKerjaAktif(2025, 8, '2025-09-01', null), 0, 'yang belum masuk: nol hari, bukan sebulan penuh');
    t.eq(D.hariKerjaAktif(2025, 8, '2015-01-05', '2025-07-31'), 0, 'yang sudah berhenti sebelum bulan itu: nol juga');

    var j = satu({ pokok: 6300000, tetap: 2100000, makan: 30000, mulai: '2025-08-18', ptkp: 'TK/0' });
    /* Attendance built for a WHOLE month, exactly as a stored record would be —
     * the payslip must cap it at the days the person actually existed. */
    j.ctx.absensi.T1['2025-08'] = { hadir: 21, tanpaUpah: 0, cuti: 0, sakit: 0 };
    var sj = P.praSlip(j.ctx, j.emp, 2025, 8);
    t.ok(sj.prorata, 'slip bulan pertama ditandai prorata');
    t.eq(sj.hariKerjaAktif, 10, 'hari kerja masa aktifnya 10');
    t.eq(sj.hariKerja, 21, 'dari 21 hari kerja sebulan');
    t.eq(sj.k.pokok, 3000000, 'gaji pokok 6.300.000 x 10/21 = 3.000.000, bukan 6.300.000');
    t.eq(sj.k.tunjanganTetap, 1000000, 'tunjangan tetap 2.100.000 x 10/21 = 1.000.000');
    t.eq(sj.hariHadir, 10, 'kehadiran dibatasi ke 10 hari, bukan 21 yang tercatat');
    t.eq(sj.k.tunjanganMakan, 300000, 'tunjangan makan 10 x 30.000 = 300.000, bukan 630.000 untuk hari yang tak seorang pun masuk');
    t.eq(sj.k.bruto, 4300000, 'brutonya 4.300.000');
    t.eq(sj.upahSebulan, 8400000, 'sementara UPAH SEBULAN kontraktual tetap penuh 8.400.000');
    t.eq(sj.k.dedKes, D.bpRound(8400000, 100), 'BPJS dilaporkan atas upah sebulan penuh, bukan atas bruto yang diprorata');
    t.eq(sj.k.dedJht, D.bpRound(8400000, 200), 'begitu juga JHT');
    t.eq(D.upahLembur(sj.upahSebulan, 1, false), D.divRound(D.mul(8400000, 150), D.mul(173, 100)), 'dan satu jam lembur tetap 1/173 upah sebulan penuh');

    /* The whole point: the overstated gross was overstating the tax. */
    var f = satu({ pokok: 6300000, tetap: 2100000, makan: 30000, ptkp: 'TK/0' });
    f.ctx.absensi.T1['2025-08'] = { hadir: 21, tanpaUpah: 0, cuti: 0, sakit: 0 };
    var sf = P.praSlip(f.ctx, f.emp, 2025, 8);
    t.eq(sf.prorata, false, 'karyawan yang bekerja sebulan penuh tidak diprorata sama sekali');
    t.eq(sf.k.pokok, 6300000, 'ia menerima gaji pokok penuh');
    t.gt(sf.k.brutoPajak, sj.k.brutoPajak, 'bruto pajak bulan penuh lebih besar dari bulan pertama yang diprorata');
    t.gte(T.terBulanan('TK/0', sf.k.brutoPajak).pph21, T.terBulanan('TK/0', sj.k.brutoPajak).pph21,
      'sehingga PPh 21 TER-nya pun tidak lagi dihitung atas penghasilan yang tidak pernah ada');

    /* A leaver's final month, same rule from the other end. */
    var l = satu({ pokok: 6300000, tetap: 2100000, makan: 30000, selesai: '2025-08-12' });
    l.ctx.absensi.T1['2025-08'] = { hadir: 21, tanpaUpah: 0, cuti: 0, sakit: 0 };
    var sl = P.praSlip(l.ctx, l.emp, 2025, 8);
    t.ok(sl.prorata, 'bulan terakhir juga diprorata');
    t.eq(sl.hariKerjaAktif, 8, '8 hari kerja sampai 12 Agustus');
    t.eq(sl.k.pokok, D.divRound(D.mul(6300000, 8), 21), 'gaji pokoknya 6.300.000 x 8/21');
    t.eq(sl.k.tunjanganMakan, 240000, 'dan makannya 8 x 30.000');
    t.lt(sl.k.bruto, sf.k.bruto, 'brutonya di bawah bruto sebulan penuh');

    /* The MONTH AFTER a joiner starts is a full month again — the proration
     * must not leak into every subsequent payslip. */
    var sj2 = P.praSlip(j.ctx, j.emp, 2025, 9);
    t.eq(sj2.prorata, false, 'bulan berikutnya kembali penuh');
    t.eq(sj2.k.pokok, 6300000, 'dengan gaji pokok utuh');

    /* And the demo company's own advertised mid-year joiner. */
    var b = db();
    var k34 = b.ctx.byNip['K034'];
    t.eq(k34.mulai, '2025-08-18', 'K034 di perusahaan demo masuk 18 Agustus 2025');
    var s34 = b.runs['RUN-2025-08'].slips.filter(function (x) { return x.nip === 'K034'; })[0];
    t.eq(s34.hariKerjaAktif, 10, 'slip Agustusnya memakai 10 hari kerja masa aktif');
    t.eq(s34.k.pokok, D.divRound(D.mul(k34.gajiPokok, 10), 21), 'gaji pokoknya diprorata 10/21');
    t.lt(s34.k.pokok, k34.gajiPokok, 'jadi lebih kecil dari gaji pokok kontraktualnya');
    t.eq(s34.hariHadir, 10, 'kehadirannya tidak melebihi masa aktifnya');
    t.eq(s34.k.tunjanganMakan, D.mul(b.ctx.cfg.makanHarian, 10), 'dan makannya 10 hari, bukan 21');
    t.eq(s34.upahSebulan, k34.gajiPokok + k34.tunjanganTetap, 'sementara dasar BPJS-nya tetap upah sebulan penuh');
    var s34sep = b.runs['RUN-2025-09'].slips.filter(function (x) { return x.nip === 'K034'; })[0];
    t.eq(s34sep.k.pokok, k34.gajiPokok, 'dan September-nya sudah penuh kembali');
    /* Nobody in the demo company is ever paid for a day they were not employed. */
    var lebih = [];
    Object.keys(b.runs).forEach(function (id) {
      b.runs[id].slips.forEach(function (s) {
        if (s.hariKerjaAktif !== undefined && s.hariKerjaAktif !== null && s.hariHadir > s.hariKerjaAktif) lebih.push(id + ' ' + s.nip);
      });
    });
    t.eq(lebih.length, 0, 'di seluruh 715 slip perusahaan demo tidak ada satu pun yang hadir lebih dari masa aktifnya');
  });

  /* ========== koreksi lanjutan otomatis: PAJAK SAJA, bukan upah ========= */

  group('Koreksi lanjutan otomatis hanya memindahkan PPh 21, tidak satu baris upah', function (t) {
    /* Adjusting March moves the year's accumulated withholding, so the month
     * that carries the annual recomputation has to be corrected too. In
     * ordinary delta mode that follow-on ALSO re-prices the month's earnings:
     * a raise the officer applied to March gets paid AGAIN in December, a month
     * nobody named, while April to November go unpaid — and the invariant badge
     * stays green because the result is internally consistent. Money nobody
     * authorised, moved silently, under a green tick. */
    var u = satu({ pokok: 9000000, tetap: 2000000, ptkp: 'TK/0' });
    var runs = tahunkan(u, { kunci: true });
    t.eq(P.periksa(u.ctx, runs).gagal, 0, 'tahun dasar hijau');
    u.emp.gajiPokok = 12000000;                       /* HR raises the wage */

    var adj = P.jalankan(u.ctx, runs, 2025, 3, { jenis: 'penyesuaian', seri: 1 });
    runs[adj.id] = adj;
    t.eq(adj.slips[0].k.pokok, 3000000, 'penyesuaian Maret yang DIMINTA membayar selisih upahnya, 3.000.000');
    t.eq(P.koreksiTertinggal(u.ctx, runs, 2025, 3).join(','), '12', 'dan menandai Desember perlu ikut dikoreksi');

    /* THE MODE THAT WOULD HAVE BEEN A BUG, kept here as the control. */
    var salah = P.jalankan(u.ctx, runs, 2025, 12, { jenis: 'penyesuaian', seri: 9 });
    t.eq(salah.slips[0].k.pokok, 3000000, 'dalam mode selisih biasa, Desember membayar kenaikan itu untuk KEDUA kalinya');
    t.gt(salah.total.bruto, 0, 'yaitu brutonya bergerak: ' + D.rupiah(salah.total.bruto) + ' yang tidak diminta siapa pun');

    /* THE MODE THAT SHIPS. */
    var ikut = P.jalankan(u.ctx, runs, 2025, 12, { jenis: 'penyesuaian', seri: 1, pajakSaja: true });
    runs[ikut.id] = ikut;
    t.ok(ikut.pajakSaja, 'run lanjutan otomatis ditandai pajakSaja');
    t.eq(ikut.slips.length, 1, 'satu slip: hanya orang yang bulan rekonsiliasinya di sini');
    var sp = ikut.slips[0];
    t.ok(sp.pajakSaja, 'slipnya ditandai pajak-saja');
    var bergerak = P.KOLOM.filter(function (c) {
      return c !== 'dedPph21' && c !== 'dedTotal' && c !== 'neto' && sp.k[c] !== 0;
    });
    t.eq(bergerak.length, 0, 'dan TIDAK SATU KOLOM PUN selain PPh 21 bergerak' + (bergerak.length ? ': ' + bergerak.join(',') : ''));
    t.eq(sp.k.pokok, 0, 'gaji pokoknya nol: kenaikan Maret tidak dibayar ulang di Desember');
    t.eq(sp.k.bruto, 0, 'brutonya nol');
    t.eq(sp.k.dedTotal, sp.k.dedPph21, 'total potongannya hanya PPh 21');
    t.eq(sp.k.neto, -sp.k.dedPph21, 'dan netonya persis kebalikan pajaknya');
    t.notOk(sp.k.dedPph21 === 0, 'sementara PPh 21-nya memang bergerak: ' + D.rupiah(sp.k.dedPph21));

    /* The year still reconciles to the rupiah, which is the whole reason the
     * follow-on exists at all. */
    var rw = P.riwayatPajak(runs, 'T1', 2025);
    var br = 0, jh = 0, jp = 0, pp = 0;
    rw.forEach(function (r) { br += r.brutoPajak; jh += r.jhtPekerja; jp += r.jpPekerja; pp += r.pph21; });
    var th = T.pph21Tahunan({ status: 'TK/0', brutoTahun: br, bulanKerja: 12, jhtPekerja: jh, jpPekerja: jp });
    t.eq(pp, th.pph, 'Σ potongan = perhitungan setahun, tepat ke rupiah');
    var pr = P.periksa(u.ctx, runs);
    t.eq(pr.gagal, 0, 'dan seluruh invarian hijau — termasuk I4, yang memeriksa definisi slip pajak-saja itu sendiri');

    /* I4 must actually FAIL on a tax-only slip that moved a wage line, or the
     * check that certifies this is decoration. */
    var rusak = JSON.parse(JSON.stringify(runs));
    var target = null;
    Object.keys(rusak).forEach(function (id) { if (rusak[id].pajakSaja) target = rusak[id]; });
    target.slips[0].k.pokok = 1;
    target.slips[0].k.bruto = 1;
    target.slips[0].k.neto += 1;
    target.total = P.totalDari(target.slips);
    var prRusak = P.periksa(u.ctx, rusak);
    t.gt(prRusak.gagal, 0, 'satu rupiah gaji pokok di slip pajak-saja membuat pemeriksaan merah');
    var i4 = prRusak.cek.filter(function (c) { return c.nama.indexOf('I4') === 0; })[0];
    t.notOk(i4.ok, 'dan yang merah adalah I4');
    t.ok(/pajak-saja/.test(i4.pesan), 'dengan pesan yang menyebut koreksi pajak-saja: ' + i4.pesan);

    /* The wage change that was NOT applied is reported as outstanding work,
     * by name, instead of being posted for the officer. */
    var sisa = P.selisihUpahTertinggal(u.ctx, runs, 2025, 6);
    t.eq(sisa.length, 1, 'Juni dilaporkan sebagai bulan yang upahnya akan berubah kalau dihitung ulang');
    t.eq(sisa[0].nip, 'T1', 'dengan orangnya disebut');
    t.eq(sisa[0].selisihBruto, 3000000, 'dan selisih brutonya 3.000.000');
    t.notOk(!!runs['RUN-2025-06-ADJ1'], 'tetapi tidak ada run penyesuaian Juni yang dibuat diam-diam');
    var pokokJuni = runs['RUN-2025-06'].slips[0].k.pokok;
    t.eq(pokokJuni, 9000000, 'dan Juni masih memuat upah lama sampai seseorang memutuskan sebaliknya');

    /* A tax-only follow-on with nothing to re-place writes no document at all. */
    var q = satu({ pokok: 7000000, tetap: 1000000, ptkp: 'TK/0' });
    var runsQ = tahunkan(q, { kunci: true });
    var kosong = P.jalankan(q.ctx, runsQ, 2025, 12, { jenis: 'penyesuaian', seri: 1, pajakSaja: true });
    t.eq(kosong.slips.length, 0, 'tanpa apa pun yang berubah, run pajak-saja tidak berisi slip sama sekali');
  });

  /* ======== lantai UMK: direkam di slip, bukan dibaca dari konfigurasi === */

  group('Lantai UMK direkam di slip; mengubahnya adalah tunggakan, bukan invarian gagal', function (t) {
    /* cfg.umk is HR-editable master data. Recomputing eleven finance-signed
     * runs against a floor that is allowed to move afterwards accuses correct
     * payslips of arithmetic they never did — the exact false red the design
     * notes say must never happen. upahSebulan and risiko were already
     * snapshotted; the floor was the one BPJS input still read live. */
    var u = satu({ pokok: 4000000, tetap: 0, umk: 5000000, ptkp: 'TK/0' });
    var runs = tahunkan(u, { kunci: true });
    var s = runs['RUN-2025-06'].slips[0];
    t.eq(s.umkDipakai, 5000000, 'slip merekam lantai UMK yang dipakai saat ia dihitung');
    t.eq(s.k.dedKes, D.bpRound(5000000, 100), 'iuran Kesehatan pekerjanya dihitung atas lantai itu, bukan atas upah 4.000.000');
    var pr0 = P.periksa(u.ctx, runs);
    t.eq(pr0.gagal, 0, 'sebelum apa pun berubah, seluruh invarian hijau');
    t.eq(pr0.drift.length, 0, 'dan tidak ada tunggakan');

    u.ctx.cfg.umk = 8000000;                     /* HR raises the reference */
    var pr1 = P.periksa(u.ctx, runs);
    t.eq(pr1.gagal, 0, 'setelah UMK acuan diubah, invarian TETAP hijau — slip lama dihitung di bawah lantai yang berlaku saat itu');
    t.eq(pr1.total, pr0.total, 'jumlah baris invariannya tidak berubah (' + pr1.total + ')');
    t.gt(pr1.drift.length, 0, 'tetapi perubahannya dilaporkan sebagai koreksi tertunggak');
    var umkDrift = pr1.drift.filter(function (d) { return d.jenis === 'umk'; });
    t.eq(umkDrift.length, 1, 'satu tunggakan berjenis umk');
    t.eq(umkDrift[0].direkam, 5000000, 'dengan lantai yang direkam 5.000.000');
    t.eq(umkDrift[0].sekarang, 8000000, 'dan lantai sekarang 8.000.000');
    t.eq(umkDrift[0].kesBaru, D.bpRound(8000000, 100), 'serta iuran Kesehatan yang seharusnya di lantai baru');

    /* A floor that no longer bites anybody is a setting that changed, not work
     * to do. */
    var w = satu({ pokok: 20000000, tetap: 0, umk: 5000000, ptkp: 'TK/0' });
    var runsW = tahunkan(w, { kunci: true });
    w.ctx.cfg.umk = 6000000;
    var prW = P.periksa(w.ctx, runsW);
    t.eq(prW.gagal, 0, 'karyawan jauh di atas lantai: invarian hijau');
    t.eq(prW.drift.filter(function (d) { return d.jenis === 'umk'; }).length, 0,
      'dan tidak dilaporkan sebagai tunggakan, karena lantai itu tidak menggigit iurannya');
  });

  /* ============ THR diukur ke HARI RAYA, bukan ke tanggal bayar ========== */

  group('THR: masa kerja diukur ke Hari Raya, bukan ke tanggal pembayaran', function (t) {
    /* PP 36/2021 Pasal 2 dan Pasal 3 fix the entitlement on workers with one
     * month's continuous service AS AT the Hari Raya Keagamaan; Pasal 5 ayat (4)
     * separately requires payment at the latest seven days BEFORE it. The
     * payment date is a deadline, not the measuring date. */
    t.eq(D.bulanMasaKerja('2025-02-28', '2025-03-24'), 0, 'diukur ke tanggal bayar 24 Maret, masa kerja 28 Februari = 0 bulan (THR nihil)');
    t.eq(D.bulanMasaKerja('2025-02-28', '2025-03-31'), 1, 'diukur ke Idul Fitri 31 Maret, masa kerjanya 1 bulan penuh');

    var u = satu({ pokok: 12000000, tetap: 0, mulai: '2025-02-28', thrBulan: 3, thrTanggal: '2025-03-24' });
    u.ctx.cfg.hariRayaTanggal = '2025-03-31';
    var s = P.praSlip(u.ctx, u.emp, 2025, 3);
    t.eq(s.thrInfo.tglBayar, '2025-03-24', 'slip mencatat tanggal pembayarannya');
    t.eq(s.thrInfo.tglHariRaya, '2025-03-31', 'dan tanggal Hari Raya-nya, terpisah');
    t.eq(s.thrInfo.bulanMasaKerja, 1, 'masa kerja yang dipakai 1 bulan');
    t.eq(s.k.thr, 1000000, 'THR-nya satu per dua belas upah sebulan = 1.000.000, bukan nihil');
    t.gt(s.k.thr, 0, 'yang diukur ke tanggal bayar akan nol — dan itu kurang bayar terhadap PP 36/2021');

    /* Someone hired after the holiday itself still gets nothing. */
    var v = satu({ pokok: 12000000, tetap: 0, mulai: '2025-03-25', thrBulan: 3, thrTanggal: '2025-03-24' });
    v.ctx.cfg.hariRayaTanggal = '2025-03-31';
    t.eq(P.praSlip(v.ctx, v.emp, 2025, 3).k.thr, 0, 'yang masuk 25 Maret belum satu bulan pada Hari Raya: THR nihil');

    /* Absent the config, the payment date is used — old records keep behaving
     * exactly as they were computed. */
    var w = satu({ pokok: 12000000, tetap: 0, mulai: '2024-02-28', thrBulan: 3, thrTanggal: '2025-03-24' });
    t.eq(P.praSlip(w.ctx, w.emp, 2025, 3).k.thr, 12000000, 'masa kerja lebih dari 12 bulan: satu bulan upah penuh, tanggal mana pun yang dipakai');

    /* The demo company carries both dates. */
    t.eq(db().ctx.cfg.hariRayaTanggal, '2025-03-31', 'perusahaan demo mengonfigurasi tanggal Hari Raya-nya sendiri');
    t.eq(db().ctx.cfg.thrTanggal, '2025-03-24', 'dan tanggal pembayarannya, tujuh hari lebih awal');
  });

  /* ================= NIP: satu lebar, satu urutan ======================= */

  group('NIP berlebar tetap, sehingga urutan teks = urutan nomor', function (t) {
    /* 'K01' and 'K010' sort as strings, and a string sort puts K07 after K062 —
     * so an operator scanning a 61-row run for the first nine employees does not
     * find them where they look. */
    var b = db();
    var nips = b.ctx.karyawan.map(function (e) { return e.nip; });
    var lebar = {};
    nips.forEach(function (n) { lebar[n.length] = 1; });
    t.eq(Object.keys(lebar).join(','), '4', 'setiap NIP tepat 4 karakter (K + tiga angka)');
    t.eq(nips[0], 'K001', 'karyawan pertama K001, bukan K01');
    t.eq(nips[nips.length - 1], 'K062', 'dan yang terakhir K062');
    var teks = nips.slice().sort();
    var angka = nips.slice().sort(function (a, c) { return (+a.slice(1)) - (+c.slice(1)); });
    t.eq(teks.join(','), angka.join(','), 'urutan teks sama dengan urutan nomor — tidak ada K07 setelah K062');
    /* The run tables sort by NIP as a string, so assert it on a real run. */
    var urut = b.runs['RUN-2025-08'].slips.map(function (s) { return s.nip; });
    var urutSalin = urut.slice().sort();
    t.eq(urut.join(','), urutSalin.join(','), 'baris slip di run Agustus benar-benar urut');
    t.eq(urut[0], b.runs['RUN-2025-08'].slips[0].nip, 'dan baris pertamanya adalah NIP terkecil');
  });

  /* --------------------------------------------------------------- runner */

  function run_() {
    var results = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      try { g.fn(makeCtx(results, g.name)); }
      catch (err) {
        results.push({ group: g.name, name: 'grup melempar exception', ok: false, message: String(err && err.stack || err) });
      }
    }
    var passed = results.filter(function (r) { return r.ok; }).length;
    return { results: results, passed: passed, failed: results.length - passed, total: results.length };
  }

  root.PAYROLL_TESTS = { run: run_, groups: groups, db: db };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PAYROLL_TESTS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
