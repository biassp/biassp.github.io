<!--
  Serobot — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only. See /LICENSE.
  https://biassp.github.io/
-->

# Serobot — the same money, once as a column and once as a ledger, with two writers on both

**Live:** https://biassp.github.io/labs/serobot/

*Menyerobot* is Indonesian for cutting in line — taking a turn that was not yours. It
names the failure exactly: the second write serobots the first, and the queue it cut is
the `navigator.locks` queue the fix puts on screen.

Two writers race one balance inside a single browser tab. Real dedicated Web Workers,
a real `IndexedDB` database created and destroyed by each run, a real lock queue read
back out of the browser. The same fabricated money is kept twice — once as a stored
column whose read and write land in **different transactions**, and once as an
append-only journal folded on read. Identical workload, identical seconds. The column
ends short. The journal cannot, because there is no read to go stale.

The part that is hard is not losing the update. The part that is hard is **saying
anything true about it in a test suite.** A race is not assertable: twenty runs is not
enough to learn whether a number is stable, and a suite that requires nondeterminism to
land a particular way goes red on somebody else's laptop. So a two-phase rendezvous
holds every writer until all of them have read, and again until all of them have
written. The loss stops being a number that moves and becomes an **exact integer** —
and that integer is what ships as an assertion. The free-running column beside it is
printed with every sample and pinned by nothing at all.

---

## Every number below came from a run

| | |
|---|---|
| Assertions | **174 distinct properties, 60 of them negative** (34.5 %), across 13 groups, executing 532 times. 0 failed. |
| Files | 15 |
| Vendored bytes | **0** |
| Content-Security-Policy relaxation | **none** — line 13 is byte-identical to the seven strictest labs |
| Network calls | 0, page realm **and** worker realm |
| Suite cost, one run | 1.71–1.88 s at 1×, 3.44–4.37 s at 8× CPU throttle |
| Whole page, load to every panel populated | ≈ 4.3 s |
| Longest main-thread block | 31–49 ms across the whole boot; 92 ms across a 22-second window that also included seven tab renders. 0 gaps over 100 ms in either. |

**This lab vendors nothing and relaxes nothing.** No framework, no bundler, no build
step, no `vendor/` directory. One command checks the policy claim, and it prints nothing
when it passes:

```bash
diff <(sed -n 13p labs/harvest/index.html) <(sed -n 13p labs/serobot/index.html)
```

`worker-src 'self' blob:` was already in that line before this lab existed, so spawning
real workers cost the policy nothing.

---

## How to run it locally

```bash
git clone https://github.com/biassp/biassp.github.io
cd biassp.github.io
python -m http.server 9090
# then open http://127.0.0.1:9090/labs/serobot/
```

HTTP, not `file://` — the page ships `script-src 'self'`, and a `file://` origin is
opaque, so `'self'` can never match. `navigator.locks` also requires a secure context,
which `http://127.0.0.1` is and a `file://` page is not.

To run the assertions headlessly, from the repository root:

```bash
npm ci && npx playwright install chromium
npm run test:labs
```

---

## What the page shows

**Two ledgers.** Four write shapes in one file, one `switch`, all four credited inside
one loop iteration of one worker against the same clock. `pisah` reads in one
transaction and writes in a later one. `satu` does the same read and the same write
inside one transaction. `jurnal` does not read at all — it appends a row through `add()`
and never `put()`. `kunci` is the `pisah` body verbatim, wrapped in a real Web Lock.
Under the rendezvous, `pisah` ends at **n** and the other three end at **W × n**, and
`pisah` does so *independently of W*: a round advances the column by exactly one however
many writers were in it.

One field cannot end at both `n` and `W × n`, so there is one account key per arm and
the page says so above the diff rather than hiding it. The bodies are read back at
runtime out of the running functions and put on screen through `textContent` — there is
no build step in this repository, so what is in those boxes is byte-for-byte what ran.

**One thread.** The same money gone with no workers at all. Five strategies over one
plain variable: the naive one ends at `n` for every W from 2 to 10 — ten writers doing
ten increments each produce **ten, not one hundred** — while the identical code with no
await ends at `W × n`. Beside it, a numbered step log on integer sequence numbers, and
the transaction-death boundary: a live `readwrite` transaction survives one hundred
thousand chained microtasks and dies the instant control reaches the task queue, with
`oncomplete` firing anyway, `onabort` never firing, `tx.error` null, and the write gone.

**Exactly once.** One fabricated webhook delivered twice, concurrently, on one event
loop — deterministic, no race. Four modes, four different ideas of what the phrase
means. The one that only *checks* double-credits **with a mutex around the write**,
because the check was outside the critical section. A check is not a constraint.

**The queue.** Thirteen `navigator.locks` behaviours, and the browser's own `{held,
pending}` on screen from `query()` — a visitor can paste the same call into a console
mid-hold and get the same two arrays back. Plus the counterweight paragraph to "just use
a lock": an unbounded nested request never settles, with zero errors and zero console
output, forever.

**Audit.** Two write shapes this repository already ships, transcribed with file and
line and run through the same rendezvous. One of them turns out to be correct and had
never been measured. The other has the shape the centrepiece loses money with.

**Limits.** What this browser will not do, read live.

---

## What is real, and what is fabricated

### Real

- The workers, the `IndexedDB` transactions, the lock queue, the interleavings, and the
  loss.
- The two quoted comments on the Audit tab, with their files and line numbers.
- Every figure on the page: it was produced by the visitor's own browser as the tab
  rendered, and none of it is transcribed into the markup.

### Fabricated

- All data. `AKUN-FIKTIF-01`, `IDEM-FIKTIF-0001`, `PEER-FIKTIF-01`, `AGEN-FIKTIF-n`,
  journal ids of the shape `J-R-w<W>-r<R>`. Visibly synthetic, never a random hex
  string, and the key generator **refuses** a random-hex shape as one of the negative
  properties.
- All money is integer, never a float.

### Not built, stated plainly

The page carries the full list, eighteen items, outside the tab strip so it cannot be
the one tab nobody opens. The four that matter most:

1. **No shared memory, and therefore none of the textbook primitives.**
   `crossOriginIsolated` is false and `SharedArrayBuffer` is undefined; GitHub Pages
   cannot send the COOP and COEP headers shared memory requires and never will. No
   spinlock, no futex, no seqlock, no ring buffer, and nothing here is a simulation of
   one over `postMessage` wearing its name.
2. **No network, and therefore not the hard problem.** No partition, no packet loss, no
   retry storm. *Did it fail, or is it just slow?* cannot even be posed here, because
   there is no remote party whose silence is ambiguous.
3. **No durability and no crash.** Nothing is killed mid-write. That is why the
   split-transaction idempotency panel shows a **seam** rather than a lost credit: the
   failure it warns about needs a process to die, and this lab cannot kill one.
4. **`app.js` has no automated control.** The suite asserts the engines; nothing asserts
   the renderers. Every number written into page *prose* is unasserted by construction —
   a sibling lab found this when a mutation restoring a wrong hardcoded year left all
   419 of its assertions green.

---

## No assertion here requires a race to go a particular way

> A suite that requires nondeterminism is a suite that goes red on somebody else's
> laptop — and twenty runs is not enough to find out. Under 8× CPU throttling, two
> writers doing three increments each reach the correct answer in **29 of 60 runs**; at
> five increments, 10 of 60; at ten, 1 of 60. Every candidate assertion over a race in
> this lab was run 60 times at 8× before it shipped, and the threaded panel ended up
> carrying none of them anyway.

Two mechanisms keep it that way, and both were proved able to fire before being asserted
quiet:

- **A brand.** `seal()` is the only constructor of a free-mode result, it is applied by
  the engine and never by the caller, and every assertion helper refuses a branded value
  as an operand — it records a failure, not a warning.
- **A static scan.** A brand cannot catch `t.eq(free.pisah, 22)`, because `free.pisah`
  is a `Number`. So the suite reads its own free-mode group body back with
  `Function.prototype.toString` and fails on any comparison helper but `gte`/`lte` on a
  line naming the race key. Proved red against a planted body.

The grep that a stranger runs is:

```bash
grep -rn '\b2[01][0-9]\b' labs/serobot/ --exclude='*.md'
```

It prints **five lines, and not one of them is a race outcome**: the `211` green channel
of the cyan wash twice in `app.css`, the `211` of the `--ok` dot glow, `%200` inside the
percent-encoded favicon, and a `slice(0, 200)` log truncation inside `guard.js`. Four of
the five are inherited, measured constants and changing them to quiet a grep would be
the exact vice the grep exists to prevent. A sixth line appearing is worth reading.

The exclusion is not a convenience. The paragraph you are reading names all five constants,
so without it this check counts its own explanation and reports eight — a check that goes
red the moment somebody documents it. Four files in this lab have now had to be written
around a grep that matches the sentence describing it, and this is the fifth.

---

## Verification runs on two routes, and the limit is a number

Every figure the centrepiece prints appears twice, from two routes that share no code,
with their difference beside them — rendered even when it is zero, because a difference
column that only appears when it is non-zero is a column nobody checks.

- **Route A** is `db.js` reading the stores back through its own cursor.
- **Route B** is `saksi.js`. It receives an injected reader function, the "before"
  snapshot as a **value**, and `W` and `n` as **two separate integers it multiplies
  itself**. It never receives an `IDBDatabase`, an `IDBTransaction`, a `Lock`, a
  `Worker` or a `MessagePort`, and it could not open a transaction if it wanted to. It
  builds its own worklist at witness time from the store names it was handed rows for,
  so the thing being verified does not choose what gets verified. Six refusals, all
  **synchronous**, before any promise exists.

```bash
grep -o 'SEROBOT_[A-Z]*' labs/serobot/saksi.js | sort -u
```

prints exactly one line — `SEROBOT_SAKSI`, its own export. A second line means the file
has been compromised. That is the whole test, runnable in three seconds without reading
a word. Not one comment in the file spells a sibling global out, because a comment
naming one would make the grep print it.

**Its limit, as a number rather than a hedge.** Both routes bottom out in the same
`IDBObjectStore` and the same scheduler; there is no second storage engine in a browser
and this file is not one. Measured by stubbing the injected reader to replay the
engine's cached row array: **0 of 174 properties go red.** Falsify one row inside that
cache and **12** go red. The route separation catches a mistake in this lab's
arithmetic; it cannot catch a lie told by the browser's own transaction manager, and it
cannot catch a witness that was never given anything to disagree with.

Every verdict carries `sharedBottom: 'IDBObjectStore'`, printed **beside** the agreement
and not underneath it.

### The other one-command checks

| Claim | Command | What it prints |
|---|---|---|
| Only one file asks for a lock | `grep -ln 'locks\.request' labs/serobot/*.js` | `labs/serobot/kunci.js` |
| No artificial delay in any arm | `grep -n 'setTimeout\|setInterval' labs/serobot/arms.js` | nothing |
| No worker writes to the error console | `grep -rn 'console\.error' labs/serobot/` | nothing |
| The printed arm bodies are live | `grep -n 'String(credit)' labs/serobot/arms.js` | the one line that produces all four |

The last one is worth a sentence. The obvious grep is `toString()`, and it prints
nothing — the live read is spelled `String(credit)`, which is the same call. A README
that shipped the obvious grep would ship a check that prints nothing and looks like it
passed.

---

## The mutation gate

A check that has never been seen to go red is not a check. Every defect below was
injected into the **shipped** file, the suite re-run in real Chromium, and the file
restored byte for byte. Baseline 532 / 0.

| Defect | Result |
|---|---|
| `add()` → `put()` in the journal path | 2 red |
| `rmwOne` yields to the task queue mid-transaction | 6 red, plus `TransactionInactiveError` on the worker's rejection channel |
| the `'tulis'` barrier phase deleted | 1 red — 105 releases where 120 were required |
| the witness stops multiplying its two integers | 16 red |
| `unique: true` dropped from the constrained ledger's index | 9 red |
| a barrier-mode result branded | 1 red — the tripwire |
| a worker's `unhandledrejection` listener removed | **0 red and 8 page errors** — CI exits 1 with every assertion green |
| `ev.preventDefault()` removed from a page-side `onerror` | **4 page errors** |
| the single-flight latch removed | 2 red |
| `lineDiff` returns `[]` | 2 red |
| `assertNoTimer` returns ok unconditionally | 1 red |
| `guard.total()` returns 0 unconditionally | 3 red |
| the writer-count clamp dropped | 3 red |
| the rendezvous in `satu` moved to after the write | **0 red — survivor** |
| the witness folds the engine's cached rows | **0 red — the firewall's own limit, above** |
| the Atomics working-member count hardcoded again | 1 red — the recount disagreed with the literal |
| one `Atomics` member made to throw | 1 red naming that member; the count fell to 6 of 9 on its own and the capability line still rendered |

A review pass afterwards found a check that had never been able to go red and could
not have been: the count of `Atomics` members that work was a literal `6` assigned inside
the probe, asserted against the literal `6` in the suite, printed as "six of eight" beside
a table with nine rows in it, and wrong in both figures — twelve of the fourteen function
members this Chromium's `Atomics` carries return a value on a buffer that is not shared.
Worse, the probe wrapped nothing, so a member that began refusing took the whole
capability line down with an uncaught throw instead of being reported as refusing, which
is the one thing that probe exists to report. It is now counted, wrapped, and cross-checked
from the reported values by a second route in the suite; both mutations above are the
proof, and the two figures on the page are derived rather than remembered.

The survivor is not a hole. Moving the rendezvous in `satu` changes no number this lab
asserts, because a read-modify-write inside one transaction is correct with or without a
rendezvous — which is that arm's entire point. Three other mutations survived a first
pass and **four properties were added in response**: the duplicate-row-id refusal, the
arm-key and line-diff structure, the timer audit with a planted body, and the brand
containment check. They are holes that were fixed, not reported.

---

## The finding this lab did not fix

`labs/saku/sync.js:47` — `peerApplyOne` reads the peer record through `peerGet` (a
`readonly` transaction), decides whether the idempotency key was already seen, and
writes the updated record back through `peerPut` (a later `readwrite` transaction).
Character for character, that is the shape the centrepiece loses updates with. A second,
separate finding in the same function: `rec.seen` is truncated to the last 50 entries,
so a key returning after 50 other operations is accepted again — a bounded replay
window.

Stated at the right size: **`drain()` applies operations through a strictly sequential
`reduce`, so within one drain these calls never overlap. Two overlapping drains would
reach it. This lab reproduces the shape and shows what it costs; it does not claim
`labs/saku/` loses data today, and no live path that does was found.** `labs/saku/` is a
demo lab whose "peer" is local `IndexedDB` and never a network, and it is absent from
the automated runner, so this is a reading of the source rather than a test result. Both
findings are recorded in that lab's own README.

And the other direction: `labs/gudang/store.js:135-139` carries a prose claim in a
comment — that a lock record read and written inside one `readwrite` transaction is
atomic across tabs. It is load-bearing and had never been measured anywhere in this
repository. **It is correct**, at two and at four contenders, under a rendezvous that
releases all of them at the same instant.

---

## Why 174 properties and not 500

Rombak reported 262 because it had 33 tables, 19 indexes, 9 migrations and 4 rebuild
variants to be right about. This lab has **six mechanisms**: `IndexedDB` transaction
scope, the await interleaving, the append-only fold, idempotency, Web Locks, and the two
clone seams. Ninety to a hundred and forty is what honest work on six mechanisms looks
like; 174 is where it landed once the mutation gate had asked for four more and a review
pass had replaced an Atomics count that could not go red.

A count that grew to match a sibling would be a count built from loops, and on this topic
the loops are unusually cheap:

- **Two hundred increments is one property, not two hundred.** Per-iteration assertions
  are refused by name.
- **An ordering log gets a handful of properties over the whole log** — total order,
  unique and gapless sequence numbers, every read matched to a write by the same writer,
  the log's own fold equal to the variable.
- **No assertion here is a conformance test of the browser** — and the honest version of
  that sentence is narrower than the one this README used to carry. Nothing here sets out
  to prove that `postMessage` delivers or that `structuredClone` clones. But the suite
  *does* pin the exact strings the browser produced and the page prints: the lock ordering
  `a-in,a-out,b-in,b-out`, the shared-then-exclusive order `s1-in,s2-in,x1-in,s3-in`, the
  two keys `query()` returns and the three in every entry, what each `Atomics` member
  returned, the DOMException names. A printed ordering that nothing checks is prose, so
  those are pinned — and the price is that they would go red if Chromium changed, which
  this lab pays knowingly rather than claiming a boundary it does not hold.

**Properties and executions are reported separately and are never added together.** 174
properties execute 532 times, because most of them legitimately run once per arm or once
per writer count. The badge in the page header shows **properties**. The labs index
shows **executions**. They are different numbers on purpose.

---

## The network counter, and why this lab's badge means more than its siblings'

A `<meta http-equiv>` Content-Security-Policy applies to the **document**, not to a
dedicated worker's global scope, and GitHub Pages sends no CSP header at all — so a
worker has effectively no policy. Measured under this page's own CSP: a `fetch` from the
page was refused and wrote two console errors, while the **identical `fetch` from inside
a same-origin worker resolved with the body**, silently, with nothing logged anywhere.
`window.SEROBOT_GUARD.total()` — the exact expression the automated runner evaluates —
cannot see it, because that object lives in the page realm only.

Every worker here `importScripts('guard.js')` and posts its own total back to be folded
into the page count before anything is reported. Two sibling labs already ship real
workers under the same badge while making a weaker claim, and this page says so rather
than quietly being the only correct one.

**No worker or page here ever attempts real egress to prove the counter works.** Each
refusal the browser issues writes a console error, and the runner counts one console
error as a broken page. The counter's arithmetic is asserted instead, against a
throwaway clone. The runner also polices egress at the network layer with
`page.on('request')`, which sees every realm and needs no cooperation from the code
under test.

---

## The RepBout bridge

A case study on this site lists four paths by which a balance can be created from
nothing. The fourth, in its own words, is *"two requests arriving at once and both
reading the old balance before either one writes."* **This lab is the fourth one,
reproduced in a browser tab, with a fabricated unit and no money in it.**

What it cannot tell you about a real system: there is no second server here, no database
row lock, no `SELECT … FOR UPDATE`, no unique constraint on a server-side idempotency
table, and no transaction manager below the application. Real ledgers are protected
*below* the application. This lab is what the problem looks like when they are not —
which is exactly the situation you are in whenever a database is used as a key-value
store, and exactly the situation `IndexedDB` puts you in permanently.

---

## Files

| File | What it is |
|---|---|
| `index.html` | The page. Seven panels, all empty — every one prints function bodies, error codes and raw rows, and a `<` before a letter in markup is a validator error waiting to happen. |
| `app.css` | Tokens and both themes, every text-carrying token measured as the worst of eight surfaces including both background washes composited in both paint orders. |
| `guard.js` | Theme before first paint, and the five wrapped network APIs. Copied from `labs/sahih/`, prefix swapped, because that file is the one measured to be **worker-safe** — its `sendBeacon` wrap is feature-gated and `WorkerNavigator` has no `sendBeacon`. |
| `kode.js` | Refusal codes, the two race brands and `seal()`, integer-only money helpers, the sequence counter, `lineDiff`. Every code lives in `.name`, never in `.message`, which the automation boundary destroys. |
| `db.js` | Run-scoped database name, `onblocked` → `E_DB_BLOCKED` with a bounded fallback, `onversionchange` → `close()` on every connection, the seed, the raw reader handed to the witness, the transaction-death probe and the two spec-forced orderings. |
| `arms.js` | The four write shapes in one `credit()` switch, the barrier client and the page-side coordinator, `assertNoTimer`, and the live source read. It names no timer anywhere, including in a comment. |
| `utas.js` | The single-thread engine: five strategies, the integer step log, and the refusal that fires when a clock reading is handed in as an ordering key. |
| `idem.js` | The four idempotency modes, the key generator and its shape refusal, the `add()`/`put()` pair, the bounded-replay fixture. |
| `kunci.js` | **The only file that asks `navigator.locks` for a lock.** Thirteen behaviours, three synchronous refusals, the holder's `catch` attached at creation, the TTL lease and the fencing token. |
| `pantau.js` | The capability probe, the rAF responsiveness monitor with its forced yield, and the worker squad — serialised, terminated on every exit path, `preventDefault` on every `onerror`. |
| `saksi.js` | **The firewall.** Injected reader, own cursor, own integer adder, own worklist, six synchronous refusals, and a load-time self-check against its own fixed vectors. |
| `kerja.worker.js` | The writer. It loads the same engine files the page loads, so there is no second implementation to drift, and it handles its own unhandled rejections. |
| `tests.js` | The 174 properties, the single-flight latch, and the 90-second watchdog that **resolves** with a shaped result rather than rejecting. |
| `app.js` | The only file that touches the DOM. |
| `README.md` | This file. |

---

## The main thread

Rombak froze the main thread for 23.6 seconds on load and **all four adversarial
verifiers passed it**, because each asked "does it finish" and "any console errors" and
none asked "can a human use this while it runs". A lab that spawns workers has no
excuse.

The monitor here is `requestAnimationFrame`-based and forces a microtask yield before
reading the clock, and that is not a style preference: a `setInterval` gap detector
reports **0 ms** for a real 788 ms block, because the callback cannot fire during the
block and clearing the timer in the same synchronous turn discards the late tick.

Measured on the machine that runs CI (`hardwareConcurrency` 4), across the whole boot —
the suite, all eight demonstrations and the renders between them: **longest gap 31–49
ms, p95 18 ms, median 17 ms, 0 gaps over 100 ms.** A second monitor installed from
outside the page, sharing no code with this lab's, covering a 22-second window that also
included seven tab renders: **longest gap 92 ms, 0 over 100 ms.** Clicking a tab at
three, eight, fifteen and twenty-two seconds after load was painted in **24–29 ms** every
time, including while the demonstrations were still running.

That figure is **printed and never asserted**: a threshold is a timing pin, and this
repository has a standing rule against those. What *is* asserted is structural — every
engine file is DOM-free, the write loops execute in the worker, and `app.js` is the only
file that touches the DOM.

This lab ships **no `tests.worker.js`**, and that is measured rather than assumed: its
heavy work is I/O-bound by construction, so relocating it would move nothing. The build
gate was that a longest gap over 100 ms during a full run would have moved the suite into
a worker before shipping.

---

© 2026 Bias Satrio Putra. All rights reserved. Not open source — see
[/LICENSE](../../LICENSE).
