/**
 * People Also Ask.
 *
 * Answers are mostly lazy: Google ships the questions in the DOM and fetches
 * an answer body only when one is opened, though now and then the first
 * question's answer arrives already rendered and collapsed. So a plain read
 * returns questions with few or no answers, which is the honest default —
 * `expanded: false` says the answer was never rendered rather than implying it
 * was empty.
 *
 * `expandPAA` opens them one at a time, with a pause between each. That is a
 * deliberate speed limit, not an oversight: this is a reader driven by a person
 * clicking a button, and hammering the accordion would make it look like
 * something else.
 */
import type { PAAItem } from '../types/serp';
import { cardSources } from './aiOverview';
import { PAA } from './selectors';
import { cleanUrl, closestAny, domainOf, isGoogleInternal, pick, pickAll, text, textFrom } from './utils';

function questionOf(container: Element): string {
  const attr = container.getAttribute('data-q') ?? container.getAttribute('data-initq');
  if (attr?.trim()) return attr.trim();
  const q = textFrom(container, PAA.question);
  if (q) return q;
  // On the current layout the toggle's own text IS the question.
  return text(container);
}

/**
 * Is this actually a question, or a section label that slipped through?
 *
 * A real capture produced "AI Overview" and "Write Answer-First Content" as PAA
 * entries. Neither is a question, and both came from wrapper elements. Length
 * bounds plus a question mark or an interrogative opener removes them without
 * hard-coding the specific strings that happened to leak.
 */
function looksLikeQuestion(q: string): boolean {
  if (q.length < 8 || q.length > 200) return false;
  if (q.includes('{') || q.includes('}')) return false; // leaked CSS
  return q.includes('?') || /^(how|what|why|when|where|who|which|is|are|can|does|do|should|will)\b/i.test(q);
}

/**
 * The accordion toggle a container opens with.
 *
 * On today's layout the container IS the toggle: PAA.containers picks the
 * elements carrying aria-expanded. The expand pass used to search inside it
 * for a toggle, found none, and reached the toggle only through the question's
 * pair, then a second time through the whole block, whose first toggle that
 * second click closed again. Older layouts wrap the toggle, so a descendant is
 * still looked for.
 */
function toggleOf(container: Element): HTMLElement | null {
  if (container.hasAttribute('aria-expanded') || container.getAttribute('role') === 'button') {
    return container as HTMLElement;
  }
  return pick(container, PAA.toggle) as HTMLElement | null;
}

/**
 * Where a question's answer renders.
 *
 * Not inside the toggle, which holds the question alone. Google draws the
 * answer in a sibling region, div.bCOlv, that the toggle names in
 * aria-controls; before the answer loads it holds a spinner, a hidden "An
 * error has occurred" line and three "Ask anything in AI Mode" chips, none of
 * which PAA.answer matches. A toggle naming no region falls back to the
 * question's own pair.
 */
function answerRegion(el: Element): Element {
  for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)) {
    const region = el.ownerDocument?.getElementById(id);
    if (region) return region;
  }
  return closestAny(el, PAA.pair) ?? el;
}

/**
 * The answer's source.
 *
 * An AI answer cites source cards, each a signed /goto, and the first card is
 * read as the overview's are: its link, and its domain from the card's markup
 * or the region's source record. A snippet answer has a direct link instead.
 */
function sourceOf(region: Element, pageUrl: string): { url?: string; domain?: string } {
  const card = cardSources(region, pageUrl)[0];
  if (card) return { url: card.url, domain: card.domain || undefined };
  for (const a of pickAll(region, PAA.sourceLink)) {
    const url = cleanUrl(a.getAttribute('href'), pageUrl);
    if (url && !isGoogleInternal(url)) return { url, domain: domainOf(url) };
  }
  return {};
}

const answerOf = (el: Element): string => textFrom(answerRegion(el), PAA.answer);

export function parsePAA(doc: Document, pageUrl: string): PAAItem[] {
  const containers = pickAll(doc, PAA.containers);
  const out: PAAItem[] = [];
  const seen = new Set<string>();
  /*
   * One toggle, one question. A container whose toggle is already read is the
   * same question's pair, or the whole block, whose data-initq is the search
   * itself: "how to get recommended by chatgpt" was recorded as one of its own
   * PAA questions that way.
   */
  const read = new Set<Element>();

  for (const c of containers) {
    const toggle = toggleOf(c);
    if (toggle && read.has(toggle)) continue;
    const question = questionOf(c);
    if (!question || !looksLikeQuestion(question)) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (toggle) read.add(toggle);

    const region = answerRegion(toggle ?? c);
    const answer = textFrom(region, PAA.answer);
    const { url, domain } = sourceOf(region, pageUrl);

    out.push({
      order: out.length + 1,
      question,
      answer: answer || undefined,
      sourceUrl: url,
      sourceDomain: domain,
      expanded: Boolean(answer),
    });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The pause, then up to `timeoutMs` more for the answer to finish.
 *
 * An AI answer streams in after the click, so the first text to appear is not
 * the answer yet. Finished means the text stopped growing across two polls.
 */
async function settle(toggle: Element, delayMs: number, timeoutMs: number): Promise<void> {
  await sleep(delayMs);
  const until = Date.now() + timeoutMs;
  let last = -1;
  let steady = 0;
  while (Date.now() < until) {
    const len = answerOf(toggle).length;
    steady = len > 0 && len === last ? steady + 1 : 0;
    if (steady >= 2) return;
    last = len;
    await sleep(250);
  }
}

/**
 * Open each question, wait for its answer to render, and re-read.
 *
 * Optional. Each toggle is clicked once, and never when it is open or its
 * answer is already rendered, because a click there closes it. Each is
 * scrolled into view first, so the person watching sees which one is opening.
 * Google adds questions below the ones opened; those are read, not opened.
 * Returns the re-parsed list; on any failure it returns what it has rather
 * than throwing, because a partial expansion is still more than none.
 */
export async function expandPAA(
  doc: Document,
  pageUrl: string,
  opts: { delayMs?: number; max?: number; timeoutMs?: number; onProgress?: (n: number, of: number) => void } = {},
): Promise<PAAItem[]> {
  const delay = opts.delayMs ?? 700;
  const max = opts.max ?? 10;
  const timeout = opts.timeoutMs ?? 5000;

  const toggles = new Set<HTMLElement>();
  for (const c of pickAll(doc, PAA.containers)) {
    const toggle = toggleOf(c);
    if (toggle && looksLikeQuestion(questionOf(c))) toggles.add(toggle);
  }
  const closed = (t: HTMLElement) => t.getAttribute('aria-expanded') !== 'true' && !answerOf(t);
  const todo = [...toggles].filter(closed).slice(0, max);

  for (const [i, toggle] of todo.entries()) {
    if (!closed(toggle)) continue;
    opts.onProgress?.(i + 1, todo.length);
    try {
      toggle.scrollIntoView?.({ block: 'center' });
      toggle.click();
    } catch {
      continue;
    }
    await settle(toggle, delay, timeout);
  }

  return parsePAA(doc, pageUrl);
}

export const _internal = { questionOf, text };
