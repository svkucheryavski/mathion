<script lang="ts">
  // The panel's Courses page (D7-D13): every course with its address, admin
  // and counts, as plain text. A row's last cell holds Edit, one dialog for
  // all its fields (D24 rev 6), and the trash; Delete course is the one dialog
  // where the name is typed. One note at a time under the heading; the next
  // action replaces it (D5a).
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import {
    adminIsMe, adminNoteParts, assignAdmin, createCourse, deleteCourse, formatCount, listCourses, panelError, removeAdmin, updateCourse,
    type AdminAssignResult, type PanelCourse, type PanelOnAuth,
  } from '../../lib/superuser';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import NoteStrip from '../../components/superuser/NoteStrip.svelte';
  import CommandText from '../../components/superuser/CommandText.svelte';
  import NewCourseDialog from '../../components/superuser/NewCourseDialog.svelte';
  import EditCourseDialog from '../../components/superuser/EditCourseDialog.svelte';
  import DeleteCourseDialog from '../../components/superuser/DeleteCourseDialog.svelte';
  import Button from '../../components/ui/Button.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import { session } from '../../stores/session.svelte';
  import type { SetupStore } from '../../lib/setupStore.svelte';

  let { token, onAuth, setup }: { token: string; onAuth: PanelOnAuth; setup: SetupStore } = $props();

  type Note = { id: number; text: string; command?: string };
  type Dialog = { kind: 'new' } | { kind: 'edit' | 'delete'; course: PanelCourse };

  let courses = $state.raw<PanelCourse[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let note = $state<Note | null>(null);
  let noteSeq = 0;
  // Every action's change of the note takes a turn, so a note that waited on a
  // state read never lands over a later action's note (or its clearing).
  // Closing the strip isn't an action: it takes no turn.
  let noteTurn = 0;
  function clearNote(): void {
    noteTurn++;
    note = null;
  }
  let dialog = $state<Dialog | null>(null);
  let heading = $state<HTMLElement>();

  // `quiet` reloads behind what is on screen (after a save, or a 409 that says
  // the list is stale) and keeps the table if it fails. Only the newest
  // request's reply counts (rev 11, as D15a on the Users page).
  let latest = 0;
  async function load(quiet = false): Promise<void> {
    const t = token;
    const mine = ++latest;
    if (!quiet) { loading = true; loadError = ''; }
    try {
      const list = await listCourses(t);
      if (mine !== latest) return;
      courses = list;
      loadError = '';
    } catch (err) {
      if (mine !== latest) return;
      const msg = panelError(err, onAuth);
      // D25 (rev 13): a quiet load keeps the table on screen. With no rows
      // on screen (no list yet, or an empty one) there is nothing to keep,
      // so its failure shows like a first load's, not as "No courses yet".
      if (!quiet || courses.length === 0) loadError = msg ?? '';
    } finally {
      if (mine === latest) loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // D5a: the superuser always learns whether the colleague was told. Set up
  // D8: "you are its admin" when it's the signed-in superuser, and Email's
  // not-done reason after a queued email. With no state yet (the first read
  // failed), a note that can carry the reason reads it first, so it isn't
  // left out.
  async function showResult(result: AdminAssignResult, kind: 'create' | 'assign'): Promise<void> {
    const turn = ++noteTurn;
    const me = session.user?.email ?? null;
    const wantsReason = result.admin_email === 'queued' && !adminIsMe(result.admin.email, me);
    if (wantsReason && setup.state === null) await setup.read();
    if (turn !== noteTurn) return;
    const emailReason = setup.state?.steps[0].reason ?? null;   // null once Email is done
    note = { id: ++noteSeq, ...adminNoteParts(result, kind, { me, emailReason }) };
  }

  // D25: a 409 means the list on screen is stale (gone, or taken). The dialog
  // stays open with the sentence; the list catches up behind it.
  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void load(true);
      throw err;
    }
  }

  // D5a: the note stays until closed or a later action's outcome replaces it,
  // so a dialog opened and cancelled keeps the `mathion pin` command on screen.
  function open(next: Dialog): void {
    dialog = next;
  }

  async function saveNew(body: { name: string; slug: string; admin_email: string }): Promise<void> {
    const result = await guarded(() => createCourse(token, body));
    dialog = null;
    void showResult(result, 'create');
    void load(true);
  }

  async function saveFields(course: PanelCourse, body: { name?: string; slug?: string }): Promise<void> {
    await guarded(() => updateCourse(token, course.id, body));
    clearNote();
    void load(true);
  }

  // null removes the admin (D9: the email was cleared).
  async function saveAdmin(course: PanelCourse, email: string | null): Promise<void> {
    if (email === null) {
      await guarded(() => removeAdmin(token, course.id));
      clearNote();
    } else {
      void showResult(await guarded(() => assignAdmin(token, course.id, email)), 'assign');
    }
    void load(true);
  }

  async function removeCourse(course: PanelCourse): Promise<void> {
    await guarded(() => deleteCourse(token, course.id));
    // D25 (rev 13): the row goes at once, so a failed reload can't keep it.
    courses = courses.filter((c) => c.id !== course.id);
    dialog = null;
    clearNote();
    void load(true);
    // The trash went with its row.
    await tick();
    heading?.focus();
  }

  const runsReason = (n: number) => `${formatCount(n)} ${n === 1 ? 'run' : 'runs'}: can't be deleted`;
</script>

{#snippet newButton()}
  <Button variant="primary" onclick={() => open({ kind: 'new' })}>New course</Button>
{/snippet}

<PanelHead title="Courses" actions={newButton} bind:heading />

<div class="live-slot" role="status">{#if note}{#key note.id}<NoteStrip tone="info" onClose={() => (note = null)}><CommandText text={note.text} command={note.command} /></NoteStrip>{/key}{/if}</div>

{#if loading}
  <Skeleton rows={3} label="Loading courses…" />
{:else if loadError}
  <ErrorState title="Could not load courses." message={loadError} onretry={() => void load()} retryLabel="Try again" />
{:else if courses.length === 0}
  <EmptyState title="No courses yet. Create one with New course." />
{:else}
  <div class="table-scroll">
    <table class="c-table">
      <thead>
        <tr>
          <th scope="col">Course</th>
          <th scope="col">Address</th>
          <th scope="col">Admin</th>
          <th scope="col" class="r">Versions</th>
          <th scope="col" class="r">Runs</th>
          <th scope="col"><span class="vh">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each courses as c (c.id)}
          <tr class="c-row">
            <td class="c-name">{c.name}</td>
            <td class="c-slug">{c.slug}</td>
            <td>
              {#if c.admin}
                <span class="c-admin">
                  <span class="c-admin-name">{c.admin.full_name ?? c.admin.email}</span>
                  {#if c.admin.full_name}<span class="c-admin-email">{c.admin.email}</span>{/if}
                  {#if c.admin.is_disabled}<span class="chip-disabled">disabled</span>{/if}
                </span>
              {:else}
                <span class="c-none">No admin</span>
              {/if}
            </td>
            <td class="num r">{formatCount(c.version_count)}</td>
            <td class="num r">{formatCount(c.run_count)}</td>
            <td class="r">
              <span class="row-icons">
                <IconButton glyph="pencil" size="sm" title="Edit" aria-label="Edit {c.name}" data-action="edit"
                  onclick={() => open({ kind: 'edit', course: c })} />
                <!-- D12: blocked, not disabled, so the reason can be focused and read. -->
                <IconButton glyph="trash" size="sm" danger aria-label={c.run_count > 0 ? `Delete ${c.name}: ${runsReason(c.run_count)}` : `Delete ${c.name}`}
                  title={c.run_count > 0 ? runsReason(c.run_count) : 'Delete'}
                  aria-disabled={c.run_count > 0 ? true : undefined} data-action="delete"
                  onclick={() => { if (c.run_count === 0) open({ kind: 'delete', course: c }); }} />
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if dialog?.kind === 'new'}
  <NewCourseDialog {token} {onAuth} onSave={saveNew} onClose={() => (dialog = null)} />
{:else if dialog?.kind === 'edit'}
  {@const c = dialog.course}
  <EditCourseDialog {token} course={c} {onAuth}
    saveFields={(body) => saveFields(c, body)} saveAdmin={(email) => saveAdmin(c, email)}
    onDone={() => (dialog = null)} onClose={() => (dialog = null)} />
{:else if dialog?.kind === 'delete'}
  {@const c = dialog.course}
  <DeleteCourseDialog {token} course={c} {onAuth} onDelete={() => removeCourse(c)} onStale={() => void load(true)}
    onClose={() => (dialog = null)} />
{/if}

<style>
  /* The teaching list's table (TeacherRunListPage). */
  /* Positioned, so the hidden .vh spans stay inside its clip. */
  .table-scroll { position: relative; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .c-table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .c-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
  }
  .c-table td { padding: 8px 12px; border-top: 1px solid var(--border-soft); font-size: 13px; color: var(--text-2); vertical-align: middle; }
  .c-table th.r, .c-table td.r { text-align: right; }
  .num { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
  .c-table td.c-name { color: var(--text); font-weight: 500; }
  .c-table td.c-slug, .c-admin-email { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
  .c-admin { display: inline-flex; align-items: baseline; gap: 6px; }
  .c-none { color: var(--muted); }
  /* RunTeachersTab's "invited" chip. */
  .chip-disabled {
    display: inline-block;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--state-disabled-bg);
    color: var(--state-disabled-fg);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }
  /* RunMiniProjectsTab's row icons: Edit, then the trash. */
  .row-icons { display: inline-flex; gap: 4px; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
