# Scanline

**A Chrome extension that audits any website in about a second: security, performance, SEO, accessibility, privacy and tech stack. Everything runs locally in your browser.**

Open the popup on any page and Scanline scores it out of 100, lists the issues that matter most, explains why each one matters and how to fix it, and can highlight the offending elements on the page.

## Features

| Area | What Scanline checks |
|---|---|
| **Security** | HTTPS, HSTS, mixed content, a real CSP evaluation (`unsafe-inline`, wildcards, CDN bypasses, `object-src`, `base-uri`), clickjacking, `nosniff`, Referrer/Permissions/COOP policies, version-leaking headers, cookie flags (`Secure`, `HttpOnly`, `SameSite`) from `Set-Cookie`, auth tokens in Web Storage, password forms over HTTP or GET, Subresource Integrity, known-malicious script hosts (polyfill.io), **leaked secrets** (AWS, Stripe, GitHub, OpenAI, Anthropic, Slack, Supabase `service_role` and more), debug builds, **libraries with known CVEs**, end-of-life software |
| **Performance** | Core Web Vitals from this page load (LCP, CLS, INP), FCP, TTFB with a server-timing breakdown, main-thread blocking with the scripts responsible (Long Animation Frames), render-blocking resources, a lazy-loaded LCP image, page weight by type, compression, HTTP/2 and HTTP/3, failed requests, third-party cost, JS/CSS size, images (dimensions, lazy loading, oversizing, WebP/AVIF), fonts, DOM size |
| **SEO** | HTTP status, title and description (with a Google-style preview), headings, indexability (meta robots and `X-Robots-Tag`), canonical, hreflang, viewport, charset, doctype, favicon, URL hygiene, Open Graph and X cards (with a social preview), structured data, links |
| **Accessibility** | Alt text, **color contrast (WCAG AA)**, zoom blocking, form labels, button and link names, focusable content inside `aria-hidden`, tab order, `lang`, title, heading order, landmarks, skip links, duplicate IDs, invalid ARIA, frame titles, autoplay |
| **Privacy** | Trackers and tracking domains, session-replay tools, fingerprinting, consent managers, third-party domains (with company and purpose), privacy-unfriendly embeds, Google Fonts, cookies and storage |
| **Tech stack** | ~470 technologies with versions and evidence: frameworks, CMSs, e-commerce, servers, hosting, CDNs, analytics, ads, consent, payments, WordPress plugins and more. Also the fonts and color palette used on the page |

It also includes:

- **Highlight on page**: outlines the images without alt text, low-contrast text, layout-shifting elements and so on, directly on the page.
- **Full report** in a tab, with export to Markdown, JSON, standalone HTML and Print/PDF.
- **History and comparison**: see what improved or regressed since the last scan of the same URL.
- **Toolbar badge** with the score, a light and dark theme, and the `Alt+Shift+S` shortcut.

## Privacy: what touches the network

Nearly everything works with **no network access at all**:

- Page analysis reads the DOM, the browser's Performance API and globals in the scanned tab.
- Response headers are recorded passively by the service worker while the page loads (`chrome.webRequest`, read-only). Nothing is re-fetched.
- Technology, tracker, vulnerability and secret databases are bundled with the extension.
- Results, history and settings stay in `chrome.storage` on your machine. Captured headers are kept in memory only.

Two features touch the network, and only when you click them:

1. **Deep scan** fetches `robots.txt`, the sitemap, `security.txt`, `llms.txt` and the site's own JavaScript bundles (from the HTTP cache when possible) **from the scanned site only**.
2. **Load image preview** in the social-card preview loads the page's `og:image`.

Scanline has no backend, no analytics and no remote code.

## Install (development)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pages that were already open before installing need a reload so their headers can be captured. The popup offers a **Reload page & rescan** button for this.

To scan local `file://` pages, enable **Allow access to file URLs** on the extension's details page.

## Development

There is no build step and there are no runtime dependencies. Node 20+ is only needed for the tooling.

```sh
npm test          # unit tests (node:test) for detection, audit rules, scoring, CSP/cookie parsing, exports
npm run check     # manifest sanity, referenced files, syntax, unused imports
npm run package   # dist/scanline-<version>.zip with only the runtime files, ready for the Web Store
```

### Architecture

```
manifest.json            MV3 manifest
background.js            Service worker: records each tab's main-document response (headers, IP, redirects)
content/collector.js     Injected on demand into the tab (isolated world): measures the page, returns plain JSON,
                         and remembers flagged elements so they can be highlighted later
lib/probe.js             Injected into the page's main world: reads globals and framework fingerprints
lib/scan.js              Orchestrates a scan from the popup/report: inject → probe → headers → detect → audit → score
lib/signatures.js        Technology signature database        lib/detect.js    signature matcher
lib/audit.js             All checks (pure functions)           lib/score.js     weighted scoring
lib/headers.js           CSP / HSTS / Set-Cookie analysis      lib/vulns.js     CVE and end-of-life data
lib/secrets.js           Credential patterns                   lib/trackers.js  third-party domain map
lib/deep.js              Optional site-file checks             lib/kb.js        "why it matters / how to fix" text
lib/store.js, compare.js, export.js, ui.js, icons.js, util.js
popup.*, report.*, ui.css  User interface (shared components in lib/ui.js and ui.css)
```

The collector only **measures**, and `lib/audit.js` **judges**. Thresholds and rules are pure functions, so they are covered by unit tests with recorded facts (`tests/fixtures/facts.js`).

### Adding a technology

Add an entry to `TECHNOLOGIES` in `lib/signatures.js`. Rule types are documented at the top of the file: global paths (`probe`), URL patterns (`url`), `meta`, `dom` selectors, response `headers`, `cookies`, CSS variables, `host`, HTML `comment`s and `implies`. A capture group or a version-like global value becomes the detected version. Run `npm test` afterwards; the tests validate the database.

### Adding a vulnerability

Add an advisory to `ADVISORIES` (or `END_OF_LIFE`) in `lib/vulns.js` with the affected version ranges. The vulnerability data is a curated offline snapshot, not an exhaustive feed.
