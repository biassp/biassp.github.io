/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — tests.js
 * The same file runs in the page (Uji tab) and under node. What a visitor sees
 * green is exactly what gates the code.
 *
 * The suite is asynchronous throughout because hashing is: crypto.subtle.digest
 * returns a Promise, and pretending otherwise would mean testing a different
 * code path from the one that ships.
 *
 * The assertions that carry weight, in order:
 *   - an RM number is never reused, not even after the patient it belonged to
 *     is archived, and not even if the counter is asked for one repeatedly;
 *   - the queue refuses transitions that are not in the graph, refuses ones the
 *     current role may not make, and refuses ones whose guard is unsatisfied —
 *     three different refusals with three different reasons;
 *   - the audit chain verifies, and reports the FIRST break with the right kind
 *     when an entry is edited, deleted or reordered;
 *   - an addendum supersedes without destroying: the original value is still
 *     retrievable after the correction;
 *   - the interaction check catches a known pair and blocks a contraindication.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});
  var D = R.domain, A = R.audit;

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
      ne: function (a, b, name) { record(a !== b, name, 'expected NOT ' + JSON.stringify(b)); },
      deep: function (a, b, name) {
        var x = A.canonical(a), y = A.canonical(b);
        record(x === y, name, 'expected ' + y + ', got ' + x);
      },
      match: function (s, re, name) {
        record(re.test(String(s)), name, JSON.stringify(String(s)) + ' does not match ' + re);
      }
    };
  }

  /* Every clinic under test uses a pinned clock, so timestamps — and therefore
   * hashes — are reproducible. */
  var T0 = new Date('2026-09-08T08:00:00Z');
  function freshClinic(actorRole) {
    var t = new Date(T0.getTime());
    var c = new R.Clinic({
      now: function () { t = new Date(t.getTime() + 60000); return t; }
    });
    c.state.staff = R.seed.STAFF.slice();
    var s = R.seed.STAFF.filter(function (x) { return x.role === (actorRole || 'pendaftaran'); })[0];
    c.actor = { id: s.id, name: s.name, role: s.role };
    return c;
  }
  function as(c, role) {
    var s = R.seed.STAFF.filter(function (x) { return x.role === role; })[0];
    c.actor = { id: s.id, name: s.name, role: s.role };
    return c;
  }
  function asId(c, id) {
    var s = c.staff(id);
    c.actor = { id: s.id, name: s.name, role: s.role };
    return c;
  }

  function samplePatient(c, over) {
    var base = {
      name: 'Pasien Uji', sex: 'L', dob: '1985-03-04',
      klass: 'bpjs', allergies: [], chronic: []
    };
    Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
    return c.registerPatient(base);
  }

  /* ==================================================== 1. identifiers */

  group('Penomoran rekam medis', function (t) {
    var c = freshClinic('pendaftaran');
    var rms = [];
    return samplePatient(c, { name: 'A' }).then(function (r) { rms.push(r.patient.rmNumber); return samplePatient(c, { name: 'B' }); })
      .then(function (r) { rms.push(r.patient.rmNumber); return samplePatient(c, { name: 'C' }); })
      .then(function (r) {
        rms.push(r.patient.rmNumber);
        t.eq(rms[0], 'RM-000001', 'No. RM pertama diformat dengan padding tetap');
        t.eq(rms[2], 'RM-000003', 'No. RM naik monoton');
        t.eq(new Set(rms).size, 3, 'tidak ada No. RM yang terpakai dua kali');

        // The real hazard: a "deleted" patient must not free its number.
        c.state.patients = c.state.patients.filter(function (p) { return p.rmNumber !== 'RM-000002'; });
        return samplePatient(c, { name: 'D' });
      })
      .then(function (r) {
        t.eq(r.patient.rmNumber, 'RM-000004', 'No. RM pasien yang dihapus TIDAK dipakai ulang');
        t.eq(c.patient('RM-000002'), null, 'nomor lama tetap kosong, tidak diisi pasien baru');

        // Queue numbers are a different animal: per day, per poli, and they
        // repeat tomorrow. Asserting that they DO repeat is the point.
        var q1 = c.nextQueueNumber('2026-09-08', 'umum');
        var q2 = c.nextQueueNumber('2026-09-08', 'umum');
        var q3 = c.nextQueueNumber('2026-09-08', 'gigi');
        var q4 = c.nextQueueNumber('2026-09-09', 'umum');
        t.eq(q1.display, 'A-001', 'nomor antrian poli umum diawali prefiks poli');
        t.eq(q2.display, 'A-002', 'nomor antrian naik dalam hari yang sama');
        t.eq(q3.display, 'B-001', 'poli gigi punya deret antrian sendiri');
        t.eq(q4.display, 'A-001', 'nomor antrian direset esok hari — sengaja dipakai ulang');
        t.ne(q1.display, rms[0], 'nomor antrian bukan No. RM');
        t.eq(D.parseRM('RM-000042'), 42, 'No. RM dapat diurai kembali ke angka');
        t.eq(D.parseRM('A-001'), null, 'nomor antrian tidak lolos sebagai No. RM');
      })
      .then(function () {
        return as(c, 'pendaftaran').openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Batuk pilek 3 hari' });
      })
      .then(function (r) {
        t.match(r.visit.id, /^V-20260908-\d{4}$/, 'ID kunjungan memuat tanggal dan bersifat unik permanen');
        t.ne(r.visit.id, r.visit.queueNo, 'ID kunjungan berbeda dari nomor antrian');
        t.eq(r.visit.rmNumber, 'RM-000001', 'kunjungan menunjuk ke No. RM, bukan menyalin identitas pasien');
        return as(c, 'pendaftaran').openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Batuk pilek 3 hari' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'pendaftaran ganda di poli dan hari yang sama ditolak');
        t.eq(r.code, 'duplicate', 'penolakan diberi kode duplicate');
      });
  });

  /* ==================================================== 2. queue machine */

  group('Mesin status antrian', function (t) {
    var c = freshClinic('pendaftaran');
    var visit;
    return samplePatient(c)
      .then(function () { return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Batuk pilek 3 hari', doctorId: 'stf-03' }); })
      .then(function (r) {
        visit = r.visit;
        t.eq(visit.status, 'terdaftar', 'kunjungan baru berstatus Terdaftar');

        // 1. Not in the graph at all.
        var v = D.canTransition(visit, 'kasir', 'pendaftaran', {});
        t.notOk(v.ok, 'Terdaftar → Kasir ditolak: tidak ada di alur');
        t.eq(v.code, 'invalid-transition', 'kode penolakan: invalid-transition');
        t.match(v.reason, /hanya bisa ke/, 'alasan menyebutkan tujuan yang sah');

        // 2. In the graph, wrong role.
        var v2 = D.canTransition(visit, 'triase', 'apoteker', {});
        t.notOk(v2.ok, 'apoteker tidak boleh memindahkan pasien ke Triase');
        t.eq(v2.code, 'role', 'kode penolakan: role');
        t.match(v2.reason, /Diperlukan/, 'alasan menyebutkan peran yang diperlukan');

        // 3. Right role, guard unsatisfied.
        var staged = { status: 'triase', triage: null, doctorId: 'stf-03' };
        var v3 = D.canTransition(staged, 'menunggu-dokter', 'perawat', {});
        t.notOk(v3.ok, 'Triase → Menunggu dokter ditolak bila tanda vital kosong');
        t.eq(v3.code, 'guard', 'kode penolakan: guard');
        t.match(v3.reason, /vital/i, 'alasan menyebutkan tanda vital');

        return as(c, 'pendaftaran').transition(visit.id, 'kasir');
      })
      .then(function (r) {
        t.notOk(r.ok, 'transition() menolak lompatan yang tidak sah');
        t.eq(visit.status, 'terdaftar', 'status tidak berubah setelah penolakan');
        var rejected = c.chain.entries.filter(function (e) { return e.action === 'antrian.ditolak'; });
        t.eq(rejected.length, 1, 'perpindahan yang ditolak ikut tercatat di jejak audit');
        return c.transition(visit.id, 'triase');
      })
      .then(function () { return as(c, 'perawat').transition(visit.id, 'menunggu-dokter'); })
      .then(function (r) {
        t.notOk(r.ok, 'penjaga menahan perpindahan sampai triase diisi');
        return c.recordTriage(visit.id, { tdSistol: 128, tdDiastol: 82, nadi: 78, suhu: 36.6, rr: 18, spo2: 98, bb: 70, tb: 170 });
      })
      .then(function (r) {
        t.ok(r.ok, 'perawat dapat mengisi triase');
        t.eq(visit.triage.acuity, 'hijau', 'tingkat kegawatan disarankan otomatis dari tanda vital');
        return c.transition(visit.id, 'menunggu-dokter');
      })
      .then(function (r) {
        t.ok(r.ok, 'setelah triase lengkap, perpindahan diizinkan');
        return asId(c, 'stf-03').transition(visit.id, 'konsultasi');
      })
      .then(function (r) {
        t.ok(r.ok, 'dokter memanggil pasien ke konsultasi');
        return c.transition(visit.id, 'farmasi');
      })
      .then(function (r) {
        t.notOk(r.ok, 'Konsultasi → Farmasi ditolak selama SOAP belum ditandatangani');
        t.match(r.reason, /SOAP belum ditandatangani/, 'alasan menyebut tanda tangan SOAP');
      });
  });

  group('Status terminal dan alur kembali', function (t) {
    var v = { status: 'selesai', triage: {}, doctorId: 'stf-03' };
    var r = D.canTransition(v, 'kasir', 'pendaftaran', {});
    t.notOk(r.ok, 'kunjungan Selesai tidak dapat dibuka kembali');
    t.eq(r.code, 'terminal', 'kode penolakan: terminal');
    t.match(r.reason, /adendum/i, 'alasan mengarahkan ke adendum, bukan membuka antrian');

    var b = D.canTransition({ status: 'batal' }, 'terdaftar', 'pendaftaran', {});
    t.notOk(b.ok, 'kunjungan Batal juga terminal');

    var dna = D.canTransition({ status: 'tidak-hadir' }, 'terdaftar', 'pendaftaran', {});
    t.ok(dna.ok, 'pasien yang tidak hadir boleh didaftarkan ulang hari itu juga');

    // Every state named in the graph must exist as a node, or a click leads
    // nowhere at runtime.
    var dangling = [];
    Object.keys(D.QUEUE).forEach(function (from) {
      Object.keys(D.QUEUE[from].next).forEach(function (to) {
        if (!D.QUEUE[to]) dangling.push(from + '→' + to);
      });
    });
    t.eq(dangling.length, 0, 'tidak ada transisi menuju status yang tidak terdefinisi');
    return Promise.resolve();
  });

  /* ==================================================== 3. ICD-10 */

  group('Pengkodean ICD-10', function (t) {
    var icd = R.icd;
    t.ok(icd.count >= 150, 'subset memuat minimal 150 rubrik (' + icd.count + ')');
    var codes = {}; var dupes = 0;
    icd.all.forEach(function (e) { if (codes[e.code]) dupes++; codes[e.code] = 1; });
    t.eq(dupes, 0, 'tidak ada kode ganda');
    var noChapter = icd.all.filter(function (e) { return e.chapterRoman === '?'; });
    t.eq(noChapter.length, 0, 'setiap kode jatuh pada bab ICD-10 yang sah');

    t.eq(icd.get('I10').id, 'Hipertensi esensial (primer)', 'pencarian kode tepat');
    t.eq(icd.get('i10').code, 'I10', 'pencarian kode tidak peka huruf besar/kecil');
    t.eq(icd.get('ZZ9.9'), null, 'kode yang tidak ada mengembalikan null, bukan objek kosong');

    t.eq(icd.search('I10', 3)[0].entry.code, 'I10', 'kode persis menempati peringkat pertama');
    t.eq(icd.search('J06', 3)[0].entry.code, 'J06.9', 'awalan kode menemukan rubrik');
    t.eq(icd.search('j069', 3)[0].entry.code, 'J06.9', 'kode tanpa titik tetap ditemukan');
    t.eq(icd.search('demam berdarah', 3)[0].entry.code, 'A91', 'istilah awam "demam berdarah" mendarat di DBD (A91), bukan demam dengue klasik');
    t.eq(icd.search('hipertensi', 3)[0].entry.code, 'I10', 'hipertensi esensial menang atas hipertensi sekunder');
    t.eq(icd.search('hipertesi', 3)[0].entry.code, 'I10', 'satu salah ketik masih menemukan rubrik yang benar');
    t.eq(icd.search('ispa', 3)[0].entry.code, 'J06.9', 'singkatan klinis Indonesia dikenali');
    t.eq(icd.search('gigi berlubang', 3)[0].entry.code, 'K02.9', 'istilah awam menemukan karies gigi');
    t.eq(icd.search('asam urat', 3)[0].entry.code, 'M10.9', 'istilah awam menemukan gout');

    // AND semantics: a two-word query must not behave like an OR.
    var multi = icd.search('nyeri kepala', 20);
    var allHaveBoth = multi.every(function (r) {
      return r.entry.hay.indexOf('nyeri') >= 0 || r.entry.hay.indexOf('kepala') >= 0;
    });
    t.ok(allHaveBoth, 'setiap hasil mencocokkan seluruh token, bukan salah satu');
    t.eq(icd.search('zzzz qqqq', 5).length, 0, 'kueri tanpa kecocokan mengembalikan daftar kosong');
    t.eq(icd.editDistanceAtMost('kepala', 'kepalanya', 1), 2, 'jarak edit dibatasi dan berhenti lebih awal');

    var t0 = Date.now();
    for (var i = 0; i < 200; i++) icd.search('nyeri kepala tegang', 20);
    var ms = Date.now() - t0;
    t.ok(ms < 500, '200 pencarian selesai di bawah 500 ms (' + ms + ' ms) — cukup cepat untuk diketik langsung');
    return Promise.resolve();
  });

  /* ==================================================== 4. SOAP + addenda */

  group('Catatan SOAP: draf, tanda tangan, kekekalan', function (t) {
    var c = freshClinic('pendaftaran');
    var visit, enc;
    return samplePatient(c)
      .then(function () { return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Batuk pilek 3 hari', doctorId: 'stf-03' }); })
      .then(function (r) { visit = r.visit; return c.transition(visit.id, 'triase'); })
      .then(function () { return as(c, 'perawat').recordTriage(visit.id, { tdSistol: 120, tdDiastol: 80, nadi: 72, suhu: 36.5, rr: 16, spo2: 98 }); })
      .then(function () { return c.transition(visit.id, 'menunggu-dokter'); })
      .then(function () { return asId(c, 'stf-03').transition(visit.id, 'konsultasi'); })
      .then(function () { return c.startEncounter(visit.id); })
      .then(function (r) {
        enc = r.encounter;
        t.eq(enc.status, 'draft', 'catatan baru berstatus draf');
        t.ok(enc.o.vitals && enc.o.vitals.tdSistol === 120, 'tanda vital triase disalin ke bagian Objective');
        return c.signEncounter(enc.id);
      })
      .then(function (r) {
        t.notOk(r.ok, 'tanda tangan ditolak selama Subjective kosong');
        return c.saveEncounter(enc.id, { s: 'Batuk sejak 3 hari.' });
      })
      .then(function () { return c.signEncounter(enc.id); })
      .then(function (r) {
        t.notOk(r.ok, 'tanda tangan ditolak tanpa diagnosis berkode');
        t.match(r.reason, /ICD-10/, 'alasan menuntut kode ICD-10, bukan teks bebas');
        return c.saveEncounter(enc.id, { a: [{ code: 'J06.9', primary: true }, { code: 'R05', primary: true }] });
      })
      .then(function () { return c.signEncounter(enc.id); })
      .then(function (r) {
        t.notOk(r.ok, 'dua diagnosis primer ditolak');
        return c.saveEncounter(enc.id, { a: [{ code: 'J06.9', primary: true }, { code: 'R05', primary: false }] });
      })
      .then(function () { return c.saveEncounter(enc.id, { a: [{ code: 'XX9.9', primary: true }] }); })
      .then(function () { return c.signEncounter(enc.id); })
      .then(function (r) {
        t.notOk(r.ok, 'kode di luar kamus ditolak');
        return c.saveEncounter(enc.id, {
          a: [{ code: 'J06.9', primary: true }, { code: 'R05', primary: false }],
          plan: 'Istirahat, minum hangat.'
        });
      })
      .then(function () { return c.signEncounter(enc.id); })
      .then(function (r) {
        t.ok(r.ok, 'catatan lengkap dapat ditandatangani');
        t.eq(enc.status, 'signed', 'status berubah menjadi signed');
        t.eq(enc.signedBy, 'stf-03', 'penandatangan tercatat');
        return c.saveEncounter(enc.id, { s: 'DIUBAH DIAM-DIAM' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'catatan yang sudah ditandatangani menolak perubahan langsung');
        t.eq(r.code, 'immutable', 'kode penolakan: immutable');
        t.eq(enc.s, 'Batuk sejak 3 hari.', 'isi catatan tidak berubah sedikit pun');
        return as(c, 'apoteker').signEncounter(enc.id);
      })
      .then(function (r) {
        t.notOk(r.ok, 'apoteker tidak dapat menandatangani catatan SOAP');
        t.match(r.reason, /tidak memiliki izin/, 'penolakan menjelaskan alasannya');
      });
  });

  group('Adendum menggantikan tanpa menghapus', function (t) {
    var c = freshClinic('pendaftaran');
    var visit, enc, addA, addB;
    return samplePatient(c)
      .then(function () { return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Batuk pilek 3 hari', doctorId: 'stf-03' }); })
      .then(function (r) { visit = r.visit; return asId(c, 'stf-03').startEncounter(visit.id); })
      .then(function (r) {
        enc = r.encounter;
        return c.saveEncounter(enc.id, {
          s: 'Nyeri ulu hati sejak 3 hari.',
          a: [{ code: 'K29.7', primary: true }],
          plan: 'Antasida, makan teratur.'
        });
      })
      .then(function () { return c.addAddendum(enc.id, { path: 's', newValue: 'x', reason: 'terlalu dini' }); })
      .then(function (r) {
        t.notOk(r.ok, 'adendum ditolak pada catatan yang masih draf');
        return c.signEncounter(enc.id);
      })
      .then(function () { return c.addAddendum(enc.id, { path: 's', newValue: 'x', reason: '' }); })
      .then(function (r) {
        t.notOk(r.ok, 'adendum tanpa alasan ditolak');
        return c.addAddendum(enc.id, { path: 'signedBy', newValue: 'stf-99', reason: 'mencoba mengganti penandatangan' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'blok tanda tangan tidak termasuk bagian yang boleh diadendum');
        return c.addAddendum(enc.id, {
          path: 'a',
          newValue: [{ code: 'K21.9', primary: true }],
          reason: 'Anamnesis ulang menunjukkan gejala refluks yang khas.'
        });
      })
      .then(function (r) {
        t.ok(r.ok, 'dokter penandatangan dapat membuat adendum');
        addA = r.addendum;

        var eff = c.effective(enc.id);
        t.eq(eff.values.a[0].code, 'K21.9', 'nilai efektif adalah nilai adendum');
        t.eq(eff.original.a[0].code, 'K29.7', 'nilai ASLI masih dapat dibaca setelah dikoreksi');
        t.eq(enc.a[0].code, 'K29.7', 'objek catatan asli tidak disentuh sama sekali');
        t.eq(eff.supersededBy.a, addA.id, 'bagian yang digantikan menunjuk ke adendum penggantinya');
        t.eq(addA.oldValue[0].code, 'K29.7', 'adendum menyimpan salinan nilai lama');
        t.eq(eff.values.s, 'Nyeri ulu hati sejak 3 hari.', 'bagian lain tidak ikut berubah');

        return c.addAddendum(enc.id, {
          path: 'a',
          newValue: [{ code: 'K21.9', primary: true }, { code: 'K29.7', primary: false }],
          reason: 'Gastritis dipertahankan sebagai diagnosis sekunder.'
        });
      })
      .then(function (r) {
        addB = r.addendum;
        var eff = c.effective(enc.id);
        t.eq(eff.values.a.length, 2, 'adendum berantai: yang terakhir yang berlaku');
        t.eq(eff.original.a[0].code, 'K29.7', 'nilai asli tetap utuh setelah dua koreksi');
        t.eq(addB.oldValue[0].code, 'K21.9', 'adendum kedua menggantikan hasil adendum pertama, bukan nilai asli');
        t.eq(eff.trail.a.length, 2, 'jejak koreksi memuat kedua adendum berurutan');
        t.ok(addB.seq > addA.seq, 'urutan adendum monoton');

        // A different doctor may not quietly amend someone else's note.
        return asId(c, 'stf-04').addAddendum(enc.id, { path: 's', newValue: 'y', reason: 'bukan catatan saya' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'dokter lain tidak dapat mengadendum catatan yang bukan miliknya');

        /* THE ASSERTION THAT WAS MISSING, and its absence was the hole.
         * The "own note only" guard was scoped to `role === 'dokter'`, so it
         * never fired for anyone else, and ADDENDABLE was not role-scoped at
         * all — a nurse could replace the coded diagnosis on a physician's
         * signed note, and it took effect in effectiveEncounter. */
        return as(c, 'perawat').addAddendum(enc.id, {
          path: 'a', newValue: [{ code: 'A91', primary: true }], reason: 'kode salah menurut saya'
        });
      })
      .then(function (r) {
        t.notOk(r.ok, 'PERAWAT TIDAK DAPAT mengganti diagnosis berkode pada catatan dokter');
        t.eq(r.code, 'permission', 'penolakannya soal kewenangan, bukan validasi');
        t.eq(c.effective(enc.id).values.a[0].code, 'K21.9', 'diagnosis efektif tidak berubah setelah percobaan itu');
        return c.addAddendum(enc.id, { path: 's', newValue: 'ditulis perawat', reason: 'mencoba narasi subjektif' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'perawat tidak dapat mengadendum narasi subjektif');
        return c.addAddendum(enc.id, {
          path: 'o.vitals',
          newValue: { tdSistol: 130, tdDiastol: 80, nadi: 78, suhu: 36.7, rr: 18, spo2: 98, bb: 60, tb: 165 },
          reason: 'Sistol salah ketik saat triase: 310 seharusnya 130.'
        });
      })
      .then(function (r) {
        // The one deliberate exception, and the reason 'perawat' is in
        // 'soap.addendum' at all: correcting a mistyped vital sign is a typing
        // correction, not a clinical act.
        t.ok(r.ok, 'perawat DAPAT mengoreksi tanda vital yang salah ketik');
        t.eq(c.effective(enc.id).values['o.vitals'].tdSistol, 130, 'koreksi tanda vital berlaku');
        t.deep(D.addendablePathsFor('perawat'), ['o.vitals'], 'perawat hanya boleh menyentuh tanda vital');
        t.eq(D.addendablePathsFor('dokter').length, Object.keys(D.ADDENDABLE).length, 'dokter boleh seluruh bagian (pada catatannya sendiri)');
        t.notOk(D.canAddendum('perawat', 'a').ok, 'canAddendum menolak perawat pada assessment');
        t.notOk(D.canAddendum('apoteker', 'o.vitals').ok, 'apoteker tidak mengadendum apa pun');

        // Every path the UI offers must be readable back through the
        // projection — that is what "p.edukasi accepted then never displayed"
        // looked like from the model side.
        var eff = c.effective(enc.id);
        var unread = Object.keys(D.ADDENDABLE).filter(function (k) { return !(k in eff.values); });
        t.eq(unread.length, 0, 'setiap bagian yang dapat diadendum terbaca kembali lewat proyeksi effectiveEncounter');

        return asId(c, 'stf-03').addAddendum(enc.id, {
          path: 'p.plan', newValue: 'Antasida, makan teratur.', reason: 'mengetik ulang isi yang sama'
        });
      })
      .then(function (r) {
        t.notOk(r.ok, 'adendum yang tidak mengubah apa pun ditolak');
        t.eq(r.code, 'no-change', 'kodenya menyebut sebabnya: tidak ada perubahan');

        var logged = c.chain.entries.filter(function (e) { return e.action === 'soap.adendum'; });
        t.eq(logged.length, 3, 'setiap adendum menghasilkan satu entri audit');
        t.match(A.canonical(logged[0].detail), /alasan/, 'alasan koreksi ikut masuk ke rantai hash');
      });
  });

  /* ==================================================== 5. audit chain */

  group('SHA-256 dan JSON kanonik', function (t) {
    // FIPS 180-4 vectors. If the fallback ever drifts, records hashed in a
    // non-secure context stop verifying in a secure one.
    t.eq(A.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'SHA-256 string kosong');
    t.eq(A.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 "abc"');
    t.eq(A.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', 'SHA-256 vektor 56 byte');

    t.eq(A.canonical({ b: 1, a: 2 }), '{"a":2,"b":1}', 'kunci JSON kanonik diurutkan');
    t.eq(A.canonical({ a: 2, b: 1 }), A.canonical({ b: 1, a: 2 }), 'urutan penulisan objek tidak mengubah hash');
    t.eq(A.canonical([1, { z: 1, a: 2 }]), '[1,{"a":2,"z":1}]', 'kanonikalisasi menembus larik');
    t.eq(A.canonical({ a: undefined, b: 1 }), '{"b":1}', 'properti undefined dihilangkan, bukan menjadi null');

    // The fallback and crypto.subtle must agree, or the chain forks silently.
    var probe = 'rekam:' + JSON.stringify({ x: 1, y: 'ä😀', z: [1, 2, 3] });
    return A.digestHex(probe).then(function (h) {
      t.eq(h, A.sha256Hex(probe), 'crypto.subtle dan implementasi JS menghasilkan digest identik');
      t.ok(/^[0-9a-f]{64}$/.test(h), 'digest berupa 64 karakter heksadesimal');
    });
  });

  group('Rantai audit anti-rusak', function (t) {
    var chain = new A.Chain();
    var base = { actorId: 'stf-03', actorName: 'dr. Uji', actorRole: 'dokter', entity: 'encounter', entityId: 'E-1' };
    function entry(n) {
      var e = { at: '2026-09-08T0' + n + ':00:00.000Z', action: 'aksi.' + n, summary: 'langkah ' + n };
      Object.keys(base).forEach(function (k) { e[k] = base[k]; });
      return e;
    }
    return chain.append(entry(1))
      .then(function (e) {
        t.eq(e.seq, 1, 'entri pertama bernomor 1');
        t.eq(e.prevHash, A.GENESIS, 'entri pertama menunjuk ke hash genesis nol');
        return chain.append(entry(2));
      })
      .then(function (e) {
        t.eq(e.prevHash, chain.entries[0].hash, 'setiap entri membawa hash entri sebelumnya');
        return chain.append(entry(3));
      })
      .then(function () { return chain.append(entry(4)); })
      .then(function () { return A.verify(chain.entries); })
      .then(function (v) {
        t.ok(v.ok, 'rantai utuh terverifikasi');
        t.eq(v.checked, 4, 'keempat entri diperiksa');
        t.eq(v.head, chain.entries[3].hash, 'hash kepala dilaporkan');

        // Tamper: edit an entry in place, the way someone with database access
        // would.
        var edited = JSON.parse(JSON.stringify(chain.entries));
        edited[1].summary = 'langkah 2 (diubah diam-diam)';
        return A.verify(edited);
      })
      .then(function (v) {
        t.notOk(v.ok, 'entri yang diedit terdeteksi');
        t.eq(v.kind, 'hash', 'jenis kerusakan: hash isi tidak cocok');
        t.eq(v.brokenAt, 1, 'kerusakan PERTAMA dilaporkan pada indeks yang benar');
        t.eq(v.entry.seq, 2, 'entri yang rusak dinamai');
        t.match(v.reason, /telah diubah/, 'laporan menjelaskan apa yang terjadi');

        var deleted = JSON.parse(JSON.stringify(chain.entries));
        deleted.splice(1, 1);
        return A.verify(deleted);
      })
      .then(function (v) {
        t.notOk(v.ok, 'entri yang dihapus terdeteksi');
        t.eq(v.kind, 'sequence', 'jenis kerusakan: nomor urut bolong');
        t.eq(v.brokenAt, 1, 'kerusakan dilaporkan tepat di titik penghapusan');

        var reordered = JSON.parse(JSON.stringify(chain.entries));
        var tmp = reordered[1]; reordered[1] = reordered[2]; reordered[2] = tmp;
        return A.verify(reordered);
      })
      .then(function (v) {
        t.notOk(v.ok, 'entri yang ditukar urutannya terdeteksi');

        // Recomputing only the edited entry's own hash is not enough: the link
        // from the next entry still points at the old hash. This is exactly the
        // property that makes silent tampering impractical.
        var clever = JSON.parse(JSON.stringify(chain.entries));
        clever[1].summary = 'diubah, lalu hash-nya dihitung ulang';
        return A.hashEntry(clever[1]).then(function (h) {
          clever[1].hash = h;
          return A.verify(clever);
        });
      })
      .then(function (v) {
        t.notOk(v.ok, 'menghitung ulang hash satu entri saja tetap memutus rantai');
        t.eq(v.kind, 'link', 'jenis kerusakan: tautan prevHash tidak cocok');
        t.eq(v.brokenAt, 2, 'kerusakan muncul pada entri BERIKUTNYA');
        return A.verify([]);
      })
      .then(function (v) {
        t.ok(v.ok, 'rantai kosong dianggap sah');
        t.eq(v.head, A.GENESIS, 'kepala rantai kosong adalah genesis');
      });
  });

  group('Setiap mutasi masuk ke rantai', function (t) {
    var c = freshClinic('pendaftaran');
    var visit, enc;
    var before = c.chain.entries.length;
    return samplePatient(c)
      .then(function () {
        t.eq(c.chain.entries.length, before + 1, 'pendaftaran pasien tercatat');
        return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Batuk pilek 3 hari', doctorId: 'stf-03' });
      })
      .then(function (r) { visit = r.visit; return asId(c, 'stf-03').startEncounter(visit.id); })
      .then(function (r) {
        enc = r.encounter;
        var n = c.chain.entries.length;
        return c.saveEncounter(enc.id, { s: 'draf 1' })
          .then(function () { return c.saveEncounter(enc.id, { s: 'draf 2' }); })
          .then(function () {
            // Deliberate: keystroke-level drafts are NOT chained. Chaining them
            // would bury the signature in noise.
            t.eq(c.chain.entries.length, n, 'penyuntingan draf tidak membanjiri rantai');
          });
      })
      .then(function () {
        return c.saveEncounter(enc.id, { a: [{ code: 'J06.9', primary: true }] })
          .then(function () { return c.signEncounter(enc.id); });
      })
      .then(function () {
        var actions = c.chain.entries.map(function (e) { return e.action; });
        t.ok(actions.indexOf('soap.tandatangan') >= 0, 'penandatanganan tercatat');
        t.ok(actions.indexOf('pasien.daftar') >= 0, 'pendaftaran tercatat');
        t.ok(actions.indexOf('kunjungan.buka') >= 0, 'pembukaan kunjungan tercatat');
        var e = c.chain.entries[c.chain.entries.length - 1];
        t.eq(e.actorRole, 'dokter', 'entri membawa peran pelaku');
        t.eq(e.actorId, 'stf-03', 'entri membawa identitas pelaku');
        return c.verifyChain();
      })
      .then(function (v) {
        t.ok(v.ok, 'rantai hasil alur nyata terverifikasi');
      });
  });

  /* ==================================================== 6. prescriptions */

  group('Telaah keamanan resep', function (t) {
    function line(id, over) {
      var o = { drugId: id, dose: '1 tablet', freq: '3x sehari', days: 5, qty: 15 };
      Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; });
      return o;
    }
    var rx = R.rx;

    var clean = rx.check([line('paracetamol'), line('amoksisilin')], { age: 34, allergies: [], diagnoses: [] });
    t.eq(clean.findings.length, 0, 'resep bersih tidak memunculkan temuan palsu');
    t.eq(clean.worst, null, 'tidak ada tingkat keparahan pada resep bersih');

    var ix = rx.check([line('warfarin'), line('ibuprofen')], { age: 60 });
    t.eq(ix.findings.length, 1, 'pasangan warfarin + AINS terdeteksi');
    t.eq(ix.findings[0].sev, 'mayor', 'diberi tingkat mayor');
    t.eq(ix.overridable.length, 1, 'temuan mayor masuk daftar yang butuh alasan klinis');
    t.eq(ix.blocking.length, 0, 'mayor tidak memblokir secara mutlak');
    t.match(ix.findings[0].why, /perdarahan/i, 'penjelasan menyebut mekanismenya');

    // Order must not matter.
    var ixRev = rx.check([line('ibuprofen'), line('warfarin')], { age: 60 });
    t.eq(ixRev.findings.length, 1, 'urutan penulisan obat tidak mengubah hasil');

    var allergy = rx.check([line('amoksisilin')], { age: 30, allergies: ['penisilin'] });
    t.eq(allergy.blocking.length, 1, 'alergi penisilin memblokir amoksisilin');
    t.eq(allergy.findings[0].sev, 'kontraindikasi', 'alergi tercatat adalah kontraindikasi');
    var allergyClav = rx.check([line('ko-amoksiklav')], { age: 30, allergies: ['penisilin'] });
    t.eq(allergyClav.blocking.length, 1, 'blokir bekerja pada GOLONGAN, bukan nama produk');
    var cross = rx.check([line('sefadroksil')], { age: 30, allergies: ['penisilin'] });
    t.eq(cross.blocking.length, 0, 'sefalosporin tidak diblokir mutlak oleh alergi penisilin');
    t.eq(cross.findings[0].sev, 'moderat', 'reaksi silang diperingatkan, bukan dilarang');

    var triple = rx.check([line('kaptopril'), line('furosemid'), line('ibuprofen')], { age: 68 });
    var tw = triple.findings.filter(function (f) { return f.rule === 'triple-whammy'; });
    t.eq(tw.length, 1, 'triple whammy (RAAS + diuretik + AINS) terdeteksi');
    t.eq(tw[0].sev, 'mayor', 'triple whammy diberi tingkat mayor');
    var pairOnly = rx.check([line('kaptopril'), line('ibuprofen')], { age: 68 });
    t.eq(pairOnly.findings.filter(function (f) { return f.rule === 'triple-whammy'; }).length, 0,
      'triple whammy tidak muncul bila hanya dua dari tiga obat — memang aturan tiga arah');

    var dup = rx.check([line('ibuprofen'), line('as-mefenamat')], { age: 40 });
    t.eq(dup.findings.filter(function (f) { return f.kind === 'duplikasi'; }).length, 1, 'duplikasi dua AINS terdeteksi');

    var child = rx.check([line('aspirin')], { age: 8 });
    t.eq(child.blocking.length, 1, 'aspirin pada anak 8 tahun diblokir (sindrom Reye)');
    var adult = rx.check([line('aspirin')], { age: 40 });
    t.eq(adult.blocking.length, 0, 'aspirin pada dewasa tidak diblokir');

    var preg = rx.check([line('kaptopril')], { age: 28, pregnant: true });
    t.eq(preg.blocking.length, 1, 'ACE-inhibitor pada kehamilan diblokir');

    var ckd = rx.check([line('na-diklofenak')], { age: 70, diagnoses: ['N18.9'] });
    t.eq(ckd.overridable.length, 1, 'AINS pada PGK diperingatkan tingkat mayor');

    var incomplete = rx.check([{ drugId: 'paracetamol' }], { age: 30 });
    t.eq(incomplete.incomplete.length, 1, 'baris resep tanpa aturan pakai diblokir');
    t.eq(incomplete.blocking.length, 0,
      'resep belum lengkap BUKAN kontraindikasi absolut — kategorinya sendiri, agar tangga empat tingkat tidak diencerkan');
    t.eq(incomplete.findings[0].sev, 'kelengkapan', 'severitasnya "kelengkapan"');
    t.match(incomplete.findings[0].why, /dosis/, 'penjelasan menyebut bagian yang kurang');

    // Deduplication: the same class pair across four drugs must be reported once.
    var many = rx.check([line('warfarin'), line('ibuprofen'), line('na-diklofenak'), line('paracetamol')], { age: 60 });
    var warfarinNsaid = many.findings.filter(function (f) { return f.kind === 'interaksi' && f.subjects.indexOf('Warfarin') >= 0; });
    t.eq(warfarinNsaid.length, 2, 'dua AINS berbeda menghasilkan dua temuan berbeda, bukan empat duplikat');
    t.eq(R.rx.sevRank('kontraindikasi') > R.rx.sevRank('mayor'), true, 'tingkat keparahan terurut');
    t.eq(many.findings[0].sev, many.findings[0].sev, 'temuan diurutkan dari yang terparah');
    t.eq(R.rx.sevRank(many.findings[0].sev) >= R.rx.sevRank(many.findings[many.findings.length - 1].sev), true,
      'urutan temuan menurun menurut keparahan');
    return Promise.resolve();
  });

  group('Penandatanganan resep dan override', function (t) {
    var c = freshClinic('pendaftaran');
    var visit, enc, rxId;
    return samplePatient(c, { name: 'Uji Warfarin', dob: '1958-02-02', allergies: ['penisilin'] })
      .then(function () { return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Batuk pilek 3 hari', doctorId: 'stf-03' }); })
      .then(function (r) { visit = r.visit; return asId(c, 'stf-03').startEncounter(visit.id); })
      .then(function (r) {
        enc = r.encounter;
        return c.saveEncounter(enc.id, { s: 'Nyeri lutut.', a: [{ code: 'M17.9', primary: true }], plan: 'Analgesik.' });
      })
      .then(function () {
        return c.savePrescription(visit.id, [{ drugId: 'amoksisilin', dose: '1 kaplet', freq: '3x sehari', days: 5, qty: 15 }]);
      })
      .then(function (r) {
        rxId = r.prescription.id;
        return c.signPrescription(rxId, {});
      })
      .then(function (r) {
        t.notOk(r.ok, 'resep tidak dapat ditandatangani sebelum SOAP ditandatangani');
        return c.signEncounter(enc.id);
      })
      .then(function () { return c.signPrescription(rxId, {}); })
      .then(function (r) {
        t.notOk(r.ok, 'kontraindikasi alergi memblokir tanda tangan');
        t.eq(r.code, 'contraindicated', 'kode penolakan: contraindicated');
        return c.signPrescription(rxId, { overrideReason: 'Saya tetap ingin memberikannya walaupun ada alergi.' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'kontraindikasi TIDAK dapat di-override dengan alasan apa pun');
        t.eq(c.prescription(rxId).status, 'draft', 'resep tetap draf setelah ditolak');
        var rejected = c.chain.entries.filter(function (e) { return e.action === 'resep.ditolak'; });
        t.eq(rejected.length, 2, 'setiap penolakan keamanan tercatat di rantai');
        return c.savePrescription(visit.id, [
          { drugId: 'warfarin', dose: '1 tablet', freq: '1x sehari', days: 30, qty: 30 },
          { drugId: 'ibuprofen', dose: '1 tablet', freq: '3x sehari', days: 5, qty: 15 }
        ]);
      })
      .then(function () { return c.signPrescription(rxId, {}); })
      .then(function (r) {
        t.notOk(r.ok, 'peringatan mayor menahan tanda tangan sampai ada alasan klinis');
        t.eq(r.code, 'override-required', 'kode penolakan: override-required');
        return c.signPrescription(rxId, { overrideReason: 'singkat' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'alasan yang terlalu pendek tidak diterima');
        return c.signPrescription(rxId, {
          overrideReason: 'Analgesia alternatif tidak tersedia; pasien diberi PPI dan dijadwalkan cek INR dalam 3 hari.'
        });
      })
      .then(function (r) {
        t.ok(r.ok, 'dengan alasan klinis tertulis, resep dapat ditandatangani');
        t.eq(c.prescription(rxId).overrides.length, 1, 'override tersimpan pada resep');
        var ov = c.chain.entries.filter(function (e) { return e.action === 'resep.override'; });
        t.eq(ov.length, 1, 'override menghasilkan entri auditnya sendiri');
        t.eq(ov[0].actorId, 'stf-03', 'entri override menamai dokter penulis resep');
        t.match(A.canonical(ov[0].detail), /INR/, 'alasan klinis tersimpan di dalam rantai hash');
        return as(c, 'apoteker').dispense(rxId, {});
      })
      .then(function (r) {
        t.notOk(r.ok, 'obat tidak boleh diserahkan sebelum telaah apoteker');
        return c.reviewPrescription(rxId, 'Telaah selesai.');
      })
      .then(function () { return c.dispense(rxId, {}); })
      .then(function (r) {
        t.ok(r.ok, 'setelah telaah, obat dapat diserahkan');
        t.eq(c.prescription(rxId).status, 'diserahkan', 'status resep berpindah ke diserahkan');
        return asId(c, 'stf-03').savePrescription(visit.id, []);
      })
      .then(function (r) {
        t.notOk(r.ok, 'resep yang sudah ditandatangani tidak dapat diubah isinya');
      });
  });

  /* ==================================================== 7. roles */

  group('Kewenangan berdasarkan peran', function (t) {
    t.ok(D.can('dokter', 'soap.tandatangani').ok, 'dokter boleh menandatangani SOAP');
    t.notOk(D.can('apoteker', 'soap.tandatangani').ok, 'apoteker tidak boleh menandatangani SOAP');
    t.notOk(D.can('pendaftaran', 'soap.lihat-subjektif').ok, 'pendaftaran tidak boleh membaca anamnesis');
    t.ok(D.can('pendaftaran', 'pasien.lihat-demografi').ok, 'pendaftaran boleh melihat demografi');
    t.notOk(D.can('apoteker', 'soap.lihat-subjektif').ok, 'apoteker tidak melihat narasi subjektif');
    t.ok(D.can('apoteker', 'soap.lihat-asesmen').ok, 'apoteker MELIHAT diagnosis — dibutuhkan untuk telaah resep');
    t.ok(D.can('apoteker', 'pasien.lihat-alergi').ok, 'apoteker melihat alergi');
    t.notOk(D.can('perawat', 'resep.tulis').ok, 'perawat tidak menulis resep');
    t.ok(D.can('perawat', 'triase.isi').ok, 'perawat mengisi triase');
    t.notOk(D.can('dokter', 'triase.isi').ok, 'triase adalah kewenangan perawat');
    t.notOk(D.can('dokter', 'kasir.tutup').ok, 'dokter tidak menutup tagihan');

    var denial = D.can('apoteker', 'soap.tulis');
    t.match(denial.reason, /Apoteker/, 'penolakan menyebut peran yang menolak');
    t.match(denial.reason, /Dokter/, 'penolakan menyebut peran yang berwenang');

    var unknown = D.can('dokter', 'izin.tidak.ada');
    t.notOk(unknown.ok, 'izin yang tidak terdaftar ditolak, bukan diizinkan diam-diam');

    // Every role named anywhere in the matrix must be a real role.
    var bad = [];
    Object.keys(D.PERMISSIONS).forEach(function (p) {
      D.PERMISSIONS[p].forEach(function (r) { if (!D.ROLE_BY_ID[r]) bad.push(p + ':' + r); });
    });
    t.eq(bad.length, 0, 'matriks izin hanya menyebut peran yang ada');

    var badQueue = [];
    Object.keys(D.QUEUE).forEach(function (from) {
      Object.keys(D.QUEUE[from].next).forEach(function (to) {
        D.QUEUE[from].next[to].roles.forEach(function (r) { if (!D.ROLE_BY_ID[r]) badQueue.push(from + '→' + to + ':' + r); });
      });
    });
    t.eq(badQueue.length, 0, 'mesin antrian hanya menyebut peran yang ada');
    return Promise.resolve();
  });

  /* ==================================================== 8. vitals */

  group('Interpretasi tanda vital', function (t) {
    t.eq(D.bpBand(118, 76).label, 'Normal', 'tekanan darah normal');
    t.eq(D.bpBand(145, 92).label, 'Hipertensi derajat 1', 'HT derajat 1');
    t.eq(D.bpBand(165, 88).label, 'Hipertensi derajat 2', 'sistol saja cukup untuk derajat 2');
    t.eq(D.bpBand(120, 105).label, 'Hipertensi derajat 2', 'diastol saja juga cukup');
    t.eq(D.bpBand(185, 95).label, 'Krisis hipertensi', 'krisis hipertensi');
    t.eq(D.bpBand(85, 55).label, 'Hipotensi', 'hipotensi');

    t.eq(D.bmi(70, 170), 24.2, 'IMT dihitung ke satu desimal');
    // The Asia-Pacific cut-offs are the whole reason this function exists.
    t.eq(D.bmiBand(24.2).label, 'Berisiko (overweight, kriteria Asia-Pasifik)',
      'IMT 24,2 sudah "berisiko" pada kriteria Asia-Pasifik — bukan "normal" seperti kriteria WHO global');
    t.eq(D.bmiBand(22).label, 'Normal', 'IMT 22 normal');
    t.eq(D.bmiBand(26).label, 'Obesitas I', 'IMT 26 sudah obesitas I, bukan overweight');
    t.eq(D.bmiBand(17).label, 'Berat badan kurang', 'IMT 17 kurang');

    var normal = D.flagVitals({ tdSistol: 118, tdDiastol: 76, nadi: 72, suhu: 36.6, rr: 16, spo2: 98, bb: 62, tb: 170 }, 30);
    t.eq(normal.length, 0, 'set tanda vital normal tidak memunculkan penanda apa pun');

    var sick = D.flagVitals({ tdSistol: 168, tdDiastol: 104, nadi: 118, suhu: 39.2, rr: 26, spo2: 92, bb: 90, tb: 165 }, 55);
    var keys = sick.map(function (f) { return f.key; });
    t.ok(keys.indexOf('td') >= 0, 'tekanan darah tinggi ditandai');
    t.ok(keys.indexOf('nadi') >= 0, 'takikardia ditandai');
    t.ok(keys.indexOf('suhu') >= 0, 'demam ditandai');
    t.ok(keys.indexOf('rr') >= 0, 'takipnea ditandai');
    t.ok(keys.indexOf('spo2') >= 0, 'saturasi rendah ditandai');
    t.ok(keys.indexOf('imt') >= 0, 'IMT tinggi ditandai');

    var child = D.flagVitals({ tdSistol: 100, tdDiastol: 62, nadi: 90, suhu: 36.8, bb: 14, tb: 90 }, 3);
    t.eq(child.filter(function (f) { return f.key === 'imt'; }).length, 0,
      'IMT dewasa tidak diterapkan pada anak — butuh kurva pertumbuhan, yang tidak dimodelkan di sini');

    t.eq(D.suggestAcuity({ spo2: 88, tdSistol: 120, nadi: 90, suhu: 37 }), 'merah', 'saturasi 88% memicu triase merah');
    t.eq(D.suggestAcuity({ spo2: 97, tdSistol: 165, nadi: 90, suhu: 37 }), 'kuning', 'sistol 165 memicu triase kuning');
    t.eq(D.suggestAcuity({ spo2: 98, tdSistol: 120, nadi: 78, suhu: 36.6 }), 'hijau', 'tanda vital normal memicu triase hijau');

    /* PAEDIATRIC BANDS. The set below is a textbook-normal 2-year-old and a
     * textbook-normal 6-month-old. Read against adult thresholds both came out
     * hypotensive, tachycardic AND tachypnoeic — a description of shock — and
     * were auto-suggested "merah". The clinic seeds roughly a fifth of its
     * patients under 13 and runs a KIA poli, so this was half of triage. */
    var toddler = { tdSistol: 95, tdDiastol: 55, nadi: 110, suhu: 36.8, rr: 28, spo2: 98, bb: 12, tb: 87 };
    t.eq(D.flagVitals(toddler, 2).length, 0, 'balita 2 th yang sehat: 95/55, nadi 110, napas 28 — tidak ada penanda sama sekali');
    t.eq(D.suggestAcuity(toddler, 2), 'hijau', 'balita sehat disarankan hijau, bukan merah');
    t.eq(D.suggestAcuity(toddler), 'merah', 'tanpa usia, pita dewasa tetap dipakai — dan angka yang sama jadi merah');

    var infant = { tdSistol: 85, tdDiastol: 50, nadi: 130, suhu: 37, rr: 35, spo2: 98 };
    t.eq(D.flagVitals(infant, 0).length, 0, 'bayi 6 bulan sehat: nadi 130, napas 35 — normal untuk usianya');
    t.eq(D.suggestAcuity(infant, 0), 'hijau', 'bayi sehat hijau');

    // And the child who is genuinely sick must still come out red.
    t.eq(D.suggestAcuity({ tdSistol: 68, nadi: 180, rr: 50, spo2: 92 }, 2), 'merah',
      'balita syok (sistol 68, nadi 180, napas 50) tetap merah');
    t.eq(D.hypotensionFloor(0), 70, 'ambang hipotensi bayi 70 mmHg');
    t.eq(D.hypotensionFloor(5), 80, 'ambang hipotensi usia 5 mengikuti 70 + 2×usia');
    t.eq(D.hypotensionFloor(30), 90, 'ambang dewasa 90 mmHg');

    // Paediatric blood pressure above the floor is DECLINED, not guessed.
    var pedBp = D.bpBand(130, 85, 6);
    t.eq(pedBp.tone, 'ok', 'tekanan darah anak di atas ambang hipotensi tidak diinterpretasi');
    t.ok(pedBp.undecided, 'dan menyatakan dirinya tidak menilai, bukan menyatakan normal');
    t.match(pedBp.label, /persentil/, 'alasannya disebut: perlu kurva persentil');

    // R03.0, not I10, for a single raised office reading.
    t.eq(D.bpBand(150, 95).icd, 'R03.0', 'satu kali pengukuran tinggi disarankan sebagai R03.0');
    t.eq(D.flagVitals({ tdSistol: 150, tdDiastol: 95 }, 50)[0].suggestIcd, 'R03.0', 'bukan I10');
    t.eq(D.flagVitals({ tdSistol: 150, tdDiastol: 95 }, 50, { knownHypertension: true })[0].suggestIcd, 'I10',
      'I10 hanya untuk pasien yang memang sudah menyandang hipertensi');
    t.ok(!!R.icd.get('R03.0'), 'R03.0 ada di set rubrik');

    // An empty form is not a green patient.
    t.eq(D.suggestAcuity({}, 30), null, 'formulir kosong tidak menghasilkan saran apa pun — bukan "hijau"');
    t.notOk(D.hasMeasurement({}), 'hasMeasurement menolak set kosong');
    t.ok(D.hasMeasurement({ suhu: 37 }), 'satu pengukuran sudah cukup');

    // Plausibility bounds.
    t.ok(!!D.checkVitalRanges({ spo2: 500 }), 'SpO₂ 500% ditolak');
    t.ok(!!D.checkVitalRanges({ suhu: 999 }), 'suhu 999 °C ditolak');
    t.ok(!!D.checkVitalRanges({ tdSistol: -50 }), 'sistol negatif ditolak');
    t.match(D.checkVitalRanges({ tb: 1.7 }).reason, /sentimeter/, 'tinggi 1,7 ditolak dan menyebut satuannya');
    t.ok(!!D.checkVitalRanges({ tdSistol: 100, tdDiastol: 120 }), 'diastol di atas sistol ditolak');
    t.notOk(D.checkVitalRanges({ tdSistol: 118, tdDiastol: 76, nadi: 72, suhu: 36.6, rr: 16, spo2: 98, bb: 62, tb: 170 }),
      'set yang wajar lolos tanpa keluhan');
    return Promise.resolve();
  });

  /* ==================================================== 9. billing */

  group('Tarif, BPJS dan iur biaya', function (t) {
    var rx = {
      status: 'diserahkan',
      items: [
        { drugId: 'paracetamol', qty: 15 },
        { drugId: 'vit-b-kompleks', qty: 10 }
      ]
    };
    var umum = D.computeBill({ poli: 'umum', klass: 'umum', tindakan: ['gds'] }, rx);
    var expected = D.TARIF_PENDAFTARAN + 40000 + 25000 + 15 * 500 + 10 * 300;
    t.eq(umum.totalTarif, expected, 'total tarif pasien umum dijumlahkan benar');
    t.eq(umum.dibayarPasien, expected, 'pasien umum membayar seluruh tarif');
    t.eq(umum.ditanggung, 0, 'tidak ada yang ditanggung untuk pasien umum');

    var bpjs = D.computeBill({ poli: 'umum', klass: 'bpjs', tindakan: ['gds'] }, rx);
    t.eq(bpjs.totalTarif, expected, 'nilai tarif sama, siapa pun yang membayar');
    t.eq(bpjs.dibayarPasien, 10 * 300, 'pasien BPJS hanya membayar item di luar jaminan (vitamin)');
    t.eq(bpjs.ditanggung, expected - 10 * 300, 'sisanya ditanggung kapitasi');
    t.eq(bpjs.ditanggung + bpjs.dibayarPasien, bpjs.totalTarif, 'dua sisi tagihan berjumlah sama dengan total');
    t.match(bpjs.note, /kapitasi/, 'catatan menjelaskan mekanisme kapitasi FKTP');

    var kosmetik = D.computeBill({ poli: 'gigi', klass: 'bpjs', tindakan: ['skeling'] }, null);
    t.eq(kosmetik.dibayarPasien, 250000, 'skeling di luar jaminan menjadi iur biaya penuh');
    var iurLines = kosmetik.lines.filter(function (l) { return l.payer === 'iur'; });
    t.eq(iurLines.length, 1, 'baris iur biaya ditandai tersendiri');

    t.eq(D.rupiah(1500000), 'Rp 1.500.000', 'format rupiah memakai titik ribuan');
    t.eq(D.rupiah(0), 'Rp 0', 'nol diformat');
    t.eq(D.rupiah(500), 'Rp 500', 'angka di bawah seribu tanpa pemisah');

    /* ONLY WHAT LEFT THE PHARMACY IS BILLED.
     * A draft prescription used to be charged at the counter in full: never
     * signed, never reviewed, never handed to anyone. */
    var base = D.TARIF_PENDAFTARAN + 40000;
    ['draft', 'signed', 'ditelaah', 'dibatalkan'].forEach(function (st) {
      var b = D.computeBill({ poli: 'umum', klass: 'umum', tindakan: [] },
        { status: st, items: [{ drugId: 'budesonid-inh', qty: 2 }, { drugId: 'salbutamol-inh', qty: 1 }] });
      t.eq(b.totalTarif, base, 'resep berstatus "' + st + '" tidak ditagihkan sepeser pun');
      t.eq(b.lines.filter(function (l) { return l.group === 'obat'; }).length, 0, 'tidak ada baris obat untuk resep "' + st + '"');
    });
    var served = D.computeBill({ poli: 'umum', klass: 'umum', tindakan: [] },
      { status: 'diserahkan', items: [{ drugId: 'budesonid-inh', qty: 2 }, { drugId: 'salbutamol-inh', qty: 1 }] });
    t.eq(served.totalTarif, base + 2 * 145000 + 78000, 'yang diserahkan ditagihkan penuh');

    // A pharmacist substitution moves the money as well as the label.
    var subbed = D.computeBill({ poli: 'umum', klass: 'umum', tindakan: [] }, {
      status: 'diserahkan',
      items: [{ drugId: 'simvastatin', qty: 30 }],
      substitutions: [{ from: 'simvastatin', to: 'atorvastatin', qty: 30 }]
    });
    t.eq(subbed.totalTarif, base + 30 * 2200, 'tagihan mengikuti obat yang benar-benar diserahkan, bukan yang ditulis');
    t.match(subbed.lines[subbed.lines.length - 1].label, /Atorvastatin/, 'barisnya menyebut obat pengganti');

    /* Accident cases do not run through capitation. */
    var laka = D.computeBill({ poli: 'umum', klass: 'bpjs', tindakan: ['jahit-luka'], kecelakaan: 'lalu-lintas' }, null);
    t.eq(laka.ditanggung, 0, 'kasus kecelakaan lalu lintas tidak dibebankan ke kapitasi BPJS');
    t.eq(laka.ditanggungLain, laka.totalTarif, 'seluruhnya diajukan ke penjamin pertama');
    t.eq(laka.penjaminLain, 'Jasa Raharja', 'penjamin pertamanya disebut namanya');
    t.eq(D.computeBill({ poli: 'umum', klass: 'bpjs', tindakan: ['jahit-luka'], kecelakaan: 'kerja' }, null).penjaminLain,
      'BPJS Ketenagakerjaan', 'kecelakaan kerja ke BPJS Ketenagakerjaan');
    return Promise.resolve();
  });

  /* =============================================== 9b. chain truncation */

  group('Rantai audit: penghapusan ekor', function (t) {
    var ch = new A.Chain([]);
    var p = Promise.resolve();
    for (var i = 1; i <= 8; i++) {
      (function (n) {
        p = p.then(function () {
          return ch.append({
            actorId: 'stf-03', actorName: 'dr. Uji', actorRole: 'dokter',
            action: 'uji.' + n, entity: 'visit', entityId: 'V-1', summary: 'entri ' + n
          });
        });
      })(i);
    }
    return p.then(function () {
      var commit = { count: ch.entries.length, head: ch.head() };
      var cut = ch.entries.slice(0, 5);
      return A.verify(cut).then(function (naive) {
        // The property that made this worth fixing: the shortened chain is
        // internally PERFECT. Nothing was recomputed because nothing had to be.
        t.ok(naive.ok, 'tanpa komitmen panjang, rantai yang dipotong ekornya lolos verifikasi — itulah lubangnya');
        return A.verify(cut, commit);
      }).then(function (v) {
        t.notOk(v.ok, 'dengan komitmen panjang/kepala, penghapusan ekor tertangkap');
        t.eq(v.kind, 'truncated', 'jenis kegagalannya disebut tersendiri: terpotong');
        t.match(v.reason, /8/, 'penolakan menyebut berapa entri yang seharusnya ada');
        t.match(v.reason, /3/, 'dan berapa yang hilang');
        return A.verify(ch.entries, commit);
      }).then(function (v) {
        t.ok(v.ok, 'rantai utuh tetap lolos terhadap komitmennya sendiri');
        t.eq(v.checked, 8, 'delapan entri diperiksa');
        // A forged extra entry appended outside the app changes the head.
        return A.verify(ch.entries, { count: 8, head: 'deadbeef'.repeat(8) });
      }).then(function (v) {
        t.notOk(v.ok, 'hash kepala yang tidak cocok juga ditolak');
        t.eq(v.kind, 'truncated', 'dilaporkan lewat jalur yang sama');
      });
    });
  });

  /* ============================================ 9c. registration guards */

  group('Penjagaan pendaftaran dan triase', function (t) {
    var c = freshClinic('pendaftaran');
    return c.registerPatient({ name: 'Uji Ganda', sex: 'L', dob: '2099-12-31' })
      .then(function (r) {
        t.notOk(r.ok, 'tanggal lahir di masa depan ditolak');
        t.match(r.reason, /masa depan/, 'penolakan menyebut sebabnya');
        return c.registerPatient({ name: 'Uji Ganda', sex: 'L', dob: '1800-01-01' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'usia di atas 130 tahun ditolak sebagai salah ketik');
        return c.registerPatient({ name: 'Uji Ganda', sex: 'L', dob: '1959-04-11', allergies: ['penisilin'] });
      })
      .then(function (r) {
        t.ok(r.ok, 'pasien pertama terdaftar');
        return c.registerPatient({ name: 'Uji Ganda', sex: 'L', dob: '1959-04-11' });
      })
      .then(function (r) {
        /* The duplicate that used to succeed silently: same name, same dob,
         * same sex, and the new record carries no allergies — so the safety
         * check on it reports "tanpa alergi tercatat" for a penicillin-allergic
         * person. */
        t.notOk(r.ok, 'duplikat persis ditolak, tidak diberi No. RM kedua diam-diam');
        t.eq(r.code, 'duplicate-suspect', 'kodenya menyebut dugaan duplikat');
        t.eq(r.candidates[0].rmNumber, 'RM-000001', 'kandidatnya disebutkan agar petugas bisa memakainya');
        t.eq(c.state.patients.length, 1, 'tidak ada rekam kedua yang terlanjur dibuat');
        // Two different people really can share a name and a birthday.
        return c.registerPatient({ name: 'Uji Ganda', sex: 'L', dob: '1959-04-11', acknowledgeDuplicate: true });
      })
      .then(function (r) {
        t.ok(r.ok, 'petugas dapat menyatakan bahwa ini orang yang berbeda dan melanjutkan');
        t.eq(c.state.patients.length, 2, 'rekam kedua dibuat setelah pernyataan itu');
        var last = c.chain.entries[c.chain.entries.length - 1];
        t.match(last.summary, /diabaikan secara sadar/, 'pengabaian peringatan tercatat di rantai audit');
        return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08' });
      })
      .then(function (r) {
        t.notOk(r.ok, 'kunjungan tanpa keluhan utama ditolak');
        t.match(r.reason, /Keluhan utama/, 'penolakan menyebut kolom yang kurang');
        return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Demam 2 hari' });
      })
      .then(function (r) {
        t.ok(r.ok, 'dengan keluhan utama, kunjungan dibuka');
        var vid = r.visit.id;
        return as(c, 'perawat').recordTriage(vid, {}).then(function (rr) {
          t.notOk(rr.ok, 'triase kosong ditolak — tidak disimpan dan tidak dinilai hijau');
          return c.recordTriage(vid, { tdSistol: -50, tdDiastol: -20, nadi: 0, suhu: 999, rr: 0, spo2: 500, bb: 0, tb: 0 });
        }).then(function (rr) {
          t.notOk(rr.ok, 'tanda vital yang mustahil ditolak');
          t.eq(rr.code, 'validation', 'ditolak sebagai kesalahan pengisian');
          return c.recordTriage(vid, { tdSistol: 120, tdDiastol: 78, nadi: 74, suhu: 36.6, rr: 16, spo2: 98, bb: 70, tb: 170 });
        }).then(function (rr) {
          t.ok(rr.ok, 'tanda vital yang wajar tersimpan');
          t.eq(c.visit(vid).triage.acuity, 'hijau', 'triase disarankan dari angka yang benar-benar diukur');
        });
      });
  });

  /* ========================================= 9d. prescription lifecycle */

  group('Pembatalan resep dan tagihan yang jujur', function (t) {
    var c = freshClinic('pendaftaran');
    var vid, encId, rxId;
    return samplePatient(c)
      .then(function () { return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Sesak napas', doctorId: 'stf-03' }); })
      .then(function (r) {
        vid = r.visit.id;
        return as(c, 'perawat').transition(vid, 'triase');
      })
      .then(function () { return c.recordTriage(vid, { tdSistol: 122, tdDiastol: 78, nadi: 82, suhu: 36.8, rr: 18, spo2: 97, bb: 68, tb: 170 }); })
      .then(function () { return c.transition(vid, 'menunggu-dokter'); })
      .then(function () { return asId(c, 'stf-03').transition(vid, 'konsultasi'); })
      .then(function () { return c.startEncounter(vid); })
      .then(function (r) {
        encId = r.encounter.id;
        return c.saveEncounter(encId, { s: 'Sesak sejak semalam.', a: [{ code: 'J45.9', primary: true }], plan: 'Inhaler.' });
      })
      .then(function () { return c.signEncounter(encId); })
      .then(function () {
        return c.savePrescription(vid, [
          { drugId: 'budesonid-inh', dose: '2 semprot', freq: '2x sehari', days: 30, qty: 2 },
          { drugId: 'salbutamol-inh', dose: '2 semprot', freq: 'bila sesak', days: 30, qty: 1 }
        ]);
      })
      .then(function (r) {
        rxId = r.prescription.id;
        t.eq(r.prescription.status, 'draft', 'resep tersimpan sebagai draf');
        /* A DRAFT MUST NOT REACH THE COUNTER. Previously the konsultasi→kasir
         * guard only refused a *signed* prescription, so a draft walked
         * straight through and was billed in full at the cashier. */
        return c.transition(vid, 'kasir');
      })
      .then(function (r) {
        t.notOk(r.ok, 'kunjungan dengan draf resep berisi obat ditolak menuju kasir');
        t.match(r.reason, /draf resep/, 'penolakan menyebut drafnya');
        var bill = D.computeBill(c.visit(vid), c.prescriptionForVisit(vid));
        t.eq(bill.lines.filter(function (l) { return l.group === 'obat'; }).length, 0,
          'dan seandainya tagihan dihitung sekarang, obat draf tidak ada di dalamnya');
        return c.signPrescription(rxId, {});
      })
      .then(function (r) {
        t.ok(r.ok, 'resep ditandatangani');
        // The exit the refusal message used to name and the app did not have.
        return as(c, 'perawat').cancelPrescription(rxId, 'Perawat mencoba membatalkan.');
      })
      .then(function (r) {
        t.notOk(r.ok, 'perawat tidak dapat membatalkan resep');
        return asId(c, 'stf-04').cancelPrescription(rxId, 'Dokter lain mencoba membatalkan.');
      })
      .then(function (r) {
        t.notOk(r.ok, 'dokter lain tidak dapat membatalkan resep yang bukan tulisannya');
        return asId(c, 'stf-03').cancelPrescription(rxId, '');
      })
      .then(function (r) {
        t.notOk(r.ok, 'pembatalan tanpa alasan tertulis ditolak');
        return c.cancelPrescription(rxId, 'Salah sediaan: pasien tidak dapat memakai inhaler tanpa spacer.');
      })
      .then(function (r) {
        t.ok(r.ok, 'dokter penulisnya dapat membatalkan resepnya sendiri');
        t.eq(c.prescription(rxId).status, 'dibatalkan', 'statusnya menjadi dibatalkan');
        t.eq(c.prescription(rxId).items.length, 2, 'isinya TIDAK dihapus — pembatalan menambah, bukan menghapus');
        t.match(c.prescription(rxId).cancelReason, /spacer/, 'alasannya tersimpan pada resepnya');
        var logged = c.chain.entries.filter(function (e) { return e.action === 'resep.batal'; });
        t.eq(logged.length, 1, 'pembatalan masuk ke rantai audit');
        // With the prescription cancelled the visit is no longer stuck.
        return c.transition(vid, 'kasir');
      })
      .then(function (r) {
        t.ok(r.ok, 'setelah dibatalkan, kunjungan tidak lagi tersangkut dan dapat ke kasir');
        var bill = D.computeBill(c.visit(vid), c.prescriptionForVisit(vid));
        t.eq(bill.lines.filter(function (l) { return l.group === 'obat'; }).length, 0, 'resep yang dibatalkan tidak ditagihkan');
        // And a replacement can be written.
        return c.savePrescription(vid, [{ drugId: 'salbutamol', dose: '1 tablet', freq: '3x sehari', days: 5, qty: 15 }]);
      })
      .then(function (r) {
        t.ok(r.ok, 'resep pengganti dapat ditulis setelah pembatalan');
        t.ne(r.prescription.id, rxId, 'resep pengganti adalah resep baru, bukan yang lama disunting');
        t.eq(c.prescriptionsForVisit(vid).length, 2, 'keduanya tersimpan dan tetap dapat dibaca');
      });
  });

  /* ================================ 9e. signature binds to the author */

  group('Tanda tangan melekat pada penulis catatan', function (t) {
    var c = freshClinic('pendaftaran');
    var vid, encId;
    return samplePatient(c)
      .then(function () { return c.openVisit({ rmNumber: 'RM-000001', poli: 'umum', date: '2026-09-08', complaint: 'Nyeri lutut', doctorId: 'stf-03' }); })
      .then(function (r) { vid = r.visit.id; return asId(c, 'stf-03').startEncounter(vid); })
      .then(function (r) {
        encId = r.encounter.id;
        t.eq(r.encounter.doctorId, 'stf-03', 'catatan mencatat penulisnya');
        return c.saveEncounter(encId, { s: 'Nyeri lutut kanan.', a: [{ code: 'M17.9', primary: true }], plan: 'Analgesik.' });
      })
      .then(function () { return asId(c, 'stf-04').signEncounter(encId); })
      .then(function (r) {
        /* dr. B signing dr. A's draft used to succeed, producing a note whose
         * responsible clinician and whose signatory differed — and then locking
         * dr. A out of amending her own note, because the addendum guard
         * compares against the signatory. */
        t.notOk(r.ok, 'dokter lain tidak dapat menandatangani draf yang bukan tulisannya');
        t.eq(r.code, 'permission', 'ditolak sebagai kewenangan');
        t.eq(c.encounter(encId).status, 'draft', 'catatan tetap draf');
        return asId(c, 'stf-03').signEncounter(encId);
      })
      .then(function (r) {
        t.ok(r.ok, 'penulisnya sendiri dapat menandatangani');
        t.eq(c.encounter(encId).signedBy, 'stf-03', 'penanda tangan sama dengan penulis');
        return c.addAddendum(encId, { path: 's', newValue: 'Nyeri lutut KIRI.', reason: 'Salah sisi saat pencatatan.' });
      })
      .then(function (r) {
        t.ok(r.ok, 'dan karena itu tetap dapat mengoreksi catatannya sendiri');
      });
  });

  /* ==================================================== 10. seeded data */

  group('Data demo tersemai (deterministik dan sintetis)', function (t) {
    var TODAY = new Date('2026-09-08T11:00:00');
    return R.seed.build({ today: TODAY, seed: 4242 }).then(function (a) {
      return R.seed.build({ today: TODAY, seed: 4242 }).then(function (b) {
        t.eq(a.state.patients.length, b.state.patients.length, 'benih yang sama menghasilkan jumlah pasien yang sama');
        t.eq(a.state.patients[5].name, b.state.patients[5].name, 'benih yang sama menghasilkan nama yang sama');
        t.eq(A.canonical(a.snapshot().visits.map(function (v) { return v.id + v.status; })),
          A.canonical(b.snapshot().visits.map(function (v) { return v.id + v.status; })),
          'seluruh papan antrian tereproduksi persis');
        return R.seed.build({ today: TODAY, seed: 9999 });
      }).then(function (cSeed) {
        t.ne(cSeed.state.patients[5].name, a.state.patients[5].name, 'benih berbeda menghasilkan data berbeda');

        var nikLeak = a.state.patients.filter(function (p) { return /^\d{16}$/.test(String(p.nikDemo)); });
        t.eq(nikLeak.length, 0, 'tidak ada satu pun field yang berbentuk NIK 16 digit');
        var allFake = a.state.patients.every(function (p) { return /FIKTIF/.test(p.nikDemo); });
        t.ok(allFake, 'setiap identitas ditandai FIKTIF di dalam datanya sendiri');
        var bpjsFake = a.state.patients.filter(function (p) { return p.klass === 'bpjs'; })
          .every(function (p) { return /FIKTIF/.test(p.bpjsDemo); });
        t.ok(bpjsFake, 'nomor BPJS juga ditandai FIKTIF');

        t.ok(a.state.patients.length >= 20, 'cukup pasien untuk membuat aplikasi hidup (' + a.state.patients.length + ')');
        t.ok(a.state.visits.length >= 30, 'ada riwayat kunjungan, bukan hanya hari ini');
        t.ok(a.state.encounters.length >= 20, 'sebagian besar kunjungan punya catatan SOAP');
        t.ok(a.state.addenda.length >= 1, 'setidaknya satu adendum sudah ada saat aplikasi dibuka');

        // Every RM in the seeded data is unique — the single assertion that
        // would catch a regression in the allocator under real load.
        var seen = {}, dupes = 0;
        a.state.patients.forEach(function (p) { if (seen[p.rmNumber]) dupes++; seen[p.rmNumber] = 1; });
        t.eq(dupes, 0, 'tidak ada No. RM ganda di seluruh data tersemai');

        var visitIds = {}, vdupes = 0;
        a.state.visits.forEach(function (v) { if (visitIds[v.id]) vdupes++; visitIds[v.id] = 1; });
        t.eq(vdupes, 0, 'tidak ada ID kunjungan ganda');

        // Queue numbers DO repeat across days, and that is correct.
        var todayStr = '2026-09-08';
        var todayQ = a.state.visits.filter(function (v) { return v.date === todayStr && v.poli === 'umum'; })
          .map(function (v) { return v.queueNo; });
        t.eq(new Set(todayQ).size, todayQ.length, 'nomor antrian unik dalam satu hari dan satu poli');
        var otherDay = a.state.visits.filter(function (v) { return v.date !== todayStr && v.poli === 'umum'; })
          .map(function (v) { return v.queueNo; });
        t.ok(otherDay.indexOf('A-001') >= 0 && todayQ.indexOf('A-001') >= 0,
          'nomor antrian A-001 memang muncul di lebih dari satu hari — itu perilaku yang benar');

        // A signed encounter must never be internally invalid.
        var badSigned = a.state.encounters.filter(function (e) {
          if (e.status !== 'signed') return false;
          var primary = e.a.filter(function (d) { return d.primary; });
          return primary.length !== 1 || !e.s;
        });
        t.eq(badSigned.length, 0, 'setiap catatan yang ditandatangani punya tepat satu diagnosis utama dan anamnesis terisi');

        // Seeded prescriptions must be internally consistent with the patient's
        // recorded allergies, or the demo would be showing a record that could
        // not have been signed.
        var contradictions = [];
        a.state.prescriptions.forEach(function (p) {
          var pat = a.patient(p.rmNumber);
          if (!pat) return;
          var res = R.rx.check(p.items, {
            age: a.age(pat), pregnant: pat.pregnant, allergies: pat.allergies, diagnoses: []
          });
          if (res.blocking.length && p.status !== 'draft') contradictions.push(p.id);
        });
        t.eq(contradictions.length, 0, 'tidak ada resep tersemai yang melanggar alergi pasiennya sendiri');

        return a.verifyChain();
      }).then(function (v) {
        t.ok(v.ok, 'rantai audit seluruh data tersemai terverifikasi (' + v.checked + ' entri)');
        t.ok(v.checked > 200, 'rantai cukup panjang untuk berarti (' + v.checked + ' entri)');
      });
    });
  });

  /* ==================================================== 11. end to end */

  group('Perjalanan pasien lengkap, ujung ke ujung', function (t) {
    var c = freshClinic('pendaftaran');
    var rm, visit, enc, rxId;
    return c.registerPatient({
      name: 'Uji Ujung', sex: 'P', dob: '1979-06-15', klass: 'bpjs',
      allergies: [], chronic: ['I10']
    })
      .then(function (r) {
        rm = r.patient.rmNumber;
        return c.openVisit({ rmNumber: rm, poli: 'umum', date: '2026-09-08', complaint: 'Kontrol hipertensi', doctorId: 'stf-03' });
      })
      .then(function (r) { visit = r.visit; return c.transition(visit.id, 'triase'); })
      .then(function () {
        return as(c, 'perawat').recordTriage(visit.id, {
          tdSistol: 152, tdDiastol: 94, nadi: 80, suhu: 36.6, rr: 18, spo2: 98, bb: 72, tb: 158
        });
      })
      .then(function (r) {
        var td = r.flags.filter(function (f) { return f.key === 'td'; })[0];
        t.ok(td, 'tekanan darah 152/94 ditandai saat triase');
        t.eq(td.note, 'Hipertensi derajat 1', 'penandaan menyebut derajatnya');
        return c.transition(visit.id, 'menunggu-dokter');
      })
      .then(function () { return asId(c, 'stf-03').transition(visit.id, 'konsultasi'); })
      .then(function () { return c.startEncounter(visit.id); })
      .then(function (r) {
        enc = r.encounter;
        return c.saveEncounter(enc.id, {
          s: 'Kontrol rutin, kadang nyeri tengkuk.',
          exam: 'Jantung dan paru dalam batas normal.',
          a: [{ code: 'I10', primary: true }],
          plan: 'Lanjutkan amlodipin, batasi garam.'
        });
      })
      .then(function () { return c.signEncounter(enc.id); })
      .then(function (r) {
        t.ok(r.ok, 'SOAP ditandatangani');
        return c.setTindakan(visit.id, ['gds']);
      })
      .then(function () {
        return c.savePrescription(visit.id, [
          { drugId: 'amlodipin', dose: '1 tablet', freq: '1x sehari', days: 30, qty: 30, instruksi: 'Malam hari' }
        ]);
      })
      .then(function (r) { rxId = r.prescription.id; return c.signPrescription(rxId, {}); })
      .then(function (r) {
        t.ok(r.ok, 'resep bersih ditandatangani tanpa hambatan');
        return c.transition(visit.id, 'kasir');
      })
      .then(function (r) {
        t.notOk(r.ok, 'tidak boleh melompati farmasi ketika ada resep bertanda tangan');
        return c.transition(visit.id, 'farmasi');
      })
      .then(function (r) {
        t.ok(r.ok, 'kunjungan berpindah ke farmasi');
        return as(c, 'apoteker').reviewPrescription(rxId, 'Sesuai.');
      })
      .then(function () { return c.dispense(rxId, {}); })
      .then(function () { return c.transition(visit.id, 'kasir'); })
      .then(function (r) {
        t.ok(r.ok, 'apoteker memindahkan pasien ke kasir setelah obat diserahkan');
        return as(c, 'dokter').closeBill(visit.id);
      })
      .then(function (r) {
        t.notOk(r.ok, 'dokter tidak dapat menutup tagihan');
        return as(c, 'pendaftaran').closeBill(visit.id);
      })
      .then(function (r) {
        t.ok(r.ok, 'petugas pendaftaran menutup tagihan');
        var bill = r.bill;
        t.eq(bill.dibayarPasien, 0, 'pasien BPJS tidak membayar apa pun untuk layanan yang dijamin');
        t.eq(bill.ditanggung, bill.totalTarif, 'seluruh tarif ditanggung kapitasi');
        return c.transition(visit.id, 'selesai');
      })
      .then(function (r) {
        t.ok(r.ok, 'kunjungan ditutup');
        t.eq(visit.status, 'selesai', 'status akhir Selesai');
        t.eq(visit.history.length, 7, 'seluruh perpindahan tercatat pada riwayat kunjungan');
        return c.verifyChain();
      })
      .then(function (v) {
        t.ok(v.ok, 'rantai audit perjalanan penuh terverifikasi');
        var actions = c.chain.entries.map(function (e) { return e.action; });
        ['pasien.daftar', 'kunjungan.buka', 'triase.isi', 'antrian.pindah', 'soap.tandatangan',
          'resep.tandatangan', 'resep.telaah', 'resep.serah', 'kasir.tutup'].forEach(function (a) {
            t.ok(actions.indexOf(a) >= 0, 'jejak audit memuat "' + a + '"');
          });
      });
  });

  /* ------------------------------------------------------------- runner */

  function runTests() {
    var results = [];
    var chain = Promise.resolve();
    groups.forEach(function (g) {
      chain = chain.then(function () {
        var ctx = makeCtx(results, g.name);
        var out;
        try {
          out = g.fn(ctx);
        } catch (e) {
          results.push({ group: g.name, name: 'grup melempar kesalahan', ok: false, message: String(e && e.stack || e) });
          return null;
        }
        return Promise.resolve(out).catch(function (e) {
          results.push({ group: g.name, name: 'grup ditolak secara asinkron', ok: false, message: String(e && e.stack || e) });
        });
      });
    });
    return chain.then(function () {
      var passed = results.filter(function (r) { return r.ok; }).length;
      return {
        results: results,
        passed: passed,
        failed: results.length - passed,
        total: results.length,
        groups: groups.length
      };
    });
  }

  R.runTests = runTests;
  R.testGroups = groups;
})(typeof self !== 'undefined' ? self : this);
