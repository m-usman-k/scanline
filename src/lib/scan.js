// Orchestrates a scan from an extension page (popup or report): inject the collector, run the
// main-world probe, read the captured response headers, then detect, audit and score.

import { mainWorldProbe } from './probe.js';
import { probePaths, domSelectors, cssVarNames, detectStack } from './detect.js';
import { assessStack } from './vulns.js';
import { audit } from './audit.js';
import { scoreChecks } from './score.js';
import { SERIALIZED_SECRET_PATTERNS } from './secrets.js';
import { parseSetCookie } from './headers.js';
import { EXT_VERSION, RESULT_SCHEMA, uid, stripHash, originOf, hostOf, scanBlockReason } from './util.js';

const EXTRA_PROBES = ['ng.getComponent'];

export class ScanError extends Error {}

/** The main-document response captured by the service worker for this tab and URL. */
export async function getDocInfo(tabId, pageUrl) {
  const key = `tab:${tabId}`;
  const stored = (await chrome.storage.session.get(key))[key];
  const docs = (stored && stored.docs) || [];
  const exact = docs.find((d) => stripHash(d.url) === stripHash(pageUrl));
  if (exact) return exact;
  // Single-page apps change the URL without a new document; fall back to the same origin.
  const origin = originOf(pageUrl);
  const sameOrigin = docs.find((d) => originOf(d.url) === origin);
  return sameOrigin ? { ...sameOrigin, stale: true } : null;
}

function friendlyInjectionError(err, url) {
  const msg = String((err && err.message) || err);
  if (String(url).startsWith('file:')) return 'To scan local files, turn on “Allow access to file URLs” for Scanline in chrome://extensions.';
  if (/error page/i.test(msg)) return 'This tab is showing an error page. Load the site, then scan again.';
  if (/gallery|webstore/i.test(msg)) return 'Chrome does not allow extensions to run on the Web Store.';
  if (/No tab with id|tab was closed/i.test(msg)) return 'The tab was closed.';
  if (/Cannot access|permission|not allowed/i.test(msg)) return 'Chrome blocked access to this page (browser pages, PDFs and policy-restricted sites cannot be scanned).';
  return msg;
}

export async function scanTab(tab, { onProgress = () => {} } = {}) {
  const blocked = scanBlockReason(tab.url);
  if (blocked) throw new ScanError(blocked);
  const target = { tabId: tab.id };
  const started = Date.now();

  onProgress('Injecting scanner');
  try {
    await chrome.scripting.executeScript({ target, files: ['content/collector.js'] });
  } catch (e) {
    throw new ScanError(friendlyInjectionError(e, tab.url));
  }

  onProgress('Reading the page');
  const probePromise = chrome.scripting
    .executeScript({ target, world: 'MAIN', func: mainWorldProbe, args: [[...probePaths(), ...EXTRA_PROBES]] })
    .then((r) => (r && r[0] && r[0].result) || null)
    .catch(() => null);
  const factsPromise = chrome.scripting
    .executeScript({
      target,
      func: (opts) => globalThis.__scanline.collect(opts),
      args: [{ selectors: domSelectors(), cssVars: cssVarNames(), secretPatterns: SERIALIZED_SECRET_PATTERNS }],
    })
    .then((r) => r && r[0] && r[0].result);

  let probe;
  let facts;
  try {
    [probe, facts] = await Promise.all([probePromise, factsPromise]);
  } catch (e) {
    throw new ScanError(friendlyInjectionError(e, tab.url));
  }
  if (!facts) throw new ScanError('The page did not return any data. Reload it and try again.');

  onProgress('Analyzing');
  const url = (facts.page && facts.page.url) || tab.url;
  const doc = await getDocInfo(tab.id, url);
  return buildResult({ facts, probe, doc, url, title: (facts.page && facts.page.title) || tab.title || '', started });
}

/** Pure part of the pipeline (unit-tested with recorded facts). */
export function buildResult({ facts, probe, doc, url, title = '', started = Date.now(), now = new Date() }) {
  const headers = (doc && doc.headers) || [];
  const setCookieNames = headers.filter(([n]) => n === 'set-cookie').map(([, v]) => parseSetCookie(v).name).filter(Boolean);
  const detected = detectStack({
    signals: facts.signals,
    probe,
    headers,
    url,
    protocol: facts.perf && facts.perf.nav ? facts.perf.nav.protocol : '',
    resources: (facts.perf && facts.perf.resources) || [],
    setCookieNames,
  });
  const stack = assessStack(detected, now);
  const { checks, insights } = audit({ facts, doc, stack, probe: probe || {} });
  return {
    id: uid(),
    schema: RESULT_SCHEMA,
    extVersion: EXT_VERSION,
    url,
    host: hostOf(url),
    title,
    scannedAt: now.toISOString(),
    durationMs: Date.now() - started,
    collectMs: facts.durationMs || null,
    scores: scoreChecks(checks),
    checks,
    stack,
    insights,
    deep: null,
    errors: facts.errors || [],
  };
}

/** Merge optional deep-scan checks into a result and rescore. */
export function mergeDeep(result, deep) {
  const added = deep.checks.map((c) => ({ weight: 1, ...c, details: (c.details || []).filter(Boolean) }));
  const ids = new Set(added.map((c) => c.id));
  const checks = [...result.checks.filter((c) => !ids.has(c.id)), ...added];
  return { ...result, checks, scores: scoreChecks(checks), deep: { ranAt: deep.ranAt, info: deep.info } };
}

export async function highlightInTab(tabId, key, index = null) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (k, i) => (globalThis.__scanline ? globalThis.__scanline.highlight(k, i) : { ok: false, missing: true }),
    args: [key, index],
  });
  return res && res.result;
}

export async function clearHighlightInTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__scanline && globalThis.__scanline.clearHighlight(),
  });
}
