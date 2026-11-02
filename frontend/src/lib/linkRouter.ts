// C6: one app-wide handler for every same-origin link that has no click
// handler of its own: links in authored content (the editor preview too,
// where navigate() runs DirtyGuard) and plain links such as the course page's
// mini-project row. Left to the browser, such a link reloads the app.
//
// The document listener is bubble-phase, so it runs after Svelte's delegated
// handlers and sees a site's own preventDefault (routeClick). A link goes to
// navigate() only when all of these hold:
//   - a plain primary click, not already defaultPrevented;
//   - an <a href> with no download and no target other than _self;
//   - not a file or another site (opensInNewTab, checked at click time);
//   - on Mathion's own origin, at a path the route table knows, or / (the
//     role redirect in App.svelte). A backend path such as /version is left to
//     the browser. matchRoute decodes segments and throws on a malformed %,
//     so a throw leaves the link alone too. A path starting with // would
//     make pushState throw (it reads as another host), so it is left alone;
//   - not a same-page #anchor (a fragment, with the current path and search).
//     An empty fragment counts: href="#" ("back to top") has URL.hash ''.
// After a real move the window scrolls to the top, as the reload did. A link
// to the current address, a DirtyGuard Cancel or a navigate overtaken by a
// newer one does not move (navigate() resolves false), and the page stays
// put. The landed address is not compared: the player adds #item= at once.
import { matchRoute, navigate } from './router.svelte';
import { routes } from '../routes';
import { opensInNewTab } from './externalLinks';

function knownPath(pathname: string): boolean {
  if (pathname === '/') return true;
  try {
    return matchRoute(routes, pathname) !== null;
  } catch {
    return false;
  }
}

async function onClick(e: MouseEvent): Promise<void> {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!(a instanceof HTMLAnchorElement) || a.hasAttribute('download')) return;
  const t = a.getAttribute('target');
  if (t !== null && t !== '' && t !== '_self') return;
  const href = a.getAttribute('href') ?? '';
  if (opensInNewTab(href)) return;
  let u: URL;
  try {
    u = new URL(href, location.href);
  } catch {
    return;
  }
  if (u.origin !== location.origin || u.pathname.startsWith('//') || !knownPath(u.pathname)) return;
  const fragment = u.hash !== '' || href.includes('#');
  if (fragment && u.pathname === location.pathname && u.search === location.search) return;

  e.preventDefault();
  if (await navigate(u.pathname + u.search + u.hash)) window.scrollTo(0, 0);
}

const listener = (e: MouseEvent) => void onClick(e);
let installs = 0;

/** P121: idempotent; App mounts it from an $effect, and jsdom tests mount App repeatedly. */
export function installLinkRouter(): () => void {
  if (installs++ === 0) document.addEventListener('click', listener);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--installs === 0) document.removeEventListener('click', listener);
  };
}
