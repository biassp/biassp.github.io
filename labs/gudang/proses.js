/*!
 * Gudang — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Gudang — proses.js
 * The business processes that sit on top of the ledger: purchasing and the
 * three-way match, transfers with an in-transit leg, stock opname, and the
 * cashier's arithmetic. Everything here ends by asking ledger.js to append
 * entries; nothing here computes a cost or mutates a balance.
 *
 * Two ideas are load-bearing:
 *
 * 1. A TRANSFER IS TWO SHIPMENTS, NOT ONE MOVE. Goods that have left gudang A
 *    and have not arrived at gudang B are not nowhere; they are in a warehouse
 *    called TRANSIT which is a first-class location in the ledger. So the send
 *    posts an issue from A and a receipt into TRANSIT on the same date, and the
 *    arrival posts an issue from TRANSIT and a receipt into B. In-transit stock
 *    is therefore counted exactly once, is visible on a report, and carries its
 *    cost across untouched — the receiving leg takes the value the issuing leg
 *    computed rather than re-pricing at destination.
 *
 * 2. AN OPNAME IS A FROZEN SHEET, NOT A LIVE COMPARISON. The book quantity on
 *    the sheet is captured at the moment the sheet is opened (by ledger seq, not
 *    by date, so a document backdated afterwards is still post-count) and never
 *    moves again. Anything posted while people are walking the aisles is a
 *    post-count movement: it is listed separately and it is NOT part of the
 *    variance. Posting appends a penyesuaian ENTRY of exactly (fisik - buku beku)
 *    to the ledger. It never writes a balance. Sold-during-the-count stock is
 *    therefore not double-counted, which is the mistake that makes people stop
 *    trusting opname results.
 */
(function (root) {
  'use strict';

  var D = root.GUDANG_DOMAIN;
  var L = root.GUDANG_LEDGER;
  var P = {};
  root.GUDANG_PROSES = P;

  /* ============================================================ KASIR == */

  /* Line amount in whole rupiah. Discount is an absolute rupiah figure, not a
   * percentage, because a percentage of an odd price is a float and a float is
   * how a receipt ends up one rupiah away from the sum of its own lines. Where
   * a percentage is wanted the caller rounds it once, here, and stores the
   * rupiah. */
  P.jumlahBaris = function (baris) {
    var kotor = D.mul(baris.qty, baris.harga);
    var pot = D.isInt(baris.diskon) ? baris.diskon : 0;
    return kotor - pot;
  };

  /* Document totals. PPN is rounded ONCE, on the document, never per line.
   *
   * inklusif = true  : the prices on the shelf already contain PPN. The total is
   *                    the sum of the lines; DPP is backed out of it and PPN is
   *                    the remainder, so dpp + ppn is exactly the printed total.
   * inklusif = false : the prices are pre-tax. PPN is added on top.
   *
   * Getting these two the wrong way round is the single most common bug in an
   * Indonesian POS, and it is invisible until a customer adds up the receipt. */
  P.totalKeranjang = function (baris, opsi) {
    opsi = opsi || {};
    var sub = 0, i;
    var rows = [];
    for (i = 0; i < baris.length; i++) {
      var j = P.jumlahBaris(baris[i]);
      sub += j;
      rows.push({ baris: baris[i], jumlah: j });
    }
    var pot = D.isInt(opsi.diskonNota) ? opsi.diskonNota : 0;
    var dasar = sub - pot;
    var pjk = D.hitungPpn(dasar, !!opsi.ppnInklusif);
    return {
      baris: rows,
      subtotal: sub,
      diskonNota: pot,
      dasar: dasar,
      dpp: pjk.dpp,
      ppn: pjk.ppn,
      total: pjk.total,
      ppnInklusif: !!opsi.ppnInklusif
    };
  };

  /* Split payment. Non-cash instruments cannot give change: a QRIS or transfer
   * leg is authorised for an exact figure, so overpaying by card and handing
   * back cash is a till shortage waiting to happen. Change comes out of the cash
   * leg only, and the function refuses a non-cash total that exceeds the bill. */
  P.hitungBayar = function (total, bayar) {
    var tunai = 0, nonTunai = 0, i;
    for (i = 0; i < bayar.length; i++) {
      var b = bayar[i];
      if (!D.isInt(b.jumlah) || b.jumlah < 0) return { ok: false, alasan: 'Nominal pembayaran harus bilangan bulat rupiah.' };
      if (b.jenis === 'tunai') tunai += b.jumlah; else nonTunai += b.jumlah;
    }
    var dibayar = tunai + nonTunai;
    if (nonTunai > total) {
      return {
        ok: false, tunai: tunai, nonTunai: nonTunai, dibayar: dibayar, kembali: 0,
        kurang: 0,
        alasan: 'Pembayaran nontunai (' + D.rupiah(nonTunai) + ') melebihi total ' + D.rupiah(total) +
          '. Kembalian tidak boleh diberikan atas transfer atau QRIS.'
      };
    }
    var kembali = dibayar - total;
    if (kembali < 0) {
      return {
        ok: false, tunai: tunai, nonTunai: nonTunai, dibayar: dibayar, kembali: 0, kurang: -kembali,
        alasan: 'Pembayaran kurang ' + D.rupiah(-kembali) + '.'
      };
    }
    return { ok: true, tunai: tunai, nonTunai: nonTunai, dibayar: dibayar, kembali: kembali, kurang: 0, alasan: '' };
  };

  /* ======================================================== PEMBELIAN == */

  /* Three-way match: PO vs penerimaan vs faktur, per SKU, in base units and
   * whole rupiah. Discrepancies are FLAGGED, never absorbed. An inventory
   * system that quietly accepts an invoice priced above the PO is a system that
   * pays whatever it is billed.
   *
   * Toleransi: quantity must match exactly. Price is compared per base unit,
   * with a tolerance of nol rupiah — a supplier who raises a price mid-order has
   * to be told, not rounded away. Over-receipt (more delivered than ordered) is
   * its own flag because it is a real and different problem from over-billing. */
  P.cocokTigaArah = function (po, terimaList, faktur) {
    var perSku = {}, i, j;
    function get(sku) {
      if (!perSku[sku]) perSku[sku] = { sku: sku, qtyPo: 0, hargaPo: null, qtyTerima: 0, qtyFaktur: 0, hargaFaktur: null, nilaiTerima: 0 };
      return perSku[sku];
    }
    for (i = 0; i < po.baris.length; i++) {
      var b = po.baris[i], g = get(b.sku);
      g.qtyPo += b.qtyBase;
      g.hargaPo = b.hargaBase;
    }
    for (i = 0; i < terimaList.length; i++) {
      for (j = 0; j < terimaList[i].baris.length; j++) {
        var t = terimaList[i].baris[j], g2 = get(t.sku);
        g2.qtyTerima += t.qtyBase;
        g2.nilaiTerima += D.mul(t.qtyBase, t.hargaBase);
      }
    }
    if (faktur) {
      for (i = 0; i < faktur.baris.length; i++) {
        var f = faktur.baris[i], g3 = get(f.sku);
        g3.qtyFaktur += f.qtyBase;
        g3.hargaFaktur = f.hargaBase;
      }
    }
    var baris = [], flags = {}, adaMasalah = false;
    for (var sku in perSku) {
      if (!Object.prototype.hasOwnProperty.call(perSku, sku)) continue;
      var r = perSku[sku], f2 = [];
      if (r.qtyTerima > r.qtyPo) { f2.push('over-terima'); flags['over-terima'] = 1; }
      if (r.qtyTerima < r.qtyPo) { f2.push('kurang-terima'); flags['kurang-terima'] = 1; }
      if (faktur) {
        if (r.qtyFaktur !== r.qtyTerima) { f2.push('selisih-qty'); flags['selisih-qty'] = 1; }
        if (r.hargaFaktur !== null && r.hargaPo !== null && r.hargaFaktur !== r.hargaPo) { f2.push('selisih-harga'); flags['selisih-harga'] = 1; }
      }
      r.flags = f2;
      r.selisihQty = r.qtyFaktur - r.qtyTerima;
      r.selisihHargaUnit = (r.hargaFaktur === null || r.hargaPo === null) ? 0 : r.hargaFaktur - r.hargaPo;
      r.nilaiFaktur = r.hargaFaktur === null ? 0 : D.mul(r.qtyFaktur, r.hargaFaktur);
      r.nilaiPo = D.mul(r.qtyPo, r.hargaPo || 0);
      r.dampakRupiah = r.nilaiFaktur - r.nilaiTerima;
      if (f2.length) adaMasalah = true;
      baris.push(r);
    }
    baris.sort(function (a, b) { return a.sku < b.sku ? -1 : 1; });
    var dampak = 0;
    for (i = 0; i < baris.length; i++) if (faktur) dampak += baris[i].dampakRupiah;
    /* "kurang-terima" alone is a partial delivery, which is normal and not a
     * mismatch — the PO simply stays open. It only becomes a finding once an
     * invoice arrives billing for goods that never came. */
    var hanyaParsial = !flags['over-terima'] && !flags['selisih-qty'] && !flags['selisih-harga'];
    return {
      baris: baris,
      flags: Object.keys(flags),
      adaMasalah: adaMasalah,
      status: !faktur ? (hanyaParsial && flags['kurang-terima'] ? 'parsial' : 'menunggu-faktur')
        : (flags['selisih-qty'] || flags['selisih-harga'] || flags['over-terima']) ? 'selisih' : 'cocok',
      dampakRupiah: dampak,
      punyaFaktur: !!faktur
    };
  };

  P.statusPo = function (po, terimaList) {
    var pesan = 0, terima = 0, i, j;
    for (i = 0; i < po.baris.length; i++) pesan += po.baris[i].qtyBase;
    for (i = 0; i < terimaList.length; i++) for (j = 0; j < terimaList[i].baris.length; j++) terima += terimaList[i].baris[j].qtyBase;
    if (terima === 0) return { kode: 'terbuka', label: 'Belum diterima', pesan: pesan, terima: terima };
    if (terima < pesan) return { kode: 'parsial', label: 'Diterima sebagian', pesan: pesan, terima: terima };
    if (terima === pesan) return { kode: 'penuh', label: 'Diterima penuh', pesan: pesan, terima: terima };
    return { kode: 'lebih', label: 'Diterima melebihi PO', pesan: pesan, terima: terima };
  };

  /* ========================================================= TRANSFER == */

  /* Send leg: issue from asal, receipt into TRANSIT, same date, paired. The
   * receipt is created second on purpose — its seq is larger, so the costing
   * fold always sees the issue first and can hand it the value it computed. */
  P.kirimTransfer = function (buku, tr) {
    var out = [];
    for (var i = 0; i < tr.baris.length; i++) {
      var b = tr.baris[i];
      var keluar = L.tambah(buku, {
        tgl: tr.tglKirim, sku: b.sku, gudang: tr.dariGudang, arah: -1, qty: b.qtyBase,
        jenis: 'transfer-keluar', dok: tr.id, catatan: 'kirim ke ' + tr.keGudang
      });
      var masuk = L.tambah(buku, {
        tgl: tr.tglKirim, sku: b.sku, gudang: D.TRANSIT, arah: 1, qty: b.qtyBase,
        jenis: 'transfer-masuk', dok: tr.id, pasangan: keluar.id, catatan: 'dalam perjalanan ' + tr.dariGudang + ' → ' + tr.keGudang
      });
      b.entryKeluar = keluar.id;
      b.entryTransit = masuk.id;
      out.push(keluar, masuk);
    }
    tr.status = 'jalan';
    return out;
  };

  P.terimaTransfer = function (buku, tr, tglTerima) {
    var out = [];
    for (var i = 0; i < tr.baris.length; i++) {
      var b = tr.baris[i];
      var keluar = L.tambah(buku, {
        tgl: tglTerima, sku: b.sku, gudang: D.TRANSIT, arah: -1, qty: b.qtyBase,
        jenis: 'transfer-keluar', dok: tr.id, catatan: 'tiba di ' + tr.keGudang
      });
      var masuk = L.tambah(buku, {
        tgl: tglTerima, sku: b.sku, gudang: tr.keGudang, arah: 1, qty: b.qtyBase,
        jenis: 'transfer-masuk', dok: tr.id, pasangan: keluar.id, catatan: 'dari ' + tr.dariGudang
      });
      b.entryTransitKeluar = keluar.id;
      b.entryMasuk = masuk.id;
      out.push(keluar, masuk);
    }
    tr.status = 'tiba';
    tr.tglTerima = tglTerima;
    return out;
  };

  /* =========================================================== OPNAME == */

  /* Freeze by ledger SEQUENCE, not by date. Seq is the moment a document
   * entered the book; date is what the document claims. A purchase backdated
   * into the count window after the sheet was opened is still a post-count
   * event for the person holding the clipboard, and freezing on date would have
   * silently folded it into the variance. */
  P.bukaOpname = function (buku, opname, hasil, produkList) {
    opname.bekuSeq = buku.seqBerikut - 1;
    opname.status = 'terbuka';
    var saldo = {}, i;
    for (i = 0; i < buku.entries.length; i++) {
      var e = buku.entries[i];
      if (e.seq > opname.bekuSeq) continue;
      if (e.gudang !== opname.gudang) continue;
      saldo[e.sku] = (saldo[e.sku] || 0) + e.arah * e.qty;
    }
    opname.baris = [];
    for (i = 0; i < produkList.length; i++) {
      var sku = produkList[i];
      opname.baris.push({ sku: sku, bukuQty: saldo[sku] || 0, fisikQty: null, alasan: null });
    }
    return opname;
  };

  /* Movements that landed AFTER the sheet was frozen. They are not variance and
   * they are not ignored — they are the reason the shelf count and today's book
   * figure legitimately differ. */
  P.gerakanPascaHitung = function (buku, opname) {
    var out = {};
    for (var i = 0; i < buku.entries.length; i++) {
      var e = buku.entries[i];
      if (e.seq <= opname.bekuSeq) continue;
      if (e.gudang !== opname.gudang) continue;
      if (e.opname === opname.id) continue;      // the adjustment itself
      out[e.sku] = (out[e.sku] || 0) + e.arah * e.qty;
    }
    return out;
  };

  P.variansOpname = function (buku, opname) {
    var pasca = P.gerakanPascaHitung(buku, opname);
    var baris = [], ringkas = { dihitung: 0, selisih: 0, lebih: 0, kurang: 0, qtyLebih: 0, qtyKurang: 0 };
    for (var i = 0; i < opname.baris.length; i++) {
      var b = opname.baris[i];
      var v = b.fisikQty === null ? null : (b.fisikQty - b.bukuQty);
      var pc = pasca[b.sku] || 0;
      baris.push({
        sku: b.sku, bukuQty: b.bukuQty, fisikQty: b.fisikQty, varians: v,
        alasan: b.alasan, pascaHitung: pc,
        saldoSetelahPosting: b.fisikQty === null ? null : b.fisikQty + pc
      });
      if (b.fisikQty !== null) {
        ringkas.dihitung++;
        if (v !== 0) {
          ringkas.selisih++;
          if (v > 0) { ringkas.lebih++; ringkas.qtyLebih += v; }
          else { ringkas.kurang++; ringkas.qtyKurang += -v; }
        }
      }
    }
    return { baris: baris, ringkas: ringkas };
  };

  /* Posting NEVER writes a balance. It appends one penyesuaian entry per line
   * with a non-zero variance, of exactly (fisik - buku beku) base units, dated
   * on the count date and carrying the reason code. The resulting balance is
   * whatever the ledger folds to — which is fisik plus any post-count movement,
   * and the tests check that specific arithmetic. */
  P.postingOpname = function (buku, opname, opsi) {
    opsi = opsi || {};
    var izin = D.izin(opsi.peran || 'supervisor', 'opname.posting');
    if (!izin.ok) return { ok: false, alasan: [izin.alasan], entries: [] };
    if (opname.status === 'diposting') return { ok: false, alasan: ['Opname ' + opname.id + ' sudah diposting.'], entries: [] };
    var tgl = opsi.tgl || opname.tglMulai;
    var alasan = [], calon = [], i;
    for (i = 0; i < opname.baris.length; i++) {
      var b = opname.baris[i];
      if (b.fisikQty === null) continue;
      var v = b.fisikQty - b.bukuQty;
      if (v === 0) continue;
      if (!b.alasan) { alasan.push('Baris ' + b.sku + ' punya selisih ' + v + ' tanpa kode alasan. Selisih tanpa sebab tidak boleh diposting.'); continue; }
      calon.push({ sku: b.sku, arah: v > 0 ? 1 : -1, qty: Math.abs(v), alasan: b.alasan });
    }
    for (i = 0; i < calon.length; i++) {
      var c = calon[i];
      var cek = L.periksaPosting(buku, {
        tgl: tgl, sku: c.sku, gudang: opname.gudang, arah: c.arah, qty: c.qty, jenis: 'adjust', harga: null
      }, { peran: opsi.peran, hariIni: opsi.hariIni });
      if (!cek.ok) alasan = alasan.concat(cek.alasan.map(function (a) { return c.sku + ': ' + a; }));
    }
    if (alasan.length) return { ok: false, alasan: alasan, entries: [] };
    var entries = [];
    for (i = 0; i < calon.length; i++) {
      var c2 = calon[i];
      entries.push(L.tambah(buku, {
        tgl: tgl, sku: c2.sku, gudang: opname.gudang, arah: c2.arah, qty: c2.qty,
        jenis: 'adjust', dok: opname.id, alasan: c2.alasan, opname: opname.id,
        catatan: 'penyesuaian hasil opname'
      }));
    }
    opname.status = 'diposting';
    opname.tglPosting = tgl;
    opname.olehPosting = opsi.oleh || 'supervisor';
    opname.entries = entries.map(function (e) { return e.id; });
    return { ok: true, alasan: [], entries: entries };
  };

  /* ============================================================ RETUR == */

  /* A retur penjualan points at the ORIGINAL sale entry. The ledger uses that
   * reference at costing time to give back the exact cost the units left at —
   * and, because the reference is to a document rather than to a frozen number,
   * a later backdated purchase that changes the sale's cost changes the retur's
   * cost with it. Restoring at "today's cost" instead would book a profit or a
   * loss on a transaction that was cancelled. */
  P.returPenjualan = function (buku, jual, baris, tgl, dok) {
    var entries = [];
    for (var i = 0; i < baris.length; i++) {
      var b = baris[i];
      entries.push(L.tambah(buku, {
        tgl: tgl, sku: b.sku, gudang: jual.gudang, arah: 1, qty: b.qtyBase,
        jenis: 'retur-jual', dok: dok, ref: b.refEntry,
        nilaiJual: D.isInt(b.nilaiJual) ? b.nilaiJual : null,
        catatan: 'retur atas ' + jual.id
      }));
    }
    return entries;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
