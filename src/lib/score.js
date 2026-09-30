// Weighted scoring. Info checks are shown but never affect the score.

import { CATEGORIES } from './audit.js';

export const STATUS_VALUE = { pass: 1, warn: 0.5, fail: 0 };

export function grade(score) {
  if (score == null) return '-';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function scoreChecks(checks) {
  const categories = {};
  for (const c of CATEGORIES) {
    const list = checks.filter((k) => k.cat === c.id);
    const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    let weight = 0;
    let earned = 0;
    for (const k of list) {
      counts[k.status] = (counts[k.status] || 0) + 1;
      if (k.status in STATUS_VALUE) {
        const w = k.weight || 1;
        weight += w;
        earned += w * STATUS_VALUE[k.status];
      }
    }
    const score = weight ? Math.round((100 * earned) / weight) : null;
    categories[c.id] = { id: c.id, label: c.label, score, grade: grade(score), counts };
  }

  let total = 0;
  let totalWeight = 0;
  for (const c of CATEGORIES) {
    const s = categories[c.id].score;
    if (s == null) continue;
    total += s * c.weight;
    totalWeight += c.weight;
  }
  const overall = totalWeight ? Math.round(total / totalWeight) : 0;
  const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const k of checks) counts[k.status] = (counts[k.status] || 0) + 1;
  return { overall, grade: grade(overall), categories, counts };
}

/** The most important problems first: failures, then by weight. */
export function topIssues(checks, limit = 8) {
  const rank = { fail: 0, warn: 1 };
  return checks
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .sort((a, b) => rank[a.status] - rank[b.status] || (b.weight || 1) - (a.weight || 1))
    .slice(0, limit);
}
