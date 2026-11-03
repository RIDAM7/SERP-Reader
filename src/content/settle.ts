/**
 * Wait for the results column to stop changing.
 *
 * An AI Overview streams in after the page loads, and a capture taken
 * mid-stream keeps half of it. A person waits for that by eye before pressing
 * Collect; a capture that starts itself has to wait the same way. Quiet means
 * no change in the column for `quietMs`, never sooner than `minMs`, and a page
 * that never goes quiet costs at most `maxMs`.
 */
import { SNAPSHOT_ROOTS } from '../parser/selectors';
import { pick } from '../parser/utils';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pageSettled(
  doc: Document,
  { minMs = 2500, quietMs = 1500, maxMs = 15000 } = {},
): Promise<void> {
  const root = pick(doc, SNAPSHOT_ROOTS) ?? doc.body;
  const start = Date.now();
  let last = start;
  const observer = new MutationObserver(() => {
    last = Date.now();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  try {
    while (Date.now() - start < maxMs) {
      await sleep(250);
      const now = Date.now();
      if (now - start >= minMs && now - last >= quietMs) return;
    }
  } finally {
    observer.disconnect();
  }
}
