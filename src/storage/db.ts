/**
 * Local storage. IndexedDB, owned by the extension.
 *
 * Not chrome.storage.local: that has a quota measured in megabytes and every
 * write serialises the whole value. Raw SERP snapshots are hundreds of
 * kilobytes each and the point is to keep hundreds of them.
 *
 * This module must only ever run in the service worker or an extension page.
 * A content script's IndexedDB belongs to google.com, so storing there would
 * scatter captures across whichever Google domain happened to be open and lose
 * them the moment site data is cleared.
 *
 * Two stores, on purpose. `serps` holds the full record including rawHtml;
 * `summaries` holds the row the history list shows. Listing a hundred captures
 * reads a hundred small objects rather than a hundred snapshots.
 */
import type { SerpData, SerpSummary } from '../types/serp';

const DB_NAME = 'serp-reader';
const DB_VERSION = 1;
const SERPS = 'serps';
const SUMMARIES = 'summaries';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SERPS)) db.createObjectStore(SERPS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SUMMARIES)) {
        const s = db.createObjectStore(SUMMARIES, { keyPath: 'id' });
        s.createIndex('collectedAt', 'collectedAt');
        s.createIndex('query', 'query');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        let out: Promise<T> | T;
        try {
          out = fn(t);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => Promise.resolve(out).then(resolve, reject);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

const asPromise = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function summarise(d: SerpData): SerpSummary {
  return {
    id: d.id,
    query: d.metadata.query,
    collectedAt: d.collectedAt,
    organicResultCount: d.organicResults.length,
    paaCount: d.paa.length,
    features: d.serpFeatures,
    hasAiOverview: Boolean(d.aiOverview?.present),
    googleDomain: d.metadata.googleDomain,
    country: d.metadata.country,
  };
}

export async function saveSerp(data: SerpData): Promise<SerpSummary> {
  const summary = summarise(data);
  await tx([SERPS, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(SERPS).put(data);
    t.objectStore(SUMMARIES).put(summary);
  });
  return summary;
}

export function getSerp(id: string): Promise<SerpData | undefined> {
  return tx(SERPS, 'readonly', (t) => asPromise(t.objectStore(SERPS).get(id) as IDBRequest<SerpData | undefined>));
}

export async function listSummaries(): Promise<SerpSummary[]> {
  const all = await tx(SUMMARIES, 'readonly', (t) =>
    asPromise(t.objectStore(SUMMARIES).getAll() as IDBRequest<SerpSummary[]>),
  );
  return all.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

export function getAllSerps(): Promise<SerpData[]> {
  return tx(SERPS, 'readonly', (t) => asPromise(t.objectStore(SERPS).getAll() as IDBRequest<SerpData[]>));
}

export function deleteSerp(id: string): Promise<void> {
  return tx([SERPS, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(SERPS).delete(id);
    t.objectStore(SUMMARIES).delete(id);
  });
}

export function clearAll(): Promise<void> {
  return tx([SERPS, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(SERPS).clear();
    t.objectStore(SUMMARIES).clear();
  });
}

export async function count(): Promise<number> {
  return tx(SUMMARIES, 'readonly', (t) => asPromise(t.objectStore(SUMMARIES).count()));
}
