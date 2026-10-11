<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ApiError, api } from '../../lib/api';
  import { listRuns, listVersions, deleteRun } from '../../lib/runs';
  import { listTeachingRuns, type TeachingRunRow } from '../../lib/teaching';
  import { runStatus } from '../../lib/runStatus';
  import { formatShortDate } from '../../lib/datetime';
  import { focusFirst } from '../../lib/focusFirst';
  import { navigate } from '../../lib/router.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import NewRunModal from '../../components/runs/NewRunModal.svelte';
  import InlineConfirm from '../../components/ui/InlineConfirm.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Button from '../../components/ui/Button.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import RunStatusChip from '../../components/runs/RunStatusChip.svelte';
  import TeachingCrumbs from '../../components/runs/TeachingCrumbs.svelte';
  import type { Course, Version, RunResponse } from '../../lib/types';

  let { courseSlug }: { courseSlug: string } = $props();

  const NEW_RUN_REASON = 'Publish a course version before creating a run.';

  let course = $state<Course | null>(null);
  // Admin view (10e): the course's runs and versions. Teacher view (R5): the
  // runs of this course they teach, from the Teaching list.
  let runs = $state<RunResponse[] | null>(null);
  let versions = $state<Version[] | null>(null);
  let teacherRows = $state<TeachingRunRow[] | null>(null);
  let loadError = $state<{ title: string; page: boolean } | null>(null);
  let showNewRun = $state(false);
  let pendingDelete = $state<number | null>(null);

  let headingEl = $state<HTMLElement>();
  let newRunEl = $state<HTMLButtonElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  const versionById = $derived(new Map((versions ?? []).map((v) => [v.id, v])));
  const hasPublishedVersion = $derived(
    (versions ?? []).some((v) => v.published_at !== null && !v.is_disabled),
  );
  const count = $derived(course?.is_admin ? (runs?.length ?? 0) : (teacherRows?.length ?? 0));
  const runHref = (id: number) => `/teaching/${course!.slug}/runs/${id}`;

  async function load() {
    loadError = null;
    course = null; runs = null; versions = null; teacherRows = null;
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${courseSlug}`);
      if (c.is_admin) {
        const [rs, vs] = await Promise.all([listRuns(c.id), listVersions(c.id)]);
        runs = rs; versions = vs;
      } else {
        teacherRows = (await listTeachingRuns()).filter((r) => r.course_id === c.id);
      }
      course = c;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        loadError = { title: 'Course not found.', page: true };
      } else if (e instanceof ApiError && e.status === 403) {
        loadError = { title: "You don't have access to this course's runs.", page: true };
      } else {
        loadError = { title: e instanceof ApiError ? e.displayMessage : 'Failed to load runs.', page: false };
      }
    }
  }

  async function cancelDelete(runId: number) {
    pendingDelete = null;
    await tick();
    trashEls[runId]?.focus();
  }

  // §Focus: on success the next row's trash, then the previous row's, then +,
  // then the h1; on failure back to this row's trash.
  async function confirmDelete(runId: number) {
    const before = runs ?? [];
    const idx = before.findIndex((r) => r.id === runId);
    try {
      await deleteRun(runId);
      runs = before.filter((r) => r.id !== runId);
      pendingDelete = null;
      pushToast('Run deleted.', 'success');
      await tick();
      const next = runs[idx];
      const prev = idx > 0 ? runs[idx - 1] : undefined;
      focusFirst([next && trashEls[next.id], prev && trashEls[prev.id], newRunEl, headingEl]);
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
      await tick();
      trashEls[runId]?.focus();
    }
  }

  function go(e: MouseEvent, href: string) {
    e.preventDefault();
    void navigate(href);
  }

  onMount(load);
</script>

{#snippet backToTeaching()}
  <a href="/teaching" onclick={(e) => go(e, '/teaching')}>Back to Teaching</a>
{/snippet}

{#snippet firstRun()}
  <Button variant="primary" data-action="create-first-run" disabled={!hasPublishedVersion}
          title={hasPublishedVersion ? undefined : NEW_RUN_REASON} onclick={() => (showNewRun = true)}>Create the first run</Button>
{/snippet}

<div class="runs-page">
  {#if loadError?.page}
    <ErrorState variant="page" title={loadError.title} action={backToTeaching} />
  {:else if loadError}
    <ErrorState title={loadError.title} onretry={load} retryLabel="Try again" />
  {:else if course === null || (course.is_admin ? runs === null || versions === null : teacherRows === null)}
    <LoadingPlaceholder label="Loading runs…" />
  {:else}
    <TeachingCrumbs course={course} />
    <div class="runs-head">
      <h1 tabindex="-1" bind:this={headingEl}>Runs <span class="runs-count">{count}</span></h1>
      {#if course.is_admin}
        <IconButton glyph="plus" primary size="md" aria-label="New run" data-action="new-run"
                    title={hasPublishedVersion ? 'New run' : NEW_RUN_REASON}
                    disabled={!hasPublishedVersion} bind:element={newRunEl}
                    onclick={() => (showNewRun = true)} />
      {/if}
    </div>

    {#if course.is_admin && runs}
      {#if runs.length === 0}
        <EmptyState title="No runs yet" action={firstRun} />
      {:else}
        <table class="runs-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Version</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
              <th scope="col" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {#each runs as run (run.id)}
              {@const status = runStatus(run)}
              {@const v = versionById.get(run.version_id)}
              <tr>
                <td><a href={runHref(run.id)} onclick={(e) => go(e, runHref(run.id))}>{run.title}</a></td>
                <td><RunStatusChip {status} /></td>
                <td>{#if v?.label}{v.label}{' '}·{' '}{/if}<span class="ver-id">v. {run.version_id}</span></td>
                <td class="num">{formatShortDate(run.start_date)}</td>
                <td class="num">{formatShortDate(run.end_date)}</td>
                <td class="row-actions">
                  {#if pendingDelete === run.id}
                    <InlineConfirm takeFocus label="Delete run {run.title}?" confirmLabel="Confirm Delete"
                                   onConfirm={() => confirmDelete(run.id)}
                                   onCancel={() => cancelDelete(run.id)} />
                  {:else}
                    <IconButton glyph="trash" size="sm" danger data-action="delete-run"
                                aria-label="Delete run {run.title}"
                                title={status === 'draft' ? 'Delete' : 'Only a draft run can be deleted'}
                                disabled={status !== 'draft'} bind:element={trashEls[run.id]}
                                onclick={() => (pendingDelete = run.id)} />
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if teacherRows}
      {#if teacherRows.length === 0}
        <EmptyState title="No runs yet" />
      {:else}
        <table class="runs-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Students</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
            </tr>
          </thead>
          <tbody>
            {#each teacherRows as row (row.run.id)}
              <tr>
                <td><a href={runHref(row.run.id)} onclick={(e) => go(e, runHref(row.run.id))}>{row.run.title}</a></td>
                <td><RunStatusChip status={runStatus(row.run)} /></td>
                <td class="num">{row.student_count}</td>
                <td class="num">{formatShortDate(row.run.start_date)}</td>
                <td class="num">{formatShortDate(row.run.end_date)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}

    {#if showNewRun && versions}
      <NewRunModal course={course} versions={versions} onClose={() => (showNewRun = false)} />
    {/if}
  {/if}
</div>

<style>
  .runs-page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3) var(--space-3) var(--space-4); }
  .runs-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0 14px; }
  .runs-head h1 { margin: 0; font-size: 22px; font-weight: 600; color: var(--text); }
  .runs-head h1:focus { outline: none; }
  .runs-count { font-family: var(--font-mono); font-size: 13px; font-weight: 400; color: var(--muted); }
  .runs-table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .runs-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
  }
  .runs-table td { padding: 8px 12px; border-top: 1px solid var(--border-soft); font-size: 13px; color: var(--text-2); vertical-align: middle; }
  .runs-table td a { color: var(--primary); text-decoration: none; }
  .runs-table td a:hover { text-decoration: underline; }
  .ver-id, .num { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
  .row-actions { text-align: right; white-space: nowrap; }
</style>
