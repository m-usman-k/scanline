// Offline map of well-known third-party domains to the company behind them and what they do.
// Used for the privacy audit and the third-party breakdown. Lookups walk up the hostname, so
// "region1.google-analytics.com" matches "google-analytics.com".

import { registrableDomain } from './util.js';

// Categories counted as tracking for the privacy score.
export const TRACKING_CATEGORIES = new Set(['advertising', 'analytics', 'replay', 'social', 'marketing', 'fingerprinting']);

export const CATEGORY_NAMES = {
  advertising: 'Advertising',
  analytics: 'Analytics',
  replay: 'Session replay',
  social: 'Social / pixel',
  marketing: 'Marketing',
  fingerprinting: 'Fingerprinting',
  tagmanager: 'Tag manager',
  cdn: 'CDN',
  fonts: 'Fonts',
  video: 'Video',
  support: 'Chat & support',
  monitoring: 'Monitoring',
  consent: 'Consent',
  payments: 'Payments',
  captcha: 'Captcha',
  maps: 'Maps',
  hosting: 'Hosting',
  content: 'Content',
};

// [domain, entity, category]
const ENTRIES = [
  // Google
  ['google-analytics.com', 'Google', 'analytics'],
  ['analytics.google.com', 'Google', 'analytics'],
  ['googletagmanager.com', 'Google', 'tagmanager'],
  ['doubleclick.net', 'Google', 'advertising'],
  ['googlesyndication.com', 'Google', 'advertising'],
  ['googleadservices.com', 'Google', 'advertising'],
  ['adservice.google.com', 'Google', 'advertising'],
  ['2mdn.net', 'Google', 'advertising'],
  ['googleoptimize.com', 'Google', 'analytics'],
  ['fonts.googleapis.com', 'Google', 'fonts'],
  ['fonts.gstatic.com', 'Google', 'fonts'],
  ['ajax.googleapis.com', 'Google', 'cdn'],
  ['maps.googleapis.com', 'Google', 'maps'],
  ['maps.gstatic.com', 'Google', 'maps'],
  ['recaptcha.net', 'Google', 'captcha'],
  ['gstatic.com', 'Google', 'cdn'],
  ['googleapis.com', 'Google', 'cdn'],
  ['googleusercontent.com', 'Google', 'content'],
  ['google.com', 'Google', 'content'],
  ['youtube.com', 'Google', 'video'],
  ['youtube-nocookie.com', 'Google', 'video'],
  ['ytimg.com', 'Google', 'video'],
  ['ggpht.com', 'Google', 'content'],
  // Meta
  ['connect.facebook.net', 'Meta', 'social'],
  ['facebook.com', 'Meta', 'social'],
  ['facebook.net', 'Meta', 'social'],
  ['fbcdn.net', 'Meta', 'content'],
  ['instagram.com', 'Meta', 'social'],
  ['cdninstagram.com', 'Meta', 'content'],
  // Microsoft
  ['clarity.ms', 'Microsoft', 'replay'],
  ['bat.bing.com', 'Microsoft', 'advertising'],
  ['bing.com', 'Microsoft', 'advertising'],
  ['msecnd.net', 'Microsoft', 'cdn'],
  ['aspnetcdn.com', 'Microsoft', 'cdn'],
  ['linkedin.com', 'Microsoft', 'social'],
  ['licdn.com', 'Microsoft', 'advertising'],
  ['px.ads.linkedin.com', 'Microsoft', 'advertising'],
  // Amazon
  ['amazon-adsystem.com', 'Amazon', 'advertising'],
  ['media-amazon.com', 'Amazon', 'content'],
  ['cloudfront.net', 'Amazon', 'cdn'],
  ['amazonaws.com', 'Amazon', 'hosting'],
  // X / TikTok / Snap / Pinterest / Reddit
  ['ads-twitter.com', 'X', 'advertising'],
  ['analytics.twitter.com', 'X', 'advertising'],
  ['platform.twitter.com', 'X', 'social'],
  ['twitter.com', 'X', 'social'],
  ['twimg.com', 'X', 'content'],
  ['t.co', 'X', 'advertising'],
  ['analytics.tiktok.com', 'TikTok', 'advertising'],
  ['tiktok.com', 'TikTok', 'social'],
  ['sc-static.net', 'Snap', 'advertising'],
  ['snapchat.com', 'Snap', 'advertising'],
  ['ct.pinterest.com', 'Pinterest', 'advertising'],
  ['pinimg.com', 'Pinterest', 'advertising'],
  ['redditstatic.com', 'Reddit', 'advertising'],
  ['alb.reddit.com', 'Reddit', 'advertising'],
  // Ad tech
  ['criteo.com', 'Criteo', 'advertising'],
  ['criteo.net', 'Criteo', 'advertising'],
  ['taboola.com', 'Taboola', 'advertising'],
  ['outbrain.com', 'Outbrain', 'advertising'],
  ['adnxs.com', 'Xandr', 'advertising'],
  ['rubiconproject.com', 'Magnite', 'advertising'],
  ['pubmatic.com', 'PubMatic', 'advertising'],
  ['openx.net', 'OpenX', 'advertising'],
  ['casalemedia.com', 'Index Exchange', 'advertising'],
  ['adsrvr.org', 'The Trade Desk', 'advertising'],
  ['quantserve.com', 'Quantcast', 'advertising'],
  ['quantcount.com', 'Quantcast', 'advertising'],
  ['scorecardresearch.com', 'comScore', 'analytics'],
  ['moatads.com', 'Oracle', 'advertising'],
  ['bluekai.com', 'Oracle', 'advertising'],
  ['addthis.com', 'Oracle', 'social'],
  ['demdex.net', 'Adobe', 'advertising'],
  ['everesttech.net', 'Adobe', 'advertising'],
  ['omtrdc.net', 'Adobe', 'analytics'],
  ['2o7.net', 'Adobe', 'analytics'],
  ['adobedtm.com', 'Adobe', 'tagmanager'],
  ['typekit.net', 'Adobe', 'fonts'],
  ['doubleverify.com', 'DoubleVerify', 'advertising'],
  ['adroll.com', 'AdRoll', 'advertising'],
  ['bidswitch.net', 'IPONWEB', 'advertising'],
  ['krxd.net', 'Salesforce', 'advertising'],
  ['sharethis.com', 'ShareThis', 'social'],
  ['disqus.com', 'Disqus', 'social'],
  ['disquscdn.com', 'Disqus', 'social'],
  // Analytics & replay
  ['hotjar.com', 'Hotjar', 'replay'],
  ['hotjar.io', 'Hotjar', 'replay'],
  ['fullstory.com', 'FullStory', 'replay'],
  ['mouseflow.com', 'Mouseflow', 'replay'],
  ['smartlook.com', 'Smartlook', 'replay'],
  ['smartlook.cloud', 'Smartlook', 'replay'],
  ['luckyorange.com', 'Lucky Orange', 'replay'],
  ['luckyorange.net', 'Lucky Orange', 'replay'],
  ['crazyegg.com', 'Crazy Egg', 'replay'],
  ['inspectlet.com', 'Inspectlet', 'replay'],
  ['contentsquare.net', 'Contentsquare', 'replay'],
  ['lr-ingest.io', 'LogRocket', 'replay'],
  ['lr-in.com', 'LogRocket', 'replay'],
  ['lr-in-prod.com', 'LogRocket', 'replay'],
  ['logr-ingest.com', 'LogRocket', 'replay'],
  ['mixpanel.com', 'Mixpanel', 'analytics'],
  ['mxpnl.com', 'Mixpanel', 'analytics'],
  ['amplitude.com', 'Amplitude', 'analytics'],
  ['segment.com', 'Twilio Segment', 'analytics'],
  ['segment.io', 'Twilio Segment', 'analytics'],
  ['heapanalytics.com', 'Heap', 'analytics'],
  ['heap-api.com', 'Heap', 'analytics'],
  ['posthog.com', 'PostHog', 'analytics'],
  ['matomo.cloud', 'Matomo', 'analytics'],
  ['mc.yandex.ru', 'Yandex', 'analytics'],
  ['mc.yandex.com', 'Yandex', 'analytics'],
  ['optimizely.com', 'Optimizely', 'analytics'],
  ['visualwebsiteoptimizer.com', 'VWO', 'analytics'],
  ['abtasty.com', 'AB Tasty', 'analytics'],
  ['plausible.io', 'Plausible', 'analytics'],
  ['usefathom.com', 'Fathom', 'analytics'],
  ['cloudflareinsights.com', 'Cloudflare', 'analytics'],
  // Fingerprinting
  ['fpjs.io', 'Fingerprint', 'fingerprinting'],
  ['fpcdn.io', 'Fingerprint', 'fingerprinting'],
  ['openfpcdn.io', 'Fingerprint', 'fingerprinting'],
  // Marketing
  ['hs-scripts.com', 'HubSpot', 'marketing'],
  ['hs-analytics.net', 'HubSpot', 'marketing'],
  ['hsforms.net', 'HubSpot', 'marketing'],
  ['hs-banner.com', 'HubSpot', 'consent'],
  ['hubspot.com', 'HubSpot', 'marketing'],
  ['klaviyo.com', 'Klaviyo', 'marketing'],
  ['marketo.net', 'Adobe', 'marketing'],
  ['mktoresp.com', 'Adobe', 'marketing'],
  ['pardot.com', 'Salesforce', 'marketing'],
  ['list-manage.com', 'Mailchimp', 'marketing'],
  ['chimpstatic.com', 'Mailchimp', 'marketing'],
  ['trackcmp.net', 'ActiveCampaign', 'marketing'],
  ['braze.com', 'Braze', 'marketing'],
  ['onesignal.com', 'OneSignal', 'marketing'],
  // Support
  ['intercom.io', 'Intercom', 'support'],
  ['intercomcdn.com', 'Intercom', 'support'],
  ['zdassets.com', 'Zendesk', 'support'],
  ['zendesk.com', 'Zendesk', 'support'],
  ['drift.com', 'Drift', 'support'],
  ['driftt.com', 'Drift', 'support'],
  ['crisp.chat', 'Crisp', 'support'],
  ['tawk.to', 'tawk.to', 'support'],
  ['livechatinc.com', 'LiveChat', 'support'],
  ['tidio.co', 'Tidio', 'support'],
  // Monitoring
  ['sentry.io', 'Sentry', 'monitoring'],
  ['sentry-cdn.com', 'Sentry', 'monitoring'],
  ['nr-data.net', 'New Relic', 'monitoring'],
  ['newrelic.com', 'New Relic', 'monitoring'],
  ['datadoghq.com', 'Datadog', 'monitoring'],
  ['datadoghq-browser-agent.com', 'Datadog', 'monitoring'],
  ['browser-intake-datadoghq.com', 'Datadog', 'monitoring'],
  ['bugsnag.com', 'Bugsnag', 'monitoring'],
  ['rollbar.com', 'Rollbar', 'monitoring'],
  ['go-mpulse.net', 'Akamai', 'monitoring'],
  // Consent
  ['cookielaw.org', 'OneTrust', 'consent'],
  ['onetrust.com', 'OneTrust', 'consent'],
  ['cookiebot.com', 'Cookiebot', 'consent'],
  ['usercentrics.eu', 'Usercentrics', 'consent'],
  ['privacy-center.org', 'Didomi', 'consent'],
  ['consensu.org', 'IAB Europe', 'consent'],
  ['trustarc.com', 'TrustArc', 'consent'],
  ['iubenda.com', 'iubenda', 'consent'],
  ['cookieyes.com', 'CookieYes', 'consent'],
  // CDNs & hosting
  ['cdn.jsdelivr.net', 'jsDelivr', 'cdn'],
  ['jsdelivr.net', 'jsDelivr', 'cdn'],
  ['unpkg.com', 'unpkg', 'cdn'],
  ['cdnjs.cloudflare.com', 'Cloudflare', 'cdn'],
  ['cloudflare.com', 'Cloudflare', 'cdn'],
  ['code.jquery.com', 'jQuery', 'cdn'],
  ['bootstrapcdn.com', 'StackPath', 'cdn'],
  ['fontawesome.com', 'Font Awesome', 'fonts'],
  ['fonts.bunny.net', 'Bunny', 'fonts'],
  ['akamaized.net', 'Akamai', 'cdn'],
  ['akamaihd.net', 'Akamai', 'cdn'],
  ['fastly.net', 'Fastly', 'cdn'],
  ['cloudinary.com', 'Cloudinary', 'cdn'],
  ['imgix.net', 'imgix', 'cdn'],
  ['shopify.com', 'Shopify', 'hosting'],
  ['shopifycdn.net', 'Shopify', 'cdn'],
  ['wixstatic.com', 'Wix', 'hosting'],
  ['parastorage.com', 'Wix', 'hosting'],
  ['squarespace.com', 'Squarespace', 'hosting'],
  ['squarespace-cdn.com', 'Squarespace', 'hosting'],
  ['website-files.com', 'Webflow', 'hosting'],
  ['wp.com', 'Automattic', 'cdn'],
  ['gravatar.com', 'Automattic', 'content'],
  // Payments & captcha
  ['stripe.com', 'Stripe', 'payments'],
  ['stripe.network', 'Stripe', 'payments'],
  ['paypal.com', 'PayPal', 'payments'],
  ['paypalobjects.com', 'PayPal', 'payments'],
  ['hcaptcha.com', 'hCaptcha', 'captcha'],
  ['challenges.cloudflare.com', 'Cloudflare', 'captcha'],
  // Video
  ['vimeo.com', 'Vimeo', 'video'],
  ['vimeocdn.com', 'Vimeo', 'video'],
  ['wistia.com', 'Wistia', 'video'],
  ['wistia.net', 'Wistia', 'video'],
  ['jwpcdn.com', 'JW Player', 'video'],
];

const MAP = new Map(ENTRIES.map(([domain, entity, category]) => [domain, { domain, entity, category }]));

/** Look up the most specific known entry for a hostname. */
export function lookupDomain(host) {
  host = String(host || '').toLowerCase();
  let h = host;
  while (h) {
    const hit = MAP.get(h);
    if (hit) return hit;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return null;
}

/** Entities that own the page's own domain count as first party (e.g. ytimg.com on youtube.com). */
export function isThirdParty(host, pageHost) {
  if (!host || !pageHost) return false;
  const a = registrableDomain(host);
  const b = registrableDomain(pageHost);
  if (a === b) return false;
  const ea = lookupDomain(host);
  const eb = lookupDomain(pageHost);
  return !(ea && eb && ea.entity === eb.entity);
}
