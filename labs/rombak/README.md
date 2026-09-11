<!--
  Rombak — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only. See /LICENSE.
  https://biassp.github.io/
-->

# Rombak — changing a schema that already has rows in it

**Live:** https://biassp.github.io/labs/rombak/

A real SQLite database, in the browser tab, walked forward through nine schema
versions against data that is already in it.

The other seven labs on this site keep their data in IndexedDB, which means
every guarantee they make about it is a convention the application code hopes
it kept. This one hands the guarantees to the database and then tries to break
them.

The point is not that it has tables. The point is the operation nobody
demonstrates: **a table rebuild that commits successfully, passes
`PRAGMA foreign_key_check`, reports no error anywhere — and has silently
deleted rows.** The page runs four variants of it side by side, and the
difference between the one that refuses and the one that destroys is one word
in a child table's DDL.

---

## Every number below came from a run

Measured on one machine, one run, on a clean boot walked to version 9:

| | |
|---|---|
| SQLite | 3.49.1, compiled to WebAssembly (sql.js 1.14.2) |
| `PRAGMA user_version` | 9 |
| `PRAGMA foreign_keys` | 1 — and it read **0** immediately before the lab set it |
| Tables | 33 |
| Indexes | 19 (excluding SQLite's own auto-indexes) |
| Triggers | 3 |
| Migrations | 9 |
| Rows | 47,611 |
| `db.export()` | 8,704,000 bytes of real `.sqlite` file |
| Assertions | **262 distinct properties, 94 of them negative**, across 18 groups, executing 1,012 times. 0 failed. |
| Network calls | 0 |

Timings are deliberately absent from this table. Every timing the page shows is
a mean over N runs with N printed and adjustable, because Chromium clamps
`performance.now()` to 0.1 ms and a single-shot measurement of a sub-millisecond
query quantises to 0.0 or 0.1 and reads as fabricated. No assertion in the suite
pins a timing: a suite that pins one is a suite that will lie on somebody else's
laptop.

---

## How to run it locally

```bash
git clone https://github.com/biassp/biassp.github.io
cd biassp.github.io
python -m http.server 9070
# then open http://127.0.0.1:9070/labs/rombak/
```

It must be served over HTTP. `file://` will not work, and that is the CSP doing
its job: the page ships `script-src 'self'`, and a `file://` origin is opaque, so
`'self'` can never match.

To run the assertion suite headlessly, from the repository root:

```bash
npm ci
npx playwright install chromium
npm run test:labs
```

---

## What is real, and what is simulated

### Real — this is genuine, working machinery

- **SQLite itself.** Not a shim, not an emulation, not a query-builder pretending.
  The real engine, the real parser, the real query planner, version 3.49.1.
- **The schema.** 33 tables with foreign keys, `CHECK` constraints, generated
  columns, partial indexes, `WITHOUT ROWID` tables and `STRICT` tables.
- **The nine migrations.** Each one runs against rows that are already there.
  Three of them refuse, on purpose, because the data violates the constraint
  being added — and after each refusal every row count and the census checksum
  equal their pre-migration values exactly. Rollback leaving no trace is the
  property you actually care about at 2am.
- **The twelve-step table rebuild**, the procedure SQLite's own documentation
  prescribes for changes it cannot make in place, against the naive version of
  the same change, run side by side.
- **`EXPLAIN QUERY PLAN`.** Real plans from the real planner, including the cases
  where an index does *not* help.
- **The audit chain.** SHA-256 in pure JavaScript over a canonical JSON encoding,
  hash-chained, with append-only triggers.

### Simulated — fabricated, deliberately, and the schema enforces it

Every row is fabricated, and this is not a promise in a README — it is a
constraint:

- Every national identity number is `NIK-FIKTIF-…` and every insurance number
  `BPJS-FIKTIF-…`, under a `CHECK … GLOB` that makes a **valid-shaped one
  unstorable**.
- Phone numbers carry `FIKTIF` in the middle.
- `patient.is_demo` is `CHECK (is_demo = 1)`, so the table is structurally
  incapable of holding a row that claims to be real.

The whole database is rebuilt from one seed number and one pinned date on every
page load. Moving the pinned date by one day changes the audit chain head, and
that is asserted.

### Not built

- **No concurrency.** One in-memory database, one writer. Nothing here says
  anything about `BEGIN IMMEDIATE`, WAL mode, busy timeouts, lock contention or
  a migration running while writes arrive. That last one is the hard part of
  real migrations and this lab does not claim it. A sibling lab now picks up
  part of what this paragraph declined —
  [`labs/serobot/`](../serobot/) races two writers at one balance — but not the
  migration-under-load case, which stays unclaimed here and there.
- **No durability.** No disk, no `fsync`, no crash recovery, no corruption
  repair.
- **Not Postgres.** No `ALTER TABLE … ADD CONSTRAINT`, no transactional DDL in
  the Postgres sense, no `CREATE INDEX CONCURRENTLY`, no MVCC, no `EXPLAIN
  ANALYZE` with real cost estimates. Several things this lab makes a fuss about
  are non-problems in Postgres — a table rebuild is one of them. That is stated
  on the page rather than quietly omitted.
- **No ORM, no migration framework.** The point is what those tools do for you
  and what they cannot.

---

## The five minutes that show whether it works

1. **Migrations tab.** Walk the ladder from v1. Watch three of the nine refuse,
   and watch the row counts and the census checksum come back identical after
   each refusal.
2. **Rebuild tab.** Run all four variants. Variant **A** throws `FOREIGN KEY
   constraint failed`, then throws again on the rename, then **commits anyway**,
   leaving a stray committed table behind — a failed statement did not abort the
   transaction. Variants **B** and **C** commit cleanly, silently destroying
   child rows, with `PRAGMA foreign_key_check` returning `[]` afterwards.
   Variant **D**, the twelve steps, keeps everything.
3. Then look at `sqlite_master` before and after in B and C: **every index and
   every trigger on the rebuilt table is gone**, and nothing said so.
4. **Constraints tab.** Try to orphan a row. Try to store a second primary
   diagnosis. Try to put a valid-shaped NIK in. Watch how many `NULL`s a
   `UNIQUE` column will accept.
5. **Plans tab.** Add an index and watch a plan change from `SCAN` to `SEARCH`.
   Then find the queries where adding an index changes nothing, and the one where
   it makes the query slower.
6. **Console tab.** Type your own SQL. Then check the live badge in the header:
   the invariants are recomputed over the database actually in front of you,
   including whatever you just did.

---

## The rebuild, in one paragraph

SQLite cannot add a constraint to an existing table. The documented answer is a
twelve-step procedure: turn foreign keys off, start a transaction, capture the
DDL of every index, trigger and view on the table, create the new table, copy the
rows, drop the old table, rename the new one, recreate what you captured, check
`foreign_key_check`, commit, turn foreign keys back on. Skip step one and the
copy-then-drop can fire `ON DELETE CASCADE` on children you never mentioned.
Skip step three and you lose every index and trigger on the table. Neither
failure raises anything. Both commit.

Two details make it worse, and both are demonstrated:

- `PRAGMA foreign_keys` is a **no-op inside a transaction**. It returns OK and
  the pragma still reads 1. The order matters: off *before* `BEGIN`.
- Foreign keys default to **OFF** in SQLite. A schema full of `REFERENCES`
  clauses that nobody enabled is decoration. The page records that
  `PRAGMA foreign_keys` read 0 immediately before the lab set it.

---

## The trigger that protected the rows and not itself

The audit table is append-only, enforced by `BEFORE UPDATE` and `BEFORE DELETE`
triggers that `RAISE(ABORT, …)`, plus a self-referencing foreign key from each
entry to its predecessor's hash.

A naive rebuild of that table gets past all of it. `BEFORE DELETE` triggers do
not fire on `DROP TABLE`'s implicit delete. A `DEFERRABLE INITIALLY DEFERRED`
self-FK is checked at `COMMIT`, by which time the new table satisfies it. So the
rebuild commits, every row survives, the data is rewritten — and both triggers
are silently gone. `SELECT name FROM sqlite_master WHERE type='trigger'` comes
back empty.

A table rebuild is the one operation that removes an append-only guarantee
without raising anything.

---

## Why 262 properties and not 3,000

Rows are free. Inserting 300 of them and reading them back would add 300
assertions and prove nothing about the author, which makes it the easiest way in
the world to manufacture four digits in a database lab. So there is a rule:

> **No assertion in this suite may have SQLite's own correctness as its subject.**

Every property here is about a decision made in this repository, or about a
boundary this lab's central claim rests on. 94 of the 262 are **negative** —
they pass only when the database refuses — and they use a `throwsWith` helper
rather than a bare `throws`, because *"it refused"* and *"it refused for the
reason I claimed"* are different assertions and only the second one catches a
`CHECK` firing where a foreign key was meant to.

**Properties and executions are reported separately**, on the badge and here,
because they are different numbers and conflating them flatters the total. 262
distinct properties execute 1,012 times, the gap being properties asserted across
many tables or many fixtures. Every count on this page and in this file is
emitted by the suite at runtime and transcribed from a real run. None is typed by
hand.

For comparison, and in the interest of not holding the siblings to a standard
this lab invented afterwards: `labs/buku/tests.js` has 815 assertion call sites
in source and reports 1,274 executed, the difference being 45 `forEach` loops
over fixtures. That is legitimate work, but a reader assumes the headline counts
distinct properties. This lab reports both.

---

## Verification runs on two routes that share no code

Every figure this page presents as verified is computed twice, by two paths that
cannot reach each other:

- **The SQL route** lives in `engine.js` and uses aggregates.
- **The JavaScript route** lives in `census.js`, which reduces raw rows by hand.

`census.js` is a deliberate firewall. It references exactly two globals —
`ROMBAK_DOMAIN` and `ROMBAK_CENSUS` — and that is checkable:

```bash
grep -o 'ROMBAK_[A-Z]*' labs/rombak/census.js | sort -u
```

It takes database access as an **injected function**, so it cannot reach the
engine's helpers, its plan cache or its migration state. It builds its own table
list from `sqlite_master` at census time rather than being handed one. Before
reading a table it asserts that the plan for its own bare `SELECT *` is exactly
`SCAN`, and **refuses to proceed** if it is not. It never reads
`schema_migration` and never reads `PRAGMA user_version`.

This exists because a proof that recomputes a figure from the same cached total
it claims to verify can only ever report zero, and this repository shipped that
bug three times before. During review, eleven mutations were injected into the
shipped files one at a time and the suite re-run after each: **seven checks
stayed green while their subject was corrupted.** All seven were fixed and each
fix was re-verified by the same method. A check that has never been seen to go
red is not a check.

### What is still not covered, stated plainly

- **`app.js` has no automated control.** The suite asserts the engine, the
  runner, the census and the domain. Nothing asserts the renderers, so a broken
  panel would not fail CI. The page prints both sides of every comparison it
  makes, which is the only defence, and it is a weaker one.
- **The runner's step-10 refusal branch has never fired.** All four real
  refusals come from SQLite directly or from the money guard. That branch is
  unexercised code on the page's most load-bearing path.
- **The zero-console-error check cannot be controlled.** Its success is an empty
  answer, and building a probe for it means removing the print handlers, which is
  the regression rather than a test of it.

---

## The suite runs in a worker, and that was not the first design

The suite is about twenty seconds of uninterrupted work: booting SQLite, seeding
roughly 48,000 rows, walking the nine-version ladder twice over to prove each
step is a no-op the second time, and running four full table rebuilds. That is
honest work and it is not going to get much faster.

Run on the main thread it was also twenty seconds of frozen page. Measured before
the change, on this machine: a single **23.6-second block** during which nothing
scrolled and no tab responded. Yielding between groups would not have fixed it —
two groups take over seven seconds each on their own, so the page would still
have locked up for seven.

So the whole engine moved into a worker. After the change the longest main-thread
block is **1.2 seconds**, and every tab responds in under 100 ms while the suite
is still running. The badge takes the same ~29 seconds to reach `1012/1012`; the
difference is that the page works the entire time the suite is running. That
sentence is about the suite and nothing else — the ladder is a second block on the
same thread, it is not in the worker, and the section below is about that one.

This was possible without touching any of the engine files because they are all
DOM-free by design — only `app.js` and `store.js` reach for the document or for
storage. The worker gets the wasm as base64 from the same vendored script the
page uses, so it makes no network request either.

The main thread keeps `ROMBAK_TESTS.run()` exactly as it was, and that is the
path CI drives. Moving the badge off-thread changed nothing about what is
verified on every push. It is also the fallback: a worker can fail to start for
reasons that have nothing to do with this code, and both paths were verified to
reach `1012/1012` — the second by deleting `window.Worker` before load.

---

## The ladder walk is chunked, and one rung per timeout was not enough

The nine rungs are the other long job on this page and they cannot move into a
worker: the ladder walks the database the tabs are showing, so it runs here. A
rung is a migration plus one or two censuses, a census is about a third of a
second, and boot takes **19 of them** to get from v1 to v9.

The walk was already chunked, one rung per `setTimeout(…, 0)`, and that was not
enough. How it was measured: fourteen page loads, one real trusted click each on a
tab button, at 800 ms through 6,000 ms after navigation commit, timing the press
against the page's own capture-phase listener. Before the change those clicks were
answered in **5–6 ms when the press happened to land between tasks and in
372–1,327 ms when it landed inside one**, and the longest single main-thread block
was **1,460 ms**. Two things were wrong with the chunking. A refusing rung is
three census-bearing calls in ONE task — the refusal, the one-statement fixes, the
re-run — and those were the longest tasks on the page. And a timer tick is not a
painted frame, so the rung the page was on was never actually seen.

So the unit of a chunk is one census-bearing call rather than one rung, and the
yield is `requestAnimationFrame` and then a task, which puts the work after a
frame the browser has committed. The same fourteen clicks are now answered in
**2–7 ms between chunks and 305–445 ms inside one**, and the longest block is
**0.70–0.85 s** — `RN.boot()` itself, which applies v1 and pours in the whole
fixture in one call and cannot be split from `app.js`. The shape is still
bimodal, because a press either lands in a gap or waits out the chunk it landed
in; what changed is how long that chunk is. Nothing about the ladder changed: the
same `applyOne` calls in the same order, the same auto-fix, the same 19 censuses.

**Rewind and replay** was worse than boot. `RN.rewindTo(9)` reopens v1's bytes and
replays all nine rungs inside one call, which measured a **single 9.4–10.3 second
block** — no spinner, no disabled button, nothing said until it was over. The page
now asks the runner only for the reopen, which is cheap, and replays through the
same chunked walk. Measured after, over the three buttons that do it: **17 chunks,
longest block 830–927 ms**, and a labelled busy state painted **86–193 ms after
the press** that greys every button until the replay finishes.

While the ladder is walking, the three tabs that measure something once and keep
it — Plans, Rebuild, Constraints — hold back rather than print figures taken off a
half-migrated database, and fill in when the walk arrives. That is the cost of a
page that answers during the walk, and it is the right one: a plan measured at v4
is a plan of a schema about to stop existing, and nothing would ever have
re-measured it.

What is still true: the total is unchanged. Chunking buys no speed and was never
meant to — boot still takes about six seconds of real work. It buys a page that
answers while that work happens, and a badge that says which rung it is on.

---

## Vendored SQLite: 878 KB, and one claim on this site was wrong

This lab checks a WebAssembly build of SQLite into the repository. The suite index
said `0 dependencies`; that sentence was false, not nuanced, and it has been
corrected everywhere it appeared rather than reworded into something technically
defensible. The index now reads **9 of 10 labs with zero dependencies**.

`vendor/sqlite-wasm-base64.js` is the file, and about a fifth of it is pure
base64 overhead over the 658,410-byte binary, paid by every visitor before any of
my own code runs. It is base64 rather than a `fetch` because fetching the `.wasm`
the normal way is a network request, and every lab here ships
`connect-src 'none'` with a counter pinned at zero. That claim is worth more than
the overhead. The counter still reads 0 after everything on this page has run,
and as of this change CI asserts that for all seven labs rather than trusting the
badge.

It is also the one exception to this site's promise that you can read the source:
that file is a single unreadable line and roughly a quarter of what this lab
ships. `node tools/vendor-sqljs.js labs/rombak` regenerates all three vendored
files and `git diff` afterwards is empty — which is why `sql.js` is pinned to
exactly `1.14.2` rather than a caret range that would quietly expire.

sql.js is MIT, Copyright (c) 2017 sql.js authors; SQLite itself is public domain.
Neither is covered by this repository's all-rights-reserved licence. The licence
text is at [vendor/LICENSE](vendor/LICENSE) and the third-party banner at the top
of each generated file is not to be removed.

The Content-Security-Policy on this page is also weaker than on the other seven
labs: `script-src` gains `'wasm-unsafe-eval'`, which permits WebAssembly
compilation and instantiation. It does **not** permit `eval()`, `new Function()`
or inline script. `connect-src 'none'` — the directive that actually protects the
data — is byte-identical to every other lab here.

---

## Privacy

Nothing leaves the tab. There is no server, no analytics, no font request, no
telemetry, no error reporting. `connect-src 'none'` is declared in a
`<meta http-equiv="Content-Security-Policy">` in the page's own source, so the
browser enforces it whether or not you believe this paragraph, and `guard.js`
wraps `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and
`navigator.sendBeacon` to count attempts and show the total in the header.

The only thing stored is your theme choice, in `localStorage`, and a database you
explicitly choose to save, in IndexedDB under `rombak-db`. Every storage access
is wrapped in `try/catch`, because `localStorage` throws outright in a browser
set to block site data and one unguarded read is enough to blank a page.

---

## Files

| File | What it is |
|---|---|
| `index.html` | The page. Seven panels, all empty — every one shows SQL, and SQL is full of `<` and `&`. |
| `app.css` | Tokens and both themes. Every light-theme token carries its measured contrast ratio in a comment. |
| `guard.js` | Theme before first paint, and the five wrapped network APIs. |
| `domain.js` | Pure. Seeded PRNG, integer arithmetic, canonical JSON, SHA-256, SQLite header decoding. |
| `schema.js` | Strings and data only. The DDL the page displays and the DDL the engine runs are the same array. |
| `plans.js` | The named queries and their expected plans. |
| `seed.js` | Pure: returns rows, inserts nothing. |
| `census.js` | The verification firewall. Two globals, injected database access. |
| `engine.js` | The only file that knows sql.js exists. |
| `runner.js` | The migration ladder, the twelve steps, and the naive rebuild kept as a real function because the page runs it. |
| `store.js` | IndexedDB for a saved database, `localStorage` for the theme. |
| `tests.js` | The 262 properties. |
| `tests.worker.js` | The same suite, off the main thread. |
| `app.js` | The only file that touches the DOM. |
| `tools/check-rekam-agreement.js` | Run by hand: checks this lab's canonical JSON and SHA-256 agree with `labs/rekam/audit.js` on six fixed vectors. It will drift silently if that file changes and nobody runs it. |
| `vendor/` | SQLite. Third party, generated, MIT. |

---

© 2026 Bias Satrio Putra. All rights reserved. Not open source — see
[/LICENSE](../../LICENSE).
