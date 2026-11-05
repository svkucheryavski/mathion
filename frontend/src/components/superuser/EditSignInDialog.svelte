<script lang="ts">
  // Settings D12: the Edit sign-in dialog, three whole numbers and the longest
  // sign-in as three segments. `save` THROWS on failure and the server's
  // sentence (the ranges) shows here (D5).
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
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

  const LONGEST = [1, 7, 30].map((d) => ({ value: d, label: `${d} ${d === 1 ? 'day' : 'days'}` }));

  const saved = untrack(() => ({
    minutes: String(signIn.pin_minutes),
    requests: String(signIn.pin_requests_per_hour),
    tries: String(signIn.pin_failures_per_hour),
    days: signIn.longest_sign_in_days,
  }));
  let minutes = $state(saved.minutes);
  let requests = $state(saved.requests);
  let tries = $state(saved.tries);
  let days = $state(saved.days);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const ready = $derived(
    minutes.trim() !== saved.minutes || requests.trim() !== saved.requests
    || tries.trim() !== saved.tries || days !== saved.days,
  );
  const whole = (v: string) => /^\d+$/.test(v.trim());

  async function onSave() {
    if (busy || !ready) return;
    if (![minutes, requests, tries].every(whole)) { error = 'Type a whole number.'; return; }
    error = null;
    busy = true;
    try {
      await save({
        pin_minutes: Number(minutes.trim()),
        pin_requests_per_hour: Number(requests.trim()),
        pin_failures_per_hour: Number(tries.trim()),
        longest_sign_in_days: days,
      });
      onDone();
    } catch (e) {
      error = panelError(e, onAuth);
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
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={560} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="es-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void onSave(); }}>
    <label class="es-label" for="{uid}-min">A PIN lasts (minutes)</label>
    <input id="{uid}-min" class="es-input" data-autofocus bind:value={minutes} readonly={busy}
      inputmode="numeric" autocomplete="off" oninput={() => { error = null; }} />
    <label class="es-label" for="{uid}-req">PIN requests per hour</label>
    <input id="{uid}-req" class="es-input" bind:value={requests} readonly={busy}
      inputmode="numeric" autocomplete="off" oninput={() => { error = null; }} />
    <label class="es-label" for="{uid}-try">Wrong PIN tries per hour</label>
    <input id="{uid}-try" class="es-input" bind:value={tries} readonly={busy}
      inputmode="numeric" autocomplete="off" oninput={() => { error = null; }} />
    <span class="es-label">Longest sign-in</span>
    <Segmented options={LONGEST} bind:value={days} name="{uid}-longest" label="Longest sign-in"
      fit disabled={busy} onchange={() => { error = null; }} />
    {#if error}<p id={errId} class="es-err" role="alert">{error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .es-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .es-form { display: flex; flex-direction: column; gap: 6px; }
  .es-label { font-size: 12.5px; color: var(--muted); }
  .es-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (EditCourseDialog .ec-input), as wide as a number. */
  .es-input {
    box-sizing: border-box;
    width: 120px;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .es-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .es-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
