// Shared rendering for the popup and the full report. Everything is built with DOM APIs and
// textContent, so page-controlled strings (titles, headers, URLs) can never inject markup.

import { explain } from './kb.js';
import { CATEGORIES } from './audit.js';
import { CATEGORY_NAMES } from './trackers.js';
import { formatBytes, formatMs, shortUrl, truncate, plural } from './util.js';

// ---------------------------------------------------------------- DOM helper

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Text with `backtick` spans rendered as <code>. */
export function rich(text) {
  const frag = document.createDocumentFragment();
  String(text ?? '').split(/`([^`]+)`/).forEach((part, i) => {
    if (!part) return;
    frag.append(i % 2 ? h('code', {}, part) : document.createTextNode(part));
  });
  return frag;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// ---------------------------------------------------------------- tones

export const STATUS = {
  pass: { label: 'Pass' },
  warn: { label: 'Warn' },
  fail: { label: 'Fail' },
  info: { label: 'Info' },
};

export function tone(score) {
  if (score == null) return 'none';
  if (score >= 90) return 'good';
  if (score >= 60) return 'ok';
  return 'bad';
}

export const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || id;

// ---------------------------------------------------------------- score

/** The score as a plain figure: big number, then "/100 · grade B". */
export function scoreFigure(score, { grade = '', animate = true } = {}) {
  const num = h('span', { class: 'score-num' }, String(score ?? '-'));
  if (animate && Number.isFinite(score)) countUp(num, score);
  return h('div', { class: `score tone-${tone(score)}`, role: 'img', 'aria-label': `Score ${score} out of 100${grade ? `, grade ${grade}` : ''}` },
    num,
    h('span', { class: 'score-of' }, '/100', grade ? [' · grade ', h('span', { class: 'score-grade' }, grade)] : null));
}

function countUp(el, to, duration = 600) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function bar(score) {
  return h('span', { class: `bar tone-${tone(score)}` }, h('span', { class: 'bar-fill', style: { width: `${Math.max(0, Math.min(100, score || 0))}%` } }));
}

export function delta(n) {
  if (!n) return h('span', { class: 'delta zero' }, '±0');
  return h('span', { class: `delta ${n > 0 ? 'up' : 'down'}` }, `${n > 0 ? '+' : '−'}${Math.abs(n)}`);
}

// ---------------------------------------------------------------- checks

const STATUS_ORDER = { fail: 0, warn: 1, info: 2, pass: 3 };

export function checkItem(c, { onHighlight, open = false, showCategory = false } = {}) {
  const kb = explain(c.id);
  const st = STATUS[c.status] || STATUS.info;
  const el = h('details', { class: `check s-${c.status}`, open: open || undefined, dataset: { id: c.id } });
  el.append(h('summary', { class: 'check-row' },
    h('span', { class: `st s-${c.status}` }, st.label),
    h('span', { class: 'check-text' },
      h('span', { class: 'check-title' }, c.title, showCategory ? h('span', { class: 'check-cat' }, catLabel(c.cat)) : null),
      h('span', { class: 'check-value' }, c.value))));

  const body = h('div', { class: 'check-body' });
  if (c.details && c.details.length) body.append(h('ul', { class: 'detail-list' }, c.details.map((d) => h('li', {}, rich(d)))));
  if (c.samples && c.samples.length) {
    body.append(h('div', { class: 'samples' },
      h('div', { class: 'mini-label' }, 'Affected elements'),
      h('ol', {}, c.samples.map((s, i) => h('li', {},
        h('code', {}, s),
        onHighlight && c.highlight ? h('button', { class: 'link-btn', type: 'button', title: 'Scroll to this element on the page', onclick: () => onHighlight(c.highlight, i) }, 'Show') : null)))));
  }
  if (onHighlight && c.highlight) {
    body.append(h('div', { class: 'check-actions' },
      h('button', { class: 'btn small', type: 'button', onclick: () => onHighlight(c.highlight, null) }, 'Highlight on page')));
  }
  if (kb) {
    body.append(h('div', { class: 'kb' },
      h('p', {}, h('strong', {}, 'Why it matters. '), rich(kb.why)),
      h('p', {}, h('strong', {}, 'How to fix. '), rich(kb.fix)),
      kb.learn ? h('a', { class: 'learn', href: kb.learn, target: '_blank', rel: 'noopener noreferrer' }, 'Learn more') : null));
  }
  if (!body.childNodes.length) body.append(h('p', { class: 'muted' }, 'No further details.'));
  el.append(body);
  return el;
}

/** Checks of one category, grouped, issues first within each group. */
export function checkGroups(checks, { filter = 'all', onHighlight, openIssues = false } = {}) {
  const list = checks.filter((c) => filter === 'all' || c.status === 'fail' || c.status === 'warn');
  if (!list.length) {
    return h('div', { class: 'empty' }, filter === 'all' ? 'No checks in this category.' : 'No issues in this category.');
  }
  const groups = new Map();
  for (const c of list) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  const frag = document.createDocumentFragment();
  for (const [group, items] of groups) {
    items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    frag.append(h('section', { class: 'group' },
      h('h3', { class: 'group-title' }, group || 'Checks'),
      items.map((c) => checkItem(c, { onHighlight, open: openIssues && (c.status === 'fail' || c.status === 'warn') }))));
  }
  return frag;
}

export function countsLine(counts) {
  return h('div', { class: 'counts' },
    h('span', { class: 'count s-fail' }, h('b', {}, String(counts.fail || 0)), ' failed'),
    h('span', { class: 'count s-warn' }, h('b', {}, String(counts.warn || 0)), ' warnings'),
    h('span', { class: 'count s-pass' }, h('b', {}, String(counts.pass || 0)), ' passed'));
}

// ---------------------------------------------------------------- stack

export function stackList(stack, { open = false } = {}) {
  if (!stack.length) return h('div', { class: 'empty' }, 'No technologies detected.');
  const byCat = new Map();
  for (const t of stack) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t);
  }
  const frag = document.createDocumentFragment();
  for (const [cat, items] of byCat) {
    frag.append(h('section', { class: 'group' },
      h('h3', { class: 'group-title' }, cat, h('span', { class: 'group-count' }, String(items.length))),
      h('div', { class: 'tech-list' }, items.map((t) => techItem(t, open)))));
  }
  return frag;
}

function techItem(t, open) {
  const worst = (t.vulns || []).some((v) => v.severity === 'high') ? 'fail' : (t.vulns || []).length ? 'warn' : null;
  const badges = [
    t.version ? h('span', { class: 'tag' }, t.version) : null,
    worst ? h('span', { class: `tag ${worst === 'fail' ? 'bad' : 'warn'}` }, plural(t.vulns.length, 'advisory', 'advisories')) : null,
    t.eol ? h('span', { class: 'tag warn' }, 'end-of-life') : null,
    t.deprecated ? h('span', { class: 'tag warn' }, 'discontinued') : null,
    t.tracker && !t.friendly ? h('span', { class: 'tag subtle' }, CATEGORY_NAMES[t.tracker] || t.tracker) : null,
    t.friendly ? h('span', { class: 'tag subtle' }, 'privacy-friendly') : null,
  ];
  return h('details', { class: `tech${t.implied ? ' implied' : ''}`, open: open || undefined },
    h('summary', { class: 'tech-row' },
      h('span', { class: 'tech-name' }, t.name),
      h('span', { class: 'tech-badges' }, badges)),
    h('div', { class: 'tech-body' },
      h('div', { class: 'mini-label' }, 'Detected by'),
      h('ul', { class: 'detail-list' }, t.evidence.map((e) => h('li', {}, e))),
      (t.vulns || []).length ? [h('div', { class: 'mini-label' }, 'Known vulnerabilities'), h('ul', { class: 'detail-list' }, t.vulns.map((v) => h('li', {}, h('strong', {}, v.ids.join(', ')), ` (${v.severity}): ${v.summary}${v.fixedIn ? ` Fixed in ${v.fixedIn}.` : ''}`)))] : null,
      t.eol ? h('p', { class: 'note warn' }, t.eol) : null,
      t.deprecated ? h('p', { class: 'note warn' }, t.deprecated) : null,
      t.notice ? h('p', { class: 'note' }, t.notice) : null));
}

export function stackChips(stack, limit = 14) {
  const shown = stack.filter((t) => !t.implied && t.cat !== 'platform').slice(0, limit);
  return h('div', { class: 'chips' }, shown.map((t) => h('span', { class: `chip${t.vulns && t.vulns.length ? ' chip-bad' : ''}` }, t.name, t.version ? h('span', { class: 'chip-ver' }, t.version) : null)));
}

// ---------------------------------------------------------------- insights

const VITALS = [
  ['lcp', 'LCP', 'Largest Contentful Paint', 2500, 4000, formatMs],
  ['cls', 'CLS', 'Cumulative Layout Shift', 0.1, 0.25, (v) => v.toFixed(3)],
  ['inp', 'INP', 'Interaction to Next Paint', 200, 500, formatMs],
  ['fcp', 'FCP', 'First Contentful Paint', 1800, 3000, formatMs],
  ['ttfb', 'TTFB', 'Time to First Byte', 800, 1800, formatMs],
  ['tbt', 'Blocking', 'Main-thread blocking during load', 200, 600, formatMs],
];

export function vitalsGrid(vitals) {
  return h('div', { class: 'vitals' }, VITALS.map(([key, short, long, good, poor, fmt]) => {
    const v = vitals ? vitals[key] : null;
    const t = v == null ? 'none' : v <= good ? 'good' : v <= poor ? 'ok' : 'bad';
    return h('div', { class: `vital tone-${t}`, title: long },
      h('span', { class: 'vital-name' }, short),
      h('span', { class: 'vital-value' }, v == null ? '-' : fmt(v)));
  }));
}

export function keyFacts(result) {
  const i = result.insights || {};
  const p = i.page || {};
  const t = i.totals || {};
  const proto = p.protocol === 'h3' ? 'HTTP/3' : p.protocol === 'h2' ? 'HTTP/2' : p.protocol ? p.protocol.toUpperCase() : '-';
  const facts = [
    ['Server', p.server || '-'],
    ['IP address', p.ip || '-'],
    ['Protocol', proto],
    ['Status', p.status ? String(p.status) : '-'],
    ['Page weight', formatBytes(t.bytes || 0)],
    ['Requests', String(t.requests || 0)],
    ['DOM elements', t.domElements != null ? t.domElements.toLocaleString('en-US') : '-'],
    ['Third parties', String((i.thirdParties || []).length)],
  ];
  return h('dl', { class: 'facts' }, facts.map(([k, v]) => h('div', { class: 'fact' }, h('dt', {}, k), h('dd', { title: v }, v))));
}

export function resourceBreakdown(types) {
  const total = types.reduce((n, t) => n + t.bytes, 0) || 1;
  return h('div', { class: 'breakdown' },
    h('div', { class: 'stacked' }, types.filter((t) => t.bytes).map((t) => h('span', { class: `seg seg-${t.type}`, style: { width: `${Math.max(1, (t.bytes / total) * 100)}%` }, title: `${t.label}: ${formatBytes(t.bytes)}` }))),
    h('ul', { class: 'legend' }, types.map((t) => h('li', {}, h('span', { class: `dot seg-${t.type}` }), h('span', { class: 'legend-label' }, t.label), h('span', { class: 'legend-val' }, `${formatBytes(t.bytes)} · ${t.count}`)))));
}

export function dataTable(columns, rows, { empty = 'Nothing to show.' } = {}) {
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.num ? 'num' : '', title: c.title ? c.title(r) : undefined }, c.render(r))))))));
}

export function thirdPartyTable(list) {
  return dataTable([
    { label: 'Domain', render: (d) => d.domain },
    { label: 'Owner', render: (d) => d.entity || '-' },
    { label: 'Type', render: (d) => (d.category ? CATEGORY_NAMES[d.category] || d.category : '-') },
    { label: 'Req.', num: true, render: (d) => String(d.requests) },
    { label: 'Size', num: true, render: (d) => formatBytes(d.bytes) },
  ], list, { empty: 'No third-party requests.' });
}

export function largestTable(list) {
  return dataTable([
    { label: 'Resource', render: (r) => shortUrl(r.url, 46), title: (r) => r.url },
    { label: 'Type', render: (r) => r.type },
    { label: 'Size', num: true, render: (r) => formatBytes(r.bytes) },
  ], list);
}

export function headersTable(headers) {
  return dataTable([
    { label: 'Header', render: (x) => x[0] },
    { label: 'Value', render: (x) => truncate(x[1], 300), title: (x) => x[1] },
  ], headers, { empty: 'Headers were not captured for this page.' });
}

export function serpPreview(seo, host) {
  let crumbs = host;
  try {
    const u = new URL(seo.url);
    crumbs = [u.hostname, ...u.pathname.split('/').filter(Boolean).slice(0, 3)].join(' › ');
  } catch { /* ignore */ }
  return h('div', { class: 'box serp' },
    h('div', { class: 'serp-crumbs' }, crumbs),
    h('div', { class: 'serp-title' }, truncate(seo.title || 'Untitled page', 62)),
    h('div', { class: 'serp-desc' }, seo.description ? truncate(seo.description, 158) : 'No meta description. Search engines will pick text from the page.'));
}

export function socialPreview(seo, host) {
  const og = seo.og || {};
  const tw = seo.twitter || {};
  const image = og.image || tw.image;
  const media = h('div', { class: 'social-media' });
  if (image) {
    // The image is only fetched if the user asks: previews stay offline by default.
    const btn = h('button', { class: 'btn small', type: 'button' }, 'Load image preview');
    btn.addEventListener('click', () => {
      clear(media).append(h('img', { src: image, alt: 'Open Graph image', referrerpolicy: 'no-referrer', loading: 'lazy' }));
    });
    media.append(h('span', { class: 'muted small' }, shortUrl(image, 50)), btn);
  } else {
    media.append(h('span', { class: 'muted small' }, 'No og:image'));
  }
  return h('div', { class: 'social' },
    media,
    h('div', { class: 'social-text' },
      h('div', { class: 'social-host' }, (og.site_name || host || '').toUpperCase()),
      h('div', { class: 'social-title' }, truncate(og.title || tw.title || seo.title || 'Untitled', 90)),
      h('div', { class: 'social-desc' }, truncate(og.description || tw.description || seo.description || '', 140))));
}

export function headingOutline(outline) {
  if (!outline.length) return h('p', { class: 'muted' }, 'No headings on this page.');
  let prev = 0;
  return h('ol', { class: 'outline' }, outline.slice(0, 120).map((x) => {
    const skipped = prev && x.l > prev + 1;
    prev = x.l;
    return h('li', { class: `lvl-${x.l}${skipped ? ' skipped' : ''}${x.hidden ? ' hidden-h' : ''}`, style: { paddingLeft: `${(x.l - 1) * 14}px` } },
      h('span', { class: 'h-tag' }, `H${x.l}`),
      h('span', { class: 'h-text' }, x.t || '(empty)'));
  }));
}

export function designSection(design, { onCopy } = {}) {
  if (!design) return h('p', { class: 'muted' }, 'No design data.');
  const swatches = (list) => h('div', { class: 'swatches' }, list.map((c) =>
    h('button', { class: 'swatch', type: 'button', title: `Copy ${c.hex}`, onclick: () => onCopy && onCopy(c.hex) },
      h('span', { class: 'swatch-color', style: { background: c.hex } }),
      h('span', { class: 'swatch-hex' }, c.hex))));
  return h('div', { class: 'design' },
    h('div', { class: 'mini-label' }, 'Fonts in use'),
    design.fonts.length
      ? h('ul', { class: 'font-list' }, design.fonts.map((f) => h('li', {},
        h('span', { class: 'font-name' }, f.family),
        h('span', { class: 'muted small' }, `${f.weights.join(', ')}${f.webfont ? ' · web font' : ''}`))))
      : h('p', { class: 'muted' }, 'No text found.'),
    h('div', { class: 'mini-label' }, 'Text colors'),
    swatches(design.textColors || []),
    h('div', { class: 'mini-label' }, 'Background colors'),
    swatches(design.backgrounds || []));
}

export function tagIds(ids) {
  const rows = [
    ['Google Analytics 4', ids.ga4],
    ['Universal Analytics', ids.ua],
    ['Google Tag Manager', ids.gtm],
    ['Google Ads', ids.aw],
  ].filter(([, v]) => v && v.length);
  if (!rows.length) return null;
  return h('dl', { class: 'facts ids' }, rows.map(([k, v]) => h('div', { class: 'fact' }, h('dt', {}, k), h('dd', {}, v.join(', ')))));
}

// ---------------------------------------------------------------- misc

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

let toastTimer = null;
export function toast(message, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 2200);
}

export function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
