/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — domain.js
 * The primitives everything else is built on. Nothing here touches the DOM and
 * nothing here reaches the network, so the same file runs under node.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: money and quantity are integers.
 *
 * Rupiah is stored as a whole rupiah, never a float. Quantity is stored in the
 * smallest base unit of the product (pcs, gram, ml), never a float. A float
 * anywhere in an inventory system is a slow leak: 0.1 + 0.2 shows up three
 * months later as a stock card that will not reconcile, and nobody can say
 * which document is wrong. Every division in this codebase goes through
 * divRound(), which takes two integers and returns an integer, so a rounding
 * decision is always a decision somebody wrote down rather than whatever the
 * IEEE-754 unit in the last place happened to do.
 *
 * ROUNDING POLICY (one policy, applied everywhere):
 *   divRound(a, b) = a / b rounded half away from zero.
 *   1500/1000 -> 2,  2500/1000 -> 3,  -1500/1000 -> -2.
 * Half away from zero, not banker's rounding, because that is what Indonesian
 * commercial practice and the DJP worked examples do, and because a reviewer
 * hand-checking a faktur with a calculator will round that way.
 */
(function (root) {
  'use strict';

  var D = {};
  root.GUDANG_DOMAIN = D;

  /* ------------------------------------------------------------ integers */

  D.MAX_SAFE = 9007199254740991;   // Number.MAX_SAFE_INTEGER, spelled out for old engines

  D.isInt = function (v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  };

  /* Every product of a quantity and a unit price passes through here. The
   * check is not paranoia: base units are small (a carton of 24 x 6 pcs is 144
   * base units) and a warehouse-wide value in rupiah is already ~1e10, so the
   * product of a total value and a quantity — which the average-cost issue
   * formula computes — lands around 1e13. That is inside 2^53, but only just,
   * and "only just" is worth an assertion rather than a hope. */
  var maxProductSeen = 0;
  D.mul = function (a, b) {
    var p = a * b;
    var ap = Math.abs(p);
    if (ap > maxProductSeen) maxProductSeen = ap;
    if (ap > D.MAX_SAFE) throw new Error('perkalian melewati batas bilangan bulat aman: ' + a + ' * ' + b);
    return p;
  };
  D.maxProduct = function () { return maxProductSeen; };
  D.resetMaxProduct = function () { maxProductSeen = 0; };

  /* Integer division, rounded half away from zero. Both arguments must be
   * integers; b must not be zero. Written with integer arithmetic only so the
   * result never depends on a float's representable-ness. */
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

  /* Floor division for the unit-breakdown arithmetic, where "3 dus sisa 7 pcs"
   * must never round the 7 up into a fourth dus. */
  D.divFloor = function (a, b) {
    if (!D.isInt(a) || !D.isInt(b)) throw new Error('divFloor hanya menerima bilangan bulat');
    if (b === 0) throw new Error('divFloor: pembagi nol');
    return Math.floor(a / b);
  };

  /* --------------------------------------------------------------- angka */

  D.rupiah = function (n) {
    if (n === null || n === undefined) return '—';
    if (!D.isInt(n)) return '!' + n;      // deliberately ugly: a float here is a bug
    var neg = n < 0, s = String(Math.abs(n)), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = '.' + out;
    }
    return (neg ? '-Rp' : 'Rp') + out;
  };

  D.angka = function (n) {
    if (!D.isInt(n)) return '!' + n;
    var neg = n < 0, s = String(Math.abs(n)), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = '.' + out;
    }
    return (neg ? '-' : '') + out;
  };

  /* ----------------------------------------------------------------- prng */

  /* mulberry32. Deterministic, seeded, and the same sequence under node and in
   * the browser — which is what makes "the demo data is rebuilt from one seed
   * number" a checkable statement rather than a slogan. */
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
      /* Weighted pick over [{w:number, ...}] — used for demand curves so a
       * few SKUs move like fast movers and the long tail sits still, which is
       * what makes an ABC report worth printing. */
      weighted: function (arr, wkey) {
        var total = 0, i;
        for (i = 0; i < arr.length; i++) total += arr[i][wkey];
        var r = next() * total;
        for (i = 0; i < arr.length; i++) { r -= arr[i][wkey]; if (r <= 0) return arr[i]; }
        return arr[arr.length - 1];
      }
    };
  };

  /* --------------------------------------------------------------- waktu */

  /* Dates are UTC midnight throughout. A warehouse day is a calendar day, and
   * local-time arithmetic would silently move a receipt across a period
   * boundary for anyone east of GMT — which is everybody this app is for. */
  D.ymd = function (ts) {
    var d = new Date(ts);
    var m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  };
  D.parseYmd = function (s) {
    var p = String(s).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  };
  D.addDays = function (ymd, n) { return D.ymd(D.parseYmd(ymd) + n * 86400000); };
  D.periodeOf = function (ymd) { return String(ymd).slice(0, 7); };
  D.hariNama = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];
  D.hariOf = function (ymd) { return D.hariNama[new Date(D.parseYmd(ymd)).getUTCDay()]; };
  var BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  D.tglPanjang = function (ymd) {
    var p = String(ymd).split('-');
    return (+p[2]) + ' ' + BLN[+p[1] - 1] + ' ' + p[0];
  };
  D.periodeLabel = function (per) {
    var p = String(per).split('-');
    return BLN[+p[1] - 1] + ' ' + p[0];
  };
  D.periodeSebelum = function (per) {
    var y = +per.slice(0, 4), m = +per.slice(5, 7) - 1;
    if (m === 0) { y--; m = 12; }
    return y + '-' + (m < 10 ? '0' : '') + m;
  };

  /* ----------------------------------------------- satuan berjenjang ---- */

  /* A product carries an ordered list of units, largest first, each with an
   * integer factor expressed in BASE units:
   *   [{kode:'DUS', faktor:144}, {kode:'PAK', faktor:12}, {kode:'PCS', faktor:1}]
   * The last entry always has faktor 1 and IS the base unit. Every quantity in
   * the ledger is an integer count of base units; a unit code is a display and
   * data-entry convenience that never survives into storage.
   *
   * This is where real systems bleed. Somebody receives 10 dus, somebody else
   * sells 3 pak, and the stock card adds 10 to 3. Converting at the edge — once,
   * on the way in — and refusing to store anything else is the whole fix. */

  D.satuanBasis = function (prod) { return prod.satuan[prod.satuan.length - 1]; };

  D.satuanByKode = function (prod, kode) {
    for (var i = 0; i < prod.satuan.length; i++) if (prod.satuan[i].kode === kode) return prod.satuan[i];
    return null;
  };

  D.toBase = function (prod, qty, kode) {
    var s = D.satuanByKode(prod, kode);
    if (!s) throw new Error('satuan tidak dikenal untuk ' + prod.sku + ': ' + kode);
    if (!D.isInt(qty)) throw new Error('qty harus bilangan bulat, dapat ' + qty);
    return D.mul(qty, s.faktor);
  };

  /* Exact conversion only. 7 pcs is not 0.58 pak and this function will not
   * pretend otherwise — it returns null and the caller has to decide. */
  D.fromBaseExact = function (prod, base, kode) {
    var s = D.satuanByKode(prod, kode);
    if (!s) return null;
    if (base % s.faktor !== 0) return null;
    return base / s.faktor;
  };

  /* Mixed breakdown: 1000 base with dus=144, pak=12, pcs=1 -> 6 dus 7 pak 4 pcs.
   * Greedy over the units largest-first, which is exact because every factor
   * divides the one above it (enforced by D.satuanValid). */
  D.pecah = function (prod, base) {
    var out = [], sisa = Math.abs(base), i;
    for (i = 0; i < prod.satuan.length; i++) {
      var s = prod.satuan[i];
      var n = D.divFloor(sisa, s.faktor);
      sisa -= D.mul(n, s.faktor);
      if (n > 0 || s.faktor === 1) out.push({ kode: s.kode, n: n, faktor: s.faktor });
    }
    if (base < 0) for (i = 0; i < out.length; i++) out[i].n = -out[i].n;
    return out;
  };

  D.gabung = function (prod, pieces) {
    var total = 0;
    for (var i = 0; i < pieces.length; i++) {
      var s = D.satuanByKode(prod, pieces[i].kode);
      if (!s) throw new Error('satuan tidak dikenal: ' + pieces[i].kode);
      total += D.mul(pieces[i].n, s.faktor);
    }
    return total;
  };

  D.fmtPecah = function (prod, base) {
    if (base === 0) return '0 ' + D.satuanBasis(prod).kode.toLowerCase();
    var parts = D.pecah(prod, base), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].n === 0) continue;
      out.push(D.angka(parts[i].n) + ' ' + parts[i].kode.toLowerCase());
    }
    return out.length ? out.join(' ') : ('0 ' + D.satuanBasis(prod).kode.toLowerCase());
  };

  /* A unit ladder is only safe if each factor is an exact multiple of the one
   * below it. 1 dus = 2.5 pak has no integer representation and would make
   * pecah() lossy, so the seed generator is held to this. */
  D.satuanValid = function (prod) {
    var s = prod.satuan, i;
    if (!s.length) return 'tidak punya satuan';
    if (s[s.length - 1].faktor !== 1) return 'satuan terkecil harus berfaktor 1';
    for (i = 0; i < s.length; i++) {
      if (!D.isInt(s[i].faktor) || s[i].faktor < 1) return 'faktor ' + s[i].kode + ' bukan bilangan bulat positif';
      if (i > 0) {
        if (s[i].faktor >= s[i - 1].faktor) return 'urutan satuan harus dari terbesar';
        if (s[i - 1].faktor % s[i].faktor !== 0) return s[i - 1].kode + ' bukan kelipatan bulat dari ' + s[i].kode;
      }
    }
    return null;
  };

  /* ------------------------------------------------------------ PPN 11% */

  /* PPN naik dari 10% ke 11% per 1 April 2022 (UU HPP). The single most common
   * bug in an Indonesian POS is getting inclusive and exclusive the wrong way
   * round, so the setting is explicit, both directions are implemented here
   * once, and the tests hand-check both.
   *
   * Exclusive (harga belum termasuk PPN): ppn = round(dpp * 11 / 100).
   * Inclusive (harga sudah termasuk PPN): dpp = round(total * 100 / 111),
   *   then ppn = total - dpp, so dpp + ppn is EXACTLY the printed total. Deriving
   *   ppn by its own rounding instead would put the residue on the customer's
   *   receipt as a one-rupiah mismatch.
   *
   * Rounding is per DOCUMENT, not per line: line amounts are summed as integers
   * first and PPN is rounded once. Per-line rounding is legal but produces a
   * faktur whose total does not match the sum of its own lines under any
   * arrangement, and that is the argument you have with a tax auditor. */
  D.PPN_PERSEN = 11;

  D.hitungPpn = function (jumlah, inklusif) {
    if (!D.isInt(jumlah)) throw new Error('jumlah PPN harus bilangan bulat');
    var dpp, ppn;
    if (inklusif) {
      dpp = D.divRound(D.mul(jumlah, 100), 100 + D.PPN_PERSEN);
      ppn = jumlah - dpp;
      return { dpp: dpp, ppn: ppn, total: jumlah, inklusif: true };
    }
    dpp = jumlah;
    ppn = D.divRound(D.mul(dpp, D.PPN_PERSEN), 100);
    return { dpp: dpp, ppn: ppn, total: dpp + ppn, inklusif: false };
  };

  /* ------------------------------------------------------------ barcode */

  /* EAN-13 with a correct check digit, built on prefix 299.
   *
   * GS1 reserves prefixes 02 and 20–29 for RESTRICTED CIRCULATION — in-store
   * numbers assigned by a retailer for its own use. A 2xx code is by
   * construction not a globally-registered article number, so nothing generated
   * here can collide with a real manufacturer's product, and a scanner still
   * reads it because the check digit is genuine. That is the honest way to make
   * a fake barcode: not a random 13 digits that might belong to someone. */
  D.ean13Check = function (twelve) {
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+twelve.charAt(i)) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (sum % 10)) % 10);
  };
  D.ean13 = function (n) {
    var body = '299' + String(100000000 + (n % 900000000)).slice(0, 9);
    return body + D.ean13Check(body);
  };
  D.ean13Valid = function (code) {
    if (!/^\d{13}$/.test(code)) return false;
    return D.ean13Check(code.slice(0, 12)) === code.charAt(12);
  };

  /* --------------------------------------------------------------- NPWP */

  /* NPWP's first two digits encode the taxpayer category; the issued blocks are
   * 01–09, 21, 24, 31, 34–37 and a few others. 99 has never been issued, so a
   * 99-prefixed NPWP is structurally well-formed, passes a length check, and
   * cannot be a real taxpayer. Same trick as the barcode: fabricate inside a
   * hole in the real numbering space, not on top of it. */
  D.npwp = function (rand) {
    function d(n) { var s = ''; for (var i = 0; i < n; i++) s += rand.int(0, 9); return s; }
    return '99.' + d(3) + '.' + d(3) + '.' + d(1) + '-' + d(3) + '.' + d(3);
  };

  /* ---------------------------------------------------------------- peran */

  D.ROLES = [
    { id: 'kasir', label: 'Kasir', ket: 'Melayani penjualan dan retur di depan. Tidak menyentuh stok masuk.' },
    { id: 'gudang', label: 'Staf Gudang', ket: 'Menerima barang, mengirim transfer, menghitung opname.' },
    { id: 'pembelian', label: 'Pembelian', ket: 'Menerbitkan PO dan mencocokkan faktur supplier.' },
    { id: 'supervisor', label: 'Supervisor', ket: 'Satu-satunya yang boleh memposting penyesuaian opname dan membuka periode.' }
  ];

  D.AKSI = {
    'pos.jual': { label: 'menutup transaksi kasir', peran: ['kasir', 'supervisor'] },
    'pos.retur': { label: 'menerima retur penjualan', peran: ['kasir', 'supervisor'] },
    'beli.po': { label: 'menerbitkan purchase order', peran: ['pembelian', 'supervisor'] },
    'beli.terima': { label: 'memposting penerimaan barang', peran: ['gudang', 'supervisor'] },
    'beli.faktur': { label: 'mencocokkan faktur supplier', peran: ['pembelian', 'supervisor'] },
    'transfer.kirim': { label: 'mengirim transfer antargudang', peran: ['gudang', 'supervisor'] },
    'transfer.terima': { label: 'menerima transfer di gudang tujuan', peran: ['gudang', 'supervisor'] },
    'opname.buat': { label: 'membuka lembar opname', peran: ['gudang', 'supervisor'] },
    'opname.hitung': { label: 'mengisi hasil hitung fisik', peran: ['gudang', 'supervisor'] },
    'opname.posting': { label: 'memposting penyesuaian opname', peran: ['supervisor'] },
    'periode.tutup': { label: 'menutup periode', peran: ['supervisor'] },
    'periode.buka': { label: 'membuka kembali periode yang sudah ditutup', peran: ['supervisor'] },
    'mundur.posting': { label: 'memposting dokumen bertanggal mundur', peran: ['pembelian', 'gudang', 'supervisor'] }
  };

  /* Denials return a sentence, not a boolean. A warehouse clerk who is told
   * "tidak boleh" and nothing else will find the supervisor's password. */
  D.izin = function (peran, aksi) {
    var a = D.AKSI[aksi];
    if (!a) return { ok: false, alasan: 'Aksi tidak dikenal: ' + aksi };
    if (a.peran.indexOf(peran) >= 0) return { ok: true, alasan: '' };
    var nama = D.ROLES.filter(function (r) { return r.id === peran; })[0];
    var boleh = a.peran.map(function (p) {
      var r = D.ROLES.filter(function (x) { return x.id === p; })[0];
      return r ? r.label : p;
    }).join(' atau ');
    var ekstra = '';
    if (aksi === 'opname.posting') {
      ekstra = ' Posting opname mengubah nilai persediaan dan langsung masuk ke jurnal stok, ' +
        'jadi pemisahan antara yang menghitung dan yang mengesahkan adalah pengendalian intern, bukan birokrasi.';
    } else if (aksi === 'periode.buka') {
      ekstra = ' Membuka periode yang sudah ditutup akan menghitung ulang HPP dokumen-dokumen yang sudah dilaporkan.';
    } else if (aksi === 'beli.terima') {
      ekstra = ' Yang menerima fisik barang harus orang gudang, bukan orang yang memesannya.';
    }
    return {
      ok: false,
      alasan: 'Peran ' + (nama ? nama.label : peran) + ' tidak berwenang ' + a.label + '. Yang boleh: ' + boleh + '.' + ekstra
    };
  };

  /* --------------------------------------------------- kode & konstanta */

  D.TRANSIT = 'TRANSIT';

  D.JENIS = {
    'terima': { label: 'Penerimaan', arah: 1, grup: 'pembelian' },
    'jual': { label: 'Penjualan', arah: -1, grup: 'penjualan' },
    'retur-jual': { label: 'Retur penjualan', arah: 1, grup: 'retur-jual' },
    'retur-beli': { label: 'Retur pembelian', arah: -1, grup: 'retur-beli' },
    'transfer-keluar': { label: 'Transfer keluar', arah: -1, grup: 'transfer' },
    'transfer-masuk': { label: 'Transfer masuk', arah: 1, grup: 'transfer' },
    'adjust': { label: 'Penyesuaian opname', arah: 0, grup: 'penyesuaian' },
    'saldo-awal': { label: 'Saldo awal', arah: 1, grup: 'saldo-awal' }
  };

  D.ALASAN_SELISIH = [
    { kode: 'susut', label: 'Susut / rusak', arah: 'kurang' },
    { kode: 'hilang', label: 'Hilang tanpa dokumen', arah: 'kurang' },
    { kode: 'salah-hitung', label: 'Salah hitung periode lalu', arah: 'dua' },
    { kode: 'salah-satuan', label: 'Salah konversi satuan', arah: 'dua' },
    { kode: 'salah-input', label: 'Salah input dokumen', arah: 'dua' },
    { kode: 'ditemukan', label: 'Barang ditemukan kembali', arah: 'lebih' },
    { kode: 'belum-posting', label: 'Dokumen belum diposting', arah: 'lebih' }
  ];
  D.alasanLabel = function (kode) {
    for (var i = 0; i < D.ALASAN_SELISIH.length; i++) if (D.ALASAN_SELISIH[i].kode === kode) return D.ALASAN_SELISIH[i].label;
    return kode || '—';
  };

  D.METODE = [
    { id: 'fifo', label: 'FIFO (masuk pertama, keluar pertama)', ket: 'Lapisan biaya nyata; setiap penerimaan membuat lapisan, setiap pengeluaran menghabiskan lapisan tertua lebih dulu.' },
    { id: 'rata', label: 'Rata-rata tertimbang', ket: 'HPP dihitung ulang setiap penerimaan: (qty lama x hpp lama + qty masuk x harga masuk) / (qty lama + qty masuk).' }
  ];

  /* LIFO is deliberately absent, and the UI says why. PSAK 14 (mengikuti IAS 2)
   * hanya mengizinkan FIFO dan rata-rata tertimbang; UU PPh Pasal 10 ayat (6)
   * menyebut kedua metode itu saja untuk penilaian persediaan. Offering a LIFO
   * toggle in an Indonesian system is not a feature, it is a liability. */
  D.CATATAN_LIFO =
    'LIFO tidak disediakan. PSAK 14 hanya mengakui FIFO dan rata-rata tertimbang, ' +
    'dan Pasal 10 ayat (6) UU PPh menyebut kedua metode itu saja untuk penilaian persediaan. ' +
    'Metode yang dipilih juga harus dipakai taat asas — sistem ini memperlihatkan selisih keduanya ' +
    'justru supaya keputusan itu diambil sekali dengan sadar.';

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
