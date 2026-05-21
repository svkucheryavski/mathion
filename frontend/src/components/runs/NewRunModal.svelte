<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { createRun } from '../../lib/runs';
  import { navigate } from '../../lib/router.svelte';
  import FocusTrap from '../ui/FocusTrap.svelte';
  import type { Course, Version } from '../../lib/types';

  let { course, versions, onClose }: {
    course: Course;
    versions: Version[];
    onClose: () => void;
  } = $props();

  let title = $state('');
  let start_date = $state('');
  let end_date = $state('');
  let groups_enabled = $state(false);

  let errors = $state<{ title?: string; start_date?: string; end_date?: string }>({});
  let submitError: string | null = $state(null);
  let submitting = $state(false);

  const versionLabel = $derived.by(() => {
    const eligible = versions.filter((v) => v.published_at !== null && !v.is_disabled);
    if (eligible.length === 0) return null;
    const sorted = [...versions].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const idx = sorted.findIndex((v) => v.id === eligible[eligible.length - 1].id);
    return `v${idx + 1} (${sorted[idx].created_at.slice(0, 10)})`;
  });

  function validate(): boolean {
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Title is required';
    if (!start_date) next.start_date = 'Start date is required';
    if (!end_date) next.end_date = 'End date is required';
    if (start_date && end_date && end_date < start_date) {
      next.end_date = 'End date must be on or after start date';
    }
    errors = next;
    return Object.keys(next).length === 0;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!validate()) return;
    submitting = true;
    submitError = null;
    try {
      await createRun(course.id, {
        title: title.trim(),
        start_date,
        end_date,
        groups_enabled,
      });
      onClose();
      // Navigate to the list page; T7 retrofits this to the detail page once
      // the `/courses/:courseSlug/runs/:runId` route + componentMap entry exist.
      // Until T7 ships, navigating to the detail URL would hit an unregistered
      // route and render nothing. Going to the list keeps the create-flow
      // observable (the new run appears at the top of the table).
      navigate(`/courses/${course.slug}/runs`);
    } catch (e) {
      if (e instanceof ApiError) submitError = e.displayMessage;
      else submitError = 'Unable to create run.';
    } finally {
      submitting = false;
    }
  }

  function onBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onclick={onBackdrop}>
  <FocusTrap>
    <div class="modal" role="dialog" aria-modal="true" aria-label="New run">
      <header>
        <h2>New run</h2>
        <button type="button" aria-label="Close" onclick={onClose}>×</button>
      </header>

      {#if submitError}
        <div class="error-banner">{submitError}</div>
      {/if}

      <form onsubmit={submit}>
        <label>
          Title
          <input name="title" maxlength="200" autofocus bind:value={title} />
          {#if errors.title}<span class="field-error">{errors.title}</span>{/if}
        </label>

        <label>
          Start date
          <input type="date" name="start_date" bind:value={start_date} />
          {#if errors.start_date}<span class="field-error">{errors.start_date}</span>{/if}
        </label>

        <label>
          End date
          <input type="date" name="end_date" bind:value={end_date} />
          {#if errors.end_date}<span class="field-error">{errors.end_date}</span>{/if}
        </label>

        <label>
          <input type="checkbox" bind:checked={groups_enabled} />
          Groups enabled
          <small>Enable to organize students into groups. Locked once the run is published.</small>
        </label>

        <p class="version-row">
          Version: {#if versionLabel}Will use {versionLabel}{:else}<em>No published version — close this modal and publish one first.</em>{/if}
        </p>

        <footer>
          <button type="button" onclick={onClose}>Cancel</button>
          <button type="submit" disabled={submitting || versionLabel === null}>
            {submitting ? 'Creating…' : 'Create run'}
          </button>
        </footer>
      </form>
    </div>
  </FocusTrap>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: var(--surface, white); border-radius: var(--radius, 8px); padding: var(--space-4, 24px); min-width: 360px; max-width: 90vw; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3, 16px); }
  header h2 { margin: 0; }
  header button { background: transparent; border: 0; font-size: 1.5em; cursor: pointer; padding: 0 8px; }
  form label { display: block; margin-bottom: var(--space-3, 16px); }
  form input[name="title"], form input[type="date"] { display: block; width: 100%; padding: 6px 8px; margin-top: 4px; }
  .field-error { color: var(--danger, #c00); font-size: 0.85em; display: block; margin-top: 4px; }
  .error-banner { background: var(--danger-soft, #fee); color: var(--danger, #c00); padding: 8px 12px; border-radius: 4px; margin-bottom: var(--space-3, 16px); }
  .version-row { color: var(--muted, #666); font-size: 0.9em; }
  footer { display: flex; gap: var(--space-2, 8px); justify-content: flex-end; margin-top: var(--space-3, 16px); }
</style>
