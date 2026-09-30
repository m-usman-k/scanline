// Small, dependency-free helpers shared by the popup, report page and tests.

export const EXT_VERSION = '2.1.0';
export const RESULT_SCHEMA = 2;

export function parseVersion(input) {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec(String(input ?? '').trim());
  if (!m) return null;
  return { nums: m[1].split('.').map(Number), pre: m[2] || '' };
}

/** Compare two dotted versions. Returns -1, 0 or 1 (NaN if either is unparsable). */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return NaN;
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  return 0;
}

/** True when `version` falls inside [atOrAbove, below). Missing bounds are open. */
export function inRange(version, { atOrAbove, below } = {}) {
  if (!parseVersion(version)) return false;
  if (atOrAbove && compareVersions(version, atOrAbove) < 0) return false;
  if (below && compareVersions(version, below) >= 0) return false;
  return true;
}

/** Extract a clean leading version (e.g. "3.5.1 -ajax" -> "3.5.1"). */
export function cleanVersion(value) {
  const m = /v?(\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.]+)?)/.exec(String(value ?? ''));
  return m ? m[1] : null;
}

// Suffixes under which each label is its own site. Not the full Public Suffix List, but it covers
// the common country-code second levels and hosting platforms so third-party grouping is sensible.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr', 'go.kr',
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.hk', 'org.hk', 'com.tw', 'org.tw', 'com.sg', 'edu.sg', 'gov.sg', 'com.my', 'co.id', 'or.id',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'co.za', 'org.za', 'gov.za', 'com.mx', 'org.mx', 'gob.mx',
  'com.ar', 'gob.ar', 'com.co', 'gov.co', 'com.tr', 'gov.tr', 'com.pk', 'gov.pk', 'com.sa', 'gov.sa',
  'com.eg', 'com.ng', 'gov.ng', 'co.il', 'org.il', 'ac.il', 'co.th', 'in.th', 'ac.th', 'com.vn', 'com.ph',
  'com.ua', 'co.ke', 'com.pl', 'com.ru', 'com.es', 'co.at', 'or.at', 'com.pe', 'com.ve', 'com.uy', 'com.bd',
  'com.np', 'com.lk', 'com.qa', 'com.kw', 'co.ae', 'gov.ae', 'com.gh', 'co.tz', 'co.ug', 'com.cy', 'com.mt',
  // Hosting platforms: every subdomain is a different site.
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com',
  'web.app', 'firebaseapp.com', 'azurewebsites.net', 'azurestaticapps.net', 'cloudfront.net', 'appspot.com',
  'blogspot.com', 'wordpress.com', 'myshopify.com', 'wixsite.com', 'webflow.io', 'onrender.com', 'fly.dev',
  'up.railway.app', 'glitch.me', 'replit.app', 'repl.co', 'surge.sh', 'neocities.org', 's3.amazonaws.com',
  'framer.app', 'framer.website', 'carrd.co', 'notion.site', 'substack.com', 'tumblr.com', 'bitbucket.io',
  'readthedocs.io', 'deno.dev', 'ngrok.io', 'ngrok-free.app', 'hf.space', 'streamlit.app', 'amplifyapp.com',
  'run.app', 'r2.dev', 'b-cdn.net', 'azureedge.net', 'akamaized.net', 'edgekey.net',
]);

export function registrableDomain(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host;
  const parts = host.split('.');
  for (let n = 3; n >= 2; n--) {
    if (parts.length > n && MULTI_PART_SUFFIXES.has(parts.slice(-n).join('.'))) {
      return parts.slice(-(n + 1)).join('.');
    }
  }
  return parts.slice(-2).join('.');
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function stripHash(url) {
  return String(url || '').split('#')[0];
}

export function truncate(str, max = 80) {
  str = String(str ?? '').replace(/\s+/g, ' ').trim();
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** Shorten a URL for display: drop protocol and query, keep the tail of long paths. */
export function shortUrl(url, max = 60) {
  let s = String(url || '').replace(/^https?:\/\//, '');
  const q = s.search(/[?#]/);
  if (q > 0) s = `${s.slice(0, q)}${s.length > q + 1 ? '?…' : ''}`;
  if (s.length <= max) return s;
  const slash = s.indexOf('/');
  const host = slash > 0 ? s.slice(0, slash) : s;
  const tailLen = Math.max(12, max - host.length - 2);
  return `${host}/…${s.slice(-tailLen)}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

/** Human-readable duration from seconds (e.g. 3600 -> "1 hour", 31536000 -> "365 days"). */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'n/a';
  if (seconds < 60) return plural(Math.round(seconds), 'second');
  if (seconds < 3600) return plural(Math.round(seconds / 60), 'minute');
  if (seconds < 172800) return plural(Math.round(seconds / 3600), 'hour');
  return plural(Math.round(seconds / 86400), 'day');
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function relativeTime(date, now = Date.now()) {
  const diff = Math.round((now - new Date(date).getTime()) / 1000);
  if (!Number.isFinite(diff)) return '';
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} d ago`;
  return new Date(date).toLocaleDateString();
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pages Chrome will not let extensions script. */
export function scanBlockReason(url) {
  if (!url) return 'This tab has no page to scan.';
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'This tab has no page to scan.';
  }
  if (/^(chrome|edge|brave|opera|vivaldi|about|devtools|view-source|chrome-extension|moz-extension|chrome-search|chrome-untrusted):$/.test(u.protocol)) {
    return 'Browser pages cannot be scanned. Open a website and try again.';
  }
  if (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) {
    return 'Chrome does not allow extensions to run on the Web Store.';
  }
  if (!/^(https?|file):$/.test(u.protocol)) return `Scanline cannot scan ${u.protocol} pages.`;
  return null;
}
