<script lang="ts">
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { Course, Version } from '../../lib/types';

  let { courseSlug }: { courseSlug: string } = $props();

  let course = $state<Course | null>(null);
  let versions = $state<Version[]>([]);
  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  // Single in-flight flag — disables every action button (Create / Open /
  // Disable / Enable / Delete) while a POST/DELETE is awaiting completion,
  // preventing double-submit / racing transitions on the same row.
  let busy = $state(false);

  // Create form
  let creating = $state(false);
  let info_md = $state('');
  let max_quiz_attempts = $state<number | null>(3);

  async function load() {
    loading = true;
    error = null;
    try {
      course = await api.get<Course>(`/api/courses/by-slug/${encodeURIComponent(courseSlug)}`);
      versions = await api.get<Version[]>(`/api/courses/${course.id}/versions`);
    } catch (e) {
      if (e instanceof ApiError) error = { status: e.status, message: e.displayMessage };
      else error = { status: 500, message: 'Could not load.' };
    } finally {
      loading = false;
    }
  }

  // Re-runs whenever `courseSlug` changes — App.svelte updates the prop in
  // place rather than remounting the component, so onMount(load) would only
  // fire on the first slug. (Same pattern as CourseView.svelte:14.)
  $effect(() => {
    void courseSlug;
    void load();
  });

  async function createVersion() {
    if (!course) return;
    // bind:value on <input type="number"> yields null when empty and NaN on
    // partial input; decimals (e.g. 5.5) parse cleanly but the backend
    // requires int (Pydantic ge=1/le=10) and 422s with an opaque message.
    // Validate client-side before POST.
    const n = max_quiz_attempts;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) {
      pushToast('Max quiz attempts must be a whole number between 1 and 10', 'error');
      return;
    }
    busy = true;
    try {
      const v = await api.post<Version>(`/api/courses/${course.id}/versions`, { info_md, max_quiz_attempts: n });
      navigate(`/courses/${courseSlug}/edit/v/${v.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Failed to create version';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  async function transition(v: Version, action: 'disable' | 'enable') {
    // Spec §8: all state transitions follow confirm → POST → refetch / toast.
    const verb = action === 'disable' ? 'Disable' : 'Enable';
    if (!confirm(`${verb} version ${v.id}?`)) return;
    busy = true;
    try {
      await api.post(`/api/versions/${v.id}/${action}`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : `Could not ${action}`;
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  async function deleteVersion(v: Version) {
    if (!confirm(`Delete draft version ${v.id}? This cannot be undone.`)) return;
    busy = true;
    try {
      await api.delete(`/api/versions/${v.id}`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not delete';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="page">
  {#if loading}
    <Spinner />
  {:else if error}
    <h1>Couldn't load</h1>
    <p>{error.message}</p>
    <Button variant="ghost" onclick={() => navigate('/courses')}>← Back to courses</Button>
  {:else if course}
    <header>
      <Button variant="ghost" onclick={() => navigate('/courses')}>← Courses</Button>
      <h1>Edit · {course.name}</h1>
    </header>
    <section class="versions">
      <div class="head">
        <h2>Versions</h2>
        <Button onclick={() => (creating = !creating)} disabled={busy}>{creating ? 'Cancel' : '+ New version'}</Button>
      </div>
      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); createVersion(); }}>
          <label>Info (markdown)
            <textarea bind:value={info_md} rows="3"></textarea>
          </label>
          <label>Max quiz attempts
            <!-- Raw <input> — `Input.svelte` doesn't accept min/max; opening it up
                 would be unrelated work. Native browser validation gives min/max bounds. -->
            <input type="number" min="1" max="10" step="1" required bind:value={max_quiz_attempts} />
          </label>
          <Button type="submit" disabled={busy} loading={busy}>Create</Button>
        </form>
      {/if}
      {#if versions.length === 0}
        <p class="empty">No versions yet. Create one to start authoring.</p>
      {:else}
        <ul>
          {#each versions as v (v.id)}
            <li class="row">
              <div>
                <strong>v{v.id}</strong>
                <span class="badge state-{v.state}">{v.state}</span>
                {#if v.is_disabled}<span class="badge disabled">disabled</span>{/if}
              </div>
              <div class="actions">
                <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)} disabled={busy}>Open</Button>
                {#if v.is_disabled}
                  <Button variant="ghost" onclick={() => transition(v, 'enable')} disabled={busy}>Enable</Button>
                {:else}
                  <Button variant="ghost" onclick={() => transition(v, 'disable')} disabled={busy}>Disable</Button>
                {/if}
                {#if v.state === 'created' && !v.is_disabled}
                  <Button variant="ghost" onclick={() => deleteVersion(v)} disabled={busy}>Delete</Button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; margin-left: var(--space-2); }
  .badge.state-created { background: #ffeac0; color: #663; }
  .badge.state-published { background: #ddf3dd; color: #265; }
  .badge.state-archived { background: #eee; color: #555; }
  .badge.disabled { background: #fdd; color: #833; }
  .create { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-3); }
  textarea { width: 100%; }
  .empty { color: var(--muted); }
</style>
