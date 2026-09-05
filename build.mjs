/**
 * Build to dist/, which is the folder Chrome loads.
 *
 * Content scripts cannot use ES module imports, so the parser has to be bundled
 * into one IIFE. That is the only reason a build step exists here at all — the
 * popup and history pages could have used native modules.
 *
 *   node build.mjs          one build
 *   node build.mjs --watch  rebuild on change
 */
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const OUT = 'dist';
const watch = process.argv.includes('--watch');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'icons'), { recursive: true });

const common = {
  bundle: true,
  target: 'chrome110',
  // Silent: four parallel builds interleave their output into unreadable
  // fragments, which reads like a crash. We print one clean summary instead.
  logLevel: 'silent',
  metafile: true,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
};

const jobs = [
  // IIFE: a content script has no module loader.
  { entryPoints: ['src/content/index.ts'], outfile: `${OUT}/content.js`, format: 'iife', ...common },
  // The service worker is declared "type": "module" in the manifest.
  { entryPoints: ['src/background/index.ts'], outfile: `${OUT}/background.js`, format: 'esm', ...common },
  { entryPoints: ['src/popup/popup.ts'], outfile: `${OUT}/popup.js`, format: 'esm', ...common },
  { entryPoints: ['src/history/history.ts'], outfile: `${OUT}/history.js`, format: 'esm', ...common },
];

function copyStatic() {
  cpSync('manifest.json', join(OUT, 'manifest.json'));
  cpSync('src/popup/popup.html', join(OUT, 'popup.html'));
  cpSync('src/history/history.html', join(OUT, 'history.html'));

  /*
   * Placeholder icons, generated rather than committed as binaries.
   *
   * Chrome refuses to load an extension whose manifest names an icon that is
   * not there, and a missing PNG is a confusing first-run failure for something
   * entirely cosmetic.
   */
  for (const size of [16, 48, 128]) {
    writeFileSync(join(OUT, 'icons', `icon${size}.png`), pngSquare(size));
  }
}

/** Smallest valid PNG of a solid square — enough to satisfy the manifest. */
function pngSquare(size) {
  const crc32 = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // One filter byte per row, then RGB pixels. Google blue.
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, () => Buffer.from([26, 115, 232])))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (watch) {
  for (const job of jobs) {
    const ctx = await context(job);
    await ctx.watch();
  }
  copyStatic();
  console.log(`\nwatching — load ${OUT}/ in chrome://extensions with Developer mode on\n`);
} else {
  const results = await Promise.all(jobs.map((j) => build(j)));
  copyStatic();

  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  console.log(`\n${manifest.name} v${manifest.version}\n`);

  for (const [i, r] of results.entries()) {
    const name = jobs[i].outfile.replace(`${OUT}/`, '');
    const bytes = Object.values(r.metafile?.outputs ?? {})[0]?.bytes ?? 0;
    console.log(`  ${name.padEnd(16)} ${(bytes / 1024).toFixed(1)}kb`);
  }
  for (const f of ['manifest.json', 'popup.html', 'history.html', 'icons/']) {
    console.log(`  ${f.padEnd(16)} copied`);
  }

  console.log(`\n  ${OUT}/ is ready to load.`);
  console.log('  chrome://extensions -> Developer mode -> Load unpacked -> select dist/\n');
}
