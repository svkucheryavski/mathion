<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';

  let { courseSlug, versionId, blockId }: { courseSlug: string; versionId: string; blockId: string } = $props();
  const vid = $derived(Number(versionId));
  const bid = $derived(Number(blockId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  const bidValid = $derived(Number.isInteger(bid) && bid > 0);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const block = $derived(tree?.blocks.find((b) => b.id === bid));
  const valid = $derived(!!tree && tree.course.slug === courseSlug && !!block && block.version_id === vid);
  const perms = $derived(v ? versionPermissions(v) : null);

  type Form = { title: string; info: string };
  let tracker = $state<ReturnType<typeof makeDirtyTracker<Form>> | null>(null);
  let trackerBid = $state<number | null>(null);
  // C-I3: companion to trackerBid. Today this page unmounts on a vid switch
  // (App.svelte tears down + onDestroy clears the AdminTree), so a same-bid
  // collision across versions can't happen. But if the editor ever becomes
  // a single SPA shell with persistent components, two versions sharing a
  // block id would silently leak stale form values. Defensive future-proof.
  let trackerVid = $state<number | null>(null);
  let busy = $state(false);

  let creating = $state(false);
  let newTitle = $state('');
  let newSlug = $state('');

  async function ensureLoaded() {
    if (!vidValid || !bidValid) return;
    if (!tree || tree.version.id !== vid) await loadAdminTree(vid);
    // Guard against a silent loadAdminTree failure: the store keeps the
    // previous `value` on error and only sets `.error`, so a same-id block
    // from the prior version could match `find()` and seed the tracker
    // with stale data. Require the store value to be for the active vid.
    const cur = currentEditorVersion.value;
    if (!cur || cur.version.id !== vid) return;
    const fresh = cur.blocks.find((b) => b.id === bid);
    // We only rebuild the tracker when bid changes. Concurrent-admin edits
    // that mutate this block's title/info while the tracker is clean are
    // not auto-resynced — the user must navigate away and back, or save
    // and accept whatever the server returned.
    if (fresh && (trackerBid !== bid || trackerVid !== vid)) {
      tracker = makeDirtyTracker<Form>({ title: fresh.title, info: fresh.info });
      trackerBid = bid;
      trackerVid = vid;
    }
  }

  async function save() {
    if (!tracker) return;
    // Pin everything at PATCH-start so v3→v4 / b12→b13 navigation mid-await
    // can't redirect the request or corrupt the post-await reset.
    const savedVid = vid;
    const savedBid = bid;
    const savedTracker = tracker;
    const sentTitle = savedTracker.current.title;
    const sentInfo = savedTracker.current.info;
    busy = true;
    try {
      await api.patch(`/api/blocks/${savedBid}`, { title: sentTitle, info: sentInfo });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        // Refetch invalidated by newer navigation/clear (e.g. user navigated
        // away mid-await — onDestroy runs clearEditorVersion). Save succeeded;
        // skip the misleading "refresh failed" toast.
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value?.blocks.find((x) => x.id === savedBid);
        if (fresh) savedTracker.reset({ title: fresh.title, info: fresh.info });
        pushToast('Saved', 'success');
      } else {
        // result === 'error': refetch GET failed. Baseline against sent
        // values so the form isn't stuck dirty against pre-save values.
        savedTracker.reset({ title: sentTitle, info: sentInfo });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }
  function discard() {
    // Intentionally reads LIVE `block` (not a captured baseline like save()
    // does). Discard means "throw away my edits and show whatever the server
    // currently has" — if a refetch landed between Edit-start and Discard,
    // we want the freshest values, not the ones the user started from.
    if (tracker && block) tracker.reset({ title: block.title, info: block.info });
  }

  async function createSequence() {
    // Pin route IDs at POST-start. A navigation race mid-await would
    // otherwise let `bid`/`vid` reactively rebind and the post-POST refetch
    // land on the wrong block/version.
    const savedVid = vid;
    const savedBid = bid;
    busy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences`, { title: newTitle, slug: newSlug });
      newTitle = ''; newSlug = ''; creating = false;
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Could not create sequence', 'error');
    } finally {
      busy = false;
    }
  }

  async function reorder(idx: number, dir: -1 | 1) {
    if (!block) return;
    const seqs = [...block.sequences];
    const target = idx + dir;
    if (target < 0 || target >= seqs.length) return;
    [seqs[idx], seqs[target]] = [seqs[target], seqs[idx]];
    const order = seqs.map((s, i) => ({ id: s.id, order: i + 1 }));
    // Pin vid + bid at POST-start so a navigation race mid-await doesn't
    // reorder/refetch the wrong block.
    const savedVid = vid;
    const savedBid = bid;
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

  async function deleteBlock() {
    if (tracker?.isDirty || !block || !perms?.canEditStructure || block.sequences.length > 0) return;
    if (!confirm(`Delete block "${block.title}"? This cannot be undone.`)) return;
    // Pin route IDs + slug at DELETE-start so a navigation race mid-await
    // doesn't delete the wrong block or send the user to the wrong /v/n page.
    const savedVid = vid;
    const savedBid = bid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/blocks/${savedBid}`);
      navigate(`/courses/${savedSlug}/edit/v/${savedVid}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }

  $effect(() => { void vid; void bid; void ensureLoaded(); });

  // Drop the cached AdminTree on unmount so the next editor page doesn't
  // briefly render stale data — store docstring requires this.
  onDestroy(() => clearEditorVersion());
</script>

<div class="page">
  {#if !vidValid || !bidValid}
    <h1>Bad URL</h1>
    <p>Version "{versionId}" / block "{blockId}" is not a valid id pair.</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
  {:else if loadError && (!tree || tree.version.id !== vid)}
    <h1>Couldn't load</h1>
    <p>{loadError}</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}`)}>← v{vid}</Button>
  {:else if !tree || tree.version.id !== vid}
    <Spinner />
  {:else if !valid || !block || !v}
    <h1>Not found</h1>
    <p>This block does not belong to this version.</p>
    <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}`)}>← Back</Button>
  {:else if tracker && perms}
    {#if loadError}
      <p class="banner err">{loadError}</p>
    {/if}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}`)}>← v{vid}</Button>
      <h1>Block: {block.title}</h1>
    </header>

    {#if perms.canEditTextFields}
      <section class="meta">
        <label>Title <input bind:value={tracker.current.title} required /></label>
        <label>Info (markdown) <textarea bind:value={tracker.current.info} rows="3"></textarea></label>
        <div class="row">
          <Button onclick={save} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
          <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
        </div>
      </section>
    {/if}

    <section class="seqs">
      <div class="head">
        <h2>Sequences</h2>
        {#if perms.canEditStructure}
          <Button
            disabled={tracker.isDirty || busy}
            title={tracker.isDirty ? 'Save or discard changes first' : ''}
            onclick={() => (creating = !creating)}
          >{creating ? 'Cancel' : '+ New sequence'}</Button>
        {/if}
      </div>
      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); createSequence(); }}>
          <input placeholder="Title" bind:value={newTitle} required />
          <!-- Mirrors backend SequenceCreate slug regex schemas.py:
               ^[a-z0-9]+(?:-[a-z0-9]+)*$ (HTML auto-anchors). The looser
               [a-z0-9-]+ would let --foo / foo-- pass the browser then 422. -->
          <input placeholder="Slug" bind:value={newSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          <Button type="submit" disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''}>Create</Button>
        </form>
      {/if}
      {#if block.sequences.length === 0}
        <p class="empty">No sequences yet.</p>
      {:else}
        <ul>
          {#each block.sequences as s, i (s.id)}
            <li class="row">
              <strong>S{i + 1}. {s.title}</strong>
              <div class="actions">
                {#if perms.canEditStructure}
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === 0} onclick={() => reorder(i, -1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move up'} aria-label="Move up">↑</Button>
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === block.sequences.length - 1} onclick={() => reorder(i, 1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move down'} aria-label="Move down">↓</Button>
                {/if}
                <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}/sequences/${s.id}`)} disabled={busy}>Open</Button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if perms.canEditStructure}
      <section class="danger">
        <Button
          variant="ghost"
          disabled={tracker.isDirty || busy || block.sequences.length > 0}
          title={tracker.isDirty ? 'Save or discard changes first' : block.sequences.length > 0 ? 'Remove sequences first' : ''}
          onclick={deleteBlock}
        >Delete this block</Button>
      </section>
    {/if}

    <DirtyGuard isDirty={() => tracker!.isDirty} />
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .banner.err { background: #fdd; border-left: 3px solid #a33; padding: var(--space-2); color: #833; }
  .meta, .seqs, .danger { margin: var(--space-4) 0; }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta input, .meta textarea { width: 100%; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .create { display: flex; gap: var(--space-2); margin: var(--space-2) 0; flex-wrap: wrap; }
  .create input { flex: 1; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .danger { padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .empty { color: var(--muted); }
</style>
