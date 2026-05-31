<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { deleteMiniProject } from '../../lib/miniProjects';
  import MiniProjectModal from './MiniProjectModal.svelte';
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

  const usedBlockIds = $derived(new Set(miniProjects.map((mp) => mp.block_id)));
  const availableBlocks = $derived(blocks.filter((b) => !usedBlockIds.has(b.id)));
  const sortedRows = $derived(
    miniProjects
      .map((mp) => ({ mp, block: blocks.find((b) => b.id === mp.block_id) }))
      .filter((r) => r.block != null)
      .sort((a, b) => a.block!.order - b.block!.order),
  );

  function rowStatus(mp: MiniProjectResponse): 'draft' | 'published' | 'locked' {
    if (mp.first_submitted_at) return 'locked';
    if (mp.is_published) return 'published';
    return 'draft';
  }

  let modalMode = $state<'create' | 'edit' | null>(null);
  let editTarget = $state<MiniProjectResponse | null>(null);
  let deleteConfirmId = $state<number | null>(null);
  let forceCheckbox = $state(false);
  let deleteError = $state<string | null>(null);

  // Reset checkbox when delete-confirm switches row. Banner is NOT cleared
  // here — handlers set it AND null deleteConfirmId in the same tick, and an
  // effect tied to deleteConfirmId would wipe the banner before the user
  // sees it. Banner has its own lifecycle (handler entry + Dismiss button).
  $effect(() => {
    void deleteConfirmId;
    forceCheckbox = false;
  });

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

  async function handleForceDelete(mpId: number) {
    if (!forceCheckbox) return;
    deleteError = null;
    try {
      await deleteMiniProject(mpId, { force: true });
      await refetchAll();
      deleteConfirmId = null;
      forceCheckbox = false;
    } catch (e) {
      deleteError =
        e instanceof ApiError
          ? e.displayMessage
          : e instanceof Error
            ? e.message
            : 'Force delete failed';
      forceCheckbox = false;
    }
  }

  async function handleDeleteConfirm(mp: MiniProjectResponse) {
    deleteError = null;
    try {
      await deleteMiniProject(mp.id);
      await refetchAll();
      deleteConfirmId = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          await onRefetchMiniProjects();
          forceCheckbox = false;
          // Teachers cannot force-delete; close the inline-confirm and
          // surface a banner so they see *some* feedback instead of a
          // silent no-op (admins keep the row open so the refetch can
          // reveal the force-confirm panel).
          if (!course.is_admin) {
            deleteConfirmId = null;
            deleteError =
              'This mini-project now has submissions and cannot be deleted. Ask a course admin to force-delete.';
          }
        } catch {
          deleteError = 'Could not refresh. Please retry.';
          deleteConfirmId = null;
          forceCheckbox = false;
        }
      } else {
        deleteError =
          e instanceof ApiError
            ? e.displayMessage
            : e instanceof Error
              ? e.message
              : 'Delete failed';
        deleteConfirmId = null;
      }
    }
  }
</script>

{#if !pinnedAvailable}
  <div class="error-banner">Cannot load — pinned version not found.</div>
{:else}
  <header>
    <h2>Mini-projects</h2>
    <button
      data-action="new-mp"
      disabled={newDisabled}
      aria-disabled={newDisabled}
      title={newDisabledTitle}
      onclick={() => {
        modalMode = 'create';
      }}
    >
      + New mini-project
    </button>
  </header>

  {#if !runGroupsEnabled}
    <div class="banner">
      Mini-projects require groups.
      {#if !runIsPublished || course.is_admin}
        <button type="button" class="linklike" data-action="nav-overview-groups" onclick={() => onNavigateToTab('overview')}>Enable on Overview</button>
      {/if}
    </div>
  {/if}
  {#if versionIsDisabled}
    <div class="banner">
      This run's course version is disabled.
      {#if course.is_admin}
        <button type="button" class="linklike" data-action="nav-overview-version" onclick={() => onNavigateToTab('overview')}>See Overview</button>
      {/if}
    </div>
  {/if}
  {#if !runIsPublished}
    <div class="banner">
      Run is not yet published.
      {#if course.is_admin}
        <button type="button" class="linklike" data-action="nav-overview-publish" onclick={() => onNavigateToTab('overview')}>Publish on Overview</button>
      {/if}
    </div>
  {/if}
  {#if deleteError}
    <div class="banner banner-error" role="alert" data-role="delete-error-banner">
      {deleteError}
      <button
        data-action="dismiss-delete-error"
        onclick={() => {
          deleteError = null;
        }}
      >
        Dismiss
      </button>
    </div>
  {/if}

  {#if miniProjects.length === 0}
    <p>
      No mini-projects yet. A mini-project is a PDF assignment that each group submits and you grade.
      <strong>Click + New mini-project to assign one to a block.</strong>
    </p>
  {:else}
    <ul>
      {#each sortedRows as { mp, block } (mp.id)}
        <li data-role="mp-row">
          <span>Block {block!.order} — {block!.title}</span>
          <span class="deadlines">
            {#if mp.soft_deadline}Soft: {formatLocalWithTz(mp.soft_deadline)}{/if}
            {#if mp.hard_deadline}Hard: {formatLocalWithTz(mp.hard_deadline)}{/if}
            {#if mp.resubmission_deadline}Resub: {formatLocalWithTz(mp.resubmission_deadline)}{/if}
          </span>
          <span class="pill pill-{rowStatus(mp)}"
            >{rowStatus(mp) === 'draft'
              ? 'Draft'
              : rowStatus(mp) === 'published'
                ? 'Published'
                : 'Locked'}</span
          >
          {#if rowStatus(mp) !== 'locked'}
            <button
              data-action="edit"
              disabled={versionIsDisabled}
              aria-disabled={versionIsDisabled}
              title={versionIsDisabled ? "This run's course version is disabled." : ''}
              onclick={() => {
                editTarget = mp;
                modalMode = 'edit';
              }}>Edit</button
            >
          {/if}
          {#if course.is_admin || rowStatus(mp) !== 'locked'}
            <button
              data-action="delete"
              onclick={() => {
                deleteConfirmId = mp.id;
              }}>×</button
            >
          {/if}
          {#if deleteConfirmId === mp.id && rowStatus(mp) === 'locked' && course.is_admin}
            <div class="force-confirm">
              <p>
                Force delete will permanently remove all submissions and evaluations for this
                mini-project. This cannot be undone.
              </p>
              <label
                ><input type="checkbox" bind:checked={forceCheckbox} /> I understand</label
              >
              <button
                onclick={() => {
                  deleteConfirmId = null;
                  forceCheckbox = false;
                }}>Cancel</button
              >
              <button
                class="danger"
                disabled={!forceCheckbox}
                onclick={() => handleForceDelete(mp.id)}>Force delete</button
              >
            </div>
          {:else if deleteConfirmId === mp.id && rowStatus(mp) !== 'locked'}
            <InlineConfirm
              warning="Delete this mini-project?"
              confirmLabel="Delete"
              confirmDataAction="confirm-delete"
              onCancel={() => {
                deleteConfirmId = null;
              }}
              onConfirm={() => handleDeleteConfirm(mp)}
            />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

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
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  h2 {
    margin: 0;
  }

  .banner {
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
    background: var(--surface-muted, #f4f4f4);
    border-left: 3px solid var(--accent, #888);
    border-radius: 2px;
  }

  .linklike {
    background: none;
    border: 0;
    padding: 0;
    margin-left: 0.5rem;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .linklike:hover {
    text-decoration: none;
  }

  .banner-error {
    background: var(--surface-error, #fdecea);
    border-left-color: var(--danger, #b00020);
  }

  .error-banner {
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
    background: var(--surface-error, #fdecea);
    border-left: 3px solid var(--danger, #b00020);
    border-radius: 2px;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li[data-role='mp-row'] {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border, #e0e0e0);
    flex-wrap: wrap;
  }

  .deadlines {
    color: var(--text-muted, #666);
    font-size: 0.85em;
    display: flex;
    gap: 0.5rem;
  }

  .pill {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75em;
    background: var(--surface-muted, #eee);
  }
  .pill-published {
    background: var(--accent-soft, #d4edda);
    color: var(--accent-strong, #155724);
  }
  .pill-locked {
    background: var(--surface-locked, #e9ecef);
    color: var(--text-muted, #495057);
  }

  .force-confirm {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: var(--surface-error, #fdecea);
    border-left: 3px solid var(--danger, #b00020);
    border-radius: 2px;
  }
  .force-confirm p {
    margin: 0 0 0.5rem;
  }
  .danger {
    background: var(--danger, #b00020);
    color: white;
  }
  .danger:disabled {
    background: var(--danger-disabled, #e0a0a0);
    cursor: not-allowed;
  }
</style>
