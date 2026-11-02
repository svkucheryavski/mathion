<script module lang="ts">
  export type ReadinessRow = {
    id: 'teacher' | 'version' | 'assigned' | 'sizes';
    label: string;
    state: 'ok' | 'violated' | 'na';
    // Shown in the row; a link to hintTab when that is set.
    hint?: string;
    hintTab?: 'teachers' | 'groups' | 'roster';
    // R34: Publish run's title while this is the first violated row.
    reason?: string;
  };
  export type Readiness = { checks: ReadinessRow[] };
  export type PublishOutcome = 'published' | 'conflicts' | 'failed';
  export type UnpublishOutcome = 'unpublished' | 'draft-now' | 'failed';
  export type DeleteOutcome = { kind: 'deleted' } | { kind: 'published-now' } | { kind: 'failed'; message: string };
</script>


<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ApiError, OFFLINE_MESSAGE } from '../../lib/api';
  import { updateRun } from '../../lib/runs';
  import { formatShortDate } from '../../lib/datetime';
  import { focusFirst } from '../../lib/focusFirst';
  import { repairFocus } from '../../lib/askInPlace.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import DangerConfirm from '../ui/DangerConfirm.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import InlineName from '../ui/InlineName.svelte';
  import Switch from '../ui/Switch.svelte';
  import type { RunResponse, RunUpdateRequest, Version } from '../../lib/types';

  type Field = 'title' | 'start_date' | 'end_date';

  let {
    run,
    setRun,
    pinned,
    isAdmin,
    readiness,
    publishing,
    onNavigateTab,
    onPublish,
    onUnpublish,
    onDeleteRun,
  }: {
    run: RunResponse;
    setRun: (r: RunResponse) => void;
    pinned: Version | undefined;
    isAdmin: boolean;
    readiness: Readiness;
    // R33 / P25: the page is publishing or unpublishing this run.
    publishing: boolean;
    onNavigateTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster', prefilter?: 'unassigned' | null) => void;
    onPublish: () => Promise<PublishOutcome>;
    onUnpublish: () => Promise<UnpublishOutcome>;
    onDeleteRun: () => Promise<DeleteOutcome>;
  } = $props();

  const uid = $props.id();
  const WAIT = 'Wait for the current change to save';
  // Run details: the row label, the field's name, and its noun for the titles.
  const FIELDS: { key: Field; label: string; name: string; noun: string; type: 'text' | 'date'; action: string }[] = [
    { key: 'title', label: 'Title', name: 'Title', noun: 'the title', type: 'text', action: 'edit-title' },
    { key: 'start_date', label: 'Start', name: 'Start date', noun: 'the start date', type: 'date', action: 'edit-start-date' },
    { key: 'end_date', label: 'End', name: 'End date', noun: 'the end date', type: 'date', action: 'edit-end-date' },
  ];
  const NOUN: Record<Field, string> = { title: 'the title', start_date: 'the start date', end_date: 'the end date' };

  let editing = $state<Field | null>(null);
  // R32: one run write at a time — a field save, the switch's request, the
  // delete, or the page's publish / unpublish (that one outlives a remount).
  // An open field is not a write.
  let localWrite = $state(false);
  const runWrite = $derived(localWrite || publishing);
  const editEls: Partial<Record<Field, HTMLButtonElement>> = $state({});

  let unpublishConfirmOpen = $state(false);
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);
  let publishEl = $state<HTMLButtonElement>();
  let unpublishEl = $state<HTMLButtonElement>();
  let trashEl = $state<HTMLButtonElement>();
  let readyHead = $state<HTMLElement>();
  let deleteHead = $state<HTMLElement>();

  // An open panel is not a write, so Publish run (or a refetch) can turn the
  // run published under it; a published run cannot be deleted (D28), so the
  // panel and its error line go, before the DOM shows them on a published run.
  $effect.pre(() => {
    if (!run.is_published) return;
    deleteOpen = false;
    deleteError = null;
  });

  const violated = $derived(readiness.checks.filter((c) => c.state === 'violated'));
  const publishBlocked = $derived(violated.length > 0);
  const publishTitle = $derived(publishBlocked
    ? (violated[0].reason ?? '')
    : runWrite && !publishing ? WAIT : undefined);
  const footNote = $derived(
    run.is_published ? 'Published — students have access.'
    : !isAdmin ? 'A course admin publishes this run.'
    : violated.length === 1 ? 'Fix the outstanding check to publish.'
    : violated.length > 1 ? `Fix the ${violated.length} outstanding checks to publish.`
    : 'Ready to publish.');
  const trashTitle = $derived(run.is_published
    ? 'Unpublish the run before deleting it'
    : runWrite ? WAIT : 'Delete this run');

  // R42: the switch follows `run` after every setRun; a failure sets it back.
  let groupsOn = $state(untrack(() => run.groups_enabled));
  $effect(() => {
    groupsOn = run.groups_enabled;
  });

  const lockText = $derived(isAdmin
    ? 'Locked while the run is published — unpublish to change.'
    : 'Locked while the run is published — ask a course admin to unpublish.');

  function editTitle(noun: string): string {
    if (runWrite) return WAIT;
    if (editing !== null) return `Finish editing ${NOUN[editing]} first`;
    return `Edit ${noun}`;
  }

  async function focusEdit(field: Field) {
    await tick();
    editEls[field]?.focus();
  }

  // InlineName shows a rejection under the field, so this only rethrows.
  async function saveField(field: Field, value: string): Promise<void> {
    // R32: an open field is not a write, so the switch stays live; its ✓ /
    // Enter must wait for the switch's request (the reason shows under it).
    if (runWrite) throw new Error(WAIT);
    localWrite = true;
    const updated = await updateRun(run.id, { [field]: value } as RunUpdateRequest)
      .finally(() => { localWrite = false; });
    setRun(updated);
    editing = null;
    await focusEdit(field);
  }

  function cancelField(field: Field) {
    editing = null;
    void focusEdit(field);
  }

  async function toggleGroups(next: boolean) {
    localWrite = true;
    try {
      setRun(await updateRun(run.id, { groups_enabled: next }));
    } catch (e) {
      groupsOn = run.groups_enabled;
      pushToast(e instanceof ApiError ? `Could not update setting: ${e.displayMessage}` : OFFLINE_MESSAGE, 'error');
    } finally {
      localWrite = false;
    }
  }

  function goHint(row: ReadinessRow) {
    if (row.hintTab) onNavigateTab(row.hintTab, row.hintTab === 'roster' ? 'unassigned' : null);
  }

  // R33: the page sends the request; the outcome says where focus goes.
  // 'failed' keeps it on Publish run (it never lost it, R20); 'conflicts' hands
  // it to the modal, whose FocusTrap brings it back here.
  async function publish() {
    if (runWrite || publishBlocked) return;
    const outcome = await onPublish();
    // F7: the failure's refetch can reveal a violation that disables Publish run under focus.
    if (outcome === 'failed') { void repairFocus(publishEl, readyHead); return; }
    if (outcome !== 'published') return;
    await tick();
    focusFirst([unpublishEl, readyHead]);
  }

  function openUnpublish() {
    if (runWrite) return;
    unpublishConfirmOpen = true;
  }

  // P27: nothing to cancel while the request runs.
  async function cancelUnpublish() {
    if (publishing) return;
    unpublishConfirmOpen = false;
    await tick();
    focusFirst([unpublishEl, readyHead]);
  }

  async function confirmUnpublish() {
    if (runWrite) return;
    const outcome = await onUnpublish();
    unpublishConfirmOpen = false;
    await tick();
    focusFirst(outcome === 'failed' ? [unpublishEl, readyHead] : [publishEl, readyHead]);
  }

  function toggleDelete() {
    if (deleteOpen) {
      void cancelDelete();
      return;
    }
    if (runWrite || run.is_published) return;
    deleteError = null;
    deleteOpen = true;
  }

  async function cancelDelete() {
    if (deleteBusy) return;
    deleteOpen = false;
    deleteError = null;
    await tick();
    focusFirst([trashEl, deleteHead]);
  }

  // D24: the page deletes, toasts and navigates (P24); a 'failed' stays here.
  async function forceDelete(): Promise<void> {
    if (runWrite) return;
    localWrite = true;
    deleteBusy = true;
    deleteError = null;
    const outcome = await onDeleteRun().finally(() => {
      localWrite = false;
      deleteBusy = false;
    });
    if (outcome.kind === 'failed') {
      deleteError = outcome.message;
    } else if (outcome.kind === 'published-now') {
      deleteOpen = false;
      await tick();
      focusFirst([trashEl, deleteHead]);
    }
  }
</script>

{#snippet deleteMessage()}This deletes the run with its roster, groups, teacher assignments, mini-projects, assets, submissions and evaluations, and every uploaded file. It cannot be undone.{/snippet}

<div class="ov-grid">
  <div class="ov-col">
    <section class="ov-card" aria-labelledby="{uid}-details">
      <h2 class="ov-title" id="{uid}-details">Run details</h2>
      <div class="ov-details">
        {#each FIELDS as f (f.key)}
          <div class="ov-row" data-field={f.key}>
            <span class="ov-label">{f.label}</span>
            {#if editing === f.key}
              <div class="ov-edit">
                <InlineName
                  label={f.name}
                  type={f.type}
                  value={run[f.key]}
                  maxlength={f.key === 'title' ? 200 : undefined}
                  saveTitle="Save {f.name.toLowerCase()}"
                  emptyTitle={f.type === 'date' ? 'Choose a date' : undefined}
                  onSave={(v) => saveField(f.key, v)}
                  onCancel={() => cancelField(f.key)}
                />
              </div>
            {:else}
              <span class="ov-value">{f.type === 'date' ? formatShortDate(run[f.key]) : run[f.key]}</span>
              <span class="ov-act">
                <IconButton
                  glyph="pencil"
                  size="sm"
                  title={editTitle(f.noun)}
                  aria-label="Edit {f.noun}"
                  data-action={f.action}
                  disabled={runWrite || editing !== null}
                  bind:element={editEls[f.key]}
                  onclick={() => (editing = f.key)}
                />
              </span>
            {/if}
          </div>
        {/each}
        <div class="ov-row" data-field="version">
          <span class="ov-label">Version</span>
          <span class="ov-value">{pinned?.label ? `${pinned.label} · ` : ''}<span class="ov-ver">v. {run.version_id}</span></span>
          <span class="ov-act">
            <IconButton glyph="pencil" size="sm" title="The version is fixed when the run is created"
                        data-action="edit-version" disabled />
          </span>
        </div>
      </div>
    </section>

    <section class="ov-card" aria-labelledby="{uid}-settings">
      <h2 class="ov-title ov-title-loose" id="{uid}-settings">Settings</h2>
      <div class="ov-setting">
        <span class="ov-switch-slot">
          <Switch
            id="{uid}-groups"
            bind:checked={groupsOn}
            disabled={run.is_published}
            frozen={runWrite}
            title={run.is_published ? lockText : undefined}
            describedby={run.is_published ? `${uid}-lock ${uid}-help` : `${uid}-help`}
            onchange={(next) => void toggleGroups(next)}
          />
        </span>
        <div class="ov-setting-text">
          <label class="ov-setting-label" for="{uid}-groups">Groups enabled</label>
          {#if run.is_published}<p class="ov-help" id="{uid}-lock">{lockText}</p>{/if}
          <p class="ov-help" id="{uid}-help">Disabling hides assignments but does not delete them.</p>
        </div>
      </div>
    </section>
  </div>

  <div class="ov-col">
    <section class="ov-card" aria-labelledby="{uid}-ready">
      <h2 class="ov-title" id="{uid}-ready" tabindex="-1" bind:this={readyHead}>Publish readiness</h2>
      <ul class="ov-checks">
        {#each readiness.checks as row (row.id)}
          <li class="ov-check" data-check={row.id} data-state={row.state}>
            <span class="ov-box ov-box-{row.state}" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                {#if row.state === 'ok'}
                  <polyline points="3.4,8.4 6.6,11.6 12.6,4.8" stroke-width="1.9" />
                {:else if row.state === 'violated'}
                  <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
                {:else}
                  <line x1="5" y1="8" x2="11" y2="8" />
                {/if}
              </svg>
            </span>
            {#if row.state !== 'na'}<span class="ov-vh">{row.state === 'ok' ? 'Done:' : 'To do:'}</span>{/if}
            <span class="ov-check-label">{row.label}</span>
            {#if row.state === 'na'}
              <span class="ov-hint">not applicable</span>
            {:else if row.state === 'violated' && row.hintTab}
              <button
                type="button"
                class="ov-hint-link"
                data-action={row.hintTab === 'roster' ? 'goto-unassigned' : `goto-${row.hintTab}`}
                onclick={() => goHint(row)}
              >{row.hint}</button>
            {:else if row.state === 'violated' && row.hint}
              <span class="ov-hint">{row.hint}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if isAdmin && run.is_published && unpublishConfirmOpen}
        <div class="ov-foot">
          <InlineConfirm
            row
            takeFocus
            tone="primary"
            warning="Students lose access immediately; their progress is kept."
            confirmLabel="Unpublish"
            confirmDataAction="confirm-unpublish"
            onConfirm={() => void confirmUnpublish()}
            onCancel={() => void cancelUnpublish()}
          />
        </div>
      {:else}
        <div class="ov-foot">
          <span class="ov-foot-note">{footNote}</span>
          {#if isAdmin && !run.is_published}
            <Button
              variant="primary"
              data-action="publish"
              bind:element={publishEl}
              disabled={publishBlocked}
              aria-disabled={!publishBlocked && runWrite}
              loading={publishing}
              title={publishTitle}
              onclick={() => void publish()}
            >{publishing ? 'Publishing…' : 'Publish run'}</Button>
          {:else if isAdmin}
            <Button
              variant="secondary"
              data-action="unpublish"
              bind:element={unpublishEl}
              aria-disabled={runWrite}
              title={runWrite ? WAIT : undefined}
              onclick={openUnpublish}
            >Unpublish</Button>
          {/if}
        </div>
      {/if}
    </section>

    {#if isAdmin}
      <section class="ov-card ov-del-card" aria-labelledby="{uid}-del">
        <div class="ov-del">
          <div class="ov-del-text">
            <h2 class="ov-del-title" id="{uid}-del" tabindex="-1" bind:this={deleteHead}>Delete this run</h2>
            <p class="ov-del-sub">Only while unpublished. Roster, groups and submissions go with it.</p>
          </div>
          <IconButton
            glyph="trash"
            danger
            title={trashTitle}
            aria-label="Delete this run"
            data-action="delete-run"
            disabled={run.is_published}
            aria-disabled={!run.is_published && runWrite}
            aria-expanded={deleteOpen}
            aria-controls={deleteOpen ? `${uid}-delpanel` : undefined}
            bind:element={trashEl}
            onclick={toggleDelete}
          />
        </div>
        {#if deleteOpen}
          <div class="ov-del-panel" id="{uid}-delpanel">
            <DangerConfirm
              message={deleteMessage}
              busy={deleteBusy}
              disabledReason={runWrite && !deleteBusy ? WAIT : undefined}
              onConfirm={forceDelete}
              onCancel={() => void cancelDelete()}
            />
          </div>
        {/if}
        {#if deleteError}<p class="ov-err" role="alert">{deleteError}</p>{/if}
      </section>
    {/if}
  </div>
</div>

<style>
  /* 10a: two columns of cards; below 880px they stack, Run details first. */
  .ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  @media (max-width: 880px) {
    .ov-grid { grid-template-columns: 1fr; }
  }
  .ov-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .ov-card { min-width: 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .ov-title { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--text); }
  .ov-title:focus { outline: none; }
  .ov-title-loose { margin-bottom: 10px; }

  /* Run details: label / value / action slot, as drawn. */
  .ov-details { display: flex; flex-direction: column; }
  .ov-row { display: grid; grid-template-columns: 132px 1fr 54px; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border-soft); }
  .ov-row:last-child { border-bottom: 0; }
  .ov-label { font-size: 12.5px; color: var(--muted); }
  .ov-value { min-width: 0; font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .ov-ver { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
  .ov-act { display: flex; justify-content: flex-end; }
  /* The open field spans value and action; its ✓ lands in the action slot. */
  .ov-edit { grid-column: 2 / 4; display: flex; min-width: 0; }

  .ov-setting { display: flex; align-items: flex-start; gap: 11px; }
  .ov-switch-slot { display: flex; padding-top: 2px; }
  .ov-setting-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ov-setting-label { font-size: 13px; color: var(--text); }
  .ov-help { margin: 0; font-size: 12px; line-height: 1.45; color: var(--muted); }

  /* Publish readiness: an 18px status box, the label, an optional hint. */
  .ov-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .ov-check { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; padding: 7px 0; border-bottom: 1px solid var(--border-soft); }
  .ov-check:last-child { border-bottom: 0; }
  .ov-box { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 18px; height: 18px; border-radius: 4px; }
  .ov-box svg { width: 11px; height: 11px; }
  .ov-box-ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ov-box-violated { background: var(--status-needs-revision-bg); color: var(--status-needs-revision-fg); }
  .ov-box-na { background: var(--surface-2); color: var(--muted); }
  .ov-check-label { font-size: 13px; color: var(--text); }
  .ov-hint { font-size: 12.5px; color: var(--muted); }
  .ov-hint-link { padding: 0; border: 0; background: none; font: inherit; font-size: 12.5px; color: var(--primary); text-align: left; cursor: pointer; }
  .ov-hint-link:hover { text-decoration: underline; }
  .ov-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
  .ov-foot-note { flex: 1; font-size: 12.5px; color: var(--muted); }

  /* Delete this run: one row (P22), then the danger panel under it. */
  .ov-del-card { padding: 14px 18px; }
  .ov-del { display: flex; align-items: center; gap: 12px; }
  .ov-del-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .ov-del-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text); }
  .ov-del-title:focus { outline: none; }
  .ov-del-sub { margin: 0; font-size: 12px; color: var(--muted); }
  .ov-del-panel { margin-top: 12px; }
  .ov-err { margin: 12px 0 0; padding: 8px 12px; background: var(--danger-panel-bg); border-left: 3px solid var(--danger); border-radius: var(--radius); font-size: 13px; color: var(--danger-panel-fg); }
  .ov-vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
