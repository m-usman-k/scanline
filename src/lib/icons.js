// Minimal stroke icon set (24×24 grid). Built with createElementNS, never innerHTML.

const PATHS = {
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  chevron: 'm9 18 6-6-6-6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  gauge: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  person: 'M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 8.5l8 2 8-2M12 10.5v4.5M8.5 22l3.5-7 3.5 7',
  eyeOff: 'M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a13 13 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  back: 'M19 12H5M12 19l-7-7 7-7',
  lock: 'M5 11h14v11H5zM8 11V7a4 4 0 0 1 8 0v4',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 3-4 3h-2a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 22zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', PATHS[name] || PATHS.info);
  svg.append(path);
  return svg;
}

// Brand mark geometry (512×512), generated from assets/icon-small.svg.
const MARK_S = 'M617 -15Q513 -15 413.5 6.0Q314 27 227.0 67.5Q140 108 70 165L197 391Q281 322 391.0 284.5Q501 247 617 247Q751 247 825.0 292.5Q899 338 899 421V422Q899 485 862.0 518.5Q825 552 764.5 568.0Q704 584 633 595Q548 608 461.0 627.5Q374 647 301.0 689.5Q228 732 183.5 811.0Q139 890 139 1022V1023Q139 1236 279.0 1352.5Q419 1469 675 1469Q793 1469 915.0 1429.5Q1037 1390 1142 1317L1026 1085Q942 1144 850.5 1175.5Q759 1207 675 1207Q549 1207 480.0 1165.5Q411 1124 411 1049V1048Q411 978 452.0 942.0Q493 906 559.0 888.5Q625 871 701 856Q785 840 868.0 816.5Q951 793 1020.0 749.0Q1089 705 1130.0 628.0Q1171 551 1171 428V426Q1171 216 1026.0 100.5Q881 -15 617 -15Z';
const MARK_S_TRANSFORM = 'translate(122.20 412.77) scale(0.21563 -0.21563)';
// Barcode bars [x, y, width, height], clipped to the S outline.
const MARK_BARS = [
  [134.29, 90.00, 34.50, 332.00],
  [177.99, 90.00, 23.00, 332.00],
  [210.19, 90.00, 46.00, 332.00],
  [265.39, 90.00, 23.00, 332.00],
  [297.59, 90.00, 34.50, 332.00],
  [341.29, 90.00, 23.00, 332.00],
  [373.49, 90.00, 46.00, 332.00],
];

/** The Scanline brand mark: an "S" built from barcode bars. */
export function logo(size = 24) {
  const el = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const id = `sl-mark-${Math.random().toString(36).slice(2, 8)}`;
  const svg = el('svg', { viewBox: '0 0 512 512', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' });
  const clip = el('clipPath', { id });
  clip.append(el('path', { d: MARK_S, transform: MARK_S_TRANSFORM }));
  const bars = el('g', { 'clip-path': `url(#${id})`, fill: '#6B8AFF' });
  bars.append(...MARK_BARS.map(([x, y, width, height]) => el('rect', { x, y, width, height })));
  svg.append(el('rect', { width: 512, height: 512, rx: 112, fill: '#1E1D22' }), clip, bars);
  return svg;
}
