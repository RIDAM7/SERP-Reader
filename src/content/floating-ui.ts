/**
 * The on-page panel: Collect, and when a queue is loaded, Next and Skip.
 *
 * Everything lives inside a shadow root. Google's stylesheet is enormous and
 * changes constantly; without isolation this button inherits whatever `div`
 * rules happen to exist that week and looks broken at random.
 *
 * Draggable, and the position is remembered — the button must never end up
 * parked over the first organic result, which is the part being read.
 */
const POSITION_KEY = 'serp-reader:button-position';

/** What the panel shows of the queue. */
export interface QueueView {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  next?: string;
}

export interface FloatingUI {
  setStatus(text: string, tone?: 'idle' | 'busy' | 'ok' | 'error'): void;
  setQueue(view: QueueView | null): void;
  /** Every button off while a capture runs, so nothing is opened or collected twice. */
  setBusy(busy: boolean): void;
  destroy(): void;
}

export interface PanelActions {
  onCollect: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
}

export function mountFloatingButton(actions: PanelActions): FloatingUI {
  const host = document.createElement('div');
  host.id = 'serp-reader-root';
  host.style.cssText = 'position:fixed;z-index:2147483647;top:120px;right:20px;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .panel {
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: #ffffff; color: #202124;
      border: 1px solid #dadce0; border-radius: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,.18);
      width: 220px; overflow: hidden; user-select: none;
    }
    .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 10px; background: #f8f9fa; border-bottom: 1px solid #ecedef;
      cursor: grab; font-weight: 600; font-size: 12px;
    }
    .head:active { cursor: grabbing; }
    .body { padding: 10px; }
    button {
      width: 100%; padding: 8px 10px; font: inherit; font-weight: 600;
      color: #fff; background: #1a73e8; border: 0; border-radius: 6px; cursor: pointer;
    }
    button:hover { background: #1765cc; }
    button:disabled { background: #9aa0a6; cursor: default; }
    .status { margin-top: 8px; font-size: 11.5px; color: #5f6368; min-height: 15px; }
    .status.ok { color: #188038; }
    .status.error { color: #c5221f; }
    .status.busy { color: #b06000; }
    .queue { margin-top: 10px; padding-top: 10px; border-top: 1px solid #ecedef; }
    .queue[hidden], .skip[hidden] { display: none; }
    .count { font-size: 11.5px; color: #5f6368; margin-bottom: 6px; }
    .next { background: #188038; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .next:hover { background: #137333; }
    .skip {
      margin-top: 4px; padding: 4px; background: none; color: #5f6368;
      font-weight: 400; font-size: 11.5px;
    }
    .skip:hover { background: #f1f3f4; }
    .skip:disabled { background: none; color: #bdc1c6; }
  `;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="head"><span>SERP Reader</span><span class="grip">⠿</span></div>
    <div class="body">
      <button type="button" class="collect">Collect SERP</button>
      <div class="status">Ready</div>
      <div class="queue" hidden>
        <div class="count"></div>
        <button type="button" class="next"></button>
        <button type="button" class="skip">Skip this one</button>
      </div>
    </div>`;

  shadow.append(style, panel);
  document.documentElement.appendChild(host);

  const collect = shadow.querySelector('.collect') as HTMLButtonElement;
  const status = shadow.querySelector('.status') as HTMLElement;
  const queue = shadow.querySelector('.queue') as HTMLElement;
  const count = shadow.querySelector('.count') as HTMLElement;
  const next = shadow.querySelector('.next') as HTMLButtonElement;
  const skip = shadow.querySelector('.skip') as HTMLButtonElement;

  let busy = false;
  let hasNext = false;
  const sync = () => {
    collect.disabled = busy;
    next.disabled = busy || !hasNext;
    skip.disabled = busy || !hasNext;
  };

  const setStatus: FloatingUI['setStatus'] = (t, tone = 'idle') => {
    status.textContent = t;
    status.className = `status ${tone}`;
  };

  const setBusy = (b: boolean) => {
    busy = b;
    sync();
  };

  const setQueue: FloatingUI['setQueue'] = (view) => {
    queue.hidden = !view;
    if (!view) return;
    const extra = [view.failed && `${view.failed} failed`, view.skipped && `${view.skipped} skipped`].filter(Boolean);
    count.textContent = `Queue: ${view.done} of ${view.total} done${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
    hasNext = Boolean(view.next);
    next.textContent = view.next ? `Next: ${view.next}` : 'Queue finished';
    next.title = view.next ?? '';
    skip.hidden = !view.next;
    sync();
  };

  const run = (fn: () => void | Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  collect.addEventListener('click', run(actions.onCollect));
  next.addEventListener('click', run(actions.onNext));
  skip.addEventListener('click', run(actions.onSkip));

  // --- dragging -----------------------------------------------------------
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    if (saved) {
      const { top, left } = JSON.parse(saved) as { top: number; left: number };
      host.style.top = `${top}px`;
      host.style.left = `${left}px`;
      host.style.right = 'auto';
    }
  } catch {
    /* a blocked localStorage must not cost us the button */
  }

  const head = shadow.querySelector('.head') as HTMLElement;
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  head.addEventListener('mousedown', (e) => {
    dragging = true;
    const r = host.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const left = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - offsetX));
    const top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offsetY));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = 'auto';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    try {
      const r = host.getBoundingClientRect();
      localStorage.setItem(POSITION_KEY, JSON.stringify({ top: r.top, left: r.left }));
    } catch {
      /* ignore */
    }
  });

  return {
    setStatus,
    setQueue,
    setBusy,
    destroy: () => host.remove(),
  };
}
