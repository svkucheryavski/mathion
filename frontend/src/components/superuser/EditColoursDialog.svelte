<script lang="ts">
  // Branding D2, D10: the Edit colours dialog. A chosen file's bytes are read
  // once and the same bytes go to the server's check and to Save; Save waits
  // for the check's answer. A refused choice drops every pending change, so
  // the preview is the saved colours again; a check answer for an earlier
  // choice, or one still running when Reset is pressed, is ignored. The
  // preview declares the merged colours on its own box, never the raw file.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import SiteLogo from '../chrome/SiteLogo.svelte';
  import { ApiError } from '../../lib/api';
  import { mergedColours, ticked } from '../../lib/themeFile';
  import { tooLargeSentence } from '../../lib/uploadLimit.svelte';
  import { panelError, type BrandingPart, type PanelColours, type PanelOnAuth, type ThemeCheck } from '../../lib/superuser';

  type Props = {
    /** The saved colours: the changes in use, with every colour's default. */
    colours: PanelColours;
    check: (bytes: Uint8Array<ArrayBuffer>, filename: string) => Promise<ThemeCheck>;
    save: (part: BrandingPart, filename?: string) => Promise<void>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { colours, check, save, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  // D10: the server reads at most 64 KB + 1 byte; a larger file is refused unread.
  const MAX_BYTES = 64 * 1024;
  const TOO_BIG = 'The theme file can be at most 64 KB.';

  const saved = untrack(() => colours);
  const hasSaved = Object.keys(saved.changes).length > 0;

  type Chosen = { bytes: Uint8Array<ArrayBuffer>; name: string; answer: ThemeCheck | null };
  let pending = $state<{ kind: 'file'; file: Chosen } | { kind: 'reset' } | null>(null);
  let problems = $state<{ list: string[]; more: number } | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let picker = $state<HTMLInputElement | undefined>();
  let saveButton = $state<HTMLButtonElement | undefined>();
  // Each choice and each Reset counts; a read or check answer for an earlier one is ignored.
  let turn = 0;

  const answer = $derived(pending?.kind === 'file' ? pending.file.answer : null);
  const ready = $derived(pending?.kind === 'reset' || (answer !== null && answer.blocked === null));
  /** What the preview shows: a checked choice, the defaults after Reset, or the saved colours. */
  const merged = $derived(mergedColours(saved.vars,
    pending?.kind === 'reset' ? {} : answer ? answer.changes : saved.changes));

  const counted = (n: number) => (n === 0 ? 'no colour changes' : n === 1 ? '1 colour' : `${n} colours`);

  function readBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function refuse(sentence: string | null, found: { list: string[]; more: number } | null = null) {
    pending = null;
    error = sentence;
    problems = found;
  }

  async function onChoose(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const mine = ++turn;
    // The last change wins: the earlier choice or Reset is gone at once.
    refuse(null);
    if (file.size > MAX_BYTES) { refuse(TOO_BIG); return; }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBytes(file);
    } catch {
      if (mine === turn) refuse("This file can't be read.");
      return;
    }
    if (mine !== turn) return;
    pending = { kind: 'file', file: { bytes, name: file.name, answer: null } };
    let found: ThemeCheck;
    try {
      found = await check(bytes, file.name);
    } catch (err) {
      if (mine === turn) refuse(err instanceof ApiError && err.status === 413 ? tooLargeSentence(err) : panelError(err, onAuth));
      return;
    }
    if (mine !== turn) return;
    if (found.problems.length) { refuse(null, { list: found.problems, more: found.more }); return; }
    if (pending?.kind === 'file') pending.file.answer = found;
  }

  function onReset() {
    turn++;
    pending = { kind: 'reset' };
    error = null;
    problems = null;
    saveButton?.focus();
  }

  async function onSave() {
    if (busy || !ready || !pending) return;
    error = null;
    busy = true;
    try {
      if (pending.kind === 'reset') await save('reset');
      else await save(pending.file.bytes, pending.file.name);
      onDone();
    } catch (err) {
      error = err instanceof ApiError && err.status === 413 ? tooLargeSentence(err) : panelError(err, onAuth);
    } finally {
      busy = false;
    }
  }

  /** D10: the full merged set on the preview's own box, so only the sample takes it. */
  function declare(box: HTMLElement) {
    for (const [name, value] of Object.entries(merged)) box.style.setProperty(name, value);
  }
</script>

{#snippet sentence(s: string)}
  {#each ticked(s) as part, i (i)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}
{/snippet}

{#snippet head()}
  <h2 id={titleId} class="ec-title">Edit colours</h2>
{/snippet}

{#snippet foot()}
  {#if hasSaved}
    <Button variant="ghost" disabled={busy} onclick={onReset}>Reset to default</Button>
  {/if}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} bind:element={saveButton}
    onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={520} maxHeight={680} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <div class="ec-body" aria-describedby={error ? errId : undefined}>
    <div class="ec-choose">
      <Button variant="secondary" disabled={busy} onclick={() => picker?.click()}>Choose a .css file…</Button>
      {#if pending?.kind === 'file'}
        <span class="ec-file">{pending.file.name}: {answer ? counted(Object.keys(answer.changes).length) : 'checking…'}</span>
      {/if}
      <input bind:this={picker} type="file" accept=".css,text/css" hidden onchange={onChoose} />
    </div>
    <p class="ec-hint">Only colour variables, as in the downloaded theme. A colour you leave out gets Mathion's.</p>

    <p class="ec-label">Preview</p>
    <!-- A sample, not a control: inert keeps keyboard users out of it. -->
    <div class="ec-preview" inert {@attach declare}>
      <div class="pv-head">
        <SiteLogo size="header" />
        <span class="pv-pill on">Courses</span>
        <span class="pv-pill">Teaching</span>
      </div>
      <div class="pv-body">
        <div class="pv-card">
          <strong class="pv-title">Linear algebra, autumn</strong>
          <span class="pv-meta">12 students · deadline 14 Nov · <a href="/">Course page</a></span>
          <div class="pv-row">
            <Button variant="primary">Open</Button>
            <Button variant="secondary">Runs</Button>
            <StatusBadge status="accepted" />
            <StatusBadge status="needs_revision" />
          </div>
        </div>
      </div>
    </div>

    {#if answer?.blocked}<p class="ec-blocked" role="status">{answer.blocked}</p>{/if}
    {#if answer?.warnings.length}
      <ul class="ec-warnings">
        {#each answer.warnings as w (w)}<li>{@render sentence(w)}</li>{/each}
      </ul>
    {/if}
    {#if problems}
      <ul class="ec-problems" role="alert">
        {#each problems.list as p, i (i)}<li>{@render sentence(p)}</li>{/each}
        {#if problems.more > 0}<li>and {problems.more} more</li>{/if}
      </ul>
    {/if}
    {#if error}<p id={errId} class="ec-err" role="alert">{@render sentence(error)}</p>{/if}
  </div>
</Modal>

<style>
  .ec-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .ec-body { display: flex; flex-direction: column; gap: 6px; }
  .ec-choose { display: flex; align-items: center; gap: 10px; }
  .ec-file { font-size: 12.5px; color: var(--text-2); overflow-wrap: anywhere; }
  .ec-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .ec-label { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
  /* The sample (dialogs.html): it takes only the colours its box declares. */
  .ec-preview {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
    font-size: 12.5px;
  }
  .pv-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  /* The panel's nav pills (SuperuserShell .su-pill). */
  .pv-pill { padding: 2px 8px; border-radius: 4px; color: var(--muted); }
  .pv-pill.on { color: var(--gold-text); background: var(--gold-soft); font-weight: 500; }
  .pv-body { padding: 10px; }
  .pv-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .pv-title { color: var(--text); }
  .pv-meta { color: var(--muted); }
  .pv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
  .ec-blocked { margin: 4px 0 0; font-size: 12.5px; color: var(--text-2); }
  .ec-warnings { margin: 4px 0 0; padding-left: 18px; font-size: 12px; color: var(--gold-text); }
  .ec-problems { margin: 4px 0 0; padding-left: 18px; font-size: 12px; color: var(--danger); }
  .ec-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
  .ec-body code { font-family: var(--font-mono); font-size: 11.5px; }
</style>
