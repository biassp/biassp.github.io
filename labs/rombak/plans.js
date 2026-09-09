/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — plans.js
 * Data only. Fourteen named queries, and for each one the EXPLAIN QUERY PLAN
 * output SQLite actually produced against the v9 database at the row counts this
 * lab's own seed produces. Every string in `expectPlan` was transcribed from a
 * real run; none was predicted.
 *
 * WHY PLANS AND NOT TIMINGS ARE THE ASSERTION.
 * A suite that pins a millisecond figure is a suite that goes red on somebody
 * else's laptop, and then the honest reading of the red is "this machine is
 * slower", which is not a defect. A plan string is a statement about the
 * planner's decision, and the planner's decision is the thing the schema was
 * designed to influence. So: plans are asserted, timings are measured, shown
 * with their sample size, and asserted about never.
 *
 * FOUR OF THE FOURTEEN ARE FAILURES AND SAY SO.
 * An index the planner never picks, a partial index skipped for a purely
 * syntactic reason, a LIKE that no b-tree can help, and an index that makes its
 * query slower. A plans panel with fourteen green ticks teaches nothing except
 * that the author only kept the queries that worked.
 *
 * TWO MEASUREMENT TRAPS, BOTH FOUND THE HARD WAY IN THIS BUILD:
 *
 *  1. THE ROW-SET COMPARISON NEEDS AN EXPLICIT ORDER BY. Route B compares the
 *     query as written against the same query with NOT INDEXED, by hashing the
 *     result set. An index scan and a table scan return the SAME ROWS IN A
 *     DIFFERENT ORDER, so an order-sensitive hash over an unordered query
 *     reports a divergence that is not one. VERIFIED: four of these fourteen
 *     diverged that way before `orderFor` existed. Both sides of the comparison
 *     get `orderFor` appended; neither side of the PLAN assertion does, because
 *     adding an ORDER BY can change the plan, which is the whole subject.
 *
 *  2. `NOT INDEXED` DOES NOT FORCE A SCAN ON A `WITHOUT ROWID` TABLE. VERIFIED
 *     on encounter_diagnosis: `SELECT encounter_id FROM encounter_diagnosis
 *     NOT INDEXED WHERE icd_code = ?` still plans as
 *     `SEARCH ... USING COVERING INDEX idx_dx_code`. So entries on WITHOUT ROWID
 *     tables carry a hand-written twin instead, and the panel says why.
 *
 * FIELDS
 *   id              stable key; the Plans tab's DOM ids derive from it
 *   name            the heading
 *   sql             exactly what is planned, timed and run. No ORDER BY is added.
 *   params          static literals, safe because they name reference rows
 *   paramsSql       preferred when present: a query whose first row supplies the
 *                   params, so no fixture-derived id is ever typed into this file
 *   expectPlan      array of EXPLAIN QUERY PLAN `detail` values, in order
 *   twinSql         the independent route: same rows, different access path
 *   twinSameRows    false where the twin changes the SELECT list, so the row-set
 *                   hashes are expected to differ and must not be compared
 *   expectTwinPlan  and what that route plans as
 *   orderFor        appended to BOTH sides for the row-set hash comparison only
 *   variants        pragma-scoped re-plans (the case_sensitive_like swap)
 *   setup/teardown  DDL the entry needs and must undo
 *   isFailureCase   true where the point is that this does NOT work
 *   why             one paragraph, shown on the card
 */
(function (root) {
  'use strict';

  var PLANS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'patient-timeline',
      name: 'The patient timeline, from the index alone',
      sql: 'SELECT visit_date, poli_id, status FROM visit WHERE rm_number = ? ORDER BY visit_date DESC',
      paramsSql: 'SELECT rm_number FROM visit GROUP BY rm_number ORDER BY count(*) DESC, rm_number LIMIT 1',
      params: ['RM-000007'],
      expectPlan: ['SEARCH visit USING COVERING INDEX idx_visit_rm (rm_number=?)'],
      twinSql: 'SELECT visit_date, poli_id, status FROM visit NOT INDEXED WHERE rm_number = ? ORDER BY visit_date DESC',
      expectTwinPlan: ['SCAN visit', 'USE TEMP B-TREE FOR ORDER BY'],
      orderFor: '',
      isFailureCase: false,
      why: 'The most-run query in a record room. idx_visit_rm is (rm_number, visit_date DESC, poli_id, status), which is wider than the predicate needs on purpose: every column the list renders is in the index, so COVERING appears and the table is never touched. The DESC is load-bearing — the NOT INDEXED twin has to build a temp b-tree to get the same order, and that line is the cost of leaving it out.'
    },
    /* ------------------------------------------------------------------ 2 */
    {
      id: 'patient-timeline-wide',
      name: 'One more column in the SELECT list, and COVERING is gone',
      sql: 'SELECT visit_date, poli_id, status, complaint FROM visit WHERE rm_number = ? ORDER BY visit_date DESC',
      paramsSql: 'SELECT rm_number FROM visit GROUP BY rm_number ORDER BY count(*) DESC, rm_number LIMIT 1',
      params: ['RM-000007'],
      expectPlan: ['SEARCH visit USING INDEX idx_visit_rm (rm_number=?)'],
      twinSql: null,
      expectTwinPlan: null,
      orderFor: '',
      isFailureCase: false,
      why: 'The same query with `complaint` added. The index is still used and the word COVERING has disappeared, because complaint is not in it and every matching row now costs a second lookup in the table. This is the whole of what "covering" means, and it is one column of a SELECT list away in either direction.'
    },
    /* ------------------------------------------------------------------ 3 */
    {
      id: 'queue-board',
      name: 'The index the planner never picks',
      sql: 'SELECT queue_seq, status FROM visit WHERE visit_date = ? AND poli_id = ? ORDER BY queue_seq',
      paramsSql: 'SELECT visit_date, poli_id FROM visit ORDER BY visit_date DESC, poli_id LIMIT 1',
      params: null,
      expectPlan: ['SEARCH visit USING INDEX sqlite_autoindex_visit_2 (visit_date=? AND poli_id=?)'],
      twinSql: 'SELECT queue_seq, status FROM visit NOT INDEXED WHERE visit_date = ? AND poli_id = ? ORDER BY queue_seq',
      expectTwinPlan: ['SCAN visit', 'USE TEMP B-TREE FOR ORDER BY'],
      orderFor: '',
      isFailureCase: true,
      why: 'idx_visit_board is (visit_date, poli_id, status, queue_seq) and was written for exactly this query. The planner does not use it. UNIQUE(visit_date, poli_id, queue_seq) — declared for a completely different reason, to state that a queue number is unique only inside a day and a poli — already built a NARROWER index with the same leading columns and the ordering this query needs, so sqlite_autoindex_visit_2 wins every time. The index is not wrong; it is redundant, and nothing in the schema said so. VERIFIED. Note that the assertion names an auto-index, which is generated from the ORDER of the UNIQUE clauses in the CREATE TABLE: reorder them and this string changes.'
    },
    /* ------------------------------------------------------------------ 4 */
    {
      id: 'live-board-notin',
      name: 'A partial index, used',
      sql: "SELECT id FROM visit WHERE status NOT IN ('selesai','batal')",
      params: [],
      expectPlan: ['SCAN visit USING INDEX ux_visit_active'],
      twinSql: "SELECT id FROM visit NOT INDEXED WHERE status NOT IN ('selesai','batal')",
      expectTwinPlan: ['SCAN visit'],
      orderFor: ' ORDER BY id',
      isFailureCase: false,
      why: 'Two partial indexes carry this exact predicate — ux_visit_active and idx_visit_open — and the planner reaches for one of them, walking only the rows that satisfy it instead of the whole table. Pair this with the next entry before drawing any conclusion.'
    },
    /* ------------------------------------------------------------------ 5 */
    {
      id: 'live-board-neq',
      name: 'The same rows, spelled differently, and no index at all',
      sql: "SELECT id FROM visit WHERE status <> 'selesai' AND status <> 'batal'",
      params: [],
      expectPlan: ['SCAN visit'],
      twinSql: "SELECT id FROM visit NOT INDEXED WHERE status <> 'selesai' AND status <> 'batal'",
      expectTwinPlan: ['SCAN visit'],
      orderFor: ' ORDER BY id',
      isFailureCase: true,
      why: "Identical result set — the row-set hash proves it — and the plan is a bare SCAN. SQLite matches a partial index's WHERE clause SYNTACTICALLY, not semantically: `status NOT IN ('selesai','batal')` matches the index's text and `status <> 'selesai' AND status <> 'batal'` does not, so neither partial index applies and there is nothing else to use. The sharpest failure case on this tab, because nothing about the query looks wrong and no error is raised."
    },
    /* ------------------------------------------------------------------ 6 */
    {
      id: 'chapter-rollup',
      name: 'An index on a VIRTUAL generated column',
      sql: 'SELECT c.roman, count(*) FROM icd10_chapter c JOIN icd10 i ON i.head BETWEEN c.code_lo AND c.code_hi GROUP BY c.roman',
      params: [],
      expectPlan: ['SCAN c', 'SEARCH i USING INDEX idx_icd10_head (head>? AND head<?)'],
      twinSql: 'SELECT c.roman, count(*) FROM icd10_chapter c JOIN icd10 i NOT INDEXED ON i.head BETWEEN c.code_lo AND c.code_hi GROUP BY c.roman',
      expectTwinPlan: ['SCAN c', 'SCAN i'],
      orderFor: '',
      isFailureCase: false,
      why: 'icd10.head is GENERATED ALWAYS AS substr(code,1,3) VIRTUAL — zero stored bytes in the row — and it is indexed. That turns the chapter roll-up from twenty-one full scans of the rubric table into twenty-one range searches. The chapter boundary lives on the chapter row and nowhere else, which is why there is no chapter column on icd10 to drift.'
    },
    /* ------------------------------------------------------------------ 7 */
    {
      id: 'like-prefix-nocase',
      name: 'LIKE can only use a NOCASE index',
      sql: "SELECT code, title_id FROM icd10 WHERE title_id LIKE 'demam%'",
      params: [],
      expectPlan: ['SEARCH icd10 USING INDEX idx_icd10_title_nc (title_id>? AND title_id<?)'],
      twinSql: "SELECT code, title_id FROM icd10 NOT INDEXED WHERE title_id LIKE 'demam%'",
      expectTwinPlan: ['SCAN icd10'],
      orderFor: ' ORDER BY code',
      variants: [
        { id: 'case-sensitive-on', pragma: 'PRAGMA case_sensitive_like = ON',
          restore: 'PRAGMA case_sensitive_like = OFF',
          expectPlan: ['SEARCH icd10 USING INDEX idx_icd10_title_id (title_id>? AND title_id<?)'],
          why: 'The two indexes swap places. Same schema, same query, one pragma.' }
      ],
      isFailureCase: false,
      why: 'There are two indexes on title_id: idx_icd10_title_id with the default BINARY collation and idx_icd10_title_nc with NOCASE. LIKE is case-insensitive by default, so only the NOCASE index can serve the prefix optimisation and the BINARY one is dead weight for this query. Flip PRAGMA case_sensitive_like and they swap, with no change to the schema and no change to the query — which is the demonstration that a collation is part of the index, not part of the column.'
    },
    /* ------------------------------------------------------------------ 8 */
    {
      id: 'like-leading-wildcard',
      name: 'A leading wildcard, and no index can help',
      sql: "SELECT code, title_id FROM icd10 WHERE title_id LIKE '%demam'",
      params: [],
      expectPlan: ['SCAN icd10'],
      twinSql: "SELECT code, title_id FROM icd10 NOT INDEXED WHERE title_id LIKE '%demam'",
      expectTwinPlan: ['SCAN icd10'],
      orderFor: ' ORDER BY code',
      isFailureCase: true,
      why: 'A b-tree is ordered by prefix. With no prefix there is no range, so there is no search, and building a third index would change nothing. The honest fix is a different data structure — a trigram or full-text index — and FTS5 is not compiled into this build, which the Schema tab reports as a constraint rather than hiding.'
    },
    /* ------------------------------------------------------------------ 9 */
    {
      id: 'rm-like-nocase',
      name: 'The same collation lesson, on an identifier',
      sql: "SELECT rm_number FROM visit WHERE rm_number LIKE 'RM-0000%'",
      params: [],
      expectPlan: ['SEARCH visit USING COVERING INDEX idx_visit_rm_nc (rm_number>? AND rm_number<?)'],
      twinSql: "SELECT rm_number FROM visit NOT INDEXED WHERE rm_number LIKE 'RM-0000%'",
      expectTwinPlan: ['SCAN visit'],
      orderFor: ' ORDER BY rm_number',
      variants: [
        { id: 'case-sensitive-on', pragma: 'PRAGMA case_sensitive_like = ON',
          restore: 'PRAGMA case_sensitive_like = OFF',
          expectPlan: ['SEARCH visit USING COVERING INDEX idx_visit_rm (rm_number>? AND rm_number<?)'],
          why: 'And here they swap the other way: with case_sensitive_like ON, LIKE becomes a BINARY comparison and the BINARY index is the usable one.' }
      ],
      isFailureCase: false,
      why: 'A record-room search box types "RM-0000" and expects a prefix match. idx_visit_rm leads with rm_number and cannot serve it, because LIKE is NOCASE; idx_visit_rm_nc exists for this one query and nothing else. It is worth knowing that the fix for a slow search box was a collation, not a rewrite.'
    },
    /* ----------------------------------------------------------------- 10 */
    {
      id: 'rm-glob-binary',
      name: 'GLOB is case-sensitive, so it uses the other index',
      sql: "SELECT rm_number FROM visit WHERE rm_number GLOB 'RM-0000*'",
      params: [],
      expectPlan: ['SEARCH visit USING COVERING INDEX idx_visit_rm (rm_number>? AND rm_number<?)'],
      twinSql: "SELECT rm_number FROM visit NOT INDEXED WHERE rm_number GLOB 'RM-0000*'",
      expectTwinPlan: ['SCAN visit'],
      orderFor: ' ORDER BY rm_number',
      isFailureCase: false,
      why: 'GLOB is always case-sensitive, so it always uses the BINARY index and is never affected by case_sensitive_like. Three plans, one column, and which index gets used depends entirely on which operator was typed. The schema CHECKs in this lab use GLOB and not LIKE for exactly this reason: a pattern that means one thing on Tuesday is not a constraint.'
    },
    /* ----------------------------------------------------------------- 11 */
    {
      id: 'addendum-replay',
      name: 'A composite index that supplies the ORDER BY as well',
      sql: 'SELECT seq, path, new_value FROM addendum WHERE encounter_id = ? ORDER BY seq',
      paramsSql: 'SELECT encounter_id FROM addendum ORDER BY seq LIMIT 1',
      params: null,
      expectPlan: ['SEARCH addendum USING INDEX idx_addendum_enc (encounter_id=?)'],
      twinSql: 'SELECT seq, path, new_value FROM addendum NOT INDEXED WHERE encounter_id = ? ORDER BY seq',
      expectTwinPlan: ['SCAN addendum', 'USE TEMP B-TREE FOR ORDER BY'],
      orderFor: '',
      isFailureCase: false,
      why: "The effective-record replay walks one encounter's addenda in seq order. idx_addendum_enc is (encounter_id, seq), so the range scan arrives already sorted and there is no USE TEMP B-TREE FOR ORDER BY line. VERIFIED, and with a wrinkle worth the space: DROPPING the index does NOT produce the temp b-tree, because UNIQUE(seq) built another index that happens to supply the order — the plan becomes `SCAN addendum USING INDEX sqlite_autoindex_addendum_2`. Only NOT INDEXED, which forbids every index, shows what the sort would have cost."
    },
    /* ----------------------------------------------------------------- 12 */
    {
      id: 'dx-report-covering',
      name: 'The reporting direction, which the primary key did not serve',
      sql: 'SELECT encounter_id FROM encounter_diagnosis WHERE icd_code = ?',
      paramsSql: 'SELECT icd_code FROM encounter_diagnosis GROUP BY icd_code ORDER BY count(*) DESC, icd_code LIMIT 1',
      params: ['J06.9'],
      expectPlan: ['SEARCH encounter_diagnosis USING COVERING INDEX idx_dx_code (icd_code=?)'],
      twinSql: 'SELECT encounter_id, is_primary FROM encounter_diagnosis WHERE icd_code = ?',
      expectTwinPlan: ['SEARCH encounter_diagnosis USING INDEX idx_dx_code (icd_code=?)'],
      // The only entry whose twin is NOT a same-rows route: it deliberately
      // SELECTs one more column, so the row objects differ and the row-set hash
      // is expected to diverge. Comparing them would assert nothing.
      twinSameRows: false,
      orderFor: ' ORDER BY encounter_id',
      isFailureCase: false,
      why: 'PRIMARY KEY (encounter_id, icd_code) answers "what did this encounter code" and cannot answer "which encounters carry J06.9", which is the direction a claim batch reads and therefore the direction money moves in. idx_dx_code is the reverse pair. The twin here is NOT the NOT INDEXED form: on a WITHOUT ROWID table NOT INDEXED does not stop the planner using a secondary index, VERIFIED, so the twin adds one column to the SELECT list instead and COVERING drops off. Two ways to lose a covering index, one tab apart.'
    },
    /* ----------------------------------------------------------------- 13 */
    {
      id: 'payer-reconciliation',
      name: 'A GROUP BY that needs no sort',
      sql: 'SELECT payer, sum(amount_rp) FROM bill_line GROUP BY payer',
      params: [],
      expectPlan: ['SCAN bill_line USING INDEX idx_bill_line_payer'],
      twinSql: 'SELECT payer, sum(amount_rp) FROM bill_line NOT INDEXED GROUP BY payer',
      expectTwinPlan: ['SCAN bill_line', 'USE TEMP B-TREE FOR GROUP BY'],
      orderFor: ' ORDER BY payer',
      isFailureCase: false,
      why: 'The capitation reconciliation groups by payer across every closed bill in the database. idx_bill_line_payer leads with payer, so the scan arrives in group order and no temp b-tree is built — the plan says SCAN, not SEARCH, because every row is still read, and reading every row in the right order is a different cost from reading every row and then sorting. amount_rp is a STORED generated column for this query specifically: VIRTUAL would recompute qty * unit_rp once per row on every pass.'
    },
    /* ----------------------------------------------------------------- 14 */
    {
      id: 'klass-adhoc-index',
      name: 'An index that makes its query slower',
      sql: 'SELECT id, rm_number, complaint FROM visit WHERE klass = ?',
      params: ['bpjs'],
      setup: ['CREATE INDEX ixk ON visit(klass)'],
      teardown: ['DROP INDEX ixk'],
      expectPlan: ['SEARCH visit USING INDEX ixk (klass=?)'],
      twinSql: 'SELECT id, rm_number, complaint FROM visit NOT INDEXED WHERE klass = ?',
      expectTwinPlan: ['SCAN visit'],
      orderFor: ' ORDER BY id',
      isFailureCase: true,
      timingNote: 'Measure on TWO SQL.Database instances holding identical data, one with ixk and one without, interleaved A,B,A,B for at least six rounds, mean of means, N printed. If it inverts on the visitor\'s machine the page reports the inversion in those words. The ASSERTION is on the plan strings only.',
      why: 'There is deliberately no index on visit(klass) in the shipped schema. Build one and the planner chooses it, because it can: klass = \'bpjs\' is an equality on an indexed column. It is also the wrong choice, because roughly seven visits in ten are bpjs, none of the three selected columns is in the index, and so the query becomes a b-tree walk plus one table lookup per matching row instead of a single sequential pass. An index helps when it eliminates rows. This one eliminates three in ten and charges for the privilege.'
    }
  ];

  // The ANALYZE card is its own thing rather than a fifteenth plan, because what
  // it asserts is about the STATISTICS and not about any one query. Every string
  // here was transcribed from a real run on the v9 database.
  var ANALYZE_CARD = {
    absentBefore: "SELECT count(*) FROM sqlite_master WHERE name = 'sqlite_stat1'",
    absentBeforeExpect: 0,
    analyze: 'ANALYZE',
    rowsAfter: 'SELECT count(*) FROM sqlite_stat1',
    rowsAfterExpect: 61,
    // The one plan in this fixture that ANALYZE changes on its own. Before the
    // statistics exist the planner guesses from the schema; afterwards it knows
    // that only 150 of 2,569 visits are still in the queue, and it switches to
    // the partial index that holds exactly those.
    flips: {
      sql: "SELECT count(*) FROM visit WHERE status NOT IN ('selesai','batal')",
      before: ['SCAN visit USING COVERING INDEX idx_visit_board'],
      after: ['SCAN visit USING INDEX ux_visit_active']
    },
    // The tamper, and the half everybody misses. VERIFIED: the UPDATE alone
    // changes NOTHING, because the planner is still holding the statistics it
    // loaded when the schema was last read. `ANALYZE sqlite_schema` is what
    // reloads them, and it is the reason a "why is my plan not changing" hour
    // ends in a reconnect.
    tamper: {
      sql: 'SELECT p.rm_number, count(*) FROM patient p JOIN visit v ON v.rm_number = p.rm_number' +
           " WHERE p.klass = 'bpjs' GROUP BY p.rm_number",
      beforeTamper: ['SCAN p USING INDEX sqlite_autoindex_patient_1',
                     'SEARCH v USING COVERING INDEX idx_visit_rm (rm_number=?)'],
      update: "UPDATE sqlite_stat1 SET stat = '1 1' WHERE tbl = 'visit' AND idx = 'idx_visit_rm'",
      afterUpdateOnly: ['SCAN p USING INDEX sqlite_autoindex_patient_1',
                        'SEARCH v USING COVERING INDEX idx_visit_rm (rm_number=?)'],
      reload: 'ANALYZE sqlite_schema',
      afterReload: ['SCAN v USING COVERING INDEX idx_visit_rm',
                    'SEARCH p USING INDEX sqlite_autoindex_patient_1 (rm_number=?)',
                    'USE TEMP B-TREE FOR GROUP BY'],
      repair: 'ANALYZE',
      why: 'Re-running ANALYZE overwrites the lie with the truth. There are no histograms to worry about either way: sqlite_stat4 is not compiled into this build.'
    }
  };

  // How an index is sized when dbstat is not compiled in. VERIFIED in this
  // build: page_count does NOT shrink when an index is dropped — the pages go on
  // the freelist and the file stays the same length — so a panel that reported
  // page_count alone would show a dropped index costing nothing. Both numbers
  // are read, both are shown, and the size is the delta of their difference.
  var INDEX_SIZE_METHOD = {
    read: ['PRAGMA page_count', 'PRAGMA freelist_count'],
    formula: 'pages_in_use = page_count - freelist_count',
    // One measured example, one machine, one run: creating ixk on 2,569 visit
    // rows moved freelist_count 409 -> 400 with page_count unchanged at 2,125.
    // Nine pages, 36,864 bytes, and the file did not grow at all because it
    // already had free pages to spend.
    example: { index: 'ixk ON visit(klass)', pageCountBefore: 2125, freelistBefore: 409,
               pageCountAfter: 2125, freelistAfter: 400, pagesUsed: 9, pageSize: 4096 }
  };

  // Absent from this build, asserted by the module error rather than by parsing
  // PRAGMA compile_options — a string in compile_options is a claim about how
  // the library was built, and the error is what actually happens. VERIFIED
  // messages, transcribed.
  var BUILD_LIMITS = [
    { id: 'fts5', probe: 'CREATE VIRTUAL TABLE zzf USING fts5(a)', expect: 'no such module: fts5' },
    { id: 'rtree', probe: 'CREATE VIRTUAL TABLE zzr USING rtree(id, x0, x1)', expect: 'no such module: rtree' },
    { id: 'dbstat', probe: 'SELECT * FROM dbstat LIMIT 1', expect: 'no such table: dbstat' },
    { id: 'sqlite_stat4', probe: 'SELECT count(*) FROM sqlite_stat4', expect: 'no such table: sqlite_stat4' },
    { id: 'generate_series', probe: 'SELECT * FROM generate_series(1, 3)', expect: 'no such table: generate_series' }
  ];

  root.ROMBAK_PLANS = {
    PLANS: PLANS,
    ANALYZE_CARD: ANALYZE_CARD,
    INDEX_SIZE_METHOD: INDEX_SIZE_METHOD,
    BUILD_LIMITS: BUILD_LIMITS,
    COUNT: PLANS.length,
    FAILURE_COUNT: (function () {
      var n = 0, i;
      for (i = 0; i < PLANS.length; i++) if (PLANS[i].isFailureCase) n++;
      return n;
    })()
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.ROMBAK_PLANS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
