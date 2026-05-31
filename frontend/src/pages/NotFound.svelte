<script lang="ts">
  import { session } from '../stores/session.svelte';
  import { defaultLandingPath, navigate } from '../lib/router.svelte';

  const backHref = $derived(defaultLandingPath(session.user));
</script>

<h1>Page not found</h1>
<p><a href={backHref}
      onclick={(e) => { e.preventDefault(); navigate(backHref); }}>Back</a></p>
