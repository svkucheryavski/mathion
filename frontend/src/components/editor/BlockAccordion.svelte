<script lang="ts">
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import SequenceAccordion from './SequenceAccordion.svelte';
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
  const headerId = $derived(`block-${String(block.id)}-header`);
  const panelId = $derived(`block-${String(block.id)}-panel`);

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canStructure = $derived(perms?.canEditStructure ?? false);
  const structReason = $derived(version ? structureReason(version) : null);
  const txtReason = $derived(version ? textReason(version) : null);
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

  // One field per PATCH (D2). A PATCH failure propagates to InlineField
  // (inline error); only the follow-up refresh is guarded.
  async function patchBlock(field: { title: string } | { info: string }) {
    const savedVid = vid;
    const savedBid = block.id;
    await api.patch(`/api/blocks/${savedBid}`, field);
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

  // Footer text mirrors the trash button's title (ref 1610). Precedence:
  // structure reason → sequences remain → create form open → enabled.
  const deleteText = $derived(
    structReason
      ? `Delete this block — ${structReason[0].toLowerCase()}${structReason.slice(1)}`
      : block.sequences.length > 0
        ? 'Delete this block — remove its sequences first'
        : creating
          ? 'Delete this block — cancel the new sequence first'
          : 'Delete this block',
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
    if (!(creating && expanded)) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  // Collapse resets the form: a collapsed block shows no form, so a latent
  // open one must not reappear on the next expansion. Tracks only `expanded`.
  $effect(() => {
    if (!expanded) untrack(() => { if (creating) { resetCreate(); creating = false; } });
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

  // The header `+` (ref 1568). On a collapsed block it first expands the block
  // through the router (so the DirtyGuard prompt still applies), then opens
  // the form only if the expansion actually landed — a cancelled prompt
  // leaves everything unchanged.
  async function onPlus() {
    if (structReason || createBusy || busy || parentBusy) return;
    if (expanded) { await toggleCreate(); return; }
    await navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    await tick();
    if (!expanded) return;
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

<div class="block-card">
  <AccordionHeader
    {headerId}
    {panelId}
    level="block"
    title={block.title}
    slug={block.slug}
    {index}
    {expanded}
    badge={`B${index}`}
    busy={busy || createBusy || parentBusy}
    structureReason={structReason}
    canReorderUp={index > 1}
    canReorderDown={index < blockCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  >
    {#snippet extra()}
      <IconButton
        size="sm"
        glyph={creating && expanded ? 'close' : 'plus'}
        title={structReason ?? (creating && expanded ? 'Cancel new sequence' : 'New sequence')}
        aria-label={`New sequence in ${name}`}
        aria-expanded={creating && expanded}
        disabled={!!structReason || busy || createBusy || parentBusy}
        onclick={() => void onPlus()}
      />
    {/snippet}
  </AccordionHeader>

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="acc-body">
      <div class="fields">
        <InlineField
          label="Block title"
          value={block.title}
          required
          maxlength={200}
          editTitle="Edit the block title"
          disabledReason={txtReason}
          onCommit={(p) => patchBlock({ title: String(p) })}
        />
        <InlineField
          label="Info (markdown)"
          value={block.info}
          kind="textarea"
          editTitle="Edit the block info"
          disabledReason={txtReason}
          onCommit={(p) => patchBlock({ info: String(p) })}
        />
      </div>

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

      <div class="del-footer">
        <IconButton
          glyph="trash"
          danger
          title={deleteText}
          aria-label={`Delete block ${name}`}
          disabled={!!structReason || block.sequences.length > 0 || creating || busy || createBusy || parentBusy}
          onclick={() => void deleteBlock()}
        />
        <span class="del-text">{deleteText}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .block-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
    margin-bottom: 10px; /* ref 1563 */
  }
  .acc-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; /* ref 1570 */ }
  .fields { display: flex; flex-direction: column; }
  .fields > :global(.inline-field:last-child) { border-bottom: 0; /* ref 1548 */ }
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
