<script lang="ts">
  import { SvelteSet, SvelteMap } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import { addRunStudent, removeRunStudent } from '../../lib/runRoster';
  import { pushToast } from '../../stores/toasts.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { GroupResponse, RunStudentResponse } from '../../lib/types';

  let {
    runId,
    students,
    groups,
    groupsEnabled,
    rosterPrefilter,
    onPrefilterClear,
    onRefetchRosterData,
    onRefetchGroupsOnly,
    onOpenImport,
  }: {
    runId: number;
    students: RunStudentResponse[];
    groups: GroupResponse[];
    groupsEnabled: boolean;
    rosterPrefilter: 'unassigned' | null;
    onPrefilterClear: () => void;
    onRefetchRosterData: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onRefetchGroupsOnly: () => Promise<void>;
    onOpenImport: () => void;
  } = $props();

  // Reference onRefetchGroupsOnly so TS does not flag the unused prop; this
  // prop is consumed by T13 (optimistic inline group edit refetch path).
  $effect(() => { void onRefetchGroupsOnly; });

  let search = $state('');
  let newEmail = $state('');
  let newGroupId = $state<number | '__unassigned'>('__unassigned');
  let addError: string | null = $state(null);
  let pendingDelete = $state<number | null>(null);

  const pendingGroupId = new SvelteMap<number, number | null>();
  const selected = new SvelteSet<number>();

  function selectValueFor(s: RunStudentResponse): number | '__unassigned' {
    const effective = pendingGroupId.has(s.user_id) ? pendingGroupId.get(s.user_id)! : s.group_id;
    return effective === null ? '__unassigned' : effective;
  }

  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (rosterPrefilter === 'unassigned' && s.group_id !== null) return false;
      if (!q) return true;
      const email = s.user_email.toLowerCase();
      const name = (s.user_full_name ?? '').toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  });

  const selectedVisibleCount = $derived(visible.filter((s) => selected.has(s.user_id)).length);
  const headerChecked = $derived(visible.length > 0 && selectedVisibleCount === visible.length);
  const headerIndeterminate = $derived(selectedVisibleCount > 0 && selectedVisibleCount < visible.length);

  function onHeaderClick(event: Event) {
    event.preventDefault();
    if (headerChecked) {
      for (const s of visible) selected.delete(s.user_id);
    } else {
      for (const s of visible) selected.add(s.user_id);
    }
  }

  function onSearchInput(event: Event) {
    search = (event.currentTarget as HTMLInputElement).value;
    if (search && rosterPrefilter !== null) onPrefilterClear();
  }

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const dup = students.some((s) => s.user_email.toLowerCase() === email);
    if (dup) {
      addError = `${newEmail} is already enrolled. Edit their group in the table.`;
      return;
    }
    try {
      const groupId: number | null = newGroupId === '__unassigned' ? null : newGroupId;
      await addRunStudent(runId, newEmail.trim(), groupId);
      newEmail = '';
      newGroupId = '__unassigned';
      await onRefetchRosterData();
    } catch (e) {
      if (e instanceof ApiError) addError = e.displayMessage;
    }
  }

  async function confirmDelete(userId: number) {
    try {
      await removeRunStudent(runId, userId);
      pendingDelete = null;
      await onRefetchRosterData();
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }
</script>

<section class="roster-tab">
  <header class="roster-toolbar">
    <input
      name="roster-search"
      placeholder="Search by name or email…"
      value={search}
      oninput={onSearchInput}
    />
    {#if rosterPrefilter === 'unassigned'}
      {@const n = students.filter((s) => s.group_id === null).length}
      <span class="prefilter-pill">
        Showing: Unassigned ({n})
        <button data-action="clear-prefilter" aria-label="Clear filter" onclick={onPrefilterClear}>×</button>
      </span>
    {/if}
    <button data-action="open-import" onclick={onOpenImport}>Import roster</button>
  </header>

  {#if students.length === 0}
    <p class="empty">
      No students yet. Add one below or
      <button data-action="open-import-link" onclick={onOpenImport}>Import roster from CSV</button>.
    </p>
  {/if}

  <table>
    <thead>
      <tr>
        <th>
          <input
            type="checkbox"
            data-header-checkbox
            checked={headerChecked}
            onclick={onHeaderClick}
            bind:indeterminate={() => headerIndeterminate, () => {}}
          />
        </th>
        <th>Email</th>
        <th>Full name</th>
        <th>Group</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each visible as s (s.user_id)}
        <tr data-row="student">
          <td>
            <input
              type="checkbox"
              data-row-checkbox
              checked={selected.has(s.user_id)}
              onchange={(e) => {
                if ((e.currentTarget as HTMLInputElement).checked) selected.add(s.user_id);
                else selected.delete(s.user_id);
              }}
            />
          </td>
          <td>{s.user_email}</td>
          <td>{s.user_full_name || '—'}</td>
          <td>
            {#if groupsEnabled}
              <select value={selectValueFor(s)} disabled>
                <option value="__unassigned">Unassigned</option>
                {#each groups as g (g.id)}
                  <option value={g.id}>{g.name} ({g.student_count}/10){g.is_disabled ? ' (disabled)' : ''}</option>
                {/each}
              </select>
            {:else}
              —
            {/if}
          </td>
          <td>
            {#if pendingDelete === s.user_id}
              <InlineConfirm
                confirmLabel="Confirm Delete"
                confirmDataAction="confirm-delete-student"
                onConfirm={() => confirmDelete(s.user_id)}
                onCancel={() => (pendingDelete = null)}
              />
            {:else}
              <button data-action="delete-student" onclick={() => (pendingDelete = s.user_id)}>Delete</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if visible.length === 0 && students.length > 0}
    <p class="empty">
      {#if rosterPrefilter === 'unassigned'}
        No students are unassigned.
        <button data-action="clear-prefilter-link" onclick={onPrefilterClear}>Clear filter</button>.
      {:else}
        No students match '{search}'.
        <button data-action="clear-search-link" onclick={() => (search = '')}>Clear search</button>.
      {/if}
    </p>
  {/if}

  <form class="add-row" onsubmit={submitAdd}>
    <input name="new-email" type="email" maxlength="254" bind:value={newEmail} placeholder="student@example.com" />
    {#if groupsEnabled}
      <select bind:value={newGroupId}>
        <option value="__unassigned">Unassigned</option>
        {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
          <option value={g.id}>{g.name} ({g.student_count}/10)</option>
        {/each}
      </select>
    {:else}
      —
    {/if}
    <button data-action="add-student" type="submit" disabled={!newEmail.trim()}>Add</button>
  </form>
  {#if addError}<p class="error">{addError}</p>{/if}
</section>

<style>
  .roster-tab { display: flex; flex-direction: column; gap: 12px; }
  .roster-toolbar { display: flex; gap: 8px; align-items: center; }
  .prefilter-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--surface-muted, #f5f5f5);
    border-radius: 999px;
    font-size: 0.85em;
  }
  .prefilter-pill button { background: transparent; border: 0; cursor: pointer; padding: 0 4px; font-size: 1em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border, #eee); text-align: left; }
  thead th { position: sticky; top: 0; background: var(--surface, #fff); }
  .add-row { display: flex; gap: 8px; align-items: center; }
  .empty { color: var(--muted, #666); }
  .error { color: var(--danger, #c00); }
</style>
