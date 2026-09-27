import {
  h, clear, icon, ring, bar, delta, tone, checkGroups, checkItem, countsLine, stackList, vitalsGrid, keyFacts,
  resourceBreakdown, thirdPartyTable, largestTable, headersTable, dataTable, serpPreview, socialPreview,
  headingOutline, designSection, tagIds, copyText, toast, download, applyTheme, catLabel, CATEGORY_ICONS,
} from './lib/ui.js';
import { logo } from './lib/icons.js';
import { CATEGORIES } from './lib/audit.js';
import { topIssues } from './lib/score.js';
import { getScan, getSettings, historyFor, previousScan } from './lib/store.js';
import { compareResults } from './lib/compare.js';
import { toJson, toMarkdown, summaryText, fileBase } from './lib/export.js';
import { formatMs, relativeTime, plural } from './lib/util.js';

const $main = document.getElementById('main');
const $nav = document.getElementById('nav');

async function init() {
  const settings = await getSettings();
  applyTheme(settings.theme);
  document.getElementById('brand').prepend(logo(26));

  const id = new URLSearchParams(location.search).get('id');
  const result = id ? await getScan(id) : null;
  if (!result) {
    clear($main).append(h('div', { class: 'not-found' },
      icon('file', 36),
      h('h1', {}, 'Report not available'),
      h('p', { class: 'muted' }, 'This scan is no longer stored. Scanline keeps full results for the 20 most recent scans; older history entries keep only their scores.')));
    return;
  }
  document.title = `${result.host} · Scanline report`;

  const prev = await previousScan(result.url, result.id);
  const comparison = prev ? compareResults(result, prev.result || prev.entry) : null;
  const history = (await historyFor(result.url)).filter((e) => new Date(e.at) <= new Date(result.scannedAt));

  renderActions(result);
  renderNav(result);
  renderReport(result, comparison, history);
  setupPrint();
  observeSections();
}

// ---------------------------------------------------------------- toolbar

function renderActions(result) {
  const base = fileBase(result);
  const actions = document.getElementById('actions');
  actions.append(
    h('a', { class: 'btn', href: result.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), 'Open page'),
    h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(summaryText(result))) ? 'Summary copied' : 'Copy failed') }, icon('copy', 14), 'Copy summary'),
    h('button', { class: 'btn', type: 'button', onclick: () => download(`${base}.md`, toMarkdown(result), 'text/markdown') }, icon('download', 14), 'Markdown'),
    h('button', { class: 'btn', type: 'button', onclick: () => download(`${base}.json`, toJson(result), 'application/json') }, icon('download', 14), 'JSON'),
    h('button', { class: 'btn', type: 'button', onclick: () => exportHtml(result) }, icon('download', 14), 'HTML'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => window.print() }, icon('printer', 14), 'Print / PDF'));
}

async function exportHtml(result) {
  const css = (await Promise.all(['ui.css', 'report.css'].map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.text())))).join('\n');
  const clone = $main.cloneNode(true);
  clone.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  clone.querySelectorAll('button, .chart-tooltip, .crosshair').forEach((el) => el.remove());
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const theme = document.documentElement.dataset.theme ? ` data-theme="${esc(document.documentElement.dataset.theme)}"` : '';
  const html = `<!doctype html>\n<html lang="en"${theme}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(document.title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body class="export">\n<main class="rp-main">${clone.innerHTML}</main>\n</body>\n</html>\n`;
  download(`${fileBase(result)}.html`, html, 'text/html');
}

function setupPrint() {
  let closed = [];
  window.addEventListener('beforeprint', () => {
    closed = Array.from(document.querySelectorAll('details:not([open])'));
    closed.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => {
    closed.forEach((d) => { d.open = false; });
    closed = [];
  });
}

// ---------------------------------------------------------------- navigation

function renderNav(result) {
  const items = [
    ['summary', 'Summary', 'grid'],
    ['issues', 'Issues to fix', 'alert'],
    ...CATEGORIES.map((c) => [`cat-${c.id}`, c.label, CATEGORY_ICONS[c.id], result.scores.categories[c.id].score]),
    ['stack', 'Technologies', 'layers'],
    ['history', 'History', 'clock'],
  ];
  clear($nav).append(...items.map(([id, label, ic, score]) =>
    h('a', { href: `#${id}`, dataset: { target: id } },
      icon(ic, 15),
      h('span', { class: 'nav-label' }, label),
      score !== undefined ? h('span', { class: `nav-score tone-${tone(score)}` }, score ?? '–') : null)));
}

function observeSections() {
  const links = new Map(Array.from($nav.querySelectorAll('a')).map((a) => [a.dataset.target, a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove('active'));
      const link = links.get(e.target.id);
      if (link) link.classList.add('active');
    }
  }, { rootMargin: '-80px 0px -70% 0px' });
  document.querySelectorAll('.rp-section').forEach((s) => io.observe(s));
}

// ---------------------------------------------------------------- report body

function sectionEl(id, title, ic, ...content) {
  return h('section', { class: 'rp-section', id }, h('h2', {}, ic ? icon(ic, 20) : null, title), ...content);
}

function renderReport(r, comparison, history) {
  const frag = document.createDocumentFragment();
  frag.append(summarySection(r, comparison));

  const issues = topIssues(r.checks, 200);
  frag.append(sectionEl('issues', `Issues to fix (${issues.length})`, 'alert',
    issues.length
      ? h('div', {}, issues.map((c, i) => checkItem(c, { showCategory: true, open: i < 3 })))
      : h('div', { class: 'empty' }, icon('check', 18), 'No issues found.')));

  for (const cat of CATEGORIES) frag.append(categorySection(r, cat));

  frag.append(sectionEl('stack', `Technologies (${r.stack.length})`, 'layers',
    stackList(r.stack),
    h('h3', { class: 'sub' }, 'Fonts & colors'),
    h('div', { class: 'section-card' }, designSection(r.insights.design, { onCopy: async (hex) => toast((await copyText(hex)) ? `Copied ${hex}` : 'Copy failed') }))));

  frag.append(historySection(history));
  frag.append(h('footer', { class: 'rp-footer' },
    `Generated locally by Scanline ${r.extVersion} on ${new Date(r.scannedAt).toLocaleString()}. Scan took ${formatMs(r.durationMs)}. No data was sent to any server.`,
    r.errors && r.errors.length ? h('div', {}, `Some checks could not run: ${r.errors.join('; ')}`) : null));
  clear($main).append(frag);
}

function summarySection(r, comparison) {
  const s = r.scores;
  const hero = h('div', { class: 'rp-hero' },
    ring(s.overall, { size: 132, stroke: 11, grade: `Grade ${s.grade}` }),
    h('div', {},
      h('div', { class: 'rp-host' }, r.host),
      h('a', { class: 'rp-url', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.url),
      r.title ? h('div', { class: 'rp-title' }, r.title) : null,
      h('div', { class: 'rp-meta' },
        h('span', {}, 'Scanned ', h('b', {}, new Date(r.scannedAt).toLocaleString())),
        h('span', {}, h('b', {}, String(r.checks.length)), ' checks'),
        h('span', {}, h('b', {}, String(r.stack.length)), ' technologies'),
        r.deep ? h('span', {}, 'Deep scan ', h('b', {}, 'included')) : null,
        comparison ? h('span', {}, 'vs. previous scan ', delta(comparison.scoreDelta)) : null),
      h('div', { style: { marginTop: '10px' } }, countsLine(s.counts))));

  const cards = h('div', { class: 'cat-cards' }, CATEGORIES.map((c) => {
    const cs = s.categories[c.id];
    const d = comparison && comparison.catDeltas[c.id];
    return h('a', { class: `cat-card tone-${tone(cs.score)}`, href: `#cat-${c.id}` },
      h('span', { class: 'cat-card-top' }, icon(CATEGORY_ICONS[c.id], 14), c.label),
      h('span', { class: 'cat-card-score' }, cs.score ?? '–', h('span', { class: 'grade' }, cs.grade), d ? delta(d) : null),
      bar(cs.score),
      h('span', { class: 'cat-card-counts' }, `${cs.counts.fail} failed · ${cs.counts.warn} warnings · ${cs.counts.pass} passed`));
  }));

  const parts = [hero, cards, h('h3', { class: 'sub' }, 'Core Web Vitals (this page load)'), vitalsGrid(r.insights.vitals), h('h3', { class: 'sub' }, 'Page facts'), keyFacts(r)];

  if (comparison && comparison.detailed && (comparison.fixed.length || comparison.regressed.length || comparison.stackAdded.length || comparison.stackRemoved.length)) {
    const list = (items, fmt) => (items.length ? h('ul', {}, items.slice(0, 12).map((x) => h('li', {}, fmt(x)))) : h('p', { class: 'muted small' }, 'None'));
    parts.push(h('h3', { class: 'sub' }, `Changes since ${relativeTime(comparison.previousAt)}`),
      h('div', { class: 'compare-card' },
        h('div', {}, h('h4', {}, icon('check', 14), `Improved (${comparison.fixed.length})`), list(comparison.fixed, (x) => `${x.title} (${catLabel(x.cat)}): ${x.from} → ${x.to}`)),
        h('div', {}, h('h4', {}, icon('alert', 14), `Regressed (${comparison.regressed.length})`), list(comparison.regressed, (x) => `${x.title} (${catLabel(x.cat)}): ${x.from} → ${x.to}`)),
        comparison.stackAdded.length ? h('div', {}, h('h4', {}, 'Technologies added'), list(comparison.stackAdded, (x) => x)) : null,
        comparison.stackRemoved.length ? h('div', {}, h('h4', {}, 'Technologies removed'), list(comparison.stackRemoved, (x) => x)) : null));
  }
  return h('section', { class: 'rp-section', id: 'summary' }, ...parts);
}

function categorySection(r, cat) {
  const cs = r.scores.categories[cat.id];
  const checks = r.checks.filter((c) => c.cat === cat.id);
  const extra = [];
  const i = r.insights;
  if (cat.id === 'security') {
    extra.push(h('h3', { class: 'sub' }, `Response headers (${(i.headers || []).length})`), headersTable(i.headers || []));
    if ((i.cookies || []).length) {
      extra.push(h('h3', { class: 'sub' }, 'Cookies set by the page response'), dataTable([
        { label: 'Name', render: (c) => c.name },
        { label: 'Secure', render: (c) => (c.secure ? 'Yes' : 'No') },
        { label: 'HttpOnly', render: (c) => (c.httpOnly ? 'Yes' : 'No') },
        { label: 'SameSite', render: (c) => c.sameSite || '–' },
        { label: 'Persistent', render: (c) => (c.persistent ? 'Yes' : 'Session') },
      ], i.cookies));
    }
  }
  if (cat.id === 'performance') {
    extra.push(
      h('h3', { class: 'sub' }, 'Where the bytes go'), h('div', { class: 'section-card' }, resourceBreakdown(i.resourceTypes || [])),
      h('div', { class: 'two-col', style: { marginTop: '12px' } },
        h('div', {}, h('h3', { class: 'sub' }, 'Largest requests'), largestTable(i.largest || [])),
        h('div', {}, h('h3', { class: 'sub' }, `Third parties (${(i.thirdParties || []).length})`), thirdPartyTable((i.thirdParties || []).slice(0, 15)))));
    if ((i.blockingScripts || []).length) {
      extra.push(h('h3', { class: 'sub' }, 'Scripts blocking the main thread'), dataTable([
        { label: 'Script', render: (x) => x.src },
        { label: 'Time', num: true, render: (x) => formatMs(x.ms) },
      ], i.blockingScripts));
    }
  }
  if (cat.id === 'seo') {
    extra.unshift(h('div', { class: 'two-col', style: { marginBottom: '14px' } }, serpPreview(i.seo, r.host), socialPreview(i.seo, r.host)));
    extra.push(h('h3', { class: 'sub' }, `Heading outline (${i.seo.outline.length})`), h('div', { class: 'section-card' }, headingOutline(i.seo.outline)));
  }
  if (cat.id === 'privacy') {
    const ids = tagIds(i.tagIds || {});
    if (ids) extra.push(h('h3', { class: 'sub' }, 'Tracking IDs'), ids);
  }

  const head = h('h2', {}, icon(CATEGORY_ICONS[cat.id], 20), cat.label,
    h('span', { class: `score-chip tone-${tone(cs.score)}` }, cs.score ?? '–'),
    countsLine(cs.counts));
  const seo = cat.id === 'seo' ? extra.shift() : null;
  return h('section', { class: 'rp-section', id: `cat-${cat.id}` }, head, seo, checkGroups(checks, { openIssues: false }), ...extra);
}

// ---------------------------------------------------------------- history chart

function historySection(history) {
  const points = history.slice().reverse();
  const content = [];
  if (points.length >= 2) content.push(trendChart(points));
  else content.push(h('p', { class: 'muted' }, 'Scan this page again later to see how its score changes over time.'));
  content.push(h('h3', { class: 'sub' }, `Scans of this URL (${history.length})`), dataTable([
    { label: 'Date', render: (e) => new Date(e.at).toLocaleString() },
    { label: 'Score', num: true, render: (e) => `${e.score} (${e.grade})` },
    ...CATEGORIES.map((c) => ({ label: c.label, num: true, render: (e) => (e.cats && e.cats[c.id] != null ? String(e.cats[c.id]) : '–') })),
  ], history));
  return sectionEl('history', 'History', 'clock', ...content);
}

function trendChart(points) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 800;
  const H = 160;
  const pad = { l: 30, r: 12, t: 10, b: 22 };
  const x = (i) => pad.l + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Overall score over ${points.length} scans, from ${points[0].score} to ${points[points.length - 1].score}` });
  for (const v of [0, 50, 100]) {
    svg.append(el('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    const t = el('text', { class: 'axis-label', x: pad.l - 6, y: y(v) + 3.5, 'text-anchor': 'end' });
    t.textContent = String(v);
    svg.append(t);
  }
  svg.append(el('polyline', { class: 'series-line', points: points.map((p, i) => `${x(i)},${y(p.score)}`).join(' '), 'vector-effect': 'non-scaling-stroke' }));
  const cross = el('line', { class: 'crosshair', x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, visibility: 'hidden', 'vector-effect': 'non-scaling-stroke' });
  svg.append(cross);

  const wrap = h('div', { class: 'chart' }, h('div', { class: 'chart-title' }, 'Overall score'));
  const plot = h('div', { style: { position: 'relative' } });
  plot.append(svg);
  // Dots are HTML so they stay round when the SVG stretches horizontally.
  const dots = points.map((p, i) => {
    const d = h('span', { class: 'dot-mark', style: { position: 'absolute', left: `${(x(i) / W) * 100}%`, top: `${(y(p.score) / H) * 160}px`, width: '10px', height: '10px', marginLeft: '-5px', marginTop: '-5px', borderRadius: '50%', background: 'var(--series-1)', boxShadow: '0 0 0 2px var(--surface)' } });
    plot.append(d);
    return d;
  });
  const tip = h('div', { class: 'chart-tooltip', style: { display: 'none' } });
  plot.append(tip);

  plot.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i; });
    const p = points[best];
    cross.setAttribute('x1', String(x(best)));
    cross.setAttribute('x2', String(x(best)));
    cross.setAttribute('visibility', 'visible');
    dots.forEach((d, i) => { d.style.transform = i === best ? 'scale(1.3)' : ''; });
    clear(tip).append(h('div', { class: 'muted small' }, new Date(p.at).toLocaleString()), h('b', {}, String(p.score)), ` · grade ${p.grade}`);
    tip.style.display = 'block';
    tip.style.left = `${(x(best) / W) * 100}%`;
    tip.style.top = `${(y(p.score) / H) * 160}px`;
  });
  plot.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => { d.style.transform = ''; });
  });
  wrap.append(plot, h('p', { class: 'muted small' }, `${plural(points.length, 'scan')} of this URL.`));
  return wrap;
}

init().catch((e) => {
  console.error(e);
  clear($main).append(h('div', { class: 'not-found' }, h('h1', {}, 'Could not open this report'), h('p', { class: 'muted' }, String(e.message || e))));
});
