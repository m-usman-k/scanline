// Export formats: JSON, Markdown report and a short plain-text summary.

import { CATEGORIES } from './audit.js';
import { topIssues } from './score.js';
import { explain } from './kb.js';
import { formatBytes, formatMs } from './util.js';

const STATUS_TEXT = { pass: 'Pass', warn: 'Warn', fail: 'Fail', info: 'Info' };
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function fileBase(result) {
  const date = String(result.scannedAt || '').slice(0, 10);
  return `scanline-${(result.host || 'page').replace(/[^a-z0-9.-]+/gi, '_')}-${date}`;
}

export function toJson(result) {
  return JSON.stringify(result, null, 2);
}

export function summaryText(result) {
  const s = result.scores;
  const cats = CATEGORIES.map((c) => `${c.label} ${s.categories[c.id].score ?? '-'}`).join(' · ');
  const issues = topIssues(result.checks, 5).map((c) => `- [${STATUS_TEXT[c.status]}] ${c.title}: ${c.value}`);
  const stack = result.stack.filter((t) => !t.implied).slice(0, 12).map((t) => (t.version ? `${t.name} ${t.version}` : t.name));
  return [
    `Scanline report for ${result.url}`,
    `Score ${s.overall}/100 (${s.grade}) · ${cats}`,
    issues.length ? `Top issues:\n${issues.join('\n')}` : 'No issues found.',
    stack.length ? `Stack: ${stack.join(', ')}` : '',
    `Scanned ${new Date(result.scannedAt).toLocaleString()}`,
  ].filter(Boolean).join('\n');
}

export function toMarkdown(result) {
  const s = result.scores;
  const v = (result.insights && result.insights.vitals) || {};
  const lines = [];
  lines.push(`# Scanline report: ${result.host}`);
  lines.push('');
  lines.push(`- **URL:** ${result.url}`);
  lines.push(`- **Scanned:** ${new Date(result.scannedAt).toLocaleString()}`);
  lines.push(`- **Overall score:** ${s.overall}/100 (grade ${s.grade})`);
  lines.push(`- **Checks:** ${s.counts.fail} failed, ${s.counts.warn} warnings, ${s.counts.pass} passed`);
  lines.push('');
  lines.push('| Category | Score | Failed | Warnings | Passed |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const c of CATEGORIES) {
    const x = s.categories[c.id];
    lines.push(`| ${c.label} | ${x.score ?? '-'} | ${x.counts.fail} | ${x.counts.warn} | ${x.counts.pass} |`);
  }
  lines.push('');
  lines.push('## Core Web Vitals (this page load)');
  lines.push('');
  lines.push(`LCP ${v.lcp != null ? formatMs(v.lcp) : 'n/a'} · CLS ${v.cls != null ? v.cls.toFixed(3) : 'n/a'} · INP ${v.inp != null ? formatMs(v.inp) : 'n/a'} · FCP ${v.fcp != null ? formatMs(v.fcp) : 'n/a'} · TTFB ${v.ttfb != null ? formatMs(v.ttfb) : 'n/a'} · Page weight ${formatBytes(result.insights && result.insights.totals ? result.insights.totals.bytes : 0)}`);
  lines.push('');

  const issues = topIssues(result.checks, 50);
  if (issues.length) {
    lines.push('## Issues to fix');
    lines.push('');
    for (const c of issues) {
      const kb = explain(c.id);
      lines.push(`### ${c.status === 'fail' ? '❌' : '⚠️'} ${c.title} (${CATEGORIES.find((x) => x.id === c.cat)?.label || c.cat})`);
      lines.push('');
      lines.push(c.value);
      for (const d of (c.details || []).slice(0, 8)) lines.push(`- ${d}`);
      for (const smp of (c.samples || []).slice(0, 5)) lines.push(`- \`${smp.replace(/`/g, "'")}\``);
      if (kb) {
        lines.push('');
        lines.push(`**Why:** ${kb.why}`);
        lines.push('');
        lines.push(`**Fix:** ${kb.fix}`);
      }
      lines.push('');
    }
  }

  for (const cat of CATEGORIES) {
    const list = result.checks.filter((c) => c.cat === cat.id);
    if (!list.length) continue;
    lines.push(`## ${cat.label} (${s.categories[cat.id].score ?? '-'})`);
    lines.push('');
    lines.push('| Check | Status | Result |');
    lines.push('|---|---|---|');
    for (const c of list) lines.push(`| ${md(c.title)} | ${STATUS_TEXT[c.status]} | ${md(c.value)} |`);
    lines.push('');
  }

  const stack = result.stack.filter((t) => !t.implied || t.version);
  if (stack.length) {
    lines.push('## Technology stack');
    lines.push('');
    lines.push('| Technology | Category | Version | Notes |');
    lines.push('|---|---|---|---|');
    for (const t of result.stack) {
      const notes = [...(t.vulns || []).map((x) => x.ids.join(', ')), t.eol ? 'End-of-life' : '', t.deprecated ? 'Discontinued' : ''].filter(Boolean).join('; ');
      lines.push(`| ${md(t.name)} | ${md(t.category)} | ${md(t.version || '')} | ${md(notes)} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Generated locally by Scanline ${result.extVersion}. No data was sent to any server.`);
  return lines.join('\n');
}
