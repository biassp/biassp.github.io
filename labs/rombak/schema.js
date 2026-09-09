/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — schema.js
 * Strings and data. This file never touches sql.js, never touches the DOM, and
 * never runs anything. It holds four things:
 *
 *   V1_DDL        the schema a hurried developer actually ships
 *   TABLE_DDL /   the schema at PRAGMA user_version = 9, one entry per object,
 *   INDEX_DDL /   comments included, because several of those comments are the
 *   TRIGGER_DDL   lab's argument and are shown on screen
 *   MIGRATIONS    the nine rungs that get from the first to the second
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE.
 * The DDL the page DISPLAYS and the DDL the engine RUNS are the same strings.
 * There is no second copy. A lab whose Schema tab renders one string while its
 * migration runner executes another is a lab that will eventually show you a
 * table definition that is not in the database, and the reader has no way to
 * tell. So: every migration that rebuilds a table takes its target definition
 * out of TABLE_DDL by name, and the Schema tab's "as written" view renders the
 * same object.
 *
 * WHY THE DECLARATIONS ARE HERE AND NOT IN THE RUNNER.
 * Each migration carries `declares` — which tables it may touch and how —
 * written before the SQL was. It is checked against census.js, which cannot see
 * this file, cannot see the runner, and builds its own table list from
 * sqlite_master. Two independent statements of the same fact, and neither can
 * be derived from the other. That is the only structure that catches a
 * migration which quietly deleted rows and reported success.
 */
(function (root) {
  'use strict';

  // DDL is written a line at a time so the file reads like SQL and the string
  // the engine runs is byte-identical to the string the page prints.
  function ddl() { return Array.prototype.join.call(arguments, '\n'); }

  /* ==================================================================== */
  /* v1 — the legacy schema, and the sixteen tables that are born correct  */
  /* ==================================================================== */

  // The reference tables are NEW and EMPTY at v1, so there is no legacy problem
  // to inherit and no reason to ship them wrong. They get their full constraint
  // set on day one. Every table below that is *not* here is legacy, and §2.1
  // names the version that rebuilds it.

  var REF_DDL = {};

  REF_DDL.role = ddl(
    'CREATE TABLE role (',
    '  id    TEXT NOT NULL PRIMARY KEY,',
    '  label TEXT NOT NULL',
    ') STRICT, WITHOUT ROWID;                     -- 4 rows'
  );

  REF_DDL.poli = ddl(
    'CREATE TABLE poli (',
    '  id        TEXT    NOT NULL PRIMARY KEY,',
    '  label     TEXT    NOT NULL,',
    '  prefix    TEXT    NOT NULL UNIQUE CHECK (length(prefix) = 1),',
    '  konsul_rp INTEGER NOT NULL CHECK (konsul_rp > 0)',
    ') STRICT, WITHOUT ROWID;                     -- 3 rows'
  );

  REF_DDL.queue_state = ddl(
    'CREATE TABLE queue_state (',
    '  id          TEXT    NOT NULL PRIMARY KEY,',
    '  label       TEXT    NOT NULL,',
    '  display_ord INTEGER,                       -- NULL for the two off-path states',
    '  is_terminal INTEGER NOT NULL CHECK (is_terminal IN (0,1))',
    ') STRICT, WITHOUT ROWID;                     -- 9 rows'
  );

  REF_DDL.queue_transition = ddl(
    '-- The queue is DATA, not branches: 9 states, 12 edges, and "who may take this',
    '-- edge" is a join rather than an `if`. The guard is an id resolved in JS,',
    '-- because a guard inspects vitals and signatures and SQL cannot express that.',
    '-- Pretending otherwise would be the dishonest part.',
    'CREATE TABLE queue_transition (',
    '  from_state TEXT NOT NULL REFERENCES queue_state(id) ON DELETE RESTRICT,',
    '  to_state   TEXT NOT NULL REFERENCES queue_state(id) ON DELETE RESTRICT,',
    '  guard_id   TEXT,',
    '  PRIMARY KEY (from_state, to_state),',
    '  CHECK (from_state <> to_state)',
    ') STRICT, WITHOUT ROWID;                     -- 12 rows'
  );

  REF_DDL.queue_transition_role = ddl(
    'CREATE TABLE queue_transition_role (',
    '  from_state TEXT NOT NULL,',
    '  to_state   TEXT NOT NULL,',
    '  role_id    TEXT NOT NULL REFERENCES role(id) ON DELETE RESTRICT,',
    '  PRIMARY KEY (from_state, to_state, role_id),',
    '  FOREIGN KEY (from_state, to_state)',
    '    REFERENCES queue_transition(from_state, to_state) ON DELETE CASCADE',
    ') STRICT, WITHOUT ROWID;'
  );

  REF_DDL.acuity = ddl(
    'CREATE TABLE acuity (',
    '  id    TEXT    NOT NULL PRIMARY KEY,',
    '  label TEXT    NOT NULL,',
    '  rank  INTEGER NOT NULL UNIQUE',
    ') STRICT, WITHOUT ROWID;                     -- 3 rows'
  );

  REF_DDL.tindakan = ddl(
    'CREATE TABLE tindakan (                      -- procedures',
    '  id           TEXT    NOT NULL PRIMARY KEY,',
    '  label        TEXT    NOT NULL,',
    '  price_rp     INTEGER NOT NULL CHECK (price_rp > 0),',
    '  bpjs_covered INTEGER NOT NULL CHECK (bpjs_covered IN (0,1))',
    ') STRICT, WITHOUT ROWID;                     -- 14 rows'
  );

  REF_DDL.kecelakaan = ddl(
    'CREATE TABLE kecelakaan (                    -- incident type; decides who pays first',
    '  id    TEXT NOT NULL PRIMARY KEY,',
    '  label TEXT NOT NULL,',
    '  payer TEXT',
    ') STRICT, WITHOUT ROWID;                     -- 3 rows'
  );

  REF_DDL.allergy_class = ddl(
    'CREATE TABLE allergy_class (',
    '  id    TEXT NOT NULL PRIMARY KEY,',
    '  label TEXT NOT NULL',
    ') STRICT, WITHOUT ROWID;                     -- 7 rows'
  );

  REF_DDL.addendable_path = ddl(
    'CREATE TABLE addendable_path (',
    '  path  TEXT NOT NULL PRIMARY KEY',
    "        CHECK (path IN ('s','o.exam','o.vitals','a','p.plan','p.edukasi')),",
    '  label TEXT NOT NULL,',
    "  kind  TEXT NOT NULL CHECK (kind IN ('text','vitals','assessment'))",
    ') STRICT, WITHOUT ROWID;                     -- 6 rows'
  );

  REF_DDL.addendable_path_role = ddl(
    'CREATE TABLE addendable_path_role (',
    '  path    TEXT NOT NULL REFERENCES addendable_path(path) ON DELETE CASCADE,',
    '  role_id TEXT NOT NULL REFERENCES role(id) ON DELETE RESTRICT,',
    '  PRIMARY KEY (path, role_id)',
    ') STRICT, WITHOUT ROWID;',
    "-- 'o.vitals' is the single path on which a perawat may amend a doctor's signed",
    '-- note. In the IndexedDB version that carve-out is an `if` that was once scoped',
    "-- to role === 'dokter' and therefore never fired for anyone else. Here it is a",
    '-- row, and the FK on (path, by_role) in `addendum` is what enforces it.'
  );

  REF_DDL.icd10_chapter = ddl(
    '-- Chapter is a property of the CODE RANGE. Duplicating a boundary across 218',
    '-- rubrics is how boundaries drift, so there is no chapter column on icd10 and',
    '-- the relationship is a BETWEEN join against the generated 3-character head.',
    'CREATE TABLE icd10_chapter (',
    '  roman   TEXT NOT NULL PRIMARY KEY,',
    '  label   TEXT NOT NULL,',
    '  code_lo TEXT NOT NULL CHECK (length(code_lo) = 3),',
    '  code_hi TEXT NOT NULL CHECK (length(code_hi) = 3),',
    '  CHECK (code_lo <= code_hi)',
    ') STRICT, WITHOUT ROWID;                     -- 21 rows, I..XXI'
  );

  REF_DDL.icd10 = ddl(
    'CREATE TABLE icd10 (',
    "  code      TEXT    NOT NULL PRIMARY KEY CHECK (code GLOB '[A-Z][0-9][0-9]*'),",
    '  title_en  TEXT    NOT NULL,',
    '  title_id  TEXT    NOT NULL,',
    "  terms     TEXT    NOT NULL DEFAULT '',",
    '  is_common INTEGER NOT NULL DEFAULT 0 CHECK (is_common IN (0,1)),',
    '  head      TEXT    GENERATED ALWAYS AS (substr(code,1,3)) VIRTUAL',
    ') STRICT;                                    -- 218 rubrics, 33 of them common'
  );

  REF_DDL.staff = ddl(
    'CREATE TABLE staff (',
    '  id      TEXT NOT NULL PRIMARY KEY,',
    '  name    TEXT NOT NULL CHECK (length(trim(name)) > 0),',
    '  role_id TEXT NOT NULL REFERENCES role(id) ON DELETE RESTRICT,',
    '  title   TEXT NOT NULL,',
    '  sip     TEXT,                              -- practice licence; NULL for clerks',
    '  poli_id TEXT REFERENCES poli(id) ON DELETE RESTRICT,',
    '  UNIQUE (id, role_id),                      -- exists ONLY as a composite-FK target',
    "  CHECK (poli_id IS NULL OR role_id = 'dokter')",
    ') STRICT;                                    -- 6 rows'
  );

  REF_DDL.audit_action = ddl(
    'CREATE TABLE audit_action (id TEXT NOT NULL PRIMARY KEY) STRICT, WITHOUT ROWID;  -- 18 rows'
  );

  REF_DDL.rm_counter = ddl(
    'CREATE TABLE rm_counter (',
    '  k    INTEGER NOT NULL PRIMARY KEY CHECK (k = 1),',
    '  last INTEGER NOT NULL CHECK (last >= 0)',
    ') STRICT, WITHOUT ROWID;',
    '-- Bumped and committed BEFORE the patient row is written, so a crash burns a',
    '-- number instead of risking a reissue. Burning numbers is free. Reissuing an',
    "-- RM merges two people's medical histories."
  );

  REF_DDL.queue_counter = ddl(
    'CREATE TABLE queue_counter (',
    '  visit_date TEXT    NOT NULL,',
    '  poli_id    TEXT    NOT NULL REFERENCES poli(id) ON DELETE RESTRICT,',
    '  last_seq   INTEGER NOT NULL CHECK (last_seq >= 0),',
    '  PRIMARY KEY (visit_date, poli_id)',
    ') STRICT, WITHOUT ROWID;',
    '-- A queue number is unique only inside (date, poli) and is reused every',
    '-- morning. It is a counter, not an identifier, and nothing clinical is allowed',
    '-- to reference it — see `visit` below.'
  );

  // The runner's own book. Off every verification path by construction: nothing
  // in census.js can reach it, and no assertion reads it.
  var SCHEMA_MIGRATION_DDL = ddl(
    'CREATE TABLE schema_migration (',
    '  version    INTEGER NOT NULL PRIMARY KEY CHECK (version > 0),',
    '  name       TEXT    NOT NULL,',
    '  applied_at TEXT    NOT NULL,',
    '  ms         INTEGER NOT NULL CHECK (ms >= 0)',
    ') STRICT;',
    '-- PRAGMA user_version is the counter, and it is the ONLY thing consulted to',
    '-- decide what runs next. This table is a human-readable log beside it.',
    '-- NOTHING ON ANY VERIFICATION PATH MAY READ THIS TABLE. It is the migration',
    "-- runner's own bookkeeping, and a check that reads it is the self-verifying",
    '-- proof this repository has shipped three times. census.js is structurally',
    '-- unable to reach it: see §4.3.'
  );

  // ------------------------------------------------------------ the legacy
  // Eight tables in the shape a JavaScript-shaped dump produces. Not STRICT.
  // No foreign keys. Multi-valued fields comma-joined. Money REAL. This is
  // defensible on day one and indefensible on day four hundred, and every one
  // of the nine migrations exists because of one line in here.

  var LEGACY_DDL = {};

  LEGACY_DDL.patient = ddl(
    '-- Legacy. Not STRICT. No foreign keys anywhere. Multi-valued fields comma-joined.',
    'CREATE TABLE patient (',
    '  rm_number TEXT PRIMARY KEY, name TEXT, name_norm TEXT, sex TEXT, dob TEXT,',
    '  nik_demo TEXT, bpjs_demo TEXT, phone TEXT, address TEXT, klass TEXT,',
    '  created_at TEXT, is_demo INTEGER,',
    "  allergies_csv TEXT,          -- 'penisilin,nsaid'",
    "  chronic_csv   TEXT           -- 'I10,I48'",
    ');'
  );

  LEGACY_DDL.visit = ddl(
    'CREATE TABLE visit (',
    '  id TEXT PRIMARY KEY, rm_number TEXT, visit_date TEXT, poli_id TEXT, klass TEXT,',
    '  status TEXT, queue_no TEXT, queue_seq INTEGER, complaint TEXT,',
    '  doctor_id TEXT, opened_at TEXT, opened_by TEXT, billed_at TEXT,',
    '  tindakan_csv TEXT, history_json TEXT,',
    '  td_sistol INTEGER, td_diastol INTEGER, nadi INTEGER, suhu_dc INTEGER,',
    '  rr INTEGER, spo2 INTEGER, bb_hg INTEGER, tb_mm INTEGER,',
    '  acuity_id TEXT, triage_by TEXT, triage_at TEXT',
    ');'
  );

  LEGACY_DDL.encounter = ddl(
    'CREATE TABLE encounter (',
    '  id TEXT PRIMARY KEY, visit_id TEXT, rm_number TEXT, doctor_id TEXT, status TEXT,',
    '  s TEXT, o_exam TEXT, p_plan TEXT, p_edukasi TEXT, p_kontrol TEXT,',
    '  created_at TEXT, signed_at TEXT, signed_by TEXT',
    ');'
  );

  LEGACY_DDL.encounter_diagnosis = ddl(
    'CREATE TABLE encounter_diagnosis (encounter_id TEXT, icd_code TEXT, is_primary INTEGER, note TEXT);'
  );

  LEGACY_DDL.addendum = ddl(
    'CREATE TABLE addendum (',
    '  id TEXT PRIMARY KEY, seq INTEGER, encounter_id TEXT, path TEXT,',
    '  old_value TEXT, new_value TEXT, reason TEXT, by_staff TEXT, by_role TEXT, at TEXT',
    ');'
  );

  LEGACY_DDL.bill = ddl(
    '-- Money REAL. Four columns that a float multiply can move by 0.000000001.',
    'CREATE TABLE bill (',
    '  visit_id TEXT PRIMARY KEY, klass TEXT, kecelakaan_id TEXT,',
    '  total_tarif REAL, ditanggung REAL, ditanggung_lain REAL, dibayar_pasien REAL,',
    '  note TEXT, closed_at TEXT, closed_by TEXT',
    ');'
  );

  LEGACY_DDL.bill_line = ddl(
    'CREATE TABLE bill_line (',
    '  visit_id TEXT, line_no INTEGER, label TEXT, grp TEXT,',
    '  qty INTEGER, unit REAL, amount REAL, covered INTEGER, payer TEXT',
    ');'
  );

  LEGACY_DDL.audit_entry = ddl(
    'CREATE TABLE audit_entry (',
    '  seq INTEGER PRIMARY KEY, at TEXT, actor_id TEXT, actor_name TEXT, actor_role TEXT,',
    '  action TEXT, summary TEXT, detail TEXT,',
    '  entity TEXT, entity_id TEXT,      -- one polymorphic string column, unconstrained',
    '  prev_hash TEXT, hash TEXT',
    ');'
  );

  /* ==================================================================== */
  /* the schema at PRAGMA user_version = 9                                 */
  /* ==================================================================== */

  var TABLE_DDL = {};
  var i, k;
  for (k in REF_DDL) if (Object.prototype.hasOwnProperty.call(REF_DDL, k)) TABLE_DDL[k] = REF_DDL[k];
  TABLE_DDL.schema_migration = SCHEMA_MIGRATION_DDL;

  TABLE_DDL.patient = ddl(
    'CREATE TABLE patient (',
    '  rm_number  TEXT    NOT NULL PRIMARY KEY',
    "             CHECK (rm_number GLOB 'RM-[0-9][0-9][0-9][0-9][0-9][0-9]'),",
    '  rm_seq     INTEGER NOT NULL UNIQUE CHECK (rm_seq > 0),',
    '  name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),',
    '  name_norm  TEXT    NOT NULL,               -- lowercased, punctuation collapsed',
    "  sex        TEXT    NOT NULL CHECK (sex IN ('L','P')),",
    '  dob        TEXT    NOT NULL',
    "             CHECK (dob GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),",
    "  nik_demo   TEXT    NOT NULL CHECK (nik_demo GLOB 'NIK-FIKTIF-*'),",
    "  bpjs_demo  TEXT             CHECK (bpjs_demo IS NULL OR bpjs_demo GLOB 'BPJS-FIKTIF-*'),",
    "  phone      TEXT    NOT NULL CHECK (phone GLOB '08[0-9][0-9]-FIKTIF-[0-9][0-9][0-9]'),",
    "  address    TEXT    NOT NULL DEFAULT '',",
    "  klass      TEXT    NOT NULL CHECK (klass IN ('umum','bpjs')),",
    '  pregnant   INTEGER NOT NULL DEFAULT 0 CHECK (pregnant IN (0,1)),',
    '  created_at TEXT    NOT NULL,',
    '  is_demo    INTEGER NOT NULL DEFAULT 1 CHECK (is_demo = 1),',
    "  CHECK (rm_number = 'RM-' || substr('000000' || rm_seq, -6)),",
    "  CHECK (klass <> 'bpjs' OR bpjs_demo IS NOT NULL),",
    "  CHECK (pregnant = 0 OR sex = 'P'),",
    '  CHECK (dob <= created_at)                  -- a future dob passes every',
    '                                             -- age-dependent check silently',
    ') STRICT;',
    '-- CHECK (is_demo = 1) is not decoration: the table is structurally incapable of',
    '-- holding a row that claims to be real. The NIK GLOB makes a valid 16-digit NIK',
    '-- unstorable — a real one encodes province, regency, district, birth date and',
    '-- sex, and nothing here can be mistaken for one or typed into a real system.'
  );

  TABLE_DDL.patient_allergy = ddl(
    '-- THE HIGHEST-STAKES FOREIGN KEY IN THE SCHEMA.',
    '-- In the IndexedDB version this is an array of strings and the check reads',
    '--   var cls = ALLERGY_BY_ID[aid]; if (!cls) return;',
    '-- A misspelled class id therefore produces no error, no warning and no finding:',
    '-- the patient simply has no allergy as far as the contraindication engine is',
    '-- concerned, and the amoxicillin prescription signs cleanly. Here the bad value',
    '-- cannot be written. ON DELETE RESTRICT on class_id additionally means a class',
    '-- cannot be retired out from under the rows that depend on it.',
    'CREATE TABLE patient_allergy (',
    '  rm_number TEXT NOT NULL REFERENCES patient(rm_number) ON DELETE CASCADE,',
    '  class_id  TEXT NOT NULL REFERENCES allergy_class(id) ON DELETE RESTRICT,',
    '  PRIMARY KEY (rm_number, class_id)',
    ') STRICT, WITHOUT ROWID;'
  );

  TABLE_DDL.patient_chronic = ddl(
    'CREATE TABLE patient_chronic (',
    '  rm_number TEXT NOT NULL REFERENCES patient(rm_number) ON DELETE CASCADE,',
    '  icd_code  TEXT NOT NULL REFERENCES icd10(code) ON DELETE RESTRICT,',
    '  PRIMARY KEY (rm_number, icd_code)',
    ') STRICT, WITHOUT ROWID;'
  );

  TABLE_DDL.visit = ddl(
    'CREATE TABLE visit (',
    '  id            TEXT    NOT NULL PRIMARY KEY,',
    '  rm_number     TEXT    NOT NULL REFERENCES patient(rm_number) ON DELETE RESTRICT,',
    '  visit_date    TEXT    NOT NULL',
    "                CHECK (visit_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),",
    '  poli_id       TEXT    NOT NULL REFERENCES poli(id) ON DELETE RESTRICT,',
    "  klass         TEXT    NOT NULL CHECK (klass IN ('umum','bpjs')),",
    '  status        TEXT    NOT NULL REFERENCES queue_state(id) ON DELETE RESTRICT,',
    '  queue_no      TEXT    NOT NULL,',
    '  queue_seq     INTEGER NOT NULL CHECK (queue_seq > 0),',
    '  complaint     TEXT    NOT NULL CHECK (length(trim(complaint)) > 0),',
    '  kecelakaan_id TEXT             REFERENCES kecelakaan(id) ON DELETE RESTRICT,',
    '  doctor_id     TEXT             REFERENCES staff(id) ON DELETE RESTRICT,',
    '  doctor_role   TEXT    GENERATED ALWAYS AS',
    "                (CASE WHEN doctor_id IS NULL THEN NULL ELSE 'dokter' END) VIRTUAL,",
    '  opened_at     TEXT    NOT NULL,',
    '  opened_by     TEXT    NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,',
    '  billed_at     TEXT,',
    "  CHECK (id GLOB 'V-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),",
    "  CHECK (id LIKE 'V-' || replace(visit_date,'-','') || '-%'),",
    '  FOREIGN KEY (visit_date, poli_id)',
    '    REFERENCES queue_counter(visit_date, poli_id) ON DELETE RESTRICT,',
    '  FOREIGN KEY (doctor_id, doctor_role) REFERENCES staff(id, role_id) ON DELETE RESTRICT,',
    '  UNIQUE (visit_date, poli_id, queue_seq),',
    '  UNIQUE (visit_date, poli_id, queue_no),',
    '  UNIQUE (id, rm_number)                     -- composite-FK target for encounter',
    ') STRICT;',
    '-- THREE IDENTIFIERS, THREE LIFETIMES, ON ONE ROW:',
    "--   rm_number  the patient's, for life, never reused, never reissued",
    "--   id         this visit's, unique forever, what clinical records hang off",
    '--   queue_no   unique only within (visit_date, poli_id), reused tomorrow',
    "-- UNIQUE(visit_date, poli_id, queue_no) states the queue number's true scope.",
    '-- It is deliberately NOT unique on its own, and NO clinical table below carries',
    '-- a queue_no column — a record hung off a queue number is lost at midnight.',
    '-- That absence is asserted by walking pragma_foreign_key_list over every table',
    '-- (G3), which is the machine-checkable form of the rule.',
    '--',
    '-- THE COMPOSITE FK ON (doctor_id, doctor_role) IS THE ROLE RESTRICTION.',
    '-- doctor_role is VIRTUAL — zero stored bytes, cannot drift from doctor_id — and',
    "-- pinned to the literal 'dokter', so the FK can only be satisfied by a staff",
    "-- row whose role_id is 'dokter'. VERIFIED: a dokter inserts, a perawat gets",
    '-- FOREIGN KEY constraint failed, NULL is accepted.',
    '-- The IndexedDB version validates this in assignDoctor() and NOT in openVisit(),',
    '-- and the menunggu-dokter -> konsultasi guard only tests that doctor_id is',
    '-- non-null. A dangling id therefore passes the guard, produces an encounter',
    '-- whose doctorId names nobody, and then signEncounter compares',
    '-- e.doctorId !== actor.id and the note can never be signed by anyone at all.',
    '-- Deadlock by dangling foreign key. One composite FK closes it.'
  );

  TABLE_DDL.visit_tindakan = ddl(
    'CREATE TABLE visit_tindakan (',
    '  visit_id    TEXT NOT NULL REFERENCES visit(id) ON DELETE CASCADE,',
    '  tindakan_id TEXT NOT NULL REFERENCES tindakan(id) ON DELETE RESTRICT',
    "              CHECK (tindakan_id <> 'none'),",
    '  PRIMARY KEY (visit_id, tindakan_id)',
    ') STRICT, WITHOUT ROWID;',
    '-- A tindakan id that no longer resolves silently drops money out of the bill,',
    '-- which is the number the clinic reports for capitation reconciliation. In the',
    '-- IndexedDB version the array is filtered on write and the bad id vanishes',
    '-- without a word.'
  );

  TABLE_DDL.visit_status_history = ddl(
    'CREATE TABLE visit_status_history (',
    '  visit_id   TEXT    NOT NULL REFERENCES visit(id) ON DELETE CASCADE,',
    '  ordinal    INTEGER NOT NULL CHECK (ordinal >= 0),',
    '  from_state TEXT             REFERENCES queue_state(id) ON DELETE RESTRICT,',
    '  to_state   TEXT    NOT NULL REFERENCES queue_state(id) ON DELETE RESTRICT,',
    '  at         TEXT    NOT NULL,',
    '  by_staff   TEXT    NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,',
    '  by_role    TEXT    NOT NULL REFERENCES role(id)  ON DELETE RESTRICT,',
    '  PRIMARY KEY (visit_id, ordinal),',
    '  CHECK ((ordinal = 0) = (from_state IS NULL))',
    ') STRICT, WITHOUT ROWID;',
    '-- `at` is NOT the key: the generator produces same-millisecond transitions and',
    '-- a timestamp key would collapse them. (visit_id, ordinal) is.'
  );

  TABLE_DDL.triage = ddl(
    'CREATE TABLE triage (',
    '  visit_id   TEXT    NOT NULL PRIMARY KEY REFERENCES visit(id) ON DELETE CASCADE,',
    '  td_sistol  INTEGER CHECK (td_sistol  IS NULL OR td_sistol  BETWEEN 50 AND 300),',
    '  td_diastol INTEGER CHECK (td_diastol IS NULL OR td_diastol BETWEEN 20 AND 200),',
    '  nadi       INTEGER CHECK (nadi       IS NULL OR nadi       BETWEEN 20 AND 250),',
    '  suhu_dc    INTEGER CHECK (suhu_dc    IS NULL OR suhu_dc    BETWEEN 250 AND 450),',
    '  rr         INTEGER CHECK (rr         IS NULL OR rr         BETWEEN 4 AND 80),',
    '  spo2       INTEGER CHECK (spo2       IS NULL OR spo2       BETWEEN 50 AND 100),',
    '  bb_hg      INTEGER CHECK (bb_hg      IS NULL OR bb_hg      BETWEEN 5 AND 3000),',
    '  tb_mm      INTEGER CHECK (tb_mm      IS NULL OR tb_mm      BETWEEN 300 AND 2500),',
    '  acuity_id  TEXT    NOT NULL REFERENCES acuity(id) ON DELETE RESTRICT,',
    "  note       TEXT    NOT NULL DEFAULT '',",
    '  by_staff   TEXT    NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,',
    '  at         TEXT    NOT NULL,',
    '  CHECK (td_diastol IS NULL OR td_sistol IS NULL OR td_diastol < td_sistol),',
    '  CHECK (coalesce(td_sistol,nadi,suhu_dc,rr,spo2,bb_hg,tb_mm) IS NOT NULL)',
    ') STRICT;',
    '-- The ranges are typo guards, not clinical ranges: they exist to catch a nurse',
    '-- entering height in metres. The last CHECK is the rule that an empty form must',
    '-- not save — a patient nobody measured is not a patient who is not sick.'
  );

  TABLE_DDL.encounter = ddl(
    'CREATE TABLE encounter (',
    '  id         TEXT NOT NULL PRIMARY KEY',
    "             CHECK (id GLOB 'E-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),",
    '  visit_id   TEXT NOT NULL UNIQUE REFERENCES visit(id) ON DELETE RESTRICT,',
    '  rm_number  TEXT NOT NULL,',
    '  doctor_id  TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,',
    "  status     TEXT NOT NULL CHECK (status IN ('draft','signed')),",
    "  s          TEXT NOT NULL DEFAULT '',",
    "  o_exam     TEXT NOT NULL DEFAULT '',",
    "  p_plan     TEXT NOT NULL DEFAULT '',",
    "  p_edukasi  TEXT NOT NULL DEFAULT '',",
    "  p_kontrol  TEXT NOT NULL DEFAULT '',",
    '  created_at TEXT NOT NULL,',
    '  signed_at  TEXT,',
    '  signed_by  TEXT REFERENCES staff(id) ON DELETE RESTRICT,',
    '  FOREIGN KEY (visit_id, rm_number) REFERENCES visit(id, rm_number) ON DELETE RESTRICT,',
    "  CHECK ((status = 'signed') = (signed_at IS NOT NULL AND signed_by IS NOT NULL)),",
    "  CHECK (status = 'draft' OR signed_by = doctor_id),",
    "  CHECK (status = 'draft' OR length(trim(s)) > 0)",
    ') STRICT;',
    '-- UNIQUE(visit_id) is the constraint the IndexedDB version has only as a',
    '-- convention: encounterForVisit() takes [0] of a filter and startEncounter()',
    '-- returns the existing row instead of making a second. Nothing stopped a second',
    '-- row from existing.',
    '-- THE COMPOSITE FK IS WHY rm_number IS HERE AT ALL. It is a denormalisation the',
    '-- original also carries. Declared against UNIQUE(id, rm_number) on the parent,',
    '-- the redundant copy is provably equal to the visit\'s — it cannot drift. A',
    '-- denormalisation with a constraint behind it is a cache; without one it is a',
    '-- second source of truth.',
    '-- CHECK(signed_by = doctor_id) is "a signature attaches to the author of the',
    '-- content, not to whoever has the screen open". Co-signature is not modelled,',
    '-- and the schema says so rather than the documentation saying so.'
  );

  TABLE_DDL.encounter_vitals = ddl(
    'CREATE TABLE encounter_vitals (',
    '  encounter_id TEXT NOT NULL PRIMARY KEY REFERENCES encounter(id) ON DELETE CASCADE,',
    '  td_sistol INTEGER, td_diastol INTEGER, nadi INTEGER, suhu_dc INTEGER,',
    '  rr INTEGER, spo2 INTEGER, bb_hg INTEGER, tb_mm INTEGER,',
    '  copied_at TEXT NOT NULL',
    ') STRICT;',
    '-- A COPY of triage, not a view of it, and deliberately so: a later re-triage',
    '-- must not silently change what a signed note says was measured. This is the',
    '-- one place in the schema where duplication is correct and a join would be',
    '-- wrong.'
  );

  TABLE_DDL.encounter_diagnosis = ddl(
    'CREATE TABLE encounter_diagnosis (',
    '  encounter_id TEXT    NOT NULL REFERENCES encounter(id) ON DELETE RESTRICT,',
    '  icd_code     TEXT    NOT NULL REFERENCES icd10(code)   ON DELETE RESTRICT,',
    '  is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),',
    "  note         TEXT    NOT NULL DEFAULT '',",
    '  PRIMARY KEY (encounter_id, icd_code)',
    ') STRICT, WITHOUT ROWID;',
    '-- ON DELETE RESTRICT because a coded diagnosis is a reportable, claimable fact.',
    '-- That single word is the loud half of the v7 rebuild trap; its sibling',
    '-- `addendum` says CASCADE and is the silent half. Neither word is wrong.'
  );

  TABLE_DDL.addendum = ddl(
    'CREATE TABLE addendum (',
    '  id           TEXT    NOT NULL PRIMARY KEY,',
    '  seq          INTEGER NOT NULL UNIQUE CHECK (seq > 0),   -- global, not per-encounter',
    '  encounter_id TEXT    NOT NULL REFERENCES encounter(id) ON DELETE CASCADE,',
    '  path         TEXT    NOT NULL REFERENCES addendable_path(path) ON DELETE RESTRICT,',
    '  old_value    TEXT,                          -- canonical JSON',
    '  new_value    TEXT    NOT NULL,              -- canonical JSON',
    '  reason       TEXT    NOT NULL CHECK (length(trim(reason)) > 0),',
    '  by_staff     TEXT    NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,',
    '  by_role      TEXT    NOT NULL REFERENCES role(id)  ON DELETE RESTRICT,',
    '  at           TEXT    NOT NULL,',
    '  FOREIGN KEY (path, by_role)',
    '    REFERENCES addendable_path_role(path, role_id) ON DELETE RESTRICT,',
    '  CHECK (old_value IS NULL OR old_value <> new_value)',
    ') STRICT;',
    '-- ON DELETE CASCADE is CORRECT domain modelling — an addendum to an encounter',
    '-- that does not exist is meaningless — and it is exactly what makes the naive',
    '-- rebuild in v7 destroy data in silence. The right answer is not to change this',
    '-- word. It is to run the rebuild in the documented order.',
    "-- The FK on `path` closes the original's silent drop: effectiveEncounter() does",
    '-- `if (!ADDENDABLE[a.path]) return;`, so a correction on an unknown path',
    '-- vanishes from the operative record while the audit log still says a',
    '-- correction was made.',
    '-- The composite FK on (path, by_role) is per-path role authority, declaratively.'
  );

  TABLE_DDL.bill = ddl(
    'CREATE TABLE bill (',
    '  visit_id           TEXT    NOT NULL PRIMARY KEY REFERENCES visit(id) ON DELETE RESTRICT,',
    "  klass              TEXT    NOT NULL CHECK (klass IN ('umum','bpjs')),",
    '  kecelakaan_id      TEXT             REFERENCES kecelakaan(id) ON DELETE RESTRICT,',
    '  total_tarif_rp     INTEGER NOT NULL CHECK (total_tarif_rp     >= 0),',
    '  ditanggung_rp      INTEGER NOT NULL CHECK (ditanggung_rp      >= 0),',
    '  ditanggung_lain_rp INTEGER NOT NULL CHECK (ditanggung_lain_rp >= 0),',
    '  dibayar_pasien_rp  INTEGER NOT NULL CHECK (dibayar_pasien_rp  >= 0),',
    "  note               TEXT    NOT NULL DEFAULT '',",
    '  closed_at          TEXT    NOT NULL,',
    '  closed_by          TEXT    NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,',
    '  CHECK (total_tarif_rp = ditanggung_rp + ditanggung_lain_rp + dibayar_pasien_rp)',
    ') STRICT;',
    '-- A FROZEN SNAPSHOT, and it stays one. Prices change; a bill closed in March',
    '-- must not silently re-price in September because the tariff table moved. Do',
    '-- not "normalise" this into a view.',
    '-- Two genuinely different totals, both needed: total_tarif_rp is what the',
    '-- clinic reports for capitation, dibayar_pasien_rp is what the person actually',
    '-- hands over — zero for a covered BPJS patient.',
    '-- The final CHECK is the only invariant that must hold forever, and it is in',
    '-- the schema rather than in a nightly report. VERIFIED to refuse a row whose',
    '-- parts do not sum, with `CHECK constraint failed: total_tarif_rp = ...`.'
  );

  TABLE_DDL.bill_line = ddl(
    'CREATE TABLE bill_line (',
    '  visit_id  TEXT    NOT NULL REFERENCES bill(visit_id) ON DELETE CASCADE,',
    '  line_no   INTEGER NOT NULL CHECK (line_no > 0),',
    '  label     TEXT    NOT NULL,',
    "  grp       TEXT    NOT NULL CHECK (grp IN ('administrasi','jasa','tindakan','obat')),",
    '  qty       INTEGER NOT NULL CHECK (qty > 0),',
    '  unit_rp   INTEGER NOT NULL CHECK (unit_rp >= 0),',
    '  amount_rp INTEGER GENERATED ALWAYS AS (qty * unit_rp) STORED,',
    '  covered   INTEGER NOT NULL CHECK (covered IN (0,1)),',
    "  payer     TEXT    NOT NULL CHECK (payer IN ('bpjs','iur','pasien','penjamin-lain')),",
    '  PRIMARY KEY (visit_id, line_no)',
    ') STRICT;',
    '-- amount_rp IS GENERATED, so a line total cannot drift from its own inputs.',
    '-- STORED rather than VIRTUAL only because the reconciliation query sums it',
    '-- across every line in the database; VIRTUAL would recompute per row on every',
    '-- scan. INSERT INTO bill_line(amount_rp, ...) raises',
    '-- `cannot INSERT into generated column "amount_rp"` — the Constraints tab fires',
    '-- it on click.'
  );

  TABLE_DDL.audit_entry = ddl(
    'CREATE TABLE audit_entry (',
    '  seq              INTEGER NOT NULL PRIMARY KEY,',
    '  at               TEXT    NOT NULL,',
    '  actor_id         TEXT    NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,',
    '  actor_name       TEXT    NOT NULL,',
    '  actor_role       TEXT    NOT NULL REFERENCES role(id) ON DELETE RESTRICT,',
    '  action           TEXT    NOT NULL REFERENCES audit_action(id) ON DELETE RESTRICT,',
    '  summary          TEXT    NOT NULL,',
    '  detail           TEXT    NOT NULL,          -- canonical JSON, sorted keys',
    '  entity           TEXT    NOT NULL',
    "                   CHECK (entity IN ('patient','visit','encounter')),",
    '  ent_patient      TEXT REFERENCES patient(rm_number) ON DELETE RESTRICT,',
    '  ent_visit        TEXT REFERENCES visit(id)          ON DELETE RESTRICT,',
    '  ent_encounter    TEXT REFERENCES encounter(id)      ON DELETE RESTRICT,',
    '  prev_hash        TEXT REFERENCES audit_entry(hash) DEFERRABLE INITIALLY DEFERRED,',
    '  hash             TEXT    NOT NULL UNIQUE',
    "                   CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),",
    '  CHECK (prev_hash IS NULL',
    "         OR (length(prev_hash) = 64 AND prev_hash NOT GLOB '*[^0-9a-f]*')),",
    '  CHECK ((seq = 0 AND prev_hash IS NULL) OR (seq > 0 AND prev_hash IS NOT NULL)),',
    '  CHECK ((ent_patient IS NOT NULL) + (ent_visit IS NOT NULL)',
    '       + (ent_encounter IS NOT NULL) = 1),',
    "  CHECK (entity <> 'patient'   OR ent_patient   IS NOT NULL),",
    "  CHECK (entity <> 'visit'     OR ent_visit     IS NOT NULL),",
    "  CHECK (entity <> 'encounter' OR ent_encounter IS NOT NULL)",
    ') STRICT;',
    '-- entity_id IS POLYMORPHIC AND NO SINGLE FK CAN EXPRESS IT.',
    '-- The trade-off taken: three nullable typed columns plus a CHECK that exactly',
    '-- one is non-null. COST: three columns, two of them always NULL, and every read',
    '-- is a coalesce(); adding a fourth entity type is a table rebuild. BENEFIT:',
    '-- every one of them is a real FK, so an audit row naming a patient that does',
    '-- not exist cannot be inserted — which is the entire value of an audit trail in',
    '-- the dispute it exists for. THE ALTERNATIVE (one TEXT column plus a trigger)',
    '-- keeps the table narrow and moves the check into procedural code that a bulk',
    '-- load can be told to skip. Both are named on the Constraints tab; this one was',
    '-- taken. VERIFIED: the sum-of-booleans CHECK refuses zero and refuses two.',
    '-- actor_name and actor_role are DENORMALISED ON PURPOSE: an audit row records',
    '-- the name AS IT WAS. Joining to a mutable staff row would rewrite history',
    '-- every time somebody married.',
    '-- prev_hash REFERENCES hash makes deleting a non-tail entry impossible at the',
    '-- database level. DEFERRABLE so the whole chain can be inserted in one',
    '-- transaction. NOTE, and the page says this: it does NOT stop a table rebuild',
    '-- (§0.2), and the BEFORE DELETE trigger does not fire on DROP TABLE.'
  );

  TABLE_DDL.audit_commitment = ddl(
    'CREATE TABLE audit_commitment (',
    "  k     TEXT    NOT NULL PRIMARY KEY CHECK (k = 'chain'),",
    '  count INTEGER NOT NULL CHECK (count >= 0),',
    '  head  TEXT    NOT NULL CHECK (length(head) = 64),',
    '  at    TEXT    NOT NULL',
    ') STRICT, WITHOUT ROWID;',
    '-- The length/head commitment, held OUTSIDE the chain, rewritten on every save.',
    '-- Without it, deleting the last three rows costs nothing and the walk reports a',
    '-- perfect chain over what is left. With it, truncation costs the same as',
    '-- editing. It is NOT an external anchor: an attacker with write access to both',
    '-- recomputes both. Only a countersigning server or a published daily head hash',
    '-- fixes that, and neither is available to a page with connect-src \'none\'. Said',
    '-- plainly on the page.'
  );

  /* ------------------------------------------------------------- indexes */

  var INDEX_DDL = {};

  INDEX_DDL.idx_icd10_head = ddl(
    'CREATE INDEX idx_icd10_head ON icd10(head);',
    '--   WHY: the chapter roll-up is a range lookup on the 3-character head.',
    '--   Indexing a VIRTUAL generated column costs zero bytes in the row and turns',
    '--   the BETWEEN join into a SEARCH. VERIFIED plan:',
    '--     SCAN c | SEARCH i USING INDEX idx_icd10_head (head>? AND head<?)'
  );

  INDEX_DDL.idx_icd10_title_id = ddl(
    'CREATE INDEX idx_icd10_title_id ON icd10(title_id);',
    '--   WHY: a BINARY index over the Indonesian term. It is deliberately the WRONG',
    '--   index for LIKE and the Plans tab proves it: LIKE is case-insensitive by',
    '--   default, so the prefix optimisation can only use a NOCASE index.'
  );

  INDEX_DDL.idx_icd10_title_nc = ddl(
    'CREATE INDEX idx_icd10_title_nc ON icd10(title_id COLLATE NOCASE);',
    "--   WHY: the index LIKE 'demam%' can actually use. VERIFIED — the two indexes",
    '--   swap places under PRAGMA case_sensitive_like=ON, with no change to schema',
    '--   or query.'
  );

  INDEX_DDL.ux_staff_sip = ddl(
    'CREATE UNIQUE INDEX ux_staff_sip ON staff(sip) WHERE sip IS NOT NULL;',
    '--   WHY PARTIAL: a plain UNIQUE column accepts unlimited NULLs (VERIFIED), so',
    '--   `sip TEXT UNIQUE` would be indistinguishable from this until somebody read',
    '--   it as "sip is required and unique". The partial index says exactly what is',
    '--   true: licence numbers are unique among the staff that have one.'
  );

  INDEX_DDL.idx_patient_dup = ddl(
    'CREATE INDEX idx_patient_dup ON patient(name_norm, dob, sex);',
    '--   WHY AN INDEX AND NOT A UNIQUE CONSTRAINT: (normalised name, dob, sex) is a',
    '--   soft near-key. Two people can share a name and a birthday, and refusing',
    '--   them outright is worse than flagging them. So: an index for the duplicate',
    '--   search, deliberately not a constraint, and the difference is the point.'
  );

  INDEX_DDL.idx_chronic_code = ddl(
    'CREATE INDEX idx_chronic_code ON patient_chronic(icd_code);',
    '--   WHY: "which patients carry this chronic code" is the direction the',
    '--   population rules read. The PK serves only the other direction.'
  );

  INDEX_DDL.ux_visit_active = ddl(
    'CREATE UNIQUE INDEX ux_visit_active',
    '  ON visit(rm_number, visit_date, poli_id)',
    "  WHERE status NOT IN ('selesai','batal');",
    '--   WHY PARTIAL: one ACTIVE visit per patient per day per poli. A plain UNIQUE',
    '--   would forbid a legitimate second visit after the first closed. This is the',
    '--   duplicate scan in openVisit(), written once, in the schema.'
  );

  INDEX_DDL.idx_visit_rm = ddl(
    'CREATE INDEX idx_visit_rm ON visit(rm_number, visit_date DESC, poli_id, status);',
    '--   WHY: the patient timeline, the most-run query in a record room. Widened',
    '--   past the two predicate columns so the list renders from the index alone.',
    '--   The DESC is load-bearing: without it the plan gains',
    '--   "USE TEMP B-TREE FOR ORDER BY".'
  );

  INDEX_DDL.idx_visit_board = ddl(
    'CREATE INDEX idx_visit_board ON visit(visit_date, poli_id, status, queue_seq);',
    '--   WHY IT WAS WRITTEN: the queue board is always "today, this poli", ordered',
    '--   by queue number, and visit_date leads because it is always an equality.',
    '--   AND THE PLANNER NEVER USES IT FOR THAT QUERY. VERIFIED: the queue-board',
    '--   select plans as',
    '--     SEARCH visit USING INDEX sqlite_autoindex_visit_2 (visit_date=? AND poli_id=?)',
    '--   with this index present AND with it dropped — UNIQUE(visit_date, poli_id,',
    '--   queue_seq), declared for a completely different reason, already built a',
    '--   narrower index with the same leading columns and the required order. The',
    '--   index is redundant for its stated purpose and nothing in the schema said',
    '--   so; it is kept, and it is one of the four labelled failure cases on the',
    '--   Plans tab. What it does get chosen for is the live-board count(*):',
    '--     SCAN visit USING COVERING INDEX idx_visit_board'
  );

  INDEX_DDL.idx_visit_open = ddl(
    'CREATE INDEX idx_visit_open ON visit(visit_date, poli_id)',
    "  WHERE status NOT IN ('selesai','batal');",
    '--   WHY PARTIAL: the live board. VERIFIED, and it is also the lab\'s sharpest',
    '--   failure case: writing the predicate as',
    "--     status <> 'selesai' AND status <> 'batal'",
    '--   selects identical rows and the index is SKIPPED (plan: SCAN visit), because',
    "--   SQLite matches a partial index's WHERE clause syntactically, not",
    '--   semantically.'
  );

  INDEX_DDL.idx_visit_doctor = ddl(
    'CREATE INDEX idx_visit_doctor ON visit(doctor_id, visit_date)',
    '  WHERE doctor_id IS NOT NULL;',
    '--   WHY PARTIAL: a large minority of visits have no doctor assigned, and NULL',
    '--   is never the answer to "which visits are mine".'
  );

  INDEX_DDL.idx_visit_rm_nc = ddl(
    'CREATE INDEX idx_visit_rm_nc ON visit(rm_number COLLATE NOCASE);',
    "--   WHY: rm_number LIKE 'RM-0043%' cannot use idx_visit_rm. VERIFIED:",
    '--     with only the BINARY index   -> SCAN visit USING COVERING INDEX idx_visit_rm',
    '--     with the NOCASE index        -> SEARCH visit USING COVERING INDEX',
    '--                                     idx_visit_rm_nc (rm_number>? AND rm_number<?)',
    '--     PRAGMA case_sensitive_like=ON -> the two swap places.',
    "--     GLOB 'RM-0043*'              -> always uses the BINARY index.",
    '--',
    '-- DELIBERATELY ABSENT, and the Plans tab says so with a plan:',
    '--   there is no index on visit(klass) in the shipped schema. The Plans tab',
    '--   creates one on demand to show the planner choosing it and the query getting',
    '--   SLOWER than the same query with NOT INDEXED.'
  );

  INDEX_DDL.ux_enc_primary = ddl(
    'CREATE UNIQUE INDEX ux_enc_primary',
    '  ON encounter_diagnosis(encounter_id) WHERE is_primary = 1;',
    '--   EXACTLY ONE PRIMARY DIAGNOSIS PER ENCOUNTER, as one line of schema.',
    '--   The IndexedDB version enforces it in signEncounter() and NOT in',
    '--   addAddendum(), so a correcting addendum on path \'a\' can install an',
    '--   assessment with zero primaries, two primaries or unknown codes, and',
    '--   effectiveEncounter() serves it as the operative diagnosis. Written here it',
    '--   applies to every writer, addenda included, because addenda write through',
    '--   this table.',
    "--   VERIFIED refusals, with SQLite's exact message",
    '--   `UNIQUE constraint failed: encounter_diagnosis.encounter_id`:',
    '--     a second INSERT with is_primary = 1, and an UPDATE promoting a second row.'
  );

  INDEX_DDL.idx_dx_code = ddl(
    'CREATE INDEX idx_dx_code ON encounter_diagnosis(icd_code, encounter_id);',
    '--   WHY: the reporting direction — "every encounter carrying J45.9" for a claim',
    '--   batch. The PK serves encounter -> codes; nothing served the reverse, which',
    '--   is the direction money moves in.'
  );

  INDEX_DDL.idx_addendum_enc = ddl(
    'CREATE INDEX idx_addendum_enc ON addendum(encounter_id, seq);',
    "--   WHY: the effective-record replay walks one encounter's addenda in seq",
    '--   order. Composite, so the replay is a range scan already in order — the plan',
    '--   has no "USE TEMP B-TREE FOR ORDER BY".',
    '--   WHAT DROPPING IT DOES NOT SHOW, because this was written down wrong once',
    '--   and measured afterwards: dropping the index does NOT produce the temp',
    '--   b-tree. VERIFIED, plan afterwards:',
    '--     SCAN addendum USING INDEX sqlite_autoindex_addendum_2',
    '--   UNIQUE(seq) built another index that happens to supply the same order. Only',
    '--   NOT INDEXED, which forbids every index, shows what the sort would cost:',
    '--     SCAN addendum | USE TEMP B-TREE FOR ORDER BY'
  );

  INDEX_DDL.idx_bill_line_payer = ddl(
    'CREATE INDEX idx_bill_line_payer ON bill_line(payer, visit_id);',
    '--   WHY: the capitation reconciliation groups by payer across every closed',
    '--   bill. The PK serves only bill -> lines.'
  );

  INDEX_DDL.idx_audit_ent_patient = ddl(
    'CREATE INDEX idx_audit_ent_patient   ON audit_entry(ent_patient)   WHERE ent_patient   IS NOT NULL;'
  );
  INDEX_DDL.idx_audit_ent_visit = ddl(
    'CREATE INDEX idx_audit_ent_visit     ON audit_entry(ent_visit)     WHERE ent_visit     IS NOT NULL;'
  );
  INDEX_DDL.idx_audit_ent_encounter = ddl(
    'CREATE INDEX idx_audit_ent_encounter ON audit_entry(ent_encounter) WHERE ent_encounter IS NOT NULL;',
    '--   WHY THREE PARTIALS AND NOT THREE FULL INDEXES: two of these columns are',
    '--   NULL on any given row. Three full indexes would store an entry per row in',
    '--   each; the three partials together hold exactly one entry per row. The Plans',
    '--   tab shows the entry counts side by side.'
  );

  // Two indexes that are NOT in the end-state schema. They exist because a real
  // ladder inherits indexes as well as tables, and because each of them is the
  // reason a later migration has an extra step: an index that mentions a column
  // the rebuild removes must be dropped BEFORE the rebuild, or step 9 of the
  // twelve — "put the indexes back" — fails on a column that no longer exists.
  var LEGACY_INDEX_DDL = {
    idx_pt_allergies: ddl(
      'CREATE INDEX idx_pt_allergies ON patient(allergies_csv);',
      '--   LEGACY. A 2024 attempt to make the allergy filter fast, over a column',
      '--   holding \'penisilin,nsaid\'. It is the reason v4 must DROP INDEX before it',
      '--   can touch the column at all.'
    ),
    idx_audit_entity: ddl(
      'CREATE INDEX idx_audit_entity ON audit_entry(entity, entity_id);',
      '--   LEGACY. The polymorphic pair, indexed together because that was the only',
      '--   way to reach "everything about this visit". v9 replaces it with three',
      '--   partial indexes on three typed columns, and must drop it first.'
    )
  };

  /* ------------------------------------------------------------ triggers */

  var TRIGGER_DDL = {};

  TRIGGER_DDL.trg_audit_no_update = ddl(
    'CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_entry',
    "BEGIN SELECT RAISE(ABORT, 'audit_entry is append-only: UPDATE refused'); END;"
  );

  TRIGGER_DDL.trg_audit_no_delete = ddl(
    'CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_entry',
    "BEGIN SELECT RAISE(ABORT, 'audit_entry is append-only: DELETE refused'); END;"
  );

  TRIGGER_DDL.trg_audit_chain = ddl(
    'CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_entry',
    'WHEN NEW.seq > 0 AND NOT EXISTS (',
    '  SELECT 1 FROM audit_entry p WHERE p.seq = NEW.seq - 1 AND p.hash = NEW.prev_hash)',
    'BEGIN',
    '  SELECT RAISE(ABORT,',
    "    'audit_entry: seq must be prev.seq+1 and prev_hash must be prev.hash');",
    'END;',
    '-- A foreign key cannot express "no UPDATE" and cannot express "seq is',
    '-- contiguous". These three triggers are what make the table append-only rather',
    '-- than append-mostly. Note the consequence v9 walks straight into: once they',
    '-- exist, no later migration can backfill a column on this table without',
    '-- dropping them first — and a rebuild removes them without saying so.'
  );

  /* --------------------------------------------- the end state, in order */

  // The Schema tab renders this. The engine runs the same strings out of
  // TABLE_DDL / INDEX_DDL / TRIGGER_DDL by name; nothing here is a second copy.
  var FINAL_DDL = [
    { kind: 'banner', name: 'header', sql: ddl(
      '-- ============================================================================',
      '-- ROMBAK — the schema at PRAGMA user_version = 9.',
      '-- Every statement here was executed against SQLite 3.49.1 (sql.js 1.14.2).',
      '-- ============================================================================') },
    { kind: 'pragma', name: 'foreign_keys', sql:
      'PRAGMA foreign_keys = ON;   -- 0 by default in sql.js. Set OUTSIDE every transaction.' },
    { kind: 'banner', name: 'reference', sql: '-- ------------------------------------------------------------------ reference' },
    { kind: 'table', name: 'role' },
    { kind: 'table', name: 'poli' },
    { kind: 'table', name: 'queue_state' },
    { kind: 'table', name: 'queue_transition' },
    { kind: 'table', name: 'queue_transition_role' },
    { kind: 'table', name: 'acuity' },
    { kind: 'table', name: 'tindakan' },
    { kind: 'table', name: 'kecelakaan' },
    { kind: 'table', name: 'allergy_class' },
    { kind: 'table', name: 'addendable_path' },
    { kind: 'table', name: 'addendable_path_role' },
    { kind: 'table', name: 'icd10_chapter' },
    { kind: 'table', name: 'icd10' },
    { kind: 'index', name: 'idx_icd10_head' },
    { kind: 'index', name: 'idx_icd10_title_id' },
    { kind: 'index', name: 'idx_icd10_title_nc' },
    { kind: 'table', name: 'staff' },
    { kind: 'index', name: 'ux_staff_sip' },
    { kind: 'banner', name: 'counters', sql: '-- ------------------------------------------------------------------- counters' },
    { kind: 'table', name: 'rm_counter' },
    { kind: 'table', name: 'queue_counter' },
    { kind: 'banner', name: 'people', sql: '-- -------------------------------------------------------------------- people' },
    { kind: 'table', name: 'patient' },
    { kind: 'index', name: 'idx_patient_dup' },
    { kind: 'table', name: 'patient_allergy' },
    { kind: 'table', name: 'patient_chronic' },
    { kind: 'index', name: 'idx_chronic_code' },
    { kind: 'banner', name: 'visits', sql: '-- -------------------------------------------------------------------- visits' },
    { kind: 'table', name: 'visit' },
    { kind: 'index', name: 'ux_visit_active' },
    { kind: 'index', name: 'idx_visit_rm' },
    { kind: 'index', name: 'idx_visit_board' },
    { kind: 'index', name: 'idx_visit_open' },
    { kind: 'index', name: 'idx_visit_doctor' },
    { kind: 'index', name: 'idx_visit_rm_nc' },
    { kind: 'table', name: 'visit_tindakan' },
    { kind: 'table', name: 'visit_status_history' },
    { kind: 'table', name: 'triage' },
    { kind: 'banner', name: 'encounters', sql: '-- ---------------------------------------------------------------- encounters' },
    { kind: 'table', name: 'encounter' },
    { kind: 'table', name: 'encounter_vitals' },
    { kind: 'table', name: 'encounter_diagnosis' },
    { kind: 'index', name: 'ux_enc_primary' },
    { kind: 'index', name: 'idx_dx_code' },
    { kind: 'table', name: 'addendum' },
    { kind: 'index', name: 'idx_addendum_enc' },
    { kind: 'banner', name: 'money', sql: '-- --------------------------------------------------------------------- money' },
    { kind: 'table', name: 'bill' },
    { kind: 'table', name: 'bill_line' },
    { kind: 'index', name: 'idx_bill_line_payer' },
    { kind: 'banner', name: 'audit', sql: '-- --------------------------------------------------------------------- audit' },
    { kind: 'table', name: 'audit_action' },
    { kind: 'table', name: 'audit_entry' },
    { kind: 'index', name: 'idx_audit_ent_patient' },
    { kind: 'index', name: 'idx_audit_ent_visit' },
    { kind: 'index', name: 'idx_audit_ent_encounter' },
    { kind: 'trigger', name: 'trg_audit_no_update' },
    { kind: 'trigger', name: 'trg_audit_no_delete' },
    { kind: 'trigger', name: 'trg_audit_chain' },
    { kind: 'table', name: 'audit_commitment' },
    { kind: 'banner', name: 'runner', sql: '-- --------------------------------------------------- the runner\'s own book' },
    { kind: 'table', name: 'schema_migration' }
  ];

  // Resolve each entry to its text once, at load. A `sql` already present on a
  // banner or pragma entry wins; everything else comes out of the three maps by
  // name, which is what makes "the same array" true rather than aspirational.
  for (i = 0; i < FINAL_DDL.length; i++) {
    if (FINAL_DDL[i].sql) continue;
    if (FINAL_DDL[i].kind === 'table') FINAL_DDL[i].sql = TABLE_DDL[FINAL_DDL[i].name];
    else if (FINAL_DDL[i].kind === 'index') FINAL_DDL[i].sql = INDEX_DDL[FINAL_DDL[i].name];
    else if (FINAL_DDL[i].kind === 'trigger') FINAL_DDL[i].sql = TRIGGER_DDL[FINAL_DDL[i].name];
    if (!FINAL_DDL[i].sql) throw new Error('schema.js: FINAL_DDL names a missing object: ' + FINAL_DDL[i].name);
  }

  function finalDdlText() {
    var out = [], j;
    for (j = 0; j < FINAL_DDL.length; j++) out.push(FINAL_DDL[j].sql);
    return out.join('\n\n');
  }

  /* ==================================================================== */
  /* reference rows                                                        */
  /* ==================================================================== */

  // The ICD-10 subset is the same 218 rubrics and 21 chapters as labs/rekam/icd10.js,
  // carried across deliberately: the two labs describe the same clinic, and a
  // reader who checks one against the other should find the same codes. Chapter
  // labels stay Indonesian because that is the vocabulary a coder here works in,
  // and title_id exists for exactly the same reason.
  // [roman, label, code_lo, code_hi] — 21 chapters, boundaries by code range.
  var ICD10_CHAPTER_ROWS = [
    ['I', "Penyakit Infeksi & Parasit", 'A00', 'B99'],
    ['II', "Neoplasma", 'C00', 'D48'],
    ['III', "Darah & Sistem Imun", 'D50', 'D89'],
    ['IV', "Endokrin, Nutrisi & Metabolik", 'E00', 'E90'],
    ['V', "Gangguan Jiwa & Perilaku", 'F00', 'F99'],
    ['VI', "Sistem Saraf", 'G00', 'G99'],
    ['VII', "Mata & Adneksa", 'H00', 'H59'],
    ['VIII', "Telinga & Prosesus Mastoid", 'H60', 'H95'],
    ['IX', "Sistem Sirkulasi", 'I00', 'I99'],
    ['X', "Sistem Pernapasan", 'J00', 'J99'],
    ['XI', "Sistem Pencernaan", 'K00', 'K93'],
    ['XII', "Kulit & Jaringan Subkutan", 'L00', 'L99'],
    ['XIII', "Muskuloskeletal & Jaringan Ikat", 'M00', 'M99'],
    ['XIV', "Sistem Genitourinaria", 'N00', 'N99'],
    ['XV', "Kehamilan, Persalinan & Nifas", 'O00', 'O99'],
    ['XVI', "Kondisi Perinatal", 'P00', 'P96'],
    ['XVII', "Malformasi Kongenital", 'Q00', 'Q99'],
    ['XVIII', "Gejala & Temuan Klinis", 'R00', 'R99'],
    ['XIX', "Cedera, Keracunan & Akibat Sebab Luar Tertentu", 'S00', 'T98'],
    ['XX', "Sebab Luar Morbiditas & Mortalitas", 'V01', 'Y98'],
    ['XXI', "Faktor Status Kesehatan", 'Z00', 'Z99']
  ];

  // [code, title_en, title_id, terms, is_common] — 218 rubrics.
  var ICD10_ROWS = [
    ["A01.0", "Typhoid fever", "Demam tifoid", "tifus typhus salmonella", 0],
    ["A06.0", "Acute amoebic dysentery", "Disentri amuba akut", "amubiasis entamoeba", 0],
    ["A08.4", "Viral intestinal infection, unspecified", "Infeksi usus virus", "gastroenteritis viral rotavirus", 0],
    ["A09", "Other gastroenteritis and colitis of infectious and unspecified origin", "Gastroenteritis & kolitis lain, infeksi maupun tidak spesifik", "mencret berak cair gastroenteritis diare", 1],
    ["A09.0", "Other and unspecified gastroenteritis and colitis of infectious origin", "Gastroenteritis & kolitis infeksi", "diare infeksi mencret berak cair", 0],
    ["A09.9", "Gastroenteritis and colitis of unspecified origin", "Gastroenteritis & kolitis penyebab tidak spesifik", "diare tidak spesifik mencret", 1],
    ["A15.0", "Tuberculosis of lung, confirmed by microscopy", "TB paru BTA positif", "tuberkulosis tbc paru bta", 0],
    ["A16.2", "Tuberculosis of lung, without bacteriological confirmation", "TB paru klinis (BTA negatif)", "tuberkulosis tbc paru", 0],
    ["A16.9", "Respiratory tuberculosis unspecified", "TB pernapasan tidak spesifik", "tuberkulosis tbc", 0],
    ["A46", "Erysipelas", "Erisipelas", "infeksi kulit streptokokus", 0],
    ["A49.0", "Staphylococcal infection, unspecified site", "Infeksi stafilokokus", "staph", 0],
    ["A75.9", "Typhus fever, unspecified", "Tifus bercak (rickettsia)", "rickettsia", 0],
    ["A90", "Dengue fever (classical dengue)", "Demam dengue", "db dengue demam berdarah nyamuk aedes", 0],
    ["A91", "Dengue haemorrhagic fever", "Demam berdarah dengue (DBD)", "dbd dengue berdarah trombositopenia", 1],
    ["B01.9", "Varicella without complication", "Cacar air tanpa komplikasi", "varisela chickenpox", 0],
    ["B02.9", "Zoster without complication", "Herpes zoster", "cacar ular dompo shingles", 0],
    ["B05.9", "Measles without complication", "Campak tanpa komplikasi", "morbili measles", 0],
    ["B15.9", "Hepatitis A without hepatic coma", "Hepatitis A", "hepatitis kuning liver", 0],
    ["B18.1", "Chronic viral hepatitis B without delta agent", "Hepatitis B kronik", "hepatitis b hbsag", 0],
    ["B18.2", "Chronic viral hepatitis C", "Hepatitis C kronik", "hepatitis c", 0],
    ["B24", "Unspecified human immunodeficiency virus disease", "Penyakit HIV", "hiv aids", 0],
    ["B35.3", "Tinea pedis", "Kutu air (tinea pedis)", "jamur kaki kurap", 0],
    ["B35.4", "Tinea corporis", "Kurap badan (tinea corporis)", "jamur kulit kadas", 1],
    ["B35.6", "Tinea cruris", "Tinea cruris (jamur selangkangan)", "jamur lipat paha", 0],
    ["B36.0", "Pityriasis versicolor", "Panu (pitiriasis versikolor)", "panu jamur", 0],
    ["B37.0", "Candidal stomatitis", "Kandidiasis mulut (oral thrush)", "sariawan jamur mulut", 0],
    ["B37.3", "Candidiasis of vulva and vagina", "Kandidiasis vulvovaginal", "keputihan jamur", 0],
    ["B54", "Unspecified malaria", "Malaria tanpa spesifikasi", "malaria plasmodium", 0],
    ["B77.9", "Ascariasis, unspecified", "Askariasis (cacing gelang)", "cacingan cacing", 0],
    ["B82.9", "Intestinal parasitism, unspecified", "Parasit usus", "cacingan", 0],
    ["B86", "Scabies", "Skabies (gudik)", "kudis gatal malam tungau", 1],
    ["D50.9", "Iron deficiency anaemia, unspecified", "Anemia defisiensi besi", "anemia kurang darah fe", 1],
    ["D64.9", "Anaemia, unspecified", "Anemia tanpa spesifikasi", "anemia kurang darah hb rendah", 0],
    ["D69.6", "Thrombocytopenia, unspecified", "Trombositopenia", "trombosit rendah", 0],
    ["E03.9", "Hypothyroidism, unspecified", "Hipotiroid", "tiroid tsh", 0],
    ["E05.9", "Thyrotoxicosis, unspecified", "Hipertiroid / tirotoksikosis", "tiroid gondok graves", 0],
    ["E10.9", "Type 1 diabetes mellitus without complications", "Diabetes melitus tipe 1", "dm kencing manis gula", 0],
    ["E11.9", "Type 2 diabetes mellitus without complications", "Diabetes melitus tipe 2", "dm2 kencing manis gula darah", 1],
    ["E11.6", "Type 2 diabetes mellitus with other specified complications", "DM tipe 2 dengan komplikasi lain", "dm komplikasi", 0],
    ["E14.9", "Unspecified diabetes mellitus without complications", "Diabetes melitus tidak spesifik", "dm kencing manis", 0],
    ["E44.0", "Moderate protein-energy malnutrition", "Gizi kurang sedang", "malnutrisi kurang gizi", 0],
    ["E46", "Unspecified protein-energy malnutrition", "Gizi buruk / kurang", "malnutrisi stunting kurang gizi", 0],
    ["E63.9", "Nutritional deficiency, unspecified", "Defisiensi nutrisi", "kurang gizi vitamin", 0],
    ["E66.9", "Obesity, unspecified", "Obesitas", "gemuk kegemukan berat badan", 0],
    ["E78.0", "Pure hypercholesterolaemia", "Hiperkolesterolemia", "kolesterol tinggi ldl", 0],
    ["E78.5", "Hyperlipidaemia, unspecified", "Dislipidemia", "kolesterol trigliserida lemak darah", 1],
    ["E86", "Volume depletion", "Dehidrasi / deplesi volume", "dehidrasi kurang cairan", 0],
    ["E87.6", "Hypokalaemia", "Hipokalemia", "kalium rendah", 0],
    ["F20.9", "Schizophrenia, unspecified", "Skizofrenia", "jiwa psikotik halusinasi", 0],
    ["F31.9", "Bipolar affective disorder, unspecified", "Gangguan bipolar", "bipolar manik", 0],
    ["F32.9", "Depressive episode, unspecified", "Episode depresi", "depresi sedih murung", 0],
    ["F41.1", "Generalized anxiety disorder", "Gangguan cemas menyeluruh", "cemas ansietas khawatir", 0],
    ["F41.9", "Anxiety disorder, unspecified", "Gangguan cemas", "cemas panik ansietas", 0],
    ["F43.2", "Adjustment disorders", "Gangguan penyesuaian", "stres adaptasi", 0],
    ["F45.3", "Somatoform autonomic dysfunction", "Disfungsi otonom somatoform", "psikosomatis", 0],
    ["F51.0", "Nonorganic insomnia", "Insomnia non-organik", "susah tidur insomnia", 0],
    ["G40.9", "Epilepsy, unspecified", "Epilepsi", "ayan kejang bangkitan", 0],
    ["G43.9", "Migraine, unspecified", "Migren", "migrain sakit kepala sebelah", 0],
    ["G44.2", "Tension-type headache", "Nyeri kepala tipe tegang", "sakit kepala tegang tension", 1],
    ["G51.0", "Bell's palsy", "Bell’s palsy", "wajah perot lumpuh saraf vii", 0],
    ["G56.0", "Carpal tunnel syndrome", "Sindrom terowongan karpal", "cts kesemutan tangan", 0],
    ["G62.9", "Polyneuropathy, unspecified", "Polineuropati", "kesemutan neuropati", 0],
    ["G93.3", "Postviral fatigue syndrome", "Sindrom lelah pasca-viral", "lelah kronik", 0],
    ["H10.1", "Acute atopic conjunctivitis", "Konjungtivitis alergi akut", "mata merah alergi gatal", 0],
    ["H10.9", "Conjunctivitis, unspecified", "Konjungtivitis", "mata merah belekan", 1],
    ["H16.0", "Corneal ulcer", "Ulkus kornea", "luka kornea mata", 0],
    ["H25.9", "Senile cataract, unspecified", "Katarak senilis", "katarak mata buram", 0],
    ["H40.9", "Glaucoma, unspecified", "Glaukoma", "tekanan bola mata", 0],
    ["H52.1", "Myopia", "Miopia (rabun jauh)", "minus rabun jauh kacamata", 0],
    ["H52.2", "Astigmatism", "Astigmatisme", "silinder mata", 0],
    ["H52.4", "Presbyopia", "Presbiopia", "rabun tua kacamata baca", 0],
    ["H57.1", "Ocular pain", "Nyeri mata", "mata sakit", 0],
    ["H60.9", "Otitis externa, unspecified", "Otitis eksterna", "congek telinga luar nyeri", 0],
    ["H61.2", "Impacted cerumen", "Serumen obturans", "kotoran telinga sumbat", 1],
    ["H65.9", "Nonsuppurative otitis media, unspecified", "Otitis media non-supuratif", "telinga cairan", 0],
    ["H66.9", "Otitis media, unspecified", "Otitis media", "congek telinga bernanah", 0],
    ["H81.1", "Benign paroxysmal vertigo", "Vertigo posisi paroksismal jinak", "bppv vertigo pusing berputar", 0],
    ["H81.3", "Other peripheral vertigo", "Vertigo perifer lain", "vertigo pusing berputar", 0],
    ["H91.9", "Hearing loss, unspecified", "Gangguan pendengaran", "tuli budek", 0],
    ["I10", "Essential (primary) hypertension", "Hipertensi esensial (primer)", "darah tinggi ht tensi tinggi", 1],
    ["I11.9", "Hypertensive heart disease without heart failure", "Penyakit jantung hipertensif", "jantung hipertensi", 0],
    ["I15.9", "Secondary hypertension, unspecified", "Hipertensi sekunder", "darah tinggi sekunder", 0],
    ["I20.9", "Angina pectoris, unspecified", "Angina pektoris", "nyeri dada jantung", 0],
    ["I21.9", "Acute myocardial infarction, unspecified", "Infark miokard akut", "serangan jantung ima stemi", 0],
    ["I25.1", "Atherosclerotic heart disease", "Penyakit jantung aterosklerotik", "jantung koroner pjk", 0],
    ["I48", "Atrial fibrillation and flutter", "Fibrilasi atrium", "af aritmia jantung berdebar", 0],
    ["I50.9", "Heart failure, unspecified", "Gagal jantung", "gagal jantung sesak bengkak", 0],
    ["I63.9", "Cerebral infarction, unspecified", "Infark serebral (stroke iskemik)", "stroke sumbatan", 0],
    ["I64", "Stroke, not specified as haemorrhage or infarction", "Stroke tidak spesifik", "stroke lumpuh", 0],
    ["I83.9", "Varicose veins of lower extremities", "Varises tungkai", "varises kaki", 0],
    ["I88.9", "Nonspecific lymphadenitis, unspecified", "Limfadenitis non-spesifik", "kelenjar getah bening bengkak", 0],
    ["J00", "Acute nasopharyngitis (common cold)", "Nasofaringitis akut (selesma)", "pilek flu common cold", 1],
    ["J01.9", "Acute sinusitis, unspecified", "Sinusitis akut", "sinusitis hidung tersumbat", 0],
    ["J02.9", "Acute pharyngitis, unspecified", "Faringitis akut", "radang tenggorokan sakit menelan", 1],
    ["J03.9", "Acute tonsillitis, unspecified", "Tonsilitis akut", "amandel radang", 0],
    ["J04.0", "Acute laryngitis", "Laringitis akut", "serak suara hilang", 0],
    ["J06.9", "Acute upper respiratory infection, unspecified", "ISPA (infeksi saluran napas atas)", "ispa batuk pilek flu common cold", 1],
    ["J11.1", "Influenza with other respiratory manifestations, virus not identified", "Influenza", "flu influenza demam", 0],
    ["J18.9", "Pneumonia, unspecified", "Pneumonia", "radang paru paru-paru basah", 0],
    ["J20.9", "Acute bronchitis, unspecified", "Bronkitis akut", "bronkitis batuk berdahak", 0],
    ["J30.4", "Allergic rhinitis, unspecified", "Rinitis alergi", "alergi bersin hidung meler", 1],
    ["J31.0", "Chronic rhinitis", "Rinitis kronik", "hidung tersumbat kronik", 0],
    ["J35.0", "Chronic tonsillitis", "Tonsilitis kronik", "amandel kronis", 0],
    ["J42", "Unspecified chronic bronchitis", "Bronkitis kronik", "batuk kronik perokok", 0],
    ["J44.9", "Chronic obstructive pulmonary disease, unspecified", "PPOK", "ppok copd sesak perokok", 0],
    ["J45.0", "Predominantly allergic asthma", "Asma alergik", "asma bengek alergi", 0],
    ["J45.9", "Asthma, unspecified", "Asma", "asma bengek sesak mengi", 1],
    ["J46", "Status asthmaticus", "Status asmatikus", "asma berat serangan", 0],
    ["K02.1", "Caries of dentine", "Karies dentin", "gigi berlubang karies", 0],
    ["K02.9", "Dental caries, unspecified", "Karies gigi", "gigi berlubang gigis", 1],
    ["K04.0", "Pulpitis", "Pulpitis", "gigi nyeri saraf gigi", 1],
    ["K04.1", "Necrosis of pulp", "Nekrosis pulpa", "gigi mati", 0],
    ["K04.7", "Periapical abscess without sinus", "Abses periapikal", "gusi bengkak nanah gigi", 0],
    ["K05.0", "Acute gingivitis", "Gingivitis akut", "gusi bengkak berdarah", 0],
    ["K05.3", "Chronic periodontitis", "Periodontitis kronik", "gusi turun gigi goyang", 0],
    ["K08.1", "Loss of teeth due to accident, extraction or local periodontal disease", "Kehilangan gigi", "gigi tanggal ompong", 0],
    ["K12.0", "Recurrent oral aphthae", "Stomatitis aftosa rekuren", "sariawan", 0],
    ["K21.9", "Gastro-oesophageal reflux disease without oesophagitis", "GERD tanpa esofagitis", "asam lambung naik gerd heartburn", 1],
    ["K29.7", "Gastritis, unspecified", "Gastritis", "maag lambung perih", 1],
    ["K30", "Dyspepsia", "Dispepsia", "maag kembung begah dispepsia fungsional", 1],
    ["K35.8", "Acute appendicitis, other and unspecified", "Apendisitis akut", "usus buntu radang", 0],
    ["K40.9", "Unilateral inguinal hernia, without obstruction or gangrene", "Hernia inguinalis unilateral", "hernia turun berok", 0],
    ["K52.9", "Noninfective gastroenteritis and colitis, unspecified", "Gastroenteritis non-infeksi", "diare non infeksi", 0],
    ["K58.9", "Irritable bowel syndrome without diarrhoea", "Sindrom usus iritabel", "ibs kolon iritabel", 0],
    ["K59.0", "Constipation", "Konstipasi", "sembelit susah bab", 0],
    ["K64.9", "Haemorrhoids, unspecified", "Hemoroid", "wasir ambeien", 0],
    ["K76.0", "Fatty (change of) liver, not elsewhere classified", "Perlemakan hati", "fatty liver", 0],
    ["K80.2", "Calculus of gallbladder without cholecystitis", "Batu kandung empedu", "batu empedu", 0],
    ["L01.0", "Impetigo", "Impetigo", "koreng kulit bernanah anak", 0],
    ["L02.9", "Cutaneous abscess, furuncle and carbuncle, unspecified", "Abses kulit / furunkel", "bisul abses", 0],
    ["L03.9", "Cellulitis, unspecified", "Selulitis", "infeksi kulit bengkak merah", 0],
    ["L20.9", "Atopic dermatitis, unspecified", "Dermatitis atopik", "eksim alergi kulit", 0],
    ["L21.9", "Seborrhoeic dermatitis, unspecified", "Dermatitis seboroik", "ketombe kulit berminyak", 0],
    ["L23.9", "Allergic contact dermatitis, unspecified cause", "Dermatitis kontak alergi", "alergi kulit gatal", 1],
    ["L25.9", "Unspecified contact dermatitis, unspecified cause", "Dermatitis kontak", "gatal kena bahan", 0],
    ["L29.9", "Pruritus, unspecified", "Pruritus", "gatal gatal", 0],
    ["L30.9", "Dermatitis, unspecified", "Dermatitis", "eksim gatal kulit", 1],
    ["L40.9", "Psoriasis, unspecified", "Psoriasis", "psoriasis bersisik", 0],
    ["L50.9", "Urticaria, unspecified", "Urtikaria", "biduran kaligata bentol", 0],
    ["L70.0", "Acne vulgaris", "Akne vulgaris", "jerawat", 0],
    ["L84", "Corns and callosities", "Kalus & klavus", "mata ikan kapalan", 0],
    ["M06.9", "Rheumatoid arthritis, unspecified", "Artritis reumatoid", "rematik sendi bengkak", 0],
    ["M10.9", "Gout, unspecified", "Gout (artritis pirai)", "asam urat gout", 1],
    ["M13.9", "Arthritis, unspecified", "Artritis", "radang sendi", 0],
    ["M17.9", "Gonarthrosis, unspecified", "Osteoartritis lutut", "oa lutut pengapuran", 0],
    ["M19.9", "Arthrosis, unspecified", "Osteoartritis", "oa pengapuran sendi", 0],
    ["M25.5", "Pain in joint", "Nyeri sendi", "sendi sakit artralgia", 1],
    ["M47.9", "Spondylosis, unspecified", "Spondilosis", "pengapuran tulang belakang", 0],
    ["M51.1", "Lumbar and other intervertebral disc disorders with radiculopathy", "HNP lumbal dengan radikulopati", "saraf kejepit hnp", 0],
    ["M54.2", "Cervicalgia", "Servikalgia", "nyeri leher tengkuk", 0],
    ["M54.4", "Lumbago with sciatica", "Lumbago dengan iskialgia", "nyeri pinggang menjalar skiatika", 0],
    ["M54.5", "Low back pain", "Nyeri punggung bawah", "lbp sakit pinggang", 1],
    ["M62.6", "Muscle strain", "Strain otot", "otot tertarik keseleo", 0],
    ["M65.9", "Synovitis and tenosynovitis, unspecified", "Sinovitis / tenosinovitis", "radang tendon", 0],
    ["M75.0", "Adhesive capsulitis of shoulder", "Kapsulitis adhesiva bahu", "frozen shoulder bahu kaku", 0],
    ["M77.1", "Lateral epicondylitis", "Epikondilitis lateral", "tennis elbow siku", 0],
    ["M79.1", "Myalgia", "Mialgia", "nyeri otot pegal", 1],
    ["M81.9", "Osteoporosis, unspecified", "Osteoporosis", "tulang keropos", 0],
    ["N18.9", "Chronic kidney disease, unspecified", "Penyakit ginjal kronik", "gagal ginjal ckd", 0],
    ["N20.0", "Calculus of kidney", "Batu ginjal", "batu ginjal kolik", 0],
    ["N23", "Unspecified renal colic", "Kolik renal", "kolik ginjal nyeri pinggang", 0],
    ["N30.0", "Acute cystitis", "Sistitis akut", "infeksi kandung kemih anyang-anyangan", 0],
    ["N39.0", "Urinary tract infection, site not specified", "Infeksi saluran kemih (ISK)", "isk anyang-anyangan nyeri kencing", 1],
    ["N40", "Hyperplasia of prostate", "Hiperplasia prostat (BPH)", "bph prostat susah kencing", 0],
    ["N76.0", "Acute vaginitis", "Vaginitis akut", "keputihan gatal vagina", 0],
    ["N91.2", "Amenorrhoea, unspecified", "Amenore", "tidak haid", 0],
    ["N92.0", "Excessive and frequent menstruation with regular cycle", "Menoragia siklus teratur", "haid banyak", 0],
    ["N94.6", "Dysmenorrhoea, unspecified", "Dismenore", "nyeri haid kram haid", 0],
    ["N95.1", "Menopausal and female climacteric states", "Sindrom menopause", "menopause hot flush", 0],
    ["O14.9", "Pre-eclampsia, unspecified", "Preeklamsia", "preeklampsia hamil tensi tinggi", 0],
    ["O21.0", "Mild hyperemesis gravidarum", "Hiperemesis gravidarum ringan", "mual muntah hamil", 0],
    ["O24.4", "Diabetes mellitus arising in pregnancy", "Diabetes gestasional", "dm hamil gestasional", 0],
    ["O26.8", "Other specified pregnancy-related conditions", "Kondisi terkait kehamilan lain", "keluhan hamil", 0],
    ["O47.9", "False labour, unspecified", "Kontraksi palsu", "kontraksi palsu braxton", 0],
    ["O99.0", "Anaemia complicating pregnancy, childbirth and the puerperium", "Anemia dalam kehamilan", "anemia hamil", 0],
    ["P07.3", "Other preterm infants", "Bayi prematur lain", "prematur bblr", 0],
    ["P59.9", "Neonatal jaundice, unspecified", "Ikterus neonatorum", "bayi kuning", 0],
    ["R03.0", "Elevated blood-pressure reading, without diagnosis of hypertension", "Tekanan darah tinggi pada pengukuran, tanpa diagnosis hipertensi", "td tinggi sekali ukur belum hipertensi", 0],
    ["R05", "Cough", "Batuk", "batuk", 1],
    ["R07.4", "Chest pain, unspecified", "Nyeri dada", "nyeri dada", 0],
    ["R10.1", "Pain localized to upper abdomen", "Nyeri perut atas", "nyeri ulu hati epigastrium", 0],
    ["R10.4", "Other and unspecified abdominal pain", "Nyeri perut", "sakit perut mules", 0],
    ["R11", "Nausea and vomiting", "Mual & muntah", "mual muntah", 0],
    ["R42", "Dizziness and giddiness", "Pusing / melayang", "pusing kliyengan", 0],
    ["R50.9", "Fever, unspecified", "Demam tanpa spesifikasi", "demam panas", 1],
    ["R51", "Headache", "Nyeri kepala", "sakit kepala pusing", 1],
    ["R53", "Malaise and fatigue", "Malaise & kelelahan", "lemas lelah", 0],
    ["R55", "Syncope and collapse", "Sinkop", "pingsan", 0],
    ["R60.0", "Localized oedema", "Edema lokal", "bengkak kaki", 0],
    ["R73.9", "Hyperglycaemia, unspecified", "Hiperglikemia", "gula darah tinggi", 0],
    ["S00.0", "Superficial injury of scalp", "Cedera superfisial kulit kepala", "luka lecet kepala", 0],
    ["S01.0", "Open wound of scalp", "Luka terbuka kulit kepala", "luka robek kepala", 0],
    ["S13.4", "Sprain and strain of cervical spine", "Sprain servikal", "keseleo leher whiplash", 0],
    ["S52.5", "Fracture of lower end of radius", "Fraktur radius distal", "patah tulang pergelangan tangan", 0],
    ["S61.9", "Open wound of wrist and hand, part unspecified", "Luka terbuka tangan", "luka robek tangan", 0],
    ["S81.0", "Open wound of knee", "Luka terbuka lutut", "luka lutut jatuh", 0],
    ["S93.4", "Sprain and strain of ankle", "Sprain pergelangan kaki", "keseleo kaki terkilir", 0],
    ["T14.1", "Open wound of unspecified body region", "Luka terbuka", "luka robek vulnus", 0],
    ["T63.4", "Toxic effect of venom of other arthropods", "Sengatan/gigitan artropoda", "digigit serangga sengat", 0],
    ["T78.2", "Anaphylactic shock, unspecified", "Syok anafilaktik", "anafilaksis syok alergi", 0],
    ["T78.4", "Allergy, unspecified", "Alergi tanpa spesifikasi", "alergi", 0],
    ["V89.2", "Person injured in unspecified motor-vehicle accident, traffic", "Cedera kecelakaan lalu lintas bermotor", "kecelakaan lalu lintas tabrakan motor mobil laka", 0],
    ["W01", "Fall on same level from slipping, tripping and stumbling", "Terjatuh di permukaan datar (terpeleset/tersandung)", "jatuh terpeleset tersandung", 0],
    ["W19", "Unspecified fall", "Terjatuh tanpa spesifikasi", "jatuh", 0],
    ["W54", "Bitten or struck by dog", "Digigit / diserang anjing", "gigitan anjing rabies", 0],
    ["W57", "Bitten or stung by nonvenomous insect and other nonvenomous arthropods", "Gigitan / sengatan serangga tak berbisa", "digigit serangga semut nyamuk", 0],
    ["X50", "Overexertion and strenuous or repetitive movements", "Kelelahan otot akibat gerakan berlebih atau berulang", "terlalu berat angkat beban gerakan berulang", 0],
    ["Z00.0", "General medical examination", "Pemeriksaan kesehatan umum", "medical check up mcu", 0],
    ["Z00.1", "Routine child health examination", "Pemeriksaan kesehatan anak rutin", "imunisasi tumbuh kembang posyandu", 0],
    ["Z01.7", "Laboratory examination", "Pemeriksaan laboratorium", "lab cek darah", 0],
    ["Z23", "Need for immunization against single bacterial diseases", "Imunisasi bakteri tunggal", "imunisasi vaksin", 0],
    ["Z25.1", "Need for immunization against influenza", "Imunisasi influenza", "vaksin flu", 0],
    ["Z30.4", "Surveillance of contraceptive drugs", "Pemantauan kontrasepsi hormonal", "kb pil suntik", 0],
    ["Z34.0", "Supervision of normal first pregnancy", "Pengawasan kehamilan normal pertama", "anc hamil pertama kia", 0],
    ["Z34.9", "Supervision of normal pregnancy, unspecified", "Pengawasan kehamilan normal", "anc kontrol hamil kia", 1],
    ["Z39.1", "Care and examination of lactating mother", "Perawatan ibu menyusui", "menyusui asi nifas", 0],
    ["Z71.3", "Dietary counselling and surveillance", "Konseling gizi", "konsultasi diet gizi", 0],
    ["Z76.0", "Issue of repeat prescription", "Penerbitan resep ulang", "resep ulang obat rutin", 0]
  ];

  // Nine states, twelve edges. The two off-path states carry NULL display_ord
  // because they are not positions in the queue, they are ways of leaving it.
  var REFERENCE_ROWS = {
    role: {
      columns: ['id', 'label'],
      rows: [
        ['dokter', 'Dokter'],
        ['perawat', 'Perawat'],
        ['pendaftaran', 'Pendaftaran'],
        ['apoteker', 'Apoteker']
      ]
    },
    poli: {
      columns: ['id', 'label', 'prefix', 'konsul_rp'],
      rows: [
        ['umum', 'Poli Umum', 'A', 40000],
        ['gigi', 'Poli Gigi', 'B', 65000],
        ['kia', 'Poli KIA', 'C', 40000]
      ]
    },
    queue_state: {
      columns: ['id', 'label', 'display_ord', 'is_terminal'],
      rows: [
        ['menunggu-triase', 'Waiting for triase', 1, 0],
        ['menunggu-dokter', 'Waiting for the doctor', 2, 0],
        ['konsultasi', 'In consultation', 3, 0],
        ['menunggu-tindakan', 'Waiting for a tindakan', 4, 0],
        ['tindakan', 'Tindakan in progress', 5, 0],
        ['menunggu-kasir', 'Waiting at the cashier', 6, 0],
        ['selesai', 'Closed', 7, 1],
        ['batal', 'Cancelled', null, 1],
        ['rujuk-keluar', 'Referred out', null, 1]
      ]
    },
    queue_transition: {
      columns: ['from_state', 'to_state', 'guard_id'],
      rows: [
        ['menunggu-triase', 'menunggu-dokter', 'triage-recorded'],
        ['menunggu-triase', 'batal', null],
        ['menunggu-dokter', 'konsultasi', 'doctor-assigned'],
        ['menunggu-dokter', 'batal', null],
        ['konsultasi', 'menunggu-tindakan', 'tindakan-ordered'],
        ['konsultasi', 'menunggu-kasir', 'note-signed'],
        ['konsultasi', 'rujuk-keluar', 'note-signed'],
        ['konsultasi', 'batal', null],
        ['menunggu-tindakan', 'tindakan', null],
        ['menunggu-tindakan', 'batal', null],
        ['tindakan', 'menunggu-kasir', 'note-signed'],
        ['menunggu-kasir', 'selesai', 'bill-closed']
      ]
    },
    queue_transition_role: {
      columns: ['from_state', 'to_state', 'role_id'],
      rows: [
        ['menunggu-triase', 'menunggu-dokter', 'perawat'],
        ['menunggu-triase', 'batal', 'pendaftaran'],
        ['menunggu-dokter', 'konsultasi', 'dokter'],
        ['menunggu-dokter', 'konsultasi', 'perawat'],
        ['menunggu-dokter', 'batal', 'pendaftaran'],
        ['konsultasi', 'menunggu-tindakan', 'dokter'],
        ['konsultasi', 'menunggu-kasir', 'dokter'],
        ['konsultasi', 'rujuk-keluar', 'dokter'],
        ['konsultasi', 'batal', 'dokter'],
        ['menunggu-tindakan', 'tindakan', 'perawat'],
        ['menunggu-tindakan', 'batal', 'pendaftaran'],
        ['tindakan', 'menunggu-kasir', 'dokter'],
        ['tindakan', 'menunggu-kasir', 'perawat'],
        ['menunggu-kasir', 'selesai', 'pendaftaran']
      ]
    },
    acuity: {
      columns: ['id', 'label', 'rank'],
      rows: [
        ['merah', 'Merah (immediate)', 1],
        ['kuning', 'Kuning (urgent)', 2],
        ['hijau', 'Hijau (non-urgent)', 3]
      ]
    },
    tindakan: {
      columns: ['id', 'label', 'price_rp', 'bpjs_covered'],
      rows: [
        ['tnd-01', 'Jahit luka (< 5 cm)', 85000, 1],
        ['tnd-02', 'Perawatan luka', 45000, 1],
        ['tnd-03', 'Nebulisasi', 75000, 1],
        ['tnd-04', 'Injeksi intramuskular', 25000, 1],
        ['tnd-05', 'Pemasangan infus', 90000, 1],
        ['tnd-06', 'EKG', 120000, 1],
        ['tnd-07', 'Gula darah sewaktu', 30000, 1],
        ['tnd-08', 'Tambal gigi (GIC)', 150000, 1],
        ['tnd-09', 'Ekstraksi gigi sulung', 95000, 1],
        ['tnd-10', 'Ekstraksi gigi permanen', 175000, 1],
        ['tnd-11', 'Skaling gigi', 250000, 0],
        ['tnd-12', 'Imunisasi dasar', 35000, 1],
        ['tnd-13', 'Pemeriksaan ANC', 55000, 1],
        ['tnd-14', 'Pap smear', 220000, 0]
      ]
    },
    kecelakaan: {
      columns: ['id', 'label', 'payer'],
      rows: [
        ['lalu-lintas', 'Kecelakaan lalu lintas', 'jasa-raharja'],
        ['kerja', 'Kecelakaan kerja', 'bpjs-ketenagakerjaan'],
        ['lain', 'Kecelakaan lain', null]
      ]
    },
    allergy_class: {
      columns: ['id', 'label'],
      rows: [
        ['penisilin', 'Penisilin dan turunannya'],
        ['sulfa', 'Sulfonamida'],
        ['nsaid', 'NSAID / OAINS'],
        ['opioid', 'Opioid'],
        ['makanan-laut', 'Makanan laut'],
        ['debu-tungau', 'Debu dan tungau'],
        ['lateks', 'Lateks']
      ]
    },
    addendable_path: {
      columns: ['path', 'label', 'kind'],
      rows: [
        ['s', 'Subjective', 'text'],
        ['o.exam', 'Objective — examination', 'text'],
        ['o.vitals', 'Objective — vitals', 'vitals'],
        ['a', 'Assessment (coded)', 'assessment'],
        ['p.plan', 'Plan', 'text'],
        ['p.edukasi', 'Plan — education', 'text']
      ]
    },
    addendable_path_role: {
      columns: ['path', 'role_id'],
      rows: [
        ['s', 'dokter'],
        ['o.exam', 'dokter'],
        ['o.vitals', 'dokter'],
        ['o.vitals', 'perawat'],
        ['a', 'dokter'],
        ['p.plan', 'dokter'],
        ['p.edukasi', 'dokter']
      ]
    },
    icd10_chapter: { columns: ['roman', 'label', 'code_lo', 'code_hi'], rows: ICD10_CHAPTER_ROWS },
    icd10: { columns: ['code', 'title_en', 'title_id', 'terms', 'is_common'], rows: ICD10_ROWS },
    staff: {
      columns: ['id', 'name', 'role_id', 'title', 'sip', 'poli_id'],
      rows: [
        ['stf-01', 'dr. Rina Halim', 'dokter', 'Dokter Umum', 'SIP-FIKTIF-0001', 'umum'],
        ['stf-02', 'drg. Yusuf Anwar', 'dokter', 'Dokter Gigi', 'SIP-FIKTIF-0002', 'gigi'],
        ['stf-03', 'dr. Sari Wibowo', 'dokter', 'Dokter Umum (KIA)', 'SIP-FIKTIF-0003', 'kia'],
        ['stf-04', 'Ani Kusuma', 'perawat', 'Perawat', null, null],
        ['stf-05', 'Budi Santoso', 'pendaftaran', 'Petugas Pendaftaran', null, null],
        ['stf-06', 'Dewi Lestari', 'apoteker', 'Apoteker', 'SIPA-FIKTIF-0006', null]
      ]
    },
    audit_action: {
      columns: ['id'],
      rows: [
        ['patient.create'], ['patient.update'], ['patient.allergy.add'], ['patient.allergy.remove'],
        ['visit.open'], ['visit.status'], ['visit.assign-doctor'], ['visit.cancel'],
        ['triage.record'], ['triage.amend'],
        ['encounter.start'], ['encounter.update'], ['encounter.sign'], ['encounter.addendum'],
        ['diagnosis.add'], ['diagnosis.remove'],
        ['bill.close'], ['bill.reopen']
      ]
    }
  };

  /* ==================================================================== */
  /* v1 — the statement list                                               */
  /* ==================================================================== */

  var V1_DDL = [];
  var REF_ORDER = ['role', 'poli', 'queue_state', 'queue_transition', 'queue_transition_role',
    'acuity', 'tindakan', 'kecelakaan', 'allergy_class', 'addendable_path', 'addendable_path_role',
    'icd10_chapter', 'icd10', 'staff', 'audit_action', 'rm_counter', 'queue_counter'];
  var LEGACY_ORDER = ['patient', 'visit', 'encounter', 'encounter_diagnosis', 'addendum',
    'bill', 'bill_line', 'audit_entry'];

  for (i = 0; i < REF_ORDER.length; i++) {
    V1_DDL.push({ label: 'reference: ' + REF_ORDER[i], sql: REF_DDL[REF_ORDER[i]] });
  }
  V1_DDL.push({ label: "runner's own book: schema_migration", sql: SCHEMA_MIGRATION_DDL });
  for (i = 0; i < LEGACY_ORDER.length; i++) {
    V1_DDL.push({ label: 'legacy: ' + LEGACY_ORDER[i], sql: LEGACY_DDL[LEGACY_ORDER[i]] });
  }

  /* ==================================================================== */
  /* the twelve steps, and the naive script that skips four of them        */
  /* ==================================================================== */

  // {t} is the table being rebuilt; {new} is its scratch name. runner.js does
  // the substitution and times each step separately, because "the rebuild took
  // 41 ms" tells you nothing and "step 5 took 38 of the 41" tells you where the
  // rows are.
  var TWELVE_STEPS = [
    { n: 1, label: 'PRAGMA foreign_keys = OFF', sql: 'PRAGMA foreign_keys = OFF',
      why: 'OUTSIDE the transaction. Inside one it returns OK and does nothing, and the pragma still reads 1.' },
    { n: 2, label: 'BEGIN', sql: 'BEGIN',
      why: 'Everything from here to COMMIT is one unit. A rebuild that is half-applied is worse than one that never ran.' },
    { n: 3, label: 'capture indexes, triggers and views',
      sql: "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = '{t}' AND type IN ('index','trigger','view') AND sql IS NOT NULL",
      why: 'A rebuild silently loses every index and trigger on the table. This is the step that makes step 9 possible. sql IS NOT NULL drops the auto-indexes, which have no DDL and come back on their own.' },
    { n: 4, label: 'create the new table', sql: null,
      why: 'The final definition, out of TABLE_DDL, with the scratch name substituted for the real one.' },
    { n: 5, label: 'copy the rows', sql: null,
      why: 'Named columns on both sides. SELECT * would bind by position and a column added at v2 would land in the wrong place.' },
    { n: 6, label: 'drop the old table', sql: 'DROP TABLE "{t}"',
      why: 'The children survive only because foreign keys are off. With them on, a CASCADE child is emptied here and nothing is raised.' },
    { n: 7, label: 'rename', sql: 'ALTER TABLE "{new}" RENAME TO "{t}"',
      why: 'SQLite rewrites references to the renamed table in every other stored DDL, which is why the scratch name must not be a name anything already references.' },
    { n: 8, label: 'recreate the indexes captured at step 3', sql: null,
      why: 'Including the unique ones. An index that mentions a column the rebuild dropped must have been dropped before step 4, or this step fails on a column that no longer exists.' },
    { n: 9, label: 'recreate the triggers and views captured at step 3', sql: null,
      why: 'It runs and reports zero for most tables. It is still a step, because the one table where it matters is the audit table, and a rebuild that forgets it removes an append-only guarantee without raising anything.' },
    { n: 10, label: 'PRAGMA foreign_key_check', sql: 'PRAGMA foreign_key_check',
      why: 'INSIDE the transaction, before COMMIT. Foreign keys were off for the whole rebuild, so this is the only thing that will tell you the copy introduced an orphan — and it still works with the pragma off.' },
    { n: 11, label: 'COMMIT', sql: 'COMMIT', why: 'Only reached if step 10 was empty.' },
    { n: 12, label: 'PRAGMA foreign_keys = ON', sql: 'PRAGMA foreign_keys = ON',
      why: 'Outside the transaction again. A runner that forgets this leaves the whole session unprotected and every later constraint test passes for the wrong reason.' }
  ];

  // The script a hurried author writes. Four steps of the twelve are missing:
  // 1 (the pragma), 3 and 8/9 (capture and restore), and 10 (the check before
  // COMMIT). The panel runs it against four different database states.
  var NAIVE_SCRIPT = [
    { label: 'BEGIN', sql: 'BEGIN' },
    { label: 'create the new table', sql: null, from: 'rebuildDdl' },
    { label: 'copy the rows', sql: null, from: 'rebuildCopy' },
    { label: 'drop the old table', sql: 'DROP TABLE "{t}"', mayFail: true },
    { label: 'rename', sql: 'ALTER TABLE "{new}" RENAME TO "{t}"', mayFail: true },
    { label: 'PRAGMA foreign_key_check', sql: 'PRAGMA foreign_key_check' },
    { label: 'COMMIT', sql: 'COMMIT' }
  ];

  // The Rebuild tab runs NAIVE_SCRIPT against these three tables, and they are
  // three different lessons rather than three examples of one.
  //
  //   encounter    the v7 centrepiece: two children with opposite delete
  //                actions, so the same script either raises or destroys
  //                depending on a state the script cannot see.
  //   visit        the index lesson. VERIFIED in this build: a naive rebuild of
  //                visit loses all six named indexes and keeps its 2,569 rows,
  //                and sqlite_master afterwards holds only the four
  //                sqlite_autoindex_* entries the new DDL's own UNIQUE clauses
  //                recreate. `encounter` cannot teach this: it carries no named
  //                index and no trigger at all, only the autoindex behind
  //                UNIQUE(visit_id).
  //   audit_entry  the §0.2 lesson. The naive rebuild of the ARMED table
  //                commits, every row survives, and all three append-only
  //                triggers are gone. The UPDATE that was refused a second
  //                earlier is now accepted. Neither the triggers nor the
  //                DEFERRABLE self-foreign-key stopped anything.
  //
  // audit_entry needs its own copy statement because the naive rebuild happens
  // AFTER v9, when the table already has the three typed entity columns; the
  // migration's own copy reads entity_id and would fail with `no such column`.
  // Which is itself worth watching: the failed INSERT does not abort the
  // transaction, the DROP goes ahead anyway, and COMMIT returns OK over an empty
  // audit table. The panel shows that variant too.
  var NAIVE_REBUILDS = {
    encounter: { loses: 'nothing visible — encounter has no named index or trigger. What it loses is rows, in one of its two children.' },
    visit: { loses: 'all six named indexes: idx_visit_board, idx_visit_doctor, idx_visit_open, idx_visit_rm, idx_visit_rm_nc, ux_visit_active.' },
    audit_entry: {
      loses: 'all three append-only triggers and all three partial indexes.',
      copy: 'INSERT INTO "audit_entry_new" (seq, at, actor_id, actor_name, actor_role, action,' +
            ' summary, detail, entity, ent_patient, ent_visit, ent_encounter, prev_hash, hash)' +
            ' SELECT seq, at, actor_id, actor_name, actor_role, action, summary, detail, entity,' +
            ' ent_patient, ent_visit, ent_encounter, prev_hash, hash FROM "audit_entry" ORDER BY seq'
    }
  };

  // The two answers everybody reaches for, both of which return OK and do
  // nothing. Data, not prose, so the panel can fire them and print what the
  // pragma reads afterwards.
  var WRONG_FIXES = [
    { id: 'pragma-inside',
      label: 'PRAGMA foreign_keys = OFF, inside the transaction',
      statements: ['BEGIN', 'PRAGMA foreign_keys = OFF'],
      readBack: 'PRAGMA foreign_keys',
      expect: 1,
      why: 'It returns OK. The pragma still reads 1. A migration runner that opens its transaction first is unprotected and will never know.' },
    { id: 'defer-fk',
      label: 'PRAGMA defer_foreign_keys = ON, inside the transaction',
      statements: ['BEGIN', 'PRAGMA defer_foreign_keys = ON'],
      readBack: 'PRAGMA foreign_keys',
      expect: 1,
      why: 'CASCADE is an action, not a deferred check, and deferring checks does not stop actions.' }
  ];

  /* ==================================================================== */
  /* the ALTER TABLE capability boundary                                   */
  /* ==================================================================== */

  // Run live against a table WITH ROWS and against an empty one, because three
  // of these six give opposite answers in the two states. A capability matrix
  // run against a scratch CREATE TABLE zz(...) passes green while asserting the
  // opposite of the truth.
  var ALTER_MATRIX = [
    { id: 'notnull', sql: 'ALTER TABLE %T% ADD COLUMN c TEXT NOT NULL',
      empty: 'ok', populated: 'error' },
    { id: 'nonconst-default', sql: "ALTER TABLE %T% ADD COLUMN c TEXT DEFAULT (datetime('now'))",
      empty: 'ok', populated: 'error' },
    { id: 'stored', sql: 'ALTER TABLE %T% ADD COLUMN c TEXT GENERATED ALWAYS AS (a) STORED',
      empty: 'ok', populated: 'error' },
    { id: 'unique', sql: 'ALTER TABLE %T% ADD COLUMN c TEXT UNIQUE',
      empty: 'error', populated: 'error' },
    { id: 'primary-key', sql: 'ALTER TABLE %T% ADD COLUMN c TEXT PRIMARY KEY',
      empty: 'error', populated: 'error' },
    { id: 'virtual', sql: 'ALTER TABLE %T% ADD COLUMN c TEXT GENERATED ALWAYS AS (a) VIRTUAL',
      empty: 'ok', populated: 'ok' }
  ];

  // The four things v7 needs and ALTER TABLE cannot do. All four are bare
  // syntax errors, which is the strongest possible form of "this needs a
  // rebuild": there is no flag, no pragma and no version to wait for.
  var REBUILD_REFUSALS = [
    { want: 'visit_id becomes NOT NULL',
      sql: 'ALTER TABLE encounter ALTER COLUMN visit_id TEXT NOT NULL' },
    { want: 'a CHECK on status',
      sql: "ALTER TABLE encounter ADD CONSTRAINT ck CHECK (status IN ('draft','signed'))" },
    { want: 'the composite foreign key',
      sql: 'ALTER TABLE encounter ADD CONSTRAINT fk FOREIGN KEY (visit_id, rm_number) REFERENCES visit(id, rm_number)' },
    { want: 'drop a constraint',
      sql: 'ALTER TABLE encounter DROP CONSTRAINT ck' }
  ];

  /* ==================================================================== */
  /* the nine rungs                                                        */
  /* ==================================================================== */

  // A statement entry is one of:
  //   { label, sql }                  plain SQL
  //   { label, sql, guard }           skipped when guard's first cell is truthy
  //   { label, js, preview }          a named operation runner.js implements
  //   { label, rebuild: 'table' }     expands into TWELVE_STEPS for that table
  // `demos` run OUTSIDE the transaction, before it, and their errors are the
  // point rather than a failure. `fk` is the value PRAGMA foreign_keys is set
  // to before BEGIN — and the reason is on every rung, because getting it wrong
  // is the whole subject of this lab.

  function guardColumn(table, column) {
    return "SELECT count(*) FROM pragma_table_info('" + table + "') WHERE name = '" + column + "'";
  }
  function guardTable(name) {
    return "SELECT count(*) FROM pragma_table_list WHERE name = '" + name + "'";
  }
  function guardIndex(name) {
    return "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = '" + name + "'";
  }

  var MIGRATIONS = [
    /* ---------------------------------------------------------------- v1 */
    {
      version: 1,
      name: 'baseline',
      why: 'The schema a hurried developer actually ships: sixteen reference tables born correct, and eight legacy tables with no foreign keys, no STRICT, comma-joined lists and money in REAL.',
      needsRebuild: false,
      fk: 'on',
      fkWhy: 'Nothing exists yet, so nothing can cascade. The pragma is on because it is on for the rest of the session.',
      guard: guardTable('patient'),
      demos: [],
      statements: V1_DDL,
      rebuilds: {},
      declares: (function () {
        var d = {}, j;
        for (j = 0; j < REF_ORDER.length; j++) d[REF_ORDER[j]] = 'new';
        d.schema_migration = 'new';
        for (j = 0; j < LEGACY_ORDER.length; j++) d[LEGACY_ORDER[j]] = 'new';
        return d;
      })(),
      verify: [
        { label: 'twenty-six tables exist', sql: "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'" },
        { label: 'patient is not STRICT and has no foreign keys', sql: "SELECT (SELECT count(*) FROM pragma_foreign_key_list('patient')), (SELECT sql LIKE '%STRICT%' FROM sqlite_master WHERE name='patient')" },
        { label: 'bill money is REAL', sql: "SELECT name, type FROM pragma_table_info('bill') WHERE type = 'REAL'" }
      ],
      mayRefuse: 'Nothing. v1 is the floor; it runs against an empty file.',
      down: { refused: 'v1 is the floor. There is nothing under it to go back to, and Rewind rebuilds from its exported bytes instead.' }
    },

    /* ---------------------------------------------------------------- v2 */
    {
      version: 2,
      name: 'additive',
      why: 'Three guarded ALTER TABLE ADD COLUMNs against tables that already have rows, and the six-way capability matrix that says which ADD COLUMNs are possible at all.',
      needsRebuild: false,
      fk: 'on',
      fkWhy: 'ADD COLUMN touches no other table, so there is nothing to protect from a cascade.',
      guard: guardColumn('patient', 'pregnant'),
      demos: [],
      statements: [
        { label: 'patient.pregnant', guard: guardColumn('patient', 'pregnant'),
          sql: 'ALTER TABLE patient ADD COLUMN pregnant INTEGER NOT NULL DEFAULT 0' },
        { label: 'visit.kecelakaan_id', guard: guardColumn('visit', 'kecelakaan_id'),
          sql: 'ALTER TABLE visit ADD COLUMN kecelakaan_id TEXT' },
        { label: 'visit.doctor_role (VIRTUAL, so zero stored bytes and no backfill)',
          guard: guardColumn('visit', 'doctor_role'),
          sql: 'ALTER TABLE visit ADD COLUMN doctor_role TEXT GENERATED ALWAYS AS ' +
               "(CASE WHEN doctor_id IS NULL THEN NULL ELSE 'dokter' END) VIRTUAL" }
      ],
      rebuilds: {},
      declares: { patient: 'bytes', visit: 'bytes' },
      verify: [
        { label: 'pregnant exists and defaulted to 0 on every existing row', sql: 'SELECT count(*) FROM patient WHERE pregnant <> 0' },
        { label: 'doctor_role is hidden=2, i.e. virtual generated', sql: "SELECT name, hidden FROM pragma_table_xinfo('visit') WHERE name = 'doctor_role'" }
      ],
      mayRefuse: 'Nothing in the ladder. The capability matrix beside it refuses five of its own six statements, on purpose.',
      down: {
        statements: [
          { label: 'drop patient.pregnant', sql: 'ALTER TABLE patient DROP COLUMN pregnant' },
          { label: 'drop visit.doctor_role', sql: 'ALTER TABLE visit DROP COLUMN doctor_role' },
          { label: 'drop visit.kecelakaan_id', sql: 'ALTER TABLE visit DROP COLUMN kecelakaan_id' }
        ],
        why: 'The one genuinely reversible rung in the ladder, and it is here so the page can show a working down beside a refused one.'
      }
    },

    /* ---------------------------------------------------------------- v3 */
    {
      version: 3,
      name: 'indexes',
      why: 'Fifteen indexes, one of which is a mistake this ladder then has to live with: an index over the comma-joined allergy column, which is why v4 cannot touch that column without dropping the index first.',
      needsRebuild: false,
      fk: 'on',
      fkWhy: 'CREATE INDEX reads rows and writes a b-tree. It cannot delete anything, from any table.',
      guard: guardIndex('idx_visit_board'),
      demos: [
        { label: 'making a column unique needs no rebuild, adding a table constraint always does',
          sql: 'ALTER TABLE staff ADD COLUMN sip2 TEXT UNIQUE', expect: 'error',
          why: 'Cannot add a UNIQUE column. The partial unique INDEX below does the same job and is accepted.' }
      ],
      statements: [
        { label: 'idx_icd10_head', guard: guardIndex('idx_icd10_head'), sql: INDEX_DDL.idx_icd10_head },
        { label: 'idx_icd10_title_id', guard: guardIndex('idx_icd10_title_id'), sql: INDEX_DDL.idx_icd10_title_id },
        { label: 'idx_icd10_title_nc', guard: guardIndex('idx_icd10_title_nc'), sql: INDEX_DDL.idx_icd10_title_nc },
        { label: 'ux_staff_sip', guard: guardIndex('ux_staff_sip'), sql: INDEX_DDL.ux_staff_sip },
        { label: 'idx_patient_dup', guard: guardIndex('idx_patient_dup'), sql: INDEX_DDL.idx_patient_dup },
        { label: 'idx_pt_allergies (the mistake)', guard: guardIndex('idx_pt_allergies'), sql: LEGACY_INDEX_DDL.idx_pt_allergies },
        { label: 'idx_visit_rm', guard: guardIndex('idx_visit_rm'), sql: INDEX_DDL.idx_visit_rm },
        { label: 'idx_visit_board', guard: guardIndex('idx_visit_board'), sql: INDEX_DDL.idx_visit_board },
        { label: 'idx_visit_open', guard: guardIndex('idx_visit_open'), sql: INDEX_DDL.idx_visit_open },
        { label: 'idx_visit_doctor', guard: guardIndex('idx_visit_doctor'), sql: INDEX_DDL.idx_visit_doctor },
        { label: 'idx_visit_rm_nc', guard: guardIndex('idx_visit_rm_nc'), sql: INDEX_DDL.idx_visit_rm_nc },
        { label: 'idx_dx_code', guard: guardIndex('idx_dx_code'), sql: INDEX_DDL.idx_dx_code },
        { label: 'idx_addendum_enc', guard: guardIndex('idx_addendum_enc'), sql: INDEX_DDL.idx_addendum_enc },
        { label: 'idx_bill_line_payer', guard: guardIndex('idx_bill_line_payer'), sql: INDEX_DDL.idx_bill_line_payer },
        { label: 'idx_audit_entity (legacy, over the polymorphic pair)', guard: guardIndex('idx_audit_entity'), sql: LEGACY_INDEX_DDL.idx_audit_entity }
      ],
      rebuilds: {},
      declares: {},
      verify: [
        { label: 'fifteen named indexes exist', sql: "SELECT count(*) FROM sqlite_master WHERE type='index' AND sql IS NOT NULL" },
        { label: 'ux_staff_sip is partial', sql: "SELECT partial FROM pragma_index_list('staff') WHERE name = 'ux_staff_sip'" },
        { label: 'page_count and freelist_count, which is how an index is sized here', sql: 'SELECT (SELECT * FROM pragma_page_count) AS pages, (SELECT * FROM pragma_freelist_count) AS free' }
      ],
      mayRefuse: 'Nothing. An index over dirty data is still a valid index — which is exactly why an index is not a constraint.',
      down: {
        statements: [
          { label: 'drop idx_audit_entity', sql: 'DROP INDEX idx_audit_entity' },
          { label: 'drop idx_bill_line_payer', sql: 'DROP INDEX idx_bill_line_payer' },
          { label: 'drop idx_addendum_enc', sql: 'DROP INDEX idx_addendum_enc' },
          { label: 'drop idx_dx_code', sql: 'DROP INDEX idx_dx_code' },
          { label: 'drop idx_visit_rm_nc', sql: 'DROP INDEX idx_visit_rm_nc' },
          { label: 'drop idx_visit_doctor', sql: 'DROP INDEX idx_visit_doctor' },
          { label: 'drop idx_visit_open', sql: 'DROP INDEX idx_visit_open' },
          { label: 'drop idx_visit_board', sql: 'DROP INDEX idx_visit_board' },
          { label: 'drop idx_visit_rm', sql: 'DROP INDEX idx_visit_rm' },
          { label: 'drop idx_pt_allergies', sql: 'DROP INDEX idx_pt_allergies' },
          { label: 'drop idx_patient_dup', sql: 'DROP INDEX idx_patient_dup' },
          { label: 'drop ux_staff_sip', sql: 'DROP INDEX ux_staff_sip' },
          { label: 'drop idx_icd10_title_nc', sql: 'DROP INDEX idx_icd10_title_nc' },
          { label: 'drop idx_icd10_title_id', sql: 'DROP INDEX idx_icd10_title_id' },
          { label: 'drop idx_icd10_head', sql: 'DROP INDEX idx_icd10_head' }
        ],
        why: 'Reversible, and the page shows page_count refusing to shrink afterwards while freelist_count grows instead.'
      }
    },

    /* ---------------------------------------------------------------- v4 */
    {
      version: 4,
      name: 'normalise-allergies',
      why: 'Split two comma-joined columns into two properly constrained child tables, then rebuild patient into its STRICT form. It stops on the first allergy token that resolves to nothing.',
      needsRebuild: true,
      fk: 'on',
      fkWhy: 'Nothing references patient yet, so DROP TABLE patient cannot cascade anywhere — and foreign keys must stay ON, because the whole point of this rung is that the backfill INSERT is refused by one.',
      guard: guardTable('patient_allergy'),
      demos: [
        { label: 'DROP COLUMN, while an index still mentions the column',
          sql: 'ALTER TABLE patient DROP COLUMN allergies_csv', expect: 'error',
          why: 'People who read that 3.35 made DROP COLUMN unconditional are surprised by this one. The index has to go first.' }
      ],
      statements: [
        { label: 'drop the legacy index that mentions the column being removed',
          sql: 'DROP INDEX IF EXISTS idx_pt_allergies' },
        { label: 'carry the two columns about to be dropped into a staging table',
          sql: 'CREATE TABLE _patient_csv AS SELECT rm_number, allergies_csv, chronic_csv FROM patient' },
        { label: 'rebuild patient', rebuild: 'patient' },
        { label: 'patient_allergy', guard: guardTable('patient_allergy'), sql: TABLE_DDL.patient_allergy },
        { label: 'patient_chronic', guard: guardTable('patient_chronic'), sql: TABLE_DDL.patient_chronic },
        { label: 'idx_chronic_code', guard: guardIndex('idx_chronic_code'), sql: INDEX_DDL.idx_chronic_code },
        { label: 'split allergies_csv, one INSERT per token', js: 'backfillAllergyCsv',
          preview: "for each 'penisilin,nsaid': INSERT INTO patient_allergy(rm_number, class_id) VALUES (?, ?)" },
        { label: 'split chronic_csv, one INSERT per token', js: 'backfillChronicCsv',
          preview: "for each 'I10,I48': INSERT INTO patient_chronic(rm_number, icd_code) VALUES (?, ?)" },
        { label: 'drop the staging table', sql: 'DROP TABLE _patient_csv' }
      ],
      rebuilds: {
        patient: {
          ddl: TABLE_DDL.patient,
          copy: 'INSERT INTO "patient_new" (rm_number, rm_seq, name, name_norm, sex, dob, nik_demo,' +
                ' bpjs_demo, phone, address, klass, pregnant, created_at, is_demo)' +
                " SELECT rm_number, CAST(substr(rm_number, 4) AS INTEGER), name, name_norm, sex, dob," +
                ' nik_demo, bpjs_demo, phone, address, klass, pregnant, created_at, is_demo FROM "patient"'
        }
      },
      declares: { patient: 'bytes', patient_allergy: 'new', patient_chronic: 'new' },
      verify: [
        { label: 'patient is STRICT', sql: "SELECT sql LIKE '%) STRICT%' FROM sqlite_master WHERE name='patient' AND type='table'" },
        { label: 'the two CSV columns are gone', sql: "SELECT count(*) FROM pragma_table_info('patient') WHERE name IN ('allergies_csv','chronic_csv')" },
        // NOT `WHERE rm_number <> 'RM-' || substr(...)`. That is the table's own
        // CHECK restated, so it can only return 0 and it verifies nothing about
        // the data — it verifies that the constraint exists, which sqlite_master
        // already said. Density is a different property: UNIQUE makes rm_seq
        // distinct and nothing makes it run 1..count(*).
        { label: 'the derived rm_seq is dense from 1, which no constraint guarantees',
          sql: 'SELECT count(*) AS rows, count(DISTINCT rm_seq) AS distinct_seq,' +
               ' min(rm_seq) AS lo, max(rm_seq) AS hi FROM patient' },
        { label: 'every allergy row resolves to a class', sql: 'PRAGMA foreign_key_check' }
      ],
      // Captured BEFORE the rung runs and compared afterwards, through a route
      // the rung did not use. §10.3's third trap: a backfill verified by
      // re-running the backfill's own expression is not verified.
      verifyAgainstBefore: [
        { label: 'the patient row count is untouched by a rebuild that changed every row',
          beforeSql: 'SELECT count(*) FROM patient',
          afterSql: 'SELECT count(*) FROM patient' },
        { label: 'every CSV token became exactly one child row',
          beforeSql: "SELECT sum(length(allergies_csv) - length(replace(allergies_csv, ',', '')) + 1)" +
                     " FROM patient WHERE allergies_csv <> ''",
          afterSql: 'SELECT count(*) FROM patient_allergy' }
      ],
      refusal: {
        finder: "SELECT rm_number, allergies_csv FROM patient WHERE allergies_csv LIKE '%penicillin%'",
        fixes: [{ label: 'respell the three tokens',
          sql: "UPDATE patient SET allergies_csv = replace(allergies_csv, 'penicillin', 'penisilin')" +
               " WHERE allergies_csv LIKE '%penicillin%'",
          why: 'A safe repair, because penisilin is a real allergy_class id and the English spelling can only have meant it. The migration then re-applies unchanged.' }]
      },
      mayRefuse: "An allergy token that is not an allergy_class id. Three patients carry 'penicillin', the English spelling, from a 2024 spreadsheet import.",
      down: { refused: 'There is no down for this step. Re-joining allergy rows into a comma-joined string is lossy the moment anyone records a class with no CSV spelling. A down that cannot restore what the up dropped is worse than no down, because it advertises a safety that is not there.' }
    },

    /* ---------------------------------------------------------------- v5 */
    {
      version: 5,
      name: 'visit-integrity',
      why: 'Rebuild visit with every foreign key in the end state, including the composite one that makes doctor_id mean a doctor, and lift three child tables out of a CSV column, a JSON blob and eleven loose vitals columns.',
      needsRebuild: true,
      fk: 'on',
      fkWhy: 'visit has no children yet — the three about to exist are created after the rebuild — so the pragma stays ON and the composite foreign key gets to refuse the row that names a pharmacist.',
      guard: guardTable('triage'),
      demos: [],
      statements: [
        { label: 'carry the columns about to be dropped into a staging table',
          sql: 'CREATE TABLE _visit_legacy AS SELECT id, tindakan_csv, history_json,' +
               ' td_sistol, td_diastol, nadi, suhu_dc, rr, spo2, bb_hg, tb_mm,' +
               ' acuity_id, triage_by, triage_at FROM visit' },
        { label: 'rebuild visit', rebuild: 'visit' },
        { label: 'ux_visit_active', guard: guardIndex('ux_visit_active'), sql: INDEX_DDL.ux_visit_active },
        { label: 'triage', guard: guardTable('triage'), sql: TABLE_DDL.triage },
        { label: 'visit_tindakan', guard: guardTable('visit_tindakan'), sql: TABLE_DDL.visit_tindakan },
        { label: 'visit_status_history', guard: guardTable('visit_status_history'), sql: TABLE_DDL.visit_status_history },
        { label: 'backfill triage from the loose vitals columns',
          sql: 'INSERT INTO triage (visit_id, td_sistol, td_diastol, nadi, suhu_dc, rr, spo2,' +
               ' bb_hg, tb_mm, acuity_id, note, by_staff, at)' +
               " SELECT id, td_sistol, td_diastol, nadi, suhu_dc, rr, spo2, bb_hg, tb_mm," +
               " acuity_id, '', triage_by, triage_at FROM _visit_legacy" +
               ' WHERE acuity_id IS NOT NULL AND triage_at IS NOT NULL' +
               ' AND coalesce(td_sistol, nadi, suhu_dc, rr, spo2, bb_hg, tb_mm) IS NOT NULL' },
        { label: 'split tindakan_csv', js: 'backfillVisitTindakanCsv',
          preview: "for each 'tnd-03,tnd-04': INSERT INTO visit_tindakan(visit_id, tindakan_id) VALUES (?, ?)" },
        { label: 'parse history_json into ordered rows', js: 'backfillVisitStatusHistory',
          preview: 'JSON.parse(history_json) -> INSERT INTO visit_status_history(visit_id, ordinal, from_state, to_state, at, by_staff, by_role)' },
        { label: 'drop the staging table', sql: 'DROP TABLE _visit_legacy' }
      ],
      rebuilds: {
        visit: {
          ddl: TABLE_DDL.visit,
          copy: 'INSERT INTO "visit_new" (id, rm_number, visit_date, poli_id, klass, status,' +
                ' queue_no, queue_seq, complaint, kecelakaan_id, doctor_id, opened_at, opened_by, billed_at)' +
                ' SELECT id, rm_number, visit_date, poli_id, klass, status, queue_no, queue_seq,' +
                ' complaint, kecelakaan_id, doctor_id, opened_at, opened_by, billed_at FROM "visit"'
        }
      },
      declares: { visit: 'bytes', triage: 'new', visit_tindakan: 'new', visit_status_history: 'new' },
      verify: [
        { label: 'the composite foreign key on (doctor_id, doctor_role) exists', sql: "SELECT \"table\", \"from\", \"to\" FROM pragma_foreign_key_list('visit') WHERE \"table\" = 'staff'" },
        { label: 'nothing anywhere references a queue number', sql: "SELECT count(*) FROM pragma_table_list t, pragma_foreign_key_list(t.name) f WHERE f.\"to\" LIKE '%queue_no%'" },
        { label: 'the eleven legacy columns are gone from visit', sql: "SELECT count(*) FROM pragma_table_info('visit') WHERE name IN ('tindakan_csv','history_json','td_sistol','td_diastol','nadi','suhu_dc','rr','spo2','bb_hg','tb_mm','acuity_id','triage_by','triage_at')" },
        { label: 'integrity after the rebuild', sql: 'PRAGMA foreign_key_check' }
      ],
      refusal: {
        finder: "SELECT v.id, v.doctor_id, s.role_id FROM visit v LEFT JOIN staff s ON s.id = v.doctor_id" +
                " WHERE v.doctor_id IS NOT NULL AND (s.id IS NULL OR s.role_id <> 'dokter')",
        fixes: [{ label: "reassign to the poli's own doctor",
          sql: "UPDATE visit SET doctor_id = (SELECT s.id FROM staff s WHERE s.role_id = 'dokter'" +
               ' AND s.poli_id = visit.poli_id)' +
               " WHERE doctor_id IN (SELECT id FROM staff WHERE role_id <> 'dokter')",
          why: "The poli has exactly one doctor, so the intended value is recoverable. It would not be if the clinic had two, and then the only honest repair is to ask somebody who was there." }]
      },
      mayRefuse: 'A visit whose doctor_id names somebody who is not a doctor. One names the apoteker stf-06, from a dropdown that listed all staff.',
      down: { refused: 'Refused. The CSV column and the JSON blob cannot be reconstituted from three normalised tables without inventing the order they were written in.' }
    },

    /* ---------------------------------------------------------------- v6 */
    {
      version: 6,
      name: 'children-first',
      why: "Rebuild encounter's two children before encounter itself, which is the right order — and is what makes the next migration dangerous.",
      needsRebuild: true,
      fk: 'on',
      fkWhy: 'Neither child has children of its own, so nothing can cascade out from under this rung. Keeping the pragma on means the copy is checked against encounter, icd10, addendable_path_role and staff as it happens.',
      guard: guardIndex('ux_enc_primary'),
      demos: [],
      statements: [
        { label: 'rebuild encounter_diagnosis', rebuild: 'encounter_diagnosis' },
        { label: 'rebuild addendum', rebuild: 'addendum' },
        { label: 'ux_enc_primary — exactly one primary diagnosis per encounter',
          guard: guardIndex('ux_enc_primary'), sql: INDEX_DDL.ux_enc_primary }
      ],
      rebuilds: {
        encounter_diagnosis: {
          ddl: TABLE_DDL.encounter_diagnosis,
          copy: 'INSERT INTO "encounter_diagnosis_new" (encounter_id, icd_code, is_primary, note)' +
                " SELECT encounter_id, icd_code, coalesce(is_primary, 0), coalesce(note, '')" +
                ' FROM "encounter_diagnosis"'
        },
        addendum: {
          ddl: TABLE_DDL.addendum,
          copy: 'INSERT INTO "addendum_new" (id, seq, encounter_id, path, old_value, new_value,' +
                ' reason, by_staff, by_role, at)' +
                ' SELECT id, seq, encounter_id, path, old_value, new_value, reason, by_staff,' +
                ' by_role, at FROM "addendum"'
        }
      },
      declares: { encounter_diagnosis: 'bytes', addendum: 'bytes' },
      verify: [
        { label: 'both children are STRICT and WITHOUT ROWID where declared', sql: "SELECT name, sql LIKE '%STRICT%' AS strict FROM sqlite_master WHERE name IN ('encounter_diagnosis','addendum') AND type='table'" },
        { label: 'ux_enc_primary is partial', sql: "SELECT partial FROM pragma_index_list('encounter_diagnosis') WHERE name = 'ux_enc_primary'" },
        { label: 'the opposite delete actions are now both declared', sql: "SELECT (SELECT sql LIKE '%ON DELETE RESTRICT%' FROM sqlite_master WHERE name='encounter_diagnosis'), (SELECT sql LIKE '%ON DELETE CASCADE%' FROM sqlite_master WHERE name='addendum')" }
      ],
      refusal: {
        finder: 'SELECT encounter_id, count(*) FROM encounter_diagnosis WHERE is_primary = 1' +
                ' GROUP BY 1 HAVING count(*) <> 1',
        fixes: [{ label: 'demote every primary but the first',
          sql: 'UPDATE encounter_diagnosis SET is_primary = 0 WHERE is_primary = 1 AND rowid NOT IN' +
               ' (SELECT min(rowid) FROM encounter_diagnosis WHERE is_primary = 1 GROUP BY encounter_id)',
          why: 'It runs against the LEGACY table, which still has a rowid, because the rollback put it back. Which of the two is primary is a clinical decision and min(rowid) is not making it — the panel lets you pick, and this is the default.' }]
      },
      mayRefuse: 'An encounter that already carries two primary diagnoses. One does, installed by an addendum on path \'a\' before the constraint existed.',
      down: { refused: 'Refused. Dropping the unique index is easy; putting back the second primary diagnosis that somebody had to choose between is not, and a down that silently keeps the corrected data is not a down.' }
    },

    /* ---------------------------------------------------------------- v7 */
    {
      version: 7,
      name: 'encounter-rebuild',
      why: 'The centrepiece. encounter needs four things ALTER TABLE cannot do, so it has to be rebuilt — and it now has two children with opposite delete actions, one of which will refuse loudly and one of which will not.',
      needsRebuild: true,
      fk: 'off',
      fkWhy: 'THIS is the rung the pragma exists for. encounter_diagnosis says ON DELETE RESTRICT and addendum says ON DELETE CASCADE. With foreign keys on, DROP TABLE encounter either raises or silently empties addendum, depending on whether the RESTRICT child happens to have rows in it this quarter.',
      guard: guardTable('encounter_vitals'),
      demos: [
        { label: 'make visit_id NOT NULL', sql: 'ALTER TABLE encounter ALTER COLUMN visit_id TEXT NOT NULL', expect: 'error', why: 'There is no ALTER COLUMN in SQLite at all.' },
        { label: 'add a CHECK', sql: "ALTER TABLE encounter ADD CONSTRAINT ck CHECK (status IN ('draft','signed'))", expect: 'error', why: 'No ADD CONSTRAINT either.' },
        { label: 'add the composite foreign key', sql: 'ALTER TABLE encounter ADD CONSTRAINT fk FOREIGN KEY (visit_id, rm_number) REFERENCES visit(id, rm_number)', expect: 'error', why: 'Same syntax error, same conclusion.' },
        { label: 'drop a constraint', sql: 'ALTER TABLE encounter DROP CONSTRAINT ck', expect: 'error', why: 'And there is no way back out either. Four bare syntax errors is the strongest form of "this needs a rebuild": no flag, no pragma, no version to wait for.' }
      ],
      statements: [
        { label: 'rebuild encounter', rebuild: 'encounter' },
        { label: 'encounter_vitals', guard: guardTable('encounter_vitals'), sql: TABLE_DDL.encounter_vitals },
        { label: 'copy the vitals a signed note claims were measured',
          sql: 'INSERT INTO encounter_vitals (encounter_id, td_sistol, td_diastol, nadi, suhu_dc,' +
               ' rr, spo2, bb_hg, tb_mm, copied_at)' +
               ' SELECT e.id, t.td_sistol, t.td_diastol, t.nadi, t.suhu_dc, t.rr, t.spo2,' +
               ' t.bb_hg, t.tb_mm, e.created_at FROM encounter e' +
               ' JOIN triage t ON t.visit_id = e.visit_id' }
      ],
      rebuilds: {
        encounter: {
          ddl: TABLE_DDL.encounter,
          copy: 'INSERT INTO "encounter_new" (id, visit_id, rm_number, doctor_id, status, s,' +
                ' o_exam, p_plan, p_edukasi, p_kontrol, created_at, signed_at, signed_by)' +
                " SELECT id, visit_id, rm_number, doctor_id, status, coalesce(s, '')," +
                " coalesce(o_exam, ''), coalesce(p_plan, ''), coalesce(p_edukasi, '')," +
                " coalesce(p_kontrol, ''), created_at, signed_at, signed_by FROM \"encounter\""
        }
      },
      declares: { encounter: 'bytes', encounter_vitals: 'new' },
      verify: [
        { label: 'both children still have their rows', sql: 'SELECT (SELECT count(*) FROM addendum) AS addenda, (SELECT count(*) FROM encounter_diagnosis) AS diagnoses' },
        { label: "addendum's stored DDL still reads ON DELETE CASCADE — the child was never touched", sql: "SELECT sql LIKE '%ON DELETE CASCADE%' FROM sqlite_master WHERE name='addendum'" },
        { label: 'foreign keys are back on', sql: 'PRAGMA foreign_keys' },
        { label: 'the composite foreign key to visit(id, rm_number) exists', sql: "SELECT \"from\", \"to\" FROM pragma_foreign_key_list('encounter') WHERE \"table\" = 'visit'" }
      ],
      mayRefuse: 'Nothing in the data. This rung refuses only if you run the naive script instead of the twelve steps — and then it either refuses loudly or destroys two rows in silence, depending on a state you cannot see from the script.',
      down: { refused: 'Refused. The four things the rebuild added are the four things ALTER TABLE cannot remove either.' }
    },

    /* ---------------------------------------------------------------- v8 */
    {
      version: 8,
      name: 'money',
      why: 'Four REAL money columns and two more on the lines become STRICT INTEGER rupiah. A guard query runs first and names every row that would not survive the cast.',
      needsRebuild: true,
      fk: 'off',
      fkWhy: 'bill_line says ON DELETE CASCADE on bill(visit_id). Rebuilding bill with foreign keys on would empty every line in the database and commit.',
      guard: guardColumn('bill', 'total_tarif_rp'),
      demos: [
        { label: "a money column, declared numeric, storing the string 'abc'",
          sql: "INSERT INTO bill_line (visit_id, line_no, label, grp, qty, unit, amount, covered, payer) VALUES ('DEMO', 9001, 'demo', 'jasa', 1, 'abc', 'abc', 0, 'pasien')",
          expect: 'ok',
          why: 'Not STRICT. A column declared INTEGER in a non-STRICT table will store any string you give it; that is not a constraint, it is a comment.' },
        { label: 'and what typeof() says about it',
          sql: 'SELECT unit, typeof(unit) FROM bill_line WHERE line_no = 9001', expect: 'ok',
          why: 'text. This is the one place the typeof sweep can go red, which is why it runs here and not after the migration.' },
        { label: 'clean up the demonstration row',
          sql: 'DELETE FROM bill_line WHERE line_no = 9001', expect: 'ok',
          why: 'It is outside the transaction, so it has to be removed by hand or the census sees a row nobody declared.' }
      ],
      statements: [
        // NOT `typeof(unit) <> 'integer'`. A column declared REAL has REAL
        // affinity, which forces every integer written to it into floating
        // point, so typeof() answers 'real' for all 6,000 perfectly good rows
        // and a guard written that way refuses the whole table. VERIFIED, and
        // it is the single easiest mistake to make in this migration. What is
        // actually being asked is "is this value integral", and that is two
        // conditions: the storage class must be numeric at all, and the value
        // must equal its own truncation.
        { label: 'the guard query: every value that would not survive CAST',
          sql: 'SELECT visit_id, line_no, unit, typeof(unit) FROM bill_line' +
               " WHERE typeof(unit) NOT IN ('integer','real') OR unit <> CAST(unit AS INTEGER)",
          refuseIfRows: true },
        { label: 'the same guard over the four totals on bill',
          sql: 'SELECT visit_id, total_tarif, typeof(total_tarif) FROM bill' +
               " WHERE typeof(total_tarif) NOT IN ('integer','real') OR total_tarif <> CAST(total_tarif AS INTEGER)" +
               " OR typeof(ditanggung) NOT IN ('integer','real') OR ditanggung <> CAST(ditanggung AS INTEGER)" +
               " OR typeof(ditanggung_lain) NOT IN ('integer','real') OR ditanggung_lain <> CAST(ditanggung_lain AS INTEGER)" +
               " OR typeof(dibayar_pasien) NOT IN ('integer','real') OR dibayar_pasien <> CAST(dibayar_pasien AS INTEGER)",
          refuseIfRows: true },
        { label: 'rebuild bill_line', rebuild: 'bill_line' },
        { label: 'rebuild bill', rebuild: 'bill' }
      ],
      rebuilds: {
        bill_line: {
          ddl: TABLE_DDL.bill_line,
          copy: 'INSERT INTO "bill_line_new" (visit_id, line_no, label, grp, qty, unit_rp, covered, payer)' +
                ' SELECT visit_id, line_no, label, grp, CAST(qty AS INTEGER),' +
                ' CAST(unit AS INTEGER), covered, payer FROM "bill_line"'
        },
        bill: {
          ddl: TABLE_DDL.bill,
          copy: 'INSERT INTO "bill_new" (visit_id, klass, kecelakaan_id, total_tarif_rp,' +
                ' ditanggung_rp, ditanggung_lain_rp, dibayar_pasien_rp, note, closed_at, closed_by)' +
                ' SELECT visit_id, klass, kecelakaan_id, CAST(total_tarif AS INTEGER),' +
                ' CAST(ditanggung AS INTEGER), CAST(ditanggung_lain AS INTEGER),' +
                " CAST(dibayar_pasien AS INTEGER), coalesce(note, ''), closed_at, closed_by" +
                ' FROM "bill"'
        }
      },
      declares: { bill: 'bytes', bill_line: 'bytes' },
      verify: [
        { label: 'no column anywhere in the database has REAL affinity', sql: "SELECT count(*) FROM pragma_table_list t, pragma_table_info(t.name) c WHERE t.schema='main' AND t.type='table' AND c.type='REAL'" },
        { label: 'amount_rp is generated and stored', sql: "SELECT name, hidden FROM pragma_table_xinfo('bill_line') WHERE name='amount_rp'" },
        // The sum-of-parts CHECK is on the table, so querying for rows that
        // violate it can only ever return 0. What is worth checking is that the
        // money did not MOVE, and that comparison has to come from outside this
        // schema version — see verifyAgainstBefore.
        { label: 'the sum-of-parts CHECK is present in the stored DDL',
          sql: "SELECT sql LIKE '%total_tarif_rp = ditanggung_rp + ditanggung_lain_rp + dibayar_pasien_rp%'" +
               " FROM sqlite_master WHERE name = 'bill' AND type = 'table'" }
      ],
      // §10.3's third trap, in the one place it actually bites: amount_rp is
      // GENERATED ALWAYS AS (qty * unit_rp), so verifying it by computing
      // qty * unit_rp proves nothing at all. The figure it is compared against is
      // bill.total_tarif, a REAL column on a DIFFERENT TABLE, read before the
      // rung ran and while the old schema was still in place.
      verifyAgainstBefore: [
        { label: 'the total of every line equals the total of every bill, read before the cast',
          beforeSql: 'SELECT CAST(round(sum(total_tarif)) AS INTEGER) FROM bill',
          afterSql: 'SELECT sum(amount_rp) FROM bill_line' },
        { label: 'no bill and no line was added or lost',
          beforeSql: 'SELECT (SELECT count(*) FROM bill), (SELECT count(*) FROM bill_line)',
          afterSql: 'SELECT (SELECT count(*) FROM bill), (SELECT count(*) FROM bill_line)' }
      ],
      refusal: {
        finder: 'SELECT visit_id, line_no, unit, typeof(unit) FROM bill_line' +
                " WHERE typeof(unit) NOT IN ('integer','real') OR unit <> CAST(unit AS INTEGER)",
        fixes: [
          { label: 'truncate the float',
            sql: "UPDATE bill_line SET unit = CAST(unit AS INTEGER) WHERE typeof(unit) = 'real'" +
                 ' AND unit <> CAST(unit AS INTEGER)',
            why: 'Safe: 40000.000000001 was 40000 before a float multiply touched it, and nothing was ever charged in fractions of a rupiah.' },
          { label: 'strip the currency prefix a spreadsheet added',
            sql: "UPDATE bill_line SET unit = CAST(replace(replace(replace(unit, 'Rp', ''), '.', ''), ' ', '') AS INTEGER)" +
                 " WHERE typeof(unit) = 'text'",
            why: 'NOT safe in the same way, and the panel says so. This is a guess about a formatting convention, not a recovery of a value: it reads Indonesian thousands separators, and against a file that used the comma convention it would silently divide every amount by a thousand.' }
        ]
      },
      mayRefuse: "A money value that is not an integer. Two rows are: one 40000.000000001 from a float multiply in the old JavaScript, and one '15000' stored as TEXT by a CSV upload.",
      down: { refused: 'Refused. A REAL column cannot be restored from an INTEGER one without inventing precision that was never measured.' }
    },

    /* ---------------------------------------------------------------- v9 */
    {
      version: 9,
      name: 'audit-armour',
      why: 'Canonicalise the audit detail and recompute the chain, split one polymorphic string column into three typed foreign keys, and only THEN arm the append-only triggers. The order is the lesson.',
      needsRebuild: true,
      fk: 'off',
      fkWhy: "audit_entry's prev_hash references audit_entry(hash). Rebuilding a table that references itself with foreign keys on works by accident, through the DEFERRABLE clause, and relying on an accident is not a procedure.",
      guard: guardTable('audit_commitment'),
      demos: [
        // `statements` rather than `sql`, and a `cleanup` that always runs: the
        // UPDATE is meant to fail, and a failed statement does NOT abort the
        // transaction it is in, so without the cleanup this demonstration would
        // leave the connection inside a BEGIN and the migration behind it would
        // die with "cannot start a transaction within a transaction". Which is
        // itself the lesson of G8, arriving early and uninvited.
        { label: 'the wrong order: arm the triggers first, then backfill',
          statements: [
            'BEGIN',
            'CREATE TRIGGER tmp_no_update BEFORE UPDATE ON audit_entry' +
              " BEGIN SELECT RAISE(ABORT, 'audit_entry is append-only: UPDATE refused'); END",
            'UPDATE audit_entry SET detail = detail WHERE seq = 0'
          ],
          cleanup: ['ROLLBACK'],
          expect: 'error',
          why: 'Your own guarantee refuses your own migration. The trigger cannot tell a backfill from an edit, and that is correct of it.' }
      ],
      statements: [
        { label: 'drop the legacy index over the polymorphic pair, before the columns go',
          sql: 'DROP INDEX IF EXISTS idx_audit_entity' },
        { label: 'rewrite detail as canonical JSON and recompute the whole chain',
          js: 'backfillAuditCanonical',
          preview: 'for each entry in seq order: detail = canonical(JSON.parse(detail));' +
                   ' prev_hash = previous.hash; hash = sha256(canonical(commitment(entry)))' },
        { label: 'rebuild audit_entry', rebuild: 'audit_entry' },
        { label: 'idx_audit_ent_patient', guard: guardIndex('idx_audit_ent_patient'), sql: INDEX_DDL.idx_audit_ent_patient },
        { label: 'idx_audit_ent_visit', guard: guardIndex('idx_audit_ent_visit'), sql: INDEX_DDL.idx_audit_ent_visit },
        { label: 'idx_audit_ent_encounter', guard: guardIndex('idx_audit_ent_encounter'), sql: INDEX_DDL.idx_audit_ent_encounter },
        { label: 'arm trg_audit_no_update', sql: TRIGGER_DDL.trg_audit_no_update },
        { label: 'arm trg_audit_no_delete', sql: TRIGGER_DDL.trg_audit_no_delete },
        { label: 'arm trg_audit_chain', sql: TRIGGER_DDL.trg_audit_chain },
        { label: 'audit_commitment', guard: guardTable('audit_commitment'), sql: TABLE_DDL.audit_commitment },
        { label: 'write the length and head commitment, held outside the chain',
          sql: "INSERT INTO audit_commitment (k, count, head, at) SELECT 'chain', count(*)," +
               ' (SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),' +
               ' (SELECT max(at) FROM audit_entry) FROM audit_entry' }
      ],
      rebuilds: {
        audit_entry: {
          ddl: TABLE_DDL.audit_entry,
          copy: 'INSERT INTO "audit_entry_new" (seq, at, actor_id, actor_name, actor_role, action,' +
                ' summary, detail, entity, ent_patient, ent_visit, ent_encounter, prev_hash, hash)' +
                ' SELECT seq, at, actor_id, actor_name, actor_role, action, summary, detail, entity,' +
                " CASE WHEN entity = 'patient'   THEN entity_id END," +
                " CASE WHEN entity = 'visit'     THEN entity_id END," +
                " CASE WHEN entity = 'encounter' THEN entity_id END," +
                ' prev_hash, hash FROM "audit_entry" ORDER BY seq'
        }
      },
      declares: { audit_entry: 'bytes', audit_commitment: 'new' },
      verify: [
        { label: 'the three triggers are armed', sql: "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name" },
        { label: 'exactly one entity column is set on every row', sql: 'SELECT count(*) FROM audit_entry WHERE (ent_patient IS NOT NULL) + (ent_visit IS NOT NULL) + (ent_encounter IS NOT NULL) <> 1' },
        { label: 'the commitment matches the chain it commits to', sql: 'SELECT c.count = (SELECT count(*) FROM audit_entry) AS n, c.head = (SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1) AS h FROM audit_commitment c' },
        { label: 'the self-referencing prev_hash foreign key holds', sql: 'PRAGMA foreign_key_check' }
      ],
      mayRefuse: 'Nothing in this fixture. It refuses if you arm the triggers before the backfill, which is what the demonstration above does on purpose.',
      down: { refused: 'Refused, and this one is not even close. Un-canonicalising JSON means guessing the key order somebody happened to serialise in, and re-merging three typed foreign keys into one unconstrained string throws away the only thing the rung bought.' }
    }
  ];

  /* ---------------------------------------------------- the planted four */

  // Judges read staged failures as props unless the page owns them. Each of
  // these is the residue of something that really happens; the fifth row is the
  // one that is NOT planted, and saying so is the point of the card.
  var PLANTED_DEFECTS = [
    { id: 'D1', defect: "3 patients with the allergy token 'penicillin'",
      history: 'a spreadsheet import in 2024 that used the English spelling',
      caught: 'the v4 foreign key on patient_allergy.class_id' },
    { id: 'D2', defect: 'one encounter with two is_primary = 1 rows',
      history: "an addendum on path 'a' written before the constraint existed — the hole the IndexedDB version still has",
      caught: 'the v6 partial unique index ux_enc_primary' },
    { id: 'D3', defect: "40000.000000001 and '15000' in a REAL money column",
      history: 'a float multiply in the old JavaScript; a CSV upload',
      caught: "the v8 guard query, before a single row is cast" },
    { id: 'D4', defect: 'one visit.doctor_id naming an apoteker',
      history: 'a dropdown that listed all staff',
      caught: 'the v5 composite foreign key on (doctor_id, doctor_role)' },
    { id: '—', defect: "v7's trap is NOT planted",
      history: 'ON DELETE CASCADE on addendum is correct domain modelling. Nothing about it was arranged for the demonstration.',
      caught: 'the census, which is the only thing that notices' }
  ];

  root.ROMBAK_SCHEMA = {
    V1_DDL: V1_DDL,
    LEGACY_DDL: LEGACY_DDL,
    TABLE_DDL: TABLE_DDL,
    INDEX_DDL: INDEX_DDL,
    LEGACY_INDEX_DDL: LEGACY_INDEX_DDL,
    TRIGGER_DDL: TRIGGER_DDL,
    FINAL_DDL: FINAL_DDL,
    finalDdlText: finalDdlText,
    REFERENCE_ROWS: REFERENCE_ROWS,
    REFERENCE_ORDER: REF_ORDER,
    LEGACY_ORDER: LEGACY_ORDER,
    MIGRATIONS: MIGRATIONS,
    TWELVE_STEPS: TWELVE_STEPS,
    NAIVE_SCRIPT: NAIVE_SCRIPT,
    NAIVE_REBUILDS: NAIVE_REBUILDS,
    WRONG_FIXES: WRONG_FIXES,
    ALTER_MATRIX: ALTER_MATRIX,
    REBUILD_REFUSALS: REBUILD_REFUSALS,
    PLANTED_DEFECTS: PLANTED_DEFECTS,
    TARGET_VERSION: 9
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.ROMBAK_SCHEMA;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
