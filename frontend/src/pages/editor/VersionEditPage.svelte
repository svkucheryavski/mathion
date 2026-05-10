<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
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
  // Inline errors per spec §6: 422 / 409-slug land here, not in a toast.
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  function clearCreateErrors() { createErrors = {}; createGlobalError = null; }
  function toggleCreateBlock() {
    if (creating) { newTitle = ''; newSlug = ''; }
    clearCreateErrors();
    creating = !creating;
  }

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
    // Capture vid + values + the tracker REFERENCE at PATCH-time. A rapid
    // v3→v4 navigation mid-await would re-run ensureLoaded and reassign the
    // module-let `tracker` to a fresh v4 tracker; reading `tracker` post-await
    // would then reset v4's tracker with v3's sent values. Pin the v3 tracker
    // here so the reset always lands on the version we actually saved.
    const savedVid = vid;
    const savedTracker = tracker;
    const sentInfoMd = savedTracker.current.info_md;
    const sentAttempts = n;
    busy = true;
    try {
      await api.patch(`/api/versions/${savedVid}`, { info_md: sentInfoMd, max_quiz_attempts: sentAttempts });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        // Refetch was invalidated by a newer navigation/clear (typically the
        // user navigated away mid-await — onDestroy runs clearEditorVersion).
        // PATCH itself succeeded; do not show "refresh failed". The tracker
        // is unmounting anyway, so reset is unnecessary.
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value;
        if (fresh && fresh.version.id === savedVid) {
          savedTracker.reset({ info_md: fresh.version.info_md, max_quiz_attempts: fresh.version.max_quiz_attempts });
        }
        pushToast('Saved', 'success');
      } else {
        // result === 'error': PATCH succeeded server-side but the follow-up
        // GET failed. Baseline against the values we PATCHed so the tracker
        // isn't stuck dirty against pre-save values. Severity is 'info' —
        // the save itself worked.
        savedTracker.reset({ info_md: sentInfoMd, max_quiz_attempts: sentAttempts });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
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
    // Pin route IDs at POST-start. A v3→v4 navigation mid-await would let
    // `vid` reactively rebind and the post-POST refetch land on v4 instead
    // of the v3 we just mutated.
    const savedVid = vid;
    clearCreateErrors();
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks`, { title: newTitle, slug: newSlug, info: '' });
      newTitle = ''; newSlug = ''; creating = false;
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      // Spec §6: 422 / 409-slug → inline field errors. Only toast a global
      // message when there are no field-level errors (otherwise the inline
      // display already covers it).
      const mapped = mapCreateError(e, ['title', 'slug']);
      createErrors = mapped.fieldErrors;
      createGlobalError = mapped.globalMessage;
      if (mapped.globalMessage && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(mapped.globalMessage, 'error');
      }
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
    // Pin vid so a navigation race mid-await doesn't reorder/refetch the
    // wrong version.
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks/reorder`, { order });
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      await loadAdminTree(savedVid, { force: true });
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
    // Pin vid at POST-start so a v3→v4 navigation mid-await doesn't transition
    // the wrong version (and refetch it).
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/${action}`);
      await loadAdminTree(savedVid, { force: true });
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
    // Pin vid + slug at DELETE-start so a navigation race mid-await doesn't
    // delete the wrong version or send the user to the wrong /edit page.
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
            onclick={toggleCreateBlock}
          >{creating ? 'Cancel' : '+ New block'}</Button>
        {/if}
      </div>
      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); createBlock(); }}>
          <div class="field">
            <input placeholder="Title" bind:value={newTitle} required oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
            {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          </div>
          <div class="field">
            <!-- Mirrors backend regex schemas.py: ^[a-z0-9]+(?:-[a-z0-9]+)*$
                 (HTML auto-anchors patterns). The looser [a-z0-9-]+ would let
                 --foo / foo-- pass the browser then 422 at the server. -->
            <input placeholder="Slug" bind:value={newSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" oninput={() => { if (createErrors.slug) createErrors = { ...createErrors, slug: '' }; }} />
            {#if createErrors.slug}<small class="field-err">{createErrors.slug}</small>{/if}
          </div>
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
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
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === 0} onclick={() => reorder(i, -1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move up'} aria-label="Move up">↑</Button>
                  <Button variant="ghost" disabled={tracker.isDirty || busy || i === tree.blocks.length - 1} onclick={() => reorder(i, 1)} title={tracker.isDirty ? 'Save or discard changes first' : 'Move down'} aria-label="Move down">↓</Button>
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
  .create { display: flex; gap: var(--space-2); margin: var(--space-2) 0; flex-wrap: wrap; align-items: flex-start; }
  .create input { flex: 1; width: 100%; }
  .create .field { flex: 1; display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; flex-basis: 100%; margin: 0; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .state-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .empty { color: var(--muted); }
</style>
