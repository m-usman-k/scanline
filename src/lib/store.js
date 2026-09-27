// Settings and scan history in chrome.storage.local (never synced, never uploaded).

import { stripHash } from './util.js';

export const DEFAULT_SETTINGS = { theme: 'system', autoScan: true, badge: true, history: true };
const HISTORY_KEY = 'history';
const MAX_HISTORY = 150;
const MAX_FULL_SCANS = 20;

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function summarize(r) {
  return {
    id: r.id,
    url: r.url,
    host: r.host,
    title: r.title,
    at: r.scannedAt,
    score: r.scores.overall,
    grade: r.scores.grade,
    cats: Object.fromEntries(Object.entries(r.scores.categories).map(([k, v]) => [k, v.score])),
    counts: r.scores.counts,
    full: true,
  };
}

export async function getHistory() {
  const { [HISTORY_KEY]: history } = await chrome.storage.local.get(HISTORY_KEY);
  return (history || []).filter((h) => !h.ephemeral);
}

export async function getScan(id) {
  const key = `scan:${id}`;
  return (await chrome.storage.local.get(key))[key] || null;
}

/** Store a result. With history off, only the latest scan is kept (so the report page can open it). */
export async function saveScan(result, { keepHistory = true } = {}) {
  const { [HISTORY_KEY]: stored } = await chrome.storage.local.get(HISTORY_KEY);
  let history = (stored || []).filter((h) => h.id !== result.id);
  const entry = { ...summarize(result), ephemeral: !keepHistory };
  const drop = [];

  if (!keepHistory) {
    drop.push(...history.filter((h) => h.ephemeral && h.full).map((h) => h.id));
    history = history.filter((h) => !h.ephemeral);
  }
  history.unshift(entry);

  // Keep full results only for the most recent scans; older entries keep their summary.
  let full = 0;
  history = history.map((h) => {
    if (!h.full) return h;
    full++;
    if (full <= MAX_FULL_SCANS) return h;
    drop.push(h.id);
    return { ...h, full: false };
  });
  for (const h of history.slice(MAX_HISTORY)) if (h.full) drop.push(h.id);
  history = history.slice(0, MAX_HISTORY);

  await chrome.storage.local.set({ [`scan:${result.id}`]: result, [HISTORY_KEY]: history });
  if (drop.length) await chrome.storage.local.remove(drop.map((id) => `scan:${id}`));
}

/** Update a stored result in place (e.g. after a deep scan). */
export async function updateScan(result) {
  const { [HISTORY_KEY]: stored } = await chrome.storage.local.get(HISTORY_KEY);
  const history = (stored || []).map((h) => (h.id === result.id ? { ...summarize(result), ephemeral: h.ephemeral } : h));
  await chrome.storage.local.set({ [`scan:${result.id}`]: result, [HISTORY_KEY]: history });
}

/** Most recent earlier scan of the same URL (summary, plus the full result when still stored). */
export async function previousScan(url, excludeId) {
  const { [HISTORY_KEY]: stored } = await chrome.storage.local.get(HISTORY_KEY);
  const target = stripHash(url);
  const entry = (stored || []).find((h) => h.id !== excludeId && stripHash(h.url) === target);
  if (!entry) return null;
  return { entry, result: entry.full ? await getScan(entry.id) : null };
}

export async function historyFor(url) {
  const target = stripHash(url);
  return (await getHistory()).filter((h) => stripHash(h.url) === target);
}

export async function clearHistory() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('scan:'));
  await chrome.storage.local.remove([...keys, HISTORY_KEY]);
}
