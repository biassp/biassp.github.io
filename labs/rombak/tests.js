/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — tests.js
 * Assertions against a real SQLite database that this file builds from the seed
 * and walks from v1 to v9. The same file runs in the page (the badge in the
 * header) and under test/labs.test.js in headless Chromium.
 *
 * ONE RULE SHAPED THIS FILE, and it is the reason it is not four times longer:
 * no assertion here may have SQLite's own correctness as its subject. Inserting
 * three hundred rows and reading them back proves nothing about the author, and
 * rows are free — which makes it the easiest way in the world to manufacture
 * four digits in a database lab. Every property below is about THIS schema,
 * THIS migration ladder, or a capability boundary the lab's central claim rests
 * on. Where SQLite's behaviour is the subject (G4's delete actions, G11's ALTER
 * matrix) it is because the lab says "this needs a twelve-step rebuild" and that
 * sentence stops being true the day the boundary moves. Those groups are pins,
 * and they are supposed to go red and say so.
 *
 * Ranked by how much damage each one prevents:
 *
 *  1. THE CENSUS CONTRACT AT EVERY RUNG (G9). Every migration declares which
 *     tables it may touch; a firewall that shares no code with the runner counts
 *     and folds every row of every table before and after, and any undeclared
 *     movement is a failure. This is the property the whole lab exists for.
 *  2. ROLLBACK LEAVES NO TRACE (G8). Four rungs refuse. After each one the
 *     census — rows AND fold, table by table — equals the pre-migration value
 *     exactly. That is the property you actually care about at 2am.
 *  3. THE REBUILD THAT COMMITS AND DESTROYS (G10). Four databases from one
 *     export, differing by one word of a child's DDL or one empty child table.
 *     Two of them commit, return [] from foreign_key_check, and have deleted
 *     rows. A clean integrity check is not evidence of a correct migration.
 *  4. TWO INDEPENDENT ROUTES TO EVERY LIVE FIGURE (G15), one through SQLite's
 *     query planner and one through hand-written ES5 over raw rows, with three
 *     negatives proving the comparison can diverge.
 *  5. THE REFUSALS (G3-G7). Fifty-odd writes that must be refused, each pinned
 *     to the message SQLite actually gives, because "it refused" and "it refused
 *     for the reason I claimed" are different assertions and only the second
 *     catches a CHECK firing where a foreign key was meant to.
 *  6. THE AUDIT CHAIN (G14), including six canonical-JSON vectors frozen as
 *     literals so this lab and labs/rekam can be shown to agree.
 *  7. Everything else: the plans, ANALYZE, the ALTER boundary, the export round
 *     trip, determinism, and the fabrication of every identifier.
 *
 * COUNTING. `properties`, `executions` and `negatives` are computed at runtime
 * from the property registry this file builds while it runs. Nothing is typed.
 * A property is one claim; it may be executed once or once per table. A property
 * is NEGATIVE when it passes only because the engine or the schema refused
 * something. Both numbers go on the badge, separately, because a reader assumes
 * a headline count is distinct properties and the gap otherwise takes four
 * minutes with grep to find.
 */
(function (root) {
  'use strict';

  var D = root.ROMBAK_DOMAIN;
  var S = root.ROMBAK_SCHEMA;
  var P = root.ROMBAK_PLANS;
  var SEED = root.ROMBAK_SEED;
  var C = root.ROMBAK_CENSUS;
  var E = root.ROMBAK_ENGINE;
  var RN = root.ROMBAK_RUNNER;

  var groups = [];
  var props = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  /* ===================== the assertion context ========================= */

  /* JSON.stringify on a structure holding a back-reference throws, so an
     assertion helper that builds its failure message eagerly can crash on a
     PASSING comparison. Messages are built lazily and the stringify is guarded —
     the bug labs/buku/tests.js already paid for once. */
  function js(v) {
    try { return JSON.stringify(v); }
    catch (e) { return '[an object with a cyclic reference]'; }
  }

  function makeCtx(results, groupName) {
    var cur = null;
    /* `from` is the index of this property's first result. Results are pushed in
       order and never re-ordered, so a property owns the contiguous run
       results[from .. from + executions - 1] — which is how the Tests tab can
       nest cases under the claim they belong to without this file having to
       duplicate the claim into every result. */
    function open(name, negative) {
      cur = { group: groupName, name: String(name), negative: !!negative, executions: 0, from: results.length };
      props.push(cur);
      return cur;
    }
    function record(ok, name, msg) {
      if (!cur) open(name || 'unnamed property', false);
      cur.executions++;
      results.push({
        group: groupName,
        name: String(name || cur.name),
        ok: !!ok,
        message: ok ? '' : String(typeof msg === 'function' ? msg() : (msg || ''))
      });
    }
    var t = {
      /* Opens a property. Every assertion after it belongs to it, however many
         tables it walks. Forgetting to call this does not silently merge two
         claims into one: G0 fails if any property recorded no execution, and the
         group's own property count is what the page prints. */
      prop: function (name, negative) { open(name, negative); return t; },
      neg: function (name) { open(name, true); return t; },
      ok: function (v, name) { record(!!v, name, function () { return 'expected something truthy, got ' + js(v); }); },
      notOk: function (v, name) { record(!v, name, function () { return 'expected something falsy, got ' + js(v); }); },
      eq: function (a, b, name) { record(a === b, name, function () { return 'expected ' + js(b) + ', got ' + js(a); }); },
      ne: function (a, b, name) { record(a !== b, name, function () { return 'expected anything but ' + js(b); }); },
      lt: function (a, b, name) { record(a < b, name, function () { return 'expected < ' + js(b) + ', got ' + js(a); }); },
      lte: function (a, b, name) { record(a <= b, name, function () { return 'expected <= ' + js(b) + ', got ' + js(a); }); },
      gt: function (a, b, name) { record(a > b, name, function () { return 'expected > ' + js(b) + ', got ' + js(a); }); },
      gte: function (a, b, name) { record(a >= b, name, function () { return 'expected >= ' + js(b) + ', got ' + js(a); }); },
      deep: function (a, b, name) {
        record(js(a) === js(b), name, function () { return 'expected ' + js(b) + ', got ' + js(a); });
      },
      match: function (s, re, name) {
        record(re.test(String(s)), name, function () { return 'expected ' + re + ' to match ' + js(String(s)); });
      },
      throws: function (fn, name) {
        var threw = false, msg = '';
        try { fn(); } catch (e) { threw = true; msg = String(e && e.message || e); }
        record(threw, name, 'expected it to be refused; it was accepted');
        return msg;
      },
      /* The mandatory one. "It refused" and "it refused for the reason I
         claimed" are different assertions and most of this suite's negatives
         need the second: a CHECK firing where a foreign key was meant to is a
         green test asserting the opposite of the truth. */
      throwsWith: function (fn, re, name) {
        var threw = false, msg = '';
        try { fn(); } catch (e) { threw = true; msg = String(e && e.message || e); }
        record(threw && re.test(msg), name, threw
          ? function () { return 'it was refused, but not for the stated reason. expected ' + re + ', got: ' + msg; }
          : 'expected it to be refused; it was accepted');
        return msg;
      },
      noThrow: function (fn, name) {
        var msg = null;
        try { fn(); } catch (e) { msg = String(e && e.stack || e); }
        record(msg === null, name, function () { return 'it threw: ' + msg; });
      }
    };
    return t;
  }

  /* ========================= plumbing ================================== */

  /* A handle of our own. E.fresh() would install it as the page's live database
     and the suite must not touch what the visitor is looking at — "Run again"
     from the Tests tab would silently swap the Console's database out from under
     them. Nothing in this file calls E.fresh(), E.use() or RN.boot(). */
  function newDb() {
    var db = new (E.SQL().Database)();
    db.run('PRAGMA foreign_keys = ON');
    return db;
  }

  /* MEASURED IN THIS BUILD RUN, and it is the sharpest edge in the whole engine:
     sql.js's export() frees every prepared statement, calls sqlite3_close_v2 and
     REOPENS the file. The handle survives; the CONNECTION does not, and
     `PRAGMA foreign_keys` is per connection, so it silently reverts to 0. Every
     caller that keeps using a database after exporting it has to set it again.
     G16 asserts this rather than leaving it as folklore. */
  function exportAndKeepFk(db) {
    var bytes = E.exportBytes(db);
    db.run('PRAGMA foreign_keys = ON');
    return bytes;
  }

  function first(sql, db) { return E.first(sql, db); }
  function rows(sql, db) { return E.rows(sql, db); }
  function cell(sql, db) { var r = rows(sql, db); return r.length ? r[0][0] : null; }

  /* Every write probe runs inside a savepoint that is always rolled back, so the
     database the next group asserts against is the one this group found. G0
     checks that claim on the way out by re-fingerprinting it. */
  function probe(db, sql) {
    var msg = null;
    db.run('SAVEPOINT probe');
    try { db.run(sql); }
    catch (e) { msg = e.message; }
    try { db.run('ROLLBACK TO probe'); db.run('RELEASE probe'); }
    catch (e2) { msg = (msg || '') + ' [savepoint cleanup failed: ' + e2.message + ']'; }
    return msg;
  }
  function writer(db, sql) {
    return function () {
      var m = probe(db, sql);
      if (m !== null) throw new Error(m);
    };
  }
  function attempt(db, sql) {
    try { db.run(sql); return null; } catch (e) { return e.message; }
  }

  function stepOf(report, label) {
    var i;
    for (i = 0; i < report.steps.length; i++) if (report.steps[i].label === label) return report.steps[i];
    return null;
  }
  function rungOf(reports, v) {
    var i, last = null;
    for (i = 0; i < reports.length; i++) if (reports[i].version === v) last = reports[i];
    return last;
  }
  function firstRungOf(reports, v) {
    var i;
    for (i = 0; i < reports.length; i++) if (reports[i].version === v) return reports[i];
    return null;
  }

  /* DDL text parsing. It exists so G2 has a route to the schema that is NOT the
     pragma it is checking: one side reads the CREATE TABLE text schema.js ships,
     the other asks the database. Two routes, or it is one statement agreeing
     with itself. */
  function stripComments(ddl) { return String(ddl).replace(/--[^\n]*/g, ''); }
  function ddlBody(ddl, table) {
    var s = stripComments(ddl);
    var at = s.indexOf('CREATE TABLE ' + table + ' (');
    if (at < 0) at = s.indexOf('CREATE TABLE ' + table + '(');
    if (at < 0) return null;
    var open = s.indexOf('(', at), depth = 0, i;
    for (i = open; i < s.length; i++) {
      if (s.charAt(i) === '(') depth++;
      else if (s.charAt(i) === ')') { depth--; if (depth === 0) return s.slice(open + 1, i); }
    }
    return null;
  }
  function topLevelParts(body) {
    var parts = [], cur = '', depth = 0, i, ch;
    for (i = 0; i < body.length; i++) {
      ch = body.charAt(i);
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts;
  }
  function trim(s) { return String(s).replace(/^[\s\n]+|[\s\n]+$/g, ''); }
  function ddlColumns(ddl, table) {
    var body = ddlBody(ddl, table);
    if (body === null) return null;
    var parts = topLevelParts(body), out = [], i, line, tok;
    for (i = 0; i < parts.length; i++) {
      line = trim(parts[i]);
      if (!line) continue;
      tok = line.split(/[\s\n]+/)[0];
      if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(tok)) continue;
      out.push(tok);
    }
    return out;
  }

  function planDetails(sql, params, db) {
    var p = E.plan(sql, params, db), out = [], i;
    for (i = 0; i < p.length; i++) out.push(p[i].detail);
    return out;
  }
  /* A fold over an ORDERED result set. An index scan and a table scan return the
     same rows in a different order, and four of the fourteen plan entries
     reported a false divergence before the ORDER BY was appended to both sides
     (and to neither side of the plan assertion). */
  function foldRows(sql, params, db) {
    var all = E.all(sql, params, db), h = 0, i;
    for (i = 0; i < all.length; i++) {
      h = (((h * 31) >>> 0) + D.fnv1a(D.canonical(all[i]))) >>> 0;
    }
    return { n: all.length, h: h };
  }

  /* ================== the databases every group shares ================== */

  /* Built once per page load, not once per run: G3-G7 probe inside savepoints
     that are always rolled back, so a second run asserts against the same
     bytes. The two ladder walks are the expensive half of this file (ten
     censuses and eight rungs each) and rebuilding them for a "Run again" click
     would buy nothing. */
  var FX = null;
  function fx() {
    if (FX) return FX;
    var t0 = E.now();

    var db = new (E.SQL().Database)();
    var virginFk = Number(first('PRAGMA foreign_keys', db));   // read BEFORE setting it
    db.run('PRAGMA foreign_keys = ON');
    var v1 = RN.applyOne(1, { db: db, census: false });
    if (!v1.ok) throw new Error('rombak/tests: v1 did not apply: ' + v1.error);
    var seed = SEED.build({});
    RN.seedInto(db, seed);
    var base = exportAndKeepFk(db);
    var seeded = C.take(db.exec.bind(db));
    var walk = RN.replayTo(9, { db: db, before: seeded });
    if (!walk.ok) throw new Error('rombak/tests: the ladder did not reach v9');
    var v9bytes = exportAndKeepFk(db);

    /* v6 is where §0.1's four variants and §0.2's audit rebuild live. It is a
       second walk over the same base bytes with the censuses off, because none
       of those four panels reads one. */
    var d6 = E.openBytes(base);
    RN.replayTo(6, { db: d6, census: false });
    var v6bytes = E.exportBytes(d6);
    d6.close();

    var fp = RN.fingerprint({ db: db });    // fingerprint() exports, so it too
    db.run('PRAGMA foreign_keys = ON');     // drops the pragma on the way out
    FX = {
      db: db, base: base, seed: seed, walk: walk, reports: walk.reports,
      seededCensus: seeded, v9bytes: v9bytes, v6bytes: v6bytes,
      virginFk: virginFk, v1: v1,
      fingerprint: fp,
      ms: Math.round(E.now() - t0)
    };
    return FX;
  }

  /* The determinism twin: a SECOND database built from the seed and walked the
     whole way, independently. Not a copy of the first one's bytes — a copy would
     assert that memcpy works. */
  var TWIN = null;
  function twin() {
    if (TWIN) return TWIN;
    var db = newDb();
    RN.applyOne(1, { db: db, census: false });
    var seed = SEED.build({});
    RN.seedInto(db, seed);
    RN.replayTo(9, { db: db, census: false });
    TWIN = { db: db, seed: seed, fingerprint: RN.fingerprint({ db: db }),
      census: C.take(db.exec.bind(db)) };
    return TWIN;
  }

  /* ====================================================== G1 =========== */

  group('G1 boot, pragmas and build capability', function (t) {
    var f = fx();

    t.prop('PRAGMA foreign_keys reads 0 on a database this lab has not touched');
    t.eq(f.virginFk, 0, 'a brand-new SQL.Database reports foreign_keys = 0');
    var v = newDb();
    t.prop('and 1 once the lab sets it, outside every transaction');
    t.eq(Number(first('PRAGMA foreign_keys', v)), 1, 'PRAGMA foreign_keys = ON takes effect');

    t.prop('the engine recorded the same 0 to 1 transition at boot');
    var br = E.bootReport();
    t.eq(br.fkBefore, 0, 'bootReport().fkBefore is 0');
    t.eq(br.fkAfter, 1, 'bootReport().fkAfter is 1');

    t.prop('the build is the pinned one');
    t.eq(String(first('SELECT sqlite_version()', v)), '3.49.1', 'sqlite_version() is 3.49.1');

    /* The one property in this file that is about the CI job rather than the
       database. test/labs.test.js computes ok = failed === 0 && noise === 0, so
       one Emscripten line on any path fails the build with every assertion
       green. It holds because engine.js hands initSqlJs its own print/printErr
       and takes the wasmBinary path; there is no fallback to fall back to. */
    t.prop('sql.js printed nothing at boot — the CI job fails on one console line');
    t.eq(E.noiseCount(), 0, 'ROMBAK_ENGINE.noise() is empty');
    t.eq(br.wasmBytes, 658410, 'the decoded wasm is the vendored 658,410 bytes');
    t.eq(br.b64Length, 877880, 'the base64 payload is 877,880 chars');

    var i, b;
    for (i = 0; i < P.BUILD_LIMITS.length; i++) {
      b = P.BUILD_LIMITS[i];
      t.neg('the build has no ' + b.id + ', and the module says so itself');
      t.throwsWith(function (sql) { return function () { v.run(sql); }; }(b.probe),
        new RegExp(b.expect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        b.id + ': ' + b.expect);
    }

    /* The only place in the lab where parameterisation is simply unavailable.
       runner.js interpolates Number(v) and the page says so rather than hiding
       it, which is only honest if the claim is checked. */
    t.neg('PRAGMA user_version = ? is a syntax error, at prepare and at run');
    t.throwsWith(function () { v.run('PRAGMA user_version = ?'); },
      /near "\?": syntax error/, 'running it is a syntax error');
    t.throwsWith(function () { var st = v.prepare('PRAGMA user_version = ?'); st.free(); },
      /near "\?": syntax error/, 'preparing it is a syntax error too');

    t.prop('the interpolated form works and reads back');
    t.eq(RN.setUserVersion(7, { db: v }), 7, 'PRAGMA user_version = 7 reads back 7');
    v.close();
  });

  /* ====================================================== G2 =========== */

  group('G2 the schema describes itself', function (t) {
    var db = fx().db;
    var names = Object.keys(S.TABLE_DDL), i, k;

    t.prop('every table schema.js declares exists in the database');
    for (i = 0; i < names.length; i++) {
      t.eq(Number(cell("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='" + names[i] + "'", db)),
        1, names[i] + ' exists');
    }

    t.prop('and the database holds no table schema.js does not declare');
    var live = E.tableList(db);
    for (i = 0; i < live.length; i++) {
      t.ok(names.indexOf(live[i]) >= 0, live[i] + ' is declared in schema.js');
    }
    t.eq(live.length, names.length, 'the two inventories are the same size');

    /* pragma_table_XINFO, not table_info: table_info omits generated columns, so
       a walk built on it reports bill_line.amount_rp and visit.doctor_role
       missing while SELECT * returns them both. hidden = 1 is a virtual table's
       hidden column, which SELECT * would not return; 2 and 3 are VIRTUAL and
       STORED generated columns, which it would. */
    t.prop('every column in the shipped DDL exists, and no column exists that the DDL does not name');
    var totalColumns = 0;
    for (i = 0; i < names.length; i++) {
      var want = ddlColumns(S.TABLE_DDL[names[i]], names[i]);
      var got = [], rr = rows("SELECT name FROM pragma_table_xinfo('" + names[i] + "') WHERE hidden <> 1", db);
      for (k = 0; k < rr.length; k++) got.push(String(rr[k][0]));
      t.ok(want !== null, 'the CREATE TABLE header for ' + names[i] + ' parses');
      if (want === null) continue;
      totalColumns += want.length;
      t.deep(got.slice(0).sort(), want.slice(0).sort(), names[i] + ' has exactly its declared columns');
    }
    t.gte(totalColumns, 180, 'the walk covered every column in the schema, not a handful');

    t.prop('every REFERENCES clause in the DDL is a foreign key the database reports');
    for (i = 0; i < names.length; i++) {
      var body = ddlBody(S.TABLE_DDL[names[i]], names[i]) || '';
      var declared = 0, re = /REFERENCES\s+([A-Za-z_0-9]+)\s*\(/g;
      while (re.exec(body)) declared++;
      var reported = Number(cell("SELECT count(DISTINCT id) FROM pragma_foreign_key_list('" + names[i] + "')", db) || 0);
      t.eq(reported, declared, names[i] + ' declares ' + declared + ' foreign keys');
    }

    /* The machine-checkable form of the rule the whole visit table is shaped
       around: a queue number is unique only inside its day and poli and is
       reused tomorrow, so nothing clinical may reference it. An absence is only
       a rule if something checks it. */
    t.prop('no foreign key anywhere in the schema targets a queue number');
    t.deep(rows('SELECT m.name, f."table", f."to" FROM sqlite_master m ' +
      'JOIN pragma_foreign_key_list(m.name) f WHERE m.type = \'table\' ' +
      'AND (f."to" LIKE \'%queue_no%\' OR f."to" LIKE \'%queue_seq%\')', db),
      [], 'pragma_foreign_key_list mentions no queue column as a target');

    t.prop('every index schema.js declares exists on the table it names');
    var ixNames = Object.keys(S.INDEX_DDL);
    for (i = 0; i < ixNames.length; i++) {
      var m = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(\S+)\s+ON\s+([A-Za-z_0-9]+)/.exec(stripComments(S.INDEX_DDL[ixNames[i]]));
      t.eq(Number(cell("SELECT count(*) FROM pragma_index_list('" + m[2] + "') WHERE name='" + ixNames[i] + "'", db) || 0),
        1, ixNames[i] + ' is reported on ' + m[2]);
    }
    t.prop('and the database holds no named index the DDL does not declare');
    var liveIx = E.indexNames(db);
    for (i = 0; i < liveIx.length; i++) t.ok(ixNames.indexOf(liveIx[i]) >= 0, liveIx[i] + ' is declared');
    t.eq(liveIx.length, ixNames.length, liveIx.length + ' named indexes, and that is the declared number');

    /* A partial index reported as non-partial would mean the census's plan gate
       is accepting a route that reads only the predicate's rows. */
    t.prop('every index declared with a WHERE clause is reported partial, and no other is');
    for (i = 0; i < ixNames.length; i++) {
      var ddl = stripComments(S.INDEX_DDL[ixNames[i]]);
      var mm = /ON\s+([A-Za-z_0-9]+)/.exec(ddl);
      var partial = /\bWHERE\b/.test(ddl) ? 1 : 0;
      t.eq(Number(cell("SELECT partial FROM pragma_index_list('" + mm[1] + "') WHERE name='" + ixNames[i] + "'", db)),
        partial, ixNames[i] + (partial ? ' is partial' : ' is not partial'));
    }

    /* WITHOUT ROWID is on the small tables whose text primary key IS the access
       path, so SQLite does not build a second b-tree to reach three rows. The
       checkable form of that is: the primary key costs no auto-index, and the
       only auto-indexes such a table carries are its SECONDARY unique
       constraints — poli(prefix) and acuity(rank) each have exactly one. */
    t.prop('a WITHOUT ROWID table\'s primary key costs no auto-index — only its other UNIQUE clauses do');
    var wr = [];
    for (i = 0; i < names.length; i++) if (/WITHOUT ROWID/.test(S.TABLE_DDL[names[i]])) wr.push(names[i]);
    t.gte(wr.length, 20, wr.length + ' tables are WITHOUT ROWID');
    for (i = 0; i < wr.length; i++) {
      var bodyU = ddlBody(S.TABLE_DDL[wr[i]], wr[i]) || '';
      var uniques = bodyU.match(/\bUNIQUE\b/g);
      t.eq(Number(cell("SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='" + wr[i] +
        "' AND name LIKE 'sqlite_autoindex%'", db)), uniques ? uniques.length : 0,
        wr[i] + ' carries ' + (uniques ? uniques.length : 0) + ' auto-index(es), one per secondary UNIQUE');
    }
    /* The contrast that makes the choice legible: patient is a rowid table with
       a TEXT primary key, so it pays for a second b-tree on rm_number that a
       WITHOUT ROWID table would not — one auto-index for the key, one for its
       UNIQUE on rm_seq. It is a rowid table because it is not small. */
    t.prop('a rowid table with a text primary key pays for one, which is the trade being made');
    var patientUniques = (ddlBody(S.TABLE_DDL.patient, 'patient') || '').match(/\bUNIQUE\b/g);
    t.eq(Number(cell("SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='patient' " +
      "AND name LIKE 'sqlite_autoindex%'", db)), 1 + patientUniques.length,
      'patient carries an auto-index for rm_number and one for each UNIQUE');

    t.prop('every table is STRICT — a declared type is otherwise a comment');
    t.deep(rows("SELECT count(*), sum(strict) FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%'", db),
      [[names.length, names.length]], 'pragma_table_list reports strict = 1 on all ' + names.length);

    t.prop('the three append-only triggers exist and are attached to audit_entry');
    t.deep(E.triggerNames(db), Object.keys(S.TRIGGER_DDL).slice(0).sort(), 'the trigger names match schema.js');
    t.deep(rows("SELECT DISTINCT tbl_name FROM sqlite_master WHERE type='trigger'", db),
      [['audit_entry']], 'all three are on audit_entry');

    t.prop('the version the pragma reports is the version the log records');
    t.eq(RN.userVersion({ db: db }), S.TARGET_VERSION, 'PRAGMA user_version is ' + S.TARGET_VERSION);
    t.eq(RN.loggedVersion({ db: db }), S.TARGET_VERSION, 'max(schema_migration.version) agrees');
  });

  /* ====================================================== G3 =========== */

  group('G3 foreign keys refuse and permit', function (t) {
    var db = fx().db;
    var FK = /FOREIGN KEY constraint failed/;

    /* Eight orphaning writes and eight matching valid ones. Every id comes from
       a subquery against the fixture rather than being typed here: a generated
       identifier in this file would be a number the suite pins and the seed is
       free to move. */
    var orphans = [
      ['a visit naming a patient that does not exist',
        "INSERT INTO visit (id,rm_number,visit_date,poli_id,klass,status,queue_no,queue_seq,complaint,opened_at,opened_by) " +
        "SELECT 'V-'||replace(visit_date,'-','')||'-9801','RM-999999',visit_date,poli_id,klass,'menunggu-triase','Z801',9801,'x',opened_at,'stf-05' FROM visit LIMIT 1"],
      ['an encounter naming a visit that does not exist',
        "INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,created_at) " +
        "VALUES ('E-20260909-9801','V-20260909-9999','RM-000001','stf-01','draft','2026-09-09T08:00:00')"],
      ['a coded diagnosis naming an ICD-10 code that does not exist',
        "INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) SELECT id,'ZZ9.9',0 FROM encounter LIMIT 1"],
      ['a bill line with no bill',
        "INSERT INTO bill_line (visit_id,line_no,label,grp,qty,unit_rp,covered,payer) " +
        "VALUES ('V-20260909-9999',1,'x','jasa',1,1000,0,'pasien')"],
      ['an allergy naming a class that does not exist — the misspelling the IndexedDB version swallows',
        "INSERT INTO patient_allergy (rm_number,class_id) SELECT rm_number,'penicillin' FROM patient LIMIT 1"],
      ['a tindakan on a visit naming a tariff row that does not exist',
        "INSERT INTO visit_tindakan (visit_id,tindakan_id) SELECT id,'tnd-99' FROM visit LIMIT 1"],
      ['a triage row naming an acuity that does not exist',
        "INSERT INTO triage (visit_id,suhu_dc,acuity_id,by_staff,at) " +
        "SELECT v.id,376,'ungu','stf-04','2026-09-09T08:00:00' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM triage) LIMIT 1"],
      ['an audit row naming a patient that does not exist',
        "INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_patient,prev_hash,hash) " +
        "SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','patient.create','x','{}','patient','RM-999999'," +
        "(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry"]
    ];
    var i;
    for (i = 0; i < orphans.length; i++) {
      t.neg('the database refuses ' + orphans[i][0]);
      t.throwsWith(writer(db, orphans[i][1]), FK, orphans[i][0]);
    }

    var valid = [
      ['a visit on a patient that exists',
        "INSERT INTO visit (id,rm_number,visit_date,poli_id,klass,status,queue_no,queue_seq,complaint,opened_at,opened_by) " +
        "SELECT 'V-'||replace(visit_date,'-','')||'-9802',rm_number,visit_date,poli_id,klass,'menunggu-triase','Z802',9802,'x',opened_at,'stf-05' FROM visit LIMIT 1"],
      ['an encounter on a visit that has none',
        "INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,created_at) " +
        "SELECT 'E-20260909-9802',v.id,v.rm_number,'stf-01','draft','2026-09-09T08:00:00' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM encounter) LIMIT 1"],
      ['a further secondary diagnosis with a known code',
        "INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) SELECT encounter_id,'Z00.0',0 FROM encounter_diagnosis WHERE is_primary=1 LIMIT 1"],
      ['a bill line on a bill that exists',
        "INSERT INTO bill_line (visit_id,line_no,label,grp,qty,unit_rp,covered,payer) SELECT visit_id,9001,'x','jasa',1,1000,0,'pasien' FROM bill LIMIT 1"],
      ['an allergy naming a class that exists',
        "INSERT INTO patient_allergy (rm_number,class_id) SELECT rm_number,'lateks' FROM patient WHERE rm_number NOT IN (SELECT rm_number FROM patient_allergy WHERE class_id='lateks') LIMIT 1"],
      ['a tindakan naming a tariff row that exists',
        "INSERT INTO visit_tindakan (visit_id,tindakan_id) SELECT v.id,'tnd-06' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM visit_tindakan WHERE tindakan_id='tnd-06') LIMIT 1"],
      ['a triage row naming an acuity that exists',
        "INSERT INTO triage (visit_id,suhu_dc,acuity_id,by_staff,at) " +
        "SELECT v.id,376,'hijau','stf-04','2026-09-09T08:00:00' FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM triage) LIMIT 1"],
      ['an audit row naming a patient that exists',
        "INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_patient,prev_hash,hash) " +
        "SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','patient.create','x','{}','patient',(SELECT rm_number FROM patient LIMIT 1)," +
        "(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry"]
    ];
    for (i = 0; i < valid.length; i++) {
      t.prop('and accepts ' + valid[i][0]);
      t.noThrow(writer(db, valid[i][1]), valid[i][0]);
    }

    /* The composite FK on (doctor_id, doctor_role) is the role restriction, and
       doctor_role is a VIRTUAL generated column pinned to the literal 'dokter'.
       It closes the deadlock the IndexedDB version has: a dangling doctor id
       passes its guard, produces an encounter whose doctor names nobody, and the
       note can then never be signed by anyone at all. */
    function visitWithDoctor(who, seq) {
      return "INSERT INTO visit (id,rm_number,visit_date,poli_id,klass,status,queue_no,queue_seq,complaint,doctor_id,opened_at,opened_by) " +
        "SELECT 'V-'||replace(visit_date,'-','')||'-98" + seq + "',rm_number,visit_date,poli_id,klass,'menunggu-triase','Z8" + seq +
        "',98" + seq + ",'x'," + (who === null ? 'NULL' : "'" + who + "'") + ",opened_at,'stf-05' FROM visit LIMIT 1";
    }
    t.prop('the composite (doctor_id, doctor_role) accepts a dokter');
    t.noThrow(writer(db, visitWithDoctor('stf-01', '03')), 'stf-01 is a dokter');
    t.neg('and refuses a perawat, by foreign key rather than by application code');
    t.throwsWith(writer(db, visitWithDoctor('stf-04', '04')), FK, 'stf-04 is a perawat');
    t.neg('and refuses an apoteker — the exact row v5 refused to migrate');
    t.throwsWith(writer(db, visitWithDoctor('stf-06', '05')), FK, 'stf-06 is an apoteker');
    t.prop('and accepts NULL, because a visit before triage has no doctor yet');
    t.noThrow(writer(db, visitWithDoctor(null, '06')), 'doctor_id NULL is accepted');

    t.prop('per-path role authority is a composite foreign key: o.vitals is amendable by a perawat');
    t.noThrow(writer(db, "INSERT INTO addendum (id,seq,encounter_id,path,new_value,reason,by_staff,by_role,at) " +
      "SELECT 'ADD-9801',9801,id,'o.vitals','{\"suhu_dc\":380}','koreksi','stf-04','perawat','2026-09-09T08:00:00' FROM encounter LIMIT 1"),
      'o.vitals by a perawat is accepted');
    t.neg('and the subjective is not');
    t.throwsWith(writer(db, "INSERT INTO addendum (id,seq,encounter_id,path,new_value,reason,by_staff,by_role,at) " +
      "SELECT 'ADD-9802',9802,id,'s','{\"a\":1}','koreksi','stf-04','perawat','2026-09-09T08:00:00' FROM encounter LIMIT 1"),
      FK, 'path s by a perawat is refused');

    t.neg('a visit on a (date, poli) with no queue counter row is refused');
    t.throwsWith(writer(db, "INSERT INTO visit (id,rm_number,visit_date,poli_id,klass,status,queue_no,queue_seq,complaint,opened_at,opened_by) " +
      "SELECT 'V-20991231-9807',rm_number,'2099-12-31',poli_id,klass,'menunggu-triase','Z807',9807,'x',opened_at,'stf-05' FROM visit LIMIT 1"),
      FK, 'the composite FK to queue_counter(visit_date, poli_id) fires');

    /* PRAGMA foreign_key_check's OWN NEGATIVE CONTROL, and it is load-bearing
       twice over. Every use of it in this suite and on three of the page's panels
       asserts that it returned `[]` — including §0.1's whole lesson, which is that
       it returns `[]` about a database the naive rebuild has just emptied. MEASURED
       IN THIS BUILD RUN: `NS.foreignKeyCheck = function () { return []; }` and the
       suite stayed green at 1004 of 1004, with "foreign_key_check returned []"
       still printed under every rung and under every variant. An empty answer from
       a check that reports success by being empty is indistinguishable from a
       check that has stopped looking, so here it is made to look at an orphan. */
    t.neg('foreign_key_check names a real orphan, which is what makes its silence elsewhere worth printing');
    var fkdb = E.openBytes(fx().v9bytes);
    t.deep(E.foreignKeyCheck(fkdb), [], 'it is empty on the finished database');
    fkdb.run('PRAGMA foreign_keys = OFF');
    fkdb.run("INSERT INTO bill_line (visit_id,line_no,label,grp,qty,unit_rp,covered,payer) " +
      "VALUES ('V-19000101-0001',1,'orphan','jasa',1,1000,0,'pasien')");
    var orphans = E.foreignKeyCheck(fkdb);
    t.eq(orphans.length, 1, 'with the pragma off the row goes in, and the check finds exactly one violation');
    t.eq(String((orphans[0] || [])[0]), 'bill_line', 'it names the child table');
    t.eq(String((orphans[0] || [])[2]), 'bill', 'and the parent it does not reach');
    fkdb.run("DELETE FROM bill_line WHERE visit_id = 'V-19000101-0001'");
    t.deep(E.foreignKeyCheck(fkdb), [], 'and it is empty again once the orphan is gone');
    fkdb.close();
  });

  /* ====================================================== G4 =========== */

  group('G4 delete actions', function (t) {
    var db = fx().db;
    var FK = /FOREIGN KEY constraint failed/;

    /* A brand-new encounter, so no audit row references it: audit_entry.
       ent_encounter is ON DELETE RESTRICT and would otherwise refuse the delete
       before the CASCADE under test ever ran. */
    db.run('SAVEPOINT g4');
    var vid = String(first("SELECT id FROM visit WHERE id NOT IN (SELECT visit_id FROM encounter) LIMIT 1", db));
    var rm = String(first("SELECT rm_number FROM visit WHERE id='" + vid + "'", db));
    db.run("INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,created_at) VALUES " +
      "('E-20260909-9901','" + vid + "','" + rm + "','stf-01','draft','2026-09-09T08:00:00')");
    db.run("INSERT INTO addendum (id,seq,encounter_id,path,new_value,reason,by_staff,by_role,at) VALUES " +
      "('ADD-9901',9901,'E-20260909-9901','s','{\"a\":1}','koreksi','stf-01','dokter','2026-09-09T08:00:00')");

    t.prop('ON DELETE CASCADE takes the children with it');
    t.eq(Number(first("SELECT count(*) FROM addendum WHERE encounter_id='E-20260909-9901'", db)), 1, 'one addendum exists');
    t.eq(attempt(db, "DELETE FROM encounter WHERE id='E-20260909-9901'"), null, 'the encounter deletes');
    t.eq(Number(first("SELECT count(*) FROM addendum WHERE encounter_id='E-20260909-9901'", db)), 0, 'its addendum went with it');

    db.run("INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,created_at) VALUES " +
      "('E-20260909-9902','" + vid + "','" + rm + "','stf-01','draft','2026-09-09T08:00:00')");
    db.run("INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) VALUES ('E-20260909-9902','Z00.0',1)");
    t.neg('ON DELETE RESTRICT blocks the parent delete instead');
    t.throwsWith(function () { var m = attempt(db, "DELETE FROM encounter WHERE id='E-20260909-9902'"); if (m) throw new Error(m); },
      FK, 'a coded diagnosis is a reportable fact and holds its encounter down');
    db.run('ROLLBACK TO g4'); db.run('RELEASE g4');

    /* NO ACTION versus RESTRICT completes the delete-action story the whole lab
       rests on, and the two are NOT interchangeable — they differ only under
       DEFERRABLE, which is exactly the case a migration author meets. */
    var d = newDb();
    d.run('CREATE TABLE p(id TEXT PRIMARY KEY) STRICT');
    d.run('CREATE TABLE c_na(id TEXT PRIMARY KEY, p TEXT REFERENCES p(id)) STRICT');
    d.run("INSERT INTO p VALUES ('a')");
    d.run("INSERT INTO c_na VALUES ('1','a')");
    t.neg('a bare REFERENCES (NO ACTION) refuses the parent delete immediately');
    t.throwsWith(function () { d.run("DELETE FROM p WHERE id='a'"); }, FK, 'NO ACTION behaves as RESTRICT here');
    d.run('DROP TABLE c_na');
    d.run('CREATE TABLE c_re(id TEXT PRIMARY KEY, p TEXT REFERENCES p(id) ON DELETE RESTRICT) STRICT');
    d.run("INSERT INTO c_re VALUES ('1','a')");
    t.neg('and RESTRICT refuses it with the identical message — immediately, they are the same rule');
    t.throwsWith(function () { d.run("DELETE FROM p WHERE id='a'"); }, FK, 'RESTRICT is indistinguishable at this point');
    d.close();

    function deferred(action) {
      var x = newDb();
      x.run('CREATE TABLE p(id TEXT PRIMARY KEY) STRICT');
      x.run('CREATE TABLE c(id TEXT PRIMARY KEY, p TEXT REFERENCES p(id)' + action + ' DEFERRABLE INITIALLY DEFERRED) STRICT');
      x.run("INSERT INTO p VALUES ('a')");
      x.run("INSERT INTO c VALUES ('1','a')");
      var msg = null;
      try {
        x.run('BEGIN');
        x.run("DELETE FROM p WHERE id='a'");
        x.run("INSERT INTO p VALUES ('a')");
        x.run('COMMIT');
      } catch (e) { msg = e.message; try { x.run('ROLLBACK'); } catch (e2) { /* nothing open */ } }
      x.close();
      return msg;
    }
    t.prop('DEFERRABLE NO ACTION permits delete-then-reinsert inside one transaction');
    t.eq(deferred(''), null, 'the transaction commits');
    t.neg('DEFERRABLE RESTRICT refuses at the DELETE — this is the only place the two differ');
    t.throwsWith(function () { var m = deferred(' ON DELETE RESTRICT'); if (m) throw new Error(m); },
      FK, 'RESTRICT is checked at the statement, not at COMMIT');

    /* At v6, where §0.1's panels live. At v9 the audit trail has a typed FK to
       encounter and refuses the DROP whatever the diagnosis table holds, which
       would hide the finding rather than demonstrate it. */
    var a = E.openBytes(fx().v6bytes);
    t.neg('a POPULATED RESTRICT child blocks DROP TABLE');
    t.throwsWith(function () { a.run('DROP TABLE encounter'); }, FK, 'DROP TABLE encounter is refused');
    a.close();
    var b = E.openBytes(fx().v6bytes);
    b.run('PRAGMA foreign_keys = OFF');
    b.run('DELETE FROM encounter_diagnosis');
    b.run('PRAGMA foreign_keys = ON');
    var addBefore = Number(first('SELECT count(*) FROM addendum', b));
    t.prop('an EMPTY RESTRICT child does not — and the CASCADE child pays for it');
    t.eq(attempt(b, 'DROP TABLE encounter'), null, 'the same statement now succeeds');
    t.eq(addBefore, 2, 'there were addenda before');
    t.eq(Number(first('SELECT count(*) FROM addendum', b)), 0, 'and none after');
    b.close();
  });

  /* ====================================================== G5 =========== */

  group('G5 unique and partial indexes', function (t) {
    var db = fx().db;

    t.neg('a second primary diagnosis on one encounter is refused on INSERT');
    t.throwsWith(writer(db, "INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) " +
      "SELECT encounter_id,'Z00.0',1 FROM encounter_diagnosis WHERE is_primary=1 LIMIT 1"),
      /UNIQUE constraint failed: encounter_diagnosis\.encounter_id/, 'ux_enc_primary fires on the insert');

    /* The hole the IndexedDB version still has: it guards the insert path and
       not the update path, so promoting a secondary code to primary produces two
       primaries. A partial unique index does not care which statement you used. */
    t.neg('and on the UPDATE that promotes a secondary one');
    t.throwsWith(writer(db, 'UPDATE encounter_diagnosis SET is_primary = 1 WHERE (encounter_id, icd_code) IN (' +
      'SELECT d.encounter_id, d.icd_code FROM encounter_diagnosis d ' +
      'JOIN encounter_diagnosis p ON p.encounter_id = d.encounter_id AND p.is_primary = 1 ' +
      'WHERE d.is_primary = 0 LIMIT 1)'),
      /UNIQUE constraint failed: encounter_diagnosis\.encounter_id/, 'the same index fires on the update');

    t.prop('the index constrains only the rows its predicate selects: further secondary codes are free');
    t.noThrow(writer(db, "INSERT INTO encounter_diagnosis (encounter_id,icd_code,is_primary) " +
      "SELECT encounter_id,'Z00.0',0 FROM encounter_diagnosis WHERE is_primary=1 LIMIT 1"),
      'a second is_primary = 0 row is accepted');

    t.neg('a second ACTIVE visit for one patient, day and poli is refused');
    t.throwsWith(writer(db, "INSERT INTO visit (id,rm_number,visit_date,poli_id,klass,status,queue_no,queue_seq,complaint,opened_at,opened_by) " +
      "SELECT 'V-'||replace(v.visit_date,'-','')||'-9807',v.rm_number,v.visit_date,v.poli_id,v.klass,'menunggu-triase','Z807',9807,'x',v.opened_at,'stf-05' " +
      "FROM visit v WHERE v.status NOT IN ('selesai','batal') LIMIT 1"),
      /UNIQUE constraint failed: visit\.rm_number, visit\.visit_date, visit\.poli_id/, 'ux_visit_active fires');

    /* Closing the visit is what releases the pair, and the release is the half
       that matters: a partial index that never lets go is an outage tomorrow
       morning. The second visit is inserted with the SAME (rm, date, poli) as
       the one just closed, which is the collision the index refused above. */
    function reopenAfter(newStatus, seq) {
      return "UPDATE visit SET status = '" + newStatus + "' WHERE id = (SELECT id FROM visit WHERE status NOT IN ('selesai','batal') ORDER BY id LIMIT 1); " +
        "INSERT INTO visit (id,rm_number,visit_date,poli_id,klass,status,queue_no,queue_seq,complaint,opened_at,opened_by) " +
        "SELECT 'V-'||replace(v.visit_date,'-','')||'-98" + seq + "',v.rm_number,v.visit_date,v.poli_id,v.klass,'menunggu-triase','Z8" + seq +
        "',98" + seq + ",'x',v.opened_at,'stf-05' FROM visit v WHERE v.status = '" + newStatus + "' AND v.id = " +
        "(SELECT id FROM visit WHERE status = '" + newStatus + "' ORDER BY id DESC LIMIT 1)";
    }
    t.prop('closing the first visit with selesai releases the pair');
    t.eq(probe(db, reopenAfter('selesai', '09')), null, 'the same patient, day and poli can open a new visit');
    t.prop('and so does cancelling it with batal');
    t.eq(probe(db, reopenAfter('batal', '10')), null, 'a cancelled visit leaves the index too');

    /* ux_staff_sip exists because two of the six staff rows have no practice
       licence at all, and a plain UNIQUE would have been a lie about clerks. */
    t.prop('a partial UNIQUE index permits any number of NULLs outside its predicate');
    t.eq(Number(first('SELECT count(*) FROM staff WHERE sip IS NULL', db)), 2, 'the fixture already has two');
    t.noThrow(writer(db, "INSERT INTO staff (id,name,role_id,title,sip) VALUES ('stf-99','X','perawat','P',NULL)"), 'a third is accepted');
    t.neg('and refuses a duplicate licence number');
    t.throwsWith(writer(db, "INSERT INTO staff (id,name,role_id,title,sip) VALUES ('stf-99','X','perawat','P','SIP-FIKTIF-0001')"),
      /UNIQUE constraint failed: staff\.sip/, 'ux_staff_sip fires on the value');

    /* The NULL-in-a-composite-UNIQUE hole, and the two fixes, on a scratch table
       so the shapes are visible in three lines instead of forty. */
    var d = newDb();
    d.run('CREATE TABLE t(a TEXT NOT NULL, b TEXT) STRICT');
    d.run("INSERT INTO t VALUES ('x', NULL)");
    t.prop('a plain UNIQUE column accepts unlimited NULLs');
    var u = newDb();
    u.run('CREATE TABLE u(a TEXT UNIQUE) STRICT');
    u.run('INSERT INTO u VALUES (NULL),(NULL),(NULL)');
    t.eq(Number(first('SELECT count(*) FROM u', u)), 3, 'three NULLs coexist under UNIQUE');
    u.close();

    d.run('CREATE UNIQUE INDEX ux_ab ON t(a, b)');
    t.prop('UNIQUE(a, b) with one NULL member enforces nothing at all');
    t.eq(attempt(d, "INSERT INTO t VALUES ('x', NULL)"), null, "a second ('x', NULL) is accepted");
    d.run("DELETE FROM t WHERE rowid > 1");
    t.neg('a partial unique index on the NULL case restores it');
    d.run('CREATE UNIQUE INDEX ux_a_null ON t(a) WHERE b IS NULL');
    t.throwsWith(function () { d.run("INSERT INTO t VALUES ('x', NULL)"); },
      /UNIQUE constraint failed: t\.a/, 'the partial index fires where the composite did not');
    d.run('DROP INDEX ux_a_null');
    t.neg('and so does an index on ifnull(b, \'\') — with different semantics, which is the point');
    d.run("CREATE UNIQUE INDEX ux_a_ifnull ON t(a, ifnull(b, ''))");
    t.throwsWith(function () { d.run("INSERT INTO t VALUES ('x', NULL)"); },
      /UNIQUE constraint failed/, "the expression index fires too");
    t.prop("but ifnull collapses NULL and the empty string, which the partial index does not");
    t.throws(function () { d.run("INSERT INTO t VALUES ('x', '')"); },
      "('x', '') now collides with ('x', NULL) — a different rule wearing the same clothes");
    d.close();
  });

  /* ====================================================== G6 =========== */

  group('G6 CHECK, NOT NULL and NULL semantics', function (t) {
    var db = fx().db;

    /* The reason every CHECK in this schema is paired with NOT NULL or written
       NULL-tolerantly. CHECK(a > 0) does not reject NULL: NULL > 0 is NULL, and
       only an explicit false rejects. */
    var d = newDb();
    d.run('CREATE TABLE ck(a INTEGER CHECK (a > 0)) STRICT');
    t.prop('CHECK (a > 0) accepts NULL — only an explicit false rejects');
    t.eq(attempt(d, 'INSERT INTO ck VALUES (NULL)'), null, 'the NULL row is stored');
    t.ne(attempt(d, 'INSERT INTO ck VALUES (0)'), null, 'and 0 is not');
    d.close();

    /* One property executed over every CHECK in the shipped DDL. A CHECK naming
       a column that is not NOT NULL, and not visibly NULL-tolerant, is a
       constraint with a hole in it. */
    t.prop('every CHECK in the schema is on a NOT NULL column or is explicitly NULL-tolerant');
    var names = Object.keys(S.TABLE_DDL), i, k, holes = [];
    for (i = 0; i < names.length; i++) {
      var body = ddlBody(S.TABLE_DDL[names[i]], names[i]) || '';
      var parts = topLevelParts(body);
      for (k = 0; k < parts.length; k++) {
        var line = trim(parts[k]);
        if (!line || !/\bCHECK\b/.test(line)) continue;
        var tok = line.split(/[\s\n]+/)[0];
        if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(tok)) continue;   // a table-level CHECK
        var nullTolerant = new RegExp(tok + '\\s+IS\\s+NULL').test(line) || /\bcoalesce\s*\(/i.test(line);
        var ok = /\bNOT\s+NULL\b/.test(line) || nullTolerant;
        if (!ok) holes.push(names[i] + '.' + tok);
        t.ok(ok, names[i] + '.' + tok + ' is guarded against NULL');
      }
    }
    t.deep(holes, [], 'no column-level CHECK in the schema can be sidestepped with NULL');

    var checks = [
      ['an audit row with zero entity columns set', true,
        "INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,prev_hash,hash) " +
        "SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','visit.open','x','{}','visit'," +
        "(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry",
        /CHECK constraint failed: \(ent_patient IS NOT NULL\)/],
      ['an audit row with two of them set', true,
        "INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_visit,ent_patient,prev_hash,hash) " +
        "SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','visit.open','x','{}','visit'," +
        "(SELECT id FROM visit LIMIT 1),(SELECT rm_number FROM patient LIMIT 1)," +
        "(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry",
        /CHECK constraint failed: \(ent_patient IS NOT NULL\)/],
      ['a bill whose parts no longer sum to its total', true,
        'UPDATE bill SET dibayar_pasien_rp = dibayar_pasien_rp + 5000 WHERE visit_id = (SELECT visit_id FROM bill LIMIT 1)',
        /CHECK constraint failed: total_tarif_rp = ditanggung_rp \+ ditanggung_lain_rp \+ dibayar_pasien_rp/],
      ['a pregnant male patient', true,
        "UPDATE patient SET pregnant = 1 WHERE rm_number = (SELECT rm_number FROM patient WHERE sex='L' LIMIT 1)",
        /CHECK constraint failed: pregnant = 0 OR sex = 'P'/],
      ['a NIK shaped like a real one', true,
        "UPDATE patient SET nik_demo = '3201011234567890' WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)",
        /CHECK constraint failed: nik_demo GLOB 'NIK-FIKTIF-\*'/],
      ['a patient row that claims not to be demo data', true,
        'UPDATE patient SET is_demo = 0 WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)',
        /CHECK constraint failed: is_demo = 1/],
      ['a patient with no name', true,
        'UPDATE patient SET name = NULL WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)',
        /NOT NULL constraint failed: patient\.name/],
      ['a date of birth after the row was created', true,
        "UPDATE patient SET dob = '2099-01-01' WHERE rm_number = (SELECT rm_number FROM patient LIMIT 1)",
        /CHECK constraint failed: dob <= created_at/],
      ['an empty triage form', true,
        "INSERT INTO triage (visit_id,acuity_id,by_staff,at) SELECT v.id,'hijau','stf-04','2026-09-09T08:00:00' " +
        "FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM triage) LIMIT 1",
        /CHECK constraint failed: coalesce\(td_sistol,nadi,suhu_dc,rr,spo2,bb_hg,tb_mm\) IS NOT NULL/],
      ['an addendum that changes nothing', true,
        "INSERT INTO addendum (id,seq,encounter_id,path,old_value,new_value,reason,by_staff,by_role,at) " +
        "SELECT 'ADD-9804',9804,id,'s','{\"a\":1}','{\"a\":1}','koreksi','stf-01','dokter','2026-09-09T08:00:00' FROM encounter LIMIT 1",
        /CHECK constraint failed: old_value IS NULL OR old_value <> new_value/],
      ['a note signed by somebody other than its author', true,
        "INSERT INTO encounter (id,visit_id,rm_number,doctor_id,status,s,created_at,signed_at,signed_by) " +
        "SELECT 'E-20260909-9805',v.id,v.rm_number,'stf-01','signed','x','2026-09-09T08:00:00','2026-09-09T09:00:00','stf-02' " +
        "FROM visit v WHERE v.id NOT IN (SELECT visit_id FROM encounter) LIMIT 1",
        /CHECK constraint failed: status = 'draft' OR signed_by = doctor_id/]
    ];
    for (i = 0; i < checks.length; i++) {
      t.neg('the database refuses ' + checks[i][0]);
      t.throwsWith(writer(db, checks[i][2]), checks[i][3], checks[i][0]);
    }

    /* Two of the negatives above refuse for the WRONG reason unless the
       statement is sharpened, and a bare `throws` would have called both green.
       Kept as its own property because it is the argument for throwsWith. */
    t.neg('a re-used medical-record number is refused by the UNIQUE on rm_seq when rm_seq is kept consistent');
    t.throwsWith(writer(db, "INSERT INTO patient (rm_number,rm_seq,name,name_norm,sex,dob,nik_demo,phone,klass,created_at) " +
      "VALUES ('RM-000001',1,'X','x','L','1990-01-01','NIK-FIKTIF-000001','0812-FIKTIF-001','umum','2026-01-01')"),
      /UNIQUE constraint failed: patient\.rm_seq/, 'the primary key is never even consulted');
    t.neg('and by the rm_number/rm_seq CHECK when it is not — a different constraint, same refusal');
    t.throwsWith(writer(db, "INSERT INTO patient (rm_number,rm_seq,name,name_norm,sex,dob,nik_demo,phone,klass,created_at) " +
      "VALUES ('RM-000001',999999,'X','x','L','1990-01-01','NIK-FIKTIF-000001','0812-FIKTIF-001','umum','2026-01-01')"),
      /CHECK constraint failed: rm_number = 'RM-' \|\| substr\('000000' \|\| rm_seq, -6\)/,
      'the CHECK fires first, which is why the assertion above names its constraint');
  });

  /* ====================================================== G7 =========== */

  group('G7 STRICT and integer rupiah', function (t) {
    var db = fx().db;
    var line = "WHERE visit_id = (SELECT visit_id FROM bill_line LIMIT 1) AND line_no = 1";

    t.neg('STRICT refuses text in an integer money column, and names the column');
    t.throwsWith(writer(db, "UPDATE bill_line SET unit_rp = 'abc' " + line),
      /cannot store TEXT value in INTEGER column bill_line\.unit_rp/, "'abc' is refused");
    t.neg('and refuses a fractional rupiah');
    t.throwsWith(writer(db, 'UPDATE bill_line SET unit_rp = 12.5 ' + line),
      /cannot store REAL value in INTEGER column bill_line\.unit_rp/, '12.5 is refused');

    /* STRICT is not a type checker, it is a storage-class checker. Lossless
       coercion is still coercion and the page says so rather than implying
       STRICT means what a reader coming from a typed language expects. */
    t.prop("STRICT accepts '123' and stores the integer 123 — lossless coercion is still coercion");
    db.run('SAVEPOINT g7');
    t.eq(attempt(db, "UPDATE bill_line SET unit_rp = '123' " + line), null, "the text '123' is accepted");
    t.deep(rows('SELECT unit_rp, typeof(unit_rp) FROM bill_line ' + line, db), [[123, 'integer']], 'it is stored as an integer');
    t.prop('and accepts 12.0 the same way');
    t.eq(attempt(db, 'UPDATE bill_line SET unit_rp = 12.0 ' + line), null, 'the real 12.0 is accepted');
    t.deep(rows('SELECT unit_rp, typeof(unit_rp) FROM bill_line ' + line, db), [[12, 'integer']], 'it is stored as an integer');
    db.run('ROLLBACK TO g7'); db.run('RELEASE g7');

    /* The counter-example, and the only member of this group that can go red for
       an interesting reason. Without STRICT the declared type is a comment: this
       is the pre-v8 table the money guard had to run against, and typeof() is
       the proof. After v8 the same sweep cannot fail, which is why §0.4 has it
       reported as a fact about STRICT and not counted as a verification. */
    t.prop('the non-STRICT counter-example stores both, and typeof() proves the declared type was a comment');
    var d = newDb();
    d.run('CREATE TABLE loose(unit INTEGER)');
    d.run("INSERT INTO loose VALUES ('abc')");
    d.run('INSERT INTO loose VALUES (12.5)');
    t.deep(rows('SELECT unit, typeof(unit) FROM loose ORDER BY rowid', d),
      [['abc', 'text'], [12.5, 'real']], 'an INTEGER column holding a string and a float');
    d.close();

    t.neg('the generated money column cannot be written directly');
    t.throwsWith(writer(db, 'INSERT INTO bill_line (visit_id,line_no,label,grp,qty,unit_rp,amount_rp,covered,payer) ' +
      "SELECT visit_id,9002,'x','jasa',1,1000,1000,0,'pasien' FROM bill LIMIT 1"),
      /cannot INSERT into generated column "amount_rp"/, 'amount_rp is derived, not stored input');

    /* Walked over every column of every table, from the declared type rather
       than from the values: the database contains no REAL column at all, which
       is what makes "money and quantities are integers" a schema property
       instead of a convention. */
    t.prop('no column anywhere in the database has REAL affinity');
    var names = Object.keys(S.TABLE_DDL), i, k, reals = [];
    for (i = 0; i < names.length; i++) {
      var rr = rows("SELECT name, type FROM pragma_table_xinfo('" + names[i] + "')", db);
      for (k = 0; k < rr.length; k++) {
        var ty = String(rr[k][1]).toUpperCase();
        var isReal = ty.indexOf('REAL') >= 0 || ty.indexOf('FLOA') >= 0 || ty.indexOf('DOUB') >= 0;
        if (isReal) reals.push(names[i] + '.' + rr[k][0] + ' ' + ty);
      }
    }
    t.deep(reals, [], 'pragma_table_xinfo reports no REAL, FLOAT or DOUBLE column in the schema');

    t.neg('divRound refuses a fractional argument rather than rounding it quietly');
    t.throwsWith(function () { D.divRound(1.5, 2); }, /integer arguments only/, 'divRound(1.5, 2) throws');
    t.neg('and refuses a zero divisor');
    t.throwsWith(function () { D.divRound(1, 0); }, /division by zero/, 'divRound(1, 0) throws');
    t.prop('and rounds half away from zero in both directions');
    t.eq(D.divRound(7, 2), 4, '7/2 is 4');
    t.eq(D.divRound(-7, 2), -4, '-7/2 is -4');
    t.eq(D.divRound(5, 2), 3, '5/2 is 3');
    t.eq(D.divRound(-5, 2), -3, '-5/2 is -3');
  });

  /* ====================================================== G8 =========== */

  group('G8 transactions, and rollback leaves no trace', function (t) {
    /* A failed statement does not abort the transaction. This is the single most
       load-bearing fact in the lab: it is why the naive rebuild in §0.1 commits
       a half-applied migration and reports success. Run on a throwaway instance
       because it ends in a real COMMIT. */
    var d = E.openBytes(fx().v9bytes);
    t.prop('a failed statement does not abort the transaction — the half-applied migration commits');
    t.eq(attempt(d, 'BEGIN'), null, 'BEGIN');
    t.eq(attempt(d, "UPDATE patient SET address='first' WHERE rm_number='RM-000001'"), null, 'a good statement');
    t.ne(attempt(d, "INSERT INTO staff (id,name,role_id,title,sip) VALUES ('stf-98','X','perawat','P','SIP-FIKTIF-0001')"),
      null, 'a UNIQUE violation in the middle');
    t.eq(attempt(d, "UPDATE patient SET address='second' WHERE rm_number='RM-000002'"), null, 'another good statement');
    t.eq(attempt(d, 'COMMIT'), null, 'COMMIT returns OK');
    t.deep(rows("SELECT address FROM patient WHERE rm_number IN ('RM-000001','RM-000002') ORDER BY rm_number", d),
      [['first'], ['second']], 'both halves of the migration are committed');

    t.neg('BEGIN inside a transaction is an error');
    t.eq(attempt(d, 'BEGIN'), null, 'open one');
    t.throwsWith(function () { d.run('BEGIN'); }, /cannot start a transaction within a transaction/, 'the second BEGIN throws');

    t.prop('ROLLBACK TO a savepoint does not release it');
    t.eq(attempt(d, 'SAVEPOINT s'), null, 'SAVEPOINT s');
    t.eq(attempt(d, 'ROLLBACK TO s'), null, 'ROLLBACK TO s');
    t.eq(attempt(d, 'ROLLBACK TO s'), null, 'and again — the savepoint is still there');
    t.eq(attempt(d, 'RELEASE s'), null, 'RELEASE s');
    t.neg('and after RELEASE it is gone');
    t.throwsWith(function () { d.run('ROLLBACK TO s'); }, /no such savepoint: s/, 'the third ROLLBACK TO throws');
    attempt(d, 'ROLLBACK');
    t.neg('ROLLBACK with nothing open is an error, not a no-op');
    t.throwsWith(function () { d.run('ROLLBACK'); }, /cannot rollback - no transaction is active/, 'it throws');
    d.close();

    /* ON CONFLICT ROLLBACK is the opposite behaviour, in one word, and a
       migration runner that assumes one gets the other. */
    var e = E.openBytes(fx().v9bytes);
    t.prop('OR ROLLBACK aborts the whole transaction where a bare violation did not');
    t.eq(attempt(e, 'BEGIN'), null, 'BEGIN');
    t.eq(attempt(e, "UPDATE patient SET address='doomed' WHERE rm_number='RM-000001'"), null, 'a good statement');
    t.ne(attempt(e, "INSERT OR ROLLBACK INTO staff (id,name,role_id,title,sip) VALUES ('stf-97','X','perawat','P','SIP-FIKTIF-0001')"),
      null, 'the violating statement');
    t.eq(attempt(e, 'BEGIN'), null, 'a new BEGIN succeeds, so nothing was left open');
    t.ne(String(first("SELECT address FROM patient WHERE rm_number='RM-000001'", e)), 'doomed',
      'and the good statement was rolled back with it');
    e.close();

    /* THE PROPERTY THE PROPOSAL WAS MISSING, and the one that matters at 2am.
       Four rungs refuse. After each, the census — rows AND fold, table by table,
       computed by a file that shares no code with the runner — equals the
       pre-migration value. Not the checksum alone: an empty diff means every
       table matched on both. */
    var reports = fx().reports, i, seen = 0;
    for (i = 0; i < reports.length; i++) {
      var r = reports[i];
      if (!r.refused) continue;
      seen++;
      t.prop('v' + r.version + ' (' + r.name + ') refused and its rollback left no trace');
      t.ok(!!r.rollback, 'the rung reported a rollback comparison');
      t.deep(r.rollback.diff, [], 'the census diff is empty: every table matched in rows and in fold');
      t.eq(r.rollback.noTrace, true, 'noTrace');
      t.eq(r.rollback.checksumBefore, r.rollback.checksumAfter, 'the checksums are equal');
      t.gte(r.rollback.tablesCompared, 25, r.rollback.tablesCompared + ' tables were compared, not a sample');
    }
    t.prop('every rung that can refuse did, and its rollback was checked');
    t.eq(seen, 4, 'four rungs refused: three where SQLite refuses and one where the money guard does');
  });

  /* ====================================================== G9 =========== */

  group('G9 the migration ladder and the census contract', function (t) {
    var f = fx();
    var reports = f.reports, applied = [], i, r;
    for (i = 0; i < reports.length; i++) if (reports[i].ok && !reports[i].skipped) applied.push(reports[i]);

    t.prop('every version from 2 to 9 applied against rows that were already there');
    for (i = 2; i <= S.TARGET_VERSION; i++) {
      r = rungOf(reports, i);
      t.ok(!!r && r.ok, 'v' + i + ' applied');
    }
    t.prop('v1 applied too, and created the tables the fixture was poured into');
    t.eq(f.v1.ok, true, 'v1 ok');
    t.gt(f.seededCensus.totalRows, 20000, f.seededCensus.totalRows + ' rows were in the database before v2 ran');

    t.prop('a fresh PRAGMA user_version reads back the number each rung declared');
    for (i = 0; i < applied.length; i++) t.eq(applied[i].userVersion, applied[i].version, 'v' + applied[i].version);
    t.prop('and max(schema_migration.version) agrees with it at every rung');
    for (i = 0; i < applied.length; i++) t.eq(applied[i].loggedVersion, applied[i].version, 'v' + applied[i].version);

    /* THE CONTRACT. Every rung declares which tables it may touch; the firewall
       counts and folds every row of every table before and after and reports
       anything else. This is the property the lab exists for, and it is one
       assertion per rung per declaration. */
    t.prop('the census delta equals the declaration, at every rung');
    for (i = 0; i < applied.length; i++) {
      r = applied[i];
      t.ok(!!r.declaration, 'v' + r.version + ' has a declaration check');
      t.eq(r.declaration.ok, true, 'v' + r.version + ' (' + r.name + '): the declaration holds');
      t.deep(r.declaration.violations, [], 'v' + r.version + ': no violations');
      t.gte(r.declaration.checked, 25, 'v' + r.version + ': ' + r.declaration.checked + ' tables were walked');
    }

    t.prop('and nothing moved that the rung did not declare');
    for (i = 0; i < applied.length; i++) {
      r = applied[i];
      var moved = [], k;
      for (k = 0; k < r.census.diff.length; k++) moved.push(r.census.diff[k].table);
      var undeclared = [];
      for (k = 0; k < moved.length; k++) {
        if (!Object.prototype.hasOwnProperty.call(r.declares, moved[k])) undeclared.push(moved[k]);
      }
      t.deep(undeclared, [], 'v' + r.version + ': every table in the diff is named in declares');
    }

    t.prop('the pragma each rung sets before BEGIN is the pragma it declared');
    for (i = 0; i < applied.length; i++) {
      r = applied[i];
      t.eq(r.fkBefore, r.fk === 'off' ? 0 : 1, 'v' + r.version + ' step 1 reads ' + r.fkBefore + ' for fk=' + r.fk);
    }
    t.prop('and foreign keys are back on after step 12, whatever happened in between');
    for (i = 0; i < reports.length; i++) t.eq(reports[i].fkAfter === null ? 1 : reports[i].fkAfter, 1,
      'v' + reports[i].version + ' ends with foreign_keys = 1');

    t.prop('foreign_key_check is empty at every rung that applied');
    for (i = 0; i < applied.length; i++) t.deep(applied[i].fkCheck, [], 'v' + applied[i].version);

    /* Not a restatement of a constraint the rung just added — that can only
       return 0. A figure captured from the PRE-migration schema, through a
       different table, compared after. */
    t.prop('the before/after captures agree at the two rungs that carry them');
    var vab = 0;
    for (i = 0; i < applied.length; i++) {
      var list = applied[i].verifyAgainstBefore, k2;
      for (k2 = 0; k2 < list.length; k2++) {
        vab++;
        t.eq(list[k2].agree, true, 'v' + applied[i].version + ': ' + list[k2].label);
      }
    }
    t.eq(vab, 4, 'four such comparisons exist, at v4 and v8');

    var refusals = [
      [4, /FOREIGN KEY constraint failed/, 'the allergy class the 2024 import misspelled'],
      [5, /FOREIGN KEY constraint failed/, 'the visit whose doctor is an apoteker'],
      [6, /UNIQUE constraint failed: encounter_diagnosis\.encounter_id/, 'the encounter with two primary diagnoses'],
      [8, /rombak: money refuses\. 2 row\(s\) would not survive/, 'the two money cells a float multiply and a CSV upload left']
    ];
    for (i = 0; i < refusals.length; i++) {
      r = firstRungOf(reports, refusals[i][0]);
      t.neg('v' + refusals[i][0] + ' refuses, and for the reason claimed: ' + refusals[i][2]);
      t.eq(r.refused, true, 'v' + refusals[i][0] + ' refused');
      t.match(r.error, refusals[i][1], 'the message is the one the page prints');
      t.eq(r.userVersion, refusals[i][0] - 1, 'and user_version did not move');
    }

    t.prop('each refusal names the offending rows rather than the offending table');
    for (i = 0; i < refusals.length; i++) {
      r = firstRungOf(reports, refusals[i][0]);
      t.ok(!!r.refusal, 'v' + refusals[i][0] + ' has a finder');
      t.gte(r.refusal.rows.length, 1, 'v' + refusals[i][0] + ' found ' + r.refusal.rows.length + ' row(s)');
      t.gte(r.refusal.fixes.length, 1, 'and offers a one-statement repair');
    }

    /* Idempotence. A second application does nothing at all — no statements, no
       schema_migration row, no pragma — so the census before and after are the
       same value and the diff is empty by construction rather than by luck. */
    t.prop('applying an applied rung again is a no-op with an unchanged census');
    for (i = 1; i <= S.TARGET_VERSION; i++) {
      var again = RN.applyOne(i, { db: f.db });
      t.eq(again.skipped && again.ok && again.census.diff.length === 0, true,
        'v' + i + ' skipped, ok, census unchanged');
    }

    /* ---------------- THE FIREWALL'S OWN NEGATIVE CONTROL ----------------
       Every claim above consumes ROMBAK_CENSUS.take(), .diff() and
       .checkDeclaration(), and every one of them reports SUCCESS BY BEING
       EMPTY: an empty diff, an empty violation list, a fold that matches. That
       shape is how the repository has shipped a self-verifying proof three
       times, and MEASURED IN THIS BUILD RUN it had shipped a fourth: replace
       foldRows() with `return 12345`, or diff() with `return []`, or
       checkDeclaration() with `return {ok:true, violations:[]}` — any one of the
       three, on its own — and this suite stayed green at 939 of 939 while the
       page went on printing "not one row of any table moved".

       So the three are driven here against inputs whose answer is known and is
       NOT empty. Three rows of a scratch database, not the fixture: the point is
       to watch the firewall refuse, and a defect planted in 47,611 rows tells
       you less than one planted in three. */
    /* Guarded accessors. A red assertion must stay an assertion: reading
       list[0].table off an empty array throws, the group aborts, and every
       claim after it in G9 vanishes from the report instead of being counted —
       which is how a regression in the firewall would hide the rest of the
       firewall's own controls. */
    function drow(list, i) {
      return (list || [])[i] ||
        { table: '(nothing in the diff)', status: '(nothing in the diff)',
          rowsBefore: null, rowsAfter: null, hashBefore: null, hashAfter: null, hashChanged: null };
    }
    function vrow(res, i) {
      return ((res || {}).violations || [])[i] ||
        { table: '(no violation)', rule: '(no violation was reported)', message: '(no violation was reported)' };
    }

    var sdb = newDb();
    sdb.run('CREATE TABLE t (k TEXT PRIMARY KEY, n INTEGER, memo TEXT)');
    sdb.run("INSERT INTO t VALUES ('a',1,'x'),('b',2,'y'),('c',3,'z')");
    var sx = sdb.exec.bind(sdb);
    var c0 = C.take(sx);

    t.prop('the census reads what is in front of it, and two takes of an untouched database agree');
    t.eq(c0.tableCount, 1, 'one table');
    t.eq(c0.totalRows, 3, 'three rows');
    t.deep(C.diff(c0, C.take(sx)), [], 'the diff of two consecutive takes is empty');

    t.neg('one cell rewritten in one row is reported, with both folds on the record');
    sdb.run("UPDATE t SET memo = 'CHANGED' WHERE k = 'b'");
    var c1 = C.take(sx);
    var d1 = C.diff(c0, c1);
    t.eq(d1.length, 1, 'exactly one table in the diff');
    t.eq(drow(d1, 0).table, 't', 'and it is t');
    t.eq(drow(d1, 0).status, 'changed', "status 'changed'");
    t.deep([drow(d1, 0).rowsBefore, drow(d1, 0).rowsAfter], [3, 3], 'the row count did not move on either side');
    t.eq(drow(d1, 0).hashChanged, true, 'but the fold did');
    t.ne(c1.tables.t.hash, c0.tables.t.hash, 'the two folds are different numbers');
    t.ne(c1.checksum, c0.checksum, 'and so are the two checksums');

    /* The other direction, and it is why the fold is a SUM rather than a
       sequence: an index scan and a table scan hand back the same rows in a
       different order, and a fold that noticed would report every rebuild as a
       change until the reader learned to ignore it. */
    t.prop('and the fold does not depend on the order the rows come back in');
    sdb.run('DELETE FROM t');
    sdb.run("INSERT INTO t VALUES ('c',3,'z'),('a',1,'x'),('b',2,'CHANGED')");
    var reordered = C.take(sx);
    var rb = C.read(sx, 't').values;
    t.deep([rb[0][0], rb[1][0], rb[2][0]], ['c', 'a', 'b'],
      'the census itself now reads the three rows in a different order');
    t.eq(reordered.tables.t.hash, c1.tables.t.hash, 'the same fold');
    t.deep(C.diff(c1, reordered), [], 'and no diff');

    t.neg('a row added is reported as a row added');
    sdb.run("INSERT INTO t VALUES ('d',4,'w')");
    var c2 = C.take(sx);
    var d2 = C.diff(c1, c2);
    t.eq(d2.length, 1, 'one table moved');
    t.deep([drow(d2, 0).rowsBefore, drow(d2, 0).rowsAfter], [3, 4], '3 rows became 4');

    t.neg('a table that appears is named, and so is a table that vanishes');
    sdb.run('CREATE TABLE u (a INTEGER)');
    var c3 = C.take(sx);
    var d3 = C.diff(c2, c3);
    t.eq(d3.length, 1, 'one entry');
    t.deep([drow(d3, 0).table, drow(d3, 0).status, drow(d3, 0).rowsBefore, drow(d3, 0).rowsAfter], ['u', 'added', null, 0],
      'u appeared with no rows');
    var d4 = C.diff(c3, c2);
    t.deep([drow(d4, 0).table, drow(d4, 0).status, drow(d4, 0).rowsBefore, drow(d4, 0).rowsAfter], ['u', 'dropped', 0, null],
      'and read the other way round it disappeared');

    /* checkDeclaration is the half that turns a diff into a verdict, and it is
       the half with no other route to it: nothing else in this lab computes what
       a rung was allowed to touch. Each of its seven refusal rules is fired. */
    t.neg("checkDeclaration refuses a 'bytes' declaration whose row count moved");
    var vA = C.checkDeclaration(c1, c2, { t: 'bytes' });
    t.eq(vA.ok, false, 'not ok');
    t.eq(vA.violations.length, 1, 'one violation');
    t.eq(vrow(vA, 0).rule, 'rows-moved', "rule 'rows-moved'");
    t.match(vrow(vA, 0).message, /^t was declared "bytes".*3 row\(s\) became 4 \(\+1\)$/,
      'and the sentence names the table and both numbers');

    t.prop("and accepts 'bytes' when the row count held and only the shape moved");
    t.eq(C.checkDeclaration(c0, c1, { t: 'bytes' }).ok, true, 'same rows, different fold, declared bytes');

    t.neg('an undeclared change is a violation naming the table, the counts and both folds');
    var vB = C.checkDeclaration(c1, c2, {});
    t.eq(vB.ok, false, 'not ok');
    t.eq(vrow(vB, 0).rule, 'undeclared-change', "rule 'undeclared-change'");
    t.match(vrow(vB, 0).message, /^t changed but was not declared: 3 -> 4 row\(s\) \(\+1\), fold \d+ -> \d+$/,
      'the whole sentence');

    t.prop("and 'rows+bytes' licences it");
    t.eq(C.checkDeclaration(c1, c2, { t: 'rows+bytes' }).ok, true, 'anything goes in a rows+bytes table');

    t.neg("a table declared 'new' that was there all along is a violation");
    t.eq(vrow(C.checkDeclaration(c1, c2, { t: 'new' }), 0).rule, 'not-new', "rule 'not-new'");
    t.neg("and a table declared 'dropped' that is still here");
    t.eq(vrow(C.checkDeclaration(c2, c3, { u: 'dropped', t: 'bytes' }), 0).rule, 'appeared',
      'u appeared, and appearing is not being dropped');
    t.eq(vrow(C.checkDeclaration(c3, c3, { u: 'dropped' }), 0).rule, 'not-dropped', "rule 'not-dropped'");

    t.neg('a table that vanished undeclared is a violation, and declaring it dropped satisfies the check');
    t.eq(vrow(C.checkDeclaration(c3, c2, {}), 0).rule, 'disappeared', "rule 'disappeared'");
    t.eq(C.checkDeclaration(c3, c2, { u: 'dropped' }).ok, true, 'declared dropped, and it was');

    t.neg('a declaration for a table in neither census is itself a violation');
    var vC = C.checkDeclaration(c1, c1, { obat: 'bytes' });
    t.eq(vrow(vC, 0).rule, 'declared-absent', "rule 'declared-absent'");
    t.match(vrow(vC, 0).message, /obat is declared bytes but exists in neither census/, 'and says so');

    t.neg('and a declaration string that is not one of the four is refused rather than ignored');
    t.eq(vrow(C.checkDeclaration(c1, c2, { t: 'sedikit' }), 0).rule, 'unknown-declaration',
      "rule 'unknown-declaration'");
    sdb.close();

    t.neg('and there is no down-ladder: replay refuses to walk backwards');
    var back = RN.replayTo(4, { db: f.db });
    t.eq(back.ok, false, 'replayTo(4) from v9 is refused');
    t.match(back.refused, /There is no down-ladder/, 'and says why, naming Rewind');

    t.prop('the finished database is clean by SQLite\'s own reckoning');
    t.deep(E.integrityCheck(f.db), ['ok'], 'PRAGMA integrity_check');
    t.deep(E.foreignKeyCheck(f.db), [], 'PRAGMA foreign_key_check');
  });

  /* ====================================================== G10 ========== */

  group('G10 the rebuild that commits and destroys', function (t) {
    var v6 = fx().v6bytes;
    var V = RN.rebuildVariants(v6);
    var A = V.variants[0], B = V.variants[1], Cv = V.variants[2], Dv = V.variants[3];

    t.neg('A: the naive rebuild cannot drop the table, because a populated RESTRICT child holds it');
    t.eq(stepOf(A.naive, 'drop the old table').ok, false, 'DROP TABLE encounter failed');
    t.match(stepOf(A.naive, 'drop the old table').message, /FOREIGN KEY constraint failed/, 'and said so');
    t.neg('A: so the rename collides with the table that is still there');
    t.eq(stepOf(A.naive, 'rename').ok, false, 'the rename failed');
    t.match(stepOf(A.naive, 'rename').message,
      /there is already another table or index with this name: encounter/, 'naming the collision');

    /* The finding. Two statements failed, nothing aborted, COMMIT returned OK,
       and the database now carries a committed half-built table nobody asked
       for. A migration runner that checks its return codes one statement at a
       time sees two errors it can log and a successful transaction. */
    t.prop('A: COMMIT returns OK anyway and leaves a stray committed encounter_new');
    t.eq(A.naive.committed, true, 'the transaction committed');
    t.deep(A.naive.stray, ['encounter_new'], 'sqlite_master carries encounter_new');
    t.prop('A: and the children are untouched, so nothing looks wrong');
    t.eq(A.after.addendum, A.before.addendum, 'addendum ' + A.before.addendum + ' -> ' + A.after.addendum);
    t.eq(A.after.encounter_diagnosis, A.before.encounter_diagnosis,
      'encounter_diagnosis ' + A.before.encounter_diagnosis + ' -> ' + A.after.encounter_diagnosis);

    t.prop('B: one child table that happens to be empty this quarter, and the same script commits');
    t.eq(B.before.encounter_diagnosis, 0, 'encounter_diagnosis was archived out');
    t.eq(B.naive.errors, 0, 'every statement returned OK');
    t.eq(B.naive.committed, true, 'and it committed');
    t.prop('B: the addenda are gone, silently');
    t.eq(B.before.addendum, 2, 'there were 2 addenda');
    t.eq(B.after.addendum, 0, 'and 0 afterwards');
    t.prop('B: the child\'s stored DDL is unchanged — nothing was wrong with the child');
    t.eq(B.after.addendumCascades, true, 'addendum still reads ON DELETE CASCADE');

    /* The sentence the page is built around: a clean integrity check is not
       evidence of a correct migration. */
    t.prop('foreign_key_check comes back empty in BOTH — a clean check is not evidence');
    t.deep(A.after.fkCheck, [], 'A: []');
    t.deep(B.after.fkCheck, [], 'B: []');
    t.deep(A.naive.fkCheck, [], 'A: [] inside the transaction too');
    t.deep(B.naive.fkCheck, [], 'B: [] inside the transaction too');

    t.prop('C: one word of a child\'s DDL — RESTRICT becomes CASCADE — and both children go');
    t.match(Cv.childDdlLine, /ON DELETE CASCADE/, 'the child now cascades');
    t.eq(Cv.naive.committed, true, 'the rebuild commits');
    t.eq(Cv.after.addendum, 0, 'addendum ' + Cv.before.addendum + ' -> 0');
    t.eq(Cv.after.encounter_diagnosis, 0, 'encounter_diagnosis ' + Cv.before.encounter_diagnosis + ' -> 0');

    t.prop('D: the twelve steps preserve both children');
    t.eq(Dv.rung.ok, true, 'v7 applied');
    t.eq(Dv.after.addendum, Dv.before.addendum, 'addendum ' + Dv.before.addendum + ' -> ' + Dv.after.addendum);
    t.eq(Dv.after.encounter_diagnosis, Dv.before.encounter_diagnosis,
      'encounter_diagnosis ' + Dv.before.encounter_diagnosis + ' -> ' + Dv.after.encounter_diagnosis);
    t.prop('D: the pragma moved outside the transaction, and step 1 read 0');
    t.eq(Dv.rung.fkBefore, 0, 'foreign_keys was OFF for the rebuild');
    t.prop('D: and it is back ON after step 12');
    t.eq(Dv.rung.fkAfter, 1, 'foreign_keys reads 1 afterwards');
    t.eq(Dv.after.foreignKeys, 1, 'and the connection agrees');
    t.prop('D: the child was never touched, so its DDL still says CASCADE');
    t.eq(Dv.after.addendumCascades, true, 'addendum still reads ON DELETE CASCADE');
    t.prop('D: and the twelve steps are twelve, with the pragma first and last');
    t.eq(Dv.twelve.length, 12, 'twelve steps');
    t.match(Dv.twelve[0].label, /PRAGMA foreign_keys = OFF/, 'step 1');
    t.match(Dv.twelve[11].label, /PRAGMA foreign_keys = ON/, 'step 12');

    /* §0.1's extra finding, and it CANNOT be shown on encounter: encounter
       carries no named index and no trigger, only an auto-index the new table's
       own UNIQUE(visit_id) recreates. On visit it loses six indexes; on
       audit_entry it loses three partial indexes and all three append-only
       triggers. */
    t.prop('the naive rebuild silently loses every named index on the table it rebuilt');
    var Lv = RN.naiveLoses(v6, 'visit');
    t.eq(Lv.naive.committed, true, 'the rebuild of visit committed');
    t.eq(Lv.rowsKept, true, 'all ' + Lv.rowsBefore + ' rows survived');
    t.eq(Lv.lost.length, 6, 'and six named indexes did not: ' + Lv.lost.join(', '));
    t.prop('encounter cannot demonstrate it, and schema.js says so instead of pretending');
    var Le = RN.naiveLoses(v6, 'encounter');
    t.deep(Le.lost, [], 'encounter loses nothing — it has no named index and no trigger');
    t.match(S.NAIVE_REBUILDS.encounter.loses, /no named index or trigger/, 'schema.js records that');

    /* §0.2. The proposal claimed the armed audit table would REFUSE a naive
       rebuild. It is refused by neither the self-FK nor the triggers, and which
       of the two things happens depends entirely on a pragma set before BEGIN. */
    var on = RN.auditNaive(fx().v9bytes, 'on');
    t.neg('with foreign keys ON the armed table\'s rebuild fails at COMMIT, repeatedly');
    t.eq(on.committed, false, 'COMMIT did not succeed');
    t.match(stepOf(on.naive, 'COMMIT').message, /FOREIGN KEY constraint failed/, 'the deferred self-FK counter is never decremented');
    t.eq(on.stillOpen, true, 'and the transaction is still open');
    t.eq(!!(on.commitAgain && on.commitAgain.ok), false, 'a second COMMIT fails the same way');
    t.prop('and ROLLBACK restores every row, every trigger and every partial index');
    t.eq(on.rowsAfter, on.rowsBefore, on.rowsBefore + ' rows before and after');
    t.eq(on.triggersLost, 0, 'no trigger was lost');
    t.eq(on.headAfter, on.headBefore, 'the chain head is unchanged');

    var off = RN.auditNaive(fx().v9bytes, 'off');
    t.prop('with foreign keys OFF before BEGIN — what step 1 prescribes — it commits and keeps every row');
    t.eq(off.pragmaReads, 0, 'the pragma reads 0');
    t.eq(off.naive.errors, 0, 'every statement returned OK');
    t.eq(off.committed, true, 'and it committed');
    t.eq(off.rowsKept, true, 'all ' + off.rowsBefore + ' rows survived');
    t.prop('and all three append-only triggers are gone, with no error anywhere');
    t.eq(off.triggersBefore.length, 3, 'three triggers were armed');
    t.deep(off.triggersAfter, [], 'and none afterwards');
    t.deep(off.fkCheckAfter, [], 'foreign_key_check is empty');
    t.prop('the append-only guarantee was live before the rebuild and is gone after it');
    t.eq(off.updateBefore.ok, false, 'UPDATE was refused before');
    t.match(off.updateBefore.message, /audit_entry is append-only: UPDATE refused/, 'by the trigger, by name');
    t.eq(!!(off.updateAfter && off.updateAfter.ok), true, 'and is accepted afterwards');

    /* The two fixes a migration author reaches for when the naive script starts
       failing. Both return OK. The first changes nothing; the second changes the
       WRONG thing — it defers the checks, so the DROP is permitted and the CASCADE
       fires, and the deferred check then refuses the COMMIT. Asserting only as far
       as the DROP would pin the half of the behaviour that misleads. */
    var WF = RN.wrongFixes(fx().v9bytes);
    t.prop('PRAGMA foreign_keys = OFF inside a transaction returns OK and the pragma still reads 1');
    t.eq(WF[0].id, 'pragma-inside', 'the first wrong fix');
    t.eq(WF[0].steps[1].ok, true, 'the pragma statement returned OK');
    t.eq(WF[0].got, 1, 'and foreign_keys still reads 1');
    t.eq(WF[0].confirmed, true, 'confirmed');
    t.prop('defer_foreign_keys = ON likewise, and CASCADE still fires because it is an action');
    t.eq(WF[1].id, 'defer-fk', 'the second wrong fix');
    t.eq(WF[1].got, 1, 'foreign_keys still reads 1');
    t.eq(WF[1].drop.ok, true, 'DROP TABLE encounter now returns OK');
    t.eq(WF[1].addendumBefore, 2, '2 addenda before');
    t.eq(WF[1].addendumAfter, 0, 'and 0 after — deferring checks did not defer the action');
    t.eq(!!(WF[1].commit && WF[1].commit.ok), false, 'and then COMMIT is refused');
    t.match(WF[1].commit.message, /FOREIGN KEY constraint failed/,
      'by the deferred check, which is what deferring bought: a later refusal');
    t.eq(WF[1].addendumRolledBack, 2, 'so after ROLLBACK the 2 addenda are still there');
  });

  /* ====================================================== G11 ========== */

  group('G11 the ALTER TABLE capability boundary', function (t) {
    /* This group is not an assertion about SQLite being correct. It is a pin on
       the boundary the lab's central claim rests on: if a future SQLite gains
       ALTER TABLE ... ADD CONSTRAINT, then "this needs a twelve-step rebuild"
       stops being true and this group is supposed to go red and say so. */
    var m = RN.alterMatrix({ db: fx().db }), i;
    for (i = 0; i < m.length; i++) {
      var e = m[i];
      t.prop('ADD COLUMN ' + e.id + ': ' + e.empty.expect + ' on an empty table, ' +
        e.populated.expect + ' on a populated one', e.populated.expect === 'error');
      t.eq(e.empty.agrees, true, 'empty -> ' + e.empty.got + (e.empty.message ? ': ' + e.empty.message : ''));
      t.eq(e.populated.agrees, true, 'populated -> ' + e.populated.got + (e.populated.message ? ': ' + e.populated.message : ''));
    }
    t.prop('the matrix left no scratch table behind');
    t.eq(rows("SELECT name FROM sqlite_master WHERE name LIKE 'zz\\_alter%' ESCAPE '\\'", fx().db).length, 0,
      'zz_alter_empty and zz_alter_pop are gone');

    var refusals = RN.rebuildRefusals({ db: fx().db });
    for (i = 0; i < refusals.length; i++) {
      t.neg('ALTER TABLE cannot ' + refusals[i].want + ' — it is a bare syntax error');
      t.eq(refusals[i].refused, true, refusals[i].want);
      t.match(refusals[i].message, /syntax error/, refusals[i].message);
    }

    var a = E.openBytes(fx().v9bytes);
    t.prop('RENAME COLUMN rewrites the generated expression that mentions it');
    t.eq(attempt(a, 'ALTER TABLE visit RENAME COLUMN doctor_id TO dokter_id'), null, 'the rename succeeds');
    var sql = String(first("SELECT sql FROM sqlite_master WHERE name='visit'", a));
    t.match(sql, /CASE WHEN dokter_id IS NULL/, 'doctor_role now reads dokter_id');
    t.notOk(/\bdoctor_id\b/.test(sql), 'and the old name is nowhere in the stored DDL');
    a.close();

    var b = E.openBytes(fx().v9bytes);
    t.prop('RENAME TABLE rewrites a self-REFERENCES inside the stored DDL');
    t.eq(attempt(b, 'ALTER TABLE audit_entry RENAME TO audit_log'), null, 'the rename succeeds');
    var sql2 = String(first("SELECT sql FROM sqlite_master WHERE name='audit_log'", b));
    t.match(sql2, /REFERENCES\s+"audit_log"\(hash\)/, 'prev_hash now references audit_log(hash)');
    t.notOk(/audit_entry\(hash\)/.test(sql2), 'the old self-reference is gone');
    t.prop('and the triggers follow the table without being mentioned');
    t.deep(rows("SELECT DISTINCT tbl_name FROM sqlite_master WHERE type='trigger'", b), [['audit_log']],
      'all three triggers now name audit_log');
    b.close();

    var c = E.openBytes(fx().v9bytes);
    t.prop('ADD COLUMN with a CONSTANT default works on a populated table, and every row gets the default');
    t.eq(attempt(c, "ALTER TABLE patient ADD COLUMN note2 TEXT NOT NULL DEFAULT ''"), null, 'accepted');
    t.eq(Number(first("SELECT count(*) FROM patient WHERE note2 = ''", c)),
      Number(first('SELECT count(*) FROM patient', c)), 'every row carries it — which is all ADD COLUMN can do');
    t.neg('DROP COLUMN is refused when an index mentions the column');
    t.throwsWith(function () { c.run('ALTER TABLE visit DROP COLUMN queue_seq'); },
      /error in (table|index) visit.* after drop column: no such column: queue_seq/,
      'the index that mentions it must be dropped first');
    t.prop('and works when nothing mentions it');
    t.eq(attempt(c, 'ALTER TABLE patient DROP COLUMN note2'), null, 'accepted');
    c.close();
  });

  /* ====================================================== G12 ========== */

  group('G12 query plans', function (t) {
    /* The verbatim EXPLAIN QUERY PLAN string for each of the fourteen named
       queries, its independent twin, and a fold over both result sets to prove
       the two routes return the same rows. NO TIMING IS EVER ASSERTED: timings
       vary by machine and a suite that pins one is a suite that will lie on
       somebody's laptop. */
    var db = fx().db, i, k;
    for (i = 0; i < P.PLANS.length; i++) {
      var e = P.PLANS[i];
      var params = e.params || [];
      if (e.paramsSql) {
        var pr = rows(e.paramsSql, db);
        params = pr.length ? pr[0] : [];
      }
      for (k = 0; k < (e.setup || []).length; k++) db.run(e.setup[k]);

      t.prop('plan [' + e.id + ']: ' + e.expectPlan.join(' | '));
      t.deep(planDetails(e.sql, params, db), e.expectPlan, e.id);
      if (e.twinSql) {
        t.deep(planDetails(e.twinSql, params, db), e.expectTwinPlan, e.id + ' — the independent route');
        if (e.twinSameRows === false) {
          t.ok(true, e.id + ' — the twin changes the SELECT list on purpose, so the rows are not compared');
        } else {
          var a = foldRows(e.sql + (e.orderFor || ''), params, db);
          var b = foldRows(e.twinSql + (e.orderFor || ''), params, db);
          t.deep([a.n, a.h], [b.n, b.h], e.id + ' — both routes return the same ' + a.n + ' rows');
        }
      }
      for (k = 0; k < (e.variants || []).length; k++) {
        var v = e.variants[k];
        db.run(v.pragma);
        t.deep(planDetails(e.sql, params, db), v.expectPlan, e.id + ' under ' + v.id);
        db.run(v.restore);
      }
      for (k = 0; k < (e.teardown || []).length; k++) db.run(e.teardown[k]);
    }
    /* THE FOLD'S OWN NEGATIVE CONTROL. Twelve of the assertions above are
       `deep([a.n, a.h], [b.n, b.h])` — an index scan and a table scan agreeing on
       the rows they returned — and every one of them passes by two numbers being
       EQUAL. MEASURED IN THIS BUILD RUN: make foldRows() return a constant
       `{n: 1, h: 1}` and all twelve stay green, because both sides get the same
       constant. So the fold is driven here against two sets whose answer is
       known: two rows the same size and one value apart. */
    t.neg('the row-set fold reports a difference between two sets of the same size');
    var fa = foldRows('SELECT 1 AS n UNION ALL SELECT 2 AS n', [], db);
    var fb = foldRows('SELECT 1 AS n UNION ALL SELECT 3 AS n', [], db);
    t.deep([fa.n, fb.n], [2, 2], 'both are two rows, so a row count would not have noticed');
    t.ne(fa.h, fb.h, 'and the two folds are different numbers');
    t.eq(foldRows('SELECT 1 AS n UNION ALL SELECT 2 AS n', [], db).h, fa.h,
      'while the same set folds to the same number twice');
    /* And it is deliberately ORDER-SENSITIVE — h * 31 per row, not a sum — which
       is the entire reason `orderFor` is appended to both sides above and to
       neither side of the plan assertion. */
    t.prop('and it is order-sensitive, which is why an ORDER BY goes on both sides above');
    t.ne(foldRows('SELECT 2 AS n UNION ALL SELECT 1 AS n', [], db).h, fa.h,
      'the same two rows in the other order fold differently');

    t.prop('four of the fourteen are failure cases, and are labelled as such rather than deleted');
    t.eq(P.FAILURE_COUNT, 4, P.FAILURE_COUNT + ' entries carry isFailureCase');
    /* `P.COUNT` is DEFINED as `PLANS.length`, so comparing the two is x === x and
       cannot fail. The literal is what makes it an assertion: add a fifteenth
       plan and this goes red until somebody transcribes the new number from a
       real run, which is the discipline in §6.6. Both are asserted, so a COUNT
       that stopped tracking the array is caught as well. */
    t.eq(P.PLANS.length, 14, 'fourteen named queries, counted against a transcribed number');
    t.eq(P.COUNT, P.PLANS.length, 'and the count the page prints is the array length, not a literal');
  });

  /* ====================================================== G13 ========== */

  group('G13 ANALYZE and sqlite_stat1', function (t) {
    /* On its own instance. ANALYZE moves two of the plans G12 just pinned, so
       running it against the shared database would turn that group red depending
       on the order the groups happen to be registered in. */
    var db = E.openBytes(fx().v9bytes);
    var A = P.ANALYZE_CARD;

    t.prop('sqlite_stat1 does not exist until ANALYZE is run');
    t.eq(Number(first(A.absentBefore, db)), A.absentBeforeExpect, 'no such table in sqlite_master');
    t.prop('a named plan is one thing before ANALYZE');
    t.deep(planDetails(A.flips.sql, [], db), A.flips.before, 'before');
    t.prop('and another after it');
    db.run(A.analyze);
    t.gt(Number(first(A.rowsAfter, db)), 0, 'sqlite_stat1 now has rows');
    t.deep(planDetails(A.flips.sql, [], db), A.flips.after, 'after');

    /* §0.4: a tampered statistic alone changes nothing. The planner reads its
       statistics at schema load, and the reload is the non-obvious half. */
    t.prop('a tampered statistic row changes no plan on its own');
    t.deep(planDetails(A.tamper.sql, [], db), A.tamper.beforeTamper, 'the query before the tamper');
    db.run(A.tamper.update);
    t.deep(planDetails(A.tamper.sql, [], db), A.tamper.afterUpdateOnly, 'and after the UPDATE, unchanged');
    t.prop('the same tamper plus a schema reload flips it');
    db.run(A.tamper.reload);
    t.deep(planDetails(A.tamper.sql, [], db), A.tamper.afterReload, 'ANALYZE sqlite_schema is what did it');
    t.prop('re-running ANALYZE overwrites the lie');
    db.run(A.tamper.repair);
    t.deep(planDetails(A.tamper.sql, [], db), A.tamper.beforeTamper, 'the honest plan is back');
    t.neg('and there are no histograms to worry about either way — sqlite_stat4 is not in this build');
    t.throwsWith(function () { db.run('SELECT count(*) FROM sqlite_stat4'); },
      /no such table: sqlite_stat4/, 'sqlite_stat4 is absent');

    t.prop('the census excludes sqlite_% so ANALYZE does not change what it counts');
    var after = C.take(db.exec.bind(db));
    t.eq(!!after.tables.sqlite_stat1, false, 'sqlite_stat1 is not in the census');
    t.eq(after.tableCount, fx().fingerprint.tableCount, after.tableCount + ' tables, the same as before ANALYZE');
    t.eq(after.checksum, fx().fingerprint.checksum, 'and the same checksum — statistics are not data');
    db.close();
  });

  /* ====================================================== G14 ========== */

  /* The six fixed vectors. Frozen as literals on purpose: the agreement with
     labs/rekam/audit.js is checked by tools/check-rekam-agreement.js under node,
     not in the page, because loading ../rekam/audit.js here would risk a
     load-time pageerror that test/labs.test.js counts as a broken page and
     exits 1 on with every assertion green. The honest description of what a
     frozen snapshot buys is in the README: it will drift silently if that file
     changes and nobody runs the script. */
  var VECTORS = [
    { id: 'empty-object', value: {},
      canonical: '{}',
      sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' },
    { id: 'key-order', value: { b: 1, a: 2, C: 3, _z: 4 },
      canonical: '{"C":3,"_z":4,"a":2,"b":1}',
      sha256: 'a3b271a386d37005157230c2c6cd56f9f9675ce8a0e6a1b8966d00b66be4371a' },
    { id: 'nested', value: { z: null, a: [3, 1, 2], m: { y: 1, x: 2 }, e: [], o: {} },
      canonical: '{"a":[3,1,2],"e":[],"m":{"x":2,"y":1},"o":{},"z":null}',
      sha256: '6db49d838a9acf360c46911816b51d562c3dff3067289046873b58dbf8121b1a' },
    { id: 'undefined-dropped', value: { keep: 1, drop: undefined, also: 'two', nested: { gone: undefined, here: true } },
      canonical: '{"also":"two","keep":1,"nested":{"here":true}}',
      sha256: 'd30671604e2b1ed2236a3e64f56fb4cc7c347f414d6f25897cee275c015595a2' },
    { id: 'numbers-and-unicode', value: { neg: -0, big: 1e21, frac: 0.1, teks: 'Demam berdarah — 37,6 °C', esc: 'a"b\\c\nd' },
      canonical: '{"big":1e+21,"esc":"a\\"b\\\\c\\nd","frac":0.1,"neg":0,"teks":"Demam berdarah — 37,6 °C"}',
      sha256: '41196115386e76e9f66e6cb8847f8a3de80199ec8c0701e01a0bda7b14eb702b' },
    { id: 'commitment-shape', value: {
        seq: 7, at: '2026-09-09T09:14:00', actorId: 'stf-01', actorName: 'dr. Rina Halim',
        actorRole: 'dokter', action: 'encounter.sign', entity: 'encounter',
        entityId: 'E-20260909-0003', summary: 'Catatan ditandatangani',
        detail: '{"codes":["J06.9"],"visit":"V-20260909-0003"}',
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000'
      },
      commitment: true,
      canonical: '{"action":"encounter.sign","actorId":"stf-01","actorName":"dr. Rina Halim",' +
        '"actorRole":"dokter","at":"2026-09-09T09:14:00","detail":"{\\"codes\\":[\\"J06.9\\"],' +
        '\\"visit\\":\\"V-20260909-0003\\"}","entity":"encounter","entityId":"E-20260909-0003",' +
        '"prevHash":"0000000000000000000000000000000000000000000000000000000000000000","seq":7,' +
        '"summary":"Catatan ditandatangani"}',
      sha256: '6e3d2531069b56e3c92505c0d7950aedeab21caeda97540c50a4832bef1a4ef3' }
  ];

  /* FIPS 180-4, the published digests. A hand-written SHA-256 that has never
     been checked against the standard is a hash function shaped like SHA-256. */
  var FIPS = [
    ['the empty string', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['"abc"', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['the 448-bit one-block message', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['the 896-bit two-block message',
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
    ['one million "a"', null, 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0']
  ];

  group('G14 the audit chain and canonical JSON', function (t) {
    var db = fx().db, i;

    t.prop('the pure-JS SHA-256 matches the FIPS 180-4 published digests');
    for (i = 0; i < FIPS.length; i++) {
      var input = FIPS[i][1] === null ? new Array(1000001).join('a') : FIPS[i][1];
      t.eq(D.sha256(input), FIPS[i][2], FIPS[i][0]);
    }

    t.prop('canonical() produces the six frozen strings');
    for (i = 0; i < VECTORS.length; i++) {
      var v = VECTORS[i];
      var value = v.commitment ? D.commitment(v.value) : v.value;
      t.eq(D.canonical(value), v.canonical, 'vector [' + v.id + ']');
    }
    t.prop('and their six frozen digests');
    for (i = 0; i < VECTORS.length; i++) {
      t.eq(D.sha256(VECTORS[i].canonical), VECTORS[i].sha256, 'vector [' + VECTORS[i].id + ']');
    }
    t.prop('hashEntry is sha256 of canonical of commitment, and commitment drops what is not in the shape');
    t.eq(D.hashEntry(VECTORS[5].value), VECTORS[5].sha256, 'the commitment vector round-trips through hashEntry');
    t.deep(D.commitment({ seq: 1, junk: 'ignored' }).junk, undefined, 'an extra key never reaches the digest');
    t.eq(D.sha256, D.sha256Hex, 'sha256Hex is the same function, so there is one implementation to check');

    t.prop('the genesis constant is 64 zeros, and the genesis row stores NULL rather than the constant');
    t.eq(D.GENESIS.length, 64, 'GENESIS is 64 characters');
    t.eq(/^0{64}$/.test(D.GENESIS), true, 'and all of them are zeros');
    t.eq(first('SELECT prev_hash FROM audit_entry WHERE seq = 0', db), null, 'audit_entry seq 0 has prev_hash NULL');
    t.eq(Number(first('SELECT count(*) FROM audit_entry WHERE seq > 0 AND prev_hash IS NULL', db)), 0,
      'and every other row has one');

    t.prop('the chain walks clean, from raw rows, to the commitment it is held against');
    var clean = C.invariants(db.exec.bind(db));
    function inv(list, id) {
      var k;
      for (k = 0; k < list.length; k++) if (list[k].id === id) return list[k];
      return null;
    }
    t.eq(inv(clean, 'v-audit-contiguous').jsValue, 0, 'no gap and no repeat in seq');
    t.eq(inv(clean, 'v-audit-hash').jsValue, 0, 'every hash recomputes from the row it commits to');
    t.eq(inv(clean, 'v-audit-commitment').jsValue, 0, 'the length-and-head commitment agrees');
    t.eq(Number(first('SELECT count FROM audit_commitment WHERE k = \'chain\'', db)),
      Number(first('SELECT count(*) FROM audit_entry', db)), 'and the count it commits to is the count');

    t.neg('the append-only trigger refuses UPDATE, by name');
    t.throwsWith(writer(db, "UPDATE audit_entry SET summary = 'x' WHERE seq = 0"),
      /audit_entry is append-only: UPDATE refused/, 'trg_audit_no_update');
    t.neg('and refuses DELETE');
    t.throwsWith(writer(db, 'DELETE FROM audit_entry WHERE seq = 5'),
      /audit_entry is append-only: DELETE refused/, 'trg_audit_no_delete');
    t.neg('the insert trigger refuses a gap in seq');
    t.throwsWith(writer(db, "INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_visit,prev_hash,hash) " +
      "SELECT max(seq)+5,'2026-09-09T23:00:00','stf-05','x','pendaftaran','visit.open','x','{}','visit',(SELECT id FROM visit LIMIT 1)," +
      "(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry"),
      /audit_entry: seq must be prev\.seq\+1 and prev_hash must be prev\.hash/, 'trg_audit_chain');
    t.neg('and a prev_hash that does not name the previous row');
    t.throwsWith(writer(db, "INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_visit,prev_hash,hash) " +
      "SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','visit.open','x','{}','visit',(SELECT id FROM visit LIMIT 1)," +
      "'0000000000000000000000000000000000000000000000000000000000000001','aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd' FROM audit_entry"),
      /audit_entry: seq must be prev\.seq\+1 and prev_hash must be prev\.hash/, 'trg_audit_chain again');
    t.neg('and a hash that is not 64 hex characters');
    t.throwsWith(writer(db, "INSERT INTO audit_entry (seq,at,actor_id,actor_name,actor_role,action,summary,detail,entity,ent_visit,prev_hash,hash) " +
      "SELECT max(seq)+1,'2026-09-09T23:00:00','stf-05','x','pendaftaran','visit.open','x','{}','visit',(SELECT id FROM visit LIMIT 1)," +
      "(SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1),'NOTAHASH' FROM audit_entry"),
      /CHECK constraint failed: length\(hash\) = 64/, 'the CHECK on the hash column');

    /* THE FOUR BREAK KINDS. Each has to be detected and NAMED, and none of them
       can be demonstrated while the triggers are armed — which is itself the
       finding: on this table the JS walk is the only route to "this row was
       edited", because SQL cannot recompute a SHA-256 and the triggers make the
       tamper impossible to stage in the first place. */
    var d = E.openBytes(fx().v9bytes);
    d.run('DROP TRIGGER trg_audit_no_update');
    d.run('DROP TRIGGER trg_audit_no_delete');
    var exec = d.exec.bind(d);
    function breakIt(sql) {
      d.run('SAVEPOINT brk');
      var m = attempt(d, sql);
      var list = m === null ? C.invariants(exec) : null;
      d.run('ROLLBACK TO brk'); d.run('RELEASE brk');
      return { msg: m, list: list };
    }
    t.prop('break 1 of 4: an edited row is caught by re-deriving its digest');
    var b1 = breakIt("UPDATE audit_entry SET summary = 'tampered' WHERE seq = 3");
    t.eq(b1.msg, null, 'the edit went in once the triggers were dropped');
    t.gte(inv(b1.list, 'v-audit-hash').jsValue, 1, 'v-audit-hash names it');
    t.prop('break 2 of 4: a gap in seq is caught by the contiguity walk');
    var b2 = breakIt('UPDATE audit_entry SET seq = seq + 5 WHERE seq = (SELECT max(seq) FROM audit_entry)');
    t.eq(b2.msg, null, 'the gap went in');
    t.gte(inv(b2.list, 'v-audit-contiguous').jsValue, 1, 'v-audit-contiguous names it');
    t.prop('break 3 of 4: a re-pointed prev_hash is a fork, and every digest downstream changes');
    var b3 = breakIt("UPDATE audit_entry SET prev_hash = (SELECT hash FROM audit_entry WHERE seq = 1) WHERE seq = 4");
    t.eq(b3.msg, null, 'the fork went in');
    t.gte(inv(b3.list, 'v-audit-hash').jsValue, 1, 'v-audit-hash names it');
    t.prop('break 4 of 4: truncation is caught only by the commitment held outside the chain');
    var b4 = breakIt('DELETE FROM audit_entry WHERE seq = (SELECT max(seq) FROM audit_entry)');
    t.eq(b4.msg, null, 'the tail row was deleted');
    t.eq(inv(b4.list, 'v-audit-contiguous').jsValue, 0, 'the chain that is left walks perfectly');
    t.gte(inv(b4.list, 'v-audit-commitment').jsValue, 1, 'and only v-audit-commitment notices');

    var chainRows = Number(first('SELECT count(*) FROM audit_entry', d));
    t.neg('prev_hash\'s foreign key blocks a mid-chain delete even with the triggers gone');
    t.throwsWith(function () {
      d.run('BEGIN');
      d.run('DELETE FROM audit_entry WHERE seq = 5');
      try { d.run('COMMIT'); } catch (e) { try { d.run('ROLLBACK'); } catch (e2) { /* nothing open */ } throw e; }
    }, /FOREIGN KEY constraint failed/, 'the deferred self-reference is checked at COMMIT');
    t.eq(Number(first('SELECT count(*) FROM audit_entry', d)), chainRows,
      'and all ' + chainRows + ' rows are still there');
    t.prop('the tail, by contrast, has nothing pointing at it and goes — which is why the commitment exists');
    t.eq(attempt(d, 'DELETE FROM audit_entry WHERE seq = (SELECT max(seq) FROM audit_entry)'), null,
      'deleting the last entry is not refused by anything in the schema');
    t.eq(Number(first('SELECT count(*) FROM audit_entry', d)), chainRows - 1, 'one row shorter');
    d.close();
  });

  /* ====================================================== G15 ========== */

  group('G15 two independent routes to every live figure', function (t) {
    /* Every figure is computed twice: once by SQLite's query engine with
       index-assisted aggregates, and once by hand-written ES5 reducing raw rows
       from a plan-confirmed full scan with no WHERE and no aggregate. Two
       implementations, two languages, two engines, and their difference on
       screen. A check that cannot fail is decoration, so the three negatives
       below make each route disagree with the other on purpose. */
    var db = fx().db;
    var exec = db.exec.bind(db);
    var jsList = C.invariants(exec);
    var sqlList = E.sqlInvariants(db);
    var merged = C.compare(jsList, sqlList);
    function inv(list, id) { var i; for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

    var figures = [], violations = [], i;
    for (i = 0; i < merged.length; i++) (merged[i].kind === 'figure' ? figures : violations).push(merged[i]);

    for (i = 0; i < figures.length; i++) {
      t.prop('the two routes agree on ' + figures[i].id + ': ' + figures[i].name);
      t.eq(figures[i].agree, true, figures[i].id + ': js ' + figures[i].jsValue + ' vs sql ' + figures[i].sqlValue);
      t.eq(figures[i].delta, 0, figures[i].id + ': the difference is 0');
      t.eq(figures[i].applicable, true, figures[i].id + ' ran on both sides');
    }
    t.prop('and every integrity property reports zero violations on both routes');
    for (i = 0; i < violations.length; i++) {
      t.eq(violations[i].jsValue, 0, violations[i].id + ' (JS): ' + violations[i].name);
      t.eq(violations[i].agree, true, violations[i].id + ': the SQL route agrees');
    }
    t.prop('the badge counts what actually ran, and everything ran');
    var sum = C.summary(merged);
    t.eq(sum.failed, 0, 'no failures');
    t.eq(sum.pending, 0, 'nothing left unverified');
    t.eq(sum.applicable, sum.total, sum.applicable + ' of ' + sum.total + ' invariants apply at v9');
    /* Same shape as P.COUNT: `merged` is built FROM checkIds()'s list, so
       comparing their lengths is x === x. The literal is the assertion, and it is
       the number the live badge's denominator has to match. */
    t.eq(C.checkIds().length, 22, 'twenty-two invariant ids, counted against a transcribed number');
    t.eq(merged.length, C.checkIds().length, 'and every one of them came back from compare()');

    /* THE OTHER HALF OF "TWO ROUTES", and the reason this block exists. Three
       of the twenty-two cannot be non-zero at v9 whatever anybody writes,
       because the schema itself refuses the row: amount_rp IS `qty * unit_rp`,
       the money columns are INTEGER in a STRICT table, and bill carries the
       sum-of-parts CHECK. MEASURED IN THIS BUILD RUN: `UPDATE bill_line SET
       qty = qty + 1` is ACCEPTED and both routes still answer 0, because SQLite
       recomputed the generated column and the JavaScript recomputed the same
       product; all four ways of storing a fractional or textual rupiah are
       refused with `cannot store REAL value in INTEGER column`; the one-column
       bill corruption is refused by the CHECK. They were rendering with the same
       green tick as the figures two engines could have disagreed about, which is
       §0.4's complaint about the typeof sweep and §10.3's third trap arriving in
       the same table. They are flagged now, and the flag is read off the SCHEMA
       and never off a version number — the property below is what proves that. */
    t.prop('the three invariants this schema makes unfalsifiable are flagged rather than counted as verified');
    t.deep(C.summary(merged).byConstructionIds,
      ['v-bill-parts-sum', 'v-line-amount-derived', 'v-money-integer'], 'exactly these three, named');
    t.eq(inv(merged, 'v-line-amount-derived').byConstruction, true, 'amount_rp is a generated column');
    t.match(inv(merged, 'v-line-amount-derived').why, /GENERATED column/, 'and the reader is told which one');
    t.eq(inv(merged, 'v-money-integer').byConstruction, true, 'the money columns are STRICT INTEGER');
    t.match(inv(merged, 'v-money-integer').why, /STRICT/, 'and told that STRICT is what makes it unstorable');
    t.eq(inv(merged, 'v-bill-parts-sum').byConstruction, true, 'the sum of parts is a table CHECK');
    t.eq(inv(merged, 'f-patients').byConstruction, false,
      'a figure the two engines could have disagreed about is not flagged');
    t.eq(inv(merged, 'v-queue-seq-counter').byConstruction, false,
      'and neither is the two-table rule no CHECK can express');

    t.prop('and that flag comes off the schema, not off a version number: at v1 the same three are checks');
    var one = E.openBytes(fx().base);
    var m1 = C.compare(C.invariants(one.exec.bind(one)), E.sqlInvariants(one));
    t.eq(RN.userVersion({ db: one }), 1, 'this database is standing on v1 with the fixture in it');
    t.deep(C.summary(m1).byConstructionIds, [], 'nothing is flagged by construction at v1');
    t.eq(inv(m1, 'v-line-amount-derived').ok, false, 'v-line-amount-derived is RED at v1');
    t.eq(inv(m1, 'v-money-integer').ok, false, 'v-money-integer is RED at v1');
    t.gt(inv(m1, 'v-money-integer').jsValue, 0,
      inv(m1, 'v-money-integer').jsValue + ' non-integer money cells, which is the number v8 exists for');
    t.eq(inv(m1, 'v-money-integer').agree, true, 'and the SQL route agrees on the count');
    one.close();

    /* And the STRICT half of that flag on its own, because the ladder cannot
       exercise it: at v1 the money columns are declared REAL, at v9 they are
       INTEGER in a STRICT table, and no rung ever produces the third case — an
       INTEGER-declared column in a table that is NOT strict, where the declared
       type is a comment and 12.5 goes straight in. Without this control the
       probe could answer "unstorable" about a table that stores it, and a real
       check would be dismissed on the page as a tautology. */
    t.neg('a column declared INTEGER in a table that is not STRICT is not unfalsifiable, and is not flagged');
    var loose = newDb();
    loose.run('CREATE TABLE bill (visit_id TEXT PRIMARY KEY, total_tarif_rp INTEGER, ' +
      'ditanggung_rp INTEGER, ditanggung_lain_rp INTEGER, dibayar_pasien_rp INTEGER)');
    loose.run('CREATE TABLE bill_line (visit_id TEXT, line_no INTEGER, qty INTEGER, ' +
      'unit_rp INTEGER, amount_rp INTEGER, PRIMARY KEY (visit_id, line_no))');
    loose.run("INSERT INTO bill VALUES ('V-1', 1000, 1000, 0, 0)");
    loose.run("INSERT INTO bill_line VALUES ('V-1', 1, 1, 1000, 1000)");
    t.eq(attempt(loose, "INSERT INTO bill_line VALUES ('V-1', 2, 1, 12.5, 12.5)"), null,
      'the fractional rupiah is accepted, because the declared type is a comment without STRICT');
    var ml = C.invariants(loose.exec.bind(loose));
    t.eq(inv(ml, 'v-money-integer').byConstruction, false, 'so the check is NOT flagged by construction');
    t.eq(inv(ml, 'v-money-integer').jsValue, 2, 'and it finds both fractional cells the loose table swallowed');
    t.eq(inv(ml, 'v-money-integer').ok, false, 'and goes red');
    t.eq(inv(ml, 'v-line-amount-derived').byConstruction, false,
      'amount_rp here is an ordinary column, so that check is not flagged either');
    loose.close();

    /* (i) a deliberately wrong predicate. The two routes then diverge by exactly
       the number of cancelled visits, which is the honest way to say the JS
       filter and the SQL filter are not the same filter. */
    t.neg('a wrong predicate on the SQL side makes the routes diverge by a stated amount');
    var batal = Number(first("SELECT count(*) FROM visit WHERE status = 'batal'", db));
    var wrong = [], k;
    for (k = 0; k < sqlList.length; k++) {
      wrong.push(sqlList[k].id === 'f-visits-active'
        ? { id: 'f-visits-active', value: Number(first("SELECT count(*) FROM visit WHERE status <> 'selesai'", db)) }
        : sqlList[k]);
    }
    var e1 = inv(C.compare(jsList, wrong), 'f-visits-active');
    t.eq(e1.agree, false, 'the routes disagree');
    t.eq(e1.delta, -batal, 'and by exactly the ' + batal + ' cancelled visits the wrong predicate let in');
    t.eq(C.summary(C.compare(jsList, wrong)).ok, false, 'the badge goes red');

    /* (ii) a corrupted row. Both routes move together — which is the point: the
       figure is not the check. The violation next to it is. */
    t.neg('one corrupted row moves both figures together and turns a named invariant red');
    db.run('SAVEPOINT g15');
    db.run('UPDATE visit SET queue_seq = queue_seq + 1000 WHERE id = (SELECT id FROM visit ORDER BY id LIMIT 1)');
    var m2 = C.compare(C.invariants(exec), E.sqlInvariants(db));
    var q0 = inv(merged, 'f-queue-seq-total'), q1 = inv(m2, 'f-queue-seq-total'), qv = inv(m2, 'v-queue-seq-counter');
    t.eq(q1.jsValue - q0.jsValue, 1000, 'the JS figure moved by 1000');
    t.eq(q1.agree, true, 'and the SQL figure moved with it — agreement is not correctness');
    t.eq(qv.jsValue, 1, 'v-queue-seq-counter reports one violation');
    t.eq(qv.ok, false, 'and fails');
    t.deep(C.summary(m2).failedIds, ['v-queue-seq-counter'], 'the badge names which invariant fired');
    db.run('ROLLBACK TO g15'); db.run('RELEASE g15');

    /* (iii) a row the SCHEMA accepts. NIK-FIKTIF-3201011234567890 satisfies the
       GLOB 'NIK-FIKTIF-*' CHECK; the JS route pins the whole shape and refuses
       it. This is the case that proves the second route is not the first route
       spelled differently. */
    t.neg('a fabrication marker the schema accepts is still caught, by the stricter route');
    db.run('SAVEPOINT g15b');
    t.eq(attempt(db, "UPDATE patient SET nik_demo = 'NIK-FIKTIF-3201011234567890' " +
      'WHERE rm_number = (SELECT rm_number FROM patient ORDER BY rm_number LIMIT 1)'), null,
      'the CHECK lets it through');
    var m3 = C.compare(C.invariants(exec), E.sqlInvariants(db));
    var fb = inv(m3, 'v-fabrication');
    t.eq(fb.jsValue, 1, 'v-fabrication reports one');
    t.eq(fb.ok, false, 'and fails');
    db.run('ROLLBACK TO g15b'); db.run('RELEASE g15b');

    t.neg('an id with no figure from the SQL route FAILS rather than passing');
    var dropped = [];
    for (k = 0; k < sqlList.length; k++) if (sqlList[k].id !== 'f-patients') dropped.push(sqlList[k]);
    var gone = inv(C.compare(jsList, dropped), 'f-patients');
    t.eq(gone.ok, false, 'f-patients fails');
    t.match(gone.why, /the SQL route produced no figure for this id/, 'and says nothing was verified');

    /* The firewall's own gate. If a table's raw read does not plan as a full
       scan, the census refuses to proceed rather than reporting a count over an
       index that may not contain every row. */
    t.neg('the census refuses a table whose raw read does not plan as a full scan');
    var shim = function (sql) {
      if (sql === 'EXPLAIN QUERY PLAN SELECT * FROM "visit"') {
        return [{ columns: ['id', 'parent', 'notused', 'detail'],
          values: [[0, 0, 0, 'SEARCH visit USING INDEX idx_visit_rm (rm_number=?)']] }];
      }
      return db.exec(sql);
    };
    var msg = '';
    var flagged = false;
    try { C.take(shim); }
    catch (err) { msg = err.message; flagged = err.censusRefusal === true; }
    t.ok(flagged, 'the Error carries censusRefusal');
    t.match(msg, /rombak: census refuses\. the plan for SELECT \* FROM "visit" is SEARCH/, 'and names the table and the plan');
    t.eq(C.plan(shim, 'visit').ok, false, 'the non-throwing form agrees, for the panel that has to keep rendering');
  });

  /* ====================================================== G16 ========== */

  group('G16 the export round trip and the header', function (t) {
    var f = fx();
    var report = E.exportReport(f.db);
    var h = report.header;

    t.prop('the exported file begins with the SQLite magic');
    t.eq(h.magic.length, 16, 'sixteen bytes');
    t.eq(h.magicOk, true, 'and they read SQLite format 3 followed by a NUL');
    t.prop('page size times page count is the file length, exactly');
    t.eq(h.pageSize * h.pageCount, report.byteLength, h.pageSize + ' x ' + h.pageCount + ' = ' + report.byteLength);
    t.eq(report.productMatches, true, 'the identity holds');
    t.prop('and the runner\'s version is in bytes 60 to 63');
    t.eq(h.userVersion, S.TARGET_VERSION, 'the header says ' + h.userVersion);
    t.eq(h.userVersion, RN.userVersion({ db: f.db }), 'and the pragma agrees');

    /* A fresh instance over those bytes. This is the property a "download your
       database" button is worth nothing without. */
    var d = E.openBytes(f.v9bytes);
    t.prop('a fresh database over the exported bytes reproduces the census exactly');
    var c2 = C.take(d.exec.bind(d));
    t.eq(c2.checksum, f.fingerprint.checksum, 'the same checksum');
    t.eq(c2.totalRows, f.fingerprint.totalRows, 'the same ' + c2.totalRows + ' rows');
    t.eq(c2.tableCount, f.fingerprint.tableCount, 'the same ' + c2.tableCount + ' tables');
    t.prop('and every invariant holds on it, by both routes');
    var sum = C.summary(C.compare(C.invariants(d.exec.bind(d)), E.sqlInvariants(d)));
    t.eq(sum.failed, 0, 'no failures');
    t.eq(sum.ok, true, 'the whole set passes');
    t.prop('and SQLite\'s own checks are clean on it');
    t.deep(E.integrityCheck(d), ['ok'], 'integrity_check');
    t.deep(E.foreignKeyCheck(d), [], 'foreign_key_check');
    t.prop('the chain head and the schema hash survive the round trip');
    t.eq(RN.fingerprint({ db: d }).chainHead, f.fingerprint.chainHead, 'the same chain head');
    t.eq(E.schemaHash(d), f.fingerprint.schemaHash, 'the same schema hash');

    /* THE SCHEMA HASH'S OWN NEGATIVE CONTROL. It is asserted in three places in
       this file — here, across G17's two independent walks, and in G0's "the
       suite left the database as it found it" — and every one of them is A equals
       B. MEASURED: make E.schemaHash() return the string 'deadbeef' and all three
       stay green, because both sides get 'deadbeef'. A hash only ever compared
       with itself is not a hash. So: one index added to this throwaway instance
       must move it, dropping the index must bring it back, and it must equal the
       digest of the same DDL text assembled in JavaScript rather than by
       group_concat. */
    t.neg('and one added index moves the schema hash, which is the only reason comparing it means anything');
    var h0 = E.schemaHash(d);
    d.run('CREATE INDEX zz_hash_probe ON visit(status)');
    var h1 = E.schemaHash(d);
    t.ne(h1, h0, 'the hash moved');
    t.eq(h1.length, 64, 'and is still a sha256');
    d.run('DROP INDEX zz_hash_probe');
    t.eq(E.schemaHash(d), h0, 'and dropping the index brings the original hash back');

    t.prop('and it is the digest of the stored DDL, assembled in JavaScript rather than by group_concat');
    var ddls = rows("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name", d), parts = [], q2;
    for (q2 = 0; q2 < ddls.length; q2++) parts.push(String(ddls[q2][0]));
    t.gt(parts.length, 50, parts.length + ' objects carry DDL');
    t.eq(D.sha256(parts.join(',')), h0, 'sha256 of the joined text is the schema hash');
    d.close();

    /* integrity_check is NOT a checksum, and a page that shows it as evidence
       should say what it does not cover. A byte flipped inside a page on the
       freelist changes the file and nothing notices, because nothing reads it. */
    t.prop('integrity_check is not a checksum: a byte flipped in free space still returns ok');
    var bytes = E.exportBytes(f.db);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pageSize = dv.getUint16(16);
    var trunk = dv.getUint32(32);
    var freelist = dv.getUint32(36);
    t.gt(freelist, 0, 'the file has ' + freelist + ' free pages to aim at');
    t.gt(trunk, 0, 'and a freelist trunk at page ' + trunk);
    var leaf = dv.getUint32((trunk - 1) * pageSize + 8);
    var at = (leaf - 1) * pageSize + 100;
    bytes[at] = bytes[at] ^ 0xff;
    var flipped = E.openBytes(bytes);
    t.deep(E.integrityCheck(flipped), ['ok'], 'a flipped byte on free page ' + leaf + ' is invisible to integrity_check');
    t.eq(C.take(flipped.exec.bind(flipped)).checksum, f.fingerprint.checksum,
      'and to the census, because nothing in the b-tree points at it');
    flipped.close();

    /* MEASURED HERE, not documented anywhere upstream: sql.js's export() frees
       every prepared statement, calls sqlite3_close_v2 and reopens the file. The
       JavaScript handle survives, so it looks like a read — but the CONNECTION
       is new, and PRAGMA foreign_keys is per connection. Exporting a database in
       the middle of a session therefore turns foreign key enforcement OFF and
       says nothing. Anything that exports and keeps writing has to set it again.
       This assertion is here so the day it stops being true, somebody is told. */
    t.prop('export() reopens the connection, so foreign_keys silently reverts to 0');
    var live = E.openBytes(f.v9bytes);
    t.eq(E.foreignKeysOn(live), 1, 'openBytes set it on');
    var thrownAway = live.export();
    t.gt(thrownAway.length, 0, 'the export produced ' + thrownAway.length + ' bytes');
    t.eq(E.foreignKeysOn(live), 0, 'and the pragma now reads 0 on the same handle');
    t.eq(attempt(live, "INSERT INTO bill_line (visit_id,line_no,label,grp,qty,unit_rp,covered,payer) " +
      "VALUES ('V-20260909-9999',1,'x','jasa',1,1000,0,'pasien')"), null,
      'an orphan bill line is accepted, because nothing is enforcing the foreign key any more');
    live.run('PRAGMA foreign_keys = ON');
    t.eq(E.foreignKeysOn(live), 1, 'setting it again is all it takes — but somebody has to');
    live.close();
  });

  /* ====================================================== G17 ========== */

  group('G17 determinism and fabrication', function (t) {
    var f = fx();

    t.prop('the same seed and the same pinned date build the same fixture');
    var f2 = SEED.build({});
    t.eq(f2.chain.head, f.seed.chain.head, 'the same legacy chain head');
    t.eq(f2.totalRows, f.seed.totalRows, 'the same ' + f2.totalRows + ' rows');
    t.deep(f2.counts, f.seed.counts, 'the same count in every table');

    /* A SECOND database, built from the seed and walked the whole ladder
       independently. Reopening the first one's bytes would assert that memcpy
       works. */
    var w = twin();
    t.prop('and two independent walks to v9 agree on the census checksum');
    t.eq(w.fingerprint.checksum, f.fingerprint.checksum, 'the same checksum');
    t.prop('on the audit chain head');
    t.eq(w.fingerprint.chainHead, f.fingerprint.chainHead, 'the same head over ' + w.fingerprint.chainCount + ' entries');
    t.prop('on the hash of the schema itself');
    t.eq(w.fingerprint.schemaHash, f.fingerprint.schemaHash, 'sha256 of group_concat(sql) ORDER BY name');
    t.prop('on the exported byte length');
    t.eq(w.fingerprint.exportLength, f.fingerprint.exportLength, w.fingerprint.exportLength + ' bytes both times');
    /* The last rung's AFTER census, reused rather than recomputed: it is the
       same value a fresh take() would return and the census is the expensive
       half of this file. */
    t.prop('and on the row count of every single table');
    var last = f.reports[f.reports.length - 1];
    var mine = (last && last.census && last.census.after) || C.take(f.db.exec.bind(f.db));
    var order = w.census.order, i;
    t.eq(order.length, mine.order.length, order.length + ' tables in both censuses');
    for (i = 0; i < order.length; i++) {
      t.eq(w.census.tables[order[i]].rows, (mine.tables[order[i]] || { rows: -1 }).rows, order[i]);
    }

    /* The pinned date is load-bearing, and the way to prove it is to move it. */
    t.prop('moving the pinned date by one day changes the chain head');
    var later = SEED.build({ pinnedToday: '2026-09-10' });
    t.ne(later.chain.head, f.seed.chain.head, 'a different head one day on');
    var earlier = SEED.build({ pinnedToday: '2026-09-08' });
    t.ne(earlier.chain.head, f.seed.chain.head, 'and one day back');
    t.ne(earlier.chain.head, later.chain.head, 'and the two are different from each other');
    t.prop('and so does changing the seed');
    t.ne(SEED.build({ seed: SEED.SEED + 1 }).chain.head, f.seed.chain.head, 'seed + 1 gives a different head');

    /* Every identifier in this database is visibly fabricated, and the check is
       stricter than the schema's own CHECK on purpose — see G15's third
       negative for what the difference buys. */
    t.prop('every fabricated identifier matches its pattern, and none could be mistaken for a real one');
    var pat = f.seed.tables.patient, ci = {}, k;
    for (k = 0; k < pat.columns.length; k++) ci[pat.columns[k]] = k;
    var badNik = 0, badBpjs = 0, badPhone = 0, sixteen = 0;
    for (i = 0; i < pat.rows.length; i++) {
      var r = pat.rows[i];
      if (!/^NIK-FIKTIF-[0-9]{6}$/.test(String(r[ci.nik_demo]))) badNik++;
      if (r[ci.bpjs_demo] !== null && !/^BPJS-FIKTIF-[0-9]{6}$/.test(String(r[ci.bpjs_demo]))) badBpjs++;
      if (!/^08[0-9]{2}-FIKTIF-[0-9]{3}$/.test(String(r[ci.phone]))) badPhone++;
      if (/[0-9]{16}/.test(String(r[ci.nik_demo]) + ' ' + String(r[ci.bpjs_demo]))) sixteen++;
    }
    t.eq(badNik, 0, 'all ' + pat.rows.length + ' nik_demo values are NIK-FIKTIF-######');
    t.eq(badBpjs, 0, 'every bpjs_demo is NULL or BPJS-FIKTIF-######');
    t.eq(badPhone, 0, 'every phone is 08##-FIKTIF-###');
    t.eq(sixteen, 0, 'and no value anywhere carries sixteen consecutive digits');
    t.prop('and every patient row admits that it is demo data');
    t.eq(Number(first('SELECT count(*) FROM patient WHERE is_demo = 1', f.db)),
      Number(first('SELECT count(*) FROM patient', f.db)), 'is_demo = 1 on every row');
    t.eq(Number(first('SELECT count(*) FROM patient WHERE dob > created_at', f.db)), 0,
      'and no date of birth is in the future');
  });

  /* ====================================================== G0 =========== */

  /* Registered last because it audits what the others did. A suite whose own
     counting is wrong reports a wrong number above the fold on a page whose
     entire pitch is that every number here is checkable. */
  group('G0 the suite audits itself', function (t) {
    var i, k;

    /* The last entry is the property being opened right now, which has not
       recorded its assertion yet — everything before it must have. */
    t.prop('every property this run declared actually executed an assertion');
    var silent = [];
    for (i = 0; i < props.length - 1; i++) if (props[i].executions === 0) silent.push(props[i].group + ' / ' + props[i].name);
    t.deep(silent, [], 'no property was declared and then left unasserted');

    t.prop('no two properties inside one group share a name');
    var dup = [], seen = {};
    for (i = 0; i < props.length; i++) {
      var key = props[i].group + ' :: ' + props[i].name;
      if (Object.prototype.hasOwnProperty.call(seen, key)) dup.push(key);
      seen[key] = true;
    }
    t.deep(dup, [], 'every property name is distinct within its group');

    t.prop('no two groups share a name');
    var gd = [], gs = {};
    for (i = 0; i < groups.length; i++) { if (gs[groups[i].name]) gd.push(groups[i].name); gs[groups[i].name] = true; }
    t.deep(gd, [], groups.length + ' groups, all distinctly named');

    /* Everything crossing page.evaluate must be structured-cloneable. An Error,
       a Uint8Array or a Database handle in here breaks the CI runner silently —
       it does not fail an assertion, it fails the page. */
    t.prop('every result carries nothing but strings and booleans');
    var bad = [];
    for (i = 0; i < RESULTS.length; i++) {
      var r = RESULTS[i];
      if (typeof r.group !== 'string' || typeof r.name !== 'string' ||
          typeof r.ok !== 'boolean' || typeof r.message !== 'string') {
        bad.push(i + ': ' + Object.prototype.toString.call(r));
      }
    }
    t.deep(bad, [], RESULTS.length + ' results, all structured-cloneable');

    t.prop('a real share of this suite is negative — properties that pass only on a refusal');
    var neg = 0;
    for (i = 0; i < props.length; i++) if (props[i].negative) neg++;
    t.gt(neg, 40, neg + ' of ' + props.length + ' properties are negative');
    t.lt(neg, props.length, 'and they are not all of it');

    /* The suite asserted against a database inside savepoints it always rolled
       back. If that is not true, every group after the first one was asserting
       against a database the earlier ones had modified. */
    t.prop('the suite left the database it asserted against exactly as it found it');
    var now = RN.fingerprint({ db: fx().db });
    fx().db.run('PRAGMA foreign_keys = ON');   // fingerprint() exports; see G16
    t.eq(now.checksum, fx().fingerprint.checksum, 'the census checksum is unchanged');
    t.eq(now.chainHead, fx().fingerprint.chainHead, 'the chain head is unchanged');
    t.eq(now.schemaHash, fx().fingerprint.schemaHash, 'the schema hash is unchanged');
    t.eq(now.userVersion, S.TARGET_VERSION, 'and it is still at v' + S.TARGET_VERSION);
  });

  /* ============================== the runner ============================ */

  /* G0 needs to see the results array while the run is still in flight, and a
     group receives only its context, so the array lives here. */
  var RESULTS = [];

  function runSync() {
    var results = [];
    RESULTS = results;
    props.length = 0;
    var t0 = E.now();
    var i;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      try { g.fn(makeCtx(results, g.name)); }
      catch (err) {
        results.push({
          group: g.name, name: 'group threw', ok: false,
          message: String(err && err.stack || err)
        });
      }
    }
    var passed = 0, negatives = 0, properties = props.length;
    for (i = 0; i < results.length; i++) if (results[i].ok) passed++;
    for (i = 0; i < props.length; i++) if (props[i].negative) negatives++;

    /* Per-group counts for the Tests tab, so the page never has to recount. */
    var byGroup = [], index = {};
    for (i = 0; i < groups.length; i++) {
      index[groups[i].name] = byGroup.length;
      byGroup.push({ group: groups[i].name, properties: 0, negatives: 0, executions: 0, passed: 0, failed: 0 });
    }
    for (i = 0; i < props.length; i++) {
      var b = byGroup[index[props[i].group]];
      if (!b) continue;
      b.properties++;
      if (props[i].negative) b.negatives++;
    }
    for (i = 0; i < results.length; i++) {
      var b2 = byGroup[index[results[i].group]];
      if (!b2) continue;
      b2.executions++;
      if (results[i].ok) b2.passed++; else b2.failed++;
    }

    return {
      results: results,
      passed: passed,
      failed: results.length - passed,
      total: results.length,
      properties: properties,
      executions: results.length,
      negatives: negatives,
      groups: groups.length,
      byGroup: byGroup,
      /* Included so a regression in engine.js's print handlers turns one test
         red instead of failing the whole CI job with every assertion green. */
      noise: E.noiseCount(),
      ms: Math.round(E.now() - t0)
    };
  }

  /* test/labs.test.js navigates with waitUntil: 'load', which fires when the
     last <script> has executed — BEFORE initSqlJs resolves. A synchronous run()
     would assert against a database with no tables, non-deterministically. */
  function run() { return E.ready().then(runSync); }

  root.ROMBAK_TESTS = { run: run, groups: groups, props: props };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ROMBAK_TESTS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
