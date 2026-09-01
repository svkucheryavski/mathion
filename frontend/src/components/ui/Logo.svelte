<script lang="ts">
  // Product logo mark: two overlapping peaks — gold behind, steel blue in front —
  // transcribed from the visual-refresh handoff. Two forms share the same paths and
  // differ only in box + stroke:
  //   'header' = self-contained 26×19.2 mark, ink-cropped viewBox 0 0 32 23.6,
  //              stroke 3.6 (AppHeader nudges it up 4.35px in its lockup).
  //   'login'  = 28px full-square mark, viewBox 0 0 32 32, stroke 4 (reference #2a
  //              line 1989); centred on (16,16) — no nudge.
  // The 'favicon' form (24px reversed on a #3F5C77 tile) is added by the slice that
  // needs it. Peaks are coloured via CSS (SVG presentation attrs can't resolve var()).
  let { form = 'header' }: { form?: 'header' | 'login' } = $props();
  const geom = {
    header: { w: 26, h: 19.2, viewBox: '0 0 32 23.6', stroke: 3.6 },
    login:  { w: 28, h: 28,   viewBox: '0 0 32 32',   stroke: 4 },
  } as const;
  const g = $derived(geom[form]);
</script>

<svg class="logo" width={g.w} height={g.h} viewBox={g.viewBox} fill="none" aria-hidden="true">
  <!-- back peak (gold), drawn first so the front peak paints over it -->
  <path class="peak-back" d="M10.15 21.8 18.25 10.2 28.05 21.8" stroke-width={g.stroke} stroke-linecap="round" stroke-linejoin="round" />
  <!-- front peak (steel blue) -->
  <path class="peak-front" d="M3.95 21.7 10.85 12 19.25 21.7" stroke-width={g.stroke} stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  .logo { display: block; }
  .peak-back { stroke: var(--gold); }
  .peak-front { stroke: var(--primary); }
</style>
