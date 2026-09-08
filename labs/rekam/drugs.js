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
    ['aspirin', 'Asam asetilsalisilat', 'Tablet', '80 mg', ['antiplatelet', 'salisilat', 'nsaid-dosis-rendah'], 400, true],
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
    ['bisoprolol', 'Bisoprolol', 'Tablet', '5 mg', ['antihipertensi', 'beta-bloker', 'beta-bloker-selektif'], 1200, true],
    ['propranolol', 'Propranolol', 'Tablet', '40 mg', ['antihipertensi', 'beta-bloker', 'beta-bloker-nonselektif'], 500, true],
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
    // The allergy block deliberately spans BOTH nsaid tags: 80 mg aspirin is
    // not an analgesic-dose NSAID for interaction purposes, but it is very much
    // an NSAID for a patient with aspirin-exacerbated respiratory disease.
    { id: 'nsaid', label: 'NSAID / AINS', blocks: ['nsaid', 'nsaid-dosis-rendah', 'salisilat'], warns: [] },
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
    { a: { cls: 'ssri' }, b: { cls: 'antiplatelet' }, sev: 'moderat', why: 'SSRI menurunkan agregasi trombosit; bersama antiplatelet risiko perdarahan saluran cerna naik — berlaku juga untuk aspirin dosis antiplatelet.', act: 'Pertimbangkan gastroproteksi bila terapi berjalan lama.' },
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
    /* The beta-blocker alert used to be self-contradictory: the only
     * beta-blocker in the formulary was cardioselective, yet the text warned
     * about non-selective agents and advised switching to a beta-1 selective
     * one — telling the prescriber to replace bisoprolol with bisoprolol, at a
     * severity that demanded a typed override. Two rules now, and the
     * formulary carries propranolol so the non-selective branch has a subject.
     * Grading matches current GINA/GOLD practice: a cardioselective agent in
     * well-controlled asthma is a monitoring decision, not a near-stop. */
    { match: { cls: 'beta-bloker-nonselektif' }, when: 'diagnosis', arg: ['J45.9', 'J45.0', 'J46', 'J44.9'], sev: 'mayor', why: 'Beta-bloker non-selektif memblok reseptor beta-2 bronkus dan dapat memicu bronkospasme berat pada asma / PPOK.', act: 'Hindari. Bila indikasi kardiovaskularnya kuat, gunakan beta-1 selektif (bisoprolol) dosis rendah dengan pemantauan gejala dan APE.' },
    { match: { cls: 'beta-bloker-selektif' }, when: 'diagnosis', arg: ['J45.9', 'J45.0', 'J46', 'J44.9'], sev: 'moderat', why: 'Beta-bloker kardioselektif umumnya dapat ditoleransi pada asma / PPOK, tetapi selektivitasnya berkurang pada dosis tinggi.', act: 'Mulai dari dosis terendah, naikkan perlahan, dan pantau gejala napas serta kebutuhan pereda.' },
    { match: { id: 'metformin' }, when: 'diagnosis', arg: ['N18.9'], sev: 'mayor', why: 'Metformin pada PGK lanjut berisiko asidosis laktat.', act: 'Sesuaikan atau hentikan berdasarkan eGFR.' },

    /* DENGUE. The single prescribing rule an Indonesian FKTP most needs
     * enforced, and the one the app's own seeded plan text for A91 already
     * states ("AINS dihindari — parasetamol saja") while the engine did not
     * check it. Thrombocytopenia plus platelet inhibition plus gastric
     * erosion, in a disease whose feared complication is bleeding. */
    { match: { cls: 'nsaid' }, when: 'diagnosis', arg: ['A90', 'A91', 'D69.6'], key: 'dengue-bleeding', sev: 'kontraindikasi', why: 'AINS pada dengue / DBD dan pada trombositopenia menambah risiko perdarahan: fungsi trombosit ditekan sementara jumlahnya sudah turun, ditambah erosi mukosa lambung.', act: 'Parasetamol saja untuk demam dan nyeri. Pantau tanda perdarahan dan hematokrit.' },
    { match: { cls: 'nsaid-dosis-rendah' }, when: 'diagnosis', arg: ['A90', 'A91', 'D69.6'], key: 'dengue-bleeding', sev: 'kontraindikasi', why: 'Aspirin — termasuk dosis antiplatelet 80 mg — dihindari pada dengue / DBD dan trombositopenia karena menghambat fungsi trombosit secara ireversibel.', act: 'Hentikan sementara dan gunakan parasetamol. Keputusan menghentikan antiplatelet pada pasien jantung diambil dokter, bukan diam-diam.' },
    { match: { cls: 'antiplatelet' }, when: 'diagnosis', arg: ['A90', 'A91', 'D69.6'], key: 'dengue-bleeding', sev: 'kontraindikasi', why: 'Antiplatelet pada dengue / DBD dan trombositopenia menambah risiko perdarahan.', act: 'Tunda selama fase akut; nilai ulang setelah trombosit pulih.' },

    /* Pregnancy gaps the table used to have: doxycycline was covered, the two
     * antibiotics this clinic actually reaches for were not — and it
     * prescribes ciprofloxacin for N39.0 while modelling a KIA poli. */
    { match: { cls: 'kuinolon' }, when: 'pregnant', sev: 'kontraindikasi', why: 'Kuinolon pada kehamilan dihindari karena efek pada tulang rawan yang sedang tumbuh pada data hewan.', act: 'Untuk ISK dalam kehamilan gunakan alternatif yang aman (mis. amoksisilin, nitrofurantoin di luar trimester III) sesuai pola kepekaan setempat.' },
    { match: { cls: 'sulfonamid' }, when: 'pregnant', sev: 'mayor', why: 'Kotrimoksazol pada trimester I bersifat antagonis folat (risiko defek tabung saraf) dan pada trimester III berisiko kernikterus pada neonatus.', act: 'Pilih antibiotik lain. Bila tidak ada alternatif, berikan bersama suplementasi asam folat dan hindari mendekati aterm.' }
  ];

  /* Pharmacological classes where a second member adds toxicity without adding
   * effect, with the severity each one deserves. Value is the severity. */
  var DUP_CLASSES = {
    'nsaid': 'mayor', 'antiplatelet': 'moderat', 'salisilat': 'moderat',
    'ppi': 'moderat', 'benzodiazepin': 'mayor', 'antihistamin': 'moderat',
    'ssri': 'mayor', 'antidepresan-trisiklik': 'mayor', 'kortikosteroid': 'moderat',
    'statin': 'mayor', 'ace-inhibitor': 'mayor', 'arb': 'mayor',
    'sulfonilurea': 'mayor', 'beta-bloker': 'mayor', 'ccb': 'moderat',
    'makrolida': 'moderat', 'penisilin': 'moderat', 'sefalosporin': 'moderat',
    'kuinolon': 'moderat', 'tetrasiklin': 'moderat', 'sulfonamid': 'moderat',
    'diuretik-tiazid': 'moderat', 'diuretik-loop': 'moderat',
    'antasida': 'moderat', 'beta-agonis': 'moderat', 'laksatif': 'moderat'
  };

  /* ------------------------------------------------------------ dose limits */

  /* MAXIMUM DAILY DOSE, in the unit the strength is written in.
   *
   * The completeness check asked whether dose/freq/days/qty were non-empty and
   * never asked what was in them, so "Paracetamol 10 tablet, 4× sehari" — 20 g
   * a day, five times the hepatotoxic ceiling — signed cleanly. This table is
   * short on purpose: it covers the drugs where the ceiling is a hard number a
   * GP can recite, and the check STAYS SILENT where the signa cannot be parsed
   * rather than guessing. What it does not do is stated in the UI: this is a
   * ceiling check, not a dosing calculator, and it computes no paediatric dose.
   */
  var MAX_DAILY = {
    paracetamol: 4000, ibuprofen: 2400, 'na-diklofenak': 150, 'as-mefenamat': 1500,
    aspirin: 320, amoksisilin: 3000, 'ko-amoksiklav': 2000, sefadroksil: 2000,
    sefiksim: 400, siprofloksasin: 1500, levofloksasin: 750, kotrimoksazol: 1920,
    eritromisin: 2000, azitromisin: 500, klaritromisin: 1000, doksisiklin: 200,
    metronidazol: 2000, amlodipin: 10, kaptopril: 150, lisinopril: 40,
    valsartan: 320, bisoprolol: 10, propranolol: 320, furosemid: 160, hct: 50,
    spironolakton: 100, simvastatin: 40, atorvastatin: 80, metformin: 2000,
    glibenklamid: 20, glimepirid: 8, allopurinol: 300, ondansetron: 24,
    domperidon: 30, omeprazol: 40, lansoprazol: 60, cetirizine: 10,
    loratadine: 10, ctm: 24, deksametason: 8, metilprednisolon: 32, prednison: 60,
    salbutamol: 32, diazepam: 30, alprazolam: 4, kolkisin: 2
  };

  /* Adult solid oral forms and the age below which they are the wrong product,
   * not merely the wrong number. A 2-year-old cannot swallow a 500 mg kaplet,
   * and the paediatric equivalent already sits in the formulary. */
  var MIN_AGE_FORM = {
    paracetamol: 6, ibuprofen: 6, 'as-mefenamat': 12, 'na-diklofenak': 12,
    amoksisilin: 6, 'ko-amoksiklav': 6, sefadroksil: 6, sefiksim: 6,
    eritromisin: 6, azitromisin: 6, klaritromisin: 6, kotrimoksazol: 6,
    metronidazol: 6, cetirizine: 6, loratadine: 6, ctm: 6, ambroksol: 6,
    gg: 6, antasida: 6, domperidon: 6, attapulgit: 6
  };

  /* Reads the leading number out of a free-text field. Returns null when there
   * is nothing to read, and null is what keeps the check quiet. */
  function leadingNumber(s) {
    var m = /(\d+(?:[.,]\d+)?)/.exec(String(s == null ? '' : s));
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }

  function strengthValue(d) {
    if (!d) return null;
    // Only single-ingredient "N mg" / "N mcg" strengths are parsed. Combination
    // and per-volume strengths ("500/125 mg", "120 mg/5 mL") are left alone.
    var m = /^(\d+(?:[.,]\d+)?)\s*(mg|mcg|g)$/i.exec(String(d.strength).trim());
    if (!m) return null;
    var n = parseFloat(m[1].replace(',', '.'));
    var unit = m[2].toLowerCase();
    if (unit === 'g') n *= 1000;
    if (unit === 'mcg') n /= 1000;
    return n;
  }

  /* "3x1" is a complete Indonesian signa in one field: three times a day, one
   * unit each time — NOT three units. Reading the leading number as a unit
   * count and then multiplying by the frequency field again turns a routine
   * prescription into a threefold overdose alert, which is precisely the false
   * alarm this check exists to avoid producing. */
  var SIGNA = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/;

  function parseSigna(s) {
    var m = SIGNA.exec(String(s == null ? '' : s));
    if (!m) return null;
    return { times: parseFloat(m[1].replace(',', '.')), units: parseFloat(m[2].replace(',', '.')) };
  }

  /**
   * dailyDose(item, drug) -> { perDay, mgPerDay } | null
   * "1 tablet" × "3x sehari", or "3x1" written whole in either field.
   * Returns null — and the check then stays silent — whenever the signa cannot
   * be read with confidence.
   */
  function dailyDose(it, d) {
    var mg = strengthValue(d);
    var whole = parseSigna(it.dose) || parseSigna(it.freq);
    var units, times;
    if (whole) {
      units = whole.units;
      times = whole.times;
    } else {
      units = leadingNumber(it.dose);
      times = leadingNumber(it.freq);
    }
    if (units == null || times == null || units <= 0 || times <= 0) return null;
    // A dose written directly in milligrams ("500 mg") is not a unit count.
    if (!whole && /mg|mcg|gram/i.test(String(it.dose)) && mg) {
      var written = units;
      if (/mcg/i.test(String(it.dose))) written /= 1000;
      return { perDay: (written / mg) * times, mgPerDay: written * times };
    }
    return { perDay: units * times, mgPerDay: mg == null ? null : units * times * mg };
  }

  function matches(d, m) {
    if (!d || !m) return false;
    if (m.id) return d.id === m.id;
    if (m.cls) return has(d, m.cls);
    return false;
  }

  /* 'kelengkapan' is not a clinical severity — it is a clerical block. It
   * ranks above the clinical rungs only so it sorts to the top of the panel,
   * and it is reported through its own list rather than through `blocking`. */
  var SEV_RANK = { kelengkapan: 5, kontraindikasi: 4, mayor: 3, moderat: 2, minor: 1 };

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

    /* 3a. the same drug written twice.
     * The single commonest double-dosing slip, and the class check could not
     * see it: it deduplicated by drug NAME before counting, so two identical
     * paracetamol lines collapsed to one and produced no finding at all. */
    var byDrug = {};
    list.forEach(function (x) { byDrug[x.d.id] = (byDrug[x.d.id] || 0) + 1; });
    Object.keys(byDrug).forEach(function (id) {
      if (byDrug[id] < 2) return;
      var d = drug(id);
      push({
        kind: 'duplikasi', rule: 'dup-item:' + id, sev: 'mayor',
        subjects: [d.name],
        title: d.name + ' ditulis ' + byDrug[id] + '× pada resep yang sama',
        why: 'Obat yang sama muncul lebih dari satu baris. Bila keduanya diserahkan, pasien menerima kelipatan dosis yang dimaksud — dan ini adalah kesalahan peresepan yang paling sering terjadi, bukan yang paling jarang.',
        act: 'Gabungkan menjadi satu baris dengan aturan pakai yang benar, atau hapus baris yang berlebih.'
      });
    });

    /* 3b. duplicate therapy — two members of the same pharmacological class.
     *
     * The list is explicit rather than derived from every class tag, because
     * deriving it produces nonsense: 'antibiotik', 'antihipertensi' and
     * 'antidiabetik' are broad categories whose members are routinely and
     * correctly combined (metformin + glibenklamid is standard therapy), and a
     * duplication alert on standard therapy is how an alert system gets
     * clicked through. The classes below are the ones where a second member
     * adds toxicity without adding effect. The UI states the list so silence
     * is not misread as an all-clear. */
    Object.keys(DUP_CLASSES).forEach(function (cls) {
      var members = list.filter(function (x) { return has(x.d, cls); });
      // Topicals do not duplicate systemically; a hydrocortisone cream beside an
      // oral steroid is normal practice, not a duplication error.
      members = members.filter(function (x) { return !has(x.d, 'topikal'); });
      var names = {};
      members.forEach(function (x) { names[x.d.name] = 1; });
      var uniq = Object.keys(names);
      if (uniq.length > 1) {
        push({
          kind: 'duplikasi', rule: 'dup:' + cls, sev: DUP_CLASSES[cls],
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
          kind: 'populasi', rule: 'pop:' + (rule.key || ri), sev: rule.sev,
          subjects: [x.d.name],
          title: x.d.name + ' — ' + (rule.when === 'pregnant' ? 'kehamilan' : rule.when === 'ageUnder' ? 'batasan usia' : 'kondisi penyerta'),
          why: ctxNote + ' ' + rule.why, act: rule.act
        });
      });
    });

    /* 5. dose magnitude, where the signa can be read.
     * Deliberately silent when it cannot: a check that guesses at free text is
     * worse than one that declines, and declining is stated rather than hidden. */
    list.forEach(function (x) {
      var d = x.d, it = x.it;
      var dd = dailyDose(it, d);
      var maxD = MAX_DAILY[d.id];
      if (!dd || dd.mgPerDay == null || maxD == null) return;
      if (dd.mgPerDay > maxD) {
        var factor = Math.round((dd.mgPerDay / maxD) * 10) / 10;
        push({
          kind: 'dosis', rule: 'maxdose:' + d.id, sev: dd.mgPerDay >= maxD * 2 ? 'kontraindikasi' : 'mayor',
          subjects: [d.name],
          title: d.name + ' — dosis harian ' + fmtDose(dd.mgPerDay) + ' melampaui batas ' + fmtDose(maxD) + '/hari',
          why: 'Aturan pakai "' + it.dose + ', ' + it.freq + '" pada sediaan ' + d.strength +
            ' setara ' + fmtDose(dd.mgPerDay) + ' per hari, yaitu ' + factor + '× batas maksimum dewasa (' + fmtDose(maxD) + '/hari).',
          act: 'Perbaiki dosis atau frekuensinya. Batas ini adalah batas dewasa — dosis anak dihitung per kilogram berat badan dan tidak dihitung oleh demo ini.'
        });
      }
    });

    /* 5b. form and age appropriateness. An adult 500 mg kaplet prescribed to a
     * two-year-old is not a dosing error, it is the wrong product. */
    if (typeof ctx.age === 'number') {
      list.forEach(function (x) {
        var min = MIN_AGE_FORM[x.d.id];
        if (min == null || ctx.age >= min) return;
        push({
          kind: 'sediaan', rule: 'form-age:' + x.d.id, sev: 'mayor',
          subjects: [x.d.name],
          title: x.d.name + ' ' + x.d.form + ' ' + x.d.strength + ' — sediaan dewasa untuk pasien usia ' + ctx.age + ' th',
          why: 'Sediaan padat oral kekuatan dewasa tidak sesuai untuk usia di bawah ' + min + ' tahun: sulit ditelan dan tidak dapat dibagi ke dosis per kilogram dengan andal.',
          act: 'Gunakan sediaan sirup / dispersibel yang tersedia di formularium, dengan dosis dihitung berdasarkan berat badan.'
        });
      });
    }

    /* 6. incomplete prescription lines — a dose-less line is not signable.
     *
     * Its own category, not 'kontraindikasi'. A missing signa blocks signing
     * just as firmly, but calling it an "absolute contraindication" spends the
     * top rung of a four-level ladder on a blank field, and the refusal message
     * a clinician reads then says the wrong thing about their own prescription. */
    (items || []).forEach(function (it) {
      var d = drug(it.drugId);
      var missing = [];
      if (!it.dose) missing.push('dosis');
      if (!it.freq) missing.push('frekuensi');
      if (!it.days) missing.push('durasi');
      if (!it.qty || it.qty <= 0) missing.push('jumlah');
      if (missing.length) {
        push({
          kind: 'kelengkapan', rule: 'incomplete:' + it.drugId, sev: 'kelengkapan',
          subjects: [d ? d.name : it.drugId],
          title: (d ? d.name : it.drugId) + ' — resep belum lengkap',
          why: 'Baris resep tidak memuat ' + missing.join(', ') + '.',
          act: 'Lengkapi sebelum menandatangani. Resep tanpa aturan pakai tidak sah dan tidak dapat dilayani apotek.'
        });
      }
    });

    findings.sort(function (a, b) { return sevRank(b.sev) - sevRank(a.sev); });
    var clinical = findings.filter(function (f) { return f.sev !== 'kelengkapan'; });
    var worst = clinical.length ? clinical[0].sev : null;
    return {
      findings: findings,
      // Blocking = a clinical contraindication; cannot be signed at all.
      blocking: findings.filter(function (f) { return f.sev === 'kontraindikasi'; }),
      // Incomplete = also blocks, but for a clerical reason, and says so.
      incomplete: findings.filter(function (f) { return f.sev === 'kelengkapan'; }),
      // Overridable = signable only with a documented clinical reason.
      overridable: findings.filter(function (f) { return f.sev === 'mayor'; }),
      worst: worst
    };
  }

  function fmtDose(mg) {
    if (mg >= 1000) return (Math.round(mg / 100) / 10) + ' g';
    if (mg < 1) return Math.round(mg * 1000) + ' mcg';
    return (Math.round(mg * 10) / 10) + ' mg';
  }

  R.rx = {
    drugs: DRUGS,
    drug: drug,
    search: searchDrugs,
    allergyClasses: ALLERGY_CLASSES,
    interactions: INTERACTIONS,
    populationRules: POPULATION_RULES,
    dupClasses: DUP_CLASSES,
    maxDaily: MAX_DAILY,
    minAgeForm: MIN_AGE_FORM,
    dailyDose: dailyDose,
    check: check,
    sevRank: sevRank
  };
})(typeof self !== 'undefined' ? self : this);
