/**
 * The orchestrator: one rendered SERP in, one SerpData out.
 *
 * Every sub-parser is wrapped. A feature Google has restyled should cost that
 * feature and nothing else — a thrown selector must not lose the twenty organic
 * results that parsed fine a millisecond earlier.
 */
import type { SerpData, SerpFeature } from '../types/serp';
import { parseAIOverview } from './aiOverview';
import { parseMetadata } from './metadata';
import { parseOrganic } from './organic';
import { parsePAA } from './paa';
import { parsePeopleAlsoSearchFor, parseRelatedSearches } from './relatedSearches';
import { PARSER_VERSION, SNAPSHOT_ROOTS } from './selectors';
import { detectFeatures, parseFeaturedSnippet } from './serpFeatures';
import { pick, text, uuid } from './utils';

export interface CollectOptions {
  /** Keep a trimmed DOM snapshot so a future parser can re-read this capture. */
  includeRawHtml?: boolean;
  /** Hard ceiling on the snapshot, so one capture cannot fill the database. */
  maxRawHtmlBytes?: number;
}

function safely<T>(label: string, warnings: string[], fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    warnings.push(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

/**
 * Snapshot the results column, not the document.
 *
 * A whole Google page is megabytes of inlined script and style that no future
 * parser will read. The results column is the part worth keeping, and keeping
 * it small is what makes storing hundreds of captures reasonable.
 */
function snapshot(doc: Document, maxBytes: number): string | undefined {
  const root = pick(doc, SNAPSHOT_ROOTS) ?? doc.body;
  if (!root) return undefined;
  const html = (root as HTMLElement).outerHTML ?? '';
  if (!html) return undefined;
  return html.length > maxBytes ? `${html.slice(0, maxBytes)}<!-- truncated at ${maxBytes} bytes -->` : html;
}

export function collectSerp(doc: Document, pageUrl: string, opts: CollectOptions = {}): SerpData {
  const started = Date.now();
  const warnings: string[] = [];

  const organicResult = safely('organic', warnings, () => parseOrganic(doc, pageUrl), {
    organic: [],
    ads: [],
    containersDetected: 0,
    rejected: [],
    warnings: ['organic parser did not run'],
  });
  warnings.push(...organicResult.warnings);

  const paa = safely('paa', warnings, () => parsePAA(doc, pageUrl), []);
  const aiOverview = safely('aiOverview', warnings, () => parseAIOverview(doc, pageUrl), {
    present: false,
    sources: [],
  });
  const featuredSnippet = safely('featuredSnippet', warnings, () => parseFeaturedSnippet(doc, pageUrl), {
    present: false,
  });
  const serpFeatures = safely<SerpFeature[]>('features', warnings, () => detectFeatures(doc), []);
  const relatedSearches = safely('relatedSearches', warnings, () => parseRelatedSearches(doc), []);
  const peopleAlsoSearchFor = safely('peopleAlsoSearchFor', warnings, () => parsePeopleAlsoSearchFor(doc), []);

  const knowledgePanelTitle =
    safely('knowledgePanel', warnings, () => text(pick(doc, ['#rhs h2', 'div.kp-wholepage h2'])), '') || undefined;

  const metadata = parseMetadata(doc, pageUrl, {
    organic: organicResult.organic.length,
    ads: organicResult.ads.length,
    paa: paa.length,
    features: serpFeatures,
  });

  const rawHtml = opts.includeRawHtml
    ? safely('snapshot', warnings, () => snapshot(doc, opts.maxRawHtmlBytes ?? 1_500_000), undefined)
    : undefined;

  return {
    id: uuid(),
    metadata,
    organicResults: organicResult.organic,
    ads: organicResult.ads,
    paa,
    aiOverview: aiOverview.present ? aiOverview : undefined,
    featuredSnippet: featuredSnippet.present ? featuredSnippet : undefined,
    serpFeatures,
    relatedSearches,
    peopleAlsoSearchFor,
    knowledgePanelTitle,
    diagnostics: {
      containersDetected: organicResult.containersDetected,
      validOrganic: organicResult.organic.length,
      rejected: organicResult.rejected,
      paaDetected: paa.length,
      aiOverview: aiOverview.present ? 'detected' : 'not detected',
      localPack: serpFeatures.includes('local_pack') ? 'detected' : 'not detected',
      parserVersion: PARSER_VERSION,
      warnings,
      durationMs: Date.now() - started,
    },
    rawHtml,
    collectedAt: new Date().toISOString(),
  };
}

export { isGoogleSerp } from './metadata';

/*
 * Exported for the tests. domainFromCite is the one helper worth asserting on
 * directly: it is pure string work standing in for a URL parser that Chrome and
 * Node disagree about, and that disagreement is invisible through collectSerp.
 */
export { domainFromCite } from './utils';
export { expandPAA } from './paa';
