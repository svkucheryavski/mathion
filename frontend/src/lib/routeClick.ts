// C6: the click handler for an in-app link that handles its own click. A
// modifier click (⌘/Ctrl/Shift/Alt) or a middle click is the browser's: it
// opens a new tab or window. A plain click routes in the app. A link marked
// aria-disabled (busy) takes no plain click, and the default is still
// prevented so the browser does not load it either. It reads the event's
// target, not currentTarget, so a delegated listener cannot fool it.
import { navigate } from './router.svelte';

export function routeClick(e: MouseEvent, href: string): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  const el = e.target instanceof Element ? e.target.closest('a, button') : null;
  if (el?.getAttribute('aria-disabled') === 'true') return;
  void navigate(href);
}
