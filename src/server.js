/**
 * shitiktok — web UI mini (http built-in, tanpa framework).
 *
 *   npm start  →  http://localhost:3000
 *
 * Endpoint:
 *   GET  /            → halaman web UI
 *   POST /api/info    → { url, audio? } → metadata + direct URL (tanpa unduh file)
 *   POST /api/download→ { url, audio? } → unduh ke server, kembalikan info file
 *   GET  /file/:name → unduh file hasil (hanya dari folder downloads/)
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadTikTok, getTikTokInfo, sanitizeFilename } from './tiktok.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DOWNLOADS = path.join(ROOT, 'downloads');
const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(DOWNLOADS, { recursive: true });

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
};

function sendJson(res, code, obj) {
	res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(obj));
}

async function readJsonBody(req) {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
	} catch {
		throw new Error('Body harus JSON yang valid');
	}
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, `http://localhost:${PORT}`);

		// --- Halaman web UI / aset statis ---
		if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
			const html = fs.readFileSync(path.join(PUBLIC, 'index.html'));
			res.writeHead(200, { 'Content-Type': MIME['.html'] });
			return res.end(html);
		}
		if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
			const file = path.join(PUBLIC, url.pathname.replace('/public/', ''));
			if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
				res.writeHead(404); return res.end('Not found');
			}
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
			return res.end(fs.readFileSync(file));
		}

		// --- API: info saja ---
		if (req.method === 'POST' && url.pathname === '/api/info') {
			const { url: tiktokUrl, audio = false } = await readJsonBody(req);
			const info = await getTikTokInfo(tiktokUrl, { audio });
			return sendJson(res, 200, { ok: true, ...info });
		}

		// --- API: unduh ke server ---
		if (req.method === 'POST' && url.pathname === '/api/download') {
			const { url: tiktokUrl, audio = false } = await readJsonBody(req);
			const { file, strategy, meta, size } = await downloadTikTok(tiktokUrl, { audio, outDir: DOWNLOADS });
			const name = path.basename(file);
			return sendJson(res, 200, {
				ok: true,
				strategy,
				meta,
				size,
				file: name,
				downloadUrl: `/file/${encodeURIComponent(name)}`,
			});
		}

		// --- File hasil unduhan (hanya basename, cegah path traversal) ---
		if (req.method === 'GET' && url.pathname.startsWith('/file/')) {
			const name = sanitizeFilename(decodeURIComponent(url.pathname.slice(6)));
			const file = path.join(DOWNLOADS, name);
			if (!file.startsWith(DOWNLOADS) || !fs.existsSync(file)) {
				res.writeHead(404); return res.end('File tidak ditemukan');
			}
			const ext = path.extname(file).toLowerCase();
			res.writeHead(200, {
				'Content-Type': ext === '.mp3' ? 'audio/mpeg' : 'video/mp4',
				'Content-Disposition': `attachment; filename="${name}"`,
				'Content-Length': fs.statSync(file).size,
			});
			return fs.createReadStream(file).pipe(res);
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: false, error: 'Rute tidak ditemukan' }));
	} catch (err) {
		sendJson(res, 400, { ok: false, error: err.message });
	}
});

server.listen(PORT, () => {
	console.log(`\n🚀 shitiktok web UI jalan di http://localhost:${PORT}`);
	console.log('   Buka di browser, tempel URL TikTok, klik Download.\n');
});
