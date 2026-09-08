/*!
 * Payroll — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Payroll — domain.js
 * Integer primitives, formatting, a seeded PRNG, calendar helpers, and every
 * statutory table this app encodes. Nothing here touches the DOM or the
 * network, so the same file runs under node.
 *
 * ============================ THE ONE RULE ============================
 * MONEY IS AN INTEGER NUMBER OF RUPIAH. Never a float, not once, not in an
 * intermediate. A float in a payroll engine is not a rounding nuisance, it is
 * a legal exposure: the sum of twelve monthly PPh 21 deductions has to equal
 * one annual figure TO THE RUPIAH, and 0.1 + 0.2 makes that impossible to
 * prove. Every division goes through divRound / divFloor, which take integers
 * and return integers, so every rounding decision in the codebase is a
 * decision somebody wrote down.
 *
 * RATES ARE INTEGER BASIS POINTS, 10000 bp = 100%.
 *   Every rate in every table this app encodes is an exact multiple of 0.25%,
 *   i.e. of 25 bp, so bp arithmetic is exact — there is no rate that needs a
 *   fraction of a basis point to express. 5.7% JHT is 570 bp. 0.24% JKK is
 *   24 bp. The TER tables run 0 bp to 3400 bp in steps of 25.
 *
 * ROUNDING POLICY, written down once and applied everywhere:
 *   divRound(a,b)  a/b rounded HALF AWAY FROM ZERO. 2500/1000 -> 3, not 2.
 *                  Not banker's rounding: DJP and BPJS worked examples round
 *                  away from zero, and a reviewer checking with a calculator
 *                  will do the same.
 *   divFloor(a,b)  a/b truncated toward negative infinity. Used where the
 *                  rule itself says "dibulatkan ke bawah": PPh 21 amounts to
 *                  the whole rupiah, and PKP to the whole thousand
 *                  (UU PPh Pasal 17 ayat 4).
 *
 * ==================== STATUTORY VINTAGE OF THIS FILE ====================
 * Encoded as at 8 September 2026, for tax year 2025:
 *   PPh 21 annual tariff .... UU 7/2021 (HPP) Pasal 17 ayat (1) huruf a
 *   TER monthly rates ....... PP 58/2023, Lampiran (TER A / B / C)
 *   TER mechanics ........... PMK 168/2023
 *   PTKP .................... PMK 101/PMK.010/2016
 *   Biaya jabatan ........... PMK 250/PMK.03/2008 (5%, cap 500rb/bulan)
 *   BPJS Kesehatan .......... Perpres 82/2018 as amended by Perpres 64/2020
 *   JHT ..................... PP 46/2015
 *   JP ...................... PP 45/2015; wage ceiling per the BPJS annual
 *                             adjustment for 2025
 *   JKK / JKM ............... PP 44/2015 (risk classes), JKM 0.30%
 *   Lembur .................. Kepmenaker 102/MEN/VI/2004
 *   Cuti tahunan ............ UU 13/2003 Pasal 79 as amended by UU 6/2023
 *   THR ..................... PP 36/2021 Pasal 9; Permenaker 6/2016
 * THIS IS A DEMO, NOT TAX ADVICE. Tax tables change every few years; check the
 * vintage above against the current regulation before believing any figure.
 */
(function (root) {
  'use strict';

  var D = {};
  root.PAYROLL_DOMAIN = D;

  /* ---------------------------------------------------------- integers -- */

  D.MAX_SAFE = 9007199254740991;   // Number.MAX_SAFE_INTEGER, spelled out

  D.isInt = function (v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  };

  /* Every product of a rupiah figure and a rate passes through here. The guard
   * is not decorative: an annual company-wide gross is already ~5e10, and
   * multiplying it by a 10000-scaled rate lands at 5e14 — inside 2^53, but
   * close enough that an assertion beats a hope. */
  var maxProductSeen = 0;
  D.mul = function (a, b) {
    if (!D.isInt(a) || !D.isInt(b)) throw new Error('mul hanya menerima bilangan bulat: ' + a + ', ' + b);
    var p = a * b, ap = Math.abs(p);
    /* Refuse FIRST, record afterwards. A refused product must not be counted
       as "the largest product this engine has seen", or the high-water mark the
       tests assert against is set by the very call that proved the guard
       works. */
    if (ap > D.MAX_SAFE) throw new Error('perkalian melewati batas bilangan bulat aman: ' + a + ' * ' + b);
    if (ap > maxProductSeen) maxProductSeen = ap;
    return p;
  };
  D.maxProduct = function () { return maxProductSeen; };
  D.resetMaxProduct = function () { maxProductSeen = 0; };

  /* Integer division, half away from zero. Written with integer arithmetic
   * only, so the answer never depends on whether a quotient happened to be
   * representable as a double. */
  D.divRound = function (a, b) {
    if (!D.isInt(a) || !D.isInt(b)) throw new Error('divRound hanya menerima bilangan bulat: ' + a + ', ' + b);
    if (b === 0) throw new Error('divRound: pembagi nol');
    var neg = (a < 0) !== (b < 0);
    var aa = Math.abs(a), bb = Math.abs(b);
    var q = Math.floor(aa / bb);
    var r = aa - D.mul(q, bb);
    if (D.mul(r, 2) >= bb) q += 1;
    return neg ? -q : q;
  };

  /* Truncation toward negative infinity. -1 / 2 is 0 under Math.trunc and -1
   * here, and the difference matters: a negative December true-up is a refund,
   * and rounding a refund toward zero quietly keeps a rupiah of the
   * employee's money. */
  D.divFloor = function (a, b) {
    if (!D.isInt(a) || !D.isInt(b)) throw new Error('divFloor hanya menerima bilangan bulat: ' + a + ', ' + b);
    if (b === 0) throw new Error('divFloor: pembagi nol');
    return Math.floor(a / b);
  };

  /* rate application. bp is basis points of 10000, so 570 bp = 5.7%. */
  D.bpRound = function (n, bp) { return D.divRound(D.mul(n, bp), 10000); };
  D.bpFloor = function (n, bp) { return D.divFloor(D.mul(n, bp), 10000); };

  /* "dibulatkan ke bawah hingga ribuan penuh" — PKP, UU PPh Pasal 17 ayat 4. */
  D.floorRibuan = function (n) { return D.mul(D.divFloor(n, 1000), 1000); };

  D.sum = function (arr, key) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = key ? arr[i][key] : arr[i];
      if (v === undefined || v === null) continue;
      if (!D.isInt(v)) throw new Error('sum menemukan nilai bukan bilangan bulat pada ' + (key || i) + ': ' + v);
      t += v;
    }
    return t;
  };

  D.clamp = function (n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); };

  /* ------------------------------------------------------------ format -- */

  function grup(n) {
    var s = String(Math.abs(n)), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = '.' + out;
    }
    return (n < 0 ? '-' : '') + out;
  }

  D.rupiah = function (n) {
    if (n === null || n === undefined) return '—';
    if (!D.isInt(n)) return '!' + n;        // deliberately ugly: a float is a bug
    return (n < 0 ? '-Rp' : 'Rp') + grup(Math.abs(n));
  };
  D.angka = function (n) {
    if (n === null || n === undefined) return '—';
    if (!D.isInt(n)) return '!' + n;
    return grup(n);
  };
  /* A rate, printed from its basis points. 25 bp -> "0,25%", 570 -> "5,7%". */
  D.persen = function (bp) {
    if (!D.isInt(bp)) return '!' + bp;
    var neg = bp < 0, a = Math.abs(bp);
    var utuh = Math.floor(a / 100), sisa = a % 100;
    var s = String(utuh);
    if (sisa) {
      var f = (sisa < 10 ? '0' : '') + String(sisa);
      f = f.replace(/0+$/, '');
      s += ',' + f;
    }
    return (neg ? '-' : '') + s + '%';
  };

  /* ------------------------------------------------------------- prng --- */

  /* mulberry32. Deterministic and identical under node and in the browser,
   * which is what makes "all of this is rebuilt from one seed integer" a
   * checkable claim rather than a slogan. */
  D.rng = function (seed) {
    var a = seed >>> 0;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
      /* Round an integer to a multiple of `step`, used so seeded salaries look
       * like salaries somebody negotiated rather than like PRNG output. */
      bulat: function (n, step) { return D.mul(D.divRound(n, step), step); }
    };
  };

  /* ------------------------------------------------------------ waktu --- */

  D.BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  D.BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  D.namaBulan = function (m) { return D.BULAN[m - 1] || ('bulan ' + m); };

  /* Dates are UTC midnight throughout. A payroll period is a calendar month,
   * and local-time arithmetic silently moves a join date across a period
   * boundary for everybody east of GMT — which is everybody this is for. */
  D.ymd = function (ts) {
    var d = new Date(ts);
    var m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  };
  D.parseYmd = function (s) {
    var p = String(s).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  };
  D.tahunDari = function (s) { return +String(s).slice(0, 4); };
  D.bulanDari = function (s) { return +String(s).slice(5, 7); };
  D.hariDari = function (s) { return +String(s).slice(8, 10); };
  D.periode = function (y, m) { return y + '-' + (m < 10 ? '0' : '') + m; };
  D.tglPanjang = function (s) {
    if (!s) return '—';
    return D.hariDari(s) + ' ' + D.namaBulan(D.bulanDari(s)) + ' ' + D.tahunDari(s);
  };

  /* Whole months of service completed between two dates, by the anniversary
   * rule: someone who started on the 20th completes a month of service on the
   * 20th of the next month, not on the 1st. THR proration turns on this
   * number, so it gets its own tests. */
  D.bulanMasaKerja = function (mulai, sampai) {
    var y1 = D.tahunDari(mulai), m1 = D.bulanDari(mulai), d1 = D.hariDari(mulai);
    var y2 = D.tahunDari(sampai), m2 = D.bulanDari(sampai), d2 = D.hariDari(sampai);
    var n = D.mul(y2 - y1, 12) + (m2 - m1);
    if (d2 < d1) n -= 1;
    return n < 0 ? 0 : n;
  };

  /* Working days in a month for a five-day week, Monday to Friday, ignoring
   * public holidays. The unpaid-leave proration divides by this, so it must be
   * a real count and not the 21-or-22 everybody guesses at. */
  D.hariKerja = function (y, m) {
    var n = 0, hariDalamBulan = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (var d = 1; d <= hariDalamBulan; d++) {
      var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  };

  /* Working days of month (y,m) that fall inside [dari, sampai] inclusive,
   * where either bound may be null meaning "the edge of the month". This is
   * what a first or last month of employment is actually worth: an employee
   * who joins on the 18th did not work the 1st to the 17th, and paying them a
   * whole month's wage for a fortnight is not generosity, it is a wrong
   * payslip that overstates their gross, their BPJS-free allowances and their
   * PPh 21 alike. */
  D.hariKerjaAktif = function (y, m, dari, sampai) {
    var hariDalamBulan = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var d1 = 1, d2 = hariDalamBulan, n = 0;
    if (dari && D.tahunDari(dari) === y && D.bulanDari(dari) === m) d1 = D.hariDari(dari);
    if (dari && (D.tahunDari(dari) > y || (D.tahunDari(dari) === y && D.bulanDari(dari) > m))) return 0;
    if (sampai && D.tahunDari(sampai) === y && D.bulanDari(sampai) === m) d2 = D.hariDari(sampai);
    if (sampai && (D.tahunDari(sampai) < y || (D.tahunDari(sampai) === y && D.bulanDari(sampai) < m))) return 0;
    if (d1 < 1) d1 = 1;
    if (d2 > hariDalamBulan) d2 = hariDalamBulan;
    for (var d = d1; d <= d2; d++) {
      var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  };

  /* ================================================================= *
   *                        STATUTORY TABLES                           *
   * ================================================================= */

  /* ---------------------------------------------------------- PTKP ------ *
   * PMK 101/PMK.010/2016. Base Rp 54.000.000 for the taxpayer, plus
   * Rp 4.500.000 for a married taxpayer, plus Rp 4.500.000 per dependant to a
   * maximum of three. The table below is written out in full rather than
   * computed, because it is the thing a reviewer will check first and a
   * formula hides a transcription error where a literal cannot. */
  D.PTKP = {
    'TK/0': { ptkp: 54000000, ter: 'A', label: 'TK/0 — tidak kawin, tanpa tanggungan' },
    'TK/1': { ptkp: 58500000, ter: 'A', label: 'TK/1 — tidak kawin, 1 tanggungan' },
    'TK/2': { ptkp: 63000000, ter: 'B', label: 'TK/2 — tidak kawin, 2 tanggungan' },
    'TK/3': { ptkp: 67500000, ter: 'B', label: 'TK/3 — tidak kawin, 3 tanggungan' },
    'K/0': { ptkp: 58500000, ter: 'A', label: 'K/0 — kawin, tanpa tanggungan' },
    'K/1': { ptkp: 63000000, ter: 'B', label: 'K/1 — kawin, 1 tanggungan' },
    'K/2': { ptkp: 67500000, ter: 'B', label: 'K/2 — kawin, 2 tanggungan' },
    'K/3': { ptkp: 72000000, ter: 'C', label: 'K/3 — kawin, 3 tanggungan' }
  };
  D.STATUS_PTKP = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];

  D.ptkpOf = function (status) {
    var r = D.PTKP[status];
    if (!r) throw new Error('status PTKP tidak dikenal: ' + status);
    return r.ptkp;
  };
  /* PP 58/2023 groups the eight PTKP statuses into three TER categories by
   * their PTKP amount, not by marital status:
   *   A  PTKP 54.000.000 dan 58.500.000  ->  TK/0, TK/1, K/0
   *   B  PTKP 63.000.000 dan 67.500.000  ->  TK/2, TK/3, K/1, K/2
   *   C  PTKP 72.000.000                 ->  K/3
   * So K/0 and TK/1 land in the same band despite different family shapes,
   * and TK/3 and K/2 do too. That is the regulation, not a simplification. */
  D.kategoriTER = function (status) {
    var r = D.PTKP[status];
    if (!r) throw new Error('status PTKP tidak dikenal: ' + status);
    return r.ter;
  };

  /* -------------------------------------------- tarif tahunan Pasal 17 -- *
   * UU 7/2021 (HPP). Marginal brackets on PKP, in rupiah, rate in bp. */
  D.LAPIS_PASAL17 = [
    { sampai: 60000000, bp: 500 },
    { sampai: 250000000, bp: 1500 },
    { sampai: 500000000, bp: 2500 },
    { sampai: 5000000000, bp: 3000 },
    { sampai: null, bp: 3500 }
  ];

  /* ------------------------------------------------- biaya jabatan ------ *
   * PMK 250/PMK.03/2008: 5% of gross employment income, capped at
   * Rp 500.000 per month and Rp 6.000.000 per year. The monthly cap is what
   * matters for a mid-year joiner: seven months of work gets a
   * Rp 3.500.000 cap, not Rp 6.000.000. */
  D.BIAYA_JABATAN_BP = 500;
  D.BIAYA_JABATAN_CAP_BULAN = 500000;

  /* ---------------------------------------------------------- BPJS ------ */

  /* Perpres 82/2018 s.d.t.d Perpres 64/2020. Total 5% of monthly wage:
   * 4% employer, 1% employee. The wage used is capped at Rp 12.000.000 and
   * floored at the applicable minimum wage. Above the cap the contribution
   * is FLAT — Rp 120.000 employee, Rp 480.000 employer — which is why a
   * director and a senior manager pay exactly the same premium. */
  D.KESEHATAN = {
    bpPekerja: 100,          /* 1%  */
    bpPemberi: 400,          /* 4%  */
    batasAtas: 12000000,
    /* The wage FLOOR is the applicable minimum wage, which is a per-region
     * per-year setting rather than a national constant, so it lives in the
     * company config (cfg.umk) and is passed in — never mutated onto this
     * table, because a global that the seed writes and the tests read is a
     * cross-test dependency waiting to happen. */
    batasBawah: 0
  };

  /* PP 46/2015. 5,7% total: 2% employee, 3,7% employer. NO ceiling — this is
   * the one contribution that keeps rising with salary, and the contrast with
   * JP is the point of the BPJS tab. */
  D.JHT = { bpPekerja: 200, bpPemberi: 370, batasAtas: null };

  /* PP 45/2015. 3% total: 1% employee, 2% employer, on a wage ceiling that
   * BPJS re-announces every year. The figure encoded is the 2025 ceiling,
   * Rp 10.547.400. It is DIFFERENT from the Kesehatan ceiling and lower, so
   * for a mid-salary employee JP caps while Kesehatan has not yet. */
  D.JP = { bpPekerja: 100, bpPemberi: 200, batasAtas: 10547400, tahunBatas: 2025 };

  /* PP 44/2015. Employer only, by the company's accident-risk class. */
  D.JKK_KELAS = {
    'I': { bp: 24, label: 'I — risiko sangat rendah (0,24%)' },
    'II': { bp: 54, label: 'II — risiko rendah (0,54%)' },
    'III': { bp: 89, label: 'III — risiko sedang (0,89%)' },
    'IV': { bp: 127, label: 'IV — risiko tinggi (1,27%)' },
    'V': { bp: 174, label: 'V — risiko sangat tinggi (1,74%)' }
  };
  D.KELAS_RISIKO = ['I', 'II', 'III', 'IV', 'V'];
  /* JKM: 0,30%, employer only, no ceiling. */
  D.JKM = { bpPemberi: 30 };

  /* ---------------------------------------------------------- lembur ---- *
   * Kepmenaker 102/MEN/VI/2004.
   *   Pasal 8: hourly overtime rate = 1/173 of the monthly wage. 173 is not a
   *   count of hours in a month, it is a statutory divisor (40 hours a week
   *   x 52 weeks / 12), and using 160 or 174 instead is the single most common
   *   overtime error in Indonesian payroll software.
   *   Pasal 11(a): on a WORKING day the first hour pays 1,5x and every hour
   *   after that pays 2x.
   *   Pasal 11(b): on a weekly rest day or public holiday, for a five-day
   *   week (8 hours a day), hours 1-8 pay 2x, hour 9 pays 3x, hours 10 and 11
   *   pay 4x.
   * Multipliers are held in bp of a single hour, so 1,5x is 150 and the whole
   * calculation stays integer.
   *
   * BOTH DAILY MAXIMA ARE ENFORCED, not just declared: four hours on a working
   * day (PP 35/2021 Pasal 26 ayat 1) and eleven on a rest day, which is as far
   * as Pasal 11(b) defines a multiplier at all. Past either bound the engine
   * throws instead of silently extending the top multiplier — an hour the
   * regulation does not price is not an hour this engine may price. */
  D.LEMBUR_DIVISOR = 173;
  D.LEMBUR_HARI_KERJA = { jamPertama: 150, jamBerikut: 200, maksJam: 4 };
  D.LEMBUR_HARI_LIBUR = { blokDasar: 8, bpDasar: 200, bpJamKesembilan: 300, bpJamSelanjutnya: 400, maksJam: 11 };

  /* Total multiplier weight, in bp, for `jam` hours of overtime. Split out
   * from the money so the weight itself can be asserted against the
   * regulation's own worked examples without any wage in the way. */
  D.bobotLembur = function (jam, libur) {
    if (!D.isInt(jam) || jam < 0) throw new Error('jam lembur harus bilangan bulat >= 0: ' + jam);
    if (jam === 0) return 0;
    /* THE DAILY MAXIMUM IS ENFORCED, not merely declared. A table that names a
     * limit and never reads it is worse than no limit: it reads like a control
     * to whoever greps for one. PP 35/2021 Pasal 26 ayat (1) caps overtime on a
     * WORKING day at four hours a day, and Kepmenaker 102/2004 Pasal 11 huruf b
     * defines rest-day multipliers only as far as the eleventh hour for a
     * five-day week. Beyond either, this engine has no rate the regulation
     * gives it, so it refuses rather than extrapolating somebody's pay. */
    var maks = libur ? D.LEMBUR_HARI_LIBUR.maksJam : D.LEMBUR_HARI_KERJA.maksJam;
    if (jam > maks) {
      throw new Error('lembur ' + jam + ' jam melebihi batas ' + maks + ' jam sehari untuk ' +
        (libur ? 'hari istirahat/libur (Kepmenaker 102/2004 Pasal 11 huruf b hanya mendefinisikan pengali sampai jam ke-11)' :
          'hari kerja (PP 35/2021 Pasal 26 ayat (1): paling lama 4 jam sehari)') +
        '. Kelebihannya harus dicatat sebagai hari lembur tersendiri, bukan diekstrapolasi dengan pengali tertinggi.');
    }
    var t = 0, i;
    if (!libur) {
      t = D.LEMBUR_HARI_KERJA.jamPertama;
      t += D.mul(jam - 1, D.LEMBUR_HARI_KERJA.jamBerikut);
      return t;
    }
    var L = D.LEMBUR_HARI_LIBUR;
    for (i = 1; i <= jam; i++) {
      if (i <= L.blokDasar) t += L.bpDasar;
      else if (i === L.blokDasar + 1) t += L.bpJamKesembilan;
      else t += L.bpJamSelanjutnya;
    }
    return t;
  };

  /* Rupiah for one overtime occurrence. upahSebulan is upah pokok plus
   * tunjangan tetap — Pasal 8 ayat (2) says variable allowances are excluded,
   * so a meal allowance that moves with attendance must not inflate the
   * overtime base. */
  D.upahLembur = function (upahSebulan, jam, libur) {
    var bobot = D.bobotLembur(jam, libur);
    if (bobot === 0) return 0;
    return D.divRound(D.mul(upahSebulan, bobot), D.mul(D.LEMBUR_DIVISOR, 100));
  };

  /* ------------------------------------------------------------- THR ---- *
   * PP 36/2021 Pasal 9. Twelve months of continuous service or more: one
   * month's wage. One month up to under twelve: prorated as
   *   (months of service / 12) x one month's wage.
   * Under one month: no entitlement. Paid at the latest seven days before the
   * religious holiday. */
  D.THR_BULAN_PENUH = 12;
  D.thr = function (upahSebulan, bulanMasaKerja) {
    if (!D.isInt(upahSebulan) || upahSebulan < 0) throw new Error('upah THR harus bilangan bulat >= 0');
    if (!D.isInt(bulanMasaKerja) || bulanMasaKerja < 0) throw new Error('masa kerja THR harus bilangan bulat >= 0');
    if (bulanMasaKerja < 1) return 0;
    if (bulanMasaKerja >= D.THR_BULAN_PENUH) return upahSebulan;
    return D.divRound(D.mul(upahSebulan, bulanMasaKerja), D.THR_BULAN_PENUH);
  };

  /* ------------------------------------------------------------ cuti ---- *
   * UU 13/2003 Pasal 79 ayat (2) huruf c, as amended by UU 6/2023: at least
   * twelve working days of paid annual leave after twelve months of
   * continuous service. This app accrues one day per completed month once the
   * employee is eligible, capped at the annual entitlement plus a carry-over
   * window, and the balance may not go negative without an explicit override
   * recorded against the request. */
  D.CUTI_HAK_TAHUNAN = 12;
  D.CUTI_SYARAT_BULAN = 12;
  D.CUTI_CARRY_MAKS = 6;

  /* Accrued leave days at the end of period (y,m) for someone who started on
   * `mulai`, net of nothing — takings are subtracted by the caller so that
   * "accrued minus taken" stays visible as two separate numbers. */
  D.cutiAkrual = function (mulai, y, m) {
    var akhir = D.periode(y, m) + '-28';
    var bulan = D.bulanMasaKerja(mulai, akhir);
    if (bulan < D.CUTI_SYARAT_BULAN) return 0;
    var setelahSyarat = bulan - D.CUTI_SYARAT_BULAN + 1;
    var cap = D.CUTI_HAK_TAHUNAN + D.CUTI_CARRY_MAKS;
    return setelahSyarat > cap ? cap : setelahSyarat;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
