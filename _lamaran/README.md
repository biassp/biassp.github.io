# Tracker lamaran

Catatan lamaran kerja. Bukan bagian dari situs, tidak pernah disajikan ke
pengunjung, dan sebagian isinya sengaja tidak pernah sampai ke GitHub.

## Kenapa dipisah begini

Repositori ini publik — `biassp/biassp.github.io` adalah user site GitHub Pages,
dan isinya bisa dibaca siapa saja, termasuk perekrut dari perusahaan yang sedang
kamu lamar. Daftar lamaran memuat hal yang tidak boleh terbaca mereka: perusahaan
lain yang kamu incar, lamaran yang ditolak, ekspektasi gaji, nama dan kontak orang
HR. Karena itu ada dua berkas dengan nasib berbeda:

| | |
|---|---|
| `TEMPLATE.md` | Kerangka kosong beserta legenda status. Di-commit — tidak memuat data apa pun |
| `lamaran.md` | Catatan sebenarnya. Masuk `.gitignore`, jadi tetap di komputermu dan tidak pernah ter-*push* |

Nama direktorinya diawali garis bawah karena GitHub Pages menjalankan Jekyll, dan
Jekyll tidak menyalin direktori berawalan `_` ke situs hasil build. Jadi kalaupun
ada berkas di sini yang ter-commit, ia tidak akan muncul sebagai halaman di
`biassp.github.io`. Itu lapis kedua, bukan yang utama — yang menjaga data asli
tetap privat adalah `.gitignore`.

## Mulai memakai

```bash
cp _lamaran/TEMPLATE.md _lamaran/lamaran.md
```

Lalu sunting `_lamaran/lamaran.md`. Berkas itu sudah diabaikan Git, jadi
`git status` tidak akan pernah menawarkannya untuk di-commit dan tidak ada
kecelakaan `git add .` yang bisa membocorkannya.

Konsekuensinya jujur saja: karena tidak ter-*push*, berkas itu tidak ikut
ter-*backup* dan tidak ikut berpindah kalau kamu ganti komputer. Salin sendiri ke
tempat privat — Drive, Dropbox, atau repositori privat terpisah — kalau isinya
mulai banyak.

## Aturan tindak lanjut

Kolom `Tindak lanjut` diisi tanggal, bukan perasaan. Patokan yang dipakai:

- **7 hari kerja** setelah kirim tanpa balasan sama sekali → kirim satu email
  tindak lanjut, singkat, satu paragraf.
- **7 hari kerja** setelah wawancara tanpa kabar → tanyakan lini masa keputusan.
- Tidak ada balasan setelah dua kali tindak lanjut → ubah status jadi `Hangus`
  dan berhenti. Itu jawaban, cuma tidak diucapkan.

Tindak lanjut ketiga tidak mengubah keputusan siapa pun; ia hanya memindahkan
kamu dari "pelamar" ke "gangguan". Sudahi di dua.
