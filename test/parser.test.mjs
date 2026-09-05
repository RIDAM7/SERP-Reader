/**
 * Parser tests.
 *
 *   npm test
 *
 * What these prove and what they do not is written at the top of fixtures.mjs.
 * Short version: they prove the filtering and position logic, not that the
 * selectors match today's Google. Only a real capture proves that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { collectSerp, isGoogleSerp, domainFromCite } from './.parser.mjs';
import { aiCitationsCsv, organicCsv, paaCsv, serpsJson } from './.export.mjs';
import { manyResults, serpHtml } from './fixtures.mjs';

const URL_US = 'https://www.google.com/search?q=generative+engine+optimization&gl=us&hl=en&pws=0&num=20';

/** linkedom gives a DOM without a browser; window.innerWidth is absent, hence desktop. */
const parse = (html) => parseHTML(html).document;
const collect = (html, url = URL_US) => collectSerp(parse(html), url, { includeRawHtml: false });

/* ------------------------------------------------------------- organic core */

test('assigns positions 1..n after filtering, not before', () => {
  const d = collect(
    serpHtml({
      ads: [{ title: 'Buy SEO now', url: 'https://ad.example.com/' }],
      paa: [{ q: 'What is GEO?', a: 'It is a thing.', src: 'https://paa.example.com/' }],
      organic: manyResults(5),
    }),
  );
  assert.equal(d.organicResults.length, 5);
  assert.deepEqual(
    d.organicResults.map((r) => r.position),
    [1, 2, 3, 4, 5],
  );
  assert.equal(d.organicResults[0].domain, 'site1.example.com');
});

test('never counts an ad as organic', () => {
  const d = collect(
    serpHtml({ ads: [{ title: 'Sponsored thing', url: 'https://ad.example.com/' }], organic: manyResults(3) }),
  );
  assert.ok(!d.organicResults.some((r) => r.domain === 'ad.example.com'), 'ad leaked into organic');
  assert.equal(d.ads.length, 1);
  assert.equal(d.ads[0].isSponsored, true);
});

test('never counts a PAA source as organic', () => {
  const d = collect(
    serpHtml({
      paa: [{ q: 'What is GEO?', a: 'An answer.', src: 'https://paa.example.com/' }],
      organic: manyResults(3),
    }),
  );
  assert.ok(!d.organicResults.some((r) => r.domain === 'paa.example.com'));
  assert.equal(d.paa.length, 1);
});

test('caps at 25 and returns exactly what exists below that', () => {
  assert.equal(collect(serpHtml({ organic: manyResults(40) })).organicResults.length, 25);
  assert.equal(collect(serpHtml({ organic: manyResults(17) })).organicResults.length, 17);
  assert.equal(collect(serpHtml({ organic: [] })).organicResults.length, 0);
});

test('de-duplicates the same destination linked twice', () => {
  const dupe = { title: 'Same page', url: 'https://dupe.example.com/page', snippet: 'x' };
  const d = collect(serpHtml({ organic: [dupe, { ...dupe, title: 'Same page again' }, ...manyResults(2)] }));
  const domains = d.organicResults.map((r) => r.domain);
  assert.equal(domains.filter((x) => x === 'dupe.example.com').length, 1);
  assert.ok(d.diagnostics.rejected.some((r) => r.reason === 'duplicate url'));
});

test('a result with no snippet is kept, not dropped', () => {
  const d = collect(serpHtml({ organic: [{ title: 'No snippet', url: 'https://x.example.com/', snippet: null }] }));
  assert.equal(d.organicResults.length, 1);
  assert.equal(d.organicResults[0].snippet, undefined);
});

test('captures sitelinks without turning them into results', () => {
  const d = collect(
    serpHtml({
      organic: [
        {
          title: 'Has sitelinks',
          url: 'https://brand.example.com/',
          sitelinks: [
            { title: 'Pricing', url: 'https://brand.example.com/pricing' },
            { title: 'About', url: 'https://brand.example.com/about' },
          ],
        },
        ...manyResults(2),
      ],
    }),
  );
  assert.equal(d.organicResults.length, 3, 'sitelinks became their own results');
  assert.equal(d.organicResults[0].sitelinks?.length, 2);
});

/* ------------------------------------------------------------------ features */

test('extracts AI Overview text and citations in order', () => {
  const d = collect(
    serpHtml({
      aiSources: ['https://cited-one.example.com/a', 'https://cited-two.example.com/b'],
      organic: manyResults(3),
    }),
  );
  assert.equal(d.aiOverview?.present, true);
  assert.match(d.aiOverview.text, /generative engine optimization/i);
  assert.deepEqual(
    d.aiOverview.sources.map((s) => s.domain),
    ['cited-one.example.com', 'cited-two.example.com'],
  );
  assert.deepEqual(d.aiOverview.sources.map((s) => s.order), [1, 2]);
  assert.ok(d.serpFeatures.includes('ai_overview'));
});

test('AI Overview citations do not become organic results', () => {
  const d = collect(serpHtml({ aiSources: ['https://cited.example.com/a'], organic: manyResults(2) }));
  assert.ok(!d.organicResults.some((r) => r.domain === 'cited.example.com'));
});

test('reads PAA questions, and marks unexpanded ones honestly', () => {
  const d = collect(
    serpHtml({
      paa: [
        { q: 'What is GEO?', a: 'An answer.', src: 'https://a.example.com/' },
        { q: 'How is GEO measured?' },
      ],
      organic: manyResults(2),
    }),
  );
  assert.equal(d.paa.length, 2);
  assert.equal(d.paa[0].expanded, true);
  assert.equal(d.paa[0].sourceDomain, 'a.example.com');
  assert.equal(d.paa[1].expanded, false, 'an unopened answer must not look answered');
  assert.equal(d.paa[1].answer, undefined);
});

test('detects related searches and a knowledge panel', () => {
  const d = collect(
    serpHtml({ organic: manyResults(2), related: ['geo vs seo', 'llms txt'], knowledgePanel: true }),
  );
  assert.deepEqual(d.relatedSearches, ['geo vs seo', 'llms txt']);
  assert.ok(d.serpFeatures.includes('related_searches'));
  assert.ok(d.serpFeatures.includes('knowledge_panel'));
});

test('a local pack is detected and does not pollute organic', () => {
  const d = collect(serpHtml({ organic: manyResults(3), localPack: true }));
  assert.ok(d.serpFeatures.includes('local_pack'));
  assert.equal(d.diagnostics.localPack, 'detected');
  assert.ok(!d.organicResults.some((r) => r.domain.includes('maps.google')));
});

test('missing features are absent, never invented', () => {
  const d = collect(serpHtml({ organic: manyResults(3) }));
  assert.equal(d.aiOverview, undefined);
  assert.equal(d.paa.length, 0);
  assert.deepEqual(d.relatedSearches, []);
  assert.equal(d.diagnostics.aiOverview, 'not detected');
});

test('an empty page yields nothing and says why, rather than throwing', () => {
  const d = collect('<html><body><div id="search"></div></body></html>');
  assert.equal(d.organicResults.length, 0);
  assert.ok(d.diagnostics.warnings.length > 0);
});

/* ------------------------------------------------------------------ metadata */

test('reads the search parameters that make a capture comparable', () => {
  const d = collect(serpHtml({ organic: manyResults(3) }));
  assert.equal(d.metadata.query, 'generative engine optimization');
  assert.equal(d.metadata.country, 'us');
  assert.equal(d.metadata.language, 'en');
  assert.equal(d.metadata.personalisationDisabled, true);
  assert.equal(d.metadata.requestedResults, 20);
  assert.equal(d.metadata.googleDomain, 'www.google.com');
  assert.equal(d.metadata.organicResultCount, 3);
});

test('recognises Google search URLs and rejects everything else', () => {
  assert.equal(isGoogleSerp('https://www.google.com/search?q=x'), true);
  assert.equal(isGoogleSerp('https://www.google.co.in/search?q=x'), true);
  assert.equal(isGoogleSerp('https://www.bing.com/search?q=x'), false);
  assert.equal(isGoogleSerp('https://www.google.com/maps'), false);
  assert.equal(isGoogleSerp('not a url'), false);
});

test('diagnostics separate a thin SERP from a broken parser', () => {
  const d = collect(serpHtml({ ads: [{ title: 'Ad', url: 'https://ad.example.com/' }], organic: manyResults(4) }));
  assert.ok(d.diagnostics.containersDetected >= 4);
  assert.equal(d.diagnostics.validOrganic, 4);
  assert.ok(d.diagnostics.rejected.some((r) => r.reason === 'sponsored'));
  assert.ok(typeof d.diagnostics.durationMs === 'number');
});

/* -------------------------------------------------------------------- export */

test('CSV quotes commas and quotes rather than corrupting a row', () => {
  const d = collect(
    serpHtml({ organic: [{ title: 'A "quoted", comma title', url: 'https://q.example.com/', snippet: 'one, two' }] }),
  );
  const csv = organicCsv([d]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2, 'a comma in a field split the row');
  assert.ok(csv.includes('"A ""quoted"", comma title"'));
});

test('PAA and AI citations export separately from organic results', () => {
  const d = collect(
    serpHtml({
      organic: manyResults(2),
      paa: [{ q: 'What is GEO?', a: 'An answer.', src: 'https://p.example.com/' }],
      aiSources: ['https://c.example.com/x'],
    }),
  );
  assert.equal(organicCsv([d]).trim().split('\r\n').length, 3); // header + 2
  assert.equal(paaCsv([d]).trim().split('\r\n').length, 2); // header + 1
  const ai = aiCitationsCsv([d]).trim().split('\r\n');
  assert.equal(ai.length, 2);
  assert.ok(ai[1].includes('c.example.com'));
});

/* ------------------------------------------------ the /goto redirect regression */

test('keeps results whose href is a /goto redirect, using cite for the domain', () => {
  // This is the shape that returned zero results from the first real capture:
  // Google wraps every link in /goto?url=<signed blob> and the destination is
  // nowhere in the DOM, so the href is a google.com URL.
  const d = collect(
    serpHtml({
      organic: [
        { title: 'Forbes on AEO', url: 'https://www.forbes.com/innovation/ai/aeo', displayed: 'https://www.forbes.com › Innovation › AI', redirect: true },
        { title: 'HubSpot guide', url: 'https://www.hubspot.com/marketing/aeo-guide', displayed: 'https://www.hubspot.com › marketing › aeo-guide', redirect: true },
      ],
    }),
  );

  assert.equal(d.organicResults.length, 2, 'redirects were rejected as google-internal again');
  assert.deepEqual(d.organicResults.map((r) => r.domain), ['forbes.com', 'hubspot.com']);
  assert.ok(d.organicResults.every((r) => r.urlIsRedirect === true), 'redirects must be flagged as such');
  assert.ok(d.organicResults.every((r) => r.url.includes('/goto')), 'the honest redirect URL is kept');
});

test('a redirect with no destination domain is still rejected', () => {
  // Guards the loophole the fix could have opened: keeping every google.com
  // link just because it is a redirect.
  const d = collect(
    serpHtml({ organic: [{ title: 'Google internal', url: 'https://www.google.com/preferences', displayed: 'google.com › preferences', redirect: true }] }),
  );
  assert.equal(d.organicResults.length, 0);
  assert.ok(d.diagnostics.rejected.some((r) => r.reason === 'redirect with no destination domain'));
});

test('style tags inside a container do not leak into extracted text', () => {
  // A real PAA block returned "How to answer engine optimization?.XTvndd:not(
  // .k9pDj){padding-left:16px" because Google inlines scoped CSS inside it.
  const html = serpHtml({ organic: manyResults(2) }).replace(
    '<div id="rso">',
    '<div id="rso"><div jscontroller="ogmBcd"><div jsname="Cpkphb" data-q="What is AEO?"><div role="heading">What is AEO?<style>.XTvndd:not(.k9pDj){padding-left:16px}</style></div></div></div>',
  );
  const d = collect(html);
  assert.equal(d.paa.length, 1);
  assert.equal(d.paa[0].question, 'What is AEO?', 'CSS leaked into the question text');
});

test('an empty ad container is not reported as an ads feature', () => {
  // Google ships #tads and #bottomads on every SERP whether or not there are
  // ads. Both real captures carried them with zero children text and zero
  // links, so presence alone reported "ads" on every page — a flag that is
  // always true carries no information about advertiser competition.
  const html = serpHtml({ organic: manyResults(3) }).replace(
    '<div id="center_col">',
    '<div id="center_col"><div id="tads"></div><div id="bottomads"></div>',
  );
  const d = collect(html);
  assert.ok(!d.serpFeatures.includes('ads'), 'empty ad containers were counted as ads');
  assert.equal(d.ads.length, 0);
});

test('a populated ad container still is reported', () => {
  const d = collect(serpHtml({ ads: [{ title: 'Buy SEO', url: 'https://ad.example.com/' }], organic: manyResults(2) }));
  assert.ok(d.serpFeatures.includes('ads'));
  assert.equal(d.ads.length, 1);
});

/* ------------------------------------------------------------ ads, for real */

test('finds top ads, which sit outside #center_col', () => {
  // Google puts #tads as a sibling of #center_col under #rcnt, not inside it.
  // A capture for "generative engine optimization" carried six ads; scanning
  // from #center_col found the two bottom ones and missed all four top ones.
  const d = collect(
    serpHtml({
      ads: [
        { title: 'GEO Platform', url: 'https://tryprofound.example/' },
        { title: 'GEO for Enterprise', url: 'https://adobe.example/' },
      ],
      organic: manyResults(3),
    }),
  );
  assert.equal(d.ads.length, 2);
  assert.deepEqual(
    d.ads.map((a) => a.domain),
    ['tryprofound.example', 'adobe.example'],
  );
  assert.equal(d.organicResults.length, 3);
});

test('reads an ad domain from span[role=text] when there is no cite', () => {
  // An ad has no <cite> and its href is a /goto redirect, so without the
  // span[role="text"] fallback the block resolves to no domain and is dropped
  // as "redirect with no destination domain".
  const d = collect(serpHtml({ ads: [{ title: 'Peec AI', url: 'https://peec.example/ai-geo' }], organic: manyResults(2) }));
  assert.equal(d.ads.length, 1);
  assert.equal(d.ads[0].domain, 'peec.example');
  assert.ok(d.ads[0].url.includes('/goto?url='), 'the honest redirect should be kept as the URL');
});

test('an ad block that is itself the marker is never filed as organic', () => {
  // isAdBlock used only querySelector, which cannot match the block itself. A
  // div[data-text-ad] therefore looked like an ordinary result: once ad blocks
  // became scannable, six competitor ads would have entered the rankings.
  const d = collect(serpHtml({ ads: [{ title: 'Ranked ad', url: 'https://ad.example/' }], organic: manyResults(4) }));
  assert.ok(!d.organicResults.some((r) => r.domain === 'ad.example'));
  assert.equal(d.organicResults.length, 4);
  assert.equal(d.ads[0].isSponsored, true);
});

/* --------------------------------------------- Google as publisher vs chrome */

test('a Google property that publishes content is a normal organic result', () => {
  // developers.google.com ranked 1st on "ecommerce seo" and 2nd on "generative
  // engine optimization" in real captures, and was discarded as
  // "google-internal" while the AI Overview parser kept citing it -- inventing a
  // cited-but-not-ranking divergence in the metric this tool exists to measure.
  const d = collect(
    serpHtml({
      organic: [
        { title: 'Best practices for ecommerce sites', url: 'https://developers.google.com/search/docs/ecommerce', snippet: 'x' },
        ...manyResults(3),
      ],
    }),
  );
  assert.equal(d.organicResults[0].domain, 'developers.google.com');
  assert.equal(d.organicResults.length, 4);
});

test("still drops Google's own search chrome", () => {
  const d = collect(
    serpHtml({
      organic: [
        { title: 'More results', url: 'https://www.google.com/search?q=more', snippet: 'x' },
        { title: 'Sign in', url: 'https://accounts.google.com/signin', snippet: 'x' },
        { title: 'An image host', url: 'https://encrypted-tbn0.gstatic.com/images', snippet: 'x' },
        ...manyResults(2),
      ],
    }),
  );
  const domains = d.organicResults.map((r) => r.domain);
  assert.ok(!domains.some((x) => /^(www\.)?google\.|gstatic|accounts\.google/.test(x)), `chrome leaked: ${domains}`);
  assert.equal(d.organicResults.length, 2);
});

test('a filename mentioned in an AI Overview is not a cited domain', () => {
  // "shopify seo optimization" returned robots.txt and sitemap.xml as two of its
  // eleven citations, because BARE_DOMAIN matches any word.word.
  const html = serpHtml({ aiSources: ['https://tinyseo.example/a'], organic: manyResults(2) }).replace(
    '<ul><li>Structured data helps</li>',
    '<ul><li>Check your robots.txt</li><li>Submit sitemap.xml</li><li>Add llms.txt</li>',
  );
  const d = collect(html);
  const cited = d.aiOverview.sources.map((s) => s.domain);
  assert.deepEqual(cited, ['tinyseo.example'], `filenames leaked in as citations: ${cited}`);
});

/* ------------------------------------------------------------ full export */

test('the full JSON export keeps the raw snapshot when asked', () => {
  // serpsJson used to default includeRawHtml to false, and both call sites took
  // the default. A 15-capture export therefore shipped with every snapshot
  // stripped -- while the popup checkbox that captured them reported, correctly,
  // that they had been kept. The export could not be re-parsed after a parser
  // fix, and a SERP from last Tuesday cannot be collected again.
  const d = collectSerp(parse(serpHtml({ organic: manyResults(3) })), URL_US, { includeRawHtml: true });
  assert.ok(d.rawHtml, 'fixture produced no rawHtml to begin with');

  const kept = JSON.parse(serpsJson([d], true));
  assert.ok(kept.serps[0].rawHtml, 'the snapshot was dropped from the full export');
  assert.equal(kept.count, 1);

  const dropped = JSON.parse(serpsJson([d], false));
  assert.equal(dropped.serps[0].rawHtml, undefined, 'opting out should still drop it');
});

test('a cite is parsed as text, never handed to new URL()', () => {
  // Chrome and Node's URL parsers disagree on a cite with a trailing date:
  //   new URL('https://university.webflow.com · Sep 26, 2025').hostname
  //     Chrome -> university.webflow.xn--com%20%20sep%2026,%202025-bgb
  //     Node   -> university.webflow.com
  // The extension runs in Chrome, so it dropped a real result from position 1
  // on two captures. This test cannot reproduce that -- it runs under Node --
  // so it asserts the string handling instead, which is the thing that removed
  // the dependency on either parser.
  const cases = [
    ['https://university.webflow.com · Sep 26, 2025', 'university.webflow.com'],
    ['https://www.forbes.com › Innovation › AI', 'forbes.com'],
    ['https://developers.google.com › search › docs', 'developers.google.com'],
    ['sana-commerce.com', 'sana-commerce.com'],
    ['https://blog.hubspot.com/marketing/seo', 'blog.hubspot.com'],
    ['26.9K+ views · 4 months ago', ''],
    ['60+ comments · 12 months ago', ''],
    ['', ''],
  ];
  for (const [cite, expected] of cases) {
    assert.equal(domainFromCite(cite), expected, `cite ${JSON.stringify(cite)}`);
  }
});
