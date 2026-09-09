/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — runner.js
 * The migration ladder, executed. Nine versions, forward only, against a
 * database that already has 24,959 rows in it before the first ALTER runs.
 *
 * ======================= WHAT A RUNG ACTUALLY DOES =======================
 *
 * Twelve steps, and they are NOT twelve steps per table. Steps 1, 2, 10, 11 and
 * 12 — the pragma, BEGIN, foreign_key_check, COMMIT, the pragma again — belong
 * to the RUNG. Steps 3 to 9 — capture, create, copy, drop, rename, restore
 * indexes, restore triggers — belong to a TABLE. v6 and v8 each rebuild two
 * tables inside one transaction, so the two scopes cannot be collapsed; v7,
 * which is the version the whole lab is about, maps one to one and the panel
 * shows all twelve.
 *
 * THE PRAGMA IS PER RUNG AND IT IS NOT ALWAYS OFF. A rebuild needs
 * `foreign_keys = OFF` only when the table being rebuilt HAS foreign-key
 * children: the drop-and-rename is what would fire their delete actions.
 * Nothing references `patient` at v4, `visit` at v5, or either child at v6, so
 * those three rungs run with foreign keys ON — which is precisely what lets
 * SQLite itself refuse two of them with its own `FOREIGN KEY constraint failed`
 * over the planted defects. Turning the pragma off "to be safe" would have
 * turned two of this lab's four demonstrations into green ticks over bad data.
 *
 * A FAILED STATEMENT DOES NOT ABORT THE TRANSACTION. That is the single most
 * load-bearing fact in this file and it is not intuition: SQLite rolls back the
 * failed STATEMENT and leaves the transaction open. So every refusal path here
 * ends in an explicit ROLLBACK, every demo that is MEANT to fail carries a
 * cleanup list that runs whatever happened, and step 12 runs outside the
 * try/catch. Miss any of the three and the next rung dies with
 * "cannot start a transaction within a transaction" while the panel blames the
 * wrong statement.
 *
 * ======================= THE CENSUS IS NOT MINE ==========================
 *
 * Every rung is bracketed by a census, and the census is `census.js`, which
 * cannot see this file. It receives `db.exec.bind(db)` — sql.js's own function,
 * not a wrapper of mine — and builds its own table list from sqlite_master. The
 * before-snapshot is a VALUE taken before the first statement runs and passed as
 * an argument; there is no getter, no closure and no re-read. What each rung
 * DECLARES it may touch is static data in schema.js, written before the SQL was.
 * When the two disagree the rung is wrong, and the message the visitor reads is
 * the census's own sentence, not a paraphrase of it.
 *
 * ======================= schema_migration IS A LOG =======================
 *
 * The runner writes its own book — version, name, applied_at, measured ms — and
 * NOTHING in this lab verifies anything by reading it. The census excludes it by
 * name (a table every rung writes to would otherwise report a violation at every
 * rung), the version is always read back with a fresh `PRAGMA user_version`, and
 * `fingerprint()` deliberately leaves it out. One consequence, stated because it
 * is real: the measured ms is a property of the machine, so two runs of the same
 * ladder produce databases whose BYTES differ in that table while their census
 * checksum, chain head and schema hash are identical. Compare fingerprints, not
 * exports.
 */
(function (root) {
  'use strict';

  var E = root.ROMBAK_ENGINE;
  var S = root.ROMBAK_SCHEMA;
  var C = root.ROMBAK_CENSUS;
  var SEED = root.ROMBAK_SEED;
  var D = root.ROMBAK_DOMAIN;
  if (!E || !S || !C || !SEED || !D) {
    throw new Error('rombak/runner.js: needs ROMBAK_ENGINE, ROMBAK_SCHEMA, ROMBAK_CENSUS, ROMBAK_SEED and ROMBAK_DOMAIN loaded first');
  }

  var NS = {};
  NS.TARGET = S.TARGET_VERSION;

  var state = {
    baseBytes: null,     // v1 + seed, exported. The floor Rewind rebuilds from.
    fixture: null
  };

  /* ------------------------------------------------------------- plumbing */

  function db0(opts) { return (opts && opts.db) || E.db(); }
  function q(s) { return String(s).replace(/'/g, "''"); }
  function ms(t0) { return Math.round(E.now() - t0); }

  function firstCell(db, sql) {
    var r = db.exec(sql);
    if (!r.length || !r[0].values.length) return null;
    return r[0].values[0][0];
  }
  function rowsOf(db, sql) {
    var r = db.exec(sql);
    return r.length ? r[0].values : [];
  }
  /* Cells, flattened to clone-safe primitives. Everything this file returns
     crosses page.evaluate at some point, and a Uint8Array or an Error in there
     breaks structured clone silently (§10.2). */
  function plainRows(rr, limit) {
    var out = [], i, j, row;
    for (i = 0; i < rr.length && (!limit || i < limit); i++) {
      row = [];
      for (j = 0; j < rr[i].length; j++) {
        var c = rr[i][j];
        row.push(c === null ? null : (typeof c === 'number' || typeof c === 'boolean' ? c : String(c)));
      }
      out.push(row);
    }
    return out;
  }

  /* ------------------------------------------------- version, read and write */

  /* §3.0 rule 1. `PRAGMA user_version = ?` is a syntax error — VERIFIED, both at
     prepare and with a bound value: `near "?": syntax error`. This is the one
     place in the lab where parameterisation is simply unavailable, so the number
     is coerced with Number() and interpolated, and the page says so rather than
     hiding it. */
  NS.userVersion = function (opts) {
    return Number(firstCell(db0(opts), 'PRAGMA user_version'));
  };
  NS.setUserVersion = function (v, opts) {
    db0(opts).run('PRAGMA user_version = ' + Number(v));
    return Number(firstCell(db0(opts), 'PRAGMA user_version'));
  };
  NS.loggedVersion = function (opts) {
    var v = firstCell(db0(opts), 'SELECT max(version) FROM schema_migration');
    return v === null ? 0 : Number(v);
  };
  NS.migration = function (v) {
    var m = S.MIGRATIONS[Number(v) - 1];
    if (!m || m.version !== Number(v)) throw new Error('rombak: no migration v' + v);
    return m;
  };

  /* ---------------------------------------------------------- the JS ops */

  /* Five backfills that SQL cannot express. Two split a comma-joined column into
     child rows, one parses a JSON blob into ordered rows, and one recomputes a
     SHA-256 chain — none of which is a SQL expression, which is the honest reason
     they are here rather than an aesthetic one. They read from staging tables
     (`_patient_csv`, `_visit_legacy`) created and dropped inside the same
     transaction, so the rebuild can drop the columns they need while they still
     need them, and no census ever sees the staging table. */
  var jsOps = {
    backfillAllergyCsv: function (db) {
      return splitCsv(db, "SELECT rm_number, allergies_csv FROM _patient_csv WHERE allergies_csv IS NOT NULL AND allergies_csv <> ''",
        'INSERT INTO patient_allergy (rm_number, class_id) VALUES (?, ?)');
    },
    backfillChronicCsv: function (db) {
      return splitCsv(db, "SELECT rm_number, chronic_csv FROM _patient_csv WHERE chronic_csv IS NOT NULL AND chronic_csv <> ''",
        'INSERT INTO patient_chronic (rm_number, icd_code) VALUES (?, ?)');
    },
    backfillVisitTindakanCsv: function (db) {
      return splitCsv(db, "SELECT id, tindakan_csv FROM _visit_legacy WHERE tindakan_csv IS NOT NULL AND tindakan_csv <> ''",
        'INSERT INTO visit_tindakan (visit_id, tindakan_id) VALUES (?, ?)');
    },
    backfillVisitStatusHistory: function (db) {
      var src = rowsOf(db, "SELECT id, history_json FROM _visit_legacy WHERE history_json IS NOT NULL AND history_json <> ''");
      var st = db.prepare('INSERT INTO visit_status_history (visit_id, ordinal, from_state, to_state, at, by_staff, by_role) VALUES (?,?,?,?,?,?,?)');
      var n = 0, i, k, hist, h;
      try {
        for (i = 0; i < src.length; i++) {
          hist = JSON.parse(src[i][1]);
          for (k = 0; k < hist.length; k++) {
            h = hist[k];
            st.run([src[i][0], k, h.from === undefined || h.from === null ? null : h.from,
              h.to, h.at, h.by, h.role]);
            st.reset();
            n++;
          }
        }
      } finally { st.free(); }
      return n;
    },
    /* The chain, recomputed from seq 0. The legacy rows were hashed over
       JSON.stringify's key order, which is insertion order, which is not a
       property of the data; canonical() sorts, so every digest downstream of the
       first row changes and the head the seed reported is NOT the head this rung
       produces. Both are valid heads of two different canonicalisations, and the
       page reports both rather than pretending the numbers should match. */
    backfillAuditCanonical: function (db) {
      var src = rowsOf(db, 'SELECT seq, at, actor_id, actor_name, actor_role, action, summary, detail, entity, entity_id FROM audit_entry ORDER BY seq');
      var st = db.prepare('UPDATE audit_entry SET detail = ?, prev_hash = ?, hash = ? WHERE seq = ?');
      var prev = null, n = 0, i, r, detail, hash;
      try {
        for (i = 0; i < src.length; i++) {
          r = src[i];
          detail = D.canonical(JSON.parse(r[7]));
          hash = D.hashEntry({
            seq: r[0], at: r[1], actorId: r[2], actorName: r[3], actorRole: r[4],
            action: r[5], entity: r[8], entityId: r[9], summary: r[6],
            detail: detail, prevHash: prev
          });
          st.run([detail, prev, hash, r[0]]);
          st.reset();
          prev = hash;
          n++;
        }
      } finally { st.free(); }
      return n;
    }
  };
  NS.jsOps = jsOps;

  function splitCsv(db, selectSql, insertSql) {
    var src = rowsOf(db, selectSql);
    var st = db.prepare(insertSql);
    var n = 0, i, k, toks;
    try {
      for (i = 0; i < src.length; i++) {
        toks = String(src[i][1]).split(',');
        for (k = 0; k < toks.length; k++) {
          if (!toks[k]) continue;
          st.run([src[i][0], toks[k]]);
          st.reset();
          n++;
        }
      }
    } finally { st.free(); }
    return n;
  }

  /* ================= THE TWELVE STEPS, STEPS 3 THROUGH 9 ================= */

  /* Step 4 needs the target DDL with a different table name in the header, and
     nothing else changed. A regex over the whole statement is the wrong tool and
     the reason is concrete: TABLE_DDL.audit_entry contains
     `REFERENCES audit_entry(hash)`, which must survive verbatim — after step 7's
     rename it becomes the self-reference that makes the rebuilt table work. So
     the substitution is a single indexOf on the exact header substring, which
     every entry in TABLE_DDL is formatted to make unique (note
     `CREATE TABLE encounter (` against `CREATE TABLE encounter_diagnosis (`). */
  function renameHeader(ddl, table, newName) {
    var needle = 'CREATE TABLE ' + table + ' (';
    var at = String(ddl).indexOf(needle);
    if (at < 0) throw new Error('rombak: cannot find the CREATE TABLE header for ' + table);
    if (String(ddl).indexOf(needle, at + 1) >= 0) {
      throw new Error('rombak: the CREATE TABLE header for ' + table + ' is not unique in its DDL');
    }
    return ddl.slice(0, at) + 'CREATE TABLE "' + newName + '" (' + ddl.slice(at + needle.length);
  }
  NS.renameHeader = renameHeader;

  /* Step 3's `AND sql IS NOT NULL` is not tidiness. Auto-indexes (the ones
     SQLite builds for UNIQUE and PRIMARY KEY) have no DDL text, so re-running
     one is a crash — and they need no help: the new table's own UNIQUE clauses
     recreate them. Named indexes and triggers have DDL and are the ones that
     silently vanish if nobody captured them. */
  function capture(db, table) {
    var rr = rowsOf(db, "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = '" + q(table) +
      "' AND type IN ('index','trigger','view') AND sql IS NOT NULL ORDER BY type, name");
    var i, out = [];
    for (i = 0; i < rr.length; i++) {
      out.push({ type: String(rr[i][0]), name: String(rr[i][1]), sql: String(rr[i][2]) });
    }
    return out;
  }
  NS.capture = capture;

  NS.rebuild = function (table, spec, opts) {
    var db = db0(opts);
    var scratch = table + '_new';
    var out = { table: table, scratch: scratch, steps: [] };
    function step(n, label, fn) {
      var t0 = E.now(), note;
      note = fn();
      out.steps.push({ n: n, label: label, ms: ms(t0), note: note === undefined ? '' : String(note) });
    }
    var captured = null;
    step(3, 'capture indexes, triggers and views', function () {
      captured = capture(db, table);
      out.captured = captured;
      var i, names = [];
      for (i = 0; i < captured.length; i++) names.push(captured[i].type + ':' + captured[i].name);
      return captured.length + ' object(s)' + (names.length ? ': ' + names.join(', ') : '');
    });
    step(4, 'create the new table', function () {
      db.run(renameHeader(spec.ddl, table, scratch));
      return scratch + ' created';
    });
    step(5, 'copy the rows', function () {
      db.run(spec.copy);
      out.copied = Number(firstCell(db, 'SELECT count(*) FROM "' + scratch + '"'));
      return out.copied + ' row(s)';
    });
    step(6, 'drop the old table', function () {
      db.run('DROP TABLE "' + table + '"');
      return table + ' dropped';
    });
    step(7, 'rename', function () {
      db.run('ALTER TABLE "' + scratch + '" RENAME TO "' + table + '"');
      return scratch + ' -> ' + table;
    });
    /* Indexes BEFORE triggers, always. A trigger body may reference the table by
       name and an index may not; more practically, an index that mentions a
       column the rebuild REMOVED has to have been dropped before step 4, which
       is why v4 and v9 each carry an explicit DROP INDEX as a real statement. */
    step(8, 'recreate the indexes captured at step 3', function () {
      var i, n = 0;
      for (i = 0; i < captured.length; i++) {
        if (captured[i].type === 'index') { db.run(captured[i].sql); n++; }
      }
      out.indexes = n;
      return n + ' index(es)';
    });
    step(9, 'recreate the triggers and views captured at step 3', function () {
      var i, n = 0;
      for (i = 0; i < captured.length; i++) {
        if (captured[i].type !== 'index') { db.run(captured[i].sql); n++; }
      }
      out.triggers = n;
      return n + ' trigger(s)/view(s)';
    });
    return out;
  };

  /* The twelve steps as DISPLAY text, with the placeholders filled from the same
     spec the runner executes. schema.js holds the list; this fills in the four
     entries whose SQL is a function of the table. */
  NS.twelveSteps = function (table, spec) {
    var out = [], i, s, sql;
    for (i = 0; i < S.TWELVE_STEPS.length; i++) {
      s = S.TWELVE_STEPS[i];
      sql = s.sql;
      if (sql) {
        sql = sql.replace(/\{t\}/g, table).replace(/\{new\}/g, table + '_new');
      } else if (spec) {
        if (s.n === 4) sql = renameHeader(spec.ddl, table, table + '_new');
        else if (s.n === 5) sql = spec.copy;
        else if (s.n === 8) sql = '-- re-run each CREATE INDEX captured at step 3';
        else if (s.n === 9) sql = '-- re-run each CREATE TRIGGER captured at step 3';
      }
      out.push({ n: s.n, label: s.label, sql: sql, why: s.why, scope: (s.n >= 3 && s.n <= 9) ? 'table' : 'rung' });
    }
    return out;
  };

  /* ===================== THE NAIVE REBUILD, FIRST CLASS ================== */

  /* Not a comment, not a string in the copy: the Rebuild panel RUNS this, four
     times, against four databases that differ from each other by exactly one
     stated thing. It is the same five statements every migration guide prints,
     in the same order, and the whole lab exists because of what it does and does
     not say while doing it. */
  NS.naiveSpec = function (table) {
    var i, m, spec = null;
    for (i = 0; i < S.MIGRATIONS.length; i++) {
      m = S.MIGRATIONS[i];
      if (m.rebuilds && m.rebuilds[table]) { spec = m.rebuilds[table]; break; }
    }
    var ddl = S.TABLE_DDL[table] || (spec && spec.ddl);
    if (!ddl) throw new Error('rombak: no DDL known for ' + table);
    var copy = spec && spec.copy;
    if (S.NAIVE_REBUILDS[table] && S.NAIVE_REBUILDS[table].copy) copy = S.NAIVE_REBUILDS[table].copy;
    if (!copy) throw new Error('rombak: no copy statement known for ' + table);
    return { ddl: ddl, copy: copy, loses: S.NAIVE_REBUILDS[table] ? S.NAIVE_REBUILDS[table].loses : '' };
  };

  NS.naiveRebuild = function (table, spec, opts) {
    var db = db0(opts);
    spec = spec || NS.naiveSpec(table);
    var scratch = table + '_new';
    var out = { table: table, steps: [], committed: false, fkCheck: [], errors: 0 };
    var i, e, sql, t0, label;
    for (i = 0; i < S.NAIVE_SCRIPT.length; i++) {
      e = S.NAIVE_SCRIPT[i];
      label = e.label;
      sql = e.sql;
      if (e.from === 'rebuildDdl') sql = renameHeader(spec.ddl, table, scratch);
      else if (e.from === 'rebuildCopy') sql = spec.copy;
      else if (sql) sql = sql.replace(/\{t\}/g, table).replace(/\{new\}/g, scratch);
      t0 = E.now();
      if (sql === 'PRAGMA foreign_key_check') {
        // A query, not a statement. Reported because the panel's headline is
        // that it comes back empty in every one of the four variants.
        out.fkCheck = plainRows(rowsOf(db, sql));
        out.steps.push({ label: label, sql: sql, ok: true, ms: ms(t0), message: JSON.stringify(out.fkCheck) });
        continue;
      }
      try {
        db.run(sql);
        out.steps.push({ label: label, sql: sql, ok: true, ms: ms(t0), message: '' });
        if (label === 'COMMIT') out.committed = true;
      } catch (err) {
        out.errors++;
        out.steps.push({ label: label, sql: sql, ok: false, ms: ms(t0), message: err.message, mayFail: !!e.mayFail });
      }
    }
    var stray = rowsOf(db, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%\\_new' ESCAPE '\\' ORDER BY name");
    out.stray = [];
    for (i = 0; i < stray.length; i++) out.stray.push(String(stray[i][0]));
    return out;
  };

  /* ========================== THE GUARDED ALTER ========================== */

  /* Idempotence, one statement at a time. The guard is a SELECT whose first cell
     answers "is this already here"; a truthy answer skips the statement rather
     than swallowing its error, because "CREATE INDEX failed and I ignored it" and
     "the index already exists" are different states and only one of them is
     fine. */
  NS.guardedAlter = function (entry, opts) {
    var db = db0(opts);
    var out = { label: entry.label, sql: entry.sql, skipped: false, ok: true, ms: 0, error: '' };
    var t0 = E.now();
    if (entry.guard) {
      var g = firstCell(db, entry.guard);
      if (g) {
        out.skipped = true;
        out.ms = ms(t0);
        out.guard = entry.guard;
        return out;
      }
      out.guard = entry.guard;
    }
    try { db.run(entry.sql); } catch (e) { out.ok = false; out.error = e.message; }
    out.ms = ms(t0);
    return out;
  };

  /* The six ALTER TABLE forms, run against a table WITH rows and the same table
     WITHOUT rows — because five of the six answer differently, and a matrix run
     only against an empty scratch table reports the exact opposite of the truth
     while passing green (§0.4). Both tables here are scratch tables inside a
     SAVEPOINT that is always rolled back: the census must never see them, and
     `ADD COLUMN` on a real domain table is not something to leave lying around.
     What matters to the claim is rows versus no rows, not which table. */
  NS.alterMatrix = function (opts) {
    var db = db0(opts);
    var out = [];
    db.run('SAVEPOINT rombak_alter');
    try {
      db.run('CREATE TABLE zz_alter_empty (a TEXT)');
      db.run('CREATE TABLE zz_alter_pop (a TEXT)');
      db.run("INSERT INTO zz_alter_pop (a) VALUES ('x'),('y'),('z')");
      var i, m, one;
      for (i = 0; i < S.ALTER_MATRIX.length; i++) {
        m = S.ALTER_MATRIX[i];
        one = { id: m.id, sql: m.sql, empty: null, populated: null };
        one.empty = tryAlter(db, m.sql.replace('%T%', 'zz_alter_empty'), m.empty);
        one.populated = tryAlter(db, m.sql.replace('%T%', 'zz_alter_pop'), m.populated);
        one.ok = one.empty.agrees && one.populated.agrees;
        out.push(one);
      }
    } finally {
      try { db.run('ROLLBACK TO rombak_alter'); db.run('RELEASE rombak_alter'); } catch (e) { /* nothing to undo */ }
    }
    return out;
  };

  function tryAlter(db, sql, expect) {
    var res = { sql: sql, expect: expect, got: 'ok', message: '' };
    db.run('SAVEPOINT rombak_alter_one');
    try { db.run(sql); } catch (e) { res.got = 'error'; res.message = e.message; }
    try { db.run('ROLLBACK TO rombak_alter_one'); db.run('RELEASE rombak_alter_one'); } catch (e2) { /* ignore */ }
    res.agrees = res.got === expect;
    return res;
  }

  /* The four things ALTER TABLE cannot do, run for real so the error text on the
     page is SQLite's and not a paraphrase. */
  NS.rebuildRefusals = function (opts) {
    var db = db0(opts);
    var out = [], i, r, one;
    for (i = 0; i < S.REBUILD_REFUSALS.length; i++) {
      r = S.REBUILD_REFUSALS[i];
      one = { want: r.want, sql: r.sql, refused: false, message: '' };
      try { db.run(r.sql); one.message = 'ACCEPTED — which contradicts this page'; }
      catch (e) { one.refused = true; one.message = e.message; }
      out.push(one);
    }
    return out;
  };

  /* ============================== BOOT ================================== */

  /* v1 is applied as a rung like any other, and only THEN is the fixture poured
     in. That order is the point of §3.0 rule 2: a list of CREATE TABLEs run
     against an empty database is a schema, not a migration, and every rung after
     this one has to cope with rows it did not choose. */
  NS.boot = function (opts) {
    opts = opts || {};
    var t0 = E.now();
    var db = E.fresh();
    var r1 = NS.applyOne(1, { db: db, census: opts.census !== false });
    if (!r1.ok) throw new Error('rombak: v1 did not apply: ' + r1.error);

    var tSeed = E.now();
    var fixture = SEED.build(opts.fixture || opts);
    var buildMs = ms(tSeed);

    var tIns = E.now();
    seedInto(db, fixture);
    var insertMs = ms(tIns);

    state.fixture = fixture;
    state.baseBytes = db.export();

    /* The census the LADDER starts from is taken here, after the fixture is in,
       because v1 created empty tables and v2 is the first rung that has to cope
       with rows. Handing v2 the post-DDL/pre-seed census instead reports 25
       undeclared changes and blames the wrong statement — which is exactly what
       this build did on its first run. */
    var seeded = opts.census === false ? null : C.take(db.exec.bind(db));

    return {
      census: seeded,
      db: db,
      fixture: fixture,
      version: NS.userVersion({ db: db }),
      counts: fixture.counts,
      totalRows: fixture.totalRows,
      chain: fixture.chain,
      defects: fixture.defects,
      meta: fixture.meta,
      buildMs: buildMs,
      insertMs: insertMs,
      ms: ms(t0),
      baseBytesLength: state.baseBytes.length,
      v1: r1
    };
  };

  /* One transaction for the whole fixture. It is deliberately NOT chunked across
     frames: the alternative is yielding to the event loop with a write
     transaction open, and an interrupted seed that leaves patients without their
     visits is a worse failure than a single slow block at boot. The measured cost
     is reported by boot() so nobody has to take that trade on faith. */
  function seedInto(db, fixture) {
    db.run('BEGIN');
    try {
      var i;
      for (i = 0; i < S.REFERENCE_ORDER.length; i++) {
        var t = S.REFERENCE_ORDER[i];
        if (S.REFERENCE_ROWS[t]) insertSpec(db, t, S.REFERENCE_ROWS[t]);
        else if (fixture.tables[t]) insertSpec(db, t, fixture.tables[t]);
      }
      for (i = 0; i < S.LEGACY_ORDER.length; i++) {
        insertSpec(db, S.LEGACY_ORDER[i], fixture.tables[S.LEGACY_ORDER[i]]);
      }
      db.run('COMMIT');
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (e2) { /* nothing to roll back */ }
      throw e;
    }
  }
  NS.seedInto = seedInto;

  function insertSpec(db, table, spec) {
    if (!spec || !spec.rows.length) return 0;
    var i, marks = [], names = [];
    for (i = 0; i < spec.columns.length; i++) { marks.push('?'); names.push('"' + spec.columns[i] + '"'); }
    var st = db.prepare('INSERT INTO "' + table + '" (' + names.join(',') + ') VALUES (' + marks.join(',') + ')');
    try {
      for (i = 0; i < spec.rows.length; i++) { st.run(spec.rows[i]); st.reset(); }
    } finally { st.free(); }
    return spec.rows.length;
  }
  NS.insertSpec = insertSpec;

  NS.baseBytes = function () { return state.baseBytes; };
  NS.setBaseBytes = function (bytes) { state.baseBytes = bytes; return bytes ? bytes.length : 0; };
  NS.fixture = function () { return state.fixture; };

  /* ============================== A RUNG ================================ */

  NS.applyOne = function (v, opts) {
    opts = opts || {};
    var db = db0(opts);
    var mig = NS.migration(v);
    var wantCensus = opts.census !== false;
    var t0 = E.now();

    var out = {
      version: mig.version, name: mig.name, why: mig.why,
      fk: mig.fk, fkWhy: mig.fkWhy, needsRebuild: !!mig.needsRebuild,
      declares: mig.declares, mayRefuse: mig.mayRefuse || '',
      skipped: false, ok: false, refused: false, error: null,
      demos: [], steps: [], rebuilds: [],
      fkBefore: null, fkAfter: null, fkCheck: [],
      userVersion: null, loggedVersion: null,
      census: null, declaration: null, rollback: null,
      verify: [], verifyAgainstBefore: [], refusal: null,
      ms: 0
    };

    /* Idempotence. The guard is a query against pragma_table_list or
       sqlite_master — the shape of the database, never schema_migration — and a
       second application of an applied rung does NOTHING, rather than raising a
       duplicate-key error dressed up as a refusal.
       
       "Nothing" is a claim, and it is measured like every other claim on this
       page. This branch used to hand back ONE census under two names with a
       hardcoded empty diff — `{ before: same, after: same, diff: [] }` — which
       made the panel's "not one row of any table moved" and the suite's
       `census.diff.length === 0` true by construction. MEASURED: with a row
       written inside this branch, the whole suite stayed green at 939/939 and
       the page printed the tick. So the census is taken TWICE, either side of
       the nothing, and the diff is computed. Two takes cost half a second and
       buy the only thing that makes the sentence worth printing.
       
       The declaration handed over here is EMPTY on purpose, whatever the rung
       declares: a rung that did not run may not move anything at all, so every
       table is undeclared and any movement is a violation. Passing mig.declares
       instead would report 'not-new' for every table the rung creates, which is
       noise, and would licence a change in every table it names, which is a
       hole. */
    if (opts.force !== true && Number(firstCell(db, mig.guard)) > 0 && NS.userVersion({ db: db }) >= mig.version) {
      out.skipped = true;
      out.userVersion = NS.userVersion({ db: db });
      out.loggedVersion = NS.loggedVersion({ db: db });
      if (wantCensus) {
        var beforeSkip = C.take(db.exec.bind(db));
        /* Nothing runs here. That is the claim, and the two takes bracket it. */
        var afterSkip = C.take(db.exec.bind(db));
        out.census = { before: beforeSkip, after: afterSkip, diff: C.diff(beforeSkip, afterSkip) };
        out.declaration = C.checkDeclaration(beforeSkip, afterSkip, {});
        out.declaresNothing = true;
      }
      out.ok = !out.census || out.census.diff.length === 0;
      if (!out.ok) {
        out.error = 'rombak: v' + mig.version + ' was already applied and did nothing, but ' +
          out.census.diff.length + ' table(s) moved across the two censuses that bracket the nothing.';
      }
      out.ms = ms(t0);
      return out;
    }

    /* THE BEFORE-SNAPSHOT IS A VALUE. Taken here, before the first statement of
       this rung runs, and passed as an argument to diff() afterwards. Not a
       getter, not a closure, not re-read later. §4.3 rule 7 is the whole reason
       this lab's proof panel is not the fourth self-verifying one in this
       repository. */
    var before = null;
    if (wantCensus) before = opts.before || C.take(db.exec.bind(db));

    var vab = [], i;
    for (i = 0; i < (mig.verifyAgainstBefore || []).length; i++) {
      var vq = mig.verifyAgainstBefore[i];
      vab.push({ label: vq.label, beforeSql: vq.beforeSql, afterSql: vq.afterSql,
        before: plainRows(rowsOf(db, vq.beforeSql)) });
    }

    /* Demos run OUTSIDE the transaction and most of them are MEANT to fail. Two
       of them leave a mess if nobody tidies: v9's arms a trigger inside its own
       BEGIN and must ROLLBACK or the rung behind it dies inside a transaction it
       never opened, and v8's inserts a demonstration row that the census would
       otherwise report as undeclared. So cleanup always runs, in its own
       try/catch, whatever happened above it. */
    for (i = 0; i < (mig.demos || []).length; i++) out.demos.push(runDemo(db, mig.demos[i]));

    // ---- step 1: the pragma, BEFORE the transaction
    db.run('PRAGMA foreign_keys = ' + (mig.fk === 'off' ? 'OFF' : 'ON'));
    out.fkBefore = Number(firstCell(db, 'PRAGMA foreign_keys'));
    // ---- step 2
    db.run('BEGIN');

    try {
      for (i = 0; i < mig.statements.length; i++) {
        out.steps.push(runStatement(db, mig, mig.statements[i], out));
      }

      // ---- step 10
      var viol = rowsOf(db, 'PRAGMA foreign_key_check');
      out.fkCheck = plainRows(viol, 8);
      if (viol.length) {
        throw refusal('rombak: ' + mig.name + ' refuses. foreign_key_check reports ' +
          viol.length + ' violation(s): ' + JSON.stringify(plainRows(viol, 4)));
      }

      var elapsed = ms(t0);
      db.run("INSERT INTO schema_migration (version, name, applied_at, ms) VALUES (" +
        Number(mig.version) + ", '" + q(mig.name) + "', '" +
        q(D.stamp(D.PINNED_TODAY, 9, 0, 0)) + "', " + elapsed + ")");
      NS.setUserVersion(mig.version, { db: db });
      // ---- step 11
      db.run('COMMIT');
      out.ok = true;
    } catch (e) {
      // A failed statement leaves the transaction OPEN. This is the line that
      // makes the rollback trio true.
      try { db.run('ROLLBACK'); } catch (e2) { /* there was nothing open */ }
      out.refused = true;
      out.error = e.message;
    }
    // ---- step 12, outside the try: the pragma goes back on either way
    db.run('PRAGMA foreign_keys = ON');
    out.fkAfter = Number(firstCell(db, 'PRAGMA foreign_keys'));

    out.userVersion = NS.userVersion({ db: db });
    out.loggedVersion = NS.loggedVersion({ db: db });

    if (out.refused) {
      if (wantCensus) {
        var afterRefusal = C.take(db.exec.bind(db));
        var d = C.diff(before, afterRefusal);
        out.census = { before: before, after: afterRefusal, diff: d };
        out.rollback = {
          noTrace: d.length === 0,
          diff: d,
          tablesCompared: afterRefusal.tableCount,
          checksumBefore: before.checksum,
          checksumAfter: afterRefusal.checksum
        };
      }
      if (mig.refusal) {
        out.refusal = {
          finder: mig.refusal.finder,
          rows: plainRows(rowsOf(db, mig.refusal.finder), 8),
          fixes: mig.refusal.fixes
        };
      }
      out.ms = ms(t0);
      return out;
    }

    if (wantCensus) {
      var after = C.take(db.exec.bind(db));
      out.census = { before: before, after: after, diff: C.diff(before, after) };
      out.declaration = C.checkDeclaration(before, after, censusDeclares(mig, out));
    }

    for (i = 0; i < (mig.verify || []).length; i++) {
      out.verify.push({
        label: mig.verify[i].label, sql: mig.verify[i].sql,
        rows: plainRows(rowsOf(db, mig.verify[i].sql), 8)
      });
    }
    for (i = 0; i < vab.length; i++) {
      vab[i].after = plainRows(rowsOf(db, vab[i].afterSql));
      vab[i].agree = JSON.stringify(vab[i].before) === JSON.stringify(vab[i].after);
      out.verifyAgainstBefore.push(vab[i]);
    }

    out.ms = ms(t0);
    return out;
  };

  /* census.js excludes `schema_migration` by name and will never return it, for
     a reason that is not negotiable: every rung writes a row to it, so a census
     that contained it would report a violation at every rung including the ones
     that are perfect. v1 declares it anyway, because v1 is the statement that
     creates it — and a declaration for a table in neither census is, correctly, a
     violation. So the runner drops that one name before handing the declaration
     over, and RECORDS that it did, rather than quietly editing static data. */
  function censusDeclares(mig, out) {
    var k, copy = {}, dropped = [];
    for (k in mig.declares) {
      if (!Object.prototype.hasOwnProperty.call(mig.declares, k)) continue;
      if (k === C.SKIPPED_TABLE) { dropped.push(k); continue; }
      copy[k] = mig.declares[k];
    }
    if (dropped.length) out.declaresNotCensusable = dropped;
    return copy;
  }

  function refusal(message) {
    var e = new Error(message);
    e.rombakRefusal = true;
    return e;
  }

  function runDemo(db, d) {
    var res = { label: d.label, expect: d.expect, got: 'ok', message: '', why: d.why || '' };
    var list = d.statements || [d.sql], i;
    try {
      for (i = 0; i < list.length; i++) db.run(list[i]);
    } catch (e) {
      res.got = 'error';
      res.message = e.message;
    }
    for (i = 0; i < (d.cleanup || []).length; i++) {
      try { db.run(d.cleanup[i]); } catch (e2) { /* best effort, by design */ }
    }
    res.asExpected = res.got === d.expect;
    return res;
  }

  function runStatement(db, mig, st, out) {
    var t0 = E.now();
    var row = { label: st.label, sql: st.sql || null, ms: 0, oneShot: true };

    if (st.guard) {
      if (Number(firstCell(db, st.guard)) > 0) {
        row.skipped = true;
        row.guard = st.guard;
        row.ms = ms(t0);
        return row;
      }
      row.guard = st.guard;
    }

    if (st.rebuild) {
      var spec = mig.rebuilds[st.rebuild];
      if (!spec) throw new Error('rombak: v' + mig.version + ' has no rebuild spec for ' + st.rebuild);
      var rb = NS.rebuild(st.rebuild, spec, { db: db });
      out.rebuilds.push(rb);
      row.rebuild = st.rebuild;
      row.rebuildSteps = rb.steps;
      row.copied = rb.copied;
      row.captured = rb.captured.length;
      row.ms = ms(t0);
      return row;
    }

    if (st.js) {
      if (!jsOps[st.js]) throw new Error('rombak: no JS op named ' + st.js);
      row.js = st.js;
      row.preview = st.preview || '';
      row.jsRows = jsOps[st.js](db);
      row.ms = ms(t0);
      return row;
    }

    /* A guard query that refuses the whole rung. Not a CHECK constraint and not
       an exception from SQLite: this is the migration author looking at the data
       first and deciding it will not survive the change. The rows it found are
       shown, because "it failed" without them is not actionable at 2am. */
    if (st.refuseIfRows) {
      var bad = rowsOf(db, st.sql);
      if (bad.length) {
        throw refusal('rombak: ' + mig.name + ' refuses. ' + bad.length +
          ' row(s) would not survive: ' + JSON.stringify(plainRows(bad, 4)));
      }
      row.guardRows = 0;
      row.ms = ms(t0);
      return row;
    }

    db.run(st.sql);
    row.ms = ms(t0);
    return row;
  }

  /* --------------------------------------------------- the one-statement fix */

  NS.fixRefusal = function (v, opts) {
    var db = db0(opts);
    var mig = NS.migration(v);
    if (!mig.refusal) return [];
    var out = [], i, f;
    for (i = 0; i < mig.refusal.fixes.length; i++) {
      f = mig.refusal.fixes[i];
      var one = { label: f.label, sql: f.sql, why: f.why || '', ok: true, error: '' };
      try { db.run(f.sql); } catch (e) { one.ok = false; one.error = e.message; }
      out.push(one);
    }
    return out;
  };

  /* ==================== REPLAY, REWIND AND FINGERPRINTS ================== */

  /* The census is the expensive half of a rung (about a quarter of a second at
     v9), so a walk up the ladder reuses each rung's AFTER snapshot as the next
     rung's BEFORE. That is still a value captured before the next rung runs, so
     rule 7 holds; it halves the number of censuses. */
  NS.replayTo = function (target, opts) {
    opts = opts || {};
    var db = db0(opts);
    target = Number(target);
    var from = NS.userVersion({ db: db });
    if (target < from) {
      return {
        ok: false, from: from, target: target, reports: [],
        refused: 'There is no down-ladder. Rewind rebuilds from v1\'s exported bytes and replays forward; ' +
          'replay cannot walk backwards from v' + from + ' to v' + target + '.'
      };
    }
    var reports = [], v, r, carry = null, ok = true;
    for (v = from + 1; v <= target; v++) {
      r = NS.applyOne(v, { db: db, before: carry, census: opts.census !== false });
      if (r.refused && opts.autoFix !== false && r.refusal) {
        reports.push(r);
        NS.fixRefusal(v, { db: db });
        r = NS.applyOne(v, { db: db, census: opts.census !== false });
      }
      reports.push(r);
      if (!r.ok) { ok = false; break; }
      carry = r.census ? r.census.after : null;
    }
    return { ok: ok, from: from, target: target, reports: reports, version: NS.userVersion({ db: db }) };
  };

  NS.applyThrough = NS.replayTo;

  /* Rewind is not a down-migration. It throws the database away and rebuilds it
     from the bytes v1 exported, then replays. The one-statement fixes are
     re-applied on the way up because the defects are in the FIXTURE, not in the
     schema — which is what makes the two fingerprints comparable at all. */
  NS.rewindTo = function (target, opts) {
    opts = opts || {};
    if (!state.baseBytes) {
      return { ok: false, refused: 'Rewind needs v1\'s exported bytes and this session has none — boot() has not run.' };
    }
    var db = E.openBytes(state.baseBytes);
    E.use(db);
    var out = NS.replayTo(target, { db: db, census: opts.census !== false, autoFix: opts.autoFix });
    out.rewound = true;
    out.fromBytes = state.baseBytes.length;
    return out;
  };

  /* The three things §3.3 asserts identical across a rewind and a replay to the
     same target — and not one of them is the runner's own report. The census
     checksum comes from census.js folding raw rows, the chain head from a SHA-256
     recomputed over canonical JSON, the schema hash from sqlite_master's own
     text. schema_migration appears in none of them, on purpose: it carries a
     measured duration, and a duration is a property of the machine. */
  NS.fingerprint = function (opts) {
    var db = db0(opts);
    var cen = C.take(db.exec.bind(db));
    var head = null, count = 0;
    try {
      head = firstCell(db, 'SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1');
      count = Number(firstCell(db, 'SELECT count(*) FROM audit_entry'));
    } catch (e) { /* no audit table at this version */ }
    return {
      userVersion: NS.userVersion({ db: db }),
      checksum: cen.checksum,
      tableCount: cen.tableCount,
      totalRows: cen.totalRows,
      chainHead: head === null ? null : String(head),
      chainCount: count,
      schemaHash: E.schemaHash(db),
      exportLength: db.export().length
    };
  };

  /* ================= §0.1 — THE FOUR VARIANTS, FOR REAL ================== */

  /* The proposal this lab was built from claimed the naive rebuild could be
     shown destroying rows and refusing loudly against "the same bytes". It
     cannot, and finding that out is what produced the demonstration below: the
     four databases start from ONE export and differ by exactly one stated thing
     each. A is the ladder's own state. B has one child table that happens to be
     empty this quarter. C has one word of a child's DDL changed. D changes the
     PROCEDURE and nothing else.
     
     What the reader is supposed to take away is not that A refuses — it is that
     B and C commit, return `[]` from PRAGMA foreign_key_check, report success,
     and have deleted rows. A clean integrity check is not evidence of a correct
     migration. */
  function variantSnapshot(db, table) {
    function count(t) {
      try { return Number(firstCell(db, 'SELECT count(*) FROM "' + t + '"')); } catch (e) { return null; }
    }
    var i, stray = rowsOf(db, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%\\_new' ESCAPE '\\' ORDER BY name");
    var names = [];
    for (i = 0; i < stray.length; i++) names.push(String(stray[i][0]));
    return {
      addendum: count('addendum'),
      encounter_diagnosis: count('encounter_diagnosis'),
      encounter: count('encounter'),
      visit: count('visit'),
      audit_entry: count('audit_entry'),
      master: E.masterFor(table, db),
      triggers: E.triggerNames(db),
      stray: names,
      foreignKeys: Number(firstCell(db, 'PRAGMA foreign_keys')),
      fkCheck: plainRows(rowsOf(db, 'PRAGMA foreign_key_check'), 8),
      addendumCascades: !!Number(firstCell(db, "SELECT sql LIKE '%ON DELETE CASCADE%' FROM sqlite_master WHERE name = 'addendum'"))
    };
  }
  NS.variantSnapshot = variantSnapshot;

  NS.rebuildVariants = function (bytes, opts) {
    opts = opts || {};
    if (!bytes) throw new Error('rombak: rebuildVariants needs the exported bytes of a v6 database');
    var table = 'encounter';
    var spec = S.MIGRATIONS[6].rebuilds.encounter;
    var out = { table: table, bytes: bytes.length, variants: [] };

    // ---- A: nothing changed
    var a = E.openBytes(bytes);
    var A = { id: 'A', label: 'As shipped — the ladder\'s own state at v6, nothing changed',
      differs: 'nothing' };
    A.before = variantSnapshot(a, table);
    A.naive = NS.naiveRebuild(table, spec, { db: a });
    A.after = variantSnapshot(a, table);
    out.variants.push(A);
    a.close();

    // ---- B: one child table happens to be empty
    var b = E.openBytes(bytes);
    b.run('PRAGMA foreign_keys = OFF');
    b.run('DELETE FROM encounter_diagnosis');
    b.run('PRAGMA foreign_keys = ON');
    var B = { id: 'B', label: 'One child table happens to be empty this quarter',
      differs: 'encounter_diagnosis has no rows — they were archived out last quarter. Same DDL, same script.' };
    B.before = variantSnapshot(b, table);
    B.naive = NS.naiveRebuild(table, spec, { db: b });
    B.after = variantSnapshot(b, table);
    out.variants.push(B);
    b.close();

    // ---- C: one word of a CHILD table's DDL
    var c = E.openBytes(bytes);
    var cascadeDdl = S.TABLE_DDL.encounter_diagnosis.replace(
      'REFERENCES encounter(id) ON DELETE RESTRICT', 'REFERENCES encounter(id) ON DELETE CASCADE');
    if (cascadeDdl === S.TABLE_DDL.encounter_diagnosis) {
      throw new Error('rombak: the one-word RESTRICT -> CASCADE swap did not apply — schema.js changed shape');
    }
    c.run('PRAGMA foreign_keys = OFF');
    c.run('BEGIN');
    NS.rebuild('encounter_diagnosis',
      { ddl: cascadeDdl, copy: S.MIGRATIONS[5].rebuilds.encounter_diagnosis.copy }, { db: c });
    c.run('COMMIT');
    c.run('PRAGMA foreign_keys = ON');
    var C_ = { id: 'C', label: 'One word of a child table\'s DDL: RESTRICT becomes CASCADE',
      differs: 'encounter_diagnosis references encounter(id) ON DELETE CASCADE instead of ON DELETE RESTRICT. One word.' };
    C_.childDdlLine = ddlLine(c, 'encounter_diagnosis', 'encounter_id');
    C_.before = variantSnapshot(c, table);
    C_.naive = NS.naiveRebuild(table, spec, { db: c });
    C_.after = variantSnapshot(c, table);
    out.variants.push(C_);
    c.close();

    // ---- D: the correct twelve steps
    var d = E.openBytes(bytes);
    var D_ = { id: 'D', label: 'The correct twelve steps — PRAGMA foreign_keys = OFF before BEGIN',
      differs: 'nothing about the data. The PROCEDURE changes: the pragma moves outside the transaction and the indexes and triggers are captured before the drop.' };
    D_.before = variantSnapshot(d, table);
    D_.rung = NS.applyOne(7, { db: d, census: opts.census === true });
    D_.after = variantSnapshot(d, table);
    D_.twelve = NS.twelveSteps(table, spec);
    out.variants.push(D_);
    d.close();

    return out;
  };

  function ddlLine(db, table, needle) {
    var sql = firstCell(db, "SELECT sql FROM sqlite_master WHERE name = '" + q(table) + "'");
    if (sql === null) return '';
    var lines = String(sql).split('\n'), i;
    for (i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(needle) >= 0) return lines[i].replace(/^\s+|\s+$/g, '');
    }
    return '';
  }

  /* §0.1's extra finding, which is stronger than the claim it replaced: a naive
     rebuild silently loses every index and trigger on the table it rebuilt.
     It CANNOT be shown on `encounter` in this schema — encounter carries no named
     index and no trigger, only an auto-index that the new table's own
     UNIQUE(visit_id) recreates. So it is shown on `visit`, which has six named
     indexes, and on `audit_entry`, which has three partial indexes and three
     append-only triggers. Same script, same DDL, nothing said. */
  NS.naiveLoses = function (bytes, table, opts) {
    opts = opts || {};
    var db = E.openBytes(bytes);
    var spec = NS.naiveSpec(table);
    var out = {
      table: table, loses: spec.loses,
      rowsBefore: Number(firstCell(db, 'SELECT count(*) FROM "' + table + '"')),
      masterBefore: E.masterFor(table, db),
      triggersBefore: E.triggerNames(db)
    };
    // The pragma is OFF here for the same reason step 1 sets it: without it the
    // drop fires the children's delete actions. This variant is about what the
    // pragma does NOT protect.
    db.run('PRAGMA foreign_keys = OFF');
    out.naive = NS.naiveRebuild(table, spec, { db: db });
    db.run('PRAGMA foreign_keys = ON');
    out.rowsAfter = Number(firstCell(db, 'SELECT count(*) FROM "' + table + '"'));
    out.masterAfter = E.masterFor(table, db);
    out.triggersAfter = E.triggerNames(db);

    var i, k, had = {}, lost = [];
    for (i = 0; i < out.masterBefore.length; i++) {
      if (!out.masterBefore[i].auto) had[out.masterBefore[i].name] = out.masterBefore[i].type;
    }
    for (k in had) {
      if (!Object.prototype.hasOwnProperty.call(had, k)) continue;
      var still = false;
      for (i = 0; i < out.masterAfter.length; i++) if (out.masterAfter[i].name === k) still = true;
      if (!still) lost.push(had[k] + ':' + k);
    }
    lost.sort();
    out.lost = lost;
    out.rowsKept = out.rowsBefore === out.rowsAfter;
    if (!opts.keepOpen) db.close();
    else out.db = db;
    return out;
  };

  /* ================= §0.2 — THE ARMED AUDIT TABLE ======================== */

  /* The proposal claimed a naive rebuild of the audit table would be REFUSED,
     by the self-referencing prev_hash foreign key and by the append-only
     triggers. It is refused by neither, and the two branches below are why:
     
       foreign_keys ON  — COMMIT returns `FOREIGN KEY constraint failed`, over and
         over, because the deferred self-FK is a COUNTER that DROP TABLE's implicit
         delete incremented and the rename never decremented. The transaction stays
         open; ROLLBACK restores every row, every trigger and every partial index.
       foreign_keys OFF before BEGIN — which is what step 1 of the twelve
         prescribes — it COMMITS. All 424 rows survive. And all three append-only
         triggers and all three partial indexes are gone, with no error anywhere.
     
     So the pragma protects your children and does nothing whatever for your
     triggers, and a table rebuild is the one operation that removes an
     append-only guarantee without raising anything. */
  NS.auditNaive = function (bytes, fkMode, opts) {
    opts = opts || {};
    var db = E.openBytes(bytes);
    var spec = NS.naiveSpec('audit_entry');
    var out = { fk: fkMode, table: 'audit_entry' };

    out.rowsBefore = Number(firstCell(db, 'SELECT count(*) FROM audit_entry'));
    out.headBefore = String(firstCell(db, 'SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1'));
    out.triggersBefore = E.triggerNames(db);
    out.masterBefore = E.masterFor('audit_entry', db);

    // The guarantee, demonstrated to be live BEFORE the rebuild touches it.
    out.updateBefore = attempt(db, "UPDATE audit_entry SET summary = 'x' WHERE seq = 0");
    out.deleteBefore = attempt(db, 'DELETE FROM audit_entry WHERE seq = 5');

    db.run('PRAGMA foreign_keys = ' + (fkMode === 'off' ? 'OFF' : 'ON'));
    out.pragmaReads = Number(firstCell(db, 'PRAGMA foreign_keys'));
    out.naive = NS.naiveRebuild('audit_entry', spec, { db: db });
    out.committed = out.naive.committed;

    if (!out.committed) {
      // A COMMIT that fails does not close the transaction. Proving that is part
      // of the finding, not an implementation detail.
      out.stillOpen = !attempt(db, 'BEGIN').ok;
      out.commitAgain = attempt(db, 'COMMIT');
      out.rowsMid = Number(firstCell(db, 'SELECT count(*) FROM audit_entry'));
      out.rollback = attempt(db, 'ROLLBACK');
      out.rowsAfter = Number(firstCell(db, 'SELECT count(*) FROM audit_entry'));
      out.triggersAfter = E.triggerNames(db);
      out.masterAfter = E.masterFor('audit_entry', db);
      out.headAfter = String(firstCell(db, 'SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1'));
    } else {
      out.rowsAfter = Number(firstCell(db, 'SELECT count(*) FROM audit_entry'));
      out.triggersAfter = E.triggerNames(db);
      out.masterAfter = E.masterFor('audit_entry', db);
      out.headAfter = String(firstCell(db, 'SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1'));
      out.fkCheckAfter = plainRows(rowsOf(db, 'PRAGMA foreign_key_check'), 8);
      // The guarantee, gone.
      out.updateAfter = attempt(db, "UPDATE audit_entry SET summary = 'tampered' WHERE seq = 0");
    }
    db.run('PRAGMA foreign_keys = ON');
    out.rowsKept = out.rowsAfter === out.rowsBefore;
    out.triggersLost = out.triggersBefore.length - out.triggersAfter.length;
    if (!opts.keepOpen) db.close();
    else out.db = db;
    return out;
  };

  function attempt(db, sql) {
    try { db.run(sql); return { sql: sql, ok: true, message: '' }; }
    catch (e) { return { sql: sql, ok: false, message: e.message }; }
  }
  NS.attempt = attempt;

  /* ================= the two fixes that look like fixes ================== */

  /* Both of these are what a migration author reaches for when the naive script
     starts failing, and both return OK while changing nothing. The pragma is a
     no-op inside a transaction — it does not error, it does not warn, and
     `PRAGMA foreign_keys` still reads 1. defer_foreign_keys defers CHECKS, and
     CASCADE is an ACTION, so deferring changes nothing about it. */
  NS.wrongFixes = function (bytes) {
    var out = [], i, wf, db, got;
    for (i = 0; i < S.WRONG_FIXES.length; i++) {
      wf = S.WRONG_FIXES[i];
      db = E.openBytes(bytes);
      var one = { id: wf.id, label: wf.label, statements: wf.statements, readBack: wf.readBack,
        expect: wf.expect, why: wf.why, steps: [] };
      var k;
      for (k = 0; k < wf.statements.length; k++) one.steps.push(attempt(db, wf.statements[k]));
      got = firstCell(db, wf.readBack);
      one.got = got === null ? null : Number(got);
      one.confirmed = one.got === wf.expect;
      if (wf.id === 'defer-fk') {
        one.addendumBefore = Number(firstCell(db, 'SELECT count(*) FROM addendum'));
        one.drop = attempt(db, 'DROP TABLE encounter');
        one.addendumAfter = Number(firstCell(db, 'SELECT count(*) FROM addendum'));
        /* The demo has to be carried all the way to COMMIT, or it teaches the
         * opposite of the truth. Deferring the checks really does let the DROP
         * through and really does fire the CASCADE — and then the deferred check
         * refuses the whole transaction, so nothing is written. A panel that
         * stops at the DROP leaves the reader believing defer_foreign_keys
         * destroys rows silently. It destroys them provisionally and cannot
         * commit them, which is a different and more useful fact. */
        one.commit = attempt(db, 'COMMIT');
      }
      try { db.run('ROLLBACK'); } catch (e) { /* nothing open */ }
      if (wf.id === 'defer-fk') {
        one.addendumRolledBack = Number(firstCell(db, 'SELECT count(*) FROM addendum'));
      }
      db.close();
      out.push(one);
    }
    return out;
  };

  /* ---------------------------------------------------- the defects card */

  NS.plantedDefects = function () { return S.PLANTED_DEFECTS; };

  root.ROMBAK_RUNNER = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
