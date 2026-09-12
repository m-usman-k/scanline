const securityHeaders = {};

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const headers = details.responseHeaders || [];
    const headerMap = {};

    for (const h of headers) {
      headerMap[h.name.toLowerCase()] = h.value;
    }

    securityHeaders[details.tabId] = {
      'content-security-policy': headerMap['content-security-policy'] || null,
      'strict-transport-security': headerMap['strict-transport-security'] || null,
      'x-content-type-options': headerMap['x-content-type-options'] || null,
      'x-frame-options': headerMap['x-frame-options'] || null,
      'x-xss-protection': headerMap['x-xss-protection'] || null,
      'referrer-policy': headerMap['referrer-policy'] || null,
      'permissions-policy': headerMap['permissions-policy'] || null,
      'cross-origin-opener-policy': headerMap['cross-origin-opener-policy'] || null,
      'cross-origin-resource-policy': headerMap['cross-origin-resource-policy'] || null,
    };
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => {
  delete securityHeaders[tabId];
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_SECURITY_HEADERS') {
    const tabId = sender.tab ? sender.tab.id : msg.tabId;
    sendResponse({ headers: securityHeaders[tabId] || {} });
  }
  return true;
});
