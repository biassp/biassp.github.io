/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — clinic.js
 * The transactional layer: it owns the state, enforces role permissions and
 * the queue state machine, and writes every mutation into the hash chain.
 *
 * Every mutating method returns a Promise for a RESULT OBJECT, never a
 * rejection: { ok: true, ... } or { ok: false, code, reason }. Refusals in a
 * clinic system are normal traffic, not exceptions — "apoteker cannot sign a
 * SOAP note" is an answer to display, not a stack trace. Rejections are
 * reserved for genuine faults.
 *
 * The audit write is part of the operation, not an afterthought hung off the
 * end: state is mutated only after the chain entry has been computed, so an
 * action can never end up applied but unlogged.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});
  var D = R.domain;
  var A = R.audit;

  function todayISO(d) {
    var x = d || new Date();
    return x.getFullYear() + '-' + D.pad(x.getMonth() + 1, 2) + '-' + D.pad(x.getDate(), 2);
  }

  function Clinic(opts) {
    opts = opts || {};
    this.now = opts.now || function () { return new Date(); };
    this.chain = new A.Chain(opts.auditEntries || []);
    this.state = opts.state || {
      counters: { rm: 0, visit: 0, encounter: 0, addendum: 0, prescription: 0, queue: {} },
      patients: [],
      staff: [],
      visits: [],
      encounters: [],
      addenda: [],
      prescriptions: []
    };
    this.actor = opts.actor || { id: 'sys', name: 'Sistem', role: 'pendaftaran' };
    this.onChange = opts.onChange || null;
  }

  /* ------------------------------------------------------------- helpers */

  Clinic.prototype.setActor = function (staffId) {
    var s = this.staff(staffId);
    if (!s) return false;
    this.actor = { id: s.id, name: s.name, role: s.role };
    return true;
  };

  Clinic.prototype.staff = function (id) {
    return this.state.staff.filter(function (s) { return s.id === id; })[0] || null;
  };
  Clinic.prototype.patient = function (rm) {
    return this.state.patients.filter(function (p) { return p.rmNumber === rm; })[0] || null;
  };
  Clinic.prototype.visit = function (id) {
    return this.state.visits.filter(function (v) { return v.id === id; })[0] || null;
  };
  Clinic.prototype.encounter = function (id) {
    return this.state.encounters.filter(function (e) { return e.id === id; })[0] || null;
  };
  Clinic.prototype.encounterForVisit = function (visitId) {
    return this.state.encounters.filter(function (e) { return e.visitId === visitId; })[0] || null;
  };
  Clinic.prototype.prescriptionsForVisit = function (visitId) {
    return this.state.prescriptions.filter(function (p) { return p.visitId === visitId; });
  };
  /* A visit can accumulate more than one prescription once cancellation
   * exists: the wrong one is cancelled and a replacement is written. "The"
   * prescription is the live one — the last that has not been cancelled —
   * falling back to the last cancelled one so the history is still reachable. */
  Clinic.prototype.prescriptionForVisit = function (visitId) {
    var all = this.prescriptionsForVisit(visitId);
    var live = all.filter(function (p) { return p.status !== 'dibatalkan'; });
    return live[live.length - 1] || all[all.length - 1] || null;
  };
  Clinic.prototype.prescription = function (id) {
    return this.state.prescriptions.filter(function (p) { return p.id === id; })[0] || null;
  };
  Clinic.prototype.visitsFor = function (rm) {
    return this.state.visits.filter(function (v) { return v.rmNumber === rm; })
      .sort(function (a, b) { return a.openedAt < b.openedAt ? 1 : -1; });
  };
  Clinic.prototype.addendaFor = function (encId) {
    return this.state.addenda.filter(function (a) { return a.encounterId === encId; })
      .sort(function (a, b) { return a.seq - b.seq; });
  };

  // Context the queue guards need: the visit's encounter and prescription.
  Clinic.prototype.ctxFor = function (visit) {
    return {
      encounter: this.encounterForVisit(visit.id),
      prescription: this.prescriptionForVisit(visit.id)
    };
  };

  Clinic.prototype.deny = function (perm) {
    var v = D.can(this.actor.role, perm);
    return v.ok ? null : { ok: false, code: 'permission', permission: perm, reason: v.reason };
  };

  Clinic.prototype.log = function (action, entity, entityId, summary, detail) {
    return this.chain.append({
      at: this.now().toISOString(),
      actorId: this.actor.id, actorName: this.actor.name, actorRole: this.actor.role,
      action: action, entity: entity, entityId: entityId,
      summary: summary, detail: detail === undefined ? null : detail
    });
  };

  Clinic.prototype.changed = function () {
    if (this.onChange) { try { this.onChange(); } catch (e) { /* UI error must not corrupt state */ } }
  };

  /* ------------------------------------------------------ RM  allocation */

  /**
   * The whole point of this function: the counter only ever goes up. It is
   * bumped and persisted BEFORE the patient record is created, so a crash
   * between the two burns a number rather than risking a reissue. Burning
   * numbers is free; reissuing one merges two people's medical histories.
   */
  Clinic.prototype.allocateRM = function () {
    this.state.counters.rm += 1;
    return D.formatRM(this.state.counters.rm);
  };

  Clinic.prototype.nextQueueNumber = function (dateStr, poli) {
    var key = dateStr + '|' + poli;
    var q = this.state.counters.queue;
    q[key] = (q[key] || 0) + 1;
    var p = D.POLI_BY_ID[poli] || D.POLI[0];
    return { display: p.prefix + '-' + D.pad(q[key], 3), seq: q[key] };
  };

  /* ------------------------------------------------------------ patients */

  Clinic.prototype.registerPatient = function (data) {
    var self = this;
    var denied = this.deny('pasien.daftar');
    if (denied) return Promise.resolve(denied);
    if (!data || !data.name || !String(data.name).trim()) {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Nama pasien wajib diisi.' });
    }
    if (!data.dob) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Tanggal lahir wajib diisi — tanpa usia, pita tanda vital anak, batasan usia obat dan kesesuaian sediaan tidak dapat diperiksa.'
      });
    }
    var dobDate = new Date(String(data.dob) + 'T00:00:00Z');
    if (isNaN(dobDate.getTime())) {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Tanggal lahir "' + data.dob + '" bukan tanggal yang sah.' });
    }
    var nowRef = this.now();
    if (dobDate.getTime() > nowRef.getTime()) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Tanggal lahir ' + data.dob + ' berada di masa depan. Usia negatif akan lolos dari setiap pemeriksaan yang bergantung pada usia — pita anak, batas aspirin, kurva IMT dewasa — jadi ditolak di sini, bukan nanti.'
      });
    }
    if (nowRef.getUTCFullYear() - dobDate.getUTCFullYear() > 130) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Tanggal lahir ' + data.dob + ' memberi usia di atas 130 tahun. Kemungkinan besar salah ketik tahun.'
      });
    }

    /* DUPLICATE SUSPICION.
     *
     * Two records for one person is the most expensive data-entry error a
     * clinic makes: the allergy list, the chronic problems and half the
     * history stay on the record nobody opened. The check is name + date of
     * birth + sex, which is what a registration clerk compares by eye anyway,
     * and it REFUSES rather than merges — merging two patients automatically
     * is a worse mistake than making someone confirm. Proceeding is possible,
     * but only as an explicit, separately-audited acknowledgement. */
    if (!data.acknowledgeDuplicate) {
      var dupes = this.findDuplicates(data.name, data.dob, data.sex === 'P' ? 'P' : 'L');
      if (dupes.length) {
        return Promise.resolve({
          ok: false, code: 'duplicate-suspect', candidates: dupes,
          reason: 'Sudah ada ' + dupes.length + ' pasien dengan nama, tanggal lahir dan jenis kelamin yang sama: ' +
            dupes.map(function (p) { return p.rmNumber + (p.allergies.length ? ' (alergi: ' + p.allergies.join(', ') + ')' : ''); }).join(', ') +
            '. Nomor RM kedua untuk orang yang sama memecah riwayat — alergi dan penyakit kronis tertinggal di rekam yang tidak dibuka. ' +
            'Gunakan No. RM yang sudah ada, atau nyatakan secara tegas bahwa ini orang yang berbeda.'
        });
      }
    }

    var rm = this.allocateRM();
    var p = {
      rmNumber: rm,
      name: String(data.name).trim(),
      sex: data.sex === 'P' ? 'P' : 'L',
      dob: data.dob,
      nikDemo: data.nikDemo || ('NIK-FIKTIF-' + rm.slice(3)),
      phone: data.phone || '',
      address: data.address || '',
      klass: data.klass === 'bpjs' ? 'bpjs' : 'umum',
      bpjsDemo: data.klass === 'bpjs' ? (data.bpjsDemo || ('BPJS-FIKTIF-' + rm.slice(3))) : '',
      allergies: data.allergies || [],
      allergyNote: data.allergyNote || '',
      chronic: data.chronic || [],
      pregnant: !!data.pregnant,
      createdAt: this.now().toISOString(),
      demo: true
    };
    return this.log('pasien.daftar', 'patient', rm,
      'Pasien baru didaftarkan, No. RM ' + rm + ' dialokasikan.' +
      (data.acknowledgeDuplicate ? ' Peringatan duplikat diabaikan secara sadar oleh petugas.' : ''),
      {
        nama: p.name, kelas: p.klass, alergi: p.allergies,
        duplikatDiabaikan: data.acknowledgeDuplicate ? this.findDuplicates(p.name, p.dob, p.sex).map(function (x) { return x.rmNumber; }) : null
      }
    ).then(function () {
      self.state.patients.push(p);
      self.changed();
      return { ok: true, patient: p };
    });
  };

  function normName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** Existing patients matching on normalised name + date of birth + sex. */
  Clinic.prototype.findDuplicates = function (name, dob, sex) {
    var n = normName(name);
    if (!n || !dob) return [];
    return this.state.patients.filter(function (p) {
      return normName(p.name) === n && p.dob === dob && (!sex || p.sex === sex);
    });
  };

  Clinic.prototype.updateAllergies = function (rm, allergies, note) {
    var self = this;
    var denied = this.deny('pasien.ubah-demografi');
    if (denied) return Promise.resolve(denied);
    var p = this.patient(rm);
    if (!p) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Pasien tidak ditemukan.' });
    var before = p.allergies.slice();
    return this.log('pasien.alergi', 'patient', rm,
      'Daftar alergi diperbarui.', { sebelum: before, sesudah: allergies }
    ).then(function () {
      p.allergies = allergies.slice();
      p.allergyNote = note || '';
      self.changed();
      return { ok: true, patient: p };
    });
  };

  Clinic.prototype.age = function (patient, at) {
    if (!patient || !patient.dob) return null;
    var d = new Date(patient.dob + 'T00:00:00Z');
    var ref = at ? new Date(at) : this.now();
    var y = ref.getUTCFullYear() - d.getUTCFullYear();
    var m = ref.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) y--;
    return y;
  };

  /* -------------------------------------------------------------- visits */

  Clinic.prototype.openVisit = function (data) {
    var self = this;
    var denied = this.deny('kunjungan.buka');
    if (denied) return Promise.resolve(denied);
    var p = this.patient(data.rmNumber);
    if (!p) return Promise.resolve({ ok: false, code: 'not-found', reason: 'No. RM ' + data.rmNumber + ' tidak ditemukan.' });
    // The chief complaint is what the nurse triages against and what the
    // doctor opens the consultation on. A visit without one arrives at the
    // consulting room as a name and a queue number.
    if (!data.complaint || !String(data.complaint).trim()) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Keluhan utama wajib diisi. Itulah satu-satunya keterangan yang dibawa pasien dari loket ke triase dan ke ruang periksa.'
      });
    }
    var poli = D.POLI_BY_ID[data.poli] ? data.poli : 'umum';
    var date = data.date || todayISO(this.now());

    // One open visit per patient per day per poli. Registering the same person
    // twice in one morning is a real and common data-entry error.
    var dup = this.state.visits.filter(function (v) {
      return v.rmNumber === p.rmNumber && v.date === date && v.poli === poli &&
        ['selesai', 'batal'].indexOf(v.status) < 0;
    })[0];
    if (dup) {
      return Promise.resolve({
        ok: false, code: 'duplicate',
        reason: 'Pasien ini sudah punya kunjungan aktif hari ini di ' + D.POLI_BY_ID[poli].label +
          ' dengan nomor antrian ' + dup.queueNo + ' (status: ' + D.QUEUE[dup.status].label + ').'
      });
    }

    this.state.counters.visit += 1;
    var q = this.nextQueueNumber(date, poli);
    var id = 'V-' + date.replace(/-/g, '') + '-' + D.pad(this.state.counters.visit, 4);
    var v = {
      id: id,
      rmNumber: p.rmNumber,
      date: date,
      poli: poli,
      klass: data.klass || p.klass,
      queueNo: q.display,
      queueSeq: q.seq,
      complaint: String(data.complaint).trim(),
      kecelakaan: D.KECELAKAAN_BY_ID[data.kecelakaan || ''] ? (data.kecelakaan || null) : null,
      status: 'terdaftar',
      doctorId: data.doctorId || null,
      triage: null,
      tindakan: [],
      billing: null,
      openedAt: this.now().toISOString(),
      openedBy: this.actor.id,
      history: [{ from: null, to: 'terdaftar', at: this.now().toISOString(), by: this.actor.id, role: this.actor.role }]
    };
    return this.log('kunjungan.buka', 'visit', id,
      'Kunjungan dibuka untuk ' + p.rmNumber + ' di ' + D.POLI_BY_ID[poli].label + ', antrian ' + q.display + '.',
      { poli: poli, kelas: v.klass, keluhan: v.complaint, kecelakaan: v.kecelakaan }
    ).then(function () {
      self.state.visits.push(v);
      self.changed();
      return { ok: true, visit: v };
    });
  };

  Clinic.prototype.assignDoctor = function (visitId, doctorId) {
    var self = this;
    var v = this.visit(visitId);
    if (!v) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Kunjungan tidak ditemukan.' });
    var doc = this.staff(doctorId);
    if (!doc || doc.role !== 'dokter') {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Staf yang dipilih bukan dokter.' });
    }
    if (['pendaftaran', 'perawat', 'dokter'].indexOf(this.actor.role) < 0) {
      return Promise.resolve({ ok: false, code: 'permission', reason: 'Peran ' + D.roleLabel(this.actor.role) + ' tidak dapat menugaskan dokter.' });
    }
    return this.log('kunjungan.dokter', 'visit', visitId,
      'Dokter penanggung jawab ditetapkan: ' + doc.name + '.', { doctorId: doctorId }
    ).then(function () {
      v.doctorId = doctorId;
      self.changed();
      return { ok: true, visit: v };
    });
  };

  Clinic.prototype.setTindakan = function (visitId, ids) {
    var self = this;
    var v = this.visit(visitId);
    if (!v) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Kunjungan tidak ditemukan.' });
    if (['dokter', 'perawat'].indexOf(this.actor.role) < 0) {
      return Promise.resolve({ ok: false, code: 'permission', reason: 'Hanya dokter atau perawat yang dapat mencatat tindakan.' });
    }
    if (['selesai', 'batal'].indexOf(v.status) >= 0) {
      return Promise.resolve({ ok: false, code: 'terminal', reason: 'Kunjungan sudah ditutup.' });
    }
    var clean = (ids || []).filter(function (i) { return D.TINDAKAN_BY_ID[i] && i !== 'none'; });
    return this.log('kunjungan.tindakan', 'visit', visitId,
      'Tindakan dicatat: ' + (clean.length ? clean.map(function (i) { return D.TINDAKAN_BY_ID[i].label; }).join(', ') : '(tidak ada)') + '.',
      { tindakan: clean }
    ).then(function () {
      v.tindakan = clean;
      self.changed();
      return { ok: true, visit: v };
    });
  };

  /* -------------------------------------------------------------- triage */

  Clinic.prototype.recordTriage = function (visitId, t) {
    var self = this;
    var denied = this.deny('triase.isi');
    if (denied) return Promise.resolve(denied);
    var v = this.visit(visitId);
    if (!v) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Kunjungan tidak ditemukan.' });
    if (v.status !== 'triase' && v.status !== 'terdaftar') {
      return Promise.resolve({
        ok: false, code: 'state',
        reason: 'Triase hanya dapat diisi saat kunjungan berstatus Terdaftar atau Triase. Status sekarang: ' + D.QUEUE[v.status].label + '.'
      });
    }
    var triage = {
      tdSistol: num(t.tdSistol), tdDiastol: num(t.tdDiastol),
      nadi: num(t.nadi), suhu: num(t.suhu), rr: num(t.rr), spo2: num(t.spo2),
      bb: num(t.bb), tb: num(t.tb),
      acuity: t.acuity || null,
      note: t.note || '',
      by: this.actor.id, at: this.now().toISOString()
    };

    // An empty form is not a green patient. Saving nothing and then labelling
    // the result "hijau" is the silent downgrade the design notes call a
    // hazard — so an unmeasured patient is refused, not graded.
    if (!D.hasMeasurement(triage)) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Tidak ada satu pun tanda vital yang terisi. Triase kosong tidak disimpan dan tidak dinilai "hijau" — pasien yang belum diukur bukan pasien yang tidak gawat.'
      });
    }
    var bad = D.checkVitalRanges(triage);
    if (bad) {
      return Promise.resolve({ ok: false, code: 'validation', field: bad.field, reason: bad.reason });
    }

    var age = this.age(this.patient(v.rmNumber));
    if (!triage.acuity) triage.acuity = D.suggestAcuity(triage, age);
    if (!triage.acuity) {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Tingkat kegawatan tidak dapat disarankan dari tanda vital yang ada. Tetapkan secara manual.' });
    }
    return this.log('triase.isi', 'visit', visitId,
      'Tanda vital dicatat, triase ' + triage.acuity + '.',
      { td: triage.tdSistol + '/' + triage.tdDiastol, nadi: triage.nadi, suhu: triage.suhu, spo2: triage.spo2, acuity: triage.acuity, usia: age }
    ).then(function () {
      v.triage = triage;
      self.changed();
      return { ok: true, visit: v, flags: D.flagVitals(triage, age, { knownHypertension: hasChronic(self.patient(v.rmNumber), 'I10') }) };
    });
  };

  function hasChronic(p, code) {
    return !!(p && p.chronic && p.chronic.indexOf(code) >= 0);
  }

  function num(x) {
    if (x === '' || x == null) return null;
    var n = Number(x);
    return isFinite(n) ? n : null;
  }

  /* ------------------------------------------------------ queue movement */

  Clinic.prototype.transition = function (visitId, to) {
    var self = this;
    var v = this.visit(visitId);
    if (!v) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Kunjungan tidak ditemukan.' });
    var verdict = D.canTransition(v, to, this.actor.role, this.ctxFor(v));
    if (!verdict.ok) {
      // A rejected transition is itself an auditable event — attempts to move a
      // patient out of turn are exactly what an auditor asks about later.
      return this.log('antrian.ditolak', 'visit', visitId,
        'Perpindahan antrian ditolak: ' + D.QUEUE[v.status].label + ' → ' + (D.QUEUE[to] ? D.QUEUE[to].label : to) + '.',
        { alasan: verdict.reason, kode: verdict.code }
      ).then(function () {
        self.changed();
        return { ok: false, code: verdict.code, reason: verdict.reason };
      });
    }
    var from = v.status;
    return this.log('antrian.pindah', 'visit', visitId,
      'Antrian ' + v.queueNo + ': ' + D.QUEUE[from].label + ' → ' + D.QUEUE[to].label + '.',
      { dari: from, ke: to }
    ).then(function () {
      v.status = to;
      v.history.push({ from: from, to: to, at: self.now().toISOString(), by: self.actor.id, role: self.actor.role });
      self.changed();
      return { ok: true, visit: v, from: from, to: to };
    });
  };

  /* ---------------------------------------------------------- encounters */

  Clinic.prototype.startEncounter = function (visitId) {
    var self = this;
    var denied = this.deny('soap.tulis');
    if (denied) return Promise.resolve(denied);
    var v = this.visit(visitId);
    if (!v) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Kunjungan tidak ditemukan.' });
    var existing = this.encounterForVisit(visitId);
    if (existing) return Promise.resolve({ ok: true, encounter: existing, existing: true });

    this.state.counters.encounter += 1;
    var id = 'E-' + v.date.replace(/-/g, '') + '-' + D.pad(this.state.counters.encounter, 4);
    var enc = {
      id: id,
      visitId: v.id,
      rmNumber: v.rmNumber,
      doctorId: v.doctorId || this.actor.id,
      status: 'draft',
      s: '',
      o: { exam: '', vitals: v.triage ? shallow(v.triage) : null },
      a: [],
      p: { plan: '', edukasi: '', kontrol: '' },
      createdAt: this.now().toISOString(),
      signedAt: null,
      signedBy: null
    };
    return this.log('soap.buat', 'encounter', id,
      'Catatan SOAP dibuat untuk kunjungan ' + v.id + '.', { visitId: v.id }
    ).then(function () {
      self.state.encounters.push(enc);
      self.changed();
      return { ok: true, encounter: enc };
    });
  };

  function shallow(o) {
    var out = {};
    Object.keys(o || {}).forEach(function (k) { out[k] = o[k]; });
    return out;
  }

  /**
   * Draft edits are free and are NOT chained one-per-keystroke — that would
   * bury the chain in noise and make it unreadable, which is its own kind of
   * failure. The draft is a working surface; the auditable event is the
   * signature. After signing, this method refuses outright.
   */
  Clinic.prototype.saveEncounter = function (encId, patch) {
    var self = this;
    var denied = this.deny('soap.tulis');
    if (denied) return Promise.resolve(denied);
    var e = this.encounter(encId);
    if (!e) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Catatan tidak ditemukan.' });
    if (e.status === 'signed') {
      return Promise.resolve({
        ok: false, code: 'immutable',
        reason: 'Catatan ini sudah ditandatangani dan tidak dapat diubah. Koreksi dilakukan dengan membuat ADENDUM, yang menggantikan nilai lama tanpa menghapusnya.'
      });
    }
    if (patch.s !== undefined) e.s = patch.s;
    if (patch.exam !== undefined) e.o.exam = patch.exam;
    if (patch.vitals !== undefined) e.o.vitals = patch.vitals;
    if (patch.a !== undefined) e.a = patch.a;
    if (patch.plan !== undefined) e.p.plan = patch.plan;
    if (patch.edukasi !== undefined) e.p.edukasi = patch.edukasi;
    if (patch.kontrol !== undefined) e.p.kontrol = patch.kontrol;
    this.changed();
    return Promise.resolve({ ok: true, encounter: e });
  };

  Clinic.prototype.signEncounter = function (encId) {
    var self = this;
    var denied = this.deny('soap.tandatangani');
    if (denied) return Promise.resolve(denied);
    var e = this.encounter(encId);
    if (!e) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Catatan tidak ditemukan.' });
    if (e.status === 'signed') {
      return Promise.resolve({ ok: false, code: 'already', reason: 'Catatan sudah ditandatangani.' });
    }
    /* A signature binds to the AUTHOR of the content, not to whoever happens
     * to be logged in. Letting dr. B sign dr. A's draft produced a note whose
     * responsible clinician and whose signatory were two different people —
     * and then locked dr. A out of amending her own note, because the addendum
     * guard compares against the signatory. A supervisor attesting to someone
     * else's note is a co-signature: a separate act, separately named and
     * separately audited, which this demo does not model. */
    if (e.doctorId && e.doctorId !== this.actor.id) {
      return Promise.resolve({
        ok: false, code: 'permission',
        reason: 'Catatan ini ditulis oleh ' + ((this.staff(e.doctorId) || {}).name || e.doctorId) +
          '. Tanda tangan melekat pada penulis isinya, bukan pada siapa pun yang sedang membuka layar. ' +
          'Ko-tanda-tangan penyelia adalah tindakan tersendiri dan tidak dimodelkan di demo ini.'
      });
    }
    if (!e.s || !String(e.s).trim()) {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Subjective (anamnesis) belum diisi.' });
    }
    if (!e.a.length) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Assessment harus memuat minimal satu diagnosis berkode ICD-10. Diagnosis dalam teks bebas tidak dapat dilaporkan dan tidak dapat diklaimkan.'
      });
    }
    var primary = e.a.filter(function (d) { return d.primary; });
    if (primary.length !== 1) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Tepat satu diagnosis harus ditandai sebagai diagnosis utama (primer). Saat ini: ' + primary.length + '.'
      });
    }
    var bad = e.a.filter(function (d) { return !R.icd.get(d.code); });
    if (bad.length) {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Kode tidak dikenal: ' + bad.map(function (d) { return d.code; }).join(', ') + '.' });
    }
    return this.log('soap.tandatangan', 'encounter', encId,
      'Catatan SOAP ditandatangani oleh ' + this.actor.name + '. Diagnosis utama ' + primary[0].code + '.',
      { diagnoses: e.a.map(function (d) { return d.code; }), primary: primary[0].code }
    ).then(function () {
      e.status = 'signed';
      e.signedAt = self.now().toISOString();
      e.signedBy = self.actor.id;
      self.changed();
      return { ok: true, encounter: e };
    });
  };

  /**
   * addAddendum — the legally interesting operation.
   *
   * It creates a NEW record that supersedes a field. The original encounter
   * object is not touched, at all, ever. A reason is mandatory: an
   * undocumented correction to a medical record is worth very little in a
   * dispute, and making the reason optional is how it ends up empty.
   */
  Clinic.prototype.addAddendum = function (encId, patch) {
    var self = this;
    var denied = this.deny('soap.addendum');
    if (denied) return Promise.resolve(denied);
    var e = this.encounter(encId);
    if (!e) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Catatan tidak ditemukan.' });
    if (e.status !== 'signed') {
      return Promise.resolve({
        ok: false, code: 'state',
        reason: 'Adendum hanya berlaku untuk catatan yang sudah ditandatangani. Catatan ini masih draf — ubah langsung saja.'
      });
    }
    if (!D.ADDENDABLE[patch.path]) {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Bagian "' + patch.path + '" tidak dapat diadendum.' });
    }
    /* WHO MAY CORRECT WHAT.
     *
     * Two separate questions, and treating them as one was the hole. A nurse
     * correcting a mistyped blood pressure is a typing correction. A nurse
     * replacing the coded diagnosis on a physician's signed note is a clinical
     * act performed by someone without the authority to perform it — and
     * because the addendum takes effect in effectiveEncounter, the record's
     * operative diagnosis would become one the nurse authored. */
    var pathVerdict = D.canAddendum(this.actor.role, patch.path);
    if (!pathVerdict.ok) {
      return Promise.resolve({ ok: false, code: 'permission', reason: pathVerdict.reason });
    }
    if (!patch.reason || !String(patch.reason).trim()) {
      return Promise.resolve({ ok: false, code: 'validation', reason: 'Alasan koreksi wajib diisi. Koreksi tanpa alasan tidak dapat dipertanggungjawabkan.' });
    }
    // Clinical content may only be amended by the clinician who signed it.
    // This check applies to EVERY actor, not just doctors: scoping it to
    // `role === 'dokter'` meant it never fired for anyone else. The nurse's
    // vitals correction is the one deliberate exception, and it is confined to
    // 'o.vitals' by the path table above.
    if (patch.path !== 'o.vitals' && e.signedBy !== this.actor.id) {
      return Promise.resolve({
        ok: false, code: 'permission',
        reason: 'Catatan ini ditandatangani oleh ' + ((this.staff(e.signedBy) || {}).name || e.signedBy) +
          '. Adendum atas isi klinis catatan orang lain memerlukan alur persetujuan yang tidak dimodelkan di demo ini.'
      });
    }

    var current = D.effectiveEncounter(e, this.state.addenda).values[patch.path];
    // An addendum that changes nothing is not a correction: it is a mandatory
    // reason, an audit entry and a "diadendum" badge attached to an unchanged
    // value. The UI could produce one by accident; the model refuses it.
    if (A.canonical(current === undefined ? null : current) === A.canonical(patch.newValue === undefined ? null : patch.newValue)) {
      return Promise.resolve({
        ok: false, code: 'no-change',
        reason: 'Isi baru sama persis dengan nilai yang berlaku sekarang. Adendum yang tidak mengubah apa pun hanya menambah kebisingan ke rekam medis dan ke rantai audit.'
      });
    }
    this.state.counters.addendum += 1;
    var id = 'ADD-' + D.pad(this.state.counters.addendum, 4);
    var add = {
      id: id,
      seq: this.state.counters.addendum,
      encounterId: encId,
      path: patch.path,
      pathLabel: D.ADDENDABLE[patch.path].label,
      oldValue: current === undefined ? null : current,
      newValue: patch.newValue,
      reason: String(patch.reason).trim(),
      by: this.actor.id, byName: this.actor.name, byRole: this.actor.role,
      at: this.now().toISOString()
    };
    return this.log('soap.adendum', 'encounter', encId,
      'Adendum ' + id + ' pada bagian ' + add.pathLabel + '. Nilai lama tetap tersimpan.',
      { addendumId: id, path: patch.path, alasan: add.reason, nilaiLama: add.oldValue, nilaiBaru: add.newValue }
    ).then(function () {
      self.state.addenda.push(add);
      self.changed();
      return { ok: true, addendum: add, encounter: e };
    });
  };

  Clinic.prototype.effective = function (encId) {
    var e = this.encounter(encId);
    if (!e) return null;
    return D.effectiveEncounter(e, this.state.addenda);
  };

  /* -------------------------------------------------------- prescription */

  Clinic.prototype.rxContext = function (visitId) {
    var v = this.visit(visitId);
    if (!v) return {};
    var p = this.patient(v.rmNumber);
    var enc = this.encounterForVisit(visitId);
    var dx = [];
    if (enc) {
      var eff = D.effectiveEncounter(enc, this.state.addenda);
      dx = (eff.values.a || []).map(function (d) { return d.code; });
    }
    (p && p.chronic ? p.chronic : []).forEach(function (c) { if (dx.indexOf(c) < 0) dx.push(c); });
    return {
      age: this.age(p),
      pregnant: !!(p && p.pregnant),
      allergies: (p && p.allergies) || [],
      diagnoses: dx
    };
  };

  Clinic.prototype.savePrescription = function (visitId, items) {
    var self = this;
    var denied = this.deny('resep.tulis');
    if (denied) return Promise.resolve(denied);
    var v = this.visit(visitId);
    if (!v) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Kunjungan tidak ditemukan.' });
    var rx = this.prescriptionForVisit(visitId);
    // A cancelled prescription is history, not a working draft: writing again
    // starts a NEW prescription beside it rather than editing it back to life.
    if (rx && rx.status === 'dibatalkan') rx = null;
    if (rx && rx.status !== 'draft') {
      return Promise.resolve({
        ok: false, code: 'immutable',
        reason: 'Resep ' + rx.id + ' sudah ditandatangani (status: ' + rx.status + ') dan tidak dapat disunting. ' +
          'Untuk mengubah terapi: batalkan resep ini dengan alasan tertulis — tombol "Batalkan resep" — lalu tulis resep baru. ' +
          'Pembatalan tidak menghapus apa pun; resep lama tetap terbaca beserta alasannya.'
      });
    }
    if (!rx) {
      this.state.counters.prescription += 1;
      rx = {
        id: 'RX-' + v.date.replace(/-/g, '') + '-' + D.pad(this.state.counters.prescription, 4),
        visitId: v.id, rmNumber: v.rmNumber,
        encounterId: (this.encounterForVisit(visitId) || {}).id || null,
        items: [], status: 'draft', overrides: [],
        signedBy: null, signedAt: null,
        reviewedBy: null, reviewedAt: null, reviewNote: '',
        dispensedBy: null, dispensedAt: null, substitutions: []
      };
      this.state.prescriptions.push(rx);
    }
    rx.items = (items || []).slice();
    this.changed();
    return Promise.resolve({ ok: true, prescription: rx, safety: R.rx.check(rx.items, this.rxContext(visitId)) });
  };

  /**
   * signPrescription — where the safety engine gets teeth.
   *
   * kontraindikasi findings refuse outright and there is no override argument
   * that gets past them. mayor findings require a typed clinical reason, which
   * is stored on the prescription AND written into the chain as a separate
   * entry naming the prescriber — so "the system let me" is not available as a
   * defence later.
   */
  Clinic.prototype.signPrescription = function (rxId, opts) {
    var self = this;
    opts = opts || {};
    var denied = this.deny('resep.tandatangani');
    if (denied) return Promise.resolve(denied);
    var rx = this.prescription(rxId);
    if (!rx) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Resep tidak ditemukan.' });
    if (rx.status !== 'draft') return Promise.resolve({ ok: false, code: 'already', reason: 'Resep sudah ditandatangani.' });
    if (!rx.items.length) return Promise.resolve({ ok: false, code: 'validation', reason: 'Resep kosong.' });

    var enc = this.encounterForVisit(rx.visitId);
    if (!enc || enc.status !== 'signed') {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Catatan SOAP harus ditandatangani lebih dulu. Resep tanpa diagnosis terekam tidak dapat ditelaah apoteker.'
      });
    }

    var safety = R.rx.check(rx.items, this.rxContext(rx.visitId));
    // Clerical block, worded as one. An unfinished signa is not an absolute
    // contraindication and must not be announced as one.
    if (safety.incomplete.length) {
      return Promise.resolve({
        ok: false, code: 'incomplete', safety: safety,
        reason: 'Resep belum lengkap: ' + safety.incomplete.length + ' baris tanpa aturan pakai yang utuh. ' +
          safety.incomplete.map(function (f) { return f.title; }).join('; ') + '.'
      });
    }
    if (safety.blocking.length) {
      return this.log('resep.ditolak', 'prescription', rxId,
        'Penandatanganan resep ditolak oleh pemeriksaan keamanan (' + safety.blocking.length + ' kontraindikasi).',
        { temuan: safety.blocking.map(function (f) { return f.title; }) }
      ).then(function () {
        self.changed();
        return {
          ok: false, code: 'contraindicated', safety: safety,
          reason: 'Resep tidak dapat ditandatangani: ' + safety.blocking.length +
            ' kontraindikasi absolut. ' + safety.blocking.map(function (f) { return f.title; }).join('; ') + '.'
        };
      });
    }

    var need = safety.overridable;
    var reason = (opts.overrideReason || '').trim();
    if (need.length && reason.length < 10) {
      return Promise.resolve({
        ok: false, code: 'override-required', safety: safety,
        reason: 'Terdapat ' + need.length + ' peringatan tingkat MAYOR. Resep hanya dapat ditandatangani setelah alasan klinis ditulis (minimal 10 karakter). Alasan tersebut dicatat dalam jejak audit atas nama penulis resep.'
      });
    }

    var chainOps = [];
    if (need.length) {
      chainOps.push(function () {
        return self.log('resep.override', 'prescription', rxId,
          'Peringatan mayor di-override oleh ' + self.actor.name + ' dengan alasan klinis tertulis.',
          { temuan: need.map(function (f) { return f.title; }), alasan: reason }
        );
      });
    }
    chainOps.push(function () {
      return self.log('resep.tandatangan', 'prescription', rxId,
        'Resep ditandatangani: ' + rx.items.length + ' item.',
        {
          items: rx.items.map(function (i) {
            var d = R.rx.drug(i.drugId);
            return (d ? d.name : i.drugId) + ' ' + i.dose + ' ' + i.freq + ' × ' + i.days + ' hari';
          })
        }
      );
    });

    return chainOps.reduce(function (p, op) { return p.then(op); }, Promise.resolve())
      .then(function () {
        rx.status = 'signed';
        rx.signedBy = self.actor.id;
        rx.signedAt = self.now().toISOString();
        if (need.length) {
          rx.overrides = need.map(function (f) {
            return { rule: f.rule, title: f.title, sev: f.sev, reason: reason, by: self.actor.id, at: rx.signedAt };
          });
        }
        self.changed();
        return { ok: true, prescription: rx, safety: safety };
      });
  };

  /**
   * cancelPrescription — the exit that the refusal message used to name and
   * the system did not have.
   *
   * A signed prescription with the wrong drug on it was previously a dead end:
   * it could not be edited, could not be cancelled, and the queue guard would
   * not let the visit reach the cashier while it existed. Cancellation is a
   * chained, attributed, reasoned act — the prescriber withdraws their own
   * order, or the pharmacist returns it to the prescriber — and it never
   * deletes: the cancelled prescription stays readable with its reason.
   */
  Clinic.prototype.cancelPrescription = function (rxId, reason) {
    var self = this;
    var rx = this.prescription(rxId);
    if (!rx) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Resep tidak ditemukan.' });
    if (rx.status === 'dibatalkan') {
      return Promise.resolve({ ok: false, code: 'already', reason: 'Resep ini sudah dibatalkan.' });
    }
    if (rx.status === 'diserahkan') {
      return Promise.resolve({
        ok: false, code: 'state',
        reason: 'Obat sudah diserahkan kepada pasien. Yang sudah keluar dari apotek tidak dapat "dibatalkan" — yang berlaku adalah pencatatan penghentian terapi pada catatan kunjungan berikutnya.'
      });
    }
    var role = this.actor.role;
    if (role === 'dokter') {
      if (rx.signedBy && rx.signedBy !== this.actor.id) {
        return Promise.resolve({
          ok: false, code: 'permission',
          reason: 'Resep ini ditandatangani oleh ' + ((this.staff(rx.signedBy) || {}).name || rx.signedBy) + '. Dokter hanya membatalkan resepnya sendiri.'
        });
      }
    } else if (role !== 'apoteker') {
      return Promise.resolve({
        ok: false, code: 'permission',
        reason: 'Peran ' + D.roleLabel(role) + ' tidak dapat membatalkan resep. Pembatalan dilakukan oleh dokter penulisnya, atau oleh apoteker yang mengembalikan resep kepada penulisnya.'
      });
    }
    if (!reason || String(reason).trim().length < 5) {
      return Promise.resolve({
        ok: false, code: 'validation',
        reason: 'Alasan pembatalan wajib ditulis (minimal 5 karakter). Resep yang hilang tanpa keterangan tidak dapat dipertanggungjawabkan.'
      });
    }
    var before = rx.status;
    return this.log('resep.batal', 'prescription', rxId,
      'Resep dibatalkan oleh ' + this.actor.name + ' (' + D.roleLabel(role) + '). Isi resep tetap tersimpan.',
      { statusSebelum: before, alasan: String(reason).trim(), items: rx.items.length }
    ).then(function () {
      rx.status = 'dibatalkan';
      rx.cancelledBy = self.actor.id;
      rx.cancelledAt = self.now().toISOString();
      rx.cancelReason = String(reason).trim();
      self.changed();
      return { ok: true, prescription: rx };
    });
  };

  Clinic.prototype.reviewPrescription = function (rxId, note) {
    var self = this;
    var denied = this.deny('resep.telaah');
    if (denied) return Promise.resolve(denied);
    var rx = this.prescription(rxId);
    if (!rx) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Resep tidak ditemukan.' });
    if (rx.status !== 'signed') {
      return Promise.resolve({ ok: false, code: 'state', reason: 'Resep belum ditandatangani dokter (status: ' + rx.status + ').' });
    }
    return this.log('resep.telaah', 'prescription', rxId,
      'Telaah resep oleh apoteker selesai.', { catatan: note || '' }
    ).then(function () {
      rx.status = 'ditelaah';
      rx.reviewedBy = self.actor.id;
      rx.reviewedAt = self.now().toISOString();
      rx.reviewNote = note || '';
      self.changed();
      return { ok: true, prescription: rx };
    });
  };

  Clinic.prototype.dispense = function (rxId, opts) {
    var self = this;
    opts = opts || {};
    var denied = this.deny('resep.serahkan');
    if (denied) return Promise.resolve(denied);
    var rx = this.prescription(rxId);
    if (!rx) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Resep tidak ditemukan.' });
    if (rx.status !== 'ditelaah') {
      return Promise.resolve({
        ok: false, code: 'state',
        reason: 'Obat hanya boleh diserahkan setelah telaah resep. Status sekarang: ' + rx.status + '.'
      });
    }
    return this.log('resep.serah', 'prescription', rxId,
      'Obat diserahkan kepada pasien oleh ' + this.actor.name + '.',
      { substitusi: opts.substitutions || [], catatan: opts.note || '' }
    ).then(function () {
      rx.status = 'diserahkan';
      rx.dispensedBy = self.actor.id;
      rx.dispensedAt = self.now().toISOString();
      rx.substitutions = opts.substitutions || [];
      self.changed();
      return { ok: true, prescription: rx };
    });
  };

  /* -------------------------------------------------------------- kasir */

  Clinic.prototype.closeBill = function (visitId) {
    var self = this;
    var denied = this.deny('kasir.tutup');
    if (denied) return Promise.resolve(denied);
    var v = this.visit(visitId);
    if (!v) return Promise.resolve({ ok: false, code: 'not-found', reason: 'Kunjungan tidak ditemukan.' });
    if (v.status !== 'kasir') {
      return Promise.resolve({
        ok: false, code: 'state',
        reason: 'Tagihan hanya dapat ditutup saat kunjungan berada di Kasir. Status sekarang: ' + D.QUEUE[v.status].label + '.'
      });
    }
    var bill = D.computeBill(v, this.prescriptionForVisit(visitId));
    return this.log('kasir.tutup', 'visit', visitId,
      'Tagihan ditutup. Total tarif ' + D.rupiah(bill.totalTarif) + ', dibayar pasien ' + D.rupiah(bill.dibayarPasien) + '.',
      { totalTarif: bill.totalTarif, ditanggung: bill.ditanggung, dibayarPasien: bill.dibayarPasien, kelas: v.klass }
    ).then(function () {
      v.billing = bill;
      v.billedAt = self.now().toISOString();
      self.changed();
      return { ok: true, visit: v, bill: bill };
    });
  };

  /* ------------------------------------------------------------- audit */

  Clinic.prototype.verifyChain = function () {
    return A.verify(this.chain.entries);
  };

  Clinic.prototype.auditFor = function (entity, entityId) {
    return this.chain.entries.filter(function (e) {
      return e.entity === entity && e.entityId === String(entityId);
    });
  };

  /* -------------------------------------------------- serialisation */

  Clinic.prototype.snapshot = function () {
    return {
      counters: this.state.counters,
      patients: this.state.patients,
      staff: this.state.staff,
      visits: this.state.visits,
      encounters: this.state.encounters,
      addenda: this.state.addenda,
      prescriptions: this.state.prescriptions
    };
  };

  R.Clinic = Clinic;
  R.todayISO = todayISO;
})(typeof self !== 'undefined' ? self : this);
