<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { runAssetContext } from '../../lib/assetContext';
  import { localInputToISO, isoToLocalInput, localTzLabel } from '../../lib/datetime';
  import { createMiniProject, updateMiniProject, publishMiniProject } from '../../lib/miniProjects';
  import MarkdownEditor from '../editor/MarkdownEditor.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { MiniProjectResponse, BlockResponse, ValidationErrorDetail } from '../../lib/types';

  let {
    runId,
    mode,
    initial,
    availableBlocks,
    currentBlock,
    runIsPublished,
    versionIsDisabled,
    runEndDate,
    onClose,
    onSaved,
    onNavigateToTab,
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

  // Publish flow (T6b). publishCheckResult lists unmet preconditions per spec
  // §"Validation" lines 491-510. Each bullet has optional `field` — when set,
  // the bullet's rendered <li> gets a stable ID and the corresponding form
  // input adds it to aria-describedby (spec line 512). Bullets containing
  // "Open Overview" render with that substring as a link to
  // onNavigateToTab('overview'). publishAttempted flips on the first Publish
  // click so the "Cannot publish" banner only appears after the user tries.
  // pendingPublishConfirm renders the InlineConfirm row. publishing flips
  // while POST is in flight (drives the "Publishing…" button label and is
  // distinct from save-submitting so the Save label stays "Save").
  type FieldKey = 'assignment_md' | 'soft_deadline' | 'hard_deadline' | 'resubmission_deadline';
  type PreconditionBullet = { text: string; field?: FieldKey };

  let publishAttempted = $state(false);
  let pendingPublishConfirm = $state(false);
  let publishing = $state(false);

  const publishCheckResult = $derived.by((): PreconditionBullet[] | null => {
    if (mode !== 'edit' || initial?.is_published) return null;
    const unmet: PreconditionBullet[] = [];
    // Spec lines 491-497: "For Publish, ALL of the above PLUS" — the full
    // Save validation re-runs here so empty assignment_md / inverted
    // ordering surface BEFORE any network call.
    if (!formData.assignment_md.trim()) {
      unmet.push({ text: 'Assignment text is required', field: 'assignment_md' });
    }
    if (formData.soft_local && formData.hard_local) {
      if (new Date(localInputToISO(formData.soft_local)) > new Date(localInputToISO(formData.hard_local))) {
        unmet.push({ text: 'Soft deadline must be before hard deadline', field: 'soft_deadline' });
      }
    }
    if (formData.hard_local && formData.resub_local) {
      if (new Date(localInputToISO(formData.hard_local)) > new Date(localInputToISO(formData.resub_local))) {
        unmet.push({ text: 'Hard deadline must be before resubmission deadline', field: 'hard_deadline' });
      }
    }
    if (!formData.hard_local) {
      unmet.push({ text: 'Hard deadline must be set', field: 'hard_deadline' });
    }
    if (!formData.resub_local) {
      unmet.push({ text: 'Resubmission deadline must be set', field: 'resubmission_deadline' });
    }
    if (formData.hard_local) {
      const hardIso = localInputToISO(formData.hard_local);
      // Spec line 499: client-side proactive "hard in future" warning.
      if (new Date(hardIso) <= new Date()) {
        unmet.push({ text: 'Hard deadline must be in the future', field: 'hard_deadline' });
      }
      if (runEndDate === null) {
        unmet.push({ text: 'Run end date must be set — Open Overview to set it.', field: 'hard_deadline' });
      } else if (hardIso > `${runEndDate}T23:59:59Z`) {
        unmet.push({ text: `Hard deadline must be before run end (${runEndDate})`, field: 'hard_deadline' });
      }
    }
    if (formData.resub_local && runEndDate !== null) {
      const resubIso = localInputToISO(formData.resub_local);
      if (resubIso > `${runEndDate}T23:59:59Z`) {
        unmet.push({
          text: `Resubmission deadline must be before run end (${runEndDate})`,
          field: 'resubmission_deadline',
        });
      }
    }
    if (!runIsPublished) {
      unmet.push({ text: 'Run must be published — Open Overview to publish.' });
    }
    // Spec line 548: versionIsDisabled blocks the modal-only publish. Without
    // this check, a modal already open when versionIsDisabled flips to true
    // could still publish; T7 disables row [Edit] only.
    if (versionIsDisabled) {
      unmet.push({ text: "This run's course version is disabled — Open Overview to re-enable it." });
    }
    // T9-smoke catch: the publish backend reads deadlines from the persisted
    // MP, but every other check above reads `formData` (the unsaved inputs).
    // If the user fills deadlines and clicks Publish without Save, the
    // form-side checks pass while the backend rejects with "hard_deadline
    // required at publish". Gate Publish on `!dirty` so the user is told to
    // save first.
    if (dirty) {
      unmet.push({ text: 'Save your changes before publishing.' });
    }
    return unmet;
  });

  // Stable bullet IDs grouped by field, used for aria-describedby on inputs.
  // Banner is only rendered when publishAttempted is true, so the IDs only
  // exist in the DOM then — but computing them unconditionally is fine; the
  // input attribute is set to undefined when no IDs apply.
  const preconditionIdsByField = $derived.by((): Record<string, string> => {
    const result: Record<string, string[]> = {};
    if (!publishAttempted || !publishCheckResult) return {};
    publishCheckResult.forEach((b, idx) => {
      if (b.field) {
        const id = `precondition-${idx}`;
        (result[b.field] ??= []).push(id);
      }
    });
    return Object.fromEntries(Object.entries(result).map(([k, ids]) => [k, ids.join(' ')]));
  });

  function ariaDescribedFor(field: FieldKey): string | undefined {
    const ids: string[] = [];
    if (fieldErrors[field]) ids.push(`err-${field}`);
    if (preconditionIdsByField[field]) ids.push(preconditionIdsByField[field]);
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  function handlePublishClick() {
    if (submitting) return;
    publishAttempted = true;
    if (publishCheckResult && publishCheckResult.length > 0) return;
    pendingPublishConfirm = true;
  }

  async function confirmPublish() {
    pendingPublishConfirm = false;
    // Re-check preconditions: versionIsDisabled (or runIsPublished, etc.) may
    // have flipped from the parent between Publish-click and confirm-click.
    if (publishCheckResult && publishCheckResult.length > 0) {
      publishAttempted = true;
      return;
    }
    if (submitting) return;
    submitting = true;
    publishing = true;
    serverError = null;
    try {
      await publishMiniProject(initial!.id);
      if (!mounted) return;
      await onSaved();
      if (!mounted) return;
      onClose();
    } catch (e: unknown) {
      if (!mounted) return;
      if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        const eo = e as { message?: unknown } | null | undefined;
        serverError = typeof eo?.message === 'string' ? eo.message : 'Publish failed';
      }
    } finally {
      if (mounted) {
        submitting = false;
        publishing = false;
      }
    }
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
        // T9 smoke catch: the MP is gone server-side; the parent's list still
        // shows the stale row until something refetches. Fire the same
        // refetch callback the save-success path uses so the list reflects
        // reality by the time the user clicks Discard.
        void onSaved();
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
        aria-describedby={ariaDescribedFor('soft_deadline')}
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
        aria-describedby={ariaDescribedFor('hard_deadline')}
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
        aria-describedby={ariaDescribedFor('resubmission_deadline')}
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
      ariaDescribedby={ariaDescribedFor('assignment_md')}
    />
    {#if fieldErrors.assignment_md}
      <span id="err-assignment_md" class="field-error" role="alert">{fieldErrors.assignment_md}</span>
    {/if}
    {#if serverError}
      <div class="banner banner-error" role="alert">{serverError}</div>
    {/if}
    {#if publishAttempted && publishCheckResult && publishCheckResult.length > 0}
      <div class="banner banner-error precondition-banner" data-testid="publish-preconditions" role="alert">
        <p>Cannot publish:</p>
        <ul>
          {#each publishCheckResult as bullet, idx (bullet.text)}
            {#if bullet.text.includes('Open Overview')}
              {@const linkIdx = bullet.text.indexOf('Open Overview')}
              <li id={`precondition-${idx}`}>
                {bullet.text.slice(0, linkIdx)}<button
                  type="button"
                  class="linklike"
                  data-action="publish-nav-overview"
                  onclick={() => onNavigateToTab('overview')}>Open Overview</button
                >{bullet.text.slice(linkIdx + 'Open Overview'.length)}
              </li>
            {:else}
              <li id={`precondition-${idx}`}>{bullet.text}</li>
            {/if}
          {/each}
        </ul>
      </div>
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
    {:else if pendingPublishConfirm}
      <InlineConfirm
        warning="Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions)."
        confirmLabel="Publish"
        confirmDataAction="confirm-publish"
        onCancel={() => {
          pendingPublishConfirm = false;
        }}
        onConfirm={confirmPublish}
      />
    {:else}
      <button type="button" onclick={closeForCurrentStage}>Cancel</button>
      <button type="button" data-action="save" disabled={submitting || !!saveError} onclick={handleSave}>
        {submitting && !publishing ? 'Saving…' : 'Save'}
      </button>
      {#if mode === 'edit' && initial && !initial.is_published}
        <button type="button" data-action="publish" disabled={submitting} onclick={handlePublishClick}>
          {publishing ? 'Publishing…' : 'Publish…'}
        </button>
      {/if}
    {/if}
  </footer>
</div>

<style>
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    box-sizing: border-box;
    width: min(1100px, 95vw);
    max-height: 90vh;
    overflow: auto;
    background: var(--surface, white);
    border-radius: var(--radius, 8px);
    padding: var(--space-4, 24px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    z-index: 101;
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
    z-index: 100;
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
  .precondition-banner ul { margin: var(--space-1) 0 0 var(--space-3); padding: 0; }
  .linklike {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .linklike:hover { text-decoration: none; }
  /* The 880px responsive-stack rule belongs on MarkdownEditor's `.edit-content`
     (textarea + sidebar split) — see `MarkdownEditor.svelte`'s media query.
     The modal `.body` is already a single-column flow; an @media on it would
     be a no-op. Codex T6a round-1 caught the misleading placement. */
</style>
