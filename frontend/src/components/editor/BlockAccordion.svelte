<script lang="ts">
  import { getContext } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import SequenceAccordion from './SequenceAccordion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeBlock } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    block: AdminTreeBlock;
    index: number;
    blockCount: number;
    routeBid: string | null;
    routeSid: string | null;
    onMoveUp: () => void;
    onMoveDown: () => void;
    // parentBusy locks inputs while a parent (VersionEditPage) mutation is in
    // flight, so the user can't type into the title/info or the create form
    // between our own dirty checks and the tracker.reset() that follows a
    // refresh. Same convention as VersionMetaForm and SequenceAccordion.
    parentBusy?: boolean;
  };

  let {
    courseSlug,
    vid,
    block,
    index,
    blockCount,
    routeBid,
    routeSid,
    onMoveUp,
    onMoveDown,
    parentBusy = false,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — BlockAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid);
  const headerId = `block-${String(block.id)}-header`;
  const panelId = `block-${String(block.id)}-panel`;

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canEdit = $derived(perms?.canEditTextFields ?? false);
  const canStructure = $derived(perms?.canEditStructure ?? false);

  type Meta = { title: string; info: string };
  const tracker = makeDirtyTracker<Meta>({ title: block.title, info: block.info });

  let trackerBid = $state(block.id);
  $effect(() => {
    if (block.id !== trackerBid) {
      tracker.reset({ title: block.title, info: block.info });
      trackerBid = block.id;
    }
  });

  $effect(() => {
    if (!expanded) return;
    dirty.register(tracker);
    return () => dirty.unregister(tracker);
  });

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    }
  }

  let busy = $state(false);

  async function save() {
    if (!tracker.isDirty) return;
    const savedVid = vid;
    const savedBid = block.id;
    const sentTitle = tracker.current.title;
    const sentInfo = tracker.current.info;
    busy = true;
    try {
      await api.patch(`/api/blocks/${savedBid}`, { title: sentTitle, info: sentInfo });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value?.blocks.find((b) => b.id === savedBid);
        if (fresh) tracker.reset({ title: fresh.title, info: fresh.info });
        pushToast('Saved', 'success');
      } else {
        tracker.reset({ title: sentTitle, info: sentInfo });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ title: block.title, info: block.info });
  }

  async function deleteBlock() {
    if (tracker.isDirty || !canStructure || block.sequences.length > 0) return;
    if (!confirm(`Delete block "${block.title}"? This cannot be undone.`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/blocks/${block.id}`);
      // Refresh the store BEFORE navigating — the parent page stays mounted on
      // the same vid, so without an explicit reload the deleted block would
      // remain in currentEditorVersion until some later refetch.
      await loadAdminTree(savedVid, { force: true });
      void navigate(`/courses/${savedSlug}/edit/v/${savedVid}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Sequence-list reorder: this component owns block.sequences and the API call.
  async function reorderSeq(idx: number, dir: -1 | 1) {
    if (tracker.isDirty) return;
    const seqs = [...block.sequences];
    const target = idx + dir;
    if (target < 0 || target >= seqs.length) return;
    [seqs[idx], seqs[target]] = [seqs[target], seqs[idx]];
    const order = seqs.map((s, i) => ({ id: s.id, order: i + 1 }));
    const savedVid = vid;
    const savedBid = block.id;
    busy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences/reorder`, { order });
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Inline create-sequence form
  let creating = $state(false);
  let newTitle = $state('');
  let newSlug = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && (newTitle.trim() !== '' || newSlug.trim() !== '');
    },
  };

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
      newTitle = '';
      newSlug = '';
      createErrors = {};
      createGlobalError = null;
      creating = false;
    }
  });

  function toggleCreate() {
    // Defense-in-depth: refuse mid-flight toggles. The toggle button is
    // already disabled in these states, but a stale/programmatic click
    // would otherwise unmount the form during an in-flight POST,
    // discarding validation errors and unregistering the create tracker.
    if (createBusy || busy || parentBusy) return;
    if (creating) { newTitle = ''; newSlug = ''; createErrors = {}; createGlobalError = null; }
    creating = !creating;
  }

  async function submitCreate() {
    if (createBusy || busy || parentBusy || !canStructure || !newTitle.trim() || !newSlug.trim()) return;
    const savedVid = vid;
    const savedBid = block.id;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences`, { title: newTitle, slug: newSlug });
      newTitle = ''; newSlug = ''; creating = false;
      await loadAdminTree(savedVid, { force: true });
      pushToast('Sequence created', 'success');
    } catch (e) {
      const mapped = mapCreateError(e, ['title', 'slug']);
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

<div class="block">
  <AccordionHeader
    {headerId}
    {panelId}
    level="block"
    title={block.title}
    slug={block.slug}
    {index}
    {expanded}
    dirty={tracker.isDirty}
    busy={busy || createBusy || parentBusy}
    canReorderUp={canStructure && index > 1}
    canReorderDown={canStructure && index < blockCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
      {#if canEdit}
        <section class="meta">
          <label>Title <input bind:value={tracker.current.title} required disabled={busy || createBusy || parentBusy} /></label>
          <label>Info (markdown) <textarea bind:value={tracker.current.info} rows="3" disabled={busy || createBusy || parentBusy}></textarea></label>
          <div class="row">
            <Button onclick={save} disabled={!tracker.isDirty || busy || createBusy || parentBusy} loading={busy}>Save</Button>
            <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy || createBusy || parentBusy}>Discard</Button>
          </div>
        </section>
      {/if}

      <section class="seqs">
        <div class="head">
          <h3>Sequences</h3>
          {#if canStructure}
            <Button
              disabled={tracker.isDirty || busy || createBusy || parentBusy}
              title={tracker.isDirty ? 'Save or discard changes first' : ''}
              onclick={toggleCreate}
            >{creating ? 'Cancel' : '+ New sequence'}</Button>
          {/if}
        </div>

        {#if creating}
          <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
            <div class="field">
              <input placeholder="Title" bind:value={newTitle} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
              {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
            </div>
            <div class="field">
              <input placeholder="Slug" bind:value={newSlug} required disabled={createBusy || busy || parentBusy} pattern="[a-z0-9]+(-[a-z0-9]+)*" oninput={() => { if (createErrors.slug) createErrors = { ...createErrors, slug: '' }; }} />
              {#if createErrors.slug}<small class="field-err">{createErrors.slug}</small>{/if}
            </div>
            {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
            <Button type="submit" disabled={tracker.isDirty || createBusy || busy || parentBusy || !canStructure || !newTitle.trim() || !newSlug.trim()} loading={createBusy}>Create</Button>
          </form>
        {/if}

        {#if block.sequences.length === 0}
          <p class="empty">
            {canStructure ? 'No sequences yet.' : 'No sequences.'}
          </p>
        {:else}
          <ul class="seqs-list">
            {#each block.sequences as seq, i (seq.id)}
              <li>
                <SequenceAccordion
                  {courseSlug}
                  {vid}
                  {block}
                  {seq}
                  index={i + 1}
                  sequenceCount={block.sequences.length}
                  {routeBid}
                  {routeSid}
                  onMoveUp={() => void reorderSeq(i, -1)}
                  onMoveDown={() => void reorderSeq(i, 1)}
                  parentBusy={busy || createBusy || parentBusy}
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
            disabled={tracker.isDirty || busy || createBusy || parentBusy || block.sequences.length > 0}
            title={tracker.isDirty ? 'Save or discard changes first' : block.sequences.length > 0 ? 'Remove sequences first' : ''}
            onclick={deleteBlock}
          >Delete this block</Button>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .block { border: 1px solid var(--border); border-radius: var(--radius); margin: var(--space-2) 0; }
  .accordion-body { padding: var(--space-3); border-top: 1px solid var(--border); }
  .meta { margin-bottom: var(--space-3); }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta input, .meta textarea { width: 100%; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .create { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input { width: 100%; }
  .create .field { display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
  .seqs-list { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--muted); }
  .danger { padding-top: var(--space-3); border-top: 1px solid var(--border); margin-top: var(--space-3); }
</style>
