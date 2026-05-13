<script lang="ts">
  import { setContext, onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import VersionMetaForm from '../../components/editor/VersionMetaForm.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';

  type Props = {
    courseSlug: string;
    versionId: string;
    blockId?: string;
    sequenceId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId }: Props = $props();

  const vid = $derived(Number(versionId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  // routeBid / routeSid wired in Task 12 — suppress noUnusedLocals until then.
  void blockId; void sequenceId;

  // Provide dirty registry BEFORE any consumer mounts (provider-before-
  // consumers ordering per spec).
  const dirtyRegistry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const slugMatches = $derived(!!tree && tree.course.slug === courseSlug);
  const perms = $derived(v ? versionPermissions(v) : null);

  let busy = $state(false);

  // Load $effect — declared FIRST (declaration-order discipline:
  // load → validation → focus, see spec §"$effect declaration order").
  // Validation + focus $effects land in Task 12.
  $effect(() => {
    if (!vidValid) return;
    void loadAdminTree(vid);
  });

  onDestroy(() => clearEditorVersion());

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

    <VersionMetaForm {vid} version={v} />

    <!-- Blocks accordion list lands in Task 12. -->

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
</style>
