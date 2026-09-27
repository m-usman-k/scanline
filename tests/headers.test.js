import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsp, analyzeCsp, parseHsts, parseSetCookie, auditCookies, isSessionCookieName, disclosureHeaders, headerIndex } from '../src/lib/headers.js';

test('parseCsp splits policies and directives', () => {
  const [p] = parseCsp("default-src 'self'; script-src 'self' https://cdn.example.com; object-src 'none'");
  assert.deepEqual(p['script-src'], ["'self'", 'https://cdn.example.com']);
  assert.deepEqual(p['object-src'], ["'none'"]);
  assert.equal(parseCsp("default-src 'self', script-src 'none'").length, 2);
});

test('analyzeCsp flags unsafe-inline without nonces', () => {
  const r = analyzeCsp({ header: "default-src 'self'; script-src 'self' 'unsafe-inline'" });
  assert.ok(r.present);
  assert.ok(r.issues.some((i) => i.key === 'script-inline' && i.severity === 'high'));
  assert.ok(r.issues.some((i) => i.key === 'object'));
});

test('analyzeCsp accepts a strict nonce-based policy', () => {
  const r = analyzeCsp({ header: "script-src 'nonce-abc123' 'strict-dynamic' 'unsafe-inline' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" });
  assert.equal(r.issues.filter((i) => i.severity !== 'low').length, 0);
  assert.ok(r.strengths.some((s) => /Strict CSP/.test(s)));
  assert.equal(r.frameAncestors, "'self'");
});

test('analyzeCsp: a weakness only counts when every policy has it', () => {
  const r = analyzeCsp({ header: "script-src 'unsafe-inline' *, script-src 'self'; object-src 'none'" });
  assert.ok(!r.issues.some((i) => i.key === 'script-inline'));
  assert.ok(!r.issues.some((i) => i.key === 'object'));
});

test('analyzeCsp reports missing script restrictions and meta policies', () => {
  const r = analyzeCsp({ header: 'upgrade-insecure-requests' });
  assert.ok(r.issues.some((i) => i.key === 'script-unrestricted'));
  const m = analyzeCsp({ header: '', meta: ["default-src 'self'; object-src 'none'"] });
  assert.ok(m.present && m.viaMeta);
  assert.equal(analyzeCsp({ header: '' }).present, false);
});

test('parseHsts reads max-age and flags', () => {
  assert.deepEqual(parseHsts('max-age=31536000; includeSubDomains; preload'), { maxAge: 31536000, includeSubDomains: true, preload: true });
  assert.equal(parseHsts('max-age="600"').maxAge, 600);
  assert.equal(parseHsts(null), null);
});

test('cookie parsing and auditing', () => {
  const c = parseSetCookie('sessionid=abc; Path=/; Secure; HttpOnly; SameSite=Lax');
  assert.equal(c.name, 'sessionid');
  assert.ok(c.secure && c.httpOnly);
  assert.equal(c.sameSite, 'lax');

  const { problems } = auditCookies(['PHPSESSID=1; path=/', 'theme=dark; SameSite=Lax; Secure', 'csrftoken=x; Secure; SameSite=Strict'], { https: true });
  const session = problems.find((p) => p.name === 'PHPSESSID');
  assert.ok(session.issues.some((i) => i.text === 'missing HttpOnly' && i.severity === 'high'));
  assert.ok(session.issues.some((i) => i.text === 'missing Secure' && i.severity === 'high'));
  assert.ok(!problems.find((p) => p.name === 'csrftoken'));
});

test('isSessionCookieName ignores CSRF tokens', () => {
  assert.ok(isSessionCookieName('connect.sid'));
  assert.ok(isSessionCookieName('auth_token'));
  assert.ok(!isSessionCookieName('XSRF-TOKEN'));
  assert.ok(!isSessionCookieName('theme'));
});

test('disclosureHeaders finds version leaks', () => {
  const idx = headerIndex([['Server', 'nginx/1.18.0 (Ubuntu)'], ['X-Powered-By', 'PHP/7.4.3'], ['content-type', 'text/html']]);
  const d = disclosureHeaders(idx);
  assert.equal(d.length, 2);
  assert.deepEqual(disclosureHeaders(headerIndex([['server', 'cloudflare']])), []);
});

test('isServerSessionCookie only matches server session names', async () => {
  const { isServerSessionCookie } = await import('../src/lib/headers.js');
  for (const n of ['PHPSESSID', 'connect.sid', 'sessionid', '_myapp_session', 'laravel_session', 'auth_token', '.AspNetCore.Cookies']) assert.ok(isServerSessionCookie(n), n);
  for (const n of ['optimizelySession', 'enwikimwuser-sessionId', '_ga', '_hjSessionUser_1', 'theme']) assert.ok(!isServerSessionCookie(n), n);
});
