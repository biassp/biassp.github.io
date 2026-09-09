/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — seed.js
 * Pure. It returns row arrays and inserts nothing: no sql.js, no DOM, no
 * network. engine.js decides how the rows get into the database; this file only
 * decides what they are.
 *
 * EVERY ROW IS FABRICATED, AND THE SCHEMA MAKES THAT STRUCTURAL.
 * nik_demo must GLOB 'NIK-FIKTIF-*', phone must GLOB '08[0-9][0-9]-FIKTIF-...',
 * is_demo must equal 1. Not one value in here has the shape of a real
 * Indonesian identifier — a real NIK encodes province, regency, district, birth
 * date and sex in sixteen digits, and nothing this file produces could be
 * mistaken for one or typed into a real system by accident.
 *
 * THE ROWS ARE IN THE **LEGACY** v1 SHAPE, NOT THE END STATE.
 * That is the whole point of the lab. Allergies arrive as 'penisilin,nsaid' in
 * one TEXT column; the visit's status history arrives as a JSON blob; money
 * arrives as REAL. The nine migrations are what turn this into the schema in
 * §2, and they have to do it against rows that already exist, because a list of
 * CREATE TABLE statements run against an empty database is a schema, not a
 * migration.
 *
 * WHY REPRODUCIBILITY NEEDS TWO PINS.
 * The PRNG seed decides who exists. PINNED_TODAY decides when. Visit ids embed
 * the date, ages derive from it, and every audit timestamp is relative to it —
 * so moving the pinned day by one changes the chain head, and that is asserted
 * rather than asserted-about. A fixture pinned on only one of the two drifts
 * overnight and costs a morning to diagnose.
 *
 * NO ROW COUNT IN THIS FILE IS A CLAIM ABOUT ITSELF.
 * build() counts what it produced and returns the counts. Nothing downstream —
 * not the page, not the README, not the suite — is allowed to type a count by
 * hand, because a wrong number above the fold is the worst available failure on
 * a page whose pitch is that every number is checkable.
 */
(function (root) {
  'use strict';

  var D = root.ROMBAK_DOMAIN;
  if (!D) throw new Error('ROMBAK_SEED: domain.js must load first');

  var SEED = D.SEED;
  var PINNED_TODAY = D.PINNED_TODAY;

  // 8,741 rather than 8,000: a round number reads as a number somebody chose,
  // and the point of a fixture is that nobody chose the shape of it.
  var BULK_PATIENTS = 8741;
  var PAST_DAYS = 903;
  var STORY_PATIENTS = 25;
  var STORY_DAYS = 44;

  /* ------------------------------------------------------------ name pools */

  var GIVEN_P = ['Siti', 'Dewi', 'Rina', 'Ayu', 'Nur', 'Fitri', 'Lestari', 'Indah', 'Wulan',
    'Ratna', 'Sri', 'Yuni', 'Maya', 'Endang', 'Tuti', 'Rahayu', 'Kartika', 'Melati',
    'Anisa', 'Cahaya'];
  var GIVEN_L = ['Budi', 'Agus', 'Joko', 'Bambang', 'Slamet', 'Hendra', 'Yusuf', 'Rizki',
    'Andi', 'Dedi', 'Eko', 'Fajar', 'Gunawan', 'Hadi', 'Iwan', 'Krisna', 'Mulyadi',
    'Nanang', 'Purnomo', 'Rahmat'];
  var FAMILY = ['Santoso', 'Wibowo', 'Halim', 'Kusuma', 'Pratama', 'Nugroho', 'Saputra',
    'Hidayat', 'Maulana', 'Setiawan', 'Wijaya', 'Permana', 'Handoko', 'Suryana',
    'Lubis', 'Siregar', 'Sihombing', 'Panjaitan', 'Tanjung', 'Nasution', 'Marpaung',
    'Simanjuntak', 'Ginting', 'Sitompul', 'Hutapea'];
  var STREET = ['Melati', 'Kenanga', 'Cempaka', 'Merpati', 'Garuda', 'Diponegoro',
    'Sudirman', 'Ahmad Yani', 'Gatot Subroto', 'Pahlawan', 'Kartini', 'Veteran'];

  var COMPLAINT = ['Demam tiga hari', 'Batuk berdahak', 'Nyeri kepala', 'Nyeri perut kanan bawah',
    'Gigi berlubang, nyeri', 'Gusi bengkak', 'Kontrol kehamilan', 'Sesak napas ringan',
    'Diare sejak semalam', 'Gatal seluruh badan', 'Nyeri punggung bawah', 'Mata merah berair',
    'Telinga terasa penuh', 'Luka di kaki, dua hari', 'Kontrol tekanan darah',
    'Kontrol gula darah', 'Imunisasi anak', 'Pusing berputar', 'Mual dan muntah',
    'Nyeri saat berkemih'];

  // Codes drawn for diagnoses. Kept to the rubrics an Indonesian FKTP actually
  // reports, so the chapter roll-up on the Plans tab has something to roll up.
  var DX_POOL = ['J06.9', 'I10', 'K29.7', 'K30', 'M79.1', 'A09.9', 'R50.9', 'J00', 'J02.9',
    'J45.9', 'E11.9', 'M10.9', 'L23.9', 'L30.9', 'N39.0', 'K02.9', 'K04.0', 'R51',
    'M54.5', 'E78.5', 'A91', 'H61.2', 'B86', 'J30.4', 'K21.9', 'Z34.9', 'D50.9', 'R05',
    'H10.9', 'B35.4', 'M25.5', 'G44.2', 'I48', 'E11.6', 'A15.0'];
  var CHRONIC_POOL = ['I10', 'E11.9', 'J45.9', 'I48', 'E78.5', 'E11.6'];
  var ALLERGY_POOL = ['penisilin', 'sulfa', 'nsaid', 'opioid', 'makanan-laut', 'debu-tungau', 'lateks'];

  var POLI = [
    { id: 'umum', prefix: 'A', konsul: 40000, doctor: 'stf-01' },
    { id: 'gigi', prefix: 'B', konsul: 65000, doctor: 'stf-02' },
    { id: 'kia', prefix: 'C', konsul: 40000, doctor: 'stf-03' }
  ];
  var TINDAKAN_BY_POLI = {
    umum: [['tnd-02', 45000, 1], ['tnd-03', 75000, 1], ['tnd-04', 25000, 1],
           ['tnd-05', 90000, 1], ['tnd-06', 120000, 1], ['tnd-07', 30000, 1], ['tnd-01', 85000, 1]],
    gigi: [['tnd-08', 150000, 1], ['tnd-09', 95000, 1], ['tnd-10', 175000, 1], ['tnd-11', 250000, 0]],
    kia: [['tnd-12', 35000, 1], ['tnd-13', 55000, 1], ['tnd-14', 220000, 0]]
  };
  var NURSE = 'stf-04';
  var CLERK = 'stf-05';
  var PHARMACIST = 'stf-06';
  var STAFF_NAME = {
    'stf-01': ['dr. Rina Halim', 'dokter'],
    'stf-02': ['drg. Yusuf Anwar', 'dokter'],
    'stf-03': ['dr. Sari Wibowo', 'dokter'],
    'stf-04': ['Ani Kusuma', 'perawat'],
    'stf-05': ['Budi Santoso', 'pendaftaran'],
    'stf-06': ['Dewi Lestari', 'apoteker']
  };

  var ADMIN_RP = 10000;

  function normName(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  /* ==================================================================== */

  /**
   * build(opts) -> the whole fixture, in the legacy v1 shape.
   *
   * opts.seed / opts.pinnedToday / opts.bulkPatients / opts.pastDays all
   * override, and exist so the suite can move the pinned day by one and watch
   * the chain head change. Nothing else may vary between two runs.
   */
  function build(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? SEED : opts.seed;
    var today = opts.pinnedToday || PINNED_TODAY;
    var bulkN = opts.bulkPatients == null ? BULK_PATIENTS : opts.bulkPatients;
    var pastDays = opts.pastDays == null ? PAST_DAYS : opts.pastDays;

    var rng = D.makeRng(seed);

    var patients = [];      // legacy patient rows
    var visits = [];
    var encounters = [];
    var diagnoses = [];
    var addenda = [];
    var bills = [];
    var billLines = [];
    var events = [];        // pre-chain audit events, chained at the end

    var defects = {
      D1: { token: 'penicillin', rmNumbers: [] },
      D2: { encounterId: null, codes: [] },
      D3: [],
      D4: { visitId: null, doctorId: PHARMACIST }
    };

    /* ------------------------------------------------------------ patients */

    // Three of the story patients carry the English spelling of penisilin. That
    // is D1, and it is the residue of a 2024 spreadsheet import: three rows
    // that read as an allergy to a human and resolve to nothing at all to a
    // lookup. The whole of v4 exists to find them.
    var D1_SEQ = { 7: 1, 13: 1, 21: 1 };
    var totalPatients = STORY_PATIENTS + bulkN;
    var seq, isStory, sex, given, name, dobYearsAgo, dob, createdDaysAgo, createdAt;
    var klass, bpjs, allergies, chronic, j, n;

    for (seq = 1; seq <= totalPatients; seq++) {
      isStory = seq <= STORY_PATIENTS;
      sex = rng.chance(0.54) ? 'P' : 'L';
      given = sex === 'P' ? rng.pick(GIVEN_P) : rng.pick(GIVEN_L);
      name = given + ' ' + rng.pick(FAMILY);
      dobYearsAgo = rng.weighted([[1, 6], [4, 8], [12, 9], [24, 14], [36, 16], [48, 14], [59, 12], [71, 8], [83, 3]]);
      dob = D.addDays(today, -(dobYearsAgo * 365 + rng.int(0, 364)));
      // Registration is always after birth and never in the future: the CHECK
      // (dob <= created_at) exists because a future date of birth passes every
      // age-dependent rule in the system in silence.
      createdDaysAgo = isStory ? rng.int(30, 1600) : rng.int(0, Math.min(2600, dobYearsAgo * 365));
      if (createdDaysAgo > dobYearsAgo * 365) createdDaysAgo = rng.int(0, Math.max(1, dobYearsAgo * 365));
      createdAt = D.stamp(D.addDays(today, -createdDaysAgo), rng.int(7, 15), rng.int(0, 59), rng.int(0, 59));
      klass = rng.chance(0.72) ? 'bpjs' : 'umum';
      bpjs = klass === 'bpjs' ? 'BPJS-FIKTIF-' + D.pad(seq, 6) : (rng.chance(0.1) ? 'BPJS-FIKTIF-' + D.pad(seq, 6) : null);

      allergies = [];
      if (rng.chance(0.22)) allergies.push(rng.pick(ALLERGY_POOL));
      if (rng.chance(0.06)) allergies.push(rng.pick(ALLERGY_POOL));
      if (D1_SEQ[seq]) {
        allergies = ['penicillin'];
        defects.D1.rmNumbers.push(D.rmNumber(seq));
      }
      // De-duplicate: patient_allergy has a composite primary key, so the same
      // class twice in the CSV would collide at v4 and the collision would be
      // read as a defect the fixture did not plant.
      allergies = allergies.filter(function (a, idx) { return allergies.indexOf(a) === idx; });

      chronic = [];
      n = rng.weighted([[0, 74], [1, 20], [2, 6]]);
      for (j = 0; j < n; j++) chronic.push(rng.pick(CHRONIC_POOL));
      chronic = chronic.filter(function (c, idx) { return chronic.indexOf(c) === idx; });

      patients.push([
        D.rmNumber(seq),
        name,
        normName(name),
        sex,
        dob,
        'NIK-FIKTIF-' + D.pad(seq, 6),
        bpjs,
        '08' + D.pad(rng.int(11, 99), 2) + '-FIKTIF-' + D.pad(rng.int(0, 999), 3),
        'Jl. ' + rng.pick(STREET) + ' No. ' + rng.int(1, 220) + ', RT ' + D.pad(rng.int(1, 12), 2),
        klass,
        createdAt,
        1,
        allergies.join(','),
        chronic.join(',')
      ]);

      if (isStory) {
        events.push({
          at: createdAt, actor: CLERK, action: 'patient.create', entity: 'patient',
          entityId: D.rmNumber(seq),
          summary: 'Pasien baru terdaftar: ' + name,
          detail: { rm: D.rmNumber(seq), klass: klass, sex: sex }
        });
      }
    }

    /* -------------------------------------------------------------- visits */

    // Counters shared by both passes, because a queue number is unique only
    // inside (date, poli) and a visit id is unique inside the date. Two passes
    // over the same day must not reuse either.
    var seqByDatePoli = {};   // 'date|poli' -> last queue_seq
    var seqByDate = {};       // 'date'      -> last visit ordinal that day
    var encByDate = {};       // 'date'      -> last encounter ordinal that day
    var activeKey = {};       // 'rm|date|poli' -> 1, for the partial unique index
    var addendumSeq = 0;

    function nextQueue(date, poliId) {
      var k = date + '|' + poliId;
      seqByDatePoli[k] = (seqByDatePoli[k] || 0) + 1;
      return seqByDatePoli[k];
    }
    function nextVisitId(date) {
      seqByDate[date] = (seqByDate[date] || 0) + 1;
      return D.visitId(date, seqByDate[date]);
    }
    function nextEncounterId(date) {
      encByDate[date] = (encByDate[date] || 0) + 1;
      return D.encounterId(date, encByDate[date]);
    }

    var TERMINAL = [['selesai', 71], ['batal', 23], ['rujuk-keluar', 6]];
    var INFLIGHT = [['menunggu-triase', 14], ['menunggu-dokter', 26], ['konsultasi', 24],
      ['menunggu-tindakan', 10], ['tindakan', 8], ['menunggu-kasir', 18]];

    // The order a visit passes through, so history_json is a real path rather
    // than a random walk. The tindakan pair is on the path only for the visits
    // that actually had a procedure — most consultations go straight from
    // konsultasi to the cashier, and a fixture where every visit had a procedure
    // would put a third of the money in the wrong place.
    function pathFor(viaTindakan) {
      var p = ['menunggu-triase', 'menunggu-dokter', 'konsultasi'];
      if (viaTindakan) p.push('menunggu-tindakan', 'tindakan');
      p.push('menunggu-kasir', 'selesai');
      return p;
    }

    function makeVisit(rmSeq, date, poli, statusPick, isStory) {
      var rm = D.rmNumber(rmSeq);
      var ak = rm + '|' + date + '|' + poli.id;
      var status = statusPick;
      // ux_visit_active is a PARTIAL unique index: one ACTIVE visit per patient
      // per day per poli. A second one on the same day is allowed only once the
      // first has left the queue, so a repeat draw is forced terminal.
      if (activeKey[ak] && status !== 'selesai' && status !== 'batal' && status !== 'rujuk-keluar') {
        status = 'selesai';
      }
      if (status !== 'selesai' && status !== 'batal' && status !== 'rujuk-keluar') activeKey[ak] = 1;

      var qseq = nextQueue(date, poli.id);
      var id = nextVisitId(date);
      var openedH = 7 + Math.floor((qseq - 1) / 6);
      if (openedH > 14) openedH = 14;
      var openedAt = D.stamp(date, openedH, rng.int(0, 59), rng.int(0, 59));

      var viaTindakan = (status === 'menunggu-tindakan' || status === 'tindakan')
        ? true : rng.chance(0.34);
      var PATH = pathFor(viaTindakan);
      var reached = PATH.indexOf(status);
      if (status === 'batal') reached = rng.weighted([[0, 46], [1, 38], [2, 16]]);
      if (status === 'rujuk-keluar') reached = 2;
      if (reached < 0) reached = PATH.length - 1;

      var hasDoctor = reached >= 2;
      var doctorId = hasDoctor ? poli.doctor : null;

      // Triage happens on the way out of menunggu-triase, so anything that got
      // past state 0 has vitals; a cancelled visit at state 0 does not.
      var triaged = reached >= 1;
      var vit = null;
      if (triaged) {
        var sistol = rng.int(95, 168);
        vit = {
          td_sistol: sistol,
          td_diastol: rng.int(58, Math.min(104, sistol - 12)),
          nadi: rng.int(58, 112),
          suhu_dc: D.dc(36 + rng.int(0, 32) / 10),
          rr: rng.int(14, 26),
          spo2: rng.int(93, 99),
          bb_hg: D.hg(rng.int(30, 95) + rng.int(0, 9) / 10),
          tb_mm: D.mm(rng.int(120, 182)),
          acuity_id: rng.weighted([['hijau', 78], ['kuning', 19], ['merah', 3]]),
          by: NURSE,
          at: D.stamp(date, openedH, rng.int(0, 59), rng.int(0, 59))
        };
      }

      // history_json: the legacy shape. One JSON blob per visit, with the
      // transitions in the order they happened, which is exactly the structure
      // v5 has to lift into visit_status_history.
      var hist = [];
      var prev = null, hi, hstate;
      var upto = Math.min(reached, PATH.length - 1);
      for (hi = 0; hi <= upto; hi++) {
        hstate = PATH[hi];
        hist.push({
          from: prev, to: hstate,
          at: D.stamp(date, Math.min(15, openedH + hi), rng.int(0, 59), rng.int(0, 59)),
          by: hi <= 1 ? (hi === 0 ? CLERK : NURSE) : (doctorId || NURSE),
          role: hi <= 1 ? (hi === 0 ? 'pendaftaran' : 'perawat') : (doctorId ? 'dokter' : 'perawat')
        });
        prev = hstate;
      }
      if (status === 'batal' || status === 'rujuk-keluar') {
        hist.push({ from: prev, to: status, at: D.stamp(date, Math.min(15, openedH + upto + 1), rng.int(0, 59), rng.int(0, 59)), by: CLERK, role: 'pendaftaran' });
      }

      var tind = [];
      if (viaTindakan && reached >= 4) {
        var pool = TINDAKAN_BY_POLI[poli.id];
        var pickA = rng.pick(pool);
        tind.push(pickA);
        if (rng.chance(0.22)) {
          var pickB = rng.pick(pool);
          if (pickB[0] !== pickA[0]) tind.push(pickB);
        }
      }

      var billedAt = status === 'selesai'
        ? D.stamp(date, Math.min(16, openedH + upto + 1), rng.int(0, 59), rng.int(0, 59))
        : null;

      var patientRow = patients[rmSeq - 1];
      var klassV = patientRow[9];

      visits.push([
        id, rm, date, poli.id, klassV, status,
        poli.prefix + D.pad(qseq, 3), qseq,
        rng.pick(COMPLAINT),
        doctorId, openedAt, CLERK, billedAt,
        tind.map(function (t) { return t[0]; }).join(','),
        JSON.stringify(hist),
        vit ? vit.td_sistol : null, vit ? vit.td_diastol : null, vit ? vit.nadi : null,
        vit ? vit.suhu_dc : null, vit ? vit.rr : null, vit ? vit.spo2 : null,
        vit ? vit.bb_hg : null, vit ? vit.tb_mm : null,
        vit ? vit.acuity_id : null, vit ? vit.by : null, vit ? vit.at : null
      ]);

      return { id: id, rm: rm, date: date, poli: poli, status: status, reached: reached,
               doctorId: doctorId, openedAt: openedAt, billedAt: billedAt, tind: tind,
               vit: vit, klass: klassV, isStory: isStory, hist: hist };
    }

    /* ------------------------------- encounters, diagnoses, bills per visit */

    function attachClinical(v) {
      if (v.reached < 2 || !v.doctorId) return;

      var encId = nextEncounterId(v.date);
      var signed = v.reached >= 5 || v.status === 'selesai';
      var createdAt = D.stamp(v.date, Math.min(15, 8 + v.reached), rng.int(0, 59), rng.int(0, 59));
      var signedAt = signed ? D.stamp(v.date, Math.min(16, 9 + v.reached), rng.int(0, 59), rng.int(0, 59)) : null;
      var sText = 'Keluhan sejak ' + rng.int(1, 7) + ' hari. ' + rng.pick(COMPLAINT) + '.';

      encounters.push([
        encId, v.id, v.rm, v.doctorId, signed ? 'signed' : 'draft',
        sText,
        'Kesadaran compos mentis, keadaan umum baik.',
        signed ? 'Terapi simtomatik, kontrol bila keluhan menetap.' : '',
        signed ? 'Edukasi minum obat dan istirahat cukup.' : '',
        signed ? D.addDays(v.date, rng.int(3, 14)) : '',
        createdAt, signedAt, signed ? v.doctorId : null
      ]);

      var nDx = rng.weighted([[1, 58], [2, 32], [3, 10]]);
      var used = {}, dxi, code;
      var codes = [];
      for (dxi = 0; dxi < nDx; dxi++) {
        code = rng.pick(DX_POOL);
        if (used[code]) continue;
        used[code] = 1;
        codes.push(code);
        diagnoses.push([encId, code, dxi === 0 ? 1 : 0, '']);
      }

      if (v.isStory) {
        events.push({ at: createdAt, actor: v.doctorId, action: 'encounter.start', entity: 'encounter',
          entityId: encId, summary: 'Catatan konsultasi dibuka', detail: { visit: v.id } });
        for (dxi = 0; dxi < codes.length; dxi++) {
          events.push({ at: createdAt, actor: v.doctorId, action: 'diagnosis.add', entity: 'encounter',
            entityId: encId, summary: 'Diagnosis ' + codes[dxi], detail: { code: codes[dxi], primary: dxi === 0 } });
        }
        if (signed) {
          events.push({ at: signedAt, actor: v.doctorId, action: 'encounter.sign', entity: 'encounter',
            entityId: encId, summary: 'Catatan ditandatangani', detail: { visit: v.id, codes: codes } });
        }
      }

      return { encId: encId, codes: codes, signed: signed };
    }

    function attachBill(v) {
      if (v.status !== 'selesai' || !v.billedAt) return;
      var lines = [];
      var lineNo = 1;
      var isBpjs = v.klass === 'bpjs';

      function push(label, grp, qty, unit, covered) {
        lines.push({ no: lineNo++, label: label, grp: grp, qty: qty, unit: unit,
                     covered: covered ? 1 : 0, payer: covered ? 'bpjs' : 'pasien' });
      }

      push('Administrasi', 'administrasi', 1, ADMIN_RP, isBpjs);
      push('Jasa konsultasi ' + v.poli.id, 'jasa', 1, v.poli.konsul, isBpjs);
      var ti;
      for (ti = 0; ti < v.tind.length; ti++) {
        push(v.tind[ti][0], 'tindakan', 1, v.tind[ti][1], isBpjs && v.tind[ti][2] === 1);
      }

      var total = 0, ditanggung = 0, lain = 0, pasien = 0, li;
      for (li = 0; li < lines.length; li++) {
        var amt = lines[li].qty * lines[li].unit;
        total += amt;
        if (lines[li].payer === 'bpjs') ditanggung += amt;
        else if (lines[li].payer === 'penjamin-lain') lain += amt;
        else pasien += amt;
      }

      // A minority of closed bills carry an incident type, because that is where
      // it decides who pays. The visit row has nowhere to put it at v1 — which
      // is exactly why v2 adds visit.kecelakaan_id, and why nothing can backfill
      // that column from anywhere.
      var kec = rng.chance(0.02) ? rng.weighted([['lalu-lintas', 6], ['kerja', 3], ['lain', 1]]) : null;

      bills.push([v.id, v.klass, kec, total, ditanggung, lain, pasien, '', v.billedAt, CLERK]);
      for (li = 0; li < lines.length; li++) {
        billLines.push([v.id, lines[li].no, lines[li].label, lines[li].grp,
          lines[li].qty, lines[li].unit, lines[li].qty * lines[li].unit,
          lines[li].covered, lines[li].payer]);
      }

      if (v.isStory) {
        events.push({ at: v.billedAt, actor: CLERK, action: 'bill.close', entity: 'visit',
          entityId: v.id, summary: 'Tagihan ditutup', detail: { total_rp: total, dibayar_rp: pasien } });
      }
    }

    function auditVisit(v) {
      if (!v.isStory) return;
      events.push({ at: v.openedAt, actor: CLERK, action: 'visit.open', entity: 'visit',
        entityId: v.id, summary: 'Kunjungan dibuka di poli ' + v.poli.id,
        detail: { queue: v.poli.prefix + '###', poli: v.poli.id } });
      var hi;
      for (hi = 0; hi < v.hist.length; hi++) {
        if (!v.hist[hi].from) continue;
        events.push({ at: v.hist[hi].at, actor: v.hist[hi].by, action: 'visit.status', entity: 'visit',
          entityId: v.id, summary: v.hist[hi].from + ' -> ' + v.hist[hi].to,
          detail: { from: v.hist[hi].from, to: v.hist[hi].to } });
      }
      if (v.vit) {
        events.push({ at: v.vit.at, actor: NURSE, action: 'triage.record', entity: 'visit',
          entityId: v.id, summary: 'Triase ' + v.vit.acuity_id,
          detail: { acuity: v.vit.acuity_id, suhu_dc: v.vit.suhu_dc, nadi: v.vit.nadi } });
      }
    }

    /* ------------------------------------------------- pass A: the cohort */

    // Volume rises towards the present, which is what a register that has been
    // filling up for two and a half years looks like. Uniform volume over 903
    // days would be the giveaway that nobody thought about it.
    var d, dateIso, pi, perPoli, vi, rmPick, story;
    for (d = pastDays; d >= 1; d--) {
      dateIso = D.addDays(today, -d);
      // No clinic on Sunday. It costs one line and it removes a whole class of
      // "why does every date have visits" question.
      if (new Date(dateIso + 'T00:00:00Z').getUTCDay() === 0) continue;
      for (pi = 0; pi < POLI.length; pi++) {
        perPoli = rng.weighted([[0, 38], [1, 34], [2, 18], [3, 8], [4, 2]]);
        if (d < 200) perPoli += rng.weighted([[0, 74], [1, 22], [2, 4]]);
        for (vi = 0; vi < perPoli; vi++) {
          rmPick = STORY_PATIENTS + 1 + Math.floor(rng.next() * bulkN);
          if (rmPick > STORY_PATIENTS + bulkN) rmPick = STORY_PATIENTS + bulkN;
          story = makeVisit(rmPick, dateIso, POLI[pi], rng.weighted(TERMINAL), false);
          attachClinical(story);
          attachBill(story);
        }
      }
    }

    /* ------------------------------------------- pass B: the story subset */

    // The story subset mirrors the clinic's shape rather than its size: a
    // handful of staff, twenty-five patients, six weeks of visits, and every
    // audit event the chain has. It exists so the panels have rows a reader can
    // hold in their head, and so the audit chain is short enough to walk on
    // screen.
    var storyVisits = [];
    for (d = STORY_DAYS; d >= 0; d--) {
      dateIso = D.addDays(today, -d);
      if (new Date(dateIso + 'T00:00:00Z').getUTCDay() === 0) continue;
      if (!rng.chance(0.75)) continue;
      for (pi = 0; pi < POLI.length; pi++) {
        if (!rng.chance(0.55)) continue;
        rmPick = 1 + Math.floor(rng.next() * STORY_PATIENTS);
        if (rmPick > STORY_PATIENTS) rmPick = STORY_PATIENTS;
        var st = d === 0 ? rng.weighted(INFLIGHT) : rng.weighted(TERMINAL);
        var v = makeVisit(rmPick, dateIso, POLI[pi], st, true);
        auditVisit(v);
        var enc = attachClinical(v);
        attachBill(v);
        storyVisits.push({ v: v, enc: enc });
      }
    }

    /* ---------------------------------------------------- the four defects */

    // D4 — one visit's doctor_id names the apoteker. A dropdown that listed all
    // staff, and a guard that only tested "is doctor_id non-null". The visit sits
    // in konsultasi with a pharmacist assigned and no note anybody can sign,
    // which is exactly the deadlock the composite foreign key at v5 makes
    // unwritable: assignDoctor() validated the role and openVisit() did not.
    //
    // It is CONSTRUCTED rather than searched for. A fixture that contains its
    // own defect only when the draw happens to cooperate is not a fixture, and
    // the assertion that v5 refuses would go green by accident on the run where
    // the defect went missing.
    var si;
    var d4 = makeVisit(3, today, POLI[0], 'konsultasi', true);
    auditVisit(d4);
    storyVisits.push({ v: d4, enc: null });
    for (vi = 0; vi < visits.length; vi++) {
      if (visits[vi][0] === d4.id) { visits[vi][9] = PHARMACIST; break; }
    }
    defects.D4.visitId = d4.id;

    // D2 — one encounter carries two primary diagnoses, installed by an addendum
    // on path 'a'. In the IndexedDB version signEncounter() checks
    // primary.length !== 1 and addAddendum() checks nothing at all, so this is
    // not a hypothetical: it is the hole that version still has.
    var d2Enc = null;
    for (si = 0; si < storyVisits.length; si++) {
      if (storyVisits[si].enc && storyVisits[si].enc.signed && storyVisits[si].enc.codes.length >= 2) {
        d2Enc = storyVisits[si]; break;
      }
    }
    if (d2Enc) {
      var encId2 = d2Enc.enc.encId;
      for (j = 0; j < diagnoses.length; j++) {
        if (diagnoses[j][0] === encId2 && diagnoses[j][1] === d2Enc.enc.codes[1]) {
          diagnoses[j][2] = 1;
          break;
        }
      }
      defects.D2.encounterId = encId2;
      defects.D2.codes = [d2Enc.enc.codes[0], d2Enc.enc.codes[1]];

      addendumSeq++;
      var addAt = D.stamp(d2Enc.v.date, 16, 12, 4);
      addenda.push([
        'ADD-' + D.pad(addendumSeq, 4), addendumSeq, encId2, 'a',
        D.canonical({ codes: [{ code: d2Enc.enc.codes[0], primary: true }] }),
        D.canonical({ codes: [{ code: d2Enc.enc.codes[0], primary: true }, { code: d2Enc.enc.codes[1], primary: true }] }),
        'Koreksi assessment: diagnosis kedua ikut ditandai utama',
        d2Enc.v.doctorId, 'dokter', addAt
      ]);
      events.push({ at: addAt, actor: d2Enc.v.doctorId, action: 'encounter.addendum', entity: 'encounter',
        entityId: encId2, summary: "Adendum pada path 'a'", detail: { path: 'a', reason: 'koreksi assessment' } });
    }

    // The second addendum is the o.vitals carve-out: the one path on which a
    // perawat may amend a doctor's signed note. In the original that carve-out
    // is an `if`; here it is a row in addendable_path_role and the composite
    // foreign key on (path, by_role) is what enforces it.
    var vitEnc = null;
    for (si = 0; si < storyVisits.length; si++) {
      if (storyVisits[si].enc && storyVisits[si].enc.signed && storyVisits[si].v.vit &&
          (!d2Enc || storyVisits[si].enc.encId !== d2Enc.enc.encId)) { vitEnc = storyVisits[si]; break; }
    }
    if (vitEnc) {
      addendumSeq++;
      var vitAt = D.stamp(vitEnc.v.date, 17, 3, 41);
      addenda.push([
        'ADD-' + D.pad(addendumSeq, 4), addendumSeq, vitEnc.enc.encId, 'o.vitals',
        D.canonical({ suhu_dc: vitEnc.v.vit.suhu_dc }),
        D.canonical({ suhu_dc: vitEnc.v.vit.suhu_dc + 4 }),
        'Suhu salah catat, diperbaiki dari lembar triase',
        NURSE, 'perawat', vitAt
      ]);
      events.push({ at: vitAt, actor: NURSE, action: 'encounter.addendum', entity: 'encounter',
        entityId: vitEnc.enc.encId, summary: "Adendum pada path 'o.vitals'",
        detail: { path: 'o.vitals', reason: 'suhu salah catat' } });
    }

    // D3 — two money values that a REAL column accepted without complaint. One
    // is a float multiply from the old JavaScript, the other is a CSV upload
    // that put a string in a numeric column. Both are invisible until v8's guard
    // query runs, and both are exactly the kind of value a nightly report
    // averages over without noticing.
    var d3Found = 0;
    for (j = 0; j < billLines.length && d3Found < 2; j++) {
      if (billLines[j][3] !== 'jasa') continue;
      if (billLines[j][5] !== 40000) continue;
      if (d3Found === 0) {
        billLines[j][5] = 40000.000000001;
        billLines[j][6] = 40000.000000001;
        defects.D3.push({ visitId: billLines[j][0], lineNo: billLines[j][1],
          value: 40000.000000001, kind: 'a float multiply in the old JavaScript' });
      } else {
        // 'Rp 15.000' and not '15000': a column with REAL affinity CONVERTS a
        // numeric-looking string on the way in, so '15000' would be stored as
        // 15000.0 and there would be no text left to find. Only a value SQLite
        // cannot read as a number at all survives as TEXT — and a currency
        // prefix from a spreadsheet export is exactly such a value. VERIFIED.
        billLines[j][5] = 'Rp 15.000';
        billLines[j][6] = 15000;
        // The bill this line belongs to was totalled from 40000, so the totals
        // are corrected to the 15000 the old JavaScript actually charged. The
        // defect is the TYPE of the stored value, not the amount.
        var bvid = billLines[j][0];
        for (var bj = 0; bj < bills.length; bj++) {
          if (bills[bj][0] === bvid) {
            var delta = 40000 - 15000;
            bills[bj][3] -= delta;
            if (billLines[j][8] === 'bpjs') bills[bj][4] -= delta; else bills[bj][6] -= delta;
            break;
          }
        }
        defects.D3.push({ visitId: billLines[j][0], lineNo: billLines[j][1],
          value: 'Rp 15.000', kind: 'a CSV export that carried the currency prefix into a numeric column' });
      }
      d3Found++;
    }

    /* ------------------------------------------------------ the counters */

    var queueCounter = [];
    var qk, qparts;
    var qkeys = Object.keys(seqByDatePoli).sort();
    for (j = 0; j < qkeys.length; j++) {
      qk = qkeys[j];
      qparts = qk.split('|');
      queueCounter.push([qparts[0], qparts[1], seqByDatePoli[qk]]);
    }
    var rmCounter = [[1, totalPatients]];

    /* --------------------------------------------------- the audit chain */

    // Sorted by timestamp, with the emission index as the tiebreak, because the
    // generator produces same-second events and a sort that is not total is a
    // chain that is not reproducible.
    for (j = 0; j < events.length; j++) events[j]._i = j;
    events.sort(function (a, b) {
      if (a.at < b.at) return -1;
      if (a.at > b.at) return 1;
      return a._i - b._i;
    });

    // The LEGACY chain, hashed over the LEGACY detail — which is
    // JSON.stringify's output, key order as written, and therefore not
    // canonical. v9 rewrites detail into canonical JSON and recomputes every
    // hash from seq 0 up; that is the backfill, and it is why the backfill has
    // to happen before the append-only triggers are armed.
    var auditRows = [];
    var prevHash = null;
    for (j = 0; j < events.length; j++) {
      var ev = events[j];
      var legacyDetail = JSON.stringify(ev.detail);
      var entry = {
        seq: j,
        at: ev.at,
        actorId: ev.actor,
        actorName: STAFF_NAME[ev.actor][0],
        actorRole: STAFF_NAME[ev.actor][1],
        action: ev.action,
        entity: ev.entity,
        entityId: ev.entityId,
        summary: ev.summary,
        detail: legacyDetail,
        prevHash: prevHash
      };
      var hash = D.hashEntry(entry);
      auditRows.push([j, ev.at, ev.actor, STAFF_NAME[ev.actor][0], STAFF_NAME[ev.actor][1],
        ev.action, ev.summary, legacyDetail, ev.entity, ev.entityId, prevHash, hash]);
      prevHash = hash;
    }

    /* ------------------------------------------------------------- output */

    var tables = {
      patient: { columns: ['rm_number', 'name', 'name_norm', 'sex', 'dob', 'nik_demo', 'bpjs_demo',
        'phone', 'address', 'klass', 'created_at', 'is_demo', 'allergies_csv', 'chronic_csv'],
        rows: patients },
      visit: { columns: ['id', 'rm_number', 'visit_date', 'poli_id', 'klass', 'status', 'queue_no',
        'queue_seq', 'complaint', 'doctor_id', 'opened_at', 'opened_by', 'billed_at',
        'tindakan_csv', 'history_json', 'td_sistol', 'td_diastol', 'nadi', 'suhu_dc', 'rr',
        'spo2', 'bb_hg', 'tb_mm', 'acuity_id', 'triage_by', 'triage_at'], rows: visits },
      encounter: { columns: ['id', 'visit_id', 'rm_number', 'doctor_id', 'status', 's', 'o_exam',
        'p_plan', 'p_edukasi', 'p_kontrol', 'created_at', 'signed_at', 'signed_by'], rows: encounters },
      encounter_diagnosis: { columns: ['encounter_id', 'icd_code', 'is_primary', 'note'], rows: diagnoses },
      addendum: { columns: ['id', 'seq', 'encounter_id', 'path', 'old_value', 'new_value', 'reason',
        'by_staff', 'by_role', 'at'], rows: addenda },
      bill: { columns: ['visit_id', 'klass', 'kecelakaan_id', 'total_tarif', 'ditanggung',
        'ditanggung_lain', 'dibayar_pasien', 'note', 'closed_at', 'closed_by'], rows: bills },
      bill_line: { columns: ['visit_id', 'line_no', 'label', 'grp', 'qty', 'unit', 'amount',
        'covered', 'payer'], rows: billLines },
      audit_entry: { columns: ['seq', 'at', 'actor_id', 'actor_name', 'actor_role', 'action',
        'summary', 'detail', 'entity', 'entity_id', 'prev_hash', 'hash'], rows: auditRows },
      rm_counter: { columns: ['k', 'last'], rows: rmCounter },
      queue_counter: { columns: ['visit_date', 'poli_id', 'last_seq'], rows: queueCounter }
    };

    var counts = {}, ck;
    for (ck in tables) if (Object.prototype.hasOwnProperty.call(tables, ck)) counts[ck] = tables[ck].rows.length;

    return {
      meta: {
        seed: seed, pinnedToday: today, bulkPatients: bulkN, pastDays: pastDays,
        storyPatients: STORY_PATIENTS, storyDays: STORY_DAYS
      },
      tables: tables,
      counts: counts,
      totalRows: (function () { var t = 0, kk; for (kk in counts) if (Object.prototype.hasOwnProperty.call(counts, kk)) t += counts[kk]; return t; })(),
      defects: defects,
      chain: { count: auditRows.length, head: auditRows.length ? auditRows[auditRows.length - 1][11] : D.GENESIS }
    };
  }

  root.ROMBAK_SEED = {
    SEED: SEED,
    PINNED_TODAY: PINNED_TODAY,
    BULK_PATIENTS: BULK_PATIENTS,
    PAST_DAYS: PAST_DAYS,
    STORY_PATIENTS: STORY_PATIENTS,
    STORY_DAYS: STORY_DAYS,
    build: build,
    normName: normName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.ROMBAK_SEED;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
