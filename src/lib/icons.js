// Scanline brand mark. Built with createElementNS, never innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Same geometry as assets/icon-small.svg (512×512): lens ring open at the top right,
// the signature dot sitting in the gap, and a flat-ended handle.
const RING = 'M326.11 210.21A104 104 0 1 1 235.56 119.66';
const HANDLE = 'M317.64 317.64L395.42 395.42';
const DOT = { cx: 296.42, cy: 149.34, r: 36 };

/** The Scanline brand mark: a magnifier with the family's dot, charcoal on a periwinkle circle. */
export function logo(size = 24) {
  const el = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const svg = el('svg', { viewBox: '0 0 512 512', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    el('circle', { cx: 256, cy: 256, r: 256, fill: '#6B8AFF' }),
    el('path', { d: RING, fill: 'none', stroke: '#1E1D22', 'stroke-width': 64 }),
    el('path', { d: HANDLE, fill: 'none', stroke: '#1E1D22', 'stroke-width': 84 }),
    el('circle', { ...DOT, fill: '#1E1D22' }));
  return svg;
}
