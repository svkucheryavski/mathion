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
  /* 12.5px, NOT ref 2117's 11.5px — a deliberate, user-directed deviation
     applied to BOTH mono "N of M" counters so they stay consistent: this one and
     QuizItem's .q-counter sit ~40px apart on this screen, and 11.5px was
     reported as too small to scan on the real stack (2026-09-04). Deviating on
     one alone would have shipped two different sizes for the same kind of
     positional chrome. NOTE this reverses spec:379's converged revA-I3, which
     pinned mono counts product-wide at 11.5px citing mathion-visual-spec.md:250-251
     — a citation that is still normative in the VENDORED handoff, which is
     deliberately not edited; spec §124(c) records the deviation instead.
     THE RULE, split by KIND rather than by scope: a POSITIONAL counter
     ("Item N of M", "Question N of M") is 12.5px; a PROGRESS RATIO
     ({covered}/{total}) stays 11.5px. So CourseCard.svelte:105 keeps 11.5px
     because it is a ratio ("14/22 items"), and so will T7's SequenceLink .count
     — which is IN this slice, so "CourseCard is the one place left at 11.5px"
     (an earlier revision of this comment, and of spec:124) is FALSE. The two
     families never share a screen: ratios live on CourseList and CourseView,
     positions on the player. */
  .counter { margin-left: auto; font-family: var(--font-mono); font-size: 12.5px; color: var(--muted); }
  /* No max-width here — the measure lives on the components that have prose to
     measure (QuizItem, PageItem), not on the player's content slot.
     WHY THE CAP MOVED, precisely, because the first two attempts at this were
     both wrong: ref 2120 is `max-width:68ch` on the quiz column of artboard 2c,
     which is `width:900px` (reference-screens.dc.html:2087) — NOT the 1180px an
     earlier revision of this comment claimed; 1180px is artboard 2d, a different
     screen. Inside 2c the card border and its `padding:16px 20px 20px` leave an
     858px column, so the reference's quiz occupies 76% of its column. The
     reference document sets no root font-size (its whole stylesheet is
     `*{box-sizing}` + `body{margin,background}` + `a{color}` — the <style> block
     is :15-19, its three rules :16-18), so its 68ch resolved at 16px.
     THE FONT IS LOAD-BEARING, and an earlier revision of this comment implied
     the opposite by calling those three rules the document's "entire
     stylesheet": :14 is a <link> to Google Fonts pulling IBM Plex Sans, and
     `ch` is the advance of "0" in the ELEMENT's font. IBM Plex Sans's zero is
     exactly 0.6em, so 68 x 0.6 x 16 = 652.8px (measured live: 652.797px). With
     that link absent the same document falls back to generic sans-serif and the
     element measures 605px — so a reader who believed there was no stylesheet
     beyond three rules would port 605, not 653. Rounded to 652px below.
     Note this app does not touch the root either: --font-size-base:14px is set
     on `body` (base.css:5), never on html/:root, so `rem` is NOT exposed to this
     bug — only units resolving against the INHERITED size, i.e. `ch`. A sweep of
     the whole reference found this was its only such value (revD Part 1). Porting the literal `68ch` into this app,
     whose base is 14px (theme-default.css:67), silently re-resolved it to 571px
     — 61.5% of our 928px column, which is exactly the "2/3 of the width" a user
     reported on the real stack (2026-09-04). The bug was the UNIT, not the cap,
     so the cap is restored at 652px as a px literal in the two components below;
     video and interactive apps stay uncapped because they are UI, not prose, and
     the reference gives them no measure. Do not "simplify" 652px back to a ch
     value: that is the round trip that caused this. */
  .content { padding: 0; min-height: 200px; }
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
