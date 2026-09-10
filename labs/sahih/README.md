<!--
  Sahih — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only. See /LICENSE.
  https://biassp.github.io/
-->

# Sahih — the signature verified, and the token was still a forgery

**Live:** https://biassp.github.io/labs/sahih/

*Sahih* is Indonesian for valid, sound, authentic — *data yang sahih*. This lab is an
interrogation of the word.

Five tokens go through two verifiers, on the same bytes. Every one of them is *sahih*
in the only sense cryptography can offer: the signature checks out. Four are forgeries
anyway.

That is the whole point, and it is the part that libraries do not do for you. **The
signature is the easy part.** Everything that decides whether a token means what you
think it means — which algorithm you were willing to accept, which key you were willing
to use, whether the claims were ever read — sits outside the signature check, in code
somebody has to write correctly.

---

## Every number below came from a run

| | |
|---|---|
| Assertions | **150 distinct properties, 76 of them negative**, across 12 groups, executing 419 times. 0 failed. |
| Files | 12 |
| Vendored bytes | **0** |
| Network calls | 0 |
| Longest main-thread block | 58–141 ms, measured across four independent reviews |

**This lab vendors nothing.** No WebAssembly, no library, no polyfill, and — unlike its
sibling `labs/rombak/` — not one byte of Content-Security-Policy relaxation. The CSP
here is byte-identical to the other seven labs. Everything runs on `crypto.subtle`,
which the browser already has.

---

## How to run it locally

```bash
git clone https://github.com/biassp/biassp.github.io
cd biassp.github.io
python -m http.server 9080
# then open http://127.0.0.1:9080/labs/sahih/
```

HTTP, not `file://` — the page ships `script-src 'self'` and a `file://` origin is
opaque, so `'self'` can never match. `crypto.subtle` also requires a secure context,
which `http://127.0.0.1` is and a `file://` page is not.

To run the assertions headlessly, from the repository root:

```bash
npm ci && npx playwright install chromium
npm run test:labs
```

---

## The five rungs

Each one is a real token, minted in your tab, run through a naive verifier and a strict
one side by side. The naive verifier is **not a straw man**: the page shows it refusing
five bad tokens before it is ever shown accepting one, because a verifier that accepts
everything demonstrates nothing.

1. **`alg: "none"`.** The header says there is no signature, and the naive verifier
   agrees with the header.
2. **RS256 → HS256 confusion.** The RSA *public* key — the one you publish — used as an
   HMAC secret. Six different serialisations of the same key, because which bytes you
   feed the HMAC decides whether the attack works, and most write-ups pick one and imply
   it is the only one.
3. **The header supplies its own key.** An embedded `jwk` header parameter. No server
   secret is needed at all; the token simply brings the key it wants to be checked
   against.
4. **Correctly signed, and still the wrong answer.** Not a forgery. The signature is
   genuine, the key is right, and the token is still not the one you should accept —
   because nobody read `exp`, `aud`, `iss` or `nbf`.
5. **The token that was never forged.** The centrepiece. Left for you to find on the
   page rather than spoiled here.

---

## What is real, and what is fabricated

### Real

- **The cryptography.** Real RSA-2048 and P-256 ECDSA signatures, real HMAC-SHA-256,
  real key import and export, all through `crypto.subtle`. Nothing is simulated.
- **The published vectors.** Every RFC 6238 Appendix B row and every RFC 7515 A.1 / A.2
  / A.3 vector is computed here and compared against the value the RFC prints. That is
  an external oracle: those numbers were fixed by a standards body years ago and no
  amount of clever code in this repository can make a wrong implementation match them.
- **The key provenance, labelled per key.** The HMAC key comes from
  `crypto.subtle.generateKey` in your tab. The RSA and ECDSA keys are imported from the
  published RFC 7515 A.2 and A.3 test vectors. The Terbit tab says which is which, and
  so does the code — every key carries a `provenance` field.

### Fabricated

Every subject, issuer, audience and claim is invented. No string in this lab is a
credential, and the suite sweeps its own fixtures for anything shaped like one on every
run — see the honest note about that sweep below.

### Not built, stated plainly

- **No password storage.** No PBKDF2 derivation ships here. What does ship is the
  capability boundary: Argon2id, scrypt, bcrypt, BLAKE2b, SHA-3 and MD5 all return
  `NotSupportedError` from `crypto.subtle`, asserted. **PBKDF2 is what a browser can do,
  not what you should use.** Argon2id is the current recommendation for password hashing
  and WebCrypto cannot do it. The page says so rather than implying otherwise.
- **No timing attack.** `performance.now()` in this browser yields three distinct values
  across 200 samples with a 0.1 ms floor. A naive in-browser timing attack cannot be
  measured, so the lab does not stage one. Most such demos are theatre; saying so is
  more useful than joining them. `crypto.subtle` has no `timingSafeEqual` — verified by
  enumerating `SubtleCrypto.prototype`.
- **No sessions, no cookies.** Fixation, rotation, idle-versus-absolute expiry and
  revocation belong to a session lab. The `document.cookie` behaviour table was built
  and then cut: writing a `__Host-` cookie from a lab page sets a real cookie on the
  whole `biassp.github.io` origin, which is not a demo's business.
- **No WebAuthn.** `PublicKeyCredential` exists in the browser but needs an
  authenticator, which headless CI does not have. Nothing here is asserted about it.
- **No server.** Every claim is about what a verifier does with bytes it was handed.
  Nothing here says anything about transport, storage, or the network.

---

## Verification runs on two routes, and the limit is stated

Every check on the page is computed twice by two paths that do not share code, and
`periksa.js` is the firewall — the same role `census.js` plays in `labs/rombak/`. The
greps that prove the separation are in the file's own header, and a reviewer can run
them.

**The limit, admitted rather than hidden:** both routes ultimately call
`crypto.subtle`. That shared dependency is real and cannot be engineered away in a
browser. It was measured rather than hand-waved — with `crypto.subtle.verify` wrapped to
return `true` for every call, 16 of the 419 assertions go red (9 in G5, 6 in G6, 1 in G9)
and every route-agreement check stays green. So the route separation catches a mistake in this lab's logic; it
cannot catch a lie told by the browser's own crypto. That is a smaller claim than
"independently verified", and it is the true one.

### What is still not covered

- **`app.js` has no automated control.** The suite asserts the engines; nothing asserts
  the renderers. During review, a mutation that restored a wrong hardcoded year in the
  page copy left all 419 assertions green — because nothing in `tests.js` can see
  `app.js`'s prose. Every number written into page text is unasserted by construction.
- **One stochastic check remains.** The suite sweeps CSPRNG-derived fixture strings for
  credential-looking shapes. The residual false-positive rate is roughly 1 in 23,000
  page loads and cannot be driven to zero by shape alone: what remains is a generated
  string that begins `sk-` followed by twenty alphanumerics, which is character for
  character what a leaked key looks like. Measured against the real corpus — 5,000
  fixture builds, 400 full runs, zero flagged — and named here rather than hidden.
- **`SAHIH_STORE.keyRoundTrip` is unreachable.** Its panel was cut; the code is dead.

---

## Why 150 properties and not 1,400

Security is the easiest subject on which to manufacture a large number. Forging a
thousand tokens and verifying each one adds a thousand assertions and proves nothing
about the author.

So the same rule as the sibling labs applies: **no assertion may have the browser's own
correctness as its subject.** Every property here is about a decision made in this
repository or a boundary this lab's claims rest on. 76 of the 150 are negative — they
pass only when a verifier refuses — and each uses `throwsWith`, because *"it refused"*
and *"it refused for the reason I claimed"* are different assertions and only the second
catches a decoder rejecting what a signature check was supposed to.

Properties and executions are reported separately, on the badge and here, because they
are different numbers and conflating them flatters the total.

**Every assertion was proved able to go red.** A mutation gate is the acceptance
criterion, not a nice-to-have: deliberate defects are injected one at a time, the suite
is re-run, and any mutation that survives is a hole in the suite rather than a curiosity.
Two tautologies were caught this way during review — assertions gated on the very flag
they claimed to be testing, which could therefore never fail. Both were rewritten.

---

## Why this page shows attacks at all

Every forgery here exists to show the line that stops it, and the strict verifier's
refusal is the last thing on every panel.

It is also structurally harmless. The tokens are this page's own, minted milliseconds
ago, and there is nowhere to paste one in from anywhere else. The page cannot reach the
network — `connect-src 'none'` is a browser refusal, not a promise, and the counter in
the header reads whatever the browser actually let through. There is no tooling here
aimed at anybody's system, and nothing that works on one.

---

## Files

| File | What it is |
|---|---|
| `index.html` | The page. Six panels, all empty — every one shows tokens and JSON, and `<` and `&` in markup is a validator error waiting to happen. |
| `app.css` | Tokens and both themes, every light-theme value carrying its measured contrast ratio. |
| `guard.js` | Theme before first paint, and the five wrapped network APIs. It instruments the **call**, never the outcome: under `connect-src 'none'`, `sendBeacon` still returns `true`. |
| `bytes.js` | The strict base64url decoder, and the lab's own refusal codes. |
| `vectors.js` | The published RFC vectors, verbatim. |
| `jose.js` | The two verifiers. `verifyNaive` and `verifyStrict` are the lab. |
| `palsu.js` | The five forgeries. |
| `fixture.js` | Keys, tokens and claims, each with its provenance. |
| `periksa.js` | The verification firewall. |
| `store.js` | IndexedDB and theme storage, every access wrapped. |
| `tests.js` | The 150 properties. |
| `app.js` | The only file that touches the DOM. |

---

© 2026 Bias Satrio Putra. All rights reserved. Not open source — see
[/LICENSE](../../LICENSE).
