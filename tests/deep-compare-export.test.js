import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, blockedAiCrawlers } from '../lib/deep.js';
import { compareResults } from '../lib/compare.js';
import { toMarkdown, summaryText, fileBase, toJson } from '../lib/export.js';
import { buildResult } from '../lib/scan.js';
import { makeFacts, DOC } from './fixtures/facts.js';

const ROBOTS = `
# comment
User-agent: *
Disallow: /admin/
Allow: /admin/public/
Disallow: /*.pdf$

User-agent: GPTBot
User-agent: CCBot
Disallow: /

Sitemap: https://example.com/sitemap.xml
`;

test('robots.txt parsing and matching', () => {
  const r = parseRobots(ROBOTS);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.sitemaps, ['https://example.com/sitemap.xml']);
  assert.equal(isAllowed(r, 'Googlebot', '/'), true);
  assert.equal(isAllowed(r, 'Googlebot', '/admin/users'), false);
  assert.equal(isAllowed(r, 'Googlebot', '/admin/public/page'), true, 'longer Allow wins');
  assert.equal(isAllowed(r, 'Googlebot', '/files/a.pdf'), false);
  assert.equal(isAllowed(r, 'Googlebot', '/files/a.pdf?x=1'), true, '$ anchors the end');
  assert.equal(isAllowed(r, 'GPTBot', '/'), false);
  assert.deepEqual(blockedAiCrawlers(r).sort(), ['CCBot', 'GPTBot']);
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:'), 'Googlebot', '/'), true, 'empty Disallow allows all');
});

const make = (facts) => buildResult({ facts, probe: { globals: {}, special: {} }, doc: DOC, url: facts.page.url, now: new Date('2026-09-01T00:00:00Z') });

test('compareResults finds fixed and regressed checks', () => {
  const before = make(makeFacts());
  const after = make(makeFacts({
    a11y: { images: { total: 12, missingAlt: { count: 0, samples: [], key: null } } },
    seo: { robots: ['noindex'] },
  }));
  const c = compareResults(after, before);
  assert.ok(c.detailed);
  assert.ok(c.fixed.some((x) => x.id === 'a11y.imgAlt'));
  assert.ok(c.regressed.some((x) => x.id === 'seo.indexable'));

  const summaryOnly = compareResults(after, { score: 50, cats: { security: 40 }, at: '2026-08-01' });
  assert.equal(summaryOnly.detailed, false);
  assert.equal(summaryOnly.scoreDelta, after.scores.overall - 50);
});

test('exports', () => {
  const r = make(makeFacts());
  const md = toMarkdown(r);
  assert.match(md, /^# Scanline report: shop\.example\.com/);
  assert.match(md, /## Issues to fix/);
  assert.match(md, /\| Check \| Status \| Result \|/);
  assert.match(md, /jQuery/);
  assert.match(summaryText(r), /Score \d+\/100/);
  assert.equal(fileBase(r), 'scanline-shop.example.com-2026-09-01');
  assert.equal(JSON.parse(toJson(r)).id, r.id);
});
