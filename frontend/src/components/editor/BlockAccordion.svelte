<script lang="ts">
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import AccordionHeader, { type HeaderMode } from './AccordionHeader.svelte';
  import SequenceAccordion from './SequenceAccordion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { unsavedSuffix } from '../../lib/editorReasons';
  import { labelFor } from '../../lib/labelFor';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
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
    // parentBusy disables this block's controls while a parent
    // (VersionEditPage) mutation is in flight.
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
  // Slice-5c D1/D4: where this block sits relative to the focus. A collapsed
  // block is "outside" only while ANOTHER block of the loaded tree is really
  // open — a stale route id (about to fall back) keeps the rows at the focus
  // level, so their controls don't flicker off for a frame.
  const seqOpen = $derived(expanded && block.sequences.some((s) => String(s.id) === routeSid));
  const otherOpen = $derived(
    routeBid !== null && (currentEditorVersion.value?.blocks.some((b) => String(b.id) === routeBid) ?? false),
  );
  const mode: HeaderMode = $derived(
    expanded ? (seqOpen ? 'open-parent' : 'open-focus') : (otherOpen ? 'row-outside' : 'row-focus'),
  );
  const headerId = $derived(`block-${String(block.id)}-header`);
  const panelId = $derived(`block-${String(block.id)}-panel`);

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canStructure = $derived(perms?.canEditStructure ?? false);
  const canEditTitle = $derived(perms?.canEditTextFields ?? false);
  const name = $derived(labelFor(block.title, block.slug, `block ${index}`));

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    }
  }

  let busy = $state(false);

  // Track unmount so post-await reloads on a torn-down component (route
  // change away from /edit/v/:vid entirely) skip cleanly.
  let alive = true;
  onDestroy(() => { alive = false; });

  // Guard for post-await force-reloads: skip the reload if the user has
  // already navigated to a different version. loadAdminTree's token mechanism
  // catches out-of-order completion of NORMAL loads, but `{force: true}`
  // advances the token unconditionally — an old force-reload would win and
  // overwrite the new vid's tree.
  //
  // We compare against the LIVE `vid` (which reflects the current `versionId`
  // prop the router supplies — instance preservation on /edit/v/:vid
  // navigation means the prop updates without unmounting). Checking the store
  // value would miss the window between "navigation occurred" and "new tree
  // finished loading". Passed down to SequenceAccordion, whose own lifetime
  // ends when this block collapses (§4 race guards).
  function stillOnVid(savedVid: number): boolean {
    return alive && vid === savedVid;
  }

  // D8: the header's inline title. One PATCH; a failure propagates to the
  // header (inline error); only the follow-up refresh is guarded.
  async function renameBlock(title: string) {
    const savedVid = vid;
    const savedBid = block.id;
    await api.patch(`/api/blocks/${savedBid}`, { title });
    if (!stillOnVid(savedVid)) return;
    const result = await loadAdminTree(savedVid, { force: true });
    if (result === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
  }

  async function deleteBlock() {
    if (creating || !canStructure || busy || createBusy || parentBusy || block.sequences.length > 0) return;
    if (!confirm(`Delete block "${block.title}"? This cannot be undone.${unsavedSuffix(dirty.isAnyDirty())}`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/blocks/${block.id}`);
      if (stillOnVid(savedVid)) {
        // Navigate FIRST so the route no longer names the deleted block when
        // the new tree lands (otherwise the page's validation effect shows a
        // spurious "Block not found."). Only when the live route still names
        // it (`expanded`): if the user has meanwhile expanded another block,
        // a forced navigate would collapse it and drop its drafts unprompted.
        // `force` — the user already confirmed; `replace` — keep the deleted
        // URL out of history.
        if (expanded) void navigate(`/courses/${savedSlug}/edit/v/${savedVid}`, { replace: true, force: true });
        await loadAdminTree(savedVid, { force: true });
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
    }
  }

  // Sequence-list reorder: this component owns block.sequences and the API call.
  async function reorderSeq(idx: number, dir: -1 | 1) {
    // Defense-in-depth: the AccordionHeader gates the up/down buttons on
    // `busy || createBusy || parentBusy`, but a stale/programmatic click
    // could still call this. A second reorder while one is in flight would
    // see a pre-swap snapshot of block.sequences. Not blocked by drafts (D3).
    if (busy || createBusy || parentBusy) return;
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
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
    }
  }

  // Inline create-sequence form
  let creating = $state(false);
  let newTitle = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let titleEl = $state<HTMLInputElement>();

  // D6: why the header trash is blocked (null = it may delete). The version's
  // permission is not a reason here: without it the trash is hidden.
  const deleteBlockedReason = $derived(
    block.sequences.length > 0
      ? 'Remove its sequences first'
      : creating
        ? 'Cancel the new sequence first'
        : null,
  );

  function resetCreate() {
    newTitle = '';
    createErrors = {};
    createGlobalError = null;
  }

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  // discard() lets a confirmed DirtyGuard prompt really drop the draft (D3).
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && newTitle.trim() !== '';
    },
    discard() { resetCreate(); creating = false; },
  };

  // Registered only while the form is actually on screen.
  $effect(() => {
    if (!(creating && mode === 'open-focus')) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  // Leaving the focus (collapse, or one of its sequences opens) resets the
  // form: it is only offered at the focus (5c D4), and a latent open one must
  // not reappear later. Tracks only `mode`.
  $effect(() => {
    if (mode !== 'open-focus') untrack(() => { if (creating) { resetCreate(); creating = false; } });
  });

  // Close + reset the create form if structure permission is revoked while
  // the form is open (e.g., parent publishes the version mid-edit). Without
  // this, the form would stay submittable even though the underlying
  // permission has flipped.
  $effect(() => {
    if (!canStructure && creating) {
      resetCreate();
      creating = false;
    }
  });

  async function toggleCreate() {
    // Defense-in-depth: refuse mid-flight toggles. The toggle button is
    // already disabled in these states, but a stale/programmatic click
    // would otherwise unmount the form during an in-flight POST,
    // discarding validation errors and unregistering the create tracker.
    if (createBusy || busy || parentBusy) return;
    if (creating) { resetCreate(); creating = false; return; }
    creating = true;
    await tick();
    titleEl?.focus();
  }

  async function submitCreate() {
    if (createBusy || busy || parentBusy || !canStructure || !newTitle.trim()) return;
    const savedVid = vid;
    const savedBid = block.id;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences`, { title: newTitle });
      resetCreate(); creating = false;
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
      pushToast('Sequence created', 'success');
    } catch (e) {
      const mapped = mapCreateError(e, ['title']);
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

<div class="block-card" class:focus={mode === 'open-focus'} class:parent={mode === 'open-parent'}>
  <AccordionHeader
    {headerId}
    {panelId}
    level="block"
    {mode}
    title={block.title}
    slug={block.slug}
    {index}
    {expanded}
    busy={busy || createBusy || parentBusy}
    {canStructure}
    {canEditTitle}
    canReorderUp={index > 1}
    canReorderDown={index < blockCount}
    {deleteBlockedReason}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
    onDelete={() => void deleteBlock()}
    onRename={renameBlock}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="acc-body">
      {#if mode === 'open-focus' && canStructure}
        <!-- Interim until T3's "+ Add sequence" row (ledger: T2). -->
        <div class="body-tools">
          <IconButton
            size="sm"
            glyph={creating ? 'close' : 'plus'}
            title={creating ? 'Cancel new sequence' : 'New sequence'}
            aria-label={`New sequence in ${name}`}
            aria-expanded={creating}
            disabled={busy || createBusy || parentBusy}
            onclick={() => void toggleCreate()}
          />
        </div>
      {/if}

      {#if creating}
        <form class="cr-form" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
          <input
            bind:this={titleEl}
            placeholder="Title"
            aria-label="Sequence title"
            bind:value={newTitle}
            required
            disabled={createBusy || busy || parentBusy}
            oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }}
          />
          {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
          <div class="cr-actions">
            <Button type="submit" disabled={createBusy || busy || parentBusy || !canStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
          </div>
        </form>
      {/if}

      {#if block.sequences.length === 0}
        <p class="empty">{canStructure ? 'No sequences yet.' : 'No sequences.'}</p>
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
                {stillOnVid}
                onMoveUp={() => void reorderSeq(i, -1)}
                onMoveDown={() => void reorderSeq(i, 1)}
                parentBusy={busy || createBusy || parentBusy}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .block-card {
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
    background: transparent; /* a row takes its container's shade (5c D1) */
    overflow: hidden;
    margin-bottom: 6px;
  }
  .block-card.parent { background: var(--focus-1); }
  .block-card.focus {
    background: var(--focus-0);
    border-color: var(--focus-line-strong);
    box-shadow: var(--focus-shadow);
  }
  .acc-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; /* ref 1570 */ }
  .body-tools { display: flex; justify-content: flex-end; }
  /* Create forms — shared look (spec §4). */
  .cr-form { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
  .cr-form input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .cr-actions { display: flex; justify-content: flex-end; }
  .field-err, .form-err { margin: 0; font-size: 12.5px; color: var(--danger); }
  .empty { margin: 0; font-size: 13px; color: var(--muted); }
  .seqs-list { display: flex; flex-direction: column; gap: 10px; list-style: none; padding: 0; margin: 0; /* ref 1570 rhythm */ }
</style>
