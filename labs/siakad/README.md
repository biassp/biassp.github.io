<!--
  SIAKAD — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only. See /LICENSE.
  https://biassp.github.io/
-->

# SIAKAD — a school academic information system, with a real timetable solver

**Live:** https://biassp.github.io/labs/siakad/

A *sistem informasi akademik* for an Indonesian junior secondary school (SMP). The point of
this lab is not that it lists students and teachers — any CRUD scaffold does that. The point is
the three things a school system is actually judged on:

1. **The timetable is solved, not arranged.** School scheduling is a constraint satisfaction
   problem, and this implements one: backtracking with forward checking, a dom/wdeg variable
   ordering whose conflict weights survive restarts, soft-cost value ordering, frequent
   restarts, and a min-conflicts improvement pass. It either produces a provably conflict-free
   week or reports exactly which constraint ran out of room and for whom. It never emits a
   half-broken schedule.
2. **Everything is scoped to a tahun ajaran.** A rombel is keyed by `(academic year, name)`.
   8B in 2025/2026 and 8B in 2026/2027 are different objects holding different children. A
   student who was not enrolled in a year has *no* rapor for that year — and the app says so
   instead of rendering an empty one.
3. **Assessment is weighted, checkable arithmetic.** Tugas / UH / PTS / PAS with a per-subject
   weighting that must total exactly 100%, KKM per subject, predikat A–D derived *from the KKM*
   rather than from a fixed table, and a rapor that prints its own working line by line.

Everything runs in the tab. No framework, no bundler, no dependency, no build step, no network.

---

## Absolutely everything here is fabricated

Children's records are the most sensitive category a school system holds after medical data, so
this demo does not contain any.

- **Names** are assembled syllable by syllable from invented Indonesian phonotactics
  (`domain.js`, `fabricateNama`), not drawn from any list of real people.
- **NISN** values come from a synthetic `99xxxxxxxx` block that the registry in `domain.js`
  allocates itself. They are structurally valid ten-digit numbers and were issued by nobody.
- **NIK is not modelled at all.** There is no structurally safe way to fabricate one, so the
  field does not exist.
- **The school** is `SMP Nusa Kenanga (satuan pendidikan fiktif)` with NPSN `00000000`.
- **Marks, attendance, fees, PPDB applications** are pure functions of a seeded PRNG and a
  hash. There is nothing to leak because there is nothing real.

The header carries a network counter that stays at **0**. The page ships
`connect-src 'none'` in its own `<meta http-equiv="Content-Security-Policy">`, so the browser
refuses outbound connections whatever the JavaScript asks for; `guard.js` additionally wraps
`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` and `EventSource` and counts attempts.
Open DevTools and watch the Network tab stay empty. (This is a claim about *this page*. The CV
homepage at biassp.github.io does call the GitHub API for its repository list.)

---

## The timetable solver

### The instance

Eight rombel × twelve subjects × 38 JP per week. A **variable** is one lesson *block* —
"kelas 8B needs a 3-JP Bahasa Indonesia lesson taught by G07 somewhere this week" — and its
**value** is a `(day, starting slot, room)` triple. That is **136 variables** with **3,785
candidate values** between them on the seeded dataset.

The week is five days (*sekolah lima hari*): Senin–Kamis 10 JP of 40 minutes with breaks after
JP 4 and JP 8, Jum'at 6 JP with one break, ending before Jumatan. 46 JP of capacity against 38
JP of intrakurikuler curriculum; the slack is what a real school spends on projek/P5.

### Hard constraints — a solution containing any of these is not a solution

| | |
|---|---|
| `H1` | a teacher is in one place at a time |
| `H2` | a rombel is in one place at a time |
| `H3` | a room hosts one rombel at a time |
| `H4` | a teacher's declared unavailable slots are respected |
| `H5` | the weekly JP of every subject is met **exactly** |
| `H6` | a block never straddles istirahat and never runs past the last slot |
| `H7` | a lesson needing a special room (Lab IPA, Lab Komputer, lapangan) gets one |

`H5` is satisfied by construction — the variables *are* the required blocks — but `verify()`
re-checks it anyway, because "guaranteed by construction" is exactly the kind of claim that
quietly stops being true.

### Soft constraints — scored, never enforced

Teacher gaps mid-day (3 per empty JP), heavy subjects touching the last slot (4), a teacher's
daily load over their declared maximum (5 per JP), two lessons of one subject stacked on one day
(6), PJOK after the second break (2). The UI shows the score before and after optimisation and
lists what is left.

### Algorithm

- **Compile.** Domains are built up front and statically pruned: placements that would straddle
  a break or land on a declared-unavailable slot never enter the search at all. A variable with
  an empty domain at this stage is a **proved** infeasibility and is reported before any search
  starts.
- **Search.** Backtracking with **forward checking** (after each assignment, every neighbouring
  variable's domain is filtered and a wipeout fails immediately).
- **Variable ordering: dom/wdeg.** Pick the variable minimising `remaining values / conflict
  weight`. Weights start at 1 — so this begins as plain MRV — and every domain wipeout adds
  weight to both the variable that lost its options and the one that took the decision. Ties
  break on block length (a 3-JP block is strictly harder to place than a 1-JP one), then degree.
- **Value ordering.** Static soft cost, plus a *segment-packing hint*: prefer placements flush
  with a segment edge. A 2-JP block dropped into the middle of a 4-JP segment leaves two 1-JP
  holes that no other block can use — without this hint the search burns its entire budget
  rediscovering that fact one rombel at a time.
- **Restarts.** Frequent and short, and the conflict weights are carried **across** them. That
  is the whole mechanism: a plain restart re-rolls the dice, a restart that keeps what it
  learned attacks the part of the instance that is actually tight.
- **Improvement.** Once feasible, a bounded min-conflicts hill-climb that only ever moves
  through hard-feasible states.
- **Verification.** The result is re-verified from scratch — in the worker, and again in the
  page before anything is drawn. A schedule that fails is reported as a solver bug and not used.

### Measured behaviour on the seeded dataset

Four scenarios are selectable in the Jadwal tab. Numbers are from this machine (Chromium,
Web Worker):

| Scenario | Result | Backtracks | Restarts | Time |
|---|---|---|---|---|
| Normal | solved | 0 | 0 | ~40–80 ms |
| Rapat dinas — all teachers unavailable Senin JP 1–4 | solved | 15k–67k | 36–164 | ~110–450 ms |
| Jam terakhir Senin–Kamis ditiadakan | **not found** | ~121k | 300 | ~720 ms |
| Guru Informatika cuti sebulan | **proved impossible** | 0 | 0 | ~2 ms |

The normal instance takes **zero backtracks** — the heuristics place all 136 blocks first try.
That is reported honestly rather than dressed up; the "rapat dinas" scenario exists precisely so
a reviewer can watch the search actually backtrack, restart and still succeed.

The two failures are labelled differently on purpose. The `cuti` case is **proved**: a variable
has an empty domain before any decision is taken, so no assignment of the other 135 could rescue
it. The `jam terakhir` case is **not proved** — the search exhausted its budget, and the app
says so instead of claiming the timetable is impossible.

### Manual moves

Drag a lesson, or click it and then click a target — an empty cell **or another lesson**. Both
paths run the same validator, and dropping onto an occupied slot is deliberate rather than a
dead end: it is how a user finds out *why* two things cannot share a slot. Everything is
ordinary `<button>`s, so the keyboard path is identical. Every move is validated against all
seven hard constraints and a rejection names the constraint, its code, and *who* it affects:

> `H2` Rombel 9A sudah ada Bahasa Indonesia pada Kamis JP 5–7. Satu rombel tidak bisa mengikuti dua mapel sekaligus.
> `H4` Nyadul Pokring, S.Pd. menyatakan tidak tersedia pada Selasa JP 1 (dinas kedinasan — Selasa pagi).
> `H6` Blok 3 JP akan terpotong istirahat. Blok utuh pada Senin hanya muat di JP 1–4, JP 5–8, JP 9–10.

After an accepted move the **entire board** is re-verified from scratch, not just the cell that
was touched.

---

## What else is modelled, and why

**Identifiers.** NISN (national, ten digits, issued once per human being and never reused — not
after graduation, not after a transfer out), NIS (school-local, encodes the intake year, unique
in this school only) and the roster number *absen* (position in alphabetical order inside a
rombel, re-derived every year) are three different things. Treating the roster number as an
identity is the school-system equivalent of using a bed number as a medical record number. The
demo carries alumni and rejected PPDB applicants specifically so that "issued once, never
reused" is observable.

**Tahun ajaran & semester.** Two academic years are in the data. The current kelas 7 have *no*
2025/2026 record — they were still in primary school. The 2025/2026 kelas 9 have *no* 2026/2027
record — they left. Both cases break any system that models "current class" as a column on the
student row.

**Assessment.** Weights must total exactly 100 or nothing is computed at all (`hitungNilaiAkhir`
returns `nilai: null`, not a rescaled number). Rounding happens **once, at the end** — rounding
each contribution first drifts by up to two points and makes the printed sum disagree with the
result. Predikat is derived: `interval = (100 − KKM) / 3`, so 82 is a B under KKM 70 and only a
C under KKM 80.

**Presensi.** H / S / I / A per session, rolled up per subject and per semester, with the
per-semester rollup asserted to equal the sum of the per-subject rollups. Meetings per semester
come from the timetable (`blocks per week × 16 effective weeks`), not from a free-floating
number. Below 75% presence the rapor is flagged — flagged, not failed: the decision belongs to
the *rapat dewan guru*.

**PPDB.** Selection is per *jalur*, not one global ranking, modelled on the national split:
zonasi ≥ 50% ranked by distance, afirmasi ≥ 15% (KIP/KPS holders) also by distance, perpindahan
tugas ≤ 5% by registration date, prestasi the remainder by score. Unfilled seats in one jalur
roll into zonasi rather than being lost. Tie-breaks are deterministic (registration time, then
NISN) — a selection that reorders on reload cannot be defended to a parent.

**SPP.** A twelve-month ledger per student per academic year, July to June. **A month that has
not fallen due is not a tunggakan** — the bug in every hastily written arrears report, whose
consequence is a demand letter for a month that has not happened. KIP holders are exempt and
never appear as debtors.

**Roles.** Admin/TU, guru, wali kelas, orang tua. The interesting part is what each may *not*
do: TU administers but may not touch marks (assessment is the pengampu's authority); a guru may
write only their own classes; a wali kelas may **read** the whole rombel for the rapor but may
still only **write** their own subject; orang tua is read-only and single-child. Every denial
renders the control and prints a sentence explaining the rule, with a one-click path to the role
that *is* permitted — hiding a button teaches nobody anything and hides bugs too.

---

## In-page assertion suite

180 assertions run on load; the header badge is green or red and the **Uji** tab lists them.
The same file runs under node. The headline ones:

- The solver never emits a timetable violating a hard constraint. Three independent solutions
  are generated and each is checked by **rebuilding the whole week cell by cell** and looking for
  collisions pairwise — the checker never asks the solver whether it thinks it succeeded.
- A NISN is never reused: no duplicates across 360 issued numbers, alumni numbers stay burned,
  and 3,000 consecutive issues from a fresh registry never repeat the first.
- A weighting that does not total 100 is rejected and produces no mark at all.
- A rapor recomputes byte-identically — including from a school rebuilt from the seed in a
  separate object graph, and including after an edit.
- Attendance rollups equal the underlying session records, and the semester rollup equals the
  sum of the per-subject rollups.
- A guru cannot write another guru's marks; a wali kelas can read the rombel but not write it;
  Admin/TU cannot write marks at all.
- Plus: tahun-ajaran scoping, predikat band derivation, SPP due-date logic, PPDB jalur quotas
  and order-independence, block/istirahat geometry, and that the dataset is entirely synthetic.

```bash
# run the suite headlessly
cd labs/siakad
node -e "global.self=global;['domain','data','solver','akademik','tests'].forEach(f=>require('./'+f+'.js'));
         var r=self.SIAKAD_TESTS.run();console.log(r.passed+'/'+r.total,'failed',r.failed);
         r.results.filter(x=>!x.ok).forEach(x=>console.log('FAIL',x.group,x.name,x.message));"
```

---

## Running it locally

Serve over **http** — not `file://`. The page ships a strict `default-src 'none'` CSP and
`'self'` does not match an opaque `file://` origin, so the module scripts and the Worker would
be blocked.

```bash
cd /path/to/biassp.github.io
python3 -m http.server 8940
# open http://127.0.0.1:8940/labs/siakad/
```

Requires a browser with IndexedDB, Web Workers and CSS Grid. If IndexedDB is unavailable (a
hardened profile, a private window with site data blocked) the app falls back to an in-memory
store and says so in the context bar rather than failing; if the Worker cannot be constructed
the same solver runs on the main thread and the UI says that too.

## Files

| | |
|---|---|
| `guard.js` | theme before first paint, egress counter. Loaded first. |
| `domain.js` | the school domain: PRNG, identifiers, tahun ajaran, assessment, presensi, SPP, PPDB, roles. No DOM, no storage. |
| `data.js` | the whole school fabricated from one seed, plus the timetable instance builder. |
| `solver.js` | the CSP solver, verifier and manual-move validator. Loaded by the page, the Worker and node. |
| `solver.worker.js` | message plumbing around `solver.js` and nothing else. |
| `akademik.js` | composes derived data with saved edits; assembles the rapor and the leger. |
| `store.js` | IndexedDB for edits only, with an in-memory fallback. Every access wrapped. |
| `tests.js` | the assertion suite. |
| `app.js` | the UI. Enforces no rule of its own. |
| `app.css` | design tokens shared with the CV and the sibling labs. |

## What is *not* here

- No server, no accounts, no authentication. Role switching is a demo control, not a login.
- No Dapodik integration and no claim of one. Real NISN allocation is national, not local.
- No P5 / projek scheduling, no ekstrakurikuler, no mutasi (transfer in/out) workflow, no
  kenaikan-kelas run, no remedial recording, no teacher payroll.
- The timetable is solved for one tahun ajaran at a time and is not versioned per semester.
