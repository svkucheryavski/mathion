<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
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
  import AskSlot from '../../components/ui/AskSlot.svelte';
  import { InPlaceAsk, DISCARD_ASK, focusAfter, firstUsable, settleTo, moveOn, withdraw, type Ask } from '../../lib/askInPlace.svelte';
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

  // Polish 1: the create form's question (#16) in place of its Cancel/Create,
  // and one question for the list (#17, #18) under the row that asked, keyed
  // by version id (R53).
  const createAsk = new InPlaceAsk();
  const rowAsk = new InPlaceAsk();
  let h1El = $state<HTMLHeadingElement>();
  const toggleBtn = (id: number) => document.getElementById(`v-${id}-toggle`);
  const trashBtn = (id: number) => document.getElementById(`v-${id}-delete`);

  // R49: a row question goes with its row — a reload (the Skeleton takes the
  // list) or another course. Focus that was in it waits on the <h1>.
  $effect(() => {
    const k = rowAsk.current?.key;
    if (k === undefined) return;
    if (loading || !versions.some((x) => x.id === k)) {
      untrack(() => {
        const free = rowAsk.focusFree;
        rowAsk.dismiss();
        if (free) void focusAfter(() => h1El);
      });
    }
  });

  // Create form — collapsed behind the "+ Add version" line under the list
  // (5c follow-up: the editor's add lines; it was a `+` in the Versions row).
  let creating = $state(false);
  let addLineEl = $state<HTMLButtonElement>();
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
  onDestroy(() => { createAsk.dismiss(); rowAsk.dismiss(); resetVersionsPageState(); });

  function resetCreateForm() {
    newLabel = '';
    info_md = '';
    max_quiz_attempts = 3;
  }

  async function openCreate() {
    if (busy || creating) return;
    creating = true;
    await tick();
    newLabelEl?.focus();
  }

  async function cancelCreate() {
    resetCreateForm();
    creating = false;
    await tick();
    addLineEl?.focus();
  }

  // Escape in a field cancels, as the editor's add rows do — but a stray
  // Escape must not silently drop typed input (final review): then it asks,
  // in place of Cancel/Create (#16). Cancel returns to the field.
  const createDirty = () => newLabel !== '' || info_md !== '' || max_quiz_attempts !== 3;
  async function escCancels(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.isComposing || busy) return;
    e.preventDefault();
    if (!createDirty()) { void cancelCreate(); return; }
    const field = e.currentTarget as HTMLElement;
    const a = await createAsk.ask(DISCARD_ASK);
    if (a === 'cancel') { void focusAfter(() => field); return; }
    if (a !== 'confirm') return;
    createAsk.settle();   // a close: nothing to wait for (R54)
    void cancelCreate();
  }

  async function createVersion() {
    if (!course || !newLabel.trim() || createAsk.open) return; // the label is mandatory; R48
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
    if (busy) return;
    // Spec §8: confirm → POST → refetch / toast. The question asks under the row (#17).
    const verb = action === 'disable' ? 'Disable' : 'Enable';
    const id = v.id;
    const q: Ask = {
      warning: `${verb} version ${id}?`, confirmLabel: verb, tone: 'primary', layout: 'row', align: 'end',
      confirmDataAction: `confirm-${action}-version`, key: id,
    };
    const a = await rowAsk.ask(q);
    // The trigger, else (disabled meanwhile) the <h1>: never <body>.
    if (a === 'cancel') { void focusAfter(() => firstUsable(toggleBtn(id), h1El)); return; }
    if (a !== 'confirm') return;
    // R49: the row is still there, in the state the question named.
    const live = versions.find((x) => x.id === id);
    if (busy || !live || live.is_disabled !== (action === 'enable')) {
      withdraw(rowAsk, q, () => firstUsable(toggleBtn(id), h1El));
      return;
    }
    // load() pins courseSlug internally, so a prop-change mid-await re-loads
    // the original course's list, not the newly-routed-in slug.
    let interim: HTMLElement | null = null;
    busy = true;
    try {
      await api.post(`/api/versions/${id}/${action}`);
      // R54: the reload shows a Skeleton for the whole list, so the question
      // settles now and focus waits on the page's <h1>.
      interim = await settleTo(rowAsk, q, () => h1El, { preventScroll: true });
      await load();
      // Close a stale duplicate form on this row after any transition. The row
      // just changed state; a concurrent disable may have hidden the form via
      // the render guard, and a later enable must not spuriously re-open it.
      if (duplicatingId === id) duplicatingId = null;
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : `Could not ${action}`;
      pushToast(msg, 'error');
    } finally {
      busy = false;
      // The row's toggle, found by version id once `busy` clears: after success
      // the swapped button in the same slot, after a failure the trigger.
      if (interim) void moveOn(interim, () => toggleBtn(id));
      else void settleTo(rowAsk, q, () => toggleBtn(id));
    }
  }

  async function deleteVersion(v: Version) {
    if (busy || deleteVersionReason(v) !== null) return;
    const id = v.id;
    const q: Ask = {
      warning: `Delete draft version ${id}? This cannot be undone.`, confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end',
      confirmDataAction: 'confirm-delete-version', key: id,
    };
    const a = await rowAsk.ask(q);
    if (a === 'cancel') { void focusAfter(() => firstUsable(trashBtn(id), h1El)); return; }
    if (a !== 'confirm') return;
    // R49: the row is still there and still deletable.
    const live = versions.find((x) => x.id === id);
    if (busy || !live || deleteVersionReason(live) !== null) {
      withdraw(rowAsk, q, () => firstUsable(trashBtn(id), h1El));
      return;
    }
    // R54: where focus lands once `busy` clears, resolved by version id before
    // the reload: the next row's title, else the previous, else "+ Add version".
    const ids = versions.map((x) => x.id);
    const at = ids.indexOf(id);
    const nextId = ids[at + 1] ?? ids[at - 1];
    const final = () => firstUsable(nextId !== undefined ? document.getElementById(`v-${nextId}-title`) : null, addLineEl);
    let interim: HTMLElement | null = null;
    busy = true;
    try {
      await api.delete(`/api/versions/${id}`);
      interim = await settleTo(rowAsk, q, () => h1El, { preventScroll: true });
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not delete';
      pushToast(msg, 'error');
    } finally {
      busy = false;
      if (interim) void moveOn(interim, final);
      else void settleTo(rowAsk, q, () => trashBtn(id));
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
    if (!dupLabel.trim()) return; // the label is mandatory
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

<div class="page">
  {#if error && !loading}
    <ErrorState variant="page" title="Couldn't load" message={error.message} action={backToCourses} />
  {:else if !shownCourse}
    {#if loading}<Skeleton rows={3} />{/if}
  {:else}
    {@const course = shownCourse}
    <div class="heading">
      <IconButton round glyph="back" title="Back to courses" onclick={() => navigate('/courses')} />
      <h1 bind:this={h1El} tabindex="-1">{course.name}</h1>
      <span class="hchip">{versions.length} {versions.length === 1 ? 'version' : 'versions'}</span>
    </div>
    <!-- The visible "Versions" row is gone (5c follow-up); the outline keeps h1 > h2. -->
    <h2 class="sr-only">Versions</h2>
    {#if loading}
      <Skeleton rows={3} />
    {:else if versions.length === 0}
      <EmptyState
        icon="list"
        title="No versions yet"
        hint="A version holds the blocks, sequences and items students see. Create one to start authoring."
      />
    {:else}
      <ul class="vlist">
        {#each versions as v (v.id)}
          {@const dupReason = duplicateVersionReason(v)}
          {@const delReason = deleteVersionReason(v)}
          {@const vtitle = v.label || `Version ${v.id}`}
          <li class="vrow">
            <!-- D43 (user, Task 4 look): the box holds the row line and, while it asks, the question. -->
            <div class="vline">
              <!-- 5c follow-up (user): the label is the row title, as a block's; it opens the version like the pencil.
                   The label is mandatory; "Version <id>" (the backfill's name) only guards an empty one.
                   The name carries the id: two versions may share a label. -->
              <button type="button" class="vtitle" class:off={v.is_disabled} disabled={busy} id={`v-${v.id}-title`}
                aria-label={`${vtitle} (v${v.id})`}
                onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)}>{vtitle}</button>
              <span class="hchip">v. {v.id}</span>
              <span class="badges"><VersionBadges state={v.state} isDisabled={v.is_disabled} /></span>
              <span class="slots">
                <IconButton size="sm" glyph="pencil" title="Open" aria-label="Open v{v.id}" disabled={busy}
                  onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)} />
                <IconButton size="sm" glyph="duplicate" title={dupReason ?? 'Duplicate'} aria-label="Duplicate v{v.id}"
                  disabled={busy || dupReason !== null} onclick={() => void openDuplicate(v)} />
                {#if v.is_disabled}
                  <IconButton size="sm" glyph="enable" title="Enable" aria-label="Enable v{v.id}" id={`v-${v.id}-toggle`} disabled={busy}
                    onclick={() => void transition(v, 'enable')} />
                {:else}
                  <IconButton size="sm" glyph="disable" title="Disable" aria-label="Disable v{v.id}" id={`v-${v.id}-toggle`} disabled={busy}
                    onclick={() => void transition(v, 'disable')} />
                {/if}
                <IconButton size="sm" glyph="trash" danger title={delReason ?? 'Delete'} aria-label="Delete v{v.id}" id={`v-${v.id}-delete`}
                  disabled={busy || delReason !== null} onclick={() => void deleteVersion(v)} />
              </span>
            </div>
            {#if rowAsk.current?.key === v.id}
              <!-- #17, #18: the row's question, inside its box under the line (R53: one for the list). -->
              <div class="ask-row"><AskSlot ask={rowAsk} /></div>
            {/if}
          </li>
          {#if !v.is_disabled && duplicatingId === v.id}
            <!-- R48: frozen while its row asks. -->
            <li class="dup-row" {@attach (el) => { el.toggleAttribute('inert', rowAsk.current?.key === v.id); }}>
              <form class="dup" onsubmit={(e) => { e.preventDefault(); duplicateVersion(v); }}>
                <label>New draft label
                  <input class="dup-label" type="text" maxlength="200" required bind:value={dupLabel} bind:this={dupInputEl} disabled={busy} />
                </label>
                <Button type="submit" disabled={busy || !dupLabel.trim()} loading={busy}>Create copy</Button>
                <Button variant="ghost" onclick={() => (duplicatingId = null)} disabled={busy}>Cancel</Button>
              </form>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
    {#if creating}
      <form class="create" onsubmit={(e) => { e.preventDefault(); createVersion(); }}>
        <label>Label
          <input class="new-label" type="text" maxlength="200" required bind:value={newLabel} bind:this={newLabelEl} onkeydown={(e) => void escCancels(e)} />
        </label>
        <label>Info (markdown)
          <textarea bind:value={info_md} rows="3" onkeydown={(e) => void escCancels(e)}></textarea>
        </label>
        <label>Max quiz attempts
          <!-- Raw <input> — `Input.svelte` lacks min/max (spec Constraint 6). -->
          <input class="mono" type="number" min="1" max="10" step="1" required bind:value={max_quiz_attempts} onkeydown={(e) => void escCancels(e)} />
        </label>
        <div class="submit">
          {#if createAsk.open}
            <!-- #16: in place of Cancel / Create. -->
            <AskSlot ask={createAsk} />
          {:else}
            <Button variant="ghost" disabled={busy} onclick={() => void cancelCreate()}>Cancel</Button>
            <Button type="submit" disabled={busy || !newLabel.trim()} loading={busy}>Create</Button>
          {/if}
        </div>
      </form>
    {:else}
      <button bind:this={addLineEl} type="button" class="add-line" disabled={busy} onclick={() => void openCreate()}>+ Add version</button>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3); }
  /* 5c follow-up (user): the editor's page shade, so the course page and the
     version page read alike. `.page` stays scoped: the rule ends with the page. */
  :global(body):has(.page) { background: var(--focus-page); }
  /* The h1 is 18px (below); the h2 is visually hidden (.sr-only). 5c follow-up. */
  .heading { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; /* ref 1472 */ }
  /* 5c follow-up (user): the version page's title size (VersionEditPage .editor-heading h1). */
  .heading h1 { font-size: 18px; min-width: 0; overflow-wrap: anywhere; }
  /* The count as a heading chip — VersionEditPage .hchip, same look. */
  .hchip {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--focus-line);
    white-space: nowrap;
  }
  /* Visually hidden, still announced (VersionEditPage .sr-only; no global class exists). */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .create {
    display: flex;
    flex-direction: column;
    gap: 8px; /* the 8px create-form gap (spec §4 Create forms) */
    padding: 14px;
    margin-top: 6px; /* the list's row gap: it opens where "+ Add version" was */
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
  .submit { display: flex; justify-content: flex-end; gap: 8px; }
  /* "+ Add version" — the editor's quiet add line (VersionEditPage .add-line, 5c D9). */
  .add-line {
    margin-top: 4px;
    padding: 4px 2px;
    border: 0;
    background: transparent;
    color: var(--primary);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .add-line:disabled { color: var(--muted); cursor: default; }
  /* 5c follow-up (user): separate boxed rows, like the block list (BlockAccordion .block-card). */
  .vlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .vrow {
    padding: 9px 12px 9px 14px; /* ref 1482 */
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
    background: var(--focus-0);
  }
  /* D43: the row line inside the box; the question goes under it. */
  .vline { display: flex; align-items: center; gap: 10px; }
  /* The block row title (AccordionHeader .toggle / .title): 15px semibold, a bare button. */
  .vtitle {
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
    text-align: left;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .vtitle:disabled { cursor: default; }
  /* D5: a disabled version recedes to --muted (ref 1495). */
  .vtitle.off { color: var(--muted); }
  .badges { margin-left: auto; display: flex; /* ref 1485 */ }
  .slots { display: flex; gap: 6px; margin-left: 22px; /* ref 1486 */ }
  .dup-row {
    padding: 9px 12px 9px 14px; /* the row inset (ref 1482) */
    background: var(--focus-0); /* white on the shaded page, as the rows and the create form */
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
  }
  .dup { display: flex; align-items: flex-end; gap: 8px; /* the 8px create-form gap */ }
  .dup label { flex: 1; min-width: 0; }
  /* #17, #18 (D43): the row's question, inside the row's box under its line,
     set off by a thin grey line across the whole box (the negative margins undo
     the row's padding; the padding puts it back for the question). */
  .ask-row {
    margin: 9px -12px 0 -14px;
    padding: 8px 12px 0 14px;
    border-top: 1px solid var(--focus-line);
  }
</style>
