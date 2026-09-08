/*!
 * Payroll — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Payroll — pajak.js
 * PPh 21 for a permanent employee (pegawai tetap) under the TER regime.
 *
 * ================== WHAT CHANGED IN 2024, AND WHY IT MATTERS =============
 * Before PP 58/2023, monthly PPh 21 was computed by annualising the month's
 * income, running the annual Pasal 17 tariff over it and dividing by twelve.
 * Every month was a small annual calculation, so every month moved when an
 * allowance moved, and reconciling twelve of them against the 1721-A1 was a
 * afternoon's work.
 *
 * Since January 2024 the monthly figure is instead a single LOOKUP: the
 * employee's PTKP status picks one of three Tarif Efektif Rata-rata tables
 * (TER A, B, C), the month's gross picks a band inside it, and the band's
 * effective rate is applied straight to the gross. That is all January to
 * November is. It is fast, and it is deliberately approximate.
 *
 * THE DECEMBER TRUE-UP IS THEREFORE NOT OPTIONAL, IT IS THE MECHANISM.
 * In the last month of the tax year — or in the employee's final month, if
 * they leave earlier — the full annual Pasal 17 calculation is performed on
 * the year's actual income, and the month's deduction is set to
 *
 *     PPh 21 December  =  annual liability  -  sum of the TER months already withheld
 *
 * which may be NEGATIVE, in which case the employee is refunded through
 * payroll. Get this wrong and the twelve monthly deductions do not add up to
 * the annual figure on the 1721-A1, which is exactly the discrepancy a tax
 * audit finds and exactly what a payroll vendor is being paid to avoid. The
 * invariant is asserted in tests.js for every seeded employee, mid-year
 * joiners and the leaver included.
 *
 * ============================ WHAT IS TAXABLE ============================
 * The monthly gross this file is handed is not the same number as the gross
 * the employee is paid, and the difference is a real rule rather than a
 * modelling choice:
 *   ADDED to taxable gross, because the employer pays them as a benefit in
 *     the employee's name:  BPJS Kesehatan employer 4%, JKK, JKM.
 *   NOT added: JHT employer 3,7% and JP employer 2%, which are deferred
 *     savings and are taxed on withdrawal instead.
 *   DEDUCTIBLE from annual gross, alongside biaya jabatan: the EMPLOYEE's own
 *     JHT 2% and JP 1%. The employee's BPJS Kesehatan 1% is NOT deductible.
 * See payroll.js, which assembles those numbers, and the PPh 21 tab, which
 * prints the reconciliation line by line.
 *
 * ================ VINTAGE (see domain.js for the full list) ==============
 * TER tables: PP 58/2023 Lampiran. Annual tariff: UU 7/2021 Pasal 17(1)a.
 * PTKP: PMK 101/2016. Mechanics: PMK 168/2023. Encoded 8 September 2026 for
 * tax year 2025. A DEMO, NOT TAX ADVICE.
 */
(function (root) {
  'use strict';

  var D = root.PAYROLL_DOMAIN;
  var T = {};
  root.PAYROLL_PAJAK = T;

  /* ==================================================== TER tables ===== *
   * Transcribed from the Lampiran of PP 58/2023. Each row is the INCLUSIVE
   * upper bound of the band and its effective rate in basis points; the last
   * row has `sampai: null` and catches everything above. The regulation states
   * the first band as "sampai dengan" and the rest as "di atas X sampai dengan
   * Y", so a gross exactly equal to a boundary belongs to the LOWER band —
   * that boundary behaviour is asserted at every single boundary of all three
   * tables in tests.js, because an off-by-one there is invisible in aggregate
   * and wrong for exactly the employees sitting on a round salary. */

  T.TER = {
    A: [
      { sampai: 5400000, bp: 0 }, { sampai: 5650000, bp: 25 }, { sampai: 5950000, bp: 50 },
      { sampai: 6300000, bp: 75 }, { sampai: 6750000, bp: 100 }, { sampai: 7500000, bp: 125 },
      { sampai: 8550000, bp: 150 }, { sampai: 9650000, bp: 175 }, { sampai: 10050000, bp: 200 },
      { sampai: 10350000, bp: 225 }, { sampai: 10700000, bp: 250 }, { sampai: 11050000, bp: 300 },
      { sampai: 11600000, bp: 350 }, { sampai: 12500000, bp: 400 }, { sampai: 13750000, bp: 500 },
      { sampai: 15100000, bp: 600 }, { sampai: 16950000, bp: 700 }, { sampai: 19750000, bp: 800 },
      { sampai: 24150000, bp: 900 }, { sampai: 26450000, bp: 1000 }, { sampai: 28000000, bp: 1100 },
      { sampai: 30050000, bp: 1200 }, { sampai: 32400000, bp: 1300 }, { sampai: 35400000, bp: 1400 },
      { sampai: 39100000, bp: 1500 }, { sampai: 43850000, bp: 1600 }, { sampai: 47800000, bp: 1700 },
      { sampai: 51400000, bp: 1800 }, { sampai: 56300000, bp: 1900 }, { sampai: 62200000, bp: 2000 },
      { sampai: 68600000, bp: 2100 }, { sampai: 77500000, bp: 2200 }, { sampai: 89000000, bp: 2300 },
      { sampai: 103000000, bp: 2400 }, { sampai: 125000000, bp: 2500 }, { sampai: 157000000, bp: 2600 },
      { sampai: 206000000, bp: 2700 }, { sampai: 337000000, bp: 2800 }, { sampai: 454000000, bp: 2900 },
      { sampai: 550000000, bp: 3000 }, { sampai: 695000000, bp: 3100 }, { sampai: 910000000, bp: 3200 },
      { sampai: 1400000000, bp: 3300 }, { sampai: null, bp: 3400 }
    ],
    B: [
      { sampai: 6200000, bp: 0 }, { sampai: 6500000, bp: 25 }, { sampai: 6850000, bp: 50 },
      { sampai: 7300000, bp: 75 }, { sampai: 9200000, bp: 100 }, { sampai: 10750000, bp: 150 },
      { sampai: 11250000, bp: 200 }, { sampai: 11600000, bp: 250 }, { sampai: 12600000, bp: 300 },
      { sampai: 13600000, bp: 400 }, { sampai: 14950000, bp: 500 }, { sampai: 16400000, bp: 600 },
      { sampai: 18450000, bp: 700 }, { sampai: 21850000, bp: 800 }, { sampai: 26000000, bp: 900 },
      { sampai: 27700000, bp: 1000 }, { sampai: 29350000, bp: 1100 }, { sampai: 31450000, bp: 1200 },
      { sampai: 33950000, bp: 1300 }, { sampai: 37100000, bp: 1400 }, { sampai: 41100000, bp: 1500 },
      { sampai: 45800000, bp: 1600 }, { sampai: 49500000, bp: 1700 }, { sampai: 53800000, bp: 1800 },
      { sampai: 58500000, bp: 1900 }, { sampai: 64000000, bp: 2000 }, { sampai: 71000000, bp: 2100 },
      { sampai: 80000000, bp: 2200 }, { sampai: 93000000, bp: 2300 }, { sampai: 109000000, bp: 2400 },
      { sampai: 129000000, bp: 2500 }, { sampai: 163000000, bp: 2600 }, { sampai: 211000000, bp: 2700 },
      { sampai: 374000000, bp: 2800 }, { sampai: 459000000, bp: 2900 }, { sampai: 555000000, bp: 3000 },
      { sampai: 704000000, bp: 3100 }, { sampai: 957000000, bp: 3200 }, { sampai: 1405000000, bp: 3300 },
      { sampai: null, bp: 3400 }
    ],
    C: [
      { sampai: 6600000, bp: 0 }, { sampai: 6950000, bp: 25 }, { sampai: 7350000, bp: 50 },
      { sampai: 7800000, bp: 75 }, { sampai: 8850000, bp: 100 }, { sampai: 9800000, bp: 125 },
      { sampai: 10950000, bp: 150 }, { sampai: 11200000, bp: 175 }, { sampai: 12050000, bp: 200 },
      { sampai: 12950000, bp: 300 }, { sampai: 14150000, bp: 400 }, { sampai: 15550000, bp: 500 },
      { sampai: 17050000, bp: 600 }, { sampai: 19500000, bp: 700 }, { sampai: 22700000, bp: 800 },
      { sampai: 26600000, bp: 900 }, { sampai: 28100000, bp: 1000 }, { sampai: 30100000, bp: 1100 },
      { sampai: 32600000, bp: 1200 }, { sampai: 35400000, bp: 1300 }, { sampai: 38900000, bp: 1400 },
      { sampai: 43000000, bp: 1500 }, { sampai: 47400000, bp: 1600 }, { sampai: 51200000, bp: 1700 },
      { sampai: 55800000, bp: 1800 }, { sampai: 60400000, bp: 1900 }, { sampai: 66700000, bp: 2000 },
      { sampai: 74500000, bp: 2100 }, { sampai: 83200000, bp: 2200 }, { sampai: 95600000, bp: 2300 },
      { sampai: 110000000, bp: 2400 }, { sampai: 134000000, bp: 2500 }, { sampai: 169000000, bp: 2600 },
      { sampai: 221000000, bp: 2700 }, { sampai: 390000000, bp: 2800 }, { sampai: 463000000, bp: 2900 },
      { sampai: 561000000, bp: 3000 }, { sampai: 709000000, bp: 3100 }, { sampai: 965000000, bp: 3200 },
      { sampai: 1419000000, bp: 3300 }, { sampai: null, bp: 3400 }
    ]
  };

  T.KATEGORI = ['A', 'B', 'C'];
  T.KATEGORI_ISI = {
    A: { ptkp: [54000000, 58500000], status: ['TK/0', 'TK/1', 'K/0'] },
    B: { ptkp: [63000000, 67500000], status: ['TK/2', 'TK/3', 'K/1', 'K/2'] },
    C: { ptkp: [72000000], status: ['K/3'] }
  };

  /* Which band a gross falls in. Returns the band index, its inclusive lower
   * and upper bounds and its rate. Linear scan: 44 rows is nothing, and a
   * binary search here would be an optimisation nobody asked for over a
   * lookup that has to be obviously correct. */
  T.band = function (kategori, bruto) {
    var tab = T.TER[kategori];
    if (!tab) throw new Error('kategori TER tidak dikenal: ' + kategori);
    if (!D.isInt(bruto)) throw new Error('bruto TER harus bilangan bulat: ' + bruto);
    if (bruto < 0) throw new Error('bruto TER tidak boleh negatif: ' + bruto);
    for (var i = 0; i < tab.length; i++) {
      if (tab[i].sampai === null || bruto <= tab[i].sampai) {
        return {
          kategori: kategori, i: i, bp: tab[i].bp,
          dari: i === 0 ? 0 : tab[i - 1].sampai + 1,
          sampai: tab[i].sampai
        };
      }
    }
    throw new Error('tabel TER ' + kategori + ' tidak memiliki baris penutup');
  };

  /* The whole of January to November, for one employee, in one function.
   * `bruto` is the month's TAXABLE gross (see the header note on what is
   * added to it). The rate is applied to the gross and the result is rounded
   * DOWN to the whole rupiah — PMK 168/2023 and every DJP worked example
   * round PPh 21 down, and rounding up would over-withhold by a rupiah
   * twelve times a year for no reason anybody could explain to the employee. */
  T.terBulanan = function (status, bruto) {
    var kategori = D.kategoriTER(status);
    var band = T.band(kategori, bruto);
    return {
      status: status, kategori: kategori, band: band, bp: band.bp,
      bruto: bruto, pph21: D.bpFloor(bruto, band.bp)
    };
  };

  /* ---------------------------------------------- annual Pasal 17 ------- */

  /* Marginal brackets over PKP. Returns the total and the per-bracket
   * working, because "which bracket did the last rupiah land in" is the first
   * thing anybody asks when a December figure surprises them. */
  T.tarifPasal17 = function (pkp) {
    if (!D.isInt(pkp)) throw new Error('PKP harus bilangan bulat: ' + pkp);
    var lapis = [], total = 0, bawah = 0, i;
    if (pkp <= 0) {
      return { pph: 0, lapis: [], pkp: pkp < 0 ? 0 : pkp, marginalBp: 0 };
    }
    var marginal = 0;
    for (i = 0; i < D.LAPIS_PASAL17.length; i++) {
      var L = D.LAPIS_PASAL17[i];
      var atas = L.sampai === null ? pkp : (pkp < L.sampai ? pkp : L.sampai);
      if (atas <= bawah) break;
      var dasar = atas - bawah;
      var pajak = D.bpRound(dasar, L.bp);
      lapis.push({ dari: bawah, sampai: L.sampai, bp: L.bp, dasar: dasar, pajak: pajak });
      total += pajak;
      marginal = L.bp;
      bawah = L.sampai === null ? pkp : L.sampai;
      if (pkp <= bawah) break;
    }
    return { pph: total, lapis: lapis, pkp: pkp, marginalBp: marginal };
  };

  /* The full annual recomputation. Everything it needs is a year's worth of
   * totals plus the number of months the employee was actually on the payroll,
   * because the biaya jabatan cap is per MONTH (Rp 500.000) and a mid-year
   * joiner who is given the full Rp 6.000.000 cap is under-taxed.
   *
   * PTKP is NOT prorated. For a pegawai tetap it is an annual allowance
   * attached to the person, not to the months worked — proration is the other
   * classic error here, and it goes the other way, over-taxing the joiner.
   */
  T.pph21Tahunan = function (arg) {
    var brutoTahun = arg.brutoTahun;
    var bulanKerja = arg.bulanKerja;
    var jhtPekerja = arg.jhtPekerja || 0;
    var jpPekerja = arg.jpPekerja || 0;
    var status = arg.status;
    if (!D.isInt(brutoTahun) || brutoTahun < 0) throw new Error('bruto tahunan harus bilangan bulat >= 0: ' + brutoTahun);
    if (!D.isInt(bulanKerja) || bulanKerja < 1 || bulanKerja > 12) throw new Error('bulan kerja harus 1..12: ' + bulanKerja);

    var bjKotor = D.bpRound(brutoTahun, D.BIAYA_JABATAN_BP);
    var bjCap = D.mul(D.BIAYA_JABATAN_CAP_BULAN, bulanKerja);
    var biayaJabatan = bjKotor > bjCap ? bjCap : bjKotor;
    var biayaJabatanKena = bjKotor > bjCap;

    var pengurang = biayaJabatan + jhtPekerja + jpPekerja;
    var neto = brutoTahun - pengurang;
    var ptkp = D.ptkpOf(status);
    var pkpKasar = neto - ptkp;
    var pkp = pkpKasar <= 0 ? 0 : D.floorRibuan(pkpKasar);
    var tarif = T.tarifPasal17(pkp);

    return {
      status: status, ptkp: ptkp, bulanKerja: bulanKerja,
      brutoTahun: brutoTahun,
      biayaJabatanKotor: bjKotor, biayaJabatanCap: bjCap,
      biayaJabatan: biayaJabatan, biayaJabatanKena: biayaJabatanKena,
      jhtPekerja: jhtPekerja, jpPekerja: jpPekerja,
      pengurang: pengurang, neto: neto,
      pkpKasar: pkpKasar, pkp: pkp,
      lapis: tarif.lapis, marginalBp: tarif.marginalBp,
      pph: tarif.pph,
      /* The effective rate the year actually landed on, for comparison against
       * the TER band that was used month by month. Basis points, floored. */
      efektifBp: brutoTahun === 0 ? 0 : D.divFloor(D.mul(tarif.pph, 10000), brutoTahun)
    };
  };

  /* ------------------------------------------- the year, in one call ---- */

  /* Hand this the taxable gross of every month the employee was on the
   * payroll, in order, and it returns the twelve (or fewer) deductions with
   * the true-up already placed in the right month.
   *
   * `bulanKoreksi` is the month that carries the annual recomputation: normally
   * December, but the FINAL MONTH OF EMPLOYMENT for a leaver, because a
   * December recomputation for somebody who left in August never happens and
   * their withholding would stay at the TER approximation forever.
   *
   * The function returns `konsisten`, its own check that
   *   sum(monthly) === annual
   * so the guarantee is available to the UI and to the invariant panel without
   * either of them re-deriving it. tests.js does re-derive it, independently,
   * for every seeded employee — a self-check that only the checked code can
   * see is not a check.
   */
  T.rencanaTahun = function (arg) {
    var status = arg.status;
    var bulanan = arg.bulanan;            /* [{bulan, brutoPajak, jhtPekerja, jpPekerja}] */
    if (!bulanan || !bulanan.length) throw new Error('rencanaTahun butuh minimal satu bulan');
    var bulanKoreksi = arg.bulanKoreksi;
    if (bulanKoreksi === undefined || bulanKoreksi === null) bulanKoreksi = bulanan[bulanan.length - 1].bulan;

    /* One entry per month, or the plan is meaningless. An adjustment run posts a
     * SECOND record against a month it corrects, and handing both to this
     * function unmerged used to leave a null in the output array and crash on
     * the sum — a silent hole rather than a complaint. The caller must collapse
     * a month's records into one before asking for a plan. */
    var lihat = {}, i;
    for (i = 0; i < bulanan.length; i++) {
      if (lihat[bulanan[i].bulan]) {
        throw new Error('rencanaTahun menerima dua catatan untuk bulan ' + bulanan[i].bulan +
          '. Gabungkan catatan run reguler dan run penyesuaian bulan itu lebih dulu.');
      }
      lihat[bulanan[i].bulan] = 1;
    }
    var brutoTahun = 0, jht = 0, jp = 0;
    for (i = 0; i < bulanan.length; i++) {
      brutoTahun += bulanan[i].brutoPajak;
      jht += bulanan[i].jhtPekerja || 0;
      jp += bulanan[i].jpPekerja || 0;
    }
    var tahunan = T.pph21Tahunan({
      status: status, brutoTahun: brutoTahun, bulanKerja: bulanan.length,
      jhtPekerja: jht, jpPekerja: jp
    });

    /* Pass one: the TER lookup for every month that is not the correction
     * month. Pass two: the correction month takes the remainder. Doing it in
     * that order — rather than computing all twelve by TER and then patching
     * December — is what makes the sum exact by construction instead of by
     * luck with the rounding. */
    var hasil = [], akum = 0;
    for (i = 0; i < bulanan.length; i++) {
      var b = bulanan[i];
      if (b.bulan === bulanKoreksi) { hasil.push(null); continue; }
      var ter = T.terBulanan(status, b.brutoPajak);
      akum += ter.pph21;
      hasil.push({
        bulan: b.bulan, metode: 'ter', kategori: ter.kategori, bp: ter.bp,
        band: ter.band, brutoPajak: b.brutoPajak, pph21: ter.pph21
      });
    }
    var idxKoreksi = -1;
    for (i = 0; i < bulanan.length; i++) if (bulanan[i].bulan === bulanKoreksi) idxKoreksi = i;
    if (idxKoreksi < 0) throw new Error('bulan koreksi ' + bulanKoreksi + ' tidak ada dalam daftar bulan');

    var bk = bulanan[idxKoreksi];
    var terBk = T.terBulanan(status, bk.brutoPajak);   /* shown for comparison only */
    var koreksi = tahunan.pph - akum;
    hasil[idxKoreksi] = {
      bulan: bulanKoreksi, metode: 'setahun', kategori: terBk.kategori, bp: terBk.bp,
      band: terBk.band, brutoPajak: bk.brutoPajak,
      pph21: koreksi,
      terSeandainya: terBk.pph21,
      akumTer: akum, pphTahunan: tahunan.pph
    };

    var total = 0;
    for (i = 0; i < hasil.length; i++) total += hasil[i].pph21;

    return {
      status: status, kategori: D.kategoriTER(status),
      bulanKoreksi: bulanKoreksi, bulanan: hasil, tahunan: tahunan,
      totalDipotong: total, akumTer: akum, koreksi: koreksi,
      konsisten: total === tahunan.pph,
      /* A negative correction is a refund paid through payroll, and it is worth
       * naming: HR will be asked about it, and "the December slip shows minus
       * four hundred thousand" is otherwise a support ticket. */
      restitusi: koreksi < 0
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
