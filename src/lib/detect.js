// Matches collected page signals against the offline signature database.

import { TECHNOLOGIES, CATEGORY_LABELS, CATEGORY_ORDER } from './signatures.js';
import { cleanVersion, shortUrl, truncate } from './util.js';

const unique = (arr) => Array.from(new Set(arr));

export function probePaths() {
  return unique(TECHNOLOGIES.flatMap((t) => (t.probe || []).flat()));
}

export function domSelectors() {
  return unique(TECHNOLOGIES.flatMap((t) => t.dom || []));
}

export function cssVarNames() {
  return unique(TECHNOLOGIES.flatMap((t) => t.cssVar || []));
}

const looksLikeVersion = (v) => typeof v === 'string' && /^v?\d+(?:\.\d+){0,3}(?:[-+ ][\w.,+-]*)?$/.test(v.trim());

function headerIndex(headers) {
  const idx = {};
  for (const [name, value] of headers || []) (idx[name.toLowerCase()] = idx[name.toLowerCase()] || []).push(String(value));
  return idx;
}

function specialMatch(key, ctx) {
  const s = ctx.probe.special || {};
  switch (key) {
    case 'react':
      return s.react || s.reactVersion ? { evidence: 'React fiber on DOM nodes', version: s.reactVersion } : null;
    case 'vue':
      if (s.vue3) return { evidence: 'Vue 3 app instance on mount element', version: s.vue3 };
      if (s.vue2) return { evidence: 'Vue 2 instance on DOM element', version: s.vue2 };
      return null;
    case 'angular':
      if (s.angular) return { evidence: 'ng-version attribute', version: typeof s.angular === 'string' ? s.angular : null };
      return s.angularIvy ? { evidence: 'Angular context on DOM nodes' } : null;
    case 'svelte':
      return s.svelte ? { evidence: 'window.__svelte', version: s.svelte } : null;
    case 'webpack':
      return s.webpack ? { evidence: 'webpack chunk registry on window' } : null;
    case 'tailwind':
      return ctx.signals.tailwind ? { evidence: 'Tailwind utility class patterns' } : null;
    case 'serviceWorker':
      return ctx.signals.serviceWorker ? { evidence: 'Page is controlled by a service worker' } : null;
    case 'http3':
      return /^h3/i.test(ctx.protocol) ? { evidence: `Negotiated protocol: ${ctx.protocol}` } : null;
    case 'http2':
      return ctx.protocol === 'h2' ? { evidence: 'Negotiated protocol: h2' } : null;
    default:
      return null;
  }
}

function matchTech(tech, ctx) {
  const evidence = [];
  let version = null;
  const note = (text, v) => {
    // Several rules can match the same URL; list each piece of evidence once.
    if (evidence.length < 4 && !evidence.includes(text)) evidence.push(text);
    if (!version && v) version = cleanVersion(v);
  };

  for (const entry of tech.probe || []) {
    const paths = Array.isArray(entry) ? entry : [entry];
    if (!paths.every((p) => ctx.probe.globals[p] !== undefined)) continue;
    const value = ctx.probe.globals[paths[0]];
    note(`Global: window.${paths[0]}${typeof value === 'string' ? ` = ${truncate(value, 40)}` : ''}`, looksLikeVersion(value) ? value : null);
  }

  if (tech.special) {
    const m = specialMatch(tech.special, ctx);
    if (m) note(m.evidence, m.version);
  }

  for (const [name, re] of Object.entries(tech.meta || {})) {
    for (const content of ctx.signals.meta[name] || []) {
      const m = re.exec(content);
      if (m) {
        note(`Meta ${name}: ${truncate(content, 60)}`, m[1]);
        break;
      }
    }
  }

  for (const [name, re] of Object.entries(tech.headers || {})) {
    for (const value of ctx.headers[name] || []) {
      const m = re.exec(value);
      if (m) {
        note(`Header ${name}: ${truncate(value, 60)}`, m[1]);
        break;
      }
    }
  }

  for (const re of tech.url || []) {
    const hit = ctx.urls.find((u) => re.test(u.url));
    if (hit) {
      const m = re.exec(hit.url);
      note(`${hit.kind}: ${shortUrl(hit.url, 70)}`, m && m[1]);
    }
  }

  for (const sel of tech.dom || []) {
    if (ctx.selectors.has(sel)) note(`DOM: ${sel}`);
  }

  for (const want of tech.cookies || []) {
    const hit = ctx.cookies.find((c) => (typeof want === 'string' ? c === want : want.test(c)));
    if (hit) note(`Cookie: ${hit}`);
  }

  for (const name of tech.cssVar || []) {
    if (ctx.signals.cssVars[name]) note(`CSS variable: ${name}`);
  }

  for (const re of tech.host || []) {
    if (re.test(ctx.host)) note(`Hostname: ${ctx.host}`);
  }

  for (const re of tech.comment || []) {
    const hit = ctx.signals.comments.find((c) => re.test(c));
    if (hit) note(`HTML comment: ${truncate(hit, 60)}`, (re.exec(hit) || [])[1]);
  }

  if (tech.ids && (ctx.signals.ids[tech.ids] || []).length) note(`Tag ID: ${ctx.signals.ids[tech.ids].join(', ')}`);

  return evidence.length ? { evidence, version } : null;
}

/**
 * @param {object} input
 * @param {object} input.signals  facts.signals from the collector
 * @param {object} input.probe    result of mainWorldProbe (globals + special)
 * @param {Array}  input.headers  [[name, value], ...] of the main document response
 * @param {string} input.url      page URL
 * @param {string} input.protocol negotiated protocol (h2, h3, http/1.1)
 * @param {Array}  input.resources performance resource entries ({ u, t })
 */
export function detectStack({ signals, probe, headers, url, protocol = '', resources = [], setCookieNames = [] }) {
  signals = { scripts: [], styles: [], meta: {}, selectors: [], cssVars: {}, cookies: [], comments: [], ids: {}, ...(signals || {}) };
  probe = { globals: {}, special: {}, ...(probe || {}) };

  const urls = [];
  const seen = new Set();
  const push = (u, kind) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push({ url: u, kind });
  };
  signals.scripts.forEach((u) => push(u, 'Script'));
  signals.styles.forEach((u) => push(u, 'Stylesheet'));
  resources.forEach((r) => push(r.u, 'Request'));

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch { /* ignore */ }

  const ctx = {
    signals,
    probe,
    headers: headerIndex(headers),
    urls,
    selectors: new Set(signals.selectors),
    cookies: unique([...(signals.cookies || []), ...setCookieNames]),
    host,
    protocol: String(protocol || '').toLowerCase(),
  };

  const found = new Map();
  for (const tech of TECHNOLOGIES) {
    if ((tech.notHost || []).some((re) => re.test(host))) continue;
    const m = matchTech(tech, ctx);
    if (m) found.set(tech.name, { tech, ...m });
  }

  // Resolve implied technologies until stable.
  const byName = new Map(TECHNOLOGIES.map((t) => [t.name, t]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const { tech } of Array.from(found.values())) {
      for (const name of tech.implies || []) {
        if (found.has(name) || !byName.has(name)) continue;
        found.set(name, { tech: byName.get(name), evidence: [`Implied by ${tech.name}`], version: null, implied: true });
        changed = true;
      }
    }
  }

  return Array.from(found.values())
    .map(({ tech, evidence, version, implied }) => ({
      name: tech.name,
      cat: tech.cat,
      category: CATEGORY_LABELS[tech.cat] || tech.cat,
      version: version || null,
      evidence,
      implied: !!implied,
      tracker: tech.tracker || null,
      friendly: !!tech.friendly,
      deprecated: tech.deprecated || null,
    }))
    .sort((a, b) => (CATEGORY_ORDER[a.cat] ?? 99) - (CATEGORY_ORDER[b.cat] ?? 99) || a.name.localeCompare(b.name));
}
