/**
 * Service worker: the only thing that touches storage.
 *
 * Everything else asks. That keeps every capture in one IndexedDB owned by the
 * extension, rather than scattered across whichever google.* origin happened to
 * be open — which is what would happen if the content script stored its own.
 *
 * MV3 service workers are killed when idle, so this holds no state between
 * messages. Each handler opens the database, does its work and returns.
 */
import type { BackgroundRequest, BackgroundResponse } from '../types/messages';
import { clearAll, count, deleteSerp, getAllSerps, getSerp, listSummaries, saveSerp } from '../storage/db';

async function handle(msg: BackgroundRequest): Promise<BackgroundResponse> {
  switch (msg.type) {
    case 'SAVE':
      return { ok: true, type: 'SAVED', summary: await saveSerp(msg.data) };
    case 'LIST':
      return { ok: true, type: 'LIST', summaries: await listSummaries() };
    case 'GET':
      return { ok: true, type: 'GET', data: await getSerp(msg.id) };
    case 'GET_ALL':
      return { ok: true, type: 'GET_ALL', serps: await getAllSerps() };
    case 'DELETE':
      await deleteSerp(msg.id);
      return { ok: true, type: 'DELETE' };
    case 'CLEAR':
      await clearAll();
      return { ok: true, type: 'CLEAR' };
    case 'COUNT':
      return { ok: true, type: 'COUNT', count: await count() };
    default:
      return { ok: false, error: `Unknown message: ${(msg as { type: string }).type}` };
  }
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
  /*
   * `return true` keeps the message channel open for the async reply. Without
   * it Chrome closes the port the moment this function returns and the caller
   * silently receives undefined — the single most common MV3 bug.
   */
  handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.info('[SERP Reader] installed. Open a Google results page and press Collect.');
});
