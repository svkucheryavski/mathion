<script lang="ts">
  // The panel's Courses page (D7-D13): every course with its address, admin
  // and counts, as plain text. A row's last cell holds Edit, one dialog for
  // all its fields (D24 rev 6), and the trash; Delete course is the one dialog
  // where the name is typed. One note at a time under the heading; the next
  // action replaces it (D5a).
  import { ApiError } from '../../lib/api';
  import {
    adminNote, assignAdmin, createCourse, deleteCourse, listCourses, panelError, pinCommand, removeAdmin, updateCourse,
    type AdminAssignResult, type PanelCourse, type PanelOnAuth,
  } from '../../lib/superuser';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import NoteStrip from '../../components/superuser/NoteStrip.svelte';
  import NewCourseDialog from '../../components/superuser/NewCourseDialog.svelte';
  import EditCourseDialog from '../../components/superuser/EditCourseDialog.svelte';
  import DeleteCourseDialog from '../../components/superuser/DeleteCourseDialog.svelte';
  import Button from '../../components/ui/Button.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';

  let { token, onAuth }: { token: string; onAuth: PanelOnAuth } = $props();

  type Note = { id: number; text: string; command?: string };
  type Dialog = { kind: 'new' } | { kind: 'edit' | 'delete'; course: PanelCourse };

  let courses = $state.raw<PanelCourse[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let note = $state<Note | null>(null);
  let noteSeq = 0;
  let dialog = $state<Dialog | null>(null);

  // `quiet` reloads behind what is on screen (after a save, or a 409 that says
  // the list is stale) and keeps the table if it fails.
  async function load(quiet = false): Promise<void> {
    const t = token;
    if (!quiet) { loading = true; loadError = ''; }
    try {
      courses = await listCourses(t);
      loadError = '';
    } catch (err) {
      const msg = panelError(err, onAuth);
      if (!quiet) loadError = msg ?? '';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // D5a: the superuser always learns whether the colleague was told.
  function showResult(result: AdminAssignResult, kind: 'create' | 'assign'): void {
    const command = result.admin_email === 'email_off' ? pinCommand(result.admin.email) : undefined;
    note = { id: ++noteSeq, text: adminNote(result, kind), command };
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
    showResult(result, 'create');
    void load(true);
  }

  async function saveFields(course: PanelCourse, body: { name?: string; slug?: string }): Promise<void> {
    await guarded(() => updateCourse(token, course.id, body));
    note = null;
    void load(true);
  }

  // null removes the admin (D9: the email was cleared).
  async function saveAdmin(course: PanelCourse, email: string | null): Promise<void> {
    if (email === null) {
      await guarded(() => removeAdmin(token, course.id));
      note = null;
    } else {
      showResult(await guarded(() => assignAdmin(token, course.id, email)), 'assign');
    }
    void load(true);
  }

  async function removeCourse(course: PanelCourse): Promise<void> {
    await guarded(() => deleteCourse(token, course.id));
    dialog = null;
    note = null;
    void load(true);
  }

  const runsReason = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}: can't be deleted`;
</script>

{#snippet newButton()}
  <Button variant="primary" onclick={() => open({ kind: 'new' })}>New course</Button>
{/snippet}

<PanelHead title="Courses" actions={newButton} />

{#if note}
  {#key note.id}
    <NoteStrip tone="info" onClose={() => (note = null)}>
      {#if note.command && note.text.includes(note.command)}
        {@const at = note.text.indexOf(note.command)}
        {note.text.slice(0, at)}<code>{note.command}</code>{note.text.slice(at + note.command.length)}
      {:else}
        {note.text}
      {/if}
    </NoteStrip>
  {/key}
{/if}

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
            <td class="num r">{c.version_count}</td>
            <td class="num r">{c.run_count}</td>
            <td class="r">
              <span class="row-icons">
                <IconButton glyph="pencil" size="sm" title="Edit" aria-label="Edit {c.name}" data-action="edit"
                  onclick={() => open({ kind: 'edit', course: c })} />
                <!-- D12: blocked, not disabled, so the reason can be focused and read. -->
                <IconButton glyph="trash" size="sm" danger aria-label="Delete {c.name}"
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
  <DeleteCourseDialog {token} course={c} {onAuth} onDelete={() => removeCourse(c)} onClose={() => (dialog = null)} />
{/if}

<style>
  /* The teaching list's table (TeacherRunListPage). */
  .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
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
