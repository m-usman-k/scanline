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
- **Toolbar badge** with the score, and the `Alt+Shift+S` shortcut.

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
2. Click **Load unpacked** and select the **`src`** folder of this repository.
3. Pages that were already open before installing need a reload so their headers can be captured. The popup offers a **Reload page & rescan** button for this.

To scan local `file://` pages, enable **Allow access to file URLs** on the extension's details page.

## Development

There is no build step and there are no runtime dependencies. Node 20+ is only needed for the tooling.

```sh
npm test          # unit tests (node:test) for detection, audit rules, scoring, CSP/cookie parsing, exports
npm run check     # manifest sanity, referenced files, syntax, unused imports
npm run package   # dist/scanline-<version>.zip built from src/, ready for the Web Store
```

### Project layout

```
scanline/
├── src/                         The extension (load this folder unpacked; it is what ships)
│   ├── manifest.json
│   ├── background.js            Service worker: records each tab's main-document response (headers, IP, redirects)
│   ├── content/collector.js     Injected on demand (isolated world): measures the page, returns plain JSON,
│   │                            remembers flagged elements so they can be highlighted later
│   ├── lib/                     Shared logic (ES modules)
│   │   ├── scan.js              Orchestrates a scan: inject → probe → headers → detect → audit → score
│   │   ├── probe.js             Injected into the page's main world: reads globals and framework fingerprints
│   │   ├── signatures.js        Technology signature database   · detect.js   signature matcher
│   │   ├── audit.js             All checks (pure functions)      · score.js    weighted scoring
│   │   ├── headers.js           CSP / HSTS / Set-Cookie analysis · vulns.js    CVE and end-of-life data
│   │   ├── secrets.js           Credential patterns              · trackers.js third-party domain map
│   │   ├── deep.js              Optional site-file checks        · kb.js       "why / how to fix" text
│   │   └── store.js, compare.js, export.js, ui.js, icons.js, util.js
│   ├── pages/popup/             Toolbar popup (html, css, js)
│   ├── pages/report/            Full report tab (html, css, js)
│   ├── styles/ui.css            Design tokens (light/dark) and shared components
│   └── icons/                   Toolbar and store icons (16, 32, 48, 128)
├── assets/                      Brand sources: logo and icon SVG/PNG
├── tests/                       Unit tests (node:test) and fixtures
├── scripts/                     check.mjs (static checks), package.mjs (store ZIP)
└── package.json                 Dev tooling only; the extension has no dependencies
```

The collector only **measures**, and `src/lib/audit.js` **judges**. Thresholds and rules are pure functions, so they are covered by unit tests with recorded facts (`tests/fixtures/facts.js`).

### Adding a technology

Add an entry to `TECHNOLOGIES` in `src/lib/signatures.js`. Rule types are documented at the top of the file: global paths (`probe`), URL patterns (`url`), `meta`, `dom` selectors, response `headers`, `cookies`, CSS variables, `host`, HTML `comment`s and `implies`. A capture group or a version-like global value becomes the detected version. Run `npm test` afterwards; the tests validate the database.

### Adding a vulnerability

Add an advisory to `ADVISORIES` (or `END_OF_LIFE`) in `src/lib/vulns.js` with the affected version ranges. The vulnerability data is a curated offline snapshot, not an exhaustive feed.
