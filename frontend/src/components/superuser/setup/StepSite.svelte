<script lang="ts">
  // Set up D7: step 2, the Edit site name dialog's field and the Edit logo
  // dialog's upload, with all its checks (Branding D3-D6). The values load
  // fresh each time the step opens. Save and continue waits for a chosen
  // logo's decode, then saves the name and the logo, each only when it
  // changed, then "step 2 saved" (D4). A failure after a save keeps what saved
  // as the new starting point and retries only the rest (D3, Users/Courses
  // D24). The header shows a save at once, as on Branding (D14).
  import StepCard from './StepCard.svelte';
  import SiteNameField from '../fields/SiteNameField.svelte';
  import LogoPicker from '../fields/LogoPicker.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import ErrorState from '../../ui/ErrorState.svelte';
  import { SiteNameForm } from '../../../lib/panelForms/siteNameForm.svelte';
  import { LogoPick, type SavedImage } from '../../../lib/panelForms/logoPick.svelte';
  import { ApiError } from '../../../lib/api';
  import { applyBranding } from '../../../lib/branding.svelte';
  import { tooLargeSentence } from '../../../lib/uploadLimit.svelte';
  import { getBranding, panelError, saveImage, saveSiteName, type PanelBranding } from '../../../lib/superuser';
  import { setupSaved, type StepProps } from '../../../lib/setup';
  import { useStepGuards } from '../../../lib/stepGuards.svelte';

  let { token, setup, onAuth, onDone, back, skip, moveError, onHold }: StepProps = $props();

  const uid = $props.id();
  let name = $state.raw<SiteNameForm | null>(null);
  let logo = $state.raw<LogoPick | null>(null);
  let loadError = $state<string | null>(null);
  /** A save succeeded; "step 2 saved" is still to send (D3). */
  let due = $state(false);

  const savedLogo = (b: PanelBranding): SavedImage =>
    b.logo && b.public.logo ? { ...b.logo, version: b.public.logo.version } : null;

  async function load(): Promise<void> {
    loadError = null;
    try {
      const b = await getBranding(token);
      name = new SiteNameForm(b.name);
      logo = new LogoPick('logo', savedLogo(b));
    } catch (e) {
      loadError = panelError(e, onAuth);
    }
  }
  void load();

  const step = $derived(setup.state?.steps[1] ?? null);
  const done = $derived(step?.done ?? false);
  const busy = $derived(setup.busy || setup.saving);
  const changed = $derived((name?.changed ?? false) || (logo?.changed ?? false));
  // Branding D5: a chosen logo is ready once checked and decoded.
  const ready = $derived(changed && (!logo?.changed || logo.ready));
  const mode = $derived.by((): 'save' | 'continue' | 'none' => {
    if (!name || !logo) return 'none';
    return done && !changed && !due ? 'continue' : 'save';
  });
  // D7: the reason speaks of the saved name, so it hides while the form
  // differs, and while "step 2 saved" is still to send.
  const reason = $derived(!done && !changed && !due ? step?.reason ?? null : null);

  function clearErrors(): void {
    if (name) name.error = null;
    if (logo) logo.error = null;
  }
  // D3: unsaved changes ask before leaving; Discard puts the loaded values back.
  useStepGuards({
    setup: () => setup, onHold: (h) => onHold(h), moveError: () => moveError,
    dirty: () => changed,
    discard: () => {
      if (name) name = new SiteNameForm(name.saved);
      if (logo) logo = new LogoPick('logo', logo.saved);
    },
    held: () => !!name?.error || !!logo?.error,
    clearErrors,
  });

  // D7 (U4): Remove drops a chosen logo; the saved one stays.
  function removeLogo(): void {
    if (logo) logo = new LogoPick('logo', logo.saved);
  }

  /** D14: the header, title and icons show a save at once. */
  function show(b: PanelBranding): void {
    void applyBranding(b.public, document);
  }

  async function sendSaved(): Promise<void> {
    // Both: an older logo sentence would hide this write's (it shows first).
    clearErrors();
    try {
      const s = await setup.write(() => setupSaved(token, 2));
      due = false;
      onDone(s);
    } catch (e) {
      const message = panelError(e, onAuth);
      if (name) name.error = message;
      // D13: a save may have marked the step kept; a re-read updates the marks.
      if (message !== null) void setup.read();
    }
  }

  async function onSave(): Promise<void> {
    if (busy || !name || !logo) return;
    // D3: after a half-save only "step 2 saved" is retried, unless the form
    // changed since: then what changed is saved first.
    if (mode === 'continue' || (due && !changed)) { await sendSaved(); return; }
    if (!ready) return;
    const pending = logo.pending;
    clearErrors();
    let failed: SiteNameForm | LogoPick = name;
    setup.saving = true;
    try {
      if (name.changed) {
        const b = await saveSiteName(token, name.body());
        show(b);
        name = new SiteNameForm(b.name);
        due = true;
      }
      failed = logo;
      if (pending) {
        const b = pending.kind === 'reset'
          ? await saveImage(token, 'logo', 'reset')
          : await saveImage(token, 'logo', pending.file.bytes, pending.file.name);
        show(b);
        logo = new LogoPick('logo', savedLogo(b));
        due = true;
      }
    } catch (e) {
      const message = failed === logo && e instanceof ApiError && e.status === 413 ? tooLargeSentence(e) : panelError(e, onAuth);
      failed.error = message;
      // D5a: the sequence ended; after a half-save a re-read updates the marks.
      if (due && message !== null) void setup.read();
      return;
    } finally {
      setup.saving = false;
    }
    await sendSaved();
  }
</script>

<StepCard n={2} title="Site name and logo" note="Shown in every page's header and in emails."
  error={logo?.error ?? name?.error ?? moveError} {busy} {mode} canSave={ready || (due && !changed)}
  onBack={back} onSkip={done ? undefined : skip} onSave={() => void onSave()}>
  {#if loadError !== null}
    <ErrorState title="Could not load branding." message={loadError} onretry={() => void load()} retryLabel="Try again" />
  {:else if !name || !logo}
    <Skeleton rows={3} label="Loading…" />
  {:else}
    {#if reason}<p class="ss-reason">{reason}</p>{/if}
    <!-- D3a: every edit notes the time for the keep-alive. -->
    <div class="ss-fields" oninput={() => setup.noteEdit()} onchange={() => setup.noteEdit()}
      onclick={() => setup.noteEdit()} role="presentation">
      <SiteNameField form={name} {uid} {busy} />
    </div>
    <p class="ss-sub">Logo (optional)</p>
    <div class="ss-fields" onchange={() => setup.noteEdit()} onclick={() => setup.noteEdit()} role="presentation">
      <LogoPicker form={logo} {busy} onRemove={removeLogo} />
    </div>
  {/if}
</StepCard>

<style>
  .ss-fields { display: flex; flex-direction: column; gap: 6px; }
  .ss-reason { margin: 0; font-size: 12.5px; color: var(--gold-text); }
  .ss-sub { margin: 10px 0 0; font-size: 13px; font-weight: 600; color: var(--text); }
</style>
