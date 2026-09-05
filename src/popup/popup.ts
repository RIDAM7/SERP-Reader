/**
 * Popup. Asks the content script to read the page, asks the worker for counts.
 *
 * Deliberately thin: no parsing here, because the popup cannot see the SERP —
 * it lives in the extension's own document. Everything it shows came from one
 * of the two message round-trips below.
 */
import type { BackgroundResponse, ContentResponse } from '../types/messages';
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
    els.aio.textContent = res.aiOverview ? '✓' : '–';
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
    if (d.paa.length) parts.push(`${d.paa.length} PAA`);
    if (d.serpFeatures.length) parts.push(`${d.serpFeatures.length} features`);
    if (d.aiOverview?.present) parts.push('AI Overview');
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

void refresh();
