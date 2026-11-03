<script lang="ts">
  // D24: the panel's one-field edit dialog (rename course, change address,
  // change admin, edit name, change email). `onSave` owns the request and
  // closes the dialog on success; it THROWS on failure, and the server's
  // sentence shows here with the input kept (D25). The guard's 401/404 go to
  // `onAuth` instead. Closing never asks: an edit is one short field.
  import { untrack, type Snippet } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import { panelError, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    title: string;
    label: string;
    value: string;
    type?: 'text' | 'email';
    hint?: Snippet;
    warning?: string;
    saveLabel?: string;
    onSave: (value: string) => Promise<void>;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { title, label, value, type = 'text', hint, warning, saveLabel = 'Save', onSave, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const inputId = `${uid}-input`;
  const errId = `${uid}-err`;

  let text = $state(untrack(() => value));
  let error = $state<string | null>(null);
  let busy = $state(false);

  const ready = $derived(text.trim() !== '' && text.trim() !== value.trim());

  async function save() {
    if (busy || !ready) return;
    error = null;
    busy = true;
    try {
      await onSave(text.trim());
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="fd-title">{title}</h2>
{/snippet}

{#snippet foot()}
  <!-- Pushes the buttons right, as the item modal's footer. -->
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; save() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void save()}>{saveLabel}</Button>
{/snippet}

<Modal labelledby={titleId} width={440} maxHeight={400} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <!-- novalidate: the server's sentence is the check (type="email" would block Enter). -->
  <form class="fd-form" novalidate onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label class="fd-label" for={inputId}>{label}</label>
    <input id={inputId} class="fd-input" {type} data-autofocus bind:value={text} readonly={busy}
      autocomplete="off" spellcheck="false"
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? errId : undefined}
      oninput={() => { error = null; }} />
    {#if hint}<div class="fd-hint">{@render hint()}</div>{/if}
    {#if warning}<p class="fd-warning">{warning}</p>{/if}
    {#if error}<p id={errId} class="fd-err" role="alert">{error}</p>{/if}
  </form>
</Modal>

<style>
  .fd-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .fd-form { display: flex; flex-direction: column; gap: 6px; }
  .fd-label { font-size: 12.5px; color: var(--muted); }
  /* The item modal's field (NewItemModal .plain-input). */
  .fd-input {
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
  .fd-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .fd-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .fd-hint { font-size: 12px; color: var(--muted); }
  .fd-warning { margin: 4px 0 0; font-size: 12.5px; color: var(--text-2); }
  .fd-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
