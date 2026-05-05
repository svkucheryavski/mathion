<script lang="ts">
  import { requestPin, verifyPin } from '../lib/auth.svelte';
  import { ApiError } from '../lib/api';
  import { navigate, safeNext } from '../lib/router.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import FormRow from '../components/ui/FormRow.svelte';

  type Step = 'email' | 'pin';
  let step = $state<Step>('email');
  let email = $state('');
  let pin = $state('');
  let duration = $state<1 | 7 | 30>(7);
  let busy = $state(false);
  let error = $state('');

  async function onSubmitEmail(e: SubmitEvent): Promise<void> {
    e.preventDefault();
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
      await verifyPin(email.trim(), pin.trim(), duration);
      const params = new URLSearchParams(location.search);
      const next = params.get('next') ?? '/courses';
      navigate(safeNext(decodeURIComponent(next), location.origin), { replace: true });
    } catch (err: unknown) {
      error = err instanceof ApiError ? err.displayMessage : 'Could not verify PIN.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <h1>Sign in</h1>

  {#if step === 'email'}
    <form onsubmit={onSubmitEmail}>
      <FormRow label="Email" error={error}>
        <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
      </FormRow>
      <Button type="submit" loading={busy} disabled={!email || busy}>
        Send PIN
      </Button>
    </form>
  {:else}
    <p class="subtitle">A 6-digit PIN was sent to <strong>{email}</strong> (if registered).</p>
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
  select {
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
  }
</style>
