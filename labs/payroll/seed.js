/*!
 * Payroll — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Payroll — seed.js
 * The demo company, rebuilt from ONE seed integer every time the page loads.
 *
 * ========================= ALL OF THIS IS FABRICATED =====================
 * There is no real person here and nothing here identifies one.
 *   NAMES ...... assembled syllable by syllable from invented phonotactic
 *                patterns. Any resemblance to a real name is coincidence
 *                produced by a 32-bit PRNG.
 *   NIK ........ sixteen digits beginning 99, which is not a province code
 *                Dukcapil has ever issued (real codes run 11 to 94), so no
 *                string here can address a real citizen record.
 *   NPWP ....... the fifteen-digit form with category prefix 99, never issued
 *                by DJP.
 *   BPJS ....... eleven digits beginning 999, outside the issued ranges.
 *   BANK ....... ten digits beginning 0000, which no Indonesian bank issues.
 *   SALARIES ... invented, then rounded to a plausible negotiated figure. The
 *                distribution is chosen so the reviewer can SEE the ceilings
 *                bite: some people below the BPJS Kesehatan wage floor, some
 *                between the JP ceiling and the Kesehatan ceiling where only
 *                JP caps, and some above both.
 * The only real numbers in this file are the statutory ones — rates, ceilings,
 * PTKP amounts, the minimum wage reference — and those are cited in domain.js.
 *
 * TAX YEAR 2025, twelve monthly runs, January to November locked by the
 * finance approver and December left as a draft so the true-up can be watched
 * being recomputed. Four mid-year joiners and one leaver, because the December
 * reconciliation is only interesting when somebody's year is not twelve months
 * long.
 */
(function (root) {
  'use strict';

  var D = root.PAYROLL_DOMAIN;
  var P = root.PAYROLL_ENGINE;
  var S = {};
  root.PAYROLL_SEED = S;

  S.SEED = 20250401;

  /* --------------------------------------------------------- fabricators */

  var AWAL = ['B', 'C', 'D', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'W', 'Y', 'Nd', 'Pr', 'Tr', 'Sy'];
  var VOKAL = ['a', 'a', 'a', 'e', 'i', 'i', 'o', 'u', 'u', 'ai'];
  var TENGAH = ['n', 'r', 'l', 'm', 'd', 's', 't', 'nd', 'ng', 'w', 'y', 'k', 'h'];
  var AKHIR = ['n', 'r', 'h', 'm', 's', 'ng', 't', ''];

  function suku(rng, awalBesar) {
    var k = rng.pick(AWAL);
    if (!awalBesar) k = k.toLowerCase();
    return k + rng.pick(VOKAL);
  }
  function kata(rng, sukuKata) {
    var s = suku(rng, true), i;
    for (i = 1; i < sukuKata; i++) s += rng.pick(TENGAH) + rng.pick(VOKAL);
    s += rng.pick(AKHIR);
    return s;
  }
  function nama(rng) {
    var n = kata(rng, rng.int(2, 3));
    if (rng.chance(0.72)) n += ' ' + kata(rng, rng.int(2, 3));
    if (rng.chance(0.18)) n += ' ' + kata(rng, 2);
    return n;
  }
  function digit(rng, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += String(rng.int(0, 9));
    return s;
  }
  /* 99 is not an issued province code. */
  function nik(rng, lahir) {
    var d = D.hariDari(lahir), m = D.bulanDari(lahir), y = D.tahunDari(lahir) % 100;
    function dua(x) { return (x < 10 ? '0' : '') + x; }
    return '99' + digit(rng, 4) + dua(d) + dua(m) + dua(y) + digit(rng, 4);
  }
  /* Category prefix 99 has never been issued by DJP. */
  function npwp(rng) {
    return '99.' + digit(rng, 3) + '.' + digit(rng, 3) + '.' + digit(rng, 1) + '-' + digit(rng, 3) + '.' + digit(rng, 3);
  }
  function bpjsNo(rng) { return '999' + digit(rng, 8); }
  function rekening(rng) { return '0000' + digit(rng, 6); }

  /* ------------------------------------------------------- organisation */

  /* JKK risk class follows the work, not the pay grade: a warehouse picker sits
   * in a higher class than a finance manager on four times the salary, and
   * that is the whole point of having classes. PP 44/2015. */
  var DIVISI = [
    { nama: 'Produksi', risiko: 'IV', n: 18, jabatan: ['Operator Mesin', 'Operator Senior', 'Leader Produksi', 'Supervisor Produksi', 'Manajer Produksi'] },
    { nama: 'Gudang', risiko: 'III', n: 8, jabatan: ['Staf Gudang', 'Checker', 'Leader Gudang', 'Supervisor Gudang', 'Manajer Logistik'] },
    { nama: 'Teknik', risiko: 'IV', n: 7, jabatan: ['Teknisi', 'Teknisi Senior', 'Leader Maintenance', 'Supervisor Teknik', 'Manajer Teknik'] },
    { nama: 'QC', risiko: 'II', n: 5, jabatan: ['Analis QC', 'Analis QC Senior', 'Leader QC', 'Supervisor QC', 'Manajer QA'] },
    { nama: 'Penjualan', risiko: 'II', n: 9, jabatan: ['Sales', 'Sales Senior', 'Area Sales', 'Supervisor Penjualan', 'Manajer Penjualan'] },
    { nama: 'Keuangan', risiko: 'I', n: 5, jabatan: ['Staf Akuntansi', 'Akuntan', 'Analis Keuangan', 'Supervisor Keuangan', 'Manajer Keuangan'] },
    { nama: 'SDM', risiko: 'I', n: 4, jabatan: ['Staf SDM', 'Staf Payroll', 'Generalis SDM', 'Supervisor SDM', 'Manajer SDM'] },
    { nama: 'TI', risiko: 'I', n: 4, jabatan: ['Staf TI', 'Programmer', 'Analis Sistem', 'Supervisor TI', 'Manajer TI'] }
  ];

  /* Salary bands per level, in whole rupiah. Deliberately straddling the two
   * BPJS ceilings: level 1-2 sit under both, level 3 crosses the JP ceiling of
   * Rp 10.547.400 while staying under the Kesehatan ceiling of Rp 12.000.000,
   * and levels 4-5 are above both. Level 0 sits at or under the minimum-wage
   * reference so the Kesehatan wage FLOOR bites too. */
  var LEVEL = [
    { key: 0, nama: 'Pelaksana', pokok: [4400000, 4750000], lembur: true, bobot: 22 },
    { key: 1, nama: 'Pelaksana senior', pokok: [5200000, 6900000], lembur: true, bobot: 30 },
    { key: 2, nama: 'Leader', pokok: [7200000, 8900000], lembur: true, bobot: 20 },
    { key: 3, nama: 'Supervisor', pokok: [9200000, 11800000], lembur: false, bobot: 16 },
    { key: 4, nama: 'Manajer', pokok: [18000000, 27000000], lembur: false, bobot: 9 },
    { key: 5, nama: 'Direksi', pokok: [42000000, 56000000], lembur: false, bobot: 3 }
  ];

  /* ----------------------------------------------------------- build --- */

  S.build = function (seed) {
    var rng = D.rng(seed === undefined ? S.SEED : seed);
    var tahun = 2025;

    var cfg = {
      tahun: tahun,
      perusahaan: 'PT Sinar Ladu Nusantara',
      npwpPerusahaan: '99.412.703.5-081.000',
      /* Reference minimum wage, used as the BPJS Kesehatan wage floor. The
       * default is the published 2025 DKI Jakarta figure; it is a setting, not
       * a law of nature, and the BPJS tab lets it be changed. */
      umk: 5396761,
      makanHarian: 30000,
      /* Idul Fitri 1446 H fell on 31 March 2025, so PP 36/2021's "at the latest
       * seven days before the holiday" puts THR in the March run. The two dates
       * do different jobs and are therefore two settings: ENTITLEMENT and
       * proration are measured to the HARI RAYA (Pasal 2 and 3), while
       * thrTanggal is the payment deadline (Pasal 5 ayat 4). Measuring service
       * to the payment date instead pays nil to somebody hired in the last week
       * before the holiday who is entitled to one twelfth. */
      thrBulan: 3,
      thrTanggal: '2025-03-24',
      hariRayaTanggal: '2025-03-31',
      seed: seed === undefined ? S.SEED : seed
    };

    /* -------------------------------------------------- employees ------ */

    var karyawan = [], no = 1;
    var statusPool = [
      'TK/0', 'TK/0', 'TK/0', 'TK/1', 'TK/2', 'TK/3',
      'K/0', 'K/0', 'K/1', 'K/1', 'K/1', 'K/2', 'K/2', 'K/3'
    ];

    DIVISI.forEach(function (div) {
      for (var i = 0; i < div.n; i++) {
        /* Level distribution: one manager per division, a couple of
         * supervisors, the rest below. Direksi is handled separately. */
        var lvl;
        if (i === 0) lvl = LEVEL[4];
        else if (i === 1 || (div.n > 7 && i === 2)) lvl = LEVEL[3];
        else if (i < 4) lvl = LEVEL[2];
        else if (i < div.n - 2) lvl = LEVEL[1];
        else lvl = LEVEL[0];

        var pokok = rng.bulat(rng.int(lvl.pokok[0], lvl.pokok[1]), 50000);
        /* Tunjangan tetap is a fixed allowance and therefore part of the
         * overtime base, the BPJS base and the THR base. Kept as a round
         * figure rather than a percentage, because that is how it appears on a
         * real contract. */
        var tetap = rng.bulat(D.bpRound(pokok, rng.int(1500, 2600)), 25000);

        var lahir = D.ymd(Date.UTC(rng.int(1974, 2004), rng.int(0, 11), rng.int(1, 28)));
        var mulai = D.ymd(Date.UTC(rng.int(2013, 2024), rng.int(0, 11), rng.int(1, 28)));

        karyawan.push({
          /* Three digits, ALWAYS. ('0'+1) is two characters, so slice(-3)
           * cannot pad it and the old form produced K01 next to K010 — which
           * put K07, K08 and K09 after K062 in every string-sorted payslip
           * table in the app. No money moved; an operator scanning a 62-row run
           * for the first nine people simply did not find them where they look. */
          nip: 'K' + ('00' + no).slice(-3),
          nama: nama(rng),
          lahir: lahir,
          nik: nik(rng, lahir),
          npwp: npwp(rng),
          bpjsKes: bpjsNo(rng), bpjsTk: bpjsNo(rng),
          rekening: rekening(rng),
          divisi: div.nama,
          risiko: div.risiko,
          level: lvl.key,
          levelNama: lvl.nama,
          jabatan: div.jabatan[Math.min(lvl.key, div.jabatan.length - 1)],
          ptkp: rng.pick(statusPool),
          gajiPokok: pokok,
          tunjanganTetap: tetap,
          mulai: mulai,
          selesai: null,
          bolehLembur: lvl.lembur
        });
        no++;
      }
    });

    /* Two directors, well above both ceilings, so the flat-contribution
     * behaviour is visible on the very first screen. */
    ['Direktur Operasional', 'Direktur Keuangan'].forEach(function (jab, idx) {
      var pokok = rng.bulat(rng.int(LEVEL[5].pokok[0], LEVEL[5].pokok[1]), 500000);
      var lahir = D.ymd(Date.UTC(rng.int(1968, 1979), rng.int(0, 11), rng.int(1, 28)));
      karyawan.push({
        nip: 'K' + ('00' + no).slice(-3), nama: nama(rng), lahir: lahir,
        nik: nik(rng, lahir), npwp: npwp(rng),
        bpjsKes: bpjsNo(rng), bpjsTk: bpjsNo(rng), rekening: rekening(rng),
        divisi: idx === 0 ? 'Produksi' : 'Keuangan', risiko: idx === 0 ? 'IV' : 'I',
        level: 5, levelNama: 'Direksi', jabatan: jab,
        ptkp: idx === 0 ? 'K/3' : 'K/2',
        gajiPokok: pokok, tunjanganTetap: rng.bulat(D.bpRound(pokok, 2000), 500000),
        mulai: D.ymd(Date.UTC(rng.int(2013, 2018), rng.int(0, 11), rng.int(1, 28))),
        selesai: null, bolehLembur: false
      });
      no++;
    });

    /* -------------------------------- joiners, a leaver, and the caps --- *
     * Hand-placed rather than left to the PRNG, because these are the cases
     * the December reconciliation is actually interesting for, and a demo
     * whose interesting cases depend on a lucky seed is not a demo. */
    karyawan[6].mulai = tahun + '-04-14';    /* joins in April  */
    karyawan[19].mulai = tahun + '-06-02';   /* joins in June   */
    karyawan[33].mulai = tahun + '-08-18';   /* joins in August */
    karyawan[47].mulai = tahun + '-11-03';   /* joins in November: TWO months, and
                                                the correction month is December */
    karyawan[12].selesai = tahun + '-08-29'; /* leaves in August: the annual
                                                recomputation happens in AUGUST,
                                                not December */
    /* Somebody exactly on the JP ceiling and somebody exactly on the Kesehatan
     * ceiling, so the boundary case is present in the data and not only in the
     * tests. */
    karyawan[3].gajiPokok = 9000000; karyawan[3].tunjanganTetap = 1547400;   /* upah = 10.547.400 exactly */
    karyawan[4].gajiPokok = 10000000; karyawan[4].tunjanganTetap = 2000000;  /* upah = 12.000.000 exactly */
    karyawan[5].gajiPokok = 10000000; karyawan[5].tunjanganTetap = 2000001;  /* one rupiah over */

    var byNip = {};
    karyawan.forEach(function (e) { byNip[e.nip] = e; });

    /* ------------------------------------------- attendance & overtime -- */

    var absensi = {}, lembur = {}, cuti = [];
    karyawan.forEach(function (emp) {
      absensi[emp.nip] = {};
      lembur[emp.nip] = {};
      var aktif = P.bulanAktif(emp, tahun);
      /* A tendency, per person, rather than a fresh coin flip each month: real
       * unpaid absence clusters on a few people, and a payroll report where it
       * is sprinkled evenly looks synthetic at a glance. */
      var cenderungAbsen = rng.chance(0.12);
      var rajinLembur = emp.bolehLembur && rng.chance(0.62);

      aktif.forEach(function (m) {
        var per = D.periode(tahun, m);
        var hk = D.hariKerja(tahun, m);
        /* Attendance is generated against the days this person was actually
         * employed, not against the whole calendar month. A joiner on 18 August
         * has ten working days available, not twenty-one, and seeding
         * twenty-one of them was what let the engine pay — and tax — a full
         * month's meal allowance for a fortnight before they existed. */
        var hkA = D.hariKerjaAktif(tahun, m, emp.mulai, emp.selesai);
        if (hkA > hk) hkA = hk;
        if (hkA < 0) hkA = 0;
        var tanpaUpah = 0;
        if (cenderungAbsen && rng.chance(0.34)) tanpaUpah = rng.int(1, 3);
        var sakit = rng.chance(0.16) ? rng.int(1, 2) : 0;
        if (tanpaUpah > hkA) tanpaUpah = hkA;
        if (sakit > hkA - tanpaUpah) sakit = hkA - tanpaUpah > 0 ? hkA - tanpaUpah : 0;
        var hariCuti = 0;
        /* Annual leave clusters around Idul Fitri (March/April) and the end of
         * the year, which is what makes a leave-balance report worth reading. */
        var peluangCuti = (m === 3 || m === 4) ? 0.4 : (m === 12 ? 0.3 : 0.09);
        if (rng.chance(peluangCuti)) hariCuti = rng.int(1, m === 3 || m === 4 ? 4 : 3);
        if (hariCuti > hkA - tanpaUpah - sakit) hariCuti = hkA - tanpaUpah - sakit > 0 ? hkA - tanpaUpah - sakit : 0;
        if (hariCuti > 0) {
          var izin = P.bolehAmbilCuti({ cuti: cuti }, emp, tahun, m, hariCuti, false);
          if (!izin.ok) {
            /* Refused rather than silently allowed. The days that could not be
             * covered by the balance become unpaid leave — which is exactly
             * what happens in practice, and it is the reason unpaid absence and
             * annual leave have to be separate columns. */
            hariCuti = izin.saldo > 0 ? izin.saldo : 0;
            tanpaUpah += 1;
          }
          if (hariCuti > 0) {
            cuti.push({
              id: 'CT-' + emp.nip + '-' + per, nip: emp.nip, jenis: 'tahunan',
              mulai: per + '-' + (rng.int(3, 20) < 10 ? '0' : '') + rng.int(3, 20),
              hari: hariCuti, override: false, status: 'disetujui'
            });
          }
        }
        if (sakit) {
          cuti.push({
            id: 'SK-' + emp.nip + '-' + per, nip: emp.nip, jenis: 'sakit',
            mulai: per + '-' + (rng.int(3, 24) < 10 ? '0' : '') + rng.int(3, 24),
            hari: sakit, override: false, status: 'disetujui'
          });
        }
        if (tanpaUpah) {
          cuti.push({
            id: 'TU-' + emp.nip + '-' + per, nip: emp.nip, jenis: 'tanpaUpah',
            mulai: per + '-' + (rng.int(3, 24) < 10 ? '0' : '') + rng.int(3, 24),
            hari: tanpaUpah, override: false, status: 'disetujui'
          });
        }
        absensi[emp.nip][per] = {
          hariKerja: hk, hariKerjaAktif: hkA,
          hadir: hkA - tanpaUpah - hariCuti - sakit,
          tanpaUpah: tanpaUpah, cuti: hariCuti, sakit: sakit
        };

        /* Overtime, from recorded occurrences, never a flat allowance. A rest
         * day / public holiday occurrence is rarer and pays under the other
         * multiplier ladder — Kepmenaker 102/2004 Pasal 11(b). */
        var kejadian = [];
        var n = rajinLembur ? rng.int(0, 5) : (emp.bolehLembur ? rng.int(0, 2) : 0);
        for (var j = 0; j < n; j++) {
          var libur = rng.chance(0.22);
          kejadian.push({
            tgl: per + '-' + ((j * 5 + rng.int(2, 5)) < 10 ? '0' : '') + (j * 5 + rng.int(2, 5)),
            jam: libur ? rng.int(3, 9) : rng.int(1, 4),
            libur: libur
          });
        }
        if (kejadian.length) lembur[emp.nip][per] = kejadian;
      });
    });

    /* One deliberate negative leave balance, WITH an override recorded against
     * it. Invariant I6 permits a negative balance only when somebody signed for
     * it; this proves the override path exists and that the check distinguishes
     * "negative" from "negative without authority". */
    var korbanCuti = karyawan[21];
    cuti.push({
      id: 'CT-OVR-' + korbanCuti.nip, nip: korbanCuti.nip, jenis: 'tahunan',
      mulai: tahun + '-12-22', hari: 20, override: true, status: 'disetujui',
      alasan: 'Cuti melebihi saldo, disetujui Manajer SDM sebagai pinjaman cuti tahun berikutnya.'
    });

    var ctx = { cfg: cfg, karyawan: karyawan, byNip: byNip, absensi: absensi, lembur: lembur, cuti: cuti };

    /* ------------------------------------------------------- the runs --- */

    /* Built in month order, each month reading the runs already posted, so the
     * December true-up in the seed is produced by exactly the same code path
     * the reviewer will drive from the UI. */
    var runs = {};
    for (var m = 1; m <= 12; m++) {
      var run = P.jalankan(ctx, runs, tahun, m, { oleh: 'payroll', at: D.periode(tahun, m) + '-25' });
      if (m <= 11) {
        run.status = 'terkunci';
        run.ditinjauOleh = 'payroll';
        run.dikunciOleh = 'finance';
        run.dikunciAt = D.periode(tahun, m) + '-27';
      } else {
        run.status = 'draft';
        run.catatan = 'Rekonsiliasi setahun (true-up) sudah dihitung; menunggu persetujuan finance approver.';
      }
      runs[run.id] = run;
    }

    return { cfg: cfg, karyawan: karyawan, byNip: byNip, absensi: absensi, lembur: lembur, cuti: cuti, runs: runs, ctx: ctx };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
