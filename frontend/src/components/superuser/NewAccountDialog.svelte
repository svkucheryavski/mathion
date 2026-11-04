<script lang="ts">
  // D17: New account — an email and an optional name. Creating it sends no
  // email and ties the account to nothing. `onSave` owns the request, closes
  // on success and THROWS on failure; the server's sentence shows here with
  // the fields kept (D25).
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import { panelError, type PanelOnAuth } from '../../lib/superuser';

  type Body = { email: string; full_name: string | null };
  type Props = { onSave: (body: Body) => Promise<void>; onClose: () => void; onAuth: PanelOnAuth };
  let { onSave, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  let email = $state('');
  let name = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  const ready = $derived(email.trim() !== '');

  async function save() {
    if (busy || !ready) return;
    error = null;
    busy = true;
    try {
      await onSave({ email: email.trim(), full_name: name.trim() || null });
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="na-title">New account</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void save()}>Create</Button>
{/snippet}

<Modal labelledby={titleId} width={440} maxHeight={440} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <!-- novalidate: the server's sentence is the check (type="email" would block Enter). -->
  <form class="na-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label class="na-label" for="{uid}-email">Email</label>
    <input id="{uid}-email" class="na-input" type="email" data-autofocus bind:value={email} readonly={busy}
      autocomplete="off" spellcheck="false" oninput={() => { error = null; }} />
    <label class="na-label" for="{uid}-name">Name (optional)</label>
    <input id="{uid}-name" class="na-input" bind:value={name} readonly={busy} autocomplete="off"
      oninput={() => { error = null; }} />
    {#if error}<p id={errId} class="na-err" role="alert">{error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .na-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .na-form { display: flex; flex-direction: column; gap: 6px; }
  .na-label { font-size: 12.5px; color: var(--muted); }
  .na-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (NewItemModal .plain-input). */
  .na-input {
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
  .na-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .na-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
