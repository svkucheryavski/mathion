<script lang="ts">
  // D12, D12a: delete a course that has no runs, confirmed by typing its name
  // (trimmed, exact, case included). It says what goes, students' leftover
  // progress included; the count informs and never blocks. `onDelete` owns the
  // request, closes on success and THROWS on failure (D25).
  import { onMount } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import { getDeleteImpact, panelError, type PanelCourse, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    token: string;
    course: PanelCourse;
    onDelete: () => Promise<void>;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { token, course, onDelete, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  let typed = $state('');
  // null until the impact answers; a failed lookup still lets the delete go.
  let progress = $state<number | null>(null);
  let impactDone = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const ready = $derived(impactDone && typed.trim() === course.name);
  // D12 rev 10: a course with no versions (one just created) says nothing of them.
  const versions = $derived(
    course.version_count === 0 ? ''
      : course.version_count === 1 ? 'Its 1 version and its files go too. '
        : `Its ${course.version_count} versions and their files go too. `,
  );

  onMount(async () => {
    try {
      progress = (await getDeleteImpact(token, course.id)).progress_students;
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      impactDone = true;
    }
  });

  async function remove() {
    if (busy || !ready) return;
    error = null;
    busy = true;
    try {
      await onDelete();
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="dc-title">Delete course</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <Button variant="danger" loading={busy} aria-disabled={!ready && !busy} onclick={() => void remove()}>Delete course</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={480} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="dc-form" novalidate onsubmit={(e) => { e.preventDefault(); void remove(); }}>
    <p class="dc-text">Delete <strong>{course.name}</strong>? {versions}This can't be undone.</p>
    {#if progress !== null && progress > 0}
      <p class="dc-text">Also deletes the progress of {progress} {progress === 1 ? 'student' : 'students'} (pages visited, quiz answers).</p>
    {/if}
    <label class="dc-label" for="{uid}-name">Type the course name to confirm</label>
    <input id="{uid}-name" class="dc-input" data-autofocus bind:value={typed} readonly={busy} autocomplete="off" spellcheck="false"
      aria-describedby={error ? errId : undefined} oninput={() => { error = null; }} />
    {#if error}<p id={errId} class="dc-err" role="alert">{error}</p>{/if}
  </form>
</Modal>

<style>
  .dc-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .dc-form { display: flex; flex-direction: column; gap: 6px; }
  .dc-text { margin: 0 0 6px; font-size: 13px; line-height: 1.5; color: var(--text-2); overflow-wrap: anywhere; }
  .dc-text strong { font-weight: 600; color: var(--text); }
  .dc-label { font-size: 12.5px; color: var(--muted); }
  /* The item modal's field (NewItemModal .plain-input). */
  .dc-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .dc-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .dc-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
