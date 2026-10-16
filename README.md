# shitiktok — Download TikTok Tanpa Watermark

Tools download video TikTok tanpa watermark, dengan rantai fallback **anti-gagal**:
kalau satu cara gagal, otomatis coba cara berikutnya sampai ada yang berhasil.

## Fitur

- 🎬 Video tanpa watermark (kualitas terbaik yang tersedia)
- 🎵 Mode audio — unduh MP3 musiknya saja (`--audio`)
- 📝 Metadata JSON: judul, author, durasi, cover, likes, comments, shares, views (`--meta`)
- 🖥️ Web UI dark premium — tempel URL, klik Download
- 💻 CLI dengan progress log Bahasa Indonesia
- 🔒 Tanpa login, tanpa cookie/session pengguna, tanpa dependency npm

## Syarat

- **Node.js 18+** (wajib — pakai `fetch` bawaan Node)
- **yt-dlp (opsional, sangat disarankan)** — strategi paling andal:
  ```bash
  pip install yt-dlp
  # atau: sudo apt install yt-dlp
  ```

## Install

```bash
git clone https://github.com/iyannsysu/shitiktok.git
cd shitiktok
# tidak ada npm install — nol dependency
```

## Cara Pakai

### CLI

```bash
# Video tanpa watermark (default)
node src/cli.js https://www.tiktok.com/@shiyan841/video/7697298046408740148

# Audio MP3 + metadata JSON
node src/cli.js <url> --audio --meta

# Folder output lain
node src/cli.js <url> --out ./hasil
```

Atau via npm script:

```bash
npm run dl -- <url> --audio --meta
```

### Web UI

```bash
npm start
# buka http://localhost:3000
```

Tempel URL TikTok → klik **Download** → info video muncul → klik **Simpan File**.
Port bisa diubah: `PORT=8080 npm start`.

### Pakai sebagai library

```js
import { downloadTikTok, getTikTokInfo } from './src/tiktok.js';

// Info saja (tanpa unduh file)
const info = await getTikTokInfo('https://www.tiktok.com/@user/video/123...');

// Unduh penuh
const { file, strategy, meta, size } = await downloadTikTok(url, {
  audio: false,
  outDir: 'downloads',
});
```

## Cara Kerja — Strategi Anti-Gagal

Diuji berurutan, hasil pertama yang berhasil dipakai:

| # | Strategi | Keterangan |
|---|----------|------------|
| 1 | **yt-dlp** | Paling andal, tanpa watermark, kualitas terbaik. Butuh binary `yt-dlp` terinstall. |
| 2 | **TikWM API** | API publik gratis tanpa key. Ambil `play` (no watermark) / `wmplay` / `music`. |
| 3 | **oEmbed + scrape** | Fetch halaman TikTok dengan User-Agent mobile, ekstrak link CDN `playAddr` dari HTML. |

Tiap strategi: **timeout 20 detik**, **retry max 2x** dengan backoff.
Kalau semua gagal, error terakhir ditampilkan jelas — tidak pernah mengklaim berhasil palsu.

```
Semua strategi gagal untuk <url>.
  1. Strategi: ...
  2. Strategi: ...
  3. Strategi: ...
Kemungkinan: video privat / dihapus / region-locked, atau TikTok memblokir IP server.
```

## Keamanan

- ✅ Hanya menerima URL `tiktok.com` / `vm.tiktok.com` / `vt.tiktok.com` — URL lain ditolak.
- ✅ Nama file output disanitasi (karakter ilegal dihapus, panjang dibatasi).
- ✅ Tidak menyimpan cookie/session pengguna.
- ✅ Tidak mengirim data ke pihak ketiga selain endpoint unduhan (yt-dlp, TikWM, tiktok.com).

## Batasan (Jujur)

- ❌ **Video privat** tidak bisa diunduh — tools ini tidak login ke akun apa pun.
- ❌ **Video yang dihapus** atau **region-locked** tidak bisa diunduh.
- ❌ Kalau TikTok memblokir IP server (bot-check), strategi scrape bisa gagal — yt-dlp / TikWM biasanya tetap jalan.
- ❌ Tidak ada garansi 100% berhasil — TikTok bisa mengubah struktur halamannya kapan saja. Itulah gunanya rantai fallback.
- ⚖️ Gunakan untuk video milik sendiri atau yang diizinkan pemiliknya. Hormati hak cipta kreator.

## Lisensi

MIT
