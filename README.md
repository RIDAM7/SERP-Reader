# SERP Reader

A local Chrome extension that reads the Google results page **you already have
open** and stores it. No API, no server, no keys, no cost.

It does not search. You open a URL, Google renders it, you press **Collect**,
and the extension reads the DOM that is already on screen. That distinction is
the whole design: everything downstream — storage, exports, history — is built
on a page a person deliberately opened.

---

## Install

```bash
npm install
npm run build
```

Then in Chrome:

1. `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the **`dist/`** folder (not the project root)

`npm run watch` rebuilds on save; press the reload icon on the extension card to
pick changes up.

### Incognito

Chrome disables extensions in Incognito by default.

`chrome://extensions` → **Details** on SERP Reader → turn on **Allow in
Incognito**.

Captures made in Incognito are saved to the same local database as normal ones.
The extension does nothing to work around Incognito restrictions, and if Chrome
declines to run it there, it does not run.

---

## Using it

1. Build your Google URL yourself. The location parameters matter:

   ```
   https://www.google.com/search?q=YOUR+KEYWORD&gl=us&hl=en&pws=0&num=20
   ```

   `gl` country · `hl` language · `pws=0` no personalisation · `num` results

2. Open it (Incognito if you want a clean read).
3. Press **Collect** — either the floating panel on the page or the toolbar popup.
4. Next keyword.

Both buttons run the same code. The floating panel is draggable and remembers
where you put it.

---

## What it collects

| | Detail |
| --- | --- |
| **Organic results** | Up to 25. Position, title, URL, domain, displayed URL, snippet, favicon, sitelinks |
| **Ads** | Captured separately, never given an organic position |
| **People Also Ask** | Question, answer if rendered, source URL and domain, order, whether it was expanded |
| **AI Overview** | Heading, text, bullets, and **cited sources in order** |
| **Featured snippet** | Text and source |
| **Related searches** | And "people also search for" |
| **SERP features** | 17 detected: AI Overview, featured snippet, PAA, local pack, video, news, top stories, images, shopping, discussions, Twitter/X, Reddit, knowledge panel, related searches, people also search for, sitelinks, ads |
| **Metadata** | Query, Google domain, `gl`, `hl`, `uule`, `num`, `pws`, device, timestamp, counts |
| **Raw HTML** | A trimmed snapshot of the results column, so a future parser can re-read this capture |

**AI Overview citations are the point** for GEO work. "Which domains does Google
quote when answering this" is not available from any keyword tool, and it
exports as its own CSV.

---

## Exports

**Export all** writes five files:

```
serps-YYYY-MM-DD.json            everything, raw HTML omitted
organic_results-YYYY-MM-DD.csv   one row per result
paa-YYYY-MM-DD.csv               one row per question
ai_citations-YYYY-MM-DD.csv      one row per cited source
serp_features-YYYY-MM-DD.csv     one row per SERP
```

Separate files on purpose. One CSV mixing organic rows and PAA rows means every
consumer must filter by a type column before it can do arithmetic — and the
first person to open it in a spreadsheet averages across both without noticing.

Examples of each are in `examples/`.

---

## Architecture

```
src/
  parser/        pure functions: DOM in, data out. No chrome.* here.
    selectors.ts   EVERY Google selector, in one file
    organic.ts     result extraction and the validation that defines "organic"
    paa.ts         People Also Ask, plus the optional expand pass
    aiOverview.ts  AI Overview text and citations
    serpFeatures.ts feature detection, featured snippet
    relatedSearches.ts
    metadata.ts    query and location parameters from the URL
    utils.ts       selector fallbacks, URL cleaning, de-duplication
    index.ts       orchestrator; wraps every sub-parser so one failure is local
  content/       runs on the SERP: reads the page, mounts the floating button
  background/    service worker — the ONLY thing that touches storage
  storage/       IndexedDB, and the export builders
  popup/ history/ UI
```

Three decisions worth knowing:

**Storage lives in the service worker.** A content script runs in `google.com`'s
origin, so its IndexedDB would belong to Google — captures would scatter across
whichever Google domain was open and vanish when site data is cleared. The
content script parses and hands the record over; the worker stores it.

**Every selector is in `selectors.ts`.** Google reshuffles class names without
notice. When extraction breaks, that is the only file to edit.

**Every sub-parser is wrapped.** A feature Google restyled should cost that
feature and nothing else. A thrown selector must not lose twenty organic results
that parsed correctly a millisecond earlier — failures land in
`diagnostics.warnings` and the rest of the capture survives.

---

## What counts as an organic result

Grabbing every `<a>` produces a few hundred links, most of them navigation,
filters, ads, PAA sources and carousel items. The positions that come out of
that are fiction, and fiction is worse than a short list — a rank you cannot
trust is one you re-check by hand, which is the job this tool exists to remove.

The pipeline: candidate blocks → a link with a heading → reject sponsored →
reject anything inside a non-organic container → de-duplicate by canonical URL →
**only then** assign positions 1..n.

If 17 results survive, you get 17. Nothing is padded.

---

## Diagnostics

Every capture records what the parser saw, and the popup shows it after a
collect:

```
Containers detected: 31
Valid organic results: 23
PAA detected: 4
AI Overview: detected
Local pack: not detected
Parser: 1.0.0  (46ms)

Rejected:
  5 × sponsored
  2 × duplicate url
  1 × inside a non-organic container
```

This is the difference between *"this SERP had 17 results"* and *"Google changed
something"*. If `Containers detected` is healthy but `Valid organic` is zero,
the selectors still match but the validation is rejecting everything. If both
are zero, `selectors.ts` needs updating.

---

## Tests

```bash
npm test        # builds the parser bundle, then runs node --test
npm run typecheck
```

19 tests covering position assignment after filtering, ad and PAA exclusion, the
25 cap, de-duplication, missing snippets, sitelinks, AI Overview citations,
local pack, empty pages, metadata, and CSV quoting.

**What the tests prove, and what they do not.** The fixtures are synthetic,
written from `selectors.ts`. They are not captured from Google, because fetching
a SERP programmatically is the automated searching this project refuses to do,
and a stale copy of Google's markup would be worse than none.

So they prove the *logic* — that an ad never takes an organic position, that
duplicates collapse, that a missing feature does not throw. They do **not**
prove the selectors match today's Google. Only a real capture shows that, which
is what diagnostics are for.

One test found a real bug: ads live in `#tads`, a sibling *above* `#search`, so
scanning from `#rso` never saw them. Organic stayed correct by accident while
the ad list came back empty on a page full of ads.

**When you have a real capture, keep it.** Save its `rawHtml` into
`test/fixtures/` and point a test at it. That is the fixture worth having, and
it can only come from a page a person opened.

---

## Known limitations

- **Selectors will break.** Google ships layout changes constantly. Diagnostics
  tell you when; `selectors.ts` is where you fix it.
- **AI Overview must be visible.** If it is still streaming or collapsed behind
  "Show more", you get what is rendered. Nothing is guessed at.
- **PAA answers are lazy.** Google ships questions and fetches answers on click.
  Without "Expand PAA" you get questions with `expanded: false` — which says the
  answer was never rendered, not that it was empty.
- **`num=20` is a request, not a promise.** Google frequently returns fewer.
- **Position is what was rendered for you**, at your location, at that moment.
  It is a capture, not a rank tracker.
- **Country coverage.** The manifest lists ~27 Google domains. For others, add
  the match pattern to `manifest.json` and rebuild.
- **Infinite scroll / "More results"** is not followed. What is loaded is what
  is read.

---

## What this deliberately does not do

No CAPTCHA solving, no proxy or IP rotation, no fingerprint spoofing, no
automated searching, no Google account interaction, no stealth scraping, no URL
generation.

It reads a page you opened, when you press a button. That is the entire scope,
and the architecture has no seam where any of the above could be added quietly.

---

## Later

The data model is additive and the parser is modular, so these fit without a
rewrite: Bing SERPs (a sibling of `parser/`), keyword queues, rank tracking over
repeat captures, domain frequency across a corpus, SERP similarity clustering,
and AI Overview citation analysis — which the `ai_citations.csv` export is
already shaped for.
