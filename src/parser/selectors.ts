/**
 * Every Google selector in the project, in one file.
 *
 * Google reshuffles class names without notice, so the rule here is: no
 * selector literal appears anywhere else in the codebase. When extraction
 * breaks — and it will — this is the only file to edit.
 *
 * Each group is an ordered list tried in turn. The obfuscated class names
 * (`MjjYud`, `tF2Cxc`) are the fragile ones and come first because they are
 * precise; the structural fallbacks (`#rso > div`, `div[data-hveid]`) are
 * durable but noisy and come last. Something is better than nothing, and the
 * validation in organic.ts is what stops the noisy fallbacks producing junk.
 */

export const PARSER_VERSION = '1.0.0';

/**
 * Where to scan. First match wins.
 *
 * `#rcnt`, not `#center_col`. Google puts the top ad block (`#tads`) as a
 * sibling *of* `#center_col`, one level up — measured on all three real
 * captures, where `#center_col.contains(#tads)` was false every time. Scanning
 * from `#center_col` therefore sees bottom ads and never top ads: on a
 * "generative engine optimization" SERP carrying six ads it found two.
 *
 * An earlier comment here asserted `#center_col` covered `#tads`. It never did;
 * the claim was assumed rather than measured, and organic results looked right
 * throughout, which is exactly why it survived.
 *
 * Scanning wide and filtering is the right way round here: NON_ORGANIC_CONTAINERS
 * already names every region whose links must not become organic positions, and
 * a container that is missing from that list is a visible bug rather than a
 * silent omission.
 */
export const ROOTS = ['#rcnt', '#center_col', '#rso', '#search', 'div[role="main"]', 'main'];

/** Candidate blocks that might each be one organic result. */
export const RESULT_BLOCKS = [
  // Confirmed against a live google.com/search on 2026-09-05: tF2Cxc = 8
  // result containers, MjjYud = 21 wrappers, div.g = 0 (retired by Google).
  'div.tF2Cxc',
  'div.MjjYud',
  'div.g',
  'div[data-snc]',
  'div[data-hveid][data-ved]',
  '#rso > div',
  // Ads. Their block carries data-hveid but NOT data-ved, so the structural
  // fallback above misses them: on a 'generative engine optimization' capture
  // the page held six ads and the parser returned none. Ads are only usable
  // data because isAdBlock files them separately -- see organic.ts.
  'div[data-text-ad]',
];

/** A result's clickable heading. */
export const RESULT_TITLE = ['h3', 'div[role="heading"][aria-level="3"]', 'a h3'];

/** The anchor wrapping a result heading. Live SERP: `a.zReHs[jsname=UWckNb]`. */
export const RESULT_ANCHOR = ['a.zReHs', 'a[jsname="UWckNb"]', 'a[href]'];

/**
 * The breadcrumb line above a title.
 *
 * Ads have no <cite> at all -- they show the URL in a span[role="text"]. Without
 * that fallback an ad's /goto href resolves to no domain and the block is
 * dropped as 'redirect with no destination domain'. Last in the list, so a real
 * cite always wins where one exists.
 */
export const DISPLAYED_URL = ['cite', 'div.byrV5b cite', 'span.qzEoUe', 'div.TbwUpd', 'span[role="text"]'];

/** Snippet text under a result. */
export const SNIPPET = [
  'div.VwiC3b',
  'div[data-sncf] div',
  'div.IsZvec',
  'div.lEBKkf',
  'div[data-content-feature] span',
];

export const SITELINKS = ['div.usJj9c a', 'div.HiHjCd a', 'table.jmjoTe a'];

export const FAVICON = ['img.XNo5Ab', 'img[data-atf] ', 'span.eqA2re img', 'img.zr758c'];

/** Containers whose links must never count as organic. */
export const NON_ORGANIC_CONTAINERS = [
  '#taw', // ads block, top
  '#bottomads',
  '#tads',
  'div[data-text-ad]',
  'div[aria-label="Ads"]',
  'div[jsname="Cpkphb"]', // people also ask
  'div[data-initq]',
  'div.related-question-pair',
  'div[jscontroller="ogmBcd"]', // PAA container variants
  '#kp-wp-tab-overview', // knowledge panel
  'div.kp-wholepage',
  'div[data-attrid]',
  'g-scrolling-carousel',
  'div.ULSxyf div.EyBRub', // image/video strips
  '#rhs',
  '#botstuff div.oIk2Cb', // related searches block
  'div[data-hveid][data-ved] g-more-link',
];

export const PAA = {
  /*
   * The accordion toggles, not the wrappers.
   *
   * `div.cUnQKe div[jsname]` matched 79 elements on a real capture — nested
   * duplicates, style tags and section labels — and produced a PAA list
   * containing "AI Overview" and "Write Answer-First Content" alongside the
   * actual questions. The four elements carrying `aria-expanded` were exactly
   * the four real questions, with clean text.
   */
  containers: [
    'div.cUnQKe [aria-expanded]',
    '[jsname="Cpkphb"][aria-expanded]',
    'div[jsname="Cpkphb"]',
    'div.related-question-pair',
    'div[data-initq]',
    'div[jscontroller="ogmBcd"] div[data-q]',
  ],
  question: ['div[role="heading"]', 'span.CSkcDe', 'div.iDjcJe', 'div.JlqpRe', ':scope'],
  answer: ['div.wDYxhc', 'div[data-attrid] span', 'div.hgKElc', 'div.LGOjhe'],
  sourceLink: ['a[href^="http"]', 'div.yuRUbf a', 'div.eKjLze a'],
  /** Clickable element used by the optional expand pass. */
  toggle: ['div[role="button"]', 'div[jsname="ibnC6b"]', 'div.related-question-pair > div'],
};

export const AI_OVERVIEW = {
  containers: [
    // Order is not authoritative here — aiOverview.ts picks whichever of these
    // holds the most text, because div.Fzsovc matched first on a real capture
    // with 11 characters while div.YzCcne held the answer and 31 links.
    'div.YzCcne',
    'div.Fzsovc',
    'div[data-subtree="aio"]',
    'div#m-x-content',
    'div[jsname="ffOcnc"]',
    'div[data-attrid="SGEAnswer"]',
    'div.YzCcne',
    'div[aria-label*="AI Overview" i]',
    'div[data-al-page-type="aio"]',
  ],
  heading: ['h1', 'h2', 'div[role="heading"]'],
  text: ['div[data-attrid] span', 'div.WaaZC', 'div[jsname="txFAF"]', 'p'],
  bullets: ['li'],
  sources: ['a[href^="http"]'],
};

export const FEATURED_SNIPPET = [
  'div.xpdopen',
  'block-component',
  'div[data-tts="answers"]',
  'div.g.mnr-c.g-blk',
];

export const RELATED_SEARCHES = {
  containers: ['#botstuff div.oIk2Cb', 'div[data-abe]', 'div.AJLUJb', '#brs'],
  items: ['a', 'div[role="link"]', 'b'],
};

export const PEOPLE_ALSO_SEARCH_FOR = ['div.s75CSd', 'div[data-hveid] g-inline-list a'];

/** Feature detection: first selector that matches marks the feature present. */
export const FEATURE_MARKERS: Record<string, string[]> = {
  ai_overview: AI_OVERVIEW.containers,
  featured_snippet: FEATURED_SNIPPET,
  people_also_ask: PAA.containers,
  local_pack: ['div[data-rc_ludocids]', 'div.rllt__details', 'div[jscontroller="J7Ku5b"]', '#lu_map'],
  video_carousel: ['div[data-vurl]', 'g-scrolling-carousel video-voyager', 'div.RzdJxc'],
  news: ['g-section-with-header div.SoaBEf', 'div[data-news-cluster-id]'],
  top_stories: ['div[aria-label="Top stories" i]', 'g-section-with-header h2'],
  images: ['div[data-lpage]', 'g-section-with-header div.eA0Zlc', 'div.islrc'],
  shopping: ['div.sh-dgr__content', 'div[data-pla-adid]', 'div.commercial-unit-desktop-top'],
  discussions: ['div[aria-label*="Discussions" i]', 'div.LJ7wUe'],
  twitter: ['g-scrolling-carousel[data-hveid] a[href*="twitter.com"]', 'a[href*="x.com/"]'],
  reddit: ['a[href*="reddit.com"]'],
  knowledge_panel: ['#rhs div.kp-wholepage', 'div[data-attrid="kc:/"]', '#kp-wp-tab-overview'],
  related_searches: RELATED_SEARCHES.containers,
  people_also_search_for: PEOPLE_ALSO_SEARCH_FOR,
  sitelinks: SITELINKS,
  ads: ['#tads', '#bottomads', 'div[data-text-ad]', 'span[aria-label="Ad" i]'],
};

/** Ads must never be counted as organic, so their markers are checked per block. */
export const AD_MARKERS = [
  '[data-text-ad]',
  'span.U3A9Ac',
  'span[aria-label="Ad" i]',
  'div[aria-label="Ads" i]',
];

/** Snapshot only the results column, not the whole document. */
export const SNAPSHOT_ROOTS = ['#rcnt', '#center_col', '#search', 'div[role="main"]'];
