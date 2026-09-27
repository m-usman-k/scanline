// Compare two scans of the same page to show what improved or regressed.

const BAD = new Set(['fail', 'warn']);
const RANK = { fail: 0, warn: 1, pass: 2 };

/**
 * @param {object} current  full result
 * @param {object} previous full result, or a history summary (then only score deltas are available)
 */
export function compareResults(current, previous) {
  if (!current || !previous) return null;
  const prevScores = previous.scores
    ? { overall: previous.scores.overall, cats: Object.fromEntries(Object.entries(previous.scores.categories).map(([k, v]) => [k, v.score])) }
    : { overall: previous.score, cats: previous.cats || {} };

  const catDeltas = {};
  for (const [k, v] of Object.entries(current.scores.categories)) {
    const before = prevScores.cats[k];
    if (v.score != null && before != null) catDeltas[k] = v.score - before;
  }

  const out = {
    previousAt: previous.scannedAt || previous.at,
    scoreDelta: current.scores.overall - prevScores.overall,
    catDeltas,
    fixed: [],
    regressed: [],
    stackAdded: [],
    stackRemoved: [],
    detailed: !!previous.checks,
  };
  if (!previous.checks) return out;

  const before = new Map(previous.checks.map((c) => [c.id, c]));
  for (const c of current.checks) {
    const p = before.get(c.id);
    if (!p || !(c.status in RANK) || !(p.status in RANK)) continue;
    if (RANK[c.status] > RANK[p.status] && BAD.has(p.status)) out.fixed.push({ id: c.id, title: c.title, from: p.status, to: c.status, cat: c.cat });
    else if (RANK[c.status] < RANK[p.status]) out.regressed.push({ id: c.id, title: c.title, from: p.status, to: c.status, cat: c.cat });
  }
  const names = (r) => new Set((r.stack || []).filter((t) => !t.implied).map((t) => t.name));
  const now = names(current);
  const then = names(previous);
  out.stackAdded = Array.from(now).filter((n) => !then.has(n));
  out.stackRemoved = Array.from(then).filter((n) => !now.has(n));
  return out;
}
