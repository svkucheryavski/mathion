<script lang="ts">
  // Settings D7-D9: the email form's fields, shared by the Edit email dialog
  // and Set up's Email step. Greyed while the switch is off (D7c). While a
  // save runs (`busy`) they hold still with their look: the text fields go
  // read-only, the choices ignore clicks (Switch's R19) and the arrow keys.
  import Switch from '../../ui/Switch.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import { ENCRYPTIONS, type EmailForm } from '../../../lib/panelForms/emailForm.svelte';

  type Props = { form: EmailForm; uid: string; busy: boolean };
  let { form, uid, busy }: Props = $props();

  // A cancelled click leaves the box as it was, so no change fires.
  function holdBox(e: MouseEvent): void {
    if (busy) e.preventDefault();
  }
  const pwHint = $derived(form.noUsernameNote !== null || form.unreadableHint ? `${uid}-pw-hint` : undefined);
</script>

<div class="ee-switch">
  <Switch id="{uid}-on" bind:checked={form.on} frozen={busy} onchange={() => form.edited()} />
  <label for="{uid}-on">Send email</label>
</div>

<div class="ee-pair">
  <label class="ee-label" for="{uid}-host">Mail server</label>
  <label class="ee-label" for="{uid}-port">Port</label>
  <input id="{uid}-host" class="ee-input ee-mono" data-autofocus bind:value={form.host} disabled={!form.on} readonly={busy}
    autocomplete="off" spellcheck="false" oninput={() => form.edited()} />
  <input id="{uid}-port" class="ee-input ee-mono" bind:value={form.port} disabled={!form.on} readonly={busy}
    inputmode="numeric" autocomplete="off" oninput={() => form.edited()} />
</div>

<span class="ee-label" id="{uid}-enc">Encryption</span>
<Segmented options={ENCRYPTIONS} bind:value={form.encryption} name="{uid}-encryption" label="Encryption" labelledby="{uid}-enc"
  fit disabled={!form.on} frozen={busy} onchange={(next) => form.pickEncryption(next)} />
<p class="ee-hint">Picking one sets the usual port: 587, 465 or 25.</p>
<label class="ee-check">
  <input type="checkbox" bind:checked={form.skipCert} disabled={!form.on} aria-disabled={busy ? 'true' : undefined}
    onclick={holdBox} onchange={() => form.edited()} />
  <span>Don't check the server's certificate</span>
</label>

<label class="ee-label" for="{uid}-user">Username</label>
<input id="{uid}-user" class="ee-input" bind:value={form.username} disabled={!form.on} readonly={busy}
  autocomplete="off" spellcheck="false" oninput={() => form.edited()} />
<p class="ee-hint">Leave empty to send without logging in.</p>

<label class="ee-label" for="{uid}-pw">Password</label>
<input id="{uid}-pw" class="ee-input" type="password" bind:value={form.password} disabled={!form.on} readonly={busy}
  autocomplete="new-password" placeholder={form.placeholder} aria-describedby={pwHint} oninput={() => form.edited()} />
{#if form.noUsernameNote !== null}
  <p class="ee-hint" id={pwHint}>{form.noUsernameNote}</p>
{:else if form.unreadableHint}
  <p class="ee-hint ee-warn" id={pwHint}>The saved password can't be read on this server: type it again.</p>
{/if}

<label class="ee-label" for="{uid}-from">From address</label>
<input id="{uid}-from" class="ee-input" bind:value={form.from} disabled={!form.on} readonly={busy}
  autocomplete="off" spellcheck="false" oninput={() => form.edited()} />

<style>
  .ee-switch { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); }
  .ee-label { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
  /* Mail server and Port share a row (the mockup's 1fr / 90px). */
  .ee-pair { display: grid; grid-template-columns: 1fr 90px; column-gap: 10px; row-gap: 6px; }
  /* The item modal's field (EditCourseDialog .ec-input). */
  .ee-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .ee-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  /* D7c: greyed by colour, never by opacity. */
  .ee-input:disabled { background: var(--surface-2); color: var(--muted); border-color: var(--border-faint); }
  .ee-mono { font-family: var(--font-mono); }
  .ee-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .ee-warn { color: var(--danger); }
  .ee-check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); margin-top: 2px; }
  .ee-check:has(input:disabled) { color: var(--muted); }
</style>
