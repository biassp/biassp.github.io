/*!
 * Sahih — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sahih — vectors.js
 * Frozen literals, and nothing else. Below the wrapper on the next line there
 * is no code in this file at all: no branch, no loop, no helper, no derived
 * value. That absence is the point. The expected side of every cryptographic
 * assertion in this lab is a constant somebody else published, and "somebody
 * else published it" is only checkable if it is greppably a constant rather
 * than something this repository computes and then compares against itself.
 *
 * Grepping this file for the keyword that opens a callable finds exactly one
 * line: the IIFE wrapper the house style requires. If it ever finds two, the
 * external oracle has grown an internal opinion.
 *
 * WHAT THESE PIN, AND WHAT THEY DO NOT
 *
 * The governing rule of this suite is that no assertion may have the Web Crypto
 * API's own correctness as its subject. A published vector is admissible only
 * as a pin on THIS lab's composition: its base64url, its signing-input
 * concatenation, its compact serialisation, its counter framing, its dynamic
 * truncation. Reproducing RFC 4231 does not test HMAC-SHA-256; SHA-2 is not on
 * trial and there is nothing this page could do about it if it were. It tests
 * that the bytes this lab hands to the primitive are the bytes the RFC meant.
 *
 * Every value below was recomputed against this repository's own runtime before
 * it was written down, and each entry carries the RFC number and section as a
 * field so provenance prints beside the number rather than living in a comment.
 *
 * TWO ENTRIES ARE NOT PUBLISHED, AND SAY SO IN THEIR OWN FIELDS
 *
 * TOTP_B_MISREAD is a control that is supposed to FAIL. The widely repeated
 * misreading of RFC 6238 is that all three hash modes share the 20-byte ASCII
 * seed; recomputed that way the table matches 6 of 18. Six, not zero, and the
 * card says why: for SHA-1 the misread seed IS the correct seed, so the control
 * only controls the twelve SHA-2 rows. A partial-failure pattern that tracks
 * the spec's own seed-length boundary is a table that has been shown capable of
 * failing, which is the entire reason it ships.
 *
 * TOTP_SYNTHETIC is flagged published:false. No RFC publishes a TOTP vector
 * above 2^32, so the Appendix B table pins the seed handling, the HMAC, the
 * truncation and the modulo — and the eight-byte big-endian counter width not
 * at all. An implementation that writes only the low four bytes reproduces all
 * eighteen published rows. Measured, not assumed. The synthetic row separates
 * them and is labelled on screen as a self-consistency check rather than
 * smuggled in beside the published ones.
 */
(function (root) {
  'use strict';

  var NS = {

    /* ------------------------------------------------------- RFC 7515 A.1 */
    /* HS256. Pins: base64url, the signing-input concatenation, and the fact
       that the header segment is over the RFC's own bytes INCLUDING the CRLF
       and the leading space before "alg". A JWS signs the encoded string, so a
       verifier that re-serialises the header it parsed produces different bytes
       and reproduces nothing. This vector is the one place that is checkable
       against a party outside this repository. */
    JWS_A1: {
      rfc: 'RFC 7515',
      section: 'Appendix A.1',
      published: 2015,
      alg: 'HS256',
      headerJson: '{"typ":"JWT",\r\n "alg":"HS256"}',
      payloadJson: '{"iss":"joe",\r\n "exp":1300819380,\r\n "http://example.com/is_root":true}',
      headerSeg: 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9',
      payloadSeg: 'eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ',
      signature: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      sigBytes: 32,
      jwk: {
        kty: 'oct',
        k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow'
      },
      deterministic: true,
      verifyOnly: false
    },

    /* ------------------------------------------------------- RFC 7515 A.2 */
    /* RS256. The private JWK is reproduced with its d, p, q, dp, dq and qi
       members because that is how the RFC prints it and because a PEM block
       must not appear anywhere in this repository — a fake-looking key in a
       fixture has already had one push rejected here. This key has been public
       since 2015 and signs nothing that exists.

       PKCS#1 v1.5 is deterministic, so the full 342-character compact
       serialisation is reproducible and IS pinned by equality. Its sibling
       PS256 is not, and appears in this lab only in the determinism table where
       it is asserted NOT equal. */
    JWS_A2: {
      rfc: 'RFC 7515',
      section: 'Appendix A.2',
      published: 2015,
      alg: 'RS256',
      headerJson: '{"alg":"RS256"}',
      headerSeg: 'eyJhbGciOiJSUzI1NiJ9',
      payloadSeg: 'eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ',
      signature: 'cC4hiUPoj9Eetdgtv3hF80EGrhuB__dzERat0XF9g2VtQgr9PJbu3XOiZj5RZmh7AAuHIm4Bh-0Qc_lF5YKt_O8W2Fp5jujGbds9uJdbF9CUAr7t1dnZcAcQjbKBYNX4BAynRFdiuB--f_nZLgrnbyTyWzO75vRK5h6xBArLIARNPvkSjtQBMHlb1L07Qe7K0GarZRmB_eSN9383LcOLn6_dO--xi12jzDwusC-eOkHWEsqtFZESc6BfI7noOPqvhJ1phCnvWh6IeYI2w9QOYEUipUTI8np6LbgGY9Fs98rqVt5AXLIhWkWywlVmtVrBp0igcN_IoypGlUPQGe77Rw',
      sigChars: 342,
      sigBytes: 256,
      spkiBytes: 294,
      jwk: {
        kty: 'RSA',
        n: 'ofgWCuLjybRlzo0tZWJjNiuSfb4p4fAkd_wWJcyQoTbji9k0l8W26mPddxHmfHQp-Vaw-4qPCJrcS2mJPMEzP1Pt0Bm4d4QlL-yRT-SFd2lZS-pCgNMsD1W_YpRPEwOWvG6b32690r2jZ47soMZo9wGzjb_7OMg0LOL-bSf63kpaSHSXndS5z5rexMdbBYUsLA9e-KXBdQOS-UTo7WTBEMa2R2CapHg665xsmtdVMTBQY4uDZlxvb3qCo5ZwKh9kG4LT6_I5IhlJH7aGhyxXFvUK-DWNmoudF8NAco9_h9iaGNj8q2ethFkMLs91kzk2PAcDTW9gb54h4FRWyuXpoQ',
        e: 'AQAB',
        d: 'Eq5xpGnNCivDflJsRQBXHx1hdR1k6Ulwe2JZD50LpXyWPEAeP88vLNO97IjlA7_GQ5sLKMgvfTeXZx9SE-7YwVol2NXOoAJe46sui395IW_GO-pWJ1O0BkTGoVEn2bKVRUCgu-GjBVaYLU6f3l9kJfFNS3E0QbVdxzubSu3Mkqzjkn439X0M_V51gfpRLI9JYanrC4D4qAdGcopV_0ZHHzQlBjudU2QvXt4ehNYTCBr6XCLQUShb1juUO1ZdiYoFaFQT5Tw8bGUl_x_jTj3ccPDVZFD9pIuhLhBOneufuBiB4cS98l2SR_RQyGWSeWjnczT0QU91p1DhOVRuOopznQ',
        p: '4BzEEOtIpmVdVEZNCqS7baC4crd0pqnRH_5IB3jw3bcxGn6QLvnEtfdUdiYrqBdss1l58BQ3KhooKeQTa9AB0Hw_Py5PJdTJNPY8cQn7ouZ2KKDcmnPGBY5t7yLc1QlQ5xHdwW1VhvKn-nXqhJTBgIPgtldC-KDV5z-y2XDwGUc',
        q: 'uQPEfgmVtjL0Uyyx88GZFF1fOunH3-7cepKmtH4pxhtCoHqpWmT8YAmZxaewHgHAjLYsp1ZSe7zFYHj7C6ul7TjeLQeZD_YwD66t62wDmpe_HlB-TnBA-njbglfIsRLtXlnDzQkv5dTltRJ11BKBBypeeF6689rjcJIDEz9RWdc',
        dp: 'BwKfV3Akq5_MFZDFZCnW-wzl-CCo83WoZvnLQwCTeDv8uzluRSnm71I3QCLdhrqE2e9YkxvuxdBfpT_PI7Yz-FOKnu1R6HsJeDCjn12Sk3vmAktV2zb34MCdy7cpdTh_YVr7tss2u6vneTwrA86rZtu5Mbr1C1XsmvkxHQAdYo0',
        dq: 'h_96-mK1R_7glhsum81dZxjTnYynPbZpHziZjeeHcXYsXaaMwkOlODsWa7I9xXDoRwbKgB719rrmI2oKr6N3Do9U0ajaHF-NKJnwgjMd2w9cjz3_-kyNlxAr2v4IKhGNpmM5iIgOS1VZnOZ68m6_pbLBSp3nssTdlqvd0tIiTHU',
        qi: 'IYd7DHOhrWvxkwPQsRM2tOgrjbcrfvtQJipd-DlcxyVuuM9sQLdgjVk2oy26F0EmpScGLq2MowX7fhd_QJQ3ydy5cY7YIBi87w93IKLEdfnbJtoOPLUW0ITrJReOgo1cq9SbsxYawBgfp_gh6A5603k2-ZQwVK0JKSHuLFkuQ3U'
      },
      jwkPublic: {
        kty: 'RSA',
        n: 'ofgWCuLjybRlzo0tZWJjNiuSfb4p4fAkd_wWJcyQoTbji9k0l8W26mPddxHmfHQp-Vaw-4qPCJrcS2mJPMEzP1Pt0Bm4d4QlL-yRT-SFd2lZS-pCgNMsD1W_YpRPEwOWvG6b32690r2jZ47soMZo9wGzjb_7OMg0LOL-bSf63kpaSHSXndS5z5rexMdbBYUsLA9e-KXBdQOS-UTo7WTBEMa2R2CapHg665xsmtdVMTBQY4uDZlxvb3qCo5ZwKh9kG4LT6_I5IhlJH7aGhyxXFvUK-DWNmoudF8NAco9_h9iaGNj8q2ethFkMLs91kzk2PAcDTW9gb54h4FRWyuXpoQ',
        e: 'AQAB'
      },
      deterministic: true,
      verifyOnly: false
    },

    /* ------------------------------------------------------- RFC 7515 A.3 */
    /* ES256, and the asymmetry is the interesting part. ECDSA draws a nonce per
       signature, so a correct implementation CANNOT reproduce a published ECDSA
       signature. Any page that claims to has either a deterministic-nonce
       implementation or a lie. So this row is verifyOnly:true, and the
       asymmetry is itself asserted: this lab's two re-signings of the identical
       input differ from the published value AND from each other. */
    JWS_A3: {
      rfc: 'RFC 7515',
      section: 'Appendix A.3',
      published: 2015,
      alg: 'ES256',
      headerJson: '{"alg":"ES256"}',
      headerSeg: 'eyJhbGciOiJFUzI1NiJ9',
      payloadSeg: 'eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ',
      signature: 'DtEhU3ljbEg8L38VWAfUAqOyKAM6-Xx-F4GawxaepmXFCgfTjDxw5djxLa8ISlSApmWQxfKTUJqPP3-Kg6NU1Q',
      sigBytes: 64,
      jwk: {
        kty: 'EC',
        crv: 'P-256',
        x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
        y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
        d: 'jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI'
      },
      jwkPublic: {
        kty: 'EC',
        crv: 'P-256',
        x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
        y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0'
      },
      deterministic: false,
      verifyOnly: true
    },

    /* ------------------------------------------------------ P-256's order */
    /* FIPS 186-4 / SEC 2. Published, not derived, and duplicated on purpose in
       the verification firewall so that corrupting either copy turns the
       s + s' = n arithmetic red from one side while the other stays put. */
    P256_ORDER: {
      spec: 'FIPS 186-4',
      section: 'D.1.2.3 (curve P-256)',
      alsoIn: 'SEC 2 v2, secp256r1',
      hex: 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
      bytes: 32
    },

    /* -------------------------------------------- RFC 6238 Appendix B, all */
    /* Eighteen rows: six timestamps by three hash modes. The published column
       is EIGHT digits. 287082 is not in the RFC — it is the six-digit
       truncation of 94287082, and this lab prints it in a separate column
       labelled as its own truncation, because the one tab whose job is being an
       external oracle must not print a number the oracle does not contain.

       Each mode uses its OWN seed. RFC 6238 §Appendix B's note is explicit and
       widely misread; see TOTP_B_MISREAD below for what the misreading costs. */
    TOTP_B: {
      rfc: 'RFC 6238',
      section: 'Appendix B',
      published: true,
      digits: 8,
      stepSec: 30,
      seeds: {
        SEED_SHA1: { ascii: '12345678901234567890', bytes: 20, hash: 'SHA-1' },
        SEED_SHA256: { ascii: '12345678901234567890123456789012', bytes: 32, hash: 'SHA-256' },
        SEED_SHA512: { ascii: '1234567890123456789012345678901234567890123456789012345678901234', bytes: 64, hash: 'SHA-512' }
      },
      rows: [
        { t: 59, mode: 'SHA-1', seedName: 'SEED_SHA1', published: '94287082' },
        { t: 59, mode: 'SHA-256', seedName: 'SEED_SHA256', published: '46119246' },
        { t: 59, mode: 'SHA-512', seedName: 'SEED_SHA512', published: '90693936' },
        { t: 1111111109, mode: 'SHA-1', seedName: 'SEED_SHA1', published: '07081804' },
        { t: 1111111109, mode: 'SHA-256', seedName: 'SEED_SHA256', published: '68084774' },
        { t: 1111111109, mode: 'SHA-512', seedName: 'SEED_SHA512', published: '25091201' },
        { t: 1111111111, mode: 'SHA-1', seedName: 'SEED_SHA1', published: '14050471' },
        { t: 1111111111, mode: 'SHA-256', seedName: 'SEED_SHA256', published: '67062674' },
        { t: 1111111111, mode: 'SHA-512', seedName: 'SEED_SHA512', published: '99943326' },
        { t: 1234567890, mode: 'SHA-1', seedName: 'SEED_SHA1', published: '89005924' },
        { t: 1234567890, mode: 'SHA-256', seedName: 'SEED_SHA256', published: '91819424' },
        { t: 1234567890, mode: 'SHA-512', seedName: 'SEED_SHA512', published: '93441116' },
        { t: 2000000000, mode: 'SHA-1', seedName: 'SEED_SHA1', published: '69279037' },
        { t: 2000000000, mode: 'SHA-256', seedName: 'SEED_SHA256', published: '90698825' },
        { t: 2000000000, mode: 'SHA-512', seedName: 'SEED_SHA512', published: '38618901' },
        { t: 20000000000, mode: 'SHA-1', seedName: 'SEED_SHA1', published: '65353130' },
        { t: 20000000000, mode: 'SHA-256', seedName: 'SEED_SHA256', published: '77737706' },
        { t: 20000000000, mode: 'SHA-512', seedName: 'SEED_SHA512', published: '47863826' }
      ],
      /* The largest published counter. 20000000000 / 30 = 666666666 = 0x27bc86aa,
         four bytes wide, which the RFC's own table prints as 0000000027BC86AA.
         Nothing in Appendix B reaches 2^32. */
      largestCounter: 666666666,
      largestCounterHex: '0000000027bc86aa'
    },

    /* --------------------------------------- the declared negative control */
    /* Not a mistake in this file. The expected outcome of recomputing the table
       above under the misreading that one 20-byte seed serves all three modes.
       Six matches, and all six are SHA-1 rows where the misread seed happens to
       be the right one — so this controls the twelve SHA-2 rows and nothing
       else, which is stated on the card rather than left for a reader to work
       out. The single worked figure is printed beside the table. */
    TOTP_B_MISREAD: {
      rfc: 'RFC 6238',
      section: 'Appendix B, recomputed under the common misreading',
      published: false,
      negativeControl: true,
      misreadSeedName: 'SEED_SHA1',
      expectedMatches: 6,
      of: 18,
      expectedMatchingMode: 'SHA-1',
      workedRow: { t: 59, mode: 'SHA-256', misread: '32247374', publishedValue: '46119246' }
    },

    /* ------------------------------------------ above 2^32, and not an RFC */
    /* published:false, and the flag is load-bearing. T = 4294967296 is the
       smallest counter a 32-bit implementation cannot hold, so this row is the
       only one in the lab that separates the eight-byte big-endian path from
       the bug that writes four bytes into the low half of the buffer. Both
       expected values below were computed in this repository, which is exactly
       why the row is labelled a self-consistency check and never a pin. */
    TOTP_SYNTHETIC: {
      rfc: null,
      section: 'synthetic, computed in this repository',
      published: false,
      selfConsistency: true,
      t: 128849018880,
      counter: 4294967296,
      counterIs2Pow32: true,
      mode: 'SHA-1',
      seedName: 'SEED_SHA1',
      digits: 8,
      counter8Hex: '0000000100000000',
      counter4Hex: '0000000000000000',
      expected8: '55999456',
      expected32Bug: '84755224',
      separates: true
    },

    /* --------------------------------------------- RFC 4231, cases 1 to 7 */
    /* HMAC-SHA-256 only. HMAC is the HS256 primitive, so these pin something
       this lab actually does: key import at three widths — shorter than the
       block, one block, longer than the block and therefore pre-hashed — and
       the byte framing around it. Case 5 is published truncated to 128 bits and
       carries its own truncTo field rather than a comment nobody reads. */
    HMAC_4231: {
      rfc: 'RFC 4231',
      section: '4.2 to 4.8',
      hash: 'SHA-256',
      cases: [
        { n: 1, note: 'key shorter than the block', keyHex: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b', dataHex: '4869205468657265', dataAscii: 'Hi There', macHex: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7', truncTo: 32 },
        { n: 2, note: 'a four-byte key', keyHex: '4a656665', dataHex: '7768617420646f2079612077616e7420666f72206e6f7468696e673f', dataAscii: 'what do ya want for nothing?', macHex: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', truncTo: 32 },
        { n: 3, note: 'combined length larger than the block', keyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', dataHex: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', dataAscii: null, macHex: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe', truncTo: 32 },
        { n: 4, note: 'a key of increasing byte values', keyHex: '0102030405060708090a0b0c0d0e0f10111213141516171819', dataHex: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd', dataAscii: null, macHex: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b', truncTo: 32 },
        { n: 5, note: 'published truncated to 128 bits', keyHex: '0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c', dataHex: '546573742057697468205472756e636174696f6e', dataAscii: 'Test With Truncation', macHex: 'a3b6167473100ee06e0c796c2955552b', truncTo: 16 },
        { n: 6, note: 'a 131-byte key, hashed first', keyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', dataHex: '54657374205573696e67204c6172676572205468616e20426c6f636b2d53697a65204b6579202d2048617368204b6579204669727374', dataAscii: 'Test Using Larger Than Block-Size Key - Hash Key First', macHex: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54', truncTo: 32 },
        { n: 7, note: 'a 131-byte key and a longer message', keyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', dataHex: '5468697320697320612074657374207573696e672061206c6172676572207468616e20626c6f636b2d73697a65206b657920616e642061206c6172676572207468616e20626c6f636b2d73697a6520646174612e20546865206b6579206e6565647320746f20626520686173686564206265666f7265206265696e6720757365642062792074686520484d414320616c676f726974686d2e', dataAscii: 'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.', macHex: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2', truncTo: 32 }
      ]
    },

    /* --------------------------------------------- the base64url twin pair */
    /* Not published anywhere. Frozen here because it is the input that
       separates the two decoders, and because a page that recomputed BOTH sides
       of that comparison at render time would be comparing a thing to itself.
       The page still recomputes the candidate and collision counts live from
       whatever segment is on screen; these are the expected side.

       The arithmetic is a property of base64 and not of the payload: a segment
       length that is 0 mod 4 leaves no spare bits and has no twin, 3 mod 4
       leaves two spare bits and has three, 2 mod 4 leaves four spare bits and
       has fifteen. There are always 63 substitutions to try. The signature over
       a twin is false, and that is correct — JWS signs the encoded string. The
       exposure is that a jti store, a replay cache or a log line keyed on the
       DECODED payload disagrees with the MAC about how many tokens exist. */
    B64U_TWIN: {
      source: 'this repository',
      published: false,
      payloadJson: '{"sub":"u_FIKTIF_1042","role":"member","pad":"xx"}',
      segment: 'eyJzdWIiOiJ1X0ZJS1RJRl8xMDQyIiwicm9sZSI6Im1lbWJlciIsInBhZCI6Inh4In0',
      segLen: 67,
      segLenMod4: 3,
      candidates: 63,
      collisions: 3,
      tail: 'nh4In0',
      twinTails: ['nh4In1', 'nh4In2', 'nh4In3'],
      twinSegments: [
        'eyJzdWIiOiJ1X0ZJS1RJRl8xMDQyIiwicm9sZSI6Im1lbWJlciIsInBhZCI6Inh4In1',
        'eyJzdWIiOiJ1X0ZJS1RJRl8xMDQyIiwicm9sZSI6Im1lbWJlciIsInBhZCI6Inh4In2',
        'eyJzdWIiOiJ1X0ZJS1RJRl8xMDQyIiwicm9sZSI6Im1lbWJlciIsInBhZCI6Inh4In3'
      ],
      /* Collisions by segment length modulo 4, which is what the panel asserts:
         a number that depends only on how many spare bits the tail carries. */
      collisionsByMod4: { '0': 0, '1': null, '2': 15, '3': 3 },
      strictRefusalCode: 'E_B64_TAIL',
      note: 'length 1 mod 4 is refused outright and has no collision count'
    },

    /* The same pair for the payload printed in the build spec's own correction
       note, kept so a reader can reproduce that correction from this file
       without reconstructing the payload by hand. It carries no FIKTIF subject
       and is therefore never issued, never signed, and never reaches the
       fabrication sweep — it exists as three strings and a count. */
    B64U_TWIN_SPEC: {
      source: 'this repository, reproducing the build spec correction',
      published: false,
      payloadJson: '{"sub":"u_1042","role":"member","pad":""}',
      segment: 'eyJzdWIiOiJ1XzEwNDIiLCJyb2xlIjoibWVtYmVyIiwicGFkIjoiIn0',
      segLen: 55,
      segLenMod4: 3,
      candidates: 63,
      collisions: 3,
      tail: 'joiIn0',
      twinTails: ['joiIn1', 'joiIn2', 'joiIn3']
    },

    /* ------------------------------------------- what atob does, as a table */
    /* Measured in this repository's own Chromium and in its node, over http,
       under the shipped CSP. These are the inputs the loose decoder accepts and
       the strict one refuses, and they are frozen here so the panel compares
       against a recorded expectation rather than against whatever the platform
       happens to do on the day. Where the platform and this table disagree, the
       table is what turns red. */
    ATOB_BEHAVIOUR: {
      source: 'measured, this repository',
      published: false,
      looseAccepts: ['QQ==', 'ab\ncd', 'ab\r\ncd', 'ab\tcd', 'ab cd', 'a+b/', 'QR'],
      looseRefuses: ['A', '=', 'QQ=', 'ab-cd', 'ab_cd'],
      collision: { a: 'QQ', b: 'QR', decodesTo: '41', identical: true }
    }

  };

  root.SAHIH_VECTORS = NS;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SAHIH_VECTORS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
