<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import ItemTypePicker from '../../components/editor/ItemTypePicker.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';

  let { courseSlug, versionId, blockId, sequenceId }: {
    courseSlug: string; versionId: string; blockId: string; sequenceId: string;
  } = $props();
  const vid = $derived(Number(versionId));
  const bid = $derived(Number(blockId));
  const sid = $derived(Number(sequenceId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  const bidValid = $derived(Number.isInteger(bid) && bid > 0);
  const sidValid = $derived(Number.isInteger(sid) && sid > 0);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const block = $derived(tree?.blocks.find((b) => b.id === bid));
  const seq = $derived(block?.sequences.find((s) => s.id === sid));
  const valid = $derived(!!tree && tree.course.slug === courseSlug && !!seq && !!block && block.version_id === vid && seq.block_id === bid);
  const perms = $derived(v ? versionPermissions(v) : null);

  type Form = { title: string };
  let tracker = $state<ReturnType<typeof makeDirtyTracker<Form>> | null>(null);
  let trackerSid = $state<number | null>(null);
  // C-I3: companion to trackerSid — see BlockEditPage for rationale.
  let trackerVid = $state<number | null>(null);
  let busy = $state(false);

  let creating = $state(false);
  let newType = $state<'static_page' | 'video'>('static_page');
  let newTitle = $state('');
  let newSlug = $state('');
  let newContentMd = $state('');
  let newVideoUrl = $state('');

  // Auto-seed content_md from title for static_page (only while user hasn't
  // typed in body yet). Gated on `creating` so the effect doesn't churn while
  // the form is collapsed, and gated on `newTitle` being non-empty so that
  // clearing the title doesn't silently wipe the textarea (required-invalid
  // and surprising). Once user types in the body, contentMdTouched sticks.
  let contentMdTouched = $state(false);
  $effect(() => {
    if (creating && newType === 'static_page' && !contentMdTouched && newTitle) {
      newContentMd = `# ${newTitle}\n`;
    }
  });

  function resetCreateForm() {
    newType = 'static_page';
    newTitle = '';
    newSlug = '';
    newContentMd = '';
    newVideoUrl = '';
    contentMdTouched = false;
  }
  function toggleCreating() {
    if (creating) resetCreateForm();
    creating = !creating;
  }

  async function ensureLoaded() {
    if (!vidValid || !bidValid || !sidValid) return;
    if (!tree || tree.version.id !== vid) await loadAdminTree(vid);
    // Guard against silent loadAdminTree failure: store keeps prior `value`
    // and only sets `.error`, so a same-id seq from the prior version could
    // match `find()` and seed the tracker with stale data. Require the
    // store value to be for the active vid.
    const cur = currentEditorVersion.value;
    if (!cur || cur.version.id !== vid) return;
    const fresh = cur.blocks.find((b) => b.id === bid)?.sequences.find((s) => s.id === sid);
    // Only rebuilds when sid changes. Concurrent-admin edits to the same
    // sequence won't auto-resync into a clean tracker — workaround: navigate
    // away and back, or save and accept whatever the server returned.
    if (fresh && (trackerSid !== sid || trackerVid !== vid)) {
      tracker = makeDirtyTracker<Form>({ title: fresh.title });
      trackerSid = sid;
      trackerVid = vid;
    }
  }

  async function save() {
    if (!tracker) return;
    // Pin everything at PATCH-start so a navigation race mid-await can't
    // redirect the request or write stale data into a freshly-rebuilt tracker.
    const savedVid = vid;
    const savedSid = sid;
    const savedBid = bid;
    const savedTracker = tracker;
    const sentTitle = savedTracker.current.title;
    busy = true;
    try {
      await api.patch(`/api/sequences/${savedSid}`, { title: sentTitle });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        // Refetch invalidated by newer navigation/clear (e.g. user navigated
        // away mid-await — onDestroy runs clearEditorVersion). Save succeeded;
        // skip the misleading "refresh failed" toast.
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value?.blocks.find((b) => b.id === savedBid)?.sequences.find((x) => x.id === savedSid);
        if (fresh) savedTracker.reset({ title: fresh.title });
        pushToast('Saved', 'success');
      } else {
        // result === 'error': refetch GET failed. Baseline against sent
        // values so the form isn't stuck dirty against pre-save values.
        savedTracker.reset({ title: sentTitle });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    // Reads LIVE `seq` (not a captured baseline like save() does). Discard
    // means "throw away my edits and show whatever the server currently has".
    if (tracker && seq) tracker.reset({ title: seq.title });
  }

  async function createItem() {
    // Pin route IDs + slug at POST-start. Without this, a navigation race
    // mid-await would let `loadAdminTree(vid, ...)` and the `navigate(...)`
    // below read live (and possibly different) values, sending the user to
    // the wrong destination after a race. Sister save() pins for the same
    // reason.
    const savedVid = vid;
    const savedBid = bid;
    const savedSid = sid;
    const savedSlug = courseSlug;
    const body: Record<string, unknown> = { title: newTitle, slug: newSlug, type: newType };
    if (newType === 'static_page') body.content_md = newContentMd;
    if (newType === 'video') body.video_url = newVideoUrl;
    busy = true;
    try {
      const item = await api.post<{ id: number }>(`/api/sequences/${savedSid}/items`, body);
      await loadAdminTree(savedVid, { force: true });
      // Defense-in-depth: navigate unmounts this page so form state is gone
      // anyway, but matching sister createSequence's reset keeps behavior
      // consistent if a future refactor stops navigating away.
      resetCreateForm();
      creating = false;
      navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}/items/${item.id}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Could not create item', 'error');
    } finally {
      busy = false;
    }
  }

  async function reorder(idx: number, dir: -1 | 1) {
    if (!seq) return;
    const items = [...seq.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    const order = items.map((it, i) => ({ id: it.id, order: i + 1 }));
    // Pin route IDs at POST-start so a navigation race mid-await doesn't
    // reorder/refetch the wrong sequence/version.
    const savedVid = vid;
    const savedSid = sid;
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

  async function deleteSequence() {
    if (tracker?.isDirty || !seq || !perms?.canEditStructure || seq.items.length > 0) return;
    if (!confirm(`Delete sequence "${seq.title}"? This cannot be undone.`)) return;
    // Pin route IDs + slug at DELETE-start so a navigation race mid-await
    // doesn't delete the wrong sequence or send the user to the wrong page.
    const savedVid = vid;
    const savedBid = bid;
    const savedSid = sid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/sequences/${savedSid}`);
      navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }

  $effect(() => { void vid; void bid; void sid; void ensureLoaded(); });

  // Drop the cached AdminTree on unmount so the next editor page doesn't
  // briefly render stale data — store docstring requires this.
  onDestroy(() => clearEditorVersion());
</script>

<div class="page">
  {#if !vidValid || !bidValid || !sidValid}
    <h1>Bad URL</h1>
    <p>One of the IDs ("{versionId}" / "{blockId}" / "{sequenceId}") is not a valid id.</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
  {:else if loadError && (!tree || tree.version.id !== vid)}
    <h1>Couldn't load</h1>
    <p>{loadError}</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}`)}>← Back</Button>
  {:else if !tree || tree.version.id !== vid}
    <Spinner />
  {:else if !valid || !seq || !block || !v}
    <h1>Not found</h1>
    <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}`)}>← Back</Button>
  {:else if tracker && perms}
    {#if loadError}
      <p class="banner err">{loadError}</p>
    {/if}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}`)}>← {block.title}</Button>
      <h1>Sequence: {seq.title}</h1>
    </header>

    {#if perms.canEditTextFields}
      <section class="meta">
        <label>Title <input bind:value={tracker.current.title} required /></label>
        <div class="row">
          <Button onclick={save} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
          <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
        </div>
      </section>
    {/if}

    <section class="items">
      <div class="head">
        <h2>Items</h2>
        {#if perms.canEditStructure}
          <Button
            disabled={tracker.isDirty || busy}
            title={tracker.isDirty ? 'Save or discard changes first' : ''}
            onclick={toggleCreating}
          >{creating ? 'Cancel' : '+ New item'}</Button>
        {/if}
      </div>
      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); createItem(); }}>
          <ItemTypePicker bind:value={newType} />
          <input placeholder="Title" bind:value={newTitle} required />
          <!-- Mirrors backend ItemCreate slug regex schemas.py:
               ^[a-z0-9]+(?:-[a-z0-9]+)*$ (HTML auto-anchors). -->
          <input placeholder="Slug" bind:value={newSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          {#if newType === 'static_page'}
            <textarea placeholder="Content (markdown)" rows="4" bind:value={newContentMd} oninput={() => (contentMdTouched = true)} required></textarea>
          {:else if newType === 'video'}
            <input type="url" placeholder="Video URL (https://…)" bind:value={newVideoUrl} required />
          {/if}
          <Button type="submit" disabled={tracker.isDirty || busy} loading={busy} title={tracker.isDirty ? 'Save or discard changes first' : ''}>Create</Button>
        </form>
      {/if}
      {#if seq.items.length === 0}
        <p class="empty">No items yet.</p>
      {:else}
        <ul>
          {#each seq.items as it, i (it.id)}
            <li class="row">
              <div class="title">
                <span class="glyph" aria-hidden="true">
                  {it.type === 'static_page' ? '📄'
                    : it.type === 'video' ? '▶'
                    : it.type === 'quiz' ? '?'
                    : '⌘'}
                </span>
                <strong>{it.title}</strong>
              </div>
              <div class="actions">
                {#if perms.canEditStructure}
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === 0} onclick={() => reorder(i, -1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move up'} aria-label="Move up">↑</Button>
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === seq.items.length - 1} onclick={() => reorder(i, 1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move down'} aria-label="Move down">↓</Button>
                {/if}
                <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}/sequences/${sid}/items/${it.id}`)} disabled={busy}>Open</Button>
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
          disabled={tracker.isDirty || busy || seq.items.length > 0}
          title={tracker.isDirty ? 'Save or discard changes first' : seq.items.length > 0 ? 'Remove items first' : ''}
          onclick={deleteSequence}
        >Delete this sequence</Button>
      </section>
    {/if}

    <DirtyGuard isDirty={() => tracker!.isDirty} />
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .banner.err { background: #fdd; border-left: 3px solid #a33; padding: var(--space-2); color: #833; }
  .meta, .items, .danger { margin: var(--space-4) 0; }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta input { width: 100%; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .create { display: grid; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input, .create textarea { width: 100%; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .title { display: flex; align-items: center; gap: var(--space-2); }
  .glyph { width: 24px; text-align: center; opacity: 0.65; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .danger { padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .empty { color: var(--muted); }
</style>
