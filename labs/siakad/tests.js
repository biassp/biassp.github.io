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
 *   2. Editing this year's bobot/KKM does not move last year's rapor by a
 *      single digit. This is the one that guards a signed document.
 *   3. A NISN is never reused, including by a student who has left.
 *   4. A weighting that does not total 100 is rejected, not rescaled.
 *   5. A rapor recomputes to the identical value from the identical inputs.
 *   6. Attendance is day-coherent, and eligibility bites on ALPA rather than
 *      on documented illness.
 *   7. The PPDB quota split stays inside its regulatory bounds, and the
 *      accepted candidates ARE the kelas-7 roster.
 *   8. A guru cannot write another guru's marks.
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
    return {
      school: sc, konfig: { bobot: {}, kkm: {} },
      nilaiOverrides: {}, presensiOverrides: {}, sikapOverrides: {}
    };
  }
  function anakDuaTahun(sc) {
    for (var i = 0; i < sc.nisnUrut.length; i++) {
      var s = sc.siswa[sc.nisnUrut[i]];
      if (s.enrol[S.TA_LALU] && s.enrol[S.TA_AKTIF]) return s;
    }
    return null;
  }

  /* =============================================== 1. hard constraints == */

  group('Solver — jadwal tidak pernah melanggar kendala keras', function (t) {
    var sc = school();
    var spec = S.buildJadwalSpec(sc, S.TA_AKTIF);
    var blokPerRombel = S.MAPEL.reduce(function (a, m) { return a + m.blok.length; }, 0);
    t.eq(spec.sesi.length, sc.rombelByTa[S.TA_AKTIF].length * blokPerRombel,
      'instance punya ' + spec.sesi.length + ' sesi (' + sc.rombelByTa[S.TA_AKTIF].length + ' rombel x ' + blokPerRombel + ' blok)');

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

  group('Solver — anggaran, bukti mustahil, dan instance cacat', function (t) {
    /* The restart schedule only means something if each attempt actually gets
     * its own budget. The counter is global and never reset, so comparing a
     * per-attempt number against it collapsed every restart after the fifth to
     * ~400 backtracks and capped the whole search at ~121k. A run that clears
     * that ceiling is direct evidence the budget is attempt-local. */
    var sc = school();
    var spec = S.buildJadwalSpec(sc, S.TA_AKTIF);
    spec.guru = sc.guru.map(function (g) {
      var c = { id: g.id, nama: g.nama, mapelUtama: g.mapelUtama, maxJamHarian: g.maxJamHarian, tidakTersedia: g.tidakTersedia.slice() };
      for (var s = 1; s <= 4; s++) c.tidakTersedia.push({ hari: 0, slot: s });   // rapat dinas
      return c;
    });
    var keras = SV.solve(spec, { budgetMs: 8000, optimiseMs: 0, maxRestarts: 300, seed: 4242 });
    t.ok(keras.ok, 'skenario rapat dinas tetap terpecahkan');
    t.ok(keras.stats.backtrack > 121500 || keras.stats.restart < 5,
      'anggaran backtrack bersifat per-percobaan: usaha total (' + keras.stats.backtrack +
      ') tidak terkunci di plafon kumulatif ~121.500');

    /* An exhausted tree is a PROOF, and must be reported as one instead of
     * being restarted 300 more times and then called "not proven impossible".
     * Pigeonhole: one teacher, three rombel, one day with two 2-JP slots. */
    var pigeon = {
      hari: [{ id: 'd0', label: 'H0', slots: 4, breakAfter: [2] }],
      ruang: [{ id: 'R1', nama: 'R1', tipe: 'kelas' }, { id: 'R2', nama: 'R2', tipe: 'kelas' }, { id: 'R3', nama: 'R3', tipe: 'kelas' }],
      guru: [{ id: 'G1', nama: 'G1', tidakTersedia: [] }],
      mapel: [{ id: 'm', kode: 'M', nama: 'M' }],
      sesi: [0, 1, 2].map(function (i) {
        return {
          id: 's' + i, rombelId: 'K' + i, rombelNama: 'K' + i, mapelId: 'm', mapelNama: 'M',
          mapelKode: 'M', guruId: 'G1', len: 2, ruangTipe: null, homeRuangId: 'R' + (i + 1)
        };
      }),
      wajibJp: { 'K0|m': 2, 'K1|m': 2, 'K2|m': 2 }
    };
    var pr = SV.solve(pigeon, { budgetMs: 2000, optimiseMs: 0, maxRestarts: 50, seed: 1 });
    t.notOk(pr.ok, 'instance pigeonhole memang tidak punya solusi');
    t.eq(pr.diagnosis.sifat, 'terbukti', 'dilaporkan sebagai infeasibilitas TERBUKTI, bukan "belum terbukti"');
    t.eq(pr.diagnosis.tahap, 'pencarian-tuntas', 'tahapnya menyebut bahwa ruang pencarian habis dienumerasi');
    t.ok(pr.stats.restart < 5, 'tidak membuang 50 restart untuk membuktikan hal yang sama berulang kali');

    /* A session naming a teacher who does not exist is a DATA fault. It must
     * come back as a typed diagnosis, not as a TypeError — on the main-thread
     * fallback an exception would strand the UI on "Menyusun…" forever. */
    var cacat = {
      hari: [{ id: 'd0', label: 'H0', slots: 4, breakAfter: [2] }],
      ruang: [{ id: 'R1', nama: 'R1', tipe: 'kelas' }],
      guru: [{ id: 'G1', nama: 'G1', tidakTersedia: [] }],
      mapel: [{ id: 'm', kode: 'M', nama: 'M' }],
      sesi: [{ id: 's', rombelId: 'K', rombelNama: 'K', mapelId: 'm', mapelNama: 'M', mapelKode: 'M', guruId: 'GX', len: 1, ruangTipe: null, homeRuangId: 'R1' }],
      wajibJp: { 'K|m': 1 }
    };
    var cr = null, melempar = false;
    try { cr = SV.solve(cacat, { budgetMs: 500 }); } catch (e) { melempar = true; }
    t.notOk(melempar, 'guruId yang tidak dikenal TIDAK melempar exception');
    t.ok(cr && !cr.ok && /tidak sah/.test(cr.diagnosis.judul), 'melainkan menjadi diagnosis cacat data');
    t.ok(cr && /GX/.test(cr.diagnosis.pesan), 'diagnosis menyebut entitas yang tidak ditemukan');

    var cacat2 = JSON.parse(JSON.stringify(cacat));
    cacat2.sesi[0].guruId = 'G1';
    cacat2.sesi[0].homeRuangId = 'RX';
    var cr2 = SV.solve(cacat2, { budgetMs: 500 });
    t.notOk(cr2.ok, 'homeRuangId yang tidak dikenal juga ditolak di depan');
    t.ok(/RX/.test(cr2.diagnosis.pesan), 'dan bukan lolos sampai gagal di verifikasi sebagai "bug solver"');
  });

  group('Solver — infeasibility dilaporkan, bukan disembunyikan', function (t) {
    var sc = S.build(20260915);
    var g = null;
    for (var i = 0; i < sc.guru.length; i++) if (sc.guru[i].mapelUtama === 'pjok') g = sc.guru[i];
    t.ok(!!g, 'ada guru PJOK tunggal untuk diuji');
    for (var d = 0; d < S.HARI.length; d++) {
      for (var s = 1; s <= S.HARI[d].slots; s++) g.tidakTersedia.push({ hari: d, slot: s });
    }
    var r = SV.solve(S.buildJadwalSpec(sc, S.TA_AKTIF), { budgetMs: 3000, optimiseMs: 0, seed: 5 });
    t.notOk(r.ok, 'guru satu-satunya pengampu PJOK tidak tersedia seminggu penuh -> gagal');
    t.eq(r.assign, null, 'tidak ada jadwal setengah jadi yang dikembalikan');
    t.eq(r.diagnosis.tahap, 'pra-pencarian', 'terdeteksi sebelum pencarian dimulai');
    t.eq(r.diagnosis.sifat, 'terbukti', 'dilaporkan sebagai infeasibilitas terbukti');
    t.ok(/PJOK/.test(r.diagnosis.judul), 'diagnosis menyebut mapel yang bermasalah');
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

    // A 3-JP block that would straddle istirahat (Senin: break after JP 3).
    var tiga = null;
    for (i = 0; i < spec.sesi.length; i++) if (spec.sesi[i].len === 3) { tiga = spec.sesi[i]; break; }
    var res2 = SV.validateMove(spec, assign, tiga.id, 0, 2, tiga.homeRuangId); // Senin JP 2-4
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

    var lulus = null;
    for (var k in sc.siswa) if (sc.siswa[k].status === 'lulus') { lulus = sc.siswa[k]; break; }
    t.ok(!!lulus, 'ada angkatan yang sudah lulus di dataset');
    t.ok(sc.registry.taken(lulus.nisn), 'NISN alumni tetap tercatat terpakai setelah lulus');

    var reg = new D.NisnRegistry(7);
    var a = reg.issue('x');
    t.ok(reg.taken(a), 'NISN yang baru terbit langsung tercatat terpakai');
    var ulang = 0;
    for (i = 0; i < 3000; i++) if (reg.issue('y') === a) ulang++;
    t.eq(ulang, 0, '3000 penerbitan berikutnya tidak pernah mengulang NISN pertama');

    var contoh = sc.siswa[sc.nisnUrut[0]];
    t.ok(contoh.nis !== contoh.nisn, 'NIS bukan NISN');
    t.eq(D.makeNis(2026, 7), '261007', 'NIS mengikuti konvensi sekolah (tahun masuk + urut)');
    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var absens = rb.siswa.map(function (n2) { return sc.siswa[n2].enrol[S.TA_AKTIF].absen; });
    absens.sort(function (x, y) { return x - y; });
    var berurut = absens.every(function (v, ix) { return v === ix + 1; });
    t.ok(berurut, 'nomor absen ' + rb.nama + ' adalah 1..' + absens.length + ' tanpa lompatan');

    /* The claim "absen is re-derived every year and is never an identity" is
     * only observable if some child actually moves. Rombel are reshuffled at
     * kenaikan kelas, so they do. */
    var dua = 0, absenBeda = 0, hurufBeda = 0;
    for (i = 0; i < sc.nisnUrut.length; i++) {
      var s = sc.siswa[sc.nisnUrut[i]];
      var x = s.enrol[S.TA_LALU], y = s.enrol[S.TA_AKTIF];
      if (!x || !y) continue;
      dua++;
      if (x.absen !== y.absen) absenBeda++;
      if (x.rombelNama.charAt(1) !== y.rombelNama.charAt(1)) hurufBeda++;
    }
    t.ok(dua > 100, dua + ' anak terdaftar pada kedua tahun ajaran');
    t.ok(absenBeda > dua * 0.5, absenBeda + ' dari ' + dua + ' anak berganti nomor absen antar tahun');
    t.ok(hurufBeda > 0, hurufBeda + ' anak berpindah huruf rombel saat kenaikan kelas');
  });

  group('Tahun ajaran — riwayat menempel pada tahunnya, bukan pada "sekarang"', function (t) {
    var sc = school();
    t.ok(D.tahunAjaranValid('2026/2027'), 'format tahun ajaran diterima');
    t.notOk(D.tahunAjaranValid('2026/2028'), 'tahun yang tidak berurutan ditolak');
    t.notOk(D.tahunAjaranValid('2026'), 'tahun tunggal ditolak');
    t.eq(D.semesterMonths('2026/2027', 'ganjil').length, 6, 'ganjil berisi 6 bulan');
    t.eq(D.semesterMonths('2026/2027', 'ganjil')[0].month, 7, 'ganjil dimulai Juli');
    t.eq(D.semesterMonths('2026/2027', 'genap')[0].year, 2027, 'genap jatuh pada tahun kalender kedua');

    var kelas7 = sc.rombelByTa[S.TA_AKTIF].filter(function (r) { return r.tingkat === 7; })[0];
    var baru = sc.siswa[kelas7.siswa[0]];
    t.ok(!!baru.enrol[S.TA_AKTIF], 'siswa kelas 7 terdaftar pada tahun aktif');
    t.notOk(baru.enrol[S.TA_LALU], 'siswa kelas 7 TIDAK punya keanggotaan rombel tahun lalu');

    var lama = anakDuaTahun(sc);
    t.ok(!!lama, 'ada anak yang terdaftar pada dua tahun ajaran');
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

    /* ---- THE ONE THAT GUARDS A SIGNED DOCUMENT ----
     * Bobot penilaian and KKM are configuration, and configuration that is not
     * year-scoped retroactively re-derives every rapor ever issued. Editing the
     * active year must move the active year and NOTHING else. */
    var sebelumLalu = A.canonicalRapor(A.hitungRapor(ctx, lama.nisn, S.TA_LALU, 'genap'));
    var sebelumKini = A.canonicalRapor(A.hitungRapor(ctx, lama.nisn, S.TA_AKTIF, 'ganjil'));

    ctx.konfig.bobot[S.TA_AKTIF] = {
      mtk: { peng: { tugas: 10, uh: 20, pts: 20, pas: 50 }, ket: { praktik: 25, produk: 25, proyek: 25, porto: 25 } }
    };
    ctx.konfig.kkm[S.TA_AKTIF] = { mtk: 85 };

    var sesudahLalu = A.canonicalRapor(A.hitungRapor(ctx, lama.nisn, S.TA_LALU, 'genap'));
    var sesudahKini = A.canonicalRapor(A.hitungRapor(ctx, lama.nisn, S.TA_AKTIF, 'ganjil'));
    t.eq(sesudahLalu, sebelumLalu, 'mengubah bobot & KKM ' + S.TA_AKTIF + ' TIDAK menggeser satu digit pun pada rapor ' + S.TA_LALU);
    t.ok(sesudahKini !== sebelumKini, 'tetapi benar-benar mengubah rapor tahun ajaran yang disunting');

    // And the default configuration itself is genuinely per-year.
    t.ok(sc.kkm[S.TA_LALU].mtk !== sc.kkm[S.TA_AKTIF].mtk, 'KKM Matematika memang berbeda antar tahun ajaran di data dasar');
    var ctx2 = ctxFor(sc);
    t.eq(A.kkmFor(ctx2, S.TA_LALU, 'mtk'), sc.kkm[S.TA_LALU].mtk, 'pembacaan KKM tahun lalu memakai nilai tahun lalu');
    t.eq(A.kkmFor(ctx2, S.TA_AKTIF, 'mtk'), sc.kkm[S.TA_AKTIF].mtk, 'pembacaan KKM tahun ini memakai nilai tahun ini');
  });

  group('Tahun ajaran — mutasi, tinggal kelas dan tingkat yang bukan fungsi angkatan', function (t) {
    var sc = school();
    var m = sc.mutasi;
    var ulang = sc.siswa[m.tinggalKelas];
    t.ok(!!ulang.enrol[S.TA_LALU] && !!ulang.enrol[S.TA_AKTIF], 'anak yang tinggal kelas terdaftar pada kedua tahun');
    t.eq(ulang.enrol[S.TA_AKTIF].tingkat, ulang.enrol[S.TA_LALU].tingkat, 'tingkatnya TIDAK naik — inilah kasus yang mematahkan tingkat = fungsi(angkatan)');
    var normal = 7 + (D.parseTahunAjaran(S.TA_AKTIF).start - ulang.angkatan);
    t.ok(normal !== ulang.enrol[S.TA_AKTIF].tingkat, 'rumus dari angkatan akan memberi tingkat ' + normal + ', dan itu salah untuk anak ini');

    var keluar = sc.siswa[m.keluar];
    t.ok(!!keluar.enrol[S.TA_LALU], 'anak yang mutasi keluar punya riwayat tahun lalu');
    t.notOk(keluar.enrol[S.TA_AKTIF], 'dan tidak terdaftar tahun ini');
    t.eq(keluar.status, 'pindah', 'statusnya pindah, bukan lulus');

    var masuk = sc.siswa[m.masukNisn];
    t.notOk(masuk.enrol[S.TA_LALU], 'anak mutasi masuk tidak punya riwayat tahun lalu di sekolah ini');
    t.ok(!!masuk.enrol[S.TA_AKTIF], 'tetapi terdaftar tahun ini di tingkat ' + masuk.enrol[S.TA_AKTIF].tingkat);
    t.ok(masuk.enrol[S.TA_AKTIF].tingkat > 7, 'dan masuk bukan di kelas 7 — ia membawa NISN-nya sendiri');
  });

  /* ============================================== 3. penilaian & rapor == */

  group('Penilaian — dua aspek K13, bobot wajib berjumlah tepat 100%', function (t) {
    t.eq(D.ASPEK.length, 2, 'ada dua aspek penilaian');
    t.eq(D.komponenAspek('peng').length, 4, 'KI-3 punya empat komponen');
    t.eq(D.komponenAspek('ket').length, 4, 'KI-4 punya empat komponen');
    t.ok(D.komponenAspek('ket').map(function (k) { return k.id; }).indexOf('praktik') >= 0,
      'komponen keterampilan adalah praktik/produk/proyek/portofolio, bukan salinan komponen pengetahuan');

    t.ok(D.validateBobot({ tugas: 20, uh: 30, pts: 20, pas: 30 }, 'peng').ok, '20/30/20/30 diterima untuk KI-3');
    t.ok(D.validateBobot({ praktik: 35, produk: 25, proyek: 25, porto: 15 }, 'ket').ok, 'bobot KI-4 baku diterima');
    t.notOk(D.validateBobot({ tugas: 25, uh: 25, pts: 25, pas: 25 }, 'ket').ok, 'bobot KI-3 ditolak ketika divalidasi sebagai KI-4');
    var kurang = D.validateBobot({ tugas: 20, uh: 30, pts: 20, pas: 20 }, 'peng');
    t.notOk(kurang.ok, 'total 90% ditolak');
    t.eq(kurang.total, 90, 'totalnya dilaporkan apa adanya');
    t.ok(/tepat 100/.test(kurang.errors[0]), 'pesan galat menyebut aturannya');
    t.notOk(D.validateBobot({ tugas: 30, uh: 30, pts: 20, pas: 30 }, 'peng').ok, 'total 110% ditolak');
    t.notOk(D.validateBobot({ tugas: 20, uh: 30, pts: 20 }, 'peng').ok, 'komponen hilang ditolak');
    t.notOk(D.validateBobot({ tugas: -10, uh: 40, pts: 40, pas: 30 }, 'peng').ok, 'bobot negatif ditolak');
    t.notOk(D.validateBobot({ tugas: 'x', uh: 30, pts: 20, pas: 30 }, 'peng').ok, 'bobot bukan angka ditolak');
    t.ok(D.validateBobot({ tugas: 33.33, uh: 33.33, pts: 33.34, pas: 0 }, 'peng').ok, 'pecahan yang berjumlah 100 diterima');

    var h = D.hitungNilaiAkhir({ tugas: 90, uh: 90, pts: 90, pas: 90 }, { tugas: 20, uh: 30, pts: 20, pas: 20 }, 70, 'peng');
    t.notOk(h.ok, 'nilai akhir tidak dihitung dengan bobot tidak sah');
    t.eq(h.nilai, null, 'tidak ada angka yang dikembalikan diam-diam');

    /* A component whose window has not passed is null, not zero, and it stops
     * the mark being produced at all rather than being averaged over part of
     * the weighting. */
    var belum = D.hitungNilaiAkhir({ tugas: 80, uh: 80, pts: 80, pas: null }, { tugas: 20, uh: 30, pts: 20, pas: 30 }, 70, 'peng');
    t.ok(belum.ok, 'komponen yang belum dinilai bukan galat');
    t.notOk(belum.lengkap, 'tetapi hasilnya ditandai belum lengkap');
    t.eq(belum.nilai, null, 'dan tidak ada nilai akhir yang diterbitkan dari sebagian bobot');
    t.eq(belum.predikat, null, 'juga tidak ada predikat');
    t.eq(belum.belum.join(','), 'pas', 'komponen yang ditunggu disebutkan namanya');
  });

  group('Penilaian — nilai akhir, KKM dan predikat', function (t) {
    var h = D.hitungNilaiAkhir({ tugas: 80, uh: 70, pts: 60, pas: 80 }, { tugas: 20, uh: 30, pts: 20, pas: 30 }, 70, 'peng');
    t.ok(h.ok, 'perhitungan berhasil');
    t.ok(h.lengkap, 'seluruh komponen tersedia');
    t.eq(h.nilai, 73, 'rata-rata terbobot dihitung benar');
    t.eq(h.rincian.length, 4, 'kontribusi tiap komponen dikembalikan');
    t.eq(h.rincian[0].kontribusi, 16, 'kontribusi tugas 80 x 20% = 16');
    t.ok(h.tuntas, '73 di atas KKM 70');
    t.eq(D.predikat(73, 70), 'C', '73 dengan KKM 70 adalah C');
    t.eq(D.predikat(69, 70), 'D', 'di bawah KKM selalu D');
    t.eq(D.predikat(100, 70), 'A', 'nilai sempurna adalah A');
    var b = D.predikatBands(70);
    t.eq(b.C, 70, 'ambang C adalah KKM');
    t.eq(b.B, 80, 'ambang B adalah KKM + interval');
    t.eq(b.A, 90, 'ambang A adalah KKM + 2 interval');
    t.eq(D.predikat(82, 70), 'B', '82 dengan KKM 70 adalah B');
    t.eq(D.predikat(82, 80), 'C', '82 dengan KKM 80 hanya C');

    var desk = D.deskripsiCapaian('A', 'peng', ['bilangan bulat', 'aljabar'], 'kunci');
    t.ok(desk.length > 20, 'deskripsi capaian berupa kalimat, bukan kode');
    t.eq(desk, D.deskripsiCapaian('A', 'peng', ['bilangan bulat', 'aljabar'], 'kunci'), 'deskripsi deterministik untuk kunci yang sama');
    t.ok(/bilangan bulat|aljabar/.test(desk), 'deskripsi menyebut materi mapelnya, bukan kalimat generik');
  });

  group('Rapor — dua aspek, sikap, deskripsi, dan perhitungan ulang deterministik', function (t) {
    var sc = school();
    var ctx = ctxFor(sc);
    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var nisn = rb.siswa[0];

    var a = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'ganjil');
    var bb = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'ganjil');
    t.ok(a.ok, 'rapor terbit untuk semester yang sudah selesai');
    t.eq(A.canonicalRapor(a), A.canonicalRapor(bb), 'dua perhitungan berturut-turut identik');

    var sc3 = S.build(20260915);
    var c = A.hitungRapor(ctxFor(sc3), nisn, S.TA_AKTIF, 'ganjil');
    t.eq(A.canonicalRapor(a), A.canonicalRapor(c), 'sekolah dibangun ulang dari seed menghasilkan rapor yang sama persis');

    // Two aspects, never merged.
    var baris = a.baris[0];
    t.ok(baris.aspek.peng && baris.aspek.ket, 'setiap mapel punya KI-3 dan KI-4');
    var beda = a.baris.filter(function (b) { return b.aspek.peng.nilai !== b.aspek.ket.nilai; }).length;
    t.ok(beda > a.baris.length / 2, 'pengetahuan dan keterampilan memang dua angka berbeda (' + beda + ' dari ' + a.baris.length + ' mapel)');
    t.ok(baris.aspek.peng.deskripsi.length > 20, 'KI-3 membawa deskripsi capaian');
    t.ok(baris.aspek.ket.deskripsi.length > 20, 'KI-4 membawa deskripsi capaian sendiri');
    t.ok(baris.aspek.peng.deskripsi !== baris.aspek.ket.deskripsi, 'kedua deskripsi tidak sekadar disalin');
    t.ok(!!a.sikap.spiritual.predikat && !!a.sikap.sosial.predikat, 'rapor memuat sikap spiritual dan sosial');
    t.ok(a.sikap.spiritual.deskripsi.length > 10, 'sikap membawa deskripsi, bukan hanya huruf');
    t.ok(D.PREDIKAT_SIKAP.indexOf(a.sikap.sosial.predikat) >= 0, 'predikat sikap berada di rentang A–D');

    // An edited component moves the mark, and only that component.
    var ov = {};
    var key = A.nilaiKey(S.TA_AKTIF, 'ganjil', nisn, 'mtk', 'peng');
    ov[key] = { k: key, nilai: { pas: 95 } };
    var ctx2 = ctxFor(sc); ctx2.nilaiOverrides = ov;
    var d1 = A.hitungRapor(ctx2, nisn, S.TA_AKTIF, 'ganjil');
    var barisEdit = d1.baris.filter(function (x) { return x.mapel.id === 'mtk'; })[0];
    var barisAsal = a.baris.filter(function (x) { return x.mapel.id === 'mtk'; })[0];
    t.ok(barisEdit.aspek.peng.nilai !== barisAsal.aspek.peng.nilai, 'suntingan PAS mengubah nilai KI-3');
    t.eq(barisEdit.aspek.ket.nilai, barisAsal.aspek.ket.nilai, 'dan TIDAK menyentuh KI-4');
    t.ok(barisEdit.eff.peng.diubah.pas, 'komponen yang diedit ditandai');
    t.eq(barisEdit.eff.peng.nilai.tugas, barisAsal.eff.peng.nilai.tugas, 'komponen lain tidak ikut tereset');
    t.eq(A.canonicalRapor(d1), A.canonicalRapor(A.hitungRapor(ctx2, nisn, S.TA_AKTIF, 'ganjil')), 'rapor yang sudah diedit pun tetap deterministik');

    // Ranking shares places on ties and only ranks complete rapor.
    var leger = A.legerKelas(ctx, sc.rombelByTa[S.TA_AKTIF][0], S.TA_AKTIF, 'ganjil');
    t.eq(leger.length, rb.siswa.length, 'leger memuat seluruh rombel');
    t.ok(leger.every(function (x) { return x.peringkat >= 1; }), 'setiap baris leger mendapat peringkat');
  });

  group('Waktu — semester yang belum terjadi tidak dinilai dan tidak dirapor', function (t) {
    var sc = school();
    var ctx = ctxFor(sc);
    t.eq(S.statusSemester(S.TA_AKTIF, 'ganjil'), 'selesai', 'semester ganjil ' + S.TA_AKTIF + ' sudah selesai pada tanggal acuan');
    t.eq(S.statusSemester(S.TA_AKTIF, 'genap'), 'belum-mulai', 'semester genap ' + S.TA_AKTIF + ' belum dimulai');

    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var nisn = rb.siswa[0];
    var g = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'genap');
    t.notOk(g.ok, 'rapor semester yang belum berjalan DITOLAK, bukan diisi angka');
    t.eq(g.sebab, 'semester-belum-mulai', 'alasannya bertipe, bukan sekadar kalimat');
    t.ok(/belum berjalan/.test(g.alasan), 'penolakannya menjelaskan sebabnya');

    t.eq(S.hariEfektifHingga(S.TA_AKTIF, 'genap').length, 0, 'tidak ada hari efektif yang tercatat untuk semester itu');
    t.eq(S.sesiMapel('7A', S.MAPEL[0], S.TA_AKTIF, 'genap').length, 0, 'tidak ada pertemuan mapel yang tercatat');
    t.notOk(S.komponenSiap(S.TA_AKTIF, 'genap', 'peng', 'tugas'), 'komponen paling awal pun belum terbuka');

    // The finished semester is complete, so the flagship rapor is a real one.
    t.ok(S.komponenSiap(S.TA_AKTIF, 'ganjil', 'peng', 'pas'), 'PAS semester ganjil sudah lewat jendelanya');
    t.ok(S.komponenSiap(S.TA_AKTIF, 'ganjil', 'ket', 'porto'), 'portofolio semester ganjil sudah lewat jendelanya');
    var r = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'ganjil');
    t.ok(r.lengkap, 'rapor semester ganjil lengkap');

    // Windows are ordered: PTS closes before PAS.
    var pts = S.pekanSelesaiTs(S.TA_AKTIF, 'ganjil', S.PEKAN_PTS);
    var pas = S.pekanSelesaiTs(S.TA_AKTIF, 'ganjil', S.PEKAN_PAS);
    t.ok(pts < pas, 'jendela PTS ditutup sebelum PAS');
    t.ok(pas <= S.SEKARANG, 'dan PAS sudah lewat pada tanggal acuan demo');
  });

  /* ==================================================== 4. presensi == */

  group('Presensi — bertanggal, koheren per hari, dan alpa yang menentukan', function (t) {
    var sc = school();
    var ctx = ctxFor(sc);
    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var nisn = rb.siswa[1];

    var kal = S.kalenderSemester(S.TA_AKTIF, 'ganjil');
    t.eq(kal.hariEfektif.length, S.PEKAN_EFEKTIF * 5, S.PEKAN_EFEKTIF + ' pekan efektif = ' + (S.PEKAN_EFEKTIF * 5) + ' hari');
    t.eq(kal.tanggalKbm.length, S.PEKAN_KBM * 5, S.PEKAN_KBM + ' pekan KBM di luar pekan PTS dan PAS');
    t.ok(/^\d{4}-\d{2}-\d{2}$/.test(kal.mulai), 'tanggal mulai berbentuk YYYY-MM-DD');

    /* Day coherence is the whole point of anchoring to a date: a child who was
     * ill on one Tuesday must read 'S' in EVERY subject taught that Tuesday.
     * With per-(mapel, ordinal) draws this was impossible. */
    var byTgl = {}, tidakKoheren = 0, totalSesi = 0;
    var perMapel = [];
    for (var i = 0; i < sc.mapel.length; i++) {
      var m = sc.mapel[i];
      var rec = A.presensiEfektif(ctx, nisn, m, S.TA_AKTIF, 'ganjil', rb.nama);
      perMapel.push(D.rollupPresensi(rec));
      totalSesi += rec.length;
      for (var j = 0; j < rec.length; j++) {
        if (byTgl[rec[j].tgl] === undefined) byTgl[rec[j].tgl] = rec[j].status;
        else if (byTgl[rec[j].tgl] !== rec[j].status) tidakKoheren++;
        if (!rec[j].tgl) tidakKoheren++;
      }
    }
    t.eq(tidakKoheren, 0, 'status satu anak sama di seluruh mapel yang diajarkan pada tanggal yang sama (' + totalSesi + ' sesi diperiksa)');
    t.ok(Object.keys(byTgl).length > 20, 'presensi mapel tersebar pada ' + Object.keys(byTgl).length + ' tanggal berbeda');

    // Rollups still equal the underlying records.
    var mismatch = 0;
    for (i = 0; i < sc.mapel.length; i++) {
      var rec2 = A.presensiEfektif(ctx, nisn, sc.mapel[i], S.TA_AKTIF, 'ganjil', rb.nama);
      var roll = D.rollupPresensi(rec2);
      var manual = { H: 0, S: 0, I: 0, A: 0 };
      for (j = 0; j < rec2.length; j++) manual[rec2[j].status]++;
      if (manual.H !== roll.H || manual.S !== roll.S || manual.I !== roll.I || manual.A !== roll.A) mismatch++;
      if (roll.total !== rec2.length) mismatch++;
    }
    t.eq(mismatch, 0, 'rekap per mapel cocok dengan hitungan manual');

    // The rapor counts in HARI, from the daily register — not by summing sessions.
    var harian = A.presensiHarianEfektif(ctx, nisn, S.TA_AKTIF, 'ganjil');
    var rollHari = D.rollupPresensi(harian, 'hari');
    t.eq(harian.length, kal.hariEfektif.length, 'buku harian memuat seluruh hari efektif');
    var rap = A.hitungRapor(ctx, nisn, S.TA_AKTIF, 'ganjil');
    t.eq(rap.presensi.total, rollHari.total, 'ketidakhadiran di rapor dihitung dalam hari, bukan dalam sesi');
    t.eq(rap.syaratKehadiran.alpaHari, rollHari.A, 'jumlah alpa di rapor adalah jumlah hari alpa');
    t.ok(rap.presensi.total < totalSesi, 'jumlah hari (' + rap.presensi.total + ') memang lebih kecil dari jumlah sesi (' + totalSesi + ')');

    /* Eligibility bites on UNEXCUSED absence. A child with 30 documented sakit
     * and zero alpa is not a truant, and flagging them identically throws away
     * the only information the four statuses were collected for. */
    var sakit = [];
    for (i = 0; i < 100; i++) sakit.push({ status: i < 70 ? 'H' : 'S' });
    var rs = D.rollupPresensi(sakit);
    t.eq(rs.persen, 70, '70 dari 100 hadir = 70% kehadiran');
    t.eq(rs.persenAlpa, 0, 'tanpa satu pun alpa');
    t.ok(rs.memenuhiSyarat, '30 hari sakit berdokumen TIDAK menggugurkan kelayakan');
    t.notOk(rs.kehadiranCukup, 'sementara kehadiran murni tetap dilaporkan di bawah ambang, sebagai informasi terpisah');

    var bolos = [];
    for (i = 0; i < 100; i++) bolos.push({ status: i < 85 ? 'H' : 'A' });
    var rbo = D.rollupPresensi(bolos);
    t.notOk(rbo.memenuhiSyarat, '15% alpa menggugurkan kelayakan meski kehadiran 85%');
    t.ok(rbo.kehadiranCukup, 'padahal kehadirannya di atas ' + D.MIN_KEHADIRAN + '%');
    t.ok(D.isExcused('S') && D.isExcused('I') && !D.isExcused('A'), 'excused dibaca kode, bukan hanya dideklarasikan');

    var ev = D.evaluasiKehadiran(D.rollupPresensi(bolos, 'hari'));
    t.notOk(ev.terpenuhi, 'evaluasi kehadiran menolak');
    t.ok(ev.alasan.length > 0 && /tanpa keterangan|alpa/.test(ev.alasan.join(' ')), 'dan menyebut aturan mana yang dilanggar');

    // An edited day moves every subject taught that day.
    var target = null;
    for (i = 0; i < harian.length; i++) if (harian[i].status === 'H') { target = harian[i].tgl; break; }
    var ctx3 = ctxFor(sc);
    ctx3.presensiOverrides[A.presensiHariKey(S.TA_AKTIF, 'ganjil', nisn, target)] = { status: 'A' };
    var rollBaru = D.rollupPresensi(A.presensiHarianEfektif(ctx3, nisn, S.TA_AKTIF, 'ganjil'), 'hari');
    t.eq(rollBaru.A, rollHari.A + 1, 'koreksi harian H->A menambah alpa tepat satu hari');
    var adaMapel = 0;
    for (i = 0; i < sc.mapel.length; i++) {
      var rr = A.presensiEfektif(ctx3, nisn, sc.mapel[i], S.TA_AKTIF, 'ganjil', rb.nama);
      for (j = 0; j < rr.length; j++) if (rr[j].tgl === target && rr[j].status === 'A') adaMapel++;
    }
    t.ok(adaMapel > 0, 'dan ikut terlihat pada ' + adaMapel + ' sesi mapel yang diajarkan hari itu');

    // A per-session correction overrides only that subject's session.
    var mp0 = sc.mapel[0];
    var sesi0 = S.sesiMapel(rb.nama, mp0, S.TA_AKTIF, 'ganjil');
    var ctx4 = ctxFor(sc);
    ctx4.presensiOverrides[A.presensiKey(S.TA_AKTIF, 'ganjil', nisn, mp0.id, sesi0[0].tgl)] = { status: 'I' };
    var s0 = A.presensiEfektif(ctx4, nisn, mp0, S.TA_AKTIF, 'ganjil', rb.nama);
    t.eq(s0[0].status, 'I', 'koreksi per sesi berlaku untuk sesi itu');
    var harian4 = A.presensiHarianEfektif(ctx4, nisn, S.TA_AKTIF, 'ganjil');
    var sama = harian4.filter(function (x) { return x.tgl === sesi0[0].tgl; })[0];
    t.eq(sama.status, S.presensiHari(nisn, sesi0[0].tgl), 'tanpa mengubah fakta harian yang mendasarinya');
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

    var wali = { role: 'wali', guruId: 'G03', rombelId: '2026/2027|8A' };
    t.ok(D.can(wali, 'nilai.read', { rombelId: '2026/2027|8A', pengampuGuruId: 'G09' }).allowed, 'wali kelas boleh MEMBACA nilai seluruh rombelnya');
    var waliTulis = D.can(wali, 'nilai.write', { pengampuGuruId: 'G09', pengampuNama: 'Pak Doni' });
    t.notOk(waliTulis.allowed, 'wali kelas TIDAK boleh menulis nilai mapel guru lain');
    t.ok(/BACA|baca/.test(waliTulis.reason), 'penolakan menjelaskan bahwa status wali hanya memberi hak baca');
    t.ok(D.can(wali, 'nilai.write', { pengampuGuruId: 'G03' }).allowed, 'wali kelas tetap boleh menulis nilai mapelnya sendiri');
    t.notOk(D.can(wali, 'rapor.read', { rombelId: '2026/2027|8B' }).allowed, 'wali kelas tidak boleh membuka rapor rombel lain');
    t.ok(D.can(wali, 'sikap.write', { rombelId: '2026/2027|8A' }).allowed, 'wali kelas menilai sikap rombelnya');
    t.notOk(D.can(guruA, 'sikap.write', { rombelId: '2026/2027|8A' }).allowed, 'guru mapel tidak menilai sikap');
    t.notOk(D.can(guruA, 'presensi.harian.write', { rombelId: '2026/2027|8A' }).allowed, 'buku presensi harian bukan kewenangan guru mapel');
    t.ok(D.can(wali, 'presensi.harian.write', { rombelId: '2026/2027|8A' }).allowed, 'melainkan wali kelas');

    var admin = { role: 'admin' };
    t.ok(D.can(admin, 'siswa.write', {}).allowed, 'TU boleh mengubah data induk');
    t.ok(D.can(admin, 'jadwal.solve', {}).allowed, 'TU boleh menjalankan penyusunan jadwal');
    var adminNilai = D.can(admin, 'nilai.write', { pengampuGuruId: 'G01' });
    t.notOk(adminNilai.allowed, 'TU TIDAK boleh mengubah nilai');
    t.ok(/guru pengampu/.test(adminNilai.reason), 'alasannya menyebut kewenangan guru pengampu');
    t.notOk(D.can(admin, 'sikap.write', {}).allowed, 'TU juga tidak menilai sikap');
    t.notOk(D.can({ role: 'guru', guruId: 'G01' }, 'jadwal.solve', {}).allowed, 'guru tidak menjalankan solver jadwal');

    var ortu = { role: 'ortu', nisn: '9900000001' };
    t.ok(D.can(ortu, 'rapor.read', { nisn: '9900000001' }).allowed, 'orang tua boleh membaca rapor anaknya');
    var ortuLain = D.can(ortu, 'rapor.read', { nisn: '9900000002' });
    t.notOk(ortuLain.allowed, 'orang tua DITOLAK membuka data anak lain');
    t.ok(ortuLain.reason.indexOf('9900000001') >= 0, 'penolakan menyebut NISN yang memang miliknya');
    t.notOk(D.can(ortu, 'nilai.write', { pengampuGuruId: 'G01' }).allowed, 'akun orang tua tidak pernah bisa menulis');
    t.notOk(D.can(ortu, 'siswa.read', {}).allowed, 'orang tua tidak bisa melihat daftar seluruh siswa');
    t.notOk(D.can({ role: 'entah' }, 'nilai.read', {}).allowed, 'peran tak dikenal ditolak secara default');
  });

  group('Peran — wali kelas selalu mengampu mapel di rombelnya sendiri', function (t) {
    var sc = school();
    var tanpaMapel = [], gandaTahun = [];
    sc.sekolah.taList.forEach(function (ta) {
      var terpakai = {};
      sc.rombelByTa[ta].forEach(function (rb) {
        var mapel = S.MAPEL.filter(function (m) {
          return sc.pengampu[ta + '|' + rb.nama + '|' + m.id] === rb.waliGuruId;
        });
        if (!mapel.length) tanpaMapel.push(ta + ' ' + rb.nama);
        if (terpakai[rb.waliGuruId]) gandaTahun.push(ta + ' ' + rb.nama);
        terpakai[rb.waliGuruId] = true;
      });
    });
    t.eq(tanpaMapel.length, 0, 'tidak ada wali kelas yang tidak mengajar satu mapel pun di rombelnya (' + tanpaMapel.join(', ') + ')');
    t.eq(gandaTahun.length, 0, 'tidak ada guru yang menjadi wali dua rombel pada tahun ajaran yang sama');

    // And because of that the wali really can write something in their own class.
    var rb0 = sc.rombelByTa[S.TA_AKTIF][0];
    var mapelWali = S.MAPEL.filter(function (m) { return sc.pengampu[S.TA_AKTIF + '|' + rb0.nama + '|' + m.id] === rb0.waliGuruId; })[0];
    var izin = D.can({ role: 'wali', guruId: rb0.waliGuruId, rombelId: rb0.id }, 'nilai.write',
      { pengampuGuruId: sc.pengampu[S.TA_AKTIF + '|' + rb0.nama + '|' + mapelWali.id] });
    t.ok(izin.allowed, 'wali ' + rb0.nama + ' benar-benar punya kewenangan tulis di kelasnya sendiri (' + mapelWali.kode + ')');
  });

  /* ================================================ 6. iuran komite == */

  group('Iuran komite — sukarela, dan bulan mendatang bukan kekurangan', function (t) {
    var sc = school();
    var rb = sc.rombelByTa[S.TA_AKTIF][0];
    var siswa = sc.siswa[rb.siswa[0]];
    var ledger = S.komiteLedger(siswa, S.TA_AKTIF);
    t.eq(ledger.length, 12, 'satu tahun ajaran = 12 bulan');
    t.eq(ledger[0].month, 7, 'dimulai Juli');
    t.eq(ledger[11].month, 6, 'dan berakhir Juni');
    var roll = D.rollupKomite(ledger, S.SEKARANG);
    t.eq(roll.lunas + roll.belumDibayar + roll.bebas + roll.belum, 12, 'setiap bulan punya tepat satu status');

    var depan = roll.bulan.filter(function (b) {
      return Date.UTC(b.year, b.month - 1, 10) > S.SEKARANG && b.status === 'belum-dibayar';
    });
    t.eq(depan.length, 0, 'bulan yang belum jatuh tempo TIDAK dihitung sebagai kekurangan');
    t.ok(roll.bulan.some(function (b) { return b.status === 'belum-jatuh-tempo'; }), 'bulan mendatang berstatus tersendiri');

    /* The school is negeri, so nothing in the vocabulary may say "tunggakan":
     * a voluntary komite contribution cannot be in arrears and cannot be
     * dunned. This is a naming assertion on purpose — the words on the screen
     * are the part a school reads. */
    t.eq(D.KOMITE_SIFAT, 'sukarela', 'iuran komite dinyatakan sukarela di level domain');
    var statuses = roll.bulan.map(function (b) { return b.status; }).join(',');
    t.notOk(/tunggakan/.test(statuses), 'tidak ada status "tunggakan" di mana pun');
    t.ok(/sukarela/.test(D.KOMITE_STATUS_LABEL['belum-dibayar']), 'label bulan yang belum dibayar menyebut sifat sukarelanya');
    t.eq(sc.sekolah.bentuk, 'negeri', 'sekolahnya memang negeri — sama dengan sekolah yang PPDB-nya berjalan dengan zonasi');

    var kip = null;
    for (var k in sc.siswa) if (sc.siswa[k].kip && sc.siswa[k].enrol[S.TA_AKTIF]) { kip = sc.siswa[k]; break; }
    if (kip) {
      var rk = D.rollupKomite(S.komiteLedger(kip, S.TA_AKTIF), S.SEKARANG);
      t.eq(rk.belumDibayar, 0, 'penerima KIP dibebaskan, jadi tidak pernah muncul sebagai belum membayar');
      t.eq(rk.bebas, 12, 'seluruh 12 bulannya berstatus bebas');
    }
    t.eq(D.rupiah(165000), 'Rp165.000', 'format rupiah memakai titik ribuan');
    t.eq(D.rupiah(1650000), 'Rp1.650.000', 'format rupiah untuk jutaan');

    var lulus = null;
    for (k in sc.siswa) if (!sc.siswa[k].enrol[S.TA_AKTIF]) { lulus = sc.siswa[k]; break; }
    t.eq(S.komiteLedger(lulus, S.TA_AKTIF).length, 0, 'siswa yang tidak terdaftar tahun ini tidak dibukukan');
  });

  /* ========================================================= 7. PPDB == */

  group('PPDB — kuota di dalam batas regulasi, usia diperiksa, hasil = roster', function (t) {
    var sc = school();
    var ppdb = sc.ppdb;
    var hasil = D.seleksiPpdb(ppdb.pendaftar, ppdb.kuotaTotal, 5, { tanggalAcuan: ppdb.tanggalAcuan });
    var diterima = hasil.hasil.filter(function (h) { return h.status === 'diterima'; });
    t.eq(diterima.length, ppdb.kuotaTotal, 'jumlah yang diterima tepat sama dengan kuota (' + ppdb.kuotaTotal + ')');
    var nisnSet = {}, dup = 0;
    diterima.forEach(function (h) { if (nisnSet[h.nisn]) dup++; else nisnSet[h.nisn] = 1; });
    t.eq(dup, 0, 'tidak ada pendaftar diterima dua kali');

    /* The regulatory bounds. Floors round UP, the ceiling rounds DOWN, and the
     * residual jalur absorbs the remainder — otherwise perpindahan takes 6 of
     * 96 seats (6.25% against a hard 5% ceiling) and afirmasi gets 14 (14.58%
     * against a 15% floor). */
    var kuota = hasil.kuota, total = ppdb.kuotaTotal;
    t.ok(kuota.zonasi >= Math.ceil(total * 0.5), 'zonasi >= 50% kuota (' + kuota.zonasi + '/' + total + ')');
    t.ok(kuota.afirmasi >= Math.ceil(total * 0.15), 'afirmasi >= 15% kuota — dibulatkan ke ATAS, bukan ke bawah (' + kuota.afirmasi + '/' + total + ')');
    t.ok(kuota.perpindahan <= Math.floor(total * 0.05), 'perpindahan tugas <= 5% kuota (' + kuota.perpindahan + '/' + total + ')');
    t.ok(kuota.perpindahan / total <= 0.05 + 1e-9, 'dan porsinya benar-benar tidak melampaui plafon 5%');
    t.ok(kuota.afirmasi / total >= 0.15 - 1e-9, 'dan porsi afirmasi benar-benar mencapai lantai 15%');
    t.eq(kuota.zonasi + kuota.afirmasi + kuota.prestasi + kuota.perpindahan, total, 'keempat jalur menjumlah persis ke kuota total');
    var langgar = D.periksaKuota(kuota, total).filter(function (x) { return !x.ok; });
    t.eq(langgar.length, 0, 'pemeriksa kuota tidak menemukan pelanggaran');

    // Age eligibility is checked BEFORE ranking, and refused by name.
    t.ok(ppdb.gugur.length > 0, ppdb.gugur.length + ' pendaftar gugur karena batas usia');
    t.ok(ppdb.gugur.every(function (g) { return g.usia > D.PPDB_USIA_MAKS || g.usia < D.PPDB_USIA_MIN; }), 'semuanya benar-benar di luar rentang usia');
    t.ok(/usia/i.test(ppdb.gugur[0].alasan), 'alasannya menyebut usia, bukan "tidak memenuhi syarat" saja');
    var gugurDapatKursi = hasil.hasil.filter(function (hh) {
      return hh.status === 'diterima' && ppdb.gugur.some(function (g) { return g.nisn === hh.nisn; });
    });
    t.eq(gugurDapatKursi.length, 0, 'pendaftar yang gugur usia tidak mungkin mendapat kursi');

    /* The two tabs must describe one school. The accepted candidates ARE the
     * kelas-7 roster — not a separate roster that happens to overlap. */
    var enrolled = {};
    sc.rombelByTa[S.TA_AKTIF].filter(function (r) { return r.tingkat === 7; })
      .forEach(function (r) { r.siswa.forEach(function (n) { enrolled[n] = 1; }); });
    var jumlahEnrolled = Object.keys(enrolled).length;
    var diterimaTakTerdaftar = diterima.filter(function (hh) { return !enrolled[hh.nisn]; });
    var terdaftarTakDiterima = Object.keys(enrolled).filter(function (n) {
      return !diterima.some(function (hh) { return hh.nisn === n; });
    });
    t.eq(jumlahEnrolled, ppdb.kuotaTotal, 'kelas 7 berisi persis ' + ppdb.kuotaTotal + ' anak');
    t.eq(diterimaTakTerdaftar.length, 0, 'setiap pendaftar yang diterima benar-benar terdaftar di kelas 7');
    t.eq(terdaftarTakDiterima.length, 0, 'dan setiap anak kelas 7 memang diterima lewat PPDB');

    // Ranking within zonasi is by distance, ascending, with no exceptions.
    var zonHasil = hasil.hasil.filter(function (hh) { return hh.jalur === 'zonasi' && hh.peringkat; });
    var urut = true;
    for (var i = 1; i < zonHasil.length; i++) if (zonHasil[i].ref.jarakMeter < zonHasil[i - 1].ref.jarakMeter) urut = false;
    t.ok(urut, 'peringkat zonasi terurut dari yang terdekat');
    var pres = hasil.hasil.filter(function (hh) { return hh.jalur === 'prestasi' && hh.peringkat; });
    var urut2 = true;
    for (i = 1; i < pres.length; i++) if (pres[i].ref.skor > pres[i - 1].ref.skor) urut2 = false;
    t.ok(urut2, 'peringkat prestasi terurut dari skor tertinggi');

    /* PPDB bukan siapa cepat dia dapat: outside jalur perpindahan the tie-break
     * is age, oldest first — never registration order. */
    var cmp = D.comparePendaftar('jarak');
    var tua = { nisn: '9900000002', jarakMeter: 500, tglLahir: '2013-01-05', daftarAt: 9999 };
    var muda = { nisn: '9900000001', jarakMeter: 500, tglLahir: '2014-01-05', daftarAt: 1 };
    t.ok(cmp(tua, muda) < 0, 'pada jarak yang sama, pendaftar lebih TUA didahulukan meski mendaftar belakangan');

    t.ok(hasil.hasil.some(function (hh) { return hh.status === 'cadangan'; }), 'ada daftar cadangan (waiting list)');
    t.ok(hasil.hasil.some(function (hh) { return hh.status === 'tidak-diterima'; }), 'ada pendaftar yang tidak diterima');

    var lagi = D.seleksiPpdb(ppdb.pendaftar, ppdb.kuotaTotal, 5, { tanggalAcuan: ppdb.tanggalAcuan });
    t.eq(JSON.stringify(hasil.hasil.map(function (hh) { return hh.nisn + hh.status; })),
      JSON.stringify(lagi.hasil.map(function (hh) { return hh.nisn + hh.status; })),
      'menjalankan seleksi dua kali memberi hasil identik');

    var acak = ppdb.pendaftar.slice().reverse();
    var hasil3 = D.seleksiPpdb(acak, ppdb.kuotaTotal, 5, { tanggalAcuan: ppdb.tanggalAcuan });
    var setA = diterima.map(function (hh) { return hh.nisn; }).sort().join(',');
    var setB = hasil3.hasil.filter(function (hh) { return hh.status === 'diterima'; }).map(function (hh) { return hh.nisn; }).sort().join(',');
    t.eq(setA, setB, 'urutan pendaftar masuk tidak mempengaruhi siapa yang diterima');
  });

  /* ================================================== 8. data sintetis == */

  group('Data — seluruhnya fabrikasi dan dapat dibangun ulang', function (t) {
    var sc = school();
    var bukanDemo = sc.nisnUrut.filter(function (n) { return !D.isDemoNisn(n); });
    t.eq(bukanDemo.length, 0, 'setiap NISN berasal dari blok sintetis 99xxxxxxxx');
    t.eq(sc.sekolah.npsn, '00000000', 'NPSN sekolah adalah nol, bukan nomor satuan pendidikan sungguhan');
    t.ok(/fiktif/.test(sc.sekolah.nama), 'nama sekolah menyatakan dirinya fiktif');

    /* Three identifier classes are absent on purpose, because none of them has
     * a safe fake form: NIK, NIP, and a parent mobile number. An 08xx number
     * drawn at random sits inside the live Indonesian numbering space and can
     * reach a real person — it was the one field here that could. */
    var adaNik = 0, adaHp = 0;
    for (var k in sc.siswa) {
      if (sc.siswa[k].nik) adaNik++;
      if (sc.siswa[k].hpOrtu || sc.siswa[k].hp || sc.siswa[k].telepon) adaHp++;
    }
    t.eq(adaNik, 0, 'tidak ada NIK di dalam dataset sama sekali');
    t.eq(adaHp, 0, 'tidak ada nomor telepon orang tua di dalam dataset sama sekali');
    var adaNip = sc.guru.filter(function (g) { return g.nip; }).length;
    t.eq(adaNip, 0, 'tidak ada NIP guru — NIP 18 digit yang dipalsukan berpeluang menjadi NIP pegawai sungguhan');

    // Teacher credentials follow the subject they teach.
    var gelarSalah = sc.guru.filter(function (g) {
      if (g.mapelUtama === 'pabp') return !/S\.Ag\.|S\.Pd\.I\./.test(g.nama);
      if (g.mapelUtama !== 'pabp') return /S\.Ag\.|S\.Pd\.I\./.test(g.nama);
      return false;
    });
    t.eq(gelarSalah.length, 0, 'gelar guru mengikuti mapel yang diampu (S.Ag./S.Pd.I. hanya untuk PABP)');

    var sc2 = S.build(20260915);
    t.eq(sc2.nisnUrut.join(','), sc.nisnUrut.join(','), 'seed yang sama menghasilkan NISN yang sama');
    t.eq(sc2.guru.map(function (g) { return g.nama; }).join('|'), sc.guru.map(function (g) { return g.nama; }).join('|'), 'seed yang sama menghasilkan guru yang sama');
    var sc3 = S.build(999);
    t.ok(sc3.nisnUrut[0] !== sc.nisnUrut[0], 'seed berbeda menghasilkan sekolah berbeda');

    var jumlah = Object.keys(sc.siswa).length;
    t.ok(jumlah >= 280 && jumlah <= 330, 'dataset berisi ' + jumlah + ' peserta didik (aktif + alumni + pendaftar yang diterima)');
    var aktif = sc.rombelByTa[S.TA_AKTIF].reduce(function (a, r) { return a + r.siswa.length; }, 0);
    t.eq(aktif, 240, '240 peserta didik aktif pada tahun berjalan');
    t.eq(sc.rombelByTa[S.TA_AKTIF].length, 8, '8 rombel pada tahun berjalan');
    t.eq(sc.guru.length, 14, '14 guru');
  });

  group('Kurikulum — satu kurikulum, konsisten', function (t) {
    var sc = school();
    t.eq(D.KURIKULUM.id, 'k13', 'aplikasi menyatakan satu kurikulum dan itu K13');
    t.eq(sc.mapel.length, 11, '11 mata pelajaran');
    var totalJp = sc.mapel.reduce(function (a, m) { return a + m.jp; }, 0);
    var intra = sc.mapel.filter(function (m) { return m.kelompok !== 'mulok'; }).reduce(function (a, m) { return a + m.jp; }, 0);
    var mulok = sc.mapel.filter(function (m) { return m.kelompok === 'mulok'; }).reduce(function (a, m) { return a + m.jp; }, 0);
    t.eq(intra, S.JP_INTRA, 'kelompok A + B berjumlah ' + S.JP_INTRA + ' JP — struktur K13 SMP');
    t.eq(mulok, S.JP_MULOK, 'muatan lokal ' + S.JP_MULOK + ' JP');
    t.eq(totalJp, S.JP_INTRA + S.JP_MULOK, 'total ' + totalJp + ' JP per minggu');

    // The individual allocations a wakasek kurikulum would check first.
    function jp(id) { var m = sc.mapel.filter(function (x) { return x.id === id; })[0]; return m ? m.jp : null; }
    t.eq(jp('pabp'), 3, 'PABP 3 JP');
    t.eq(jp('ppkn'), 3, 'PPKn 3 JP');
    t.eq(jp('bind'), 6, 'Bahasa Indonesia 6 JP');
    t.eq(jp('mtk'), 5, 'Matematika 5 JP');
    t.eq(jp('ipa'), 5, 'IPA 5 JP');
    t.eq(jp('ips'), 4, 'IPS 4 JP');
    t.eq(jp('bing'), 4, 'Bahasa Inggris 4 JP');
    t.eq(jp('seni'), 3, 'Seni Budaya 3 JP');
    t.eq(jp('pjok'), 3, 'PJOK 3 JP');
    t.eq(jp('bjaw'), 2, 'mulok Bahasa Jawa 2 JP');
    t.eq(jp('prak'), null, 'Prakarya TIDAK ditawarkan bersama Informatika — K13 memberi satu slot pilihan, bukan dua mapel');
    t.eq(jp('infm'), 2, 'Informatika 2 JP mengisi slot pilihan Prakarya/Informatika');
    var nama = sc.mapel.filter(function (m) { return m.id === 'ppkn'; })[0].nama;
    t.ok(/Kewarganegaraan/.test(nama), 'penamaan mapel mengikuti K13 (PPKn), bukan campuran K13/Merdeka');

    var blokJp = sc.mapel.reduce(function (a, m) { return a + m.blok.reduce(function (x, b) { return x + b.len; }, 0); }, 0);
    t.eq(blokJp, totalJp, 'pemecahan blok menjumlah persis ke JP kurikulum');

    var kapasitas = S.HARI.reduce(function (a, hh) { return a + hh.slots; }, 0);
    t.ok(kapasitas > totalJp, 'kalender (' + kapasitas + ' JP) menyisakan ' + (kapasitas - totalJp) + ' JP di luar ' + totalJp + ' JP terjadwal');

    // Staffing is tight enough to be real.
    var beban = S.hitungBebanGuru(sc, S.TA_AKTIF);
    var totalBeban = 0, maxJp = 0, minJp = 999;
    sc.guru.forEach(function (g) {
      totalBeban += beban[g.id].jp;
      maxJp = Math.max(maxJp, beban[g.id].jp);
      minJp = Math.min(minJp, beban[g.id].jp);
    });
    t.eq(totalBeban, sc.rombelByTa[S.TA_AKTIF].length * totalJp, 'beban seluruh guru menjumlah persis ke kebutuhan sekolah');
    t.ok(maxJp <= 40, 'tidak ada guru dengan beban di atas 40 JP (' + maxJp + ')');
    t.ok(minJp >= 16, 'beban terendah ' + minJp + ' JP');
    var penuh = sc.guru.filter(function (g) { return beban[g.id].memenuhiMinimal; }).length;
    t.ok(penuh >= sc.guru.length - 3, penuh + ' dari ' + sc.guru.length + ' guru mencapai beban minimal ' + S.JP_MINIMAL_SERTIFIKASI + ' JP');
    t.ok(penuh < sc.guru.length, 'dan sisanya dilaporkan kurang jam, bukan disembunyikan');
  });

  group('Kalender — blok tidak boleh melewati istirahat', function (t) {
    var senin = S.HARI[0];
    var segs = SV.segmentsOf(senin);
    t.eq(segs.length, 3, 'Senin terbagi menjadi 3 segmen oleh dua istirahat');
    t.eq(segs[0].from + '-' + segs[0].to, '1-3', 'segmen pertama JP 1-3');
    t.eq(segs[1].from + '-' + segs[1].to, '4-7', 'segmen kedua JP 4-7');
    t.eq(segs[2].from + '-' + segs[2].to, '8-11', 'segmen ketiga JP 8-11');
    t.ok(SV.blockFits(senin, 1, 3), 'blok 3 JP muat di segmen pertama');
    t.notOk(SV.blockFits(senin, 2, 3), 'blok 3 JP mulai JP 2 akan terpotong istirahat');
    t.notOk(SV.blockFits(senin, 3, 2), 'blok 2 JP mulai JP 3 melompati istirahat');
    t.ok(SV.blockFits(senin, 4, 4), 'blok 4 JP mulai JP 4 muat di segmen kedua');
    var jumat = S.HARI[4];
    t.eq(jumat.slots, 6, "Jum'at lebih pendek");
    t.notOk(SV.blockFits(jumat, 5, 3), "blok 3 JP tidak muat di akhir Jum'at");
    t.ok(/^07\.00/.test(S.jamSlot(0, 1)), 'jam pertama mulai 07.00');
    t.ok(S.jamSlot(0, 4).indexOf('09.15') === 0, 'jam ke-4 sudah memperhitungkan istirahat pertama');

    // Dates are handled in UTC, so a school year does not move by timezone.
    t.eq(D.ymd(Date.UTC(2026, 6, 13)), '2026-07-13', 'konversi tanggal memakai UTC');
    t.eq(D.parseYmd('2026-07-13'), Date.UTC(2026, 6, 13), 'dan bolak-balik konsisten');
    t.eq(new Date(S.kalenderSemester(S.TA_AKTIF, 'ganjil').mulaiTs).getUTCDay(), 1, 'semester selalu dimulai hari Senin');
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
