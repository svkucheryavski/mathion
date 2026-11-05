<script lang="ts">
  // Settings D11: the Edit file limits dialog, both limits in whole MB. `save`
  // THROWS on failure and the server's sentence (the ranges) shows here (D5).
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import { panelError, type PanelLimits, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    limits: PanelLimits;
    save: (body: PanelLimits) => Promise<void>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { limits, save, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  const saved = untrack(() => ({ file: String(limits.max_file_mb), total: String(limits.max_total_mb) }));
  let file = $state(saved.file);
  let total = $state(saved.total);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const ready = $derived(file.trim() !== saved.file || total.trim() !== saved.total);
  const whole = (v: string) => /^\d+$/.test(v.trim());

  async function onSave() {
    if (busy || !ready) return;
    if (!whole(file) || !whole(total)) { error = 'Type a whole number of MB.'; return; }
    error = null;
    busy = true;
    try {
      await save({ max_file_mb: Number(file.trim()), max_total_mb: Number(total.trim()) });
      onDone();
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="el-title">Edit file limits</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={560} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="el-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void onSave(); }}>
    <label class="el-label" for="{uid}-file">Largest file (MB)</label>
    <input id="{uid}-file" class="el-input" data-autofocus bind:value={file} readonly={busy}
      inputmode="numeric" autocomplete="off" oninput={() => { error = null; }} />
    <!-- D11c, verbatim. -->
    <p class="el-hint el-proxy">Uploads also pass the server's proxy. With <code>mathion tls</code>, an up-to-date <code>mathion</code> allows 50 MB; another proxy must allow at least this.</p>
    <label class="el-label" for="{uid}-total">Files per course version or run, in total (MB)</label>
    <input id="{uid}-total" class="el-input" bind:value={total} readonly={busy}
      inputmode="numeric" autocomplete="off" oninput={() => { error = null; }} />
    {#if error}<p id={errId} class="el-err" role="alert">{error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .el-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .el-form { display: flex; flex-direction: column; gap: 6px; }
  .el-label { font-size: 12.5px; color: var(--muted); }
  .el-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (EditCourseDialog .ec-input), as wide as a number. */
  .el-input {
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
  .el-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .el-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .el-hint code { font-family: var(--font-mono); font-size: 11.5px; }
  .el-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
