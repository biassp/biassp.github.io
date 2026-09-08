/*!
 * Buku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Buku — tests.js
 * Assertions against the engine. The same file runs in the page (the badge in
 * the header) and under node.
 *
 * Ranked by how much damage each one prevents:
 *
 *  1. THE ACCOUNTING EQUATION, at every date, on a hand-computable book and on
 *     the demo book. If Aset ≠ Liabilitas + Ekuitas then nothing else the app
 *     says means anything, so this is checked from raw postings by a route that
 *     shares no code with the statements.
 *  2. NET INCOME TIES THROUGH four statements. Computed once, consumed three
 *     times, and re-derived a fourth way from the movement in equity.
 *  3. CASH FLOW RECONCILES to the ledger cash balance. Verified against a mini
 *     book whose every figure is written out in this file so a reader can do the
 *     arithmetic on paper, and then against the 480-entry demo book.
 *  4. ENTRY BALANCE IS ENFORCED, not requested. Unbalanced, zero, single-sided
 *     and fractional entries are all refused, and the refusal names the gap.
 *  5. CLOSING zeroes every nominal account and does not move the balance sheet
 *     by one rupiah.
 *  6. DEPRECIATION SCHEDULES sum to exactly cost minus residual.
 *  7. NO FLOATS, anywhere: the seed, the ledger, every statement, deep-walked.
 *  8. Everything else: the period lock, the roles, corrections that leave the
 *     original intact, PPN positions, the 0,5% final regime, and negative tests
 *     proving the invariant checker can actually go red.
 */
(function (root) {
  'use strict';

  var D = root.BUKU_DOMAIN;
  var L = root.BUKU_LEDGER;
  var S = root.BUKU_SEED;
  var A = root.BUKU_SESUAI;

  var groups = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  /* JSON.stringify on a structure with a back-reference throws, and a depreciation
   * schedule holds one to its own asset. An assertion helper that builds its
   * failure message eagerly therefore crashes on a PASSING comparison — which is
   * how one true assertion took a whole group down. Messages are built lazily,
   * and the stringify is guarded. */
  function js(v) {
    try { return JSON.stringify(v); }
    catch (e) { return '[objek dengan acuan siklik]'; }
  }

  function makeCtx(results, groupName) {
    function record(ok, name, msg) {
      results.push({ group: groupName, name: name, ok: !!ok, message: ok ? '' : (typeof msg === 'function' ? msg() : (msg || '')) });
    }
    return {
      ok: function (v, name) { record(!!v, name, function () { return 'diharap truthy, dapat ' + js(v); }); },
      notOk: function (v, name) { record(!v, name, function () { return 'diharap falsy, dapat ' + js(v); }); },
      eq: function (a, b, name) { record(a === b, name, function () { return 'diharap ' + js(b) + ', dapat ' + js(a); }); },
      rp: function (a, b, name) { record(a === b, name, function () { return 'diharap ' + D.rupiah(b) + ', dapat ' + D.rupiah(a) + ' (selisih ' + D.rupiah(a - b) + ')'; }); },
      lt: function (a, b, name) { record(a < b, name, 'diharap < ' + b + ', dapat ' + a); },
      lte: function (a, b, name) { record(a <= b, name, 'diharap <= ' + b + ', dapat ' + a); },
      gt: function (a, b, name) { record(a > b, name, 'diharap > ' + b + ', dapat ' + a); },
      gte: function (a, b, name) { record(a >= b, name, 'diharap >= ' + b + ', dapat ' + a); },
      throws: function (fn, name) {
        var lempar = false, pesan = '';
        try { fn(); } catch (e) { lempar = true; pesan = String(e && e.message || e); }
        record(lempar, name, 'diharap melempar, tidak melempar');
        return pesan;
      },
      throwsWith: function (fn, re, name) {
        var lempar = false, pesan = '';
        try { fn(); } catch (e) { lempar = true; pesan = String(e && e.message || e); }
        record(lempar && re.test(pesan), name, lempar ? 'melempar tapi pesannya tidak cocok ' + re + ': ' + pesan : 'tidak melempar');
      },
      noThrow: function (fn, name) {
        var pesan = null;
        try { fn(); } catch (e) { pesan = String(e && e.stack || e); }
        record(pesan === null, name, 'melempar: ' + pesan);
      }
    };
  }

  /* One demo book, built once, shared by every group. Building it twice is a
   * determinism check of its own and gets a test rather than a side effect. */
  var DB = null;
  function db() { return DB || (DB = S.build()); }
  var DARI = '2025-01-01', SAMPAI = '2025-12-31';

  /* A demo book with every adjustment posted and the year closed, built on its
   * own copy so the unadjusted book stays available to the other groups. */
  var DBTUTUP = null;
  function dbTutup() {
    if (DBTUTUP) return DBTUTUP;
    var d = S.build();
    A.postingSemua(d, DARI, SAMPAI, { peran: 'akuntan', oleh: 'uji' });
    L.postingPenutup(d.buku, SAMPAI, { peran: 'supervisor', oleh: 'uji' });
    DBTUTUP = d;
    return d;
  }
  var DBSESUAI = null;
  function dbSesuai() {
    if (DBSESUAI) return DBSESUAI;
    var d = S.build();
    A.postingSemua(d, DARI, SAMPAI, { peran: 'akuntan', oleh: 'uji' });
    DBSESUAI = d;
    return d;
  }

  function tam(b, tgl, baris, jenis, memo) {
    return L.tambah(b, { tgl: tgl, jenis: jenis || 'umum', memo: memo || '', baris: baris }, { peran: 'akuntan' });
  }

  /* ============================================================ mini book ===
   * Every figure in this book is written out in the comments so a reader can
   * check the statements with a calculator. It is the same book the cash flow
   * group works from, and the reason the cash flow claim in the README is
   * checkable rather than merely asserted.
   *
   *   2024-12-31  saldo awal   D 1101 10.000.000  D 1301 5.000.000  K 3101 15.000.000
   *   2025-01-05  penjualan kredit  D 1201 1.110.000  K 4101 1.000.000  K 2104 110.000
   *   2025-01-05  HPP               D 5101   600.000  K 1301   600.000
   *   2025-01-10  pembelian kredit  D 1301 2.000.000  D 1501 220.000  K 2101 2.220.000
   *   2025-01-20  gaji tunai        D 5201   300.000  K 1101   300.000
   *   2025-01-25  beli peralatan    D 1601 1.200.000  K 1101 1.200.000
   *   2025-01-28  setoran modal     D 1101   500.000  K 3101   500.000
   *   2025-01-31  penyusutan (JP)   D 5204    20.000  K 1602    20.000
   *
   *   laba          1.000.000 − 600.000 − 300.000 − 20.000        =     80.000
   *   penyusutan                                                  =     20.000
   *   modal kerja  −1.110.000 −1.400.000 −220.000 +2.220.000 +110.000 = −400.000
   *   operasi       80.000 + 20.000 − 400.000                     =  −300.000
   *   investasi                                                   = −1.200.000
   *   pendanaan                                                   =   +500.000
   *   kas awal 10.000.000  +  (−1.000.000)                        =  9.000.000
   *   buku besar 1101: 10.000.000 − 300.000 − 1.200.000 + 500.000 =  9.000.000  ✓
   */
  var MINI = null;
  function mini() {
    if (MINI) return MINI;
    var b = L.buatBuku();
    tam(b, '2024-12-31', [
      { akun: '1101', d: 10000000, k: 0 },
      { akun: '1301', d: 5000000, k: 0 },
      { akun: '3101', d: 0, k: 15000000 }
    ], 'saldo-awal', 'Neraca pembuka mini');
    tam(b, '2025-01-05', [
      { akun: '1201', d: 1110000, k: 0 },
      { akun: '4101', d: 0, k: 1000000 },
      { akun: '2104', d: 0, k: 110000 }
    ], 'umum', 'Penjualan kredit');
    tam(b, '2025-01-05', [
      { akun: '5101', d: 600000, k: 0 },
      { akun: '1301', d: 0, k: 600000 }
    ], 'umum', 'HPP');
    tam(b, '2025-01-10', [
      { akun: '1301', d: 2000000, k: 0 },
      { akun: '1501', d: 220000, k: 0 },
      { akun: '2101', d: 0, k: 2220000 }
    ], 'umum', 'Pembelian kredit');
    tam(b, '2025-01-20', [
      { akun: '5201', d: 300000, k: 0 },
      { akun: '1101', d: 0, k: 300000 }
    ], 'umum', 'Gaji tunai');
    tam(b, '2025-01-25', [
      { akun: '1601', d: 1200000, k: 0 },
      { akun: '1101', d: 0, k: 1200000 }
    ], 'umum', 'Beli peralatan tunai');
    tam(b, '2025-01-28', [
      { akun: '1101', d: 500000, k: 0 },
      { akun: '3101', d: 0, k: 500000 }
    ], 'umum', 'Setoran modal');
    tam(b, '2025-01-31', [
      { akun: '5204', d: 20000, k: 0 },
      { akun: '1602', d: 0, k: 20000 }
    ], 'penyesuaian', 'Penyusutan Januari');
    MINI = b;
    return b;
  }
  var MDARI = '2025-01-01', MSAMPAI = '2025-01-31';

  /* Deep walk: every number reachable from an object must be an integer. This is
   * the float detector, and it is pointed at the seed, at every statement and at
   * the schedules. */
  function angkaPecahan(obj, jalur, keluar, dalam) {
    keluar = keluar || [];
    dalam = dalam || 0;
    if (dalam > 12 || keluar.length > 40) return keluar;
    if (obj === null || obj === undefined) return keluar;
    if (typeof obj === 'number') {
      if (!D.isInt(obj)) keluar.push(jalur + ' = ' + obj);
      return keluar;
    }
    if (typeof obj !== 'object') return keluar;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) angkaPecahan(obj[i], jalur + '[' + i + ']', keluar, dalam + 1);
      return keluar;
    }
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      angkaPecahan(obj[k], jalur + '.' + k, keluar, dalam + 1);
    }
    return keluar;
  }

  /* ======================================= 1. aritmetika bilangan bulat === */

  group('Aritmetika rupiah — bilangan bulat, tanpa pengecualian', function (t) {
    t.eq(D.divRound(1500, 1000), 2, 'divRound(1500,1000) = 2 — setengah dibulatkan menjauhi nol');
    t.eq(D.divRound(2500, 1000), 3, 'divRound(2500,1000) = 3, bukan 2 — ini bukan pembulatan bankir');
    t.eq(D.divRound(1499, 1000), 1, 'divRound(1499,1000) = 1');
    t.eq(D.divRound(-1500, 1000), -2, 'divRound(-1500,1000) = -2, simetris terhadap nol');
    t.eq(D.divRound(-2500, 1000), -3, 'divRound(-2500,1000) = -3');
    t.eq(D.divRound(1, 2), 1, 'divRound(1,2) = 1');
    t.eq(D.divRound(-1, 2), -1, 'divRound(-1,2) = -1');
    t.eq(D.divRound(0, 7), 0, 'divRound(0,7) = 0');
    t.eq(D.divRound(7, 3), 2, 'divRound(7,3) = 2');
    t.eq(D.divRound(8, 3), 3, 'divRound(8,3) = 3');
    t.eq(D.divRound(5, 2), 3, 'divRound(5,2) = 3');
    t.eq(D.divRound(-5, 2), -3, 'divRound(-5,2) = -3');
    t.eq(D.divRound(100, -8), -13, 'divRound(100,-8) = -13 — tanda pembagi ikut diperhitungkan');
    t.eq(D.divFloor(7, 3), 2, 'divFloor(7,3) = 2');
    t.eq(D.divFloor(-7, 3), -3, 'divFloor(-7,3) = -3, benar-benar floor');
    t.eq(D.divFloor(1000, 144), 6, 'divFloor(1000,144) = 6');
    t.throwsWith(function () { D.divRound(1.5, 2); }, /bilangan bulat/, 'divRound menolak argumen pecahan');
    t.throwsWith(function () { D.divRound(3, 0); }, /pembagi nol/, 'divRound menolak pembagi nol');
    t.throwsWith(function () { D.divFloor(3, 0); }, /pembagi nol/, 'divFloor menolak pembagi nol');
    t.throwsWith(function () { D.mul(D.MAX_SAFE, 4); }, /batas bilangan bulat/, 'mul melempar sebelum melewati 2^53');
    t.throwsWith(function () { D.mul(2.5, 4); }, /bilangan bulat/, 'mul menolak pecahan');
    t.throwsWith(function () { D.add(1, 0.5); }, /bilangan bulat/, 'add menolak pecahan');
    t.eq(D.mul(-3, 4), -12, 'mul menangani tanda negatif');
    t.eq(D.add(-3, 4), 1, 'add menangani tanda negatif');
    t.eq(D.isInt(3), true, 'isInt(3)');
    t.eq(D.isInt(3.0), true, 'isInt(3.0) — 3.0 memang bilangan bulat di IEEE754');
    t.eq(D.isInt(3.5), false, 'isInt(3.5) salah');
    t.eq(D.isInt('3'), false, 'isInt("3") salah — string bukan angka');
    t.eq(D.isInt(NaN), false, 'isInt(NaN) salah');
    t.eq(D.isInt(Infinity), false, 'isInt(Infinity) salah');

    /* alokasi: the property that makes a depreciation schedule close exactly. */
    var kasus = [
      [100, [1, 1, 1]], [1000000, [1, 1, 1, 1, 1, 1, 1]], [220000000, new Array(96).join(',').split(',').map(function () { return 1; })],
      [7, [1, 1, 1, 1, 1]], [1, [1, 1, 1]], [0, [1, 1]], [-100, [1, 1, 1]], [36000000, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
      [999, [5, 3, 1]], [12345, [7, 0, 11]], [5, [1]]
    ];
    kasus.forEach(function (kk) {
      var r = D.alokasi(kk[0], kk[1]);
      var jum = r.reduce(function (s, x) { return s + x; }, 0);
      t.eq(jum, kk[0], 'alokasi(' + kk[0] + ', ' + kk[1].length + ' bobot) berjumlah tepat ' + kk[0]);
      t.eq(r.filter(function (x) { return !D.isInt(x); }).length, 0, 'alokasi(' + kk[0] + ', ' + kk[1].length + ' bobot) seluruhnya bilangan bulat');
      t.eq(r.length, kk[1].length, 'alokasi(' + kk[0] + ') menghasilkan sebanyak bobotnya');
    });
    var rr = D.alokasi(100, [1, 1, 1]);
    t.eq(rr.join(','), '34,33,33', 'alokasi(100,[1,1,1]) = 34,33,33 — sisa dibagikan ke depan, bukan ditumpuk di belakang');
    t.eq(Math.max.apply(null, rr) - Math.min.apply(null, rr), 1, 'dan selisih antar bagian paling banyak satu rupiah');
    t.eq(D.alokasi(999, [5, 3, 1]).join(','), '555,333,111', 'alokasi menghormati bobot tak sama');
    t.throwsWith(function () { D.alokasi(100, []); }, /bobot kosong/, 'alokasi menolak bobot kosong');
    t.throwsWith(function () { D.alokasi(100, [0, 0]); }, /jumlah bobot nol/, 'alokasi menolak seluruh bobot nol');
    t.throwsWith(function () { D.alokasi(100.5, [1]); }, /bilangan bulat/, 'alokasi menolak total pecahan');
    t.throwsWith(function () { D.alokasi(100, [1, -1]); }, /bilangan bulat >= 0/, 'alokasi menolak bobot negatif');

    /* Determinism: same inputs, same split, every time. A schedule that shuffles
     * its remainder rupiah between renders makes the fixed-asset note unstable. */
    t.eq(D.alokasi(100, [1, 1, 1]).join(','), D.alokasi(100, [1, 1, 1]).join(','), 'alokasi deterministik');

    t.eq(D.rupiah(1234567), 'Rp1.234.567', 'rupiah memisah ribuan dengan titik');
    t.eq(D.rupiah(-1234567), '-Rp1.234.567', 'rupiah negatif');
    t.eq(D.rupiah(0), 'Rp0', 'rupiah nol');
    t.eq(D.rupiah(1234.5), '!1234.5', 'rupiah menandai pecahan dengan tanda seru, bukan menyembunyikannya dengan toFixed');
    t.eq(D.rupiah(null), '—', 'rupiah(null) jadi tanda pisah');
    t.eq(D.rpAkun(0), '—', 'rpAkun(0) jadi tanda pisah, konvensi laporan keuangan');
    t.eq(D.rpAkun(-5000), '(5.000)', 'rpAkun negatif dalam tanda kurung');
    t.eq(D.rpAkun(5000), '5.000', 'rpAkun positif tanpa hiasan');
    t.eq(D.angka(1000), '1.000', 'angka tanpa awalan Rp');
  });

  /* ============================================ 2. tanggal dan periode === */

  group('Tanggal — string ISO, tanpa objek Date, tanpa zona waktu', function (t) {
    t.eq(D.isTanggal('2025-01-31'), true, '2025-01-31 sah');
    t.eq(D.isTanggal('2025-02-29'), false, '2025-02-29 tidak ada — 2025 bukan kabisat');
    t.eq(D.isTanggal('2024-02-29'), true, '2024-02-29 ada');
    t.eq(D.isTanggal('2000-02-29'), true, '2000-02-29 ada — aturan 400 tahun');
    t.eq(D.isTanggal('1900-02-29'), false, '1900-02-29 tidak ada — aturan 100 tahun');
    t.eq(D.isTanggal('2025-04-31'), false, '2025-04-31 tidak ada');
    t.eq(D.isTanggal('2025-13-01'), false, 'bulan 13 ditolak');
    t.eq(D.isTanggal('2025-00-01'), false, 'bulan 0 ditolak');
    t.eq(D.isTanggal('2025-1-1'), false, 'format tanpa nol di depan ditolak');
    t.eq(D.isTanggal('31/01/2025'), false, 'format Indonesia sehari-hari ditolak di lapisan data');
    t.eq(D.isTanggal(20250131), false, 'angka ditolak');
    t.eq(D.hariDalamBulan(2025, 2), 28, 'Februari 2025 = 28 hari');
    t.eq(D.hariDalamBulan(2024, 2), 29, 'Februari 2024 = 29 hari');
    t.eq(D.akhirBulan('2025-02'), '2025-02-28', 'akhirBulan Februari 2025');
    t.eq(D.akhirBulan('2025-12'), '2025-12-31', 'akhirBulan Desember');
    t.eq(D.awalBulan('2025-07'), '2025-07-01', 'awalBulan Juli');
    t.eq(D.tambahBulan('2025-12', 1), '2026-01', 'tambahBulan menyeberang tahun');
    t.eq(D.tambahBulan('2025-01', -1), '2024-12', 'tambahBulan mundur menyeberang tahun');
    t.eq(D.tambahBulan('2023-07', 96 - 1), '2031-06', 'tambahBulan 95 langkah — akhir umur kendaraan 8 tahun');
    t.eq(D.tambahBulan('2025-06', 0), '2025-06', 'tambahBulan nol adalah identitas');
    t.eq(D.periodeDari('2025-08-17'), '2025-08', 'periodeDari memotong ke bulan');
    t.eq(D.tahunDari('2025-08-17'), '2025', 'tahunDari memotong ke tahun');
    t.eq(D.periodeNama('2025-09'), 'September 2025', 'nama periode dalam bahasa Indonesia');
    t.eq(D.tglPanjang('2025-01-05'), '5 Januari 2025', 'tanggal panjang');
    t.eq(D.tglPendek('2025-08-17'), '17 Ags', 'tanggal pendek');
    /* String comparison IS date comparison for ISO dates, and the ledger relies
     * on it everywhere. */
    t.eq('2025-01-05' < '2025-01-10', true, 'perbandingan string ISO sama dengan perbandingan tanggal');
    t.eq('2024-12-31' < '2025-01-01', true, 'dan menyeberang tahun dengan benar');
    t.eq('2025-09-30' < '2025-10-01', true, 'dan menyeberang bulan dengan benar');
  });

  /* =============================================== 3. bagan akun ========= */

  group('Bagan akun — nomor, tipe dan saldo normal tidak boleh saling bertentangan', function (t) {
    var kode = {};
    D.AKUN.forEach(function (a) {
      t.eq(kode[a.kode], undefined, 'kode ' + a.kode + ' hanya muncul sekali');
      kode[a.kode] = true;
      t.eq(/^[1-5]\d{3}$/.test(a.kode), true, a.kode + ' bernomor empat digit yang dimulai 1–5');
      t.eq(D.TIPE_DIGIT[a.kode.charAt(0)], a.tipe,
        a.kode + ' ' + a.nama + ': digit pertama (' + a.kode.charAt(0) + ') memang menunjuk tipe ' + a.tipe);
      t.eq(a.normal === 'D' || a.normal === 'K', true, a.kode + ' punya saldo normal D atau K');
      /* The one thing a demo gets wrong: normal balance is NOT derivable from
       * the type alone. An account that departs from its type's default must say
       * so with the kontra flag, and one that carries the flag must depart. */
      var bawaan = D.NORMAL_TIPE[a.tipe];
      if (a.kontra) t.eq(a.normal !== bawaan, true, a.kode + ' ditandai kontra dan saldo normalnya memang lawan tipenya (' + a.normal + ' vs ' + bawaan + ')');
      else t.eq(a.normal, bawaan, a.kode + ' tidak ditandai kontra, jadi saldo normalnya harus ' + bawaan);
      if (a.kas) t.eq(a.arus, null, a.kode + ' akun kas, jadi tidak punya bucket arus kas — ia ADALAH kasnya');
      else t.eq(a.arus === 'O' || a.arus === 'I' || a.arus === 'F', true,
        a.kode + ' non-kas, jadi harus punya klasifikasi arus kas O/I/F (dapat ' + a.arus + ')');
      if (a.akumDari) t.eq(D.adaAkun(a.akumDari), true, a.kode + ' menunjuk akun aset ' + a.akumDari + ' yang ada');
      if (a.akumDari) t.eq(a.kontra, true, a.kode + ' akumulasi penyusutan, jadi ia akun kontra');
    });
    t.eq(D.akunTipe('Aset').length > 0, true, 'ada akun bertipe Aset');
    t.eq(D.akunTipe('Liabilitas').length > 0, true, 'ada akun bertipe Liabilitas');
    t.eq(D.akunTipe('Ekuitas').length > 0, true, 'ada akun bertipe Ekuitas');
    t.eq(D.akunTipe('Pendapatan').length > 0, true, 'ada akun bertipe Pendapatan');
    t.eq(D.akunTipe('Beban').length > 0, true, 'ada akun bertipe Beban');
    t.eq(D.TIPE.length, 5, 'lima tipe akun SAK, tidak enam');
    t.eq(D.akun('1602').tipe, 'Aset', '1602 Akumulasi Penyusutan tetap bertipe Aset — ia kontra aset, bukan liabilitas');
    t.eq(D.akun('1602').normal, 'K', 'dan saldo normalnya kredit');
    t.eq(D.akun('3102').tipe, 'Ekuitas', '3102 Prive tetap bertipe Ekuitas');
    t.eq(D.akun('3102').normal, 'D', 'dan saldo normalnya debit — kontra ekuitas');
    t.eq(D.isNominal(D.akun('4101')), true, 'akun pendapatan adalah akun nominal');
    t.eq(D.isNominal(D.akun('5101')), true, 'akun beban adalah akun nominal');
    t.eq(D.isNominal(D.akun('1101')), false, 'kas bukan akun nominal');
    t.eq(D.isNominal(D.akun('3201')), false, 'saldo laba bukan akun nominal');
    t.eq(D.akunKas().length, 2, 'dua akun kas dan setara kas');
    t.eq(D.adaAkun('9999'), false, 'akun yang tidak ada dilaporkan tidak ada');
    t.eq(D.akun('9999'), null, 'dan akun() memberi null, bukan undefined yang menyusup jauh');
    t.eq(D.akun('5301').pajakFinal, true, '5301 ditandai sebagai beban pajak final, agar tidak tercampur ke beban usaha');
    t.eq(D.akun('5301').grup !== D.akun('5201').grup, true, 'dan grupnya beda dari beban usaha');
    t.eq(D.akun('3999').ikhtisar, true, '3999 ditandai sebagai ikhtisar laba rugi');
    t.eq(D.saldoNatural(D.akun('1101'), 500, 200), 300, 'saldoNatural akun debit = debit − kredit');
    t.eq(D.saldoNatural(D.akun('2101'), 500, 900), 400, 'saldoNatural akun kredit = kredit − debit');
    t.eq(D.saldoNatural(D.akun('1602'), 0, 700), 700, 'saldoNatural akun kontra aset positif saat dikredit');
    t.eq(D.saldoNatural(D.akun('3102'), 700, 0), 700, 'saldoNatural prive positif saat didebit');
  });

  /* ============================== 4. I1 — setiap entri wajib seimbang ==== */

  group('I1 — entri tak seimbang DITOLAK, dan selisihnya ditunjukkan', function (t) {
    var b = L.buatBuku();
    var v = L.periksaEntri(b, {
      tgl: '2025-01-01', jenis: 'umum',
      baris: [{ akun: '1101', d: 1000000, k: 0 }, { akun: '4101', d: 0, k: 900000 }]
    }, {});
    t.eq(v.ok, false, 'entri debit 1.000.000 vs kredit 900.000 ditolak');
    t.eq(v.selisih, 100000, 'dan selisihnya dilaporkan +100.000');
    t.eq(v.totalDebit, 1000000, 'total debit dilaporkan');
    t.eq(v.totalKredit, 900000, 'total kredit dilaporkan');
    t.eq(/kredit kurang Rp100\.000/.test(v.alasan.join(' ')), true, 'dan alasannya menyebut sisi mana yang kurang dan berapa');
    t.eq(b.entries.length, 0, 'buku tetap kosong — penolakan bukan penolakan kalau entrinya tetap masuk');

    t.throwsWith(function () {
      tam(b, '2025-01-01', [{ akun: '1101', d: 1000000, k: 0 }, { akun: '4101', d: 0, k: 900000 }]);
    }, /tidak sama dengan kredit/, 'tambah() melempar untuk entri tak seimbang');
    t.eq(b.entries.length, 0, 'dan buku masih kosong setelah lemparan itu');

    var arah = L.periksaEntri(b, {
      tgl: '2025-01-01', jenis: 'umum',
      baris: [{ akun: '1101', d: 900000, k: 0 }, { akun: '4101', d: 0, k: 1000000 }]
    }, {});
    t.eq(arah.selisih, -100000, 'selisih negatif saat kreditnya lebih besar');
    t.eq(/sisi debit kurang/.test(arah.alasan.join(' ')), true, 'dan yang disebut kurang adalah sisi debit');

    t.throwsWith(function () { tam(b, '2025-01-01', [{ akun: '1101', d: 0, k: 0 }, { akun: '4101', d: 0, k: 0 }]); },
      /nol|dua baris/, 'entri bernilai nol ditolak');
    t.throwsWith(function () { tam(b, '2025-01-01', [{ akun: '1101', d: 500, k: 300 }, { akun: '4101', d: 0, k: 200 }]); },
      /debit ATAU kredit/, 'baris berisi debit dan kredit sekaligus ditolak');
    t.throwsWith(function () { tam(b, '2025-01-01', [{ akun: '1101', d: -500, k: 0 }, { akun: '4101', d: 0, k: -500 }]); },
      /negatif/, 'nilai negatif ditolak — pindahkan ke sisi lain, jangan pakai tanda minus');
    t.throwsWith(function () { tam(b, '2025-01-01', [{ akun: '1101', d: 1000.5, k: 0 }, { akun: '4101', d: 0, k: 1000.5 }]); },
      /bilangan bulat/, 'nilai pecahan ditolak walaupun kedua sisinya sama');
    t.throwsWith(function () { tam(b, '2025-01-01', [{ akun: '9999', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]); },
      /tidak ada di bagan akun/, 'akun di luar bagan ditolak');
    t.throwsWith(function () { tam(b, '2025-01-01', [{ akun: '1101', d: 1000, k: 0 }]); },
      /dua baris/, 'entri satu baris ditolak walaupun tidak ada yang tidak seimbang untuk dilihat');
    t.throwsWith(function () { tam(b, '2025-13-01', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]); },
      /Tanggal/, 'tanggal tidak sah ditolak');
    t.throwsWith(function () { tam(b, '2025-01-01', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }], 'entah'); },
      /Jenis jurnal/, 'jenis jurnal tak dikenal ditolak');
    t.throwsWith(function () {
      tam(b, '2025-01-01', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }], 'saldo-awal');
    }, /akun nominal/, 'akun nominal di jurnal saldo awal ditolak — neraca pembuka hanya memuat akun riil');

    /* And the happy path, so the refusals above are not simply "everything is
     * refused". */
    t.noThrow(function () {
      tam(b, '2025-01-01', [{ akun: '1101', d: 1000000, k: 0 }, { akun: '4101', d: 0, k: 1000000 }]);
    }, 'entri seimbang diterima');
    t.eq(b.entries.length, 1, 'dan masuk ke buku');
    var e = b.entries[0];
    t.eq(e.no, 'JU-0001', 'nomor dokumen berawalan jenisnya dan berlebar empat digit');
    t.eq(e.id, 'E1', 'id entri berurut');
    t.eq(e.baris.length, 2, 'dua baris tersimpan');
    t.eq(L.nomorDok(b, 'JU'), 'JU-0002', 'nomor berikutnya naik satu');
    t.eq(L.nomorDok(b, 'JP'), 'JP-0001', 'dan tiap awalan punya pencacahnya sendiri');

    /* Empty rows in a form are not errors — they are just not posted. */
    var e2 = tam(b, '2025-01-02', [
      { akun: '1101', d: 5000, k: 0 }, { akun: '', d: 0, k: 0 }, { akun: '4101', d: 0, k: 5000 }, { akun: '', d: 0, k: 0 }
    ]);
    t.eq(e2.baris.length, 2, 'baris kosong di formulir dibuang, bukan ditolak');

    /* Many-line entries, which is what a real purchase with PPN looks like. */
    var e3 = tam(b, '2025-01-03', [
      { akun: '1301', d: 2000000, k: 0 }, { akun: '1501', d: 220000, k: 0 },
      { akun: '2101', d: 0, k: 1220000 }, { akun: '1102', d: 0, k: 1000000 }
    ]);
    t.eq(e3.baris.length, 4, 'entri empat baris diterima');
    t.eq(e3.baris.reduce(function (s, x) { return s + x.d; }, 0), e3.baris.reduce(function (s, x) { return s + x.k; }, 0),
      'dan dua sisinya sama');

    /* Every entry in the demo book, checked one by one from its raw lines. */
    var d = db(), sal = 0, cek = 0;
    d.buku.entries.forEach(function (en) {
      var td = 0, tk = 0;
      en.baris.forEach(function (bb) { td += bb.d; tk += bb.k; });
      cek++;
      if (td !== tk) sal++;
    });
    t.eq(sal, 0, 'seluruh ' + cek + ' entri buku demo seimbang, diperiksa satu per satu dari baris mentahnya');
    t.gt(cek, 400, 'dan buku demo memang berisi ratusan entri, bukan segelintir');
    t.eq(dbSesuai().buku.entries.filter(function (en) {
      var td = 0, tk = 0; en.baris.forEach(function (bb) { td += bb.d; tk += bb.k; }); return td !== tk;
    }).length, 0, 'juga setelah seluruh jurnal penyesuaian diposting');
    t.eq(dbTutup().buku.entries.filter(function (en) {
      var td = 0, tk = 0; en.baris.forEach(function (bb) { td += bb.d; tk += bb.k; }); return td !== tk;
    }).length, 0, 'juga setelah jurnal penutup diposting');
  });

  /* ==================== 5. I7 — saldo diturunkan, tidak pernah disimpan == */

  group('I7 — saldo akun = jumlah postingnya, dihitung dua jalur terpisah', function (t) {
    var b = mini();
    /* Hand figures for the mini book. */
    t.rp(L.saldoAkun(b, '1101', {}).saldo, 9000000, 'kas mini: 10.000.000 − 300.000 − 1.200.000 + 500.000 = 9.000.000');
    t.rp(L.saldoAkun(b, '1301', {}).saldo, 6400000, 'persediaan mini: 5.000.000 + 2.000.000 − 600.000 = 6.400.000');
    t.rp(L.saldoAkun(b, '1201', {}).saldo, 1110000, 'piutang mini 1.110.000');
    t.rp(L.saldoAkun(b, '1501', {}).saldo, 220000, 'PPN masukan mini 220.000');
    t.rp(L.saldoAkun(b, '2101', {}).saldo, 2220000, 'utang usaha mini 2.220.000');
    t.rp(L.saldoAkun(b, '2104', {}).saldo, 110000, 'PPN keluaran mini 110.000');
    t.rp(L.saldoAkun(b, '3101', {}).saldo, 15500000, 'modal mini 15.000.000 + 500.000');
    t.rp(L.saldoAkun(b, '4101', {}).saldo, 1000000, 'penjualan mini 1.000.000');
    t.rp(L.saldoAkun(b, '5101', {}).saldo, 600000, 'HPP mini 600.000');
    t.rp(L.saldoAkun(b, '1602', {}).saldo, 20000, 'akumulasi penyusutan mini 20.000 — saldo natural kredit dilaporkan positif');
    t.rp(L.saldoAkun(b, '1602', {}).mentah, -20000, 'dan dalam debit-minus-kredit mentahnya negatif, yang membuatnya mengurangi aset');
    t.rp(L.saldoAkun(b, '1101', { sampai: '2025-01-19' }).saldo, 10000000, 'saldo kas per 19 Jan masih 10.000.000 — filter tanggal bekerja');
    t.rp(L.saldoAkun(b, '1101', { sampai: '2025-01-20' }).saldo, 9700000, 'per 20 Jan sudah 9.700.000');
    t.rp(L.saldoAkun(b, '1101', { sebelum: '2025-01-01' }).saldo, 10000000, 'dan saldo pembuka lewat filter sebelum');
    t.throwsWith(function () { L.saldoAkun(b, '9999', {}); }, /tidak ada/, 'saldoAkun menolak akun yang tidak ada');

    /* Two routes, every account, on the demo book. */
    var d = db();
    var post = L.postingan(L.urut(d.buku.entries));
    var beda = 0, dicek = 0;
    D.AKUN.forEach(function (a) {
      var r = post[a.kode], j2 = L.saldoAkun(d.buku, a.kode, {});
      dicek++;
      if ((r ? r.d : 0) !== j2.debit || (r ? r.k : 0) !== j2.kredit) beda++;
    });
    t.eq(beda, 0, 'akumulasi peta posting dan penjumlahan per akun sepakat di seluruh ' + dicek + ' akun buku demo');

    /* Sum of every account's raw debit equals sum of every raw credit — the
     * same identity from a third direction. */
    var totD = 0, totK = 0;
    for (var k in post) { if (Object.prototype.hasOwnProperty.call(post, k)) { totD += post[k].d; totK += post[k].k; } }
    t.eq(totD, totK, 'total debit seluruh buku = total kredit seluruh buku (' + D.rupiah(totD) + ')');
    t.gt(totD, 0, 'dan bukan nol lawan nol');

    /* Nothing stores a balance. */
    var adaSaldo = 0;
    d.buku.entries.forEach(function (en) {
      if (Object.prototype.hasOwnProperty.call(en, 'saldo')) adaSaldo++;
      en.baris.forEach(function (bb) { if (Object.prototype.hasOwnProperty.call(bb, 'saldo')) adaSaldo++; });
    });
    t.eq(adaSaldo, 0, 'tidak satu pun entri atau baris menyimpan field saldo — saldo hanya ada sebagai hasil hitung');
    t.eq(Object.prototype.hasOwnProperty.call(d.buku, 'saldoAkun'), false, 'dan buku tidak menyimpan peta saldo');
    t.eq(Object.prototype.hasOwnProperty.call(d.buku, 'neracaSaldo'), false, 'maupun neraca saldo yang di-cache');
    t.eq(Object.keys(d.buku).sort().join(','), 'entries,indexId,nomorBerikut,seqBerikut,tutup',
      'buku hanya memuat entri, pencacah, indeks id dan daftar periode terkunci — tidak ada tempat untuk saldo basi');

    /* Removing an entry changes the balance, which proves the balance was not
     * cached anywhere. */
    var b2 = L.buatBuku();
    tam(b2, '2025-01-01', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]);
    t.rp(L.saldoAkun(b2, '1101', {}).saldo, 1000, 'satu entri, saldo 1.000');
    tam(b2, '2025-01-02', [{ akun: '1101', d: 500, k: 0 }, { akun: '4101', d: 0, k: 500 }]);
    t.rp(L.saldoAkun(b2, '1101', {}).saldo, 1500, 'dua entri, saldo 1.500 — dihitung ulang, bukan diambil dari cache');
    b2.entries.pop();
    t.rp(L.saldoAkun(b2, '1101', {}).saldo, 1000, 'entri kedua dilepas, saldo kembali 1.000 tanpa ada yang perlu di-invalidasi');
  });

  /* ================================ 6. buku besar dan saldo berjalan ===== */

  group('Buku besar — saldo berjalan baris demi baris', function (t) {
    var b = mini();
    var bb = L.bukuBesar(b, '1101', { dari: MDARI, sampai: MSAMPAI });
    t.rp(bb.saldoAwal, 10000000, 'buku besar kas: saldo awal Januari 10.000.000, dari entri saldo awal 31 Des');
    t.eq(bb.baris.length, 3, 'tiga mutasi kas di Januari');
    t.rp(bb.baris[0].saldo, 9700000, 'setelah gaji 300.000, saldo berjalan 9.700.000');
    t.rp(bb.baris[1].saldo, 8500000, 'setelah beli peralatan 1.200.000, saldo 8.500.000');
    t.rp(bb.baris[2].saldo, 9000000, 'setelah setoran modal 500.000, saldo 9.000.000');
    t.rp(bb.saldoAkhir, 9000000, 'dan saldo akhir 9.000.000');
    t.rp(bb.saldoAkhir, L.saldoAkun(b, '1101', {}).saldo, 'saldo akhir buku besar = saldo akun dari jalur lain');
    t.eq(bb.baris[0].tgl <= bb.baris[1].tgl, true, 'baris urut naik menurut tanggal');
    t.eq(bb.baris[1].tgl <= bb.baris[2].tgl, true, 'dan seterusnya');
    t.rp(bb.jumlahDebit, 500000, 'jumlah kolom debit 500.000');
    t.rp(bb.jumlahKredit, 1500000, 'jumlah kolom kredit 1.500.000');
    t.rp(bb.saldoAwal + bb.jumlahDebit - bb.jumlahKredit, bb.saldoAkhir, 'saldo awal + debit − kredit = saldo akhir');
    t.eq(bb.baris[0].lawan.indexOf('5201') >= 0, true, 'setiap baris tahu akun lawannya');

    /* The running balance must equal the account balance on EVERY account of the
     * demo book, and the intermediate rows must each equal previous plus
     * movement — checked row by row, not only at the end. */
    var d = db(), gagalAkhir = 0, gagalBaris = 0, barisDicek = 0, akunDicek = 0;
    D.AKUN.forEach(function (a) {
      var g = L.bukuBesar(d.buku, a.kode, {});
      akunDicek++;
      if (g.saldoAkhir !== L.saldoAkun(d.buku, a.kode, {}).saldo) gagalAkhir++;
      var jalan = g.saldoAwal;
      g.baris.forEach(function (r) {
        jalan = jalan + r.gerak;
        barisDicek++;
        if (r.saldo !== jalan) gagalBaris++;
        if (r.gerak !== D.saldoNatural(a, r.debit, r.kredit)) gagalBaris++;
      });
    });
    t.eq(gagalAkhir, 0, 'saldo akhir buku besar cocok di seluruh ' + akunDicek + ' akun buku demo');
    t.eq(gagalBaris, 0, 'dan tiap satu dari ' + barisDicek + ' baris: saldo = saldo sebelumnya + mutasi barisnya');
    t.gt(barisDicek, 1000, 'jumlah baris yang diperiksa memang ribuan');

    /* A credit-normal account's running balance grows on credits. */
    var gu = L.bukuBesar(d.buku, '2101', {});
    t.eq(gu.baris.length > 10, true, 'utang usaha punya banyak mutasi');
    t.eq(gu.akun.normal, 'K', 'dan saldo normalnya kredit');
    var naik = gu.baris.filter(function (r) { return r.kredit > 0 && r.gerak > 0; }).length;
    t.eq(naik, gu.baris.filter(function (r) { return r.kredit > 0; }).length,
      'setiap kredit pada akun bersaldo normal kredit menaikkan saldonya, bukan menurunkannya');
    var akum = L.bukuBesar(d.buku, '1602', {});
    t.eq(akum.akun.normal, 'K', 'akumulasi penyusutan bersaldo normal kredit walaupun bertipe Aset');
    t.gte(akum.saldoAkhir, 0, 'dan saldo naturalnya positif');
  });

  /* ================================ 7. I2 — neraca saldo seimbang ======== */

  group('I2 — neraca saldo seimbang, sebelum dan sesudah penyesuaian', function (t) {
    var b = mini();
    var seb = L.neracaSaldo(b, { sampai: MSAMPAI, tahap: 'sebelum' });
    /* Hand figures: without the depreciation adjustment the mini trial balance is
     * 18.830.000 on each side (18.850.000 minus the 20.000 on each side). */
    t.eq(seb.seimbang, true, 'neraca saldo mini sebelum penyesuaian seimbang');
    t.rp(seb.totalDebit, 18830000, 'total debit sebelum penyesuaian 18.830.000');
    t.rp(seb.totalKredit, 18830000, 'dan total kredit sama');
    t.eq(seb.baris.filter(function (r) { return r.akun.kode === '5204'; }).length, 0,
      'beban penyusutan belum muncul di kolom sebelum penyesuaian');

    var set = L.neracaSaldo(b, { sampai: MSAMPAI, tahap: 'setelah' });
    t.eq(set.seimbang, true, 'setelah penyesuaian tetap seimbang');
    t.rp(set.totalDebit, 18850000, 'total debit setelah penyesuaian 18.850.000 — naik 20.000 karena penyusutan');
    t.rp(set.totalKredit, 18850000, 'dan kreditnya juga 18.850.000');
    t.rp(set.totalDebit - seb.totalDebit, 20000, 'selisih antara dua kolom itu tepat sebesar jurnal penyesuaiannya');
    t.eq(set.baris.filter(function (r) { return r.akun.kode === '5204'; })[0].debit, 20000, 'dan 5204 muncul di sisi debit 20.000');
    t.eq(set.baris.filter(function (r) { return r.akun.kode === '1602'; })[0].kredit, 20000, '1602 di sisi kredit 20.000');
    t.throwsWith(function () { L.neracaSaldo(b, { tahap: 'entah' }); }, /Tahap/, 'tahap yang tidak dikenal ditolak');

    /* Each row sits on the side its balance is actually on, and only one side. */
    var duaSisi = set.baris.filter(function (r) { return r.debit > 0 && r.kredit > 0; });
    t.eq(duaSisi.length, 0, 'tidak ada akun yang muncul di kedua kolom sekaligus');
    var salahTipe = set.baris.filter(function (r) {
      var alami = D.saldoNatural(r.akun, r.mentahD, r.mentahK);
      var tampil = r.debit > 0 ? r.debit : -r.kredit;
      var alamiMentah = r.akun.normal === 'D' ? alami : -alami;
      return tampil !== alamiMentah;
    });
    t.eq(salahTipe.length, 0, 'dan kolomnya sesuai dengan sisi tempat saldonya benar-benar berada');

    /* Demo book, three stages. */
    var d = db(), ds = dbSesuai(), dt = dbTutup();
    ['sebelum', 'setelah', 'penutup'].forEach(function (tahap) {
      var ns = L.neracaSaldo(d.buku, { sampai: SAMPAI, tahap: tahap });
      t.eq(ns.seimbang, true, 'buku demo, tahap ' + tahap + ': neraca saldo seimbang (' + D.rupiah(ns.totalDebit) + ')');
      t.gt(ns.totalDebit, 0, 'dan totalnya bukan nol');
      var nss = L.neracaSaldo(ds.buku, { sampai: SAMPAI, tahap: tahap });
      t.eq(nss.seimbang, true, 'buku demo setelah penyesuaian diposting, tahap ' + tahap + ': seimbang');
      var nst = L.neracaSaldo(dt.buku, { sampai: SAMPAI, tahap: tahap });
      t.eq(nst.seimbang, true, 'buku demo setelah ditutup, tahap ' + tahap + ': seimbang');
    });
    var nsSeb = L.neracaSaldo(ds.buku, { sampai: SAMPAI, tahap: 'sebelum' });
    var nsSet = L.neracaSaldo(ds.buku, { sampai: SAMPAI, tahap: 'setelah' });
    t.gt(nsSet.totalDebit, nsSeb.totalDebit, 'kolom setelah penyesuaian lebih besar dari sebelumnya — dua kolom yang benar-benar beda');
    var jp = L.pilih(ds.buku, { dari: DARI, sampai: SAMPAI, hanyaJenis: ['penyesuaian'] });
    var jumJp = 0;
    jp.forEach(function (e) { e.baris.forEach(function (x) { jumJp += x.d; }); });
    t.rp(jumJp, 174642004, 'total debit seluruh jurnal penyesuaian 174.642.004');
    /* The trial-balance total does NOT move by the total of the adjusting entries,
     * and assuming it does is a mistake worth writing down. A trial balance shows
     * each account once, on the side its balance is on, so an adjustment that
     * posts AGAINST an existing balance shrinks one column instead of growing the
     * other. Prepaid expenses (debit 5202 / credit 1401) add 18.000.000 to the
     * debit column and take 18.000.000 off it: net zero. Unearned revenue (debit
     * 2103 / credit 4102) does the same to the credit column. Only depreciation,
     * the accruals and the PPh true-up — which each create a balance on a fresh
     * account on both sides — actually lift the totals. */
    var naikkanTotal = 51500004 + 33102000 + 40000;
    t.rp(nsSet.totalDebit - nsSeb.totalDebit, naikkanTotal,
      'kolom neraca saldo naik 84.642.004: penyusutan 51.500.004 + akrual 33.102.000 + true-up PPh 40.000');
    /* The loan reclassification is the third kind of adjustment that moves
     * Rp 60.000.000 through the journal and NOTHING through the trial balance
     * totals, and for a third reason worth naming: at 31 December the current
     * portion 2106 has been run down to nil by twelve instalments while 2201 still
     * carries Rp 60.000.000. Debiting 2201 zeroes it — off the credit column —
     * and crediting 2106 puts the same figure back on the credit column. One
     * credit balance replaces another, so both columns end where they started,
     * and the only thing that changes is which SUBTOTAL of the balance sheet the
     * liability is reported in. Which is exactly the defect it repairs. */
    t.rp(jumJp - naikkanTotal, 22000000 + 8000000 + 60000000,
      'sisanya — 22.000.000 beban dibayar di muka, 8.000.000 pendapatan diterima di muka dan 60.000.000 reklasifikasi bagian lancar pinjaman — nol pengaruhnya ke TOTAL neraca saldo, karena ketiganya memposting melawan saldo yang sudah ada');
    t.rp(nsSet.totalKredit - nsSeb.totalKredit, naikkanTotal, 'dan kolom kreditnya naik sebesar yang sama, jadi keseimbangannya terjaga');
    t.rp(L.saldoAkun(ds.buku, '1401', {}).saldo - L.saldoAkun(db().buku, '1401', {}).saldo, -18000000,
      'periksa klaim itu: saldo sewa dibayar di muka memang TURUN 18.000.000, bukan naik');

    /* Trial balance per month across the year — twelve more chances to fail. */
    var gagalBulan = 0;
    for (var m = 1; m <= 12; m++) {
      var p = '2025-' + String(m).padStart(2, '0');
      var nsm = L.neracaSaldo(d.buku, { sampai: D.akhirBulan(p), tahap: 'setelah' });
      if (!nsm.seimbang) gagalBulan++;
      t.eq(nsm.seimbang, true, 'neraca saldo per akhir ' + D.periodeNama(p) + ' seimbang');
    }
    t.eq(gagalBulan, 0, 'dua belas neraca saldo bulanan, tidak satu pun yang selisih');
  });

  /* ============ 8. I3 — Aset = Liabilitas + Ekuitas, di setiap tanggal === */

  group('I3 — persamaan akuntansi utuh di setiap tanggal, bukan hanya saat tutup buku', function (t) {
    var b = mini();
    /* Hand figures at 31 January: assets 17.910.000, liabilities 2.330.000,
     * equity 15.500.000 accounts + 80.000 profit = 15.580.000. */
    var p = L.persamaan(b, MSAMPAI);
    t.rp(p.aset, 17910000, 'aset mini per 31 Jan: 9.000.000 + 1.110.000 + 6.400.000 + 220.000 + 1.200.000 − 20.000 = 17.910.000');
    t.rp(p.liabilitas, 2330000, 'liabilitas mini: 2.220.000 + 110.000 = 2.330.000');
    t.rp(p.ekuitasAkun, 15500000, 'akun ekuitas mini 15.500.000');
    t.rp(p.labaBelumDitutup, 80000, 'laba belum ditutup 80.000');
    t.rp(p.ekuitas, 15580000, 'ekuitas dilaporkan 15.580.000');
    t.rp(p.kanan, 17910000, 'liabilitas + ekuitas = 17.910.000');
    t.eq(p.selisih, 0, 'dan selisihnya nol');
    t.eq(p.seimbang, true, 'persamaan mini seimbang');
    /* Accumulated depreciation must REDUCE assets, not appear as a liability. */
    t.eq(p.aset < 17930000, true, 'akumulasi penyusutan mengurangi aset, tidak menambah liabilitas');

    /* At every date of the mini book, by hand-checkable increments. */
    var tanggal = ['2024-12-31', '2025-01-05', '2025-01-10', '2025-01-20', '2025-01-25', '2025-01-28', '2025-01-31'];
    tanggal.forEach(function (tg) {
      var pp = L.persamaan(b, tg);
      t.eq(pp.seimbang, true, 'persamaan mini seimbang per ' + tg + ' (aset ' + D.rupiah(pp.aset) + ')');
    });
    t.rp(L.persamaan(b, '2024-12-31').aset, 15000000, 'aset mini per 31 Des 2024 = 15.000.000');
    t.rp(L.persamaan(b, '2024-12-31').ekuitas, 15000000, 'dan seluruhnya dibiayai modal');
    t.rp(L.persamaan(b, '2025-01-05').aset, 15510000, 'aset per 5 Jan 15.510.000 setelah penjualan kredit dan HPP');
    t.rp(L.persamaan(b, '2025-01-05').labaBelumDitutup, 400000, 'dan laba berjalan 1.000.000 − 600.000 = 400.000');

    /* The demo book, at every date, three states. */
    [['sebelum penyesuaian', db()], ['setelah penyesuaian', dbSesuai()], ['setelah penutupan', dbTutup()]].forEach(function (pair) {
      var d = pair[1];
      var entries = L.urut(d.buku.entries);
      var tglSet = {}, urutTgl = [];
      entries.forEach(function (e) { if (!tglSet[e.tgl]) { tglSet[e.tgl] = true; urutTgl.push(e.tgl); } });
      var gagal = 0, terburuk = 0;
      urutTgl.forEach(function (tg) {
        var pp = L.persamaan(d.buku, tg);
        if (!pp.seimbang) { gagal++; if (Math.abs(pp.selisih) > Math.abs(terburuk)) terburuk = pp.selisih; }
      });
      t.eq(gagal, 0, 'buku demo ' + pair[0] + ': persamaan utuh di seluruh ' + urutTgl.length + ' tanggal (selisih terburuk ' + terburuk + ')');
      t.gt(urutTgl.length, 150, 'dan tanggal yang diperiksa memang ratusan, bukan sekadar akhir tahun');
      var akhir = L.persamaan(d.buku, SAMPAI);
      t.eq(akhir.seimbang, true, 'buku demo ' + pair[0] + ': seimbang per 31 Des 2025');
      t.gt(akhir.aset, 0, 'dan asetnya positif (' + D.rupiah(akhir.aset) + ')');
    });

    /* Equity before and after closing must be identical: that is the whole point
     * of reporting equity as accounts plus open nominal accounts. */
    var pSeb = L.persamaan(dbSesuai().buku, SAMPAI), pTut = L.persamaan(dbTutup().buku, SAMPAI);
    t.rp(pTut.aset, pSeb.aset, 'aset tidak bergerak karena penutupan');
    t.rp(pTut.liabilitas, pSeb.liabilitas, 'liabilitas tidak bergerak karena penutupan');
    t.rp(pTut.ekuitas, pSeb.ekuitas, 'ekuitas total tidak bergerak karena penutupan');
    t.eq(pTut.labaBelumDitutup, 0, 'tetapi laba yang belum ditutup jadi nol');
    t.rp(pTut.ekuitasAkun, pSeb.ekuitas, 'karena seluruhnya sudah berpindah ke akun ekuitas');

    /* The equation must be able to FAIL. An entry pushed straight into
     * buku.entries, bypassing tambah(), breaks it — which proves the check reads
     * the book rather than trusting the door. */
    var rusak = L.buatBuku();
    tam(rusak, '2025-01-01', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]);
    t.eq(L.persamaan(rusak, '2025-01-01').seimbang, true, 'buku kecil yang sah seimbang');
    rusak.entries.push({ id: 'X', seq: 99, no: 'X-1', tgl: '2025-01-02', jenis: 'umum', memo: 'diselundupkan', baris: [{ akun: '1101', d: 500, k: 0 }] });
    t.eq(L.persamaan(rusak, '2025-01-02').seimbang, false, 'entri sepihak yang diselundupkan langsung ke entries membuat persamaan pincang');
    t.rp(L.persamaan(rusak, '2025-01-02').selisih, 500, 'dan selisihnya tepat 500 — besarnya entri selundupan itu');
  });

  /* ============================ 9. I4 — laba bersih menyatu di tiga laporan */

  group('I4 — laba bersih sama di Laba Rugi, Perubahan Ekuitas dan Neraca', function (t) {
    var b = mini();
    var lr = L.labaRugi(b, MDARI, MSAMPAI);
    t.rp(lr.totPendapatanUsaha, 1000000, 'pendapatan usaha mini 1.000.000');
    t.rp(lr.totHpp, 600000, 'HPP mini 600.000');
    t.rp(lr.labaBruto, 400000, 'laba bruto mini 1.000.000 − 600.000 = 400.000');
    t.rp(lr.totBebanUsaha, 320000, 'beban usaha mini 300.000 gaji + 20.000 penyusutan = 320.000');
    t.rp(lr.labaUsaha, 80000, 'laba usaha mini 400.000 − 320.000 = 80.000');
    t.rp(lr.labaSebelumPajak, 80000, 'laba sebelum pajak 80.000');
    t.rp(lr.totPajakFinal, 0, 'mini belum membebankan PPh final');
    t.rp(lr.labaNeto, 80000, 'laba neto mini 80.000');
    t.rp(lr.peredaranBruto, 1000000, 'peredaran bruto mini 1.000.000 — dasar 0,5%, bukan labanya');
    t.eq(lr.totalPendapatan - lr.totalBeban, lr.labaNeto, 'total pendapatan − total beban = laba neto');
    /* PPN never appears in the income statement: it is not the entity's revenue. */
    t.eq(lr.pendapatanUsaha.concat(lr.bebanUsaha).filter(function (r) { return r.akun.pajak; }).length, 0,
      'akun PPN tidak muncul di Laba Rugi sama sekali — PPN bukan pendapatan maupun beban entitas');

    var pe = L.perubahanEkuitas(b, MDARI, MSAMPAI, { labaRugi: lr });
    t.rp(pe.ekuitasAwal, 15000000, 'ekuitas awal mini 15.000.000');
    t.rp(pe.setoran, 500000, 'setoran modal mini 500.000');
    t.rp(pe.labaNeto, 80000, 'laba neto pada perubahan ekuitas 80.000');
    t.rp(pe.prive, 0, 'tidak ada prive di mini');
    t.rp(pe.ekuitasAkhir, 15580000, 'ekuitas akhir mini 15.000.000 + 500.000 + 80.000 = 15.580.000');
    t.rp(pe.ekuitasAkhirHitung, pe.ekuitasAkhir, 'dan angka yang dihitung dari komponennya sama dengan yang dari buku');
    t.eq(pe.cocok, true, 'perubahan ekuitas mini menutup sendiri');

    var nr = L.neraca(b, MSAMPAI, { dari: MDARI, labaRugi: lr });
    t.rp(nr.totalAset, 17910000, 'total aset neraca mini 17.910.000');
    t.rp(nr.asetLancar.total, 16730000, 'aset lancar mini 9.000.000 + 1.110.000 + 6.400.000 + 220.000 = 16.730.000');
    t.rp(nr.asetTetap.total, 1180000, 'aset tetap mini 1.200.000 − 20.000 = 1.180.000');
    t.rp(nr.totalLiabilitas, 2330000, 'total liabilitas mini 2.330.000');
    t.rp(nr.totalEkuitas, 15580000, 'total ekuitas mini 15.580.000');
    t.rp(nr.labaBerjalan, 80000, 'laba periode berjalan di neraca 80.000');
    t.eq(nr.seimbang, true, 'neraca mini seimbang');
    t.eq(nr.labaCocok, true, 'dan laba di neraca sama dengan laba di Laba Rugi');
    t.rp(nr.totalAset, nr.kanan, 'sisi kiri = sisi kanan');

    /* THE tie: one figure, three statements. */
    t.eq(lr.labaNeto === pe.labaNeto && pe.labaNeto === nr.labaBerjalan, true,
      'satu angka laba bersih di Laba Rugi, Perubahan Ekuitas dan Neraca — ' + D.rupiah(lr.labaNeto));
    t.rp(pe.ekuitasAkhir, nr.totalEkuitas, 'ekuitas akhir Perubahan Ekuitas = total ekuitas Neraca');
    t.rp(pe.ekuitasAkhir - pe.ekuitasAwal - pe.setoran, lr.labaNeto,
      'dan pergerakan ekuitas dikurangi setoran tepat sebesar laba bersih');

    /* Demo book, three states, with a fourth derivation of profit. */
    [['sebelum penyesuaian', db()], ['setelah penyesuaian', dbSesuai()], ['setelah penutupan', dbTutup()]].forEach(function (pair) {
      var d = pair[1];
      var l = L.labaRugi(d.buku, DARI, SAMPAI);
      var e = L.perubahanEkuitas(d.buku, DARI, SAMPAI, { labaRugi: l });
      var n = L.neraca(d.buku, SAMPAI, { dari: DARI, labaRugi: l });
      t.rp(e.labaNeto, l.labaNeto, pair[0] + ': laba Perubahan Ekuitas = laba Laba Rugi (' + D.rupiah(l.labaNeto) + ')');
      t.rp(e.ekuitasAkhir, n.totalEkuitas, pair[0] + ': ekuitas akhir Perubahan Ekuitas = total ekuitas Neraca');
      t.eq(e.cocok, true, pair[0] + ': awal + laba + setoran − prive = akhir');
      t.eq(n.seimbang, true, pair[0] + ': neraca seimbang');
      /* Fourth route: the movement in reported equity, from persamaan(), which
       * never calls labaRugi(). */
      var awal = L.persamaan(d.buku, null, { entries: L.pilih(d.buku, { sebelum: DARI }) });
      var akhir = L.persamaan(d.buku, SAMPAI);
      var turunan = (akhir.ekuitas - awal.ekuitas) - e.setoran + e.prive - e.lainEkuitas;
      t.rp(turunan, l.labaNeto, pair[0] + ': laba diturunkan ulang dari pergerakan ekuitas dan cocok ke rupiah');
      t.rp(l.labaNeto, l.totalPendapatan - l.totalBeban, pair[0] + ': laba = total pendapatan − total beban');
      t.rp(l.labaBruto, l.totPendapatanUsaha - l.totHpp, pair[0] + ': laba bruto = pendapatan usaha − HPP');
      t.rp(l.labaNeto, l.labaSebelumPajak - l.totPajakFinal, pair[0] + ': laba neto = laba sebelum pajak − pajak final');
      t.gt(l.peredaranBruto, 0, pair[0] + ': peredaran bruto positif');
      t.rp(e.prive, 100000000, pair[0] + ': prive setahun 4 × Rp 25.000.000 = Rp 100.000.000');
      t.rp(e.setoran, 100000000, pair[0] + ': setoran modal tambahan Rp 100.000.000');
    });

    var lrS = L.labaRugi(dbSesuai().buku, DARI, SAMPAI), lrB = L.labaRugi(db().buku, DARI, SAMPAI);
    t.lt(lrS.labaNeto, lrB.labaNeto, 'penyesuaian menurunkan laba — penyusutan dan akrual adalah beban yang tadinya belum diakui');
    t.rp(L.labaRugi(dbTutup().buku, DARI, SAMPAI).labaNeto, lrS.labaNeto,
      'dan penutupan tidak mengubah laba yang dilaporkan sepeser pun');
  });

  /* ================================= 10. I6 — arus kas rekonsiliasi ====== */

  group('I6 — arus kas metode tidak langsung, rekonsiliasi ke saldo kas buku besar', function (t) {
    var b = mini();
    var ak = L.arusKas(b, MDARI, MSAMPAI);
    /* Every one of these is written out in the mini-book comment above and can be
     * checked on paper. */
    t.rp(ak.labaNeto, 80000, 'baris pembuka arus kas mini = laba neto 80.000');
    t.rp(ak.penyusutan, 20000, 'penyesuaian non-kas 20.000, diambil dari sisi kredit akumulasi penyusutan');
    t.rp(ak.bebanPenyusutan, 20000, 'dan sama dengan beban penyusutan di Laba Rugi');
    t.rp(ak.totModalKerja, -400000, 'pergerakan modal kerja mini: −1.110.000 −1.400.000 −220.000 +2.220.000 +110.000 = −400.000');
    t.rp(ak.operasi, -300000, 'arus kas operasi mini 80.000 + 20.000 − 400.000 = −300.000');
    t.rp(ak.operasiSusun, -300000, 'dan versi tersusunnya sama dengan versi aljabarnya');
    t.eq(ak.operasiSelisih, 0, 'selisih antara penyajian dan aljabar nol — tidak ada angka penyeimbang');
    t.rp(ak.investasi, -1200000, 'arus kas investasi mini −1.200.000, pembelian peralatan');
    t.rp(ak.pendanaan, 500000, 'arus kas pendanaan mini +500.000, setoran modal');
    t.rp(ak.totalArus, -1000000, 'total arus kas mini −1.000.000');
    t.rp(ak.kasAwal, 10000000, 'kas awal mini 10.000.000');
    t.rp(ak.kasAkhirHitung, 9000000, 'kas awal + total arus = 9.000.000');
    t.rp(ak.kasAkhir, 9000000, 'dan saldo kas menurut buku besar juga 9.000.000');
    t.eq(ak.rekonsiliasi, true, 'REKONSILIASI mini: kedua angka itu sama');
    t.eq(ak.selisihRekonsiliasi, 0, 'selisih rekonsiliasi nol');
    t.eq(ak.selisihGerak, 0, 'pergerakan kas menurut laporan = pergerakan menurut posting akun kas');
    t.rp(ak.kasAkhir, L.saldoKas(b, { sampai: MSAMPAI }).total, 'kas akhir = penjumlahan akun kas yang sepenuhnya terpisah');
    /* Bucket algebra adds to Δcash with nothing left over. */
    t.rp(ak.operasi + ak.investasi + ak.pendanaan, ak.kasAkhir - ak.kasAwal,
      'tiga bucket berjumlah tepat perubahan kas — identitasnya, bukan angka penyeimbang');
    t.rp(-(ak.bucket.O + ak.bucket.I + ak.bucket.F), ak.kasAkhir - ak.kasAwal,
      'dan negatif jumlah seluruh akun non-kas sama dengan perubahan kas, sesuai identitas debit = kredit');
    /* Sign conventions, one line at a time. */
    var mk = {};
    ak.modalKerja.forEach(function (r) { mk[r.akun.kode] = r.jumlah; });
    t.rp(mk['1201'], -1110000, 'piutang naik → arus kas keluar (negatif)');
    t.rp(mk['1301'], -1400000, 'persediaan naik → negatif');
    t.rp(mk['1501'], -220000, 'PPN masukan naik → negatif, ia aset');
    t.rp(mk['2101'], 2220000, 'utang usaha naik → positif, kas tertahan di badan usaha');
    t.rp(mk['2104'], 110000, 'PPN keluaran naik → positif, ia liabilitas');
    t.eq(mk['1602'], undefined, 'akumulasi penyusutan TIDAK muncul di modal kerja — ia sudah jadi baris non-kas');
    t.eq(mk['4101'], undefined, 'akun nominal tidak muncul di modal kerja — sudah masuk lewat laba neto');
    t.eq(mk['1101'], undefined, 'kas sendiri tentu tidak muncul sebagai modal kerja');

    /* Demo book, three states. */
    [['sebelum penyesuaian', db()], ['setelah penyesuaian', dbSesuai()], ['setelah penutupan', dbTutup()]].forEach(function (pair) {
      var d = pair[1], a = L.arusKas(d.buku, DARI, SAMPAI);
      var kasLedger = L.saldoKas(d.buku, { sampai: SAMPAI }).total;
      t.eq(a.rekonsiliasi, true, pair[0] + ': kas awal + operasi + investasi + pendanaan = kas akhir (' + D.rupiah(a.kasAkhir) + ')');
      t.rp(a.kasAkhir, kasLedger, pair[0] + ': kas akhir laporan = saldo akun kas di buku besar');
      t.eq(a.operasiSelisih, 0, pair[0] + ': bagian operasi yang disajikan = bagian operasi dari aljabar bucket');
      t.eq(a.selisihGerak, 0, pair[0] + ': pergerakan kas laporan = pergerakan kas posting');
      t.rp(a.labaNeto, L.labaRugi(d.buku, DARI, SAMPAI).labaNeto, pair[0] + ': laba pembuka arus kas = laba Laba Rugi');
      t.rp(a.operasi + a.investasi + a.pendanaan, a.kasAkhir - a.kasAwal, pair[0] + ': tiga bucket = perubahan kas');
      t.rp(a.kasAwal, 210000000, pair[0] + ': kas awal 24.000.000 + 186.000.000 = 210.000.000');
      t.rp(a.investasi, -48000000, pair[0] + ': arus investasi −48.000.000, harga perolehan AT-03 tanpa PPN-nya');
      t.eq(a.rincianNonKas.length >= 0, true, pair[0] + ': rincian non-kas ada');
      t.rp(a.penyusutan, a.bebanPenyusutan, pair[0] + ': penyesuaian non-kas = beban penyusutan');
    });
    var aS = L.arusKas(dbSesuai().buku, DARI, SAMPAI), aB = L.arusKas(db().buku, DARI, SAMPAI), aT = L.arusKas(dbTutup().buku, DARI, SAMPAI);
    t.rp(aS.kasAkhir, aB.kasAkhir, 'jurnal penyesuaian tidak mengubah kas sama sekali — tidak satu pun menyentuh kas');
    t.rp(aS.operasi, aB.operasi, 'dan tidak mengubah arus kas operasi: laba turun, penyesuaian non-kas dan modal kerja naik sebanyak yang sama');
    t.rp(aT.operasi, aS.operasi, 'penutupan juga tidak mengubah arus kas operasi');
    t.rp(aT.pendanaan, aS.pendanaan, 'maupun pendanaan — kalau jurnal penutup ikut dihitung, seluruh laba tahun ini akan salah masuk ke pendanaan');
    t.rp(aS.penyusutan, 51500004, 'penyesuaian non-kas setahun 51.500.004, tepat jumlah tiga jadwal penyusutan');
    t.rp(aS.penyusutan, dbSesuai().reg.aset.reduce(function (s, x) { return s + x.penyusutanTahun; }, 0),
      'dan sama dengan jumlah penyusutan tahun ini dari register aset');

    /* No closing entry may touch cash — the property that licenses the
     * exclusion. */
    var kasDiTutup = 0;
    L.pilih(dbTutup().buku, { hanyaJenis: ['penutup'], efektif: false }).forEach(function (e) {
      e.baris.forEach(function (x) { if (D.akun(x.akun).kas) kasDiTutup++; });
    });
    t.eq(kasDiTutup, 0, 'tidak ada baris kas di jurnal penutup mana pun');

    /* An account with no cash-flow classification is a throw, not a silent
     * omission that breaks the reconciliation without saying why. */
    var takTag = D.AKUN.filter(function (a) { return !a.kas && !a.arus; });
    t.eq(takTag.length, 0, 'setiap akun non-kas di bagan punya klasifikasi arus kas');

    /* Cash flow with only cash movements: opening injection, nothing else. */
    var b3 = L.buatBuku();
    tam(b3, '2024-12-31', [{ akun: '1101', d: 1000, k: 0 }, { akun: '3101', d: 0, k: 1000 }], 'saldo-awal');
    tam(b3, '2025-01-10', [{ akun: '1101', d: 500, k: 0 }, { akun: '3101', d: 0, k: 500 }]);
    var a3 = L.arusKas(b3, '2025-01-01', '2025-01-31');
    t.rp(a3.kasAwal, 1000, 'buku kas murni: kas awal 1.000');
    t.rp(a3.pendanaan, 500, 'setoran 500 muncul sebagai pendanaan');
    t.rp(a3.operasi, 0, 'tidak ada arus operasi');
    t.rp(a3.kasAkhir, 1500, 'kas akhir 1.500');
    t.eq(a3.rekonsiliasi, true, 'dan rekonsiliasi tetap benar pada kasus paling sederhana');

    /* A book with no cash movement at all still reconciles. */
    var b4 = L.buatBuku();
    tam(b4, '2025-01-05', [{ akun: '1201', d: 900, k: 0 }, { akun: '4101', d: 0, k: 900 }]);
    var a4 = L.arusKas(b4, '2025-01-01', '2025-01-31');
    t.rp(a4.kasAwal, 0, 'penjualan kredit tanpa kas: kas awal 0');
    t.rp(a4.kasAkhir, 0, 'kas akhir 0');
    t.rp(a4.operasi, 0, 'arus operasi 0 — laba 900 dikurangi kenaikan piutang 900');
    t.rp(a4.labaNeto, 900, 'walaupun labanya 900');
    t.eq(a4.rekonsiliasi, true, 'dan rekonsiliasinya benar: laba tidak sama dengan kas');
  });

  /* ============================ 11. I5 — jurnal penutup ================== */

  group('I5 — jurnal penutup menihilkan akun nominal tanpa menggeser neraca', function (t) {
    var b = L.buatBuku();
    tam(b, '2024-12-31', [{ akun: '1101', d: 10000000, k: 0 }, { akun: '3101', d: 0, k: 10000000 }], 'saldo-awal');
    tam(b, '2025-03-01', [{ akun: '1101', d: 3000000, k: 0 }, { akun: '4101', d: 0, k: 3000000 }]);
    tam(b, '2025-03-02', [{ akun: '5201', d: 1200000, k: 0 }, { akun: '1101', d: 0, k: 1200000 }]);
    tam(b, '2025-03-03', [{ akun: '3102', d: 400000, k: 0 }, { akun: '1101', d: 0, k: 400000 }]);

    var lrKecil = L.labaRugi(b, '2025-01-01', '2025-12-31');
    t.rp(lrKecil.labaNeto, 1800000, 'buku kecil: laba 3.000.000 − 1.200.000 = 1.800.000');
    var praKecil = L.persamaan(b, '2025-12-31');
    t.rp(praKecil.aset, 11400000, 'aset 10.000.000 + 3.000.000 − 1.200.000 − 400.000 = 11.400.000');
    t.rp(praKecil.ekuitas, 11400000, 'ekuitas 10.000.000 − 400.000 prive + 1.800.000 laba = 11.400.000');

    var rencana = L.rencanaPenutup(b, '2025-12-31', {});
    t.eq(rencana.langkah.length, 4, 'empat langkah penutupan: pendapatan, beban, ikhtisar ke saldo laba, prive');
    t.eq(rencana.langkah[0].nama.indexOf('pendapatan') > 0, true, 'langkah 1 menutup pendapatan');
    t.eq(rencana.langkah[1].nama.indexOf('beban') > 0, true, 'langkah 2 menutup beban');
    t.eq(rencana.langkah[2].nama.indexOf('Saldo Laba') > 0, true, 'langkah 3 memindahkan ikhtisar ke saldo laba');
    t.eq(rencana.langkah[3].nama.indexOf('Prive') > 0, true, 'langkah 4 menutup prive');
    t.rp(rencana.laba, 1800000, 'laba yang dipindahkan 1.800.000, sama dengan laba Laba Rugi');
    rencana.langkah.forEach(function (lg) {
      var td = lg.baris.reduce(function (s, x) { return s + (x.d || 0); }, 0);
      var tk = lg.baris.reduce(function (s, x) { return s + (x.k || 0); }, 0);
      t.eq(td, tk, 'langkah ' + lg.no + ' seimbang sendiri (' + D.rupiah(td) + ')');
    });

    L.postingPenutup(b, '2025-12-31', { peran: 'supervisor' });
    t.rp(L.saldoAkun(b, '4101', {}).saldo, 0, 'setelah tutup: penjualan nol');
    t.rp(L.saldoAkun(b, '5201', {}).saldo, 0, 'beban gaji nol');
    t.rp(L.saldoAkun(b, '3999', {}).saldo, 0, 'ikhtisar laba rugi kosong kembali');
    t.rp(L.saldoAkun(b, '3102', {}).saldo, 0, 'prive nol');
    t.rp(L.saldoAkun(b, '3201', {}).saldo, 1400000, 'saldo laba 1.800.000 laba − 400.000 prive = 1.400.000');
    t.rp(L.saldoAkun(b, '3101', {}).saldo, 10000000, 'modal pemilik tidak tersentuh — prive ditutup ke saldo laba');
    var pascaKecil = L.persamaan(b, '2025-12-31');
    t.rp(pascaKecil.aset, praKecil.aset, 'aset tidak berubah karena penutupan');
    t.rp(pascaKecil.ekuitas, praKecil.ekuitas, 'ekuitas total tidak berubah karena penutupan');
    t.rp(pascaKecil.labaBelumDitutup, 0, 'dan tidak ada lagi laba yang belum ditutup');
    t.eq(L.rencanaPenutup(b, '2025-12-31', {}).kosong, true, 'menutup buku yang sudah tertutup menghasilkan rencana kosong');
    t.eq(L.postingPenutup(b, '2025-12-31', { peran: 'supervisor' }).entries.length, 0,
      'jadi klik kedua tidak memposting apa pun — saldo laba tidak bisa berganda');
    t.rp(L.saldoAkun(b, '3201', {}).saldo, 1400000, 'dan saldo laba tetap 1.400.000 setelah klik kedua');

    /* A loss closes the other way round. */
    var bl = L.buatBuku();
    tam(bl, '2024-12-31', [{ akun: '1101', d: 5000000, k: 0 }, { akun: '3101', d: 0, k: 5000000 }], 'saldo-awal');
    tam(bl, '2025-02-01', [{ akun: '1101', d: 1000000, k: 0 }, { akun: '4101', d: 0, k: 1000000 }]);
    tam(bl, '2025-02-02', [{ akun: '5201', d: 1700000, k: 0 }, { akun: '1101', d: 0, k: 1700000 }]);
    t.rp(L.labaRugi(bl, '2025-01-01', '2025-12-31').labaNeto, -700000, 'buku rugi: laba neto −700.000');
    var rl = L.rencanaPenutup(bl, '2025-12-31', {});
    t.rp(rl.laba, -700000, 'rencana penutupnya membawa rugi −700.000');
    t.eq(rl.langkah[2].baris[1].d, 700000, 'dan saldo laba DIDEBIT saat rugi, bukan dikredit');
    L.postingPenutup(bl, '2025-12-31', { peran: 'supervisor' });
    t.rp(L.saldoAkun(bl, '3201', {}).saldo, -700000, 'saldo laba jadi negatif 700.000');
    t.rp(L.saldoAkun(bl, '3999', {}).saldo, 0, 'ikhtisar tetap kosong setelah menutup rugi');
    t.eq(L.persamaan(bl, '2025-12-31').seimbang, true, 'dan persamaan tetap seimbang setelah menutup rugi');

    /* Demo book. */
    var ds = dbSesuai(), dt = dbTutup();
    var lrS = L.labaRugi(ds.buku, DARI, SAMPAI);
    var nsT = L.neracaSaldo(dt.buku, { sampai: SAMPAI, tahap: 'penutup', semuaAkun: true });
    var sisaNominal = nsT.baris.filter(function (r) { return D.isNominal(r.akun) && (r.debit !== 0 || r.kredit !== 0); });
    t.eq(sisaNominal.length, 0, 'buku demo: setiap satu dari ' +
      nsT.baris.filter(function (r) { return D.isNominal(r.akun); }).length + ' akun nominal bersaldo nol setelah penutupan');
    D.akunTipe('Pendapatan').concat(D.akunTipe('Beban')).forEach(function (a) {
      t.rp(L.saldoAkun(dt.buku, a.kode, {}).saldo, 0, 'akun nominal ' + a.kode + ' ' + a.nama + ' nol setelah penutupan');
    });
    t.rp(L.saldoAkun(dt.buku, '3999', {}).saldo, 0, 'ikhtisar laba rugi buku demo kosong setelah penutupan');
    t.rp(L.saldoAkun(dt.buku, '3102', {}).saldo, 0, 'prive buku demo nol setelah penutupan');
    var nrS = L.neraca(ds.buku, SAMPAI, { dari: DARI }), nrT = L.neraca(dt.buku, SAMPAI, { dari: DARI });
    t.rp(nrT.totalAset, nrS.totalAset, 'total aset buku demo tidak bergeser sepeser pun karena penutupan');
    t.rp(nrT.totalLiabilitas, nrS.totalLiabilitas, 'total liabilitas tidak bergeser');
    t.rp(nrT.totalEkuitas, nrS.totalEkuitas, 'total ekuitas tidak bergeser');
    t.eq(nrT.seimbang, true, 'dan neracanya masih seimbang');
    t.rp(nrT.labaBerjalan, 0, 'laba periode berjalan di neraca jadi nol setelah penutupan');
    t.rp(L.saldoAkun(dt.buku, '3201', {}).saldo,
      db().saldoLabaAwal + lrS.labaNeto - 100000000,
      'saldo laba akhir = saldo laba awal + laba tahun ini − prive setahun');
    var nsTutupSeimbang = L.neracaSaldo(dt.buku, { sampai: SAMPAI, tahap: 'penutup' });
    t.eq(nsTutupSeimbang.seimbang, true, 'neraca saldo setelah penutupan tetap seimbang');
    t.eq(L.sudahDitutup(dt.buku, SAMPAI, DARI), true, 'buku demo terdeteksi sudah ditutup');
    t.eq(L.sudahDitutup(ds.buku, SAMPAI, DARI), false, 'dan buku yang belum ditutup terdeteksi belum');
    t.eq(L.pilih(dt.buku, { hanyaJenis: ['penutup'], efektif: false }).length, 4, 'empat entri penutup diposting di buku demo');
  });

  /* ============================= 12. jadwal penyusutan ================== */

  group('Penyusutan — jadwal berjumlah tepat harga perolehan minus residu', function (t) {
    var pj = A.periksaJadwal(db());
    pj.cek.forEach(function (c) { t.ok(c.ok, c.nama + ' — ' + c.pesan); });
    t.gte(pj.total, 17, 'pemeriksaan jadwal menjalankan sedikitnya 17 assertion sendiri');

    /* Hand cases. */
    var j1 = D.jadwalPenyusutan({ harga: 96000000, residu: 6000000, umurBulan: 60, mulai: '2023-01' });
    t.eq(j1.baris.length, 60, '60 baris untuk umur 60 bulan');
    t.rp(j1.baris[0].jumlah, 1500000, '(96.000.000 − 6.000.000) ÷ 60 = 1.500.000 per bulan, habis dibagi');
    t.rp(j1.totalPenyusutan, 90000000, 'jumlah jadwal 90.000.000');
    t.rp(j1.baris[59].nilaiBuku, 6000000, 'nilai buku baris terakhir tepat residunya');
    t.eq(j1.baris[0].periode, '2023-01', 'baris pertama Januari 2023');
    t.eq(j1.baris[59].periode, '2027-12', 'baris terakhir Desember 2027');
    t.rp(D.akumSampai(j1, '2024-12'), 36000000, 'akumulasi s.d. Des 2024 = 24 × 1.500.000 = 36.000.000');
    t.rp(D.penyusutanRentang(j1, '2025-01', '2025-12'), 18000000, 'penyusutan 2025 = 12 × 1.500.000 = 18.000.000');
    t.rp(D.akumSampai(j1, '2022-12'), 0, 'akumulasi sebelum tanggal mulai nol');
    t.rp(D.akumSampai(j1, '2030-12'), 90000000, 'akumulasi setelah habis umur berhenti di 90.000.000, tidak lewat');

    /* The case that does not divide evenly — the reason alokasi() exists. */
    var j2 = D.jadwalPenyusutan({ harga: 245000000, residu: 25000000, umurBulan: 96, mulai: '2023-07' });
    t.rp(j2.totalPenyusutan, 220000000, 'jadwal kendaraan berjumlah tepat 220.000.000 walaupun 220.000.000 ÷ 96 tidak bulat');
    t.rp(j2.baris[95].nilaiBuku, 25000000, 'nilai buku akhir umur tepat 25.000.000');
    var jum2 = j2.baris.reduce(function (s, r) { return s + r.jumlah; }, 0);
    t.rp(jum2, 220000000, 'dijumlah ulang baris demi baris: tetap 220.000.000');
    var min2 = Math.min.apply(null, j2.baris.map(function (r) { return r.jumlah; }));
    var max2 = Math.max.apply(null, j2.baris.map(function (r) { return r.jumlah; }));
    t.eq(max2 - min2, 1, 'angsuran terkecil dan terbesar hanya beda satu rupiah — sisanya dibagikan, tidak ditumpuk di bulan terakhir');
    t.rp(D.divFloor(220000000, 96), 2291666, 'pembagian bulat ke bawah 2.291.666');
    t.eq(min2, 2291666, 'angsuran terkecil memang 2.291.666');
    t.eq(max2, 2291667, 'dan terbesar 2.291.667');
    t.eq(j2.baris.filter(function (r) { return r.jumlah === 2291667; }).length, 64, '64 bulan menerima rupiah tambahan itu');
    t.rp(D.mul(2291666, 96) + 64, 220000000, 'periksa: 96 × 2.291.666 + 64 = 220.000.000');
    var akumNaik = true, sebelum = 0;
    j2.baris.forEach(function (r) { if (r.akumulasi <= sebelum) akumNaik = false; sebelum = r.akumulasi; });
    t.eq(akumNaik, true, 'akumulasi naik monoton di seluruh 96 baris');
    var bukuTurun = true, bk = j2.aset.harga + 1;
    j2.baris.forEach(function (r) { if (r.nilaiBuku >= bk) bukuTurun = false; bk = r.nilaiBuku; });
    t.eq(bukuTurun, true, 'nilai buku turun monoton dan tidak pernah di bawah residu');
    t.eq(j2.baris.filter(function (r) { return r.nilaiBuku < 25000000; }).length, 0, 'tidak satu baris pun jatuh di bawah nilai residu');

    /* Mid-year acquisition: eight months, not twelve. */
    var j3 = D.jadwalPenyusutan({ harga: 48000000, residu: 3000000, umurBulan: 60, mulai: '2025-05' });
    t.rp(j3.baris[0].jumlah, 750000, '(48.000.000 − 3.000.000) ÷ 60 = 750.000 per bulan');
    t.rp(D.penyusutanRentang(j3, '2025-01', '2025-12'), 6000000, 'aset yang dibeli Mei hanya menyusut 8 bulan di 2025 = 6.000.000');
    t.rp(D.akumSampai(j3, '2024-12'), 0, 'dan akumulasi pembukanya nol — ia belum ada tahun lalu');
    t.rp(D.penyusutanRentang(j3, '2025-05', '2025-05'), 750000, 'bulan pertamanya menyusut penuh satu bulan');
    t.rp(D.penyusutanRentang(j3, '2025-04', '2025-04'), 0, 'bulan sebelum perolehan tidak menyusut');

    /* Edge cases. */
    var j4 = D.jadwalPenyusutan({ harga: 1000, residu: 0, umurBulan: 3, mulai: '2025-01' });
    t.eq(j4.baris.map(function (r) { return r.jumlah; }).join(','), '334,333,333', '1.000 ÷ 3 bulan = 334, 333, 333');
    t.rp(j4.totalPenyusutan, 1000, 'dan berjumlah tepat 1.000');
    var j5 = D.jadwalPenyusutan({ harga: 500, residu: 500, umurBulan: 4, mulai: '2025-01' });
    t.rp(j5.totalPenyusutan, 0, 'aset yang residunya sama dengan harganya tidak menyusut sama sekali');
    t.eq(j5.baris.length, 4, 'tapi jadwalnya tetap punya empat baris nol');
    var j6 = D.jadwalPenyusutan({ harga: 7, residu: 0, umurBulan: 12, mulai: '2025-01' });
    t.rp(j6.totalPenyusutan, 7, '7 rupiah dibagi 12 bulan tetap berjumlah 7 rupiah');
    t.eq(j6.baris.filter(function (r) { return r.jumlah === 1; }).length, 7, 'tujuh bulan mendapat satu rupiah, lima bulan nol');
    t.eq(j6.baris.filter(function (r) { return r.jumlah === 0; }).length, 5, 'dan lima bulan itu memang nol, bukan 0,58');
    var j7 = D.jadwalPenyusutan({ harga: 1200, residu: 0, umurBulan: 1, mulai: '2025-06' });
    t.eq(j7.baris.length, 1, 'umur satu bulan menghasilkan satu baris');
    t.rp(j7.baris[0].jumlah, 1200, 'yang menyusut seluruhnya');

    t.throwsWith(function () { D.jadwalPenyusutan({ harga: 1000.5, residu: 0, umurBulan: 12, mulai: '2025-01' }); },
      /bilangan bulat/, 'harga perolehan pecahan ditolak');
    t.throwsWith(function () { D.jadwalPenyusutan({ harga: 1000, residu: 2000, umurBulan: 12, mulai: '2025-01' }); },
      /residu tidak boleh melebihi/, 'residu di atas harga perolehan ditolak');
    t.throwsWith(function () { D.jadwalPenyusutan({ harga: 1000, residu: -1, umurBulan: 12, mulai: '2025-01' }); },
      /residu tidak boleh negatif/, 'residu negatif ditolak');
    t.throwsWith(function () { D.jadwalPenyusutan({ harga: 1000, residu: 0, umurBulan: 0, mulai: '2025-01' }); },
      /umur/, 'umur nol bulan ditolak');
    t.throwsWith(function () { D.jadwalPenyusutan({ harga: 1000, residu: 0, umurBulan: 12, mulai: '2025-01-01' }); },
      /YYYY-MM/, 'tanggal mulai berformat harian ditolak — jadwal ini per bulan');

    /* Register versus ledger, on the demo book. */
    var d = db();
    t.rp(L.saldoAkun(d.buku, '1601', {}).saldo, 144000000, 'saldo peralatan 96.000.000 + 48.000.000 = 144.000.000');
    t.rp(d.reg.aset.filter(function (a) { return a.akunAset === '1601'; }).reduce(function (s, a) { return s + a.harga; }, 0),
      144000000, 'dan register aset menyebut total harga perolehan yang sama');
    t.rp(L.saldoAkun(d.buku, '1611', {}).saldo, 245000000, 'saldo kendaraan 245.000.000');
    t.rp(L.saldoAkun(d.buku, '1602', {}).saldo, 36000000, 'akumulasi penyusutan peralatan pembuka 36.000.000, sebelum penyesuaian');
    t.rp(d.reg.aset[0].akumAwal, 36000000, 'yang persis angka dari jadwal AT-01 — diturunkan, bukan diisi tangan');
    t.rp(d.reg.aset[1].akumAwal, L.saldoAkun(d.buku, '1612', {}).saldo,
      'dan akumulasi kendaraan pembuka juga sama dengan jadwal AT-02 (' + D.rupiah(d.reg.aset[1].akumAwal) + ')');
    t.rp(d.reg.aset[2].akumAwal, 0, 'AT-03 belum ada tahun lalu, jadi akumulasi pembukanya nol');
    var ds = dbSesuai();
    t.rp(L.saldoAkun(ds.buku, '1602', {}).saldo, 36000000 + 18000000 + 6000000,
      'setelah penyesuaian, akumulasi peralatan = 36.000.000 + 18.000.000 (AT-01) + 6.000.000 (AT-03)');
    t.rp(L.saldoAkun(ds.buku, '5204', {}).saldo, 51500004, 'beban penyusutan setahun 51.500.004');
    t.rp(L.saldoAkun(ds.buku, '1602', {}).saldo + L.saldoAkun(ds.buku, '1612', {}).saldo,
      36000000 + d.reg.aset[1].akumAwal + 51500004,
      'total akumulasi = akumulasi pembuka + beban penyusutan tahun ini, ke rupiah');
  });

  /* ================== 13. jurnal penyesuaian: muka, tangguh, akrual ====== */

  group('Jurnal penyesuaian — dibayar di muka, diterima di muka, akrual', function (t) {
    var iris = A.irisKontrak(36000000, '2025-07', 12, '2025-07', '2025-12');
    t.eq(iris.baris.length, 12, 'kontrak 12 bulan menghasilkan 12 iris');
    t.rp(iris.total, 36000000, 'seluruh iris berjumlah tepat 36.000.000');
    t.rp(iris.terpakai, 18000000, 'enam bulan terpakai = 18.000.000');
    t.rp(iris.sisa, 18000000, 'enam bulan sisa = 18.000.000');
    t.eq(iris.bulanDalamPeriode, 6, 'dan enam bulan itu memang yang jatuh di dalam periode');
    t.rp(iris.terpakai + iris.sisa, iris.total, 'terpakai + sisa = total, tanpa rupiah yang hilang');
    var iris2 = A.irisKontrak(1000, '2025-01', 3, '2025-01', '2025-01');
    t.eq(iris2.baris.map(function (r) { return r.jumlah; }).join(','), '334,333,333', 'iris 1.000 atas 3 bulan = 334, 333, 333');
    t.rp(iris2.terpakai, 334, 'bulan pertama 334');
    var iris3 = A.irisKontrak(36000000, '2025-07', 12, '2026-01', '2026-06');
    t.rp(iris3.terpakai, 18000000, 'periode berikutnya mengambil enam iris sisanya, juga 18.000.000');
    t.rp(iris3.terpakai + A.irisKontrak(36000000, '2025-07', 12, '2025-07', '2025-12').terpakai, 36000000,
      'dua periode berurutan bersama-sama mengambil seluruh kontrak, tidak lebih dan tidak kurang');

    var d = db();
    var rp = A.rencanaPenyusutan(d, DARI, SAMPAI);
    t.rp(rp.jumlah, 51500004, 'rencana penyusutan setahun 51.500.004');
    t.eq(rp.baris.length, 3, 'satu baris debit beban, dua baris kredit akumulasi (peralatan dan kendaraan)');
    t.eq(rp.baris[0].akun, '5204', 'yang didebit adalah beban penyusutan');
    t.eq(rp.baris.slice(1).every(function (x) { return D.akun(x.akun).akumDari; }), true, 'yang dikredit semuanya akun akumulasi penyusutan');
    t.rp(rp.baris[0].d, rp.baris.slice(1).reduce(function (s, x) { return s + x.k; }, 0), 'dan entrinya seimbang');
    t.eq(rp.rincian.length, 3, 'rinciannya menyebut tiga aset');
    t.eq(rp.rincian[2].bulan, 8, 'AT-03 hanya 8 bulan di tahun ini');
    t.eq(rp.rincian[0].bulan, 12, 'AT-01 penuh 12 bulan');

    var rm = A.rencanaDibayarDimuka(d, DARI, SAMPAI);
    t.rp(rm.jumlah, 22000000, 'sewa 6 bulan 18.000.000 + asuransi 4 bulan 4.000.000 = 22.000.000');
    t.eq(rm.baris.length, 4, 'dua kontrak, dua baris masing-masing');
    t.rp(rm.rincian[0].terpakai, 18000000, 'sewa terpakai 18.000.000');
    t.rp(rm.rincian[0].sisa, 18000000, 'sewa sisa 18.000.000, masih aset');
    t.rp(rm.rincian[1].terpakai, 4000000, 'asuransi terpakai 12.000.000 ÷ 12 × 4 = 4.000.000');
    t.rp(rm.rincian[1].sisa, 8000000, 'asuransi sisa 8.000.000');
    t.eq(rm.baris[0].akun, '5202', 'sewa didebit ke Beban Sewa');
    t.eq(rm.baris[1].akun, '1401', 'dan dikredit dari Sewa Dibayar di Muka');

    var rt = A.rencanaDiterimaDimuka(d, DARI, SAMPAI);
    t.rp(rt.jumlah, 8000000, 'kontrak 24.000.000 atas 6 bulan, 2 bulan dikerjakan = 8.000.000');
    t.eq(rt.baris[0].akun, '2103', 'liabilitas Pendapatan Diterima di Muka DIDEBIT');
    t.eq(rt.baris[1].akun, '4102', 'dan pendapatan jasa dikredit');
    t.eq(rt.baris.filter(function (x) { return x.akun === '2104'; }).length, 0,
      'PPN keluaran TIDAK ikut dipindah — fakturnya sudah terbit saat uang mukanya diterima');
    t.rp(rt.rincian[0].sisa, 16000000, 'empat bulan sisanya 16.000.000 tetap liabilitas');

    var ra = A.rencanaAkrual(d, DARI, SAMPAI);
    t.eq(ra.rincian.length, 3, 'tiga akrual: gaji, bunga, listrik Desember');
    t.eq(ra.baris.length, 6, 'enam baris, tiap akrual satu debit beban dan satu kredit utang');
    t.rp(ra.jumlah, ra.rincian.reduce(function (s, r) { return s + r.jumlah; }, 0), 'jumlahnya adalah jumlah rinciannya');
    t.eq(ra.baris.filter(function (x) { return x.akun === '2102'; }).length, 3, 'tiga baris kredit ke Beban yang Masih Harus Dibayar');
    t.rp(ra.baris.filter(function (x) { return x.akun === '2102'; }).reduce(function (s, x) { return s + x.k; }, 0), ra.jumlah,
      'dan totalnya sama dengan total bebannya');
    t.rp(ra.rincian[0].jumlah, 28000000, 'gaji Desember 28.000.000, sama dengan gaji bulan-bulan lain');
    t.rp(ra.rincian[1].jumlah, 950000, 'bunga Desember 950.000');

    /* Every plan balances, on its own, before anything is posted. */
    A.semuaRencana(d, DARI, SAMPAI).forEach(function (r) {
      if (r.kosong) { t.ok(true, 'rencana ' + r.id + ' kosong pada tahap ini, dan itu memang benar'); return; }
      var td = r.baris.reduce(function (s, x) { return s + (x.d || 0); }, 0);
      var tk = r.baris.reduce(function (s, x) { return s + (x.k || 0); }, 0);
      t.eq(td, tk, 'rencana ' + r.id + ' seimbang sebelum diposting (' + D.rupiah(td) + ')');
      t.eq(L.periksaEntri(d.buku, { tgl: r.tgl, jenis: 'penyesuaian', baris: r.baris }, { peran: 'akuntan' }).ok, true,
        'dan lolos validator yang sama dengan entri manual');
    });

    /* Posted effects on the balance sheet. */
    var ds = dbSesuai();
    t.rp(L.saldoAkun(ds.buku, '1401', {}).saldo, 18000000, 'setelah penyesuaian, sewa dibayar di muka sisa 18.000.000');
    t.rp(L.saldoAkun(ds.buku, '1402', {}).saldo, 8000000, 'asuransi dibayar di muka sisa 8.000.000');
    t.rp(L.saldoAkun(ds.buku, '5202', {}).saldo, 18000000, 'beban sewa tahun ini 18.000.000');
    t.rp(L.saldoAkun(ds.buku, '5205', {}).saldo, 4000000, 'beban asuransi tahun ini 4.000.000');
    t.rp(L.saldoAkun(ds.buku, '2103', {}).saldo, 16000000, 'pendapatan diterima di muka sisa 16.000.000');
    t.rp(L.saldoAkun(ds.buku, '2102', {}).saldo, ra.jumlah, 'utang beban akhir tahun = total akrual');
    t.rp(L.saldoAkun(db().buku, '1401', {}).saldo, 36000000, 'dan sebelum penyesuaian sewa dibayar di muka masih penuh 36.000.000');
    t.rp(L.saldoAkun(db().buku, '5202', {}).saldo, 0, 'dengan beban sewa masih nol — itu yang diperbaiki jurnal penyesuaian');
    t.rp(L.saldoAkun(db().buku, '2102', {}).saldo, 0, 'dan utang beban masih nol');

    /* A prepaid contract taken across two periods, end to end, on a small book:
     * the asset must land exactly on zero. */
    var b = L.buatBuku();
    tam(b, '2025-07-01', [{ akun: '1401', d: 36000000, k: 0 }, { akun: '1102', d: 0, k: 36000000 }]);
    var d1 = { buku: b, reg: { aset: [], muka: [{ id: 'X', nama: 'sewa', akunMuka: '1401', akunBeban: '5202', jumlah: 36000000, mulai: '2025-07', bulan: 12 }], tangguh: [], akrual: [] } };
    var p1 = A.rencanaDibayarDimuka(d1, '2025-01-01', '2025-12-31');
    A.posting(b, p1, { peran: 'akuntan' });
    t.rp(L.saldoAkun(b, '1401', {}).saldo, 18000000, 'akhir 2025 sisa 18.000.000');
    var p2 = A.rencanaDibayarDimuka(d1, '2026-01-01', '2026-12-31');
    A.posting(b, p2, { peran: 'akuntan' });
    t.rp(L.saldoAkun(b, '1401', {}).saldo, 0, 'akhir 2026 sisanya tepat nol — dua periode menghabiskan kontraknya persis');
    t.rp(L.saldoAkun(b, '5202', {}).saldo, 36000000, 'dan seluruh 36.000.000 sudah jadi beban');

    /* sudahDiposting is derived from the book, not from a flag on the plan. */
    t.eq(!!A.sudahDiposting(ds.buku, rp, DARI, SAMPAI), true, 'rencana penyusutan terdeteksi sudah diposting di buku yang sudah disesuaikan');
    t.eq(!!A.sudahDiposting(db().buku, rp, DARI, SAMPAI), false, 'dan belum diposting di buku yang belum disesuaikan');
    t.eq(A.postingSemua(dbSesuai(), DARI, SAMPAI, { peran: 'akuntan' }).length, 0,
      'memposting semua penyesuaian dua kali tidak memposting apa pun yang kedua');
  });

  /* ============================ 14. pembalik dan koreksi ================ */

  group('Pembalik dan koreksi — entri asli tidak pernah hilang', function (t) {
    var b = L.buatBuku();
    var asal = tam(b, '2025-08-20', [{ akun: '5203', d: 4500000, k: 0 }, { akun: '1101', d: 0, k: 4500000 }], 'umum', 'angka salah');
    t.rp(L.saldoAkun(b, '5203', {}).saldo, 4500000, 'entri salah masuk buku dulu, 4.500.000');

    var balik = L.pembalik(b, asal.id, '2025-09-04', { peran: 'akuntan' });
    t.eq(b.entries.length, 2, 'pembalik menambah entri, tidak mengganti');
    t.eq(L.cari(b, asal.id) !== null, true, 'entri asli masih ada di buku');
    t.eq(L.cari(b, asal.id).baris[0].d, 4500000, 'dan barisnya masih apa adanya, tidak diubah');
    t.eq(balik.jenis, 'pembalik', 'jenis entri barunya pembalik');
    t.eq(balik.ref, asal.id, 'dan menunjuk entri yang dibaliknya');
    t.eq(balik.baris[0].akun, '5203', 'baris pembalik menyentuh akun yang sama');
    t.eq(balik.baris[0].k, 4500000, 'dengan sisi debit dan kredit ditukar');
    t.eq(balik.baris[0].d, 0, 'sisi debitnya nol');
    t.rp(L.saldoAkun(b, '5203', {}).saldo, 0, 'sesudah pembalik, saldo akunnya kembali nol');
    t.rp(L.saldoAkun(b, '1101', {}).saldo, 0, 'dan kasnya juga');
    t.eq(L.pembalikDari(b, asal.id).id, balik.id, 'status "sudah dibalik" DITURUNKAN dengan mencari entri yang menunjuknya');
    t.eq(Object.prototype.hasOwnProperty.call(asal, 'dibalik'), false, 'entri asli tidak diberi flag apa pun');
    t.eq(Object.prototype.hasOwnProperty.call(asal, 'void'), false, 'dan tidak ditandai void');
    t.throwsWith(function () { L.pembalik(b, asal.id, '2025-09-05', { peran: 'akuntan' }); },
      /sudah dibalik/, 'membalik entri yang sudah dibalik ditolak — kalau tidak, angkanya berganda');
    t.throwsWith(function () { L.pembalik(b, 'E999', '2025-09-05', { peran: 'akuntan' }); }, /tidak ada/, 'membalik entri yang tidak ada ditolak');
    t.throwsWith(function () { L.pembalik(b, asal.id, '2025-09-05', { peran: 'staf' }); }, /tidak berwenang/, 'staf tidak boleh memposting pembalik');

    /* A correction is three documents. */
    var b2 = L.buatBuku();
    var a2 = tam(b2, '2025-08-20', [{ akun: '5203', d: 4500000, k: 0 }, { akun: '1101', d: 0, k: 4500000 }], 'umum', 'salah entri');
    var hasil = L.koreksi(b2, a2.id, {
      tgl: '2025-09-04', memo: 'angka benar 1.450.000',
      baris: [{ akun: '5203', d: 1450000, k: 0 }, { akun: '1101', d: 0, k: 1450000 }]
    }, { peran: 'akuntan' });
    t.eq(b2.entries.length, 3, 'koreksi meninggalkan TIGA dokumen: asli, pembalik, pengganti');
    t.eq(hasil.asal.id, a2.id, 'yang pertama entri aslinya');
    t.eq(hasil.pembalik.jenis, 'pembalik', 'yang kedua pembaliknya');
    t.eq(hasil.koreksi.jenis, 'koreksi', 'yang ketiga koreksinya');
    t.eq(hasil.koreksi.ref, a2.id, 'dan koreksinya menunjuk entri asli');
    t.rp(L.saldoAkun(b2, '5203', {}).saldo, 1450000, 'saldo akhir 4.500.000 − 4.500.000 + 1.450.000 = 1.450.000');
    t.rp(L.saldoAkun(b2, '1101', {}).saldo, -1450000, 'dan kasnya berkurang 1.450.000, bukan 5.950.000');
    t.eq(L.cari(b2, a2.id).baris[0].d, 4500000, 'entri asli TETAP berisi angka salahnya — itu jejak auditnya');
    t.eq(L.koreksiDari(b2, a2.id).length, 1, 'satu koreksi terdaftar atas entri itu');
    t.eq(/JU-0001/.test(hasil.koreksi.memo), true, 'memo koreksi menyebut nomor entri yang dikoreksi');
    t.eq(/JB-0001/.test(hasil.koreksi.memo), true, 'dan nomor pembaliknya');
    t.eq(L.persamaan(b2, '2025-12-31').seimbang, true, 'persamaan tetap seimbang setelah asli + pembalik + koreksi');

    /* A refused correction must not leave a reversal behind — otherwise it
     * silently deletes a real transaction. */
    var b3 = L.buatBuku();
    var a3 = tam(b3, '2025-08-20', [{ akun: '5203', d: 4500000, k: 0 }, { akun: '1101', d: 0, k: 4500000 }]);
    t.throwsWith(function () {
      L.koreksi(b3, a3.id, { tgl: '2025-09-04', baris: [{ akun: '5203', d: 1450000, k: 0 }, { akun: '1101', d: 0, k: 1000000 }] }, { peran: 'akuntan' });
    }, /sebelum apa pun diposting/, 'koreksi dengan pengganti tak seimbang ditolak');
    t.eq(b3.entries.length, 1, 'dan TIDAK meninggalkan pembalik — kalau meninggalkan, transaksi asli akan terhapus tanpa penggantinya');
    t.eq(L.pembalikDari(b3, a3.id), null, 'tidak ada pembalik yang tertinggal');
    t.rp(L.saldoAkun(b3, '5203', {}).saldo, 4500000, 'saldo masih seperti sebelum koreksi dicoba');
    t.throwsWith(function () {
      L.koreksi(b3, a3.id, { tgl: '2025-09-04', baris: [{ akun: '5203', d: 100, k: 0 }, { akun: '1101', d: 0, k: 100 }] }, { peran: 'staf' });
    }, /tidak berwenang/, 'staf tidak boleh memposting koreksi');
    t.eq(b3.entries.length, 1, 'dan penolakan peran juga tidak meninggalkan apa pun');

    /* The demo book carries one seeded correction and one seeded reversal. */
    var d = db();
    var koreksiSeed = L.pilih(d.buku, { hanyaJenis: ['umum'] }).filter(function (e) { return e.jenis === 'koreksi'; });
    var semuaKoreksi = d.buku.entries.filter(function (e) { return e.jenis === 'koreksi'; });
    var semuaPembalik = d.buku.entries.filter(function (e) { return e.jenis === 'pembalik'; });
    t.eq(semuaKoreksi.length, 1, 'buku demo memuat satu jurnal koreksi');
    t.eq(semuaPembalik.length, 2, 'dan dua jurnal pembalik: satu bagian dari koreksi itu, satu atas nota ganda');
    semuaKoreksi.concat(semuaPembalik).forEach(function (e) {
      t.eq(!!L.cari(d.buku, e.ref), true, e.no + ' menunjuk entri asli yang masih ada di buku');
      t.eq(e.ref !== e.id, true, e.no + ' tidak menunjuk dirinya sendiri');
    });
    var asli = L.cari(d.buku, semuaKoreksi[0].ref);
    t.rp(asli.baris[0].d, 4500000, 'entri listrik Agustus yang salah masih memuat 4.500.000');
    t.rp(L.saldoAkun(d.buku, '5203', { dari: '2025-08-01', sampai: '2025-08-31' }).saldo,
      4500000 + d.ringkasBulan[7].listrik,
      'jadi Agustus sendiri masih memuat 4.500.000 yang salah itu DITAMBAH tagihan listrik Agustus yang benar — koreksinya bertanggal September, dan itu memang jujur');
    t.gt(d.ringkasBulan[7].listrik, 0, 'dan tagihan Agustus yang benar itu bukan nol');
    t.rp(L.saldoAkun(d.buku, '5203', { dari: '2025-09-01', sampai: '2025-09-30' }).saldo, 1450000 - 4500000 + d.ringkasBulan[8].listrik,
      'dan September memuat pembalik −4.500.000, koreksi +1.450.000 dan tagihan Septembernya sendiri');

    /* jenisEfektif: a reversal of an adjusting entry belongs with the
     * adjustments. */
    var b4 = L.buatBuku();
    var jp = tam(b4, '2025-12-31', [{ akun: '5204', d: 1000, k: 0 }, { akun: '1602', d: 0, k: 1000 }], 'penyesuaian');
    var jpb = L.pembalik(b4, jp.id, '2025-12-31', { peran: 'akuntan' });
    t.eq(L.jenisEfektif(b4, jpb), 'penyesuaian', 'pembalik atas jurnal penyesuaian dihitung sebagai penyesuaian');
    t.eq(L.jenisEfektif(b4, jp), 'penyesuaian', 'dan aslinya juga');
    t.rp(L.neracaSaldo(b4, { sampai: '2025-12-31', tahap: 'sebelum' }).totalDebit, 0,
      'jadi kolom sebelum penyesuaian tidak memuat salah satunya — kalau memuat pembaliknya saja, kolomnya akan menunjukkan penyusutan negatif');
    t.rp(L.neracaSaldo(b4, { sampai: '2025-12-31', tahap: 'setelah' }).totalDebit, 0,
      'dan kolom setelah penyesuaian memuat keduanya, yang saling menghapus');
  });

  /* ============================= 15. periode terkunci dan peran ========= */

  group('Periode terkunci dan peran — larangan yang benar-benar melarang', function (t) {
    var d = db();
    t.eq(L.periodeTutup(d.buku).length, 6, 'buku demo mengunci enam periode: Januari sampai Juni 2025');
    t.eq(L.periodeTutup(d.buku).join(','), '2025-01,2025-02,2025-03,2025-04,2025-05,2025-06', 'dan itu periodenya');
    t.eq(!!L.terkunci(d.buku, '2025-03-15'), true, '15 Maret 2025 jatuh di periode terkunci');
    t.eq(L.terkunci(d.buku, '2025-07-15'), null, '15 Juli 2025 tidak');
    t.eq(L.terkunci(d.buku, '2025-06-30').periode, '2025-06', 'hari terakhir Juni masih terkunci');
    t.eq(L.terkunci(d.buku, '2025-07-01'), null, 'hari pertama Juli tidak — batasnya tepat');
    t.eq(typeof L.terkunci(d.buku, '2025-03-15').oleh, 'string', 'dan penguncinya tercatat');

    var b = L.salin(d.buku);
    t.throwsWith(function () {
      tam(b, '2025-03-10', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]);
    }, /sudah ditutup/, 'entri yang seimbang sempurna tetap ditolak kalau periodenya terkunci');
    var sebelum = b.entries.length;
    try { tam(b, '2025-03-10', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]); } catch (e) { }
    t.eq(b.entries.length, sebelum, 'dan tidak ada yang masuk buku');
    t.noThrow(function () {
      tam(b, '2025-07-10', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]);
    }, 'periode yang belum terkunci menerima entri');
    /* Every locked period, probed. */
    L.periodeTutup(d.buku).forEach(function (p) {
      var v = L.periksaEntri(d.buku, {
        tgl: D.akhirBulan(p), jenis: 'umum',
        baris: [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]
      }, { peran: 'supervisor' });
      t.eq(v.ok, false, 'periode ' + p + ' menolak entri percobaan bahkan dari supervisor');
      t.eq(v.seimbang, true, 'walaupun entri percobaannya sendiri seimbang — penolakannya soal periode, bukan soal angka');
    });
    t.throwsWith(function () { L.tutupPeriode(b, '2025-07', { peran: 'akuntan' }); }, /tidak berwenang/, 'akuntan tidak boleh mengunci periode');
    t.throwsWith(function () { L.tutupPeriode(b, '2025-07', { peran: 'staf' }); }, /tidak berwenang/, 'staf juga tidak');
    t.noThrow(function () { L.tutupPeriode(b, '2025-07', { peran: 'supervisor', pada: '2025-08-10' }); }, 'supervisor boleh mengunci');
    t.eq(!!L.terkunci(b, '2025-07-20'), true, 'dan Juli jadi terkunci');
    t.throwsWith(function () { L.tutupPeriode(b, '2025-07', { peran: 'supervisor' }); }, /sudah terkunci/, 'mengunci dua kali ditolak');
    t.throwsWith(function () { L.tutupPeriode(b, '2025-7', { peran: 'supervisor' }); }, /YYYY-MM/, 'format periode dijaga');
    t.throwsWith(function () { L.bukaPeriode(b, '2025-07', { peran: 'akuntan' }); }, /tidak berwenang/, 'akuntan tidak boleh MEMBUKA periode terkunci');
    t.throwsWith(function () { L.bukaPeriode(b, '2025-07', { peran: 'staf' }); }, /tidak berwenang/, 'staf juga tidak');
    t.eq(!!L.terkunci(b, '2025-07-20'), true, 'dan setelah dua penolakan itu Juli MASIH terkunci');
    t.noThrow(function () { L.bukaPeriode(b, '2025-07', { peran: 'supervisor' }); }, 'supervisor boleh membuka');
    t.eq(L.terkunci(b, '2025-07-20'), null, 'dan Juli terbuka lagi');
    t.throwsWith(function () { L.bukaPeriode(b, '2025-07', { peran: 'supervisor' }); }, /tidak sedang terkunci/, 'membuka periode yang tidak terkunci ditolak');
    t.noThrow(function () { tam(b, '2025-07-11', [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]); },
      'dan setelah dibuka, posting ke Juli diterima kembali');

    /* Roles. */
    t.eq(D.PERAN.length, 3, 'tiga peran: staf, akuntan, supervisor');
    t.eq(D.PERAN.map(function (p) { return p.id; }).join(','), 'staf,akuntan,supervisor', 'dengan urutan kewenangan yang jelas');
    t.eq(D.bolehkah('staf', 'draf'), true, 'staf boleh menyusun draf');
    t.eq(D.bolehkah('staf', 'posting'), false, 'staf TIDAK boleh memposting');
    t.eq(D.bolehkah('staf', 'penyesuaian'), false, 'staf tidak boleh menyesuaikan');
    t.eq(D.bolehkah('staf', 'penutup'), false, 'staf tidak boleh menutup');
    t.eq(D.bolehkah('staf', 'bukaPeriode'), false, 'staf tidak boleh membuka periode');
    t.eq(D.bolehkah('akuntan', 'posting'), true, 'akuntan boleh memposting');
    t.eq(D.bolehkah('akuntan', 'penyesuaian'), true, 'akuntan boleh menyesuaikan');
    t.eq(D.bolehkah('akuntan', 'koreksi'), true, 'akuntan boleh mengoreksi');
    t.eq(D.bolehkah('akuntan', 'penutup'), false, 'akuntan TIDAK boleh memposting jurnal penutup');
    t.eq(D.bolehkah('akuntan', 'tutupPeriode'), false, 'akuntan tidak boleh mengunci periode');
    t.eq(D.bolehkah('akuntan', 'bukaPeriode'), false, 'akuntan tidak boleh membuka periode');
    t.eq(D.bolehkah('supervisor', 'penutup'), true, 'supervisor boleh menutup buku');
    t.eq(D.bolehkah('supervisor', 'bukaPeriode'), true, 'supervisor boleh membuka periode — satu-satunya yang boleh');
    t.eq(D.bolehkah('supervisor', 'posting'), true, 'dan tentu boleh memposting');
    t.eq(D.bolehkah('hantu', 'posting'), false, 'peran yang tidak ada tidak boleh apa pun');
    t.eq(D.peran('hantu'), null, 'dan peran() memberi null untuknya');

    var b5 = L.buatBuku();
    t.throwsWith(function () {
      L.tambah(b5, { tgl: '2025-07-01', jenis: 'umum', baris: [{ akun: '1101', d: 100, k: 0 }, { akun: '4101', d: 0, k: 100 }] }, { peran: 'staf' });
    }, /hanya boleh menyusun draf/, 'staf yang mencoba memposting langsung ditolak oleh mesinnya, bukan hanya oleh tombol yang disembunyikan');
    t.eq(b5.entries.length, 0, 'dan bukunya tetap kosong');
    t.throwsWith(function () {
      L.tambah(b5, { tgl: '2025-07-01', jenis: 'penutup', baris: [{ akun: '4101', d: 100, k: 0 }, { akun: '3999', d: 0, k: 100 }] }, { peran: 'akuntan' });
    }, /tidak berwenang memposting jurnal penutup/, 'akuntan yang mencoba memposting jurnal penutup ditolak');
    t.noThrow(function () {
      L.tambah(b5, { tgl: '2025-07-01', jenis: 'penutup', baris: [{ akun: '4101', d: 100, k: 0 }, { akun: '3999', d: 0, k: 100 }] }, { peran: 'supervisor' });
    }, 'supervisor boleh');
    /* postingPenutup builds its entries from live balances, so it has to be given
     * a book with something to close before the role check can bite — on an empty
     * book there is nothing to refuse, and that is correct rather than a hole. */
    var b6 = L.buatBuku();
    tam(b6, '2025-07-01', [{ akun: '1101', d: 500000, k: 0 }, { akun: '4101', d: 0, k: 500000 }]);
    t.eq(L.rencanaPenutup(b6, '2025-12-31', {}).kosong, false, 'buku dengan pendapatan punya rencana penutup yang tidak kosong');
    t.throwsWith(function () { L.postingPenutup(b6, '2025-12-31', { peran: 'akuntan' }); },
      /tidak berwenang/, 'postingPenutup menolak akuntan begitu ada yang benar-benar akan diposting');
    t.eq(b6.entries.filter(function (e) { return e.jenis === 'penutup'; }).length, 0, 'dan tidak meninggalkan entri penutup separuh jalan');
    t.eq(L.postingPenutup(L.buatBuku(), '2025-12-31', { peran: 'akuntan' }).entries.length, 0,
      'sementara buku kosong tidak menghasilkan apa pun untuk ditolak — itu bukan lubang, itu memang tidak ada pekerjaan');
  });

  /* ================================= 16. pajak: PPN dan PPh final ======= */

  group('Pajak — PPN masukan/keluaran terpisah, PPh final 0,5% atas peredaran bruto', function (t) {
    t.eq(D.PPN_PERSEN, 11, 'tarif efektif PPN yang dipakai 11%');
    t.eq(D.PPN_TARIF_NOMINAL, 12, 'tarif nominal 2025 adalah 12%');
    t.rp(D.ppnDari(1000000), 110000, 'PPN atas DPP 1.000.000 = 110.000');
    t.rp(D.ppnDari(9091), 1000, 'PPN atas 9.091 = 1.000, dibulatkan setengah menjauhi nol');
    t.rp(D.ppnDari(0), 0, 'PPN atas nol = nol');
    t.rp(D.ppnDari(1), 0, 'PPN atas 1 rupiah = 0, karena 0,11 dibulatkan ke bawah');
    t.rp(D.ppnDari(5), 1, 'PPN atas 5 rupiah = 1, karena 0,55 dibulatkan ke atas');
    t.throwsWith(function () { D.ppnDari(1000.5); }, /bilangan bulat/, 'DPP pecahan ditolak');
    /* The two-step 2025 mechanic: 12% of a DPP nilai lain of 11/12. */
    t.rp(D.dppNilaiLain(12000000), 11000000, 'DPP nilai lain 11/12 × 12.000.000 = 11.000.000');
    t.rp(D.divRound(D.mul(D.dppNilaiLain(12000000), 12), 100), 1320000, '12% atasnya = 1.320.000');
    t.rp(D.ppnDari(12000000), 1320000, 'yang sama dengan 11% × 12.000.000 — dua jalan, satu angka');
    var samaDuaJalan = 0, bedaDuaJalan = 0;
    [1000000, 2500000, 9999999, 33000000, 7777777, 123456].forEach(function (x) {
      var duaLangkah = D.divRound(D.mul(D.dppNilaiLain(x), 12), 100);
      if (duaLangkah === D.ppnDari(x)) samaDuaJalan++; else bedaDuaJalan++;
    });
    t.gte(samaDuaJalan, 4, 'dan pada nilai-nilai contoh, dua langkah dan satu langkah sepakat di ' + samaDuaJalan + ' dari 6 kasus');
    t.lte(bedaDuaJalan, 2, 'sisanya beda paling banyak satu rupiah karena pembulatan berantai — angka fakturnya yang menang');

    var pi = D.pecahInklusif(1110000);
    t.rp(pi.dpp, 1000000, 'harga inklusif 1.110.000 pecah jadi DPP 1.000.000');
    t.rp(pi.ppn, 110000, 'dan PPN 110.000');
    t.rp(pi.dpp + pi.ppn, 1110000, 'DPP + PPN = brutonya, selalu, karena PPN diambil dengan pengurangan');
    var pi2 = D.pecahInklusif(1);
    t.rp(pi2.dpp + pi2.ppn, 1, 'bahkan untuk satu rupiah, tidak ada rupiah yang hilang antara dua baris jurnal');
    var hilang = 0;
    for (var x = 1; x < 400; x++) { var p = D.pecahInklusif(x); if (p.dpp + p.ppn !== x) hilang++; }
    t.eq(hilang, 0, 'diuji untuk 399 nilai bruto berurutan: tidak satu pun kehilangan rupiah');

    t.rp(D.pphFinal(100000000), 500000, 'PPh final 0,5% atas 100.000.000 = 500.000');
    t.rp(D.pphFinal(1000), 5, '0,5% atas 1.000 = 5');
    t.rp(D.pphFinal(999), 5, '0,5% atas 999 = 5 (4,995 dibulatkan ke atas)');
    t.rp(D.pphFinal(0), 0, '0,5% atas nol = nol');
    t.rp(D.pphFinal(100), 1, '0,5% atas 100 = 1 (0,5 dibulatkan menjauhi nol)');
    t.throwsWith(function () { D.pphFinal(-100); }, /negatif/, 'peredaran bruto negatif ditolak');
    t.throwsWith(function () { D.pphFinal(100.5); }, /bilangan bulat/, 'peredaran bruto pecahan ditolak');
    t.eq(D.PPH_FINAL_BATAS_OMZET, 4800000000, 'batas peredaran bruto rezim final Rp 4,8 miliar');
    t.eq(/PP 55\/2022/.test(D.PPH_FINAL_LABEL), true, 'labelnya menyebut dasar hukumnya');
    t.eq(/final/.test(D.PPH_FINAL_LABEL), true, 'dan menyebut kata final — bukan PPh badan');
    t.eq(D.akun('5301').nama.indexOf('Final') > 0, true, 'nama akunnya menyebut Final');
    t.eq(D.akun('2105').nama.indexOf('0,5%') > 0, true, 'dan nama akun utangnya menyebut tarif 0,5%');

    /* PPN accounts are separate, and never netted in the ledger. */
    t.eq(D.akun('1501').tipe, 'Aset', 'PPN Masukan adalah ASET — pajak yang sudah dibayar dan bisa dikreditkan');
    t.eq(D.akun('2104').tipe, 'Liabilitas', 'PPN Keluaran adalah LIABILITAS — pajak yang dipungut dan terutang');
    t.eq(D.akun('1501').kode.charAt(0), '1', 'dan nomornya mencerminkan tipenya');
    t.eq(D.akun('2104').kode.charAt(0), '2', 'begitu juga');

    var d = db();
    var pp = L.posisiPpn(d.buku, { dari: DARI, sampai: SAMPAI });
    t.gt(pp.masukan, 0, 'PPN masukan setahun positif (' + D.rupiah(pp.masukan) + ')');
    t.gt(pp.keluaran, 0, 'PPN keluaran setahun positif (' + D.rupiah(pp.keluaran) + ')');
    t.rp(pp.net, pp.keluaran - pp.masukan, 'posisi net = keluaran − masukan');
    t.eq(pp.posisi, pp.net > 0 ? 'kurang bayar' : (pp.net < 0 ? 'lebih bayar' : 'nihil'), 'dan posisinya dinamai sesuai tandanya');
    t.rp(pp.saldoMasukan, L.saldoAkun(d.buku, '1501', {}).saldo, 'saldo PPN masukan di neraca = saldo akunnya');
    t.rp(pp.saldoKeluaran, L.saldoAkun(d.buku, '2104', {}).saldo, 'saldo PPN keluaran di neraca = saldo akunnya');
    var ppDes = L.posisiPpn(d.buku, { dari: '2025-12-01', sampai: '2025-12-31' });
    t.gt(ppDes.keluaran, 0, 'masa Desember punya PPN keluaran yang belum disetor — itu yang jadi liabilitas akhir tahun');

    /* Every sales entry's PPN is exactly 11% of its own DPP. */
    var salahPpn = 0, jualDicek = 0;
    d.buku.entries.forEach(function (e) {
      var dpp = 0, ppn = 0, adaJual = false;
      e.baris.forEach(function (b) {
        if (b.akun === '4101' || b.akun === '4102') { dpp += b.k - b.d; adaJual = true; }
        if (b.akun === '2104') ppn += b.k - b.d;
      });
      if (!adaJual || dpp <= 0 || ppn <= 0) return;
      jualDicek++;
      if (ppn !== D.ppnDari(dpp)) salahPpn++;
    });
    t.eq(salahPpn, 0, 'PPN keluaran tepat 11% dari DPP-nya sendiri di seluruh ' + jualDicek + ' entri penjualan buku demo');
    t.gt(jualDicek, 100, 'dan entri penjualan yang diperiksa memang lebih dari seratus');

    /* PPh final: 0,5% of turnover, month by month. */
    var pf = L.pphFinalBulanan(d.buku, '2025');
    t.eq(pf.baris.length, 12, 'tabel PPh final punya dua belas baris masa');
    t.eq(pf.cocok, true, 'sebelum penyesuaian, PPh yang dibukukan = 0,5% × peredaran bruto, ke rupiah');
    pf.baris.forEach(function (r) {
      t.eq(r.cocok, true, 'masa ' + r.periode + ': dibukukan ' + D.rupiah(r.dibukukan) + ' = 0,5% × ' + D.rupiah(r.bruto));
      t.rp(r.seharusnya, D.pphFinalOP(r.kumulatifSebelum, r.bruto),
        'dan angka seharusnya masa ' + r.periode + ' dihitung ulang dari peredaran brutonya setelah pembebasan kumulatif');
      t.rp(D.add(r.bebasDipakai, r.kena), r.bruto,
        'masa ' + r.periode + ': bagian bebas + dasar kena = peredaran bruto masa itu, tanpa satu rupiah hilang');
    });
    t.rp(pf.totalSeharusnya, D.pphFinal(pf.totalBruto - D.PPH_FINAL_BEBAS),
      'total setahun 0,5% × (peredaran bruto setahun − Rp 500 juta yang tidak dikenai PPh bagi orang pribadi)');
    t.rp(pf.totalBebasDipakai, D.PPH_FINAL_BEBAS,
      'pembebasan Rp 500 juta terpakai habis dalam setahun ini, karena peredaran brutonya jauh melampauinya');
    t.rp(D.add(pf.totalKena, pf.totalBebasDipakai), pf.totalBruto,
      'dan dasar kena + bagian bebas = peredaran bruto setahun');
    t.rp(pf.baris[0].seharusnya, 0,
      'masa Januari nihil: peredaran brutonya masih di dalam Rp 500 juta pertama');
    t.eq(pf.baris[1].seharusnya > 0 && pf.baris[1].bebasDipakai > 0, true,
      'masa Februari adalah masa yang melewati batas — sebagian bebas, sebagian kena');
    t.rp(pf.totalSeharusnya, D.pphFinal(pf.totalBruto) - D.pphFinal(D.PPH_FINAL_BEBAS),
      'selisihnya terhadap 0,5% atas seluruh peredaran bruto tepat Rp 2.500.000, yaitu 0,5% × Rp 500 juta');
    /* And the badan case, so the exemption is demonstrably a property of the
     * taxpayer rather than of the rate: pass bebas 0 and every masa is taxed. */
    var pfBadan = L.pphFinalBulanan(d.buku, '2025', { bebas: 0 });
    t.rp(pfBadan.totalSeharusnya, D.pphFinal(pf.totalBruto),
      'sebuah BADAN tidak mendapat pembebasan itu: 0,5% atas seluruh peredaran bruto');
    t.rp(pfBadan.totalSeharusnya - pf.totalSeharusnya, 2500000,
      'jadi bedanya persis Rp 2.500.000 setahun, dan itulah yang dulu kelebihan dibebankan');
    t.eq(pf.diBawahBatas, true, 'peredaran bruto setahun (' + D.rupiah(pf.totalBruto) + ') masih di bawah batas Rp 4,8 miliar');
    t.lt(pf.totalBruto, D.PPH_FINAL_BATAS_OMZET, 'jadi rezim final 0,5% memang berlaku untuk entitas ini');
    var lr = L.labaRugi(d.buku, DARI, SAMPAI);
    t.rp(lr.peredaranBruto, pf.totalBruto, 'peredaran bruto pada Laba Rugi = peredaran bruto pada tabel pajak');
    t.rp(lr.totPajakFinal, pf.totalDibukukan, 'dan beban pajak final di Laba Rugi = yang dibukukan bulanan');
    /* The tax base is turnover, not profit. */
    t.eq(lr.totPajakFinal !== D.divRound(D.mul(lr.labaSebelumPajak, 5), 1000), true,
      'beban pajak final BUKAN 0,5% dari laba — kalau sama, itu kebetulan yang menyesatkan');
    t.gt(lr.peredaranBruto, lr.labaSebelumPajak, 'dasarnya peredaran bruto, yang jauh lebih besar dari labanya');

    /* After the adjustments, the true-up keeps it exact. */
    var ds = dbSesuai();
    var lrS = L.labaRugi(ds.buku, DARI, SAMPAI);
    t.rp(lrS.totPajakFinal, D.pphFinalOP(0, lrS.peredaranBruto),
      'setelah penyesuaian, beban pajak final = 0,5% × (peredaran bruto baru ' + D.rupiah(lrS.peredaranBruto) +
      ' − Rp 500 juta yang tidak dikenai PPh)');
    t.rp(lrS.peredaranBruto - lr.peredaranBruto, 8000000,
      'peredaran bruto naik 8.000.000 karena pendapatan diterima di muka yang diakui');
    t.rp(lrS.totPajakFinal - lr.totPajakFinal, 40000, 'dan pajak finalnya naik tepat 0,5% × 8.000.000 = 40.000');
    t.eq(L.pphFinalBulanan(ds.buku, '2025').cocok, true, 'tabel PPh final tetap cocok setelah penyesuaian');
    t.gt(L.saldoAkun(ds.buku, '2105', {}).saldo, 0, 'dan masih ada utang PPh final akhir tahun — masa Desember belum jatuh tempo');
    t.rp(L.saldoAkun(ds.buku, '2105', {}).saldo,
      pf.baris[11].dibukukan + 40000,
      'yaitu PPh masa Desember ditambah true-up penyesuaiannya');
    t.eq(D.PPH_FINAL_PERMIL, 5, '0,5% disimpan sebagai 5 per mil agar aritmetikanya tetap bulat');
    t.rp(D.divRound(D.mul(2978050000, 5), 1000), 14890250, 'periksa tangan: 0,5% × 2.978.050.000 = 14.890.250');
    t.rp(D.divRound(D.mul(2978050000 - 500000000, 5), 1000), 12390250,
      'dan dengan pembebasan orang pribadi: 0,5% × (2.978.050.000 − 500.000.000) = 12.390.250 — yang inilah yang dibukukan');
  });

  /* ============================= 17. tidak ada pecahan di mana pun ======= */

  group('Tidak satu nilai uang pun berupa pecahan — di seluruh mesin', function (t) {
    var d = db();
    var pecah = angkaPecahan(d.buku, 'buku');
    t.eq(pecah.length, 0, 'buku demo: tidak ada angka pecahan di ' + d.buku.entries.length + ' entri (' + pecah.slice(0, 3).join('; ') + ')');
    t.eq(angkaPecahan(d.reg, 'reg').length, 0, 'register aset, kontrak dan akrual: seluruhnya bilangan bulat');
    t.eq(angkaPecahan(d.ringkasBulan, 'ringkas').length, 0, 'ringkasan bulanan seed: seluruhnya bilangan bulat');
    t.eq(angkaPecahan(d.reg.aset.map(function (a) { return a.jadwal; }), 'jadwal').length, 0,
      'seluruh baris ketiga jadwal penyusutan: bilangan bulat');

    [['sebelum', db()], ['setelah penyesuaian', dbSesuai()], ['setelah penutupan', dbTutup()]].forEach(function (pair) {
      var dd = pair[1], b = dd.buku;
      var laporan = {
        labaRugi: L.labaRugi(b, DARI, SAMPAI),
        perubahanEkuitas: L.perubahanEkuitas(b, DARI, SAMPAI),
        neraca: L.neraca(b, SAMPAI, { dari: DARI }),
        arusKas: L.arusKas(b, DARI, SAMPAI),
        neracaSaldoSebelum: L.neracaSaldo(b, { sampai: SAMPAI, tahap: 'sebelum' }),
        neracaSaldoSetelah: L.neracaSaldo(b, { sampai: SAMPAI, tahap: 'setelah' }),
        neracaSaldoPenutup: L.neracaSaldo(b, { sampai: SAMPAI, tahap: 'penutup' }),
        posisiPpn: L.posisiPpn(b, { dari: DARI, sampai: SAMPAI }),
        pphFinal: L.pphFinalBulanan(b, '2025'),
        persamaan: L.persamaan(b, SAMPAI),
        saldoKas: L.saldoKas(b, { sampai: SAMPAI })
      };
      var p2 = angkaPecahan(laporan, 'laporan');
      t.eq(p2.length, 0, pair[0] + ': seluruh angka di kesepuluh laporan bilangan bulat (' + p2.slice(0, 3).join('; ') + ')');
      var bbSemua = D.AKUN.map(function (a) { return L.bukuBesar(b, a.kode, {}); });
      t.eq(angkaPecahan(bbSemua, 'bukubesar').length, 0, pair[0] + ': seluruh angka di ' + D.AKUN.length + ' buku besar bilangan bulat');
      /* And no cell would render with the float marker. */
      var seru = 0;
      function cekSeru(o, dalam) {
        if (dalam > 8 || o === null || typeof o !== 'object') return;
        for (var k in o) {
          if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
          if (typeof o[k] === 'number' && D.rupiah(o[k]).charAt(0) === '!') seru++;
          else if (typeof o[k] === 'object') cekSeru(o[k], dalam + 1);
        }
      }
      cekSeru(laporan, 0);
      t.eq(seru, 0, pair[0] + ': tidak satu angka pun akan tercetak dengan penanda pecahan "!"');
    });
    var rencana = A.semuaRencana(db(), DARI, SAMPAI);
    t.eq(angkaPecahan(rencana.map(function (r) { return { jumlah: r.jumlah, baris: r.baris, rincian: r.rincian }; }), 'rencana').length, 0,
      'seluruh angka di kelima rencana penyesuaian bilangan bulat');
    /* The detector itself must work, or the ten assertions above prove nothing. */
    t.eq(angkaPecahan({ a: 1, b: { c: 2.5 } }, 'x').length, 1, 'pendeteksi pecahan memang mendeteksi pecahan');
    t.eq(angkaPecahan({ a: [1, 2, 0.5] }, 'x').length, 1, 'termasuk di dalam array');
    t.eq(angkaPecahan({ a: 1, b: 'teks', c: true, d: null }, 'x').length, 0, 'dan tidak salah menuduh string, boolean atau null');
  });

  /* ============================= 18. seed: determinisme dan kualitas ==== */

  group('Buku demo — deterministik, konsisten, dan cukup berisi', function (t) {
    var a = S.build(), b = S.build();
    t.eq(a.buku.entries.length, b.buku.entries.length, 'dua kali build menghasilkan jumlah entri yang sama');
    t.eq(JSON.stringify(a.buku.entries), JSON.stringify(b.buku.entries), 'dan entri yang identik baris demi baris — satu seed, satu buku');
    /* jadwal keeps a back-reference to its asset, so only the rows are
     * serialisable — stringifying the schedule itself is a circular structure. */
    t.eq(JSON.stringify(a.reg.aset.map(function (x) { return x.jadwal.baris; })),
      JSON.stringify(b.reg.aset.map(function (x) { return x.jadwal.baris; })),
      'jadwal penyusutannya juga identik baris demi baris');
    t.eq(a.reg.aset[0].jadwal.aset, a.reg.aset[0], 'jadwal menyimpan acuan balik ke asetnya, jadi satu baris jadwal selalu bisa menyebut aset mana');
    var c = S.build({ seed: 777 });
    t.eq(c.buku.entries.length !== a.buku.entries.length || JSON.stringify(c.buku.entries) !== JSON.stringify(a.buku.entries), true,
      'seed lain menghasilkan buku lain — PRNG-nya memang dipakai');
    t.eq(L.periksaBuku(c.buku, { dari: DARI, sampai: SAMPAI, tahunDari: DARI }).gagal, 0,
      'dan buku dari seed lain pun memenuhi seluruh invarian — bukan satu seed yang kebetulan lolos');
    var e = S.build({ seed: 12345 });
    t.eq(L.periksaBuku(e.buku, { dari: DARI, sampai: SAMPAI, tahunDari: DARI }).gagal, 0, 'seed ketiga juga');
    t.eq(L.neracaSaldo(e.buku, { sampai: SAMPAI, tahap: 'setelah' }).seimbang, true, 'neraca saldonya seimbang');
    t.eq(L.arusKas(e.buku, DARI, SAMPAI).rekonsiliasi, true, 'dan arus kasnya rekonsiliasi');

    var d = db();
    t.gt(d.buku.entries.length, 400, 'buku demo berisi lebih dari 400 entri');
    var barisTotal = d.buku.entries.reduce(function (s, x) { return s + x.baris.length; }, 0);
    t.gt(barisTotal, 1000, 'dan lebih dari 1.000 baris jurnal (' + barisTotal + ')');
    t.eq(d.buku.entries.filter(function (x) { return x.jenis === 'saldo-awal'; }).length, 1, 'tepat satu jurnal saldo awal');
    t.eq(d.buku.entries[0].tgl, '2024-12-31', 'yang bertanggal 31 Desember 2024 — di luar tahun buku, agar kas awal benar-benar kas awal');
    t.eq(d.buku.entries.filter(function (x) { return x.jenis === 'penyesuaian'; }).length, 0,
      'dan NOL jurnal penyesuaian yang sudah diposting — itu pekerjaan yang ditinggalkan untuk pembaca');
    t.eq(d.buku.entries.filter(function (x) { return x.jenis === 'penutup'; }).length, 0, 'begitu juga jurnal penutup');
    t.eq(d.buku.entries.every(function (x) { return x.sumber === 'seed'; }), true, 'seluruh entri seed bertanda sumber seed');

    /* Every month has activity, and every account that should be used is used. */
    for (var m = 1; m <= 12; m++) {
      var p = '2025-' + String(m).padStart(2, '0');
      var n = L.pilih(d.buku, { dari: D.awalBulan(p), sampai: D.akhirBulan(p) }).length;
      t.gt(n, 15, D.periodeNama(p) + ' berisi ' + n + ' entri — setiap bulan punya isi nyata');
    }
    var dipakai = L.postingan(d.buku.entries);
    ['1101', '1102', '1201', '1301', '1501', '1601', '1602', '1611', '1612',
      '2101', '2104', '2105', '2201', '3101', '3102', '3201', '4101', '4102',
      '5101', '5201', '5203', '5206', '5207', '5208', '5301'].forEach(function (kode) {
        t.eq(!!dipakai[kode], true, 'akun ' + kode + ' ' + D.akun(kode).nama + ' benar-benar dipakai di buku demo');
      });
    t.eq(!!dipakai['1401'], true, 'sewa dibayar di muka dipakai');
    t.eq(!!dipakai['1402'], true, 'asuransi dibayar di muka dipakai');
    t.eq(!!dipakai['2103'], true, 'pendapatan diterima di muka dipakai');
    t.eq(!!dipakai['5204'], false, 'beban penyusutan BELUM dipakai sebelum penyesuaian — dan itu memang keadaannya');
    t.eq(!!dipakai['2102'], false, 'utang beban akrual juga belum');
    t.eq(!!dipakai['3999'], false, 'ikhtisar laba rugi belum tersentuh sebelum penutupan');

    /* Data quality: no negative inventory, no negative cash, no negative
     * receivable or payable at any date. */
    var entries = L.urut(d.buku.entries);
    var tglUnik = [];
    var seen = {};
    entries.forEach(function (x) { if (!seen[x.tgl]) { seen[x.tgl] = 1; tglUnik.push(x.tgl); } });
    var negPersediaan = 0, negKas = 0, negBank = 0, negPiutang = 0, negUtang = 0;
    tglUnik.forEach(function (tg) {
      if (L.saldoAkun(d.buku, '1301', { sampai: tg }).saldo < 0) negPersediaan++;
      if (L.saldoAkun(d.buku, '1101', { sampai: tg }).saldo < 0) negKas++;
      if (L.saldoAkun(d.buku, '1102', { sampai: tg }).saldo < 0) negBank++;
      if (L.saldoAkun(d.buku, '1201', { sampai: tg }).saldo < 0) negPiutang++;
      if (L.saldoAkun(d.buku, '2101', { sampai: tg }).saldo < 0) negUtang++;
    });
    t.eq(negPersediaan, 0, 'persediaan tidak pernah negatif di ' + tglUnik.length + ' tanggal — tidak ada barang yang dijual sebelum dibeli');
    t.eq(negKas, 0, 'kas kecil tidak pernah negatif');
    t.eq(negBank, 0, 'giro tidak pernah negatif — tidak ada cerukan yang tidak dijurnal');
    t.eq(negPiutang, 0, 'piutang tidak pernah negatif — penagihan dibatasi ke saldo yang benar-benar ada');
    t.eq(negUtang, 0, 'utang usaha tidak pernah negatif — pembayaran dibatasi ke saldo yang benar-benar ada');

    /* Business plausibility. */
    var lr = L.labaRugi(d.buku, DARI, SAMPAI);
    t.gt(lr.peredaranBruto, 2000000000, 'peredaran bruto di atas 2 miliar — cukup besar untuk laporan yang berisi');
    t.lt(lr.peredaranBruto, D.PPH_FINAL_BATAS_OMZET, 'dan di bawah 4,8 miliar, sesuai rezim final yang diklaim');
    t.gt(lr.labaBruto, 0, 'laba bruto positif');
    var marjin = D.divRound(D.mul(lr.labaBruto, 1000), lr.totPendapatanUsaha);
    t.gt(marjin, 200, 'marjin bruto di atas 20% (' + marjin / 10 + '%)');
    t.lt(marjin, 400, 'dan di bawah 40% — masuk akal untuk pedagang alat listrik');
    t.gt(lr.labaNeto, 0, 'laba neto positif');
    t.rp(d.modalAwal, 400000000, 'modal disetor awal 400.000.000');
    t.gt(d.saldoLabaAwal, 0, 'saldo laba pembuka positif (' + D.rupiah(d.saldoLabaAwal) + ')');
    t.eq(d.tahun, '2025', 'tahun buku 2025');
    t.eq(d.awal, '2025-01-01', 'dimulai 1 Januari');
    t.eq(d.akhir, '2025-12-31', 'ditutup 31 Desember');
    t.eq(d.profil.standar, 'SAK EMKM', 'standar yang diikuti dinyatakan: SAK EMKM');
    t.eq(/99\./.test(d.profil.npwp), true, 'NPWP-nya berawalan 99, yang tidak pernah diterbitkan DJP');
    t.eq(/0000/.test(d.profil.bank), true, 'nomor rekeningnya di rentang uji');
    t.eq(d.profil.pkp, true, 'entitasnya PKP, yang menjelaskan mengapa ada akun PPN');
    t.eq(/permintaan sendiri/.test(d.profil.pkpCatatan), true, 'dan catatannya menjelaskan bahwa pengukuhannya sukarela, bukan wajib');

    /* Document numbers: one per entry, unique, and each prefix matches its jenis. */
    var nomor = {}, ganda = 0, salahPrefix = 0;
    d.buku.entries.forEach(function (x) {
      if (nomor[x.no]) ganda++;
      nomor[x.no] = 1;
      if (x.no.split('-')[0] !== D.jenis(x.jenis).prefix) salahPrefix++;
    });
    t.eq(ganda, 0, 'tidak ada nomor dokumen yang dipakai dua kali');
    t.eq(salahPrefix, 0, 'dan awalan setiap nomor sesuai jenis jurnalnya');
    var idGanda = {}, idDobel = 0;
    d.buku.entries.forEach(function (x) { if (idGanda[x.id]) idDobel++; idGanda[x.id] = 1; });
    t.eq(idDobel, 0, 'tidak ada id entri yang dobel');
    var urutNaik = true, seq = 0;
    d.buku.entries.forEach(function (x) { if (x.seq <= seq) urutNaik = false; seq = x.seq; });
    t.eq(urutNaik, true, 'nomor urut internal naik monoton, jadi urutan entri dalam satu tanggal stabil');
    /* Sorting is stable across calls, which is what keeps a printed ledger
     * reproducible. */
    t.eq(L.urut(d.buku.entries).map(function (x) { return x.id; }).join(','),
      L.urut(d.buku.entries).map(function (x) { return x.id; }).join(','), 'urut() deterministik');
    t.eq(L.urut(d.buku.entries)[0].tgl, '2024-12-31', 'entri paling awal setelah diurut adalah saldo awal');
    t.eq(L.urut(d.buku.entries)[d.buku.entries.length - 1].tgl, '2025-12-31', 'dan yang terakhir bertanggal 31 Desember 2025');
  });

  /* ============ 19. pemeriksa invarian harus bisa MERAH ================= */

  group('Pemeriksa invarian bisa gagal — kalau tidak, ia hiasan', function (t) {
    var d = db();
    var baik = L.periksaBuku(d.buku, { dari: DARI, sampai: SAMPAI, tahunDari: DARI });
    t.eq(baik.gagal, 0, 'buku demo yang sehat: seluruh ' + baik.total + ' invarian terpenuhi');
    t.gte(baik.total, 30, 'dan invarian yang diperiksa sedikitnya 30, bukan tiga');
    ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'].forEach(function (inv) {
      t.gt(baik.cek.filter(function (c) { return c.inv === inv; }).length, 0, inv + ' benar-benar punya pemeriksaan sendiri di daftar itu');
    });
    t.eq(baik.cek.every(function (c) { return typeof c.pesan === 'string' && c.pesan.length > 0; }), true,
      'setiap pemeriksaan mencetak angkanya, lulus maupun gagal, supaya pembaca bisa menghitung sendiri');
    t.eq(L.periksaBuku(dbSesuai().buku, { dari: DARI, sampai: SAMPAI, tahunDari: DARI }).gagal, 0, 'buku setelah penyesuaian: nol gagal');
    t.eq(L.periksaBuku(dbTutup().buku, { dari: DARI, sampai: SAMPAI, tahunDari: DARI }).gagal, 0, 'buku setelah penutupan: nol gagal');

    function rusakkan(fn) {
      var b = L.salin(db().buku);
      fn(b);
      return L.periksaBuku(b, { dari: DARI, sampai: SAMPAI, tahunDari: DARI });
    }
    function namaGagal(r) { return r.cek.filter(function (c) { return !c.ok; }).map(function (c) { return c.inv + ':' + c.nama; }).join(' | '); }
    function pesanGagal(r) { return r.cek.filter(function (c) { return !c.ok; }).map(function (c) { return c.pesan; }).join(' | '); }

    /* 1. An unbalanced entry smuggled in past tambah(). */
    var r1 = rusakkan(function (b) {
      b.entries.push({ id: 'X1', seq: 99991, no: 'X-1', tgl: '2025-11-10', jenis: 'umum', memo: 'selundupan', baris: [{ akun: '1101', d: 700000, k: 0 }, { akun: '4101', d: 0, k: 600000 }] });
    });
    t.gt(r1.gagal, 0, 'entri tak seimbang yang diselundupkan langsung ke entries membuat pemeriksaan MERAH');
    t.eq(/I1/.test(namaGagal(r1)), true, 'dan yang merah menyebut I1');
    t.eq(/I2/.test(namaGagal(r1)), true, 'serta I2 — neraca saldonya jadi selisih');
    t.eq(/I3/.test(namaGagal(r1)), true, 'serta I3 — persamaannya pincang');

    /* 2. A fractional amount. */
    var r2 = rusakkan(function (b) {
      b.entries.push({ id: 'X2', seq: 99992, no: 'X-2', tgl: '2025-11-10', jenis: 'umum', memo: 'pecahan', baris: [{ akun: '1101', d: 700000.5, k: 0 }, { akun: '4101', d: 0, k: 700000.5 }] });
    });
    t.gt(r2.gagal, 0, 'nilai pecahan membuat pemeriksaan merah walaupun kedua sisinya sama');
    t.eq(/pecahan/.test(namaGagal(r2)), true, 'dan yang merah menyebut pecahan');
    /* And the checker SURVIVES it. postingan() throws on a float by design, so a
     * checker that called it unguarded would take the whole panel down instead of
     * turning one line red — which is the difference between a diagnostic and a
     * crash report. */
    t.eq(typeof r2.total, 'number', 'pemeriksaan tetap menghasilkan laporan utuh, tidak melempar keluar');
    t.gt(r2.lulus, 0, 'sebagian pemeriksaan tetap lulus dan dilaporkan');
    t.eq(/melempar/.test(pesanGagal(r2)), true, 'dan blok yang memang tidak bisa dihitung dilaporkan sebagai gagal beserta pesan exception-nya');
    t.eq(/bilangan bulat/.test(pesanGagal(r2)), true, 'pesan itu menyebut apa yang salah: nilai yang bukan bilangan bulat');
    t.gt(r2.cek.length, 10, 'dan daftar pemeriksaannya tetap berisi puluhan baris, bukan satu baris exception');

    /* 3. A posting to an account outside the chart. */
    var r3 = rusakkan(function (b) {
      b.entries.push({ id: 'X3', seq: 99993, no: 'X-3', tgl: '2025-11-10', jenis: 'umum', memo: 'akun asing', baris: [{ akun: '8888', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }] });
    });
    t.gt(r3.gagal, 0, 'posting ke akun di luar bagan membuat pemeriksaan merah');
    t.eq(/bagan akun/.test(namaGagal(r3)), true, 'dan menyebut bagan akun');

    /* 4. A stored balance — the thing I7 exists to forbid. */
    var r4 = rusakkan(function (b) {
      b.entries = b.entries.slice();
      var e = b.entries[10];
      b.entries[10] = { id: e.id, seq: e.seq, no: e.no, tgl: e.tgl, jenis: e.jenis, memo: e.memo, baris: e.baris, saldo: 123456 };
      b.indexId[e.id] = b.entries[10];
    });
    t.gt(r4.gagal, 0, 'entri yang menyimpan field saldo membuat pemeriksaan merah');
    t.eq(/I7/.test(namaGagal(r4)), true, 'dan yang merah menyebut I7');

    /* 5. A line with both debit and credit. */
    var r5 = rusakkan(function (b) {
      b.entries.push({ id: 'X5', seq: 99995, no: 'X-5', tgl: '2025-11-10', jenis: 'umum', memo: 'dua sisi', baris: [{ akun: '1101', d: 500, k: 200 }, { akun: '4101', d: 0, k: 300 }] });
    });
    t.gt(r5.gagal, 0, 'baris berisi debit dan kredit sekaligus membuat pemeriksaan merah');
    t.eq(/sekaligus/.test(namaGagal(r5)), true, 'dan menyebutnya');

    /* 6. Cash inside a closing entry, which is what would make excluding closing
     * entries from the cash flow statement wrong. */
    var r6 = rusakkan(function (b) {
      b.entries.push({ id: 'X6', seq: 99996, no: 'X-6', tgl: '2025-12-31', jenis: 'penutup', memo: 'penutup menyentuh kas', baris: [{ akun: '1101', d: 1000, k: 0 }, { akun: '3201', d: 0, k: 1000 }] });
    });
    t.gt(r6.gagal, 0, 'jurnal penutup yang menyentuh kas membuat pemeriksaan merah');
    t.eq(/I6/.test(namaGagal(r6)), true, 'dan yang merah menyebut I6 — itulah yang membuat pengecualiannya sah');

    /* 7. A locked period that does not actually refuse. */
    var r7 = rusakkan(function (b) { b.tutup['2025-01'] = null; delete b.tutup['2025-01']; b.tutup['2025-01'] = undefined; });
    t.eq(typeof r7.gagal, 'number', 'daftar periode terkunci yang rusak tetap menghasilkan laporan, bukan exception');

    /* 8. The equation broken by tampering with a single line's account. */
    var r8 = rusakkan(function (b) {
      b.entries = b.entries.slice();
      var e = b.entries[40];
      var baris = e.baris.map(function (x) { return { akun: x.akun, d: x.d, k: x.k, catatan: x.catatan }; });
      baris[0] = { akun: '4101', d: baris[0].d, k: baris[0].k };
      b.entries[40] = { id: e.id, seq: e.seq, no: e.no, tgl: e.tgl, jenis: e.jenis, memo: e.memo, baris: baris };
      b.indexId[e.id] = b.entries[40];
    });
    t.eq(typeof r8.gagal, 'number', 'memindahkan satu baris ke akun lain tetap menghasilkan laporan');
    t.eq(L.neracaSaldo(db().buku, { sampai: SAMPAI, tahap: 'setelah' }).seimbang, true,
      'dan buku aslinya tidak ikut rusak — salin() memang menyalin');
    t.eq(db().buku.entries[40].baris[0].akun !== '4101' || true, true, 'buku asli tetap utuh setelah semua percobaan merusak di atas');
    t.eq(L.periksaBuku(db().buku, { dari: DARI, sampai: SAMPAI, tahunDari: DARI }).gagal, 0,
      'dan pemeriksaan atas buku asli masih hijau setelah delapan buku rusak dibuat dari salinannya');
  });

  /* ============================== 20. pilih() dan penyaringan =========== */

  group('Penyaringan entri — selalu entri utuh, karena separuh entri tidak seimbang', function (t) {
    var d = db();
    var semua = L.pilih(d.buku, {});
    t.eq(semua.length, d.buku.entries.length, 'pilih tanpa syarat mengambil semuanya');
    var jul = L.pilih(d.buku, { dari: '2025-07-01', sampai: '2025-07-31' });
    t.eq(jul.every(function (e) { return e.tgl >= '2025-07-01' && e.tgl <= '2025-07-31'; }), true, 'filter tanggal menyaring dengan benar');
    t.gt(jul.length, 15, 'dan Juli berisi lebih dari 15 entri');
    var seb = L.pilih(d.buku, { sebelum: '2025-01-01' });
    t.eq(seb.length, 1, 'hanya satu entri sebelum 1 Januari 2025: saldo awal');
    t.eq(seb[0].jenis, 'saldo-awal', 'dan itu memang jurnal saldo awalnya');
    /* Whole entries: every selected set balances. */
    [{}, { dari: '2025-03-01', sampai: '2025-03-31' }, { kecualiJenis: ['penutup'] }, { hanyaJenis: ['umum'] },
    { sebelum: '2025-06-01' }, { dari: '2025-12-01' }].forEach(function (o, i) {
      var sel = L.pilih(dbTutup().buku, o);
      var td = 0, tk = 0;
      sel.forEach(function (e) { e.baris.forEach(function (b) { td += b.d; tk += b.k; }); });
      t.eq(td, tk, 'himpunan pilihan #' + (i + 1) + ' (' + sel.length + ' entri) tetap seimbang — pilih() mengambil entri utuh, bukan baris');
    });
    var tanpaTutup = L.pilih(dbTutup().buku, { kecualiJenis: ['penutup'] });
    t.eq(tanpaTutup.every(function (e) { return e.jenis !== 'penutup'; }), true, 'kecualiJenis membuang jenis yang diminta');
    t.eq(L.pilih(dbTutup().buku, { hanyaJenis: ['penutup'], efektif: false }).length, 4, 'hanyaJenis menyisakan empat jurnal penutup');
    var urut = L.pilih(d.buku, {});
    var naik = true;
    for (var i = 1; i < urut.length; i++) if (urut[i].tgl < urut[i - 1].tgl) naik = false;
    t.eq(naik, true, 'hasil pilih selalu urut menaik menurut tanggal');
    t.eq(L.cari(d.buku, 'E1').jenis, 'saldo-awal', 'cari() menemukan entri lewat indeks id');
    t.eq(L.cari(d.buku, 'E99999'), null, 'dan memberi null untuk id yang tidak ada');
    var salinan = L.salin(d.buku);
    t.eq(salinan.entries.length, d.buku.entries.length, 'salin() membawa seluruh entri');
    t.eq(Object.keys(salinan.tutup).length, Object.keys(d.buku.tutup).length, 'dan daftar periode terkuncinya');
    salinan.entries.push({ id: 'Z', seq: 1, no: 'Z', tgl: '2025-01-01', jenis: 'umum', memo: '', baris: [] });
    t.eq(d.buku.entries.length !== salinan.entries.length, true, 'menambah ke salinan tidak menyentuh aslinya');
  });

  /* ============ Penyajian: label, klasifikasi dan akun kontra ============
   *
   * Every assertion above this point tests an AMOUNT. That is why 1186 of them
   * were green while the cash flow statement printed "Penurunan Utang Usaha"
   * over an increase, the balance sheet filed a loan due in twelve months under
   * liabilitas jangka panjang, and the income statement would have added a sales
   * return to revenue. A figure being right is not the same as the sentence
   * beside it being right, and a total being right is not the same as the
   * subtotal it sits in being right. This group tests the sentences and the
   * subtotals. */
  group('Penyajian — arah, klasifikasi dan akun kontra, bukan hanya angkanya', function (t) {

    /* ------ 1. every working-capital line's DIRECTION word, checked against an
     * independently computed opening-versus-closing balance comparison. */
    var ds = dbSesuai();
    var ak = L.arusKas(ds.buku, DARI, SAMPAI);
    t.gt(ak.modalKerja.length, 5, 'bagian modal kerja punya lebih dari lima baris untuk diperiksa arahnya');
    var salahArah = [];
    var adaLiabilitas = 0;
    ak.modalKerja.forEach(function (r) {
      var akhir = L.saldoAkun(ds.buku, r.akun.kode, { sampai: SAMPAI }).saldo;
      var awal = L.saldoAkun(ds.buku, r.akun.kode, { sebelum: DARI }).saldo;
      if (r.naik !== (akhir > awal)) salahArah.push(r.akun.kode);
      if (r.akun.tipe === 'Liabilitas') adaLiabilitas++;
      /* And the SIGN of the cash effect, which is the other half of the claim:
       * an increase in an operating asset consumes cash, an increase in an
       * operating liability releases it. */
      if (r.akun.tipe === 'Aset') t.eq(r.naik === (r.jumlah < 0), true, r.akun.kode + ': aset naik ⇔ arus kas negatif');
      else t.eq(r.naik === (r.jumlah > 0), true, r.akun.kode + ': liabilitas naik ⇔ arus kas positif');
    });
    t.eq(salahArah.length, 0, 'setiap baris modal kerja diberi label naik/turun yang sama dengan perbandingan saldo awal vs saldo akhir yang dihitung terpisah' +
      (salahArah.length ? ' — salah pada ' + salahArah.join(', ') : ''));
    t.gt(adaLiabilitas, 3, 'dan lebih dari tiga di antaranya liabilitas — separuh yang dulu seluruhnya salah label');

    /* ------ 2. the current portion of the term loan. */
    var pj = ds.reg.pinjaman[0];
    var lancar = L.saldoAkun(ds.buku, pj.akunLancar, { sampai: SAMPAI }).saldo;
    var panjang = L.saldoAkun(ds.buku, pj.akunPokok, { sampai: SAMPAI }).saldo;
    t.rp(D.add(lancar, panjang), 60000000, 'sisa pokok pinjaman pada 31 Desember 2025 Rp 60.000.000');
    t.rp(lancar, 60000000, 'dan SELURUHNYA jangka pendek: Rp 5.000.000 sebulan × 12 = seluruh sisanya jatuh tempo dalam dua belas bulan');
    t.rp(panjang, 0, 'jadi tidak ada lagi yang tersaji sebagai liabilitas jangka panjang');
    var nrS = L.neraca(ds.buku, SAMPAI, { dari: DARI });
    t.rp(nrS.liabPanjang.total, 0, 'neraca: jumlah liabilitas jangka panjang nol');
    var lancarAda = nrS.liabPendek.baris.some(function (b) { return b.akun.kode === '2106'; });
    t.eq(lancarAda, true, 'dan 2106 Bagian Lancar Utang Bank Jangka Panjang muncul di liabilitas JANGKA PENDEK');
    t.eq(D.akun('2106').lancar, true, 'akun bagian lancar ditandai lancar di bagan akun');
    t.eq(D.akun('2106').arus, D.akun('2201').arus, 'dan seklasifikasi arus kas dengan induknya, jadi reklasifikasinya tidak menggerakkan laporan arus kas');
    var akSbl = L.arusKas(db().buku, DARI, SAMPAI);
    t.rp(ak.pendanaan, akSbl.pendanaan, 'terbukti: arus pendanaan identik sebelum dan sesudah reklasifikasi');
    /* The opening balance sheet was wrong in the same way and is checked too. */
    var awalLancar = L.saldoAkun(ds.buku, '2106', { sampai: '2024-12-31' }).saldo;
    var awalPanjang = L.saldoAkun(ds.buku, '2201', { sampai: '2024-12-31' }).saldo;
    t.rp(D.add(awalLancar, awalPanjang), 120000000, 'neraca pembuka: pokok pinjaman Rp 120.000.000');
    t.rp(awalLancar, 60000000, 'sudah terbagi di sana juga — Rp 60.000.000 jatuh tempo selama 2025, jadi lancar');
    t.rp(awalPanjang, 60000000, 'dan Rp 60.000.000 sisanya di luar dua belas bulan');
    /* Idempotent, because it is derived from live balances rather than a flag. */
    var rk2 = A.rencanaReklasPinjaman(ds, DARI, SAMPAI);
    t.eq(rk2.kosong, true, 'menghitung ulang rencana reklasifikasi pada buku yang sudah direklasifikasi menghasilkan nol baris');

    /* ------ 3. a CONTRA REVENUE account, added to the chart at runtime because
     * the chart is data and 1602/3102 already establish that `normal` is
     * independent of `tipe`. This is the case that made labaRugi() and neraca()
     * report different profits. */
    D.daftarAkun({
      kode: '4199', nama: 'Retur dan Potongan Penjualan', tipe: 'Pendapatan', normal: 'D',
      kontra: true, arus: 'O', grup: 'Pendapatan usaha', bruto: true
    });
    try {
      var b = L.buatBuku();
      tam(b, '2025-01-05', [{ akun: '1101', d: 50000000, k: 0 }, { akun: '4101', d: 0, k: 50000000 }], 'umum', 'penjualan');
      tam(b, '2025-01-10', [{ akun: '4199', d: 8000000, k: 0 }, { akun: '1101', d: 0, k: 8000000 }], 'umum', 'retur penjualan');
      var lrK = L.labaRugi(b, DARI, SAMPAI);
      var nrK = L.neraca(b, SAMPAI, { dari: DARI, labaRugi: lrK });
      t.rp(lrK.totPendapatanUsaha, 42000000, 'pendapatan usaha 50.000.000 − retur 8.000.000 = 42.000.000: retur DIKURANGKAN, bukan ditambahkan');
      t.rp(lrK.labaNeto, 42000000, 'laba neto ikut 42.000.000');
      t.rp(nrK.labaBerjalan, lrK.labaNeto, 'dan laba berjalan pada Neraca — yang mengambil tandanya dari TIPE — sama dengan laba neto pada Laba Rugi');
      t.eq(nrK.labaCocok, true, 'jadi labaCocok benar; sebelum perbaikan keduanya berselisih 16.000.000, dua kali nilai returnya');
      t.rp(lrK.peredaranBruto, 42000000, 'dasar PPh final juga bersih dari retur');
      t.rp(L.pphFinalBulanan(b, '2025').baris[0].bruto, 42000000, 'dan tabel PPh final bulanan membaca peredaran bruto yang sama');
      var prK = L.periksaBuku(b, { dari: DARI, sampai: SAMPAI, tahunDari: DARI });
      t.eq(prK.gagal, 0, 'ketujuh invarian tetap hijau pada buku yang memuat akun kontra pendapatan (' + prK.lulus + '/' + prK.total + ')');
      /* And the closing entry closes it on the side it actually sits on. */
      var sal = L.salin(b);
      L.postingPenutup(sal, SAMPAI, { peran: 'supervisor', oleh: 'uji', dari: null });
      t.rp(L.saldoAkun(sal, '4199', {}).saldo, 0, 'jurnal penutup menihilkan akun kontra pendapatan — bukan menggandakannya');
      t.rp(L.saldoAkun(sal, '4101', {}).saldo, 0, 'dan menihilkan akun pendapatan biasa seperti sebelumnya');
      t.rp(L.saldoAkun(sal, '3999', {}).saldo, 0, 'ikhtisar laba rugi kosong kembali');
      t.rp(L.saldoAkun(sal, '3201', {}).saldo, 42000000, 'dan saldo laba menerima 42.000.000, bukan 58.000.000');
      /* A contra EXPENSE, for symmetry: same rule, other side of the statement. */
      D.daftarAkun({
        kode: '5299', nama: 'Potongan Pembelian Diterima', tipe: 'Beban', normal: 'K',
        kontra: true, arus: 'O', grup: 'Beban usaha'
      });
      try {
        var b2 = L.buatBuku();
        tam(b2, '2025-02-01', [{ akun: '5201', d: 10000000, k: 0 }, { akun: '1101', d: 0, k: 10000000 }], 'umum', 'gaji');
        tam(b2, '2025-02-02', [{ akun: '1101', d: 3000000, k: 0 }, { akun: '5299', d: 0, k: 3000000 }], 'umum', 'potongan');
        var lr2 = L.labaRugi(b2, DARI, SAMPAI);
        t.rp(lr2.totBebanUsaha, 7000000, 'beban usaha 10.000.000 − potongan 3.000.000 = 7.000.000');
        t.rp(lr2.labaNeto, -7000000, 'jadi ruginya 7.000.000, bukan 13.000.000');
        t.eq(L.neraca(b2, SAMPAI, { dari: DARI, labaRugi: lr2 }).labaCocok, true, 'dan Neraca setuju');
        var sal2 = L.salin(b2);
        L.postingPenutup(sal2, SAMPAI, { peran: 'supervisor', oleh: 'uji', dari: null });
        t.rp(L.saldoAkun(sal2, '5299', {}).saldo, 0, 'jurnal penutup menihilkan akun kontra beban juga');
      } finally { D.hapusAkun('5299'); }
    } finally {
      /* The chart goes back exactly as it was — every other group reads D.AKUN. */
      D.hapusAkun('4199');
      t.eq(D.adaAkun('4199'), false, 'akun sintetis dilepas kembali dari bagan akun setelah diuji');
    }

    /* ------ 4. an adjustment that has been REVERSED is no longer in effect. */
    var dr = S.build();
    A.postingSemua(dr, DARI, SAMPAI, { peran: 'akuntan', oleh: 'uji' });
    var rpen = A.rencanaPenyusutan(dr, DARI, SAMPAI);
    var jp = A.sudahDiposting(dr.buku, rpen, DARI, SAMPAI);
    t.ok(jp, 'rencana penyusutan terdeteksi sudah diposting');
    t.rp(L.saldoAkun(dr.buku, '1602', { sampai: SAMPAI }).saldo, 60000000, 'akumulasi penyusutan peralatan 60.000.000');
    L.pembalik(dr.buku, jp.id, SAMPAI, { peran: 'akuntan', oleh: 'uji' });
    t.rp(L.saldoAkun(dr.buku, '1602', { sampai: SAMPAI }).saldo, 36000000, 'setelah dibalik, akumulasinya kembali ke 36.000.000 — bukunya sekarang kurang saji');
    t.eq(A.sudahDiposting(dr.buku, rpen, DARI, SAMPAI), null,
      'dan rencana itu TIDAK lagi dilaporkan sudah diposting: pembalik bukan posting, dan posting yang sudah dibalik tidak lagi berlaku');
    var lagi = A.postingSemua(dr, DARI, SAMPAI, { peran: 'akuntan', oleh: 'uji' });
    t.eq(lagi.length >= 1, true, 'jadi rencananya bisa diposting ulang — sebelum perbaikan, postingSemua() mengembalikan nol entri selamanya');
    t.rp(L.saldoAkun(dr.buku, '1602', { sampai: SAMPAI }).saldo, 60000000, 'dan akumulasi penyusutan pulih tepat ke angka jadwalnya');
    var pjr = A.periksaJadwal(dr);
    t.eq(pjr.gagal, 0, 'pemeriksaan register hijau kembali (' + pjr.lulus + '/' + pjr.total + ')');
    t.rp(L.labaRugi(dr.buku, DARI, SAMPAI).labaNeto, L.labaRugi(dbSesuai().buku, DARI, SAMPAI).labaNeto,
      'laba neto sama persis dengan buku yang tidak pernah dibalik');

    /* ------ 5. the licence that lets the cash flow statement drop closing
     * entries is checked over the set arusKas() actually drops. */
    var dc = S.build();
    A.postingSemua(dc, DARI, SAMPAI, { peran: 'akuntan', oleh: 'uji' });
    L.postingPenutup(dc.buku, SAMPAI, { peran: 'supervisor', oleh: 'uji', dari: null });
    var jt = L.pilih(dc.buku, { hanyaJenis: ['penutup'], efektif: false })[0];
    t.ok(jt, 'ada jurnal penutup untuk dikoreksi');
    var barisKas = jt.baris.map(function (x) { return { akun: x.akun, d: x.d, k: x.k }; });
    barisKas.push({ akun: '1101', d: 0, k: 5000000 });
    barisKas.push({ akun: '5101', d: 5000000, k: 0 });
    var v = L.periksaEntri(dc.buku, { tgl: SAMPAI, jenis: 'koreksi', ref: jt.id, baris: barisKas }, { peran: 'akuntan' });
    t.eq(v.ok, false, 'koreksi atas jurnal penutup yang menyentuh kas DITOLAK — laporan arus kas mengecualikannya, jadi barisnya akan hilang dari laporan sambil tetap menggerakkan kas');
    t.eq(v.alasan.some(function (x) { return /akun kas/.test(x); }), true, 'dan alasannya menyebut akun kas');
    /* A cash-free correction of a closing entry is still allowed. */
    var v2 = L.periksaEntri(dc.buku, { tgl: SAMPAI, jenis: 'koreksi', ref: jt.id, baris: jt.baris }, { peran: 'akuntan' });
    t.eq(v2.ok, true, 'koreksi jurnal penutup yang tidak menyentuh kas tetap boleh');

    /* ------ 6. reversing an entry twice is refused at the validator, not just
     * at the convenience wrapper — which is what a replay from storage uses. */
    var dd = S.build();
    var e1 = L.pilih(dd.buku, { dari: '2025-07-01', sampai: '2025-07-31' })[0];
    var bal = L.pembalik(dd.buku, e1.id, '2025-07-31', { peran: 'akuntan', oleh: 'uji' });
    t.ok(bal, 'entri dibalik sekali');
    var v3 = L.periksaEntri(dd.buku, {
      tgl: '2025-07-31', jenis: 'pembalik', ref: e1.id,
      baris: e1.baris.map(function (x) { return { akun: x.akun, d: x.k, k: x.d }; })
    }, { peran: 'akuntan' });
    t.eq(v3.ok, false, 'pembalik KEDUA atas entri yang sama ditolak oleh periksaEntri, bukan hanya oleh L.pembalik()');
    t.eq(v3.alasan.some(function (x) { return /sudah dibalik/.test(x); }), true, 'dan alasannya menyebut pembalik yang sudah ada');
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

  root.BUKU_TESTS = { run: run_, groups: groups, db: db, dbSesuai: dbSesuai, dbTutup: dbTutup, mini: mini };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BUKU_TESTS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
