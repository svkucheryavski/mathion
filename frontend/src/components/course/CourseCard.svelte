<script lang="ts">
  import type { CourseListItem } from '../../lib/types';
  import { formatProgress } from '../../lib/format';
  import { navigate } from '../../lib/router.svelte';
  let { course }: { course: CourseListItem } = $props();
</script>

<a class="card" href={`/courses/${course.course.slug}`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course.course.slug}`); }}>
  <h3>{course.course.name}</h3>
  <div class="progress">{formatProgress(course.covered_items, course.total_items)}</div>
</a>

<style>
  .card {
    display: block;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-decoration: none;
    color: var(--text);
  }
  .card:hover { border-color: var(--primary); }
  .progress { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-2); }
</style>
