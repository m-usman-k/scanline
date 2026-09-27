import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoriesFor, endOfLifeFor, assessStack } from '../src/lib/vulns.js';
import { SECRET_PATTERNS, SERIALIZED_SECRET_PATTERNS, scanTextForSecrets, classifyFinding, maskSecret, decodeJwtClaims } from '../src/lib/secrets.js';

test('jQuery advisories depend on version', () => {
  const ids = (v) => advisoriesFor('jQuery', v).flatMap((a) => a.ids);
  assert.ok(ids('3.4.1').includes('CVE-2020-11022'));
  assert.ok(!ids('3.4.1').includes('CVE-2019-11358'));
  assert.ok(ids('1.12.4').includes('CVE-2015-9251'));
  assert.deepEqual(ids('3.7.1'), []);
  assert.deepEqual(advisoriesFor('jQuery', null), []);
});

test('fixedIn reflects the version line', () => {
  const bs3 = advisoriesFor('Bootstrap', '3.3.7').find((a) => a.ids.includes('CVE-2019-8331'));
  const bs4 = advisoriesFor('Bootstrap', '4.2.1').find((a) => a.ids.includes('CVE-2019-8331'));
  assert.equal(bs3.fixedIn, '3.4.1');
  assert.equal(bs4.fixedIn, '4.3.1');
  assert.deepEqual(advisoriesFor('Bootstrap', '5.3.3'), []);
});

test('Next.js middleware bypass ranges', () => {
  const has = (v) => advisoriesFor('Next.js', v).some((a) => a.ids.includes('CVE-2025-29927'));
  assert.ok(has('14.2.10'));
  assert.ok(!has('14.2.25'));
  assert.ok(has('15.1.0'));
  assert.ok(!has('11.1.3'));
});

test('version-independent advisories apply without a version', () => {
  assert.ok(advisoriesFor('AngularJS', null).length > 0);
});

test('end-of-life depends on version and date', () => {
  assert.match(endOfLifeFor('Vue.js', '2.7.16'), /Vue 2/);
  assert.equal(endOfLifeFor('Vue.js', '3.4.0'), null);
  assert.ok(endOfLifeFor('AngularJS', null));
  assert.equal(endOfLifeFor('PHP', '8.2.5', new Date('2026-06-01')), null);
  assert.match(endOfLifeFor('PHP', '8.2.5', new Date('2027-02-01')), /8\.2/);
  const [t] = assessStack([{ name: 'Moment.js', version: '2.29.1' }]);
  assert.ok(t.vulns.length && t.notice);
});

test('secret patterns match real formats and are serializable', () => {
  assert.equal(SERIALIZED_SECRET_PATTERNS.length, SECRET_PATTERNS.length);
  const sample = [
    'const k = "AKIAIOSFODNN7EXAMPLE";',
    'stripe = "sk_live_' + 'a'.repeat(24) + '"',
    'gh = "ghp_' + 'A1b2'.repeat(9) + '"',
    '-----BEGIN RSA PRIVATE KEY-----',
    'maps: "AIza' + 'B'.repeat(35) + '"',
    'publishable: "pk_live_' + 'c'.repeat(24) + '"',
  ].join('\n');
  const found = scanTextForSecrets(sample, 'test');
  const names = found.map((f) => f.name);
  assert.ok(names.includes('AWS access key ID'));
  assert.ok(names.includes('Stripe live secret key'));
  assert.ok(names.includes('GitHub token'));
  assert.ok(names.includes('Private key block'));
  assert.equal(found.find((f) => f.name === 'Google API key').severity, 'info');
  assert.ok(!found.some((f) => /pk_live/.test(f.masked)), 'publishable keys are not secrets');
  assert.ok(found.every((f) => !f.masked.includes('a'.repeat(20))), 'values are masked');
});

test('JWT classification', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (claims) => `${b64({ alg: 'HS256' })}.${b64(claims)}.${'s'.repeat(20)}`;
  assert.equal(decodeJwtClaims(jwt({ role: 'anon', iss: 'supabase' })).role, 'anon');
  const svc = classifyFinding({ id: 'jwt', masked: 'x', where: 'inline', claims: { role: 'service_role', iss: 'supabase' } });
  assert.equal(svc.severity, 'high');
  const anon = classifyFinding({ id: 'jwt', masked: 'x', where: 'inline', claims: { role: 'anon', iss: 'supabase' } });
  assert.equal(anon.severity, 'info');
  const [found] = scanTextForSecrets(`token="${jwt({ sub: 'u1', email: 'a@b.c' })}"`, 'bundle');
  assert.equal(found.severity, 'medium');
  assert.equal(maskSecret('abcdefghijklmnop'), 'abcdef…mnop');
});
