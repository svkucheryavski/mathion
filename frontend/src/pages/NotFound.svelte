<script lang="ts">
  import { session } from '../stores/session.svelte';
  import { defaultLandingPath } from '../lib/router.svelte';
</script>

<h1>Page not found</h1>
<p><a href={defaultLandingPath(session.user)}>Back</a></p>
