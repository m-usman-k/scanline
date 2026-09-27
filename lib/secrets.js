// High-precision patterns for credentials that should never ship to a browser.
// Patterns are serialized and handed to the page collector, and reused for the optional
// first-party bundle scan, so both paths share one definition.

export const SECRET_PATTERNS = [
  { id: 'aws-access-key', name: 'AWS access key ID', severity: 'high', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'stripe-secret', name: 'Stripe live secret key', severity: 'high', re: /\b[sr]k_live_[0-9A-Za-z]{20,}\b/g },
  { id: 'github-token', name: 'GitHub token', severity: 'high', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { id: 'slack-token', name: 'Slack token', severity: 'high', re: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/g },
  { id: 'slack-webhook', name: 'Slack webhook URL', severity: 'high', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g },
  { id: 'discord-webhook', name: 'Discord webhook URL', severity: 'high', re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{50,}/g },
  { id: 'private-key', name: 'Private key block', severity: 'high', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'openai-key', name: 'OpenAI API key', severity: 'high', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b/g },
  { id: 'anthropic-key', name: 'Anthropic API key', severity: 'high', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}\b/g },
  { id: 'sendgrid-key', name: 'SendGrid API key', severity: 'high', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: 'google-oauth-secret', name: 'Google OAuth client secret', severity: 'high', re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g },
  { id: 'shopify-token', name: 'Shopify access token', severity: 'high', re: /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}\b/g },
  { id: 'npm-token', name: 'npm access token', severity: 'high', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'telegram-bot', name: 'Telegram bot token', severity: 'high', re: /\b\d{8,10}:AA[0-9A-Za-z_-]{33}\b/g },
  { id: 'mapbox-secret', name: 'Mapbox secret token', severity: 'high', re: /\bsk\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
  { id: 'google-api-key', name: 'Google API key', severity: 'info', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'jwt', name: 'JSON Web Token', severity: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

export const SERIALIZED_SECRET_PATTERNS = SECRET_PATTERNS.map((p) => ({ id: p.id, source: p.re.source, flags: p.re.flags }));

const BY_ID = Object.fromEntries(SECRET_PATTERNS.map((p) => [p.id, p]));

export function maskSecret(value) {
  value = String(value);
  if (value.startsWith('-----BEGIN')) return value;
  if (value.length <= 12) return `${value.slice(0, 3)}…`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function decodeJwtClaims(token) {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const claims = JSON.parse(json);
    if (!claims || typeof claims !== 'object') return null;
    const pick = {};
    for (const k of ['role', 'iss', 'ref', 'aud', 'exp', 'sub', 'email', 'scope']) {
      if (claims[k] !== undefined) pick[k] = typeof claims[k] === 'object' ? JSON.stringify(claims[k]).slice(0, 80) : String(claims[k]).slice(0, 80);
    }
    return pick;
  } catch {
    return null;
  }
}

/** Turn a raw finding ({ id, masked, where, claims }) into a classified, human-readable finding. */
export function classifyFinding(raw) {
  const def = BY_ID[raw.id];
  if (!def) return null;
  if (def.id !== 'jwt') {
    return { ...raw, name: def.name, severity: def.severity };
  }
  const c = raw.claims || {};
  if (c.role === 'service_role') {
    return { ...raw, name: 'Supabase service_role key', severity: 'high', note: 'Bypasses row-level security. Rotate it immediately.' };
  }
  if (c.role === 'anon' && /supabase/i.test(c.iss || '')) {
    return { ...raw, name: 'Supabase anon key', severity: 'info', note: 'Public by design; make sure row-level security is enabled.' };
  }
  if (c.email || c.sub) {
    return { ...raw, name: 'User token (JWT)', severity: 'medium', note: 'Looks like a user session token embedded in the page.' };
  }
  return { ...raw, name: 'JSON Web Token', severity: 'info' };
}

/** Scan arbitrary text (used for bundles fetched during the optional deep scan). */
export function scanTextForSecrets(text, where, seen = new Set()) {
  const findings = [];
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = p.re.exec(text)) && guard++ < 50) {
      const value = m[0];
      if (seen.has(value)) continue;
      seen.add(value);
      const raw = { id: p.id, masked: maskSecret(value), where };
      if (p.id === 'jwt') raw.claims = decodeJwtClaims(value);
      const f = classifyFinding(raw);
      if (f) findings.push(f);
    }
  }
  return findings;
}
