<script lang="ts">
  import { setContext, onDestroy, onMount, tick, untrack } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { structureReason, unsavedSuffix } from '../../lib/editorReasons';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { deriveExpansion } from '../../lib/deriveExpansion';
  import { handleStaleIdFallback } from '../../lib/handleStaleIdFallback';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import VersionMetaForm from '../../components/editor/VersionMetaForm.svelte';
  import BlockAccordion from '../../components/editor/BlockAccordion.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import VersionBadges from '../../components/editor/VersionBadges.svelte';
  import ItemEditorModal from '../../components/editor/ItemEditorModal.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { RegisteredTracker } from '../../lib/dirtyRegistry.svelte';

  type Props = {
    courseSlug: string;
    versionId: string;
    blockId?: string;
    sequenceId?: string;
    // Slice-5b D1: the item route is served here too; the item opens in a modal.
    itemId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId, itemId }: Props = $props();

  const vid = $derived(Number(versionId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  const routeBid = $derived(blockId ?? null);
  const routeSid = $derived(sequenceId ?? null);
  const routeIid = $derived(itemId ?? null);

  // Provide dirty registry BEFORE any consumer mounts (provider-before-
  // consumers ordering per spec).
  const dirtyRegistry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const slugMatches = $derived(!!tree && tree.course.slug === courseSlug);
  const perms = $derived(v ? versionPermissions(v) : null);
  const blockReason = $derived(v ? structureReason(v) : null);

  // Tree that actually matches the URL we're rendering. During navigation
  // (X → Y, instance preserved) the store still holds X's tree until the
  // load $effect's loadAdminTree(Y) resolves. Validation and focus must
  // operate ONLY on a matching tree, otherwise they'd judge Y's routeBid /
  // routeSid against X's blocks and incorrectly redirect.
  const effectiveTree = $derived(
    tree && tree.version.id === vid && slugMatches ? tree : null,
  );

  let busy = $state(false);

  // Blocks card fold (§3 T4): component-local, default open, body stays
  // mounted (D3). Declared before the load effect: it only reads routeBid.
  const uid = $props.id();
  const blocksBodyId = `${uid}-blocks`;
  let blocksFolded = $state(false);
  // Unfold on every change of the route block id (deep link, Back/forward
  // A → B) so the focus $effect never targets a header inside a hidden body.
  // Tracks ONLY routeBid — the user can still fold while a block is expanded.
  $effect(() => {
    if (routeBid !== null) untrack(() => { blocksFolded = false; });
  });

  // ---- Slice-5b item modal (D7 close, D9 delete, D18 focus). Plain `let`s
  //      where nothing renders from the value. ----
  // D7: was the page mounted ON an item URL (deep link / reload)? Then × must
  // replace to the sequence; every later open is in-page and × = Back.
  let mountedOnItem = untrack(() => itemId) !== undefined;
  let openedFromPage = false;
  // Re-entrancy latch: a double ×, Escape-then-× or auto-repeat closes once.
  let closing = false;
  // D9: the item whose DELETE is in flight (freezes ITS modal only).
  let deletingIid = $state<number | null>(null);
  // D9: the item this page just deleted — its stale route is an expected close.
  let deletedIid: number | null = null;
  // D18: the one-shot close signal for the focus effect.
  let lastClosedIid: string | null = null;
  let justClosedItem = false;
  let prevRouteIid: string | null = untrack(() => routeIid);

  // Load $effect — declared FIRST (declaration-order discipline:
  // load → validation → focus, see spec §"$effect declaration order").
  $effect(() => {
    if (!vidValid) return;
    void loadAdminTree(vid);
  });

  // Validation $effect — declared SECOND in declaration order so stale-id
  // correction lands before the focus effect tries to find a toggle for a
  // stale entity. Uses effectiveTree (not tree) so stale-id checks aren't
  // run against the OLD version's blocks during preserved-instance nav.
  const expansion = $derived(deriveExpansion(routeBid, routeSid, effectiveTree, routeIid));
  $effect(() => {
    if (!effectiveTree) return;
    const e = expansion;
    if (e.staleBid || e.staleSid || e.staleIid) {
      handleStaleIdFallback(
        { staleBid: e.staleBid, staleSid: e.staleSid, staleIid: e.staleIid },
        { courseSlug, vid: String(vid), bid: routeBid, sid: routeSid, iid: routeIid, deletedIid },
        { pushToast, navigate },
      );
    }
  });

  // Item-route $effect (Slice-5b D7/D18) — declared after validation and
  // BEFORE focus: the focus effect reads the one-shot flag set here.
  $effect(() => {
    const iid = routeIid;
    untrack(() => {
      if (iid !== prevRouteIid) closing = false;
      if (iid !== null) {
        openedFromPage = !mountedOnItem;
      } else {
        if (prevRouteIid !== null) {
          lastClosedIid = prevRouteIid;
          justClosedItem = true;
        }
        mountedOnItem = false;   // every later open is in-page
        openedFromPage = false;
        deletedIid = null;
      }
      prevRouteIid = iid;
    });
  });

  // Focus $effect — declared THIRD. Tracks (routeBid, routeSid,
  // effectiveTree) so it re-fires after the initial admin-tree load
  // resolves on deep-link mount. Uses effectiveTree (not tree) so we don't
  // try to find a header in a stale-vid tree.
  //
  // lastFocusedTarget remembers the headerId we last auto-focused. On a
  // plain tree refresh (e.g., save → loadAdminTree → currentEditorVersion
  // replaced) the route ids are unchanged, so the same headerId is computed
  // — and we skip refocus. Without this, typing in an input inside the
  // panel would lose focus on every save.
  let lastFocusedTarget = $state<string | null>(null);
  $effect(() => {
    const bid = routeBid;
    const sid = routeSid;
    const iid = routeIid;
    const t = effectiveTree;
    // D18 one-shot, read untracked at the TOP: a tracked write-then-read
    // would re-run this effect. Cleared on every early return below, so it
    // can never outlive its close.
    const closedNow = untrack(() => justClosedItem);
    // An open item owns focus (its modal): never race it.
    if (iid !== null) { justClosedItem = false; return; }
    if (!t) { justClosedItem = false; return; }

    // Resolve deepest expanded headerId from current state.
    let headerId: string | null = null;
    if (bid !== null) {
      const blockMatch = t.blocks.find((b) => String(b.id) === bid);
      if (blockMatch) {
        if (sid !== null) {
          const seqMatch = blockMatch.sequences.find((s) => String(s.id) === sid);
          headerId = seqMatch
            ? `seq-${String(seqMatch.id)}-header`
            : `block-${String(blockMatch.id)}-header`;
        } else {
          headerId = `block-${String(blockMatch.id)}-header`;
        }
      }
    }
    if (!headerId) {
      // Collapsed back to version root — clear the memo so the next
      // expansion refocuses correctly.
      lastFocusedTarget = null;
      justClosedItem = false;
      return;
    }

    if (closedNow) {
      // An item just closed. FocusTrap has already restored focus to the
      // opener, or to whatever the user had focused: leave it there. Only
      // when focus fell to <body> (the opener is gone: a create form's
      // button, a deep link) does the closed item's Open pencil take it, else
      // the header. Never the scroll path below. The memo is set so a later
      // reload does not refocus.
      lastFocusedTarget = headerId;
      const fallbackHeaderId = headerId;
      const closedIid = lastClosedIid;
      let cancelled = false;
      void (async () => {
        // Within this flush the modal's × is still mounted and focused.
        await tick();
        if (cancelled) return;
        justClosedItem = false;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const pencil = closedIid !== null ? document.getElementById(`item-${closedIid}-open`) : null;
        (pencil ?? document.getElementById(fallbackHeaderId))?.focus();
      })();
      return () => { cancelled = true; };
    }

    // Skip refocus if route hasn't changed since the last auto-focus.
    if (headerId === lastFocusedTarget) return;
    lastFocusedTarget = headerId;

    // Capture the target headerId before await so a later effect run can't
    // race ahead of this one.
    const targetHeaderId = headerId;
    let cancelled = false;
    void (async () => {
      await tick();
      if (cancelled) return;
      // Read activeElement BEFORE any focus() call — once we focus we have
      // changed activeElement ourselves and the discriminator becomes
      // self-referential.
      const active = document.activeElement?.id ?? null;
      if (active === targetHeaderId) return; // user-click branch
      const el = document.getElementById(targetHeaderId);
      if (!el) return;
      el.focus();
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
    })();
    return () => { cancelled = true; };
  });

  let alive = true;
  onDestroy(() => { alive = false; clearEditorVersion(); });

  function stillOnVid(savedVid: number): boolean {
    return alive && vid === savedVid;
  }

  // D7: a guard cancelled at the prompt leaves the item open — re-arm ×.
  onMount(() => {
    const onPop = () => { closing = false; };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  function seqUrl(): string {
    return `/courses/${courseSlug}/edit/v/${vid}/blocks/${routeBid}/sequences/${routeSid}`;
  }

  // D7: × and Escape. Back-equivalent when the item was opened in this page
  // instance; otherwise (deep link / reload) replace the address with the
  // sequence — × can never take the user out of the app. Guards run.
  function requestCloseItem() {
    if (closing) return;
    if (deletingIid !== null && String(deletingIid) === routeIid) return;
    closing = true;
    if (openedFromPage) { history.back(); return; }
    const from = routeIid;
    void navigate(seqUrl(), { replace: true }).then(() => {
      if (routeIid === from) closing = false;   // the prompt was cancelled
    });
  }

  // D9: page-owned, so the reload, toast and focus survive the modal's unmount.
  async function deleteOpenItem() {
    const it = expansion.expandedItem;
    if (!it || deletingIid !== null || !perms?.canEditStructure) return;
    if (!confirm(`Delete item "${it.title}"? This cannot be undone.`)) return;
    const id = it.id;
    const savedVid = vid;
    const savedSid = routeSid;
    const seqPath = seqUrl();
    deletingIid = id;
    try {
      await api.delete(`/api/items/${id}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      // A 403/409 from a state change mid-confirm: perms must catch up.
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      deletingIid = null;   // the modal refocuses its trash (or ×)
      await tick();
      return;
    }
    if (!stillOnVid(savedVid)) { deletingIid = null; return; }
    if (routeIid === String(id)) {
      deletedIid = id;
      closing = true;
      // Never history.back(): a Back the user queued while the DELETE was out
      // would be followed by a second traversal past the sequence (D9).
      void navigate(seqPath, { replace: true, force: true });
      await tick();   // the modal unmounts before the reload lands
    }
    await loadAdminTree(savedVid, { force: true });
    pushToast('Item deleted', 'success');
    if (routeIid === null && stillOnVid(savedVid) && routeSid === savedSid) {
      document.getElementById(`seq-${savedSid}-header`)?.focus();
    }
    deletingIid = null;
  }

  let creating = $state(false);
  let newTitle = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let titleEl = $state<HTMLInputElement>();

  function resetCreate() {
    newTitle = ''; createErrors = {}; createGlobalError = null;
  }

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  // discard() lets a confirmed DirtyGuard prompt really drop the draft (D3).
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && newTitle.trim() !== '';
    },
    discard() { resetCreate(); creating = false; },
  };

  // Register/unregister the create tracker — declared FOURTH in effect order.
  $effect(() => {
    if (!creating) return;
    dirtyRegistry.register(createTracker);
    return () => dirtyRegistry.unregister(createTracker);
  });

  // canStructure-flip $effect: reset create form when canEditStructure flips false.
  $effect(() => {
    if (perms && !perms.canEditStructure && creating) {
      resetCreate();
      creating = false;
    }
  });

  // Opening also unfolds the card — a hidden Title could not take focus.
  async function toggleCreate() {
    if (createBusy || busy || blockReason) return;
    if (creating) { resetCreate(); creating = false; return; }
    blocksFolded = false;
    creating = true;
    await tick();
    titleEl?.focus();
  }

  async function submitCreateBlock() {
    if (createBusy || busy || !perms?.canEditStructure || !newTitle.trim()) return;
    const savedVid = vid;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks`, { title: newTitle, info: '' });
      newTitle = ''; creating = false;
      if (!stillOnVid(savedVid)) return;
      await loadAdminTree(savedVid, { force: true });
      pushToast('Block created', 'success');
    } catch (e) {
      const mapped = mapCreateError(e, ['title']);
      // The form closed while the POST was in flight (a confirmed discard, a
      // read-only flip): there is no form to show the error on, and writing it
      // would resurface stale on the next open — toast it instead (as the
      // accordions' create forms do).
      if (!creating) {
        pushToast(mapped.globalMessage ?? Object.values(mapped.fieldErrors)[0] ?? 'Create failed', 'error');
        return;
      }
      createErrors = mapped.fieldErrors;
      createGlobalError = mapped.globalMessage
        ?? (Object.keys(mapped.fieldErrors).length === 0 ? 'Create failed' : null);
      if (createGlobalError && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(createGlobalError, 'error');
      }
    } finally {
      createBusy = false;
    }
  }

  async function reorderBlock(idx: number, dir: -1 | 1) {
    if (busy || createBusy) return;
    if (!tree) return;
    const blocks = [...tree.blocks];
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    [blocks[idx], blocks[target]] = [blocks[target], blocks[idx]];
    const order = blocks.map((b, i) => ({ id: b.id, order: i + 1 }));
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks/reorder`, { order });
      if (!stillOnVid(savedVid)) return;
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
    }
  }

  // D3: transitions are never blocked by an open draft. Publish / archive /
  // disable make every field read-only (closing open drafts), so their confirm
  // warns; revert and enable never drop a draft.
  async function transition(action: 'publish' | 'archive' | 'revert' | 'disable' | 'enable') {
    const suffix = unsavedSuffix(dirtyRegistry.isAnyDirty());
    const prompts: Record<string, string> = {
      publish: `Publish version ${vid}? Students will see it.${suffix}`,
      archive: `Archive version ${vid}?${suffix}`,
      revert: `Revert version ${vid} to created?`,
      disable: `Disable version ${vid}?${suffix}`,
      enable: `Enable version ${vid}?`,
    };
    if (!confirm(prompts[action])) return;
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/${action}`);
      // A version switch mid-request: a forced reload of the old version would
      // discard the new version's load and strand the page on its Skeleton.
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      const past: Record<typeof action, string> = {
        publish: 'published', archive: 'archived', revert: 'reverted',
        disable: 'disabled', enable: 'enabled',
      };
      pushToast(`Version ${past[action]}`, 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : `Could not ${action}`, 'error');
    } finally {
      busy = false;
    }
  }

  // The course name in the <h1> is the way back to the version list (§5.2).
  // Plain left clicks route in-app; modifier / middle clicks fall through so
  // the list can open in a new tab (the router has no global anchor capture).
  function onCourseLink(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void navigate(`/courses/${courseSlug}/edit`);
  }

  async function deleteVersion() {
    if (!confirm(`Delete version v${vid}? This cannot be undone.${unsavedSuffix(dirtyRegistry.isAnyDirty())}`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/versions/${savedVid}`);
      // force: the user already confirmed above — no second DirtyGuard prompt.
      // replace: Back must not return to the deleted version. Only while still on
      // it — after a version switch, a forced navigate would drop the new page's drafts.
      if (stillOnVid(savedVid)) void navigate(`/courses/${savedSlug}/edit`, { replace: true, force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }
</script>

{#snippet backToVersions()}
  <Button variant="secondary" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>Back to versions</Button>
{/snippet}

<div class="page">
  {#if !vidValid}
    <ErrorState variant="page" title="Bad URL" message={`Version "${versionId}" is not a valid id.`} action={backToVersions} />
  {:else if loadError && (!tree || tree.version.id !== vid)}
    <ErrorState variant="page" title="Couldn't load" message={loadError} action={backToVersions} />
  {:else if !tree || tree.version.id !== vid}
    <Skeleton rows={4} />
  {:else if !slugMatches}
    <ErrorState variant="page" title="Not found" message={`This version does not belong to course "${courseSlug}".`} action={backToVersions} />
  {:else if !v || !perms}
    <Skeleton rows={4} />
  {:else}
    {#if loadError}
      <div class="refresh-err">
        <ErrorState variant="inline" title="Couldn't refresh this version" message={loadError} onretry={() => void loadAdminTree(vid, { force: true })} />
      </div>
    {/if}
    <div class="editor-heading">
      <h1><a href={`/courses/${courseSlug}/edit`} title="Back to versions" onclick={onCourseLink}>{tree.course.name}</a>{#if v.label}<span class="vlabel">{` · ${v.label}`}</span>{/if}</h1>
      <span class="mono vid">v{v.id}</span>
      <VersionBadges state={v.state} isDisabled={v.is_disabled} />
    </div>

    {#if v.is_disabled}
      <p class="banner">This version is disabled — editing is not allowed. Enable it first.</p>
    {/if}

    <VersionMetaForm {vid} version={v} />

    <section class="blocks-card">
      <div class="card-head">
        <h2>Blocks</h2>
        <IconButton
          size="sm"
          borderless
          glyph={blocksFolded ? 'chevron-right' : 'chevron'}
          title={blocksFolded ? 'Expand' : 'Collapse'}
          aria-label={blocksFolded ? 'Expand blocks' : 'Collapse blocks'}
          aria-expanded={!blocksFolded}
          aria-controls={blocksBodyId}
          onclick={() => (blocksFolded = !blocksFolded)}
        />
        <span class="push">
          <IconButton
            primary
            glyph={creating ? 'close' : 'plus'}
            title={blockReason ?? (creating ? 'Cancel new block' : 'New block')}
            aria-label="New block"
            aria-expanded={creating}
            disabled={!!blockReason || busy || createBusy}
            onclick={() => void toggleCreate()}
          />
        </span>
      </div>

      <!-- No display rule on the element carrying `hidden` (§3). -->
      <div id={blocksBodyId} hidden={blocksFolded}>
        {#if creating}
          <form class="cr-form" onsubmit={(e) => { e.preventDefault(); void submitCreateBlock(); }}>
            <input
              bind:this={titleEl}
              placeholder="Title"
              aria-label="Block title"
              bind:value={newTitle}
              required
              disabled={createBusy || busy}
              oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }}
            />
            {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
            {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
            <div class="cr-actions">
              <Button type="submit" disabled={createBusy || busy || !perms?.canEditStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
            </div>
          </form>
        {/if}

        {#if tree.blocks.length === 0}
          <EmptyState title={v.state === 'created' ? 'No blocks yet' : 'This version has no blocks.'} />
        {:else}
          <ul class="blocks-list">
            {#each tree.blocks as block, i (block.id)}
              <li>
                <BlockAccordion
                  {courseSlug}
                  {vid}
                  {block}
                  index={i + 1}
                  blockCount={tree.blocks.length}
                  {routeBid}
                  {routeSid}
                  onMoveUp={() => void reorderBlock(i, -1)}
                  onMoveDown={() => void reorderBlock(i, 1)}
                  parentBusy={busy || createBusy}
                />
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    <div class="state-actions">
      {#if perms.canPublish}
        <Button variant="primary" disabled={busy} onclick={() => transition('publish')}>Publish</Button>
      {/if}
      {#if perms.canArchive}
        <Button variant="secondary" disabled={busy} onclick={() => transition('archive')}>Archive</Button>
      {/if}
      {#if perms.canRevert}
        <Button variant="secondary" disabled={busy} onclick={() => transition('revert')}>Revert</Button>
      {/if}
      {#if perms.canDisable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('disable')}>Disable</Button>
      {/if}
      {#if perms.canEnable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('enable')}>Enable</Button>
      {/if}
      {#if perms.canDeleteVersion}
        <Button variant="danger" disabled={busy} onclick={deleteVersion}>Delete</Button>
      {/if}
    </div>

    {#if expansion.expandedItem && expansion.expandedBlock && expansion.expandedSequence}
      {@const it = expansion.expandedItem}
      {@const hostBlock = expansion.expandedBlock}
      {@const hostSeq = expansion.expandedSequence}
      <!-- D1: the item opens over the page; keyed so drafts seed once per item. -->
      {#key it.id}
        <ItemEditorModal
          {vid}
          version={v}
          {perms}
          seqIndex={hostBlock.sequences.indexOf(hostSeq) + 1}
          item={it}
          itemIndex={hostSeq.items.indexOf(it) + 1}
          itemCount={hostSeq.items.length}
          {stillOnVid}
          onRequestClose={requestCloseItem}
          onDeleteItem={() => void deleteOpenItem()}
          deleting={deletingIid === it.id}
        />
      {/key}
    {/if}

    <DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} onDiscard={() => dirtyRegistry.discardAll()} />
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  .editor-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; /* ref 1525 */ }
  .editor-heading h1 { font-size: 20px; /* ref 1526 — base.css h1 is 21px */ min-width: 0; overflow-wrap: anywhere; }
  .editor-heading a { color: var(--primary); text-decoration: none; /* ref 1526 */ }
  .editor-heading a:hover { text-decoration: underline; }
  .vlabel { color: var(--text); /* ref 1526 */ }
  .vid { font-size: 12px; /* ref 1527 */ color: var(--muted); }
  /* §4 precondition banner, information form. */
  .banner {
    margin: 0 0 18px; /* the 18px section rhythm (ref 1525) */
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 13px;
    color: var(--text);
  }
  .refresh-err { margin-bottom: 18px; /* the 18px section rhythm (ref 1525) */ }
  .blocks-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 16px 18px; /* ref 1555 */
  }
  .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; /* ref 1556 */ }
  h2 { font-size: 14px; /* ref 1557 — base.css h2 is 15px */ }
  .push { margin-left: auto; display: flex; /* ref 1559 */ }
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
  .blocks-list { list-style: none; padding: 0; margin: 0; }
  .state-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--border); /* ref 1639 */
  }
</style>
