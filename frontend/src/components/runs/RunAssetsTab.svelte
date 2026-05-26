<script lang="ts">
  import type {
    Course,
    MiniProjectResponse,
    RunAssetResponse,
  } from '../../lib/types';
  import { formatFileSize } from '../../lib/format';
  import { formatLocalWithTz } from '../../lib/datetime';

  let {
    runId,
    assets,
    miniProjects,
    course,
    versionIsDisabled,
    onRefetchAssets,
    onRefetchMiniProjects,
    onEditMiniProject,
    onReloadRun,
  }: {
    runId: number;
    assets: RunAssetResponse[];
    miniProjects: MiniProjectResponse[];
    course: Course;
    versionIsDisabled: boolean;
    onRefetchAssets: () => Promise<void>;
    onRefetchMiniProjects: () => Promise<void>;
    onEditMiniProject: (mp: MiniProjectResponse) => void;
    onReloadRun: () => Promise<void>;
  } = $props();

  function serveUrl(filename: string): string {
    return `/api/runs/${runId}/assets/${encodeURIComponent(filename)}`;
  }
</script>

<!-- T6 skeleton accepts 7 props that T7-T12 will progressively wire. The
     placeholder block below references each one so svelte-check accepts the
     skeleton (noUnusedLocals: true). Each line is removed as the corresponding
     task lands its real usage. Svelte dead-strips {#if false}. -->
{#if false}
  <span aria-hidden="true">
    {miniProjects.length} {course.name} {versionIsDisabled}
    <button onclick={() => onRefetchAssets()}>x</button>
    <button onclick={() => onRefetchMiniProjects()}>x</button>
    <button onclick={() => onReloadRun()}>x</button>
    <button onclick={() => miniProjects[0] && onEditMiniProject(miniProjects[0])}>x</button>
  </span>
{/if}

<section class="run-assets-tab">
  {#if assets.length === 0}
    <div class="empty-state">
      <p>No assets yet. Drop files here or click + Upload.</p>
    </div>
  {:else}
    <table class="assets-table">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" disabled aria-label="Select all" /></th>
          <th scope="col">Filename</th>
          <th scope="col">Size</th>
          <th scope="col">Uploaded</th>
          <th scope="col">Uploaded by</th>
          <th scope="col">Uses</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each assets as a (a.id)}
          <tr data-asset-id={a.id}>
            <td><input type="checkbox" aria-label="Select {a.filename}" /></td>
            <td>
              <a href={serveUrl(a.filename)} target="_blank" rel="noopener noreferrer">
                {a.filename}
              </a>
            </td>
            <td>{formatFileSize(a.file_size)}</td>
            <td>{formatLocalWithTz(a.uploaded_at)}</td>
            <td>{a.uploaded_by_email ?? '—'}</td>
            <td>—</td>
            <td>—</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .run-assets-tab {
    padding: 1rem 0;
  }
  .empty-state {
    padding: 2rem;
    text-align: center;
    color: #666;
  }
  .assets-table {
    width: 100%;
    border-collapse: collapse;
  }
  .assets-table th,
  .assets-table td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #eee;
  }
  .assets-table th {
    background: #fafafa;
    font-weight: 600;
  }
</style>
