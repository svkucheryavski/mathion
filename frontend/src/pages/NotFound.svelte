<script lang="ts">
  import { session } from '../stores/session.svelte';
  import { defaultLandingPath, landingLabel, navigate } from '../lib/router.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';
  import Button from '../components/ui/Button.svelte';

  // D53: one button that names the person's start page. Signed out it is
  // "Sign in": defaultLandingPath(null) returns /courses, so that case is
  // decided here. A Button, as on the other page ErrorStates (no cmd-click).
  const target = $derived(session.user === null ? '/login' : defaultLandingPath(session.user));
  const label = $derived(session.user === null ? 'Sign in' : landingLabel(target));
</script>

<div class="page">
  <ErrorState variant="page" title="Page not found" message="The address may be mistyped, or the page has moved.">
    {#snippet action()}
      <Button variant="secondary" onclick={() => navigate(target)}>{label}</Button>
    {/snippet}
  </ErrorState>
</div>

<style>
  /* The shared page column, so the text lines up with the header's logo. */
  .page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3); }
</style>
