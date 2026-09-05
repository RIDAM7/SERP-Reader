/**
 * Re-baseline the .expected.json sidecars from the fixture HTML.
 *
 *   node test/regen-expected.mjs            # all fixtures
 *   node test/regen-expected.mjs real-in-ecommerce-seo
 *
 * import-capture.mjs can only rebuild expectations from the original exported
 * JSON, and those exports do not live in the repo — two of the first fixtures
 * had their exports deleted, leaving expectations that could never be corrected
 * after a deliberate parser fix.
 *
 * Run this ONLY after reviewing the diff it prints. The whole point of the
 * sidecars is to fail when parsing changes; regenerating without reading the
 * change turns a regression test into a rubber stamp.
 *
 * Capture identity (when, which query, which market) is carried over from the
 * existing sidecar — it describes the capture, not the parser, and re-deriving
 * it from HTML is not possible anyway.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { collectSerp } from './.parser.mjs';

const FIXTURES = 'test/fixtures';
const only = process.argv.slice(2);

const files = readdirSync(FIXTURES)
  .filter((f) => f.startsWith('real-') && f.endsWith('.html'))
  .filter((f) => only.length === 0 || only.some((o) => f.startsWith(o)));

if (files.length === 0) {
  console.error(only.length ? `no fixture matches ${only.join(', ')}` : 'no fixtures found');
  process.exit(1);
}

let changed = 0;
for (const file of files) {
  const base = file.replace(/\.html$/, '');
  const path = join(FIXTURES, `${base}.expected.json`);
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};

  const parsed = collectSerp(
    parseHTML(readFileSync(join(FIXTURES, file), 'utf8')).document,
    prev.url ?? 'https://www.google.com/search?q=imported',
    { includeRawHtml: false },
  );

  const next = {
    capturedAt: prev.capturedAt,
    url: prev.url,
    query: prev.query,
    country: prev.country,
    parserVersion: parsed.diagnostics.parserVersion,
    organicCount: parsed.organicResults.length,
    firstDomains: parsed.organicResults.slice(0, 5).map((r) => r.domain),
    paaCount: parsed.paa.length,
    hasAiOverview: Boolean(parsed.aiOverview?.present),
    aiCitationDomains: (parsed.aiOverview?.sources ?? []).map((c) => c.domain),
    features: parsed.serpFeatures,
    adCount: parsed.ads.length,
    adDomains: parsed.ads.map((a) => a.domain),
  };

  const diffs = [];
  for (const key of Object.keys(next)) {
    const a = JSON.stringify(prev[key]);
    const b = JSON.stringify(next[key]);
    if (a !== b) diffs.push(`    ${key}: ${a ?? '(absent)'} -> ${b}`);
  }

  console.log(base);
  if (diffs.length === 0) {
    console.log('    unchanged');
    continue;
  }
  console.log(diffs.join('\n'));
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  changed++;
}

console.log(`\n${changed} sidecar(s) rewritten. Read the diff above before committing it.`);
