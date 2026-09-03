<script lang="ts">
  import { ApiError } from '../lib/api';
  import { currentCourse, loadCourse, recordItemVisit } from '../stores/currentCourse.svelte';
  import { currentRoute, navigate } from '../lib/router.svelte';
  import ItemRouter from '../components/items/ItemRouter.svelte';
  import ItemIcon from '../components/course/ItemIcon.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Button from '../components/ui/Button.svelte';
  import type { SequenceContent, Item } from '../lib/types';

  let { courseSlug, sequenceId }: { courseSlug: string; sequenceId: string } = $props();

  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  $effect(() => {
    if (currentCourse.value?.slug !== courseSlug) {
      loading = true;
      error = null;
      loadCourse(courseSlug)
        .catch((e: unknown) => {
          if (e instanceof ApiError) error = { status: e.status, message: e.displayMessage };
          else error = { status: 500, message: 'Could not load course.' };
        })
        .finally(() => { loading = false; });
    } else {
      loading = false;
    }
  });

  const sequence = $derived<SequenceContent | null>(
    currentCourse.value?.blocks
      .flatMap((b) => b.sequences)
      .find((s) => String(s.id) === sequenceId) ?? null,
  );

  const currentBlock = $derived(
    currentCourse.value?.blocks.find(
      (b) => b.sequences.some((s) => String(s.id) === sequenceId),
    ) ?? null,
  );

  // Initial item resolution: hash → last_visited_at → first.
  function resolveInitialItemId(seq: SequenceContent): number | null {
    if (seq.items.length === 0) return null;
    const m = currentRoute.hash.match(/^#item=(\d+)$/);
    if (m) {
      const hashed = Number(m[1]);
      if (seq.items.some((it) => it.id === hashed)) return hashed;
    }
    const stateItems = currentCourse.value?.state.items ?? {};
    let bestId: number | null = null;
    let bestTime = -Infinity;
    for (const it of seq.items) {
      const visited = stateItems[String(it.id)]?.last_visited_at;
      if (visited) {
        const t = new Date(visited).getTime();
        if (t > bestTime) { bestTime = t; bestId = it.id; }
      }
    }
    return bestId ?? seq.items[0].id;
  }

  let currentItemId = $state<number | null>(null);

  $effect(() => {
    if (sequence && currentItemId === null) {
      const initial = resolveInitialItemId(sequence);
      if (initial !== null) {
        navigate(`/courses/${courseSlug}/seq/${sequenceId}#item=${initial}`, { replace: true });
      }
    }
  });

  // React to hash changes (#item=).
  $effect(() => {
    const m = currentRoute.hash.match(/^#item=(\d+)$/);
    if (m) {
      const newId = Number(m[1]);
      if (newId !== currentItemId) {
        currentItemId = newId;
        recordItemVisit(newId);
      }
    }
  });

  const currentItem = $derived<Item | null>(
    sequence?.items.find((it) => it.id === currentItemId) ?? null,
  );

  function selectItem(id: number): void {
    navigate(`/courses/${courseSlug}/seq/${sequenceId}#item=${id}`, { replace: true });
  }

  const currentIndex = $derived(
    sequence && currentItemId !== null ? sequence.items.findIndex((it) => it.id === currentItemId) : -1,
  );

  // Flat course-wide ordering: every item paired with its sequence id, in display order.
  // Used by Previous/Next so they advance across sequence (and block) boundaries.
  type FlatRef = { itemId: number; sequenceId: number; title: string };
  const flatItems = $derived<FlatRef[]>(
    currentCourse.value
      ? currentCourse.value.blocks.flatMap((b) =>
          b.sequences.flatMap((s) =>
            s.items.map((it) => ({ itemId: it.id, sequenceId: s.id, title: it.title })),
          ),
        )
      : [],
  );

  const flatIndex = $derived(
    currentItemId === null ? -1 : flatItems.findIndex((x) => x.itemId === currentItemId),
  );

  function gotoFlat(target: FlatRef): void {
    navigate(`/courses/${courseSlug}/seq/${target.sequenceId}#item=${target.itemId}`, { replace: true });
  }

  function previous(): void {
    if (flatIndex > 0) gotoFlat(flatItems[flatIndex - 1]);
  }
  function next(): void {
    if (flatIndex >= 0 && flatIndex < flatItems.length - 1) gotoFlat(flatItems[flatIndex + 1]);
  }

  // D4 footer: three-way primary predicate.
  const isAtFlatEnd = $derived(flatIndex >= 0 && flatIndex === flatItems.length - 1);
  const nextRef = $derived<FlatRef | null>(
    flatIndex >= 0 && flatIndex < flatItems.length - 1 ? flatItems[flatIndex + 1] : null,
  );
  // Blank whitespace-only titles fall back to a plain "Next →".
  const nextTitle = $derived(nextRef && nextRef.title.trim() !== '' ? nextRef.title : '');

  function finish(): void {
    navigate(`/courses/${courseSlug}`);
  }

  function iconState(itemId: number): 'covered' | 'current' | 'not-yet' {
    if (itemId === currentItemId) return 'current';
    if (currentCourse.value?.state.items[String(itemId)]?.is_covered) return 'covered';
    return 'not-yet';
  }
</script>

{#snippet crumbs(seq: SequenceContent)}
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href={`/courses/${courseSlug}`}
      onclick={(e) => { e.preventDefault(); navigate(`/courses/${courseSlug}`); }}>
      {currentCourse.value?.course.name}
    </a>
    {#if currentBlock}
      <span class="sep" aria-hidden="true">/</span>
      <span class="crumb"><span class="mono">B{currentBlock.order}</span> · {currentBlock.title}</span>
      <span class="sep" aria-hidden="true">/</span>
    {/if}
    <span class="mono current">S{seq.order}</span>
  </nav>
{/snippet}

<div class="page">
  {#if loading}
    <Spinner />
  {:else if error}
    {#if error.status === 404 || error.status === 403}
      <h1>Sequence not available</h1>
      <p>This sequence isn't available to you.</p>
    {:else}
      <h1>Couldn't load</h1>
      <p>{error.message}</p>
    {/if}
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← Course</Button>
  {:else if !sequence}
    <h1>Sequence not found</h1>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← Course</Button>
  {:else if sequence.items.length === 0}
    {@render crumbs(sequence)}
    <h1 class="seq-title">{sequence.title}</h1>
    <p class="empty">This sequence has no items yet.</p>
  {:else}
    {@render crumbs(sequence)}
    <h1 class="seq-title">{sequence.title}</h1>

    <nav class="strip" aria-label="Items">
      {#each sequence.items as it (it.id)}
        <ItemIcon item={it} state={iconState(it.id)} onclick={() => selectItem(it.id)} />
      {/each}
      <span class="counter">Item {currentIndex + 1} of {sequence.items.length}</span>
    </nav>

    <main class="content">
      {#if currentItem && currentCourse.value}
        <ItemRouter item={currentItem} state={currentCourse.value.state} />
      {/if}
    </main>

    <footer>
      <Button
        variant="secondary"
        onclick={previous}
        disabled={flatIndex <= 0}
        title={flatIndex < 0 ? 'Loading…' : flatIndex === 0 ? "You're on the first item" : undefined}
      >← Previous</Button>
      {#if isAtFlatEnd}
        <Button variant="primary" onclick={finish}>Finish sequence</Button>
      {:else}
        <Button
          variant="primary"
          onclick={next}
          disabled={flatIndex < 0}
          title={flatIndex < 0 ? 'Loading…' : undefined}
        >
          {#if nextTitle}<span class="next-label">Next: <span class="next-title">{nextTitle}</span> →</span>{:else}Next →{/if}
        </Button>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  /* Breadcrumb — scoped to .crumbs so it never reaches the sibling
     <nav class="strip"> Items row. flex-wrap is a mechanism addition
     (Constraint 5b) so a long block title wraps the row, not its own column. */
  .crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px; /* ref 2107 */
    font-size: 12.5px; /* ref 2107 */
    color: var(--muted);
    margin-bottom: 10px; /* ref 2107 */
  }
  /* Without this the course link inherits the global a{color:var(--primary)}
     and renders blue; ref 2108 shows --muted. The scoped `.crumbs a`
     (specificity 0,2,1) out-specifies the global `a:hover` (0,1,1), so the
     hover underline is re-asserted here explicitly (it will not inherit). */
  .crumbs a { color: var(--muted); text-decoration: none; }
  .crumbs a:hover { color: var(--text); text-decoration: underline; }
  .crumbs .sep { color: var(--faint); }
  .crumbs .current { color: var(--text); }
  .seq-title { margin: 0 0 14px; /* ref 2110 */ }
  .strip {
    display: flex;
    gap: 6px; /* ref 2112 — no --space token is 6px */
    padding: 0 0 14px; /* ref 2112 — no top padding */
    margin-bottom: 20px; /* ref 2112 */
    border-bottom: 1px solid var(--border);
    align-items: center;
    flex-wrap: wrap;
  }
  .counter { margin-left: auto; font-family: var(--font-mono); font-size: 11.5px; /* ref 2117 */ color: var(--muted); }
  .content { padding: 0; max-width: 68ch; min-height: 200px; /* ref 2120 */ }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center; /* ref 2138 */
    margin-top: 24px; /* ref 2138 */
    padding-top: 14px; /* ref 2138 */
    border-top: 1px solid var(--border);
  }
  /* One flex item (no .btn gap between segments); nowrap keeps "Next:" + title
     + "→" on one line while the title ellipsizes via its own max-width. */
  .next-label { white-space: nowrap; min-width: 0; }
  .next-title {
    display: inline-block;
    max-width: 22ch; /* Constraint 5(b) no-ref bound */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  .empty { color: var(--muted); }
</style>
