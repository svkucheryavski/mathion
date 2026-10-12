<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { runAssetContext } from '../../lib/assetContext';
  import { localInputToISO, isoToLocalInput, localTzLabel } from '../../lib/datetime';
  import { createMiniProject, updateMiniProject, publishMiniProject } from '../../lib/miniProjects';
  import { blockPositions } from '../../lib/blockNumbers';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import MarkdownEditor from '../editor/MarkdownEditor.svelte';
  import DirtyGuard from '../editor/DirtyGuard.svelte';
  import Button from '../ui/Button.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import Modal from '../ui/Modal.svelte';
  import type { Course, MiniProjectResponse, BlockResponse, ValidationErrorDetail } from '../../lib/types';

  let {
    runId,
    mode,
    initial,
    availableBlocks,
    currentBlock,
    runIsPublished,
    versionIsDisabled,
    runEndDate,
    course,
    blocks = [],
    onClose,
    onSaved,
    onCreated = undefined,
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
    course: Course;
    // R21 / P4: the pinned version's blocks, for position numbers. Without
    // them the "Block {n} — " prefix drops.
    blocks?: BlockResponse[];
    onClose: () => void;
    onSaved: () => Promise<void>;
    // Create hands the new mini-project over before the refresh, so the tab
    // can focus its row once the modal closes (§Focus › After Create).
    onCreated?: (mp: MiniProjectResponse) => void;
    onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
  } = $props();

  const uid = $props.id();
  const assetContext = $derived(runAssetContext(runId));
  const UPLOAD_WAIT = 'Wait for the upload to finish';
  // R23: "GMT+2", without localTzLabel's parentheses.
  const zone = localTzLabel().slice(1, -1);

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
  let uploading = $state(false);
  let uploadAbortController = $state<AbortController | null>(null);
  let titleEl = $state<HTMLElement>();
  let publishEl = $state<HTMLButtonElement>();

  function currentFormSnapshot() {
    return {
      block_id: formData.block_id ?? null,
      soft_local: formData.soft_local,
      hard_local: formData.hard_local,
      resub_local: formData.resub_local,
      assignment_md: formData.assignment_md,
    };
  }
  // D19: the saved values the form compares against. An edit Save re-bases it
  // to the values it sent: the fields were frozen, so they equal the screen.
  let baseline = $state(currentFormSnapshot());

  onMount(() => {
    mounted = true;
  });
  onDestroy(() => {
    mounted = false;
  });

  let pendingClose = $state(false);
  let pendingPublishConfirm = $state(false);
  let publishing = $state(false);

  const dirty = $derived(JSON.stringify(currentFormSnapshot()) !== JSON.stringify(baseline));
  const saving = $derived(submitting && !publishing);
  const confirmOpen = $derived(pendingClose || pendingPublishConfirm);

  // R21: blocks are numbered by position; a block missing from `blocks` drops the prefix.
  const positions = $derived(blockPositions(blocks));
  function blockLabel(b: BlockResponse): string {
    const n = positions.get(b.id);
    return n === undefined ? b.title : `Block ${n} — ${b.title}`;
  }
  const heading = $derived(
    mode === 'create'
      ? 'New mini-project'
      : currentBlock
        ? `Edit — ${blockLabel(currentBlock)}`
        : 'Edit mini-project',
  );

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
  // §"Validation" lines 491-510, computed from the values on screen. Each
  // bullet has optional `field` — when set, the bullet's <li> gets a stable ID
  // and the corresponding input adds it to aria-describedby (spec line 512).
  // Bullets containing "Open Overview" render that substring as a link to
  // onNavigateToTab('overview'). D13: the box shows up front whenever a
  // precondition is unmet. `adminOnly` flags a bullet whose "Open Overview" affordance only a
  // course admin can act on; for a teacher it renders as plain text.
  // Spec §6.2 RunMiniProjectsTab + MiniProjectModal teacher-gating.
  type FieldKey = 'assignment_md' | 'soft_deadline' | 'hard_deadline' | 'resubmission_deadline';
  type PreconditionBullet = { text: string; field?: FieldKey; adminOnly?: boolean };

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
      unmet.push({ text: 'Run must be published — Open Overview to publish.', adminOnly: true });
    }
    // Spec line 548: versionIsDisabled blocks the modal-only publish, even for
    // a modal already open when it flips.
    if (versionIsDisabled) {
      unmet.push({ text: "This run's course version is disabled — Open Overview to re-enable it.", adminOnly: true });
    }
    // R22: unsaved edits are not a bullet. The backend publishes the persisted
    // mini-project, so Publish is disabled while dirty ("Save your changes
    // first") and the confirm's recheck refuses while dirty.
    return unmet;
  });

  // D13 / D21: the box shows while editing an unpublished mini-project with an
  // unmet precondition, computed from the values on screen.
  const boxShows = $derived(!!publishCheckResult && publishCheckResult.length > 0);

  // R20: when reasons overlap the first wins; a loading button ignores them.
  const saveReason = $derived(uploading ? UPLOAD_WAIT : (saveError ?? (dirty ? null : 'No changes to save')));
  const discardReason = $derived(dirty ? null : 'No changes to discard');
  const publishReason = $derived(
    uploading
      ? UPLOAD_WAIT
      : boxShows
        ? 'Resolve the listed preconditions first'
        : dirty
          ? 'Save your changes first'
          : null,
  );

  // Stable bullet IDs grouped by field, used for aria-describedby on inputs.
  const preconditionIdsByField = $derived.by((): Record<string, string> => {
    const result: Record<string, string[]> = {};
    if (!boxShows || !publishCheckResult) return {};
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

  const DEADLINES = [
    { field: 'soft_deadline', local: 'soft_local', label: 'Soft deadline' },
    { field: 'hard_deadline', local: 'hard_local', label: 'Hard deadline' },
    { field: 'resubmission_deadline', local: 'resub_local', label: 'Resubmission' },
  ] as const;
  // R20: a failed request focuses the first errored field, in screen order.
  const FIELD_ORDER = ['block_id', 'assignment_md', 'soft_deadline', 'hard_deadline', 'resubmission_deadline'];

  // Modal owns the frame; the modal's own nodes are found from the title.
  function panel(): HTMLElement | null {
    return titleEl?.closest<HTMLElement>('section.modal-panel') ?? null;
  }
  function closeX(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]') ?? null;
  }
  // The assignment textarea exists only in the editor's Edit mode; its Edit
  // tab is the fallback (MarkdownEditor.svelte:285-296).
  function assignmentField(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>('.modal-body textarea') ?? null;
  }
  function editTab(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>('.modal-body button[data-action="edit"]') ?? null;
  }
  function focusFirstError() {
    focusFirst(
      FIELD_ORDER.filter((k) => fieldErrors[k]).map((k) =>
        panel()?.querySelector<HTMLElement>(`.modal-body [aria-describedby~="err-${k}"]`),
      ),
    );
  }

  // ×, Esc and create-mode Cancel. While a confirm shows they never close:
  // focus goes back to the confirm's Cancel.
  function requestClose() {
    if (submitting) return;
    if (confirmOpen) {
      panel()?.querySelector<HTMLElement>('.modal-foot .inline-confirm button.cancel')?.focus();
      return;
    }
    if (dirty) {
      pendingClose = true;
      return;
    }
    uploadAbortController?.abort();
    onClose();
  }

  async function cancelClose() {
    pendingClose = false;
    await tick();
    closeX()?.focus();
  }

  function confirmDiscard() {
    pendingClose = false;
    uploadAbortController?.abort();
    onClose();
  }

  // D12: put back the saved values (§Focus › After Discard).
  async function discard() {
    if (submitting || !dirty) return;
    Object.assign(formData, $state.snapshot(baseline));
    serverError = null;
    fieldErrors = {};
    await tick();
    focusFirst([assignmentField(), editTab(), closeX()]);
  }

  function handlePublishClick() {
    if (submitting || publishReason) return;
    pendingPublishConfirm = true;
  }

  async function cancelPublish() {
    pendingPublishConfirm = false;
    await tick();
    focusFirst([publishEl, closeX()]);
  }

  async function confirmPublish() {
    if (submitting) return;
    pendingPublishConfirm = false;
    // Re-check: the parent may have flipped versionIsDisabled (or
    // runIsPublished) since the click, and R22 refuses while dirty.
    if (boxShows || dirty) {
      await tick();
      focusFirst([publishEl, closeX()]);
      return;
    }
    submitting = true;
    publishing = true;
    serverError = null;
    // P11: the confirm's buttons unmount under the focus; the busy Publish takes it.
    await tick();
    publishEl?.focus();
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
    if (submitting || saveReason) return;
    const sent = currentFormSnapshot();
    submitting = true;
    serverError = null;
    fieldErrors = {};
    let created: MiniProjectResponse | null = null;
    try {
      const body = {
        block_id: sent.block_id!,
        assignment_md: sent.assignment_md,
        soft_deadline: sent.soft_local ? localInputToISO(sent.soft_local) : null,
        hard_deadline: sent.hard_local ? localInputToISO(sent.hard_local) : null,
        resubmission_deadline: sent.resub_local ? localInputToISO(sent.resub_local) : null,
      };
      if (mode === 'create') {
        created = await createMiniProject(runId, body);
      } else {
        const { block_id: _block_id, ...patchBody } = body;
        await updateMiniProject(initial!.id, patchBody);
      }
    } catch (e: unknown) {
      if (!mounted) return;
      if (e instanceof ApiError && e.status === 404) {
        serverError =
          'This mini-project has been deleted. Select-all (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C) from the assignment textarea if you want to preserve your work before closing.';
        // T9 smoke catch: the MP is gone server-side; refresh the parent's
        // list so the stale row goes. Fire-and-forget by design; the explicit
        // .catch keeps a refresh failure from surfacing as unhandled.
        onSaved().catch(() => {});
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
      // R20: un-freeze, then focus the first errored field, or stay on Save.
      submitting = false;
      await tick();
      focusFirstError();
      return;
    }
    if (!mounted) return;
    if (mode === 'create') {
      if (created) onCreated?.(created);
    } else {
      baseline = sent;
    }
    // D19: the write succeeded; a failed list refresh is only a toast. The
    // modal stays frozen through the refresh (R20).
    let refreshFailed = false;
    try {
      await onSaved();
    } catch {
      refreshFailed = true;
    }
    if (!mounted) return;
    if (mode === 'create') {
      if (refreshFailed) pushToast('Created (refresh failed — reload to see latest)', 'info');
      submitting = false;
      onClose();
      return;
    }
    // P3: one toast, once the refresh settles (5b's order).
    if (refreshFailed) pushToast('Saved (refresh failed — reload to see latest)', 'info');
    else pushToast('Saved', 'success');
    submitting = false;
    await tick();
    // §Focus › After Save: Save itself just became disabled.
    focusFirst([publishEl, assignmentField(), editTab(), closeX()]);
  }
</script>

<DirtyGuard isDirty={() => dirty && !submitting} />

{#snippet head()}
  <h2 id="mp-modal-title" class="mpm-heading" title={heading} bind:this={titleEl}>{heading}</h2>
{/snippet}

{#snippet foot()}
  <span class="mpm-dirty mono">{mode === 'edit' && dirty ? 'unsaved changes' : ''}</span>
  {#if pendingClose}
    <InlineConfirm
      row
      takeFocus
      warning="Discard unsaved changes?"
      confirmLabel="Discard"
      confirmDataAction="confirm-discard"
      onCancel={() => void cancelClose()}
      onConfirm={confirmDiscard}
    />
  {:else if pendingPublishConfirm}
    <InlineConfirm
      row
      takeFocus
      warning="Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions)."
      confirmLabel="Publish"
      confirmDataAction="confirm-publish"
      onCancel={() => void cancelPublish()}
      onConfirm={() => void confirmPublish()}
    />
  {:else if mode === 'create'}
    <Button variant="ghost" data-action="cancel" onclick={requestClose}>Cancel</Button>
    <Button
      variant="primary"
      data-action="save"
      loading={saving}
      disabled={!saving && !!saveReason}
      title={saving ? undefined : (saveReason ?? undefined)}
      onclick={() => void handleSave()}
    >{saving ? 'Creating…' : 'Create'}</Button>
  {:else}
    {#if initial && !initial.is_published}
      <Button
        variant="secondary"
        data-action="publish"
        loading={publishing}
        disabled={!publishing && !!publishReason}
        title={publishing ? undefined : (publishReason ?? undefined)}
        bind:element={publishEl}
        onclick={handlePublishClick}
      >{publishing ? 'Publishing…' : 'Publish'}</Button>
    {/if}
    <Button
      variant="ghost"
      data-action="discard"
      disabled={!!discardReason}
      title={discardReason ?? undefined}
      onclick={() => void discard()}
    >Discard</Button>
    <Button
      variant="primary"
      data-action="save"
      loading={saving}
      disabled={!saving && !!saveReason}
      title={saving ? undefined : (saveReason ?? undefined)}
      onclick={() => void handleSave()}
    >{saving ? 'Saving…' : 'Save'}</Button>
  {/if}
{/snippet}

<Modal
  labelledby="mp-modal-title"
  width={820}
  maxHeight={720}
  onRequestClose={requestClose}
  closeDisabled={submitting}
  bodyInert={confirmOpen}
  autofocusSelector={'textarea, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <div class="mpm-block">
    {#if mode === 'create'}
      <label class="mpm-key" for="{uid}-block">Block</label>
      <select
        id="{uid}-block"
        class="mpm-input"
        class:mpm-invalid={!!fieldErrors.block_id}
        bind:value={formData.block_id}
        disabled={submitting}
        aria-invalid={fieldErrors.block_id ? 'true' : undefined}
        aria-describedby={fieldErrors.block_id ? 'err-block_id' : undefined}
      >
        {#each availableBlocks as b (b.id)}
          <option value={b.id}>{blockLabel(b)}</option>
        {/each}
      </select>
    {:else}
      <span class="mpm-key">Block</span>
      {#if currentBlock}
        <span class="mpm-block-name" title={blockLabel(currentBlock)}>{blockLabel(currentBlock)}</span>
      {:else}
        <span class="mpm-block-name mpm-none">—</span>
      {/if}
    {/if}
  </div>
  {#if fieldErrors.block_id}
    <span id="err-block_id" class="field-error mpm-error" role="alert">{fieldErrors.block_id}</span>
  {/if}

  <div class="mpm-field">
    <span class="mpm-label">Assignment</span>
    <MarkdownEditor
      {assetContext}
      bind:value={formData.assignment_md}
      frozen={submitting}
      bind:uploading
      bind:uploadAbortController
      ariaLabel="Assignment"
      ariaDescribedby={ariaDescribedFor('assignment_md')}
    />
    {#if fieldErrors.assignment_md}
      <span id="err-assignment_md" class="field-error mpm-error" role="alert">{fieldErrors.assignment_md}</span>
    {/if}
  </div>

  <div class="mpm-deadlines">
    {#each DEADLINES as d (d.field)}
      <div class="mpm-field">
        <label class="mpm-label" for="{uid}-{d.field}">{d.label} <span class="mpm-zone mono">{zone}</span></label>
        <input
          id="{uid}-{d.field}"
          class="mpm-input mpm-date"
          class:mpm-invalid={!!fieldErrors[d.field]}
          type="datetime-local"
          bind:value={formData[d.local]}
          readonly={submitting}
          aria-invalid={fieldErrors[d.field] ? 'true' : undefined}
          aria-describedby={ariaDescribedFor(d.field)}
        />
        {#if fieldErrors[d.field]}
          <span id="err-{d.field}" class="field-error mpm-error" role="alert">{fieldErrors[d.field]}</span>
        {/if}
      </div>
    {/each}
  </div>

  {#if serverError}
    <div class="banner banner-error mpm-banner" role="alert">{serverError}</div>
  {/if}
  {#if boxShows && publishCheckResult}
    <div class="mpm-box precondition-banner" data-testid="publish-preconditions">
      <p class="mpm-box-head">Cannot publish yet</p>
      <ul class="mpm-box-list">
        {#each publishCheckResult as bullet, idx (bullet.text)}
          {#if bullet.text.includes('Open Overview')}
            {@const linkIdx = bullet.text.indexOf('Open Overview')}
            {@const before = bullet.text.slice(0, linkIdx)}
            {@const after = bullet.text.slice(linkIdx + 'Open Overview'.length)}
            <!-- Render the bullet text verbatim. The "Open Overview"
                 substring becomes a <button> when the viewer can act on
                 the precondition (admin, or non-admin-only bullet); for
                 admin-only bullets viewed by a teacher it falls back to
                 plain text so the sentence stays grammatical. -->
            <li id={`precondition-${idx}`}
              >{before}{#if !bullet.adminOnly || course.is_admin}<button
                  type="button"
                  class="linklike"
                  data-action="publish-nav-overview"
                  onclick={() => onNavigateToTab('overview')}>Open Overview</button
                >{:else}Open Overview{/if}{after}</li
            >
          {:else}
            <li id={`precondition-${idx}`}>{bullet.text}</li>
          {/if}
        {/each}
      </ul>
    </div>
  {/if}
</Modal>

<style>
  .mpm-heading {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mpm-block {
    display: grid;
    grid-template-columns: 150px 1fr;
    align-items: center;
    gap: 12px;
  }
  .mpm-key {
    font-size: 12.5px;
    color: var(--muted);
  }
  .mpm-block-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--text); }
  .mpm-none { color: var(--muted); }
  .mpm-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .mpm-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-3);
  }
  .mpm-deadlines {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .mpm-zone {
    font-size: 10.5px;
    font-weight: 400;
    color: var(--muted);
  }
  .mpm-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .mpm-date { font-family: var(--font-mono); font-size: 12.5px; }
  .mpm-invalid {
    border-color: var(--danger);
  }
  .mpm-error { font-size: 12px; color: var(--danger); }
  .mpm-banner {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .mpm-box {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px 10px;
    background: var(--status-needs-revision-bg);
    border-left: 3px solid var(--gold);
    border-radius: 0 5px 5px 0;
    font-size: 12.5px;
    color: var(--status-needs-revision-fg);
  }
  .mpm-box-head {
    margin: 0;
    font-weight: 600;
  }
  .mpm-box-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    line-height: 1.5;
  }
  /* P2: the "·" is drawn, so a bullet's text stays the sentence alone. */
  .mpm-box-list li::before { content: '· '; }
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
  .mpm-dirty {
    flex: 1;
    font-size: 11.5px;
    color: var(--status-needs-revision-fg);
  }
  /* The 880px responsive-stack rule belongs on MarkdownEditor's `.edit-content`
     (textarea + sidebar split) — see `MarkdownEditor.svelte`'s media query. */
</style>
