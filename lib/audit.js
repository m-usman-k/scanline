// Turns raw page facts + captured headers + detected stack into scored checks and insights.
// Pure functions only (no DOM, no chrome.*), so everything here is unit-testable in Node.

import { headerIndex, first, analyzeCsp, parseHsts, auditCookies, disclosureHeaders, isServerSessionCookie } from './headers.js';
import { lookupDomain, isThirdParty, TRACKING_CATEGORIES, CATEGORY_NAMES } from './trackers.js';
import { classifyFinding } from './secrets.js';
import { COMPROMISED_SCRIPT_HOSTS } from './signatures.js';
import { HAS_ADVISORY_DATA } from './vulns.js';
import { formatBytes, formatMs, formatDuration, plural, truncate, shortUrl, hostOf, registrableDomain } from './util.js';

export const CATEGORIES = [
  { id: 'security', label: 'Security', weight: 1 },
  { id: 'performance', label: 'Performance', weight: 1 },
  { id: 'seo', label: 'SEO', weight: 1 },
  { id: 'accessibility', label: 'Accessibility', weight: 1 },
  { id: 'privacy', label: 'Privacy', weight: 0.5 },
];

const SEVERITY_LABEL = { high: 'Critical', medium: 'Moderate', low: 'Minor', info: 'Info' };
const rate = (value, good, poor) => (value <= good ? 'pass' : value <= poor ? 'warn' : 'fail');
const LOCAL_HOST = /^(?:localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)$|\.(?:localhost|local|test|internal)$/i;

// ---------------------------------------------------------------- resources

const RESOURCE_TYPES = [
  ['script', 'Scripts'],
  ['stylesheet', 'Stylesheets'],
  ['image', 'Images'],
  ['font', 'Fonts'],
  ['fetch', 'Fetch / XHR'],
  ['other', 'Other (media, frames…)'],
];

function resourceType(r) {
  const u = r.u.split(/[?#]/)[0].toLowerCase();
  if (/\.(?:woff2?|ttf|otf|eot)$/.test(u)) return 'font';
  if (r.t === 'script' || /\.m?js$/.test(u)) return 'script';
  if (/\.css$/.test(u) || (r.t === 'link' && !/\.(?:png|jpe?g|gif|webp|avif|svg|ico|js)$/.test(u))) return 'stylesheet';
  if (r.t === 'img' || r.t === 'image' || /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(u)) return 'image';
  if (r.t === 'fetch' || r.t === 'xmlhttprequest' || r.t === 'beacon') return 'fetch';
  if (r.t === 'css') return 'image';
  return 'other';
}

// Only text formats benefit from gzip/brotli; binary files (images, models, fonts) are already compressed.
const TEXT_EXT = /\.(?:m?js|css|json|html?|xml|txt|svg|csv|map|graphql|wasm)$/;
function isTextLike(r) {
  const path = r.u.split(/[?#]/)[0].toLowerCase();
  const ext = /\.[a-z0-9]{1,6}$/.exec(path);
  if (ext) return TEXT_EXT.test(path);
  return r.type === 'script' || r.type === 'stylesheet' || r.type === 'fetch';
}

function prepareResources(facts, pageHost) {
  const list = (facts.perf && facts.perf.resources) || [];
  return list.map((r) => {
    const host = hostOf(r.u);
    const known = lookupDomain(host);
    return {
      ...r,
      host,
      type: resourceType(r),
      size: r.eb || r.ts || 0,
      thirdParty: isThirdParty(host, pageHost),
      entity: known ? known.entity : null,
      category: known ? known.category : null,
    };
  });
}

// ---------------------------------------------------------------- main entry

/**
 * @param {object} input
 * @param {object} input.facts   collector output
 * @param {object|null} input.doc captured main-document response ({ status, headers, redirects, ip, fromCache })
 * @param {Array}  input.stack   assessed stack (detect + vulns)
 * @param {object} input.probe   main-world probe result
 */
export function audit({ facts, doc = null, stack = [], probe = {} }) {
  facts = facts || {};
  const page = facts.page || {};
  const pageHost = page.host || hostOf(page.url);
  const idx = headerIndex(doc ? doc.headers : []);
  const resources = prepareResources(facts, pageHost);
  const ctx = {
    facts,
    doc,
    idx,
    stack,
    probe: { globals: {}, special: {}, ...probe },
    https: page.protocol === 'https:',
    local: LOCAL_HOST.test(pageHost || ''),
    headersKnown: !!doc,
    pageHost,
    resources,
  };

  const checks = [];
  const add = (c) => checks.push({ weight: 1, details: [], ...c });

  for (const fn of [auditSecurity, auditPerformance, auditSeo, auditAccessibility, auditPrivacy]) {
    try {
      fn(ctx, add);
    } catch (e) {
      add({ id: `${fn.name}.error`, cat: fn.name.replace('audit', '').toLowerCase(), group: 'Errors', title: 'Analysis error', status: 'info', value: String(e && e.message) });
    }
  }

  return { checks: checks.map(tidy), insights: buildInsights(ctx) };
}

function tidy(c) {
  const out = { ...c, details: (c.details || []).filter(Boolean) };
  if (!out.samples || !out.samples.length) delete out.samples;
  if (!out.highlight) delete out.highlight;
  return out;
}

const unknownHeaders = { status: 'info', value: 'Not captured. Reload the page so Scanline can read its response headers.', unknown: true };

// ---------------------------------------------------------------- security

function auditSecurity(ctx, add) {
  const { facts, idx, stack } = ctx;
  const sec = facts.security || {};
  const cat = 'security';
  const G = { conn: 'Connection', headers: 'Response headers', cookies: 'Cookies & storage', content: 'Page content', libs: 'Libraries & dependencies' };
  const https = ctx.https;

  add({
    id: 'sec.https', cat, group: G.conn, title: 'HTTPS', weight: 3,
    ...(https
      ? { status: 'pass', value: 'Served over HTTPS' }
      : ctx.local
        ? { status: 'info', value: 'Local development host (HTTPS not required)' }
        : { status: 'fail', value: 'Served over plain HTTP: traffic can be read and modified in transit' }),
  });

  if (ctx.doc && ctx.doc.redirects && ctx.doc.redirects.length) {
    const r = ctx.doc.redirects;
    const upgraded = r.some((x) => /^http:/i.test(x.url) && /^https:/i.test(x.to));
    add({
      id: 'sec.redirects', cat, group: G.conn, title: 'Redirects', status: 'info',
      value: upgraded ? 'HTTP is redirected to HTTPS' : `${plural(r.length, 'redirect')} before this page`,
      details: r.map((x) => `${x.status} ${shortUrl(x.url, 50)} → ${shortUrl(x.to, 50)}`),
    });
  }

  if (https) {
    const raw = first(idx, 'strict-transport-security');
    const hsts = parseHsts(raw);
    let c;
    if (!ctx.headersKnown) c = unknownHeaders;
    else if (!hsts) c = { status: 'warn', value: 'Not set. A first visit over http:// can be intercepted.' };
    else if (!hsts.maxAge || hsts.maxAge < 15552000) c = { status: 'warn', value: hsts.maxAge ? `max-age is only ${formatDuration(hsts.maxAge)} (use at least 180 days, ideally a year)` : 'max-age=0 disables HSTS' };
    else c = { status: 'pass', value: `max-age ${formatDuration(hsts.maxAge)}${hsts.includeSubDomains ? ' · includeSubDomains' : ''}${hsts.preload ? ' · preload' : ''}` };
    add({ id: 'sec.hsts', cat, group: G.conn, title: 'Strict-Transport-Security', weight: 2, ...c, details: raw ? [raw] : [] });

    const m = sec.mixed || {};
    const active = m.activeCount || 0;
    const passive = m.passiveCount || 0;
    add({
      id: 'sec.mixed', cat, group: G.conn, title: 'Mixed content', weight: 3,
      status: active ? 'fail' : passive ? 'warn' : 'pass',
      value: active ? `${plural(active, 'insecure script/stylesheet/frame request')}` : passive ? `${plural(passive, 'insecure image/media request')}` : 'All subresources use HTTPS',
      details: [...(m.active || []).map((x) => `Active (${x.kind}): ${x.url}`), ...(m.passive || []).map((x) => `Passive (${x.kind}): ${x.url}`)].slice(0, 20),
      highlight: m.flag && m.flag.key,
    });
  }

  // CSP
  const cspHeader = (idx['content-security-policy'] || []).join(', ');
  const cspReportOnly = first(idx, 'content-security-policy-report-only');
  const csp = analyzeCsp({ header: cspHeader, meta: sec.metaCsp || [] });
  {
    let c;
    if (!ctx.headersKnown && !csp.present) c = unknownHeaders;
    else if (!csp.present) {
      c = { status: 'fail', value: cspReportOnly ? 'Only a report-only policy is set, so nothing is enforced' : 'Not set: no second line of defense against XSS' };
    } else {
      const high = csp.issues.filter((i) => i.severity === 'high');
      const medium = csp.issues.filter((i) => i.severity === 'medium');
      c = {
        status: high.length || medium.length ? 'warn' : 'pass',
        value: high.length ? `Weak policy: ${plural(high.length, 'critical gap')}` : medium.length ? `Policy set, ${plural(medium.length, 'gap')}` : csp.viaMeta ? 'Policy set via <meta> tag' : 'Policy looks solid',
        details: [
          ...csp.issues.map((i) => `${SEVERITY_LABEL[i.severity]}: ${i.text}`),
          ...csp.strengths.map((s) => `Good: ${s}`),
          cspReportOnly ? 'A report-only policy is also set.' : '',
          cspHeader ? `Policy: ${truncate(cspHeader, 400)}` : '',
        ],
      };
    }
    add({ id: 'sec.csp', cat, group: G.headers, title: 'Content-Security-Policy', weight: 2, ...c });
  }

  // Clickjacking
  {
    const xfo = first(idx, 'x-frame-options');
    const fa = analyzeCsp({ header: cspHeader }).frameAncestors;
    let c;
    if (!ctx.headersKnown) c = unknownHeaders;
    else if (fa) c = { status: 'pass', value: `CSP frame-ancestors ${fa}` };
    else if (xfo && /^\s*(deny|sameorigin)\s*$/i.test(xfo)) c = { status: 'pass', value: `X-Frame-Options: ${xfo.trim().toUpperCase()}` };
    else if (xfo) c = { status: 'warn', value: `X-Frame-Options "${truncate(xfo, 40)}" is obsolete or invalid` };
    else c = { status: 'warn', value: 'Any site can embed this page in a frame' };
    add({ id: 'sec.clickjacking', cat, group: G.headers, title: 'Clickjacking protection', weight: 2, ...c });
  }

  {
    const v = first(idx, 'x-content-type-options');
    add({ id: 'sec.nosniff', cat, group: G.headers, title: 'X-Content-Type-Options', weight: 1, ...(!ctx.headersKnown ? unknownHeaders : v && /nosniff/i.test(v) ? { status: 'pass', value: 'nosniff' } : { status: 'warn', value: v ? `Invalid value "${truncate(v, 30)}"` : 'Not set' }) });
  }

  {
    const metaRef = ((facts.signals && facts.signals.meta && facts.signals.meta.referrer) || [])[0];
    const raw = first(idx, 'referrer-policy') || metaRef || '';
    const policy = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).pop() || '';
    let c;
    if (!ctx.headersKnown && !raw) c = unknownHeaders;
    else if (!policy) c = { status: 'info', value: 'Not set. Browsers default to strict-origin-when-cross-origin.' };
    else if (policy === 'unsafe-url' || policy === 'no-referrer-when-downgrade') c = { status: 'warn', value: `${policy} sends full URLs, including query strings, to other sites` };
    else c = { status: 'pass', value: policy };
    add({ id: 'sec.referrer', cat, group: G.headers, title: 'Referrer-Policy', weight: 1, ...c });
  }

  {
    const v = first(idx, 'permissions-policy');
    add({ id: 'sec.permissions', cat, group: G.headers, title: 'Permissions-Policy', weight: 1, ...(!ctx.headersKnown ? unknownHeaders : v ? { status: 'pass', value: truncate(v, 80), details: [v] } : { status: 'info', value: 'Not set (optional hardening for camera, geolocation, etc.)' }) });
  }

  {
    const v = first(idx, 'cross-origin-opener-policy');
    add({ id: 'sec.coop', cat, group: G.headers, title: 'Cross-Origin-Opener-Policy', weight: 1, ...(!ctx.headersKnown ? unknownHeaders : v && /same-origin/i.test(v) ? { status: 'pass', value: v } : { status: 'info', value: v ? v : 'Not set (optional cross-window isolation)' }) });
  }

  {
    const v = first(idx, 'x-xss-protection');
    if (v && !/^\s*0/.test(v)) add({ id: 'sec.xxss', cat, group: G.headers, title: 'X-XSS-Protection', weight: 1, status: 'warn', value: `"${truncate(v, 30)}" enables a removed filter that caused vulnerabilities; set 0 or drop it` });
  }

  {
    const acao = first(idx, 'access-control-allow-origin');
    if (acao) {
      const creds = /true/i.test(first(idx, 'access-control-allow-credentials') || '');
      add({ id: 'sec.cors', cat, group: G.headers, title: 'CORS on the document', weight: 1, status: acao.trim() === '*' && creds ? 'warn' : 'info', value: `Access-Control-Allow-Origin: ${truncate(acao, 60)}${creds ? ' (with credentials)' : ''}` });
    }
  }

  {
    const disc = ctx.headersKnown ? disclosureHeaders(idx) : [];
    const gen = ((facts.signals && facts.signals.meta && facts.signals.meta.generator) || []).filter((g) => /\d+\.\d+/.test(g));
    const items = [...disc, ...gen.map((g) => `<meta name="generator"> ${g}`)];
    add({ id: 'sec.disclosure', cat, group: G.headers, title: 'Version disclosure', weight: 1, status: items.length ? 'warn' : 'pass', value: items.length ? `${plural(items.length, 'header/tag reveals', 'headers/tags reveal')} software versions` : 'No software versions exposed', details: items });
  }

  // Cookies
  {
    const lines = idx['set-cookie'] || [];
    const { cookies, problems } = auditCookies(lines, { https });
    const jsReadable = ((facts.privacy && facts.privacy.cookies) || []).filter(isServerSessionCookie);
    const hasHigh = problems.some((p) => p.issues.some((i) => i.severity === 'high'));
    const hasMedium = problems.some((p) => p.issues.some((i) => i.severity === 'medium')) || jsReadable.length > 0;
    const details = [
      ...problems.map((p) => `${p.name}: ${p.issues.map((i) => i.text).join(', ')}`),
      jsReadable.length ? `Readable by JavaScript (no HttpOnly): ${jsReadable.slice(0, 8).join(', ')}` : '',
      !ctx.headersKnown ? 'Set-Cookie headers were not captured; reload the page for a full cookie audit.' : '',
    ];
    add({
      id: 'sec.cookies', cat, group: G.cookies, title: 'Cookie security', weight: 2,
      status: hasHigh ? 'fail' : hasMedium ? 'warn' : 'pass',
      value: hasHigh ? 'Session cookies are missing Secure/HttpOnly' : hasMedium ? 'Some cookies are weakly protected' : cookies.length ? `${plural(cookies.length, 'cookie')} set with sound flags` : 'No cookies set by the page response',
      details,
    });
  }

  {
    const tokens = (sec.storage && sec.storage.tokenLike) || [];
    add({ id: 'sec.storage', cat, group: G.cookies, title: 'Tokens in Web Storage', weight: 1, status: tokens.length ? 'warn' : 'pass', value: tokens.length ? `${plural(tokens.length, 'auth-looking value')} readable by any script` : 'No auth tokens found in localStorage/sessionStorage', details: tokens.map((t) => `${t.store}: ${t.key}${t.jwt ? ' (JWT)' : ''}`) });
  }

  // Forms
  {
    const f = sec.forms || {};
    const pwOnHttp = !https && !ctx.local && f.withPassword > 0;
    const insecure = (f.insecureAction && f.insecureAction.count) || 0;
    const getPw = (f.getWithPassword && f.getWithPassword.count) || 0;
    const fail = pwOnHttp || insecure || getPw;
    add({
      id: 'sec.forms', cat, group: G.content, title: 'Form security', weight: 3,
      status: fail ? 'fail' : 'pass',
      value: pwOnHttp ? 'Password form on an unencrypted page' : getPw ? 'Password form submits with GET (credentials end up in URLs and logs)' : insecure ? `${plural(insecure, 'form submits', 'forms submit')} over plain HTTP` : f.total ? `${plural(f.total, 'form')} submit securely` : 'No forms on this page',
      details: [
        f.withPassword ? `${plural(f.withPassword, 'form')} with a password field` : '',
        (f.crossOrigin || []).length ? `Submits to other origins: ${f.crossOrigin.join(', ')}` : '',
      ],
      samples: [...((f.insecureAction && f.insecureAction.samples) || []), ...((f.getWithPassword && f.getWithPassword.samples) || [])],
      highlight: (f.insecureAction && f.insecureAction.key) || (f.getWithPassword && f.getWithPassword.key),
    });
  }

  {
    const s = sec.sri || {};
    const missing = (s.missing && s.missing.count) || 0;
    add({
      id: 'sec.sri', cat, group: G.content, title: 'Subresource Integrity', weight: 1,
      status: missing ? 'warn' : 'pass',
      value: missing ? `${plural(missing, 'versioned CDN asset')} without integrity hashes` : s.crossOrigin ? 'Versioned CDN assets are pinned with integrity hashes' : 'No cross-origin scripts or stylesheets',
      samples: s.missing && s.missing.samples, highlight: s.missing && s.missing.key,
    });
  }

  {
    const urls = [...((facts.signals && facts.signals.scripts) || []), ...ctx.resources.map((r) => r.u)];
    const bad = Array.from(new Set(urls.filter((u) => {
      const h = hostOf(u);
      return COMPROMISED_SCRIPT_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
    })));
    add({ id: 'sec.compromised', cat, group: G.content, title: 'Compromised script hosts', weight: 3, status: bad.length ? 'fail' : 'pass', value: bad.length ? `Loads code from ${plural(bad.length, 'known-malicious URL')}` : 'No known-malicious script hosts', details: bad.slice(0, 10).map((u) => shortUrl(u, 90)) });
  }

  {
    const findings = (sec.secrets || []).map(classifyFinding).filter(Boolean);
    add(secretsCheck('sec.secrets', 'Exposed secrets', findings, 'in the page source'));
  }

  {
    const items = [];
    if (ctx.probe.special.angularDevMode) items.push('Angular is running in development mode.');
    if (stack.some((t) => t.name === 'Vite dev server')) items.push('This page is served by the Vite development server.');
    if (first(idx, 'x-debug-token') || first(idx, 'x-debug-token-link')) items.push('Symfony profiler debug token header is exposed.');
    if (first(idx, 'sourcemap') || first(idx, 'x-sourcemap')) items.push('A SourceMap header exposes original source code.');
    if (sec.sourceMaps) items.push(`${plural(sec.sourceMaps, 'inline script references', 'inline scripts reference')} a source map.`);
    add({ id: 'sec.debug', cat, group: G.content, title: 'Debug artifacts', weight: 1, status: items.length ? 'warn' : 'pass', value: items.length ? plural(items.length, 'development artifact') : 'No debug or development artifacts found', details: items });
  }

  if (sec.flash) add({ id: 'sec.flash', cat, group: G.content, title: 'Flash content', weight: 1, status: 'fail', value: `${plural(sec.flash, 'Flash object')} (unsupported since 2021)` });

  {
    const inl = sec.inline || {};
    add({ id: 'sec.inline', cat, group: G.content, title: 'Inline code', status: 'info', value: `${plural(inl.scripts || 0, 'inline script')}, ${plural(inl.handlers || 0, 'inline event handler')}`, details: [inl.jsUrls ? `${plural(inl.jsUrls, 'javascript: link')}` : '', 'Inline code forces CSP to allow unsafe-inline unless nonces/hashes are used.'] });
  }

  if (sec.iframes && sec.iframes.crossOrigin) {
    add({ id: 'sec.iframes', cat, group: G.content, title: 'Third-party frames', status: 'info', value: `${plural(sec.iframes.crossOrigin, 'cross-origin iframe')} (${sec.iframes.sandboxed} sandboxed)`, details: sec.iframes.hosts });
  }

  if (sec.comments && sec.comments.suspicious && sec.comments.suspicious.length) {
    add({ id: 'sec.comments', cat, group: G.content, title: 'Revealing HTML comments', status: 'info', value: `${plural(sec.comments.suspicious.length, 'comment')} mention credentials, TODOs or internals`, details: sec.comments.suspicious });
  }

  // Libraries
  {
    const vulnerable = stack.filter((t) => t.vulns && t.vulns.length);
    const high = vulnerable.some((t) => t.vulns.some((v) => v.severity === 'high'));
    const versioned = stack.filter((t) => t.version && HAS_ADVISORY_DATA.has(t.name));
    const unknown = stack.filter((t) => !t.version && !t.implied && HAS_ADVISORY_DATA.has(t.name) && !(t.vulns && t.vulns.length));
    add({
      id: 'sec.vulnLibs', cat, group: G.libs, title: 'Known-vulnerable libraries', weight: 3,
      status: high ? 'fail' : vulnerable.length ? 'warn' : 'pass',
      value: vulnerable.length ? `${plural(vulnerable.length, 'library has', 'libraries have')} published vulnerabilities` : versioned.length ? `No known issues in ${plural(versioned.length, 'versioned library', 'versioned libraries')}` : 'No versioned libraries with known advisories detected',
      details: [
        ...vulnerable.flatMap((t) => t.vulns.map((v) => `${t.name} ${t.version || ''}: ${v.ids.join(', ')}. ${v.summary}${v.fixedIn ? ` Fixed in ${v.fixedIn}.` : ''}`)),
        unknown.length ? `Version unknown, not checked: ${unknown.map((t) => t.name).join(', ')}` : '',
      ],
    });
  }

  {
    const eol = stack.filter((t) => t.eol);
    const deprecated = stack.filter((t) => t.deprecated);
    const notices = stack.filter((t) => t.notice);
    add({
      id: 'sec.eol', cat, group: G.libs, title: 'End-of-life software', weight: 2,
      status: eol.length ? 'warn' : 'pass',
      value: eol.length ? `${plural(eol.length, 'component')} no longer receive security fixes` : 'No end-of-life software detected',
      details: [...eol.map((t) => `${t.name}${t.version ? ` ${t.version}` : ''}: ${t.eol}`), ...notices.map((t) => `${t.name}: ${t.notice}`)],
    });
    if (deprecated.length) {
      add({ id: 'sec.deprecated', cat, group: G.libs, title: 'Discontinued services', weight: 1, status: 'warn', value: `${plural(deprecated.length, 'discontinued service')} still loaded`, details: deprecated.map((t) => `${t.name}: ${t.deprecated}`) });
    }
  }
}

/** Shared by the page scan and the optional bundle scan. */
export function secretsCheck(id, title, findings, where) {
  const high = findings.filter((f) => f.severity === 'high');
  const medium = findings.filter((f) => f.severity === 'medium');
  return {
    id, cat: 'security', group: 'Page content', title, weight: 3,
    status: high.length ? 'fail' : medium.length ? 'warn' : 'pass',
    value: high.length ? `${plural(high.length, 'credential')} exposed ${where}` : medium.length ? `${plural(medium.length, 'token')} embedded ${where}` : findings.length ? 'Only public keys found (check they are restricted)' : `No credentials found ${where}`,
    details: findings.slice(0, 20).map((f) => `${SEVERITY_LABEL[f.severity] || 'Info'}: ${f.name} in ${f.where}: ${f.masked}${f.note ? `. ${f.note}` : ''}`),
  };
}

// ---------------------------------------------------------------- performance

function auditPerformance(ctx, add) {
  const p = ctx.facts.perf;
  const cat = 'performance';
  const G = { cwv: 'Core Web Vitals', load: 'Loading', net: 'Network', code: 'JavaScript & CSS', img: 'Images', dom: 'Page structure' };
  if (!p) {
    add({ id: 'perf.unavailable', cat, group: G.load, title: 'Performance data', status: 'info', value: 'Not available for this page' });
    return;
  }
  const nav = p.nav || {};
  const res = ctx.resources;

  if (p.lcp && Number.isFinite(p.lcp.time)) {
    add({
      id: 'perf.lcp', cat, group: G.cwv, title: 'Largest Contentful Paint', weight: 3,
      status: rate(p.lcp.time, 2500, 4000), value: formatMs(p.lcp.time), metric: p.lcp.time,
      details: [p.lcp.element ? `Element: ${p.lcp.element}` : '', p.lcp.url ? `Resource: ${shortUrl(p.lcp.url, 80)}` : ''],
      highlight: p.lcp.flag && p.lcp.flag.key,
    });
  } else {
    add({ id: 'perf.lcp', cat, group: G.cwv, title: 'Largest Contentful Paint', status: 'info', value: 'Not recorded (the tab may have loaded in the background). Reload and rescan.' });
  }

  if (p.cls) {
    add({
      id: 'perf.cls', cat, group: G.cwv, title: 'Cumulative Layout Shift', weight: 3,
      status: rate(p.cls.value, 0.1, 0.25), value: (p.cls.value || 0).toFixed(3), metric: p.cls.value,
      details: [`${plural(p.cls.shifts, 'layout shift')} without recent input`],
      samples: p.cls.sources && p.cls.sources.samples, highlight: p.cls.sources && p.cls.sources.key,
    });
  }

  if (p.inp) {
    add({
      id: 'perf.inp', cat, group: G.cwv, title: 'Interaction to Next Paint', weight: 2,
      status: rate(p.inp.value, 200, 500), value: formatMs(p.inp.value), metric: p.inp.value,
      details: [p.inp.fromFirstInput ? 'Based on the first interaction only.' : `Worst of ${plural(p.inp.interactions, 'slow interaction')} observed so far.`],
    });
  } else {
    add({ id: 'perf.inp', cat, group: G.cwv, title: 'Interaction to Next Paint', status: 'info', value: 'No interactions yet. Click around the page, then rescan.' });
  }

  if (Number.isFinite(p.fcp)) {
    add({ id: 'perf.fcp', cat, group: G.load, title: 'First Contentful Paint', weight: 2, status: rate(p.fcp, 1800, 3000), value: formatMs(p.fcp), metric: p.fcp });
  }

  if (Number.isFinite(nav.ttfb)) {
    const cached = (ctx.doc && ctx.doc.fromCache) || nav.deliveryType === 'cache';
    add({
      id: 'perf.ttfb', cat, group: G.load, title: 'Time to First Byte', weight: 2,
      status: rate(nav.ttfb, 800, 1800), value: formatMs(nav.ttfb), metric: nav.ttfb,
      details: [
        `DNS ${formatMs(nav.dns)} · Connect ${formatMs(nav.connect)}${nav.tls ? ` (TLS ${formatMs(nav.tls)})` : ''} · Server ${formatMs(nav.wait)} · Download ${formatMs(nav.download)}`,
        nav.redirect ? `Redirects took ${formatMs(nav.redirect)}` : '',
        cached ? 'The document was served from the browser cache.' : '',
        nav.prerendered ? 'The page was prerendered; timings are relative to activation.' : '',
        ...(nav.serverTiming || []).map((s) => `Server-Timing ${s.name}: ${s.duration != null ? formatMs(s.duration) : ''} ${s.description || ''}`.trim()),
      ],
    });
  }

  if (p.blocking) {
    add({
      id: 'perf.blocking', cat, group: G.load, title: 'Main-thread blocking', weight: 2,
      status: rate(p.blocking.total, 200, 600), value: `${formatMs(p.blocking.total)} blocked during load`, metric: p.blocking.total,
      details: [
        `${plural(p.blocking.count, p.supported.blocking === 'loaf' ? 'long animation frame' : 'long task')}, longest ${formatMs(p.blocking.longest)}`,
        ...(p.blocking.scripts || []).map((s) => `${shortUrl(s.src, 70)}: ${formatMs(s.ms)}`),
      ],
    });
  }

  if (Number.isFinite(nav.load) && nav.load > 0) {
    add({ id: 'perf.load', cat, group: G.load, title: 'Load event', weight: 1, status: rate(nav.load, 3000, 6000), value: formatMs(nav.load), details: [`DOM interactive ${formatMs(nav.domInteractive)} · DOMContentLoaded ${formatMs(nav.dcl)}`] });
  }

  {
    const hasStatus = res.some((r) => r.rb);
    const blocking = hasStatus ? res.filter((r) => r.rb === 'blocking') : [];
    const headScripts = (p.scripts && p.scripts.headBlocking) || { count: 0 };
    const count = hasStatus ? blocking.length : headScripts.count;
    add({
      id: 'perf.renderBlocking', cat, group: G.load, title: 'Render-blocking resources', weight: 2,
      status: count === 0 ? 'pass' : count <= 3 ? 'warn' : 'fail',
      value: count ? `${plural(count, 'resource')} delay the first render` : 'Nothing blocks the first render',
      details: blocking.slice(0, 12).map((r) => `${shortUrl(r.u, 80)} (${formatBytes(r.size)})`),
      samples: !hasStatus ? headScripts.samples : undefined,
      highlight: headScripts.key,
    });
  }

  if (p.lcpImageLazy) {
    add({ id: 'perf.lcpLazy', cat, group: G.load, title: 'Lazy-loaded LCP image', weight: 2, status: 'fail', value: 'The largest image has loading="lazy", which delays it', highlight: p.lcp && p.lcp.flag && p.lcp.flag.key });
  }

  // Network
  const docBytes = nav.encodedBodySize || nav.transferSize || 0;
  const total = res.reduce((n, r) => n + r.size, 0) + docBytes;
  const hidden = res.filter((r) => !r.size && !r.db).length;
  add({
    id: 'perf.weight', cat, group: G.net, title: 'Page weight', weight: 2,
    status: rate(total, 1.6 * 1024 * 1024, 4 * 1024 * 1024), value: formatBytes(total), metric: total,
    details: [
      ...RESOURCE_TYPES.map(([t, label]) => {
        const items = res.filter((r) => r.type === t);
        return items.length ? `${label}: ${formatBytes(items.reduce((n, r) => n + r.size, 0))} in ${plural(items.length, 'request')}` : '';
      }),
      hidden ? `${plural(hidden, 'cross-origin request hides its', 'cross-origin requests hide their')} size (no Timing-Allow-Origin).` : '',
    ],
  });

  {
    const count = (p.resourceCount || res.length) + 1;
    add({ id: 'perf.requests', cat, group: G.net, title: 'Requests', weight: 1, status: rate(count, 60, 150), value: `${p.resourcesBufferFull ? 'at least ' : ''}${count}`, metric: count, details: p.resourcesBufferFull ? ['The browser stopped recording after 250 resources (default buffer size).'] : [] });
  }

  {
    const enc = first(ctx.idx, 'content-encoding');
    const docCompressed = enc ? /br|gzip|zstd|deflate/i.test(enc) : nav.encodedBodySize > 0 && nav.decodedBodySize > nav.encodedBodySize * 1.05;
    const docKnown = !!enc || (nav.encodedBodySize > 0 && nav.decodedBodySize > 0);
    const uncompressed = res.filter((r) => isTextLike(r) && r.eb > 0 && r.db > 2048 && r.eb >= r.db);
    const wasted = uncompressed.reduce((n, r) => n + r.db * 0.7, 0);
    const docBad = docKnown && !docCompressed && (nav.decodedBodySize || 0) > 4096;
    add({
      id: 'perf.compression', cat, group: G.net, title: 'Text compression', weight: 2,
      status: docBad || wasted > 100 * 1024 ? 'fail' : uncompressed.length ? 'warn' : 'pass',
      value: docBad ? 'The HTML document is sent uncompressed' : uncompressed.length ? `${plural(uncompressed.length, 'text resource')} sent uncompressed (~${formatBytes(wasted)} wasted)` : `Text is compressed${enc ? ` (${enc})` : ''}`,
      details: uncompressed.slice(0, 10).map((r) => `${shortUrl(r.u, 80)} (${formatBytes(r.db)})`),
    });
  }

  if (nav.protocol) {
    const old = /^http\/1/i.test(nav.protocol);
    add({ id: 'perf.protocol', cat, group: G.net, title: 'HTTP protocol', weight: 1, status: old ? 'warn' : 'pass', value: old ? `${nav.protocol}: no multiplexing` : nav.protocol === 'h3' ? 'HTTP/3' : nav.protocol === 'h2' ? 'HTTP/2' : nav.protocol });
  }

  {
    const failed = res.filter((r) => r.st >= 400);
    add({ id: 'perf.failed', cat, group: G.net, title: 'Failed requests', weight: 2, status: failed.length ? 'warn' : 'pass', value: failed.length ? `${plural(failed.length, 'request')} returned an error` : 'No failed requests detected', details: failed.slice(0, 12).map((r) => `${r.st} ${shortUrl(r.u, 80)}`) });
  }

  {
    const tp = thirdPartySummary(res);
    const share = total ? Math.round((tp.bytes / total) * 100) : 0;
    add({
      id: 'perf.thirdParty', cat, group: G.net, title: 'Third-party code', weight: 1,
      status: rate(tp.domains.length, 8, 20), value: tp.domains.length ? `${plural(tp.domains.length, 'domain')}, ${plural(tp.requests, 'request')}, ${share}% of bytes` : 'No third-party requests', metric: tp.domains.length,
      details: tp.domains.slice(0, 8).map((d) => `${d.domain}${d.entity ? ` (${d.entity})` : ''}: ${plural(d.requests, 'request')}, ${formatBytes(d.bytes)}`),
    });
  }

  {
    const cc = first(ctx.idx, 'cache-control');
    if (ctx.headersKnown) add({ id: 'perf.docCache', cat, group: G.net, title: 'Document caching', status: 'info', value: cc ? `Cache-Control: ${truncate(cc, 70)}` : 'No Cache-Control header on the HTML' });
  }

  // Code
  {
    const js = res.filter((r) => r.type === 'script').reduce((n, r) => n + r.size, 0) + ((p.scripts && p.scripts.inlineBytes) || 0);
    add({ id: 'perf.js', cat, group: G.code, title: 'JavaScript size', weight: 2, status: rate(js, 500 * 1024, 1200 * 1024), value: `${formatBytes(js)} (compressed)`, metric: js, details: [`${plural((p.scripts && p.scripts.external) || 0, 'external script')}, ${plural((p.scripts && p.scripts.inline) || 0, 'inline script')}`] });
    const css = res.filter((r) => r.type === 'stylesheet').reduce((n, r) => n + r.size, 0) + ((p.styles && p.styles.inlineBytes) || 0);
    add({ id: 'perf.css', cat, group: G.code, title: 'CSS size', weight: 1, status: rate(css, 150 * 1024, 400 * 1024), value: formatBytes(css), metric: css, details: [`${plural((p.styles && p.styles.links) || 0, 'stylesheet')}, ${plural((p.styles && p.styles.inline) || 0, 'inline <style> block')}`] });
  }

  // Images
  const img = p.images || {};
  const n = (f) => (f && f.count) || 0;
  add({ id: 'perf.imgDims', cat, group: G.img, title: 'Image dimensions', weight: 1, status: n(img.noDims) ? 'warn' : 'pass', value: n(img.noDims) ? `${plural(n(img.noDims), 'image')} without width/height (causes layout shifts)` : 'Visible images reserve their space', samples: img.noDims && img.noDims.samples, highlight: img.noDims && img.noDims.key });
  add({ id: 'perf.lazy', cat, group: G.img, title: 'Offscreen images', weight: 1, status: n(img.offscreenEager) > 2 ? 'warn' : 'pass', value: n(img.offscreenEager) ? `${plural(n(img.offscreenEager), 'below-the-fold image')} load eagerly` : 'Below-the-fold images are lazy-loaded', samples: img.offscreenEager && img.offscreenEager.samples, highlight: img.offscreenEager && img.offscreenEager.key });
  add({ id: 'perf.oversized', cat, group: G.img, title: 'Oversized images', weight: 1, status: n(img.oversized) ? 'warn' : 'pass', value: n(img.oversized) ? `${plural(n(img.oversized), 'image')} much larger than displayed` : 'Images are sized appropriately', samples: img.oversized && img.oversized.samples, highlight: img.oversized && img.oversized.key });
  {
    const sizes = new Map(res.map((r) => [r.u, r.size]));
    const heavy = (img.legacyUrls || []).filter((u) => (sizes.get(u) || 0) > 100 * 1024);
    add({ id: 'perf.formats', cat, group: G.img, title: 'Modern image formats', weight: 1, status: heavy.length ? 'warn' : 'pass', value: heavy.length ? `${plural(heavy.length, 'large JPEG/PNG/GIF')} could be WebP or AVIF` : n(img.legacy) ? `${plural(n(img.legacy), 'small legacy-format image')} (low impact)` : 'No heavy legacy-format images', details: heavy.slice(0, 10).map((u) => `${shortUrl(u, 70)} (${formatBytes(sizes.get(u))})`), highlight: img.legacy && img.legacy.key });
  }

  {
    const fonts = res.filter((r) => r.type === 'font');
    add({ id: 'perf.fonts', cat, group: G.dom, title: 'Web fonts', weight: 1, status: fonts.length > 8 ? 'warn' : 'pass', value: fonts.length ? `${plural(fonts.length, 'font file')}, ${formatBytes(fonts.reduce((s, r) => s + r.size, 0))}` : 'No web font downloads', details: [((ctx.facts.design && ctx.facts.design.webfonts) || []).length ? `Families: ${ctx.facts.design.webfonts.join(', ')}` : '', p.fonts && p.fonts.preloaded ? `${plural(p.fonts.preloaded, 'font')} preloaded` : ''] });
  }

  if (p.dom) {
    add({ id: 'perf.dom', cat, group: G.dom, title: 'DOM size', weight: 1, status: rate(p.dom.elements, 1500, 3000), value: `${p.dom.elements.toLocaleString('en-US')} elements`, metric: p.dom.elements, details: [`Max depth ${p.dom.depth}`, `Largest parent has ${p.dom.maxChildren} children${p.dom.maxChildrenEl ? ` (${p.dom.maxChildrenEl})` : ''}`] });
  }
}

function thirdPartySummary(resources) {
  const byDomain = new Map();
  let requests = 0;
  let bytes = 0;
  for (const r of resources) {
    if (!r.thirdParty) continue;
    requests++;
    bytes += r.size;
    const domain = registrableDomain(r.host);
    const d = byDomain.get(domain) || { domain, entity: r.entity, category: r.category, requests: 0, bytes: 0 };
    d.requests++;
    d.bytes += r.size;
    if (!d.entity && r.entity) {
      d.entity = r.entity;
      d.category = r.category;
    }
    byDomain.set(domain, d);
  }
  return { requests, bytes, domains: Array.from(byDomain.values()).sort((a, b) => b.requests - a.requests || b.bytes - a.bytes) };
}

// ---------------------------------------------------------------- SEO

function auditSeo(ctx, add) {
  const s = ctx.facts.seo;
  const cat = 'seo';
  const G = { content: 'Content', index: 'Indexing & crawling', basics: 'Mobile & markup', social: 'Social & rich results' };
  if (!s) return;

  const status = (ctx.doc && ctx.doc.status) || (ctx.facts.perf && ctx.facts.perf.nav && ctx.facts.perf.nav.status) || 0;
  if (status) {
    add({ id: 'seo.status', cat, group: G.index, title: 'HTTP status', weight: 3, status: status >= 400 ? 'fail' : 'pass', value: status >= 400 ? `The page returned HTTP ${status}` : `HTTP ${status}` });
  }

  {
    const t = (s.title || '').trim();
    const len = t.length;
    add({
      id: 'seo.title', cat, group: G.content, title: 'Title tag', weight: 3,
      status: !len ? 'fail' : len < 15 || len > 60 ? 'warn' : 'pass',
      value: !len ? 'Missing' : `“${truncate(t, 70)}” (${len} chars${len > 60 ? ', may be truncated' : len < 15 ? ', too short' : ''})`,
      details: [s.titleCount > 1 ? `${s.titleCount} <title> tags found; keep one.` : ''],
    });
  }

  {
    const d = (s.description || '').trim();
    const len = d.length;
    add({
      id: 'seo.description', cat, group: G.content, title: 'Meta description', weight: 2,
      status: !len ? 'fail' : len < 50 || len > 160 ? 'warn' : 'pass',
      value: !len ? 'Missing' : `${len} chars${len > 160 ? ', may be truncated' : len < 50 ? ', too short' : ''}`,
      details: [d ? truncate(d, 200) : '', s.descriptionCount > 1 ? `${s.descriptionCount} description tags found; keep one.` : ''],
    });
  }

  {
    const h1 = s.h1 || { count: 0, texts: [] };
    add({
      id: 'seo.h1', cat, group: G.content, title: 'H1 heading', weight: 2,
      status: h1.count === 0 ? 'fail' : h1.count > 1 ? 'warn' : 'pass',
      value: h1.count === 0 ? 'No <h1> on the page' : h1.count > 1 ? `${h1.count} <h1> headings` : `“${truncate(h1.texts[0] || '', 70)}”`,
      details: h1.count > 1 ? h1.texts.map((t) => `“${t}”`) : [],
      highlight: h1.flag && h1.flag.key,
    });
  }

  {
    const skips = (s.headings && s.headings.skips) || { count: 0 };
    add({ id: 'seo.headings', cat, group: G.content, title: 'Heading hierarchy', weight: 1, status: skips.count ? 'warn' : 'pass', value: skips.count ? `${plural(skips.count, 'heading skips', 'headings skip')} a level` : `${plural(((s.headings && s.headings.outline) || []).length, 'heading')} in logical order`, samples: skips.samples, highlight: skips.key });
  }

  add({ id: 'seo.words', cat, group: G.content, title: 'Content length', weight: 1, status: s.words < 200 ? 'warn' : 'pass', value: `${(s.words || 0).toLocaleString('en-US')} words${s.words < 200 ? ' (thin content)' : ''}` });

  {
    const header = (ctx.idx['x-robots-tag'] || []).join(', ');
    const directives = [...(s.robots || []), header].join(', ').toLowerCase();
    const noindex = /\bnoindex\b|\bnone\b/.test(directives);
    const nofollow = /\bnofollow\b/.test(directives);
    add({
      id: 'seo.indexable', cat, group: G.index, title: 'Indexability', weight: 3,
      status: noindex ? 'fail' : nofollow ? 'warn' : 'pass',
      value: noindex ? 'Blocked from search results (noindex)' : nofollow ? 'Links are not followed (nofollow)' : 'Page can be indexed',
      details: [s.robots && s.robots.length ? `Meta robots: ${s.robots.join(' | ')}` : '', header ? `X-Robots-Tag: ${header}` : ''],
    });
  }

  {
    const c = s.canonical || { count: 0 };
    const norm = (u) => String(u || '').split('#')[0].replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
    let v;
    if (!c.count) v = { status: 'warn', value: 'Missing' };
    else if (c.count > 1) v = { status: 'fail', value: `${c.count} canonical tags (search engines may ignore them)` };
    else if (c.raw && !/^https?:\/\//i.test(c.raw)) v = { status: 'warn', value: `Relative URL "${truncate(c.raw, 50)}" (use an absolute URL)` };
    else if (norm(c.href) !== norm(s.url && s.url.href)) v = { status: 'info', value: `Points to another URL: ${shortUrl(c.href, 60)}` };
    else v = { status: 'pass', value: 'Self-referencing' };
    add({ id: 'seo.canonical', cat, group: G.index, title: 'Canonical URL', weight: 2, ...v });
  }

  if (s.hreflang && s.hreflang.length) {
    const invalid = s.hreflang.filter((h) => !/^(?:x-default|[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?)$/i.test(h.lang || ''));
    const xDefault = s.hreflang.some((h) => /^x-default$/i.test(h.lang));
    add({ id: 'seo.hreflang', cat, group: G.index, title: 'hreflang', weight: 1, status: invalid.length ? 'warn' : 'pass', value: `${plural(s.hreflang.length, 'alternate')}${xDefault ? ' incl. x-default' : ''}${invalid.length ? `, ${invalid.length} invalid` : ''}`, details: invalid.map((h) => `Invalid code "${h.lang}"`) });
  }

  if (s.metaRefresh) add({ id: 'seo.metaRefresh', cat, group: G.index, title: 'Meta refresh', weight: 1, status: 'warn', value: `<meta http-equiv="refresh" content="${truncate(s.metaRefresh, 40)}">` });

  {
    const vp = s.viewport || '';
    add({ id: 'seo.viewport', cat, group: G.basics, title: 'Mobile viewport', weight: 2, status: !vp ? 'fail' : /width\s*=\s*device-width/i.test(vp) ? 'pass' : 'warn', value: vp ? truncate(vp, 70) : 'No viewport meta tag: the page will render zoomed-out on phones' });
  }

  {
    const ct = first(ctx.idx, 'content-type') || '';
    const declared = s.charsetDeclared || /charset=/i.test(ct);
    const utf8 = /^utf-?8$/i.test(s.charset || '');
    add({ id: 'seo.charset', cat, group: G.basics, title: 'Character encoding', weight: 1, status: declared && utf8 ? 'pass' : 'warn', value: `${s.charset || 'unknown'}${declared ? '' : ' (not declared)'}` });
  }

  add({ id: 'seo.doctype', cat, group: G.basics, title: 'Doctype', weight: 1, status: !s.doctype || s.quirksMode ? 'warn' : 'pass', value: !s.doctype ? 'Missing: page renders in quirks mode' : s.quirksMode ? 'Quirks mode' : '<!DOCTYPE html>' });
  add({ id: 'seo.favicon', cat, group: G.basics, title: 'Favicon', weight: 1, status: s.favicon ? 'pass' : 'warn', value: s.favicon ? `Declared${s.appleTouchIcon ? ' (+ apple-touch-icon)' : ''}` : 'No <link rel="icon"> (browsers fall back to /favicon.ico)' });

  {
    const u = s.url || {};
    const issues = [u.length > 115 ? `Long URL (${u.length} chars)` : '', u.pathHasUppercase ? 'Uppercase letters in path' : '', u.pathHasUnderscore ? 'Underscores in path (hyphens are preferred)' : '', u.params > 3 ? `${u.params} query parameters` : ''].filter(Boolean);
    add({ id: 'seo.url', cat, group: G.basics, title: 'URL structure', weight: 1, status: issues.length ? 'warn' : 'pass', value: issues.length ? issues[0] : 'Clean, readable URL', details: issues.slice(1) });
  }

  {
    const og = s.og || {};
    const core = ['title', 'description', 'image', 'url'];
    const present = core.filter((k) => og[k]);
    add({ id: 'seo.og', cat, group: G.social, title: 'Open Graph', weight: 1, status: present.length === 4 ? 'pass' : present.length ? 'warn' : 'fail', value: present.length === 4 ? 'Complete (title, description, image, url)' : present.length ? `Missing og:${core.filter((k) => !og[k]).join(', og:')}` : 'No Open Graph tags: shared links get no preview', details: og.image ? [`Image: ${shortUrl(og.image, 80)}`] : [] });
  }

  add({ id: 'seo.twitter', cat, group: G.social, title: 'X / Twitter card', status: s.twitter && s.twitter.card ? 'pass' : 'info', value: s.twitter && s.twitter.card ? `twitter:card = ${s.twitter.card}` : 'Not set (X falls back to Open Graph)' });

  {
    const j = s.jsonld || { count: 0, types: [], errors: [] };
    let v;
    if (j.errors.length) v = { status: 'fail', weight: 2, value: `${plural(j.errors.length, 'JSON-LD block')} fail to parse`, details: j.errors };
    else if (j.count || s.microdata) v = { status: 'pass', weight: 1, value: j.types.length ? `Types: ${truncate(j.types.join(', '), 80)}` : `${s.microdata} microdata items` };
    else v = { status: 'info', value: 'None. Schema.org markup enables rich results.' };
    add({ id: 'seo.structured', cat, group: G.social, title: 'Structured data', ...v });
  }

  {
    const l = s.links || {};
    const counts = `${l.internal || 0} internal · ${l.external || 0} external${l.nofollow ? ` · ${l.nofollow} nofollow` : ''}`;
    add({ id: 'seo.links', cat, group: G.content, title: 'Links', weight: 1, status: l.jsHref ? 'warn' : 'pass', value: l.jsHref ? `${plural(l.jsHref, 'javascript: link')} can’t be crawled` : counts, details: l.jsHref ? [counts] : [] });
  }
}

// ---------------------------------------------------------------- accessibility

function auditAccessibility(ctx, add) {
  const a = ctx.facts.a11y;
  const cat = 'accessibility';
  const G = { media: 'Images & media', forms: 'Forms & controls', structure: 'Structure', visual: 'Visual' };
  if (!a) return;
  const c = (f) => (f && f.count) || 0;
  const withFlag = (f) => ({ samples: f && f.samples, highlight: f && f.key });

  add({ id: 'a11y.imgAlt', cat, group: G.media, title: 'Image alt text', weight: 3, status: c(a.images && a.images.missingAlt) ? 'fail' : 'pass', value: c(a.images && a.images.missingAlt) ? `${plural(c(a.images.missingAlt), 'image')} without alt text` : `${plural((a.images && a.images.total) || 0, 'image')}, all described or decorative`, ...withFlag(a.images && a.images.missingAlt) });
  add({ id: 'a11y.contrast', cat, group: G.visual, title: 'Color contrast', weight: 3, status: c(a.contrast && a.contrast.failing) === 0 ? 'pass' : c(a.contrast.failing) <= 3 ? 'warn' : 'fail', value: c(a.contrast && a.contrast.failing) ? `${c(a.contrast.failing)} of ${a.contrast.checked} text elements below WCAG AA` : `${(a.contrast && a.contrast.checked) || 0} text elements pass WCAG AA`, details: a.contrast && a.contrast.skipped ? [`${a.contrast.skipped} elements over images or gradients were skipped.`] : [], ...withFlag(a.contrast && a.contrast.failing) });
  add({ id: 'a11y.zoom', cat, group: G.visual, title: 'Zoom allowed', weight: 2, status: a.zoomBlocked ? 'fail' : 'pass', value: a.zoomBlocked ? 'The viewport blocks pinch-zoom' : 'Users can zoom', details: a.zoomBlocked ? [a.viewport] : [] });

  add({ id: 'a11y.labels', cat, group: G.forms, title: 'Form labels', weight: 3, status: c(a.fields && a.fields.unlabeled) ? 'fail' : 'pass', value: c(a.fields && a.fields.unlabeled) ? `${plural(c(a.fields.unlabeled), 'field')} without a label` : a.fields && a.fields.total ? `${plural(a.fields.total, 'field')} labelled` : 'No form fields', details: a.fields && a.fields.placeholderOnly ? [`${plural(a.fields.placeholderOnly, 'field relies', 'fields rely')} on placeholder text as the only label.`] : [], ...withFlag(a.fields && a.fields.unlabeled) });
  add({ id: 'a11y.buttons', cat, group: G.forms, title: 'Button names', weight: 3, status: c(a.buttons && a.buttons.unnamed) ? 'fail' : 'pass', value: c(a.buttons && a.buttons.unnamed) ? `${plural(c(a.buttons.unnamed), 'button')} without an accessible name` : `${plural((a.buttons && a.buttons.total) || 0, 'button')} named`, ...withFlag(a.buttons && a.buttons.unnamed) });
  add({ id: 'a11y.links', cat, group: G.forms, title: 'Link names', weight: 2, status: c(a.links && a.links.unnamed) ? 'fail' : 'pass', value: c(a.links && a.links.unnamed) ? `${plural(c(a.links.unnamed), 'link')} without discernible text` : `${plural((a.links && a.links.total) || 0, 'link')} named`, ...withFlag(a.links && a.links.unnamed) });
  add({ id: 'a11y.ariaHidden', cat, group: G.forms, title: 'Focusable hidden content', weight: 2, status: c(a.hiddenFocusable) ? 'fail' : 'pass', value: c(a.hiddenFocusable) ? `${plural(c(a.hiddenFocusable), 'aria-hidden region')} contains focusable elements` : 'No focusable elements inside aria-hidden', ...withFlag(a.hiddenFocusable) });
  add({ id: 'a11y.tabindex', cat, group: G.forms, title: 'Tab order', weight: 1, status: c(a.positiveTabindex) ? 'warn' : 'pass', value: c(a.positiveTabindex) ? `${plural(c(a.positiveTabindex), 'element')} with tabindex > 0` : 'Natural tab order', ...withFlag(a.positiveTabindex) });

  {
    const lang = a.lang || '';
    const valid = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang);
    add({ id: 'a11y.lang', cat, group: G.structure, title: 'Page language', weight: 2, status: !lang ? 'fail' : valid ? 'pass' : 'warn', value: !lang ? '<html> has no lang attribute' : valid ? `lang="${lang}"` : `Invalid lang "${truncate(lang, 20)}"` });
  }
  add({ id: 'a11y.title', cat, group: G.structure, title: 'Document title', weight: 2, status: a.title ? 'pass' : 'fail', value: a.title ? 'Present' : 'Missing' });

  {
    const skips = (ctx.facts.seo && ctx.facts.seo.headings && ctx.facts.seo.headings.skips) || { count: 0 };
    const empty = (ctx.facts.seo && ctx.facts.seo.headings && ctx.facts.seo.headings.empty) || { count: 0 };
    add({ id: 'a11y.headings', cat, group: G.structure, title: 'Headings', weight: 1, status: skips.count || empty.count ? 'warn' : 'pass', value: skips.count || empty.count ? [skips.count ? `${plural(skips.count, 'skipped level')}` : '', empty.count ? `${plural(empty.count, 'empty heading')}` : ''].filter(Boolean).join(', ') : 'Headings are well structured', samples: [...(skips.samples || []), ...(empty.samples || [])], highlight: skips.key || empty.key });
  }

  {
    const l = a.landmarks || {};
    add({ id: 'a11y.landmarks', cat, group: G.structure, title: 'Landmarks', weight: 1, status: l.main ? 'pass' : 'warn', value: l.main ? `main · ${l.nav || 0} nav · ${l.banner || 0} header · ${l.contentinfo || 0} footer` : 'No <main> landmark for screen-reader navigation' });
  }
  add({ id: 'a11y.skipLink', cat, group: G.structure, title: 'Skip link', status: a.skipLink ? 'pass' : 'info', value: a.skipLink ? 'Present' : 'No “skip to content” link found' });
  add({ id: 'a11y.dupIds', cat, group: G.structure, title: 'Unique IDs', weight: 1, status: a.duplicateIds && a.duplicateIds.count ? 'warn' : 'pass', value: a.duplicateIds && a.duplicateIds.count ? `${plural(a.duplicateIds.count, 'ID is', 'IDs are')} used more than once` : 'All IDs are unique', details: (a.duplicateIds && a.duplicateIds.ids) || [], highlight: a.duplicateIds && a.duplicateIds.flag && a.duplicateIds.flag.key });

  {
    const roles = c(a.badRoles);
    const refs = c(a.brokenRefs);
    add({ id: 'a11y.aria', cat, group: G.structure, title: 'ARIA usage', weight: 1, status: roles || refs ? 'warn' : 'pass', value: roles || refs ? [roles ? `${plural(roles, 'invalid role')}` : '', refs ? `${plural(refs, 'broken aria reference')}` : ''].filter(Boolean).join(', ') : 'Roles and references are valid', samples: [...((a.badRoles && a.badRoles.samples) || []), ...((a.brokenRefs && a.brokenRefs.samples) || [])], highlight: (a.badRoles && a.badRoles.key) || (a.brokenRefs && a.brokenRefs.key) });
  }

  add({ id: 'a11y.iframeTitle', cat, group: G.media, title: 'Frame titles', weight: 1, status: c(a.iframesUntitled) ? 'warn' : 'pass', value: c(a.iframesUntitled) ? `${plural(c(a.iframesUntitled), 'iframe')} without a title` : 'Frames are titled (or none present)', ...withFlag(a.iframesUntitled) });
  add({ id: 'a11y.autoplay', cat, group: G.media, title: 'Autoplaying media', weight: 1, status: c(a.autoplay) ? 'warn' : 'pass', value: c(a.autoplay) ? `${plural(c(a.autoplay), 'media element')} autoplay with sound` : 'No media autoplays with sound', ...withFlag(a.autoplay) });
}

// ---------------------------------------------------------------- privacy

function auditPrivacy(ctx, add) {
  const cat = 'privacy';
  const G = { tracking: 'Tracking', third: 'Third parties', storage: 'Storage' };
  const pv = ctx.facts.privacy || {};
  const trackers = ctx.stack.filter((t) => t.tracker && !t.friendly);
  const replay = trackers.filter((t) => t.tracker === 'replay');
  const fingerprint = trackers.filter((t) => t.tracker === 'fingerprinting');
  const trackingDomains = Array.from(new Set(ctx.resources.filter((r) => r.thirdParty && TRACKING_CATEGORIES.has(r.category)).map((r) => registrableDomain(r.host))));

  add({
    id: 'priv.trackers', cat, group: G.tracking, title: 'Trackers', weight: 2,
    status: trackers.length === 0 ? 'pass' : trackers.length <= 4 ? 'warn' : 'fail',
    value: trackers.length ? `${plural(trackers.length, 'tracking tool')} and ${plural(trackingDomains.length, 'tracking domain')}` : 'No known trackers detected',
    details: [...trackers.map((t) => `${t.name} (${CATEGORY_NAMES[t.tracker] || t.tracker})`), trackingDomains.length ? `Domains: ${trackingDomains.slice(0, 15).join(', ')}` : ''],
  });

  add({ id: 'priv.replay', cat, group: G.tracking, title: 'Session recording', weight: 2, status: replay.length ? 'warn' : 'pass', value: replay.length ? `${replay.map((t) => t.name).join(', ')} can record clicks, scrolls and typing` : 'No session-replay tools detected' });

  add({ id: 'priv.fingerprint', cat, group: G.tracking, title: 'Browser fingerprinting', weight: 2, status: fingerprint.length ? 'fail' : 'pass', value: fingerprint.length ? `${fingerprint.map((t) => t.name).join(', ')} identifies browsers without cookies` : 'No fingerprinting libraries detected' });

  {
    const cmp = ctx.stack.filter((t) => t.cat === 'consent');
    add({
      id: 'priv.consent', cat, group: G.tracking, title: 'Consent management', weight: 1,
      status: cmp.length || !trackers.length ? 'pass' : 'warn',
      value: cmp.length ? `Consent manager: ${cmp.map((t) => t.name).join(', ')}` : trackers.length ? 'Tracking without a detected consent manager' : 'Not needed: no trackers found',
    });
  }

  {
    const tp = thirdPartySummary(ctx.resources);
    add({ id: 'priv.thirdParty', cat, group: G.third, title: 'Third-party domains', weight: 1, status: rate(tp.domains.length, 5, 15), value: tp.domains.length ? `Your visit is shared with ${plural(tp.domains.length, 'other domain')}` : 'No third-party requests', details: tp.domains.slice(0, 15).map((d) => `${d.domain}${d.entity ? ` · ${d.entity}` : ''}${d.category ? ` · ${CATEGORY_NAMES[d.category] || d.category}` : ''}`) });
  }

  {
    const e = pv.embeds || {};
    const tracking = (e.youtube || 0) + (e.facebook || 0);
    const any = Object.values(e).reduce((n, v) => n + (v || 0), 0);
    if (any) {
      add({ id: 'priv.embeds', cat, group: G.third, title: 'Embedded media', weight: 1, status: tracking ? 'warn' : 'pass', value: tracking ? `${plural(tracking, 'embed')} set tracking cookies on load` : 'Embeds use privacy-friendly modes', details: [e.youtube ? `${e.youtube} YouTube embed(s): use youtube-nocookie.com` : '', e.facebook ? `${e.facebook} Facebook plugin(s)` : '', e.youtubeNoCookie ? `${e.youtubeNoCookie} youtube-nocookie embed(s)` : ''], samples: pv.trackingEmbeds && pv.trackingEmbeds.samples, highlight: pv.trackingEmbeds && pv.trackingEmbeds.key });
    }
  }

  if (ctx.stack.some((t) => t.name === 'Google Fonts')) {
    add({ id: 'priv.fonts', cat, group: G.third, title: 'Externally hosted fonts', status: 'info', value: 'Google Fonts are loaded from Google servers; self-hosting avoids sharing visitor IPs' });
  }

  add({ id: 'priv.storage', cat, group: G.storage, title: 'Client-side storage', status: 'info', value: `${plural((pv.cookies || []).length, 'script-readable cookie')} · ${(pv.storage && pv.storage.local) || 0} localStorage · ${(pv.storage && pv.storage.session) || 0} sessionStorage keys`, details: (pv.cookies || []).length ? [`Cookies: ${pv.cookies.slice(0, 25).join(', ')}`] : [] });
}

// ---------------------------------------------------------------- insights

function buildInsights(ctx) {
  const { facts, idx, doc, resources } = ctx;
  const p = facts.perf || {};
  const nav = p.nav || {};
  const s = facts.seo || {};

  const types = RESOURCE_TYPES.map(([type, label]) => {
    const items = resources.filter((r) => r.type === type);
    return { type, label, count: items.length, bytes: items.reduce((n, r) => n + r.size, 0) };
  }).filter((t) => t.count);

  const { cookies } = auditCookies(idx['set-cookie'] || [], { https: ctx.https });

  return {
    page: {
      status: (doc && doc.status) || nav.status || null,
      ip: doc ? doc.ip : null,
      server: first(idx, 'server'),
      protocol: nav.protocol || '',
      fromCache: doc ? doc.fromCache : false,
      headersCaptured: !!doc,
      headersStale: !!(doc && doc.stale),
    },
    vitals: {
      lcp: p.lcp ? p.lcp.time : null,
      cls: p.cls ? p.cls.value : null,
      inp: p.inp ? p.inp.value : null,
      fcp: Number.isFinite(p.fcp) ? p.fcp : null,
      ttfb: Number.isFinite(nav.ttfb) ? nav.ttfb : null,
      tbt: p.blocking ? p.blocking.total : null,
    },
    resourceTypes: types,
    totals: {
      requests: (p.resourceCount || resources.length) + 1,
      bytes: resources.reduce((n, r) => n + r.size, 0) + (nav.encodedBodySize || nav.transferSize || 0),
      domElements: p.dom ? p.dom.elements : null,
    },
    thirdParties: thirdPartySummary(resources).domains.slice(0, 25),
    largest: resources.slice().sort((a, b) => b.size - a.size).slice(0, 10).filter((r) => r.size > 0).map((r) => ({ url: r.u, type: r.type, bytes: r.size, thirdParty: r.thirdParty })),
    blockingScripts: (p.blocking && p.blocking.scripts) || [],
    headers: doc ? doc.headers : [],
    redirects: doc ? doc.redirects || [] : [],
    cookies,
    seo: {
      title: s.title || '',
      description: s.description || '',
      url: (s.url && s.url.href) || (facts.page && facts.page.url) || '',
      og: s.og || {},
      twitter: s.twitter || {},
      outline: (s.headings && s.headings.outline) || [],
      jsonldTypes: (s.jsonld && s.jsonld.types) || [],
      hreflang: s.hreflang || [],
    },
    design: facts.design || null,
    tagIds: (facts.signals && facts.signals.ids) || {},
    sameOriginScripts: ((facts.signals && facts.signals.scripts) || []).filter((u) => hostOf(u) === ctx.pageHost).slice(0, 40),
  };
}
