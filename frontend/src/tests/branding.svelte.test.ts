import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PRODUCT_NAME, DEFAULT_BRANDING, branding, readInlineBranding, applyBranding, setBranding, THEME_WAIT_MS,
  type BrandingPublic,
} from '../lib/branding.svelte';

// Branding D13/D14: the inline data, and the head tags the app writes itself.

const UPLOADED: BrandingPublic = {
  name: 'Riverside', logo: { version: 'a'.repeat(16), width: 838, height: 174 },
  icon: 'c'.repeat(16), theme: 'd'.repeat(16),
};

function brandingTags(doc: Document) {
  return [...doc.head.querySelectorAll('[data-branding]')];
}
function iconLinks(doc: Document) {
  return [...doc.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')] as HTMLLinkElement[];
}
function themeLinks(doc: Document) {
  return [...doc.head.querySelectorAll('link[rel="stylesheet"][data-branding]')] as HTMLLinkElement[];
}
/** Fire `load` on every theme link not yet loaded, so applyBranding can resolve. */
function loadThemes(doc: Document, type: 'load' | 'error' = 'load') {
  for (const l of themeLinks(doc)) l.dispatchEvent(new Event(type));
}

let doc: Document;
beforeEach(() => {
  doc = document.implementation.createHTMLDocument('Mathion');
  setBranding(DEFAULT_BRANDING);
});
afterEach(() => setBranding(DEFAULT_BRANDING));

describe('readInlineBranding', () => {
  it('reads the #branding script', () => {
    const s = doc.createElement('script');
    s.type = 'application/json';
    s.id = 'branding';
    s.textContent = JSON.stringify(UPLOADED);
    doc.head.append(s);
    expect(readInlineBranding(doc)).toEqual(UPLOADED);
  });

  it('reads the escaped form the server writes', () => {
    const s = doc.createElement('script');
    s.id = 'branding';
    s.textContent = '{"name":"\\u003c/script\\u003e","logo":null,"icon":null,"theme":null}';
    doc.head.append(s);
    expect(readInlineBranding(doc)?.name).toBe('</script>');
  });

  it.each([
    ['missing', null],
    ['unparseable', '{"name":'],
    ['the wrong shape', '{"name":5,"logo":null,"icon":null,"theme":null}'],
    ['a logo without a size', '{"name":"X","logo":{"version":"a"},"icon":null,"theme":null}'],
    ['not an object', '"Mathion"'],
  ])('returns null when %s', (_label, text) => {
    if (text !== null) {
      const s = doc.createElement('script');
      s.id = 'branding';
      s.textContent = text;
      doc.head.append(s);
    }
    expect(readInlineBranding(doc)).toBeNull();
  });
});

describe('the store', () => {
  it('starts at the defaults and never fetches at import', () => {
    expect(PRODUCT_NAME).toBe('Mathion');
    expect(DEFAULT_BRANDING).toEqual({ name: 'Mathion', logo: null, icon: null, theme: null });
    expect({ ...branding }).toEqual(DEFAULT_BRANDING);
  });

  it('setBranding copies, so the given object can change without the store', () => {
    const b = structuredClone(UPLOADED);
    setBranding(b);
    b.name = 'Changed';
    expect(branding.name).toBe('Riverside');
    expect(branding.logo).toEqual(UPLOADED.logo);
  });
});

describe('applyBranding', () => {
  it('sets the store, the title and the home-screen name', async () => {
    const done = applyBranding({ ...UPLOADED, theme: null }, doc);
    await done;
    expect(branding.name).toBe('Riverside');
    expect(doc.title).toBe('Riverside');
    expect(doc.querySelector('title')!.hasAttribute('data-branding')).toBe(true);
    const meta = doc.head.querySelector('meta[name="apple-mobile-web-app-title"]')!;
    expect(meta.getAttribute('content')).toBe('Riverside');
    expect(meta.hasAttribute('data-branding')).toBe(true);
  });

  it('swaps the icon link set', async () => {
    await applyBranding(DEFAULT_BRANDING, doc);
    expect(iconLinks(doc).map((l) => [l.rel, l.type, l.getAttribute('href')])).toEqual([
      ['icon', 'image/svg+xml', '/api/branding/icon-default.svg'],
      ['icon', 'image/png', '/api/branding/icon-default-32.png'],
      ['apple-touch-icon', '', '/api/branding/icon-default-180.png'],
    ]);
    expect(iconLinks(doc)[1].getAttribute('sizes')).toBe('32x32');

    await applyBranding({ ...DEFAULT_BRANDING, icon: 'c'.repeat(16) }, doc);
    expect(doc.head.querySelector('link[type="image/svg+xml"]')).toBeNull();
    expect(iconLinks(doc).map((l) => [l.rel, l.type, l.getAttribute('href')])).toEqual([
      ['icon', 'image/png', `/api/branding/icon.png?v=${'c'.repeat(16)}`],
      ['apple-touch-icon', '', `/api/branding/icon.png?v=${'c'.repeat(16)}`],
    ]);

    await applyBranding(DEFAULT_BRANDING, doc);
    expect(iconLinks(doc).map((l) => l.getAttribute('href'))).toEqual([
      '/api/branding/icon-default.svg', '/api/branding/icon-default-32.png', '/api/branding/icon-default-180.png',
    ]);
    expect(iconLinks(doc).every((l) => l.hasAttribute('data-branding'))).toBe(true);
  });

  it('replaces the server-filled icon links too', async () => {
    doc.head.insertAdjacentHTML('beforeend',
      '<link rel="icon" type="image/svg+xml" href="/api/branding/icon-default.svg?v=x" data-branding>' +
      '<link rel="apple-touch-icon" href="/api/branding/icon-default-180.png?v=x" data-branding>');
    await applyBranding({ ...DEFAULT_BRANDING, icon: 'c'.repeat(16) }, doc);
    expect(iconLinks(doc)).toHaveLength(2);
    expect(doc.head.querySelector('link[type="image/svg+xml"]')).toBeNull();
  });

  it('adds the new theme link before removing the old one, and resolves on load', async () => {
    let settled = false;
    const first = applyBranding(UPLOADED, doc).then(() => { settled = true; });
    await Promise.resolve();
    expect(themeLinks(doc).map((l) => l.getAttribute('href'))).toEqual([`/api/branding/theme.css?v=${'d'.repeat(16)}`]);
    expect(settled).toBe(false);
    loadThemes(doc);
    await first;

    const second = applyBranding({ ...UPLOADED, theme: 'e'.repeat(16) }, doc);
    await Promise.resolve();
    // Both are in the head until the new one has loaded: no flash of Mathion's colours.
    expect(themeLinks(doc).map((l) => l.getAttribute('href'))).toEqual([
      `/api/branding/theme.css?v=${'d'.repeat(16)}`, `/api/branding/theme.css?v=${'e'.repeat(16)}`,
    ]);
    themeLinks(doc)[1].dispatchEvent(new Event('load'));
    await second;
    expect(themeLinks(doc).map((l) => l.getAttribute('href'))).toEqual([`/api/branding/theme.css?v=${'e'.repeat(16)}`]);
    expect(themeLinks(doc)[0].hasAttribute('data-branding')).toBe(true);
  });

  it('resolves on error too, and keeps the new link', async () => {
    const done = applyBranding(UPLOADED, doc);
    await Promise.resolve();
    loadThemes(doc, 'error');
    await done;
    expect(themeLinks(doc)).toHaveLength(1);
  });

  it('the theme link is the last tag in the head', async () => {
    const built = doc.createElement('link');
    built.rel = 'stylesheet';
    built.href = '/_app/index.css';
    doc.head.append(built);
    const done = applyBranding(UPLOADED, doc);
    await Promise.resolve();
    loadThemes(doc);
    await done;
    expect(doc.head.lastElementChild).toBe(themeLinks(doc)[0]);
  });

  it('the same theme again changes nothing and resolves at once', async () => {
    const first = applyBranding(UPLOADED, doc);
    await Promise.resolve();
    loadThemes(doc);
    await first;
    const link = themeLinks(doc)[0];
    await applyBranding(UPLOADED, doc);
    expect(themeLinks(doc)).toEqual([link]);
  });

  it('theme: null removes the link', async () => {
    const first = applyBranding(UPLOADED, doc);
    await Promise.resolve();
    loadThemes(doc);
    await first;
    await applyBranding({ ...UPLOADED, theme: null }, doc);
    expect(themeLinks(doc)).toHaveLength(0);
  });

  // A link removed before its fetch is processed fires neither load nor error
  // (T8 review, both lanes): a later call must settle the earlier one.
  async function settledSoon(p: Promise<void>) {
    let done = false;
    void p.then(() => { done = true; });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    return done;
  }

  it('a second theme while the first still loads settles the first call at once', async () => {
    const first = applyBranding(UPLOADED, doc);
    const second = applyBranding({ ...UPLOADED, theme: 'e'.repeat(16) }, doc);
    expect(await settledSoon(first)).toBe(true);
    expect(await settledSoon(second)).toBe(false);
    themeLinks(doc)[1].dispatchEvent(new Event('load'));
    await second;
    expect(themeLinks(doc).map((l) => l.getAttribute('href'))).toEqual([`/api/branding/theme.css?v=${'e'.repeat(16)}`]);
  });

  it('theme: null while a theme still loads settles that call and removes it', async () => {
    const first = applyBranding(UPLOADED, doc);
    await applyBranding({ ...UPLOADED, theme: null }, doc);
    expect(await settledSoon(first)).toBe(true);
    expect(themeLinks(doc)).toHaveLength(0);
  });

  it('the same theme while it still loads waits for that one link', async () => {
    const first = applyBranding(UPLOADED, doc);
    const again = applyBranding(UPLOADED, doc);
    expect(themeLinks(doc)).toHaveLength(1);
    expect(await settledSoon(again)).toBe(false);
    loadThemes(doc);
    await Promise.all([first, again]);
    expect(themeLinks(doc)).toHaveLength(1);
  });

  it('stops waiting after THEME_WAIT_MS and keeps both links (never a blank page, D13)', async () => {
    vi.useFakeTimers();
    try {
      const first = applyBranding(UPLOADED, doc);
      loadThemes(doc);
      await first;
      const stalled = applyBranding({ ...UPLOADED, theme: 'e'.repeat(16) }, doc);
      vi.advanceTimersByTime(THEME_WAIT_MS - 1);
      expect(await settledSoon(stalled)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(await settledSoon(stalled)).toBe(true);
      // The old colours stay until the new link loads, so nothing flashes.
      expect(themeLinks(doc)).toHaveLength(2);
      themeLinks(doc)[1].dispatchEvent(new Event('load'));
      expect(themeLinks(doc).map((l) => l.getAttribute('href'))).toEqual([`/api/branding/theme.css?v=${'e'.repeat(16)}`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('every tag it writes carries data-branding', async () => {
    const done = applyBranding(UPLOADED, doc);
    await Promise.resolve();
    loadThemes(doc);
    await done;
    const tags = brandingTags(doc).map((t) => t.tagName.toLowerCase());
    expect(tags.sort()).toEqual(['link', 'link', 'link', 'meta', 'title'].sort());
  });
});
