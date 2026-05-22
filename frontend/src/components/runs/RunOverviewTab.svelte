<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { updateRun } from '../../lib/runs';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import type { DirtyTracker } from '../../lib/dirty.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { RunResponse, RunTeacherResponse, GroupResponse, RunStudentResponse, RunUpdateRequest } from '../../lib/types';

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
  }: {
    run: RunResponse;
    setRun: (r: RunResponse) => void;
    teachers: RunTeacherResponse[];
    groups: GroupResponse[];
    students: RunStudentResponse[];
    readiness: Readiness;
    onNavigateTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster', prefilter?: 'unassigned' | null) => void;
    onDeleteRun: () => void;
  } = $props();

  // Reference unused props (T10 will use them) to keep svelte-check clean.
  // Done inside $effect so the reads happen in a reactive context — using
  // `void prop` at top level triggers `state_referenced_locally` because the
  // destructured prop values are state proxies.
  $effect(() => {
    void teachers; void groups; void students; void readiness;
    void onNavigateTab; void onDeleteRun;
  });

  let tracker = $state<DirtyTracker<RunForm> | null>(null);

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
      tracker.reset({
        title: updated.title,
        start_date: updated.start_date,
        end_date: updated.end_date,
      });
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

  <!-- T10 appends: settings panel, readiness checklist, danger zone -->
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
</style>
