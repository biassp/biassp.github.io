/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — census.js
 * THE VERIFICATION FIREWALL. This file is the reason the migration panel's
 * "nothing else changed" is worth reading, and it is written to be checkable by
 * a stranger with grep rather than by trust.
 *
 * This portfolio has shipped a proof that could only pass three times. In a
 * database lab that mistake is easier to make and much harder to see, because
 * SQL makes both sides of a comparison trivially derivable from one view and
 * the two statements look different even when the route through the b-tree is
 * identical. So the defence is structural, not careful:
 *
 *   - It knows exactly two names from the rest of the lab: the pure helpers it
 *     reads, and itself. §10.3 gives the grep — the lab's namespace prefix
 *     followed by capitals, over this file, uniqued — and if it ever prints a
 *     third name this file has been compromised. That is the whole test. It is
 *     also why not one comment below spells a sibling global out: a comment
 *     mentioning one would make the grep print it, and a check you have to
 *     interpret is a check nobody runs. A builder who wants the engine's query
 *     helper in here has misunderstood what the file is for.
 *   - Database access arrives as an INJECTED exec(sql). It cannot reach the
 *     engine's handle, its plan cache, its prepared-statement cache, or its
 *     idea of which migration is running. It cannot start a transaction.
 *   - The table list is built from sqlite_master AT CENSUS TIME. Handing it a
 *     list from the migration data would mean the thing being verified chose
 *     what got verified.
 *   - Every row it folds arrives through a bare SELECT * whose EXPLAIN QUERY
 *     PLAN was checked first. A read that used an index with a WHERE on it
 *     would see a subset and report a clean hash over it, which is precisely
 *     the failure this file exists to make impossible. If the plan is not a
 *     full scan the census REFUSES — it does not report.
 *   - It folds rows in plain JavaScript, order-independently, so a different
 *     physical row order after a rebuild is not a false positive.
 *   - It never reads schema_migration and never reads PRAGMA user_version. It
 *     therefore cannot accidentally agree with the version the migration says
 *     it reached. It knows the one table name in order to refuse to read it.
 *   - The before-snapshot is a VALUE, taken before the migration runs and
 *     passed in as an argument. There is no getter, no lazy closure and no
 *     re-read: the second most popular way to build a proof that cannot fail is
 *     to capture "before" after the fact.
 *
 * invariants(exec) is the JavaScript half of every live check on the page. It
 * reduces raw rows with hand-written arithmetic. The SQL half — index-assisted
 * aggregates, joins, GROUP BY — lives in the engine file and the two never call
 * each other. Both numbers and their difference go on screen. Two routes that
 * agree are worth something; one route printed twice is worth nothing.
 */
(function (root) {
  'use strict';

  var D = root.ROMBAK_DOMAIN;

  /* ------------------------------------------------------------ plumbing */

  // sql.js's own db.exec returns an ARRAY of result sets; §4.3 specifies exec as
  // returning one {columns, values}. Both are accepted, because the alternative
  // is a wrapper written for this file living in the engine — one more seam
  // where a convenience helper could grow.
  function q(exec, sql) {
    var r = exec(sql);
    if (!r) return { columns: [], values: [] };
    if (Object.prototype.toString.call(r) === '[object Array]') r = r.length ? r[0] : null;
    if (!r) return { columns: [], values: [] };
    return { columns: r.columns || [], values: r.values || [] };
  }

  function ident(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }
  function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

  function colIndex(columns, name) {
    var i;
    for (i = 0; i < columns.length; i++) if (columns[i] === name) return i;
    return -1;
  }

  // A BLOB comes back as a byte array and JSON.stringify would turn it into an
  // object keyed by index — deterministic but unreadable, and it would silently
  // change shape if a host ever handed back a plain Array instead. The end-state
  // schema is STRICT and has no BLOB column, so this is insurance rather than a
  // feature; it is here because a census that quietly mis-folds one column type
  // is worse than one that cannot read it.
  var HEX = '0123456789abcdef';
  function cell(v) {
    if (v === null || v === undefined) return null;
    var t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return v;
    if (typeof v.length === 'number') {
      var out = 'blob:', i, b;
      for (i = 0; i < v.length; i++) {
        b = v[i] & 255;
        out += HEX.charAt(b >> 4) + HEX.charAt(b & 15);
      }
      return out;
    }
    return String(v);
  }

  function refuse(message, extra) {
    var e = new Error('rombak: census refuses. ' + message);
    e.censusRefusal = true;
    if (extra) {
      var k;
      for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
    }
    throw e;
  }

  /* --------------------------------------------------------- table list */

  // The one table name this file knows, and it knows it in order to skip it.
  // Rules 3 and 6 of §4.3 collide without this: a list built from sqlite_master
  // contains schema_migration, every rung writes a row to it, and every rung
  // would then report a census violation against a table the census is not
  // allowed to look at.
  var SKIP = 'schema_migration';

  function tables(exec) {
    var res = q(exec,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" +
      ' AND name <> ' + lit(SKIP) + ' ORDER BY name');
    var out = [], i;
    for (i = 0; i < res.values.length; i++) out.push(String(res.values[i][0]));
    return out;
  }

  /* ---------------------------------------------------------- the gate */

  // What SQLite 3.49 actually prints for a bare SELECT * — measured, not
  // remembered — is one of exactly two shapes:
  //
  //   SCAN <t>
  //   SCAN <t> USING [COVERING] INDEX <ix>
  //
  // The second one is not a mistake and must be accepted: patient_chronic is
  // WITHOUT ROWID with PRIMARY KEY (rm_number, icd_code), so idx_chronic_code
  // contains both columns and is a narrower copy of the table than the table.
  // The planner prefers it and reads every row through it. A census that
  // demanded the literal string 'SCAN patient_chronic' would refuse this
  // database on the one table where nothing is wrong.
  //
  // What must be refused, and why each one matters:
  //   SEARCH ...            a seek, so a subset — the failure this gate exists for
  //   a PARTIAL index       reads only the rows matching the index predicate.
  //                         Reachable in this schema: ux_visit_active is partial
  //                         and `SELECT * FROM visit WHERE status NOT IN (...)`
  //                         really does plan as `SCAN visit USING INDEX
  //                         ux_visit_active`. One stray WHERE in this file and
  //                         the census would fold 150 of 2,569 rows and call it
  //                         a clean hash.
  //   an index this table does not list   the gate could not establish it is
  //                         total, so it fails closed instead of guessing
  //   USE TEMP B-TREE / more than one plan row / anything unrecognised
  //                         the read is not the read this file thinks it is
  function planFor(exec, table) {
    var res = q(exec, 'EXPLAIN QUERY PLAN SELECT * FROM ' + ident(table));
    var di = colIndex(res.columns, 'detail');
    var details = [], i, row;
    for (i = 0; i < res.values.length; i++) {
      row = res.values[i];
      details.push(String(row[di >= 0 ? di : row.length - 1]));
    }
    return details;
  }

  function partialIndexes(exec, table) {
    var res = q(exec, 'SELECT name, partial FROM pragma_index_list(' + lit(table) + ')');
    var map = {}, i, ni = colIndex(res.columns, 'name'), pi = colIndex(res.columns, 'partial');
    if (ni < 0) ni = 1;
    if (pi < 0) pi = 3;
    for (i = 0; i < res.values.length; i++) {
      map[String(res.values[i][ni])] = Number(res.values[i][pi]) === 1;
    }
    return map;
  }

  // -> { ok, plan, detail, index, covering, reason }. Does not throw: the UI
  // shows the verdict per table, and take() is the one that refuses.
  function plan(exec, table) {
    var details = planFor(exec, table);
    var out = {
      ok: false, plan: details, detail: details.length === 1 ? details[0] : details.join(' | '),
      index: null, covering: false, reason: ''
    };
    if (details.length !== 1) {
      out.reason = 'the plan has ' + details.length + ' step(s), so the read is not a single full scan';
      return out;
    }
    var d = details[0];
    // Exact match first, and deliberately so: a table may legitimately be named
    // something like `x USING COVERING INDEX y`, and for that table the whole
    // string is its name. Parsing the index shape first would read the name as a
    // route and reject a perfectly ordinary scan.
    if (d === 'SCAN ' + table) { out.ok = true; return out; }
    var head = 'SCAN ' + table + ' USING ';
    if (d.indexOf(head) !== 0) {
      out.reason = 'the plan is not a full scan of ' + table;
      return out;
    }
    var rest = d.slice(head.length), name = null, covering = false;
    if (rest.indexOf('COVERING INDEX ') === 0) { covering = true; name = rest.slice(15); }
    else if (rest.indexOf('INDEX ') === 0) { name = rest.slice(6); }
    if (name === null || name === '') {
      out.reason = 'the plan uses a route this file does not recognise as a full scan';
      return out;
    }
    out.index = name;
    out.covering = covering;
    var partial = partialIndexes(exec, table);
    if (!Object.prototype.hasOwnProperty.call(partial, name)) {
      out.reason = 'the plan reads through index ' + name + ', which this table does not list —' +
        ' the census cannot establish that it covers every row';
      return out;
    }
    if (partial[name]) {
      out.reason = 'the plan reads through PARTIAL index ' + name +
        ', which holds only the rows matching its own predicate';
      return out;
    }
    out.ok = true;
    return out;
  }

  /* ------------------------------------------------- reading and folding */

  // The only content read in this file. Every caller goes through it, so the
  // gate cannot be bypassed by a later addition that "just needs one column".
  function read(exec, table) {
    var verdict = plan(exec, table);
    if (!verdict.ok) {
      refuse('the plan for SELECT * FROM ' + ident(table) + ' is ' + verdict.detail + ' — ' +
        verdict.reason, { table: table, plan: verdict.plan, verdict: verdict });
    }
    var res = q(exec, 'SELECT * FROM ' + ident(table));
    return { table: table, columns: res.columns.slice(0), values: res.values, plan: verdict.detail };
  }

  function rowObject(columns, values) {
    var o = {}, i;
    for (i = 0; i < columns.length; i++) o[columns[i]] = cell(values[i]);
    return o;
  }

  // Order-independent on purpose. A twelve-step rebuild copies rows out and back
  // and the physical order afterwards is whatever the copy's SELECT produced; an
  // order-sensitive fold would report every rebuild as a change and the reader
  // would learn to ignore the census, which is worse than not having one.
  function foldRows(columns, values) {
    var h = 0, i;
    for (i = 0; i < values.length; i++) {
      h = (h + D.fnv1a(D.canonical(rowObject(columns, values[i])))) >>> 0;
    }
    return h;
  }

  function take(exec) {
    var names = tables(exec), out = {}, i, t, r, total = 0, sum = 0;
    for (i = 0; i < names.length; i++) {
      t = names[i];
      r = read(exec, t);
      out[t] = { rows: r.values.length, hash: foldRows(r.columns, r.values), plan: r.plan };
      total += r.values.length;
      sum = (sum + D.fnv1a(t + '\u0000' + out[t].rows + '\u0000' + out[t].hash)) >>> 0;
    }
    return {
      tables: out,
      order: names,
      tableCount: names.length,
      totalRows: total,
      checksum: sum,
      at: nowMs()
    };
  }

  // `at` is wall-clock metadata and is NOT part of checksum. Two censuses are
  // compared with diff() or on checksum, never by deep-equalling the object —
  // which would fail on the clock and pass on everything that matters.
  function nowMs() {
    try { return Date.now(); } catch (e) { return 0; }
  }

  /* ----------------------------------------------------------- the diff */

  function names2(before, after) {
    var seen = {}, out = [], k;
    for (k in before.tables) if (Object.prototype.hasOwnProperty.call(before.tables, k)) { seen[k] = 1; }
    for (k in after.tables) if (Object.prototype.hasOwnProperty.call(after.tables, k)) { seen[k] = 1; }
    for (k in seen) if (Object.prototype.hasOwnProperty.call(seen, k)) out.push(k);
    out.sort();
    return out;
  }

  // Only what moved. An empty array is the sentence "nothing else changed", and
  // it is the only form of that sentence the page is allowed to print.
  function diff(before, after) {
    var list = names2(before, after), out = [], i, t, b, a;
    for (i = 0; i < list.length; i++) {
      t = list[i];
      b = before.tables[t] || null;
      a = after.tables[t] || null;
      if (!b) { out.push({ table: t, rowsBefore: null, rowsAfter: a.rows, hashBefore: null, hashAfter: a.hash, hashChanged: true, status: 'added' }); continue; }
      if (!a) { out.push({ table: t, rowsBefore: b.rows, rowsAfter: null, hashBefore: b.hash, hashAfter: null, hashChanged: true, status: 'dropped' }); continue; }
      if (b.rows !== a.rows || b.hash !== a.hash) {
        out.push({
          table: t, rowsBefore: b.rows, rowsAfter: a.rows,
          hashBefore: b.hash, hashAfter: a.hash,
          hashChanged: b.hash !== a.hash, status: 'changed'
        });
      }
    }
    return out;
  }

  /* --------------------------------------------------- the declaration */

  // A migration declares, in advance, which tables it is allowed to touch and
  // how far. Anything else that moved is a violation named out loud.
  //
  //   'new'        absent before, present after
  //   'dropped'    present before, absent after
  //   'bytes'      the ROW COUNT must not move; the hash is free
  //   'rows+bytes' anything goes in this table
  //   (absent)     rows AND hash must both be identical
  //
  // 'bytes' cannot mean "the hash did not change", however much it sounds like
  // it: the fold is over row VALUES keyed by column name, so a rung that adds a
  // column changes the hash of every row without touching a single one of them
  // (v2 adds patient.pregnant; v4 adds patient.rm_seq; v8 renames four money
  // columns; v9 replaces one column with three). Row count is what survives that
  // and is still worth asserting — v3 declares nothing at all, and fifteen
  // CREATE INDEX statements changing not one byte of one row across every table
  // is a real property, checked here.
  function checkDeclaration(before, after, declares) {
    var dec = declares || {};
    var list = names2(before, after), viol = [], i, t, b, a, d;

    for (i = 0; i < list.length; i++) {
      t = list[i];
      b = before.tables[t] || null;
      a = after.tables[t] || null;
      d = Object.prototype.hasOwnProperty.call(dec, t) ? dec[t] : null;

      if (!b && a) {
        if (d !== 'new') {
          viol.push(v(t, d, b, a, 'appeared',
            t + ' appeared with ' + a.rows + ' row(s) and was ' +
            (d ? 'declared ' + d : 'not declared') + ' — a new table must be declared "new"'));
        }
        continue;
      }
      if (b && !a) {
        if (d !== 'dropped') {
          viol.push(v(t, d, b, a, 'disappeared',
            t + ' disappeared with ' + b.rows + ' row(s) and was ' +
            (d ? 'declared ' + d : 'not declared') + ' — a dropped table must be declared "dropped"'));
        }
        continue;
      }
      if (d === 'new') {
        viol.push(v(t, d, b, a, 'not-new', t + ' was declared "new" but already had ' + b.rows + ' row(s) before'));
        continue;
      }
      if (d === 'dropped') {
        viol.push(v(t, d, b, a, 'not-dropped', t + ' was declared "dropped" but is still here with ' + a.rows + ' row(s)'));
        continue;
      }
      if (d === 'rows+bytes') continue;
      if (d === 'bytes') {
        if (b.rows !== a.rows) {
          viol.push(v(t, d, b, a, 'rows-moved',
            t + ' was declared "bytes" — column shapes may change, row count may not — but ' +
            b.rows + ' row(s) became ' + a.rows + ' (' + delta(a.rows - b.rows) + ')'));
        }
        continue;
      }
      if (d !== null) {
        viol.push(v(t, d, b, a, 'unknown-declaration',
          t + ' carries the declaration ' + D.canonical(d) + ', which is not one of new / dropped / bytes / rows+bytes'));
        continue;
      }
      if (b.rows !== a.rows || b.hash !== a.hash) {
        viol.push(v(t, d, b, a, 'undeclared-change',
          t + ' changed but was not declared: ' + b.rows + ' -> ' + a.rows + ' row(s) (' +
          delta(a.rows - b.rows) + '), fold ' + b.hash + ' -> ' + a.hash));
      }
    }

    // A declaration for a table that is in neither census is a stale
    // declaration, and a stale declaration is how a migration gets credit for
    // touching something that no longer exists.
    var k;
    for (k in dec) {
      if (!Object.prototype.hasOwnProperty.call(dec, k)) continue;
      if (!before.tables[k] && !after.tables[k]) {
        viol.push(v(k, dec[k], null, null, 'declared-absent',
          k + ' is declared ' + dec[k] + ' but exists in neither census'));
      }
    }

    return { ok: viol.length === 0, violations: viol, checked: list.length, declared: countKeys(dec) };
  }

  function v(table, declared, b, a, rule, message) {
    return {
      table: table, declared: declared, rule: rule, message: message,
      rowsBefore: b ? b.rows : null, rowsAfter: a ? a.rows : null,
      hashChanged: !!(b && a && b.hash !== a.hash)
    };
  }

  function delta(n) { return n > 0 ? '+' + n : String(n); }

  // A failure message with the wrong grammar in it reads like a machine that
  // does not know what it counted.
  var SINGULAR = {
    rows: 'row', bills: 'bill', lines: 'line', visits: 'visit', encounters: 'encounter',
    diagnoses: 'diagnosis', gaps: 'gap', entries: 'entry', mismatches: 'mismatch',
    patients: 'patient', cells: 'cell', columns: 'column'
  };
  function count(n, unit) {
    var u = unit || 'row(s)';
    if (n === 1 && Object.prototype.hasOwnProperty.call(SINGULAR, u)) u = SINGULAR[u];
    return n + ' ' + u;
  }

  function countKeys(o) {
    var n = 0, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++;
    return n;
  }

  /* ------------------------------------------------------- invariants */

  // Each check reduces raw rows with arithmetic written out longhand. Nothing
  // here delegates to SQL, and nothing here is allowed to be a restatement of a
  // constraint the database is already enforcing: a CHECK the schema holds makes
  // the matching query unable to return a row, and an assertion that cannot go
  // red is decoration. The ones below that CAN go red are marked; several of
  // them are red at v1 on purpose, which is how you can tell they are wired up.
  //
  // kind 'figure'    a quantity. ok is decided by AGREEMENT with the SQL route,
  //                  which lives in another file, so it is null here and filled
  //                  in by compare(). Five of these are the headline figures.
  // kind 'violation' a count of rows that break a stated property. ok is
  //                  jsValue === 0 and is decidable here on its own.

  function ctxFor(exec) {
    var cache = {}, colcache = {};
    return {
      exec: exec,
      // Existence is asked of sqlite_master, not of a table list handed in.
      names: tables(exec),
      has: function (t) { return this.names.indexOf(t) >= 0; },
      // table_xinfo, not table_info, and the difference is load-bearing:
      // table_info OMITS generated columns, so amount_rp — the whole subject of
      // v8 — is invisible to it and three of the checks below silently reported
      // "this schema version has no such column" at v9. hidden = 1 is a virtual
      // table's own hidden column and would not appear in SELECT *; 2 and 3 are
      // VIRTUAL and STORED generated columns, which do.
      cols: function (t) {
        if (colcache[t]) return colcache[t];
        var res = q(exec, 'SELECT name FROM pragma_table_xinfo(' + lit(t) + ') WHERE hidden <> 1'),
          out = [], i;
        for (i = 0; i < res.values.length; i++) out.push(String(res.values[i][0]));
        colcache[t] = out;
        return out;
      },
      hasCol: function (t, c) { return this.cols(t).indexOf(c) >= 0; },
      // A table is read once per invariants() call and folded many times. An
      // empty table returns no result set at all from sql.js, which is why
      // columns come from pragma_table_info and not from the read.
      rows: function (t) {
        if (!cache[t]) {
          var r = read(exec, t);
          var columns = r.columns.length ? r.columns : this.cols(t);
          var out = [], i;
          for (i = 0; i < r.values.length; i++) out.push(rowObject(columns, r.values[i]));
          cache[t] = out;
        }
        return cache[t];
      },
      /* THREE PROBES THAT ANSWER "COULD THIS CHECK EVER BE NON-ZERO HERE?".
         Three of the properties below are enforced by the schema itself once the
         ladder has passed v8 — a generated column, a STRICT integer column, a
         table CHECK — and once that is true no row can be stored that breaks
         them. They still run, because at v1 the same code finds real violations
         and because a schema can lose a constraint; but a page that printed them
         with the same green tick as the checks that could have failed would be
         claiming a verification it did not perform. §0.4 says so about the
         typeof sweep; it is true of all three. Each is asked of the schema in
         front of us, never of a version number, so a database that lost the
         constraint is reported as verifiable again. */
      generated: function (t, c) {
        try {
          var res = q(exec, 'SELECT count(*) FROM pragma_table_xinfo(' + lit(t) +
            ') WHERE name = ' + lit(c) + ' AND hidden IN (2, 3)');
          return Number(res.values[0][0]) > 0;
        } catch (e) { return false; }
      },
      strict: function (t) {
        try {
          var res = q(exec, "SELECT strict FROM pragma_table_list WHERE schema = 'main' AND name = " + lit(t));
          return res.values.length ? Number(res.values[0][0]) === 1 : false;
        } catch (e) { return false; }
      },
      // A column's DECLARED type, from table_xinfo. STRICT permits REAL as
      // readily as INTEGER, so "this table is STRICT" is not on its own the
      // reason a money cell cannot hold 1.5 — the declared type is the other
      // half, and both are asked for.
      declaredType: function (t, c2) {
        try {
          var res = q(exec, 'SELECT type FROM pragma_table_xinfo(' + lit(t) + ') WHERE name = ' + lit(c2));
          return res.values.length ? String(res.values[0][0] || '') : '';
        } catch (e) { return ''; }
      },
      // The stored CREATE TABLE text, so a CHECK that makes a query unfalsifiable
      // can be found by looking for the CHECK.
      ddl: function (t) {
        try {
          var res = q(exec, 'SELECT sql FROM sqlite_master WHERE type = ' + lit('table') + ' AND name = ' + lit(t));
          return res.values.length ? String(res.values[0][0] || '') : '';
        } catch (e) { return ''; }
      },
      // Whichever of these column names this schema version actually has.
      pick: function (t, candidates) {
        var cs = this.cols(t), i;
        for (i = 0; i < candidates.length; i++) if (cs.indexOf(candidates[i]) >= 0) return candidates[i];
        return null;
      }
    };
  }

  var MONEY_BILL = ['total_tarif', 'ditanggung', 'ditanggung_lain', 'dibayar_pasien'];
  var REFERENCE = ['role', 'poli', 'queue_state', 'queue_transition', 'queue_transition_role',
    'acuity', 'tindakan', 'kecelakaan', 'allergy_class', 'icd10_chapter', 'icd10'];

  function sumInt(list, key) {
    var s = 0, i, v2, exact = true;
    for (i = 0; i < list.length; i++) {
      v2 = list[i][key];
      if (typeof v2 !== 'number') { exact = false; continue; }
      if (v2 !== Math.floor(v2)) exact = false;
      s += v2;
    }
    return { sum: s, exact: exact };
  }

  function keyOf(parts) { return parts.join('\u0000'); }

  var CHECKS = [
    /* ---- the five headline figures ---------------------------------- */
    {
      id: 'f-patients', kind: 'figure', unit: 'rows',
      name: 'the number of patients, counted by walking the raw rows',
      needs: function (c) { return c.has('patient'); },
      run: function (c) { return { value: c.rows('patient').length }; }
    },
    {
      id: 'f-bill-line-money', kind: 'figure', unit: 'rupiah',
      name: 'every bill line added up by hand',
      needs: function (c) { return c.has('bill_line') && c.pick('bill_line', ['amount_rp', 'amount']); },
      run: function (c) {
        var col = c.pick('bill_line', ['amount_rp', 'amount']);
        var r = sumInt(c.rows('bill_line'), col);
        return {
          value: r.sum, exact: r.exact,
          why: r.exact ? '' : 'this version stores line money as REAL, so the sum is a float and the two ' +
            'routes may differ in the last bits — which is the reason v8 exists'
        };
      }
    },
    {
      id: 'f-bill-total-money', kind: 'figure', unit: 'rupiah',
      name: 'every bill total added up by hand',
      needs: function (c) { return c.has('bill') && c.pick('bill', ['total_tarif_rp', 'total_tarif']); },
      run: function (c) {
        var col = c.pick('bill', ['total_tarif_rp', 'total_tarif']);
        var r = sumInt(c.rows('bill'), col);
        return {
          value: r.sum, exact: r.exact,
          why: r.exact ? '' : 'REAL money: the float sum is not bit-stable across two summation orders'
        };
      }
    },
    {
      id: 'f-queue-seq-total', kind: 'figure', unit: 'seq',
      name: 'the sum of every queue sequence number',
      needs: function (c) { return c.has('visit'); },
      run: function (c) { return { value: sumInt(c.rows('visit'), 'queue_seq').sum }; }
    },
    {
      // The one figure where the two routes genuinely take different roads:
      // ux_visit_active is a PARTIAL index and the SQL side reads it, while this
      // side filters every visit in a loop. It is also where a wrong predicate
      // shows up as a number instead of as a silence — spell the SQL half with
      // `<> 'selesai' AND <> 'batal'` and the partial index is skipped; forget
      // one of the two states and the routes diverge by exactly the count of it.
      id: 'f-visits-active', kind: 'figure', unit: 'rows',
      name: 'visits still in play, filtered in a loop rather than through the partial index',
      needs: function (c) { return c.has('visit'); },
      run: function (c) {
        var rows = c.rows('visit'), n = 0, i, s;
        for (i = 0; i < rows.length; i++) {
          s = rows[i].status;
          if (s !== 'selesai' && s !== 'batal') n++;
        }
        return { value: n };
      }
    },

    /* ---- properties, counted as violations -------------------------- */
    {
      id: 'v-bill-parts-sum', kind: 'violation', unit: 'bills',
      name: 'every bill’s parts add up to its total',
      needs: function (c) { return c.has('bill') && c.pick('bill', ['total_tarif_rp', 'total_tarif']); },
      run: function (c) {
        var suffix = c.hasCol('bill', 'total_tarif_rp') ? '_rp' : '';
        var rows = c.rows('bill'), bad = 0, i, r, parts;
        for (i = 0; i < rows.length; i++) {
          r = rows[i];
          parts = r['ditanggung' + suffix] + r['ditanggung_lain' + suffix] + r['dibayar_pasien' + suffix];
          if (r['total_tarif' + suffix] !== parts) bad++;
        }
        // From v8 the same arithmetic is a table CHECK, so no row that breaks it
        // can be stored: VERIFIED, the one-column corruption is refused with
        // `CHECK constraint failed: total_tarif_rp = ditanggung_rp + ...`.
        var enforced = /CHECK\s*\(\s*total_tarif_rp\s*=\s*ditanggung_rp/.test(c.ddl('bill'));
        return {
          value: bad, byConstruction: enforced,
          why: enforced ? 'a table CHECK on bill enforces this arithmetic, so no row that broke it could ' +
            'have been stored — at this schema version the zero is a fact about the CHECK, not a verification. ' +
            'The same walk finds real violations before v8.' : ''
        };
      }
    },
    {
      id: 'v-bill-lines-tie', kind: 'violation', unit: 'bills',
      name: 'every bill’s lines add up to its total',
      needs: function (c) {
        return c.has('bill') && c.has('bill_line') &&
          c.pick('bill_line', ['amount_rp', 'amount']) && c.pick('bill', ['total_tarif_rp', 'total_tarif']);
      },
      run: function (c) {
        // A JS Map stands in for the SQL side's derived-table join. Sums are
        // integer adds at v8 and later; before that they are the float adds the
        // legacy schema forces, and that is the point of the number.
        var amt = c.pick('bill_line', ['amount_rp', 'amount']);
        var tot = c.pick('bill', ['total_tarif_rp', 'total_tarif']);
        var byVisit = {}, lines = c.rows('bill_line'), i, k;
        for (i = 0; i < lines.length; i++) {
          k = String(lines[i].visit_id);
          byVisit[k] = (byVisit[k] || 0) + (lines[i][amt] || 0);
        }
        var bills = c.rows('bill'), bad = 0;
        for (i = 0; i < bills.length; i++) {
          k = String(bills[i].visit_id);
          if ((byVisit[k] || 0) !== bills[i][tot]) bad++;
        }
        return { value: bad };
      }
    },
    {
      id: 'v-line-amount-derived', kind: 'violation', unit: 'lines',
      name: 'every line’s amount is its quantity times its unit price',
      needs: function (c) {
        return c.has('bill_line') && c.pick('bill_line', ['amount_rp', 'amount']) &&
          c.pick('bill_line', ['unit_rp', 'unit']);
      },
      run: function (c) {
        // At v8 and later the SQL side of this is a GENERATED column, so SQL
        // cannot disagree with itself; the only way to learn anything is to
        // recompute it in another language from qty and unit. Note what this is
        // NOT: it is not a verification of the v8 backfill. Verifying a
        // generated column with its own expression is the third trap in §10.3,
        // and the backfill is checked against bill.total_tarif captured before
        // the rung ran — in the runner, not here.
        var amt = c.pick('bill_line', ['amount_rp', 'amount']);
        var unit = c.pick('bill_line', ['unit_rp', 'unit']);
        var rows = c.rows('bill_line'), bad = 0, i, r;
        for (i = 0; i < rows.length; i++) {
          r = rows[i];
          if (r[amt] !== r.qty * r[unit]) bad++;
        }
        /* And once amount_rp IS the expression, neither route can disagree with
           it: MEASURED, `UPDATE bill_line SET qty = qty + 1` is accepted and both
           routes still answer 0, because SQLite recomputed the column and this
           loop recomputed the same product. Flagged rather than deleted, because
           the identical walk is a real check on the legacy table. */
        var gen = c.generated('bill_line', amt);
        return {
          value: bad, byConstruction: gen,
          why: gen ? amt + ' is a GENERATED column whose expression is qty * ' + unit + ', so it cannot ' +
            'differ from qty * ' + unit + ' however the row is written — at this schema version the zero is a ' +
            'fact about the generated column. What DOES verify the v8 backfill is bill.total_tarif, captured ' +
            'before the rung ran, on the Migrations tab.' : ''
        };
      }
    },
    {
      id: 'v-queue-seq-counter', kind: 'violation', unit: 'visits',
      name: 'no visit holds a queue sequence past its day’s counter',
      needs: function (c) { return c.has('visit') && c.has('queue_counter'); },
      run: function (c) {
        var last = {}, cs = c.rows('queue_counter'), i, r;
        for (i = 0; i < cs.length; i++) last[keyOf([cs[i].visit_date, cs[i].poli_id])] = cs[i].last_seq;
        var rows = c.rows('visit'), bad = 0, k;
        for (i = 0; i < rows.length; i++) {
          r = rows[i];
          k = keyOf([r.visit_date, r.poli_id]);
          if (!Object.prototype.hasOwnProperty.call(last, k) || r.queue_seq > last[k]) bad++;
        }
        return { value: bad };
      }
    },
    {
      id: 'v-queue-no-scope', kind: 'violation', unit: 'visits',
      name: 'a queue number is unique only inside its day and poli — and is',
      needs: function (c) { return c.has('visit'); },
      run: function (c) {
        var seen = {}, rows = c.rows('visit'), bad = 0, i, k;
        for (i = 0; i < rows.length; i++) {
          k = keyOf([rows[i].visit_date, rows[i].poli_id, rows[i].queue_no]);
          if (seen[k]) bad++; else seen[k] = 1;
        }
        return { value: bad };
      }
    },
    {
      id: 'v-visit-patient', kind: 'violation', unit: 'visits',
      name: 'every visit names a patient that exists',
      needs: function (c) { return c.has('visit') && c.has('patient'); },
      run: function (c) { return { value: missing(c.rows('visit'), 'rm_number', c.rows('patient'), 'rm_number') }; }
    },
    {
      id: 'v-encounter-visit', kind: 'violation', unit: 'encounters',
      name: 'every encounter names a visit that exists, and copies its patient correctly',
      needs: function (c) { return c.has('encounter') && c.has('visit'); },
      run: function (c) {
        var rm = {}, vs = c.rows('visit'), i;
        for (i = 0; i < vs.length; i++) rm[String(vs[i].id)] = vs[i].rm_number;
        var rows = c.rows('encounter'), bad = 0, k;
        for (i = 0; i < rows.length; i++) {
          k = String(rows[i].visit_id);
          if (!Object.prototype.hasOwnProperty.call(rm, k)) { bad++; continue; }
          if (rows[i].rm_number !== rm[k]) bad++;   // the denormalised copy, checked the long way
        }
        return { value: bad };
      }
    },
    {
      id: 'v-bill-line-parent', kind: 'violation', unit: 'lines',
      name: 'no bill line is an orphan',
      needs: function (c) { return c.has('bill_line') && c.has('bill'); },
      run: function (c) { return { value: missing(c.rows('bill_line'), 'visit_id', c.rows('bill'), 'visit_id') }; }
    },
    {
      id: 'v-dx-icd-known', kind: 'violation', unit: 'diagnoses',
      name: 'every coded diagnosis names a code in the ICD-10 table',
      needs: function (c) { return c.has('encounter_diagnosis') && c.has('icd10'); },
      run: function (c) { return { value: missing(c.rows('encounter_diagnosis'), 'icd_code', c.rows('icd10'), 'code') }; }
    },
    {
      id: 'v-primary-dx', kind: 'violation', unit: 'encounters',
      name: 'an encounter with diagnoses has exactly one primary one',
      needs: function (c) { return c.has('encounter_diagnosis'); },
      run: function (c) {
        // The partial unique index enforces at most one. Exactly one is not a
        // constraint anywhere in the schema, which is why counting it here is
        // worth doing: a rebuild that dropped the index would still pass "at
        // most one" for a while, and a backfill that lost the flag would pass it
        // forever.
        var tally = {}, rows = c.rows('encounter_diagnosis'), i, k;
        for (i = 0; i < rows.length; i++) {
          k = String(rows[i].encounter_id);
          if (!tally[k]) tally[k] = 0;
          if (rows[i].is_primary === 1) tally[k]++;
        }
        var bad = 0;
        for (k in tally) if (Object.prototype.hasOwnProperty.call(tally, k) && tally[k] !== 1) bad++;
        return { value: bad };
      }
    },
    {
      id: 'v-audit-contiguous', kind: 'violation', unit: 'gaps',
      name: 'the audit sequence runs 0..n-1 with no gap and no repeat',
      needs: function (c) { return c.has('audit_entry'); },
      run: function (c) {
        var seqs = [], rows = c.rows('audit_entry'), i;
        for (i = 0; i < rows.length; i++) seqs.push(Number(rows[i].seq));
        seqs.sort(function (a, b) { return a - b; });
        var bad = 0;
        for (i = 0; i < seqs.length; i++) if (seqs[i] !== i) bad++;
        return { value: bad };
      }
    },
    {
      id: 'v-audit-hash', kind: 'violation', unit: 'entries',
      name: 'every audit hash recomputes from the row it commits to',
      needs: function (c) { return c.has('audit_entry'); },
      run: function (c) {
        // The one check in the lab that no SQL query can perform at all, and the
        // reason the SHA-256 is written out in JavaScript instead of borrowed
        // from crypto.subtle: this has to be synchronous and it has to run over
        // the rows as they are, at whatever schema version they are in. The
        // polymorphic entity column is one string before v9 and three typed
        // columns after it, and the hash input is the same either way — which is
        // the only reason the v9 rebuild can be verified at all.
        var rows = c.rows('audit_entry'), i, r, entry, bad = 0, prev = null;
        var ordered = rows.slice(0).sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
        var three = c.hasCol('audit_entry', 'ent_patient');
        for (i = 0; i < ordered.length; i++) {
          r = ordered[i];
          entry = {
            seq: Number(r.seq), at: r.at, actorId: r.actor_id, actorName: r.actor_name,
            actorRole: r.actor_role, action: r.action, entity: r.entity,
            entityId: three ? firstNotNull([r.ent_patient, r.ent_visit, r.ent_encounter]) : r.entity_id,
            summary: r.summary, detail: r.detail, prevHash: r.prev_hash
          };
          if (D.hashEntry(entry) !== r.hash) bad++;
          // The link, not just the row: a re-hashed row whose prev_hash points
          // somewhere else is a fork, and every hash in it recomputes.
          if (i > 0 && r.prev_hash !== prev) bad++;
          prev = r.hash;
        }
        return { value: bad };
      }
    },
    {
      id: 'v-audit-commitment', kind: 'violation', unit: 'mismatches',
      name: 'the length-and-head commitment agrees with the chain it commits to',
      needs: function (c) { return c.has('audit_entry') && c.has('audit_commitment'); },
      run: function (c) {
        var rows = c.rows('audit_entry'), com = c.rows('audit_commitment'), i, head = null, top = -1;
        for (i = 0; i < rows.length; i++) if (Number(rows[i].seq) > top) { top = Number(rows[i].seq); head = rows[i].hash; }
        var bad = 0;
        for (i = 0; i < com.length; i++) {
          if (com[i].k !== 'chain') { bad++; continue; }
          if (Number(com[i].count) !== rows.length) bad++;
          if (com[i].head !== head) bad++;
        }
        if (!com.length && rows.length) bad++;
        return { value: bad };
      }
    },
    {
      id: 'v-rm-number-seq', kind: 'violation', unit: 'patients',
      name: 'every medical-record number matches its own sequence number',
      needs: function (c) { return c.has('patient') && c.hasCol('patient', 'rm_seq'); },
      run: function (c) {
        var rows = c.rows('patient'), bad = 0, i;
        for (i = 0; i < rows.length; i++) {
          if (rows[i].rm_number !== D.rmNumber(rows[i].rm_seq)) bad++;
        }
        return { value: bad };
      }
    },
    {
      id: 'v-fabrication', kind: 'violation', unit: 'patients',
      name: 'every identifier is visibly fabricated and every row admits it',
      needs: function (c) { return c.has('patient'); },
      run: function (c) {
        // Stricter than the schema on purpose. The CHECK says NIK-FIKTIF-*, so
        // NIK-FIKTIF-3201011234567890 satisfies it; the regex here pins the
        // shape, so a real-looking identifier smuggled in behind the prefix is
        // still caught. Two routes disagreeing about what "fabricated" means is
        // the only way to find that out.
        var nik = /^NIK-FIKTIF-[0-9]{6}$/, bpjs = /^BPJS-FIKTIF-[0-9]{6}$/,
          phone = /^08[0-9]{2}-FIKTIF-[0-9]{3}$/, digits = /[0-9]{16}/;
        var rows = c.rows('patient'), bad = 0, i, r;
        for (i = 0; i < rows.length; i++) {
          r = rows[i];
          if (!nik.test(String(r.nik_demo))) { bad++; continue; }
          if (r.bpjs_demo !== null && !bpjs.test(String(r.bpjs_demo))) { bad++; continue; }
          if (!phone.test(String(r.phone))) { bad++; continue; }
          if (digits.test(String(r.nik_demo)) || digits.test(String(r.bpjs_demo))) { bad++; continue; }
          if (Number(r.is_demo) !== 1) bad++;
        }
        return { value: bad };
      }
    },
    {
      id: 'v-money-integer', kind: 'violation', unit: 'cells',
      name: 'every money cell holds an integer number of rupiah',
      needs: function (c) { return c.has('bill') || c.has('bill_line'); },
      run: function (c) {
        // RED BEFORE v8, GREEN AFTER, and that is the demonstration. After v8
        // the columns are INTEGER in a STRICT table, so nothing else can be
        // stored and the check becomes a fact about STRICT rather than a
        // verification — §0.4 and G7 both say so. Before v8 it finds the two
        // rows the fixture plants: a float that a REAL multiply moved, and a
        // currency-prefixed string a spreadsheet exported.
        var bad = 0, i, j, r, cols2, cn, val, LINE = ['qty', 'unit', 'amount'];
        /* `st` starts false and is EARNED, table by table and column by column.
           Starting it true and looking for a reason to clear it is how a probe
           comes to answer "unstorable" about the legacy table. */
        var st = c.has('bill') || c.has('bill_line'), seen = 0;
        function integerInStrict(t, cn2) {
          seen++;
          if (!c.strict(t)) return false;
          return /^INT/i.test(c.declaredType(t, cn2));
        }
        if (c.has('bill')) {
          cols2 = [];
          for (j = 0; j < MONEY_BILL.length; j++) {
            cn = c.pick('bill', [MONEY_BILL[j] + '_rp', MONEY_BILL[j]]);
            if (cn) cols2.push(cn);
          }
          for (j = 0; j < cols2.length; j++) if (!integerInStrict('bill', cols2[j])) st = false;
          r = c.rows('bill');
          for (i = 0; i < r.length; i++) {
            for (j = 0; j < cols2.length; j++) {
              val = r[i][cols2[j]];
              if (typeof val !== 'number' || val !== Math.floor(val)) bad++;
            }
          }
        }
        if (c.has('bill_line')) {
          cols2 = [];
          for (j = 0; j < LINE.length; j++) {
            cn = c.pick('bill_line', [LINE[j] + '_rp', LINE[j]]);
            if (cn) cols2.push(cn);
          }
          for (j = 0; j < cols2.length; j++) if (!integerInStrict('bill_line', cols2[j])) st = false;
          r = c.rows('bill_line');
          for (i = 0; i < r.length; i++) {
            for (j = 0; j < cols2.length; j++) {
              val = r[i][cols2[j]];
              if (typeof val !== 'number' || val !== Math.floor(val)) bad++;
            }
          }
        }
        if (!seen) st = false;
        return {
          value: bad, byConstruction: st,
          why: st ? 'all ' + seen + ' money and quantity columns are declared INTEGER in a STRICT table, so a ' +
            'fractional or textual ' +
            'rupiah is unstorable: MEASURED, all four ways in are refused with `cannot store REAL value in ' +
            'INTEGER column`. At this schema version the zero is a fact about STRICT — §0.4 — and the sweep ' +
            'that can go red is the one over the pre-v8 table, which finds two rows.' : ''
        };
      }
    },
    {
      id: 'v-no-real-affinity', kind: 'violation', unit: 'columns',
      name: 'no column anywhere is declared with REAL affinity',
      needs: function () { return true; },
      run: function (c) {
        // Deliberately NOT pragma_table_info: that is the SQL side's route, and
        // two routes that read the same pragma are one route. This one reads the
        // stored CREATE TABLE text out of sqlite_master and applies SQLite's own
        // affinity rule (a declared type containing REAL, FLOA or DOUB gets REAL
        // affinity) to each column definition in plain JavaScript. Red at v1 —
        // six columns of REAL money — and green from v8.
        var res = q(c.exec,
          "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" +
          ' AND name <> ' + lit(SKIP)), bad = 0, i, defs, j, t;
        for (i = 0; i < res.values.length; i++) {
          defs = columnDefs(String(res.values[i][1] || ''));
          for (j = 0; j < defs.length; j++) {
            t = typeToken(defs[j]);
            if (/REAL|FLOA|DOUB/i.test(t)) bad++;
          }
        }
        return { value: bad };
      }
    }
  ];

  function firstNotNull(list) {
    var i;
    for (i = 0; i < list.length; i++) if (list[i] !== null && list[i] !== undefined) return list[i];
    return null;
  }

  function missing(childRows, childKey, parentRows, parentKey) {
    var have = {}, i, k, bad = 0;
    for (i = 0; i < parentRows.length; i++) have[String(parentRows[i][parentKey])] = 1;
    for (i = 0; i < childRows.length; i++) {
      k = childRows[i][childKey];
      if (k === null || k === undefined) continue;   // a NULL reference is not an orphan
      if (!have[String(k)]) bad++;
    }
    return bad;
  }

  // Split a CREATE TABLE body into top-level definitions, then keep the ones
  // that are column definitions rather than table constraints. Depth and quote
  // tracking is necessary, not paranoia: this schema has generated columns whose
  // expressions contain both commas and parentheses, and a CHECK that contains a
  // comma-separated IN list.
  var CONSTRAINT_HEAD = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i;
  function columnDefs(sql) {
    var open = sql.indexOf('(');
    if (open < 0) return [];
    var depth = 0, i, ch, quote = null, buf = '', parts = [];
    for (i = open; i < sql.length; i++) {
      ch = sql.charAt(i);
      if (quote) {
        buf += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; buf += ch; continue; }
      if (ch === '-' && sql.charAt(i + 1) === '-') {          // a line comment, and this DDL is full of them
        while (i < sql.length && sql.charAt(i) !== '\n') i++;
        continue;
      }
      if (ch === '(') {
        depth++;
        if (depth === 1) continue;
      }
      if (ch === ')') {
        depth--;
        if (depth === 0) { parts.push(buf); break; }
      }
      if (ch === ',' && depth === 1) { parts.push(buf); buf = ''; continue; }
      buf += ch;
    }
    var out = [], p;
    for (i = 0; i < parts.length; i++) {
      p = parts[i].replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (p && !CONSTRAINT_HEAD.test(p)) out.push(p);
    }
    return out;
  }

  // 'total_tarif REAL NOT NULL CHECK (...)' -> 'REAL'. Everything up to the
  // first keyword that cannot be part of a type name.
  var TYPE_STOP = /^(NOT|NULL|PRIMARY|UNIQUE|CHECK|REFERENCES|DEFAULT|COLLATE|GENERATED|AS|CONSTRAINT)$/i;
  function typeToken(def) {
    var words = def.split(' '), out = [], i;
    for (i = 1; i < words.length; i++) {
      if (TYPE_STOP.test(words[i])) break;
      out.push(words[i]);
    }
    return out.join(' ');
  }

  function invariants(exec) {
    var c = ctxFor(exec), out = [], i, chk, applicable, r;
    for (i = 0; i < CHECKS.length; i++) {
      chk = CHECKS[i];
      applicable = false;
      try { applicable = !!chk.needs(c); } catch (e) { applicable = false; }
      if (!applicable) {
        out.push({
          id: chk.id, name: chk.name, kind: chk.kind, unit: chk.unit || '',
          applicable: false, ok: null, jsValue: null, sqlValue: null, delta: null, exact: true,
          byConstruction: false,
          why: 'this schema version has no such table or column, so the check did not run'
        });
        continue;
      }
      r = chk.run(c);
      out.push({
        id: chk.id, name: chk.name, kind: chk.kind, unit: chk.unit || '',
        applicable: true,
        // A figure is only "ok" once the other engine has agreed with it, and
        // this file cannot ask the other engine anything. Leaving it null is the
        // honest answer; compare() fills it in.
        ok: chk.kind === 'violation' ? (r.value === 0) : null,
        jsValue: r.value, sqlValue: null, delta: null,
        exact: r.exact === undefined ? true : !!r.exact,
        // TRUE when the schema in front of us makes a non-zero answer
        // unstorable. Still reported, never counted as a verification.
        byConstruction: !!r.byConstruction,
        why: r.why || ''
      });
    }
    return out;
  }

  /* ---------------------------------------------- pairing the two routes */

  // Pure arithmetic over two lists of numbers, one from each engine. It is here
  // rather than in the renderer so that the page cannot quietly compare a
  // figure with itself: this function reads two lists and refuses to invent the
  // second one.
  function compare(jsList, sqlList) {
    var byId = {}, i, s, e, out = [];
    for (i = 0; i < (sqlList || []).length; i++) {
      s = sqlList[i];
      if (s && s.id !== undefined) byId[s.id] = s;
    }
    for (i = 0; i < jsList.length; i++) {
      e = jsList[i];
      s = Object.prototype.hasOwnProperty.call(byId, e.id) ? byId[e.id] : null;
      var m = {
        id: e.id, name: e.name, kind: e.kind, unit: e.unit,
        applicable: e.applicable, jsValue: e.jsValue,
        sqlValue: null, delta: null, agree: null, ok: e.ok, exact: e.exact,
        byConstruction: !!e.byConstruction, why: e.why
      };
      if (!e.applicable) { out.push(m); continue; }
      if (!s || s.value === undefined || s.value === null) {
        m.ok = false;
        m.why = 'the SQL route produced no figure for this id, so nothing was verified';
        out.push(m);
        continue;
      }
      m.sqlValue = s.value;
      m.delta = e.jsValue - s.value;
      m.agree = m.delta === 0;
      m.ok = m.agree && (e.kind !== 'violation' || e.jsValue === 0);
      if (!m.agree) {
        m.why = 'the two routes disagree by ' + delta(m.delta) + ' ' + (e.unit || 'unit(s)') +
          ': hand-written JavaScript says ' + e.jsValue + ', SQLite says ' + s.value;
      } else if (e.kind === 'violation' && e.jsValue !== 0) {
        m.why = 'both routes agree, and both say this is broken: ' + count(e.jsValue, e.unit);
      }
      out.push(m);
    }
    return out;
  }

  function summary(list) {
    var i, e, out = { total: list.length, applicable: 0, passed: 0, failed: 0, pending: 0,
      byConstruction: 0, byConstructionIds: [], failedIds: [], ok: false };
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (!e.applicable) continue;
      out.applicable++;
      /* Counted separately so the badge can say how many of its passes are
         verifications and how many are facts about the schema. They are NOT
         subtracted from `passed`: they are true, and a reader who wants to know
         whether the database holds together wants them counted. What they are
         not is evidence that anything was checked. */
      if (e.byConstruction) { out.byConstruction++; out.byConstructionIds.push(e.id); }
      if (e.ok === true) out.passed++;
      else if (e.ok === false) { out.failed++; out.failedIds.push(e.id); }
      else out.pending++;
    }
    out.ok = out.failed === 0 && out.pending === 0 && out.applicable > 0;
    return out;
  }

  var NS = {
    take: take,
    diff: diff,
    checkDeclaration: checkDeclaration,
    invariants: invariants,
    compare: compare,
    summary: summary,
    plan: plan,
    read: read,
    tables: tables,
    checkIds: function () {
      var out = [], i;
      for (i = 0; i < CHECKS.length; i++) out.push(CHECKS[i].id);
      return out;
    },
    SKIPPED_TABLE: SKIP
  };

  root.ROMBAK_CENSUS = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ROMBAK_CENSUS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
