/**
 * The message contract between content script, popup, history page and the
 * service worker.
 *
 * Written down as types because there are three senders and one receiver, and
 * a mistyped `type` string fails silently — chrome.runtime just never calls
 * anyone back.
 */
import type { SerpData, SerpSummary } from './serp';

export type ContentRequest =
  | { type: 'PING' }
  | { type: 'COLLECT'; expandPaa?: boolean; includeRawHtml?: boolean }
  | { type: 'PREVIEW' };

export type ContentResponse =
  | { ok: true; type: 'PONG'; isSerp: boolean; query: string }
  | { ok: true; type: 'COLLECTED'; data: SerpData }
  | { ok: true; type: 'PREVIEW'; isSerp: boolean; query: string; organic: number; paa: number; features: number; aiOverview: boolean }
  | { ok: false; error: string; code: 'NOT_SERP' | 'NO_RESULTS' | 'FAILED' };

export type BackgroundRequest =
  | { type: 'SAVE'; data: SerpData }
  | { type: 'LIST' }
  | { type: 'GET'; id: string }
  | { type: 'GET_ALL' }
  | { type: 'DELETE'; id: string }
  | { type: 'CLEAR' }
  | { type: 'COUNT' };

export type BackgroundResponse =
  | { ok: true; type: 'SAVED'; summary: SerpSummary }
  | { ok: true; type: 'LIST'; summaries: SerpSummary[] }
  | { ok: true; type: 'GET'; data: SerpData | undefined }
  | { ok: true; type: 'GET_ALL'; serps: SerpData[] }
  | { ok: true; type: 'DELETE' }
  | { ok: true; type: 'CLEAR' }
  | { ok: true; type: 'COUNT'; count: number }
  | { ok: false; error: string };
