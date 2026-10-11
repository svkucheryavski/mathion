<script lang="ts">
  import { session } from '../stores/session.svelte';
  import { defaultLandingPath, navigate } from '../lib/router.svelte';

  const backHref = $derived(defaultLandingPath(session.user));
</script>

<div class="page">
  <h1>Page not found</h1>
  <p><a href={backHref}
        onclick={(e) => { e.preventDefault(); navigate(backHref); }}>Back</a></p>
</div>

<style>
  /* The shared page column, so the text lines up with the header's logo. */
  .page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3); }
</style>
