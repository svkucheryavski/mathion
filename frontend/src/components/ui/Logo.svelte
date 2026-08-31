<script lang="ts">
  // Product logo mark: two overlapping peaks — gold behind, steel blue in front —
  // transcribed verbatim from the "Header lockup — exact geometry" block of the
  // visual-refresh handoff (docs/design/visual-refresh/base.css). The viewBox is
  // cropped to the ink (source art 32×32; strokes bottom out at 21.8 + half of 3.6
  // = 23.6) so there is no dead space under the strokes.
  //
  // Slice 1 ships ONLY the self-contained 'header' form (26×19.2, stroke 3.6). The
  // 'login' (28px, stroke 4, full 0 0 32 32) and 'favicon' (24px reversed on a
  // #3F5C77 tile, stroke 3.2) forms — and any props they need — are added by the
  // slices that consume them. No props this slice.
  //
  // The lockup positioning (gap + baseline nudge) lives in the consumer
  // (AppHeader), not here — this component only draws the mark.
  // Peaks are coloured via CSS (SVG presentation attributes cannot resolve var()).
</script>

<svg
  class="logo"
  width="26"
  height="19.2"
  viewBox="0 0 32 23.6"
  fill="none"
  aria-hidden="true"
>
  <!-- back peak (gold), drawn first so the front peak paints over it -->
  <path class="peak-back" d="M10.15 21.8 18.25 10.2 28.05 21.8" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" />
  <!-- front peak (steel blue) -->
  <path class="peak-front" d="M3.95 21.7 10.85 12 19.25 21.7" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  .logo { display: block; }
  .peak-back { stroke: var(--gold); }
  .peak-front { stroke: var(--primary); }
</style>
