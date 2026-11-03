<script lang="ts">
  // D24 (rev 6): one Edit dialog for an account — name and email (D19). Save
  // sends only what changed, in one request; an empty name clears it. A
  // changed email signs the person out, and the dialog says so. A superuser's
  // email can't change here (D21). `onSave` closes on success and THROWS on
  // failure; the server's sentence shows here with the input kept (D25).
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import { panelError, type PanelOnAuth, type PanelUser } from '../../lib/superuser';

  type Body = { full_name?: string | null; email?: string };
  type Props = { user: PanelUser; onSave: (body: Body) => Promise<void>; onClose: () => void; onAuth: PanelOnAuth };
  let { user, onSave, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  let name = $state(untrack(() => user.full_name ?? ''));
  let email = $state(untrack(() => user.email));
  let error = $state<string | null>(null);
  let busy = $state(false);

  const nameChanged = $derived(name.trim() !== (user.full_name ?? ''));
  // The server stores emails in lower case, so a case-only edit is no change.
  const emailChanged = $derived(email.trim().toLowerCase() !== user.email);
  const ready = $derived((nameChanged || emailChanged) && email.trim() !== '');

  async function save() {
    if (busy || !ready) return;
    error = null;
    busy = true;
    const body: Body = {};
    if (nameChanged) body.full_name = name.trim() || null;
    if (emailChanged) body.email = email.trim();
    try {
      await onSave(body);
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="ea-title">Edit account</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; save() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void save()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={440} maxHeight={460} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <!-- novalidate: the server's sentence is the check (type="email" would block Enter). -->
  <form class="ea-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label class="ea-label" for="{uid}-name">Name</label>
    <input id="{uid}-name" class="ea-input" data-autofocus bind:value={name} readonly={busy} autocomplete="off"
      oninput={() => { error = null; }} />
    <label class="ea-label" for="{uid}-email">Email</label>
    <input id="{uid}-email" class={["ea-input", user.is_superuser && "ea-locked"]} type="email" bind:value={email} readonly={busy || user.is_superuser}
      autocomplete="off" spellcheck="false" oninput={() => { error = null; }} />
    {#if user.is_superuser}
      <p class="ea-note">A superuser's email can't be changed here.</p>
    {:else if emailChanged}
      <p class="ea-note">They will need to sign in again with the new address.</p>
    {/if}
    {#if error}<p id={errId} class="ea-err" role="alert">{error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .ea-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .ea-form { display: flex; flex-direction: column; gap: 6px; }
  .ea-label { font-size: 12.5px; color: var(--muted); }
  .ea-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (NewItemModal .plain-input). */
  .ea-input {
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
  .ea-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .ea-locked { background: var(--surface-2); color: var(--text-2); }
  .ea-note { margin: 0; font-size: 12.5px; color: var(--text-2); }
  .ea-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
