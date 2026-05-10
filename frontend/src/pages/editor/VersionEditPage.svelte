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

  let { courseSlug, versionId }: { courseSlug: string; versionId: string } = $props();
  const vid = $derived(Number(versionId));
  // Hand-crafted /v/foo URL → Number('foo') is NaN → /api/versions/NaN/admin-tree
  // would 422. Treat NaN as a route-shape error and refuse to fetch.
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const slugMatches = $derived(!!tree && tree.course.slug === courseSlug);
  const perms = $derived(v ? versionPermissions(v) : null);

  // Form tracker initialized after first load. Rebuilt whenever the active vid
  // changes so switching versions doesn't keep stale form values.
  type Meta = { info_md: string; max_quiz_attempts: number };
  let tracker = $state<ReturnType<typeof makeDirtyTracker<Meta>> | null>(null);
  let trackerVid = $state<number | null>(null);

  // In-flight flag — disables Save/Discard/Create-block/reorder/state-actions
  // while a PATCH/POST/DELETE is awaiting completion (Task-18 lesson).
  let busy = $state(false);

  // New-block form
  let creating = $state(false);
  let newTitle = $state('');
  let newSlug = $state('');

  async function ensureLoaded() {
    if (!vidValid) return;
    if (!tree || tree.version.id !== vid) await loadAdminTree(vid);
    if (currentEditorVersion.value && currentEditorVersion.value.version.id === vid && trackerVid !== vid) {
      const cur = currentEditorVersion.value.version;
      tracker = makeDirtyTracker<Meta>({ info_md: cur.info_md, max_quiz_attempts: cur.max_quiz_attempts });
      trackerVid = vid;
    }
  }

  async function saveMeta() {
    if (!tracker) return;
    // Same validation rules we hardened in Task 18 (commits 504e602/470ccf0):
    // bind:value on <input type=number> can yield null/NaN/decimal, all of
    // which 422 with an opaque backend message. Validate client-side first.
    const n = tracker.current.max_quiz_attempts as number | null;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) {
      pushToast('Max quiz attempts must be a whole number between 1 and 10', 'error');
      return;
    }
    busy = true;
    try {
      await api.patch(`/api/versions/${vid}`, {
        info_md: tracker.current.info_md,
        max_quiz_attempts: n,
      });
      await loadAdminTree(vid, { force: true });
      // Refetch may have failed silently (store keeps prior `value` and sets
      // `error`). Only snapshot if the store actually holds the version we
      // just saved — otherwise the tracker would baseline against stale data.
      const fresh = currentEditorVersion.value;
      if (fresh && fresh.version.id === vid) {
        tracker.reset({ info_md: fresh.version.info_md, max_quiz_attempts: fresh.version.max_quiz_attempts });
      }
      pushToast('Saved', 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }
  function discard() {
    if (!tracker || !v) return;
    tracker.reset({ info_md: v.info_md, max_quiz_attempts: v.max_quiz_attempts });
  }

  async function createBlock() {
    busy = true;
    try {
      await api.post(`/api/versions/${vid}/blocks`, { title: newTitle, slug: newSlug, info: '' });
      newTitle = ''; newSlug = ''; creating = false;
      await loadAdminTree(vid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Could not create block', 'error');
    } finally {
      busy = false;
    }
  }

  async function reorder(idx: number, dir: -1 | 1) {
    if (!tree) return;
    const blocks = [...tree.blocks];
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    [blocks[idx], blocks[target]] = [blocks[target], blocks[idx]];
    const order = blocks.map((b, i) => ({ id: b.id, order: i + 1 }));
    busy = true;
    try {
      await api.post(`/api/versions/${vid}/blocks/reorder`, { order });
      await loadAdminTree(vid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      await loadAdminTree(vid, { force: true });
    } finally {
      busy = false;
    }
  }

  async function transition(action: 'publish' | 'archive' | 'revert' | 'disable' | 'enable') {
    if (tracker?.isDirty) return;
    const prompts: Record<string, string> = {
      publish: `Publish version ${vid}? Students will see it.`,
      archive: `Archive version ${vid}?`,
      revert: `Revert version ${vid} to created?`,
      disable: `Disable version ${vid}?`,
      enable: `Enable version ${vid}?`,
    };
    if (!confirm(prompts[action])) return;
    busy = true;
    try {
      await api.post(`/api/versions/${vid}/${action}`);
      await loadAdminTree(vid, { force: true });
      // Past-tense map — the naive `${action}d` produces "publishd"/"revertd".
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
    if (tracker?.isDirty) return;
    if (!confirm(`Delete version ${vid}? This cannot be undone.`)) return;
    busy = true;
    try {
      await api.delete(`/api/versions/${vid}`);
      navigate(`/courses/${courseSlug}/edit`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }

  // $effect runs on mount and re-runs when `vid` changes. Same prop-change
  // refetch pattern as VersionsPage / CourseView.
  $effect(() => { void vid; void ensureLoaded(); });

  // Drop the cached AdminTree on unmount so the next editor entry doesn't
  // briefly render the previous course's tree before its own fetch resolves
  // — store docstring (currentEditorVersion.svelte.ts:5) requires this.
  onDestroy(() => clearEditorVersion());
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
  {:else if !v || !tracker}
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

    {#if perms?.canEditVersionMeta}
      <section class="meta">
        <h2>Version info</h2>
        <label>Info (markdown)
          <textarea bind:value={tracker.current.info_md} rows="4"></textarea>
        </label>
        <label>Max quiz attempts
          <input type="number" min="1" max="10" step="1" required bind:value={tracker.current.max_quiz_attempts} />
        </label>
        <div class="row">
          <Button onclick={saveMeta} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
          <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
        </div>
      </section>
    {/if}

    <section class="blocks">
      <div class="head">
        <h2>Blocks</h2>
        {#if perms?.canEditStructure}
          <Button
            disabled={tracker.isDirty || busy}
            title={tracker.isDirty ? 'Save or discard changes first' : ''}
            onclick={() => (creating = !creating)}
          >{creating ? 'Cancel' : '+ New block'}</Button>
        {/if}
      </div>
      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); createBlock(); }}>
          <input placeholder="Title" bind:value={newTitle} required />
          <!-- Mirrors backend regex schemas.py: ^[a-z0-9]+(?:-[a-z0-9]+)*$
               (HTML auto-anchors patterns). The looser [a-z0-9-]+ would let
               --foo / foo-- pass the browser then 422 at the server. -->
          <input placeholder="Slug" bind:value={newSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          <Button type="submit" disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''}>Create</Button>
        </form>
      {/if}
      {#if tree.blocks.length === 0}
        <p class="empty">No blocks yet.</p>
      {:else}
        <ul>
          {#each tree.blocks as b, i (b.id)}
            <li class="row">
              <strong>B{i + 1}. {b.title}</strong>
              <div class="actions">
                {#if perms?.canEditStructure}
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === 0} onclick={() => reorder(i, -1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move up'}>↑</Button>
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === tree.blocks.length - 1} onclick={() => reorder(i, 1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move down'}>↓</Button>
                {/if}
                <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${b.id}`)} disabled={busy}>Open</Button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if perms}
      <section class="state-actions">
        {#if perms.canPublish}
          <Button disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''} onclick={() => transition('publish')}>Publish</Button>
        {/if}
        {#if perms.canArchive}
          <Button disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''} onclick={() => transition('archive')}>Archive</Button>
        {/if}
        {#if perms.canRevert}
          <Button disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''} onclick={() => transition('revert')}>Revert</Button>
        {/if}
        {#if perms.canDisable}
          <Button variant="ghost" disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''} onclick={() => transition('disable')}>Disable</Button>
        {/if}
        {#if perms.canEnable}
          <Button variant="ghost" disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''} onclick={() => transition('enable')}>Enable</Button>
        {/if}
        {#if perms.canDeleteVersion}
          <Button variant="ghost" disabled={tracker.isDirty || busy} title={tracker.isDirty ? 'Save or discard changes first' : ''} onclick={deleteVersion}>Delete</Button>
        {/if}
      </section>
    {/if}

    <DirtyGuard isDirty={() => tracker!.isDirty} />
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
  .meta, .blocks, .state-actions { margin: var(--space-4) 0; }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta textarea, .meta input[type=number] { width: 100%; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .create { display: flex; gap: var(--space-2); margin: var(--space-2) 0; }
  .create input { flex: 1; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .state-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .empty { color: var(--muted); }
</style>
