<script lang="ts">
  // Old run addresses (/courses/:slug/runs[/:runId]) moved under /teaching.
  // The routes stay (auth: true) so a signed-out bookmark still goes through
  // login with `next`; App owns that case, so nothing happens here until the
  // session has a user. search and hash are read inside untrack: the effect
  // depends only on the params and the user.
  import { untrack } from 'svelte';
  import { currentRoute, navigate } from '../../lib/router.svelte';
  import { session } from '../../stores/session.svelte';

  let { courseSlug, runId = undefined }: { courseSlug: string; runId?: string } = $props();

  $effect(() => {
    const slug = courseSlug;
    const rid = runId;
    if (session.user === null) return;
    const base = `/teaching/${encodeURIComponent(slug)}`
      + (rid !== undefined ? `/runs/${encodeURIComponent(rid)}` : '');
    untrack(() => {
      void navigate(base + currentRoute.search + currentRoute.hash, { replace: true });
    });
  });
</script>
