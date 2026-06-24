<script lang="ts">
  import type { AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';

  let {
    itemId, vid, itemTitle, version, perms, assetContext, quizDirty = $bindable(false),
  }: {
    itemId: number; vid: number; itemTitle: string;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    quizDirty?: boolean;
  } = $props();

  // T3 fills in load + question list + dirty registry. Shell keeps quizDirty false.
  // `noUnusedLocals`/`noUnusedParameters` are on (tsconfig.json:13-14) — void the
  // props this shell does not yet read so svelte-check passes.
  void itemId; void vid; void version; void perms; void assetContext; void quizDirty;
</script>

<section class="quiz-editor" aria-label="Quiz editor">
  <h2 class="quiz-title">{itemTitle}</h2>
  <p class="empty"><em>Quiz authoring loads here.</em></p>
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: var(--space-3); }
  .quiz-title { margin: 0; }
  .empty { color: var(--text-muted, #666); }
</style>
