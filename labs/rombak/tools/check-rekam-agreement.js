/*!
 * Rombak — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Rombak — tools/check-rekam-agreement.js
 *
 *     node labs/rombak/tools/check-rekam-agreement.js
 *
 * NODE ONLY, RUN BY HAND. Not part of `npm test`, and deliberately not loaded by
 * the lab page.
 *
 * WHAT IT IS FOR. `labs/rombak/domain.js` and `labs/rekam/audit.js` are two
 * independent implementations of the same canonical-JSON encoding and the same
 * SHA-256, written months apart for two different labs that describe the same
 * clinic. `tests.js` pins six input vectors, their six canonical strings and
 * their six digests as LITERALS and asserts that rombak produces them. That is
 * a frozen snapshot. This script is the other half: it loads rekam's file and
 * asserts that rekam produces them too.
 *
 * WHY IT IS NOT IN THE PAGE. Loading `../rekam/audit.js` from the lab page would
 * put a second lab's load-time code inside a page whose CI gate counts any
 * `pageerror` as a broken page and exits 1 — with every assertion green. The
 * cost of keeping it out is stated plainly in the README rather than hidden:
 * THE AGREEMENT WILL DRIFT SILENTLY IF labs/rekam/audit.js CHANGES AND NOBODY
 * RUNS THIS. That is the honest description of what a frozen snapshot buys.
 *
 * It also re-reads tests.js as TEXT and checks that the six digests it asserts
 * against are the six digests below, so the two files cannot drift apart either.
 */
(function (root) {
  'use strict';

  var NS = {};

  /* The six §6.5 vectors. The INPUTS are here; the canonical strings and digests
     are what both implementations have to produce from them. */
  NS.VECTORS = [
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
    { id: 'commitment-shape', commitment: true, value: {
        seq: 7, at: '2026-09-09T09:14:00', actorId: 'stf-01', actorName: 'dr. Rina Halim',
        actorRole: 'dokter', action: 'encounter.sign', entity: 'encounter',
        entityId: 'E-20260909-0003', summary: 'Catatan ditandatangani',
        detail: '{"codes":["J06.9"],"visit":"V-20260909-0003"}',
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000'
      },
      canonical: '{"action":"encounter.sign","actorId":"stf-01","actorName":"dr. Rina Halim",' +
        '"actorRole":"dokter","at":"2026-09-09T09:14:00","detail":"{\\"codes\\":[\\"J06.9\\"],' +
        '\\"visit\\":\\"V-20260909-0003\\"}","entity":"encounter","entityId":"E-20260909-0003",' +
        '"prevHash":"0000000000000000000000000000000000000000000000000000000000000000","seq":7,' +
        '"summary":"Catatan ditandatangani"}',
      sha256: '6e3d2531069b56e3c92505c0d7950aedeab21caeda97540c50a4832bef1a4ef3' }
  ];

  /* Loading rekam's file needs a word of explanation: it has no
     `module.exports` line and closes with `})(typeof self !== 'undefined' ? self
     : this)`. Under node `this` at module scope IS module.exports, so requiring
     it yields an object carrying REKAM. Older node or a different wrapper would
     put it on the global instead, so both are looked at. */
  function loadRekam(path) {
    var mod = require(path);
    var R = (mod && mod.REKAM) || (typeof global !== 'undefined' && global.REKAM) || null;
    if (!R || !R.audit) throw new Error('could not find REKAM.audit in ' + path);
    return R.audit;
  }

  NS.check = function (opts) {
    opts = opts || {};
    var fs = require('fs');
    var path = require('path');
    var here = __dirname;
    var lab = path.join(here, '..');
    var repo = path.join(lab, '..', '..');

    var out = { lines: [], agree: 0, disagree: 0, notes: [], ok: false };
    function say(s) { out.lines.push(s); }

    var rombak = require(path.join(lab, 'domain.js'));
    var rekam = loadRekam(path.join(repo, 'labs', 'rekam', 'audit.js'));

    say('rombak  labs/rombak/domain.js');
    say('rekam   labs/rekam/audit.js');
    say('');

    var i, v, value, rc, rh, kc, kh, same;
    for (i = 0; i < NS.VECTORS.length; i++) {
      v = NS.VECTORS[i];
      /* The commitment vector is run through each implementation's OWN
         commitment(), because the shape is the interchange format and agreeing
         on it is the property. Everything else goes in as-is. */
      value = v.commitment ? v.value : v.value;
      rc = v.commitment ? rombak.canonical(rombak.commitment(value)) : rombak.canonical(value);
      rh = rombak.sha256(rc);
      kc = v.commitment ? rekam.canonical(rekam.commitment(value)) : rekam.canonical(value);
      kh = rekam.sha256Hex(kc);
      same = (rc === kc) && (rh === kh) && (rc === v.canonical) && (rh === v.sha256);
      if (same) out.agree++; else out.disagree++;
      say('[' + v.id + '] ' + (same ? 'AGREE' : 'DISAGREE'));
      say('  expected canonical : ' + v.canonical);
      say('  rombak canonical   : ' + rc + (rc === v.canonical ? '' : '   <-- not the frozen string'));
      say('  rekam  canonical   : ' + kc + (kc === v.canonical ? '' : '   <-- not the frozen string'));
      say('  expected sha256    : ' + v.sha256);
      say('  rombak sha256      : ' + rh + (rh === v.sha256 ? '' : '   <-- not the frozen digest'));
      say('  rekam  sha256      : ' + kh + (kh === v.sha256 ? '' : '   <-- not the frozen digest'));
      say('');
    }

    say('GENESIS  rombak ' + rombak.GENESIS);
    say('         rekam  ' + rekam.GENESIS + '   ' +
      (rombak.GENESIS === rekam.GENESIS ? 'same' : 'DIFFERENT'));
    if (rombak.GENESIS !== rekam.GENESIS) out.disagree++;

    /* One real difference between the two commitment() functions, found by
       reading them side by side. It does not touch any of the six vectors — all
       six carry a prevHash — but it is a divergence and this file is the only
       place anybody would ever see it, so it is reported rather than buried. */
    var rombakUndef = rombak.canonical(rombak.commitment({ seq: 0, at: 'x' }));
    var rekamUndef = rekam.canonical(rekam.commitment({ seq: 0, at: 'x' }));
    if (rombakUndef !== rekamUndef) {
      out.notes.push('NOTE, not a vector failure: with prevHash UNDEFINED the two commitment() ' +
        'functions differ. rombak maps undefined to null and emits the key; rekam passes undefined ' +
        'through and canonical() drops it.');
      out.notes.push('        rombak: ' + rombakUndef);
      out.notes.push('        rekam : ' + rekamUndef);
      out.notes.push('        Every entry in either lab carries prevHash (NULL is written explicitly ' +
        'for the genesis row), so no stored digest depends on this. It would matter to anyone hashing ' +
        'a partially built entry.');
    }

    /* The other half of the drift problem: tests.js must be asserting against
       these same six digests. Read as text, on purpose — requiring it would need
       every ROMBAK_* global and a booted sql.js. */
    var suite = fs.readFileSync(path.join(lab, 'tests.js'), 'utf8');
    var missing = [];
    for (i = 0; i < NS.VECTORS.length; i++) {
      if (suite.indexOf(NS.VECTORS[i].sha256) < 0) missing.push(NS.VECTORS[i].id);
    }
    say('');
    say('tests.js carries all six digests as literals: ' + (missing.length ? 'NO — missing ' + missing.join(', ') : 'yes'));
    if (missing.length) out.disagree++;

    out.ok = out.disagree === 0 && out.agree === NS.VECTORS.length;
    say('');
    say(out.agree + ' of ' + NS.VECTORS.length + ' vectors agree byte-for-byte between ' +
      'labs/rombak/domain.js and labs/rekam/audit.js');
    return out;
  };

  NS.main = function () {
    var out;
    try { out = NS.check(); }
    catch (e) {
      /* A failure to LOAD is not a disagreement, and saying so is the difference
         between "the two labs diverged" and "somebody moved a file". */
      process.stdout.write('check-rekam-agreement: could not run.\n  ' + (e && e.message || e) + '\n');
      process.exit(2);
      return;
    }
    process.stdout.write(out.lines.join('\n') + '\n');
    if (out.notes.length) process.stdout.write('\n' + out.notes.join('\n') + '\n');
    process.stdout.write('\n' + (out.ok
      ? 'AGREEMENT HOLDS. Re-run this after any change to labs/rekam/audit.js — nothing else will notice.\n'
      : 'AGREEMENT BROKEN. The two labs no longer produce the same digests; one of them moved.\n'));
    process.exit(out.ok ? 0 : 1);
  };

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) NS.main();

  root.ROMBAK_REKAM_CHECK = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ROMBAK_REKAM_CHECK;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
