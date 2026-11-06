import { mount } from 'svelte';
import App from './App.svelte';
import { onUnauthorized } from './lib/events';
import { startRouter, navigate, safeNext } from './lib/router.svelte';
import { bootstrapSession, getAuthConfig } from './lib/auth.svelte';
import { loadUploadLimit } from './lib/uploadLimit.svelte';
import { readInlineBranding, setBranding, applyBranding, DEFAULT_BRANDING } from './lib/branding.svelte';
import { clearSession } from './stores/session.svelte';
import { clearCourse } from './stores/currentCourse.svelte';
import { clearToasts } from './stores/toasts.svelte';
import './app.css';

async function start(): Promise<void> {
  // Step 1: wire events. After this, any 401 from api.ts triggers logout-redirect.
  onUnauthorized((path) => {
    clearSession();
    clearCourse();
    clearToasts();
    navigate(`/login?next=${encodeURIComponent(safeNext(path, location.origin))}`, { force: true });
  });

  // Step 2: start router (popstate + hashchange listeners).
  startRouter();

  // Step 3: the branding (D13). The server filled the head and the inline data,
  // so the first frame is right. Without it (the dev server, or a page sent
  // unfilled), wait for the same values from the config, and for the theme link
  // to load, before drawing; on a failure the app draws with the defaults.
  // One config request on every page: the upload limit (Settings D11b) uses it.
  const config = getAuthConfig();
  void loadUploadLimit(config);
  const inline = readInlineBranding(document);
  if (inline) {
    setBranding(inline);
  } else {
    let b = DEFAULT_BRANDING;
    try { b = (await config).branding ?? DEFAULT_BRANDING; } catch { /* the defaults */ }
    await applyBranding(b, document);
  }

  // Step 4: mount app (renders spinner while session.loading is true).
  mount(App, { target: document.getElementById('app')! });

  // Step 5: bootstrap session — populates session.user from /api/auth/me, then App
  // re-renders the right route.
  void bootstrapSession();
}

void start();
