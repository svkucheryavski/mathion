<script lang="ts">
  import { requestPin, verifyPin, getAuthConfig } from '../lib/auth.svelte';
  import { ApiError } from '../lib/api';
  import { navigate, safeNext, defaultLandingPath } from '../lib/router.svelte';
  import type { User } from '../lib/types';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import FormRow from '../components/ui/FormRow.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Logo from '../components/ui/Logo.svelte';
  import { PRODUCT_NAME } from '../lib/branding';

  // Capture + clear the superuser return path SYNCHRONOUSLY at init, before any
  // await — bounds the key's lifetime to this Login mount so an abandoned panel
  // redirect can't hijack a later ordinary login.
  // (Guarded by Login.svelte.test.ts.)
  const returnPath: string | null = (() => {
    const p = sessionStorage.getItem('superuser_return_path');
    if (p !== null) sessionStorage.removeItem('superuser_return_path');
    return p;
  })();

  type Step = 'email' | 'pin';
  let step = $state<Step>('email');
  let email = $state('');
  let pin = $state('');
  let duration = $state<1 | 7 | 30>(7);
  let busy = $state(false);
  let error = $state('');
  // undefined until GET /api/auth/config resolves — render-gate.
  let sendPinEnabled = $state<boolean | undefined>(undefined);
  const DURATIONS = [1, 7, 30] as const;   // `as const` keeps `d: 1|7|30` (bare [1,7,30] widens to number[])

  $effect(() => { void loadConfig(); });

  async function loadConfig(): Promise<void> {
    try { sendPinEnabled = (await getAuthConfig()).send_pin_enabled; }
    catch {
      // Network/5xx — resolve into the standard two-step flow (no infinite
      // spinner; submit re-enables). Production-normal path.
      sendPinEnabled = true;
    }
  }

  function afterLogin(user: User): void {
    if (returnPath !== null) { void navigate(returnPath, { replace: true }); return; }   // precedence over ?next=
    const rawNext = new URLSearchParams(location.search).get('next');
    const fallback = defaultLandingPath(user);
    const dest = (rawNext === null || rawNext === '/') ? fallback : safeNext(rawNext, location.origin, fallback);
    void navigate(dest, { replace: true });
  }

  async function onSubmitEmail(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (sendPinEnabled === undefined) return;   // belt-and-suspenders: no request-pin before config lands
    error = ''; busy = true;
    try { await requestPin(email.trim()); step = 'pin'; }
    catch (err: unknown) { error = err instanceof ApiError ? err.displayMessage : 'Could not send PIN. Try again.'; }
    finally { busy = false; }
  }

  async function onSubmitPin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = ''; busy = true;
    try { afterLogin(await verifyPin(email.trim(), pin.trim(), duration)); }
    catch (err: unknown) { error = err instanceof ApiError ? err.displayMessage : 'Could not verify PIN.'; }
    finally { busy = false; }
  }
</script>

{#snippet durationField()}
  <FormRow label="Stay signed in for">
    <div class="segmented" role="radiogroup" aria-label="Stay signed in for">
      {#each DURATIONS as d (d)}
        <label class="segment" class:selected={duration === d}>
          <input type="radio" name="duration" value={d} bind:group={duration} />
          {d} {d === 1 ? 'day' : 'days'}
        </label>
      {/each}
    </div>
  </FormRow>
{/snippet}

<div class="login">
  <div class="card">
    <div class="brand"><Logo form="login" /><span class="wordmark">{PRODUCT_NAME}</span></div>
    <h1>Sign in</h1>

    {#if sendPinEnabled === undefined}
      <div class="loading"><Spinner /></div>
    {:else if sendPinEnabled === false}
      <p class="subtitle">Email delivery isn't configured — enter your email and the PIN shown in the server terminal.</p>
      <form onsubmit={onSubmitPin}>
        <FormRow label="Email">
          <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
        </FormRow>
        <FormRow label="PIN" error={error}>
          <Input type="text" mono bind:value={pin} autocomplete="one-time-code" name="pin" />
        </FormRow>
        {@render durationField()}
        <Button type="submit" loading={busy} disabled={!email || pin.length !== 6 || busy}>Sign in</Button>
      </form>
    {:else if step === 'email'}
      <form onsubmit={onSubmitEmail}>
        <FormRow label="Email" error={error}>
          <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
        </FormRow>
        <Button type="submit" loading={busy} disabled={!email || busy}>Send PIN</Button>
      </form>
    {:else}
      <p class="subtitle">If <strong>{email}</strong> is registered, a 6-digit PIN has been sent — check your email (or the server console/outbox in a dev deployment).</p>
      <form onsubmit={onSubmitPin}>
        <FormRow label="PIN" error={error}>
          <Input type="text" mono bind:value={pin} autocomplete="one-time-code" autofocus name="pin" />
        </FormRow>
        {@render durationField()}
        <div class="actions">
          <Button type="submit" full loading={busy} disabled={pin.length !== 6 || busy}>Sign in</Button>
          <Button variant="ghost" onclick={() => { step = 'email'; pin = ''; error = ''; }}>Back</Button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .login { display: flex; justify-content: center; padding: var(--space-6) var(--space-3); }
  .card { width: 100%; max-width: 380px; /* ref 1987 fixed 380 → max-width for responsiveness */ background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; /* ref 1987 */ box-shadow: 0 1px 2px rgba(20, 24, 35, .06); /* ref 1987 — no --shadow token */ }
  .card h1 { margin-bottom: 6px; /* ref 1992 */ }
  .brand { display: flex; align-items: center; gap: var(--space-2); margin-bottom: 20px; /* ref 1988 */ }
  .wordmark { font-size: 15px; /* ref 1990 */ font-weight: 600; letter-spacing: -.01em; color: var(--text); }
  .subtitle { font-size: 13px; /* ref 1993 */ line-height: 1.5; color: var(--muted); margin: 0 0 20px; }
  .segmented { display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .segment { position: relative; flex: 1; text-align: center; font-size: 13px; /* ref 2004 */ color: var(--muted); padding: var(--btn-pad-segment); background: var(--surface); cursor: pointer; }
  .segment:not(:first-child) { border-left: 1px solid var(--border); }
  .segment.selected { background: var(--primary-soft); color: var(--text); font-weight: 500; }
  .segment input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: -1px; }        /* visually-hidden radio (sr-only, not a disabled treatment) */
  .segment input:focus-visible { box-shadow: none; }                                                /* suppress the global :focus-visible glow (base.css:21-25) on the hidden radio */
  .segment:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }                 /* --primary: visible on both --surface and the selected --primary-soft */
  .actions { display: flex; align-items: center; gap: 10px; /* ref 2009 */ }
  .loading { display: flex; justify-content: center; padding: var(--space-4); }
</style>
