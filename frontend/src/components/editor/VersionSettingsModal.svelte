<script lang="ts">
  // Version settings (Slice-5c D12): Label, Info and Max quiz attempts in the
  // 5b modal frame with one footer Save. Read-only outside "created" (the
  // values as text, no footer). Save sends ONE PATCH with the changed fields
  // (VersionUpdate accepts any subset). R2: Info is a plain textarea.
  import { getContext, onDestroy, untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import AskSlot from '../ui/AskSlot.svelte';
  import { DISCARD_ASK, focusAfter, modalClose, useModalAsk } from '../../lib/askInPlace.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import type { AdminTreeVersion } from '../../lib/types';

  type Props = {
    vid: number;
    version: AdminTreeVersion;
    editable: boolean;
    stillOnVid: (vid: number) => boolean;
    onClose: () => void;
  };
  let { vid, version, editable, stillOnVid, onClose }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;
  const attemptsErrId = `${uid}-attempts-err`;
  const labelErrId = `${uid}-label-err`;
  // Seeded once per open (the modal mounts per open).
  const initial = untrack(() => ({ label: version.label, info: version.info_md, attempts: String(version.max_quiz_attempts) }));
  let label = $state(initial.label);
  let info = $state(initial.info);
  // A string draft (no bind: on type=number, which would coerce it to a number).
  let attempts = $state(initial.attempts);
  let attemptsError = $state<string | null>(null);
  let labelError = $state<string | null>(null);
  let globalError = $state<string | null>(null);
  let saving = $state(false);
  let alive = true;
  onDestroy(() => { alive = false; });

  const dirty = $derived(editable && (label !== initial.label || info !== initial.info || attempts !== initial.attempts));

  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = { get isDirty() { return dirty; }, discard() { onClose(); } };
  $effect(() => {
    if (!registry) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  // Polish 1: the close question in place of the footer buttons (#10), and the
  // page question while this is the top modal (R46). Read-only, there is no
  // footer: the page question asks at the top of the body, with nothing to freeze.
  const { own: footAsk, page, here } = useModalAsk(labelId);
  const asking = $derived(footAsk.open || here());

  async function requestClose() {
    if (saving) return;
    // × and Esc while a question shows: back to its Cancel (R48).
    if (footAsk.open) { footAsk.focusCancel(); return; }
    if (here()) { page!.ask.focusCancel(); return; }
    if (!dirty) { onClose(); return; }
    const a = await footAsk.ask(DISCARD_ASK);
    if (a === 'confirm') {
      footAsk.settle();
      if (alive) onClose();
      return;
    }
    if (a === 'cancel') void focusAfter(() => modalClose(labelId));
  }

  function discard() {
    label = initial.label; info = initial.info; attempts = initial.attempts;
    attemptsError = null; labelError = null; globalError = null;
  }

  // Enter in a one-line field saves, as the old card did: the footer Save sits
  // in the modal frame, so there is no form to submit (Info keeps its newline).
  function onEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    void save();
  }

  async function save() {
    if (!dirty || saving) return;
    // The label is mandatory (user, 2026-10-08): it can't be cleared.
    if (label.trim() === '') {
      labelError = 'Label is required';
      return;
    }
    const n = Number(attempts);
    if (!(attempts.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 10)) {
      attemptsError = 'Max quiz attempts must be a whole number between 1 and 10';
      return;
    }
    const body: Record<string, unknown> = {};
    if (label !== initial.label) body.label = label;
    if (info !== initial.info) body.info_md = info;
    if (attempts !== initial.attempts) body.max_quiz_attempts = n;
    const savedVid = vid;
    globalError = null;
    saving = true;
    try {
      await api.patch(`/api/versions/${savedVid}`, body);
    } catch (e) {
      if (alive) {
        saving = false;
        globalError = e instanceof ApiError ? (e.validationErrors()?.[0]?.msg ?? e.displayMessage) : 'Save failed';
      } else {
        pushToast('Save failed', 'error');
      }
      return;
    }
    // The PATCH landed: say so even when the page moved to another version
    // meanwhile; only the refresh is skipped then.
    const r = stillOnVid(savedVid) ? await loadAdminTree(savedVid, { force: true }) : 'ok';
    pushToast(r === 'error' ? 'Saved (refresh failed — reload to see latest)' : 'Saved', r === 'error' ? 'info' : 'success');
    if (alive) { saving = false; onClose(); }
  }
</script>

{#snippet head()}
  <h2 id={labelId} class="nm">Version settings</h2>
{/snippet}

{#snippet foot()}
  <span class="dirty mono">{dirty ? 'unsaved changes' : ''}</span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={!dirty || saving} onclick={discard}>Discard</Button>
    <Button variant="primary" disabled={!dirty || saving} loading={saving} onclick={() => void save()}>Save</Button>
  {/if}
{/snippet}

<Modal labelledby={labelId} width={640} maxHeight={600} onRequestClose={() => void requestClose()} closeDisabled={saving}
  bodyInert={editable && asking} header={head} footer={editable ? foot : undefined}>
  {#if !editable && here()}
    <AskSlot ask={page!.ask} />
  {/if}
  {#if editable}
    <div class="form">
      <!-- top + line: the label stays level with the input when the error shows below it. -->
      <div class="field-row top line">
        <span class="field-label">Label</span>
        <div class="field">
          <input class="plain-input" data-autofocus aria-label="Label" maxlength={200} required bind:value={label} readonly={saving}
            aria-invalid={labelError ? 'true' : undefined}
            aria-describedby={labelError ? labelErrId : undefined}
            oninput={() => { labelError = null; }} onkeydown={onEnter} />
          {#if labelError}<small id={labelErrId} class="field-err">{labelError}</small>{/if}
        </div>
      </div>
      <div class="field-row top">
        <span class="field-label">Info</span>
        <textarea class="plain-input mono ta" rows="6" aria-label="Info (markdown)" bind:value={info} readonly={saving}></textarea>
      </div>
      <!-- top + line: the label stays level with the input when the error shows below it. -->
      <div class="field-row top line">
        <span class="field-label">Max quiz attempts</span>
        <div class="field">
          <input class="plain-input num mono" type="number" min="1" max="10" step="1" aria-label="Max quiz attempts"
            value={attempts} readonly={saving}
            aria-invalid={attemptsError ? 'true' : undefined}
            aria-describedby={attemptsError ? attemptsErrId : undefined}
            oninput={(e) => { attempts = e.currentTarget.value; attemptsError = null; }} onkeydown={onEnter} />
          {#if attemptsError}<small id={attemptsErrId} class="field-err">{attemptsError}</small>{/if}
        </div>
      </div>
      {#if globalError}<p class="field-err" role="alert">{globalError}</p>{/if}
    </div>
  {:else}
    <dl class="ro">
      <dt>Label</dt><dd>{#if version.label}{version.label}{:else}<span class="not-set">Not set</span>{/if}</dd>
      <dt>Info</dt><dd class="pre">{#if version.info_md}{version.info_md}{:else}<span class="not-set">Not set</span>{/if}</dd>
      <dt>Max quiz attempts</dt><dd class="mono">{version.max_quiz_attempts}</dd>
    </dl>
  {/if}
</Modal>

<style>
  /* Fills the head row, so Modal's × sits at the far right (as NewItemModal's .ctx). */
  .nm { flex: 1 1 auto; margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .form { display: flex; flex-direction: column; gap: 12px; }
  /* The 5b item-modal field look (ItemEditorModal .field-row / .plain-input). */
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; }
  .field-row.top { align-items: start; }
  .field-row.top .field-label { padding-top: 7px; }
  .field-row.top.line .field-label { padding-top: 0; line-height: var(--control-h); }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .plain-input {
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
  .plain-input.ta { height: auto; padding: 8px var(--control-pad-x); line-height: 1.6; resize: vertical; }
  .plain-input.num { width: 96px; }
  .plain-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); }
  /* Fills the footer's left, pushing Discard / Save right (the item editor's slot). */
  .dirty { margin-right: auto; font-size: 12px; color: var(--muted); }
  .ro { display: grid; grid-template-columns: 132px 1fr; gap: 10px 12px; margin: 0; }
  .ro dt { font-size: 12.5px; color: var(--muted); }
  .ro dd { margin: 0; font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .ro .pre { white-space: pre-wrap; }
  .not-set { color: var(--muted); }
</style>
