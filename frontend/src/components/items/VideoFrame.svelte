<script lang="ts">
  // Shared iframe wrapper for the student VideoItem (16:9 box) and the editor preview.
  // Callers pass a sanitized `src` (lib/safeIframeUrl); `fill` takes the parent's 16:9 box.
  let { src, title, fill = false }: { src: string; title: string; fill?: boolean } = $props();
</script>

<div class="frame" class:fill>
  <!-- Origin only: YouTube refuses to play without it; the page path stays private. -->
  <iframe {src} {title} allowfullscreen referrerpolicy="strict-origin"></iframe>
</div>

<style>
  .frame { position: relative; padding-bottom: 56.25%; height: 0; margin-bottom: var(--space-3); }
  .frame.fill { padding-bottom: 0; height: 100%; margin-bottom: 0; }
  .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
