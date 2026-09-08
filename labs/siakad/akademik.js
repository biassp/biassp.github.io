/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — akademik.js
 * Composes the derived dataset with whatever a teacher has actually edited,
 * and assembles the rapor. Pure: takes the school, the override maps and the
 * config, returns a value. No DOM, no database, no clock — which is what lets
 * the assertion suite run it twice and demand byte-identical output.
 *
 * The key ordering rule: EVERY lookup here is keyed by
 *   (tahun ajaran, semester, NISN, mapel, aspek)
 * in that order, AND SO IS THE CONFIGURATION. A read that forgets the year
 * silently returns this year's marks for last year's rapor; a *configuration*
 * that forgets the year is worse, because it silently RE-DERIVES last year's
 * rapor under this year's rules — the marks, the predikat and the tuntas /
 * remedial status of a document that has already been signed and handed to a
 * parent all move, and nothing on screen says they did. Bobot penilaian and
 * KKM are therefore keyed by tahun ajaran exactly like nilai and presensi.
 */
(function (root) {
  'use strict';

  var D = root.SIAKAD_DOMAIN;
  var S = root.SIAKAD_DATA;
  var A = {};
  root.SIAKAD_AKADEMIK = A;

  A.nilaiKey = function (ta, sem, nisn, mapelId, aspek) {
    return ta + '|' + sem + '|' + nisn + '|' + mapelId + '|' + (aspek || 'peng');
  };
  // Per-session correction by the guru mapel, anchored to a DATE.
  A.presensiKey = function (ta, sem, nisn, mapelId, tgl) {
    return ta + '|' + sem + '|' + nisn + '|' + mapelId + '|' + tgl;
  };
  // The daily register kept by the wali kelas: the underlying dated fact.
  A.presensiHariKey = function (ta, sem, nisn, tgl) {
    return ta + '|' + sem + '|' + nisn + '|#hari|' + tgl;
  };
  A.sikapKey = function (ta, sem, nisn) { return ta + '|' + sem + '|' + nisn; };

  /* ------------------------------------------------- konfigurasi per TA -- */

  A.bobotFor = function (ctx, ta, mapelId, aspek) {
    var konfig = ctx.konfig || {};
    var perTa = konfig.bobot && konfig.bobot[ta];
    var mp = perTa && perTa[mapelId];
    if (mp && mp[aspek]) return mp[aspek];
    var dasar = ctx.school.bobot[ta] && ctx.school.bobot[ta][mapelId];
    if (dasar && dasar[aspek]) return dasar[aspek];
    return D.BOBOT_DEFAULT[aspek];
  };

  A.kkmFor = function (ctx, ta, mapelId) {
    var konfig = ctx.konfig || {};
    var perTa = konfig.kkm && konfig.kkm[ta];
    if (perTa && perTa[mapelId] !== undefined) return perTa[mapelId];
    var dasar = ctx.school.kkm[ta];
    if (dasar && dasar[mapelId] !== undefined) return dasar[mapelId];
    for (var i = 0; i < S.MAPEL.length; i++) if (S.MAPEL[i].id === mapelId) return S.MAPEL[i].kkm;
    return 70;
  };

  /* Derived marks for one aspect, with any saved edit laid on top per
   * component. An edit to PTS must not silently reset the other three, so
   * overrides are merged field-by-field rather than replacing the row.
   *
   * A component whose assessment window has not closed stays null and refuses
   * an override: a school cannot record a PAS mark in week six, and letting the
   * UI accept one would put a number on a rapor for an exam that has not
   * happened. */
  A.nilaiEfektif = function (overrides, nisn, mapelId, ta, sem, aspek) {
    aspek = aspek || 'peng';
    var komponen = D.komponenAspek(aspek);
    var base = S.nilaiMapel(nisn, mapelId, ta, sem, aspek);
    var ov = overrides && overrides[A.nilaiKey(ta, sem, nisn, mapelId, aspek)];
    var out = {}, diubah = {}, adaEdit = false, belum = [];
    for (var i = 0; i < komponen.length; i++) {
      var k = komponen[i].id;
      if (base[k] === null) { out[k] = null; belum.push(k); continue; }
      if (ov && ov.nilai && ov.nilai[k] !== undefined && ov.nilai[k] !== null && ov.nilai[k] !== '') {
        out[k] = D.clamp(Number(ov.nilai[k]), 0, 100);
        diubah[k] = true; adaEdit = true;
      } else out[k] = base[k];
    }
    return {
      nilai: out, diubah: diubah, adaEdit: adaEdit, belum: belum,
      oleh: ov && ov.oleh, pada: ov && ov.pada
    };
  };

  /* --------------------------------------------------------- presensi ----
   * Two grains over ONE set of dated facts:
   *   presensiHarianEfektif  the daily register (wali kelas) — what the rapor's
   *                          Ketidakhadiran block is counted from, in hari
   *   presensiEfektif        the per-subject session view (guru mapel) — a
   *                          projection of the same days onto the dates that
   *                          subject actually meets
   * A per-session correction sits on top of the day fact for that one subject;
   * with no correction the two always agree, which is why a child who was ill
   * on a Tuesday reads 'S' in every subject taught that Tuesday.
   */
  A.presensiHarianEfektif = function (ctx, nisn, ta, sem) {
    var ov = ctx.presensiOverrides || {};
    var hari = S.hariEfektifHingga(ta, sem);
    var out = [];
    for (var i = 0; i < hari.length; i++) {
      var rec = ov[A.presensiHariKey(ta, sem, nisn, hari[i])];
      out.push({
        tgl: hari[i],
        status: rec ? rec.status : S.presensiHari(nisn, hari[i]),
        diubah: !!rec
      });
    }
    return out;
  };

  A.presensiEfektif = function (ctx, nisn, mapel, ta, sem, rombelNama) {
    var ov = ctx.presensiOverrides || {};
    var sesi = S.sesiMapel(rombelNama, mapel, ta, sem);
    var out = [];
    for (var i = 0; i < sesi.length; i++) {
      var s = sesi[i];
      var perSesi = ov[A.presensiKey(ta, sem, nisn, mapel.id, s.tgl)];
      var perHari = ov[A.presensiHariKey(ta, sem, nisn, s.tgl)];
      var status = perSesi ? perSesi.status : (perHari ? perHari.status : S.presensiHari(nisn, s.tgl));
      out.push({
        n: s.n, tgl: s.tgl, hariIdx: s.hariIdx, pekan: s.pekan,
        status: status,
        diubah: !!perSesi,
        dariHarian: !perSesi
      });
    }
    return out;
  };

  /* ------------------------------------------------------------- sikap -- */

  A.sikapEfektif = function (ctx, nisn, ta, sem) {
    var ov = (ctx.sikapOverrides || {})[A.sikapKey(ta, sem, nisn)];
    var out = { catatanWali: (ov && ov.catatanWali) || '', diubah: !!ov, oleh: ov && ov.oleh };
    for (var i = 0; i < D.SIKAP.length; i++) {
      var dim = D.SIKAP[i].id;
      var dasar = S.sikapDerived(nisn, ta, sem, dim);
      var pred = (ov && ov[dim] && ov[dim].predikat) || dasar.predikat;
      out[dim] = {
        predikat: pred,
        deskripsi: (ov && ov[dim] && ov[dim].deskripsi) ||
          (ov && ov[dim] && ov[dim].predikat
            ? D.deskripsiSikap(dim, pred, nisn + '|' + ta + '|' + sem + '|' + dim)
            : dasar.deskripsi),
        diubah: !!(ov && ov[dim])
      };
    }
    return out;
  };

  /* ------------------------------------------------------------- rapor -- */

  A.hitungRapor = function (ctx, nisn, ta, sem) {
    var school = ctx.school;
    var siswa = school.siswa[nisn];
    if (!siswa) return { ok: false, alasan: 'NISN tidak dikenal.' };

    /* A semester that has not started has no rapor — not an empty one, none.
     * Same rule as the enrolment check below, and for the same reason: a
     * fabricated document is far more dangerous than a refusal. */
    var statusSem = S.statusSemester(ta, sem);
    if (statusSem === 'belum-mulai') {
      var kal0 = S.kalenderSemester(ta, sem);
      return {
        ok: false,
        sebab: 'semester-belum-mulai',
        alasan: 'Semester ' + sem + ' ' + ta + ' belum berjalan — dimulai ' +
          D.tanggalPanjang(kal0.mulaiTs) + ', sedangkan tanggal acuan demo adalah ' +
          S.SEKARANG_LABEL + '. Tidak ada nilai, tidak ada presensi, dan karena itu tidak ada rapor.'
      };
    }

    var enrol = siswa.enrol[ta];
    // The whole point of scoping: a child who was not enrolled that year has
    // no rapor for that year. Not an empty one — none.
    if (!enrol) {
      return {
        ok: false,
        sebab: 'tidak-terdaftar',
        alasan: siswa.nama + ' tidak terdaftar pada tahun ajaran ' + ta +
          (siswa.angkatan > D.parseTahunAjaran(ta).start
            ? ' (angkatan ' + siswa.angkatan + ', saat itu belum masuk SMP ini).'
            : ' (angkatan ' + siswa.angkatan + ', sudah lulus/keluar).')
      };
    }

    var baris = [];
    var totalPeng = 0, totalKet = 0, jumlahTuntas = 0, jumlahLengkap = 0;
    var semuaLengkap = true;

    for (var i = 0; i < school.mapel.length; i++) {
      var m = school.mapel[i];
      var kkm = A.kkmFor(ctx, ta, m.id);
      var guruId = school.pengampu[ta + '|' + enrol.rombelNama + '|' + m.id];
      var aspekHasil = {}, aspekEff = {};
      var barisLengkap = true, barisTuntas = true;

      for (var a = 0; a < D.ASPEK.length; a++) {
        var asp = D.ASPEK[a].id;
        var bobot = A.bobotFor(ctx, ta, m.id, asp);
        var eff = A.nilaiEfektif(ctx.nilaiOverrides, nisn, m.id, ta, sem, asp);
        var hasil = D.hitungNilaiAkhir(eff.nilai, bobot, kkm, asp);
        hasil.bobot = bobot;
        hasil.deskripsi = hasil.lengkap
          ? D.deskripsiCapaian(hasil.predikat, asp, m.materi, nisn + '|' + m.id + '|' + ta + '|' + sem + '|' + asp)
          : '';
        aspekHasil[asp] = hasil;
        aspekEff[asp] = eff;
        if (!hasil.lengkap) { barisLengkap = false; barisTuntas = false; }
        else if (!hasil.tuntas) barisTuntas = false;
      }

      var recs = A.presensiEfektif(ctx, nisn, m, ta, sem, enrol.rombelNama);
      var roll = D.rollupPresensi(recs);

      if (!barisLengkap) semuaLengkap = false;
      if (barisLengkap) {
        jumlahLengkap++;
        totalPeng += aspekHasil.peng.nilai;
        totalKet += aspekHasil.ket.nilai;
        if (barisTuntas) jumlahTuntas++;
      }

      baris.push({
        mapel: m, kkm: kkm, guruId: guruId,
        aspek: aspekHasil, eff: aspekEff,
        lengkap: barisLengkap, tuntas: barisLengkap ? barisTuntas : null,
        adaEdit: aspekEff.peng.adaEdit || aspekEff.ket.adaEdit,
        presensi: roll, sesi: recs
      });
    }

    /* Ketidakhadiran is counted in HARI, from the daily register, which is what
     * an Indonesian rapor's block actually contains — Sakit / Izin / Tanpa
     * Keterangan, in days, and never a "Hadir" line. Summing per-subject
     * sessions cannot produce that number, because a child absent on one
     * Tuesday appears in every subject taught that Tuesday. */
    var harian = A.presensiHarianEfektif(ctx, nisn, ta, sem);
    var rollHari = D.rollupPresensi(harian, 'hari');
    var evaluasi = D.evaluasiKehadiran(rollHari);

    var rataPeng = jumlahLengkap ? D.round2(totalPeng / jumlahLengkap) : null;
    var rataKet = jumlahLengkap ? D.round2(totalKet / jumlahLengkap) : null;
    var rata = jumlahLengkap ? D.round2((totalPeng + totalKet) / (jumlahLengkap * 2)) : null;

    return {
      ok: true,
      statusSemester: statusSem,
      lengkap: semuaLengkap,
      siswa: siswa, ta: ta, semester: sem, enrol: enrol,
      rombelNama: enrol.rombelNama, tingkat: enrol.tingkat, absen: enrol.absen,
      baris: baris,
      sikap: A.sikapEfektif(ctx, nisn, ta, sem),
      rekap: {
        rata: rata, rataPeng: rataPeng, rataKet: rataKet,
        tuntas: jumlahTuntas,
        belumTuntas: jumlahLengkap - jumlahTuntas,
        mapelCount: baris.length,
        mapelLengkap: jumlahLengkap
      },
      presensi: rollHari,
      harian: harian,
      // The eligibility rule, stated rather than hidden, and stated in the
      // terms a school's kriteria kenaikan kelas actually uses: unexcused
      // absence. The app never quietly fails a child, and never treats a
      // hospitalised one as a truant.
      syaratKehadiran: evaluasi
    };
  };

  /* Canonical serialisation of a rapor, used by the determinism assertion.
   * Object key order in JS is insertion order, which is exactly the thing a
   * "recompute produced the same numbers" check must not depend on. */
  A.canonicalRapor = function (r) {
    if (!r || !r.ok) return JSON.stringify({ ok: false, alasan: r && r.alasan });
    var rows = r.baris.map(function (b) {
      var parts = [b.mapel.id, b.kkm, b.lengkap ? 1 : 0, b.tuntas ? 1 : 0,
        b.presensi.H, b.presensi.S, b.presensi.I, b.presensi.A];
      D.ASPEK.forEach(function (a) {
        var h = b.aspek[a.id];
        parts.push(a.id + ':' + h.nilai + ':' + h.predikat + ':' + h.deskripsi + ':' +
          h.rincian.map(function (x) { return x.id + ':' + x.nilai + '@' + x.bobot + '=' + x.kontribusi; }).join(','));
      });
      return parts.join('/');
    });
    rows.sort();
    return JSON.stringify({
      nisn: r.siswa.nisn, ta: r.ta, sem: r.semester, rombel: r.rombelNama,
      rata: r.rekap.rata, tuntas: r.rekap.tuntas,
      hadirHari: r.presensi.H, alpaHari: r.presensi.A,
      sikap: D.SIKAP.map(function (s) { return s.id + ':' + r.sikap[s.id].predikat; }).join(','),
      rows: rows
    });
  };

  /* ------------------------------------------------------- leger kelas -- */

  A.legerKelas = function (ctx, rombel, ta, sem) {
    var rows = [];
    for (var i = 0; i < rombel.siswa.length; i++) {
      var nisn = rombel.siswa[i];
      var r = A.hitungRapor(ctx, nisn, ta, sem);
      if (!r.ok) continue;
      rows.push({
        nisn: nisn, nama: ctx.school.siswa[nisn].nama, absen: r.absen,
        nilai: r.baris.map(function (b) { return b.aspek.peng.nilai; }),
        nilaiKet: r.baris.map(function (b) { return b.aspek.ket.nilai; }),
        rata: r.rekap.rata, lengkap: r.lengkap,
        belumTuntas: r.rekap.belumTuntas,
        alpaHari: r.presensi.A, hadir: r.presensi.persen,
        syarat: r.syaratKehadiran.terpenuhi
      });
    }
    rows.sort(function (a, b) { return a.absen - b.absen; });
    // Ranking is on the mean, ties share a place. Schools care about this and
    // "1,2,2,4" versus "1,2,2,3" is an argument you only have once. A rapor
    // that is not yet complete carries no rank at all rather than a provisional
    // one that will move.
    var byRata = rows.filter(function (r) { return r.rata !== null; })
      .slice().sort(function (a, b) { return b.rata - a.rata; });
    var rank = 0, prev = null, seen = 0;
    for (i = 0; i < byRata.length; i++) {
      seen++;
      if (byRata[i].rata !== prev) { rank = seen; prev = byRata[i].rata; }
      byRata[i].peringkat = rank;
    }
    return rows;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
