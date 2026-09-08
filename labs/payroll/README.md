<!--
  Payroll — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only — copying, modification,
  re-branding or redistribution is not permitted. See /LICENSE.
  https://biassp.github.io/
-->

# Payroll — sistem informasi kepegawaian dan penggajian

Live: <https://biassp.github.io/labs/payroll/>

A single-page Indonesian HR and payroll system for a company of about sixty
people. Vanilla HTML, CSS and JavaScript — no framework, no bundler, no build
step, no dependency, no CDN, no API key, and no network egress of any kind.

Anyone can total a salary. What an Indonesian client cannot check for themselves,
and is therefore paying for, is **PPh 21 and BPJS**. So that is what this lab is
about: the monthly effective-rate lookup introduced by PP 58/2023, the December
reconciliation that has to true it up to the rupiah, and the four BPJS programmes
whose contribution ceilings are all different from each other.

> **This is a demo, not tax advice.** Tax tables change. Everything encoded here
> is listed below with its legal basis and its vintage. Check that vintage
> against the regulation in force before believing any figure on the page.

---

## What is real, and what is simulated

### Real — this is genuine, working machinery

* **PPh 21 under the TER regime, both halves.** January to November is a lookup:
  the employee's PTKP status selects one of three Tarif Efektif Rata-rata tables
  (A, B or C), the month's taxable gross selects a band inside it, the band's
  effective rate is applied. December — or the employee's **final month**, if they
  leave earlier — performs the full annual Pasal 17 calculation and sets that
  month's deduction to the difference. All three TER tables are transcribed in
  full: 44, 40 and 41 bands.
* **The reconciliation, asserted rather than asserted-in-prose.** The sum of the
  twelve monthly deductions equals the annual calculation to the rupiah, for
  every employee, including four mid-year joiners and one leaver whose true-up
  lands in August. It is checked against an *independent* annual recomputation,
  not against the engine's own self-report.
* **PTKP for all eight statuses**, TK/0 through K/3, driving both the TER
  category and the annual deduction. Change a status and watch the whole twelve
  month schedule move.
* **BPJS Kesehatan** — 1% employee, 4% employer, on a wage base capped at
  Rp 12.000.000 and floored at the minimum wage. **BPJS Ketenagakerjaan** — JHT
  (5,7%, no ceiling at all), JP (3%, on its own separate and lower ceiling),
  JKK by risk class and JKM, both employer-only. Employee and employer portions
  are kept in separate columns and totalled separately.
* **Lembur per Kepmenaker 102/2004**, computed from recorded occurrences: hourly
  rate = 1/173 of the monthly wage, 1,5× for the first hour of a working day and
  2× after it, and the other ladder entirely on a rest day or public holiday.
* **Absensi and cuti**: annual leave accrual, a balance that cannot go negative
  without a recorded override (checked on the *request* that breaches it, not on
  the person), and unpaid absence that reduces the *wage* proportionally by the
  real working days of that month.
* **First and last month prorated by real working days.** Somebody who joins on
  18 August is paid 10/21 of the month's wage and ten days of meal allowance, not
  a whole month — which would overstate their gross, their meal allowance and,
  because the TER band and the annual figure are read from that gross, their
  PPh 21 as well. The contractual monthly wage is deliberately *not* prorated:
  BPJS is reported on it, the overtime hour is 1/173 of it, and THR proration has
  its own rule in months of service.
* **THR per PP 36/2021**: one month's wage at twelve months' service, prorated
  below that, with service measured **to the Hari Raya**, not to the payment date —
  Pasal 5 ayat (4) makes the payment date a deadline, and measuring to it pays nil
  to somebody hired in the last week before the holiday who is entitled to 1/12.
* **Payslip** per employee per month, printable on A4 with all three columns
  intact, showing the tax working line by line.
* **Roles and locking**: HR admin owns master data, the payroll officer computes
  and reviews, the finance approver locks. A locked run is immutable — enforced
  against the record **in storage**, inside the same IndexedDB transaction as the
  write, so a second tab cannot overwrite a signed run with a stale draft.
  Corrections go through an adjustment run that carries **deltas** and runs the
  same `draft → ditinjau → terkunci` state machine, with its own row, its own
  buttons and its own signature: the register is one row per **document**, not per
  month, so the rows sum to the Setahun row and a month carrying more than one
  document gets an explicit *efektif* subtotal.
* **An audit trail that is read back, not just written.** Every privileged action —
  master-data edit, leave approval, run, review, lock, local-data wipe — is
  appended to an `audit` object store with the timestamp and the role that did it,
  and the Payroll Run tab renders it newest-first. *Who approved the November run*
  is the first question an auditor asks, and it is answerable from the screen.
* **953 assertions** in `tests.js`, run in the page and under node from the same
  file, plus nine live invariants recomputed from the raw payslip records on
  every state change.

### Simulated — fabricated, deliberately, and stated in the UI

Every person in this file is invented. The identifiers are built so that the
*shape* is right and the *content* is impossible:

| Field | How it is fabricated | Why it cannot be real |
| --- | --- | --- |
| Name | assembled syllable by syllable from invented phonotactic patterns | any resemblance is a 32-bit PRNG coincidence |
| NIK | 16 digits beginning `99` | Dukcapil province codes run 11–94; `99` has never been issued |
| NPWP | the 15-digit form with category prefix `99` | never issued by DJP |
| BPJS | 11 digits beginning `999` | outside the issued ranges |
| Bank account | 10 digits beginning `0000` | no Indonesian bank issues it |
| Salary, attendance, overtime, leave | invented, then rounded to plausible negotiated figures | — |

The **only** real numbers in the app are the statutory ones — rates, ceilings,
PTKP amounts, the minimum-wage reference — and every one of them is cited below.

The whole company is derived from **one seed integer** (`20250401`), so it is
rebuilt identically on every load, under node as well as in the browser. Three
different seeds are run through the full invariant suite in `tests.js`, so the
demo is not one lucky seed.

### Not built

Cut on purpose, so that the invariants could be proven rather than merely
claimed. Listed here rather than hidden:

* No e-Bupot / e-SPT file export, and no 1721-A1 PDF. The Laporan tab shows the
  1721-A1 *shape* and reconciles it, but does not emit a filing.
* No non-permanent employees (pegawai tidak tetap, tenaga ahli, dewan komisaris).
  Those use different TER tables (bulanan/harian) and a different gross basis.
  Only **pegawai tetap** is modelled.
* No employee without an NPWP — the pre-2024 20% surcharge is gone under the
  current rules, but the NIK-as-NPWP transition is not modelled either.
* No severance (pesangon), which is taxed under a separate final-rate schedule
  (PP 68/2009), and no bonus/komisi as a separate line — THR is the only
  irregular payment.
* One allowance type beyond the fixed allowance (tunjangan makan, attendance
  linked). No transport, housing, medical or family allowances.
* No public-holiday calendar. Working days are Monday–Friday; a public holiday
  falling on a weekday is not deducted from the divisor, and the rest-day
  overtime ladder is chosen by a flag on the occurrence, not by a calendar.
* One tax year (2025). No multi-year comparison, no carry-forward.
* No conflict *merge* across tabs. There **is** a storage-level write lock — every
  run write re-reads the stored record inside the same IndexedDB transaction and
  refuses to overwrite one that is locked or whose revision is ahead, and a
  `BroadcastChannel` tells the other tabs to re-read — but the loser of a race is
  told to look at the stored figures, not offered a three-way merge.

---

## How to run it locally

No build step. Any static file server works; `file://` will **not** work,
because the page sets a Content-Security-Policy in a `<meta>` tag and the
browser treats `file://` origins differently.

```sh
git clone https://github.com/biassp/biassp.github.io
cd biassp.github.io
python3 -m http.server 8970
# then open http://127.0.0.1:8970/labs/payroll/
```

The assertion suite also runs headless, from the same files the page loads:

```sh
cd labs/payroll
node -e '
["domain","pajak","payroll","seed","tests"].forEach(f=>require("./"+f+".js"));
var r = globalThis.PAYROLL_TESTS.run();
console.log(r.passed + "/" + r.total + " lulus, " + r.failed + " gagal");
r.results.filter(x=>!x.ok).forEach(x=>console.log("FAIL ["+x.group+"] "+x.name+" :: "+x.message));
process.exit(r.failed ? 1 : 0);'
```

---

## The five minutes that show whether it works

1. **Open the header.** Three badges: the assertion count, the live invariant
   count, and `panggilan jaringan: 0`. Open DevTools → Network. It stays empty.
2. **Payroll Run → Desember → Hitung ulang.** The December run is seeded as a
   draft. Running it prints how many payslips used the annual recomputation and
   how many produced a **negative** PPh 21. On the default seed: 61 payslips, 28
   refunds, and a company-wide December PPh 21 of −Rp 7.196.706.
3. **PPh 21 tab.** Pick anybody. Twelve rows, each showing **two** figures: what
   this page recomputes (*seharusnya*) and what the ledger actually withheld
   (*dipotong*). Eleven TER lookups with the band and the rate, then December with
   a yellow edge. Below them the annual calculation line by line, then *Σ PPh 21
   yang BENAR-BENAR dipotong, dari N dokumen slip di ledger* and *Selisih
   (invarian I3, harus nol)*. It reads `Rp0` — and it is read off the same records
   the invariant checker reads, so it is capable of not reading `Rp0`. The version
   before this one recomputed the tax from the stored gross and subtracted it from
   itself, which no amount of corrupting the ledger could make non-zero.
4. **Change the PTKP status** in the same tab (the simulation selector). The
   annual figure moves, the TER category may change, and the difference lands
   entirely in December — the reconciliation row still reads `Rp0`.
5. **BPJS tab.** Type 10.547.400, then 10.547.401. JP stops rising. Type
   12.000.000, then 12.000.001. Kesehatan stops rising. Type 50.000.000. JHT is
   still rising, because JHT has no ceiling at all.
6. **Slip Gaji → Cetak A4.** Only the payslip prints, and all three columns
   survive on the sheet.
7. **Roles.** As the payroll officer, the *Kunci* button is disabled. Switch to
   the finance approver and it works. Once locked, *Hitung ulang* is gone and
   only *Penyesuaian* remains.
8. **Uji tab.** 953 assertions, grouped, each one named in a sentence rather
   than a code identifier.

---

## The tax rules and rates encoded, and as at what date

**Encoded 8 September 2026, for tax year 2025.** All of it lives in `domain.js`
and `pajak.js` and is printed on the Beranda tab as well, so it can be checked
without reading the source.

### PPh 21 annual tariff — UU 7/2021 (HPP) Pasal 17 ayat (1) huruf a

Marginal brackets on PKP:

| PKP | Rate |
| --- | --- |
| up to Rp 60.000.000 | 5% |
| Rp 60.000.000 – Rp 250.000.000 | 15% |
| Rp 250.000.000 – Rp 500.000.000 | 25% |
| Rp 500.000.000 – Rp 5.000.000.000 | 30% |
| above Rp 5.000.000.000 | 35% |

### PTKP — PMK 101/PMK.010/2016

| Status | PTKP | TER category |
| --- | --- | --- |
| TK/0 | Rp 54.000.000 | A |
| TK/1 | Rp 58.500.000 | A |
| K/0 | Rp 58.500.000 | A |
| TK/2 | Rp 63.000.000 | B |
| K/1 | Rp 63.000.000 | B |
| TK/3 | Rp 67.500.000 | B |
| K/2 | Rp 67.500.000 | B |
| K/3 | Rp 72.000.000 | C |

Base Rp 54.000.000, plus Rp 4.500.000 for a married taxpayer, plus Rp 4.500.000
per dependant to a maximum of three. PP 58/2023 groups the eight statuses into
three TER categories **by PTKP amount, not by family shape** — which is why K/0
and TK/1 share a category, and TK/3 shares one with K/2.

### TER monthly rates — PP 58/2023 Lampiran; mechanics PMK 168/2023

Transcribed in full: **TER A 44 bands, TER B 40, TER C 41**, running 0% to 34%
in steps of 0,25%. Tax-free thresholds: A up to Rp 5.400.000, B up to
Rp 6.200.000, C up to Rp 6.600.000. Bands are stated in the regulation as *"di
atas X sampai dengan Y"*, so a gross **exactly** on a boundary belongs to the
**lower** band. Every boundary of all three tables is asserted on both sides in
`tests.js`, because an off-by-one there is invisible in aggregate and wrong for
precisely the employees whose salary is a round number.

Rates are stored as integer basis points (10000 bp = 100%). Every rate in every
table is an exact multiple of 25 bp, so the arithmetic is exact.

### Biaya jabatan — PMK 250/PMK.03/2008

5% of gross employment income, capped at **Rp 500.000 per month** and
Rp 6.000.000 per year. The monthly form of the cap is what matters for a
mid-year joiner: seven months of work gets a Rp 3.500.000 cap, not
Rp 6.000.000.

### BPJS Kesehatan — Perpres 82/2018 s.d.t.d Perpres 64/2020

5% of monthly wage: **1% employee, 4% employer**. Wage base **capped at
Rp 12.000.000** and **floored at the applicable minimum wage** (the app's
default reference is the published 2025 DKI Jakarta figure, Rp 5.396.761; it is
a setting, changeable on the BPJS tab). Above the ceiling the contribution is
flat at Rp 120.000 / Rp 480.000, so a director on fifty million pays exactly
what a supervisor on twelve million pays.

### BPJS Ketenagakerjaan

| Programme | Employee | Employer | Ceiling | Basis |
| --- | --- | --- | --- | --- |
| JHT | 2% | 3,7% | **none** | PP 46/2015 |
| JP | 1% | 2% | **Rp 10.547.400** (2025 adjustment) | PP 45/2015 |
| JKK | — | 0,24% / 0,54% / 0,89% / 1,27% / 1,74% by risk class I–V | none | PP 44/2015 |
| JKM | — | 0,30% | none | PP 44/2015 |

The JP ceiling is re-announced by BPJS every year and is **lower** than the
Kesehatan ceiling, so there is a wage band in which JP has already capped while
Kesehatan has not — and JHT never caps at all. A ceiling accidentally copied
onto JHT is the mirror-image bug, and it would sail past a "the cap is applied"
test; `tests.js` sweeps JHT from five million to sixty million and asserts it
keeps rising.

### What is taxable, and what is deductible

Not a modelling choice — a rule, and one that is easy to get backwards:

* **Added** to the employee's taxable gross, because the employer pays them as a
  benefit in the employee's name: BPJS Kesehatan employer 4%, JKK, JKM.
* **Not** added: employer JHT 3,7% and JP 2%, which are deferred savings and are
  taxed on withdrawal instead.
* **Deducted** from annual gross alongside biaya jabatan: the **employee's own**
  JHT 2% and JP 1%. The employee's Kesehatan 1% is **not** deductible.

So the taxable gross printed on the payslip is *larger* than the gross the
employee is paid, and none of it changes net pay. Both facts are on the payslip.

### Lembur — Kepmenaker 102/MEN/VI/2004

* Pasal 8: hourly overtime rate = **1/173** of the monthly wage. 173 is a
  statutory divisor, not a count of hours; using 160 or 174 instead is the single
  most common overtime error in Indonesian payroll software.
* Pasal 11(a), working day: first hour **1,5×**, every hour after **2×**.
* Pasal 11(b), rest day or public holiday, five-day week: hours 1–8 at **2×**,
  hour 9 at **3×**, hours 10–11 at **4×**.
* The base is upah pokok **plus tunjangan tetap** only — Pasal 8 ayat (2)
  excludes variable allowances, so the attendance-linked meal allowance must not
  inflate it.

Because the ladder restarts each day, two three-hour days are **not** the same
as one six-hour day. The engine works from recorded occurrences, and `tests.js`
asserts the two differ (Rp 220.000 versus Rp 230.000 on a Rp 20.000 hourly rate).

### Cuti tahunan — UU 13/2003 Pasal 79, as amended by UU 6/2023

At least twelve working days of paid annual leave after twelve months of
continuous service. The app accrues one day per completed month once eligible,
capped at 12 + 6 days of carry-over. Balance = accrued − taken, and it may not
go negative without an override recorded on the request.

### THR — PP 36/2021 Pasal 9; Permenaker 6/2016

Twelve months' service or more: one month's wage. One month up to under twelve:
`(months of service ÷ 12) × one month's wage`. Under one month: no entitlement.
Paid at the latest seven days before the religious holiday — Idul Fitri 1446 H
fell on 31 March 2025, so the demo pays it in the March run, dated 24 March.
Service is measured **to the Hari Raya (31 March)**, not to the payment date and
not to the year end: Pasal 2 and Pasal 3 fix the entitlement on one month's
continuous service *as at* the Hari Raya Keagamaan, while Pasal 5 ayat (4)
separately makes 24 March a payment deadline. Both dates are configured
(`thrTanggal`, `hariRayaTanggal`) and both are printed on the payslip. Measuring
to the payment date pays nil to a 28 February hire who is owed one twelfth;
`tests.js` asserts exactly that case.

---

## How the December true-up is computed

This is the part a reviewer should check with a calculator.

For each employee, let the months on the payroll in the tax year be
`m₁ … mₙ`, and let the **correction month** `c` be December — or, for a leaver,
their final month, because a December reconciliation for somebody who left in
August never happens and their withholding would stay at the TER approximation
for ever.

**Step 1 — the TER months.** For every month `m ≠ c`:

```
bruto pajak(m) = bruto dibayar(m) + Kesehatan pemberi(m) + JKK(m) + JKM(m)
kategori       = TER category of the employee's PTKP status
tarif          = the band of `kategori` containing bruto pajak(m)
PPh 21(m)      = floor(bruto pajak(m) × tarif)          -- floored to whole rupiah
```

**Step 2 — the annual calculation, in the correction month.**

```
bruto setahun   = Σ bruto pajak(mᵢ)                     -- over all months on payroll
biaya jabatan   = min(5% × bruto setahun, 500.000 × n)  -- n = months on payroll
pengurang       = biaya jabatan + Σ JHT pekerja + Σ JP pekerja
neto setahun    = bruto setahun − pengurang
PKP             = floor_to_1000(neto setahun − PTKP)    -- UU PPh Pasal 17 ayat 4
                  (and 0 if that is negative)
PPh 21 setahun  = Pasal 17 marginal brackets applied to PKP
```

PTKP is **not** prorated. For a pegawai tetap it is an annual allowance attached
to the person, not to the months worked. Proration is the classic error here and
it over-taxes the joiner; giving a joiner the full Rp 6.000.000 biaya jabatan cap
is the other classic error and it under-taxes them. Both are asserted.

**Step 3 — the correction.**

```
PPh 21(c) = PPh 21 setahun − Σ PPh 21(m) already withheld, for m < c
```

and therefore, by construction,

```
Σ PPh 21(mᵢ) = PPh 21 setahun        -- invariant I3, to the rupiah
```

`PPh 21(c)` **may be negative**, in which case the employee is refunded through
payroll. That is not a bug and it is not rare: on the default seed, 28 of 61
December payslips are refunds. The usual cause is THR. One extra month's wage in
March pushes that month's gross into a far higher TER band — 21% where the
year's effective rate is 14,6% — and the over-withholding accumulates all year
until December gives it back.

**The already-withheld figure is read from the posted runs, never recomputed.**
That matters: if HR changes somebody's PTKP status in November, the locked
January payslip does not retroactively change, and the entire difference lands
in December. Recomputing the earlier months instead would produce a December
figure that reconciles against a history that was never withheld.

---

## Money is an integer number of rupiah

Never a float, not once, not in an intermediate. In a payroll engine this is not
a rounding nicety: the sum of twelve monthly deductions has to equal one annual
figure **to the rupiah**, and `0.1 + 0.2` makes that impossible to prove.

Every division goes through `divRound` (half away from zero) or `divFloor`
(toward negative infinity), both of which take integers and return integers, so
every rounding decision in the codebase is one somebody wrote down:

* **`divRound`** — half **away from zero**, not banker's rounding, because that
  is what DJP and BPJS worked examples do and what a reviewer with a calculator
  will do. Used for contributions, overtime and THR.
* **`divFloor`** — used where the rule itself says *dibulatkan ke bawah*: PPh 21
  amounts to the whole rupiah, and PKP to the whole thousand. Also used for the
  December correction, because truncating a *refund* toward zero would quietly
  keep a rupiah of the employee's money.
* **Rates are integer basis points.** 5,7% is `570`. 0,24% is `24`. Every rate in
  every table encoded here is an exact multiple of 25 bp, so no rate needs a
  fraction of a basis point to express and the arithmetic is exact.
* `mul()` refuses any product that would leave the safe-integer range, and the
  suite asserts the high-water mark stayed inside 2⁵³.

Invariant I7 walks every money field of every payslip and every run total in the
seeded company — about 17.000 fields — and asserts each one is an integer. It is
also fed a deliberately inserted float to prove the walk is walking.

---

## The nine live invariants

Recomputed from the **raw payslip records** on every state change — never from a
cached total — so the check is capable of catching the app disagreeing with
itself. The count is in the header; the detail is on the Uji tab and the Beranda.

| | Invariant |
| --- | --- |
| I1 | `neto = bruto − potongan pekerja`, per payslip, per month, to the rupiah |
| I1b | `bruto` = the sum of its own earning lines, unpaid-absence reduction included |
| I2 | run total = the sum of its payslips, for **every** one of 23 columns |
| I3 | Σ monthly PPh 21 = the annual PPh 21 calculation, per employee |
| I4 | every BPJS ceiling applied at the correct level, flat above it, JHT uncapped |
| I5 | employer contributions never appear as employee deductions and never move net pay |
| I6 | leave balance = accrued − taken, never negative without a recorded override |
| I7 | no money value anywhere is a non-integer |
| — | a locked run has a signatory and its total still matches its payslips |

`tests.js` feeds this checker **nine deliberately corrupted books**, each broken
in one specific way, and asserts that each one turns the corresponding line — and
only that line — red. A check that cannot fail is decoration. The I3 corruption
is the sharp one: five thousand rupiah is moved on the December true-up *and*
the payslip's net and the run total are tidied up so that I1 and I2 still pass.
Only I3 catches it.

### What is deliberately *not* an invariant

Changing an employee's PTKP status after their reconciliation month has been
posted does **not** turn the badge red. The twelve deductions still add up to the
liability computed from the facts on record; the ledger is not broken, there is a
**correction outstanding**. Folding that into the invariant count would turn an
ordinary HR edit into a red badge, and a badge that goes red during normal use
teaches the reader that the badge means nothing. So I3 reconciles against the
PTKP status **as withheld** (read from the correction-month payslip), and the
drift is reported separately as a to-do with the adjustment run one click away.

---

## Domain decisions

**Adjustment runs carry deltas, not replacements.** The naive version recomputes
the month and posts the full figures a second time. That leaves two records for
one month: the year double-counts it, the December true-up reconciles against a
history that never happened, and I3 breaks. What a correction payroll actually
pays is the **difference**, so every column of an adjustment payslip is
`(recomputed month − what has already been posted for that month)`. Summing every
run of the year then gives the true annual figures and I3 closes by
construction. The full recomputed figures are kept on the payslip as `penuh`, so
the ceiling checks — a delta of a capped contribution is not itself a capped
contribution — still have the right number to look at. This was written the wrong
way first, and the suite caught it.

**A mid-year adjustment invalidates the correction month, and the follow-on run
carries tax and nothing else.** Adjusting March changes the year's accumulated
withholding, so December stops reconciling. The follow-on runs are created in the
same action and named in the confirmation — but in **tax-only mode**: every column
except PPh 21, the deduction total and net is forced to the figure already posted,
delta exactly zero. Left in ordinary delta mode the follow-on re-priced those
months' *earnings* too, so a raise the officer applied to March was paid again in
December — a month nobody named — while April to November went unpaid, and the
invariant badge certified the result because it *was* internally consistent. Money
nobody authorised, moved silently, under a green tick. Invariant I4 now asserts
that definition on every tax-only payslip, and `tests.js` corrupts one by a single
rupiah of gaji pokok and asserts I4 goes red. Where a month's earnings really have
moved, that is reported by name as outstanding work (`selisihUpahTertinggal`) for
the officer to decide on month by month, never posted for them. Correction months
are per employee, so there can be more than one (December for most people, the
final month for a leaver). Where the target month's regular run is still an
unsigned **draft**, the drift is absorbed by recomputing that run instead — posting
a delta against a draft would strand it, since the regular run could then never be
recomputed again.

**Unpaid absence is a negative earning, not a deduction.** "No work, no pay"
reduces the wage itself. Modelling it as a deduction would keep the taxable gross
at the full figure and over-tax the employee. The divisor is the **real** working
days of that month — 2025 has 261 working Mondays-to-Fridays, ranging from 20 in
February to 23 in January — not the flat 21 or 22 a spreadsheet assumes.

**BPJS is computed on the contractual wage, not the gross paid.** Premiums must
not move because somebody worked a Saturday, so the base is upah pokok plus
tunjangan tetap. The same figure is the overtime base and the THR base, and the
payslip says so.

**Ceilings are applied to the base, then the rate to the capped base.** Applying
the rate first and capping the premium afterwards gives the same answer for these
particular numbers but is the wrong shape: it hides *which* ceiling bit, and the
ceiling is the thing a high earner asks about.

**The demo company is derived, the user's changes are stored.** Sixty-two
employees, a year of attendance, overtime and leave, and twelve payroll runs are
a function of one seed integer, so storing them would be storing a function of a
number. What goes into IndexedDB is the delta: master-data edits, runs the user
posted or locked, leave decisions, config, and an append-only audit trail. The
first time master data is touched the existing run history is frozen to storage,
because otherwise a reload would rebuild eleven signed payslips from the new
salary — which is exactly what a locked run must never do.

**Every storage access is wrapped.** `localStorage` and `indexedDB` both *throw*
where a browser is set to block site data, and one unguarded access blanks the
page. When the database is unavailable the app runs against an in-memory map and
says `memori saja` in the header instead of dying. This is verified by driving
the page with both APIs made to throw.

---

## Accessibility and layout, measured rather than assumed

* **Contrast.** Every text element on all eleven tabs was measured in both
  themes — every text element on all eleven tabs, composited against its real
  resolved background, including the `color-mix` washes — and every one clears
  WCAG AA. Five genuine failures were found and fixed that way. Three came out of
  the last measured pass: the context bar's year chip was being painted by
  `.field > span`, a label rule that out-specified `.perchip`'s own colour, so it
  read `--faint` on its own indigo wash at 4,19:1 light / 4,06:1 dark (the rule is
  now pinned to `:first-child`, the label, and the chip measures 12,80 / 11,99:1);
  the light theme's `--warn` `#a16207` cleared AA on white at 4,92:1 but only
  4,32:1 on its **own** 10% wash, which is exactly where the `setahun` pill sits
  on the correction row of the tax ladder (now `#854d0e`, 5,49:1 there and 6,85:1
  on white); and the ladder's month label was `--faint` on that same wash at
  3,85:1 in the dark theme (now `--muted`, 5,41:1). The other two came out of the
  pass before it: `#f43f5e` measured 4,28:1 on a hovered table row in the dark
  theme (now `#fb7185`, 5,84:1), and the site's display gradient put white
  lettering on a cyan end at 1,81:1 (the brand mark now uses the same three hues
  one step darker, 7,90 / 7,10 / 7,27:1). **Every accent token the light theme
  uses is redefined in the light block** — `--accent`, `--accent-2`, `--accent-3`
  and all five money-class colours included. Three sibling labs on this site
  shipped a dark-surface cyan left on a white card at 1,6–1,8:1; that is the bug
  this file exists to not repeat, and the ratio each colour was chosen for is
  written next to it in `app.css`.
* **No horizontal overflow at 390px, on every tab, with data present.** Verified
  at 390 × 844 with rows in the tables, a payslip open, an adjustment run posted,
  a negative leave balance recorded and a salary edited: `scrollWidth` stays 390
  on every tab. One real overflow was found this way — the twelve-row tax ladder
  has a cell carrying a whole sentence of arithmetic in a nowrap monospace, and
  an `auto` grid track cannot shrink below it, which pushed the document to
  468px. Every grid track in the file now carries `min-width: 0`, and that row
  stacks below 560px.
* **Focus survives every re-render.** Each state change tears the panel down and
  rebuilds it, which throws focus to `<body>`. The focused control's stable key
  and caret position are captured before and restored after. Numeric fields
  commit on `input`, never on `change` — `change` fires while the browser is
  moving focus away, the handler re-renders, and the button being clicked is
  destroyed between mousedown and mouseup. They are `type="text"` with
  `inputmode="numeric"`, because Chromium refuses `setSelectionRange` on a number
  input and the caret could not be restored. Verified: typing into a salary cell
  keeps focus in that cell.
* **Keyboard.** Skip link, ARIA tablist with arrow-key navigation, a visible
  2px focus ring on every interactive element (verified on the first ten tab
  stops), and one polite live region that announces the run that was posted, the
  action that was refused and why, and the recomputed tax figure.
* **`prefers-reduced-motion: reduce`** removes every transition and animation.
  Verified in a reduced-motion browser context.
* **Print.** At A4 width the payslip is the only thing on the sheet, all three
  columns intact, `scrollWidth` 794. The print block redefines the whole palette
  — not just `body` — for **both** themes, so printing from the dark theme does
  not put `#34d399` on white paper at 1,9:1. The hidden-block rule is an
  allow-list, not a deny-list, because the deny-list version in a sibling lab
  missed the fabrication banner and the message box and burned most of a sheet
  before the document began. The allow-list also passes the Laporan tab's
  1721-A1 recap — the one other artefact a payroll officer actually prints — and
  printing from any other tab, or from the Slip Gaji tab for a month that
  employee has no payslip in, emits a print-only line saying which tab to print
  from instead of a blank sheet. Measured: 251–256 characters of explanation
  instead of 42.

---

## Privacy

A payroll file is the most sensitive table any company has: everybody's salary,
their PTKP status, their NPWP, their bank account. "Trust me, it stays local" is
not a claim anybody should accept without a number they can check.

* The page sets `connect-src 'none'` in its own
  `<meta http-equiv="Content-Security-Policy">`, so the browser refuses every
  outbound connection this document's JavaScript could ask for.
* `guard.js` additionally wraps `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource` and `sendBeacon` and counts attempts. The header shows the count.
  Open DevTools → Network; it stays empty. (The CSP is real, incidentally: an
  attempt to inject an inline script into the page during testing was refused by
  it.)
* No web fonts. A font request would be network egress.
* Everything you change is stored in IndexedDB, in your browser, and *hapus data
  lokal* in the context bar genuinely returns the page to first-paint state
  because the demo company is derived from a seed rather than stored.
* Scope note, stated plainly: this is a claim about **this page**. The CV homepage
  at biassp.github.io does call `api.github.com` for its repository feed. This lab
  calls nothing, ever.

---

## Files

| File | What is in it |
| --- | --- |
| `index.html` | shell, CSP, eleven tab panels, the live region |
| `guard.js` | theme before first paint, egress counter — loaded first |
| `domain.js` | integer primitives, formatting, seeded PRNG, calendar, and every statutory table |
| `pajak.js` | the three TER tables, the Pasal 17 brackets, the annual recomputation, the year plan |
| `payroll.js` | payslip and run engine, BPJS, overtime, leave, roles, locking, the invariant checker |
| `seed.js` | the fabricated company, from one seed integer |
| `store.js` | IndexedDB, every access wrapped, with an in-memory fallback |
| `tests.js` | 953 assertions, same file in the page and under node |
| `app.js` | the UI: eleven panels, focus discipline, role gating |
| `app.css` | design tokens, both themes with measured contrast, print rules |

No framework, no bundler, no dependency, no build step.

---

Copyright © 2026 Bias Satrio Putra. All rights reserved. Not open source;
readable for evaluation only. See [/LICENSE](../../LICENSE).
