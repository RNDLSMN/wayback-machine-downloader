# 🕰️ Wayback HTML Machine

Download halaman web dari [Wayback Machine](https://web.archive.org) secara otomatis, lengkap dengan semua aset (CSS, JS, gambar, font, video, dll).

---

## ✨ Fitur

- **Scan Otomatis** — Cari semua halaman yang tersimpan di Wayback Machine berdasarkan domain
- **Download Massal** — Download banyak halaman sekaligus dalam satu klik
- **Asset Lengkap** — Otomatis download semua aset terkait (CSS, JS, gambar, font, SVG, video, audio)
- **Link Rewriting** — Semua link di-rewrite agar bisa dibuka secara offline/lokal
- **Filter Waktu** — Filter hasil berdasarkan rentang waktu tertentu
- **Progress Real-time** — Pantau progress download secara live via Server-Sent Events (SSE)
- **Export ZIP** — Download hasil sebagai file ZIP
- **Web UI** — Interface web yang mudah digunakan, tinggal buka di browser

---

## 📋 Prasyarat

- **Node.js** versi 18 atau lebih baru (membutuhkan built-in `fetch`)
- **npm** (biasanya sudah terinstall bersama Node.js)
- **zip** command (sudah tersedia secara default di macOS dan Linux)

### Cek Versi Node.js

```bash
node -v
# Output minimal: v18.x.x
```

> [!NOTE]
> Jika belum terinstall, download Node.js dari [https://nodejs.org](https://nodejs.org) atau gunakan [nvm](https://github.com/nvm-sh/nvm):
> ```bash
> # Install nvm
> curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
>
> # Install Node.js LTS
> nvm install --lts
> ```

---

## 🚀 Instalasi

### 1. Clone atau Download Repository

```bash
# Clone repo
git clone <repository-url> wayback-html-machine
cd wayback-html-machine

# Atau jika sudah ada folder-nya
cd /path/to/wayback-html-machine
```

### 2. Install Dependencies

```bash
npm install
```

Ini akan menginstall:
| Package | Fungsi |
|---------|--------|
| `express` | Web server & API |
| `cheerio` | HTML parser untuk ekstraksi aset |

---

## ▶️ Cara Menjalankan

### Jalankan Server

```bash
npm start
```

atau

```bash
node server.js
```

### Buka di Browser

```
http://localhost:3000
```

> [!TIP]
> Server berjalan di port **3000** secara default. Hasil download akan tersimpan di folder `downloads/` di dalam direktori project.

---

## 📖 Cara Penggunaan

### Metode 1: Scan Domain

1. **Buka** `http://localhost:3000` di browser
2. **Masukkan URL** domain yang ingin di-download, contoh:
   ```
   example.com
   ```
3. *(Opsional)* Atur **filter waktu**:
   - **Dari**: tanggal mulai, format `YYYYMMDD` (contoh: `20200101`)
   - **Sampai**: tanggal akhir, format `YYYYMMDD` (contoh: `20231231`)
   - **Limit**: jumlah maksimal halaman (default: 500)
4. Klik tombol **Scan**
5. Pilih halaman yang ingin di-download dari daftar yang muncul
6. Klik **Download Terpilih**
7. Pantau progress download secara real-time
8. Setelah selesai, download hasilnya sebagai **ZIP** atau akses langsung dari folder `downloads/`

### Metode 2: Direct Download dari URL Wayback

1. **Paste langsung** URL Wayback Machine, contoh:
   ```
   https://web.archive.org/web/20230615/https://example.com
   ```
2. Tool akan otomatis mendeteksi timestamp dan domain
3. Klik **Scan** untuk melihat semua halaman yang tersedia, atau **Download Langsung**

---

## 📁 Struktur Project

```
wayback-html-machine/
├── server.js           # Express server & API endpoints
├── package.json        # Dependencies & scripts
├── lib/
│   ├── cdx.js          # Wayback Machine CDX API client
│   ├── downloader.js   # Download engine (pages + assets)
│   ├── rewriter.js     # HTML/CSS link rewriter untuk offline
│   └── utils.js        # Helper functions (URL parsing, fetch, dll)
├── public/
│   ├── index.html      # Halaman utama
│   ├── style.css       # Styling
│   └── app.js          # Frontend logic
└── downloads/          # Folder hasil download (auto-generated)
```

---

## 🔌 API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `POST` | `/api/parse` | Parse URL Wayback Machine |
| `POST` | `/api/scan` | Scan domain, cari halaman tersedia |
| `POST` | `/api/download` | Mulai proses download |
| `GET` | `/api/progress` | SSE stream progress real-time |
| `GET` | `/api/downloads` | List semua hasil download |
| `GET` | `/api/zip/:domain` | Download hasil sebagai ZIP |

### Contoh API: Scan Domain

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"url": "example.com", "limit": 100}'
```

### Contoh API: Download

```bash
curl -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{
    "pages": [
      {"original": "http://example.com/", "timestamp": "20230615120000"}
    ],
    "timestamp": "20230615120000"
  }'
```

---

## ⚠️ Catatan Penting

> [!WARNING]
> - Wayback Machine memiliki **rate limiting**. Tool ini sudah menerapkan delay otomatis (200ms antar-request) dan retry dengan backoff
> - Download website besar dengan banyak halaman bisa memakan **waktu lama**
> - Pastikan memiliki **ruang disk cukup** untuk menyimpan hasil download

> [!CAUTION]
> Gunakan tool ini secara **bertanggung jawab**. Jangan membebani server Wayback Machine dengan request berlebihan. Hormati `robots.txt` dan hak cipta konten.

---

## 🛠️ Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `fetch is not defined` | Upgrade Node.js ke versi **18+** |
| Port 3000 sudah dipakai | Edit `PORT` di `server.js` |
| Download gagal / timeout | Coba lagi, Wayback Machine kadang lambat |
| ZIP gagal dibuat | Pastikan command `zip` tersedia (`which zip`) |
| Halaman tidak ditemukan | Domain mungkin tidak tersimpan di Wayback Machine |

---

## 📜 Lisensi

MIT
