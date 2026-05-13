<script lang="ts">
  import { getContext } from 'svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeVersion } from '../../lib/types';

  type Props = {
    vid: number;
    version: AdminTreeVersion;
  };

  let { vid, version }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — VersionEditPage must wrap VersionMetaForm');

  const perms = $derived(versionPermissions(version));

  type Meta = { info_md: string; max_quiz_attempts: number };
  const tracker = makeDirtyTracker<Meta>({
    info_md: version.info_md,
    max_quiz_attempts: version.max_quiz_attempts,
  });

  // Defensive rebuild on vid change. Slice-2 mount model destroys this
  // component when VersionEditPage unmounts (different course/version), so
  // this is belt-and-suspenders — see spec §Race safety carry-over.
  let trackerVid = $state(vid);
  $effect(() => {
    if (vid !== trackerVid) {
      tracker.reset({ info_md: version.info_md, max_quiz_attempts: version.max_quiz_attempts });
      trackerVid = vid;
    }
  });

  $effect(() => {
    dirty.register(tracker);
    return () => dirty.unregister(tracker);
  });

  let busy = $state(false);

  async function save() {
    if (!tracker.isDirty) return;
    // Slice-1 client-side validation (Task-18 lesson preserved): bind:value
    // on <input type=number> can yield null/NaN/decimal — all 422 server-
    // side with an opaque message. Validate first.
    const n = tracker.current.max_quiz_attempts as number | null;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) {
      pushToast('Max quiz attempts must be a whole number between 1 and 10', 'error');
      return;
    }
    const savedVid = vid;
    const sentInfoMd = tracker.current.info_md;
    const sentAttempts = n;
    busy = true;
    try {
      await api.patch(`/api/versions/${savedVid}`, { info_md: sentInfoMd, max_quiz_attempts: sentAttempts });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value;
        if (fresh && fresh.version.id === savedVid) {
          tracker.reset({ info_md: fresh.version.info_md, max_quiz_attempts: fresh.version.max_quiz_attempts });
        }
        pushToast('Saved', 'success');
      } else {
        tracker.reset({ info_md: sentInfoMd, max_quiz_attempts: sentAttempts });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ info_md: version.info_md, max_quiz_attempts: version.max_quiz_attempts });
  }
</script>

{#if perms.canEditVersionMeta}
  <section class="meta">
    <h2>Version info</h2>
    <label>Info (markdown)
      <textarea bind:value={tracker.current.info_md} rows="4" disabled={busy}></textarea>
    </label>
    <label>Max quiz attempts
      <input type="number" min="1" max="10" step="1" required bind:value={tracker.current.max_quiz_attempts} disabled={busy} />
    </label>
    <div class="row">
      <Button onclick={save} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
      <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
    </div>
  </section>
{/if}

<style>
  .meta { margin: var(--space-4) 0; }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta textarea, .meta input[type=number] { width: 100%; }
  .row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; flex-wrap: wrap; }
</style>
