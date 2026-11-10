<script lang="ts">
  // Settings D12: the Edit sign-in dialog, three whole numbers and the longest
  // sign-in as three segments. `save` THROWS on failure and the server's
  // sentence (the ranges) shows here (D5). The form and its fields are shared
  // with Set up's Sign-in rules and limits step.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import SignInFields from './fields/SignInFields.svelte';
  import { SignInForm } from '../../lib/panelForms/signInForm.svelte';
  import { panelError, type PanelSignIn, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    signIn: PanelSignIn;
    save: (body: PanelSignIn) => Promise<void>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { signIn, save, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  const form = new SignInForm(untrack(() => signIn));
  let busy = $state(false);

  async function onSave() {
    if (busy || !form.changed) return;
    const body = form.body();
    if (typeof body === 'string') { form.error = body; return; }
    form.error = null;
    busy = true;
    try {
      await save(body);
      onDone();
    } catch (e) {
      form.error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="es-title">Edit sign-in</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!form.changed && !busy} onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={560} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="es-form" novalidate aria-describedby={form.error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void onSave(); }}>
    <SignInFields {form} {uid} {busy} />
    {#if form.error}<p id={errId} class="es-err" role="alert">{form.error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .es-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .es-form { display: flex; flex-direction: column; gap: 6px; }
  .es-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
