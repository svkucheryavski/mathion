<script lang="ts">
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import AccordionHeader, { type HeaderMode } from './AccordionHeader.svelte';
  import ItemRow from './ItemRow.svelte';
  import ItemTypePicker from './ItemTypePicker.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { unsavedSuffix } from '../../lib/editorReasons';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeBlock, AdminTreeSequence } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    block: AdminTreeBlock;
    seq: AdminTreeSequence;
    index: number;
    sequenceCount: number;
    routeBid: string | null;
    routeSid: string | null;
    // The parent BlockAccordion's version guard (`alive && vid === savedVid`).
    // Required: this component is rendered inside the block's {#if expanded}
    // body, so its own lifetime ends when the block collapses — a reload
    // gated on its own `alive` would be skipped and leave a deleted sequence
    // or an old title in the store. The parent stays mounted while the block
    // is in the tree. No `() => true` default: that would silently reload a
    // torn-down version.
    stillOnVid: (savedVid: number) => boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    // parentBusy disables this sequence's controls while a parent
    // (BlockAccordion / VersionEditPage) mutation is in flight.
    parentBusy?: boolean;
  };

  let {
    courseSlug,
    vid,
    block,
    seq,
    index,
    sequenceCount,
    routeBid,
    routeSid,
    stillOnVid,
    onMoveUp,
    onMoveDown,
    parentBusy = false,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — SequenceAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid && String(seq.id) === routeSid);
  // Slice-5c D1/D4: a sequence is only visible while its block is open; it is
  // "outside" only while a SIBLING really is open — a stale route id (about
  // to fall back) keeps the rows at the focus level, controls included.
  const siblingOpen = $derived(routeSid !== null && block.sequences.some((s) => String(s.id) === routeSid));
  const mode: HeaderMode = $derived(expanded ? 'open-focus' : (siblingOpen ? 'row-outside' : 'row-focus'));
  const headerId = $derived(`seq-${String(seq.id)}-header`);
  const panelId = $derived(`seq-${String(seq.id)}-panel`);

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canStructure = $derived(perms?.canEditStructure ?? false);
  const canEditTitle = $derived(perms?.canEditTextFields ?? false);

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}`);
    }
  }

  let busy = $state(false);

  // Own lifetime — gates only the post-delete forced navigate (§4 race guards).
  let alive = true;
  onDestroy(() => { alive = false; });

  // D8: the header's inline title. One PATCH; a failure propagates to the
  // header (inline error); only the follow-up refresh is guarded.
  async function renameSeq(title: string) {
    const savedVid = vid;
    const check = stillOnVid;
    const savedSid = seq.id;
    await api.patch(`/api/sequences/${savedSid}`, { title });
    if (!check(savedVid)) return;
    const result = await loadAdminTree(savedVid, { force: true });
    if (result === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
  }

  async function deleteSeq() {
    if (creating || !canStructure || busy || createBusy || parentBusy || seq.items.length > 0) return;
    if (!confirm(`Delete sequence "${seq.title}"? This cannot be undone.${unsavedSuffix(dirty.isAnyDirty())}`)) return;
    const savedVid = vid;
    const check = stillOnVid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/sequences/${savedSid}`);
      // Navigate FIRST (no spurious "Sequence not found."), only while the
      // live route still names this sequence; `force` — already confirmed;
      // `replace` — keep the deleted URL out of history. Then reload, gated on
      // the parent's guard so it still runs after the block collapsed.
      if (alive && expanded && check(savedVid)) {
        void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}`, { replace: true, force: true });
      }
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Item-list reorder: this component owns seq.items and the API call.
  // Not blocked by drafts (D3); a second reorder while one is in flight would
  // see a pre-swap snapshot of seq.items.
  async function reorderItem(idx: number, dir: -1 | 1) {
    if (busy || createBusy || parentBusy) return;
    const items = [...seq.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    const order = items.map((it, i) => ({ id: it.id, order: i + 1 }));
    const savedVid = vid;
    const check = stillOnVid;
    const savedSid = seq.id;
    busy = true;
    try {
      await api.post(`/api/sequences/${savedSid}/items/reorder`, { order });
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  async function deleteItem(itemId: number, itemTitle: string) {
    if (busy || !canStructure) return;
    if (!confirm(`Delete "${itemTitle}"? This cannot be undone.`)) return;
    const savedVid = vid;
    const check = stillOnVid;
    busy = true;
    try {
      await api.delete(`/api/items/${itemId}`);
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
      pushToast('Item deleted', 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  function openItem(itemId: number) {
    void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}/items/${itemId}`);
  }

  // Inline create-item form
  let creating = $state(false);
  let newType = $state<'static_page' | 'video' | 'quiz' | 'interactive_app'>('static_page');
  let newTitle = $state('');
  let newContentMd = $state('');
  let newVideoUrl = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let contentMdTouched = $state(false);
  let formEl = $state<HTMLFormElement>();

  $effect(() => {
    if (creating && newType === 'static_page' && !contentMdTouched && newTitle) {
      newContentMd = `# ${newTitle}\n`;
    }
  });

  // D6: why the header trash is blocked (null = it may delete). The version's
  // permission is not a reason here: without it the trash is hidden.
  const deleteBlockedReason = $derived(
    seq.items.length > 0
      ? 'Remove its items first'
      : creating
        ? 'Cancel the new item first'
        : null,
  );

  function resetCreateForm() {
    newType = 'static_page';
    newTitle = '';
    newContentMd = '';
    newVideoUrl = '';
    contentMdTouched = false;
    createErrors = {};
    createGlobalError = null;
  }

  // Tracker shim for the create form: synthesized isDirty getter reads
  // current state directly — NO reset()-on-keystroke (that would always
  // make the tracker clean and break smoke 14b). discard() lets a confirmed
  // DirtyGuard prompt really drop the draft (D3).
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && (
        newTitle.trim() !== '' ||
        (newType === 'static_page' && newContentMd.trim() !== '' && newContentMd !== `# ${newTitle}\n`) ||
        (newType === 'video' && newVideoUrl.trim() !== '')
      );
    },
    discard() { resetCreateForm(); creating = false; },
  };

  // Registered only while the form is actually on screen.
  $effect(() => {
    if (!(creating && expanded)) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  // Collapse resets the form. Tracks only `expanded`.
  $effect(() => {
    if (!expanded) untrack(() => { if (creating) { resetCreateForm(); creating = false; } });
  });

  // Close + reset the create form if structure permission is revoked while
  // the form is open (e.g., parent publishes the version mid-edit). Without
  // this, the form would stay submittable even though the underlying
  // permission has flipped.
  $effect(() => {
    if (!canStructure && creating) {
      resetCreateForm();
      creating = false;
    }
  });

  let addLineEl = $state<HTMLButtonElement>();

  async function openAdd() {
    // Defense-in-depth: the line is disabled in these states, but a stale or
    // programmatic click must not open a form that could not submit.
    if (createBusy || busy || parentBusy || !canStructure) return;
    creating = true;
    await tick();
    // The checked type radio is the form's first tab stop. Scoped to this
    // form — several sequences' pickers share the radio group name.
    formEl?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }

  async function cancelAdd() {
    if (createBusy) return;
    resetCreateForm(); creating = false;
    await tick();
    addLineEl?.focus();
  }

  async function submitCreate() {
    if (createBusy || busy || parentBusy || !canStructure || !newTitle.trim()) return;
    const savedVid = vid;
    const check = stillOnVid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    const body: Record<string, unknown> = { title: newTitle, type: newType };
    if (newType === 'static_page') body.content_md = newContentMd;
    if (newType === 'video') body.video_url = newVideoUrl;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      const item = await api.post<{ id: number }>(`/api/sequences/${savedSid}/items`, body);
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
      resetCreateForm();
      creating = false;
      // Gated like the reload: a late success must not pull the author back
      // into the old version's item editor.
      if (check(savedVid)) void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}/items/${item.id}`);
    } catch (e) {
      const known = newType === 'static_page'
        ? ['title', 'content_md', 'type']
        : newType === 'video'
          ? ['title', 'video_url', 'type']
          : ['title', 'type'];
      const mapped = mapCreateError(e, known);
      // The form closed while the POST was in flight (collapse, a confirmed
      // discard, a read-only flip): there is no form to show the error on, and
      // writing it would resurface stale on the next open — toast it instead.
      if (!creating) {
        pushToast(mapped.globalMessage ?? Object.values(mapped.fieldErrors)[0] ?? 'Create failed', 'error');
        return;
      }
      createErrors = mapped.fieldErrors;
      // Fall back to a generic message if mapper produced nothing — without
      // this, a 500 with no validation body silently swallows the failure.
      createGlobalError = mapped.globalMessage
        ?? (Object.keys(mapped.fieldErrors).length === 0 ? 'Create failed' : null);
      if (createGlobalError && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(createGlobalError, 'error');
      }
    } finally {
      createBusy = false;
    }
  }
</script>

<div class="seq-card" class:focus={mode === 'open-focus'}>
  <AccordionHeader
    {headerId}
    {panelId}
    level="sequence"
    {mode}
    title={seq.title}
    slug={seq.slug}
    {index}
    {expanded}
    busy={busy || createBusy || parentBusy}
    {canStructure}
    {canEditTitle}
    canReorderUp={index > 1}
    canReorderDown={index < sequenceCount}
    {deleteBlockedReason}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
    onDelete={() => void deleteSeq()}
    onRename={renameSeq}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="acc-body">
      {#if seq.items.length === 0}
        <p class="empty">{canStructure ? 'No items yet.' : 'No items.'}</p>
      {:else}
        <ul class="items-list">
          {#each seq.items as item, i (item.id)}
            <li>
              <ItemRow
                {item}
                index={i + 1}
                {canStructure}
                canReorderUp={i > 0}
                canReorderDown={i < seq.items.length - 1}
                busy={busy || createBusy || parentBusy}
                onMoveUp={() => void reorderItem(i, -1)}
                onMoveDown={() => void reorderItem(i, 1)}
                onOpen={() => openItem(item.id)}
                onDelete={() => void deleteItem(item.id, item.title)}
              />
            </li>
          {/each}
        </ul>
      {/if}

      {#if creating}
        <form class="cr-form" bind:this={formEl} onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
          <ItemTypePicker bind:value={newType} />
          <input placeholder="Title" aria-label="Item title" bind:value={newTitle} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
          {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          {#if newType === 'static_page'}
            <textarea placeholder="Content (markdown)" aria-label="Content (markdown)" rows="4" bind:value={newContentMd} disabled={createBusy || busy || parentBusy} oninput={() => { contentMdTouched = true; if (createErrors.content_md) createErrors = { ...createErrors, content_md: '' }; }} required></textarea>
            {#if createErrors.content_md}<small class="field-err">{createErrors.content_md}</small>{/if}
          {:else if newType === 'video'}
            <input type="url" placeholder="Video URL (https://…)" aria-label="Video URL" bind:value={newVideoUrl} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.video_url) createErrors = { ...createErrors, video_url: '' }; }} />
            {#if createErrors.video_url}<small class="field-err">{createErrors.video_url}</small>{/if}
          {/if}
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
          <div class="cr-actions">
            <Button variant="ghost" disabled={createBusy} onclick={() => void cancelAdd()}>Cancel</Button>
            <Button type="submit" disabled={createBusy || busy || parentBusy || !canStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
          </div>
        </form>
      {:else if canStructure}
        <!-- "+ Add item" (user 2026-10-08: like + Add block / + Add sequence),
             after the list — new items land at the end. Until T4's New item
             modal it opens the inline form above. -->
        <button bind:this={addLineEl} type="button" class="add-line" disabled={busy || parentBusy} onclick={() => void openAdd()}>+ Add item</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .seq-card {
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
    background: transparent;
    overflow: hidden;
  }
  .seq-card.focus {
    background: var(--focus-0);
    border-color: var(--focus-line-strong);
    box-shadow: var(--focus-shadow);
  }
  .acc-body { padding: 12px 14px; border-top: 1px solid var(--border-soft); /* ref 1578 */ }
  .add-line {
    margin-top: 8px;
    padding: 4px 2px;
    border: 0;
    background: transparent;
    color: var(--primary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .add-line:disabled { color: var(--muted); cursor: default; }
  /* Create forms — shared look (spec §4). */
  .cr-form { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
  .cr-form input,
  .cr-form textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .cr-form input { height: var(--control-h); padding: 0 10px; }
  .cr-form textarea { height: auto; padding: 8px 10px; }
  .cr-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .field-err, .form-err { margin: 0; font-size: 12.5px; color: var(--danger); }
  .empty { margin: 0; font-size: 13px; color: var(--muted); }
  .items-list { display: flex; flex-direction: column; gap: 4px; list-style: none; padding: 0; margin: 0; }
</style>
