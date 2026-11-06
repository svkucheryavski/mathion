<script lang="ts">
  // Branding D2, D3: the Edit site name dialog. Save is blocked until the name
  // changes; `save` THROWS on failure and the server's sentence shows here.
  // Reset to default waits for Save, like any change (D2); typing after it
  // saves the typed name.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import { panelError, type PanelOnAuth } from '../../lib/superuser';
  import { PRODUCT_NAME } from '../../lib/branding.svelte';

  type Props = {
    name: string;
    save: (body: { name: string } | { reset: true }) => Promise<void>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { name, save, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  const saved = untrack(() => name);
  let value = $state(saved);
  let reset = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let saveButton = $state<HTMLButtonElement | undefined>();

  const ready = $derived(reset || value !== saved);

  function onReset() {
    value = PRODUCT_NAME;
    reset = true;
    error = null;
    saveButton?.focus();
  }

  async function onSave() {
    if (busy || !ready) return;
    error = null;
    busy = true;
    try {
      await save(reset ? { reset: true } : { name: value });
      onDone();
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="sn-title">Edit site name</h2>
{/snippet}

{#snippet foot()}
  {#if saved !== PRODUCT_NAME}
    <Button variant="ghost" disabled={busy} onclick={onReset}>Reset to default</Button>
  {/if}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} bind:element={saveButton}
    onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={560} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="sn-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void onSave(); }}>
    <label class="sn-label" for="{uid}-name">Site name</label>
    <input id="{uid}-name" class="sn-input" data-autofocus bind:value readonly={busy}
      autocomplete="off" oninput={() => { reset = false; error = null; }} />
    <p class="sn-hint">Used for the tab title, emails and the logo's alt text.</p>
    {#if error}<p id={errId} class="sn-err" role="alert">{error}</p>{/if}
    <!-- Enter in the field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .sn-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .sn-form { display: flex; flex-direction: column; gap: 6px; }
  .sn-label { font-size: 12.5px; color: var(--muted); }
  /* The item modal's field (EditCourseDialog .ec-input). */
  .sn-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .sn-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .sn-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .sn-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
