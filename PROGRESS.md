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
- NOTE: pushing `.github/workflows/*` needs a token with the `workflow` scope. If the push is
  rejected for that reason, the file has to be added from the web UI or a local machine.

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
