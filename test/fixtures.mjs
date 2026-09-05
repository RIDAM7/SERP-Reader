/**
 * Synthetic Google SERP markup.
 *
 * ## Read this before trusting a passing test
 *
 * These fixtures are written from the selectors in src/parser/selectors.ts.
 * They are NOT captured from Google, because fetching a real SERP
 * programmatically is exactly the automated searching this project refuses to
 * do — and a stale copy of Google's markup would be a worse lie than none.
 *
 * So what the tests prove is narrow and worth stating plainly:
 *
 *   They DO prove the parser's logic — that ads and PAA never become organic
 *   positions, that duplicates collapse, that positions are assigned after
 *   filtering, that a missing feature does not throw.
 *
 *   They do NOT prove the selectors match today's Google. Only a real capture
 *   can show that, which is what the diagnostics panel is for.
 *
 * When a real capture is saved, drop its rawHtml into fixtures/ and point a
 * test at it. That is the fixture worth having, and it can only come from a
 * page a person opened.
 */

/**
 * `redirect: true` reproduces what Google actually serves today: the href is
 * /goto?url=<signed blob> and the destination appears nowhere in the DOM, so
 * the domain has to come from the cite breadcrumb. That shape returned zero
 * results from the first real capture, which is why it is a fixture now.
 */
const organicBlock = ({ title, url, displayed, snippet, sitelinks = [], redirect = false }) => `
  <div class="MjjYud">
    <div class="wHYlTd Ww4FFb tF2Cxc">
      <div class="yuRUbf">
        <a class="zReHs" jsname="UWckNb" href="${
          redirect ? '/goto?url=CAESpAEB' + Buffer.from(url).toString('base64').replace(/=+$/, '') : url
        }"><h3>${title}</h3></a>
        <div class="byrV5b"><cite>${displayed ?? url}</cite></div>
      </div>
      ${snippet === null ? '' : `<div class="VwiC3b">${snippet ?? 'A snippet about the result.'}</div>`}
      ${
        sitelinks.length
          ? `<div class="usJj9c">${sitelinks.map((s) => `<a href="${s.url}">${s.title}</a>`).join('')}</div>`
          : ''
      }
    </div>
  </div>`;

/*
 * An ad, in the shape Google actually ships it.
 *
 * Every detail here was wrong in the previous version of this fixture, and each
 * wrong detail hid a real bug:
 *
 *   - The block IS the [data-text-ad] element; the marker is not a descendant.
 *   - The heading is div[role=heading][aria-level=3], not an <h3>.
 *   - There is no <cite>. The displayed URL lives in a span[role="text"].
 *   - The href is a /goto redirect whose destination is not in the DOM.
 *
 * The old fixture used an <h3> inside an <a>, a "Sponsored" span and a real
 * href, so the ad tests passed against a page Google does not serve.
 */
const adBlock = ({ title, url }) => `
    <div data-text-ad="1" data-hveid="CAEQAA" data-ta-slot="0">
      <div role="heading" aria-level="3"><span>${title}</span></div>
      <span role="text">${new URL(url).origin}</span>
      <a href="/goto?url=CAESVAHrOzAVoGmlDlrOoGgdTNUNDCMZhKHu${encodeURIComponent(title).slice(0, 8)}">${title}</a>
      <div class="VwiC3b">An advert, which must never take an organic position.</div>
    </div>`;

const paaBlock = (items) => `
  <div jscontroller="ogmBcd">
    ${items
      .map(
        (i) => `
      <div jsname="Cpkphb" data-q="${i.q}">
        <div role="heading">${i.q}</div>
        ${i.a ? `<div class="wDYxhc">${i.a}</div>` : ''}
        ${i.src ? `<div class="yuRUbf"><a href="${i.src}">source</a></div>` : ''}
      </div>`,
      )
      .join('')}
  </div>`;

const aiOverviewBlock = (sources) => `
  <div data-subtree="aio">
    <h2>AI Overview</h2>
    <div class="WaaZC">
      <p>Generative engine optimization is the practice of making a site legible to AI answer engines.</p>
      <ul><li>Structured data helps</li><li>Citations matter more than rankings</li></ul>
    </div>
    ${sources.map((s) => `<a href="${s}">${new URL(s).hostname}</a>`).join('')}
  </div>`;

const relatedBlock = (terms) => `
  <div id="botstuff">
    <div class="oIk2Cb">
      ${terms.map((t) => `<a href="/search?q=${encodeURIComponent(t)}">${t}</a>`).join('')}
    </div>
  </div>`;

export function serpHtml({
  organic = [],
  ads = [],
  paa = [],
  aiSources = null,
  related = [],
  knowledgePanel = false,
  localPack = false,
} = {}) {
  return `<!doctype html><html lang="en"><head><title>test</title></head><body>
    <div id="rcnt">
    ${ads.length ? `<div id="tads" role="region" aria-label="Ads">${ads.map(adBlock).join('')}</div>` : ''}
    <div id="center_col">
      ${aiSources ? aiOverviewBlock(aiSources) : ''}
      <div id="search"><div id="rso">
        ${paa.length ? paaBlock(paa) : ''}
        ${localPack ? '<div data-rc_ludocids="123"><div class="rllt__details"><a href="https://maps.google.com/x">A local business</a></div></div>' : ''}
        ${organic.map(organicBlock).join('')}
      </div></div>
      ${related.length ? relatedBlock(related) : ''}
    </div>
    ${knowledgePanel ? '<div id="rhs"><div class="kp-wholepage"><h2>A Company</h2><a href="https://kp.example.com/">site</a></div></div>' : ''}
    </div></body></html>`;
}

/** n plausible organic results, each on its own domain. */
export const manyResults = (n, prefix = 'result') =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${i + 1}`,
    url: `https://site${i + 1}.example.com/page`,
    displayed: `site${i + 1}.example.com › page`,
    snippet: `Snippet for ${prefix} ${i + 1}.`,
  }));
