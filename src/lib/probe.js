// Injected into the page's MAIN world via chrome.scripting.executeScript({ func }).
// It must stay fully self-contained (it is serialized) and must only return plain JSON data.
// It reads a list of global paths and a few framework fingerprints that are invisible from the
// extension's isolated world (JS properties on window and DOM nodes are per-world).

export function mainWorldProbe(paths) {
  const out = { globals: {}, special: {} };
  const isNode = (v) => {
    try {
      return typeof Node === 'function' && (v instanceof Node || v instanceof HTMLCollection);
    } catch (e) {
      return false;
    }
  };
  const read = (path) => {
    let cur = window;
    const parts = path.split('.');
    for (let i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      const t = typeof cur;
      if (t !== 'object' && t !== 'function') return undefined;
      try {
        cur = cur[parts[i]];
      } catch (e) {
        return undefined;
      }
    }
    return cur;
  };

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    let v;
    try {
      v = read(path);
    } catch (e) {
      continue;
    }
    if (v === undefined || v === null || v === false || v === '') continue;
    // Named window access: <div id="Chart"> makes window.Chart an element. Ignore those.
    if (isNode(v)) continue;
    const t = typeof v;
    out.globals[path] = t === 'string' || t === 'number' ? String(v).slice(0, 120) : true;
  }

  const special = out.special;
  try {
    const els = document.querySelectorAll('body, body *');
    const limit = Math.min(els.length, 4000);
    for (let i = 0; i < limit; i++) {
      const el = els[i];
      if (!special.react && '_reactRootContainer' in el) special.react = true;
      if (!special.vue3) {
        const app = el.__vue_app__;
        if (app) special.vue3 = typeof app.version === 'string' ? app.version : '3';
      }
      if (!special.vue2 && el.__vue__) {
        let v = '2';
        try {
          v = el.__vue__.$root.$options._base.version || v;
        } catch (e) { /* keep default */ }
        special.vue2 = String(v);
      }
      const keys = Object.keys(el);
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        if (key.startsWith('__react')) special.react = true;
        else if (key === '__ngContext__') special.angularIvy = true;
      }
    }
  } catch (e) { /* ignore */ }

  try {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook && hook.renderers && typeof hook.renderers.forEach === 'function') {
      hook.renderers.forEach((r) => {
        if (r && typeof r.version === 'string') special.reactVersion = r.version;
      });
    }
  } catch (e) { /* ignore */ }

  try {
    const ngRoot = document.querySelector('[ng-version]');
    if (ngRoot) special.angular = ngRoot.getAttribute('ng-version') || true;
    // Angular only publishes window.ng debugging helpers in development mode.
    if (window.ng && typeof window.ng.getComponent === 'function') special.angularDevMode = true;
  } catch (e) { /* ignore */ }

  try {
    const sv = window.__svelte && window.__svelte.v;
    if (sv && typeof sv.forEach === 'function') {
      const versions = [];
      sv.forEach((x) => versions.push(String(x)));
      if (versions.length) special.svelte = versions.sort().pop();
    }
  } catch (e) { /* ignore */ }

  try {
    const keys = Object.keys(window);
    for (let i = 0; i < keys.length; i++) {
      if (/^webpack(?:Chunk|Jsonp)/.test(keys[i])) {
        special.webpack = true;
        break;
      }
    }
  } catch (e) { /* ignore */ }

  return out;
}
