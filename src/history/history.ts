/**
 * History page: list, filter, view, export, delete.
 *
 * Renders from the summaries store, so listing hundreds of captures never
 * loads a snapshot. The full record is fetched only when a row is opened.
 */
import type { BackgroundResponse } from '../types/messages';
import type { SerpData, SerpSummary } from '../types/serp';
import { aiCitationsCsv, featuresCsv, organicCsv, paaCsv, serpsJson } from '../storage/export';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const rowsEl = $('rows');
const emptyEl = $('empty');
const subEl = $('sub');
const filterEl = $<HTMLInputElement>('filter');
const viewer = $<HTMLDialogElement>('viewer');
const viewerBody = $('viewer-body');
const viewerTitle = $('viewer-title');

let summaries: SerpSummary[] = [];
let openRecord: SerpData | undefined;

const send = (msg: unknown): Promise<BackgroundResponse> =>
  chrome.runtime.sendMessage(msg) as Promise<BackgroundResponse>;

function download(filename: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

function render() {
  const q = filterEl.value.trim().toLowerCase();
  const shown = q
    ? summaries.filter((s) => s.query.toLowerCase().includes(q) || (s.country ?? '').toLowerCase().includes(q))
    : summaries;

  rowsEl.textContent = '';
  emptyEl.hidden = shown.length > 0;

  for (const s of shown) {
    const tr = document.createElement('tr');
    tr.className = 'row';

    const kw = document.createElement('td');
    const kwSpan = document.createElement('span');
    kwSpan.className = 'kw';
    kwSpan.textContent = s.query || '(no query)';
    kwSpan.addEventListener('click', () => view(s.id));
    kw.append(kwSpan);
    if (s.country) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.style.marginLeft = '7px';
      c.textContent = s.country.toUpperCase();
      kw.append(c);
    }

    const date = document.createElement('td');
    date.textContent = when(s.collectedAt);

    const organic = document.createElement('td');
    organic.className = 'num';
    organic.textContent = String(s.organicResultCount);

    const paa = document.createElement('td');
    paa.className = 'num';
    paa.textContent = String(s.paaCount);

    const feats = document.createElement('td');
    const chips = document.createElement('div');
    chips.className = 'chips';
    if (s.hasAiOverview) {
      const c = document.createElement('span');
      c.className = 'chip aio';
      c.textContent = 'AI Overview';
      chips.append(c);
    }
    for (const f of s.features.filter((x) => x !== 'ai_overview').slice(0, 5)) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = f.replace(/_/g, ' ');
      chips.append(c);
    }
    feats.append(chips);

    const actions = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.className = 'danger';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete the capture for "${s.query}"? This cannot be undone.`)) return;
      await send({ type: 'DELETE', id: s.id });
      await load();
    });
    actions.append(del);

    tr.append(kw, date, organic, paa, feats, actions);
    rowsEl.append(tr);
  }

  subEl.textContent = `${summaries.length} capture(s)${q ? ` · ${shown.length} matching` : ''}`;
}

async function view(id: string) {
  const res = await send({ type: 'GET', id });
  if (!res.ok || res.type !== 'GET' || !res.data) return;
  openRecord = res.data;
  viewerTitle.textContent = res.data.metadata.query || 'SERP';
  // rawHtml is dropped from the preview: it is the biggest field and unreadable
  // in a <pre>. It stays in storage and in a full JSON export.
  viewerBody.textContent = JSON.stringify({ ...res.data, rawHtml: undefined }, null, 2);
  viewer.showModal();
}

async function load() {
  const res = await send({ type: 'LIST' });
  summaries = res.ok && res.type === 'LIST' ? res.summaries : [];
  render();
}

filterEl.addEventListener('input', render);
$('viewer-close').addEventListener('click', () => viewer.close());
$('viewer-json').addEventListener('click', () => {
  if (!openRecord) return;
  download(`serp-${openRecord.metadata.query.replace(/\W+/g, '-').slice(0, 40) || openRecord.id}.json`, JSON.stringify(openRecord, null, 2));
});

$('export').addEventListener('click', async () => {
  const res = await send({ type: 'GET_ALL' });
  if (!res.ok || res.type !== 'GET_ALL' || !res.serps.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  // true: snapshots are why this export can be re-parsed after a parser fix.
  download(`serps-${stamp}.json`, serpsJson(res.serps, true));
  download(`organic_results-${stamp}.csv`, organicCsv(res.serps), 'text/csv');
  download(`paa-${stamp}.csv`, paaCsv(res.serps), 'text/csv');
  download(`ai_citations-${stamp}.csv`, aiCitationsCsv(res.serps), 'text/csv');
  download(`serp_features-${stamp}.csv`, featuresCsv(res.serps), 'text/csv');
});

$('clear').addEventListener('click', async () => {
  if (!confirm(`Delete all ${summaries.length} captures? This cannot be undone.`)) return;
  await send({ type: 'CLEAR' });
  await load();
});

void load();
