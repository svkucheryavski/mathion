// Hand-rolled History-API router. Reactive via $state. Path-level changes
// fire popstate; #hash-only changes fire hashchange (popstate does NOT fire
// for hash changes), so we listen for both. App.svelte re-renders on any
// change to currentRoute.

export type Route = {
  path: string;            // pattern: '/courses/:courseSlug'
  component: string;       // logical name; App.svelte maps to imported component
  auth: boolean;
};

export type RouteMatch = { route: Route; params: Record<string, string> };

export const currentRoute = $state<{
  path: string;
  search: string;
  hash: string;
}>({
  path: typeof location !== 'undefined' ? location.pathname : '/',
  search: typeof location !== 'undefined' ? location.search : '',
  hash: typeof location !== 'undefined' ? location.hash : '',
});

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
  }
  // Sync currentRoute manually — pushState/replaceState don't fire popstate.
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}

export function startRouter(): void {
  window.addEventListener('popstate', () => {
    currentRoute.path = location.pathname;
    currentRoute.search = location.search;
    currentRoute.hash = location.hash;
  });
  window.addEventListener('hashchange', () => {
    currentRoute.hash = location.hash;
  });
}

/** Match a path against a route table; null if no match. */
export function matchRoute(routes: Route[], path: string): RouteMatch | null {
  for (const route of routes) {
    const m = matchPattern(route.path, path);
    if (m !== null) return { route, params: m };
  }
  return null;
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patSegs = pattern.split('/').filter(Boolean);
  const pathSegs = path.split('/').filter(Boolean);
  if (patSegs.length !== pathSegs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patSegs.length; i++) {
    const p = patSegs[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(pathSegs[i]);
    } else if (p !== pathSegs[i]) {
      return null;
    }
  }
  return params;
}

/**
 * Validate `next` query-string values: must resolve to the same origin as
 * `origin`. Falls back to '/courses' for any cross-origin, malformed, or
 * scheme-bearing input. Pass `location.origin` in production; tests inject.
 */
export function safeNext(next: string, origin: string): string {
  if (!next) return '/courses';
  // Reject backslash-leading inputs that some browsers normalize to //.
  if (next.startsWith('\\')) return '/courses';
  try {
    const u = new URL(next, origin);
    if (u.origin !== origin) return '/courses';
    // Never bounce back to /login — would trap users who arrived via a
    // compound `?next=/login?next=...` URL built up by redirect loops.
    if (u.pathname === '/login') return '/courses';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/courses';
  }
}
