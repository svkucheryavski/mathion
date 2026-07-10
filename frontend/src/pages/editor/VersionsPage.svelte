<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { Version } from '../../lib/types';
  import {
    loadVersionsPage,
    versionsPageState,
    resetVersionsPageState,
  } from '../../lib/versionsPageLoader.svelte';

  let { courseSlug }: { courseSlug: string } = $props();

  // Reactive aliases over the module-scoped store. Routing slugs change in
  // place (App.svelte rebinds `courseSlug` rather than remounting), so the
  // store's stale-response guard prevents an in-flight 'a' from clobbering
  // a freshly-loaded 'b' — see versionsPageLoader.svelte.ts header.
  const course = $derived(versionsPageState.course);
  const versions = $derived(versionsPageState.versions);
  const loading = $derived(versionsPageState.loading);
  const error = $derived(versionsPageState.error);

  // Single in-flight flag — disables every action button (Create / Open /
  // Disable / Enable / Delete) while a POST/DELETE is awaiting completion,
  // preventing double-submit / racing transitions on the same row.
  let busy = $state(false);

  // Create form
  let creating = $state(false);
  let info_md = $state('');
  let max_quiz_attempts = $state<number | null>(3);
  let newLabel = $state('');

  async function load() {
    await loadVersionsPage(courseSlug);
  }

  // Re-runs whenever `courseSlug` changes — App.svelte updates the prop in
  // place rather than remounting the component, so onMount(load) would only
  // fire on the first slug. (Same pattern as CourseView.svelte:14.)
  $effect(() => {
    void courseSlug;
    void load();
  });

  // Reset module state on unmount so a fresh entry doesn't briefly render the
  // previous course's data before its own fetch resolves. Mirrors
  // VersionEditPage's clearEditorVersion onDestroy.
  onDestroy(() => resetVersionsPageState());

  async function createVersion() {
    if (!course) return;
    // bind:value on <input type="number"> yields null when empty and NaN on
    // partial input; decimals (e.g. 5.5) parse cleanly but the backend
    // requires int (Pydantic ge=1/le=10) and 422s with an opaque message.
    // Validate client-side before POST.
    const n = max_quiz_attempts;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) {
      pushToast('Max quiz attempts must be a whole number between 1 and 10', 'error');
      return;
    }
    // Pin course.id + slug at POST-start. A prop-change mid-await would
    // otherwise let `course.id` (the route field reactively rebound) and
    // `courseSlug` drift to the new course, sending the user to the wrong
    // edit page after a race.
    const savedCourseId = course.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      const v = await api.post<Version>(`/api/courses/${savedCourseId}/versions`, { info_md, max_quiz_attempts: n, label: newLabel });
      navigate(`/courses/${savedSlug}/edit/v/${v.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Failed to create version';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  async function transition(v: Version, action: 'disable' | 'enable') {
    // Spec §8: all state transitions follow confirm → POST → refetch / toast.
    const verb = action === 'disable' ? 'Disable' : 'Enable';
    if (!confirm(`${verb} version ${v.id}?`)) return;
    // Pin `v.id` already (closure arg). load() pins courseSlug internally, so
    // a prop-change mid-await re-loads the original course's list, not the
    // newly-routed-in slug.
    busy = true;
    try {
      await api.post(`/api/versions/${v.id}/${action}`);
      await load();
      // Close a stale duplicate form on this row after any transition. The row
      // just changed state; a concurrent disable may have hidden the form via
      // the render guard, and a later enable must not spuriously re-open it.
      if (duplicatingId === v.id) duplicatingId = null;
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : `Could not ${action}`;
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  async function deleteVersion(v: Version) {
    if (!confirm(`Delete draft version ${v.id}? This cannot be undone.`)) return;
    busy = true;
    try {
      await api.delete(`/api/versions/${v.id}`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not delete';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  // Duplicate: per-row inline state. `duplicatingId` enforces a single open
  // row; `dupLabel` is the bound input value (clamped to 200 in JS — HTML
  // maxlength only bounds typing, not a programmatically-assigned value).
  let duplicatingId = $state<number | null>(null);
  let dupLabel = $state('');

  function openDuplicate(v: Version) {
    duplicatingId = v.id;
    dupLabel = ('Copy of ' + (v.label || 'v' + v.id)).slice(0, 200);
  }

  async function duplicateVersion(v: Version) {
    // Pin id + slug before the await (prop-change-mid-await guard, mirroring
    // createVersion at lines 68-69).
    const savedId = v.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      const nv = await api.post<Version>(`/api/versions/${savedId}/duplicate`, { label: dupLabel });
      pushToast('Version duplicated', 'success');
      navigate(`/courses/${savedSlug}/edit/v/${nv.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Failed to duplicate version';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="page">
  {#if loading}
    <Spinner />
  {:else if error}
    <h1>Couldn't load</h1>
    <p>{error.message}</p>
    <Button variant="ghost" onclick={() => navigate('/courses')}>← Back to courses</Button>
  {:else if course}
    <header>
      <Button variant="ghost" onclick={() => navigate('/courses')}>← Courses</Button>
      <h1>Edit · {course.name}</h1>
    </header>
    <section class="versions">
      <div class="head">
        <h2>Versions</h2>
        <Button onclick={() => (creating = !creating)} disabled={busy}>{creating ? 'Cancel' : '+ New version'}</Button>
      </div>
      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); createVersion(); }}>
          <label>Label (optional)
            <input class="new-label" type="text" maxlength="200" bind:value={newLabel} />
          </label>
          <label>Info (markdown)
            <textarea bind:value={info_md} rows="3"></textarea>
          </label>
          <label>Max quiz attempts
            <!-- Raw <input> — `Input.svelte` doesn't accept min/max; opening it up
                 would be unrelated work. Native browser validation gives min/max bounds. -->
            <input type="number" min="1" max="10" step="1" required bind:value={max_quiz_attempts} />
          </label>
          <Button type="submit" disabled={busy} loading={busy}>Create</Button>
        </form>
      {/if}
      {#if versions.length === 0}
        <p class="empty">No versions yet. Create one to start authoring.</p>
      {:else}
        <ul>
          {#each versions as v (v.id)}
            <li class="row">
              <div>
                <strong>v{v.id}</strong>
                {#if v.label}<span class="vlabel">{v.label}</span>{/if}
                <span class="badge state-{v.state}">{v.state}</span>
                {#if v.is_disabled}<span class="badge disabled">disabled</span>{/if}
              </div>
              <div class="actions">
                <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)} disabled={busy}>Open</Button>
                {#if v.is_disabled}
                  <Button variant="ghost" onclick={() => transition(v, 'enable')} disabled={busy}>Enable</Button>
                {:else}
                  <Button variant="ghost" onclick={() => transition(v, 'disable')} disabled={busy}>Disable</Button>
                  <Button variant="ghost" onclick={() => openDuplicate(v)} disabled={busy}>Duplicate</Button>
                {/if}
                {#if v.state === 'created' && !v.is_disabled}
                  <Button variant="ghost" onclick={() => deleteVersion(v)} disabled={busy}>Delete</Button>
                {/if}
              </div>
            </li>
            {#if !v.is_disabled && duplicatingId === v.id}
              <li class="dup-row">
                <form class="dup" onsubmit={(e) => { e.preventDefault(); duplicateVersion(v); }}>
                  <label>New draft label
                    <input class="dup-label" type="text" maxlength="200" bind:value={dupLabel} disabled={busy} />
                  </label>
                  <Button type="submit" disabled={busy} loading={busy}>Create copy</Button>
                  <Button variant="ghost" onclick={() => (duplicatingId = null)} disabled={busy}>Cancel</Button>
                </form>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; margin-left: var(--space-2); }
  .badge.state-created { background: #ffeac0; color: #663; }
  .badge.state-published { background: #ddf3dd; color: #265; }
  .badge.state-archived { background: #eee; color: #555; }
  .badge.disabled { background: #fdd; color: #833; }
  .create { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-3); }
  textarea { width: 100%; }
  .empty { color: var(--muted); }
  .vlabel { font-size: 0.85rem; color: var(--muted); margin-left: var(--space-2); }
  .dup-row { padding: 0 0 var(--space-2); }
  .dup { display: flex; align-items: flex-end; gap: var(--space-2); flex-wrap: wrap; }
  .dup input { min-width: 240px; }
</style>
