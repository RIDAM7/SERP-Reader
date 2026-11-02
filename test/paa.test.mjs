/**
 * People Also Ask on Google's own markup.
 *
 * The fixture is the PAA block of a real capture ("geo vs seo", 2026-11-02),
 * not a reconstruction: the synthetic paaBlock in fixtures.mjs puts the answer
 * inside the question's container, which is exactly what today's layout does
 * not do, and a suite built on it stayed green while the expand pass opened
 * nothing worth reading.
 *
 * linkedom runs no Google script, so a click opens nothing by itself. The
 * click test stands in for Google: a click on a toggle marks it open and draws
 * an answer into the region it names, as the live page does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

import { collectSerp, expandPAA } from './.parser.mjs';

const URL_GEO = 'https://www.google.com/search?q=geo%20vs%20seo&gl=us&hl=en&pws=0&num=20';
const HTML = readFileSync('test/fixtures/paa-2026-11-02-geo-vs-seo.html', 'utf8');
const QUESTIONS = [
  'Is GEO replacing SEO?',
  'Is SEO still relevant in 2026?',
  'Is SEO dead now with AI?',
  'What are the four types of SEO?',
];

const load = () => parseHTML(HTML).document;

test('the expand pass clicks each unanswered question\'s own toggle, once', async () => {
  const doc = load();
  const toggles = [...doc.querySelectorAll('div.cUnQKe [aria-expanded]')];
  assert.equal(toggles.length, 4);

  // The first answer shipped rendered; this is what a Google answer looks like once it lands.
  const rendered = doc.getElementById(toggles[0].getAttribute('aria-controls')).innerHTML;
  const clicks = [];
  doc.addEventListener('click', (e) => {
    const t = e.target;
    clicks.push(t);
    if (!t.hasAttribute('aria-expanded')) return;
    t.setAttribute('aria-expanded', String(t.getAttribute('aria-expanded') !== 'true'));
    doc.getElementById(t.getAttribute('aria-controls')).innerHTML = rendered;
  });

  const paa = await expandPAA(doc, URL_GEO, { delayMs: 0, timeoutMs: 0 });

  // The toggle itself is the click target, never a wrapper, and none is clicked twice:
  // the old pass reached the first toggle a second time through the block and closed it.
  assert.deepEqual(clicks, toggles.slice(1), 'clicked something other than the three closed toggles, each once');
  assert.deepEqual(
    toggles.map((t) => t.getAttribute('aria-expanded')),
    ['false', 'true', 'true', 'true'],
    'the answered first question must be left alone: a click there closes it',
  );
  assert.deepEqual(paa.map((p) => p.question), QUESTIONS);
  assert.ok(paa.every((p) => p.expanded && p.sourceDomain === 'forbes.com'));
});

test('an answer and its source are read from the region the toggle names, not from the toggle', () => {
  const doc = load();
  const toggle = doc.querySelector('div.cUnQKe [aria-expanded]');
  assert.doesNotMatch(toggle.textContent, /AI Mode replied/, 'the answer is not inside the toggle');

  const { paa } = collectSerp(doc, URL_GEO, { includeRawHtml: false });
  assert.deepEqual(paa.map((p) => p.question), QUESTIONS);

  const [first, ...rest] = paa;
  assert.equal(first.expanded, true);
  assert.match(first.answer, /^AI Mode replied:No, GEO \(Generative Engine Optimization\) is not replacing SEO/);
  // An AI answer cites source cards; the first card is the source, a signed /goto with its domain read from the card.
  assert.equal(first.sourceDomain, 'forbes.com');
  assert.match(first.sourceUrl, /^https:\/\/www\.google\.com\/goto\?url=/);

  // An unloaded region holds a spinner, a hidden error line and "Ask anything in AI Mode" chips. None is an answer.
  for (const p of rest) {
    assert.equal(p.expanded, false, `${p.question} read as answered`);
    assert.equal(p.answer, undefined);
    assert.equal(p.sourceUrl, undefined);
  }
});

test('the block around the questions is not a question, even when the search reads like one', () => {
  // The block's data-initq is the search. "how to get recommended by chatgpt" was recorded as its own PAA question.
  const doc = load();
  doc.querySelector('div.cUnQKe').setAttribute('data-initq', 'how to get recommended by chatgpt');
  const { paa } = collectSerp(doc, URL_GEO, { includeRawHtml: false });
  assert.deepEqual(paa.map((p) => p.question), QUESTIONS);
});
