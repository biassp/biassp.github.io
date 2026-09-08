/*!
 * Buku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Buku — ledger.js
 * The book, and every figure derived from it.
 *
 * ONE DESIGN DECISION EXPLAINS THIS WHOLE FILE: nothing is stored except
 * journal entries. There is no account-balance field, no cached trial balance,
 * no running total kept up to date on posting. A balance is a function of the
 * postings, computed on demand, every time. That is invariant I7, and it is the
 * reason the other six can be trusted: there is no second copy of the truth to
 * drift away from the first.
 *
 * The consequences are worth being explicit about, because they are what makes
 * an accounting demo either honest or theatre:
 *
 *   I1  sum(debit) === sum(kredit) is enforced in tambah(), which THROWS with
 *       the imbalance in the message. There is no code path into buku.entries
 *       that does not go through tambah(). An unbalanced entry cannot exist.
 *
 *   I2  Because every entry balances, the trial balance balances — but
 *       neracaSaldo() does not assume that, it sums the two columns from raw
 *       postings and reports them, so a bug would show as a real difference
 *       rather than as a zero someone hard-coded.
 *
 *   I3  Aset = Liabilitas + Ekuitas at EVERY date. Reported equity is
 *       (equity accounts) + (revenue − expense), which is what a balance sheet
 *       actually shows and is why the identity holds before closing as well as
 *       after it. periksaBuku() walks the book date by date.
 *
 *   I4  Net income appears in three statements and is computed ONCE, by
 *       labaRugi(). perubahanEkuitas() and neraca() consume that figure; they do
 *       not recompute it their own way and hope. The assertion then re-derives
 *       it a fourth way — from the change in reported equity — and compares.
 *
 *   I5  jurnalPenutup() builds the closing entries from live balances, so
 *       re-running it on a closed book produces nothing at all. After closing,
 *       every nominal account is zero and the balance sheet is unchanged to the
 *       rupiah, because closing only moves amounts within equity + nominal.
 *
 *   I6  THE CASH FLOW STATEMENT DOES NOT USE A PLUG FIGURE. It is derived from
 *       an algebraic identity instead: every entry balances, so over any set of
 *       whole entries the debits net to zero across all accounts, which means
 *
 *           Δkas  =  −Σ (debit − kredit) over every NON-cash account
 *
 *       exactly. Partition the non-cash accounts into operating / investing /
 *       financing and the three subtotals must add to Δkas with nothing left
 *       over. Group the operating bucket by nominal / depreciation / working
 *       capital and the indirect method drops out of the algebra:
 *
 *           operasi = laba neto + penyusutan + Σ (kredit − debit) modal kerja
 *
 *       See arusKas(). The reconciliation against the actual cash account
 *       balance is then a genuine check, not a tautology, because the cash
 *       balance is computed by a completely separate summation.
 *
 *   I7  Balances derived, never stored. See above.
 */
(function (root) {
  'use strict';

  var D = root.BUKU_DOMAIN;
  var L = {};
  root.BUKU_LEDGER = L;

  /* =================================================== buku dan penomoran */

  L.LEBAR_NOMOR = 4;

  L.buatBuku = function () {
    return {
      entries: [],
      seqBerikut: 1,
      nomorBerikut: {},   // prefix -> next integer
      tutup: {},          // 'YYYY-MM' -> { oleh, peran, at, catatan }
      indexId: {}         // id -> entry, for ref lookups; a cache of entries, not of numbers
    };
  };

  L.nomorDok = function (buku, prefix) {
    var n = buku.nomorBerikut[prefix] || 1;
    return prefix + '-' + String(n).padStart(L.LEBAR_NOMOR, '0');
  };

  /* Sorted by date, then by insertion sequence. The sequence is the tie-break
   * because two entries on the same date must have a stable, reproducible order:
   * a general ledger whose rows shuffle between renders cannot be reconciled
   * against a printout. Never by id string — 'E10' sorts before 'E9'. */
  L.urut = function (entries) {
    return entries.slice().sort(function (a, b) {
      if (a.tgl !== b.tgl) return a.tgl < b.tgl ? -1 : 1;
      return a.seq - b.seq;
    });
  };

  /* ============================================================ validasi */

  /* I1, spelled out. Returns a verdict rather than throwing, so the UI can show
   * a would-be entry's imbalance live while it is being typed; tambah() calls
   * this and throws on a false. */
  L.periksaEntri = function (buku, spec, opts) {
    opts = opts || {};
    var alasan = [];
    var jenis = D.jenis(spec.jenis);
    if (!jenis) alasan.push('Jenis jurnal tidak dikenal: ' + spec.jenis);
    if (!D.isTanggal(spec.tgl)) alasan.push('Tanggal harus YYYY-MM-DD yang sah, dapat: ' + spec.tgl);
    if (!spec.baris || !spec.baris.length) alasan.push('Entri tanpa baris.');

    var totalD = 0, totalK = 0, i, b, dipakai = {};
    var baris = spec.baris || [];
    var isiBaris = 0;
    for (i = 0; i < baris.length; i++) {
      b = baris[i];
      var d = b.d === '' || b.d === null || b.d === undefined ? 0 : b.d;
      var k = b.k === '' || b.k === null || b.k === undefined ? 0 : b.k;
      if (!D.isInt(d) || !D.isInt(k)) {
        alasan.push('Baris ' + (i + 1) + ': nilai harus bilangan bulat rupiah, dapat debit=' + b.d + ' kredit=' + b.k + '.');
        continue;
      }
      if (d < 0 || k < 0) {
        alasan.push('Baris ' + (i + 1) + ': nilai negatif tidak diperbolehkan — pindahkan ke sisi yang lain.');
        continue;
      }
      if (d > 0 && k > 0) {
        alasan.push('Baris ' + (i + 1) + ': satu baris hanya boleh berisi debit ATAU kredit, tidak keduanya.');
        continue;
      }
      if (d === 0 && k === 0) continue;   // an empty row in the form is not an error
      if (!D.adaAkun(b.akun)) {
        alasan.push('Baris ' + (i + 1) + ': akun ' + b.akun + ' tidak ada di bagan akun.');
        continue;
      }
      var ak = D.akun(b.akun);
      if (jenis && jenis.id === 'saldo-awal' && D.isNominal(ak)) {
        alasan.push('Baris ' + (i + 1) + ': akun nominal ' + ak.kode + ' ' + ak.nama +
          ' tidak boleh muncul di jurnal saldo awal — neraca pembuka hanya memuat akun riil.');
      }
      isiBaris++;
      dipakai[b.akun] = (dipakai[b.akun] || 0) + 1;
      totalD = D.add(totalD, d);
      totalK = D.add(totalK, k);
    }

    if (isiBaris < 2) alasan.push('Entri jurnal butuh sedikitnya dua baris berisi — satu debit dan satu kredit.');
    if (totalD === 0 && totalK === 0) alasan.push('Entri bernilai nol tidak bisa diposting.');

    /* THE check. The imbalance is reported as a signed rupiah figure and named
     * on the side that is short, because "tidak seimbang" on its own tells a
     * bookkeeper nothing they can act on. */
    var selisih = totalD - totalK;
    if (selisih !== 0) {
      alasan.push('Debit ' + D.rupiah(totalD) + ' tidak sama dengan kredit ' + D.rupiah(totalK) +
        ' — sisi ' + (selisih > 0 ? 'kredit' : 'debit') + ' kurang ' + D.rupiah(Math.abs(selisih)) + '.');
    }

    /* Period lock. Checked here, not only in the UI, so an entry that reaches
     * the engine from a test or from restored storage is refused too. */
    var kunci = spec.tgl && D.isTanggal(spec.tgl) ? L.terkunci(buku, spec.tgl) : null;
    if (kunci && !opts.izinTerkunci) {
      alasan.push('Periode ' + D.periodeNama(D.periodeDari(spec.tgl)) + ' sudah ditutup pada ' +
        kunci.pada + ' oleh ' + kunci.oleh + '. Periode terkunci menolak posting baru; hanya supervisor yang boleh membukanya.');
    }

    if (spec.jenis === 'penutup' && opts.peran && !D.bolehkah(opts.peran, 'penutup')) {
      alasan.push('Peran ' + opts.peran + ' tidak berwenang memposting jurnal penutup.');
    }
    if (spec.jenis === 'penyesuaian' && opts.peran && !D.bolehkah(opts.peran, 'penyesuaian')) {
      alasan.push('Peran ' + opts.peran + ' tidak berwenang memposting jurnal penyesuaian.');
    }
    if (opts.peran && !D.bolehkah(opts.peran, 'posting')) {
      alasan.push('Peran ' + opts.peran + ' hanya boleh menyusun draf, tidak memposting ke buku.');
    }
    var acuan = null;
    if (spec.ref) {
      acuan = L.cari(buku, spec.ref);
      if (!acuan) alasan.push('Entri acuan ' + spec.ref + ' tidak ada di buku.');
    }

    /* A `ref` that merely RESOLVES is not a `ref` that makes sense. Two rules,
     * both of them cheap, and both of them things a mis-bound reference would
     * otherwise sail straight through:
     *
     *  1. An entry may be reversed once. A second pembalik pointing at the same
     *     original doubles the cancellation, and L.pembalik() already refuses it
     *     — but a stored record replayed on load does not go through
     *     L.pembalik(), it goes through L.tambah(), so the rule has to live here
     *     to be a rule at all. This is what caught the reference re-binding: a
     *     reversal whose ref had drifted onto an already-reversed entry.
     *  2. No correction or reversal of a CLOSING entry may touch cash. The cash
     *     flow statement excludes closing entries by effective jenis, so such an
     *     entry would move the ledger's cash balance while being absent from the
     *     statement that is supposed to explain it. No legitimate closing
     *     correction touches cash — closing entries only move nominal balances
     *     into equity. */
    if (acuan && spec.jenis === 'pembalik') {
      var sudahBalik = L.pembalikDari(buku, acuan.id);
      if (sudahBalik && sudahBalik.no !== spec.no) {
        alasan.push('Entri ' + acuan.no + ' sudah dibalik oleh ' + sudahBalik.no +
          '. Membalik dua kali akan menggandakan angkanya.');
      }
    }
    if (acuan && (spec.jenis === 'pembalik' || spec.jenis === 'koreksi')) {
      var jefCalon = acuan.jenis === 'pembalik' || acuan.jenis === 'koreksi' ? spec.jenis : acuan.jenis;
      if (jefCalon === 'penutup') {
        var kasPenutup = [];
        for (i = 0; i < baris.length; i++) {
          var akp = D.akun(baris[i].akun);
          if (akp && akp.kas && ((baris[i].d || 0) !== 0 || (baris[i].k || 0) !== 0)) kasPenutup.push(akp.kode);
        }
        if (kasPenutup.length) {
          alasan.push('Pembalik atau koreksi atas jurnal penutup tidak boleh menyentuh akun kas (' +
            kasPenutup.join(', ') + '). Laporan arus kas mengecualikan jurnal penutup beserta pembalik dan ' +
            'koreksinya, jadi baris kas di sini akan menggerakkan saldo kas di buku besar tanpa pernah muncul ' +
            'di laporan yang seharusnya menjelaskannya.');
        }
      }
    }

    return {
      ok: alasan.length === 0,
      alasan: alasan,
      totalDebit: totalD,
      totalKredit: totalK,
      selisih: selisih,
      seimbang: selisih === 0 && totalD > 0,
      barisIsi: isiBaris
    };
  };

  L.cari = function (buku, id) {
    if (buku.indexId && buku.indexId[id]) return buku.indexId[id];
    for (var i = 0; i < buku.entries.length; i++) if (buku.entries[i].id === id) return buku.entries[i];
    return null;
  };

  /* The ONLY way into buku.entries. Throws on anything periksaEntri refuses,
   * with every reason in the message — a bookkeeper who is told "invalid" and
   * not which line is invalid will guess, and guessing is how the wrong account
   * ends up with the right number in it. */
  L.tambah = function (buku, spec, opts) {
    opts = opts || {};
    var v = L.periksaEntri(buku, spec, opts);
    if (!v.ok) {
      var e = new Error('Entri ditolak: ' + v.alasan.join(' | '));
      e.tolak = v;
      throw e;
    }
    var jenis = D.jenis(spec.jenis);
    var prefix = jenis.prefix;
    var nomor = spec.no || L.nomorDok(buku, prefix);
    if (!spec.no) buku.nomorBerikut[prefix] = (buku.nomorBerikut[prefix] || 1) + 1;

    var baris = [];
    for (var i = 0; i < spec.baris.length; i++) {
      var b = spec.baris[i];
      var d = b.d || 0, k = b.k || 0;
      if (d === 0 && k === 0) continue;
      baris.push({ akun: b.akun, d: d, k: k, catatan: b.catatan || '' });
    }

    var entry = {
      id: 'E' + buku.seqBerikut,
      seq: buku.seqBerikut,
      no: nomor,
      tgl: spec.tgl,
      jenis: spec.jenis,
      memo: spec.memo || '',
      ref: spec.ref || null,
      lampiran: spec.lampiran || null,
      oleh: spec.oleh || opts.oleh || 'sistem',
      peran: spec.peran || opts.peran || null,
      sumber: spec.sumber || 'pengguna',
      baris: baris
    };
    buku.seqBerikut++;
    buku.entries.push(entry);
    if (!buku.indexId) buku.indexId = {};
    buku.indexId[entry.id] = entry;
    return entry;
  };

  /* ====================================================== periode terkunci */

  L.terkunci = function (buku, tgl) {
    var p = D.periodeDari(tgl);
    var t = buku.tutup && buku.tutup[p];
    return t ? { periode: p, oleh: t.oleh, pada: t.pada, catatan: t.catatan } : null;
  };

  L.periodeTutup = function (buku) {
    return Object.keys(buku.tutup || {}).sort();
  };

  L.tutupPeriode = function (buku, periode, opts) {
    opts = opts || {};
    if (!/^\d{4}-\d{2}$/.test(String(periode))) throw new Error('Periode harus YYYY-MM, dapat ' + periode);
    if (!D.bolehkah(opts.peran, 'tutupPeriode')) {
      throw new Error('Peran ' + opts.peran + ' tidak berwenang mengunci periode. Hanya supervisor.');
    }
    if (buku.tutup[periode]) throw new Error('Periode ' + periode + ' sudah terkunci.');
    buku.tutup[periode] = {
      oleh: opts.oleh || opts.peran || 'supervisor',
      pada: opts.pada || new Date().toISOString().slice(0, 10),
      catatan: opts.catatan || ''
    };
    return buku.tutup[periode];
  };

  /* Reopening is the one action in this app that only one role can take, and it
   * is the one that most deserves the restriction: a reopened period lets
   * someone change a figure that has already been reported. */
  L.bukaPeriode = function (buku, periode, opts) {
    opts = opts || {};
    if (!D.bolehkah(opts.peran, 'bukaPeriode')) {
      throw new Error('Peran ' + opts.peran + ' tidak berwenang membuka periode terkunci. Hanya supervisor.');
    }
    if (!buku.tutup[periode]) throw new Error('Periode ' + periode + ' tidak sedang terkunci.');
    var dulu = buku.tutup[periode];
    delete buku.tutup[periode];
    return dulu;
  };

  /* ============================================ pembalik dan koreksi */

  /* A reversing entry: the same lines with debit and credit swapped, posted on
   * its own date, referencing the original. The original is NOT touched, NOT
   * flagged, NOT deleted — whether an entry has been reversed is DERIVED by
   * looking for an entry that points at it. That is the difference between an
   * audit trail and a story about one. */
  L.pembalik = function (buku, id, tgl, opts) {
    opts = opts || {};
    var asal = L.cari(buku, id);
    if (!asal) throw new Error('Entri ' + id + ' tidak ada.');
    if (!D.bolehkah(opts.peran, 'pembalik')) {
      throw new Error('Peran ' + opts.peran + ' tidak berwenang memposting jurnal pembalik.');
    }
    var sudah = L.pembalikDari(buku, id);
    if (sudah) throw new Error('Entri ' + asal.no + ' sudah dibalik oleh ' + sudah.no + '. Membalik dua kali akan menggandakan angkanya.');
    var baris = asal.baris.map(function (b) {
      return { akun: b.akun, d: b.k, k: b.d, catatan: 'pembalik ' + asal.no };
    });
    return L.tambah(buku, {
      tgl: tgl || asal.tgl,
      jenis: 'pembalik',
      memo: (opts.memo ? opts.memo + ' — ' : '') + 'Membalik ' + asal.no + ' (' + (asal.memo || 'tanpa memo') + ')',
      ref: asal.id,
      baris: baris,
      oleh: opts.oleh, peran: opts.peran, sumber: opts.sumber
    }, opts);
  };

  L.pembalikDari = function (buku, id) {
    for (var i = 0; i < buku.entries.length; i++) {
      var e = buku.entries[i];
      if (e.jenis === 'pembalik' && e.ref === id) return e;
    }
    return null;
  };
  L.koreksiDari = function (buku, id) {
    var out = [];
    for (var i = 0; i < buku.entries.length; i++) {
      var e = buku.entries[i];
      if (e.jenis === 'koreksi' && e.ref === id) out.push(e);
    }
    return out;
  };

  /* A correction is TWO entries, never an edit: reverse the original, then post
   * the replacement. Three documents where a naive system would leave one, and
   * that is the point — the wrong figure, the cancellation of the wrong figure,
   * and the right figure all remain readable, in date order, forever. */
  L.koreksi = function (buku, id, spec, opts) {
    opts = opts || {};
    var asal = L.cari(buku, id);
    if (!asal) throw new Error('Entri ' + id + ' tidak ada.');
    if (!D.bolehkah(opts.peran, 'koreksi')) {
      throw new Error('Peran ' + opts.peran + ' tidak berwenang memposting jurnal koreksi.');
    }
    var tgl = spec.tgl || asal.tgl;
    /* Validate the REPLACEMENT before posting the reversal, so a refused
     * correction cannot leave the book holding a reversal with nothing to
     * replace it — which would silently delete a real transaction. */
    var calon = {
      tgl: tgl, jenis: 'koreksi', memo: spec.memo || '', ref: asal.id, baris: spec.baris
    };
    var v = L.periksaEntri(buku, calon, opts);
    if (!v.ok) {
      var err = new Error('Koreksi ditolak sebelum apa pun diposting: ' + v.alasan.join(' | '));
      err.tolak = v;
      throw err;
    }
    var balik = L.pembalik(buku, id, tgl, {
      peran: opts.peran, oleh: opts.oleh, sumber: opts.sumber,
      memo: 'Bagian dari koreksi'
    });
    calon.memo = (spec.memo ? spec.memo + ' — ' : '') + 'Koreksi atas ' + asal.no + ', pembalik ' + balik.no;
    calon.oleh = opts.oleh; calon.peran = opts.peran; calon.sumber = opts.sumber;
    var baru = L.tambah(buku, calon, opts);
    return { asal: asal, pembalik: balik, koreksi: baru };
  };

  /* ======================================================= pemilihan entri */

  /* The jenis an entry EFFECTIVELY is. A reversal of an adjusting entry belongs
   * with the adjusting entries: put it in the "before adjustment" column and the
   * pre-adjustment trial balance shows an adjustment that has been cancelled but
   * not the one it cancelled. Resolved through ref, one hop, which is all the
   * chain can be — a reversal cannot itself be reversed. */
  L.jenisEfektif = function (buku, entry) {
    if ((entry.jenis === 'pembalik' || entry.jenis === 'koreksi') && entry.ref) {
      var asal = L.cari(buku, entry.ref);
      if (asal) return asal.jenis === 'pembalik' || asal.jenis === 'koreksi' ? entry.jenis : asal.jenis;
    }
    return entry.jenis;
  };

  /* Selects WHOLE entries. Nothing in this file ever selects individual lines
   * out of an entry: half an entry does not balance, and every identity in this
   * app rests on the selected set balancing. */
  L.pilih = function (buku, o) {
    o = o || {};
    var entries = o.entries || buku.entries;
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (o.dari && e.tgl < o.dari) continue;
      if (o.sampai && e.tgl > o.sampai) continue;
      if (o.sebelum && e.tgl >= o.sebelum) continue;
      var jef = o.efektif === false ? e.jenis : L.jenisEfektif(buku, e);
      if (o.kecualiJenis && o.kecualiJenis.indexOf(jef) >= 0) continue;
      if (o.hanyaJenis && o.hanyaJenis.indexOf(jef) < 0) continue;
      out.push(e);
    }
    return L.urut(out);
  };

  /* Trial-balance stages, named once so no caller has to remember which jenis
   * belongs in which column. */
  L.TAHAP = {
    sebelum: ['penyesuaian', 'penutup'],   // pre-adjustment: exclude both
    setelah: ['penutup'],                  // post-adjustment: exclude closing only
    penutup: []                            // post-closing: everything
  };

  /* ============================================== saldo (selalu diturunkan) */

  /* Sum of postings, per account. THE primitive: every balance, every trial
   * balance, every statement line in this file resolves to a call to this
   * function over some set of whole entries. There is no other source of a
   * figure anywhere in the app. */
  L.postingan = function (entries) {
    var m = {}, i, j;
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      for (j = 0; j < e.baris.length; j++) {
        var b = e.baris[j];
        var r = m[b.akun];
        if (!r) { r = m[b.akun] = { kode: b.akun, d: 0, k: 0, n: 0 }; }
        r.d = D.add(r.d, b.d);
        r.k = D.add(r.k, b.k);
        r.n++;
      }
    }
    return m;
  };

  /* One account's balance, in NATURAL terms (positive means "on the side this
   * account normally sits on"). Computed by walking the postings — there is
   * nothing else to walk. */
  L.saldoAkun = function (buku, kode, o) {
    var ak = D.akun(kode);
    if (!ak) throw new Error('Akun ' + kode + ' tidak ada di bagan akun.');
    var entries = L.pilih(buku, o);
    var d = 0, k = 0, i, j;
    for (i = 0; i < entries.length; i++) {
      for (j = 0; j < entries[i].baris.length; j++) {
        var b = entries[i].baris[j];
        if (b.akun !== kode) continue;
        d = D.add(d, b.d); k = D.add(k, b.k);
      }
    }
    return { kode: kode, akun: ak, debit: d, kredit: k, saldo: D.saldoNatural(ak, d, k), mentah: d - k };
  };

  /* Signed contribution of every account to its type's reported total, in the
   * direction the ACCOUNTING EQUATION needs — which is the type's normal side,
   * NOT the account's:
   *
   *     Aset (D−K) = Liabilitas (K−D) + Ekuitas (K−D) + Pendapatan (K−D) − Beban (D−K)
   *
   * So Aset and Beban are summed debit-minus-credit and the other three
   * credit-minus-debit. Getting this from the ACCOUNT's normal balance instead
   * of the TYPE's is a bug that hides for a while and then reports equity as the
   * sum of profit and expenses — it cost this file one round of red assertions
   * before the seed was finished, which is the entire argument for building the
   * checker before the UI.
   *
   * Because the sign comes from the type, contra accounts need no special case:
   * akumulasi penyusutan is an Aset with a credit balance, so it contributes
   * negatively to Aset on its own, and prive is an Ekuitas with a debit balance,
   * so it reduces Ekuitas on its own. There is no `if (kontra)` anywhere in the
   * statement code, and that is why. */
  L.perTipe = function (entries) {
    var post = L.postingan(entries);
    var out = { Aset: 0, Liabilitas: 0, Ekuitas: 0, Pendapatan: 0, Beban: 0 };
    for (var kode in post) {
      if (!Object.prototype.hasOwnProperty.call(post, kode)) continue;
      var ak = D.akun(kode);
      if (!ak) throw new Error('Posting ke akun tak dikenal: ' + kode);
      var r = post[kode];
      out[ak.tipe] = D.add(out[ak.tipe], D.NORMAL_TIPE[ak.tipe] === 'D' ? (r.d - r.k) : (r.k - r.d));
    }
    return out;
  };

  /* THE ACCOUNTING EQUATION, as of a date. Reported equity includes the result
   * of the still-open nominal accounts, because that is exactly what appears on
   * a balance sheet drawn up mid-period: Modal + Saldo laba + laba periode
   * berjalan. Before closing the nominal part carries the profit; after closing
   * it is zero and the equity accounts carry it. Total equity is identical
   * either way, which is I5's "balance sheet unchanged". */
  L.persamaan = function (buku, sampai, o) {
    var entries = L.pilih(buku, { sampai: sampai, entries: (o && o.entries) || null, kecualiJenis: (o && o.kecualiJenis) || null });
    var t = L.perTipe(entries);
    var laba = t.Pendapatan - t.Beban;
    var ekuitas = D.add(t.Ekuitas, laba);
    return {
      tanggal: sampai,
      aset: t.Aset,
      liabilitas: t.Liabilitas,
      ekuitasAkun: t.Ekuitas,
      labaBelumDitutup: laba,
      ekuitas: ekuitas,
      kanan: D.add(t.Liabilitas, ekuitas),
      selisih: t.Aset - D.add(t.Liabilitas, ekuitas),
      seimbang: t.Aset - D.add(t.Liabilitas, ekuitas) === 0,
      tipe: t
    };
  };

  /* ============================================================ buku besar */

  /* One account's ledger, with a running balance. The opening row is the balance
   * before `dari`, computed the same way as everything else; the running balance
   * is accumulated across the rows and the LAST row's figure is cross-checked
   * against an independent saldoAkun() call in periksaBuku — the two must agree,
   * which is the per-account form of I7. */
  L.bukuBesar = function (buku, kode, o) {
    o = o || {};
    var ak = D.akun(kode);
    if (!ak) throw new Error('Akun ' + kode + ' tidak ada.');
    var kecuali = o.kecualiJenis || null;

    var awal = 0;
    if (o.dari) {
      var seb = L.pilih(buku, { sebelum: o.dari, kecualiJenis: kecuali });
      var pa = L.postingan(seb)[kode];
      awal = pa ? D.saldoNatural(ak, pa.d, pa.k) : 0;
    }

    var entries = L.pilih(buku, { dari: o.dari, sampai: o.sampai, kecualiJenis: kecuali });
    var baris = [], saldo = awal, i, j;
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      for (j = 0; j < e.baris.length; j++) {
        var b = e.baris[j];
        if (b.akun !== kode) continue;
        var gerak = D.saldoNatural(ak, b.d, b.k);
        saldo = D.add(saldo, gerak);
        baris.push({
          entryId: e.id, no: e.no, tgl: e.tgl, jenis: e.jenis, memo: e.memo,
          catatan: b.catatan, debit: b.d, kredit: b.k, gerak: gerak, saldo: saldo,
          lawan: e.baris.filter(function (x) { return x.akun !== kode; }).map(function (x) { return x.akun; })
        });
      }
    }
    return { akun: ak, saldoAwal: awal, baris: baris, saldoAkhir: saldo, jumlahDebit: baris.reduce(function (s, r) { return s + r.debit; }, 0), jumlahKredit: baris.reduce(function (s, r) { return s + r.kredit; }, 0) };
  };

  /* ========================================================== neraca saldo */

  /* I2. Both columns summed from raw postings. An account whose balance is on
   * the "wrong" side — a bank overdraft, a customer overpayment — is shown on
   * the side its balance is actually on, not forced onto its normal side with a
   * minus sign, because a trial balance whose columns are massaged is no longer
   * a check on anything. */
  L.neracaSaldo = function (buku, o) {
    o = o || {};
    var tahap = o.tahap || 'setelah';
    var kecuali = L.TAHAP[tahap];
    if (!kecuali) throw new Error('Tahap neraca saldo tidak dikenal: ' + tahap);
    var entries = L.pilih(buku, { sampai: o.sampai, dari: o.dari, kecualiJenis: kecuali });
    var post = L.postingan(entries);

    var baris = [], totalD = 0, totalK = 0;
    D.AKUN.forEach(function (ak) {
      var r = post[ak.kode];
      var d = r ? r.d : 0, k = r ? r.k : 0;
      var mentah = d - k;
      if (!r && !o.semuaAkun) return;
      if (mentah === 0 && d === 0 && k === 0 && !o.semuaAkun) return;
      var sisiD = mentah > 0 ? mentah : 0;
      var sisiK = mentah < 0 ? -mentah : 0;
      if (mentah === 0 && !o.semuaAkun && !o.nolPun) {
        /* An account with movements that net to zero still belongs on the trial
         * balance at zero: it is exactly what a closed nominal account looks
         * like, and hiding it would hide the proof that closing worked. */
        baris.push({ akun: ak, debit: 0, kredit: 0, mentahD: d, mentahK: k, nol: true });
        return;
      }
      totalD = D.add(totalD, sisiD);
      totalK = D.add(totalK, sisiK);
      baris.push({ akun: ak, debit: sisiD, kredit: sisiK, mentahD: d, mentahK: k, nol: mentah === 0, salahSisi: (sisiD > 0 && ak.normal === 'K') || (sisiK > 0 && ak.normal === 'D') });
    });

    return {
      tahap: tahap, sampai: o.sampai, baris: baris,
      totalDebit: totalD, totalKredit: totalK,
      selisih: totalD - totalK, seimbang: totalD - totalK === 0,
      jumlahEntri: entries.length
    };
  };

  /* ================================================== laporan laba rugi */

  /* SAK EMKM shape: pendapatan, beban, laba/rugi. The one thing added beyond the
   * bare minimum is the gross-profit line, because a trading business that
   * cannot see its own gross margin has no use for the statement.
   *
   * Net income is computed HERE and nowhere else. Everything downstream — the
   * equity statement, the balance sheet's equity section, the cash flow's first
   * line — takes this figure. That is what makes I4 a property of the code
   * rather than a coincidence between four functions that all happen to add up. */
  L.labaRugi = function (buku, dari, sampai, o) {
    o = o || {};
    var entries = L.pilih(buku, { dari: dari, sampai: sampai, kecualiJenis: ['penutup'] });
    var post = L.postingan(entries);

    function jum(pred) {
      var s = 0;
      for (var kode in post) {
        if (!Object.prototype.hasOwnProperty.call(post, kode)) continue;
        var ak = D.akun(kode);
        if (!ak || !pred(ak)) continue;
        var r = post[kode];
        /* Sign from the TYPE's normal side, not the ACCOUNT's — the same rule
         * perTipe() uses, and for the same reason. The two agree for every
         * account whose `normal` matches its type, which is why reading it off
         * the account looked right for as long as the chart carried no contra
         * revenue or contra expense account. Add one — 4199 Retur dan Potongan
         * Penjualan, an akun Pendapatan with a normal DEBIT balance, which is
         * exactly what the chart's own `kontra` design invites — and the account
         * route ADDS the return to revenue while neraca() subtracts it, so the
         * income statement and the balance sheet report different profits.
         * Taking it from the type nets the contra account automatically, with no
         * `if (kontra)` anywhere. A sales return posted as a plain debit to
         * Penjualan itself still reduces revenue, as before. */
        s = D.add(s, D.NORMAL_TIPE[ak.tipe] === 'D' ? (r.d - r.k) : (r.k - r.d));
      }
      return s;
    }
    function rinci(pred) {
      var out = [];
      D.AKUN.forEach(function (ak) {
        if (!pred(ak)) return;
        var r = post[ak.kode];
        if (!r) return;
        var v = D.NORMAL_TIPE[ak.tipe] === 'D' ? (r.d - r.k) : (r.k - r.d);
        if (v === 0 && !o.nolPun) return;
        out.push({ akun: ak, jumlah: v });
      });
      return out;
    }

    var pendapatanUsaha = rinci(function (a) { return a.tipe === 'Pendapatan' && a.grup === 'Pendapatan usaha'; });
    var pendapatanLain = rinci(function (a) { return a.tipe === 'Pendapatan' && a.grup !== 'Pendapatan usaha'; });
    var hpp = rinci(function (a) { return a.tipe === 'Beban' && a.hpp; });
    var bebanUsaha = rinci(function (a) { return a.tipe === 'Beban' && !a.hpp && !a.pajakFinal; });
    var pajakFinal = rinci(function (a) { return a.tipe === 'Beban' && a.pajakFinal; });

    var totPendapatanUsaha = jum(function (a) { return a.tipe === 'Pendapatan' && a.grup === 'Pendapatan usaha'; });
    var totPendapatanLain = jum(function (a) { return a.tipe === 'Pendapatan' && a.grup !== 'Pendapatan usaha'; });
    var totHpp = jum(function (a) { return a.tipe === 'Beban' && a.hpp; });
    var totBebanUsaha = jum(function (a) { return a.tipe === 'Beban' && !a.hpp && !a.pajakFinal; });
    var totPajakFinal = jum(function (a) { return a.tipe === 'Beban' && a.pajakFinal; });

    var labaBruto = totPendapatanUsaha - totHpp;
    var labaUsaha = labaBruto - totBebanUsaha;
    var labaSebelumPajak = D.add(labaUsaha, totPendapatanLain);
    var labaNeto = labaSebelumPajak - totPajakFinal;

    /* Peredaran bruto — the PPh final base. Turnover, not profit, and only the
     * accounts flagged `bruto` (operating revenue), because other income is not
     * part of the 0,5% base. */
    var peredaranBruto = jum(function (a) { return a.tipe === 'Pendapatan' && a.bruto; });

    return {
      dari: dari, sampai: sampai,
      pendapatanUsaha: pendapatanUsaha, totPendapatanUsaha: totPendapatanUsaha,
      pendapatanLain: pendapatanLain, totPendapatanLain: totPendapatanLain,
      hpp: hpp, totHpp: totHpp,
      labaBruto: labaBruto,
      bebanUsaha: bebanUsaha, totBebanUsaha: totBebanUsaha,
      labaUsaha: labaUsaha,
      labaSebelumPajak: labaSebelumPajak,
      pajakFinal: pajakFinal, totPajakFinal: totPajakFinal,
      labaNeto: labaNeto,
      peredaranBruto: peredaranBruto,
      totalPendapatan: D.add(totPendapatanUsaha, totPendapatanLain),
      totalBeban: D.add(D.add(totHpp, totBebanUsaha), totPajakFinal),
      jumlahEntri: entries.length
    };
  };

  /* ============================================== perubahan ekuitas */

  /* I4's middle link. The profit line here IS labaRugi().labaNeto — passed in,
   * not recomputed — and the closing figure is asserted against the balance
   * sheet's equity total.
   *
   * The arithmetic that must hold, and does, exactly:
   *   ekuitas akhir − ekuitas awal = laba neto + setoran modal − prive
   * because a closing entry moves an amount out of the nominal accounts and the
   * same amount into an equity account, contributing zero to reported equity.
   * So it does not matter whether the book has been closed or not; this
   * statement reads the same either way. */
  L.perubahanEkuitas = function (buku, dari, sampai, o) {
    o = o || {};
    var lr = o.labaRugi || L.labaRugi(buku, dari, sampai);

    var awal = L.persamaan(buku, null, { entries: L.pilih(buku, { sebelum: dari }) });
    var akhir = L.persamaan(buku, sampai);

    /* Movements on the equity accounts during the period, split by what they
     * mean. Closing entries are included in `penutupPindah` and shown for what
     * they are — a transfer, netting to zero against the nominal accounts. */
    var dalam = L.pilih(buku, { dari: dari, sampai: sampai });
    var setoran = 0, prive = 0, penutupPindah = 0, lainEkuitas = 0;
    var rincianSetoran = [], rincianPrive = [];
    for (var i = 0; i < dalam.length; i++) {
      var e = dalam[i];
      for (var j = 0; j < e.baris.length; j++) {
        var b = e.baris[j];
        var ak = D.akun(b.akun);
        if (!ak || ak.tipe !== 'Ekuitas') continue;
        var natural = D.saldoNatural(ak, b.d, b.k);   // 3101 credit-positive, 3102 debit-positive
        if (e.jenis === 'penutup') { penutupPindah = D.add(penutupPindah, ak.kontra ? -natural : natural); continue; }
        if (ak.kode === '3102') { prive = D.add(prive, natural); rincianPrive.push({ e: e, b: b, jumlah: natural }); }
        else if (ak.kode === '3101') { setoran = D.add(setoran, natural); rincianSetoran.push({ e: e, b: b, jumlah: natural }); }
        else lainEkuitas = D.add(lainEkuitas, natural);
      }
    }

    var ekuitasAwal = awal.ekuitas;
    var hitungAkhir = D.add(D.add(D.add(ekuitasAwal, lr.labaNeto), setoran), D.add(-prive, lainEkuitas));

    /* Opening composition, for the statement's first block. */
    var komposisiAwal = [];
    var sebelum = L.pilih(buku, { sebelum: dari });
    var postSeb = L.postingan(sebelum);
    D.AKUN.forEach(function (ak) {
      if (ak.tipe !== 'Ekuitas') return;
      var r = postSeb[ak.kode];
      if (!r) return;
      var v = D.saldoNatural(ak, r.d, r.k);
      if (v === 0) return;
      komposisiAwal.push({ akun: ak, jumlah: ak.kontra ? -v : v });
    });
    /* Any nominal-account result sitting in the opening figure is prior-period
     * profit that was never closed; shown separately rather than folded in. */
    if (awal.labaBelumDitutup !== 0) {
      komposisiAwal.push({ akun: { kode: '—', nama: 'Laba periode lalu yang belum ditutup', tipe: 'Ekuitas' }, jumlah: awal.labaBelumDitutup, turunan: true });
    }

    return {
      dari: dari, sampai: sampai,
      ekuitasAwal: ekuitasAwal,
      komposisiAwal: komposisiAwal,
      setoran: setoran, rincianSetoran: rincianSetoran,
      labaNeto: lr.labaNeto,
      prive: prive, rincianPrive: rincianPrive,
      lainEkuitas: lainEkuitas,
      penutupPindah: penutupPindah,
      ekuitasAkhir: akhir.ekuitas,
      ekuitasAkhirHitung: hitungAkhir,
      selisih: akhir.ekuitas - hitungAkhir,
      cocok: akhir.ekuitas - hitungAkhir === 0
    };
  };

  /* ==================================================== neraca (posisi keuangan) */

  /* SAK EMKM calls this Laporan Posisi Keuangan and asks for a classified
   * presentation: aset lancar / tidak lancar, liabilitas jangka pendek /
   * panjang, ekuitas. The equity section takes labaNeto from labaRugi() so I4
   * holds by construction; the total is then checked against the raw accounting
   * equation, which was computed by a completely different route. */
  L.neraca = function (buku, sampai, o) {
    o = o || {};
    var dari = o.dari || null;
    var lr = o.labaRugi || (dari ? L.labaRugi(buku, dari, sampai) : null);
    var entries = L.pilih(buku, { sampai: sampai });
    var post = L.postingan(entries);

    function kel(pred) {
      var out = [], tot = 0;
      D.AKUN.forEach(function (ak) {
        if (!pred(ak)) return;
        var r = post[ak.kode];
        if (!r) return;
        /* Reported on the balance sheet in SIGNED terms relative to its type:
         * accumulated depreciation appears as a negative asset, which is how a
         * classified balance sheet shows it, rather than as a positive number in
         * the liabilities column. */
        var v = ak.tipe === 'Aset' ? (r.d - r.k) : (r.k - r.d);
        if (v === 0 && !o.nolPun) return;
        out.push({ akun: ak, jumlah: v });
        tot = D.add(tot, v);
      });
      return { baris: out, total: tot };
    }

    var asetLancar = kel(function (a) { return a.tipe === 'Aset' && a.lancar; });
    var asetTetap = kel(function (a) { return a.tipe === 'Aset' && !a.lancar; });
    var liabPendek = kel(function (a) { return a.tipe === 'Liabilitas' && a.lancar; });
    var liabPanjang = kel(function (a) { return a.tipe === 'Liabilitas' && !a.lancar; });

    /* Equity as reported: the equity accounts as they stand, PLUS the result of
     * the nominal accounts that are still open. Presented as two lines when the
     * period is not yet closed — "saldo laba" and "laba periode berjalan" — which
     * is what makes the balance sheet tie to the income statement visibly rather
     * than only arithmetically. */
    var ekuitasAkun = kel(function (a) { return a.tipe === 'Ekuitas'; });
    var t = L.perTipe(entries);
    var labaBerjalan = t.Pendapatan - t.Beban;
    var totalEkuitas = D.add(ekuitasAkun.total, labaBerjalan);

    var pers = L.persamaan(buku, sampai);

    return {
      sampai: sampai, dari: dari,
      asetLancar: asetLancar, asetTetap: asetTetap,
      totalAset: D.add(asetLancar.total, asetTetap.total),
      liabPendek: liabPendek, liabPanjang: liabPanjang,
      totalLiabilitas: D.add(liabPendek.total, liabPanjang.total),
      ekuitasAkun: ekuitasAkun,
      labaBerjalan: labaBerjalan,
      labaNetoLaporan: lr ? lr.labaNeto : null,
      totalEkuitas: totalEkuitas,
      kanan: D.add(D.add(liabPendek.total, liabPanjang.total), totalEkuitas),
      selisih: D.add(asetLancar.total, asetTetap.total) - D.add(D.add(liabPendek.total, liabPanjang.total), totalEkuitas),
      seimbang: D.add(asetLancar.total, asetTetap.total) - D.add(D.add(liabPendek.total, liabPanjang.total), totalEkuitas) === 0,
      persamaan: pers,
      /* I4's third link: is the profit the balance sheet's equity carries the
       * same profit the income statement reported? Only meaningful when the
       * period has not been closed inside `sampai`; when it has, the figure has
       * moved into Saldo Laba and `labaBerjalan` is legitimately zero. */
      labaCocok: lr ? (labaBerjalan === lr.labaNeto) : null
    };
  };

  /* ================================================= laporan arus kas */

  L.saldoKas = function (buku, o) {
    var entries = L.pilih(buku, o || {});
    var post = L.postingan(entries);
    var tot = 0, rinci = [];
    D.akunKas().forEach(function (ak) {
      var r = post[ak.kode];
      var v = r ? (r.d - r.k) : 0;
      tot = D.add(tot, v);
      rinci.push({ akun: ak, jumlah: v });
    });
    return { total: tot, rinci: rinci };
  };

  /* INDIRECT METHOD, derived rather than assembled.
   *
   * The identity, again, because it is the whole reason this statement can be
   * trusted: every entry has sum(debit) === sum(kredit), so across a set of
   * WHOLE entries, Σ over all accounts of (debit − kredit) is exactly zero.
   * Split the accounts into cash and non-cash and rearrange:
   *
   *     Δkas  =  −Σ_{non-cash} (debit − kredit)
   *
   * with no error term. Partition the non-cash accounts by their `arus` tag into
   * O, I and F and the three subtotals must sum to Δkas — so a misclassified
   * account cannot make the statement fail to reconcile, it can only put a
   * figure in the wrong section, which is a presentation error the reader can
   * see rather than a hidden hole.
   *
   * Closing entries are excluded. They are internally balanced and never touch
   * cash, so excluding them leaves the identity intact — and INCLUDING them
   * would reclassify the whole year's profit as a financing movement, because a
   * closing entry debits revenue (operating) and credits Saldo Laba (financing).
   * The suite asserts both halves of that: that no closing entry touches cash,
   * and that the statement is identical with and without them. */
  L.arusKas = function (buku, dari, sampai, o) {
    o = o || {};
    var kecuali = ['penutup'];
    var sel = L.pilih(buku, { dari: dari, sampai: sampai, kecualiJenis: kecuali });
    var post = L.postingan(sel);

    var lr = o.labaRugi || L.labaRugi(buku, dari, sampai);

    var kasAwalR = L.saldoKas(buku, { sebelum: dari });
    var kasAkhirR = L.saldoKas(buku, { sampai: sampai });
    var kasAwal = kasAwalR.total, kasAkhir = kasAkhirR.total;

    /* Bucket algebra. Every non-cash account with movements in the period lands
     * in exactly one bucket, and an account with no `arus` tag is a bug loud
     * enough to throw for — a silently untagged account would be dropped from
     * the statement and the reconciliation would fail with no explanation. */
    var bucket = { O: 0, I: 0, F: 0 };
    var takTertagih = [];
    var kasGerak = 0;
    for (var kode in post) {
      if (!Object.prototype.hasOwnProperty.call(post, kode)) continue;
      var ak = D.akun(kode);
      var r = post[kode];
      var mentah = r.d - r.k;
      if (ak.kas) { kasGerak = D.add(kasGerak, mentah); continue; }
      if (!ak.arus) { takTertagih.push(kode); continue; }
      bucket[ak.arus] = D.add(bucket[ak.arus], mentah);
    }
    if (takTertagih.length) {
      throw new Error('Akun tanpa klasifikasi arus kas: ' + takTertagih.join(', ') +
        '. Setiap akun non-kas harus punya arus O/I/F, kalau tidak laporan arus kas tidak mungkin rekonsiliasi.');
    }

    var operasi = -bucket.O, investasi = -bucket.I, pendanaan = -bucket.F;

    /* ------------------------------------ penyajian bagian operasi */

    /* Depreciation add-back, taken from the CREDIT side of the accumulated
     * depreciation accounts rather than from the expense account. The two are
     * equal in a correct book, and the suite asserts they are — but the
     * balance-sheet figure is the one that belongs in a working-capital
     * reconciliation, and taking it from there means a depreciation entry that
     * hit the wrong expense account still reconciles. */
    var penyusutan = 0, rincianNonKas = [];
    D.AKUN.forEach(function (ak) {
      if (!ak.akumDari) return;
      var r = post[ak.kode];
      if (!r) return;
      var v = r.k - r.d;
      if (v === 0) return;
      penyusutan = D.add(penyusutan, v);
      rincianNonKas.push({ akun: ak, jumlah: v, label: 'Penyusutan ' + (D.akun(ak.akumDari) ? D.akun(ak.akumDari).nama : ak.akumDari) });
    });
    var bebanPenyusutan = 0;
    D.AKUN.forEach(function (ak) {
      if (!ak.nonKas) return;
      var r = post[ak.kode];
      if (!r) return;
      bebanPenyusutan = D.add(bebanPenyusutan, r.d - r.k);
    });

    /* Working capital: every operating account that is neither nominal nor an
     * accumulated-depreciation contra. An increase in an operating asset is a
     * use of cash (negative), an increase in an operating liability is a source
     * (positive) — which is exactly −(debit − kredit) in both cases, with no
     * per-account sign rule to get wrong. */
    var modalKerja = [], totModalKerja = 0;
    D.AKUN.forEach(function (ak) {
      if (ak.arus !== 'O') return;
      if (D.isNominal(ak)) return;
      if (ak.akumDari) return;
      var r = post[ak.kode];
      if (!r) return;
      var v = -(r.d - r.k);
      if (v === 0) return;
      /* THE LABEL, and it is not the same question as the sign of the figure.
       * `jumlah` is the cash effect and is −(d−k) for every account alike; but
       * whether the BALANCE went up is a question about the account's own
       * direction of growth, and for a liability a net CREDIT movement is an
       * increase. Taking the flag from the raw d−k printed every liability line
       * as "Penurunan" while the amount beside it said the opposite — the sign
       * was right, the sentence was false. So the flag comes from the TYPE's
       * normal side, exactly as perTipe() does. */
      var gerakAlami = D.NORMAL_TIPE[ak.tipe] === 'D' ? (r.d - r.k) : (r.k - r.d);
      modalKerja.push({ akun: ak, jumlah: v, naik: gerakAlami > 0, gerak: gerakAlami });
      totModalKerja = D.add(totModalKerja, v);
    });

    var operasiSusun = D.add(D.add(lr.labaNeto, penyusutan), totModalKerja);

    /* ---------------------------------- penyajian investasi / pendanaan */

    var rincianInvestasi = [], rincianPendanaan = [];
    D.AKUN.forEach(function (ak) {
      var r = post[ak.kode];
      if (!r) return;
      var v = -(r.d - r.k);
      if (v === 0) return;
      if (ak.arus === 'I') rincianInvestasi.push({ akun: ak, jumlah: v });
      else if (ak.arus === 'F') rincianPendanaan.push({ akun: ak, jumlah: v });
    });

    var totalArus = D.add(D.add(operasi, investasi), pendanaan);
    var kasAkhirHitung = D.add(kasAwal, totalArus);

    return {
      dari: dari, sampai: sampai,
      labaNeto: lr.labaNeto,
      penyusutan: penyusutan, rincianNonKas: rincianNonKas, bebanPenyusutan: bebanPenyusutan,
      modalKerja: modalKerja, totModalKerja: totModalKerja,
      operasi: operasi, operasiSusun: operasiSusun,
      /* If the presented operating section ever disagrees with the bucket
       * algebra, the difference is shown rather than swallowed. It cannot happen
       * without a bug, and if it happens the reader needs to know first. */
      operasiSelisih: operasi - operasiSusun,
      investasi: investasi, rincianInvestasi: rincianInvestasi,
      pendanaan: pendanaan, rincianPendanaan: rincianPendanaan,
      totalArus: totalArus,
      kasAwal: kasAwal, kasAwalRinci: kasAwalR.rinci,
      kasAkhir: kasAkhir, kasAkhirRinci: kasAkhirR.rinci,
      kasAkhirHitung: kasAkhirHitung,
      /* THE reconciliation. Two independently computed figures: the statement's
       * bottom line, and the cash accounts' balance summed straight out of the
       * ledger. */
      selisihRekonsiliasi: kasAkhir - kasAkhirHitung,
      rekonsiliasi: kasAkhir - kasAkhirHitung === 0,
      kasGerakLedger: kasGerak,
      selisihGerak: (kasAkhir - kasAwal) - kasGerak,
      bucket: bucket
    };
  };

  /* ======================================================= jurnal penutup */

  /* I5. Four steps, in the order every Indonesian bookkeeping text teaches them,
   * each one a balanced entry in its own right rather than one giant entry — so
   * the general ledger shows what was closed and when, and a reader can follow
   * the profit from the revenue accounts into Ikhtisar Laba Rugi and out again
   * into Saldo Laba.
   *
   * Built from LIVE balances, which makes it idempotent: run it on an
   * already-closed book and every balance is zero, so it produces no entries at
   * all. That property is asserted, and it is what stops a second click from
   * quietly doubling the retained earnings. */
  L.rencanaPenutup = function (buku, sampai, o) {
    o = o || {};
    var dari = o.dari || null;
    var entries = L.pilih(buku, { sampai: sampai, dari: dari });
    var post = L.postingan(entries);
    var langkah = [];

    function saldoNat(ak) {
      var r = post[ak.kode];
      if (!r) return 0;
      return D.saldoNatural(ak, r.d, r.k);
    }

    /* The RAW balance, debit minus credit. A closing entry has to post the exact
     * opposite of this to leave the account at zero, and that is a question
     * about which side the balance physically sits on — not about which side the
     * account normally sits on, and not about its type. Using the natural
     * balance instead worked only while every nominal account's `normal`
     * matched its type: a contra-revenue account with a debit balance was
     * DEBITED again by the closing entry and came out of the close carrying
     * twice what it went in with. */
    function saldoMentah(ak) {
      var r = post[ak.kode];
      if (!r) return 0;
      return r.d - r.k;
    }

    /* The line that zeroes an account: post the opposite of its raw balance. */
    function barisTutup(ak, catatan) {
      var m = saldoMentah(ak);
      return { akun: ak.kode, d: m < 0 ? -m : 0, k: m > 0 ? m : 0, catatan: catatan };
    }

    var tujuan = o.tujuan || '3201';        // Saldo Laba
    var ikhtisar = '3999';

    /* 1. Revenue accounts to Ikhtisar Laba Rugi. */
    var barisP = [], totP = 0;
    D.akunTipe('Pendapatan').forEach(function (ak) {
      var m = saldoMentah(ak);
      if (m === 0) return;
      barisP.push(barisTutup(ak, 'menutup ' + ak.kode));
      /* Type-signed, so a contra-revenue account reduces the revenue being
       * closed instead of adding to it. This total feeds `laba` below, which is
       * asserted equal to labaRugi().labaNeto — both now read the sign off the
       * type, so the two cannot drift apart. */
      totP = D.add(totP, -m);
    });
    if (barisP.length) {
      barisP.push({ akun: ikhtisar, d: totP < 0 ? -totP : 0, k: totP > 0 ? totP : 0, catatan: 'ikhtisar laba rugi' });
      langkah.push({ no: 1, nama: 'Menutup akun pendapatan ke Ikhtisar Laba Rugi', jenis: 'penutup', tgl: sampai, baris: barisP, jumlah: Math.abs(totP) });
    }

    /* 2. Expense accounts to Ikhtisar Laba Rugi. */
    var barisB = [], totB = 0;
    D.akunTipe('Beban').forEach(function (ak) {
      var m = saldoMentah(ak);
      if (m === 0) return;
      barisB.push(barisTutup(ak, 'menutup ' + ak.kode));
      totB = D.add(totB, m);
    });
    if (barisB.length) {
      barisB.unshift({ akun: ikhtisar, d: totB > 0 ? totB : 0, k: totB < 0 ? -totB : 0, catatan: 'ikhtisar laba rugi' });
      langkah.push({ no: 2, nama: 'Menutup akun beban ke Ikhtisar Laba Rugi', jenis: 'penutup', tgl: sampai, baris: barisB, jumlah: Math.abs(totB) });
    }

    /* 3. Ikhtisar Laba Rugi to Saldo Laba. The residual after steps 1 and 2 is
     * the period's profit, and it must equal labaRugi().labaNeto — asserted. */
    var laba = totP - totB;
    if (laba !== 0) {
      langkah.push({
        no: 3, nama: (laba > 0 ? 'Memindahkan laba' : 'Memindahkan rugi') + ' dari Ikhtisar Laba Rugi ke Saldo Laba',
        jenis: 'penutup', tgl: sampai, jumlah: Math.abs(laba),
        baris: [
          { akun: ikhtisar, d: laba > 0 ? laba : 0, k: laba < 0 ? -laba : 0, catatan: 'menutup ikhtisar' },
          { akun: tujuan, d: laba < 0 ? -laba : 0, k: laba > 0 ? laba : 0, catatan: laba > 0 ? 'laba neto periode' : 'rugi neto periode' }
        ]
      });
    }

    /* 4. Prive to Saldo Laba. Not a nominal account, but it is closed at the
     * same time in every Indonesian sole-proprietorship close, and it has to go
     * somewhere or it accumulates across years. Equity to equity, so the total
     * does not move. (The textbook alternative closes Prive against Modal
     * Pemilik instead; the destination is one constant, `tujuan`.) */
    var privAk = D.akun('3102');
    var privM = saldoMentah(privAk);
    var priv = saldoNat(privAk);
    if (privM !== 0) {
      langkah.push({
        no: 4, nama: 'Menutup Prive Pemilik ke Saldo Laba', jenis: 'penutup', tgl: sampai, jumlah: Math.abs(privM),
        baris: [
          { akun: tujuan, d: privM > 0 ? privM : 0, k: privM < 0 ? -privM : 0, catatan: 'pengambilan pemilik' },
          barisTutup(privAk, 'menutup prive')
        ]
      });
    }

    return { sampai: sampai, tujuan: tujuan, langkah: langkah, laba: laba, totalPendapatan: totP, totalBeban: totB, kosong: langkah.length === 0 };
  };

  L.postingPenutup = function (buku, sampai, o) {
    o = o || {};
    var rencana = L.rencanaPenutup(buku, sampai, o);
    var hasil = [];
    for (var i = 0; i < rencana.langkah.length; i++) {
      var lg = rencana.langkah[i];
      hasil.push(L.tambah(buku, {
        tgl: lg.tgl, jenis: 'penutup', memo: lg.nama, baris: lg.baris,
        oleh: o.oleh, peran: o.peran, sumber: o.sumber
      }, o));
    }
    return { rencana: rencana, entries: hasil };
  };

  /* Simulate a close on a COPY of the book, so the invariant checker can assert
   * I5 on a book nobody has closed yet without mutating it. A structuredClone
   * would do, but a hand-built shallow copy of the arrays is enough here and
   * works in every engine: entries are never mutated after creation, so sharing
   * the entry objects is safe. */
  L.salin = function (buku) {
    var b = {
      entries: buku.entries.slice(),
      seqBerikut: buku.seqBerikut,
      nomorBerikut: {},
      tutup: {},
      indexId: {}
    };
    for (var k in buku.nomorBerikut) if (Object.prototype.hasOwnProperty.call(buku.nomorBerikut, k)) b.nomorBerikut[k] = buku.nomorBerikut[k];
    for (var p in buku.tutup) if (Object.prototype.hasOwnProperty.call(buku.tutup, p)) b.tutup[p] = buku.tutup[p];
    for (var i = 0; i < b.entries.length; i++) b.indexId[b.entries[i].id] = b.entries[i];
    return b;
  };

  L.sudahDitutup = function (buku, sampai, dari) {
    var pen = L.pilih(buku, { dari: dari, sampai: sampai, hanyaJenis: ['penutup'], efektif: false });
    return pen.length > 0;
  };

  /* ============================================== pajak (PPN dan PPh final) */

  /* PPN position. Two accounts, never netted in the ledger: PPN Masukan is an
   * asset (tax paid on purchases, reclaimable) and PPN Keluaran is a liability
   * (tax collected on sales, owed). What is netted is the POSITION for a period,
   * and the sign of that net is the difference between a payment due (kurang
   * bayar) and a credit carried forward (lebih bayar). */
  L.posisiPpn = function (buku, o) {
    o = o || {};
    var entries = L.pilih(buku, { dari: o.dari, sampai: o.sampai, kecualiJenis: ['penutup'] });
    var post = L.postingan(entries);
    var m = post['1501'], k = post['2104'];
    var masukan = m ? (m.d - m.k) : 0;
    var keluaran = k ? (k.k - k.d) : 0;
    var net = keluaran - masukan;
    return {
      dari: o.dari, sampai: o.sampai,
      masukan: masukan, keluaran: keluaran, net: net,
      posisi: net > 0 ? 'kurang bayar' : (net < 0 ? 'lebih bayar' : 'nihil'),
      /* Cumulative balances as they stand on the balance sheet, which is what
       * the reader will compare against — the period's own movements above, the
       * standing balances here. */
      saldoMasukan: L.saldoAkun(buku, '1501', { sampai: o.sampai, kecualiJenis: ['penutup'] }).saldo,
      saldoKeluaran: L.saldoAkun(buku, '2104', { sampai: o.sampai, kecualiJenis: ['penutup'] }).saldo
    };
  };

  /* PPh final UMKM: 0,5% of gross turnover, per month, computed from the revenue
   * accounts flagged `bruto` rather than from anything stored. The comparison
   * against what was actually booked to 5301 is the point of the table: if a
   * month's expense does not equal 0,5% of that month's turnover, the table says
   * so and by how much. */
  L.pphFinalBulanan = function (buku, tahun, o) {
    o = o || {};
    /* The Rp 500 juta that is not subject to tax for a WP orang pribadi is
     * CUMULATIVE across the tax year, so this loop has to carry a running
     * turnover column — the exemption is spent by the earliest masa and the
     * first taxable masa is the one that crosses it. Pass bebas: 0 for a badan. */
    var bebas = o.bebas === undefined || o.bebas === null ? D.PPH_FINAL_BEBAS : o.bebas;
    var baris = [], totBruto = 0, totPajak = 0, totBooked = 0, totKena = 0, totBebas = 0;
    var kumulatif = 0;
    for (var m = 1; m <= 12; m++) {
      var p = tahun + '-' + String(m).padStart(2, '0');
      var dari = D.awalBulan(p), sampai = D.akhirBulan(p);
      var entries = L.pilih(buku, { dari: dari, sampai: sampai, kecualiJenis: ['penutup'] });
      var post = L.postingan(entries);
      var bruto = 0;
      D.AKUN.forEach(function (ak) {
        if (!ak.bruto) return;
        var r = post[ak.kode];
        if (!r) return;
        /* Type-signed, so a contra-revenue account flagged `bruto` reduces the
         * masa's turnover instead of inflating it. */
        bruto = D.add(bruto, D.NORMAL_TIPE[ak.tipe] === 'D' ? (r.d - r.k) : (r.k - r.d));
      });
      var dasar = D.pphFinalDasar(kumulatif, bruto, bebas);
      var seharusnya = dasar.kena <= 0 ? 0 : D.pphFinal(dasar.kena);
      var r5301 = post['5301'];
      var dibukukan = r5301 ? (r5301.d - r5301.k) : 0;
      baris.push({
        periode: p, bruto: bruto,
        kumulatifSebelum: kumulatif, kumulatifSesudah: D.add(kumulatif, bruto),
        bebasDipakai: dasar.bebasDipakai, sisaBebas: dasar.sisaBebasSesudah, kena: dasar.kena,
        seharusnya: seharusnya, dibukukan: dibukukan,
        selisih: dibukukan - seharusnya, cocok: dibukukan === seharusnya
      });
      kumulatif = D.add(kumulatif, bruto);
      totBruto = D.add(totBruto, bruto);
      totKena = D.add(totKena, dasar.kena);
      totBebas = D.add(totBebas, dasar.bebasDipakai);
      totPajak = D.add(totPajak, seharusnya);
      totBooked = D.add(totBooked, dibukukan);
    }
    return {
      tahun: tahun, baris: baris, totalBruto: totBruto, totalSeharusnya: totPajak, totalDibukukan: totBooked,
      bebas: bebas, totalBebasDipakai: totBebas, totalKena: totKena,
      sisaBebas: bebas - totBebas > 0 ? bebas - totBebas : 0,
      selisih: totBooked - totPajak, cocok: totBooked === totPajak,
      diBawahBatas: totBruto <= D.PPH_FINAL_BATAS_OMZET,
      batas: D.PPH_FINAL_BATAS_OMZET
    };
  };

  /* ============================================ pemeriksaan invarian I1–I7 */

  /* Recomputed from the RAW journal every time it is called. It shares no cache
   * with the statements it is checking — that is the whole point of it. A green
   * badge that was computed from the same cached totals as the screen is
   * decoration; this one takes buku.entries and starts again.
   *
   * Every check names the invariant it belongs to, and every check reports its
   * figures whether it passed or failed, so a reader can do the arithmetic. */
  L.periksaBuku = function (buku, o) {
    o = o || {};
    var cek = [];
    function ok(inv, nama, lulus, pesan) { cek.push({ inv: inv, nama: nama, ok: !!lulus, pesan: pesan || '' }); }

    /* A checker that crashes has told the reader nothing, and it crashes on
     * exactly the books it exists to catch: postingan() throws on a fractional
     * amount, so one smuggled float would take the whole panel down instead of
     * turning one line red. Every block that consumes the statements runs inside
     * this, and an exception becomes a FAILED check carrying its own message. */
    function aman(inv, nama, fn) {
      try { fn(); }
      catch (e) { ok(inv, nama, false, 'pemeriksaan melempar: ' + String(e && e.message || e)); }
    }

    var semua = L.urut(buku.entries);
    var dari = o.dari || null, sampai = o.sampai || (semua.length ? semua[semua.length - 1].tgl : null);
    var tahunDari = o.tahunDari || (dari ? dari : null);

    /* ---------------------------------------------------------------- I1 */
    var tidakSeimbang = [], nolEntri = [], duaSisi = [], bukanBulat = [], akunAsing = [], kurangBaris = [];
    for (var i = 0; i < semua.length; i++) {
      var e = semua[i], td = 0, tk = 0, isi = 0;
      for (var j = 0; j < e.baris.length; j++) {
        var b = e.baris[j];
        if (!D.isInt(b.d) || !D.isInt(b.k)) bukanBulat.push(e.no + ' baris ' + (j + 1));
        if (b.d > 0 && b.k > 0) duaSisi.push(e.no + ' baris ' + (j + 1));
        if (!D.adaAkun(b.akun)) akunAsing.push(e.no + ':' + b.akun);
        td += b.d; tk += b.k;
        if (b.d || b.k) isi++;
      }
      if (td !== tk) tidakSeimbang.push(e.no + ' (D ' + td + ' vs K ' + tk + ')');
      if (td === 0) nolEntri.push(e.no);
      if (isi < 2) kurangBaris.push(e.no);
    }
    ok('I1', 'Setiap entri jurnal seimbang: sum(debit) = sum(kredit) pada seluruh ' + semua.length + ' entri',
      tidakSeimbang.length === 0,
      tidakSeimbang.length ? 'tidak seimbang: ' + tidakSeimbang.slice(0, 4).join(', ') : semua.length + ' entri diperiksa satu per satu dari baris mentahnya');
    ok('I1', 'Tidak ada entri bernilai nol', nolEntri.length === 0, nolEntri.length ? nolEntri.slice(0, 4).join(', ') : 'nol entri kosong');
    ok('I1', 'Tidak ada baris yang berisi debit dan kredit sekaligus', duaSisi.length === 0, duaSisi.length ? duaSisi.slice(0, 4).join(', ') : 'nol baris ganda');
    ok('I1', 'Setiap entri punya sedikitnya dua baris berisi', kurangBaris.length === 0, kurangBaris.length ? kurangBaris.slice(0, 4).join(', ') : 'nol entri bersisi tunggal');
    ok('I1', 'Setiap baris menunjuk akun yang ada di bagan akun', akunAsing.length === 0, akunAsing.length ? akunAsing.slice(0, 4).join(', ') : D.AKUN.length + ' akun di bagan, tidak ada posting ke luar bagan');

    /* ------------------------------------------------------ tanpa pecahan */
    ok('I1', 'Tidak satu pun nilai rupiah di buku berupa pecahan', bukanBulat.length === 0,
      bukanBulat.length ? bukanBulat.slice(0, 4).join(', ') : 'seluruh nilai debit dan kredit bilangan bulat');

    /* ---------------------------------------------------------------- I2 */
    ['sebelum', 'setelah', 'penutup'].forEach(function (tahap) {
      var label = 'Neraca saldo ' + (tahap === 'sebelum' ? 'sebelum penyesuaian' : tahap === 'setelah' ? 'setelah penyesuaian' : 'setelah penutupan') + ' seimbang';
      aman('I2', label, function () {
        var ns = L.neracaSaldo(buku, { sampai: sampai, tahap: tahap });
        ok('I2', label, ns.seimbang, 'debit ' + D.rupiah(ns.totalDebit) + ' = kredit ' + D.rupiah(ns.totalKredit) +
          (ns.seimbang ? '' : ', selisih ' + D.rupiah(ns.selisih)));
      });
    });

    /* ---------------------------------------------------------------- I7 */
    /* Two independent routes to every balance: a single accumulate pass over all
     * postings, and a per-account filter-and-sum that never sees the map. They
     * must agree for every account in the chart. */
    aman('I7', 'Saldo setiap akun sama dengan jumlah postingnya — dihitung lewat dua jalur terpisah', function () {
      var postA = L.postingan(semua);
      var bedaAkun = [], nAkunDicek = 0;
      D.AKUN.forEach(function (ak) {
        nAkunDicek++;
        var jalur2 = L.saldoAkun(buku, ak.kode, {});
        var r = postA[ak.kode];
        var d1 = r ? r.d : 0, k1 = r ? r.k : 0;
        if (d1 !== jalur2.debit || k1 !== jalur2.kredit) {
          bedaAkun.push(ak.kode + ' (' + d1 + '/' + k1 + ' vs ' + jalur2.debit + '/' + jalur2.kredit + ')');
        }
      });
      ok('I7', 'Saldo setiap akun sama dengan jumlah postingnya — dihitung lewat dua jalur terpisah pada ' + nAkunDicek + ' akun',
        bedaAkun.length === 0, bedaAkun.length ? bedaAkun.slice(0, 4).join(', ') : 'dua jalur sepakat di seluruh akun');
    });

    /* And that no balance is STORED. An entry carrying a saldo field would mean
     * some code path had cached one, which is the failure mode this invariant
     * exists to prevent. */
    var adaSaldoTersimpan = [];
    for (i = 0; i < semua.length; i++) {
      if (Object.prototype.hasOwnProperty.call(semua[i], 'saldo')) adaSaldoTersimpan.push(semua[i].no);
      for (j = 0; j < semua[i].baris.length; j++) {
        if (Object.prototype.hasOwnProperty.call(semua[i].baris[j], 'saldo')) adaSaldoTersimpan.push(semua[i].no + ':' + j);
      }
    }
    ok('I7', 'Tidak ada saldo yang disimpan di dalam entri — saldo hanya ada sebagai hasil hitung',
      adaSaldoTersimpan.length === 0, adaSaldoTersimpan.length ? adaSaldoTersimpan.slice(0, 4).join(', ') : 'nol field saldo pada entri maupun baris');

    /* Running balance in the general ledger equals the account's balance. */
    aman('I7', 'Saldo berjalan di buku besar berakhir pada saldo akun yang sama', function () {
      var bedaJalan = [];
      D.AKUN.forEach(function (ak) {
        var bb = L.bukuBesar(buku, ak.kode, {});
        var s = L.saldoAkun(buku, ak.kode, {});
        if (bb.saldoAkhir !== s.saldo) bedaJalan.push(ak.kode + ' (' + bb.saldoAkhir + ' vs ' + s.saldo + ')');
      });
      ok('I7', 'Saldo berjalan di buku besar berakhir pada saldo akun yang sama',
        bedaJalan.length === 0, bedaJalan.length ? bedaJalan.slice(0, 4).join(', ') : 'saldo berjalan cocok di seluruh akun');
    });

    /* ---------------------------------------------------------------- I3 */
    /* At EVERY date, not just at the close. Walk the sorted book accumulating
     * per-type sums and test the identity at each date boundary. */
    var tgl = null, akum = { Aset: 0, Liabilitas: 0, Ekuitas: 0, Pendapatan: 0, Beban: 0 };
    var tglDicek = 0, gagalTgl = [], terburuk = 0;
    function ujiIdentitas(pada) {
      tglDicek++;
      var laba = akum.Pendapatan - akum.Beban;
      var kanan = akum.Liabilitas + laba + akum.Ekuitas;
      var s = akum.Aset - kanan;
      if (Math.abs(s) > Math.abs(terburuk)) terburuk = s;
      if (s !== 0) gagalTgl.push(pada + ' selisih ' + s);
    }
    for (i = 0; i < semua.length; i++) {
      if (tgl !== null && semua[i].tgl !== tgl) ujiIdentitas(tgl);
      tgl = semua[i].tgl;
      for (j = 0; j < semua[i].baris.length; j++) {
        var bb2 = semua[i].baris[j];
        var ak2 = D.akun(bb2.akun);
        if (!ak2) continue;
        /* Sign from the TYPE's normal side, exactly as in perTipe — and computed
         * here from the raw baris rather than by calling perTipe, so the date
         * walk is a second independent implementation of the same identity. */
        akum[ak2.tipe] += D.NORMAL_TIPE[ak2.tipe] === 'D' ? (bb2.d - bb2.k) : (bb2.k - bb2.d);
      }
    }
    if (tgl !== null) ujiIdentitas(tgl);
    ok('I3', 'Aset = Liabilitas + Ekuitas pada SETIAP tanggal di buku (' + tglDicek + ' tanggal diperiksa)',
      gagalTgl.length === 0,
      gagalTgl.length ? gagalTgl.slice(0, 3).join('; ') : 'identitas utuh di seluruh ' + tglDicek + ' tanggal, selisih terburuk ' + terburuk);

    var pers = { aset: 0, liabilitas: 0, ekuitas: 0, selisih: 0, seimbang: false };
    aman('I3', 'Aset = Liabilitas + Ekuitas per ' + (sampai ? D.tglPanjang(sampai) : 'akhir buku'), function () {
      pers = L.persamaan(buku, sampai);
      ok('I3', 'Aset = Liabilitas + Ekuitas per ' + (sampai ? D.tglPanjang(sampai) : 'akhir buku'),
        pers.seimbang,
        'aset ' + D.rupiah(pers.aset) + ' = liabilitas ' + D.rupiah(pers.liabilitas) + ' + ekuitas ' + D.rupiah(pers.ekuitas) +
        (pers.seimbang ? '' : ' — selisih ' + D.rupiah(pers.selisih)));
    });

    /* ---------------------------------------------------------------- I4 */
    if (tahunDari && sampai) aman('I4', 'Laporan keuangan bisa disusun atas buku ini', function () {
      var lr = L.labaRugi(buku, tahunDari, sampai);
      var pe = L.perubahanEkuitas(buku, tahunDari, sampai, { labaRugi: lr });
      var nr = L.neraca(buku, sampai, { dari: tahunDari, labaRugi: lr });

      ok('I4', 'Laba bersih pada Laba Rugi = baris laba pada Perubahan Ekuitas',
        lr.labaNeto === pe.labaNeto,
        D.rupiah(lr.labaNeto) + ' vs ' + D.rupiah(pe.labaNeto));

      ok('I4', 'Ekuitas akhir pada Perubahan Ekuitas = total ekuitas pada Neraca',
        pe.ekuitasAkhir === nr.totalEkuitas,
        D.rupiah(pe.ekuitasAkhir) + ' vs ' + D.rupiah(nr.totalEkuitas) +
        (pe.ekuitasAkhir === nr.totalEkuitas ? '' : ' — selisih ' + D.rupiah(pe.ekuitasAkhir - nr.totalEkuitas)));

      /* The independent derivation: reported equity moved by exactly the profit,
       * plus owner contributions, minus drawings. Nothing in this line is taken
       * from labaRugi(). */
      var awalP = L.persamaan(buku, null, { entries: L.pilih(buku, { sebelum: tahunDari }) });
      var gerakEkuitas = pers.ekuitas - awalP.ekuitas;
      var labaTurunan = gerakEkuitas - pe.setoran + pe.prive - pe.lainEkuitas;
      ok('I4', 'Laba bersih diturunkan ulang dari pergerakan ekuitas di Neraca dan cocok ke rupiah',
        labaTurunan === lr.labaNeto,
        'gerak ekuitas ' + D.rupiah(gerakEkuitas) + ' − setoran ' + D.rupiah(pe.setoran) + ' + prive ' + D.rupiah(pe.prive) +
        ' = ' + D.rupiah(labaTurunan) + ' vs laba rugi ' + D.rupiah(lr.labaNeto));

      ok('I4', 'Perubahan Ekuitas menutup sendiri: awal + laba + setoran − prive = akhir',
        pe.cocok, D.rupiah(pe.ekuitasAwal) + ' + ' + D.rupiah(pe.labaNeto) + ' + ' + D.rupiah(pe.setoran) +
        ' − ' + D.rupiah(pe.prive) + ' = ' + D.rupiah(pe.ekuitasAkhirHitung) + (pe.cocok ? '' : ' vs ' + D.rupiah(pe.ekuitasAkhir)));

      ok('I4', 'Neraca sendiri seimbang: total aset = total liabilitas + ekuitas',
        nr.seimbang, D.rupiah(nr.totalAset) + ' = ' + D.rupiah(nr.kanan) + (nr.seimbang ? '' : ' — selisih ' + D.rupiah(nr.selisih)));

      /* ---------------------------------------------------------------- I6 */
      var ak = L.arusKas(buku, tahunDari, sampai, { labaRugi: lr });
      ok('I6', 'Arus kas rekonsiliasi: kas awal + operasi + investasi + pendanaan = kas akhir',
        ak.rekonsiliasi,
        D.rupiah(ak.kasAwal) + ' + ' + D.rupiah(ak.operasi) + ' + ' + D.rupiah(ak.investasi) + ' + ' + D.rupiah(ak.pendanaan) +
        ' = ' + D.rupiah(ak.kasAkhirHitung) + (ak.rekonsiliasi ? '' : ' vs kas akhir ' + D.rupiah(ak.kasAkhir) + ', selisih ' + D.rupiah(ak.selisihRekonsiliasi)));

      var kasLedger = L.saldoKas(buku, { sampai: sampai });
      ok('I6', 'Kas akhir pada laporan arus kas = saldo akun kas di buku besar',
        ak.kasAkhir === kasLedger.total,
        D.rupiah(ak.kasAkhir) + ' vs buku besar ' + D.rupiah(kasLedger.total));

      ok('I6', 'Bagian operasi yang disajikan (laba + penyusutan ± modal kerja) = bagian operasi dari aljabar bucket',
        ak.operasiSelisih === 0,
        'disusun ' + D.rupiah(ak.operasiSusun) + ' vs aljabar ' + D.rupiah(ak.operasi) +
        (ak.operasiSelisih === 0 ? '' : ' — selisih ' + D.rupiah(ak.operasiSelisih)));

      ok('I6', 'Penyesuaian non-kas pada arus kas = beban penyusutan pada Laba Rugi',
        ak.penyusutan === ak.bebanPenyusutan,
        'akumulasi penyusutan bertambah ' + D.rupiah(ak.penyusutan) + ', beban penyusutan ' + D.rupiah(ak.bebanPenyusutan));

      ok('I6', 'Pergerakan kas menurut laporan = pergerakan kas menurut posting akun kas',
        ak.selisihGerak === 0,
        D.rupiah(ak.kasAkhir - ak.kasAwal) + ' vs posting ' + D.rupiah(ak.kasGerakLedger));

      ok('I6', 'Laba bersih yang membuka laporan arus kas = laba bersih pada Laba Rugi',
        ak.labaNeto === lr.labaNeto, D.rupiah(ak.labaNeto) + ' vs ' + D.rupiah(lr.labaNeto));

      /* Closing entries must not touch cash, which is what licenses excluding
       * them from the cash flow statement. */
      /* NOTE the absence of `efektif: false` here, which is deliberate and was
       * once wrong. arusKas() excludes entries by their EFFECTIVE jenis, so a
       * koreksi over a closing entry — jenis 'koreksi', jenisEfektif 'penutup' —
       * is excluded from the statement too. Checking only the literally-'penutup'
       * documents left exactly that case unchecked: a correction that added a
       * cash line to a closing entry was dropped from the cash flow statement on
       * the strength of a licence check that had never looked at it. The check
       * now walks the same set L.pilih walks inside arusKas. (Line 1096 and the
       * closing-figure recovery below keep `efektif: false` on purpose: there the
       * question really is "which documents were posted as closing entries".) */
      var penutupKas = [];
      L.pilih(buku, { hanyaJenis: ['penutup'] }).forEach(function (e2) {
        e2.baris.forEach(function (b2) { if (D.akun(b2.akun) && D.akun(b2.akun).kas) penutupKas.push(e2.no); });
      });
      ok('I6', 'Tidak ada jurnal penutup yang menyentuh akun kas — itu yang membuat pengecualiannya sah',
        penutupKas.length === 0, penutupKas.length ? penutupKas.join(', ') : 'nol baris kas di seluruh jurnal penutup');

      /* ---------------------------------------------------------------- I5 */
      /* Closing is simulated on a copy, so this check is meaningful whether or
       * not the live book has been closed yet. */
      var salinan = L.salin(buku);
      var pra = L.persamaan(salinan, sampai);
      var praNeraca = L.neraca(salinan, sampai, { dari: tahunDari });
      var hasilTutup;
      var tutupError = null;
      try {
        hasilTutup = L.postingPenutup(salinan, sampai, { peran: 'supervisor', oleh: 'simulasi', dari: null, izinTerkunci: true });
      } catch (err) { tutupError = String(err && err.message || err); }

      if (tutupError) {
        ok('I5', 'Simulasi jurnal penutup berjalan', false, tutupError);
      } else {
        var nsTutup = L.neracaSaldo(salinan, { sampai: sampai, tahap: 'penutup', semuaAkun: true });
        var nominalSisa = [];
        nsTutup.baris.forEach(function (r) {
          if (!D.isNominal(r.akun)) return;
          if (r.debit !== 0 || r.kredit !== 0) nominalSisa.push(r.akun.kode + ' ' + (r.debit || -r.kredit));
        });
        ok('I5', 'Setelah jurnal penutup, SETIAP akun nominal bersaldo nol pada neraca saldo',
          nominalSisa.length === 0,
          nominalSisa.length ? 'masih bersaldo: ' + nominalSisa.join(', ')
            : D.akunTipe('Pendapatan').length + ' akun pendapatan dan ' + D.akunTipe('Beban').length + ' akun beban semuanya nol');

        var ikh = L.saldoAkun(salinan, '3999', {});
        ok('I5', 'Ikhtisar Laba Rugi kosong kembali setelah penutupan',
          ikh.saldo === 0, 'saldo 3999 = ' + D.rupiah(ikh.saldo));

        var pasca = L.persamaan(salinan, sampai);
        ok('I5', 'Neraca tidak berubah setelah penutupan: aset, liabilitas dan total ekuitas identik',
          pra.aset === pasca.aset && pra.liabilitas === pasca.liabilitas && pra.ekuitas === pasca.ekuitas,
          'aset ' + D.rupiah(pra.aset) + '→' + D.rupiah(pasca.aset) +
          ', liabilitas ' + D.rupiah(pra.liabilitas) + '→' + D.rupiah(pasca.liabilitas) +
          ', ekuitas ' + D.rupiah(pra.ekuitas) + '→' + D.rupiah(pasca.ekuitas));

        var nsTutupSeimbang = L.neracaSaldo(salinan, { sampai: sampai, tahap: 'penutup' });
        ok('I5', 'Neraca saldo setelah penutupan tetap seimbang',
          nsTutupSeimbang.seimbang, 'debit ' + D.rupiah(nsTutupSeimbang.totalDebit) + ' = kredit ' + D.rupiah(nsTutupSeimbang.totalKredit));

        /* Which closing figure to check depends on whether the LIVE book has
         * already been closed. If it has, the simulated close on the copy
         * correctly produces nothing, and the figure that matters is the one the
         * posted closing entries actually moved — recovered from those entries'
         * own lines, so this stays a check on the book rather than on the plan. */
        var sudahTutupLive = L.sudahDitutup(buku, sampai, tahunDari);
        if (sudahTutupLive) {
          var Rtutup = 0, Etutup = 0;
          L.pilih(buku, { dari: tahunDari, sampai: sampai, hanyaJenis: ['penutup'], efektif: false }).forEach(function (e3) {
            e3.baris.forEach(function (b3) {
              var a3 = D.akun(b3.akun);
              if (!a3) return;
              if (a3.tipe === 'Pendapatan') Rtutup = D.add(Rtutup, b3.d - b3.k);
              else if (a3.tipe === 'Beban') Etutup = D.add(Etutup, b3.k - b3.d);
            });
          });
          var labaDitutup = Rtutup - Etutup;
          ok('I5', 'Laba yang benar-benar dipindahkan oleh jurnal penutup yang sudah diposting = laba bersih pada Laba Rugi',
            labaDitutup === lr.labaNeto,
            'pendapatan ditutup ' + D.rupiah(Rtutup) + ' − beban ditutup ' + D.rupiah(Etutup) + ' = ' +
            D.rupiah(labaDitutup) + ' vs laba rugi ' + D.rupiah(lr.labaNeto));
        } else {
          ok('I5', 'Laba yang akan dipindahkan jurnal penutup = laba bersih pada Laba Rugi',
            hasilTutup.rencana.laba === lr.labaNeto,
            D.rupiah(hasilTutup.rencana.laba) + ' vs ' + D.rupiah(lr.labaNeto));
        }

        /* Idempotence: closing an already-closed book produces nothing. */
        var lagi = L.rencanaPenutup(salinan, sampai, {});
        ok('I5', 'Menutup buku yang sudah tertutup tidak menghasilkan entri apa pun',
          lagi.kosong, lagi.kosong ? 'rencana kosong, jadi klik kedua tidak menggandakan saldo laba' : lagi.langkah.length + ' langkah masih terbentuk');

        var praNeracaTutup = L.neraca(salinan, sampai, { dari: tahunDari });
        ok('I5', 'Total aset dan total ekuitas pada Neraca tidak bergeser sepeser pun karena penutupan',
          praNeraca.totalAset === praNeracaTutup.totalAset && praNeraca.totalEkuitas === praNeracaTutup.totalEkuitas,
          D.rupiah(praNeraca.totalAset) + '/' + D.rupiah(praNeraca.totalEkuitas) + ' → ' +
          D.rupiah(praNeracaTutup.totalAset) + '/' + D.rupiah(praNeracaTutup.totalEkuitas));

        /* And the cash flow statement must be identical before and after the
         * close — the property that licenses excluding closing entries. */
        var akTutup = L.arusKas(salinan, tahunDari, sampai);
        ok('I6', 'Laporan arus kas identik sebelum dan sesudah penutupan buku',
          akTutup.operasi === ak.operasi && akTutup.investasi === ak.investasi && akTutup.pendanaan === ak.pendanaan && akTutup.kasAkhir === ak.kasAkhir,
          'operasi ' + D.rupiah(ak.operasi) + '→' + D.rupiah(akTutup.operasi) +
          ', pendanaan ' + D.rupiah(ak.pendanaan) + '→' + D.rupiah(akTutup.pendanaan));
      }
    });

    /* ------------------------------------- periode terkunci benar-benar menolak */
    /* Probed live, not assumed: for every locked period, a well-formed balanced
     * entry dated inside it is offered to the validator and must come back
     * refused. A lock that is only drawn in the UI is not a lock. */
    var periodeTerkunci = L.periodeTutup(buku);
    var lolos = [];
    periodeTerkunci.forEach(function (p) {
      var probe = {
        tgl: D.akhirBulan(p), jenis: 'umum', memo: 'probe invarian',
        baris: [{ akun: '1101', d: 1000, k: 0 }, { akun: '4101', d: 0, k: 1000 }]
      };
      var v = L.periksaEntri(buku, probe, { peran: 'supervisor' });
      if (v.ok) lolos.push(p);
    });
    ok('I1', 'Setiap periode terkunci menolak entri baru — diuji dengan entri percobaan, bukan diasumsikan',
      lolos.length === 0,
      lolos.length ? 'periode ini masih menerima posting: ' + lolos.join(', ')
        : (periodeTerkunci.length ? periodeTerkunci.length + ' periode terkunci (' + periodeTerkunci[0] + '…' + periodeTerkunci[periodeTerkunci.length - 1] + ') semuanya menolak' : 'tidak ada periode terkunci di buku ini'));

    var lulus = cek.filter(function (c) { return c.ok; }).length;
    return { cek: cek, total: cek.length, lulus: lulus, gagal: cek.length - lulus };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
