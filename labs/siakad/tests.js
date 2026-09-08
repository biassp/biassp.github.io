/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — tests.js
 * Assertions against the engines, run in the page on load (the badge in the
 * header) and under node from the same file.
 *
 * The load-bearing ones, in order of how much damage they prevent:
 *   1. The solver never emits a timetable that violates a hard constraint.
 *      Checked by re-deriving every occupied cell from several independent
 *      solutions and looking for collisions pairwise — not by asking the
 *      solver whether it thinks it succeeded.
 *   2. A NISN is never reused, including by a student who has left.
 *   3. A weighting that does not total 100 is rejected, not rescaled.
 *   4. A rapor recomputes to the identical value from the identical inputs.
 *   5. Attendance rollups equal the underlying session records.
 *   6. A guru cannot write another guru's marks.
 */
(function (root) {
  'use strict';

  var D = root.SIAKAD_DOMAIN;
  var S = root.SIAKAD_DATA;
  var SV = root.SIAKAD_SOLVER;
  var A = root.SIAKAD_AKADEMIK;

  var groups = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  function makeCtx(results, groupName) {
    function record(ok, name, msg) {
      results.push({ group: groupName, name: name, ok: !!ok, message: ok ? '' : (msg || '') });
    }
    return {
      ok: function (v, name) { record(!!v, name, 'expected truthy, got ' + JSON.stringify(v)); },
      notOk: function (v, name) { record(!v, name, 'expected falsy, got ' + JSON.stringify(v)); },
      eq: function (a, b, name) { record(a === b, name, 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); },
      near: function (a, b, eps, name) { record(Math.abs(a - b) <= eps, name, 'expected ~' + b + ', got ' + a); }
    };
  }

  // One school, built once, shared by every group. Building it twice would
  // itself be a determinism check — so that is a test of its own below.
  var SCHOOL = null;
  function school() { return SCHOOL || (SCHOOL = S.build(20260915)); }
  function ctxFor(sc) {
    return { school: sc, konfig: { bobot: sc.bobot, kkm: sc.kkm }, nilaiOverrides: {}, presensiOverrides: {} };
  }

  /* =============================================== 1. hard constraints == */

  group('Solver — jadwal tidak pernah melanggar kendala keras', function (t) {
    var sc = school();
    var spec = S.buildJadwalSpec(sc, S.TA_AKTIF);
    t.eq(spec.sesi.length, 136, 'instance punya 136 sesi (8 rombel x 17 blok)');

    var solutions = [];
    for (var seed = 1; seed <= 3; seed++) {
      var r = SV.solve(S.buildJadwalSpec(sc, S.TA_AKTIF), { budgetMs: 6000, optimiseMs: seed === 1 ? 400 : 0, seed: seed * 31 });
      t.ok(r.ok, 'seed ' + seed + ': solver menemukan jadwal');
      if (r.ok) solutions.push(r.assign);
    }

    // Independent exhaustive re-check. This does NOT reuse the solver's own
    // occupancy board; it rebuilds the week cell by cell.
    for (var si = 0; si < solutions.length; si++) {
      var assign = solutions[si];
      var occGuru = {}, occRombel = {}, occRuang = {}, jp = {};
      var bentrok = { guru: 0, rombel: 0, ruang: 0 }, istirahat = 0, tidakTersedia = 0, ruangSalah = 0;
      var guruById = {}; sc.guru.forEach(function (g) { guruById[g.id] = g; });
      var ruangById = {}; sc.ruang.forEach(function (rr) { ruangById[rr.id] = rr; });

      for (var i = 0; i < spec.sesi.length; i++) {
        var se = spec.sesi[i], val = assign[se.id];
        if (!val) continue;
        var hari = S.HARI[val.hari];
        if (!SV.blockFits(hari, val.slot, se.len)) istirahat++;
        var ru = ruangById[val.ruangId];
        if (se.ruangTipe ? (ru.tipe !== se.ruangTipe) : (val.ruangId !== se.homeRuangId)) ruangSalah++;
        jp[se.rombelId + '|' + se.mapelId] = (jp[se.rombelId + '|' + se.mapelId] || 0) + se.len;
        for (var k = 0; k < se.len; k++) {
          var slot = val.slot + k, cell = val.hari + ':' + slot;
          var un = guruById[se.guruId].tidakTersedia;
          for (var u = 0; u < un.length; u++) if (un[u].hari === val.hari && un[u].slot === slot) tidakTersedia++;
          var kg = se.guruId + '@' + cell, kr = se.rombelId + '@' + cell, kx = val.ruangId + '@' + cell;
          if (occGuru[kg]) bentrok.guru++; else occGuru[kg] = se.id;
          if (occRombel[kr]) bentrok.rombel++; else occRombel[kr] = se.id;
          if (occRuang[kx]) bentrok.ruang++; else occRuang[kx] = se.id;
        }
      }
      t.eq(bentrok.guru, 0, 'solusi ' + (si + 1) + ' H1: tidak ada guru mengajar dua tempat sekaligus');
      t.eq(bentrok.rombel, 0, 'solusi ' + (si + 1) + ' H2: tidak ada rombel dengan dua mapel sekaligus');
      t.eq(bentrok.ruang, 0, 'solusi ' + (si + 1) + ' H3: tidak ada ruang dipakai dua rombel sekaligus');
      t.eq(tidakTersedia, 0, 'solusi ' + (si + 1) + ' H4: slot ketidaksediaan guru dihormati');
      t.eq(istirahat, 0, 'solusi ' + (si + 1) + ' H6: tidak ada blok yang terpotong istirahat');
      t.eq(ruangSalah, 0, 'solusi ' + (si + 1) + ' H7: mapel praktik mendapat ruang bertipe benar');

      var salahJp = 0, jumlahKunci = 0;
      for (var key in spec.wajibJp) { jumlahKunci++; if ((jp[key] || 0) !== spec.wajibJp[key]) salahJp++; }
      t.eq(salahJp, 0, 'solusi ' + (si + 1) + ' H5: JP per mapel per rombel tepat (' + jumlahKunci + ' pasangan diperiksa)');
    }
  });

  group('Solver — infeasibility dilaporkan, bukan disembunyikan', function (t) {
    var sc = S.build(20260915);
    var g = null;
    for (var i = 0; i < sc.guru.length; i++) if (sc.guru[i].mapelUtama === 'infm') g = sc.guru[i];
    for (var d = 0; d < S.HARI.length; d++) {
      for (var s = 1; s <= S.HARI[d].slots; s++) g.tidakTersedia.push({ hari: d, slot: s });
    }
    var r = SV.solve(S.buildJadwalSpec(sc, S.TA_AKTIF), { budgetMs: 3000, optimiseMs: 0, seed: 5 });
    t.notOk(r.ok, 'guru satu-satunya pengampu Informatika tidak tersedia seminggu penuh -> gagal');
    t.eq(r.assign, null, 'tidak ada jadwal setengah jadi yang dikembalikan');
    t.eq(r.diagnosis.tahap, 'pra-pencarian', 'terdeteksi sebelum pencarian dimulai');
    t.eq(r.diagnosis.sifat, 'terbukti', 'dilaporkan sebagai infeasibilitas terbukti');
    t.ok(/Informatika|INF/.test(r.diagnosis.judul), 'diagnosis menyebut mapel yang bermasalah');
    t.ok(r.diagnosis.pesan.indexOf(g.nama) >= 0, 'diagnosis menyebut guru yang jadwalnya menutup semua slot');
  });

  group('Solver — perpindahan manual divalidasi dengan alasan spesifik', function (t) {
    var sc = school();
    var spec = S.buildJadwalSpec(sc, S.TA_AKTIF);
    var r = SV.solve(spec, { budgetMs: 6000, optimiseMs: 0, seed: 9 });
    t.ok(r.ok, 'jadwal dasar tersusun');
    if (!r.ok) return;
    var assign = r.assign;

    // Move session X onto the exact cell session Y occupies, where X and Y
    // share the rombel: the answer must name the rombel and the other subject.
    var target = null, mover = null;
    for (var i = 0; i < spec.sesi.length && !target; i++) {
      for (var j = 0; j < spec.sesi.length; j++) {
        if (i === j) continue;
        if (spec.sesi[i].rombelId !== spec.sesi[j].rombelId) continue;
        if (spec.sesi[j].len < spec.sesi[i].len) continue;
        mover = spec.sesi[i]; target = spec.sesi[j]; break;
      }
    }
    var tv = assign[target.id];
    var res = SV.validateMove(spec, assign, mover.id, tv.hari, tv.slot, mover.homeRuangId);
    t.notOk(res.ok, 'menumpuk dua mapel pada rombel yang sama ditolak');
    var pesanRombel = res.violations.filter(function (v) { return v.jenis === 'H2'; });
    t.ok(pesanRombel.length > 0, 'pelanggaran diberi kode H2 (rombel bentrok)');
    t.ok(pesanRombel[0] && pesanRombel[0].pesan.indexOf(mover.rombelNama) >= 0, 'pesan menyebut rombel yang terdampak');
    t.ok(pesanRombel[0] && pesanRombel[0].pesan.indexOf(target.mapelNama) >= 0, 'pesan menyebut mapel yang sudah ada di slot itu');

    // A 3-JP block that would straddle istirahat.
    var tiga = null;
    for (i = 0; i < spec.sesi.length; i++) if (spec.sesi[i].len === 3) { tiga = spec.sesi[i]; break; }
    var res2 = SV.validateMove(spec, assign, tiga.id, 0, 3, tiga.homeRuangId); // Senin JP 3-5, istirahat after 4
    t.notOk(res2.ok, 'blok 3 JP yang melewati istirahat ditolak');
    t.ok(res2.violations.some(function (v) { return v.jenis === 'H6' && /istirahat/.test(v.pesan); }), 'alasannya menyebut istirahat, bukan sekadar "tidak valid"');

    // A teacher's declared unavailability.
    var guruTU = null;
    for (i = 0; i < sc.guru.length; i++) if (sc.guru[i].tidakTersedia.length) { guruTU = sc.guru[i]; break; }
    if (guruTU) {
      var sesiTU = null;
      for (i = 0; i < spec.sesi.length; i++) if (spec.sesi[i].guruId === guruTU.id && spec.sesi[i].len === 2) { sesiTU = spec.sesi[i]; break; }
      if (sesiTU) {
        var un = guruTU.tidakTersedia[0];
        var res3 = SV.validateMove(spec, assign, sesiTU.id, un.hari, un.slot, sesiTU.homeRuangId);
        t.notOk(res3.ok, 'menaruh guru pada slot ketidaksediaannya ditolak');
        t.ok(res3.violations.some(function (v) { return v.jenis === 'H4' && v.pesan.indexOf(guruTU.nama) >= 0; }), 'alasan H4 menyebut nama gurunya');
      }
    }

    // And a legal move is accepted, so the validator is not simply saying no.
    var kosong = null;
    var kelasSesi = spec.sesi.filter(function (x) {
      return x.rombelId === spec.sesi[0].rombelId && !x.ruangTipe;
    });
    var mv = kelasSesi[0];
    for (var d = 0; d < S.HARI.length && !kosong; d++) {
      for (var s = 1; s + mv.len - 1 <= S.HARI[d].slots && !kosong; s++) {
        if (!SV.blockFits(S.HARI[d], s, mv.len)) continue;
        var bebas = true;
        for (i = 0; i < spec.sesi.length && bebas; i++) {
          if (spec.sesi[i].id === mv.id) continue;
          var v2 = assign[spec.sesi[i].id];
          if (!v2 || v2.hari !== d) continue;
          // Overlap of [s, s+len-1] with the other block.
          if (s + mv.len - 1 < v2.slot || v2.slot + spec.sesi[i].len - 1 < s) continue;
          if (spec.sesi[i].rombelId === mv.rombelId ||
            spec.sesi[i].guruId === mv.guruId ||
            v2.ruangId === mv.homeRuangId) bebas = false;
        }
        if (bebas) kosong = { hari: d, slot: s };
      }
    }
    t.ok(!!kosong, 'ada slot yang benar-benar kosong untuk diuji');
    if (kosong) {
      var res4 = SV.validateMove(spec, assign, mv.id, kosong.hari, kosong.slot, mv.homeRuangId);
      t.ok(res4.ok, 'perpindahan ke slot yang benar-benar kosong DITERIMA — validator tidak sekadar menolak segalanya' +
        (res4.ok ? '' : ' :: ' + res4.violations.map(function (v) { return v.pesan; }).join(' / ')));
    }
  });

  /* ============================================ 2. identifiers & years == */

  group('Identitas — NISN, NIS dan nomor absen adalah tiga hal berbeda', function (t) {
    var sc = school();
    var seen = {}, dup = 0, salahBentuk = 0;
    for (var i = 0; i < sc.nisnUrut.length; i++) {
      var n = sc.nisnUrut[i];
      if (seen[n]) dup++; else seen[n] = 1;
      if (!D.isValidNisn(n)) salahBentuk++;
    }
    t.eq(dup, 0, 'tidak ada NISN ganda di antara ' + sc.nisnUrut.length + ' peserta didik');
    t.eq(salahBentuk, 0, 'setiap NISN 10 digit');

    // Registrants who were NOT admitted also hold NISN. Their numbers must not
    // be handed to anybody else — that is the whole meaning of "issued once".
    var semua = sc.registry.all(), seen2 = {}, dup2 = 0;
    for (i = 0; i < semua.length; i++) { if (seen2[semua[i]]) dup2++; else seen2[semua[i]] = 1; }
    t.eq(dup2, 0, 'registry menerbitkan ' + semua.length + ' NISN tanpa satu pun pengulangan');
    t.ok(semua.length > sc.nisnUrut.length, 'pendaftar PPDB yang tidak diterima tetap memegang NISN-nya');

    // A graduated student's number is still burned.
    var lulus = null;
    for (var k in sc.siswa) if (sc.siswa[k].status === 'lulus') { lulus = sc.siswa[k]; break; }
    t.ok(!!lulus, 'ada angkatan yang sudah lulus di dataset');
    t.ok(sc.registry.taken(lulus.nisn), 'NISN alumni tetap tercatat terpakai setelah lulus');

    // A fresh registry must never re-issue a taken number.
    var reg = new D.NisnRegistry(7);
    var a = reg.issue('x');
    t.ok(reg.taken(a), 'NISN yang baru terbit langsung tercatat terpakai');
    var ulang = 0;
    for (i = 0; i < 3000; i++) if (reg.issue('y') === a) ulang++;
    t.eq(ulang, 0, '3000 penerbitan berikutnya tidak pernah mengulang NISN pertama');

    // NIS is school-local and shaped by intake year; absen is positional.
    var contoh = sc.siswa[sc.nisnUrut[0]];
    t.ok(contoh.nis !== contoh.nisn, 'NIS bukan NISN');
    t.eq(D.makeNis(2026, 7), '261007', 'NIS mengikuti konvensi sekolah (tahun masuk + urut)');
    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var absens = rb.siswa.map(function (n) { return sc.siswa[n].enrol[S.TA_AKTIF].absen; });
    absens.sort(function (x, y) { return x - y; });
    var berurut = absens.every(function (v, ix) { return v === ix + 1; });
    t.ok(berurut, 'nomor absen ' + rb.nama + ' adalah 1..' + absens.length + ' tanpa lompatan');
  });

  group('Tahun ajaran — riwayat menempel pada tahunnya, bukan pada "sekarang"', function (t) {
    var sc = school();
    t.ok(D.tahunAjaranValid('2026/2027'), 'format tahun ajaran diterima');
    t.notOk(D.tahunAjaranValid('2026/2028'), 'tahun yang tidak berurutan ditolak');
    t.notOk(D.tahunAjaranValid('2026'), 'tahun tunggal ditolak');
    t.eq(D.semesterMonths('2026/2027', 'ganjil').length, 6, 'ganjil berisi 6 bulan');
    t.eq(D.semesterMonths('2026/2027', 'ganjil')[0].month, 7, 'ganjil dimulai Juli');
    t.eq(D.semesterMonths('2026/2027', 'genap')[0].year, 2027, 'genap jatuh pada tahun kalender kedua');

    // Same child, two years, two different rombel — and one year with none.
    var kelas7 = sc.rombelByTa[S.TA_AKTIF].filter(function (r) { return r.tingkat === 7; })[0];
    var baru = sc.siswa[kelas7.siswa[0]];
    t.ok(!!baru.enrol[S.TA_AKTIF], 'siswa kelas 7 terdaftar pada tahun aktif');
    t.notOk(baru.enrol[S.TA_LALU], 'siswa kelas 7 TIDAK punya keanggotaan rombel tahun lalu');

    var kelas9 = sc.rombelByTa[S.TA_AKTIF].filter(function (r) { return r.tingkat === 9; })[0];
    var lama = sc.siswa[kelas9.siswa[0]];
    t.ok(!!lama.enrol[S.TA_LALU], 'siswa kelas 9 punya keanggotaan tahun lalu juga');
    t.eq(lama.enrol[S.TA_LALU].tingkat, 8, 'tahun lalu ia kelas 8');
    t.eq(lama.enrol[S.TA_AKTIF].tingkat, 9, 'tahun ini ia kelas 9');
    t.ok(lama.enrol[S.TA_LALU].rombelId !== lama.enrol[S.TA_AKTIF].rombelId, 'rombel tahun lalu dan tahun ini adalah objek berbeda');

    var ctx = ctxFor(sc);
    var rLalu = A.hitungRapor(ctx, lama.nisn, S.TA_LALU, 'genap');
    var rKini = A.hitungRapor(ctx, lama.nisn, S.TA_AKTIF, 'ganjil');
    t.ok(rLalu.ok && rKini.ok, 'rapor kedua tahun tersedia');
    t.eq(rLalu.rombelNama, lama.enrol[S.TA_LALU].rombelNama, 'rapor tahun lalu memakai rombel tahun lalu');
    t.ok(A.canonicalRapor(rLalu) !== A.canonicalRapor(rKini), 'nilai tahun lalu tidak tertimpa nilai tahun ini');

    var kosong = A.hitungRapor(ctx, baru.nisn, S.TA_LALU, 'ganjil');
    t.notOk(kosong.ok, 'rapor tahun lalu untuk siswa kelas 7 ditolak, bukan dikembalikan kosong');
    t.ok(/tidak terdaftar/.test(kosong.alasan), 'penolakannya menjelaskan sebabnya');
  });

  /* ============================================== 3. penilaian & rapor == */

  group('Penilaian — bobot wajib berjumlah tepat 100%', function (t) {
    t.ok(D.validateBobot({ tugas: 20, uh: 30, pts: 20, pas: 30 }).ok, '20/30/20/30 diterima');
    t.ok(D.validateBobot({ tugas: 25, uh: 25, pts: 25, pas: 25 }).ok, '25/25/25/25 diterima');
    var kurang = D.validateBobot({ tugas: 20, uh: 30, pts: 20, pas: 20 });
    t.notOk(kurang.ok, 'total 90% ditolak');
    t.eq(kurang.total, 90, 'totalnya dilaporkan apa adanya');
    t.ok(/tepat 100/.test(kurang.errors[0]), 'pesan galat menyebut aturannya');
    t.notOk(D.validateBobot({ tugas: 30, uh: 30, pts: 20, pas: 30 }).ok, 'total 110% ditolak');
    t.notOk(D.validateBobot({ tugas: 20, uh: 30, pts: 20 }).ok, 'komponen hilang ditolak');
    t.notOk(D.validateBobot({ tugas: -10, uh: 40, pts: 40, pas: 30 }).ok, 'bobot negatif ditolak');
    t.notOk(D.validateBobot({ tugas: 'x', uh: 30, pts: 20, pas: 30 }).ok, 'bobot bukan angka ditolak');
    t.ok(D.validateBobot({ tugas: 33.33, uh: 33.33, pts: 33.34, pas: 0 }).ok, 'pecahan yang berjumlah 100 diterima');

    // And a rejected weighting must not produce a mark at all.
    var h = D.hitungNilaiAkhir({ tugas: 90, uh: 90, pts: 90, pas: 90 }, { tugas: 20, uh: 30, pts: 20, pas: 20 }, 70);
    t.notOk(h.ok, 'nilai akhir tidak dihitung dengan bobot tidak sah');
    t.eq(h.nilai, null, 'tidak ada angka yang dikembalikan diam-diam');
  });

  group('Penilaian — nilai akhir, KKM dan predikat', function (t) {
    var h = D.hitungNilaiAkhir({ tugas: 80, uh: 70, pts: 90, pas: 60 }, { tugas: 20, uh: 30, pts: 20, pas: 30 }, 70);
    t.ok(h.ok, 'perhitungan berhasil');
    // 16 + 21 + 18 + 18 = 73
    t.eq(h.nilai, 73, 'rata-rata terbobot dihitung benar');
    var jumlah = h.rincian.reduce(function (a, b) { return a + b.kontribusi; }, 0);
    t.near(jumlah, h.nilai, 0.011, 'rincian kontribusi menjumlah ke nilai akhir yang dicetak');
    t.ok(h.tuntas, '73 di atas KKM 70');
    t.eq(D.predikat(73, 70), 'C', '73 dengan KKM 70 adalah C');
    t.eq(D.predikat(69, 70), 'D', 'di bawah KKM selalu D');
    t.eq(D.predikat(100, 70), 'A', 'nilai sempurna adalah A');
    var b = D.predikatBands(70);
    t.eq(b.C, 70, 'ambang C adalah KKM');
    t.eq(b.B, 80, 'ambang B adalah KKM + interval');
    t.eq(b.A, 90, 'ambang A adalah KKM + 2 interval');
    // The same mark means different things under different KKM — the reason
    // predikat is derived and not a fixed table.
    t.eq(D.predikat(82, 70), 'B', '82 dengan KKM 70 adalah B');
    t.eq(D.predikat(82, 80), 'C', '82 dengan KKM 80 hanya C');
  });

  group('Rapor — perhitungan ulang deterministik', function (t) {
    var sc = school();
    var ctx = ctxFor(sc);
    var rb = sc.rombelByTa[S.TA_AKTIF][2];
    var nisn = rb.siswa[3];

    var a = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'ganjil');
    var bb = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'ganjil');
    t.eq(A.canonicalRapor(a), A.canonicalRapor(bb), 'dua perhitungan berturut-turut identik');

    // Rebuild the entire school from the seed and recompute: the derived data
    // must survive a cold start, not just a second call in one page.
    var sc2 = S.build(20260915);
    var c = A.hitungRapor(ctxFor(sc2), nisn, S.TA_AKTIF, 'ganjil');
    t.eq(A.canonicalRapor(a), A.canonicalRapor(c), 'sekolah dibangun ulang dari seed menghasilkan rapor yang sama persis');

    // An edit changes the result, and changes it by the amount the weighting says.
    var ov = {};
    ov[A.nilaiKey(S.TA_AKTIF, 'ganjil', nisn, 'mtk')] = { nilai: { pas: 100 }, oleh: 'G10' };
    var ctx2 = { school: sc, konfig: ctx.konfig, nilaiOverrides: ov, presensiOverrides: {} };
    var d1 = A.hitungRapor(ctx2, nisn, S.TA_AKTIF, 'ganjil');
    var barisAsli = null, barisEdit = null;
    a.baris.forEach(function (x) { if (x.mapel.id === 'mtk') barisAsli = x; });
    d1.baris.forEach(function (x) { if (x.mapel.id === 'mtk') barisEdit = x; });
    var delta = (100 - barisAsli.komponen.pas) * barisAsli.bobot.pas / 100;
    t.near(barisEdit.hasil.nilai - barisAsli.hasil.nilai, delta, 0.011, 'edit PAS menggeser nilai akhir tepat sebesar bobot x selisih');
    t.ok(barisEdit.diubah.pas, 'komponen yang diedit ditandai');
    t.notOk(barisEdit.diubah.tugas, 'komponen lain tidak ikut tertimpa oleh edit satu komponen');
    t.eq(A.canonicalRapor(d1), A.canonicalRapor(A.hitungRapor(ctx2, nisn, S.TA_AKTIF, 'ganjil')), 'rapor yang sudah diedit pun tetap deterministik');

    // Changing the weighting must move every mark, deterministically.
    var ctx3 = { school: sc, konfig: { bobot: JSON.parse(JSON.stringify(sc.bobot)), kkm: sc.kkm }, nilaiOverrides: {}, presensiOverrides: {} };
    ctx3.konfig.bobot.mtk = { tugas: 40, uh: 30, pts: 15, pas: 15 };
    var e1 = A.hitungRapor(ctx3, nisn, S.TA_AKTIF, 'ganjil');
    var e2 = A.hitungRapor(ctx3, nisn, S.TA_AKTIF, 'ganjil');
    t.eq(A.canonicalRapor(e1), A.canonicalRapor(e2), 'bobot baru tetap menghasilkan hasil yang sama pada perhitungan ulang');
    t.ok(A.canonicalRapor(e1) !== A.canonicalRapor(a), 'bobot baru benar-benar mengubah rapor');
  });

  /* ==================================================== 4. presensi == */

  group('Presensi — rekap sama dengan catatan sesi', function (t) {
    var sc = school();
    var ctx = ctxFor(sc);
    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var nisn = rb.siswa[1];
    var mismatch = 0, totalSesi = 0;
    var perMapel = [];
    for (var i = 0; i < sc.mapel.length; i++) {
      var m = sc.mapel[i];
      var rec = A.presensiEfektif(ctx.presensiOverrides, nisn, m, S.TA_AKTIF, 'ganjil');
      var roll = D.rollupPresensi(rec);
      perMapel.push(roll);
      totalSesi += rec.length;
      var manual = { H: 0, S: 0, I: 0, A: 0 };
      for (var j = 0; j < rec.length; j++) manual[rec[j].status]++;
      if (manual.H !== roll.H || manual.S !== roll.S || manual.I !== roll.I || manual.A !== roll.A) mismatch++;
      if (roll.total !== rec.length) mismatch++;
      if (Math.abs(roll.persen - (roll.H / rec.length * 100)) > 0.011) mismatch++;
    }
    t.eq(mismatch, 0, 'rekap per mapel cocok dengan hitungan manual (' + totalSesi + ' sesi diperiksa)');

    var sem = D.mergeRollups(perMapel);
    var jumlahH = perMapel.reduce(function (a, b) { return a + b.H; }, 0);
    var jumlahTotal = perMapel.reduce(function (a, b) { return a + b.total; }, 0);
    t.eq(sem.H, jumlahH, 'rekap semester = jumlah rekap mapel (hadir)');
    t.eq(sem.total, jumlahTotal, 'rekap semester = jumlah rekap mapel (total)');
    t.eq(sem.total, totalSesi, 'total semester = jumlah seluruh pertemuan');

    var rap = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'ganjil');
    t.eq(rap.presensi.total, totalSesi, 'presensi di rapor memakai rekap yang sama');
    t.eq(rap.presensi.H, jumlahH, 'jumlah hadir di rapor cocok dengan catatan sesi');

    // The eligibility rule bites, and it bites on presence not on excuses.
    t.eq(D.rollupPresensi([{ status: 'H' }, { status: 'H' }, { status: 'H' }, { status: 'A' }]).persen, 75, '3 dari 4 hadir = 75%');
    t.ok(D.rollupPresensi([{ status: 'H' }, { status: 'H' }, { status: 'H' }, { status: 'A' }]).memenuhiSyarat, '75% tepat memenuhi ambang');
    t.notOk(D.rollupPresensi([{ status: 'H' }, { status: 'H' }, { status: 'S' }, { status: 'A' }]).memenuhiSyarat, '50% tidak memenuhi ambang');
    t.eq(D.rollupPresensi([{ status: 'S' }, { status: 'I' }, { status: 'A' }]).persenAlpa, 33.33, 'alpa dihitung terpisah dari izin dan sakit');

    // An edited session must move the rollup.
    var m0 = sc.mapel[0];
    var ov = {};
    var rec0 = A.presensiEfektif({}, nisn, m0, S.TA_AKTIF, 'ganjil');
    var target = null;
    for (i = 0; i < rec0.length; i++) if (rec0[i].status === 'H') { target = rec0[i].n; break; }
    ov[A.presensiKey(S.TA_AKTIF, 'ganjil', nisn, m0.id, target)] = { status: 'A' };
    var rollBaru = D.rollupPresensi(A.presensiEfektif(ov, nisn, m0, S.TA_AKTIF, 'ganjil'));
    t.eq(rollBaru.H, perMapel[0].H - 1, 'koreksi H->A mengurangi jumlah hadir tepat satu');
    t.eq(rollBaru.A, perMapel[0].A + 1, 'dan menambah alpa tepat satu');
  });

  /* ======================================================== 5. peran == */

  group('Peran — guru tidak dapat menulis nilai guru lain', function (t) {
    var guruA = { role: 'guru', guruId: 'G01' };
    var guruB = { role: 'guru', guruId: 'G02' };
    var sendiri = D.can(guruA, 'nilai.write', { pengampuGuruId: 'G01', rombelId: 'x' });
    t.ok(sendiri.allowed, 'guru boleh menulis nilai kelas yang ia ampu');
    var lain = D.can(guruA, 'nilai.write', { pengampuGuruId: 'G02', pengampuNama: 'Bu Rani' });
    t.notOk(lain.allowed, 'guru DITOLAK menulis nilai kelas guru lain');
    t.ok(lain.reason.indexOf('Bu Rani') >= 0, 'penolakan menyebut siapa pengampunya');
    t.ok(lain.reason.length > 40, 'penolakan berupa kalimat yang bisa ditindaklanjuti, bukan "forbidden"');
    t.notOk(D.can(guruB, 'presensi.write', { pengampuGuruId: 'G01' }).allowed, 'aturan yang sama berlaku untuk presensi');

    // Wali kelas: read the whole rombel, write only their own subject.
    var wali = { role: 'wali', guruId: 'G03', rombelId: '2026/2027|8A' };
    t.ok(D.can(wali, 'nilai.read', { rombelId: '2026/2027|8A', pengampuGuruId: 'G09' }).allowed, 'wali kelas boleh MEMBACA nilai seluruh rombelnya');
    var waliTulis = D.can(wali, 'nilai.write', { pengampuGuruId: 'G09', pengampuNama: 'Pak Doni' });
    t.notOk(waliTulis.allowed, 'wali kelas TIDAK boleh menulis nilai mapel guru lain');
    t.ok(/BACA|baca/.test(waliTulis.reason), 'penolakan menjelaskan bahwa status wali hanya memberi hak baca');
    t.ok(D.can(wali, 'nilai.write', { pengampuGuruId: 'G03' }).allowed, 'wali kelas tetap boleh menulis nilai mapelnya sendiri');
    t.notOk(D.can(wali, 'rapor.read', { rombelId: '2026/2027|8B' }).allowed, 'wali kelas tidak boleh membuka rapor rombel lain');

    // Admin/TU administers but does not assess.
    var admin = { role: 'admin' };
    t.ok(D.can(admin, 'siswa.write', {}).allowed, 'TU boleh mengubah data induk');
    t.ok(D.can(admin, 'jadwal.solve', {}).allowed, 'TU boleh menjalankan penyusunan jadwal');
    var adminNilai = D.can(admin, 'nilai.write', { pengampuGuruId: 'G01' });
    t.notOk(adminNilai.allowed, 'TU TIDAK boleh mengubah nilai');
    t.ok(/guru pengampu/.test(adminNilai.reason), 'alasannya menyebut kewenangan guru pengampu');
    t.notOk(D.can({ role: 'guru', guruId: 'G01' }, 'jadwal.solve', {}).allowed, 'guru tidak menjalankan solver jadwal');

    // Parent: read-only, one child.
    var ortu = { role: 'ortu', nisn: '9900000001' };
    t.ok(D.can(ortu, 'rapor.read', { nisn: '9900000001' }).allowed, 'orang tua boleh membaca rapor anaknya');
    var ortuLain = D.can(ortu, 'rapor.read', { nisn: '9900000002' });
    t.notOk(ortuLain.allowed, 'orang tua DITOLAK membuka data anak lain');
    t.ok(ortuLain.reason.indexOf('9900000001') >= 0, 'penolakan menyebut NISN yang memang miliknya');
    t.notOk(D.can(ortu, 'nilai.write', { pengampuGuruId: 'G01' }).allowed, 'akun orang tua tidak pernah bisa menulis');
    t.notOk(D.can(ortu, 'siswa.read', {}).allowed, 'orang tua tidak bisa melihat daftar seluruh siswa');
    t.notOk(D.can({ role: 'entah' }, 'nilai.read', {}).allowed, 'peran tak dikenal ditolak secara default');
  });

  /* ========================================================== 6. SPP == */

  group('SPP — tunggakan hanya untuk bulan yang sudah jatuh tempo', function (t) {
    var sc = school();
    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var siswa = sc.siswa[rb.siswa[0]];
    var ledger = S.sppLedger(siswa, S.TA_AKTIF);
    t.eq(ledger.length, 12, 'satu tahun ajaran = 12 bulan tagihan');
    t.eq(ledger[0].month, 7, 'tagihan dimulai Juli');
    t.eq(ledger[11].month, 6, 'dan berakhir Juni');
    var roll = D.rollupSpp(ledger, S.SEKARANG);
    t.eq(roll.lunas + roll.tunggakan + roll.bebas + roll.belum, 12, 'setiap bulan punya tepat satu status');

    var depan = roll.bulan.filter(function (b) {
      return Date.UTC(b.year, b.month - 1, 10) > S.SEKARANG && b.status === 'tunggakan';
    });
    t.eq(depan.length, 0, 'bulan yang belum jatuh tempo TIDAK dihitung sebagai tunggakan');
    t.ok(roll.bulan.some(function (b) { return b.status === 'belum-jatuh-tempo'; }), 'bulan mendatang berstatus tersendiri');

    var kip = null;
    for (var k in sc.siswa) if (sc.siswa[k].kip && sc.siswa[k].enrol[S.TA_AKTIF]) { kip = sc.siswa[k]; break; }
    if (kip) {
      var rk = D.rollupSpp(S.sppLedger(kip, S.TA_AKTIF), S.SEKARANG);
      t.eq(rk.tunggakan, 0, 'penerima KIP dibebaskan, jadi tidak pernah punya tunggakan');
      t.eq(rk.bebas, 12, 'seluruh 12 bulannya berstatus bebas');
    }
    t.eq(D.rupiah(165000), 'Rp165.000', 'format rupiah memakai titik ribuan');
    t.eq(D.rupiah(1650000), 'Rp1.650.000', 'format rupiah untuk jutaan');

    var lulus = null;
    for (k in sc.siswa) if (!sc.siswa[k].enrol[S.TA_AKTIF]) { lulus = sc.siswa[k]; break; }
    t.eq(S.sppLedger(lulus, S.TA_AKTIF).length, 0, 'siswa yang tidak terdaftar tahun ini tidak ditagih');
  });

  /* ========================================================= 7. PPDB == */

  group('PPDB — kuota per jalur, peringkat dan cadangan', function (t) {
    var sc = school();
    var hasil = D.seleksiPpdb(sc.ppdb.pendaftar, sc.ppdb.kuotaTotal, 5);
    var diterima = hasil.hasil.filter(function (h) { return h.status === 'diterima'; });
    t.eq(diterima.length, sc.ppdb.kuotaTotal, 'jumlah yang diterima tepat sama dengan kuota (' + sc.ppdb.kuotaTotal + ')');
    var nisnSet = {}, dup = 0;
    diterima.forEach(function (h) { if (nisnSet[h.nisn]) dup++; else nisnSet[h.nisn] = 1; });
    t.eq(dup, 0, 'tidak ada pendaftar diterima dua kali');

    var zon = hasil.ringkas.filter(function (r) { return r.jalur === 'zonasi'; })[0];
    t.ok(zon.kuota >= Math.floor(sc.ppdb.kuotaTotal * 0.5), 'jalur zonasi mendapat minimal 50% kuota');
    var afr = hasil.ringkas.filter(function (r) { return r.jalur === 'afirmasi'; })[0];
    t.ok(afr.kuota >= Math.floor(sc.ppdb.kuotaTotal * 0.15), 'jalur afirmasi mendapat minimal 15% kuota');

    // Ranking within zonasi is by distance, ascending, with no exceptions.
    var zonHasil = hasil.hasil.filter(function (h) { return h.jalur === 'zonasi'; });
    var urut = true;
    for (var i = 1; i < zonHasil.length; i++) if (zonHasil[i].ref.jarakMeter < zonHasil[i - 1].ref.jarakMeter) urut = false;
    t.ok(urut, 'peringkat zonasi terurut dari yang terdekat');
    var pres = hasil.hasil.filter(function (h) { return h.jalur === 'prestasi'; });
    var urut2 = true;
    for (i = 1; i < pres.length; i++) if (pres[i].ref.skor > pres[i - 1].ref.skor) urut2 = false;
    t.ok(urut2, 'peringkat prestasi terurut dari skor tertinggi');

    t.ok(hasil.hasil.some(function (h) { return h.status === 'cadangan'; }), 'ada daftar cadangan (waiting list)');
    t.ok(hasil.hasil.some(function (h) { return h.status === 'tidak-diterima'; }), 'ada pendaftar yang tidak diterima');

    // Selection must be a pure function of the input.
    var lagi = D.seleksiPpdb(sc.ppdb.pendaftar, sc.ppdb.kuotaTotal, 5);
    t.eq(JSON.stringify(hasil.hasil.map(function (h) { return h.nisn + h.status; })),
      JSON.stringify(lagi.hasil.map(function (h) { return h.nisn + h.status; })),
      'menjalankan seleksi dua kali memberi hasil identik');

    // Shuffling the input must not change who gets in.
    var acak = sc.ppdb.pendaftar.slice().reverse();
    var hasil3 = D.seleksiPpdb(acak, sc.ppdb.kuotaTotal, 5);
    var setA = diterima.map(function (h) { return h.nisn; }).sort().join(',');
    var setB = hasil3.hasil.filter(function (h) { return h.status === 'diterima'; }).map(function (h) { return h.nisn; }).sort().join(',');
    t.eq(setA, setB, 'urutan pendaftar masuk tidak mempengaruhi siapa yang diterima');
  });

  /* ================================================== 8. data sintetis == */

  group('Data — seluruhnya fabrikasi dan dapat dibangun ulang', function (t) {
    var sc = school();
    var bukanDemo = sc.nisnUrut.filter(function (n) { return !D.isDemoNisn(n); });
    t.eq(bukanDemo.length, 0, 'setiap NISN berasal dari blok sintetis 99xxxxxxxx');
    t.eq(sc.sekolah.npsn, '00000000', 'NPSN sekolah adalah nol, bukan nomor satuan pendidikan sungguhan');
    t.ok(/fiktif/.test(sc.sekolah.nama), 'nama sekolah menyatakan dirinya fiktif');
    var adaNik = false;
    for (var k in sc.siswa) { if (sc.siswa[k].nik) adaNik = true; break; }
    t.notOk(adaNik, 'tidak ada NIK di dalam dataset sama sekali');

    var sc2 = S.build(20260915);
    t.eq(sc2.nisnUrut.join(','), sc.nisnUrut.join(','), 'seed yang sama menghasilkan NISN yang sama');
    t.eq(sc2.guru.map(function (g) { return g.nama; }).join('|'), sc.guru.map(function (g) { return g.nama; }).join('|'), 'seed yang sama menghasilkan guru yang sama');
    var sc3 = S.build(999);
    t.ok(sc3.nisnUrut[0] !== sc.nisnUrut[0], 'seed berbeda menghasilkan sekolah berbeda');

    var jumlah = Object.keys(sc.siswa).length;
    t.ok(jumlah >= 280 && jumlah <= 320, 'dataset berisi ' + jumlah + ' peserta didik (aktif + alumni)');
    var aktif = sc.rombelByTa[S.TA_AKTIF].reduce(function (a, r) { return a + r.siswa.length; }, 0);
    t.eq(aktif, 240, '240 peserta didik aktif pada tahun berjalan');
    t.eq(sc.rombelByTa[S.TA_AKTIF].length, 8, '8 rombel pada tahun berjalan');
    t.eq(sc.guru.length, 24, '24 guru');
    t.eq(sc.mapel.length, 12, '12 mata pelajaran');
    var totalJp = sc.mapel.reduce(function (a, m) { return a + m.jp; }, 0);
    t.eq(totalJp, 38, 'struktur kurikulum berjumlah 38 JP per minggu');
    var kapasitas = S.HARI.reduce(function (a, h) { return a + h.slots; }, 0);
    t.ok(kapasitas > totalJp, 'kalender (' + kapasitas + ' JP) menyisakan ruang untuk projek/P5 di luar ' + totalJp + ' JP intrakurikuler');
    var blokJp = sc.mapel.reduce(function (a, m) { return a + m.blok.reduce(function (x, b) { return x + b.len; }, 0); }, 0);
    t.eq(blokJp, totalJp, 'pemecahan blok menjumlah persis ke JP kurikulum');
  });

  group('Kalender — blok tidak boleh melewati istirahat', function (t) {
    var senin = S.HARI[0];
    var segs = SV.segmentsOf(senin);
    t.eq(segs.length, 3, 'Senin terbagi menjadi 3 segmen oleh dua istirahat');
    t.eq(segs[0].from + '-' + segs[0].to, '1-4', 'segmen pertama JP 1-4');
    t.eq(segs[1].from + '-' + segs[1].to, '5-8', 'segmen kedua JP 5-8');
    t.ok(SV.blockFits(senin, 1, 4), 'blok 4 JP muat di segmen pertama');
    t.notOk(SV.blockFits(senin, 3, 3), 'blok 3 JP mulai JP 3 akan terpotong istirahat');
    t.notOk(SV.blockFits(senin, 4, 2), 'blok 2 JP mulai JP 4 melompati istirahat');
    t.ok(SV.blockFits(senin, 5, 3), 'blok 3 JP mulai JP 5 muat');
    var jumat = S.HARI[4];
    t.eq(jumat.slots, 6, "Jum'at lebih pendek");
    t.notOk(SV.blockFits(jumat, 5, 3), "blok 3 JP tidak muat di akhir Jum'at");
    t.ok(/^07\.00/.test(S.jamSlot(0, 1)), 'jam pertama mulai 07.00');
    t.ok(S.jamSlot(0, 5).indexOf('09.') === 0 || S.jamSlot(0, 5).indexOf('10.') === 0, 'jam ke-5 sudah memperhitungkan istirahat');
  });

  /* --------------------------------------------------------------- runner */

  function run() {
    var results = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      try {
        g.fn(makeCtx(results, g.name));
      } catch (err) {
        results.push({ group: g.name, name: 'grup melempar exception', ok: false, message: String(err && err.stack || err) });
      }
    }
    var passed = results.filter(function (r) { return r.ok; }).length;
    return { results: results, passed: passed, failed: results.length - passed, total: results.length };
  }

  root.SIAKAD_TESTS = { run: run, groups: groups };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SIAKAD_TESTS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
