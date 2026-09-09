/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — engine.js
 * The only file in this lab that knows sql.js exists. Everything above it —
 * runner, census, tests, app — talks to SQLite through the handful of functions
 * below, which is what makes the census a firewall rather than a comment: it
 * receives `db.exec` as an argument and cannot reach anything else in here.
 *
 * ============================ BOOT, AND WHY IT IS EXACT ===================
 *
 * sql.js is Emscripten output. Left alone it does two things this page cannot
 * survive:
 *
 *   1. It locates its own `.wasm` over the network. `connect-src 'none'` in the
 *      CSP refuses that, guard.js counts the ATTEMPT, and the claim printed in
 *      the header of eight lab pages — zero network calls — becomes publicly
 *      false. So the wasm arrives as base64 in a <script> tag and is handed in
 *      as `wasmBinary`. There is no fallback path to fall back to.
 *   2. It prints to stdout and stderr. In a browser that is console.log and
 *      console.error, and test/labs.test.js computes
 *      `ok = failed === 0 && noise.length === 0`: ONE console error fails the
 *      build with every assertion green. So `print` and `printErr` are supplied
 *      in the initSqlJs config and routed into an array in this file, readable
 *      via noise(). Nothing in this lab writes to console.
 *
 * Both of those are verified empirically in real Chromium, over http, under the
 * shipped CSP — not assumed. Boot silence is a property of THIS configuration,
 * and it stops holding the moment someone drops the print handlers or lets the
 * loader find its own wasm.
 *
 * `PRAGMA foreign_keys` is read BEFORE it is set, and the number is kept, because
 * SQLite ships with foreign keys OFF and a page that claims to demonstrate
 * referential integrity should show that it had to ask for it. It reads 0, then
 * 1. Both numbers are in bootReport().
 *
 * ============================ THE TWO ROUTES ==============================
 *
 * sqlInvariants(db) is the SQL half of every live check: 22 figures computed by
 * SQLite's own query planner, index-assisted, aggregated in C. census.js
 * computes the same 22 by folding raw rows in hand-written ES5. The two never
 * call each other and share no query, no predicate and no table list. They agree
 * by construction only if both are right, which is the entire point — a check
 * computed once by one route is a decoration.
 *
 * The ids below are a contract. ROMBAK_CENSUS.compare() pairs the two lists BY
 * ID and treats a missing id as a FAILURE, not a pass, so a renamed id here
 * turns an invariant red rather than quietly removing it.
 */
(function (root) {
  'use strict';

  var D = root.ROMBAK_DOMAIN;
  if (!D) throw new Error('rombak/engine.js: ROMBAK_DOMAIN must load first');

  var NS = {};

  /* ------------------------------------------------------------ boot state */

  var SQL = null;           // the sql.js module namespace
  var live = null;          // the live handle
  var readyP = null;
  var noise = [];           // everything sql.js tried to print
  var report = {
    booted: false, ms: 0, version: '', b64Length: 0, wasmBytes: 0,
    fkBefore: null, fkAfter: null, noise: 0
  };

  function logLine(kind, s) {
    // Deliberately not console.*: see the header. An in-page array is readable
    // by the page, by the suite and by Playwright, and fails no build.
    noise.push({ kind: kind, text: String(s) });
    report.noise = noise.length;
  }

  /* atob is present in every browser this page supports and in node 22, but the
     one-liner fallback costs nothing and means the file can be required by a
     bare script runner. Decoding is done ONCE, at boot, over 877,880 chars. */
  function decodeBase64(b64) {
    if (typeof b64 !== 'string' || !b64.length) {
      throw new Error('rombak/engine.js: SQLITE_WASM_BASE64 is missing — vendor/sqlite-wasm-base64.js must load first');
    }
    if (typeof root.atob === 'function') {
      var bin = root.atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
      return out;
    }
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      var buf = Buffer.from(b64, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    throw new Error('rombak/engine.js: no base64 decoder available');
  }

  function startBoot() {
    var init = root.initSqlJs;
    if (typeof init !== 'function') {
      return Promise.reject(new Error(
        'rombak/engine.js: initSqlJs is missing — vendor/sql-wasm.js must load before engine.js'));
    }
    var t0 = nowMs();
    var b64 = root.SQLITE_WASM_BASE64;
    var wasmBinary = decodeBase64(b64);
    report.b64Length = b64.length;
    report.wasmBytes = wasmBinary.length;

    return init({
      wasmBinary: wasmBinary,
      print: function (s) { logLine('out', s); },
      printErr: function (s) { logLine('err', s); }
    }).then(function (mod) {
      SQL = mod;
      var db = new SQL.Database();
      // Read it BEFORE setting it. This is the number the panel prints.
      report.fkBefore = Number(scalar(db, 'PRAGMA foreign_keys'));
      db.run('PRAGMA foreign_keys = ON');
      report.fkAfter = Number(scalar(db, 'PRAGMA foreign_keys'));
      live = db;
      report.version = String(scalar(db, 'SELECT sqlite_version()'));
      report.booted = true;
      report.ms = Math.round(nowMs() - t0);
      return report;
    });
  }

  /* §4.6 wants the boot promise created at IIFE-evaluation time, and in the page
     it is: the two vendored files are already parsed by the time this line runs.
     Under a bare `require` there is no initSqlJs yet, so boot is deferred to the
     first ready() call instead of rejecting a promise nobody has attached to. */
  if (typeof root.initSqlJs === 'function') readyP = startBoot();

  NS.ready = function () {
    if (!readyP) readyP = startBoot();
    return readyP;
  };
  NS.booted = function () { return report.booted; };
  NS.bootReport = function () { return report; };
  NS.noise = function () { return noise; };
  NS.noiseCount = function () { return noise.length; };
  NS.SQL = function () { return SQL; };

  /* ------------------------------------------------------------ the handles */

  function need(db) {
    var h = db || live;
    if (!h) throw new Error('rombak/engine.js: no database yet — await ROMBAK_ENGINE.ready()');
    return h;
  }

  NS.db = function () { return live; };

  NS.use = function (db) { live = db; return db; };

  /* A fresh, empty database, with the pragma asked for again — because it is per
     CONNECTION, not per file, and every new handle starts with it off. */
  NS.fresh = function () {
    if (!SQL) throw new Error('rombak/engine.js: not booted');
    var db = new SQL.Database();
    var before = Number(scalar(db, 'PRAGMA foreign_keys'));
    db.run('PRAGMA foreign_keys = ON');
    live = db;
    report.lastFk = { before: before, after: Number(scalar(db, 'PRAGMA foreign_keys')) };
    return db;
  };

  /* A SEPARATE instance over exported bytes. Not installed as the live handle:
     the Rebuild panel needs four of these at once, each diverging from the same
     starting bytes by exactly one stated difference. */
  NS.openBytes = function (bytes) {
    if (!SQL) throw new Error('rombak/engine.js: not booted');
    var db = new SQL.Database(bytes);
    db.run('PRAGMA foreign_keys = ON');
    return db;
  };

  NS.close = function (db) {
    var h = db || live;
    if (!h) return;
    try { h.close(); } catch (e) { /* already closed */ }
    if (h === live) live = null;
  };

  /* -------------------------------------------------------- thin wrappers */

  /* These are thin ON PURPOSE. Anything cleverer — a result cache, a row-object
     mapper used by both routes, a "handy" exec that census.js could borrow —
     would put shared code under a comparison that is only worth making because
     the two sides share none. census.js is handed `db.exec.bind(db)` by the
     runner and never sees this file. */

  NS.exec = function (sql, db) { return need(db).exec(sql); };

  NS.rows = function (sql, db) {
    var r = need(db).exec(sql);
    return r.length ? r[0].values : [];
  };

  NS.cols = function (sql, db) {
    var r = need(db).exec(sql);
    return r.length ? r[0].columns : [];
  };

  function scalar(db, sql) {
    var r = db.exec(sql);
    if (!r.length || !r[0].values.length) return null;
    return r[0].values[0][0];
  }
  NS.first = function (sql, db) { return scalar(need(db), sql); };

  NS.run = function (sql, params, db) {
    var h = need(db);
    if (params && params.length) h.run(sql, params); else h.run(sql);
  };

  /* Row objects, so a caller can name a column instead of counting commas.
     Used by the runner's JS backfills and by nothing that verifies anything. */
  NS.all = function (sql, params, db) {
    var h = need(db);
    var st = h.prepare(sql);
    var out = [];
    try {
      if (params && params.length) st.bind(params);
      while (st.step()) out.push(st.getAsObject());
    } finally { st.free(); }
    return out;
  };

  /* ------------------------------------------------------------ the planner */

  /* EXPLAIN QUERY PLAN, parsed. `detail` is the string the Plans tab asserts on
     and the census gate reads; the rest is kept because the tree shape is the
     only way to tell a subquery's SCAN from the outer one's. */
  NS.plan = function (sql, params, db) {
    var h = need(db);
    var st = h.prepare('EXPLAIN QUERY PLAN ' + sql);
    var out = [];
    try {
      if (params && params.length) st.bind(params);
      while (st.step()) {
        var o = st.getAsObject();
        out.push({
          id: Number(o.id), parent: Number(o.parent), detail: String(o.detail)
        });
      }
    } finally { st.free(); }
    return out;
  };

  NS.planText = function (sql, params, db) {
    var p = NS.plan(sql, params, db), i, a = [];
    for (i = 0; i < p.length; i++) a.push(p[i].detail);
    return a.join(' | ');
  };

  /* ------------------------------------------------------------- timing */

  function nowMs() {
    if (root.performance && typeof root.performance.now === 'function') {
      return root.performance.now();
    }
    return Date.now();
  }
  NS.now = nowMs;

  /* Chromium clamps performance.now() to 0.1 ms. A single-shot measurement of a
     query that takes 40 microseconds therefore reads 0.0 or 0.1 — a number that
     is either impossible or 2.5x wrong, and in both cases indistinguishable from
     one somebody typed. So there is no single-shot path in this file: the
     minimum is MIN_RUNS, n is returned alongside the mean, and the page prints
     it. One untimed warm-up call runs first, because the first execution of a
     statement pays for its compilation and the rest do not — averaging that in
     measures the parser, not the query. */
  var MIN_RUNS = 5;
  NS.MIN_RUNS = MIN_RUNS;

  NS.timeMean = function (fn, n) {
    if (typeof fn !== 'function') throw new Error('timeMean: fn must be a function');
    var runs = Math.floor(Number(n) || 0);
    var clamped = runs < MIN_RUNS;
    if (clamped) runs = MIN_RUNS;
    fn();                                   // warm-up, not measured
    var i, a, t = [], total = 0;
    for (i = 0; i < runs; i++) {
      a = nowMs();
      fn();
      t.push(nowMs() - a);
      total += t[i];
    }
    var min = t[0], max = t[0];
    for (i = 1; i < runs; i++) { if (t[i] < min) min = t[i]; if (t[i] > max) max = t[i]; }
    return {
      n: runs, clamped: clamped, mean: total / runs, total: total,
      min: min, max: max,
      us: Math.round((total / runs) * 1000)   // integer microseconds, for display
    };
  };

  /* ------------------------------------------------------------- export */

  NS.exportBytes = function (db) { return need(db).export(); };

  /* Never .byteLength of the array you just produced, dressed up as a
     verification: the header is decoded by domain.js with SQLite not involved,
     and pageSize * pageCount is compared against the real length. */
  NS.exportReport = function (db) {
    var bytes = need(db).export();
    var head = D.decodeSqliteHeader(bytes);
    return {
      byteLength: bytes.length,
      header: head,
      product: head.pageSize * head.pageCount,
      productMatches: head.pageSize * head.pageCount === bytes.length,
      bytes: bytes                       // NOT structured-clone-safe: strip before returning from run()
    };
  };

  /* --------------------------------------------------- schema fingerprints */

  NS.schemaHash = function (db) {
    var s = scalar(need(db), 'SELECT group_concat(sql) FROM (SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name)');
    return D.sha256(s === null ? '' : String(s));
  };

  NS.tableList = function (db) {
    var r = NS.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", db);
    var i, out = [];
    for (i = 0; i < r.length; i++) out.push(String(r[i][0]));
    return out;
  };

  NS.masterFor = function (table, db) {
    var r = NS.rows("SELECT type, name, sql IS NULL FROM sqlite_master WHERE tbl_name = '" +
      String(table).replace(/'/g, "''") + "' ORDER BY type, name", db);
    var i, out = [];
    for (i = 0; i < r.length; i++) {
      out.push({ type: String(r[i][0]), name: String(r[i][1]), auto: !!Number(r[i][2]) });
    }
    return out;
  };

  NS.triggerNames = function (db) {
    var r = NS.rows("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name", db);
    var i, out = [];
    for (i = 0; i < r.length; i++) out.push(String(r[i][0]));
    return out;
  };

  NS.indexNames = function (db) {
    var r = NS.rows("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name", db);
    var i, out = [];
    for (i = 0; i < r.length; i++) out.push(String(r[i][0]));
    return out;
  };

  /* ============================ THE SQL HALF ============================= */

  /* 22 figures, computed by SQLite. Five are FIGURES — a number whose value is
     whatever the data says, verified by the other route agreeing on it — and
     seventeen are VIOLATION COUNTS, which are correct only at zero.
     census.js decides pass/fail; this file only answers the question.
     
     The column names move at v8 (money gains its _rp suffix) and at v9 (one
     polymorphic entity column becomes three typed ones). Rather than being told
     which schema version it is looking at, this function ASKS the database —
     a runner that lies about the version then cannot make the two routes agree
     by accident. */
  function tableExists(db, t) {
    return NS.rows("SELECT 1 FROM sqlite_master WHERE type='table' AND name='" + t + "'", db).length > 0;
  }
  function columnExists(db, t, c) {
    return NS.rows("SELECT 1 FROM pragma_table_xinfo('" + t + "') WHERE name='" + c + "'", db).length > 0;
  }

  NS.sqlInvariants = function (db) {
    var h = need(db);
    var out = [];
    var rp = columnExists(h, 'bill', 'total_tarif_rp');
    var tot = rp ? 'total_tarif_rp' : 'total_tarif';
    var amt = rp ? 'amount_rp' : 'amount';
    var unit = rp ? 'unit_rp' : 'unit';
    var sfx = rp ? '_rp' : '';

    // Each figure is independently guarded. After `DROP TABLE patient` in the
    // Console the ones that need patient stop being answerable, and an
    // unanswered id is reported by compare() as a failure, not as a pass, and
    // not as a pageerror.
    function one(sql) {
      var r = h.exec(sql);
      if (!r.length || !r[0].values.length) return 0;
      var v = r[0].values[0][0];
      return v === null ? 0 : Number(v);
    }
    function put(id, sql) {
      try { out.push({ id: id, value: one(sql) }); } catch (e) { /* unanswerable here */ }
    }

    put('f-patients', 'SELECT count(*) FROM patient');
    put('f-bill-line-money', 'SELECT sum(' + amt + ') FROM bill_line');
    put('f-bill-total-money', 'SELECT sum(' + tot + ') FROM bill');
    put('f-queue-seq-total', 'SELECT sum(queue_seq) FROM visit');
    put('f-visits-active', "SELECT count(*) FROM visit WHERE status NOT IN ('selesai','batal')");

    put('v-bill-parts-sum', 'SELECT count(*) FROM bill WHERE ' + tot + ' <> ditanggung' + sfx +
      ' + ditanggung_lain' + sfx + ' + dibayar_pasien' + sfx);
    put('v-bill-lines-tie', 'SELECT count(*) FROM bill b LEFT JOIN (SELECT visit_id, sum(' + amt +
      ') s FROM bill_line GROUP BY 1) l ON l.visit_id = b.visit_id WHERE b.' + tot + ' <> ifnull(l.s,0)');
    put('v-line-amount-derived', 'SELECT count(*) FROM bill_line WHERE ' + amt + ' <> qty * ' + unit);
    put('v-queue-seq-counter', 'SELECT count(*) FROM visit v LEFT JOIN queue_counter q' +
      ' ON q.visit_date = v.visit_date AND q.poli_id = v.poli_id' +
      ' WHERE q.last_seq IS NULL OR v.queue_seq > q.last_seq');
    put('v-queue-no-scope', 'SELECT ifnull(sum(n-1),0) FROM (SELECT count(*) n FROM visit' +
      ' GROUP BY visit_date, poli_id, queue_no HAVING count(*) > 1)');
    put('v-visit-patient', 'SELECT count(*) FROM visit v LEFT JOIN patient p ON p.rm_number = v.rm_number' +
      ' WHERE p.rm_number IS NULL');
    put('v-encounter-visit', 'SELECT count(*) FROM encounter e LEFT JOIN visit v ON v.id = e.visit_id' +
      ' WHERE v.id IS NULL OR v.rm_number <> e.rm_number');
    put('v-bill-line-parent', 'SELECT count(*) FROM bill_line l LEFT JOIN bill b ON b.visit_id = l.visit_id' +
      ' WHERE b.visit_id IS NULL');
    put('v-dx-icd-known', 'SELECT count(*) FROM encounter_diagnosis d LEFT JOIN icd10 i ON i.code = d.icd_code' +
      ' WHERE i.code IS NULL');
    put('v-primary-dx', 'SELECT count(*) FROM (SELECT encounter_id FROM encounter_diagnosis' +
      ' GROUP BY encounter_id HAVING sum(CASE WHEN is_primary = 1 THEN 1 ELSE 0 END) <> 1)');
    put('v-audit-contiguous', 'SELECT count(*) FROM (SELECT seq, row_number() OVER (ORDER BY seq) - 1 r' +
      ' FROM audit_entry) WHERE seq <> r');
    // No SQL route can recompute a SHA-256, so this side reports the one half it
    // can check — that every prev_hash points at the previous row's hash.
    // census.js re-derives all 424 digests in JavaScript, which is the half that
    // makes the chain worth having.
    put('v-audit-hash', 'SELECT count(*) FROM (SELECT seq, prev_hash, lag(hash) OVER (ORDER BY seq) p' +
      ' FROM audit_entry) WHERE seq > 0 AND (p IS NULL OR prev_hash <> p)');
    if (tableExists(h, 'audit_commitment')) {
      put('v-audit-commitment', "SELECT (SELECT count(*) FROM audit_commitment WHERE k <> 'chain')" +
        ' + (SELECT count(*) FROM audit_commitment c WHERE c.count <> (SELECT count(*) FROM audit_entry))' +
        ' + (SELECT count(*) FROM audit_commitment c WHERE c.head <> (SELECT hash FROM audit_entry' +
        ' ORDER BY seq DESC LIMIT 1))');
    }
    if (columnExists(h, 'patient', 'rm_seq')) {
      put('v-rm-number-seq', "SELECT count(*) FROM patient WHERE rm_number <> 'RM-' || substr('000000' || rm_seq, -6)");
    }
    put('v-fabrication', "SELECT count(*) FROM patient WHERE nik_demo NOT GLOB 'NIK-FIKTIF-[0-9][0-9][0-9][0-9][0-9][0-9]'" +
      " OR (bpjs_demo IS NOT NULL AND bpjs_demo NOT GLOB 'BPJS-FIKTIF-[0-9][0-9][0-9][0-9][0-9][0-9]')" +
      " OR phone NOT GLOB '08[0-9][0-9]-FIKTIF-[0-9][0-9][0-9]' OR is_demo <> 1");

    /* The money sweep. `typeof(x) <> 'integer'` is the obvious query and it is
       WRONG on a pre-v8 database: the columns are declared REAL, REAL affinity
       forces every integer into a float on the way in, and typeof() then answers
       'real' for all 4,351 clean rows. The pair of conditions below is what
       actually separates a value that survives CAST from one that does not.
       Post-v8 the table is STRICT and the answer can only be 0 — which is a fact
       about STRICT, not a verification, and the page labels it that way. */
    var moneyCols = ['total_tarif' + sfx, 'ditanggung' + sfx, 'ditanggung_lain' + sfx, 'dibayar_pasien' + sfx];
    function nonInt(c) {
      return "(CASE WHEN typeof(" + c + ") NOT IN ('integer','real') OR " + c +
        " <> CAST(" + c + " AS INTEGER) THEN 1 ELSE 0 END)";
    }
    var lineCols = ['qty', unit, amt], i, a = [], b = [];
    for (i = 0; i < moneyCols.length; i++) a.push(nonInt(moneyCols[i]));
    for (i = 0; i < lineCols.length; i++) b.push(nonInt(lineCols[i]));
    try {
      out.push({
        id: 'v-money-integer',
        value: one('SELECT ifnull(sum(' + a.join(' + ') + '),0) FROM bill') +
          one('SELECT ifnull(sum(' + b.join(' + ') + '),0) FROM bill_line')
      });
    } catch (e) { /* unanswerable here */ }

    put('v-no-real-affinity', "SELECT count(*) FROM sqlite_master m, pragma_table_info(m.name) ti" +
      " WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name <> 'schema_migration'" +
      " AND (upper(ti.type) LIKE '%REAL%' OR upper(ti.type) LIKE '%FLOA%' OR upper(ti.type) LIKE '%DOUB%')");

    return out;
  };

  /* ---------------------------------------------------- the honest pragmas */

  NS.integrityCheck = function (db) {
    var r = NS.rows('PRAGMA integrity_check', db), i, out = [];
    for (i = 0; i < r.length; i++) out.push(String(r[i][0]));
    return out;
  };

  NS.foreignKeyCheck = function (db) {
    var r = NS.rows('PRAGMA foreign_key_check', db), i, j, out = [], row;
    for (i = 0; i < r.length; i++) {
      row = [];
      for (j = 0; j < r[i].length; j++) row.push(r[i][j] === null ? null : String(r[i][j]));
      out.push(row);
    }
    return out;
  };

  NS.foreignKeysOn = function (db) { return Number(scalar(need(db), 'PRAGMA foreign_keys')); };

  NS.pageStats = function (db) {
    var h = need(db);
    var pc = Number(scalar(h, 'PRAGMA page_count'));
    var fl = Number(scalar(h, 'PRAGMA freelist_count'));
    var ps = Number(scalar(h, 'PRAGMA page_size'));
    return { pageCount: pc, freelistCount: fl, pageSize: ps, pagesUsed: pc - fl, bytesUsed: (pc - fl) * ps };
  };

  root.ROMBAK_ENGINE = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
