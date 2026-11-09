<script lang="ts">
  // Branding D2, D4-D6: the Edit logo and Edit tab icon dialogs. The choice and
  // its checks live in LogoPick and the previews in LogoPicker, shared with
  // Set up's Site name and logo step. Save sends the chosen bytes, or the
  // reset; a 413 from the proxy gets the upload limit's sentence.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import LogoPicker from './fields/LogoPicker.svelte';
  import { IMAGE_TEXT, LogoPick, type SavedImage } from '../../lib/panelForms/logoPick.svelte';
  import { ApiError } from '../../lib/api';
  import { tooLargeSentence } from '../../lib/uploadLimit.svelte';
  import { panelError, type BrandingPart, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    kind: 'logo' | 'icon';
    /** The saved upload's size and version, or null for the default. */
    saved: SavedImage;
    save: (part: BrandingPart, filename?: string) => Promise<void>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { kind, saved, save, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  const form = new LogoPick(untrack(() => kind), untrack(() => saved));
  let busy = $state(false);
  let saveButton = $state<HTMLButtonElement | undefined>();

  function onReset() {
    form.reset();
    saveButton?.focus();
  }

  async function onSave() {
    const pending = form.pending;
    if (busy || !form.ready || !pending) return;
    form.error = null;
    busy = true;
    try {
      if (pending.kind === 'reset') await save('reset');
      else await save(pending.file.bytes, pending.file.name);
      onDone();
    } catch (e) {
      form.error = e instanceof ApiError && e.status === 413 ? tooLargeSentence(e) : panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="im-title">{IMAGE_TEXT[form.kind].title}</h2>
{/snippet}

{#snippet foot()}
  {#if form.saved}
    <Button variant="ghost" disabled={busy} onclick={onReset}>Reset to default</Button>
  {/if}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!form.ready && !busy} bind:element={saveButton}
    onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={600} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <div class="im-body" aria-describedby={form.error ? errId : undefined}>
    <LogoPicker {form} {busy} />
    {#if form.error}<p id={errId} class="im-err" role="alert">{form.error}</p>{/if}
  </div>
</Modal>

<style>
  .im-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .im-body { display: flex; flex-direction: column; gap: 6px; }
  .im-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
