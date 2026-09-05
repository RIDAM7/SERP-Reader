/**
 * Export. Pure string builders — no DOM, no downloads, so these are testable.
 *
 * Organic results and PAA go to separate CSVs rather than one file with mixed
 * row shapes. A single CSV holding both means every consumer has to filter by a
 * type column before it can do arithmetic, and the first person to open it in a
 * spreadsheet averages across both without noticing.
 */
import type { SerpData } from '../types/serp';

/** RFC 4180: quote anything containing a comma, quote or newline; double inner quotes. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (header: string[], rows: unknown[][]): string =>
  [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';

export function organicCsv(serps: SerpData[]): string {
  const header = [
    'keyword', 'timestamp', 'google_domain', 'country', 'language', 'device',
    'position', 'title', 'url', 'domain', 'displayed_url', 'snippet', 'serp_id',
  ];
  const rows: unknown[][] = [];
  for (const s of serps) {
    for (const r of s.organicResults) {
      rows.push([
        s.metadata.query, s.collectedAt, s.metadata.googleDomain, s.metadata.country ?? '',
        s.metadata.language ?? '', s.metadata.device, r.position, r.title, r.url, r.domain,
        r.displayedUrl ?? '', r.snippet ?? '', s.id,
      ]);
    }
  }
  return toCsv(header, rows);
}

export function paaCsv(serps: SerpData[]): string {
  const header = [
    'keyword', 'timestamp', 'country', 'order', 'question', 'answer',
    'source_url', 'source_domain', 'expanded', 'serp_id',
  ];
  const rows: unknown[][] = [];
  for (const s of serps) {
    for (const p of s.paa) {
      rows.push([
        s.metadata.query, s.collectedAt, s.metadata.country ?? '', p.order, p.question,
        p.answer ?? '', p.sourceUrl ?? '', p.sourceDomain ?? '', p.expanded, s.id,
      ]);
    }
  }
  return toCsv(header, rows);
}

/**
 * AI Overview citations, one row per cited source.
 *
 * The most valuable export for GEO work and the reason a third file exists:
 * "which domains does Google quote for this query" is a different question from
 * "what ranks", and squeezing it into the organic CSV would hide it.
 */
export function aiCitationsCsv(serps: SerpData[]): string {
  const header = ['keyword', 'timestamp', 'country', 'citation_order', 'title', 'url', 'domain', 'serp_id'];
  const rows: unknown[][] = [];
  for (const s of serps) {
    if (!s.aiOverview?.present) continue;
    for (const c of s.aiOverview.sources) {
      rows.push([
        s.metadata.query, s.collectedAt, s.metadata.country ?? '', c.order,
        c.title ?? '', c.url, c.domain, s.id,
      ]);
    }
  }
  return toCsv(header, rows);
}

export function featuresCsv(serps: SerpData[]): string {
  const header = ['keyword', 'timestamp', 'country', 'organic_results', 'ads', 'paa', 'ai_overview', 'features'];
  const rows = serps.map((s) => [
    s.metadata.query, s.collectedAt, s.metadata.country ?? '', s.organicResults.length,
    s.ads.length, s.paa.length, s.aiOverview?.present ? 'yes' : 'no', s.serpFeatures.join(' '),
  ]);
  return toCsv(header, rows);
}

/**
 * The full record set as JSON.
 *
 * `includeRawHtml` is REQUIRED, deliberately. It used to default to false, and
 * both call sites took the default without saying so — which meant "Export all"
 * silently discarded every snapshot while the popup checkbox that captured them
 * said, truthfully, that they had been kept. A 15-capture export looked complete
 * and could not be re-parsed after a parser fix.
 *
 * Snapshots are the only thing in this dataset that cannot be regenerated: a
 * count can be recomputed, a SERP from last Tuesday cannot be re-collected. So
 * dropping them is a choice a caller has to make out loud.
 */
export function serpsJson(serps: SerpData[], includeRawHtml: boolean): string {
  const payload = serps.map((s) => (includeRawHtml ? s : { ...s, rawHtml: undefined }));
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: payload.length, serps: payload }, null, 2);
}
