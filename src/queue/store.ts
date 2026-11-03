/**
 * Queue and settings state, in chrome.storage.local.
 *
 * Not IndexedDB, which holds the captures: this is a few kilobytes, and
 * chrome.storage is the one store the content script, the popup and the worker
 * all see as the extension's own. In Incognito too, where an extension runs
 * "spanning" and shares it with the normal profile.
 */
import { nextItem, sameSearch, withItem, type Queue, type QueueItem } from './queue';

export interface Settings {
  expandPaa: boolean;
  includeRawHtml: boolean;
}

/** PAA answers on by default: the answers and their sources are what the research reads. */
export const DEFAULT_SETTINGS: Settings = { expandPaa: true, includeRawHtml: true };

/** A search opened from the queue and not captured yet. */
export interface Pending {
  url: string;
  openedAt: number;
}

/**
 * How long an opened search waits to be captured. Long enough for a slow load,
 * or a "confirm you're not a robot" page the person answers themselves; short
 * enough that a later visit to the same search is not taken for this one.
 */
export const PENDING_TTL_MS = 3 * 60_000;

const KEYS = { settings: 'settings', queue: 'queue', pending: 'queue-pending' } as const;

async function get<T>(key: string): Promise<T | undefined> {
  const found = await chrome.storage.local.get(key);
  return found[key] as T | undefined;
}

const set = (key: string, value: unknown) => chrome.storage.local.set({ [key]: value });

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await get<Partial<Settings>>(KEYS.settings)) };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await set(KEYS.settings, { ...(await getSettings()), ...patch });
}

export async function getQueue(): Promise<Queue | null> {
  return (await get<Queue>(KEYS.queue)) ?? null;
}

export async function setQueue(q: Queue | null): Promise<void> {
  if (q) await set(KEYS.queue, q);
  else await chrome.storage.local.remove([KEYS.queue, KEYS.pending]);
}

export async function updateItem(url: string, patch: Partial<QueueItem>): Promise<void> {
  const q = await getQueue();
  if (q && q.items.some((i) => sameSearch(i.url, url))) await set(KEYS.queue, withItem(q, url, patch));
}

/**
 * Open the next pending search: remember it, then hand its URL to `navigate`.
 * Only ever called from a person's click. Undefined when nothing is left.
 */
export async function openNext(navigate: (url: string) => unknown): Promise<QueueItem | undefined> {
  const item = nextItem(await getQueue());
  if (!item) return undefined;
  const pending: Pending = { url: item.url, openedAt: Date.now() };
  await set(KEYS.pending, pending);
  await navigate(item.url);
  return item;
}

/**
 * The queue search this page is, when it was opened from the queue moments
 * ago. Taking it clears it, so a reload captures nothing a second time.
 */
export async function takePending(pageUrl: string): Promise<Pending | undefined> {
  const p = await get<Pending>(KEYS.pending);
  if (!p || !sameSearch(p.url, pageUrl) || Date.now() - p.openedAt > PENDING_TTL_MS) return undefined;
  await chrome.storage.local.remove(KEYS.pending);
  return p;
}

export function onQueueChange(fn: (q: Queue | null) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEYS.queue in changes) fn((changes[KEYS.queue].newValue as Queue | undefined) ?? null);
  });
}
