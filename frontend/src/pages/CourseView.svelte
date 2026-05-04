<script lang="ts">
  import { ApiError } from '../lib/api';
  import { currentCourse, loadCourse } from '../stores/currentCourse.svelte';
  import { navigate } from '../lib/router.svelte';
  import BlockGroup from '../components/course/BlockGroup.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
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
</script>

<div class="page">
  {#if loading}
    <Spinner />
  {:else if error}
    {#if error.status === 404}
      <h1>Course not available</h1>
      <p>This course isn't available to you. Ask your teacher for an invite link, or check the URL.</p>
    {:else if error.status === 403}
      <h1>Access denied</h1>
      <p>You don't have access to this course.</p>
    {:else}
      <h1>Couldn't load course</h1>
      <p>{error.message}</p>
    {/if}
    <Button variant="ghost" onclick={() => navigate('/courses')}>Back to courses</Button>
  {:else if currentCourse.value}
    <header>
      <Button variant="ghost" onclick={() => navigate('/courses')}>← Courses</Button>
      <h1>{currentCourse.value.course.name}</h1>
    </header>
    {#if currentCourse.value.version.info_html}
      <div class="info">{@html currentCourse.value.version.info_html}</div>
    {/if}
    {#if currentCourse.value.blocks.length === 0}
      <p class="empty">This course has no published blocks yet.</p>
    {:else}
      {#each currentCourse.value.blocks as b (b.id)}
        <BlockGroup {courseSlug} block={b} state={currentCourse.value.state} />
      {/each}
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .info { color: var(--muted); margin: var(--space-3) 0; }
  .empty { color: var(--muted); }
</style>
