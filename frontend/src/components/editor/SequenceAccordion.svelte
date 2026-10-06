<script lang="ts">
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import ItemRow from './ItemRow.svelte';
  import ItemTypePicker from './ItemTypePicker.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { structureReason, textReason, unsavedSuffix } from '../../lib/editorReasons';
  import { labelFor } from '../../lib/labelFor';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineField from '../ui/InlineField.svelte';
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
  const headerId = $derived(`seq-${String(seq.id)}-header`);
  const panelId = $derived(`seq-${String(seq.id)}-panel`);

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canStructure = $derived(perms?.canEditStructure ?? false);
  const structReason = $derived(version ? structureReason(version) : null);
  const txtReason = $derived(version ? textReason(version) : null);
  const name = $derived(labelFor(seq.title, seq.slug, `sequence ${index}`));

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

  // One field per PATCH (D2). A PATCH failure propagates to InlineField.
  async function patchSeq(field: { title: string }) {
    const savedVid = vid;
    const check = stillOnVid;
    const savedSid = seq.id;
    await api.patch(`/api/sequences/${savedSid}`, field);
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

  // Footer text mirrors the trash button's title (ref 1610). Precedence:
  // structure reason → items remain → create form open → enabled.
  const deleteText = $derived(
    structReason
      ? `Delete this sequence — ${structReason[0].toLowerCase()}${structReason.slice(1)}`
      : seq.items.length > 0
        ? 'Delete this sequence — remove its items first'
        : creating
          ? 'Delete this sequence — cancel the new item first'
          : 'Delete this sequence',
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

  async function toggleCreate() {
    // Defense-in-depth: refuse mid-flight toggles. The toggle button is
    // already disabled in these states, but a stale/programmatic click
    // would otherwise unmount the form during an in-flight POST,
    // discarding validation errors and unregistering the create tracker.
    if (createBusy || busy || parentBusy || structReason) return;
    if (creating) { resetCreateForm(); creating = false; return; }
    creating = true;
    await tick();
    // The checked type radio is the form's first tab stop. Scoped to this
    // form — several sequences' pickers share the radio group name.
    formEl?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
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

<!-- D10: no card border — nesting is carried by indentation, badges and tints. -->
<div>
  <AccordionHeader
    {headerId}
    {panelId}
    level="sequence"
    title={seq.title}
    slug={seq.slug}
    {index}
    {expanded}
    badge={`S${index}`}
    busy={busy || createBusy || parentBusy}
    structureReason={structReason}
    canReorderUp={index > 1}
    canReorderDown={index < sequenceCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="acc-body">
      <div class="fields">
        <InlineField
          label="Sequence title"
          value={seq.title}
          required
          maxlength={200}
          editTitle="Edit the sequence title"
          disabledReason={txtReason}
          onCommit={(p) => patchSeq({ title: String(p) })}
        />
      </div>

      <div class="items-head">
        <h5>Items</h5>
        <IconButton
          primary
          glyph={creating ? 'close' : 'plus'}
          title={structReason ?? (creating ? 'Cancel new item' : 'New item')}
          aria-label={`New item in ${name}`}
          aria-expanded={creating}
          disabled={!!structReason || busy || createBusy || parentBusy}
          onclick={() => void toggleCreate()}
        />
      </div>

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
            <Button type="submit" disabled={createBusy || busy || parentBusy || !canStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
          </div>
        </form>
      {/if}

      {#if seq.items.length === 0}
        <p class="empty">{canStructure ? 'No items yet.' : 'No items.'}</p>
      {:else}
        <ul class="items-list">
          {#each seq.items as item, i (item.id)}
            <li>
              <ItemRow
                {item}
                index={i + 1}
                structureReason={structReason}
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

      <div class="del-footer">
        <IconButton
          glyph="trash"
          danger
          title={deleteText}
          aria-label={`Delete sequence ${name}`}
          disabled={!!structReason || seq.items.length > 0 || creating || busy || createBusy || parentBusy}
          onclick={() => void deleteSeq()}
        />
        <span class="del-text">{deleteText}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .acc-body { padding: 12px 14px; border-top: 1px solid var(--border-soft); /* ref 1578 */ }
  .fields { display: flex; flex-direction: column; }
  .fields > :global(.inline-field:last-child) { border-bottom: 0; /* ref 1548 */ }
  .items-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; /* ref 1584 */ }
  h5 { margin: 0; font-size: 13px; font-weight: 600; /* ref 1585 */ }
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
  .cr-actions { display: flex; justify-content: flex-end; }
  .field-err, .form-err { margin: 0; font-size: 12.5px; color: var(--danger); }
  .empty { margin: 0; font-size: 13px; color: var(--muted); }
  .items-list { list-style: none; padding: 0; margin: 0; }
  .items-list > li:last-child > :global(.item-row) { border-bottom: 0; /* ref 1602 */ }
  .del-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border-soft); /* ref 1609 */
  }
  .del-text { font-size: 12.5px; color: var(--muted); /* ref 1610 */ }
</style>
