/**
 * Shared helpers. No selector literals here — those live in selectors.ts.
 */

/** First element matching any selector in the list, or null. */
export function pick(root: ParentNode, selectors: string[]): Element | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // An invalid selector must not take the whole extraction down.
    }
  }
  return null;
}

/** Everything matching any selector in the list, de-duplicated, in DOM order. */
export function pickAll(root: ParentNode, selectors: string[]): Element[] {
  const seen = new Set<Element>();
  for (const sel of selectors) {
    try {
      for (const el of Array.from(root.querySelectorAll(sel))) seen.add(el);
    } catch {
      /* ignore a selector Google's markup has outgrown */
    }
  }
  return [...seen];
}

/**
 * Visible text, with `<style>` and `<script>` contents removed first.
 *
 * `textContent` includes the text inside a `<style>` tag, and Google inlines
 * scoped CSS *inside* result and PAA containers. Reading a PAA question without
 * this returns things like
 * `How to answer engine optimization?.XTvndd:not(.k9pDj){padding-left:16px`.
 *
 * Cloning to strip them keeps the live DOM untouched, which matters because
 * this runs on the user's real page.
 */
export function text(el: Element | null | undefined): string {
  if (!el) return '';
  let source: Element = el;
  try {
    if (el.querySelector('style, script, noscript, template')) {
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll('style, script, noscript, template').forEach((n) => n.remove());
      source = clone;
    }
  } catch {
    /* cloning failed; fall back to the original and accept the noise */
  }
  return (source.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** First non-empty text from a list of selectors. */
export function textFrom(root: ParentNode, selectors: string[]): string {
  for (const sel of selectors) {
    try {
      for (const el of Array.from(root.querySelectorAll(sel))) {
        const t = text(el);
        if (t) return t;
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

/**
 * Google wraps some outbound links as /url?q=… — unwrap those to the real
 * destination, and leave everything else alone.
 */
export interface ResolvedHref {
  url: string;
  /** True when `url` is a Google redirect whose destination is not in the DOM. */
  isRedirect: boolean;
}

/**
 * Turn a result's href into something usable.
 *
 * Three shapes appear on Google today:
 *
 *   1. A direct `https://…` link.
 *   2. `/url?q=https://…` — the old wrapper, unwrapped here to the real URL.
 *   3. `/goto?url=CAESpAEB…` — the current one, where the destination is an
 *      encoded, signed protobuf blob. It is *not* recoverable from the page:
 *      the `ping` attribute carries the same blob, no other anchor in the block
 *      holds the destination, and no data attribute does either. Verified
 *      against a live SERP rather than assumed.
 *
 * For (3) the honest answer is to keep the redirect — it is a real URL that
 * resolves when clicked — and say so with `isRedirect`. Reconstructing a
 * destination from the `cite` breadcrumb would look tidier and be a guess, and
 * a fabricated URL in a research dataset is worse than an honest redirect.
 *
 * The domain is recovered separately from `cite`, which is what analysis keys
 * on anyway.
 */
export function resolveHref(href: string | null | undefined, pageUrl: string): ResolvedHref | null {
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href, pageUrl);
  } catch {
    return null;
  }

  const isGoogleHost = /(^|\.)google\.[a-z.]+$/i.test(u.hostname);

  if (isGoogleHost && (u.pathname === '/url' || u.pathname === '/goto')) {
    const candidate = u.searchParams.get('q') ?? u.searchParams.get('url');
    if (candidate && /^https?:\/\//i.test(candidate)) {
      try {
        const real = new URL(candidate);
        return { url: real.href, isRedirect: false };
      } catch {
        /* fall through and keep the redirect */
      }
    }
    return { url: u.href, isRedirect: true };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return { url: u.href, isRedirect: false };
}

/** Back-compat helper: the URL only, or null. */
export function cleanUrl(href: string | null | undefined, pageUrl: string): string | null {
  return resolveHref(href, pageUrl)?.url ?? null;
}

/**
 * The domain from a `<cite>` breadcrumb: `https://www.forbes.com › Innovation › AI`.
 *
 * The only reliable source of a destination domain when the link is a redirect.
 * The breadcrumb segments after the host are Google's display form and are not
 * a real path, so they are deliberately not used to build a URL.
 */
/** A hostname shape: labels separated by dots, ending in a real-looking TLD. */
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/i;

export function domainFromCite(citeText: string): string {
  if (!citeText) return '';
  const head = citeText.split(/[›»]/)[0].trim();

  let candidate = '';
  try {
    candidate = new URL(/^https?:\/\//i.test(head) ? head : `https://${head}`).hostname;
  } catch {
    candidate = head.match(/[a-z0-9-]+(\.[a-z0-9-]+)+/i)?.[0] ?? '';
  }
  candidate = candidate.replace(/^www\./, '').toLowerCase();

  /*
   * Validate the shape before believing it.
   *
   * Not every `cite` holds a URL. A video result's cite reads
   * "26.9K+ views · 4 months ago", and feeding that to `new URL()` produced the
   * hostname `26.xn--9k+%20views%20%204%20months%20ago-3sb` — punycode nonsense
   * that sailed through as a domain and put a video carousel entry at organic
   * position 1 in the first real capture.
   *
   * Rejecting anything that is not hostname-shaped removes that whole class of
   * result, because a block with no parseable destination is not one we can
   * honestly report a domain for.
   */
  return HOSTNAME.test(candidate) ? candidate : '';
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Google's own search chrome — NOT everything Google happens to publish.
 *
 * The old test excluded every `*.google.com` subdomain. That threw away
 * `developers.google.com`, which ranked organically on two of the three real
 * captures ("Best practices for ecommerce sites in Google Search", "Google's
 * Guide to Optimizing for Generative AI Features") — while the AI Overview
 * parser, which applies no such filter, went on citing it.
 *
 * The dataset therefore reported developers.google.com as cited-but-not-ranking.
 * That is a fabricated divergence in the one measurement this tool exists to
 * make, so the rule is now: exclude the hosts that ARE the search product, and
 * treat every other Google property as the publisher it is.
 *
 * The old regex also missed the `.google` gTLD, so `search.google`, `ai.google`
 * and `blog.google` were already being kept — inconsistently.
 */
const GOOGLE_UI_HOSTS = [
  /^(www[.])?google[.][a-z.]+$/i, // the SERP host itself
  /^(accounts|policies|myaccount|myactivity|maps)[.]google[.][a-z.]+$/i,
  /(^|[.])gstatic[.]com$/i,
  /(^|[.])googleusercontent[.]com$/i,
];

export function isGoogleInternal(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return GOOGLE_UI_HOSTS.some((re) => re.test(h));
  } catch {
    return true;
  }
}

/**
 * Canonical form for de-duplication only — never stored.
 *
 * Strips the scheme, www, tracking parameters and a trailing slash, so the same
 * page linked twice on one SERP counts once. Deliberately conservative: it does
 * not strip meaningful query strings, because ?page=2 is a different page.
 */
export function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref|referrer|sourceid|ved|usg|sa|ei)/i.test(p)) u.searchParams.delete(p);
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.hostname.replace(/^www\./, '')}${path}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Is `el` inside any element matching one of these selectors? */
export function isInside(el: Element, root: ParentNode, containerSelectors: string[]): boolean {
  for (const sel of containerSelectors) {
    let container: Element | null;
    try {
      container = el.closest(sel);
    } catch {
      continue;
    }
    if (container && container !== el) return true;
    // `closest` misses containers that are not ancestors in odd shadow-ish
    // layouts, so fall back to a contains check against the matched roots.
    try {
      for (const c of Array.from(root.querySelectorAll(sel))) {
        if (c !== el && c.contains(el)) return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `serp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
