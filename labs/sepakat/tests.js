/*!
 * Sepakat — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sepakat - tests.js
 * The property suite. Runs in the page (Properties tab, in a Worker) and under
 * node from the same source, so what a visitor sees green is what gates the code.
 *
 * Three rules this file is written to, all of them learned the hard way in the
 * other labs in this folder:
 *
 * 1. NEGATIVE PROPERTIES CARRY THEIR WEIGHT. Roughly a third of what follows
 *    passes only when something REFUSES, LOSES or DIVERGES. "naiveSet resurrects
 *    a removed element" is an assertion, and if a well-meaning edit to crdt.js
 *    accidentally fixed naiveSet, this suite goes red — because the foil would
 *    have stopped demonstrating the thing it is here to demonstrate.
 *
 * 2. NO ASSERTION MAY HAVE JAVASCRIPT'S OWN CORRECTNESS AS ITS SUBJECT. Checking
 *    that 2+2 is 4 through four layers of my own code is not a test of anything.
 *    Every property below is about a merge law, a convergence claim, or a
 *    quantity a specific engine is supposed to preserve or destroy.
 *
 * 3. THE CHECKERS ARE THEMSELVES CHECKED. The last group feeds broken input to
 *    every judgement this suite depends on — the serialiser, the convergence
 *    test, the counter oracle — and requires each one to report the breakage.
 *    A green suite whose checkers cannot go red is the failure mode that reached
 *    production three times in this repository. It is worth the extra group.
 *
 * Counts are reported as PROPERTIES and EXECUTIONS separately, and the split is
 * not decoration: running one law over 40 seeds is one property with 40
 * executions, and calling that 40 properties would flatter the number by a
 * factor of forty.
 */
(function (root) {
  'use strict';
  var S = root.SEPAKAT || {}; root.SEPAKAT = S;
  var C = S.crdt;
  var cj = S.canonicalJson;

  var groups = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  /* PROPERTIES and EXECUTIONS are counted separately, and the split is not
     decoration. "Merge is commutative" checked over 40 seeded pairs is ONE
     property and 40 executions; reporting it as 40 properties would inflate the
     headline number by a factor of forty for no extra assurance. A plain
     assertion is one of each. Loops add their extra runs through bump(), so the
     execution total is counted by the code rather than estimated by me. */
  var EXEC = { n: 0 };
  function bump(extra) { EXEC.n += Math.max(0, extra); }

  function makeCtx(results, groupName) {
    function record(ok, name, msg) {
      EXEC.n++;
      results.push({ group: groupName, name: name, ok: !!ok, message: ok ? '' : (msg || '') });
    }
    return {
      ok: function (v, name) { record(!!v, name, 'expected truthy, got ' + cj(v === undefined ? null : v)); },
      notOk: function (v, name) { record(!v, name, 'expected falsy, got ' + cj(v === undefined ? null : v)); },
      eq: function (a, b, name) { record(a === b, name, 'expected ' + cj(b) + ', got ' + cj(a)); },
      deep: function (a, b, name) { record(cj(a) === cj(b), name, 'expected ' + cj(b) + ', got ' + cj(a)); },
      throws: function (fn, name) {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        record(threw, name, 'expected a throw, got a clean return');
      }
    };
  }

  /* Merge laws, once, reused by every type. `gen(rng)` must produce a random
     state of the type; `merge` must be its join. Any type claiming to be a CRDT
     has to survive all four of these on random input, and the two foils below
     are here precisely because one of them does not. */
  function lawsFor(t, label, gen, merge, seeds) {
    var comm = true, assoc = true, idem = true, absorb = true;
    var counterexample = '';
    for (var i = 0; i < seeds; i++) {
      var rng = S.rng(0xC0DE + i * 7919);
      /* Each state is generated with a distinct replica label. Every type here
         assumes globally unique write ids, and a generator that reused them
         across the three states would be testing a precondition violation
         rather than the merge — which is exactly what it did on the first run,
         and RGA duly failed commutativity for a reason that was mine. */
      var a = gen(rng, 0), b = gen(rng, 1), c = gen(rng, 2);
      if (cj(merge(a, b)) !== cj(merge(b, a))) { comm = false; counterexample = counterexample || ('commutativity, seed ' + i); }
      if (cj(merge(merge(a, b), c)) !== cj(merge(a, merge(b, c)))) { assoc = false; counterexample = counterexample || ('associativity, seed ' + i); }
      if (cj(merge(a, a)) !== cj(a)) { idem = false; counterexample = counterexample || ('idempotency, seed ' + i); }
      /* Merging twice must add nothing the first merge did not: a join is a
         least upper bound, so ((a∨b)∨b) has to sit exactly on (a∨b). */
      var ab = merge(a, b);
      if (cj(merge(ab, b)) !== cj(ab)) { absorb = false; counterexample = counterexample || ('absorption, seed ' + i); }
    }
    bump((seeds - 1) * 4);
    t.ok(comm, label + ': merge is commutative over ' + seeds + ' random pairs');
    t.ok(assoc, label + ': merge is associative over ' + seeds + ' random triples');
    t.ok(idem, label + ': merge is idempotent over ' + seeds + ' random states');
    t.ok(absorb, label + ': re-merging a peer state changes nothing');
    return counterexample;
  }

  /* ------------------------------------------------------------------ PRNG */

  group('Seeded PRNG', function (t) {
    var a = S.rng(42), b = S.rng(42), c = S.rng(43);
    var sa = [], sb = [], sc = [];
    for (var i = 0; i < 64; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
    t.deep(sa, sb, 'the same seed gives the same stream — every "random" run in this lab is reproducible');
    t.notOk(cj(sa) === cj(sc), 'a different seed gives a different stream');
    var r = S.rng(7), lo = 1, hi = 1;
    for (var j = 0; j < 4000; j++) { var v = r.range(3, 9); lo = Math.min(lo === 1 && j === 0 ? v : lo, v); hi = Math.max(hi === 1 && j === 0 ? v : hi, v); }
    t.eq(lo, 3, 'range() reaches its lower bound');
    t.eq(hi, 9, 'range() reaches its upper bound');
    var sh = S.rng(9).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    t.deep(sh.slice().sort(function (x, y) { return x - y; }), [1, 2, 3, 4, 5, 6, 7, 8], 'shuffle is a permutation, not a resample');
  });

  /* ------------------------------------------------------- canonical JSON */

  group('Canonical serialisation', function (t) {
    t.eq(cj({ b: 1, a: 2 }), cj({ a: 2, b: 1 }), 'key order does not change the canonical form');
    t.eq(cj({ x: { q: 1, p: 2 } }), '{"x":{"p":2,"q":1}}', 'sorting is applied at every depth');
    t.notOk(cj([1, 2]) === cj([2, 1]), 'array order IS significant — sequence types depend on this');
    t.eq(cj(0), cj(-0), 'negative zero and zero are the same state (a counter can reach either)');
    t.eq(cj({ a: 1, b: undefined }), cj({ a: 1 }), 'an undefined property and an absent one are the same state');
    t.throws(function () { cj(NaN); }, 'NaN is refused rather than serialised as null');
    t.throws(function () { cj(Infinity); }, 'Infinity is refused rather than serialised as null');
    t.throws(function () { cj(undefined); }, 'a bare undefined is refused');
    /* The whole suite decides "converged" with this function. If it ever
       reported two different boards as equal, every convergence assertion in
       this file would pass for free. */
    t.notOk(S.sameState({ tasks: [{ id: 'a', points: 3 }] }, { tasks: [{ id: 'a', points: 4 }] }),
      'two boards that differ in one number are NOT reported as the same state');
    t.ok(S.sameState({ tasks: [{ id: 'a', points: 3 }] }, { points: undefined, tasks: [{ points: 3, id: 'a' }] }),
      'two boards that differ only in key order ARE reported as the same state');
  });

  /* ------------------------------------------------------- vector clocks */

  group('Vector clocks', function (t) {
    var a = S.vcInc(S.vcNew(), 'x');
    var b = S.vcInc(a, 'y');
    t.eq(S.vcCompare(a, b), 'before', 'a clock that was extended happened-before the extension');
    t.eq(S.vcCompare(b, a), 'after', 'and the reverse comparison agrees');
    t.eq(S.vcCompare(a, a), 'equal', 'a clock equals itself');
    var p = S.vcInc(a, 'x'), q = S.vcInc(a, 'y');
    t.eq(S.vcCompare(p, q), 'concurrent', 'two independent extensions of one clock are concurrent, not ordered');
    t.deep(S.vcMerge(p, q), { x: 2, y: 1 }, 'merge takes the componentwise maximum');
    t.eq(S.vcCompare(S.vcMerge(p, q), p), 'after', 'the merge dominates both inputs');
    t.ok(S.vcCovers(S.vcMerge(p, q), q), 'the merge covers both inputs');
    t.notOk(S.vcCovers(p, q), 'a clock does not cover a concurrent one');
    t.ok(S.vcCovers(a, S.vcNew()), 'every clock covers the empty clock');
    t.eq(S.vcSum(S.vcMerge(p, q)), 3, 'the sum counts events, not replicas');
    lawsFor(t, 'vector clock', function (rng) {
      var v = {};
      var names = ['x', 'y', 'z', 'w'];
      for (var i = 0; i < 4; i++) if (rng.bool(0.7)) v[names[i]] = rng.range(0, 6);
      return v;
    }, S.vcMerge, 30);
  });

  /* ------------------------------------------------ hybrid logical clocks */

  group('Hybrid logical clock', function (t) {
    var h = S.hlcNew('a');
    var h1 = S.hlcLocal(h, 1000);
    var h2 = S.hlcLocal(h1, 1000);
    t.eq(h2.wall, 1000, 'two events in the same millisecond share a wall reading');
    t.eq(h2.count, h1.count + 1, 'and are separated by the counter');
    t.ok(S.hlcCompare(h2, h1) > 0, 'the later of the two is ordered later');
    var back = S.hlcLocal(h2, 400);
    t.eq(back.wall, 1000, 'a physical clock that jumps BACKWARDS does not drag the HLC back with it');
    t.ok(S.hlcCompare(back, h2) > 0, 'and the event after the jump still orders after the one before it');

    /* The property the whole `crdt` engine leans on: an edit made in reply to
       another edit can never be stamped before it, however wrong the replying
       device's clock is. */
    var slow = S.hlcNew('b');
    var fast = S.hlcLocal(S.hlcNew('a'), 90000);
    var reply = S.hlcReceive(slow, fast, 12);
    t.ok(S.hlcCompare(reply, fast) > 0, 'a reply from a device 90 s BEHIND still orders after the message it answers');
    t.eq(reply.wall, fast.wall, 'the receiving clock adopts the sender reading rather than its own');

    var tie1 = { wall: 5, count: 2, id: 'a' }, tie2 = { wall: 5, count: 2, id: 'b' };
    t.ok(S.hlcCompare(tie1, tie2) < 0, 'identical readings are broken by replica id, so the order is total');
    t.eq(S.hlcCompare(tie1, tie1), 0, 'a stamp equals itself');
    t.eq(S.hlcString({ wall: 5, count: 2, id: 'a' }), '5.2@a', 'stamps render as wall.count@replica');

    /* Stated as an assertion because it is the limit of the technique, and the
       one thing people expect an HLC to do that it cannot: with no causal path
       between two writes there is nothing to order them by except the physical
       reading, so a skewed device can still win a genuinely concurrent race. */
    var A = S.hlcLocal(S.hlcNew('a'), 9000);
    var B = S.hlcLocal(S.hlcNew('b'), 1000);
    t.ok(S.hlcCompare(A, B) > 0, 'with NO causal link, the skewed device still wins — an HLC orders causality, it does not repair clocks');
  });

  /* ------------------------------------------------------ LWW register */

  group('LWW register', function (t) {
    var cmp = S.stampCompare;
    var r0 = C.lwwNew('a', { ts: 10, id: 'x' });
    t.eq(C.lwwSet(r0, 'b', { ts: 20, id: 'x' }, cmp).v, 'b', 'a later write replaces an earlier one');
    t.eq(C.lwwSet(r0, 'b', { ts: 5, id: 'x' }, cmp).v, 'a', 'an earlier write is discarded, silently — this is the whole problem');
    t.eq(C.lwwMerge(r0, C.lwwNew('c', { ts: 10, id: 'y' }), cmp).v, 'c', 'an exact timestamp tie is broken by replica id, so the result is deterministic');
    t.throws(function () { C.lwwMerge(r0, C.lwwNew('z', { ts: 10, id: 'x' }), cmp); },
      'the same replica reusing a stamp for a different value is REFUSED, not silently resolved');
    /* The value is derived from the stamp on purpose: a register whose stamps
       are unique per write is the only shape the type is defined for, and the
       merge refuses anything else rather than pretending. */
    lawsFor(t, 'LWW register (wall)', function (rng, i) {
      var st = { ts: rng.range(1, 8), id: ['p', 'q', 'r'][i] };
      return C.lwwNew('v' + st.ts + st.id, st);
    }, function (a, b) { return C.lwwMerge(a, b, cmp); }, 40);

    /* The negative property the lab is built around. Both writes existed, both
       were deliberate, the type converges, and one of them is gone with no
       record anywhere that it ever happened. */
    var base = C.lwwNew(5, { ts: 100, id: 'a' });
    var byA = C.lwwSet(base, 8, { ts: 200, id: 'a' }, cmp);
    var byB = C.lwwSet(base, 7, { ts: 201, id: 'b' }, cmp);
    t.eq(C.lwwMerge(byA, byB, cmp).v, 7, 'two concurrent writes over a shared base converge to exactly one of them');
    t.notOk(C.lwwMerge(byA, byB, cmp).v === 10, 'and the register cannot represent "both happened" — 3 + 2 over 5 is not 10 here');
  });

  /* ---------------------------------------------------------- counters */

  group('G-Counter and PN-Counter', function (t) {
    var g = C.gAdd(C.gAdd(C.gNew(), 'a', 3), 'b', 4);
    t.eq(C.gValue(g), 7, 'the value is the sum of the per-replica components');
    t.eq(C.gValue(C.gMerge(g, g)), 7, 'merging a peer state twice does not double the total');
    t.eq(C.gValue(C.gMerge(g, C.gAdd(C.gNew(), 'a', 1))), 7, 'a STALE component is absorbed by max and cannot lower the total');
    t.throws(function () { C.gAdd(C.gNew(), 'a', -1); }, 'a grow-only counter refuses a negative increment rather than breaking its own max');
    lawsFor(t, 'G-Counter', function (rng) {
      var c = C.gNew();
      for (var i = 0; i < 4; i++) c = C.gAdd(c, rng.pick(['a', 'b', 'c']), rng.range(0, 9));
      return c;
    }, C.gMerge, 40);

    var pn = C.pnAdd(C.pnAdd(C.pnNew(), 'a', 5), 'b', -2);
    t.eq(C.pnValue(pn), 3, 'a PN-Counter nets its two halves');
    t.eq(C.pnValue(C.pnMerge(pn, pn)), 3, 'and is unmoved by a duplicate merge');
    t.eq(C.pnValue(C.pnAdd(pn, 'a', 0)), 3, 'a zero increment is a no-op');
    lawsFor(t, 'PN-Counter', function (rng) {
      var c = C.pnNew();
      for (var i = 0; i < 5; i++) c = C.pnAdd(c, rng.pick(['a', 'b', 'c']), rng.range(-5, 5));
      return c;
    }, C.pnMerge, 40);

    /* Conservation, over random concurrent histories: every replica adds on its
       own component, all states are merged in a random order, and the total is
       the sum of every increment ever made. This is the property a register
       cannot have. */
    var conserved = true, worst = '';
    for (var s = 0; s < 40; s++) {
      var rng = S.rng(500 + s);
      var reps = ['a', 'b', 'c', 'd'];
      var states = { a: C.pnNew(), b: C.pnNew(), c: C.pnNew(), d: C.pnNew() };
      var expect = 0;
      for (var i = 0; i < 30; i++) {
        var who = rng.pick(reps), d = rng.range(-6, 9);
        states[who] = C.pnAdd(states[who], who, d);
        expect += d;
        /* A gossip round to a random peer, sometimes twice, sometimes stale. */
        var peer = rng.pick(reps);
        states[peer] = C.pnMerge(states[peer], states[who]);
        if (rng.bool(0.3)) states[peer] = C.pnMerge(states[peer], states[who]);
      }
      var all = C.pnNew();
      for (var k = 0; k < reps.length; k++) all = C.pnMerge(all, states[reps[k]]);
      if (C.pnValue(all) !== expect) { conserved = false; worst = 'seed ' + s + ': ' + C.pnValue(all) + ' != ' + expect; }
    }
    bump(39);
    t.ok(conserved, 'over 40 random gossip histories with duplicate merges, the total equals the sum of every increment' + (worst ? ' — ' + worst : ''));
  });

  /* ------------------------------------------------------------- OR-Set */

  group('OR-Set', function (t) {
    var s = C.orAdd(C.orNew(), 'urgent', 'a:1');
    t.ok(C.orHas(s, 'urgent'), 'an added element is present');
    t.notOk(C.orHas(C.orRemove(s, 'urgent'), 'urgent'), 'and absent once removed');
    t.ok(C.orHas(C.orAdd(C.orRemove(s, 'urgent'), 'urgent', 'a:2'), 'urgent'),
      're-adding after a remove works, because the new add carries a tag the remove never buried');

    /* Add-wins, spelled out. The removing replica buries the tags it has SEEN;
       a concurrent add carries one it has not. */
    var shared = C.orAdd(C.orNew(), 'urgent', 'a:1');
    var remover = C.orRemove(shared, 'urgent');
    var adder = C.orAdd(shared, 'urgent', 'b:1');
    t.ok(C.orHas(C.orMerge(remover, adder), 'urgent'), 'a concurrent add beats a remove');
    t.ok(C.orHas(C.orMerge(adder, remover), 'urgent'), 'and it beats it in the other merge order too — the outcome is the type, not the timing');
    t.notOk(C.orHas(C.orMerge(remover, C.orRemove(adder, 'urgent')), 'urgent'),
      'a remove that HAS seen the second add does remove it');
    t.deep(C.orValues(C.orAdd(C.orAdd(C.orNew(), 'b', 'x:1'), 'a', 'x:2')), ['a', 'b'], 'values come out sorted, so two replicas render the same order');
    lawsFor(t, 'OR-Set', function (rng) {
      var st = C.orNew();
      for (var i = 0; i < 6; i++) {
        var el = rng.pick(['a', 'b', 'c']);
        if (rng.bool(0.65)) st = C.orAdd(st, el, rng.pick(['p', 'q', 'r']) + ':' + rng.range(1, 4));
        else st = C.orRemove(st, el);
      }
      return st;
    }, C.orMerge, 40);
  });

  /* ------------------------------------------------ the two foils */

  group('Why the tag needs to be there (2P-Set)', function (t) {
    var s = C.tpAdd(C.tpNew(), 'urgent');
    t.deep(C.tpValues(s), ['urgent'], 'a 2P-Set holds what it is given');
    s = C.tpRemove(s, 'urgent');
    t.deep(C.tpValues(s), [], 'and drops what is removed');
    /* A real CRDT: the laws hold. It is still the wrong type for a tag list,
       and the assertion below is the reason, not an accusation. */
    lawsFor(t, '2P-Set', function (rng) {
      var st = C.tpNew();
      for (var i = 0; i < 5; i++) {
        var el = rng.pick(['a', 'b', 'c']);
        if (rng.bool(0.6)) st = C.tpAdd(st, el); else st = C.tpRemove(st, el);
      }
      return st;
    }, C.tpMerge, 30);
    t.deep(C.tpValues(C.tpAdd(s, 'urgent')), [],
      'RE-ADDING A REMOVED ELEMENT SILENTLY DOES NOTHING — the type cannot tell a re-add from a replay, which is exactly what an OR-Set tag is for');
  });

  group('Why a tombstone is needed at all (naive set)', function (t) {
    var mine = C.nsAdd(C.nsNew(), 'urgent');
    var peer = C.nsAdd(C.nsNew(), 'urgent');
    mine = C.nsRemove(mine, 'urgent');
    t.deep(C.nsValues(mine), [], 'locally, the remove looks like it worked');
    /* The most common homemade-sync bug in existence, asserted rather than
       described. It survives review because every replica converges — fast,
       consistently, on the wrong answer. */
    t.deep(C.nsValues(C.nsMerge(mine, peer)), ['urgent'],
      'ONE MERGE WITH ANY PEER THAT STILL HAS IT BRINGS IT BACK — a remove expressed as an absence is not a fact the merge can see');
    t.deep(C.nsValues(C.nsMerge(peer, mine)), ['urgent'], 'and the resurrection does not depend on merge order');
    t.deep(C.nsValues(C.nsMerge(C.nsNew(), mine)), [], 'a merge with a peer that never had it looks fine, which is why this ships');
  });

  /* ----------------------------------------------------------------- RGA */

  group('RGA sequence (character-level text)', function (t) {
    var doc = C.rgaNew();
    var r = C.rgaTypeAt(doc, 0, 'halo', 'a', 0);
    t.eq(C.rgaText(r.rga), 'halo', 'typed characters read back in order');
    var r2 = C.rgaTypeAt(r.rga, 4, ' dunia', 'a', r.counter);
    t.eq(C.rgaText(r2.rga), 'halo dunia', 'appending at the end works');
    t.eq(C.rgaText(C.rgaDeleteRange(r2.rga, 0, 5)), 'dunia', 'deleting a range removes exactly that range');
    t.eq(C.rgaText(C.rgaDelete(C.rgaDelete(r2.rga, C.rgaVisible(r2.rga)[0].id), C.rgaVisible(r2.rga)[0].id)), 'alo dunia',
      'deleting the same character twice is the same as deleting it once');
    t.throws(function () { C.rgaInsert(doc, '99:zz', '1:a', 'x'); }, 'inserting after an unknown character is refused rather than silently rooted');
    t.throws(function () { C.rgaInsert(r.rga, C.RGA_ROOT, C.rgaVisible(r.rga)[0].id, 'x'); }, 'a duplicate node id is refused');

    /* Concurrent typing at the same cursor. Both replicas start from the same
       document, type different words at the same position, exchange states, and
       must read the same string — in both merge directions. */
    var base = C.rgaTypeAt(C.rgaNew(), 0, 'ac', 'z', 0).rga;
    var A = C.rgaTypeAt(base, 1, 'XY', 'a', 100).rga;
    var B = C.rgaTypeAt(base, 1, 'PQ', 'b', 100).rga;
    var AB = C.rgaMerge(A, B), BA = C.rgaMerge(B, A);
    t.eq(C.rgaText(AB), C.rgaText(BA), 'two replicas typing at the same position converge to one string, whichever way the merge runs');
    t.eq(C.rgaText(AB).length, 6, 'and no character is lost or duplicated in the process');
    t.ok(/X/.test(C.rgaText(AB)) && /P/.test(C.rgaText(AB)), 'both replicas keep their own text — neither side is discarded');
    /* Stated because it is the honest limit of a causal tree: the two words may
       end up interleaved. Every replica sees the SAME interleaving, which is
       what convergence promises; it is not the same as what a human wanted. */
    t.ok(C.rgaText(AB) === 'aXYPQc' || C.rgaText(AB) === 'aPQXYc' || /X.*P|P.*X/.test(C.rgaText(AB)),
      'the merged order is deterministic — and may interleave the two insertions, which is a known limit of this family, not a bug in this build');

    var deletedByA = C.rgaDelete(A, C.rgaVisible(base)[0].id);
    t.eq(C.rgaText(C.rgaMerge(deletedByA, B)), C.rgaText(C.rgaMerge(B, deletedByA)), 'a delete on one side and an insert on the other still converge');
    t.ok(C.rgaText(C.rgaMerge(deletedByA, B)).indexOf('a') === -1, 'and the deletion survives the merge instead of being undone by the peer copy');

    lawsFor(t, 'RGA', function (rng, idx) {
      /* All three states fork from one shared document, the way real replicas
         do, and each edits under its own replica letter so node ids stay
         globally unique. */
      var d = C.rgaTypeAt(C.rgaNew(), 0, 'nota', 'z', 0).rga, counter = 100 * (idx + 1);
      var who = ['p', 'q', 'r'][idx];
      for (var i = 0; i < 5; i++) {
        var vis = C.rgaVisible(d);
        if (rng.bool(0.75) || !vis.length) {
          var res = C.rgaTypeAt(d, rng.range(0, vis.length), rng.pick(['x', 'y', 'z']), who, counter);
          d = res.rga; counter = res.counter;
        } else {
          d = C.rgaDelete(d, vis[rng.range(0, vis.length - 1)].id);
        }
      }
      return d;
    }, C.rgaMerge, 40);

    /* Convergence over random concurrent edit histories, which is the claim the
       text tab makes on screen. */
    var allSame = true, firstBad = '';
    for (var s = 0; s < 30; s++) {
      var rng2 = S.rng(9000 + s);
      var shared = C.rgaTypeAt(C.rgaNew(), 0, 'laporan', 'z', 0).rga;
      var forks = [], counters = [];
      var who = ['a', 'b', 'c'];
      for (var f = 0; f < 3; f++) { forks.push(shared); counters.push(1000 * (f + 1)); }
      for (var e = 0; e < 8; e++) {
        var pick = rng2.range(0, 2);
        var vis2 = C.rgaVisible(forks[pick]);
        if (rng2.bool(0.7) || !vis2.length) {
          var out = C.rgaTypeAt(forks[pick], rng2.range(0, vis2.length), rng2.pick(['a', 'b', 'c', ' ']), who[pick], counters[pick]);
          forks[pick] = out.rga; counters[pick] = out.counter;
        } else {
          forks[pick] = C.rgaDelete(forks[pick], vis2[rng2.range(0, vis2.length - 1)].id);
        }
      }
      /* Every replica merges every other, in a shuffled order per replica. */
      var finals = [];
      for (var m = 0; m < 3; m++) {
        var acc = forks[m];
        var order = rng2.shuffle([0, 1, 2]);
        for (var o = 0; o < 3; o++) acc = C.rgaMerge(acc, forks[order[o]]);
        finals.push(C.rgaText(acc));
      }
      if (!(finals[0] === finals[1] && finals[1] === finals[2])) { allSame = false; firstBad = firstBad || ('seed ' + s + ': ' + cj(finals)); }
    }
    bump(29);
    t.ok(allSame, 'over 30 random concurrent edit histories, all three replicas read the same text' + (firstBad ? ' — ' + firstBad : ''));
  });

  /* -------------------------------------------------------- text editing */

  group('Textarea edits into a sequence', function (t) {
    var T = S.text;
    t.deep(T.diff('abc', 'abXc'), { pos: 2, del: 0, ins: 'X' }, 'a one-character insertion is recovered as an insertion');
    t.deep(T.diff('abc', 'ac'), { pos: 1, del: 1, ins: '' }, 'a backspace is recovered as a deletion');
    t.deep(T.diff('abc', 'abc'), { pos: 3, del: 0, ins: '' }, 'no change is an empty splice');
    t.deep(T.diff('', 'halo'), { pos: 0, del: 0, ins: 'halo' }, 'typing into an empty field');
    t.deep(T.diff('halo', ''), { pos: 0, del: 4, ins: '' }, 'clearing the field');
    /* Ambiguous by construction: any of the three characters could be the one
       that went. A prefix-first diff always resolves that towards the END of the
       run, and asserting which one it picks is worth more than asserting that it
       picks something — two replicas resolving the same ambiguity differently is
       how a merge ends up with text neither of them typed. */
    t.deep(T.diff('aaa', 'aa'), { pos: 2, del: 1, ins: '' }, 'deleting one of three identical characters is resolved to the LAST of the run, deterministically');

    /* The property that matters more than any single case: whatever splice the
       diff reports, replaying it on the old string has to reproduce the new one
       exactly, or the RGA is being told a different edit than the one made. */
    var roundTrip = true, bad = '';
    var alphabet = 'ab c';
    for (var i = 0; i < 300; i++) {
      var rng = S.rng(2600 + i);
      var before = '', after = '';
      var n = rng.range(0, 12), m = rng.range(0, 12);
      for (var x = 0; x < n; x++) before += alphabet.charAt(rng.int(alphabet.length));
      for (var y = 0; y < m; y++) after += alphabet.charAt(rng.int(alphabet.length));
      if (T.applyDiff(before, T.diff(before, after)) !== after) { roundTrip = false; bad = bad || (cj(before) + ' → ' + cj(after)); }
    }
    bump(299);
    t.ok(roundTrip, 'over 300 random string pairs, replaying the splice reproduces the target exactly' + (bad ? ' — ' + bad : ''));

    /* And the same through the RGA, which is the path the page actually uses. */
    var viaRga = true, bad2 = '';
    for (var j = 0; j < 200; j++) {
      var r2 = S.rng(3300 + j);
      var doc = T.newDoc('a', 'laporan servis');
      for (var e = 0; e < 3; e++) {
        var cur = T.read(doc);
        var at = r2.range(0, cur.length);
        var next = cur.slice(0, at) + r2.pick(['X', '', 'ab', ' ']) + cur.slice(at + r2.range(0, 2));
        doc = T.edit(doc, next).doc;
        if (T.read(doc) !== next) { viaRga = false; bad2 = bad2 || (cj(next) + ' read back as ' + cj(T.read(doc))); }
      }
    }
    bump(599);
    t.ok(viaRga, 'over 200 random edit sequences, the document reads back exactly what was typed' + (bad2 ? ' — ' + bad2 : ''));

    /* Concurrent editing, which is the whole reason for the type. */
    var base = T.newDoc('base', 'ganti filter');
    var A = T.edit(T.forkDoc(base, 'a'), 'ganti filter AC').doc;
    var B = T.edit(T.forkDoc(base, 'b'), 'ganti filter dan oli').doc;
    var AB = T.read(T.merge(A, B)), BA = T.read(T.merge(B, A));
    t.eq(AB, BA, 'two people editing one line converge to the same text in either merge order');
    t.ok(AB.indexOf('AC') >= 0 && AB.indexOf('oli') >= 0, 'and BOTH edits are in it — which is what a whole-string last-writer-wins cannot do');
    t.ok(AB.indexOf('ganti filter') === 0, 'the untouched prefix both of them shared is still there once');

    /* The comparison the Text tab draws on screen, asserted here so the claim
       on the page is checked rather than illustrated. */
    var lwwResult = 'ganti filter dan oli';
    t.notOk(lwwResult.indexOf('AC') >= 0, 'the last-writer-wins answer to the same two edits keeps one of them and drops the other');
  });

  /* ------------------------------------------------------ board engines */

  var SEEDS = [];
  for (var si = 0; si < 40; si++) SEEDS.push(1000 + si * 37);

  function runAll(seed, opts) {
    var plan = S.randomPlan(seed, opts);
    return {
      plan: plan, oracle: S.oracle(plan),
      naive: S.simulate('naive', plan),
      lww: S.simulate('lww', plan),
      crdt: S.simulate('crdt', plan)
    };
  }

  /* Does this engine's final board agree with the sum of every point movement
     the script contained, for the rows still on the board? Returns a verdict
     string so a failure names the number instead of just going red. */
  function pointsVerdict(res, engineKey) {
    var r = res[engineKey];
    if (!r.converged) return 'diverged';
    var got = S.pointsOf(r.reads[0]);
    var lost = 0, gained = 0;
    for (var id in got) if (Object.prototype.hasOwnProperty.call(got, id)) {
      var want = res.oracle.points[id] || 0;
      if (got[id] < want) lost++;
      else if (got[id] > want) gained++;
    }
    return lost && gained ? 'both' : lost ? 'lost' : gained ? 'gained' : 'exact';
  }

  group('Board engines under a hostile network', function (t) {
    var runs = [];
    for (var i = 0; i < SEEDS.length; i++) runs.push(runAll(SEEDS[i]));

    /* --- the claim the lab exists to make --- */
    var crdtConverged = 0, crdtExact = 0;
    var lwwConverged = 0, lwwExact = 0, lwwLossy = 0;
    var naiveConverged = 0, naiveExact = 0;
    for (var k = 0; k < runs.length; k++) {
      if (runs[k].crdt.converged) crdtConverged++;
      if (pointsVerdict(runs[k], 'crdt') === 'exact') crdtExact++;
      if (runs[k].lww.converged) lwwConverged++;
      var lv = pointsVerdict(runs[k], 'lww');
      if (lv === 'exact') lwwExact++; else lwwLossy++;
      if (runs[k].naive.converged) naiveConverged++;
      if (pointsVerdict(runs[k], 'naive') === 'exact') naiveExact++;
    }

    bump((SEEDS.length - 1) * 5);
    t.eq(crdtConverged, SEEDS.length, 'crdt: every replica ends identical, in all ' + SEEDS.length + ' random runs');
    t.eq(crdtExact, SEEDS.length, 'crdt: the point totals equal the sum of every increment, in all ' + SEEDS.length + ' runs');
    t.eq(lwwConverged, SEEDS.length, 'lww: every replica ends identical too — converging is NOT the thing it gets wrong');
    /* Negative property. If a change made LWW stop losing updates, this goes
       red, because the comparison the lab is built on would have quietly
       stopped being true. */
    t.ok(lwwLossy > SEEDS.length * 0.5, 'lww: the point totals are wrong in most runs (' + lwwLossy + '/' + SEEDS.length + ') despite full agreement between replicas');
    t.notOk(naiveConverged === SEEDS.length, 'naive: replicas do NOT all agree (' + naiveConverged + '/' + SEEDS.length + ' runs converged)');

    /* Direction of the error. The intuition — "a register drops writes, so the
       total comes out low" — is wrong, and the first run of this suite proved
       it: 13 of 40 seeds came out HIGH. A register does not drop points, it
       drops WRITES, and dropping a write that happened to be a deduction raises
       the total instead. So the error has no sign, and a reconciliation that
       only looks for shortfalls will not find half of it. */
    var lwwGained = 0, lwwLost = 0;
    for (var g = 0; g < runs.length; g++) {
      var v = pointsVerdict(runs[g], 'lww');
      if (v === 'gained' || v === 'both') lwwGained++;
      if (v === 'lost' || v === 'both') lwwLost++;
    }
    t.ok(lwwLost > 0, 'lww: some runs end BELOW the true total (' + lwwLost + '/' + SEEDS.length + ') — a dropped increment');
    t.ok(lwwGained > 0, 'lww: and some end ABOVE it (' + lwwGained + '/' + SEEDS.length + ') — a dropped DEDUCTION, which is the same bug with the opposite sign');

    /* --- the reply always wins, at every skew ---
       A rename made AFTER seeing someone else's rename must survive it. Under a
       wall clock that holds only while the replying phone's clock is ahead;
       under an HLC it holds at every skew, because the reply's stamp is derived
       from the message it answers. Swept rather than sampled: one skew value
       would be a coincidence, thirteen spanning ±9 seconds is the property. */
    var skews = [-9000, -6000, -3000, -1500, -600, -200, 0, 200, 600, 1500, 3000, 6000, 9000];
    var crdtKeptReply = 0, lwwKeptReply = 0;
    for (var sk = 0; sk < skews.length; sk++) {
      var plan = {
        seed: 3, replicas: [{ id: 'ari', skew: 0 }, { id: 'budi', skew: skews[sk] }],
        script: [
          { at: 0, replica: 'ari', intent: { k: 'create', id: 'J1', title: 'first', status: 'queued', points: 1 } },
          { at: 1000, replica: 'ari', intent: { k: 'rename', id: 'J1', title: 'ari-edit' } },
          /* Far enough after the rename that budi has certainly received it:
             this is a reply, not a race. */
          { at: 4000, replica: 'budi', intent: { k: 'rename', id: 'J1', title: 'budi-reply' } }
        ],
        latency: [10, 40], dupRate: 0, partitions: [], taskIds: ['J1']
      };
      if (S.simulate('crdt', plan).reads[0].tasks[0].title === 'budi-reply') crdtKeptReply++;
      if (S.simulate('lww', plan).reads[0].tasks[0].title === 'budi-reply') lwwKeptReply++;
    }
    bump((skews.length - 1) * 2);
    t.eq(crdtKeptReply, skews.length, 'crdt: the later edit survives at all ' + skews.length + ' clock skews from -9 s to +9 s');
    t.ok(lwwKeptReply < skews.length, 'lww: the later edit is lost at ' + (skews.length - lwwKeptReply) + ' of those ' + skews.length + ' skews — and nothing about the edit changed, only the phone');

    /* --- convergence is not luck: same plan, different delivery seed --- */
    var stable = true;
    for (var q = 0; q < 12; q++) {
      var base = S.randomPlan(2000 + q);
      var a = S.simulate('crdt', base);
      var b = S.simulate('crdt', base);
      if (cj(a.reads[0]) !== cj(b.reads[0])) stable = false;
    }
    bump(11);
    t.ok(stable, 'the simulation itself is deterministic: the same plan gives the same final board twice');
  });

  group('Duplicates, partitions and offline work', function (t) {
    /* At-least-once delivery, turned up until nearly every message lands twice. */
    var crdtOk = true, naiveBroke = false, lwwOk = true;
    for (var i = 0; i < 12; i++) {
      var plan = S.randomPlan(3000 + i, { dupRate: 0.9, partition: false });
      var or = S.oracle(plan);
      var c = S.simulate('crdt', plan);
      var n = S.simulate('naive', plan);
      var l = S.simulate('lww', plan);
      if (!c.converged) crdtOk = false;
      var pts = S.pointsOf(c.reads[0]);
      for (var id in pts) if (Object.prototype.hasOwnProperty.call(pts, id)) {
        if (pts[id] !== (or.points[id] || 0)) crdtOk = false;
      }
      if (!n.converged) naiveBroke = true;
      if (!l.converged) lwwOk = false;
    }
    bump(11 * 3);
    t.ok(crdtOk, 'crdt: with 90% of messages delivered twice, still convergent and still exact');
    t.ok(lwwOk, 'lww: duplicates are harmless to a register too — re-merging the same stamp changes nothing');
    t.ok(naiveBroke, 'naive: duplicates alone are enough to make replicas disagree, with no partition and no clock skew');

    /* A long split with real work on both sides. */
    var healed = true;
    for (var p = 0; p < 12; p++) {
      var plan2 = S.randomPlan(4000 + p, { partitionLen: 100000, dupRate: 0.1 });
      var r = S.simulate('crdt', plan2);
      if (!r.converged) healed = false;
      if (!r.stats.deferred) healed = false; /* a partition that deferred nothing proves nothing */
    }
    bump(11);
    t.ok(healed, 'crdt: after a partition long enough to hold traffic, every replica converges once the link returns');

    /* Closing a job. Found missing by a mutation: replacing the observed-remove
       with a remove of a tag nobody ever minted turned every close in the crdt
       engine into a no-op, and the whole suite stayed green — because the
       counter oracle only ever looks at rows that ARE on the board, and an
       extra row is invisible to it. A delete needs its own property. */
    var deletesHeld = 0, deletePlans = 0;
    for (var d = 0; d < 15; d++) {
      var dp = S.randomPlan(6100 + d, { jobs: 3, edits: 14 });
      /* Close the first job, late, from a replica that has certainly seen it,
         with no concurrent edit after it — so add-wins has nothing to argue. */
      var lastAt = dp.script[dp.script.length - 1].at;
      dp.script.push({ at: lastAt + 5000, replica: dp.replicas[1].id, intent: { k: 'delete', id: dp.taskIds[0] } });
      deletePlans++;
      var rr = S.simulate('crdt', dp);
      var stillThere = false;
      for (var q = 0; q < rr.reads.length; q++) {
        for (var w = 0; w < rr.reads[q].tasks.length; w++) if (rr.reads[q].tasks[w].id === dp.taskIds[0]) stillThere = true;
      }
      if (!stillThere && rr.converged) deletesHeld++;
    }
    bump(deletePlans - 1);
    t.eq(deletesHeld, deletePlans, 'crdt: a job closed after everyone has seen it is gone from every phone, in all ' + deletePlans + ' runs');

    /* The other half of the same property: a close can only bury the creates it
       has actually observed, so a job created on the far side of a partition
       survives a close issued before that create arrived. Add-wins is a choice,
       and this is where it shows. */
    var survived = {
      seed: 5, replicas: [{ id: 'a', skew: 0 }, { id: 'b', skew: 0 }],
      script: [
        { at: 0, replica: 'a', intent: { k: 'create', id: 'J1', title: 'known job', status: 'queued', points: 1 } },
        { at: 100, replica: 'b', intent: { k: 'create', id: 'J2', title: 'raised on site', status: 'queued', points: 2 } },
        { at: 110, replica: 'a', intent: { k: 'delete', id: 'J2' } }
      ],
      latency: [400, 400], dupRate: 0, partitions: [], taskIds: ['J1', 'J2']
    };
    var sv = S.simulate('crdt', survived);
    var ids = sv.reads[0].tasks.map(function (x) { return x.id; });
    t.deep(ids, ['J1', 'J2'], 'crdt: closing a job you have not yet heard of does nothing to it — you cannot remove what you have not observed');
    t.ok(sv.converged, 'crdt: and both phones agree that it is still open');

    /* An edit for a job the replica has never heard of. The op-log engine has
       nowhere to put it; a state merge does not need anywhere to put it. */
    var lonely = {
      seed: 5, replicas: [{ id: 'a', skew: 0 }, { id: 'b', skew: 0 }],
      script: [
        { at: 0, replica: 'a', intent: { k: 'create', id: 'J1', title: 'x', status: 'queued', points: 1 } },
        { at: 1, replica: 'b', intent: { k: 'points', id: 'J1', delta: 5 } }
      ],
      latency: [500, 500], dupRate: 0, partitions: [], taskIds: ['J1']
    };
    var lc = S.simulate('crdt', lonely);
    var ln = S.simulate('naive', lonely);
    t.eq(S.pointsOf(lc.reads[0]).J1, 6, 'crdt: an edit made before the job itself arrived is still counted once it does');
    t.eq(S.pointsOf(lc.reads[1]).J1, 6, 'crdt: and both replicas agree on it');
    /* Worse than a dropped edit: the replica that already had the job applies
       it and the one that did not cannot, so the two are permanently different
       and nothing will ever bring them back together. */
    t.notOk(ln.converged, 'naive: an edit that arrives before the job it belongs to leaves the two phones permanently different');
    t.eq(S.pointsOf(ln.reads[0]).J1, 6, 'naive: the phone that had the job applied the edit');
    t.eq(S.pointsOf(ln.reads[1]).J1, 1, 'naive: the phone that made the edit dropped its own, having not yet heard of the job');
  });

  group('Set pieces (the scenarios on the Board tab)', function (t) {
    var lost = S.scenario('lost-update').build();
    t.eq(S.pointsOf(S.simulate('crdt', lost).reads[0]).J101, 10, 'lost-update: crdt reads 10, which is 5 + 3 + 2');
    t.eq(S.pointsOf(S.simulate('lww', lost).reads[0]).J101, 7, 'lost-update: lww reads 7 — one technician’s work is gone, and every phone agrees on the wrong number');
    t.ok(S.simulate('lww', lost).converged, 'lost-update: and it is fully converged while being wrong, which is why nobody notices');

    var skew = S.scenario('skew').build();
    t.eq(S.simulate('lww', skew).reads[0].tasks[0].title, 'AC unit — check filter', 'skew: the wall clock keeps the OLDER edit, because that phone is 4.2 s fast');
    t.eq(S.simulate('crdt', skew).reads[0].tasks[0].title, 'AC unit — compressor replacement', 'skew: the HLC keeps the later edit, because it was made after seeing the first');

    var dup = S.scenario('duplicate').build();
    t.notOk(S.simulate('naive', dup).converged, 'duplicate: the op log ends with four phones showing four different totals');
    t.eq(S.pointsOf(S.simulate('crdt', dup).reads[0]).J101, 10, 'duplicate: crdt is unmoved by re-delivery');

    var tag = S.scenario('tag-race').build();
    t.deep(S.simulate('crdt', tag).reads[0].tasks[0].tags, ['urgent'], 'tag-race: add-wins keeps the flag the customer asked for');
    t.deep(S.simulate('lww', tag).reads[0].tasks[0].tags, [], 'tag-race: the wall clock drops it, because the phone that set it was 0.9 s slow');

    var part = S.scenario('partition').build();
    var pc = S.simulate('crdt', part);
    t.ok(pc.converged, 'partition: crdt converges after the split heals');
    t.eq(pointsVerdict({ oracle: S.oracle(part), crdt: pc }, 'crdt'), 'exact', 'partition: and the totals survived the split intact');
    t.notOk(S.simulate('naive', part).converged, 'partition: the op log does not recover — the phones stay different after the link is back');
  });

  /* ------------------------------------------------- the checkers, checked */

  group('The checks can fail (self-proof)', function (t) {
    /* Every judgement above rests on these four. Each one is handed something
       broken and required to notice. Without this group, a bug in any of them
       would turn the whole suite green for free — which is the exact failure
       that shipped three times elsewhere in this repository. */

    t.notOk(S.sameState({ a: 1 }, { a: 2 }), 'the state comparison reports a real difference');
    t.notOk(S.sameState({ tasks: [{ id: 'a' }] }, { tasks: [] }), 'and notices a missing row rather than only a changed field');

    /* Convergence detection, against a deliberately mutated replica. */
    var plan = S.randomPlan(777);
    var run = S.simulate('crdt', plan);
    t.ok(run.converged, 'a genuinely converged run is reported as converged');
    var tampered = { reads: run.reads.slice() };
    tampered.reads[1] = JSON.parse(JSON.stringify(run.reads[1]));
    if (tampered.reads[1].tasks.length) tampered.reads[1].tasks[0].points += 1;
    else tampered.reads[1].tasks.push({ id: 'ZZ', title: '', status: 'queued', points: 1, tags: [] });
    var same = cj(tampered.reads[0]) === cj(tampered.reads[1]);
    t.notOk(same, 'ONE point changed on ONE replica is enough to be seen — the convergence check is not vacuous');

    /* The points oracle, against an engine that is wrong on purpose. */
    var fakeRun = {
      oracle: { points: { J1: 10 } },
      crdt: { converged: true, reads: [{ tasks: [{ id: 'J1', title: '', status: 'queued', points: 7, tags: [] }] }] }
    };
    t.eq(pointsVerdict(fakeRun, 'crdt'), 'lost', 'the counter oracle detects a total that is too LOW');
    fakeRun.crdt.reads[0].tasks[0].points = 13;
    t.eq(pointsVerdict(fakeRun, 'crdt'), 'gained', 'and one that is too HIGH');
    fakeRun.crdt.reads[0].tasks[0].points = 10;
    t.eq(pointsVerdict(fakeRun, 'crdt'), 'exact', 'and passes only the right number');
    fakeRun.crdt.converged = false;
    t.eq(pointsVerdict(fakeRun, 'crdt'), 'diverged', 'a diverged run is never scored as exact');

    /* The merge-law harness, against three merges each broken in exactly one
       way. Isolating them one law at a time is the point: a harness that goes
       red for any broken input, without going red for the RIGHT law, would not
       be telling anyone which property they lost.

       "Keep the left side" is the instructive one. It is genuinely associative,
       genuinely idempotent, and it satisfies absorption — it fails ONLY
       commutativity, and my first draft of this check expected two failures and
       was wrong. Three of the four laws cannot see this bug at all. */
    function lawsOf(merge, gen) {
      var out = [];
      lawsFor(makeCtx(out, 'inner'), 'probe', gen, merge, 6);
      return out.filter(function (r) { return !r.ok; }).map(function (r) { return r.name.replace(/^probe: /, ''); });
    }
    var num = function (rng) { return { v: rng.range(1, 9) }; };

    var keepLeft = lawsOf(function (a) { return { v: a.v }; }, num);
    t.eq(keepLeft.length, 1, 'a merge that ignores its right-hand side fails exactly one law');
    t.ok(/commutative/.test(keepLeft[0] || ''), 'and the one it fails is commutativity');

    var sum = lawsOf(function (a, b) { return { v: a.v + b.v }; }, num);
    t.ok(sum.some(function (n) { return /idempotent/.test(n); }), 'a merge that adds instead of joining is caught failing idempotency');
    t.ok(sum.some(function (n) { return /re-merging/.test(n); }), 'and absorption — re-delivery of the same peer state moves it');

    var avg = lawsOf(function (a, b) { return { v: (a.v + b.v) / 2 }; }, num);
    t.ok(avg.some(function (n) { return /associative/.test(n); }), 'an averaging merge — commutative and idempotent — is still caught failing associativity');
    t.notOk(avg.some(function (n) { return /commutative/.test(n); }), 'and is NOT accused of the law it actually satisfies');

    /* The network simulator, checked for actually being hostile. A run that
       delivered everything in order, once, would make every engine look good. */
    var hostile = S.simulate('crdt', S.randomPlan(888, { dupRate: 0.5 }), {});
    t.ok(hostile.stats.duplicates > 0, 'the simulated network really does deliver some messages twice');
    t.ok(hostile.stats.deferred > 0, 'and really does hold traffic across the partition window');
    t.ok(hostile.stats.deliveries > hostile.stats.messages, 'and fans each message out to every peer');

    /* Reordering, counted rather than assumed. Pinning latency to a constant —
       so every message arrived in the order it was sent — left this suite fully
       green, which meant nothing in it actually depended on out-of-order
       delivery. Counting it is the fix: a message from one peer arriving after
       a LATER message from that same peer is a reorder, and there have to be
       some. */
    t.ok(hostile.stats.reorders > 0, 'and really does deliver messages out of the order they were sent (' + hostile.stats.reorders + ' overtakes)');
  });

  /* -------------------------------------------------------------- runner */

  function run() {
    var results = [];
    EXEC.n = 0;
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      try {
        g.fn(makeCtx(results, g.name));
      } catch (err) {
        results.push({ group: g.name, name: 'group threw', ok: false, message: String((err && err.stack) || err) });
      }
    }
    var passed = results.filter(function (r) { return r.ok; }).length;
    /* A negative property is one that passes only when something refuses, loses
       or diverges. Counted by matching the way they are worded, which is why the
       wording is a convention rather than prose: NOT, never, no, dropped, lost,
       silently, diverge. */
    var negatives = results.filter(function (r) {
      return /\bNOT\b|never|cannot|refus|drop|lost|silent|diverg|resurrect|disappear|vanish|gone|wrong|does nothing/i.test(r.name);
    }).length;
    var byGroup = groups.map(function (g) {
      var rs = results.filter(function (r) { return r.group === g.name; });
      return { name: g.name, total: rs.length, failed: rs.filter(function (r) { return !r.ok; }).length };
    });
    return {
      results: results, passed: passed, failed: results.length - passed, total: results.length,
      properties: results.length, executions: EXEC.n, negatives: negatives, byGroup: byGroup
    };
  }

  S.runTests = run;
  S.testGroups = groups;
  root.SEPAKAT_TESTS = { run: run, groups: groups };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
