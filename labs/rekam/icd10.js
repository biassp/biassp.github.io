/*!
 * Rekam — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rekam — icd10.js
 * A working subset of WHO ICD-10 (2010 revision, the one Indonesian coding
 * still runs on) covering the presentations a primary-care clinic, a puskesmas
 * and a poli gigi actually see. Real code/title pairs, not placeholders.
 *
 * Why a subset and not the whole tabular list: the full classification is
 * ~14,000 rubrics and is not mine to redistribute. What matters for a clinic
 * demo is that the assessment is CODED — that the doctor picks J06.9 rather
 * than typing "batuk pilek" — and that the picker is fast enough to use in a
 * five-minute consultation. So: ~170 rubrics, chapter-derived grouping, and a
 * search that answers on a keystroke.
 *
 * Each rubric carries the English title (as published) plus the Indonesian
 * term a clinician would actually say, because a doctor searching for
 * "demam berdarah" must land on A91 and one searching "dengue" must land on
 * the same place.
 *
 * Chapters are DERIVED from the code, not stored per row — ICD-10 chapter
 * boundaries are a property of the code range, and duplicating them in data is
 * how they drift.
 */
(function (root) {
  'use strict';
  var R = root.REKAM || (root.REKAM = {});

  /* ------------------------------------------------------------- chapters */

  // [romanNumeral, label(id), firstCode, lastCode] — inclusive, compared on the
  // 3-character rubric prefix.
  var CHAPTERS = [
    ['I', 'Penyakit Infeksi & Parasit', 'A00', 'B99'],
    ['II', 'Neoplasma', 'C00', 'D48'],
    ['III', 'Darah & Sistem Imun', 'D50', 'D89'],
    ['IV', 'Endokrin, Nutrisi & Metabolik', 'E00', 'E90'],
    ['V', 'Gangguan Jiwa & Perilaku', 'F00', 'F99'],
    ['VI', 'Sistem Saraf', 'G00', 'G99'],
    ['VII', 'Mata & Adneksa', 'H00', 'H59'],
    ['VIII', 'Telinga & Prosesus Mastoid', 'H60', 'H95'],
    ['IX', 'Sistem Sirkulasi', 'I00', 'I99'],
    ['X', 'Sistem Pernapasan', 'J00', 'J99'],
    ['XI', 'Sistem Pencernaan', 'K00', 'K93'],
    ['XII', 'Kulit & Jaringan Subkutan', 'L00', 'L99'],
    ['XIII', 'Muskuloskeletal & Jaringan Ikat', 'M00', 'M99'],
    ['XIV', 'Sistem Genitourinaria', 'N00', 'N99'],
    ['XV', 'Kehamilan, Persalinan & Nifas', 'O00', 'O99'],
    ['XVI', 'Kondisi Perinatal', 'P00', 'P96'],
    ['XVII', 'Malformasi Kongenital', 'Q00', 'Q99'],
    ['XVIII', 'Gejala & Temuan Klinis', 'R00', 'R99'],
    ['XIX', 'Cedera, Keracunan & Sebab Luar', 'S00', 'T98'],
    ['XXI', 'Faktor Status Kesehatan', 'Z00', 'Z99']
  ];

  // Rubric prefixes sort lexicographically as long as the numeric part is
  // zero-padded to two digits, which ICD-10 guarantees ("A09", not "A9").
  function chapterOf(code) {
    var head = String(code).slice(0, 3).toUpperCase();
    for (var i = 0; i < CHAPTERS.length; i++) {
      if (head >= CHAPTERS[i][2] && head <= CHAPTERS[i][3]) {
        return { roman: CHAPTERS[i][0], label: CHAPTERS[i][1] };
      }
    }
    return { roman: '?', label: 'Tidak terklasifikasi' };
  }

  /* --------------------------------------------------------------- rubrics */

  // [code, English title, Indonesian term, extra search terms]
  var RAW = [
    /* --- A/B infeksi --------------------------------------------------- */
    ['A01.0', 'Typhoid fever', 'Demam tifoid', 'tifus typhus salmonella'],
    ['A06.0', 'Acute amoebic dysentery', 'Disentri amuba akut', 'amubiasis entamoeba'],
    ['A08.4', 'Viral intestinal infection, unspecified', 'Infeksi usus virus', 'gastroenteritis viral rotavirus'],
    ['A09', 'Diarrhoea and gastroenteritis of presumed infectious origin', 'Diare & gastroenteritis infeksi', 'mencret berak cair gastroenteritis'],
    ['A15.0', 'Tuberculosis of lung, confirmed by microscopy', 'TB paru BTA positif', 'tuberkulosis tbc paru bta'],
    ['A16.2', 'Tuberculosis of lung, without bacteriological confirmation', 'TB paru klinis (BTA negatif)', 'tuberkulosis tbc paru'],
    ['A16.9', 'Respiratory tuberculosis unspecified', 'TB pernapasan tidak spesifik', 'tuberkulosis tbc'],
    ['A46', 'Erysipelas', 'Erisipelas', 'infeksi kulit streptokokus'],
    ['A49.0', 'Staphylococcal infection, unspecified site', 'Infeksi stafilokokus', 'staph'],
    ['A75.9', 'Typhus fever, unspecified', 'Tifus bercak (rickettsia)', 'rickettsia'],
    ['A90', 'Dengue fever (classical dengue)', 'Demam dengue', 'db dengue demam berdarah nyamuk aedes'],
    ['A91', 'Dengue haemorrhagic fever', 'Demam berdarah dengue (DBD)', 'dbd dengue berdarah trombositopenia'],
    ['B01.9', 'Varicella without complication', 'Cacar air tanpa komplikasi', 'varisela chickenpox'],
    ['B02.9', 'Zoster without complication', 'Herpes zoster', 'cacar ular dompo shingles'],
    ['B05.9', 'Measles without complication', 'Campak tanpa komplikasi', 'morbili measles'],
    ['B15.9', 'Hepatitis A without hepatic coma', 'Hepatitis A', 'hepatitis kuning liver'],
    ['B18.1', 'Chronic viral hepatitis B without delta agent', 'Hepatitis B kronik', 'hepatitis b hbsag'],
    ['B18.2', 'Chronic viral hepatitis C', 'Hepatitis C kronik', 'hepatitis c'],
    ['B24', 'Unspecified human immunodeficiency virus disease', 'Penyakit HIV', 'hiv aids'],
    ['B35.3', 'Tinea pedis', 'Kutu air (tinea pedis)', 'jamur kaki kurap'],
    ['B35.4', 'Tinea corporis', 'Kurap badan (tinea corporis)', 'jamur kulit kadas'],
    ['B35.6', 'Tinea cruris', 'Tinea cruris (jamur selangkangan)', 'jamur lipat paha'],
    ['B36.0', 'Pityriasis versicolor', 'Panu (pitiriasis versikolor)', 'panu jamur'],
    ['B37.0', 'Candidal stomatitis', 'Kandidiasis mulut (oral thrush)', 'sariawan jamur mulut'],
    ['B37.3', 'Candidiasis of vulva and vagina', 'Kandidiasis vulvovaginal', 'keputihan jamur'],
    ['B54', 'Unspecified malaria', 'Malaria tanpa spesifikasi', 'malaria plasmodium'],
    ['B77.9', 'Ascariasis, unspecified', 'Askariasis (cacing gelang)', 'cacingan cacing'],
    ['B82.9', 'Intestinal parasitism, unspecified', 'Parasit usus', 'cacingan'],
    ['B86', 'Scabies', 'Skabies (gudik)', 'kudis gatal malam tungau'],

    /* --- D darah -------------------------------------------------------- */
    ['D50.9', 'Iron deficiency anaemia, unspecified', 'Anemia defisiensi besi', 'anemia kurang darah fe'],
    ['D64.9', 'Anaemia, unspecified', 'Anemia tanpa spesifikasi', 'anemia kurang darah hb rendah'],
    ['D69.6', 'Thrombocytopenia, unspecified', 'Trombositopenia', 'trombosit rendah'],

    /* --- E endokrin ----------------------------------------------------- */
    ['E03.9', 'Hypothyroidism, unspecified', 'Hipotiroid', 'tiroid tsh'],
    ['E05.9', 'Thyrotoxicosis, unspecified', 'Hipertiroid / tirotoksikosis', 'tiroid gondok graves'],
    ['E10.9', 'Type 1 diabetes mellitus without complications', 'Diabetes melitus tipe 1', 'dm kencing manis gula'],
    ['E11.9', 'Type 2 diabetes mellitus without complications', 'Diabetes melitus tipe 2', 'dm2 kencing manis gula darah'],
    ['E11.6', 'Type 2 diabetes mellitus with other specified complications', 'DM tipe 2 dengan komplikasi lain', 'dm komplikasi'],
    ['E14.9', 'Unspecified diabetes mellitus without complications', 'Diabetes melitus tidak spesifik', 'dm kencing manis'],
    ['E44.0', 'Moderate protein-energy malnutrition', 'Gizi kurang sedang', 'malnutrisi kurang gizi'],
    ['E46', 'Unspecified protein-energy malnutrition', 'Gizi buruk / kurang', 'malnutrisi stunting kurang gizi'],
    ['E63.9', 'Nutritional deficiency, unspecified', 'Defisiensi nutrisi', 'kurang gizi vitamin'],
    ['E66.9', 'Obesity, unspecified', 'Obesitas', 'gemuk kegemukan berat badan'],
    ['E78.0', 'Pure hypercholesterolaemia', 'Hiperkolesterolemia', 'kolesterol tinggi ldl'],
    ['E78.5', 'Hyperlipidaemia, unspecified', 'Dislipidemia', 'kolesterol trigliserida lemak darah'],
    ['E86', 'Volume depletion', 'Dehidrasi / deplesi volume', 'dehidrasi kurang cairan'],
    ['E87.6', 'Hypokalaemia', 'Hipokalemia', 'kalium rendah'],

    /* --- F jiwa --------------------------------------------------------- */
    ['F20.9', 'Schizophrenia, unspecified', 'Skizofrenia', 'jiwa psikotik halusinasi'],
    ['F31.9', 'Bipolar affective disorder, unspecified', 'Gangguan bipolar', 'bipolar manik'],
    ['F32.9', 'Depressive episode, unspecified', 'Episode depresi', 'depresi sedih murung'],
    ['F41.1', 'Generalized anxiety disorder', 'Gangguan cemas menyeluruh', 'cemas ansietas khawatir'],
    ['F41.9', 'Anxiety disorder, unspecified', 'Gangguan cemas', 'cemas panik ansietas'],
    ['F43.2', 'Adjustment disorders', 'Gangguan penyesuaian', 'stres adaptasi'],
    ['F45.3', 'Somatoform autonomic dysfunction', 'Disfungsi otonom somatoform', 'psikosomatis'],
    ['F51.0', 'Nonorganic insomnia', 'Insomnia non-organik', 'susah tidur insomnia'],

    /* --- G saraf -------------------------------------------------------- */
    ['G40.9', 'Epilepsy, unspecified', 'Epilepsi', 'ayan kejang bangkitan'],
    ['G43.9', 'Migraine, unspecified', 'Migren', 'migrain sakit kepala sebelah'],
    ['G44.2', 'Tension-type headache', 'Nyeri kepala tipe tegang', 'sakit kepala tegang tension'],
    ['G51.0', "Bell's palsy", 'Bell’s palsy', 'wajah perot lumpuh saraf vii'],
    ['G56.0', 'Carpal tunnel syndrome', 'Sindrom terowongan karpal', 'cts kesemutan tangan'],
    ['G62.9', 'Polyneuropathy, unspecified', 'Polineuropati', 'kesemutan neuropati'],
    ['G93.3', 'Postviral fatigue syndrome', 'Sindrom lelah pasca-viral', 'lelah kronik'],

    /* --- H mata --------------------------------------------------------- */
    ['H10.1', 'Acute atopic conjunctivitis', 'Konjungtivitis alergi akut', 'mata merah alergi gatal'],
    ['H10.9', 'Conjunctivitis, unspecified', 'Konjungtivitis', 'mata merah belekan'],
    ['H16.0', 'Corneal ulcer', 'Ulkus kornea', 'luka kornea mata'],
    ['H25.9', 'Senile cataract, unspecified', 'Katarak senilis', 'katarak mata buram'],
    ['H40.9', 'Glaucoma, unspecified', 'Glaukoma', 'tekanan bola mata'],
    ['H52.1', 'Myopia', 'Miopia (rabun jauh)', 'minus rabun jauh kacamata'],
    ['H52.2', 'Astigmatism', 'Astigmatisme', 'silinder mata'],
    ['H52.4', 'Presbyopia', 'Presbiopia', 'rabun tua kacamata baca'],
    ['H57.1', 'Ocular pain', 'Nyeri mata', 'mata sakit'],

    /* --- H telinga ------------------------------------------------------ */
    ['H60.9', 'Otitis externa, unspecified', 'Otitis eksterna', 'congek telinga luar nyeri'],
    ['H61.2', 'Impacted cerumen', 'Serumen obturans', 'kotoran telinga sumbat'],
    ['H65.9', 'Nonsuppurative otitis media, unspecified', 'Otitis media non-supuratif', 'telinga cairan'],
    ['H66.9', 'Otitis media, unspecified', 'Otitis media', 'congek telinga bernanah'],
    ['H81.1', 'Benign paroxysmal vertigo', 'Vertigo posisi paroksismal jinak', 'bppv vertigo pusing berputar'],
    ['H81.3', 'Other peripheral vertigo', 'Vertigo perifer lain', 'vertigo pusing berputar'],
    ['H91.9', 'Hearing loss, unspecified', 'Gangguan pendengaran', 'tuli budek'],

    /* --- I sirkulasi ---------------------------------------------------- */
    ['I10', 'Essential (primary) hypertension', 'Hipertensi esensial (primer)', 'darah tinggi ht tensi tinggi'],
    ['I11.9', 'Hypertensive heart disease without heart failure', 'Penyakit jantung hipertensif', 'jantung hipertensi'],
    ['I15.9', 'Secondary hypertension, unspecified', 'Hipertensi sekunder', 'darah tinggi sekunder'],
    ['I20.9', 'Angina pectoris, unspecified', 'Angina pektoris', 'nyeri dada jantung'],
    ['I21.9', 'Acute myocardial infarction, unspecified', 'Infark miokard akut', 'serangan jantung ima stemi'],
    ['I25.1', 'Atherosclerotic heart disease', 'Penyakit jantung aterosklerotik', 'jantung koroner pjk'],
    ['I48', 'Atrial fibrillation and flutter', 'Fibrilasi atrium', 'af aritmia jantung berdebar'],
    ['I50.9', 'Heart failure, unspecified', 'Gagal jantung', 'gagal jantung sesak bengkak'],
    ['I63.9', 'Cerebral infarction, unspecified', 'Infark serebral (stroke iskemik)', 'stroke sumbatan'],
    ['I64', 'Stroke, not specified as haemorrhage or infarction', 'Stroke tidak spesifik', 'stroke lumpuh'],
    ['I83.9', 'Varicose veins of lower extremities', 'Varises tungkai', 'varises kaki'],
    ['I88.9', 'Nonspecific lymphadenitis, unspecified', 'Limfadenitis non-spesifik', 'kelenjar getah bening bengkak'],

    /* --- J napas -------------------------------------------------------- */
    ['J00', 'Acute nasopharyngitis (common cold)', 'Nasofaringitis akut (selesma)', 'pilek flu common cold'],
    ['J01.9', 'Acute sinusitis, unspecified', 'Sinusitis akut', 'sinusitis hidung tersumbat'],
    ['J02.9', 'Acute pharyngitis, unspecified', 'Faringitis akut', 'radang tenggorokan sakit menelan'],
    ['J03.9', 'Acute tonsillitis, unspecified', 'Tonsilitis akut', 'amandel radang'],
    ['J04.0', 'Acute laryngitis', 'Laringitis akut', 'serak suara hilang'],
    ['J06.9', 'Acute upper respiratory infection, unspecified', 'ISPA (infeksi saluran napas atas)', 'ispa batuk pilek flu common cold'],
    ['J11.1', 'Influenza with other respiratory manifestations, virus not identified', 'Influenza', 'flu influenza demam'],
    ['J18.9', 'Pneumonia, unspecified', 'Pneumonia', 'radang paru paru-paru basah'],
    ['J20.9', 'Acute bronchitis, unspecified', 'Bronkitis akut', 'bronkitis batuk berdahak'],
    ['J30.4', 'Allergic rhinitis, unspecified', 'Rinitis alergi', 'alergi bersin hidung meler'],
    ['J31.0', 'Chronic rhinitis', 'Rinitis kronik', 'hidung tersumbat kronik'],
    ['J35.0', 'Chronic tonsillitis', 'Tonsilitis kronik', 'amandel kronis'],
    ['J42', 'Unspecified chronic bronchitis', 'Bronkitis kronik', 'batuk kronik perokok'],
    ['J44.9', 'Chronic obstructive pulmonary disease, unspecified', 'PPOK', 'ppok copd sesak perokok'],
    ['J45.0', 'Predominantly allergic asthma', 'Asma alergik', 'asma bengek alergi'],
    ['J45.9', 'Asthma, unspecified', 'Asma', 'asma bengek sesak mengi'],
    ['J46', 'Status asthmaticus', 'Status asmatikus', 'asma berat serangan'],

    /* --- K cerna & gigi ------------------------------------------------- */
    ['K02.1', 'Caries of dentine', 'Karies dentin', 'gigi berlubang karies'],
    ['K02.9', 'Dental caries, unspecified', 'Karies gigi', 'gigi berlubang gigis'],
    ['K04.0', 'Pulpitis', 'Pulpitis', 'gigi nyeri saraf gigi'],
    ['K04.1', 'Necrosis of pulp', 'Nekrosis pulpa', 'gigi mati'],
    ['K04.7', 'Periapical abscess without sinus', 'Abses periapikal', 'gusi bengkak nanah gigi'],
    ['K05.0', 'Acute gingivitis', 'Gingivitis akut', 'gusi bengkak berdarah'],
    ['K05.3', 'Chronic periodontitis', 'Periodontitis kronik', 'gusi turun gigi goyang'],
    ['K08.1', 'Loss of teeth due to accident, extraction or local periodontal disease', 'Kehilangan gigi', 'gigi tanggal ompong'],
    ['K12.0', 'Recurrent oral aphthae', 'Stomatitis aftosa rekuren', 'sariawan'],
    ['K21.9', 'Gastro-oesophageal reflux disease without oesophagitis', 'GERD tanpa esofagitis', 'asam lambung naik gerd heartburn'],
    ['K29.7', 'Gastritis, unspecified', 'Gastritis', 'maag lambung perih'],
    ['K30', 'Functional dyspepsia', 'Dispepsia fungsional', 'maag kembung begah dispepsia'],
    ['K35.8', 'Acute appendicitis, other and unspecified', 'Apendisitis akut', 'usus buntu radang'],
    ['K40.9', 'Unilateral inguinal hernia, without obstruction or gangrene', 'Hernia inguinalis unilateral', 'hernia turun berok'],
    ['K52.9', 'Noninfective gastroenteritis and colitis, unspecified', 'Gastroenteritis non-infeksi', 'diare non infeksi'],
    ['K58.9', 'Irritable bowel syndrome without diarrhoea', 'Sindrom usus iritabel', 'ibs kolon iritabel'],
    ['K59.0', 'Constipation', 'Konstipasi', 'sembelit susah bab'],
    ['K64.9', 'Haemorrhoids, unspecified', 'Hemoroid', 'wasir ambeien'],
    ['K76.0', 'Fatty (change of) liver, not elsewhere classified', 'Perlemakan hati', 'fatty liver'],
    ['K80.2', 'Calculus of gallbladder without cholecystitis', 'Batu kandung empedu', 'batu empedu'],

    /* --- L kulit -------------------------------------------------------- */
    ['L01.0', 'Impetigo', 'Impetigo', 'koreng kulit bernanah anak'],
    ['L02.9', 'Cutaneous abscess, furuncle and carbuncle, unspecified', 'Abses kulit / furunkel', 'bisul abses'],
    ['L03.9', 'Cellulitis, unspecified', 'Selulitis', 'infeksi kulit bengkak merah'],
    ['L20.9', 'Atopic dermatitis, unspecified', 'Dermatitis atopik', 'eksim alergi kulit'],
    ['L21.9', 'Seborrhoeic dermatitis, unspecified', 'Dermatitis seboroik', 'ketombe kulit berminyak'],
    ['L23.9', 'Allergic contact dermatitis, unspecified cause', 'Dermatitis kontak alergi', 'alergi kulit gatal'],
    ['L25.9', 'Unspecified contact dermatitis, unspecified cause', 'Dermatitis kontak', 'gatal kena bahan'],
    ['L29.9', 'Pruritus, unspecified', 'Pruritus', 'gatal gatal'],
    ['L30.9', 'Dermatitis, unspecified', 'Dermatitis', 'eksim gatal kulit'],
    ['L40.9', 'Psoriasis, unspecified', 'Psoriasis', 'psoriasis bersisik'],
    ['L50.9', 'Urticaria, unspecified', 'Urtikaria', 'biduran kaligata bentol'],
    ['L70.0', 'Acne vulgaris', 'Akne vulgaris', 'jerawat'],
    ['L84', 'Corns and callosities', 'Kalus & klavus', 'mata ikan kapalan'],

    /* --- M muskuloskeletal ---------------------------------------------- */
    ['M06.9', 'Rheumatoid arthritis, unspecified', 'Artritis reumatoid', 'rematik sendi bengkak'],
    ['M10.9', 'Gout, unspecified', 'Gout (artritis pirai)', 'asam urat gout'],
    ['M13.9', 'Arthritis, unspecified', 'Artritis', 'radang sendi'],
    ['M17.9', 'Gonarthrosis, unspecified', 'Osteoartritis lutut', 'oa lutut pengapuran'],
    ['M19.9', 'Arthrosis, unspecified', 'Osteoartritis', 'oa pengapuran sendi'],
    ['M25.5', 'Pain in joint', 'Nyeri sendi', 'sendi sakit artralgia'],
    ['M47.9', 'Spondylosis, unspecified', 'Spondilosis', 'pengapuran tulang belakang'],
    ['M51.1', 'Lumbar and other intervertebral disc disorders with radiculopathy', 'HNP lumbal dengan radikulopati', 'saraf kejepit hnp'],
    ['M54.2', 'Cervicalgia', 'Servikalgia', 'nyeri leher tengkuk'],
    ['M54.4', 'Lumbago with sciatica', 'Lumbago dengan iskialgia', 'nyeri pinggang menjalar skiatika'],
    ['M54.5', 'Low back pain', 'Nyeri punggung bawah', 'lbp sakit pinggang'],
    ['M62.6', 'Muscle strain', 'Strain otot', 'otot tertarik keseleo'],
    ['M65.9', 'Synovitis and tenosynovitis, unspecified', 'Sinovitis / tenosinovitis', 'radang tendon'],
    ['M75.0', 'Adhesive capsulitis of shoulder', 'Kapsulitis adhesiva bahu', 'frozen shoulder bahu kaku'],
    ['M77.1', 'Lateral epicondylitis', 'Epikondilitis lateral', 'tennis elbow siku'],
    ['M79.1', 'Myalgia', 'Mialgia', 'nyeri otot pegal'],
    ['M81.9', 'Osteoporosis, unspecified', 'Osteoporosis', 'tulang keropos'],

    /* --- N genitourinaria ----------------------------------------------- */
    ['N18.9', 'Chronic kidney disease, unspecified', 'Penyakit ginjal kronik', 'gagal ginjal ckd'],
    ['N20.0', 'Calculus of kidney', 'Batu ginjal', 'batu ginjal kolik'],
    ['N23', 'Unspecified renal colic', 'Kolik renal', 'kolik ginjal nyeri pinggang'],
    ['N30.0', 'Acute cystitis', 'Sistitis akut', 'infeksi kandung kemih anyang-anyangan'],
    ['N39.0', 'Urinary tract infection, site not specified', 'Infeksi saluran kemih (ISK)', 'isk anyang-anyangan nyeri kencing'],
    ['N40', 'Hyperplasia of prostate', 'Hiperplasia prostat (BPH)', 'bph prostat susah kencing'],
    ['N76.0', 'Acute vaginitis', 'Vaginitis akut', 'keputihan gatal vagina'],
    ['N91.2', 'Amenorrhoea, unspecified', 'Amenore', 'tidak haid'],
    ['N92.0', 'Excessive and frequent menstruation with regular cycle', 'Menoragia siklus teratur', 'haid banyak'],
    ['N94.6', 'Dysmenorrhoea, unspecified', 'Dismenore', 'nyeri haid kram haid'],
    ['N95.1', 'Menopausal and female climacteric states', 'Sindrom menopause', 'menopause hot flush'],

    /* --- O kehamilan ---------------------------------------------------- */
    ['O14.9', 'Pre-eclampsia, unspecified', 'Preeklamsia', 'preeklampsia hamil tensi tinggi'],
    ['O21.0', 'Mild hyperemesis gravidarum', 'Hiperemesis gravidarum ringan', 'mual muntah hamil'],
    ['O24.4', 'Diabetes mellitus arising in pregnancy', 'Diabetes gestasional', 'dm hamil gestasional'],
    ['O26.8', 'Other specified pregnancy-related conditions', 'Kondisi terkait kehamilan lain', 'keluhan hamil'],
    ['O47.9', 'False labour, unspecified', 'Kontraksi palsu', 'kontraksi palsu braxton'],
    ['O99.0', 'Anaemia complicating pregnancy, childbirth and the puerperium', 'Anemia dalam kehamilan', 'anemia hamil'],

    /* --- P perinatal ----------------------------------------------------- */
    ['P07.3', 'Other preterm infants', 'Bayi prematur lain', 'prematur bblr'],
    ['P59.9', 'Neonatal jaundice, unspecified', 'Ikterus neonatorum', 'bayi kuning'],

    /* --- R gejala -------------------------------------------------------- */
    ['R05', 'Cough', 'Batuk', 'batuk'],
    ['R07.4', 'Chest pain, unspecified', 'Nyeri dada', 'nyeri dada'],
    ['R10.1', 'Pain localized to upper abdomen', 'Nyeri perut atas', 'nyeri ulu hati epigastrium'],
    ['R10.4', 'Other and unspecified abdominal pain', 'Nyeri perut', 'sakit perut mules'],
    ['R11', 'Nausea and vomiting', 'Mual & muntah', 'mual muntah'],
    ['R42', 'Dizziness and giddiness', 'Pusing / melayang', 'pusing kliyengan'],
    ['R50.9', 'Fever, unspecified', 'Demam tanpa spesifikasi', 'demam panas'],
    ['R51', 'Headache', 'Nyeri kepala', 'sakit kepala pusing'],
    ['R53', 'Malaise and fatigue', 'Malaise & kelelahan', 'lemas lelah'],
    ['R55', 'Syncope and collapse', 'Sinkop', 'pingsan'],
    ['R60.0', 'Localized oedema', 'Edema lokal', 'bengkak kaki'],
    ['R73.9', 'Hyperglycaemia, unspecified', 'Hiperglikemia', 'gula darah tinggi'],

    /* --- S/T cedera ------------------------------------------------------ */
    ['S00.0', 'Superficial injury of scalp', 'Cedera superfisial kulit kepala', 'luka lecet kepala'],
    ['S01.0', 'Open wound of scalp', 'Luka terbuka kulit kepala', 'luka robek kepala'],
    ['S13.4', 'Sprain and strain of cervical spine', 'Sprain servikal', 'keseleo leher whiplash'],
    ['S52.5', 'Fracture of lower end of radius', 'Fraktur radius distal', 'patah tulang pergelangan tangan'],
    ['S61.9', 'Open wound of wrist and hand, part unspecified', 'Luka terbuka tangan', 'luka robek tangan'],
    ['S81.0', 'Open wound of knee', 'Luka terbuka lutut', 'luka lutut jatuh'],
    ['S93.4', 'Sprain and strain of ankle', 'Sprain pergelangan kaki', 'keseleo kaki terkilir'],
    ['T14.1', 'Open wound of unspecified body region', 'Luka terbuka', 'luka robek vulnus'],
    ['T63.4', 'Toxic effect of venom of other arthropods', 'Sengatan/gigitan artropoda', 'digigit serangga sengat'],
    ['T78.2', 'Anaphylactic shock, unspecified', 'Syok anafilaktik', 'anafilaksis syok alergi'],
    ['T78.4', 'Allergy, unspecified', 'Alergi tanpa spesifikasi', 'alergi'],

    /* --- Z status -------------------------------------------------------- */
    ['Z00.0', 'General medical examination', 'Pemeriksaan kesehatan umum', 'medical check up mcu'],
    ['Z00.1', 'Routine child health examination', 'Pemeriksaan kesehatan anak rutin', 'imunisasi tumbuh kembang posyandu'],
    ['Z01.7', 'Laboratory examination', 'Pemeriksaan laboratorium', 'lab cek darah'],
    ['Z23', 'Need for immunization against single bacterial diseases', 'Imunisasi bakteri tunggal', 'imunisasi vaksin'],
    ['Z25.1', 'Need for immunization against influenza', 'Imunisasi influenza', 'vaksin flu'],
    ['Z30.4', 'Surveillance of contraceptive drugs', 'Pemantauan kontrasepsi hormonal', 'kb pil suntik'],
    ['Z34.0', 'Supervision of normal first pregnancy', 'Pengawasan kehamilan normal pertama', 'anc hamil pertama kia'],
    ['Z34.9', 'Supervision of normal pregnancy, unspecified', 'Pengawasan kehamilan normal', 'anc kontrol hamil kia'],
    ['Z39.1', 'Care and examination of lactating mother', 'Perawatan ibu menyusui', 'menyusui asi nifas'],
    ['Z71.3', 'Dietary counselling and surveillance', 'Konseling gizi', 'konsultasi diet gizi'],
    ['Z76.0', 'Issue of repeat prescription', 'Penerbitan resep ulang', 'resep ulang obat rutin']
  ];

  // The rubrics an Indonesian FKTP actually reports most: ISPA, hipertensi,
  // gastritis, mialgia, dermatitis, diare. Ranking by frequency is not a
  // cosmetic touch — with 200 rubrics and a two-token query, "hipertensi"
  // matching both I10 and I15.9 equally on text is exactly the case where a
  // usage prior decides correctly, and a clinic picker that puts secondary
  // hypertension above essential hypertension gets closed and never reopened.
  var COMMON = {
    'J06.9': 1, 'I10': 1, 'K29.7': 1, 'K30': 1, 'M79.1': 1, 'A09': 1, 'R50.9': 1,
    'J00': 1, 'J02.9': 1, 'J45.9': 1, 'E11.9': 1, 'M10.9': 1, 'L23.9': 1, 'L30.9': 1,
    'N39.0': 1, 'K02.9': 1, 'K04.0': 1, 'R51': 1, 'M54.5': 1, 'E78.5': 1, 'A91': 1,
    'H61.2': 1, 'B86': 1, 'J30.4': 1, 'K21.9': 1, 'Z34.9': 1, 'D50.9': 1, 'R05': 1,
    'H10.9': 1, 'B35.4': 1, 'M25.5': 1, 'G44.2': 1
  };

  var CODES = RAW.map(function (r) {
    var ch = chapterOf(r[0]);
    return {
      code: r[0],
      en: r[1],
      id: r[2],
      terms: r[3] || '',
      common: !!COMMON[r[0]],
      chapter: ch.label,
      chapterRoman: ch.roman,
      // Pre-lowered haystack; built once so search never allocates per keystroke.
      hay: (r[0] + ' ' + r[1] + ' ' + r[2] + ' ' + (r[3] || '')).toLowerCase()
    };
  });

  var BY_CODE = {};
  CODES.forEach(function (c) { BY_CODE[c.code] = c; });

  /* ---------------------------------------------------------------- search */

  function normalise(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Bounded edit distance. Returns > max as soon as it can prove it, so a
  // 170-row scan with a 3-token query stays well under a frame.
  function editDistanceAtMost(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var best = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      for (j = 0; j <= lb; j++) prev[j] = cur[j];
    }
    return prev[lb];
  }

  function tokensOf(hay) {
    return hay.split(/[^a-z0-9.]+/).filter(Boolean);
  }

  // Score one rubric against one already-normalised query token.
  // Ordering matters more than the absolute numbers: exact code beats code
  // prefix beats whole-word beats word-prefix beats substring beats typo.
  function scoreToken(entry, tok, entryTokens) {
    var code = entry.code.toLowerCase();
    if (tok === code) return 1000;
    if (code.indexOf(tok) === 0) return 620 - (code.length - tok.length);
    // A query like "j069" or "j06.9" should still find J06.9.
    if (tok.length >= 3 && code.replace('.', '').indexOf(tok.replace('.', '')) === 0) return 600;

    var best = 0;
    for (var i = 0; i < entryTokens.length; i++) {
      var w = entryTokens[i];
      if (w === tok) { best = Math.max(best, 400); continue; }
      if (w.indexOf(tok) === 0) { best = Math.max(best, 300 - (w.length - tok.length)); continue; }
      if (tok.length >= 4 && w.indexOf(tok) > 0) { best = Math.max(best, 160); continue; }
      // One typo allowed on words of 5+ characters — "hipertesi" must still
      // find hipertensi, because that is what actually gets typed at speed.
      if (tok.length >= 5 && w.length >= 5 && editDistanceAtMost(tok, w, 1) <= 1) {
        best = Math.max(best, 120);
      }
    }
    return best;
  }

  var TOKEN_CACHE = null;
  function entryTokens() {
    if (!TOKEN_CACHE) {
      TOKEN_CACHE = CODES.map(function (c) { return tokensOf(c.hay); });
    }
    return TOKEN_CACHE;
  }

  /**
   * search(query, limit) -> [{ entry, score }]
   * Every query token must hit something (AND semantics) — "nyeri kepala"
   * must not return every rubric containing "nyeri".
   */
  function search(query, limit) {
    var q = normalise(query);
    var lim = limit || 20;
    if (!q) return CODES.slice(0, lim).map(function (e) { return { entry: e, score: 0 }; });
    var toks = q.split(' ').filter(Boolean);
    var tokenLists = entryTokens();
    var out = [];
    for (var i = 0; i < CODES.length; i++) {
      var total = 0, ok = true;
      for (var t = 0; t < toks.length; t++) {
        var s = scoreToken(CODES[i], toks[t], tokenLists[i]);
        if (s === 0) { ok = false; break; }
        total += s;
      }
      if (!ok) continue;
      // A shorter title matching the same tokens is the more specific hit;
      // a rubric this clinic codes every day breaks the remaining ties.
      out.push({
        entry: CODES[i],
        score: total - CODES[i].hay.length * 0.05 + (CODES[i].common ? 45 : 0)
      });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.code < b.entry.code ? -1 : 1;
    });
    return out.slice(0, lim);
  }

  function get(code) {
    return BY_CODE[String(code || '').toUpperCase()] || null;
  }

  function label(code) {
    var e = get(code);
    return e ? e.code + ' — ' + e.id : String(code);
  }

  R.icd = {
    all: CODES,
    count: CODES.length,
    chapters: CHAPTERS,
    chapterOf: chapterOf,
    get: get,
    label: label,
    search: search,
    editDistanceAtMost: editDistanceAtMost
  };
})(typeof self !== 'undefined' ? self : this);
