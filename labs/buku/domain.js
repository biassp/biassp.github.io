/*!
 * Buku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Buku — domain.js
 * Integer rupiah arithmetic, the chart of accounts, and the tax constants.
 * Nothing in this file knows what a journal is; everything above it is built
 * out of these pieces.
 *
 * MONEY IS AN INTEGER RUPIAH. Always, everywhere, with no exceptions and no
 * "we round at the end". A float in an accounting system does not announce
 * itself: it shows up as a trial balance that is off by 1, six months later,
 * in a period nobody can reopen. So there is no division operator anywhere in
 * this codebase outside divRound()/divFloor()/alokasi(), each of which takes
 * integers and returns integers, and each of which THROWS on a fractional
 * argument rather than silently truncating it.
 *
 *   divRound(a, b)  a/b rounded half away from zero (the convention Indonesian
 *                   invoicing and DJP examples use — not banker's rounding).
 *   divFloor(a, b)  floor division, for anything that must never round up.
 *   alokasi(t, w)   splits t across weights w so the parts sum to EXACTLY t,
 *                   largest-remainder. This is what makes a depreciation
 *                   schedule add up to cost minus residual to the rupiah
 *                   instead of to "cost minus residual, give or take 3".
 *
 * The chart of accounts is data, not code. Each account carries four things the
 * rest of the app refuses to guess:
 *   tipe    one of the five SAK types
 *   normal  'D' or 'K' — the side the account's balance normally sits on. Note
 *           that this is NOT derivable from tipe alone: 1602 Akumulasi
 *           Penyusutan is an Aset with a normal CREDIT balance, and 3102 Prive
 *           is an Ekuitas with a normal DEBIT balance. Every demo that derives
 *           normal balance from the first digit gets both of those wrong.
 *   arus    which cash-flow bucket the account's movements belong to, O / I / F,
 *           or null for cash itself. This is what makes the cash flow statement
 *           reconcile by construction rather than by a plug figure — see
 *           arusKas() in ledger.js.
 *   lancar  current / non-current, for the balance sheet's ordering.
 */
(function (root) {
  'use strict';

  var D = {};
  root.BUKU_DOMAIN = D;

  /* ------------------------------------------------- bilangan bulat rupiah */

  D.MAX_SAFE = 9007199254740991;   // Number.MAX_SAFE_INTEGER, spelled out

  D.isInt = function (v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  };

  /* Multiplication that refuses to leave the exactly-representable range.
   * Rupiah figures are large — a year of turnover is 3e9 — and a rate times a
   * turnover times a quantity gets to 2^53 faster than people expect. Past
   * that point addition stops being associative and a trial balance can be off
   * by 2 with every individual figure looking perfectly reasonable. */
  D.mul = function (a, b) {
    if (!D.isInt(a) || !D.isInt(b)) throw new Error('mul hanya menerima bilangan bulat: ' + a + ' * ' + b);
    var p = a * b;
    if (Math.abs(p) > D.MAX_SAFE) throw new Error('perkalian melewati batas bilangan bulat aman: ' + a + ' * ' + b);
    return p;
  };

  D.add = function (a, b) {
    if (!D.isInt(a) || !D.isInt(b)) throw new Error('add hanya menerima bilangan bulat: ' + a + ' + ' + b);
    var s = a + b;
    if (Math.abs(s) > D.MAX_SAFE) throw new Error('penjumlahan melewati batas bilangan bulat aman');
    return s;
  };

  /* Half away from zero, symmetric about zero. divRound(2500,1000) is 3, not 2:
   * this is deliberately NOT banker's rounding, because the DJP worked examples
   * and every invoice printed in Indonesia round half up. */
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

  D.divFloor = function (a, b) {
    if (!D.isInt(a) || !D.isInt(b)) throw new Error('divFloor hanya menerima bilangan bulat: ' + a + ', ' + b);
    if (b === 0) throw new Error('divFloor: pembagi nol');
    return Math.floor(a / b);
  };

  /* Split `total` across integer weights so the parts sum to EXACTLY total.
   * Largest remainder: floor every share, then hand the leftover rupiah out one
   * at a time to the largest remainders, ties broken by index so the result is
   * deterministic. Used by the depreciation schedule (equal weights) and by
   * anything that has to divide a rupiah figure into periods.
   *
   * The property that matters and is asserted: sum(alokasi(t,w)) === t for every
   * t and every w, including negative t, w with zeros, and length-1 w. */
  D.alokasi = function (total, bobot) {
    if (!D.isInt(total)) throw new Error('alokasi: total harus bilangan bulat, dapat ' + total);
    if (!bobot || !bobot.length) throw new Error('alokasi: bobot kosong');
    var i, jum = 0;
    for (i = 0; i < bobot.length; i++) {
      if (!D.isInt(bobot[i]) || bobot[i] < 0) throw new Error('alokasi: bobot harus bilangan bulat >= 0, dapat ' + bobot[i]);
      jum = D.add(jum, bobot[i]);
    }
    if (jum === 0) throw new Error('alokasi: jumlah bobot nol');
    var neg = total < 0, t = Math.abs(total);
    var dasar = [], sisa = [], terpakai = 0;
    for (i = 0; i < bobot.length; i++) {
      var num = D.mul(t, bobot[i]);
      var q = Math.floor(num / jum);
      dasar.push(q);
      sisa.push({ i: i, r: num - D.mul(q, jum) });
      terpakai += q;
    }
    var lebih = t - terpakai;
    sisa.sort(function (a, b) { return b.r - a.r || a.i - b.i; });
    for (i = 0; i < lebih; i++) dasar[sisa[i % sisa.length].i] += 1;
    if (neg) for (i = 0; i < dasar.length; i++) dasar[i] = -dasar[i];
    return dasar;
  };

  /* ------------------------------------------------------------ tampilan */

  /* A float reaching this function is a bug, and the output says so loudly
   * rather than hiding it behind toFixed(2). "!1234.5" in a table cell is the
   * cheapest possible float detector, and the assertion suite greps for it. */
  D.rupiah = function (n) {
    if (n === null || n === undefined) return '—';
    if (!D.isInt(n)) return '!' + n;
    var neg = n < 0, s = String(Math.abs(n)), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = '.' + out;
    }
    return (neg ? '-Rp' : 'Rp') + out;
  };

  D.angka = function (n) {
    if (n === null || n === undefined) return '—';
    if (!D.isInt(n)) return '!' + n;
    var neg = n < 0, s = String(Math.abs(n)), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = '.' + out;
    }
    return (neg ? '-' : '') + out;
  };

  /* Accounting presentation: a figure that is nil prints as a dash, and a
   * negative figure prints in parentheses, because that is how a reader of an
   * Indonesian financial statement expects to see it. */
  D.rpAkun = function (n) {
    if (n === null || n === undefined) return '—';
    if (!D.isInt(n)) return '!' + n;
    if (n === 0) return '—';
    if (n < 0) return '(' + D.angka(-n) + ')';
    return D.angka(n);
  };

  /* ------------------------------------------------------------- tanggal */

  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  D.BULAN = BULAN;
  D.BULAN_PENDEK = BULAN_PENDEK;

  /* Dates are ISO strings 'YYYY-MM-DD' and are compared as strings. There is no
   * Date object anywhere in the ledger: a Date is timezone-bearing, and a
   * journal entry posted at 23:30 WIB must not fall into the previous month
   * because the runtime happened to be in UTC. */
  D.isTanggal = function (s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= D.hariDalamBulan(y, m);
  };

  D.hariDalamBulan = function (y, m) {
    var h = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) h = 29;
    return h;
  };

  D.periodeDari = function (tgl) { return String(tgl).slice(0, 7); };   // 'YYYY-MM'
  D.tahunDari = function (tgl) { return String(tgl).slice(0, 4); };

  D.akhirBulan = function (periode) {
    var y = +periode.slice(0, 4), m = +periode.slice(5, 7);
    return periode + '-' + String(D.hariDalamBulan(y, m)).padStart(2, '0');
  };
  D.awalBulan = function (periode) { return periode + '-01'; };

  D.tambahBulan = function (periode, n) {
    var y = +periode.slice(0, 4), m = +periode.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return String(y) + '-' + String(m + 1).padStart(2, '0');
  };

  D.tglPanjang = function (tgl) {
    if (!D.isTanggal(tgl)) return String(tgl);
    return (+tgl.slice(8, 10)) + ' ' + BULAN[+tgl.slice(5, 7) - 1] + ' ' + tgl.slice(0, 4);
  };
  D.tglPendek = function (tgl) {
    if (!D.isTanggal(tgl)) return String(tgl);
    return (+tgl.slice(8, 10)) + ' ' + BULAN_PENDEK[+tgl.slice(5, 7) - 1];
  };
  D.periodeNama = function (periode) {
    return BULAN[+periode.slice(5, 7) - 1] + ' ' + periode.slice(0, 4);
  };

  /* ------------------------------------------------------ bagan akun */

  D.TIPE = ['Aset', 'Liabilitas', 'Ekuitas', 'Pendapatan', 'Beban'];

  /* The first digit of the account number IS the type. 1 Aset, 2 Liabilitas,
   * 3 Ekuitas, 4 Pendapatan, 5 Beban — the numbering convention every
   * Indonesian bookkeeping course teaches, and the assertion suite checks that
   * no account in the chart contradicts its own number. */
  D.TIPE_DIGIT = { '1': 'Aset', '2': 'Liabilitas', '3': 'Ekuitas', '4': 'Pendapatan', '5': 'Beban' };
  D.DIGIT_TIPE = { 'Aset': '1', 'Liabilitas': '2', 'Ekuitas': '3', 'Pendapatan': '4', 'Beban': '5' };

  /* The normal balance a type has when it is not a contra account. Kept apart
   * from the per-account `normal` field so the suite can assert that every
   * account either matches its type's default or is explicitly flagged kontra. */
  D.NORMAL_TIPE = { 'Aset': 'D', 'Liabilitas': 'K', 'Ekuitas': 'K', 'Pendapatan': 'K', 'Beban': 'D' };

  /* NOMINAL accounts (akun nominal / temporer) are the ones the closing entry
   * zeroes: revenue and expense. REAL accounts (akun riil) carry forward. */
  D.TIPE_NOMINAL = { 'Pendapatan': true, 'Beban': true };

  D.isNominal = function (akun) { return !!D.TIPE_NOMINAL[akun.tipe]; };

  var AKUN = [
    /* --- Aset lancar -------------------------------------------------- */
    { kode: '1101', nama: 'Kas', tipe: 'Aset', normal: 'D', kas: true, arus: null, lancar: true, grup: 'Kas dan setara kas' },
    { kode: '1102', nama: 'Bank — Giro Operasional', tipe: 'Aset', normal: 'D', kas: true, arus: null, lancar: true, grup: 'Kas dan setara kas' },
    { kode: '1201', nama: 'Piutang Usaha', tipe: 'Aset', normal: 'D', arus: 'O', lancar: true, grup: 'Piutang' },
    { kode: '1301', nama: 'Persediaan Barang Dagang', tipe: 'Aset', normal: 'D', arus: 'O', lancar: true, grup: 'Persediaan' },
    { kode: '1401', nama: 'Sewa Dibayar di Muka', tipe: 'Aset', normal: 'D', arus: 'O', lancar: true, grup: 'Beban dibayar di muka' },
    { kode: '1402', nama: 'Asuransi Dibayar di Muka', tipe: 'Aset', normal: 'D', arus: 'O', lancar: true, grup: 'Beban dibayar di muka' },
    { kode: '1501', nama: 'PPN Masukan', tipe: 'Aset', normal: 'D', arus: 'O', lancar: true, grup: 'Pajak dibayar di muka', pajak: 'masukan' },

    /* --- Aset tetap --------------------------------------------------- */
    { kode: '1601', nama: 'Peralatan Toko', tipe: 'Aset', normal: 'D', arus: 'I', lancar: false, grup: 'Aset tetap' },
    /* Contra asset: an Aset whose balance sits on the CREDIT side. Derive its
     * normal balance from the leading 1 and the balance sheet inverts. */
    { kode: '1602', nama: 'Akumulasi Penyusutan Peralatan Toko', tipe: 'Aset', normal: 'K', kontra: true, arus: 'O', lancar: false, grup: 'Aset tetap', akumDari: '1601' },
    { kode: '1611', nama: 'Kendaraan Pengangkut', tipe: 'Aset', normal: 'D', arus: 'I', lancar: false, grup: 'Aset tetap' },
    { kode: '1612', nama: 'Akumulasi Penyusutan Kendaraan Pengangkut', tipe: 'Aset', normal: 'K', kontra: true, arus: 'O', lancar: false, grup: 'Aset tetap', akumDari: '1611' },

    /* --- Liabilitas jangka pendek ------------------------------------- */
    { kode: '2101', nama: 'Utang Usaha', tipe: 'Liabilitas', normal: 'K', arus: 'O', lancar: true, grup: 'Utang usaha' },
    { kode: '2102', nama: 'Beban yang Masih Harus Dibayar', tipe: 'Liabilitas', normal: 'K', arus: 'O', lancar: true, grup: 'Beban akrual' },
    { kode: '2103', nama: 'Pendapatan Diterima di Muka', tipe: 'Liabilitas', normal: 'K', arus: 'O', lancar: true, grup: 'Pendapatan ditangguhkan' },
    { kode: '2104', nama: 'PPN Keluaran', tipe: 'Liabilitas', normal: 'K', arus: 'O', lancar: true, grup: 'Utang pajak', pajak: 'keluaran' },
    { kode: '2105', nama: 'Utang PPh Final UMKM 0,5%', tipe: 'Liabilitas', normal: 'K', arus: 'O', lancar: true, grup: 'Utang pajak', pajak: 'pph-final' },
    /* THE CURRENT PORTION, and it exists because a chart without one cannot
     * present a term loan correctly at all.
     *
     * SAK EMKM and SAK ETAP both classify a liability as CURRENT when it is
     * expected to be settled within twelve months of the reporting date. A bank
     * loan repaid at Rp 5.000.000 a month with Rp 60.000.000 outstanding is
     * therefore 100% current — twelve more instalments and it is gone — and
     * showing the whole of it under liabilitas jangka panjang understates current
     * liabilities by the entire balance. Totals are unaffected, which is exactly
     * why no invariant caught it: the accounting equation does not care which
     * subtotal a liability sits in, and the reader of the balance sheet cares
     * about very little else.
     *
     * The amount is not typed anywhere. It is derived at the reporting date from
     * the loan register (db.reg.pinjaman) and proposed as a year-end
     * reclassification the same way depreciation is proposed — see
     * A.rencanaReklasPinjaman(). Both accounts are arus F, so the reclassification
     * nets to zero in the financing bucket and the cash flow statement does not
     * move by a rupiah. */
    { kode: '2106', nama: 'Bagian Lancar Utang Bank Jangka Panjang', tipe: 'Liabilitas', normal: 'K', arus: 'F', lancar: true, grup: 'Bagian lancar utang jangka panjang', bagianLancarDari: '2201' },

    /* --- Liabilitas jangka panjang ------------------------------------ */
    { kode: '2201', nama: 'Utang Bank Jangka Panjang', tipe: 'Liabilitas', normal: 'K', arus: 'F', lancar: false, grup: 'Utang jangka panjang', bagianLancar: '2106' },

    /* --- Ekuitas ------------------------------------------------------ */
    { kode: '3101', nama: 'Modal Pemilik', tipe: 'Ekuitas', normal: 'K', arus: 'F', lancar: false, grup: 'Modal' },
    /* Contra equity: an Ekuitas with a normal DEBIT balance. */
    { kode: '3102', nama: 'Prive Pemilik', tipe: 'Ekuitas', normal: 'D', kontra: true, arus: 'F', lancar: false, grup: 'Modal' },
    { kode: '3201', nama: 'Saldo Laba', tipe: 'Ekuitas', normal: 'K', arus: 'F', lancar: false, grup: 'Saldo laba' },
    /* The income summary. Touched by the closing entry and by nothing else, and
     * it must be zero the instant the closing entry is complete — which is one
     * of the things I5 asserts. */
    { kode: '3999', nama: 'Ikhtisar Laba Rugi', tipe: 'Ekuitas', normal: 'K', arus: 'F', lancar: false, grup: 'Saldo laba', ikhtisar: true },

    /* --- Pendapatan --------------------------------------------------- */
    { kode: '4101', nama: 'Penjualan Barang Dagang', tipe: 'Pendapatan', normal: 'K', arus: 'O', grup: 'Pendapatan usaha', bruto: true },
    { kode: '4102', nama: 'Pendapatan Jasa Perakitan', tipe: 'Pendapatan', normal: 'K', arus: 'O', grup: 'Pendapatan usaha', bruto: true },
    { kode: '4901', nama: 'Pendapatan Lain-lain', tipe: 'Pendapatan', normal: 'K', arus: 'O', grup: 'Pendapatan lain-lain' },

    /* --- Beban -------------------------------------------------------- */
    { kode: '5101', nama: 'Harga Pokok Penjualan', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban pokok penjualan', hpp: true },
    { kode: '5201', nama: 'Beban Gaji dan Upah', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha' },
    { kode: '5202', nama: 'Beban Sewa', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha' },
    { kode: '5203', nama: 'Beban Listrik, Air dan Telepon', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha' },
    { kode: '5204', nama: 'Beban Penyusutan', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha', nonKas: true },
    { kode: '5205', nama: 'Beban Asuransi', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha' },
    { kode: '5206', nama: 'Beban Administrasi Bank', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha' },
    { kode: '5207', nama: 'Beban Pengiriman', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha' },
    { kode: '5208', nama: 'Beban Bunga Pinjaman', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban usaha' },
    /* PPh final is an EXPENSE, and it is presented on its own line below laba
     * sebelum pajak — never mixed into beban usaha, because it is not a cost of
     * operating, it is 0,5% of turnover regardless of whether there was a
     * profit at all. */
    { kode: '5301', nama: 'Beban Pajak Penghasilan Final UMKM', tipe: 'Beban', normal: 'D', arus: 'O', grup: 'Beban pajak final', pajakFinal: true }
  ];

  D.AKUN = AKUN;

  var BY_KODE = {};
  AKUN.forEach(function (a) { BY_KODE[a.kode] = a; });
  D.akun = function (kode) { return BY_KODE[kode] || null; };
  D.adaAkun = function (kode) { return !!BY_KODE[kode]; };
  D.KODE = AKUN.map(function (a) { return a.kode; });

  D.akunTipe = function (tipe) {
    return AKUN.filter(function (a) { return a.tipe === tipe; });
  };
  D.akunKas = function () { return AKUN.filter(function (a) { return a.kas; }); };
  D.KODE_KAS = D.akunKas().map(function (a) { return a.kode; });

  /* Registering an account, because the chart is DATA and the assertion suite
   * has to be able to add a row to it. Pushing onto D.AKUN alone is not enough —
   * the code lookup is an index, and an account that is in the array but not in
   * the index is refused by periksaEntri while still being summed by every
   * statement, which is a state no real chart can be in.
   *
   * The suite uses this to add a contra-revenue account (an akun Pendapatan with
   * a normal DEBIT balance) and assert that the income statement and the balance
   * sheet still report the same profit. That assertion is the one that would have
   * caught labaRugi() reading its sign off the account instead of the type. */
  D.daftarAkun = function (spec) {
    if (!spec || !spec.kode) throw new Error('daftarAkun: butuh kode akun');
    if (BY_KODE[spec.kode]) throw new Error('daftarAkun: akun ' + spec.kode + ' sudah ada');
    if (!D.TIPE_DIGIT[String(spec.kode).charAt(0)]) throw new Error('daftarAkun: digit pertama kode tidak mengenali tipe');
    if (D.TIPE_DIGIT[String(spec.kode).charAt(0)] !== spec.tipe) {
      throw new Error('daftarAkun: kode ' + spec.kode + ' menyiratkan tipe ' +
        D.TIPE_DIGIT[String(spec.kode).charAt(0)] + ', bukan ' + spec.tipe);
    }
    if (spec.normal !== 'D' && spec.normal !== 'K') throw new Error('daftarAkun: normal harus D atau K');
    if (spec.normal !== D.NORMAL_TIPE[spec.tipe] && !spec.kontra) {
      throw new Error('daftarAkun: akun ' + spec.kode + ' menyimpang dari saldo normal tipenya tanpa ditandai kontra');
    }
    AKUN.push(spec);
    BY_KODE[spec.kode] = spec;
    D.KODE = AKUN.map(function (a) { return a.kode; });
    D.KODE_KAS = D.akunKas().map(function (a) { return a.kode; });
    return spec;
  };

  /* And the way back out, so a suite that added a synthetic account can leave the
   * chart exactly as it found it — every other test in the run reads D.AKUN. */
  D.hapusAkun = function (kode) {
    var i = AKUN.map(function (a) { return a.kode; }).indexOf(kode);
    if (i < 0) return false;
    AKUN.splice(i, 1);
    delete BY_KODE[kode];
    D.KODE = AKUN.map(function (a) { return a.kode; });
    D.KODE_KAS = D.akunKas().map(function (a) { return a.kode; });
    return true;
  };

  /* The signed contribution of (debit, kredit) to the account's NATURAL balance:
   * a debit account grows on debits, a credit account grows on credits. Used for
   * presentation. The accounting identity is checked with tipeSigned() instead,
   * which works in raw D-minus-K terms and therefore nets contra accounts
   * automatically. */
  D.saldoNatural = function (akun, debit, kredit) {
    return akun.normal === 'D' ? debit - kredit : kredit - debit;
  };

  /* --------------------------------------------------------------- pajak */

  /* PPN. The rate written on the invoice for 2025 is 12% applied to a DPP nilai
   * lain of 11/12 of the selling price (PMK 131/2024), which is arithmetically
   * 11% of the selling price and is why every shop in Indonesia still prints
   * 11%. The two-step form is computed here so the faktur figures reconcile
   * exactly with the one-step form, and neither introduces a float:
   *   dppNilaiLain = round(harga * 11 / 12);  ppn = round(dppNilaiLain * 12/100)
   * versus ppn = round(harga * 11 / 100). Where the two disagree by a rupiah,
   * the one-step figure wins, because that is the figure on the invoice. */
  D.PPN_PERSEN = 11;
  D.PPN_TARIF_NOMINAL = 12;
  D.PPN_FAKTOR_DPP = { atas: 11, bawah: 12 };

  D.ppnDari = function (dpp) {
    if (!D.isInt(dpp)) throw new Error('DPP harus bilangan bulat, dapat ' + dpp);
    return D.divRound(D.mul(dpp, D.PPN_PERSEN), 100);
  };

  D.dppNilaiLain = function (dpp) {
    if (!D.isInt(dpp)) throw new Error('DPP harus bilangan bulat, dapat ' + dpp);
    return D.divRound(D.mul(dpp, D.PPN_FAKTOR_DPP.atas), D.PPN_FAKTOR_DPP.bawah);
  };

  /* Given a gross amount that already includes PPN, split it. dpp + ppn is
   * exactly the gross, always — the ppn is derived by subtraction after the dpp
   * is rounded, so no rupiah can go missing between the two lines of the
   * journal entry. */
  D.pecahInklusif = function (bruto) {
    if (!D.isInt(bruto)) throw new Error('bruto harus bilangan bulat, dapat ' + bruto);
    var dpp = D.divRound(D.mul(bruto, 100), 100 + D.PPN_PERSEN);
    return { dpp: dpp, ppn: bruto - dpp, bruto: bruto };
  };

  /* PPh final UMKM: PP 55/2022, 0,5% of PEREDARAN BRUTO (gross turnover), per
   * month, final. Not corporate income tax on profit — a loss-making month
   * still owes it. 0,5% is expressed as 5/1000 so the arithmetic stays integral. */
  D.PPH_FINAL_PERMIL = 5;                 // 5 per mille = 0,5%
  D.PPH_FINAL_LABEL = 'PPh final UMKM 0,5% (PP 55/2022)';
  D.PPH_FINAL_BATAS_OMZET = 4800000000;   // Rp 4,8 miliar setahun

  /* PP 55/2022 pasal 60 ayat (2): for a WAJIB PAJAK ORANG PRIBADI on the 0,5%
   * final regime, the first Rp 500.000.000 of a tax year's peredaran bruto is
   * NOT SUBJECT TO TAX. It is not an election and not a deduction from the tax —
   * it is a slice of the base that never enters the computation, and it resets
   * every tax year.
   *
   * It is also cumulative WITHIN the year, not per month: the exemption is
   * consumed by the earliest months' turnover, so a shop that turns over
   * Rp 300 juta in January and Rp 400 juta in February owes nothing for January
   * and 0,5% × Rp 200.000.000 for February. Applying it per masa instead would
   * exempt Rp 6 miliar a year, and applying it only to the annual return would
   * put the monthly instalments wrong in both directions.
   *
   * This entity is an orang pribadi — see S.PROFIL: bentuk 'Usaha Dagang
   * perorangan', a single owner, and a chart carrying Modal Pemilik / Prive
   * Pemilik rather than share capital. A badan (a PT or a CV) gets no such
   * exemption, which is why the amount is a named constant a caller can override
   * with 0 rather than a number baked into the rate. */
  D.PPH_FINAL_BEBAS = 500000000;
  D.PPH_FINAL_BEBAS_DASAR = 'PP 55/2022 Pasal 60 ayat (2) — Rp 500.000.000 pertama dalam satu tahun pajak ' +
    'tidak dikenai PPh bagi wajib pajak orang pribadi.';

  /* 0,5% of whatever base it is handed. This is the RATE and nothing else — it
   * does not know about the exemption, because a base is a base. Every caller
   * that levies tax on a WP orang pribadi's turnover must pass a base that has
   * already had the exemption taken out of it, which is what pphFinalDasar()
   * below is for. */
  D.pphFinal = function (dasarKena) {
    if (!D.isInt(dasarKena)) throw new Error('dasar pengenaan harus bilangan bulat, dapat ' + dasarKena);
    if (dasarKena < 0) throw new Error('dasar pengenaan tidak boleh negatif');
    return D.divRound(D.mul(dasarKena, D.PPH_FINAL_PERMIL), 1000);
  };

  /* Split one masa's turnover into the part the exemption swallows and the part
   * that is taxed, given how much turnover the same tax year has already
   * recognised. `bebas` defaults to the orang-pribadi figure; pass 0 for a badan.
   *
   * Returns integers that always satisfy bebasDipakai + kena === brutoMasa, so no
   * rupiah of turnover can go missing between the exempt slice and the taxed
   * one. A negative masa — net returns exceeding sales — is passed through to
   * `kena` untouched rather than being allowed to REFILL the exemption, which is
   * the conservative reading and the one that cannot understate the year. */
  D.pphFinalDasar = function (brutoKumulatifSebelum, brutoMasa, bebas) {
    bebas = bebas === undefined || bebas === null ? D.PPH_FINAL_BEBAS : bebas;
    if (!D.isInt(brutoKumulatifSebelum) || !D.isInt(brutoMasa) || !D.isInt(bebas)) {
      throw new Error('pphFinalDasar hanya menerima bilangan bulat');
    }
    if (brutoKumulatifSebelum < 0) throw new Error('peredaran bruto kumulatif tidak boleh negatif');
    if (bebas < 0) throw new Error('batas bebas tidak boleh negatif');
    var sisaBebas = bebas - brutoKumulatifSebelum;
    if (sisaBebas < 0) sisaBebas = 0;
    if (brutoMasa <= 0) return { bebasDipakai: 0, kena: brutoMasa, sisaBebasSebelum: sisaBebas, sisaBebasSesudah: sisaBebas };
    var dipakai = Math.min(brutoMasa, sisaBebas);
    return {
      bebasDipakai: dipakai,
      kena: brutoMasa - dipakai,
      sisaBebasSebelum: sisaBebas,
      sisaBebasSesudah: sisaBebas - dipakai
    };
  };

  /* The tax on one masa for a WP orang pribadi: 0,5% of the masa's turnover
   * AFTER the year's remaining exemption has been consumed. */
  D.pphFinalOP = function (brutoKumulatifSebelum, brutoMasa, bebas) {
    var d = D.pphFinalDasar(brutoKumulatifSebelum, brutoMasa, bebas);
    return d.kena <= 0 ? 0 : D.pphFinal(d.kena);
  };

  /* ------------------------------------------------------------ penyusutan */

  /* Straight-line depreciation, monthly, integral, and summing to EXACTLY
   * cost minus residual over the asset's whole life.
   *
   * The naive version — perBulan = round((harga - residu) / bulan), then repeat
   * it `bulan` times — is off by up to `bulan` rupiah at the end of life, which
   * leaves a fully depreciated asset carrying a book value of 7 and an
   * accumulated depreciation account that will never agree with the schedule.
   * alokasi() distributes the remainder instead, so the schedule closes exactly.
   *
   * Returns one row per month: { periode, jumlah, akumulasi, nilaiBuku }. */
  D.jadwalPenyusutan = function (aset) {
    if (!D.isInt(aset.harga)) throw new Error('harga perolehan harus bilangan bulat');
    if (!D.isInt(aset.residu)) throw new Error('nilai residu harus bilangan bulat');
    if (!D.isInt(aset.umurBulan) || aset.umurBulan < 1) throw new Error('umur (bulan) harus bilangan bulat >= 1');
    if (aset.residu < 0) throw new Error('nilai residu tidak boleh negatif');
    if (aset.residu > aset.harga) throw new Error('nilai residu tidak boleh melebihi harga perolehan');
    if (!/^\d{4}-\d{2}$/.test(String(aset.mulai))) throw new Error('mulai harus periode YYYY-MM');

    var dasar = aset.harga - aset.residu;
    var bobot = [];
    for (var i = 0; i < aset.umurBulan; i++) bobot.push(1);
    var bagian = D.alokasi(dasar, bobot);
    var baris = [], akum = 0;
    for (i = 0; i < aset.umurBulan; i++) {
      akum = D.add(akum, bagian[i]);
      baris.push({
        no: i + 1,
        periode: D.tambahBulan(aset.mulai, i),
        jumlah: bagian[i],
        akumulasi: akum,
        nilaiBuku: aset.harga - akum
      });
    }
    return { aset: aset, dasar: dasar, baris: baris, totalPenyusutan: akum };
  };

  /* Accumulated depreciation up to and including a period — used both for the
   * adjusting entry (the slice inside the period) and for the opening balance
   * (everything before the year started). The opening akumulasi penyusutan in
   * the seed is DERIVED from this, not typed in, which is why the opening
   * balance sheet is internally consistent rather than approximately so. */
  D.akumSampai = function (jadwal, periode) {
    var akum = 0;
    for (var i = 0; i < jadwal.baris.length; i++) {
      if (jadwal.baris[i].periode > periode) break;
      akum = D.add(akum, jadwal.baris[i].jumlah);
    }
    return akum;
  };

  D.penyusutanRentang = function (jadwal, dariPeriode, sampaiPeriode) {
    var jum = 0;
    for (var i = 0; i < jadwal.baris.length; i++) {
      var p = jadwal.baris[i].periode;
      if (p < dariPeriode || p > sampaiPeriode) continue;
      jum = D.add(jum, jadwal.baris[i].jumlah);
    }
    return jum;
  };

  /* ------------------------------------------------------------- peran */

  /* Three roles, and the separation is real rather than cosmetic: a staf's entry
   * does not reach the book at all until someone with posting rights approves
   * it, and a closed period is a wall that only a supervisor can take down. */
  D.PERAN = [
    {
      id: 'staf', label: 'Staf', urut: 1,
      boleh: { draf: true },
      catatan: 'Menyusun draf jurnal. Draf tidak masuk buku sampai akuntan memposting — seorang staf tidak bisa menaruh angka di laporan keuangan sendirian.'
    },
    {
      id: 'akuntan', label: 'Akuntan', urut: 2,
      boleh: { draf: true, posting: true, penyesuaian: true, pembalik: true, koreksi: true },
      catatan: 'Memposting jurnal umum, jurnal penyesuaian, pembalik dan koreksi. Tidak boleh menutup periode atau membuka periode terkunci.'
    },
    {
      id: 'supervisor', label: 'Supervisor', urut: 3,
      boleh: { draf: true, posting: true, penyesuaian: true, pembalik: true, koreksi: true, penutup: true, tutupPeriode: true, bukaPeriode: true },
      catatan: 'Semua kewenangan akuntan, ditambah jurnal penutup, mengunci periode dan satu-satunya yang boleh membuka periode yang sudah terkunci.'
    }
  ];
  var PERAN_BY_ID = {};
  D.PERAN.forEach(function (p) { PERAN_BY_ID[p.id] = p; });
  D.peran = function (id) { return PERAN_BY_ID[id] || null; };
  D.bolehkah = function (peranId, aksi) {
    var p = PERAN_BY_ID[peranId];
    return !!(p && p.boleh[aksi]);
  };

  /* --------------------------------------------------- jenis jurnal */

  D.JENIS = [
    { id: 'saldo-awal', label: 'Saldo awal', prefix: 'SA', nominalBoleh: false, catatan: 'Neraca pembuka periode, diposting sekali.' },
    { id: 'umum', label: 'Jurnal umum', prefix: 'JU', nominalBoleh: true, catatan: 'Transaksi harian.' },
    { id: 'penyesuaian', label: 'Jurnal penyesuaian', prefix: 'JP', nominalBoleh: true, catatan: 'Akhir periode: penyusutan, beban dibayar di muka, pendapatan diterima di muka, beban akrual.' },
    { id: 'penutup', label: 'Jurnal penutup', prefix: 'JT', nominalBoleh: true, catatan: 'Menutup akun nominal ke ekuitas.' },
    { id: 'pembalik', label: 'Jurnal pembalik', prefix: 'JB', nominalBoleh: true, catatan: 'Membalik entri lain tanpa menghapusnya.' },
    { id: 'koreksi', label: 'Jurnal koreksi', prefix: 'JK', nominalBoleh: true, catatan: 'Angka pengganti, diposting setelah pembalik. Entri asli tetap ada.' }
  ];
  var JENIS_BY_ID = {};
  D.JENIS.forEach(function (j) { JENIS_BY_ID[j.id] = j; });
  D.jenis = function (id) { return JENIS_BY_ID[id] || null; };

  /* -------------------------------------------------------------- acak */

  /* Mulberry32. One 32-bit seed in, the same book out, every load, in every
   * browser — which is what makes "the totals in the README match the totals on
   * the screen" a statement anyone can check rather than a claim. */
  D.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* Integer in [lo, hi]. Every quantity and every rupiah figure in the seed
   * comes through here, so nothing in the demo book can be fractional. */
  D.acakInt = function (rnd, lo, hi) {
    if (!D.isInt(lo) || !D.isInt(hi)) throw new Error('acakInt butuh batas bilangan bulat');
    if (hi < lo) throw new Error('acakInt: batas terbalik');
    return lo + Math.floor(rnd() * (hi - lo + 1));
  };
  D.acakPilih = function (rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; };

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
