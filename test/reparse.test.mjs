/**
 * test/reparse.mjs: a stored export read again by today's parser.
 *
 * Built on the real ai-engineer-career snapshot, a reply in the overview slot
 * that parser 1.0.0 stored as present: true with two domain chips. The export
 * around it is made up here, the way 1.0.0 wrote it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PARSER_VERSION } from './.parser.mjs';
import { reparseExport, reparseFile } from './reparse.mjs';

const FIXTURE = 'test/fixtures/real-in-ai-engineer-career';
const sidecar = JSON.parse(readFileSync(`${FIXTURE}.expected.json`, 'utf8'));

const oldExport = () => ({
  exportedAt: '2026-10-15T06:20:00.000Z',
  count: 2,
  serps: [
    {
      id: 'capture-1',
      collectedAt: sidecar.capturedAt,
      metadata: {
        query: sidecar.query,
        url: sidecar.url,
        googleDomain: 'www.google.com',
        language: 'en',
        country: 'in',
        device: 'desktop',
        timestamp: sidecar.capturedAt,
        organicResultCount: 99,
        adCount: 0,
        paaCount: 0,
        features: ['ai_overview'],
      },
      organicResults: [],
      ads: [],
      paa: [],
      aiOverview: {
        present: true,
        sources: [
          { url: 'https://roadmap.sh/', domain: 'roadmap.sh', order: 1 },
          { url: 'https://naukri.com/', domain: 'naukri.com', order: 2 },
        ],
      },
      serpFeatures: ['ai_overview'],
      relatedSearches: [],
      peopleAlsoSearchFor: [],
      diagnostics: { parserVersion: '1.0.0', warnings: [] },
      rawHtml: readFileSync(`${FIXTURE}.html`, 'utf8'),
    },
    {
      id: 'capture-2',
      collectedAt: '2026-10-15T06:15:00.000Z',
      metadata: { query: 'no snapshot kept', country: 'in' },
      organicResults: [{ position: 1, domain: 'example.com' }],
      diagnostics: { parserVersion: '1.0.0' },
    },
  ],
});

test('re-read: identity and what only the live page knew are kept, the rest is the parser of today', () => {
  const before = oldExport();
  const { envelope, lines, reread, kept, from } = reparseExport(before, { snapshotIn: 'serps-2026-10-15.json' });
  const [s, bare] = envelope.serps;

  assert.equal(envelope.exportedAt, before.exportedAt);
  assert.equal(envelope.parserVersion, PARSER_VERSION);
  assert.equal(envelope.count, 2);
  assert.ok(envelope.reparsedAt);
  assert.deepEqual([reread, kept, from], [1, 1, ['1.0.0']]);

  assert.equal(s.id, 'capture-1');
  assert.equal(s.collectedAt, sidecar.capturedAt);
  assert.equal(s.metadata.timestamp, sidecar.capturedAt);
  assert.equal(s.metadata.language, 'en');
  // The snapshot stays in the original, which the re-read names.
  assert.equal(s.rawHtml, undefined);
  assert.equal(s.snapshotIn, 'serps-2026-10-15.json');
  assert.equal(s.diagnostics.parserVersion, PARSER_VERSION);

  // The parser's own readings, and the counts that summarise them, follow the re-read.
  assert.equal(s.organicResults.length, sidecar.organicCount);
  assert.equal(s.metadata.organicResultCount, sidecar.organicCount);
  assert.equal(s.metadata.paaCount, sidecar.paaCount);
  assert.deepEqual(s.metadata.features, sidecar.features);
  assert.deepEqual(s.serpFeatures, sidecar.features);
  assert.equal(s.aiOverview.status, 'ai_mode_reply');
  assert.equal(s.aiOverview.present, false);
  assert.deepEqual(s.aiOverview.sources.map((c) => c.domain), sidecar.aiCitationDomains);

  // A capture with nothing to re-read is the original, untouched.
  assert.deepEqual(bare, before.serps[1]);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ {2}ai engineer career +organic 0->9, paa 0->4, ai rendered->ai_mode_reply, sources 2->19, features \+ai_mode_reply \+people_also_ask \+related_searches -ai_overview, related searches$/);
});

test('re-read file: written beside the original, which is never touched; a re-read is not re-read again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'serp-reparse-'));
  try {
    const original = join(dir, 'serps-2026-10-15.json');
    const text = JSON.stringify(oldExport(), null, 2);
    writeFileSync(original, text);
    const log = [];

    const target = reparseFile(original, { log: (l) => log.push(l) });
    assert.equal(target, join(dir, 'serps-2026-10-15.reparsed.json'));
    assert.equal(readFileSync(original, 'utf8'), text);
    const [reread, bare] = JSON.parse(readFileSync(target, 'utf8')).serps;
    assert.equal(reread.aiOverview.status, 'ai_mode_reply');
    assert.equal(reread.snapshotIn, 'serps-2026-10-15.json');
    assert.ok(!('rawHtml' in reread));
    assert.ok(!('snapshotIn' in bare), 'a capture with no snapshot points at none');
    assert.ok(statSync(target).size < statSync(original).size / 10, 'the snapshot is not copied');
    assert.match(log.at(-1), /^1 re-read, 1 without a snapshot kept as they were \(parser 1\.0\.0 -> \d+\.\d+\.\d+\)/);

    assert.equal(reparseFile(target, { log: () => {} }), null);
    assert.ok(!existsSync(join(dir, 'serps-2026-10-15.reparsed.reparsed.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-read: a bare array of captures gets the envelope', () => {
  const { envelope } = reparseExport(oldExport().serps);
  assert.equal(envelope.exportedAt, undefined);
  assert.equal(envelope.count, 2);
  assert.equal(envelope.serps[0].id, 'capture-1');
});
