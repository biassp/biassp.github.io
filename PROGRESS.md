# PROGRESS — biassp.github.io (CV) & SkillPath

Cross-device handoff. Read this first when resuming on any device.
Last updated: 2026-09-08.

## Live
- CV:        https://biassp.github.io/   (repo: biassp/biassp.github.io, branch master)
- SkillPath: https://biassp.github.io/skillpath/  (repo: biassp/skillpath, branch main)

## Done
- CV fully redesigned (single-file index.html): sticky nav, hero (photo profile-2026.png),
  stats, About, work-experience timeline, skills, portfolio grid, repos section,
  education/orgs/languages, dark-light theme toggle, print-to-PDF, responsive.
  - Fixed blank-page bug: content visible by default, reveal-animation only under html.js
    with IntersectionObserver + 1.8s timeout fallback.
  - Work experience aligned to LinkedIn PDF (Octo Global, Infinix Philippines x2,
    Shane English, Flashcom, Bisnis Integrasi Global, BLK, PPD). No betting/Oriental Club.
- Portfolio cards: SkillPath (featured, live+source), BioAge, Radar Duit, Cek Aman,
  PakPDF, University Portal, Login Hub PK, Movieca, FaceVibe + Open-Source repos section.
- SkillPath e-learning app built (vanilla HTML/CSS/JS, zero-backend static SPA):
  8 courses / 6 categories, lessons (video/reading), quizzes+scoring, hash router,
  live search, category filters, progress + theme via localStorage, dark/light, responsive.
  Files: index.html, assets/css/styles.css, assets/js/data.js, assets/js/app.js.
  Verified: node --check, data schema (0 problems), CSS class cross-check, QA agent ok.

- 2026-09-08 — Repos section is now a LIVE GitHub feed (still one file, still zero deps).
  - GET api.github.com/users/biassp/repos?per_page=100&sort=pushed, cached in
    localStorage under `gh_repos_v1` = {at, repos}, 6h TTL. Fresh cache paints first,
    the network then refreshes behind it.
  - Filters out forks / archived / private, plus a HIDE list (currently ['biassp']).
    A CURATED map (keyed by lowercase repo name) overrides title + description and
    sets sort weight; anything NOT in it still renders — title-cased from the slug,
    described by GitHub — so new repos appear with no code change.
    Sort: weight desc, stars desc, pushed_at desc.
  - Cards reuse .proj/.proj-body/.proj-tags: title, description, up to 3 topics,
    then language (colour dot) + stars + forks + "x ago". Zero metrics are hidden.
    Everything from the API goes through an HTML escaper before innerHTML.
  - New counter strip (reuses .stats/.stat/.num/.lbl) and language filter chips built
    from whatever the payload contains, with aria-pressed state and per-language counts.
  - FALLBACK: the nine hardcoded cards stay in the HTML, are stashed before the
    skeleton, and are restored verbatim on 403 / offline / weird payload. Their
    "reveal" class was removed — restored elements never get .in from the
    IntersectionObserver, so they would have been invisible forever.
  - Fixed alongside: unescaped & in the Google Fonts URL + <title>/og:title -> &amp;,
    and the theme toggle's localStorage calls are now try/catch'd (an unguarded read
    there killed the whole <script> block when a browser blocks site data — which
    also took down the reveal fallback and blanked the page).
  - Verified: node --check on all inline <script> content; parse5 0 errors;
    html-validate 0 errors 0 warnings; Nu (vnu) 0 errors; tidy's 2 ampersand warnings
    gone with no new warnings; 14/14 jsdom tests green (test/repos.test.js);
    Chromium render checked for live, 403-fallback, light theme, <900px and print.
  - Dev-only: `npm install jsdom && node test/repos.test.js`. node_modules is gitignored;
    the site itself still ships as a single dependency-free index.html.

## CI (added 2026-09-09)
- `.github/workflows/ci.yml` runs on every push to every branch, on PRs, and on demand.
  Before this, NOTHING in this repo ran automatically: 3.659 lab assertions + 14 jsdom
  tests existed and were only ever run by hand, in a chat session. The validation stack
  (node --check, parse5, vnu, html-validate, Playwright) was also all manual.
- Five steps, each its own npm script so they run identically on a laptop and in CI:
  * `test:syntax`  node --check over all .js + the inline <script> blocks of index.html,
    concatenated in document order. The inline blocks are the ones no file-based tool sees,
    and one missing bracket there blanks the whole CV.
  * `test:markup`  parse5 + W3C Nu (vnu.jar) + html-validate over all 12 HTML files.
    Three validators because they disagree; the disagreements are where findings live.
  * `test:links`   every relative href/src resolves on disk, every #fragment has its element.
    A renamed folder breaks a portfolio link silently — nothing else here would catch it.
  * `test:repos`   the existing 14 jsdom tests, unchanged.
  * `test:labs`    the 3.659 in-page assertions, run in real Chromium against the real pages
    over a local static server. NOT a rebuilt script order under node: serving the page proves
    the page boots (script order, CSP, no console error), which a node harness cannot see.
    file:// cannot work here — every lab ships `script-src 'self'` and file:// has an opaque origin.
- EVERY new runner was proved able to go RED before being trusted: a deliberate parse error,
  a dead link, a dead #fragment, and a planted failing assertion were each injected, seen to
  fail with exit 1, then reverted. This is the same "proof that can only pass" trap that got
  through three times in the labs — see the checklist below.
- Fixed while wiring this up: 17 real html-validate findings — `type="button"` added to the
  CV theme toggle and to the 16 tab buttons in harvest + rekam (no <form> anywhere, so
  behaviour is unchanged; the implicit type was still wrong).
- `.htmlvalidate.js` turns off exactly two rules, each with its reason written in the file:
  `no-inline-style` (house style; the CV is one file by design) and `prefer-native-element`
  (HARvest's drop zone is a drag target first). Everything else in `recommended` is enforced.
- `package.json` + `package-lock.json` are dev-only. The site still ships zero dependencies.
- CHROMIUM_PATH env var overrides Playwright's browser lookup — needed in the sandbox where
  the installed Chromium build does not match what this Playwright version expects.
- Runner output, README, workflow step names and the labs-index sentence are all in English,
  matching the English-first pass that landed on master the same day.
- FIRST CATCH, within minutes of existing: the English-first commit added `#langToggle` to
  index.html without `type`, and `test:markup` failed on it. Exactly the class of thing that
  used to reach master unnoticed.

## Rombak — the database lab (added 2026-09-09)
- `labs/rombak/`. Real SQLite 3.49.1 as WebAssembly (sql.js 1.14.2, MIT, vendored). 33 tables,
  19 indexes, 3 triggers, 47,611 rows, nine migration versions. Domain is the Rekam clinic, so
  it reads as "that same domain done properly as a relational schema", not an eighth unrelated demo.
- Built by two workflows: design (18 agents, 3 competing designs, 9 judges) then build
  (10 agents, 6 slices + 4 adversarial verifiers). ~5.8M subagent tokens.
- THE SPEC AGENT FALSIFIED THREE OF THE WINNING DESIGN'S CLAIMS by running them, before any
  code existed. All three corrections are better than the originals:
  * "Same bytes, two outcomes" was impossible. The real difference is one word in a child
    table's DDL, or one child table that happens to be empty this quarter.
  * The naive audit rebuild is NOT refused by append-only triggers or a self-FK: BEFORE DELETE
    does not fire on DROP TABLE, and a DEFERRABLE self-FK is checked at COMMIT when the new
    table already satisfies it. It commits, rows survive, both triggers silently gone.
  * The typeof-sweep-after-STRICT was tautological — the recurring bug, caught before shipping.
- 262 distinct properties, 94 negative, 1,012 executions. Count is LOW on purpose: no assertion
  may have SQLite's own correctness as its subject. Properties and executions are reported
  separately because conflating them flatters the total.
- `census.js` is the firewall against the proof-that-can-only-pass bug (shipped 3x before):
  two globals only, injected exec, own table list from sqlite_master, refuses if its own bare
  SELECT does not plan as SCAN. CHECK IT WITH:
  `grep -o 'ROMBAK_[A-Z]*' labs/rombak/census.js | sort -u`  -> must print exactly two names.
- The self-proof verifier injected 11 mutations one at a time; SEVEN checks stayed green while
  their subject was corrupted. All seven fixed and re-verified the same way.
- FOUND BY ME, NOT BY THE VERIFIERS: the suite blocked the main thread for 23.6 SECONDS on load.
  The page was frozen — no scroll, no tab clicks. The build agent knew (its comment said "before
  the main thread disappears for twenty seconds") and accepted it; it never reached the
  still-broken list. Fixed by moving the suite into `tests.worker.js`. Longest block is now 1.2s
  and every tab responds under 100ms while it runs. Both paths verified to 1012/1012 — the
  fallback by deleting window.Worker before load.
  LESSON: verifiers checked "does it finish" and "any console errors", not "is the page usable
  while it runs". Add main-thread blocking to the verifier brief next time.
- Vendoring made the suite index's "0 dependencies" FALSE. Corrected everywhere to "7/8 labs
  with zero dependencies" rather than reworded into something technically defensible. The lab
  says so above the fold, uncollapsed. CSP gains 'wasm-unsafe-eval'; connect-src 'none' is
  byte-identical to the other seven.
- `node tools/vendor-sqljs.js labs/rombak` regenerates all three vendored files byte-identically
  (verified with md5sum). sql.js pinned to exactly 1.14.2, not a caret range.
- NEW CI STEPS: `test:i18n` (every data-i18n key resolves in both languages — a missing key
  blanks the element only for ID readers, and nothing else catches it; proved red three ways),
  and the labs runner now asserts the zero-network claim for all seven labs instead of trusting
  the badge (proved red: every guard reads 0 at rest and 1 after one fetch).
- STILL OPEN, stated in the lab README rather than hidden: app.js has no automated control, so
  a broken panel would not fail CI; the runner's step-10 refusal branch has never fired; the
  zero-console-error check cannot be controlled without removing the handlers that make it pass.
- Spec at scratchpad/skema-spec.md (2,333 lines + Appendix F). Not committed — session-scratch.

## Sahih — the token lab (added 2026-09-10)
- `labs/sahih/`. "Sahih" = valid/authentic. Five JWTs through a naive verifier and a strict one,
  on the same bytes. Every token is valid in the only sense cryptography offers — the signature
  checks out — and four of the five are forgeries anyway. 12 files, 508KB, **ZERO vendored bytes
  and ZERO CSP relaxation** (unlike rombak). Everything is crypto.subtle, which the browser has.
- 150 distinct properties, 76 negative, 419 executions, 12 groups. Site total 5,090 / 8 labs.
- Built by two workflows (18 design agents, 10 build agents), ~5.2M subagent tokens.
- THE `wrongClaims` JUDGE FIELD PAID FOR ITSELF: judges flagged 68 claims as wrong or overstated
  across the three candidate designs; the spec agent retested every one and wrote **27 verified
  corrections** before any code existed. Keep that field in every future design workflow.
- CORRECTIONS WORTH REMEMBERING BEYOND THIS LAB:
  * page.evaluate does NOT throw on unclonable values — it CORRUPTS SILENTLY. CryptoKey -> {},
    ArrayBuffer -> {}, Error -> {name:"Error"}. A suite carrying a key reaches CI as {} with
    everything green. Hence group G0, which walks the whole result recursively. THIS AFFECTS
    EVERY LAB, not just this one.
  * Under connect-src 'none', navigator.sendBeacon still returns TRUE. Instrument the CALL,
    never the outcome. And never make a page attempt egress to "prove" its counter — every
    blocked attempt logs a console error and CI counts one console error as a broken page.
  * Never assert on Chromium error message TEXT; assert error names and the lab's own codes.
  * I told the owner the RFC 6238 T=59 vector was 287082. WRONG: the RFC prints 94287082
    (eight digits); 287082 is its six-digit truncation and does not appear in the RFC. All 18
    Appendix B rows verified at 8 digits.
- FOUND BY THE VERIFIERS: two assertions were TAUTOLOGIES — each gated on the very flag it
  claimed to test (`if (v.naiveAccepted) t.ok(v.naiveAccepted)`). Also §2.6's discrimination set
  refused by accident rather than by the claimed mechanism. Both fixed.
- FOUND BY ME, after the verifiers: the CV-facing footer said keys were "generated in your tab".
  Only the HMAC key is; RSA and ECDSA are imported from RFC 7515 A.2/A.3. The code was already
  honest (every key carries a `provenance` field) — only the prose overclaimed. Fixed.
- MEASURED MYSELF, not taken from handoff: verifiers reported 13/419 red when crypto.subtle
  .verify is stubbed to always return true; my own run gives **16/419** (G5 9, G6 6, G9 1). The
  tree moved under them. ALWAYS re-measure before writing a number into a README.
- Main-thread blocking was a hard requirement in the build brief this time, after rombak froze
  for 23.6s and all four of its verifiers missed it. Result: 58-141ms across four independent
  measurements. The lesson transferred.
- periksa.js is the firewall and is STRICTER than rombak's census.js: it knows exactly ONE name,
  its own. `grep -o 'SAHIH_[A-Z]*' labs/sahih/periksa.js | sort -u` must print one line. It pays
  for that with its own base64url decoder, its own P-256 curve-order literal and its own
  byte-wise adder.
- HONEST LIMIT, stated on the page: both verification routes ultimately call crypto.subtle. The
  separation catches a mistake in the lab's logic; it cannot catch a lie told by the browser.
- STILL OPEN, in the lab README rather than hidden: app.js has no automated control (a mutation
  restoring a wrong year in page prose left all 419 green — page text is unasserted by
  construction); one stochastic credential-shape sweep with a ~1-in-23,000 false positive;
  SAHIH_STORE.keyRoundTrip is dead code.

## i18n drift — a bug I shipped and then caught (2026-09-10)
- When integrating rombak I changed the labs-index markup and did NOT change the dictionary. The
  page read correctly in English and silently reverted to the OLD wording on the language toggle.
  test/i18n.test.js only checked that keys EXIST, so it passed.
- Fixed by extending test:i18n to compare the English markup against the dictionary's `en` for
  every key. It immediately caught a SECOND stale entry (`eng.p`) that I had also missed.
- The check has never needed a synthetic red proof: it went red twice on real drift.

## Serobot — the race lab (added 2026-09-10)
- `labs/serobot/`. *Menyerobot* = to cut in line. Two writers race one balance: a stored column
  loses updates in silence, an append-only ledger cannot, and a rendezvous turns the race into an
  exact integer — which is the only reason any of it is assertable. 15 files, 616KB, ZERO
  vendored bytes, CSP byte-identical to the strict labs (`diff` of line 13 vs harvest is empty).
- 187 distinct properties, 66 negative, 567 executions, 13 groups. Site total 5,657 / 9 labs.
- Closes the gap rombak declared about itself. rombak/README's "No concurrency" bullet now points
  at this lab — but still declines the migration-under-load case, which neither lab claims.
- THE BIG CORRECTION, and it falsified a claim I made to the owner twice: the lost update is NOT
  caused by OS-thread parallelism. The identical loss happens on ONE event loop with no workers,
  and there it is EXACT — final === N regardless of writer count; ten writers doing ten
  increments each produce ten, not one hundred. Cause: a read-set spanning an await. Parallelism
  makes the interleaving easy to hit, not possible. The exact version is also the assertable one.
- THE FLAKE GATE IS THE NEW STANDING PRACTICE FOR ANY NONDETERMINISTIC LAB. The spec fixes which
  assertions ship (30/30 at 1x, 4x AND 8x CPU throttle via CDP Emulation.setCPUThrottlingRate),
  which are DEMOTED to on-screen observations, and which are REFUSED. Binding on builders.
  * WHY 60 AND NOT 20: the survey's own 20-run pass reported an assertion 20/20 green that a
    12-run pass had already caught failing 2/12. Twenty runs cannot certify a race assertion.
  * Verified independently by me on the final tree: 25/25 green at 1x, 30/30 at 8x, all 567/567.
    The flake verifier reported 245 consecutive green runs.
- Main-thread block 33–50 ms across four verifiers — the best in the repository. rombak was
  23,600 ms and nobody caught it; sahih 58–141 ms. Measured with rAF, never setInterval: a
  setInterval monitor reports 0 ms for a real 788 ms block because it cannot fire during one.
- BLOCKERS FOUND AND FIXED, one of them on the site's most load-bearing claim: the header egress
  badge read "network calls from this page: 4" on EVERY page load while nothing had left the tab
  — a probe function was polluting the live counter, then "repairing" it by ZEROING, which would
  have destroyed a genuine egress count. Also: the independence table could be collapsed to a
  single route in two places and nothing noticed (route A was written twice).
- HONEST LIMIT SHIPPED AS A NUMBER, NOT A HEDGE: the firewall's cached-replay case is 0 of 187 —
  a witness handed a faithful replay of the engine's own rows agrees with it, and no arithmetic
  can catch that. The structural defence is that fold() takes a reader FUNCTION, never an array.
- Verifier verdicts worth keeping: "THE LAB IS RIGHT ABOUT ITS BIG CLAIMS AND I COULD NOT BREAK
  THEM" and "NO NETWORK / CLOCK-SKEW / CRASH OVERCLAIM FOUND ANYWHERE."
- STILL OPEN, in the lab README: the tab strip sits at y=946 desktop / y=2357 at 390px, the worst
  on the site (spec-mandated — the lede sits above it); print keeps only the visible panel (house
  decision, matches sahih); an abandoned run can leave one orphaned run-scoped IndexedDB
  database, whose only safe repair is an AGE-GATED boot sweep.

## The worker CSP hole (2026-09-10) — applies to EVERY lab, not one
- A `<meta http-equiv="Content-Security-Policy">` DOES NOT REACH A WORKER REALM. Measured under
  the labs' own CSP: a fetch from the page is refused with connect-src 'none' and logs two
  console errors; the IDENTICAL fetch from inside a worker RESOLVES, silently, and
  `window.<DIR>_GUARD.total()` cannot see it because that object lives in the page realm.
- Two shipped labs run real workers under the zero-egress badge. Neither makes a network call, so
  the badge was not lying — but the guarantee was weaker than the CI check I had added claimed.
- MY FIRST FIX WAS THE FIFTH INSTANCE OF THE PROOF-THAT-CANNOT-FAIL BUG: asking each worker for
  its guard total. That loop could never fire — at the moment the runner checks, the lab's worker
  has not spawned (run() is called on the main thread), and by the time it has, it has
  terminated itself. I wrote it while fixing the fourth instance.
- CORRECT FIX, shipped: `page.on('request')` in test/labs.test.js, filtered to
  fetch/xhr/websocket/eventsource/ping. It sees every realm, needs no cooperation from the code
  under test, and cannot be fooled by an instrumented object that lies. Proved red from the page
  realm; a standalone probe proved the same listener sees a worker's fetch.
- rombak/tests.worker.js now importScripts('guard.js') first so the worker instruments itself.
  sahih/guard.js is verified worker-safe; do NOT copy a guard that writes `window.` directly.

## Standing rules (decided 2026-09-08 — apply without asking again)
- COPYRIGHT: the repo ships an all-rights-reserved LICENSE and every lab source file carries a
  copyright header. This is NOT open source and must not be relicensed. Keep the headers when
  editing those files.
- Reality check to repeat if asked again: a static site cannot technically prevent copying — the
  browser must receive the code to run it. The LICENSE and headers are the enforceable layer
  (they make a DMCA takedown possible); obfuscation is not, and would destroy the labs' whole
  point, which is that a reviewer can READ the code. The genuinely confidential products
  (RepBout/fitclash, company-vault, penyidik) are protected the only way that works: their repos
  stay private and the CV only DESCRIBES them in prose.
- NOTHING black-hat, gambling-adjacent, or legally grey goes on this CV. No portfolio card, no
  repos-feed entry. That work stays PRIVATE and uncarded. This covers the gambling/AMP/SEO cluster
  (daman-*, tiranga-*, 62club-*, 91.club, ok-win, basant-club, kubet*, cheatgacor, cheatslot,
  wp-xclub, bharatclubamp, diuwin-amp, Pak-Games), the SEO-manipulation repos (tunneling-keywords-,
  random-sub-domain-article, article-generate), and `documentation` (described "injek shell").
  All are already private — keep them that way.
- Consequence for the live feed: public repos matching the rule go in the HIDE array in index.html.
  Currently HIDE = ['biassp', 'wp1', 'wordpress', 'traffic', 'billy-kill-1'].
- Never invent portfolio copy. A card may only claim what the repo's own GitHub metadata (or the
  owner) actually states. Private repo + no description = ask, do not guess.

## Sistem Informasi Suite (decided 2026-09-08 — in progress)
Structure agreed with the owner: build five domain systems under /labs/, present them as ONE
suite, not five portfolio cards. Reason: 8 demos vs 10 real shipped products would invert the
signal and bury BioAge / Radar Duit / FaceVibe / RepBout behind practice work.
  - /labs/ gets an index page listing the suite.
  - ONE portfolio card ("Sistem Informasi Suite — klinik, sekolah, gudang, keuangan, HR")
    points at that index. HARvest and Saku keep their own cards (different audience: engineers).
Order agreed: rekam (medical) -> siakad (school) -> inventory/POS -> keuangan -> HR/payroll.
  [x] rekam   — clinic. No. RM never reused, SOAP encounters, ICD-10 subset with fuzzy search,
                hash-chained append-only audit trail (crypto.subtle) with amend-never-delete,
                drug interaction + allergy checks, antrian state machine, role views, BPJS/umum.
  [x] siakad  — school. Centrepiece is a real timetable constraint solver (backtracking +
                constraint propagation, most-constrained-variable heuristic, in a Worker):
                hard constraints never violated or it reports infeasibility. Plus NISN vs NIS,
                tahun ajaran/semester scoping, weighted assessment + KKM + predikat + rapor,
                presensi H/S/I/A, PPDB with quota, SPP arrears, role-based views.
  [x] gudang  — inventory + POS. Ledger is the only truth (balance always derived), FIFO layers
                + weighted average side by side, backdated recomputation, value conservation
                asserted to the rupiah. No LIFO — Indonesian tax law does not permit it.
                568 in-page assertions. Its build workflow was killed mid-run by a session
                limit and resumed; the two completed reviews replayed from cache.
  [x] payroll — HR + payroll. PPh 21 TER with a December true-up: the sum of twelve monthly
                deductions equals the annual figure for all 62 employee-years, mid-year joiners
                and leavers included. 953 assertions.
  [x] buku    — double-entry accounting. All 7 invariants hold; the indirect cash flow statement
                reconciles to raw journal cash movement to the rupiah (verified independently,
                not read off the badge). 1274 assertions.
  [x] /labs/ index page + ONE suite portfolio card, as agreed. Suite total: 3.483 assertions
                across the five sistem informasi; 3.659 including HARvest.

RECURRING BUG, seen THREE times (gudang, buku, payroll) despite being an explicit ban in the
brief: a "proof" panel that verifies itself instead of the data — recomputing a figure from the
same cached total it claims to check, so the difference can only ever be zero. Whenever a lab
claims an invariant on screen, confirm the check reads the RAW journal/ledger/payslip records.
Two of the three were caught only because a reviewer was told to look for exactly this.

SHIPPED SO FAR (both live on master, both independently re-verified by the main session, not
just self-reported by the build agent):
  - /labs/rekam/  — 379/379 in-page assertions. 28 review findings fixed, 0 skipped.
    Open: no paediatric mg/kg dosing, paediatric hypertension uninterpreted (needs percentile
    curves), audit-chain commitment shares IndexedDB with the rows it protects.
  - /labs/siakad/ — 309/309 in-page assertions. 28 fixed, 3 skipped with reasons.
    Solver: 136 variables, 2129 nodes, 3764 backtracks, 70ms, 0 hard-constraint violations, and
    the infeasible scenario is PROVED infeasible rather than silently emitting a bad timetable.
    Open: hardest scenario can take ~9s; deskripsi capaian has no KD codes; rapor has no
    signature block or kenaikan-kelas decision; no P5/ekstrakurikuler on the timetable.
  - /labs/gudang/ — 568 in-page assertions. 11 confirmed findings, 4 of them money bugs:
    gross profit mixed VAT bases (overstated 128%), sales returns had no cumulative limit
    (created stock from nothing), ledger ids from a per-tab counter used as the IndexedDB key
    (one tab silently destroyed the other's entries), and TRANSIT was one pooled FIFO location
    so costs swapped between destination warehouses. All fixed and independently re-verified.
    Note the cross-tab fix took a better route than the review suggested: put() -> add(), so a
    colliding key throws and the tab stops writing, instead of minting UUIDs to dodge it.
    Open gaps, stated in its README: two-tab posting is PREVENTED (one writer holds a lock),
    not supported, with a residual sub-second race if a frozen tab's 9s lock lapses; the rupiah
    conservation identity is still engine-derived, though quantities and per-document transfer
    value are now cross-checked against the raw journal ("buku hidup: 21/21 invarian" in the
    header); only ledger entries persist, not the nota/PO/transfer document objects, so a nota
    created this session is not selectable in the retur picker after a reload (its entries and
    cumulative retur history survive and are still enforced); retur pembelian is costed by the
    active method rather than against the specific receipt; and entries written by an older
    build carry no nilaiDpp, so they are estimated as PPN-inclusive and counted in
    total.dppTaksiran with the live-book check going red — visible rather than silent.
  RECURRING BUG TO CHECK IN EVERY NEW LAB: both labs shipped a light-theme regression where
  --accent/--accent-2 were not overridden, leaving dark-surface cyan on near-white and text
  below AA. Check the light block overrides EVERY accent token before shipping.
Every lab: synthetic seed data from a seeded PRNG, stated as fake in the UI; all storage in
try/catch; zero network egress scoped to the lab page; copyright header in every file.

## Next / ideas (not yet done)
- Fill in the About + Topics fields of each repo on GitHub. The CV now reads them
  live, so this is by far the cheapest way to improve how the site looks — every
  repo without a description renders a generic placeholder line, and repos with no
  topics render no tag row at all. Worth doing for the public repos the feed still
  shows: guest-room-reservation ("hans"), crudsqlite ("Java-Mobile"), webgudang,
  jadwal-kuliah ("Jav Mobile Programming"), reservasi, silang-bulat-silang,
  AutomationScreenShoot, anniversary, content-ops-starter.
  (wordpress, wp1, traffic and billy-kill-1 are HIDE-listed now — do not bother.)
- Create the biassp/biassp profile repo (README shown on the GitHub profile page).
  Note: it is already on the feed's HIDE list, so it will not show up as a CV card.
- Heads-up from the feed going live: Blocking-DDoS-Attacks-Cloudflare-WAF-Rules and
  CareerHigh-Android are FORKS on GitHub, so the fork filter drops them — they now
  only appear in the offline fallback. Detach/recreate them, or decide to let them go.
- RESOLVED 2026-09-08: biassp/Movie-API IS empty. Every claim removed — the repos fallback card,
  the CURATED entry, and it is HIDE-listed so the live feed cannot resurrect it as a placeholder.
  Fallback grid is 8 cards now, not 9.
- Portfolio expansion (2026-09-08 planning run) — decided:
  * EXCLUDED under the standing rule: penyidik / selingkuh-detector (infidelity detector),
    sports-khel (live-cricket rights + betting-affiliate risk), the-predix, kindfans.
  * netflex -> fold into the existing Movieca card as "Movieca Web". Never use the name "Netflex"
    or "Netflix-style" on the CV — one character off a trademark.
  * claude-sync -> do NOT make public just for a CV line; it holds config + memory files.
  * ANSWERED 2026-09-08:
    - fitclash = RepBout, an Android workout-battle app (Flutter). CARDED in the portfolio.
      Repo stays private; repbout-secrets holds the release keystore, encrypted — keep it that way.
    - company-vault = owner's own digital wallet running on his VPS. Repo stays PRIVATE. He wants a
      screenshot on the CV instead of a link. BLOCKED: this session has no VPS access and cannot
      take it. He must capture it himself and drop it in assets/images/, REDACTED first (no
      balances, no hostnames/IPs, no endpoints, no tokens, no customer data). Then the card can
      be written around the screenshot.
    - website-cloner-skills + my-claude-marketplace = internal AI-agent tooling. Owner's decision:
      do NOT put on the CV. Excluded permanently.
  * Still unanswered: is selingkuh-detector the Flutter client for penyidik.co? (moot for now —
    penyidik is excluded under the standing rule). Is login-portal the code behind login.ac.pk or
    login.net.pk (both already carded)? Needed only to avoid a duplicate card.
- SkillPath: completion certificate (PDF), instructor detail page, more seed courses.
- Confirm PH employer naming: PDF says "Quantum Advertising Services"; CV currently uses
  "Infinix Philippines" per request for both Makati roles — change if needed.
- RESOLVED 2026-09-08: the three CV credibility leaks are fixed. Hero now says 7+ years (was 6+
  while the stats strip said 7+); location is Colombo, LK everywhere (badge, lede, meta, contact);
  and the Infinix/Octo overlap is real — he was retained remotely after relocating — so the dates
  stand and the company line now says "Remote from Jul 2025" with a sentence of explanation.
- Optional: custom domain, store assets for Play uploads.

## How to work here
- Both are static. Preview locally: `python -m http.server 8080` then open the folder.
- Deploy = git push to the Pages branch (master for CV, main for skillpath). Pages auto-builds.
- Validate CV HTML nesting before push (0 errors expected).

## 2026-09-09 — CV is English-first + EN/ID toggle; case studies audited vs code
- LANGUAGE: index.html, labs/index.html and all case studies are now English-first
  (English ships inline = the no-JS default) with a persistent EN/ID toggle.
  Mechanism: per-page dict of {key:{en,id}}, elements marked data-i18n / data-i18n-html,
  localStorage key 'cv_lang' (default 'en', every call try/catch'd), a #langToggle button
  next to the theme toggle. CV keeps it INLINE (var I18N) so index.html stays single-file;
  case pages share the core added to case/case.js (reads window.PAGE_I18N). Theme-button
  label is now language-aware (Light/Dark vs Terang/Gelap). Repos feed + reveal fallback
  preserved. NOTE: individual lab apps under /labs/<name>/ were NOT translated (Indonesian
  domain systems) — only the labs INDEX is bilingual.
- CONTENT: the 3 previously-unanswered case-study problems are now answered from real code
  (radar-duit format drift, bioage backward-compat API, repbout result verification).
  New case study case/cek-aman/index.html + a Cek Aman portfolio card on the CV.
- AUDIT (IMPORTANT discipline): a skeptic agent cross-checked every case-study/CV claim vs
  the actual product code and found 5 overclaims — ALL now corrected in prose + both dict
  languages:
    * radar-duit p3: NOT on-device parsing. Flutter only whitelists which apps are read;
      full notification text IS sent to the server (DeepSeek). Earlier "nothing leaves the
      phone" wording (mine, from 47d9530) was itself wrong — re-corrected here.
    * radar-duit p1: "silence = failure signal" is NOT built; softened to permission re-check
      only, silence-detection marked as planned.
    * repbout p1: only the company VAULT balance is ledger-derived; user gems are a stored
      column guarded by idempotency keys (ledger-derived gems = planned next step).
    * bioage p1: no server-side face/brightness gate; credits refunded only when nothing
      usable returns; biological age is a single number + confidence, not a range.
  LESSON: never let a case study claim more than the code does — verify against the repo,
  not against another comment in the code (the backend comment claimed a Flutter regex layer
  that does not exist). Commit f4cd3dd.
- STILL OPEN (unchanged / next): repo GitHub About+Topics metadata; biassp/biassp profile
  README; Company Vault screenshot (owner must capture+redact); SkillPath cert/instructor/
  more courses; decide on dropped forks. The problem-framing "why hard" blocks were left as
  aspirational requirements (they read as the ideal; the solved blocks now state what is
  actually built vs planned).
