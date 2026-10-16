/**
 * shitiktok — core downloader TikTok anti-gagal.
 *
 * Rantai fallback (dicoba berurutan sampai ada yang berhasil):
 *   1. yt-dlp        — paling andal, tanpa watermark, kualitas terbaik.
 *   2. TikWM API     — gratis tanpa key, ambil play (no watermark) / music.
 *   3. oEmbed+scrape — fetch halaman TikTok (UA mobile) + ekstraksi CDN.
 *
 * Tiap strategi: timeout 20 detik, retry max 2x dengan backoff.
 * NOL dependency npm — hanya built-in Node (fetch, fs, child_process).
 *
 * KEAMANAN: tidak menyimpan cookie/session pengguna, tidak mengirim data
 * ke pihak ketiga selain endpoint unduhan di atas. Nama file output
 * disanitasi sebelum ditulis ke disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const TIMEOUT_MS = 20_000;
const MAX_RETRY = 2;
const BACKOFF_MS = 1500;

const ALLOWED_HOSTS = [
	'tiktok.com',
	'www.tiktok.com',
	'm.tiktok.com',
	'vm.tiktok.com',
	'vt.tiktok.com',
];

const MOBILE_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

/* ------------------------------------------------------------------ */
/* Util                                                                */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Validasi URL: hanya tiktok.com / vm.tiktok.com / vt.tiktok.com. */
export function validateTikTokUrl(raw) {
	let u;
	try {
		u = new URL(raw);
	} catch {
		throw new Error(`URL tidak valid: "${raw}"`);
	}
	if (u.protocol !== 'https:') throw new Error('URL harus diawali https://');
	const host = u.hostname.toLowerCase();
	const ok = ALLOWED_HOSTS.includes(host) || host.endsWith('.tiktok.com');
	if (!ok) {
		throw new Error(
			`Host "${host}" tidak didukung. Hanya URL tiktok.com / vm.tiktok.com / vt.tiktok.com yang diterima.`
		);
	}
	return u.toString();
}

/** Fetch dengan timeout 20 detik. */
async function fetchTimeout(url, opts = {}, timeout = TIMEOUT_MS) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeout);
	try {
		return await fetch(url, { ...opts, signal: ctrl.signal });
	} catch (err) {
		if (err?.name === 'AbortError') throw new Error(`Timeout ${timeout / 1000} detik: ${url}`);
		throw err;
	} finally {
		clearTimeout(t);
	}
}

/** Retry wrapper: max 2x retry dengan backoff 1.5 dtk. */
async function withRetry(fn, label) {
	let lastErr;
	for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (attempt < MAX_RETRY) await sleep(BACKOFF_MS * (attempt + 1));
		}
	}
	throw new Error(`${label}: ${lastErr?.message || lastErr}`);
}

/** Jalankan command, kembalikan stdout. Timeout via execFile. */
function execFileAsync(file, args, timeout = TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) reject(new Error((stderr || err.message).trim().slice(0, 300)));
			else resolve(stdout);
		});
	});
}

/** Sanitasi nama file: hapus karakter ilegal, batasi panjang. */
export function sanitizeFilename(name, fallback = 'tiktok') {
	const clean = String(name || '')
		.normalize('NFKD')
		.replace(/[^\w\s.-]/g, '')
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/\.{2,}/g, '.')
		.replace(/^\.+/, '')
		.slice(0, 80)
		.replace(/_+$/, '');
	return clean || fallback;
}

/** Ambil ID video dari URL (untuk nama file). */
function extractVideoId(url) {
	const m = url.match(/\/video\/(\d+)/);
	return m ? m[1] : String(Date.now());
}

/** Resolve shortlink vm.tiktok.com / vt.tiktok.com ke URL penuh. */
async function resolveShortLink(url) {
	if (!/https?:\/\/(vm|vt)\.tiktok\.com\//.test(url)) return url;
	const res = await fetchTimeout(url, { redirect: 'follow' });
	const final = res.url || url;
	if (!final.includes('tiktok.com')) return url;
	return final;
}

/* ------------------------------------------------------------------ */
/* Strategi 1: yt-dlp                                                 */
/* ------------------------------------------------------------------ */

async function strategyYtDlp(url, { audio }) {
	// Cek binary tersedia (sekali jalan; kalau tidak ada -> strategi gagal, lanjut).
	await execFileAsync('which', ['yt-dlp']);
	const json = await execFileAsync('yt-dlp', ['-j', '--no-playlist', url]);
	let info;
	try {
		info = JSON.parse(json);
	} catch {
		throw new Error('yt-dlp mengembalikan JSON yang tidak valid');
	}

	const meta = normalizeYtDlpMeta(info, url);
	const fileUrl = audio ? pickAudioUrl(info) : pickVideoUrl(info);
	if (!fileUrl) throw new Error('yt-dlp tidak menemukan stream yang bisa diunduh');
	return { strategy: 'yt-dlp', fileUrl, meta };
}

function normalizeYtDlpMeta(info, url) {
	return {
		id: String(info.id || extractVideoId(url)),
		title: info.title || '',
		author: info.uploader || info.uploader_id || '',
		authorUniqueId: info.uploader_id || '',
		duration: info.duration ?? null,
		cover: info.thumbnail || '',
		likes: info.like_count ?? null,
		comments: info.comment_count ?? null,
		shares: info.repost_count ?? null,
		views: info.view_count ?? null,
		sourceUrl: url,
	};
}

function pickVideoUrl(info) {
	const formats = (info.formats || []).filter(
		(f) => f.url && f.vcodec && f.vcodec !== 'none' && f.ext === 'mp4'
	);
	if (!formats.length) return info.url || null;
	// Utamakan yang ada audio + resolusi tertinggi.
	formats.sort((a, b) => {
		const score = (f) => (f.acodec && f.acodec !== 'none' ? 1_000_000 : 0) + (f.height || 0) * 1000 + (f.filesize || f.filesize_approx || 0);
		return score(b) - score(a);
	});
	return formats[0].url;
}

function pickAudioUrl(info) {
	// yt-dlp TikTok: requested_formats / format audio-only m4a.
	const formats = (info.formats || []).filter(
		(f) => f.url && (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none'
	);
	if (formats.length) {
		formats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
		return formats[0].url;
	}
	// Fallback: pakai URL video (nanti dikonversi caller bila perlu).
	return pickVideoUrl(info);
}

/* ------------------------------------------------------------------ */
/* Strategi 2: TikWM API (gratis, tanpa key)                          */
/* ------------------------------------------------------------------ */

async function strategyTikWm(url, { audio }) {
	const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
	const res = await fetchTimeout(api, {
		headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json' },
	});
	if (!res.ok) throw new Error(`TikWM HTTP ${res.status}`);
	let json;
	try {
		json = await res.json();
	} catch {
		throw new Error('TikWM mengembalikan respons bukan JSON');
	}
	if (json.code !== 0 || !json.data) {
		throw new Error(`TikWM menolak: ${json.msg || 'data kosong (video mungkin privat / dihapus / region-locked)'}`);
	}
	const d = json.data;
	const fileUrl = audio ? d.music : d.play || d.wmplay;
	if (!fileUrl) throw new Error('TikWM tidak mengembalikan link unduhan');
	return {
		strategy: 'tikwm',
		fileUrl,
		meta: {
			id: String(d.id || extractVideoId(url)),
			title: d.title || '',
			author: d.author?.nickname || '',
			authorUniqueId: d.author?.unique_id || '',
			duration: d.duration ?? null,
			cover: d.cover || d.ai_dynamic_cover || '',
			likes: d.digg_count ?? null,
			comments: d.comment_count ?? null,
			shares: d.share_count ?? null,
			views: d.play_count ?? null,
			musicTitle: d.music_info?.title || '',
			sourceUrl: url,
		},
	};
}

/* ------------------------------------------------------------------ */
/* Strategi 3: oEmbed + ekstraksi CDN dari halaman                    */
/* ------------------------------------------------------------------ */

async function strategyScrape(url, { audio }) {
	if (audio) throw new Error('Strategi scrape tidak mendukung unduh audio');

	// 1) oEmbed untuk metadata dasar (judul, author, thumbnail).
	let meta = { id: extractVideoId(url), title: '', author: '', sourceUrl: url };
	try {
		const oembed = await fetchTimeout(
			`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
			{ headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json' } }
		);
		if (oembed.ok) {
			const j = await oembed.json();
			meta.title = j.title || '';
			meta.author = j.author_name || '';
			meta.cover = j.thumbnail_url || '';
		}
	} catch {
		// oEmbed gagal bukan fatal — lanjut scrape halaman.
	}

	// 2) Fetch halaman video, cari playAddr / downloadAddr di JSON tertanam.
	const page = await fetchTimeout(url, {
		headers: {
			'User-Agent': MOBILE_UA,
			Accept: 'text/html,application/xhtml+xml',
			'Accept-Language': 'en-US,en;q=0.9',
		},
	});
	if (!page.ok) throw new Error(`Halaman TikTok HTTP ${page.status} (mungkin diblokir / video privat)`);
	const html = await page.text();

	const candidates = [];
	for (const key of ['playAddr', 'downloadAddr']) {
		const re = new RegExp(`"${key}"\\s*:\\s*"(https:[^"]+)"`, 'g');
		for (const m of html.matchAll(re)) {
			candidates.push(m[1].replace(/\\u0026/g, '&').replace(/\\/g, ''));
		}
	}
	// Fallback: URL CDN video langsung di HTML.
	for (const m of html.matchAll(/https:\/\/v\d+-?[a-z]*\.tiktokcdn\.com\/[^"'\s\\]+/g)) {
		candidates.push(m[0].replace(/\\/g, ''));
	}
	const fileUrl = candidates.find((u) => u.includes('.mp4') || u.includes('tiktokcdn'));
	if (!fileUrl) {
		throw new Error('Tidak menemukan link video di halaman (TikTok memblokir scrape dari IP ini / video privat)');
	}
	return { strategy: 'scrape', fileUrl, meta };
}

/* ------------------------------------------------------------------ */
/* API publik                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ambil info + direct URL tanpa mengunduh file.
 * Mengembalikan { strategy, fileUrl, meta } dari strategi pertama yang berhasil.
 */
export async function getTikTokInfo(rawUrl, { audio = false } = {}) {
	const validated = validateTikTokUrl(rawUrl);
	const url = await withRetry(() => resolveShortLink(validated), 'Resolve shortlink');

	const strategies = [
		() => strategyYtDlp(url, { audio }),
		() => strategyTikWm(url, { audio }),
		() => strategyScrape(url, { audio }),
	];
	const errors = [];
	for (const run of strategies) {
		try {
			return await withRetry(run, 'Strategi');
		} catch (err) {
			errors.push(err.message);
		}
	}
	throw new Error(
		`Semua strategi gagal untuk ${url}.\n` +
			errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n') +
			'\nKemungkinan: video privat / dihapus / region-locked, atau TikTok memblokir IP server.'
	);
}

/**
 * Unduh penuh ke `outDir`. Mengembalikan { file, strategy, meta, size }.
 * `onProgress(received, total)` dipanggil selama unduh bila total diketahui.
 */
export async function downloadTikTok(rawUrl, { audio = false, outDir = 'downloads', onProgress } = {}) {
	const { strategy, fileUrl, meta } = await getTikTokInfo(rawUrl, { audio });

	fs.mkdirSync(outDir, { recursive: true });
	const base = sanitizeFilename(`${meta.title || 'tiktok'}_${meta.id}`, `tiktok_${meta.id}`);
	const ext = audio ? 'mp3' : 'mp4';
	const file = path.join(outDir, `${base}.${ext}`);

	const res = await fetchTimeout(fileUrl, {
		headers: { 'User-Agent': MOBILE_UA, Referer: 'https://www.tiktok.com/' },
	});
	if (!res.ok || !res.body) {
		throw new Error(`Gagal mengunduh file dari CDN (HTTP ${res.status}, strategi ${strategy})`);
	}

	const total = Number(res.headers.get('content-length') || 0);
	let received = 0;
	const writer = fs.createWriteStream(file);
	try {
		for await (const chunk of res.body) {
			writer.write(chunk);
			received += chunk.length;
			onProgress?.(received, total);
		}
	} finally {
		writer.end();
		await new Promise((r) => writer.on('finish', r));
	}

	const size = fs.statSync(file).size;
	if (size < 1024) {
		fs.unlinkSync(file);
		throw new Error(`File terunduh terlalu kecil (${size} byte) — kemungkinan respons error, bukan video`);
	}
	return { file, strategy, meta, size };
}
