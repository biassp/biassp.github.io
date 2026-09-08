<!--
  Rekam — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only — copying, modification,
  re-branding or redistribution is not permitted. See /LICENSE.
  https://biassp.github.io/
-->

# Rekam — a clinic information system, in one browser tab

Live: **https://biassp.github.io/labs/rekam/**

A working *sistem informasi klinik*: registration and medical record numbering, a queue
(antrian) with a real state machine, SOAP encounters coded to ICD-10, prescriptions with
interaction and allergy checking, a pharmacy and cashier flow, and an append-only,
hash-chained audit trail you can break on purpose and watch the verifier catch.

No framework, no bundler, no dependency, no build step, no server, and no network. Twelve
files of vanilla HTML, CSS and JavaScript.

---

## Why this exists

Most clinic demos are a patients table with add/edit/delete. That proves nothing, because CRUD
is not what makes clinic software hard. What makes it hard is a set of rules that are obvious
to anyone who has worked in a clinic and invisible to everyone else — and getting any of them
wrong produces a system that looks fine in a screenshot and is unusable, or unlawful, in
practice.

This lab is built around those rules rather than around the table.

---

## What is real, and what is simulated

Being straight about this is the point of the section.

### Real

| Thing | Status |
|---|---|
| **ICD-10 rubrics** | ~209 genuine WHO ICD-10 (2010 revision) code/title pairs, chapter-derived, with Indonesian clinical terms. Real codes, real titles. |
| **Drug interactions** | ~30 well-established textbook pairs plus the triple-whammy rule, severity-graded. Real pharmacology (CYP3A4 statin interactions, warfarin potentiation, chelation, QT additivity, RAAS+diuretic+NSAID renal failure). |
| **Allergy cross-reactivity** | Class-based, including the penicillin↔cephalosporin cross-reactivity figure as currently understood (~1–3%, not the old 10%). |
| **BMI cut-offs** | WHO **Asia-Pacific** bands (overweight ≥ 23, obesity ≥ 25), which is what Kemenkes guidance uses — not the global WHO bands. |
| **Blood pressure grading** | Standard grade 1 / grade 2 / hypertensive crisis thresholds. |
| **SHA-256** | Real. `crypto.subtle` where available, a pure-JS FIPS 180-4 implementation as fallback, and the suite pins both against the standard vectors *and* against each other. |
| **The hash chain** | Real. Each entry commits to the previous entry's hash over canonical JSON. Tampering is genuinely detected, not simulated. |
| **BPJS capitation model** | Real. At FKTP level BPJS pays monthly per enrolled head, so a covered patient pays nothing at the counter and there is no per-visit claim. What they *do* pay is *iur biaya* on items outside the guarantee. |
| **The privacy claim** | Real and checkable. `connect-src 'none'` in the page's own CSP; the counter in the header wraps `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`. Open DevTools and watch the Network tab stay empty. |

### Simulated

| Thing | Status |
|---|---|
| **Every patient, doctor, visit, note and prescription** | Fabricated by a seeded PRNG (mulberry32) in `seed.js`. See "On the data" below. |
| **The ICD-10 subset** | ~209 rubrics out of ~14,000. Chosen for primary care, dentistry and KIA. The full classification is not mine to redistribute. |
| **The interaction database** | A demonstration of the *shape* of clinical decision support, not a clinical reference. Real deployments license a maintained database (Stockley, Lexicomp, or a Fornas-derived set) and revalidate it continuously. **Do not use this to treat anyone.** |
| **Tariffs** | Plausible round numbers, not any actual clinic's price list. |
| **The formulary** | Modelled on what a puskesmas or klinik pratama stocks under Fornas/DOEN, with invented prices. |
| **Chain anchoring** | The chain verifies *in-tab*. A production system anchors the head hash somewhere the clinic does not control — countersigned by a server key, or published daily — so that wholesale recomputation is also detectable. This demo does not, and says so in the UI rather than implying otherwise. |
| **Digital signatures** | "Signing" here means an irreversible state change attributed to a staff member, recorded in the chain. It is not a PKI signature and is not claimed to be one. |
| **Paediatric anthropometry** | Not modelled. Adult BMI bands are deliberately *not* applied under 18; a real system needs WHO growth charts. |

---

## On the data

**Every patient, doctor, diagnosis and prescription in this app is synthetic, and deliberately
obviously so.**

- **Names** are assembled syllable-by-syllable from an Indonesian phonotactic table
  (CV(C) syllables, five vowels, a small coda inventory) and joined to generic particles
  (`Nur`, `Adi`, `Dwi`) and endings (`-wati`, `-anto`) that every Indonesian phone book has
  thousands of. They read naturally and belong to nobody.
- **There are no NIKs.** The identity field holds `NIK-FIKTIF-000123`, which is not a valid NIK
  in any format — a real one is 16 digits encoding province, regency, district, birth date and
  sex. Nothing here can be mistaken for one or typed into a real system.
- **BPJS numbers** are `BPJS-FIKTIF-000123`, for the same reason.
- **Clinical narratives** come from a template bank keyed to the diagnosis, not from any record.
- The seeded prescriptions are checked against each seeded patient's own recorded allergies, so
  nothing in the demo history is a record that could not lawfully have been signed. The test
  suite asserts this.

Health data is *data pribadi yang bersifat spesifik* under Indonesia's UU 27/2022 (PDP), with
heavier obligations than ordinary personal data. A portfolio demo has no legitimate reason to
touch real patient data and no legitimate reason to transmit anything. Handling PHI carelessly
in a piece meant to demonstrate competence in this sector would demonstrate the opposite.

---

## The seven domain decisions

### 1. Three different numbers, three different lifetimes

| Number | Scope | Reused? |
|---|---|---|
| **No. RM** — `RM-000123` | One per **patient** | **Never.** Not after archiving, not after deletion. |
| **No. antrian** — `A-007` | One per **visit, per day, per poli** | **Every day**, on purpose. Meaningless outside today. |
| **ID kunjungan** — `V-20260908-0007` | One per **visit** | Never. Clinical records hang off this. |

Conflating any two is the classic beginner error, and it is not cosmetic: reusing an RM merges
two people's medical histories, and hanging a record off a queue number loses it at midnight.

The allocator bumps the counter *before* creating the patient record, so a crash between the two
burns a number rather than risking a reissue. Burning numbers is free.

### 2. Encounters, not rows

A patient record holds identity and standing facts (allergies, chronic problems). Everything
episodic — complaint, vitals, diagnosis, plan — lives on an **encounter**, one per visit, with
its own SOAP note. *"Change the patient's diagnosis"* is not an operation that exists in this
model. The record is the history.

### 3. Coded assessment

Assessment is ICD-10, not free text. Free-text diagnosis cannot be reported, cannot be claimed,
and cannot be searched back. Signing is refused without at least one code and **exactly one**
primary diagnosis.

The picker searches by code prefix (`J06`, `j069`), by English title, by Indonesian clinical
term (`ISPA`, `demam berdarah`), by lay term (`gigi berlubang`, `asam urat`), and tolerates one
typo on words of five letters or more (`hipertesi` → I10). Ranking uses a small usage prior for
the rubrics an Indonesian FKTP actually reports most, because with 200 rubrics a query matching
`I10` and `I15.9` equally on text needs something to break the tie — and a picker that puts
*secondary* hypertension above *essential* hypertension gets closed and never reopened. 200
searches run in well under 500 ms.

Two details that matter to a coder rather than to a demo. **Chapter XX (V01–Y98, external
causes) is present**, so an injury can carry the second code that says how it happened — which
in Indonesia is the code that decides who pays. And the vitals engine suggests **R03.0**
("elevated blood-pressure reading, without diagnosis of hypertension") for a single raised
office measurement, offering I10 only for a patient who already carries it: auto-coding I10 off
one triage reading would inflate the FKTP hypertension prevalence that BPJS reports against.

### 4. Append-only, tamper-evident audit

A medical record must be **correctable** and must not be **silently rewritable**. Those pull in
opposite directions, and the reconciliation is the same everywhere: corrections are additive.

- Signing an encounter freezes it. Direct edits after that are refused with code `immutable`.
- Corrections are **addenda**: a new record that supersedes one field. The original object is
  never touched. Both versions stay visible, struck-through original above, correction below,
  with a **mandatory** written reason.
- Every mutation appends an entry to a hash chain. Each entry commits to `prevHash` over
  canonical JSON (sorted keys, no whitespace), so editing entry #7 invalidates #7 **and every
  entry after it**.
- **Verify** walks the chain from genesis, reading the entries back **off IndexedDB**, and stops
  at the first break, naming four distinct failure modes: `hash` (an entry was edited in place),
  `link` (an entry's `prevHash` no longer matches), `sequence` (an entry was deleted or inserted),
  and `truncated` (see below).
- **Tail deletion is the cheap attack, and a bare chain cannot see it.** Editing entry #7 forces
  a recomputation of 8..n; deleting the last three rows costs nothing — the walk simply runs out
  of rows early and reports everything that remains as perfectly intact. "Delete the rows that
  record what I just did" is also far likelier than a wholesale rewrite. So the chain's **length
  and head hash are committed outside the chain**, in the `meta` object store, rewritten on every
  save; verification compares them and reports `truncated` naming how many entries are missing.
- Two buttons demonstrate both attacks against the real database, bypassing the application:
  **"Rusak satu entri di basis data"** rewrites a stored row, **"Hapus 3 entri terakhir"** deletes
  the tail without recomputing anything. Press either, then press Verify. The demo would prove
  nothing if the audit lived inside the state blob, which is why it is a separate store keyed by
  `seq`.

This does not make tampering impossible: whoever can delete audit rows can edit `meta` too. What
the commitment buys is that tail deletion now costs the same as editing — you have to forge the
commitment as well — instead of costing nothing. Closing the last gap needs a signature from
outside the clinic's control (a server key, or a daily published head hash). It makes *silent*
tampering impossible, and in a dispute that is the property that matters.

Draft edits are deliberately **not** chained one-per-keystroke. Burying the signature in noise is
its own kind of failure. The auditable event is the signature — and rejected queue transitions
and refused prescriptions, which are exactly what an auditor asks about later.

### 5. Prescriptions with teeth

Four severities, and the grading is the whole point — a system that warns about everything gets
clicked through:

| Severity | Behaviour |
|---|---|
| `kontraindikasi` | **Hard stop.** Signing refused. No override path exists. |
| `mayor` | Refused until a typed clinical reason (≥ 10 chars), which is stored on the prescription **and written into the chain as its own entry naming the prescriber**. |
| `moderat` | Warn. |
| `minor` | Informational — usually a timing or monitoring note. |
| `kelengkapan` | Not a clinical severity. A prescription line whose signa is unfinished blocks signing just as firmly, but it is reported and worded as *"resep belum lengkap"* — calling a blank dose field an absolute contraindication spends the top rung of the ladder on a clerical slip. |

Allergies are recorded as **classes**, not products: "alergi amoxicillin" blocks ampicillin and
co-amoxiclav too. Cephalosporins are *warned*, not blocked, by a penicillin allergy — blocking
them outright on a ~1–3% cross-reactivity rate costs patients a whole antibiotic class for no
reason. The triple-whammy rule (RAAS inhibitor + diuretic + NSAID → AKI) is genuinely
three-way; a pairwise-only engine misses it, which is why it is implemented and asserted
separately — and it matches **analgesic-dose** NSAIDs only. Cardioprotective aspirin 80 mg is
tagged `antiplatelet` + `nsaid-dosis-rendah`, so the most common appropriate regimen in primary
care (ACE-i + thiazide + aspirin, post-MI) does not raise a MAYOR alert demanding a typed
justification on every repeat. Aspirin still counts as an NSAID where 80 mg genuinely counts:
inside the NSAID-allergy block and inside the bleeding rules.

**Dengue** is the rule an Indonesian FKTP most needs enforced, and it is a hard stop: NSAIDs,
aspirin and antiplatelets against A90 / A91 / D69.6 are `kontraindikasi`, because the feared
complication is bleeding and the platelet count is already falling.

**What the engine does not check, stated in the UI itself** so its silence is not read as an
all-clear: dose magnitude is checked only against **adult daily maxima**, and only for drugs
whose strength parses as a single number and whose signa can be read (`1 tablet` + `3x sehari`,
or `3x1` written whole); no paediatric mg/kg dose is ever computed — what exists is a flag that
an adult solid oral form is wrong for a given age; duplicate-therapy detection runs against a
named class table rather than every class tag, because metformin + glibenclamide is standard
therapy and warning about standard therapy is the fastest way to get warnings ignored; and renal
and hepatic function are unknown to the system, so no eGFR-based adjustment happens.

### 6. A queue that actually refuses

States: Terdaftar → Triase → Menunggu dokter → Dalam konsultasi → Farmasi → Kasir → Selesai,
plus Batal and Tidak hadir (which can be re-registered the same day).

Three different kinds of refusal, three different reasons:

- **Not in the graph** — Terdaftar → Kasir does not exist; the refusal lists what *does*.
- **Wrong role** — a pharmacist cannot move a patient into triage; the refusal names the roles that can.
- **Guard unsatisfied** — Triase → Menunggu dokter needs vitals; Konsultasi → Farmasi needs a
  signed SOAP note *and* a signed prescription; Konsultasi → Kasir is refused if a signed
  prescription exists, because the patient has to collect it, and equally if an unsigned *draft*
  prescription still carries drug lines — a draft is a doctor thinking out loud, and it is never
  billed and never dispensed.

Terminal states are terminal. A finished visit cannot be reopened — corrections go through
addenda, not through the queue board.

### 7. Roles that change what you see, per field

Four roles. Switching visibly changes the app, and **denied actions stay visible and disabled
with the reason attached** rather than disappearing. Silently hiding a control is how a clinic
ends up with three people who each believe someone else can do the thing nobody can do.

The interesting call is the pharmacist: **can** see diagnosis and allergies, **cannot** see the
subjective narrative. A pharmacist cannot review a prescription without knowing the indication;
giving them the patient's account of their marital problems serves no purpose. Minimum necessary,
applied per field rather than per screen. Registration staff see demographics and billing but no
clinical *narrative*: the S, O, A and P sections are refused with a reason, and on the bill the
drug lines — a drug name is a diagnosis in disguise, "Permetrin krim" says scabies — collapse to
"Obat (n item)" with a total per payer. Pharmacists and doctors see the itemised version, because
they are the ones who need it.

---

## Indonesian context

- **No. RM**, **poli** (Poli Umum / Poli Gigi / KIA-KB) with per-poli queue prefixes.
- **BPJS vs umum.** At FKTP, BPJS is **capitation**: the clinic is paid monthly per enrolled head
  whether the patient attends or not, so a covered patient pays **Rp 0** at the counter and no
  per-visit claim is filed. The bill therefore carries two genuinely different numbers — the
  tariff value of what was delivered, and what the person at the counter actually hands over.
  Items outside the guarantee (non-formulary drugs, cosmetic scaling, a *surat sehat* for a job
  application) become **iur biaya**. And a third case the counter meets weekly: an **accident**
  is not BPJS Kesehatan's to begin with. A road traffic injury goes to **Jasa Raharja** and a work
  injury to **BPJS Ketenagakerjaan** before capitation applies, so a visit carries a *kasus
  kecelakaan* flag that routes the bill to the right payer and keeps its value out of the
  capitated total. Only drugs the pharmacy actually **dispensed** reach the bill — a draft or a
  cancelled prescription never does.
- **Antrian display**, three-band triage (merah / kuning / hijau) as a klinik pratama runs it
  rather than a five-level IGD scale.
- UI labels are Indonesian where a clinic would use Indonesian (Pendaftaran, Antrian, Rekam
  Medis, Resep, Kasir, Adendum). Code comments and this README are English.

---

## Running it locally

Any static server over **http://** will do. Do **not** open `index.html` as a `file://` URL: the
page ships `default-src 'none'` with `script-src 'self'`, and `'self'` does not match an opaque
`file://` origin, so the scripts will be blocked.

```sh
git clone https://github.com/biassp/biassp.github.io
cd biassp.github.io
python3 -m http.server 8930
# then open http://127.0.0.1:8930/labs/rekam/
```

`crypto.subtle` requires a secure context. `http://localhost` and `http://127.0.0.1` count as
secure, as does `https://`. Over plain http on a LAN IP, `crypto.subtle` is undefined and the
app falls back to its own SHA-256 — the header of the audit tab tells you which one is in use,
and the suite asserts the two produce identical digests so the chain never forks.

### Running the tests

In the page: the **Uji** tab, which runs automatically on load.

Under node, from the same source files:

```sh
cd labs/rekam
node -e "
global.self=global;
['./icd10.js','./drugs.js','./domain.js','./audit.js','./clinic.js','./seed.js','./tests.js'].forEach(require);
REKAM.runTests().then(r => {
  console.log('PASS', r.passed, 'FAIL', r.failed, 'of', r.total);
  r.results.filter(x => !x.ok).forEach(x => console.log(' ✗', x.group, '::', x.name, '::', x.message));
  process.exit(r.failed ? 1 : 0);
});
"
```

271 assertions across 16 groups. The load-bearing ones:

- an RM is never reused, **not even after the patient it belonged to is deleted**;
- queue numbers **do** repeat across days, and that is asserted as correct behaviour;
- the queue refuses transitions three ways with three different reason codes;
- the audit chain catches an edited entry, a deleted entry, a reordered pair — **and an entry
  whose own hash was recomputed**, which still breaks the link from the entry after it;
- an addendum supersedes without destroying: the original value is still retrievable, twice over
  after a chained correction;
- a contraindication cannot be overridden by any reason string, while a major warning can, and
  the override lands in the chain;
- BMI 24.2 is "berisiko", not "normal" — the Asia-Pacific cut-off, asserted explicitly;
- seeding is deterministic: same seed and same date produce a byte-identical clinic.

---

## Files

| File | Role |
|---|---|
| `guard.js` | Loaded first. Theme before first paint, egress counter. Every storage access wrapped. |
| `icd10.js` | ICD-10 subset, chapter derivation, fuzzy search with bounded edit distance. |
| `drugs.js` | Formulary, allergy classes, interaction rules, the safety engine. |
| `domain.js` | Pure domain: numbering, the queue state machine, roles and permissions, vitals interpretation, tariffs, the addendum projection, the seeded PRNG. |
| `audit.js` | Canonical JSON, SHA-256 (subtle + JS fallback), the chain, the verifier. |
| `clinic.js` | The transactional layer: enforces permissions and guards, writes the chain, mutates only after the entry is computed. |
| `seed.js` | Synthetic clinic generator. |
| `store.js` | IndexedDB: snapshot store + append-only audit store, plus the deliberate tamper. |
| `tests.js` | The suite. Runs in the page and under node from the same source. |
| `app.js` | View layer. Decides nothing; asks and renders the answer. |
| `app.css` | Design tokens shared with the CV. Dark default, `[data-theme="light"]` override. |

---

## Known limits

Stated because a demo that hides them is worth less than one that names them.

- **Not a medical device and not a clinical reference.** The interaction rules are a
  demonstration of shape, not a maintained database.
- The chain is verified in-tab only. The length/head commitment in `meta` makes tail deletion
  cost the same as editing, but it lives in the same database: an attacker with write access to
  both could still recompute the whole chain and rewrite the commitment to match. That is what a
  countersigning server or a daily published head hash is for.
- "Signing" is an attributed, irreversible state change — not a PKI signature.
- No paediatric growth charts, so paediatric **anthropometry** (BMI-for-age) is left
  uninterpreted, and paediatric **hypertension** likewise — that needs percentile curves for age,
  sex and height. Pulse, respiratory rate and the hypotension threshold *are* age-banded
  (APLS/PALS), because those bands are a table rather than a chart, and reading an infant against
  adult thresholds produces a textbook description of shock from a well baby.
- Dose magnitude is a ceiling check against adult maxima where the signa parses, not a dosing
  calculator; there is no paediatric mg/kg computation anywhere.
- No referral (rujukan) flow, no lab/radiology orders, no inpatient, no stock management, no
  P-Care or SatuSehat integration — all of which a real deployment needs and none of which can
  be demonstrated honestly without a server.
- Data lives in one browser tab. There is no multi-user concurrency, because there is no server
  to be concurrent against — and **two tabs of this app on one browser profile is a real hazard,
  not a theoretical one**: each holds its own clinic and its own RM counter, so they would reissue
  the same No. RM to two different people and interleave writes into the shared audit store until
  a third tab booted straight into "Rantai PUTUS" after entirely ordinary use. A demo cannot merge
  two divergent clinics and this one does not pretend to; the tab that does not own the database
  stops writing, says so in a banner that explains the consequence, and offers a single
  "ambil alih" button.
- Correcting a signed prescription is modelled as **cancel + rewrite**, not as an edit: cancelling
  is a chained, attributed act requiring a written reason, it never deletes the original, and the
  cancelled prescription is neither dispensed nor billed.

---

Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
Not open source. Readable for evaluation only. See [/LICENSE](../../LICENSE).
