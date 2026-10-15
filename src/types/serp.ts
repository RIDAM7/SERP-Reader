/**
 * The data model.
 *
 * Deliberately additive: every optional field can be absent without a consumer
 * breaking, because Google ships layout changes and a parser that cannot return
 * a partial result returns nothing at all. Anything new gets added as optional.
 */

export type SerpFeature =
  | 'ai_overview'
  | 'featured_snippet'
  | 'people_also_ask'
  | 'local_pack'
  | 'video_carousel'
  | 'news'
  | 'top_stories'
  | 'images'
  | 'shopping'
  | 'discussions'
  | 'twitter'
  | 'reddit'
  | 'knowledge_panel'
  | 'related_searches'
  | 'people_also_search_for'
  | 'sitelinks'
  | 'ads'
  /** The AI Overview slot held an AI Mode reply instead of an overview. See AIOverviewStatus. */
  | 'ai_mode_reply';

export interface Sitelink {
  title: string;
  url: string;
}

export interface OrganicResult {
  position: number;
  type: 'organic';
  title: string;
  url: string;
  domain: string;
  /**
   * True when `url` is a Google /goto redirect rather than the destination.
   *
   * Google no longer exposes the real URL anywhere in the SERP DOM — href and
   * ping both carry the same signed blob. The redirect is kept because it is
   * real and resolves; `domain` comes from the cite breadcrumb. Nothing here
   * reconstructs a path, because a guessed URL in a research dataset is worse
   * than an honest redirect.
   */
  urlIsRedirect?: boolean;
  displayedUrl?: string;
  snippet?: string;
  faviconUrl?: string;
  sitelinks?: Sitelink[];
  /** Always false here. Sponsored rows are excluded before positions are assigned. */
  isSponsored: false;
}

export interface AdResult {
  position: number;
  type: 'ad';
  title: string;
  url: string;
  domain: string;
  displayedUrl?: string;
  snippet?: string;
  isSponsored: true;
}

export interface PAAItem {
  order: number;
  question: string;
  answer?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  /** True when the answer was already in the DOM or was expanded by us. */
  expanded: boolean;
}

export interface CitedSource {
  title?: string;
  url: string;
  /**
   * Empty when neither a source card's markup nor the slot's record for its
   * link names an origin — no card on the 2026-10-15 captures, but nothing
   * guarantees the next. `siteName` then says what it was.
   */
  domain: string;
  /** The name a source card shows ("Microsoft Learn", "YouTube"). Absent for a domain chip, which shows the domain. */
  siteName?: string;
  /** Order the citation appears in, 1-based. */
  order: number;
}

/**
 * What Google's AI Overview slot held.
 *
 *   rendered       an AI Overview. The only status where `present` is true.
 *   ai_mode_reply  an AI Mode reply in the slot, and no overview: either the
 *                  slot carries no visible "AI Overview" label, or Google
 *                  visibly said an overview is not available. Its text and
 *                  sources are kept, because they are what the searcher read.
 *   unavailable    Google visibly said an overview is not available, and
 *                  nothing else rendered.
 *
 * Absent when there was no slot, or an empty one: the same "no claim" the
 * record made before statuses existed.
 */
export type AIOverviewStatus = 'rendered' | 'unavailable' | 'ai_mode_reply';

export interface AIOverview {
  /** True only when an overview rendered: `status === 'rendered'`. */
  present: boolean;
  status?: AIOverviewStatus;
  heading?: string;
  text?: string;
  headings?: string[];
  bullets?: string[];
  sources: CitedSource[];
}

export interface FeaturedSnippet {
  present: boolean;
  text?: string;
  sourceUrl?: string;
  sourceDomain?: string;
}

export interface SerpMetadata {
  query: string;
  url: string;
  googleDomain: string;
  language?: string;
  country?: string;
  /** The uule parameter, when the URL carries an encoded location. */
  uule?: string;
  /** num= from the URL, when present. */
  requestedResults?: number;
  personalisationDisabled?: boolean;
  device: 'desktop' | 'mobile';
  timestamp: string;
  organicResultCount: number;
  adCount: number;
  paaCount: number;
  features: SerpFeature[];
}

/** What the parser saw, so a thin result can be told apart from a broken one. */
export interface Diagnostics {
  containersDetected: number;
  validOrganic: number;
  rejected: { reason: string; count: number }[];
  paaDetected: number;
  aiOverview: 'detected' | 'not detected' | 'ai mode reply' | 'unavailable';
  localPack: 'detected' | 'not detected';
  parserVersion: string;
  warnings: string[];
  /** Milliseconds the whole extraction took. */
  durationMs: number;
}

export interface SerpData {
  id: string;
  metadata: SerpMetadata;
  organicResults: OrganicResult[];
  ads: AdResult[];
  paa: PAAItem[];
  aiOverview?: AIOverview;
  featuredSnippet?: FeaturedSnippet;
  serpFeatures: SerpFeature[];
  relatedSearches: string[];
  peopleAlsoSearchFor: string[];
  knowledgePanelTitle?: string;
  diagnostics: Diagnostics;
  /** Trimmed SERP DOM, not the whole page. Kept so a future parser can re-read it. */
  rawHtml?: string;
  collectedAt: string;
}

/** Row shape stored for the history list, so listing does not load raw HTML. */
export interface SerpSummary {
  id: string;
  query: string;
  collectedAt: string;
  organicResultCount: number;
  paaCount: number;
  features: SerpFeature[];
  hasAiOverview: boolean;
  aiStatus?: AIOverviewStatus;
  googleDomain: string;
  country?: string;
}
