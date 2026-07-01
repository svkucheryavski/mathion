<script lang="ts">
  // Shared fixed-height (600px) sandboxed iframe for interactive apps. The app
  // JS SOURCE (not a URL) is inlined into the iframe srcdoc as a classic
  // <script> (see lib/interactiveHost + the upload-model spec §6). Used by the
  // student player and the editor preview.
  //
  // sandbox="allow-scripts" WITHOUT allow-same-origin keeps the app in an
  // opaque origin (no parent DOM / cookie / storage / session access). NEVER
  // add allow-same-origin (de-isolation), allow-top-navigation*,
  // allow-popups-to-escape-sandbox, allow-downloads, allow-modals, or
  // allow-storage-access-by-user-activation. No allowfullscreen (out of scope).
  // scriptSource is ONLY ever inlined into this sandboxed srcdoc — never
  // {@html}'d / innerHTML'd into a Mathion page.
  //
  // Network egress: the CSP (connect-src 'none' + default-src 'none') blocks all
  // fetch/XHR/WebSocket/beacon/subresource loads. The ONE residual is SELF-
  // navigation (`location = 'https://…'`): no sandbox token or well-supported CSP
  // directive blocks a frame navigating its OWN context (allow-top-navigation*
  // stays off, so it can't touch the top window). Accepted: the frame is
  // opaque-origin and stays sandboxed across the navigation, so there is no
  // Mathion-origin/session/cookie/parent-DOM exfil. Self-navigation CAN transmit
  // data the app itself sees IN-FRAME (its own source, plus any student input or
  // interaction telemetry it collects) — accepted because the upload is
  // admin-authored (the app legitimately observes its own in-frame interaction).
  import { buildAppSrcdoc } from '../../lib/interactiveHost';
  let { scriptSource, title }: { scriptSource: string; title: string } = $props();
  const srcdoc = $derived(buildAppSrcdoc(scriptSource));
</script>

<div class="frame">
  <iframe {srcdoc} {title} sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
</div>

<style>
  .frame { width: 100%; height: 600px; margin-bottom: var(--space-3); }
  .frame iframe { width: 100%; height: 100%; border: 0; }
</style>
