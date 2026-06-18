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
  <span class="row-glyph" aria-hidden="true">📋</span>
  <span class="row-title">Mini-project: {titleForLabel}</span>
  <StatusPill status={item.latest_status} />
</a>
