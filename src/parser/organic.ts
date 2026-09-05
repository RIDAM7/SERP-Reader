/**
 * Organic results, and the validation that decides what counts as one.
 *
 * Grabbing every <a> on a SERP produces a few hundred links, most of which are
 * navigation, filters, ads, PAA sources, carousel items and knowledge-panel
 * references. The position numbers that come out of that are fiction, and
 * fiction is worse than a short list — a rank you cannot trust is a rank you
 * have to re-check by hand, which is the entire job this tool exists to avoid.
 *
 * So the pipeline is: candidate blocks -> a link with a heading -> reject
 * anything sponsored or inside a non-organic container -> de-duplicate by
 * canonical URL -> only then assign positions 1..n.
 *
 * Every rejection is counted by reason and surfaced in diagnostics, because
 * "17 results" and "17 results, 8 rejected as ads" are different situations and
 * only one of them means Google changed something.
 */
import type { AdResult, OrganicResult, Sitelink } from '../types/serp';
import {
  AD_MARKERS,
  DISPLAYED_URL,
  FAVICON,
  NON_ORGANIC_CONTAINERS,
  RESULT_BLOCKS,
  RESULT_ANCHOR,
  RESULT_TITLE,
  ROOTS,
  SITELINKS,
  SNIPPET,
} from './selectors';
import {
  canonicalKey,
  cleanUrl,
  domainFromCite,
  domainOf,
  isGoogleInternal,
  isInside,
  pick,
  pickAll,
  resolveHref,
  text,
  textFrom,
} from './utils';

export interface OrganicParseResult {
  organic: OrganicResult[];
  ads: AdResult[];
  containersDetected: number;
  rejected: { reason: string; count: number }[];
  warnings: string[];
}

/** The results column, or the document if Google has moved everything again. */
export function findRoot(doc: Document): ParentNode {
  return (pick(doc, ROOTS) as ParentNode | null) ?? doc;
}

function isAdBlock(block: Element): boolean {
  /*
   * The block ITSELF may be the marker. querySelector only looks at
   * descendants, so a div[data-text-ad] never matched its own marker: once ad
   * blocks became scannable they would each have been filed as an organic
   * result, putting six competitor ads into the rankings.
   */
  for (const sel of AD_MARKERS) {
    try {
      if (block.matches(sel)) return true;
    } catch {
      /* ignore a selector this DOM cannot evaluate */
    }
  }
  if (pick(block, AD_MARKERS)) return true;
  // Google labels ads with a visible "Sponsored" / "Ad" string; check only the
  // top of the block so a result *about* advertising is not misread as one.
  const head = text(block).slice(0, 40).toLowerCase();
  return /^(sponsored|ad\b|anzeige|annonce|advertentie)/.test(head);
}

function extractSitelinks(block: Element, pageUrl: string, mainUrl: string): Sitelink[] {
  const out: Sitelink[] = [];
  const seen = new Set<string>();
  for (const a of pickAll(block, SITELINKS)) {
    const url = cleanUrl(a.getAttribute('href'), pageUrl);
    const title = text(a);
    if (!url || !title || isGoogleInternal(url)) continue;
    if (canonicalKey(url) === canonicalKey(mainUrl)) continue;
    const key = canonicalKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url });
  }
  return out.slice(0, 8);
}

export function parseOrganic(doc: Document, pageUrl: string): OrganicParseResult {
  const root = findRoot(doc);
  const blocks = pickAll(root, RESULT_BLOCKS);
  const rejected = new Map<string, number>();
  const warnings: string[] = [];
  const reject = (reason: string) => rejected.set(reason, (rejected.get(reason) ?? 0) + 1);

  const organic: OrganicResult[] = [];
  const ads: AdResult[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    // A block containing other candidate blocks is a wrapper, not a result.
    // Without this, `#rso > div` double-counts everything nested inside it.
    const nested = RESULT_BLOCKS.some((sel) => {
      try {
        return Array.from(block.querySelectorAll(sel)).some((c) => c !== block && pick(c, RESULT_TITLE));
      } catch {
        return false;
      }
    });
    if (nested) {
      reject('wrapper containing other results');
      continue;
    }

    const heading = pick(block, RESULT_TITLE);
    if (!heading) {
      reject('no heading');
      continue;
    }

    const anchor = (heading.closest('a') ?? pick(block, RESULT_ANCHOR)) as HTMLAnchorElement | null;
    const resolved = resolveHref(anchor?.getAttribute('href'), pageUrl);
    if (!resolved) {
      reject('no usable link');
      continue;
    }

    const displayedUrl = textFrom(block, DISPLAYED_URL) || undefined;

    /*
     * Google now wraps every result in /goto?url=<signed blob>, so the href is
     * a google.com URL and the destination is nowhere in the DOM. Rejecting
     * those as "google-internal" threw away every result on the page — the bug
     * that made the first real capture return zero.
     *
     * A redirect is only kept when the cite breadcrumb gives a real destination
     * domain. That is the check that still excludes genuine Google-internal
     * links, which have no such cite.
     */
    const citeDomain = displayedUrl ? domainFromCite(displayedUrl) : '';
    if (resolved.isRedirect) {
      if (!citeDomain || /(^|\.)google\.[a-z.]+$/i.test(citeDomain)) {
        reject('redirect with no destination domain');
        continue;
      }
    } else if (isGoogleInternal(resolved.url)) {
      reject('google-internal link');
      continue;
    }

    const domain = resolved.isRedirect ? citeDomain : domainOf(resolved.url) || citeDomain;
    const url = resolved.url;

    const title = text(heading);
    if (!title) {
      reject('empty title');
      continue;
    }
    const snippet = textFrom(block, SNIPPET) || undefined;
    const faviconEl = pick(block, FAVICON) as HTMLImageElement | null;
    const faviconUrl = faviconEl?.getAttribute('src') ?? undefined;

    if (isAdBlock(block)) {
      ads.push({
        position: ads.length + 1,
        type: 'ad',
        title,
        url,
        domain: domain || domainOf(url),
        displayedUrl,
        snippet,
        isSponsored: true,
      });
      reject('sponsored');
      continue;
    }

    if (isInside(block, root, NON_ORGANIC_CONTAINERS)) {
      reject('inside a non-organic container');
      continue;
    }

    const key = canonicalKey(url);
    if (seen.has(key)) {
      reject('duplicate url');
      continue;
    }
    seen.add(key);

    organic.push({
      position: 0, // assigned below, after every filter has run
      type: 'organic',
      title,
      url,
      domain,
      urlIsRedirect: resolved.isRedirect || undefined,
      displayedUrl,
      snippet,
      faviconUrl,
      sitelinks: extractSitelinks(block, pageUrl, url) || undefined,
      isSponsored: false,
    });
  }

  organic.forEach((r, i) => {
    r.position = i + 1;
    if (r.sitelinks && r.sitelinks.length === 0) delete r.sitelinks;
  });

  if (blocks.length === 0) warnings.push('No result blocks matched. Google may have changed its layout.');
  else if (organic.length === 0) warnings.push('Blocks were found but none validated as organic.');

  return {
    organic: organic.slice(0, 25),
    ads,
    containersDetected: blocks.length,
    rejected: [...rejected.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    warnings,
  };
}
