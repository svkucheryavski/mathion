<script lang="ts">
  import { requestPin, verifyPin, getAuthConfig } from '../lib/auth.svelte';
  import { ApiError } from '../lib/api';
  import { navigate, safeNext, defaultLandingPath } from '../lib/router.svelte';
  import type { User } from '../lib/types';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import FormRow from '../components/ui/FormRow.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import SiteLogo from '../components/chrome/SiteLogo.svelte';
  import Segmented from '../components/ui/Segmented.svelte';

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
  // Settings D12: only the lengths up to the longest the panel allows (all
  // three until the config arrives, or if it fails).
  let longest = $state(30);
  const durationOptions = $derived(DURATIONS.filter((d) => d <= longest)
    .map((d) => ({ value: d, label: `${d} ${d === 1 ? 'day' : 'days'}` })));

  $effect(() => { void loadConfig(); });

  async function loadConfig(): Promise<void> {
    try {
      const config = await getAuthConfig();
      longest = config.longest_sign_in_days;
      // 7 days, or the longest when that's shorter (1, 7 and 30 are the only lengths).
      duration = longest < 7 ? 1 : 7;
      sendPinEnabled = config.send_pin_enabled;
    }
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
    <Segmented options={durationOptions} bind:value={duration} name="duration" label="Stay signed in for" />
  </FormRow>
{/snippet}

<div class="login">
  <div class="card">
    <div class="brand"><SiteLogo size="login" /></div>
    <h1>Sign in</h1>

    {#if sendPinEnabled === undefined}
      <div class="loading"><Spinner /></div>
    {:else if sendPinEnabled === false}
      <p class="subtitle">Email isn't set up on this server, so PINs aren't emailed. Ask the person who runs this site for one.</p>
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
  .brand { margin-bottom: 20px; /* ref 1988 */ }
  .subtitle { font-size: 13px; /* ref 1993 */ line-height: 1.5; color: var(--muted); margin: 0 0 20px; }
  .actions { display: flex; align-items: center; gap: 10px; /* ref 2009 */ }
  .loading { display: flex; justify-content: center; padding: var(--space-4); }
</style>
