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
- VERIFY: biassp/Movie-API looks EMPTY (created_at == updated_at == 2021-04-29T15:16:58Z, no
  language, no description). The Movieca portfolio card calls it "the backend foundation feeding
  the Movieca movie-discovery experience" and the CURATED map ranks it weight 60. If it really has
  no commits, drop both claims — a recruiter who clicks learns something worse than nothing.
- Portfolio expansion (2026-09-08 planning run) — decided:
  * EXCLUDED under the standing rule: penyidik / selingkuh-detector (infidelity detector),
    sports-khel (live-cricket rights + betting-affiliate risk), the-predix, kindfans.
  * netflex -> fold into the existing Movieca card as "Movieca Web". Never use the name "Netflex"
    or "Netflix-style" on the CV — one character off a trademark.
  * claude-sync -> do NOT make public just for a CV line; it holds config + memory files.
  * Still unanswered, needed before any card: what are fitclash, company-vault,
    website-cloner-skills, my-claude-marketplace? Is selingkuh-detector the Flutter client for
    penyidik.co? Is login-portal the code behind login.ac.pk or login.net.pk (both already carded)?
- SkillPath: completion certificate (PDF), instructor detail page, more seed courses.
- Confirm PH employer naming: PDF says "Quantum Advertising Services"; CV currently uses
  "Infinix Philippines" per request for both Makati roles — change if needed.
- CV hero location badge still "Jakarta, ID" (LinkedIn current = Colombo, Sri Lanka).
- Optional: custom domain, store assets for Play uploads.

## How to work here
- Both are static. Preview locally: `python -m http.server 8080` then open the folder.
- Deploy = git push to the Pages branch (master for CV, main for skillpath). Pages auto-builds.
- Validate CV HTML nesting before push (0 errors expected).
