<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { navigate, currentRoute } from '../../lib/router.svelte';
  import { routeClick } from '../../lib/routeClick';
  import { session } from '../../stores/session.svelte';
  import type { PanelPage } from '../../lib/superuser';
  import SiteLogo from '../../components/chrome/SiteLogo.svelte';
  import Button from '../../components/ui/Button.svelte';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import SuperuserDashboard from './SuperuserDashboard.svelte';
  import SuperuserCourses from './SuperuserCourses.svelte';
  import SuperuserUsers from './SuperuserUsers.svelte';
  import SuperuserSettings from './SuperuserSettings.svelte';
  import SuperuserBranding from './SuperuserBranding.svelte';

  let { token }: { token: string } = $props();

  const displayName = $derived(session.user?.full_name ?? session.user?.email ?? '');

  // D23: /superuser/{token}, then /users, /courses, /settings (Settings D4) and /branding (Branding D1).
  const PAGES: { page: PanelPage; label: string; suffix: string }[] = [
    { page: 'dashboard', label: 'Dashboard', suffix: '' },
    { page: 'users', label: 'Users', suffix: '/users' },
    { page: 'courses', label: 'Courses', suffix: '/courses' },
    { page: 'settings', label: 'Settings', suffix: '/settings' },
    { page: 'branding', label: 'Branding', suffix: '/branding' },
  ];
  // The segment after the token, so a token spelled "users" still reads as the Dashboard.
  const page = $derived.by((): PanelPage => {
    const seg = currentRoute.path.split('/').filter(Boolean)[2];
    return seg === 'users' || seg === 'courses' || seg === 'settings' || seg === 'branding' ? seg : 'dashboard';
  });
  const current = $derived(PAGES.find((p) => p.page === page)!);

  // D25: the guard's answers, handled once for every page. 404 means only that
  // the link expired; a 401 goes to sign in and comes back here after.
  let expired = $state(false);
  function onAuth(kind: 'signin' | 'expired'): void {
    if (kind === 'expired') {
      expired = true;
      return;
    }
    sessionStorage.setItem('superuser_return_path', currentRoute.path);
    void navigate('/login', { replace: true, force: true });
  }

  async function onSignOut(): Promise<void> {
    try {
      await logout();
    } catch {
      // Ignore a logout transport error — client session state is already
      // cleared in logout()'s own finally. Navigate away regardless so the
      // panel token URL never lingers on screen.
    }
    // Do NOT return to the panel path — the backend logout hook has destroyed
    // the token, so that path now 404s. replace: true drops the dead token URL.
    void navigate('/login', { replace: true, force: true });
  }
</script>

<div class="superuser">
  <!-- The main site's bar (AppHeader). Its only links are the panel's own
       pages: the panel is reached only by its token URL, so nothing here leads
       away from it. -->
  <header class="su-header">
    <div class="su-row">
      <span class="brand"><SiteLogo size="header" /></span>
      <nav class="su-pills" aria-label="Superuser panel">
        {#each PAGES as p (p.page)}
          {@const href = `/superuser/${token}${p.suffix}`}
          <a class="su-pill" {href} aria-current={p.page === page ? 'page' : undefined}
             onclick={(e) => routeClick(e, href)}>{p.label}</a>
        {/each}
      </nav>
      <!-- Only someone signed in can sign out: an expired link reaches the
           panel without a session (the token is checked first). If loading the
           session fails (network, 5xx) the page can still show without Sign
           out; a reload brings it back. -->
      {#if session.user}
        <div class="right">
          <span class="name">{displayName}</span>
          <Button variant="ghost" onclick={onSignOut}>Sign out</Button>
        </div>
      {/if}
    </div>
  </header>
  <main class="su-main">
    <!-- Each page renders its own heading, so its action can sit beside it. -->
    {#if expired}
      <PanelHead title={current.label} />
      <p class="su-expired">This panel link is not valid or has expired — re-run <code>activate</code> to mint a new one.</p>
    {:else if page === 'dashboard'}
      <SuperuserDashboard {token} {onAuth} />
    {:else if page === 'courses'}
      <SuperuserCourses {token} {onAuth} />
    {:else if page === 'settings'}
      <SuperuserSettings {token} {onAuth} />
    {:else if page === 'branding'}
      <SuperuserBranding {token} {onAuth} />
    {:else}
      <SuperuserUsers {token} {onAuth} />
    {/if}
  </main>
</div>

<style>
  /* AppHeader's bar: 44px, white, its row in the page column. */
  .su-header {
    box-sizing: border-box;
    height: 44px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .su-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: var(--page-max);
    margin: 0 auto;
    padding: 0 var(--space-3);
    height: 100%;
  }
  /* AppHeader's brand, not a link here; the logo or lockup is SiteLogo's (Branding D4). */
  .brand { display: inline-flex; align-items: center; flex: none; }
  /* AppHeader's nav pills (D23); the row takes the free space so the name and
     Sign out sit right. */
  .su-pills { display: flex; gap: var(--space-2); flex: 1; }
  .su-pill {
    text-decoration: none;
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 4px;
    --ring: var(--gold-text);
  }
  .su-pill[aria-current="page"] {
    color: var(--gold-text);
    background: var(--gold-soft);
    font-weight: 500;
  }
  .right { display: flex; align-items: center; gap: var(--space-2); }
  .name { font-size: 12.5px; color: var(--muted); }
  /* The teaching list's page column. */
  .su-main {
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--space-3) var(--space-3) var(--space-4);
  }
  .su-expired { color: var(--muted); }
</style>
