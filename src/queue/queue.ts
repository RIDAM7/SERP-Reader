/**
 * The search queue: a list of searches, worked through one click at a time.
 *
 * Pure functions, no chrome.* here — store.ts keeps the state. A queue never
 * opens a search by itself. The person presses Next; the page that click opens
 * is captured once it settles, and the panel waits for the next press.
 *
 * Lines are Google search URLs, as the research queue files hold them, or
 * keywords. A keyword becomes the same URL those files use, the default
 * location parameters spelled out, so a capture from the queue is comparable
 * with one opened by hand.
 */
import { isGoogleSerp } from '../parser/metadata';

export type QueueStatus = 'pending' | 'done' | 'failed' | 'skipped';

export interface QueueItem {
  url: string;
  query: string;
  status: QueueStatus;
  /** The saved capture, once done. */
  serpId?: string;
  /** Why it failed, in the panel's words. */
  note?: string;
  at?: string;
}

export interface Queue {
  items: QueueItem[];
  loadedAt: string;
}

/** The location parameters every elivateseo.com capture to 2026-11-02 was taken with. */
export const DEFAULT_PARAMS: Record<string, string> = { gl: 'us', hl: 'en', pws: '0', num: '20' };

/**
 * A keyword's search URL. `%20`, not `+`: the queue files and the captures'
 * own metadata.url spell spaces that way, and the URL is what a capture is
 * matched on.
 */
export function searchUrl(keyword: string, params: Record<string, string> = DEFAULT_PARAMS): string {
  const rest = Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
  return `https://www.google.com/search?q=${encodeURIComponent(keyword.trim())}${rest}`;
}

function queryOf(url: string): string {
  try {
    return new URL(url).searchParams.get('q')?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * One item per line, in order. Blank lines and `#` comments are skipped, and a
 * search already in the list once is not added again. A URL that is not a
 * Google search with a query is rejected rather than guessed at.
 */
export function parseQueue(text: string): { items: QueueItem[]; rejected: string[] } {
  const items: QueueItem[] = [];
  const rejected: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const isUrl = /^https?:\/\//i.test(line);
    const url = isUrl ? line : searchUrl(line);
    const query = queryOf(url);
    if (!query || (isUrl && !isGoogleSerp(url))) {
      rejected.push(line);
      continue;
    }
    if (items.some((i) => sameSearch(i.url, url))) continue;
    items.push({ url, query, status: 'pending' });
  }
  return { items, rejected };
}

/**
 * Is this page that search?
 *
 * Google adds its own parameters once the page loads (sca_esv, ei, sxsrf…), so
 * the comparison is the host, the query and the location parameters, not the
 * string.
 */
export function sameSearch(a: string, b: string): boolean {
  let x: URL;
  let y: URL;
  try {
    x = new URL(a);
    y = new URL(b);
  } catch {
    return false;
  }
  if (x.hostname !== y.hostname || x.pathname !== y.pathname) return false;
  return ['q', 'gl', 'hl', 'uule'].every(
    (k) => (x.searchParams.get(k) ?? '').trim() === (y.searchParams.get(k) ?? '').trim(),
  );
}

export const nextItem = (q: Queue | null | undefined): QueueItem | undefined =>
  q?.items.find((i) => i.status === 'pending');

export function progress(q: Queue | null | undefined): Record<QueueStatus, number> & { total: number } {
  const out = { pending: 0, done: 0, failed: 0, skipped: 0, total: 0 };
  for (const i of q?.items ?? []) {
    out[i.status]++;
    out.total++;
  }
  return out;
}

/** The queue with the item for this search changed. Items are matched by search, not by index. */
export function withItem(q: Queue, url: string, patch: Partial<QueueItem>): Queue {
  return { ...q, items: q.items.map((i) => (sameSearch(i.url, url) ? { ...i, ...patch } : i)) };
}

/** Failed and skipped items back to pending, for another pass. */
export function retryable(q: Queue): Queue {
  return {
    ...q,
    items: q.items.map((i) => (i.status === 'failed' || i.status === 'skipped' ? { url: i.url, query: i.query, status: 'pending' } : i)),
  };
}
