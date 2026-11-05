<script lang="ts">
  // Settings D7-D9: the Edit email dialog. Save sends the switch alone when it
  // is off (D7c), otherwise every field, with the password only when typed
  // (D8: an empty field keeps the saved one). `save` THROWS on failure and the
  // server's sentence shows here (D5). Send test email tests the form as it is
  // now; its answer, a 409 included, shows above the buttons (D9).
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import Switch from '../ui/Switch.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import {
    panelError, type Encryption, type EmailSaveBody, type EmailTestBody, type EmailTestResult,
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

  const ENCRYPTIONS: { value: Encryption; label: string }[] = [
    { value: 'starttls', label: 'STARTTLS' },
    { value: 'ssl', label: 'SSL/TLS' },
    { value: 'none', label: 'None' },
  ];
  const USUAL_PORT: Record<Encryption, number> = { starttls: 587, ssl: 465, none: 25 };
  // The server's own sentence (Task 4), so a typo reads the same either side.
  const PORT_SENTENCE = 'The port must be from 1 to 65535.';

  // The saved values; a save that succeeds closes the dialog.
  const saved = untrack(() => ({ ...email, port: String(email.port) }));
  let on = $state(saved.on);
  let host = $state(saved.host);
  let port = $state(saved.port);
  let encryption = $state<Encryption>(saved.encryption);
  let skipCert = $state(saved.skip_cert_check);
  let username = $state(saved.username);
  let password = $state('');
  let from = $state(saved.from_address);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let testing = $state(false);
  let result = $state<EmailTestResult | null>(null);

  const fieldsChanged = $derived(
    host.trim() !== saved.host || port.trim() !== saved.port || encryption !== saved.encryption
    || skipCert !== saved.skip_cert_check || username.trim() !== saved.username || password !== ''
    || from.trim() !== saved.from_address,
  );
  // Off writes only the switch, so greyed fields that differ change nothing.
  const ready = $derived(on !== saved.on || (on && fieldsChanged));
  const placeholder = $derived(saved.password_saved && !saved.password_unreadable ? 'Saved: type a new one to replace it' : '');

  // Bumped by every change, so a test answer about older values is dropped.
  let edits = 0;

  function edited(): void {
    edits++;
    error = null;
    result = null;
  }

  function pickEncryption(next: Encryption): void {
    port = String(USUAL_PORT[next]);
    edited();
  }

  // The form as a test or an on save sends it; null when the port isn't a number.
  function fields(): EmailTestBody | null {
    if (!/^\d+$/.test(port.trim())) return null;
    const body: EmailTestBody = {
      host: host.trim(), port: Number(port.trim()), encryption, skip_cert_check: skipCert,
      username: username.trim(), from_address: from.trim(),
    };
    if (password !== '') body.password = password;
    return body;
  }

  async function onSave() {
    if (busy || !ready) return;
    error = null;
    let body: EmailSaveBody;
    if (on) {
      const f = fields();
      if (!f) { error = PORT_SENTENCE; return; }
      body = { on: true, ...f };
    } else {
      body = { on: false };
    }
    busy = true;
    try {
      await save(body);
      onDone();
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }

  // D9: one test at a time; Save and Cancel stay usable while it runs.
  async function onTest() {
    if (testing) return;
    const f = fields();
    if (!f) { result = { ok: false, message: PORT_SENTENCE }; return; }
    result = null;
    testing = true;
    const asked = edits;
    try {
      const answer = await test(f);
      if (asked === edits) result = answer;
    } catch (e) {
      const message = panelError(e, onAuth);
      if (asked === edits && message !== null) result = { ok: false, message };
    } finally {
      testing = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="ee-title">Edit email</h2>
{/snippet}

{#snippet foot()}
  {#if on}
    <Button variant="secondary" loading={testing} aria-disabled={testing} onclick={() => void onTest()}>Send test email</Button>
  {/if}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={640} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="ee-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void onSave(); }}>
    <div class="ee-switch">
      <Switch id="{uid}-on" bind:checked={on} frozen={busy} onchange={edited} />
      <label for="{uid}-on">Send email</label>
    </div>

    <div class="ee-pair">
      <label class="ee-label" for="{uid}-host">Mail server</label>
      <label class="ee-label" for="{uid}-port">Port</label>
      <input id="{uid}-host" class="ee-input ee-mono" data-autofocus bind:value={host} disabled={!on} readonly={busy}
        autocomplete="off" spellcheck="false" oninput={edited} />
      <input id="{uid}-port" class="ee-input ee-mono" bind:value={port} disabled={!on} readonly={busy}
        inputmode="numeric" autocomplete="off" oninput={edited} />
    </div>

    <span class="ee-label" id="{uid}-enc">Encryption</span>
    <Segmented options={ENCRYPTIONS} bind:value={encryption} name="{uid}-encryption" label="Encryption"
      fit disabled={!on || busy} onchange={pickEncryption} />
    <p class="ee-hint">Picking one sets the usual port: 587, 465 or 25.</p>
    <label class="ee-check">
      <input type="checkbox" bind:checked={skipCert} disabled={!on || busy} onchange={edited} />
      <span>Don't check the server's certificate</span>
    </label>

    <label class="ee-label" for="{uid}-user">Username</label>
    <input id="{uid}-user" class="ee-input" bind:value={username} disabled={!on} readonly={busy}
      autocomplete="off" spellcheck="false" oninput={edited} />
    <p class="ee-hint">Leave empty to send without logging in.</p>

    <label class="ee-label" for="{uid}-pw">Password</label>
    <input id="{uid}-pw" class="ee-input" type="password" bind:value={password} disabled={!on} readonly={busy}
      autocomplete="new-password" {placeholder} oninput={edited} />
    {#if saved.password_unreadable}
      <p class="ee-hint ee-warn">The saved password can't be read on this server: type it again.</p>
    {/if}

    <label class="ee-label" for="{uid}-from">From address</label>
    <input id="{uid}-from" class="ee-input" bind:value={from} disabled={!on} readonly={busy}
      autocomplete="off" spellcheck="false" oninput={edited} />

    {#if error}<p id={errId} class="ee-err" role="alert">{error}</p>{/if}
    {#if result}
      <p class="ee-result" class:ok={result.ok} class:err={!result.ok} role="status">{result.message}</p>
    {/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .ee-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .ee-form { display: flex; flex-direction: column; gap: 6px; }
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
  .ee-input:disabled { background: var(--surface-2); color: var(--muted); }
  .ee-mono { font-family: var(--font-mono); }
  .ee-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .ee-warn { color: var(--danger); }
  .ee-check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); margin-top: 2px; }
  .ee-check:has(input:disabled) { color: var(--muted); }
  .ee-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
  /* D9: the test's answer, above the buttons (the mockup's result box). */
  .ee-result { margin: 6px 0 0; padding: 7px 10px; border-radius: var(--radius); font-size: 12.5px; }
  .ee-result.ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ee-result.err { background: var(--danger-panel-bg); color: var(--danger-panel-fg); }
</style>
