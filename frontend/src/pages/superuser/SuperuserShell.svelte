<script lang="ts">
  import { onDestroy, onMount, setContext, untrack } from 'svelte';
  import { logout } from '../../lib/auth.svelte';
  import { navigate, currentRoute } from '../../lib/router.svelte';
  import { routeClick } from '../../lib/routeClick';
  import { session } from '../../stores/session.svelte';
  import type { PanelPage } from '../../lib/superuser';
  import { SetupStore } from '../../lib/setupStore.svelte';
  import { clearMark, entryMove, markFor, setMark } from '../../lib/setup';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { DISCARD_NAV_ASK, focusAfter, InPlaceAsk, refused, type GuardAsk } from '../../lib/askInPlace.svelte';
  import AskSlot from '../../components/ui/AskSlot.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import SiteLogo from '../../components/chrome/SiteLogo.svelte';
  import Button from '../../components/ui/Button.svelte';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import SuperuserDashboard from './SuperuserDashboard.svelte';
  import SuperuserCourses from './SuperuserCourses.svelte';
  import SuperuserUsers from './SuperuserUsers.svelte';
  import SuperuserSettings from './SuperuserSettings.svelte';
  import SuperuserBranding from './SuperuserBranding.svelte';
  import SuperuserSetup from './SuperuserSetup.svelte';

  let { token }: { token: string } = $props();

  const displayName = $derived(session.user?.full_name ?? session.user?.email ?? '');

  // D23: /superuser/{token}, then /users, /courses, /settings (Settings D4) and
  // /branding (Branding D1). Set up D1: /setup comes first; its pill shows only
  // while the wizard is on, but the expired view reads its label.
  const PAGES: { page: PanelPage; label: string; suffix: string }[] = [
    { page: 'setup', label: 'Set up', suffix: '/setup' },
    { page: 'dashboard', label: 'Dashboard', suffix: '' },
    { page: 'users', label: 'Users', suffix: '/users' },
    { page: 'courses', label: 'Courses', suffix: '/courses' },
    { page: 'settings', label: 'Settings', suffix: '/settings' },
    { page: 'branding', label: 'Branding', suffix: '/branding' },
  ];
  // The segment after the token, so a token spelled "users" still reads as the Dashboard.
  const seg = $derived(currentRoute.path.split('/').filter(Boolean)[2]);
  const page = $derived.by((): PanelPage =>
    seg === 'setup' || seg === 'users' || seg === 'courses' || seg === 'settings' || seg === 'branding' ? seg : 'dashboard');
  const current = $derived(PAGES.find((p) => p.page === page)!);

  // D25: the guard's answers, handled once for every page. 404 means only that
  // the link expired; a 401 goes to sign in and comes back here after.
  let expired = $state(false);
  function onAuth(kind: 'signin' | 'expired'): void {
    if (kind === 'expired') {
      expired = true;
      clearMark();   // Set up D2: a new link opened in this tab lands on Set up
      return;
    }
    sessionStorage.setItem('superuser_return_path', currentRoute.path);
    void navigate('/login', { replace: true, force: true });
  }

  // Set up D13: the one copy of the wizard's state, for every page.
  const setup = new SetupStore(untrack(() => token), onAuth);
  // D1, D2: only the bar until the mount's read answers.
  let ready = $state(false);
  // D2: a pill clicked before that answer cancels the redirect.
  let entryOpen = true;

  onMount(() => {
    void setup.read().then(async (s) => {
      if (s) {
        // Only if the address is still the panel's own when it answers (D2).
        const toSetup = entryOpen && entryMove(seg, s, markFor(token)) === 'to-setup';
        if (s.wizard_on) setMark(token);
        // The page shows only once the address is Set up's, so the Dashboard
        // never mounts on the way.
        if (toSetup) await navigate(`/superuser/${token}/setup`, { replace: true });
      }
      ready = true;
    });
  });
  onDestroy(() => {
    setup.dispose();
    navAsk.dismiss();
  });

  // D1: the state the shell holds when /setup is entered decides: over leaves
  // for the Dashboard ('leaving' shows only the bar); on opens the page, and a
  // later "over" keeps it. Entered with no state yet, the first good answer decides.
  let setupEntry = $state<'open' | 'leaving' | null>(null);
  $effect(() => {
    const p = page;
    const s = setup.state;
    const r = ready;
    untrack(() => {
      if (p !== 'setup') { setupEntry = null; return; }
      if (!r || setupEntry !== null || s === null) return;
      if (entryMove('setup', s, markFor(token)) === 'to-dashboard') {
        setupEntry = 'leaving';
        void navigate(`/superuser/${token}`, { replace: true });
      } else {
        setupEntry = 'open';
      }
    });
  });

  // D13: a re-read on every panel page change.
  let lastPage: PanelPage | null = null;
  $effect(() => {
    const p = page;
    untrack(() => {
      if (lastPage !== null && p !== lastPage && ready) void setup.read();
      lastPage = p;
    });
  });

  // D1, D13: the Set up pill comes first while on, and stays while the page is /setup.
  const shown = $derived(PAGES.filter((p) => p.page !== 'setup' || setup.state?.wizard_on || page === 'setup'));
  // D3: while a save runs, the pills wait.
  const waiting = $derived(setup.busy || setup.saving);

  // D2: a pill click that routes in this tab cancels the redirect; a modifier
  // click opens another tab and leaves this one alone.
  function onPill(e: MouseEvent, href: string): void {
    routeClick(e, href);
    if (e.defaultPrevented) entryOpen = false;
  }

  // D3: leaving with unsaved changes asks first, in place, at the top of the page.
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  // Cancel puts focus back on the control that asked: Sign out, or what had focus.
  const navAsk = new InPlaceAsk();
  let signOutButton = $state<HTMLButtonElement | undefined>();
  function askNav(from: Element | null = document.activeElement): GuardAsk {
    if (navAsk.open) { navAsk.focusCancel(); return refused(); }
    const promise = navAsk.ask(DISCARD_NAV_ASK).then((a) => {
      if (a === 'cancel') void focusAfter(() => from);
      if (a !== 'confirm') return false;
      navAsk.settle();
      return true;
    });
    return { promise, dismiss: () => navAsk.dismiss(), focusCancel: () => navAsk.focusCancel() };
  }

  async function onSignOut(): Promise<void> {
    // D3: Sign out navigates past the guard, so it asks itself.
    if (registry.isAnyDirty()) {
      if (!(await askNav(signOutButton ?? null).promise)) return;
      registry.discardAll();
    }
    clearMark();   // Set up D2
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
        {#each shown as p (p.page)}
          {@const href = `/superuser/${token}${p.suffix}`}
          <a class="su-pill" {href} aria-current={p.page === page ? 'page' : undefined}
             aria-disabled={waiting ? 'true' : undefined} onclick={(e) => onPill(e, href)}>{p.label}</a>
        {/each}
      </nav>
      <!-- Only someone signed in can sign out: an expired link reaches the
           panel without a session (the token is checked first). If loading the
           session fails (network, 5xx) the page can still show without Sign
           out; a reload brings it back. -->
      {#if session.user}
        <div class="right">
          <span class="name">{displayName}</span>
          <Button variant="ghost" bind:element={signOutButton} onclick={onSignOut}>Sign out</Button>
        </div>
      {/if}
    </div>
  </header>
  <main class="su-main">
    <!-- Each page renders its own heading, so its action can sit beside it. -->
    {#if expired}
      <PanelHead title={current.label} />
      <p class="su-expired">This panel link is not valid or has expired — re-run <code>activate</code> to mint a new one.</p>
    {:else if !ready || setupEntry === 'leaving' || (page === 'setup' && setupEntry === null && setup.state !== null)}
      <!-- Set up D1, D2: only the bar until the state decides where to go. -->
    {:else}
      {#if navAsk.open}<div class="su-ask"><AskSlot ask={navAsk} /></div>{/if}
      {#if page === 'setup'}
        <SuperuserSetup {setup} {token} {onAuth} />
      {:else if page === 'dashboard'}
        <SuperuserDashboard {token} {onAuth} {setup} />
      {:else if page === 'courses'}
        <SuperuserCourses {token} {onAuth} {setup} />
      {:else if page === 'settings'}
        <SuperuserSettings {token} {onAuth} />
      {:else if page === 'branding'}
        <SuperuserBranding {token} {onAuth} />
      {:else}
        <SuperuserUsers {token} {onAuth} />
      {/if}
    {/if}
  </main>
</div>

<DirtyGuard isDirty={() => registry.isAnyDirty()} onDiscard={() => registry.discardAll()} ask={askNav} />

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
  /* D3: while a save runs the pills wait, and look it (Button's blocked look);
     the current one keeps its mark, below. */
  .su-pill[aria-disabled="true"] { color: var(--faint); cursor: not-allowed; }
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
  /* D3: the leave question, above the page. */
  .su-ask { margin: 0 0 14px; }
</style>
