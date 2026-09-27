// Optional "site files" deep scan. This is the only feature that makes network requests, and only
// to the audited site itself, only when the user clicks: robots.txt, sitemap, security.txt,
// llms.txt and the site's own JavaScript bundles (read from the HTTP cache when possible).

import { scanTextForSecrets } from './secrets.js';
import { secretsCheck } from './audit.js';
import { originOf, plural, formatBytes, shortUrl } from './util.js';

export const AI_CRAWLERS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'Google-Extended', 'CCBot', 'PerplexityBot', 'Bytespider', 'Applebot-Extended', 'Meta-ExternalAgent', 'Amazonbot', 'cohere-ai'];

async function fetchText(url, { maxBytes = 512 * 1024, cache = 'no-cache', timeout = 8000, method = 'GET' } = {}) {
  const res = await fetch(url, { method, credentials: 'omit', redirect: 'follow', cache, signal: AbortSignal.timeout(timeout) });
  let text = '';
  if (res.ok && method === 'GET') text = (await res.text()).slice(0, maxBytes);
  return { ok: res.ok, status: res.status, url: res.url, type: res.headers.get('content-type') || '', text };
}

// ---------------------------------------------------------------- robots.txt

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', path: val });
    } else if (key === 'sitemap') {
      sitemaps.push(val);
    }
  }
  return { groups, sitemaps };
}

function groupFor(robots, agent) {
  const a = agent.toLowerCase();
  return robots.groups.find((g) => g.agents.includes(a)) || robots.groups.find((g) => g.agents.includes('*')) || null;
}

function patternToRegex(pattern) {
  let p = pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  p = p.replace(/\$/g, '\\$');
  return new RegExp(`^${p}${anchored ? '$' : ''}`);
}

/** Google-style matching: the longest matching rule wins, Allow wins ties. */
export function isAllowed(robots, agent, path) {
  const g = groupFor(robots, agent);
  if (!g) return true;
  let best = null;
  for (const r of g.rules) {
    if (!r.path) continue;
    if (!patternToRegex(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

/** Crawlers with their own group that blocks the whole site. */
export function blockedAiCrawlers(robots) {
  return AI_CRAWLERS.filter((bot) => {
    const g = robots.groups.find((x) => x.agents.includes(bot.toLowerCase()));
    return g ? !isAllowed({ groups: [g] }, bot, '/') : false;
  });
}

// ---------------------------------------------------------------- run

export async function deepScan(result, { onProgress = () => {} } = {}) {
  const origin = originOf(result.url);
  const u = new URL(result.url);
  const path = u.pathname + u.search;
  const checks = [];
  const info = {};
  const SITE = 'Site files';

  // robots.txt
  onProgress('robots.txt');
  let robots = null;
  try {
    const r = await fetchText(`${origin}/robots.txt`);
    info.robots = { status: r.status };
    if (r.ok && !/text\/html/i.test(r.type)) {
      robots = parseRobots(r.text);
      info.robots.sitemaps = robots.sitemaps;
      info.robots.size = r.text.length;
    }
    if (r.status >= 500) {
      checks.push({ id: 'seo.robotsTxt', cat: 'seo', group: SITE, title: 'robots.txt', weight: 2, status: 'fail', value: `robots.txt returns HTTP ${r.status}; Google pauses crawling on server errors` });
    } else if (!robots) {
      checks.push({ id: 'seo.robotsTxt', cat: 'seo', group: SITE, title: 'robots.txt', status: 'info', value: 'No robots.txt (everything may be crawled)' });
    } else {
      const googleOk = isAllowed(robots, 'Googlebot', path);
      const siteOk = isAllowed(robots, '*', '/');
      checks.push({
        id: 'seo.robotsTxt', cat: 'seo', group: SITE, title: 'robots.txt', weight: 3,
        status: !googleOk ? 'fail' : !siteOk ? 'warn' : 'pass',
        value: !googleOk ? 'This page is disallowed for Googlebot' : !siteOk ? 'The site root is disallowed for generic crawlers' : `Crawling allowed${robots.sitemaps.length ? ` · ${plural(robots.sitemaps.length, 'sitemap')} listed` : ''}`,
        details: [`${plural(robots.groups.length, 'user-agent group')}`, ...robots.sitemaps.slice(0, 3).map((s) => `Sitemap: ${s}`)],
      });
      const blocked = blockedAiCrawlers(robots);
      checks.push({ id: 'seo.aiCrawlers', cat: 'seo', group: SITE, title: 'AI crawlers', status: 'info', value: blocked.length ? `Blocks ${blocked.length} of ${AI_CRAWLERS.length} known AI crawlers` : 'No AI crawler is blocked explicitly', details: blocked.length ? [`Blocked: ${blocked.join(', ')}`] : [] });
    }
  } catch (e) {
    info.robots = { error: String(e.message || e) };
  }

  // Sitemap
  onProgress('sitemap');
  const sitemapUrls = robots && robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [`${origin}/sitemap.xml`];
  let sitemapFound = null;
  for (const url of sitemapUrls) {
    try {
      const r = await fetchText(url, { maxBytes: 5 * 1024 * 1024 });
      if (r.ok && /<(?:urlset|sitemapindex)\b/i.test(r.text)) {
        const isIndex = /<sitemapindex\b/i.test(r.text);
        sitemapFound = { url, isIndex, count: (r.text.match(/<loc>/gi) || []).length };
        break;
      }
    } catch { /* try next */ }
  }
  info.sitemap = sitemapFound;
  checks.push({
    id: 'seo.sitemap', cat: 'seo', group: SITE, title: 'XML sitemap', weight: 1,
    status: sitemapFound ? 'pass' : 'warn',
    value: sitemapFound ? `${sitemapFound.isIndex ? 'Sitemap index with ' : ''}${plural(sitemapFound.count, sitemapFound.isIndex ? 'sitemap' : 'URL')}` : 'No sitemap found',
    details: sitemapFound ? [shortUrl(sitemapFound.url, 90)] : [`Tried ${sitemapUrls.map((x) => shortUrl(x, 60)).join(', ')}`],
  });

  // llms.txt
  try {
    const r = await fetchText(`${origin}/llms.txt`, { maxBytes: 64 * 1024 });
    const ok = r.ok && !/text\/html/i.test(r.type) && r.text.trim().length > 0;
    checks.push({ id: 'seo.llms', cat: 'seo', group: SITE, title: 'llms.txt', status: ok ? 'pass' : 'info', value: ok ? `Published (${formatBytes(r.text.length)})` : 'Not published (optional)' });
  } catch { /* ignore */ }

  // security.txt
  onProgress('security.txt');
  try {
    const r = await fetchText(`${origin}/.well-known/security.txt`, { maxBytes: 64 * 1024 });
    const ok = r.ok && /^\s*contact\s*:/im.test(r.text);
    const expires = /^\s*expires\s*:\s*(.+)$/im.exec(r.text || '');
    const expired = expires && new Date(expires[1].trim()) < new Date();
    checks.push({
      id: 'sec.securityTxt', cat: 'security', group: SITE, title: 'security.txt', weight: 1,
      status: ok ? (expired ? 'warn' : 'pass') : 'info',
      value: ok ? (expired ? `Expired on ${expires[1].trim()}` : 'Vulnerability disclosure contact published') : 'Not published',
      details: ok ? (r.text.match(/^\s*(?:contact|policy|expires)\s*:.*$/gim) || []).slice(0, 4).map((l) => l.trim()) : [],
    });
  } catch { /* ignore */ }

  // First-party JavaScript bundles
  const scripts = (result.insights && result.insights.sameOriginScripts) || [];
  if (scripts.length) {
    const findings = [];
    const seen = new Set();
    const maps = [];
    let bytes = 0;
    let scanned = 0;
    for (const url of scripts.slice(0, 25)) {
      if (bytes > 15 * 1024 * 1024) break;
      onProgress(`bundle ${scanned + 1}/${Math.min(scripts.length, 25)}`);
      try {
        const r = await fetchText(url, { maxBytes: 6 * 1024 * 1024, cache: 'force-cache', timeout: 10000 });
        if (!r.ok) continue;
        scanned++;
        bytes += r.text.length;
        findings.push(...scanTextForSecrets(r.text, shortUrl(url, 60), seen));
        const m = /[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/.exec(r.text.slice(-400));
        if (m && !m[1].startsWith('data:')) maps.push(new URL(m[1], url).href);
      } catch { /* ignore */ }
    }
    info.bundles = { scanned, bytes };
    checks.push({ ...secretsCheck('sec.bundleSecrets', 'Secrets in JavaScript bundles', findings, `in ${plural(scanned, 'bundle')}`), group: SITE });

    if (maps.length) {
      let publicMap = false;
      try {
        const head = await fetchText(maps[0], { method: 'HEAD', timeout: 6000 });
        publicMap = head.ok;
      } catch { /* ignore */ }
      checks.push({
        id: 'sec.sourceMaps', cat: 'security', group: SITE, title: 'Public source maps', weight: 1,
        status: publicMap ? 'warn' : 'info',
        value: publicMap ? 'Source maps are publicly downloadable' : `${plural(maps.length, 'bundle references', 'bundles reference')} source maps`,
        details: maps.slice(0, 5).map((m) => shortUrl(m, 90)),
      });
    }
  }

  return { ranAt: new Date().toISOString(), checks, info };
}
