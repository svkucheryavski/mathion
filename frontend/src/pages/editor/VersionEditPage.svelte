<script lang="ts">
  import { setContext, onDestroy, tick } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { deriveExpansion } from '../../lib/deriveExpansion';
  import { handleStaleIdFallback } from '../../lib/handleStaleIdFallback';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import VersionMetaForm from '../../components/editor/VersionMetaForm.svelte';
  import BlockAccordion from '../../components/editor/BlockAccordion.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { RegisteredTracker } from '../../lib/dirtyRegistry.svelte';

  type Props = {
    courseSlug: string;
    versionId: string;
    blockId?: string;
    sequenceId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId }: Props = $props();

  const vid = $derived(Number(versionId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  const routeBid = $derived(blockId ?? null);
  const routeSid = $derived(sequenceId ?? null);

  // Provide dirty registry BEFORE any consumer mounts (provider-before-
  // consumers ordering per spec).
  const dirtyRegistry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const slugMatches = $derived(!!tree && tree.course.slug === courseSlug);
  const perms = $derived(v ? versionPermissions(v) : null);

  // Tree that actually matches the URL we're rendering. During navigation
  // (X → Y, instance preserved) the store still holds X's tree until the
  // load $effect's loadAdminTree(Y) resolves. Validation and focus must
  // operate ONLY on a matching tree, otherwise they'd judge Y's routeBid /
  // routeSid against X's blocks and incorrectly redirect.
  const effectiveTree = $derived(
    tree && tree.version.id === vid && slugMatches ? tree : null,
  );

  let busy = $state(false);

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
  $effect(() => {
    if (!effectiveTree) return;
    const expansion = deriveExpansion(routeBid, routeSid, effectiveTree);
    if (expansion.staleBid || expansion.staleSid) {
      handleStaleIdFallback(
        { staleBid: expansion.staleBid, staleSid: expansion.staleSid },
        { courseSlug, vid: String(vid), bid: routeBid },
        { pushToast, navigate },
      );
    }
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
    const t = effectiveTree;
    if (!t) return;

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
      return;
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

  let creating = $state(false);
  let newTitle = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && newTitle.trim() !== '';
    },
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
      newTitle = ''; createErrors = {}; createGlobalError = null;
      creating = false;
    }
  });

  function toggleCreate() {
    if (createBusy || busy) return;
    if (creating) { newTitle = ''; createErrors = {}; createGlobalError = null; }
    creating = !creating;
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
    if (dirtyRegistry.isAnyDirty() || busy || createBusy) return;
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

  async function transition(action: 'publish' | 'archive' | 'revert' | 'disable' | 'enable') {
    if (dirtyRegistry.isAnyDirty()) return;
    const prompts: Record<string, string> = {
      publish: `Publish version ${vid}? Students will see it.`,
      archive: `Archive version ${vid}?`,
      revert: `Revert version ${vid} to created?`,
      disable: `Disable version ${vid}?`,
      enable: `Enable version ${vid}?`,
    };
    if (!confirm(prompts[action])) return;
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/${action}`);
      await loadAdminTree(savedVid, { force: true });
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

  async function deleteVersion() {
    if (dirtyRegistry.isAnyDirty()) return;
    if (!confirm(`Delete version ${vid}? This cannot be undone.`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/versions/${savedVid}`);
      navigate(`/courses/${savedSlug}/edit`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="page">
  {#if !vidValid}
    <h1>Bad URL</h1>
    <p>Version "{versionId}" is not a valid id.</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
  {:else if loadError && (!tree || tree.version.id !== vid)}
    <h1>Couldn't load</h1>
    <p>{loadError}</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
  {:else if !tree || tree.version.id !== vid}
    <Spinner />
  {:else if !slugMatches}
    <h1>Not found</h1>
    <p>This version does not belong to course "{courseSlug}".</p>
    <Button onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Back</Button>
  {:else if !v || !perms}
    <Spinner />
  {:else}
    {#if loadError}
      <p class="banner err">{loadError}</p>
    {/if}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
      <h1>{tree.course.name} · v{v.id} <span class="state state-{v.state}">{v.state}</span>{#if v.is_disabled}<span class="state disabled">disabled</span>{/if}</h1>
    </header>

    {#if v.is_disabled}
      <p class="banner">This version is disabled — editing is not allowed. Enable it first.</p>
    {/if}

    <VersionMetaForm {vid} version={v} parentBusy={busy || createBusy} />

    <section class="blocks">
      <div class="head">
        <h2>Blocks</h2>
        {#if perms.canEditStructure}
          <Button
            disabled={dirtyRegistry.isAnyDirty() || busy || createBusy}
            title={dirtyRegistry.isAnyDirty() ? 'Save or discard changes first' : ''}
            onclick={toggleCreate}
          >{creating ? 'Cancel' : '+ New block'}</Button>
        {/if}
      </div>

      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreateBlock(); }}>
          <div class="field">
            <input placeholder="Title" bind:value={newTitle} required disabled={createBusy || busy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
            {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          </div>
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
          <Button type="submit" disabled={createBusy || busy || !perms?.canEditStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
        </form>
      {/if}

      {#if tree.blocks.length === 0}
        <p class="empty">
          {perms.canEditStructure ? 'This version has no blocks yet.' : 'This version has no blocks.'}
        </p>
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
    </section>

    <section class="state-actions">
      {#if perms.canPublish}
        <Button disabled={busy} onclick={() => transition('publish')}>Publish</Button>
      {/if}
      {#if perms.canArchive}
        <Button disabled={busy} onclick={() => transition('archive')}>Archive</Button>
      {/if}
      {#if perms.canRevert}
        <Button disabled={busy} onclick={() => transition('revert')}>Revert</Button>
      {/if}
      {#if perms.canDisable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('disable')}>Disable</Button>
      {/if}
      {#if perms.canEnable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('enable')}>Enable</Button>
      {/if}
      {#if perms.canDeleteVersion}
        <Button variant="ghost" disabled={busy} onclick={deleteVersion}>Delete</Button>
      {/if}
    </section>

    <DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} />
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .state { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; margin-left: var(--space-2); }
  .state-created { background: #ffeac0; color: #663; }
  .state-published { background: #ddf3dd; color: #265; }
  .state-archived { background: #eee; color: #555; }
  .state.disabled { background: #fdd; color: #833; }
  .banner { background: #fff3cd; border-left: 3px solid #d99; padding: var(--space-2); }
  .banner.err { background: #fdd; border-left-color: #a33; color: #833; }
  .state-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .blocks { margin: var(--space-4) 0; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
  .create { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input { width: 100%; }
  .create .field { display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
  .blocks-list { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--muted); }
</style>
