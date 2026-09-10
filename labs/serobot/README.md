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
| Assertions | **187 distinct properties, 66 of them negative** (35.3 %), across 13 groups, executing 567 times. 0 failed. |
| Files | 15 |
| Vendored bytes | **0** |
| Content-Security-Policy relaxation | **none** — line 13 is byte-identical to the seven strictest labs |
| Network calls | 0, page realm **and** worker realm |
| Suite cost, one run | 1.91–2.33 s at 1×, 3.07–3.75 s at 4×, 4.46–5.31 s at 8× CPU throttle — page load included, 60 runs at each rate |
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

- **Route A** is `db.js` reading the stores back through its own cursor — one function,
  `DB.ruteA`, called by the page and by the suite alike, scanned at runtime for any line
  that fills it out of the other route, and returning a **frozen** map so that no caller
  can patch a figure into agreement afterwards. It used to be two copies of that code,
  one of them driving the page and reachable by no assertion in the lab.
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
engine's cached row array: **0 of 187 properties go red.** Falsify one row inside that
cache and **13** go red. The route separation catches a mistake in this lab's
arithmetic; it cannot catch a lie told by the browser's own transaction manager, and it
cannot catch a witness that was never given anything to disagree with.

Every verdict carries `sharedBottom: 'IDBObjectStore'`, printed **beside** the agreement
and not underneath it.

### The other one-command checks

| Claim | Command | What it prints |
|---|---|---|
| Only one file asks for a lock | `grep -ln 'locks\.request' labs/serobot/*.js` | `labs/serobot/kunci.js` |
| No delay-scheduling call in `arms.js` | `grep -n 'setTimeout\|setInterval' labs/serobot/arms.js` | nothing |
| No worker writes to the error console | `grep -rn 'console\.error' labs/serobot/` | nothing |
| The printed arm bodies are live | `grep -n 'String(credit)' labs/serobot/arms.js` | two lines, 255 and 267 |
| The Audit tab's two transcriptions are transcriptions | `sed -n '135,139p' labs/gudang/store.js` and `sed -n '47,52p;68p' labs/saku/sync.js` | the words and the lines the page prints |
| Route A never names the route it is compared against | `sed -n '/NS.ruteA = function/,/^  };/p' labs/serobot/db.js \| grep -c 'verdict\|buku\|saldo\|SAKSI\|alasan'` | `0` |

Two of those are worth a sentence each.

The **arm-body** grep: the obvious one is `toString()`, and it prints nothing — the live
read is spelled `String(credit)`, which is the same call. A README that shipped the
obvious grep would ship a check that prints nothing and looks like it passed. It prints
two lines, not one: the per-arm slice the source boxes use, and the whole-switch read the
diff runs on.

The **delay** grep says what its row now says and nothing more: it is a fact about one
file. Two deadlines are reachable from those arm bodies and that grep sees neither — the
lock request's `AbortSignal.timeout`, which is printed inside the `kunci` body on the
page, and the barrier's per-phase deadline, which arrives as a timer function the worker
injects. Neither delays anything; both only fire on a path that has already failed. An
earlier revision of this lab let the grep stand as "no artificial delay in any arm" and
printed "scanned for a timer call and none was found" directly underneath a source box
containing `AbortSignal.timeout(K.BUDGET)`. `ARMS.assertNoTimer` now separates the two
kinds — `hits` for anything that makes work happen later, `tenggat` for a deadline — and
the suite pins the exact deadline list, so a second one cannot appear on a write path
without a red line.

---

## The flake gate

The suite was run **180 times against one frozen set of bytes** — 60 at 1×, 60 at 4× and
60 at 8× CPU throttle, each one a fresh page load driven through the same route CI uses —
and every run produced the identical eleven-field result:

```
1x   60/60 green   567 passed, 0 failed, 187 properties, 66 negatives, noise 0   1910–2326 ms
4x   60/60 green   567 passed, 0 failed, 187 properties, 66 negatives, noise 0   3066–3745 ms
8x   60/60 green   567 passed, 0 failed, 187 properties, 66 negatives, noise 0   4458–5307 ms
```

That is **34,020 assertion executions at each rate and not one of them failed**, and the
per-assertion rate matters more than the per-run one: all 517 distinct `group · name` rows
were 60/60 at every rate. The ordered list of rows was byte-identical across all 180 runs,
so no assertion was skipped and none appeared conditionally — a suite whose row list moves
between runs is a suite that can hide a failure by not running it. Zero page errors, zero
console errors, zero network requests at the network layer, and `SEROBOT_GUARD.total()`
was 0 every time. The times include page load and are asserted nowhere.

Twenty runs would have proved nothing here. The survey this lab was built from recorded a
20-run pass reporting 20/20 green for an assertion a 12-run pass had already caught failing
2 of 12.

**A 2-core box, simulated two ways at once** — the process pinned to two physical cores
with `taskset` *and* `navigator.hardwareConcurrency` overridden to match — was green 30/30
at 1× and 15/15 at 8×. Pinned to **one** core with `hardwareConcurrency` reporting 1, it
was green 20/20, and the clamp did its job: `clampW` came back **2**, not 1.

That clamp is the whole thesis, and the free-mode column on the same boxes is what it
looks like when nothing is clamped. Ten batches at each core count, asserted by nothing:

```
1 core,  W=1, expected 20    20 20 20 20 20 20 20 20 20 20     10 of 10 reached it
2 cores, W=2, expected 40    31 34 27 33 35 30 38 36 33 33      0 of 10
4 cores, W=4, expected 80    41 43 44 45 46 45 42 46 51 43      0 of 10
```

On a single-core machine the broken arm loses nothing, every time, because there is only
one writer to lose to. Free mode carries no assertion, which is why 10 of 10 is a display
and not a failure — but it means the page's *"no loss observed on this machine today"*
branch is not an edge case there, it is the **only** branch such a visitor ever sees. The
barrier column is unaffected: the clamp puts two writers on the board whatever the machine
says, and every exact integer in it held.

---

## The mutation gate

A check that has never been seen to go red is not a check. Every defect below was
injected into the **shipped** file, the suite re-run in real Chromium, and the file
restored byte for byte. Baseline 567 / 0.

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
| the two-route comparison echoes the engine's own figure back into the witness's column | **0 red** — see below. 2 red once the gap below was closed |
| every boolean the step-log audit returns replaced by the literal `true` | **0 red** — see below. 2 red once the gap below was closed |
| the witness's verdict forced to certify, its reasons emptied | **0 red** — see below. 1 red once the gap below was closed |
| only the engine's own route corrupted — its ledger fold `+7`, then its read of the locked arm `+3` | 5 red each, and every one of them reached through the two-route comparison |
| the broken arm's read and write moved into one transaction — the *bug* removed, the concurrency left | 4 red |
| the single-thread writers started one after another instead of in one turn — the *race* removed | 12 red |
| the two idempotency deliveries made to arrive one after the other | 5 red |
| barrier mode stopped synchronising altogether | 6 red |
| the rendezvous in `satu` moved to after the write | **0 red — survivor** |
| the witness folds the engine's cached rows | **0 red — the firewall's own limit, above** |
| the Atomics working-member count hardcoded again | 1 red — the recount disagreed with the literal |
| one `Atomics` member made to throw | 1 red naming that member; the count fell to 6 of 9 on its own and the capability line still rendered |
| route A's ledger fold filled from the witness's verdict, in the suite | **0 red before this pass** — the two columns became one number. Now a `TypeError`: the map is frozen |
| route A's balance filled from the witness, in the page | **0 red before this pass**, and every on-screen difference still read 0. Now the edit changes nothing |
| the same collapse moved *inside* route A, where no caller can see it | 1 red — the provenance scanner names the line and quotes it back |
| a verdict handed to route A as a fifth argument, its expectation taken from it | 1 red — route A's argument count is pinned, because that is the only way a verdict can reach its scope |
| route A's fold made to overstate by 7 | 5 red, all of them reached through the two-route comparison |
| the same overstatement *plus* the caller's collapse | 1 red — the frozen map turns the collapse into a `TypeError` and the pre-pass reports it |
| `Object.freeze` dropped from route A's map, with the caller's collapse | 9 red, three of them the freeze properties themselves |
| every worker spawns, exchanges messages and reports done, and does no work at all | 1 red — the witness refuses the run outright (`E_SAKSI_KOSONG`) and the suite reports one row rather than 187 green ones |
| the squad's line that folds a worker's egress report into the page count deleted | **0 red before this pass** — now 3 red |
| the worker's own posting of an attempt removed | 3 red |
| `guard.js` removed from the worker's import list | 7 red |
| the worker's reported egress replaced by a literal `0` | 1 red — the second route to the same number |
| the ledger-derived total copied from the stored column in `idem.js` | 2 red |
| the writer clamp collapsed to a single writer | 9 red, one of them the property that the ledger and the broken column must disagree |
| the ledger written with `put()` under a row id that drops the round | 12 red across three groups |
| the one-transaction arm keeps its rendezvous and stops writing | 5 red |
| the coordinator counts two releases for every one it performs | 1 red — the release count is a count, not a figure derived from `W` and `n` |

A review pass afterwards found a check that had never been able to go red and could
not have been: the count of `Atomics` members that work was a literal `6` assigned inside
the probe, asserted against the literal `6` in the suite, printed as "six of eight" beside
a table with nine rows in it, and wrong in both figures — of the fourteen function members
this Chromium's `Atomics` carries, **twelve do not throw** on a buffer that is not shared
and **eleven of those return a value** (`Atomics.pause` returns `undefined`). Only `wait`
and `waitAsync` refuse.
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

### Three checks that could not go red, and now can

A flake pass went hunting for the opposite failure — assertions that pass because they
cannot fail — by neutering, one at a time, the three derived judgements the suite was
reading rather than reproducing. All three left **every one of the executions green**:

- **The comparison between the two routes.** Rewrite it so that it copies the engine's
  own figure into the witness's column — literally the vice this whole lab is about,
  both operands from one message — and `differs === 0`, `ok === true` and
  `rows.length >= 6` all still pass, because a difference count that is never incremented
  reads exactly like a difference count that is zero. This mattered more than the other
  two: corrupting *only* the engine's route turns five properties red, and every one of
  those five reaches the defect **through that comparison**. It was the only thing
  carrying route A at all, and nothing was carrying it.
- **The step-log audit.** Replace every boolean `UTAS.audit` returns with the literal
  `true` and five properties over eleven runs — fifty-five executions, more than eight
  hundred log entries — stay green.
- **The witness's verdict.** Force `ok` to true and empty its reasons, and the two
  properties in the centrepiece group that read exactly those two fields stay green.

The fix in all three cases is the same one this lab already applies to its timer audit and
its index-backed reader: a planted fixture the check has to refuse. The comparison is now
handed one engine figure moved by seven and must report the label, the direction and the
size of the gap; the audit is driven against a log with a repeated sequence number, a
hole and a reading large enough to be a clock, and a second log whose only write has no
read behind it; the verdict is shown an append-only store holding fewer rows than the
snapshot it was handed recorded, and must refuse to certify it and say why. Those three
negatives are what turned the three `0 red` rows above into 2, 2 and 1.

### And three more, found by asking the same question one level up

A later adversarial pass asked the question the previous one had not: not *is this
judgement reproduced*, but **are the two things being compared actually two things**.

- **The two routes were one edit away from being one route, in two places.** Filling the
  engine's own figure out of the witness's verdict — two lines — left all 542 executions
  green (the suite's size before this pass), `differs === 0`, and, on the real page,
  **every row of the on-screen difference column still reading zero** with the badge
  green. A comparison cannot see that its
  operands came from the same place. Three things changed. Route A is now **one
  function**, `DB.ruteA`, called by the page and by the suite alike, where there were two
  copies and only one of them could ever be audited. That function is read back at
  runtime through `Function.prototype.toString` and any line in it that fills the map from
  a verdict is a red line — proved against a planted body that does exactly that. And the
  map it returns is **frozen**, so the collapse cannot be performed by a caller either:
  the same edit that used to hide a seven-rupiah overstatement now throws, and the
  overstatement shows up in the difference column where it belongs.
- **The egress fold across the realm boundary was never exercised.** The page's counter
  cannot see inside a worker — that is the entire reason a fold exists — and every
  property in the suite read a counter while nothing travelled the path between them.
  Deleting the folding line left all 542 executions green. Two worker realms are now each
  asked for one **fabricated** attempt through their own guard (no request is made, and
  the runner's network listener is the independent check on that), and the page's counter
  must move by exactly one per realm and then be taken back out **by count and by target,
  never by zeroing** — a line that zeroes that counter is a line that can hide a real
  attempt. Deleting the fold is now 3 red; removing `guard.js` from the worker's imports
  is 7; replacing a worker's reported total with a literal `0` is 1.
- **A description was printed as a quotation.** The Audit tab quotes two shapes from this
  repository with a file and a line. One of them, `labs/gudang/store.js:135-139`, is a
  comment reproduced word for word. The other was **a sentence this lab had written about
  somebody else's code**, set in curly quotes under `labs/saku/sync.js:47`, where no such
  sentence occurs — and nothing on the page or in the suite distinguished it from the
  genuine one. It now carries the source lines themselves, verbatim, with the elision
  marked; this lab's description of them is printed separately, in this lab's own voice,
  with no quotation marks around it; and each entry states which kind of thing it is
  carrying. Both are checkable with one `sed` command, and those commands are in the table
  above. What the suite can pin from inside a browser is the shape, not the characters —
  nothing in this lab reads the site's own source at runtime — and it says so.

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

## Why 187 properties and not 500

Rombak reported 262 because it had 33 tables, 19 indexes, 9 migrations and 4 rebuild
variants to be right about. This lab has **six mechanisms**: `IndexedDB` transaction
scope, the await interleaving, the append-only fold, idempotency, Web Locks, and the two
clone seams. Ninety to a hundred and forty is what honest work on six mechanisms looks
like; 187 is where it landed once the mutation gate had asked for four more, a review
pass had replaced an Atomics count that could not go red, a flake pass had added three
that could not go red either, and an adversarial pass had added eight more for the same
reason — the two-route agreement's own provenance, the egress fold across the realm
boundary, and the shape of the two transcriptions.

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

**Properties and executions are reported separately and are never added together.** 187
properties execute 567 times, because most of them legitimately run once per arm or once
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

**The fold is driven, not described.** One fabricated attempt is put through each of two
worker realms' own guards during the run, and the page's counter has to move by exactly
one per realm and then be taken back out by count and by target. Until that existed,
deleting the line in the page's squad that performs the fold left every property in the
suite green: everything asked a counter and nothing travelled the path between two of
them.

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
reading the clock, and that is not a style preference — but the reason is narrower than
the one this README carried first, which was simply wrong. A `setInterval` gap detector
**that keeps running does see a block**: measured, one reported **789 ms** for a real
788 ms busy loop, as clearly as rAF's 710. What it cannot see is the same block when the
interval is **cleared in the same synchronous turn the block ends** — that reports
**16 ms**, one tick interval, because the late tick is discarded before anything reads
it. That is precisely how a boot-time monitor gets written, so the failure mode is not
exotic; and rAF measures when the page could paint again, which is the thing a visitor
actually feels.

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
