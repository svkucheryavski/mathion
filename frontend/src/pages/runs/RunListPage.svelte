<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, api } from '../../lib/api';
  import { listRuns, listVersions, deleteRun } from '../../lib/runs';
  import { runStatus } from '../../lib/runStatus';
  import { navigate } from '../../lib/router.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import NewRunModal from '../../components/runs/NewRunModal.svelte';
  import InlineConfirm from '../../components/ui/InlineConfirm.svelte';
  import type { Course, Version, RunResponse } from '../../lib/types';

  let { courseSlug }: { courseSlug: string } = $props();

  let course: Course | null = $state(null);
  let runs: RunResponse[] | null = $state(null);
  let versions: Version[] | null = $state(null);
  let loadError: string | null = $state(null);
  let showNewRun = $state(false);
  let pendingDelete: number | null = $state(null);

  const versionLabelById = $derived.by(() => {
    const map = new Map<number, string>();
    if (!versions) return map;
    const sorted = [...versions].sort((a, b) => a.created_at.localeCompare(b.created_at));
    sorted.forEach((v, idx) => {
      map.set(v.id, `v${idx + 1} (${v.created_at.slice(0, 10)})`);
    });
    return map;
  });

  const hasPublishedVersion = $derived(
    (versions as Version[] | null ?? []).some((v) => v.published_at !== null && !v.is_disabled),
  );

  async function load() {
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${courseSlug}`);
      if (!c.is_admin) {
        navigate(`/courses/${courseSlug}`);
        return;
      }
      course = c;
      const [rs, vs] = await Promise.all([
        listRuns(c.id),
        listVersions(c.id),
      ]);
      runs = rs;
      versions = vs;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        loadError = 'Course not found.';
      } else if (e instanceof ApiError && e.status === 403) {
        navigate(`/courses/${courseSlug}`);
      } else {
        loadError = e instanceof ApiError ? e.displayMessage : 'Failed to load runs.';
      }
    }
  }

  async function confirmDelete(runId: number) {
    try {
      await deleteRun(runId);
      runs = (runs ?? []).filter((r) => r.id !== runId);
      pendingDelete = null;
      pushToast('Run deleted.', 'success');
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }

  onMount(load);
</script>

{#if loadError}
  <div class="error">{loadError} <a href="/courses" onclick={(e) => { e.preventDefault(); navigate('/courses'); }}>Back to courses</a></div>
{:else if course === null || runs === null || versions === null}
  <LoadingPlaceholder label="Loading runs…" />
{:else}
  <header>
    <nav class="breadcrumb">
      <a href="/courses" onclick={(e) => { e.preventDefault(); navigate('/courses'); }}>Courses</a> › <a href={`/courses/${course.slug}`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course!.slug}`); }}>{course.name}</a> › Runs
    </nav>
    <button
      data-action="new-run"
      disabled={!hasPublishedVersion}
      title={hasPublishedVersion ? '' : 'Publish a course version before creating a run.'}
      onclick={() => (showNewRun = true)}
    >
      New run
    </button>
  </header>

  {#if runs.length === 0}
    <div class="empty">
      <p>No runs yet</p>
      <button
        data-action="create-first-run"
        disabled={!hasPublishedVersion}
        title={hasPublishedVersion ? '' : 'Publish a course version before creating a run.'}
        onclick={() => (showNewRun = true)}
      >
        Create the first run
      </button>
    </div>
  {:else}
    <table>
      <thead>
        <tr><th>Title</th><th>Status</th><th>Version</th><th>Start</th><th>End</th><th>Actions</th></tr>
      </thead>
      <tbody>
        {#each runs as run (run.id)}
          {@const status = runStatus(run)}
          <tr>
            <td><a href={`/courses/${course.slug}/runs/${run.id}`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course!.slug}/runs/${run.id}`); }}>{run.title}</a></td>
            <td><span class="badge badge-{status}">{status[0].toUpperCase() + status.slice(1)}</span></td>
            <td>{versionLabelById.get(run.version_id) ?? '—'}</td>
            <td>{run.start_date}</td>
            <td>{run.end_date}</td>
            <td>
              <a href={`/courses/${course.slug}/runs/${run.id}`} onclick={(e) => { e.preventDefault(); navigate(`/courses/${course!.slug}/runs/${run.id}`); }}>Open</a>
              {#if !run.is_published}
                {#if pendingDelete === run.id}
                  <InlineConfirm
                    confirmLabel="Confirm Delete"
                    onConfirm={() => confirmDelete(run.id)}
                    onCancel={() => (pendingDelete = null)}
                  />
                {:else}
                  <button data-action="delete-run" onclick={() => (pendingDelete = run.id)}>Delete</button>
                {/if}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if showNewRun}
    <NewRunModal course={course} versions={versions} onClose={() => (showNewRun = false)} />
  {/if}
{/if}
