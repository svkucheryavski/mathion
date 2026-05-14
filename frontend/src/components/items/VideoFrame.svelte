<script lang="ts">
  // Shared 16:9 iframe wrapper. Used by the student-side VideoItem and the
  // editor's video preview (live in edit mode, static in readonly mode).
  // Keeping the aspect-ratio CSS in one place ensures both surfaces stay in
  // visual sync; callers pass a sanitized `src` (see lib/safeIframeUrl).
  let { src, title }: { src: string; title: string } = $props();
</script>

<div class="frame">
  <iframe {src} {title} allowfullscreen></iframe>
</div>

<style>
  .frame { position: relative; padding-bottom: 56.25%; height: 0; margin-bottom: var(--space-3); }
  .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
