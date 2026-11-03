<script lang="ts">
  // D8: New course — name, address (from the name, D13) and the admin's email
  // (required). `onSave` owns the request, closes on success and THROWS on
  // failure; the server's sentence shows here with every field kept (D25).
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import AdminEmailField from './AdminEmailField.svelte';
  import { slugFromName } from '../../lib/slugify';
  import { panelError, type PanelOnAuth } from '../../lib/superuser';

  type Body = { name: string; slug: string; admin_email: string };
  type Props = { token: string; onSave: (body: Body) => Promise<void>; onClose: () => void; onAuth: PanelOnAuth };
  let { token, onSave, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  let name = $state('');
  let slug = $state('');
  // D13: the address follows the name until the superuser edits it.
  let slugEdited = $state(false);
  let email = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  const ready = $derived(name.trim() !== '' && slug.trim() !== '' && email.trim() !== '');

  function onName() {
    error = null;
    if (!slugEdited) slug = slugFromName(name);
  }

  async function save() {
    if (busy || !ready) return;
    error = null;
    busy = true;
    try {
      await onSave({ name: name.trim(), slug: slug.trim(), admin_email: email.trim() });
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="nc-title">New course</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void save()}>Create</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={520} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="nc-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label class="nc-label" for="{uid}-name">Course name</label>
    <input id="{uid}-name" class="nc-input" data-autofocus bind:value={name} readonly={busy} autocomplete="off" oninput={onName} />
    <label class="nc-label" for="{uid}-slug">Address</label>
    <input id="{uid}-slug" class="nc-input nc-mono" bind:value={slug} readonly={busy} autocomplete="off" spellcheck="false"
      oninput={() => { slugEdited = true; error = null; }} />
    <label class="nc-label" for="{uid}-email">Admin's email</label>
    <AdminEmailField id="{uid}-email" {token} value={email} {onAuth} readonly={busy}
      oninput={(v) => { email = v; error = null; }} />
    {#if error}<p id={errId} class="nc-err" role="alert">{error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .nc-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .nc-form { display: flex; flex-direction: column; gap: 6px; }
  .nc-label { font-size: 12.5px; color: var(--muted); }
  .nc-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (NewItemModal .plain-input). */
  .nc-input {
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
  .nc-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .nc-mono { font-family: var(--font-mono); }
  .nc-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
