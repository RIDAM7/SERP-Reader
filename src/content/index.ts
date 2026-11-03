/**
 * Content script: reads the SERP that is already on screen.
 *
 * It never searches on its own. A capture happens because a person pressed a
 * button — Collect in the popup or the floating panel, or Next on a queue.
 * Next is the one place it navigates: it opens the search the person asked for
 * with that click, and the page it lands on is captured once it settles.
 *
 * Storage is not done here. This script runs in google.com's origin, so its
 * IndexedDB would belong to Google rather than the extension; the parsed record
 * is handed to the service worker, which owns the database.
 */
import { collectSerp, expandPAA, isGoogleSerp } from '../parser';
import { parsePAA } from '../parser/paa';
import { nextItem, progress, type Queue } from '../queue/queue';
import { getQueue, getSettings, onQueueChange, openNext, takePending, updateItem } from '../queue/store';
import { mountFloatingButton, type FloatingUI } from './floating-ui';
import { pageSettled } from './settle';
import type { ContentRequest, ContentResponse } from '../types/messages';
import type { SerpData } from '../types/serp';

const onSerp = () => isGoogleSerp(location.href);

async function collect(opts: {
  expandPaa?: boolean;
  includeRawHtml?: boolean;
  onProgress?: (n: number, of: number) => void;
}): Promise<SerpData> {
  if (opts.expandPaa) {
    // Opens PAA items one at a time with a pause between; see parser/paa.ts.
    await expandPAA(document, location.href, { onProgress: opts.onProgress });
  }
  return collectSerp(document, location.href, {
    includeRawHtml: opts.includeRawHtml !== false,
  });
}

/** Store the capture, and tick off this search in the queue if it is there. */
async function save(data: SerpData): Promise<void> {
  const res = await chrome.runtime.sendMessage({ type: 'SAVE', data });
  if (!res?.ok) throw new Error(res?.error ?? 'The extension could not save this capture.');
  await updateItem(location.href, { status: 'done', serpId: data.id, at: data.collectedAt, note: undefined });
}

function summary(d: SerpData): string {
  const bits = [`${d.organicResults.length} organic`];
  const answered = d.paa.filter((p) => p.expanded).length;
  if (d.paa.length) bits.push(answered ? `${d.paa.length} PAA (${answered} answered)` : `${d.paa.length} PAA`);
  if (d.aiOverview?.present) bits.push('AI Overview');
  else if (d.aiOverview?.status === 'ai_mode_reply') bits.push('AI Mode reply');
  // Said here, because a queue run never opens the popup's diagnostics.
  if (d.diagnostics.warnings.some((w) => w.startsWith('snapshot cut'))) bits.push('snapshot cut');
  return `Saved · ${bits.join(' · ')}`;
}

/** Cheap counts for the popup, without building or storing a full record. */
function preview() {
  const d = collectSerp(document, location.href, { includeRawHtml: false });
  return {
    isSerp: onSerp(),
    query: d.metadata.query,
    organic: d.organicResults.length,
    paa: d.paa.length,
    features: d.serpFeatures.length,
    aiOverview: Boolean(d.aiOverview?.present),
    aiStatus: d.aiOverview?.status,
  };
}

chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
  (async (): Promise<ContentResponse> => {
    if (msg.type === 'PING') {
      return { ok: true, type: 'PONG', isSerp: onSerp(), query: new URLSearchParams(location.search).get('q') ?? '' };
    }

    if (!onSerp()) {
      return { ok: false, code: 'NOT_SERP', error: "This page isn't a supported Google SERP." };
    }

    if (msg.type === 'PREVIEW') {
      const p = preview();
      return { ok: true, type: 'PREVIEW', ...p };
    }

    if (msg.type === 'COLLECT') {
      const data = await collect({ expandPaa: msg.expandPaa, includeRawHtml: msg.includeRawHtml });
      if (data.organicResults.length === 0) {
        return {
          ok: false,
          code: 'NO_RESULTS',
          error: 'No organic results detected. Google may have changed the SERP layout.',
        };
      }
      await save(data);
      return { ok: true, type: 'COLLECTED', data };
    }

    return { ok: false, code: 'FAILED', error: 'Unknown request.' };
  })()
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, code: 'FAILED', error: err instanceof Error ? err.message : String(err) }),
    );
  return true;
});

/* -------------------------------------------------------------- floating UI */

/** Read this page, the way the person's settings say, and store it. */
async function capture(ui: FloatingUI): Promise<SerpData | null> {
  const settings = await getSettings();
  const data = await collect({
    ...settings,
    onProgress: (n, of) => ui.setStatus(`Opening question ${n} of ${of}…`, 'busy'),
  });
  if (data.organicResults.length === 0) {
    ui.setStatus('No organic results found', 'error');
    return null;
  }
  await save(data);
  ui.setStatus(summary(data), 'ok');
  return data;
}

/**
 * The page a Next click opened: wait for it to settle, then capture it.
 *
 * Only a search the queue opened moments ago (store.ts, takePending). Any other
 * visit, a reload of this one included, waits for Collect as before.
 */
async function captureQueued(ui: FloatingUI): Promise<void> {
  const pending = await takePending(location.href);
  if (!pending) return;
  ui.setBusy(true);
  try {
    ui.setStatus('Waiting for the page to finish…', 'busy');
    await pageSettled(document);
    const data = await capture(ui);
    if (!data) await updateItem(pending.url, { status: 'failed', note: 'no organic results', at: new Date().toISOString() });
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    await updateItem(pending.url, { status: 'failed', note, at: new Date().toISOString() });
    ui.setStatus(note, 'error');
  } finally {
    ui.setBusy(false);
  }
}

if (onSerp()) {
  const ui = mountFloatingButton({
    onCollect: async () => {
      ui.setStatus('Reading page…', 'busy');
      try {
        await capture(ui);
      } catch (err) {
        ui.setStatus(err instanceof Error ? err.message : 'Collection failed', 'error');
      }
    },
    onNext: async () => {
      const item = await openNext((url) => location.assign(url));
      ui.setStatus(item ? `Opening “${item.query}”…` : 'Queue finished', item ? 'busy' : 'ok');
    },
    onSkip: async () => {
      const item = nextItem(await getQueue());
      if (item) await updateItem(item.url, { status: 'skipped', at: new Date().toISOString() });
    },
  });

  const showQueue = (q: Queue | null) => ui.setQueue(q ? { ...progress(q), next: nextItem(q)?.query } : null);
  void getQueue().then(showQueue);
  onQueueChange(showQueue);
  void captureQueued(ui);

  // Keep PAA counts fresh if Google lazy-loads more of them after first paint.
  const observer = new MutationObserver(() => {
    /* presence-only; the read happens on click, so nothing to do per mutation */
  });
  observer.observe(document.documentElement, { childList: true, subtree: false });
}

export { parsePAA };
