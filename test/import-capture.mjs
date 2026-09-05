/**
 * Turn a real capture into a test fixture.
 *
 *   node test/import-capture.mjs path/to/serps-2026-09-05.json
 *   node test/import-capture.mjs capture.json --keep-html   (default: keeps rawHtml)
 *
 * The JSON exported from the extension carries each capture's `rawHtml` — a
 * trimmed snapshot of the results column. This writes one HTML file per capture
 * into test/fixtures/real-*.html, plus a sidecar .expected.json recording what
 * the parser found at the time.
 *
 * Why the sidecar matters more than the HTML: the point of a real fixture is not
 * "does this parse" but "does this still parse the same way after I edit
 * selectors.ts". The expectations are the regression test; the HTML is just the
 * input.
 *
 * Exports made with "Keep raw HTML snapshot" unticked have nothing to import,
 * and this says so rather than writing empty files.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { collectSerp } from './.parser.mjs';

const [input] = process.argv.slice(2);
if (!input) {
  console.error('usage: node test/import-capture.mjs <exported-serps.json>');
  process.exit(1);
}

const FIXTURES = 'test/fixtures';
mkdirSync(FIXTURES, { recursive: true });

const payload = JSON.parse(readFileSync(input, 'utf8'));
const serps = Array.isArray(payload) ? payload : (payload.serps ?? [payload]);

const slug = (s) =>
  (s || 'query')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

let written = 0;
let skipped = 0;

for (const s of serps) {
  if (!s.rawHtml) {
    skipped++;
    continue;
  }
  const market = s.metadata?.country ?? 'xx';
  const base = `real-${market}-${slug(s.metadata?.query)}`;

  writeFileSync(join(FIXTURES, `${base}.html`), s.rawHtml);

  /*
   * Expectations come from re-parsing the HTML with the CURRENT parser, not
   * from the numbers in the export.
   *
   * The export was produced by whatever version was installed when the capture
   * was taken, bugs included. The first real capture recorded 9 organic results
   * and 6 PAA — one of those "results" was a video carousel entry and two of
   * the "questions" were section labels. Trusting the export would have frozen
   * those bugs in as the baseline the regression test defends.
   *
   * The HTML is the evidence; the expectations are today's reading of it.
   */
  const parsed = collectSerp(parseHTML(s.rawHtml).document, s.metadata?.url ?? 'https://www.google.com/search', {
    includeRawHtml: false,
  });

  /*
   * Only the shape, never the snippet text. A fixture that asserts exact
   * wording fails the next time Google rewrites a description, which teaches
   * everyone to ignore the test.
   */
  writeFileSync(
    join(FIXTURES, `${base}.expected.json`),
    JSON.stringify(
      {
        capturedAt: s.collectedAt,
        url: s.metadata?.url,
        query: s.metadata?.query,
        country: market,
        parserVersion: parsed.diagnostics.parserVersion,
        organicCount: parsed.organicResults.length,
        firstDomains: parsed.organicResults.slice(0, 5).map((r) => r.domain),
        paaCount: parsed.paa.length,
        hasAiOverview: Boolean(parsed.aiOverview?.present),
        aiCitationDomains: (parsed.aiOverview?.sources ?? []).map((c) => c.domain),
        features: parsed.serpFeatures,
        adCount: parsed.ads.length,
        adDomains: parsed.ads.map((a) => a.domain),
      },
      null,
      2,
    ),
  );
  written++;
  console.log(`  ${base}.html  (${parsed.organicResults.length} organic, ${parsed.paa.length} PAA, ${(parsed.aiOverview?.sources ?? []).length} AIO citations)`);
}

console.log(`\n${written} fixture(s) written to ${FIXTURES}/`);
if (skipped) {
  console.log(
    `${skipped} capture(s) had no rawHtml — re-collect with "Keep raw HTML snapshot" ticked to import those.`,
  );
}
if (written) console.log('\nnpm test now includes them.');
