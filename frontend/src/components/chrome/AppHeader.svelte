<script lang="ts">
  import { session } from '../../stores/session.svelte';
  import { currentRoute, navigate, defaultLandingPath } from '../../lib/router.svelte';
  import { logout } from '../../lib/auth.svelte';

  const brandHref = $derived(defaultLandingPath(session.user));
  const isAuthoringActive = $derived(currentRoute.path.startsWith('/courses'));
  const isTeachingActive  = $derived(currentRoute.path.startsWith('/teaching'));
  const displayName = $derived(session.user?.full_name ?? session.user?.email ?? '');

  async function onLogout() {
    await logout();
    navigate('/login');
  }
</script>

<header class="app-header">
  <nav>
    <a class="brand" href={brandHref}>Mathion</a>

    <div class="links">
      {#if session.user?.has_course_admin}
        <a href="/courses"
           aria-current={isAuthoringActive ? 'page' : undefined}>Authoring</a>
      {/if}
      {#if session.user?.has_run_teacher}
        <a href="/teaching"
           aria-current={isTeachingActive ? 'page' : undefined}>Teaching</a>
      {/if}
    </div>

    <div class="right">
      <span class="name">{displayName}</span>
      <button type="button" onclick={onLogout}>Logout</button>
    </div>
  </nav>
</header>

<style>
  .app-header {
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }
  .brand { font-weight: 600; text-decoration: none; }
  .links { display: flex; gap: var(--space-3); flex: 1; }
  .links a {
    text-decoration: none;
    color: var(--text);
    padding: var(--space-1) 0;
  }
  .links a[aria-current="page"] {
    font-weight: 600;
    border-bottom: 2px solid var(--accent);
  }
  .right { display: flex; align-items: center; gap: var(--space-2); }
  .name { color: var(--muted); }
</style>
