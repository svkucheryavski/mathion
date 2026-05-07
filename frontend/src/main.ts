import { mount } from 'svelte';
import App from './App.svelte';
import { onUnauthorized } from './lib/events';
import { startRouter, navigate, safeNext } from './lib/router.svelte';
import { bootstrapSession } from './lib/auth.svelte';
import { clearSession } from './stores/session.svelte';
import { clearCourse } from './stores/currentCourse.svelte';
import { clearToasts } from './stores/toasts.svelte';
import './app.css';

// Step 1: wire events. After this, any 401 from api.ts triggers logout-redirect.
onUnauthorized((path) => {
  clearSession();
  clearCourse();
  clearToasts();
  navigate(`/login?next=${encodeURIComponent(safeNext(path, location.origin))}`, { force: true });
});

// Step 2: start router (popstate + hashchange listeners).
startRouter();

// Step 3: mount app (renders spinner while session.loading is true).
const app = mount(App, { target: document.getElementById('app')! });

// Step 4: bootstrap session — populates session.user from /api/auth/me, then App
// re-renders the right route.
void bootstrapSession();

export default app;
