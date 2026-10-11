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
  import { progressOf, firstUnfinishedBlockId } from '../lib/progress';

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
    {#if currentCourse.value.blocks.length > 0 && courseP}
      <!-- Info text left, the course summary card right (user, 2026-10-08). -->
      <div class="top">
        {#if currentCourse.value.version.info_html}
          <div class="info">{@html currentCourse.value.version.info_html}</div>
        {/if}
        <CourseProgress p={courseP} />
      </div>
    {:else if currentCourse.value.version.info_html}
      <div class="info">{@html currentCourse.value.version.info_html}</div>
    {/if}
    {#if currentCourse.value.blocks.length === 0}
      <EmptyState title="This course has no published blocks yet." />
    {:else}
      <!-- One small control over every block (user, 2026-10-08): "Collapse all"
           while any block is open, "Expand all" when none is. -->
      <div class="all-toggle">
        <Button variant="ghost" onclick={() => setAll(!anyOpen)}>{anyOpen ? 'Collapse all' : 'Expand all'}</Button>
      </div>
      {#each currentCourse.value.blocks as b, i (b.id)}
        <BlockGroup {courseSlug} block={b} n={i + 1} state={currentCourse.value.state} mpByBlockId={currentCourse.value.miniProjectsByBlockId}
          bind:expanded={() => open[b.id] ?? false, (v) => (open[b.id] = v)} />
      {/each}
    {/if}
  {/if}
</div>

<style>
  .page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: var(--space-3); }
  /* The admin versions page's title size (VersionsPage .heading h1). */
  h1 { font-size: 18px; min-width: 0; overflow-wrap: anywhere; }
  .info { color: var(--muted); margin: var(--space-3) 0; }
  .top { display: flex; align-items: flex-start; gap: 24px; margin-bottom: var(--space-3); }
  .top .info { flex: 1 1 auto; min-width: 0; margin: 0; }
  /* Right-aligned over the blocks' chevron column; the -6px pulls it up beside
     the summary card's bottom margin so it reads as part of the list. */
  .all-toggle { display: flex; justify-content: flex-end; margin: -6px 0 4px; }
  @media (max-width: 640px) {
    .top { flex-direction: column; gap: var(--space-3); }
  }
</style>
