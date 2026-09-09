# CV Online — Bias Satrio Putra

[![CI](https://github.com/biassp/biassp.github.io/actions/workflows/ci.yml/badge.svg)](https://github.com/biassp/biassp.github.io/actions/workflows/ci.yml)

https://biassp.github.io/

CV dan portofolio statis. Tidak ada framework, tidak ada langkah build, tidak ada
dependensi runtime — HTML, CSS dan JavaScript biasa yang disajikan langsung dari
branch `master` oleh GitHub Pages.

| | |
|---|---|
| `index.html` | CV-nya sendiri, satu berkas, termasuk feed live repositori GitHub |
| `labs/` | Tujuh aplikasi demo yang berjalan penuh di dalam tab, tanpa server |
| `case/` | Studi kasus BioAge, Radar Duit dan RepBout |
| `test/` | Pengujian. Tidak ikut disajikan ke pengunjung. |

## Menjalankan pengujian

Semua yang ada di `devDependencies` hanya untuk menguji; situsnya sendiri tidak
memuat satu pun dari mereka.

```bash
npm ci
npx playwright install chromium
npm test
```

| Perintah | Yang diperiksa |
|---|---|
| `npm run test:syntax` | `node --check` atas seluruh berkas `.js`, ditambah blok `<script>` inline `index.html` yang digabung sesuai urutan dokumen |
| `npm run test:markup` | parse5, validator W3C (Nu), dan html-validate atas 12 berkas HTML |
| `npm run test:links` | Setiap `href`/`src` relatif menunjuk ke berkas yang ada, setiap `#fragment` punya elemennya |
| `npm run test:repos` | 14 uji jsdom atas feed repositori GitHub, termasuk jalur fallback saat API membalas 403 |
| `npm run test:labs` | 3.659 asersi milik enam lab, dijalankan di Chromium sungguhan terhadap halaman aslinya |

Kelimanya berjalan otomatis di GitHub Actions pada setiap push — lihat
`.github/workflows/ci.yml`.

Dua aturan html-validate dimatikan dengan sengaja di `.htmlvalidate.js`, masing-masing
disertai alasannya di berkas itu. Selain kedua itu, seluruh preset `recommended`
ditegakkan.

## Lisensi

Bukan open source. Boleh dibaca untuk keperluan penilaian; menyalin, memodifikasi,
mengganti merek atau mendistribusikan ulang tidak diizinkan. Lihat [LICENSE](LICENSE).
