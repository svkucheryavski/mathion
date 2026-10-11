<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { addRunTeacher, removeRunTeacher } from '../../lib/runTeachers';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import Avatar from '../ui/Avatar.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { Course, RunTeacherResponse } from '../../lib/types';

  let { runId, teachers, onRefetch, course }: {
    runId: number;
    teachers: RunTeacherResponse[];
    onRefetch: () => Promise<void>;
    course: Course;
  } = $props();

  const uid = $props.id();
  let email = $state('');
  let addError: string | null = $state(null);
  let busy = $state(false);
  let pendingRemove: number | null = $state(null);

  let emailInput = $state<HTMLInputElement>();
  let headingEl = $state<HTMLElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  // Newest first: the backend lists by created_at ASC, so a new teacher
  // appears at the top.
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
    // The + went disabled while busy, which drops a click's focus to <body>:
    // put it back in the field either way, ready for a correction.
    await tick();
    emailInput?.focus();
  }

  async function cancelRemove(userId: number) {
    pendingRemove = null;
    await tick();
    trashEls[userId]?.focus();
  }

  // §Focus: the next row's trash, the previous row's, the email field, the h2.
  async function confirmRemove(userId: number) {
    const idx = sortedTeachers.findIndex((t) => t.user_id === userId);
    try {
      await removeRunTeacher(runId, userId);
      pendingRemove = null;
      await onRefetch();
      await tick();
      const next = sortedTeachers[idx];
      const prev = idx > 0 ? sortedTeachers[idx - 1] : undefined;
      focusFirst([next && trashEls[next.user_id], prev && trashEls[prev.user_id], emailInput, headingEl]);
    } catch (e) {
      pendingRemove = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
      await tick();
      trashEls[userId]?.focus();
    }
  }
</script>

<section class="teachers-tab">
  <div class="sec-head">
    <h2 tabindex="-1" bind:this={headingEl}>Teachers <span class="sec-count">{teachers.length}</span></h2>
    {#if course.is_admin}
      <form class="t-add" onsubmit={submit}>
        <label class="vh" for="{uid}-email">Teacher email</label>
        <input
          id="{uid}-email"
          class="t-input"
          name="email"
          type="email"
          maxlength="254"
          placeholder="teacher@example.com"
          aria-invalid={addError ? 'true' : undefined}
          aria-describedby={addError ? `${uid}-err` : undefined}
          bind:this={emailInput}
          bind:value={email}
        />
        <IconButton glyph="plus" primary size="md" type="submit" title="Add teacher" disabled={busy || !email.trim()} />
      </form>
    {/if}
  </div>
  {#if addError}<p class="t-err" id="{uid}-err" role="alert">{addError}</p>{/if}

  {#if teachers.length === 0}
    <p class="empty">No teachers assigned yet{course.is_admin ? '. Add one above.' : '.'}</p>
  {:else}
    <ul class="t-list">
      {#each sortedTeachers as t (t.user_id)}
        <li class="t-row">
          <Avatar />
          <span class="t-who">
            <span class="t-name">{t.user_full_name || '—'}{#if t.user_full_name === null}{' '}<span class="chip-invited">invited</span>{/if}</span>
            <span class="t-email">{t.user_email}</span>
          </span>
          {#if course.is_admin}
            <span class="t-actions">
              {#if pendingRemove === t.user_id}
                <InlineConfirm takeFocus confirmLabel="Confirm Remove" confirmDataAction="confirm-remove"
                               onConfirm={() => confirmRemove(t.user_id)} onCancel={() => cancelRemove(t.user_id)} />
              {:else}
                <IconButton glyph="trash" size="sm" danger title="Remove" aria-label="Remove {t.user_email}"
                            data-action="remove" bind:element={trashEls[t.user_id]}
                            onclick={() => (pendingRemove = t.user_id)} />
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .teachers-tab { display: flex; flex-direction: column; gap: 10px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }
  .t-add { display: flex; align-items: center; gap: 6px; }
  .t-input {
    box-sizing: border-box;
    width: 260px;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
  }
  .t-input[aria-invalid='true'] { border-color: var(--danger); }
  .t-err { margin: 0; font-size: 12px; color: var(--danger); text-align: right; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  .t-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .t-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--border-soft); }
  .t-row:first-child { border-top: 0; }
  .t-who { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
  .t-name { font-size: 13px; color: var(--text); }
  .t-email { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
  .chip-invited {
    display: inline-block;
    margin-left: 4px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--state-disabled-bg);
    color: var(--state-disabled-fg);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }
  .t-actions { display: flex; align-items: center; }
  .empty { margin: 0; color: var(--muted); font-size: 13px; }
</style>
