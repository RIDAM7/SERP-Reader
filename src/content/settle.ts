/**
 * Wait for the results column to stop changing.
 *
 * An AI Overview streams in after the page loads, and a capture taken
 * mid-stream keeps half of it. A person waits for that by eye before pressing
 * Collect; a capture that starts itself has to wait the same way. Quiet means
 * no change in the column for `quietMs`, never sooner than `minMs`, and a page
 * that never goes quiet costs at most `maxMs`.
 *
 * Quiet is not finished while Google shows its "Thinking" line: the column
 * holds still while it thinks a little longer, and three queue captures on
 * 2026-11-03 were taken in that pause (aiOverview.ts, overviewWriting). So the
 * wait goes on while that line shows, up to `writingMaxMs`. A capture taken
 * after that records the overview as still being written.
 */
import { overviewWriting } from '../parser/aiOverview';
import { SNAPSHOT_ROOTS } from '../parser/selectors';
import { pick } from '../parser/utils';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pageSettled(
  doc: Document,
  { minMs = 2500, quietMs = 1500, maxMs = 15000, writingMaxMs = 30000 } = {},
): Promise<void> {
  const root = pick(doc, SNAPSHOT_ROOTS) ?? doc.body;
  const start = Date.now();
  let last = start;
  const observer = new MutationObserver(() => {
    last = Date.now();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  try {
    for (;;) {
      await sleep(250);
      const now = Date.now();
      const writing = overviewWriting(doc);
      if (now - start >= minMs && now - last >= quietMs && !writing) return;
      if (now - start >= (writing ? writingMaxMs : maxMs)) return;
    }
  } finally {
    observer.disconnect();
  }
}
