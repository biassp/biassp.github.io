/*!
 * Sepakat — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sepakat - core.js
 * The primitives everything else is built on: a seeded PRNG, a canonical
 * serialiser, vector clocks and a hybrid logical clock.
 *
 * Two of these are load-bearing in a way that is easy to miss.
 *
 * canonicalJson is the ONLY thing that decides whether two replicas "agree".
 * Every convergence claim in this lab is that string being equal, so a
 * serialiser that happened to sort keys for one shape and not another would
 * make the entire suite green for the wrong reason. It sorts object keys at
 * every depth, refuses NaN/Infinity/undefined rather than emitting null for
 * them, and has its own assertions in tests.js — including one that feeds it
 * two states that genuinely differ and requires it to say so.
 *
 * The hybrid logical clock is the honest middle of the three merge strategies
 * this lab compares. It removes clock skew as the thing that decides a winner,
 * which is worth doing — but it does NOT make a last-writer-wins register stop
 * losing the loser's write. That distinction is the whole point of the lab and
 * the code keeps it visible: hlc solves ordering, not intent.
 */
(function (root) {
  'use strict';
  var S = root.SEPAKAT || {}; root.SEPAKAT = S;

  /* ------------------------------------------------------------------ PRNG */

  /* mulberry32. Chosen because it is 8 lines, has no state beyond one uint32,
     and gives the same stream on every engine — which is what makes a "random"
     schedule in this lab reproducible from a seed a visitor can type in. */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.int = function (n) { return Math.floor(next() * n); };
    next.range = function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); };
    next.pick = function (arr) { return arr[Math.floor(next() * arr.length)]; };
    next.bool = function (p) { return next() < p; };
    /* Fisher-Yates, in place, so a shuffled delivery order is reproducible too. */
    next.shuffle = function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(next() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    };
    return next;
  }

  /* ---------------------------------------------------------- canonical JSON */

  function canonicalJson(v) {
    if (v === null) return 'null';
    var t = typeof v;
    if (t === 'number') {
      if (!isFinite(v)) throw new Error('canonicalJson: non-finite number ' + String(v));
      /* -0 and 0 are === but serialise differently through String(), and a
         counter that reached zero by subtraction must not read as "different"
         from one that never moved. */
      return v === 0 ? '0' : JSON.stringify(v);
    }
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return JSON.stringify(v);
    if (t === 'undefined') throw new Error('canonicalJson: undefined is not representable');
    if (t === 'function') throw new Error('canonicalJson: function is not representable');
    if (Array.isArray(v)) {
      var parts = [];
      for (var i = 0; i < v.length; i++) parts.push(canonicalJson(v[i]));
      return '[' + parts.join(',') + ']';
    }
    var keys = Object.keys(v).sort();
    var out = [];
    for (var k = 0; k < keys.length; k++) {
      var val = v[keys[k]];
      if (val === undefined) continue; /* absent and undefined are the same state */
      out.push(JSON.stringify(keys[k]) + ':' + canonicalJson(val));
    }
    return '{' + out.join(',') + '}';
  }

  function sameState(a, b) { return canonicalJson(a) === canonicalJson(b); }

  /* FNV-1a over the canonical form. Only ever used as a short label in the UI —
     no equality decision anywhere in this lab is made on a hash. */
  function shortHash(v) {
    var s = typeof v === 'string' ? v : canonicalJson(v);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ---------------------------------------------------------- vector clocks */

  function vcNew() { return {}; }

  function vcInc(vc, id) {
    var out = {};
    for (var k in vc) if (has(vc, k)) out[k] = vc[k];
    out[id] = (out[id] || 0) + 1;
    return out;
  }

  function vcMerge(a, b) {
    var out = {};
    var k;
    for (k in a) if (has(a, k)) out[k] = a[k];
    for (k in b) if (has(b, k)) out[k] = Math.max(out[k] || 0, b[k]);
    return out;
  }

  /* a covers b when every entry of b is matched or exceeded by a. This is the
     "I have seen everything you had seen" test the causal buffer runs on. */
  function vcCovers(a, b) {
    for (var k in b) if (has(b, k)) {
      if ((a[k] || 0) < b[k]) return false;
    }
    return true;
  }

  function vcCompare(a, b) {
    var ab = vcCovers(a, b);
    var ba = vcCovers(b, a);
    if (ab && ba) return 'equal';
    if (ab) return 'after';
    if (ba) return 'before';
    return 'concurrent';
  }

  function vcSum(vc) {
    var n = 0;
    for (var k in vc) if (has(vc, k)) n += vc[k];
    return n;
  }

  /* --------------------------------------------------- hybrid logical clock */

  /* {wall, count, id}. wall never runs backwards, count breaks ties within the
     same millisecond, id makes the order total across replicas. */
  function hlcNew(id) { return { wall: 0, count: 0, id: id }; }

  function hlcLocal(state, physical) {
    var w = Math.max(state.wall, physical);
    var c = (w === state.wall) ? state.count + 1 : 0;
    return { wall: w, count: c, id: state.id };
  }

  function hlcReceive(state, remote, physical) {
    var w = Math.max(state.wall, remote.wall, physical);
    var c;
    if (w === state.wall && w === remote.wall) c = Math.max(state.count, remote.count) + 1;
    else if (w === state.wall) c = state.count + 1;
    else if (w === remote.wall) c = remote.count + 1;
    else c = 0;
    return { wall: w, count: c, id: state.id };
  }

  function hlcCompare(a, b) {
    if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
    if (a.count !== b.count) return a.count < b.count ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  }

  function hlcString(h) { return h.wall + '.' + h.count + '@' + h.id; }

  /* ---------------------------------------------------------- wall stamps */

  /* What a naive last-writer-wins register uses: the device's own clock, skew
     and all, with the replica id only as a tie-break. Deliberately the same
     shape as an HLC comparison so the two registers differ in exactly one
     thing — where the number came from. */
  function stampCompare(a, b) {
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  S.rng = rng;
  S.canonicalJson = canonicalJson;
  S.sameState = sameState;
  S.shortHash = shortHash;
  S.clone = clone;
  S.vcNew = vcNew;
  S.vcInc = vcInc;
  S.vcMerge = vcMerge;
  S.vcCovers = vcCovers;
  S.vcCompare = vcCompare;
  S.vcSum = vcSum;
  S.hlcNew = hlcNew;
  S.hlcLocal = hlcLocal;
  S.hlcReceive = hlcReceive;
  S.hlcCompare = hlcCompare;
  S.hlcString = hlcString;
  S.stampCompare = stampCompare;

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
