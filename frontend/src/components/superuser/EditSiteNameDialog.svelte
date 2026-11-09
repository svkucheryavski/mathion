<script lang="ts">
  // Branding D2, D3: the Edit site name dialog. Save is blocked until the name
  // changes; `save` THROWS on failure and the server's sentence shows here.
  // Reset to default waits for Save, like any change (D2); typing after it
  // saves the typed name. The form and its field are shared with Set up's
  // Site name and logo step.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import SiteNameField from './fields/SiteNameField.svelte';
  import { SiteNameForm } from '../../lib/panelForms/siteNameForm.svelte';
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

  const form = new SiteNameForm(untrack(() => name));
  let busy = $state(false);
  let saveButton = $state<HTMLButtonElement | undefined>();

  function onReset() {
    form.resetToDefault();
    saveButton?.focus();
  }

  async function onSave() {
    if (busy || !form.changed) return;
    form.error = null;
    busy = true;
    try {
      await save(form.body());
      onDone();
    } catch (e) {
      form.error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="sn-title">Edit site name</h2>
{/snippet}

{#snippet foot()}
  {#if form.saved !== PRODUCT_NAME}
    <Button variant="ghost" disabled={busy} onclick={onReset}>Reset to default</Button>
  {/if}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!form.changed && !busy} bind:element={saveButton}
    onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={560} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="sn-form" novalidate aria-describedby={form.error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void onSave(); }}>
    <SiteNameField {form} {uid} {busy} />
    {#if form.error}<p id={errId} class="sn-err" role="alert">{form.error}</p>{/if}
    <!-- Enter in the field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .sn-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .sn-form { display: flex; flex-direction: column; gap: 6px; }
  .sn-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
