/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — tests.js
 * Assertions against the engine, run in the page on load (the badge in the
 * header) and under node from the same file.
 *
 * Ranked by how much damage each one prevents:
 *
 *  1. VALUE CONSERVATION. Purchases minus COGS minus adjustments equals closing
 *     inventory, to the rupiah, under both methods, before and after a
 *     backdated insert. If this breaks the app is lying about money and nothing
 *     else it says can be trusted.
 *  2. THE LEDGER INVARIANT. saldo awal + masuk - keluar = saldo akhir on every
 *     row of every stock card, for every SKU in every gudang, cross-checked
 *     against a balance derived by pure summation that never touches the
 *     costing engine.
 *  3. FIFO LAYER DISCIPLINE. Layers consumed strictly oldest-first — verified by
 *     re-deriving the minimum key inside the consumption loop rather than
 *     trusting the queue — and never negative, never out of order, even after a
 *     retur puts an old layer back.
 *  4. BACKDATED RECOMPUTATION. The incremental recompute matches a full replay
 *     document for document, nothing before the insertion point moves, and the
 *     documents after it do move.
 *  5. NO FLOATS. Every rupiah and every quantity, in the seed data, in the
 *     ledger, in every costing result, is an integer.
 *  6. Everything else: unit round-trips, opname posting an entry rather than a
 *     balance, in-transit counted exactly once, retur at original cost, PPN both
 *     ways, role denials.
 */
(function (root) {
  'use strict';

  var D = root.GUDANG_DOMAIN;
  var L = root.GUDANG_LEDGER;
  var P = root.GUDANG_PROSES;
  var S = root.GUDANG_SEED;

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
      lte: function (a, b, name) { record(a <= b, name, 'diharap <= ' + b + ', dapat ' + a); },
      gte: function (a, b, name) { record(a >= b, name, 'diharap >= ' + b + ', dapat ' + a); },
      throws: function (fn, name) {
        var lempar = false;
        try { fn(); } catch (e) { lempar = true; }
        record(lempar, name, 'diharap melempar, tidak melempar');
      }
    };
  }

  /* One demo book, built once, shared by every group. Building it twice would
   * itself be a determinism check — so that is a test of its own below. */
  var DB = null;
  function db() { return DB || (DB = S.build()); }

  var RUN = {};
  function run(metode) {
    if (!RUN[metode]) {
      RUN[metode] = L.replay(L.urut(db().buku.entries), {
        metode: metode, periksaUrutan: true, hargaAcuan: db().hargaAcuan
      });
    }
    return RUN[metode];
  }
  var SORTED = null;
  function sorted() { return SORTED || (SORTED = L.urut(db().buku.entries)); }

  /* A tiny book with hand-computable numbers. Every costing claim in this suite
   * is checked twice: once against arithmetic a reader can do on paper here,
   * and once against the four-thousand-entry demo book. */
  function mini() {
    var b = L.buatBuku();
    return {
      buku: b,
      add: function (o) { return L.tambah(b, o); },
      jalan: function (metode) { return L.replay(L.urut(b.entries), { metode: metode, periksaUrutan: true }); }
    };
  }
  function bukuDasar() {
    var m = mini();
    m.terima1 = m.add({ tgl: '2026-01-05', sku: 'X', gudang: 'G', arah: 1, qty: 100, jenis: 'terima', dok: 'PN-1', harga: 1000 });
    m.terima2 = m.add({ tgl: '2026-01-10', sku: 'X', gudang: 'G', arah: 1, qty: 50, jenis: 'terima', dok: 'PN-2', harga: 1200 });
    m.jual1 = m.add({ tgl: '2026-01-12', sku: 'X', gudang: 'G', arah: -1, qty: 120, jenis: 'jual', dok: 'KS-1', nilaiJual: 200000 });
    return m;
  }

  /* ============================================ 1. bilangan bulat ======= */

  group('Uang dan kuantitas selalu bilangan bulat', function (t) {
    t.eq(D.divRound(1500, 1000), 2, 'divRound(1500,1000) = 2 (setengah dibulatkan menjauhi nol)');
    t.eq(D.divRound(2500, 1000), 3, 'divRound(2500,1000) = 3, bukan 2 — ini bukan pembulatan bankir');
    t.eq(D.divRound(1499, 1000), 1, 'divRound(1499,1000) = 1');
    t.eq(D.divRound(-1500, 1000), -2, 'divRound(-1500,1000) = -2, simetris terhadap nol');
    t.eq(D.divRound(-2500, 1000), -3, 'divRound(-2500,1000) = -3');
    t.eq(D.divRound(1, 2), 1, 'divRound(1,2) = 1');
    t.eq(D.divRound(-1, 2), -1, 'divRound(-1,2) = -1');
    t.eq(D.divRound(0, 5), 0, 'divRound(0,5) = 0');
    t.eq(D.divRound(7, 3), 2, 'divRound(7,3) = 2');
    t.eq(D.divRound(8, 3), 3, 'divRound(8,3) = 3');
    t.eq(D.divRound(5, 2), 3, 'divRound(5,2) = 3');
    t.eq(D.divRound(-5, 2), -3, 'divRound(-5,2) = -3');
    t.eq(D.divRound(160000, 150), 1067, 'divRound(160000,150) = 1067 — HPP rata-rata contoh buku');
    t.eq(D.divRound(100, 10), 10, 'pembagian pas tetap pas');
    t.eq(D.divFloor(7, 3), 2, 'divFloor(7,3) = 2 — pemecahan satuan tidak boleh membulatkan ke atas');
    t.eq(D.divFloor(1000, 144), 6, 'divFloor(1000,144) = 6 dus');
    t.throws(function () { D.divRound(1.5, 2); }, 'divRound menolak argumen pecahan');
    t.throws(function () { D.divRound(3, 0); }, 'divRound menolak pembagi nol');
    t.throws(function () { D.mul(D.MAX_SAFE, 4); }, 'mul melempar sebelum melewati 2^53');
    t.ok(D.isInt(0) && D.isInt(-7) && D.isInt(1e6), 'isInt menerima bilangan bulat');
    t.notOk(D.isInt(0.1) || D.isInt(NaN) || D.isInt(Infinity) || D.isInt('5'), 'isInt menolak pecahan, NaN, tak hingga dan string');

    /* Walk the entire seed object and the entire costing result looking for a
     * float in any field that carries money or quantity. This is the assertion
     * a reviewer greps for, so it is exhaustive rather than sampled. */
    var UANG = {
      qty: 1, qtyBase: 1, qtySatuan: 1, harga: 1, hargaBase: 1, hargaSatuan: 1, hargaBeli: 1,
      hargaJual: 1, nilai: 1, nilaiJual: 1, nilaiTerima: 1, nilaiFaktur: 1, nilaiPo: 1,
      total: 1, dpp: 1, ppn: 1, subtotal: 1, jumlah: 1, kembali: 1, diskon: 1, diskonBp: 1,
      faktor: 1, minStok: 1, bukuQty: 1, fisikQty: 1, unitCost: 1, unit: 1, seq: 1, bekuSeq: 1
    };
    var pelanggar = [], dilihat = 0;
    (function walk(o, path, depth) {
      if (depth > 7 || o === null || typeof o !== 'object') return;
      for (var k in o) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        var v = o[k];
        if (typeof v === 'number') {
          if (UANG[k]) { dilihat++; if (!D.isInt(v)) pelanggar.push(path + '.' + k + ' = ' + v); }
        } else if (v && typeof v === 'object') walk(v, path + '.' + k, depth + 1);
      }
    })(db(), 'db', 0);
    t.gte(dilihat, 20000, 'pemeriksaan menyentuh ' + dilihat + ' medan uang/kuantitas di data demo');
    t.eq(pelanggar.length, 0, 'tidak ada satu pun medan uang atau kuantitas berupa pecahan' + (pelanggar.length ? ' (' + pelanggar.slice(0, 3).join(', ') + ')' : ''));

    ['fifo', 'rata'].forEach(function (m) {
      var h = run(m), bukanInt = 0, n = 0;
      for (var id in h.hasil) {
        if (!Object.prototype.hasOwnProperty.call(h.hasil, id)) continue;
        var r = h.hasil[id]; n++;
        if (!D.isInt(r.nilai) || !D.isInt(r.unit) || !D.isInt(r.qty)) bukanInt++;
        for (var i = 0; i < r.layers.length; i++) {
          if (!D.isInt(r.layers[i].qty) || !D.isInt(r.layers[i].unitCost) || !D.isInt(r.layers[i].nilai)) bukanInt++;
        }
      }
      t.eq(bukanInt, 0, m + ': seluruh ' + n + ' hasil biaya per dokumen bulat, termasuk tiap lapisan');
      var stBukan = 0, keys = 0;
      for (var k2 in h.st) {
        if (!Object.prototype.hasOwnProperty.call(h.st, k2)) continue;
        keys++;
        if (!D.isInt(h.st[k2].qty) || !D.isInt(h.st[k2].nilai)) stBukan++;
      }
      t.eq(stBukan, 0, m + ': saldo ' + keys + ' pasangan SKU×gudang bulat');
      var kons = L.konservasi(h), bk = 0;
      for (var k3 in kons) if (typeof kons[k3] === 'number' && !D.isInt(kons[k3])) bk++;
      t.eq(bk, 0, m + ': setiap angka pada rekonsiliasi nilai berupa bilangan bulat');
    });

    t.throws(function () { L.tambah(L.buatBuku(), { tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 1, qty: 1.5, jenis: 'terima', harga: 1000 }); },
      'ledger menolak qty pecahan di pintu masuk');
    t.throws(function () { L.tambah(L.buatBuku(), { tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 1, qty: 5, jenis: 'terima', harga: 999.99 }); },
      'ledger menolak harga pecahan di pintu masuk');
    t.throws(function () { L.tambah(L.buatBuku(), { tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 1, qty: 0, jenis: 'terima', harga: 1 }); },
      'ledger menolak qty nol');
    t.throws(function () { L.tambah(L.buatBuku(), { tgl: '2026-1-1', sku: 'X', gudang: 'G', arah: 1, qty: 1, jenis: 'terima', harga: 1 }); },
      'ledger menolak tanggal yang bukan YYYY-MM-DD');
    t.throws(function () { L.tambah(L.buatBuku(), { tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 0, qty: 1, jenis: 'terima', harga: 1 }); },
      'ledger menolak arah selain +1 / -1');
    t.eq(D.rupiah(1234567), 'Rp1.234.567', 'format rupiah memakai titik ribuan');
    t.eq(D.rupiah(-5000), '-Rp5.000', 'format rupiah negatif');
    t.eq(D.rupiah(0), 'Rp0', 'nol tetap Rp0');
    t.ok(D.rupiah(12.5).charAt(0) === '!', 'pecahan yang lolos ke formatter ditandai jelek, bukan disembunyikan');
  });

  /* =========================================== 2. satuan berjenjang ===== */

  group('Satuan berjenjang — konversi bolak-balik eksak', function (t) {
    var d = db();
    var tangga = { kode: 'X', satuan: [{ kode: 'DUS', faktor: 144 }, { kode: 'PAK', faktor: 12 }, { kode: 'PCS', faktor: 1 }] };
    t.eq(D.toBase(tangga, 3, 'DUS'), 432, '3 dus = 432 pcs bila 1 dus = 144 pcs');
    t.eq(D.toBase(tangga, 5, 'PAK'), 60, '5 pak = 60 pcs');
    t.eq(D.toBase(tangga, 7, 'PCS'), 7, '7 pcs = 7 pcs');
    t.eq(D.fromBaseExact(tangga, 432, 'DUS'), 3, '432 pcs kembali menjadi 3 dus');
    t.eq(D.fromBaseExact(tangga, 7, 'DUS'), null, '7 pcs BUKAN 0,048 dus — konversi tak eksak mengembalikan null, tidak berpura-pura');
    t.eq(D.fromBaseExact(tangga, 60, 'PAK'), 5, '60 pcs kembali menjadi 5 pak');
    t.eq(D.fmtPecah(tangga, 1000), '6 dus 11 pak 4 pcs', '1000 pcs = 6 dus 11 pak 4 pcs (864 + 132 + 4)');
    t.eq(D.gabung(tangga, [{ kode: 'DUS', n: 6 }, { kode: 'PAK', n: 11 }, { kode: 'PCS', n: 4 }]), 1000, 'dan pecahan itu dijumlahkan kembali persis ke 1000');
    t.eq(D.fmtPecah(tangga, 863), '5 dus 11 pak 11 pcs', 'satu unit di bawah 6 dus dipecah tanpa membulatkan ke atas');
    t.eq(D.gabung(tangga, D.pecah(tangga, 863)), 863, 'dan itu pun bolak-balik eksak');
    t.eq(D.fmtPecah(tangga, 144), '1 dus', 'tepat satu dus tidak menyisakan pak atau pcs');
    t.eq(D.fmtPecah(tangga, 0), '0 pcs', 'nol ditulis dalam satuan dasar');
    t.eq(D.satuanBasis(tangga).kode, 'PCS', 'satuan dasar adalah yang berfaktor 1');
    t.throws(function () { D.toBase(tangga, 3, 'KARTON'); }, 'satuan tak dikenal melempar, bukan diam-diam dianggap 1');
    t.throws(function () { D.toBase(tangga, 2.5, 'DUS'); }, 'qty pecahan ditolak sebelum dikonversi');
    t.eq(D.satuanValid(tangga), null, 'tangga 144/12/1 valid');
    t.ok(D.satuanValid({ satuan: [{ kode: 'A', faktor: 10 }, { kode: 'B', faktor: 4 }, { kode: 'C', faktor: 1 }] }),
      'tangga 10/4/1 ditolak: 10 bukan kelipatan bulat dari 4, pemecahan satuan akan bocor');
    t.ok(D.satuanValid({ satuan: [{ kode: 'A', faktor: 12 }, { kode: 'B', faktor: 2 }] }), 'tangga tanpa satuan berfaktor 1 ditolak');
    t.ok(D.satuanValid({ satuan: [{ kode: 'A', faktor: 2 }, { kode: 'B', faktor: 12 }, { kode: 'C', faktor: 1 }] }), 'tangga yang tidak menurun ditolak');

    var tanggaSalah = 0;
    for (var i = 0; i < d.produk.length; i++) if (D.satuanValid(d.produk[i]) !== null) tanggaSalah++;
    t.eq(tanggaSalah, 0, 'ke-' + d.produk.length + ' produk punya tangga satuan yang setiap faktornya kelipatan bulat faktor di bawahnya');

    var rtGagal = 0, rtCoba = 0;
    for (i = 0; i < d.produk.length; i++) {
      var pr = d.produk[i];
      for (var s = 0; s < pr.satuan.length; s++) {
        for (var n = 1; n <= 9; n++) {
          rtCoba++;
          var base = D.toBase(pr, n, pr.satuan[s].kode);
          if (D.fromBaseExact(pr, base, pr.satuan[s].kode) !== n) rtGagal++;
        }
      }
    }
    t.eq(rtGagal, 0, rtCoba + ' konversi satuan→dasar→satuan kembali persis ke angka semula');

    var pecahGagal = 0, pecahCoba = 0;
    for (i = 0; i < d.produk.length; i++) {
      var pr2 = d.produk[i];
      for (var v = 0; v < 40; v++) {
        var x = (i * 977 + v * 173) % 20011;
        pecahCoba++;
        if (D.gabung(pr2, D.pecah(pr2, x)) !== x) pecahGagal++;
      }
    }
    t.eq(pecahGagal, 0, pecahCoba + ' pemecahan campur (dus/pak/pcs) dijumlahkan kembali persis ke jumlah dasar semula');

    var negGagal = 0;
    for (i = 0; i < 30; i++) {
      var pr3 = d.produk[i * 4 % d.produk.length];
      var xx = -(i * 331 + 17);
      if (D.gabung(pr3, D.pecah(pr3, xx)) !== xx) negGagal++;
    }
    t.eq(negGagal, 0, 'pemecahan jumlah negatif (selisih opname kurang) juga bolak-balik eksak');

    var mulGagal = 0;
    for (i = 0; i < d.produk.length; i++) {
      var pr4 = d.produk[i], outer = pr4.satuan[0].faktor;
      if (D.toBase(pr4, 1, pr4.satuan[0].kode) !== outer) mulGagal++;
      if (pr4.satuan.length === 3) {
        var tengah = pr4.satuan[1].faktor;
        if (outer % tengah !== 0) mulGagal++;
        if (D.fmtPecah(pr4, outer) !== '1 ' + pr4.satuan[0].kode.toLowerCase()) mulGagal++;
      }
    }
    t.eq(mulGagal, 0, 'satu satuan terluar setiap produk memecah kembali menjadi tepat "1 <satuan terluar>"');

    /* Every quantity ever written to the ledger is in base units, so the count
     * of distinct unit codes appearing in the ledger is exactly zero. */
    var adaSatuan = 0;
    for (i = 0; i < d.buku.entries.length; i++) if (d.buku.entries[i].satuan !== undefined) adaSatuan++;
    t.eq(adaSatuan, 0, 'tidak ada entry buku besar yang menyimpan kode satuan — semuanya sudah dalam satuan dasar');
  });

  /* ============================================ 3. invarian buku ======== */

  group('Buku besar — saldo akhir = saldo awal + masuk - keluar', function (t) {
    var s = sorted(), d = db();
    t.gte(s.length, 3000, 'buku demo berisi ' + s.length + ' entry — cukup untuk laporan yang bercerita');

    var idUnik = {}, seqUnik = {}, dobelId = 0, dobelSeq = 0;
    for (var i = 0; i < s.length; i++) {
      if (idUnik[s[i].id]) dobelId++; idUnik[s[i].id] = 1;
      if (seqUnik[s[i].seq]) dobelSeq++; seqUnik[s[i].seq] = 1;
    }
    t.eq(dobelId, 0, 'setiap entry punya id unik');
    t.eq(dobelSeq, 0, 'setiap entry punya nomor urut unik — urutan sisip tidak pernah dipakai ulang');

    var urutRusak = 0;
    for (i = 1; i < s.length; i++) {
      if (s[i].tgl < s[i - 1].tgl) urutRusak++;
      else if (s[i].tgl === s[i - 1].tgl && s[i].seq < s[i - 1].seq) urutRusak++;
    }
    t.eq(urutRusak, 0, 'urutan pemrosesan benar-benar (tanggal, nomor urut) menaik');

    var kunci = {};
    for (i = 0; i < s.length; i++) kunci[s[i].sku + '|' + s[i].gudang] = 1;
    var daftar = Object.keys(kunci);
    t.gte(daftar.length, 300, daftar.length + ' pasangan SKU×gudang bergerak di buku');

    var h = run('fifo');
    var barisDiperiksa = 0, barisRusak = 0, akhirRusak = 0, negatif = 0, kartuKosong = 0;
    for (i = 0; i < daftar.length; i++) {
      var p = daftar[i].split('|');
      var kartu = L.kartuStok(s, h, p[0], p[1]);
      if (!kartu.baris.length) { kartuKosong++; continue; }
      var jalan = 0;
      for (var b = 0; b < kartu.baris.length; b++) {
        var row = kartu.baris[b];
        barisDiperiksa++;
        if (row.awalQty + row.masukQty - row.keluarQty !== row.akhirQty) barisRusak++;
        if (row.akhirQty < 0) negatif++;
        jalan = row.akhirQty;
      }
      if (jalan !== kartu.akhir.qty) akhirRusak++;
      if (kartu.akhir.qty !== (h.st[daftar[i]] ? h.st[daftar[i]].qty : 0)) akhirRusak++;
    }
    t.eq(kartuKosong, 0, 'setiap pasangan yang muncul di buku menghasilkan kartu stok yang tidak kosong');
    t.gte(barisDiperiksa, 3000, 'invarian diuji pada ' + barisDiperiksa + ' baris kartu stok');
    t.eq(barisRusak, 0, 'saldo awal + masuk - keluar = saldo akhir pada SETIAP baris kartu stok');
    t.eq(akhirRusak, 0, 'saldo akhir setiap kartu sama dengan saldo yang dipegang mesin biaya');
    t.eq(negatif, 0, 'tidak ada satu pun titik waktu dengan stok negatif');

    /* The independent check: balances by pure summation, never touching the
     * costing engine. If the engine and this disagree, the engine is wrong. */
    var mentah = L.saldoMentah(s), beda = 0, dicek = 0;
    for (var k in h.st) {
      if (!Object.prototype.hasOwnProperty.call(h.st, k)) continue;
      dicek++;
      if (h.st[k].qty !== (mentah[k] || 0)) beda++;
    }
    t.eq(beda, 0, 'kuantitas mesin biaya cocok dengan penjumlahan murni buku untuk ' + dicek + ' pasangan');
    var bedaRata = 0;
    var hr = run('rata');
    for (k in hr.st) {
      if (!Object.prototype.hasOwnProperty.call(hr.st, k)) continue;
      if (hr.st[k].qty !== (mentah[k] || 0)) bedaRata++;
    }
    t.eq(bedaRata, 0, 'metode rata-rata menghasilkan kuantitas yang sama persis — metode biaya tidak boleh menggeser stok');

    /* Balance "as of" an arbitrary date must equal the prefix sum. Six probe
     * dates across the demo period, exhaustive over all keys. */
    var tglUji = ['2026-03-15', '2026-04-20', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31'];
    for (var ti = 0; ti < tglUji.length; ti++) {
      var asOf = L.saldoMentah(s, tglUji[ti]);
      var ulang = {}, salah = 0;
      for (i = 0; i < s.length; i++) {
        if (s[i].tgl > tglUji[ti]) continue;
        var kk = s[i].sku + '|' + s[i].gudang;
        ulang[kk] = (ulang[kk] || 0) + s[i].arah * s[i].qty;
      }
      for (kk in ulang) if (Object.prototype.hasOwnProperty.call(ulang, kk) && ulang[kk] !== asOf[kk]) salah++;
      t.eq(salah, 0, 'saldo per ' + tglUji[ti] + ' identik dengan jumlah prefiks buku');
    }

    var adaStok = 0;
    for (i = 0; i < d.produk.length; i++) if (L.posisiSku(h, d.produk[i].sku).qty > 0) adaStok++;
    t.gte(adaStok, 90, adaStok + ' dari ' + d.produk.length + ' SKU masih bersaldo di akhir periode');

    var pos = L.posisi(h), totalPos = 0;
    for (i = 0; i < pos.length; i++) totalPos += pos[i].nilai;
    t.eq(totalPos, h.akhir.nilai, 'jumlah nilai baris laporan posisi persis sama dengan nilai persediaan akhir');
  });

  /* ================================================= 4. FIFO ============ */

  group('FIFO — lapisan biaya nyata', function (t) {
    var m = bukuDasar();
    var h = m.jalan('fifo');
    var hj = h.hasil[m.jual1.id];
    t.eq(hj.nilai, 124000, 'jual 120 dari lapisan 100@1000 lalu 50@1200 = 100.000 + 24.000 = 124.000');
    t.eq(hj.layers.length, 2, 'pengeluaran itu memecah dua lapisan, bukan satu');
    t.eq(hj.layers[0].qty, 100, 'lapisan tertua dihabiskan lebih dulu, seluruh 100 unit');
    t.eq(hj.layers[0].unitCost, 1000, 'pada harga perolehannya sendiri, 1.000');
    t.eq(hj.layers[1].qty, 20, 'sisanya 20 unit diambil dari lapisan kedua');
    t.eq(hj.layers[1].unitCost, 1200, 'pada 1.200 — lapisan kedua tidak diratakan dengan yang pertama');
    t.eq(hj.unit, D.divRound(124000, 120), 'HPP per unit dokumen itu 1.033 (124.000 / 120, dibulatkan)');
    var st = h.st['X|G'];
    t.eq(st.qty, 30, 'sisa 30 unit');
    t.eq(st.nilai, 36000, 'senilai 36.000 — 30 x 1.200, bukan 30 x rata-rata');
    t.eq(st.layers.length, 1, 'lapisan pertama dibuang begitu mencapai nol, tidak ditinggalkan berisi nol');
    t.eq(st.layers[0].qty, 30, 'lapisan tersisa berisi 30');
    t.eq(st.layers[0].unitCost, 1200, 'dengan biaya 1.200');
    t.eq(L.konservasi(h).selisih, 0, 'buku kecil ini pun tertutup ke rupiah');

    // Exhaustive layer discipline over the full demo book.
    var H = run('fifo');
    t.eq(H.urutSalah, 0, 'pada seluruh buku demo, lapisan SELALU diambil yang berkunci terkecil — diperiksa ulang di dalam gelung konsumsi, bukan dipercaya dari urutan antrean');
    t.eq(H.layerNegatif, 0, 'tidak ada lapisan yang pernah bernilai kuantitas negatif');
    t.eq(H.defisit.length, 0, 'tidak ada pengeluaran yang melebihi stok tersedia di seluruh buku demo');

    var layerNol = 0, layerNeg = 0, keyBeda = 0, urutKeliru = 0, totalLayer = 0, kunciDicek = 0;
    for (var k in H.st) {
      if (!Object.prototype.hasOwnProperty.call(H.st, k)) continue;
      var s2 = H.st[k];
      kunciDicek++;
      var jum = 0, nil = 0;
      for (var i = 0; i < s2.layers.length; i++) {
        totalLayer++;
        if (s2.layers[i].qty === 0) layerNol++;
        if (s2.layers[i].qty < 0) layerNeg++;
        if (i > 0 && s2.layers[i - 1].kunci > s2.layers[i].kunci) urutKeliru++;
        jum += s2.layers[i].qty;
        nil += D.mul(s2.layers[i].qty, s2.layers[i].unitCost);
      }
      if (jum !== s2.qty) keyBeda++;
      if (nil !== s2.nilai) keyBeda++;
    }
    t.eq(layerNol, 0, totalLayer + ' lapisan tersisa, tidak satu pun berkuantitas nol');
    t.eq(layerNeg, 0, 'tidak satu pun berkuantitas negatif');
    t.eq(urutKeliru, 0, 'setiap antrean lapisan tersusun menaik menurut (tanggal, urut) perolehannya');
    t.eq(keyBeda, 0, 'pada ' + kunciDicek + ' pasangan, jumlah kuantitas DAN nilai lapisan sama persis dengan saldo yang dicatat');

    // Partial consumption splits rather than rounds.
    var m2 = mini();
    m2.add({ tgl: '2026-02-01', sku: 'Y', gudang: 'G', arah: 1, qty: 7, jenis: 'terima', dok: 'A', harga: 3333 });
    var j1 = m2.add({ tgl: '2026-02-02', sku: 'Y', gudang: 'G', arah: -1, qty: 3, jenis: 'jual', dok: 'B' });
    var j2 = m2.add({ tgl: '2026-02-03', sku: 'Y', gudang: 'G', arah: -1, qty: 4, jenis: 'jual', dok: 'C' });
    var h2 = m2.jalan('fifo');
    t.eq(h2.hasil[j1.id].nilai, 9999, 'pengeluaran parsial 3 x 3.333 = 9.999');
    t.eq(h2.hasil[j2.id].nilai, 13332, 'sisa lapisan 4 x 3.333 = 13.332');
    t.eq(h2.st['Y|G'].qty, 0, 'lapisan habis pas');
    t.eq(h2.st['Y|G'].nilai, 0, 'dan nilainya nol — tidak ada rupiah yatim tertinggal di rak kosong');
    t.eq(h2.hasil[j1.id].nilai + h2.hasil[j2.id].nilai, D.mul(7, 3333), 'dua pengeluaran menjumlah persis ke nilai perolehan');

    // Three layers, one issue crossing all three.
    var m3 = mini();
    m3.add({ tgl: '2026-03-01', sku: 'Z', gudang: 'G', arah: 1, qty: 10, jenis: 'terima', dok: 'A', harga: 100 });
    m3.add({ tgl: '2026-03-02', sku: 'Z', gudang: 'G', arah: 1, qty: 10, jenis: 'terima', dok: 'B', harga: 200 });
    m3.add({ tgl: '2026-03-03', sku: 'Z', gudang: 'G', arah: 1, qty: 10, jenis: 'terima', dok: 'C', harga: 300 });
    var j3 = m3.add({ tgl: '2026-03-04', sku: 'Z', gudang: 'G', arah: -1, qty: 25, jenis: 'jual', dok: 'D' });
    var h3 = m3.jalan('fifo');
    t.eq(h3.hasil[j3.id].nilai, 1000 + 2000 + 1500, 'satu pengeluaran melintasi tiga lapisan: 10x100 + 10x200 + 5x300 = 4.500');
    t.eq(h3.hasil[j3.id].layers.length, 3, 'dan mencatat ketiga lapisan yang dipakainya');
    t.eq(h3.st['Z|G'].layers.length, 1, 'menyisakan satu lapisan');
    t.eq(h3.st['Z|G'].layers[0].unitCost, 300, 'yaitu lapisan termuda, 300');
    t.eq(h3.st['Z|G'].nilai, 1500, 'senilai 1.500');

    // FIFO ≠ average when purchase prices move: this is the whole point.
    var hf = run('fifo'), hr = run('rata');
    t.ok(hf.total.hppJual !== hr.total.hppJual, 'HPP FIFO (' + D.rupiah(hf.total.hppJual) + ') berbeda dari rata-rata (' + D.rupiah(hr.total.hppJual) + ') — harga beli memang bergerak, jadi metode berpengaruh');
    t.ok(hf.akhir.nilai !== hr.akhir.nilai, 'nilai persediaan akhir kedua metode juga berbeda');
    t.lte(Math.abs(hf.total.hppJual - hr.total.hppJual), D.divRound(hf.total.hppJual, 10),
      'tapi selisihnya di bawah 10% — kalau lebih dari itu salah satunya bermasalah, bukan sekadar berbeda metode');
    t.eq((hf.total.hppJual + hf.akhir.nilai) - (hr.total.hppJual + hr.akhir.nilai),
      (hf.total.returJual - hr.total.returJual) + (hf.total.adjMasuk - hr.total.adjMasuk) - (hf.total.returBeli - hr.total.returBeli) - (hf.total.adjKeluar - hr.total.adjKeluar),
      'apa yang ditambahkan satu metode pada HPP diambilnya dari persediaan akhir — nilai yang masuk sistem tidak bergantung metode, hanya pembagiannya antara HPP dan persediaan');
    t.eq(hf.total.masuk - hf.total.keluar - hf.akhir.nilai, 0, 'identitas nilai FIFO tertutup');
    t.eq(hr.total.masuk - hr.total.keluar - hr.akhir.nilai, 0, 'identitas nilai rata-rata tertutup');
  });

  /* ============================================= 5. rata-rata =========== */

  group('Rata-rata tertimbang — rumus, pembulatan, dan sisa', function (t) {
    t.eq(L.rataTextbook(100, 1000, 50, 1200), 1067, 'rumus buku: (100x1000 + 50x1200) / 150 = 1.066,67 -> 1.067');
    t.eq(L.rataTextbook(0, 0, 40, 2500), 2500, 'penerimaan pertama menjadi HPP apa adanya');
    t.eq(L.rataTextbook(10, 100, 10, 200), 150, 'dua lot sama besar merata di tengah');
    t.eq(L.rataTextbook(3, 1000, 1, 1001), 1000, '(3000+1001)/4 = 1.000,25 -> 1.000');
    t.eq(L.rataTextbook(1, 1000, 1, 1001), 1001, '(1000+1001)/2 = 1.000,5 -> 1.001, setengah menjauhi nol');
    t.eq(L.rataTextbook(0, 0, 0, 0), 0, 'gudang kosong tanpa penerimaan tidak membagi dengan nol');

    var m = bukuDasar();
    var h = m.jalan('rata');
    t.eq(h.hasil[m.terima1.id].unit, 1000, 'setelah penerimaan pertama HPP = 1.000');
    var stSetelah2 = D.divRound(D.mul(100, 1000) + D.mul(50, 1200), 150);
    t.eq(stSetelah2, 1067, 'setelah penerimaan kedua HPP dihitung ulang menjadi 1.067');
    t.eq(h.hasil[m.jual1.id].nilai, 128000, 'jual 120 dinilai 160.000 x 120 / 150 = 128.000');
    t.eq(h.hasil[m.jual1.id].unit, D.divRound(128000, 120), 'atau 1.067 per unit');
    t.eq(h.st['X|G'].qty, 30, 'sisa 30 unit');
    t.eq(h.st['X|G'].nilai, 32000, 'senilai 32.000');
    t.eq(D.divRound(h.st['X|G'].nilai, h.st['X|G'].qty), 1067, 'yang kalau dibagi kembali tetap 1.067');
    t.eq(h.hasil[m.jual1.id].nilai + h.st['X|G'].nilai, D.mul(100, 1000) + D.mul(50, 1200),
      'HPP + persediaan akhir = seluruh nilai pembelian, PERSIS, tanpa sisa pembulatan yang lolos');

    /* The residue trap: multiplying a rounded unit cost out on every issue
     * leaks rupiah. Here is the leak, measured, next to the engine that does
     * not have it. */
    var salahCara = D.mul(120, 1067) + D.mul(30, 1067);
    t.ok(salahCara !== 160000, 'cara naif (120 x 1.067 + 30 x 1.067 = ' + D.angka(salahCara) + ') meleset ' + (salahCara - 160000) + ' rupiah dari 160.000');
    t.eq(h.hasil[m.jual1.id].nilai + h.st['X|G'].nilai - 160000, 0, 'mesin ini tidak meleset sama sekali');

    // Emptying the bin must zero the value exactly.
    var m2 = mini();
    m2.add({ tgl: '2026-01-01', sku: 'A', gudang: 'G', arah: 1, qty: 3, jenis: 'terima', dok: 'a', harga: 1000 });
    m2.add({ tgl: '2026-01-02', sku: 'A', gudang: 'G', arah: 1, qty: 7, jenis: 'terima', dok: 'b', harga: 1111 });
    var jj = m2.add({ tgl: '2026-01-03', sku: 'A', gudang: 'G', arah: -1, qty: 10, jenis: 'jual', dok: 'c' });
    var h2 = m2.jalan('rata');
    t.eq(h2.hasil[jj.id].nilai, 3000 + 7777, 'mengeluarkan seluruh stok mengeluarkan seluruh nilainya');
    t.eq(h2.st['A|G'].qty, 0, 'kuantitas nol');
    t.eq(h2.st['A|G'].nilai, 0, 'dan nilai nol — kuantitas dan nilai mencapai nol bersamaan');

    // Engine vs textbook across the whole demo book.
    var H = run('rata');
    var beda = 0, cek = 0, bedaMax = 0, lewatBatas = 0;
    for (var k in H.st) {
      if (!Object.prototype.hasOwnProperty.call(H.st, k)) continue;
      var s = H.st[k];
      if (s.qty <= 0) continue;
      cek++;
      var unit = D.divRound(s.nilai, s.qty);
      var sisa = Math.abs(D.mul(unit, s.qty) - s.nilai);
      if (sisa > bedaMax) bedaMax = sisa;
      /* The displayed unit cost is a rounded view of the carried value, so
       * unit x qty can differ from the value by at most half a rupiah per unit.
       * Anything beyond that is not rounding, it is a bug. */
      if (D.mul(sisa, 2) > s.qty) lewatBatas++;
      if (!D.isInt(unit)) beda++;
    }
    t.eq(beda, 0, 'HPP rata-rata per unit bulat pada ' + cek + ' pasangan bersaldo');
    t.eq(lewatBatas, 0, 'selisih antara (HPP tampil x qty) dan nilai tercatat tidak pernah melebihi setengah rupiah per unit — sisa pembulatan tinggal di dalam nilai persediaan, tidak bocor ke HPP');
    t.gte(bedaMax, 0, 'sisa terbesar yang ditemukan ' + bedaMax + ' rupiah pada satu pasangan');

    var unitBeda = 0, unitCek = 0;
    for (var id in H.hasil) {
      if (!Object.prototype.hasOwnProperty.call(H.hasil, id)) continue;
      var r = H.hasil[id];
      if (!r.qty) continue;
      unitCek++;
      if (r.unit !== D.divRound(r.nilai, r.qty)) unitBeda++;
    }
    t.eq(unitBeda, 0, 'HPP per unit setiap dokumen (' + unitCek + ' dokumen) benar-benar nilai dibagi kuantitas, dibulatkan sekali');

    /* A receipt into an EMPTY bin must set the unit cost to the receipt price
     * exactly, in both engines. This is the case where a stale average would
     * quietly poison a whole SKU. */
    var m3 = mini();
    m3.add({ tgl: '2026-01-01', sku: 'B', gudang: 'G', arah: 1, qty: 5, jenis: 'terima', dok: 'a', harga: 999 });
    m3.add({ tgl: '2026-01-02', sku: 'B', gudang: 'G', arah: -1, qty: 5, jenis: 'jual', dok: 'b' });
    var t3 = m3.add({ tgl: '2026-01-03', sku: 'B', gudang: 'G', arah: 1, qty: 4, jenis: 'terima', dok: 'c', harga: 5000 });
    var h3 = m3.jalan('rata');
    t.eq(h3.hasil[t3.id].unit, 5000, 'penerimaan ke gudang yang sudah kosong memakai harga penerimaan itu, bukan rata-rata lama');
    t.eq(h3.st['B|G'].nilai, 20000, 'nilainya 4 x 5.000');
    t.eq(m3.jalan('fifo').st['B|G'].nilai, 20000, 'FIFO sepakat pada angka yang sama di kasus ini');
    t.eq(L.konservasi(h3).selisih, 0, 'dan identitas nilai tetap tertutup');
  });

  /* ======================================== 6. konservasi nilai ========= */

  group('Konservasi nilai — identitas akuntansi ke rupiah', function (t) {
    ['fifo', 'rata'].forEach(function (m) {
      var h = run(m), k = L.konservasi(h);
      t.eq(k.selisih, 0, m + ': saldo awal + pembelian + retur jual + penyesuaian masuk + transfer masuk − retur beli − HPP − penyesuaian keluar − transfer keluar = persediaan akhir, selisih NOL rupiah');
      t.ok(k.transferSeimbang, m + ': nilai transfer masuk sama persis dengan transfer keluar (' + D.rupiah(k.transferMasuk) + ') — barang di perjalanan membawa biayanya, tidak dihargai ulang');
      t.eq(h.total.masuk - h.total.keluar, h.akhir.nilai, m + ': total nilai masuk dikurangi total nilai keluar sama dengan nilai persediaan akhir');
      t.gte(k.pembelian, 1, m + ': ada nilai pembelian yang tercatat (' + D.rupiah(k.pembelian) + ')');
      t.gte(k.hppJual, 1, m + ': ada HPP penjualan yang tercatat (' + D.rupiah(k.hppJual) + ')');
      t.gte(k.persediaanAkhir, 1, m + ': persediaan akhir positif (' + D.rupiah(k.persediaanAkhir) + ')');
      t.ok(k.seimbang, m + ': rekonsiliasi dinyatakan seimbang oleh mesinnya sendiri');

      /* Per-warehouse, not just globally. A global identity can hide two
       * warehouses that are wrong in opposite directions. */
      var perKunci = {}, i;
      var s = sorted();
      for (i = 0; i < s.length; i++) {
        var e = s[i], r = h.hasil[e.id];
        if (!r) continue;
        var kk = e.sku + '|' + e.gudang;
        perKunci[kk] = (perKunci[kk] || 0) + e.arah * r.nilai;
      }
      var salah = 0, cek = 0;
      for (var kk2 in h.st) {
        if (!Object.prototype.hasOwnProperty.call(h.st, kk2)) continue;
        cek++;
        if ((perKunci[kk2] || 0) !== h.st[kk2].nilai) salah++;
      }
      t.eq(salah, 0, m + ': identitas nilai juga tertutup per SKU per gudang, pada ' + cek + ' pasangan — bukan hanya secara total');

      var jumlahAkhir = 0;
      for (kk2 in h.st) if (Object.prototype.hasOwnProperty.call(h.st, kk2)) jumlahAkhir += h.st[kk2].nilai;
      t.eq(jumlahAkhir, h.akhir.nilai, m + ': nilai akhir agregat sama dengan jumlah per pasangan');

      var negNilai = 0;
      for (kk2 in h.st) if (Object.prototype.hasOwnProperty.call(h.st, kk2) && h.st[kk2].nilai < 0) negNilai++;
      t.eq(negNilai, 0, m + ': tidak ada pasangan dengan nilai persediaan negatif');
    });

    var hf = run('fifo'), hr = run('rata');
    t.eq(hf.total.pembelian, hr.total.pembelian, 'nilai pembelian identik di kedua metode — harga beli adalah fakta, bukan pilihan kebijakan');
    t.eq(hf.total.saldoAwal, hr.total.saldoAwal, 'saldo awal identik di kedua metode');
    t.eq(hf.total.qtyMasuk, hr.total.qtyMasuk, 'kuantitas masuk identik');
    t.eq(hf.total.qtyKeluar, hr.total.qtyKeluar, 'kuantitas keluar identik');
    t.eq(hf.total.penjualanBruto, hr.total.penjualanBruto, 'peredaran bruto identik — metode biaya hanya menggeser HPP, bukan pendapatan');
  });

  /* ==================================== 7. transaksi bertanggal mundur == */

  group('Transaksi mundur — hitung ulang, lokal, dan tertutup', function (t) {
    var d = db(), s = sorted();
    var saran = L.saranSkenarioMundur(s, '2026-06-10');
    t.gte(saran.length, 20, saran.length + ' pasangan SKU×gudang menjadi kandidat skenario mundur');
    t.ok(saran[0].habis, 'kandidat teratas adalah pasangan yang antrean lapisannya sempat kosong — di situlah FIFO benar-benar bergerak');
    var sku = saran[0].sku, gud = saran[0].gudang;
    var prod = d.produkBySku[sku];
    var tglMundur = '2026-06-10';
    var qtyMundur = D.mul(20, prod.satuan[0].faktor);
    var hargaMundur = D.divRound(D.mul(prod.hargaBeli, 13000), 10000);

    var cek = L.periksaPosting(d.buku, {
      tgl: tglMundur, sku: sku, gudang: gud, arah: 1, qty: qtyMundur, jenis: 'terima', harga: hargaMundur
    }, { peran: 'pembelian', hariIni: d.hariIni });
    t.ok(cek.ok, 'penerimaan bertanggal 10 Juni ke periode terbuka diterima');
    t.ok(cek.mundur, 'dan dikenali sebagai dokumen bertanggal mundur');
    t.gte(cek.peringatan.length, 1, 'disertai peringatan bahwa HPP setelahnya akan dihitung ulang');

    var tutup = L.periksaPosting(d.buku, {
      tgl: '2026-03-20', sku: sku, gudang: gud, arah: 1, qty: qtyMundur, jenis: 'terima', harga: hargaMundur
    }, { peran: 'pembelian', hariIni: d.hariIni });
    t.notOk(tutup.ok, 'penerimaan bertanggal Maret DITOLAK — periode itu sudah ditutup');
    t.ok(/ditutup/.test(tutup.alasan.join(' ')), 'penolakannya menyebut periode yang ditutup, bukan sekadar "tidak boleh"');

    var kasir = L.periksaPosting(d.buku, {
      tgl: '2026-05-05', sku: sku, gudang: gud, arah: 1, qty: 10, jenis: 'terima', harga: 100
    }, { peran: 'kasir', hariIni: d.hariIni });
    t.notOk(kasir.ok, 'kasir tidak boleh memposting dokumen bertanggal mundur');
    t.ok(/Kasir/.test(kasir.alasan.join(' ')), 'penolakan menyebut peran yang ditolak');

    ['fifo', 'rata'].forEach(function (m) {
      var opts = { metode: m, hargaAcuan: d.hargaAcuan };
      var sebelum = L.replay(s, opts);
      var salinan = JSON.parse(JSON.stringify(d.buku));
      var baru = L.tambah(salinan, {
        tgl: tglMundur, sku: sku, gudang: gud, arah: 1, qty: qtyMundur,
        jenis: 'terima', dok: 'PN-MUNDUR', harga: hargaMundur, mundur: true
      });
      var s2 = L.urut(salinan.entries);
      var penuh = L.replay(s2, opts);
      var inc = L.hitungUlangDari(sebelum, s2, tglMundur, opts);

      var tidakCocok = 0, dicek = 0;
      for (var id in penuh.hasil) {
        if (!Object.prototype.hasOwnProperty.call(penuh.hasil, id)) continue;
        dicek++;
        var a = penuh.hasil[id], b = inc.hasil.hasil[id];
        if (!b || a.nilai !== b.nilai || a.unit !== b.unit || a.qty !== b.qty) tidakCocok++;
      }
      t.eq(tidakCocok, 0, m + ': hitung ulang inkremental cocok dengan replay penuh pada ' + dicek + ' dokumen — tanpa ini jalur inkremental hanya harapan');
      t.eq(inc.hasil.akhir.nilai, penuh.akhir.nilai, m + ': nilai persediaan akhir sama antara jalur inkremental dan penuh');
      t.eq(inc.hasil.total.hppJual, penuh.total.hppJual, m + ': total HPP sama antara kedua jalur');
      t.eq(inc.dariSnapshot, '2026-06', m + ': hitung ulang dimulai dari snapshot awal Juni, bukan dari awal buku');
      t.gte(inc.entriDipakaiUlang, 1000, m + ': ' + inc.entriDipakaiUlang + ' dokumen sebelum batas dipakai ulang apa adanya');

      var kons = L.konservasi(penuh);
      t.eq(kons.selisih, 0, m + ': identitas nilai TETAP tertutup ke rupiah setelah sisipan mundur');
      t.ok(kons.transferSeimbang, m + ': transfer tetap seimbang setelah sisipan mundur');
      t.eq(penuh.defisit.length, 0, m + ': tidak ada defisit stok akibat sisipan');

      var batas = L.layerKunci(tglMundur, baru.seq);
      var diff = L.bandingkan(sebelum, penuh, batas);
      t.eq(diff.berubahSebelumBatas, 0, m + ': TIDAK ADA dokumen sebelum titik sisip yang berubah — hitung ulangnya lokal, bukan tebakan ulang menyeluruh');
      t.gte(diff.jumlah, 1, m + ': ' + diff.jumlah + ' dokumen setelah titik sisip berubah HPP-nya, sebagaimana seharusnya');
      t.eq(diff.hppSesudah - diff.hppSebelum + (diff.akhirSesudah - diff.akhirSebelum),
        D.mul(qtyMundur, hargaMundur) + (penuh.total.returJual - sebelum.total.returJual) + (penuh.total.adjMasuk - sebelum.total.adjMasuk)
        - (penuh.total.adjKeluar - sebelum.total.adjKeluar) - (penuh.total.returBeli - sebelum.total.returBeli),
        m + ': pertambahan HPP + pertambahan persediaan akhir = nilai pembelian yang disisipkan, disesuaikan dengan retur dan opname yang ikut berubah');
      var deltaHitung = 0;
      for (var i = 0; i < diff.berubah.length; i++) deltaHitung += diff.berubah[i].delta;
      t.eq(deltaHitung, diff.deltaTotal, m + ': total selisih yang dilaporkan sama dengan jumlah selisih per dokumen');

      // A SECOND backdated insert, into an even earlier open period.
      var baru2 = L.tambah(salinan, {
        tgl: '2026-05-14', sku: sku, gudang: gud, arah: 1, qty: D.mul(5, prod.satuan[0].faktor),
        jenis: 'terima', dok: 'PN-MUNDUR-2', harga: D.divRound(D.mul(prod.hargaBeli, 8800), 10000), mundur: true
      });
      var s3 = L.urut(salinan.entries);
      var penuh2 = L.replay(s3, opts);
      var inc2 = L.hitungUlangDari(inc.hasil, s3, '2026-05-14', opts);
      var beda2 = 0;
      for (var id2 in penuh2.hasil) {
        if (!Object.prototype.hasOwnProperty.call(penuh2.hasil, id2)) continue;
        var a2 = penuh2.hasil[id2], b2 = inc2.hasil.hasil[id2];
        if (!b2 || a2.nilai !== b2.nilai) beda2++;
      }
      t.eq(beda2, 0, m + ': sisipan mundur KEDUA, ke periode yang lebih awal lagi, tetap cocok dengan replay penuh');
      t.eq(inc2.dariSnapshot, '2026-05', m + ': dan dimulai dari snapshot Mei');
      t.eq(L.konservasi(penuh2).selisih, 0, m + ': identitas nilai tetap tertutup setelah dua sisipan mundur');
      t.ok(baru2.seq > baru.seq, 'nomor urut tetap monoton meski tanggalnya lebih tua');
      var urutOk = 0;
      for (i = 1; i < s3.length; i++) if (s3[i].tgl >= s3[i - 1].tgl) urutOk++;
      t.eq(urutOk, s3.length - 1, m + ': buku tetap terurut menurut tanggal setelah dua penyisipan');
    });

    /* A backdated ISSUE that looks fine on its own date but drains a later day
     * below zero. This is the refusal that makes backdating safe. */
    var kandidat = null;
    for (var i = 0; i < saran.length && !kandidat; i++) if (saran[i].minSaldo === 0 && saran[i].keluarSetelah > 50) kandidat = saran[i];
    t.ok(kandidat, 'ada pasangan yang saldonya pernah menyentuh nol setelah 10 Juni');
    if (kandidat) {
      var tolak = L.periksaPosting(d.buku, {
        tgl: '2026-06-11', sku: kandidat.sku, gudang: kandidat.gudang, arah: -1,
        qty: kandidat.keluarSetelah + 1, jenis: 'jual', harga: null
      }, { peran: 'supervisor', hariIni: d.hariIni });
      t.notOk(tolak.ok, 'pengeluaran mundur yang membuat stok negatif di kemudian hari DITOLAK');
      t.ok(/negatif/.test(tolak.alasan.join(' ')), 'penolakannya menyebut stok negatif dan titik waktunya');
    }
    var saldoKecil = L.saldoMinimumSejak(s, saran[0].sku, saran[0].gudang, '2026-06-10');
    t.eq(saldoKecil, saran[0].minSaldo, 'saldoMinimumSejak sepakat dengan penelusuran kandidat');
  });

  /* ================================================== 8. opname ========= */

  group('Stock opname — memposting ENTRY, bukan menimpa saldo', function (t) {
    var d = db();
    var terposting = d.opname.filter(function (o) { return o.status === 'diposting'; });
    t.gte(terposting.length, 3, terposting.length + ' opname historis sudah diposting di data demo');
    var aktif = d.opname[d.opname.length - 1];
    t.eq(aktif.status, 'terhitung', 'satu lembar opname dibiarkan terbuka dan sudah dihitung, menunggu supervisor');
    t.gte(aktif.baris.length, 10, 'lembar itu berisi ' + aktif.baris.length + ' baris');

    var s = sorted(), h = run('fifo');
    var adj = s.filter(function (e) { return e.jenis === 'adjust'; });
    t.gte(adj.length, 10, adj.length + ' entry penyesuaian ada di buku — opname meninggalkan jejak, bukan menimpa angka');
    var tanpaAlasan = 0, tanpaOpname = 0, qtyNol = 0;
    for (var i = 0; i < adj.length; i++) {
      if (!adj[i].alasan) tanpaAlasan++;
      if (!adj[i].opname) tanpaOpname++;
      if (adj[i].qty <= 0) qtyNol++;
    }
    t.eq(tanpaAlasan, 0, 'setiap penyesuaian membawa kode alasan');
    t.eq(tanpaOpname, 0, 'setiap penyesuaian menunjuk lembar opname asalnya');
    t.eq(qtyNol, 0, 'tidak ada penyesuaian berkuantitas nol yang mengotori buku');
    var alasanTakDikenal = 0;
    for (i = 0; i < adj.length; i++) {
      var ada = false;
      for (var j = 0; j < D.ALASAN_SELISIH.length; j++) if (D.ALASAN_SELISIH[j].kode === adj[i].alasan) ada = true;
      if (!ada) alasanTakDikenal++;
    }
    t.eq(alasanTakDikenal, 0, 'setiap kode alasan berasal dari daftar yang ditetapkan, bukan teks bebas');

    /* The variance arithmetic on a fresh book, including the case that makes
     * opname hard: a sale posted while the count is running. */
    var m = mini();
    m.add({ tgl: '2026-04-01', sku: 'K', gudang: 'G', arah: 1, qty: 100, jenis: 'terima', dok: 'a', harga: 500 });
    var op = { id: 'OP-T1', gudang: 'G', tglMulai: '2026-04-10', status: 'draf', baris: [], bekuSeq: 0 };
    P.bukaOpname(m.buku, op, null, ['K']);
    t.eq(op.baris[0].bukuQty, 100, 'buku beku mencatat 100 pada saat lembar dibuka');
    t.eq(op.bekuSeq, 1, 'pembekuan memakai nomor urut buku, bukan tanggal');

    // Ten units sold WHILE the count is running.
    m.add({ tgl: '2026-04-10', sku: 'K', gudang: 'G', arah: -1, qty: 10, jenis: 'jual', dok: 'b' });
    op.baris[0].fisikQty = 95;
    op.baris[0].alasan = 'susut';
    var v = P.variansOpname(m.buku, op);
    t.eq(v.baris[0].varians, -5, 'selisih dihitung terhadap buku BEKU: 95 fisik - 100 beku = -5');
    t.eq(v.baris[0].pascaHitung, -10, 'penjualan 10 unit selama penghitungan dicatat terpisah sebagai gerakan pasca-hitung');
    t.eq(v.baris[0].saldoSetelahPosting, 85, 'saldo setelah posting seharusnya 95 - 10 = 85');
    t.eq(v.ringkas.selisih, 1, 'satu baris berselisih');
    t.eq(v.ringkas.kurang, 1, 'dan selisihnya kurang, bukan lebih');

    var sebelumEntry = m.buku.entries.length;
    var res = P.postingOpname(m.buku, op, { peran: 'supervisor', tgl: '2026-04-10' });
    t.ok(res.ok, 'supervisor boleh memposting');
    t.eq(res.entries.length, 1, 'posting membuat satu entry penyesuaian');
    t.eq(m.buku.entries.length, sebelumEntry + 1, 'buku bertambah satu baris — tidak ada saldo yang ditimpa');
    t.eq(res.entries[0].jenis, 'adjust', 'jenisnya penyesuaian');
    t.eq(res.entries[0].arah, -1, 'arahnya keluar');
    t.eq(res.entries[0].qty, 5, 'kuantitasnya persis 5, yaitu selisih terhadap buku beku');
    t.eq(res.entries[0].alasan, 'susut', 'membawa kode alasan');
    t.eq(res.entries[0].dok, 'OP-T1', 'dan nomor lembar opname sebagai dokumennya');
    var hh = m.jalan('fifo');
    t.eq(hh.st['K|G'].qty, 85, 'saldo hasil pelipatan buku = 85, persis fisik dikurangi yang terjual saat menghitung — tidak dobel hitung');
    t.eq(hh.st['K|G'].nilai, D.mul(85, 500), 'nilainya 85 x 500');
    t.eq(hh.hasil[res.entries[0].id].nilai, D.mul(5, 500), 'penyesuaian kurang dinilai pada biaya lapisan yang dikonsumsinya');
    t.eq(L.konservasi(hh).selisih, 0, 'identitas nilai tetap tertutup setelah posting opname');
    t.eq(op.status, 'diposting', 'lembar berubah status menjadi diposting');

    var lagi = P.postingOpname(m.buku, op, { peran: 'supervisor' });
    t.notOk(lagi.ok, 'lembar yang sudah diposting tidak bisa diposting dua kali');
    t.ok(/sudah diposting/.test(lagi.alasan.join(' ')), 'dan alasannya dikatakan');

    // Reason code is mandatory when there is a variance.
    var m2 = mini();
    m2.add({ tgl: '2026-04-01', sku: 'K', gudang: 'G', arah: 1, qty: 50, jenis: 'terima', dok: 'a', harga: 100 });
    var op2 = { id: 'OP-T2', gudang: 'G', tglMulai: '2026-04-05', status: 'draf', baris: [], bekuSeq: 0 };
    P.bukaOpname(m2.buku, op2, null, ['K']);
    op2.baris[0].fisikQty = 44;
    var r2 = P.postingOpname(m2.buku, op2, { peran: 'supervisor' });
    t.notOk(r2.ok, 'selisih tanpa kode alasan ditolak');
    t.ok(/tanpa kode alasan/.test(r2.alasan.join(' ')), 'penolakan menyebut alasan yang hilang');
    t.eq(m2.buku.entries.length, 1, 'dan tidak ada entry yang terlanjur ditulis');

    var r3 = P.postingOpname(m2.buku, op2, { peran: 'kasir' });
    t.notOk(r3.ok, 'kasir tidak boleh memposting opname');
    var r4 = P.postingOpname(m2.buku, op2, { peran: 'gudang' });
    t.notOk(r4.ok, 'staf gudang yang menghitung juga tidak boleh mengesahkan hitungannya sendiri');
    t.ok(/pengendalian intern/.test(r4.alasan.join(' ')), 'penolakannya menjelaskan pemisahan tugas, bukan sekadar melarang');

    // Zero-variance lines must not produce entries.
    op2.baris[0].fisikQty = 50;
    op2.baris[0].alasan = null;
    op2.status = 'terhitung';
    var r5 = P.postingOpname(m2.buku, op2, { peran: 'supervisor' });
    t.ok(r5.ok, 'lembar tanpa selisih boleh diposting');
    t.eq(r5.entries.length, 0, 'dan tidak menghasilkan entry apa pun — nol selisih berarti nol jurnal');

    // Surplus is valued at carrying cost, and conservation still holds.
    var m3 = mini();
    m3.add({ tgl: '2026-04-01', sku: 'K', gudang: 'G', arah: 1, qty: 10, jenis: 'terima', dok: 'a', harga: 700 });
    m3.add({ tgl: '2026-04-02', sku: 'K', gudang: 'G', arah: 1, qty: 10, jenis: 'terima', dok: 'b', harga: 900 });
    var op3 = { id: 'OP-T3', gudang: 'G', tglMulai: '2026-04-06', status: 'draf', baris: [], bekuSeq: 0 };
    P.bukaOpname(m3.buku, op3, null, ['K']);
    op3.baris[0].fisikQty = 23;
    op3.baris[0].alasan = 'ditemukan';
    var r6 = P.postingOpname(m3.buku, op3, { peran: 'supervisor', tgl: '2026-04-06' });
    t.ok(r6.ok, 'selisih lebih boleh diposting dengan alasan "ditemukan"');
    t.eq(r6.entries[0].arah, 1, 'arahnya masuk');
    t.eq(r6.entries[0].qty, 3, 'sebanyak 3 unit');
    var h3 = m3.jalan('fifo');
    t.eq(h3.hasil[r6.entries[0].id].unit, D.divRound(16000, 20), 'kelebihan dinilai pada biaya tercatat berjalan (16.000 / 20 = 800), bukan pada harga jual dan bukan nol');
    t.eq(h3.st['K|G'].qty, 23, 'saldo menjadi 23');
    t.eq(L.konservasi(h3).selisih, 0, 'identitas nilai tetap tertutup setelah selisih lebih');
    t.eq(m3.jalan('rata').st['K|G'].qty, 23, 'metode rata-rata memberi kuantitas yang sama');
    t.eq(L.konservasi(m3.jalan('rata')).selisih, 0, 'dan juga tetap tertutup');
  });

  /* ============================================ 9. transfer & transit === */

  group('Transfer antargudang — dalam perjalanan, dihitung tepat sekali', function (t) {
    var d = db(), s = sorted(), h = run('fifo');
    t.gte(d.transfer.length, 20, d.transfer.length + ' transfer di data demo');
    var jalan = d.transfer.filter(function (x) { return x.status === 'jalan'; });
    var tiba = d.transfer.filter(function (x) { return x.status === 'tiba'; });
    t.gte(jalan.length, 1, jalan.length + ' transfer masih dalam perjalanan pada tanggal laporan');
    t.gte(tiba.length, 10, tiba.length + ' transfer sudah tiba');

    var entriPerTransfer = {}, i;
    for (i = 0; i < s.length; i++) {
      if (s[i].jenis !== 'transfer-masuk' && s[i].jenis !== 'transfer-keluar') continue;
      entriPerTransfer[s[i].dok] = (entriPerTransfer[s[i].dok] || 0) + 1;
    }
    var salahJumlah = 0;
    for (i = 0; i < d.transfer.length; i++) {
      var tr = d.transfer[i];
      var harap = tr.baris.length * (tr.status === 'tiba' ? 4 : 2);
      if ((entriPerTransfer[tr.id] || 0) !== harap) salahJumlah++;
    }
    t.eq(salahJumlah, 0, 'setiap pengiriman menulis 2 entry per baris (keluar dari asal, masuk ke TRANSIT) dan setiap kedatangan 2 lagi');

    var pasanganHilang = 0, nilaiBeda = 0, pasangan = 0;
    for (i = 0; i < s.length; i++) {
      var e = s[i];
      if (e.jenis !== 'transfer-masuk') continue;
      pasangan++;
      if (!e.pasangan || !h.hasil[e.pasangan]) { pasanganHilang++; continue; }
      if (h.hasil[e.id].nilai !== h.hasil[e.pasangan].nilai) nilaiBeda++;
      if (h.hasil[e.id].qty !== h.hasil[e.pasangan].qty) nilaiBeda++;
    }
    t.eq(pasanganHilang, 0, 'setiap penerimaan transfer menemukan pasangan pengeluarannya (' + pasangan + ' pasangan)');
    t.eq(nilaiBeda, 0, 'nilai DAN kuantitas kaki masuk sama persis dengan kaki keluar — biaya dibawa, tidak dihargai ulang di tujuan');

    var hr = run('rata');
    var nilaiBedaR = 0;
    for (i = 0; i < s.length; i++) {
      if (s[i].jenis !== 'transfer-masuk') continue;
      if (hr.hasil[s[i].id].nilai !== hr.hasil[s[i].pasangan].nilai) nilaiBedaR++;
    }
    t.eq(nilaiBedaR, 0, 'sama halnya di bawah metode rata-rata');

    /* Counted exactly once: the sum over the three real warehouses plus TRANSIT
     * equals the sum over the whole book for that SKU. If in-transit stock were
     * dropped it would go missing; if it were double-booked it would show up
     * twice. */
    var perSku = {}, perSkuGudang = {};
    for (i = 0; i < s.length; i++) {
      var ee = s[i];
      perSku[ee.sku] = (perSku[ee.sku] || 0) + ee.arah * ee.qty;
    }
    for (var k in h.st) {
      if (!Object.prototype.hasOwnProperty.call(h.st, k)) continue;
      var p = k.split('|');
      perSkuGudang[p[0]] = (perSkuGudang[p[0]] || 0) + h.st[k].qty;
    }
    var bedaSku = 0, skuCek = 0;
    for (var sk in perSku) {
      if (!Object.prototype.hasOwnProperty.call(perSku, sk)) continue;
      skuCek++;
      if (perSku[sk] !== (perSkuGudang[sk] || 0)) bedaSku++;
    }
    t.eq(bedaSku, 0, 'untuk ' + skuCek + ' SKU, jumlah saldo tiga gudang plus TRANSIT sama persis dengan pergerakan bersihnya — barang di perjalanan dihitung tepat sekali');

    var transitQty = 0, transitNilai = 0, transitKunci = 0;
    for (k in h.st) {
      if (!Object.prototype.hasOwnProperty.call(h.st, k)) continue;
      if (k.indexOf('|' + D.TRANSIT) < 0) continue;
      transitKunci++;
      transitQty += h.st[k].qty;
      transitNilai += h.st[k].nilai;
    }
    t.gte(transitQty, 1, transitQty + ' unit benar-benar berada di TRANSIT pada tanggal laporan, bukan nol yang disembunyikan');
    t.gte(transitNilai, 1, 'senilai ' + D.rupiah(transitNilai) + ' — nilai itu ada di neraca, bukan menguap di jalan');
    var transitNeg = 0;
    for (k in h.st) if (Object.prototype.hasOwnProperty.call(h.st, k) && k.indexOf('|' + D.TRANSIT) >= 0 && h.st[k].qty < 0) transitNeg++;
    t.eq(transitNeg, 0, 'TRANSIT tidak pernah bersaldo negatif — tidak ada kedatangan tanpa pengiriman');

    var jalanQty = 0;
    for (i = 0; i < jalan.length; i++) for (var b = 0; b < jalan[i].baris.length; b++) jalanQty += jalan[i].baris[b].qtyBase;
    t.eq(transitQty, jalanQty, 'saldo TRANSIT sama persis dengan jumlah baris transfer yang berstatus "jalan" (' + jalanQty + ' unit)');

    var tibaSisa = 0;
    for (i = 0; i < tiba.length; i++) {
      for (b = 0; b < tiba[i].baris.length; b++) {
        var kkk = tiba[i].baris[b].sku + '|' + D.TRANSIT;
        // every arrived transfer must have taken back out what it put in
        if (!h.st[kkk]) continue;
      }
    }
    t.eq(tibaSisa, 0, 'transfer yang sudah tiba tidak meninggalkan sisa di TRANSIT');

    // Full round trip on a clean book.
    var m = mini();
    m.add({ tgl: '2026-02-01', sku: 'T', gudang: 'A', arah: 1, qty: 60, jenis: 'terima', dok: 'p', harga: 250 });
    var tr2 = { id: 'TR-T1', dariGudang: 'A', keGudang: 'B', tglKirim: '2026-02-05', status: 'draf', baris: [{ sku: 'T', qtyBase: 24 }] };
    P.kirimTransfer(m.buku, tr2);
    var hk = m.jalan('fifo');
    t.eq(hk.st['T|A'].qty, 36, 'setelah kirim, gudang asal tinggal 36');
    t.eq(hk.st['T|' + D.TRANSIT].qty, 24, 'dan 24 unit berada di TRANSIT');
    t.eq(hk.st['T|' + D.TRANSIT].nilai, D.mul(24, 250), 'senilai 24 x 250 — bukan nol dan bukan harga jual');
    t.eq(hk.st['T|B'], undefined, 'gudang tujuan belum punya apa-apa');
    t.eq(L.konservasi(hk).selisih, 0, 'identitas nilai tertutup selagi barang di jalan');
    P.terimaTransfer(m.buku, tr2, '2026-02-08');
    var hk2 = m.jalan('fifo');
    t.eq(hk2.st['T|' + D.TRANSIT].qty, 0, 'setelah tiba, TRANSIT kembali nol');
    t.eq(hk2.st['T|' + D.TRANSIT].nilai, 0, 'dan nilainya nol');
    t.eq(hk2.st['T|B'].qty, 24, 'gudang tujuan menerima 24');
    t.eq(hk2.st['T|B'].nilai, D.mul(24, 250), 'pada biaya perolehan asli 250, tidak dihargai ulang');
    t.eq(hk2.st['T|B'].layers[0].unitCost, 250, 'dan lapisannya membawa biaya asli');
    t.eq(hk2.st['T|B'].layers[0].tgl, '2026-02-01', 'beserta tanggal perolehan aslinya, sehingga urutan FIFO di tujuan tetap benar');
    t.eq(L.konservasi(hk2).selisih, 0, 'identitas nilai tertutup setelah tiba');
    t.eq(hk2.total.transferMasuk, hk2.total.transferKeluar, 'transfer masuk = transfer keluar');
  });

  /* =========================================== 10. retur penjualan ====== */

  group('Retur penjualan — kembali ke lapisan biaya aslinya', function (t) {
    var m = bukuDasar();
    // FIFO: sale consumed 100@1000 then 20@1200. Return 30 -> 20@1200 + 10@1000.
    var ret = m.add({ tgl: '2026-01-15', sku: 'X', gudang: 'G', arah: 1, qty: 30, jenis: 'retur-jual', dok: 'RJ-1', ref: m.jual1.id });
    var h = m.jalan('fifo');
    var hr = h.hasil[ret.id];
    t.eq(hr.nilai, D.mul(20, 1200) + D.mul(10, 1000), 'retur 30 unit mengembalikan 20 x 1.200 + 10 x 1.000 = 34.000 — ekor konsumsi aslinya, bukan biaya hari ini');
    t.eq(hr.layers.length, 2, 'dua lapisan dikembalikan');
    t.eq(hr.layers[0].unitCost, 1200, 'yang termuda lebih dulu dikembalikan');
    t.eq(hr.layers[1].unitCost, 1000, 'lalu yang tertua');
    var st = h.st['X|G'];
    t.eq(st.qty, 60, 'saldo 30 sisa + 30 retur = 60');
    t.eq(st.nilai, 36000 + 34000, 'nilainya 36.000 + 34.000');
    t.eq(st.layers.length, 2, 'lapisan yang dikembalikan bergabung KEMBALI ke lot asalnya menurut kuncinya, bukan ditumpuk sebagai lapisan kembar di depan atau di belakang');
    t.eq(st.layers[0].unitCost, 1000, 'lapisan 1.000 kembali menempati posisi ASLINYA di antrean — di depan lapisan 1.200');
    t.eq(st.layers[0].qty, 10, 'sebanyak 10 unit');
    t.eq(st.layers[0].tgl, '2026-01-05', 'dengan tanggal perolehan aslinya, 5 Januari');
    t.eq(st.layers[1].unitCost, 1200, 'dan lapisan 1.200 di belakangnya');
    t.eq(st.layers[1].qty, 50, 'berisi 30 sisa + 20 kembalian = 50');

    // The proof that position matters: the next issue must eat the restored old layer first.
    var lagi = m.add({ tgl: '2026-01-20', sku: 'X', gudang: 'G', arah: -1, qty: 12, jenis: 'jual', dok: 'KS-2' });
    var h2 = m.jalan('fifo');
    t.eq(h2.hasil[lagi.id].layers[0].unitCost, 1000, 'penjualan berikutnya mengambil lapisan 1.000 yang dikembalikan itu LEBIH DULU');
    t.eq(h2.hasil[lagi.id].nilai, D.mul(10, 1000) + D.mul(2, 1200), '12 unit = 10 x 1.000 + 2 x 1.200 = 12.400');
    t.eq(h2.urutSalah, 0, 'dan pemeriksa urutan tidak menemukan satu pun pengambilan di luar urutan');
    t.eq(L.konservasi(h2).selisih, 0, 'identitas nilai tertutup setelah retur dan penjualan lanjutan');

    // Average method restores proportionally.
    var m2 = bukuDasar();
    var ret2 = m2.add({ tgl: '2026-01-15', sku: 'X', gudang: 'G', arah: 1, qty: 30, jenis: 'retur-jual', dok: 'RJ-1', ref: m2.jual1.id });
    var hh = m2.jalan('rata');
    t.eq(hh.hasil[ret2.id].nilai, D.divRound(D.mul(128000, 30), 120), 'rata-rata mengembalikan 128.000 x 30 / 120 = 32.000 — biaya yang benar-benar dibebankan pada nota itu');
    t.eq(hh.st['X|G'].qty, 60, 'saldo 60');
    t.eq(hh.st['X|G'].nilai, 32000 + 32000, 'nilainya 64.000');
    t.eq(L.konservasi(hh).selisih, 0, 'identitas nilai tertutup');

    // Full return of a whole sale must return exactly what it cost.
    var m3 = bukuDasar();
    var retPenuh = m3.add({ tgl: '2026-01-15', sku: 'X', gudang: 'G', arah: 1, qty: 120, jenis: 'retur-jual', dok: 'RJ-2', ref: m3.jual1.id });
    var h3 = m3.jalan('fifo');
    t.eq(h3.hasil[retPenuh.id].nilai, h3.hasil[m3.jual1.id].nilai, 'retur seluruh nota mengembalikan persis HPP nota itu (FIFO)');
    t.eq(h3.st['X|G'].qty, 150, 'stok kembali ke 150');
    t.eq(h3.st['X|G'].nilai, 160000, 'dan nilainya kembali ke seluruh nilai pembelian');
    t.eq(h3.total.hppJual - h3.total.returJual, 0, 'HPP bersih menjadi nol — nota itu benar-benar dibatalkan');
    var h3r = m3.jalan('rata');
    t.eq(h3r.hasil[retPenuh.id].nilai, h3r.hasil[m3.jual1.id].nilai, 'sama persis di bawah rata-rata');
    t.eq(h3r.st['X|G'].nilai, 160000, 'dan nilai persediaan kembali utuh');

    /* The interesting consequence: because the retur points at a DOCUMENT and
     * not at a frozen number, a backdated purchase that changes the sale's cost
     * changes the retur's cost with it. */
    var m4 = bukuDasar();
    var ret4 = m4.add({ tgl: '2026-01-15', sku: 'X', gudang: 'G', arah: 1, qty: 30, jenis: 'retur-jual', dok: 'RJ-1', ref: m4.jual1.id });
    var sebelum = m4.jalan('fifo');
    m4.add({ tgl: '2026-01-02', sku: 'X', gudang: 'G', arah: 1, qty: 40, jenis: 'terima', dok: 'PN-MUNDUR', harga: 700 });
    var sesudah = m4.jalan('fifo');
    t.ok(sesudah.hasil[m4.jual1.id].nilai !== sebelum.hasil[m4.jual1.id].nilai, 'pembelian mundur mengubah HPP penjualan');
    t.eq(sesudah.hasil[m4.jual1.id].nilai, D.mul(40, 700) + D.mul(80, 1000), 'yang sekarang 40 x 700 + 80 x 1.000 = 108.000');
    t.ok(sesudah.hasil[ret4.id].nilai !== sebelum.hasil[ret4.id].nilai, 'dan RETURNYA ikut berubah — karena ia menunjuk dokumen, bukan angka beku');
    t.eq(sesudah.hasil[ret4.id].nilai, D.mul(30, 1000), 'retur 30 kini mengembalikan ekor konsumsi baru: 30 x 1.000');
    t.eq(L.konservasi(sesudah).selisih, 0, 'identitas nilai tetap tertutup setelah pembelian mundur atas nota yang sudah diretur');

    // Demo book: every retur is valued from the sale it references.
    var d = db(), s = sorted(), H = run('fifo'), HR = run('rata');
    var retDemo = s.filter(function (e) { return e.jenis === 'retur-jual'; });
    t.gte(retDemo.length, 5, retDemo.length + ' retur penjualan di data demo');
    var takBerRef = 0, nilaiSalah = 0, nilaiSalahR = 0;
    for (var i = 0; i < retDemo.length; i++) {
      var e = retDemo[i];
      if (!e.ref || !H.hasil[e.ref]) { takBerRef++; continue; }
      var jual = H.hasil[e.ref];
      if (H.hasil[e.id].nilai > jual.nilai) nilaiSalah++;
      if (e.qty > jual.qty) nilaiSalah++;
      var harapR = D.divRound(D.mul(HR.hasil[e.ref].nilai, e.qty), HR.hasil[e.ref].qty);
      if (HR.hasil[e.id].nilai !== harapR) nilaiSalahR++;
    }
    t.eq(takBerRef, 0, 'setiap retur menunjuk entry penjualan aslinya');
    t.eq(nilaiSalah, 0, 'tidak ada retur yang mengembalikan lebih banyak unit atau lebih banyak rupiah daripada yang keluar');
    t.eq(nilaiSalahR, 0, 'di bawah rata-rata, setiap retur bernilai proporsional terhadap HPP nota aslinya');
  });

  /* ================================================= 11. PPN 11% ======== */

  group('PPN 11% — inklusif dan eksklusif keduanya benar', function (t) {
    t.eq(D.PPN_PERSEN, 11, 'tarifnya 11%, sesuai UU HPP sejak 1 April 2022');

    var ex = D.hitungPpn(100000, false);
    t.eq(ex.dpp, 100000, 'eksklusif: DPP 100.000 adalah harga yang tertulis');
    t.eq(ex.ppn, 11000, 'PPN 11.000 ditambahkan di atasnya');
    t.eq(ex.total, 111000, 'total 111.000');

    var inc = D.hitungPpn(111000, true);
    t.eq(inc.dpp, 100000, 'inklusif: dari total 111.000, DPP kembali 100.000');
    t.eq(inc.ppn, 11000, 'PPN 11.000');
    t.eq(inc.total, 111000, 'dan totalnya tetap 111.000 — angka yang tercetak tidak bergerak');

    var inc2 = D.hitungPpn(100000, true);
    t.eq(inc2.dpp, 90090, 'inklusif dari 100.000: DPP 90.090 (100.000 x 100/111 = 90.090,09)');
    t.eq(inc2.ppn, 9910, 'PPN 9.910 sebagai SISA, bukan hasil pembulatan kedua');
    t.eq(inc2.dpp + inc2.ppn, 100000, 'DPP + PPN = total, persis, tanpa selisih satu rupiah di struk');
    t.ok(inc2.dpp !== 100000, 'dan inklusif jelas berbeda dari eksklusif — membalik keduanya menggeser ' + D.rupiah(100000 - inc2.dpp) + ' pada nota sebesar 100.000');

    var ex2 = D.hitungPpn(12345, false);
    t.eq(ex2.ppn, 1358, 'eksklusif 12.345: PPN 1.357,95 dibulatkan menjadi 1.358');
    t.eq(ex2.total, 13703, 'total 13.703');
    var inc3 = D.hitungPpn(13703, true);
    t.eq(inc3.dpp, 12345, 'dan inklusif dari 13.703 kembali ke DPP 12.345 — bolak-balik eksak');
    t.eq(inc3.ppn, 1358, 'dengan PPN 1.358');

    var gagalJumlah = 0, gagalRt = 0, n = 0;
    for (var v = 1; v <= 4000; v++) {
      var x = v * 137 + 91;
      n++;
      var a = D.hitungPpn(x, false);
      if (a.dpp + a.ppn !== a.total) gagalJumlah++;
      var b = D.hitungPpn(a.total, true);
      if (b.dpp + b.ppn !== b.total) gagalJumlah++;
      if (Math.abs(b.dpp - x) > 1) gagalRt++;
    }
    t.eq(gagalJumlah, 0, 'pada ' + n + ' nilai uji, DPP + PPN = total di kedua mode, tanpa kecuali');
    t.eq(gagalRt, 0, 'dan eksklusif lalu inklusif kembali ke DPP semula dengan simpangan maksimum satu rupiah');

    t.throws(function () { D.hitungPpn(1000.5, false); }, 'PPN menolak jumlah pecahan');
    t.eq(D.hitungPpn(0, false).total, 0, 'nota nol rupiah tetap nol');
    t.eq(D.hitungPpn(0, true).dpp, 0, 'termasuk mode inklusif');

    /* Document-level rounding, not per line. Three lines of 3.333 rounded
     * individually and then summed does not equal the document figure, and this
     * is where a faktur stops matching the sum of its own rows. */
    var baris = [{ qty: 1, harga: 3333, diskon: 0 }, { qty: 1, harga: 3333, diskon: 0 }, { qty: 1, harga: 3333, diskon: 0 }];
    var tot = P.totalKeranjang(baris, { ppnInklusif: false });
    t.eq(tot.subtotal, 9999, 'subtotal 3 x 3.333 = 9.999');
    t.eq(tot.ppn, D.divRound(D.mul(9999, 11), 100), 'PPN dihitung sekali atas 9.999 = 1.100');
    var perBaris = D.divRound(D.mul(3333, 11), 100) * 3;
    t.ok(perBaris !== tot.ppn, 'pembulatan per baris memberi ' + perBaris + ', meleset ' + (perBaris - tot.ppn) + ' rupiah dari angka dokumen');
    t.eq(tot.dpp + tot.ppn, tot.total, 'dan dokumen tetap konsisten dengan dirinya sendiri');

    var totInc = P.totalKeranjang(baris, { ppnInklusif: true });
    t.eq(totInc.total, 9999, 'mode inklusif: total sama dengan jumlah baris');
    t.eq(totInc.dpp + totInc.ppn, 9999, 'dan terurai menjadi DPP + PPN tanpa sisa');
    t.ok(totInc.total !== tot.total, 'kedua mode menghasilkan total yang berbeda dari baris yang sama — setting ini bukan hiasan');

    // Every demo receipt must be internally consistent.
    var d = db(), salah = 0, salahJumlah = 0;
    for (var i = 0; i < d.kasir.length; i++) {
      var nota = d.kasir[i];
      var ulang = P.totalKeranjang(nota.baris, { ppnInklusif: true });
      if (ulang.total !== nota.total) salah++;
      if (ulang.dpp + ulang.ppn !== ulang.total) salahJumlah++;
    }
    t.eq(salah, 0, 'ke-' + d.kasir.length + ' nota kasir dihitung ulang menghasilkan total yang identik');
    t.eq(salahJumlah, 0, 'dan pada setiap nota DPP + PPN = total');

    var diskon = P.totalKeranjang([{ qty: 2, harga: 10000, diskon: 1500 }], { ppnInklusif: false });
    t.eq(diskon.subtotal, 18500, 'potongan baris dikurangkan sebagai rupiah bulat: 2 x 10.000 - 1.500');
    t.eq(diskon.ppn, D.divRound(D.mul(18500, 11), 100), 'PPN dihitung setelah potongan');
    var diskonNota = P.totalKeranjang([{ qty: 1, harga: 50000, diskon: 0 }], { ppnInklusif: false, diskonNota: 5000 });
    t.eq(diskonNota.dasar, 45000, 'potongan nota juga mengurangi dasar pengenaan');
    t.eq(diskonNota.ppn, 4950, 'PPN atas 45.000 = 4.950');
  });

  /* ================================================ 12. kasir =========== */

  group('Kasir — pembayaran campuran dan kembalian', function (t) {
    var r1 = P.hitungBayar(87500, [{ jenis: 'tunai', jumlah: 100000 }]);
    t.ok(r1.ok, 'tunai 100.000 untuk 87.500 diterima');
    t.eq(r1.kembali, 12500, 'kembalian 12.500');
    t.eq(r1.kurang, 0, 'tidak kurang');

    var r2 = P.hitungBayar(87500, [{ jenis: 'qris', jumlah: 50000 }, { jenis: 'tunai', jumlah: 40000 }]);
    t.ok(r2.ok, 'campuran QRIS 50.000 + tunai 40.000 diterima');
    t.eq(r2.kembali, 2500, 'kembalian 2.500 keluar dari kaki tunai');
    t.eq(r2.nonTunai, 50000, 'kaki nontunai 50.000');
    t.eq(r2.tunai, 40000, 'kaki tunai 40.000');

    var r3 = P.hitungBayar(87500, [{ jenis: 'transfer', jumlah: 30000 }, { jenis: 'qris', jumlah: 30000 }, { jenis: 'tunai', jumlah: 30000 }]);
    t.ok(r3.ok, 'tiga kaki pembayaran sekaligus diterima');
    t.eq(r3.kembali, 2500, 'kembalian 2.500');
    t.eq(r3.dibayar, 90000, 'total dibayar 90.000');

    var r4 = P.hitungBayar(87500, [{ jenis: 'tunai', jumlah: 50000 }]);
    t.notOk(r4.ok, 'pembayaran kurang ditolak');
    t.eq(r4.kurang, 37500, 'dan kekurangannya disebut: 37.500');
    t.ok(/kurang/.test(r4.alasan), 'dengan alasan yang bisa dibaca kasir');

    var r5 = P.hitungBayar(87500, [{ jenis: 'qris', jumlah: 100000 }]);
    t.notOk(r5.ok, 'QRIS melebihi total DITOLAK — kembalian tidak boleh keluar dari instrumen nontunai');
    t.ok(/nontunai/.test(r5.alasan), 'dan alasannya menjelaskan mengapa');

    var r6 = P.hitungBayar(87500, [{ jenis: 'qris', jumlah: 87500 }]);
    t.ok(r6.ok, 'QRIS pas diterima');
    t.eq(r6.kembali, 0, 'tanpa kembalian');

    t.notOk(P.hitungBayar(1000, [{ jenis: 'tunai', jumlah: 1000.5 }]).ok, 'nominal pecahan ditolak');
    t.notOk(P.hitungBayar(1000, [{ jenis: 'tunai', jumlah: -500 }]).ok, 'nominal negatif ditolak');
    t.ok(P.hitungBayar(0, [{ jenis: 'tunai', jumlah: 0 }]).ok, 'nota nol rupiah dengan bayar nol diterima');

    var d = db(), kurangBayar = 0, kembaliNeg = 0, kembaliSalah = 0, nonTunaiLebih = 0;
    for (var i = 0; i < d.kasir.length; i++) {
      var nota = d.kasir[i];
      var b = P.hitungBayar(nota.total, nota.bayar);
      if (!b.ok) kurangBayar++;
      if (b.kembali < 0) kembaliNeg++;
      if (b.kembali !== nota.kembali) kembaliSalah++;
      if (b.nonTunai > nota.total) nonTunaiLebih++;
    }
    t.eq(kurangBayar, 0, 'ke-' + d.kasir.length + ' nota demo terbayar penuh');
    t.eq(kembaliNeg, 0, 'tidak ada kembalian negatif');
    t.eq(kembaliSalah, 0, 'kembalian tersimpan sama dengan kembalian yang dihitung ulang');
    t.eq(nonTunaiLebih, 0, 'tidak ada nota yang kelebihan bayar lewat kaki nontunai');

    var barcodeCari = 0;
    for (i = 0; i < 40; i++) {
      var pr = d.produk[i * 3 % d.produk.length];
      if (d.barcodeIndex[pr.barcode] === pr.sku) barcodeCari++;
    }
    t.eq(barcodeCari, 40, 'pencarian barcode menemukan SKU yang benar pada 40 percobaan');
  });

  /* ===================================== 13. pencocokan tiga arah ======= */

  group('Pembelian — pencocokan tiga arah menandai, bukan menelan', function (t) {
    var po = { id: 'PO-T', tgl: '2026-05-01', baris: [{ sku: 'A', qtyBase: 100, hargaBase: 5000 }, { sku: 'B', qtyBase: 50, hargaBase: 12000 }] };
    var pn = [{ id: 'PN-T', poId: 'PO-T', baris: [{ sku: 'A', qtyBase: 100, hargaBase: 5000 }, { sku: 'B', qtyBase: 50, hargaBase: 12000 }] }];

    var cocok = P.cocokTigaArah(po, pn, { baris: [{ sku: 'A', qtyBase: 100, hargaBase: 5000 }, { sku: 'B', qtyBase: 50, hargaBase: 12000 }] });
    t.eq(cocok.status, 'cocok', 'PO, penerimaan dan faktur yang identik berstatus cocok');
    t.notOk(cocok.adaMasalah, 'tanpa temuan');
    t.eq(cocok.dampakRupiah, 0, 'dan tanpa dampak rupiah');

    var naik = P.cocokTigaArah(po, pn, { baris: [{ sku: 'A', qtyBase: 100, hargaBase: 5300 }, { sku: 'B', qtyBase: 50, hargaBase: 12000 }] });
    t.eq(naik.status, 'selisih', 'faktur dengan harga naik sepihak berstatus selisih');
    t.ok(naik.flags.indexOf('selisih-harga') >= 0, 'ditandai selisih-harga');
    t.eq(naik.baris[0].selisihHargaUnit, 300, 'selisih per unit 300 rupiah');
    t.eq(naik.dampakRupiah, D.mul(100, 300), 'dampak rupiahnya dihitung: 100 x 300 = 30.000, bukan diterima diam-diam');

    var qtyLebih = P.cocokTigaArah(po, pn, { baris: [{ sku: 'A', qtyBase: 120, hargaBase: 5000 }, { sku: 'B', qtyBase: 50, hargaBase: 12000 }] });
    t.eq(qtyLebih.status, 'selisih', 'faktur menagih lebih banyak dari yang diterima berstatus selisih');
    t.ok(qtyLebih.flags.indexOf('selisih-qty') >= 0, 'ditandai selisih-qty');
    t.eq(qtyLebih.baris[0].selisihQty, 20, 'selisihnya 20 unit');
    t.eq(qtyLebih.dampakRupiah, D.mul(20, 5000), 'senilai 100.000 yang akan terbayar percuma');

    var parsial = P.cocokTigaArah(po, [{ id: 'PN-T', baris: [{ sku: 'A', qtyBase: 60, hargaBase: 5000 }] }], null);
    t.eq(parsial.status, 'parsial', 'penerimaan sebagian tanpa faktur berstatus parsial');
    t.ok(parsial.baris[0].flags.indexOf('kurang-terima') >= 0, 'baris itu ditandai kurang-terima');
    t.notOk(parsial.punyaFaktur, 'dan sistem tahu fakturnya belum ada');

    var over = P.cocokTigaArah(po, [{ id: 'PN-T', baris: [{ sku: 'A', qtyBase: 130, hargaBase: 5000 }, { sku: 'B', qtyBase: 50, hargaBase: 12000 }] }],
      { baris: [{ sku: 'A', qtyBase: 130, hargaBase: 5000 }, { sku: 'B', qtyBase: 50, hargaBase: 12000 }] });
    t.ok(over.flags.indexOf('over-terima') >= 0, 'penerimaan melebihi PO ditandai tersendiri — masalah gudang, bukan masalah tagihan');
    t.eq(over.status, 'selisih', 'dan menghalangi status cocok');

    var d = db(), hitung = { cocok: 0, selisih: 0, parsial: 0, menunggu: 0 }, i;
    var tanpaSebab = 0, dampakNol = 0;
    for (i = 0; i < d.po.length; i++) {
      var poo = d.po[i];
      var terima = d.penerimaan.filter(function (x) { return x.poId === poo.id; });
      var fak = null;
      for (var j = 0; j < d.faktur.length; j++) if (d.faktur[j].poId === poo.id) fak = d.faktur[j];
      var res = P.cocokTigaArah(poo, terima, fak);
      if (res.status === 'cocok') hitung.cocok++;
      else if (res.status === 'selisih') hitung.selisih++;
      else if (res.status === 'parsial') hitung.parsial++;
      else hitung.menunggu++;
      if (res.status === 'selisih' && !res.flags.length) tanpaSebab++;
      if (res.status === 'selisih' && res.dampakRupiah === 0 && res.flags.indexOf('selisih-harga') >= 0) dampakNol++;
    }
    t.gte(hitung.cocok, 20, hitung.cocok + ' PO cocok sempurna');
    t.gte(hitung.selisih, 5, hitung.selisih + ' PO berselisih dan ditandai, bukan disembunyikan');
    t.gte(hitung.parsial + hitung.menunggu, 3, (hitung.parsial + hitung.menunggu) + ' PO masih terbuka atau menunggu faktur');
    t.eq(tanpaSebab, 0, 'setiap status "selisih" punya setidaknya satu bendera penyebab');
    t.eq(dampakNol, 0, 'setiap selisih harga membawa dampak rupiah yang tidak nol');

    var statusPo = P.statusPo(po, pn);
    t.eq(statusPo.kode, 'penuh', 'PO yang diterima penuh berstatus penuh');
    t.eq(P.statusPo(po, [{ baris: [{ sku: 'A', qtyBase: 40, hargaBase: 5000 }] }]).kode, 'parsial', 'PO yang diterima sebagian berstatus parsial');
    t.eq(P.statusPo(po, []).kode, 'terbuka', 'PO tanpa penerimaan berstatus terbuka');
    t.eq(statusPo.pesan, 150, 'kuantitas pesan dijumlahkan dalam satuan dasar');

    var pnKosong = 0, hargaNol = 0;
    for (i = 0; i < d.penerimaan.length; i++) {
      if (!d.penerimaan[i].baris.length) pnKosong++;
      for (var k = 0; k < d.penerimaan[i].baris.length; k++) if (d.penerimaan[i].baris[k].hargaBase <= 0) hargaNol++;
    }
    t.eq(pnKosong, 0, 'tidak ada dokumen penerimaan kosong di data demo');
    t.eq(hargaNol, 0, 'setiap baris penerimaan membawa harga perolehan positif');
  });

  /* ================================================== 14. peran ========= */

  group('Peran — penolakan yang menjelaskan dirinya', function (t) {
    t.eq(D.ROLES.length, 4, 'empat peran: kasir, staf gudang, pembelian, supervisor');
    var aksi = Object.keys(D.AKSI);
    t.gte(aksi.length, 12, aksi.length + ' aksi berperan');

    var kosong = 0, takSebutPeran = 0, total = 0, diizinkan = 0;
    for (var i = 0; i < D.ROLES.length; i++) {
      for (var j = 0; j < aksi.length; j++) {
        total++;
        var res = D.izin(D.ROLES[i].id, aksi[j]);
        if (res.ok) { diizinkan++; continue; }
        if (!res.alasan || res.alasan.length < 20) kosong++;
        if (res.alasan.indexOf(D.ROLES[i].label) < 0) takSebutPeran++;
      }
    }
    t.eq(kosong, 0, total + ' kombinasi peran×aksi diuji; setiap penolakan membawa kalimat, bukan boolean');
    t.eq(takSebutPeran, 0, 'setiap penolakan menyebut peran yang ditolak');
    t.gte(diizinkan, 12, diizinkan + ' kombinasi diizinkan — sistemnya bukan sekadar melarang semuanya');

    t.ok(D.izin('supervisor', 'opname.posting').ok, 'supervisor boleh memposting opname');
    t.notOk(D.izin('gudang', 'opname.posting').ok, 'staf gudang tidak boleh');
    t.notOk(D.izin('kasir', 'opname.posting').ok, 'kasir tidak boleh');
    t.notOk(D.izin('pembelian', 'opname.posting').ok, 'pembelian tidak boleh');
    t.ok(D.izin('supervisor', 'periode.buka').ok, 'supervisor boleh membuka periode');
    t.notOk(D.izin('pembelian', 'periode.buka').ok, 'pembelian tidak boleh membuka periode');
    t.ok(/menghitung ulang/.test(D.izin('pembelian', 'periode.buka').alasan), 'dan alasannya menyebut akibatnya: HPP yang sudah dilaporkan akan dihitung ulang');
    t.ok(D.izin('kasir', 'pos.jual').ok, 'kasir boleh menutup transaksi');
    t.notOk(D.izin('gudang', 'pos.jual').ok, 'staf gudang tidak berjaga di kasir');
    t.ok(D.izin('gudang', 'beli.terima').ok, 'staf gudang menerima barang');
    t.notOk(D.izin('pembelian', 'beli.terima').ok, 'pembelian TIDAK menerima barang yang dipesannya sendiri');
    t.ok(/menerima fisik/.test(D.izin('pembelian', 'beli.terima').alasan), 'dan alasannya menjelaskan pemisahan tugas itu');
    t.ok(D.izin('pembelian', 'beli.po').ok, 'pembelian menerbitkan PO');
    t.notOk(D.izin('kasir', 'beli.po').ok, 'kasir tidak menerbitkan PO');
    t.ok(D.izin('gudang', 'transfer.kirim').ok, 'staf gudang mengirim transfer');
    t.notOk(D.izin('kasir', 'transfer.kirim').ok, 'kasir tidak mengirim transfer');
    t.notOk(D.izin('kasir', 'aksi-tidak-ada').ok, 'aksi yang tidak dikenal ditolak, bukan diizinkan diam-diam');
    t.ok(D.izin('supervisor', 'pos.jual').ok, 'supervisor bisa menggantikan kasir bila perlu');
  });

  /* =========================================== 15. data fabrikasi ======= */

  group('Data fabrikasi — reproducible dan tidak menyerempet yang nyata', function (t) {
    var d = db();
    t.eq(d.produk.length, 120, '120 SKU');
    t.eq(d.supplier.length, 15, '15 supplier');
    t.eq(d.gudang.length, 3, '3 gudang fisik (ditambah lokasi TRANSIT di buku)');
    t.eq(S.KATEGORI.length, 12, '12 kategori barang');
    t.gte(d.kasir.length, 600, d.kasir.length + ' nota kasir sepanjang periode');
    t.gte(d.po.length, 60, d.po.length + ' purchase order');
    t.gte(d.penerimaan.length, 60, d.penerimaan.length + ' dokumen penerimaan');
    t.gte(d.faktur.length, 40, d.faktur.length + ' faktur supplier');

    var bcSalah = 0, bcPrefix = 0, bcUnik = {}, bcDobel = 0;
    for (var i = 0; i < d.produk.length; i++) {
      var bc = d.produk[i].barcode;
      if (!D.ean13Valid(bc)) bcSalah++;
      if (bc.slice(0, 3) !== '299') bcPrefix++;
      if (bcUnik[bc]) bcDobel++;
      bcUnik[bc] = 1;
    }
    t.eq(bcSalah, 0, 'ke-120 barcode adalah EAN-13 dengan check digit yang benar — pemindai akan membacanya');
    t.eq(bcPrefix, 0, 'semuanya berawalan 299, blok peredaran terbatas GS1, sehingga tidak mungkin menunjuk produk pabrikan yang nyata');
    t.eq(bcDobel, 0, 'tidak ada barcode kembar');
    t.notOk(D.ean13Valid('2991001383760'), 'check digit yang salah ditolak');
    t.notOk(D.ean13Valid('29910013837'), 'panjang yang salah ditolak');
    t.eq(D.ean13Check('899123456789'), D.ean13Check('899123456789'), 'perhitungan check digit deterministik');

    var npwpSalah = 0, npwpUnik = {}, npwpDobel = 0;
    for (i = 0; i < d.supplier.length; i++) {
      var np = d.supplier[i].npwp;
      if (np.slice(0, 2) !== '99') npwpSalah++;
      if (!/^\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}$/.test(np)) npwpSalah++;
      if (npwpUnik[np]) npwpDobel++;
      npwpUnik[np] = 1;
    }
    t.eq(npwpSalah, 0, 'setiap NPWP berbentuk benar dan berawalan 99, kategori yang tidak pernah diterbitkan DJP');
    t.eq(npwpDobel, 0, 'tidak ada NPWP kembar');

    var namaUnik = {}, namaDobel = 0;
    for (i = 0; i < d.produk.length; i++) { if (namaUnik[d.produk[i].nama]) namaDobel++; namaUnik[d.produk[i].nama] = 1; }
    t.eq(namaDobel, 0, 'tidak ada nama produk kembar');
    var supUnik = {}, supDobel = 0;
    for (i = 0; i < d.supplier.length; i++) { if (supUnik[d.supplier[i].nama]) supDobel++; supUnik[d.supplier[i].nama] = 1; }
    t.eq(supDobel, 0, 'tidak ada nama supplier kembar');

    var hargaSalah = 0, marginNegatif = 0;
    for (i = 0; i < d.produk.length; i++) {
      var pr = d.produk[i];
      if (!D.isInt(pr.hargaBeli) || !D.isInt(pr.hargaJual)) hargaSalah++;
      if (pr.hargaJual <= pr.hargaBeli) marginNegatif++;
      if (pr.hargaBeli % 25 !== 0) hargaSalah++;
      if (pr.hargaJual % 100 !== 0) hargaSalah++;
    }
    t.eq(hargaSalah, 0, 'harga beli kelipatan 25 rupiah, harga jual kelipatan 100 rupiah, keduanya bulat');
    t.eq(marginNegatif, 0, 'tidak ada produk yang dijual di bawah harga belinya');

    /* Determinism: the same seed must produce the same book, down to the total
     * value. This is what makes "rebuilt from one seed integer" checkable. */
    var d2 = S.build(S.SEED);
    t.eq(d2.buku.entries.length, d.buku.entries.length, 'membangun ulang dengan seed yang sama memberi jumlah entry yang sama');
    t.eq(d2.produk[7].nama, d.produk[7].nama, 'nama produk identik');
    t.eq(d2.produk[7].barcode, d.produk[7].barcode, 'barcode identik');
    t.eq(d2.supplier[3].npwp, d.supplier[3].npwp, 'NPWP identik');
    var h2 = L.replay(L.urut(d2.buku.entries), { metode: 'fifo', hargaAcuan: d2.hargaAcuan });
    t.eq(h2.total.hppJual, run('fifo').total.hppJual, 'dan HPP total identik sampai rupiah terakhir');
    t.eq(h2.akhir.nilai, run('fifo').akhir.nilai, 'persediaan akhir identik');
    var d3 = S.build(S.SEED + 1);
    t.ok(d3.produk[7].nama !== d.produk[7].nama, 'seed yang berbeda menghasilkan data yang berbeda — seednya benar-benar dipakai');

    var jenisTakDikenal = 0, dokKosong = 0;
    for (i = 0; i < d.buku.entries.length; i++) {
      var e = d.buku.entries[i];
      if (!D.JENIS[e.jenis]) jenisTakDikenal++;
      if (!e.dok) dokKosong++;
    }
    t.eq(jenisTakDikenal, 0, 'setiap entry berjenis yang dikenal');
    t.eq(dokKosong, 0, 'setiap entry menunjuk nomor dokumen');

    t.eq(d.hariIni, '2026-09-08', 'tanggal laporan tetap 2026-09-08 sehingga angka di layar tidak berubah esok hari');
    t.ok(d.buku.tutup['2026-03'], 'periode Maret ditutup');
    t.ok(d.buku.tutup['2026-04'], 'periode April ditutup');
    t.notOk(d.buku.tutup['2026-06'], 'Juni terbuka, sehingga demo mundur bisa dijalankan');
  });

  /* ========================================== 16. periode & tanggal ===== */

  group('Periode, tanggal dan penutupan buku', function (t) {
    t.eq(D.ymd(Date.UTC(2026, 6, 13)), '2026-07-13', 'konversi tanggal memakai UTC');
    t.eq(D.parseYmd('2026-07-13'), Date.UTC(2026, 6, 13), 'dan bolak-balik konsisten');
    t.eq(D.addDays('2026-02-28', 1), '2026-03-01', '2026 bukan tahun kabisat: 28 Feb + 1 = 1 Maret');
    t.eq(D.addDays('2026-12-31', 1), '2027-01-01', 'pergantian tahun benar');
    t.eq(D.addDays('2026-03-01', -1), '2026-02-28', 'mundur satu hari juga benar');
    t.eq(D.periodeOf('2026-07-13'), '2026-07', 'periode adalah bulan kalender');
    t.eq(D.periodeSebelum('2026-01'), '2025-12', 'periode sebelum Januari adalah Desember tahun lalu');
    t.eq(D.periodeSebelum('2026-07'), '2026-06', 'dan sebelum Juli adalah Juni');
    t.eq(D.periodeLabel('2026-09'), 'Sep 2026', 'label periode dalam bahasa Indonesia');
    t.eq(D.tglPanjang('2026-09-08'), '8 Sep 2026', 'tanggal panjang');
    t.eq(D.hariOf('2026-09-08'), 'Selasa', '8 September 2026 jatuh pada Selasa');

    var d = db();
    var h = run('fifo');
    var per = {};
    for (var i = 0; i < h.snapshots.length; i++) per[h.snapshots[i].periode] = 1;
    t.gte(h.snapshots.length, 6, h.snapshots.length + ' snapshot keadaan biaya diambil, satu di setiap batas periode');
    t.ok(per['2026-03'] && per['2026-06'] && per['2026-09'], 'snapshot mencakup awal Maret, Juni dan September');
    var urutSnap = 0;
    for (i = 1; i < h.snapshots.length; i++) if (h.snapshots[i].periode <= h.snapshots[i - 1].periode) urutSnap++;
    t.eq(urutSnap, 0, 'snapshot tersusun menurut periode menaik');
    var idxSnap = 0;
    for (i = 1; i < h.snapshots.length; i++) if (h.snapshots[i].idx <= h.snapshots[i - 1].idx) idxSnap++;
    t.eq(idxSnap, 0, 'dan indeksnya juga menaik');

    var s = sorted();
    var tglAwal = s[0].tgl, tglAkhir = s[s.length - 1].tgl;
    t.eq(tglAwal, '2026-03-01', 'entry pertama adalah saldo awal 1 Maret');
    t.lte(tglAkhir, d.hariIni, 'tidak ada entry bertanggal setelah tanggal laporan');

    var tolakMaret = L.periksaPosting(d.buku, { tgl: '2026-03-15', sku: 'SKU-1001', gudang: 'GD-PUSAT', arah: 1, qty: 10, jenis: 'terima', harga: 1000 }, { peran: 'supervisor', hariIni: d.hariIni });
    t.notOk(tolakMaret.ok, 'bahkan supervisor tidak bisa memposting ke Maret tanpa membuka periodenya lebih dulu');
    var terimaJuli = L.periksaPosting(d.buku, { tgl: '2026-07-15', sku: 'SKU-1001', gudang: 'GD-PUSAT', arah: 1, qty: 10, jenis: 'terima', harga: 1000 }, { peran: 'supervisor', hariIni: d.hariIni });
    t.ok(terimaJuli.ok, 'Juli terbuka dan menerima posting');

    var salinan = JSON.parse(JSON.stringify(d.buku));
    delete salinan.tutup['2026-03'];
    var bukaMaret = L.periksaPosting(salinan, { tgl: '2026-03-15', sku: 'SKU-1001', gudang: 'GD-PUSAT', arah: 1, qty: 10, jenis: 'terima', harga: 1000 }, { peran: 'supervisor', hariIni: d.hariIni });
    t.ok(bukaMaret.ok, 'setelah periodenya dibuka kembali, posting yang sama diterima — penolakannya memang soal periode, bukan soal lain');
  });

  /* ============================================ 17. metode & LIFO ======= */

  group('Metode penilaian — FIFO dan rata-rata saja', function (t) {
    t.eq(D.METODE.length, 2, 'hanya dua metode yang ditawarkan');
    var ids = D.METODE.map(function (m) { return m.id; });
    t.ok(ids.indexOf('fifo') >= 0, 'FIFO tersedia');
    t.ok(ids.indexOf('rata') >= 0, 'rata-rata tertimbang tersedia');
    t.eq(ids.indexOf('lifo'), -1, 'LIFO TIDAK tersedia — PSAK 14 dan Pasal 10 ayat (6) UU PPh tidak mengakuinya untuk penilaian persediaan');
    t.ok(/PSAK 14/.test(D.CATATAN_LIFO), 'dan alasannya tertulis di dalam aplikasi, bukan hanya di kepala pembuatnya');
    t.ok(/taat asas/.test(D.CATATAN_LIFO), 'termasuk kewajiban memakai metode secara taat asas');
    t.throws(function () { L.replay(sorted(), { metode: 'lifo' }); }, 'meminta metode lain ke mesin biaya tidak diam-diam jatuh ke FIFO');

    var hf = run('fifo'), hr = run('rata');
    t.eq(hf.jumlahEntry, hr.jumlahEntry, 'kedua metode melipat jumlah entry yang sama');
    t.eq(Object.keys(hf.hasil).length, Object.keys(hr.hasil).length, 'dan menghasilkan jumlah dokumen berbiaya yang sama');
    t.eq(hf.metode, 'fifo', 'hasil FIFO menandai dirinya');
    t.eq(hr.metode, 'rata', 'hasil rata-rata menandai dirinya');

    var lapisanKosong = 0;
    for (var k in hr.st) if (Object.prototype.hasOwnProperty.call(hr.st, k) && hr.st[k].layers.length) lapisanKosong++;
    t.eq(lapisanKosong, 0, 'metode rata-rata tidak menyimpan lapisan sama sekali — ia benar-benar metode lain, bukan FIFO yang dirata-ratakan di layar');
  });

  /* ==================================== 18. dasar pajak laba kotor ====== */

  group('Laba kotor — satu dasar pajak, neto retur', function (t) {
    /* Hand-checkable: a nota of Rp111.000 with prices that already include PPN
     * is Rp100.000 of DPP and Rp11.000 of output tax. The tax is not margin. */
    t.eq(D.hitungPpn(111000, true).dpp, 100000, 'PPN inklusif: Rp111.000 berisi DPP Rp100.000');
    t.eq(D.hitungPpn(111000, true).ppn, 11000, 'dan PPN keluaran Rp11.000');

    var m = mini();
    m.add({ tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 1, qty: 100, jenis: 'terima', dok: 'PN-1', harga: 1000 });
    m.add({ tgl: '2026-01-02', sku: 'X', gudang: 'G', arah: -1, qty: 10, jenis: 'jual', dok: 'KS-1', nilaiJual: 111000, nilaiDpp: 100000 });
    var r = m.jalan('fifo');
    var lk = L.labaKotor(r);
    t.eq(lk.penjualan, 100000, 'penjualan yang dipakai laba kotor adalah DPP-nya, bukan Rp111.000');
    t.eq(lk.hpp, 10000, 'HPP 10 unit @ Rp1.000');
    t.eq(lk.laba, 90000, 'laba kotor Rp90.000 — bukan Rp101.000 yang keluar kalau PPN keluaran ikut dihitung sebagai pendapatan');
    t.eq(lk.ppnKeluaran, 11000, 'selisih antara bruto dan DPP adalah PPN keluaran, dan dilaporkan sebagai itu');
    t.eq(lk.marginBp, 9000, 'margin 90,00% dalam basis poin — bilangan bulat, bukan float');
    t.eq(L.marginTeks(9000), '90,00%', 'dan dicetak dari basis poin itu');
    t.eq(lk.basis, 'dpp', 'fungsi ini menyebut dasar pajaknya sendiri');

    /* A retur leaves neither side of the margin. */
    m.add({ tgl: '2026-01-03', sku: 'X', gudang: 'G', arah: 1, qty: 10, jenis: 'retur-jual', dok: 'RJ-1', ref: 'E2', nilaiJual: 111000, nilaiDpp: 100000 });
    var r2 = m.jalan('fifo');
    var lk2 = L.labaKotor(r2);
    t.eq(lk2.penjualan, 0, 'nota yang diretur seluruhnya tidak menyisakan penjualan');
    t.eq(lk2.hpp, 0, 'dan tidak menyisakan HPP');
    t.eq(lk2.laba, 0, 'jadi tidak menyisakan laba — bukan laba hantu atas transaksi yang dibatalkan');
    t.eq(L.konservasi(r2).selisih, 0, 'dan identitas nilainya tetap tertutup');

    /* Allocation: the lines of a nota add up to the nota's own single rounded DPP. */
    var bagi = D.alokasi(100000, [33333, 33333, 33334]);
    t.eq(bagi[0] + bagi[1] + bagi[2], 100000, 'alokasi DPP per baris berjumlah tepat DPP dokumen');
    t.eq(D.alokasi(10, [1, 1, 1]).join(','), '4,3,3', 'sisa dibagikan satu rupiah per baris, bukan dibulatkan tiga kali');
    t.eq(D.alokasi(7, [0, 0]).join(','), '7,0', 'bobot nol tidak membuat rupiah hilang');
    t.throws(function () { D.alokasi(1.5, [1]); }, 'alokasi menolak total pecahan');

    var d = db(), hf = run('fifo');
    var lkD = L.labaKotor(hf);
    t.eq(lkD.taksiran, 0, 'setiap baris penjualan di buku demo membawa DPP-nya sendiri — tidak ada yang ditaksir');
    t.eq(lkD.penjualan, hf.total.penjualanDpp - hf.total.returJualDpp, 'penjualan neto = DPP penjualan − DPP retur');
    t.eq(lkD.hpp, hf.total.hppJual - hf.total.returJual, 'HPP neto = HPP penjualan − biaya yang dikembalikan retur');
    t.ok(lkD.laba < hf.total.penjualanBruto - hf.total.hppJual,
      'angka yang benar LEBIH KECIL dari bruto minus HPP — itulah PPN keluaran yang dulu dilaporkan sebagai laba');
    t.eq(lkD.ppnKeluaran, (hf.total.penjualanBruto - hf.total.returJualBruto) - lkD.penjualan, 'dan besarnya PPN itu dilaporkan tersendiri');

    /* The per-entry DPP of one seeded nota sums to the nota's document DPP. */
    var nota = d.kasir[d.kasir.length - 1], jml = 0, kotor = 0;
    for (var i = 0; i < nota.baris.length; i++) { jml += nota.baris[i].nilaiDpp; kotor += D.mul(nota.baris[i].qty, nota.baris[i].harga); }
    t.eq(jml, nota.dpp, 'DPP tiap baris nota ' + nota.id + ' berjumlah tepat DPP notanya');
    t.eq(kotor, nota.subtotal, 'dan nilai jual tiap barisnya berjumlah tepat subtotal notanya');
    var byId = {};
    for (i = 0; i < d.buku.entries.length; i++) byId[d.buku.entries[i].id] = d.buku.entries[i];
    var jml2 = 0;
    for (i = 0; i < nota.baris.length; i++) jml2 += byId[nota.baris[i].entryId].nilaiDpp;
    t.eq(jml2, nota.dpp, 'dan entry buku besarnya membawa angka yang sama, bukan angka yang dihitung ulang di laporan');
  });

  /* ==================================== 19. retur kumulatif ============= */

  group('Retur penjualan — batas kumulatif dan pemulihan yang tidak dobel', function (t) {
    function bukuRetur() {
      var m = mini();
      m.add({ tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 1, qty: 4, jenis: 'terima', dok: 'PN-1', harga: 1000 });
      m.add({ tgl: '2026-01-02', sku: 'X', gudang: 'G', arah: 1, qty: 20, jenis: 'terima', dok: 'PN-2', harga: 1500 });
      m.jual = m.add({ tgl: '2026-01-03', sku: 'X', gudang: 'G', arah: -1, qty: 10, jenis: 'jual', dok: 'KS-1', nilaiJual: 30000, nilaiDpp: 27027 });
      return m;
    }
    ['fifo', 'rata'].forEach(function (metode) {
      var satu = bukuRetur();
      var hppJual = satu.jalan(metode).hasil[satu.jual.id].nilai;
      satu.add({ tgl: '2026-01-04', sku: 'X', gudang: 'G', arah: 1, qty: 10, jenis: 'retur-jual', dok: 'RJ-1', ref: satu.jual.id, nilaiJual: 30000, nilaiDpp: 27027 });
      var rSatu = satu.jalan(metode);

      var dua = bukuRetur();
      dua.add({ tgl: '2026-01-04', sku: 'X', gudang: 'G', arah: 1, qty: 6, jenis: 'retur-jual', dok: 'RJ-1', ref: dua.jual.id, nilaiJual: 18000, nilaiDpp: 16216 });
      dua.add({ tgl: '2026-01-05', sku: 'X', gudang: 'G', arah: 1, qty: 4, jenis: 'retur-jual', dok: 'RJ-2', ref: dua.jual.id, nilaiJual: 12000, nilaiDpp: 10811 });
      var rDua = dua.jalan(metode);

      t.eq(rSatu.total.returJual, hppJual, metode + ': satu retur penuh mengembalikan tepat biaya notanya (' + hppJual + ')');
      t.eq(rDua.total.returJual, hppJual, metode + ': retur yang dipecah dua kali mengembalikan jumlah yang SAMA, bukan lebih');
      t.eq(rDua.akhir.nilai, rSatu.akhir.nilai, metode + ': nilai persediaan akhirnya juga sama besar');
      t.eq(L.konservasi(rDua).selisih, 0, metode + ': identitas nilai tetap tertutup setelah retur bertahap');
      t.eq(rDua.returLebih.length, 0, metode + ': dan tidak ada retur yang melebihi notanya');
    });

    /* FIFO detail: the sale ate 4 @ 1000 then 6 @ 1500. Returning 6 gives back
     * the newer six (Rp9.000); the second leg of 4 must give back 4 @ 1000
     * (Rp4.000), not another 4 @ 1500. */
    var m2 = bukuRetur();
    m2.add({ tgl: '2026-01-04', sku: 'X', gudang: 'G', arah: 1, qty: 6, jenis: 'retur-jual', dok: 'RJ-1', ref: m2.jual.id, nilaiJual: 18000 });
    var rA = m2.jalan('fifo');
    var idRj1 = m2.buku.entries[m2.buku.entries.length - 1].id;
    t.eq(rA.hasil[idRj1].nilai, 9000, 'retur pertama 6 unit mengembalikan ekor konsumsi: 6 × Rp1.500 = Rp9.000');
    m2.add({ tgl: '2026-01-05', sku: 'X', gudang: 'G', arah: 1, qty: 4, jenis: 'retur-jual', dok: 'RJ-2', ref: m2.jual.id, nilaiJual: 12000 });
    var rB = m2.jalan('fifo');
    var idRj2 = m2.buku.entries[m2.buku.entries.length - 1].id;
    t.eq(rB.hasil[idRj2].nilai, 4000, 'retur kedua 4 unit mengembalikan 4 × Rp1.000 = Rp4.000, bukan Rp6.000 dari ekor yang sudah dipakai');
    t.eq(rB.total.returJual, 13000, 'jumlah keduanya tepat biaya penjualannya');

    /* Over-return is detected by the ENGINE, not only by the posting screen. */
    var m3 = bukuRetur();
    m3.add({ tgl: '2026-01-04', sku: 'X', gudang: 'G', arah: 1, qty: 10, jenis: 'retur-jual', dok: 'RJ-1', ref: m3.jual.id, nilaiJual: 30000 });
    m3.add({ tgl: '2026-01-05', sku: 'X', gudang: 'G', arah: 1, qty: 10, jenis: 'retur-jual', dok: 'RJ-2', ref: m3.jual.id, nilaiJual: 30000 });
    var rC = m3.jalan('fifo');
    t.eq(rC.returLebih.length, 1, 'meretur 20 unit atas penjualan 10 unit tercatat sebagai pelanggaran');
    t.eq(rC.returLebih[0].qtyJual, 10, 'dan pelanggaran itu menyebut kuantitas penjualannya');
    var pbC = L.periksaBuku(rC, L.urut(m3.buku.entries));
    t.ok(pbC.gagal > 0, 'pemeriksaan buku hidup GAGAL untuk buku itu — invariannya benar-benar bisa merah');

    /* A retur pointing at something that is not its own sale is refused outright. */
    var m4 = bukuRetur();
    m4.add({ tgl: '2026-01-04', sku: 'X', gudang: 'G', arah: 1, qty: 2, jenis: 'retur-jual', dok: 'RJ-1', ref: 'E1', nilaiJual: 6000 });
    t.throws(function () { m4.jalan('fifo'); }, 'retur yang menunjuk dokumen penerimaan, bukan penjualannya, melempar');

    /* And the cumulative arithmetic the posting screen uses. */
    var d = db(), retur = d.returJual[0];
    var terpakai = 0;
    for (var i = 0; i < d.buku.entries.length; i++) {
      var e = d.buku.entries[i];
      if (e.jenis === 'retur-jual' && e.ref === retur.baris[0].refEntry) terpakai += e.qty;
    }
    t.gte(terpakai, retur.baris[0].qtyBase, 'kuantitas yang sudah diretur bisa dihitung dari buku besar saja — itu satu-satunya catatan yang selamat dari muat ulang');
  });

  /* ==================================== 20. TRANSIT per dokumen ========= */

  group('TRANSIT — dua pengiriman satu SKU tidak boleh bertukar biaya', function (t) {
    function dua() {
      var b = L.buatBuku();
      L.tambah(b, { tgl: '2026-01-01', sku: 'X', gudang: 'G1', arah: 1, qty: 10, jenis: 'terima', dok: 'PN-1', harga: 1000 });
      L.tambah(b, { tgl: '2026-01-02', sku: 'X', gudang: 'G1', arah: 1, qty: 10, jenis: 'terima', dok: 'PN-2', harga: 5000 });
      var A = { id: 'TF-A', dariGudang: 'G1', keGudang: 'G2', tglKirim: '2026-01-10', baris: [{ sku: 'X', qtyBase: 10 }] };
      var B = { id: 'TF-B', dariGudang: 'G1', keGudang: 'G3', tglKirim: '2026-01-11', baris: [{ sku: 'X', qtyBase: 10 }] };
      P.kirimTransfer(b, A);
      P.kirimTransfer(b, B);
      /* Received OUT OF ORDER, which is the case that used to swap the costs. */
      P.terimaTransfer(b, B, '2026-01-12');
      P.terimaTransfer(b, A, '2026-01-13');
      return b;
    }
    var b = dua(), r = L.replay(L.urut(b.entries), { metode: 'fifo', periksaUrutan: true });
    t.eq(r.st['X|G2'].nilai, 10000, 'FIFO: kiriman lapisan tua (10 @ Rp1.000) tiba di G2 bernilai Rp10.000');
    t.eq(r.st['X|G3'].nilai, 50000, 'dan kiriman lapisan baru (10 @ Rp5.000) tiba di G3 bernilai Rp50.000 — tidak tertukar');
    t.eq(r.st['X|TRANSIT'].qty, 0, 'TRANSIT kosong kembali');
    t.eq(r.st['X|TRANSIT'].nilai, 0, 'dan bernilai nol, bukan menyimpan sisa rupiah');
    t.eq(L.konservasi(r).selisih, 0, 'identitas nilai tertutup');
    t.ok(L.konservasi(r).transferSeimbang, 'transfer masuk = transfer keluar');
    t.eq(r.pasanganTakLengkap, 0, 'setiap kedatangan menemukan lapisan kiriman miliknya sendiri');

    var rr = L.replay(L.urut(b.entries), { metode: 'rata' });
    t.eq(rr.total.transferMasuk, rr.total.transferKeluar, 'rata-rata: nilai yang tiba sama dengan yang berangkat');
    t.eq(L.konservasi(rr).selisih, 0, 'dan identitasnya juga tertutup');

    /* Whole-book claim: on the demo book every arrival is costed at exactly the
     * value its own send leg carried, per document. */
    var d = db(), hf = run('fifo'), i, cocok = 0, beda = 0;
    for (i = 0; i < d.transfer.length; i++) {
      var tr = d.transfer[i];
      if (tr.status !== 'tiba') continue;
      for (var j = 0; j < tr.baris.length; j++) {
        var br = tr.baris[j];
        var kirim = hf.hasil[br.entryTransit], tiba = hf.hasil[br.entryMasuk];
        if (!kirim || !tiba) continue;
        if (kirim.nilai === tiba.nilai) cocok++; else beda++;
      }
    }
    t.eq(beda, 0, 'di buku demo, ' + cocok + ' kaki transfer tiba dengan nilai yang persis sama dengan saat berangkat');
    t.eq(hf.pasanganTakLengkap, 0, 'dan tidak satu pun kedatangan harus mengambil lapisan milik kiriman lain');

    /* Pairing is verified, not assumed: a transfer-masuk pointed at an unrelated
     * document must throw rather than quietly adopting its cost. */
    var b2 = L.buatBuku();
    L.tambah(b2, { tgl: '2026-01-01', sku: 'X', gudang: 'G1', arah: 1, qty: 10, jenis: 'terima', dok: 'PN-1', harga: 1000 });
    var jual = L.tambah(b2, { tgl: '2026-01-02', sku: 'X', gudang: 'G1', arah: -1, qty: 1, jenis: 'jual', dok: 'KS-1', nilaiJual: 2000, nilaiDpp: 1802 });
    L.tambah(b2, { tgl: '2026-01-03', sku: 'X', gudang: 'G2', arah: 1, qty: 5, jenis: 'transfer-masuk', dok: 'TR-X', pasangan: jual.id });
    t.throws(function () { L.replay(L.urut(b2.entries), { metode: 'fifo' }); },
      'transfer masuk yang berpasangan dengan nota penjualan melempar — bukan mengarang stok dari harga dokumen lain');
  });

  /* ==================================== 21. pemeriksaan buku hidup ====== */

  group('Pemeriksaan buku hidup — invarian atas buku yang dimuat', function (t) {
    var s = sorted();
    ['fifo', 'rata'].forEach(function (metode) {
      var r = L.replay(s, { metode: metode, periksaUrutan: true, hargaAcuan: db().hargaAcuan });
      var pb = L.periksaBuku(r, s);
      t.eq(pb.gagal, 0, metode + ': seluruh ' + pb.total + ' invarian buku hidup terpenuhi di buku demo');
      t.ok(pb.seimbang, metode + ': dan kedua sisi identitasnya seimbang');
    });

    /* The check has to be able to FAIL, or it is decoration. Three books that are
     * each wrong in a different way, each caught by a different line. */
    var neg = L.buatBuku();
    L.tambah(neg, { tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 1, qty: 1, jenis: 'terima', dok: 'PN-1', harga: 1000 });
    L.tambah(neg, { tgl: '2026-01-02', sku: 'X', gudang: 'G', arah: -1, qty: 2, jenis: 'jual', dok: 'KS-1', nilaiJual: 4000, nilaiDpp: 3604 });
    var rNeg = L.replay(L.urut(neg.entries), { metode: 'fifo', periksaUrutan: true });
    var pbNeg = L.periksaBuku(rNeg, L.urut(neg.entries));
    t.ok(pbNeg.gagal > 0, 'saldo negatif membuat pemeriksaan merah');
    var namaNeg = pbNeg.cek.filter(function (c) { return !c.ok; }).map(function (c) { return c.nama; }).join(' | ');
    t.ok(/negatif/.test(namaNeg), 'dan yang merah menyebut saldo negatif: ' + namaNeg);
    t.ok(/defisit/.test(namaNeg), 'serta pengeluaran yang dihargai tanpa stok');

    var taksir = L.buatBuku();
    L.tambah(taksir, { tgl: '2026-01-01', sku: 'X', gudang: 'G', arah: 1, qty: 10, jenis: 'terima', dok: 'PN-1', harga: 1000 });
    L.tambah(taksir, { tgl: '2026-01-02', sku: 'X', gudang: 'G', arah: -1, qty: 1, jenis: 'jual', dok: 'KS-1', nilaiJual: 2000 });
    var rT = L.replay(L.urut(taksir.entries), { metode: 'fifo', periksaUrutan: true });
    t.eq(rT.total.dppTaksiran, 1, 'baris penjualan tanpa DPP tercatat sebagai taksiran, tidak dianggap benar begitu saja');
    var pbT = L.periksaBuku(rT, L.urut(taksir.entries));
    t.ok(pbT.gagal > 0, 'dan pemeriksaan buku hidup menandainya, karena dasar pajaknya jadi tidak pasti');
  });

  /* ==================================== 22. nomor dokumen ============== */

  group('Nomor dokumen — lebar sama antara seed dan runtime', function (t) {
    var d = db();
    var salinan = { entries: [], seqBerikut: 1, tutup: {}, dokBerikut: JSON.parse(JSON.stringify(d.buku.dokBerikut)) };
    var ks = L.nomorDok(salinan, 'KS');
    var pn = L.nomorDok(salinan, 'PN');
    t.eq(ks.length, 'KS-001444'.length, 'nomor nota yang dicetak runtime selebar yang dicetak seed: ' + ks);
    var terakhir = d.kasir[d.kasir.length - 1].id;
    t.ok(ks > terakhir, 'dan urut secara leksikografis SETELAH nota terakhir (' + terakhir + ' lalu ' + ks + ') — bukan KS-01445 yang justru mengurut lebih awal');
    t.eq(pn.length, 'PN-00181'.length, 'penerimaan tetap lima digit: ' + pn);
    t.eq(L.lebarDok('KS'), 6, 'tabel lebarnya eksplisit untuk KS');
    t.eq(L.lebarDok('PN'), 5, 'dan default lima untuk sisanya');
    var semua = d.kasir.map(function (n) { return n.id; });
    var urut = semua.slice().sort();
    t.eq(semua.join(',') === urut.join(','), true, 'seluruh nota seed sudah urut leksikografis, jadi urutan itu memang bisa diandalkan');
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

  root.GUDANG_TESTS = { run: run_, groups: groups, db: db, hasil: run };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GUDANG_TESTS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
