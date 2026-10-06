<script lang="ts">
  // Version info card (3b, ref 1531-1553): three per-field InlineFields, each
  // committing its own single-field PATCH (visual-spec §5.5, Slice-5a D2). Always
  // rendered — read-only states show the values as text with a disabled pencil
  // carrying the reason (D4). Foldable; the folded body stays mounted (D3), so
  // an open draft survives a fold.
  import { onDestroy } from 'svelte';
  import { api } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { metaReason } from '../../lib/editorReasons';
  import InlineField from '../ui/InlineField.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import type { AdminTreeVersion } from '../../lib/types';

  let { vid, version }: { vid: number; version: AdminTreeVersion } = $props();

  const uid = $props.id();
  const bodyId = `${uid}-body`;
  let folded = $state(false);
  const reason = $derived(metaReason(version));

  let alive = true;
  onDestroy(() => { alive = false; });

  // One field per PATCH. A PATCH failure propagates to InlineField (inline
  // error); only the follow-up refresh is guarded — skipped if the page moved
  // to another version meanwhile (the page instance is preserved across vids).
  async function patch(field: { label: string } | { info_md: string } | { max_quiz_attempts: number }) {
    const savedVid = vid;
    await api.patch(`/api/versions/${savedVid}`, field);
    if (!alive || vid !== savedVid) return;
    const result = await loadAdminTree(savedVid, { force: true });
    if (result === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
  }

  function validateAttempts(n: string | number): string | null {
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10
      ? null
      : 'Max quiz attempts must be a whole number between 1 and 10';
  }
</script>

<section class="meta-card">
  <div class="card-head">
    <h2>Version info</h2>
    <IconButton
      size="sm"
      borderless
      glyph={folded ? 'chevron-right' : 'chevron'}
      title={folded ? 'Expand' : 'Collapse'}
      aria-label={folded ? 'Expand version info' : 'Collapse version info'}
      aria-expanded={!folded}
      aria-controls={bodyId}
      onclick={() => (folded = !folded)}
    />
  </div>
  <!-- No display rule on the element carrying `hidden` (an author display would
       beat the UA [hidden] rule); layout lives on the inner .fields wrapper. -->
  <div id={bodyId} hidden={folded}>
    <div class="fields">
      <InlineField
        label="Label"
        value={version.label}
        maxlength={200}
        editTitle="Edit the label"
        disabledReason={reason}
        onCommit={(p) => patch({ label: String(p) })}
      />
      <InlineField
        label="Info (markdown)"
        value={version.info_md}
        kind="textarea"
        editTitle="Edit the info"
        disabledReason={reason}
        onCommit={(p) => patch({ info_md: String(p) })}
      />
      <InlineField
        label="Max quiz attempts"
        value={version.max_quiz_attempts}
        kind="number"
        min={1}
        max={10}
        step={1}
        editTitle="Edit the attempt limit"
        disabledReason={reason}
        validate={validateAttempts}
        onCommit={(p) => patch({ max_quiz_attempts: Number(p) })}
      />
    </div>
  </div>
</section>

<style>
  .meta-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 16px 18px; /* ref 1531 */
    margin-bottom: 18px; /* ref 1531 */
  }
  .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; /* ref 1532 */ }
  h2 { font-size: 14px; /* ref 1533 — base.css h2 is 15px */ }
  .fields { display: flex; flex-direction: column; /* ref 1536 */ }
  .fields > :global(.inline-field:last-child) { border-bottom: 0; /* ref 1548 */ }
</style>
