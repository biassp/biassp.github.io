/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — ledger.js
 * The stock ledger and the costing engine. This is the whole app; everything
 * else is a form on top of it.
 *
 * ============================ THE MODEL ==================================
 *
 * THERE IS NO STOCK FIELD. Nowhere in this codebase does a product carry a
 * mutable `stok` number that somebody increments. Stock on hand is the sum of
 * an append-only ledger of movements (kartu stok), and every balance you see —
 * per SKU, per gudang, as of any date — is derived by folding that ledger.
 *
 * The reason is not purity. A stored balance and a movement history are two
 * sources of truth, and the moment one write succeeds and the other does not,
 * the system is lying and nobody can tell which number is wrong. Deriving costs
 * a fold over a few thousand rows and buys an invariant that cannot be violated
 * by a bug: saldo akhir = saldo awal + masuk - keluar, for every SKU, in every
 * gudang, at every point in time, because that IS the definition.
 *
 * An entry is immutable. Corrections are new entries (retur, penyesuaian),
 * never edits. The only mutation the ledger permits is INSERTION — including
 * insertion with a date in the past, which is where the difficulty lives.
 *
 * ORDER. Entries are processed in (tgl, seq) order: calendar date first, then
 * the immutable insertion sequence as tie-breaker. A backdated document
 * therefore lands on its own date but after everything already posted on that
 * date, which is exactly how a paper book behaves. Because seq never changes,
 * the sorted position of every existing entry is stable under insertion: a new
 * entry splices in, it never reorders its neighbours. That stability is what
 * makes incremental recomputation provable rather than hopeful.
 *
 * ============================ COSTING ====================================
 *
 * Two methods, both implemented for real, side by side, switchable.
 *
 * FIFO keeps genuine cost layers per (SKU, gudang). Each receipt pushes a layer
 * {qty, unitCost} keyed by the receipt's (tgl, seq). Each issue consumes layers
 * oldest-key-first, splitting the layer when the issue is partial, and a layer
 * is removed the instant it reaches zero. A layer never goes negative and never
 * gets consumed out of order; both are asserted by an independent check inside
 * the consumption loop that re-scans the whole layer list for the minimum key
 * rather than trusting the list to be sorted.
 *
 * WEIGHTED AVERAGE carries {qty, nilai} per (SKU, gudang), where nilai is the
 * total value of stock on hand in whole rupiah. A receipt does
 *   nilai += qty_masuk * harga_masuk;  qty += qty_masuk
 * which is precisely the numerator and denominator of the textbook formula
 *   hpp_baru = (qty_lama*hpp_lama + qty_masuk*harga_masuk) / (qty_lama+qty_masuk)
 * and the displayed unit cost is divRound(nilai, qty).
 *
 * Carrying total VALUE rather than a rounded unit cost is a deliberate choice
 * and the tests check it both ways. If you carry a rounded per-unit hpp and
 * multiply it out on every issue, the rounding residue escapes: total purchases
 * stop equalling COGS plus closing inventory, by a few rupiah per issue,
 * forever. Carrying the value and taking the issue as
 *   hpp_keluar = divRound(nilai * qty_keluar, qty)
 * leaves the residue inside the remaining inventory value, where it belongs,
 * and the accounting identity closes to the rupiah. When the last unit leaves,
 * qty_keluar == qty and the formula returns nilai exactly, so the value hits
 * zero with the quantity — no orphan rupiah stranded in an empty bin.
 *
 * ROUNDING: one policy, D.divRound, half away from zero. Nothing here uses
 * Math.round (banker's-ish on .5 for negatives) or a float division.
 *
 * ======================== BACKDATED INSERTION ============================
 *
 * Inserting a receipt dated last week invalidates every COGS figure after it:
 * the issues that followed consumed layers that no longer exist in the same
 * order, and under average costing they were valued against an average that
 * never happened. The engine handles this by replaying — but not by replaying
 * everything and calling it a day.
 *
 * replay() takes a snapshot of the complete costing state at every period
 * boundary. hitungUlangDari() finds the newest snapshot strictly before the
 * inserted document's period, keeps the per-document results computed before
 * that boundary verbatim, and replays only from there. The tests assert that
 * the incremental result is IDENTICAL, document by document, to a full replay —
 * which is the only way to trust an incremental path.
 *
 * The engine then diffs the two runs and reports every document whose HPP
 * moved, before and after. Two things it refuses outright: a backdated document
 * into a closed period, and a backdated issue that would drive stock negative
 * at any later moment.
 *
 * ========================= VALUE CONSERVATION ============================
 *
 * konservasi() asserts, in whole rupiah, under both methods:
 *
 *   saldo awal + pembelian + retur penjualan + penyesuaian masuk + transfer masuk
 *     - retur pembelian - HPP penjualan - penyesuaian keluar - transfer keluar
 *   = nilai persediaan akhir
 *
 * with transfer masuk == transfer keluar exactly (in-transit value is carried,
 * not created). If that identity ever fails by one rupiah, the app is lying
 * about money and the test suite says so on the badge in the header.
 */
(function (root) {
  'use strict';

  var D = root.GUDANG_DOMAIN;
  var L = {};
  root.GUDANG_LEDGER = L;

  var TRANSIT = D.TRANSIT;

  function kunciSaldo(sku, gudang) { return sku + '|' + gudang; }
  L.kunciSaldo = kunciSaldo;

  /* Layer ordering key. Zero-padded so string comparison is date-then-sequence
   * order without parsing. A restored layer keeps the key of the receipt it
   * came from, which is how a retur puts stock back at its ORIGINAL position in
   * the queue rather than at the front or the back. */
  function layerKunci(tgl, seq) {
    var s = String(seq);
    while (s.length < 9) s = '0' + s;
    return tgl + '#' + s;
  }
  L.layerKunci = layerKunci;

  function urutKunci(e) { return layerKunci(e.tgl, e.seq); }

  /* --------------------------------------------------------------- buku */

  L.buatBuku = function () {
    return { entries: [], seqBerikut: 1, tutup: {}, dokBerikut: {} };
  };

  L.nomorDok = function (buku, prefix) {
    if (!buku.dokBerikut[prefix]) buku.dokBerikut[prefix] = 1;
    var n = buku.dokBerikut[prefix]++;
    var s = String(n);
    while (s.length < 5) s = '0' + s;
    return prefix + '-' + s;
  };

  /* The only way an entry is ever created. Assigns the immutable seq, freezes
   * the shape, and refuses anything non-integer at the door rather than letting
   * a float wander into the ledger and surface as an unreconcilable stock card
   * three months later. */
  L.buatEntry = function (buku, e) {
    if (!D.isInt(e.qty) || e.qty <= 0) throw new Error('qty entry harus bilangan bulat positif (base unit), dapat ' + e.qty);
    if (e.harga !== null && e.harga !== undefined && !D.isInt(e.harga)) throw new Error('harga entry harus bilangan bulat rupiah, dapat ' + e.harga);
    if (e.arah !== 1 && e.arah !== -1) throw new Error('arah entry harus +1 atau -1');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.tgl)) throw new Error('tgl entry harus YYYY-MM-DD');
    var seq = buku.seqBerikut++;
    var rec = {
      id: 'E' + seq,
      seq: seq,
      tgl: e.tgl,
      sku: e.sku,
      gudang: e.gudang,
      arah: e.arah,
      qty: e.qty,
      jenis: e.jenis,
      dok: e.dok || '',
      harga: (e.harga === undefined) ? null : e.harga,
      nilaiJual: D.isInt(e.nilaiJual) ? e.nilaiJual : null,
      ref: e.ref || null,               // referenced entry id (retur -> penjualan)
      pasangan: e.pasangan || null,     // transfer: the paired movement
      alasan: e.alasan || null,
      opname: e.opname || null,
      catatan: e.catatan || '',
      mundur: !!e.mundur
    };
    return rec;
  };

  L.tambah = function (buku, e) {
    var rec = L.buatEntry(buku, e);
    buku.entries.push(rec);
    return rec;
  };

  /* Sorted view. Never mutates the book's own array, because the insertion
   * order IS the seq and losing it would lose the tie-break. */
  L.urut = function (entries) {
    var a = entries.slice();
    a.sort(function (x, y) {
      if (x.tgl < y.tgl) return -1;
      if (x.tgl > y.tgl) return 1;
      return x.seq - y.seq;
    });
    return a;
  };

  /* ------------------------------------------------------ saldo mentah */

  /* Balances computed by pure summation over the ledger, with no reference to
   * the costing engine at all. The tests cross-check the costing engine's own
   * quantity tracking against this, so a bug in layer arithmetic cannot hide
   * behind the same bug in the balance report. */
  L.saldoMentah = function (entries, sampaiTgl) {
    var out = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (sampaiTgl && e.tgl > sampaiTgl) continue;
      var k = kunciSaldo(e.sku, e.gudang);
      out[k] = (out[k] || 0) + e.arah * e.qty;
    }
    return out;
  };

  /* Minimum balance a key reaches from a date onward. Used to refuse a
   * backdated issue that would drive a LATER day negative — the failure mode
   * that makes naive backdating unsafe. */
  L.saldoMinimumSejak = function (entries, sku, gudang, dariTgl) {
    var s = L.urut(entries), run = 0, min = null;
    for (var i = 0; i < s.length; i++) {
      var e = s[i];
      if (e.sku !== sku || e.gudang !== gudang) continue;
      run += e.arah * e.qty;
      if (dariTgl && e.tgl < dariTgl) continue;
      if (min === null || run < min) min = run;
    }
    return min === null ? run : min;
  };

  /* ----------------------------------------------------- costing state */

  function stKosong() { return { qty: 0, nilai: 0, layers: [] }; }

  function cloneSt(st) {
    var out = {}, k, i;
    for (k in st) {
      if (!Object.prototype.hasOwnProperty.call(st, k)) continue;
      var s = st[k], ls = new Array(s.layers.length);
      for (i = 0; i < s.layers.length; i++) {
        var l = s.layers[i];
        ls[i] = { kunci: l.kunci, srcId: l.srcId, srcDok: l.srcDok, tgl: l.tgl, qty: l.qty, unitCost: l.unitCost };
      }
      out[k] = { qty: s.qty, nilai: s.nilai, layers: ls };
    }
    return out;
  }

  function totalKosong() {
    return {
      saldoAwal: 0, pembelian: 0, returBeli: 0, hppJual: 0, returJual: 0,
      adjMasuk: 0, adjKeluar: 0, transferMasuk: 0, transferKeluar: 0,
      masuk: 0, keluar: 0, penjualanBruto: 0,
      qtyMasuk: 0, qtyKeluar: 0
    };
  }
  function cloneTotal(t) {
    var o = {}, k;
    for (k in t) if (Object.prototype.hasOwnProperty.call(t, k)) o[k] = t[k];
    return o;
  }
  function cloneMap(m) {
    var o = {}, k;
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k)) o[k] = m[k];
    return o;
  }

  /* Insert a layer in (tgl, seq) order. Ordinary receipts always carry the
   * largest key so far and land at the end after one comparison; a layer
   * restored by a retur penjualan carries the ORIGINAL receipt's key and slots
   * back into the middle, which is the point. */
  function sisipLayer(layers, layer) {
    var i = layers.length;
    while (i > 0 && layers[i - 1].kunci > layer.kunci) i--;
    /* A portion restored by a retur carries the key AND the unit cost of the
     * layer it came from, so it rejoins that layer rather than sitting beside
     * it as a twin. Two layers with identical key and cost are the same lot;
     * keeping them apart would clutter the queue without changing a rupiah. */
    if (i > 0 && layers[i - 1].kunci === layer.kunci && layers[i - 1].unitCost === layer.unitCost) {
      layers[i - 1].qty += layer.qty;
      return;
    }
    if (i < layers.length && layers[i].kunci === layer.kunci && layers[i].unitCost === layer.unitCost) {
      layers[i].qty += layer.qty;
      return;
    }
    layers.splice(i, 0, layer);
  }
  L.sisipLayer = sisipLayer;

  /* ------------------------------------------------------------ replay */

  /* One pass of the fold. Extracted so replay() and hitungUlangDari() share
   * exactly the same arithmetic — an incremental path that reimplements the
   * costing is an incremental path that will drift. */
  function jalankan(sorted, mulaiIdx, ctx, opts) {
    var metode = ctx.metode;
    var fifo = metode === 'fifo';
    var st = ctx.st, hasil = ctx.hasil, total = ctx.total, lastHarga = ctx.lastHarga;
    var defisit = ctx.defisit, snapshots = ctx.snapshots;
    var periksa = !!opts.periksaUrutan;
    var hargaAcuan = opts.hargaAcuan || {};

    function get(k) { return st[k] || (st[k] = stKosong()); }

    function hargaJatuhTempo(k, sku) {
      var s = st[k];
      if (s && s.qty > 0 && s.nilai > 0) return D.divRound(s.nilai, s.qty);
      if (lastHarga[k] !== undefined) return lastHarga[k];
      if (lastHarga[sku] !== undefined) return lastHarga[sku];
      if (hargaAcuan[sku] !== undefined) return hargaAcuan[sku];
      return 0;
    }

    /* Consume qty base units from a key, returning {nilai, layers, defisit}.
     * The FIFO branch takes layers[0] every time; the periksa branch re-derives
     * the minimum key independently and counts disagreements, so "oldest first"
     * is verified rather than assumed. */
    function ambil(k, qty, sku) {
      var s = get(k), sisa = qty, nilai = 0, dipakai = [], kurang = 0;
      if (fifo) {
        while (sisa > 0 && s.layers.length) {
          if (periksa) {
            var minK = null, minI = -1;
            for (var j = 0; j < s.layers.length; j++) {
              if (s.layers[j].qty < 0) { ctx.layerNegatif++; continue; }
              if (s.layers[j].qty === 0) continue;
              if (minK === null || s.layers[j].kunci < minK) { minK = s.layers[j].kunci; minI = j; }
            }
            if (minI !== 0) ctx.urutSalah++;
          }
          var lay = s.layers[0];
          var amb = sisa < lay.qty ? sisa : lay.qty;
          var nl = D.mul(amb, lay.unitCost);
          nilai += nl;
          dipakai.push({ kunci: lay.kunci, srcId: lay.srcId, srcDok: lay.srcDok, tgl: lay.tgl, qty: amb, unitCost: lay.unitCost, nilai: nl });
          lay.qty -= amb;
          sisa -= amb;
          if (lay.qty === 0) s.layers.shift();
          else if (lay.qty < 0) ctx.layerNegatif++;
        }
        if (sisa > 0) {
          kurang = sisa;
          var hu = hargaJatuhTempo(k, sku);
          var nk = D.mul(sisa, hu);
          nilai += nk;
          dipakai.push({ kunci: '~defisit', srcId: null, srcDok: 'DEFISIT', tgl: null, qty: sisa, unitCost: hu, nilai: nk });
          sisa = 0;
        }
      } else {
        if (s.qty >= qty && s.qty > 0) {
          nilai = D.divRound(D.mul(s.nilai, qty), s.qty);
        } else {
          var tersedia = s.qty > 0 ? s.qty : 0;
          var nAda = tersedia > 0 ? s.nilai : 0;
          kurang = qty - tersedia;
          nilai = nAda + D.mul(kurang, hargaJatuhTempo(k, sku));
        }
        dipakai.push({ kunci: '~rata', srcId: null, srcDok: 'RATA-RATA', tgl: null, qty: qty, unitCost: qty ? D.divRound(nilai, qty) : 0, nilai: nilai });
      }
      s.qty -= qty;
      s.nilai -= nilai;
      if (kurang > 0) defisit.push({ kunci: k, qty: kurang, entryId: ctx.entryBerjalan });
      return { nilai: nilai, layers: dipakai, kurang: kurang };
    }

    function taruh(k, qty, unitCost, kunci, srcId, srcDok, tgl) {
      var s = get(k);
      var nilai = D.mul(qty, unitCost);
      s.qty += qty;
      s.nilai += nilai;
      if (fifo) sisipLayer(s.layers, { kunci: kunci, srcId: srcId, srcDok: srcDok, tgl: tgl, qty: qty, unitCost: unitCost });
      return nilai;
    }

    /* A retur penjualan restores value at the ORIGINAL cost of the units that
     * left, not at today's cost. Under FIFO that means re-creating the exact
     * layers the sale consumed, each with its original key so it re-enters the
     * queue where it was; under average it means giving back the same rupiah
     * per unit the sale was charged. The units returned are taken from the TAIL
     * of the original consumption — if a sale of 10 ate 4 from an old layer and
     * 6 from a newer one, returning 6 puts back the newer six. */
    function taruhKembali(k, qty, refHasil, unitFallback, kunciFallback, srcId, srcDok, tgl) {
      var nilai = 0, kembali = [];
      if (refHasil && refHasil.layers && refHasil.layers.length) {
        var sisa = qty;
        for (var i = refHasil.layers.length - 1; i >= 0 && sisa > 0; i--) {
          var lay = refHasil.layers[i];
          var amb = sisa < lay.qty ? sisa : lay.qty;
          var nl = fifo ? D.mul(amb, lay.unitCost) : D.divRound(D.mul(refHasil.nilai, amb), refHasil.qty);
          if (fifo) {
            nilai += nl;
            kembali.push({ kunci: lay.kunci, srcId: lay.srcId, srcDok: lay.srcDok, tgl: lay.tgl, qty: amb, unitCost: lay.unitCost, nilai: nl });
          } else {
            nilai += nl;
            kembali.push({ kunci: '~rata', srcId: null, srcDok: 'RATA-RATA', tgl: null, qty: amb, unitCost: D.divRound(nl, amb), nilai: nl });
          }
          sisa -= amb;
        }
        if (sisa > 0) {
          var nl2 = D.mul(sisa, unitFallback);
          nilai += nl2;
          kembali.push({ kunci: kunciFallback, srcId: srcId, srcDok: srcDok, tgl: tgl, qty: sisa, unitCost: unitFallback, nilai: nl2 });
        }
      } else {
        nilai = D.mul(qty, unitFallback);
        kembali.push({ kunci: kunciFallback, srcId: srcId, srcDok: srcDok, tgl: tgl, qty: qty, unitCost: unitFallback, nilai: nilai });
      }
      var s = get(k);
      s.qty += qty;
      s.nilai += nilai;
      if (fifo) {
        for (var j = 0; j < kembali.length; j++) {
          var kb = kembali[j];
          sisipLayer(s.layers, {
            kunci: kb.kunci === '~defisit' ? kunciFallback : kb.kunci,
            srcId: kb.srcId, srcDok: kb.srcDok, tgl: kb.tgl || tgl, qty: kb.qty, unitCost: kb.unitCost
          });
        }
      }
      return { nilai: nilai, layers: kembali };
    }

    for (var i = mulaiIdx; i < sorted.length; i++) {
      var e = sorted[i];
      var per = D.periodeOf(e.tgl);
      if (ctx.periodeBerjalan !== per) {
        snapshots.push({
          periode: per,
          idx: i,
          st: cloneSt(st),
          total: cloneTotal(total),
          lastHarga: cloneMap(lastHarga)
        });
        ctx.periodeBerjalan = per;
      }

      ctx.entryBerjalan = e.id;
      var k = kunciSaldo(e.sku, e.gudang);
      var kk = urutKunci(e);
      var r = null;

      if (e.jenis === 'terima' || e.jenis === 'saldo-awal') {
        var hb = e.harga === null ? hargaJatuhTempo(k, e.sku) : e.harga;
        var n = taruh(k, e.qty, hb, kk, e.id, e.dok, e.tgl);
        lastHarga[k] = hb; lastHarga[e.sku] = hb;
        r = { qty: e.qty, nilai: n, unit: hb, layers: [{ kunci: kk, srcId: e.id, srcDok: e.dok, tgl: e.tgl, qty: e.qty, unitCost: hb, nilai: n }], kurang: 0 };
        total.masuk += n; total.qtyMasuk += e.qty;
        if (e.jenis === 'saldo-awal') total.saldoAwal += n; else total.pembelian += n;

      } else if (e.jenis === 'jual' || e.jenis === 'retur-beli') {
        var a = ambil(k, e.qty, e.sku);
        r = { qty: e.qty, nilai: a.nilai, unit: e.qty ? D.divRound(a.nilai, e.qty) : 0, layers: a.layers, kurang: a.kurang };
        total.keluar += a.nilai; total.qtyKeluar += e.qty;
        if (e.jenis === 'jual') {
          total.hppJual += a.nilai;
          if (D.isInt(e.nilaiJual)) total.penjualanBruto += e.nilaiJual;
        } else total.returBeli += a.nilai;

      } else if (e.jenis === 'transfer-keluar') {
        var a2 = ambil(k, e.qty, e.sku);
        r = { qty: e.qty, nilai: a2.nilai, unit: e.qty ? D.divRound(a2.nilai, e.qty) : 0, layers: a2.layers, kurang: a2.kurang };
        total.keluar += a2.nilai; total.transferKeluar += a2.nilai; total.qtyKeluar += e.qty;

      } else if (e.jenis === 'transfer-masuk') {
        /* Value is CARRIED, never re-priced. The paired issue is guaranteed to
         * have been processed already: it shares the entry's date and holds a
         * strictly smaller seq, and (tgl, seq) is the processing order. */
        var src = e.pasangan ? hasil[e.pasangan] : null;
        if (!src) throw new Error('transfer masuk ' + e.id + ' tidak menemukan pasangan keluar ' + e.pasangan);
        var nilaiT = 0, lys = [];
        var sT = get(k);
        for (var t = 0; t < src.layers.length; t++) {
          var sl = src.layers[t];
          var uc = sl.unitCost;
          var nlT = D.mul(sl.qty, uc);
          nilaiT += nlT;
          lys.push({ kunci: sl.kunci === '~rata' || sl.kunci === '~defisit' ? kk : sl.kunci, srcId: sl.srcId || e.id, srcDok: sl.srcDok, tgl: sl.tgl || e.tgl, qty: sl.qty, unitCost: uc, nilai: nlT });
        }
        /* Under FIFO the per-layer sum IS src.nilai, exactly, because a FIFO
         * issue's value is the sum of qty x unitCost over the layers it ate.
         * Under average the source carries one blended figure whose rounding
         * does not survive being multiplied back out per layer, so the residue
         * is pushed onto the last reported layer and the value transferred
         * stays exactly the value issued — transfer masuk == transfer keluar is
         * an identity, not an approximation. */
        var selisihT = src.nilai - nilaiT;
        if (selisihT !== 0 && lys.length) lys[lys.length - 1].nilai += selisihT;
        sT.qty += e.qty;
        sT.nilai += src.nilai;
        if (fifo) for (var u = 0; u < lys.length; u++) sisipLayer(sT.layers, { kunci: lys[u].kunci, srcId: lys[u].srcId, srcDok: lys[u].srcDok, tgl: lys[u].tgl, qty: lys[u].qty, unitCost: lys[u].unitCost });
        r = { qty: e.qty, nilai: src.nilai, unit: e.qty ? D.divRound(src.nilai, e.qty) : 0, layers: lys, kurang: 0 };
        total.masuk += src.nilai; total.transferMasuk += src.nilai; total.qtyMasuk += e.qty;

      } else if (e.jenis === 'retur-jual') {
        var refH = e.ref ? hasil[e.ref] : null;
        var fb = hargaJatuhTempo(k, e.sku);
        var rk = taruhKembali(k, e.qty, refH, fb, kk, e.id, e.dok, e.tgl);
        r = { qty: e.qty, nilai: rk.nilai, unit: e.qty ? D.divRound(rk.nilai, e.qty) : 0, layers: rk.layers, kurang: 0 };
        total.masuk += rk.nilai; total.returJual += rk.nilai; total.qtyMasuk += e.qty;

      } else if (e.jenis === 'adjust') {
        if (e.arah > 0) {
          /* An opname surplus has no purchase document, so it has to be valued
           * at something. Current carrying cost of that SKU in that gudang is
           * the conservative choice: it neither creates profit nor destroys it,
           * and it is what PSAK 14's lower-of-cost rule points at. Where the bin
           * is empty the last known purchase price is used, and where even that
           * is unknown the product master price. */
          var hu2 = e.harga !== null ? e.harga : hargaJatuhTempo(k, e.sku);
          var n2 = taruh(k, e.qty, hu2, kk, e.id, e.dok, e.tgl);
          r = { qty: e.qty, nilai: n2, unit: hu2, layers: [{ kunci: kk, srcId: e.id, srcDok: e.dok, tgl: e.tgl, qty: e.qty, unitCost: hu2, nilai: n2 }], kurang: 0 };
          total.masuk += n2; total.adjMasuk += n2; total.qtyMasuk += e.qty;
        } else {
          var a3 = ambil(k, e.qty, e.sku);
          r = { qty: e.qty, nilai: a3.nilai, unit: e.qty ? D.divRound(a3.nilai, e.qty) : 0, layers: a3.layers, kurang: a3.kurang };
          total.keluar += a3.nilai; total.adjKeluar += a3.nilai; total.qtyKeluar += e.qty;
        }
      } else {
        throw new Error('jenis entry tidak dikenal: ' + e.jenis);
      }

      r.jenis = e.jenis;
      r.tgl = e.tgl;
      r.seq = e.seq;
      hasil[e.id] = r;
    }
  }

  /* Full replay from an empty book. */
  L.replay = function (entriesSorted, opts) {
    opts = opts || {};
    var metodeMinta = opts.metode || 'fifo';
    /* An unknown method must not fall through to the average branch. Silently
     * costing a book as average because somebody typed 'lifo' is exactly the
     * kind of quiet substitution this app exists to argue against. */
    if (metodeMinta !== 'fifo' && metodeMinta !== 'rata') {
      throw new Error('metode penilaian tidak dikenal: ' + metodeMinta + ' (hanya fifo dan rata)');
    }
    var ctx = {
      metode: metodeMinta,
      st: {}, hasil: {}, total: totalKosong(), lastHarga: {},
      defisit: [], snapshots: [], periodeBerjalan: null,
      urutSalah: 0, layerNegatif: 0, entryBerjalan: null
    };
    jalankan(entriesSorted, 0, ctx, opts);
    return bungkus(ctx, entriesSorted, opts);
  };

  function bungkus(ctx, sorted, opts) {
    var akhirNilai = 0, akhirQty = 0, k;
    for (k in ctx.st) {
      if (!Object.prototype.hasOwnProperty.call(ctx.st, k)) continue;
      akhirNilai += ctx.st[k].nilai;
      akhirQty += ctx.st[k].qty;
    }
    return {
      metode: ctx.metode,
      st: ctx.st,
      hasil: ctx.hasil,
      total: ctx.total,
      lastHarga: ctx.lastHarga,
      defisit: ctx.defisit,
      snapshots: ctx.snapshots,
      urutSalah: ctx.urutSalah,
      layerNegatif: ctx.layerNegatif,
      akhir: { nilai: akhirNilai, qty: akhirQty },
      jumlahEntry: sorted.length
    };
  }

  /* Incremental replay. Reuses per-document results computed strictly before
   * the newest period boundary at or before `dariTgl`, then folds the rest.
   * The tests compare this against a full replay entry by entry; if the two
   * ever disagree the incremental path is wrong and the full one wins. */
  L.hitungUlangDari = function (sebelumnya, entriesSorted, dariTgl, opts) {
    opts = opts || {};
    var metode = opts.metode || 'fifo';
    if (!sebelumnya || sebelumnya.metode !== metode || !sebelumnya.snapshots.length) {
      return { hasil: L.replay(entriesSorted, opts), dariSnapshot: null, entriDipakaiUlang: 0 };
    }
    var per = D.periodeOf(dariTgl);
    var snap = null;
    for (var i = 0; i < sebelumnya.snapshots.length; i++) {
      var s = sebelumnya.snapshots[i];
      if (s.periode <= per) snap = s; else break;
    }
    if (!snap) return { hasil: L.replay(entriesSorted, opts), dariSnapshot: null, entriDipakaiUlang: 0 };

    /* The snapshot was taken immediately before the first entry of its period.
     * Its index is recomputed against the CURRENT array by counting entries in
     * earlier periods, so an insertion that shifted indices cannot desync it. */
    var mulaiIdx = 0;
    while (mulaiIdx < entriesSorted.length && D.periodeOf(entriesSorted[mulaiIdx].tgl) < snap.periode) mulaiIdx++;

    var hasil = {};
    for (var j = 0; j < mulaiIdx; j++) {
      var e = entriesSorted[j];
      if (sebelumnya.hasil[e.id]) hasil[e.id] = sebelumnya.hasil[e.id];
    }
    var ctx = {
      metode: metode,
      st: cloneSt(snap.st),
      hasil: hasil,
      total: cloneTotal(snap.total),
      lastHarga: cloneMap(snap.lastHarga),
      defisit: [], snapshots: [], periodeBerjalan: D.periodeSebelum(snap.periode),
      urutSalah: 0, layerNegatif: 0, entryBerjalan: null
    };
    jalankan(entriesSorted, mulaiIdx, ctx, opts);
    var out = bungkus(ctx, entriesSorted, opts);
    /* Snapshots before the boundary are still valid; keep them so a second
     * backdated insert into an even earlier period still has somewhere to
     * start from. */
    var awal = sebelumnya.snapshots.filter(function (x) { return x.periode < snap.periode; });
    out.snapshots = awal.concat(out.snapshots);
    return { hasil: out, dariSnapshot: snap.periode, entriDipakaiUlang: mulaiIdx };
  };

  /* ------------------------------------------------------- konservasi */

  L.konservasi = function (hasil) {
    var t = hasil.total;
    var kiri = t.saldoAwal + t.pembelian + t.returJual + t.adjMasuk + t.transferMasuk
      - t.returBeli - t.hppJual - t.adjKeluar - t.transferKeluar;
    return {
      saldoAwal: t.saldoAwal,
      pembelian: t.pembelian,
      returJual: t.returJual,
      adjMasuk: t.adjMasuk,
      transferMasuk: t.transferMasuk,
      returBeli: t.returBeli,
      hppJual: t.hppJual,
      adjKeluar: t.adjKeluar,
      transferKeluar: t.transferKeluar,
      totalMasuk: t.masuk,
      totalKeluar: t.keluar,
      persediaanAkhir: hasil.akhir.nilai,
      kiri: kiri,
      selisih: kiri - hasil.akhir.nilai,
      transferSeimbang: t.transferMasuk === t.transferKeluar,
      seimbang: (kiri - hasil.akhir.nilai) === 0 && t.transferMasuk === t.transferKeluar
    };
  };

  /* ------------------------------------------------------- kartu stok */

  /* The stock card. Rows carry saldo awal and saldo akhir explicitly so the
   * invariant is visible on the screen the user is looking at, not just in the
   * test suite: awal + masuk - keluar = akhir, line by line. */
  L.kartuStok = function (entriesSorted, hasil, sku, gudang, dariTgl, sampaiTgl) {
    var baris = [], qty = 0, nilai = 0, awalQty = 0, awalNilai = 0, mulai = false;
    for (var i = 0; i < entriesSorted.length; i++) {
      var e = entriesSorted[i];
      if (e.sku !== sku) continue;
      if (gudang && e.gudang !== gudang) continue;
      if (sampaiTgl && e.tgl > sampaiTgl) break;
      var h = hasil.hasil[e.id];
      var nEntry = h ? h.nilai : 0;
      if (dariTgl && e.tgl < dariTgl) {
        qty += e.arah * e.qty;
        nilai += e.arah * nEntry;
        awalQty = qty; awalNilai = nilai;
        continue;
      }
      if (!mulai) { mulai = true; awalQty = qty; awalNilai = nilai; }
      var sebelumQty = qty, sebelumNilai = nilai;
      qty += e.arah * e.qty;
      nilai += e.arah * nEntry;
      baris.push({
        entry: e,
        hasilEntry: h,
        awalQty: sebelumQty, awalNilai: sebelumNilai,
        masukQty: e.arah > 0 ? e.qty : 0, masukNilai: e.arah > 0 ? nEntry : 0,
        keluarQty: e.arah < 0 ? e.qty : 0, keluarNilai: e.arah < 0 ? nEntry : 0,
        akhirQty: qty, akhirNilai: nilai,
        unit: h ? h.unit : 0
      });
    }
    return {
      sku: sku, gudang: gudang || 'semua',
      awal: { qty: awalQty, nilai: awalNilai },
      baris: baris,
      akhir: { qty: qty, nilai: nilai }
    };
  };

  /* ------------------------------------------------- posisi persediaan */

  L.posisi = function (hasil) {
    var out = [], k;
    for (k in hasil.st) {
      if (!Object.prototype.hasOwnProperty.call(hasil.st, k)) continue;
      var p = k.split('|');
      var s = hasil.st[k];
      if (s.qty === 0 && s.nilai === 0) continue;
      out.push({
        sku: p[0], gudang: p[1], qty: s.qty, nilai: s.nilai,
        unit: s.qty ? D.divRound(s.nilai, s.qty) : 0,
        layers: s.layers
      });
    }
    out.sort(function (a, b) { return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : (a.gudang < b.gudang ? -1 : 1); });
    return out;
  };

  L.posisiSku = function (hasil, sku) {
    var qty = 0, nilai = 0, per = {};
    for (var k in hasil.st) {
      if (!Object.prototype.hasOwnProperty.call(hasil.st, k)) continue;
      var p = k.split('|');
      if (p[0] !== sku) continue;
      qty += hasil.st[k].qty;
      nilai += hasil.st[k].nilai;
      per[p[1]] = { qty: hasil.st[k].qty, nilai: hasil.st[k].nilai };
    }
    return { qty: qty, nilai: nilai, unit: qty ? D.divRound(nilai, qty) : 0, perGudang: per };
  };

  /* ------------------------------------------------------ backdating */

  /* The refusal rules, in one place, because "why can I not post this" has to
   * have exactly one answer.
   *   1. A closed period is closed. Reopening is a supervisor action with its
   *      own audit trail, not something a posting screen does quietly.
   *   2. A backdated ISSUE that would drive stock negative at ANY later date is
   *      refused. Checking only the posting date is the classic mistake: the
   *      stock was there last Tuesday, it is not there now, and the recompute
   *      would quietly cost the difference at a made-up price.
   *   3. Non-integer or non-positive quantity never reaches the ledger. */
  L.periksaPosting = function (buku, calon, opsi) {
    opsi = opsi || {};
    var alasan = [], peringatan = [];
    var per = D.periodeOf(calon.tgl);
    if (buku.tutup[per]) {
      alasan.push('Periode ' + D.periodeLabel(per) + ' sudah ditutup. Dokumen bertanggal di dalamnya tidak bisa diposting ' +
        'karena HPP periode itu sudah dilaporkan; supervisor harus membuka periodenya lebih dulu.');
    }
    if (!D.isInt(calon.qty) || calon.qty <= 0) {
      alasan.push('Kuantitas harus bilangan bulat positif dalam satuan dasar.');
    }
    if (calon.harga !== null && calon.harga !== undefined && (!D.isInt(calon.harga) || calon.harga < 0)) {
      alasan.push('Harga harus bilangan bulat rupiah dan tidak negatif.');
    }
    var hariIni = opsi.hariIni || null;
    var mundur = hariIni && calon.tgl < hariIni;
    if (mundur) {
      var izin = D.izin(opsi.peran || 'supervisor', 'mundur.posting');
      if (!izin.ok) alasan.push(izin.alasan);
      peringatan.push('Dokumen bertanggal mundur: HPP setiap dokumen setelah ' + D.tglPanjang(calon.tgl) +
        ' akan dihitung ulang.');
    }
    if (calon.arah < 0) {
      var uji = buku.entries.concat([{
        id: '~calon', seq: buku.seqBerikut, tgl: calon.tgl, sku: calon.sku, gudang: calon.gudang,
        arah: -1, qty: calon.qty, jenis: calon.jenis
      }]);
      var min = L.saldoMinimumSejak(uji, calon.sku, calon.gudang, calon.tgl);
      if (min < 0) {
        alasan.push('Pengeluaran ini membuat saldo ' + calon.sku + ' di ' + calon.gudang +
          ' menjadi ' + min + ' pada suatu titik setelah ' + D.tglPanjang(calon.tgl) +
          '. Stok tidak boleh negatif: yang tampak cukup hari itu sudah terjual sesudahnya.');
      }
    }
    return { ok: alasan.length === 0, alasan: alasan, peringatan: peringatan, mundur: !!mundur };
  };

  /* Where does a backdated purchase actually MATTER?
   *
   * Under average costing, anywhere: a new receipt moves the average and every
   * later issue is revalued. Under FIFO it only matters where the layer queue
   * would have drained past the insertion point — if the bin never ran low, the
   * new layer sits behind the old ones and nothing downstream changes, which is
   * correct FIFO and a boring demo. This ranks (SKU, gudang) pairs by how much
   * stock left AFTER a candidate date on a line that touched zero, so the
   * backdating screen opens on a case where both methods visibly move.
   */
  L.saranSkenarioMundur = function (entriesSorted, dariTgl) {
    var run = {}, min = {}, keluar = {}, gudang = {}, i;
    for (i = 0; i < entriesSorted.length; i++) {
      var e = entriesSorted[i];
      if (e.gudang === TRANSIT) continue;
      var k = kunciSaldo(e.sku, e.gudang);
      run[k] = (run[k] || 0) + e.arah * e.qty;
      if (e.tgl < dariTgl) continue;
      if (min[k] === undefined || run[k] < min[k]) min[k] = run[k];
      if (e.arah < 0 && (e.jenis === 'jual' || e.jenis === 'transfer-keluar')) keluar[k] = (keluar[k] || 0) + e.qty;
      gudang[k] = e.gudang;
    }
    var out = [];
    for (var kk in min) {
      if (!Object.prototype.hasOwnProperty.call(min, kk)) continue;
      if (!keluar[kk]) continue;
      var p = kk.split('|');
      out.push({ sku: p[0], gudang: p[1], minSaldo: min[kk], keluarSetelah: keluar[kk], saldoAkhir: run[kk], habis: min[kk] <= 0 });
    }
    out.sort(function (a, b) {
      if (a.habis !== b.habis) return a.habis ? -1 : 1;
      return b.keluarSetelah - a.keluarSetelah;
    });
    return out;
  };

  /* Diff two costing runs at document granularity. This is what the backdating
   * screen shows: which documents changed, by how much, and — as evidence that
   * the recomputation is local rather than a wholesale re-guess — that nothing
   * before the insertion point moved at all. */
  L.bandingkan = function (sebelum, sesudah, batasKunci) {
    var berubah = [], baru = [], sebelumBatas = 0, id;
    for (id in sesudah.hasil) {
      if (!Object.prototype.hasOwnProperty.call(sesudah.hasil, id)) continue;
      var b = sebelum.hasil[id], a = sesudah.hasil[id];
      if (!b) { baru.push({ id: id, sesudah: a }); continue; }
      if (b.nilai !== a.nilai || b.unit !== a.unit) {
        var kb = layerKunci(a.tgl, a.seq);
        if (batasKunci && kb < batasKunci) sebelumBatas++;
        berubah.push({
          id: id, tgl: a.tgl, seq: a.seq, jenis: a.jenis, qty: a.qty,
          nilaiSebelum: b.nilai, nilaiSesudah: a.nilai,
          unitSebelum: b.unit, unitSesudah: a.unit,
          delta: a.nilai - b.nilai
        });
      }
    }
    berubah.sort(function (x, y) { return x.tgl < y.tgl ? -1 : x.tgl > y.tgl ? 1 : x.seq - y.seq; });
    var deltaTotal = 0;
    for (var i = 0; i < berubah.length; i++) deltaTotal += berubah[i].delta;
    return {
      berubah: berubah, baru: baru, jumlah: berubah.length,
      deltaTotal: deltaTotal,
      berubahSebelumBatas: sebelumBatas,
      hppSebelum: sebelum.total.hppJual, hppSesudah: sesudah.total.hppJual,
      akhirSebelum: sebelum.akhir.nilai, akhirSesudah: sesudah.akhir.nilai
    };
  };

  /* --------------------------------------------------------- textbook */

  /* The literal formula from every Indonesian accounting textbook, kept as its
   * own function so a test can hand-check the engine against it rather than
   * against a restatement of the engine. */
  L.rataTextbook = function (qtyLama, hppLama, qtyMasuk, hargaMasuk) {
    var atas = D.mul(qtyLama, hppLama) + D.mul(qtyMasuk, hargaMasuk);
    var bawah = qtyLama + qtyMasuk;
    if (bawah === 0) return 0;
    return D.divRound(atas, bawah);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
