import {
  h, clear, scoreFigure, bar, delta, tone, checkGroups, checkItem, countsLine, stackList, stackChips,
  vitalsGrid, keyFacts, resourceBreakdown, thirdPartyTable, largestTable, headersTable, serpPreview,
  socialPreview, headingOutline, designSection, tagIds, copyText, toast,
} from '../../lib/ui.js';
import { logo } from '../../lib/icons.js';
import { CATEGORIES } from '../../lib/audit.js';
import { topIssues } from '../../lib/score.js';
import { scanTab, mergeDeep, highlightInTab, ScanError } from '../../lib/scan.js';
import { deepScan } from '../../lib/deep.js';
import { getSettings, saveSettings, saveScan, updateScan, previousScan, getHistory, clearHistory } from '../../lib/store.js';
import { compareResults } from '../../lib/compare.js';
import { summaryText } from '../../lib/export.js';
import { EXT_VERSION, relativeTime, scanBlockReason, shortUrl, plural } from '../../lib/util.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'security', label: 'Security' },
  { id: 'performance', label: 'Speed', title: 'Performance' },
  { id: 'seo', label: 'SEO' },
  { id: 'accessibility', label: 'A11y', title: 'Accessibility' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'stack', label: 'Stack', title: 'Technology stack' },
];

const state = {
  tab: null,
  settings: null,
  result: null,
  comparison: null,
  activeTab: 'overview',
  filter: 'all',
  stackQuery: '',
  scanning: false,
};

const $view = document.getElementById('view');
const $scan = document.getElementById('btnScan');
const $report = document.getElementById('btnReport');

// ---------------------------------------------------------------- boot

async function init() {
  state.settings = await getSettings();

  document.getElementById('brand').prepend(logo(26));

  $scan.addEventListener('click', () => runScan());
  $report.addEventListener('click', openReport);
  document.getElementById('btnHistory').addEventListener('click', () => toggleView('history'));
  document.getElementById('btnSettings').addEventListener('click', () => toggleView('settings'));

  state.tab = await resolveTab();
  if (!state.tab) return renderMessage({ title: 'No tab to scan', text: 'Open a website and try again.', error: true });
  const blocked = scanBlockReason(state.tab.url);
  if (blocked) {
    $scan.disabled = true;
    return renderMessage({ title: 'This page can’t be scanned', text: blocked, error: true });
  }

  if (state.settings.autoScan) return runScan();

  const prev = await previousScan(state.tab.url);
  if (prev && prev.result) {
    state.result = prev.result;
    return renderResults();
  }
  renderWelcome();
}

async function resolveTab() {
  const id = Number(new URLSearchParams(location.search).get('tabId'));
  if (id) {
    try {
      return await chrome.tabs.get(id);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// ---------------------------------------------------------------- scanning

async function runScan({ reload = false } = {}) {
  if (state.scanning || !state.tab) return;
  state.scanning = true;
  $scan.disabled = true;
  $scan.textContent = 'Scanning…';
  state.view = 'results';

  const steps = ['Injecting scanner', 'Reading the page', 'Analyzing'];
  renderLoading(steps, reload ? 'Reloading page' : steps[0]);
  try {
    if (reload) await reloadTab(state.tab.id);
    const result = await scanTab(state.tab, { onProgress: (msg) => renderLoading(steps, msg) });
    const prev = await previousScan(result.url, result.id);
    state.comparison = prev ? compareResults(result, prev.result || prev.entry) : null;
    state.result = result;
    await saveScan(result, { keepHistory: state.settings.history });
    setBadge(result);
    renderResults();
  } catch (e) {
    console.error(e);
    renderMessage({ title: 'Scan failed', text: e instanceof ScanError ? e.message : String((e && e.message) || e), error: true, retry: true });
  } finally {
    state.scanning = false;
    $scan.disabled = false;
    $scan.textContent = 'Rescan';
  }
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(done, 20000);
    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      // Give late layout shifts and LCP candidates a moment to settle.
      setTimeout(resolve, 1200);
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.reload(tabId, { bypassCache: false });
  });
}

function setBadge(result) {
  if (!state.settings.badge) return;
  const s = result.scores.overall;
  const color = s >= 90 ? '#23804b' : s >= 60 ? '#a46f00' : '#cc3a3a';
  const tabId = state.tab.id;
  chrome.action.setBadgeText({ tabId, text: String(s) }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
}

async function onHighlight(key, index) {
  try {
    const res = await highlightInTab(state.tab.id, key, index);
    if (res && res.ok) toast(index == null ? `Highlighted ${plural(res.count, 'element')} on the page` : 'Scrolled to the element on the page');
    else if (res && res.missing) toast('Rescan the page to highlight elements');
    else toast('Those elements are no longer on the page');
  } catch {
    toast('Could not highlight on this page');
  }
}

function openReport() {
  if (!state.result) return;
  chrome.tabs.create({ url: chrome.runtime.getURL(`pages/report/report.html?id=${encodeURIComponent(state.result.id)}`) });
}

async function runDeep(btn) {
  btn.disabled = true;
  const label = btn.querySelector('span') || btn;
  try {
    const d = await deepScan(state.result, { onProgress: (m) => { label.textContent = `Checking ${m}…`; } });
    state.result = mergeDeep(state.result, d);
    await updateScan(state.result);
    setBadge(state.result);
    renderResults();
    toast('Site files checked');
  } catch (e) {
    toast(`Deep scan failed: ${e.message || e}`);
    btn.disabled = false;
    label.textContent = 'Run deep scan';
  }
}

// ---------------------------------------------------------------- views

function toggleView(view) {
  if (state.view === view) {
    state.view = 'results';
    return state.result ? renderResults() : renderWelcome();
  }
  state.view = view;
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
}

function setPressed() {
  document.getElementById('btnHistory').setAttribute('aria-pressed', String(state.view === 'history'));
  document.getElementById('btnSettings').setAttribute('aria-pressed', String(state.view === 'settings'));
  $report.disabled = !state.result;
}

function renderLoading(steps, current) {
  setPressed();
  const idx = Math.max(0, steps.indexOf(current));
  clear($view).append(h('div', { class: 'state' },
    h('span', { class: 'state-label' }, 'In progress'),
    h('h2', {}, 'Scanning page'),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Scanning' }),
    h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'active' : '' },
      h('em', {}, String(i + 1).padStart(2, '0')),
      h('span', { class: 'step-text' }, s),
      h('span', { class: 'step-state' }, i < idx ? 'Done' : i === idx ? 'Running' : '')))),
    h('p', { class: 'muted small' }, 'Everything is analyzed locally in your browser.')));
}

function renderMessage({ title, text, error = false, retry = false }) {
  setPressed();
  clear($view).append(h('div', { class: `state${error ? ' error' : ''}` },
    h('span', { class: 'state-label' }, error ? 'Error' : 'Note'),
    h('h2', {}, title),
    h('p', {}, text),
    retry ? h('button', { class: 'btn primary', type: 'button', onclick: () => runScan() }, 'Try again') : null));
}

function renderWelcome() {
  setPressed();
  $scan.textContent = 'Scan';
  const features = [
    'Security headers & CSP', 'Core Web Vitals', 'SEO & social previews',
    'Accessibility & contrast', 'Trackers & privacy', '400+ technologies',
  ];
  clear($view).append(h('div', { class: 'state' },
    h('span', { class: 'state-label' }, 'Site auditor'),
    h('h2', {}, 'Audit this page'),
    h('p', {}, 'Scanline checks security, speed, SEO, accessibility and privacy, and identifies the tech stack, without sending anything to a server.'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => runScan() }, 'Scan this page'),
    h('ul', { class: 'feature-list' }, features.map((text) => h('li', {}, text)))));
}

function renderResults() {
  const r = state.result;
  if (!r) return renderWelcome();
  state.view = 'results';
  setPressed();
  $scan.textContent = 'Rescan';

  const frag = document.createDocumentFragment();
  frag.append(hero(r));

  if (!r.insights.page.headersCaptured) {
    frag.append(h('div', { class: 'banner s-warn', style: { marginTop: '14px' } },
      h('span', { class: 'banner-label' }, 'Headers missing'),
      h('span', {}, 'Response headers weren’t captured because this page loaded before Scanline was active. Header, cookie and server checks are incomplete.'),
      h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: () => runScan({ reload: true }) }, 'Reload page & rescan'))));
  }

  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Report sections' });
  for (const t of TABS) {
    const cat = r.scores.categories[t.id];
    const hasFail = cat && cat.counts.fail > 0;
    tablist.append(h('button', {
      class: 'tab', role: 'tab', type: 'button', id: `tab-${t.id}`, title: t.title || t.label,
      'aria-selected': String(state.activeTab === t.id), 'aria-controls': 'panel', tabindex: state.activeTab === t.id ? '0' : '-1',
      onclick: () => selectTab(t.id),
      onkeydown: onTabKey,
      dataset: { tab: t.id },
    }, t.label, hasFail ? h('span', { class: 'tab-dot s-fail', 'aria-hidden': 'true' }) : null));
  }
  frag.append(tablist);
  frag.append(h('section', { id: 'panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.activeTab}` }, renderPanel(state.activeTab)));
  clear($view).append(frag);
}

function onTabKey(e) {
  const i = TABS.findIndex((t) => t.id === state.activeTab);
  let next = null;
  if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
  if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
  if (e.key === 'Home') next = TABS[0];
  if (e.key === 'End') next = TABS[TABS.length - 1];
  if (next) {
    e.preventDefault();
    selectTab(next.id);
    document.getElementById(`tab-${next.id}`).focus();
  }
}

function selectTab(id) {
  state.activeTab = id;
  state.filter = 'all';
  for (const el of document.querySelectorAll('.tab')) {
    const on = el.dataset.tab === id;
    el.setAttribute('aria-selected', String(on));
    el.tabIndex = on ? 0 : -1;
  }
  const panel = document.getElementById('panel');
  if (!panel) return renderResults();
  panel.setAttribute('aria-labelledby', `tab-${id}`);
  clear(panel).append(renderPanel(id));
  const tabs = document.querySelector('.tabs');
  if (tabs && window.scrollY > tabs.offsetTop - 52) window.scrollTo({ top: tabs.offsetTop - 52 });
}

function hero(r) {
  const s = r.scores;
  let path = r.url;
  try {
    const u = new URL(r.url);
    path = u.pathname + u.search;
  } catch { /* ignore */ }
  const c = state.comparison;
  return h('section', { class: 'hero', 'aria-label': 'Scores' },
    scoreFigure(s.overall, { grade: s.grade }),
    h('div', { class: 'hero-main' },
      h('div', { class: 'hero-host', title: r.url }, r.host || r.url),
      h('div', { class: 'hero-meta' },
        h('span', {}, `${shortUrl(path, 34) || '/'} · ${relativeTime(r.scannedAt)}`),
        c && c.scoreDelta ? delta(c.scoreDelta) : null),
      h('div', { class: 'cat-rows' }, CATEGORIES.map((cat) => {
        const cs = s.categories[cat.id];
        return h('button', { class: `cat-row tone-${tone(cs.score)}`, type: 'button', onclick: () => selectTab(cat.id), title: `${cat.label}: ${cs.counts.fail} failed, ${cs.counts.warn} warnings` },
          h('span', { class: 'cat-name' }, cat.label),
          bar(cs.score),
          h('span', { class: 'cat-score' }, cs.score ?? '-'));
      }))));
}

// ---------------------------------------------------------------- panels

function renderPanel(id) {
  const r = state.result;
  switch (id) {
    case 'overview': return overviewPanel(r);
    case 'stack': return stackPanel(r);
    default: return categoryPanel(r, id);
  }
}

function overviewPanel(r) {
  const frag = document.createDocumentFragment();
  const c = state.comparison;
  if (c && (c.fixed.length || c.regressed.length || c.scoreDelta)) {
    frag.append(h('div', { class: 'compare' },
      h('span', {}, 'Since ', h('b', {}, relativeTime(c.previousAt)), ':'),
      h('span', {}, 'score ', delta(c.scoreDelta)),
      c.detailed ? h('span', {}, h('b', {}, String(c.fixed.length)), ' fixed') : null,
      c.detailed ? h('span', {}, h('b', {}, String(c.regressed.length)), ' new issues') : null));
  }

  frag.append(countsLine(r.scores.counts));
  const issues = topIssues(r.checks, 6);
  frag.append(sectionTitle('Top issues', issues.length ? h('button', { class: 'link-btn more', type: 'button', onclick: openReport }, 'Full report') : null));
  if (issues.length) frag.append(h('div', {}, issues.map((ch) => checkItem(ch, { onHighlight, showCategory: true }))));
  else frag.append(h('div', { class: 'empty' }, 'No issues found.'));

  frag.append(sectionTitle('Page facts'), keyFacts(r));

  const shown = r.stack.filter((t) => !t.implied && t.cat !== 'platform');
  frag.append(sectionTitle('Technologies',
    h('button', { class: 'link-btn more', type: 'button', onclick: () => selectTab('stack') }, `All ${r.stack.length}`)));
  frag.append(shown.length ? stackChips(r.stack) : h('p', { class: 'muted' }, 'No technologies detected.'));

  if (!r.deep) {
    const btn = h('button', { class: 'btn small', type: 'button' }, h('span', {}, 'Run deep scan'));
    btn.addEventListener('click', () => runDeep(btn));
    frag.append(h('div', { class: 'deep' },
      h('span', { class: 'deep-label' }, 'Deep scan ', h('em', {}, '(optional)')),
      h('span', { class: 'deep-desc' }, 'Reads robots.txt, sitemap, security.txt and this site’s JS bundles for leaked keys. Only contacts this site.'),
      btn));
  } else {
    frag.append(h('p', { class: 'hint' }, `Site files checked ${relativeTime(r.deep.ranAt)}.`));
  }

  frag.append(h('div', { class: 'actions-row' },
    h('button', { class: 'btn', type: 'button', onclick: openReport }, 'Full report & export'),
    h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(summaryText(r))) ? 'Summary copied' : 'Copy failed') }, 'Copy summary')));
  return frag;
}

function categoryPanel(r, id) {
  const cat = CATEGORIES.find((c) => c.id === id);
  const cs = r.scores.categories[id];
  const checks = r.checks.filter((c) => c.cat === id);
  const issueCount = checks.filter((c) => c.status === 'fail' || c.status === 'warn').length;
  const frag = document.createDocumentFragment();

  const listHost = h('div', {});
  const renderList = () => clear(listHost).append(checkGroups(checks, { filter: state.filter, onHighlight }));
  const seg = h('div', { class: 'chips-filter', role: 'group', 'aria-label': 'Filter checks' });
  for (const [value, label] of [['all', `All ${checks.length}`], ['issues', `Issues ${issueCount}`]]) {
    seg.append(h('button', {
      type: 'button', 'aria-pressed': String(state.filter === value),
      onclick: (e) => {
        state.filter = value;
        for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        renderList();
      },
    }, label));
  }
  frag.append(h('div', { class: 'panel-head' },
    h('h2', {}, cat.label, h('span', { class: `score-chip tone-${tone(cs.score)}` }, cs.score ?? '-')),
    seg));

  if (id === 'performance') frag.append(h('div', { style: { margin: '8px 0 6px' } }, vitalsGrid(r.insights.vitals)));
  if (id === 'seo') {
    frag.append(h('div', { style: { display: 'grid', gap: '8px', margin: '8px 0 6px' } },
      serpPreview(r.insights.seo, r.host), socialPreview(r.insights.seo, r.host)));
  }

  renderList();
  frag.append(listHost);

  if (id === 'security') {
    const headers = r.insights.headers || [];
    frag.append(section(`Response headers (${headers.length})`, headersTable(headers)));
  }
  if (id === 'performance') {
    frag.append(section('Where the bytes go', resourceBreakdown(r.insights.resourceTypes || []), true));
    frag.append(section(`Third parties (${(r.insights.thirdParties || []).length})`, thirdPartyTable((r.insights.thirdParties || []).slice(0, 12))));
    frag.append(section('Largest requests', largestTable(r.insights.largest || [])));
  }
  if (id === 'seo') frag.append(section(`Heading outline (${r.insights.seo.outline.length})`, headingOutline(r.insights.seo.outline)));
  if (id === 'privacy') {
    const ids = tagIds(r.insights.tagIds || {});
    if (ids) frag.append(section('Tracking IDs', ids, true));
    frag.append(section(`Third-party domains (${(r.insights.thirdParties || []).length})`, thirdPartyTable(r.insights.thirdParties || [])));
  }
  if (id === 'accessibility') {
    frag.append(h('p', { class: 'hint' }, 'Automated checks catch only part of accessibility problems. Also try the page with a keyboard and a screen reader.'));
  }
  return frag;
}

function stackPanel(r) {
  const frag = document.createDocumentFragment();
  const listHost = h('div', {});
  const renderList = () => {
    const q = state.stackQuery.trim().toLowerCase();
    const list = q ? r.stack.filter((t) => `${t.name} ${t.category} ${t.version || ''}`.toLowerCase().includes(q)) : r.stack;
    clear(listHost).append(stackList(list));
  };
  const input = h('input', { class: 'search', type: 'search', placeholder: `Filter ${r.stack.length} technologies`, 'aria-label': 'Filter technologies', value: state.stackQuery });
  input.addEventListener('input', () => {
    state.stackQuery = input.value;
    renderList();
  });
  frag.append(h('div', { class: 'stack-tools' }, input));
  renderList();
  frag.append(listHost);
  frag.append(section('Fonts & colors', designSection(r.insights.design, { onCopy: async (hex) => toast((await copyText(hex)) ? `Copied ${hex}` : 'Copy failed') }), false));
  return frag;
}

function section(title, content, open = false) {
  return h('details', { class: 'section', open: open || undefined },
    h('summary', {}, title),
    h('div', { class: 'section-body' }, content));
}

function sectionTitle(label, more) {
  return h('h3', { class: 'section-title' }, h('span', {}, label), more);
}

// ---------------------------------------------------------------- history

async function renderHistory() {
  setPressed();
  const list = await getHistory();
  const body = h('div', { class: 'history-list' });
  if (!list.length) body.append(h('div', { class: 'empty' }, state.settings.history ? 'No scans yet.' : 'History is turned off in settings.'));
  for (const e of list) {
    let path = '';
    try {
      path = new URL(e.url).pathname;
    } catch { /* ignore */ }
    body.append(h('button', {
      class: 'history-row', type: 'button', disabled: e.full ? undefined : true,
      title: e.full ? 'Open report' : 'Only the summary of this older scan is kept',
      onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL(`pages/report/report.html?id=${encodeURIComponent(e.id)}`) }),
    },
    h('span', { class: `score-badge tone-${tone(e.score)}` }, String(e.score)),
    h('span', { class: 'history-text' }, h('span', { class: 'history-host' }, e.host), h('span', { class: 'history-path' }, e.title || path || '/')),
    h('span', { class: 'history-time' }, relativeTime(e.at))));
  }
  clear($view).append(
    backLink('history'),
    h('div', { class: 'subhead' },
      h('h2', {}, 'History'),
      list.length ? h('button', {
        class: 'link-btn', type: 'button',
        onclick: async () => {
          await clearHistory();
          toast('History cleared');
          renderHistory();
        },
      }, 'Clear all') : null),
    body);
}

// ---------------------------------------------------------------- settings

function renderSettings() {
  setPressed();
  const s = state.settings;
  const toggle = (key, title, desc) => {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': title });
    input.checked = !!s[key];
    input.addEventListener('change', async () => {
      state.settings = await saveSettings({ [key]: input.checked });
      if (key === 'badge' && !input.checked && state.tab) chrome.action.setBadgeText({ tabId: state.tab.id, text: '' }).catch(() => {});
    });
    return h('label', { class: 'setting' },
      h('span', { class: 'setting-text' }, h('span', { class: 'setting-title' }, title), h('span', { class: 'setting-desc' }, desc)),
      h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' })));
  };

  clear($view).append(
    backLink('settings'),
    h('div', { class: 'subhead' }, h('h2', {}, 'Settings')),
    h('div', { class: 'settings' },
      toggle('autoScan', 'Scan when opened', 'Start a scan as soon as you open Scanline.'),
      toggle('badge', 'Score on toolbar icon', 'Show the last score for each tab on the Scanline icon.'),
      toggle('history', 'Keep scan history', 'Store results locally so you can compare scans over time.'),
      h('div', { class: 'setting' },
        h('span', { class: 'setting-text' },
          h('span', { class: 'setting-title' }, 'Keyboard shortcut'),
          h('span', { class: 'setting-desc' }, h('kbd', {}, 'Alt'), ' + ', h('kbd', {}, 'Shift'), ' + ', h('kbd', {}, 'S'), ' by default. Change it in Chrome’s shortcut settings.')),
        h('button', { class: 'btn small', type: 'button', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, 'Edit'))),
    h('p', { class: 'about' },
      `Scanline ${EXT_VERSION}. All analysis runs inside your browser. Scan results and settings are stored only in this browser's local extension storage. The optional deep scan fetches robots.txt, sitemap, security.txt and scripts from the scanned site itself, and only when you click it.`));
}

function backLink(view) {
  return h('button', { class: 'back', type: 'button', onclick: () => toggleView(view) }, 'Back');
}

init().catch((e) => {
  console.error(e);
  renderMessage({ title: 'Something went wrong', text: String(e.message || e), error: true });
});
