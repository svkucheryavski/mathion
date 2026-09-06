<script lang="ts">
  import { ApiError } from '../lib/api';
  import { currentCourse, loadCourse } from '../stores/currentCourse.svelte';
  import { navigate } from '../lib/router.svelte';
  import BlockGroup from '../components/course/BlockGroup.svelte';
  import Skeleton from '../components/ui/Skeleton.svelte';
  import EmptyState from '../components/ui/EmptyState.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';
  import Button from '../components/ui/Button.svelte';

  let { courseSlug }: { courseSlug: string } = $props();

  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  $effect(() => {
    loading = true;
    error = null;
    loadCourse(courseSlug)
      .catch((e: unknown) => {
        if (e instanceof ApiError) {
          error = { status: e.status, message: e.displayMessage };
        } else {
          error = { status: 500, message: 'Could not load course.' };
        }
      })
      .finally(() => { loading = false; });
  });

  // Page-level error copy (Slice-4 §2): the three branches, text verbatim.
  const errorTitle = $derived.by(() => {
    if (error === null) return '';
    if (error.status === 404) return 'Course not available';
    if (error.status === 403) return 'Access denied';
    return "Couldn't load course";
  });
  const errorMessage = $derived.by(() => {
    if (error === null) return '';
    if (error.status === 404) return "This course isn't available to you. Ask your teacher for an invite link, or check the URL.";
    if (error.status === 403) return "You don't have access to this course.";
    return error.message;
  });
</script>

<div class="page">
  {#if loading}
    <Skeleton rows={4} />
  {:else if error}
    <ErrorState variant="page" title={errorTitle} message={errorMessage}>
      {#snippet action()}
        <Button variant="secondary" onclick={() => navigate('/courses')}>Back to courses</Button>
      {/snippet}
    </ErrorState>
  {:else if currentCourse.value}
    <header>
      <Button variant="ghost" onclick={() => navigate('/courses')}>← Courses</Button>
      <h1>{currentCourse.value.course.name}</h1>
    </header>
    {#if currentCourse.value.version.info_html}
      <div class="info">{@html currentCourse.value.version.info_html}</div>
    {/if}
    {#if currentCourse.value.blocks.length === 0}
      <EmptyState title="This course has no published blocks yet." />
    {:else}
      {#each currentCourse.value.blocks as b (b.id)}
        <BlockGroup {courseSlug} block={b} state={currentCourse.value.state} mpByBlockId={currentCourse.value.miniProjectsByBlockId} />
      {/each}
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .info { color: var(--muted); margin: var(--space-3) 0; }
</style>
