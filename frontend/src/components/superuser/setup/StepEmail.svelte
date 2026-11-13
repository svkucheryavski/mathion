<script lang="ts">
  // Set up D6: step 1, the Edit email dialog's fields and its test (Settings
  // D7-D9). The values load fresh each time the step opens. A save sends the
  // email settings, then "step 1 saved" (D4); if that second write fails, the
  // email stays saved and Save and continue retries only it (D3). A test's
  // answer re-reads the state, even after the step is left, so the tick and
  // the reason follow it. A developer mode shows only the outbox line.
  import StepCard from './StepCard.svelte';
  import EmailFields from '../fields/EmailFields.svelte';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import ErrorState from '../../ui/ErrorState.svelte';
  import { EmailForm } from '../../../lib/panelForms/emailForm.svelte';
  import { scrollIntoSight } from '../../../lib/panelForms/scrollIntoSight';
  import { getSettings, panelError, saveEmail, testEmail } from '../../../lib/superuser';
  import { setupSaved, type StepProps } from '../../../lib/setup';
  import { useStepGuards } from '../../../lib/stepGuards.svelte';

  // Step 1 has no Back (D3), so `back` goes unused.
  let { token, setup, onAuth, onDone, skip, moveError, onHold }: StepProps = $props();

  const uid = $props.id();
  let form = $state.raw<EmailForm | null>(null);
  let devMode = $state(false);
  let loadError = $state<string | null>(null);
  let testing = $state(false);
  /** The email save succeeded; "step 1 saved" is still to send (D3). */
  let due = $state(false);

  async function load(): Promise<void> {
    loadError = null;
    try {
      const s = await getSettings(token);
      devMode = s.email.dev_mode !== null;
      form = new EmailForm(s.email);
    } catch (e) {
      loadError = panelError(e, onAuth);
    }
  }
  void load();

  const step = $derived(setup.state?.steps[0] ?? null);
  const done = $derived(step?.done ?? false);
  const busy = $derived(setup.busy || setup.saving);
  const changed = $derived(form?.changed ?? false);
  const ready = $derived(form?.ready ?? false);
  const mode = $derived.by((): 'save' | 'continue' | 'none' => {
    if (!form) return 'none';
    if (devMode || (done && !changed && !due)) return 'continue';
    return 'save';
  });
  // D6: the reason speaks of the saved settings, so it hides while the form
  // differs, and while "step 1 saved" is still to send.
  const reason = $derived(!done && !changed && !due && !devMode ? step?.reason ?? null : null);
  // D3: after a half-save only "step 1 saved" is retried, unless the form
  // holds something a save would write: then the email is saved again first.
  // D6 (rev 19): with email off a save writes only the switch, so edits in
  // the greyed fields don't count here (the leave questions still ask).
  const onlySaved = $derived(mode === 'continue' || (due && !ready));
  const canSave = $derived(onlySaved || ready);

  // D3: unsaved changes ask before leaving; Discard puts the loaded values back.
  useStepGuards({
    setup: () => setup, onHold: (h) => onHold(h), moveError: () => moveError,
    dirty: () => form?.changed ?? false,
    discard: () => { if (form) form = new EmailForm(form.saved); },
    held: () => !!form?.error,
    clearErrors: () => { if (form) form.error = null; },
  });

  // D13: the "step 1 saved" error on show, if any. A test never clears it;
  // it goes by the error itself, not by the step's state, which a re-read can
  // change during a test (and which can't be read once the step is gone).
  let savedError: string | null = null;
  const holdsSavedError = (f: EmailForm): boolean => f.error !== null && f.error === savedError;

  async function sendSaved(): Promise<void> {
    if (form) form.error = null;
    try {
      const s = await setup.write(() => setupSaved(token, 1));
      due = false;
      onDone(s);
    } catch (e) {
      const message = panelError(e, onAuth);
      if (form) form.error = message;
      savedError = message;
      // D13: the email may have saved; a re-read updates the list's marks
      // (the reason waits for "step 1 saved"). The error holds the card, so
      // the read can't move it.
      if (message !== null) void setup.read();
    }
  }

  async function onSave(): Promise<void> {
    if (busy || !form || !canSave) return;
    if (onlySaved) { await sendSaved(); return; }
    savedError = null;
    const body = form.saveBody();
    if (typeof body === 'string') { form.saveFailed(body); return; }
    form.error = null;
    form.saves++;
    setup.saving = true;
    try {
      const s = await saveEmail(token, body);
      // What saved is the new starting point (Users/Courses D24); a test's
      // answer was about these values, so it stays.
      const result = form.result;
      form = new EmailForm(s.email);
      form.result = result;
      due = true;
    } catch (e) {
      // Only the newer of a save error and a test answer shows (Settings D9).
      form.saveFailed(panelError(e, onAuth));
      return;
    } finally {
      setup.saving = false;
    }
    await sendSaved();
  }

  // Settings D9: one test at a time, of the form as it is now. An answer about
  // older values, or older than an email save, is dropped. D6: any answer
  // re-reads the state. Send test does nothing while a save runs: it would
  // only test what is being saved. A test's answer replaces an email save's
  // error, never a "step 1 saved" one: that one holds the card (D13), and
  // shows only while just that is retried.
  async function onTest(): Promise<void> {
    const f = form;
    if (testing || busy || !f) return;
    const body = f.testBody();
    if (typeof body === 'string') { f.answered({ ok: false, message: body }, !holdsSavedError(f)); return; }
    f.result = null;
    if (!holdsSavedError(f)) f.error = null;
    testing = true;
    const asked = f.edits;
    const saves = f.saves;
    const current = () => f === form && asked === f.edits && saves === f.saves;
    try {
      const answer = await testEmail(token, body);
      if (current()) f.answered(answer, !holdsSavedError(f));
    } catch (e) {
      const message = panelError(e, onAuth);
      if (current() && message !== null) f.answered({ ok: false, message }, !holdsSavedError(f));
    } finally {
      testing = false;
      void setup.read();
    }
  }
</script>

<StepCard n={1} title="Email" note="Sign-in links, PINs and notifications go out by email."
  error={form?.error ?? moveError} {busy} {mode} {canSave}
  onSkip={done ? undefined : skip} onBack={undefined} onSave={() => void onSave()}>
  {#if loadError !== null}
    <ErrorState title="Could not load settings." message={loadError} onretry={() => void load()} retryLabel="Try again" />
  {:else if !form}
    <Skeleton rows={3} label="Loading…" />
  {:else if devMode}
    <p class="se-dev">Email goes to a developer outbox (set on the server).</p>
  {:else}
    {#if reason}<p class="se-reason">{reason}</p>{/if}
    <!-- D3a: every edit notes the time for the keep-alive; the switch is a
         button, so its click counts too. -->
    <div class="se-fields" oninput={() => setup.noteEdit()} onchange={() => setup.noteEdit()}
      onclick={() => setup.noteEdit()} role="presentation">
      <EmailFields {form} {uid} {busy} />
    </div>
    {#if form.on}
      <div class="se-test">
        <Button variant="secondary" loading={testing} aria-disabled={testing || busy} onclick={() => void onTest()}>Send test email</Button>
      </div>
    {/if}
    {#if form.result}
      <p class="se-result" class:ok={form.result.ok} class:err={!form.result.ok} role="status" {@attach scrollIntoSight(form.result)}>{form.result.message}</p>
    {/if}
  {/if}
</StepCard>

<style>
  .se-fields { display: flex; flex-direction: column; gap: 6px; }
  .se-reason { margin: 0; font-size: 12.5px; color: var(--gold-text); }
  .se-dev { margin: 0; font-size: 13px; color: var(--muted); }
  .se-test { margin: 8px 0 0; }
  /* Settings D9: the test's answer (the Edit email dialog's result box). */
  .se-result { margin: 6px 0 0; padding: 7px 10px; border-radius: var(--radius); font-size: 12.5px; }
  .se-result.ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .se-result.err { background: var(--danger-panel-bg); color: var(--danger-panel-fg); }
</style>
