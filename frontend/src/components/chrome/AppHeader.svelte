<script lang="ts">
  import { session } from '../../stores/session.svelte';
  import { currentRoute, navigate, defaultLandingPath } from '../../lib/router.svelte';
  import { logout } from '../../lib/auth.svelte';
  import { PRODUCT_NAME } from '../../lib/branding';
  import Logo from '../ui/Logo.svelte';
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
       onclick={(e) => { e.preventDefault(); navigate(brandHref); }}>
      <span class="brand-mark"><Logo /></span>
      <span class="wordmark">{PRODUCT_NAME}</span>
    </a>

    <div class="links">
      {#if session.user?.has_course_admin}
        <a href="/courses"
           aria-current={isAuthoringActive ? 'page' : undefined}
           onclick={(e) => { e.preventDefault(); navigate('/courses'); }}>Authoring</a>
      {/if}
      {#if session.user?.has_run_teacher || session.user?.has_course_admin}
        <a href="/teaching"
           aria-current={isTeachingActive ? 'page' : undefined}
           onclick={(e) => { e.preventDefault(); navigate('/teaching'); }}>Teaching</a>
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
  nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3);
    height: 100%;
  }
  /* Brand lockup — exact geometry (spec §2): mark + wordmark, centre-aligned,
     gap 7px, mark nudged up 4.35px so its stroke ends land on the wordmark
     baseline. */
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    text-decoration: none;
  }
  .brand-mark {
    display: inline-flex;
    transform: translateY(-4.35px);
  }
  .wordmark {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .links { display: flex; gap: var(--space-2); flex: 1; }
  /* Nav pills: inactive = muted, no chrome. */
  .links a {
    text-decoration: none;
    color: var(--muted);
    padding: 4px 10px;
    /* 4px is a literal here (matches no token: --radius is 5, --radius-pill 3). */
    border-radius: 4px;
  }
  /* Active pill = gold. */
  .links a[aria-current="page"] {
    color: var(--gold-text);
    background: var(--gold-soft);
    font-weight: 500;
  }
  .right { display: flex; align-items: center; gap: var(--space-2); }
  .name { font-size: 12.5px; color: var(--muted); }
</style>
