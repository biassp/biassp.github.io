/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — drugs.js
 * Formulary + the prescription safety engine.
 *
 * The formulary is generic-name based and modelled on what a puskesmas or a
 * klinik pratama actually stocks under Fornas/DOEN: paracetamol, amoksisilin,
 * amlodipin, metformin, not brand names.
 *
 * WHAT THIS IS NOT. This is a demonstration of the SHAPE of a clinical
 * decision-support check — a curated rule set, deterministic severity grading,
 * a hard stop that a prescriber cannot click past silently. It is not a
 * clinical reference and must never be used to treat anyone. Real deployments
 * license a maintained interaction database (Stockley, Lexicomp, or in
 * Indonesia a Fornas-derived set) and revalidate it continuously. The rules
 * below are well-established textbook pairs, chosen because they are
 * checkable, not because 40 rules are enough.
 *
 * Severity ladder, and what each one DOES — the grading is the whole point,
 * because a system that warns about everything gets clicked through:
 *   kontraindikasi  hard stop. Signing is refused. No override path.
 *   mayor           stop, overridable only with a typed clinical reason, and
 *                   the override is written into the audit chain as its own
 *                   entry naming the prescriber.
 *   moderat         warn, acknowledge to continue.
 *   minor           informational, usually a timing or monitoring note.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});

  /* ------------------------------------------------------------- formulary */

  // id, generic name, form, strength, class tags, price (IDR per unit),
  // covered by BPJS at FKTP level.
  var RAW_DRUGS = [
    ['paracetamol', 'Paracetamol', 'Tablet', '500 mg', ['analgesik', 'antipiretik'], 500, true],
    ['paracetamol-syr', 'Paracetamol sirup', 'Sirup', '120 mg/5 mL', ['analgesik', 'antipiretik', 'pediatrik'], 12000, true],
    ['ibuprofen', 'Ibuprofen', 'Tablet', '400 mg', ['nsaid', 'analgesik'], 700, true],
    ['na-diklofenak', 'Natrium diklofenak', 'Tablet', '50 mg', ['nsaid', 'analgesik'], 900, true],
    ['as-mefenamat', 'Asam mefenamat', 'Tablet', '500 mg', ['nsaid', 'analgesik'], 800, true],
    ['aspirin', 'Asam asetilsalisilat', 'Tablet', '80 mg', ['nsaid', 'antiplatelet'], 400, true],
    ['klopidogrel', 'Klopidogrel', 'Tablet', '75 mg', ['antiplatelet'], 3500, true],
    ['warfarin', 'Warfarin', 'Tablet', '2 mg', ['antikoagulan'], 2500, true],

    ['amoksisilin', 'Amoksisilin', 'Kaplet', '500 mg', ['antibiotik', 'penisilin'], 800, true],
    ['amoksisilin-syr', 'Amoksisilin sirup kering', 'Sirup', '125 mg/5 mL', ['antibiotik', 'penisilin', 'pediatrik'], 16000, true],
    ['ko-amoksiklav', 'Amoksisilin-klavulanat', 'Kaplet', '500/125 mg', ['antibiotik', 'penisilin'], 4500, true],
    ['sefadroksil', 'Sefadroksil', 'Kapsul', '500 mg', ['antibiotik', 'sefalosporin'], 2200, true],
    ['sefiksim', 'Sefiksim', 'Kapsul', '100 mg', ['antibiotik', 'sefalosporin'], 3800, true],
    ['siprofloksasin', 'Siprofloksasin', 'Tablet', '500 mg', ['antibiotik', 'kuinolon'], 1500, true],
    ['levofloksasin', 'Levofloksasin', 'Tablet', '500 mg', ['antibiotik', 'kuinolon'], 4200, true],
    ['kotrimoksazol', 'Kotrimoksazol', 'Tablet', '480 mg', ['antibiotik', 'sulfonamid'], 600, true],
    ['eritromisin', 'Eritromisin', 'Kapsul', '500 mg', ['antibiotik', 'makrolida'], 1400, true],
    ['azitromisin', 'Azitromisin', 'Tablet', '500 mg', ['antibiotik', 'makrolida'], 6500, true],
    ['klaritromisin', 'Klaritromisin', 'Tablet', '500 mg', ['antibiotik', 'makrolida'], 7800, true],
    ['doksisiklin', 'Doksisiklin', 'Kapsul', '100 mg', ['antibiotik', 'tetrasiklin'], 1200, true],
    ['metronidazol', 'Metronidazol', 'Tablet', '500 mg', ['antibiotik', 'antiprotozoa'], 700, true],
    ['rifampisin', 'Rifampisin', 'Kapsul', '450 mg', ['antituberkulosis', 'penginduksi-enzim'], 1800, true],
    ['isoniazid', 'Isoniazid', 'Tablet', '300 mg', ['antituberkulosis'], 500, true],

    ['ambroksol', 'Ambroksol', 'Tablet', '30 mg', ['mukolitik'], 700, true],
    ['gg', 'Gliseril guaiakolat', 'Tablet', '100 mg', ['ekspektoran'], 300, true],
    ['salbutamol', 'Salbutamol', 'Tablet', '2 mg', ['bronkodilator', 'beta-agonis'], 500, true],
    ['salbutamol-inh', 'Salbutamol inhaler', 'Inhaler', '100 mcg/dosis', ['bronkodilator', 'beta-agonis'], 78000, true],
    ['budesonid-inh', 'Budesonid inhaler', 'Inhaler', '200 mcg/dosis', ['kortikosteroid-inhalasi'], 145000, true],

    ['cetirizine', 'Setirizin', 'Tablet', '10 mg', ['antihistamin'], 700, true],
    ['loratadine', 'Loratadin', 'Tablet', '10 mg', ['antihistamin'], 800, true],
    ['ctm', 'Klorfeniramin maleat', 'Tablet', '4 mg', ['antihistamin', 'sedatif'], 250, true],
    ['deksametason', 'Deksametason', 'Tablet', '0,5 mg', ['kortikosteroid'], 350, true],
    ['metilprednisolon', 'Metilprednisolon', 'Tablet', '4 mg', ['kortikosteroid'], 900, true],
    ['prednison', 'Prednison', 'Tablet', '5 mg', ['kortikosteroid'], 400, true],

    ['omeprazol', 'Omeprazol', 'Kapsul', '20 mg', ['ppi', 'lambung'], 1100, true],
    ['lansoprazol', 'Lansoprazol', 'Kapsul', '30 mg', ['ppi', 'lambung'], 1600, true],
    ['antasida', 'Antasida DOEN', 'Tablet kunyah', '200/200 mg', ['antasida', 'lambung', 'kation-polivalen'], 300, true],
    ['sukralfat', 'Sukralfat', 'Suspensi', '500 mg/5 mL', ['lambung'], 22000, true],
    ['domperidon', 'Domperidon', 'Tablet', '10 mg', ['prokinetik', 'antiemetik', 'qt-prolonging'], 900, true],
    ['ondansetron', 'Ondansetron', 'Tablet', '4 mg', ['antiemetik', 'qt-prolonging'], 2800, true],
    ['oralit', 'Oralit', 'Serbuk', 'sachet 200 mL', ['rehidrasi'], 1500, true],
    ['zinc', 'Zink', 'Tablet dispersibel', '20 mg', ['mineral', 'pediatrik'], 900, true],
    ['attapulgit', 'Attapulgit', 'Tablet', '600 mg', ['adsorben'], 600, false],
    ['bisakodil', 'Bisakodil', 'Tablet', '5 mg', ['laksatif'], 800, true],

    ['amlodipin', 'Amlodipin', 'Tablet', '10 mg', ['antihipertensi', 'ccb'], 600, true],
    ['kaptopril', 'Kaptopril', 'Tablet', '25 mg', ['antihipertensi', 'ace-inhibitor', 'teratogenik'], 400, true],
    ['lisinopril', 'Lisinopril', 'Tablet', '10 mg', ['antihipertensi', 'ace-inhibitor', 'teratogenik'], 900, true],
    ['valsartan', 'Valsartan', 'Tablet', '80 mg', ['antihipertensi', 'arb', 'teratogenik'], 2400, true],
    ['bisoprolol', 'Bisoprolol', 'Tablet', '5 mg', ['antihipertensi', 'beta-bloker'], 1200, true],
    ['furosemid', 'Furosemid', 'Tablet', '40 mg', ['diuretik', 'diuretik-loop', 'sulfonamid-turunan'], 400, true],
    ['hct', 'Hidroklorotiazid', 'Tablet', '25 mg', ['diuretik', 'diuretik-tiazid', 'sulfonamid-turunan'], 350, true],
    ['spironolakton', 'Spironolakton', 'Tablet', '25 mg', ['diuretik', 'diuretik-hemat-kalium'], 900, true],
    ['digoksin', 'Digoksin', 'Tablet', '0,25 mg', ['glikosida-jantung', 'indeks-terapi-sempit'], 600, true],
    ['amiodaron', 'Amiodaron', 'Tablet', '200 mg', ['antiaritmia', 'qt-prolonging', 'penghambat-enzim'], 7500, true],
    ['simvastatin', 'Simvastatin', 'Tablet', '20 mg', ['statin', 'substrat-cyp3a4'], 700, true],
    ['atorvastatin', 'Atorvastatin', 'Tablet', '20 mg', ['statin', 'substrat-cyp3a4'], 2200, true],

    ['metformin', 'Metformin', 'Tablet', '500 mg', ['antidiabetik', 'biguanid'], 400, true],
    ['glibenklamid', 'Glibenklamid', 'Tablet', '5 mg', ['antidiabetik', 'sulfonilurea', 'sulfonamid-turunan'], 350, true],
    ['glimepirid', 'Glimepirid', 'Tablet', '2 mg', ['antidiabetik', 'sulfonilurea', 'sulfonamid-turunan'], 1400, true],
    ['allopurinol', 'Allopurinol', 'Tablet', '100 mg', ['urikostatik'], 500, true],
    ['kolkisin', 'Kolkisin', 'Tablet', '0,5 mg', ['antigout'], 1800, true],

    ['amitriptilin', 'Amitriptilin', 'Tablet', '25 mg', ['antidepresan-trisiklik', 'serotonergik'], 600, true],
    ['fluoksetin', 'Fluoksetin', 'Kapsul', '20 mg', ['ssri', 'serotonergik', 'penghambat-enzim'], 1800, true],
    ['sertralin', 'Sertralin', 'Tablet', '50 mg', ['ssri', 'serotonergik'], 2600, true],
    ['diazepam', 'Diazepam', 'Tablet', '5 mg', ['benzodiazepin', 'depresan-ssp'], 500, true],
    ['alprazolam', 'Alprazolam', 'Tablet', '0,5 mg', ['benzodiazepin', 'depresan-ssp'], 1400, true],
    ['haloperidol', 'Haloperidol', 'Tablet', '1,5 mg', ['antipsikotik', 'qt-prolonging'], 700, true],
    ['fenitoin', 'Fenitoin', 'Kapsul', '100 mg', ['antiepilepsi', 'indeks-terapi-sempit', 'penginduksi-enzim'], 900, true],
    ['karbamazepin', 'Karbamazepin', 'Tablet', '200 mg', ['antiepilepsi', 'penginduksi-enzim'], 800, true],
    ['as-valproat', 'Asam valproat', 'Tablet', '250 mg', ['antiepilepsi', 'teratogenik'], 3200, true],

    ['ketokonazol', 'Ketokonazol', 'Tablet', '200 mg', ['antijamur', 'penghambat-cyp3a4'], 1600, true],
    ['flukonazol', 'Flukonazol', 'Kapsul', '150 mg', ['antijamur', 'penghambat-cyp3a4'], 5200, true],
    ['mikonazol-krim', 'Mikonazol krim', 'Krim 2%', '10 g', ['antijamur', 'topikal'], 14000, true],
    ['hidrokortison-krim', 'Hidrokortison krim', 'Krim 2,5%', '5 g', ['kortikosteroid', 'topikal'], 11000, true],
    ['betametason-krim', 'Betametason krim', 'Krim 0,1%', '5 g', ['kortikosteroid', 'topikal'], 15000, true],
    ['permetrin-krim', 'Permetrin krim', 'Krim 5%', '30 g', ['skabisida', 'topikal'], 48000, true],
    ['gentamisin-salep', 'Gentamisin salep', 'Salep 0,1%', '5 g', ['antibiotik', 'topikal'], 12000, true],
    ['kloramfenikol-td', 'Kloramfenikol tetes mata', 'Tetes mata 0,5%', '5 mL', ['antibiotik', 'topikal', 'oftalmik'], 9000, true],

    ['sf', 'Sulfas ferosus', 'Tablet', '200 mg', ['hematinik', 'kation-polivalen'], 300, true],
    ['as-folat', 'Asam folat', 'Tablet', '1 mg', ['vitamin'], 250, true],
    ['vit-b-kompleks', 'Vitamin B kompleks', 'Tablet', '-', ['vitamin'], 300, false],
    ['vit-c', 'Vitamin C', 'Tablet', '50 mg', ['vitamin'], 250, false],
    ['kalsium-laktat', 'Kalsium laktat', 'Tablet', '500 mg', ['mineral', 'kation-polivalen'], 350, false]
  ];

  var DRUGS = RAW_DRUGS.map(function (d) {
    return {
      id: d[0], name: d[1], form: d[2], strength: d[3],
      classes: d[4], price: d[5], bpjs: d[6],
      hay: (d[1] + ' ' + d[0] + ' ' + d[4].join(' ')).toLowerCase()
    };
  });
  var BY_ID = {};
  DRUGS.forEach(function (d) { BY_ID[d.id] = d; });

  function drug(id) { return BY_ID[id] || null; }
  function has(d, cls) { return d && d.classes.indexOf(cls) >= 0; }

  function searchDrugs(q, limit) {
    var s = String(q || '').toLowerCase().trim();
    var lim = limit || 12;
    if (!s) return DRUGS.slice(0, lim);
    var out = [];
    for (var i = 0; i < DRUGS.length; i++) {
      var idx = DRUGS[i].hay.indexOf(s);
      if (idx >= 0) out.push({ d: DRUGS[i], rank: idx });
    }
    out.sort(function (a, b) { return a.rank - b.rank || (a.d.name < b.d.name ? -1 : 1); });
    return out.slice(0, lim).map(function (x) { return x.d; });
  }

  /* -------------------------------------------------- allergy cross-classes */

  // A recorded allergy is stored as a CLASS, not a product. "Alergi amoxicillin"
  // in a chart must block ampicillin and co-amoxiclav too, and a system that
  // only string-matches the product name is the classic way that fails.
  var ALLERGY_CLASSES = [
    { id: 'penisilin', label: 'Penisilin', blocks: ['penisilin'], warns: ['sefalosporin'] },
    { id: 'sefalosporin', label: 'Sefalosporin', blocks: ['sefalosporin'], warns: ['penisilin'] },
    { id: 'sulfonamid', label: 'Sulfonamid (sulfa)', blocks: ['sulfonamid'], warns: ['sulfonamid-turunan'] },
    { id: 'nsaid', label: 'NSAID / AINS', blocks: ['nsaid'], warns: [] },
    { id: 'makrolida', label: 'Makrolida', blocks: ['makrolida'], warns: [] },
    { id: 'kuinolon', label: 'Kuinolon', blocks: ['kuinolon'], warns: [] },
    { id: 'tetrasiklin', label: 'Tetrasiklin', blocks: ['tetrasiklin'], warns: [] }
  ];
  var ALLERGY_BY_ID = {};
  ALLERGY_CLASSES.forEach(function (a) { ALLERGY_BY_ID[a.id] = a; });

  /* ------------------------------------------------------ interaction rules */

  // Each rule matches on drug CLASS or drug id. `a` and `b` are matchers;
  // a matcher is { id: 'warfarin' } or { cls: 'nsaid' }.
  var INTERACTIONS = [
    { a: { id: 'warfarin' }, b: { cls: 'nsaid' }, sev: 'mayor', why: 'Antikoagulan + AINS: risiko perdarahan saluran cerna meningkat tajam (efek antiplatelet + iritasi mukosa).', act: 'Ganti ke parasetamol untuk analgesia. Bila tetap diperlukan, tambahkan PPI dan pantau INR.' },
    { a: { id: 'warfarin' }, b: { id: 'metronidazol' }, sev: 'mayor', why: 'Metronidazol menghambat metabolisme S-warfarin (CYP2C9) sehingga INR naik.', act: 'Turunkan dosis warfarin dan periksa INR dalam 3–5 hari.' },
    { a: { id: 'warfarin' }, b: { id: 'kotrimoksazol' }, sev: 'mayor', why: 'Kotrimoksazol menghambat CYP2C9 dan menggeser ikatan protein warfarin — kenaikan INR besar dan cepat.', act: 'Pilih antibiotik lain bila memungkinkan; bila tidak, pantau INR ketat.' },
    { a: { id: 'warfarin' }, b: { id: 'rifampisin' }, sev: 'mayor', why: 'Rifampisin adalah penginduksi enzim kuat: kadar warfarin turun dan pasien kehilangan proteksi antikoagulan.', act: 'Perlu penyesuaian dosis warfarin ke atas dengan pemantauan INR.' },
    { a: { id: 'warfarin' }, b: { cls: 'antiplatelet' }, sev: 'mayor', why: 'Antikoagulan + antiplatelet: risiko perdarahan aditif.', act: 'Hanya bila ada indikasi kardiologi yang jelas dan terdokumentasi.' },

    { a: { cls: 'statin' }, b: { cls: 'penghambat-cyp3a4' }, sev: 'mayor', why: 'Penghambat CYP3A4 menaikkan kadar statin berkali lipat — risiko miopati sampai rabdomiolisis.', act: 'Hentikan statin selama terapi antijamur azol, atau pindah ke statin non-CYP3A4.' },
    { a: { id: 'simvastatin' }, b: { id: 'klaritromisin' }, sev: 'kontraindikasi', why: 'Klaritromisin + simvastatin adalah kontraindikasi mutlak (rabdomiolisis terdokumentasi).', act: 'Hentikan simvastatin selama pemberian klaritromisin, atau gunakan azitromisin.' },
    { a: { id: 'simvastatin' }, b: { id: 'eritromisin' }, sev: 'mayor', why: 'Eritromisin menghambat CYP3A4 dan menaikkan paparan simvastatin.', act: 'Tunda simvastatin selama kursus eritromisin.' },
    { a: { id: 'simvastatin' }, b: { id: 'amiodaron' }, sev: 'mayor', why: 'Amiodaron menaikkan kadar simvastatin; dosis simvastatin dibatasi 20 mg/hari.', act: 'Batasi simvastatin ≤ 20 mg atau ganti ke atorvastatin dosis rendah.' },

    { a: { cls: 'ace-inhibitor' }, b: { cls: 'diuretik-hemat-kalium' }, sev: 'mayor', why: 'ACE-inhibitor + diuretik hemat kalium: hiperkalemia, dapat berujung aritmia.', act: 'Periksa kalium dan kreatinin sebelum mulai dan 1–2 minggu setelahnya.' },
    { a: { cls: 'arb' }, b: { cls: 'diuretik-hemat-kalium' }, sev: 'mayor', why: 'ARB + diuretik hemat kalium: hiperkalemia.', act: 'Pantau kalium serum.' },
    { a: { cls: 'ace-inhibitor' }, b: { cls: 'nsaid' }, sev: 'moderat', why: 'AINS menumpulkan efek antihipertensi ACE-inhibitor dan menurunkan perfusi ginjal.', act: 'Batasi durasi AINS; pantau tekanan darah dan fungsi ginjal.' },
    { a: { cls: 'arb' }, b: { cls: 'nsaid' }, sev: 'moderat', why: 'AINS menumpulkan efek ARB dan menurunkan perfusi ginjal.', act: 'Batasi durasi AINS; pantau tekanan darah.' },

    { a: { id: 'digoksin' }, b: { cls: 'diuretik-loop' }, sev: 'moderat', why: 'Diuretik loop menyebabkan hipokalemia, yang memperkuat toksisitas digoksin.', act: 'Pantau kalium; pertimbangkan suplementasi.' },
    { a: { id: 'digoksin' }, b: { cls: 'diuretik-tiazid' }, sev: 'moderat', why: 'Tiazid menyebabkan hipokalemia yang memperkuat toksisitas digoksin.', act: 'Pantau kalium serum.' },
    { a: { id: 'digoksin' }, b: { id: 'amiodaron' }, sev: 'mayor', why: 'Amiodaron menaikkan kadar digoksin hingga dua kali lipat.', act: 'Turunkan dosis digoksin 50% dan pantau kadar bila tersedia.' },

    { a: { cls: 'kuinolon' }, b: { cls: 'kation-polivalen' }, sev: 'moderat', why: 'Kation polivalen (Ca, Fe, Al, Mg) mengikat kuinolon di lumen usus; absorpsi turun sampai 90% dan terapi gagal diam-diam.', act: 'Beri jarak minimal 2 jam sebelum atau 6 jam sesudah antibiotik.' },
    { a: { cls: 'tetrasiklin' }, b: { cls: 'kation-polivalen' }, sev: 'moderat', why: 'Kelasi dengan kation polivalen menurunkan absorpsi tetrasiklin.', act: 'Beri jarak minimal 2 jam.' },
    { a: { cls: 'ppi' }, b: { id: 'ketokonazol' }, sev: 'moderat', why: 'Ketokonazol butuh suasana asam untuk larut; PPI menaikkan pH lambung dan absorpsi turun.', act: 'Pertimbangkan antijamur lain, atau beri dengan minuman asam.' },

    { a: { id: 'fenitoin' }, b: { id: 'isoniazid' }, sev: 'mayor', why: 'Isoniazid menghambat metabolisme fenitoin — risiko toksisitas fenitoin (ataksia, nistagmus).', act: 'Pantau kadar fenitoin dan gejala toksisitas.' },
    { a: { cls: 'penginduksi-enzim' }, b: { cls: 'kortikosteroid' }, sev: 'minor', why: 'Penginduksi enzim mempercepat metabolisme kortikosteroid.', act: 'Mungkin perlu dosis steroid lebih tinggi.' },

    { a: { cls: 'ssri' }, b: { cls: 'antidepresan-trisiklik' }, sev: 'mayor', why: 'Kombinasi serotonergik: risiko sindrom serotonin; fluoksetin juga menghambat metabolisme TCA.', act: 'Hindari kombinasi. Bila berganti obat, perlukan periode wash-out.' },
    { a: { cls: 'ssri' }, b: { cls: 'nsaid' }, sev: 'moderat', why: 'SSRI menurunkan agregasi trombosit; bersama AINS risiko perdarahan saluran cerna naik.', act: 'Tambahkan PPI bila terapi berlanjut.' },
    { a: { cls: 'benzodiazepin' }, b: { cls: 'depresan-ssp' }, sev: 'moderat', why: 'Depresi SSP aditif — sedasi berlebih dan risiko depresi napas.', act: 'Hindari duplikasi golongan; bila perlu, turunkan dosis keduanya.' },
    { a: { cls: 'qt-prolonging' }, b: { cls: 'qt-prolonging' }, sev: 'mayor', why: 'Dua obat pemanjang interval QT: risiko torsades de pointes.', act: 'Hindari kombinasi, atau lakukan EKG dan koreksi elektrolit.' },

    { a: { id: 'allopurinol' }, b: { cls: 'penisilin' }, sev: 'minor', why: 'Insidens ruam kulit meningkat pada pemberian bersamaan.', act: 'Beri tahu pasien; hentikan bila timbul ruam.' },
    { a: { id: 'metformin' }, b: { cls: 'diuretik-loop' }, sev: 'minor', why: 'Diuretik dapat menurunkan fungsi ginjal dan menaikkan risiko asidosis laktat.', act: 'Pantau kreatinin/eGFR.' },
    { a: { cls: 'sulfonilurea' }, b: { cls: 'beta-bloker' }, sev: 'moderat', why: 'Beta-bloker menutupi gejala adrenergik hipoglikemia (tremor, palpitasi).', act: 'Edukasi pasien untuk mengenali keringat dingin sebagai tanda tersisa.' },
    { a: { id: 'rifampisin' }, b: { cls: 'antidiabetik' }, sev: 'minor', why: 'Induksi enzim menurunkan kadar antidiabetik oral.', act: 'Pantau gula darah lebih sering selama terapi OAT.' }
  ];

  // Special-population rules: age, pregnancy, and the renal/vitals flags that a
  // clinic can actually observe without a lab.
  var POPULATION_RULES = [
    { match: { id: 'aspirin' }, when: 'ageUnder', arg: 12, sev: 'kontraindikasi', why: 'Aspirin pada anak < 12 tahun dikaitkan dengan sindrom Reye.', act: 'Gunakan parasetamol.' },
    { match: { cls: 'tetrasiklin' }, when: 'ageUnder', arg: 8, sev: 'kontraindikasi', why: 'Tetrasiklin mengendap di gigi dan tulang anak < 8 tahun (diskolorasi permanen).', act: 'Pilih antibiotik golongan lain.' },
    { match: { cls: 'kuinolon' }, when: 'ageUnder', arg: 18, sev: 'mayor', why: 'Kuinolon dikaitkan dengan artropati pada pasien yang masih tumbuh.', act: 'Gunakan hanya bila tidak ada alternatif dan manfaat jelas melebihi risiko.' },
    { match: { cls: 'teratogenik' }, when: 'pregnant', sev: 'kontraindikasi', why: 'Obat ini teratogenik / fetotoksik dan tidak boleh diberikan pada kehamilan.', act: 'Gunakan alternatif yang aman dalam kehamilan (mis. metildopa atau nifedipin untuk hipertensi).' },
    { match: { id: 'warfarin' }, when: 'pregnant', sev: 'kontraindikasi', why: 'Warfarin melewati plasenta dan menyebabkan embriopati warfarin.', act: 'Rujuk; heparin berat molekul rendah adalah alternatif dalam kehamilan.' },
    { match: { cls: 'tetrasiklin' }, when: 'pregnant', sev: 'kontraindikasi', why: 'Tetrasiklin pada kehamilan menyebabkan diskolorasi gigi janin dan toksisitas hati ibu.', act: 'Pilih antibiotik golongan lain.' },
    { match: { cls: 'nsaid' }, when: 'pregnant', sev: 'mayor', why: 'AINS pada trimester III menutup duktus arteriosus prematur dan mengganggu ginjal janin.', act: 'Parasetamol adalah analgesik pilihan dalam kehamilan.' },
    { match: { cls: 'nsaid' }, when: 'diagnosis', arg: ['N18.9'], sev: 'mayor', why: 'AINS pada penyakit ginjal kronik mempercepat penurunan fungsi ginjal.', act: 'Hindari AINS; gunakan parasetamol.' },
    { match: { cls: 'nsaid' }, when: 'diagnosis', arg: ['K29.7', 'K21.9'], sev: 'moderat', why: 'AINS memperberat gastritis / GERD.', act: 'Tambahkan gastroprotektor atau ganti ke parasetamol.' },
    { match: { cls: 'beta-bloker' }, when: 'diagnosis', arg: ['J45.9', 'J45.0', 'J46', 'J44.9'], sev: 'mayor', why: 'Beta-bloker non-selektif memicu bronkospasme pada asma / PPOK.', act: 'Bila perlu, gunakan beta-1 selektif dosis rendah dengan pemantauan.' },
    { match: { id: 'metformin' }, when: 'diagnosis', arg: ['N18.9'], sev: 'mayor', why: 'Metformin pada PGK lanjut berisiko asidosis laktat.', act: 'Sesuaikan atau hentikan berdasarkan eGFR.' }
  ];

  function matches(d, m) {
    if (!d || !m) return false;
    if (m.id) return d.id === m.id;
    if (m.cls) return has(d, m.cls);
    return false;
  }

  var SEV_RANK = { kontraindikasi: 4, mayor: 3, moderat: 2, minor: 1 };

  function sevRank(s) { return SEV_RANK[s] || 0; }

  /**
   * check(items, ctx) -> { findings, blocking, overridable, worst }
   *
   * items: [{ drugId, dose, freq, days, qty }]
   * ctx:   { age, pregnant, allergies: ['penisilin'], diagnoses: ['I10'] }
   *
   * Findings are deduplicated by (kind + subjects + rule) so that a four-drug
   * prescription does not surface the same class pair four times.
   */
  function check(items, ctx) {
    ctx = ctx || {};
    var list = (items || []).map(function (it) {
      return { it: it, d: drug(it.drugId) };
    }).filter(function (x) { return !!x.d; });

    var findings = [];
    var seen = {};
    function push(f) {
      var key = f.kind + '|' + f.rule + '|' + f.subjects.slice().sort().join(',');
      if (seen[key]) return;
      seen[key] = 1;
      findings.push(f);
    }

    /* 1. allergy */
    var allergies = ctx.allergies || [];
    allergies.forEach(function (aid) {
      var cls = ALLERGY_BY_ID[aid];
      if (!cls) return;
      list.forEach(function (x) {
        var hardHit = cls.blocks.some(function (c) { return has(x.d, c); });
        if (hardHit) {
          push({
            kind: 'alergi', rule: 'alergi:' + aid + ':blok', sev: 'kontraindikasi',
            subjects: [x.d.name],
            title: x.d.name + ' — alergi ' + cls.label + ' tercatat',
            why: 'Rekam medis pasien mencatat alergi terhadap golongan ' + cls.label + '. ' + x.d.name + ' termasuk golongan tersebut.',
            act: 'Pilih obat dari golongan lain. Tidak dapat ditandatangani.'
          });
          return;
        }
        var crossHit = cls.warns.some(function (c) { return has(x.d, c); });
        if (crossHit) {
          push({
            kind: 'alergi', rule: 'alergi:' + aid + ':silang', sev: 'moderat',
            subjects: [x.d.name],
            title: x.d.name + ' — kemungkinan reaksi silang dengan alergi ' + cls.label,
            why: 'Reaktivitas silang antara ' + cls.label + ' dan golongan obat ini dilaporkan pada sebagian kecil pasien (untuk penisilin↔sefalosporin, sekitar 1–3% pada seri modern — jauh lebih rendah dari angka 10% yang lama dikutip).',
            act: 'Boleh diberikan bila reaksi sebelumnya bukan anafilaksis. Konfirmasi jenis reaksi terdahulu dan catat di SOAP.'
          });
        }
      });
    });

    /* 2. pairwise interactions */
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var A = list[i].d, B = list[j].d;
        INTERACTIONS.forEach(function (rule, ri) {
          var hit = (matches(A, rule.a) && matches(B, rule.b)) || (matches(B, rule.a) && matches(A, rule.b));
          if (!hit) return;
          // A self-pair rule (qt + qt) must not fire on one drug against itself.
          if (A.id === B.id) return;
          push({
            kind: 'interaksi', rule: 'ix:' + ri, sev: rule.sev,
            subjects: [A.name, B.name],
            title: A.name + ' + ' + B.name,
            why: rule.why, act: rule.act
          });
        });
      }
    }

    /* 2b. the "triple whammy"
     * ACE-inhibitor (or ARB) + diuretic + NSAID together cause acute kidney
     * injury far more often than any of the three pairs does alone. It is a
     * genuinely triple interaction: check it pairwise and you miss it, which is
     * why a pairwise-only engine is not enough for a hypertensive population.
     */
    (function () {
      var raas = list.filter(function (x) { return has(x.d, 'ace-inhibitor') || has(x.d, 'arb'); });
      var diur = list.filter(function (x) { return has(x.d, 'diuretik'); });
      var nsaid = list.filter(function (x) { return has(x.d, 'nsaid') && !has(x.d, 'topikal'); });
      if (raas.length && diur.length && nsaid.length) {
        push({
          kind: 'interaksi', rule: 'triple-whammy', sev: 'mayor',
          subjects: [raas[0].d.name, diur[0].d.name, nsaid[0].d.name],
          title: 'Triple whammy: ' + raas[0].d.name + ' + ' + diur[0].d.name + ' + ' + nsaid[0].d.name,
          why: 'Penghambat RAAS + diuretik + AINS bersamaan mengganggu ketiga mekanisme autoregulasi ginjal sekaligus. Kombinasi ini adalah penyebab gagal ginjal akut yang paling sering ditemukan di layanan primer.',
          act: 'Hentikan AINS. Bila analgesia tetap dibutuhkan, gunakan parasetamol dan pantau kreatinin.'
        });
      }
    })();

    /* 3. duplicate therapy — two members of the same pharmacological class */
    var DUP_CLASSES = ['nsaid', 'ppi', 'benzodiazepin', 'antihistamin', 'ssri', 'kortikosteroid', 'statin', 'ace-inhibitor', 'sulfonilurea', 'makrolida'];
    DUP_CLASSES.forEach(function (cls) {
      var members = list.filter(function (x) { return has(x.d, cls); });
      // Topicals do not duplicate systemically; a hydrocortisone cream beside an
      // oral steroid is normal practice, not a duplication error.
      members = members.filter(function (x) { return !has(x.d, 'topikal'); });
      var names = {};
      members.forEach(function (x) { names[x.d.name] = 1; });
      var uniq = Object.keys(names);
      if (uniq.length > 1) {
        push({
          kind: 'duplikasi', rule: 'dup:' + cls, sev: cls === 'nsaid' ? 'mayor' : 'moderat',
          subjects: uniq,
          title: 'Duplikasi golongan ' + cls.toUpperCase() + ': ' + uniq.join(' + '),
          why: cls === 'nsaid'
            ? 'Dua AINS bersamaan tidak menambah efek analgesik tetapi menjumlahkan risiko perdarahan dan gangguan ginjal.'
            : 'Dua obat dari golongan yang sama memberi efek dan efek samping aditif tanpa manfaat tambahan.',
          act: 'Pertahankan satu saja.'
        });
      }
    });

    /* 4. special populations */
    POPULATION_RULES.forEach(function (rule, ri) {
      list.forEach(function (x) {
        if (!matches(x.d, rule.match)) return;
        var fire = false, ctxNote = '';
        if (rule.when === 'ageUnder') {
          fire = typeof ctx.age === 'number' && ctx.age < rule.arg;
          ctxNote = 'Usia pasien ' + ctx.age + ' tahun.';
        } else if (rule.when === 'pregnant') {
          fire = !!ctx.pregnant;
          ctxNote = 'Pasien tercatat hamil.';
        } else if (rule.when === 'diagnosis') {
          var dx = ctx.diagnoses || [];
          var hitDx = rule.arg.filter(function (c) { return dx.indexOf(c) >= 0; });
          fire = hitDx.length > 0;
          ctxNote = 'Diagnosis aktif: ' + hitDx.map(function (c) {
            return R.icd && R.icd.get(c) ? R.icd.label(c) : c;
          }).join(', ') + '.';
        }
        if (!fire) return;
        push({
          kind: 'populasi', rule: 'pop:' + ri, sev: rule.sev,
          subjects: [x.d.name],
          title: x.d.name + ' — ' + (rule.when === 'pregnant' ? 'kehamilan' : rule.when === 'ageUnder' ? 'batasan usia' : 'kondisi penyerta'),
          why: ctxNote + ' ' + rule.why, act: rule.act
        });
      });
    });

    /* 5. incomplete prescription lines — a dose-less line is not signable */
    (items || []).forEach(function (it) {
      var d = drug(it.drugId);
      var missing = [];
      if (!it.dose) missing.push('dosis');
      if (!it.freq) missing.push('frekuensi');
      if (!it.days) missing.push('durasi');
      if (!it.qty || it.qty <= 0) missing.push('jumlah');
      if (missing.length) {
        push({
          kind: 'kelengkapan', rule: 'incomplete:' + it.drugId, sev: 'kontraindikasi',
          subjects: [d ? d.name : it.drugId],
          title: (d ? d.name : it.drugId) + ' — resep belum lengkap',
          why: 'Baris resep tidak memuat ' + missing.join(', ') + '.',
          act: 'Lengkapi sebelum menandatangani. Resep tanpa aturan pakai tidak sah dan tidak dapat dilayani apotek.'
        });
      }
    });

    findings.sort(function (a, b) { return sevRank(b.sev) - sevRank(a.sev); });
    var worst = findings.length ? findings[0].sev : null;
    return {
      findings: findings,
      // Blocking = cannot be signed at all.
      blocking: findings.filter(function (f) { return f.sev === 'kontraindikasi'; }),
      // Overridable = signable only with a documented clinical reason.
      overridable: findings.filter(function (f) { return f.sev === 'mayor'; }),
      worst: worst
    };
  }

  R.rx = {
    drugs: DRUGS,
    drug: drug,
    search: searchDrugs,
    allergyClasses: ALLERGY_CLASSES,
    interactions: INTERACTIONS,
    populationRules: POPULATION_RULES,
    check: check,
    sevRank: sevRank
  };
})(typeof self !== 'undefined' ? self : this);
