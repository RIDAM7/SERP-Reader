/**
 * Re-read exports with the current parser.
 *
 *   npm run reparse -- path/to/serps-2026-10-15.json [more serps-*.json ...]
 *
 * Writes serps-2026-10-15.reparsed.json beside each: the same envelope, every
 * capture with a snapshot read again by today's collectSerp, so a SERP from
 * last month benefits from a selector fixed today without being searched again.
 * Captures without a snapshot are copied unchanged and counted. Prints what
 * moved per capture.
 *
 * The original is never written. Snapshots are the only thing in an export
 * that cannot be regenerated, and the .reparsed.json can be, by running this
 * again. A `*.reparsed.json` given as input is skipped, so a glob that catches
 * both files on a second run re-reads the original once.
 *
 * What is kept from the original, and why:
 *
 *   id, collectedAt   the capture's identity; readers prefer a re-read by id
 *   metadata          what the live page knew and a snapshot does not: the
 *                     snapshot is the results column, so it has no <html lang>,
 *                     and Node has no window to say the device. Only the counts
 *                     and features are the parser's, and those follow the re-read
 *
 * Everything else, diagnostics.parserVersion included, is the re-read's.
 *
 * The snapshot stays in the original and only there: a re-read carries
 * `snapshotIn`, the original's file name, in place of rawHtml. The next run
 * re-reads the original anyway, so a copy would only be weight; on the 164
 * captures of 2026-10 it is 110 MB against 4.3 MB without. A capture with
 * no snapshot is copied as it was, and has neither.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { collectSerp, PARSER_VERSION } from './.parser.mjs';

const REPARSED = /\.reparsed\.json$/i;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What the slot held. An export from before `status` existed (parser 1.0.0)
 * said present: true for an overview and for an AI Mode reply alike, and is
 * read as the overview it claimed, so the re-read's `ai rendered->ai_mode_reply`
 * is the line worth reading.
 */
const slot = (a) => a?.status ?? (a?.present ? 'rendered' : 'none');

/** One line's worth of what changed between two readings of the same capture. */
export function moved(before, after) {
  const out = [];
  const count = (label, a = [], b = [], key) => {
    if (a.length !== b.length) out.push(`${label} ${a.length}->${b.length}`);
    else if (!same(a.map(key), b.map(key))) out.push(`${label} reordered`);
  };
  count('organic', before.organicResults, after.organicResults, (r) => r.domain);
  count('ads', before.ads, after.ads, (r) => r.domain);
  count('paa', before.paa, after.paa, (p) => p.question);
  if (slot(before.aiOverview) !== slot(after.aiOverview)) out.push(`ai ${slot(before.aiOverview)}->${slot(after.aiOverview)}`);
  count('sources', before.aiOverview?.sources, after.aiOverview?.sources, (c) => c.domain);
  const was = new Set(before.serpFeatures ?? []);
  const now = new Set(after.serpFeatures ?? []);
  const diff = [...[...now].filter((f) => !was.has(f)).map((f) => `+${f}`), ...[...was].filter((f) => !now.has(f)).map((f) => `-${f}`)];
  if (diff.length) out.push(`features ${diff.join(' ')}`);
  if (!same(before.featuredSnippet?.sourceDomain, after.featuredSnippet?.sourceDomain)) out.push('featured snippet');
  if (!same(before.relatedSearches, after.relatedSearches)) out.push('related searches');
  if (/<!-- truncated at \d+ bytes -->$/.test(before.rawHtml ?? '')) out.push('snapshot truncated');
  return out;
}

/**
 * One export's envelope, re-read. Pure: no files. Returns the new envelope and
 * a line per capture. `snapshotIn` is the original's file name, where every
 * re-read capture's snapshot stays.
 */
export function reparseExport(payload, { snapshotIn } = {}) {
  const serps = Array.isArray(payload) ? payload : (payload.serps ?? [payload]);
  const lines = [];
  const versions = new Set();
  let reread = 0;
  let kept = 0;

  const out = serps.map((s) => {
    if (!s.rawHtml) {
      kept++;
      return s;
    }
    versions.add(s.diagnostics?.parserVersion ?? '?');
    const d = collectSerp(parseHTML(s.rawHtml).document, s.metadata?.url ?? 'https://www.google.com/search', {
      includeRawHtml: false,
    });
    const label = (s.metadata?.query || '(no query)').slice(0, 60);
    const m = moved(s, d);
    lines.push(`  ${label.padEnd(60)} ${m.length ? m.join(', ') : 'unchanged'}`);
    reread++;
    const { organicResultCount, adCount, paaCount, features } = d.metadata;
    const { rawHtml, ...reading } = d;
    return {
      ...reading,
      id: s.id,
      collectedAt: s.collectedAt,
      // The original's fields win; a field a newer parser adds still comes through.
      metadata: { ...d.metadata, ...s.metadata, organicResultCount, adCount, paaCount, features },
      ...(snapshotIn ? { snapshotIn } : {}),
    };
  });

  const envelope = {
    exportedAt: payload.exportedAt,
    reparsedAt: new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    count: out.length,
    serps: out,
  };
  return { envelope, lines, reread, kept, from: [...versions].sort() };
}

/** Re-read one export file into its .reparsed.json. Returns the path written, or null when skipped. */
export function reparseFile(input, { log = console.log } = {}) {
  if (REPARSED.test(input)) {
    log(`${input}: already a re-read; skipped (its original is re-read instead)`);
    return null;
  }
  const target = input.replace(/\.json$/i, '.reparsed.json');
  if (target === input) {
    log(`${input}: not a .json export; skipped`);
    return null;
  }
  const r = reparseExport(JSON.parse(readFileSync(input, 'utf8')), { snapshotIn: basename(input) });
  log(input);
  for (const line of r.lines) log(line);
  writeFileSync(target, JSON.stringify(r.envelope, null, 2));
  const from = r.from.length ? `parser ${r.from.join(', ')} -> ${PARSER_VERSION}` : `parser ${PARSER_VERSION}`;
  log(`${r.reread} re-read, ${r.kept} without a snapshot kept as they were (${from}) -> ${target}\n`);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    console.error('usage: npm run reparse -- <serps-YYYY-MM-DD.json> [...]');
    process.exit(1);
  }
  // npm runs scripts from the package root; a relative path means where the command was typed.
  const base = process.env.INIT_CWD ?? process.cwd();
  for (const input of inputs) reparseFile(resolve(base, input));
}
