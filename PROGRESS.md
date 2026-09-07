# PROGRESS — biassp.github.io (CV) & SkillPath

Cross-device handoff. Read this first when resuming on any device.
Last updated: 2026-09-07.

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

## Next / ideas (not yet done)
- SkillPath: completion certificate (PDF), instructor detail page, more seed courses.
- Confirm PH employer naming: PDF says "Quantum Advertising Services"; CV currently uses
  "Infinix Philippines" per request for both Makati roles — change if needed.
- CV hero location badge still "Jakarta, ID" (LinkedIn current = Colombo, Sri Lanka).
- Optional: custom domain, store assets for Play uploads.

## How to work here
- Both are static. Preview locally: `python -m http.server 8080` then open the folder.
- Deploy = git push to the Pages branch (master for CV, main for skillpath). Pages auto-builds.
- Validate CV HTML nesting before push (0 errors expected).
