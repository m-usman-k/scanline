import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResult, mergeDeep } from '../lib/scan.js';
import { scoreChecks, grade, topIssues } from '../lib/score.js';
import { KB } from '../lib/kb.js';
import { CATEGORIES } from '../lib/audit.js';
import { makeFacts, DOC } from './fixtures/facts.js';

const probe = { globals: { 'jQuery.fn.jquery': '3.4.1', google_tag_manager: true }, special: {} };
const run = (facts = makeFacts(), doc = DOC) => buildResult({ facts, probe, doc, url: facts.page.url, title: facts.page.title, now: new Date('2026-09-01T12:00:00Z') });
const get = (r, id) => r.checks.find((c) => c.id === id);

test('builds a complete, scored result', () => {
  const r = run();
  assert.ok(r.id && r.scannedAt && r.checks.length > 60);
  for (const c of CATEGORIES) assert.ok(Number.isFinite(r.scores.categories[c.id].score), `${c.id} scored`);
  assert.ok(r.scores.overall > 0 && r.scores.overall < 100);
  assert.equal(r.insights.page.ip, '203.0.113.7');
  assert.equal(r.insights.page.server, 'nginx/1.18.0');
  assert.ok(r.stack.find((t) => t.name === 'jQuery' && t.version === '3.4.1'));
});

test('security findings from headers, page and stack', () => {
  const r = run();
  assert.equal(get(r, 'sec.https').status, 'pass');
  assert.equal(get(r, 'sec.hsts').status, 'pass');
  assert.equal(get(r, 'sec.csp').status, 'fail');
  assert.equal(get(r, 'sec.clickjacking').status, 'warn');
  assert.equal(get(r, 'sec.cookies').status, 'fail');
  assert.equal(get(r, 'sec.disclosure').status, 'warn');
  assert.equal(get(r, 'sec.secrets').status, 'fail');
  assert.equal(get(r, 'sec.storage').status, 'warn');
  assert.equal(get(r, 'sec.mixed').status, 'warn');
  assert.equal(get(r, 'sec.vulnLibs').status, 'warn');
  assert.match(get(r, 'sec.vulnLibs').details.join(' '), /CVE-2020-11022/);
  assert.equal(get(r, 'sec.eol').status, 'warn', 'PHP 7.4 is end-of-life');
  assert.equal(get(r, 'sec.redirects').status, 'info');
});

test('header checks degrade gracefully when headers were not captured', () => {
  const r = run(makeFacts(), null);
  const csp = get(r, 'sec.csp');
  assert.equal(csp.status, 'info');
  assert.ok(csp.unknown);
  assert.equal(r.insights.page.headersCaptured, false);
});

test('performance thresholds', () => {
  const r = run();
  assert.equal(get(r, 'perf.lcp').status, 'warn');
  assert.equal(get(r, 'perf.cls').status, 'pass');
  assert.equal(get(r, 'perf.inp').status, 'info');
  assert.equal(get(r, 'perf.ttfb').status, 'pass');
  assert.equal(get(r, 'perf.blocking').status, 'warn');
  assert.equal(get(r, 'perf.renderBlocking').status, 'warn');
  const comp = get(r, 'perf.compression');
  assert.equal(comp.status, 'warn', 'app.css is served uncompressed (encoded == decoded size)');
  assert.match(comp.value, /1 text resource/);
  assert.equal(get(r, 'perf.formats').status, 'warn');
  const tp = get(r, 'perf.thirdParty');
  assert.match(tp.value, /2 domains/);
});

test('binary downloads are not counted as uncompressed text', () => {
  const facts = makeFacts();
  facts.perf.resources = facts.perf.resources.filter((r) => !r.u.endsWith('app.css'));
  facts.perf.resources.push({ u: 'https://shop.example.com/models/cat.glb', t: 'fetch', ts: 270000, eb: 268000, db: 268000, d: 50, s: 400, rb: '', p: 'h2', st: 200 });
  facts.perf.resources.push({ u: 'https://shop.example.com/api/items', t: 'fetch', ts: 9000, eb: 9000, db: 9000, d: 50, s: 400, rb: '', p: 'h2', st: 200 });
  const c = get(run(facts), 'perf.compression');
  assert.equal(c.status, 'warn');
  assert.equal(c.details.length, 1);
  assert.match(c.details[0], /api\/items/);
});

test('HSTS durations are human readable', () => {
  const doc = { ...DOC, headers: DOC.headers.map(([n, v]) => [n, n === 'strict-transport-security' ? 'max-age=3600' : v]) };
  assert.match(get(run(makeFacts(), doc), 'sec.hsts').value, /1 hour/);
});

test('uncompressed HTML fails compression', () => {
  const facts = makeFacts({ perf: { nav: { encodedBodySize: 120000, decodedBodySize: 120000 } } });
  const doc = { ...DOC, headers: DOC.headers.filter(([n]) => n !== 'content-encoding') };
  assert.equal(get(run(facts, doc), 'perf.compression').status, 'fail');
});

test('SEO and accessibility', () => {
  const r = run();
  assert.equal(get(r, 'seo.title').status, 'pass');
  assert.equal(get(r, 'seo.h1').status, 'warn');
  assert.equal(get(r, 'seo.og').status, 'warn');
  assert.equal(get(r, 'seo.indexable').status, 'pass');
  assert.equal(get(r, 'seo.status').status, 'pass');
  assert.equal(get(r, 'a11y.imgAlt').status, 'fail');
  assert.equal(get(r, 'a11y.contrast').status, 'fail');
  assert.equal(get(r, 'a11y.buttons').status, 'fail');
  assert.equal(get(r, 'a11y.headings').status, 'warn');
  assert.match(get(r, 'a11y.labels').details.join(' '), /placeholder/);

  const noindex = run(makeFacts({ seo: { robots: ['noindex, nofollow'] } }));
  assert.equal(get(noindex, 'seo.indexable').status, 'fail');
});

test('privacy', () => {
  const r = run();
  assert.equal(get(r, 'priv.embeds').status, 'warn');
  assert.equal(get(r, 'priv.trackers').status, 'warn', 'the _ga cookie identifies Google Analytics');
  assert.equal(get(r, 'priv.consent').status, 'warn', 'tracking without a consent manager');
  const clean = run(makeFacts({ signals: { cookies: [] }, privacy: { cookies: [] } }));
  assert.equal(get(clean, 'priv.consent').status, 'pass', 'no trackers means no consent needed');
});

test('every check has an explanation and a valid status', () => {
  const r = run();
  for (const c of r.checks) {
    assert.ok(['pass', 'warn', 'fail', 'info'].includes(c.status), `${c.id} status`);
    assert.ok(c.title && typeof c.value === 'string', `${c.id} text`);
    assert.ok(KB[c.id] || c.status === 'info', `${c.id} should have a KB entry`);
  }
});

test('scoring', () => {
  assert.equal(grade(95), 'A');
  assert.equal(grade(59), 'F');
  const s = scoreChecks([
    { cat: 'security', status: 'pass', weight: 3 },
    { cat: 'security', status: 'fail', weight: 1 },
    { cat: 'security', status: 'info', weight: 5 },
  ]);
  assert.equal(s.categories.security.score, 75);
  assert.equal(s.categories.seo.score, null);
  assert.equal(s.overall, 75);
  const issues = topIssues([{ status: 'warn', weight: 3 }, { status: 'fail', weight: 1 }, { status: 'pass' }]);
  assert.deepEqual(issues.map((i) => i.status), ['fail', 'warn']);
});

test('mergeDeep replaces checks and rescores', () => {
  const r = run();
  const merged = mergeDeep(r, { ranAt: 'now', info: {}, checks: [
    { id: 'seo.robotsTxt', cat: 'seo', group: 'Site files', title: 'robots.txt', status: 'fail', weight: 3, value: 'blocked', details: [] },
    { id: 'seo.llms', cat: 'seo', group: 'Site files', title: 'llms.txt', status: 'info', value: 'Not published' },
  ] });
  assert.ok(merged.checks.find((c) => c.id === 'seo.robotsTxt'));
  const llms = merged.checks.find((c) => c.id === 'seo.llms');
  assert.deepEqual(llms.details, [], 'deep checks are normalized');
  assert.equal(llms.weight, 1);
  assert.ok(merged.scores.categories.seo.score < r.scores.categories.seo.score);
  assert.equal(merged.deep.ranAt, 'now');
});
