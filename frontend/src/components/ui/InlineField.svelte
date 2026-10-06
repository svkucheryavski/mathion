<script lang="ts">
  // InlineField — one row that reads as text until opened; each field commits
  // on its own (visual-spec §4 "Inline field editing", Slice-5a spec §1.1).
  // The panel owns the PATCH: `onCommit` resolves on success and THROWS on
  // failure. The editor is one-way (value + oninput), never bind:value — a
  // bound type=number yields number|null and would break the string draft.
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import IconButton from './IconButton.svelte';
  import { ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';

  type Kind = 'text' | 'textarea' | 'number';
  type Props = {
    label: string;
    value: string | number;
    kind?: Kind;
    editTitle: string;
    disabledReason?: string | null;
    validate?: (parsed: string | number) => string | null;
    required?: boolean;
    maxlength?: number;
    min?: number;
    max?: number;
    step?: number;
    onCommit: (parsed: string | number) => Promise<void>;
  };

  let {
    label,
    value,
    kind = 'text',
    editTitle,
    disabledReason = null,
    validate = undefined,
    required = false,
    maxlength = undefined,
    min = undefined,
    max = undefined,
    step = undefined,
    onCommit,
  }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;

  let open = $state(false);
  let draft = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  let rowEl = $state<HTMLDivElement>();
  let editorEl = $state<HTMLInputElement | HTMLTextAreaElement>();
  let pencilEl = $state<HTMLButtonElement>();

  // Generation guard (spec §1.1): bumped on every open and every close; each
  // continuation captures it immediately before its own await and bails if it
  // moved. It guards error / open-state / focus writes only — never `busy`.
  let gen = 0;
  let alive = true;
  onDestroy(() => { alive = false; });

  function parse(d: string): string | number {
    if (kind === 'number') return d.trim() === '' ? NaN : Number(d);
    return d;
  }
  function same(d: string, v: string | number): boolean {
    return kind === 'number' ? parse(d) === v : d === String(v);
  }
  function msg(e: unknown): string {
    return e instanceof ApiError ? (e.validationErrors()?.[0]?.msg ?? e.displayMessage) : 'Save failed';
  }

  function close() {
    open = false;
    draft = '';
    error = null;
    gen++;
  }

  async function openEditor() {
    if (disabledReason !== null) return;
    open = true;
    draft = String(value);
    error = null;
    const g = ++gen;
    await tick();
    if (g !== gen || !alive || !editorEl) return;
    editorEl.focus();
    // type=number has no selection API (setSelectionRange throws).
    if (kind !== 'number') editorEl.setSelectionRange(draft.length, draft.length);
  }

  async function cancel() {
    close();
    const g = gen;
    await tick();
    if (g !== gen || !alive) return;
    pencilEl?.focus();
  }

  async function commit() {
    error = null;
    if (required && draft.trim() === '') { error = `${label} is required`; return; }
    const parsed = parse(draft);
    if (kind === 'number' && !Number.isFinite(parsed)) { error = 'Enter a number'; return; }
    const invalid = validate?.(parsed) ?? null;
    if (invalid) { error = invalid; return; }
    if (same(draft, value)) { await cancel(); return; }

    busy = true;
    let g = gen;
    let failure: unknown = null;
    let failed = false;
    try {
      await onCommit(parsed);
    } catch (e) {
      failed = true;
      failure = e;
    } finally {
      // Always — a close during the commit must not leave the field read-only.
      if (alive) busy = false;
    }
    if (failed) {
      // Late failure after a close (discard / read-only flip) or an unmount:
      // toast BEFORE the bail, so the failure is never silent (spec §1.1).
      if (g !== gen || !alive) { pushToast(msg(failure), 'error'); return; }
      error = msg(failure);
      g = gen;
      await tick();
      if (g !== gen || !alive) return;
      editorEl?.focus();
      return;
    }
    if (g !== gen || !alive) return; // late success after a close: nothing to do
    close();
    g = gen;
    await tick();
    if (g !== gen || !alive) return;
    pencilEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      // stopPropagation: Slice-6 10a may sit inside an Escape-closing modal.
      e.preventDefault();
      e.stopPropagation();
      if (!busy) void cancel();
      return;
    }
    if (e.key !== 'Enter') return;
    if (kind === 'textarea' && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!busy) void commit();
  }

  // Unsaved registration (D3) — optional: no registry outside the editor.
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = {
    get isDirty() { return open && !same(draft, value); },
    discard() { close(); },
  };
  $effect(() => {
    if (!registry || !open) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  // Read-only flip: tracks ONLY disabledReason + open. Captures happen inside
  // untrack and BEFORE the close — once the editor unmounts, activeElement is
  // <body>. While busy the draft is mid-save, so its own outcome is reported
  // (no "Editing closed" toast).
  $effect(() => {
    if (disabledReason === null || !open) return;
    untrack(() => {
      const hadFocus = !!rowEl && rowEl.contains(document.activeElement);
      const wasDirty = !busy && !same(draft, value);
      close();
      if (wasDirty) pushToast('Editing closed — this version is no longer editable', 'info');
      if (!hadFocus) return;
      const g = gen;
      void tick().then(() => { if (g === gen && alive) rowEl?.focus(); });
    });
  });
</script>

<div
  class="inline-field"
  class:open
  class:ta={kind === 'textarea'}
  bind:this={rowEl}
  tabindex="-1"
  role="group"
  aria-labelledby={labelId}
>
  <span class="label" id={labelId}>{label}</span>
  {#if open}
    <div class="editor">
      {#if kind === 'textarea'}
        <textarea
          bind:this={editorEl}
          class="mono"
          rows="3"
          value={draft}
          readonly={busy}
          {maxlength}
          aria-labelledby={labelId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${hintId} ${errId}` : hintId}
          oninput={(e) => { draft = e.currentTarget.value; error = null; }}
          onkeydown={onKeydown}
        ></textarea>
        <span class="sr-only" id={hintId}>Press Control or Command plus Enter to save, Escape to cancel</span>
      {:else}
        <input
          bind:this={editorEl}
          class:mono={kind === 'number'}
          type={kind === 'number' ? 'number' : 'text'}
          value={draft}
          readonly={busy}
          maxlength={kind === 'text' ? maxlength : undefined}
          min={kind === 'number' ? min : undefined}
          max={kind === 'number' ? max : undefined}
          step={kind === 'number' ? step : undefined}
          aria-labelledby={labelId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errId : undefined}
          oninput={(e) => { draft = e.currentTarget.value; error = null; }}
          onkeydown={onKeydown}
        />
      {/if}
      {#if error}<p class="err" role="alert" id={errId}>{error}</p>{/if}
    </div>
    <div class="slot">
      <IconButton size="sm" glyph="close" title="Cancel" aria-label="Cancel editing {label}" disabled={busy} onclick={() => { if (!busy) void cancel(); }} />
      <IconButton size="sm" glyph="check" primary title="Save" aria-label="Save {label}" disabled={busy} onclick={() => { if (!busy) void commit(); }} />
    </div>
  {:else}
    <span class="value">
      {#if value === ''}<span class="not-set">Not set</span>{:else if kind === 'number'}<span class="mono">{value}</span>{:else}{value}{/if}
    </span>
    <div class="slot">
      <!-- Disabled while a discarded commit is still in flight: reopening then
           would seed the draft from the pre-save value (a stale re-PATCH). -->
      <IconButton
        size="sm"
        glyph="pencil"
        title={disabledReason ?? editTitle}
        aria-label={editTitle}
        disabled={disabledReason !== null || busy}
        onclick={() => void openEditor()}
        bind:element={pencilEl}
      />
    </div>
  {/if}
</div>

<style>
  /* ref 1537-1551. The 54px action column is fixed in BOTH states, so opening
     never shifts the value column and the check lands where the pencil was. */
  .inline-field {
    display: grid;
    grid-template-columns: 132px 1fr 54px; /* ref 1537 */
    gap: 12px; /* ref 1537 */
    align-items: baseline; /* ref 1537 */
    padding: 9px 0; /* ref 1537 */
    border-bottom: 1px solid var(--border-soft);
  }
  .inline-field.open { align-items: start; /* ref 1543 */ }
  .label { font-size: 12.5px; /* ref 1538 */ color: var(--muted); }
  /* (b) form: centres the ~18px label line on the 30px --control-h field. */
  .open .label { padding-top: 6px; }
  .open.ta .label { padding-top: 9px; /* ref 1543 */ }
  .value {
    min-width: 0; /* (c): lets a long unbroken token wrap instead of widening the 1fr track */
    font-size: 13px; /* ref 1539 */
    line-height: 1.55; /* ref 1539 */
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .not-set { color: var(--muted); }
  .slot { display: flex; justify-content: flex-end; gap: 6px; /* ref 1546 */ align-self: center; /* ref 1540 */ }
  /* (b) form: centres a 24px button on the 30px field. */
  .open .slot { align-self: start; padding-top: 3px; }
  .open.ta .slot { padding-top: 7px; /* ref 1546 */ }
  .editor { position: relative; /* (c): anchors the sr-only hint */ min-width: 0; }
  .editor input,
  .editor textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1.5px solid var(--primary); /* ref 1544 */
    border-radius: var(--radius);
    box-shadow: 0 0 0 3px var(--primary-soft); /* ref 1544 */
    background: var(--surface);
    color: var(--text-2);
    font-size: 13px; /* ref 1544 */
  }
  .editor input { height: var(--control-h); padding: 0 10px; /* ref 1544 */ }
  .editor textarea { padding: 8px 10px; /* ref 1544 */ line-height: 1.6; /* ref 1544 */ resize: vertical; }
  .err { margin: var(--space-1) 0 0; font-size: 12.5px; /* the 12.5px meta step */ color: var(--danger); }
  /* Visually hidden, still announced (no global .sr-only class exists). No
     opacity — the gate sweeps for it. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
</style>
