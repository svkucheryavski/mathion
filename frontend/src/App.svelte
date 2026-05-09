<script lang="ts">
  import type { Component } from 'svelte';
  import { currentRoute, matchRoute, navigate } from './lib/router.svelte';
  import { routes } from './routes';
  import { session } from './stores/session.svelte';
  import Toaster from './components/chrome/Toaster.svelte';
  import Spinner from './components/ui/Spinner.svelte';
  import Login from './pages/Login.svelte';
  import CourseList from './pages/CourseList.svelte';
  import CourseView from './pages/CourseView.svelte';
  import SequencePlayer from './pages/SequencePlayer.svelte';
  import NotFound from './pages/NotFound.svelte';
  import VersionsPage from './pages/editor/VersionsPage.svelte';
  import VersionEditPage from './pages/editor/VersionEditPage.svelte';
  import BlockEditPage from './pages/editor/BlockEditPage.svelte';
  import SequenceEditPage from './pages/editor/SequenceEditPage.svelte';
  import ItemEditPage from './pages/editor/ItemEditPage.svelte';

  const componentMap: Record<string, Component<Record<string, string>>> = {
    Login: Login as Component<Record<string, string>>,
    CourseList: CourseList as Component<Record<string, string>>,
    CourseView: CourseView as Component<Record<string, string>>,
    SequencePlayer: SequencePlayer as Component<Record<string, string>>,
    VersionsPage: VersionsPage as Component<Record<string, string>>,
    VersionEditPage: VersionEditPage as Component<Record<string, string>>,
    BlockEditPage: BlockEditPage as Component<Record<string, string>>,
    SequenceEditPage: SequenceEditPage as Component<Record<string, string>>,
    ItemEditPage: ItemEditPage as Component<Record<string, string>>,
  };

  const matched = $derived(matchRoute(routes, currentRoute.path));

  // Path-level guard. Hash-only changes do not re-evaluate (intentional).
  $effect(() => {
    if (currentRoute.path === '/' && !session.loading) {
      navigate('/courses', { replace: true });
      return;
    }
    if (matched && matched.route.auth && session.user === null && !session.loading) {
      const next = encodeURIComponent(currentRoute.path + currentRoute.search + currentRoute.hash);
      navigate(`/login?next=${next}`, { replace: true, force: true });
    }
  });
</script>

{#if session.loading}
  <div class="loading"><Spinner /></div>
{:else if matched}
  {@const Comp = componentMap[matched.route.component]}
  <Comp {...matched.params} />
{:else}
  <NotFound />
{/if}
<Toaster />

<style>
  .loading { display: flex; justify-content: center; padding: var(--space-6); }
</style>
