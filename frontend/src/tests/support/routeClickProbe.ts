import { expect } from 'vitest';
import { currentRoute } from '../../lib/router.svelte';

const here = () => currentRoute.path + currentRoute.search + currentRoute.hash;

/** Let a routed click's navigate() settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * C6: a ⌘-click on `link` is left to the browser (the page stays put), and a
 * plain click routes in-app to `to`. A window listener runs after the app's
 * handlers: it records whether the default was prevented, then stops jsdom's
 * own navigation.
 */
export async function expectRoutesInApp(link: Element, to: string): Promise<void> {
  let prevented: boolean | null = null;
  const probe = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
  window.addEventListener('click', probe);
  try {
    const before = here();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    await settle();
    expect(prevented, 'a ⌘-click must reach the browser').toBe(false);
    expect(here()).toBe(before);

    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle();
    expect(prevented, 'a plain click must stay in the app').toBe(true);
    expect(here()).toBe(to);
  } finally {
    window.removeEventListener('click', probe);
  }
}
