<script lang="ts">
  // StatusPill — single shared pill for all 7 latest_status values (spec §5).
  //
  // Markup is intentionally minimal: a `<span class="pill pill-X">` with a
  // leading `<span class="pill-token" aria-hidden="true">` glyph providing
  // the non-color signal for colorblind users (C14), followed by the visible
  // label.
  //
  // D3 policy: NO `aria-label` on the pill — the visible text is the
  // accessible name, and the mini-project detail page owns a separate
  // sr-only aria-live region as the sole status announcer (adding an
  // aria-label here would double-announce).
  //
  // Label + class + glyph come from LATEST_STATUS_META (the single source of
  // truth in studentMiniProjects.ts), so D2 neighbors (MiniProjectLink) can
  // import the same meta map without duplicating copy.
  import { LATEST_STATUS_META, type LatestStatus } from '../../lib/studentMiniProjects';

  let { status }: { status: LatestStatus } = $props();

  const meta = $derived(LATEST_STATUS_META[status]);
</script>

<span class="pill {meta.cls}"><span class="pill-token" aria-hidden="true">{meta.token}</span> {meta.label}</span>
