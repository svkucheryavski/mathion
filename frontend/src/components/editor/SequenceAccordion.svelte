<script lang="ts">
  import { getContext } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import ItemRow from './ItemRow.svelte';
  import ItemTypePicker from './ItemTypePicker.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { safeAppUrl } from '../../lib/safeAppUrl';
  import { versionPermissions } from '../../lib/versionPermissions';
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
    onMoveUp: () => void;
    onMoveDown: () => void;
    // parentBusy locks inputs while a parent (BlockAccordion / VersionEditPage)
    // mutation is in flight, so the user can't type into the title or the
    // create form between our own dirty checks and the tracker.reset() that
    // follows a refresh. Same convention as VersionMetaForm.
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
    onMoveUp,
    onMoveDown,
    parentBusy = false,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — SequenceAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid && String(seq.id) === routeSid);
  const headerId = `seq-${String(seq.id)}-header`;
  const panelId = `seq-${String(seq.id)}-panel`;

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canEdit = $derived(perms?.canEditTextFields ?? false);
  const canStructure = $derived(perms?.canEditStructure ?? false);

  type Meta = { title: string };
  const tracker = makeDirtyTracker<Meta>({ title: seq.title });

  // Defensive rebuild on seq.id change (belt-and-suspenders — child body
  // unmounts via {#if expanded} so a sid change typically remounts the
  // whole component).
  let trackerSid = $state(seq.id);
  $effect(() => {
    if (seq.id !== trackerSid) {
      tracker.reset({ title: seq.title });
      trackerSid = seq.id;
    }
  });

  $effect(() => {
    if (!expanded) return;
    dirty.register(tracker);
    return () => dirty.unregister(tracker);
  });

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}`);
    }
  }

  let busy = $state(false);

  async function save() {
    if (!tracker.isDirty) return;
    const savedVid = vid;
    const savedSid = seq.id;
    const savedBid = block.id;
    const sentTitle = tracker.current.title;
    busy = true;
    try {
      await api.patch(`/api/sequences/${savedSid}`, { title: sentTitle });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value?.blocks.find((b) => b.id === savedBid)?.sequences.find((x) => x.id === savedSid);
        if (fresh) tracker.reset({ title: fresh.title });
        pushToast('Saved', 'success');
      } else {
        tracker.reset({ title: sentTitle });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ title: seq.title });
  }

  async function deleteSeq() {
    if (tracker.isDirty || !canStructure || seq.items.length > 0) return;
    if (!confirm(`Delete sequence "${seq.title}"? This cannot be undone.`)) return;
    const savedVid = vid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/sequences/${savedSid}`);
      // Refresh the store BEFORE navigating — the parent page stays mounted
      // on the same vid, so without an explicit reload the deleted sequence
      // would remain in currentEditorVersion until some later refetch.
      await loadAdminTree(savedVid, { force: true });
      void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Item-list reorder: this component owns seq.items and the API call.
  async function reorderItem(idx: number, dir: -1 | 1) {
    if (tracker.isDirty) return;
    const items = [...seq.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    const order = items.map((it, i) => ({ id: it.id, order: i + 1 }));
    const savedVid = vid;
    const savedSid = seq.id;
    busy = true;
    try {
      await api.post(`/api/sequences/${savedSid}/items/reorder`, { order });
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  async function deleteItem(itemId: number, itemTitle: string) {
    if (busy || !canStructure) return;
    if (!confirm(`Delete "${itemTitle}"? This cannot be undone.`)) return;
    const savedVid = vid;
    busy = true;
    try {
      await api.delete(`/api/items/${itemId}`);
      await loadAdminTree(savedVid, { force: true });
      pushToast('Item deleted', 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      await loadAdminTree(savedVid, { force: true });
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
  let newScriptUrl = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let contentMdTouched = $state(false);

  $effect(() => {
    if (creating && newType === 'static_page' && !contentMdTouched && newTitle) {
      newContentMd = `# ${newTitle}\n`;
    }
  });

  // Tracker shim for the create form: synthesized isDirty getter reads
  // current state directly — NO reset()-on-keystroke (that would always
  // make the tracker clean and break smoke 14b).
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && (
        newTitle.trim() !== '' ||
        (newType === 'static_page' && newContentMd.trim() !== '' && newContentMd !== `# ${newTitle}\n`) ||
        (newType === 'video' && newVideoUrl.trim() !== '') ||
        (newType === 'interactive_app' && newScriptUrl.trim() !== '')
      );
    },
  };

  // Create is gated on a renderable URL (a deliberate divergence from video):
  // auto-coverage makes a stored-but-unrenderable URL an uncoverable required
  // item, and there is no publish-time preflight to catch it later. safeAppUrl
  // also rejects http:// on an https:// page (mixed content).
  const createScriptUrlInvalid = $derived(
    newType === 'interactive_app' && safeAppUrl(newScriptUrl) === null,
  );

  $effect(() => {
    if (!creating) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
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

  function resetCreateForm() {
    newType = 'static_page';
    newTitle = '';
    newContentMd = '';
    newVideoUrl = '';
    newScriptUrl = '';
    contentMdTouched = false;
    createErrors = {};
    createGlobalError = null;
  }

  function toggleCreate() {
    // Defense-in-depth: refuse mid-flight toggles. The toggle button is
    // already disabled in these states, but a stale/programmatic click
    // would otherwise unmount the form during an in-flight POST,
    // discarding validation errors and unregistering the create tracker.
    if (createBusy || busy || parentBusy) return;
    if (creating) resetCreateForm();
    creating = !creating;
  }

  async function submitCreate() {
    if (createBusy || busy || parentBusy || !canStructure || !newTitle.trim()) return;
    if (newType === 'interactive_app' && safeAppUrl(newScriptUrl) === null) {
      createErrors = { ...createErrors, script_url: 'A valid http(s) app URL is required' };
      return;
    }
    const savedVid = vid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    const body: Record<string, unknown> = { title: newTitle, type: newType };
    if (newType === 'static_page') body.content_md = newContentMd;
    if (newType === 'video') body.video_url = newVideoUrl;
    if (newType === 'interactive_app') body.script_url = newScriptUrl;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      const item = await api.post<{ id: number }>(`/api/sequences/${savedSid}/items`, body);
      await loadAdminTree(savedVid, { force: true });
      resetCreateForm();
      creating = false;
      void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}/items/${item.id}`);
    } catch (e) {
      const known = newType === 'static_page'
        ? ['title', 'content_md', 'type']
        : newType === 'video'
          ? ['title', 'video_url', 'type']
          : newType === 'interactive_app'
            ? ['title', 'script_url', 'type']
            : ['title', 'type'];
      const mapped = mapCreateError(e, known);
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

<div class="sequence">
  <AccordionHeader
    {headerId}
    {panelId}
    level="sequence"
    title={seq.title}
    slug={seq.slug}
    {index}
    {expanded}
    dirty={tracker.isDirty}
    busy={busy || createBusy || parentBusy}
    canReorderUp={canStructure && index > 1}
    canReorderDown={canStructure && index < sequenceCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
      {#if canEdit}
        <section class="meta">
          <label>Sequence title <input bind:value={tracker.current.title} required disabled={busy || createBusy || parentBusy} /></label>
          <div class="row">
            <Button onclick={save} disabled={!tracker.isDirty || busy || createBusy || parentBusy} loading={busy}>Save</Button>
            <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy || createBusy || parentBusy}>Discard</Button>
          </div>
        </section>
      {/if}

      <section class="items">
        <div class="head">
          <h4>Items</h4>
          {#if canStructure}
            <Button
              disabled={tracker.isDirty || busy || createBusy || parentBusy}
              title={tracker.isDirty ? 'Save or discard changes first' : ''}
              onclick={toggleCreate}
            >{creating ? 'Cancel' : '+ New item'}</Button>
          {/if}
        </div>

        {#if creating}
          <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
            <ItemTypePicker bind:value={newType} />
            <div class="field">
              <input placeholder="Title" bind:value={newTitle} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
              {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
            </div>
            {#if newType === 'static_page'}
              <div class="field">
                <textarea placeholder="Content (markdown)" rows="4" bind:value={newContentMd} disabled={createBusy || busy || parentBusy} oninput={() => { contentMdTouched = true; if (createErrors.content_md) createErrors = { ...createErrors, content_md: '' }; }} required></textarea>
                {#if createErrors.content_md}<small class="field-err">{createErrors.content_md}</small>{/if}
              </div>
            {:else if newType === 'video'}
              <div class="field">
                <input type="url" placeholder="Video URL (https://…)" bind:value={newVideoUrl} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.video_url) createErrors = { ...createErrors, video_url: '' }; }} />
                {#if createErrors.video_url}<small class="field-err">{createErrors.video_url}</small>{/if}
              </div>
            {:else if newType === 'interactive_app'}
              <div class="field">
                <input type="url" placeholder="App URL (https://…)" bind:value={newScriptUrl} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.script_url) createErrors = { ...createErrors, script_url: '' }; }} />
                {#if createErrors.script_url}<small class="field-err">{createErrors.script_url}</small>{/if}
              </div>
            {/if}
            {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
            <Button type="submit" disabled={tracker.isDirty || createBusy || busy || parentBusy || !canStructure || !newTitle.trim() || createScriptUrlInvalid} title={createScriptUrlInvalid ? 'A valid http(s) app URL is required' : ''} loading={createBusy}>Create</Button>
          </form>
        {/if}

        {#if seq.items.length === 0}
          <p class="empty">
            {canStructure ? 'No items yet — pick a type above to add one.' : 'No items.'}
          </p>
        {:else}
          <ul class="items-list">
            {#each seq.items as item, i (item.id)}
              <li>
                <ItemRow
                  {item}
                  index={i + 1}
                  {canStructure}
                  canReorderUp={canStructure && i > 0}
                  canReorderDown={canStructure && i < seq.items.length - 1}
                  parentDirty={tracker.isDirty}
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
      </section>

      {#if canStructure}
        <section class="danger">
          <Button
            variant="ghost"
            disabled={tracker.isDirty || busy || createBusy || parentBusy || seq.items.length > 0}
            title={tracker.isDirty ? 'Save or discard changes first' : seq.items.length > 0 ? 'Remove items first' : ''}
            onclick={deleteSeq}
          >Delete this sequence</Button>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sequence { border: 1px solid var(--border); border-radius: var(--radius); margin: var(--space-2) 0; }
  .accordion-body { padding: var(--space-3); border-top: 1px solid var(--border); }
  .meta { margin-bottom: var(--space-3); }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta input { width: 100%; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .create { display: grid; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input, .create textarea { width: 100%; }
  .create .field { display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
  .items-list { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--muted); }
  .danger { padding-top: var(--space-3); border-top: 1px solid var(--border); margin-top: var(--space-3); }
</style>
