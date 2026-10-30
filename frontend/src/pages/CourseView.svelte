<script lang="ts">
  import { ApiError } from '../lib/api';
  import { currentCourse, loadCourse } from '../stores/currentCourse.svelte';
  import { navigate } from '../lib/router.svelte';
  import BlockGroup from '../components/course/BlockGroup.svelte';
  import Skeleton from '../components/ui/Skeleton.svelte';
  import EmptyState from '../components/ui/EmptyState.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';
  import Button from '../components/ui/Button.svelte';
  import IconButton from '../components/ui/IconButton.svelte';
  import CourseProgress from '../components/course/CourseProgress.svelte';
  import ProgressMeter from '../components/course/ProgressMeter.svelte';
  import { progressOf, progressPhrase, firstUnfinishedBlockId } from '../lib/progress';
  import { externalLinks } from '../lib/externalLinks';

  let { courseSlug }: { courseSlug: string } = $props();

  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  // Which blocks are open, by block id (user, 2026-10-08). Set ONCE per load:
  // the first unfinished block opens, the rest start collapsed. After that it
  // is the student's: nothing re-closes a block as their progress changes.
  let open = $state<Record<number, boolean>>({});
  const anyOpen = $derived(currentCourse.value?.blocks.some((b) => open[b.id]) ?? false);
  function setAll(v: boolean) {
    for (const b of currentCourse.value?.blocks ?? []) open[b.id] = v;
  }

  $effect(() => {
    loading = true;
    error = null;
    loadCourse(courseSlug)
      .then(() => {
        const c = currentCourse.value;
        if (!c) return;
        const current = firstUnfinishedBlockId(c.blocks, c.state);
        open = Object.fromEntries(c.blocks.map((b) => [b.id, b.id === current]));
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError) {
          error = { status: e.status, message: e.displayMessage };
        } else {
          error = { status: 500, message: 'Could not load course.' };
        }
      })
      .finally(() => { loading = false; });
  });

  // The course-wide totals for the summary card: every item in every block.
  const courseP = $derived(
    currentCourse.value
      ? progressOf(currentCourse.value.blocks.flatMap((b) => b.sequences.flatMap((s) => s.items)), currentCourse.value.state)
      : null,
  );

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
    <!-- The admin versions page's heading: round back button + 18px title. -->
    <header>
      <IconButton round glyph="back" title="Back to courses" onclick={() => navigate('/courses')} />
      <h1>{currentCourse.value.course.name}</h1>
    </header>
    {#if currentCourse.value.blocks.length === 0}
      {#if currentCourse.value.version.info_html}
        <div class="info prose compact" {@attach externalLinks(currentCourse.value.version.info_html)}>{@html currentCourse.value.version.info_html}</div>
      {/if}
      <EmptyState title="This course has no published blocks yet." />
    {:else}
      <!-- D78 (user, layout A): the blocks on the left; the course summary card
           and the info in a right-hand column. Under 880px one column in this
           DOM order -- summary, blocks, info -- so the blocks come before a long
           info on a phone, and the reading order is the order on screen. -->
      <div class="cv-body" class:has-info={!!currentCourse.value.version.info_html}>
        {#if courseP}
          <div class="cv-prog"><CourseProgress p={courseP} /></div>
        {/if}
        <div class="cv-blocks">
          <!-- D78 (user): at 880px and below the card and the text toggle give way
               to this bare row -- the course meter in the block columns and a
               chevron that replaces "Collapse all / Expand all". Only one of the
               two forms is displayed at a time (CSS), so a screen reader meets
               one. The meter is aria-hidden; the sentence states it, first, as
               the card does. -->
          {#if courseP}
            <div class="cv-strip">
              <p class="sr-only">Your progress: {progressPhrase(courseP)}.</p>
              <span class="cv-meter"><ProgressMeter p={courseP} onStrip /></span>
              <IconButton borderless glyph={anyOpen ? 'chevron' : 'chevron-right'} title={anyOpen ? 'Collapse all' : 'Expand all'} onclick={() => setAll(!anyOpen)} />
            </div>
          {/if}
          <!-- One small control over every block (user, 2026-10-08): "Collapse all"
               while any block is open, "Expand all" when none is. -->
          <div class="all-toggle">
            <Button variant="ghost" onclick={() => setAll(!anyOpen)}>{anyOpen ? 'Collapse all' : 'Expand all'}</Button>
          </div>
          {#each currentCourse.value.blocks as b, i (b.id)}
            <BlockGroup {courseSlug} block={b} n={i + 1} state={currentCourse.value.state} mpByBlockId={currentCourse.value.miniProjectsByBlockId}
              bind:expanded={() => open[b.id] ?? false, (v) => (open[b.id] = v)} />
          {/each}
        </div>
        {#if currentCourse.value.version.info_html}
          <div class="info prose compact" {@attach externalLinks(currentCourse.value.version.info_html)}>{@html currentCourse.value.version.info_html}</div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: var(--space-3); }
  /* The admin versions page's title size (VersionsPage .heading h1). */
  h1 { font-size: 18px; min-width: 0; overflow-wrap: anywhere; }
  /* D76: the course info is a near-white box on the page ground, so it reads as
     its own panel beside the white progress card, not as loose text. */
  .info {
    color: var(--muted);
    margin: var(--space-3) 0;
    background: var(--surface-ground);
    border: 1px solid var(--border-box);
    border-radius: var(--radius-lg);
    padding: 12px 16px;
  }
  /* D78: blocks left, the summary card over the info in a 300px right column
     (the mini-project page's column, D69). Without info the column holds the
     card alone. Under 880px one column in DOM order; stretch, because the
     grid's start would shrink each part to its content. */
  .cv-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-areas: "blocks prog" "blocks info"; grid-template-rows: auto 1fr; gap: 14px; align-items: start; }
  .cv-body:not(.has-info) { grid-template-areas: "blocks prog"; grid-template-rows: auto; }
  .cv-prog { grid-area: prog; }
  .cv-blocks { grid-area: blocks; min-width: 0; }
  .cv-body > .info { grid-area: info; margin: 0; }
  /* Right-aligned over the blocks' chevron column, at the top of the left column. */
  .all-toggle { display: flex; justify-content: flex-end; margin: 0 0 4px; }
  /* D78: the phone row, in the block header's columns. The 28px chevron button
     insets its 14px glyph 7px, so the 6px padding puts the glyph's right edge
     13px in, where a block's 13px chevron ends (1px border + 12px padding; the
     centres differ by half a pixel). The 2px gap plus that 7px inset puts the
     chip's right edge 36px in, where a header puts it. Off above 880px. The
     880px switch below must come AFTER these rules: same specificity. */
  .cv-strip { display: none; align-items: center; justify-content: flex-end; gap: 2px; padding: 4px 6px 4px 0; margin: 0 0 4px; }
  .cv-meter { display: flex; align-items: center; gap: 10px; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  @media (max-width: 880px) {
    .cv-body { display: flex; flex-direction: column; align-items: stretch; }
    .cv-prog, .all-toggle { display: none; }
    .cv-strip { display: flex; }
  }
</style>
