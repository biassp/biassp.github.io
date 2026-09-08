/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — akademik.js
 * Composes the derived dataset with whatever a teacher has actually edited,
 * and assembles the rapor. Pure: takes the school, the override map and the
 * config, returns a value. No DOM, no database, no clock — which is what lets
 * the assertion suite run it twice and demand byte-identical output.
 *
 * The key ordering rule: EVERY lookup here is keyed by
 *   (tahun ajaran, semester, NISN, mapel)
 * in that order. A read that forgets the year silently returns this year's
 * marks for last year's rapor, which is the defect that makes a school
 * distrust the whole system.
 */
(function (root) {
  'use strict';

  var D = root.SIAKAD_DOMAIN;
  var S = root.SIAKAD_DATA;
  var A = {};
  root.SIAKAD_AKADEMIK = A;

  A.nilaiKey = function (ta, sem, nisn, mapelId) { return ta + '|' + sem + '|' + nisn + '|' + mapelId; };
  A.presensiKey = function (ta, sem, nisn, mapelId, n) { return ta + '|' + sem + '|' + nisn + '|' + mapelId + '|' + n; };

  /* Derived marks, with any saved edit laid on top per component. An edit to
   * PTS must not silently reset the other three, so overrides are merged
   * field-by-field rather than replacing the row. */
  A.nilaiEfektif = function (overrides, nisn, mapelId, ta, sem) {
    var base = S.nilaiMapel(nisn, mapelId, ta, sem);
    var ov = overrides && overrides[A.nilaiKey(ta, sem, nisn, mapelId)];
    if (!ov) return { nilai: base, diubah: {}, adaEdit: false };
    var out = {}, diubah = {}, adaEdit = false;
    for (var i = 0; i < D.KOMPONEN.length; i++) {
      var k = D.KOMPONEN[i].id;
      if (ov.nilai && ov.nilai[k] !== undefined && ov.nilai[k] !== null && ov.nilai[k] !== '') {
        out[k] = D.clamp(Number(ov.nilai[k]), 0, 100);
        diubah[k] = true; adaEdit = true;
      } else out[k] = base[k];
    }
    return { nilai: out, diubah: diubah, adaEdit: adaEdit, oleh: ov.oleh, pada: ov.pada };
  };

  A.presensiEfektif = function (overrides, nisn, mapel, ta, sem) {
    var n = S.pertemuanPerSemester(mapel), out = [];
    for (var i = 1; i <= n; i++) {
      var ov = overrides && overrides[A.presensiKey(ta, sem, nisn, mapel.id, i)];
      out.push({ n: i, status: ov ? ov.status : S.presensiSesi(nisn, mapel.id, ta, sem, i), diubah: !!ov });
    }
    return out;
  };

  /* ------------------------------------------------------------- rapor -- */

  A.hitungRapor = function (ctx, nisn, ta, sem) {
    var school = ctx.school, konfig = ctx.konfig || {};
    var siswa = school.siswa[nisn];
    if (!siswa) return { ok: false, alasan: 'NISN tidak dikenal.' };
    var enrol = siswa.enrol[ta];
    // The whole point of scoping: a child who was not enrolled that year has
    // no rapor for that year. Not an empty one — none.
    if (!enrol) {
      return {
        ok: false,
        alasan: siswa.nama + ' tidak terdaftar pada tahun ajaran ' + ta +
          (siswa.angkatan > D.parseTahunAjaran(ta).start
            ? ' (angkatan ' + siswa.angkatan + ', saat itu belum masuk SMP ini).'
            : ' (angkatan ' + siswa.angkatan + ', sudah lulus/keluar).')
      };
    }

    var baris = [], rollups = [];
    var totalNilai = 0, jumlahTuntas = 0;
    for (var i = 0; i < school.mapel.length; i++) {
      var m = school.mapel[i];
      var bobot = (konfig.bobot && konfig.bobot[m.id]) || school.bobot[m.id];
      var kkm = (konfig.kkm && konfig.kkm[m.id] !== undefined) ? konfig.kkm[m.id] : school.kkm[m.id];
      var eff = A.nilaiEfektif(ctx.nilaiOverrides, nisn, m.id, ta, sem);
      var hasil = D.hitungNilaiAkhir(eff.nilai, bobot, kkm);
      var rec = A.presensiEfektif(ctx.presensiOverrides, nisn, m, ta, sem);
      var roll = D.rollupPresensi(rec);
      rollups.push(roll);
      var guruId = school.pengampu[ta + '|' + enrol.rombelNama + '|' + m.id];
      baris.push({
        mapel: m, bobot: bobot, kkm: kkm, komponen: eff.nilai, diubah: eff.diubah,
        adaEdit: eff.adaEdit, oleh: eff.oleh,
        hasil: hasil, presensi: roll, guruId: guruId
      });
      if (hasil.ok) { totalNilai += hasil.nilai; if (hasil.tuntas) jumlahTuntas++; }
    }

    var presensiSemester = D.mergeRollups(rollups);
    var rata = baris.length ? D.round2(totalNilai / baris.length) : 0;

    return {
      ok: true,
      siswa: siswa, ta: ta, semester: sem, enrol: enrol,
      rombelNama: enrol.rombelNama, tingkat: enrol.tingkat, absen: enrol.absen,
      baris: baris,
      rekap: {
        rata: rata,
        tuntas: jumlahTuntas,
        belumTuntas: baris.length - jumlahTuntas,
        mapelCount: baris.length
      },
      presensi: presensiSemester,
      // The eligibility rule, stated rather than hidden: below 75% presence the
      // rapor carries a flag and the school decides. The app never quietly
      // fails a child.
      syaratKehadiran: {
        minimal: D.MIN_KEHADIRAN,
        persen: presensiSemester.persen,
        terpenuhi: presensiSemester.memenuhiSyarat
      }
    };
  };

  /* Canonical serialisation of a rapor, used by the determinism assertion.
   * Object key order in JS is insertion order, which is exactly the thing a
   * "recompute produced the same numbers" check must not depend on. */
  A.canonicalRapor = function (r) {
    if (!r || !r.ok) return JSON.stringify({ ok: false, alasan: r && r.alasan });
    var rows = r.baris.map(function (b) {
      return [b.mapel.id, b.kkm, b.hasil.nilai, b.hasil.predikat, b.hasil.tuntas ? 1 : 0,
        b.presensi.H, b.presensi.S, b.presensi.I, b.presensi.A,
      b.hasil.rincian.map(function (x) { return x.id + ':' + x.nilai + '@' + x.bobot + '=' + x.kontribusi; }).join(',')].join('/');
    });
    rows.sort();
    return JSON.stringify({
      nisn: r.siswa.nisn, ta: r.ta, sem: r.semester, rombel: r.rombelNama,
      rata: r.rekap.rata, tuntas: r.rekap.tuntas, hadir: r.presensi.persen, rows: rows
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
        nilai: r.baris.map(function (b) { return b.hasil.nilai; }),
        rata: r.rekap.rata, belumTuntas: r.rekap.belumTuntas,
        hadir: r.presensi.persen, syarat: r.syaratKehadiran.terpenuhi
      });
    }
    rows.sort(function (a, b) { return a.absen - b.absen; });
    // Ranking is on the mean, ties share a place. Schools care about this and
    // "1,2,2,4" versus "1,2,2,3" is an argument you only have once.
    var byRata = rows.slice().sort(function (a, b) { return b.rata - a.rata; });
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
