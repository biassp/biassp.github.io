/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — seed.js
 * The demo dataset. EVERY FIGURE IN IT IS FABRICATED.
 *
 * There is no scraped catalogue behind this file and no anonymised export from
 * a real business. Product names are assembled from a category noun, a brand
 * word built syllable by syllable from an invented phonotactic pattern, and a
 * size variant. Supplier names are built the same way. Barcodes are real EAN-13
 * — correct check digit, a scanner will read them — but they sit on GS1 prefix
 * 299, which is the RESTRICTED CIRCULATION range a shop assigns to itself, so
 * none of them can identify a real manufacturer's article. NPWP numbers use the
 * 99 category prefix, which the DJP has never issued. Every one of those choices
 * is the same idea: fabricate inside a hole in the real numbering space rather
 * than on top of it.
 *
 * Everything is rebuilt from a single seed integer on every page load, so the
 * dataset is reproducible, identical under node and in the browser, and owned
 * by nobody.
 *
 * The generator keeps its own running balance map while it works. That is a
 * GENERATOR concern — it exists so the demo never invents a sale of stock that
 * was not there — and it is thrown away when generation finishes. The app never
 * reads it; the app derives every balance from the ledger, as it must.
 */
(function (root) {
  'use strict';

  var D = root.GUDANG_DOMAIN;
  var L = root.GUDANG_LEDGER;
  var P = root.GUDANG_PROSES;
  var S = {};
  root.GUDANG_SEED = S;

  S.SEED = 20260908;
  S.HARI_INI = '2026-09-08';
  S.MULAI = '2026-03-01';        // saldo awal
  S.AKHIR = '2026-09-06';        // last generated movement

  /* --------------------------------------------------------- fabrikasi */

  var ONSET = ['b', 'c', 'd', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'w', 'y',
    'br', 'dr', 'kr', 'pr', 'tr', 'ng', 'ny', 'sy', 'gl', 'bl'];
  var VOKAL = ['a', 'i', 'u', 'e', 'o', 'a', 'i', 'u', 'a', 'e'];
  var KODA = ['', '', '', '', 'n', 'r', 's', 'ng', 'l', 'm', 'h'];

  function suku(r) { return r.pick(ONSET) + r.pick(VOKAL) + r.pick(KODA); }

  function kata(r, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += suku(r);
    s = s.replace(/([bcdfghjklmnpqrstvwxyz]{4,})/g, function (m) { return m.slice(0, 2); });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* --------------------------------------------------------------- master */

  S.GUDANG = [
    { id: 'GD-PUSAT', nama: 'Gudang Pusat', kota: 'Semarang', tipe: 'induk', ket: 'Penerimaan pembelian dan penyimpanan utama.' },
    { id: 'GD-TOKO', nama: 'Gudang Toko', kota: 'Semarang', tipe: 'toko', ket: 'Stok siap jual di belakang kasir.' },
    { id: 'GD-TIMUR', nama: 'Gudang Cabang Timur', kota: 'Kudus', tipe: 'cabang', ket: 'Cabang; dipasok lewat transfer antargudang.' }
  ];
  S.GUDANG_JUAL = ['GD-TOKO', 'GD-TIMUR'];

  S.KATEGORI = [
    {
      id: 'minuman', nama: 'Air Minum & Minuman Ringan',
      satuan: [{ kode: 'DUS', faktor: 24 }, { kode: 'PCS', faktor: 1 }],
      item: ['Air Mineral', 'Air Mineral Sparkling', 'Teh Melati Botol', 'Minuman Isotonik', 'Soda Jeruk'],
      varian: ['330 ml', '600 ml', '1,5 L', '250 ml'], lo: 2500, hi: 9000, laris: 9
    },
    {
      id: 'mie', nama: 'Mie Instan',
      satuan: [{ kode: 'KARTON', faktor: 40 }, { kode: 'PAK', faktor: 5 }, { kode: 'PCS', faktor: 1 }],
      item: ['Mie Goreng', 'Mie Kuah Ayam Bawang', 'Mie Kuah Soto', 'Mie Cup Kari', 'Bihun Instan'],
      varian: ['70 g', '75 g', '85 g', 'cup 60 g'], lo: 2600, hi: 4200, laris: 10
    },
    {
      id: 'beras', nama: 'Beras',
      satuan: [{ kode: 'ZAK', faktor: 25 }, { kode: 'KG', faktor: 1 }],
      item: ['Beras Pandan Wangi', 'Beras IR64 Premium', 'Beras Setra Ramos', 'Beras Merah', 'Beras Ketan'],
      varian: ['kualitas I', 'kualitas II', 'premium', 'medium'], lo: 11000, hi: 18000, laris: 7
    },
    {
      id: 'minyak', nama: 'Minyak Goreng',
      satuan: [{ kode: 'DUS', faktor: 12 }, { kode: 'PCS', faktor: 1 }],
      item: ['Minyak Goreng Sawit', 'Minyak Goreng Kelapa', 'Minyak Jagung'],
      varian: ['pouch 1 L', 'pouch 2 L', 'botol 1 L', 'jerigen 2 L'], lo: 15000, hi: 23000, laris: 8
    },
    {
      id: 'gula', nama: 'Gula & Tepung',
      satuan: [{ kode: 'ZAK', faktor: 50 }, { kode: 'KG', faktor: 1 }],
      item: ['Gula Pasir', 'Gula Halus', 'Tepung Terigu Protein Tinggi', 'Tepung Terigu Serbaguna', 'Tepung Beras'],
      varian: ['curah', 'kemasan 1 kg', 'kemasan 500 g'], lo: 9000, hi: 17000, laris: 7
    },
    {
      id: 'kopi', nama: 'Kopi & Teh Sachet',
      satuan: [{ kode: 'KARTON', faktor: 120 }, { kode: 'RENTENG', faktor: 10 }, { kode: 'PCS', faktor: 1 }],
      item: ['Kopi Instan 3in1', 'Kopi Hitam Sachet', 'Teh Celup', 'Cokelat Bubuk Sachet', 'Kopi Susu Sachet'],
      varian: ['20 g', '25 g', '18 g', '30 g'], lo: 900, hi: 2600, laris: 9
    },
    {
      id: 'susu', nama: 'Susu & Olahan',
      satuan: [{ kode: 'DUS', faktor: 36 }, { kode: 'PCS', faktor: 1 }],
      item: ['Susu UHT Cokelat', 'Susu UHT Full Cream', 'Susu Kental Manis', 'Yogurt Botol', 'Susu Bubuk Sachet'],
      varian: ['125 ml', '200 ml', 'kaleng 370 g', '80 g'], lo: 4500, hi: 13000, laris: 8
    },
    {
      id: 'sabun', nama: 'Sabun & Perawatan',
      satuan: [{ kode: 'KARTON', faktor: 72 }, { kode: 'PAK', faktor: 6 }, { kode: 'PCS', faktor: 1 }],
      item: ['Sabun Mandi Batang', 'Sabun Cair Refill', 'Sampo Sachet', 'Pasta Gigi', 'Sabun Cuci Tangan'],
      varian: ['80 g', '250 ml', '10 ml', '120 g'], lo: 2200, hi: 9800, laris: 6
    },
    {
      id: 'detergen', nama: 'Detergen & Pembersih',
      satuan: [{ kode: 'KARTON', faktor: 48 }, { kode: 'PAK', faktor: 6 }, { kode: 'PCS', faktor: 1 }],
      item: ['Detergen Bubuk', 'Detergen Cair', 'Pelembut Pakaian', 'Pembersih Lantai', 'Pembersih Kaca'],
      varian: ['800 g', '425 ml', '1 L', '770 ml'], lo: 3200, hi: 15000, laris: 6
    },
    {
      id: 'snack', nama: 'Snack & Biskuit',
      satuan: [{ kode: 'KARTON', faktor: 60 }, { kode: 'PAK', faktor: 10 }, { kode: 'PCS', faktor: 1 }],
      item: ['Biskuit Kelapa', 'Wafer Cokelat', 'Keripik Kentang', 'Kacang Panggang', 'Permen Susu'],
      varian: ['110 g', '55 g', '68 g', '135 g'], lo: 1200, hi: 8000, laris: 8
    },
    {
      id: 'bumbu', nama: 'Bumbu & Saus',
      satuan: [{ kode: 'KARTON', faktor: 96 }, { kode: 'PAK', faktor: 12 }, { kode: 'PCS', faktor: 1 }],
      item: ['Kecap Manis', 'Saus Sambal', 'Saus Tomat', 'Bumbu Nasi Goreng', 'Garam Beryodium'],
      varian: ['sachet 20 ml', 'botol 135 ml', 'refill 520 ml', '250 g'], lo: 1500, hi: 9000, laris: 6
    },
    {
      id: 'rumah', nama: 'ATK & Rumah Tangga',
      satuan: [{ kode: 'LUSIN', faktor: 12 }, { kode: 'PCS', faktor: 1 }],
      item: ['Buku Tulis', 'Pulpen', 'Sikat Gigi', 'Sapu Ijuk', 'Ember Plastik'],
      varian: ['38 lembar', 'isi 0,5 mm', 'medium', 'ukuran L', '10 L'], lo: 3000, hi: 38000, laris: 4
    }
  ];

  /* ------------------------------------------------------------- build */

  S.build = function (seed) {
    seed = seed || S.SEED;
    var r = D.rng(seed);
    var out = {
      seed: seed, hariIni: S.HARI_INI, mulai: S.MULAI, akhir: S.AKHIR,
      gudang: S.GUDANG, kategori: S.KATEGORI,
      supplier: [], produk: [], produkBySku: {}, barcodeIndex: {},
      pelanggan: [], buku: L.buatBuku(),
      po: [], penerimaan: [], faktur: [], transfer: [], opname: [], kasir: [], returJual: [],
      hargaAcuan: {}
    };

    /* --------------------------------------------------------- supplier */
    var KOTA = ['Semarang', 'Kudus', 'Solo', 'Yogyakarta', 'Surabaya', 'Bekasi', 'Tangerang', 'Bandung', 'Sidoarjo', 'Pekalongan'];
    var BENTUK = ['PT', 'PT', 'CV', 'CV', 'UD'];
    var dipakai = {};
    for (var i = 0; i < 15; i++) {
      var nama;
      do { nama = kata(r, 3) + ' ' + kata(r, 2); } while (dipakai[nama]);
      dipakai[nama] = 1;
      var katList = [];
      var nk = r.int(2, 4);
      var pool = S.KATEGORI.slice();
      for (var q = 0; q < nk; q++) katList.push(pool.splice(r.int(0, pool.length - 1), 1)[0].id);
      out.supplier.push({
        id: 'SUP-' + String(101 + i),
        nama: r.pick(BENTUK) + ' ' + nama,
        npwp: D.npwp(r),
        kota: r.pick(KOTA),
        tempo: r.pick([14, 21, 30, 30, 45]),
        kategori: katList,
        kontak: kata(r, 2) + ' ' + kata(r, 2)
      });
    }

    /* ---------------------------------------------------------- produk */
    var no = 0, namaTerpakai = {};
    for (var ki = 0; ki < S.KATEGORI.length; ki++) {
      var kat = S.KATEGORI[ki];
      var merekKat = [];
      for (var mi = 0; mi < 5; mi++) merekKat.push(kata(r, r.int(2, 3)));
      for (var pi = 0; pi < 10; pi++) {
        no++;
        var item = kat.item[pi % kat.item.length];
        var merek = merekKat[pi % merekKat.length];
        var varian = kat.varian[(pi + ki) % kat.varian.length];
        /* Syllable generation can collide. A duplicated product name in a
         * catalogue is not cosmetic — it is two SKUs a picker cannot tell
         * apart — so a collision draws a fresh brand word rather than being
         * papered over with a suffix. */
        var namaCalon = item + ' ' + merek + ' ' + varian, tebak = 0;
        while (namaTerpakai[namaCalon] && tebak < 50) {
          merek = kata(r, 3);
          namaCalon = item + ' ' + merek + ' ' + varian;
          tebak++;
        }
        namaTerpakai[namaCalon] = 1;
        var hargaBeli = r.int(kat.lo, kat.hi);
        hargaBeli = Math.round(hargaBeli / 25) * 25;          // rupiah, kelipatan 25
        var marginBp = r.int(1130, 1320);                      // 13,0% – 32,0%
        var hargaJual = D.divRound(D.mul(hargaBeli, marginBp), 1000);
        hargaJual = Math.ceil(hargaJual / 100) * 100;          // dibulatkan ke atas ke ratusan
        var sku = 'SKU-' + String(1000 + no);
        var bc = D.ean13(no * 7919 + 130457);
        var prod = {
          sku: sku,
          nama: namaCalon,
          merek: merek,
          kategori: kat.id,
          kategoriNama: kat.nama,
          satuan: kat.satuan,
          barcode: bc,
          hargaBeli: hargaBeli,
          hargaJual: hargaJual,
          laris: kat.laris + r.int(-3, 3),
          minStok: D.mul(r.int(2, 8), kat.satuan[0].faktor),
          rak: String.fromCharCode(65 + (no % 8)) + '-' + (1 + (no % 14))
        };
        if (prod.laris < 1) prod.laris = 1;
        out.produk.push(prod);
        out.produkBySku[sku] = prod;
        out.barcodeIndex[bc] = sku;
        out.hargaAcuan[sku] = hargaBeli;
      }
    }

    /* ------------------------------------------------------- pelanggan */
    out.pelanggan.push({ id: 'PLG-000', nama: 'Umum (tanpa nama)', tipe: 'umum' });
    for (var pj = 0; pj < 12; pj++) {
      out.pelanggan.push({
        id: 'PLG-' + String(101 + pj),
        nama: (r.chance(0.4) ? 'Warung ' : r.chance(0.5) ? 'Toko ' : 'Kios ') + kata(r, 2),
        tipe: 'langganan',
        diskonBp: r.pick([0, 0, 200, 300, 500])       // basis poin dari harga jual
      });
    }

    /* =================================================== saldo awal == */
    var bal = {};                       // generator-only running balance
    function b(sku, g) { return bal[sku + '|' + g] || 0; }
    function bump(sku, g, n) { bal[sku + '|' + g] = b(sku, g) + n; }

    for (i = 0; i < out.produk.length; i++) {
      var pr = out.produk[i];
      var outer = pr.satuan[0].faktor;
      var qPusat = D.mul(r.int(2, 7), outer);
      L.tambah(out.buku, {
        tgl: S.MULAI, sku: pr.sku, gudang: 'GD-PUSAT', arah: 1, qty: qPusat,
        jenis: 'saldo-awal', dok: 'SA-2026-03', harga: pr.hargaBeli, catatan: 'saldo awal per 1 Maret 2026'
      });
      bump(pr.sku, 'GD-PUSAT', qPusat);
      if (r.chance(0.82)) {
        var qToko = D.mul(r.int(1, 3), outer);
        L.tambah(out.buku, {
          tgl: S.MULAI, sku: pr.sku, gudang: 'GD-TOKO', arah: 1, qty: qToko,
          jenis: 'saldo-awal', dok: 'SA-2026-03', harga: pr.hargaBeli, catatan: 'saldo awal per 1 Maret 2026'
        });
        bump(pr.sku, 'GD-TOKO', qToko);
      }
      if (r.chance(0.55)) {
        var qTimur = D.mul(r.int(1, 3), outer);
        L.tambah(out.buku, {
          tgl: S.MULAI, sku: pr.sku, gudang: 'GD-TIMUR', arah: 1, qty: qTimur,
          jenis: 'saldo-awal', dok: 'SA-2026-03', harga: pr.hargaBeli, catatan: 'saldo awal per 1 Maret 2026'
        });
        bump(pr.sku, 'GD-TIMUR', qTimur);
      }
    }

    /* ================================================== jalannya hari == */

    var hari = D.addDays(S.MULAI, 1);
    var jadwalTerima = {};      // ymd -> [{poId, porsi}]
    var jadwalFaktur = {};      // ymd -> [poId]
    var jadwalTransfer = {};    // ymd -> [transferId]
    var pending = [];           // sales eligible for retur

    function skuSupplier(sup) {
      var list = [];
      for (var z = 0; z < out.produk.length; z++) if (sup.kategori.indexOf(out.produk[z].kategori) >= 0) list.push(out.produk[z]);
      return list;
    }

    function jadwal(map, tgl, v) { if (!map[tgl]) map[tgl] = []; map[tgl].push(v); }

    /* ================================================ opname historis == */

    function opnameHistoris(id, gudang, tgl, jumlahSku) {
      var op = { id: id, gudang: gudang, tglMulai: tgl, status: 'draf', oleh: 'gudang', baris: [], bekuSeq: 0 };
      var skuAda = [];
      for (var k in bal) {
        if (!Object.prototype.hasOwnProperty.call(bal, k)) continue;
        var pr2 = k.split('|');
        if (pr2[1] !== gudang) continue;
        if (bal[k] <= 0) continue;
        skuAda.push(pr2[0]);
      }
      skuAda.sort();
      var ambil = [];
      for (var ai = 0; ai < skuAda.length && ambil.length < jumlahSku; ai++) if (r.chance(0.5)) ambil.push(skuAda[ai]);
      if (!ambil.length) ambil = skuAda.slice(0, jumlahSku);
      P.bukaOpname(out.buku, op, null, ambil);
      for (var bi = 0; bi < op.baris.length; bi++) {
        var ln = op.baris[bi];
        var v = 0;
        if (r.chance(0.26)) {
          v = r.chance(0.68) ? -r.int(1, 6) : r.int(1, 4);
          if (ln.bukuQty + v < 0) v = 0;
        }
        ln.fisikQty = ln.bukuQty + v;
        if (v !== 0) {
          ln.alasan = v < 0 ? r.pick(['susut', 'hilang', 'salah-hitung', 'salah-satuan']) : r.pick(['ditemukan', 'belum-posting', 'salah-input']);
        }
      }
      op.status = 'terhitung';
      var res = P.postingOpname(out.buku, op, { peran: 'supervisor', tgl: tgl, oleh: 'SPV-01' });
      if (res.ok) {
        for (var ei = 0; ei < res.entries.length; ei++) {
          var ee = res.entries[ei];
          bump(ee.sku, ee.gudang, ee.arah * ee.qty);
        }
      } else {
        op.gagal = res.alasan;
      }
      out.opname.push(op);
      return op;
    }

    var poSeq = 0, pnSeq = 0, fkSeq = 0, trSeq = 0, ksSeq = 0, rjSeq = 0;
    function nomor(pref, n, lebar) {
      var s = String(n);
      while (s.length < (lebar || 5)) s = '0' + s;
      return pref + '-' + s;
    }

    while (hari <= S.AKHIR) {
      var dow = new Date(D.parseYmd(hari)).getUTCDay();

      /* ---------------------------------------------------------- PO -- */
      if (dow === 1 || dow === 3 || (dow === 5 && r.chance(0.6))) {
        var nPo = r.int(1, 3);
        for (var pp = 0; pp < nPo; pp++) {
          var sup = r.pick(out.supplier);
          var kand = skuSupplier(sup);
          if (!kand.length) continue;
          poSeq++;
          var po = {
            id: nomor('PO', poSeq), tgl: hari, supplierId: sup.id,
            gudangId: r.chance(0.82) ? 'GD-PUSAT' : 'GD-TIMUR',
            baris: [], status: 'terbuka', tempo: sup.tempo
          };
          var nLine = r.int(3, 6), sudah = {};
          for (var lj = 0; lj < nLine; lj++) {
            var cand = r.pick(kand);
            if (sudah[cand.sku]) continue;
            sudah[cand.sku] = 1;
            var sat = cand.satuan[0];
            var qtyOrder = r.int(1, 4);
            /* Purchase price wobbles ±4% per PO. Without that wobble FIFO and
             * average produce identical numbers and the whole costing screen
             * would be a tautology. */
            var jitter = r.int(9600, 10450);
            var hargaBase = D.divRound(D.mul(cand.hargaBeli, jitter), 10000);
            po.baris.push({
              sku: cand.sku, satuan: sat.kode, qtySatuan: qtyOrder,
              qtyBase: D.mul(qtyOrder, sat.faktor),
              hargaSatuan: D.mul(hargaBase, sat.faktor),
              hargaBase: hargaBase
            });
          }
          if (!po.baris.length) continue;
          out.po.push(po);
          var lead = r.int(2, 9);
          if (r.chance(0.36)) {
            jadwal(jadwalTerima, D.addDays(hari, lead), { poId: po.id, porsi: r.int(45, 70) });
            jadwal(jadwalTerima, D.addDays(hari, lead + r.int(3, 11)), { poId: po.id, porsi: 100 });
          } else if (r.chance(0.12)) {
            jadwal(jadwalTerima, D.addDays(hari, lead), { poId: po.id, porsi: r.int(50, 85) });   // never completed
          } else {
            jadwal(jadwalTerima, D.addDays(hari, lead), { poId: po.id, porsi: 100 });
          }
          jadwal(jadwalFaktur, D.addDays(hari, lead + r.int(2, 14)), po.id);
        }
      }

      /* -------------------------------------------------- penerimaan -- */
      var kt = jadwalTerima[hari] || [];
      for (var ti = 0; ti < kt.length; ti++) {
        var job = kt[ti];
        var poo = null;
        for (var z2 = 0; z2 < out.po.length; z2++) if (out.po[z2].id === job.poId) poo = out.po[z2];
        if (!poo) continue;
        var sudahTerima = {};
        for (var z3 = 0; z3 < out.penerimaan.length; z3++) {
          if (out.penerimaan[z3].poId !== poo.id) continue;
          for (var z4 = 0; z4 < out.penerimaan[z3].baris.length; z4++) {
            var bb = out.penerimaan[z3].baris[z4];
            sudahTerima[bb.sku] = (sudahTerima[bb.sku] || 0) + bb.qtyBase;
          }
        }
        pnSeq++;
        var pn = { id: nomor('PN', pnSeq), poId: poo.id, tgl: hari, gudangId: poo.gudangId, supplierId: poo.supplierId, baris: [] };
        for (var z5 = 0; z5 < poo.baris.length; z5++) {
          var pb = poo.baris[z5];
          var prod2 = out.produkBySku[pb.sku];
          var target = D.divRound(D.mul(pb.qtyBase, job.porsi), 100);
          var outer2 = prod2.satuan[0].faktor;
          target = D.mul(D.divFloor(target, outer2), outer2);     // supplier ships whole outer packs
          if (job.porsi >= 100) target = pb.qtyBase;
          var kirim = target - (sudahTerima[pb.sku] || 0);
          if (kirim <= 0) continue;
          var e = L.tambah(out.buku, {
            tgl: hari, sku: pb.sku, gudang: poo.gudangId, arah: 1, qty: kirim,
            jenis: 'terima', dok: pn.id, harga: pb.hargaBase, catatan: 'atas ' + poo.id
          });
          bump(pb.sku, poo.gudangId, kirim);
          pn.baris.push({ sku: pb.sku, qtyBase: kirim, hargaBase: pb.hargaBase, entryId: e.id });
        }
        if (pn.baris.length) out.penerimaan.push(pn);
      }

      /* ------------------------------------------------------ faktur -- */
      var kf = jadwalFaktur[hari] || [];
      for (var fi = 0; fi < kf.length; fi++) {
        var poId = kf[fi], po2 = null;
        for (var z6 = 0; z6 < out.po.length; z6++) if (out.po[z6].id === poId) po2 = out.po[z6];
        if (!po2) continue;
        var terimaList = out.penerimaan.filter(function (x) { return x.poId === poId; });
        if (!terimaList.length) continue;
        if (r.chance(0.05)) continue;                 // faktur belum datang
        fkSeq++;
        var mode = r.next();
        var fk = {
          id: nomor('FK', fkSeq), poId: poId, tgl: hari, supplierId: po2.supplierId,
          noFaktur: '010.' + r.int(100, 999) + '-26.' + r.int(10000000, 99999999),
          baris: [], ppnInklusif: false
        };
        var agg = {};
        for (var z7 = 0; z7 < terimaList.length; z7++)
          for (var z8 = 0; z8 < terimaList[z7].baris.length; z8++) {
            var tb = terimaList[z7].baris[z8];
            agg[tb.sku] = (agg[tb.sku] || 0) + tb.qtyBase;
          }
        for (var z9 = 0; z9 < po2.baris.length; z9++) {
          var pb2 = po2.baris[z9];
          var qF = agg[pb2.sku] || 0;
          if (qF === 0 && mode >= 0.86) continue;
          var hF = pb2.hargaBase;
          if (mode < 0.10) hF = D.divRound(D.mul(pb2.hargaBase, r.int(10200, 10650)), 10000);   // naik sepihak
          if (mode >= 0.10 && mode < 0.18) qF = pb2.qtyBase;                                    // ditagih sesuai PO
          if (qF <= 0) continue;
          fk.baris.push({ sku: pb2.sku, qtyBase: qF, hargaBase: hF });
        }
        if (fk.baris.length) out.faktur.push(fk);
      }

      /* ---------------------------------------------------- transfer -- */
      if ((dow === 2 || dow === 5) && r.chance(0.85)) {
        var tujuan = r.chance(0.6) ? 'GD-TOKO' : 'GD-TIMUR';
        trSeq++;
        var tr = {
          id: nomor('TR', trSeq), dariGudang: 'GD-PUSAT', keGudang: tujuan,
          tglKirim: hari, tglTerima: null, status: 'draf', baris: []
        };
        var nT = r.int(3, 7);
        for (var tj = 0; tj < nT; tj++) {
          var cp = r.weighted(out.produk, 'laris');
          var outer3 = cp.satuan[0].faktor;
          var ada = b(cp.sku, 'GD-PUSAT');
          if (ada < outer3 * 2) continue;
          var kirimQ = D.mul(r.int(1, Math.min(6, D.divFloor(ada, outer3) - 1)), outer3);
          if (kirimQ <= 0) continue;
          tr.baris.push({ sku: cp.sku, qtyBase: kirimQ });
          bump(cp.sku, 'GD-PUSAT', -kirimQ);
        }
        if (tr.baris.length) {
          P.kirimTransfer(out.buku, tr);
          out.transfer.push(tr);
          var tiba = D.addDays(hari, r.int(2, 5));
          if (tiba <= S.AKHIR) jadwal(jadwalTransfer, tiba, tr.id);
        }
      }
      var ktr = jadwalTransfer[hari] || [];
      for (var tt = 0; tt < ktr.length; tt++) {
        var trx = null;
        for (var za = 0; za < out.transfer.length; za++) if (out.transfer[za].id === ktr[tt]) trx = out.transfer[za];
        if (!trx || trx.status !== 'jalan') continue;
        P.terimaTransfer(out.buku, trx, hari);
        for (var zb = 0; zb < trx.baris.length; zb++) bump(trx.baris[zb].sku, trx.keGudang, trx.baris[zb].qtyBase);
      }

      /* ------------------------------------------------------- kasir -- */
      if (dow !== 0 || r.chance(0.7)) {
        for (var gi = 0; gi < S.GUDANG_JUAL.length; gi++) {
          var gj = S.GUDANG_JUAL[gi];
          var nTx = gj === 'GD-TOKO' ? r.int(6, 12) : r.int(2, 6);
          for (var tx = 0; tx < nTx; tx++) {
            ksSeq++;
            var plg = r.chance(0.72) ? out.pelanggan[0] : r.pick(out.pelanggan);
            var nota = {
              id: nomor('KS', ksSeq, 6), tgl: hari, gudang: gj, kasir: gj === 'GD-TOKO' ? 'KSR-01' : 'KSR-02',
              pelangganId: plg.id, baris: [], bayar: [], ppnInklusif: true
            };
            var nL = r.int(1, 6), pakai = {};
            for (var li = 0; li < nL; li++) {
              var cs = r.weighted(out.produk, 'laris');
              if (pakai[cs.sku]) continue;
              var tersedia = b(cs.sku, gj);
              if (tersedia <= 0) continue;
              pakai[cs.sku] = 1;
              /* A grosir sells two ways out of the same bin: eceran by the piece
               * and partai by the outer pack. Mixing both is what makes the unit
               * ladder earn its keep — and what makes a stock card that adds
               * "10 dus" to "3 pcs" produce a number nobody can defend. */
              var outerS = cs.satuan[0].faktor;
              var qty;
              if (r.chance(0.55) && tersedia >= outerS) {
                qty = D.mul(r.int(1, Math.min(3, D.divFloor(tersedia, outerS))), outerS);
              } else {
                qty = r.int(1, Math.max(1, Math.min(tersedia, 14)));
              }
              if (qty > tersedia) qty = tersedia;
              var hargaU = cs.hargaJual;
              if (plg.diskonBp) hargaU = hargaU - D.divRound(D.mul(hargaU, plg.diskonBp), 10000);
              nota.baris.push({ sku: cs.sku, satuan: D.satuanBasis(cs).kode, qtySatuan: qty, qty: qty, harga: hargaU, diskon: 0, entryId: null });
            }
            if (!nota.baris.length) { ksSeq--; continue; }
            /* PPN is rounded ONCE per nota, so the document total has to exist
             * before its lines can be written to the ledger: each sale entry
             * carries its allocated share of the nota's DPP, and that is the
             * figure gross profit is computed from. Writing the entries first
             * and the total afterwards is what left the ledger with revenue on
             * one tax base and cost on another. */
            var tot = P.totalKeranjang(nota.baris, { ppnInklusif: true });
            nota.total = tot.total; nota.dpp = tot.dpp; nota.ppn = tot.ppn; nota.subtotal = tot.subtotal;
            for (var ki = 0; ki < nota.baris.length; ki++) {
              var kb = nota.baris[ki];
              var ent = L.tambah(out.buku, {
                tgl: hari, sku: kb.sku, gudang: gj, arah: -1, qty: kb.qty,
                jenis: 'jual', dok: nota.id, nilaiJual: D.mul(kb.qty, kb.harga),
                nilaiDpp: tot.baris[ki].dpp, catatan: ''
              });
              bump(kb.sku, gj, -kb.qty);
              kb.entryId = ent.id;
              kb.nilaiDpp = tot.baris[ki].dpp;
            }
            /* Payment mix: mostly cash rounded up to a note, some QRIS for the
             * exact amount, a few split. */
            if (r.chance(0.58)) {
              var bulat = Math.ceil(tot.total / 5000) * 5000;
              nota.bayar = [{ jenis: 'tunai', jumlah: bulat }];
            } else if (r.chance(0.6)) {
              nota.bayar = [{ jenis: 'qris', jumlah: tot.total }];
            } else {
              var nonT = D.divRound(D.mul(tot.total, r.int(3000, 7000)), 10000);
              nota.bayar = [{ jenis: r.chance(0.5) ? 'transfer' : 'qris', jumlah: nonT },
              { jenis: 'tunai', jumlah: Math.ceil((tot.total - nonT) / 1000) * 1000 }];
            }
            var bay = P.hitungBayar(tot.total, nota.bayar);
            nota.kembali = bay.kembali;
            out.kasir.push(nota);
            pending.push(nota);
            if (pending.length > 90) pending.shift();
          }
        }
      }

      /* ------------------------------------------------ retur penjualan */
      if (r.chance(0.09) && pending.length > 12) {
        var asal = pending[r.int(0, pending.length - 12)];
        var brs = r.pick(asal.baris);
        var qR = r.int(1, brs.qty);
        rjSeq++;
        var rj = {
          id: nomor('RJ', rjSeq), tgl: hari, notaId: asal.id, gudang: asal.gudang,
          baris: [{
            sku: brs.sku, qtyBase: qR, refEntry: brs.entryId, nilaiJual: D.mul(qR, brs.harga),
            nilaiDpp: D.isInt(brs.nilaiDpp) ? D.divRound(D.mul(brs.nilaiDpp, qR), brs.qty) : null
          }],
          alasan: r.pick(['barang cacat', 'salah varian', 'kemasan penyok', 'batal beli'])
        };
        var es = P.returPenjualan(out.buku, { id: asal.id, gudang: asal.gudang }, rj.baris, hari, rj.id);
        rj.entries = es.map(function (x) { return x.id; });
        bump(brs.sku, asal.gudang, qR);
        out.returJual.push(rj);
      }

      /* ------------------------------------------------ retur pembelian */
      if (r.chance(0.035) && out.penerimaan.length > 5) {
        var pnx = out.penerimaan[r.int(Math.max(0, out.penerimaan.length - 40), out.penerimaan.length - 1)];
        var bx = r.pick(pnx.baris);
        var prodx = out.produkBySku[bx.sku];
        var adaX = b(bx.sku, pnx.gudangId);
        var qX = Math.min(adaX, D.mul(r.int(1, 2), prodx.satuan[prodx.satuan.length - 2] ? prodx.satuan[prodx.satuan.length - 2].faktor : 1));
        if (qX > 0) {
          L.tambah(out.buku, {
            tgl: hari, sku: bx.sku, gudang: pnx.gudangId, arah: -1, qty: qX,
            jenis: 'retur-beli', dok: 'RB-' + pnx.id.slice(3), ref: bx.entryId,
            catatan: 'retur ke supplier atas ' + pnx.id
          });
          bump(bx.sku, pnx.gudangId, -qX);
        }
      }

      /* ------------------------------------------------------ opname -- */
      /* Historical counts run INSIDE the day loop, on the day they happened,
       * so the frozen book quantity is the balance as it stood that morning
       * rather than today's. Freezing a past count against a present balance is
       * exactly the bug this app exists to argue against. */
      if (hari === '2026-05-30') opnameHistoris('OP-00001', 'GD-TOKO', hari, 34);
      if (hari === '2026-07-25') opnameHistoris('OP-00002', 'GD-TIMUR', hari, 28);
      if (hari === '2026-08-29') opnameHistoris('OP-00003', 'GD-PUSAT', hari, 40);

      hari = D.addDays(hari, 1);
    }

    /* Stock that has left GD-PUSAT and has not arrived anywhere is not an edge
     * case to be tidied away — it is a real thing sitting on a truck, and it has
     * to be visible and counted somewhere. The generator guarantees at least one
     * open shipment so the in-transit column on the position report is never an
     * empty promise. */
    var adaJalan = false;
    for (var tj2 = 0; tj2 < out.transfer.length; tj2++) if (out.transfer[tj2].status === 'jalan') adaJalan = true;
    if (!adaJalan) {
      trSeq++;
      var trAkhir = {
        id: nomor('TR', trSeq), dariGudang: 'GD-PUSAT', keGudang: 'GD-TIMUR',
        tglKirim: S.AKHIR, tglTerima: null, status: 'draf', baris: []
      };
      for (var tk = 0; tk < out.produk.length && trAkhir.baris.length < 5; tk++) {
        var cpk = out.produk[(tk * 17) % out.produk.length];
        var ok = cpk.satuan[0].faktor;
        if (b(cpk.sku, 'GD-PUSAT') < ok * 2) continue;
        trAkhir.baris.push({ sku: cpk.sku, qtyBase: ok });
        bump(cpk.sku, 'GD-PUSAT', -ok);
      }
      if (trAkhir.baris.length) { P.kirimTransfer(out.buku, trAkhir); out.transfer.push(trAkhir); }
    }

    /* One sheet left OPEN and already counted, so the Opname tab has something
     * a supervisor can post the moment the page loads — and so the post-count
     * movement path is exercised by hand rather than only by the test suite. */
    var opAktif = { id: 'OP-00004', gudang: 'GD-TOKO', tglMulai: S.HARI_INI, status: 'draf', oleh: 'gudang', baris: [], bekuSeq: 0 };
    var skuToko = [];
    for (var kk2 in bal) {
      if (!Object.prototype.hasOwnProperty.call(bal, kk2)) continue;
      var pr3 = kk2.split('|');
      if (pr3[1] !== 'GD-TOKO' || bal[kk2] <= 0) continue;
      skuToko.push(pr3[0]);
    }
    skuToko.sort();
    P.bukaOpname(out.buku, opAktif, null, skuToko.slice(0, 18));
    for (var oi = 0; oi < opAktif.baris.length; oi++) {
      var lnn = opAktif.baris[oi];
      if (r.chance(0.33)) {
        var vv = r.chance(0.7) ? -r.int(1, 5) : r.int(1, 3);
        if (lnn.bukuQty + vv < 0) vv = 0;
        lnn.fisikQty = lnn.bukuQty + vv;
        if (vv !== 0) lnn.alasan = vv < 0 ? 'susut' : 'ditemukan';
      } else {
        lnn.fisikQty = lnn.bukuQty;
      }
    }
    opAktif.status = 'terhitung';
    out.opname.push(opAktif);

    /* ============================================== periode & penutup == */

    /* March and April are closed: the SPT for those months has gone in. Every
     * later month is open, which is what makes the backdating demo possible
     * and the refusal demo honest. */
    out.buku.tutup['2026-03'] = { oleh: 'SPV-01', tgl: '2026-04-12' };
    out.buku.tutup['2026-04'] = { oleh: 'SPV-01', tgl: '2026-05-11' };

    out.buku.dokBerikut = { PO: poSeq + 1, PN: pnSeq + 1, FK: fkSeq + 1, TR: trSeq + 1, KS: ksSeq + 1, RJ: rjSeq + 1, OP: 5 };

    out.statistik = {
      produk: out.produk.length,
      supplier: out.supplier.length,
      gudang: out.gudang.length,
      entries: out.buku.entries.length,
      po: out.po.length,
      penerimaan: out.penerimaan.length,
      faktur: out.faktur.length,
      transfer: out.transfer.length,
      nota: out.kasir.length,
      returJual: out.returJual.length,
      opname: out.opname.length
    };
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
