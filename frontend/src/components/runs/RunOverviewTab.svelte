<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { updateRun } from '../../lib/runs';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import type { DirtyTracker } from '../../lib/dirty.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { Course, RunResponse, RunTeacherResponse, GroupResponse, RunStudentResponse, RunUpdateRequest } from '../../lib/types';

  type RunForm = { title: string; start_date: string; end_date: string };
  type ChecklistRow = { id: string; label: string; state: 'ok' | 'violated' | 'na'; hint?: string };
  type Readiness = { checks: ChecklistRow[]; firstViolation: string | null };

  let {
    run,
    setRun,
    teachers,
    groups,
    students,
    readiness,
    onNavigateTab,
    onDeleteRun,
    course,
  }: {
    run: RunResponse;
    setRun: (r: RunResponse) => void;
    teachers: RunTeacherResponse[];
    groups: GroupResponse[];
    students: RunStudentResponse[];
    readiness: Readiness;
    onNavigateTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster', prefilter?: 'unassigned' | null) => void;
    onDeleteRun: () => void;
    course?: Course;
  } = $props();

  // T10: reference still-unused props (teachers, groups, students, course)
  // inside an $effect so svelte-check stays clean. T11/T12 will surface them.
  $effect(() => {
    void teachers; void groups; void students; void course;
  });

  let tracker = $state<DirtyTracker<RunForm> | null>(null);
  let groupsEnabledBusy = $state(false);
  let confirmDeleteOpen = $state(false);

  $effect(() => {
    if (run && tracker === null) {
      tracker = makeDirtyTracker<RunForm>({
        title: run.title,
        start_date: run.start_date,
        end_date: run.end_date,
      });
    }
  });

  async function commitField(field: keyof RunForm) {
    if (!tracker) return;
    const inFlightValue = tracker.current[field];
    const pristineValue = run[field];
    if (inFlightValue === pristineValue) return;
    try {
      const body: RunUpdateRequest = {};
      (body as Record<string, string>)[field] = inFlightValue;
      const updated = await updateRun(run.id, body);
      setRun(updated);
      // Capture in-flight current BEFORE reset so we can preserve user edits to
      // OTHER fields that landed during this PATCH (spec §4.1 cross-field rule
      // applies to success path too — reset() rewrites every key in `current`).
      const beforeReset: RunForm = {
        title: tracker.current.title,
        start_date: tracker.current.start_date,
        end_date: tracker.current.end_date,
      };
      const serverSnapshot: RunForm = {
        title: updated.title,
        start_date: updated.start_date,
        end_date: updated.end_date,
      };
      tracker.reset(serverSnapshot);
      for (const k of Object.keys(serverSnapshot) as (keyof RunForm)[]) {
        if (k === field) {
          // Committed field: server value sticks ONLY if the user has not
          // since typed (current still equals what we sent). Symmetric with
          // the error-path revert rule below.
          if (beforeReset[k] !== inFlightValue) {
            tracker.current[k] = beforeReset[k];
          }
        } else if (beforeReset[k] !== serverSnapshot[k]) {
          tracker.current[k] = beforeReset[k];
        }
      }
    } catch (e) {
      if (tracker.current[field] === inFlightValue) {
        tracker.current[field] = pristineValue;
      }
      if (e instanceof ApiError) pushToast(`Could not update ${field}: ${e.displayMessage}`, 'error');
    }
  }

  function onFieldKey(e: KeyboardEvent, field: keyof RunForm) {
    if (!tracker) return;
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') {
      el.blur();
    } else if (e.key === 'Escape') {
      tracker.current[field] = run[field];
      el.blur();
    }
  }

  async function toggleGroupsEnabled(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    const next = el.checked;
    groupsEnabledBusy = true;
    try {
      const updated = await updateRun(run.id, { groups_enabled: next });
      setRun(updated);
    } catch (e) {
      el.checked = run.groups_enabled;
      if (e instanceof ApiError) pushToast(`Could not update setting: ${e.displayMessage}`, 'error');
    } finally {
      groupsEnabledBusy = false;
    }
  }
</script>

{#if tracker}
  <section class="run-summary">
    <label>
      Title
      <input
        name="title"
        bind:value={tracker.current.title}
        onblur={() => commitField('title')}
        onkeydown={(e) => onFieldKey(e, 'title')}
        maxlength="200"
      />
    </label>
    <label>
      Start
      <input
        type="date"
        name="start_date"
        bind:value={tracker.current.start_date}
        onblur={() => commitField('start_date')}
        onkeydown={(e) => onFieldKey(e, 'start_date')}
      />
    </label>
    <label>
      End
      <input
        type="date"
        name="end_date"
        bind:value={tracker.current.end_date}
        onblur={() => commitField('end_date')}
        onkeydown={(e) => onFieldKey(e, 'end_date')}
      />
    </label>
  </section>

  <section class="run-settings">
    <h3>Settings</h3>
    <label title={run.is_published ? 'Locked once the run is published. Unpublish to change.' : ''}>
      <input
        type="checkbox"
        name="groups_enabled"
        checked={run.groups_enabled}
        disabled={run.is_published || groupsEnabledBusy}
        onchange={toggleGroupsEnabled}
      />
      Groups enabled
      <small>Disabling groups hides group assignments but does not delete them.</small>
    </label>
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

  {#if !run.is_published}
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
{/if}

<style>
  .run-summary {
    display: grid;
    gap: var(--space-3, 16px);
    grid-template-columns: 1fr;
    max-width: 480px;
    padding: var(--space-3, 16px) 0;
  }
  .run-summary label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.9em;
    color: var(--muted, #666);
  }
  .run-summary input {
    padding: 8px 10px;
    border: 1px solid var(--border, #ddd);
    border-radius: 4px;
    font-size: 1em;
    color: var(--text, #222);
    background: var(--input-bg, #fff);
  }
  .run-settings,
  .readiness,
  .danger-zone {
    padding: var(--space-3, 16px) 0;
    border-top: 1px solid var(--border, #eee);
  }
  .run-settings h3,
  .readiness h3,
  .danger-zone h3 {
    margin: 0 0 var(--space-2, 8px);
    font-size: 1em;
    color: var(--text, #222);
  }
  .run-settings label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text, #222);
  }
  .run-settings small {
    color: var(--muted, #666);
    font-size: 0.85em;
    margin-left: 6px;
  }
  .readiness ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .readiness li.state-ok { color: var(--text, #222); }
  .readiness li.state-violated { color: var(--danger, #c00); }
  .readiness li.state-na { color: var(--muted, #666); }
  .readiness .hint { color: var(--muted, #666); margin-left: 4px; }
  .readiness .hint-button {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--link, #335);
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
    margin-left: 4px;
  }
  .danger-zone button[data-action="delete-run"] {
    background: var(--danger, #c00);
    color: #fff;
    border: 0;
    padding: 8px 14px;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
