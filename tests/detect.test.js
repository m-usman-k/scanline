import test from 'node:test';
import assert from 'node:assert/strict';
import { detectStack, probePaths, domSelectors, cssVarNames } from '../src/lib/detect.js';
import { TECHNOLOGIES, CATEGORIES } from '../src/lib/signatures.js';

const byName = (stack, name) => stack.find((t) => t.name === name);

test('signature database is consistent', () => {
  const names = new Set();
  const cats = new Set(CATEGORIES.map(([k]) => k));
  for (const t of TECHNOLOGIES) {
    assert.ok(!names.has(t.name), `duplicate ${t.name}`);
    names.add(t.name);
    assert.ok(cats.has(t.cat), `bad category for ${t.name}`);
    for (const re of [...(t.url || []), ...(t.host || []), ...(t.comment || []), ...Object.values(t.meta || {}), ...Object.values(t.headers || {})]) {
      assert.ok(re instanceof RegExp, `${t.name} rule is not a RegExp`);
      assert.ok(!re.global, `${t.name} regex must not be global (stateful lastIndex)`);
    }
  }
  for (const t of TECHNOLOGIES) for (const n of t.implies || []) assert.ok(names.has(n), `${t.name} implies unknown ${n}`);
  assert.ok(probePaths().length > 100);
  assert.ok(domSelectors().length > 50);
  assert.ok(cssVarNames().includes('--bs-blue'));
});

test('detects versions from globals, meta, headers and URLs', () => {
  const stack = detectStack({
    url: 'https://shop.example.com/',
    signals: {
      scripts: ['https://shop.example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1', 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234'],
      styles: ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css'],
      meta: { generator: ['WordPress 6.5.2', 'Elementor 3.21.0'] },
      selectors: ['.elementor'],
      cssVars: {},
      cookies: ['_ga'],
      comments: ['This site is optimized with the Yoast SEO plugin v22.4 - https://yoast.com/wordpress/plugins/seo/'],
      ids: { ga4: ['G-ABC1234'], ua: [], gtm: [], aw: [] },
    },
    probe: { globals: { 'jQuery.fn.jquery': '3.7.1', 'gtag': true }, special: {} },
    headers: [['server', 'nginx/1.25.3'], ['x-powered-by', 'PHP/8.2.10'], ['cf-ray', '123-AMS']],
  });
  assert.equal(byName(stack, 'WordPress').version, '6.5.2');
  assert.equal(byName(stack, 'jQuery').version, '3.7.1');
  assert.equal(byName(stack, 'Bootstrap').version, '5.3.2');
  assert.equal(byName(stack, 'Nginx').version, '1.25.3');
  assert.equal(byName(stack, 'PHP').version, '8.2.10');
  assert.equal(byName(stack, 'Yoast SEO').version, '22.4');
  assert.equal(byName(stack, 'Elementor').version, '3.21.0');
  assert.ok(byName(stack, 'Cloudflare'));
  assert.ok(byName(stack, 'Google Analytics'));
  assert.ok(byName(stack, 'jsDelivr'));
});

test('implied technologies are added and marked', () => {
  const stack = detectStack({ url: 'https://x.dev/', signals: { scripts: ['https://x.dev/_next/static/chunks/main.js'] }, probe: { globals: { 'next.version': '14.2.3' }, special: {} }, headers: [] });
  assert.equal(byName(stack, 'Next.js').version, '14.2.3');
  const react = byName(stack, 'React');
  assert.ok(react && react.implied);
});

test('does not produce common false positives', () => {
  // Utility classes like "w-full" (old Webflow rule) or words like "chaos" (old AOS rule) must not match.
  const stack = detectStack({
    url: 'https://example.org/',
    signals: { scripts: [], styles: [], meta: {}, selectors: [], cssVars: {}, cookies: [], comments: ['chaos theory'], ids: {} },
    probe: { globals: {}, special: {} },
    headers: [['server', 'Apache-Coyote/1.1']],
  });
  assert.ok(!byName(stack, 'Webflow'));
  assert.ok(!byName(stack, 'AOS'));
  assert.ok(!byName(stack, 'Apache HTTP Server'));
  assert.ok(byName(stack, 'Apache Tomcat'));
});

test('special framework probes', () => {
  const stack = detectStack({ url: 'https://a.io/', signals: { tailwind: true }, probe: { globals: {}, special: { vue3: '3.4.21', react: true, angular: '17.1.0' } }, headers: [], protocol: 'h3' });
  assert.equal(byName(stack, 'Vue.js').version, '3.4.21');
  assert.equal(byName(stack, 'Angular').version, '17.1.0');
  assert.ok(byName(stack, 'React'));
  assert.ok(byName(stack, 'Tailwind CSS'));
  assert.ok(byName(stack, 'HTTP/3'));
});

test('hosting detected from the hostname and Set-Cookie names', () => {
  const stack = detectStack({ url: 'https://demo.vercel.app/', signals: {}, probe: {}, headers: [], setCookieNames: ['laravel_session'] });
  assert.ok(byName(stack, 'Vercel'));
  assert.ok(byName(stack, 'Laravel'));
  assert.ok(byName(stack, 'PHP').implied);
});

test('GitHub Pages is not reported for github.com itself', () => {
  const gh = detectStack({ url: 'https://github.com/', signals: {}, probe: {}, headers: [['server', 'github.com'], ['x-github-request-id', 'A:B']] });
  assert.ok(!byName(gh, 'GitHub Pages'));
  const pages = detectStack({ url: 'https://docs.example.org/', signals: {}, probe: {}, headers: [['server', 'GitHub.com']] });
  assert.ok(byName(pages, 'GitHub Pages'));
});
