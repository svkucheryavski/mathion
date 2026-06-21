<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import type { CourseListItem } from '../lib/types';
  import CourseCard from '../components/course/CourseCard.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  let loading = $state(true);
  let courses = $state<CourseListItem[]>([]);
  let error = $state('');

  $effect(() => {
    loading = true;
    api.get<CourseListItem[]>('/api/my-courses')
      .then((cs) => { courses = cs; })
      .catch((e: unknown) => { error = e instanceof ApiError ? e.displayMessage : 'Failed to load courses.'; })
      .finally(() => { loading = false; });
  });
</script>

<div class="page">
  <h1>Your courses</h1>

  {#if loading}
    <Spinner />
  {:else if error}
    <p class="error">{error}</p>
  {:else if courses.length === 0}
    <p class="empty">You're not enrolled in any courses yet — ask your teacher for an invite.</p>
  {:else}
    <div class="grid">
      {#each courses as c (c.course.id)}
        <CourseCard course={c} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  .page h1 { margin-bottom: var(--space-4); }
  .grid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .empty { color: var(--muted); padding: var(--space-6) 0; text-align: center; }
  .error { color: var(--danger); }
</style>
