<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import type { CourseListItem } from '../lib/types';
  import CourseCard from '../components/course/CourseCard.svelte';
  import Skeleton from '../components/ui/Skeleton.svelte';
  import EmptyState from '../components/ui/EmptyState.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';

  let loading = $state(true);
  let courses = $state<CourseListItem[]>([]);
  let error = $state('');
  // Retry counter (Slice-4 enumerated (A)2): the load effect reads it at its
  // top, so incrementing it re-runs the fetch. Retry is reachable only from
  // the error branch — i.e. after the previous request settled — so at most
  // one request is ever in flight and no stale-response guard is needed.
  let reloadTick = $state(0);
  // Current enrolments only: version_id !== null excludes admin-only rows (not
  // enrolments), is_active excludes past enrolments — so the header never disagrees
  // with a pure-student card's "Past enrolment" footer. (courses.length would
  // over-count, catastrophically for a superuser who gets an admin-only row per course.)
  const enrolledCount = $derived(courses.filter((c) => c.version_id !== null && c.is_active).length);

  $effect(() => {
    void reloadTick;
    loading = true;
    error = '';
    api.get<CourseListItem[]>('/api/my-courses')
      .then((cs) => { courses = cs; })
      .catch((e: unknown) => { error = e instanceof ApiError ? e.displayMessage : 'Failed to load courses.'; })
      .finally(() => { loading = false; });
  });

  function retry(): void { reloadTick += 1; }
</script>

<div class="page">
  <div class="page-head">
    <h1>Your courses</h1>
    {#if enrolledCount > 0}<span class="enrolled">{enrolledCount} enrolled</span>{/if}
  </div>

  {#if loading}
    <Skeleton />
  {:else if error}
    <ErrorState title="Couldn't load courses" message={error} onretry={retry} />
  {:else if courses.length === 0}
    <EmptyState title="You're not enrolled in any courses yet — ask your teacher for an invite." />
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
  .page-head { display: flex; align-items: center; gap: 12px; /* ref 2038 */ margin-bottom: var(--space-3); /* 16px, ref 2038 */ }
  .page-head h1 { margin: 0; flex: 1; }
  .enrolled { font-family: var(--font-mono); font-size: 12px; /* ref 2040 */ color: var(--muted); }
  /* grid gap 16px → 12px (ref 2042); responsive auto-fill columns kept */
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
</style>
