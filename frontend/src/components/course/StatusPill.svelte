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

<style>
  /* Authored from scratch (D6): this component had NO `<style>` block, so every
     `pill-*` class in the markup resolved to nothing and the pill rendered as
     bare text. Component-SCOPED rather than a global `.pill`, deliberately:
     `runs/RunMiniProjectsTab.svelte` authors its own unrelated top-level `.pill`
     family (`.pill-published`/`.pill-locked`) and the mini-project detail page
     carries a raw `<span class="pill pill-warning">Late</span>` of its own —
     neither is this component's surface, and a global rule would silently
     restyle both. Scoping is also what keeps visual-spec §3's one-amber rule
     intact: only the two revision statuses may wear amber.

     `padding: 3px 8px` is ref 1112, and independently the documented badge scale
     at `ui/StatusBadge.svelte:18-19` ("11px / 500 / 3px 8px / pill radius"), so
     it is both ref-backed and precedent-backed.

     `gap: 4px` is a Constraint 5(b) no-reference literal and is NOT taken from
     StatusBadge — that component is label-only, with no glyph and therefore no
     gap at all. This gap separates the leading `.pill-token` glyph from the
     label, which is a thing only this pill has.

     `white-space: nowrap` is load-bearing: "Needs revision (major)" is 24
     characters and wraps inside a MiniProjectLink row otherwise, turning a pill
     into a two-line block. */
  .pill {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    gap: 4px;
    padding: 3px 8px; /* ref 1112 */
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 500;
  }
  /* The class→token table (spec §4 T8b). Five rules, not seven: two statuses
     share `pill-neutral` (pending_group_assignment, not_submitted) and two share
     `pill-warning` (major_revision, minor_revision). The mapping lives in
     `LATEST_STATUS_META` (studentMiniProjects.ts) — these rules only give each
     class its colour, and the `.pill-token` glyph is what carries the meaning
     without colour for colourblind users (C14). */
  .pill-neutral { background: var(--status-not-submitted-bg); color: var(--status-not-submitted-fg); }
  .pill-info    { background: var(--status-awaiting-eval-bg); color: var(--status-awaiting-eval-fg); }
  .pill-danger  { background: var(--status-rejected-bg);      color: var(--status-rejected-fg); }
  .pill-warning { background: var(--status-needs-revision-bg); color: var(--status-needs-revision-fg); }
  .pill-success { background: var(--status-accepted-bg);      color: var(--status-accepted-fg); }
</style>
