# Bias Satrio Putra — CV and portfolio

[![CI](https://github.com/biassp/biassp.github.io/actions/workflows/ci.yml/badge.svg)](https://github.com/biassp/biassp.github.io/actions/workflows/ci.yml)

https://biassp.github.io/

A static CV and portfolio. No framework, no build step, no runtime dependencies —
plain HTML, CSS and JavaScript served straight from `master` by GitHub Pages.

| | |
|---|---|
| `index.html` | The CV itself, one file, including the live GitHub repositories feed |
| `labs/` | Seven demo applications that run entirely inside a browser tab, with no server |
| `case/` | Case studies: BioAge, Radar Duit, Cek Aman, RepBout |
| `test/` | Tests. Never served to a visitor. |

## Running the tests

Everything in `devDependencies` exists only to test the site. The site itself
loads none of it.

```bash
npm ci
npx playwright install chromium
npm test
```

| Command | What it checks |
|---|---|
| `npm run test:syntax` | `node --check` over every `.js` file, plus the inline `<script>` blocks of `index.html` concatenated in document order |
| `npm run test:markup` | parse5, the W3C validator (Nu) and html-validate over every HTML file |
| `npm run test:links` | Every relative `href`/`src` resolves to a file that exists, and every `#fragment` has its element |
| `npm run test:repos` | 14 jsdom tests over the GitHub repositories feed, including the fallback path when the API answers 403 |
| `npm run test:labs` | The 3,659 assertions that ship inside the six engine labs, run in real Chromium against the real pages |

All five run automatically in GitHub Actions on every push — see
`.github/workflows/ci.yml`.

Two html-validate rules are switched off deliberately in `.htmlvalidate.js`, each
with its reason written in that file. Apart from those two, the whole
`recommended` preset is enforced.

## Licence

Not open source. Readable for evaluation; copying, modification, re-branding or
redistribution is not permitted. See [LICENSE](LICENSE).
