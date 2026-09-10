/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — fixture.js
 * The async→sync boundary, and the single most important structural decision in
 * this lab.
 *
 * build(subtle) resolves to a plain object in which EVERY leaf is a string, a
 * number, a boolean, null, a plain array or a plain object. Tokens are strings.
 * Signatures are hex. Keys are JWK JSON text. Verdicts are booleans. Refusals
 * are this lab's own codes. There is no CryptoKey anywhere in it, no
 * ArrayBuffer, no TypedArray, no Error and no Promise.
 *
 * Three things follow, and each of them is worth the file on its own.
 *
 *   1. The whole assertion suite becomes SYNCHRONOUS over a settled value. No
 *      assertion helper is ever applied to a promise, and no group can leave a
 *      fire-and-forget crypto call behind — an unhandled rejection is reported
 *      as a page error and the CI runner exits 1 on one of those with every
 *      assertion green. Reproduced in this repository before this file existed.
 *
 *   2. The silent-corruption hazard becomes impossible by construction rather
 *      than watched for. Playwright's page.evaluate does NOT throw on a value
 *      it cannot clone. Measured, on the exact CI route: a CryptoKey arrives as
 *      {}, an ArrayBuffer arrives as {}, an Error arrives as {name:"Error"}. A
 *      deep-equality assertion comparing two empty objects passes forever, so a
 *      suite carrying a key object reaches CI green and meaningless. Nothing
 *      here can be that value. The plainness walk at the bottom re-checks it
 *      anyway and reports offenders as data, because a rule that is merely
 *      obeyed is not a rule that is checked.
 *
 *   3. Everything expensive happens exactly once. The whole build is single-
 *      digit milliseconds in this repository's Chromium, which is why this lab
 *      ships no worker: the database lab next door needed one because its suite
 *      was a twenty-three-second frozen page, and shipping one here for
 *      symmetry would be cargo cult.
 *
 * ======================= WHAT THIS FILE MAY REACH FOR =======================
 *
 * `subtle`, and nothing else. No global crypto, no clock, no storage, no DOM.
 * `now` is an injected constant rather than a wall-clock reading, because this
 * suite runs in CI on somebody else's hardware at an hour nobody chose, and a
 * claim check pinned to the wall clock is a test that fails on a Tuesday. The
 * greps in the build spec enforce that by finding no clock call in this file at
 * all, so neither name appears here even inside a comment.
 *
 * The HS256 demo secret comes from subtle.generateKey rather than from
 * crypto.getRandomValues for exactly that reason — reaching for the global
 * would be the only line in this file that needed one. A caller that wants the
 * page's own getRandomValues secret passes it in as opts.hsSecretB64u, and the
 * provenance field records which of the two actually happened, so the label on
 * screen is never a sentence somebody hoped was true.
 *
 * ====================== WHAT THIS FILE DELEGATES, AND WHY ===================
 *
 * Forged tokens are built by the forger, and re-verification by the second
 * route is done by the firewall. Both arrive as optional globals resolved at
 * BUILD time, not at load time. This file does not grow its own copy of either:
 * a fixture that could forge its own tokens would be a second forger nobody
 * greps, and a fixture that could re-verify its own answers would be the exact
 * one-route proof this lab exists to argue against. Where a delegate is absent
 * the section records { pending: <the name it wanted> } and stays plain data.
 */
(function (root) {
  'use strict';

  var B = root.SAHIH_BYTES;
  var V = root.SAHIH_VECTORS;
  var J = root.SAHIH_JOSE;
  if (!B) throw new Error('sahih/fixture.js: SAHIH_BYTES must load first');
  if (!V) throw new Error('sahih/fixture.js: SAHIH_VECTORS must load first');
  if (!J) throw new Error('sahih/fixture.js: SAHIH_JOSE must load first');

  var NS = {};

  /* ------------------------------------------------- the injected constants */

  /* The endpoint's clock, as a number this repository chose. Every refusal
     string in the build spec is quoted against it, so moving it moves the
     documentation too. On the Claims tab a slider drives this number and the
     rows change colour; a table that is really a static image cannot do that. */
  var NOW = 1789025165;

  var META = {
    alg: 'ES256',
    kid: 'k_FIKTIF_es',
    iss: 'https://sahih.invalid',
    aud: 'sahih-toy',
    now: NOW,
    maxLifetimeSec: 900,
    skewSec: 0,
    revokedJti: 'jti_FIKTIF_a3f1',
    /* RFC 2606 reserves .invalid, so the issuer this page names is structurally
       incapable of existing. The issuer enforces that rather than promising it. */
    issRule: 'iss must end in .invalid (RFC 2606 reserved)',
    subRule: 'sub must begin u_FIKTIF_'
  };

  function basePayload() {
    return {
      sub: 'u_FIKTIF_1042',
      role: 'member',
      iss: META.iss,
      aud: META.aud,
      iat: NOW - 60,
      exp: NOW + 600,
      jti: META.revokedJti
    };
  }

  function expectation(over) {
    var x = {
      alg: META.alg, jwk: null, kid: META.kid, iss: META.iss, aud: META.aud,
      now: META.now, maxLifetimeSec: META.maxLifetimeSec, skewSec: META.skewSec,
      denylist: []
    }, k;
    if (over) for (k in over) if (Object.prototype.hasOwnProperty.call(over, k)) x[k] = over[k];
    return x;
  }

  /* ------------------------------------------------------------- plumbing */

  function text(o) { return JSON.stringify(o); }

  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /* A verdict, flattened. The checklist rows keep their name, outcome, code and
     what they looked at; nothing else survives the crossing. */
  function flatStrict(r) {
    var out = { ok: r.ok, code: r.code, reason: r.reason, failedAt: r.failedAt, checks: [] }, i, c;
    for (i = 0; i < r.checks.length; i++) {
      c = r.checks[i];
      out.checks.push({
        name: c.name, ok: c.ok, reached: c.reached, skipped: !!c.skipped,
        code: c.code, saw: c.saw, errName: c.errName || null
      });
    }
    out.checksLength = out.checks.length;
    out.claims = r.claims ? copy(r.claims) : null;
    out.header = r.header ? copy(r.header) : null;
    return out;
  }

  function flatNaive(r) {
    return {
      ok: r.ok, why: r.why, roleSeen: r.roleSeen || null,
      errName: r.errName || null,
      claims: r.claims ? copy(r.claims) : null
    };
  }

  function dissect(token) {
    var p = String(token).split('.'), sig = null;
    try { sig = B.b64uDecodeStrict(p[2]); } catch (e) { sig = null; }
    return {
      token: token,
      headerSeg: p[0], payloadSeg: p[1], sigSeg: p[2],
      segLens: [p[0].length, p[1].length, p[2].length],
      signingInput: p[0] + '.' + p[1],
      signingInputBytes: B.utf8Encode(p[0] + '.' + p[1]).length,
      sigHex: sig ? B.hex(sig) : null,
      sigBytes: sig ? sig.length : null
    };
  }

  /* Every probe below ends here. An error becomes a NAME and a message, and the
     message is carried as observed data only — a browser release must not be
     able to turn this suite red for a reason that has nothing to do with this
     code, so nothing asserts wording. */
  function observed(id, call) {
    return function (e) {
      return {
        id: id, call: call, threw: true,
        name: e && e.name ? String(e.name) : 'Error',
        message: e && e.message ? String(e.message) : ''
      };
    };
  }

  function noThrewRow(id, call, note) {
    return { id: id, call: call, threw: false, name: null, message: note || '' };
  }

  /* ------------------------------------------------------------- the keys */

  function buildKeys(subtle, opts) {
    var out = {
      es: {
        kid: META.kid, alg: 'ES256',
        provenance: 'published', provenanceSource: V.JWS_A3.rfc + ' ' + V.JWS_A3.section,
        provenanceYear: V.JWS_A3.published
      },
      rs: {
        kid: 'k_FIKTIF_rs', alg: 'RS256',
        provenance: 'published', provenanceSource: V.JWS_A2.rfc + ' ' + V.JWS_A2.section,
        provenanceYear: V.JWS_A2.published
      },
      hs: {
        kid: 'k_FIKTIF_hs', alg: 'HS256',
        provenance: 'live', provenanceSource: null, provenanceYear: null
      }
    };

    var esPriv = copy(V.JWS_A3.jwk); esPriv.kid = out.es.kid;
    var esPub = copy(V.JWS_A3.jwkPublic); esPub.kid = out.es.kid;
    var rsPriv = copy(V.JWS_A2.jwk); rsPriv.kid = out.rs.kid;
    var rsPub = copy(V.JWS_A2.jwkPublic); rsPub.kid = out.rs.kid;

    out.es.privJwkText = text(esPriv);
    out.es.pubJwkText = text(esPub);
    out.rs.privJwkText = text(rsPriv);
    out.rs.pubJwkText = text(rsPub);
    /* The private JWKs carry a d member and are the input to this lab's own
       E_PRIVATE_KEY rule; they are published test keys from 2015 and sign
       nothing that exists. No PEM block appears anywhere in this repository. */
    out.es.privHasD = true;
    out.rs.privHasD = true;

    if (opts && opts.hsSecretB64u) {
      out.hs.secretB64u = String(opts.hsSecretB64u);
      out.hs.provenanceSource = 'crypto.getRandomValues';
      return Promise.resolve(finishHs(out));
    }

    /* subtle.generateKey, not the global crypto, because subtle is this file's
       entire input surface and one reach for a global would end that. 256 bits,
       which is the only property of this secret any assertion depends on. */
    return subtle.generateKey({ name: 'HMAC', hash: { name: 'SHA-256' }, length: 256 }, true, ['sign', 'verify'])
      .then(function (k) { return subtle.exportKey('jwk', k); })
      .then(function (jwk) {
        out.hs.secretB64u = jwk.k;
        out.hs.provenanceSource = 'crypto.subtle.generateKey';
        return finishHs(out);
      })
      ['catch'](function (e) {
        out.hs.error = e && e.name ? String(e.name) : 'Error';
        out.hs.secretB64u = null;
        return out;
      });
  }

  function finishHs(out) {
    var bytes = B.b64uDecodeStrict(out.hs.secretB64u);
    out.hs.secretBytes = bytes.length;
    out.hs.jwkText = text({ kty: 'oct', k: out.hs.secretB64u, kid: out.hs.kid });
    return out;
  }

  /* ------------------------------------------------ the legitimate token */

  function buildLegit(subtle, keys) {
    var esPriv = JSON.parse(keys.es.privJwkText);
    var esPub = JSON.parse(keys.es.pubJwkText);
    var payload = basePayload();

    return J.issue(subtle, esPriv, 'ES256', payload).then(function (token) {
      var d = dissect(token);
      d.payload = payload;
      d.headerJson = B.utf8Decode(B.b64uDecodeStrict(d.headerSeg));
      d.payloadJson = B.utf8Decode(B.b64uDecodeStrict(d.payloadSeg));
      return J.verifyStrict(subtle, token, expectation({ jwk: esPub }))
        .then(function (s) {
          d.strict = flatStrict(s);
          return J.verifyNaive(subtle, token, { 'k_FIKTIF_es': esPub, 'default': esPub });
        })
        .then(function (n) { d.naive = flatNaive(n); return d; });
    });
  }

  /* -------------- the naive verifier discriminates, before it is fooled -- */

  /* Five bad tokens refused by the vulnerable verifier, on the card, ABOVE the
     forgery it takes. Without this section every rung below is a fact about a
     broken function rather than about a plausible one. */
  function buildDiscriminate(subtle, keys, legit) {
    var esPriv = JSON.parse(keys.es.privJwkText);
    var esPub = JSON.parse(keys.es.pubJwkText);
    /* A DIFFERENT P-256 public key, not a key of a different TYPE. The row used
       to hold the RSA public JWK, and it refused — with errName DataError,
       because an RSA JWK cannot be imported through the ECDSA path at all. The
       verifier never reached crypto.subtle.verify, so the row said "signature"
       while proving nothing about signatures: measured by forcing verifyBytes
       to return true unconditionally, which turned every other row on this
       table red and left that one green. RFC 7515 A.3's published public key
       imports cleanly and simply does not match, which is the refusal the row
       claims. Key TYPE mismatches are pinned separately, on the capability
       table, where err.name is the subject and the claim is about the platform.
       It has to be GENERATED: this lab's own ES256 key is RFC 7515 A.3's, so
       reaching for A.3's published public half here would hand the ring the
       very key that signed the token and the row would go green. */
    var ring = { 'k_FIKTIF_es': esPub, 'default': esPub };
    var p = legit.token.split('.');
    var rows = [];

    var other = basePayload(); other.role = 'bendahara';
    var otherEcPub = null;

    return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      .then(function (pair) { return subtle.exportKey('jwk', pair.publicKey); })
      .then(function (jwk) {
        otherEcPub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
        return J.issue(subtle, esPriv, 'ES256', other);
      }).then(function (t2) {
      var cases = [
        ['the legitimate token', legit.token, ring, true],
        ['a corrupt signature', p[0] + '.' + p[1] + '.' + (p[2].charAt(0) === 'A' ? 'B' : 'A') + p[2].slice(1), ring, false],
        ['a truncated two-segment token', p[0] + '.' + p[1], ring, false],
        ['a header that is not JSON', B.b64uEncode(B.utf8Encode('this is not json')) + '.' + p[1] + '.' + p[2], ring, false],
        ['a signature over a different payload', p[0] + '.' + p[1] + '.' + t2.split('.')[2], ring, false],
        ['the wrong key in the keyring', legit.token, { 'k_FIKTIF_es': otherEcPub, 'default': otherEcPub }, false]
      ];
      var seq = Promise.resolve();
      cases.forEach(function (c) {
        seq = seq.then(function () {
          return J.verifyNaive(subtle, c[1], c[2]).then(function (r) {
            var f = flatNaive(r);
            f.label = c[0]; f.expectedAccepted = c[3]; f.token = c[1];
            rows.push(f);
          });
        });
      });
      return seq.then(function () { return rows; });
    });
  }

  /* ------------------------------------------------------ the byte layer */

  /* The twin count is computed here rather than hardcoded, from whatever
     segment is in the vector entry. There are always 63 substitutions to try;
     how many of them decode identically is decided by how many spare bits the
     tail carries, which is a property of base64 and not of the payload. */
  function twinScan(segment) {
    var alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var last = segment.charAt(segment.length - 1), head = segment.slice(0, -1);
    var orig = B.hex(B.b64uDecodeLoose(segment));
    var candidates = 0, collisions = [], i, c, t, d;
    for (i = 0; i < alpha.length; i++) {
      c = alpha.charAt(i);
      if (c === last) continue;
      candidates++;
      t = head + c;
      try { d = B.hex(B.b64uDecodeLoose(t)); } catch (e) { continue; }
      if (d === orig) collisions.push(t);
    }
    return { candidates: candidates, collisions: collisions };
  }

  function buildBytes(subtle, keys) {
    var tw = V.B64U_TWIN;
    var scan = twinScan(tw.segment);
    var out = {
      twin: {
        payloadJson: tw.payloadJson,
        segment: tw.segment,
        segLen: tw.segment.length,
        segLenMod4: tw.segment.length % 4,
        candidates: scan.candidates,
        collisions: scan.collisions.length,
        collisionSegments: scan.collisions,
        collisionTails: scan.collisions.map(function (s) { return s.slice(-6); }),
        publishedCollisions: tw.collisions,
        looseDecodesIdentically: true,
        strictRefusals: []
      },
      /* The same arithmetic at the other two residues, so the panel's claim is
         about base64 and not about one lucky string. */
      byMod4: [],
      refusals: [],
      looseAccepts: [],
      atobCollision: null,
      reserialised: null
    };

    var origHex = B.hex(B.b64uDecodeLoose(tw.segment)), i, r;
    for (i = 0; i < scan.collisions.length; i++) {
      out.twin.looseDecodesIdentically = out.twin.looseDecodesIdentically &&
        B.hex(B.b64uDecodeLoose(scan.collisions[i])) === origHex;
      r = strictRefusal(scan.collisions[i]);
      out.twin.strictRefusals.push({ segment: scan.collisions[i], code: r.code, reason: r.reason });
    }

    /* mod 0, 2 and 3 by construction: the same payload with a pad of a length
       that lands the segment on each residue. */
    [['0 mod 4', '{"sub":"u_FIKTIF_1042","role":"member","pad":""}'],
    ['2 mod 4', '{"sub":"u_FIKTIF_1042","role":"member","pad":"x"}'],
    ['3 mod 4', '{"sub":"u_FIKTIF_1042","role":"member","pad":"xx"}']].forEach(function (row) {
      var seg = B.b64uEncode(B.utf8Encode(row[1])), s = twinScan(seg);
      out.byMod4.push({
        label: row[0], payloadJson: row[1], segment: seg, segLen: seg.length,
        mod4: seg.length % 4, candidates: s.candidates, collisions: s.collisions.length
      });
    });

    /* Every input the strict decoder refuses, each with this lab's own code.
       The loose column beside it is what makes each refusal a decision rather
       than a platform fact. */
    [
      ['padding', 'QQ=='],
      ['one pad character', 'QQ='],
      ['a lone pad character', '='],
      ['the standard alphabet', 'a+b/'],
      ['a slash', 'ab/c'],
      ['an embedded space', 'ab cd'],
      ['an embedded newline', 'ab\ncd'],
      ['an embedded CRLF', 'ab\r\ncd'],
      ['an embedded tab', 'ab\tcd'],
      ['an embedded vertical tab', 'ab\u000bcd'],
      ['a lone A', 'A'],
      ['length 1 mod 4', 'AAAAA'],
      ['a non-canonical two-character tail', 'QR'],
      ['a non-canonical three-character tail', 'QUJ'],
      ['a character outside ASCII', 'ab£d'],
      ['the twin of the demo payload', V.B64U_TWIN.twinSegments[0]]
    ].forEach(function (row) {
      var strict = strictRefusal(row[1]);
      var loose = looseOutcome(row[1]);
      out.refusals.push({
        label: row[0], input: row[1],
        strictRefused: strict.refused, code: strict.code, reason: strict.reason,
        looseAccepted: loose.accepted, looseHex: loose.hex
      });
    });

    V.ATOB_BEHAVIOUR.looseAccepts.forEach(function (s) {
      out.looseAccepts.push({ input: s, accepted: looseOutcome(s).accepted });
    });

    out.atobCollision = {
      a: V.ATOB_BEHAVIOUR.collision.a,
      b: V.ATOB_BEHAVIOUR.collision.b,
      aHex: looseOutcome(V.ATOB_BEHAVIOUR.collision.a).hex,
      bHex: looseOutcome(V.ATOB_BEHAVIOUR.collision.b).hex,
      identical: looseOutcome(V.ATOB_BEHAVIOUR.collision.a).hex ===
        looseOutcome(V.ATOB_BEHAVIOUR.collision.b).hex,
      aStrictRefused: strictRefusal(V.ATOB_BEHAVIOUR.collision.a).refused,
      bStrictRefused: strictRefusal(V.ATOB_BEHAVIOUR.collision.b).refused
    };

    /* The signing input is the STRING, not the object. Re-serialising a parsed
       header produces different bytes — key order, whitespace, number
       formatting — so a verifier that re-encodes what it parsed reproduces
       nothing and rejects a token it should accept. The A.1 header is the
       cleanest possible demonstration because the RFC's own bytes carry a CRLF
       and a leading space that no serialiser emits. */
    var a1 = V.JWS_A1;
    var reser = JSON.stringify(JSON.parse(a1.headerJson));
    out.reserialised = {
      originalJson: a1.headerJson,
      originalSeg: a1.headerSeg,
      reserialisedJson: reser,
      reserialisedSeg: B.b64uEncode(B.utf8Encode(reser)),
      sameJson: reser === a1.headerJson,
      sameSegment: B.b64uEncode(B.utf8Encode(reser)) === a1.headerSeg,
      originalBytes: B.utf8Encode(a1.headerJson).length,
      reserialisedBytes: B.utf8Encode(reser).length
    };

    /* And the same fact on a token this lab issued, so the point is not about
       one RFC's formatting habits. */
    return J.issue(subtle, JSON.parse(keys.es.privJwkText), 'ES256', basePayload())
      .then(function (token) {
        var p = token.split('.');
        var reparsed = JSON.stringify(JSON.parse(B.utf8Decode(B.b64uDecodeStrict(p[1]))));
        var reseg = B.b64uEncode(B.utf8Encode(reparsed));
        var rebuilt = p[0] + '.' + reseg + '.' + p[2];
        return J.verifyStrict(subtle, rebuilt,
          expectation({ jwk: JSON.parse(keys.es.pubJwkText) })).then(function (r) {
            out.reencodedToken = {
              originalSeg: p[1], reencodedSeg: reseg,
              sameSegment: reseg === p[1],
              /* Round-tripping THIS payload happens to reproduce the bytes,
                 because it was serialised by the same serialiser a moment ago.
                 The number below is what the panel prints, and it is honest
                 either way: what breaks a re-encoding verifier is not that the
                 round trip always differs, it is that nothing guarantees it
                 does not. */
              strictOk: r.ok, strictCode: r.code
            };
            return out;
          });
      });
  }

  function strictRefusal(s) {
    try {
      B.b64uDecodeStrict(s);
      return { refused: false, code: null, reason: null };
    } catch (e) {
      return { refused: true, code: e.code || null, reason: e.reason || null };
    }
  }

  function looseOutcome(s) {
    try { return { accepted: true, hex: B.hex(B.b64uDecodeLoose(s)) }; }
    catch (e) { return { accepted: false, hex: null }; }
  }

  /* -------------------------------------------------- the published vectors */

  function buildVectors(subtle) {
    var out = { a1: null, a2: null, a3: null, hmac4231: [], totp: [], totpMisread: null, totpSynthetic: null };
    var a1 = V.JWS_A1, a2 = V.JWS_A2, a3 = V.JWS_A3;

    return Promise.resolve()
      .then(function () {
        out.a1 = {
          rfc: a1.rfc, section: a1.section, alg: a1.alg,
          headerSegPublished: a1.headerSeg,
          headerSegComputed: B.b64uEncode(B.utf8Encode(a1.headerJson)),
          payloadSegPublished: a1.payloadSeg,
          payloadSegComputed: B.b64uEncode(B.utf8Encode(a1.payloadJson)),
          signaturePublished: a1.signature,
          signatureComputed: null, signatureMatches: null, verifyOnly: false
        };
        out.a1.headerSegMatches = out.a1.headerSegComputed === a1.headerSeg;
        out.a1.payloadSegMatches = out.a1.payloadSegComputed === a1.payloadSeg;
        return J.importJwk(subtle, a1.jwk, 'HS256', ['sign', 'verify'])
          .then(function (k) {
            return J.signBytes(subtle, k, 'HS256',
              B.utf8Encode(a1.headerSeg + '.' + a1.payloadSeg));
          })
          .then(function (sig) {
            out.a1.signatureComputed = B.b64uEncode(sig);
            out.a1.signatureMatches = out.a1.signatureComputed === a1.signature;
            out.a1.sigBytes = sig.length;
          })
          ['catch'](observedInto(out, 'a1'));
      })
      .then(function () {
        out.a2 = {
          rfc: a2.rfc, section: a2.section, alg: a2.alg,
          headerSegPublished: a2.headerSeg,
          headerSegComputed: B.b64uEncode(B.utf8Encode(a2.headerJson)),
          signaturePublished: a2.signature,
          signatureComputed: null, signatureMatches: null,
          sigChars: a2.sigChars, sigBytes: null, spkiBytes: null, verifyOnly: false
        };
        out.a2.headerSegMatches = out.a2.headerSegComputed === a2.headerSeg;
        return J.importJwk(subtle, a2.jwk, 'RS256', ['sign'])
          .then(function (k) {
            return J.signBytes(subtle, k, 'RS256',
              B.utf8Encode(a2.headerSeg + '.' + a2.payloadSeg));
          })
          .then(function (sig) {
            out.a2.signatureComputed = B.b64uEncode(sig);
            out.a2.signatureMatches = out.a2.signatureComputed === a2.signature;
            out.a2.sigBytes = sig.length;
            out.a2.sigCharsComputed = out.a2.signatureComputed.length;
          })
          ['catch'](observedInto(out, 'a2'));
      })
      .then(function () {
        /* A.3 is VERIFY ONLY, and the asymmetry is the row's whole content.
           ECDSA draws a nonce per signature, so a correct implementation cannot
           reproduce a published ECDSA signature — and any page that claims to
           has either a deterministic-nonce implementation or a lie. Two
           re-signings are taken so the row can show them differing from the
           published value AND from each other. */
        out.a3 = {
          rfc: a3.rfc, section: a3.section, alg: a3.alg, verifyOnly: true,
          headerSegPublished: a3.headerSeg,
          headerSegComputed: B.b64uEncode(B.utf8Encode(a3.headerJson)),
          signaturePublished: a3.signature,
          publishedVerifies: null,
          resignA: null, resignB: null,
          resignADiffersFromPublished: null, resignBDiffersFromPublished: null,
          resignsDifferFromEachOther: null, sigBytes: a3.sigBytes
        };
        out.a3.headerSegMatches = out.a3.headerSegComputed === a3.headerSeg;
        var si = B.utf8Encode(a3.headerSeg + '.' + a3.payloadSeg);
        return J.importJwk(subtle, a3.jwkPublic, 'ES256', ['verify'])
          .then(function (k) {
            return J.verifyBytes(subtle, k, 'ES256', B.b64uDecodeStrict(a3.signature), si);
          })
          .then(function (v) { out.a3.publishedVerifies = v; })
          .then(function () { return J.importJwk(subtle, a3.jwk, 'ES256', ['sign']); })
          .then(function (k) {
            return J.signBytes(subtle, k, 'ES256', si).then(function (s1) {
              return J.signBytes(subtle, k, 'ES256', si).then(function (s2) {
                out.a3.resignA = B.b64uEncode(s1);
                out.a3.resignB = B.b64uEncode(s2);
                out.a3.resignADiffersFromPublished = out.a3.resignA !== a3.signature;
                out.a3.resignBDiffersFromPublished = out.a3.resignB !== a3.signature;
                out.a3.resignsDifferFromEachOther = out.a3.resignA !== out.a3.resignB;
              });
            });
          })
          ['catch'](observedInto(out, 'a3'));
      })
      .then(function () { return buildHmac4231(subtle, out); })
      .then(function () { return buildTotp(subtle, out); })
      .then(function () { return out; });
  }

  function observedInto(out, key) {
    return function (e) {
      out[key].error = e && e.name ? String(e.name) : 'Error';
      out[key].errorMessage = e && e.message ? String(e.message) : '';
    };
  }

  function buildHmac4231(subtle, out) {
    var seq = Promise.resolve();
    V.HMAC_4231.cases.forEach(function (c) {
      seq = seq.then(function () {
        return subtle.importKey('raw', B.unhex(c.keyHex),
          { name: 'HMAC', hash: { name: V.HMAC_4231.hash } }, false, ['sign'])
          .then(function (k) { return subtle.sign('HMAC', k, B.unhex(c.dataHex)); })
          .then(function (mac) {
            var h = B.hex(new Uint8Array(mac)).slice(0, c.truncTo * 2);
            out.hmac4231.push({
              n: c.n, note: c.note, keyBytes: c.keyHex.length / 2,
              dataBytes: c.dataHex.length / 2, truncTo: c.truncTo,
              published: c.macHex, computed: h, matches: h === c.macHex
            });
          })
          ['catch'](function (e) {
            out.hmac4231.push({
              n: c.n, note: c.note, keyBytes: c.keyHex.length / 2,
              dataBytes: c.dataHex.length / 2, truncTo: c.truncTo,
              published: c.macHex, computed: null, matches: false,
              error: e && e.name ? String(e.name) : 'Error'
            });
          });
      });
    });
    return seq;
  }

  function totpOnce(subtle, seedAscii, hash, t, digits, counterFn) {
    var T = Math.floor(t / 30);
    return subtle.importKey('raw', B.utf8Encode(seedAscii), { name: 'HMAC', hash: { name: hash } }, false, ['sign'])
      .then(function (k) { return subtle.sign('HMAC', k, counterFn(T)); })
      .then(function (mac) {
        return B.otpDigits(B.dynamicTruncate(new Uint8Array(mac)), digits);
      });
  }

  function buildTotp(subtle, out) {
    var seeds = V.TOTP_B.seeds, seq = Promise.resolve();
    var misread = { matched: 0, of: V.TOTP_B.rows.length, matchedModes: [], rows: [] };

    V.TOTP_B.rows.forEach(function (r) {
      seq = seq.then(function () {
        var seed = seeds[r.seedName].ascii;
        return totpOnce(subtle, seed, r.mode, r.t, V.TOTP_B.digits, B.beCounter8)
          .then(function (v8) {
            return totpOnce(subtle, seed, r.mode, r.t, V.TOTP_B.digits, B.beCounter4)
              .then(function (v32) {
                return totpOnce(subtle, seeds.SEED_SHA1.ascii, r.mode, r.t, V.TOTP_B.digits, B.beCounter8)
                  .then(function (vm) {
                    out.totp.push({
                      t: r.t, counter: Math.floor(r.t / 30), mode: r.mode,
                      seedName: r.seedName, seedBytes: seeds[r.seedName].bytes,
                      published: r.published, computed: v8, matches: v8 === r.published,
                      /* Printed in its own column and labelled as this lab's own
                         truncation. The RFC publishes eight digits and does not
                         contain the six-digit form; a table whose "published"
                         column carried it would be falsifiable with a copy of
                         the RFC, in the one tab whose job is being an oracle. */
                      sixDigitThisLab: v8.slice(-6),
                      counter32Bug: v32, counter32BugMatchesPublished: v32 === r.published
                    });
                    misread.rows.push({ t: r.t, mode: r.mode, computed: vm, published: r.published, matches: vm === r.published });
                    if (vm === r.published) { misread.matched++; misread.matchedModes.push(r.mode); }
                  });
              });
          })
          ['catch'](function (e) {
            out.totp.push({
              t: r.t, mode: r.mode, seedName: r.seedName, published: r.published,
              computed: null, matches: false, error: e && e.name ? String(e.name) : 'Error'
            });
          });
      });
    });

    seq = seq.then(function () {
      var allSha1 = true, i;
      for (i = 0; i < misread.matchedModes.length; i++) {
        if (misread.matchedModes[i] !== V.TOTP_B_MISREAD.expectedMatchingMode) allSha1 = false;
      }
      out.totpMisread = {
        rfc: V.TOTP_B_MISREAD.rfc, section: V.TOTP_B_MISREAD.section,
        negativeControl: true,
        expectedMatches: V.TOTP_B_MISREAD.expectedMatches, of: V.TOTP_B_MISREAD.of,
        matched: misread.matched,
        matchedAsExpected: misread.matched === V.TOTP_B_MISREAD.expectedMatches,
        everyMatchIsSha1: allSha1,
        workedRow: copy(V.TOTP_B_MISREAD.workedRow),
        rows: misread.rows
      };
      /* One worked figure beside the table, recomputed rather than transcribed. */
      var w = null, k;
      for (k = 0; k < misread.rows.length; k++) {
        if (misread.rows[k].t === V.TOTP_B_MISREAD.workedRow.t &&
          misread.rows[k].mode === V.TOTP_B_MISREAD.workedRow.mode) w = misread.rows[k];
      }
      out.totpMisread.workedRowComputed = w ? w.computed : null;
      out.totpMisread.workedRowMatchesVector = !!w && w.computed === V.TOTP_B_MISREAD.workedRow.misread;
    });

    seq = seq.then(function () {
      var s = V.TOTP_SYNTHETIC;
      return totpOnce(subtle, seeds[s.seedName].ascii, s.mode, s.t, s.digits, B.beCounter8)
        .then(function (v8) {
          return totpOnce(subtle, seeds[s.seedName].ascii, s.mode, s.t, s.digits, B.beCounter4)
            .then(function (v32) {
              out.totpSynthetic = {
                published: false, selfConsistency: true,
                t: s.t, counter: Math.floor(s.t / 30),
                counterIs2Pow32: Math.floor(s.t / 30) === 4294967296,
                counter8Hex: B.hex(B.beCounter8(Math.floor(s.t / 30))),
                counter4Hex: B.hex(B.beCounter4(Math.floor(s.t / 30))),
                expected8: s.expected8, computed8: v8, matches8: v8 === s.expected8,
                expected32Bug: s.expected32Bug, computed32Bug: v32,
                matches32Bug: v32 === s.expected32Bug,
                separates: v8 !== v32,
                /* Stated on the row, because the honest version of this table is
                   the one that says what it does not pin: every published row
                   above matches under the 32-bit bug too. */
                publishedTableSeparatesThem: false
              };
            });
        })
        ['catch'](function (e) {
          out.totpSynthetic = { published: false, selfConsistency: true, error: e && e.name ? String(e.name) : 'Error' };
        });
    });

    seq = seq.then(function () {
      var m8 = 0, m32 = 0, i;
      for (i = 0; i < out.totp.length; i++) {
        if (out.totp[i].matches) m8++;
        if (out.totp[i].counter32BugMatchesPublished) m32++;
      }
      out.totpSummary = {
        rows: out.totp.length, matched8: m8, matched32Bug: m32,
        digits: V.TOTP_B.digits,
        largestPublishedCounter: V.TOTP_B.largestCounter,
        largestPublishedCounterHex: V.TOTP_B.largestCounterHex,
        countersFitIn32Bits: V.TOTP_B.largestCounter < 4294967296
      };
    });

    return seq;
  }

  /* ------------------------------------------------- signature determinism */

  /* Six rows, and the table is the reason the malleation card is not a magic
     trick: two of these schemes produce a different signature every time over
     identical bytes, and nobody thinks those tokens are different tokens. */
  function buildDeterminism(subtle, keys) {
    var rows = [];
    var msg = B.utf8Encode('sahih determinism row');
    var a2 = V.JWS_A2, a3 = V.JWS_A3;

    function row(label, alg, jwkOrKeyPromise, expected) {
      return Promise.resolve(jwkOrKeyPromise).then(function (key) {
        return J.signBytes(subtle, key, alg, msg).then(function (s1) {
          return J.signBytes(subtle, key, alg, msg).then(function (s2) {
            var ha = B.hex(s1), hb = B.hex(s2);
            rows.push({
              label: label, alg: alg,
              expectedDeterministic: expected,
              sigAHex: ha, sigBHex: hb, sigBytes: s1.length,
              identical: ha === hb,
              agreesWithExpectation: (ha === hb) === expected,
              available: true
            });
          });
        });
      })['catch'](function (e) {
        rows.push({
          label: label, alg: alg, expectedDeterministic: expected,
          sigAHex: null, sigBHex: null, sigBytes: null, identical: null,
          agreesWithExpectation: null, available: false,
          errName: e && e.name ? String(e.name) : 'Error'
        });
      });
    }

    return row('HS256 (HMAC-SHA-256)', 'HS256',
      J.importJwk(subtle, JSON.parse(keys.hs.jwkText), 'HS256', ['sign']), true)
      .then(function () {
        return row('RS256 (PKCS#1 v1.5)', 'RS256',
          J.importJwk(subtle, a2.jwk, 'RS256', ['sign']), true);
      })
      .then(function () {
        return row('PS256 (RSA-PSS, salted)', 'PS256',
          J.importJwk(subtle, a2.jwk, 'PS256', ['sign']), false);
      })
      .then(function () {
        return row('ES256 (ECDSA P-256)', 'ES256',
          J.importJwk(subtle, a3.jwk, 'ES256', ['sign']), false);
      })
      .then(function () {
        /* Ed25519 is deterministic by construction rather than by the accident
           of PKCS#1 v1.5 having no nonce, which is why it is worth the row.
           Generated rather than imported because no published Ed25519 JWK ships
           in this lab's vector file; keygen on this curve is free, and the row
           asserts nothing about the key. */
        return row('Ed25519 (EdDSA)', 'EdDSA',
          subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
            .then(function (p) { return p.privateKey; }), true);
      })
      .then(function () {
        /* And the same fact stated as a count rather than a pair: five ES256
           signatures over identical bytes are five distinct signatures. */
        return J.importJwk(subtle, a3.jwk, 'ES256', ['sign']).then(function (k) {
          var sigs = [], seq = Promise.resolve(), i;
          for (i = 0; i < 5; i++) {
            seq = seq.then(function () {
              return J.signBytes(subtle, k, 'ES256', msg).then(function (s) { sigs.push(B.hex(s)); });
            });
          }
          return seq.then(function () {
            var seen = {}, distinct = 0, j;
            for (j = 0; j < sigs.length; j++) {
              if (!Object.prototype.hasOwnProperty.call(seen, sigs[j])) { seen[sigs[j]] = 1; distinct++; }
            }
            return { rows: rows, es256: { n: sigs.length, distinct: distinct, signatures: sigs } };
          });
        })['catch'](function (e) {
          return { rows: rows, es256: { n: 0, distinct: 0, signatures: [], errName: e && e.name ? String(e.name) : 'Error' } };
        });
      });
  }

  /* ------------------------------------------------------ capability probes */

  /* Printed on the page as OBSERVED DATA. Assertions pin err.name and nothing
     else — the wording is Chromium's and carries no stability contract, and a
     browser release must not be able to turn this suite red for a reason that
     has nothing to do with this code. */
  function buildCapability(subtle, keys) {
    var rows = [], a2 = V.JWS_A2, a3 = V.JWS_A3;
    var sig64 = new Uint8Array(64), data = B.utf8Encode('probe');
    var seq = Promise.resolve();

    function probe(id, call, run) {
      seq = seq.then(function () {
        return Promise.resolve()
          .then(run)
          .then(function (v) { rows.push(noThrewRow(id, call, 'settled with ' + String(v))); })
          ['catch'](function (e) { rows.push(observed(id, call)(e)); });
      });
    }

    probe('spkiAsHmac', "importKey('spki', spkiBytes, {name:'HMAC'})", function () {
      /* Imported extractable HERE and nowhere else in this file: the probe needs
         the SPKI bytes out, and the row being probed is the import that follows.
         An unextractable key would make this row report the wrong refusal — the
         export's, not the import's — which is the failure mode of every
         capability table nobody re-read. */
      return subtle.importKey('jwk', a2.jwkPublic,
        { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, true, ['verify'])
        .then(function (k) { return subtle.exportKey('spki', k); })
        .then(function (spki) {
          return subtle.importKey('spki', spki, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['verify']);
        });
    });

    probe('hmacVerifyWithRsaKey', "verify('HMAC', <RSA public key>, …)", function () {
      return J.importJwk(subtle, a2.jwkPublic, 'RS256', ['verify'])
        .then(function (k) { return subtle.verify({ name: 'HMAC' }, k, sig64, data); });
    });

    probe('rsaVerifyWithEcKey', "verify('RSASSA-PKCS1-v1_5', <EC public key>, …)", function () {
      return J.importJwk(subtle, a3.jwkPublic, 'ES256', ['verify'])
        .then(function (k) { return subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, k, sig64, data); });
    });

    probe('usagesDoNotPermit', "verify('HMAC', <key with usages ['sign']>, …)", function () {
      return J.importJwk(subtle, JSON.parse(keys.hs.jwkText), 'HS256', ['sign'])
        .then(function (k) { return subtle.verify({ name: 'HMAC' }, k, sig64, data); });
    });

    probe('rsaJwkAsHmac', "importKey('jwk', <RSA public JWK>, HMAC)", function () {
      return subtle.importKey('jwk', a2.jwkPublic, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['verify']);
    });

    probe('privateJwkForVerify', "importKey('jwk', <EC JWK carrying d>, ECDSA, ['verify'])", function () {
      return subtle.importKey('jwk', a3.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    });

    ['Argon2id', 'scrypt', 'bcrypt'].forEach(function (name) {
      probe('kdf:' + name, "importKey('raw', …, {name:'" + name + "'})", function () {
        return subtle.importKey('raw', B.utf8Encode('probe'), { name: name }, false, ['deriveBits']);
      });
    });

    ['BLAKE2b', 'SHA3-256', 'MD5'].forEach(function (name) {
      probe('digest:' + name, "digest('" + name + "', …)", function () {
        return subtle.digest(name, data);
      });
    });

    probe('nonExtractableExport', "exportKey('jwk', <non-extractable key>)", function () {
      return subtle.generateKey({ name: 'HMAC', hash: { name: 'SHA-256' }, length: 256 }, false, ['sign'])
        .then(function (k) { return subtle.exportKey('jwk', k); });
    });

    /* Two of these rows are deliberately NOT assertion subjects, and the page
       used to print one column header saying every one of them was. The
       private-JWK refusal is Chromium's own decision and §0/C6 forbids pinning
       it — the lab makes its own E_PRIVATE_KEY rule instead. The
       non-extractable export answers InvalidAccessError here and
       InvalidAccessException under node, so pinning it would fail on a runtime
       that is not this one. Which rows carry a pin is a fact about the suite,
       so it travels as data rather than as a sentence somebody has to keep
       true by hand. */
    var UNPINNED = { privateJwkForVerify: 1, nonExtractableExport: 1 };

    return seq.then(function () {
      var r;
      for (r = 0; r < rows.length; r++) {
        rows[r].asserted = !UNPINNED[rows[r].id];
      }
      /* There is no crypto.subtle.timingSafeEqual. Enumerated rather than
         asserted from memory, and printed on the page as the list it is. */
      var proto = Object.getPrototypeOf(subtle), names = [], i;
      try {
        names = Object.getOwnPropertyNames(proto);
      } catch (e) { names = []; }
      names.sort();
      var hasTse = false;
      for (i = 0; i < names.length; i++) if (names[i] === 'timingSafeEqual') hasTse = true;
      return {
        rows: rows,
        subtleMethods: names,
        hasTimingSafeEqual: hasTse
      };
    });
  }

  /* ------------------------------------------- the delegated sections */

  /* The forger owns every forged token, and this file calls the five functions
     it publishes rather than growing a sixth copy of any of them. What is built
     HERE is only key MATERIAL — the six candidate byte strings an attacker
     might guess the toy endpoint stores — because that needs subtle and the
     keys, and handing a forger a key object rather than bytes would delete the
     thing the rung is about.

     The PEM variants are assembled at runtime from an exported SPKI, split
     across a concatenation so no complete header line appears as a literal
     anywhere in this repository, and they are only ever PUBLIC keys. */
  function buildForge(subtle, keys, legit) {
    var P = root.SAHIH_PALSU;
    if (!P) {
      return Promise.resolve({
        pending: 'SAHIH_PALSU',
        note: 'the forger has not loaded; every rung below is empty by construction, not by failure',
        rung1: null, rung2: null, rung3: null, rung4: null, rung5: null
      });
    }

    var out = { pending: null, rung1: null, rung2: null, rung3: null, rung4: null, rung5: null };
    var esPub = JSON.parse(keys.es.pubJwkText);
    var rsPub = JSON.parse(keys.rs.pubJwkText);
    var esPriv = JSON.parse(keys.es.privJwkText);
    var ring = { 'k_FIKTIF_es': esPub, 'default': esPub };

    return rung1(subtle, P, out, ring)
      .then(function () { return rung2(subtle, P, out, keys, rsPub); })
      .then(function () { return rung3(subtle, P, out, ring, esPriv, legit); })
      .then(function () { return rung4(subtle, P, out, esPriv, esPub); })
      .then(function () { return rung5(subtle, P, out, legit, esPub); })
      .then(function () { return out; })
      ['catch'](function (e) {
        out.failed = true;
        out.errName = e && e.name ? String(e.name) : 'Error';
        out.errMessage = e && e.message ? String(e.message) : '';
        return out;
      });
  }

  function verdicts(subtle, token, ring, ex) {
    return J.verifyNaive(subtle, token, ring).then(function (n) {
      return J.verifyStrict(subtle, token, ex).then(function (s) {
        return { token: token, naive: flatNaive(n), strict: flatStrict(s) };
      });
    });
  }

  function rung1(subtle, P, out, ring) {
    var pl = basePayload(); pl.role = 'bendahara';
    var token = P.algNone(pl);
    var ex = expectation({ jwk: JSON.parse(JSON.stringify(ring['default'])) });
    return verdicts(subtle, token, ring, ex).then(function (v) {
      out.rung1 = v;
      out.rung1.label = 'a verifier that trusts the token\'s own alg field';
      out.rung1.roleForged = 'bendahara';
      out.rung1.caseVariants = [];
      out.rung1.duplicateAlg = null;
      /* Three spellings accepted and two missed. An admission about this
         repository's own naive verifier, encoded as a test rather than as a
         sentence, because a sentence cannot go red. */
      var seq = Promise.resolve();
      ['none', 'None', 'NONE', 'nOnE', 'nonE'].forEach(function (sp) {
        seq = seq.then(function () {
          var t = B.b64uEncode(B.utf8Encode('{"alg":"' + sp + '","typ":"JWT"}')) + '.' +
            B.b64uEncode(B.utf8Encode(JSON.stringify(pl))) + '.';
          return J.verifyNaive(subtle, t, ring).then(function (r) {
            out.rung1.caseVariants.push({ spelling: sp, naiveAccepted: r.ok, why: r.why });
          });
        });
      });
      return seq;
    }).then(function () {
      /* JSON.parse keeps the LAST duplicate key, so a header whose first eight
         characters read alg:"ES256" can still arrive at the verifier as an
         unsecured token. */
      var pl2 = basePayload(); pl2.role = 'bendahara';
      var hdrText = '{"alg":"ES256","typ":"JWT","alg":"none"}';
      var t = B.b64uEncode(B.utf8Encode(hdrText)) + '.' +
        B.b64uEncode(B.utf8Encode(JSON.stringify(pl2))) + '.';
      var ex = expectation({ jwk: JSON.parse(JSON.stringify(ring['default'])) });
      return verdicts(subtle, t, ring, ex).then(function (v) {
        out.rung1.duplicateAlg = v;
        out.rung1.duplicateAlg.headerText = hdrText;
        out.rung1.duplicateAlg.parsedAlg = JSON.parse(hdrText).alg;
        out.rung1.duplicateAlg.firstEightChars = hdrText.slice(0, 16);
      });
    });
  }

  function rung2(subtle, P, out, keys, rsPub) {
    /* Extractable, because the SPKI bytes are the input to the whole rung: the
       attacker's guesses are serialisations of a PUBLIC key, which is the only
       kind of key this file ever exports. */
    return subtle.importKey('jwk', rsPub,
      { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, true, ['verify'])
      .then(function (k) { return subtle.exportKey('spki', k); })
      .then(function (spkiBuf) {
        var der = new Uint8Array(spkiBuf);
        var body = b64Standard(der);
        var wrapped = body.replace(/(.{64})/g, '$1\n');
        if (wrapped.charAt(wrapped.length - 1) !== '\n') wrapped += '\n';
        var HEAD = '-----BEGIN PUBLIC KEY' + '-----\n';
        var FOOT = '-----END PUBLIC KEY' + '-----';
        var pemNL = HEAD + wrapped + FOOT + '\n';
        var pemNoNL = HEAD + wrapped + FOOT;
        var pemCRLF = pemNL.replace(/\n/g, '\r\n');
        var jwkText = JSON.stringify(rsPub);

        var candidates = [
          { label: 'PEM with a trailing newline', bytes: B.utf8Encode(pemNL) },
          { label: 'PEM without a trailing newline', bytes: B.utf8Encode(pemNoNL) },
          { label: 'PEM with CRLF line endings', bytes: B.utf8Encode(pemCRLF) },
          { label: 'raw DER SPKI (' + der.length + ' bytes)', bytes: der },
          { label: 'JWK JSON text', bytes: B.utf8Encode(jwkText) },
          { label: 'the base64 body only, no headers', bytes: B.utf8Encode(body) }
        ];

        /* The toy endpoint keeps its public key as PEM with a trailing newline.
           This page chose that, so exactly one row must match — which is why the
           card calls it a guessing game with a handful of plausible candidates
           rather than magic. What makes it worth showing is that six is a small
           number. */
        var storedB64u = B.b64uEncode(B.utf8Encode(pemNL));
        var ring = {
          'k_FIKTIF_rs': { jwk: rsPub, storedB64u: storedB64u },
          'default': { jwk: rsPub, storedB64u: storedB64u }
        };
        var pl = basePayload(); pl.role = 'bendahara';
        var ex = expectation({ alg: 'RS256', kid: 'k_FIKTIF_rs', jwk: rsPub });
        var rows = [], seq = Promise.resolve();

        candidates.forEach(function (c) {
          seq = seq.then(function () {
            return Promise.resolve(P.confuse(c.bytes, pl)).then(function (token) {
              return verdicts(subtle, token, ring, ex).then(function (v) {
                rows.push({
                  candidate: c.label, bytes: c.bytes.length,
                  importsAsRawHmacKey: true,
                  naiveAccepted: v.naive.ok, naiveWhy: v.naive.why,
                  strictOk: v.strict.ok, strictCode: v.strict.code, strictReason: v.strict.reason,
                  token: token
                });
              });
            })['catch'](function (e) {
              rows.push({
                candidate: c.label, bytes: c.bytes.length,
                importsAsRawHmacKey: false,
                errName: e && e.name ? String(e.name) : 'Error'
              });
            });
          });
        });

        return seq.then(function () {
          var accepted = 0, i;
          for (i = 0; i < rows.length; i++) if (rows[i].naiveAccepted) accepted++;
          out.rung2 = {
            label: 'one polymorphic key parameter, and the token names the algorithm',
            spkiBytes: der.length,
            storedForm: 'PEM with a trailing newline',
            candidates: rows,
            acceptedCount: accepted, candidateCount: rows.length,
            /* Said above the table, and it is the honest inversion of the folk
               version of this attack: subtle.verify(algorithm, key, …) takes both
               as arguments the token cannot reach, so this is the one place the
               confusion attack is structurally impossible. The vulnerable thing
               is a library API of the shape jwt.verify(token, keyOrSecret). */
            structurallyImpossibleInSubtle: true
          };
        });
      })
      ['catch'](function (e) {
        out.rung2 = { failed: true, errName: e && e.name ? String(e.name) : 'Error' };
      });
  }

  function rung3(subtle, P, out, ring, esPriv, legit) {
    var pl = basePayload(); pl.role = 'bendahara';
    var ex = expectation({ jwk: JSON.parse(JSON.stringify(ring['default'])) });
    return Promise.resolve(P.embedJwk(subtle, pl)).then(function (token) {
      return verdicts(subtle, token, ring, ex).then(function (v) {
        out.rung3 = v;
        out.rung3.label = 'a verifier that reads its key out of the token';
        out.rung3.roleForged = 'bendahara';
        out.rung3.headerMember = 'jwk';
        out.rung3.siblings = [];
        out.rung3.unknownKid = null;
        out.rung3.privateKeyOffered = null;
      });
    }).then(function () {
      /* jku and x5u name a URL to fetch a key set from. This page ships
         connect-src 'none' and could not fetch one if it wanted to, so the
         refusal is free — which is exactly why it is worth pointing at: on a
         real server that refusal is a decision somebody has to remember to make. */
      var seq = Promise.resolve(), base = basePayload();
      ['jku', 'x5u', 'x5c'].forEach(function (m) {
        seq = seq.then(function () {
          var h = { alg: 'ES256', typ: 'JWT', kid: META.kid };
          h[m] = 'https://keys.evil.invalid/jwks.json';
          var t = B.b64uEncode(B.utf8Encode(JSON.stringify(h))) + '.' +
            B.b64uEncode(B.utf8Encode(JSON.stringify(base))) + '.' +
            B.b64uEncode(new Uint8Array(64));
          return J.verifyStrict(subtle, t, expectation({ jwk: JSON.parse(JSON.stringify(ring['default'])) }))
            .then(function (r) {
              out.rung3.siblings.push({
                member: m, ok: r.ok, code: r.code, reason: r.reason,
                structuralNote: 'connect-src none means this page could not fetch a key set even if it tried'
              });
            });
        });
      });
      return seq;
    }).then(function () {
      /* The naive verifier's keyring[kid] || keyring.default is the line that
         differs. An unknown kid downgrades there; here it refuses.
         The page used to STATE that downgrade and never show it, because this
         token carried a spliced all-zero signature — which the naive verifier
         refuses at the signature, so the || never got the chance to be the
         difference. §0/C21 predicted exactly that mistake. The token is now
         genuinely signed by the endpoint's own key under a kid the keyring has
         never heard of, so the downgrade is a run and not a sentence: the naive
         verifier falls through to the default entry and accepts, and says which
         arm answered. */
      var base = basePayload();
      var legacyPriv = JSON.parse(JSON.stringify(esPriv));
      legacyPriv.kid = 'k_FIKTIF_legacy';
      return J.issue(subtle, legacyPriv, 'ES256', base).then(function (t) {
        return J.verifyStrict(subtle, t, expectation({ jwk: JSON.parse(JSON.stringify(ring['default'])) }))
          .then(function (r) {
            return J.verifyNaive(subtle, t, ring).then(function (nv) {
              out.rung3.unknownKid = {
                kid: 'k_FIKTIF_legacy', ok: r.ok, code: r.code, reason: r.reason,
                signedByTheEndpointKey: true,
                naiveAccepted: nv.ok, naiveWhy: nv.why
              };
            });
          });
      });
    }).then(function () {
      /* This lab's own rule, fired BEFORE importKey, so the refusal that reaches
         the page is one this repository made and can be held to. Chromium does
         refuse a private JWK offered for verification, with its own name and its
         own wording; that string is printed elsewhere as observed data and is
         never the subject of an assertion. */
      return J.verifyStrict(subtle, legit.token, expectation({ jwk: esPriv })).then(function (r) {
          out.rung3.privateKeyOffered = {
            offered: 'the ES256 private JWK, which carries a d member',
            ok: r.ok, code: r.code, reason: r.reason,
            firedBeforeImportKey: r.code === 'E_PRIVATE_KEY'
          };
        });
    })['catch'](function (e) {
      if (!out.rung3) out.rung3 = {};
      out.rung3.failed = true;
      out.rung3.errName = e && e.name ? String(e.name) : 'Error';
    });
  }

  function rung4(subtle, P, out, esPriv, esPub) {
    /* NOT forgeries. Every one of these is signed by this lab's own real key
       over a payload this lab chose, and subtle.verify returns true for all six.
       The raw boolean is carried in its own column so a reader can watch the
       signature check pass while the row is red. */
    var patches = [
      { label: 'exp an hour in the past', patch: { exp: NOW - 3600, iat: NOW - 4200 }, expectCode: 'E_EXPIRED' },
      { label: 'exp written in milliseconds', patch: { exp: 1789021565000, iat: 0 }, expectCode: 'E_LIFETIME' },
      { label: 'nbf ten minutes in the future', patch: { nbf: NOW + 600 }, expectCode: 'E_NBF' },
      { label: 'aud "other-app"', patch: { aud: 'other-app' }, expectCode: 'E_AUD' },
      { label: 'iss "https://evil.invalid"', patch: { iss: 'https://evil.invalid' }, expectCode: 'E_ISS' },
      { label: 'no exp claim at all', patch: { exp: null }, expectCode: 'E_EXP_MISSING' }
    ];
    var rows = [], seq = Promise.resolve();

    patches.forEach(function (p) {
      seq = seq.then(function () {
        return Promise.resolve(P.claimSwap(subtle, esPriv, p.patch, basePayload())).then(function (token) {
          var parts = token.split('.');
          return J.importJwk(subtle, esPub, 'ES256', ['verify'])
            .then(function (k) {
              return J.verifyBytes(subtle, k, 'ES256', B.b64uDecodeStrict(parts[2]),
                B.utf8Encode(parts[0] + '.' + parts[1]));
            })
            .then(function (raw) {
              return J.verifyStrict(subtle, token, expectation({ jwk: esPub })).then(function (r) {
                rows.push({
                  label: p.label, token: token,
                  subtleVerify: raw,
                  expectedCode: p.expectCode,
                  ok: r.ok, code: r.code, reason: r.reason,
                  codeAsExpected: r.code === p.expectCode
                });
              });
            });
        })['catch'](function (e) {
          rows.push({ label: p.label, token: null, subtleVerify: null, expectedCode: p.expectCode, ok: null, code: null, reason: null, codeAsExpected: false, errName: e && e.name ? String(e.name) : 'Error' });
        });
      });
    });

    return seq.then(function () {
      out.rung4 = { label: 'correctly signed, and still the wrong answer', rows: rows, msExpWithoutLifetimeRule: null };
      /* The second row again, with the maximum-lifetime rule switched off: a
         token whose exp was written in milliseconds sails past an expiry check.
         It is caught by a DIFFERENT rule that most verifiers do not have, and
         the two facts are recorded separately so the suite can assert both.
         The exp is carried out as a number rather than described in prose: the
         page used to print the calendar year it lands in as a typed literal,
         and the typed literal was eighty years wrong. */
      var ms = basePayload(); ms.exp = 1789021565000; ms.iat = 0;
      return Promise.resolve(P.claimSwap(subtle, esPriv, { exp: 1789021565000, iat: 0 }, basePayload()))
        .then(function (token) {
          var noRule = expectation({ jwk: esPub });
          delete noRule.maxLifetimeSec;
          return J.verifyStrict(subtle, token, noRule).then(function (a) {
            return J.verifyStrict(subtle, token, expectation({ jwk: esPub })).then(function (b) {
              out.rung4.msExpWithoutLifetimeRule = {
                withoutMaxLifetime: { ok: a.ok, code: a.code, reason: a.reason },
                withMaxLifetime: { ok: b.ok, code: b.code, reason: b.reason },
                expSeconds: ms.exp,
                expiryCheckPasses: a.ok === true,
                caughtOnlyByLifetimeRule: a.ok === true && b.code === 'E_LIFETIME'
              };
            });
          });
        })['catch'](function (e) {
          out.rung4.msExpWithoutLifetimeRule = { errName: e && e.name ? String(e.name) : 'Error' };
        });
    });
  }

  function rung5(subtle, P, out, legit, esPub) {
    /* THE CENTREPIECE, and it is not a forgery. malleate takes a string and
       nothing else — it can see no key — and rewrites s as n − s. The token
       differs, the payload segment is byte-identical, both verifiers correctly
       accept it, and a denylist keyed on the token string has a hole in it that
       no verifier can close. */
    var malleated;
    try {
      malleated = P.malleate(legit.token);
    } catch (e) {
      out.rung5 = { failed: true, errName: e && e.name ? String(e.name) : 'Error' };
      return Promise.resolve();
    }

    var op = legit.token.split('.'), mp = String(malleated).split('.');
    var s = B.b64uDecodeStrict(op[2]).slice(32);
    var sPrime = B.b64uDecodeStrict(mp[2]).slice(32);
    var sum = B.addBytes(s, sPrime);
    var ring = { 'k_FIKTIF_es': esPub, 'default': esPub };
    var deny = expectation({ jwk: esPub, denylist: [META.revokedJti] });

    out.rung5 = {
      label: 'the signature verified and it is still not the same token',
      original: legit.token,
      malleated: malleated,
      tokensDiffer: malleated !== legit.token,
      payloadSegmentIdentical: mp[1] === op[1],
      headerSegmentIdentical: mp[0] === op[0],
      sigSegmentsDiffer: mp[2] !== op[2],
      rHex: B.hex(B.b64uDecodeStrict(op[2]).slice(0, 32)),
      sHex: B.hex(s),
      sPrimeHex: B.hex(sPrime),
      /* Route A. The firewall recomputes this from its OWN copy of the order,
         which is why corrupting either copy turns the row red from one side
         while the other stays put. */
      sumHex: B.hex(sum.bytes),
      sumCarry: sum.carry,
      orderHex: B.P256_N_HEX,
      sumEqualsOrder: B.hex(sum.bytes) === B.P256_N_HEX && sum.carry === 0,
      strictOriginal: null, strictMalleated: null, naiveMalleated: null,
      denylistOnTokenString: null, denylistOnJti: null
    };

    return J.verifyStrict(subtle, legit.token, expectation({ jwk: esPub }))
      .then(function (a) { out.rung5.strictOriginal = flatStrict(a); })
      .then(function () { return J.verifyStrict(subtle, malleated, expectation({ jwk: esPub })); })
      .then(function (b) { out.rung5.strictMalleated = flatStrict(b); })
      .then(function () { return J.verifyNaive(subtle, malleated, ring); })
      .then(function (n) { out.rung5.naiveMalleated = flatNaive(n); })
      .then(function () { return J.verifyStrict(subtle, malleated, deny); })
      .then(function (d) {
        var list = [legit.token], i, hit = false;
        for (i = 0; i < list.length; i++) if (list[i] === malleated) hit = true;
        out.rung5.denylistOnTokenString = {
          keyedOn: 'the token string', listSize: list.length,
          refused: hit,
          note: 'the malleated token is not in the list'
        };
        out.rung5.denylistOnJti = {
          keyedOn: 'jti, which is inside the signed payload',
          refused: d.ok === false, code: d.code, reason: d.reason
        };
      })
      ['catch'](function (e) {
        out.rung5.failed = true;
        out.rung5.errName = e && e.name ? String(e.name) : 'Error';
      });
  }

  /* Standard-alphabet base64 with padding, for the PEM shapes only. It is NOT
     the lab's base64url encoder and never touches a token: PEM is the one place
     in this file where the wrong alphabet is the right answer. */
  function b64Standard(bytes) {
    var alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '', i, n, c;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += alpha.charAt((n >> 18) & 63) + alpha.charAt((n >> 12) & 63) +
        alpha.charAt((n >> 6) & 63) + alpha.charAt(n & 63);
    }
    c = bytes.length - i;
    if (c === 1) {
      n = bytes[i] << 16;
      out += alpha.charAt((n >> 18) & 63) + alpha.charAt((n >> 12) & 63) + '==';
    } else if (c === 2) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += alpha.charAt((n >> 18) & 63) + alpha.charAt((n >> 12) & 63) + alpha.charAt((n >> 6) & 63) + '=';
    }
    return out;
  }

  /* The second verification route. It arrives as an optional global, it is
     handed tokens as STRINGS and keys as JWK JSON TEXT, and it re-splits,
     re-decodes, re-parses and re-imports everything itself. Route B never
     receives an object route A held. Both figures and their difference go into
     the fixture, because two routes that agree are worth something and one
     route printed twice is worth nothing. */
  function buildRoutes(subtle, keys, legit) {
    var K = root.SAHIH_PERIKSA;
    if (!K) {
      return Promise.resolve({
        pending: 'SAHIH_PERIKSA',
        note: 'the firewall has not loaded; route B is empty by construction, not by failure',
        rows: [], refusals: [], sharedBottom: 'crypto.subtle.verify'
      });
    }

    var out = { pending: null, rows: [], refusals: [], sharedBottom: 'crypto.subtle.verify' };
    var ex = expectation({ jwk: null });

    return Promise.resolve(K.check(subtle, legit.token, keys.es.pubJwkText, ex))
      .then(function (r) {
        out.rows.push({
          claim: 'the legitimate token verifies',
          routeA: legit.strict.ok,
          routeB: r && r.ok === true,
          agree: legit.strict.ok === (r && r.ok === true),
          routeBCode: r && r.code ? String(r.code) : null
        });
      })
      .then(function () {
        return Promise.resolve(K.jtiOf(legit.token)).then(function (jti) {
          out.rows.push({
            claim: 'the jti inside the signed payload',
            routeA: legit.payload ? legit.payload.jti : null,
            routeB: jti === undefined ? null : String(jti),
            agree: (legit.payload ? legit.payload.jti : null) === jti
          });
        });
      })
      .then(function () {
        /* The two decoders are cross-checked ON THE PUBLISHED VECTOR, never
           against each other in general — general agreement would collapse the
           firewall into one route wearing two names. */
        var seg = V.JWS_A1.headerSeg;
        return Promise.resolve(K.decode(seg)).then(function (b) {
          var hexB = typeof b === 'string' ? b : B.hex(b);
          out.rows.push({
            claim: 'RFC 7515 A.1 header segment decodes to the published bytes',
            routeA: B.hex(B.b64uDecodeStrict(seg)),
            routeB: hexB,
            agree: B.hex(B.b64uDecodeStrict(seg)) === hexB,
            pinnedOn: V.JWS_A1.rfc + ' ' + V.JWS_A1.section
          });
        });
      })
      .then(function () {
        out.orderCrossCheck = {
          routeA: B.P256_N_HEX,
          routeB: K.P256_N_HEX ? String(K.P256_N_HEX) : null,
          published: V.P256_ORDER.hex,
          routeAMatchesPublished: B.P256_N_HEX === V.P256_ORDER.hex,
          routeBMatchesPublished: String(K.P256_N_HEX) === V.P256_ORDER.hex,
          note: 'each copy is checked against the published order, never against the other'
        };
        return out;
      })
      ['catch'](function (e) {
        out.failed = true;
        out.errName = e && e.name ? String(e.name) : 'Error';
        out.errMessage = e && e.message ? String(e.message) : '';
        return out;
      });
  }

  /* ---------------------------------------------------- the plainness walk */

  /* C10 again, from the other side. Nothing built above can be an unclonable
     value, so this walk should always come back empty — which is exactly why it
     runs: a rule that is merely obeyed is not a rule that is checked, and the
     failure mode it guards against is silent. */
  function walkPlain(node, path, state) {
    var t = Object.prototype.toString.call(node), k, i;
    state.walked++;
    if (node === null) return;
    if (t === '[object String]' || t === '[object Number]' || t === '[object Boolean]') return;
    if (t === '[object Array]') {
      for (i = 0; i < node.length; i++) walkPlain(node[i], path + '[' + i + ']', state);
      return;
    }
    if (t === '[object Object]') {
      for (k in node) if (Object.prototype.hasOwnProperty.call(node, k)) {
        walkPlain(node[k], path + '.' + k, state);
      }
      return;
    }
    if (node === undefined) { state.offenders.push({ path: path, kind: 'undefined' }); return; }
    state.offenders.push({ path: path, kind: t });
  }

  /* A stable fingerprint, taken as a VALUE. The suite takes one before its
     groups run and one after, and asserts they are equal; capturing "before"
     after the fact is the second most popular way to build a proof that cannot
     fail, so it is taken here and handed over rather than recomputed later from
     a getter. Keys are sorted so object iteration order cannot move it. */
  function fingerprint(node) {
    var t = Object.prototype.toString.call(node), keys, i, parts;
    if (node === null) return 'null';
    if (t === '[object String]') return JSON.stringify(node);
    if (t === '[object Number]' || t === '[object Boolean]') return String(node);
    if (t === '[object Array]') {
      parts = [];
      for (i = 0; i < node.length; i++) parts.push(fingerprint(node[i]));
      return '[' + parts.join(',') + ']';
    }
    if (t === '[object Object]') {
      keys = [];
      for (i in node) if (Object.prototype.hasOwnProperty.call(node, i)) keys.push(i);
      keys.sort();
      parts = [];
      for (i = 0; i < keys.length; i++) parts.push(JSON.stringify(keys[i]) + ':' + fingerprint(node[keys[i]]));
      return '{' + parts.join(',') + '}';
    }
    return '<' + t + '>';
  }

  /* ---------------------------------------------------------------- build */

  function build(subtle, opts) {
    var F = {
      meta: copy(META),
      /* One branded measurement, present so the timing tripwire has something
         to be live against. The suite asserts that no assertion helper ever
         touched a branded operand AND that at least one exists — a guard that
         has never had anything to guard is indistinguishable from a guard that
         does not work. It carries no clock reading, because this file reads no
         clock: samples are empty and n is zero, and the page never prints it as
         a measurement of anything. */
      waktu: {
        selfTest: {
          __waktu__: true, mean: 0, n: 0, samples: [],
          note: 'a deliberately empty measurement, present so the timing tripwire is provably live; this file reads no clock'
        }
      }
    };

    return buildKeys(subtle, opts)
      .then(function (keys) { F.keys = keys; return buildLegit(subtle, keys); })
      .then(function (legit) { F.legit = legit; return buildDiscriminate(subtle, F.keys, legit); })
      .then(function (rows) { F.discriminate = rows; return buildBytes(subtle, F.keys); })
      .then(function (b) { F.bytes = b; return buildVectors(subtle); })
      .then(function (v) { F.vectors = v; return buildDeterminism(subtle, F.keys); })
      .then(function (d) { F.determinism = d.rows; F.es256Distinct = d.es256; return buildCapability(subtle, F.keys); })
      .then(function (c) { F.capability = c.rows; F.subtleMethods = c.subtleMethods; F.hasTimingSafeEqual = c.hasTimingSafeEqual; return buildForge(subtle, F.keys, F.legit); })
      .then(function (f) { F.forge = f; return buildRoutes(subtle, F.keys, F.legit); })
      .then(function (r) {
        F.routes = r;
        var state = { walked: 0, offenders: [] };
        walkPlain(F, '$', state);
        F.plainness = { walked: state.walked, offenders: state.offenders };
        /* Taken as a VALUE, before the field that carries it exists, and handed
           over rather than recomputed later from a getter. The suite compares
           fingerprint(F) before its groups run against fingerprint(F) after. */
        F.fingerprintAtBuild = fingerprint(F);
        return F;
      });
  }

  NS.build = build;
  NS.fingerprint = fingerprint;
  NS.NOW = NOW;
  NS.META = META;
  NS.basePayload = basePayload;
  NS.expectation = expectation;

  root.SAHIH_FIXTURE = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_FIXTURE;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
