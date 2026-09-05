/**
 * Content script: reads the SERP that is already on screen.
 *
 * It never navigates, never searches, and never runs on its own. A capture
 * happens because a person pressed a button — from the popup or the floating
 * panel, both of which land here.
 *
 * Storage is not done here. This script runs in google.com's origin, so its
 * IndexedDB would belong to Google rather than the extension; the parsed record
 * is handed to the service worker, which owns the database.
 */
import { collectSerp, expandPAA, isGoogleSerp } from '../parser';
import { parsePAA } from '../parser/paa';
import { mountFloatingButton } from './floating-ui';
import type { ContentRequest, ContentResponse } from '../types/messages';
import type { SerpData } from '../types/serp';

const onSerp = () => isGoogleSerp(location.href);

async function collect(opts: { expandPaa?: boolean; includeRawHtml?: boolean }): Promise<SerpData> {
  if (opts.expandPaa) {
    // Opens PAA items one at a time with a pause between; see parser/paa.ts.
    await expandPAA(document, location.href);
  }
  return collectSerp(document, location.href, {
    includeRawHtml: opts.includeRawHtml !== false,
  });
}

async function save(data: SerpData): Promise<void> {
  const res = await chrome.runtime.sendMessage({ type: 'SAVE', data });
  if (!res?.ok) throw new Error(res?.error ?? 'The extension could not save this capture.');
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

if (onSerp()) {
  const ui = mountFloatingButton(async () => {
    ui.setStatus('Reading page…', 'busy');
    try {
      const data = await collect({ includeRawHtml: true });
      if (data.organicResults.length === 0) {
        ui.setStatus('No organic results found', 'error');
        return;
      }
      await save(data);
      const bits = [`${data.organicResults.length} organic`];
      if (data.paa.length) bits.push(`${data.paa.length} PAA`);
      if (data.aiOverview?.present) bits.push('AI Overview');
      ui.setStatus(`Saved · ${bits.join(' · ')}`, 'ok');
    } catch (err) {
      ui.setStatus(err instanceof Error ? err.message : 'Collection failed', 'error');
    }
  });

  // Keep PAA counts fresh if Google lazy-loads more of them after first paint.
  const observer = new MutationObserver(() => {
    /* presence-only; the read happens on click, so nothing to do per mutation */
  });
  observer.observe(document.documentElement, { childList: true, subtree: false });
}

export { parsePAA };
