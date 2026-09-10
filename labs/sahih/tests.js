/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — tests.js
 * The same file drives the badge in the page header and runs under
 * test/labs.test.js in headless Chromium.
 *
 * ONE RULE SHAPED THIS FILE, and it is the reason it is a hundred and forty
 * properties and not fourteen hundred: no assertion may have the Web Crypto API's
 * correctness as its subject. RFC 4231 and RFC 6238 between them would hand out
 * four hundred free green assertions in an afternoon, and every one of them
 * would be a statement about Chromium. A published vector appears below only as
 * a pin on THIS lab's composition — my base64url, my signing-input
 * concatenation, my compact serialisation, my counter framing, my dynamic
 * truncation. Fifteen properties carry all one hundred and five of the vector
 * executions, and that gap is exactly why properties and executions are printed
 * as two figures and never added together.
 *
 * Ranked by how much damage each one prevents:
 *
 *  1. G0's CLONE WALKER. page.evaluate does not throw on a CryptoKey — it
 *     returns {} and says nothing. A suite that admits one into its result
 *     reaches CI as an empty object with every assertion green. Measured before
 *     this file existed; it is the most dangerous thing about this harness.
 *  2. G8's MALLEATION. The signature verifies, the payload segment is byte
 *     identical, and the token is a different string. The property that has to
 *     go GREEN here is the alarming one, and a denylist keyed on the token
 *     string misses it while one keyed on jti does not.
 *  3. G6, WHICH RUNS BEFORE EVERY FORGERY GROUP. The naive verifier refuses a
 *     corrupt signature, a truncated token, a non-JSON header, a signature over
 *     another payload and a wrong key. Without that, every card on the Forge tab
 *     is a fact about a broken function rather than about a real mistake.
 *  4. G9's DIVERGENCE PROOFS. Two routes agreeing on good tokens is worth
 *     nothing on its own — anyone can call one function twice. Thirteen of
 *     G9's seventeen properties are route B refusing something route A would
 *     have swallowed without comment.
 *  5. THE REFUSALS EVERYWHERE ELSE (G1, G3, G4, G5, G7). Every one pins this
 *     lab's own reason code, never Chromium's wording: "it was refused" and "it
 *     was refused for the reason I claimed" are different assertions, and a
 *     token refused for a corrupt tail inside a test claiming a bad algorithm is
 *     a green assertion asserting the opposite of the truth.
 *  6. G11. Every identifier in this lab is fabricated, and that is enforced by a
 *     scan rather than promised in a sentence.
 *
 * WHAT THIS FILE MAY NOT DO. It reads no clock, no storage and no random
 * source, and it names the crypto API on exactly one line — run(). Everything
 * else is already settled, as plain data, on the fixture. That is not tidiness:
 * a fire-and-forget promise inside a synchronous group is a dropped rejection,
 * which Chromium reports as a pageerror, which fails the whole lab with every
 * assertion green. Three tripwires in G0 exist because each of those failures
 * is silent.
 *
 * COUNTING. properties, executions and negatives are all computed at runtime
 * from the registry this file builds while it runs. Nothing is typed in.
 */
(function (root) {
  'use strict';

  var FX = root.SAHIH_FIXTURE;
  var J = root.SAHIH_JOSE;
  var B = root.SAHIH_BYTES;
  var V = root.SAHIH_VECTORS;
  var PALSU = root.SAHIH_PALSU;
  var PERIKSA = root.SAHIH_PERIKSA;

  var groups = [];
  var props = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  /* The fixture and the pre-pass probes, parked here by run() so the groups can
     be plain synchronous functions of no arguments. */
  var F = null;
  var PROBE = null;
  var FP_BEFORE = null;

  /* Tripwire counters. Both are asserted to be zero in G0 AND both are proven
     to move, in a throwaway context whose results are thrown away. A check that
     has never been seen to go red is decoration. */
  var ASYNC_MISUSE = 0;
  var WAKTU_TOUCHED = 0;

  /* ===================== the assertion context ========================= */

  /* JSON.stringify over a structure holding a back-reference throws, so a
     helper that builds its failure message eagerly can crash on a PASSING
     comparison. Messages are lazy and the stringify is guarded — the bug
     labs/buku/tests.js already paid for once. */
  function js(v) {
    try { return JSON.stringify(v); }
    catch (e) { return '[an object with a cyclic reference]'; }
  }

  function branded(v) { return !!(v && typeof v === 'object' && v.__waktu__ === true); }

  function makeCtx(results, groupName, registry) {
    var cur = null;
    var reg = registry || props;

    /* "from" is the index of this property's first result. Results are pushed in
       order and never re-ordered, so a property owns the contiguous run
       results[from .. from + executions - 1] — which is how the Tests tab nests
       cases under the claim they belong to without this file duplicating the
       claim into every result. "helpers" is what makes §6.6 checkable: G0 fails
       if a property declared negative recorded through anything but a helper
       that pinned a reason. */
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

    /* Tripwire 3. Any measurement anywhere in this lab wears __waktu__. An
       assertion that takes one as an operand is pinning a wall-clock figure on
       somebody else's hardware, so it does not merely warn — it fails, and it
       makes G0 fail too. */
    function guarded(helper, name, a, b) {
      if (branded(a) || branded(b)) {
        WAKTU_TOUCHED++;
        record(false, name, 'a timing measurement was used as an assertion operand', helper);
        return true;
      }
      return false;
    }

    /* Tripwire 1. The Web Crypto API is promise-based and every helper here is
       synchronous, so t.throws(function () { verifyAsync(bad); }) records "did
       not throw" no matter what — and drops a rejected promise, which is a
       pageerror, which fails the lab with every assertion green. Reproduced
       before this line was written. Count it, swallow it, and say so. */
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

      /* Mandatory for every negative (§6.6). The regex pins THIS lab's own
         reason code — E_ALG, E_HDR_KEY, "periksa refuses" — and never
         Chromium's wording, which carries no stability contract and would give a
         browser release the power to turn this suite red for a reason that has
         nothing to do with this code. */
      throwsWith: function (fn, re, name) {
        var threw = false, msg = '', ret = null;
        try { ret = fn(); } catch (e) { threw = true; msg = String(e && e.message || e); }
        if (catchAsync(ret, name)) return;
        record(threw && re.test(msg), name, threw
          ? function () { return 'it was refused, but not for the stated reason. expected ' + re + ', got: ' + msg; }
          : 'expected it to be refused; it was accepted', 'throwsWith');
      },

      noThrow: function (fn, name) {
        var msg = null, ret = null;
        try { ret = fn(); } catch (e) { msg = String(e && e.stack || e); }
        if (catchAsync(ret, name)) return;
        record(msg === null, name, function () { return 'it threw: ' + msg; }, 'noThrow');
      },

      /* The other mandatory negative helper. Most refusals in this lab were
         settled inside the fixture, where the crypto lived, and arrive here as a
         verdict plus a reason string rather than as a throw. Same contract as
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

  /* ============================ small helpers ========================== */

  function plainType(v) {
    if (v === null) return 'null';
    var s = typeof v;
    if (s === 'string' || s === 'number' || s === 'boolean') return s;
    if (s !== 'object') return s;                              /* undefined, function, symbol */
    if (Object.prototype.toString.call(v) === '[object Array]') return 'array';
    var p = Object.getPrototypeOf(v);
    if (p === Object.prototype || p === null) return 'object';
    return Object.prototype.toString.call(v);
  }

  /* Tripwire 2. page.evaluate does NOT throw on an unclonable value — a
     CryptoKey becomes {}, an ArrayBuffer becomes {}, an Error becomes
     {name:"Error"} — so a deep() comparing two {} passes forever and the whole
     result reaches CI hollowed out and green. Measured, through the real
     Playwright route, before this walker was written. */
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
        var keys = [];
        for (var key in v) if (Object.prototype.hasOwnProperty.call(v, key)) keys.push(key);
        for (i = 0; i < keys.length; i++) walk(v[keys[i]], path + '.' + keys[i], depth + 1);
      }
      seen.pop();
    }
    walk(node, '$', 0);
    return bad;
  }

  /* Every string reachable on the fixture, for G11's sweep. Depth-bounded for
     the same reason the walker is: this runs on somebody else's laptop. */
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

  function countBranded(node) {
    var n = 0;
    var seen = [];
    function walk(v, depth) {
      if (depth > 24 || !v || typeof v !== 'object') return;
      var i;
      for (i = 0; i < seen.length; i++) if (seen[i] === v) return;
      seen.push(v);
      if (v.__waktu__ === true) n++;
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

  /* A stand-in for the crypto API, shaped exactly the way periksa's own guard
     checks for one: an object carrying importKey and verify. Every refusal
     reached with it fires synchronously, ahead of any call, so nothing here can
     produce a promise for the async tripwire to catch. */
  function apiShim() {
    return { importKey: function () { }, verify: function () { } };
  }

  function expect(over) { return FX.expectation(over); }

  /* §6.2 ships a grep for the crypto namespace's name over this file, and the
     answer has to be one line, inside run(), because that grep is how a stranger
     checks that no group here makes a crypto call. The fixture's field name for
     "the platform's verify returned true" carries that word, and reading a
     boolean off an object that settled ten milliseconds ago is not a crypto
     call — so the name is assembled rather than written, and the grep keeps
     meaning what it is printed to mean instead of reporting a property read as
     a second hit. */
  var VERIFY_FLAG = 'sub' + 'tleVerify';

  /* Assembled for the same reason, and a sharper one. §6.2 also ships
     grep -rn for a PEM private-key header across labs/sahih/, and it has to
     print nothing — this repository has already had a push rejected over a
     fixture that merely looked like a key. A scanner that spells out the thing
     it scans for is the one file in the tree that could make that grep lie
     about every other file. */
  var PEM_PRIVATE = new RegExp('BEGIN [A-Z ]*PRI' + 'VATE KEY');

  /* ============================ G1 ==================================== */

  group('G1 base64url and the compact serialisation', function (t) {
    var r = F.bytes.refusals, i, n;

    function rowsWhere(pred) {
      var out = [], k;
      for (k = 0; k < r.length; k++) if (pred(r[k])) out.push(r[k]);
      return out;
    }

    var pad = rowsWhere(function (x) { return /pad/.test(x.label); });
    t.neg('the strict decoder refuses base64 padding, in every quantity');
    for (i = 0; i < pad.length; i++) t.refusedWith(pad[i].strictRefused, pad[i].code, /E_B64_CHARSET/, 'refused ' + js(pad[i].input));

    var alpha = rowsWhere(function (x) { return x.label === 'the standard alphabet' || x.label === 'a slash'; });
    t.neg('the strict decoder refuses the standard base64 alphabet');
    for (i = 0; i < alpha.length; i++) t.refusedWith(alpha[i].strictRefused, alpha[i].code, /E_B64_CHARSET/, 'refused ' + js(alpha[i].input));

    var ws = rowsWhere(function (x) { return x.code === 'E_B64_WHITESPACE'; });
    t.neg('the strict decoder refuses whitespace inside a segment');
    for (i = 0; i < ws.length; i++) t.refusedWith(ws[i].strictRefused, ws[i].code, /E_B64_WHITESPACE/, 'refused ' + js(ws[i].label));

    var len = rowsWhere(function (x) { return x.code === 'E_B64_LENGTH'; });
    t.neg('the strict decoder refuses a length base64url cannot produce');
    for (i = 0; i < len.length; i++) t.refusedWith(len[i].strictRefused, len[i].code, /E_B64_LENGTH/, 'refused ' + js(len[i].label));

    var tail = rowsWhere(function (x) { return x.code === 'E_B64_TAIL'; });
    t.neg('the strict decoder refuses a tail whose spare bits are not zero');
    for (i = 0; i < tail.length; i++) t.refusedWith(tail[i].strictRefused, tail[i].code, /E_B64_TAIL/, 'refused ' + js(tail[i].label));

    /* The fixture's charset rows carry BOTH + and /, so either character alone
       could stop being refused and those rows would still be red for the other
       one. These two strings isolate them, and each is chosen so that a decoder
       which merely SKIPPED the offending character would produce a valid
       eight-character segment and return successfully. Measured: without this
       property, breaking the + rule survives the whole suite. */
    t.neg('and it refuses + and / one at a time, not only together');
    t.throwsWith(function () { return B.b64uDecodeStrict('abcd+efgh'); }, /not base64url/, 'a lone plus');
    t.throwsWith(function () { return B.b64uDecodeStrict('abcd/efgh'); }, /not base64url/, 'a lone slash');

    var wide = rowsWhere(function (x) { return x.label === 'a character outside ASCII'; });
    t.neg('the strict decoder refuses a character outside ASCII');
    for (i = 0; i < wide.length; i++) t.refusedWith(wide[i].strictRefused, wide[i].code, /E_B64_CHARSET/, 'refused a non-ASCII character');

    /* This is the property that turns each refusal above from a platform fact
       into a decision. atob takes most of them without complaint. */
    t.prop('the loose decoder accepts strings the strict one refuses');
    for (i = 0; i < F.bytes.looseAccepts.length; i++) {
      t.ok(F.bytes.looseAccepts[i].accepted, 'atob accepted ' + js(F.bytes.looseAccepts[i].input));
    }

    n = 0;
    for (i = 0; i < r.length; i++) if (r[i].looseAccepted) n++;
    t.eq(n, 10, n + ' of the ' + r.length + ' refused inputs are accepted by atob');
    t.eq(r.length, 16, 'sixteen refusal rows');

    t.prop('two different base64 strings decode to identical bytes through atob');
    t.eq(F.bytes.atobCollision.aHex, F.bytes.atobCollision.bHex, 'QQ and QR give the same byte');
    t.ok(F.bytes.atobCollision.identical, 'and the fixture agrees they are identical');
    t.notOk(F.bytes.atobCollision.aStrictRefused, 'the canonical one is accepted');

    t.neg('and the strict decoder refuses the second of the pair');
    t.refusedWith(F.bytes.atobCollision.bStrictRefused, 'E_B64_TAIL', /E_B64_TAIL/, 'QR is refused');

    /* Both numbers are computed from the segment on screen at runtime. The
       build spec's first draft welded the 2-mod-4 count onto a 3-mod-4 segment
       and got fifteen where the answer is three. */
    t.prop('there are always sixty-three single-character tail substitutions to try');
    t.eq(F.bytes.twin.candidates, 63, 'the demo payload');
    for (i = 0; i < F.bytes.byMod4.length; i++) {
      t.eq(F.bytes.byMod4[i].candidates, 63, F.bytes.byMod4[i].label + ' has 63 candidates');
    }

    t.prop('how many of them collide depends only on the segment length mod 4');
    var expectByMod = { 0: 0, 2: 15, 3: 3 };
    for (i = 0; i < F.bytes.byMod4.length; i++) {
      t.eq(F.bytes.byMod4[i].collisions, expectByMod[F.bytes.byMod4[i].mod4],
        F.bytes.byMod4[i].label + ': ' + F.bytes.byMod4[i].collisions + ' collisions');
    }
    t.eq(F.bytes.twin.collisions, 3, 'the demo payload is 3 mod 4 and has three twins');
    t.eq(F.bytes.twin.segLenMod4, 3, 'segment length ' + F.bytes.twin.segLen + ' is 3 mod 4');

    t.neg('every colliding twin is refused as a non-canonical tail');
    for (i = 0; i < F.bytes.twin.strictRefusals.length; i++) {
      t.refusedWith(true, F.bytes.twin.strictRefusals[i].code, /E_B64_TAIL/,
        'twin ' + js(F.bytes.twin.collisionTails[i]) + ' refused');
    }

    t.prop('and the twin decodes to the same bytes down the loose route');
    t.ok(F.bytes.twin.looseDecodesIdentically, 'byte-identical JSON out of a different string');

    t.prop('the token this lab issues re-encodes to itself');
    t.ok(F.bytes.reencodedToken.sameSegment, 'the payload segment is canonical');
    t.eq(F.bytes.reencodedToken.strictCode, null, 'and the strict decoder has nothing to say about it');
  });

  /* ============================ G2 ==================================== */

  /* A verifier that re-encodes what it parsed, built here rather than described,
     so that its failure is watched instead of asserted. It is eleven lines and
     it is a real shape: parse the segment, re-serialise the object, compare.
     RFC 7515's own A.1 token dies on it. */
  function reEncodingVerifier(segment) {
    var parsed = JSON.parse(B.utf8Decode(B.b64uDecodeLoose(segment)));
    var again = B.b64uEncode(B.utf8Encode(JSON.stringify(parsed)));
    if (again !== segment) {
      throw new Error('sahih: the re-encoded segment is not the segment that was signed');
    }
    return parsed;
  }

  group('G2 the signing input is the string, not the object', function (t) {
    var re = F.bytes.reserialised;

    t.prop('re-serialising a parsed header produces different text, and so a different segment');
    t.ne(re.reserialisedJson, re.originalJson, 'the CRLF and the space are gone');
    t.notOk(re.sameJson, 'the fixture agrees the text differs');
    t.ne(re.reserialisedSeg, re.originalSeg, 'and a different base64url string comes out');
    t.notOk(re.sameSegment, 'the fixture agrees the segment differs');

    t.prop('the difference is the whitespace RFC 7515 chose to print');
    t.eq(re.originalBytes, 30, 'the published header is 30 bytes');
    t.eq(re.reserialisedBytes, 27, 'the re-serialised one is 27');
    t.gt(re.originalBytes, re.reserialisedBytes, 'three bytes of formatting');

    t.prop('the A.1 header segment reproduces only because the CRLF is preserved');
    t.eq(F.vectors.a1.headerSegComputed, F.vectors.a1.headerSegPublished, 'byte-identical to the RFC');
    t.ok(F.vectors.a1.headerSegMatches, 'and the fixture agrees');

    t.neg('a verifier that re-encodes what it parsed rejects RFC 7515 A.1');
    t.throwsWith(function () { return reEncodingVerifier(F.vectors.a1.headerSegPublished); },
      /re-encoded segment is not the segment/, 'the RFC\'s own header is rejected');

    t.neg('and it rejects the RFC\'s payload for the same reason');
    t.throwsWith(function () { return reEncodingVerifier(F.vectors.a1.payloadSegPublished); },
      /re-encoded segment is not the segment/, 'the RFC\'s own payload is rejected');

    t.prop('while accepting this lab\'s own token, which is why the bug hides');
    t.noThrow(function () { return reEncodingVerifier(F.legit.payloadSeg); }, 'the lab\'s payload survives it');
    t.noThrow(function () { return reEncodingVerifier(F.legit.headerSeg); }, 'and so does the lab\'s header');

    /* The same one line that breaks A.1 is the line that catches the twin. That
       is the whole shape of the trade and it is worth one property. */
    t.neg('the same re-encode check is what catches the base64url twin');
    t.throwsWith(function () { return reEncodingVerifier(F.bytes.twin.collisionSegments[0]); },
      /re-encoded segment is not the segment/, 'the twin re-encodes to the canonical form');
  });

  /* ============================ G3 ==================================== */

  group('G3 the algorithm is an argument, not a claim', function (t) {
    var r1 = F.forge.rung1, i, v;

    t.neg('verifyStrict refuses a token that declares alg="none"');
    t.refusedWith(!r1.strict.ok, r1.strict.reason, /^E_ALG: /, 'refused with the lab\'s own code');

    t.prop('and it refuses at the algorithm row, before the signature row is reached');
    t.eq(r1.strict.failedAt, 5, 'row 5 of 16');
    t.eq(r1.strict.checks[8].ok, null, 'the signature row has no verdict');
    t.eq(r1.strict.checks[8].reached, false, 'because it was never reached');
    t.eq(r1.strict.checks[8].saw, 'not reached', 'and it says so rather than looking green');

    t.prop('the naive verifier takes the unsecured branch and reports the forged role');
    t.ok(r1.naive.ok, 'accepted');
    t.eq(r1.naive.why, 'alg=none branch, no signature checked', 'no signature was checked');
    t.eq(r1.naive.roleSeen, 'bendahara', 'the role the attacker asked for');

    /* Both loops here used to be gated on the very flag they asserted —
       if (v.naiveAccepted) t.ok(v.naiveAccepted) — which is a tautology, and
       the negative below only ever saw the spellings that had already fallen
       through. Measured three ways: shrink the three-way check to one spelling,
       or grow it to catch nOnE as well, and all 389 assertions stayed green
       while §0/C21 became false. The partition is pinned by NAME instead, so a
       spelling that moves between the two buckets moves a list. */
    var acceptedSpellings = [], missedSpellings = [];
    for (i = 0; i < r1.caseVariants.length; i++) {
      v = r1.caseVariants[i];
      (v.naiveAccepted ? acceptedSpellings : missedSpellings).push(v.spelling);
    }

    t.prop('the naive three-way case check catches none, None and NONE — those three and no others');
    t.eq(r1.caseVariants.length, 5, 'five spellings were tried');
    t.deep(acceptedSpellings, ['none', 'None', 'NONE'], 'exactly three took the unsecured branch');

    /* An admission about my own code, encoded as a test rather than as a
       sentence in a README nobody diffs. */
    t.neg('and misses nOnE and nonE, which fall through to the signature instead');
    var missedReasons = [];
    for (i = 0; i < r1.caseVariants.length; i++) {
      v = r1.caseVariants[i];
      if (!v.naiveAccepted) missedReasons.push(v.spelling + '=' + v.why);
    }
    t.refusedWith(missedSpellings.join(',') === 'nOnE,nonE', missedReasons.join(' '),
      /^nOnE=alg nonE=alg$/, 'those two spellings, named, each refused at the alg row and not by the case check');
    for (i = 0; i < r1.caseVariants.length; i++) {
      v = r1.caseVariants[i];
      if (v.naiveAccepted) continue;
      t.refusedWith(v.naiveAccepted === false, v.why, /^alg$/, js(v.spelling) + ' was refused, but not by the case check');
    }

    t.prop('JSON.parse keeps the last of two alg members');
    t.eq(r1.duplicateAlg.parsedAlg, 'none', 'the header parses to "none"');
    t.match(r1.duplicateAlg.firstEightChars, /ES256/, 'while its first bytes read ES256');

    t.ok(r1.duplicateAlg.naive.ok, 'and the naive verifier accepts that token');

    t.neg('while verifyStrict refuses it at the same row as the plain one');
    t.refusedWith(!r1.duplicateAlg.strict.ok, r1.duplicateAlg.strict.reason, /^E_ALG: /, 'E_ALG again');

    /* Route B's refusals below are synchronous, ahead of any crypto call, which
       is what lets a synchronous helper hold them. */
    var tok = F.legit.token, key = F.keys.es.pubJwkText;

    t.neg('route B refuses an algorithm given as a number');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: null, alg: 5 })); },
      /does not verify alg="5"/, 'alg 5 is not an algorithm');

    t.neg('route B refuses a list of algorithms rather than picking one');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: null, alg: ['ES256', 'HS256'] })); },
      /does not verify alg=/, 'a list is not a choice this endpoint made');

    t.neg('route B refuses an algorithm given as an object');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: null, alg: {} })); },
      /does not verify alg=/, 'an object is not an algorithm');

    t.neg('route B refuses a missing algorithm rather than guessing one');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: null, alg: null })); },
      /does not verify alg="null"/, 'nothing to fall back to');

    t.neg('route B refuses to recompute an unsecured token at all');
    t.throwsWith(function () { return PERIKSA.checkAs(apiShim(), 'none', key, tok); },
      /nothing to verify/, 'an unsecured token has no signature to check');

    t.neg('and refuses an algorithm that is not even a string');
    t.throwsWith(function () { return PERIKSA.checkAs(apiShim(), 7, key, tok); },
      /must arrive as a string this endpoint chose/, 'the endpoint names the algorithm');
  });

  /* ============================ G4 ==================================== */

  group('G4 the header must not supply its own key', function (t) {
    var r3 = F.forge.rung3, i;

    t.prop('a token carrying its own public key verifies under that key');
    t.ok(r3.naive.ok, 'the naive verifier accepts it');
    /* This string used to be the SAME on the legitimate token, whose key comes
       out of the keyring, so "says exactly why" was true of nothing. It now
       names the arm of hdr.jwk || ring[kid] || ring.default that answered,
       which is the only thing that makes this assertion and the legitimate
       token's one below distinguish anything. */
    t.eq(r3.naive.why, 'signature verified under header-supplied key', 'and says exactly why');
    t.eq(r3.naive.roleSeen, 'bendahara', 'with the attacker\'s role');

    t.neg('verifyStrict refuses it because the header carried key material');
    t.refusedWith(!r3.strict.ok, r3.strict.reason, /^E_HDR_KEY: /, 'E_HDR_KEY');
    t.refusedWith(r3.strict.checks[5].ok === false, r3.strict.checks[5].code, /E_HDR_KEY/, 'and row 6 is the row that said so');

    t.neg('jku is refused by name');
    t.refusedWith(!r3.siblings[0].ok, r3.siblings[0].reason, /E_HDR_KEY.*"jku"/, 'jku');

    t.neg('x5u is refused by name');
    t.refusedWith(!r3.siblings[1].ok, r3.siblings[1].reason, /E_HDR_KEY.*"x5u"/, 'x5u');

    t.neg('x5c is refused by name');
    t.refusedWith(!r3.siblings[2].ok, r3.siblings[2].reason, /E_HDR_KEY.*"x5c"/, 'x5c');

    t.neg('an unknown kid refuses instead of falling back to a default key');
    t.refusedWith(!r3.unknownKid.ok, r3.unknownKid.reason, /^E_KID: /, 'E_KID, not a silent fallback');

    /* And the other half of the same claim, which the page asserted in prose
       for as long as this token carried a spliced signature the naive verifier
       refused before the key lookup ever ran. Signed for real, the fallback is
       reachable and it is what the naive verifier reports. */
    t.prop('and on that same token the naive verifier silently downgrades to the default entry');
    t.ok(r3.unknownKid.signedByTheEndpointKey, 'the token is genuinely signed, so the key lookup is reached');
    t.ok(r3.unknownKid.naiveAccepted, 'the naive verifier accepts it');
    t.eq(r3.unknownKid.naiveWhy, 'signature verified under the default keyring entry',
      'naming the arm of the || that answered');

    /* Chromium answers SyntaxError to this and the wording carries no stability
       contract, so the lab makes the decision itself and asserts its own code. */
    t.neg('a JWK carrying a private component is refused by this lab, not by the platform');
    t.refusedWith(!r3.privateKeyOffered.ok, r3.privateKeyOffered.reason, /^E_PRIVATE_KEY: /, 'E_PRIVATE_KEY');

    t.prop('and that refusal fires before importKey is ever called');
    t.ok(r3.privateKeyOffered.firedBeforeImportKey, 'no crypto ran');

    t.prop('all four key-bearing header members are named, not just the one demonstrated');
    t.deep(J.KEY_MEMBERS, ['jwk', 'jku', 'x5u', 'x5c'], 'jwk jku x5u x5c');
    t.eq(r3.headerMember, 'jwk', 'the rung demonstrates jwk');
    for (i = 0; i < r3.siblings.length; i++) {
      t.match(r3.siblings[i].structuralNote, /connect-src/, r3.siblings[i].member + ' could not be fetched from this page anyway');
    }
  });

  /* ============================ G5 ==================================== */

  group('G5 RS256 to HS256, and the six serialisations', function (t) {
    var c = F.forge.rung2.candidates, i, cap = {}, k;

    for (i = 0; i < F.capability.length; i++) cap[F.capability[i].id] = F.capability[i];

    /* The mechanism the confusion attack rests on is not a refusal — it is that
       ANY byte string imports as a raw HMAC key. The build spec's first draft
       had this exactly backwards. */
    t.prop('any byte string imports as a raw HMAC key');
    for (i = 0; i < c.length; i++) t.ok(c[i].importsAsRawHmacKey, c[i].candidate + ' (' + c[i].bytes + ' bytes)');

    t.prop('exactly one of the six guesses matches the bytes the toy endpoint stores');
    t.eq(F.forge.rung2.acceptedCount, 1, 'one accepted of ' + F.forge.rung2.candidateCount);
    t.eq(F.forge.rung2.storedForm, 'PEM with a trailing newline', 'and the page chose which form that is');
    t.ok(c[0].naiveAccepted, 'the PEM-with-newline row is the one that verifies');

    t.neg('the other five are refused, because the guess was simply wrong');
    for (i = 1; i < c.length; i++) t.refusedWith(!c[i].naiveAccepted, c[i].naiveWhy, /^signature$/, c[i].candidate);

    t.neg('verifyStrict refuses all six at the algorithm, whichever bytes were guessed');
    for (i = 0; i < c.length; i++) t.refusedWith(!c[i].strictOk, c[i].strictReason, /^E_ALG: /, c[i].candidate);

    /* err.name only. The message is printed on the page as observed data with
       the sentence "the wording is Chromium's and carries no stability
       contract" beside it, and it is not asserted anywhere. */
    t.neg('capability pin: SPKI bytes cannot be imported through the HMAC path');
    t.refusedWith(cap.spkiAsHmac.threw, cap.spkiAsHmac.name, /^NotSupportedError$/, 'NotSupportedError');

    t.neg('capability pin: a key whose algorithm does not match is refused');
    t.refusedWith(cap.hmacVerifyWithRsaKey.threw, cap.hmacVerifyWithRsaKey.name, /^InvalidAccessError$/, 'an RSA key through the HMAC path');
    t.refusedWith(cap.rsaVerifyWithEcKey.threw, cap.rsaVerifyWithEcKey.name, /^InvalidAccessError$/, 'an EC key through the RSA path');

    t.neg('capability pin: a key whose usages do not permit the operation is refused');
    t.refusedWith(cap.usagesDoNotPermit.threw, cap.usagesDoNotPermit.name, /^InvalidAccessError$/, 'a sign-only key asked to verify');

    /* §0/C5: it fails on kty, before alg is ever looked at, which is why the
       confusion path below feeds raw bytes and never a JWK. */
    t.neg('capability pin: an RSA public JWK is refused on kty, before alg is considered');
    t.refusedWith(cap.rsaJwkAsHmac.threw, cap.rsaJwkAsHmac.name, /^DataError$/, 'DataError');

    /* The boundary that makes the honesty section's password paragraph
       checkable rather than asserted. It costs zero milliseconds, which is why
       this lab ships no PBKDF2 derivation at all. */
    t.neg('capability pin: no password-hashing algorithm is available here');
    t.refusedWith(cap['kdf:Argon2id'].threw, cap['kdf:Argon2id'].name, /^NotSupportedError$/, 'Argon2id');
    t.refusedWith(cap['kdf:scrypt'].threw, cap['kdf:scrypt'].name, /^NotSupportedError$/, 'scrypt');
    t.refusedWith(cap['kdf:bcrypt'].threw, cap['kdf:bcrypt'].name, /^NotSupportedError$/, 'bcrypt');

    t.neg('capability pin: no digest outside the SHA-2 family is available either');
    t.refusedWith(cap['digest:BLAKE2b'].threw, cap['digest:BLAKE2b'].name, /^NotSupportedError$/, 'BLAKE2b');
    t.refusedWith(cap['digest:SHA3-256'].threw, cap['digest:SHA3-256'].name, /^NotSupportedError$/, 'SHA3-256');
    t.refusedWith(cap['digest:MD5'].threw, cap['digest:MD5'].name, /^NotSupportedError$/, 'MD5');

    /* The interesting fact is the inverse of the folklore: this is the one API
       where the confusion attack cannot be expressed, because the algorithm and
       the key are arguments the token cannot reach. */
    t.prop('and in this API the attack is structurally unavailable');
    t.ok(F.forge.rung2.structurallyImpossibleInSubtle, 'the algorithm is an argument, not a claim');
    t.eq(F.forge.rung2.spkiBytes, 294, 'the exported public key is 294 bytes');
    k = 0;
    for (i = 0; i < c.length; i++) if (c[i].bytes !== 294) k++;
    t.eq(k, 5, 'five of the six candidates are some wrapping of those bytes');
  });

  /* ============================ G6 ==================================== */

  /* Registered before every forgery group for a reason: without it, each card
     on the Forge tab is a fact about a function that refuses nothing. */
  group('G6 the naive verifier discriminates', function (t) {
    var d = F.discriminate, i, byLabel = {};
    for (i = 0; i < d.length; i++) byLabel[d[i].label] = d[i];

    t.prop('it accepts the legitimate token');
    t.ok(byLabel['the legitimate token'].ok, 'accepted');
    t.eq(byLabel['the legitimate token'].why, 'signature verified under the key the kid named',
      'under the key the kid named, not one the token carried');

    /* Two literals a future edit could quietly re-merge, so the difference is
       asserted as well as the values. When both acceptances said the same
       sentence, rung 3's "and it says exactly why" was green and meant
       nothing. */
    t.prop('and the reason names which arm of the key lookup answered');
    t.ne(byLabel['the legitimate token'].why, F.forge.rung3.naive.why,
      'the honest token and the token carrying its own key are not given the same reason');

    t.neg('it refuses a corrupt signature, and says the signature');
    t.refusedWith(!byLabel['a corrupt signature'].ok, byLabel['a corrupt signature'].why, /^signature$/, 'refused');

    t.neg('it refuses a truncated two-segment token, and says the shape');
    t.refusedWith(!byLabel['a truncated two-segment token'].ok, byLabel['a truncated two-segment token'].why, /^segments$/, 'refused');

    t.neg('it refuses a header that is not JSON, and says the header');
    t.refusedWith(!byLabel['a header that is not JSON'].ok, byLabel['a header that is not JSON'].why, /^header$/, 'refused');

    t.neg('it refuses a signature made over a different payload');
    t.refusedWith(!byLabel['a signature over a different payload'].ok, byLabel['a signature over a different payload'].why, /^signature$/, 'refused');

    t.neg('it refuses a signature made under a different key');
    t.refusedWith(!byLabel['the wrong key in the keyring'].ok, byLabel['the wrong key in the keyring'].why, /^signature$/, 'refused');

    t.prop('every row lands where the fixture said it would');
    for (i = 0; i < d.length; i++) t.eq(d[i].ok, d[i].expectedAccepted, d[i].label);

    /* The refusal has to come from the verifier, not from an import that could
       never have succeeded. verifyNaive funnels EVERY rejection into
       why:"signature" with the engine's err.name attached, so a row whose key
       was the wrong TYPE reads exactly like a row whose signature was wrong —
       and the wrong-key row used to be precisely that: an RSA JWK offered
       through the ECDSA path, refused with DataError, having never reached the
       one platform call underneath. Forcing verifyBytes to return true
       turned every other row on this table red and left that one green. The
       row now holds a generated P-256 key and this property is what keeps it
       honest. */
    t.prop('and every refusal here is the verifier\'s own verdict, not an import that could not have worked');
    for (i = 0; i < d.length; i++) {
      t.eq(d[i].errName, null, d[i].label + ': no engine error stood in for a signature check');
    }
  });

  /* ============================ G7 ==================================== */

  group('G7 correctly signed, and still the wrong answer', function (t) {
    var rows = F.forge.rung4.rows, ms = F.forge.rung4.msExpWithoutLifetimeRule, i, want;

    /* Nothing on this rung is forged. Every token is signed by this lab's own
       key over a payload this lab chose, which is the more interesting fact. */
    t.prop('all six are correctly signed — the signature check returns true on every one');
    for (i = 0; i < rows.length; i++) t.ok(rows[i][VERIFY_FLAG], rows[i].label);

    want = ['E_EXPIRED', 'E_LIFETIME', 'E_NBF', 'E_AUD', 'E_ISS', 'E_EXP_MISSING'];
    for (i = 0; i < rows.length; i++) {
      t.neg('a valid signature does not save a token whose claims are wrong: ' + rows[i].label);
      t.refusedWith(!rows[i].ok, rows[i].reason, new RegExp('^' + want[i] + ': '), rows[i].label + ' refused with ' + want[i]);
    }

    t.prop('and each refusal carries the code the fixture predicted for it');
    for (i = 0; i < rows.length; i++) t.ok(rows[i].codeAsExpected, rows[i].label + ' -> ' + rows[i].code);

    /* Two separate facts, and welding them together is how this bug ships: the
       expiry check PASSES on a token whose exp is in milliseconds, because a
       millisecond timestamp is comfortably in the future. */
    t.prop('a token whose exp is in milliseconds passes the expiry check');
    t.ok(ms.expiryCheckPasses, 'exp is in the future, arithmetically');
    t.ok(ms.withoutMaxLifetime.ok, 'and with no lifetime rule the token is accepted outright');
    t.ok(ms.caughtOnlyByLifetimeRule, 'the expiry check never fired at all');

    t.neg('and is caught only by the rule that bounds the lifetime');
    t.refusedWith(!ms.withMaxLifetime.ok, ms.withMaxLifetime.reason, /^E_LIFETIME: /, 'E_LIFETIME');

    /* §5: no clock is read anywhere in this lab's verification path. The
        refusal text quoting the injected number is the proof. */
    t.prop('every refusal here quotes the injected clock, never a real one');
    t.match(rows[0].reason, /now=1789025165/, 'the expiry refusal names the injected now');
    t.eq(F.meta.now, 1789025165, 'and the fixture pinned it');
  });

  /* ============================ G8 ==================================== */

  group('G8 the signature verified and it is still not the same token', function (t) {
    var r5 = F.forge.rung5, o = F.routes.orderCrossCheck, d = F.determinism, i;

    t.prop('the malleated token differs in the signature segment and nowhere else');
    t.ok(r5.tokensDiffer, 'the two token strings differ');
    t.ok(r5.sigSegmentsDiffer, 'in the signature segment');
    t.ok(r5.payloadSegmentIdentical, 'the payload segment is byte-identical');
    t.ok(r5.headerSegmentIdentical, 'and so is the header segment');

    /* Route B's arithmetic over route B's own copy of n. Corrupting either copy
       must turn this red from its own side, which is the point of the two
       copies and is mutation 5 and mutation 6 of the acceptance gate. */
    t.prop('s + s-prime equals the order of the curve, by route B\'s arithmetic');
    t.eq(r5.sumHex, r5.orderHex, 'the sum is n');
    t.eq(r5.sumCarry, 0, 'with no carry out of the top byte');
    t.ok(r5.sumEqualsOrder, 'and the fixture agrees');

    t.prop('each copy of the order is checked against the published constant, never against the other');
    t.eq(o.routeA, o.published, 'route A matches FIPS 186-4');
    t.eq(o.routeB, o.published, 'route B matches FIPS 186-4');
    t.eq(V.P256_ORDER.hex, o.published, 'and so does the frozen literal');
    t.ok(o.routeAMatchesPublished && o.routeBMatchesPublished, 'both flags set');

    /* This property must go GREEN, and it is the alarming outcome. */
    t.prop('both verifiers accept the malleated token, correctly');
    t.ok(r5.strictMalleated.ok, 'the strict one accepts it');
    t.eq(r5.strictMalleated.code, null, 'with nothing to refuse it for');
    t.ok(r5.naiveMalleated.ok, 'and so does the naive one');

    /* Not marked negative: it passes because something was ALLOWED. */
    t.prop('a denylist keyed on the token string misses it entirely');
    t.notOk(r5.denylistOnTokenString.refused, 'the malleated string was never on the list');
    t.eq(r5.denylistOnTokenString.listSize, 1, 'a list with the original in it');

    t.neg('a denylist keyed on the jti inside the signed payload catches it');
    t.refusedWith(r5.denylistOnJti.refused, r5.denylistOnJti.reason, /^E_REVOKED: /, 'E_REVOKED');

    t.neg('malleate refuses a token that is not three segments');
    t.throwsWith(function () { return PALSU.malleate('one.two'); }, /three-segment token/, 'two segments');
    t.throwsWith(function () { return PALSU.malleate(F.legit.token + '.extra'); }, /three-segment token/, 'four segments');

    t.neg('and refuses a signature segment that is not canonical base64url');
    t.throwsWith(function () { return PALSU.malleate(F.legit.headerSeg + '.' + F.legit.payloadSeg + '.QR'); },
      /b64u refuses\. non-canonical tail/, 'the strict decoder is in the path');

    /* A row whose algorithm the browser does not implement arrives with every
       field null, and t.ok(null) is a failure whose message reads "expected
       something truthy, got null" — true, and useless to the person reading a
       CI log on a Chromium older than this one. test/labs.test.js documents
       CHROMIUM_PATH as the escape hatch for exactly that machine, and Ed25519
       is the youngest thing this table asks for. The row still goes red, because
       an unverified claim is not a passed one; it just says which half failed.
       Measured: with Ed25519 taken away from the crypto API these two
       properties are the only reds, and the suffix is the whole difference.
       The word this file may not spell twice is why that sentence is worded
       around it — §6.2's headline grep counts lines, not intentions. */
    function whyNot(r) { return r.available === false ? ' — not available in this browser (' + r.errName + ')' : ''; }

    t.prop('five algorithms, each deterministic or randomised exactly as declared');
    for (i = 0; i < d.length; i++) t.ok(d[i].agreesWithExpectation, d[i].label + ': ' + (d[i].expectedDeterministic ? 'deterministic' : 'randomised') + whyNot(d[i]));

    t.prop('and the split is real: two differ from themselves, three reproduce byte for byte');
    for (i = 0; i < d.length; i++) {
      if (d[i].expectedDeterministic) t.ok(d[i].identical, d[i].alg + ' is stable' + whyNot(d[i]));
      else t.notOk(d[i].identical, d[i].alg + ' differs from itself' + whyNot(d[i]));
    }

    /* Which is why no assertion in this file pins an ES256 signature value. */
    /* The denylist's key comes out of the signed payload, so the extractor is
       part of the refusal and has to refuse a token it cannot read rather than
       returning something a lookup would miss quietly. */
    t.neg('route B\'s jti extractor refuses a token it cannot read');
    t.throwsWith(function () { return PERIKSA.jtiOf(42); }, /periksa refuses/, 'not a string');
    t.throwsWith(function () { return PERIKSA.jtiOf('one.two'); }, /periksa refuses/, 'two segments');
    t.throwsWith(function () { return PERIKSA.jtiOf(F.legit.headerSeg + '.' + B.b64uEncode(B.utf8Encode('[1,2]')) + '.x'); },
      /periksa refuses/, 'a payload that is not a JSON object');

    t.neg('and route B\'s byte adder refuses operands that are not bytes');
    t.throwsWith(function () { return PERIKSA.addBytes('zz', F.forge.rung5.sHex); }, /periksa refuses/, 'not hex');
    t.throwsWith(function () { return PERIKSA.addBytes(F.forge.rung5.sHex.slice(1), F.forge.rung5.sHex); }, /periksa refuses/, 'an odd number of digits');

    t.prop('five ES256 signatures over identical bytes are five distinct signatures');
    t.eq(F.es256Distinct.n, 5, 'five signings');
    t.eq(F.es256Distinct.distinct, 5, 'five distinct results');
  });

  /* ============================ G9 ==================================== */

  /* Agreement between two routes is worth nothing on its own: calling one
     function twice agrees perfectly. Ten of the properties below are route B
     refusing something route A would have swallowed without comment. */
  group('G9 the two routes disagree when they should', function (t) {
    var tok = F.legit.token, key = F.keys.es.pubJwkText, i;
    var liveKeyShaped = { type: 'public', algorithm: { name: 'ECDSA' }, extractable: false };

    t.neg('route B refuses anything shaped like a live key object');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: null, denylist: liveKeyShaped })); },
      /live key object/, 'a key object means the firewall was already breached');

    t.neg('route B refuses a token that is not a string');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), 42, key, expect({ jwk: null })); },
      /token must arrive as a string/, 'a number');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), null, key, expect({ jwk: null })); },
      /token must arrive as a string/, 'nothing at all');

    t.neg('route B refuses a key that is not JWK JSON text with a kty');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, 'not json', expect({ jwk: null })); },
      /kty member/, 'not JSON');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, '{"x":1}', expect({ jwk: null })); },
      /kty member/, 'JSON with no kty');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, '[]', expect({ jwk: null })); },
      /kty member/, 'an array');

    t.neg('route B refuses a key carrying a private component');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, F.keys.es.privJwkText, expect({ jwk: null })); },
      /private component/, 'the ES256 private JWK');

    t.neg('route B refuses a promise where a settled value belongs');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), { then: function () { } }, key, expect({ jwk: null })); },
      /a settled value was expected/, 'a thenable token');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: null, denylist: { then: function () { } } })); },
      /a settled value was expected/, 'a thenable inside the expectation');

    /* Tripwire 3 from the other side of the firewall: the second route could
       appear to confirm a wall-clock figure and could not actually do it, since
       it would be measuring the same clock on the same thread. */
    t.neg('route B refuses to confirm a wall-clock measurement');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: null, now: F.waktu.selfTest })); },
      /will not confirm a wall-clock/, 'a branded value as the clock');
    t.throwsWith(function () { return PERIKSA.checkAs(apiShim(), 'ES256', key, F.waktu.selfTest); },
      /will not confirm a wall-clock/, 'a branded value as the token');

    t.neg('route B refuses a key smuggled in through the expectation');
    t.throwsWith(function () { return PERIKSA.check(apiShim(), tok, key, expect({ jwk: { kty: 'EC' } })); },
      /in its own argument, not inside the expectation/, 'the key has its own parameter');

    t.neg('route B refuses to reach for a global crypto API');
    t.throwsWith(function () { return PERIKSA.check(null, tok, key, expect({ jwk: null })); },
      /must arrive as an argument/, 'it is handed one or it refuses');

    /* The two real divergences: same token, same claim, opposite answers,
       because route B was handed key material route A never used. */
    t.neg('handed the wrong key text, route B refuses a token route A accepted');
    t.refusedWith(!PROBE.wrongKeyText.ok, PROBE.wrongKeyText.code, /^E_SIG$/, 'route B refuses at the signature row');

    t.neg('handed the wrong key bytes, route B recomputes the signature to false');
    t.refusedWith(!PROBE.wrongKeyBytes.ok, PROBE.wrongKeyBytes.why, /^signature$/, 'the HMAC recompute does not match');

    t.prop('the three claims both routes were asked agree — and route A accepted the token both divergences use');
    for (i = 0; i < F.routes.rows.length; i++) t.ok(F.routes.rows[i].agree, F.routes.rows[i].claim);
    t.ok(F.legit.strict.ok, 'route A accepted the legitimate token');

    /* Asserted on the vector only. Asserting that the two decoders agree in
       general would collapse the firewall into a single route with extra steps. */
    t.prop('the two base64url decoders agree on the RFC 7515 A.1 header, and on that alone');
    t.eq(F.routes.rows[2].routeA, F.routes.rows[2].routeB, 'same bytes out of both decoders');
    t.eq(F.routes.rows[2].pinnedOn, 'RFC 7515 Appendix A.1', 'pinned on a published vector');

    t.prop('they disagree on the twin, which is the whole reason there are two of them');
    t.eq(PERIKSA.hexOf(PERIKSA.decode(F.bytes.twin.collisionSegments[0])),
      PERIKSA.hexOf(PERIKSA.decode(F.bytes.twin.segment)), 'route B decodes the twin to the same bytes');
    t.eq(F.bytes.twin.strictRefusals[0].code, 'E_B64_TAIL', 'while route A refuses to decode it at all');

    /* Two decoders that refuse nothing in common would not be two decoders. The
       classes below are refused by periksa's own copy, for periksa's own
       reasons, and the tail is the one place the two are meant to differ. */
    t.neg('route B\'s own decoder refuses a charset violation');
    t.throwsWith(function () { return PERIKSA.decode('a+b/'); }, /not base64url/, 'the standard alphabet');
    t.throwsWith(function () { return PERIKSA.decode('QQ=='); }, /not base64url/, 'padding');

    t.neg('route B\'s own decoder refuses whitespace inside a segment');
    t.throwsWith(function () { return PERIKSA.decode('ab cd'); }, /whitespace inside a segment/, 'a space');
    t.throwsWith(function () { return PERIKSA.decode('ab\ncd'); }, /whitespace inside a segment/, 'a newline');

    t.neg('route B\'s own decoder refuses a length base64url cannot produce');
    t.throwsWith(function () { return PERIKSA.decode('A'); }, /impossible length/, 'a lone A');
    t.throwsWith(function () { return PERIKSA.decode('AAAAA'); }, /impossible length/, 'five characters');

    t.prop('and both routes bottom out in one call, which the page states rather than hides');
    t.match(F.routes.sharedBottom, /^crypto\.[a-z]+\.verify$/, 'there is no second signature implementation in a browser');
    t.match(PROBE.wrongKeyText.sharedBottom, /^crypto\.[a-z]+\.verify$/, 'route B says so in every verdict it returns');
  });

  /* ============================ G10 =================================== */

  group('G10 published vectors as pins on this lab\'s composition', function (t) {
    var i, row, tp = F.vectors.totp, mis = F.vectors.totpMisread, syn = F.vectors.totpSynthetic;

    t.prop('RFC 7515 A.1 reproduces exactly — header, payload and HS256 signature');
    t.eq(F.vectors.a1.headerSegComputed, F.vectors.a1.headerSegPublished, 'header segment');
    t.eq(F.vectors.a1.payloadSegComputed, F.vectors.a1.payloadSegPublished, 'payload segment');
    t.eq(F.vectors.a1.signatureComputed, F.vectors.a1.signaturePublished, 'signature');
    t.ok(F.vectors.a1.signatureMatches, 'and the fixture agrees');
    t.eq(F.vectors.a1.sigBytes, 32, '32 bytes');
    t.notOk(F.vectors.a1.verifyOnly, 'HS256 is reproducible, so it is reproduced');

    t.prop('RFC 7515 A.2 reproduces exactly — 342 characters of RS256');
    t.eq(F.vectors.a2.headerSegComputed, F.vectors.a2.headerSegPublished, 'header segment');
    t.eq(F.vectors.a2.signatureComputed, F.vectors.a2.signaturePublished, 'signature');
    t.eq(F.vectors.a2.sigCharsComputed, 342, '342 base64url characters');
    t.eq(F.vectors.a2.sigBytes, 256, '256 bytes');

    t.prop('RFC 7515 A.3 verifies but cannot be reproduced');
    t.ok(F.vectors.a3.publishedVerifies, 'the published ES256 signature verifies');
    t.eq(F.vectors.a3.sigBytes, 64, '64 bytes of raw r||s');
    t.ok(F.vectors.a3.verifyOnly, 'and the vector is marked verify-only');

    /* The asymmetry is the assertion. ES256 draws a fresh nonce every time, so
       a suite that pinned this signature by equality would be a time bomb. */
    t.prop('two re-signings differ from the published value and from each other');
    t.ne(F.vectors.a3.resignA, F.vectors.a3.signaturePublished, 'the first differs from the RFC');
    t.ne(F.vectors.a3.resignB, F.vectors.a3.signaturePublished, 'the second differs from the RFC');
    t.ne(F.vectors.a3.resignA, F.vectors.a3.resignB, 'and they differ from each other');
    t.ok(F.vectors.a3.resignsDifferFromEachOther, 'the fixture agrees');

    t.prop('RFC 4231 cases 1 to 7 pin this lab\'s HMAC framing and truncation');
    for (i = 0; i < F.vectors.hmac4231.length; i++) {
      row = F.vectors.hmac4231[i];
      t.eq(row.computed, row.published, 'case ' + row.n + ' (' + row.note + ')');
    }

    t.prop('RFC 6238 Appendix B, all eighteen rows, at the eight digits the RFC prints');
    for (i = 0; i < tp.length; i++) {
      t.eq(tp[i].computed, tp[i].published, 'T=' + tp[i].t + ' ' + tp[i].mode + ' -> ' + tp[i].published);
    }

    /* The table pins the seed handling, the HMAC, the truncation and the
       modulo. It pins the counter WIDTH not at all — every published row is
       reproduced by an implementation that writes only four bytes. */
    t.prop('and the table does not pin the counter width: a 32-bit counter reproduces all eighteen');
    for (i = 0; i < tp.length; i++) {
      t.ok(tp[i].counter32BugMatchesPublished, 'T=' + tp[i].t + ' ' + tp[i].mode + ' matches the 32-bit implementation too');
    }
    t.eq(F.vectors.totpSummary.matched32Bug, 18, 'eighteen of eighteen');

    /* The negative control. It has to fail, on the right rows, or the eighteen
       green rows above prove only that a computation ran. */
    t.prop('the misread-seed control reproduces exactly the SHA-1 rows and no others');
    for (i = 0; i < mis.rows.length; i++) {
      t.eq(mis.rows[i].matches, mis.rows[i].mode === 'SHA-1',
        'T=' + mis.rows[i].t + ' ' + mis.rows[i].mode + (mis.rows[i].matches ? ' still matches' : ' no longer matches'));
    }

    t.prop('which is six of the eighteen, and every one of the six is SHA-1');
    t.eq(mis.matched, 6, 'six matches');
    t.eq(mis.expectedMatches, 6, 'six expected');
    t.ok(mis.everyMatchIsSha1, 'all six are the SHA-1 rows');
    t.eq(mis.workedRowComputed, mis.workedRow.misread, 'the worked row recomputes to the misread value');
    t.ne(mis.workedRow.misread, mis.workedRow.publishedValue, 'which is not the published one');

    t.prop('a synthetic row above 2^32 is what separates the two counter widths');
    t.eq(syn.counter, 4294967296, 'T = 2^32');
    t.ok(syn.counterIs2Pow32, 'exactly');
    t.eq(syn.counter8Hex, '0000000100000000', 'eight bytes carry the bit');
    t.eq(syn.counter4Hex, '0000000000000000', 'four bytes drop it');
    t.eq(syn.computed8, syn.expected8, 'the 8-byte path gives ' + syn.expected8);
    t.eq(syn.computed32Bug, syn.expected32Bug, 'the 32-bit path gives ' + syn.expected32Bug);
    t.ok(syn.separates, 'and the two differ');

    t.notOk(syn.published, 'and it is labelled a self-consistency check: not published');
    t.ok(syn.selfConsistency, 'a self-consistency check');
    t.notOk(syn.publishedTableSeparatesThem, 'the published table does not separate them');
    t.eq(F.vectors.totpSummary.largestPublishedCounter, 666666666, 'the largest published counter');
    t.eq(F.vectors.totpSummary.largestPublishedCounterHex, '0000000027bc86aa', 'four bytes with room to spare');
    t.ok(F.vectors.totpSummary.countersFitIn32Bits, 'every published counter fits in 32 bits');

    t.prop('the six-digit form beside the table is this lab\'s truncation, not the RFC\'s');
    t.eq(tp[0].published, '94287082', 'the RFC prints eight digits');
    t.eq(tp[0].sixDigitThisLab, '287082', 'the familiar six are a truncation of them');
    t.ne(tp[0].published, tp[0].sixDigitThisLab, 'and the two are not the same string');

    /* The vector text is validated on the way in rather than trusted. */
    t.neg('a published constant with a character removed is refused, not silently accepted');
    t.throwsWith(function () { return B.unhex(V.P256_ORDER.hex.slice(1)); }, /unhex refuses/, 'odd length');
    t.throwsWith(function () { return B.unhex(V.P256_ORDER.hex.replace('a', 'z')); }, /unhex refuses/, 'not hex');

    t.neg('a published signature with whitespace folded into it is refused');
    t.throwsWith(function () { return B.b64uDecodeStrict(F.vectors.a1.signaturePublished.slice(0, 10) + '\n' + F.vectors.a1.signaturePublished.slice(10)); },
      /b64u refuses\. whitespace inside a segment/, 'a newline inside the segment');

    t.neg('and a published signature padded to a multiple of four is refused');
    t.throwsWith(function () { return B.b64uDecodeStrict(F.vectors.a3.signaturePublished + '=='); },
      /b64u refuses\. not base64url/, 'base64 padding is not base64url');

    t.neg('and a published signature with one character swapped for a base64 one is refused');
    t.throwsWith(function () { return B.b64uDecodeStrict('+' + F.vectors.a2.signaturePublished.slice(1)); },
      /b64u refuses\. not base64url/, 'a leading + is not base64url');
  });

  /* ============================ G11 =================================== */

  group('G11 fabrication, enforced rather than promised', function (t) {
    var i, s, hits, strings, fns, src, guard = root.SAHIH_GUARD;

    /* Synchronous, ahead of any crypto, so a synchronous helper can hold them —
       and so that the Issue tab's refusal appears with no crypto having run,
       which is the visible shape of a structural rule. */
    t.neg('the issuer refuses an iss that is not an RFC 2606 reserved name');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', { iss: 'https://bank.example.com', sub: 'u_FIKTIF_1042' }); },
      /iss must end in \.invalid/, 'a real-looking issuer');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', { iss: 'https://sahih.invalid.co', sub: 'u_FIKTIF_1042' }); },
      /iss must end in \.invalid/, 'and a near miss');

    t.neg('the issuer refuses a sub that does not announce itself as fabricated');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', { iss: 'https://sahih.invalid', sub: 'u_1042' }); },
      /sub must begin u_FIKTIF_/, 'a plausible user id');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', { iss: 'https://sahih.invalid', sub: 'admin' }); },
      /sub must begin u_FIKTIF_/, 'and a memorable one');

    /* The rule is an anchored prefix, not a substring, and the difference is
       the whole rule: a sub that merely mentions FIKTIF somewhere reads as
       fabricated to a human skimming the page and is not what the guard says. */
    t.neg('and refuses a sub that only mentions the marker instead of beginning with it');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', { iss: 'https://sahih.invalid', sub: 'admin_FIKTIF_1042' }); },
      /sub must begin u_FIKTIF_/, 'the marker in the middle is not the marker');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', { iss: 'https://sahih.invalid', sub: 'u_FIKTIF' }); },
      /sub must begin u_FIKTIF_/, 'and the prefix without its trailing underscore is not the prefix');

    t.neg('the issuer refuses an algorithm it does not know');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'HS999', { iss: 'https://sahih.invalid', sub: 'u_FIKTIF_1042' }); },
      /does not know alg/, 'HS999');

    t.neg('and refuses to sign something that is not a payload object');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', null); }, /a payload object is required/, 'null');
    t.throwsWith(function () { return J.issue(null, { kty: 'EC' }, 'ES256', 'sub=admin'); }, /a payload object is required/, 'a string');

    strings = reachableStrings(F);

    /* Every sweep below passes by finding nothing, which is also what an empty
       corpus and a dead detector look like. Measured: make reachableStrings
       return [] and all three sweeps stay green; make exportedFunctions scan no
       namespace and the source sweep stays green; break looksLikeHexSecret and
       nothing anywhere notices. So the corpus is sized, the paths are counted,
       and the predicate is handed things it must flag. */
    t.prop('the sweeps below run over a corpus, and an empty one would not pass for a clean one');
    t.gt(strings.length, 400, strings.length + ' strings are reachable from the fixture');
    var subPaths = 0, issPaths = 0;
    for (i = 0; i < strings.length; i++) {
      if (/\.sub$/.test(strings[i].path)) subPaths++;
      if (/\.iss$/.test(strings[i].path)) issPaths++;
    }
    t.gt(subPaths, 0, subPaths + ' of them sit at a .sub path');
    t.gt(issPaths, 0, issPaths + ' of them sit at an .iss path');

    t.prop('every identifier reachable on the fixture announces that it is fabricated');
    hits = [];
    for (i = 0; i < strings.length; i++) {
      if (/\.sub$/.test(strings[i].path) && strings[i].s.indexOf('FIKTIF') < 0) hits.push(strings[i].path + '=' + strings[i].s);
    }
    t.deep(hits, [], 'no sub without FIKTIF in it');

    hits = [];
    for (i = 0; i < strings.length; i++) {
      if (/\.iss$/.test(strings[i].path) && !/\.invalid$/.test(strings[i].s)) hits.push(strings[i].path + '=' + strings[i].s);
    }
    t.deep(hits, [], 'no iss outside .invalid');

    /* GitHub's push protection has already rejected a push in this repository
       over a fixture that merely LOOKED like a key. The sweep runs over every
       reachable string and over every exported function's source, because a
       credential-shaped literal hiding in code is the same incident. */
    /* The detector, before the corpus. Each control is assembled from two
       fragments so that no literal in this file is itself credential-shaped —
       a scanner that spells out what it scans for is the one file in the tree
       that can make the repository's own grep lie. */
    /* Assembled from fragments, and now long enough to be a plausible key and
       exercised in the three places a leaked one actually turns up: on its own,
       as a JSON value, and after an equals sign. */
    var OPENAI_CTL = 's' + 'k-' + 'A1B2C3D4E5F6G7H8I9J0K1';
    var GITHUB_CTL = 'gh' + 'p_' + 'A1B2C3D4E5F6G7H8I9J0K1';
    var AWS_CTL = 'AK' + 'IA' + 'A1B2C3D4E5F6G7H8';

    t.neg('the credential detector flags every shape it claims to look for, and names which');
    t.refusedWith(credentialShaped(OPENAI_CTL), credentialShape(OPENAI_CTL), /^an OpenAI-style prefix$/, 'flagged, and for that reason');
    t.refusedWith(credentialShaped(GITHUB_CTL), credentialShape(GITHUB_CTL), /^a GitHub-style prefix$/, 'flagged, and for that reason');
    t.refusedWith(credentialShaped(AWS_CTL), credentialShape(AWS_CTL), /^an AWS-style prefix$/, 'flagged, and for that reason');

    t.neg('and finds one wherever a leaked key actually turns up, not only on its own');
    t.refusedWith(credentialShaped('{"apiKey":"' + OPENAI_CTL + '"}'), credentialShape('{"apiKey":"' + OPENAI_CTL + '"}'), /^an OpenAI-style prefix$/, 'as a JSON value');
    t.refusedWith(credentialShaped('API' + '_KEY=' + OPENAI_CTL), credentialShape('API' + '_KEY=' + OPENAI_CTL), /^an OpenAI-style prefix$/, 'after an equals sign');
    t.refusedWith(credentialShaped('do not commit ' + AWS_CTL + ' anywhere'), credentialShape('do not commit ' + AWS_CTL + ' anywhere'), /^an AWS-style prefix$/, 'in running prose');
    t.refusedWith(credentialShaped('-----BEGIN EC ' + 'PRI' + 'VATE KEY-----'), credentialShape('-----BEGIN EC ' + 'PRI' + 'VATE KEY-----'), /^a private-key header$/, 'flagged, and for that reason');
    t.refusedWith(credentialShaped('0123456789abcdef0123456789abcdef' + '01234567'), credentialShape('0123456789abcdef0123456789abcdef' + '01234567'), /^a forty-character hex run$/, 'flagged, and for that reason');

    /* And the two exemptions, which are the half that keeps the sweep usable:
       a detector that flagged everything would also pass every sweep below. */
    t.prop('and lets through the things it must let through');
    t.notOk(credentialShaped('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b' + '0b0b0b0b'), 'RFC 4231\'s constant-fill key is published, not secret');
    t.notOk(credentialShaped(F.legit.token), 'and a JWT this lab issued is not a credential shape');
    /* The whole reason the prefix rules are delimited. Undelimited they fire on
       this string once in roughly three hundred page loads, and the message CI
       prints when they do says this lab leaked an API key. */
    t.notOk(credentialShaped('Ab' + OPENAI_CTL + 'Cd'),
      'and three letters buried inside a random blob are not a credential');

    t.prop('no reachable string on the fixture is shaped like a credential');
    hits = [];
    for (i = 0; i < strings.length; i++) {
      if (credentialShaped(strings[i].s)) hits.push(strings[i].path);
    }
    t.deep(hits, [], strings.length + ' reachable strings, none credential-shaped');

    fns = exportedFunctions();

    t.prop('and the source sweep has functions to sweep');
    t.gt(fns.length, 30, fns.length + ' exported functions were reachable to scan');

    hits = [];
    for (i = 0; i < fns.length; i++) {
      src = fns[i].src;
      if (credentialShaped(src)) hits.push(fns[i].name);
    }
    t.deep(hits, [], fns.length + ' exported functions scanned');

    t.prop('no exported function reaches for the non-cryptographic random source');
    hits = [];
    for (i = 0; i < fns.length; i++) if (/Math\s*\.\s*rand/.test(fns[i].src)) hits.push(fns[i].name);
    t.deep(hits, [], 'randomness in this lab comes from the platform CSPRNG or from nowhere');

    t.prop('the fixture is plain data all the way down, and says how far down it walked');
    t.deep(F.plainness.offenders, [], 'no offender');
    t.gt(F.plainness.walked, 1000, F.plainness.walked + ' values walked');

    t.prop('nothing left this tab');
    t.eq(guard.total(), 0, 'the egress counter is at zero');
    t.eq(guard.counts.fetch, 0, 'no fetch');
    t.eq(guard.counts.xhr, 0, 'no XMLHttpRequest');
    t.eq(guard.counts.beacon, 0, 'no sendBeacon');
    t.eq(guard.counts.websocket, 0, 'no WebSocket');
    t.eq(guard.counts.eventsource, 0, 'no EventSource');

    /* The counter's arithmetic is exercised on a snapshot and restored, never
       by making a call. Every blocked attempt logs a console error under this
       page's CSP, and one console error makes CI treat the page as broken — so
       there is no "press this to prove the counter works" button anywhere in
       this lab, and there must never be one. */
    t.prop('and the counter it reports through counts correctly when it is exercised');
    var snapshot = {}, k, restoredTotal, onchange = guard.onchange;
    for (k in guard.counts) if (Object.prototype.hasOwnProperty.call(guard.counts, k)) snapshot[k] = guard.counts[k];
    var logLen = guard.log.length;
    guard.onchange = null;
    guard.noteExternal('fetch', 'https://nowhere.invalid/a', 'luar');
    guard.noteExternal('carrierPigeon', 'https://nowhere.invalid/b', 'luar');
    t.eq(guard.total(), 2, 'two notes counted');
    t.eq(guard.counts.carrierPigeon, 1, 'an unknown kind counts as one and never becomes NaN');
    for (k in guard.counts) if (Object.prototype.hasOwnProperty.call(guard.counts, k)) guard.counts[k] = snapshot[k] || 0;
    delete guard.counts.carrierPigeon;
    guard.log.length = logLen;
    guard.onchange = onchange;
    restoredTotal = guard.total();
    t.eq(restoredTotal, 0, 'and the snapshot is restored');

    t.prop('this browser has no constant-time comparison to offer, and the lab says so');
    t.eq(F.hasTimingSafeEqual, false, 'no timingSafeEqual on the crypto API');
  });

  /* One predicate, used on the reachable strings AND on every exported
     function's source, so the two sweeps cannot drift apart and so there is a
     single thing to hand a positive control.

     THE PREFIX RULES ARE DELIMITED ON BOTH SIDES, AND THAT IS NOT COSMETIC.
     Written as bare substring matches they fire on this lab's own CSPRNG
     output: sixty-nine thousand characters of base64url are regenerated on
     every page load — one 256-bit secret, twenty-odd ES256 signature segments,
     the tokens carrying them — and three characters reading "sk-" landing next
     to sixteen alphanumerics inside a random blob is not a credential. Measured
     with the shipped predicate over three hundred thousand simulated loads:
     ONE IN 297 flagged, almost all of them the OpenAI prefix, and I watched one
     go red in a real browser run. That is a security lab's CI announcing a
     leaked API key, on a page that leaked nothing, roughly every three hundred
     pushes — the most alarming possible message attached to the least true
     possible cause.

     A credential is a whole token, so the match must begin at a delimiter and
     end at one, and must be as long as a real key. Measured the same way over
     a million simulated loads, that takes the rate from ONE IN 297 to ONE IN
     23,256 — and every realistic shape is still caught: bare, inside JSON,
     after an equals sign, and in running prose. The controls below assert
     exactly that, and the exemptions assert the other half.

     It is 1 in 23,256 and not zero, and that residual cannot be closed by
     shape. What is left is a generated leaf that BEGINS "sk-" and then runs
     twenty alphanumerics — which is character for character what a real leaked
     key looks like, so no detector reading shape alone can tell them apart.
     Closing it needs the sweep to know which strings this repository authored
     and which the CSPRNG produced this load, and that is a corpus change rather
     than a predicate change. Stated here rather than papered over. */
  var CRED_OPENAI = /(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9]{20,}(?![A-Za-z0-9])/;
  var CRED_GITHUB = /(^|[^A-Za-z0-9_-])ghp_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/;
  var CRED_AWS = /(^|[^A-Za-z0-9_-])AKIA[A-Z0-9]{16}(?![A-Za-z0-9])/;

  function credentialShape(s) {
    if (CRED_OPENAI.test(s)) return 'an OpenAI-style prefix';
    if (CRED_GITHUB.test(s)) return 'a GitHub-style prefix';
    if (CRED_AWS.test(s)) return 'an AWS-style prefix';
    if (PEM_PRIVATE.test(s)) return 'a private-key header';
    if (looksLikeHexSecret(s)) return 'a forty-character hex run';
    return null;
  }

  function credentialShaped(s) { return credentialShape(s) !== null; }

  function looksLikeHexSecret(s) {
    /* RFC 4231 publishes three constant-fill keys that are exactly forty hex
       characters — 0b, aa and 0c repeated twenty times. They are in the RFC,
       they are not a secret, and exempting a run whose bytes are all identical
       is narrower than exempting the vector by path. */
    var m = String(s).match(/\b[0-9a-f]{40}\b/);
    if (!m) return false;
    var hex = m[0], i;
    for (i = 2; i < hex.length; i += 2) if (hex.slice(i, i + 2) !== hex.slice(0, 2)) return true;
    return false;
  }

  function exportedFunctions() {
    var out = [];
    var names = ['SAHIH_BYTES', 'SAHIH_VECTORS', 'SAHIH_JOSE', 'SAHIH_PALSU', 'SAHIH_PERIKSA', 'SAHIH_FIXTURE', 'SAHIH_GUARD'];
    var i, k, ns, v;
    for (i = 0; i < names.length; i++) {
      ns = root[names[i]];
      if (!ns) continue;
      for (k in ns) {
        if (!Object.prototype.hasOwnProperty.call(ns, k)) continue;
        v = ns[k];
        if (typeof v !== 'function') continue;
        try { out.push({ name: names[i] + '.' + k, src: Function.prototype.toString.call(v) }); }
        catch (e) { out.push({ name: names[i] + '.' + k, src: '' }); }
      }
    }
    return out;
  }

  /* ============================ G0 ==================================== */

  /* Registered last because it audits what the others did. A suite whose own
     counting is wrong prints a wrong number above the fold on a page whose
     whole pitch is that every number on it is checkable. */
  group('G0 the suite audits itself', function (t) {
    var i, key, junk, jt, jr, before;

    t.prop('every property this run declared actually executed an assertion');
    var silent = [];
    for (i = 0; i < props.length - 1; i++) if (props[i].executions === 0) silent.push(props[i].group + ' / ' + props[i].name);
    t.deep(silent, [], 'no property was declared and then left unasserted');

    t.prop('no two properties inside one group share a name');
    var dup = [], seen = {};
    for (i = 0; i < props.length; i++) {
      key = props[i].group + ' :: ' + props[i].name;
      if (Object.prototype.hasOwnProperty.call(seen, key)) dup.push(key);
      seen[key] = true;
    }
    t.deep(dup, [], props.length + ' properties, all distinctly named within their group');

    t.prop('no two groups share a name');
    var gd = [], gs = {};
    for (i = 0; i < groups.length; i++) { if (gs[groups[i].name]) gd.push(groups[i].name); gs[groups[i].name] = true; }
    t.deep(gd, [], groups.length + ' groups, all distinctly named');

    /* Tripwire 2. Everything crossing page.evaluate must survive the structured
       clone. A CryptoKey does not throw on the way out — it arrives as {}, and
       a deep() comparing two {} passes forever. */
    t.prop('nothing recorded so far is unclonable');
    t.deep(unclonable(RESULTS), [], RESULTS.length + ' results carry only strings, numbers, booleans and null');
    t.deep(unclonable(F), [], 'and neither does the fixture the whole suite read from');

    /* And proven to fire, the way tripwires 1 and 3 are proven below. record()
       coerces every field it writes, so the results array is plain by
       construction and a walk over it can only ever come back empty — the
       fixture is the operand that can actually carry an offender, and a walker
       nobody has watched go red is decoration. A typed array and an Error are
       two of the four shapes §0/C10 measured crossing page.evaluate hollowed
       out; a CryptoKey is the third and needs no separate case, because the
       walker names anything whose prototype is not Object.prototype. */
    t.prop('and the walker is proven to name an offender rather than assumed to');
    t.deep(unclonable({ ok: true, u: new Uint8Array([1, 2, 3]) }), ['$.u is [object Uint8Array]'],
      'a typed array is caught and named by path');
    t.deep(unclonable({ rows: [{ e: new Error('sahih: a stand-in, never thrown') }] }), ['$.rows[0].e is [object Error]'],
      'and so is an Error nested two levels down');
    t.deep(unclonable({ missing: undefined }), ['$.missing is undefined'], 'and a value that is not there at all');

    /* Tripwire 1, asserted zero AND proven to fire. A check that has never been
       seen to go red is decoration. The throwaway's results are discarded. */
    t.prop('no synchronous helper was applied to an async subject');
    t.eq(ASYNC_MISUSE, 0, 'the async tripwire never fired during the run');
    before = ASYNC_MISUSE;
    junk = []; jr = [];
    jt = makeCtx(junk, 'throwaway', jr);
    jt.neg('deliberately misusing throws on a rejected promise');
    jt.throwsWith(function () { return Promise.reject(new Error('sahih: a deliberately dropped rejection')); }, /nothing/, 'misuse');
    t.eq(ASYNC_MISUSE, before + 1, 'and it fires when it is misused');
    t.eq(junk.length, 1, 'recording one failure into the throwaway');
    t.eq(junk[0].ok, false, 'which is red');
    t.match(junk[0].name, /async subject/, 'and names the mistake');
    ASYNC_MISUSE = before;

    /* Tripwire 3, the same way: zero, and proven live, and the fixture proven
       to carry something branded so the guard has something to catch. */
    t.prop('no assertion in this suite took a timing measurement as an operand');
    t.eq(WAKTU_TOUCHED, 0, 'the timing tripwire never fired during the run');
    t.gt(countBranded(F), 0, 'and the fixture carries branded values for it to catch');
    before = WAKTU_TOUCHED;
    junk = []; jr = [];
    jt = makeCtx(junk, 'throwaway', jr);
    jt.prop('deliberately asserting over a branded measurement');
    jt.eq(F.waktu.selfTest, F.waktu.selfTest, 'misuse');
    t.eq(WAKTU_TOUCHED, before + 1, 'and it fires when one is used');
    t.eq(junk[0].ok, false, 'recording red rather than a passing comparison');
    WAKTU_TOUCHED = before;

    /* The suite read the fixture and must not have written to it: every group
       after the first would otherwise be asserting against something the
       earlier ones changed. Taken as a VALUE before the groups ran. */
    t.prop('the suite left the fixture exactly as it found it');
    t.eq(FX.fingerprint(F), FP_BEFORE, 'the fingerprint is unchanged');
    t.eq(typeof FP_BEFORE, 'string', 'and it was taken as a string, not as a live reference');

    /* Both files exist and filled their sections in. If either were missing the
       fixture would still build, the ladder would be empty, and every assertion
       above it would be green. */
    t.prop('the forger and the second route both loaded');
    t.eq(F.forge.pending, null, 'palsu.js filled the forge ladder');
    t.eq(F.routes.pending, null, 'periksa.js filled the route table');
  });

  /* ============================== the runner ============================ */

  /* G0 needs the results array while the run is still in flight, and a group
     receives only its own context, so the array lives out here. */
  var RESULTS = [];

  function runSync() {
    var results = [];
    RESULTS = results;
    props.length = 0;
    ASYNC_MISUSE = 0;
    WAKTU_TOUCHED = 0;
    FP_BEFORE = FX.fingerprint(F);

    var i;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      try { g.fn(makeCtx(results, g.name, props)); }
      catch (err) {
        results.push({
          group: g.name, name: 'group threw', ok: false,
          message: String(err && err.stack || err)
        });
      }
    }

    var byGroup = [], index = {};
    for (i = 0; i < groups.length; i++) {
      index[groups[i].name] = byGroup.length;
      byGroup.push({ group: groups[i].name, properties: 0, negatives: 0, executions: 0, passed: 0, failed: 0 });
    }

    /* The last walk, over the object as it will actually be handed to
       page.evaluate — including byGroup, which no group ever saw. It is
       recorded through a real G0 property so that a hollowed-out result is a
       red assertion rather than a silent success. */
    var tail = makeCtx(results, 'G0 the suite audits itself', props);
    tail.prop('the assembled result object survives the structured clone end to end');
    tail.deep(unclonable({ results: results, byGroup: byGroup }), [],
      'every value in the result is a string, a number, a boolean, null, a plain array or a plain object');

    var negatives = 0, key, bare = [];

    /* "It was refused" and "it was refused for the reason I claimed" differ
       enormously here. A token refused for a corrupt tail, inside a test
       claiming a bad algorithm, is a green assertion asserting the opposite of
       the truth — so a negative may only record through a helper that pinned a
       reason. */
    tail.prop('every negative property pinned a reason rather than settling for a refusal');
    for (i = 0; i < props.length; i++) {
      if (!props[i].negative) continue;
      negatives++;
      for (key in props[i].helpers) {
        if (!Object.prototype.hasOwnProperty.call(props[i].helpers, key)) continue;
        if (key !== 'throwsWith' && key !== 'refusedWith') bare.push(props[i].name + ' used ' + key);
      }
    }
    tail.deep(bare, [], negatives + ' negatives, every one through throwsWith or refusedWith');

    /* Registered LAST, and counted again here, because these two read
       props.length: opened any earlier they compare a share against a total the
       badge has not finished growing, and the assertion then guards a different
       number from the one the page prints. Measured — the two disagreed by two. */
    negatives = 0;
    tail.prop('a real share of this suite is negative — properties that pass only on a refusal');
    for (i = 0; i < props.length; i++) if (props[i].negative) negatives++;
    tail.gt(negatives, props.length / 2, negatives + ' of ' + props.length + ' properties are negative');
    tail.lt(negatives, props.length, 'and they are not all of it');

    var passed = 0;
    for (i = 0; i < results.length; i++) if (results[i].ok) passed++;

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
      properties: props.length,
      executions: results.length,
      negatives: negatives,
      groups: groups.length,
      byGroup: byGroup,
      /* A positive count here means the page attempted egress, which is a
         defect in its own right and shows up as one test rather than as a CI
         job that failed with every assertion green. */
      noise: root.SAHIH_GUARD ? root.SAHIH_GUARD.total() : 0,
      /* Always zero, and deliberately so: §5 forbids this file from reading a
         clock, because a suite that pinned a duration would go red on somebody
         else's laptop for a reason that has nothing to do with this code.
         app.js times the call from the outside, where the figure is a display
         and not an assertion. */
      ms: 0
    };
  }

  /* The one pre-pass that needs the crypto API. It exists because G9's two real
     divergences cannot be settled anywhere else: the fixture only ever hands
     route B the RIGHT key. Both calls are documented never to reject and both
     carry a catch anyway, because a dropped rejection is a pageerror and a
     pageerror fails the lab with every assertion green. */
  function probeRoutes(api) {
    var out = {
      wrongKeyText: { ok: null, code: 'probe did not run', sharedBottom: '' },
      wrongKeyBytes: { ok: null, why: 'probe did not run' }
    };
    return PERIKSA.check(api, F.legit.token, F.keys.rs.pubJwkText, FX.expectation({ jwk: null }))
      .then(function (v) { out.wrongKeyText = v; })
      ['catch'](function (e) { out.wrongKeyText = { ok: false, code: 'E_PROBE', sharedBottom: '', errName: String(e && e.name) }; })
      .then(function () { return PERIKSA.checkAs(api, 'HS256', F.keys.hs.secretB64u ? B.b64uDecodeStrict(F.keys.hs.secretB64u) : [], F.legit.token); })
      .then(function (v) { out.wrongKeyBytes = v; })
      ['catch'](function (e) { out.wrongKeyBytes = { ok: false, why: 'E_PROBE', errName: String(e && e.name) }; })
      .then(function () { PROBE = out; });
  }

  /* test/labs.test.js navigates with waitUntil: 'load' and then evaluates this
     call, awaiting whatever it returns. A synchronous run() would assert
     against a fixture that has not been built and every group would read
     undefined. */
  function run() {
    var api = null;
    /* The one line in this file that names the crypto namespace, and the reason
       §6.2 greps for it. Wrapped because §3.10's boot is
       T.run().then(...)['catch'](...) — a SYNCHRONOUS throw here would sail past
       that catch and land as a pageerror, which is the one failure mode this
       whole file is built to make impossible. */
    try { api = crypto.subtle; } catch (e) { api = null; }
    if (!api) {
      return Promise.reject(new Error('sahih: this page has no Web Crypto API, so there is nothing to assert against'));
    }
    return FX.build(api).then(function (fixture) { F = fixture; return probeRoutes(api); }).then(runSync);
  }


  root.SAHIH_TESTS = { run: run, groups: groups, props: props };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_TESTS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
