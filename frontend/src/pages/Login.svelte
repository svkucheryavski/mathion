<script lang="ts">
  import { requestPin, verifyPin, getAuthConfig } from '../lib/auth.svelte';
  import { ApiError } from '../lib/api';
  import { navigate, safeNext, defaultLandingPath } from '../lib/router.svelte';
  import type { User } from '../lib/types';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import FormRow from '../components/ui/FormRow.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  // Capture + clear the superuser return path SYNCHRONOUSLY at init, before any
  // await — bounds the key's lifetime to this Login mount so an abandoned panel
  // redirect can't hijack a later ordinary login.
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

  $effect(() => {
    void loadConfig();
  });

  async function loadConfig(): Promise<void> {
    try {
      const cfg = await getAuthConfig();
      sendPinEnabled = cfg.send_pin_enabled;
    } catch {
      // Network/5xx — resolve into the standard two-step flow (no infinite
      // spinner; submit re-enables). Production-normal path.
      sendPinEnabled = true;
    }
  }

  function afterLogin(user: User): void {
    if (returnPath !== null) {
      void navigate(returnPath, { replace: true });   // precedence over ?next=
      return;
    }
    const rawNext = new URLSearchParams(location.search).get('next');
    const fallback = defaultLandingPath(user);
    const dest = (rawNext === null || rawNext === '/')
      ? fallback
      : safeNext(rawNext, location.origin, fallback);
    void navigate(dest, { replace: true });
  }

  async function onSubmitEmail(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (sendPinEnabled === undefined) return; // belt-and-suspenders: no request-pin before config lands
    error = '';
    busy = true;
    try {
      await requestPin(email.trim());
      step = 'pin';
    } catch (err: unknown) {
      error = err instanceof ApiError ? err.displayMessage : 'Could not send PIN. Try again.';
    } finally {
      busy = false;
    }
  }

  async function onSubmitPin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const user = await verifyPin(email.trim(), pin.trim(), duration);
      afterLogin(user);
    } catch (err: unknown) {
      error = err instanceof ApiError ? err.displayMessage : 'Could not verify PIN.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
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
        <Input type="text" bind:value={pin} autocomplete="one-time-code" name="pin" />
      </FormRow>
      <FormRow label="Stay signed in for">
        <select bind:value={duration}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </FormRow>
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
        <Input type="text" bind:value={pin} autocomplete="one-time-code" autofocus name="pin" />
      </FormRow>
      <FormRow label="Stay signed in for">
        <select bind:value={duration}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </FormRow>
      <div class="actions">
        <Button type="submit" loading={busy} disabled={pin.length !== 6 || busy}>Sign in</Button>
        <Button variant="ghost" onclick={() => { step = 'email'; pin = ''; error = ''; }}>Back</Button>
      </div>
    </form>
  {/if}
</div>

<style>
  .login { max-width: 360px; margin: var(--space-6) auto; padding: var(--space-3); }
  .subtitle { color: var(--muted); margin-bottom: var(--space-3); }
  .actions { display: flex; gap: var(--space-2); }
  .loading { display: flex; justify-content: center; padding: var(--space-4); }
  select {
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
  }
</style>
