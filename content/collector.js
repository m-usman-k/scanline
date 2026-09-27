// Scanline page collector.
//
// Injected on demand (chrome.scripting.executeScript) into the extension's ISOLATED world of the
// tab being scanned. It only measures the page and returns plain JSON "facts"; all judgement
// (thresholds, scores, advice) lives in lib/audit.js so it can be unit tested.
//
// It also remembers the elements behind each finding so the popup can highlight them later.

(() => {
  'use strict';

  const previous = globalThis.__scanline;
  if (previous && typeof previous.clearHighlight === 'function') {
    try {
      previous.clearHighlight();
    } catch (e) { /* ignore */ }
  }

  const SAMPLE_LIMIT = 12;
  const flagged = new Map();

  // ------------------------------------------------------------------ helpers

  const clean = (s, max = 120) => {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
  const absUrl = (u) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch (e) {
      return null;
    }
  };
  const hostOf = (u) => {
    try {
      return new URL(u).hostname;
    } catch (e) {
      return '';
    }
  };
  const round = (n, digits = 0) => (Number.isFinite(n) ? Number(n.toFixed(digits)) : null);
  const qsa = (sel, root = document) => {
    try {
      return Array.from(root.querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  };

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true });
    }
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  function describe(el) {
    if (!el || !el.tagName) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += `.${cls.join('.')}`;
    s = clean(s, 60);
    const src = el.currentSrc || el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data') || '';
    if (src && !/^(data|javascript|blob):/i.test(src)) {
      const file = src.split(/[?#]/)[0].split('/').filter(Boolean).pop() || src;
      s += ` ${clean(file, 40)}`;
    }
    const label = clean(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.childElementCount < 20 ? el.textContent : ''), 40);
    if (label) s += ` “${label}”`;
    return s;
  }

  function flag(key, els, fmt = describe) {
    flagged.set(key, els);
    return { count: els.length, samples: els.slice(0, SAMPLE_LIMIT).map((el, i) => fmt(el, i)), key: els.length ? key : null };
  }

  // Approximate accessible name (a pragmatic subset of the accname spec).
  function contentText(root) {
    let s = '';
    const walk = (node, depth) => {
      if (depth > 12) return;
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          s += c.nodeValue;
        } else if (c.nodeType === 1) {
          if (c.getAttribute('aria-hidden') === 'true' || c.hidden) continue;
          const tag = c.localName;
          const aria = c.getAttribute('aria-label');
          if (aria && aria.trim()) s += ` ${aria}`;
          else if (tag === 'img' || (tag === 'input' && c.type === 'image') || tag === 'area') s += ` ${c.getAttribute('alt') || ''}`;
          else if (tag === 'svg') {
            const t = c.querySelector('title');
            s += ` ${t ? t.textContent : ''}`;
          } else if (tag !== 'script' && tag !== 'style' && tag !== 'template') walk(c, depth + 1);
        }
      }
    };
    walk(root, 0);
    return s.replace(/\s+/g, ' ').trim();
  }

  function labelledBy(el) {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => {
      const ref = document.getElementById(id);
      return ref ? contentText(ref) || ref.getAttribute('aria-label') || '' : '';
    }).join(' ').trim();
  }

  function accessibleName(el, { allowPlaceholder = true } = {}) {
    const byRef = labelledBy(el);
    if (byRef) return byRef;
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const tag = el.localName;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && (type === 'submit' || type === 'reset')) return el.value || type;
      if (tag === 'input' && type === 'button') return (el.value || '').trim();
      if (tag === 'input' && type === 'image') return (el.getAttribute('alt') || el.value || '').trim();
      if (el.labels && el.labels.length) {
        const t = Array.from(el.labels).map((l) => contentText(l)).join(' ').trim();
        if (t) return t;
      }
      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim();
      if (allowPlaceholder) {
        const ph = el.getAttribute('placeholder');
        if (ph && ph.trim()) return ph.trim();
      }
      return '';
    }
    const text = contentText(el);
    if (text) return text;
    const title = el.getAttribute('title');
    return title && title.trim() ? title.trim() : '';
  }

  // ------------------------------------------------------------------ colours

  let colorCtx = null;
  const colorCache = new Map();
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };

  function parseColor(str) {
    if (!str) return null;
    if (colorCache.has(str)) return colorCache.get(str);
    let res = null;
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      res = { r: +m[1], g: +m[2], b: +m[3], a };
    } else if (str === 'transparent') {
      res = { r: 0, g: 0, b: 0, a: 0 };
    } else {
      // Modern colour spaces (oklch, lab, color()) — let the canvas convert them to sRGB.
      try {
        if (!colorCtx) {
          const c = document.createElement('canvas');
          c.width = 1;
          c.height = 1;
          colorCtx = c.getContext('2d', { willReadFrequently: true });
        }
        colorCtx.clearRect(0, 0, 1, 1);
        colorCtx.fillStyle = '#000';
        colorCtx.fillStyle = str;
        colorCtx.fillRect(0, 0, 1, 1);
        const px = colorCtx.getImageData(0, 0, 1, 1).data;
        res = { r: px[0], g: px[1], b: px[2], a: px[3] / 255 };
      } catch (e) {
        res = null;
      }
    }
    colorCache.set(str, res);
    return res;
  }

  function blend(fg, bg) {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    const ch = (f, b) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
    return { r: ch(fg.r, bg.r), g: ch(fg.g, bg.g), b: ch(fg.b, bg.b), a };
  }

  function luminance(c) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrastRatio(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  const toHex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

  const REPLACED = new Set(['img', 'video', 'canvas', 'picture', 'iframe', 'svg', 'object', 'embed']);
  const bgCache = new Map();

  // Background from the ancestor chain; null when an image or gradient makes it unknowable.
  function ancestorBackground(el) {
    if (!el || el.nodeType !== 1) return WHITE;
    if (bgCache.has(el)) return bgCache.get(el);
    const cs = getComputedStyle(el);
    let res;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      res = null;
    } else {
      const own = parseColor(cs.backgroundColor);
      if (own && own.a >= 0.99) res = own;
      else {
        const parent = ancestorBackground(el.parentElement);
        res = parent === null ? null : own && own.a > 0 ? blend(own, parent) : parent;
      }
    }
    bgCache.set(el, res);
    return res;
  }

  // Background from what is actually painted under the element (only works on-screen).
  function paintedBackground(el, rect) {
    const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 12), 0), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
    const stack = document.elementsFromPoint(x, y);
    const idx = stack.indexOf(el);
    if (idx < 0) return undefined;
    const layers = [];
    for (let i = idx; i < stack.length; i++) {
      const node = stack[i];
      if (i > idx && REPLACED.has(node.localName)) return null;
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.99) break;
      }
    }
    let bg = WHITE;
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  }

  // ------------------------------------------------------------------ page

  function pageInfo() {
    return {
      url: location.href,
      origin: location.origin,
      host: location.hostname,
      protocol: location.protocol,
      title: document.title,
      readyState: document.readyState,
      viewport: { w: innerWidth, h: innerHeight },
      dpr: devicePixelRatio || 1,
      scrollHeight: document.documentElement.scrollHeight,
      inIframe: window.top !== window,
    };
  }

  // ------------------------------------------------------------------ signals (stack detection)

  function collectSignals(opts) {
    const scripts = Array.from(document.scripts).map((s) => s.src).filter(Boolean).slice(0, 400);
    const styles = qsa('link[rel~="stylesheet" i][href]').map((l) => l.href).slice(0, 200);

    const meta = {};
    for (const m of qsa('meta')) {
      const key = (m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '').toLowerCase().trim();
      const content = m.getAttribute('content');
      if (!key || content == null) continue;
      (meta[key] = meta[key] || []).push(clean(content, 300));
    }

    const selectors = [];
    for (const sel of opts.selectors || []) {
      try {
        if (document.querySelector(sel)) selectors.push(sel);
      } catch (e) { /* invalid selector */ }
    }

    const cssVars = {};
    try {
      const rootCs = getComputedStyle(document.documentElement);
      const bodyCs = document.body ? getComputedStyle(document.body) : null;
      for (const name of opts.cssVars || []) {
        const v = (rootCs.getPropertyValue(name) || (bodyCs && bodyCs.getPropertyValue(name)) || '').trim();
        if (v) cssVars[name] = clean(v, 60);
      }
    } catch (e) { /* ignore */ }

    const comments = [];
    try {
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
      while (walker.nextNode() && comments.length < 150) {
        const t = clean(walker.currentNode.nodeValue, 400);
        if (t) comments.push(t);
      }
    } catch (e) { /* ignore */ }

    // Tag IDs (GA4, UA, GTM, Google Ads) from inline scripts and URLs.
    const idSources = [inlineScriptText(400000), ...scripts, ...performance.getEntriesByType('resource').slice(0, 600).map((e) => e.name)].join('\n');
    const grab = (re) => Array.from(new Set(Array.from(idSources.matchAll(re), (m) => m[1]))).slice(0, 10);
    const ids = {
      ga4: grab(/(?:['"]config['"]\s*,\s*['"]|[?&](?:id|tid)=)(G-[A-Z0-9]{6,12})\b/g),
      ua: grab(/(?:['"]|[?&]tid=)(UA-\d{4,10}-\d{1,4})\b/g),
      gtm: grab(/\b(GTM-[A-Z0-9]{4,10})\b/g),
      aw: grab(/(?:['"]|[?&]id=)(AW-\d{6,12})\b/g),
    };

    return {
      scripts,
      styles,
      meta,
      selectors,
      cssVars,
      cookies: cookieNames(),
      comments,
      ids,
      tailwind: tailwindHeuristic(),
      serviceWorker: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    };
  }

  let inlineTextCache = null;
  function inlineScriptText(max = 3000000) {
    if (inlineTextCache === null) {
      let total = '';
      for (const s of document.scripts) {
        if (s.src) continue;
        total += `${s.textContent}\n`;
        if (total.length > 3000000) break;
      }
      inlineTextCache = total;
    }
    return inlineTextCache.length > max ? inlineTextCache.slice(0, max) : inlineTextCache;
  }

  function cookieNames() {
    try {
      return document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean).slice(0, 200);
    } catch (e) {
      return [];
    }
  }

  function tailwindHeuristic() {
    const variant = /(?:^|\s)(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|dark|group-hover|peer-[\w-]+):[\w[\]/.#%-]+/;
    const util = /(?:^|\s)(?:items-(?:center|start|end|baseline|stretch)|justify-(?:between|around|evenly|center|start|end)|(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)|text-(?:xs|sm|base|lg|[2-9]?xl)|font-(?:thin|light|normal|medium|semibold|bold|extrabold)|[wh]-(?:full|screen)|flex-col|space-[xy]-\d|min-h-screen|tracking-(?:tight|wide|wider)|leading-(?:tight|snug|relaxed|loose))(?=\s|$)/;
    let variants = 0;
    let utils = 0;
    const els = document.querySelectorAll('[class]');
    const limit = Math.min(els.length, 3000);
    for (let i = 0; i < limit; i++) {
      const c = els[i].getAttribute('class');
      if (!c) continue;
      if (variant.test(c)) variants++;
      if (util.test(c)) utils++;
    }
    return utils >= 12 || (variants >= 3 && utils >= 4);
  }

  // ------------------------------------------------------------------ SEO

  function headingOutline() {
    const outline = [];
    const skips = [];
    const empty = [];
    let prev = 0;
    for (const h of qsa('h1, h2, h3, h4, h5, h6')) {
      const level = Number(h.localName[1]);
      const text = clean(contentText(h), 90);
      if (outline.length < 250) outline.push({ l: level, t: text, hidden: !isVisible(h) });
      if (!text) empty.push(h);
      if (prev && level > prev + 1) skips.push(h);
      prev = level;
    }
    return {
      outline,
      skips: flag('seo.headingSkips', skips, (el) => `${el.localName} “${clean(contentText(el), 50)}”`),
      empty: flag('a11y.emptyHeadings', empty),
    };
  }

  function collectSeo() {
    const metaContent = (sel) => {
      const el = document.querySelector(sel);
      return el ? clean(el.getAttribute('content') || '', 500) : null;
    };

    const h1s = qsa('h1');
    const canonicals = qsa('link[rel~="canonical" i]');
    const robots = qsa('meta[name="robots" i], meta[name="googlebot" i]').map((m) => clean(m.getAttribute('content') || '', 120));

    const og = {};
    for (const k of ['title', 'description', 'image', 'url', 'type', 'site_name', 'locale']) og[k] = metaContent(`meta[property="og:${k}"]`);
    const twitter = {};
    for (const k of ['card', 'title', 'description', 'image', 'site']) twitter[k] = metaContent(`meta[name="twitter:${k}"], meta[property="twitter:${k}"]`);
    if (og.image) og.image = absUrl(og.image);
    if (twitter.image) twitter.image = absUrl(twitter.image);

    const types = new Set();
    const jsonErrors = [];
    const ldScripts = qsa('script[type="application/ld+json" i]');
    for (const s of ldScripts) {
      try {
        const visit = (o, depth) => {
          if (!o || depth > 4) return;
          if (Array.isArray(o)) return o.forEach((x) => visit(x, depth + 1));
          if (typeof o === 'object') {
            const t = o['@type'];
            if (t) (Array.isArray(t) ? t : [t]).forEach((x) => types.add(clean(x, 60)));
            if (o['@graph']) visit(o['@graph'], depth + 1);
          }
        };
        visit(JSON.parse(s.textContent), 0);
      } catch (e) {
        jsonErrors.push(clean(e.message, 100));
      }
    }

    const hreflang = qsa('link[rel~="alternate" i][hreflang]').slice(0, 100).map((l) => ({ lang: l.getAttribute('hreflang'), href: l.href }));

    const baseHost = location.hostname.replace(/^www\./, '');
    let internal = 0;
    let external = 0;
    let nofollow = 0;
    let jsHref = 0;
    const anchors = qsa('a[href]');
    for (const a of anchors) {
      const raw = a.getAttribute('href') || '';
      if (/^javascript:/i.test(raw)) {
        jsHref++;
        continue;
      }
      if (/^(mailto|tel|sms):/i.test(raw) || raw.startsWith('#')) continue;
      const h = hostOf(a.href).replace(/^www\./, '');
      if (!h || h === baseHost || h.endsWith(`.${baseHost}`)) internal++;
      else external++;
      if (/\bnofollow\b/i.test(a.rel)) nofollow++;
    }

    let words = 0;
    try {
      words = (document.body ? document.body.innerText : '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    } catch (e) { /* ignore */ }

    const favicon = qsa('link[rel~="icon" i], link[rel="shortcut icon" i]');
    const refresh = document.querySelector('meta[http-equiv="refresh" i]');

    return {
      title: document.title,
      titleCount: document.head ? document.head.querySelectorAll('title').length : 0,
      description: metaContent('meta[name="description" i]'),
      descriptionCount: qsa('meta[name="description" i]').length,
      h1: { count: h1s.length, texts: h1s.slice(0, 5).map((h) => clean(contentText(h), 90)), flag: flag('seo.h1', h1s) },
      headings: headingOutline(),
      canonical: { count: canonicals.length, href: canonicals[0] ? canonicals[0].href : null, raw: canonicals[0] ? canonicals[0].getAttribute('href') : null },
      robots,
      viewport: metaContent('meta[name="viewport" i]'),
      lang: document.documentElement.getAttribute('lang'),
      charset: document.characterSet,
      charsetDeclared: !!document.querySelector('meta[charset], meta[http-equiv="content-type" i]'),
      doctype: document.doctype ? document.doctype.name : null,
      quirksMode: document.compatMode === 'BackCompat',
      favicon: favicon.length > 0,
      appleTouchIcon: !!document.querySelector('link[rel~="apple-touch-icon" i]'),
      manifest: document.querySelector('link[rel="manifest" i]') ? document.querySelector('link[rel="manifest" i]').href : null,
      themeColor: metaContent('meta[name="theme-color" i]'),
      og,
      twitter,
      jsonld: { count: ldScripts.length, types: Array.from(types).slice(0, 30), errors: jsonErrors },
      microdata: qsa('[itemscope]').length,
      hreflang,
      links: { total: anchors.length, internal, external, nofollow, jsHref },
      words,
      metaRefresh: refresh ? clean(refresh.getAttribute('content') || '', 120) : null,
      amp: document.querySelector('link[rel="amphtml" i]') ? document.querySelector('link[rel="amphtml" i]').href : null,
      url: {
        href: location.href,
        length: location.href.length,
        pathHasUppercase: /[A-Z]/.test(location.pathname),
        pathHasUnderscore: location.pathname.includes('_'),
        params: Array.from(new URLSearchParams(location.search).keys()).length,
        depth: location.pathname.split('/').filter(Boolean).length,
      },
    };
  }

  // ------------------------------------------------------------------ accessibility + design

  const VALID_ROLES = new Set(('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox comment complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img image insertion link list listbox listitem log main mark marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript suggestion switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem graphics-document graphics-object graphics-symbol').split(' '));
  const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template', 'option', 'optgroup', 'title', 'textarea', 'select']);

  function analyzeText() {
    const candidates = [];
    const seen = new Set();
    if (document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeValue && n.nodeValue.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      });
      while (walker.nextNode() && candidates.length < 800) {
        const el = walker.currentNode.parentElement;
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (SKIP_TEXT.has(el.localName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        candidates.push(el);
      }
    }

    const failing = [];
    const ratios = new Map();
    const textColors = new Map();
    const bgColors = new Map();
    const families = new Map();
    let checked = 0;
    let skipped = 0;
    let hitTests = 0;

    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height < 16) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize) || 16;
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const textLen = Math.min(200, (el.textContent || '').trim().length);

      const family = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
      if (family) {
        const f = families.get(family) || { uses: 0, weights: new Set() };
        f.uses++;
        f.weights.add(weight);
        families.set(family, f);
      }

      let fg = parseColor(cs.color);
      const fill = cs.webkitTextFillColor ? parseColor(cs.webkitTextFillColor) : null;
      if (fill && fill.a === 0) fg = null; // gradient text (background-clip: text)
      if (!fg || fg.a === 0) {
        skipped++;
        continue;
      }
      if (el.closest('[disabled], [aria-disabled="true"]')) continue;

      let bg;
      const onScreen = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      if (onScreen && hitTests < 350) {
        hitTests++;
        bg = paintedBackground(el, rect);
      }
      if (bg === undefined) bg = ancestorBackground(el);
      if (!bg) {
        skipped++;
        continue;
      }
      const fgEff = fg.a < 1 ? blend(fg, bg) : fg;
      const ratio = contrastRatio(fgEff, bg);
      checked++;

      const fgHex = toHex(fgEff);
      const bgHex = toHex(bg);
      textColors.set(fgHex, (textColors.get(fgHex) || 0) + textLen);
      bgColors.set(bgHex, (bgColors.get(bgHex) || 0) + textLen);

      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const needed = large ? 3 : 4.5;
      if (ratio < needed) {
        failing.push(el);
        ratios.set(el, { ratio, fg: fgHex, bg: bgHex, needed });
      }
    }

    // Web fonts that actually loaded.
    const webfonts = new Set();
    try {
      document.fonts.forEach((face) => {
        if (face.status === 'loaded') webfonts.add(face.family.replace(/["']/g, '').trim());
      });
    } catch (e) { /* ignore */ }

    const topColors = (map, n) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([hex, weight]) => ({ hex, weight }));

    return {
      contrast: {
        checked,
        skipped,
        failing: flag('a11y.contrast', failing, (el) => {
          const r = ratios.get(el);
          return `${describe(el)} — ${r.ratio.toFixed(2)}:1 (${r.fg} on ${r.bg}, needs ${r.needed}:1)`;
        }),
        worst: failing.length ? Math.min(...failing.map((el) => ratios.get(el).ratio)) : null,
      },
      design: {
        fonts: Array.from(families.entries())
          .sort((a, b) => b[1].uses - a[1].uses)
          .slice(0, 8)
          .map(([family, f]) => ({ family, uses: f.uses, weights: Array.from(f.weights).sort((a, b) => a - b), webfont: webfonts.has(family) })),
        webfonts: Array.from(webfonts).slice(0, 20),
        textColors: topColors(textColors, 8),
        backgrounds: topColors(bgColors, 8),
      },
    };
  }

  function collectA11y() {
    const visibleOnly = (els) => els.filter((el) => isVisible(el) && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[aria-hidden="true"]'));

    const imgs = qsa('img');
    const imgNoAlt = visibleOnly(imgs).filter((img) => {
      if (img.hasAttribute('alt')) return false;
      const role = (img.getAttribute('role') || '').toLowerCase();
      if (role === 'presentation' || role === 'none') return false;
      return !accessibleName(img);
    });
    const otherNoAlt = visibleOnly(qsa('input[type="image" i], area[href], [role="img"]:not(img)')).filter((el) => !accessibleName(el) && !el.getAttribute('alt'));

    const fields = visibleOnly(qsa('input:not([type="hidden" i]):not([type="submit" i]):not([type="button" i]):not([type="reset" i]):not([type="image" i]), select, textarea'));
    const unlabeled = [];
    let placeholderOnly = 0;
    for (const f of fields) {
      if (accessibleName(f, { allowPlaceholder: false })) continue;
      if (accessibleName(f)) placeholderOnly++;
      else unlabeled.push(f);
    }

    const buttons = visibleOnly(qsa('button, [role="button"], input[type="submit" i], input[type="button" i], input[type="reset" i]'));
    const unnamedButtons = buttons.filter((b) => !accessibleName(b));

    const links = visibleOnly(qsa('a[href]'));
    const unnamedLinks = links.filter((a) => !accessibleName(a));

    const idCounts = new Map();
    for (const el of qsa('[id]').slice(0, 15000)) {
      const id = el.id;
      if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
    const dupIds = Array.from(idCounts.entries()).filter(([, n]) => n > 1);
    const dupEls = [];
    for (const [id] of dupIds.slice(0, 30)) {
      try {
        dupEls.push(...qsa(`[id="${CSS.escape(id)}"]`));
      } catch (e) { /* ignore */ }
    }

    const viewport = (document.querySelector('meta[name="viewport" i]') || {}).content || '';
    const maxScale = /maximum-scale\s*=\s*([\d.]+)/i.exec(viewport);
    const zoomBlocked = /user-scalable\s*=\s*(?:no|0)\b/i.test(viewport) || (maxScale && parseFloat(maxScale[1]) < 2);

    const positiveTabindex = qsa('[tabindex]').filter((el) => parseInt(el.getAttribute('tabindex'), 10) > 0);

    const iframes = visibleOnly(qsa('iframe')).filter((f) => !accessibleName(f) && !(f.getAttribute('title') || '').trim());

    const hiddenFocusable = qsa('[aria-hidden="true"]').filter((el) => {
      if (el.closest('[inert]')) return false;
      const self = el.matches(FOCUSABLE) ? [el] : [];
      return [...self, ...qsa(FOCUSABLE, el)].some((f) => f.getAttribute('tabindex') !== '-1' && isVisible(f));
    });

    const autoplay = [...qsa('video[autoplay]').filter((v) => !v.muted && !v.defaultMuted), ...qsa('audio[autoplay]')];

    const badRoles = qsa('[role]').filter((el) => {
      const tokens = (el.getAttribute('role') || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      return tokens.length > 0 && !tokens.some((t) => VALID_ROLES.has(t) || t.startsWith('doc-'));
    });
    const brokenRefs = qsa('[aria-labelledby], [aria-describedby]').filter((el) => {
      const ids = `${el.getAttribute('aria-labelledby') || ''} ${el.getAttribute('aria-describedby') || ''}`.split(/\s+/).filter(Boolean);
      return ids.some((id) => !document.getElementById(id));
    });

    const firstLinks = qsa('a[href^="#"]').slice(0, 8);
    const skipLink = firstLinks.some((a) => /skip|jump to|main content|zum inhalt|aller au contenu/i.test(a.textContent || a.getAttribute('aria-label') || ''));

    const text = analyzeText();

    return {
      images: { total: imgs.length, missingAlt: flag('a11y.imgAlt', [...imgNoAlt, ...otherNoAlt]) },
      fields: { total: fields.length, unlabeled: flag('a11y.labels', unlabeled), placeholderOnly },
      buttons: { total: buttons.length, unnamed: flag('a11y.buttons', unnamedButtons) },
      links: { total: links.length, unnamed: flag('a11y.links', unnamedLinks) },
      lang: document.documentElement.getAttribute('lang'),
      title: !!document.title.trim(),
      duplicateIds: { count: dupIds.length, ids: dupIds.slice(0, SAMPLE_LIMIT).map(([id, n]) => `#${clean(id, 50)} ×${n}`), flag: flag('a11y.dupIds', dupEls) },
      landmarks: {
        main: qsa('main, [role="main"]').length,
        nav: qsa('nav, [role="navigation"]').length,
        banner: qsa('header, [role="banner"]').length,
        contentinfo: qsa('footer, [role="contentinfo"]').length,
      },
      skipLink,
      viewport,
      zoomBlocked: !!zoomBlocked,
      positiveTabindex: flag('a11y.tabindex', positiveTabindex),
      iframesUntitled: flag('a11y.iframeTitle', iframes),
      hiddenFocusable: flag('a11y.ariaHiddenFocus', hiddenFocusable),
      autoplay: flag('a11y.autoplay', autoplay),
      badRoles: flag('a11y.roles', badRoles, (el) => `${describe(el)} role="${clean(el.getAttribute('role'), 30)}"`),
      brokenRefs: flag('a11y.ariaRefs', brokenRefs),
      contrast: text.contrast,
      design: text.design,
    };
  }

  // ------------------------------------------------------------------ performance

  function observe(type, extra, wait) {
    const supported = (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];
    if (!supported.includes(type)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const entries = [];
      let po;
      try {
        po = new PerformanceObserver((list) => entries.push(...list.getEntries()));
        po.observe(Object.assign({ type, buffered: true }, extra || {}));
      } catch (e) {
        resolve(null);
        return;
      }
      setTimeout(() => {
        try {
          entries.push(...po.takeRecords());
          po.disconnect();
        } catch (e) { /* ignore */ }
        resolve(entries);
      }, wait || 150);
    });
  }

  function computeCls(entries) {
    let max = 0;
    let cur = 0;
    let first = 0;
    let last = 0;
    const bySource = new Map();
    for (const e of entries) {
      if (e.hadRecentInput) continue;
      if (cur && e.startTime - last < 1000 && e.startTime - first < 5000) {
        cur += e.value;
        last = e.startTime;
      } else {
        cur = e.value;
        first = e.startTime;
        last = e.startTime;
      }
      if (cur > max) max = cur;
      for (const s of e.sources || []) {
        const node = s.node && (s.node.nodeType === 1 ? s.node : s.node.parentElement);
        if (node && node.isConnected) bySource.set(node, (bySource.get(node) || 0) + e.value);
      }
    }
    const sources = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
    return { value: round(max, 3), shifts: entries.filter((e) => !e.hadRecentInput).length, sources: flag('perf.clsSources', sources) };
  }

  async function collectPerf() {
    const nav = performance.getEntriesByType('navigation')[0];
    const activation = nav && nav.activationStart > 0 ? nav.activationStart : 0;
    const rel = (t) => (t > 0 ? round(Math.max(0, t - activation)) : null);

    const [lcpEntries, shifts, events, firstInput, loafs, longtasks] = await Promise.all([
      observe('largest-contentful-paint'),
      observe('layout-shift'),
      observe('event', { durationThreshold: 16 }),
      observe('first-input'),
      observe('long-animation-frame'),
      observe('longtask'),
    ]);

    const out = { supported: {} };

    if (nav) {
      out.nav = {
        type: nav.type,
        protocol: nav.nextHopProtocol || '',
        ttfb: rel(nav.responseStart),
        dns: round(nav.domainLookupEnd - nav.domainLookupStart),
        connect: round(nav.connectEnd - nav.connectStart),
        tls: nav.secureConnectionStart > 0 ? round(nav.connectEnd - nav.secureConnectionStart) : 0,
        wait: round(nav.responseStart - nav.requestStart),
        download: round(nav.responseEnd - nav.responseStart),
        redirect: round(nav.redirectEnd - nav.redirectStart),
        redirectCount: nav.redirectCount,
        domInteractive: rel(nav.domInteractive),
        dcl: rel(nav.domContentLoadedEventEnd),
        load: rel(nav.loadEventEnd),
        transferSize: nav.transferSize || 0,
        encodedBodySize: nav.encodedBodySize || 0,
        decodedBodySize: nav.decodedBodySize || 0,
        deliveryType: nav.deliveryType || '',
        prerendered: activation > 0,
        status: nav.responseStatus || 0,
        serverTiming: (nav.serverTiming || []).slice(0, 12).map((s) => ({ name: clean(s.name, 40), duration: round(s.duration, 1), description: clean(s.description, 80) })),
      };
    }

    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    out.fcp = fcp ? rel(fcp.startTime) || round(fcp.startTime) : null;

    out.supported.lcp = lcpEntries !== null;
    if (lcpEntries && lcpEntries.length) {
      const last = lcpEntries[lcpEntries.length - 1];
      const el = last.element && last.element.isConnected ? last.element : null;
      out.lcp = {
        time: rel(last.startTime) ?? round(last.startTime),
        size: last.size,
        url: last.url ? clean(last.url, 300) : '',
        element: el ? describe(el) : '',
        tag: el ? el.localName : '',
        lazy: !!(el && el.localName === 'img' && (el.getAttribute('loading') || '').toLowerCase() === 'lazy'),
        fetchPriority: el && el.getAttribute ? el.getAttribute('fetchpriority') || '' : '',
        flag: flag('perf.lcp', el ? [el] : []),
      };
    }

    out.supported.cls = shifts !== null;
    if (shifts) out.cls = computeCls(shifts);

    out.supported.inp = events !== null;
    if (events) {
      const byId = new Map();
      for (const e of events) {
        if (!e.interactionId) continue;
        byId.set(e.interactionId, Math.max(byId.get(e.interactionId) || 0, e.duration));
      }
      const durations = Array.from(byId.values()).sort((a, b) => b - a);
      const fi = firstInput && firstInput[0];
      if (durations.length) {
        out.inp = { value: round(durations[Math.min(Math.floor(durations.length / 50), durations.length - 1)]), interactions: durations.length };
      } else if (fi) {
        out.inp = { value: round(fi.duration), interactions: 1, fromFirstInput: true };
      }
    }

    const loadEnd = (nav && nav.loadEventEnd) || performance.now();
    if (loafs) {
      out.supported.blocking = 'loaf';
      const inLoad = loafs.filter((e) => e.startTime <= loadEnd + 1000);
      const byScript = new Map();
      for (const f of loafs) {
        for (const s of f.scripts || []) {
          const key = s.sourceURL || s.invoker || 'inline/unknown';
          byScript.set(key, (byScript.get(key) || 0) + (s.duration || 0));
        }
      }
      out.blocking = {
        total: round(inLoad.reduce((sum, e) => sum + (e.blockingDuration || 0), 0)),
        count: loafs.length,
        longest: round(loafs.reduce((m, e) => Math.max(m, e.duration), 0)),
        scripts: Array.from(byScript.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([src, ms]) => ({ src: clean(src, 200), ms: round(ms) })),
      };
    } else if (longtasks) {
      out.supported.blocking = 'longtask';
      const inLoad = longtasks.filter((e) => e.startTime <= loadEnd + 1000);
      out.blocking = {
        total: round(inLoad.reduce((sum, e) => sum + Math.max(0, e.duration - 50), 0)),
        count: longtasks.length,
        longest: round(longtasks.reduce((m, e) => Math.max(m, e.duration), 0)),
        scripts: [],
      };
    }

    const resEntries = performance.getEntriesByType('resource');
    out.resourcesBufferFull = resEntries.length >= 250;
    out.resourceCount = resEntries.length;
    out.resources = resEntries.slice(0, 800).map((e) => ({
      u: e.name.slice(0, 400),
      t: e.initiatorType,
      ts: e.transferSize || 0,
      eb: e.encodedBodySize || 0,
      db: e.decodedBodySize || 0,
      d: round(e.duration),
      s: round(e.startTime),
      rb: e.renderBlockingStatus || '',
      p: e.nextHopProtocol || '',
      st: e.responseStatus || 0,
    }));

    Object.assign(out, collectPerfDom(out.lcp));
    return out;
  }

  function collectPerfDom(lcp) {
    // DOM size / depth
    let elements = 0;
    let depth = 0;
    let maxChildren = 0;
    let maxChildrenEl = null;
    const stack = [[document.documentElement, 1]];
    while (stack.length) {
      const [el, d] = stack.pop();
      elements++;
      if (d > depth) depth = d;
      const kids = el.children;
      if (kids.length > maxChildren) {
        maxChildren = kids.length;
        maxChildrenEl = el;
      }
      for (let i = 0; i < kids.length; i++) stack.push([kids[i], d + 1]);
    }

    // Scripts & styles
    const scripts = Array.from(document.scripts);
    const jsTypes = /^(?:|text\/javascript|application\/javascript|module|text\/ecmascript|application\/ecmascript)$/i;
    const execScripts = scripts.filter((s) => jsTypes.test((s.getAttribute('type') || '').trim()));
    const headBlocking = document.head
      ? Array.from(document.head.querySelectorAll('script[src]')).filter((s) => !s.async && !s.defer && (s.getAttribute('type') || '').toLowerCase() !== 'module' && jsTypes.test((s.getAttribute('type') || '').trim()))
      : [];
    const inlineScripts = execScripts.filter((s) => !s.src);
    const styleLinks = qsa('link[rel~="stylesheet" i]').filter((l) => !l.disabled);
    const inlineStyles = qsa('style');

    // Images
    const dpr = devicePixelRatio || 1;
    const noDims = [];
    const offscreenEager = [];
    const oversized = [];
    const legacy = [];
    let lazyCount = 0;
    const imgs = Array.from(document.images);
    const oversizeInfo = new Map();
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:')) continue;
      if ((img.getAttribute('loading') || '').toLowerCase() === 'lazy') lazyCount++;
      if (!isVisible(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(img);
      if (!(img.hasAttribute('width') && img.hasAttribute('height')) && cs.aspectRatio === 'auto' && cs.position !== 'absolute' && cs.position !== 'fixed') noDims.push(img);
      const docTop = r.top + scrollY;
      if ((img.getAttribute('loading') || '').toLowerCase() !== 'lazy' && docTop > innerHeight * 1.5 && r.width * r.height > 4096) offscreenEager.push(img);
      const need = r.width * dpr;
      if (img.complete && img.naturalWidth > 0 && !/\.svg(?:[?#]|$)/i.test(src) && img.naturalWidth > need * 1.5 && img.naturalWidth - need > 300) {
        oversized.push(img);
        oversizeInfo.set(img, `${img.naturalWidth}px image shown at ${Math.round(r.width)}px`);
      }
      if (/\.(?:jpe?g|png|gif|bmp)(?:[?#]|$)/i.test(src)) legacy.push(img);
    }

    const preload = qsa('link[rel~="preload" i]').slice(0, 40).map((l) => ({ href: l.href, as: l.getAttribute('as') || '' }));
    const preconnect = qsa('link[rel~="preconnect" i], link[rel~="dns-prefetch" i]').map((l) => {
      try {
        return new URL(l.href).origin;
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    let fontFaces = 0;
    try {
      document.fonts.forEach((f) => {
        if (f.status === 'loaded') fontFaces++;
      });
    } catch (e) { /* ignore */ }

    return {
      dom: { elements, depth, maxChildren, maxChildrenEl: maxChildrenEl ? describe(maxChildrenEl) : '' },
      scripts: {
        external: execScripts.filter((s) => s.src).length,
        inline: inlineScripts.length,
        inlineBytes: inlineScripts.reduce((n, s) => n + s.textContent.length, 0),
        modules: execScripts.filter((s) => (s.getAttribute('type') || '').toLowerCase() === 'module').length,
        async: execScripts.filter((s) => s.src && s.async).length,
        defer: execScripts.filter((s) => s.src && s.defer).length,
        headBlocking: flag('perf.headScripts', headBlocking),
      },
      styles: {
        links: styleLinks.length,
        inline: inlineStyles.length,
        inlineBytes: inlineStyles.reduce((n, s) => n + s.textContent.length, 0),
      },
      images: {
        total: imgs.length,
        lazy: lazyCount,
        noDims: flag('perf.imgDims', noDims),
        offscreenEager: flag('perf.lazy', offscreenEager),
        oversized: flag('perf.oversized', oversized, (el) => `${describe(el)} — ${oversizeInfo.get(el)}`),
        legacy: flag('perf.formats', legacy),
        legacyUrls: legacy.slice(0, 60).map((img) => img.currentSrc || img.src),
      },
      fonts: { faces: fontFaces, preloaded: preload.filter((p) => p.as === 'font').length },
      hints: { preload, preconnect: Array.from(new Set(preconnect)).slice(0, 30) },
      iframes: qsa('iframe').length,
      serviceWorker: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      memory: performance.memory ? performance.memory.usedJSHeapSize : null,
      lcpImageLazy: !!(lcp && lcp.lazy),
    };
  }

  // ------------------------------------------------------------------ security

  const PUBLIC_CDNS = /(?:^|\.)(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|ajax\.googleapis\.com|code\.jquery\.com|stackpath\.bootstrapcdn\.com|maxcdn\.bootstrapcdn\.com|cdn\.datatables\.net|cdn\.rawgit\.com|esm\.sh|cdn\.skypack\.dev|ajax\.aspnetcdn\.com|cdn\.statically\.io)$/i;

  function collectSecurity(opts) {
    const isHttps = location.protocol === 'https:';

    // Mixed content: http:// subresources on an https page.
    const activeMixed = [];
    const passiveMixed = [];
    const mixedEls = [];
    if (isHttps) {
      const isHttp = (u) => typeof u === 'string' && /^http:\/\//i.test(u);
      const check = (els, attr, bucket, kind) => {
        for (const el of els) {
          const u = attr === 'currentSrc' ? el.currentSrc || el.src : el[attr] || el.getAttribute(attr);
          if (isHttp(u)) {
            bucket.push({ url: clean(u, 200), kind });
            mixedEls.push(el);
          }
        }
      };
      check(qsa('script[src]'), 'src', activeMixed, 'script');
      check(qsa('link[rel~="stylesheet" i][href]'), 'href', activeMixed, 'stylesheet');
      check(qsa('iframe[src]'), 'src', activeMixed, 'iframe');
      check(qsa('object[data]'), 'data', activeMixed, 'object');
      check(qsa('embed[src]'), 'src', activeMixed, 'embed');
      check(qsa('img'), 'currentSrc', passiveMixed, 'image');
      check(qsa('video[src], audio[src], source[src]'), 'src', passiveMixed, 'media');
      const seen = new Set([...activeMixed, ...passiveMixed].map((m) => m.url));
      for (const e of performance.getEntriesByType('resource')) {
        if (!isHttp(e.name) || seen.has(e.name)) continue;
        seen.add(e.name);
        const active = /^(?:script|link|css|iframe|xmlhttprequest|fetch|beacon)$/.test(e.initiatorType);
        (active ? activeMixed : passiveMixed).push({ url: clean(e.name, 200), kind: e.initiatorType });
      }
    }

    // Forms
    const forms = Array.from(document.forms);
    const insecureAction = [];
    const getWithPassword = [];
    const crossOriginActions = new Set();
    let withPassword = 0;
    for (const f of forms) {
      const hasPw = !!f.querySelector('input[type="password" i]');
      if (hasPw) withPassword++;
      const actionAttr = f.getAttribute('action');
      const action = actionAttr ? absUrl(actionAttr) || '' : location.href;
      if (isHttps && /^http:\/\//i.test(action)) insecureAction.push(f);
      if (hasPw && (f.getAttribute('method') || '').toLowerCase() === 'get') getWithPassword.push(f);
      try {
        const o = new URL(action).origin;
        if (/^https?:/.test(action) && o !== location.origin) crossOriginActions.add(o);
      } catch (e) { /* ignore */ }
    }
    const passwordFields = qsa('input[type="password" i]').length;

    // Subresource Integrity on cross-origin, versioned assets.
    const noSri = [];
    let crossOriginAssets = 0;
    for (const el of [...qsa('script[src]'), ...qsa('link[rel~="stylesheet" i][href]')]) {
      const u = el.src || el.href;
      let host;
      try {
        const url = new URL(u);
        if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) continue;
        host = url.hostname;
      } catch (e) {
        continue;
      }
      crossOriginAssets++;
      if (el.hasAttribute('integrity')) continue;
      if (PUBLIC_CDNS.test(host) || /[@/]v?\d+\.\d+\.\d+/.test(u)) noSri.push(el);
    }

    // Inline code (relevant for CSP)
    const inlineScripts = Array.from(document.scripts).filter((s) => !s.src && /^(?:|text\/javascript|application\/javascript|module)$/i.test((s.getAttribute('type') || '').trim()));
    let handlers = 0;
    const all = document.getElementsByTagName('*');
    const limit = Math.min(all.length, 8000);
    for (let i = 0; i < limit; i++) {
      const names = all[i].getAttributeNames();
      for (let j = 0; j < names.length; j++) {
        if (names[j].length > 2 && names[j].charCodeAt(0) === 111 && names[j].charCodeAt(1) === 110) {
          handlers++;
          break;
        }
      }
    }
    const jsUrls = qsa('a[href^="javascript:" i]').length;

    // Secrets in inline scripts, comments and meta tags.
    const secrets = [];
    const seenSecrets = new Set();
    const sources = [
      ['inline script', inlineScriptText()],
      ['HTML comment', collectCommentsText()],
      ['meta tag', qsa('meta[content]').map((m) => m.getAttribute('content')).join('\n')],
      ['data attribute', qsa('[data-api-key], [data-key], [data-token], [data-secret]').map((el) => Array.from(el.attributes).map((a) => a.value).join(' ')).join('\n')],
    ];
    for (const p of opts.secretPatterns || []) {
      let re;
      try {
        re = new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`);
      } catch (e) {
        continue;
      }
      for (const [where, text] of sources) {
        if (!text) continue;
        re.lastIndex = 0;
        let m;
        let guard = 0;
        while ((m = re.exec(text)) && guard++ < 25) {
          const v = m[0];
          if (seenSecrets.has(v)) continue;
          seenSecrets.add(v);
          const finding = { id: p.id, masked: v.startsWith('-----BEGIN') ? v : `${v.slice(0, 6)}…${v.slice(-4)}`, where };
          if (p.id === 'jwt') finding.claims = jwtClaims(v);
          secrets.push(finding);
          if (secrets.length > 40) break;
        }
      }
    }

    // Suspicious developer comments
    const suspicious = [];
    let commentCount = 0;
    try {
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
      while (walker.nextNode()) {
        commentCount++;
        const t = walker.currentNode.nodeValue || '';
        if (suspicious.length < 10 && /\b(?:password|passwd|secret|api[_-]?key|token|todo|fixme|hack|debug|staging|internal|admin|credentials?)\b/i.test(t)) {
          suspicious.push(clean(t, 160));
        }
      }
    } catch (e) { /* ignore */ }

    // Web storage holding auth-looking values
    const tokenLike = [];
    for (const [label, store] of [['localStorage', safeStorage('localStorage')], ['sessionStorage', safeStorage('sessionStorage')]]) {
      if (!store) continue;
      try {
        for (let i = 0; i < Math.min(store.length, 300); i++) {
          const key = store.key(i) || '';
          const value = String(store.getItem(key) || '').slice(0, 4000);
          const jwt = /(?:^|["':\s])eyJ[\w-]{8,}\.eyJ[\w-]{8,}\./.test(value);
          const named = /(?:^|[_.:-])(?:token|jwt|auth|session|secret|password|credential|api[_-]?key|access|refresh)(?:$|[_.:-])/i.test(key) || /(?:access|refresh|id)_?token/i.test(key);
          if (jwt || named || /"(?:access_token|refresh_token|id_token)"/.test(value)) tokenLike.push({ store: label, key: clean(key, 60), jwt });
        }
      } catch (e) { /* ignore */ }
    }

    // Iframes
    const iframes = qsa('iframe');
    const crossIframes = iframes.filter((f) => {
      try {
        return f.src && new URL(f.src).origin !== location.origin && /^https?:/.test(f.src);
      } catch (e) {
        return false;
      }
    });

    const targetBlank = qsa('a[target="_blank" i]').filter((a) => !/\bnoopener\b|\bnoreferrer\b/i.test(a.rel) && /\bopener\b/i.test(a.rel));

    return {
      https: isHttps,
      mixed: { active: activeMixed.slice(0, 40), passive: passiveMixed.slice(0, 40), activeCount: activeMixed.length, passiveCount: passiveMixed.length, flag: flag('sec.mixed', mixedEls) },
      forms: {
        total: forms.length,
        withPassword,
        passwordFields,
        insecureAction: flag('sec.formAction', insecureAction),
        getWithPassword: flag('sec.formGet', getWithPassword),
        crossOrigin: Array.from(crossOriginActions).slice(0, 10),
      },
      sri: { crossOrigin: crossOriginAssets, missing: flag('sec.sri', noSri) },
      inline: { scripts: inlineScripts.length, handlers, jsUrls },
      metaCsp: qsa('meta[http-equiv="content-security-policy" i]').map((m) => m.getAttribute('content') || ''),
      secrets,
      comments: { count: commentCount, suspicious },
      sourceMaps: inlineScripts.filter((s) => /[#@]\s*sourceMappingURL=/.test(s.textContent.slice(-300))).length,
      storage: { tokenLike: tokenLike.slice(0, 20) },
      iframes: { total: iframes.length, crossOrigin: crossIframes.length, sandboxed: iframes.filter((f) => f.hasAttribute('sandbox')).length, hosts: Array.from(new Set(crossIframes.map((f) => hostOf(f.src)))).slice(0, 15) },
      targetBlankOpener: targetBlank.length,
      flash: qsa('object[type="application/x-shockwave-flash" i], embed[src$=".swf" i], object[data$=".swf" i]').length,
    };
  }

  function collectCommentsText() {
    let text = '';
    try {
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
      while (walker.nextNode() && text.length < 500000) text += `${walker.currentNode.nodeValue}\n`;
    } catch (e) { /* ignore */ }
    return text;
  }

  function jwtClaims(token) {
    try {
      const part = token.split('.')[1];
      const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
      const c = JSON.parse(json);
      const pick = {};
      for (const k of ['role', 'iss', 'ref', 'aud', 'exp', 'sub', 'email', 'scope']) {
        if (c[k] !== undefined) pick[k] = typeof c[k] === 'object' ? JSON.stringify(c[k]).slice(0, 80) : String(c[k]).slice(0, 80);
      }
      return pick;
    } catch (e) {
      return null;
    }
  }

  function safeStorage(name) {
    try {
      return window[name];
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------ privacy

  function collectPrivacy() {
    const embeds = { youtube: 0, youtubeNoCookie: 0, vimeo: 0, facebook: 0, twitter: 0, instagram: 0, tiktok: 0, googleMaps: 0 };
    const trackingEmbeds = [];
    for (const f of qsa('iframe[src]')) {
      const src = f.src;
      if (/youtube-nocookie\.com\/embed/i.test(src)) embeds.youtubeNoCookie++;
      else if (/youtube\.com\/embed/i.test(src)) {
        embeds.youtube++;
        trackingEmbeds.push(f);
      } else if (/player\.vimeo\.com/i.test(src)) embeds.vimeo++;
      else if (/facebook\.com\/plugins/i.test(src)) {
        embeds.facebook++;
        trackingEmbeds.push(f);
      } else if (/platform\.twitter\.com|twitter\.com\/.*\/status|x\.com\/.*\/status/i.test(src)) embeds.twitter++;
      else if (/instagram\.com/i.test(src)) embeds.instagram++;
      else if (/tiktok\.com/i.test(src)) embeds.tiktok++;
      else if (/google\.[a-z.]+\/maps/i.test(src)) embeds.googleMaps++;
    }
    const local = safeStorage('localStorage');
    const session = safeStorage('sessionStorage');
    let localKeys = 0;
    let sessionKeys = 0;
    try {
      localKeys = local ? local.length : 0;
      sessionKeys = session ? session.length : 0;
    } catch (e) { /* ignore */ }
    return {
      embeds,
      trackingEmbeds: flag('priv.embeds', trackingEmbeds),
      cookies: cookieNames(),
      storage: { local: localKeys, session: sessionKeys },
      gpc: navigator.globalPrivacyControl === true,
    };
  }

  // ------------------------------------------------------------------ entry points

  function waitForLoad(max) {
    if (document.readyState === 'complete') return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(true), max);
      window.addEventListener('load', () => {
        clearTimeout(timer);
        setTimeout(() => resolve(true), 300);
      }, { once: true });
    });
  }

  async function collect(opts = {}) {
    const started = performance.now();
    const errors = [];
    const safe = (name, fn) => {
      try {
        return fn();
      } catch (e) {
        errors.push(`${name}: ${e && e.message ? e.message : e}`);
        return null;
      }
    };
    const waitedForLoad = await waitForLoad(opts.loadTimeout || 4000);
    flagged.clear();
    inlineTextCache = null;
    bgCache.clear();

    const perfPromise = collectPerf().catch((e) => {
      errors.push(`performance: ${e && e.message}`);
      return null;
    });
    const facts = {
      page: safe('page', pageInfo),
      signals: safe('signals', () => collectSignals(opts)),
      seo: safe('seo', collectSeo),
      a11y: safe('accessibility', collectA11y),
      security: safe('security', () => collectSecurity(opts)),
      privacy: safe('privacy', collectPrivacy),
    };
    facts.perf = await perfPromise;
    if (facts.a11y) {
      facts.design = facts.a11y.design;
      delete facts.a11y.design;
    }
    if (facts.page) facts.page.waitedForLoad = waitedForLoad;
    facts.durationMs = Math.round(performance.now() - started);
    facts.errors = errors;
    return facts;
  }

  // ------------------------------------------------------------------ highlighting

  let overlay = null;

  function clearHighlight() {
    if (!overlay) return;
    overlay.host.remove();
    window.removeEventListener('keydown', overlay.onKey, true);
    overlay = null;
  }

  function highlight(key, index) {
    clearHighlight();
    const els = (flagged.get(key) || []).filter((el) => el && el.isConnected);
    if (!els.length) return { ok: false, count: 0 };
    const shown = Number.isInteger(index) ? [els[index]].filter(Boolean) : els.slice(0, 250);

    const host = document.createElement('scanline-highlight');
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = [
      '.box{position:absolute;border:2px solid #ff4d6d;background:rgba(255,77,109,.12);border-radius:4px;box-shadow:0 0 0 1px #fff,0 2px 12px rgba(0,0,0,.35);box-sizing:border-box;animation:pulse 1.2s ease-in-out 2}',
      '.num{position:absolute;top:-20px;left:-2px;background:#ff4d6d;color:#fff;font:600 11px/18px system-ui,sans-serif;padding:0 6px;border-radius:4px;white-space:nowrap}',
      '.bar{position:fixed;top:12px;right:12px;display:flex;gap:10px;align-items:center;background:#17152b;color:#fff;font:500 13px/1.3 system-ui,sans-serif;padding:8px 8px 8px 14px;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:auto}',
      '.bar b{color:#a29bfe}',
      '.bar button{all:unset;cursor:pointer;background:#6c5ce7;color:#fff;border-radius:6px;padding:4px 10px;font-weight:600}',
      '.bar button:focus-visible{outline:2px solid #fff;outline-offset:2px}',
      '@keyframes pulse{50%{box-shadow:0 0 0 6px rgba(255,77,109,.35)}}',
    ].join('');
    root.append(style);

    const sx = scrollX;
    const sy = scrollY;
    let drawn = 0;
    shown.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const box = document.createElement('div');
      box.className = 'box';
      box.style.left = `${r.left + sx - 3}px`;
      box.style.top = `${r.top + sy - 3}px`;
      box.style.width = `${r.width + 6}px`;
      box.style.height = `${r.height + 6}px`;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String((Number.isInteger(index) ? index : i) + 1);
      box.append(num);
      root.append(box);
      drawn++;
    });

    const bar = document.createElement('div');
    bar.className = 'bar';
    const label = document.createElement('span');
    const strong = document.createElement('b');
    strong.textContent = 'Scanline';
    label.append(strong, ` · ${drawn} of ${els.length} highlighted`);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Clear';
    btn.addEventListener('click', clearHighlight);
    bar.append(label, btn);
    root.append(bar);

    document.documentElement.append(host);
    const onKey = (e) => {
      if (e.key === 'Escape') clearHighlight();
    };
    window.addEventListener('keydown', onKey, true);
    overlay = { host, onKey };
    try {
      shown[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) { /* ignore */ }
    return { ok: true, count: drawn, total: els.length };
  }

  globalThis.__scanline = { version: 2, collect, highlight, clearHighlight };
})();
