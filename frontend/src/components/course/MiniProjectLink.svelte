<script lang="ts">
  // MiniProjectLink — per-block link row rendered inside CourseView's
  // BlockGroup sequence list (spec §5). Composes StatusPill for the status
  // indicator and owns the link's `aria-label` (the SOLE place AT users hear
  // status, since D3 dropped the pill's aria-label — see StatusPill.svelte).
  //
  // No outer `<li>` here: the caller (BlockGroup) wraps this in `<li>` so
  // MiniProjectLink stays a leaf-level link that can be composed inside any
  // list container.
  //
  // href is built with `encodeURIComponent` on BOTH `courseSlug` and
  // `item.block_slug` per C10 — slugs may contain '/' or other URL-significant
  // characters that would otherwise corrupt the route.
  //
  // `titleForLabel` is a defensive fallback for empty/whitespace `block_title`
  // (malformed drafts shouldn't crash the list); the same fallback string is
  // used in BOTH the aria-label and the visible text so they always match.
  //
  // `statusLabel` is looked up from LATEST_STATUS_META — the single source of
  // truth shared with StatusPill, so the link's aria-label and the pill's
  // visible label stay in lockstep without copy duplication.
  import StatusPill from './StatusPill.svelte';
  import ItemMark from './ItemMark.svelte';
  import { LATEST_STATUS_META } from '../../lib/studentMiniProjects';
  import type { StudentMiniProjectListItem } from '../../lib/types';

  let { courseSlug, item }: { courseSlug: string; item: StudentMiniProjectListItem } = $props();

  const detailHref = $derived(
    '/courses/' +
      encodeURIComponent(courseSlug) +
      '/blocks/' +
      encodeURIComponent(item.block_slug) +
      '/mini-project',
  );
  const titleForLabel = $derived(item.block_title.trim() || 'Untitled block');
  const statusLabel = $derived(LATEST_STATUS_META[item.latest_status].label);
</script>

<a
  class="row row-mp"
  href={detailHref}
  aria-label="Mini-project: {titleForLabel}, Status: {statusLabel}"
>
  <span class="row-glyph" aria-hidden="true"><ItemMark type="mini_project" /></span>
  <span class="row-title">Mini-project: {titleForLabel}</span>
  <StatusPill status={item.latest_status} />
</a>

<style>
  /* Mirrors SequenceLink's row: both are `<li>` siblings in the same BlockGroup
     panel `<ul>`, so their geometry has to agree or the list reads as two
     unrelated lists. Row geometry is ref 1572; `border-bottom` takes
     `--border-soft` (row separators inside a card) rather than `--border` (the
     card edge, T8a) — one untokenised #E9EBEF in the reference, split by role.

     `color: var(--text)` is load-bearing here for the same reason as on
     SequenceLink: this component's root is an `<a>`, so without it the title
     renders in the global `a { color: var(--primary) }` blue (base.css:12)
     right beside a `--text` sequence title. */
  .row {
    display: flex;
    align-items: center;
    gap: 10px; /* ref 1572 */
    padding: 8px 12px; /* ref 1572 */
    border-bottom: 1px solid var(--border-soft);
    color: var(--text);
  }
  .row:hover {
    background: var(--primary-soft);
    text-decoration: none;
  }
  /* Centres the ItemMark and holds it at its locked 22px: as a flex child the
     default `flex-shrink: 1` would let the lead compress on a tight row. */
  .row-glyph {
    display: inline-flex;
    flex: 0 0 auto;
  }
  /* The twin of SequenceLink's `.row-title`, `min-width: 0` included for the
     same reason: `flex: 1` resolves to `flex-basis: 0`, so a long title would
     otherwise refuse to shrink below its min-content and break per word.

     `flex: 1` is also what pushes the StatusPill right. Deliberately NOT
     `margin-left: auto` on the pill — that would need a selector reaching into
     a child component's root, which Svelte prunes as `css_unused_selector`. */
  .row-title {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
  }
</style>
