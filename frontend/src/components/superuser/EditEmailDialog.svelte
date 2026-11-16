<script lang="ts">
  // Settings D7-D9: the Edit email dialog. Save sends the switch alone when it
  // is off (D7c), otherwise every field, with the password only when typed
  // (D8: an empty field keeps the saved one). `save` THROWS on failure and the
  // server's sentence shows here (D5). Send test email tests the form as it is
  // now; its answer, a 409 included, shows above the buttons (D9), scrolled
  // into view. Only the newer of a save error and a test answer shows. The
  // form and its fields are shared with Set up's Email step.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import EmailFields from './fields/EmailFields.svelte';
  import { EmailForm } from '../../lib/panelForms/emailForm.svelte';
  import { scrollIntoSight } from '../../lib/panelForms/scrollIntoSight';
  import {
    panelError, type EmailSaveBody, type EmailTestBody, type EmailTestResult,
    type PanelEmailSettings, type PanelOnAuth,
  } from '../../lib/superuser';

  type Props = {
    email: PanelEmailSettings;
    save: (body: EmailSaveBody) => Promise<void>;
    test: (body: EmailTestBody) => Promise<EmailTestResult>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { email, save, test, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  // The saved values; a save that succeeds closes the dialog.
  const form = new EmailForm(untrack(() => email));
  let busy = $state(false);
  let testing = $state(false);

  async function onSave() {
    if (busy || !form.ready) return;
    form.error = null;
    const body = form.saveBody();
    if (typeof body === 'string') { form.saveFailed(body); return; }
    form.saves++;
    busy = true;
    try {
      await save(body);
      onDone();
    } catch (e) {
      form.saveFailed(panelError(e, onAuth));
    } finally {
      busy = false;
    }
  }

  // D9: one test at a time; Save and Cancel stay usable while it runs. Send
  // test does nothing while a save runs: it would only test what is being
  // saved. An answer about older values, or older than a save, is dropped.
  async function onTest() {
    if (testing || busy) return;
    const body = form.testBody();
    if (typeof body === 'string') { form.answered({ ok: false, message: body }); return; }
    form.result = null;
    form.error = null;
    testing = true;
    const asked = form.edits;
    const saves = form.saves;
    const current = () => asked === form.edits && saves === form.saves;
    try {
      const answer = await test(body);
      if (current()) form.answered(answer);
    } catch (e) {
      const message = panelError(e, onAuth);
      if (current() && message !== null) form.answered({ ok: false, message });
    } finally {
      testing = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="ee-title">Edit email</h2>
{/snippet}

{#snippet foot()}
  {#if form.on}
    <Button variant="secondary" loading={testing} aria-disabled={testing || busy} onclick={() => void onTest()}>Send test email</Button>
  {/if}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!form.ready && !busy} onclick={() => void onSave()}>Save</Button>
{/snippet}

<!-- Email off: the fields are disabled, so focus starts on the switch. -->
<Modal labelledby={titleId} width={480} maxHeight={640} autofocusSelector={`[data-autofocus]:not(:disabled), #${uid}-on`} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="ee-form" novalidate aria-describedby={form.error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void onSave(); }}>
    <EmailFields {form} {uid} {busy} />
    {#if form.error}<p id={errId} class="ee-err" role="alert" {@attach scrollIntoSight(form.error)}>{form.error}</p>{/if}
    <div class="live-slot" role="status">{#if form.result}<p class="ee-result" class:ok={form.result.ok} class:err={!form.result.ok} {@attach scrollIntoSight(form.result)}>{form.result.message}</p>{/if}</div>
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .ee-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .ee-form { display: flex; flex-direction: column; gap: 6px; }
  .ee-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
  /* D9: the test's answer, above the buttons (the mockup's result box). */
  .ee-result { margin: 6px 0 0; padding: 7px 10px; border-radius: var(--radius); font-size: 12.5px; }
  .ee-result.ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ee-result.err { background: var(--danger-panel-bg); color: var(--danger-panel-fg); }
</style>
