/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — jose.js
 * The issuer and the two verifiers. DOM-free, storage-free, clock-free.
 *
 * crypto.subtle is the FIRST ARGUMENT of every exported call and this file
 * holds no key cache. That is not tidiness. A verifier that reaches for a key
 * object the signer left lying around cannot fail the only test worth running,
 * and this portfolio has already shipped a proof that could only pass. Handing
 * the API in means the suite can hand in a different one, and means nothing in
 * here can quietly agree with itself.
 *
 * ================= THE TWO VERIFIERS, AND WHY BOTH ARE REAL =================
 *
 * verifyNaive is the vulnerable one and it is NOT a straw man. It is a working,
 * discriminating verifier: it refuses a corrupt signature, a truncated token, a
 * header that is not JSON, and a signature over a different payload — five
 * refusals the page shows BEFORE it shows the sixth token being accepted. A
 * vulnerable verifier that says yes to everything proves nothing about any
 * attack, and every forgery card built on one is a fact about a broken toy.
 *
 * Its defect is a single line, and it is the line three lines of tutorial code
 * always contain: it lets the TOKEN choose the algorithm and, failing that, the
 * key. `alg = hdr.alg` and `key = hdr.jwk || keyring[hdr.kid] || keyring.default`
 * are the whole vulnerability. Everything else about it is fine.
 *
 * verifyStrict decides the algorithm and the key from its own configuration
 * before it looks at the token at all, and returns its checklist AS DATA — an
 * array of rows, not a boolean and not a thrown error. The page renders
 * checks.length rather than a typed number, which is why no heading here can
 * drift away from the list it describes. Every row before the signature row is
 * decided before any key work happens; that ordering is the design and the
 * suite asserts it by asserting the signature row reports "not reached".
 *
 * ================== WHAT THE KEYRING IS, AND WHY IT IS ODD ==================
 *
 * A naive keyring entry may carry BOTH a public JWK and the raw bytes the toy
 * endpoint keeps on disk, because that is precisely the shape the algorithm
 * confusion attack needs: one stored thing, interpreted according to whatever
 * the token says it is. `jwt.verify(token, keyOrSecret)` with one polymorphic
 * key parameter is the vulnerable API, and modelling it with two separate
 * parameters would quietly delete the bug before demonstrating it.
 *
 * Worth saying plainly, because the page says it too: crypto.subtle is the one
 * place that attack is structurally impossible. subtle.verify(algorithm, key, …)
 * takes the algorithm and the key as arguments the token cannot reach. This
 * file has to hand-build the vulnerable shape in order to have one at all.
 *
 * ============================ THE ISSUER REFUSES ============================
 *
 * issue() throws — synchronously, before any promise exists, so a synchronous
 * throws() helper can catch it — on a payload whose iss does not end .invalid
 * or whose sub does not begin u_FIKTIF_. That is the transposition of the
 * database lab's CHECK (is_demo = 1): the issuer is structurally incapable of
 * minting a token that claims to be real, the refusal is reproducible on the
 * page by trying it, and it is asserted rather than promised in a banner.
 *
 * ============================== C11, EVERYWHERE =============================
 *
 * A dropped promise rejection is a pageerror, and the CI runner exits 1 on one
 * pageerror with every assertion green. Every subtle call below therefore ends
 * in a catch that turns the rejection into a value: a refusal row carrying the
 * error's NAME. Never its message — a browser release must not be able to turn
 * a security suite red for a reason that has nothing to do with this code.
 */
(function (root) {
  'use strict';

  var B = root.SAHIH_BYTES;
  if (!B) throw new Error('sahih/jose.js: SAHIH_BYTES must load first');

  var NS = {};

  /* ------------------------------------------------------- the alg table */

  /* JWS alg name → what WebCrypto wants at import, sign and verify. Kept as
     data so the naive verifier can restrict itself to three of these rows and
     the determinism table can walk all five, without either of them growing its
     own copy of the mapping. */
  var ALG = {
    HS256: {
      jws: 'HS256', kty: 'oct', deterministic: true,
      importAlg: { name: 'HMAC', hash: { name: 'SHA-256' } },
      op: { name: 'HMAC' },
      sigBytes: 32
    },
    RS256: {
      jws: 'RS256', kty: 'RSA', deterministic: true,
      importAlg: { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
      op: { name: 'RSASSA-PKCS1-v1_5' },
      sigBytes: 256
    },
    PS256: {
      jws: 'PS256', kty: 'RSA', deterministic: false,
      importAlg: { name: 'RSA-PSS', hash: { name: 'SHA-256' } },
      op: { name: 'RSA-PSS', saltLength: 32 },
      sigBytes: 256
    },
    ES256: {
      jws: 'ES256', kty: 'EC', deterministic: false,
      importAlg: { name: 'ECDSA', namedCurve: 'P-256' },
      op: { name: 'ECDSA', hash: { name: 'SHA-256' } },
      sigBytes: 64
    },
    /* RFC 8037 names this EdDSA in the alg header; the WebCrypto algorithm is
       'Ed25519'. Present only for the determinism table, where it is the one
       modern signature scheme that is deterministic by construction rather than
       by the accident of PKCS#1 v1.5 having no nonce. */
    EdDSA: {
      jws: 'EdDSA', kty: 'OKP', deterministic: true,
      importAlg: { name: 'Ed25519' },
      op: { name: 'Ed25519' },
      sigBytes: 64
    }
  };

  /* The naive verifier's switch handles three of the five and nothing else.
     Listed here rather than inline so the page can print the list and so the
     gap is visible instead of implied. */
  var NAIVE_ALGS = ['HS256', 'RS256', 'ES256'];

  function algParams(alg) {
    return Object.prototype.hasOwnProperty.call(ALG, alg) ? ALG[alg] : null;
  }

  function naiveHandles(alg) {
    var i;
    for (i = 0; i < NAIVE_ALGS.length; i++) if (NAIVE_ALGS[i] === alg) return true;
    return false;
  }

  /* --------------------------------------------------------- key plumbing */

  function asJwk(x) {
    /* Keys cross into this file as JWK objects or as JWK JSON TEXT, never as a
       CryptoKey. Text is accepted because the firewall file hands text around
       and the page prints text; parsing it here means one shape of key reaches
       importKey no matter which route asked. */
    if (typeof x === 'string') { return JSON.parse(x); }
    return x;
  }

  function importJwk(subtle, jwk, alg, usages) {
    var d = algParams(alg);
    if (!d) return Promise.reject(new Error('sahih: unknown alg ' + alg));
    return subtle.importKey('jwk', asJwk(jwk), d.importAlg, false, usages);
  }

  function importRaw(subtle, bytes, alg, usages) {
    var d = algParams(alg);
    if (!d) return Promise.reject(new Error('sahih: unknown alg ' + alg));
    return subtle.importKey('raw', bytes, d.importAlg, false, usages);
  }

  function signBytes(subtle, key, alg, bytes) {
    var d = algParams(alg);
    return subtle.sign(d.op, key, bytes).then(function (buf) { return new Uint8Array(buf); });
  }

  function verifyBytes(subtle, key, alg, sig, bytes) {
    var d = algParams(alg);
    return subtle.verify(d.op, key, sig, bytes);
  }

  /* --------------------------------------------------------- the issuer */

  function issue(subtle, jwkPriv, alg, payload) {
    var d, jwk, hdr, headerSeg, payloadSeg, signingInput;

    /* Synchronous, and before anything else, so that a synchronous throws()
       helper catches it and so that no promise exists to be dropped. The order
       matters for the page too: the Issue tab's refusal appears instantly, with
       no crypto having run, which is the visible shape of a structural rule
       rather than a validation step somewhere in the middle. */
    if (!payload || typeof payload !== 'object') {
      throw new Error('sahih: issue refuses. a payload object is required');
    }
    if (!/\.invalid$/.test(String(payload.iss))) {
      throw new Error('sahih: issue refuses. iss must end in .invalid (RFC 2606 reserved)');
    }
    if (!/^u_FIKTIF_/.test(String(payload.sub))) {
      throw new Error('sahih: issue refuses. sub must begin u_FIKTIF_');
    }
    d = algParams(alg);
    if (!d) throw new Error('sahih: issue refuses. this issuer does not know alg ' + alg);

    jwk = asJwk(jwkPriv);
    hdr = { alg: alg, typ: 'JWT' };
    /* The key names itself. A kid invented by the issuer at signing time would
       be a kid the verifier could not have pinned in advance, which is the
       whole failure mode check 7 exists to refuse. */
    if (jwk && jwk.kid) hdr.kid = jwk.kid;

    headerSeg = B.b64uEncode(B.utf8Encode(JSON.stringify(hdr)));
    payloadSeg = B.b64uEncode(B.utf8Encode(JSON.stringify(payload)));
    signingInput = headerSeg + '.' + payloadSeg;

    return importJwk(subtle, jwk, alg, ['sign'])
      .then(function (key) { return signBytes(subtle, key, alg, B.utf8Encode(signingInput)); })
      .then(function (sig) { return signingInput + '.' + B.b64uEncode(sig); });
  }

  /* --------------------------------------------------- the naive verifier */

  function naiveResult(ok, why, claims) {
    return {
      ok: ok,
      why: why,
      claims: claims || null,
      roleSeen: claims && typeof claims.role === 'string' ? claims.role : null
    };
  }

  function verifyNaive(subtle, token, keyring) {
    var parts, hdr, claims, entry, jwk, alg, d, keySource, ring = keyring || {};

    parts = String(token).split('.');
    if (parts.length !== 3) return Promise.resolve(naiveResult(false, 'segments', null));

    try {
      hdr = JSON.parse(B.utf8Decode(B.b64uDecodeLoose(parts[0])));
    } catch (e) {
      return Promise.resolve(naiveResult(false, 'header', null));
    }
    if (!hdr || typeof hdr !== 'object' || Object.prototype.toString.call(hdr) === '[object Array]') {
      return Promise.resolve(naiveResult(false, 'header', null));
    }

    try {
      claims = JSON.parse(B.utf8Decode(B.b64uDecodeLoose(parts[1])));
    } catch (e2) {
      claims = null;
    }

    /* The three-way check, spelled the way a real library had it, and it is an
       admission about this code rather than a measurement of anything: it
       accepts three spellings of "none" and misses two. nOnE and nonE walk
       straight past it into the signature branch and are refused there — by
       accident, not by design, which is the worst way to be right. The page
       asserts the miss rather than describing it. */
    if (hdr.alg === 'none' || hdr.alg === 'None' || hdr.alg === 'NONE') {
      return Promise.resolve(naiveResult(true, 'alg=none branch, no signature checked', claims));
    }

    /* The vulnerability, in one line: the token names the key. hdr.jwk first,
       then a kid lookup, then a silent fallback to the default entry — so an
       unknown kid does not refuse, it downgrades. */
    entry = hdr.jwk || (hdr.kid && ring[hdr.kid]) || ring['default'];
    if (!entry) return Promise.resolve(naiveResult(false, 'key', claims));

    /* Which of those three arms actually answered. This used to be dropped on
       the floor and every acceptance said "signature verified under
       header-supplied key" — including the legitimate token, whose key came
       out of the keyring and never out of the header. A reason string that is
       the same on the honest token and on rung 3 is not a reason; it is a
       label, and it made the one assertion that claims rung 3 "says exactly
       why" true of nothing. Naming the arm is what makes that sentence carry
       its own weight, and it is the only thing that tells the reader that an
       unknown kid did not refuse — it downgraded to the default. */
    keySource = hdr.jwk ? 'header-supplied key'
      : ((hdr.kid && ring[hdr.kid]) ? 'the key the kid named' : 'the default keyring entry');

    /* And the second half of it: the token names the algorithm. */
    alg = hdr.alg;
    if (!naiveHandles(alg)) return Promise.resolve(naiveResult(false, 'alg', claims));
    d = algParams(alg);

    return Promise.resolve()
      .then(function () {
        /* One stored thing, interpreted by whatever the token said it was.
           storedB64u is the toy endpoint's key file; for HS256 it is imported
           as a raw MAC secret, which is how a public key becomes a shared
           secret without anybody deciding that it should. */
        if (entry.storedB64u && alg === 'HS256') {
          return importRaw(subtle, B.b64uDecodeStrict(entry.storedB64u), alg, ['verify']);
        }
        jwk = entry.kty ? entry : entry.jwk;
        if (!jwk) throw new Error('sahih: naive keyring entry carries no usable key');
        return importJwk(subtle, jwk, alg, ['verify']);
      })
      .then(function (key) {
        return verifyBytes(subtle, key, alg,
          B.b64uDecodeLoose(parts[2]), B.utf8Encode(parts[0] + '.' + parts[1]));
      })
      .then(function (good) {
        if (!good) return naiveResult(false, 'signature', claims);
        return naiveResult(true, 'signature verified under ' + keySource, claims);
      })
      ['catch'](function (e) {
        /* Every rejection route ends here as a VALUE. An import that throws
           because the token asked for a key shape the bytes cannot be is still
           a refused token, not a broken page. The error's name is kept as
           observed data; its wording is the engine's and is never asserted. */
        return {
          ok: false, why: 'signature', claims: claims || null,
          roleSeen: claims && typeof claims.role === 'string' ? claims.role : null,
          errName: e && e.name ? e.name : 'Error'
        };
      });
  }

  /* -------------------------------------------------- the strict verifier */

  /* The checklist, as data. Sixteen rows: twelve numbered checks and the four
     claim checks that the spec's row 13 splits into. Nothing prints the count
     from a literal — the page renders checks.length, so a row added here shows
     up in the heading without anybody remembering to edit the heading. */
  var CHECKS = [
    { name: 'three segments', code: 'E_SEGMENTS' },
    { name: 'segments are strict base64url', code: 'E_B64' },
    { name: 'header parses as a JSON object', code: 'E_JSON' },
    { name: 'header.typ', code: 'E_TYP' },
    { name: 'header.alg equals the pinned algorithm', code: 'E_ALG' },
    { name: 'header supplies no key material', code: 'E_HDR_KEY' },
    { name: 'header.kid resolves in the fixed keyring', code: 'E_KID' },
    { name: 'the verification key is a public key', code: 'E_PRIVATE_KEY' },
    { name: 'signature verifies', code: 'E_SIG' },
    { name: 'exp is present', code: 'E_EXP_MISSING' },
    { name: 'exp is in the future', code: 'E_EXPIRED' },
    { name: 'the lifetime is bounded', code: 'E_LIFETIME' },
    { name: 'nbf', code: 'E_NBF' },
    { name: 'iss', code: 'E_ISS' },
    { name: 'aud', code: 'E_AUD' },
    { name: 'jti', code: 'E_REVOKED' }
  ];

  /* The header members that name key material. jku and x5u name a URL to fetch
     a key set from; this page ships connect-src 'none' and could not fetch one
     if it wanted to, so refusing them here costs nothing — which is exactly why
     it is worth pointing at. On a real server that refusal is a decision
     somebody has to remember to make. */
  var KEY_MEMBERS = ['jwk', 'jku', 'x5u', 'x5c'];

  function newSheet() {
    var rows = [], i;
    for (i = 0; i < CHECKS.length; i++) {
      rows.push({
        name: CHECKS[i].name, code: null, ok: null, reached: false,
        saw: 'not reached', skipped: false
      });
    }
    return rows;
  }

  function pass(rows, i, saw) {
    rows[i].ok = true; rows[i].reached = true; rows[i].saw = String(saw);
    return true;
  }

  function skip(rows, i, saw) {
    rows[i].ok = true; rows[i].reached = true; rows[i].skipped = true;
    rows[i].saw = String(saw);
    return true;
  }

  function fail(rows, i, message) {
    rows[i].ok = false; rows[i].reached = true;
    rows[i].code = CHECKS[i].code;
    rows[i].saw = CHECKS[i].code + ': ' + message;
    return {
      ok: false,
      code: CHECKS[i].code,
      reason: CHECKS[i].code + ': ' + message,
      failedAt: i + 1,
      checks: rows,
      header: null,
      claims: null
    };
  }

  function done(rows, hdr, claims) {
    return {
      ok: true, code: null, reason: null, failedAt: 0,
      checks: rows, header: hdr, claims: claims
    };
  }

  function segmentRefusal(rows, index, err) {
    /* The verbatim wording the build spec pins belongs to the non-canonical
       case, which is the one the twin panel exercises. The other three reasons
       get their own phrasing rather than being flattened into a sentence that
       would be false for them. */
    if (err && err.reason === B.B64_TAIL) {
      return fail(rows, 1, 'segment ' + index +
        ' is not canonical base64url (it re-encodes to a different string)');
    }
    return fail(rows, 1, 'segment ' + index + ' is not strict base64url (' +
      (err && err.reason ? err.reason : 'refused') + ')');
  }

  function verifyStrict(subtle, token, expect) {
    var rows = newSheet(), x = expect || {}, parts, i, bytes = [], hdr, claims, vjwk, d;

    /* ---- 1. three segments */
    parts = String(token).split('.');
    if (parts.length !== 3) {
      return Promise.resolve(fail(rows, 0,
        'a compact JWS has three segments; this one has ' + parts.length));
    }
    if (parts[0] === '' || parts[1] === '') {
      return Promise.resolve(fail(rows, 0,
        'a compact JWS has three segments; this one has an empty segment ' +
        (parts[0] === '' ? '0' : '1')));
    }
    /* An empty THIRD segment is what an unsecured token looks like, and it is
       deliberately allowed past this row. Refusing it here would print a
       checklist blaming the shape of the token, when the wrong thing is the
       algorithm — and the reader would learn the wrong lesson from a green
       page. It is refused four rows down, by name, with the alg in the message. */
    pass(rows, 0, 'three segments, signature segment ' +
      (parts[2] === '' ? 'empty' : parts[2].length + ' chars'));

    /* ---- 2. strict base64url */
    for (i = 0; i < 3; i++) {
      try {
        bytes[i] = B.b64uDecodeStrict(parts[i]);
      } catch (e) {
        return Promise.resolve(segmentRefusal(rows, i, e));
      }
    }
    pass(rows, 1, bytes[0].length + '/' + bytes[1].length + '/' + bytes[2].length + ' bytes');

    /* ---- 3. header (and payload) parse as JSON objects */
    try {
      hdr = JSON.parse(B.utf8Decode(bytes[0]));
    } catch (e3) {
      return Promise.resolve(fail(rows, 2, 'the header did not parse as a JSON object'));
    }
    if (!hdr || typeof hdr !== 'object' ||
      Object.prototype.toString.call(hdr) === '[object Array]') {
      return Promise.resolve(fail(rows, 2, 'the header did not parse as a JSON object'));
    }
    try {
      claims = JSON.parse(B.utf8Decode(bytes[1]));
    } catch (e4) {
      return Promise.resolve(fail(rows, 2, 'the payload did not parse as a JSON object'));
    }
    if (!claims || typeof claims !== 'object' ||
      Object.prototype.toString.call(claims) === '[object Array]') {
      return Promise.resolve(fail(rows, 2, 'the payload did not parse as a JSON object'));
    }
    pass(rows, 2, 'header and payload are JSON objects');

    /* ---- 4. typ */
    if (hdr.typ !== 'JWT') {
      return Promise.resolve(fail(rows, 3,
        'header typ="' + String(hdr.typ) + '", this endpoint accepts only "JWT"'));
    }
    pass(rows, 3, 'typ="JWT"');

    /* ---- 5. alg, and this row is the whole design.
       A plain string compare against a value this endpoint decided before the
       token existed. Note what is NOT here: no case folding, no alias list, no
       "if the token did not say, assume". JSON.parse keeps the LAST duplicate
       key, so a header whose first eight characters read alg:"ES256" can still
       arrive here as "none"; this compares what parsed, not what it looked
       like. And it happens four rows before any key is touched. */
    if (hdr.alg !== x.alg) {
      return Promise.resolve(fail(rows, 4,
        'token declares alg="' + String(hdr.alg) + '", this endpoint accepts only ' + String(x.alg)));
    }
    pass(rows, 4, 'alg="' + hdr.alg + '"');

    /* ---- 6. the header supplies no key material */
    for (i = 0; i < KEY_MEMBERS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(hdr, KEY_MEMBERS[i])) {
        return Promise.resolve(fail(rows, 5, 'the header carries a "' + KEY_MEMBERS[i] +
          '" member; this endpoint takes its key from its own configuration and never from the token'));
      }
    }
    pass(rows, 5, 'no jwk, jku, x5u or x5c');

    /* ---- 7. kid. An unknown kid REFUSES. It does not fall back to a default,
       which is the single line that differs from the naive verifier above. */
    if (x.kid == null) {
      skip(rows, 6, 'no kid pinned by this endpoint');
    } else if (hdr.kid !== x.kid) {
      return Promise.resolve(fail(rows, 6, 'kid="' + String(hdr.kid) +
        '" is not the key this endpoint verifies with (' + String(x.kid) + ')'));
    } else {
      pass(rows, 6, 'kid="' + hdr.kid + '"');
    }

    /* ---- 8. the verification key is a public key.
       This lab's own rule, applied BEFORE importKey, so the refusal that
       reaches the page is one this repository made and can be held to. Chromium
       does refuse a private JWK offered for verification, with its own name and
       its own wording, and that is printed elsewhere as observed data — but a
       browser's error string is not something a security suite may assert. */
    vjwk = x.jwk ? asJwk(x.jwk) : null;
    if (vjwk && Object.prototype.hasOwnProperty.call(vjwk, 'd')) {
      return Promise.resolve(fail(rows, 7,
        'a JWK carrying a "d" member was offered as a verification key'));
    }
    if (!vjwk) {
      skip(rows, 7, 'no verification key configured');
    } else {
      pass(rows, 7, 'kty="' + String(vjwk.kty) + '", no private component');
    }

    /* ---- 9. the signature, at last */
    d = algParams(x.alg);
    if (!d) {
      return Promise.resolve(fail(rows, 8,
        'this endpoint is pinned to an algorithm it does not implement: ' + String(x.alg)));
    }
    if (!vjwk) {
      return Promise.resolve(fail(rows, 8,
        'no verification key is configured for ' + String(x.alg)));
    }

    return importJwk(subtle, vjwk, x.alg, ['verify'])
      .then(function (key) {
        return verifyBytes(subtle, key, x.alg, bytes[2],
          B.utf8Encode(parts[0] + '.' + parts[1]));
      })
      ['catch'](function (e) {
        /* A rejection here is a refusal, never a page failure. The name is kept
           so the panel can print it; the boolean below is what decides. */
        rows[8].errName = e && e.name ? e.name : 'Error';
        return false;
      })
      .then(function (good) {
        if (!good) {
          return fail(rows, 8, 'the signature does not verify under ' +
            String(x.alg) + ' and ' + String(x.kid == null ? 'this endpoint\'s key' : x.kid));
        }
        pass(rows, 8, 'true');
        return claimChecks(rows, x, hdr, claims);
      });
  }

  /* The claim rows. They run only after the signature verified, which is the
     order that makes the Claims tab worth building: every token on it is
     correctly signed and every one of them is refused here. */
  function claimChecks(rows, x, hdr, claims) {
    var lifetime;

    if (x.claims === false) {
      skip(rows, 9, 'claim checks disabled for this route');
      skip(rows, 10, 'claim checks disabled for this route');
      skip(rows, 11, 'claim checks disabled for this route');
      skip(rows, 12, 'claim checks disabled for this route');
      skip(rows, 13, 'claim checks disabled for this route');
      skip(rows, 14, 'claim checks disabled for this route');
      skip(rows, 15, 'claim checks disabled for this route');
      return done(rows, hdr, claims);
    }

    /* ---- 10. exp present */
    if (typeof claims.exp !== 'number') return fail(rows, 9, 'no exp claim');
    pass(rows, 9, 'exp=' + claims.exp);

    /* ---- 11. exp in the future */
    if (typeof x.now !== 'number') {
      skip(rows, 10, 'no clock supplied to this endpoint');
    } else if (!(x.now < claims.exp + (x.skewSec || 0))) {
      return fail(rows, 10, 'exp=' + claims.exp + ', now=' + x.now +
        ', expired ' + (x.now - claims.exp) + 's ago');
    } else {
      pass(rows, 10, 'exp=' + claims.exp + ', now=' + x.now);
    }

    /* ---- 12. the lifetime is bounded.
       A DIFFERENT rule from expiry, and the reason it is here at its own row:
       a token whose exp was written in milliseconds expires in the year 58579,
       and an expiry check passes it. Most verifiers have no rule that catches
       that, because most verifiers only ask whether exp is in the future. */
    if (typeof x.maxLifetimeSec !== 'number') {
      skip(rows, 11, 'no maximum lifetime pinned');
    } else if (typeof claims.iat !== 'number') {
      return fail(rows, 11, 'no iat claim, so the lifetime this token claims is unbounded');
    } else {
      lifetime = claims.exp - claims.iat;
      if (lifetime > x.maxLifetimeSec) {
        return fail(rows, 11, 'exp-iat=' + lifetime + 's exceeds the ' +
          x.maxLifetimeSec + 's maximum this endpoint issues');
      }
      pass(rows, 11, 'exp-iat=' + lifetime + 's');
    }

    /* ---- 13a. nbf */
    if (typeof claims.nbf !== 'number') {
      skip(rows, 12, 'no nbf claim');
    } else if (typeof x.now !== 'number') {
      skip(rows, 12, 'no clock supplied to this endpoint');
    } else if (x.now + (x.skewSec || 0) < claims.nbf) {
      return fail(rows, 12, 'not valid for another ' + (claims.nbf - x.now) + 's');
    } else {
      pass(rows, 12, 'nbf=' + claims.nbf);
    }

    /* ---- 13b. iss */
    if (x.iss == null) {
      skip(rows, 13, 'no issuer pinned');
    } else if (claims.iss !== x.iss) {
      return fail(rows, 13, 'iss="' + String(claims.iss) + '", expected "' + String(x.iss) + '"');
    } else {
      pass(rows, 13, 'iss="' + claims.iss + '"');
    }

    /* ---- 13c. aud */
    if (x.aud == null) {
      skip(rows, 14, 'no audience pinned');
    } else if (!audienceMatches(claims.aud, x.aud)) {
      return fail(rows, 14, 'aud="' + String(claims.aud) + '", expected "' + String(x.aud) + '"');
    } else {
      pass(rows, 14, 'aud="' + String(claims.aud) + '"');
    }

    /* ---- 13d. jti against the denylist.
       Keyed on a claim INSIDE what was signed, and that is the point of the
       whole lab rather than a detail of this row. A denylist keyed on the token
       string has a hole in it that no verifier can close, because the token it
       misses is not defective. */
    if (!x.denylist) {
      skip(rows, 15, 'no denylist configured');
    } else if (onDenylist(x.denylist, claims.jti)) {
      return fail(rows, 15, 'jti="' + String(claims.jti) + '" is on the denylist');
    } else {
      pass(rows, 15, 'jti="' + String(claims.jti) + '"');
    }

    return done(rows, hdr, claims);
  }

  /* RFC 7519 §4.1.3 lets aud be a string or an array of strings. Both accepted,
     because a verifier that handled only the string form would refuse a
     perfectly good token and the reader would learn a rule that is not real. */
  function audienceMatches(aud, want) {
    var i;
    if (Object.prototype.toString.call(aud) === '[object Array]') {
      for (i = 0; i < aud.length; i++) if (aud[i] === want) return true;
      return false;
    }
    return aud === want;
  }

  function onDenylist(list, jti) {
    var i;
    if (typeof jti !== 'string') return false;
    for (i = 0; i < list.length; i++) if (list[i] === jti) return true;
    return false;
  }

  /* ------------------------------------------------------------- exports */

  NS.ALG = ALG;
  NS.NAIVE_ALGS = NAIVE_ALGS;
  NS.CHECKS = CHECKS;
  NS.KEY_MEMBERS = KEY_MEMBERS;
  NS.algParams = algParams;
  NS.naiveHandles = naiveHandles;
  NS.importJwk = importJwk;
  NS.importRaw = importRaw;
  NS.signBytes = signBytes;
  NS.verifyBytes = verifyBytes;
  NS.issue = issue;
  NS.verifyNaive = verifyNaive;
  NS.verifyStrict = verifyStrict;

  root.SAHIH_JOSE = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_JOSE;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
