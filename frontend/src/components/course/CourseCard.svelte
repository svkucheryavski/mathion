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

{#if adminOnly}
  <!-- Admin-only: single destination → entire card is a link.
       Restores whole-card click target and gives the h3 link semantics. -->
  <a
    class="card card-link"
    href={editHref}
    onclick={(e) => { e.preventDefault(); navigate(editHref); }}
    aria-label={`Edit ${course.course.name}`}
  >
    <div class="title-row">
      <h3>{course.course.name}</h3>
      <span class="badge">Admin</span>
    </div>
  </a>
{:else if course.is_admin}
  <!-- Mixed (admin + enrolled): two destinations (Continue + Edit) — can't
       nest anchors, so the card stays a <div>. The h3 content is wrapped in
       an <a> so screen-reader heading navigation lands on a link with the
       course name. .card:hover is omitted on the div via the absence of
       .card-link, so we don't falsely advertise the whole card as clickable. -->
  <div class="card">
    <div class="title-row">
      <h3>
        <a
          class="title-link"
          href={studentHref}
          onclick={(e) => { e.preventDefault(); navigate(studentHref); }}
        >{course.course.name}</a>
      </h3>
      <span class="badge">Admin</span>
    </div>
    <div class="progress">{formatProgress(course.covered_items, course.total_items)}</div>
    <div class="actions">
      <a
        href={studentHref}
        onclick={(e) => { e.preventDefault(); navigate(studentHref); }}
      >Continue →</a>
      <a
        class="edit"
        href={editHref}
        onclick={(e) => { e.preventDefault(); navigate(editHref); }}
        aria-label={`Edit ${course.course.name}`}
      >Edit</a>
    </div>
  </div>
{:else}
  <!-- Pure student: whole card is the link, exactly the prior UX. -->
  <a
    class="card card-link"
    href={studentHref}
    onclick={(e) => { e.preventDefault(); navigate(studentHref); }}
  >
    <h3>{course.course.name}</h3>
    <div class="progress">{formatProgress(course.covered_items, course.total_items)}</div>
  </a>
{/if}

<style>
  .card { display: block; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); }
  /* Hover affordance only on cards that ARE clickable end-to-end (the <a> variants). */
  .card-link { text-decoration: none; }
  .card-link:hover { border-color: var(--primary); }
  .title-row { display: flex; align-items: center; gap: var(--space-2); }
  .title-link { color: inherit; text-decoration: none; }
  .title-link:hover { text-decoration: underline; }
  .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--primary-soft, #eef); color: var(--primary, #335); }
  .progress { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-2); }
  .actions { display: flex; gap: var(--space-3); margin-top: var(--space-2); }
  .actions a { text-decoration: none; }
</style>
