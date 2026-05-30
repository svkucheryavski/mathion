<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { addRunTeacher, removeRunTeacher } from '../../lib/runTeachers';
  import { pushToast } from '../../stores/toasts.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { Course, RunTeacherResponse } from '../../lib/types';

  let { runId, teachers, onRefetch, course }: {
    runId: number;
    teachers: RunTeacherResponse[];
    onRefetch: () => Promise<void>;
    course: Course;
  } = $props();

  let email = $state('');
  let addError: string | null = $state(null);
  let busy = $state(false);
  let pendingRemove: number | null = $state(null);

  let emailInput: HTMLInputElement | undefined = $state();
  $effect(() => {
    emailInput?.focus();
  });

  // Spec §4.2:455 — "prepend the new row" after success. Backend lists ASC by
  // created_at (run_teachers.py:62), so a refetched newly-added teacher comes
  // back LAST. Sort DESC here so newest is always on top, which makes "prepend"
  // the natural visual outcome.
  const sortedTeachers = $derived(
    [...teachers].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    busy = true;
    try {
      await addRunTeacher(runId, email.trim());
      email = '';
      await onRefetch();
    } catch (e) {
      if (e instanceof ApiError) {
        addError = e.status === 409 ? 'Teacher already assigned to this run.' : e.displayMessage;
      }
    } finally {
      busy = false;
    }
  }

  async function confirmRemove(userId: number) {
    try {
      await removeRunTeacher(runId, userId);
      pendingRemove = null;
      await onRefetch();
    } catch (e) {
      pendingRemove = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }
</script>

<section class="teachers-tab">
  {#if course.is_admin}
    <form onsubmit={submit}>
      <input
        name="email"
        type="email"
        maxlength="254"
        placeholder="teacher@example.com"
        bind:this={emailInput}
        bind:value={email}
      />
      <button type="submit" disabled={busy || !email.trim()}>Add teacher</button>
    </form>
    {#if addError}<p class="error">{addError}</p>{/if}
  {/if}

  {#if teachers.length === 0}
    <p class="empty">No teachers assigned yet{course.is_admin ? '. Add one above.' : '.'}</p>
  {:else}
    <ul>
      {#each sortedTeachers as t (t.user_id)}
        <li>
          {t.user_full_name || '—'} ({t.user_email})
          {#if t.user_full_name === null}<span class="badge">(invited)</span>{/if}
          {#if course.is_admin}
            {#if pendingRemove === t.user_id}
              <InlineConfirm
                confirmLabel="Confirm Remove"
                confirmDataAction="confirm-remove"
                onConfirm={() => confirmRemove(t.user_id)}
                onCancel={() => (pendingRemove = null)}
              />
            {:else}
              <button data-action="remove" onclick={() => (pendingRemove = t.user_id)}>Remove</button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .teachers-tab { display: flex; flex-direction: column; gap: var(--space-3, 16px); }
  form { display: flex; gap: 8px; align-items: center; }
  input[name="email"] { flex: 1; max-width: 320px; padding: 6px 8px; }
  .error { color: var(--danger, #c00); margin: 0; }
  .empty { color: var(--muted, #666); font-style: italic; margin: 0; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border, #eee); }
  .badge { color: var(--muted, #666); font-size: 0.85em; }
</style>
