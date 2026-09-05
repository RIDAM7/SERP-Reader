/**
 * People Also Ask.
 *
 * Answers are lazy: Google ships the questions in the DOM and fetches the
 * answer body only when one is opened. So a plain read returns questions with
 * no answers, which is the honest default — `expanded: false` says the answer
 * was never rendered rather than implying it was empty.
 *
 * `expandPAA` opens them one at a time, with a pause between each. That is a
 * deliberate speed limit, not an oversight: this is a reader driven by a person
 * clicking a button, and hammering the accordion would make it look like
 * something else.
 */
import type { PAAItem } from '../types/serp';
import { PAA } from './selectors';
import { cleanUrl, domainOf, isGoogleInternal, pick, pickAll, text, textFrom } from './utils';

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

function sourceOf(container: Element, pageUrl: string): { url?: string; domain?: string } {
  for (const a of pickAll(container, PAA.sourceLink)) {
    const url = cleanUrl(a.getAttribute('href'), pageUrl);
    if (url && !isGoogleInternal(url)) return { url, domain: domainOf(url) };
  }
  return {};
}

export function parsePAA(doc: Document, pageUrl: string): PAAItem[] {
  const containers = pickAll(doc, PAA.containers);
  const out: PAAItem[] = [];
  const seen = new Set<string>();

  for (const c of containers) {
    const question = questionOf(c);
    if (!question || !looksLikeQuestion(question)) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const answer = textFrom(c, PAA.answer);
    const { url, domain } = sourceOf(c, pageUrl);

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

/**
 * Open each question, wait for its answer to render, and re-read.
 *
 * Optional and off by default. Returns the re-parsed list; on any failure it
 * returns what it has rather than throwing, because a partial expansion is
 * still more than none.
 */
export async function expandPAA(
  doc: Document,
  pageUrl: string,
  opts: { delayMs?: number; max?: number } = {},
): Promise<PAAItem[]> {
  const delay = opts.delayMs ?? 700;
  const max = opts.max ?? 10;
  const containers = pickAll(doc, PAA.containers).slice(0, max);

  for (const c of containers) {
    const alreadyOpen = Boolean(textFrom(c, PAA.answer));
    if (alreadyOpen) continue;
    const toggle = pick(c, PAA.toggle) as HTMLElement | null;
    if (!toggle) continue;
    try {
      toggle.click();
    } catch {
      continue;
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  return parsePAA(doc, pageUrl);
}

export const _internal = { questionOf, text };
