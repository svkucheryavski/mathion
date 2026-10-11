<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { createGroup, deleteGroup, getCapacityClass, updateGroup } from '../../lib/runGroups';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import InlineName from '../ui/InlineName.svelte';
  import type { Course, GroupResponse } from '../../lib/types';

  let {
    runId,
    groups,
    groupsEnabled,
    onRefetchGroups,
    onRefetchGroupsAndStudents,
    course,
    runIsPublished,
    onGotoOverview = undefined,
  }: {
    runId: number;
    groups: GroupResponse[];
    groupsEnabled: boolean;
    onRefetchGroups: () => Promise<void>;
    onRefetchGroupsAndStudents: () => Promise<void>;
    course: Course;
    runIsPublished: boolean;
    onGotoOverview?: () => void;
  } = $props();

  // One editor at a time (R11): the add row or one group's rename. Switching
  // drops the open one without saving; nothing registers a dirty guard.
  type Editor = { kind: 'add' } | { kind: 'rename'; id: number } | null;
  let editor = $state<Editor>(null);
  let addKey = $state(0);
  let pendingDelete: number | null = $state(null);

  let headingEl = $state<HTMLElement>();
  let toggleEl = $state<HTMLButtonElement>();
  const pencilEls: Record<number, HTMLButtonElement | undefined> = $state({});
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  const sorted = $derived([...groups].sort((a, b) => a.name.localeCompare(b.name)));
  const addOpen = $derived(editor?.kind === 'add');

  async function closeAdd() {
    editor = null;
    await tick();
    toggleEl?.focus();
  }

  function toggleAdd() {
    if (addOpen) {
      void closeAdd();
      return;
    }
    pendingDelete = null;
    editor = { kind: 'add' };
  }

  async function addGroup(name: string) {
    try {
      await createGroup(runId, name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        throw new Error('A group with that name already exists in this run.');
      }
      throw e;
    }
    await onRefetchGroups();
    addKey += 1; // a fresh, empty, focused field for the next name
  }

  function startRename(id: number) {
    pendingDelete = null;
    editor = { kind: 'rename', id };
  }

  async function endRename(id: number) {
    editor = null;
    await tick();
    pencilEls[id]?.focus();
  }

  async function saveRename(id: number, name: string) {
    await updateGroup(id, { name });
    await onRefetchGroups();
    await endRename(id);
  }

  function askDelete(id: number) {
    editor = null;
    pendingDelete = id;
  }

  async function cancelDelete(id: number) {
    pendingDelete = null;
    await tick();
    trashEls[id]?.focus();
  }

  // §Focus: on success the next row's trash, the previous row's, the + toggle,
  // the h2; on failure this row's trash, else its ✎.
  async function confirmDelete(groupId: number) {
    const idx = sorted.findIndex((g) => g.id === groupId);
    try {
      await deleteGroup(groupId);
      pendingDelete = null;
      await onRefetchGroups();
      await tick();
      const next = sorted[idx];
      const prev = idx > 0 ? sorted[idx - 1] : undefined;
      focusFirst([next && trashEls[next.id], prev && trashEls[prev.id], toggleEl, headingEl]);
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) {
        const msg = typeof e.detail === 'string' ? e.detail : '';
        pushToast(e.displayMessage, 'error');
        if (e.status === 409 && /students/i.test(msg)) await onRefetchGroupsAndStudents();
        else if (e.status === 409 && /submission/i.test(msg)) await onRefetchGroups();
      }
      await tick();
      // A "has students" refetch disables this row's trash: fall back to its ✎.
      focusFirst([trashEls[groupId], pencilEls[groupId], toggleEl, headingEl]);
    }
  }
</script>

{#snippet overviewLink()}
  {#if onGotoOverview}<button type="button" class="linklike" data-action="goto-overview" onclick={() => onGotoOverview?.()}>Overview</button>{:else}Overview{/if}
{/snippet}

{#snippet cap(g: GroupResponse)}
  {@const n = g.student_count}
  <span class="cap cap-{getCapacityClass(n)}" class:cap-n={n > 0} title="{n} of 10 students">{n === 0 ? 'empty' : `${n}/10`}</span>
{/snippet}

{#if !groupsEnabled}
  <section class="groups-off">
    <p class="go-head">Groups disabled for this run</p>
    <p class="go-body">
      {#if !runIsPublished}
        Groups are disabled for this run. Enable in {@render overviewLink()} › Settings to manage groups.
      {:else if course.is_admin}
        Groups are disabled for this run. Unpublish in {@render overviewLink()} before enabling groups.
      {:else}
        Groups are disabled for this run. Ask a course admin to unpublish the run and enable groups.
      {/if}
    </p>
  </section>
{:else}
  <section class="groups-tab">
    <div class="sec-head">
      <h2 tabindex="-1" bind:this={headingEl}>Groups <span class="sec-count">{groups.length}</span></h2>
      <IconButton glyph={addOpen ? 'close' : 'plus'} primary={!addOpen} size="md"
                  title={addOpen ? 'Close' : 'Add group'} aria-expanded={addOpen}
                  data-action="toggle-add-group" bind:element={toggleEl} onclick={toggleAdd} />
    </div>

    {#if addOpen || sorted.length > 0}
      <ul class="group-list">
        {#if addOpen}
          <li class="g-row g-add">
            {#key addKey}
              <InlineName label="New group name" maxlength={80} saveTitle="Add" onSave={addGroup} onCancel={closeAdd} />
            {/key}
          </li>
        {/if}
        {#each sorted as g (g.id)}
          <li class="g-row">
            {#if editor?.kind === 'rename' && editor.id === g.id}
              <InlineName label="Group name" value={g.name} maxlength={80}
                          onSave={(name) => saveRename(g.id, name)} onCancel={() => endRename(g.id)}>
                {#snippet aside()}{@render cap(g)}{/snippet}
              </InlineName>
            {:else}
              <span class="g-name">{g.name}</span>
              {@render cap(g)}
              <span class="g-actions">
                {#if pendingDelete === g.id}
                  <InlineConfirm takeFocus confirmLabel="Confirm Delete" confirmDataAction="confirm-delete-group"
                                 onConfirm={() => confirmDelete(g.id)} onCancel={() => cancelDelete(g.id)} />
                {:else}
                  <IconButton glyph="pencil" size="sm" title="Rename" aria-label="Rename {g.name}"
                              data-action="rename-group" bind:element={pencilEls[g.id]}
                              onclick={() => startRename(g.id)} />
                  <IconButton glyph="trash" size="sm" danger aria-label="Delete group {g.name}"
                              title={g.student_count > 0 ? 'Move students out before deleting.' : 'Delete'}
                              disabled={g.student_count > 0} data-action="delete-group"
                              bind:element={trashEls[g.id]} onclick={() => askDelete(g.id)} />
                {/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if sorted.length === 0}<p class="empty">No groups yet.</p>{/if}
  </section>
{/if}

<style>
  .groups-tab { display: flex; flex-direction: column; gap: 10px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }

  .group-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .g-row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 4px 12px; border-top: 1px solid var(--border-soft); }
  .g-row:first-child { border-top: 0; }
  .g-name { flex: 1 1 auto; min-width: 0; font-size: 13px; color: var(--text); }
  .g-actions { display: flex; align-items: center; gap: 4px; }

  .cap { padding: 1px 8px; border-radius: var(--radius-pill); font-size: 11.5px; white-space: nowrap; }
  .cap-n { font-family: var(--font-mono); }
  .cap-empty { background: var(--status-not-submitted-bg); color: var(--status-not-submitted-fg); }
  .cap-ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .cap-warn { background: var(--status-needs-revision-bg); color: var(--status-needs-revision-fg); }
  .cap-full { background: var(--status-rejected-bg); color: var(--status-rejected-fg); }

  .groups-off { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .go-head {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .go-body { margin: 0; padding: 12px; font-size: 13px; color: var(--text-2); }
  .linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--primary); text-decoration: underline; cursor: pointer; }
  .empty { margin: 0; color: var(--muted); font-size: 13px; }
</style>
