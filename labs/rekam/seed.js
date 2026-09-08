/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — seed.js
 * Fabricates the whole clinic from a seeded PRNG so the app is alive on first
 * paint with zero clicks.
 *
 * ON THE DATA. Every patient, doctor, complaint, diagnosis and prescription
 * below is INVENTED BY AN ALGORITHM. There is no source dataset, no anonymised
 * extract, no scraped record. Specifically:
 *
 *  - Names are assembled syllable by syllable from a phonotactic table. They
 *    are meant to read as plausible Indonesian names while belonging to nobody.
 *  - There are no NIKs. The identity field holds "NIK-FIKTIF-000123", which is
 *    not a valid NIK in any format — a real one is 16 digits encoding province,
 *    regency, district, birth date and sex. Nothing here can be mistaken for
 *    one or dialled into a real system.
 *  - BPJS numbers are "BPJS-FIKTIF-000123" for the same reason.
 *  - Clinical narratives are drawn from a template bank keyed to the diagnosis.
 *
 * Handling PHI carelessly in a portfolio piece would be the exact opposite of
 * the competence this lab is meant to show, so there is none in it.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});
  var D = R.domain;

  /* --------------------------------------------------------------- names */

  /* Indonesian phonotactics are close to strictly CV(C): open syllables,
   * a five-vowel system, a small coda inventory (n, ng, r, s, h, m, k) and
   * essentially no onset clusters outside loanwords. Generating from that
   * shape gives names that read naturally aloud; generating from an
   * unconstrained syllable soup gives "Dwauscasnais", which is how you can
   * tell a demo was never read by anyone who speaks the language. */
  // Weighted toward the consonants that actually carry Indonesian names.
  var ONSET = ['r', 'r', 's', 's', 'n', 'n', 'm', 'm', 'd', 'd', 't', 't', 'k', 'k',
    'w', 'w', 'l', 'l', 'b', 'g', 'h', 'j', 'p', 'y', 'c', 'ng'];
  // Weighted: a is by far the commonest vowel, then i and u.
  var NUCLEUS = ['a', 'a', 'a', 'a', 'i', 'i', 'i', 'u', 'u', 'e', 'o'];
  var CODA = ['n', 'ng', 'r', 's', 'h', 'm', 'k'];

  function stem(rand, syllables) {
    var s = '';
    for (var i = 0; i < syllables; i++) {
      s += D.pick(rand, ONSET) + D.pick(rand, NUCLEUS);
      // A coda only on a non-final syllable occasionally, and only after the
      // first — "Sanmara", not "Nsatra".
      if (i > 0 && i < syllables - 1 && rand() < 0.25) s += D.pick(rand, CODA);
    }
    if (rand() < 0.3) s += D.pick(rand, CODA);
    return s;
  }

  // Generic particles and endings that carry no identity on their own — every
  // Indonesian phone book has thousands of each — attached to a generated stem.
  var PARTICLE_F = ['Nur', 'Sri', 'Dwi', 'Eka', 'Ayu', 'Rina', 'Dian'];
  var PARTICLE_M = ['Adi', 'Bayu', 'Tri', 'Eko', 'Agus', 'Rudi', 'Hari'];
  var ENDING_F = ['wati', 'ningsih', 'sari', 'ati', 'ani', 'ina'];
  var ENDING_M = ['anto', 'adi', 'awan', 'arta', 'ono', 'aji'];

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Joining a stem to an ending produces the seams a generator always produces:
  // "Buja" + "awan" = "Bujaawan", "Hoha" + "anto" with a stray h. Collapse
  // doubled vowels and doubled consonants at the seam.
  function tidy(s) {
    return s
      .replace(/([aiueo])\1+/g, '$1')
      .replace(/([bcdgjklmnprstwy])\1+/g, '$1')
      .replace(/h{2,}/g, 'h');
  }

  function personName(rand, sex) {
    var female = sex === 'P';
    var given, family;
    if (rand() < 0.35) {
      given = D.pick(rand, female ? PARTICLE_F : PARTICLE_M) + ' ' + cap(tidy(stem(rand, 2)));
    } else {
      given = cap(tidy(stem(rand, D.intBetween(rand, 2, 3))));
    }
    if (rand() < 0.6) {
      family = cap(tidy(stem(rand, 2) + D.pick(rand, female ? ENDING_F : ENDING_M)));
    } else {
      family = cap(tidy(stem(rand, D.intBetween(rand, 2, 3))));
    }
    return given + ' ' + family;
  }

  /* ---------------------------------------------------------- narratives */

  // Keyed by ICD-10 rubric: [subjective template, objective template,
  //                          plan template, [drug ids], tindakan ids]
  var PRESENTATIONS = [
    { code: 'J06.9', poli: 'umum',
      s: 'Batuk berdahak dan pilek sejak {n} hari, tenggorokan terasa gatal. Demam naik turun. Nafsu makan sedikit menurun.',
      o: 'Faring hiperemis ringan, tonsil T1-T1 tenang. Rhonki (-), wheezing (-). Retraksi (-).',
      p: 'Istirahat cukup, perbanyak minum hangat. Kontrol bila demam menetap > 3 hari atau timbul sesak.',
      rx: ['paracetamol', 'gg', 'cetirizine'] },
    { code: 'I10', poli: 'umum',
      s: 'Kontrol rutin hipertensi. Kadang nyeri tengkuk pagi hari. Obat diminum teratur, tidak ada keluhan lain.',
      o: 'Kesadaran kompos mentis. Jantung S1-S2 reguler, murmur (-). Edema tungkai (-).',
      p: 'Lanjutkan antihipertensi, batasi garam < 5 g/hari, aktivitas fisik 30 menit 5x/minggu. Kontrol 1 bulan.',
      rx: ['amlodipin'], tindakan: [] },
    { code: 'K29.7', poli: 'umum',
      s: 'Nyeri ulu hati sejak {n} hari, terasa perih terutama saat telat makan. Mual (+), muntah (-).',
      o: 'Nyeri tekan epigastrium (+). Bising usus normal. Defans muskular (-).',
      p: 'Makan teratur porsi kecil sering, hindari pedas, asam dan kopi. Kontrol bila nyeri menetap atau BAB hitam.',
      rx: ['omeprazol', 'antasida'] },
    { code: 'A09', poli: 'umum',
      s: 'BAB cair {n}x sehari sejak kemarin, tanpa lendir dan darah. Mual (+). Masih mau minum.',
      o: 'Turgor kulit baik, mata tidak cekung. Bising usus meningkat. Tanda dehidrasi berat (-).',
      p: 'Rehidrasi oral setiap kali BAB cair. Zinc 10 hari berturut-turut. Segera kembali bila muntah terus atau lemas.',
      rx: ['oralit', 'zinc', 'paracetamol'] },
    { code: 'E11.9', poli: 'umum',
      s: 'Kontrol DM tipe 2. Gula darah terakhir belum diperiksa. Tidak ada keluhan kesemutan atau luka sulit sembuh.',
      o: 'Kesadaran kompos mentis. Pemeriksaan kaki: sensasi raba baik, tidak ada ulkus.',
      p: 'Lanjutkan metformin, atur pola makan, cek GDP tiap bulan. Edukasi perawatan kaki.',
      rx: ['metformin'], tindakan: ['gds'] },
    { code: 'M10.9', poli: 'umum',
      s: 'Nyeri dan bengkak pada pangkal ibu jari kaki sejak {n} hari, muncul mendadak malam hari.',
      o: 'MTP-1 edema, hiperemis, nyeri tekan hebat. Rentang gerak terbatas karena nyeri.',
      p: 'Hindari jeroan, seafood dan alkohol. Perbanyak minum air putih. Kontrol asam urat 2 minggu.',
      rx: ['kolkisin', 'paracetamol'], tindakan: ['asam-urat'] },
    { code: 'J45.9', poli: 'umum',
      s: 'Sesak dan mengi kambuh sejak semalam, dipicu debu. Batuk kering. Masih bisa bicara kalimat penuh.',
      o: 'Wheezing ekspirasi di kedua lapang paru. Retraksi (-). Bicara lancar.',
      p: 'Hindari pencetus. Inhaler pelega bila sesak. Kontrol bila serangan makin sering.',
      rx: ['salbutamol-inh'], tindakan: ['nebulizer'] },
    { code: 'N39.0', poli: 'umum',
      s: 'Nyeri saat berkemih dan anyang-anyangan sejak {n} hari. Demam ringan. Nyeri pinggang (-).',
      o: 'Nyeri tekan suprapubik (+). Nyeri ketok CVA (-).',
      p: 'Perbanyak minum air putih, jangan menahan kencing, habiskan antibiotik.',
      rx: ['siprofloksasin', 'paracetamol'] },
    { code: 'L23.9', poli: 'umum',
      s: 'Gatal dan kemerahan di lengan sejak {n} hari, muncul setelah memakai perhiasan baru.',
      o: 'Makula eritematosa berbatas tegas dengan papul di regio antebrachii, ekskoriasi (+).',
      p: 'Hentikan kontak dengan bahan pencetus. Jangan digaruk. Kompres bila terasa panas.',
      rx: ['cetirizine', 'hidrokortison-krim'] },
    { code: 'B86', poli: 'umum',
      s: 'Gatal hebat terutama malam hari sejak {n} minggu. Anggota keluarga serumah mengalami keluhan serupa.',
      o: 'Papul dan terowongan di sela jari, pergelangan tangan dan lipat aksila. Ekskoriasi (+).',
      p: 'Obat oles ke seluruh tubuh dari leher ke bawah, didiamkan 8 jam. Seluruh anggota keluarga diobati bersamaan. Cuci dan jemur seluruh pakaian dan seprai.',
      rx: ['permetrin-krim', 'cetirizine'] },
    { code: 'A91', poli: 'umum',
      s: 'Demam tinggi mendadak sejak {n} hari disertai nyeri kepala, nyeri belakang mata dan nyeri otot. Bintik merah mulai muncul.',
      o: 'Suhu tinggi, ruam petekie di ekstremitas, uji torniket (+). Hepatomegali (-).',
      p: 'Rujuk untuk pemeriksaan darah lengkap serial. Perbanyak minum. AINS dihindari — parasetamol saja.',
      rx: ['paracetamol', 'oralit'] },
    { code: 'G44.2', poli: 'umum',
      s: 'Nyeri kepala seperti diikat di kedua sisi sejak {n} hari, memberat saat banyak pekerjaan.',
      o: 'Nyeri tekan otot perikranial. Pemeriksaan neurologis dalam batas normal.',
      p: 'Perbaiki postur dan pola tidur, kurangi layar sebelum tidur. Kontrol bila nyeri berubah karakter.',
      rx: ['paracetamol', 'vit-b-kompleks'] },
    { code: 'K02.9', poli: 'gigi',
      s: 'Gigi geraham bawah kanan berlubang dan ngilu bila kena air dingin sejak {n} minggu.',
      o: 'Karies media pada gigi 46, tes vitalitas (+), perkusi (-), sondasi (+).',
      p: 'Tumpatan pada kunjungan ini. Edukasi sikat gigi 2x sehari dengan teknik yang benar.',
      rx: ['paracetamol'], tindakan: ['tambal-gigi'] },
    { code: 'K04.7', poli: 'gigi',
      s: 'Gusi bengkak dan berdenyut sejak {n} hari, sulit mengunyah. Wajah sedikit bengkak.',
      o: 'Pembengkakan vestibular regio 36, perkusi (++), fluktuasi (+). Gigi non-vital.',
      p: 'Antibiotik dan analgesik, kembali 3 hari untuk perawatan saluran akar atau ekstraksi.',
      rx: ['ko-amoksiklav', 'as-mefenamat'], tindakan: ['injeksi'] },
    { code: 'K05.3', poli: 'gigi',
      s: 'Gusi mudah berdarah saat sikat gigi sejak beberapa bulan. Bau mulut dirasakan mengganggu.',
      o: 'Kalkulus supragingiva generalisata, poket 4 mm regio posterior, perdarahan saat probing (+).',
      p: 'Skeling hari ini, kontrol 6 bulan. Edukasi flossing.',
      rx: [], tindakan: ['skeling'] },
    { code: 'Z34.9', poli: 'kia',
      s: 'Kontrol kehamilan rutin. Gerak janin dirasakan aktif. Tidak ada perdarahan atau keluar cairan.',
      o: 'TFU sesuai usia kehamilan, DJJ 142 x/menit reguler. Edema tungkai minimal.',
      p: 'Tablet tambah darah diteruskan, kontrol 4 minggu atau sewaktu bila ada keluhan. Edukasi tanda bahaya kehamilan.',
      rx: ['sf', 'as-folat', 'kalsium-laktat'], tindakan: ['anc'] },
    { code: 'D50.9', poli: 'kia',
      s: 'Sering pusing dan cepat lelah sejak {n} minggu. Sedang hamil trimester dua.',
      o: 'Konjungtiva palpebra pucat. Takikardia ringan. Kuku tidak sendok.',
      p: 'Tablet tambah darah 1x1 diminum bersama vitamin C, hindari bersamaan teh atau kopi. Cek Hb ulang 1 bulan.',
      rx: ['sf', 'vit-c'], tindakan: ['anc'] },
    { code: 'Z30.4', poli: 'kia',
      s: 'Datang untuk KB suntik 3 bulan sesuai jadwal. Tidak ada keluhan perdarahan.',
      o: 'Tekanan darah dalam batas normal, berat badan stabil.',
      p: 'Suntik sesuai jadwal, kembali 3 bulan. Edukasi efek samping bercak.',
      rx: [], tindakan: ['kb-suntik'] },
    { code: 'Z00.1', poli: 'kia',
      s: 'Bayi dibawa untuk imunisasi sesuai jadwal. Tidak demam, menyusu kuat.',
      o: 'Berat badan naik sesuai kurva. Tidak ada tanda infeksi akut.',
      p: 'Imunisasi diberikan. Edukasi demam ringan pasca-imunisasi dan penanganannya.',
      rx: ['paracetamol-syr'], tindakan: [] },
    { code: 'H61.2', poli: 'umum',
      s: 'Telinga kanan terasa penuh dan pendengaran berkurang sejak {n} hari.',
      o: 'Liang telinga kanan tertutup serumen padat. Membran timpani tidak terlihat.',
      p: 'Ekstraksi serumen hari ini. Hindari cotton bud.',
      rx: [], tindakan: ['ganti-verban'] },
    { code: 'T14.1', poli: 'umum',
      s: 'Luka robek di tungkai bawah kanan akibat terjatuh dari sepeda sekitar {n} jam lalu.',
      o: 'Vulnus laceratum regio cruris dextra ± 4 cm, tepi tidak rata, perdarahan aktif minimal. Neurovaskular distal baik.',
      p: 'Hecting, kontrol luka 3 hari, angkat jahitan hari ke-10. Status tetanus dievaluasi.',
      rx: ['amoksisilin', 'as-mefenamat'], tindakan: ['jahit-luka'] },
    { code: 'M54.5', poli: 'umum',
      s: 'Nyeri pinggang bawah sejak {n} hari setelah mengangkat beban berat. Tidak menjalar ke tungkai.',
      o: 'Nyeri tekan paravertebral lumbal. Laseque (-), refleks fisiologis normal.',
      p: 'Kompres hangat, hindari mengangkat beban, latihan penguatan inti tubuh bertahap.',
      rx: ['na-diklofenak', 'vit-b-kompleks'] },
    { code: 'H10.9', poli: 'umum',
      s: 'Mata kanan merah dan belekan sejak {n} hari. Penglihatan tidak kabur.',
      o: 'Injeksi konjungtiva OD, sekret mukopurulen, kornea jernih, visus normal.',
      p: 'Jangan mengucek mata, cuci tangan, handuk tidak dipakai bersama.',
      rx: ['kloramfenikol-td'] },
    { code: 'J30.4', poli: 'umum',
      s: 'Bersin berulang pagi hari, hidung meler bening dan gatal sejak {n} minggu.',
      o: 'Konka inferior edema pucat, sekret serosa. Faring tenang.',
      p: 'Hindari debu dan tungau, cuci sprei air panas rutin.',
      rx: ['loratadine'] }
  ];

  var CHRONIC_POOL = [
    { code: 'I10', drugs: ['amlodipin'] },
    { code: 'E11.9', drugs: ['metformin'] },
    { code: 'J45.9', drugs: ['salbutamol-inh'] },
    { code: 'E78.5', drugs: ['simvastatin'] },
    { code: 'N18.9', drugs: [] },
    { code: 'M10.9', drugs: ['allopurinol'] }
  ];

  var STAFF = [
    { id: 'stf-01', name: 'Rania Wardhika', role: 'pendaftaran', title: 'Petugas Pendaftaran' },
    { id: 'stf-02', name: 'Hasnur Priatna', role: 'perawat', title: 'Perawat Pelaksana', sip: 'SIPP-FIKTIF-01' },
    { id: 'stf-03', name: 'dr. Maritsa Kandara', role: 'dokter', title: 'Dokter Umum', sip: 'SIP-FIKTIF-11', poli: 'umum' },
    { id: 'stf-04', name: 'dr. Yudhan Sarwaka', role: 'dokter', title: 'Dokter Umum', sip: 'SIP-FIKTIF-12', poli: 'umum' },
    { id: 'stf-05', name: 'drg. Lestrani Ambara', role: 'dokter', title: 'Dokter Gigi', sip: 'SIP-FIKTIF-21', poli: 'gigi' },
    { id: 'stf-06', name: 'apt. Danurwenda Prasista', role: 'apoteker', title: 'Apoteker Penanggung Jawab', sip: 'SIPA-FIKTIF-31' }
  ];

  function iso(date) {
    return date.getFullYear() + '-' + D.pad(date.getMonth() + 1, 2) + '-' + D.pad(date.getDate(), 2);
  }

  function addDays(base, n) {
    var d = new Date(base.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  // Minutes are allowed to overflow (callers do `minute + 45`), so build the
  // date at midnight and add the offset rather than formatting "09:70".
  function at(dateStr, h, m) {
    var base = new Date(dateStr + 'T00:00:00');
    return new Date(base.getTime() + (h * 60 + m) * 60000);
  }

  /**
   * build(opts) -> Promise<Clinic>
   * opts.today: Date used as "now" (tests pin it; the app passes the real one).
   * opts.seed:  PRNG seed. Same seed + same today = byte-identical clinic.
   */
  function build(opts) {
    opts = opts || {};
    var rand = D.rng(opts.seed == null ? 20260908 : opts.seed);
    var today = opts.today || new Date();
    var todayStr = iso(today);

    var clock = new Date(today.getTime());
    var clinic = new R.Clinic({ now: function () { return clock; } });
    clinic.state.staff = STAFF.slice();

    function asRole(roleId) {
      var s = STAFF.filter(function (x) { return x.role === roleId; })[0];
      clinic.actor = { id: s.id, name: s.name, role: s.role };
      return s;
    }
    function asStaff(id) {
      var s = clinic.staff(id);
      clinic.actor = { id: s.id, name: s.name, role: s.role };
      return s;
    }
    function setClock(dateStr, h, m) { clock = at(dateStr, h, m); }

    /* --------------------------------------------------------- patients */

    var N_PATIENTS = 24;
    var patients = [];
    var chain = Promise.resolve();

    for (var i = 0; i < N_PATIENTS; i++) {
      (function (i) {
        chain = chain.then(function () {
          var sex = rand() < 0.52 ? 'P' : 'L';
          // A spread that mirrors an actual clinic day: mostly working-age
          // adults, a real paediatric tail, a real elderly tail.
          var r = rand();
          var age = r < 0.18 ? D.intBetween(rand, 0, 12)
            : r < 0.28 ? D.intBetween(rand, 13, 21)
              : r < 0.78 ? D.intBetween(rand, 22, 55)
                : D.intBetween(rand, 56, 84);
          var dobY = today.getFullYear() - age;
          var dob = dobY + '-' + D.pad(D.intBetween(rand, 1, 12), 2) + '-' + D.pad(D.intBetween(rand, 1, 28), 2);

          var allergies = [];
          if (rand() < 0.22) allergies.push(D.pick(rand, ['penisilin', 'nsaid', 'sulfonamid']));

          var chronic = [];
          if (age > 40 && rand() < 0.5) chronic.push(D.pick(rand, CHRONIC_POOL).code);
          if (age > 55 && rand() < 0.3) {
            var extra = D.pick(rand, CHRONIC_POOL).code;
            if (chronic.indexOf(extra) < 0) chronic.push(extra);
          }

          var pregnant = sex === 'P' && age >= 20 && age <= 40 && rand() < 0.16;

          setClock(iso(addDays(today, -D.intBetween(rand, 1, 400))), 9, 0);
          asRole('pendaftaran');
          return clinic.registerPatient({
            name: personName(rand, sex),
            sex: sex, dob: dob,
            phone: '08' + D.intBetween(rand, 10, 99) + '-FIKTIF-' + D.pad(i + 1, 3),
            address: 'Alamat contoh no. ' + D.intBetween(rand, 1, 90) + ', RT ' + D.pad(D.intBetween(rand, 1, 12), 2),
            klass: rand() < 0.68 ? 'bpjs' : 'umum',
            allergies: allergies,
            allergyNote: allergies.length ? 'Riwayat ruam menyeluruh setelah pemberian obat golongan ini (data fiktif).' : '',
            chronic: chronic,
            pregnant: pregnant
          }).then(function (res) {
            if (res.ok) patients.push(res.patient);
          });
        });
      })(i);
    }

    /* ------------------------------------------- one guaranteed edge case
     * A patient on warfarin with a penicillin allergy, so the safety engine
     * has something real to catch the moment a visitor opens the app rather
     * than only in the test tab.
     */
    chain = chain.then(function () {
      setClock(iso(addDays(today, -220)), 9, 0);
      asRole('pendaftaran');
      return clinic.registerPatient({
        name: 'Suprihatna Belunggar',
        sex: 'L', dob: (today.getFullYear() - 67) + '-04-11',
        phone: '081-FIKTIF-999',
        address: 'Alamat contoh no. 7, RT 03',
        klass: 'bpjs',
        allergies: ['penisilin'],
        allergyNote: 'Urtikaria menyeluruh 30 menit setelah amoksisilin (data fiktif).',
        chronic: ['I48', 'I10'],
        pregnant: false
      }).then(function (res) { if (res.ok) patients.push(res.patient); });
    });

    /* ------------------------------------------------- historical visits */

    function fullVisit(p, dateStr, hour, minute, pres, doctorId, opts2) {
      opts2 = opts2 || {};
      var visitRef = null, encRef = null, rxRef = null;
      var age = clinic.age(p, dateStr);

      return Promise.resolve()
        .then(function () {
          setClock(dateStr, hour, minute);
          asRole('pendaftaran');
          return clinic.openVisit({
            rmNumber: p.rmNumber, poli: pres.poli, klass: p.klass, date: dateStr,
            complaint: pres.s.split('.')[0].replace('{n}', String(D.intBetween(rand, 2, 6))),
            doctorId: doctorId
          });
        })
        .then(function (res) {
          if (!res.ok) return null;
          visitRef = res.visit;
          return clinic.transition(visitRef.id, 'triase');
        })
        .then(function (res) {
          if (!visitRef || !res || !res.ok) return null;
          setClock(dateStr, hour, minute + 8);
          asRole('perawat');
          var hyper = (p.chronic || []).indexOf('I10') >= 0;
          var febrile = ['A09', 'A91', 'J06.9', 'K04.7'].indexOf(pres.code) >= 0;
          var t = {
            tdSistol: hyper ? D.intBetween(rand, 138, 168) : D.intBetween(rand, 105, 132),
            tdDiastol: hyper ? D.intBetween(rand, 84, 102) : D.intBetween(rand, 65, 84),
            nadi: febrile ? D.intBetween(rand, 88, 112) : D.intBetween(rand, 62, 92),
            suhu: febrile ? Math.round((37.6 + rand() * 1.8) * 10) / 10 : Math.round((36.3 + rand() * 0.8) * 10) / 10,
            rr: D.intBetween(rand, 14, 21),
            spo2: pres.code === 'J45.9' ? D.intBetween(rand, 93, 97) : D.intBetween(rand, 96, 99),
            bb: age < 13 ? D.intBetween(rand, 8, 40) : D.intBetween(rand, 44, 92),
            tb: age < 13 ? D.intBetween(rand, 70, 150) : D.intBetween(rand, 148, 180),
            note: ''
          };
          return clinic.recordTriage(visitRef.id, t);
        })
        .then(function () {
          if (!visitRef) return null;
          return clinic.transition(visitRef.id, 'menunggu-dokter');
        })
        .then(function () {
          if (!visitRef) return null;
          setClock(dateStr, hour, minute + 25);
          asStaff(doctorId);
          return clinic.transition(visitRef.id, 'konsultasi');
        })
        .then(function () {
          if (!visitRef) return null;
          return clinic.startEncounter(visitRef.id);
        })
        .then(function (res) {
          if (!visitRef || !res || !res.ok) return null;
          encRef = res.encounter;
          var n = String(D.intBetween(rand, 2, 6));
          var assessment = [{ code: pres.code, primary: true, note: '' }];
          (p.chronic || []).forEach(function (c) {
            if (c !== pres.code && R.icd.get(c) && assessment.length < 3) {
              assessment.push({ code: c, primary: false, note: 'Komorbid, terkontrol.' });
            }
          });
          return clinic.saveEncounter(encRef.id, {
            s: pres.s.replace('{n}', n),
            exam: pres.o,
            a: assessment,
            plan: pres.p,
            edukasi: 'Pasien memahami penjelasan dan menyetujui rencana tata laksana.',
            kontrol: pres.code === 'I10' || pres.code === 'E11.9' ? '1 bulan' : 'Bila keluhan menetap'
          });
        })
        .then(function () {
          if (!encRef) return null;
          if (!(pres.tindakan || []).length) return null;
          return clinic.setTindakan(visitRef.id, pres.tindakan);
        })
        .then(function () {
          if (!encRef) return null;
          return clinic.signEncounter(encRef.id);
        })
        .then(function () {
          if (!encRef) return null;
          // Filter the template's drugs against this patient's allergies so the
          // seeded history is internally consistent — a seeded record that
          // could not have been signed would undermine the whole point.
          var items = (pres.rx || []).filter(function (id) {
            var d = R.rx.drug(id);
            if (!d) return false;
            var blocked = (p.allergies || []).some(function (aid) {
              var cls = R.rx.allergyClasses.filter(function (c) { return c.id === aid; })[0];
              return cls && cls.blocks.some(function (c) { return d.classes.indexOf(c) >= 0; });
            });
            if (blocked) return false;
            if (p.pregnant && d.classes.indexOf('teratogenik') >= 0) return false;
            if (p.pregnant && d.classes.indexOf('nsaid') >= 0) return false;
            if (age < 12 && d.classes.indexOf('nsaid') >= 0 && d.id === 'aspirin') return false;
            if (age < 18 && d.classes.indexOf('kuinolon') >= 0) return false;
            if (age < 8 && d.classes.indexOf('tetrasiklin') >= 0) return false;
            return true;
          }).map(function (id) {
            var d = R.rx.drug(id);
            var freq = D.pick(rand, ['3x sehari', '2x sehari', '1x sehari']);
            var days = D.intBetween(rand, 3, 7);
            var perDay = freq.charAt(0) === '3' ? 3 : freq.charAt(0) === '2' ? 2 : 1;
            var isTopicalOrDevice = d.form.indexOf('Krim') === 0 || d.form.indexOf('Salep') === 0 ||
              d.form === 'Inhaler' || d.form.indexOf('Tetes') === 0 || d.form === 'Sirup' || d.form === 'Suspensi';
            return {
              drugId: id, dose: isTopicalOrDevice ? 'sesuai anjuran' : '1 ' + d.form.toLowerCase(),
              freq: freq, days: days,
              qty: isTopicalOrDevice ? 1 : perDay * days,
              instruksi: d.classes.indexOf('lambung') >= 0 ? 'Sebelum makan' : 'Sesudah makan'
            };
          });
          if (!items.length) return null;
          return clinic.savePrescription(visitRef.id, items)
            .then(function (res) { rxRef = res.prescription; return clinic.signPrescription(rxRef.id, {}); })
            .then(function (res) { if (!res.ok) rxRef = null; });
        })
        .then(function () {
          if (!visitRef) return null;
          return clinic.transition(visitRef.id, rxRef ? 'farmasi' : 'kasir');
        })
        .then(function () {
          if (!rxRef) return null;
          setClock(dateStr, hour, minute + 45);
          asRole('apoteker');
          return clinic.reviewPrescription(rxRef.id, 'Telaah administratif, farmasetik dan klinis: sesuai.')
            .then(function () { return clinic.dispense(rxRef.id, { note: 'Obat diserahkan disertai penjelasan aturan pakai.' }); })
            .then(function () { return clinic.transition(visitRef.id, 'kasir'); });
        })
        .then(function () {
          if (!visitRef || opts2.stopAt === 'kasir') return null;
          setClock(dateStr, hour, minute + 55);
          asRole('pendaftaran');
          return clinic.closeBill(visitRef.id)
            .then(function () { return clinic.transition(visitRef.id, 'selesai'); });
        })
        .then(function () {
          return { visit: visitRef, encounter: encRef, prescription: rxRef };
        });
    }

    function doctorFor(poli) {
      if (poli === 'gigi') return 'stf-05';
      return rand() < 0.5 ? 'stf-03' : 'stf-04';
    }

    // 5 past clinic days, 6-9 completed visits each.
    var pastDays = [21, 14, 9, 4, 1];
    pastDays.forEach(function (back) {
      chain = chain.then(function () {
        var dateStr = iso(addDays(today, -back));
        var count = D.intBetween(rand, 6, 9);
        var seq = Promise.resolve();
        for (var k = 0; k < count; k++) {
          (function (k) {
            seq = seq.then(function () {
              var p = D.pick(rand, patients);
              var pres = pickPresentation(rand, p, clinic);
              return fullVisit(p, dateStr, 8 + Math.floor(k / 2), (k % 2) * 25, pres, doctorFor(pres.poli));
            });
          })(k);
        }
        return seq;
      });
    });

    /* ------------------------------------------------------ today's board */

    var todayVisits = [];

    // Fully finished visits from earlier this morning.
    chain = chain.then(function () {
      var seq = Promise.resolve();
      [0, 1, 2].forEach(function (k) {
        seq = seq.then(function () {
          var p = D.pick(rand, patients);
          var pres = pickPresentation(rand, p, clinic);
          return fullVisit(p, todayStr, 8, k * 12, pres, doctorFor(pres.poli))
            .then(function (r) { if (r && r.visit) todayVisits.push(r.visit); });
        });
      });
      return seq;
    });

    // One sitting at the cashier.
    chain = chain.then(function () {
      var p = D.pick(rand, patients);
      var pres = pickPresentation(rand, p, clinic);
      return fullVisit(p, todayStr, 9, 5, pres, doctorFor(pres.poli), { stopAt: 'kasir' })
        .then(function (r) { if (r && r.visit) todayVisits.push(r.visit); });
    });

    /* --------------------------------------- a signed note with an addendum
     * So the amendment UI is populated on first paint. This is the whole
     * append-only story in one visible record: the original assessment stays
     * readable, the corrected one supersedes it, and the audit chain carries
     * both plus the stated reason.
     */
    chain = chain.then(function () {
      var p = patients.filter(function (x) { return clinic.age(x) > 25; })[0] || patients[0];
      var pres = PRESENTATIONS.filter(function (x) { return x.code === 'K29.7'; })[0];
      return fullVisit(p, iso(addDays(today, -4)), 10, 30, pres, 'stf-03').then(function (r) {
        if (!r || !r.encounter) return null;
        setClock(iso(addDays(today, -4)), 16, 20);
        asStaff('stf-03');
        return clinic.addAddendum(r.encounter.id, {
          path: 'a',
          newValue: [
            { code: 'K21.9', primary: true, note: 'Gejala lebih sesuai refluks setelah anamnesis ulang.' },
            { code: 'K29.7', primary: false, note: 'Diagnosis awal, dipertahankan sebagai diagnosis sekunder.' }
          ],
          reason: 'Koreksi diagnosis utama setelah pasien menelepon sore ini dan menjelaskan gejala rasa terbakar naik ke dada saat berbaring, yang tidak tergali saat konsultasi.'
        }).then(function () {
          setClock(iso(addDays(today, -4)), 16, 24);
          return clinic.addAddendum(r.encounter.id, {
            path: 'p.plan',
            newValue: 'Tata laksana refluks: PPI pagi sebelum makan, hindari makan 3 jam sebelum berbaring, tinggikan kepala tempat tidur 15 cm. Kontrol 2 minggu.',
            reason: 'Rencana tata laksana disesuaikan mengikuti koreksi diagnosis utama pada adendum ADD-0001.'
          });
        });
      });
    });

    /* ------------------------------------------------ live queue for today */

    var LIVE = [
      { status: 'terdaftar', h: 10, m: 5 },
      { status: 'terdaftar', h: 10, m: 12 },
      { status: 'triase', h: 9, m: 50 },
      { status: 'menunggu-dokter', h: 9, m: 35 },
      { status: 'menunggu-dokter', h: 9, m: 42 },
      { status: 'konsultasi', h: 9, m: 20 },
      { status: 'farmasi', h: 9, m: 10 }
    ];

    LIVE.forEach(function (spec) {
      chain = chain.then(function () {
        var p = D.pick(rand, patients);
        var pres = pickPresentation(rand, p, clinic);
        var doctorId = doctorFor(pres.poli);
        var v = null, enc = null, rxRef = null;
        return Promise.resolve()
          .then(function () {
            setClock(todayStr, spec.h, spec.m);
            asRole('pendaftaran');
            return clinic.openVisit({
              rmNumber: p.rmNumber, poli: pres.poli, klass: p.klass, date: todayStr,
              complaint: pres.s.split('.')[0].replace('{n}', String(D.intBetween(rand, 2, 6))),
              doctorId: doctorId
            });
          })
          .then(function (res) {
            if (!res.ok) return null;
            v = res.visit;
            todayVisits.push(v);
            if (spec.status === 'terdaftar') return null;
            return clinic.transition(v.id, 'triase');
          })
          .then(function () {
            if (!v || spec.status === 'terdaftar' || spec.status === 'triase') return null;
            asRole('perawat');
            setClock(todayStr, spec.h, spec.m + 7);
            var age = clinic.age(p);
            return clinic.recordTriage(v.id, {
              tdSistol: D.intBetween(rand, 108, 158), tdDiastol: D.intBetween(rand, 68, 96),
              nadi: D.intBetween(rand, 66, 104), suhu: Math.round((36.4 + rand() * 1.9) * 10) / 10,
              rr: D.intBetween(rand, 14, 22), spo2: D.intBetween(rand, 95, 99),
              bb: age < 13 ? D.intBetween(rand, 9, 38) : D.intBetween(rand, 45, 90),
              tb: age < 13 ? D.intBetween(rand, 72, 148) : D.intBetween(rand, 150, 178)
            }).then(function () { return clinic.transition(v.id, 'menunggu-dokter'); });
          })
          .then(function () {
            if (!v || ['terdaftar', 'triase', 'menunggu-dokter'].indexOf(spec.status) >= 0) return null;
            setClock(todayStr, spec.h, spec.m + 20);
            asStaff(doctorId);
            return clinic.transition(v.id, 'konsultasi').then(function () {
              return clinic.startEncounter(v.id);
            }).then(function (res) {
              enc = res.encounter;
              if (spec.status === 'konsultasi') {
                // Left mid-consultation on purpose: a draft SOAP note waiting
                // for the doctor, which is what the board actually looks like.
                return clinic.saveEncounter(enc.id, {
                  s: pres.s.replace('{n}', String(D.intBetween(rand, 2, 5))),
                  exam: '', a: [], plan: ''
                });
              }
              return clinic.saveEncounter(enc.id, {
                s: pres.s.replace('{n}', String(D.intBetween(rand, 2, 5))),
                exam: pres.o,
                a: [{ code: pres.code, primary: true, note: '' }],
                plan: pres.p,
                edukasi: 'Pasien memahami penjelasan yang diberikan.'
              }).then(function () { return clinic.signEncounter(enc.id); });
            });
          })
          .then(function () {
            if (!v || spec.status !== 'farmasi') return null;
            var items = (pres.rx || []).slice(0, 2).filter(function (id) {
              var d = R.rx.drug(id);
              if (!d) return false;
              return !(p.allergies || []).some(function (aid) {
                var cls = R.rx.allergyClasses.filter(function (c) { return c.id === aid; })[0];
                return cls && cls.blocks.some(function (c) { return d.classes.indexOf(c) >= 0; });
              });
            }).map(function (id) {
              var d = R.rx.drug(id);
              return { drugId: id, dose: '1 ' + d.form.toLowerCase(), freq: '3x sehari', days: 5, qty: 15, instruksi: 'Sesudah makan' };
            });
            if (!items.length) items = [{ drugId: 'paracetamol', dose: '1 tablet', freq: '3x sehari', days: 5, qty: 15, instruksi: 'Sesudah makan' }];
            return clinic.savePrescription(v.id, items)
              .then(function (res) { rxRef = res.prescription; return clinic.signPrescription(rxRef.id, {}); })
              .then(function (res) {
                if (!res.ok) return null;
                return clinic.transition(v.id, 'farmasi');
              });
          });
      });
    });

    /* ---- and one deliberately awkward case waiting for the doctor ------- */
    chain = chain.then(function () {
      var p = patients.filter(function (x) { return (x.allergies || []).indexOf('penisilin') >= 0; })[0];
      if (!p) return null;
      var v = null;
      setClock(todayStr, 10, 20);
      asRole('pendaftaran');
      return clinic.openVisit({
        rmNumber: p.rmNumber, poli: 'umum', klass: p.klass, date: todayStr,
        complaint: 'Nyeri lutut kanan sejak 3 hari, memberat saat berjalan',
        doctorId: 'stf-03'
      }).then(function (res) {
        if (!res.ok) return null;
        v = res.visit;
        todayVisits.push(v);
        return clinic.transition(v.id, 'triase');
      }).then(function () {
        if (!v) return null;
        asRole('perawat');
        setClock(todayStr, 10, 28);
        return clinic.recordTriage(v.id, {
          tdSistol: 152, tdDiastol: 94, nadi: 78, suhu: 36.7, rr: 18, spo2: 98, bb: 74, tb: 165
        });
      }).then(function () {
        if (!v) return null;
        return clinic.transition(v.id, 'menunggu-dokter');
      });
    });

    return chain.then(function () {
      clinic.actor = { id: 'stf-03', name: 'dr. Maritsa Kandara', role: 'dokter' };
      clock = today;
      clinic.now = function () { return new Date(); };
      return clinic;
    });
  }

  // Pick a presentation that suits the patient: KIA only for women of
  // reproductive age or infants, dentistry for anyone, chronic follow-ups for
  // people who actually have that chronic problem on file.
  function pickPresentation(rand, p, clinic) {
    var age = clinic.age(p);
    var pool = PRESENTATIONS.filter(function (pr) {
      if (pr.poli === 'kia') {
        if (pr.code === 'Z00.1') return age <= 2;
        return p.sex === 'P' && age >= 17 && age <= 45;
      }
      if (pr.code === 'Z34.9' || pr.code === 'D50.9') return p.pregnant;
      if (['I10', 'E11.9', 'J45.9', 'M10.9'].indexOf(pr.code) >= 0) {
        return (p.chronic || []).indexOf(pr.code) >= 0;
      }
      if (pr.code === 'K05.3' && age < 16) return false;
      return true;
    });
    if (!pool.length) pool = PRESENTATIONS.filter(function (pr) { return pr.poli === 'umum' && pr.code === 'J06.9'; });
    return D.pick(rand, pool);
  }

  R.seed = { build: build, STAFF: STAFF, PRESENTATIONS: PRESENTATIONS, personName: personName };
})(typeof self !== 'undefined' ? self : this);
