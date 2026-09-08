# Saku — offline-first capture engine

**Live:** https://biassp.github.io/labs/saku/

Saku is a small money-capture PWA whose entire point is one thing: **a service worker
answering a `multipart/form-data` POST that the operating system generated, with no server
anywhere in the path, while offline.**

A PWA that declares `share_target` with `method: POST` appears in the Android share sheet.
Picking it makes the OS send a real POST at `./share`. GitHub Pages would answer a POST with
**405** — it never gets there. The service worker controlling this scope intercepts the request,
parses the `FormData`, writes the row to IndexedDB inside one atomic transaction, and replies
**303** with a `Location` to a GET URL. POST/Redirect/GET, moved into a worker, so the back
button cannot re-POST and duplicate the entry.

That path is Chromium-on-Android-only and needs an install, which is exactly where most
reviewers cannot follow. So the Engine view has a **Simulate a share** button that fires the
same POST at the same endpoint from the page itself. Same worker, same `FormData` parse, same
atomic write, same 303 — on a laptop, on an iPhone, in one click. The OS share sheet is the
bonus; the button is the proof.

## What is real

- **Share handler.** `sw.js` parses the multipart POST, downscales an attached photo with
  `OffscreenCanvas`, commits to IndexedDB, and returns `Response.redirect(..., 303)`. Every step
  is timestamped into a trace that is both broadcast live and persisted on the row, so a *cold*
  share (app closed, nothing listening) can still show you what the worker did.
- **Atomic write path.** The entry row, its outbox job and the Lamport counter bump are one
  `readwrite` transaction across three object stores. Inject the `QuotaExceededError` from the
  chaos console and the panel re-counts the stores afterwards: no orphan entry, no orphan job.
- **Offline shell.** Versioned precache, cache-first navigations. Kill the network and reload —
  it paints, and a simulated share still commits.
- **Update choreography.** No `skipWaiting()` on install. A new worker waits, the app says
  "Update ready", and code is swapped only when you say so.
- **Schema migration.** `onupgradeneeded` runs v0→v1 then v1→v2; the migration log is printed in
  the Engine view.
- **Outbox mechanics.** Idempotency keys, exponential backoff with half-range jitter (capped at
  30 s), and a claim flag plus lease timestamp written inside the same transaction — because
  IndexedDB gives you no cross-tab lock and two open tabs will otherwise both send the same row.
- **Conflicts.** Field-level merge ordered by a Lamport counter, not `Date.now()` (clocks skew
  and phones move backwards). Divergence produces a genuine conflict you resolve in a diff sheet;
  keeping *your* value still re-clocks the field above the peer's, or the same conflict recurs
  forever.
- **Parser.** A deterministic rule table for IDR / PHP / USD / trailing-code bank notifications.
  No model, no API key, no request. It shows which rule fired and the arithmetic behind the
  confidence score. Corrections train a local merchant→category map.
- **Photo pipeline.** `createImageBitmap` → canvas downscale → WebP (JPEG fallback), stored as a
  `Blob`. Object URLs are revoked on load.
- **Data sovereignty.** Export to one JSON file (photos base64'd inline), import, and a Wipe that
  clears IndexedDB, deletes every cache and unregisters the worker so a cold start can be replayed.

## What is simulated, and labelled as such in the UI

- **The sync "peer" is not a backend.** It is a second IndexedDB object store in this same origin,
  deliberately shaped like a request/response endpoint so the *client* code is real. It carries a
  persistent `simulated peer — local only` badge. Nothing is uploaded, because there is nowhere to
  upload to.
- **The quota failure is injected**, not a real 12 MP photo exhausting the origin budget. The
  abort path it triggers is the real one, and the post-abort store count is shown.
- **Server push is not shipped at all.** Web Push needs a push service and VAPID keys; static
  hosting cannot have either. The capability matrix says so rather than implying otherwise.

## What this does not prove

This is **web-platform engineering**: service workers, IndexedDB, lifecycle and transaction
boundaries. It is not evidence of Flutter, Dart, a native build, a store release or background
native services, and it is not filed as such.

"Makes no network requests" is a claim about **this lab page only**, and it is a claim about *your
data*: the share POST never leaves the browser, and nothing here contacts a third party. The one
request the browser may still issue is a same-origin re-fetch of this app's own `sw.js` when it
checks for a worker update — "Re-read state" calls `registration.update()` and will show up in a
server log. The CV's own home page, separately, does call `api.github.com` for its live repo feed.

## Browser matrix

| Feature | Where it works |
|---|---|
| Simulate a share (page → `./share`) | Anywhere a service worker runs — desktop included |
| OS share sheet → Saku (`share_target`) | Chromium on Android, after install. iOS and desktop ignore `share_target` |
| Install prompt (`beforeinstallprompt`) | Chromium. iOS: Share → Add to Home Screen (no prompt event exists) |
| Background Sync | Chromium. Elsewhere the outbox drains on `online` + `visibilitychange`, so a share received while the app is closed waits for the next open |
| Persistent storage | Grant is at the browser's discretion; a denial is displayed, not hidden |
| Camera `capture=` | Phones open the camera; desktops open the file picker and the same pipeline runs |

The app detects all of this live and prints it in **What this exact browser supports**. A red row
is a platform limit, not a bug.

## Running it locally

Service workers need a **secure context**, which means `https://` or `http://localhost`.
`file://` is not one, so the offline/install/share half of the app cannot run from a file path —
the page will say so, and the rest still works.

```bash
cd /path/to/biassp.github.io
python3 -m http.server 8000
# then open http://localhost:8000/labs/saku/
```

Try, in order: **Simulate a share** → **Drain now** → tick *Deliver every op twice* and share
again (the idempotency key absorbs the duplicate) → tick *Inject QuotaExceededError* and save a
capture (the transaction aborts and nothing is half-written) → **Peer edits your newest entry**,
edit that entry, drain, and resolve the conflict in the diff sheet. Then turn the network off and
reload.

## Files

| File | What it holds |
|---|---|
| `index.html` | App shell, three views, sheets. CSP meta, no inline script |
| `app.css` | CV design tokens, dark default + `[data-theme="light"]`, layout, gestures, reduced-motion |
| `theme.js` | Sets the theme before first paint; the storage read is wrapped in try/catch |
| `app.js` | UI, router, engine telemetry, gesture layer with keyboard parity, share simulation |
| `store.js` | IndexedDB: migrations, the atomic `commitEntry` transaction, claim/lease, Lamport counter. Loaded by the page *and* the worker |
| `parse.js` | The bank-notification rule table. Loaded by the page *and* the worker |
| `sync.js` | Outbox drain, simulated peer, LWW merge, chaos injectors |
| `sw.js` | Precache, cache-first navigation, the share POST handler, Background Sync |
| `manifest.webmanifest` | Install metadata, `share_target`, shortcuts |
| `icon-*.png` | Generated by `tools/gen-icons.py` — real PNGs written with `zlib` + `struct`, because this repo has no asset pipeline |

Vanilla HTML/CSS/JS. No framework, no bundler, no build step, no dependencies, no API key.
