/**
 * The search queue and the wait before a queued capture.
 *
 * The queue lines below are copied from the research queue files
 * (queues/batch-3-dental-25.txt), which is the shape the queue has to take
 * as pasted. What a click on Next does in Chrome — open the search, then
 * capture it once — is chrome.storage and navigation, and is not tested here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { nextItem, parseQueue, progress, retryable, sameSearch, searchUrl, withItem } from './.queue/queue/queue.mjs';
import { pageSettled } from './.queue/content/settle.mjs';

const HOUSTON = 'https://www.google.com/search?q=dentist%20houston%20tx&gl=us&hl=en&pws=0&num=20';
const ATLANTA = 'https://www.google.com/search?q=dentist%20atlanta%20ga&gl=us&hl=en&pws=0&num=20';

test('a queue file pastes as it is; a keyword becomes the same URL the queue files use', () => {
  assert.equal(searchUrl('dentist houston tx'), HOUSTON);

  const { items, rejected } = parseQueue(
    [HOUSTON, '', '# fan-out batch', ATLANTA, 'dentist houston tx', 'geo vs seo', 'https://example.com/search?q=x', 'https://www.google.com/search?gl=us'].join('\r\n'),
  );
  assert.deepEqual(
    items.map((i) => [i.query, i.status]),
    [['dentist houston tx', 'pending'], ['dentist atlanta ga', 'pending'], ['geo vs seo', 'pending']],
    'the keyword repeating a URL already listed is not added twice',
  );
  assert.equal(items[0].url, HOUSTON, 'a pasted URL is kept as written');
  assert.equal(items[2].url, 'https://www.google.com/search?q=geo%20vs%20seo&gl=us&hl=en&pws=0&num=20');
  assert.deepEqual(rejected, ['https://example.com/search?q=x', 'https://www.google.com/search?gl=us']);
});

test('the page a Next click lands on is that search, whatever Google adds to its URL', () => {
  const landed = `${HOUSTON}&sca_esv=27e99585eb7cf8ac&sxsrf=AKL5yDhQg&ei=kE_patHIBNyf4&biw=1536&bih=730`;
  assert.ok(sameSearch(HOUSTON, landed));
  assert.ok(sameSearch(HOUSTON, HOUSTON.replace(/%20/g, '+')), 'a + and a %20 are the same space');
  assert.ok(!sameSearch(HOUSTON, ATLANTA));
  assert.ok(!sameSearch(HOUSTON, HOUSTON.replace('gl=us', 'gl=in')), 'another country is another search');
  assert.ok(!sameSearch(HOUSTON, HOUSTON.replace('www.google.com', 'www.google.co.in')));
});

test('Next is the first pending search; done, failed and skipped ones are passed over until retried', () => {
  let q = { items: parseQueue([HOUSTON, ATLANTA, 'geo vs seo'].join('\n')).items, loadedAt: '2026-11-03T00:00:00.000Z' };
  assert.equal(nextItem(q).query, 'dentist houston tx');

  q = withItem(q, `${HOUSTON}&ei=abc`, { status: 'done', serpId: 'serp-1' });
  q = withItem(q, ATLANTA, { status: 'failed', note: 'no organic results' });
  assert.equal(nextItem(q).query, 'geo vs seo');
  q = withItem(q, nextItem(q).url, { status: 'skipped' });
  assert.equal(nextItem(q), undefined);
  assert.deepEqual(progress(q), { pending: 0, done: 1, failed: 1, skipped: 1, total: 3 });

  q = retryable(q);
  assert.deepEqual(q.items.map((i) => i.status), ['done', 'pending', 'pending']);
  assert.equal(q.items[1].note, undefined, 'a retried search starts clean');
  assert.equal(q.items[0].serpId, 'serp-1', 'a done search keeps its capture');
});

test('a queued capture waits for the results column to go quiet, and no longer than the cap', async () => {
  const { document, MutationObserver } = parseHTML('<html><body><div id="rcnt"><p>loading</p></div></body></html>');
  globalThis.MutationObserver = MutationObserver;
  const rcnt = document.getElementById('rcnt');

  // An overview "streaming" for 600 ms, then still.
  const streaming = setInterval(() => rcnt.append(document.createElement('span')), 100);
  setTimeout(() => clearInterval(streaming), 600);
  const start = Date.now();
  await pageSettled(document, { minMs: 200, quietMs: 400, maxMs: 5000 });
  // Bounds are loose on purpose: the suite runs files side by side, and timers run late under load.
  const waited = Date.now() - start;
  assert.ok(waited >= 850, `returned after ${waited} ms, before the column went quiet`);
  assert.ok(waited < 4500, `returned after ${waited} ms, waiting for the cap rather than the quiet`);

  // A page that never stops changing costs the cap and no more.
  const forever = setInterval(() => rcnt.append(document.createElement('span')), 50);
  const capped = Date.now();
  await pageSettled(document, { minMs: 100, quietMs: 400, maxMs: 800 });
  clearInterval(forever);
  const cost = Date.now() - capped;
  assert.ok(cost >= 750 && cost < 3000, `a page that never went quiet cost ${cost} ms against an 800 ms cap`);
});
