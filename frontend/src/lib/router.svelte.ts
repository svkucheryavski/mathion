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

type NavGuard = () => boolean | Promise<boolean>;
const guards: NavGuard[] = [];
let suppressGuards = false;

// F4: SSR-safe initializer (matches the pattern used for currentRoute above).
let lastResolvedPath = typeof location !== 'undefined'
  ? location.pathname + location.search + location.hash
  : '/';

// F3: Generation token — incremented on every navigate() call so a slow
// guard chain from an earlier call cannot commit a stale path after a newer
// navigate has already started.
let navGen = 0;

export function registerNavigationGuard(g: NavGuard): () => void {
  guards.push(g);
  return () => {
    const i = guards.indexOf(g);
    if (i >= 0) guards.splice(i, 1);
  };
}

/**
 * Test-only: reset the guard registry so tests don't leak guards across cases.
 * Named with double underscore to make the test-only intent obvious.
 */
export function __resetGuardsForTests(): void {
  guards.splice(0, guards.length);
}

async function runGuards(): Promise<boolean> {
  if (suppressGuards) return true;
  // F7: snapshot guards.slice() before iterating so a self-disposing guard
  // (one that calls its own disposer) cannot skip later guards in the array.
  for (const g of guards.slice()) {
    const ok = await g();
    if (!ok) return false;
  }
  return true;
}

function applyLocationToRoute(): void {
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}

// F5: Returns true when only the fragment (#hash) part of `path` differs from
// the current route (path + search unchanged). Hash-only navigations must not
// trigger DirtyGuard per spec §5.
function isHashOnlyChange(path: string): boolean {
  const hashIdx = path.indexOf('#');
  const pathWithoutHash = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
  const qIdx = pathWithoutHash.indexOf('?');
  const pn = qIdx >= 0 ? pathWithoutHash.slice(0, qIdx) : pathWithoutHash;
  const sn = qIdx >= 0 ? '?' + pathWithoutHash.slice(qIdx + 1) : '';
  return pn === currentRoute.path && sn === currentRoute.search;
}

// F6: Added `force?: boolean` option. When true, guards are bypassed entirely.
// Used by auth redirects (401 logout flow) where form state is already cleared
// and a DirtyGuard cancel would be wrong.
export async function navigate(
  path: string,
  opts: { replace?: boolean; force?: boolean } = {}
): Promise<void> {
  // F3: Capture the generation token before any async work.
  const myGen = ++navGen;

  const target = path;
  const current = currentRoute.path + currentRoute.search + currentRoute.hash;
  if (target === current) return;

  // F5: hash-only changes bypass guards; F6: force:true also bypasses guards.
  if (!opts.force && !isHashOnlyChange(target) && !(await runGuards())) return;

  // F3: After awaiting guards, abort if a newer navigate() has already run.
  if (myGen !== navGen) return;

  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  applyLocationToRoute();
  lastResolvedPath = location.pathname + location.search + location.hash;
}

// F2: Extract handlers into named variables so Vite HMR dispose can remove them.
if (typeof window !== 'undefined') {
  const popHandler = async () => {
    if (suppressGuards) return;
    if (!(await runGuards())) {
      // D-I3: a concurrent navigate() during the guard await may have
      // already brought location back to lastResolvedPath (user pressed
      // Back, guard rejected, but a programmatic navigate ran during the
      // await). In that case the URL is already where it should be — push
      // would either be a no-op same-URL push or, worse, clobber a
      // legitimate concurrent route change that happened to share the path.
      const here = location.pathname + location.search + location.hash;
      if (here === lastResolvedPath) return;
      // F1: try/finally so a throwing pushState cannot leave suppressGuards=true
      // permanently, short-circuiting all future guard checks. The catch swallows
      // the throw so it doesn't escape the async handler as an unhandled rejection;
      // the restore failed but there is nothing further the router can do.
      try {
        suppressGuards = true;
        try {
          history.pushState(null, '', lastResolvedPath);
        } catch {
          // restore failed; URL bar may now disagree with currentRoute, but
          // future navigates remain gated correctly.
        }
      } finally {
        suppressGuards = false;
      }
      return;
    }
    applyLocationToRoute();
    lastResolvedPath = location.pathname + location.search + location.hash;
  };

  const hashHandler = () => {
    currentRoute.hash = location.hash;
    lastResolvedPath = location.pathname + location.search + location.hash;
  };

  window.addEventListener('popstate', popHandler);
  window.addEventListener('hashchange', hashHandler);

  // F2: Vite HMR cleanup — remove old listeners before the new module instance
  // registers fresh ones, preventing duplicated handlers on hot reload.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('popstate', popHandler);
      window.removeEventListener('hashchange', hashHandler);
    });
  }
}

export function startRouter(): void {
  // No-op — handlers register at module load. Kept for back-compat.
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
