// Scanline service worker.
//
// Passively records the main-document response of each tab (status, all response headers
// including Set-Cookie, server IP, redirect chain) so security checks can run without re-fetching
// the page. Data is kept in chrome.storage.session (memory only, cleared when the browser closes)
// and never leaves the browser. Nothing is blocked or modified.

const MAX_DOCS_PER_TAB = 4;
const FILTER = { urls: ['<all_urls>'], types: ['main_frame'] };
const pendingRedirects = new Map();
const writeQueues = new Map();

const tabKey = (tabId) => `tab:${tabId}`;

function normalizeHeaders(list) {
  return (list || []).map((h) => [
    h.name.toLowerCase(),
    h.value != null ? h.value : h.binaryValue ? String.fromCharCode(...h.binaryValue) : '',
  ]);
}

// Serialize read-modify-write cycles per tab so concurrent events can't clobber each other.
function updateTab(tabId, mutate) {
  const prev = writeQueues.get(tabId) || Promise.resolve();
  const next = prev
    .then(async () => {
      const key = tabKey(tabId);
      const stored = (await chrome.storage.session.get(key))[key] || { docs: [] };
      await chrome.storage.session.set({ [key]: mutate(stored) });
    })
    .catch((err) => console.warn('[Scanline] could not store response info', err));
  writeQueues.set(tabId, next);
  next.finally(() => {
    if (writeQueues.get(tabId) === next) writeQueues.delete(tabId);
  });
  return next;
}

chrome.webRequest.onBeforeRedirect.addListener((d) => {
  if (d.tabId < 0) return;
  const chain = pendingRedirects.get(d.requestId) || [];
  chain.push({ url: d.url, status: d.statusCode, to: d.redirectUrl });
  pendingRedirects.set(d.requestId, chain);
}, FILTER);

chrome.webRequest.onResponseStarted.addListener((d) => {
  if (d.tabId < 0) return;
  const redirects = pendingRedirects.get(d.requestId) || [];
  pendingRedirects.delete(d.requestId);
  const doc = {
    url: d.url,
    status: d.statusCode,
    statusLine: d.statusLine || '',
    ip: d.ip || null,
    fromCache: !!d.fromCache,
    capturedAt: Date.now(),
    headers: normalizeHeaders(d.responseHeaders),
    redirects,
  };
  updateTab(d.tabId, (s) => ({ docs: [doc, ...s.docs.filter((x) => x.url !== doc.url)].slice(0, MAX_DOCS_PER_TAB) }));
}, FILTER, ['responseHeaders', 'extraHeaders']);

chrome.webRequest.onErrorOccurred.addListener((d) => {
  pendingRedirects.delete(d.requestId);
}, FILTER);

chrome.tabs.onRemoved.addListener((tabId) => {
  writeQueues.delete(tabId);
  chrome.storage.session.remove(tabKey(tabId)).catch(() => {});
});

// A score badge belongs to the page it was computed for; clear it when the tab navigates.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});
