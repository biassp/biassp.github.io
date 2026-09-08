# HARvest

**Reverse-engineer an API from its own traffic.** Drop a `.har` file exported from your browser's
DevTools (or Charles, or mitmproxy) and HARvest recovers the API behind it: templated endpoints,
per-endpoint latency percentiles, an HTTP/design/security audit, an OpenAPI 3.1 draft, and an
edge/security pass — entirely inside the browser tab.

Live: <https://biassp.github.io/labs/harvest/>

---

## Why it is a browser-only tool

A HAR captured from your own browser contains live session cookies and bearer tokens. Every online
HAR viewer uploads them. This one cannot: the page ships its own Content Security Policy in a
`<meta>` tag,

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'none';
worker-src 'self' blob:; form-action 'none'; base-uri 'none'; object-src 'none'
```

so the browser itself refuses every outbound connection regardless of what the JavaScript asks for.
Belt and braces, `guard.js` wraps `fetch`, `XMLHttpRequest`, `WebSocket` and `navigator.sendBeacon`
at startup and the header shows how many were attempted. It stays at zero, and you can check that in
the Network tab in five seconds.

Two notes so the claim is precise rather than marketing:

- **This is a claim about this page only.** The CV homepage at `biassp.github.io` *does* call
  `api.github.com` for its repository feed. The lab does not call anything.
- The page loads its own `.css` and `.js` from the same origin, like any static page, and the
  analysis Worker `importScripts` two of those same files. Those are same-origin script loads
  governed by `script-src 'self'`; there is no other host in the source, and no data ever leaves.

`worker-src 'self' blob:` is present deliberately. Without it, `worker-src` falls back through
`child-src` to `default-src`, and a `blob:` URL matches neither `'none'` nor `'self'` — the page
would block its own Worker and log a CSP violation. `frame-ancestors` is **not** in the meta policy
because that directive is ignored when delivered via `<meta>` and only produces a console error;
it belongs in a response header, which GitHub Pages does not let this repo set.

**This targets `https://` and a local HTTP server, not `file://`.** With `default-src 'none'` /
`script-src 'self'`, a `file://` document has an opaque origin that `'self'` does not match in
Chromium, so opening `index.html` straight off disk would block the page's own CSS and scripts. Run
a local server instead (below).

---

## Running it locally

No build step, no dependencies, no package manager. Serve the repository root over HTTP:

```bash
cd biassp.github.io
python3 -m http.server 8765
# then open http://127.0.0.1:8765/labs/harvest/
```

The engines also run under node, which is how the same assertion suite is checked outside the
browser:

```bash
cd labs/harvest
node -e "var H=require('./analyze.js');require('./edge.js');require('./samples.js');require('./tests.js');
var r=H.runTests();console.log(r.passed+'/'+r.total+' passing, '+r.failed+' failing');"
```

---

## What it does

### 1. Endpoint recovery (Endpoints tab)

Requests are grouped into a trie over path segments, per host. Each sibling set is then classified
literal-or-parameter from two signals: the **intrinsic shape** of the token (UUID, ULID, 24-char
hex, long hex, ISO date, all-digits, opaque token, slug, bare word, `v2`-style version) and the
**cardinality** of the siblings at that position. A reserved-word list keeps route words literal, so
`/users/me/posts` is not eaten by `/users/{userId}/posts`.

The thresholds are deliberately asymmetric, because the two failure modes are not:

| shape | rule |
| --- | --- |
| UUID / ULID / ObjectId / long hex / ISO date / JWT-shaped | parameter on sight — a route literal is never one of these |
| all digits | parameter; confidence high at 3+ distinct siblings, low at 1 |
| opaque token (mixed letters+digits, 12+ chars) | parameter at 3+ distinct siblings |
| slug | parameter only at 12+ distinct siblings each requested ≤2× on average |
| bare word | **never** auto-collapses — nine sibling words is a normal API surface, not a parameter |
| `v1`, `v2.1` | always literal |

Parameter names are singularised from the parent segment (`users` → `userId`, `categories` →
`categoryId`, `people` → `personId`), de-duplicated within one template.

**Every decision is shown with its evidence and can be overridden.** The Endpoints tab lists each
decision with the reasoning that produced it ("12 distinct all-digit siblings", "9 distinct
bare-word siblings — route names look exactly like this") and a confidence, and Pin literal /
Force parameter re-run the entire analysis. Overrides persist in `localStorage`.

There is no ground truth in a HAR. This is a heuristic engineered to be inspectable, not a heuristic
that hides.

### 2. Schema inference and OpenAPI 3.1 (Spec tab)

For each template × method × status, every observed JSON body is merged into one type through a
**join-semilattice**: counters add, bounds take min/max, flags OR. That matters because it makes the
merge commutative and associative, so analysing the same trace with the requests in a different
order produces a byte-identical document. The two places implementations usually lose that property
are handled explicitly:

- **`required` is present-in-k-of-n counting**, not a pairwise intersection of key sets. A property
  is required when it appeared in every object sample at that position, and the raw `k/n` is
  available for annotation.
- **The caps (enum cardinality, distinct-value tracking, object breadth) are resolved from the size
  of the union**, and once tripped they stay tripped, so the outcome does not depend on which sample
  arrived first.

Also modelled: type unions, `null` as a union member, integer widening to number when a fraction
appears, format sniffing (`date-time`, `date`, `uuid`, `email`, `uri`, `ipv4`) only when *every*
sample matches, enum detection by distinct-value cardinality *with* a repetition requirement (three
values seen once each is variety, not an enum), depth capping, and degradation to
`additionalProperties` for dictionary-shaped objects.

Structurally identical object schemas are Merkle-hashed and hoisted into `components/schemas` as
`$ref`s, child-first so a hoisted component can itself contain `$ref`s. YAML is **emitted** by a
hand-rolled emitter — never parsed — which is why there is no YAML dependency.

A **coverage meter** states how much of the spec is body-derived. Chrome omits response bodies from
a HAR unless you use *Save all as HAR with content*, and without bodies the spec can only be
header-level. HARvest says so rather than shipping a thin document that looks complete.

### 3. Findings (Findings tab)

Severity-ranked, each with the request indices that produced it (clickable — they jump to that
request in the waterfall), why it matters, and the fix. Rules that are judgement calls carry a
`heuristic` badge.

- **auth** — credentials over plaintext `http://`; credential in the query string; one bearer token
  sent to two hosts; `Set-Cookie` missing `Secure`/`HttpOnly`/`SameSite`; JWT `alg: none`, missing
  `exp`, empty signature, or a multi-week lifetime.
- **caching** — identical GETs refetched with no `max-age` and no validator (with wasted bytes
  counted); successful GETs with no caching directives at all; `Vary: *`; `no-store` on
  content-hashed immutable assets; large text responses served uncompressed.
- **design** — HTTP 200 carrying an error body; 429/503 without `Retry-After`; 5xx in the trace;
  mixed pagination idioms across one API; snake_case/camelCase drift; POST apparently used for a
  read.
- **efficiency** — N+1 fan-out (below); the same request repeated 3+ times.
- **concurrency** — HTTP/1.1 six-connection saturation; the longest strictly serialised request
  chain; responses whose time is >80% TTFB (server think-time, not transfer).
- **edge** — HTTPS without HSTS; missing `X-Content-Type-Options`; server version disclosure; HTML
  framable by any origin.

**The N+1 correlator** links cause to effect without a trace ID: id-shaped values are extracted from
response bodies at arbitrary depth (bare integers only under an id-shaped key, so `{"count": 12}`
does not poison the index), indexed by value, then matched against the path and query values of
*later* requests. A finding only fires when at least three distinct children of one parent hit the
**same** endpoint template inside a 30 s window — one coincidental match is not fan-out. It reports
the parent request that caused it, not just a count. On the clean sample trace it correctly stays
silent.

### 4. Latency and budgets (Latency tab)

Per operation: n, p50/p90/p95/p99, max, error rate. Percentiles are **nearest-rank** —
`rank = ceil(p/100 × n)`, 1-indexed into the sorted samples, no interpolation — and `n` is shown on
every row with a warning below 20 samples, because a p99 from a handful of samples is just the
slowest thing we saw.

From those, a timeout and retry budget: timeout = p99 × 1.5 rounded up to a 50 ms step, with the
basis spelled out. Retries are proposed **only for idempotent methods** (GET/HEAD/PUT/DELETE/
OPTIONS/TRACE) on 502/503/504/429 and connect errors. For POST and PATCH it refuses, and says why:
retrying a non-idempotent request without an `Idempotency-Key` the server deduplicates on is how you
get two orders.

### 5. Edge / Security (Trace, Edge tab)

This tab absorbs the security scope of a cancelled second lab.

- **JWT inspector** — decodes header and payload locally with `atob`, humanises `exp`/`iat`/`nbf`,
  computes lifetime, and flags `alg: none`, a missing `exp`, an empty signature segment and long
  lifetimes. The signature is **never verified**: that needs the signing key, which this page does
  not have and will not ask you for. The UI says so next to every token.
- **IP / CIDR matcher** — IPv4 and IPv6, including `::` expansion, IPv4-mapped forms and
  non-word-aligned prefixes like `fe80::/10`. Addresses normalise once into four 32-bit words so a
  prefix test is a few integer compares instead of BigInt arithmetic. Invalid CIDRs are reported,
  not silently dropped. A HAR records `serverIPAddress` (the *server*), never the client address —
  the UI states that rather than implying otherwise.
- **Sliding-window rate-limit simulation** — replays the trace through a sliding-window counter
  using its own timestamps, keyed on host, host+path, host+endpoint-template or server IP.
  One ordered pass with a per-key ring buffer of in-window timestamps, so it is O(n) rather than
  O(n × windows). Requests inside a mitigation window are rejected without being metered, which is
  what an edge limiter normally does; that choice is stated in the UI.

### 6. Tests (Tests tab)

176 assertions over the pure engines, run on page load and shown green or red in front of the
visitor. The same file runs under node. The headline assertion is that **the schema merge is
order-independent**: 25 shuffles of the same bodies must produce a byte-identical schema, `join`
must be provably commutative and associative, and five shuffles of a whole HAR must produce a
byte-identical OpenAPI document *and* the same set of findings. That is the property most
implementations quietly violate, so it is asserted rather than claimed.

---

## What is real and what is simulated

**Real** — everything computed from your file. Parsing, normalisation across HAR dialects, path
templating, schema inference and merge, `$ref` hoisting, the OpenAPI document, every finding rule,
percentiles, the waterfall, JWT decoding, IP/CIDR matching. Drop in your own HAR and the numbers are
about your API.

**Simulated, and labelled as such in the UI** — the rate-limit simulation. It replays a policy you
choose against traffic that already happened; it is a what-if, not a measurement of a limiter that
exists.

**Synthetic** — the two embedded sample traces in `samples.js`, hand-authored so the page is alive
with zero user input. No real hosts, no real credentials, latencies from a seeded PRNG so the
numbers are identical on every open. One is a well-behaved REST API (it produces exactly one low
finding — a `Server:` version header — which is a real result, not a placeholder); the other is
deliberately pathological and produces 28 findings across every family.

**Deliberately impossible here, and cut rather than faked:**

- **Replaying a captured request.** It needs an outbound call, this page's own CSP forbids it, and
  CORS would block most targets anyway. A replay belongs in your own terminal. (The `curl` / `.http`
  emitters that would have handed you one were cut with the other config exports below, so there is
  no button for this at all rather than a button that does not work.)
- **Verifying a JWT signature or a webhook HMAC.** Needs the secret.
- **Live probing of cache behaviour, GeoIP/ASN lookup, share-a-report.** Requests and/or datasets.
- **Staging-vs-prod trace diff.** Specified, then cut from v1 rather than shipped half-finished.
- **Config exports** (nginx timeouts, Envoy `retry_policy`, k6, `.http`). The timeout/retry budget
  they would have been generated from is computed and displayed; the emitters are not built.

---

## Engineering notes

- **No framework, no bundler, no dependency, no build step, no CDN.** Plain `<script src>` in
  dependency order with a single global namespace. No ES modules, no inline scripts anywhere — which
  is what lets the CSP be `script-src 'self'` with no `'unsafe-inline'`.
- **No web fonts.** A Google Fonts request would be network egress, so the page uses a system stack
  and keeps the CV's colour tokens.
- **Analysis runs in a Worker** built from a `blob:` URL that `importScripts` the same
  `analyze.js`/`edge.js` the page uses, so there is one implementation, not two. If Worker
  construction or startup fails for any reason, it falls back to the main thread and the status line
  says so out loud, naming the reason — rather than appearing to work while quietly being slower.
- **Every `localStorage` access is inside `try`/`catch`** and nothing depends on a successful read.
  The CV shipped that bug once: a single unguarded read threw where site data was blocked and blanked
  the whole page. Verified by driving the page with `localStorage` rigged to throw — it renders and
  the theme toggle still works.
- **Exports offer copy *and* download.** The async clipboard API needs a secure context, and some
  contexts block downloads, so neither is the only path.
- **Accessibility** — real tablist semantics with arrow/Home/End keys, visible focus rings, an
  `aria-live` status line, every interactive element reachable by keyboard, and no horizontal
  overflow down to 390 px (verified on every tab).
- **Redaction is on by default** for displayed header, cookie and query values, including inside the
  displayed URL. It can be turned off deliberately; nothing is ever transmitted either way.

## Files

| file | what it holds |
| --- | --- |
| `index.html` | shell: CSP, tab structure, drop zone, capture instructions. No inline script. |
| `app.css` | CV design tokens, layout, waterfall, findings, tables, focus rings, responsive rules. |
| `guard.js` | loads first: theme before first paint, and the fetch/XHR/WebSocket/sendBeacon counter. |
| `analyze.js` | the pure engine: HAR normaliser, trie + classifier, schema lattice, findings, stats, N+1 correlator, OpenAPI/YAML emitter. Zero DOM references, worker- and node-safe. |
| `edge.js` | IPv4/IPv6 CIDR matching and the sliding-window rate-limit simulator. |
| `samples.js` | the two synthetic traces. |
| `tests.js` | 176 assertions over `analyze.js` and `edge.js`, shared by the page and node. |
| `app.js` | UI only: ingest, worker orchestration with fallback, rendering, exports, overrides. |
