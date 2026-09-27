// Offline knowledge of vulnerable and end-of-life versions for commonly detected technologies.
// This is a curated snapshot of well-known advisories, not an exhaustive vulnerability feed:
// "no known issues" means none from this list, so keep dependencies current regardless.

import { inRange, parseVersion } from './util.js';

// Each advisory applies when the version is inside ANY of its ranges ([atOrAbove, below)).
const ADVISORIES = {
  jQuery: [
    { ranges: [[null, '1.9.0']], severity: 'medium', ids: ['CVE-2012-6708'], summary: 'Selector strings can be interpreted as HTML (XSS via $(location.hash)).' },
    { ranges: [['1.4.0', '3.0.0']], severity: 'medium', ids: ['CVE-2015-9251'], summary: 'Cross-domain Ajax responses with a JavaScript content type are executed.' },
    { ranges: [[null, '3.4.0']], severity: 'medium', ids: ['CVE-2019-11358'], summary: 'Prototype pollution in jQuery.extend(true, …).' },
    { ranges: [['1.0.3', '3.5.0']], severity: 'medium', ids: ['CVE-2020-11022', 'CVE-2020-11023'], summary: 'XSS when passing untrusted HTML to .html(), .append() and similar methods.' },
  ],
  'jQuery UI': [
    { ranges: [[null, '1.13.0']], severity: 'medium', ids: ['CVE-2021-41182', 'CVE-2021-41183', 'CVE-2021-41184'], summary: 'XSS through datepicker and .position() options.' },
    { ranges: [[null, '1.13.2']], severity: 'medium', ids: ['CVE-2022-31160'], summary: 'XSS when refreshing checkboxradio labels.' },
  ],
  Bootstrap: [
    { ranges: [[null, '3.4.0'], ['4.0.0', '4.1.2']], severity: 'medium', ids: ['CVE-2018-14040', 'CVE-2018-14041', 'CVE-2018-14042'], summary: 'XSS in collapse, scrollspy and tooltip data attributes.' },
    { ranges: [[null, '3.4.1'], ['4.0.0', '4.3.1']], severity: 'medium', ids: ['CVE-2019-8331'], summary: 'XSS in tooltip/popover data-template.' },
  ],
  AngularJS: [
    { ranges: [[null, '1.8.0']], severity: 'medium', ids: ['CVE-2020-7676'], summary: 'XSS via <option> elements in <select>.' },
    { ranges: [[null, null]], severity: 'medium', ids: ['CVE-2023-26116', 'CVE-2023-26117', 'CVE-2023-26118'], summary: 'ReDoS issues that will never be patched because AngularJS is end-of-life.' },
  ],
  Lodash: [
    { ranges: [[null, '4.17.12']], severity: 'high', ids: ['CVE-2019-10744'], summary: 'Prototype pollution in defaultsDeep.' },
    { ranges: [[null, '4.17.21']], severity: 'high', ids: ['CVE-2021-23337'], summary: 'Command injection through template().' },
    { ranges: [[null, '4.17.21']], severity: 'medium', ids: ['CVE-2020-28500'], summary: 'ReDoS in toNumber, trim and trimEnd.' },
  ],
  'Underscore.js': [
    { ranges: [['1.3.2', '1.12.1']], severity: 'high', ids: ['CVE-2021-23358'], summary: 'Arbitrary code execution through template().' },
  ],
  'Moment.js': [
    { ranges: [[null, '2.29.4']], severity: 'medium', ids: ['CVE-2022-31129'], summary: 'Inefficient RFC 2822 parsing enables ReDoS with long inputs.' },
  ],
  Handlebars: [
    { ranges: [[null, '4.7.7']], severity: 'high', ids: ['CVE-2021-23369', 'CVE-2021-23383'], summary: 'Remote code execution when compiling untrusted templates.' },
  ],
  DOMPurify: [
    { ranges: [[null, '2.0.17']], severity: 'high', ids: ['CVE-2020-26870'], summary: 'Mutation XSS bypass.' },
    { ranges: [[null, '2.5.4'], ['3.0.0', '3.1.3']], severity: 'high', ids: ['CVE-2024-45801'], summary: 'Nesting-depth check bypass leading to XSS.' },
    { ranges: [['3.0.0', '3.2.4']], severity: 'medium', ids: ['CVE-2025-26791'], summary: 'Mutation XSS when SAFE_FOR_TEMPLATES is enabled.' },
  ],
  'Chart.js': [
    { ranges: [[null, '2.9.4']], severity: 'medium', ids: ['CVE-2020-7746'], summary: 'Prototype pollution through chart options.' },
  ],
  Highcharts: [
    { ranges: [[null, '9.0.0']], severity: 'medium', ids: ['CVE-2021-29489'], summary: 'XSS through chart options.' },
  ],
  'Knockout.js': [
    { ranges: [[null, '3.5.0']], severity: 'medium', ids: ['CVE-2019-14862'], summary: 'XSS via script tags in templates.' },
  ],
  Axios: [
    { ranges: [['0.8.1', '1.6.0']], severity: 'medium', ids: ['CVE-2023-45857'], summary: 'XSRF-TOKEN cookie value is sent to third-party hosts.' },
  ],
  'Next.js': [
    { ranges: [['11.1.4', '12.3.5'], ['13.0.0', '13.5.9'], ['14.0.0', '14.2.25'], ['15.0.0', '15.2.3']], severity: 'high', ids: ['CVE-2025-29927'], summary: 'Middleware authorization bypass via the x-middleware-subrequest header (self-hosted apps using middleware).' },
    { ranges: [['15.0.0', '15.0.5'], ['15.1.0', '15.1.9'], ['15.2.0', '15.2.6'], ['15.3.0', '15.3.6'], ['15.4.0', '15.4.8'], ['15.5.0', '15.5.7'], ['16.0.0', '16.0.7']], severity: 'high', ids: ['CVE-2025-55182'], summary: 'Critical remote code execution in React Server Components (App Router apps).' },
  ],
};

// End-of-life / discontinued software. `date` is when support ended (ISO); ranges as above.
const END_OF_LIFE = {
  AngularJS: [{ date: '2021-12-31', note: 'AngularJS reached end-of-life on December 31, 2021.' }],
  'Vue.js': [{ ranges: [[null, '3.0.0']], date: '2023-12-31', note: 'Vue 2 reached end-of-life on December 31, 2023.' }],
  Bootstrap: [
    { ranges: [[null, '4.0.0']], date: '2019-07-24', note: 'Bootstrap 3 reached end-of-life in July 2019.' },
    { ranges: [['4.0.0', '5.0.0']], date: '2023-01-01', note: 'Bootstrap 4 reached end-of-life on January 1, 2023.' },
  ],
  jQuery: [{ ranges: [[null, '3.0.0']], date: '2016-06-09', note: 'jQuery 1.x and 2.x are no longer maintained.' }],
  CKEditor: [{ ranges: [[null, '5.0.0']], date: '2023-06-30', note: 'CKEditor 4 reached end-of-life in June 2023 (only paid LTS remains).' }],
  Prototype: [{ date: '2015-09-22', note: 'Prototype.js has not been maintained for years.' }],
  MooTools: [{ date: '2016-01-15', note: 'MooTools is no longer maintained.' }],
  YUI: [{ date: '2014-08-29', note: 'Yahoo stopped developing YUI in 2014.' }],
  Drupal: [
    { ranges: [[null, '8.0.0']], date: '2025-01-05', note: 'Drupal 7 reached end-of-life on January 5, 2025.' },
    { ranges: [['8.0.0', '9.0.0']], date: '2021-11-02', note: 'Drupal 8 reached end-of-life on November 2, 2021.' },
    { ranges: [['9.0.0', '10.0.0']], date: '2023-11-01', note: 'Drupal 9 reached end-of-life on November 1, 2023.' },
  ],
  Joomla: [
    { ranges: [[null, '4.0.0']], date: '2023-08-17', note: 'Joomla 3 reached end-of-life on August 17, 2023.' },
    { ranges: [['4.0.0', '5.0.0']], date: '2025-10-17', note: 'Joomla 4 reached end-of-life in October 2025.' },
  ],
  Magento: [{ ranges: [[null, '2.0.0']], date: '2020-06-30', note: 'Magento 1 reached end-of-life on June 30, 2020.' }],
  PHP: [
    { ranges: [[null, '7.4.0']], date: '2021-12-06', note: 'PHP versions before 7.4 are long unsupported.' },
    { ranges: [['7.4.0', '8.0.0']], date: '2022-11-28', note: 'PHP 7.4 reached end-of-life on November 28, 2022.' },
    { ranges: [['8.0.0', '8.1.0']], date: '2023-11-26', note: 'PHP 8.0 reached end-of-life on November 26, 2023.' },
    { ranges: [['8.1.0', '8.2.0']], date: '2025-12-31', note: 'PHP 8.1 reached end-of-life on December 31, 2025.' },
    { ranges: [['8.2.0', '8.3.0']], date: '2026-12-31', note: 'PHP 8.2 security support ends on December 31, 2026.' },
    { ranges: [['8.3.0', '8.4.0']], date: '2027-12-31', note: 'PHP 8.3 security support ends on December 31, 2027.' },
  ],
};

// Advisory that applies regardless of version (maintenance-mode libraries).
const NOTICES = {
  'Moment.js': 'Moment.js is in maintenance mode; its authors recommend Luxon, date-fns, Day.js or Temporal for new code.',
};

const findRange = (version, ranges) =>
  ranges.find(([atOrAbove, below]) => inRange(version, { atOrAbove: atOrAbove || undefined, below: below || undefined }));

function matches(version, ranges) {
  if (!ranges) return true;
  if (!version || !parseVersion(version)) return false;
  return !!findRange(version, ranges);
}

/** Known advisories for a technology at a given version (fixedIn is the first safe version on that line). */
export function advisoriesFor(name, version) {
  const out = [];
  for (const a of ADVISORIES[name] || []) {
    const base = { severity: a.severity, ids: a.ids, summary: a.summary };
    if (a.ranges.some(([lo, hi]) => !lo && !hi)) {
      out.push({ ...base, fixedIn: null });
      continue;
    }
    if (!version || !parseVersion(version)) continue;
    const hit = findRange(version, a.ranges);
    if (hit) out.push({ ...base, fixedIn: hit[1] });
  }
  return out;
}

/** End-of-life notice for a technology at a given version, if support has ended by `today`. */
export function endOfLifeFor(name, version, today = new Date()) {
  for (const e of END_OF_LIFE[name] || []) {
    if (e.ranges && !matches(version, e.ranges)) continue;
    if (e.date && new Date(e.date) > today) continue;
    return e.note;
  }
  return null;
}

/** Annotate detected technologies with advisories, EOL status and notices. */
export function assessStack(stack, today = new Date()) {
  return stack.map((t) => {
    const vulns = advisoriesFor(t.name, t.version);
    const eol = endOfLifeFor(t.name, t.version, today);
    const notice = NOTICES[t.name] || null;
    return { ...t, vulns, eol, notice };
  });
}

export const HAS_ADVISORY_DATA = new Set([...Object.keys(ADVISORIES), ...Object.keys(END_OF_LIFE)]);
