/*!
 * SIAKAD — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* SIAKAD — solver.js
 * Timetable construction as a constraint satisfaction problem.
 *
 * A VARIABLE is one lesson block: "kelas 8B has a 3-JP Bahasa Indonesia lesson
 * taught by G07 that must happen somewhere this week". Its VALUE is a
 * (day, starting slot, room) triple. The whole week for eight rombel is ~136
 * variables with 20-60 candidate values each.
 *
 * HARD constraints — a solution containing any of these is not a solution:
 *   H1 a teacher is in one place at a time
 *   H2 a rombel is in one place at a time
 *   H3 a room hosts one rombel at a time
 *   H4 a teacher's declared unavailable slots are respected
 *   H5 the weekly JP of every subject is met EXACTLY
 *   H6 a block never straddles istirahat and never runs past the last slot
 *   H7 a lesson that needs a special room gets one of that type
 * H5 is satisfied by construction: the variables ARE the required blocks, and
 * every variable is assigned exactly once, so the week cannot come out short
 * or long. It is still re-checked in verify(), because "guaranteed by
 * construction" is exactly the kind of claim that quietly stops being true.
 *
 * SOFT constraints are scored, not enforced: teacher gaps, heavy subjects in
 * the last slot of the day, daily load over a teacher's declared maximum, two
 * lessons of one subject stacked on one day, PJOK in the midday heat.
 *
 * ALGORITHM: backtracking with forward checking; variable ordering is dom/wdeg
 * (domain size divided by an accumulated conflict weight, so the variables that
 * have actually been causing dead ends get tried first); value ordering is by
 * soft cost plus a segment-packing hint; restarts are frequent and the conflict
 * weights are carried ACROSS them, which is what turns a restart into learning
 * rather than a re-roll; and a bounded min-conflicts hill-climb afterwards that
 * only ever moves through hard-feasible states.
 *
 * Deliberately dependency-free and DOM-free: the page loads it with <script>
 * and the Worker loads the same file with importScripts().
 */
(function (root) {
  'use strict';

  var SV = {};
  root.SIAKAD_SOLVER = SV;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  SV.WEIGHTS = {
    gapGuru: 3,        // per empty JP between a teacher's first and last lesson of a day
    beratAkhir: 4,     // per heavy-subject lesson touching the last slot of the day
    bebanHarian: 5,    // per JP over a teacher's declared maximum for one day
    mapelMenumpuk: 6,  // per extra lesson of the same subject for one rombel in one day
    pjokSiang: 2       // per PJOK lesson starting after the second break
  };

  /* --------------------------------------------------------------- helpers */

  function segmentsOf(hari) {
    var segs = [], start = 1;
    for (var s = 1; s <= hari.slots; s++) {
      if ((hari.breakAfter || []).indexOf(s) >= 0 || s === hari.slots) {
        segs.push({ from: start, to: s });
        start = s + 1;
      }
    }
    return segs;
  }
  SV.segmentsOf = segmentsOf;

  // Does [slot, slot+len-1] sit inside one uninterrupted segment of this day?
  function blockFits(hari, slot, len) {
    var segs = segmentsOf(hari);
    for (var i = 0; i < segs.length; i++) {
      if (slot >= segs[i].from && slot + len - 1 <= segs[i].to) return true;
    }
    return false;
  }
  SV.blockFits = blockFits;

  /* ------------------------------------------------------------- instance */

  /* Turns the school spec into flat arrays, integer ids and precomputed value
   * lists. Everything the search touches in its inner loop is a typed array. */
  SV.compile = function (spec) {
    var i, j, k;
    var hari = spec.hari, nDays = hari.length;
    var maxSlots = 0;
    for (i = 0; i < nDays; i++) maxSlots = Math.max(maxSlots, hari[i].slots);
    var cellCount = nDays * maxSlots;

    var ruangIdx = {}, ruangById = {};
    for (i = 0; i < spec.ruang.length; i++) { ruangIdx[spec.ruang[i].id] = i; ruangById[spec.ruang[i].id] = spec.ruang[i]; }
    var guruIdx = {}, guruById = {};
    for (i = 0; i < spec.guru.length; i++) { guruIdx[spec.guru[i].id] = i; guruById[spec.guru[i].id] = spec.guru[i]; }
    var mapelById = {};
    for (i = 0; i < spec.mapel.length; i++) mapelById[spec.mapel[i].id] = spec.mapel[i];

    var rombelIds = [], rombelIdx = {};
    for (i = 0; i < spec.sesi.length; i++) {
      var rid = spec.sesi[i].rombelId;
      if (rombelIdx[rid] === undefined) { rombelIdx[rid] = rombelIds.length; rombelIds.push(rid); }
    }

    // Teacher unavailability as a bitmap per teacher.
    var guruBlok = [];
    for (i = 0; i < spec.guru.length; i++) {
      var arr = new Uint8Array(cellCount);
      var un = spec.guru[i].tidakTersedia || [];
      for (j = 0; j < un.length; j++) {
        var c = un[j].hari * maxSlots + (un[j].slot - 1);
        if (c >= 0 && c < cellCount) arr[c] = 1;
      }
      guruBlok.push(arr);
    }

    // Rooms available to each session.
    function roomsFor(sesi) {
      if (!sesi.ruangTipe) return [sesi.homeRuangId];
      var out = [];
      for (var q = 0; q < spec.ruang.length; q++) if (spec.ruang[q].tipe === sesi.ruangTipe) out.push(spec.ruang[q].id);
      return out;
    }

    /* Validate the instance BEFORE building domains. A session naming a teacher
     * or a home room that does not exist is a DATA error, and it has to surface
     * as one: dereferencing guruBlok[undefined] throws a TypeError that the
     * main-thread fallback path cannot render, and an unknown homeRuangId is
     * worse still — the board writes land on NaN indices, are silently dropped,
     * and the run only fails at the very end in verify(), where a data problem
     * gets reported to the user as "this is a solver bug". */
    var cacat = [];
    for (i = 0; i < spec.sesi.length; i++) {
      var sv = spec.sesi[i];
      if (guruIdx[sv.guruId] === undefined) {
        cacat.push('sesi ' + sv.id + ' menunjuk guru "' + sv.guruId + '" yang tidak ada dalam daftar guru');
      }
      if (ruangIdx[sv.homeRuangId] === undefined) {
        cacat.push('sesi ' + sv.id + ' menunjuk ruang kelas "' + sv.homeRuangId + '" yang tidak ada dalam daftar ruang');
      }
      if (sv.ruangTipe) {
        var ada = false;
        for (j = 0; j < spec.ruang.length; j++) if (spec.ruang[j].tipe === sv.ruangTipe) { ada = true; break; }
        if (!ada) cacat.push('sesi ' + sv.id + ' membutuhkan ruang bertipe "' + sv.ruangTipe + '" dan sekolah tidak punya satu pun');
      }
      if (!(sv.len > 0)) cacat.push('sesi ' + sv.id + ' punya panjang blok tidak sah (' + sv.len + ')');
    }
    if (cacat.length) {
      return {
        cacat: cacat,
        spec: spec, hari: hari, nDays: nDays, maxSlots: maxSlots, cellCount: cellCount,
        nVars: spec.sesi.length, values: [], varInfo: []
      };
    }

    var nVars = spec.sesi.length;
    var values = [], varInfo = [];
    for (i = 0; i < nVars; i++) {
      var se = spec.sesi[i];
      var mp = mapelById[se.mapelId] || {};
      var gI = guruIdx[se.guruId];
      var rooms = roomsFor(se);
      var vals = [];
      var rejected = { istirahat: 0, guru: 0, ruang: rooms.length === 0 ? 1 : 0 };
      for (var d = 0; d < nDays; d++) {
        for (var s = 1; s + se.len - 1 <= hari[d].slots; s++) {
          if (!blockFits(hari[d], s, se.len)) { rejected.istirahat++; continue; }
          var guruOk = true;
          for (k = 0; k < se.len; k++) {
            if (guruBlok[gI][d * maxSlots + (s + k - 1)]) { guruOk = false; break; }
          }
          if (!guruOk) { rejected.guru++; continue; }
          for (var r = 0; r < rooms.length; r++) {
            vals.push({ hari: d, slot: s, ruangId: rooms[r], ruangI: ruangIdx[rooms[r]] });
          }
        }
      }
      values.push(vals);
      varInfo.push({
        sesi: se, mapel: mp, guruI: gI, rombelI: rombelIdx[se.rombelId],
        rooms: rooms, rejected: rejected,
        // Static per-value soft cost, used to order values. Dynamic terms are
        // added during search.
        statik: vals.map(function (v) {
          var cost = 0;
          if (mp.berat && v.slot + se.len - 1 >= hari[v.hari].slots) cost += SV.WEIGHTS.beratAkhir;
          if (se.mapelId === 'pjok' && v.slot > ((hari[v.hari].breakAfter || [0, 0])[1] || 7)) cost += SV.WEIGHTS.pjokSiang;
          // Packing hint, not a soft constraint: prefer placements flush with a
          // segment edge. A 2-JP block dropped in the middle of a 4-JP segment
          // leaves two 1-JP holes that no other block can use, and the search
          // then burns its whole budget discovering that one rombel at a time.
          var segs = segmentsOf(hari[v.hari]);
          for (var q2 = 0; q2 < segs.length; q2++) {
            if (v.slot >= segs[q2].from && v.slot + se.len - 1 <= segs[q2].to) {
              if (v.slot !== segs[q2].from && v.slot + se.len - 1 !== segs[q2].to) cost += 1.4;
              break;
            }
          }
          return cost;
        })
      });
    }

    return {
      spec: spec, hari: hari, nDays: nDays, maxSlots: maxSlots, cellCount: cellCount,
      nVars: nVars, values: values, varInfo: varInfo,
      ruangIdx: ruangIdx, ruangById: ruangById, guruIdx: guruIdx, guruById: guruById,
      mapelById: mapelById, rombelIds: rombelIds, rombelIdx: rombelIdx,
      nRuang: spec.ruang.length, nGuru: spec.guru.length, nRombel: rombelIds.length,
      guruBlok: guruBlok
    };
  };

  /* ------------------------------------------------------------ occupancy */

  function makeBoard(C) {
    return {
      rombel: new Int32Array(C.nRombel * C.cellCount),
      guru: new Int32Array(C.nGuru * C.cellCount),
      ruang: new Int32Array(C.nRuang * C.cellCount)
    };
  }
  function clearBoard(b) { b.rombel.fill(0); b.guru.fill(0); b.ruang.fill(0); }

  // 0 means free; otherwise variable index + 1.
  function place(C, board, v, val, sign) {
    var vi = C.varInfo[v], len = vi.sesi.len, base = val.hari * C.maxSlots + val.slot - 1;
    var tag = sign > 0 ? (v + 1) : 0;
    for (var k = 0; k < len; k++) {
      board.rombel[vi.rombelI * C.cellCount + base + k] = tag;
      board.guru[vi.guruI * C.cellCount + base + k] = tag;
      board.ruang[val.ruangI * C.cellCount + base + k] = tag;
    }
  }

  // Returns 0 if the value fits, else a code: 1 rombel, 2 guru, 3 ruang.
  function conflictCode(C, board, v, val) {
    var vi = C.varInfo[v], len = vi.sesi.len, base = val.hari * C.maxSlots + val.slot - 1;
    for (var k = 0; k < len; k++) {
      if (board.rombel[vi.rombelI * C.cellCount + base + k]) return 1;
      if (board.guru[vi.guruI * C.cellCount + base + k]) return 2;
      if (board.ruang[val.ruangI * C.cellCount + base + k]) return 3;
    }
    return 0;
  }

  /* ----------------------------------------------------------- neighbours */

  function buildNeighbours(C) {
    var n = C.nVars, nb = [];
    for (var i = 0; i < n; i++) nb.push([]);
    for (i = 0; i < n; i++) {
      var a = C.varInfo[i];
      for (var j = i + 1; j < n; j++) {
        var b = C.varInfo[j];
        var share = (a.rombelI === b.rombelI) || (a.guruI === b.guruI);
        if (!share) {
          for (var r = 0; r < a.rooms.length && !share; r++) {
            if (b.rooms.indexOf(a.rooms[r]) >= 0) share = true;
          }
        }
        if (share) { nb[i].push(j); nb[j].push(i); }
      }
    }
    return nb;
  }

  /* ---------------------------------------------------------- soft score */

  SV.softScore = function (spec, assign) {
    var C = spec.__compiled || (spec.__compiled = SV.compile(spec));
    return softScoreCompiled(C, assign);
  };

  function softScoreCompiled(C, assign) {
    var W = SV.WEIGHTS;
    var i, d, s, g;
    var breakdown = { gapGuru: 0, beratAkhir: 0, bebanHarian: 0, mapelMenumpuk: 0, pjokSiang: 0 };
    var detail = [];

    // Per teacher per day: which slots are taught.
    var taught = [];
    for (g = 0; g < C.nGuru; g++) {
      taught.push([]);
      for (d = 0; d < C.nDays; d++) taught[g].push([]);
    }
    var perRombelMapelDay = {};

    for (i = 0; i < C.nVars; i++) {
      var val = assign[C.varInfo[i].sesi.id];
      if (!val) continue;
      var vi = C.varInfo[i];
      for (var k = 0; k < vi.sesi.len; k++) taught[vi.guruI][val.hari].push(val.slot + k);
      var key = vi.rombelI + '|' + vi.sesi.mapelId + '|' + val.hari;
      perRombelMapelDay[key] = (perRombelMapelDay[key] || 0) + 1;

      if (vi.mapel.berat && val.slot + vi.sesi.len - 1 >= C.hari[val.hari].slots) {
        breakdown.beratAkhir += W.beratAkhir;
        detail.push({ jenis: 'beratAkhir', pesan: vi.mapel.kode + ' ' + vi.sesi.rombelNama + ' menempati jam terakhir ' + C.hari[val.hari].label, sesiId: vi.sesi.id });
      }
      var br2 = (C.hari[val.hari].breakAfter || [])[1];
      if (vi.sesi.mapelId === 'pjok' && br2 && val.slot > br2) {
        breakdown.pjokSiang += W.pjokSiang;
        detail.push({ jenis: 'pjokSiang', pesan: 'PJOK ' + vi.sesi.rombelNama + ' dijadwalkan setelah istirahat kedua ' + C.hari[val.hari].label, sesiId: vi.sesi.id });
      }
    }

    for (var key2 in perRombelMapelDay) {
      if (perRombelMapelDay[key2] > 1) {
        var extra = perRombelMapelDay[key2] - 1;
        breakdown.mapelMenumpuk += extra * W.mapelMenumpuk;
        var parts = key2.split('|');
        detail.push({ jenis: 'mapelMenumpuk', pesan: (C.mapelById[parts[1]] || {}).kode + ' untuk ' + C.rombelIds[+parts[0]].split('|')[1] + ' muncul ' + (extra + 1) + '× pada hari ' + C.hari[+parts[2]].label });
      }
    }

    for (g = 0; g < C.nGuru; g++) {
      for (d = 0; d < C.nDays; d++) {
        var list = taught[g][d];
        if (list.length === 0) continue;
        var min = Math.min.apply(null, list), max = Math.max.apply(null, list);
        var gap = (max - min + 1) - list.length;
        if (gap > 0) {
          breakdown.gapGuru += gap * W.gapGuru;
          detail.push({ jenis: 'gapGuru', pesan: C.spec.guru[g].nama + ' punya ' + gap + ' JP kosong pada ' + C.hari[d].label });
        }
        var maxH = C.spec.guru[g].maxJamHarian || 99;
        if (list.length > maxH) {
          var over = list.length - maxH;
          breakdown.bebanHarian += over * W.bebanHarian;
          detail.push({ jenis: 'bebanHarian', pesan: C.spec.guru[g].nama + ' mengajar ' + list.length + ' JP pada ' + C.hari[d].label + ', melebihi batas ' + maxH + ' JP' });
        }
      }
    }

    var total = 0;
    for (var kk in breakdown) total += breakdown[kk];
    return { total: total, breakdown: breakdown, detail: detail };
  }

  /* ------------------------------------------------ exhaustive verifier --
   * Independent of the search: it re-derives every occupied cell from the
   * assignment and looks for collisions pairwise. If the search and this ever
   * disagree, this one is right.
   */
  SV.verify = function (spec, assign) {
    var C = SV.compile(spec);
    var v = [], i, j, k;
    var cells = {};   // "kind:res:day:slot" -> sesiId
    var perRombelMapelJp = {};

    for (i = 0; i < spec.sesi.length; i++) {
      var se = spec.sesi[i];
      var val = assign[se.id];
      if (!val) { v.push({ jenis: 'H5', pesan: 'Sesi ' + se.id + ' (' + se.rombelNama + ' ' + se.mapelId + ') tidak terjadwal.' }); continue; }
      var hari = spec.hari[val.hari];
      if (!hari) { v.push({ jenis: 'H6', pesan: 'Sesi ' + se.id + ' berada pada hari yang tidak ada.' }); continue; }
      if (val.slot < 1 || val.slot + se.len - 1 > hari.slots) {
        v.push({ jenis: 'H6', pesan: 'Sesi ' + se.id + ' keluar dari jam belajar ' + hari.label + '.' });
      } else if (!blockFits(hari, val.slot, se.len)) {
        v.push({ jenis: 'H6', pesan: 'Sesi ' + se.id + ' (' + se.len + ' JP) melewati jam istirahat pada ' + hari.label + '.' });
      }
      var ruang = C.ruangById[val.ruangId];
      if (!ruang) v.push({ jenis: 'H7', pesan: 'Sesi ' + se.id + ' menunjuk ruang yang tidak ada.' });
      else if (se.ruangTipe && ruang.tipe !== se.ruangTipe) {
        v.push({ jenis: 'H7', pesan: 'Sesi ' + se.id + ' butuh ' + se.ruangTipe + ' tapi ditempatkan di ' + ruang.nama + '.' });
      } else if (!se.ruangTipe && val.ruangId !== se.homeRuangId) {
        v.push({ jenis: 'H7', pesan: 'Sesi ' + se.id + ' seharusnya di ruang kelas ' + se.homeRuangId + '.' });
      }

      var gu = C.guruById[se.guruId];
      for (k = 0; k < se.len; k++) {
        var slot = val.slot + k;
        var un = (gu && gu.tidakTersedia) || [];
        for (j = 0; j < un.length; j++) {
          if (un[j].hari === val.hari && un[j].slot === slot) {
            v.push({ jenis: 'H4', pesan: gu.nama + ' dijadwalkan pada slot yang dinyatakan tidak tersedia (' + hari.label + ' JP ' + slot + ').' });
          }
        }
        var trio = [
          ['H2', 'rombel', se.rombelId, se.rombelNama],
          ['H1', 'guru', se.guruId, (gu && gu.nama) || se.guruId],
          ['H3', 'ruang', val.ruangId, (ruang && ruang.nama) || val.ruangId]
        ];
        for (j = 0; j < trio.length; j++) {
          var ck = trio[j][1] + ':' + trio[j][2] + ':' + val.hari + ':' + slot;
          if (cells[ck]) {
            v.push({
              jenis: trio[j][0],
              pesan: trio[j][3] + ' bentrok pada ' + hari.label + ' JP ' + slot +
                ': ' + cells[ck] + ' vs ' + se.id + '.',
              a: cells[ck], b: se.id
            });
          } else cells[ck] = se.id;
        }
      }
      var pk = se.rombelId + '|' + se.mapelId;
      perRombelMapelJp[pk] = (perRombelMapelJp[pk] || 0) + se.len;
    }

    // H5: weekly hours met exactly.
    var wajib = spec.wajibJp || null;
    if (wajib) {
      for (var key in wajib) {
        var got = perRombelMapelJp[key] || 0;
        if (got !== wajib[key]) {
          v.push({ jenis: 'H5', pesan: 'Alokasi JP untuk ' + key + ' adalah ' + got + ', seharusnya ' + wajib[key] + '.' });
        }
      }
    }
    return { ok: v.length === 0, violations: v };
  };

  /* -------------------------------------------------------- manual move --
   * Used by drag-and-drop. Says which constraint breaks and for whom, because
   * "invalid" tells a kurikulum staffer nothing they can act on.
   */
  SV.validateMove = function (spec, assign, sesiId, hari, slot, ruangId) {
    var C = spec.__compiled || (spec.__compiled = SV.compile(spec));
    var idx = -1, i;
    for (i = 0; i < spec.sesi.length; i++) if (spec.sesi[i].id === sesiId) idx = i;
    if (idx < 0) return { ok: false, violations: [{ jenis: 'X', pesan: 'Sesi tidak dikenal.' }] };
    var se = spec.sesi[idx];
    var hd = spec.hari[hari];
    var out = [];
    if (!hd) return { ok: false, violations: [{ jenis: 'H6', pesan: 'Hari tidak ada.' }] };

    if (slot < 1 || slot + se.len - 1 > hd.slots) {
      out.push({ jenis: 'H6', pesan: 'Blok ' + se.len + ' JP tidak muat: ' + hd.label + ' hanya sampai JP ' + hd.slots + '.' });
    } else if (!blockFits(hd, slot, se.len)) {
      var segs = segmentsOf(hd).map(function (s) { return 'JP ' + s.from + '–' + s.to; }).join(', ');
      out.push({ jenis: 'H6', pesan: 'Blok ' + se.len + ' JP akan terpotong istirahat. Blok utuh pada ' + hd.label + ' hanya muat di ' + segs + '.' });
    }

    var ruang = C.ruangById[ruangId];
    if (!ruang) out.push({ jenis: 'H7', pesan: 'Ruang tidak dikenal.' });
    else if (se.ruangTipe && ruang.tipe !== se.ruangTipe) {
      out.push({ jenis: 'H7', pesan: se.mapelNama + ' menuntut ' + se.ruangTipe + '; ' + ruang.nama + ' bertipe ' + ruang.tipe + '.' });
    }

    var gu = C.guruById[se.guruId];
    var k, s2;
    for (k = 0; k < se.len; k++) {
      s2 = slot + k;
      var un = (gu && gu.tidakTersedia) || [];
      for (i = 0; i < un.length; i++) {
        if (un[i].hari === hari && un[i].slot === s2) {
          out.push({
            jenis: 'H4',
            pesan: gu.nama + ' menyatakan tidak tersedia pada ' + hd.label + ' JP ' + s2 +
              (gu.alasanTidakTersedia ? ' (' + gu.alasanTidakTersedia + ')' : '') + '.'
          });
        }
      }
    }

    // Collisions with everything else currently on the board.
    for (i = 0; i < spec.sesi.length; i++) {
      if (i === idx) continue;
      var other = spec.sesi[i], ov = assign[other.id];
      if (!ov || ov.hari !== hari) continue;
      var aFrom = slot, aTo = slot + se.len - 1;
      var bFrom = ov.slot, bTo = ov.slot + other.len - 1;
      if (aTo < bFrom || bTo < aFrom) continue;
      var overlapFrom = Math.max(aFrom, bFrom), overlapTo = Math.min(aTo, bTo);
      var where = hd.label + ' JP ' + overlapFrom + (overlapTo > overlapFrom ? '–' + overlapTo : '');
      if (other.rombelId === se.rombelId) {
        out.push({ jenis: 'H2', pesan: 'Rombel ' + se.rombelNama + ' sudah ada ' + other.mapelNama + ' pada ' + where + '. Satu rombel tidak bisa mengikuti dua mapel sekaligus.', lawan: other.id });
      }
      if (other.guruId === se.guruId) {
        out.push({ jenis: 'H1', pesan: (gu && gu.nama || se.guruId) + ' sudah mengajar ' + other.mapelNama + ' di ' + other.rombelNama + ' pada ' + where + '.', lawan: other.id });
      }
      if (ov.ruangId === ruangId) {
        out.push({ jenis: 'H3', pesan: (ruang && ruang.nama || ruangId) + ' sedang dipakai ' + other.rombelNama + ' (' + other.mapelNama + ') pada ' + where + '.', lawan: other.id });
      }
    }
    return { ok: out.length === 0, violations: out };
  };

  /* ============================================================== solve == */

  SV.solve = function (spec, opts) {
    opts = opts || {};
    var budgetMs = opts.budgetMs || 8000;
    var seed = opts.seed === undefined ? 12345 : opts.seed;
    var maxRestarts = opts.maxRestarts === undefined ? 300 : opts.maxRestarts;
    var optimiseMs = opts.optimiseMs === undefined ? 2500 : opts.optimiseMs;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    function now() { return ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0; }

    var C = SV.compile(spec);
    if (C.cacat) {
      return {
        ok: false, assign: null,
        stats: {
          variabel: C.nVars, nilaiKandidat: 0, node: 0, backtrack: 0, restart: 0,
          propagasiDibuang: 0, msTotal: 0, msCari: 0, msOptimasi: 0,
          langkahOptimasi: 0, softAwal: null, softAkhir: null, bobotKonflikMaks: 0
        },
        diagnosis: {
          tahap: 'pra-pencarian', sifat: 'terbukti',
          judul: 'Instance jadwal tidak sah — bukan masalah pencarian',
          pesan: C.cacat.slice(0, 4).join('; ') + (C.cacat.length > 4 ? ' (dan ' + (C.cacat.length - 4) + ' lainnya)' : '') + '.',
          buktiKuat: 'Ini cacat data, bukan infeasibilitas jadwal: solver tidak dijalankan sama sekali karena spesifikasinya merujuk entitas yang tidak ada.',
          saran: 'Perbaiki pemetaan pengampu atau daftar ruang pada data induk, lalu susun ulang.'
        }
      };
    }
    var n = C.nVars;
    var stats = {
      variabel: n, nilaiKandidat: 0, node: 0, backtrack: 0, restart: 0,
      propagasiDibuang: 0, msTotal: 0, msCari: 0, msOptimasi: 0,
      langkahOptimasi: 0, softAwal: null, softAkhir: null, bobotKonflikMaks: 0
    };
    for (var i = 0; i < n; i++) stats.nilaiKandidat += C.values[i].length;

    /* Static infeasibility. Reported before any search, with the reason,
     * because "no solution found after 3 seconds" and "this teacher declared
     * himself unavailable for every slot a 3-JP block could occupy" are
     * completely different messages to a human. */
    for (i = 0; i < n; i++) {
      if (C.values[i].length === 0) {
        var vi = C.varInfo[i];
        var why = [];
        if (vi.rejected.guru) why.push(vi.rejected.guru + ' penempatan gugur karena ' + (C.guruById[vi.sesi.guruId] || {}).nama + ' menyatakan tidak tersedia');
        if (vi.rejected.istirahat) why.push(vi.rejected.istirahat + ' penempatan gugur karena blok ' + vi.sesi.len + ' JP terpotong istirahat');
        if (vi.rejected.ruang) why.push('tidak ada ruang bertipe ' + vi.sesi.ruangTipe);
        stats.msTotal = Math.round(now() * 100) / 100;
        return {
          ok: false, assign: null, stats: stats,
          diagnosis: {
            tahap: 'pra-pencarian',
            // Provable: this variable has an empty domain before any decision is
            // taken, so NO assignment of the other 135 could rescue it.
            sifat: 'terbukti',
            sesiId: vi.sesi.id,
            judul: 'Tidak ada satu pun penempatan yang sah untuk ' + vi.mapel.kode + ' ' + vi.sesi.rombelNama,
            pesan: 'Sesi ' + vi.sesi.len + ' JP ini tidak punya kandidat slot sama sekali sebelum penjadwalan dimulai: ' + why.join('; ') + '.',
            buktiKuat: 'Ini infeasibilitas yang TERBUKTI: domain sesi ini kosong tanpa satu pun keputusan diambil, jadi tidak ada penempatan sesi lain yang bisa menolongnya.',
            saran: 'Longgarkan ketidaksediaan guru pengampu, pecah blok menjadi lebih pendek, atau tambah slot pada kalender.'
          }
        };
      }
    }

    var neighbours = buildNeighbours(C);
    var board = makeBoard(C);
    var assignIdx = new Int32Array(n);
    var alive = [], aliveCount = new Int32Array(n), order = [];
    for (i = 0; i < n; i++) alive.push(new Uint8Array(C.values[i].length));

    var best = null, diagnosis = null, deepest = -1, tuntas = false;
    var rnd = mulberry32(seed);
    /* Conflict weights, the dom/wdeg part. Every time forward checking wipes a
     * domain, both the variable that lost its options and the one that took the
     * decision get heavier, and heavier variables are tried EARLIER on the next
     * attempt. The weights survive restarts on purpose: that is the whole
     * mechanism — a plain restart just re-rolls the dice, a restart that keeps
     * what it learned attacks the part of the instance that is actually tight. */
    var wdeg = new Float64Array(n);
    for (i = 0; i < n; i++) wdeg[i] = 1;

    for (var attempt = 0; attempt <= maxRestarts; attempt++) {
      if (attempt > 0) { stats.restart++; rnd = mulberry32(seed + attempt * 7919); }
      clearBoard(board);
      for (i = 0; i < n; i++) { alive[i].fill(1); aliveCount[i] = C.values[i].length; assignIdx[i] = -1; }
      // Jitter breaks ties between equally good values so a restart explores a
      // genuinely different part of the space instead of repeating itself.
      var jitter = [];
      // Attempt 0 is nearly greedy (tiny jitter) because on an easy instance the
      // heuristics alone find a schedule with no backtracking at all. Later
      // attempts randomise harder so a restart genuinely leaves the region the
      // previous one got stuck in.
      var amp = attempt === 0 ? 0.4 : Math.min(9, 1.5 + attempt * 0.8);
      for (i = 0; i < n; i++) {
        var row = new Float64Array(C.values[i].length);
        for (var q = 0; q < row.length; q++) row[q] = rnd() * amp;
        jitter.push(row);
      }
      var btBudget = attempt === 0 ? 3000 : (1500 + attempt * 400);
      /* The budget is PER ATTEMPT, so it has to be compared against an absolute
       * ceiling derived from where this attempt started — `stats.backtrack` is
       * the lifetime counter and is never reset. Passing the raw per-attempt
       * number made every restart after the fifth abort at ~400 backtracks
       * regardless of its nominal budget, capped total search effort at ~121k
       * instead of the ~18M the schedule implies, left the 8-second time budget
       * unreachable (~0.7 s was ever used), and reported a solvable shipped
       * scenario as unsolvable about 1% of the time. */
      var res = search(0, stats.backtrack + btBudget, jitter);
      if (res === true) {
        var assign = {};
        for (i = 0; i < n; i++) assign[C.varInfo[i].sesi.id] = C.values[i][assignIdx[i]];
        best = assign;
        break;
      }
      /* A clean `false` is not the same answer as 'budget' or 'timeout'. It
       * means the attempt walked the WHOLE tree without ever hitting its
       * ceiling: value ordering only reorders candidates and forward checking
       * only removes values that provably conflict, so nothing was skipped and
       * the space is genuinely exhausted. That is a proof of infeasibility, and
       * restarting to re-prove it 300 more times before reporting "not proven
       * impossible" is both slow and wrong. */
      if (res === false) { tuntas = true; break; }
      if (now() > budgetMs) break;
    }

    stats.msCari = Math.round(now());
    stats.pencarianTuntas = tuntas;

    if (!best) {
      stats.msTotal = Math.round(now());
      if (tuntas) {
        return {
          ok: false, assign: null, stats: stats,
          diagnosis: {
            tahap: 'pencarian-tuntas',
            sifat: 'terbukti',
            judul: 'Tidak ada jadwal yang memenuhi seluruh kendala keras',
            pesan: 'Pencarian menelusuri seluruh ruang solusi sampai habis dalam ' + stats.backtrack +
              ' backtrack dan ' + Math.round(now()) + ' ms — bukan berhenti karena anggaran, melainkan karena tidak ada cabang tersisa.',
            buktiKuat: 'Ini infeasibilitas yang TERBUKTI. Pengurutan nilai hanya mengubah urutan pencobaan dan forward checking hanya membuang nilai yang pasti bentrok, jadi tidak ada kandidat yang terlewat: seluruh pohon sudah dienumerasi dan tidak satu pun daun yang sah.',
            saran: 'Kendalanya harus dilonggarkan, bukan dicari lebih lama: kurangi ketidaksediaan guru, tambah ruang khusus, pecah blok yang panjang, atau tambah slot pada kalender.'
          }
        };
      }
      return {
        ok: false, assign: null, stats: stats,
        diagnosis: diagnosis
          ? mergeBudget(diagnosis)
          : {
            tahap: 'pencarian', sifat: 'tidak-terbukti',
            judul: 'Pencarian kehabisan anggaran',
            pesan: 'Backtracking tidak menemukan jadwal bebas bentrok dalam ' + stats.backtrack + ' backtrack, ' + stats.restart + ' restart dan ' + Math.round(now()) + ' ms.',
            buktiKuat: 'Ini BUKAN bukti bahwa jadwal mustahil — hanya bahwa pencarian ini tidak menemukannya dalam anggaran yang diberikan.',
            saran: 'Naikkan anggaran waktu, kurangi ketidaksediaan guru, atau tambah ruang khusus.'
          }
      };
    }

    /* ---- soft optimisation: min-conflicts hill-climb over feasible states ---- */
    var soft = softScoreCompiled(C, best);
    stats.softAwal = soft.total;
    var tOpt = now();
    if (optimiseMs > 0) {
      // The board still holds the solution, so a move is: lift the block,
      // try every alternative that is hard-feasible, keep the cheapest.
      var improved = true;
      while (improved && now() - tOpt < optimiseMs) {
        improved = false;
        var seq = [];
        for (i = 0; i < n; i++) seq.push(i);
        for (i = seq.length - 1; i > 0; i--) { var j2 = Math.floor(rnd() * (i + 1)); var tmp = seq[i]; seq[i] = seq[j2]; seq[j2] = tmp; }
        for (var si = 0; si < seq.length; si++) {
          if (now() - tOpt > optimiseMs) break;
          var v = seq[si];
          var cur = assignIdx[v];
          place(C, board, v, C.values[v][cur], -1);
          var bestIdx = cur, bestScore = soft.total;
          for (var vi2 = 0; vi2 < C.values[v].length; vi2++) {
            if (vi2 === cur) continue;
            if (conflictCode(C, board, v, C.values[v][vi2]) !== 0) continue;
            var prev = best[C.varInfo[v].sesi.id];
            best[C.varInfo[v].sesi.id] = C.values[v][vi2];
            var sc = softScoreCompiled(C, best).total;
            best[C.varInfo[v].sesi.id] = prev;
            if (sc < bestScore) { bestScore = sc; bestIdx = vi2; }
          }
          assignIdx[v] = bestIdx;
          best[C.varInfo[v].sesi.id] = C.values[v][bestIdx];
          place(C, board, v, C.values[v][bestIdx], 1);
          if (bestIdx !== cur) { improved = true; stats.langkahOptimasi++; soft = softScoreCompiled(C, best); }
        }
      }
    }
    stats.msOptimasi = Math.round(now() - tOpt);
    soft = softScoreCompiled(C, best);
    stats.softAkhir = soft.total;
    stats.msTotal = Math.round(now());

    // Never hand back a schedule we have not re-checked from scratch.
    var check = SV.verify(spec, best);
    if (!check.ok) {
      return {
        ok: false, assign: null, stats: stats,
        diagnosis: {
          tahap: 'verifikasi', judul: 'Solver menghasilkan jadwal yang gagal verifikasi',
          pesan: check.violations.slice(0, 5).map(function (x) { return x.pesan; }).join(' '),
          saran: 'Ini adalah bug solver, bukan masalah data. Jadwal tidak dipakai.'
        }
      };
    }

    return { ok: true, assign: best, stats: stats, soft: soft, diagnosis: null };

    function mergeBudget(d) {
      var copy = {};
      for (var kx in d) copy[kx] = d[kx];
      copy.anggaran = 'Pencarian berhenti setelah ' + stats.backtrack + ' backtrack, ' +
        stats.restart + ' restart dan ' + Math.round(now()) + ' ms.';
      return copy;
    }

    /* ---------------------------------------------------------- search -- */

    /* dom/wdeg: pick the variable with the smallest (remaining values / conflict
     * weight). With every weight at 1 this is plain MRV; as the search learns
     * which variables keep failing, they float to the front. Ties break on the
     * block LENGTH — a 3-JP block is strictly harder to place than a 1-JP one —
     * and then on degree. */
    function selectVar() {
      var bestV = -1, bestScore = Infinity, bestLen = -1, bestDeg = -1;
      for (var a = 0; a < n; a++) {
        if (assignIdx[a] >= 0) continue;
        var sc2 = aliveCount[a] / wdeg[a];
        var ln = C.varInfo[a].sesi.len, dg = neighbours[a].length;
        if (sc2 < bestScore - 1e-9 ||
          (Math.abs(sc2 - bestScore) <= 1e-9 && ln > bestLen) ||
          (Math.abs(sc2 - bestScore) <= 1e-9 && ln === bestLen && dg > bestDeg)) {
          bestScore = sc2; bestV = a; bestLen = ln; bestDeg = dg;
        }
      }
      return bestV;
    }

    function orderValues(v, jitter) {
      var vi3 = C.varInfo[v];
      var list = [];
      for (var a = 0; a < C.values[v].length; a++) {
        if (!alive[v][a]) continue;
        var val = C.values[v][a];
        var c = vi3.statik[a] + jitter[v][a];
        // Same subject already placed for this rombel today: cheap lookup on
        // the rombel board rather than a full rescore.
        var base = val.hari * C.maxSlots;
        for (var s3 = 0; s3 < C.hari[val.hari].slots; s3++) {
          var occ = board.rombel[vi3.rombelI * C.cellCount + base + s3];
          if (occ && C.varInfo[occ - 1].sesi.mapelId === vi3.sesi.mapelId) { c += SV.WEIGHTS.mapelMenumpuk; break; }
        }
        // Adjacency to the teacher's existing lessons that day reduces gaps.
        var adj = false;
        if (val.slot > 1 && board.guru[vi3.guruI * C.cellCount + base + val.slot - 2]) adj = true;
        if (val.slot + vi3.sesi.len - 1 < C.hari[val.hari].slots &&
          board.guru[vi3.guruI * C.cellCount + base + val.slot + vi3.sesi.len - 1]) adj = true;
        if (adj) c -= 1.5;
        list.push({ i: a, c: c });
      }
      list.sort(function (x, y) { return x.c - y.c; });
      return list;
    }

    function search(depth, btBudget, jitter) {
      if (depth === n) return true;
      if (stats.node % 512 === 0 && now() > budgetMs) return 'timeout';
      stats.node++;

      var v = selectVar();
      if (v < 0) return true;
      var cands = orderValues(v, jitter);

      for (var ci = 0; ci < cands.length; ci++) {
        var a = cands[ci].i;
        var val = C.values[v][a];
        if (conflictCode(C, board, v, val) !== 0) continue;

        assignIdx[v] = a;
        place(C, board, v, val, 1);
        var trail = [];
        var wipe = forwardCheck(v, trail);
        if (wipe < 0) {
          var r = search(depth + 1, btBudget, jitter);
          if (r === true) return true;
          if (r === 'timeout') { undo(trail); place(C, board, v, val, -1); assignIdx[v] = -1; return 'timeout'; }
        } else {
          // Blame both ends of the conflict, then remember it past the restart.
          wdeg[wipe] += 1;
          wdeg[v] += 1;
          if (wdeg[wipe] > stats.bobotKonflikMaks) stats.bobotKonflikMaks = Math.round(wdeg[wipe]);
          if (depth > deepest) {
            deepest = depth;
            diagnosis = explain(wipe, v, val, depth);
          }
        }
        undo(trail);
        place(C, board, v, val, -1);
        assignIdx[v] = -1;
        stats.backtrack++;
        if (stats.backtrack > btBudget) return 'budget';
      }
      return false;
    }

    // Returns -1 on success, or the index of the variable whose domain emptied.
    function forwardCheck(v, trail) {
      var nb = neighbours[v];
      for (var i2 = 0; i2 < nb.length; i2++) {
        var w = nb[i2];
        if (assignIdx[w] >= 0) continue;
        var removedAny = false;
        for (var a2 = 0; a2 < C.values[w].length; a2++) {
          if (!alive[w][a2]) continue;
          if (conflictCode(C, board, w, C.values[w][a2]) !== 0) {
            alive[w][a2] = 0; aliveCount[w]--; trail.push(w, a2); removedAny = true;
            stats.propagasiDibuang++;
          }
        }
        if (aliveCount[w] === 0) return w;
        if (removedAny && aliveCount[w] === 1) { /* singleton: MRV will pick it next */ }
      }
      return -1;
    }

    function undo(trail) {
      for (var i2 = trail.length - 2; i2 >= 0; i2 -= 2) {
        alive[trail[i2]][trail[i2 + 1]] = 1;
        aliveCount[trail[i2]]++;
      }
    }

    // Why did w run out of options? Re-derive the blocker for each of its
    // original values against the board as it stands right now.
    function explain(w, cause, causeVal, depth) {
      var vw = C.varInfo[w], counts = { rombel: 0, guru: 0, ruang: 0 }, contoh = {};
      for (var a2 = 0; a2 < C.values[w].length; a2++) {
        var code = conflictCode(C, board, w, C.values[w][a2]);
        var kind = code === 1 ? 'rombel' : code === 2 ? 'guru' : code === 3 ? 'ruang' : null;
        if (!kind) continue;
        counts[kind]++;
        if (!contoh[kind]) {
          var val2 = C.values[w][a2];
          var base = val2.hari * C.maxSlots + val2.slot - 1;
          var occ = kind === 'rombel' ? board.rombel[vw.rombelI * C.cellCount + base]
            : kind === 'guru' ? board.guru[vw.guruI * C.cellCount + base]
              : board.ruang[val2.ruangI * C.cellCount + base];
          if (occ) {
            var o = C.varInfo[occ - 1];
            contoh[kind] = C.hari[val2.hari].label + ' JP ' + val2.slot + ' sudah dipakai ' +
              o.mapel.kode + ' ' + o.sesi.rombelNama;
          }
        }
      }
      var causeInfo = C.varInfo[cause];
      var lines = [];
      if (counts.guru) lines.push(counts.guru + ' slot tertutup jadwal guru ' + (C.guruById[vw.sesi.guruId] || {}).nama + (contoh.guru ? ' (mis. ' + contoh.guru + ')' : ''));
      if (counts.rombel) lines.push(counts.rombel + ' slot tertutup jadwal rombel ' + vw.sesi.rombelNama + (contoh.rombel ? ' (mis. ' + contoh.rombel + ')' : ''));
      if (counts.ruang) lines.push(counts.ruang + ' slot tertutup pemakaian ' + (vw.sesi.ruangTipe || 'ruang kelas') + (contoh.ruang ? ' (mis. ' + contoh.ruang + ')' : ''));
      return {
        tahap: 'propagasi',
        // The search proved nothing global here: it found the deepest dead end
        // it reached. Saying otherwise would be a lie a scheduler would act on.
        sifat: 'tidak-terbukti',
        sesiId: vw.sesi.id,
        kedalaman: depth,
        judul: 'Domain habis untuk ' + vw.mapel.kode + ' ' + vw.sesi.rombelNama + ' (' + vw.sesi.len + ' JP)',
        pesan: 'Setelah menempatkan ' + causeInfo.mapel.kode + ' ' + causeInfo.sesi.rombelNama + ' pada ' +
          C.hari[causeVal.hari].label + ' JP ' + causeVal.slot + ', sesi ini kehilangan seluruh ' +
          C.values[w].length + ' kandidatnya: ' + lines.join('; ') + '.',
        buktiKuat: 'Ini jalan buntu TERDALAM yang dicapai pencarian (kedalaman ' + depth + ' dari ' + n + '), bukan bukti bahwa jadwal mustahil. Solver sudah mundur dan mencoba cabang lain sampai anggaran habis.',
        saran: 'Kendala di atas adalah tempat pertama yang layak dilonggarkan: ketidaksediaan guru pengampu, ukuran blok, atau jumlah ruang khusus.'
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SV;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
