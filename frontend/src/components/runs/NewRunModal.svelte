<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { createRun } from '../../lib/runs';
  import { navigate } from '../../lib/router.svelte';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
  import Switch from '../ui/Switch.svelte';
  import type { Course, Version } from '../../lib/types';

  let { course, versions, onClose }: {
    course: Course;
    versions: Version[];
    onClose: () => void;
  } = $props();

  const uid = $props.id();
  const titleId = `${uid}-heading`;
  const formId = `${uid}-form`;
  const fid = (key: string) => `${uid}-${key}`;
  const NO_VERSION = 'No published version — close this modal and publish one first.';

  let title = $state('');
  let start_date = $state('');
  let end_date = $state('');
  let groups_enabled = $state(false);

  type Field = 'title' | 'start_date' | 'end_date';
  const FIELD_ORDER: Field[] = ['title', 'start_date', 'end_date'];
  let errors = $state<Partial<Record<Field, string>>>({});
  let inputEls = $state<Partial<Record<Field, HTMLInputElement>>>({});
  let submitError: string | null = $state(null);
  let submitting = $state(false);

  // The newest published, enabled version: it is pinned at creation (D18
  // shows it as the runs lists do, "v. {id}").
  const pinned = $derived.by(() => {
    const eligible = [...versions]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .filter((v) => v.published_at !== null && !v.is_disabled);
    return eligible.length > 0 ? eligible[eligible.length - 1] : null;
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

  function clearError(field: Field) {
    if (errors[field]) errors = { ...errors, [field]: undefined };
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    // R20: Enter in a (readonly) field or the busy button submits again while
    // a create runs; that second submit does nothing.
    if (submitting || pinned === null) return;
    if (!validate()) {
      await tick();
      const first = FIELD_ORDER.find((f) => errors[f]);
      if (first) inputEls[first]?.focus();
      return;
    }
    submitting = true;
    submitError = null;
    try {
      const run = await createRun(course.id, {
        title: title.trim(),
        start_date,
        end_date,
        groups_enabled,
      });
      onClose();
      navigate(`/teaching/${course.slug}/runs/${run.id}`);
    } catch (e) {
      if (e instanceof ApiError) submitError = e.displayMessage;
      else submitError = 'Unable to create run.';
    } finally {
      submitting = false;
    }
  }

  // R19: nothing closes the modal while a create runs.
  function requestClose() {
    if (submitting) return;
    onClose();
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="nr-heading">New run</h2>
{/snippet}

{#snippet foot()}
  <span class="nr-foot-note">The newest published version is pinned at creation and cannot be changed later.</span>
  <Button variant="ghost" data-action="cancel" onclick={requestClose}>Cancel</Button>
  <Button
    variant="primary"
    type="submit"
    form={formId}
    data-action="create"
    loading={submitting}
    disabled={!submitting && pinned === null}
    title={!submitting && pinned === null ? NO_VERSION : undefined}
  >{submitting ? 'Creating…' : 'Create run'}</Button>
{/snippet}

<Modal
  labelledby={titleId}
  width={620}
  onRequestClose={requestClose}
  closeDisabled={submitting}
  header={head}
  footer={foot}
>
  {#if submitError}
    <p class="nr-banner" role="alert">{submitError}</p>
  {/if}
  <form id={formId} class="nr-form" onsubmit={submit}>
    <div class="nr-field">
      <label class="nr-label" for={fid('title')}>Title</label>
      <input
        id={fid('title')}
        class="nr-input"
        class:nr-invalid={!!errors.title}
        name="title"
        maxlength="200"
        data-autofocus
        readonly={submitting}
        aria-invalid={errors.title ? 'true' : undefined}
        aria-describedby={errors.title ? fid('title-err') : undefined}
        bind:value={title}
        bind:this={inputEls.title}
        oninput={() => clearError('title')}
      />
      {#if errors.title}<span class="nr-err" id={fid('title-err')}>{errors.title}</span>{/if}
    </div>
    <div class="nr-dates">
      <div class="nr-field">
        <label class="nr-label" for={fid('start')}>Start date</label>
        <input
          id={fid('start')}
          class="nr-input mono"
          class:nr-invalid={!!errors.start_date}
          type="date"
          name="start_date"
          readonly={submitting}
          aria-invalid={errors.start_date ? 'true' : undefined}
          aria-describedby={errors.start_date ? fid('start-err') : undefined}
          bind:value={start_date}
          bind:this={inputEls.start_date}
          oninput={() => clearError('start_date')}
        />
        {#if errors.start_date}<span class="nr-err" id={fid('start-err')}>{errors.start_date}</span>{/if}
      </div>
      <div class="nr-field">
        <label class="nr-label" for={fid('end')}>End date</label>
        <input
          id={fid('end')}
          class="nr-input mono"
          class:nr-invalid={!!errors.end_date}
          type="date"
          name="end_date"
          readonly={submitting}
          aria-invalid={errors.end_date ? 'true' : undefined}
          aria-describedby={errors.end_date ? fid('end-err') : undefined}
          bind:value={end_date}
          bind:this={inputEls.end_date}
          oninput={() => clearError('end_date')}
        />
        {#if errors.end_date}<span class="nr-err" id={fid('end-err')}>{errors.end_date}</span>{/if}
      </div>
    </div>
    <div class="nr-switch-row">
      <Switch id={fid('groups')} bind:checked={groups_enabled} frozen={submitting} describedby={fid('groups-help')} />
      <div class="nr-switch-text">
        <label class="nr-switch-label" for={fid('groups')}>Groups enabled</label>
        <span class="nr-help" id={fid('groups-help')}>Organise students into groups. Locked once the run is published — and mini-projects need it.</span>
      </div>
    </div>
    <p class="nr-strip version-row">
      <span class="nr-strip-key">Version</span>
      {#if pinned}
        <span class="nr-strip-val" title={pinned.label ? `will use ${pinned.label} · v. ${pinned.id}` : undefined}>will use {#if pinned.label}{pinned.label}{' '}·{' '}{/if}<span class="nr-ver mono">v. {pinned.id}</span></span>
      {:else}
        <span class="nr-strip-val">{NO_VERSION}</span>
      {/if}
    </p>
  </form>
</Modal>

<style>
  /* The × sits at the right edge of the header. */
  .nr-heading { margin-right: auto; font-size: 15px; font-weight: 600; color: var(--text); }
  .nr-banner {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .nr-form { display: flex; flex-direction: column; gap: 12px; margin: 0; }
  .nr-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .nr-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-3);
  }
  .nr-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    font-size: var(--control-font);
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .nr-invalid {
    border-color: var(--danger);
  }
  .nr-err {
    font-size: 12px;
    color: var(--danger);
  }
  .nr-dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .nr-switch-row { display: flex; align-items: flex-start; gap: 11px; }
  .nr-switch-text { display: flex; flex-direction: column; gap: 2px; }
  .nr-switch-label { font-size: 13px; color: var(--text); cursor: pointer; }
  .nr-help {
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }
  .nr-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 9px 11px;
    background: var(--surface-2);
    border-radius: var(--radius);
    font-size: 12.5px;
  }
  .nr-strip-key { color: var(--muted); }
  .nr-strip-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .nr-ver {
    font-size: 11.5px;
    color: var(--muted);
  }
  .nr-foot-note {
    flex: 1;
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
