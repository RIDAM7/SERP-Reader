/**
 * Popup. Asks the content script to read the page, asks the worker for counts.
 *
 * Deliberately thin: no parsing here, because the popup cannot see the SERP —
 * it lives in the extension's own document. Everything it shows came from one
 * of the two message round-trips below.
 */
import type { BackgroundResponse, ContentResponse } from '../types/messages';
import { nextItem, parseQueue, progress, retryable, type Queue } from '../queue/queue';
import { getQueue, getSettings, onQueueChange, openNext, setQueue, setSettings } from '../queue/store';
import { aiCitationsCsv, featuresCsv, organicCsv, paaCsv, serpsJson } from '../storage/export';
import type { SerpData } from '../types/serp';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  context: $('context'),
  organic: $('s-organic'),
  paa: $('s-paa'),
  features: $('s-features'),
  aio: $('s-aio'),
  total: $('s-total'),
  collect: $<HTMLButtonElement>('collect'),
  history: $<HTMLButtonElement>('history'),
  exportAll: $<HTMLButtonElement>('export'),
  msg: $('msg'),
  expandPaa: $<HTMLInputElement>('expand-paa'),
  rawHtml: $<HTMLInputElement>('raw-html'),
  diagWrap: $<HTMLDetailsElement>('diag-wrap'),
  diag: $('diag'),
  qStatus: $('q-status'),
  qControls: $('q-controls'),
  qNext: $<HTMLButtonElement>('q-next'),
  qRetry: $<HTMLButtonElement>('q-retry'),
  qClear: $<HTMLButtonElement>('q-clear'),
  qLoadWrap: $<HTMLDetailsElement>('q-load-wrap'),
  qLoadLabel: $('q-load-label'),
  qText: $<HTMLTextAreaElement>('q-text'),
  qLoad: $<HTMLButtonElement>('q-load'),
};

function say(text: string, tone: '' | 'ok' | 'error' | 'busy' = '') {
  els.msg.textContent = text;
  els.msg.className = `msg ${tone}`;
}

const toBackground = (msg: unknown): Promise<BackgroundResponse> =>
  chrome.runtime.sendMessage(msg) as Promise<BackgroundResponse>;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function toContent(msg: unknown): Promise<ContentResponse> {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No active tab.');
  try {
    return (await chrome.tabs.sendMessage(tab.id, msg)) as ContentResponse;
  } catch {
    /*
     * The usual cause is not a bug: the content script is not in this tab
     * because it is not a Google results page, or the page was open before the
     * extension was loaded and needs one refresh.
     */
    throw new Error('No SERP reader on this tab. Open a Google results page, then reload it once.');
  }
}

function download(filename: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function refresh() {
  const totals = await toBackground({ type: 'COUNT' });
  if (totals.ok && totals.type === 'COUNT') els.total.textContent = String(totals.count);

  try {
    const res = await toContent({ type: 'PREVIEW' });
    if (!res.ok) {
      els.context.textContent = res.error;
      els.collect.disabled = true;
      return;
    }
    if (res.type !== 'PREVIEW') return;
    els.context.textContent = res.query ? `Keyword: ${res.query}` : 'Google Search';
    els.organic.textContent = String(res.organic);
    els.paa.textContent = String(res.paa);
    els.features.textContent = String(res.features);
    els.aio.textContent = res.aiOverview ? '✓' : res.aiStatus === 'ai_mode_reply' ? 'AI Mode reply' : '–';
    els.collect.disabled = false;
  } catch (err) {
    els.context.textContent = err instanceof Error ? err.message : String(err);
    els.collect.disabled = true;
  }
}

els.collect.addEventListener('click', async () => {
  els.collect.disabled = true;
  say('Reading page…', 'busy');
  try {
    const res = await toContent({
      type: 'COLLECT',
      expandPaa: els.expandPaa.checked,
      includeRawHtml: els.rawHtml.checked,
    });
    if (!res.ok) {
      say(res.error, 'error');
      return;
    }
    if (res.type !== 'COLLECTED') return;

    const d = res.data;
    const parts = [`${d.organicResults.length} organic`];
    // How many answers were read, so an expand pass that opened nothing shows here and not only in the export.
    const answered = d.paa.filter((p) => p.expanded).length;
    if (d.paa.length) parts.push(answered ? `${d.paa.length} PAA (${answered} answered)` : `${d.paa.length} PAA`);
    if (d.serpFeatures.length) parts.push(`${d.serpFeatures.length} features`);
    if (d.aiOverview?.present) parts.push('AI Overview');
    else if (d.aiOverview?.status === 'ai_mode_reply') parts.push('AI Mode reply');
    say(`Saved · ${parts.join(' · ')}`, 'ok');

    const g = d.diagnostics;
    els.diag.textContent = [
      `Containers detected: ${g.containersDetected}`,
      `Valid organic results: ${g.validOrganic}`,
      `PAA detected: ${g.paaDetected}`,
      `AI Overview: ${g.aiOverview}`,
      `Local pack: ${g.localPack}`,
      `Parser: ${g.parserVersion}  (${g.durationMs}ms)`,
      '',
      'Rejected:',
      ...(g.rejected.length ? g.rejected.map((r) => `  ${r.count} × ${r.reason}`) : ['  none']),
      ...(g.warnings.length ? ['', 'Warnings:', ...g.warnings.map((w) => `  ${w}`)] : []),
    ].join('\n');
    els.diagWrap.hidden = false;

    await refresh();
  } catch (err) {
    say(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    els.collect.disabled = false;
  }
});

els.history.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

els.exportAll.addEventListener('click', async () => {
  say('Building export…', 'busy');
  const res = await toBackground({ type: 'GET_ALL' });
  if (!res.ok || res.type !== 'GET_ALL') {
    say('Could not read stored captures.', 'error');
    return;
  }
  const serps: SerpData[] = res.serps;
  if (!serps.length) {
    say('Nothing collected yet.', 'error');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  // true: snapshots are why this export can be re-parsed after a parser fix.
  download(`serps-${stamp}.json`, serpsJson(serps, true));
  download(`organic_results-${stamp}.csv`, organicCsv(serps), 'text/csv');
  download(`paa-${stamp}.csv`, paaCsv(serps), 'text/csv');
  download(`ai_citations-${stamp}.csv`, aiCitationsCsv(serps), 'text/csv');
  download(`serp_features-${stamp}.csv`, featuresCsv(serps), 'text/csv');
  say(`Exported ${serps.length} capture(s) — 1 JSON + 4 CSVs.`, 'ok');
});

/* ------------------------------------------------------------- settings */

// Remembered, because the on-page panel and the queue read the same two choices.
void getSettings().then((s) => {
  els.expandPaa.checked = s.expandPaa;
  els.rawHtml.checked = s.includeRawHtml;
});
els.expandPaa.addEventListener('change', () => void setSettings({ expandPaa: els.expandPaa.checked }));
els.rawHtml.addEventListener('change', () => void setSettings({ includeRawHtml: els.rawHtml.checked }));

/* ---------------------------------------------------------------- queue */

function showQueue(q: Queue | null) {
  const p = progress(q);
  const next = nextItem(q);
  els.qControls.hidden = !q;
  els.qLoadLabel.textContent = q ? 'Replace the queue' : 'Load a queue';
  els.qRetry.disabled = !(p.failed + p.skipped);
  els.qNext.disabled = !next;
  if (!q) {
    els.qStatus.textContent = 'No queue loaded.';
    return;
  }
  const extra = [p.failed && `${p.failed} failed`, p.skipped && `${p.skipped} skipped`].filter(Boolean);
  els.qStatus.textContent =
    `${p.done} of ${p.total} done${extra.length ? ` · ${extra.join(' · ')}` : ''}` +
    (next ? ` · next: ${next.query}` : ' · finished');
}

els.qLoad.addEventListener('click', async () => {
  const { items, rejected } = parseQueue(els.qText.value);
  if (!items.length) {
    say(rejected.length ? `No Google searches in that list (${rejected.length} lines rejected).` : 'Paste at least one line.', 'error');
    return;
  }
  await setQueue({ items, loadedAt: new Date().toISOString() });
  els.qText.value = '';
  els.qLoadWrap.open = false;
  say(`Queue loaded: ${items.length} searches${rejected.length ? `, ${rejected.length} lines rejected` : ''}.`, 'ok');
});

els.qNext.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  const tabId = tab.id;
  // The page it opens captures itself once it settles; the panel there shows the next one.
  const item = await openNext((url) => chrome.tabs.update(tabId, { url }));
  if (item) window.close();
});

els.qRetry.addEventListener('click', async () => {
  const q = await getQueue();
  if (q) await setQueue(retryable(q));
});

// Two clicks: a cleared queue forgets which searches are done. The captures themselves stay.
let clearArmed: ReturnType<typeof setTimeout> | undefined;
els.qClear.addEventListener('click', async () => {
  if (!clearArmed) {
    els.qClear.textContent = 'Click again to clear';
    clearArmed = setTimeout(() => {
      clearArmed = undefined;
      els.qClear.textContent = 'Clear queue';
    }, 3000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = undefined;
  els.qClear.textContent = 'Clear queue';
  await setQueue(null);
});

void getQueue().then(showQueue);
onQueueChange(showQueue);

void refresh();
