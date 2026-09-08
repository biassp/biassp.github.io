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
the four things a school system is actually judged on:

1. **The timetable is solved, not arranged.** School scheduling is a constraint satisfaction
   problem, and this implements one: backtracking with forward checking, a dom/wdeg variable
   ordering whose conflict weights survive restarts, soft-cost value ordering, frequent
   restarts, and a min-conflicts improvement pass. It either produces a provably conflict-free
   week or reports exactly which constraint ran out of room and for whom. It never emits a
   half-broken schedule.
2. **Everything is scoped to a tahun ajaran — including the configuration.** A rombel is keyed
   by `(academic year, name)`. 8B in 2025/2026 and 8B in 2026/2027 are different objects
   holding different children. So are the assessment weights and the KKM: a school revises its
   KKM in the KOSP every year, and a rapor that has already been signed must keep the KKM it
   was signed under. A student not enrolled in a year has *no* rapor for that year, and the app
   says so instead of rendering an empty one.
3. **The rapor is a document a school could actually issue.** Kurikulum 2013, consistently:
   every subject carries two separate marks — KI-3 pengetahuan and KI-4 keterampilan — each
   with its own weighting, its own predikat against the KKM and its own deskripsi capaian,
   plus sikap spiritual and sosial from the wali kelas, plus ketidakhadiran counted in *hari*.
4. **Time is real.** An assessment component appears only after its window has closed;
   attendance exists only for days that have actually happened; a rapor for a semester that has
   not started is refused rather than fabricated. A SIAKAD in week six is mostly empty cells.

Everything runs in the tab. No framework, no bundler, no dependency, no build step, no network.

---

## Absolutely everything here is fabricated

Children's records are the most sensitive category a school system holds after medical data, so
this demo does not contain any.

- **Names** are assembled syllable by syllable from invented Indonesian phonotactics
  (`domain.js`, `fabricateNama`), not drawn from any list of real people.
- **NISN** values come from a synthetic `99xxxxxxxx` block that the registry in `domain.js`
  allocates itself. They are structurally valid ten-digit numbers and were issued by nobody.
- **Three identifier classes are absent on purpose**, because none of them has a safe fake
  form:
  - **NIK** — there is no structurally safe way to fabricate one.
  - **NIP** — a syntactically correct 18-digit NIP is a real civil servant's number with high
    probability, and NIPs are published in SK. An obviously *absent* NIP reads as a decision;
    a wrong-length one reads as unfamiliarity. The Guru tab says so out loud.
  - **Parent phone numbers** — an `08xx` number drawn at random sits inside the live Indonesian
    mobile numbering space and can dial a real human being. It was the one field in a fake
    school that could, so it is not generated at all.
- **The school** is `SMP Negeri Nusa Kenanga (satuan pendidikan fiktif)` with NPSN `00000000`.
- **Marks, attendance, contributions, PPDB applications** are pure functions of a seeded PRNG
  and a hash. There is nothing to leak because there is nothing real.

The header carries a network counter that stays at **0**. The page ships
`connect-src 'none'` in its own `<meta http-equiv="Content-Security-Policy">`, so the browser
refuses outbound connections whatever the document's JavaScript asks for; `guard.js` wraps
`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` and `EventSource` and counts attempts.

One honesty note that took a while to get right: **a `<meta>` CSP does not apply inside a
dedicated worker's global scope.** `connect-src 'none'` therefore never covered
`solver.worker.js`, and the badge would have been a claim about the document while the footer
sentence talked about the whole page. The worker now installs the same wrappers itself and
posts any attempt back to be counted, so the number covers both. (This is a claim about *this
page*. The CV homepage at biassp.github.io does call the GitHub API for its repository list.)

---

## Kurikulum: one curriculum, all the way through

The app models **Kurikulum 2013 for SMP** (Permendikbud 35/2018) and is consistent with it end
to end. That matters more than it sounds: KKM and the A–D predikat are K13 apparatus, while
"Pendidikan Pancasila" and a standalone Informatika are Merdeka naming — an app that mixes them
produces a JP table matching no official structure and a rapor no school could issue. A wakasek
kurikulum reads the JP table before anything else, because it is what they build the jadwal
from.

| Kelompok | Mata pelajaran | JP | Blok | Ruang |
|---|---|---|---|---|
| A | Pendidikan Agama dan Budi Pekerti | 3 | 3 | |
| A | Pendidikan Pancasila dan Kewarganegaraan | 3 | 3 | |
| A | Bahasa Indonesia | 6 | 2 + 2 + 2 | |
| A | Matematika | 5 | 3 + 2 | |
| A | Ilmu Pengetahuan Alam | 5 | 3 + 2 | Lab IPA |
| A | Ilmu Pengetahuan Sosial | 4 | 2 + 2 | |
| A | Bahasa Inggris | 4 | 2 + 2 | |
| B | Seni Budaya | 3 | 3 | |
| B | PJOK | 3 | 3 | lapangan / aula |
| B | Informatika | 2 | 2 | Lab Komputer |
| mulok | Bahasa Jawa | 2 | 2 | |
| | **38 JP intrakurikuler + 2 JP mulok = 40 JP** | | | |

Informatika occupies the "Prakarya dan/atau Informatika" slot that K13 revisi gives the school a
choice over; this school chose Informatika, so Prakarya is not offered. Offering **both** at
2 JP each is 2 JP more than the structure allows.

**Assessment follows from that choice.** Two aspects per subject, with genuinely different
instruments:

| | KI-3 Pengetahuan | KI-4 Keterampilan |
|---|---|---|
| components | Tugas / UH / PTS / PAS | Praktik / Produk / Proyek / Portofolio |
| default weights | 20 / 30 / 20 / 30 | 35 / 25 / 25 / 15 |
| predikat | from the subject's KKM | from the same KKM |
| deskripsi | one sentence naming the materi the child is strong and weak in | likewise |

Plus sikap spiritual and sikap sosial, which are the wali kelas's and are a predikat and a
sentence, never a number.

---

## The timetable solver

### The instance

Eight rombel × eleven subjects × 40 JP per week. A **variable** is one lesson *block* —
"kelas 8B needs a 3-JP Matematika lesson taught by G05 somewhere this week" — and its **value**
is a `(day, starting slot, room)` triple. That is **136 variables** with **4,258 candidate
values** between them on the seeded dataset.

The week is five days (*sekolah lima hari*, which is why the days are long): Senin–Kamis 11 JP
of 40 minutes, 07.00–14.50, with breaks after JP 3 and after JP 7; Jum'at 6 JP with one break,
ending before Jumatan. **50 JP of capacity against 40 JP of curriculum** — the ten periods of
slack are what a real school spends on upacara, projek and remedial.

The segment widths are load-bearing rather than cosmetic. `breakAfter` splits a day into
segments and a block may never straddle one, so with breaks after JP 4 and JP 8 the day is
4/4/3 and only two segments per day can hold a 3-JP block flush — not enough for a week that
contains six of them per rombel. 3/4/4 gives three, and the instance breathes.

**Staffing is tight enough to be real.** Fourteen teachers, not twenty-four: total demand is
8 × 40 = 320 JP and the 24-JP minimum that governs *tunjangan sertifikasi* puts a full load at
24, so the honest headcount is about thirteen and a half. Ten teachers land at exactly 24 JP,
two at 24 via a second subject (Informatika is chronically short-staffed and is usually picked
up by retrained Matematika/IPA staff; mulok Bahasa Jawa is carried by IPS staff), and the two
Bahasa Inggris teachers land at 16 JP. The app **reports** that shortfall rather than hiding
it — being under 24 JP is exactly why such a teacher also teaches at another school, which
comes back as one of the unavailability constraints the solver has to respect.

### Hard constraints — a solution containing any of these is not a solution

| | |
|---|---|
| `H1` | a teacher is in one place at a time |
| `H2` | a rombel is in one place at a time |
| `H3` | a room hosts one rombel at a time |
| `H4` | a teacher's declared unavailable slots are respected |
| `H5` | the weekly JP of every subject is met **exactly** |
| `H6` | a block never straddles istirahat and never runs past the last slot |
| `H7` | a lesson needing a special room (Lab IPA, Lab Komputer, lapangan/aula) gets one |

`H5` is satisfied by construction — the variables *are* the required blocks — but `verify()`
re-checks it anyway, because "guaranteed by construction" is exactly the kind of claim that
quietly stops being true.

### Soft constraints — scored, never enforced

Teacher gaps mid-day (3 per empty JP), heavy subjects touching the last slot (4), a teacher's
daily load over their declared maximum (5 per JP), two lessons of one subject stacked on one day
(6), PJOK after the second break (2). The UI shows the score before and after optimisation and
lists what is left.

### Algorithm

- **Compile.** The instance is validated first: a session naming a teacher or a room that does
  not exist comes back as a typed *data* diagnosis, not as a `TypeError` and not as a silent
  drift into the verifier where a data fault would be reported to the user as "this is a solver
  bug". Domains are then built and statically pruned: placements that would straddle a break or
  land on a declared-unavailable slot never enter the search. A variable with an empty domain at
  this stage is a **proved** infeasibility, reported before any search starts.
- **Search.** Backtracking with **forward checking** (after each assignment, every neighbouring
  variable's domain is filtered and a wipeout fails immediately).
- **Variable ordering: dom/wdeg.** Pick the variable minimising `remaining values / conflict
  weight`. Weights start at 1 — so this begins as plain MRV — and every domain wipeout adds
  weight to both the variable that lost its options and the one that took the decision. Ties
  break on block length (a 3-JP block is strictly harder to place than a 2-JP one), then degree.
- **Value ordering.** Static soft cost, plus a *segment-packing hint*: prefer placements flush
  with a segment edge. A 2-JP block dropped into the middle of a 4-JP segment leaves holes that
  no other block can use — without this hint the search burns its entire budget rediscovering
  that fact one rombel at a time.
- **Restarts.** Frequent, with a backtrack budget that grows per attempt (3,000 on attempt 0,
  then 1,500 + 400 × attempt), and the conflict weights are carried **across** them. That is the
  whole mechanism: a plain restart re-rolls the dice, a restart that keeps what it learned
  attacks the part of the instance that is actually tight.

  This is also where a real bug lived. The per-attempt budget was compared against
  `stats.backtrack`, which is the **lifetime** counter and is never reset — so every restart
  after the fifth aborted at ~400 backtracks regardless of its nominal budget, total effort was
  capped at ~121,500 instead of the millions the schedule implies, the time budget was
  unreachable (~0.7 s of an 8 s allowance ever got used), and a solvable shipped scenario was
  reported as unsolvable about 1% of the time. The fix is one token — pass
  `stats.backtrack + btBudget`, an absolute ceiling — and with it the search can actually spend
  what it was given.
- **Proof vs. budget.** When `search()` exhausts the whole tree without hitting its ceiling it
  returns a distinct `false`, and that is a proof: value ordering only reorders candidates and
  forward checking only removes values that provably conflict, so nothing was skipped. That case
  now breaks out and reports `sifat: 'terbukti'` with `tahap: 'pencarian-tuntas'`, instead of
  restarting 300 more times to re-prove the same thing and then saying "not proven impossible".
- **Improvement.** Once feasible, a bounded min-conflicts hill-climb that only ever moves
  through hard-feasible states.
- **Verification.** The result is re-verified from scratch — in the worker, and again in the
  page before anything is drawn. A schedule that fails is reported and not used.

### Measured behaviour on the seeded dataset

Four scenarios are selectable in the Jadwal tab. Numbers below are 40 seeds per scenario per
tahun ajaran under node on this machine, with the shipped options
(`budgetMs: 12000, optimiseMs: 2500, maxRestarts: 600`).

| Scenario | Result | Backtracks | Restarts | Time |
|---|---|---|---|---|
| Normal | solved, 40/40 | 0 – 3.1k | 0 – 1 | 29 – 93 ms |
| Rapat dinas — all teachers unavailable Senin JP 1–4 | solved, 40/40 | 10k – 1.3M | 4 – 76 | 0.07 – 8.0 s |
| Jam terakhir Senin–Rabu ditiadakan | solved, 40/40 | 41k – 427k | 11 – 42 | 0.2 – 2.2 s |
| Guru PJOK cuti sebulan | **proved impossible**, 40/40 | 0 | 0 | ~2 – 4 ms |

The normal instance is easy — the heuristics place most of the 136 blocks first try. That is
reported honestly rather than dressed up; the other two feasible scenarios exist precisely so a
reviewer can watch the search backtrack, restart and still succeed.

The failure is labelled as a **proof**: a variable has an empty domain before any decision is
taken, so no assignment of the other 135 could rescue it. Where the search merely runs out of
budget the app says exactly that instead of claiming the timetable is impossible — and where it
genuinely enumerates the whole space (reachable on a pigeonhole instance, asserted in the test
suite) it says *that* instead, which is a different and stronger statement.

### Manual moves

Drag a lesson, or click it and then click a target — an empty cell **or another lesson**. Both
paths run the same validator, and dropping onto an occupied slot is deliberate rather than a
dead end: it is how a user finds out *why* two things cannot share a slot. Everything is
ordinary `<button>`s, focus is restored across the re-render, and the outcome is written into a
polite live region — so the keyboard and screen-reader path is the same path, not a worse one.
Every move is validated against all seven hard constraints and a rejection names the constraint,
its code, and *who* it affects:

> `H2` Rombel 7A sudah ada Seni Budaya pada Senin JP 4–6. Satu rombel tidak bisa mengikuti dua mapel sekaligus.
> `H4` Nyadul Pokring, S.Pd. menyatakan tidak tersedia pada Selasa JP 1 (dinas kedinasan — Selasa pagi).
> `H6` Blok 3 JP akan terpotong istirahat. Blok utuh pada Senin hanya muat di JP 1–3, JP 4–7, JP 8–11.

After an accepted move the **entire board** is re-verified from scratch, not just the cell that
was touched.

---

## What else is modelled, and why

**Identifiers.** NISN (national, ten digits, issued once per human being and never reused — not
after graduation, not after a transfer out), NIS (school-local, encodes the intake year, unique
in this school only) and the roster number *absen* (position in alphabetical order inside a
rombel, re-derived every year) are three different things. Treating the roster number as an
identity is the school-system equivalent of using a bed number as a medical record number.
Rombel are **reshuffled at kenaikan kelas**, as every SMP does, so that claim is observable
rather than merely asserted: 111 of 143 children who appear in both years carry a different
roster number, and 84 change rombel letter.

**Tahun ajaran & semester.** Two academic years are in the data, and all three cases that break
a naive schema are present:
- joiners — the current kelas 7 have *no* 2025/2026 record; they were still in primary school;
- leavers — the 2025/2026 kelas 9 have *no* 2026/2027 record;
- and the one that actually breaks `tingkat = f(angkatan)`: one child **repeats** kelas 8, one
  transfers **in** mid-career carrying their own NISN, and one transfers **out**. Enrolment is a
  per-year fact, not a formula over the intake year.

**Assessment.** Weights must total exactly 100 or nothing is computed at all
(`hitungNilaiAkhir` returns `nilai: null`, not a rescaled number). Rounding happens **once, at
the end** — rounding each contribution first drifts by up to two points and makes the printed
sum disagree with the result. Predikat is derived: `interval = (100 − KKM) / 3`, so 82 is a B
under KKM 70 and only a C under KKM 80. And the whole configuration is stored per tahun ajaran,
so editing this year's bobot and KKM leaves last year's rapor untouched — asserted in the suite
and reproducible in the UI in about twenty seconds.

**Time.** Each component has an assessment window tied to the academic calendar (PTS in pekan
efektif 9, PAS in pekan 18, praktik in 5, proyek in 14, and so on). Before the window closes the
cell reads *belum dinilai* and no nilai akhir is produced at all — not from part of the
weighting, and not treated as zero. On the demo's reference date, 11 December 2026, semester
ganjil 2026/2027 is complete and its rapor is a real one, while semester genap has not started:
switch the Semester selector and the rapor is refused with the date the semester begins.

**Presensi is anchored to a date.** The stored fact is `(NISN, tanggal)` from the wali kelas's
daily register; a per-subject session list is a *view* over those dated facts, projecting each
day onto whichever subjects meet that day. That is what makes the whole thing coherent: a child
ill on one Tuesday reads `S` in every subject taught that Tuesday, the rapor's Ketidakhadiran
block can be counted in **hari** (which is the unit an Indonesian rapor uses, listing Sakit /
Izin / Tanpa Keterangan and never a "Hadir" line), and "anak saya izin hari Selasa" is a query
the system can answer. A guru pengampu can still correct one session; the correction sits on top
of the day fact without erasing it.

The eligibility rule bites on **unexcused** absence, because that is what a school's kriteria
kenaikan kelas actually says — *"alpa tidak lebih dari X hari"*. A child with thirty documented
sakit days and zero alpa is not a truant, and flagging them identically throws away the only
information four statuses were collected for. Raw presence is still reported, under its own
separate label, and the rapor names which of the two rules tripped.

**PPDB.** Selection is per *jalur*, not one global ranking, and the shares are **bounds, not
targets**: zonasi ≥ 50% ranked by distance, afirmasi ≥ 15% (KIP/KPS holders) also by distance,
perpindahan tugas ≤ 5%, prestasi the residual. Floors therefore round **up**, the ceiling rounds
**down**, and the residual jalur absorbs the remainder — letting whichever jalur happens to be
last in the array absorb it yields 6 perpindahan seats out of 96 (6.25%, over a hard 5% ceiling)
and 14 afirmasi seats (14.58%, under a 15% floor), the kind of arithmetic that gets a school's
PPDB annulled on appeal. `D.periksaKuota` checks the published split against the regulation and
the tab prints the result rather than claiming it.

Age eligibility (at most 15 on 1 July of the year of entry) is checked **before** ranking:
an over-age applicant is not ranked last, they are not ranked at all, and the refusal names the
reason. And PPDB is explicitly *not* first-come-first-served — registration date is the
criterion only inside jalur perpindahan, where it is the rule; everywhere else ties break on
**age, oldest first**, then NISN.

The intake **defines** the kelas 7 rather than describing it: the selection runs first and the
winners become the students. Running it the other way round produced two screens that
contradicted each other for a third of the intake.

**Iuran komite, not SPP.** This is a SMP *negeri*, so there is no SPP — it was abolished, and
what remains is a voluntary komite contribution. Voluntary means no arrears status, no demand
letter and no consequence for a child whose family does not pay; modelling it as *tunggakan*
would describe a different kind of school from the one whose intake runs on zonasi, and those
are the two most institution-specific screens in the app. What survives from the fee ledger is
the part that is genuinely a bug magnet: **a month that has not fallen due is not outstanding**.
KIP holders are exempt as income support rather than as a fee waiver.

**Roles.** Admin/TU, guru, wali kelas, orang tua. The interesting part is what each may *not*
do: TU administers but may not touch marks or sikap; a guru may write only their own classes; a
wali kelas may **read** the whole rombel for the rapor but still only **write** their own
subject, and owns the daily register and the sikap; orang tua is read-only and single-child.
A **wali kelas is always one of their own rombel's pengampu** — otherwise the role demo is
hollow, because "wali reads all, writes only their own mapel" means nothing when the wali
teaches nothing there. Every denial renders the control and prints a sentence explaining the
rule, with a one-click path to the role that *is* permitted.

---

## Accessibility notes

Every state change tears the panel down and rebuilds it, which throws keyboard focus to `<body>`
and announces nothing. Both are handled rather than assumed away: focus is captured by a stable
`data-fkey` before the teardown and restored after it (including the picked lesson on the
timetable and the caret position in a mark field), and one polite live region carries the pick,
the accepted move, the specific constraint that rejected a move, the solver outcome and the test
result. Status on the komite ledger is a glyph plus an `aria-label`, not colour plus a `title`.
The theme toggle's accessible name contains its visible word and it exposes `aria-pressed`. The
timetable's JP column stays pinned when the week is scrolled on a phone.

Printing is a separate design, not an afterthought: `@media print` redefines the whole token
palette for paper (printing from the dark theme otherwise put `#34d399` on white at 1.9:1 and
made the fabrication disclaimer the faintest sentence on a child's record), and it makes the
rapor tables reflow instead of being silently clipped at the edge of A4 by an `overflow-x` that
has no scrollbar on paper.

---

## In-page assertion suite

**309 assertions** run on load; the header badge is green or red and the **Uji** tab lists them.
The same file runs under node. The headline ones:

- The solver never emits a timetable violating a hard constraint. Three independent solutions
  are generated and each is checked by **rebuilding the whole week cell by cell** and looking for
  collisions pairwise — the checker never asks the solver whether it thinks it succeeded.
- Editing this year's bobot and KKM does not move last year's rapor by a single digit, while
  genuinely moving this year's.
- The restart budget is per attempt: a hard scenario is asserted to clear the ~121,500 cumulative
  ceiling that the old collapsed schedule imposed.
- An exhausted search space is reported as a **proof** (`sifat: 'terbukti'`,
  `tahap: 'pencarian-tuntas'`), and an instance naming a non-existent teacher or room produces a
  typed data diagnosis instead of an exception.
- A NISN is never reused: no duplicates, alumni numbers stay burned, and 3,000 consecutive
  issues from a fresh registry never repeat the first.
- A weighting that does not total 100 is rejected and produces no mark at all; a component whose
  window has not closed produces no mark either.
- A rapor recomputes byte-identically — including from a school rebuilt from the seed in a
  separate object graph, and including after an edit — and carries both aspects, both
  deskripsi and both sikap.
- Attendance is day-coherent across every subject, the rapor counts in hari, and eligibility
  passes a child with 30 documented sakit days while failing one with 15% alpa.
- The PPDB quota split stays inside every regulatory bound, over-age applicants are refused
  before ranking, and the accepted candidates **are** the kelas-7 roster — checked in both
  directions.
- A guru cannot write another guru's marks; a wali kelas can read the rombel but not write it;
  Admin/TU cannot write marks or sikap at all; every wali kelas teaches in their own rombel.
- Plus: tahun-ajaran scoping, repeater / transfer-in / transfer-out, predikat band derivation,
  komite due-date logic and its vocabulary, block/istirahat geometry, UTC date handling, the
  K13 JP table subject by subject, and that the dataset is entirely synthetic with no NIK, no
  NIP and no phone number.

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
the same solver runs on the main thread — inside a `try/catch`, so a throw renders a message
instead of leaving the button stuck on "Menyusun…".

## Files

| | |
|---|---|
| `guard.js` | theme before first paint, egress counter. Loaded first. |
| `domain.js` | the school domain: PRNG, dates, identifiers, tahun ajaran, K13 assessment, presensi, iuran komite, PPDB, roles. No DOM, no storage. |
| `data.js` | the whole school fabricated from one seed: calendar, curriculum, staffing, PPDB-derived enrolment, derived marks and dated attendance, plus the timetable instance builder. |
| `solver.js` | the CSP solver, verifier and manual-move validator. Loaded by the page, the Worker and node. |
| `solver.worker.js` | message plumbing around `solver.js`, plus its own egress wrappers. |
| `akademik.js` | composes derived data with saved edits; assembles the rapor and the leger. |
| `store.js` | IndexedDB for edits only, with an in-memory fallback. Every access wrapped. |
| `tests.js` | the assertion suite. |
| `app.js` | the UI. Enforces no rule of its own. |
| `app.css` | design tokens shared with the CV and the sibling labs. |

## What is *not* here

- No server, no accounts, no authentication. Role switching is a demo control, not a login.
- No Dapodik integration and no claim of one. Real NISN allocation is national, not local.
- No P5 / projek scheduling and no ekstrakurikuler on the timetable; the ten JP of calendar
  slack are left as slack rather than modelled.
- No kenaikan-kelas *run* (the two years are generated, not computed one from the other), no
  remedial recording, no teacher payroll, no legalised transcript.
- Attendance uses a deterministic reference distribution of each subject's weekly meeting days
  rather than the solved timetable — deliberately, so that history does not move when somebody
  re-runs the solver, but it does mean the jadwal and the presensi register are consistent by
  construction rather than by linkage.
- The timetable is solved for one tahun ajaran at a time and is not versioned per semester.
