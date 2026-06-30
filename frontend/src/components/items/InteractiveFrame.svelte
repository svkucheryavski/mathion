<script lang="ts">
  // Shared fixed-height (600px) sandboxed iframe wrapper for interactive apps.
  // Used by the student-side InteractiveAppItem and the editor's live/readonly
  // preview. Callers pass an already-sanitized `src` (see lib/safeAppUrl).
  //
  // sandbox="allow-scripts" WITHOUT allow-same-origin keeps the app in an
  // opaque origin (no parent DOM/cookie/storage access). NEVER add
  // allow-same-origin (de-isolation), allow-top-navigation* (tab-hijack),
  // allow-popups-to-escape-sandbox, allow-downloads, allow-modals, or
  // allow-storage-access-by-user-activation. No allowfullscreen (out of scope).
  let { src, title }: { src: string; title: string } = $props();
</script>

<div class="frame">
  <iframe {src} {title} sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
</div>

<style>
  .frame { width: 100%; height: 600px; margin-bottom: var(--space-3); }
  .frame iframe { width: 100%; height: 100%; border: 0; }
</style>
