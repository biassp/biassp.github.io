/*!
 * Sepakat — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sepakat - crdt.js
 * The replicated data types, plus the two broken types they exist to replace.
 *
 * Every type here is state-based: a value, and a merge that is commutative,
 * associative and idempotent. Those three laws are the entire reason a replica
 * can accept a message twice, out of order, or from a peer that has been offline
 * for a week, and still land on the same state as everyone else. They are not
 * assumed anywhere in this file — tests.js asserts all three for every type,
 * on random states, and asserts that the two deliberately-broken types FAIL
 * the law they break. A law nobody can fail is not a law.
 *
 * The broken pair is not a strawman. naiveSet is what a "sync" written in an
 * afternoon looks like, and twoPhaseSet is a real published type with a real
 * limitation, included because its limitation is the exact reason OR-Set has to
 * carry tags.
 */
(function (root) {
  'use strict';
  var S = root.SEPAKAT || {}; root.SEPAKAT = S;
  var stampCompare = S.stampCompare;
  var hlcCompare = S.hlcCompare;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function keys(o) { return Object.keys(o).sort(); }

  /* ============================================================ LWW register
   * One value, one stamp, higher stamp wins. Merge is a max over a total order,
   * so it satisfies all three laws — an LWW register genuinely is a CRDT.
   *
   * That is worth stating plainly because it is where the intuition goes wrong.
   * "Converges" and "keeps what people meant" are different properties. This
   * type has the first and not the second: when two replicas write concurrently
   * it converges by DISCARDING one of the writes, and nothing anywhere reports
   * that it happened. Every replica agrees; one person's work is gone.
   *
   * `cmp` is injected so the same register can be stamped by a wall clock (skew
   * decides the winner) or by an HLC (causality decides it). Same type, same
   * loss, different reason for who wins.
   */
  function lwwNew(value, stamp) { return { v: value, s: stamp }; }

  function lwwSet(reg, value, stamp, cmp) {
    return (cmp(stamp, reg.s) > 0) ? { v: value, s: stamp } : { v: reg.v, s: reg.s };
  }

  function lwwMerge(a, b, cmp) {
    var c = cmp(a.s, b.s);
    if (c > 0) return { v: a.v, s: a.s };
    if (c < 0) return { v: b.v, s: b.s };
    /* Equal stamps must mean equal values, or the register is not a lattice at
       all. Stamps carry the replica id, so two different replicas can never
       collide; the same replica reusing a stamp for a different value is a bug
       in the caller and is refused rather than silently resolved. */
    if (S.canonicalJson(a.v) !== S.canonicalJson(b.v)) {
      throw new Error('lwwMerge: same stamp, different values — stamps are not unique');
    }
    return { v: a.v, s: a.s };
  }

  var lwwWall = { set: function (r, v, s) { return lwwSet(r, v, s, stampCompare); },
                  merge: function (a, b) { return lwwMerge(a, b, stampCompare); } };
  var lwwHlc = { set: function (r, v, s) { return lwwSet(r, v, s, hlcCompare); },
                 merge: function (a, b) { return lwwMerge(a, b, hlcCompare); } };

  /* ============================================================== G-Counter
   * Per-replica grow-only totals, merged by max. The max is what makes a
   * duplicated message free: seeing "replica B is at 7" twice is still 7.
   */
  function gNew() { return {}; }

  function gAdd(c, id, n) {
    if (!(n >= 0)) throw new Error('gAdd: negative increment');
    var out = {};
    for (var k in c) if (has(c, k)) out[k] = c[k];
    out[id] = (out[id] || 0) + n;
    return out;
  }

  function gMerge(a, b) {
    var out = {}, k;
    for (k in a) if (has(a, k)) out[k] = a[k];
    for (k in b) if (has(b, k)) out[k] = Math.max(out[k] || 0, b[k]);
    return out;
  }

  function gValue(c) {
    var n = 0;
    for (var k in c) if (has(c, k)) n += c[k];
    return n;
  }

  /* ============================================================= PN-Counter
   * Two G-Counters. Decrements cannot be a subtraction from one grow-only map
   * without breaking the max, so they get their own map and the value is the
   * difference.
   */
  function pnNew() { return { p: {}, n: {} }; }

  function pnAdd(c, id, delta) {
    if (delta === 0) return { p: gMerge(c.p, {}), n: gMerge(c.n, {}) };
    return delta > 0
      ? { p: gAdd(c.p, id, delta), n: gMerge(c.n, {}) }
      : { p: gMerge(c.p, {}), n: gAdd(c.n, id, -delta) };
  }

  function pnMerge(a, b) { return { p: gMerge(a.p, b.p), n: gMerge(a.n, b.n) }; }
  function pnValue(c) { return gValue(c.p) - gValue(c.n); }

  /* ================================================================= OR-Set
   * Observed-remove set. An add mints a unique tag; a remove buries exactly the
   * tags the removing replica could see. An element is present when it has at
   * least one unburied tag.
   *
   * The tag is the whole idea. Without it a remove has to be expressed as "this
   * element is gone", which a concurrent add cannot argue with — so the add is
   * lost, or the remove is, depending on which arrives second. With it, a
   * concurrent add carries a tag the remover never observed, and survives on
   * purpose rather than by accident. Add-wins is a decision, and it is one the
   * type can actually keep.
   */
  function orNew() { return { adds: {}, tomb: {} }; }

  function orAdd(set, el, tag) {
    var out = orClone(set);
    if (!out.adds[el]) out.adds[el] = {};
    out.adds[el][tag] = 1;
    return out;
  }

  function orRemove(set, el) {
    var out = orClone(set);
    var tags = out.adds[el] || {};
    for (var t in tags) if (has(tags, t)) out.tomb[t] = 1;
    return out;
  }

  function orMerge(a, b) {
    var out = orClone(a), el, t;
    for (el in b.adds) if (has(b.adds, el)) {
      if (!out.adds[el]) out.adds[el] = {};
      for (t in b.adds[el]) if (has(b.adds[el], t)) out.adds[el][t] = 1;
    }
    for (t in b.tomb) if (has(b.tomb, t)) out.tomb[t] = 1;
    return out;
  }

  function orHas(set, el) {
    var tags = set.adds[el];
    if (!tags) return false;
    for (var t in tags) if (has(tags, t) && !set.tomb[t]) return true;
    return false;
  }

  function orValues(set) {
    var out = [];
    var els = keys(set.adds);
    for (var i = 0; i < els.length; i++) if (orHas(set, els[i])) out.push(els[i]);
    return out;
  }

  function orClone(set) {
    var out = { adds: {}, tomb: {} }, el, t;
    for (el in set.adds) if (has(set.adds, el)) {
      out.adds[el] = {};
      for (t in set.adds[el]) if (has(set.adds[el], t)) out.adds[el][t] = 1;
    }
    for (t in set.tomb) if (has(set.tomb, t)) out.tomb[t] = 1;
    return out;
  }

  /* ============================================================ 2P-Set (foil)
   * Add-once, remove-once, remove wins forever. It is a real CRDT — all three
   * laws hold — and it is still wrong for a tag list, because an element that
   * has ever been removed can never come back. Not a bug: the type has no way
   * to tell a re-add from a replay of the original add. That is precisely the
   * information an OR-Set tag carries.
   */
  function tpNew() { return { a: {}, r: {} }; }
  function tpAdd(s, el) { var o = tpClone(s); o.a[el] = 1; return o; }
  function tpRemove(s, el) { var o = tpClone(s); if (o.a[el]) o.r[el] = 1; return o; }
  function tpMerge(a, b) {
    var o = tpClone(a), k;
    for (k in b.a) if (has(b.a, k)) o.a[k] = 1;
    for (k in b.r) if (has(b.r, k)) o.r[k] = 1;
    return o;
  }
  function tpValues(s) { return keys(s.a).filter(function (k) { return !s.r[k]; }); }
  function tpClone(s) {
    var o = { a: {}, r: {} }, k;
    for (k in s.a) if (has(s.a, k)) o.a[k] = 1;
    for (k in s.r) if (has(s.r, k)) o.r[k] = 1;
    return o;
  }

  /* =========================================================== naive set (foil)
   * A plain list of members, merged by union. No tombstone of any kind, so a
   * remove is not represented in the state at all — it is just an absence, and
   * union treats an absence as "nothing to say". Merge with any peer that still
   * has the element brings it straight back.
   *
   * This is the single most common homemade sync bug, and the reason it survives
   * so long in production is that it is invisible in testing: every replica
   * converges, quickly, to a state that is wrong. tests.js asserts the
   * resurrection happens rather than describing it.
   */
  function nsNew() { return { m: {} }; }
  function nsAdd(s, el) { var o = nsClone(s); o.m[el] = 1; return o; }
  function nsRemove(s, el) { var o = nsClone(s); delete o.m[el]; return o; }
  function nsMerge(a, b) {
    var o = nsClone(a), k;
    for (k in b.m) if (has(b.m, k)) o.m[k] = 1;
    return o;
  }
  function nsValues(s) { return keys(s.m); }
  function nsClone(s) {
    var o = { m: {} }, k;
    for (k in s.m) if (has(s.m, k)) o.m[k] = 1;
    return o;
  }

  /* ==================================================================== RGA
   * Replicated growable array, as a causal tree, for character-level text.
   *
   * Every character is a node with an id and the id of the character it was
   * typed after. The text is a pre-order walk from the root, where siblings —
   * characters inserted after the SAME character by different replicas, i.e.
   * concurrent typing at one cursor position — are ordered by (counter desc,
   * replica id desc).
   *
   * Order is therefore a property of the node set, not of arrival order, which
   * is what lets merge be a plain union: two replicas holding the same nodes
   * read the same string no matter what route the nodes took to get there.
   * Deletion sets a flag and keeps the node, because a deleted character is
   * still somebody else's insertion point.
   *
   * What this does NOT claim to fix is interleaving: two replicas typing whole
   * words at the same position converge to one deterministic order, but that
   * order may alternate their characters. Every replica sees the same
   * alternation. tests.js asserts the convergence and the character
   * conservation, and states the interleaving rather than hiding it.
   */
  var RGA_ROOT = '0:0';

  function rgaNew() { return { nodes: { '0:0': { id: RGA_ROOT, p: null, ch: '', del: 1 } } }; }

  function rgaNodeId(counter, id) { return counter + ':' + id; }

  /* Sibling order. Higher counter first so the newest concurrent insert lands
     leftmost; replica id descending breaks a same-counter tie. Both halves are
     needed: without the id, two replicas at the same counter would sort
     differently depending on object key order. */
  function siblingCmp(a, b) {
    var ac = parseInt(a.id.split(':')[0], 10), bc = parseInt(b.id.split(':')[0], 10);
    if (ac !== bc) return bc - ac;
    var ar = a.id.split(':')[1], br = b.id.split(':')[1];
    return ar < br ? 1 : (ar > br ? -1 : 0);
  }

  function rgaInsert(rga, parentId, nodeId, ch) {
    if (!rga.nodes[parentId]) throw new Error('rgaInsert: unknown parent ' + parentId);
    if (rga.nodes[nodeId]) throw new Error('rgaInsert: duplicate node id ' + nodeId);
    var out = rgaClone(rga);
    out.nodes[nodeId] = { id: nodeId, p: parentId, ch: ch, del: 0 };
    return out;
  }

  function rgaDelete(rga, nodeId) {
    var out = rgaClone(rga);
    if (out.nodes[nodeId]) out.nodes[nodeId].del = 1;
    return out;
  }

  /* Union of nodes; a node deleted on either side is deleted. Both halves are
     idempotent and commutative, which is the whole merge. */
  function rgaMerge(a, b) {
    var out = rgaClone(a);
    for (var id in b.nodes) if (has(b.nodes, id)) {
      var n = b.nodes[id];
      if (!out.nodes[id]) out.nodes[id] = { id: n.id, p: n.p, ch: n.ch, del: n.del };
      else if (n.del) out.nodes[id].del = 1;
    }
    return out;
  }

  function rgaWalk(rga) {
    var children = {};
    var id, n;
    for (id in rga.nodes) if (has(rga.nodes, id)) {
      n = rga.nodes[id];
      if (n.p === null) continue;
      /* A node whose parent has not arrived cannot be placed. In this lab that
         cannot happen — merges are unions of whole states — but reading it as
         orphaned is still better than dropping it silently. */
      var p = has(rga.nodes, n.p) ? n.p : '__orphan__';
      (children[p] || (children[p] = [])).push(n);
    }
    for (var k in children) if (has(children, k)) children[k].sort(siblingCmp);

    var out = [];
    (function visit(nodeId) {
      var kids = children[nodeId] || [];
      for (var i = 0; i < kids.length; i++) {
        out.push(kids[i]);
        visit(kids[i].id);
      }
    })(RGA_ROOT);
    return out;
  }

  function rgaText(rga) {
    var seq = rgaWalk(rga), s = '';
    for (var i = 0; i < seq.length; i++) if (!seq[i].del) s += seq[i].ch;
    return s;
  }

  /* Visible characters only, with their ids — what the UI needs to know where a
     cursor position maps to in the tree. */
  function rgaVisible(rga) {
    return rgaWalk(rga).filter(function (n) { return !n.del; });
  }

  function rgaClone(rga) {
    var out = { nodes: {} };
    for (var id in rga.nodes) if (has(rga.nodes, id)) {
      var n = rga.nodes[id];
      out.nodes[id] = { id: n.id, p: n.p, ch: n.ch, del: n.del };
    }
    return out;
  }

  /* Typing helper: insert `text` at visible offset `pos`, minting ids from a
     per-replica counter. Returns the new state and the counter it reached. */
  function rgaTypeAt(rga, pos, text, replicaId, counter) {
    var vis = rgaVisible(rga);
    var parent = pos === 0 ? RGA_ROOT : vis[Math.min(pos, vis.length) - 1].id;
    var out = rga, c = counter;
    for (var i = 0; i < text.length; i++) {
      c++;
      var nid = rgaNodeId(c, replicaId);
      out = rgaInsert(out, parent, nid, text.charAt(i));
      parent = nid;
    }
    return { rga: out, counter: c };
  }

  function rgaDeleteRange(rga, pos, len) {
    var vis = rgaVisible(rga);
    var out = rga;
    for (var i = pos; i < Math.min(pos + len, vis.length); i++) out = rgaDelete(out, vis[i].id);
    return out;
  }

  S.crdt = {
    lwwNew: lwwNew, lwwSet: lwwSet, lwwMerge: lwwMerge, lwwWall: lwwWall, lwwHlc: lwwHlc,
    gNew: gNew, gAdd: gAdd, gMerge: gMerge, gValue: gValue,
    pnNew: pnNew, pnAdd: pnAdd, pnMerge: pnMerge, pnValue: pnValue,
    orNew: orNew, orAdd: orAdd, orRemove: orRemove, orMerge: orMerge, orHas: orHas,
    orValues: orValues, orClone: orClone,
    tpNew: tpNew, tpAdd: tpAdd, tpRemove: tpRemove, tpMerge: tpMerge, tpValues: tpValues,
    nsNew: nsNew, nsAdd: nsAdd, nsRemove: nsRemove, nsMerge: nsMerge, nsValues: nsValues,
    rgaNew: rgaNew, rgaInsert: rgaInsert, rgaDelete: rgaDelete, rgaMerge: rgaMerge,
    rgaText: rgaText, rgaVisible: rgaVisible, rgaWalk: rgaWalk, rgaClone: rgaClone,
    rgaTypeAt: rgaTypeAt, rgaDeleteRange: rgaDeleteRange, rgaNodeId: rgaNodeId,
    RGA_ROOT: RGA_ROOT
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
