<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { updateRun } from '../../lib/runs';
  import { formatShortDate } from '../../lib/datetime';
  import { pushToast } from '../../stores/toasts.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import InlineName from '../ui/InlineName.svelte';
  import Switch from '../ui/Switch.svelte';
  import type { RunResponse, RunUpdateRequest, Version } from '../../lib/types';

  type ChecklistRow = { id: string; label: string; state: 'ok' | 'violated' | 'na'; hint?: string };
  type Readiness = { checks: ChecklistRow[]; firstViolation: string | null };
  type Field = 'title' | 'start_date' | 'end_date';

  let {
    run,
    setRun,
    pinned,
    isAdmin,
    readiness,
    onNavigateTab,
    onDeleteRun,
  }: {
    run: RunResponse;
    setRun: (r: RunResponse) => void;
    pinned: Version | undefined;
    isAdmin: boolean;
    readiness: Readiness;
    onNavigateTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster', prefilter?: 'unassigned' | null) => void;
    onDeleteRun: () => void;
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
  // R32: one run write at a time — a field save or the switch's request.
  // An open field is not a write.
  let localWrite = $state(false);
  const runWrite = $derived(localWrite);
  const editEls: Partial<Record<Field, HTMLButtonElement>> = $state({});
  let confirmDeleteOpen = $state(false);

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
      if (e instanceof ApiError) pushToast(`Could not update setting: ${e.displayMessage}`, 'error');
    } finally {
      localWrite = false;
    }
  }
</script>

<div class="ov-grid">
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

  <div class="ov-col">
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

    <section class="readiness">
      <h3>Publish readiness</h3>
      <ul>
        {#each readiness.checks as row (row.id)}
          <li class="state-{row.state}">
            {#if row.state === 'ok'}✓{:else if row.state === 'violated'}✗{:else}—{/if}
            {row.label}
            {#if row.state === 'violated' && row.id === 'assigned' && row.hint}
              <button
                type="button"
                class="hint-button"
                data-action="goto-unassigned"
                onclick={() => onNavigateTab('roster', 'unassigned')}
              >{row.hint}</button>
            {:else if row.hint}
              <span class="hint">{row.hint}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>

    {#if !run.is_published && isAdmin}
      <section class="danger-zone">
        <h3>Danger zone</h3>
        {#if confirmDeleteOpen}
          <InlineConfirm
            confirmLabel="Confirm Delete"
            confirmDataAction="confirm-delete"
            onConfirm={onDeleteRun}
            onCancel={() => (confirmDeleteOpen = false)}
          />
        {:else}
          <button type="button" data-action="delete-run" onclick={() => (confirmDeleteOpen = true)}>Delete run</button>
        {/if}
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

  .readiness,
  .danger-zone {
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border);
  }
  .readiness h3,
  .danger-zone h3 {
    margin: 0 0 var(--space-2);
    font-size: 1em;
    color: var(--text);
  }
  .readiness ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .readiness li.state-ok { color: var(--text); }
  .readiness li.state-violated { color: var(--danger); }
  .readiness li.state-na { color: var(--muted); }
  .readiness .hint { color: var(--muted); margin-left: 4px; }
  .readiness .hint-button {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--primary);
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
    margin-left: 4px;
  }
  .danger-zone button[data-action="delete-run"] {
    background: var(--danger);
    color: var(--primary-text);
    border: 0;
    padding: 8px 14px;
    border-radius: var(--radius);
    cursor: pointer;
  }
</style>
