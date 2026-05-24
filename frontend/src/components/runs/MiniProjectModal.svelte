<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { runAssetContext } from '../../lib/assetContext';
  import { localInputToISO, isoToLocalInput, localTzLabel } from '../../lib/datetime';
  import { createMiniProject, updateMiniProject } from '../../lib/miniProjects';
  import MarkdownEditor from '../editor/MarkdownEditor.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { MiniProjectResponse, BlockResponse, ValidationErrorDetail } from '../../lib/types';

  let {
    runId,
    mode,
    initial,
    availableBlocks,
    currentBlock,
    runIsPublished: _runIsPublished,
    versionIsDisabled: _versionIsDisabled,
    runEndDate: _runEndDate,
    onClose,
    onSaved,
    onNavigateToTab: _onNavigateToTab,
  }: {
    runId: number;
    mode: 'create' | 'edit';
    initial: MiniProjectResponse | null;
    availableBlocks: BlockResponse[];
    currentBlock: BlockResponse | null;
    runIsPublished: boolean;
    versionIsDisabled: boolean;
    runEndDate: string | null;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
  } = $props();

  const assetContext = $derived(runAssetContext(runId));

  // The modal is `{#if modalMode != null}`-gated by the parent: it unmounts
  // and remounts whenever mode/initial/availableBlocks change, so a one-shot
  // snapshot of the initial-mount values is the intended contract. Reading
  // the props through these locals (instead of the $state initializer
  // directly) avoids Svelte 5's `state_referenced_locally` warning while
  // preserving the "stable per mount" semantic.
  const initialBlockId = initial?.block_id ?? availableBlocks[0]?.id ?? null;
  const initialSoftLocal = initial?.soft_deadline ? isoToLocalInput(initial.soft_deadline) : '';
  const initialHardLocal = initial?.hard_deadline ? isoToLocalInput(initial.hard_deadline) : '';
  const initialResubLocal = initial?.resubmission_deadline
    ? isoToLocalInput(initial.resubmission_deadline)
    : '';
  const initialAssignmentMd = initial?.assignment_md ?? '';

  let formData = $state({
    block_id: initialBlockId,
    soft_local: initialSoftLocal,
    hard_local: initialHardLocal,
    resub_local: initialResubLocal,
    assignment_md: initialAssignmentMd,
  });

  let submitting = $state(false);
  let mounted = $state(false);
  let uploadAbortController = $state<AbortController | null>(null);

  function currentFormSnapshot() {
    return {
      block_id: formData.block_id ?? null,
      soft_local: formData.soft_local,
      hard_local: formData.hard_local,
      resub_local: formData.resub_local,
      assignment_md: formData.assignment_md,
    };
  }
  // Initialized inline at module-init time (after formData) so the dirty
  // $derived sees a defined snapshot on first evaluation. Setting this in
  // onMount would leave dirty stale until the first formData mutation.
  const initialFormSnapshot = currentFormSnapshot();

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeForCurrentStage();
    }
  }

  onMount(() => {
    mounted = true;
    window.addEventListener('keydown', onWindowKeydown);
  });
  onDestroy(() => {
    mounted = false;
    window.removeEventListener('keydown', onWindowKeydown);
  });

  let pendingClose = $state(false);
  let discarding = $state(false);

  const tzLabel = $derived(localTzLabel());
  const dirty = $derived(
    JSON.stringify(currentFormSnapshot()) !== JSON.stringify(initialFormSnapshot),
  );

  function closeForCurrentStage() {
    if (submitting) return;
    if (dirty && !pendingClose && !discarding) {
      pendingClose = true;
      return;
    }
    uploadAbortController?.abort();
    onClose();
    discarding = false;
  }

  function confirmDiscard() {
    discarding = true;
    pendingClose = false;
    closeForCurrentStage();
  }

  const saveError = $derived.by((): string | null => {
    if (mode === 'create' && formData.block_id == null) {
      return 'No available blocks to assign — every block already has a mini-project';
    }
    if (!formData.assignment_md.trim()) return 'Assignment text is required';
    if (formData.soft_local && formData.hard_local) {
      if (new Date(localInputToISO(formData.soft_local)) > new Date(localInputToISO(formData.hard_local))) {
        return 'Soft deadline must be before hard deadline';
      }
    }
    if (formData.hard_local && formData.resub_local) {
      if (new Date(localInputToISO(formData.hard_local)) > new Date(localInputToISO(formData.resub_local))) {
        return 'Hard deadline must be before resubmission deadline';
      }
    }
    return null;
  });

  let serverError = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});

  function mapValidationErrors(details: ValidationErrorDetail[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of details) {
      const segs = d.loc.filter((s): s is string => typeof s === 'string');
      const key = segs.length > 0 ? segs[segs.length - 1] : '_';
      if (!(key in out)) out[key] = d.msg;
    }
    return out;
  }

  async function handleSave() {
    if (saveError) return;
    submitting = true;
    serverError = null;
    fieldErrors = {};
    try {
      const body = {
        block_id: formData.block_id!,
        assignment_md: formData.assignment_md,
        soft_deadline: formData.soft_local ? localInputToISO(formData.soft_local) : null,
        hard_deadline: formData.hard_local ? localInputToISO(formData.hard_local) : null,
        resubmission_deadline: formData.resub_local ? localInputToISO(formData.resub_local) : null,
      };
      if (mode === 'create') {
        await createMiniProject(runId, body);
      } else {
        const { block_id: _block_id, ...patchBody } = body;
        await updateMiniProject(initial!.id, patchBody);
      }
      if (!mounted) return;
      await onSaved();
      if (!mounted) return;
      onClose();
    } catch (e: unknown) {
      if (!mounted) return;
      if (e instanceof ApiError && e.status === 404) {
        serverError =
          'This mini-project has been deleted. Select-all (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C) from the assignment textarea if you want to preserve your work before closing.';
      } else if (e instanceof ApiError && e.status === 409) {
        serverError = `${e.displayMessage} Refresh the page to see latest.`;
      } else if (e instanceof ApiError && e.status === 422) {
        const details = e.validationErrors();
        if (details) fieldErrors = mapValidationErrors(details);
        serverError = e.displayMessage;
      } else if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        const eo = e as { message?: unknown } | null | undefined;
        serverError = typeof eo?.message === 'string' ? eo.message : 'Save failed';
      }
    } finally {
      if (mounted) submitting = false;
    }
  }
</script>

<div class="backdrop" data-role="backdrop" onclick={closeForCurrentStage} role="presentation"></div>
<div class="modal" role="dialog" aria-modal="true">
  <header>
    <h2>
      {mode === 'create'
        ? 'New mini-project'
        : `Edit — Block ${currentBlock?.order ?? '?'} — ${currentBlock?.title ?? ''}`}
    </h2>
    <button type="button" data-action="close-x" onclick={closeForCurrentStage} aria-label="Close">×</button>
  </header>
  <div class="body">
    {#if mode === 'create'}
      <label>
        Block
        <select
          bind:value={formData.block_id}
          disabled={submitting}
          aria-describedby={fieldErrors.block_id ? 'err-block_id' : undefined}
        >
          {#each availableBlocks as b (b.id)}
            <option value={b.id}>Block {b.order} — {b.title}</option>
          {/each}
        </select>
      </label>
      {#if fieldErrors.block_id}
        <span id="err-block_id" class="field-error" role="alert">{fieldErrors.block_id}</span>
      {/if}
    {/if}
    <label>
      Soft deadline {tzLabel}
      <input
        type="datetime-local"
        bind:value={formData.soft_local}
        disabled={submitting}
        aria-describedby={fieldErrors.soft_deadline ? 'err-soft_deadline' : undefined}
      />
    </label>
    {#if fieldErrors.soft_deadline}
      <span id="err-soft_deadline" class="field-error" role="alert">{fieldErrors.soft_deadline}</span>
    {/if}
    <label>
      Hard deadline {tzLabel}
      <input
        type="datetime-local"
        bind:value={formData.hard_local}
        disabled={submitting}
        aria-describedby={fieldErrors.hard_deadline ? 'err-hard_deadline' : undefined}
      />
    </label>
    {#if fieldErrors.hard_deadline}
      <span id="err-hard_deadline" class="field-error" role="alert">{fieldErrors.hard_deadline}</span>
    {/if}
    <label>
      Resubmission deadline {tzLabel}
      <input
        type="datetime-local"
        bind:value={formData.resub_local}
        disabled={submitting}
        aria-describedby={fieldErrors.resubmission_deadline ? 'err-resubmission_deadline' : undefined}
      />
    </label>
    {#if fieldErrors.resubmission_deadline}
      <span id="err-resubmission_deadline" class="field-error" role="alert"
        >{fieldErrors.resubmission_deadline}</span
      >
    {/if}
    <MarkdownEditor
      {assetContext}
      bind:value={formData.assignment_md}
      disabled={submitting}
      bind:uploadAbortController
      ariaDescribedby={fieldErrors.assignment_md ? 'err-assignment_md' : undefined}
    />
    {#if fieldErrors.assignment_md}
      <span id="err-assignment_md" class="field-error" role="alert">{fieldErrors.assignment_md}</span>
    {/if}
    {#if serverError}
      <div class="banner banner-error" role="alert">{serverError}</div>
    {/if}
  </div>
  <footer>
    {#if pendingClose}
      <InlineConfirm
        warning="Discard unsaved changes?"
        confirmLabel="Discard"
        confirmDataAction="confirm-discard"
        onCancel={() => {
          pendingClose = false;
        }}
        onConfirm={confirmDiscard}
      />
    {:else}
      <button type="button" onclick={closeForCurrentStage}>Cancel</button>
      <button type="button" data-action="save" disabled={submitting || !!saveError} onclick={handleSave}>
        {submitting ? 'Saving…' : 'Save'}
      </button>
      <!-- [Publish…] stub — T6b implements -->
    {/if}
  </footer>
</div>

<style>
  .modal {
    max-width: 1100px;
    max-height: 90vh;
    overflow: auto;
  }
  .modal > header {
    position: sticky;
    top: 0;
    background: inherit;
    z-index: 1;
  }
  .modal > footer {
    position: sticky;
    bottom: 0;
    background: inherit;
    z-index: 1;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
  }
  .field-error {
    color: var(--err, #a33);
    font-size: 0.85em;
  }
  .banner-error {
    background: #fdecea;
    border-left: 3px solid #c62828;
    color: #7c1f1f;
    padding: var(--space-2);
  }
  /* The 880px responsive-stack rule belongs on MarkdownEditor's `.edit-content`
     (textarea + sidebar split) — see `MarkdownEditor.svelte`'s media query.
     The modal `.body` is already a single-column flow; an @media on it would
     be a no-op. Codex T6a round-1 caught the misleading placement. */
</style>
