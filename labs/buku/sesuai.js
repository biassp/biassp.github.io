/*!
 * Buku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Buku — sesuai.js
 * The four adjusting-entry types, each computed from a register rather than
 * typed in, each carrying the arithmetic that produced it so a reader can check
 * the figure instead of trusting it.
 *
 *   1. PENYUSUTAN. Straight line, monthly, from jadwalPenyusutan(). The period's
 *      entry books the sum of the monthly slices that fall inside the period —
 *      which for an asset bought in May is eight months, not twelve, and not a
 *      full year prorated by an approximation.
 *   2. BEBAN DIBAYAR DI MUKA. Prepaid rent and insurance: the expired months
 *      move out of the asset and into the expense; the unexpired months stay on
 *      the balance sheet. The allocation across months is alokasi(), so twelve
 *      monthly slices of Rp 36.000.000 sum to Rp 36.000.000 and not to
 *      Rp 35.999.996.
 *   3. PENDAPATAN DITERIMA DI MUKA. The earned months move out of the liability
 *      and into revenue. Note what does NOT move: the PPN keluaran, which was
 *      already recognised when the payment was received, because that is when a
 *      faktur pajak is due on an advance.
 *   4. BEBAN YANG MASIH HARUS DIBAYAR. December's salary, December's loan
 *      interest and December's electricity bill belong to December even though
 *      the cash leaves in January. Without them the year's profit is overstated
 *      and three liabilities are missing from the balance sheet.
 *
 * Every proposal is a `rencana`: a balanced set of lines, a title, the formula,
 * and the amount. Nothing here posts anything. The UI posts, through
 * L.tambah(), which is the same door every other entry goes through — so an
 * adjusting entry that failed to balance would be refused exactly like a
 * hand-keyed one, and the suite proves that by feeding it a broken register.
 */
(function (root) {
  'use strict';

  var D = root.BUKU_DOMAIN;
  var L = root.BUKU_LEDGER;
  var A = {};
  root.BUKU_SESUAI = A;

  /* Which months of a `bulan`-month contract fall inside [dari..sampai], and
   * what each of those months is worth. The slices come from alokasi() over
   * equal weights, so the whole contract sums to its exact value and the
   * remainder rupiah are distributed rather than lost or doubled. */
  A.irisKontrak = function (jumlah, mulai, bulan, dariPeriode, sampaiPeriode) {
    var bobot = [], i;
    for (i = 0; i < bulan; i++) bobot.push(1);
    var bagian = D.alokasi(jumlah, bobot);
    var baris = [], terpakai = 0, dalam = 0, total = 0;
    for (i = 0; i < bulan; i++) {
      var p = D.tambahBulan(mulai, i);
      var di = (!dariPeriode || p >= dariPeriode) && (!sampaiPeriode || p <= sampaiPeriode);
      baris.push({ periode: p, jumlah: bagian[i], dalamPeriode: di });
      total = D.add(total, bagian[i]);
      if (di) { terpakai = D.add(terpakai, bagian[i]); dalam++; }
    }
    return { baris: baris, terpakai: terpakai, bulanDalamPeriode: dalam, total: total, sisa: total - terpakai };
  };

  /* ------------------------------------------------------------ penyusutan */

  A.rencanaPenyusutan = function (db, dari, sampai) {
    var dariP = D.periodeDari(dari), sampaiP = D.periodeDari(sampai);
    var perAkum = {}, rincian = [], total = 0;
    db.reg.aset.forEach(function (a) {
      var jumlah = D.penyusutanRentang(a.jadwal, dariP, sampaiP);
      var bulan = a.jadwal.baris.filter(function (b) { return b.periode >= dariP && b.periode <= sampaiP; }).length;
      rincian.push({
        aset: a, jumlah: jumlah, bulan: bulan,
        akumSebelum: D.akumSampai(a.jadwal, D.tambahBulan(dariP, -1)),
        akumSesudah: D.akumSampai(a.jadwal, sampaiP),
        rumus: '(' + D.rupiah(a.harga) + ' − ' + D.rupiah(a.residu) + ') ÷ ' + a.umurBulan + ' bulan × ' + bulan + ' bulan'
      });
      if (jumlah === 0) return;
      perAkum[a.akunAkum] = D.add(perAkum[a.akunAkum] || 0, jumlah);
      total = D.add(total, jumlah);
    });

    var baris = [];
    if (total > 0) {
      baris.push({ akun: '5204', d: total, k: 0, catatan: 'penyusutan garis lurus ' + rincian.length + ' aset' });
      Object.keys(perAkum).sort().forEach(function (kode) {
        baris.push({ akun: kode, d: 0, k: perAkum[kode], catatan: 'akumulasi bertambah' });
      });
    }

    return {
      id: 'JP-PENYUSUTAN', jenis: 'penyesuaian', tgl: sampai,
      judul: 'Penyusutan aset tetap',
      subjudul: 'Garis lurus, per bulan, dari jadwal masing-masing aset',
      dasar: 'Beban penyusutan didebet, akumulasi penyusutan dikredit. Akumulasi adalah akun kontra aset: ' +
        'ia mengurangi nilai aset di neraca tanpa menghapus harga perolehannya, sehingga harga perolehan dan ' +
        'penyusutan tetap bisa dibaca berdampingan.',
      rincian: rincian, jumlah: total, baris: baris, kosong: total === 0
    };
  };

  /* --------------------------------------------------- beban dibayar di muka */

  A.rencanaDibayarDimuka = function (db, dari, sampai) {
    var dariP = D.periodeDari(dari), sampaiP = D.periodeDari(sampai);
    var rincian = [], baris = [], total = 0;
    db.reg.muka.forEach(function (k) {
      var iris = A.irisKontrak(k.jumlah, k.mulai, k.bulan, dariP > k.mulai ? dariP : k.mulai, sampaiP);
      if (iris.terpakai === 0) return;
      rincian.push({
        kontrak: k, terpakai: iris.terpakai, sisa: iris.sisa, bulan: iris.bulanDalamPeriode, iris: iris,
        rumus: D.rupiah(k.jumlah) + ' ÷ ' + k.bulan + ' bulan × ' + iris.bulanDalamPeriode + ' bulan terpakai'
      });
      baris.push({ akun: k.akunBeban, d: iris.terpakai, k: 0, catatan: k.nama });
      baris.push({ akun: k.akunMuka, d: 0, k: iris.terpakai, catatan: 'sisa ' + D.rupiah(iris.sisa) + ' tetap aset' });
      total = D.add(total, iris.terpakai);
    });
    return {
      id: 'JP-DIMUKA', jenis: 'penyesuaian', tgl: sampai,
      judul: 'Beban dibayar di muka yang sudah terpakai',
      subjudul: 'Bagian masa manfaat yang lewat berpindah dari aset ke beban',
      dasar: 'Kas keluar lebih dulu, manfaatnya menyusul. Yang sudah lewat adalah beban periode ini; yang belum ' +
        'lewat masih aset dan tetap di neraca. Tanpa jurnal ini, laba periode pembayaran terlalu kecil dan laba ' +
        'periode berikutnya terlalu besar.',
      rincian: rincian, jumlah: total, baris: baris, kosong: total === 0
    };
  };

  /* ---------------------------------------- pendapatan diterima di muka */

  A.rencanaDiterimaDimuka = function (db, dari, sampai) {
    var dariP = D.periodeDari(dari), sampaiP = D.periodeDari(sampai);
    var rincian = [], baris = [], total = 0;
    db.reg.tangguh.forEach(function (k) {
      var iris = A.irisKontrak(k.jumlah, k.mulai, k.bulan, dariP > k.mulai ? dariP : k.mulai, sampaiP);
      if (iris.terpakai === 0) return;
      rincian.push({
        kontrak: k, diakui: iris.terpakai, sisa: iris.sisa, bulan: iris.bulanDalamPeriode, iris: iris,
        rumus: D.rupiah(k.jumlah) + ' ÷ ' + k.bulan + ' bulan × ' + iris.bulanDalamPeriode + ' bulan dikerjakan'
      });
      baris.push({ akun: k.akunTangguh, d: iris.terpakai, k: 0, catatan: 'kewajiban jasa berkurang' });
      baris.push({ akun: k.akunPendapatan, d: 0, k: iris.terpakai, catatan: k.nama });
      total = D.add(total, iris.terpakai);
    });
    return {
      id: 'JP-TANGGUH', jenis: 'penyesuaian', tgl: sampai,
      judul: 'Pendapatan diterima di muka yang sudah menjadi hak',
      subjudul: 'Bagian pekerjaan yang sudah dikerjakan berpindah dari liabilitas ke pendapatan',
      dasar: 'Uang diterima lebih dulu, jasanya menyusul. PPN keluarannya TIDAK ikut dipindah di sini: faktur ' +
        'pajaknya sudah terbit saat pembayaran diterima, karena saat terutangnya PPN atas uang muka adalah saat ' +
        'pembayaran, bukan saat pekerjaan selesai.',
      rincian: rincian, jumlah: total, baris: baris, kosong: total === 0
    };
  };

  /* -------------------------------- beban yang masih harus dibayar */

  A.rencanaAkrual = function (db, dari, sampai) {
    var dariP = D.periodeDari(dari), sampaiP = D.periodeDari(sampai);
    var rincian = [], baris = [], total = 0;
    (db.reg.akrual || []).forEach(function (k) {
      if (k.periode < dariP || k.periode > sampaiP) return;
      rincian.push({ akrual: k, jumlah: k.jumlah, rumus: 'beban ' + D.periodeNama(k.periode) + ', kas keluar periode berikutnya' });
      baris.push({ akun: k.akunBeban, d: k.jumlah, k: 0, catatan: k.nama });
      baris.push({ akun: k.akunUtang, d: 0, k: k.jumlah, catatan: 'utang beban' });
      total = D.add(total, k.jumlah);
    });
    return {
      id: 'JP-AKRUAL', jenis: 'penyesuaian', tgl: sampai,
      judul: 'Beban yang masih harus dibayar',
      subjudul: 'Beban sudah terjadi, kas belum keluar',
      dasar: 'Basis akrual: beban diakui saat terjadi, bukan saat dibayar. Setiap baris di sini menambah beban ' +
        'periode ini DAN menambah liabilitas di neraca — kalau hanya salah satunya bertambah, entrinya tidak akan ' +
        'seimbang dan mesinnya akan menolaknya.',
      rincian: rincian, jumlah: total, baris: baris, kosong: total === 0
    };
  };

  /* ------------------------------- reklasifikasi bagian lancar pinjaman */

  /* The fifth of the classification adjustments, and the one that fixes a
   * balance sheet that BALANCED but classified a liability wrongly.
   *
   * SAK EMKM / SAK ETAP: a liability expected to be settled within twelve months
   * of the reporting date is CURRENT. At 31 December 2025 the bank loan stands at
   * Rp 60.000.000 against instalments of Rp 5.000.000 a month — twelve more
   * payments, so every rupiah of it is current, and presenting all of it under
   * liabilitas jangka panjang understates current liabilities by the whole
   * balance. Working capital as presented was Rp 60.000.000 too high and the
   * current ratio 4,38 instead of 3,55. No total moved, which is precisely why no
   * invariant went red: the accounting equation does not care which subtotal a
   * liability sits in.
   *
   * The figure is DERIVED, at the reporting date, from the register and the live
   * ledger balances — never typed:
   *
   *   sisa pokok          = saldo 2201 + saldo 2106   (the two halves of one loan)
   *   bagian lancar wajib = min(sisa pokok, angsuran × 12)
   *   selisih             = bagian lancar wajib − saldo 2106
   *
   * so the proposal is idempotent for free: post it and the difference is zero,
   * and the plan reports itself as having nothing to do. Both accounts are arus F,
   * so the entry nets to zero inside the financing bucket and the cash flow
   * statement does not move. */
  A.rencanaReklasPinjaman = function (db, dari, sampai) {
    var rincian = [], baris = [], total = 0;
    (db.reg.pinjaman || []).forEach(function (k) {
      var sisaPanjang = L.saldoAkun(db.buku, k.akunPokok, { sampai: sampai }).saldo;
      var sisaLancar = L.saldoAkun(db.buku, k.akunLancar, { sampai: sampai }).saldo;
      var sisaPokok = D.add(sisaPanjang, sisaLancar);
      var jatuh12 = D.mul(k.angsuran, 12);
      var wajibLancar = Math.min(sisaPokok, jatuh12);
      if (wajibLancar < 0) wajibLancar = 0;
      var selisih = wajibLancar - sisaLancar;
      /* Instalments remaining, ceiling, WITHOUT a bare division: this file makes a
       * claim that there is no division operator outside divRound/divFloor/alokasi,
       * and a month count is not an exception worth making. */
      var tenorSisa = (k.angsuran > 0 && sisaPokok > 0) ? D.divFloor(sisaPokok + k.angsuran - 1, k.angsuran) : 0;
      rincian.push({
        pinjaman: k, jumlah: selisih, sisaPokok: sisaPokok,
        sisaPanjang: sisaPanjang, sisaLancar: sisaLancar,
        wajibLancar: wajibLancar, tenorSisa: tenorSisa,
        sisa: sisaPokok - wajibLancar,
        rumus: 'sisa pokok ' + D.rupiah(sisaPokok) + ' (' + tenorSisa + ' angsuran lagi) → jatuh tempo ≤ 12 bulan ' +
          'min(' + D.rupiah(sisaPokok) + '; 12 × ' + D.rupiah(k.angsuran) + ') = ' + D.rupiah(wajibLancar) +
          ', sudah di ' + k.akunLancar + ' ' + D.rupiah(sisaLancar)
      });
      if (selisih === 0) return;
      if (selisih > 0) {
        baris.push({ akun: k.akunPokok, d: selisih, k: 0, catatan: 'keluar dari jangka panjang' });
        baris.push({ akun: k.akunLancar, d: 0, k: selisih, catatan: 'jatuh tempo dalam 12 bulan' });
      } else {
        baris.push({ akun: k.akunLancar, d: -selisih, k: 0, catatan: 'melebihi 12 angsuran ke depan' });
        baris.push({ akun: k.akunPokok, d: 0, k: -selisih, catatan: 'kembali ke jangka panjang' });
      }
      total = D.add(total, Math.abs(selisih));
    });
    return {
      id: 'JP-REKLASPINJAMAN', jenis: 'penyesuaian', tgl: sampai,
      judul: 'Reklasifikasi bagian lancar utang bank jangka panjang',
      subjudul: 'Angsuran yang jatuh tempo dalam dua belas bulan pindah ke liabilitas jangka pendek',
      dasar: 'Liabilitas yang diperkirakan diselesaikan dalam dua belas bulan sejak tanggal pelaporan adalah ' +
        'liabilitas JANGKA PENDEK (SAK EMKM/SAK ETAP). Angkanya dihitung dari register pinjaman dan saldo buku ' +
        'besar pada tanggal laporan, bukan diketik: sisa pokok dibandingkan dengan dua belas angsuran ke depan, ' +
        'dan hanya selisihnya yang dipindahkan. Karena kedua akun berklasifikasi arus kas pendanaan, entri ini ' +
        'tidak menggerakkan satu rupiah pun di laporan arus kas — yang berubah hanya penyajian di neraca, dan ' +
        'itulah yang memang salah sebelumnya.',
      rincian: rincian, jumlah: total, baris: baris, kosong: baris.length === 0
    };
  };

  /* ------------------------------------------- PPh final atas selisih dasar */

  /* The fifth proposal, and the one that only exists because of a real
   * interaction between two of the others.
   *
   * PPh final UMKM is 0,5% of peredaran bruto, and the monthly instalments in
   * the seeded book were computed on the turnover as it stood at each month end.
   * Then JP-TANGGUH recognises Rp 8.000.000 of the customer advance as revenue —
   * so the year's accounting turnover rises by Rp 8.000.000 after the monthly
   * instalments were already booked, and the expense in the ledger is Rp 40.000
   * short of 0,5% of the turnover the income statement now reports.
   *
   * Rather than paper over it, the shortfall is computed from the LIVE book and
   * offered as its own adjusting entry. Two consequences worth noticing:
   *   - Before JP-TANGGUH is posted the shortfall is zero and this proposal is
   *     empty, so it appears only once the adjustment that causes it is in.
   *   - It is recomputed from the book on every render, so posting it twice is
   *     impossible: the second time round the shortfall is already zero.
   *
   * The honest caveat, stated in the UI too: there is a respectable argument
   * that the 0,5% on an advance was due in the month the money arrived, since
   * the final regime is administered on monthly gross receipts. This entry takes
   * the accounting-turnover view and the Pajak tab shows both figures side by
   * side rather than picking one silently. */
  A.rencanaPphFinal = function (db, dari, sampai) {
    var lr = L.labaRugi(db.buku, dari, sampai);
    /* The base is the year's turnover LESS the Rp 500.000.000 that PP 55/2022
     * pasal 60 ayat (2) does not subject to tax for a wajib pajak orang pribadi.
     * Charging 0,5% of the whole of peredaran bruto overstated the year's tax
     * expense by exactly Rp 2.500.000 and understated net profit by the same. */
    var dasar = D.pphFinalDasar(0, lr.peredaranBruto);
    var seharusnya = dasar.kena > 0 ? D.pphFinal(dasar.kena) : 0;
    var dibukukan = 0;
    var post = L.postingan(L.pilih(db.buku, { dari: dari, sampai: sampai, kecualiJenis: ['penutup'] }));
    D.AKUN.forEach(function (ak) {
      if (!ak.pajakFinal) return;
      var r = post[ak.kode];
      if (!r) return;
      dibukukan = D.add(dibukukan, r.d - r.k);
    });
    var kurang = seharusnya - dibukukan;
    var baris = [];
    if (kurang > 0) {
      baris = [
        { akun: '5301', d: kurang, k: 0, catatan: '0,5% atas peredaran bruto yang baru diakui' },
        { akun: '2105', d: 0, k: kurang, catatan: 'kurang setor PPh final, dibayar bersama masa berikutnya' }
      ];
    } else if (kurang < 0) {
      baris = [
        { akun: '2105', d: -kurang, k: 0, catatan: 'kelebihan setor PPh final' },
        { akun: '5301', d: 0, k: -kurang, catatan: 'koreksi beban pajak final' }
      ];
    }
    return {
      id: 'JP-PPHFINAL', jenis: 'penyesuaian', tgl: sampai,
      judul: 'PPh final UMKM atas selisih dasar peredaran bruto',
      subjudul: '0,5% × peredaran bruto menurut Laba Rugi, dikurangi yang sudah diangsur bulanan',
      dasar: 'Peredaran bruto setahun menurut Laba Rugi ' + D.rupiah(lr.peredaranBruto) + ' − bagian yang tidak ' +
        'dikenai PPh ' + D.rupiah(dasar.bebasDipakai) + ' = dasar kena ' + D.rupiah(dasar.kena) + ' × 0,5% = ' +
        D.rupiah(seharusnya) + '. Sudah dibebankan lewat angsuran bulanan ' + D.rupiah(dibukukan) + '. ' +
        'Selisihnya muncul karena jurnal penyesuaian pendapatan diterima di muka menambah peredaran bruto ' +
        'setelah angsuran bulanannya dihitung. Tarif 0,5% dikenakan atas PEREDARAN BRUTO, bukan atas laba — ' +
        'jadi angka ini tidak berubah kalau bebannya berubah. ' + D.PPH_FINAL_BEBAS_DASAR,
      seharusnya: seharusnya, dibukukan: dibukukan, kurang: kurang,
      bebasDipakai: dasar.bebasDipakai, dasarKena: dasar.kena, bebas: D.PPH_FINAL_BEBAS,
      peredaranBruto: lr.peredaranBruto,
      rincian: [], jumlah: Math.abs(kurang), baris: baris, kosong: baris.length === 0
    };
  };

  /* ----------------------------------------------------------- semuanya */

  /* Order matters: the PPh final true-up reads a turnover figure that
   * JP-TANGGUH changes, so it comes last. Posting them out of order is not
   * wrong, only slower — every proposal is recomputed from the live book, so a
   * shortfall that appears after a later posting simply shows up again. */
  A.semuaRencana = function (db, dari, sampai) {
    return [
      A.rencanaPenyusutan(db, dari, sampai),
      A.rencanaDibayarDimuka(db, dari, sampai),
      A.rencanaDiterimaDimuka(db, dari, sampai),
      A.rencanaAkrual(db, dari, sampai),
      A.rencanaReklasPinjaman(db, dari, sampai),
      A.rencanaPphFinal(db, dari, sampai)
    ];
  };

  /* Posts every non-empty proposal, then recomputes and does it again, because
   * one proposal's figure depends on another's having been posted. Two passes is
   * enough — the second pass is what catches JP-PPHFINAL — and the loop stops as
   * soon as a pass posts nothing. */
  A.postingSemua = function (db, dari, sampai, opts) {
    var diposting = [], lewat = 0;
    while (lewat < 3) {
      var adaBaru = false;
      var rencana = A.semuaRencana(db, dari, sampai);
      for (var i = 0; i < rencana.length; i++) {
        var r = rencana[i];
        if (r.kosong) continue;
        if (A.sudahDiposting(db.buku, r, dari, sampai)) continue;
        diposting.push({ rencana: r, entry: A.posting(db.buku, r, opts) });
        adaBaru = true;
      }
      if (!adaBaru) break;
      lewat++;
    }
    return diposting;
  };

  /* Has this adjustment already been posted? Derived by looking for a posted
   * penyesuaian entry whose memo carries the plan id — not by a flag on the
   * plan, because the plan is recomputed from the register on every render and a
   * flag on it would not survive a reload. */
  A.sudahDiposting = function (buku, rencana, dari, sampai) {
    var pen = L.pilih(buku, { dari: dari, sampai: sampai, hanyaJenis: ['penyesuaian'] });
    for (var i = 0; i < pen.length; i++) {
      var e = pen[i];
      if (!e.memo || e.memo.indexOf('[' + rencana.id + ']') < 0) continue;
      /* STILL IN EFFECT, not merely EVER POSTED. The book is append-only, so a
       * reversed adjustment is still sitting there with its memo intact — and its
       * reversal copies that memo and resolves to jenisEfektif 'penyesuaian', so
       * a plain memo scan found two matches for an adjustment that had been
       * cancelled. The panel then reported every plan posted and disabled every
       * Posting button while accumulated depreciation sat Rp 24.000.000 short of
       * the schedule the register itself computes, with no way back.
       *
       * Two rules fix it. A pembalik is a cancellation, never a posting. And a
       * posting that has itself been reversed is no longer in effect — so it is
       * skipped, the plan re-proposes itself from the register, and the Posting
       * button comes back. */
      if (e.jenis === 'pembalik') continue;
      if (L.pembalikDari(buku, e.id)) continue;
      return e;
    }
    return null;
  };

  A.posting = function (buku, rencana, opts) {
    if (rencana.kosong) throw new Error('Rencana ' + rencana.id + ' tidak menghasilkan baris apa pun.');
    return L.tambah(buku, {
      tgl: rencana.tgl, jenis: 'penyesuaian',
      memo: '[' + rencana.id + '] ' + rencana.judul,
      baris: rencana.baris,
      oleh: opts && opts.oleh, peran: opts && opts.peran, sumber: opts && opts.sumber
    }, opts || {});
  };

  /* ------------------------------------------- pemeriksaan jadwal penyusutan */

  /* The schedule check, separate from the invariant checker because it is about
   * the register rather than the book: every schedule must sum to EXACTLY cost
   * minus residual, the book value must land exactly on the residual, and the
   * register's total cost must equal the ledger balance of the asset account it
   * claims to describe. That last one is the check that catches an asset bought
   * during the year and never added to the register — the failure that makes a
   * fixed-asset note quietly disagree with the balance sheet. */
  A.periksaJadwal = function (db) {
    var cek = [];
    function ok(nama, lulus, pesan) { cek.push({ nama: nama, ok: !!lulus, pesan: pesan || '' }); }

    db.reg.aset.forEach(function (a) {
      var j = a.jadwal;
      var jum = j.baris.reduce(function (s, b) { return D.add(s, b.jumlah); }, 0);
      ok(a.id + ': jadwal berjumlah tepat harga perolehan − residu',
        jum === a.harga - a.residu,
        D.rupiah(jum) + ' vs ' + D.rupiah(a.harga - a.residu) + (jum === a.harga - a.residu ? '' : ' — selisih ' + D.rupiah(jum - (a.harga - a.residu))));
      ok(a.id + ': nilai buku pada baris terakhir tepat sama dengan nilai residu',
        j.baris[j.baris.length - 1].nilaiBuku === a.residu,
        D.rupiah(j.baris[j.baris.length - 1].nilaiBuku) + ' vs residu ' + D.rupiah(a.residu));
      ok(a.id + ': jumlah baris jadwal = umur dalam bulan',
        j.baris.length === a.umurBulan, j.baris.length + ' vs ' + a.umurBulan);
      var pecah = j.baris.filter(function (b) { return !D.isInt(b.jumlah); });
      ok(a.id + ': setiap angsuran penyusutan bilangan bulat', pecah.length === 0,
        pecah.length ? pecah.length + ' baris pecahan' : a.umurBulan + ' baris, semuanya bulat');
      var beda = j.baris.map(function (b) { return b.jumlah; });
      var min = Math.min.apply(null, beda), max = Math.max.apply(null, beda);
      ok(a.id + ': selisih antar angsuran paling banyak satu rupiah (sisa pembagian dibagikan, bukan ditumpuk)',
        max - min <= 1, 'terkecil ' + D.rupiah(min) + ', terbesar ' + D.rupiah(max));
    });

    /* Register versus ledger. */
    var perAkun = {};
    db.reg.aset.forEach(function (a) { perAkun[a.akunAset] = D.add(perAkun[a.akunAset] || 0, a.harga); });
    Object.keys(perAkun).sort().forEach(function (kode) {
      var saldo = L.saldoAkun(db.buku, kode, {}).saldo;
      ok('Total harga perolehan di register = saldo akun ' + kode + ' ' + D.akun(kode).nama,
        saldo === perAkun[kode],
        'register ' + D.rupiah(perAkun[kode]) + ' vs buku besar ' + D.rupiah(saldo));
    });

    /* ACCUMULATED depreciation against the schedule, which is the check the cost
     * comparison above cannot make. Reversing a posted depreciation adjustment
     * leaves 1602 short of the schedule while 1601 is untouched, so a register
     * check that only ever looks at cost stays green through exactly the failure
     * it is supposed to catch. Only asserted once the adjustment for the period is
     * actually in effect — before that the ledger is legitimately behind the
     * schedule, and the Penyesuaian panel says so. */
    var sampaiP = D.periodeDari(db.akhir);
    var rp = A.rencanaPenyusutan(db, db.awal, db.akhir);
    var terpasang = !!A.sudahDiposting(db.buku, rp, db.awal, db.akhir);
    var perAkum = {};
    db.reg.aset.forEach(function (a) {
      perAkum[a.akunAkum] = D.add(perAkum[a.akunAkum] || 0, D.akumSampai(a.jadwal, sampaiP));
    });
    Object.keys(perAkum).sort().forEach(function (kode) {
      var saldo = L.saldoAkun(db.buku, kode, { sampai: db.akhir }).saldo;
      if (terpasang) {
        ok('Akumulasi penyusutan menurut jadwal = saldo akun ' + kode + ' ' + D.akun(kode).nama +
          ' (jurnal penyesuaian penyusutan sudah berlaku)',
          saldo === perAkum[kode],
          'jadwal ' + D.rupiah(perAkum[kode]) + ' vs buku besar ' + D.rupiah(saldo) +
          (saldo === perAkum[kode] ? '' : ' — selisih ' + D.rupiah(saldo - perAkum[kode])));
      } else {
        ok('Akumulasi penyusutan di ' + kode + ' belum melampaui jadwal (penyesuaian belum diposting)',
          saldo <= perAkum[kode],
          'buku besar ' + D.rupiah(saldo) + ' ≤ jadwal ' + D.rupiah(perAkum[kode]));
      }
    });

    /* Loan register versus ledger, and the classification the register implies.
     * The two halves of one loan must add up to the register's outstanding
     * principal, and once the reclassification is in effect the current half must
     * be exactly the next twelve instalments. */
    (db.reg.pinjaman || []).forEach(function (k) {
      var sisaPanjang = L.saldoAkun(db.buku, k.akunPokok, { sampai: db.akhir }).saldo;
      var sisaLancar = L.saldoAkun(db.buku, k.akunLancar, { sampai: db.akhir }).saldo;
      var sisaPokok = D.add(sisaPanjang, sisaLancar);
      var dibayar = D.mul(k.angsuran, 12);
      var seharusnya = k.pokokAwal - dibayar;
      ok(k.id + ': sisa pokok di buku besar (' + k.akunPokok + ' + ' + k.akunLancar + ') = pokok awal − angsuran setahun',
        sisaPokok === seharusnya,
        D.rupiah(sisaPokok) + ' vs ' + D.rupiah(k.pokokAwal) + ' − ' + D.rupiah(dibayar) + ' = ' + D.rupiah(seharusnya));
      var wajib = Math.min(sisaPokok, D.mul(k.angsuran, 12));
      var rk = A.rencanaReklasPinjaman(db, db.awal, db.akhir);
      var reklasAda = !!A.sudahDiposting(db.buku, rk, db.awal, db.akhir);
      if (reklasAda || rk.kosong) {
        ok(k.id + ': bagian yang jatuh tempo dalam 12 bulan benar-benar tersaji sebagai liabilitas jangka pendek',
          sisaLancar === wajib,
          'akun lancar ' + k.akunLancar + ' ' + D.rupiah(sisaLancar) + ' vs seharusnya ' + D.rupiah(wajib));
      } else {
        ok(k.id + ': reklasifikasi bagian lancar masih menunggu diposting, selisihnya ' + D.rupiah(rk.jumlah),
          true, 'akun lancar ' + k.akunLancar + ' ' + D.rupiah(sisaLancar) + ', seharusnya ' + D.rupiah(wajib));
      }
    });

    var lulus = cek.filter(function (c) { return c.ok; }).length;
    return { cek: cek, total: cek.length, lulus: lulus, gagal: cek.length - lulus };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
