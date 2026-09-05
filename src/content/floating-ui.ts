/**
 * The on-page Collect button.
 *
 * Everything lives inside a shadow root. Google's stylesheet is enormous and
 * changes constantly; without isolation this button inherits whatever `div`
 * rules happen to exist that week and looks broken at random.
 *
 * Draggable, and the position is remembered — the button must never end up
 * parked over the first organic result, which is the part being read.
 */
const POSITION_KEY = 'serp-reader:button-position';

export interface FloatingUI {
  setStatus(text: string, tone?: 'idle' | 'busy' | 'ok' | 'error'): void;
  destroy(): void;
}

export function mountFloatingButton(onCollect: () => void | Promise<void>): FloatingUI {
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
      width: 190px; overflow: hidden; user-select: none;
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
  `;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="head"><span>SERP Reader</span><span class="grip">⠿</span></div>
    <div class="body">
      <button type="button" class="collect">Collect SERP</button>
      <div class="status">Ready</div>
    </div>`;

  shadow.append(style, panel);
  document.documentElement.appendChild(host);

  const button = shadow.querySelector('.collect') as HTMLButtonElement;
  const status = shadow.querySelector('.status') as HTMLElement;

  const setStatus: FloatingUI['setStatus'] = (t, tone = 'idle') => {
    status.textContent = t;
    status.className = `status ${tone}`;
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await onCollect();
    } finally {
      button.disabled = false;
    }
  });

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
    destroy: () => host.remove(),
  };
}
