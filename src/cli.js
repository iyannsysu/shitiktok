#!/usr/bin/env node
/**
 * shitiktok CLI — unduh video TikTok tanpa watermark.
 *
 *   node src/cli.js <url-tiktok> [--out dir] [--audio] [--meta]
 *
 *   --out dir   folder output (default: ./downloads)
 *   --audio     unduh MP3 musiknya saja
 *   --meta      simpan metadata JSON di samping file
 */

import fs from 'node:fs';
import path from 'node:path';
import { downloadTikTok } from './tiktok.js';

function usage() {
	console.log(`
shitiktok — download TikTok tanpa watermark

Cara pakai:
  node src/cli.js <url-tiktok> [--out dir] [--audio] [--meta]

Opsi:
  --out <dir>   folder output (default: ./downloads)
  --audio       unduh MP3 musiknya saja
  --meta        simpan metadata JSON di samping file
  --help        tampilkan bantuan ini

Contoh:
  node src/cli.js https://www.tiktok.com/@shiyan841/video/7697298046408740148
  node src/cli.js <url> --audio --meta
`);
}

function fmtBytes(n) {
	if (!n) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	let i = 0;
	while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
	return `${n.toFixed(1)} ${units[i]}`;
}

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
	usage();
	process.exit(args.length ? 0 : 1);
}

const url = args[0];
let outDir = 'downloads';
let audio = false;
let saveMeta = false;

for (let i = 1; i < args.length; i++) {
	if (args[i] === '--out') outDir = args[++i] || outDir;
	else if (args[i] === '--audio') audio = true;
	else if (args[i] === '--meta') saveMeta = true;
	else if (args[i].startsWith('--out=')) outDir = args[i].slice(6);
	else {
		console.error(`❌ Opsi tidak dikenal: ${args[i]}`);
		usage();
		process.exit(1);
	}
}

console.log(`\n⬇️  Mengunduh ${audio ? 'audio' : 'video'} dari:\n   ${url}\n`);

let lastPct = -1;
try {
	const { file, strategy, meta, size } = await downloadTikTok(url, {
		audio,
		outDir,
		onProgress: (received, total) => {
			if (!total) return;
			const pct = Math.floor((received / total) * 100);
			if (pct !== lastPct && pct % 10 === 0) {
				lastPct = pct;
				process.stdout.write(`\r   Progress: ${pct}% (${fmtBytes(received)} / ${fmtBytes(total)})`);
			}
		},
	});
	process.stdout.write('\r');
	console.log(`✅ Berhasil! Strategi: ${strategy}`);
	console.log(`📁 File   : ${file} (${fmtBytes(size)})`);
	if (meta.title) console.log(`🎬 Judul  : ${meta.title}`);
	if (meta.author) console.log(`👤 Author : ${meta.author}${meta.authorUniqueId ? ` (@${meta.authorUniqueId})` : ''}`);
	if (meta.duration) console.log(`⏱️  Durasi : ${meta.duration} detik`);
	if (meta.likes != null) console.log(`❤️  Likes  : ${meta.likes.toLocaleString('id-ID')}`);

	if (saveMeta) {
		const metaFile = file.replace(/\.(mp4|mp3)$/, '.json');
		fs.writeFileSync(metaFile, JSON.stringify({ strategy, file, size, ...meta }, null, 2));
		console.log(`📝 Meta   : ${metaFile}`);
	}
} catch (err) {
	console.error(`\n❌ GAGAL: ${err.message}`);
	console.error('\nTips: pastikan video publik (bukan privat/dihapus), lalu coba lagi. Rantai fallback sudah mencoba yt-dlp → TikWM → scrape.');
	process.exit(1);
}
