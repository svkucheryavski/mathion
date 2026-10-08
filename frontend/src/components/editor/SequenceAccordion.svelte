<script lang="ts">
  import { getContext, onDestroy, tick } from 'svelte';
  import AccordionHeader, { type HeaderMode } from './AccordionHeader.svelte';
  import ItemRow from './ItemRow.svelte';
  import NewItemModal from './NewItemModal.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { unsavedSuffix } from '../../lib/editorReasons';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
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
    if (creating || !canStructure || busy || parentBusy || seq.items.length > 0) return;
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
    if (busy || parentBusy) return;
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

  // D6: why the header trash is blocked (null = it may delete). The version's
  // permission is not a reason here: without it the trash is hidden.
  const deleteBlockedReason = $derived(seq.items.length > 0 ? 'Remove its items first' : null);

  // "+ Add item" (5c D10): the line opens the New item modal. `creating` = the
  // modal is open; the modal owns the form and its guard tracker.
  let creating = $state(false);
  let addLineEl = $state<HTMLButtonElement>();

  // The modal owns the form; this owns the request, the reload and the
  // navigation into the new item's editor (R1: push, so the item's × is Back).
  // A failure throws back into the modal, which shows it on the fields.
  async function createItem(body: Record<string, unknown>) {
    const savedVid = vid;
    const check = stillOnVid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    const item = await api.post<{ id: number }>(`/api/sequences/${savedSid}/items`, body);
    if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    creating = false;
    // Let the modal unmount first: its guard tracker (dirty — the typed
    // title) unregisters on teardown; navigating before that would prompt.
    await tick();
    // Gated like the reload: a late success must not pull the author back
    // into the old version's item editor.
    if (!check(savedVid)) return;
    // 5b D18: closing the new item's editor focuses its ✎. The modal's
    // teardown just handed focus back to its opener ("+ Add item" in Chrome,
    // where a click focuses buttons; whatever held focus before in Safari);
    // drop it, so the editor opens with no opener and its close falls through
    // to the new item's ✎.
    (document.activeElement as HTMLElement | null)?.blur();
    void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}/items/${item.id}`);
  }

  async function closeNewItem() {
    creating = false;
    await tick();
    addLineEl?.focus();
  }

  // Leaving the sequence or losing structure permission closes the modal.
  $effect(() => { if (creating && (!expanded || !canStructure)) creating = false; });
</script>

<div class="seq-card" class:at-focus={mode === 'row-focus'} class:focus={mode === 'open-focus'}>
  <AccordionHeader
    {headerId}
    {panelId}
    level="sequence"
    {mode}
    title={seq.title}
    slug={seq.slug}
    {index}
    {expanded}
    busy={busy || parentBusy}
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
                busy={busy || parentBusy}
                onMoveUp={() => void reorderItem(i, -1)}
                onMoveDown={() => void reorderItem(i, 1)}
                onOpen={() => openItem(item.id)}
                onDelete={() => void deleteItem(item.id, item.title)}
              />
            </li>
          {/each}
        </ul>
      {/if}

      {#if canStructure}
        <!-- After the list: new items land at the end (user, T3). -->
        <button bind:this={addLineEl} type="button" class="add-line" disabled={busy || parentBusy} onclick={() => (creating = true)}>+ Add item</button>
      {/if}
      {#if creating}
        <NewItemModal
          blockTitle={block.title}
          seqTitle={seq.title}
          position={seq.items.length + 1}
          onCreate={createItem}
          onClose={() => void closeNewItem()}
        />
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
  /* 5c T5 (user): a focus-level row inside the open (white) block is tinted. */
  .seq-card.at-focus { background: var(--focus-row); }
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
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .add-line:disabled { color: var(--muted); cursor: default; }
  .empty { margin: 0; font-size: 14px; color: var(--muted); }
  .items-list { display: flex; flex-direction: column; gap: 4px; list-style: none; padding: 0; margin: 0; }
</style>
