<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { navigate } from '../../lib/router.svelte';
  import { session } from '../../stores/session.svelte';
  import { PRODUCT_NAME } from '../../lib/branding';
  import Logo from '../../components/ui/Logo.svelte';
  import Button from '../../components/ui/Button.svelte';
  import SuperuserDashboard from './SuperuserDashboard.svelte';

  let { token }: { token: string } = $props();

  const displayName = $derived(session.user?.full_name ?? session.user?.email ?? '');

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
  <!-- The main site's bar (AppHeader), with no links: the panel is reached only
       by its token URL, so nothing here leads away from it. -->
  <header class="su-header">
    <div class="su-row">
      <span class="brand">
        <span class="brand-mark"><Logo /></span>
        <span class="wordmark">{PRODUCT_NAME}</span>
      </span>
      <span class="su-label">Superuser</span>
      <!-- Only someone signed in can sign out: an expired link reaches the
           panel without a session (the token is checked first). If loading the
           session fails (network, 5xx) the stats can still show without Sign
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
    <h1>Dashboard</h1>
    <SuperuserDashboard {token} />
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
  /* AppHeader's brand lockup, not a link here. */
  .brand { display: inline-flex; align-items: center; gap: 7px; }
  .brand-mark { display: inline-flex; transform: translateY(-4.35px); }
  .wordmark {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  /* AppHeader's active nav pill (gold), as a plain label; it takes the free
     space so the name and Sign out sit right. */
  .su-label {
    margin-right: auto;
    padding: 4px 10px;
    border-radius: 4px;
    color: var(--gold-text);
    background: var(--gold-soft);
    font-weight: 500;
  }
  .right { display: flex; align-items: center; gap: var(--space-2); }
  .name { font-size: 12.5px; color: var(--muted); }
  /* The teaching list's page column and heading. */
  .su-main {
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--space-3) var(--space-3) var(--space-4);
  }
  h1 { margin: 0 0 14px; font-size: 22px; font-weight: 600; color: var(--text); }
</style>
