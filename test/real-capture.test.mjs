/**
 * Regression tests against real captures.
 *
 * These are the fixtures that actually prove the selectors work, because they
 * are Google's own markup rather than my reconstruction of it. There are none
 * in the repo until someone collects one — so this file skips cleanly rather
 * than failing, and starts testing the moment a capture is imported:
 *
 *   node test/import-capture.mjs <exported-serps.json>
 *
 * What is asserted is shape, not wording. Result counts, the domains in the top
 * five, PAA count, AI Overview presence and its cited domains. Asserting
 * snippet text would fail the next time Google rewrites a description, and a
 * test that cries wolf is one everybody learns to ignore.
 *
 * The value shows up on the day someone edits selectors.ts: if the counts move,
 * the edit broke something, and that is exactly the failure the synthetic
 * fixtures cannot catch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';

import { collectSerp } from './.parser.mjs';

const FIXTURES = 'test/fixtures';

const captures = existsSync(FIXTURES)
  ? readdirSync(FIXTURES).filter((f) => f.startsWith('real-') && f.endsWith('.html'))
  : [];

if (captures.length === 0) {
  test('real captures: none imported yet', { skip: 'Collect a SERP, export the JSON, then run test/import-capture.mjs' }, () => {});
}

for (const file of captures) {
  const base = file.replace(/\.html$/, '');
  const expectedPath = join(FIXTURES, `${base}.expected.json`);

  test(`real capture: ${base}`, () => {
    const html = readFileSync(join(FIXTURES, file), 'utf8');
    const expected = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : null;

    const doc = parseHTML(html).document;
    const url = expected?.url ?? 'https://www.google.com/search?q=imported';
    const d = collectSerp(doc, url, { includeRawHtml: false });

    // Always true of a usable capture, expectations file or not.
    assert.ok(d.organicResults.length > 0, 'no organic results parsed from a real capture');
    assert.deepEqual(
      d.organicResults.map((r) => r.position),
      d.organicResults.map((_, i) => i + 1),
      'positions are not a clean 1..n sequence',
    );
    for (const r of d.organicResults) {
      assert.ok(r.url.startsWith('http'), `result ${r.position} has a non-http url`);
      // Google's search chrome, not Google as a publisher: developers.google.com
      // ranked 1st here and this assertion used to reject it.
      assert.ok(
        r.domain && !/^((www[.])?google[.]|accounts[.]google[.]|maps[.]google[.])|gstatic[.]com$/.test(r.domain),
        `result ${r.position} is Google search chrome, not a result`,
      );
      assert.ok(r.title.length > 0, `result ${r.position} has no title`);
    }

    if (!expected) return;

    assert.equal(d.organicResults.length, expected.organicCount, 'organic count changed since import');
    assert.deepEqual(
      d.organicResults.slice(0, 5).map((r) => r.domain),
      expected.firstDomains,
      'the top five domains changed since import',
    );
    assert.equal(d.paa.length, expected.paaCount, 'PAA count changed since import');
    assert.equal(Boolean(d.aiOverview?.present), expected.hasAiOverview, 'AI Overview presence changed');
    if ('aiStatus' in expected) {
      assert.equal(d.aiOverview?.status ?? null, expected.aiStatus, 'what filled the AI Overview slot changed since import');
    }
    // An AI Mode reply's sources are kept too, so they are pinned the same way.
    if (expected.hasAiOverview || expected.aiStatus) {
      assert.deepEqual(
        (d.aiOverview?.sources ?? []).map((c) => c.domain),
        expected.aiCitationDomains,
        'AI Overview citations changed since import',
      );
    }

    /*
     * Features and ads were recorded at import and then never checked, so two
     * real defects passed this suite untouched: 'ads' reported on every SERP
     * from an empty #tads placeholder, and later six genuine ads extracted as
     * none because #tads sits outside #center_col. Recording a value without
     * asserting it is a test that only looks like one.
     */
    if (expected.features) {
      assert.deepEqual(d.serpFeatures, expected.features, 'SERP features changed since import');
    }
    if (typeof expected.adCount === 'number') {
      assert.equal(d.ads.length, expected.adCount, 'ad count changed since import');
    }
    if (expected.adDomains) {
      assert.deepEqual(
        d.ads.map((a) => a.domain),
        expected.adDomains,
        'ad domains changed since import',
      );
    }
  });
}

/*
 * The AI Mode component's source cards, on Google's own markup.
 *
 * The sidecar pins the domains; this pins how they were found, so a change
 * that keeps the list but loses a route shows up as that. On this capture the
 * chips gave two citations ("Roadmap.sh" and "Naukri.com" happen to be
 * domain-shaped names) against 19 cards.
 */
test('real capture: an AI Mode reply cites its 19 source cards, each with a domain and a site name', () => {
  const html = readFileSync(join(FIXTURES, 'real-in-ai-engineer-career.html'), 'utf8');
  const doc = parseHTML(html).document;
  const d = collectSerp(doc, 'https://www.google.com/search?q=ai%20engineer%20career&gl=in&hl=en&pws=0&num=20', {
    includeRawHtml: false,
  });
  const s = d.aiOverview?.sources ?? [];
  const cards = Array.from(doc.querySelectorAll('li.Ioqnib'));

  assert.equal(d.aiOverview?.status, 'ai_mode_reply');
  assert.equal(s.length, 19, 'one entry per card');
  assert.deepEqual(s.map((c) => c.order), s.map((_, i) => i + 1));
  assert.ok(s.every((c) => c.domain), 'a card came back without a domain');
  assert.ok(s.every((c) => c.siteName), 'a card came back without its site name');
  assert.ok(s.every((c) => /^https:\/\/www\.google\.com\/goto\?url=/.test(c.url)));
  assert.ok(s.every((c) => c.title && !/opens in (a )?new tab|external site/i.test(c.title)));

  // The three routes to a domain, each on a card that can only have taken it.
  assert.match(cards[3].outerHTML, /faviconV2\?url=https:\/\/www\.udemy\.com/);
  assert.deepEqual([s[3].siteName, s[3].domain], ['Udemy', 'udemy.com'], 'from the favicon request');
  assert.doesNotMatch(cards[0].outerHTML, /faviconV2\?url=/);
  assert.match(cards[0].outerHTML, /faviconV2\?url\\u003dhttps:\/\/learn\.microsoft\.com/);
  assert.deepEqual([s[0].siteName, s[0].domain], ['Microsoft Learn', 'learn.microsoft.com'], "from the card's inline data, escaped");
  for (const i of [4, 9, 11, 13]) {
    assert.doesNotMatch(cards[i].outerHTML, /youtube\.com/i, `card ${i + 1} names its origin after all`);
    assert.deepEqual([s[i].siteName, s[i].domain], ['YouTube', 'youtube.com'], `card ${i + 1}: from the slot's source record`);
  }

  // Two Coursera pages are two citations.
  assert.equal(s.filter((c) => c.domain === 'coursera.org').length, 2);
});
