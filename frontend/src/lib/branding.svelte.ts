// Branding (spec 2026-11-05, D3/D4/D13/D14): the site's public branding, as a
// reactive store, and the head tags that show it.
//
// The server fills the page's head and an inline `#branding` script (D13), so
// main.ts reads that synchronously and the first frame is right. When the data
// is missing (the Vite dev server, or a production page sent unfilled), main.ts
// gets the same values from /api/auth/config and calls applyBranding, which the
// panel also calls after a save (D14). Importing this file never fetches.

/** The wordmark in the default lockup. It stays "Mathion" whatever the site name is (D4). */
export const PRODUCT_NAME = 'Mathion';

export type BrandingPublic = {
  name: string;
  logo: { version: string; width: number; height: number } | null;
  icon: string | null;
  theme: string | null;
};

export const DEFAULT_BRANDING: BrandingPublic = Object.freeze({
  name: PRODUCT_NAME, logo: null, icon: null, theme: null,
});

export const branding = $state<BrandingPublic>({ ...DEFAULT_BRANDING });

/** Copy `b` into the store, so later changes to `b` don't reach it. */
export function setBranding(b: BrandingPublic): void {
  branding.name = b.name;
  branding.logo = b.logo ? { ...b.logo } : null;
  branding.icon = b.icon;
  branding.theme = b.theme;
}

const isText = (v: unknown): v is string => typeof v === 'string';
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** The server's inline data, or null when it's missing or not the expected shape. */
export function readInlineBranding(doc: Document): BrandingPublic | null {
  const text = doc.getElementById('branding')?.textContent;
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isText(r.name) || !isTextOrNull(r.icon) || !isTextOrNull(r.theme)) return null;
  let logo: BrandingPublic['logo'] = null;
  if (r.logo !== null) {
    const l = r.logo as Record<string, unknown> | undefined;
    if (typeof l !== 'object' || !isText(l.version) || !isSize(l.width) || !isSize(l.height)) return null;
    logo = { version: l.version, width: l.width, height: l.height };
  }
  return { name: r.name, logo, icon: r.icon, theme: r.theme };
}

const BASE = '/api/branding';

function tag<K extends keyof HTMLElementTagNameMap>(
  doc: Document, name: K, attrs: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute('data-branding', '');
  return el;
}

/** D13's icon links: the three defaults (no `?v=`, the app doesn't know their hashes), or the upload twice. */
function iconLinks(doc: Document, icon: string | null): HTMLLinkElement[] {
  if (icon === null) {
    return [
      tag(doc, 'link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}/icon-default.svg` }),
      tag(doc, 'link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${BASE}/icon-default-32.png` }),
      tag(doc, 'link', { rel: 'apple-touch-icon', href: `${BASE}/icon-default-180.png` }),
    ];
  }
  const href = `${BASE}/icon.png?v=${icon}`;
  return [
    tag(doc, 'link', { rel: 'icon', type: 'image/png', href }),
    tag(doc, 'link', { rel: 'apple-touch-icon', href }),
  ];
}

/** How long applyBranding waits for a new theme link before it settles anyway (D13: never a blank page). */
export const THEME_WAIT_MS = 3000;

// The theme link still loading, and how to settle the call that added it. A link
// removed before its fetch is processed fires neither load nor error, so a later
// call settles the earlier one itself.
let pending: { link: HTMLLinkElement; promise: Promise<void>; settle: () => void } | null = null;

/**
 * Show `b`: the store, the title, the home-screen name, the icon links and the
 * theme link. A new theme link goes in before the old one comes out (on its
 * load or error), so nothing flashes Mathion's colours (D14). The promise
 * resolves once the new link has loaded or failed, when a later call takes
 * over, or after THEME_WAIT_MS, whichever comes first.
 */
export function applyBranding(b: BrandingPublic, doc: Document): Promise<void> {
  setBranding(b);
  const head = doc.head;

  let title = head.querySelector('title');
  if (!title) { title = doc.createElement('title'); head.append(title); }
  title.textContent = b.name;
  title.setAttribute('data-branding', '');

  let meta = head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (!meta) { meta = tag(doc, 'meta', { name: 'apple-mobile-web-app-title' }); head.append(meta); }
  meta.setAttribute('content', b.name);
  meta.setAttribute('data-branding', '');

  const themes = [...head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][data-branding]')];
  for (const old of head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) old.remove();
  // Before the theme link, which stays the last tag in the head.
  const icons = iconLinks(doc, b.icon);
  if (themes[0]) for (const l of icons) head.insertBefore(l, themes[0]);
  else head.append(...icons);

  const href = b.theme === null ? null : `${BASE}/theme.css?v=${b.theme}`;
  // The same theme still loading: wait for that one link.
  if (pending && pending.link.isConnected && pending.link.getAttribute('href') === href) return pending.promise;
  pending?.settle();
  pending = null;

  if (href === null) {
    for (const l of themes) l.remove();
    return Promise.resolve();
  }
  if (themes.length === 1 && themes[0].getAttribute('href') === href) return Promise.resolve();

  const link = tag(doc, 'link', { rel: 'stylesheet', href });
  let settle = () => {};
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => settle(), THEME_WAIT_MS);
    settle = () => {
      clearTimeout(timer);
      if (pending?.link === link) pending = null;
      resolve();
    };
  });
  // The old links go only once the new one has loaded or failed, even after
  // the call has settled, so a slow theme never shows Mathion's colours.
  const done = () => {
    for (const l of themes) l.remove();
    settle();
  };
  link.addEventListener('load', done, { once: true });
  link.addEventListener('error', done, { once: true });
  pending = { link, promise, settle };
  head.append(link);
  return promise;
}
