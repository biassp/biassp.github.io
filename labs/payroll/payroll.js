/*!
 * Payroll — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Payroll — payroll.js
 * The engine: one payslip, one payroll run, and the invariant checker that is
 * re-run over the raw records on every state change.
 *
 * ===================== HOW A PAYSLIP IS PUT TOGETHER =====================
 * Three columns that must never be allowed to touch:
 *
 *   1. EARNINGS the employee is paid. Gaji pokok, tunjangan tetap, tunjangan
 *      makan (variable, follows attendance), lembur, THR, and — as a NEGATIVE
 *      earning, not a deduction — the proportional reduction for unpaid
 *      absence, because "no work, no pay" reduces the wage itself rather than
 *      withholding from it. Their sum is BRUTO.
 *   2. EMPLOYEE DEDUCTIONS withheld from that gross: BPJS Kesehatan 1%,
 *      JHT 2%, JP 1%, PPh 21. NETO = BRUTO - these. That is invariant I1, and
 *      it is the only definition of net pay in this codebase.
 *   3. EMPLOYER CONTRIBUTIONS: BPJS Kesehatan 4%, JHT 3,7%, JP 2%, JKK by
 *      risk class, JKM 0,30%. These are a cost to the company and are NOT
 *      deducted from anybody. They appear in their own column, are totalled
 *      separately, and invariant I5 asserts that changing them cannot move a
 *      single rupiah of net pay. Payroll software that quietly nets employer
 *      JHT out of take-home pay is the most expensive bug in this domain.
 *
 * A fourth number exists that is neither of the three: the TAXABLE gross.
 * Employer-paid BPJS Kesehatan, JKK and JKM are benefits in the employee's
 * name and are taxable to them; employer JHT and JP are not. So
 *      bruto pajak = bruto + kesehatan pemberi + JKK + JKM
 * and it is larger than the gross the employee sees. It is what goes into the
 * TER lookup and into the annual recomputation. Printing it on the payslip
 * next to the gross, rather than hiding it, is the difference between a
 * payslip an employee can reconcile and one they have to trust.
 *
 * ===================== WHY DECEMBER READS THE LEDGER =====================
 * The December true-up is computed from what was ACTUALLY WITHHELD in the
 * posted runs for January to November, never from a fresh recomputation of
 * those months. That is not a shortcut, it is the correct behaviour: if HR
 * changes an employee's PTKP status in November, the locked January payslip
 * does not retroactively change, and the whole difference lands in December.
 * Recomputing the earlier months instead would produce a December figure that
 * reconciles against a history that was never withheld.
 */
(function (root) {
  'use strict';

  var D = root.PAYROLL_DOMAIN;
  var T = root.PAYROLL_PAJAK;
  var P = {};
  root.PAYROLL_ENGINE = P;

  /* Every money column of a payslip, named once. The run total is the sum of
   * these columns over its payslips (invariant I2) and the checker loops this
   * list rather than a hand-written set, so a column added later cannot be
   * left out of the reconciliation by forgetting to mention it. */
  P.KOLOM = [
    'pokok', 'tunjanganTetap', 'tunjanganMakan', 'lembur', 'thr', 'potonganAbsen',
    'bruto',
    'premiKes', 'premiJkk', 'premiJkm', 'brutoPajak',
    'dedKes', 'dedJht', 'dedJp', 'dedPph21', 'dedTotal',
    'ptgKes', 'ptgJht', 'ptgJp', 'ptgJkk', 'ptgJkm', 'ptgTotal',
    'neto'
  ];
  /* Which of those are employee deductions, and which are employer cost. The
   * two lists must not intersect — asserted. */
  P.KOLOM_POTONGAN = ['dedKes', 'dedJht', 'dedJp', 'dedPph21'];
  P.KOLOM_PEMBERI = ['ptgKes', 'ptgJht', 'ptgJp', 'ptgJkk', 'ptgJkm'];
  P.KOLOM_PENDAPATAN = ['pokok', 'tunjanganTetap', 'tunjanganMakan', 'lembur', 'thr', 'potonganAbsen'];

  P.LABEL = {
    pokok: 'Gaji pokok', tunjanganTetap: 'Tunjangan tetap', tunjanganMakan: 'Tunjangan makan',
    lembur: 'Lembur', thr: 'THR', potonganAbsen: 'Pengurang absen tanpa upah',
    bruto: 'Bruto (dibayar)',
    premiKes: 'Kesehatan pemberi (obyek pajak)', premiJkk: 'JKK (obyek pajak)', premiJkm: 'JKM (obyek pajak)',
    brutoPajak: 'Bruto pajak',
    dedKes: 'BPJS Kesehatan 1%', dedJht: 'JHT 2%', dedJp: 'JP 1%', dedPph21: 'PPh 21',
    dedTotal: 'Total potongan pekerja',
    ptgKes: 'Kesehatan 4%', ptgJht: 'JHT 3,7%', ptgJp: 'JP 2%', ptgJkk: 'JKK', ptgJkm: 'JKM 0,30%',
    ptgTotal: 'Total beban pemberi kerja',
    neto: 'Neto (take-home)'
  };

  /* ------------------------------------------------------------- BPJS --- */

  /* One employee, one month. `upah` is upah pokok + tunjangan tetap — the
   * contractual monthly wage that is reported to BPJS, not the gross actually
   * paid. That distinction matters in a month with overtime or THR: BPJS
   * premiums do not move because somebody worked a Saturday.
   *
   * Every ceiling is applied to the BASE, then the rate is applied to the
   * capped base. Applying the rate first and capping the premium afterwards
   * gives the same answer for these particular numbers but is the wrong shape:
   * it hides which ceiling bit, and the ceiling is the thing a high earner
   * asks about.
   */
  P.bpjs = function (upah, kelasRisiko, cfg) {
    cfg = cfg || {};
    if (!D.isInt(upah) || upah < 0) throw new Error('upah BPJS harus bilangan bulat >= 0: ' + upah);
    var K = D.KESEHATAN, J = D.JHT, PP = D.JP;
    var lantai = cfg.umk || K.batasBawah || 0;

    var kesDasarMentah = upah < lantai ? lantai : upah;
    var kesKena = kesDasarMentah > K.batasAtas;
    var kesDasar = kesKena ? K.batasAtas : kesDasarMentah;

    var jhtDasar = upah;                 /* PP 46/2015: no ceiling at all */

    var jpKena = upah > PP.batasAtas;
    var jpDasar = jpKena ? PP.batasAtas : upah;

    var kelas = D.JKK_KELAS[kelasRisiko];
    if (!kelas) throw new Error('kelas risiko JKK tidak dikenal: ' + kelasRisiko);

    var out = {
      upah: upah,
      kesDasar: kesDasar, kesKena: kesKena, kesBatas: K.batasAtas,
      kesPekerja: D.bpRound(kesDasar, K.bpPekerja),
      kesPemberi: D.bpRound(kesDasar, K.bpPemberi),
      jhtDasar: jhtDasar, jhtKena: false, jhtBatas: null,
      jhtPekerja: D.bpRound(jhtDasar, J.bpPekerja),
      jhtPemberi: D.bpRound(jhtDasar, J.bpPemberi),
      jpDasar: jpDasar, jpKena: jpKena, jpBatas: PP.batasAtas,
      jpPekerja: D.bpRound(jpDasar, PP.bpPekerja),
      jpPemberi: D.bpRound(jpDasar, PP.bpPemberi),
      jkkDasar: upah, jkkKelas: kelasRisiko, jkkBp: kelas.bp,
      jkk: D.bpRound(upah, kelas.bp),
      jkm: D.bpRound(upah, D.JKM.bpPemberi)
    };
    out.pekerjaTotal = out.kesPekerja + out.jhtPekerja + out.jpPekerja;
    out.pemberiTotal = out.kesPemberi + out.jhtPemberi + out.jpPemberi + out.jkk + out.jkm;
    return out;
  };

  /* ------------------------------------------------------------ lembur - */

  P.lembur = function (upahSebulan, catatan) {
    var baris = [], total = 0;
    (catatan || []).forEach(function (c) {
      var bobot = D.bobotLembur(c.jam, !!c.libur);
      var rp = D.upahLembur(upahSebulan, c.jam, !!c.libur);
      total += rp;
      baris.push({ tgl: c.tgl, jam: c.jam, libur: !!c.libur, bobot: bobot, rupiah: rp });
    });
    return { baris: baris, total: total };
  };

  /* -------------------------------------------------------------- cuti -- */

  /* Accrued minus taken, and never silently negative (invariant I6). A request
   * that would take the balance below zero is only allowed with an explicit
   * override recorded on the request itself, and the override is surfaced
   * rather than swallowed — an unpaid-leave conversion is a decision somebody
   * has to be able to point at later. */
  P.cuti = function (ctx, emp, y, m) {
    var akrual = D.cutiAkrual(emp.mulai, y, m);
    var diambil = 0, adaOverride = false, riwayat = [], tahunan = [];
    var batas = D.periode(y, m);
    (ctx.cuti || []).forEach(function (c) {
      if (c.nip !== emp.nip) return;
      if (String(c.mulai).slice(0, 7) > batas) return;
      if (c.jenis !== 'tahunan') { riwayat.push(c); return; }
      diambil += c.hari;
      if (c.override) adaOverride = true;
      tahunan.push(c);
      riwayat.push(c);
    });
    var saldo = akrual - diambil;

    /* THE AUTHORISATION SITS ON THE REQUEST THAT BREACHES THE BALANCE, NOT ON
     * THE PERSON. A flag reading "this employee has an override somewhere in
     * their file" excuses every later unauthorised negative balance they ever
     * run up — the check then works for everybody except the people who have
     * already been granted one exception, which is precisely backwards. So the
     * requests are walked in date order against a running balance and the
     * breach is pinned to the first record that pushes it below zero. */
    tahunan.sort(function (a, b) { return String(a.mulai) < String(b.mulai) ? -1 : (String(a.mulai) > String(b.mulai) ? 1 : (String(a.id) < String(b.id) ? -1 : 1)); });
    var jalan = akrual, pelanggar = null, saldoSaatMelanggar = null;
    for (var i = 0; i < tahunan.length; i++) {
      jalan -= tahunan[i].hari;
      if (jalan < 0 && !pelanggar && !tahunan[i].override) {
        pelanggar = tahunan[i];
        saldoSaatMelanggar = jalan;
      }
    }
    return {
      akrual: akrual, diambil: diambil, saldo: saldo, riwayat: riwayat,
      override: adaOverride,
      /* A negative balance is legal ONLY where the request that made it
       * negative carried an override. If one did not, the checker fails and
       * names that request. */
      negatifTanpaIzin: !!pelanggar,
      pelanggar: pelanggar, saldoSaatMelanggar: saldoSaatMelanggar
    };
  };

  P.bolehAmbilCuti = function (ctx, emp, y, m, hari, override) {
    var c = P.cuti(ctx, emp, y, m);
    if (hari <= 0) return { ok: false, alasan: 'jumlah hari cuti harus minimal 1' };
    if (c.saldo - hari < 0 && !override) {
      return {
        ok: false, saldo: c.saldo,
        alasan: 'saldo cuti ' + c.saldo + ' hari, permintaan ' + hari + ' hari. Saldo tidak boleh negatif ' +
          'tanpa override eksplisit; tanpa itu selisihnya harus dicatat sebagai cuti tanpa upah.'
      };
    }
    return { ok: true, saldo: c.saldo, sisa: c.saldo - hari, override: !!override };
  };

  /* ----------------------------------------------------- masa aktif ----- */

  /* The months of the year (y) during which this employee is on the payroll.
   * A joiner is on the payroll from the month containing their start date; a
   * leaver through the month containing their last day. */
  P.bulanAktif = function (emp, y) {
    var out = [];
    var y0 = D.tahunDari(emp.mulai), m0 = D.bulanDari(emp.mulai);
    var y1 = emp.selesai ? D.tahunDari(emp.selesai) : null;
    var m1 = emp.selesai ? D.bulanDari(emp.selesai) : null;
    if (y0 > y) return out;
    if (y1 !== null && y1 < y) return out;
    var dari = (y0 === y) ? m0 : 1;
    var sampai = (y1 === y) ? m1 : 12;
    for (var m = dari; m <= sampai; m++) out.push(m);
    return out;
  };

  /* The month that carries the annual recomputation: December, unless the
   * employee leaves earlier in the year, in which case their FINAL month.
   * Without this a leaver's withholding is frozen at the TER approximation and
   * the 1721-A1 never reconciles. */
  P.bulanKoreksi = function (emp, y) {
    var akt = P.bulanAktif(emp, y);
    return akt.length ? akt[akt.length - 1] : null;
  };

  /* --------------------------------------------------------- pra-slip --- */

  /* Everything on the payslip except PPh 21, which cannot be known until the
   * taxable gross is known and — in the correction month — until the rest of
   * the year is known. */
  P.praSlip = function (ctx, emp, y, m) {
    var cfg = ctx.cfg;
    var upahSebulan = emp.gajiPokok + emp.tunjanganTetap;
    var hk = D.hariKerja(y, m);

    /* FIRST AND LAST MONTH ARE PRORATED BY REAL WORKING DAYS.
     * Somebody who joins on 18 August did not work 1-17 August, and somebody
     * who leaves on the 12th did not work the rest of the month. Paying either
     * of them a whole month is not a rounding question: it overstates the
     * gross, it overstates the meal allowance for days nobody attended, and —
     * because the overstated gross is what the TER band and the annual Pasal 17
     * figure are read from — it overstates their PPh 21 too. The divisor is the
     * month's REAL working days, the same divisor "no work, no pay" already
     * uses below, so the two prorations cannot drift apart.
     *
     * The CONTRACTUAL wage (upahSebulan) is deliberately NOT prorated: BPJS is
     * reported on the monthly wage, the overtime hour is 1/173 of it, and THR
     * proration has its own rule in months of service. Only what is EARNED this
     * month moves. */
    var hkAktif = D.hariKerjaAktif(y, m, emp.mulai, emp.selesai);
    if (hkAktif > hk) hkAktif = hk;
    if (hkAktif < 0) hkAktif = 0;
    var prorata = hkAktif !== hk;

    var abs = (ctx.absensi[emp.nip] && ctx.absensi[emp.nip][D.periode(y, m)]) || { hadir: hkAktif, tanpaUpah: 0, cuti: 0, sakit: 0 };
    var tanpaUpah = abs.tanpaUpah || 0;

    /* Proportional reduction for days without pay, divided by the ACTUAL
     * working days of that month. Dividing by a flat 21 or 22 instead — which
     * is what most spreadsheets do — over-deducts in a 20-day February and
     * under-deducts in a 23-day month, and an employee who checks will find it. */
    var potonganAbsen = tanpaUpah > 0 ? -D.divRound(D.mul(upahSebulan, tanpaUpah), hk) : 0;

    /* Meal allowance follows attendance, and is deliberately NOT part of the
     * overtime base (Kepmenaker 102/2004 Pasal 8 ayat 2: only fixed
     * allowances count). */
    var hadir = abs.hadir === undefined ? (hkAktif - tanpaUpah - (abs.cuti || 0)) : abs.hadir;
    /* Attendance can never exceed the days the person was actually employed.
     * A stored attendance record built for a whole month must not pay a joiner
     * a meal allowance for the fortnight before they existed. */
    if (hadir > hkAktif) hadir = hkAktif;
    if (hadir < 0) hadir = 0;
    var tunjanganMakan = D.mul(cfg.makanHarian, hadir);

    var lem = P.lembur(upahSebulan, (ctx.lembur[emp.nip] && ctx.lembur[emp.nip][D.periode(y, m)]) || []);

    /* THR: one month's wage at twelve months' service, prorated below that,
     * paid in the month configured as the religious-holiday month.
     *
     * MASA KERJA IS MEASURED TO THE HARI RAYA, NOT TO THE PAYMENT DATE.
     * PP 36/2021 Pasal 2 and Pasal 3 fix the entitlement on workers with one
     * month's continuous service AS AT the Hari Raya Keagamaan; Pasal 5 ayat (4)
     * separately requires payment at the latest seven days BEFORE it. The
     * payment date is a deadline, not the measuring date, and measuring to it
     * pays nil to somebody hired in the last week before the holiday who is
     * entitled to one twelfth. Both dates are configured, and both are printed
     * on the payslip so the difference is legible. */
    var thr = 0, thrInfo = null;
    if (m === cfg.thrBulan) {
      var tglBayar = cfg.thrTanggal;
      var tglHariRaya = cfg.hariRayaTanggal || cfg.thrTanggal;
      var bulanKerja = D.bulanMasaKerja(emp.mulai, tglHariRaya);
      thr = D.thr(upahSebulan, bulanKerja);
      thrInfo = {
        tglBayar: tglBayar, tglHariRaya: tglHariRaya,
        bulanMasaKerja: bulanKerja, upahSebulan: upahSebulan,
        penuh: bulanKerja >= D.THR_BULAN_PENUH, nihil: bulanKerja < 1
      };
    }

    var bp = P.bpjs(upahSebulan, emp.risiko, cfg);

    var k = {};
    k.pokok = prorata ? D.divRound(D.mul(emp.gajiPokok, hkAktif), hk) : emp.gajiPokok;
    k.tunjanganTetap = prorata ? D.divRound(D.mul(emp.tunjanganTetap, hkAktif), hk) : emp.tunjanganTetap;
    k.tunjanganMakan = tunjanganMakan;
    k.lembur = lem.total;
    k.thr = thr;
    k.potonganAbsen = potonganAbsen;
    k.bruto = k.pokok + k.tunjanganTetap + k.tunjanganMakan + k.lembur + k.thr + k.potonganAbsen;

    k.premiKes = bp.kesPemberi;
    k.premiJkk = bp.jkk;
    k.premiJkm = bp.jkm;
    k.brutoPajak = k.bruto + k.premiKes + k.premiJkk + k.premiJkm;

    k.dedKes = bp.kesPekerja;
    k.dedJht = bp.jhtPekerja;
    k.dedJp = bp.jpPekerja;
    k.dedPph21 = 0;                        /* filled in by hitungBulan */
    k.dedTotal = 0;

    k.ptgKes = bp.kesPemberi;
    k.ptgJht = bp.jhtPemberi;
    k.ptgJp = bp.jpPemberi;
    k.ptgJkk = bp.jkk;
    k.ptgJkm = bp.jkm;
    k.ptgTotal = bp.pemberiTotal;

    k.neto = 0;

    return {
      nip: emp.nip, nama: emp.nama, jabatan: emp.jabatan, divisi: emp.divisi,
      ptkp: emp.ptkp, risiko: emp.risiko, rekening: emp.rekening, npwp: emp.npwp,
      tahun: y, bulan: m, upahSebulan: upahSebulan,
      /* THE FLOOR AS APPLIED, snapshotted onto the payslip exactly as the wage
       * and the risk class already are. cfg.umk is HR-editable master data;
       * without this, changing the minimum-wage reference makes the checker
       * recompute eleven finance-signed runs against a floor that did not exist
       * when they were computed and call them arithmetically broken. The
       * payslips were right. The checker was reading live config. */
      umkDipakai: cfg.umk || 0,
      hariKerja: hk, hariKerjaAktif: hkAktif, prorata: prorata,
      hariHadir: hadir, hariTanpaUpah: tanpaUpah, hariCuti: abs.cuti || 0, hariSakit: abs.sakit || 0,
      k: k, bpjs: bp, lemburBaris: lem.baris, thrInfo: thrInfo
    };
  };

  /* ------------------------------------------------- one month, taxed --- */

  /* `riwayat` is what the POSTED runs of this same year already withheld for
   * this employee, in month order: [{bulan, brutoPajak, jhtPekerja, jpPekerja,
   * pph21}]. In a TER month it is only used for display. In the correction
   * month it is the whole basis of the true-up. */
  P.hitungBulan = function (ctx, emp, y, m, riwayat) {
    var slip = P.praSlip(ctx, emp, y, m);
    var koreksiBulan = P.bulanKoreksi(emp, y);
    var lalu = (riwayat || []).filter(function (r) { return r.bulan < m; });

    var pajak;
    if (m === koreksiBulan) {
      var brutoTahun = slip.k.brutoPajak, jht = slip.k.dedJht, jp = slip.k.dedJp, sudah = 0;
      lalu.forEach(function (r) {
        brutoTahun += r.brutoPajak; jht += r.jhtPekerja; jp += r.jpPekerja; sudah += r.pph21;
      });
      /* DISTINCT months, not records. An adjustment run posts a second record
       * against a month, and counting records would inflate the months worked —
       * which inflates the biaya jabatan cap and under-taxes the employee. */
      var bulanUnik = {};
      lalu.forEach(function (r) { bulanUnik[r.bulan] = 1; });
      var bulanKerja = Object.keys(bulanUnik).length + 1;
      var th = T.pph21Tahunan({
        status: emp.ptkp, brutoTahun: brutoTahun, bulanKerja: bulanKerja,
        jhtPekerja: jht, jpPekerja: jp
      });
      var terSeandainya = T.terBulanan(emp.ptkp, slip.k.brutoPajak);
      pajak = {
        metode: 'setahun',
        kategori: D.kategoriTER(emp.ptkp), bp: terSeandainya.bp, band: terSeandainya.band,
        brutoPajak: slip.k.brutoPajak,
        tahunan: th, sudahDipotong: sudah, bulanKerja: bulanKerja,
        terSeandainya: terSeandainya.pph21,
        pph21: th.pph - sudah,
        restitusi: (th.pph - sudah) < 0,
        /* Named so the payslip can say it out loud: this is the difference the
         * TER approximation accumulated over the year. */
        selisihTer: th.pph - sudah - terSeandainya.pph21
      };
    } else {
      var ter = T.terBulanan(emp.ptkp, slip.k.brutoPajak);
      pajak = {
        metode: 'ter', kategori: ter.kategori, bp: ter.bp, band: ter.band,
        brutoPajak: slip.k.brutoPajak, pph21: ter.pph21,
        bulanKoreksi: koreksiBulan
      };
    }

    slip.k.dedPph21 = pajak.pph21;
    slip.k.dedTotal = slip.k.dedKes + slip.k.dedJht + slip.k.dedJp + slip.k.dedPph21;
    slip.k.neto = slip.k.bruto - slip.k.dedTotal;
    slip.pajak = pajak;
    slip.bulanKoreksi = koreksiBulan;
    return slip;
  };

  /* -------------------------------------------------------------- run --- */

  P.totalKosong = function () {
    var t = {};
    for (var i = 0; i < P.KOLOM.length; i++) t[P.KOLOM[i]] = 0;
    return t;
  };
  P.totalDari = function (slips) {
    var t = P.totalKosong();
    for (var i = 0; i < slips.length; i++) {
      for (var j = 0; j < P.KOLOM.length; j++) t[P.KOLOM[j]] += slips[i].k[P.KOLOM[j]];
    }
    return t;
  };

  P.runId = function (y, m, jenis, seri) {
    var base = 'RUN-' + y + '-' + (m < 10 ? '0' : '') + m;
    if (jenis === 'penyesuaian') return base + '-ADJ' + (seri || 1);
    return base;
  };

  /* Build the withholding history for one employee from posted runs, in month
   * order. Only runs of the SAME tax year count, and — deliberately — draft
   * runs count too: a payroll officer who has already computed November but
   * not yet had it approved still withheld nothing, but the December
   * projection must reflect the November figure they are about to approve, or
   * the two screens disagree in front of the finance approver. Adjustment runs
   * are included, which is the point of having them. */
  P.riwayatPajak = function (runs, nip, y, sebelumBulan) {
    var out = [];
    Object.keys(runs).forEach(function (id) {
      var r = runs[id];
      if (r.tahun !== y) return;
      if (sebelumBulan !== undefined && r.bulan >= sebelumBulan) return;
      for (var i = 0; i < r.slips.length; i++) {
        var s = r.slips[i];
        if (s.nip !== nip) continue;
        out.push({
          bulan: r.bulan, runId: r.id, jenis: r.jenis,
          brutoPajak: s.k.brutoPajak, jhtPekerja: s.k.dedJht, jpPekerja: s.k.dedJp,
          pph21: s.k.dedPph21, neto: s.k.neto
        });
      }
    });
    out.sort(function (a, b) { return a.bulan - b.bulan || (a.jenis === 'reguler' ? -1 : 1); });
    return out;
  };

  /* What a month has ALREADY posted for one employee, summed across every run
   * of that month — the regular run plus any adjustment runs already made. This
   * is the baseline an adjustment run measures itself against. */
  P.sudahDiposting = function (runs, nip, y, m) {
    var acc = P.totalKosong(), ada = false;
    Object.keys(runs).forEach(function (id) {
      var r = runs[id];
      if (r.tahun !== y || r.bulan !== m) return;
      for (var i = 0; i < r.slips.length; i++) {
        if (r.slips[i].nip !== nip) continue;
        ada = true;
        for (var j = 0; j < P.KOLOM.length; j++) acc[P.KOLOM[j]] += r.slips[i].k[P.KOLOM[j]];
      }
    });
    return ada ? acc : null;
  };

  /* The actual posted slip RECORDS for one employee in one month, newest run
   * last. Used where identity fields (the wage as posted, the status as
   * withheld) are needed rather than a column sum. */
  P.slipTerposting = function (runs, nip, y, m) {
    var out = [];
    Object.keys(runs).sort().forEach(function (id) {
      var r = runs[id];
      if (r.tahun !== y || r.bulan !== m) return;
      for (var i = 0; i < r.slips.length; i++) if (r.slips[i].nip === nip) out.push({ run: r, slip: r.slips[i] });
    });
    return out;
  };

  /* THE PTKP STATUS AS WITHHELD: the status recorded on the payslip of the
   * month that carries the annual recomputation, not the status master data
   * holds today. Every screen that reconciles the year must read this one, or
   * two surfaces of the app give opposite verdicts on the same fact — the
   * checker calling the ledger consistent while a report calls it a
   * discrepancy. Falls back to master data when the month is not posted yet,
   * because then there is nothing withheld to read. */
  P.statusDipakai = function (runs, emp, y) {
    var bulanK = P.bulanKoreksi(emp, y);
    if (bulanK === null) return emp.ptkp;
    var rec = P.slipTerposting(runs, emp.nip, y, bulanK);
    return rec.length ? rec[rec.length - 1].slip.ptkp : emp.ptkp;
  };

  /* Every run that touches one month, and their summed totals. THE EFFECTIVE
   * FIGURE FOR A MONTH IS THE SUM OF ITS DOCUMENTS — the regular run plus every
   * adjustment delta posted against it. A screen that shows only the regular
   * run after a correction exists is showing a superseded number, and the app
   * then reports two different annual totals depending on which tab you are
   * standing on. */
  P.efektifBulan = function (runs, y, m) {
    var t = P.totalKosong(), daftar = [], ada = false, slip = 0;
    Object.keys(runs).sort().forEach(function (id) {
      var r = runs[id];
      if (r.tahun !== y || r.bulan !== m) return;
      ada = true;
      daftar.push(r);
      slip += r.slips.length;
      for (var j = 0; j < P.KOLOM.length; j++) t[P.KOLOM[j]] += r.total[P.KOLOM[j]];
    });
    return ada ? { total: t, runs: daftar, slip: slip } : null;
  };

  /* Run payroll for one month.
   *
   * A REGULAR run refuses to touch a locked month: that is the entire value of
   * the finance approver's signature.
   *
   * AN ADJUSTMENT RUN CARRIES DELTAS, NOT REPLACEMENTS. This is the part that is
   * easy to get wrong and expensive when it is wrong. The naive version
   * recomputes the month and posts the full figures again, which leaves TWO
   * records for one month: the year then double-counts that month, the December
   * true-up reconciles against a history that never happened, and invariant I3
   * breaks. What a correction payroll actually pays is the DIFFERENCE, so every
   * column of an adjustment slip is (recomputed month − what has already been
   * posted for that month). Summing every run of the year then gives the true
   * annual figures, and I3 closes by construction. The full recomputed figures
   * are kept on the slip as `penuh` so the ceiling checks and the UI can still
   * see the month as it should now stand.
   *
   * ============ opts.pajakSaja: THE AUTO-CREATED FOLLOW-ON RUN ============
   * Correcting March moves the year's accumulated withholding, so the month
   * that carries the annual recomputation stops reconciling unless it is
   * corrected too. That follow-on run exists to RE-PLACE THE ANNUAL TRUE-UP AND
   * NOTHING ELSE. Left in ordinary delta mode it re-prices that month's
   * earnings as well, which means a wage change the officer applied to March
   * gets paid AGAIN in August and in December — months nobody named — while May
   * to July and September to November go unpaid, and the invariant badge
   * certifies the result because it IS internally consistent. Money nobody
   * authorised, moved silently, with a green tick over it.
   *
   * In pajakSaja mode every column except dedPph21 / dedTotal / neto is forced
   * to the figure already posted (delta exactly zero) and only PPh 21 moves.
   * Employees whose correction month is not this month are not touched at all,
   * and a zero delta is not written as a payslip. If the month's EARNINGS have
   * moved that is real outstanding work: it is reported by
   * P.selisihUpahTertinggal and named in the UI, so a payroll officer decides
   * deliberately which months a wage change actually applies to.
   */
  P.jalankan = function (ctx, runs, y, m, opts) {
    opts = opts || {};
    var jenis = opts.jenis || 'reguler';
    var pajakSaja = jenis === 'penyesuaian' && !!opts.pajakSaja;
    var id = P.runId(y, m, jenis, opts.seri);
    var lama = runs[id];
    if (lama && lama.status === 'terkunci') {
      throw new Error('Run ' + id + ' sudah dikunci finance approver. Perbaikan harus lewat run penyesuaian baru, bukan dengan menulis ulang run yang sudah dikunci.');
    }
    /* Recomputing a REGULAR run after an adjustment has been posted against the
     * same month would count the adjustment twice, because the regular run holds
     * full figures and the adjustment holds a delta measured against them. */
    if (jenis === 'reguler') {
      var adaAdj = Object.keys(runs).some(function (k) {
        return runs[k].tahun === y && runs[k].bulan === m && runs[k].jenis === 'penyesuaian';
      });
      if (adaAdj) {
        throw new Error('Bulan ' + m + '/' + y + ' sudah punya run penyesuaian. Menghitung ulang run reguler-nya akan menghitung penyesuaian itu dua kali; buat run penyesuaian baru untuk koreksi berikutnya.');
      }
    }
    var slips = [];
    for (var i = 0; i < ctx.karyawan.length; i++) {
      var emp = ctx.karyawan[i];
      var aktif = P.bulanAktif(emp, y);
      if (aktif.indexOf(m) < 0) continue;
      var riwayat = P.riwayatPajak(runs, emp.nip, y, m);

      if (pajakSaja) {
        /* Only the people whose annual recomputation lands in THIS month have
         * anything to re-place here, and only where this month is already
         * posted for them. */
        if (P.bulanKoreksi(emp, y) !== m) continue;
        var dasarP = P.sudahDiposting(runs, emp.nip, y, m);
        if (!dasarP) continue;
        var sp = P.slipPajakSaja(ctx, runs, emp, y, m, riwayat, dasarP);
        if (sp) slips.push(sp);
        continue;
      }

      var slip = P.hitungBulan(ctx, emp, y, m, riwayat);
      if (jenis === 'penyesuaian') {
        var dasar = P.sudahDiposting(runs, emp.nip, y, m);
        if (dasar) {
          var penuh = slip.k, delta = {};
          for (var j = 0; j < P.KOLOM.length; j++) {
            var c = P.KOLOM[j];
            delta[c] = penuh[c] - dasar[c];
          }
          slip.penuh = penuh;
          slip.dasar = dasar;
          slip.penyesuaian = true;
          slip.k = delta;
          /* NOTHING MOVED FOR THIS PERSON, so there is no payslip to issue.
           * A correction run that lists every one of sixty-two employees with
           * an all-zero delta buries the one line that carries money, and it
           * writes sixty-one no-op records into the year's withholding history
           * for every screen downstream to merge back out again. The people who
           * did not change are documented by their unchanged original payslip,
           * which is exactly where a reader would look for them. */
          var bergerak = false;
          for (var z = 0; z < P.KOLOM.length; z++) if (delta[P.KOLOM[z]] !== 0) { bergerak = true; break; }
          if (!bergerak) continue;
        } else {
          /* Nothing posted for this employee in this month — a hire the locked
           * run missed. The adjustment then IS the whole month, not a delta, and
           * saying so beats posting a delta against nothing. */
          slip.penuh = slip.k;
          slip.dasar = null;
          slip.penyesuaian = true;
          slip.baru = true;
        }
      }
      slips.push(slip);
    }
    slips.sort(function (a, b) { return a.nip < b.nip ? -1 : 1; });
    return {
      id: id, tahun: y, bulan: m, jenis: jenis,
      pajakSaja: pajakSaja,
      status: 'draft',
      /* A monotonic revision, compared against the STORED record before any
       * write, so a stale tab cannot blind-overwrite a run another tab has
       * already moved on — least of all one a finance approver has signed.
       * See simpanRun / bekukanRun in app.js. */
      rev: 1,
      slips: slips, total: P.totalDari(slips),
      dibuatOleh: opts.oleh || 'payroll',
      dibuatAt: opts.at || null,
      ditinjauOleh: null, dikunciOleh: null, dikunciAt: null,
      catatan: opts.catatan || ''
    };
  };

  /* One TAX-ONLY correction payslip: every column zero except the PPh 21 the
   * annual recomputation now demands, less the PPh 21 that month has already
   * withheld. Returns null when nothing moves, because a run full of all-zero
   * payslips is noise that buries the one line that matters. */
  P.slipPajakSaja = function (ctx, runs, emp, y, m, riwayat, dasar) {
    var lalu = (riwayat || []).filter(function (r) { return r.bulan < m; });
    var brutoTahun = dasar.brutoPajak, jht = dasar.dedJht, jp = dasar.dedJp, sudah = 0;
    lalu.forEach(function (r) {
      brutoTahun += r.brutoPajak; jht += r.jhtPekerja; jp += r.jpPekerja; sudah += r.pph21;
    });
    /* DISTINCT months, not records — the same rule hitungBulan applies, and for
     * the same reason: counting an adjustment document as an extra month of
     * work inflates the biaya jabatan cap and under-taxes the employee. */
    var bulanUnik = {};
    lalu.forEach(function (r) { bulanUnik[r.bulan] = 1; });
    var bulanKerja = Object.keys(bulanUnik).length + 1;
    var th = T.pph21Tahunan({
      status: emp.ptkp, brutoTahun: brutoTahun, bulanKerja: bulanKerja,
      jhtPekerja: jht, jpPekerja: jp
    });
    var target = th.pph - sudah;
    var delta = target - dasar.dedPph21;
    if (delta === 0) return null;

    var k = P.totalKosong();
    k.dedPph21 = delta;
    k.dedTotal = delta;
    k.neto = -delta;

    var rec = P.slipTerposting(runs, emp.nip, y, m);
    var asal = rec.length ? rec[0].slip : null;
    return {
      nip: emp.nip, nama: emp.nama, jabatan: emp.jabatan, divisi: emp.divisi,
      ptkp: emp.ptkp, risiko: emp.risiko, rekening: emp.rekening, npwp: emp.npwp,
      tahun: y, bulan: m,
      upahSebulan: asal ? asal.upahSebulan : (emp.gajiPokok + emp.tunjanganTetap),
      umkDipakai: (asal && asal.umkDipakai !== undefined) ? asal.umkDipakai : (ctx.cfg.umk || 0),
      hariKerja: asal ? asal.hariKerja : D.hariKerja(y, m),
      hariKerjaAktif: asal ? (asal.hariKerjaAktif === undefined ? null : asal.hariKerjaAktif) : null,
      prorata: false,
      hariHadir: asal ? asal.hariHadir : 0, hariTanpaUpah: 0, hariCuti: 0, hariSakit: 0,
      k: k, bpjs: null, lemburBaris: [], thrInfo: null,
      penyesuaian: true, pajakSaja: true, dasar: dasar, penuh: null,
      bulanKoreksi: m,
      pajak: {
        metode: 'setahun', pajakSaja: true,
        kategori: D.kategoriTER(emp.ptkp), bp: 0, band: null,
        brutoPajak: dasar.brutoPajak,
        tahunan: th, sudahDipotong: sudah, bulanKerja: bulanKerja,
        terSeandainya: null,
        pph21: delta, targetBulan: target, sudahBulanIni: dasar.dedPph21,
        restitusi: delta < 0, selisihTer: null
      }
    };
  };

  /* Employees for whom recomputing month m from today's master data would move
   * something OTHER than PPh 21 — a wage line, an allowance, a contribution.
   * These are exactly the corrections an auto-created tax-only follow-on
   * deliberately does NOT make, and naming them is the difference between a
   * silent payment and a decision somebody took. */
  P.selisihUpahTertinggal = function (ctx, runs, y, m) {
    var kolom = P.KOLOM.filter(function (c) { return c !== 'dedPph21' && c !== 'dedTotal' && c !== 'neto'; });
    var out = [];
    ctx.karyawan.forEach(function (emp) {
      if (P.bulanAktif(emp, y).indexOf(m) < 0) return;
      var dasar = P.sudahDiposting(runs, emp.nip, y, m);
      if (!dasar) return;
      var riwayat = P.riwayatPajak(runs, emp.nip, y, m);
      var slip;
      try { slip = P.hitungBulan(ctx, emp, y, m, riwayat); } catch (e) { return; }
      var beda = [];
      kolom.forEach(function (c) { if (slip.k[c] !== dasar[c]) beda.push(c); });
      if (beda.length) out.push({ nip: emp.nip, nama: emp.nama, bulan: m, kolom: beda, selisihBruto: slip.k.bruto - dasar.bruto });
    });
    return out;
  };

  /* Which correction months a mid-year adjustment invalidates. Adjusting March
   * changes the year's accumulated withholding, so the month that carries the
   * annual recomputation has to be adjusted too or the twelve deductions stop
   * summing to the annual figure. Correction months are PER EMPLOYEE — December
   * for most, the final month for a leaver — so this returns every distinct one
   * that sits after the month being adjusted. */
  P.koreksiTertinggal = function (ctx, runs, y, m) {
    var perlu = {};
    ctx.karyawan.forEach(function (emp) {
      var aktif = P.bulanAktif(emp, y);
      if (aktif.indexOf(m) < 0) return;
      var c = P.bulanKoreksi(emp, y);
      if (c !== null && c > m) perlu[c] = 1;
    });
    return Object.keys(perlu).map(Number).sort(function (a, b) { return a - b; });
  };

  /* Employees whose current PTKP status differs from the status recorded in the
   * slip of the month that carries their annual recomputation. That is the only
   * master-data field the annual formula reads from outside the payslip records,
   * so it is the only one that can drift without the ledger noticing. */
  P.driftInduk = function (ctx, runs) {
    var out = [];
    var ids = Object.keys(runs).sort();
    var umkKini = ctx.cfg.umk || 0;
    ctx.karyawan.forEach(function (emp) {
      var tahun = {};
      ids.forEach(function (id) {
        if (runs[id].slips.some(function (s) { return s.nip === emp.nip; })) tahun[runs[id].tahun] = 1;
      });
      Object.keys(tahun).forEach(function (ys) {
        var y = +ys, bulanK = P.bulanKoreksi(emp, y);
        if (bulanK === null) return;
        var direkam = null, umkRekam = null, upah = null, risiko = null, runId = null;
        ids.forEach(function (id) {
          var r = runs[id];
          if (r.tahun !== y || r.bulan !== bulanK) return;
          for (var i = 0; i < r.slips.length; i++) {
            var sl = r.slips[i];
            if (sl.nip !== emp.nip) continue;
            direkam = sl.ptkp; runId = r.id;
            if (sl.umkDipakai !== undefined) umkRekam = sl.umkDipakai;
            if (sl.upahSebulan !== undefined) upah = sl.upahSebulan;
            if (sl.risiko !== undefined) risiko = sl.risiko;
          }
        });
        if (direkam !== null && direkam !== emp.ptkp) {
          out.push({
            jenis: 'ptkp', nip: emp.nip, nama: emp.nama, tahun: y, bulan: bulanK,
            direkam: direkam, sekarang: emp.ptkp, runId: runId,
            label: 'status PTKP ' + direkam + ' → ' + emp.ptkp
          });
        }
        /* THE BPJS KESEHATAN WAGE FLOOR is HR-editable master data too, and it
         * is the only other input to a posted payslip that the ledger cannot
         * see move. Changing it does NOT break the payslips — they were right
         * under the floor in force when they were computed, which is why I4
         * reads the floor off the slip — but it does leave a correction
         * outstanding, and only for the people whose contribution the change
         * actually moves. A reference that no longer bites anybody is a setting
         * that changed, not work to do. */
        if (umkRekam !== null && umkRekam !== umkKini && upah !== null && risiko !== null) {
          var lama, baru;
          try {
            lama = P.bpjs(upah, risiko, { umk: umkRekam });
            baru = P.bpjs(upah, risiko, { umk: umkKini });
          } catch (e) { return; }
          if (lama.kesPekerja !== baru.kesPekerja || lama.kesPemberi !== baru.kesPemberi) {
            out.push({
              jenis: 'umk', nip: emp.nip, nama: emp.nama, tahun: y, bulan: bulanK,
              direkam: umkRekam, sekarang: umkKini, runId: runId,
              kesLama: lama.kesPekerja, kesBaru: baru.kesPekerja,
              label: 'lantai UMK ' + D.rupiah(umkRekam) + ' → ' + D.rupiah(umkKini) +
                ' (Kesehatan pekerja ' + D.rupiah(lama.kesPekerja) + ' → ' + D.rupiah(baru.kesPekerja) + ')'
            });
          }
        }
      });
    });
    return out;
  };

  /* ==================================================== invariants ====== *
   * Recomputed from the raw payslip records held in the runs, never from a
   * cached total, and re-run on every state change. The header badge shows the
   * count; the Uji tab shows every line. A check that cannot fail is
   * decoration, so tests.js feeds this function deliberately corrupted runs
   * and asserts that each specific line goes red.
   */
  P.periksa = function (ctx, runs) {
    var cek = [];
    function add(nama, ok, pesan) { cek.push({ nama: nama, ok: !!ok, pesan: pesan || '' }); }

    var ids = Object.keys(runs).sort();
    var semuaSlip = [];
    ids.forEach(function (id) { runs[id].slips.forEach(function (s) { semuaSlip.push({ run: runs[id], slip: s }); }); });

    /* ---- I1: neto = bruto - potongan pekerja, per payslip, per month ---- */
    var i1Gagal = [], i1n = 0;
    semuaSlip.forEach(function (x) {
      var k = x.slip.k;
      var ded = k.dedKes + k.dedJht + k.dedJp + k.dedPph21;
      i1n++;
      if (k.dedTotal !== ded) i1Gagal.push(x.slip.nip + ' ' + x.run.id + ': dedTotal ' + k.dedTotal + ' != ' + ded);
      else if (k.neto !== k.bruto - ded) i1Gagal.push(x.slip.nip + ' ' + x.run.id + ': neto ' + k.neto + ' != bruto ' + k.bruto + ' - potongan ' + ded);
    });
    add('I1 neto = bruto − potongan pekerja, tiap slip tiap bulan', i1Gagal.length === 0,
      i1Gagal.length ? i1Gagal.slice(0, 3).join(' · ') : i1n + ' slip diperiksa, semuanya tepat ke rupiah');

    /* ---- I1b: gross is exactly the sum of its own earning lines --------- */
    var i1bGagal = [];
    semuaSlip.forEach(function (x) {
      var k = x.slip.k, s = 0;
      P.KOLOM_PENDAPATAN.forEach(function (c) { s += k[c]; });
      if (k.bruto !== s) i1bGagal.push(x.slip.nip + ' ' + x.run.id + ': bruto ' + k.bruto + ' != jumlah baris ' + s);
    });
    add('I1b bruto = jumlah seluruh baris pendapatan (termasuk pengurang absen)', i1bGagal.length === 0,
      i1bGagal.length ? i1bGagal.slice(0, 3).join(' · ') : 'setiap bruto terurai penuh ke baris-barisnya');

    /* ---- I2: run total = sum of payslips, every column ------------------ */
    var i2Gagal = [], i2n = 0;
    ids.forEach(function (id) {
      var r = runs[id];
      var t = P.totalDari(r.slips);
      P.KOLOM.forEach(function (c) {
        i2n++;
        if (r.total[c] !== t[c]) i2Gagal.push(id + '.' + c + ': ' + r.total[c] + ' != ' + t[c]);
      });
    });
    add('I2 total run = jumlah slip-nya, untuk setiap kolom', i2Gagal.length === 0,
      i2Gagal.length ? i2Gagal.slice(0, 3).join(' · ') : i2n + ' kolom×run direkonsiliasi (' + ids.length + ' run × ' + P.KOLOM.length + ' kolom)');

    /* ---- I3: twelve monthly PPh 21 === the annual calculation ----------- *
     * Only for employees whose ENTIRE employment window inside the year is
     * covered by posted runs — an incomplete year has nothing to reconcile
     * against yet, and saying so is more honest than passing vacuously and
     * calling it green. */
    var i3Gagal = [], i3Lengkap = 0, i3Belum = 0;
    ctx.karyawan.forEach(function (emp) {
      var tahun = {};
      ids.forEach(function (id) { if (runs[id].slips.some(function (s) { return s.nip === emp.nip; })) tahun[runs[id].tahun] = 1; });
      Object.keys(tahun).forEach(function (ys) {
        var y = +ys;
        var aktif = P.bulanAktif(emp, y);
        var riwayat = P.riwayatPajak(runs, emp.nip, y);
        var bulanAda = {};
        riwayat.forEach(function (r) { bulanAda[r.bulan] = 1; });
        var lengkap = aktif.every(function (m) { return bulanAda[m]; });
        if (!lengkap) { i3Belum++; return; }
        i3Lengkap++;
        var bruto = 0, jht = 0, jp = 0, dipotong = 0;
        riwayat.forEach(function (r) { bruto += r.brutoPajak; jht += r.jhtPekerja; jp += r.jpPekerja; dipotong += r.pph21; });
        /* THE STATUS AS WITHHELD, not the status as it stands today.
         *
         * Every other input to this recomputation comes out of the payslip
         * records themselves, so it is self-consistent by construction. PTKP
         * status is the one input that comes from master data, and HR is allowed
         * to change it at any time. When they do, the ledger is NOT broken — the
         * twelve deductions still add up to the liability that was computed from
         * the facts on record — there is a CORRECTION OUTSTANDING. Reading the
         * current master status here would turn an ordinary HR edit into a red
         * invariant, which teaches the reader that the badge means nothing.
         * The drift itself is a separate check below, and the UI surfaces it as
         * a pending adjustment run rather than as an arithmetic failure. */
        var statusDipakai = P.statusDipakai(runs, emp, y);
        var th = T.pph21Tahunan({
          status: statusDipakai, brutoTahun: bruto, bulanKerja: aktif.length,
          jhtPekerja: jht, jpPekerja: jp
        });
        if (dipotong !== th.pph) {
          i3Gagal.push(emp.nip + ' ' + y + ': dipotong ' + dipotong + ' != setahun ' + th.pph + ' (selisih ' + (dipotong - th.pph) + ')');
        }
      });
    });
    add('I3 Σ PPh 21 bulanan = PPh 21 setahun, per karyawan', i3Gagal.length === 0,
      i3Gagal.length ? i3Gagal.slice(0, 3).join(' · ')
        : i3Lengkap + ' tahun-karyawan lengkap direkonsiliasi ke rupiah' + (i3Belum ? ', ' + i3Belum + ' tahun belum lengkap (belum ada apa-apa untuk direkonsiliasi)' : ''));

    /* ---- I4: every BPJS ceiling applied at the right level -------------- */
    var i4Gagal = [], i4Cap = 0, i4Pajak = 0;
    var kolomBukanPajak = P.KOLOM.filter(function (c) { return c !== 'dedPph21' && c !== 'dedTotal' && c !== 'neto'; });
    semuaSlip.forEach(function (x) {
      /* An adjustment slip's columns are DELTAS, and a delta of a capped
       * contribution is not itself a capped contribution. The ceiling check
       * therefore runs against the recomputed FULL month the adjustment was
       * derived from, which is exactly the figure the ceiling applies to. */
      var s = x.slip, k = s.penuh || s.k;

      /* A TAX-ONLY correction slip has no contribution columns at all — that is
       * its whole definition — so the ceiling arithmetic has nothing to check.
       * What it DOES get checked for is that definition: every column except
       * PPh 21, the deduction total and net must be exactly zero. An
       * auto-created correction that moved a wage line would be caught here. */
      if (s.pajakSaja) {
        i4Pajak++;
        for (var z = 0; z < kolomBukanPajak.length; z++) {
          if (s.k[kolomBukanPajak[z]] !== 0) {
            i4Gagal.push(s.nip + ' ' + x.run.id + ' koreksi pajak-saja menggerakkan ' + kolomBukanPajak[z] + ' sebesar ' + s.k[kolomBukanPajak[z]]);
          }
        }
        if (s.k.dedTotal !== s.k.dedPph21) i4Gagal.push(s.nip + ' ' + x.run.id + ' koreksi pajak-saja: dedTotal bukan hanya PPh 21');
        return;
      }

      /* THE FLOOR AS APPLIED WHEN THE SLIP WAS COMPUTED, not the floor master
       * data holds today. cfg.umk is an editable setting; recomputing eleven
       * signed runs against a value that is allowed to move afterwards accuses
       * correct payslips of arithmetic they never did. upahSebulan and risiko
       * were already snapshotted for exactly this reason; the floor was the one
       * BPJS input still being read live, and it was the one input with no
       * drift handling. Older records without the field fall back to the
       * current config, which is what they were computed under. */
      var cfgSlip = (s.umkDipakai === undefined) ? ctx.cfg : { umk: s.umkDipakai };
      var ulang = P.bpjs(s.upahSebulan, s.risiko, cfgSlip);
      if (ulang.kesPekerja !== k.dedKes) i4Gagal.push(s.nip + ' kesehatan pekerja ' + k.dedKes + ' != ' + ulang.kesPekerja);
      if (ulang.jpPekerja !== k.dedJp) i4Gagal.push(s.nip + ' JP pekerja ' + k.dedJp + ' != ' + ulang.jpPekerja);
      if (ulang.jhtPekerja !== k.dedJht) i4Gagal.push(s.nip + ' JHT pekerja ' + k.dedJht + ' != ' + ulang.jhtPekerja);
      if (s.upahSebulan > D.KESEHATAN.batasAtas) {
        i4Cap++;
        if (k.dedKes !== D.bpRound(D.KESEHATAN.batasAtas, D.KESEHATAN.bpPekerja)) i4Gagal.push(s.nip + ' di atas plafon Kesehatan tetapi iurannya bukan nilai plafon');
        if (k.ptgKes !== D.bpRound(D.KESEHATAN.batasAtas, D.KESEHATAN.bpPemberi)) i4Gagal.push(s.nip + ' plafon Kesehatan pemberi tidak rata');
      }
      if (s.upahSebulan > D.JP.batasAtas) {
        if (k.dedJp !== D.bpRound(D.JP.batasAtas, D.JP.bpPekerja)) i4Gagal.push(s.nip + ' di atas plafon JP tetapi iurannya bukan nilai plafon');
        if (k.ptgJp !== D.bpRound(D.JP.batasAtas, D.JP.bpPemberi)) i4Gagal.push(s.nip + ' plafon JP pemberi tidak rata');
      }
      /* JHT has no ceiling, so it MUST keep rising. A ceiling accidentally
       * copied onto JHT is the mirror-image bug and would pass a
       * cap-is-applied test. */
      if (k.dedJht !== D.bpRound(s.upahSebulan, D.JHT.bpPekerja)) i4Gagal.push(s.nip + ' JHT tampak diplafon padahal PP 46/2015 tidak punya plafon');
    });
    add('I4 setiap plafon BPJS diterapkan di ambang yang benar dan rata di atasnya', i4Gagal.length === 0,
      i4Gagal.length ? i4Gagal.slice(0, 3).join(' · ')
        : 'plafon Kesehatan ' + D.rupiah(D.KESEHATAN.batasAtas) + ' dan JP ' + D.rupiah(D.JP.batasAtas) + ' menggigit di ' + i4Cap + ' slip; JHT tanpa plafon; lantai dibaca dari tiap slip, bukan dari konfigurasi hidup' + (i4Pajak ? '; ' + i4Pajak + ' slip koreksi pajak-saja terbukti tidak menggerakkan satu pun kolom selain PPh 21' : ''));

    /* ---- I5: employer cost never touches the employee ------------------- */
    var i5Gagal = [];
    P.KOLOM_PEMBERI.forEach(function (c) {
      if (P.KOLOM_POTONGAN.indexOf(c) >= 0) i5Gagal.push('kolom ' + c + ' muncul di dua daftar sekaligus');
    });
    semuaSlip.forEach(function (x) {
      var k = x.slip.k, jum = 0;
      P.KOLOM_PEMBERI.forEach(function (c) { jum += k[c]; });
      if (k.ptgTotal !== jum) i5Gagal.push(x.slip.nip + ' ptgTotal ' + k.ptgTotal + ' != ' + jum);
      /* The load-bearing half: net pay must be reconstructible WITHOUT any
       * employer column. If an employer contribution had leaked into the
       * deduction side, this arithmetic would not close. */
      if (k.neto !== k.bruto - (k.dedKes + k.dedJht + k.dedJp + k.dedPph21)) {
        i5Gagal.push(x.slip.nip + ' neto tidak dapat disusun ulang tanpa kolom pemberi kerja');
      }
    });
    add('I5 iuran pemberi kerja tidak pernah jadi potongan pekerja dan tidak mengubah neto', i5Gagal.length === 0,
      i5Gagal.length ? i5Gagal.slice(0, 3).join(' · ')
        : P.KOLOM_PEMBERI.length + ' kolom pemberi kerja ditotal terpisah; neto tersusun ulang tanpa menyentuhnya');

    /* ---- I6: leave balance = accrued - taken, never silently negative --- */
    var i6Gagal = [], i6n = 0;
    ctx.karyawan.forEach(function (emp) {
      var c = P.cuti(ctx, emp, ctx.cfg.tahun, 12);
      i6n++;
      if (c.saldo !== c.akrual - c.diambil) i6Gagal.push(emp.nip + ': saldo ' + c.saldo + ' != akrual ' + c.akrual + ' - diambil ' + c.diambil);
      if (c.negatifTanpaIzin) {
        i6Gagal.push(emp.nip + ': permintaan ' + (c.pelanggar ? c.pelanggar.id + ' (' + c.pelanggar.hari + ' hari, mulai ' + c.pelanggar.mulai + ')' : '') +
          ' mendorong saldo cuti ke ' + c.saldoSaatMelanggar + ' tanpa override tercatat pada permintaan itu');
      }
    });
    add('I6 saldo cuti = akrual − diambil; tidak ada satu permintaan pun yang membuatnya negatif tanpa override', i6Gagal.length === 0,
      i6Gagal.length ? i6Gagal.slice(0, 3).join(' · ') : i6n + ' saldo cuti konsisten, izin diperiksa per permintaan');

    /* ---- I7: no float anywhere in any money field ----------------------- */
    var i7Gagal = [], i7n = 0;
    semuaSlip.forEach(function (x) {
      P.KOLOM.forEach(function (c) {
        i7n++;
        if (!D.isInt(x.slip.k[c])) i7Gagal.push(x.slip.nip + '.' + c + ' = ' + x.slip.k[c]);
      });
      if (!D.isInt(x.slip.upahSebulan)) i7Gagal.push(x.slip.nip + '.upahSebulan = ' + x.slip.upahSebulan);
    });
    ids.forEach(function (id) {
      P.KOLOM.forEach(function (c) {
        i7n++;
        if (!D.isInt(runs[id].total[c])) i7Gagal.push(id + '.total.' + c + ' = ' + runs[id].total[c]);
      });
    });
    add('I7 tidak ada satu pun nilai uang berupa pecahan', i7Gagal.length === 0,
      i7Gagal.length ? i7Gagal.slice(0, 3).join(' · ') : i7n + ' medan uang diperiksa, semuanya bilangan bulat');

    /* ---- locked runs are immutable -------------------------------------- */
    var lockGagal = [];
    ids.forEach(function (id) {
      var r = runs[id];
      if (r.status !== 'terkunci') return;
      if (!r.dikunciOleh) lockGagal.push(id + ' terkunci tanpa nama finance approver');
      var t = P.totalDari(r.slips);
      P.KOLOM.forEach(function (c) { if (r.total[c] !== t[c]) lockGagal.push(id + ' terkunci tetapi totalnya sudah tidak cocok dengan slipnya'); });
    });
    add('Run terkunci punya penandatangan dan totalnya masih cocok dengan slipnya', lockGagal.length === 0,
      lockGagal.length ? lockGagal.slice(0, 3).join(' · ') : ids.filter(function (id) { return runs[id].status === 'terkunci'; }).length + ' run terkunci utuh');

    var gagal = cek.filter(function (c) { return !c.ok; }).length;
    return {
      cek: cek, total: cek.length, gagal: gagal, lulus: cek.length - gagal,
      slip: semuaSlip.length, run: ids.length, tahunLengkap: i3Lengkap,
      /* OUTSTANDING WORK, deliberately NOT an invariant and deliberately not
       * counted in `gagal`. An invariant is something that must always be true;
       * "HR has not changed anybody's PTKP status since the reconciliation month
       * was posted" is a workflow state, and folding it into the invariant count
       * would turn an ordinary HR edit into a red badge — which teaches the
       * reader that the badge means nothing. The UI shows this as a to-do with
       * the adjustment run one click away. */
      drift: P.driftInduk(ctx, runs)
    };
  };

  /* ======================================================== peran ======= *
   * Three roles, because a payroll run that one person can both compute and
   * approve is not controlled at all. The separation is the control:
   *
   *   hr       master data. Hires, salary changes, PTKP status, risk class,
   *            leave decisions. May NOT run or approve payroll.
   *   payroll  computes and reviews runs, opens payslips, creates adjustment
   *            runs. May NOT approve one, and may NOT change master data —
   *            otherwise "correct the November run" becomes "quietly raise
   *            somebody's salary".
   *   finance  approves and LOCKS a run, and nothing else. May not edit master
   *            data and may not compute a run, so the figure being signed for
   *            is one somebody else produced.
   *
   * A locked run is immutable. Corrections require a NEW adjustment run, which
   * carries its own approval, so the correction is visible rather than being a
   * silent overwrite of a signed document.
   */
  P.PERAN = {
    hr: {
      label: 'HR admin', mark: 'HR',
      izin: ['karyawan.ubah', 'karyawan.tambah', 'cuti.putuskan', 'cuti.override', 'konfig.ubah'],
      catatan: 'Menguasai data induk. Tidak boleh menjalankan maupun menyetujui payroll.'
    },
    payroll: {
      label: 'Payroll officer', mark: 'PAY',
      izin: ['run.jalankan', 'run.tinjau', 'run.penyesuaian', 'run.hapusDraft'],
      catatan: 'Menghitung dan meninjau. Tidak boleh mengunci run dan tidak boleh mengubah data induk.'
    },
    finance: {
      label: 'Finance approver', mark: 'FIN',
      izin: ['run.kunci', 'run.bukaTinjauan'],
      catatan: 'Menyetujui dan mengunci. Tidak boleh menghitung run maupun mengubah data induk.'
    }
  };
  P.DAFTAR_PERAN = ['hr', 'payroll', 'finance'];

  P.boleh = function (peran, aksi) {
    var r = P.PERAN[peran];
    if (!r) return false;
    return r.izin.indexOf(aksi) >= 0;
  };
  /* The refusal carries its reason, phrased for the person who was refused
   * rather than for the developer. A permission dialog that says "denied" and
   * nothing else teaches the user only that the software dislikes them. */
  P.tolakan = function (peran, aksi) {
    var r = P.PERAN[peran];
    var punya = P.DAFTAR_PERAN.filter(function (p) { return P.boleh(p, aksi); })
      .map(function (p) { return P.PERAN[p].label; });
    return 'Peran ' + (r ? r.label : peran) + ' tidak berwenang melakukan "' + aksi + '". ' +
      (punya.length ? 'Yang berwenang: ' + punya.join(', ') + '. ' : '') + (r ? r.catatan : '');
  };

  /* State machine for one run. draft -> ditinjau -> terkunci, and nothing goes
   * backwards out of terkunci. */
  P.STATUS_RUN = ['draft', 'ditinjau', 'terkunci'];

  P.tinjau = function (run, peran, oleh) {
    if (!P.boleh(peran, 'run.tinjau')) throw new Error(P.tolakan(peran, 'run.tinjau'));
    if (run.status === 'terkunci') throw new Error('Run ' + run.id + ' sudah dikunci; peninjauan ulang tidak mengubah apa pun.');
    run.status = 'ditinjau';
    run.ditinjauOleh = oleh || peran;
    return run;
  };

  P.kunci = function (run, peran, oleh) {
    if (!P.boleh(peran, 'run.kunci')) throw new Error(P.tolakan(peran, 'run.kunci'));
    if (run.status === 'terkunci') throw new Error('Run ' + run.id + ' sudah terkunci.');
    if (run.status !== 'ditinjau') {
      throw new Error('Run ' + run.id + ' belum ditinjau payroll officer. Finance approver menandatangani angka yang sudah ditinjau orang lain, bukan draft yang belum dibaca siapa pun.');
    }
    /* The signature is over the payslips, so the total is recomputed from them
     * at the moment of locking. Signing a cached total is signing nothing. */
    run.total = P.totalDari(run.slips);
    run.status = 'terkunci';
    run.dikunciOleh = oleh || peran;
    run.dikunciAt = new Date().toISOString().slice(0, 10);
    return run;
  };

  P.bolehTulisRun = function (run) {
    return !run || run.status !== 'terkunci';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
