# IanthoSim

**Simulasi Persepsi Visual Ianthinopsia**

Alat interaktif berbasis web untuk mensimulasikan bagaimana dunia terlihat bagi penyandang ianthinopsia — salah satu bentuk chromatopsia di mana persepsi visual didominasi oleh warna violet/ungu.

> **Disclaimer:** IanthoSim adalah alat simulasi visual untuk keperluan empati dan edukasi. Ini BUKAN simulasi klinis yang presisi dan tidak merepresentasikan pengalaman medis aktual setiap individu secara akurat.

---

## Latar Belakang Medis

### Chromatopsia vs Dyschromatopsia

Dua kondisi ini sering disalahpahami:

| Kondisi | Definisi | Efek |
|---|---|---|
| **Chromatopsia** | Persepsi warna terdominasi satu warna | Dunia tampak "terselimuti" warna tertentu |
| **Dyschromatopsia** | Kemampuan membedakan warna terganggu | Sulit membedakan antar warna |

IanthoSim mensimulasikan **chromatopsia**, bukan dyschromatopsia.

### Ianthinopsia

Ianthinopsia (dari Yunani: *ianthinos* = violet) adalah bentuk chromatopsia dengan dominasi warna violet/ungu. Kondisi ini tergolong **acquired chromatopsia** — muncul setelah seseorang sebelumnya memiliki penglihatan warna normal.

**Penyebab yang diketahui dapat berkaitan:**
- Optic neuritis (radang saraf optik)
- Optic neuropathy (kerusakan saraf optik)
- Glaukoma stadium lanjut
- Beberapa penyakit makula

Gangguan terjadi pada **jalur visual** — bukan pada mata itu sendiri — sehingga seluruh medan penglihatan tampak terpengaruh.

---

## Algoritma

### Mengapa HSV, bukan RGB atau HSL?

| Ruang Warna | Kelebihan | Kelemahan untuk kasus ini |
|---|---|---|
| RGB | Langsung dari pixel | Sulit memanipulasi hue tanpa merusak brightness |
| HSL | Standar CSS | L (lightness) bergantung pada S, kompleks untuk transformasi |
| **HSV** | Memisahkan Value (brightness) dan Saturation secara independen | — |

HSV dipilih karena komponen **V (Value/brightness)** dan **H (Hue)** benar-benar independen. Kita bisa mengubah hue tanpa menyentuh brightness sama sekali, sehingga detail, tekstur, dan kontras gambar asli tetap terjaga.

---

### Alur Algoritma (per pixel)

```
Pixel RGBA (uint8)
    |
    | [1] Normalisasi
    v
r, g, b ∈ [0.0, 1.0]
    |
    | [2] RGB -> HSV
    v
{ H ∈ [0, 360), S ∈ [0, 1], V ∈ [0, 1] }
    |
    | [3] Hue Mapping (Circular Attraction)
    v
H_new = mapHue(H, targetHue, strength)
    |
    | [4] Scale Saturation & Brightness
    v
S_new = clamp(S * satMul, 0, 1)
V_new = clamp(V * briMul, 0, 1)
    |
    | [5] HSV -> RGB
    v
{ r', g', b' } ∈ [0.0, 1.0]
    |
    | [6] Denormalisasi + clamp
    v
Pixel RGBA output (uint8)
```

---

### Rumus RGB -> HSV

```
Input: R, G, B ∈ [0, 1]

Cmax = max(R, G, B)
Cmin = min(R, G, B)
Delta = Cmax - Cmin

Hue (H):
  Jika Delta = 0    ->  H = 0
  Jika Cmax = R     ->  H = 60 * ((G - B) / Delta mod 6)
  Jika Cmax = G     ->  H = 60 * ((B - R) / Delta + 2)
  Jika Cmax = B     ->  H = 60 * ((R - G) / Delta + 4)
  Jika H < 0        ->  H = H + 360

Saturation (S):
  Jika Cmax = 0  ->  S = 0
  Lainnya        ->  S = Delta / Cmax

Value (V):
  V = Cmax
```

---

### Rumus HSV -> RGB

```
Input: H ∈ [0, 360), S ∈ [0, 1], V ∈ [0, 1]

C = V * S                          (chroma)
X = C * (1 - |((H / 60) mod 2) - 1|)
m = V - C

(R', G', B') berdasarkan sektor H:
  H ∈ [  0,  60)  ->  (C, X, 0)
  H ∈ [ 60, 120)  ->  (X, C, 0)
  H ∈ [120, 180)  ->  (0, C, X)
  H ∈ [180, 240)  ->  (0, X, C)
  H ∈ [240, 300)  ->  (X, 0, C)
  H ∈ [300, 360)  ->  (C, 0, X)

(R, G, B) = (R' + m, G' + m, B' + m)
```

---

### Hue Mapping: Circular Attraction

Ini adalah inti inovasi algoritma IanthoSim. Pendekatan naive (misalnya `H_new = targetHue`) akan menghasilkan gambar monokrom — semua warna menjadi satu hue yang sama, detail hilang.

**Algoritma Circular Attraction** menggunakan pendekatan berbeda:

```
1. Hitung jarak angular (signed) ke target:
   diff = angularDiff(H, targetHue)
   
   angularDiff menggunakan "shortest path" pada lingkaran warna:
   diff ∈ [-180, 180]
   (negatif = putar kiri, positif = putar kanan)

2. Hitung quadratic falloff:
   falloff = (1 - |diff| / 180)^2

   Efek falloff:
   - diff = 0   (sudah di target)  ->  falloff = 1.0  (tarik penuh)
   - diff = 90  (90 derajat jauh)  ->  falloff = 0.25
   - diff = 180 (berlawanan total) ->  falloff = 0.0  (tidak ditarik)

3. Hitung hue baru:
   H_new = H + strength * diff * falloff
```

**Mengapa quadratic, bukan linear?**

Falloff linear `(1 - |diff|/180)` masih terlalu agresif — warna merah (180° dari violet) akan ditarik kuat. Quadratic membuat kurva drop-off lebih tajam, sehingga warna yang sudah "jauh" dari violet tetap mempertahankan sebagian besar identitasnya. Efek visualnya: gambar terasa "dominan violet" tapi tidak kehilangan konteks warna sama sekali — persis seperti deskripsi chromatopsia klinis.

**Kontrol:**
- `strength = 0.0`  ->  tidak ada perubahan hue (original)
- `strength = 0.85` ->  dominasi violet kuat, identitas warna lain masih ada
- `strength = 1.0`  ->  attraki maksimum

---

### Kompleksitas

| Aspek | Nilai |
|---|---|
| **Waktu** | O(N), N = jumlah pixel |
| **Ruang** | O(N) — satu salinan ImageData untuk output |
| **Per pixel** | Konstan: 2 konversi HSV + 1 mapping + beberapa aritmatika |

Untuk gambar 1920x1080 (2.073.600 pixel), proses berjalan dalam ~200–500ms di browser modern menggunakan chunked loop dengan `requestAnimationFrame` agar UI tetap responsif.

---

## Struktur File

```
web-violet/
  index.html   — markup HTML, canvas, kontrol UI
  style.css    — dark theme, aksen violet, responsif
  script.js    — algoritma pixel, split-view, download
  README.md    — dokumentasi ini
  vercel.json  — konfigurasi deployment Vercel
```

---

## Cara Menjalankan

### Lokal (tanpa server)

Cukup buka `index.html` di browser modern (Chrome, Firefox, Edge, Safari).

```
Klik dua kali -> index.html
```

### Deploy ke Vercel

1. Push folder `web-violet` ke repository GitHub
2. Import di [vercel.com](https://vercel.com)
3. Framework: **Other** (static site)
4. Root directory: `web-violet` (atau root jika sudah di root repo)
5. Deploy — selesai, tidak ada build step

---

## Mode Pemrosesan: Encode (Simulasi) vs Decode (Restorasi Invers)

Aplikasi menyediakan dua mode operasi:

1. **Mode Encode (Simulasi Ianthinopsia)**:
   - **Input**: Gambar normal / berwarna.
   - **Proses**: Mengompresi / menarik *Hue* warna asli ke arah target violet ($270^\circ$).
   - **Output**: Gambar simulasi penglihatan ianthinopsia.

2. **Mode Decode (Restorasi Warna / Invers)**:
   - **Input**: Gambar hasil simulasi (yang didominasi warna violet).
   - **Proses**: Menguraikan (*expands*) kembali *Hue* yang terkompresi dari violet menuju spektrum warna aslinya (*Inverse Hue Mapping*).
   - **Output**: Gambar warna asli yang dipulihkan (*reconstructed original*).

---

### Rumus Mathematis Invers (Decode)

Jika proses Encode menarik Hue dengan rumus:
$$H_{\text{encoded}} = H + \text{blend} \times \text{angularDiff}(H, H_{\text{target}})$$

Maka rekonstruksi warna asli pada proses Decode dihitung dengan persamaan pemulihan simetris:
$$H_{\text{restored}} = H_{\text{target}} + \frac{\text{angularDiff}(H_{\text{target}}, H_{\text{encoded}})}{1 - \text{blend}}$$

*Catatan: $\text{blend} = \text{strength} \times 0.75$.*

---

## Perbandingan Split-View Real

Split-view menggunakan kombinasi dua layer kanvas dengan **Offscreen Canvas & Context Clipping**:
- **Kanvas Kiri (Original / Input)**: Menampilkan gambar asli.
- **Kanvas Kanan (Hasil Filter)**: Digambar melalui *offscreen canvas* menggunakan `ctx.clip()`, dipotong secara presisi di posisi garis perbandingan (*divider*).
- Slider dapat digeser secara riil untuk membandingkan perbedaan *before-and-after* secara simultan.

---

## Cara Menggunakan

1. **Pilih Mode**:
   - Klik **ENCODE** untuk mensimulasikan gambar normal menjadi violet.
   - Klik **DECODE** untuk memulihkan gambar violet kembali ke warna asli.
2. **Upload Gambar** — Drag & drop atau klik "Pilih File".
3. **Split-View Slider** — Drag garis tengah untuk membandingkan *input vs output* secara langsung.
4. **Alur Langsung (Shortcut)**: Setelah memproses gambar di Mode Encode, klik tombol **"🔄 Gunakan Hasil Ini untuk Dekode (Invers)"** untuk langsung menguji fungsi pemulihan warna.
5. **Download PNG** untuk menyimpan hasil akhir.

---

## Teknologi

- HTML5 Canvas API (`ImageData`, `drawImage`, `offscreen canvas`, `ctx.clip()`)
- Vanilla JavaScript ES6+
- CSS3 (dark theme, CSS custom properties)
- Tanpa library eksternal
- Tanpa backend
- Pemrosesan pixel dilakukan 100% lokal di browser

---

*IanthoSim — dibuat untuk empati, pemahaman visual, dan eksplorasi matematika warna.*