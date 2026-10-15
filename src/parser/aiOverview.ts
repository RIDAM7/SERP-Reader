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
import {
  canonicalKey, cleanLabel, closestAny, domainFromMarkup, domainFromSourceRecord, domainOf, firstGroup, isGoogleInternal,
  pick, pickAll, resolveHref, text, textFrom,
} from './utils';

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
 *
 * Never a wrapper inside People Also Ask. An expanded PAA answer can be an AI
 * answer drawn by the same component, with its own wrappers and cards, and the
 * longest text wins: on "entities in seo" (2026-09-05) a 78,623-character PAA
 * answer beat the 10,767-character overview, and its chips were recorded as
 * the overview's. A slot whose every wrapper is inside PAA has no overview.
 */
function bestContainer(doc: Document): Element | null {
  const candidates = pickAll(doc, AI_OVERVIEW.containers).filter((c) => !closestAny(c, AI_OVERVIEW.notInside));
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
 * Citations from the source cards: one per card, in the cards' own order.
 *
 * Google's AI Mode component, which draws overviews and AI Mode replies alike
 * from 2026-10, labels its chips with site names, not domains. On the 9 AI Mode
 * replies among prokopi.in's 2026-10-15 captures the chips gave 0 to 2
 * citations each, against 7 to 19 cards. A card's link is a signed /goto, so
 * its domain is read from the card's markup, failing that from the source
 * record the slot keeps for that exact link, and its site name is kept beside
 * it. A card with neither keeps an empty domain and its site name: none on
 * those captures, which is not a promise about the next ones.
 *
 * Two cards for one domain are two cited pages and stay two entries. A card
 * repeated with the same link counts once, and a card with no link (one
 * "Google" card in 633) is not a citation.
 *
 * `li.Ioqnib` is the 2026-10 card and `li.h7wxwc` the 2026-09 one, the same
 * shape: a signed /goto, the origin in a favicon request, a site name. The
 * slot holds one card list. The second h7wxwc list that 16 of the 90 2026-09
 * captures carry is inside People Also Ask, an expanded answer's own sources,
 * and bestContainer never picks a wrapper there.
 */
function cardSources(container: Element, pageUrl: string): CitedSource[] {
  const out: CitedSource[] = [];
  const seen = new Set<string>();
  let slotHtml: string | null = null;
  const fromRecord = (href: string | null) => domainFromSourceRecord((slotHtml ??= container.outerHTML ?? ''), href);

  for (const card of firstGroup(container, AI_OVERVIEW.sourceCards)) {
    const anchor = pick(card, AI_OVERVIEW.sourceCardLink);
    const resolved = anchor ? resolveHref(anchor.getAttribute('href'), pageUrl) : null;
    if (!anchor || !resolved) continue;
    if (!resolved.isRedirect && isGoogleInternal(resolved.url)) continue;
    const key = resolved.isRedirect ? resolved.url : canonicalKey(resolved.url);
    if (seen.has(key)) continue;
    seen.add(key);

    const siteName = textFrom(card, AI_OVERVIEW.sourceCardSiteName) || undefined;
    const source: CitedSource = {
      title: cleanLabel(anchor.getAttribute('aria-label')) || text(anchor) || undefined,
      url: resolved.url,
      domain: resolved.isRedirect
        ? domainFromMarkup(card) || fromRecord(anchor.getAttribute('href'))
        : domainOf(resolved.url).toLowerCase(),
      order: out.length + 1,
    };
    if (siteName) source.siteName = siteName;
    out.push(source);
  }
  return out;
}

/**
 * Citations, found via the visible domain chips rather than the anchors.
 *
 * The fallback for an overview without source cards: Google's markup until
 * 2026-10, and the synthetic fixtures.
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

/**
 * Hidden in the markup itself: an inline display:none or visibility:hidden, or
 * the `hidden` attribute, on the element or any ancestor.
 *
 * Markup only, never getComputedStyle, so a live capture and a re-parse of its
 * snapshot under Node give the same answer — the lesson of domainFromCite. It is
 * enough for the placeholder: on all 164 captures to 2026-10-15 Google hid it
 * with an inline style. aria-hidden is not hiding: it hides from screen
 * readers, not from the eye.
 */
function hiddenInMarkup(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const style = (e.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
    if (style.includes('display:none') || style.includes('visibility:hidden') || e.hasAttribute('hidden')) return true;
  }
  return false;
}

/** Google visibly saying it has no overview: the placeholder, not hidden. */
function placeholderShown(container: Element): boolean {
  for (const el of Array.from(container.querySelectorAll('*'))) {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('');
    if (/An AI Overview is not available for this search/i.test(own) && !hiddenInMarkup(el)) return true;
  }
  return false;
}

/**
 * The slot's own label, visible. English only: hl=en is what the captures use,
 * and a Hindi label reads as "no label", which can only move a reply-shaped
 * slot to ai_mode_reply — never an overview without an AI Mode marker.
 */
function overviewLabelShown(doc: Document): boolean {
  return pickAll(doc, AI_OVERVIEW.label).some((el) => /^AI Overview$/i.test(text(el)) && !hiddenInMarkup(el));
}

/** The AI Mode reply component's own heading: "AI Mode reply for <query>" or "AI Mode replied:". */
function aiModeMarker(container: Element): boolean {
  return pickAll(container, AI_OVERVIEW.aiModeLabel).some((el) => /^AI Mode repl(y for|ied)\b/i.test(text(el)));
}

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
  const cards = cardSources(container, pageUrl);
  const sources = cards.length ? cards : citations(container, pageUrl);
  const substantive = body.replace(AIO_PLACEHOLDER, '').trim();
  const refused = placeholderShown(container);
  if (!sources.length && substantive.length < 40) {
    return refused ? { present: false, status: 'unavailable', sources: [] } : { present: false, sources: [] };
  }

  /*
   * An AI Mode reply in the slot is not an overview.
   *
   * Google renders both with the same AI Mode component, so its marker is in
   * real overviews too: "AI Mode replied:" sits inside 69 of the 92 2026-09
   * captures, every one under a visible "AI Overview" label. What separates a
   * reply is the slot saying so — no label at all (9 of the 72 prokopi.in
   * captures of 2026-10-15, each headed "AI Mode reply for <query>"), or the
   * placeholder shown rather than hidden.
   *
   * The other 63 of those 72 read, as text, "An AI Overview is not available
   * for this search … AI Mode replied: …", which is how they were first counted
   * as replies. The placeholder there is the hidden one above, and the label is
   * visible: rendered overviews, by the same measure that made this function
   * stop counting the placeholder in a217940.
   *
   * Content without either marker stays an overview, so older markup and
   * anything Google ships next keeps the meaning `present` had.
   */
  const status = aiModeMarker(container) && (refused || !overviewLabelShown(doc)) ? 'ai_mode_reply' : 'rendered';

  const bullets = pickAll(container, AI_OVERVIEW.bullets)
    .map((li) => text(li))
    .filter((t) => t.length > 2)
    .slice(0, 40);

  const headings = pickAll(container, AI_OVERVIEW.heading)
    .map((h) => text(h))
    .filter(Boolean)
    .slice(0, 20);

  return {
    present: status === 'rendered',
    status,
    heading,
    text: body || undefined,
    headings: headings.length ? headings : undefined,
    bullets: bullets.length ? bullets : undefined,
    sources,
  };
}
