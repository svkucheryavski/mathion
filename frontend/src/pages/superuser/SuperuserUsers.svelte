<script lang="ts">
  // The panel's Users page (D14-D21): the 20 newest accounts, or up to 20
  // matches of the search, filtered by the role pills. Cells are plain text; a
  // row's last cell holds Edit (one dialog, D24 rev 6), Disable or Enable, and
  // the trash for an account with no data. Disable, Enable and Delete ask in a
  // strip under the row. A superuser row has only Edit (D21).
  import { untrack } from 'svelte';
  import { ApiError } from '../../lib/api';
  import {
    countLine, createUser, deleteUser, disableUser, disableWarning, enableUser, listUsers, panelError, personName,
    roleChips, updateUser, type PanelOnAuth, type PanelUser, type PanelUserList, type PanelUserRole,
  } from '../../lib/superuser';
  import { lastActiveText } from '../../lib/relativeTime';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import NoteStrip from '../../components/superuser/NoteStrip.svelte';
  import NewAccountDialog from '../../components/superuser/NewAccountDialog.svelte';
  import EditAccountDialog from '../../components/superuser/EditAccountDialog.svelte';
  import Button from '../../components/ui/Button.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import InlineConfirm from '../../components/ui/InlineConfirm.svelte';
  import FilterPills from '../../components/ui/FilterPills.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';

  let { token, onAuth }: { token: string; onAuth: PanelOnAuth } = $props();

  type Note = { id: number; tone: 'info' | 'error'; text: string };
  type Ask = { id: number; kind: 'disable' | 'enable' | 'delete' };
  type Dialog = { kind: 'new' } | { kind: 'edit'; user: PanelUser };

  const PILLS: { key: PanelUserRole; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'admins', label: 'Admins' },
    { key: 'teachers', label: 'Teachers' },
    { key: 'students', label: 'Students' },
    { key: 'disabled', label: 'Disabled' },
  ];

  let query = $state('');
  let role = $state<PanelUserRole>('all');
  // The list with the search and pill it was fetched for, so the line under
  // the table describes what is shown, not what is being typed.
  let shown = $state.raw<{ list: PanelUserList; q: string; role: PanelUserRole } | null>(null);
  let loadError = $state('');
  let note = $state<Note | null>(null);
  let noteSeq = 0;
  let dialog = $state<Dialog | null>(null);
  let ask = $state<Ask | null>(null);
  let asking = $state(false);
  const askEls: Record<string, HTMLButtonElement | undefined> = $state({});
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // D15a: only the newest request's reply counts.
  async function load(): Promise<void> {
    const mine = ++latest;
    const q = query.trim();
    const r = role;
    try {
      const list = await listUsers(token, q, r);
      if (mine !== latest) return;
      shown = { list, q, role: r };
      loadError = '';
    } catch (err) {
      if (mine !== latest) return;
      loadError = panelError(err, onAuth) ?? '';
    }
  }

  $effect(() => {
    void token;
    untrack(() => void load());
    return () => clearTimeout(timer);
  });

  // D15a: the search fires after a 250 ms pause; a pill fetches at once.
  function onSearch(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), 250);
  }

  function onPill(key: string): void {
    role = key as PanelUserRole;
    clearTimeout(timer);
    void load();
  }

  const pillOptions = $derived(PILLS.map((p) => ({ ...p, count: shown?.list.counts[p.key] })));

  function showNote(tone: Note['tone'], text: string): void {
    note = { id: ++noteSeq, tone, text };
  }

  // D25: a 409 means the list on screen is stale; it catches up behind the
  // dialog, which stays open with the sentence.
  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void load();
      throw err;
    }
  }

  async function saveNew(body: { email: string; full_name: string | null }): Promise<void> {
    const made = await guarded(() => createUser(token, body));
    dialog = null;
    showNote('info', `The account for ${made.email} is created. No email was sent.`);
    void load();
  }

  async function saveEdit(u: PanelUser, body: { full_name?: string | null; email?: string }): Promise<void> {
    await guarded(() => updateUser(token, u.id, body));
    dialog = null;
    note = null;
    void load();
  }

  const askKey = (a: Ask) => `${a.id}-${a.kind}`;

  function cancelAsk(): void {
    const a = ask;
    ask = null;
    if (a) askEls[askKey(a)]?.focus();
  }

  async function confirmAsk(u: PanelUser, kind: Ask['kind']): Promise<void> {
    if (asking) return;
    asking = true;
    try {
      if (kind === 'disable') await disableUser(token, u.id);
      else if (kind === 'enable') await enableUser(token, u.id);
      else await deleteUser(token, u.id);
      note = null;
    } catch (err) {
      const msg = panelError(err, onAuth);
      if (msg) showNote('error', msg);
    } finally {
      asking = false;
      ask = null;
    }
    void load();
  }

  function askText(u: PanelUser, kind: Ask['kind']): string {
    if (kind === 'disable') return disableWarning(u);
    if (kind === 'enable') return `Enable ${personName(u)}? They can sign in again.`;
    return `Delete ${personName(u)}? This can't be undone.`;
  }

</script>

{#snippet newButton()}
  <Button variant="primary" onclick={() => (dialog = { kind: 'new' })}>New account</Button>
{/snippet}

<PanelHead title="Users" actions={newButton} />

{#if note}
  {#key note.id}
    <NoteStrip tone={note.tone} onClose={() => (note = null)}>{note.text}</NoteStrip>
  {/key}
{/if}

<div class="u-tools">
  <FilterPills label="Filter by role" options={pillOptions} value={role} onchange={onPill} />
  <input class="u-search" type="search" bind:value={query} oninput={onSearch}
    placeholder="Search name or email" aria-label="Search name or email" />
</div>

{#if loadError}
  <ErrorState title="Could not load accounts." message={loadError} onretry={() => void load()} retryLabel="Try again" />
{:else if shown === null}
  <Skeleton rows={4} label="Loading accounts…" />
{:else}
  {#if shown.list.users.length > 0}
    {@const now = new Date()}
    <div class="table-scroll">
      <table class="u-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Roles</th>
            <th scope="col">Last active</th>
            <th scope="col"><span class="vh">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each shown.list.users as u (u.id)}
            {@const chips = roleChips(u)}
            {@const who = personName(u)}
            <!-- D14 rev 8: a disabled account's row is greyed; the icons are not. -->
            <tr class={['u-row', u.is_disabled && 'u-disabled']}>
              <td class={['u-name', !u.full_name && 'u-noname']}>{u.full_name ?? '(no name yet)'}{#if u.is_disabled}<span class="vh">{' (disabled)'}</span>{/if}</td>
              <td class="u-email">{u.email}</td>
              <td class="u-roles">
                {#if chips.length === 0}
                  <span class="u-none">—</span>
                {:else}
                  <!-- D14 rev 8: the list is the hover (one per line) and, hidden, the screen reader's. -->
                  <span class="u-chips">
                    {#each chips as chip (chip.kind + chip.text)}
                      <span class={['chip', chip.kind]} title={chip.tip || undefined}
                        ><span class="chip-text">{chip.text}</span
                        >{#if chip.items.length}<span class="vh">: {chip.items.join(', ')}</span>{/if}</span>
                    {/each}
                  </span>
                {/if}
              </td>
              <td class="u-last">{lastActiveText(u.last_seen_at, now)}</td>
              <td class="u-actions">
                <span class="row-icons">
                  <IconButton glyph="pencil" size="sm" title="Edit" aria-label="Edit {who}" data-action="edit"
                    onclick={() => (dialog = { kind: 'edit', user: u })} />
                  {#if !u.is_superuser}
                    {#if u.is_disabled}
                      <IconButton glyph="enable" size="sm" title="Enable" aria-label="Enable {who}" data-action="enable"
                        bind:element={askEls[`${u.id}-enable`]} onclick={() => (ask = { id: u.id, kind: 'enable' })} />
                    {:else}
                      <IconButton glyph="disable" size="sm" title="Disable" aria-label="Disable {who}" data-action="disable"
                        bind:element={askEls[`${u.id}-disable`]} onclick={() => (ask = { id: u.id, kind: 'disable' })} />
                    {/if}
                    <!-- D20: hidden, not greyed, on an account with data; it can only be disabled. -->
                    {#if !u.has_data}
                      <IconButton glyph="trash" size="sm" danger title="Delete" aria-label="Delete {who}" data-action="delete"
                        bind:element={askEls[`${u.id}-delete`]} onclick={() => (ask = { id: u.id, kind: 'delete' })} />
                    {/if}
                  {/if}
                </span>
              </td>
            </tr>
            {#if ask?.id === u.id}
              {@const kind = ask.kind}
              <tr class="u-confirm">
                <td colspan="5">
                  <InlineConfirm row align="end" takeFocus busy={asking} warning={askText(u, kind)}
                    tone={kind === 'enable' ? 'primary' : 'danger'}
                    confirmLabel={kind === 'disable' ? 'Disable' : kind === 'enable' ? 'Enable' : 'Delete'}
                    confirmDataAction="confirm-{kind}"
                    onConfirm={() => void confirmAsk(u, kind)} onCancel={cancelAsk} />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <p class="u-count">{countLine(shown.list, shown.role, shown.q !== '')}</p>
{/if}

{#if dialog?.kind === 'new'}
  <NewAccountDialog {onAuth} onSave={saveNew} onClose={() => (dialog = null)} />
{:else if dialog?.kind === 'edit'}
  {@const u = dialog.user}
  <EditAccountDialog user={u} {onAuth} onSave={(body) => saveEdit(u, body)} onClose={() => (dialog = null)} />
{/if}

<style>
  /* mock-2's tools row: the pills, and the search at the row's end. */
  .u-tools { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; margin: 0 0 12px; }
  /* RunProgressTab's search field. */
  .u-search {
    box-sizing: border-box;
    width: 240px;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
  }
  /* The Courses page's table (the teaching list's look). */
  .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .u-table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .u-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
  }
  .u-table td { padding: 8px 12px; border-top: 1px solid var(--border-soft); font-size: 13px; color: var(--text-2); vertical-align: middle; }
  /* Left in a tight last column, so the pencils and Disable/Enable line up
     whether or not a row has the trash. */
  .u-table td.u-actions { width: 1%; white-space: nowrap; }
  .u-table td.u-name { color: var(--text); font-weight: 500; }
  .u-table td.u-noname { color: var(--muted); font-weight: 400; }
  .u-table td.u-email { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
  .u-table td.u-last { color: var(--muted); white-space: nowrap; }
  /* D14 rev 8: a disabled account's row is greyed: a tinted ground, a muted name
     and grey chips; email and last active are muted already. */
  .u-table tr.u-disabled td { background: var(--disabled-bg); }
  .u-table tr.u-disabled td.u-name { color: var(--muted); font-weight: 400; }
  /* Specific enough (0,4,1) to beat .chip.ad (0,3,0), wherever it sits. */
  .u-table tr.u-disabled .chip { background: var(--state-disabled-bg); color: var(--state-disabled-fg); }
  .u-table tr.u-disabled + tr.u-confirm td { background: var(--disabled-bg); }
  .u-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
  .u-none { color: var(--muted); }
  /* D14's role chips: the "invited" chip's shape; the superuser in the gold
     "you are here" family, an admin in the primary family. */
  .chip {
    display: inline-block;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .chip.su { background: var(--gold-soft); color: var(--gold-text); }
  .chip.ad { background: var(--primary-soft); color: var(--primary); }
  .row-icons { display: inline-flex; gap: 4px; }
  /* RunMiniProjectsTab's confirm row under its row. */
  .u-confirm td { padding: 0 12px 10px; border-top: 0; }
  .u-count { margin: 8px 2px 0; font-size: 12px; color: var(--muted); }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
