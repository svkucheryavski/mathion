<script lang="ts">
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import AccordionHeader, { type HeaderMode } from './AccordionHeader.svelte';
  import SequenceAccordion from './SequenceAccordion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { unsavedSuffix } from '../../lib/editorReasons';
  import TreeAskRow from './TreeAskRow.svelte';
  import { useTreeAsk, settleTo, moveOn, withdraw, firstUsable, focusAfter, type Ask } from '../../lib/askInPlace.svelte';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
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

  // Polish 1 #5 (R53): the tree's one question, keyed by node. Mounted on its
  // own (tests), the block makes it and shares it with its sequences.
  const treeAsk = useTreeAsk();
  const askKey = $derived(`block-${String(block.id)}`);
  let cardEl = $state<HTMLDivElement>();
  const trashEl = () => cardEl?.querySelector<HTMLElement>('[data-action="delete-block"]');
  const courseLink = () => document.querySelector('[data-action="course-link"]');

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canStructure = $derived(perms?.canEditStructure ?? false);
  const canEditTitle = $derived(perms?.canEditTextFields ?? false);

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
    const savedVid = vid;
    const savedSlug = courseSlug;
    const savedId = block.id;
    const title = block.title;
    const q: Ask = {
      // A getter: the suffix follows the page while it asks.
      warning: () => `Delete block "${title}"? This cannot be undone.${unsavedSuffix(dirty.isAnyDirty())}`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end', confirmDataAction: 'confirm-delete-block', key: askKey,
    };
    const a = await treeAsk.ask(q);
    // The trash, else (disabled meanwhile) the header: never <body>.
    if (a === 'cancel') { void focusAfter(() => firstUsable(trashEl(), document.getElementById(headerId))); return; }
    if (a !== 'confirm') return;
    // R49: the same block, still deletable, at the focus, on the same version.
    if (!stillOnVid(savedVid) || block.id !== savedId || block.title !== title || mode !== 'open-focus'
        || creating || !canStructure || busy || createBusy || parentBusy || block.sequences.length > 0) {
      withdraw(treeAsk, q, () => firstUsable(trashEl(), document.getElementById(headerId)));
      return;
    }
    // R54: where focus goes on success, resolved by id before the reload: the
    // next block's header, else the previous (block headers are never
    // disabled); with no block left, the course link meanwhile and
    // "+ Add block" once the reload lands. The block itself unmounts with that
    // reload, so the last move finds its target by data-action.
    const ids = currentEditorVersion.value?.blocks.map((b) => b.id) ?? [];
    const at = ids.indexOf(savedId);
    const nextId = at < 0 ? undefined : (ids[at + 1] ?? ids[at - 1]);
    busy = true;
    try {
      await api.delete(`/api/blocks/${savedId}`);
      const interim = nextId !== undefined
        ? await settleTo(treeAsk, q, () => document.getElementById(`block-${nextId}-header`))
        : await settleTo(treeAsk, q, courseLink, { preventScroll: true });
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
        if (interim && nextId === undefined) await moveOn(interim, () => document.querySelector('[data-action="add-block"]'));
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
      // A failure keeps the row: the question stayed busy through the reload
      // above and settles now, back on the trash (R54). After success: nothing.
      void settleTo(treeAsk, q, trashEl);
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

  // "+ Add sequence" (5c D9): a quiet line after the list opens an inline
  // title row — Enter or ✓ creates, Esc or ✕ cancels.
  let creating = $state(false);
  let newTitle = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let titleEl = $state<HTMLInputElement>();
  let addLineEl = $state<HTMLButtonElement>();
  const addErrId = $derived(`block-${String(block.id)}-add-err`);

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

  async function openAdd() {
    // Defense-in-depth: the line is disabled in these states, but a stale or
    // programmatic click must not open a row that could not submit.
    if (createBusy || busy || parentBusy || !canStructure) return;
    creating = true;
    await tick();
    titleEl?.focus();
  }

  async function cancelAdd() {
    if (createBusy) return;
    resetCreate(); creating = false;
    await tick();
    addLineEl?.focus();
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
      // The row is gone; give a keyboard author the line back for the next
      // one — unless focus already moved somewhere on purpose.
      await tick();
      if (document.activeElement === document.body) addLineEl?.focus();
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

<div class="block-card" bind:this={cardEl} class:at-focus={mode === 'row-focus'} class:focus={mode === 'open-focus'} class:parent={mode === 'open-parent'}>
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
  <!-- #5: the delete question, under the header. -->
  <TreeAskRow ask={treeAsk} {askKey} live={mode === 'open-focus'} fallback={courseLink} />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="acc-body">
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

      {#if mode === 'open-focus' && canStructure}
        {#if creating}
          <form class="add-row" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
            <div class="add-field">
              <input
                bind:this={titleEl}
                class="add-input"
                placeholder="New sequence title"
                aria-label="New sequence title"
                aria-invalid={createErrors.title || createGlobalError ? 'true' : undefined}
                aria-describedby={createErrors.title || createGlobalError ? addErrId : undefined}
                bind:value={newTitle}
                maxlength={200}
                readonly={createBusy}
                onkeydown={(e) => { if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); void cancelAdd(); } }}
                oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; createGlobalError = null; }}
              />
              {#if createErrors.title || createGlobalError}<p id={addErrId} class="add-err" role="alert">{createErrors.title || createGlobalError}</p>{/if}
            </div>
            <IconButton size="sm" glyph="check" primary type="submit" title="Create" aria-label="Create sequence" disabled={createBusy || busy || parentBusy || !newTitle.trim()} />
            <IconButton size="sm" glyph="close" title="Cancel" aria-label="Cancel new sequence" disabled={createBusy} onclick={() => void cancelAdd()} />
          </form>
        {:else}
          <button bind:this={addLineEl} type="button" class="add-line" disabled={busy || parentBusy} onclick={() => void openAdd()}>+ Add sequence</button>
        {/if}
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
  /* 5c T5 (user): a focus-level row is white, so it stands out on the shaded page. */
  .block-card.at-focus { background: var(--focus-0); }
  .block-card.parent { background: var(--focus-1); }
  .block-card.focus {
    background: var(--focus-0);
    border-color: var(--focus-line-strong);
    box-shadow: var(--focus-shadow);
  }
  .acc-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; /* ref 1570 */ }
  /* "+ Add sequence" (5c D9): a quiet line; its row is a field with ✓ ✕. */
  .add-line {
    align-self: flex-start;
    padding: 4px 2px;
    border: 0;
    background: transparent;
    color: var(--primary);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .add-line:disabled { color: var(--muted); cursor: default; }
  .add-row { display: flex; align-items: flex-start; gap: 6px; }
  .add-field { flex: 1 1 auto; min-width: 0; }
  .add-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1.5px solid var(--primary);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
  }
  .add-err { margin: var(--space-1) 0 0; font-size: 12.5px; color: var(--danger); }
  .empty { margin: 0; font-size: 14px; color: var(--muted); }
  .seqs-list { display: flex; flex-direction: column; gap: 10px; list-style: none; padding: 0; margin: 0; /* ref 1570 rhythm */ }
</style>
