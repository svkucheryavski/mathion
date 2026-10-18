<script lang="ts">
  // Shared 16:9 iframe wrapper. Used by the student-side VideoItem and the
  // editor's video preview card. Keeping the aspect-ratio CSS in one place
  // ensures both surfaces stay in visual sync; callers pass a sanitized `src`
  // (see lib/safeIframeUrl). Slice-5b D13: an optional `height` (the editor's
  // 296px player) replaces the 16:9 box, and the frame then zeroes its own
  // bottom margin, so the editor card needs no :global (R3).
  let { src, title, height }: { src: string; title: string; height?: number } = $props();
</script>

<div class="frame" class:fixed={height !== undefined} style:--frame-h={height !== undefined ? `${height}px` : undefined}>
  <iframe {src} {title} allowfullscreen></iframe>
</div>

<style>
  .frame { position: relative; padding-bottom: 56.25%; height: 0; margin-bottom: var(--space-3); }
  .frame.fixed { padding-bottom: 0; height: var(--frame-h); margin-bottom: 0; /* (c): the caller sizes it */ }
  .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .frame iframe:focus-visible { outline-offset: -2px; /* the player card clips the frame */ }
</style>
