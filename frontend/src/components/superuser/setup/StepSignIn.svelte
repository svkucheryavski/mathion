<script lang="ts">
  // Set up D9: step 4, the Edit sign-in dialog's four values and the Edit file
  // limits dialog's two, in one card (Settings D11, D12). The values load
  // fresh each time the step opens. Save and continue works with nothing
  // changed: it then sends only keep-sign-in, which marks the step kept.
  // Otherwise it saves sign-in, then limits, each only when it changed. Then
  // "step 4 saved" (D4). A failure after a save keeps what saved as the new
  // starting point and retries only the rest (D3, Users/Courses D24).
  // `setup.saving` stays set across the whole sequence: keep-sign-in is a
  // wizard write whose answer may say over (D5a), and the card must wait for
  // "step 4 saved" (D3a).
  import StepCard from './StepCard.svelte';
  import SignInFields from '../fields/SignInFields.svelte';
  import LimitsFields from '../fields/LimitsFields.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import ErrorState from '../../ui/ErrorState.svelte';
  import { SignInForm } from '../../../lib/panelForms/signInForm.svelte';
  import { LimitsForm } from '../../../lib/panelForms/limitsForm.svelte';
  import { getSettings, panelError, saveLimits, saveSignIn, type PanelLimits, type PanelSignIn } from '../../../lib/superuser';
  import { keepSignIn, setupSaved, type StepProps } from '../../../lib/setup';
  import { useStepGuards } from '../../../lib/stepGuards.svelte';

  let { token, setup, onAuth, onDone, back, skip, moveError, onHold }: StepProps = $props();

  const uid = $props.id();
  let signIn = $state.raw<SignInForm | null>(null);
  let limits = $state.raw<LimitsForm | null>(null);
  let loadError = $state<string | null>(null);
  /** A save succeeded; "step 4 saved" is still to send (D3). */
  let due = $state(false);

  async function load(): Promise<void> {
    loadError = null;
    try {
      const s = await getSettings(token);
      signIn = new SignInForm(s.sign_in);
      limits = new LimitsForm(s.limits);
    } catch (e) {
      loadError = panelError(e, onAuth);
    }
  }
  void load();

  const done = $derived(setup.state?.steps[3]?.done ?? false);
  const busy = $derived(setup.busy || setup.saving);
  const changed = $derived((signIn?.changed ?? false) || (limits?.changed ?? false));
  const mode = $derived.by((): 'save' | 'continue' | 'none' => {
    if (!signIn || !limits) return 'none';
    return done && !changed && !due ? 'continue' : 'save';
  });

  // D3: unsaved changes ask before leaving; Discard puts the loaded values back.
  useStepGuards({
    setup: () => setup, onHold: (h) => onHold(h), moveError: () => moveError,
    dirty: () => changed,
    discard: () => {
      if (signIn) signIn = new SignInForm(signIn.saved);
      if (limits) limits = new LimitsForm(limits.saved);
    },
    held: () => !!signIn?.error || !!limits?.error,
    clearErrors: () => { if (signIn) signIn.error = null; if (limits) limits.error = null; },
  });

  /** "Step 4 saved". A failure shows on the sign-in form. */
  async function sendSaved(): Promise<void> {
    try {
      const s = await setup.write(() => setupSaved(token, 4));
      due = false;
      onDone(s);
    } catch (e) {
      const message = panelError(e, onAuth);
      if (signIn) signIn.error = message;
      // D13: a save may have marked the step kept; a re-read updates the marks.
      if (message !== null) void setup.read();
    }
  }

  /** The step's own saves, in order; `failed` names the form a throw belongs to. */
  let failed: SignInForm | LimitsForm | null = null;
  async function saveChanged(signInBody: PanelSignIn | null, limitsBody: PanelLimits | null): Promise<void> {
    failed = signIn;
    if (!signInBody && !limitsBody) {
      // D9: nothing changed; keep-sign-in marks the step kept.
      await setup.write(() => keepSignIn(token));
      due = true;
      return;
    }
    if (signInBody) {
      const s = await saveSignIn(token, signInBody);
      signIn = new SignInForm(s.sign_in);
      due = true;
    }
    failed = limits;
    if (limitsBody) {
      const s = await saveLimits(token, limitsBody);
      limits = new LimitsForm(s.limits);
      due = true;
    }
  }

  async function onSave(): Promise<void> {
    if (busy || !signIn || !limits) return;
    signIn.error = null;
    limits.error = null;
    // D3: after a half-save only "step 4 saved" is retried, unless the form
    // changed since: then what changed is saved first.
    const only = mode === 'continue' || (due && !changed);
    // Settings D11, D12: the browser's whole-number checks, before any write.
    const signInBody = !only && signIn.changed ? signIn.body() : null;
    if (typeof signInBody === 'string') { signIn.error = signInBody; return; }
    const limitsBody = !only && limits.changed ? limits.body() : null;
    if (typeof limitsBody === 'string') { limits.error = limitsBody; return; }
    setup.saving = true;
    try {
      if (!only) {
        try {
          await saveChanged(signInBody, limitsBody);
        } catch (e) {
          const message = panelError(e, onAuth);
          if (failed) failed.error = message;
          // D5a: the sequence ended; after a half-save a re-read updates the marks.
          if (due && message !== null) void setup.read();
          return;
        }
      }
      await sendSaved();
    } finally {
      setup.saving = false;
    }
  }
</script>

<StepCard n={4} title="Sign-in rules and limits"
  note="How long a PIN lasts, how often people can ask for one, and how big files may be."
  error={signIn?.error ?? limits?.error ?? moveError} {busy} {mode} canSave={true}
  onBack={back} onSkip={done ? undefined : skip} onSave={() => void onSave()}>
  {#if loadError !== null}
    <ErrorState title="Could not load settings." message={loadError} onretry={() => void load()} retryLabel="Try again" />
  {:else if !signIn || !limits}
    <Skeleton rows={4} label="Loading…" />
  {:else}
    <!-- D3a: every edit notes the time for the keep-alive; a Segmented
         option is a radio, so its change counts. Each fields component
         keeps its own parent (its labels' :not(:first-child) margins). -->
    <p class="si-sub">Sign-in</p>
    <div class="si-fields" oninput={() => setup.noteEdit()} onchange={() => setup.noteEdit()}
      onclick={() => setup.noteEdit()} role="presentation">
      <SignInFields form={signIn} {uid} {busy} />
    </div>
    <p class="si-sub">File limits</p>
    <div class="si-fields" oninput={() => setup.noteEdit()} onchange={() => setup.noteEdit()}
      onclick={() => setup.noteEdit()} role="presentation">
      <LimitsFields form={limits} {uid} {busy} />
    </div>
  {/if}
</StepCard>

<style>
  .si-fields { display: flex; flex-direction: column; gap: 6px; }
  .si-sub { margin: 10px 0 0; font-size: 13px; font-weight: 600; color: var(--text); }
  .si-sub:first-child { margin-top: 0; }
</style>
