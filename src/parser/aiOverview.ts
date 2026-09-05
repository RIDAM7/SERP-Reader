/**
 * AI Overview — the reason this tool exists for GEO work.
 *
 * The citations matter more than the prose. "Who does Google quote when
 * answering this" is the closest thing to a measurable answer to the GEO
 * question, and it is not available from any keyword tool.
 *
 * Reads only what is already rendered. An AI Overview that has not finished
 * streaming, or that sits behind a "Show more", yields whatever is on screen —
 * `present: true` with partial text, never a guess at the rest.
 */
import type { AIOverview, CitedSource } from '../types/serp';
import { AI_OVERVIEW } from './selectors';
import { pickAll, resolveHref, text, textFrom } from './utils';

/** A bare domain used as a citation chip: `forbes.com`, `seobility.net`. */
const BARE_DOMAIN = /^(?=.{4,80}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/i;

/**
 * `robots.txt` is not a website.
 *
 * BARE_DOMAIN matches any `word.word`, so filenames written in the AI
 * Overview's prose were recorded as cited domains. On "shopify seo
 * optimization" two of the eleven citations came back as `robots.txt` and
 * `sitemap.xml`.
 *
 * Not a rare edge either: an SEO research tool reads answers about robots.txt,
 * sitemap.xml, llms.txt and ads.txt constantly, so the contaminant tracks the
 * subject matter. `robots.txt.liquid` arrived later, out of a Shopify answer —
 * the list grows with the corpus.
 *
 * This is a blocklist, and blocklists lose. The principled fix is to check the
 * last label against the real TLD list, and it was NOT taken because this
 * corpus is full of unusual ones a partial list would wrongly reject:
 * `cumberland.college`, `hallam.agency`, `mrs.digital`, `omnius.so`,
 * `shadow.inc`, `evertune.ai`, `technotize.io`, `radarkit.ai`. Dropping a real
 * citation is worse than admitting the occasional filename, so the trade is
 * deliberate rather than lazy.
 *
 * Extensions that are also real TLDs (.md, .zip, .mov, .sh, .py) stay out — a
 * Moldovan domain is likelier here than a README.
 */
const FILENAME =
  /[.](txt|xml|json|html?|css|js|php|aspx?|jsp|csv|tsv|pdf|png|jpe?g|gif|svg|webp|ico|liquid|ya?ml|htaccess|conf|config|ini|lock|toml|env|sql|tpl|twig|hbs|ejs|scss|less)$/i;

/**
 * The container holding the most text, not the first one that matches.
 *
 * Several of Google's AI Overview wrappers match the same selectors, and the
 * first in DOM order is often the `AI Overview` label alone — eleven characters
 * and no citations. Measured on a real capture: `div.Fzsovc` matched first with
 * 11 characters while `div.YzCcne` held the actual answer and 31 links.
 *
 * Picking by content survives Google renaming or reordering those wrappers,
 * which selector ordering does not.
 */
function bestContainer(doc: Document): Element | null {
  const candidates = pickAll(doc, AI_OVERVIEW.containers);
  let best: Element | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    /*
     * Raw textContent, deliberately, even though it counts inlined script.
     *
     * Measuring visible text instead looks obviously more correct and is not:
     * it changed the winner on two real captures and cost most of their
     * citations — "geo vs seo" went from 8 domains to 1, "answer engine
     * optimization" from 7 to 1. The citation-bearing container is the one
     * carrying the most markup, script included; a smaller, cleaner wrapper
     * nested inside it wins on visible text alone and holds almost no chips.
     */
    const len = (c.textContent ?? '').length;
    if (len > bestLen) {
      best = c;
      bestLen = len;
    }
  }
  // A wrapper with almost nothing in it is a label, not an overview.
  return bestLen >= 60 ? best : (candidates[0] ?? null);
}

/**
 * Citations, found via the visible domain chips rather than the anchors.
 *
 * The anchors are useless on their own: their text is empty, they carry no
 * `cite`, and their href is a `/goto` redirect. What is readable is the chip
 * showing `forbes.com`, plus the anchor's `aria-label`
 * ("Forbes (+1) – Answer Engine Optimization — What Brands...") for a title.
 *
 * So the domain leads and the link follows, which is the right way round for
 * this data anyway: GEO analysis counts domains.
 */
function citations(container: Element, pageUrl: string): CitedSource[] {
  const out: CitedSource[] = [];
  const seen = new Set<string>();

  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (el.children.length > 0) continue;
    const label = (el.textContent ?? '').trim();
    if (!BARE_DOMAIN.test(label) || FILENAME.test(label)) continue;

    const domain = label.toLowerCase().replace(/^www\./, '');
    if (seen.has(domain)) continue;
    seen.add(domain);

    const anchor = el.closest('a[href]') ?? el.parentElement?.querySelector('a[href]') ?? null;
    const resolved = anchor ? resolveHref(anchor.getAttribute('href'), pageUrl) : null;
    const title = anchor?.getAttribute('aria-label')?.trim() || undefined;

    out.push({
      title,
      url: resolved?.url ?? '',
      domain,
      order: out.length + 1,
    });
  }
  return out;
}

/**
 * Google ships this hidden on essentially every SERP, overview or not.
 *
 * Measured: 73 of 75 US captures contain it, including every one that plainly
 * DID render an overview. It is a placeholder element, not a statement about
 * this search — which makes it useless as a signal and actively misleading if
 * you count it. An earlier read of this corpus reported "73 of 75 searches
 * could not generate an overview", which was this string and nothing else.
 */
const AIO_PLACEHOLDER =
  /An AI Overview is not available for this search|Can't generate an AI overview right now|Try again later/gi;

export function parseAIOverview(doc: Document, pageUrl: string): AIOverview {
  const container = bestContainer(doc);
  if (!container) return { present: false, sources: [] };

  const heading = textFrom(container, AI_OVERVIEW.heading) || undefined;
  const body = text(container);

  /*
   * `present` must mean an overview rendered, not that a container existed.
   *
   * bestContainer matches on selectors, and Google leaves the wrapper in the
   * DOM even when nothing is shown. On "shopify seo help" that produced
   * present: true against an entirely empty box — and the same capture's
   * serpFeatures correctly omitted ai_overview, because detectFeatures applies
   * a content check that this function did not. Two fields on one record
   * disagreeing about the same fact is worse than either answer.
   *
   * Content means a citation, or real text once the placeholder above is
   * removed. Both are absent from an empty wrapper.
   */
  const sources = citations(container, pageUrl);
  const substantive = body.replace(AIO_PLACEHOLDER, '').trim();
  if (!sources.length && substantive.length < 40) return { present: false, sources: [] };

  const bullets = pickAll(container, AI_OVERVIEW.bullets)
    .map((li) => text(li))
    .filter((t) => t.length > 2)
    .slice(0, 40);

  const headings = pickAll(container, AI_OVERVIEW.heading)
    .map((h) => text(h))
    .filter(Boolean)
    .slice(0, 20);

  return {
    present: true,
    heading,
    text: body || undefined,
    headings: headings.length ? headings : undefined,
    bullets: bullets.length ? bullets : undefined,
    sources,
  };
}
