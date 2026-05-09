<script lang="ts">
  import type { CourseListItem } from '../../lib/types';
  import { formatProgress } from '../../lib/format';
  import { navigate } from '../../lib/router.svelte';
  let { course }: { course: CourseListItem } = $props();
  // $derived keeps these reactive if `course` props update (e.g. after a list refetch).
  const adminOnly = $derived(course.is_admin && course.version_id === null);
  const studentHref = $derived(`/courses/${course.course.slug}`);
  const editHref = $derived(`/courses/${course.course.slug}/edit`);
</script>

<div class="card">
  <div class="title-row">
    <h3>{course.course.name}</h3>
    {#if course.is_admin}
      <span class="badge">Admin</span>
    {/if}
  </div>
  {#if adminOnly}
    <a class="action" href={editHref} onclick={(e) => { e.preventDefault(); navigate(editHref); }}>Edit course →</a>
  {:else}
    <div class="progress">{formatProgress(course.covered_items, course.total_items)}</div>
    <div class="actions">
      <a href={studentHref} onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>Continue →</a>
      {#if course.is_admin}
        <a class="edit" href={editHref} onclick={(e) => { e.preventDefault(); navigate(editHref); }}>Edit</a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .card { display: block; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); }
  .card:hover { border-color: var(--primary); }
  .title-row { display: flex; align-items: center; gap: var(--space-2); }
  .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--primary-soft, #eef); color: var(--primary, #335); }
  .progress { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-2); }
  .actions { display: flex; gap: var(--space-3); margin-top: var(--space-2); }
  .actions a { text-decoration: none; }
  .action { display: inline-block; margin-top: var(--space-2); }
</style>
