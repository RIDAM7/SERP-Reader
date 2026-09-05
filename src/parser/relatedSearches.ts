/**
 * Related searches and "People also search for".
 *
 * Short, clean phrases only. The containers Google uses for these also hold
 * chips, filters and "Report inappropriate predictions", so anything that reads
 * like UI rather than a query is dropped.
 */
import { PEOPLE_ALSO_SEARCH_FOR, RELATED_SEARCHES } from './selectors';
import { pickAll, text } from './utils';

const UI_NOISE =
  /^(report inappropriate|feedback|more|next|previous|settings|tools|images|videos|news|maps|shopping|books|flights|finance|all)$/i;

function harvest(root: ParentNode, containers: string[], items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of pickAll(root, containers)) {
    for (const el of pickAll(c, items)) {
      const t = text(el);
      if (!t || t.length < 3 || t.length > 90) continue;
      if (UI_NOISE.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out.slice(0, 30);
}

export function parseRelatedSearches(doc: Document): string[] {
  return harvest(doc, RELATED_SEARCHES.containers, RELATED_SEARCHES.items);
}

export function parsePeopleAlsoSearchFor(doc: Document): string[] {
  return harvest(doc, PEOPLE_ALSO_SEARCH_FOR, ['a', 'div[role="link"]', 'span']);
}
