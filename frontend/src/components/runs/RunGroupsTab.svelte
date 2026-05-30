<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { createGroup, deleteGroup, getCapacityClass, updateGroup } from '../../lib/runGroups';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import type { DirtyTracker } from '../../lib/dirty.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { Course, GroupResponse } from '../../lib/types';

  let {
    runId,
    groups,
    groupsEnabled,
    onRefetchGroups,
    onRefetchGroupsAndStudents,
    course,
    runIsPublished,
  }: {
    runId: number;
    groups: GroupResponse[];
    groupsEnabled: boolean;
    onRefetchGroups: () => Promise<void>;
    onRefetchGroupsAndStudents: () => Promise<void>;
    course: Course;
    runIsPublished: boolean;
  } = $props();

  let newName = $state('');
  let addError: string | null = $state(null);
  let pendingDelete: number | null = $state(null);

  const sorted = $derived([...groups].sort((a, b) => a.name.localeCompare(b.name)));

  // One tracker per group id; only its `.current` is a $state proxy.
  // Map entries persist after a group is deleted server-side (small leak,
  // bounded by ~20 groups per run — acceptable).
  const renameTrackers = new Map<number, DirtyTracker<{ name: string }>>();

  function trackerFor(group: GroupResponse): DirtyTracker<{ name: string }> {
    let t = renameTrackers.get(group.id);
    if (!t) {
      t = makeDirtyTracker<{ name: string }>({ name: group.name });
      renameTrackers.set(group.id, t);
    }
    return t;
  }

  async function addGroup(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    try {
      await createGroup(runId, newName.trim());
      newName = '';
      await onRefetchGroups();
    } catch (e) {
      if (e instanceof ApiError) {
        addError =
          e.status === 409
            ? 'A group with that name already exists in this run.'
            : e.displayMessage;
      }
    }
  }

  async function commitRename(group: GroupResponse) {
    const t = trackerFor(group);
    const next = t.current.name.trim();
    if (!next || next === group.name) {
      t.current.name = group.name;
      return;
    }
    try {
      await updateGroup(group.id, { name: next });
      await onRefetchGroups();
    } catch (e) {
      t.current.name = group.name;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }

  async function confirmDelete(groupId: number) {
    try {
      await deleteGroup(groupId);
      pendingDelete = null;
      await onRefetchGroups();
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) {
        const msg = typeof e.detail === 'string' ? e.detail : '';
        if (e.status === 409 && /students/i.test(msg)) {
          pushToast(e.displayMessage, 'error');
          await onRefetchGroupsAndStudents();
        } else if (e.status === 409 && /submission/i.test(msg)) {
          pushToast(e.displayMessage, 'error');
          await onRefetchGroups();
        } else {
          pushToast(e.displayMessage, 'error');
        }
      }
    }
  }
</script>

{#if !groupsEnabled}
  <section class="groups-disabled-placeholder">
    {#if !runIsPublished}
      Groups are disabled for this run. Enable in Overview → Settings to manage groups.
    {:else if course.is_admin}
      Groups are disabled for this run. Unpublish in Overview before enabling groups.
    {:else}
      Groups are disabled for this run. Ask a course admin to unpublish the run and enable groups.
    {/if}
  </section>
{:else}
  <section class="groups-tab">
    <form onsubmit={addGroup}>
      <input name="name" maxlength="80" bind:value={newName} placeholder="Group name" />
      <button type="submit" disabled={!newName.trim()}>Add group</button>
    </form>
    {#if addError}<p class="error">{addError}</p>{/if}

    {#if sorted.length === 0}
      <p class="empty">No groups yet.</p>
    {:else}
      <ul>
        {#each sorted as g (g.id)}
          {@const t = trackerFor(g)}
          <li>
            <input
              name="rename-{g.id}"
              bind:value={t.current.name}
              onblur={() => commitRename(g)}
              onkeydown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  t.current.name = g.name;
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
            <span class="badge badge-{getCapacityClass(g.student_count)}">
              {g.student_count === 0 ? 'empty' : `${g.student_count}/10`}
            </span>
            {#if pendingDelete === g.id}
              <InlineConfirm
                confirmLabel="Confirm Delete"
                confirmDataAction="confirm-delete-group"
                onConfirm={() => confirmDelete(g.id)}
                onCancel={() => (pendingDelete = null)}
              />
            {:else}
              <button
                data-action="delete-group"
                disabled={g.student_count > 0}
                title={g.student_count > 0 ? 'Move students out before deleting.' : ''}
                onclick={() => (pendingDelete = g.id)}
              >Delete</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .groups-disabled-placeholder {
    padding: 16px;
    background: var(--surface-muted, #f5f5f5);
    color: var(--muted, #666);
    border-radius: 4px;
  }
  .groups-tab { display: flex; flex-direction: column; gap: 12px; }
  form { display: flex; gap: 8px; align-items: center; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 0.85em; }
  .badge-empty { background: #eee; color: #666; }
  .badge-ok { background: #e7f5ee; color: #0a6c3e; }
  .badge-warn { background: #fff4d6; color: #8a6500; }
  .badge-full { background: #fdecea; color: #a8071a; }
  .error { color: var(--danger, #c00); }
  .empty { color: var(--muted, #666); }
</style>
