<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import MarkdownEditor from '../../components/editor/MarkdownEditor.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';

  let { courseSlug, versionId, blockId, sequenceId, itemId }: {
    courseSlug: string; versionId: string; blockId: string; sequenceId: string; itemId: string;
  } = $props();
  const vid = $derived(Number(versionId));
  const bid = $derived(Number(blockId));
  const sid = $derived(Number(sequenceId));
  const iid = $derived(Number(itemId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  const bidValid = $derived(Number.isInteger(bid) && bid > 0);
  const sidValid = $derived(Number.isInteger(sid) && sid > 0);
  const iidValid = $derived(Number.isInteger(iid) && iid > 0);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const block = $derived(tree?.blocks.find((b) => b.id === bid));
  const seq = $derived(block?.sequences.find((s) => s.id === sid));
  const item = $derived(seq?.items.find((it) => it.id === iid));
  const valid = $derived(!!tree && tree.course.slug === courseSlug && !!item && !!seq && !!block && block.version_id === vid && seq.block_id === bid && item.sequence_id === sid);
  const perms = $derived(v ? versionPermissions(v) : null);
  const editable = $derived(item?.type === 'static_page' || item?.type === 'video');

  // Tracker form-shape: coerce nullable backend fields to '' so MarkdownEditor.value
  // (typed `string`) and the URL <input> (no null) can bind directly. On save we send
  // the string verbatim — empty string represents "no content"; backend accepts it.
  type StaticForm = { title: string; content_md: string };
  type VideoForm = { title: string; video_url: string };
  let tracker = $state<ReturnType<typeof makeDirtyTracker<StaticForm>>
                     | ReturnType<typeof makeDirtyTracker<VideoForm>> | null>(null);
  let trackerIid = $state<number | null>(null);
  let busy = $state(false);

  async function ensureLoaded() {
    if (!vidValid || !bidValid || !sidValid || !iidValid) return;
    if (!tree || tree.version.id !== vid) await loadAdminTree(vid);
    // Guard against silent loadAdminTree failure: store leaves `value`
    // untouched on refetch error and only sets `.error`, so a same-id item from the prior version could
    // match `find()` and seed the tracker with stale data.
    const cur = currentEditorVersion.value;
    if (!cur || cur.version.id !== vid) return;
    const fresh = cur.blocks.find((b) => b.id === bid)
      ?.sequences.find((s) => s.id === sid)
      ?.items.find((it) => it.id === iid);
    // Rebuild only on iid change. Concurrent-admin edits to the same item
    // won't auto-resync — workaround: navigate away and back.
    if (fresh && trackerIid !== iid) {
      // Reset for every iid change — null out for non-editable types so the
      // DirtyGuard, Save/Discard, and Delete dirty-gate aren't fed by a stale
      // tracker from a previously-viewed editable item.
      if (fresh.type === 'static_page') tracker = makeDirtyTracker<StaticForm>({ title: fresh.title, content_md: fresh.content_md ?? '' });
      else if (fresh.type === 'video') tracker = makeDirtyTracker<VideoForm>({ title: fresh.title, video_url: fresh.video_url ?? '' });
      else tracker = null;  // quiz / interactive_app — read-only, no tracker
      trackerIid = iid;
    }
  }

  async function save() {
    if (!tracker || !item) return;
    // Pin everything at PATCH-start so a navigation race mid-await can't
    // redirect the request or write stale data into a freshly-rebuilt tracker.
    const savedVid = vid;
    const savedBid = bid;
    const savedSid = sid;
    const savedIid = iid;
    const savedTracker = tracker;
    const savedItemType = item.type;
    const sentTitle = savedTracker.current.title;
    let sentContentMd: string | undefined;
    let sentVideoUrl: string | undefined;
    const body: Record<string, unknown> = { title: sentTitle };
    if (savedItemType === 'static_page') {
      sentContentMd = (savedTracker.current as StaticForm).content_md;
      body.content_md = sentContentMd;
    } else if (savedItemType === 'video') {
      sentVideoUrl = (savedTracker.current as VideoForm).video_url;
      body.video_url = sentVideoUrl;
    }
    busy = true;
    try {
      await api.patch(`/api/items/${savedIid}`, body);
      await loadAdminTree(savedVid, { force: true });
      // Read currentEditorVersion.error directly — store leaves `value`
      // untouched on refetch error and only sets `.error`. On refetch
      // failure, baseline against the values we PATCHed (server accepted
      // them) so the form isn't stuck dirty against pre-save values.
      const fresh = currentEditorVersion.value
        ?.blocks.find((b) => b.id === savedBid)
        ?.sequences.find((s) => s.id === savedSid)
        ?.items.find((x) => x.id === savedIid);
      const refetchOk = !currentEditorVersion.error && !!fresh && fresh.type === savedItemType;
      if (refetchOk) {
        if (savedItemType === 'static_page') {
          (savedTracker as ReturnType<typeof makeDirtyTracker<StaticForm>>).reset({ title: fresh.title, content_md: fresh.content_md ?? '' });
        } else if (savedItemType === 'video') {
          (savedTracker as ReturnType<typeof makeDirtyTracker<VideoForm>>).reset({ title: fresh.title, video_url: fresh.video_url ?? '' });
        }
        pushToast('Saved', 'success');
      } else {
        if (savedItemType === 'static_page') {
          (savedTracker as ReturnType<typeof makeDirtyTracker<StaticForm>>).reset({ title: sentTitle, content_md: sentContentMd ?? '' });
        } else if (savedItemType === 'video') {
          (savedTracker as ReturnType<typeof makeDirtyTracker<VideoForm>>).reset({ title: sentTitle, video_url: sentVideoUrl ?? '' });
        }
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    // Reads LIVE `item` (not a captured baseline like save() does). Discard
    // means "throw away my edits and show whatever the server currently has".
    if (!tracker || !item) return;
    if (item.type === 'static_page') (tracker as ReturnType<typeof makeDirtyTracker<StaticForm>>).reset({ title: item.title, content_md: item.content_md ?? '' });
    else if (item.type === 'video') (tracker as ReturnType<typeof makeDirtyTracker<VideoForm>>).reset({ title: item.title, video_url: item.video_url ?? '' });
  }

  async function deleteItem() {
    if (tracker?.isDirty || !item || !perms?.canEditStructure) return;
    if (!confirm(`Delete item "${item.title}"? This cannot be undone.`)) return;
    // Pin the route IDs at DELETE-start so a navigation race mid-await
    // doesn't corrupt the navigate target.
    const savedVid = vid;
    const savedBid = bid;
    const savedSid = sid;
    const savedIid = iid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/items/${savedIid}`);
      navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }

  $effect(() => { void vid; void bid; void sid; void iid; void ensureLoaded(); });

  // Drop the cached AdminTree on unmount so the next editor page doesn't
  // briefly render stale data — store docstring requires this.
  onDestroy(() => clearEditorVersion());
</script>

<div class="page">
  {#if !vidValid || !bidValid || !sidValid || !iidValid}
    <h1>Bad URL</h1>
    <p>One of the IDs is not a valid id.</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
  {:else if loadError && (!tree || tree.version.id !== vid)}
    <h1>Couldn't load</h1>
    <p>{loadError}</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}/sequences/${sid}`)}>← Back</Button>
  {:else if !tree || tree.version.id !== vid}
    <Spinner />
  {:else if !valid || !item || !v}
    <h1>Not found</h1>
    <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}/sequences/${sid}`)}>← Back</Button>
  {:else if perms}
    {#if loadError}
      <p class="banner err">{loadError}</p>
    {/if}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${bid}/sequences/${sid}`)}>← {seq!.title}</Button>
      <h1>Item: {item.title} <span class="type">{item.type}</span></h1>
    </header>

    {#if editable && tracker && perms.canEditTextFields}
      <section class="meta">
        <label>Title <input bind:value={tracker.current.title} required /></label>
        {#if item.type === 'static_page'}
          {@const t = tracker as ReturnType<typeof makeDirtyTracker<StaticForm>>}
          <label>Content (markdown)
            <MarkdownEditor versionId={vid} bind:value={t.current.content_md} />
          </label>
        {:else if item.type === 'video'}
          {@const t = tracker as ReturnType<typeof makeDirtyTracker<VideoForm>>}
          <label>Video URL
            <input type="url" bind:value={t.current.video_url} required placeholder="https://…" />
          </label>
        {/if}
        <div class="row">
          <Button onclick={save} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
          <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
        </div>
      </section>
    {:else if !editable}
      <section class="readonly">
        <p><em>Not editable in this slice.</em></p>
        {#if item.type === 'quiz'}
          <p>{item.questions_count} question{item.questions_count === 1 ? '' : 's'}. Quiz authoring UI lands in slice 2; questions are managed via the API for now.</p>
        {:else}
          <p>Interactive-app editing lands in slice 2.</p>
        {/if}
      </section>
    {/if}

    {#if perms.canEditStructure}
      <section class="danger">
        <Button
          variant="ghost"
          disabled={(tracker?.isDirty ?? false) || busy}
          title={tracker?.isDirty ? 'Save or discard changes first' : ''}
          onclick={deleteItem}
        >Delete this item</Button>
      </section>
    {/if}

    {#if tracker}
      {@const t = tracker}
      <DirtyGuard isDirty={() => t.isDirty} />
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .type { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: #eef; color: #335; margin-left: var(--space-2); }
  .banner.err { background: #fdd; border-left: 3px solid #a33; padding: var(--space-2); color: #833; }
  .meta, .readonly, .danger { margin: var(--space-4) 0; }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta input { width: 100%; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .danger { padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .readonly { padding: var(--space-3); background: #f7f7f7; border-radius: var(--radius); }
</style>
