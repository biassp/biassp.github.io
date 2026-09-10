/*!
 * Serobot — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Serobot — tests.js
 * The same file drives the badge in the page header and runs under
 * test/labs.test.js in headless Chromium.
 *
 * ONE RULE SHAPED THIS FILE, and it is the reason it is a hundred and thirty
 * properties and not thirteen hundred: NO ASSERTION MAY HAVE THE BROWSER'S OWN
 * CORRECTNESS AS ITS SUBJECT. Not "Web Locks serialises", not "postMessage
 * delivers", not "a worker starts", not "structuredClone clones". A lab about
 * concurrency is more tempted by that than either of its siblings — an
 * afternoon with the Web Locks specification would hand out four hundred free
 * green assertions, every one of them a statement about Chromium. What is
 * asserted here is THIS LAB'S REACTION TO A PROBE: that the helper refuses,
 * that the refusal carries the code this file claims, that the number the page
 * prints was produced twice by two routes that share no code. Two hundred
 * increments is one property, not two hundred, and an eight-hundred-entry
 * ordering log gets five properties over the whole log rather than one per row.
 *
 * Ranked by how much damage each one prevents:
 *
 *  1. G0's CLONE WALKER. page.evaluate does not throw on a value it cannot
 *     clone — it returns {} and says nothing. Measured in this repository's own
 *     Chromium: a Map, a Set, a RegExp, an ArrayBuffer and an IDBKeyRange all
 *     arrive as {}, indistinguishable from a legitimately empty object; a
 *     function and an undefined arrive as NO KEY AT ALL; NaN and Infinity
 *     arrive as null; and new Error('boom') arrives as {name:"Error"} with its
 *     message destroyed. A suite that admits one into its result reaches CI
 *     hollowed out and green. Worse, the runner adds out.passed and out.failed
 *     OUTSIDE its try/catch, so a null count makes the total NaN, NaN > 0 is
 *     false, and the job prints a red line and exits 0.
 *  2. THE ASYNC TRIPWIRE. Almost everything this lab measures is a promise.
 *     t.throws(function () { rejectingCall(); }) records "did not throw" and
 *     then DROPS the rejection, and a dropped rejection is a page error, which
 *     fails the whole lab with every assertion green. Every group here is a
 *     plain synchronous function over a fixture that has already settled, and
 *     the one helper that could still be handed a thenable counts it and fails.
 *  3. THE RACE TRIPWIRES, both of them. A free-mode result carries __lomba__
 *     and every helper refuses to take one as an operand. That catches the
 *     container; it cannot catch a bare number lifted off it, so a second
 *     tripwire reads this file's own group bodies back through
 *     Function.prototype.toString and fails if any of them pins the race
 *     outcome against a literal. Both are proved to fire, on throwaway
 *     material, before either is asserted to be quiet.
 *  4. G9. The witness is the only thing standing between this page and the
 *     oldest bug in the portfolio — reporting lost = expected - final where
 *     both operands came out of the same message. Eight of its eleven
 *     properties are the witness REFUSING something the engine would have been
 *     happy to hand it, including rows that came from an index rather than
 *     from the store.
 *  5. THE NEGATIVES EVERYWHERE ELSE. Every one pins this lab's own code or a
 *     stable DOMException name, never Chromium's wording: "it was refused" and
 *     "it was refused for the reason I claimed" are different assertions, and
 *     the TransactionInactiveError message is seventy-four characters of
 *     somebody else's prose that a browser release may reword at any time.
 *
 * WHERE THE CODE LIVES. Lab refusals carry their code in the error NAME, never
 * in the message, because page.evaluate destroys the message — so throwsWith
 * and refusedWith here match against the NAME. That is the one place this file
 * deliberately differs from labs/sahih/tests.js, which had no worker seam and
 * could afford to read messages.
 *
 * WHAT THIS FILE MAY NOT DO. It reads no clock. ms is pinned to zero and
 * app.js times the call from outside, where the figure is a display and not an
 * assertion. It touches no DOM. It opens no transaction of its own and calls
 * navigator.locks nowhere — kunci.js is the only file in this lab that does,
 * and a second caller would make that grep lie.
 *
 * COUNTING. properties, executions and negatives are computed at runtime from
 * the registry this file builds while it runs. Nothing is typed in.
 */
(function (root) {
  'use strict';

  var KODE = root.SEROBOT_KODE;
  var DB = root.SEROBOT_DB;
  var ARMS = root.SEROBOT_ARMS;
  var UTAS = root.SEROBOT_UTAS;
  var IDEM = root.SEROBOT_IDEM;
  var KUNCI = root.SEROBOT_KUNCI;
  var PANTAU = root.SEROBOT_PANTAU;
  var SAKSI = root.SEROBOT_SAKSI;

  var groups = [];
  var props = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  /* The fixture, parked here by the pre-pass so every group below can be a
     plain synchronous function of no arguments. That is not tidiness: a
     fire-and-forget promise inside a synchronous group is a dropped rejection,
     which Chromium reports as a page error, which fails the lab with every
     assertion green. Everything asynchronous in this lab settles before the
     first group opens. */
  var F = null;

  /* Tripwire counters. All three are asserted to be zero in G0 AND all three
     are proved to move, in a throwaway context whose results are thrown away.
     A check that has never been seen to go red is decoration. */
  var ASYNC_MISUSE = 0;
  var LOMBA_TOUCHED = 0;

  /* ===================== the assertion context ========================= */

  /* JSON.stringify over a structure holding a back-reference throws, so a
     helper that builds its failure message eagerly can crash on a PASSING
     comparison. Messages are lazy and the stringify is guarded — a bug this
     repository has already paid for once. */
  function js(v) {
    try { return JSON.stringify(v); }
    catch (e) { return '[an object with a cyclic reference]'; }
  }

  /* Both brands, read through the engine's own predicate so that a change to
     the brand names cannot leave this file checking for the old ones. */
  function branded(v) { return KODE.branded(v); }

  function makeCtx(results, groupName, registry) {
    var cur = null;
    var reg = registry || props;

    /* "from" is the index of this property's first result. Results are pushed
       in order and never re-ordered, so a property owns the contiguous run
       results[from .. from + executions - 1] — which is how the Tests tab nests
       cases under the claim they belong to without this file duplicating the
       claim into every row. "helpers" is what makes the negative rule
       checkable: G0 fails if a property declared negative recorded through
       anything but a helper that pinned a reason. */
    function open(name, negative) {
      cur = {
        group: groupName, name: String(name), negative: !!negative,
        executions: 0, from: results.length, helpers: {}
      };
      reg.push(cur);
      return cur;
    }

    function record(ok, name, msg, helper) {
      if (!cur) open(name || 'unnamed property', false);
      cur.executions++;
      cur.helpers[helper] = true;
      results.push({
        group: groupName,
        name: String(name || cur.name),
        ok: !!ok,
        message: ok ? '' : String(typeof msg === 'function' ? msg() : (msg || ''))
      });
    }

    /* Tripwire 1. Every free-mode container in this lab wears __lomba__ and
       every timing wears __waktu__, applied by the engine and never by the
       caller. An assertion that takes one as an operand is pinning a race
       outcome or a stopwatch reading on somebody else's hardware, so it does
       not merely warn — it fails, and it makes G0 fail too. */
    function guarded(helper, name, a, b) {
      if (branded(a) || branded(b)) {
        LOMBA_TOUCHED++;
        record(false, name, 'a race outcome or a timing was used as an assertion operand', helper);
        return true;
      }
      return false;
    }

    /* Tripwire 2. Every refusal worth pinning in this lab is either synchronous
       or already settled on the fixture, so a helper here should never see a
       thenable. If one arrives, the assertion it was standing in for did not
       happen and the rejection underneath it is about to become a page error.
       Count it, swallow it, and record red. */
    function catchAsync(ret, name) {
      if (ret && (typeof ret === 'object' || typeof ret === 'function') && typeof ret.then === 'function') {
        ASYNC_MISUSE++;
        try { ret['catch'](function () { }); } catch (e) { /* not a real promise */ }
        record(false, 'a synchronous helper was applied to an async subject',
          'the subject of "' + name + '" returned a thenable', 'tripwire');
        return true;
      }
      return false;
    }

    var t = {
      /* Opens a property. Every assertion after it belongs to it, however many
         rows it walks. Forgetting to call this does not silently merge two
         claims: G0 fails if any property recorded no execution. */
      prop: function (name) { open(name, false); return t; },
      neg: function (name) { open(name, true); return t; },

      ok: function (v, name) { if (guarded('ok', name, v)) return; record(!!v, name, function () { return 'expected something truthy, got ' + js(v); }, 'ok'); },
      notOk: function (v, name) { if (guarded('notOk', name, v)) return; record(!v, name, function () { return 'expected something falsy, got ' + js(v); }, 'notOk'); },
      eq: function (a, b, name) { if (guarded('eq', name, a, b)) return; record(a === b, name, function () { return 'expected ' + js(b) + ', got ' + js(a); }, 'eq'); },
      ne: function (a, b, name) { if (guarded('ne', name, a, b)) return; record(a !== b, name, function () { return 'expected anything but ' + js(b); }, 'ne'); },
      lt: function (a, b, name) { if (guarded('lt', name, a, b)) return; record(a < b, name, function () { return 'expected < ' + js(b) + ', got ' + js(a); }, 'lt'); },
      lte: function (a, b, name) { if (guarded('lte', name, a, b)) return; record(a <= b, name, function () { return 'expected <= ' + js(b) + ', got ' + js(a); }, 'lte'); },
      gt: function (a, b, name) { if (guarded('gt', name, a, b)) return; record(a > b, name, function () { return 'expected > ' + js(b) + ', got ' + js(a); }, 'gt'); },
      gte: function (a, b, name) { if (guarded('gte', name, a, b)) return; record(a >= b, name, function () { return 'expected >= ' + js(b) + ', got ' + js(a); }, 'gte'); },
      deep: function (a, b, name) { if (guarded('deep', name, a, b)) return; record(js(a) === js(b), name, function () { return 'expected ' + js(b) + ', got ' + js(a); }, 'deep'); },
      match: function (s, re, name) { if (guarded('match', name, s)) return; record(re.test(String(s)), name, function () { return 'expected ' + re + ' to match ' + js(String(s)); }, 'match'); },

      throws: function (fn, name) {
        var threw = false, ret = null;
        try { ret = fn(); } catch (e) { threw = true; }
        if (catchAsync(ret, name)) return;
        record(threw, name, 'expected it to be refused; it was accepted', 'throws');
      },

      /* Mandatory for every negative. The regex pins THIS LAB'S OWN CODE, which
         travels in the error's NAME because page.evaluate destroys the message
         — or a stable DOMException name, which is the only part of a browser
         error this lab is willing to depend on. Never Chromium's wording: the
         TransactionInactiveError message is seventy-four characters of prose
         with no stability contract, and asserting it would give a browser
         release the power to turn this suite red for a reason that has nothing
         to do with this code. */
      throwsWith: function (fn, re, name) {
        var threw = false, got = '', ret = null;
        try { ret = fn(); } catch (e) { threw = true; got = String(KODE.nameOf(e)); }
        if (catchAsync(ret, name)) return;
        record(threw && re.test(got), name, threw
          ? function () { return 'it was refused, but not for the stated reason. expected ' + re + ', got: ' + got; }
          : 'expected it to be refused; it was accepted', 'throwsWith');
      },

      noThrow: function (fn, name) {
        var bad = null, ret = null;
        try { ret = fn(); } catch (e) { bad = String(KODE.nameOf(e)); }
        if (catchAsync(ret, name)) return;
        record(bad === null, name, function () { return 'it was refused with ' + bad; }, 'noThrow');
      },

      /* The other mandatory negative helper. Most refusals in this lab were
         settled in the pre-pass, where the promises lived, and arrive here as a
         verdict plus a reason NAME rather than as a throw. Same contract as
         throwsWith: refused AND refused for the stated reason, or red. */
      refusedWith: function (refused, reason, re, name) {
        if (guarded('refusedWith', name, refused, reason)) return;
        var text = String(reason == null ? '' : reason);
        record(!!refused && re.test(text), name, refused
          ? function () { return 'it was refused, but not for the stated reason. expected ' + re + ', got: ' + js(text); }
          : 'expected it to be refused; it was accepted', 'refusedWith');
      }
    };
    return t;
  }

  /* ============================ the walkers ============================ */

  function plainType(v) {
    if (v === null) return 'null';
    var s = typeof v;
    if (s === 'string' || s === 'number' || s === 'boolean') return s;
    if (s !== 'object') return s;                     /* undefined, function, symbol */
    if (Object.prototype.toString.call(v) === '[object Array]') return 'array';
    var p = Object.getPrototypeOf(v);
    if (p === Object.prototype || p === null) return 'object';
    return Object.prototype.toString.call(v);
  }

  /* Tripwire 3, and the most dangerous thing about this harness. Everything
     this walker refuses was measured arriving at the far side of a real
     page.evaluate in this repository's own Chromium, silently: a Map, a Set, a
     RegExp, an ArrayBuffer and an IDBKeyRange all become {}; a function and an
     undefined lose their key entirely; NaN and Infinity become null; a
     DOMException keeps its name at any depth and an Error loses its message.
     Non-finite numbers are refused separately from the rest because a
     corrupted count arriving as null combines with the runner adding
     out.passed outside its try/catch to print a red line and exit zero. */
  function unclonable(node, limit) {
    var bad = [];
    var seen = [];
    function walk(v, path, depth) {
      if (bad.length >= (limit || 40) || depth > 24) return;
      var k = plainType(v);
      if (k === 'string' || k === 'number' || k === 'boolean' || k === 'null') {
        if (k === 'number' && !isFinite(v)) bad.push(path + ' is a non-finite number');
        return;
      }
      if (k !== 'array' && k !== 'object') { bad.push(path + ' is ' + k); return; }
      var i;
      for (i = 0; i < seen.length; i++) if (seen[i] === v) { bad.push(path + ' is a cycle'); return; }
      seen.push(v);
      if (k === 'array') {
        for (i = 0; i < v.length; i++) walk(v[i], path + '[' + i + ']', depth + 1);
      } else {
        var keys = [], key;
        for (key in v) if (Object.prototype.hasOwnProperty.call(v, key)) keys.push(key);
        for (i = 0; i < keys.length; i++) walk(v[keys[i]], path + '.' + keys[i], depth + 1);
      }
      seen.pop();
    }
    walk(node, '$', 0);
    return bad;
  }

  function countBranded(node) {
    var n = 0;
    var seen = [];
    function walk(v, depth) {
      if (depth > 24 || !v || typeof v !== 'object') return;
      var i;
      for (i = 0; i < seen.length; i++) if (seen[i] === v) return;
      seen.push(v);
      if (branded(v)) n++;
      if (Object.prototype.toString.call(v) === '[object Array]') {
        for (i = 0; i < v.length; i++) walk(v[i], depth + 1);
      } else {
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k], depth + 1);
      }
      seen.pop();
    }
    walk(node, 0);
    return n;
  }

  /* Every string reachable on the fixture, for G11's sweep. Depth-bounded for
     the same reason the clone walker is: this runs on somebody else's laptop. */
  function reachableStrings(node) {
    var out = [];
    var seen = [];
    function walk(v, path, depth) {
      if (depth > 24 || out.length > 20000) return;
      if (typeof v === 'string') { out.push({ path: path, s: v }); return; }
      if (!v || typeof v !== 'object') return;
      var i;
      for (i = 0; i < seen.length; i++) if (seen[i] === v) return;
      seen.push(v);
      if (Object.prototype.toString.call(v) === '[object Array]') {
        for (i = 0; i < v.length; i++) walk(v[i], path + '[' + i + ']', depth + 1);
      } else {
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k], path + '.' + k, depth + 1);
      }
      seen.pop();
    }
    walk(node, '$', 0);
    return out;
  }

  function numbersIn(node) {
    var out = [];
    var seen = [];
    function walk(v, path, depth) {
      if (depth > 24 || out.length > 20000) return;
      if (typeof v === 'number') { out.push({ path: path, v: v }); return; }
      if (!v || typeof v !== 'object') return;
      var i;
      for (i = 0; i < seen.length; i++) if (seen[i] === v) return;
      seen.push(v);
      if (Object.prototype.toString.call(v) === '[object Array]') {
        for (i = 0; i < v.length; i++) walk(v[i], path + '[' + i + ']', depth + 1);
      } else {
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k], path + '.' + k, depth + 1);
      }
      seen.pop();
    }
    walk(node, '$', 0);
    return out;
  }

  /* ======================= the static race tripwire ==================== */

  /* The object brand catches an assertion handed a free-mode CONTAINER. It
     cannot catch a bare integer lifted off one — branded() needs an object, and
     free.pisah is a number — so the one thing §1.5 is printed to prevent,
     t.eq(free.pisah, 22), would sail past it. Measured: it does. This is the
     other half. It reads this file's own group bodies back through
     Function.prototype.toString and refuses any comparison that pins the race
     outcome against a literal or takes it as an equality operand at all. The
     one inequality that ships — 0 <= pisah <= W*n, true by construction because
     a write stores at most read+1 and there are W*n writes — uses lte and gte,
     which are not in the pattern. */
  var LOMBA_FIELD = 'K-pi' + 'sah';
  /* The two helpers a free-mode figure MAY be handed, because between them
     they can only express the inequality that is true by construction: a write
     stores at most read+1, and there are W*n writes. Anything else applied to
     that figure is a pin, whatever it happens to equal today. */
  var LOMBA_BOLEH = { gte: true, lte: true };

  function scanLomba(src) {
    var hits = [], baris = String(src).split('\n'), i, m;
    for (i = 0; i < baris.length; i++) {
      if (baris[i].indexOf(LOMBA_FIELD) < 0) continue;
      m = /(?:^|[^\w$])t\.([a-zA-Z]+)\s*\(/.exec(baris[i]);
      if (!m) continue;
      if (LOMBA_BOLEH[m[1]]) continue;
      hits.push('t.' + m[1] + ' was applied to the race outcome');
    }
    return hits;
  }

  /* The scan is over the FREE-MODE GROUP ONLY, and deliberately so. Under the
     rendezvous that same balance is an exact integer that thirty runs at three
     throttle rates agreed on, and pinning it is the entire point of the lab.
     With nothing to synchronise the writers it is a different number on every
     machine. Same field, same store, and the two are not the same claim. */
  function sumberBebas() {
    var i;
    for (i = 0; i < groups.length; i++) {
      if (groups[i].name.indexOf('G5') === 0) return String(groups[i].fn);
    }
    return '';
  }

  /* The planted body the scanner is proved against. It is not registered as a
     group, so the real scan never sees it, and it exists only to be read back
     as a string. */
  function grupPalsu(t, free) {
    t.eq(free.delta['K-pisah'], 22, 'a pinned race outcome');
  }

  function keysOf(o) {
    var out = [], k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out.push(k);
    out.sort();
    return out;
  }

  function countOf(o) { return keysOf(o).length; }

  /* A second route to the Atomics count. A member that worked left a number or
     a boolean in its slot; one that refused left the name of what it threw. */
  function recountAtomik(a) {
    var names = ['add', 'load', 'compareExchange', 'store', 'exchange',
                 'notify', 'isLockFree', 'wait', 'waitAsync'];
    var n = 0, i, v;
    for (i = 0; i < names.length; i++) {
      v = a[names[i]];
      if (typeof v === 'number' || typeof v === 'boolean' || v === 'RESOLVED') n++;
    }
    return n;
  }

  /* ============================ G0 ==================================== */

  /* Registered first and reported first, because every other group in this file
     is worth exactly as much as this one's answer. Three of its properties are
     tripwires that are PROVED TO FIRE before they are asserted to be quiet, on
     throwaway material whose results are thrown away: a check that has never
     been seen to go red is decoration. */
  group('G0 the suite audits itself', function (t) {
    var junk, jreg, jt, before, draft, i;

    t.prop('the clone walker passes a result made only of primitives, arrays and plain objects');
    t.deep(unclonable({ a: 1, b: 'x', c: true, d: null, e: [1, 2, { f: 0 }] }), [],
      'a clean structure produces no findings');

    /* Every one of these was measured arriving at the far side of a real
       page.evaluate as {} or as a missing key, in this repository's own
       Chromium, in silence. */
    t.neg('and it refuses every shape that this harness corrupts without saying so');
    var korup = unclonable({
      map: new Map(), set: new Set(), re: /x/, err: new Error('a message that does not survive'),
      fn: function () { }, undef: undefined, nan: NaN, inf: Infinity,
      buf: (typeof ArrayBuffer === 'function' ? new ArrayBuffer(4) : {})
    }, 40);
    t.refusedWith(korup.length > 0, korup.join(' · '), /object Map/, 'a Map is caught');
    t.refusedWith(korup.length > 0, korup.join(' · '), /object Set/, 'a Set is caught');
    t.refusedWith(korup.length > 0, korup.join(' · '), /object RegExp/, 'a RegExp is caught');
    t.refusedWith(korup.length > 0, korup.join(' · '), /\.fn is function/, 'a function is caught');
    t.refusedWith(korup.length > 0, korup.join(' · '), /\.undef is undefined/, 'an undefined is caught');
    t.refusedWith(korup.length > 0, korup.join(' · '), /\.nan is a non-finite number/, 'a NaN is caught');
    t.refusedWith(korup.length > 0, korup.join(' · '), /\.inf is a non-finite number/, 'an Infinity is caught');
    t.refusedWith(korup.length > 0, korup.join(' · '), /object Error/, 'an Error is caught');

    /* The draft is built by the same function that builds the object run()
       hands back, so what is asserted here is what crosses the boundary. It
       differs from the final one only by the rows this group is still pushing. */
    draft = hasil();

    t.prop('the assembled result object survives the structured clone end to end');
    t.deep(unclonable(draft), [],
      'every value in the result is a string, a number, a boolean, null, a plain array or a plain object');

    t.prop('the result carries the eleven fields the runner reads, and nine of them are finite numbers');
    t.deep(keysOf(draft),
      ['byGroup', 'executions', 'failed', 'groups', 'ms', 'negatives', 'noise', 'passed', 'properties', 'results', 'total'],
      'eleven fields, no more and no fewer');
    var angka = ['passed', 'failed', 'total', 'properties', 'executions', 'negatives', 'groups', 'noise', 'ms'];
    var jelek = [];
    for (i = 0; i < angka.length; i++) {
      if (typeof draft[angka[i]] !== 'number' || !isFinite(draft[angka[i]])) jelek.push(angka[i]);
    }
    /* The runner adds out.passed and out.failed OUTSIDE its try/catch, so one
       null count makes its total NaN, NaN > 0 is false, and the job prints a
       red line and exits zero. That is why this is a typed check and not a
       walk. */
    t.deep(jelek, [], 'every count is a finite number and not null');

    t.prop('the counts agree with each other');
    t.eq(draft.passed + draft.failed, draft.total, 'passed plus failed is the total');
    t.eq(draft.total, draft.executions, 'and the total is the execution count');
    t.eq(draft.groups, groups.length, 'the group count is the number of groups registered');

    t.prop('properties and executions are two figures and are never added together');
    t.gt(draft.properties, 0, 'the suite registered properties');
    t.gt(draft.executions, draft.properties, 'and executed more times than it has properties');
    t.eq(draft.ms, 0, 'this file reads no clock, so its own duration is pinned to zero');

    /* The three whole-suite audits — that every property executed, that every
       negative pinned a reason, and that the assembled object survives the
       clone in full — are registered by the tail AFTER every group has run.
       Asked from here they would see only this group's own rows and pass by
       being empty, which is the shape of check this file exists to refuse. */

    /* Tripwire 1, proved live. */
    t.prop('no assertion in this suite took a race outcome or a timing as an operand');
    t.eq(LOMBA_TOUCHED, 0, 'the brand tripwire never fired during the run');
    t.gt(countBranded(F), 0, 'and the fixture carries branded containers for it to catch');

    t.neg('and the brand tripwire fires when one is used as an operand');
    before = LOMBA_TOUCHED;
    junk = []; jreg = [];
    jt = makeCtx(junk, 'throwaway', jreg);
    jt.prop('deliberately asserting over a free-mode container');
    jt.eq(F.pusat.bebas.res, F.pusat.bebas.res, 'misuse');
    t.refusedWith(LOMBA_TOUCHED === before + 1 && junk.length === 1 && junk[0].ok === false,
      junk.length ? junk[0].message : 'nothing was recorded',
      /race outcome or a timing/, 'the throwaway went red rather than passing the comparison');
    LOMBA_TOUCHED = before;

    /* Tripwire 2, proved live. */
    t.prop('no synchronous helper in this suite was applied to an unsettled subject');
    t.eq(ASYNC_MISUSE, 0, 'the async tripwire never fired during the run');

    t.neg('and the async tripwire fires when a helper is handed a thenable');
    before = ASYNC_MISUSE;
    junk = []; jreg = [];
    jt = makeCtx(junk, 'throwaway', jreg);
    jt.neg('deliberately misusing throws on a rejected promise');
    jt.throwsWith(function () {
      return Promise.reject(KODE.refuse('E_MODE', 'a deliberately dropped rejection'));
    }, /nothing/, 'misuse');
    t.refusedWith(ASYNC_MISUSE === before + 1 && junk.length === 1 && junk[0].ok === false,
      junk.length ? junk[0].name : 'nothing was recorded',
      /async subject/, 'the throwaway went red and swallowed the rejection');
    ASYNC_MISUSE = before;

    /* Tripwire 3. The object brand catches a container; this catches a bare
       integer lifted off one, which is the thing the shipped grep is printed to
       prevent and the thing the brand cannot see. */
    t.neg('the static scanner refuses a group body that pins the race outcome');
    var tanam = scanLomba(String(grupPalsu));
    t.refusedWith(tanam.length === 1, tanam.join(' · '), /t\.eq was applied/,
      'the planted body is caught, and named by the helper it used');

    t.prop('and it finds nothing in the free-mode group this file actually ships');
    t.deep(scanLomba(sumberBebas()), [], 'the free-mode group touches the race outcome twice, both times as a bound');
    t.gt(sumberBebas().length, 100, 'and there is a free-mode group for it to have scanned');

    /* The latch. Measured before it existed: two runs on one page sharing a
       database name destroyed each other, and the destruction arrived as a page
       error with every assertion green. */
    t.prop('the single-flight latch hands the second caller the first caller\'s promise');
    var kotak = {}, dipanggil = 0;
    function buat() { dipanggil++; return Promise.resolve(dipanggil); }
    var p1 = gerbang(kotak, buat);
    var p2 = gerbang(kotak, buat);
    t.eq(p1, p2, 'the second call returned the identical promise object');
    t.eq(dipanggil, 1, 'and the work was started once');
    p1['catch'](function () { });

    t.prop('the watchdog is armed at the budget the numbers file names, and resolves with a shaped result');
    t.eq(WATCHDOG, KODE.ANGKA.watchdog, 'the suite and the numbers file agree');
    t.eq(WATCHDOG, 90000, 'forty times the measured cost of the whole run under throttling');
    var lelah = kosongkan('the suite exceeded its time budget');
    t.deep(unclonable(lelah), [], 'the watchdog result is clonable too');
    t.eq(lelah.results.length, 1, 'it carries exactly one recorded failure');
    t.eq(lelah.results[0].ok, false, 'which is red');
    t.eq(lelah.failed, 1, 'and the runner reads it as one failure rather than as a bare stack');
    t.match(lelah.results[0].message, /time budget/, 'its message is a budget and not a correctness claim');
  });

  /* ============================ G1 ==================================== */

  group('G1 what this browser will not do', function (t) {
    var m = F.mesin, a = F.atomik;

    t.prop('this page is not cross-origin isolated and has no shared memory');
    t.eq(m.crossOriginIsolated, false, 'crossOriginIsolated is false');
    t.eq(m.sharedArrayBuffer, 'undefined', 'SharedArrayBuffer is undefined');
    t.eq(m.isSecureContext, true, 'and the page is a secure context, so that is not the reason');

    t.prop('the capability line reports every field the page prints, live');
    t.deep(keysOf(m), ['clampW', 'crossOriginIsolated', 'deviceMemory', 'hardwareConcurrency',
      'indexedDB', 'isSecureContext', 'locks', 'sharedArrayBuffer', 'sharedWorker', 'ua',
      'visibilityState', 'worker'], 'twelve fields');
    t.eq(typeof m.ua, 'string', 'the user agent is printed and asserted nowhere');
    t.eq(typeof m.hardwareConcurrency, 'number', 'and so is the raw core count');

    t.prop('the Atomics members that work are counted here, not remembered');
    t.eq(a.ada, true, 'Atomics is present');
    /* The probe reports its own count. This recount is taken from what it
       reported, member by member, and never from that count — because the
       number this replaced was a literal, and a literal compared with itself is
       a check that has never once been able to go red. A member that begins
       refusing lands in its slot as a name rather than a value, and both routes
       move together. */
    t.eq(a.bekerja, recountAtomik(a), 'the probe\'s own count agrees with a recount of what it reported');
    t.eq(a.diprobe, 9, 'nine members were asked');
    t.gte(a.anggota, a.diprobe, 'out of at least that many function members this Atomics carries');
    t.eq(a.add, 0, 'add returned the previous value');
    t.eq(a.load, 5, 'load read what add wrote plus what store wrote');
    t.eq(a.compareExchange, 5, 'compareExchange returned the previous value');
    t.eq(a.exchange, 3, 'exchange returned the previous value');
    t.eq(a.isLockFree, true, 'and a four-byte element is lock free');
    t.eq(a.notify, 0, 'notify returns zero rather than refusing');

    t.neg('Atomics.wait refuses a buffer that is not shared');
    t.refusedWith(a.wait === 'TypeError', a.wait, /^TypeError$/, 'wait is refused by name');

    t.neg('Atomics.waitAsync refuses it too');
    t.refusedWith(a.waitAsync === 'TypeError', a.waitAsync, /^TypeError$/, 'waitAsync is refused by name');

    /* At W=1 the whole thesis collapses: pisah === satu, nothing is lost, and
       the audit's "the duplicates were not absorbed" finding degenerates into
       1 === 1. hardwareConcurrency legitimately returns 1 in a constrained
       container, so the clamp is the assertion and the raw value is printed
       beside it. */
    t.prop('the writer count is clamped, whatever this machine reports');
    t.eq(ARMS.clamp(1), 2, 'one core still gives two writers');
    t.eq(ARMS.clamp(2), 2, 'two gives two');
    t.eq(ARMS.clamp(4), 4, 'four gives four');
    t.eq(ARMS.clamp(16), 8, 'sixteen is capped at eight');
    t.eq(ARMS.clamp(KODE.ANGKA.clampMax + 1), KODE.ANGKA.clampMax, 'the cap is the one the numbers file names');
    t.eq(F.clampW, ARMS.clamp(m.hardwareConcurrency), 'this run clamped the value it was given');
    t.gte(F.clampW, KODE.ANGKA.clampMin, 'and the result is at least the floor');
    t.lte(F.clampW, KODE.ANGKA.clampMax, 'and at most the ceiling');
    t.eq(m.clampW, F.clampW, 'the capability line prints the same clamp the suite drove');
    /* Without this line the whole centrepiece is self-consistent at any writer
       count: G4 takes its expectation from the number the squad reports, so a
       squad that quietly ran one writer proves W*n === 1*n and stays green.
       Measured: driving the barrier squad at W=1 turned exactly one assertion
       red, in another group, by accident of an inequality. */
    t.eq(F.pusat.hadang.res.W, F.clampW, 'and the barrier squad ran at that clamp and not at some other number');
    t.gte(F.pusat.hadang.res.W, 2, 'which is at least two writers, or there is no race to describe');

    t.neg('and the clamp refuses a core count that is not a positive integer');
    t.throwsWith(function () { return ARMS.clamp(0); }, /E_MODE/, 'zero cores');
    t.throwsWith(function () { return ARMS.clamp(2.5); }, /E_MODE/, 'a fractional core count');
    t.throwsWith(function () { return ARMS.clamp('4'); }, /E_MODE/, 'a core count as a string');
  });

  /* ============================ G2 ==================================== */

  group('G2 the transaction boundary', function (t) {
    var b = F.batas, u = F.urut, i;
    var hidup = ['none', 'micro1', 'micro100k'];
    var mati = ['task', 'msgchan'];

    t.prop('a live transaction survives any number of awaits that settle in a microtask');
    for (i = 0; i < hidup.length; i++) {
      t.eq(b[hidup[i]].putOk, true, 'the write was accepted after ' + hidup[i]);
      t.eq(b[hidup[i]].final, b[hidup[i]].before + 1, 'and the record moved by one after ' + hidup[i]);
    }

    t.prop('and it reports a clean completion when it survives');
    for (i = 0; i < hidup.length; i++) {
      t.eq(b[hidup[i]].completed, true, hidup[i] + ' completed');
      t.eq(b[hidup[i]].aborted, false, hidup[i] + ' never aborted');
      t.eq(b[hidup[i]].txError, '', hidup[i] + ' carries no transaction error');
    }

    /* One hundred thousand chained microtasks cost ten milliseconds and produce
       one animation frame, so this is not a throttling artefact. */
    t.prop('one hundred thousand chained microtasks is still inside the transaction');
    t.eq(b.micro100k.putOk, true, 'the write landed');
    t.eq(b.micro100k.name, '', 'and nothing was thrown at it');

    t.neg('the write is refused the instant control reaches the task queue');
    t.refusedWith(!b.task.putOk, b.task.name, /^TransactionInactiveError$/, 'setTimeout(0) kills it');

    /* MessageChannel is a task and not a microtask, which kills the idea of
       using it as a throttle-proof boundary inside a transaction. */
    t.neg('and a message channel and an animation frame are tasks too');
    t.refusedWith(!b.msgchan.putOk, b.msgchan.name, /^TransactionInactiveError$/, 'MessageChannel kills it');
    t.refusedWith(!b.raf.putOk, b.raf.name, /^TransactionInactiveError$/, 'requestAnimationFrame kills it');

    t.prop('the transaction that lost its write still reports success');
    for (i = 0; i < mati.length; i++) {
      t.eq(b[mati[i]].completed, true, mati[i] + ' fired oncomplete anyway');
      t.eq(b[mati[i]].aborted, false, mati[i] + ' never fired onabort');
      t.eq(b[mati[i]].txError, '', mati[i] + ' left tx.error null');
    }

    t.prop('and the record is unchanged, so the transaction reported success over a write that is gone');
    for (i = 0; i < mati.length; i++) t.eq(b[mati[i]].final, b[mati[i]].before, mati[i] + ' moved nothing');
    t.eq(b.raf.final, b.raf.before, 'requestAnimationFrame moved nothing');

    t.prop('the boundary is the task queue and not the size of the wait');
    t.deep([b.none.putOk, b.micro1.putOk, b.micro100k.putOk, b.task.putOk, b.msgchan.putOk, b.raf.putOk],
      [true, true, true, false, false, false],
      'three microtask waits survive and three task waits do not, at any depth');

    t.neg('a wait kind this lab has no probe for is refused');
    t.refusedWith(F.batasAsing.ditolak, F.batasAsing.nama, /E_MODE/, 'an unknown wait kind');

    /* The obvious ordering probe records when each transaction was CONSTRUCTED.
       Both are constructed in one synchronous turn, so B's number is always the
       second one issued and the claim cannot fail. Measured: B-open is 2 in all
       four configurations. Every claim below is taken at B's FIRST READ. */
    t.prop('the construction order of two transactions is a tautology, and this build says so');
    for (i = 0; i < DB.URUT.length; i++) {
      t.eq(u[DB.URUT[i]].bOpen, 2, DB.URUT[i] + ' constructed the second transaction second');
    }

    t.prop('two readwrite transactions over the same store are serialised');
    t.gt(u.rwrw_same.bFirst, u.rwrw_same.aDone, 'B read for the first time after A had completed');
    t.eq(u.rwrw_same.serialised, true, 'and the probe agrees');
    t.eq(u.rwrw_same.paksa, true, 'this is an ordering the specification forces');

    t.prop('a readonly followed by a readwrite over the same store is serialised too');
    t.gt(u.rorw_same.bFirst, u.rorw_same.aDone, 'B read for the first time after A had completed');
    t.eq(u.rorw_same.serialised, true, 'and the probe agrees');
    t.eq(u.rorw_same.paksa, true, 'this is an ordering the specification forces');

    /* A conforming engine is free to serialise where it is merely permitted to
       overlap, so these two are measured, printed, and asserted nowhere. */
    t.prop('where the specification only permits concurrency, this build measures it and asserts nothing');
    t.eq(u.rwrw_disjoint.paksa, false, 'disjoint readwrite pairs are not a forced ordering');
    t.eq(u.roro_same.paksa, false, 'nor are two readonly transactions');
    t.eq(typeof u.rwrw_disjoint.serialised, 'boolean', 'both are reported as data');
    t.eq(typeof u.roro_same.serialised, 'boolean', 'and neither is asserted');

    t.prop('every ordering number is an integer this run issued and not a clock reading');
    var jam = [], nama = ['aOpen', 'bOpen', 'aFirst', 'bFirst', 'aDone', 'bDone'], j, kind;
    for (i = 0; i < DB.URUT.length; i++) {
      kind = DB.URUT[i];
      for (j = 0; j < nama.length; j++) {
        if (!KODE.bulat(u[kind][nama[j]]) || u[kind][nama[j]] >= 1e11) jam.push(kind + '.' + nama[j]);
      }
    }
    t.deep(jam, [], 'twenty-four sequence numbers, every one a small integer');

    t.neg('an ordering configuration this lab has no probe for is refused');
    t.refusedWith(F.urutAsing.ditolak, F.urutAsing.nama, /E_MODE/, 'an unknown ordering kind');
  });

  /* ============================ G3 ==================================== */

  group('G3 one thread, five strategies', function (t) {
    var r = F.utas.baris, i, row;

    function rowsOf(name) {
      var out = [], k;
      for (k = 0; k < r.length; k++) if (r[k].rencana.strategy === name) out.push(r[k]);
      return out;
    }

    /* No workers, no parallelism, one event loop, and the same money gone. Ten
       writers doing ten increments each produce ten, not one hundred: the cause
       is a read-set spanning an await, and parallelism only makes the
       interleaving easy to hit. */
    t.prop('the naive read-modify-write keeps one round per run, whatever the writer count');
    var polos = rowsOf('polos');
    for (i = 0; i < polos.length; i++) {
      t.eq(polos[i].res.final, polos[i].rencana.final,
        'W=' + polos[i].res.W + ' n=' + polos[i].res.n + ' ended at ' + polos[i].rencana.final);
    }
    t.eq(polos.length, 6, 'six writer counts from two to ten');

    t.prop('the identical code with no await loses nothing');
    var noio = rowsOf('noio')[0];
    t.eq(noio.res.final, noio.res.expected, 'the control ends at the product of its two integers');

    t.prop('a promise-chain critical section loses nothing');
    var mutex = rowsOf('mutex')[0];
    t.eq(mutex.res.final, mutex.res.expected, 'every increment survives');

    t.prop('compare-and-set loses nothing');
    var cas = rowsOf('cas');
    for (i = 0; i < cas.length; i++) t.eq(cas[i].res.final, cas[i].res.expected, 'W=' + cas[i].res.W);

    /* The winning design asserted (W-1)N. Measured: the two formulas coincide
       only at W=2, and at W=10 the wrong one is out by a factor of five. */
    t.prop('and its retry count is triangular, not one less than the writer count times the rounds');
    for (i = 0; i < cas.length; i++) {
      row = cas[i];
      t.eq(row.res.retries, row.rencana.retries, 'W=' + row.res.W + ' retried ' + row.rencana.retries + ' times');
      t.eq(row.res.retries, row.res.triangular, 'which is the triangular number');
    }
    var empat = cas[1];
    t.ne(empat.res.retries, (empat.res.W - 1) * empat.res.n, 'and at W=4 it is not the formula that was replaced');

    t.prop('append-and-fold loses nothing and reads nothing before writing');
    var tambah = rowsOf('tambah')[0];
    t.eq(tambah.res.final, tambah.res.expected, 'the fold over the log is the product');
    t.eq(tambah.res.reads, 0, 'and nothing was read before it was written');
    t.eq(tambah.res.rows, tambah.res.expected, 'one row per increment');

    t.prop('every strategy multiplied its own two integers to get its expectation');
    for (i = 0; i < r.length; i++) {
      t.eq(r[i].res.expected, r[i].res.W * r[i].res.n, r[i].res.strategy + ' W=' + r[i].res.W);
    }

    /* Eight hundred entries, five properties. A suite that asserted one per row
       would be reporting its loop bounds as evidence. */
    t.prop('the step log is totally ordered with unique, gapless sequence numbers');
    for (i = 0; i < r.length; i++) {
      t.ok(r[i].audit.ordered && r[i].audit.unique && r[i].audit.gapless,
        r[i].res.strategy + ' W=' + r[i].res.W + ' n=' + r[i].res.n + ' over ' + r[i].audit.entries + ' entries');
    }

    t.prop('and not one of those numbers is a clock reading');
    for (i = 0; i < r.length; i++) t.ok(r[i].audit.clockFree, r[i].res.strategy + ' W=' + r[i].res.W);

    t.prop('every write has a read from the same writer standing behind it');
    for (i = 0; i < r.length; i++) t.ok(r[i].audit.paired, r[i].res.strategy + ' W=' + r[i].res.W);

    t.prop('the log\'s own fold equals the variable the engine reported');
    for (i = 0; i < r.length; i++) {
      t.ok(r[i].audit.foldMatchesFinal, r[i].res.strategy + ' W=' + r[i].res.W + ' folds to ' + r[i].res.final);
      t.ok(r[i].audit.countsAgree, r[i].res.strategy + ' counted its own reads and writes the same way');
    }

    t.prop('reads minus writes is the retry count the engine counted separately');
    for (i = 0; i < r.length; i++) t.ok(r[i].audit.retriesAgree, r[i].res.strategy + ' W=' + r[i].res.W);

    /* Two awaits are the entire bug, and the smallest case that shows it is two
       writers doing one increment each. */
    t.prop('the minimal case is two writers, one increment each, and one survivor');
    t.eq(F.utas.kecil.final, 1, 'two increments, final 1');
    t.eq(F.utas.kecil.expected, 2, 'against an expectation of 2');
    t.eq(F.utas.langkah, 'read A(0) · read B(0) · write A(1) · write B(1) · final 1 of 2',
      'and the printed log says exactly how');

    t.neg('a retry loop with no cap is refused synchronously');
    t.throwsWith(function () { return UTAS.run('cas', 2, 2, { cap: 0 }); }, /E_CAS_NO_CAP/, 'a cap of zero');
    t.throwsWith(function () { return UTAS.run('cas', 2, 2, { cap: -1 }); }, /E_CAS_NO_CAP/, 'a negative cap');

    t.neg('and the cap is reached when the conflict source always conflicts');
    t.refusedWith(F.utas.casCap.ditolak, F.utas.casCap.nama, /E_CAS_CAP/, 'a deterministic conflict, no race');

    t.neg('a strategy this lab does not implement is refused');
    t.refusedWith(F.utas.modeAsing.ditolak, F.utas.modeAsing.nama, /E_MODE/, 'an unknown strategy');

    /* Two events inside one turn share a millisecond, and a worker's clock has
       a different origin from the page's — measured forty-nine milliseconds
       apart in one run. */
    t.neg('a clock reading handed in as an ordering key is refused');
    t.throwsWith(function () { return KODE.kunciUrut(Date.now()); }, /E_URUT_JAM/, 'an epoch millisecond');
    t.throwsWith(function () { return KODE.kunciUrut(new Date()); }, /E_URUT_JAM/, 'a Date');
    t.throwsWith(function () { return KODE.kunciUrut(1.5); }, /E_URUT_JAM/, 'a fractional reading');
    t.throwsWith(function () { return UTAS.jejak(0).key(Date.now()); }, /E_URUT_JAM/, 'the step log refuses one too');
  });

  /* ============================ G4 ==================================== */

  group('G4 the centrepiece, with the rendezvous', function (t) {
    var p = F.pusat.hadang, res = p.res, v = p.verdict;
    var W = res.W, n = res.n, exp = W * n;

    /* The rendezvous is not a delay. Every writer arrives at the same point in
       its own round and nobody proceeds until all of them have, so the
       interleaving is the same one every time and the loss becomes an integer
       instead of a distribution. */
    t.prop('the rendezvous turns the broken arm into an exact integer, independent of the writer count');
    t.eq(v.saldo['K-pisah'] - v.awal['K-pisah'], n, W + ' writers, ' + n + ' rounds, and the column moved by n');
    t.eq(v.delta['K-pisah'], n, 'the witness took the same delta from its own cursor');
    t.eq(v.kurang['K-pisah'], exp - n, 'and the shortfall is the two of them, subtracted here');

    t.prop('the two correct arms count every write');
    t.eq(v.delta['K-satu'], exp, 'the one-transaction arm ended at the product');
    t.eq(v.delta['K-kunci'], exp, 'and so did the locked arm');
    t.eq(v.kurang['K-satu'], 0, 'neither lost anything');
    t.eq(v.kurang['K-kunci'], 0, 'and the witness agrees');

    t.prop('the append-only ledger holds one row per write and folds to the same number');
    t.eq(v.buku.jurnal.deltaRows, exp, 'the journal grew by exactly one row per write');
    t.eq(v.buku.jurnal.total, exp, 'and its fold is the product');
    t.eq(v.buku.jurnal.kurangRows, 0, 'nothing is missing from it');

    t.prop('the witness multiplied the two integers itself and got the same expectation');
    t.eq(v.expected, exp, 'W and n arrived separately and were multiplied inside the witness');
    t.eq(v.W, W, 'it was handed the writer count');
    t.eq(v.n, n, 'and the round count, and nothing already multiplied');

    /* Two routes, no shared code. The engine read its own counters; the witness
       walked the object store with its own cursor and its own integer adder. */
    t.prop('the engine and the witness disagree about nothing');
    t.eq(F.pusat.hadang.banding.differs, 0, 'every compared label matched');
    t.gt(F.pusat.hadang.banding.rows.length, 0, 'and there were labels to compare');
    t.eq(F.pusat.hadang.banding.ok, true, 'the comparison itself passed');

    t.prop('the witness certifies the run and has nothing to report');
    t.eq(v.ok, true, 'the verdict is clean');
    t.deep(v.alasan, [], 'with no reasons recorded');
    t.eq(v.adder, true, 'and its own adder passed its load-time check');

    /* Both routes bottom out in the same object store and the same scheduler.
       There is no second storage engine in a browser, this file is not one, and
       pretending otherwise would be the exact vice this page attacks. */
    t.prop('and it carries the limit it cannot cross, for the page to print beside the agreement');
    t.eq(v.sharedBottom, 'IDBObjectStore', 'both routes bottom out in the same object store');

    t.prop('every worker was spawned, reported done, and was terminated');
    t.eq(res.spawned, W, 'the squad spawned the clamped writer count');
    t.eq(res.done, W, 'every one of them reported done');
    t.eq(res.terminated, W, 'and every one of them was terminated');
    t.eq(res.open, 0, 'no barrier key was left waiting');

    t.prop('no worker reported an error and none leaked a rejection');
    t.deep(res.errs, [], 'no arm failed');
    t.deep(res.urj, [], 'and no unhandled rejection was reported from any worker realm');
    t.eq(res.msgerr, 0, 'nothing failed to clone across postMessage');
    t.eq(res.why, 'ok', 'the squad finished on its own rather than on its budget');

    /* Four arms, two phases each, once per round. Deleting one phase is
       mutation three and it breaks the exact integer above. */
    t.prop('the coordinator released every arm in both phases exactly once per round');
    t.eq(res.released, res.arms.length * 2 * n,
      res.arms.length + ' arms, two phases, ' + n + ' rounds');

    t.prop('nothing left the origin from any realm');
    t.eq(res.egress, 0, 'no worker reported an attempt');
    t.eq(F.guard.total, 0, 'and the page realm counted none either');

    /* The page prints these bodies. What is on screen is what ran — there is no
       build step in this repository — and the claim beside them is structural
       rather than prose: each arm touches ITS OWN key and none of the others,
       so "identical traffic, one differing key" is checkable rather than
       asserted. The differing bodies are genuinely more than one line apart,
       and the page says so; what is one line is the key. */
    t.prop('each printed arm body names its own balance key and none of the others');
    t.deep(F.lengan.kunciLiteral.pisah, ['K-pisah'], 'the broken arm touches K-pisah only');
    t.deep(F.lengan.kunciLiteral.satu, ['K-satu'], 'the one-transaction arm touches K-satu only');
    t.deep(F.lengan.kunciLiteral.kunci, ['K-kunci'], 'the locked arm touches K-kunci only');
    t.deep(F.lengan.kunciLiteral.jurnal, [], 'and the ledger arm reads no balance at all');

    t.prop('the difference between two arms is read off the live functions, not described');
    t.gt(F.lengan.beda.pisahSatu, 0, F.lengan.beda.pisahSatu + ' lines differ between the two read-modify-write shapes');
    t.gt(F.lengan.beda.pisahKunci, 0, F.lengan.beda.pisahKunci + ' lines differ between the broken arm and the locked one');
    t.eq(F.lengan.beda.sama, 0, 'and a body compared against itself differs nowhere');
    t.gt(F.lengan.sumberPanjang, 100, 'the printed source is the whole switch and not a summary');

    /* No artificial delay, checked over the shipped text rather than promised
       in a comment — and proved able to fail against a planted body, because a
       scanner that has never refused anything is a scanner nobody has run. */
    t.prop('the shipped arms insert no delay of any kind');
    t.eq(F.lengan.noTimer.ok, true, 'the audit found nothing');
    t.deep(F.lengan.noTimer.hits, [], 'and named nothing');

    t.neg('and the audit refuses a body that does insert one');
    t.refusedWith(F.lengan.noTimerTanam.ok === false, F.lengan.noTimerTanam.hits.join(','),
      /Timeout/, 'a planted body carrying a timer is caught');

    /* If a barrier-mode container ever carried the race brand, every assertion
       in this group would still pass — the brand guards operands, and these are
       integers lifted off it. This is the property that catches it. */
    t.prop('nothing in the barrier fixture carries the race brand');
    t.eq(countBranded(F.pusat.hadang), 0, 'the exact half of this lab is unbranded');
    t.gt(countBranded(F.pusat.bebas), 0, 'and the free half is branded, so the brand is being applied');

    /* Without a deadline a dropped release hangs the run to the squad's
       watchdog and is reported as a budget rather than by name. */
    t.neg('a barrier phase nobody releases is refused by name rather than hanging');
    t.refusedWith(F.pusat.mati.ditolak, F.pusat.mati.nama, /E_HADANG_MATI/, 'the phase deadline fired');

    t.neg('and barrier mode refuses to run without somewhere to post arrivals');
    t.throwsWith(function () { return ARMS.ctx({ mode: 'hadang', w: 1 }); }, /E_MODE/, 'no post function');
  });

  /* ============================ G5 ==================================== */

  group('G5 the centrepiece, free — structural only', function (t) {
    var p = F.pusat.bebas, res = p.res, v = p.verdict;
    var W = res.W, n = res.n, exp = W * n;

    /* Everything in this group is either a structure or an inequality that is
       true by construction. The number the page finds interesting — how much
       the broken arm lost with nothing to synchronise it — is measured, printed
       and asserted NOWHERE, because it is a different number on every machine
       and pinning it is how a suite goes red on somebody else's laptop. */
    t.prop('a free-mode result is branded by the engine, which is what keeps it out of every assertion');
    t.ok(KODE.branded(res), 'the container carries the race brand');
    t.ok(KODE.branded(ARMS.seal('lepas', {})), 'and seal is its only constructor');
    t.notOk(KODE.branded(ARMS.seal('hadang', { __lomba__: true })), 'a caller-set brand is removed by the barrier mode');
    t.ok(KODE.branded(ARMS.seal('lepas', { __lomba__: false })), 'and a caller-cleared one is put back');

    t.prop('with no rendezvous at all the two correct arms still count every write');
    t.eq(v.delta['K-satu'], exp, 'the one-transaction arm ended at the product');
    t.eq(v.buku.jurnal.deltaRows, exp, 'and the ledger holds one row per write');
    t.eq(v.buku.jurnal.total, exp, 'which folds to the same number');

    /* A write stores at most what it read plus one, and there are W*n writes.
       That is the whole justification, and it is the only inequality in this
       lab that touches a race outcome. */
    t.prop('the broken arm is bounded by construction, and asserted no further than that');
    t.gte(v.delta['K-pisah'], 0, 'no write can lower the column');
    t.lte(v.delta['K-pisah'], exp, 'and no write can raise it by more than one');
    t.eq(v.expected, exp, 'the expectation is still the product of the two integers');

    t.prop('the free run completed and cleaned up after itself');
    /* Not the core count — §1.4 forbids asserting that, and this does not: it
       pins that the squad ran at the number the capability line printed rather
       than at some other one. Without it a free squad that quietly collapsed to
       a single writer would leave every assertion in this group green, because
       every one of them is derived from the count the squad reported. */
    t.eq(res.W, F.hc, 'it ran at the raw core count the page prints, whatever that number is here');
    t.eq(res.why, 'ok', 'it finished on its own');
    t.eq(res.terminated, res.spawned, 'every worker it spawned was terminated');
    t.deep(res.errs, [], 'no arm failed');
    t.deep(res.urj, [], 'and no rejection leaked out of a worker realm');

    t.neg('an assertion handed the free-mode container itself is refused by every helper');
    var junk = [], jreg = [], jt = makeCtx(junk, 'throwaway', jreg), before = LOMBA_TOUCHED;
    jt.prop('deliberately comparing two branded containers');
    jt.deep(res, res, 'misuse');
    t.refusedWith(LOMBA_TOUCHED === before + 1 && junk[0].ok === false, junk[0].message,
      /race outcome/, 'deep is guarded like the rest');
    LOMBA_TOUCHED = before;

    /* You cannot launder a race outcome by handing it to the witness. */
    t.neg('and the witness refuses a branded value as evidence');
    t.throwsWith(function () {
      return SAKSI.periksa({}, ARMS.seal('lepas', { akun: {}, acc: 0, jurnal: 0, led_n: 0, led_u: 0 }), 2, 2);
    }, /E_SAKSI_UKUR/, 'a branded before snapshot');
  });

  /* ============================ G6 ==================================== */

  group('G6 append-only invariants', function (t) {
    var v = F.pusat.hadang.verdict, j = v.buku.jurnal;
    var exp = v.expected;

    t.prop('the ledger only ever grew');
    t.eq(j.deltaRows, exp, 'it holds one more row per write than the snapshot recorded');
    t.gte(j.deltaRows, 0, 'and never fewer rows than before');
    t.eq(j.awalRows, 0, 'the snapshot was taken on an empty ledger');
    t.eq(j.rows, exp, 'so the row count is the product of the two integers');

    t.prop('every row carries an integer delta, and none of them is negative');
    t.eq(j.negatif, 0, 'no row moves money backwards');
    t.eq(j.total, exp, 'and the fold over the deltas is the row count, because every delta is one');

    t.prop('every row carries its own idempotency key');
    t.eq(j.unik, j.rows, 'as many distinct keys as rows');
    t.eq(j.ganda, 0, 'no key appears twice');
    t.eq(j.tanpaKunci, 0, 'and no row arrived without one');

    /* The witness's adder is checked against fixed vectors written into its own
       header, never against the engine's adder, and it is checked in four
       orders because an adder that is order-dependent gives a different answer
       to two people looking at the same rows. */
    t.prop('the witness\'s own adder is order-independent and passes its own vectors');
    t.eq(SAKSI.SENDIRI.ok, true, 'the load-time self-check passed');
    t.eq(SAKSI.SENDIRI.harapan, 22, 'the vector sums to the number written beside it');
    t.eq(SAKSI.SENDIRI.maju, SAKSI.SENDIRI.mundur, 'forwards and backwards agree');
    t.eq(SAKSI.SENDIRI.maju, SAKSI.SENDIRI.geser, 'and so does a rotation');
    t.eq(SAKSI.SENDIRI.maju, SAKSI.SENDIRI.urut, 'and a sort');
    t.eq(SAKSI.SENDIRI.adilOrder, true, 'all four orders agree');
    t.deep(SAKSI.SENDIRI.alasan, [], 'with nothing recorded against it');

    t.prop('and the fold it produced agrees with the number the engine reported');
    t.eq(F.pusat.hadang.banding.differs, 0, 'no compared label differs');
    t.eq(j.total, F.pusat.hadang.res.n * F.pusat.hadang.res.W, 'the ledger fold is the product');

    t.prop('the ledger balance and the column balance are the same money counted twice');
    t.eq(j.total, v.delta['K-satu'], 'the append-only route and the read-modify-write route agree');
    t.ne(j.total, v.delta['K-pisah'], 'and both disagree with the arm that lost updates');

    t.neg('a second row carrying an idempotency key that is already in the ledger is refused');
    t.refusedWith(F.jurnal.ganda.ditolak, F.jurnal.ganda.nama, /E_JURNAL_GANDA/, 'the unique index held');

    /* The unique index catches a replayed KEY. Only add() catches a replayed
       ROW ID, and put() over one overwrites and tells nobody — which is the
       bug this repository has already shipped once, with ledger ids from a
       per-tab counter and one tab destroying another tab's entries. */
    t.neg('and a second row carrying a row id that is already in the ledger is refused too');
    t.refusedWith(F.jurnal.gandaId.ditolak, F.jurnal.gandaId.nama, /E_JURNAL_GANDA/,
      'the ledger is written with add(), which refuses, and never with put(), which overwrites');

    t.prop('and the row that was already there is untouched by the attempt');
    t.eq(F.jurnal.gandaId.baris, 1, 'one row for that id');
    t.eq(F.jurnal.gandaId.delta, 1, 'still carrying the amount the first write put on it');

    /* put() over an existing key overwrites and tells nobody; add() throws.
       This portfolio has already shipped the other one — ledger ids from a
       per-tab counter used as a key, one tab destroying another tab's entries,
       fixed by exactly this one-word change. */
    t.neg('add() over an existing row id is refused, and put() is not');
    t.refusedWith(F.idem.pasangan.addKedua === 'ConstraintError', F.idem.pasangan.addKedua,
      /^ConstraintError$/, 'add refuses the second write');

    t.prop('and the silent overwrite is shown rather than described');
    t.eq(F.idem.pasangan.putKedua, 'accepted', 'put accepted the same write');
    t.eq(F.idem.pasangan.rowsAfterAdd, 1, 'the row count never moved');
    t.eq(F.idem.pasangan.deltaAfterPut, 900, 'and the amount on the row changed underneath it');

    t.neg('money that is not a whole number of rupiah is refused');
    t.throwsWith(function () { return KODE.rupiah(500.5, 'a fractional amount'); }, /E_BUKAN_BULAT/, 'a float');
    t.throwsWith(function () { return KODE.rupiah('500', 'an amount as a string'); }, /E_BUKAN_BULAT/, 'a string');

    t.neg('and a fold over a list containing one is refused by the witness');
    t.throwsWith(function () { return SAKSI.tambah([1, 2, 0.5]); }, /E_SAKSI_PECAHAN/, 'a fractional row');
    t.throwsWith(function () { return SAKSI.tambah([1, 2, NaN]); }, /E_SAKSI_PECAHAN/, 'a NaN');
  });

  /* ============================ G7 ==================================== */

  group('G7 exactly once, four modes', function (t) {
    var m = F.idem.mode;

    /* Both deliveries read before either wrote. Serialising the WRITE did not
       help, because the CHECK was outside the critical section. A check is not
       a constraint. */
    t.prop('a check outside the critical section double-credits, with a real lock around the write');
    t.eq(m['periksa-saja'].stored, 1000, 'the stored column ended at twice the amount');
    t.eq(m['periksa-saja'].rows, 2, 'two ledger rows carry the same idempotency key');
    t.eq(m['periksa-saja'].derived, 1000, 'and the ledger agrees with the column, wrongly');
    t.deep(m['periksa-saja'].refused, [], 'nothing was refused: the index is not unique');

    t.prop('and the lock around the write was a real Web Lock, not a promise chain');
    t.eq(m['periksa-saja'].holdKind, 'kunci', 'the critical section came from navigator.locks');
    t.eq(m['periksa-saja'].ledger, 'led_n', 'against the ledger whose index is not unique');
    t.eq(m['periksa-saja'].unique, false, 'which is what lets the second row exist');

    t.neg('the second delivery is refused when the key and the effect share one transaction');
    t.refusedWith(m.atomik.refused.length === 1, m.atomik.refused.join(','), /^ConstraintError$/,
      'the unique index refused the replay');

    t.prop('and that is the mode that credits once');
    t.eq(m.atomik.stored, 500, 'the column moved by the amount, once');
    t.eq(m.atomik.rows, 1, 'one ledger row');
    t.eq(m.atomik.derived, 500, 'and the ledger agrees');
    t.eq(m.atomik.applied, 1, 'one delivery applied');
    t.eq(m.atomik.tx, 2, 'in two transactions across the two deliveries — one each');

    /* The winning design asserted [0, 1, 500] — the key recorded and the money
       never arriving. That requires the winner to be interrupted between its
       two transactions and never resume, which is a crash, and this lab has no
       crash. Measured thirty times at three throttle rates: 500/1/500. */
    t.prop('splitting the key from the effect still credits once here, and the reason matters');
    t.eq(m['pisah-txn'].stored, 500, 'the column moved by the amount');
    t.eq(m['pisah-txn'].rows, 1, 'one ledger row');
    t.eq(m['pisah-txn'].derived, 500, 'and the ledger agrees, so this is not the crash outcome');
    t.eq(m['pisah-txn'].tx, 4, 'but it took four transactions where the atomic mode took two');

    t.neg('and its loser is refused for the same reason the atomic mode\'s is');
    t.refusedWith(m['pisah-txn'].refused.length === 1, m['pisah-txn'].refused.join(','),
      /^ConstraintError$/, 'the key insert lost');

    /* The missing key should have doubled the credit to a thousand; the lost
       update ate the second one. You cannot see the idempotency bug until you
       have fixed the concurrency bug. */
    t.prop('with no key at all the right answer arrives from two live bugs cancelling');
    t.eq(m['tanpa-kunci'].stored, 500, 'the column ended at the correct number');
    t.eq(m['tanpa-kunci'].rows, 2, 'and the ledger holds two rows for one webhook');
    t.eq(m['tanpa-kunci'].derived, 1000, 'which folds to twice the money');
    t.eq(m['tanpa-kunci'].agree, false, 'the two routes disagree, and that is the finding');

    t.prop('each mode writes the ledger its lesson needs');
    t.eq(IDEM.LEDGER['periksa-saja'], 'led_n', 'the check-only mode needs an index that is not unique');
    t.eq(IDEM.LEDGER.atomik, 'led_u', 'the atomic mode needs one that is');
    t.eq(IDEM.LEDGER['pisah-txn'], 'led_u', 'and so does the split mode');
    t.eq(m.atomik.unique, true, 'the unique flag travels with the result');

    t.prop('every mode was delivered twice, in one synchronous turn');
    t.eq(m.atomik.deliveries, 2, 'two deliveries, arriving at once');
    t.eq(m['periksa-saja'].applied + m['periksa-saja'].absorbed, 2, 'both were applied in the check-only mode');
    t.eq(m.atomik.applied + m.atomik.refused.length, 2, 'one applied and one refused in the atomic mode');

    t.prop('the replay window applies a key that returns after the window has moved past it');
    t.eq(F.idem.jendelaKecil.applied, 5, 'five operations applied');
    t.deep(F.idem.jendelaKecil.replayed, ['IDEM-FIKTIF-000A'], 'and the key that came back was applied a second time');
    t.eq(F.idem.jendelaKecil.absorbed, 0, 'nothing was absorbed');
    t.eq(F.idem.jendelaKecil.held, 3, 'because the window holds three entries');

    t.prop('and absorbs it while it is still inside the window');
    t.eq(F.idem.jendelaBesar.applied, 1, 'one of the two was applied');
    t.eq(F.idem.jendelaBesar.absorbed, 1, 'and the other was absorbed');
    t.deep(F.idem.jendelaBesar.replayed, [], 'with nothing replayed');

    t.neg('an idempotency key of the wrong shape is refused');
    t.throwsWith(function () { return IDEM.bentuk('IDEM-FIKTIF-1'); }, /E_KUNCI_BENTUK/, 'too few digits');
    t.throwsWith(function () { return IDEM.bentuk('idem-fiktif-0001'); }, /E_KUNCI_BENTUK/, 'the wrong case');
    t.throwsWith(function () { return IDEM.bentuk('ORDER-0001'); }, /E_KUNCI_BENTUK/, 'a key that is not fabricated');
    t.throwsWith(function () { return IDEM.bentuk(1); }, /E_KUNCI_BENTUK/, 'a key that is not a string');

    /* NOT run()'s amount: a non-integer there is not an integer, so the
       default is used and nothing is refused. Measured — the assertion that
       looked right recorded a thenable through the async tripwire instead.
       The gate that does fire is the one on the generator. */
    t.neg('a sequence number that is not a whole number cannot make an idempotency key');
    t.throwsWith(function () { return IDEM.buatKunci(0.5); }, /E_BUKAN_BULAT/, 'a fractional sequence');
    t.throwsWith(function () { return IDEM.buatKunci('7'); }, /E_BUKAN_BULAT/, 'a sequence as a string');

    t.neg('a mode this lab does not implement is refused');
    t.refusedWith(F.idem.modeAsing.ditolak, F.idem.modeAsing.nama, /E_MODE/, 'an unknown mode');

    t.neg('and a replay window that is not a positive integer is refused');
    t.throwsWith(function () { return IDEM.jendela(0, ['A']); }, /E_MODE/, 'a window of zero');
    t.throwsWith(function () { return IDEM.jendela(3, 'A'); }, /E_MODE/, 'an operation list that is not an array');
  });

  /* ============================ G8 ==================================== */

  /* Nothing here asserts that Web Locks works. That the browser serialises two
     exclusive requests is Chromium's claim and Chromium's problem; what is
     asserted is this lab's REACTION — that the helper refuses a request that
     could wait forever, that the refusal carries the code this file names, and
     that the shapes the page prints are the shapes query() returned. */
  group('G8 the queue, and this lab\'s own refusals around it', function (t) {
    var p = F.kunci.p;

    t.prop('the lock helper is available in this realm and names exactly one source');
    t.eq(KUNCI.ada(), true, 'navigator.locks is usable');
    t.eq(KUNCI.PERILAKU.length, 13, 'thirteen behaviours, every one of them executed by the page');
    t.eq(typeof KUNCI.sumber(), 'object', 'and the helper reaches for it in one place');

    t.prop('the helper\'s deadline is the number the numbers file names');
    t.eq(KUNCI.BUDGET, KODE.ANGKA.lockDeadline, 'one number, two files, checked rather than promised');
    t.eq(KUNCI.BUDGET, 2000, 'two seconds on every request that can wait');

    /* Two runs that share a lock name serialise against each other, and the
       second one's numbers are the first one's. The prefix is applied by the
       helper and not by the caller, so the printed arm body can carry a bare
       name and still be honest. */
    t.prop('the run\'s lock prefix is applied by the helper, not by its callers');
    t.eq(KUNCI.nama('rmw'), KUNCI.awalan() + 'rmw', 'a bare name comes back prefixed');
    t.eq(KUNCI.awalan(), F.lockPrefix, 'and the prefix is this run\'s');
    t.match(F.lockPrefix, /^srb-/, 'which is scoped to the run rather than to the lab');

    t.prop('a holder and a waiter produce a complete in-out sequence');
    t.eq(p.urutan.order, 'a-in,a-out,b-in,b-out', 'the second request entered after the first left');
    t.eq(p.urutan.ok, true, 'and the fixture agrees');

    t.prop('an ifAvailable request that cannot be granted still runs, with no lock');
    t.eq(p.tersedia.ran, true, 'the callback ran');
    t.eq(p.tersedia.lockNull, true, 'and was handed null rather than a lock');
    t.eq(p.tersedia.value, 'ran', 'and its return value propagated');

    t.prop('a stolen lock is granted, and the fixture reports what happened to the holder it took it from');
    t.eq(p.curi.mode, 'exclusive', 'the thief holds it exclusively');
    t.eq(p.curi.holder, 'AbortError', 'and the previous holder was aborted');

    t.prop('shared holders overlap, and the queue behind an exclusive one is first in, first out');
    t.eq(p.berbagi.order, 's1-in,s2-in,x1-in,s3-in',
      'the trailing shared request did not join the leading shared holders');

    t.prop('query() returns the shape the page prints, and a visitor can paste it into a console');
    t.deep(p.bentuk.top, ['held', 'pending'], 'two lists');
    t.deep(p.bentuk.entry, ['clientId', 'mode', 'name'], 'three fields per entry');
    t.eq(p.bentuk.held, 1, 'and the fixture\'s own hold was in it');

    /* clientId is per client, not per request, so an on-screen queue cannot be
       labelled by requester within one document. That is why each queued
       participant in this lab gets its own worker. */
    t.prop('clientId is per client and not per request, so the queue cannot name its requesters');
    t.eq(p.klien.pending, 2, 'two requests were pending from one document');
    t.eq(p.klien.distinct, 1, 'carrying one distinct client id between them');
    t.eq(p.klien.sameAsHeld, true, 'the same one the holder carries');

    t.prop('a worker that holds a lock appears in the browser\'s own queue, and terminate releases it');
    t.eq(F.kunci.pekerja.hidup, 1, 'query() saw the worker\'s hold while it was alive');
    t.eq(F.kunci.pekerja.mati, 0, 'and did not see it after the worker was terminated');
    /* There is no specified synchronisation point between terminate() returning
       and the lock being released, so the poll's deadline is printed and never
       asserted: asserting the first poll is asserting how fast this machine got
       round to it. */
    t.eq(typeof F.kunci.pekerja.tries, 'number', 'the number of polls it took is reported, not asserted');
    t.eq(typeof F.kunci.pekerja.budget, 'number', 'and so is the deadline it was given');

    t.neg('an aborted signal refuses the request by name');
    t.refusedWith(p.sinyal.name === 'AbortError', p.sinyal.name, /^AbortError$/, 'an aborted signal');

    t.neg('and a signal that timed out refuses it under a different name');
    t.refusedWith(p.waktu.name === 'TimeoutError', p.waktu.name, /^TimeoutError$/,
      'a timeout is not an abort, and both are assertable');

    t.neg('a mode the browser does not recognise is refused by the browser, and the page prints that');
    t.refusedWith(p.modeSalah.name === 'TypeError', p.modeSalah.name, /^TypeError$/, 'mode nonsense');

    t.neg('ifAvailable cannot be combined with steal');
    t.refusedWith(p.tersediaCuri.name === 'NotSupportedError', p.tersediaCuri.name,
      /^NotSupportedError$/, 'ifAvailable and steal together');

    /* Measured here and not recorded in the survey: a signal cannot be combined
       with steal either, which is why this lab's rule is "never issue a request
       that can wait" and not "always carry a signal". */
    t.neg('and neither can a signal');
    t.refusedWith(p.sinyalCuri.name === 'NotSupportedError', p.sinyalCuri.name,
      /^NotSupportedError$/, 'a signal and steal together');

    /* This is the structural reason a lock in this lab cannot hang
       page.evaluate, which has no timeout of its own. */
    t.neg('a request carrying nothing that bounds it is refused synchronously, by this lab');
    t.throwsWith(function () { return KUNCI.hold('x', {}, function () { return 1; }); },
      /E_KUNCI_TANPA_BATAS/, 'no signal, no ifAvailable, no steal');
    t.throwsWith(function () { return KUNCI.hold('x', { mode: 'exclusive' }, function () { return 1; }); },
      /E_KUNCI_TANPA_BATAS/, 'a mode is not a bound');

    /* A feature detection that has never been seen to refuse is not a feature
       detection, and this one cannot be proved by deleting navigator.locks out
       from under a live page — so the source arrives as an argument. */
    t.neg('a realm with no lock manager is refused, and the detection is proved rather than assumed');
    t.throwsWith(function () { return KUNCI.holdDengan(null, 'x', {}, function () { return 1; }); },
      /E_KUNCI_TIADA/, 'no lock manager at all');
    t.throwsWith(function () { return KUNCI.holdDengan({}, 'x', {}, function () { return 1; }); },
      /E_KUNCI_TIADA/, 'an object that is not one');

    t.neg('and a request with nothing to run is refused before either of those');
    t.throwsWith(function () { return KUNCI.hold('x', {}, null); }, /E_MODE/, 'no callback');
    t.throwsWith(function () { return KUNCI.holdDengan(null, 'x', {}, 'nope'); }, /E_MODE/,
      'the callback is checked before the lock manager is');

    /* Web Locks has no deadlock detector and no default timeout. A nested
       same-name request is the shortest route to that, and the only thing that
       saves it is the deadline this lab insists on. */
    t.neg('a nested request for a lock this agent already holds is refused at its own deadline');
    t.refusedWith(p.sarangBerbatas.inner === 'TimeoutError', p.sarangBerbatas.inner,
      /^TimeoutError$/, 'the inner request timed out');

    t.prop('and the outer one completes, so the deadline is what keeps the page alive');
    t.eq(p.sarangBerbatas.outer, true, 'the holder finished normally');
    t.eq(p.sarangBerbatas.ok, true, 'and the fixture agrees');

    t.neg('a behaviour this lab has no fixture for is refused');
    t.refusedWith(F.kunci.asing.ditolak, F.kunci.asing.nama, /E_MODE/, 'an unknown behaviour name');
  });

  /* ============================ G9 ==================================== */

  /* The firewall. The recurring bug wears a new costume here and it is the most
     natural mistake available: report lost = expected - final where final is
     the number the workers returned in their own summary. Both operands come
     from the same message, so the difference can only be what the engine said.
     Shipped four times in this repository. */
  group('G9 the witness, and what it refuses', function (t) {
    var v = F.pusat.hadang.verdict;

    t.prop('the witness built its own worklist from the snapshot it was handed');
    t.deep(v.worklist, ['acc', 'akun', 'jurnal', 'led_n', 'led_u'], 'five stores, chosen by the witness');
    t.deep(v.unknown, [], 'and nothing in the snapshot it had no shape for');
    t.deep(v.diabaikan, [], 'and no rows it was handed for a store it did not ask about');

    t.prop('it multiplied the two integers itself, and there is no argument anywhere that takes a product');
    t.eq(v.expected, v.W * v.n, 'the expectation was produced inside the witness');
    t.eq(SAKSI.harap(3, 7), 21, 'from two integers');
    t.eq(SAKSI.harap(0, 7), 0, 'including the degenerate case');

    t.prop('every figure it reports came off its own cursor over the object store');
    t.eq(v.toko.akun.via, 'objectStore', 'the balances came from the store');
    t.eq(v.toko.jurnal.via, 'objectStore', 'and so did the ledger rows');
    t.eq(v.toko.jurnal.rows, v.buku.jurnal.rows, 'and the count it walked is the count it folded');

    t.prop('the headline shortfall is a subtraction between two numbers it took itself');
    t.eq(v.kurang['K-pisah'], v.expected - v.delta['K-pisah'], 'expected minus the delta it measured');
    t.eq(v.delta['K-pisah'], v.saldo['K-pisah'] - v.awal['K-pisah'], 'and the delta is after minus before');

    t.prop('and it carries the limit it cannot cross');
    t.eq(v.sharedBottom, SAKSI.BAWAH, 'both routes bottom out in the same object store');
    t.eq(SAKSI.BAWAH, 'IDBObjectStore', 'named on the page beside the agreement, not underneath it');

    t.prop('the comparison against the engine answers every label the page prints');
    t.eq(F.pusat.hadang.banding.sharedBottom, 'IDBObjectStore', 'the comparison carries it too');
    t.eq(F.pusat.hadang.banding.differs, 0, 'nothing differs');
    t.gte(F.pusat.hadang.banding.rows.length, 6, 'across at least six labels');

    t.prop('and its own adder is checked against fixed vectors rather than against the engine\'s');
    t.eq(SAKSI.SENDIRI.batasOk, true, 'including one that runs up against the safe integer boundary');
    t.eq(SAKSI.SENDIRI.kosongDitolak, true, 'an empty fold with no explicit zero is refused');
    t.eq(SAKSI.SENDIRI.takmuatDitolak, true, 'and so is a value it cannot add');
    t.eq(SAKSI.tambah([], 0), 0, 'the explicit zero is the only way to fold nothing');

    /* Six refusals, all SYNCHRONOUS, before any promise exists — because a
       rejected promise handed to a synchronous throws() helper is recorded as
       "did not throw" and then dropped, and a dropped rejection is a page error
       that fails the whole lab with every assertion green. */
    t.neg('a thenable is refused');
    t.throwsWith(function () { return SAKSI.fold({ then: function () { } }, F.saksi.before, 2, 2); },
      /E_SAKSI_THENABLE/, 'a reader that is a thenable');
    t.throwsWith(function () { return SAKSI.periksa({}, { then: function () { } }, 2, 2); },
      /E_SAKSI_THENABLE/, 'a before snapshot that is one');

    t.neg('a branded value is refused');
    t.throwsWith(function () { return SAKSI.periksa({}, KODE.seal('lepas', { akun: {} }), 2, 2); },
      /E_SAKSI_UKUR/, 'a race outcome as evidence');
    t.throwsWith(function () { return SAKSI.periksa({}, KODE.stamp({ akun: {} }), 2, 2); },
      /E_SAKSI_UKUR/, 'a timing as evidence');

    t.neg('a live handle, a Map, a Set or a RegExp is refused');
    t.throwsWith(function () { return SAKSI.periksa({}, new Map(), 2, 2); }, /E_SAKSI_PEGANGAN/, 'a Map');
    t.throwsWith(function () { return SAKSI.periksa({}, { akun: new Set() }, 2, 2); }, /E_SAKSI_PEGANGAN/, 'a Set');
    t.throwsWith(function () { return SAKSI.periksa({}, { akun: /x/ }, 2, 2); }, /E_SAKSI_PEGANGAN/, 'a RegExp');
    t.throwsWith(function () { return SAKSI.periksa({}, { akun: F.saksi.handle }, 2, 2); },
      /E_SAKSI_PEGANGAN/, 'the database handle itself');

    t.neg('a before snapshot that is a function is refused');
    t.throwsWith(function () { return SAKSI.periksa({}, function () { return { akun: {} }; }, 2, 2); },
      /E_SAKSI_GETTER/, 'a snapshot that would be re-read at witness time');

    t.neg('a fractional figure anywhere in the snapshot is refused');
    t.throwsWith(function () { return SAKSI.periksa({}, { akun: { 'K-pisah': 0.5 } }, 2, 2); },
      /E_SAKSI_PECAHAN/, 'a fractional balance');
    t.throwsWith(function () { return SAKSI.harap(2.5, 2); }, /E_SAKSI_PECAHAN/, 'a fractional writer count');
    t.throwsWith(function () { return SAKSI.utuh(1 / 0, 'an infinity'); }, /E_SAKSI_PECAHAN/, 'an infinity');

    t.neg('an empty fold with no explicit zero is refused');
    t.throwsWith(function () { return SAKSI.tambah([]); }, /E_SAKSI_KOSONG/, 'nothing to add and nothing said about it');
    t.throwsWith(function () { return SAKSI.periksa({}, {}, 2, 2); }, /E_SAKSI_KOSONG/, 'a snapshot naming no store it knows');

    /* An index-backed read with a range sees a subset of the rows and folds
       cleanly over it, and a clean fold over a subset is a green panel over
       missing money. The planted reader is what proves the check fires. */
    t.neg('rows that arrived from an index rather than from the store are refused');
    t.throwsWith(function () {
      return SAKSI.periksa({ akun: { store: 'akun', via: 'index', count: 0, rows: [] } },
        { akun: { 'K-pisah': 0 } }, 2, 2);
    }, /E_SAKSI_PEGANGAN/, 'an envelope claiming an index');
    t.refusedWith(F.saksi.indeks.ditolak, F.saksi.indeks.nama, /E_SAKSI_PEGANGAN/,
      'and the planted index-backed reader, driven against a store that has one');

    t.neg('and an envelope whose count disagrees with the rows it carries is refused');
    t.throwsWith(function () {
      return SAKSI.periksa({ akun: { store: 'akun', via: 'objectStore', count: 4, rows: [] } },
        { akun: { 'K-pisah': 0 } }, 2, 2);
    }, /E_SAKSI_KOSONG/, 'four rows reported and none carried');

    t.neg('a label the comparison cannot produce independently is refused rather than guessed');
    t.throwsWith(function () { return SAKSI.banding({ 'nothing-it-knows': 1 }, v); },
      /E_SAKSI_KOSONG/, 'a label with no independent route');
  });

  /* ============================ G10 =================================== */

  group('G10 the guard, across two realms', function (t) {
    var g = root.SEROBOT_GUARD;

    t.prop('the guard is loaded and reports the counters the page prints');
    t.deep(keysOf(g), ['counts', 'log', 'noteExternal', 'onchange', 'total'], 'five members');
    t.deep(keysOf(g.counts), ['beacon', 'eventsource', 'fetch', 'websocket', 'xhr'], 'five counters');

    t.prop('nothing in this run attempted to leave the origin from the page realm');
    t.eq(g.total(), 0, 'the page counter is zero');
    t.deep(g.counts, { fetch: 0, xhr: 0, beacon: 0, websocket: 0, eventsource: 0 }, 'and so is every counter');
    t.eq(g.log.length, 0, 'with nothing in the log');

    t.prop('and nothing attempted it from any worker realm either');
    t.eq(F.pusat.hadang.res.egress, 0, 'the barrier squad reported none');
    t.eq(F.pusat.bebas.res.egress, 0, 'the free squad reported none');
    t.eq(F.guard.total, 0, 'and the fold of both is still zero');

    /* A meta CSP does not reach a worker realm. Measured under this lab's own
       policy: a fetch from the page is refused with connect-src 'none' while
       the identical fetch from inside a worker RESOLVES, silently, with nothing
       the page's counter can see. So the total this suite reports is the page's
       plus every worker's own, and the runner polices the network layer
       underneath both. */
    /* The arithmetic is exercised on the live counter, before any workload
       runs, and the counter is put back to zero afterwards — which is itself
       asserted, because a suite that could quietly zero this counter is a
       suite that could hide a real attempt. Nothing here makes a request: the
       target string is fabricated and says so. The check that cannot be fooled
       by any of this is the runner's own page.on('request'), which sees every
       realm and needs no cooperation from the code under test. */
    var probe = F.guard.probe;
    t.prop('the fold is arithmetic through the same entry point a worker\'s total arrives by');
    t.eq(probe.mulai, 0, 'the counter was at zero before the probe');
    t.eq(probe.satu, 1, 'one attempt noted');
    t.eq(probe.tiga, 3, 'three attempts noted, and the total is their sum');
    t.eq(probe.log, 3, 'each one recorded in the log');
    t.eq(probe.asal, 'worker', 'carrying the realm it was folded in from');
    t.eq(probe.target, 'FIKTIF-no-request-was-made', 'and a target that says no request was made');

    t.prop('an attempt of a kind the guard has no counter for is still counted, not dropped');
    t.eq(probe.tak, 4, 'an unknown kind raised the total rather than being lost');
    t.eq(probe.takKunci, true, 'and a counter was created for it');

    t.prop('and the counter was put back, which is asserted rather than assumed');
    t.eq(probe.kembali, 0, 'the total is zero again');
    t.eq(probe.logKembali, 0, 'the log is empty again');
    t.eq(g.total(), 0, 'and it is still zero now, at the end of the run');

    t.prop('the five network entry points are wrapped rather than described');
    t.eq(F.guard.fetchNative, false, 'fetch is not the function the browser shipped');
    t.eq(F.guard.xhrNative, false, 'nor is XMLHttpRequest.prototype.open');
    t.eq(F.guard.wsNative, false, 'nor is the WebSocket constructor');

    /* A meta CSP does not reach a worker realm, and the page's counter object
       lives in the page realm only, so there is no arrangement of this code
       that lets window.SEROBOT_GUARD.total() see an attempt made inside a
       worker. The fold is the only route, and this lab is the first in this
       repository where that sentence is true.

       Which is exactly why "the workers reported nothing" is worth nothing on
       its own. A worker with no guard at all reports zero, and so does a worker
       that stopped reporting: `egress: m.egress | 0` turns an absent number
       into a clean one. Both were injected into the shipped files and BOTH LEFT
       EVERY PROPERTY IN THIS SUITE GREEN before the two counters below existed,
       three runs each, and the page kept its zero-egress badge throughout. So every
       worker now states whether its own realm is wrapped, and the suite pins
       that statement against the number of workers it spawned. */
    t.prop('every worker realm reported that it was counting, and reported a count');
    t.eq(F.pusat.hadang.res.jaga, F.pusat.hadang.res.spawned,
      'every worker in the barrier squad carried its own wrapped counter');
    t.eq(F.pusat.bebas.res.jaga, F.pusat.bebas.res.spawned,
      'and so did every worker in the free squad');
    t.eq(F.pusat.hadang.res.lapor, F.pusat.hadang.res.spawned,
      'and every one of them sent a number rather than an absence');
    t.eq(F.pusat.bebas.res.lapor, F.pusat.bebas.res.spawned, 'in both squads');

    t.neg('the page realm is refused sight of a worker realm\'s own counter, which is why the fold exists');
    t.refusedWith(F.guard.terpisah && F.guard.jaga > 0 && F.guard.jaga === F.guard.pekerja && g.total() === 0,
      F.guard.jaga === F.guard.pekerja ? 'per realm, and the page cannot see across' : 'E_JAGA_TIADA',
      /per realm/, 'each worker realm carried its own counter object and the page\'s stayed at zero');

    t.neg('and a squad that reported no egress reported it as a number, not as an absence');
    t.refusedWith(F.guard.lapor === F.guard.pekerja && F.guard.pekerja > 0,
      F.guard.lapor === F.guard.pekerja ? 'E_NONE' : 'E_LAPOR_TIADA',
      /E_NONE/, 'a missing key would have arrived as undefined and read as zero');
  });

  /* ============================ G11 =================================== */

  group('G11 fabrication, integers, and credential shapes', function (t) {
    var strings = reachableStrings(F);
    var numbers = numbersIn(F);
    var i, s, bad;

    t.prop('every identifier this lab writes into storage says it is fabricated');
    t.match(DB.AKUN, /FIKTIF/, 'the account');
    t.match(DB.SEWA, /FIKTIF/, 'the lease record');
    t.match(KUNCI.PEER, /FIKTIF/, 'the peer record');
    t.match(IDEM.KEY, /FIKTIF/, 'the webhook key');
    t.match(IDEM.buatKunci(7), /^IDEM-FIKTIF-0007$/, 'and every key the generator makes');

    /* Assembled from halves for the same reason sahih assembles its own: this
       repository has already had a push rejected over a fixture that merely
       looked like a key, and a scanner that spells out the thing it scans for
       is the one file in the tree that could make that scan lie about every
       other file. */
    var POLA = [
      new RegExp('BEGIN [A-Z ]*PRI' + 'VATE KEY'),
      new RegExp('(^|[^a-z])(pass' + 'word|se' + 'cret|api[_-]?k' + 'ey|bea' + 'rer)[=: ]', 'i'),
      new RegExp('ey[JI][0-9A-Za-z_-]{8,}\\.[0-9A-Za-z_-]{8,}\\.')
    ];
    t.prop('and nothing reachable on the fixture is shaped like a credential');
    for (i = 0; i < POLA.length; i++) {
      bad = [];
      for (s = 0; s < strings.length; s++) {
        if (POLA[i].test(strings[s].s)) bad.push(strings[s].path + ' ' + strings[s].s.slice(0, 40));
      }
      t.deep(bad, [], 'no reachable string matches pattern ' + (i + 1));
    }
    t.gt(strings.length, 100, 'over ' + strings.length + ' reachable strings');

    t.prop('every number this suite carries is finite, and every money figure is a whole rupiah');
    bad = [];
    for (i = 0; i < numbers.length; i++) if (!isFinite(numbers[i].v)) bad.push(numbers[i].path);
    t.deep(bad, [], 'nothing non-finite survived into the fixture');
    bad = [];
    for (i = 0; i < numbers.length; i++) {
      if (/amount|stored|derived|delta|saldo|total|token/i.test(numbers[i].path) && !KODE.bulat(numbers[i].v)) {
        bad.push(numbers[i].path + ' = ' + numbers[i].v);
      }
    }
    t.deep(bad, [], 'and every money-shaped figure is an integer');
    t.eq(IDEM.AMOUNT, 500, 'the webhook amount is an integer number of rupiah');

    t.prop('the refusal registry is closed, and every code this suite pins is in it');
    t.eq(KODE.CODES.length, 20, 'twenty codes');
    t.eq(KODE.terdaftar('E_HADANG_MATI'), true, 'a code this suite pins is registered');
    t.eq(KODE.terdaftar('E_SAKSI_KOSONG'), true, 'and so is the witness\'s');
    t.eq(KODE.terdaftar('E_NOT_A_CODE'), false, 'and one that is not, is not');

    t.prop('a refusal carries its code in its name, because the message does not survive the boundary');
    var e = KODE.refuse('E_MODE', 'a message that page.evaluate destroys');
    t.eq(e.name, 'E_MODE', 'the name is the code');
    t.eq(e.code, 'E_MODE', 'and so is the plain string field beside it');
    t.deep(KODE.wire(e), { name: 'E_MODE', code: 'E_MODE' }, 'and that is all that crosses postMessage');

    t.neg('money that is not a whole number of rupiah is refused, in every shape');
    t.throwsWith(function () { return KODE.rupiah(1.5, 'a float'); }, /E_BUKAN_BULAT/, 'a float');
    t.throwsWith(function () { return KODE.rupiah(NaN, 'a NaN'); }, /E_BUKAN_BULAT/, 'a NaN');
    t.throwsWith(function () { return KODE.rupiah(1 / 0, 'an infinity'); }, /E_BUKAN_BULAT/, 'an infinity');
    t.throwsWith(function () { return KODE.rupiah(null, 'a null'); }, /E_BUKAN_BULAT/, 'a null');

    t.neg('and a sum containing one is refused rather than rounded');
    t.throwsWith(function () { return KODE.jumlah([1, 2, 0.5], 'a fractional row'); }, /E_BUKAN_BULAT/, 'a fractional member');
    t.throwsWith(function () { return KODE.jumlah('12', 'a string'); }, /E_BUKAN_BULAT/, 'a list that is not one');

    t.neg('an unregistered refusal code is itself refused');
    var asing = KODE.refuse('E_TIDAK_ADA', 'a code nobody registered');
    t.refusedWith(asing.name === 'E_KODE_TIDAK_TERDAFTAR', asing.name, /E_KODE_TIDAK_TERDAFTAR/,
      'the registry is closed');
    t.refusedWith(asing.asked === 'E_TIDAK_ADA', asing.asked, /E_TIDAK_ADA/,
      'and it remembers what it was asked for');

    t.neg('a code that is not a string is not in the registry either');
    t.refusedWith(KODE.terdaftar(null) === false, 'E_NONE', /E_NONE/, 'a null');
    t.refusedWith(KODE.terdaftar({}) === false, 'E_NONE', /E_NONE/, 'an object');
  });

  /* ============================ G12 =================================== */

  /* Two write shapes transcribed from this repository, with file and line, run
     through the same harness. Not imported — transcribed, and quoted, because
     importing them would make this a test of two other labs. */
  group('G12 two shapes this repository already ships', function (t) {
    var g2 = F.kunci.gudang2, g4 = F.kunci.gudang4;
    var s2 = F.kunci.saku2, s4 = F.kunci.saku4;
    var i;

    /* Its comment is correct, and this is the first time it has been measured
       anywhere in this repository. */
    t.prop('the lock record read and written inside one transaction admits exactly one holder');
    t.eq(g2.winners, 1, 'two contenders arriving together, one winner');
    t.eq(g4.winners, 1, 'four contenders arriving together, still one winner');
    t.eq(g2.token, 1, 'and the fencing token advanced once');
    t.eq(g4.token, 1, 'in both configurations');

    t.prop('and every loser was told why it lost');
    for (i = 0; i < g4.hasil.length; i++) {
      if (g4.hasil[i].ok) continue;
      t.eq(g4.hasil[i].why, 'held', 'writer ' + g4.hasil[i].w + ' was told the lease was held');
    }
    t.eq(g4.hasil.length, 4, 'four results for four contenders');

    /* drain() applies operations through a strictly sequential reduce, so
       within one drain these calls never overlap. Two overlapping drains would
       reach it. This reproduces the shape and shows what it costs; it does not
       claim that lab loses data today, and no live path that does was found. */
    t.prop('a check in one transaction and the write in a later one absorbs nothing');
    t.eq(s2.applied, 2, 'two arrivals, two applications, where one was intended');
    t.eq(s4.applied, 4, 'four arrivals, four applications');
    t.eq(s2.absorbed, 0, 'nothing was absorbed at two');
    t.eq(s4.absorbed, 0, 'nor at four');
    t.eq(s2.intended, 1, 'and one was intended in both');

    t.prop('both shapes are quoted with the file and line they were transcribed from');
    t.eq(KUNCI.KUTIPAN.gudang.file, 'labs/gudang/store.js', 'the lock record');
    t.eq(KUNCI.KUTIPAN.gudang.line, '135-139', 'at its line');
    t.eq(KUNCI.KUTIPAN.saku.file, 'labs/saku/sync.js', 'the replay window');
    t.eq(KUNCI.KUTIPAN.saku.line, '47', 'at its line');
    t.gt(KUNCI.KUTIPAN.gudang.text.length, 100, 'and the quote is carried in full');

    t.prop('the printed shape is the live function, because there is no build step in this repository');
    t.match(KUNCI.sumberAudit('gudang'), /readwrite/, 'the lease shape opens one readwrite transaction');
    t.match(KUNCI.sumberAudit('saku'), /readonly/, 'and the replay shape reads in a readonly one first');

    t.prop('the lease comparison runs both of its columns');
    t.eq(F.kunci.sewa.pertama.why, 'free', 'the first agent took a lease nobody held');
    t.eq(F.kunci.sewa.pertama.token, 1, 'with the first token');
    t.eq(F.kunci.sewa.kedua.why, 'lapsed', 'the second took it once it had lapsed');
    t.eq(F.kunci.sewa.kedua.token, 2, 'with the next one');
    t.eq(F.kunci.sewa.ok, true, 'and the fixture agrees with both');

    /* A lease that lapses under a holder who is frozen but alive leaves two
       parties both believing they hold it. The token is what lets the resource
       tell them apart, and gudang has none. */
    t.neg('a write carrying a superseded lease token is refused');
    t.refusedWith(F.kunci.sewa.basi === 'E_SEWA_KEDALUWARSA', F.kunci.sewa.basi,
      /E_SEWA_KEDALUWARSA/, 'the first holder is still believing, and is refused');
    t.throwsWith(function () { return KUNCI.pagar(1, 2); }, /E_SEWA_KEDALUWARSA/, 'a stale token');
    t.throwsWith(function () { return KUNCI.pagar(1.5, 1); }, /E_BUKAN_BULAT/, 'a token that is not an integer');

    t.neg('the lease refuses a clock reading where it wants an ordering number');
    t.throwsWith(function () { return KUNCI.sewaAmbil(null, 'AGEN-FIKTIF-A', Date.now()); },
      /E_URUT_JAM/, 'nothing in this lab reads a clock, including this');

    t.neg('and a shape this lab has not transcribed cannot be printed');
    t.throwsWith(function () { return KUNCI.sumberAudit('nope'); }, /E_MODE/, 'an unknown audit shape');
  });

  /* ============================== the runner ============================ */

  /* G0 needs the results array while the run is still in flight, and a group
     receives only its own context, so the array lives out here. */
  var RESULTS = [];
  /* Read defensively, the way every other file in this lab reads the numbers
     object, so that requiring this file under node with nothing else loaded
     does not throw at load time. G0 asserts the two agree, so a drift between
     the fallback and the numbers file is a red property and not a silent
     divergence. */
  var WATCHDOG = (KODE && KODE.ANGKA ? KODE.ANGKA.watchdog : 90000);
  var NOISE = 0;

  /* Assembling the result is a function rather than a tail, because G0 asserts
     over the object that will actually cross page.evaluate and the only honest
     way to do that is to build it with the same code. It is called twice: once
     inside G0, where it is a draft that differs from the final one only by the
     rows G0 is still pushing, and once at the end. */
  function hasil() {
    var byGroup = [], index = {}, i, b;
    for (i = 0; i < groups.length; i++) {
      index[groups[i].name] = byGroup.length;
      byGroup.push({ group: groups[i].name, properties: 0, negatives: 0, executions: 0, passed: 0, failed: 0 });
    }
    var negatives = 0, passed = 0;
    for (i = 0; i < props.length; i++) {
      if (props[i].negative) negatives++;
      b = byGroup[index[props[i].group]];
      if (!b) continue;
      b.properties++;
      if (props[i].negative) b.negatives++;
    }
    for (i = 0; i < RESULTS.length; i++) {
      if (RESULTS[i].ok) passed++;
      b = byGroup[index[RESULTS[i].group]];
      if (!b) continue;
      b.executions++;
      if (RESULTS[i].ok) b.passed++; else b.failed++;
    }
    return {
      results: RESULTS,
      passed: passed,
      failed: RESULTS.length - passed,
      total: RESULTS.length,
      properties: props.length,
      executions: RESULTS.length,
      negatives: negatives,
      groups: groups.length,
      byGroup: byGroup,
      /* A positive count here means this page attempted egress, which is a
         defect in its own right and shows up as one failing test rather than as
         a CI job that failed with every assertion green. It is the page realm's
         counter PLUS every worker's own reported total, because a meta CSP does
         not reach a worker realm and the page's counter cannot see across one.
         A single attempt from a worker would be counted twice — once where the
         attempt was folded in and once in the worker's own total — and that is
         the safe direction to be wrong in. */
      noise: NOISE,
      /* Always zero, and deliberately so: this file is forbidden from reading a
         clock, because a suite that pinned a duration would go red on somebody
         else's laptop for a reason that has nothing to do with this code.
         app.js times the call from the outside, where the figure is a display
         and not an assertion. */
      ms: 0
    };
  }

  /* The watchdog's result. It RESOLVES rather than rejecting: a rejection would
     reach out.results.filter(...) outside the runner's own try/catch and exit
     the job with a bare stack and no lab attribution. Its recorded failure says
     "budget", never a correctness claim, because a slow machine is not a wrong
     answer. */
  function kosongkan(why) {
    var out = {
      results: [{ group: 'G0 the suite audits itself', name: 'the suite finished inside its time budget', ok: false, message: String(why) }],
      passed: 0, failed: 1, total: 1,
      properties: 1, executions: 1, negatives: 0,
      groups: groups.length, byGroup: [],
      noise: 0, ms: 0
    };
    return out;
  }

  function penjagaWaktu(ms) {
    return new Promise(function (resolve) {
      root.setTimeout(function () {
        resolve(kosongkan('the suite exceeded its time budget of ' + ms + ' ms'));
      }, ms);
    });
  }

  /* The single-flight latch, factored out so G0 can drive it on a throwaway box
     rather than by calling run() twice and hoping. Measured before it existed:
     two runs on one page, sharing one database name, and the second one's
     deleteDatabase fired onversionchange on the first one's connection, which
     closed itself, and the first one's next transaction died sixty-six writes
     into four hundred — as a rejection under this lab's own db.js, and as a
     bare page error under code that does not settle its transactions. Either
     way, one caller gets an answer that is not about its own run. */
  function gerbang(box, mk) {
    if (box.p) return box.p;
    var t = null;
    try { t = mk(); } catch (e) { return Promise.reject(e); }
    box.p = t;
    return box.p;
  }

  /* ============================ the pre-pass ============================ */

  /* Everything asynchronous in this lab settles here, in order, before the
     first group opens. What the groups see is a plain data structure. */

  function tangkap(p, slot) {
    return p.then(function (v) { slot.ditolak = false; slot.nama = ''; slot.nilai = v; return null; },
      function (e) { slot.ditolak = true; slot.nama = String(KODE.nameOf(e)); return null; });
  }

  /* A rendezvous for the audit fixtures, built out of promise plumbing and
     nothing else: no timer, no jitter, no repetition until it fails. Every
     participant arrives, and none proceeds until all W of them have. */
  function hadangan(W) {
    var tiba = 0, buka = null;
    var pintu = new Promise(function (r) { buka = r; });
    return function () {
      tiba++;
      if (tiba >= W) buka(null);
      return pintu;
    };
  }

  function bikinDb(nama) {
    return DB.fresh(nama).then(function (db) {
      return DB.seed(db).then(function () { return db; });
    });
  }

  function tutupHapus(db, nama) {
    /* Every exit path closes before deleting. deleteDatabase behind an open
       connection does not fail — onblocked fires and onsuccess never does, and
       page.evaluate has no timeout of its own, so the only ceiling would be the
       job's own fifteen minutes with no diagnostic. */
    try { db.close(); } catch (e) { /* already closed */ }
    return DB.drop(nama, KODE.ANGKA.deleteBudget)['catch'](function () { return null; });
  }

  function probeGuard() {
    var g = root.SEROBOT_GUARD;
    var out = { mulai: 0, satu: 0, tiga: 0, log: 0, asal: '', target: '', tak: 0, takKunci: false, kembali: 0, logKembali: 0, terpisah: true };
    if (!g) return out;
    out.mulai = g.total();
    /* NO REQUEST IS MADE HERE. The target says so, and the runner's own network
       listener is what proves it independently of anything this file claims. */
    g.noteExternal('fetch', 'FIKTIF-no-request-was-made', 'worker');
    out.satu = g.total();
    g.noteExternal('xhr', 'FIKTIF-no-request-was-made', 'worker');
    g.noteExternal('websocket', 'FIKTIF-no-request-was-made', 'worker');
    out.tiga = g.total();
    out.log = g.log.length;
    out.asal = String(g.log[0] && g.log[0].asal);
    out.target = String(g.log[0] && g.log[0].target);
    g.noteExternal('kind-this-guard-never-heard-of', 'FIKTIF-no-request-was-made', 'worker');
    out.tak = g.total();
    out.takKunci = Object.prototype.hasOwnProperty.call(g.counts, 'kind-this-guard-never-heard-of');
    /* Put it back, exactly, and delete the counter the unknown kind created.
       This is the only write to the live counter anywhere in this lab. */
    g.counts.fetch = 0; g.counts.xhr = 0; g.counts.websocket = 0;
    try { delete g.counts['kind-this-guard-never-heard-of']; } catch (e) { g.counts['kind-this-guard-never-heard-of'] = 0; }
    g.log.length = 0;
    out.kembali = g.total();
    out.logKembali = g.log.length;
    return out;
  }

  function asli(fn) {
    /* "Not the function the browser shipped." The wrap is what the header badge
       counts with, so an unwrapped entry point is a badge that reports zero
       because it is reading nothing. */
    try { return String(fn).indexOf('[native code]') >= 0; } catch (e) { return false; }
  }

  function bangun() {
    var runId = DB.runId();
    var namaCentre = DB.nameFor(runId);
    var namaBebas = DB.nameFor(runId + '-b');
    var namaProbe = DB.nameFor(runId + '-p');
    var namaAudit = DB.nameFor(runId + '-a');
    var prefix = DB.lockPrefix(runId);
    /* The raw core count comes off the capability probe rather than off
       navigator, so this file reads no platform object of its own — and no
       assertion anywhere in this suite reads the raw value at all. Only the
       clamp is asserted. */
    var m = PANTAU.mesin();
    var hc = KODE.bulat(m.hardwareConcurrency) && m.hardwareConcurrency > 0 ? m.hardwareConcurrency : 1;
    var W = ARMS.clamp(hc);
    var n = KODE.ANGKA.barrierN[String(W)] || KODE.ANGKA.barrierN['4'];

    KUNCI.pakaiAwalan(prefix);

    var f = {
      runId: String(runId), lockPrefix: String(prefix), clampW: W, hc: hc,
      mesin: m, atomik: PANTAU.atomik(),
      guard: { probe: probeGuard(), fetchNative: false, xhrNative: false, wsNative: false, terpisah: true, total: 0, pekerja: 0, jaga: 0, lapor: 0 },
      utas: { baris: [], kecil: null, langkah: '', casCap: {}, modeAsing: {} },
      batas: {}, batasAsing: {}, urut: {}, urutAsing: {},
      idem: { mode: {}, pasangan: null, jendelaKecil: null, jendelaBesar: null, modeAsing: {} },
      jurnal: { ganda: {}, gandaId: {} },
      lengan: { kunciLiteral: {}, beda: {}, sumberPanjang: 0, noTimer: null, noTimerTanam: null },
      pusat: { hadang: null, bebas: null, mati: {} },
      kunci: { p: {}, asing: {}, pekerja: null, sewa: null, gudang2: null, gudang4: null, saku2: null, saku4: null },
      saksi: { before: null, handle: null, indeks: {} }
    };

    f.guard.fetchNative = asli(root.fetch);
    try { f.guard.xhrNative = asli(root.XMLHttpRequest.prototype.open); } catch (e) { f.guard.xhrNative = false; }
    f.guard.wsNative = asli(root.WebSocket);

    /* The arms, read off the live functions. Route A for the page's "identical
       traffic, one differing key" claim is prose; this is route B, and it is a
       structure rather than a sentence. */
    var akunKeys = ['K-pisah', 'K-satu', 'K-kunci', 'K-batas'];
    ARMS.NAMES.forEach(function (arm) {
      var src = ARMS.source(arm), punya = [];
      akunKeys.forEach(function (k) { if (src.indexOf("'" + k + "'") >= 0) punya.push(k); });
      f.lengan.kunciLiteral[arm] = punya;
    });
    f.lengan.beda = {
      pisahSatu: KODE.lineDiffTrim(ARMS.source('pisah'), ARMS.source('satu')).length,
      pisahKunci: KODE.lineDiffTrim(ARMS.source('pisah'), ARMS.source('kunci')).length,
      sama: KODE.lineDiffTrim(ARMS.source('satu'), ARMS.source('satu')).length
    };
    f.lengan.sumberPanjang = ARMS.sourceAll().length;
    f.lengan.noTimer = ARMS.assertNoTimer();
    /* The planted body. It exists to be read as a string and is never called,
       and its needle is assembled so the grep over arms.js keeps meaning what
       it is printed to mean. */
    f.lengan.noTimerTanam = ARMS.assertNoTimer(function tanam(cb) {
      /* Written out in full ON PURPOSE. The needle has to be contiguous in
         this function's own text or the audit has nothing to find, which is
         the mistake that made this fixture pass while proving nothing. The
         grep in the independence table is over arms.js, not over this file. */
      return setTimeout(cb, 25);
    });

    var chain = Promise.resolve(null);

    /* ---- the single thread, five strategies, one execution per plan row */
    UTAS.RENCANA.forEach(function (row) {
      chain = chain.then(function () {
        return UTAS.run(row.strategy, row.W, row.n, {}).then(function (res) {
          f.utas.baris.push({ rencana: row, res: res, audit: UTAS.audit(res) });
          if (row.strategy === 'polos' && row.W === 2 && row.n === 1) {
            f.utas.kecil = res;
            f.utas.langkah = UTAS.tulis(res, 12);
          }
          return null;
        });
      });
    });

    /* A conflict source that always reports a conflict. Deterministic, no race:
       the cap is proved to fire rather than waited for. */
    chain = chain.then(function () {
      var tik = 0;
      return tangkap(UTAS.run('cas', 2, 2, {
        cap: 1, versi: function () { tik = tik + 1; return tik; }
      }), f.utas.casCap);
    });
    chain = chain.then(function () { return tangkap(UTAS.run('bukan-strategi', 2, 2, {}), f.utas.modeAsing); });

    /* ---- the probe database: the transaction boundary and the orderings */
    chain = chain.then(function () { return bikinDb(namaProbe); }).then(function (db) {
      var c = Promise.resolve(null);
      DB.WAITS.forEach(function (kind) {
        c = c.then(function () {
          return DB.batasTx(db, kind).then(function (r) { f.batas[kind] = r; return null; });
        });
      });
      c = c.then(function () { return tangkap(DB.batasTx(db, 'bukan-penantian'), f.batasAsing); });
      DB.URUT.forEach(function (kind) {
        c = c.then(function () {
          return DB.urutTx(db, kind).then(function (r) { f.urut[kind] = r; return null; });
        });
      });
      c = c.then(function () { return tangkap(DB.urutTx(db, 'bukan-urutan'), f.urutAsing); });
      /* The duplicate journal key, on the probe database so the centrepiece's
         own ledger is untouched by it. */
      c = c.then(function () { return DB.append(db, 'J-FIKTIF-a', 'IDEM-FIKTIF-9001', 1); });
      c = c.then(function () {
        return tangkap(DB.append(db, 'J-FIKTIF-b', 'IDEM-FIKTIF-9001', 1), f.jurnal.ganda);
      });
      /* The same row id again, under a KEY THAT IS FREE, so the only thing
         that can refuse it is add() itself. */
      c = c.then(function () {
        return tangkap(DB.append(db, 'J-FIKTIF-a', 'IDEM-FIKTIF-9002', 9), f.jurnal.gandaId);
      });
      c = c.then(function () {
        return DB.rowsVia(db, 'jurnal', 'objectStore', null).then(function (env) {
          var i, sama = 0, delta = 0;
          for (i = 0; i < env.rows.length; i++) {
            if (env.rows[i].id === 'J-FIKTIF-a') { sama++; delta = env.rows[i].delta; }
          }
          f.jurnal.gandaId.baris = sama;
          f.jurnal.gandaId.delta = delta;
          return null;
        });
      });
      c = c.then(function () { return IDEM.pasangan(db).then(function (r) { f.idem.pasangan = r; return null; }); });
      return c.then(function () { return tutupHapus(db, namaProbe); });
    });

    /* ---- the replay window, pure, no storage */
    chain = chain.then(function () {
      f.idem.jendelaKecil = IDEM.jendela(3, ['IDEM-FIKTIF-000A', 'IDEM-FIKTIF-000B', 'IDEM-FIKTIF-000C', 'IDEM-FIKTIF-000D', 'IDEM-FIKTIF-000A']);
      f.idem.jendelaBesar = IDEM.jendela(50, ['IDEM-FIKTIF-000A', 'IDEM-FIKTIF-000A']);
      return null;
    });

    /* ---- exactly once: a fresh database per mode, because they share stores
       and a mode that has already credited the account is a mode measuring
       somebody else's arithmetic. */
    IDEM.MODES.forEach(function (mode, i) {
      var nama = DB.nameFor(runId + '-i' + i);
      chain = chain.then(function () { return bikinDb(nama); }).then(function (db) {
        /* No hold is injected. idem.js resolves the lock helper itself and
           reports holdKind 'kunci', which is what makes the panel's sentence
           "with a real Web Lock around the write" true through the lab's own
           route rather than through one this file supplied. */
        return IDEM.run(db, mode, {}).then(function (r) {
          f.idem.mode[mode] = r;
          return tutupHapus(db, nama);
        }, function (e) {
          f.idem.mode[mode] = { why: String(KODE.nameOf(e)) };
          return tutupHapus(db, nama);
        });
      });
    });
    chain = chain.then(function () { return tangkap(IDEM.run(null, 'bukan-mode', {}), f.idem.modeAsing); });

    /* ---- the centrepiece, with the rendezvous */
    chain = chain.then(function () { return bikinDb(namaCentre); }).then(function (db) {
      var before = null, sesudah = null;
      return DB.snapshot(db).then(function (s) {
        before = s;
        f.saksi.before = s;
        return PANTAU.regu({
          url: 'kerja.worker.js', W: W, n: n, arms: ['pisah', 'satu', 'jurnal', 'kunci'],
          mode: 'hadang', db: namaCentre, lockPrefix: prefix, runId: runId,
          budget: 30000, timer: function (cb, ms) { return root.setTimeout(cb, ms); },
          untimer: function (id) { return root.clearTimeout(id); }
        });
      }).then(function (res) {
        sesudah = res;
        /* Route B. The reader is injected; this file never hands the witness a
           database, a transaction, a lock, a worker or a port, and the witness
           could not open one if it wanted to. */
        return SAKSI.fold(DB.reader(db), before, res.W, res.n, ['led_n', 'led_u']);
      }).then(function (v) {
        /* Route A. Every figure below came off db.js, which is the engine's own
           reader, and none of it came out of the workers' summary message. */
        return DB.rowsVia(db, 'jurnal', 'objectStore', null).then(function (env) {
          var deltas = [], i;
          for (i = 0; i < env.rows.length; i++) deltas.push(env.rows[i].delta);
          var mesin = { expected: sesudah.W * sesudah.n };
          mesin['jurnal.rows'] = env.count;
          mesin['jurnal.total'] = KODE.jumlah(deltas, 'the engine\'s own fold over the ledger');
          return DB.read(db, 'akun', 'K-pisah').then(function (a) {
            mesin['K-pisah'] = a === null ? 0 : a;
            mesin['delta.K-pisah'] = mesin['K-pisah'] - (before.akun['K-pisah'] | 0);
            mesin['kurang.K-pisah'] = mesin.expected - mesin['delta.K-pisah'];
            return DB.read(db, 'akun', 'K-satu');
          }).then(function (b) {
            mesin['K-satu'] = b === null ? 0 : b;
            return DB.read(db, 'akun', 'K-kunci');
          }).then(function (c) {
            mesin['K-kunci'] = c === null ? 0 : c;
            f.pusat.hadang = { res: sesudah, verdict: v, banding: SAKSI.banding(mesin, v), mesin: mesin, before: before };
            f.saksi.handle = db;
            return null;
          });
        });
      }).then(function () {
        /* The planted wrong reader. An index-backed read with a range sees a
           subset of the rows and folds cleanly over it, and a clean fold over a
           subset is a green panel over missing money. */
        /* The planted reader is pointed at the ONE store in the snapshot that
           has the index it reaches for. Aimed at a store that has no such
           index it is refused by the browser first, which proves nothing about
           the witness. */
        return tangkap(SAKSI.fold(DB.readerIndex(db), { jurnal: before.jurnal }, W, n), f.saksi.indeks);
      }).then(function () {
        return tutupHapus(db, namaCentre);
      });
    });

    /* ---- the centrepiece, free. Structural assertions only. */
    chain = chain.then(function () { return bikinDb(namaBebas); }).then(function (db) {
      var before = null;
      return DB.snapshot(db).then(function (s) {
        before = s;
        return PANTAU.regu({
          url: 'kerja.worker.js', W: hc, n: KODE.ANGKA.freeN, arms: ['pisah', 'satu', 'jurnal'],
          mode: 'lepas', db: namaBebas, lockPrefix: prefix, runId: runId,
          budget: 30000, timer: function (cb, ms) { return root.setTimeout(cb, ms); },
          untimer: function (id) { return root.clearTimeout(id); }
        });
      }).then(function (res) {
        /* seal() is the only constructor of a free-mode container, and it is
           applied by the engine and never by the caller. Everything downstream
           of this line is refused as an assertion operand. */
        ARMS.seal('lepas', res);
        return SAKSI.fold(DB.reader(db), before, res.W, res.n, ['led_n', 'led_u']).then(function (v) {
          f.pusat.bebas = { res: res, verdict: v, before: before };
          return null;
        });
      }).then(function () { return tutupHapus(db, namaBebas); });
    });

    /* ---- the barrier's own deadline, on an injected timer with a budget of
       one millisecond, so the refusal is proved without waiting five seconds
       for it. The assertion is over the CODE PATH; the duration is a fixture
       parameter and is asserted nowhere. */
    chain = chain.then(function () {
      var c = ARMS.ctx({
        mode: 'hadang', w: 1, post: function () { }, budget: 1,
        timer: function (cb, ms) { return root.setTimeout(cb, ms); },
        untimer: function (id) { return root.clearTimeout(id); }
      });
      return tangkap(c.barrier('pisah', 1, 'baca'), f.pusat.mati);
    });

    /* ---- the queue. Twelve of the thirteen behaviours; the unbounded
       self-deadlock is an on-screen observation and not an assertion, and
       running it here would cost three seconds to watch nothing happen. */
    KUNCI.PERILAKU.forEach(function (name) {
      if (name === 'buntu') return;
      chain = chain.then(function () {
        return KUNCI.perilaku(name).then(function (r) { f.kunci.p[name] = r; return null; },
          function (e) { f.kunci.p[name] = { gagal: String(KODE.nameOf(e)) }; return null; });
      });
    });
    chain = chain.then(function () { return tangkap(KUNCI.perilaku('bukan-perilaku'), f.kunci.asing); });
    chain = chain.then(function () {
      return PANTAU.antreanPekerja({
        url: 'kerja.worker.js', name: 'antre', lockPrefix: prefix,
        budget: KODE.ANGKA.lockDeadline, step: 25
      }).then(function (r) { f.kunci.pekerja = r; return null; });
    });

    /* ---- the two shapes this repository already ships. Re-seeded between
       runs: a lease that is already held is the thing being demonstrated, so
       these fixtures are deliberately not idempotent. */
    chain = chain.then(function () { return bikinDb(namaAudit); }).then(function (db) {
      return KUNCI.auditGudang(db, 2, { now: 1, barrier: hadangan(2) }).then(function (r) {
        f.kunci.gudang2 = r;
        return DB.seed(db);
      }).then(function () {
        return KUNCI.auditGudang(db, 4, { now: 1, barrier: hadangan(4) });
      }).then(function (r) {
        f.kunci.gudang4 = r;
        return DB.seed(db);
      }).then(function () {
        return KUNCI.sewaDemo(db, 1);
      }).then(function (r) {
        f.kunci.sewa = r;
        return KUNCI.auditSaku(db, 2, { barrier: hadangan(2), idem: 'IDEM-FIKTIF-0002' });
      }).then(function (r) {
        f.kunci.saku2 = r;
        return KUNCI.auditSaku(db, 4, { barrier: hadangan(4), idem: 'IDEM-FIKTIF-0003' });
      }).then(function (r) {
        f.kunci.saku4 = r;
        return tutupHapus(db, namaAudit);
      });
    });

    return chain.then(function () {
      var g = root.SEROBOT_GUARD;
      f.guard.total = g ? g.total() : 0;
      NOISE = f.guard.total +
        ((f.pusat.hadang && f.pusat.hadang.res.egress) | 0) +
        ((f.pusat.bebas && f.pusat.bebas.res.egress) | 0);
      /* Three integers about the two squads, folded the same way the count is:
         how many workers ran, how many said their realm was wrapped, and how
         many sent a number at all. A shortfall in either of the last two is a
         realm nobody was counting. */
      f.guard.pekerja = ((f.pusat.hadang && f.pusat.hadang.res.spawned) | 0) +
        ((f.pusat.bebas && f.pusat.bebas.res.spawned) | 0);
      f.guard.jaga = ((f.pusat.hadang && f.pusat.hadang.res.jaga) | 0) +
        ((f.pusat.bebas && f.pusat.bebas.res.jaga) | 0);
      f.guard.lapor = ((f.pusat.hadang && f.pusat.hadang.res.lapor) | 0) +
        ((f.pusat.bebas && f.pusat.bebas.res.lapor) | 0);
      return f;
    });
  }

  function jalankan() {
    var results = [];
    RESULTS = results;
    props.length = 0;
    ASYNC_MISUSE = 0;
    LOMBA_TOUCHED = 0;

    var i;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      try { g.fn(makeCtx(results, g.name, props)); }
      catch (err) {
        results.push({
          group: g.name, name: 'group threw', ok: false,
          message: String(KODE.nameOf(err)) + ': ' + String(err && err.stack || err)
        });
      }
    }
    /* The last walk, over the object as it will actually be handed to
       page.evaluate — byGroup included, which no group ever saw — and over the
       whole registry, which no group could see while it was still growing. */
    var tail = makeCtx(results, 'G0 the suite audits itself', props);

    tail.prop('the assembled result object survives the structured clone end to end');
    tail.deep(unclonable(hasil()), [],
      'every value in the result is a string, a number, a boolean, null, a plain array or a plain object');

    /* The property doing the asking cannot have recorded yet, so it is the one
       row this walk skips. */
    tail.prop('every property this suite registered recorded at least one execution');
    var sepi = [];
    for (i = 0; i < props.length - 1; i++) {
      if (props[i].executions === 0) sepi.push(props[i].group + ' → ' + props[i].name);
    }
    tail.deep(sepi, [], 'a property that opened and never asserted is a claim nobody checked');

    /* "It was refused" and "it was refused for the reason I claimed" are
       different assertions. A lock refused for a bad mode, inside a test
       claiming an unbounded request, is a green assertion asserting the
       opposite of the truth. */
    var telanjang = [], negatif = 0, k;
    tail.neg('every negative property pinned a reason rather than settling for a refusal');
    for (i = 0; i < props.length; i++) {
      if (!props[i].negative) continue;
      negatif++;
      for (k in props[i].helpers) {
        if (!Object.prototype.hasOwnProperty.call(props[i].helpers, k)) continue;
        if (k !== 'throwsWith' && k !== 'refusedWith') telanjang.push(props[i].name + ' used ' + k);
      }
    }
    tail.refusedWith(telanjang.length === 0, telanjang.length === 0 ? 'E_NONE' : telanjang.join(' · '),
      /E_NONE/, negatif + ' negatives, every one through throwsWith or refusedWith');

    /* Registered last and counted again here, because this reads props.length:
       opened any earlier it compares a share against a total the badge has not
       finished growing, and the assertion then guards a different number from
       the one the page prints. */
    negatif = 0;
    tail.prop('a real share of this suite is negative — properties that pass only on a refusal');
    for (i = 0; i < props.length; i++) if (props[i].negative) negatif++;
    tail.gt(negatif, props.length / 4, negatif + ' of ' + props.length + ' properties are negative');
    tail.lt(negatif, props.length, 'and they are not all of it');

    return hasil();
  }

  var INFLIGHT = {};

  /* test/labs.test.js navigates with waitUntil:'load' and then evaluates this
     call, awaiting whatever it returns — while app.js has already started its
     own run to fill the badge in the header. The two overlap BY CONSTRUCTION,
     and two runs of this lab sharing one page destroy each other. The latch
     makes them one run, which also halves what CI pays for. */
  function run() {
    return gerbang(INFLIGHT, function () {
      var t = bangun().then(function (f) {
        /* The fixture is parked before the first group opens, and it is a
           VALUE: no getter, no closure that re-reads, nothing that could give
           two groups two different answers about one run. */
        F = f;
        return jalankan();
      })['catch'](function (e) {
        /* A refusal escaping the pre-pass is a hole in this file, not a
           finding about the lab, and it is reported as one failing property
           rather than as a rejection the runner reads outside its try/catch. */
        return kosongkan('the pre-pass was refused with ' + String(KODE.nameOf(e)));
      });
      return Promise.race([t, penjagaWaktu(WATCHDOG)]);
    });
  }

  root.SEROBOT_TESTS = { run: run, groups: groups, props: props };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SEROBOT_TESTS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
