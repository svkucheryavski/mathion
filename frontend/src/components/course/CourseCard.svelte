<script lang="ts">
  import type { CourseListItem } from '../../lib/types';
  import { navigate } from '../../lib/router.svelte';
  let { course }: { course: CourseListItem } = $props();
  // $derived keeps these reactive if `course` props update (e.g. after a list refetch).
  const adminOnly = $derived(course.is_admin && course.version_id === null);
  const studentHref = $derived(`/courses/${course.course.slug}`);
  const editHref = $derived(`/courses/${course.course.slug}/edit`);
  const runsHref = $derived(`/teaching/${course.course.slug}`);
  // Floor a nonzero fraction to a visible 2%: a started course (covered > 0) whose
  // exact percentage rounds to 0 (e.g. 1/220 → 0.45%) must not render an empty bar.
  const pct = $derived(
    course.total_items > 0
      ? Math.max(Math.round((course.covered_items / course.total_items) * 100), course.covered_items > 0 ? 2 : 0)
      : 0
  );
  const countText = $derived(
    course.total_items === 0 ? 'No items'
    : course.covered_items === 0 ? 'Not started'
    : `${course.covered_items}/${course.total_items} items`
  );
  const ctaText = $derived(course.covered_items > 0 ? 'Continue →' : 'Start →');
  // DRAFT = an admin enrolled in an unpublished (created) version — a real version_state.
  const isDraft = $derived(course.is_admin && course.version_id !== null && course.version_state === 'created');
</script>

{#snippet bar()}
  <span class="bar" aria-hidden="true"><span class="bar-fill" style="width:{pct}%"></span></span>
{/snippet}

{#snippet adminFooter()}
  <div class="footer">
    <a class="foot-link" href={editHref}
       onclick={(e) => { e.preventDefault(); navigate(editHref); }}
       aria-label={`Edit ${course.course.name}`}>Edit</a>
    <a class="foot-link" href={runsHref}
       onclick={(e) => { e.preventDefault(); navigate(runsHref); }}
       aria-label={`Runs for ${course.course.name}`}>Runs</a>
    {#if isDraft}
      <span class="badge-draft">DRAFT</span>
    {:else}
      <span class="badge-admin">ADMIN</span>
    {/if}
  </div>
{/snippet}

{#if adminOnly}
  <!-- Admin of a course they are NOT enrolled in (also covers an admin whose only
       enrolment is on a disabled version — student.py:165-166): no progress data exists. -->
  <div class="card">
    <div class="body">
      <h3 class="title"><a class="title-link" href={editHref}
        onclick={(e) => { e.preventDefault(); navigate(editHref); }}>{course.course.name}</a></h3>
      <span class="hint">No active enrolment</span>
    </div>
    {@render adminFooter()}
  </div>
{:else if course.is_admin}
  <!-- Mixed (admin + enrolled): two destinations, so the card is a <div> and the
       CTA is a real anchor (a plain <span> here would delete the Continue link). -->
  <div class="card">
    <div class="body">
      <h3 class="title"><a class="title-link" href={studentHref}
        onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>{course.course.name}</a></h3>
      {@render bar()}
      <span class="meta">
        <span class="count">{countText}</span>
        <a class="cta" href={studentHref}
           onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>{ctaText}</a>
      </span>
    </div>
    {@render adminFooter()}
  </div>
{:else}
  <!-- Pure student: the whole card is the link (no nested anchors inside). -->
  <a class="card card-link" href={studentHref}
     onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>
    <div class="body">
      <h3 class="title">{course.course.name}</h3>
      {@render bar()}
      <span class="meta">
        <span class="count">{countText}</span>
        <span class="cta">{ctaText}</span>
      </span>
    </div>
    <div class="footer footer-status">{course.is_active ? 'Enrolled' : 'Past enrolment'}</div>
  </a>
{/if}

<style>
  .card { display: block; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); overflow: hidden; color: var(--text); }
  /* Svelte scopes `.card-link` to `.card-link.svelte-<hash>` (0,2,0), which
     already outranks the global `a:hover` (0,1,1, base.css:13) — so the card
     text does not underline on hover; no extra hover override is needed. */
  .card-link { text-decoration: none; }
  .card-link:hover { border-color: var(--primary); }
  .body { padding: 14px; /* ref 2044 */ display: flex; flex-direction: column; gap: 10px; /* ref 2044 */ }
  .title { font-size: 14.5px; /* ref 2045 */ font-weight: 600; line-height: 1.3; color: var(--text); }
  .title-link { color: inherit; text-decoration: none; }
  .title-link:hover { text-decoration: underline; }
  .hint { font-size: 12px; /* no ref card for the admin-only branch — matches the 12px footer/secondary scale */ color: var(--muted); }
  .bar { display: block; height: 4px; /* ref 2046 */ background: var(--border-soft); border-radius: var(--radius-pill); overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: var(--primary); }
  .meta { display: flex; align-items: baseline; justify-content: space-between; }
  .count { font-family: var(--font-mono); font-size: 11.5px; /* ref 2048 */ color: var(--muted); }
  .cta { font-size: 12.5px; /* ref 2049 */ font-weight: 500; color: var(--primary); text-decoration: none; }
  .cta:hover { text-decoration: underline; }
  .footer { display: flex; gap: 14px; /* ref 2052 */ padding: 8px 14px; /* ref 2052 */ border-top: 1px solid var(--border-soft); background: var(--surface-3); font-size: 12px; color: var(--muted); }
  .foot-link { color: var(--muted); text-decoration: none; }
  .foot-link:hover { color: var(--primary); }
  .badge-admin, .badge-draft { margin-left: auto; font-size: 10.5px; /* ref 2054 */ font-weight: 500; letter-spacing: .04em; padding: 2px 6px; border-radius: var(--radius-pill); }
  .badge-admin { color: var(--primary); background: var(--primary-soft); }
  .badge-draft { color: var(--state-created-fg); background: var(--state-created-bg); }
</style>
