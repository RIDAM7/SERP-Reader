/**
 * What the URL and page say about the search itself.
 *
 * Every field here comes from the URL or the rendered page. The location
 * parameters matter more than they look: a capture with no `gl` is a capture
 * from wherever the browser was, and six months later nobody remembers where
 * that was. Recording `gl`, `hl`, `uule` and `pws` is what makes a capture
 * comparable to the next one.
 */
import type { SerpFeature, SerpMetadata } from '../types/serp';

const GOOGLE_SEARCH = /^\/(search|webhp)$/;

export function isGoogleSerp(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && GOOGLE_SEARCH.test(u.pathname);
  } catch {
    return false;
  }
}

export function parseMetadata(
  doc: Document,
  pageUrl: string,
  counts: { organic: number; ads: number; paa: number; features: SerpFeature[] },
): SerpMetadata {
  let u: URL;
  try {
    u = new URL(pageUrl);
  } catch {
    u = new URL('https://www.google.com/search');
  }
  const p = u.searchParams;

  const query = p.get('q') ?? p.get('query') ?? '';
  const num = Number(p.get('num'));

  /*
   * Device is read from the URL and the viewport rather than the user agent:
   * this runs in whatever browser the person is using, and a narrow window on a
   * desktop genuinely returns the mobile layout, which is what the capture
   * should say.
   */
  const width = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const device: 'desktop' | 'mobile' = width > 0 && width < 768 ? 'mobile' : 'desktop';

  return {
    query,
    url: pageUrl,
    googleDomain: u.hostname,
    language: p.get('hl') ?? doc.documentElement.getAttribute('lang') ?? undefined,
    country: p.get('gl') ?? undefined,
    uule: p.get('uule') ?? undefined,
    requestedResults: Number.isFinite(num) && num > 0 ? num : undefined,
    personalisationDisabled: p.get('pws') === '0' ? true : undefined,
    device,
    timestamp: new Date().toISOString(),
    organicResultCount: counts.organic,
    adCount: counts.ads,
    paaCount: counts.paa,
    features: counts.features,
  };
}
