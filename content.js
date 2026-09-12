(() => {
  if (window.__scanlineLoaded) return;
  window.__scanlineLoaded = true;

  function detectTechStack() {
    const stack = [];
    const html = document.documentElement.outerHTML.toLowerCase();

    const frameworks = [
      { name: 'React', test: () => !!document.querySelector('[data-reactroot]') || html.includes('__next') || !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || html.includes('reactroot') },
      { name: 'Vue.js', test: () => !!window.__VUE__ || !!window.__VUE_DEVTOOLS_GLOBAL_HOOK__ || html.includes('data-v-') || !!document.querySelector('[data-v-]') },
      { name: 'Angular', test: () => !!window.ng || !!document.querySelector('[ng-version]') || html.includes('ng-version') || !!window.getAllAngularRootElements },
      { name: 'Svelte', test: () => html.includes('svelte-') || !!document.querySelector('[class*="svelte-"]') },
      { name: 'Next.js', test: () => html.includes('__next') || !!document.getElementById('__next') || html.includes('_next/static') },
      { name: 'Nuxt.js', test: () => html.includes('__nuxt') || !!document.getElementById('__nuxt') || html.includes('_nuxt/') },
      { name: 'Gatsby', test: () => html.includes('gatsby-') || !!document.querySelector('[data-gatsby-head]') },
      { name: 'Remix', test: () => html.includes('__remix') || html.includes('remix-run') },
      { name: 'Astro', test: () => html.includes('astro-') || !!document.querySelector('[data-astro-cid]') },
      { name: 'jQuery', test: () => !!window.jQuery || !!window.$ },
      { name: 'Backbone.js', test: () => !!window.Backbone },
      { name: 'Ember.js', test: () => !!window.Ember || !!window.Ember Inspector },
    ];

    const cms = [
      { name: 'WordPress', test: () => html.includes('wp-content') || html.includes('wp-includes') || !!document.querySelector('meta[name="generator"][content*="WordPress"]') },
      { name: 'Drupal', test: () => html.includes('drupal') || html.includes('sites/default/files') || !!document.querySelector('meta[name="generator"][content*="Drupal"]') },
      { name: 'Joomla', test: () => html.includes('joomla') || !!document.querySelector('meta[name="generator"][content*="Joomla"]') },
      { name: 'Shopify', test: () => html.includes('shopify') || html.includes('cdn.shopify.com') || !!window.Shopify },
      { name: 'Wix', test: () => html.includes('wix.com') || html.includes('wixstatic.com') || !!window.wixBiSession },
      { name: 'Squarespace', test: () => html.includes('squarespace') || html.includes('sqsp') },
      { name: 'Ghost', test: () => html.includes('ghost-') || html.includes('content/ghost') },
      { name: 'Hugo', test: () => html.includes('hugo-') || html.includes('powered by hugo') },
      { name: 'Webflow', test: () => html.includes('webflow') || !!document.querySelector('[class*="w-"]') },
      { name: 'Contentful', test: () => html.includes('contentful') },
      { name: 'Strapi', test: () => html.includes('strapi') },
    ];

    const css = [
      { name: 'Bootstrap', test: () => html.includes('bootstrap') || !!document.querySelector('[class*="col-"]') || !!document.querySelector('[class*="btn-"]') },
      { name: 'Tailwind CSS', test: () => html.includes('tailwindcss') || !!document.querySelector('[class*="flex "]') || !!document.querySelector('[class*="grid "]') },
      { name: 'Material UI', test: () => html.includes('material') || !!document.querySelector('[class*="MuiBox"]') || !!document.querySelector('[class*="makeStyles"]') },
      { name: 'Bulma', test: () => html.includes('bulma') || !!document.querySelector('[class*="is-"]') },
      { name: 'Foundation', test: () => html.includes('foundation') || !!document.querySelector('[class*="grid-x"]') },
      { name: 'Tailwind', test: () => !!document.querySelector('[class*="tw-"]') || html.includes('tailwind') },
    ];

    const analytics = [
      { name: 'Google Analytics', test: () => html.includes('google-analytics.com') || html.includes('gtag(') || html.includes('ga(') || html.includes('googletagmanager') },
      { name: 'Google Tag Manager', test: () => html.includes('googletagmanager.com/gtm.js') || html.includes('gtm.js') },
      { name: 'Hotjar', test: () => html.includes('hotjar.com') || !!window.hj },
      { name: 'Mixpanel', test: () => html.includes('mixpanel.com') || !!window.mixpanel },
      { name: 'Amplitude', test: () => html.includes('amplitude.com') || !!window.amplitude },
      { name: 'Segment', test: () => html.includes('segment.com') || html.includes('analytics.js') },
      { name: 'Plausible', test: () => html.includes('plausible.io') },
      { name: 'Matomo', test: () => html.includes('matomo') || html.includes('piwik') },
      { name: 'Clarity', test: () => html.includes('clarity.ms') },
      { name: 'FullStory', test: () => html.includes('fullstory.com') || !!window.FS },
      { name: 'Heap', test: () => html.includes('heap-') || !!window.heap },
      { name: 'PostHog', test: () => html.includes('posthog') || !!window.posthog },
    ];

    const cdn = [
      { name: 'Cloudflare', test: () => html.includes('cloudflare') || html.includes('cf-ray') },
      { name: 'AWS CloudFront', test: () => html.includes('cloudfront.net') || html.includes('x-amz-cf') },
      { name: 'Akamai', test: () => html.includes('akamai') || html.includes('akamaihd') },
      { name: 'Fastly', test: () => html.includes('fastly') },
      { name: 'Vercel', test: () => html.includes('vercel') || html.includes('_vercel') },
      { name: 'Netlify', test: () => html.includes('netlify') },
      { name: 'Firebase', test: () => html.includes('firebase') || !!window.firebase },
    ];

    const other = [
      { name: 'Font Awesome', test: () => html.includes('font-awesome') || html.includes('fontawesome') },
      { name: 'Animate.css', test: () => html.includes('animate.min.css') || html.includes('animate.css') },
      { name: 'AOS', test: () => html.includes('aos') },
      { name: 'Three.js', test: () => !!window.THREE || html.includes('three.js') },
      { name: 'D3.js', test: () => !!window.d3 },
      { name: 'Chart.js', test: () => !!window.Chart },
      { name: 'GSAP', test: () => !!window.gsap || !!window.ScrollTrigger },
      { name: 'Lodash', test: () => !!window._ && !!window._.VERSION },
      { name: 'Moment.js', test: () => !!window.moment },
      { name: ' day.js', test: () => !!window.dayjs },
      { name: 'Stripe', test: () => html.includes('stripe.com') || !!window.Stripe },
      { name: 'reCAPTCHA', test: () => html.includes('recaptcha') || !!window.grecaptcha },
      { name: 'hCaptcha', test: () => html.includes('hcaptcha') },
    ];

    const allChecks = [
      { category: 'Framework', checks: frameworks },
      { category: 'CMS', checks: cms },
      { category: 'CSS Framework', checks: css },
      { category: 'Analytics', checks: analytics },
      { category: 'CDN / Hosting', checks: cdn },
      { category: 'Library / Tool', checks: other },
    ];

    for (const { category, checks } of allChecks) {
      for (const { name, test } of checks) {
        try {
          if (test()) stack.push({ name, category });
        } catch (e) { /* skip */ }
      }
    }

    return stack;
  }

  function analyzeHealth() {
    const results = [];

    // Page title
    const title = document.title;
    results.push({
      name: 'Page Title',
      detail: title ? title.substring(0, 60) + (title.length > 60 ? '...' : '') : 'Missing',
      status: title ? 'pass' : 'fail',
      icon: title ? '✓' : '✗',
      iconClass: title ? 'green' : 'red',
    });

    // Meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    const desc = metaDesc ? metaDesc.getAttribute('content') : '';
    results.push({
      name: 'Meta Description',
      detail: desc ? desc.substring(0, 60) + (desc.length > 60 ? '...' : '') : 'Missing',
      status: desc ? 'pass' : 'fail',
      icon: desc ? '✓' : '✗',
      iconClass: desc ? 'green' : 'red',
    });

    // Viewport
    const viewport = document.querySelector('meta[name="viewport"]');
    results.push({
      name: 'Viewport Meta',
      detail: viewport ? 'Present' : 'Missing',
      status: viewport ? 'pass' : 'warn',
      icon: viewport ? '✓' : '⚠',
      iconClass: viewport ? 'green' : 'yellow',
    });

    // Favicon
    const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    results.push({
      name: 'Favicon',
      detail: favicon ? 'Present' : 'Missing',
      status: favicon ? 'pass' : 'warn',
      icon: favicon ? '✓' : '⚠',
      iconClass: favicon ? 'green' : 'yellow',
    });

    // H1 tags
    const h1s = document.querySelectorAll('h1');
    results.push({
      name: 'H1 Tags',
      detail: `${h1s.length} found`,
      status: h1s.length === 1 ? 'pass' : h1s.length === 0 ? 'fail' : 'warn',
      icon: h1s.length === 1 ? '✓' : '⚠',
      iconClass: h1s.length === 1 ? 'green' : h1s.length === 0 ? 'red' : 'yellow',
    });

    // Open Graph
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
    results.push({
      name: 'Open Graph Tags',
      detail: `${ogCount}/3 found (title, description, image)`,
      status: ogCount === 3 ? 'pass' : ogCount > 0 ? 'warn' : 'fail',
      icon: ogCount === 3 ? '✓' : '⚠',
      iconClass: ogCount === 3 ? 'green' : ogCount > 0 ? 'yellow' : 'red',
    });

    // Canonical URL
    const canonical = document.querySelector('link[rel="canonical"]');
    results.push({
      name: 'Canonical URL',
      detail: canonical ? canonical.href : 'Missing',
      status: canonical ? 'pass' : 'warn',
      icon: canonical ? '✓' : '⚠',
      iconClass: canonical ? 'green' : 'yellow',
    });

    // Robots meta
    const robots = document.querySelector('meta[name="robots"]');
    results.push({
      name: 'Robots Meta',
      detail: robots ? robots.content : 'Not set',
      status: robots ? 'pass' : 'info',
      icon: robots ? '✓' : 'i',
      iconClass: robots ? 'green' : 'blue',
    });

    // HTML lang
    const htmlLang = document.documentElement.lang;
    results.push({
      name: 'HTML Language',
      detail: htmlLang || 'Not set',
      status: htmlLang ? 'pass' : 'warn',
      icon: htmlLang ? '✓' : '⚠',
      iconClass: htmlLang ? 'green' : 'yellow',
    });

    return results;
  }

  function analyzePerformance() {
    const results = [];
    const perf = performance;
    const entries = perf.getEntriesByType('navigation');

    if (entries.length > 0) {
      const nav = entries[0];

      const domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
      results.push({
        name: 'DOM Content Loaded',
        detail: `${domContentLoaded}ms`,
        status: domContentLoaded < 1500 ? 'pass' : domContentLoaded < 3000 ? 'warn' : 'fail',
        icon: domContentLoaded < 1500 ? '✓' : '⚠',
        iconClass: domContentLoaded < 1500 ? 'green' : domContentLoaded < 3000 ? 'yellow' : 'red',
      });

      const loadTime = Math.round(nav.loadEventEnd - nav.startTime);
      results.push({
        name: 'Page Load Time',
        detail: `${loadTime}ms`,
        status: loadTime < 2000 ? 'pass' : loadTime < 4000 ? 'warn' : 'fail',
        icon: loadTime < 2000 ? '✓' : '⚠',
        iconClass: loadTime < 2000 ? 'green' : loadTime < 4000 ? 'yellow' : 'red',
      });

      const ttfb = Math.round(nav.responseStart - nav.startTime);
      results.push({
        name: 'Time to First Byte',
        detail: `${ttfb}ms`,
        status: ttfb < 200 ? 'pass' : ttfb < 500 ? 'warn' : 'fail',
        icon: ttfb < 200 ? '✓' : '⚠',
        iconClass: ttfb < 200 ? 'green' : ttfb < 500 ? 'yellow' : 'red',
      });

      const domInteractive = Math.round(nav.domInteractive - nav.startTime);
      results.push({
        name: 'DOM Interactive',
        detail: `${domInteractive}ms`,
        status: domInteractive < 1000 ? 'pass' : domInteractive < 2000 ? 'warn' : 'fail',
        icon: domInteractive < 1000 ? '✓' : '⚠',
        iconClass: domInteractive < 1000 ? 'green' : domInteractive < 2000 ? 'yellow' : 'red',
      });
    }

    // DOM size
    const domSize = document.querySelectorAll('*').length;
    results.push({
      name: 'DOM Size',
      detail: `${domSize} elements`,
      status: domSize < 1500 ? 'pass' : domSize < 3000 ? 'warn' : 'fail',
      icon: domSize < 1500 ? '✓' : '⚠',
      iconClass: domSize < 1500 ? 'green' : domSize < 3000 ? 'yellow' : 'red',
    });

    // Scripts count
    const scripts = document.querySelectorAll('script[src]').length;
    results.push({
      name: 'External Scripts',
      detail: `${scripts} loaded`,
      status: scripts < 10 ? 'pass' : scripts < 20 ? 'warn' : 'fail',
      icon: scripts < 10 ? '✓' : '⚠',
      iconClass: scripts < 10 ? 'green' : scripts < 20 ? 'yellow' : 'red',
    });

    // Stylesheets count
    const stylesheets = document.querySelectorAll('link[rel="stylesheet"]').length;
    results.push({
      name: 'Stylesheets',
      detail: `${stylesheets} loaded`,
      status: stylesheets < 8 ? 'pass' : stylesheets < 15 ? 'warn' : 'fail',
      icon: stylesheets < 8 ? '✓' : '⚠',
      iconClass: stylesheets < 8 ? 'green' : stylesheets < 15 ? 'yellow' : 'red',
    });

    // Images without alt
    const images = document.querySelectorAll('img');
    const imgsNoAlt = Array.from(images).filter(img => !img.alt).length;
    results.push({
      name: 'Images Without Alt',
      detail: `${imgsNoAlt}/${images.length} missing`,
      status: imgsNoAlt === 0 ? 'pass' : imgsNoAlt < 5 ? 'warn' : 'fail',
      icon: imgsNoAlt === 0 ? '✓' : '⚠',
      iconClass: imgsNoAlt === 0 ? 'green' : imgsNoAlt < 5 ? 'yellow' : 'red',
    });

    return results;
  }

  function analyzeSecurity() {
    const results = [];
    const html = document.documentElement.outerHTML;
    const url = window.location.href;

    // HTTPS
    const isHttps = location.protocol === 'https:';
    results.push({
      name: 'HTTPS',
      detail: isHttps ? 'Secure connection' : 'Insecure connection',
      status: isHttps ? 'pass' : 'fail',
      icon: isHttps ? '✓' : '✗',
      iconClass: isHttps ? 'green' : 'red',
    });

    // Mixed content (basic check)
    const httpResources = (html.match(/http:\/\//g) || []).length;
    results.push({
      name: 'Mixed Content',
      detail: httpResources === 0 ? 'None detected' : `${httpResources} HTTP references`,
      status: httpResources === 0 ? 'pass' : 'fail',
      icon: httpResources === 0 ? '✓' : '✗',
      iconClass: httpResources === 0 ? 'green' : 'red',
    });

    // Forms without action
    const forms = document.querySelectorAll('form');
    const formsNoAction = Array.from(forms).filter(f => !f.action || f.action === location.href).length;
    results.push({
      name: 'Form Actions',
      detail: forms.length === 0 ? 'No forms' : `${formsNoAction}/${forms.length} without action`,
      status: formsNoAction === 0 ? 'pass' : 'warn',
      icon: formsNoAction === 0 ? '✓' : '⚠',
      iconClass: formsNoAction === 0 ? 'green' : 'yellow',
    });

    // Inline scripts
    const inlineScripts = document.querySelectorAll('script:not([src])').length;
    results.push({
      name: 'Inline Scripts',
      detail: `${inlineScripts} found`,
      status: inlineScripts === 0 ? 'pass' : inlineScripts < 5 ? 'warn' : 'fail',
      icon: inlineScripts === 0 ? '✓' : '⚠',
      iconClass: inlineScripts === 0 ? 'green' : inlineScripts < 5 ? 'yellow' : 'red',
    });

    // External scripts
    const externalScripts = document.querySelectorAll('script[src]');
    const crossOriginScripts = Array.from(externalScripts).filter(s => {
      try { return new URL(s.src).origin !== location.origin; } catch { return false; }
    }).length;
    results.push({
      name: 'Cross-Origin Scripts',
      detail: `${crossOriginScripts} from external origins`,
      status: crossOriginScripts < 3 ? 'pass' : crossOriginScripts < 8 ? 'warn' : 'fail',
      icon: crossOriginScripts < 3 ? '✓' : '⚠',
      iconClass: crossOriginScripts < 3 ? 'green' : crossOriginScripts < 8 ? 'yellow' : 'red',
    });

    // Cookies (basic)
    const hasCookies = document.cookie.length > 0;
    results.push({
      name: 'Cookies',
      detail: hasCookies ? 'Cookies present (check HttpOnly flag server-side)' : 'No cookies detected',
      status: hasCookies ? 'info' : 'pass',
      icon: hasCookies ? 'i' : '✓',
      iconClass: hasCookies ? 'blue' : 'green',
    });

    // Password fields
    const passwordFields = document.querySelectorAll('input[type="password"]');
    results.push({
      name: 'Password Fields',
      detail: `${passwordFields.length} found`,
      status: passwordFields.length > 0 ? 'info' : 'pass',
      icon: passwordFields.length > 0 ? 'i' : '✓',
      iconClass: passwordFields.length > 0 ? 'blue' : 'green',
    });

    // Iframe count
    const iframes = document.querySelectorAll('iframe').length;
    results.push({
      name: 'Iframes',
      detail: `${iframes} found`,
      status: iframes === 0 ? 'pass' : iframes < 3 ? 'warn' : 'fail',
      icon: iframes === 0 ? '✓' : '⚠',
      iconClass: iframes === 0 ? 'green' : iframes < 3 ? 'yellow' : 'red',
    });

    return results;
  }

  function calculateScore(health, perf, security) {
    const allItems = [...health, ...perf, ...security];
    if (allItems.length === 0) return 0;

    let score = 0;
    let total = 0;

    for (const item of allItems) {
      total += 10;
      if (item.status === 'pass') score += 10;
      else if (item.status === 'warn') score += 5;
      else if (item.status === 'info') score += 7;
      else score += 0;
    }

    return Math.round((score / total) * 100) || 0;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCAN') {
      const techStack = detectTechStack();
      const health = analyzeHealth();
      const performance_ = analyzePerformance();
      const security = analyzeSecurity();
      const score = calculateScore(health, performance_, security);

      sendResponse({
        url: location.href,
        title: document.title,
        techStack,
        health,
        performance: performance_,
        security,
        score,
      });
    }
    return true;
  });
})();
