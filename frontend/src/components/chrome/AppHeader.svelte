<script lang="ts">
  import { session } from '../../stores/session.svelte';
  import { currentRoute, navigate, defaultLandingPath } from '../../lib/router.svelte';
  import { routeClick } from '../../lib/routeClick';
  import { logout } from '../../lib/auth.svelte';
  import SiteLogo from './SiteLogo.svelte';
  import Button from '../ui/Button.svelte';

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
  <nav aria-label="Primary">
    <a class="brand"
       href={brandHref}
       onclick={(e) => routeClick(e, brandHref)}>
      <SiteLogo size="header" />
    </a>

    <div class="links">
      {#if session.user?.has_course_admin}
        <a href="/courses"
           aria-current={isAuthoringActive ? 'page' : undefined}
           onclick={(e) => routeClick(e, '/courses')}>Authoring</a>
      {/if}
      {#if session.user?.has_run_teacher || session.user?.has_course_admin}
        <a href="/teaching"
           aria-current={isTeachingActive ? 'page' : undefined}
           onclick={(e) => routeClick(e, '/teaching')}>Teaching</a>
      {/if}
    </div>

    <div class="right">
      <span class="name">{displayName}</span>
      <Button variant="ghost" onclick={onLogout}>Logout</Button>
    </div>
  </nav>
</header>

<style>
  /* 44px bar; border sits inside the height (box-sizing) per spec §4. */
  .app-header {
    box-sizing: border-box;
    height: 44px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  /* The bar spans the window; its row sits in the page column (--page-max), so
     the logo and Logout line up with the page edges. */
  nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: var(--page-max);
    margin: 0 auto;
    padding: 0 var(--space-3);
    height: 100%;
  }
  /* SuperuserShell.svelte copies this bar and nav pills (its Dashboard, Users
     and Courses pills, D23); change both. The logo or lockup is SiteLogo's
     (Branding D4); it never shrinks, the name gives way instead. */
  .brand {
    display: inline-flex;
    align-items: center;
    flex: none;
    text-decoration: none;
  }
  .links { display: flex; gap: var(--space-2); flex: 1; }
  /* Nav pills: inactive = muted, no chrome. */
  .links a {
    text-decoration: none;
    color: var(--muted);
    padding: 4px 10px;
    /* 4px is a literal here (matches no token: --radius is 5, --radius-pill 3). */
    border-radius: 4px;
    --ring: var(--gold-text); /* D60: the nav's own amber, 6.8:1 on white (--gold is 2.17:1) */
  }
  /* Active pill = gold. */
  .links a[aria-current="page"] {
    color: var(--gold-text);
    background: var(--gold-soft);
    font-weight: 500;
  }
  .right { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  /* Branding D4: a long name gets an ellipsis at 400px, next to a wide logo. */
  .name {
    font-size: 12.5px;
    color: var(--muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
