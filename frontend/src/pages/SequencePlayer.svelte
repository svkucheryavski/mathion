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

  function previous(): void {
    if (sequence && currentIndex > 0) selectItem(sequence.items[currentIndex - 1].id);
  }
  function next(): void {
    if (sequence && currentIndex >= 0 && currentIndex < sequence.items.length - 1) {
      selectItem(sequence.items[currentIndex + 1].id);
    }
  }

  function iconState(itemId: number): 'covered' | 'current' | 'not-yet' {
    if (itemId === currentItemId) return 'current';
    if (currentCourse.value?.state.items[String(itemId)]?.is_covered) return 'covered';
    return 'not-yet';
  }
</script>

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
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← {currentCourse.value?.course.name}</Button>
      <h1>{sequence.title}</h1>
    </header>
    <p class="empty">This sequence has no items yet.</p>
  {:else}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}`)}>← {currentCourse.value?.course.name}</Button>
      <h1>{sequence.title}</h1>
    </header>

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
      <Button variant="secondary" onclick={previous} disabled={currentIndex <= 0}>← Previous</Button>
      <Button variant="secondary" onclick={next} disabled={currentIndex >= sequence.items.length - 1}>Next →</Button>
    </footer>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .strip {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
    align-items: center;
    flex-wrap: wrap;
  }
  .counter { margin-left: auto; color: var(--muted); font-size: 0.875rem; }
  .content { padding: var(--space-3) 0; min-height: 200px; }
  footer { display: flex; justify-content: space-between; padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .empty { color: var(--muted); }
</style>
