<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { deadlinesHeader, formatLocalWithTz, formatShortDeadline } from '../../lib/datetime';
  import { deleteMiniProject } from '../../lib/miniProjects';
  import { blockPositions } from '../../lib/blockNumbers';
  import { focusFirst } from '../../lib/focusFirst';
  import MiniProjectModal from './MiniProjectModal.svelte';
  import Button from '../ui/Button.svelte';
  import DangerConfirm from '../ui/DangerConfirm.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { Course, MiniProjectResponse, BlockResponse } from '../../lib/types';

  let {
    runId,
    runIsPublished,
    runGroupsEnabled,
    runEndDate,
    versionIsDisabled,
    pinnedAvailable,
    blocks,
    miniProjects,
    onRefetchMiniProjects,
    onRefetchAssets,
    onNavigateToTab,
    pendingEditTarget,
    onPendingEditConsumed,
    course,
  }: {
    runId: number;
    runIsPublished: boolean;
    runGroupsEnabled: boolean;
    runEndDate: string | null;
    versionIsDisabled: boolean;
    pinnedAvailable: boolean;
    blocks: BlockResponse[];
    miniProjects: MiniProjectResponse[];
    onRefetchMiniProjects: () => Promise<void>;
    onRefetchAssets?: () => Promise<void>;
    onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster' | 'assets') => void;
    pendingEditTarget?: MiniProjectResponse | null;
    onPendingEditConsumed?: () => void;
    course: Course;
  } = $props();

  async function refetchAll(): Promise<void> {
    await Promise.all([
      onRefetchMiniProjects(),
      onRefetchAssets?.() ?? Promise.resolve(),
    ]);
  }

  type Status = 'draft' | 'published' | 'locked';
  type Row = { mp: MiniProjectResponse; n: number; label: string; aria: string };

  const usedBlockIds = $derived(new Set(miniProjects.map((mp) => mp.block_id)));
  const availableBlocks = $derived(blocks.filter((b) => !usedBlockIds.has(b.id)));
  // R13: "Block {n}" is the block's position in the pinned version. A
  // mini-project whose block is not in the list is not shown (as before).
  const rows = $derived.by((): Row[] => {
    const pos = blockPositions(blocks);
    const out: Row[] = [];
    for (const mp of miniProjects) {
      const block = blocks.find((b) => b.id === mp.block_id);
      const n = pos.get(mp.block_id);
      if (block && n !== undefined) {
        out.push({ mp, n, label: `Block ${n} — ${block.title}`, aria: `mini-project for Block ${n}` });
      }
    }
    return out.sort((a, b) => a.n - b.n);
  });

  function rowStatus(mp: MiniProjectResponse): Status {
    if (mp.first_submitted_at) return 'locked';
    if (mp.is_published) return 'published';
    return 'draft';
  }

  function deadlineParts(mp: MiniProjectResponse): { kind: string; iso: string }[] {
    const parts: { kind: string; iso: string }[] = [];
    if (mp.soft_deadline) parts.push({ kind: 'soft', iso: mp.soft_deadline });
    if (mp.hard_deadline) parts.push({ kind: 'hard', iso: mp.hard_deadline });
    if (mp.resubmission_deadline) parts.push({ kind: 'resub', iso: mp.resubmission_deadline });
    return parts;
  }

  // R12: one zone in the header when every shown deadline shares it.
  const dlHeader = $derived(deadlinesHeader(rows.flatMap((r) => deadlineParts(r.mp).map((p) => p.iso))));

  function editReason(mp: MiniProjectResponse): string | undefined {
    if (rowStatus(mp) === 'locked') return 'Has submissions — editing is off';
    if (versionIsDisabled) return "This run's course version is disabled.";
    return undefined;
  }

  let modalMode = $state<'create' | 'edit' | null>(null);
  let editTarget = $state<MiniProjectResponse | null>(null);
  let deleteConfirmId = $state<number | null>(null);
  let forceBusy = $state(false);
  let deleteError = $state<string | null>(null);

  let headingEl = $state<HTMLElement>();
  let newEl = $state<HTMLButtonElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  // Parent (RunDetailPage) hands us a MP to open in edit mode when the
  // Assets tab's [Edit] action navigates here. Stale-cascade safe: if the
  // MP is no longer in our local list (refetch dropped it), we skip
  // opening the modal but still fire onPendingEditConsumed so the parent
  // clears the dangling reference. The early-return on null prevents
  // re-entry once the parent clears pendingEditTarget.
  $effect(() => {
    if (!pendingEditTarget) return;
    const target = pendingEditTarget;
    const stillExists = miniProjects.some((mp) => mp.id === target.id);
    if (stillExists) {
      editTarget = target;
      modalMode = 'edit';
    }
    onPendingEditConsumed?.();
  });

  const newDisabled = $derived(
    !runGroupsEnabled || versionIsDisabled || availableBlocks.length === 0,
  );
  // Role-aware tooltip per spec §3.2.4. Teachers viewing a *published* run
  // cannot un-publish or enable groups themselves, so the affordance copy
  // routes them to a course admin; in any other state they (and admins) can
  // act on Overview directly.
  const newDisabledTitle = $derived.by(() => {
    if (!runGroupsEnabled) {
      return (!runIsPublished || course.is_admin)
        ? 'Mini-projects require groups. Enable groups on Overview.'
        : 'Mini-projects require groups. Ask a course admin to unpublish the run and enable groups.';
    }
    if (versionIsDisabled) return "This run's course version is disabled.";
    if (availableBlocks.length === 0)
      return 'All blocks in this course version already have a mini-project.';
    return '';
  });

  async function focusTrash(mpId: number) {
    await tick();
    trashEls[mpId]?.focus();
  }

  // §Focus after a removal: the next row's trash, the previous row's, +, the h2.
  async function focusAfterRemoval(idx: number) {
    await tick();
    const next = rows[idx];
    const prev = idx > 0 ? rows[idx - 1] : undefined;
    focusFirst([next && trashEls[next.mp.id], prev && trashEls[prev.mp.id], newEl, headingEl]);
  }

  function cancelDelete(mpId: number) {
    deleteConfirmId = null;
    void focusTrash(mpId);
  }

  async function handleForceDelete(mpId: number) {
    const idx = rows.findIndex((r) => r.mp.id === mpId);
    deleteError = null;
    forceBusy = true;
    try {
      await deleteMiniProject(mpId, { force: true });
      await refetchAll();
      deleteConfirmId = null;
      forceBusy = false;
      await focusAfterRemoval(idx);
    } catch (e) {
      deleteError =
        e instanceof ApiError
          ? e.displayMessage
          : e instanceof Error
            ? e.message
            : 'Force delete failed';
      forceBusy = false;
      await focusTrash(mpId);
    }
  }

  async function handleDeleteConfirm(mp: MiniProjectResponse) {
    const idx = rows.findIndex((r) => r.mp.id === mp.id);
    deleteError = null;
    try {
      await deleteMiniProject(mp.id);
      await refetchAll();
      deleteConfirmId = null;
      await focusAfterRemoval(idx);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          await onRefetchMiniProjects();
          // Teachers cannot force-delete; close the inline-confirm and
          // surface a banner so they see *some* feedback instead of a
          // silent no-op (admins keep the row open so the refetch can
          // reveal the danger panel).
          if (!course.is_admin) {
            deleteConfirmId = null;
            deleteError =
              'This mini-project now has submissions and cannot be deleted. Ask a course admin to force-delete.';
            await focusTrash(mp.id);
          }
        } catch {
          deleteError = 'Could not refresh. Please retry.';
          deleteConfirmId = null;
          await focusTrash(mp.id);
        }
      } else {
        deleteError =
          e instanceof ApiError
            ? e.displayMessage
            : e instanceof Error
              ? e.message
              : 'Delete failed';
        deleteConfirmId = null;
        await focusTrash(mp.id);
      }
    }
  }
</script>

{#snippet forceMessage()}Force delete will permanently remove all submissions and evaluations for this mini-project. This cannot be undone.{/snippet}

{#if !pinnedAvailable}
  <div class="mp-banner mp-banner-err" role="alert">Cannot load — pinned version not found.</div>
{:else}
  <section class="mp-tab">
    <div class="sec-head">
      <h2 tabindex="-1" bind:this={headingEl}>Mini-projects <span class="sec-count">{rows.length} of {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}</span></h2>
      <IconButton glyph="plus" primary size="md" aria-label="New mini-project"
                  title={newDisabled ? newDisabledTitle : 'New mini-project'} disabled={newDisabled}
                  data-action="new-mp" bind:element={newEl} onclick={() => (modalMode = 'create')} />
    </div>

    {#if versionIsDisabled && course.is_admin}
      <p class="mp-note">
        <button type="button" class="linklike" data-action="nav-overview-version" onclick={() => onNavigateToTab('overview')}>See Overview</button>
      </p>
    {/if}
    {#if !runGroupsEnabled}
      <div class="mp-banner">
        Mini-projects require groups.
        {#if !runIsPublished || course.is_admin}
          <button type="button" class="linklike" data-action="nav-overview-groups" onclick={() => onNavigateToTab('overview')}>Enable on Overview</button>
        {/if}
      </div>
    {/if}
    {#if !runIsPublished}
      <div class="mp-banner">
        Run is not yet published.
        {#if course.is_admin}
          <button type="button" class="linklike" data-action="nav-overview-publish" onclick={() => onNavigateToTab('overview')}>Publish on Overview</button>
        {/if}
      </div>
    {/if}
    {#if deleteError}
      <div class="mp-banner mp-banner-err" role="alert" data-role="delete-error-banner">
        <span>{deleteError}</span>
        <Button variant="ghost" data-action="dismiss-delete-error" onclick={() => (deleteError = null)}>Dismiss</Button>
      </div>
    {/if}

    {#if rows.length === 0}
      <p class="mp-empty">
        No mini-projects yet. A mini-project is a PDF assignment that each group submits and you grade.
        <strong>Click + New mini-project to assign one to a block.</strong>
      </p>
    {:else}
      <table class="mp-table">
        <thead>
          <tr>
            <th scope="col">Block</th>
            <th scope="col">{dlHeader}</th>
            <th scope="col">State</th>
            <th scope="col"><span class="vh">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.mp.id)}
            {@const status = rowStatus(r.mp)}
            {@const reason = editReason(r.mp)}
            <tr data-role="mp-row">
              <td class="mp-block">{r.label}</td>
              <td class="mp-dl">
                {#each deadlineParts(r.mp) as p, i (p.kind)}
                  {#if i > 0}<span class="mp-sep" aria-hidden="true">·</span>{/if}
                  <span class="dl" title={formatLocalWithTz(p.iso)}>{p.kind} {formatShortDeadline(p.iso)}</span>
                {/each}
              </td>
              <td><span class="mp-chip chip-{status}">{status}</span></td>
              <td class="mp-actions">
                {#if deleteConfirmId === r.mp.id && status !== 'locked'}
                  <InlineConfirm takeFocus warning="Delete this mini-project?" confirmLabel="Delete"
                                 confirmDataAction="confirm-delete"
                                 onCancel={() => cancelDelete(r.mp.id)} onConfirm={() => handleDeleteConfirm(r.mp)} />
                {/if}
                <span class="row-icons">
                  <IconButton glyph="pencil" size="sm" aria-label="Edit {r.aria}" title={reason ?? 'Edit'}
                              disabled={reason !== undefined} data-action="edit"
                              onclick={() => { editTarget = r.mp; modalMode = 'edit'; }} />
                  <IconButton glyph="trash" size="sm" danger aria-label="Delete {r.aria}" title="Delete"
                              data-action="delete" bind:element={trashEls[r.mp.id]}
                              onclick={() => (deleteConfirmId = r.mp.id)} />
                </span>
              </td>
            </tr>
            {#if deleteConfirmId === r.mp.id && status === 'locked'}
              <tr class="mp-panel-row">
                <td colspan="4">
                  <DangerConfirm message={forceMessage} busy={forceBusy}
                                 disabledReason={course.is_admin ? undefined : 'Only a course admin can force delete.'}
                                 onConfirm={() => handleForceDelete(r.mp.id)} onCancel={() => cancelDelete(r.mp.id)} />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if modalMode != null}
    <MiniProjectModal
      {runId}
      mode={modalMode}
      initial={editTarget}
      availableBlocks={modalMode === 'create' ? availableBlocks : []}
      currentBlock={editTarget ? (blocks.find((b) => b.id === editTarget!.block_id) ?? null) : null}
      {runIsPublished}
      {versionIsDisabled}
      {runEndDate}
      {course}
      onClose={() => {
        modalMode = null;
        editTarget = null;
      }}
      onSaved={refetchAll}
      {onNavigateToTab}
    />
  {/if}
{/if}

<style>
  .mp-tab { display: flex; flex-direction: column; gap: 10px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }

  .mp-note { margin: 0; font-size: 12.5px; color: var(--muted); }
  .mp-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text-2);
  }
  .mp-banner-err {
    justify-content: space-between;
    background: var(--status-rejected-bg);
    border-left-color: var(--danger);
    color: var(--status-rejected-fg);
  }
  .linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--primary); text-decoration: underline; cursor: pointer; }
  .mp-empty { margin: 0; font-size: 13px; color: var(--muted); }

  .mp-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); font-size: 13px; }
  .mp-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .mp-table td { padding: 6px 12px; border-top: 1px solid var(--border-soft); color: var(--text); vertical-align: middle; }
  .mp-dl { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-2); white-space: nowrap; }
  .mp-sep { margin: 0 6px; color: var(--faint); }
  .mp-actions { width: 1%; white-space: nowrap; text-align: right; }
  .row-icons { display: inline-flex; gap: 4px; }
  .mp-panel-row td { padding: 0 12px 10px; border-top: 0; }

  .mp-chip { display: inline-block; padding: 1px 8px; border-radius: var(--radius-pill); font-size: 11.5px; }
  .chip-draft { background: var(--state-created-bg); color: var(--state-created-fg); }
  .chip-published { background: var(--state-published-bg); color: var(--state-published-fg); }
  .chip-locked { background: var(--state-archived-bg); color: var(--state-archived-fg); }

  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
