<!--
  Buku — part of the biassp.github.io portfolio
  Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
  Not open source. Readable for evaluation only. See /LICENSE.
  https://biassp.github.io/
-->

# Buku — sistem informasi akuntansi berpasangan untuk UMKM

Live: **https://biassp.github.io/labs/buku/**

Sebuah sistem akuntansi *double-entry* lengkap yang berjalan seluruhnya di dalam satu tab
peramban. Bagan akun lima tipe, jurnal umum yang menolak entri tak seimbang, buku besar,
neraca saldo tiga tahap, jurnal penyesuaian, empat laporan keuangan, jurnal penutup, kunci
periode berperan, PPN masukan/keluaran, dan PPh final UMKM 0,5%.

Tanpa framework. Tanpa bundler. Tanpa dependensi. Tanpa *build step*. Tanpa satu pun
panggilan jaringan.

---

## Satu keputusan menjelaskan seluruh aplikasi ini

**Yang disimpan hanyalah entri jurnal.** Tidak ada field saldo, tidak ada neraca saldo yang
di-*cache*, tidak ada total yang diperbarui saat posting. Setiap saldo akun, setiap kolom
neraca saldo dan setiap baris laporan keuangan adalah **fungsi dari postingnya**, dihitung
saat diminta, setiap kali.

Itu invarian I7, dan itu sebabnya enam invarian lainnya bisa dipercaya: tidak ada salinan
kedua dari kebenaran yang bisa menyimpang dari yang pertama. Konsekuensinya nyata sampai ke
lapisan penyimpanan — `store.js` tidak punya skema yang *bisa* memuat neraca saldo basi,
karena tidak ada field untuk itu.

---

## Yang nyata dan yang disimulasikan

### Nyata

- **Aritmetika berpasangannya.** Setiap identitas di halaman ini benar-benar dihitung, dan
  setiap penolakan benar-benar menolak. Tidak ada angka penyeimbang di mana pun kecuali satu
  yang disebut secara eksplisit (lihat "Satu-satunya angka penyeimbang" di bawah).
- **Bentuk laporannya.** Mengikuti SAK EMKM untuk laporan yang diwajibkan; lihat bagian
  standar di bawah untuk apa yang ditambahkan di luar itu dan mengapa.
- **Perlakuan pajaknya.** PPN masukan sebagai aset dan PPN keluaran sebagai liabilitas, tidak
  pernah dijaringkan di buku besar. PPh final UMKM 0,5% dari peredaran bruto per masa,
  PP 55/2022, dibebankan sebagai beban pajak tersendiri di bawah laba sebelum pajak — bukan
  sebagai PPh badan atas laba.
- **Jadwal penyusutannya.** Garis lurus, per bulan, berjumlah tepat harga perolehan minus
  nilai residu, dengan sisa pembagian dibagikan satu rupiah per bulan.
- **Pemisahan perannya.** Staf tidak bisa memposting; akuntan tidak bisa menutup buku maupun
  membuka periode; hanya supervisor yang bisa. Ditegakkan di mesinnya, bukan dengan
  menyembunyikan tombol.
- **Klaim "tidak ada egress"-nya.** CSP `connect-src 'none'` di sumber halaman ini sendiri,
  ditambah pencacah di `guard.js` yang membungkus `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource` dan `sendBeacon`. Angkanya ada di header. DevTools → Network akan tetap kosong.

### Fabrikasi — seluruhnya

- **Entitasnya.** *UD Sinar Kalibata* tidak ada.
- **NPWP-nya** berawalan `99`, blok kategori yang tidak pernah diterbitkan DJP. Nomor itu
  tidak bisa menunjuk wajib pajak mana pun.
- **Nomor rekeningnya** ada di rentang `0000`, yang tidak bisa dituju.
- **Setiap rupiah.** Seluruh 476 entri jurnal dibangun dari satu bilangan seed (`8613537`,
  mulberry32) setiap kali halaman dimuat. Tidak ada pelanggan, supplier, harga, marjin atau
  syarat pembayaran yang nyata.
- Tidak ada laporan keuangan nyata milik siapa pun yang pernah menyentuh berkas ini.

---

## Standar yang diikuti

**SAK EMKM** — Standar Akuntansi Keuangan Entitas Mikro, Kecil dan Menengah, berlaku efektif
1 Januari 2018.

SAK EMKM mewajibkan **tiga** laporan bagi entitas mikro:

1. Laporan Posisi Keuangan (Neraca) — **disajikan**
2. Laporan Laba Rugi — **disajikan**
3. Catatan atas Laporan Keuangan — *tidak disajikan sebagai laporan formal; catatan yang
   relevan ditulis langsung di panelnya*

SAK EMKM **tidak** mewajibkan Laporan Arus Kas maupun Laporan Perubahan Ekuitas. Keduanya
tetap disajikan di sini, dalam bentuk yang dipakai SAK ETAP, karena keduanya justru yang
membuktikan bahwa laba dan kasnya menyatu — dan itu yang sedang diperlihatkan halaman ini.
Ini disebut apa adanya di UI, bukan diklaim sebagai kewajiban SAK EMKM.

Penyusutan memakai metode garis lurus. Persediaan memakai sistem perpetual: setiap penjualan
memunculkan entri HPP tersendiri yang mengkredit persediaan.

### Bagian lancar utang jangka panjang

Liabilitas yang diperkirakan diselesaikan **dalam dua belas bulan sejak tanggal pelaporan**
adalah liabilitas jangka pendek. Itu terdengar seperti detail penyajian sampai seseorang
melihat angkanya: pinjaman bank di buku ini diangsur Rp 5.000.000 sebulan tanpa jeda, dan pada
31 Desember 2025 sisanya Rp 60.000.000 — tepat dua belas angsuran lagi, jadi **seluruhnya**
jatuh tempo dalam dua belas bulan. Menyajikan seluruhnya sebagai liabilitas jangka panjang
membuat liabilitas jangka pendek kurang saji Rp 60.000.000 dan modal kerja lebih saji sebesar
itu juga (*current ratio* 4,38 alih-alih 3,55).

Yang membuat kesalahan seperti ini bertahan adalah bahwa **tidak ada total yang bergeser** —
persamaan akuntansi tidak peduli subtotal mana yang memuat sebuah liabilitas, dan pembaca
neraca hampir tidak peduli apa pun selain itu. Jadi bagan akun di sini punya **dua** akun untuk
satu pinjaman:

| | | |
|---|---|---|
| `2106` | Bagian Lancar Utang Bank Jangka Panjang | lancar, arus `F` |
| `2201` | Utang Bank Jangka Panjang | tidak lancar, arus `F` |

Angsuran bulanan mendebet **2106**, bukan 2201 — jadi klasifikasinya benar sepanjang tahun,
bukan hanya pada 31 Desember. Neraca pembuka pun sudah terbagi di sana: Rp 120.000.000 pokok
pada 31 Desember 2024 terdiri dari Rp 60.000.000 yang jatuh tempo selama 2025 dan
Rp 60.000.000 sisanya. Selisih akhir tahun ditawarkan sebagai jurnal penyesuaian
`JP-REKLASPINJAMAN`, dihitung dari register pinjaman dan saldo buku besar pada tanggal
laporan — `min(sisa pokok; 12 × angsuran) − saldo 2106` — sehingga ia idempoten dengan
sendirinya: posting sekali dan selisihnya nol. Karena kedua akunnya berklasifikasi arus
pendanaan, entri itu netral di laporan arus kas; yang berubah hanya penyajian di neraca, dan
itulah yang memang salah sebelumnya.

---

## Tujuh invarian, dan bagaimana masing-masing ditegakkan

Setiap invarian punya **dua** penegakan: satu di jalur tulis (menolak), satu di pemeriksa
(mengukur). Pemeriksa menghitung ulang dari `buku.entries` mentah dan tidak berbagi *cache*
apa pun dengan laporan yang diperiksanya.

| | Invarian | Ditegakkan di | Diuji di |
|---|---|---|---|
| **I1** | Setiap entri seimbang | `L.periksaEntri()` → `L.tambah()` melempar, dengan selisih disebut ke rupiah dan sisi mana yang kurang | 7 pemeriksaan buku hidup + 33 assertion |
| **I2** | Neraca saldo seimbang | Tidak ditegakkan — **diukur**. Kedua kolom dijumlah dari posting mentah di tiga tahap | 3 pemeriksaan (satu per tahap) + 44 assertion |
| **I3** | Aset = Liabilitas + Ekuitas, **di setiap tanggal** | Konsekuensi dari I1; diverifikasi terpisah dengan menelusuri buku tanggal demi tanggal | 2 pemeriksaan (222 tanggal) + 40 assertion |
| **I4** | Laba bersih menyatu di tiga laporan | Dihitung **sekali** oleh `L.labaRugi()`; laporan lain memakai angka itu, tidak menghitungnya ulang | 5 pemeriksaan + 65 assertion |
| **I5** | Jurnal penutup menihilkan akun nominal | `L.rencanaPenutup()` dibangun dari saldo hidup → idempoten | 7 pemeriksaan + 57 assertion |
| **I6** | Arus kas rekonsiliasi | Identitas aljabar, bukan angka penyeimbang — lihat di bawah | 8 pemeriksaan + 75 assertion |
| **I7** | Saldo diturunkan, tidak pernah disimpan | Tidak ada field saldo di mana pun; dua jalur hitung dibandingkan | 3 pemeriksaan + 25 assertion |

Header menampilkan **`buku hidup: 35/35 invarian`** — ke-35 pemeriksaan itu, dihitung ulang
dari jurnal mentah setelah setiap mutasi, termasuk entri yang baru Anda posting sendiri.
Badge di sebelahnya, `uji`, adalah hal yang berbeda: 1.274 assertion atas buku yang dibangun
ulang dari seed. Suite yang membangun bukunya sendiri **tidak bisa melihat** buku hidup yang
rusak; itulah cara sebuah badge hijau bisa duduk di atas neraca yang tidak seimbang.

### I6 secara khusus: mengapa rekonsiliasinya tidak bisa ditambal

Ini tempat demo biasanya curang, jadi ini yang dilakukan di sini.

Setiap entri seimbang, jadi di seluruh himpunan **entri utuh**, Σ(debit − kredit) atas *semua*
akun tepat nol. Pisahkan akun kas dari yang bukan, lalu pindahkan ruas:

```
Δkas  =  −Σ (debit − kredit) atas seluruh akun non-kas
```

**tanpa suku sisa.** Setiap akun non-kas di bagan wajib punya tepat satu klasifikasi
`O`/`I`/`F` — akun tanpa klasifikasi membuat `arusKas()` melempar, bukan diam-diam hilang
dari laporan. Maka ketiga subtotal itu *wajib* berjumlah Δkas. Kelompokkan bucket operasi
menjadi nominal, penyusutan dan modal kerja, dan metode tidak langsungnya keluar dari
aljabar itu sendiri:

```
operasi = laba neto + penyusutan + Σ (kredit − debit) modal kerja
```

Rekonsiliasi terhadap buku besar karenanya jadi pemeriksaan yang **sungguh-sungguh**, bukan
tautologi: sisi kanan (`L.saldoKas()`) menjumlah posting akun kas lewat jalur yang tidak
menyentuh satu pun angka di laporan. Selisihnya dicetak di layar **entah nol atau tidak** —
nol yang bisa dilihat lebih berharga daripada nol yang harus diandaikan.

Jurnal penutup dikecualikan dari laporan arus kas. Ia tidak pernah menyentuh kas (itu
diperiksa sebagai invarian tersendiri, dan bisa merah), jadi mengecualikannya tidak mengganggu
identitas di atas. Kalau ikut dihitung, **seluruh laba tahun ini akan salah masuk ke aktivitas
pendanaan**, karena jurnal penutup mendebit pendapatan (operasi) dan mengkredit Saldo Laba
(pendanaan). Suite membuktikan laporannya identik sebelum dan sesudah penutupan.

---

## Angka buku demo, supaya bisa dicek

Seed `8613537`. Angka-angka ini muncul persis sama di layar setiap kali halaman dimuat.

### Sebelum penyesuaian — keadaan buku yang di-*seed*

```
Entri jurnal                        476   (1.182 baris)
Peredaran bruto            Rp 2.970.050.000
Harga pokok penjualan      Rp 2.030.303.445
Laba bruto                 Rp   939.746.555
Beban usaha                Rp   399.208.000
Bagian bruto yang tidak
  dikenai PPh (orang pribadi) Rp   500.000.000   PP 55/2022 Pasal 60 ayat (2)
Dasar kena PPh final       Rp 2.470.050.000
PPh final UMKM 0,5%        Rp    12.350.250
LABA NETO                  Rp   529.411.305

Jumlah aset                Rp 1.468.394.024
Jumlah liabilitas          Rp   293.132.725
Jumlah ekuitas             Rp 1.175.261.299   (293.132.725 + 1.175.261.299 = 1.468.394.024 ✓)

Neraca saldo (3 tahap)     Rp 4.087.505.725   debit = kredit
```

### Setelah enam jurnal penyesuaian diposting

```
Penyusutan aset tetap                Rp  51.500.004
Beban dibayar di muka terpakai       Rp  22.000.000
Pendapatan diterima di muka diakui   Rp   8.000.000
Beban yang masih harus dibayar       Rp  33.102.000
Reklasifikasi bagian lancar pinjaman Rp  60.000.000
PPh final atas selisih dasar         Rp      40.000
                                     ─────────────
Total debit jurnal penyesuaian       Rp 174.642.004

LABA NETO                  Rp   430.769.301   (turun Rp 98.642.004)
Jumlah aset                Rp 1.394.894.020
Jumlah liabilitas          Rp   318.274.725   (seluruhnya jangka pendek)
Jumlah ekuitas             Rp 1.076.619.295   ✓

Neraca saldo sebelum       Rp 4.087.505.725
Neraca saldo setelah       Rp 4.172.147.729   (naik Rp 84.642.004)
```

Perhatikan bahwa total neraca saldo naik **Rp 84.642.004**, bukan Rp 174.642.004. Selisih
Rp 90.000.000-nya adalah beban dibayar di muka (22 juta), pendapatan diterima di muka
(8 juta) dan reklasifikasi bagian lancar pinjaman (60 juta): ketiganya memposting **melawan
saldo yang sudah ada**, jadi satu kolom mengecil sebanyak kolom lain membesar dan totalnya
tidak bergerak. Yang terakhir bahkan menukar satu saldo kredit dengan saldo kredit lain —
2201 turun ke nol dan 2106 menerima angka yang sama — sehingga yang berubah hanya
**subtotal neraca mana** yang memuatnya, dan itulah tepatnya cacat yang diperbaikinya. Mengira total neraca saldo naik
sebesar total jurnal penyesuaian adalah kekeliruan yang cukup umum untuk ditulis di sini —
dan suite menguji angka yang benar, bukan yang intuitif.

### Laporan arus kas — sebelum dan sesudah penyesuaian, identik

```
Kas awal (1 Jan 2025)             Rp  210.000.000
Arus kas operasi                  Rp  483.182.705
Arus kas investasi                Rp  (48.000.000)
Arus kas pendanaan                Rp  (60.000.000)
                                  ────────────────
Kas akhir menurut laporan         Rp  585.182.705
Kas akhir menurut buku besar      Rp  585.182.705
SELISIH                           Rp            0
```

Jurnal penyesuaian tidak mengubah kas sama sekali (tidak satu pun menyentuh akun kas) dan
tidak mengubah arus kas operasi: laba turun Rp 98.642.004, sementara penyesuaian non-kas naik
Rp 51.500.004 dan modal kerja naik Rp 47.142.000 — jumlahnya persis sama. Reklasifikasi bagian
lancar pinjaman juga tidak menggerakkannya sepeser pun: 2201 dan 2106 sama-sama berklasifikasi
arus pendanaan, jadi entri itu netral di dalam *bucket*-nya.

### Setelah jurnal penutup

```
4 entri penutup. Laba Rp 430.769.301 → 3201 Saldo Laba.

Saldo Laba awal (dari seed)   Rp 245.849.994
+ laba tahun berjalan         Rp 430.769.301
− prive setahun               Rp 100.000.000
                              ───────────────
Saldo Laba akhir              Rp 576.619.295   ✓

Jumlah aset       Rp 1.394.894.020  →  Rp 1.394.894.020   tidak bergerak
Jumlah ekuitas    Rp 1.076.619.295  →  Rp 1.076.619.295   tidak bergerak
Akun nominal bersaldo setelah penutupan:  0 dari 13
Neraca saldo setelah penutupan            Rp 1.523.644.030   debit = kredit
```

### Jadwal penyusutan

| Aset | Harga perolehan | Residu | Umur | Mulai | Akum. awal | 2025 | Jadwal total |
|---|---|---|---|---|---|---|---|
| AT-01 Peralatan toko | 96.000.000 | 6.000.000 | 60 bln | 2023-01 | 36.000.000 | 18.000.000 | 90.000.000 |
| AT-02 Kendaraan | 245.000.000 | 25.000.000 | 96 bln | 2023-07 | 41.250.006 | 27.500.004 | 220.000.000 |
| AT-03 Peralatan tambahan | 48.000.000 | 3.000.000 | 60 bln | 2025-05 | 0 | 6.000.000 | 45.000.000 |

Perhatikan AT-02: dasar penyusutannya Rp 220.000.000 dan 220.000.000 ÷ 96 **tidak bulat**.
Versi naif — bulatkan sekali lalu ulangi 96 kali — meleset sampai 96 rupiah di akhir umur dan
meninggalkan aset yang sudah habis disusutkan dengan nilai buku Rp 7. Di sini `D.alokasi()`
membagikan sisanya: 64 dari 96 bulan menerima satu rupiah tambahan, angsuran terkecil
Rp 2.291.666 dan terbesar Rp 2.291.667, dan jadwalnya tutup **persis** di Rp 220.000.000
dengan nilai buku akhir persis Rp 25.000.000.

**Akumulasi penyusutan pembuka diturunkan, bukan diketik.** Angka Rp 36.000.000 dan
Rp 41.250.006 di neraca pembuka datang dari `D.akumSampai(jadwal, '2024-12')` — jadwal yang
sama yang dipakai jurnal penyesuaian. Diisi tangan, catatan aset tetapnya akan berhenti cocok
dengan neracanya di tahun kedua, dan itu jenis kesalahan yang lolos dari demo tapi tidak dari
audit.

### Satu-satunya angka penyeimbang

Saldo Laba pembuka, **Rp 245.849.994**, dihitung sebagai penyeimbang neraca pembuka:

```
total debit pembuka − akumulasi penyusutan − utang usaha − utang bank − modal disetor
```

Ia ada **hanya** di entri saldo awal per 31 Desember 2024, dan ia dihitung, bukan ditebak,
sehingga entri pembukanya seimbang secara aritmetika. Setiap entri berikutnya seimbang atas
kekuatannya sendiri.

---

## Pajak Indonesia

### PPN

Tarif efektif yang dipakai **11%**. Untuk 2025 tarif nominalnya 12%, tetapi dikenakan atas DPP
nilai lain sebesar 11/12 harga jual (PMK 131/2024), yang secara aritmetika sama dengan 11% —
dan itu sebabnya setiap toko di Indonesia tetap mencetak 11%. `domain.js` memuat kedua bentuk
dan suite membandingkannya; kalau pembulatan berantainya berbeda satu rupiah, angka faktur
satu-langkah yang menang.

- **1501 PPN Masukan** adalah **aset** — pajak yang sudah dibayar dan bisa dikreditkan.
- **2104 PPN Keluaran** adalah **liabilitas** — pajak yang dipungut dan terutang.

Keduanya **tidak pernah dijaringkan di buku besar.** Yang dijaringkan adalah *posisi* untuk
suatu masa, dan tanda dari posisi itulah yang membedakan kurang bayar dari lebih bayar yang
dikompensasikan ke masa berikutnya. Buku demo memposting penyetoran/kompensasi PPN setiap
masa dengan membaca saldo hidup kedua akun itu, bukan dengan mengasumsikan berapa seharusnya.

Uang muka kontrak jasa memunculkan PPN keluaran **saat pembayaran diterima**, bukan saat
pekerjaannya selesai — itu saat terutangnya PPN atas pembayaran di muka. Karena itu jurnal
penyesuaian pendapatan diterima di muka memindahkan pendapatannya saja dan **tidak** memindah
PPN-nya.

### PPh final UMKM 0,5%

**PP 55/2022.** 0,5% dari **peredaran bruto** per masa, **final**. Bukan PPh badan atas laba:
bulan yang merugi pun tetap terutang, dan besarnya tidak berubah kalau bebannya berubah. Itu
sebabnya jurnal penyesuaian menurunkan laba Rp 98,6 juta tanpa menurunkan pajak ini
sepeser pun — yang berubah hanya ketika peredaran brutonya sendiri berubah.

**Rp 500.000.000 pertama tidak dikenai PPh.** Pasal 60 ayat (2) peraturan yang sama: bagi
wajib pajak **orang pribadi** pada rezim 0,5%, peredaran bruto Rp 500 juta pertama dalam satu
tahun pajak bukan objek PPh. Bukan pilihan dan bukan pengurang pajak — sepotong dasar
pengenaan yang tidak pernah masuk hitungan, dipakai **kumulatif** oleh masa-masa paling awal,
dan berulang setiap tahun pajak. UD Sinar Kalibata adalah usaha dagang perorangan bermilik
tunggal, jadi pembebasan ini berlaku dan wajib: pada buku demo ia habis di bulan Februari,
sehingga masa Januari nihil dan masa Februari hanya dikenai atas bagian yang melewati batas.
Tab Pajak menampilkan kolom kumulatif, kolom bebas dan kolom dasar kena berdampingan, jadi
angka Rp 12.350.250 setahun bisa ditelusuri masa demi masa. Sebuah **badan** (PT atau CV)
tidak mendapat pembebasan ini; `L.pphFinalBulanan(buku, tahun, { bebas: 0 })` menghitung kasus
itu dan suite menegaskan bedanya tepat Rp 2.500.000.

Disajikan pada barisnya sendiri di bawah laba sebelum pajak, dengan label yang menyebut
tarifnya dan dasar hukumnya. Tidak pernah dicampur ke beban usaha.

### Mengapa entitas ini sekaligus PKP dan pemakai rezim final

Batas rezim final PPh (PP 55/2022) dan batas wajib PKP (PMK 197/2013) sama-sama Rp 4,8 miliar.
Peredaran bruto entitas ini Rp 2,98 miliar — di bawah keduanya. Jadi rezim 0,5% berlaku, dan
pengukuhan PKP **tidak wajib** — tetapi boleh atas permintaan sendiri, dan banyak UMKM memilih
itu karena pembeli korporatnya minta faktur pajak. Hasilnya kombinasi yang di atas kertas
terlihat aneh dan di lapangan biasa: PPh final 0,5%, sekaligus wajib memungut PPN.

### Satu keberatan yang jujur untuk disebut

Jurnal penyesuaian pendapatan diterima di muka menambah peredaran bruto **akuntansi** sebesar
Rp 8.000.000 pada 31 Desember, jadi 0,5%-nya (Rp 40.000) baru dibebankan lewat penyesuaian
`JP-PPHFINAL`. Ada argumen yang sama kuatnya bahwa 0,5% atas uang muka itu sudah terutang di
masa November, saat uangnya diterima, karena rezim final dijalankan atas penerimaan bruto
bulanan. Halaman ini mengambil pandangan peredaran-bruto-akuntansi dan **menyebut angka
keduanya** di tab Pajak, alih-alih memilih salah satu tanpa bilang.

---

## Peran

| Peran | Boleh |
|---|---|
| **Staf** | Menyusun draf jurnal. Draf **tidak masuk buku** — tidak punya nomor dokumen, tidak muncul di buku besar, tidak menyentuh neraca saldo, tidak mengubah satu pun angka laporan. |
| **Akuntan** | Memposting jurnal umum, penyesuaian, pembalik dan koreksi. **Tidak** boleh menutup buku maupun membuka periode terkunci. |
| **Supervisor** | Semua kewenangan akuntan, ditambah jurnal penutup, mengunci periode, dan **satu-satunya** yang boleh membuka periode terkunci. |

Ditegakkan di `L.periksaEntri()`, `L.tutupPeriode()`, `L.bukaPeriode()`, `L.pembalik()` dan
`L.koreksi()` — bukan dengan menyembunyikan tombol. Formulirnya tetap ditampilkan penuh dengan
alasan penolakan di sebelahnya, karena aturan yang tidak bisa dilihat tidak bisa dikerjakan;
orang hanya akan mencari login yang berfungsi.

---

## Append-only: tidak ada tombol hapus, tidak ada tombol ubah

Yang ada adalah **jurnal pembalik** dan **jurnal koreksi**, dan keduanya *menambah* dokumen.

Sebuah koreksi meninggalkan **tiga** dokumen: entri asli apa adanya, satu pembalik yang
menghapus pengaruhnya, dan satu pengganti. Status "sudah dibalik" pun **diturunkan** dengan
mencari entri yang menunjuk sebuah entri — bukan dari flag yang ditempelkan padanya. Itu
bedanya jejak audit dengan cerita tentang jejak audit.

`L.koreksi()` memvalidasi **penggantinya lebih dulu**, sebelum memposting pembaliknya: koreksi
yang ditolak tidak boleh meninggalkan pembalik tanpa pengganti, karena itu akan menghapus
transaksi nyata tanpa menggantinya. Ada assertion khusus untuk itu.

Buku demo memuat satu koreksi ber-seed (tagihan listrik Agustus dicatat Rp 4.500.000 alih-alih
Rp 1.450.000, dikoreksi September) dan satu pembalik ber-seed (nota jasa ganda Oktober). Agustus
**tetap** memuat angka yang salah; koreksinya bertanggal September, dan itu memang jujur.

---

## Cara menjalankan secara lokal

Berkas statis, jadi apa pun yang menyajikan HTTP sudah cukup. `file://` **tidak** dijanjikan —
IndexedDB dan tag CSP berperilaku berbeda pada origin `null`.

```bash
git clone https://github.com/biassp/biassp.github.io
cd biassp.github.io
python3 -m http.server 9010
# lalu buka http://127.0.0.1:9010/labs/buku/
```

Menjalankan suite di bawah node, tanpa peramban:

```bash
node -e "
  global.self = global;
  ['domain','ledger','seed','sesuai','tests']
    .forEach(f => require('./labs/buku/' + f + '.js'));
  const r = global.BUKU_TESTS.run();
  console.log(r.passed + '/' + r.total + ' lulus, ' + r.failed + ' gagal');
  r.results.filter(x => !x.ok).forEach(x => console.log('FAIL', x.group, x.name, x.message));
  process.exit(r.failed);
"
```

Berkas yang sama menjalankan badge di header dan menjalankan perintah di atas.

Periksa sintaksis:

```bash
for f in labs/buku/*.js; do node --check "$f"; done
```

---

## Berkas

| Berkas | Isi |
|---|---|
| `guard.js` | Tema sebelum cat pertama, dan pencacah egress. Dimuat pertama. |
| `domain.js` | Aritmetika rupiah bilangan bulat, bagan akun, konstanta pajak, jadwal penyusutan, peran. Tidak tahu apa itu jurnal. |
| `ledger.js` | Buku, validasi entri, saldo turunan, buku besar, neraca saldo, empat laporan, jurnal penutup, kunci periode, pemeriksa invarian I1–I7. |
| `sesuai.js` | Enam rencana jurnal penyesuaian, dihitung dari register. Tidak memposting apa pun sendiri. |
| `seed.js` | Satu tahun buku dari satu bilangan seed. |
| `store.js` | IndexedDB untuk *delta* saja — entri yang Anda posting, draf, kunci periode, peran. Tidak pernah saldo. |
| `tests.js` | 1.274 assertion dalam 21 grup. Berjalan di halaman dan di bawah node. |
| `app.js` | UI. Tidak pernah menjumlah saldo dan tidak pernah memutuskan apakah sebuah entri seimbang. |
| `app.css` | Token desain bersama dengan lab-lab sebelah. Gelap secara bawaan, `html[data-theme="light"]` menimpa. |

---

## Aksesibilitas dan tampilan

- **Kontras diukur, bukan dikira.** Seluruh 23 token teks lulus AA 4,5:1 pada keempat
  permukaan (`--bg`, `--bg-soft`, `--card`, `--card-2`) di **kedua** tema. Diverifikasi lagi
  di peramban dengan mengukur 5.285 elemen teks yang benar-benar dirender per tema, di sepuluh
  tab, termasuk gradien di chip logo (gradien pun diurai dan *stop* terburuknya yang dipakai).
  Setiap token aksen didefinisikan ulang di blok terang — tidak satu pun tersisa.
- **Tanpa *horizontal scroll*.** Diuji dari 300px sampai 1280px, sepuluh tab, kedua tema,
  **dengan data** — entri terposting, draf, entri jurnal yang dibuka, jadwal 96 baris yang
  diperluas, dan neraca saldo yang menampilkan seluruh akun bagan.
- **Fokus dipertahankan lintas render.** Setiap ketikan di kolom nilai me-*render* ulang
  panelnya; fokus dan posisi karet dipulihkan lewat `data-fkey` yang stabil. Nilai di-*commit*
  pada `input`, tidak pernah pada `change`.
- Cincin fokus 2px yang nyata, navigasi tablist dengan panah, satu *live region* yang sopan,
  `prefers-reduced-motion` dihormati, tata letak cetak dengan palet kertasnya sendiri.

---

## Batasan yang diketahui

- **Satu entitas, satu tahun buku, satu mata uang.** Tidak ada mata uang asing, tidak ada
  konsolidasi, tidak ada perbandingan periode di sisi laporan.
- **Catatan atas Laporan Keuangan tidak disajikan sebagai laporan formal**, walaupun SAK EMKM
  mewajibkannya. Isinya ditulis sebagai catatan di panel masing-masing.
- **Persediaan tidak punya lapisan biaya.** HPP ditentukan saat penjualan sebagai bagian dari
  seed; tidak ada FIFO/rata-rata di sini. Itu ada di lab sebelah (`/labs/gudang/`), dan
  menduplikasinya di sini tidak akan menambah apa pun pada tujuh invarian.
- **Tidak ada penghapusan aset tetap** (penjualan atau pelepasan), jadi bagian investasi arus
  kas hanya berisi perolehan.
- **Tidak ada piutang tak tertagih**, tidak ada penyisihan, tidak ada rekonsiliasi bank.
- **Satu tab menulis.** Nomor dokumen berasal dari pencacah di dalam buku, jadi tab kedua
  hanya membaca dan mengatakannya. Muat ulang di tab yang sama mengambil kembali kuncinya
  seketika (id tab disimpan di `sessionStorage`).
- **Prive ditutup ke Saldo Laba.** Buku teks yang lain menutupnya ke Modal Pemilik; keduanya
  benar untuk usaha perorangan, dan tujuannya di sini satu konstanta di `L.rencanaPenutup()`.
- **Pembebasan PPh final Rp 500 juta dipakai tanpa syarat.** PP 55/2022 Pasal 60 ayat (2)
  memberikannya kepada wajib pajak orang pribadi, dan entitas ini orang pribadi, jadi
  `D.PPH_FINAL_BEBAS` selalu diterapkan pada buku demo. Yang **tidak** dimodelkan adalah batas
  waktu tujuh tahun pemakaian rezim final bagi orang pribadi: tidak ada tahun pertama
  pendaftaran yang disimpan di mana pun, jadi tidak ada yang bisa dihitung mundur. Kasus badan
  ada di mesinnya — `L.pphFinalBulanan(buku, tahun, { bebas: 0 })` — dan diuji, tapi tidak
  dipakai di UI.
- **Satu pinjaman di register.** Reklasifikasi bagian lancar mengasumsikan angsuran pokok
  tetap dan tenor tanpa jeda; sebuah pinjaman dengan masa tenggang, angsuran menurun atau
  denda percepatan butuh tabel amortisasi, bukan satu bilangan `angsuran`.

---

## Lisensi

Hak cipta (c) 2026 Bias Satrio Putra. Seluruh hak dilindungi.
**Bukan open source.** Boleh dibaca untuk keperluan evaluasi. Lihat [/LICENSE](../../LICENSE).
