/**
 * Which SERP features are on the page.
 *
 * Presence only — the content of a feature is extracted by its own module when
 * it is worth extracting. A feature is reported only when a marker actually
 * matches, so an empty list means "none detected", never "not checked".
 */
import type { FeaturedSnippet, SerpFeature } from '../types/serp';
import { FEATURED_SNIPPET, FEATURE_MARKERS } from './selectors';
import { cleanUrl, domainOf, isGoogleInternal, pick, pickAll, text } from './utils';

/**
 * A marker only counts if the thing it marks actually has content.
 *
 * Google ships `#tads` and `#bottomads` on every results page whether or not
 * there are any ads — both were present, with zero children text and zero
 * links, on two real captures that had no advertising at all. Presence of the
 * container reported `ads` on every SERP.
 *
 * That is not a cosmetic error. "Does this query have advertiser competition?"
 * is a real input to keyword prioritisation, and a flag that is always true
 * carries no information.
 */
function hasContent(el: Element): boolean {
  if (el.querySelector('a[href], img, video, g-img')) return true;
  // text() strips <script>/<style>: Google inlines several KB of JavaScript
  // inside #tads, which textContent would happily count as "content".
  return text(el).length >= 10;
}

export function detectFeatures(doc: Document): SerpFeature[] {
  const found: SerpFeature[] = [];
  for (const [feature, selectors] of Object.entries(FEATURE_MARKERS)) {
    const matches = pickAll(doc, selectors);
    if (matches.some(hasContent)) found.push(feature as SerpFeature);
  }
  return found;
}

export function parseFeaturedSnippet(doc: Document, pageUrl: string): FeaturedSnippet {
  const container = pick(doc, FEATURED_SNIPPET);
  if (!container) return { present: false };

  const body = text(container);
  let sourceUrl: string | undefined;
  for (const a of pickAll(container, ['a[href]'])) {
    const url = cleanUrl(a.getAttribute('href'), pageUrl);
    if (url && !isGoogleInternal(url)) {
      sourceUrl = url;
      break;
    }
  }

  return {
    present: true,
    text: body || undefined,
    sourceUrl,
    sourceDomain: sourceUrl ? domainOf(sourceUrl) : undefined,
  };
}
