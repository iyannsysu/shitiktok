/**
 * shitiktok — Vercel serverless: POST /api/download
 * Beda dengan server lokal: tidak menyimpan file di disk (serverless tidak cocok
 * untuk file besar). Mengembalikan meta + fileUrl CDN langsung, frontend yang
 * membuka / mengunduhnya. Strategi: TikWM → scrape (tanpa yt-dlp).
 */
import { getTikTokInfo } from '../src/tiktok.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method harus POST' });
  try {
    const { url, audio = false } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'URL TikTok wajib diisi' });
    const { strategy, fileUrl, meta } = await getTikTokInfo(url, { audio, skipYtDlp: true });
    return res.status(200).json({ ok: true, strategy, meta, size: null, fileUrl, downloadUrl: fileUrl });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
}
