/**
 * shitiktok — Vercel serverless: POST /api/info
 * Web (Vercel) pakai TikWM + scrape saja (tanpa yt-dlp, karena binary tidak ada di serverless).
 * Mengembalikan { ok, strategy, fileUrl, meta } — fileUrl = link CDN langsung.
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
    const info = await getTikTokInfo(url, { audio, skipYtDlp: true });
    return res.status(200).json({ ok: true, ...info });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
}
