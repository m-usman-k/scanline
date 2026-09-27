// Parsing and evaluation of HTTP response headers captured by the service worker.

export function headerIndex(headers) {
  const idx = {};
  for (const [name, value] of headers || []) {
    const key = String(name).toLowerCase();
    (idx[key] = idx[key] || []).push(String(value ?? ''));
  }
  return idx;
}

export const first = (idx, name) => (idx[name] && idx[name].length ? idx[name][0] : null);

// ---------------------------------------------------------------- CSP

/** Parse one or more serialized policies (comma separated) into [{ directive: [sources] }]. */
export function parseCsp(value) {
  return String(value || '')
    .split(',')
    .map((policy) => {
      const directives = {};
      for (const part of policy.split(';')) {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) continue;
        const name = tokens[0].toLowerCase();
        if (!(name in directives)) directives[name] = tokens.slice(1);
      }
      return directives;
    })
    .filter((d) => Object.keys(d).length);
}

const PUBLIC_CDN_HOSTS = /(?:^|\/\/|\.)(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|ajax\.googleapis\.com|raw\.githubusercontent\.com|cdn\.rawgit\.com|esm\.sh|cdn\.skypack\.dev)(?:$|\/|:)/i;

/**
 * Evaluate a single parsed policy. Returns { issues: [{ key, severity, text }], strengths: [text] }.
 * Severity: high = XSS protection defeated, medium = weakened, low = hardening gap.
 */
export function evaluatePolicy(d) {
  const issues = [];
  const strengths = [];
  const add = (key, severity, text) => issues.push({ key, severity, text });
  const lower = (arr) => (arr || []).map((s) => s.toLowerCase());

  const scriptSrc = d['script-src'] ? lower(d['script-src']) : d['default-src'] ? lower(d['default-src']) : null;
  if (!scriptSrc) {
    add('script-unrestricted', 'high', 'No script-src or default-src: scripts are not restricted at all.');
  } else {
    const nonceOrHash = scriptSrc.some((s) => /^'(?:nonce-|sha(?:256|384|512)-)/.test(s));
    const strictDynamic = scriptSrc.includes("'strict-dynamic'");
    if (scriptSrc.includes("'unsafe-inline'") && !nonceOrHash) add('script-inline', 'high', "script-src allows 'unsafe-inline', so injected inline scripts will run.");
    if (scriptSrc.includes("'unsafe-eval'")) add('script-eval', 'medium', "script-src allows 'unsafe-eval' (eval, new Function).");
    if (!strictDynamic) {
      if (scriptSrc.some((s) => s === '*' || s === 'https:' || s === 'http:' || s === 'https://*' || s === 'http://*')) add('script-wildcard', 'high', 'script-src allows scripts from any host (wildcard or bare scheme).');
      if (scriptSrc.includes('data:')) add('script-data', 'high', 'script-src allows data: URIs.');
      if (scriptSrc.some((s) => PUBLIC_CDN_HOSTS.test(s))) add('script-cdn', 'medium', 'script-src allowlists a public CDN that serves arbitrary packages (known CSP bypass).');
    }
    if (strictDynamic && nonceOrHash) strengths.push("Strict CSP: nonces/hashes with 'strict-dynamic'.");
    else if (nonceOrHash) strengths.push('Uses nonces or hashes for scripts.');
  }

  const objectSrc = d['object-src'] ? lower(d['object-src']) : d['default-src'] ? lower(d['default-src']) : null;
  if (!objectSrc || !(objectSrc.length === 1 && objectSrc[0] === "'none'")) add('object', 'medium', "object-src is not 'none' (plugin content can be used to bypass the policy).");

  if (!d['base-uri']) add('base-uri', 'low', 'base-uri is missing (an injected <base> tag could redirect relative script URLs).');
  if (!d['frame-ancestors']) add('frame-ancestors', 'low', 'frame-ancestors is missing (framing is not restricted by CSP).');
  if (d['upgrade-insecure-requests']) strengths.push('upgrade-insecure-requests is set.');
  if (d['report-uri'] || d['report-to']) strengths.push('Violation reporting is configured.');

  return { issues, strengths };
}

/**
 * Evaluate the enforced policies (header + <meta>). Every policy is enforced, so a weakness only
 * matters when no policy closes it.
 */
export function analyzeCsp({ header, meta = [] }) {
  const policies = [...parseCsp(header), ...meta.flatMap((m) => parseCsp(m))];
  if (!policies.length) return { present: false, issues: [], strengths: [], frameAncestors: null };

  const evaluated = policies.map(evaluatePolicy);
  const has = (e, key) => e.issues.some((i) => i.key === key) || (key.startsWith('script-') && e.issues.some((i) => i.key === 'script-unrestricted'));
  const keys = Array.from(new Set(evaluated.flatMap((e) => e.issues.map((i) => i.key))));
  const all = evaluated.flatMap((e) => e.issues);
  const issues = keys.filter((key) => evaluated.every((e) => has(e, key))).map((key) => all.find((i) => i.key === key));
  const fa = policies.find((p) => p['frame-ancestors']);

  return {
    present: true,
    viaMeta: !header,
    issues,
    strengths: Array.from(new Set(evaluated.flatMap((e) => e.strengths))),
    frameAncestors: fa ? fa['frame-ancestors'].join(' ') || "'none'" : null,
  };
}

// ---------------------------------------------------------------- HSTS

export function parseHsts(value) {
  if (!value) return null;
  const m = /max-age\s*=\s*"?(\d+)"?/i.exec(value);
  return {
    maxAge: m ? Number(m[1]) : null,
    includeSubDomains: /includesubdomains/i.test(value),
    preload: /\bpreload\b/i.test(value),
  };
}

// ---------------------------------------------------------------- Cookies

export function parseSetCookie(line) {
  const [nameValue, ...attrs] = String(line || '').split(';');
  const eq = nameValue.indexOf('=');
  const name = (eq >= 0 ? nameValue.slice(0, eq) : nameValue).trim();
  const out = { name, secure: false, httpOnly: false, sameSite: null, domain: null, path: null, partitioned: false, persistent: false };
  for (const attr of attrs) {
    const [k, ...rest] = attr.split('=');
    const key = k.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'secure') out.secure = true;
    else if (key === 'httponly') out.httpOnly = true;
    else if (key === 'samesite') out.sameSite = val.toLowerCase() || null;
    else if (key === 'domain') out.domain = val;
    else if (key === 'path') out.path = val;
    else if (key === 'partitioned') out.partitioned = true;
    else if (key === 'expires' || key === 'max-age') out.persistent = true;
  }
  return out;
}

const SESSION_LIKE = /sess|^sid$|[_.-]sid$|auth|token|jwt|login|remember|identity/i;
const CSRF_LIKE = /csrf|xsrf|antiforgery/i;

/** Cookies whose theft would hijack a session, so they must be HttpOnly. */
export function isSessionCookieName(name) {
  return SESSION_LIKE.test(name) && !CSRF_LIKE.test(name);
}

// Well-known server-issued session/auth cookie names. Used for cookies that JavaScript can read:
// client-side analytics IDs (e.g. "optimizelySession") are expected to be readable and are ignored.
const SERVER_SESSION = /^(?:PHPSESSID|JSESSIONID|ASP\.NET_SessionId|ASPSESSIONID\w*|\.AspNetCore\.(?:Session|Cookies)|connect\.sid|laravel_session|sessionid|session|sess|sid|_session_id|_[\w-]+_session|auth|auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|jwt|token|remember[_-]?(?:me|token)|wordpress_logged_in_\w+|wordpress_sec_\w+)$/i;

export function isServerSessionCookie(name) {
  return SERVER_SESSION.test(String(name).trim());
}

/** Audit Set-Cookie lines from the document response. */
export function auditCookies(setCookieLines, { https }) {
  const cookies = setCookieLines.flatMap((l) => String(l).split('\n')).map(parseSetCookie).filter((c) => c.name);
  const problems = [];
  for (const c of cookies) {
    const issues = [];
    const session = isSessionCookieName(c.name) || c.name.startsWith('__Host-') || c.name.startsWith('__Secure-');
    if (https && !c.secure) issues.push({ severity: session ? 'high' : 'low', text: 'missing Secure' });
    if (!c.httpOnly && session) issues.push({ severity: 'high', text: 'missing HttpOnly' });
    if (c.sameSite === 'none' && !c.secure) issues.push({ severity: 'medium', text: 'SameSite=None without Secure (rejected by browsers)' });
    if (!c.sameSite) issues.push({ severity: 'low', text: 'no SameSite attribute (browsers default to Lax)' });
    if (c.name.startsWith('__Host-') && (c.domain || c.path !== '/' || !c.secure)) issues.push({ severity: 'medium', text: '__Host- prefix requirements not met' });
    if (issues.length) problems.push({ name: c.name, session, issues });
  }
  return { cookies, problems };
}

// ---------------------------------------------------------------- Disclosure

/** Headers that reveal software versions or internal details. */
export function disclosureHeaders(idx) {
  const out = [];
  const server = first(idx, 'server');
  if (server && /\d+\.\d+/.test(server)) out.push(`server: ${server}`);
  for (const name of ['x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator', 'x-debug-token', 'x-debug-token-link', 'x-backend-server', 'sourcemap', 'x-sourcemap']) {
    const v = first(idx, name);
    if (v) out.push(`${name}: ${v}`);
  }
  return out;
}
