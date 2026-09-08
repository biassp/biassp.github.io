<!--
  Gudang — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only. See /LICENSE.
  https://biassp.github.io/
-->

# Gudang — sistem informasi persediaan, gudang dan kasir

**Live:** https://biassp.github.io/labs/gudang/

An inventory, warehouse and point-of-sale system for an Indonesian retail /
distribution business. No framework, no bundler, no dependencies, no build
step, no network. Nine files, all vanilla.

The point of this lab is not that it has a product table with an Add button.
The point is inventory accounting: **the stock ledger is the only truth, cost
is computed in real FIFO layers and in weighted average side by side, and
inserting a backdated purchase recomputes every COGS figure after it and shows
you exactly which documents moved.**

---

## What is real, and what is simulated

### Real — this is genuine, working machinery

| | |
|---|---|
| **The ledger** | Append-only movement journal. There is no `stok` field anywhere in the codebase. Every balance, per SKU, per warehouse, as of any date, is a fold over the journal. Entries are immutable; corrections are new entries. |
| **FIFO costing** | Real cost layers keyed by `(tanggal, nomor urut)` of the receipt that created them. Issues consume oldest-first and split a layer when partial. Layers are removed at zero, never go negative, never get consumed out of order — checked *inside* the consumption loop by independently re-deriving the minimum key. |
| **Weighted average** | Recomputed on every receipt. Carried as integer total value per (SKU, warehouse); the displayed unit cost is `divRound(nilai, qty)`. |
| **Backdated recomputation** | Costing state is snapshotted at every period boundary. A backdated document restarts the fold from the newest snapshot before its period, reuses every document result computed before that, and diffs the two runs document by document. The suite asserts the incremental result is identical to a full replay. |
| **Value conservation** | `saldo awal + pembelian + retur jual + penyesuaian masuk + transfer masuk − retur beli − HPP − penyesuaian keluar − transfer keluar = persediaan akhir`, to the rupiah, under both methods, before and after a backdated insert. |
| **Unit ladders** | Dus → pak → pcs (and karton/renteng/zak/lusin) with integer factors. All arithmetic in base units; conversions round-trip exactly. |
| **Stock opname** | Sheet frozen by ledger sequence. Variance against the frozen book. Movements posted during the count are shown separately and are **not** variance. Posting appends a `penyesuaian` entry; it never writes a balance. |
| **Multi-warehouse transfers** | In-transit stock lives in a first-class ledger location called `TRANSIT`. Send writes two entries, arrival writes two more. Cost is carried, not re-priced. |
| **Three-way match** | PO → penerimaan (partial allowed) → faktur. Quantity and price discrepancies are flagged with their rupiah impact, never absorbed. |
| **POS** | Barcode/SKU/name lookup, quantity in any unit, split payment (tunai / transfer / QRIS) with change from the cash leg only, PPN 11% with an explicit inclusive/exclusive setting, printable struk, retur that restores stock at its original cost layer. |
| **Roles** | kasir, staf gudang, pembelian, supervisor. Denied actions explain themselves. Only a supervisor may post an opname adjustment or reopen a closed period. |
| **Storage** | IndexedDB, in your browser, for the things you posted. Every storage call is wrapped in try/catch; when the database is unavailable the app runs in memory and says so. |
| **The tests** | 498 assertions, run in the page on load and under node from the same file. |

### Simulated — fabricated, deliberately, and stated in the UI

* **Every product, brand, supplier, price, quantity and document.** Product and
  supplier names are assembled syllable by syllable from an invented
  phonotactic pattern. There is no scraped catalogue and no anonymised export
  from a real business behind this.
* **Barcodes** are genuine EAN-13 with a correct check digit — a scanner will
  read them — but every one sits on GS1 prefix `299`. The `2xx` range is
  *restricted circulation*: numbers a shop assigns to itself. By construction
  none of them can identify a real manufacturer's article.
* **NPWP** numbers use category prefix `99`, which the DJP has never issued.
  Structurally well-formed, cannot be a real taxpayer.
* **The whole book is rebuilt from one seed integer** (`20260908`) on every page
  load: 120 SKU, 3 warehouses plus TRANSIT, 15 suppliers, ~4,000 ledger entries
  covering 1 March – 6 September 2026, with the report date pinned at
  2026-09-08 so the figures on screen do not change tomorrow.
* **Stock minimums, demand weights and lead times** are generated, not derived
  from any demand analysis.

### Not built

* No supplier payment / ageing ledger, no general ledger journal export, no
  serial-number or batch/expiry tracking, no landed-cost allocation
  (freight/import duty spread over a receipt), no multi-currency. The costing
  engine would support batch tracking and landed cost without redesign; they
  are scope, not obstacles.
* Costing is per **(SKU, warehouse)**, not per SKU globally. See
  *Domain decisions* below.

---

## How to run it locally

It is static. Any HTTP server works — but it must be **HTTP, not `file://`**,
because the page ships a `<meta http-equiv="Content-Security-Policy">` with
`default-src 'none'` and a `file://` origin cannot satisfy `script-src 'self'`.

```sh
git clone https://github.com/biassp/biassp.github.io.git
cd biassp.github.io
python3 -m http.server 8970
# then open http://127.0.0.1:8970/labs/gudang/
```

Run the assertion suite under node, from the same source the page uses:

```sh
node -e "
  global.self = global;
  ['domain','ledger','proses','seed','tests'].forEach(f =>
    require('./labs/gudang/' + f + '.js'));
  const r = global.GUDANG_TESTS.run();
  console.log(r.passed + '/' + r.total + ' lulus, ' + r.failed + ' gagal');
  r.results.filter(x => !x.ok).forEach(x =>
    console.log('FAIL [' + x.group + '] ' + x.name + ' :: ' + x.message));
  process.exit(r.failed ? 1 : 0);
"
```

Nothing to install. There is no `package.json` for this lab, no transpiler and
no CDN — a `<script src>` to a CDN would be network egress, and this page has
none.

---

## The five minutes that show whether it works

1. **Beranda** — read the reconciliation. Every rupiah that entered inventory
   is either COGS or still on a shelf. The bottom line says `Rp0`.
2. **Kartu Stok** — pick any SKU. Every row carries its own opening balance,
   movement and closing balance, so `awal + masuk − keluar = akhir` is legible
   on screen rather than merely asserted. The FIFO layer stack underneath shows
   which lot the next issue will eat.
3. **HPP & Metode** — switch between FIFO and rata-rata. COGS and closing
   inventory both move; their sum does not.
4. **Tanggal Mundur** — the flagship. Simulate a purchase dated 10 June. You
   get: how many documents changed, that **zero** documents before the
   insertion point changed, before/after for each one, and the conservation
   identity still closing at `Rp0`. Try a date in March: refused, because March
   is closed. Try posting as Kasir: refused, with the reason.
5. **Opname** — sheet OP-00004 is open and counted. Sell something from Gudang
   Toko in the Kasir tab first, then come back: that sale appears in *gerak
   pasca-hitung*, the variance is still measured against the frozen book, and
   the predicted balance is `fisik + pasca-hitung`. Post it as Supervisor
   (Staf Gudang is refused, and told why) and check the resulting ledger
   entries — an adjustment entry per line, never an overwritten balance.
6. **Kasir** — sell, then retur. The retur restores value at the cost of the
   layers the sale actually consumed. Then go back to Tanggal Mundur and post a
   backdated purchase for that SKU: the retur's value changes too, because it
   references a document, not a frozen number.

---

## Money and quantity are integers

Rupiah is stored as whole rupiah. Quantity is stored in the product's smallest
base unit. Neither is ever a float.

A float in an inventory system is a slow leak: `0.1 + 0.2` surfaces three
months later as a stock card that will not reconcile, and nobody can say which
document is wrong. Every division goes through one function:

```js
divRound(a, b)   // two integers in, one integer out, half away from zero
                 //  1500/1000 -> 2    2500/1000 -> 3    -1500/1000 -> -2
```

Half away from zero, not banker's rounding, because that is what Indonesian
commercial practice and the DJP worked examples do, and because a reviewer
hand-checking a faktur with a calculator rounds that way.

The suite walks the entire seeded dataset and every costing result looking for
a non-integer in any field carrying money or quantity — over 20,000 fields —
and the ledger refuses a fractional quantity or price at the door.

---

## Why the average method carries value, not a unit cost

The textbook formula is honoured:

```
hpp_baru = (qty_lama × hpp_lama + qty_masuk × harga_masuk) / (qty_lama + qty_masuk)
```

and `L.rataTextbook()` implements it literally so a test can hand-check the
engine against it rather than against a restatement of the engine.

But the engine *stores the numerator*. It carries `{qty, nilai}` per (SKU,
warehouse) and takes an issue as `divRound(nilai × qty_keluar, qty)`. The
reason is arithmetic, not taste: if you carry a rounded per-unit cost and
multiply it out on every issue, the rounding residue escapes, and total
purchases stop equalling COGS plus closing inventory by a few rupiah per issue,
forever. Carrying the value keeps the residue inside the remaining inventory
value — where it belongs — and when the last unit leaves, `qty_keluar == qty`
and the formula returns `nilai` exactly, so quantity and value hit zero
together with no orphan rupiah stranded in an empty bin.

The suite checks it both ways: the textbook formula on hand-computed examples,
the engine against those examples, and the invariant that the displayed unit
cost times the quantity never differs from the carried value by more than half
a rupiah per unit.

---

## Why there is no LIFO

PSAK 14 (following IAS 2) recognises FIFO and weighted average only. Pasal 10
ayat (6) UU PPh names those two methods for inventory valuation. Offering a
LIFO toggle in an Indonesian system is not a feature, it is a liability. The
app says so on screen, and asking the costing engine for any method other than
`fifo` or `rata` throws rather than silently falling through to the average
branch.

---

## Domain decisions

* **Cost is per (SKU, warehouse), not per SKU globally.** A carton bought
  cheaply in Semarang and shipped to Kudus keeps its cost on arrival, and a
  warehouse's closing value is independently checkable. The alternative — one
  global average — makes a per-warehouse valuation report meaningless.
* **A transfer is two shipments.** Goods that have left A and not arrived at B
  are in a warehouse called `TRANSIT`. In-transit stock is therefore visible,
  counted exactly once, and carries its cost across untouched.
* **Ordering is `(tanggal, nomor urut)`.** A backdated document lands on its own
  date but after everything already posted on that date, like a paper book.
  Because `seq` never changes, insertion splices — it never reorders existing
  entries — which is what makes incremental recomputation provable.
* **Opname freezes on ledger sequence, not on date.** A purchase backdated into
  the count window *after* the sheet was opened is still a post-count event for
  the person holding the clipboard.
* **An opname surplus is valued at current carrying cost** (falling back to last
  known purchase price, then the product master). It neither creates profit nor
  destroys it, and it is where PSAK 14's lower-of-cost rule points.
* **A retur penjualan references the sale document, not a frozen cost.** Under
  FIFO it re-creates the exact layers the sale consumed, each with its original
  key, so a restored lot re-enters the queue *where it was*. A consequence:
  a later backdated purchase that changes the sale's cost changes the retur's
  cost with it, which is correct and is asserted.
* **PPN is rounded once per document, not per line.** Per-line rounding is legal
  but produces a faktur whose total does not match the sum of its own rows.
* **Change comes out of the cash leg only.** A QRIS or transfer leg is
  authorised for an exact figure; handing back cash against an overpaid card is
  a till shortage waiting to happen, so the app refuses it.
* **A retur pembelian is costed by the active method**, not against the specific
  receipt being returned. Documented as a simplification; the layer machinery
  would support the specific-receipt case.

---

## Privacy

Everything is in this tab. The page sets `connect-src 'none'` in its own
`<meta http-equiv="Content-Security-Policy">`, so the browser refuses any
outbound connection this document's JavaScript asks for. `guard.js` additionally
wraps `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` and
counts every attempt, so the header shows a number you can check against your own
DevTools Network tab. It stays at zero.

Scope note, stated plainly: this is a claim about **this page**. The CV homepage
at biassp.github.io does call `api.github.com` for its repository feed. This lab
calls nothing, ever.

What is stored: the theme (localStorage), and the documents you posted, the
opname sheets you filled in and your method/role/PPN choices (IndexedDB). All of
it in your browser, none of it transmitted. "Hapus data lokal" on Beranda wipes
it and rebuilds the demo from the seed.

---

## Files

| File | Lines | What it is |
|---|---|---|
| `domain.js` | ~420 | Integer arithmetic and the rounding policy, seeded PRNG, unit ladders, dates, PPN, roles and denial messages, EAN-13, constants. |
| `ledger.js` | ~840 | The stock ledger, the FIFO and average costing engines, period snapshots, incremental recomputation, the conservation identity, the stock card, posting validation. |
| `proses.js` | ~380 | Business processes: three-way match, transfers with an in-transit leg, opname freeze/variance/posting, cashier totals and split payment, retur. |
| `seed.js` | ~700 | The fabricated dataset and six months of movement, from one seed integer. |
| `store.js` | ~170 | IndexedDB with a guarded in-memory fallback. |
| `tests.js` | ~1420 | 498 assertions in 17 groups. |
| `app.js` | ~2260 | The UI. Renders rules; never re-implements one. |
| `app.css` | ~1080 | Tokens shared with the CV and the sibling labs. Dark default, full light override, print rules for the struk. |
| `guard.js` | ~100 | Pre-paint theme and the egress counter. |

Sibling labs: [`/labs/rekam/`](../rekam/) (rekam medis klinik),
[`/labs/siakad/`](../siakad/) (sistem informasi akademik),
[`/labs/harvest/`](../harvest/), [`/labs/saku/`](../saku/).

---

Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
Not open source. Readable for evaluation only. See [/LICENSE](../../LICENSE).
