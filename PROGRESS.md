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
  [ ] inventory / gudang / POS
  [ ] keuangan / akuntansi UMKM (double-entry — must be genuinely correct or not shipped)
  [ ] HR / payroll (PPh 21, BPJS Ketenagakerjaan)
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
