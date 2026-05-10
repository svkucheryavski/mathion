<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import MarkdownEditor from '../../components/editor/MarkdownEditor.svelte';
  import VideoFrame from '../../components/items/VideoFrame.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { safeIframeUrl } from '../../lib/safeIframeUrl';

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
  // C-I3: companion to trackerIid — see BlockEditPage for rationale.
  let trackerVid = $state<number | null>(null);
  let busy = $state(false);
  // Suppress the inline "couldn't load" banner after a successful save whose
  // post-save refetch failed. The toast already covered it; the form is
  // showing the values we PATCHed (server accepted), so the banner reads as
  // a contradiction. Cleared on the next ensureLoaded that succeeds.
  let postSaveRefetchFailed = $state(false);

  // Block save when a video item has empty video_url. Server requires a non-empty
  // value (item invariant), so without this gate a programmatic clear (or the
  // user clearing the field then hitting Cmd+S) would PATCH '' and 422 / corrupt
  // state. <input type="url" required> only catches the form-submit path.
  const videoUrlEmpty = $derived(
    item?.type === 'video' && tracker
      ? (tracker.current as VideoForm).video_url.trim() === ''
      : false,
  );

  // Debounced live preview for the video editor. Re-rendering the iframe on
  // every keystroke would spam network requests and visibly thrash the player;
  // 500ms after the last edit is the sweet spot. Validation via safeIframeUrl
  // keeps javascript:/data: out of the iframe src and silently hides the
  // preview for partial / malformed input rather than showing a broken page.
  let videoPreviewUrl = $state<string | null>(null);
  $effect(() => {
    if (item?.type !== 'video' || !tracker) {
      videoPreviewUrl = null;
      return;
    }
    const raw = (tracker.current as VideoForm).video_url;
    const handle = setTimeout(() => {
      videoPreviewUrl = safeIframeUrl(raw);
    }, 500);
    return () => clearTimeout(handle);
  });

  // Readonly preview (disabled / archived versions): server value is fixed, so
  // no debounce — derive directly from item.video_url.
  const readonlyVideoPreviewUrl = $derived(
    item?.type === 'video' ? safeIframeUrl(item.video_url) : null,
  );

  async function ensureLoaded() {
    if (!vidValid || !bidValid || !sidValid || !iidValid) return;
    if (!tree || tree.version.id !== vid) await loadAdminTree(vid);
    // A successful refetch clears the post-save banner-suppression flag.
    if (!currentEditorVersion.error) postSaveRefetchFailed = false;
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
    if (fresh && (trackerIid !== iid || trackerVid !== vid)) {
      // Reset for every iid change — null out for non-editable types so the
      // DirtyGuard, Save/Discard, and Delete dirty-gate aren't fed by a stale
      // tracker from a previously-viewed editable item.
      if (fresh.type === 'static_page') tracker = makeDirtyTracker<StaticForm>({ title: fresh.title, content_md: fresh.content_md ?? '' });
      else if (fresh.type === 'video') tracker = makeDirtyTracker<VideoForm>({ title: fresh.title, video_url: fresh.video_url ?? '' });
      else tracker = null;  // quiz / interactive_app — read-only, no tracker
      trackerIid = iid;
      trackerVid = vid;
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
      // Defensive client-side guard: backend item invariant requires non-empty
      // video_url. The Save button is also disabled in this state, but a
      // programmatic invocation could bypass that. Toast and bail.
      if (sentVideoUrl.trim() === '') {
        pushToast('Video URL is required', 'error');
        return;
      }
      body.video_url = sentVideoUrl;
    }
    busy = true;
    try {
      await api.patch(`/api/items/${savedIid}`, body);
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        // Refetch invalidated by newer navigation/clear (e.g. user navigated
        // away mid-await — onDestroy runs clearEditorVersion). Save succeeded;
        // skip the misleading "refresh failed" toast and don't toggle the
        // banner-suppression flag (the page is unmounting anyway).
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value
          ?.blocks.find((b) => b.id === savedBid)
          ?.sequences.find((s) => s.id === savedSid)
          ?.items.find((x) => x.id === savedIid);
        if (fresh && fresh.type === savedItemType) {
          if (savedItemType === 'static_page') {
            (savedTracker as ReturnType<typeof makeDirtyTracker<StaticForm>>).reset({ title: fresh.title, content_md: fresh.content_md ?? '' });
          } else if (savedItemType === 'video') {
            (savedTracker as ReturnType<typeof makeDirtyTracker<VideoForm>>).reset({ title: fresh.title, video_url: fresh.video_url ?? '' });
          }
        }
        postSaveRefetchFailed = false;
        pushToast('Saved', 'success');
      } else {
        // result === 'error': refetch GET failed. Baseline against sent
        // values (server accepted them) so the form isn't stuck dirty.
        if (savedItemType === 'static_page') {
          (savedTracker as ReturnType<typeof makeDirtyTracker<StaticForm>>).reset({ title: sentTitle, content_md: sentContentMd ?? '' });
        } else if (savedItemType === 'video') {
          (savedTracker as ReturnType<typeof makeDirtyTracker<VideoForm>>).reset({ title: sentTitle, video_url: sentVideoUrl ?? '' });
        }
        // Banner would say "couldn't load" while the form shows the values we
        // just sent — misleading. Suppress until next successful refetch.
        postSaveRefetchFailed = true;
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
      // Refetch on failure: a 403 from a state transition (e.g. version got
      // published mid-confirm) means our cached `perms` is stale and the
      // Delete button would otherwise stay enabled against the new state.
      await loadAdminTree(savedVid, { force: true });
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
    {#if loadError && !postSaveRefetchFailed}
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
          <small class="hint">
            Use a YouTube or Vimeo <strong>embed</strong> URL (e.g.
            <code>https://www.youtube.com/embed/VIDEO_ID</code>) — regular
            watch URLs won't load in an iframe.
          </small>
          {#if videoPreviewUrl}
            <VideoFrame src={videoPreviewUrl} title={t.current.title || 'Video preview'} />
          {/if}
        {/if}
        <div class="row">
          <Button
            onclick={save}
            disabled={!tracker.isDirty || busy || videoUrlEmpty}
            loading={busy}
            title={videoUrlEmpty ? 'Video URL is required' : ''}
          >Save</Button>
          <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
        </div>
      </section>
    {:else if editable}
      <!-- Editable item type but text-edit perms are off (disabled / archived
           version). Spec §11 item 7: "Disabled-state version → Preview returns
           403 → inline error." Render a read-only preview so the user can see
           the content and the /render 403 surfaces inline. Without this the
           editor short-circuited to nothing on disabled versions, leaving the
           checklist item unrealizable through the UI. -->
      <section class="readonly">
        {#if item.type === 'static_page'}
          <h3>{item.title}</h3>
          <MarkdownEditor versionId={vid} value={item.content_md ?? ''} readOnly />
        {:else if item.type === 'video'}
          <h3>{item.title}</h3>
          {#if readonlyVideoPreviewUrl}
            <VideoFrame src={readonlyVideoPreviewUrl} title={item.title} />
            <p><a href={readonlyVideoPreviewUrl} target="_blank" rel="noopener noreferrer">{readonlyVideoPreviewUrl}</a></p>
          {:else if item.video_url}
            <!-- URL stored on the server but rejected by safeIframeUrl (legacy
                 data, non-http(s) scheme). Show the link only — never iframe. -->
            <p><a href={item.video_url} target="_blank" rel="noopener noreferrer">{item.video_url}</a></p>
          {:else}
            <p><em>No video URL</em></p>
          {/if}
        {/if}
      </section>
    {:else}
      <section class="readonly">
        <p><em>Not editable in this slice.</em></p>
        {#if item.type === 'quiz'}
          <p>{item.questions_count} question{item.questions_count === 1 ? '' : 's'}. Quiz authoring UI lands in slice 2; questions are managed via the API for now.</p>
        {:else if item.type === 'interactive_app'}
          <p>Interactive-app editing lands in slice 2.</p>
        {/if}
        <!-- Intentionally no {:else} fallback: when a future item type is
             added to the union (e.g. mini_project), this section silently
             falls through to just the "Not editable" headline rather than
             mislabeling the new type as Interactive-app. -->
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

    <!-- Closure must re-read live `tracker` on every invocation. {@const t = tracker}
         + isDirty={() => t.isDirty} would snapshot the original tracker reference at
         template-render time; DirtyGuard.onMount runs ONCE and would close over the
         stale t even after ensureLoaded reassigns tracker on iid change. Same class
         as the Task-13 closure-snapshot bug. -->
    <DirtyGuard isDirty={() => tracker?.isDirty ?? false} />
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
  .hint { display: block; margin: 0 0 var(--space-2) 0; color: var(--muted, #666); font-size: 0.85rem; }
  .hint code { background: rgba(0, 0, 0, 0.06); padding: 0 0.25rem; border-radius: 3px; font-size: 0.85em; }
</style>
