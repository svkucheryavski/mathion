<script lang="ts">
  import type { SequenceContent, VersionState } from '../../lib/types';
  import { navigate } from '../../lib/router.svelte';
  import ItemMark from './ItemMark.svelte';

  let { courseSlug, sequence, state }: { courseSlug: string; sequence: SequenceContent; state: VersionState } = $props();

  // All three are `$derived`: as plain `const`s they read `$props()` once at
  // init and captured only the initial value (three `state_referenced_locally`
  // warnings), so a parent swapping the sequence kept the old count and link.
  const total = $derived(sequence.items.length);
  const covered = $derived(
    sequence.items.filter((it) => state.items[String(it.id)]?.is_covered).length,
  );
  const href = $derived(`/courses/${courseSlug}/seq/${sequence.id}`);

  // The row's accessible name. Without it the link's name is computed from its
  // contents and comes out as "S3 Determinants 2/3" — the badge read as a bare
  // token and the ratio as an ambiguous "two slash three". The chain is
  // aria-hidden, so the count was the ONLY completion signal reaching assistive
  // tech, and it was reaching it in the least legible form available. This
  // states the same three facts in words. Visually nothing changes.
  const label = $derived(
    `Sequence S${sequence.order}: ${sequence.title}, ` +
      `${covered} of ${total} ${total === 1 ? 'item' : 'items'} completed`,
  );
</script>

<a class="row" {href} aria-label={label} onclick={(e) => { e.preventDefault(); navigate(href); }}>
  <!-- `S{order}` is a code badge (ref 1573), not a prefix on the title: the row
       used to render one combined `S{order}. {title}` text node. No trailing
       period — the badge is a label, not a numbered-list marker. The mono face
       comes from the GLOBAL `.mono` utility (base.css:10) rather than a scoped
       `font-family`, because jsdom cannot see scoped CSS and the class is
       therefore the only thing a test can pin. -->
  <span class="badge mono">S{sequence.order}</span>
  <span class="row-title">{sequence.title}</span>
  <!-- The chain is hidden from assistive tech as a whole (Constraint 3), not
       just mark by mark: completion reaches AT through the row's `aria-label`
       above, and a chain of unlabelled marks would be a second, noisier reading
       of the same fact. `current` never appears here — it is a player state. -->
  <span class="chain" aria-hidden="true">
    {#each sequence.items as it (it.id)}
      <ItemMark type={it.type} state={state.items[String(it.id)]?.is_covered ? 'covered' : 'not-yet'} />
    {/each}
  </span>
  <span class="count mono">{covered}/{total}</span>
</a>

<style>
  /* Row geometry is ref 1572, the 3b authoring sequence-row strip. The former
     `border-radius: var(--radius)` is gone: rows are edge-flush inside T8a's
     `overflow:hidden` card and separated by hairlines, so a per-row radius is
     wrong and fights the `li:last-child` border fix T8a adds. The former
     `justify-content: space-between` is gone too — `.row-title { flex:1 1 auto }`
     pushes the right-hand side now.

     `border-bottom` takes `--border-soft`, not `--border`: ref 1572 and ref
     1564 share one untokenised #E9EBEF, and it splits by ROLE — soft for row
     separators inside a card, `--border` for the card/section edge (T8a).

     `color: var(--text)` is retained and load-bearing: without it the row's
     text inherits the global `a { color: var(--primary) }` (base.css:12). */
  .row {
    display: flex;
    align-items: center;
    gap: 10px; /* ref 1572 */
    padding: 8px 12px; /* ref 1572 */
    border-bottom: 1px solid var(--border-soft);
    color: var(--text);
  }
  /* `--primary-soft` is the hover fill; the old `var(--border)` was a line
     token used as a surface. `text-decoration:none` suppresses the global
     `a:hover { text-decoration: underline }` (base.css:13). */
  .row:hover {
    background: var(--primary-soft);
    text-decoration: none;
  }
  /* ref 1573 — the twin of BlockGroup's `B{order}` badge (T8a). */
  .badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--primary);
    background: var(--primary-soft);
    padding: 2px 6px;
    border-radius: var(--radius-pill);
  }
  /* `flex: 1 1 auto`, NOT `flex: 1`. The shorthand `flex: 1` expands to
     `flex: 1 1 0%` — a flex BASIS of zero — while `.chain` keeps an auto basis
     equal to its max-content width (22px per mark plus a 6px gap, so 28n-6).
     Once badge + chain + count + gaps exceed the row, free space goes negative,
     `flex-grow` never applies, and the title resolves to ZERO width with its
     text overflowing across the marks. That happened past ~24 items on a 760px
     card and past ~9 on a 340px one — precisely the range
     mathion-visual-spec.md:253 says must "wrap cleanly". With an auto basis the
     shrink is shared in proportion to content instead of falling entirely on
     the title, so the chain wraps and the title stays readable.

     `min-width: 0` is retained so the title can still shrink below its
     min-content rather than forcing the row to overflow the card; what changed
     is that it is no longer the ONLY flexible thing in the row.

     13.5px per mathion-visual-spec.md:266; weight 600 per ref 1574 (whose own
     size, 13px, is superseded by the visual spec — a documented divergence). */
  .row-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
  }
  /* `flex-wrap: wrap` is the long-chain ruling: a sequence with many items
     wraps to further lines and the row grows taller, rather than the chain
     being capped or the title ellipsed. */
  .chain {
    display: flex;
    gap: 6px; /* mathion-visual-spec.md:249 */
    flex-wrap: wrap;
  }
  /* 11.5px because this is a progress RATIO, not a positional counter — the
     rule the 2026-09-04 counter change set: "Item N of M" is 12.5px, a
     `{covered}/{total}` ratio is 11.5px. CourseCard's `.count` is the other
     ratio and matches. */
  .count {
    font-size: 11.5px;
    color: var(--muted);
  }
</style>
