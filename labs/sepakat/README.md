<!--
  Sepakat — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only — copying, modification,
  re-branding or redistribution is not permitted. See /LICENSE.
  https://biassp.github.io/
-->

# Sepakat

**Four phones, one job board, no server in the middle.**

Live: <https://biassp.github.io/labs/sepakat/>

Four technicians share a field-service job board. Every phone holds the whole
board and edits it offline; when two of them have signal they gossip directly.
Nothing is in charge. Three merge strategies run against the *same* user actions,
the same latencies, the same duplicate deliveries and the same partition, and the
page shows what each one leaves on the board.

The point is the gap between two things that get treated as one:

> **Converging** and **being right** are different properties.
> The strategy that loses data here is not the one that looks broken.

---

## The three strategies

| | What it sends | Converges? | Keeps what people meant? |
|---|---|---|---|
| `naive` | The operation, applied on arrival | **No** | Sometimes |
| `lww` | State, higher wall-clock stamp wins | **Yes** | **No** |
| `crdt` | State, joined — OR-Set, PN-Counter, HLC register | **Yes** | **Yes**, for what a lattice can express |

`naive` is not a strawman. It is what sync looks like when it is written in an
afternoon, and every line of it is reasonable. It fails on the two things a real
network does constantly: a message delivered twice happens twice, and two
messages arriving in a different order at different phones leave those phones
permanently different, with nothing left in flight to fix it.

`lww` is the interesting one. It genuinely converges — a last-writer-wins
register is a real CRDT, and duplicates and reordering are both harmless to it.
What it cannot do is represent two writes. A concurrent edit is resolved by
discarding one, silently, and which one survives is decided by whose phone clock
was fast. `+3` and `+2` over a `5` becomes an `8` or a `7`. Never a `10`.

---

## What is actually built

```
guard.js     theme before first paint, egress counter
core.js      seeded PRNG, canonical serialiser, vector clocks, hybrid logical clock
crdt.js      LWW register, G/PN-Counter, OR-Set, RGA — plus 2P-Set and a naive set as foils
text.js      textarea → sequence edits (prefix/suffix diff), for the Text merge tab
engines.js   the three board engines behind one interface
net.js       the deterministic network simulator and the five set-piece scenarios
tests.js     169 properties / 2,507 executions
app.js       the only file that touches the DOM
```

No framework, no bundler, no dependency, no build step. Roughly 3,000 lines.

### The types

* **OR-Set** for what exists. An add mints a unique tag; a remove buries exactly
  the tags the removing replica could see. A concurrent add carries a tag the
  remover never observed, so it survives *on purpose* rather than by accident.
* **PN-Counter** for the numbers. Two grow-only maps, one per direction, merged
  by max — so nothing is ever overwritten and a duplicated message is free.
* **LWW register with an HLC stamp** for single-value fields. Still lossy under
  concurrency, but the winner is chosen by causality rather than by clock skew.
* **RGA** for text, on its own tab. Characters are nodes in a causal tree, so the
  order is a property of the node set rather than of arrival order, and merge is
  a union.

### Two foils, kept deliberately

* **2P-Set** — a real, published CRDT whose laws all hold, and which still cannot
  ever re-add a removed element. Its limitation is the whole reason OR-Set tags
  exist.
* **naive set** — a plain member list merged by union, with a remove expressed as
  an absence. One merge with any peer that still has the element brings it back.
  This is the most common homemade-sync bug there is, and it survives review
  because every replica converges — fast, consistently, on the wrong answer.

Both are asserted to *fail* the thing they fail. If a well-meaning edit
accidentally fixed one of them, the suite goes red, because the foil would have
stopped demonstrating what it is here to demonstrate.

---

## What the network is allowed to do

* **Reorder freely** — latency is drawn per message per link.
* **Deliver twice** — at-least-once, decided per link, so one phone can see a
  message twice while its neighbour sees it once.
* **Hold traffic** — a partition defers everything crossing it until it heals.
* **Disagree about the time** — each device has a fixed skew, one by seconds.
* **Never lose a message for good.** The one thing it may not do — and that is a
  restriction on the *simulator*, not a favour to the engines. If messages could
  vanish, a divergence could always be blamed on the network instead of on the
  merge.

Same seed, same run, on any machine.

---

## Assertions

**169 properties, 2,507 executions, 47 of them negative.** Reported separately on
purpose: one law checked over 40 seeded pairs is one property and 40 executions,
and calling it 40 properties would inflate the headline by a factor of forty.

A *negative* property passes only when something refuses, loses or diverges —
`lww` losing point totals in most runs, `naive` failing to converge under
duplicates alone, the naive set resurrecting a removed element, a 2P-Set
ignoring a re-add.

The last group, **"The checks can fail"**, hands broken input to every judgement
the rest of the suite depends on and requires each one to report it:

* the canonical serialiser, given two boards that differ in one number;
* the convergence check, given a run with one point changed on one replica;
* the counter oracle, given totals that are too low, too high, and exactly right;
* the merge-law harness, given three merges each broken in exactly one way — and
  required to name the right law each time.

That group exists because a green suite whose checkers cannot go red is the
failure mode that has shipped three times elsewhere in this repository.

### Three bugs the suite found in this lab's own code

1. **The CRDT counter lost increments.** Deltas shipped `+3` where a state-based
   counter merges by `max`, so merging `3` into a component already at `5` was a
   no-op. It failed in the most flattering way available: every replica
   converged, on a total that was too small.
2. **The HLC never advanced on receipt.** Only local events moved the clock, so
   an edit made in reply to another edit could still be ordered before it, and
   the `crdt` engine resolved the skew scenario exactly like the wall clock did.
3. **"A register can only ever discard, so the total comes out low"** — asserted,
   and immediately false: 13 of 40 seeds came out *high*. A register does not
   drop points, it drops **writes**, and dropping one that happened to be a
   deduction raises the total. The error has no sign, so a reconciliation
   looking only for shortfalls will not find half of it.

Every runner was also checked by mutation — the counter delta reverted, the
observed-remove replaced, the HLC receive removed, the RGA delete flag dropped,
key sorting removed from the serialiser, the network pinned to constant latency —
and each mutation was seen to turn the suite red before being reverted. Two
early mutations survived and were real coverage gaps: nothing asserted that a
closed job actually disappears, and nothing depended on out-of-order delivery.
Both now have properties.

---

## Honest limits

* **The `crdt` job title is still a register.** Two people renaming one job
  concurrently still ends with one title. What changed is the reason: causality,
  not clock skew. A board field is not text just because it holds a string, and
  pretending otherwise is how a "CRDT sync" ends up losing exactly as much as the
  thing it replaced. Where both edits genuinely must survive, the type is a
  sequence — that is the Text merge tab.
* **RGA interleaves.** Two replicas typing whole words at one cursor position
  converge to one deterministic order, and that order may alternate their
  characters. Every replica sees the same alternation, which is what convergence
  promises; it is not the same as what a human wanted.
* **The textarea diff is prefix/suffix, not minimal.** It recovers the true edit
  for typing, pasting and backspacing. For a change that moves a word from the
  start of a line to the end it reports the whole line as replaced. The honest
  fix is capturing edits at the keystroke, which a textarea will not give you.
* **No tombstone compaction.** OR-Set tags and RGA nodes are kept forever. A real
  deployment needs a story here and this page does not have one.
* **No Byzantine peers, no auth, no bandwidth model.** Every replica is honest,
  anything a peer says is accepted, and deltas are small because the board is.

---

## Nothing leaves the tab

The page ships `connect-src 'none'` in a `<meta http-equiv="Content-Security-Policy">`
tag in its own source, so the browser refuses every outbound connection whatever
the JavaScript asks for. The counter in the header wraps `fetch`,
`XMLHttpRequest`, `WebSocket` and `sendBeacon` and shows how many were attempted.
The four "phones" are four objects in one tab.

CI asserts that counter stays at zero, on this page and every other lab.

Every technician, job, tag and timestamp is generated from the seeded PRNG in
`net.js` and none of it is real.

---

## Running it

```sh
python -m http.server 8080      # then open /labs/sepakat/
npm run test:labs               # all lab suites, in real Chromium
```

The property suite runs on the main thread, because it takes about a fifth of a
second. Rombak next door moved its suite into a Worker because it takes twenty.
