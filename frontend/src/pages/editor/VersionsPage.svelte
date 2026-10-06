<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import Button from '../../components/ui/Button.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import VersionBadges from '../../components/editor/VersionBadges.svelte';
  import { deleteVersionReason, duplicateVersionReason } from '../../lib/editorReasons';
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
  // The page frame renders once this slug's course is known; a reload then shows
  // the Skeleton in the list position only (spec §2). A course left over from
  // another slug (in-place route change) is never shown under the new URL.
  const shownCourse = $derived(course?.slug === courseSlug ? course : null);

  // Single in-flight flag — disables every action button (Create / Open /
  // Disable / Enable / Delete) while a POST/DELETE is awaiting completion,
  // preventing double-submit / racing transitions on the same row.
  let busy = $state(false);

  // Create form — collapsed behind the `+` toggle (visual-spec §5.3).
  let creating = $state(false);
  let info_md = $state('');
  let max_quiz_attempts = $state<number | null>(3);
  let newLabel = $state('');
  let newLabelEl = $state<HTMLInputElement>();

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

  function resetCreateForm() {
    newLabel = '';
    info_md = '';
    max_quiz_attempts = 3;
  }

  async function toggleCreate() {
    if (busy) return;
    if (creating) {
      resetCreateForm();
      creating = false;
      return;
    }
    creating = true;
    await tick();
    newLabelEl?.focus();
  }

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
  let dupInputEl = $state<HTMLInputElement>();

  async function openDuplicate(v: Version) {
    duplicatingId = v.id;
    dupLabel = ('Copy of ' + (v.label || 'v' + v.id)).slice(0, 200);
    await tick();
    dupInputEl?.focus();
  }

  async function duplicateVersion(v: Version) {
    // Pin id + slug before the await (prop-change-mid-await guard, mirroring
    // createVersion above).
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

{#snippet backToCourses()}
  <Button variant="secondary" onclick={() => navigate('/courses')}>Back to courses</Button>
{/snippet}

{#snippet newVersionAction()}
  <Button onclick={() => void toggleCreate()} disabled={busy}>+ New version</Button>
{/snippet}

<div class="page">
  {#if error && !loading}
    <ErrorState variant="page" title="Couldn't load" message={error.message} action={backToCourses} />
  {:else if !shownCourse}
    {#if loading}<Skeleton rows={3} />{/if}
  {:else}
    {@const course = shownCourse}
    <div class="heading">
      <IconButton round glyph="back" title="Back to courses" onclick={() => navigate('/courses')} />
      <h1>{course.name}</h1>
    </div>
    <div class="versions-head">
      <h2>Versions</h2>
      <span class="mono count">{versions.length}</span>
      <span class="push">
        <IconButton
          primary
          glyph={creating ? 'close' : 'plus'}
          title={creating ? 'Cancel new version' : 'New version'}
          aria-label="New version"
          aria-expanded={creating}
          disabled={busy}
          onclick={() => void toggleCreate()}
        />
      </span>
    </div>
    {#if creating}
      <form class="create" onsubmit={(e) => { e.preventDefault(); createVersion(); }}>
        <label>Label (optional)
          <input class="new-label" type="text" maxlength="200" bind:value={newLabel} bind:this={newLabelEl} />
        </label>
        <label>Info (markdown)
          <textarea bind:value={info_md} rows="3"></textarea>
        </label>
        <label>Max quiz attempts
          <!-- Raw <input> — `Input.svelte` lacks min/max (spec Constraint 6). -->
          <input class="mono" type="number" min="1" max="10" step="1" required bind:value={max_quiz_attempts} />
        </label>
        <div class="submit"><Button type="submit" disabled={busy} loading={busy}>Create</Button></div>
      </form>
    {/if}
    {#if loading}
      <Skeleton rows={3} />
    {:else if versions.length === 0}
      <EmptyState
        icon="list"
        title="No versions yet"
        hint="A version holds the blocks, sequences and items students see. Create one to start authoring."
        action={creating ? undefined : newVersionAction}
      />
    {:else}
      <ul class="vlist">
        {#each versions as v (v.id)}
          {@const dupReason = duplicateVersionReason(v)}
          {@const delReason = deleteVersionReason(v)}
          <li class="vrow">
            <span class="mono vnum" class:off={v.is_disabled}>v{v.id}</span>
            {#if v.label}<span class="vlabel">{v.label}</span>{/if}
            <span class="badges"><VersionBadges state={v.state} isDisabled={v.is_disabled} /></span>
            <span class="slots">
              <IconButton size="sm" glyph="pencil" title="Open" aria-label="Open v{v.id}" disabled={busy}
                onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)} />
              <IconButton size="sm" glyph="duplicate" title={dupReason ?? 'Duplicate'} aria-label="Duplicate v{v.id}"
                disabled={busy || dupReason !== null} onclick={() => void openDuplicate(v)} />
              {#if v.is_disabled}
                <IconButton size="sm" glyph="enable" title="Enable" aria-label="Enable v{v.id}" disabled={busy}
                  onclick={() => transition(v, 'enable')} />
              {:else}
                <IconButton size="sm" glyph="disable" title="Disable" aria-label="Disable v{v.id}" disabled={busy}
                  onclick={() => transition(v, 'disable')} />
              {/if}
              <IconButton size="sm" glyph="trash" danger title={delReason ?? 'Delete'} aria-label="Delete v{v.id}"
                disabled={busy || delReason !== null} onclick={() => deleteVersion(v)} />
            </span>
          </li>
          {#if !v.is_disabled && duplicatingId === v.id}
            <li class="dup-row">
              <form class="dup" onsubmit={(e) => { e.preventDefault(); duplicateVersion(v); }}>
                <label>New draft label
                  <input class="dup-label" type="text" maxlength="200" bind:value={dupLabel} bind:this={dupInputEl} disabled={busy} />
                </label>
                <Button type="submit" disabled={busy} loading={busy}>Create copy</Button>
                <Button variant="ghost" onclick={() => (duplicatingId = null)} disabled={busy}>Cancel</Button>
              </form>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  /* h1 / h2 metrics come from base.css (21px/600/-.015em, 15px/600 — ref 1474, 1477). */
  .heading { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; /* ref 1472 */ }
  .versions-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; /* ref 1476 */ }
  .count { font-size: 11.5px; /* ref 1478 */ color: var(--muted); }
  .push { margin-left: auto; display: flex; /* ref 1479 */ }
  .create {
    display: flex;
    flex-direction: column;
    gap: 8px; /* the 8px create-form gap (spec §4 Create forms) */
    padding: 14px;
    margin-bottom: 12px; /* the list's 12px rhythm (ref 1476) */
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .create label,
  .dup label { display: flex; flex-direction: column; gap: 4px; /* the 4px label/field step */ font-size: 12.5px; color: var(--muted); }
  .create input,
  .create textarea,
  .dup input {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .create input,
  .dup input { height: var(--control-h); padding: 0 10px; }
  .create textarea { padding: 8px 10px; }
  .submit { display: flex; justify-content: flex-end; }
  .vlist {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden; /* ref 1481 */
  }
  .vrow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px 9px 14px; /* ref 1482 */
    border-bottom: 1px solid var(--border-soft);
  }
  .vlist > li:last-child { border-bottom: 0; }
  .vnum { font-size: 13px; /* ref 1483 */ color: var(--text); }
  /* D5: a disabled version recedes by its number dropping to --muted (ref 1495). */
  .vnum.off { color: var(--muted); }
  .vlabel { font-size: 13px; /* ref 1484 */ color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
  .badges { margin-left: auto; display: flex; /* ref 1485 */ }
  .slots { display: flex; gap: 6px; margin-left: 22px; /* ref 1486 */ }
  .dup-row {
    padding: 9px 12px 9px 14px; /* the row inset (ref 1482) */
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-soft);
  }
  .dup { display: flex; align-items: flex-end; gap: 8px; /* the 8px create-form gap */ }
  .dup label { flex: 1; min-width: 0; }
</style>
