<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { navigate } from '../../lib/router.svelte';
  import SuperuserDashboard from './SuperuserDashboard.svelte';

  let { token }: { token: string } = $props();

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
  <header class="su-header">
    <span class="su-brand">Superuser Panel</span>
    <nav class="su-nav"><span class="su-nav-item active">Dashboard</span></nav>
    <button type="button" class="su-signout" onclick={onSignOut}>Sign out</button>
  </header>
  <main class="su-main">
    <SuperuserDashboard {token} />
  </main>
</div>

<style>
  .su-header {
    display: flex; align-items: center; gap: var(--space-4);
    padding: var(--space-3); border-bottom: 1px solid var(--border);
  }
  .su-brand { font-weight: 600; }
  .su-nav { flex: 1; }
  .su-main { padding: var(--space-4); }
</style>
