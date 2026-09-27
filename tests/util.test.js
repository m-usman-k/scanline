import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, inRange, cleanVersion, registrableDomain, shortUrl, formatBytes, scanBlockReason } from '../lib/util.js';

test('compareVersions orders dotted versions', () => {
  assert.equal(compareVersions('3.4.1', '3.5.0'), -1);
  assert.equal(compareVersions('3.5', '3.5.0'), 0);
  assert.equal(compareVersions('10.0.0', '9.9.9'), 1);
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('19.0.0-rc.1', '19.0.0'), -1);
  assert.ok(Number.isNaN(compareVersions('abc', '1.0')));
});

test('inRange uses half-open intervals', () => {
  assert.ok(inRange('3.4.9', { below: '3.5.0' }));
  assert.ok(!inRange('3.5.0', { below: '3.5.0' }));
  assert.ok(inRange('4.0.0', { atOrAbove: '4.0.0', below: '4.1.2' }));
  assert.ok(!inRange('3.9.9', { atOrAbove: '4.0.0' }));
});

test('cleanVersion extracts the leading version', () => {
  assert.equal(cleanVersion('3.5.1 -ajax,-effects'), '3.5.1');
  assert.equal(cleanVersion('WordPress 6.5.2'), '6.5.2');
  assert.equal(cleanVersion('none'), null);
});

test('registrableDomain handles multi-part suffixes and platforms', () => {
  assert.equal(registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('cdn.example.com'), 'example.com');
  assert.equal(registrableDomain('alice.github.io'), 'alice.github.io');
  assert.equal(registrableDomain('shop.myshopify.com'), 'shop.myshopify.com');
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(registrableDomain('localhost'), 'localhost');
});

test('shortUrl and formatBytes produce readable output', () => {
  assert.equal(shortUrl('https://example.com/a/b.js?x=1'), 'example.com/a/b.js?…');
  assert.ok(shortUrl(`https://example.com/${'x'.repeat(200)}`, 40).length <= 44);
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('scanBlockReason rejects browser pages', () => {
  assert.ok(scanBlockReason('chrome://extensions'));
  assert.ok(scanBlockReason('https://chromewebstore.google.com/detail/x'));
  assert.equal(scanBlockReason('https://example.com'), null);
  assert.equal(scanBlockReason('file:///C:/page.html'), null);
});
