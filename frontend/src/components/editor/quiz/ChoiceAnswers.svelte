<script lang="ts">
  // A choice question's answers (spec §Answers): load / Retry, the marker, the
  // inline text edit, + Add answer, move and delete. Every write takes the
  // per-question lock (ctx.busyQuestions). The control that started a write
  // stays enabled with re-entry blocked here, so focus never drops.
  import { getContext, onDestroy, onMount, tick, untrack } from 'svelte';
  import Button from '../../ui/Button.svelte';
  import AskSlot from '../../ui/AskSlot.svelte';
  import ChoiceRow from './ChoiceRow.svelte';
  import InlineInput from './InlineInput.svelte';
  import { keyAsk } from './KeyQuestion.svelte';
  import { ApiError } from '../../../lib/api';
  import { InPlaceAsk, focusAfter, settleTo, withdraw } from '../../../lib/askInPlace.svelte';
  import { InlineEdit, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { pushToast } from '../../../stores/toasts.svelte';
  import {
    listOptions, createOption, updateOption, deleteOption, reorderOptions,
    type AuthoringOption, type AuthoringQuestion,
  } from '../../../lib/quizAuthoring';

  let { q, n, options = $bindable(null), autoAdd = false, onAutoAddDone = () => {} }: {
    q: AuthoringQuestion; n: number; options?: AuthoringOption[] | null;
    // A just-created question: open "+ Add answer" once loaded (spec §Adding, step 5).
    autoAdd?: boolean; onAutoAddDone?: () => void;
  } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);

  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let op = $state<string | null>(null);         // this component's write in flight
  let editId = $state<number | null>(null);
  let textEdit = $state<InlineEdit<string> | null>(null);
  let addEdit = $state<InlineEdit<string> | null>(null);
  let listEl = $state<HTMLElement>();
  let noteEl = $state<HTMLElement>();
  let addWrap = $state<HTMLElement>();
  let mounted = true;
  // Mounted AND still showing this version (spec §Stale responses).
  const alive = () => mounted && ctx.live();
  const cardEl = () => listEl?.closest('li.qcard') ?? null;
  let token = 0;
  // #2: a published key asks under the list (R52). One place: a second marker
  // while it asks brings the open question back (R53).
  const markAsk = new InPlaceAsk();
  let markingId: number | null = null;   // the answer the open question is about
  onDestroy(() => { mounted = false; token++; markAsk.dismiss(); });
  // R49: the answer it asks about left the list (a reload): the question goes,
  // unless busy (its own write settles it).
  $effect(() => {
    const list = options;
    untrack(() => {
      if (!markAsk.open || markAsk.busy || (list ?? []).some((x) => x.id === markingId)) return;
      const free = markAsk.focusFree;
      markAsk.dismiss();
      if (free) void tick().then(() => { if (alive()) ctx.focusFallback(q.id); });
    });
  });

  const multiple = $derived(q.type === 'multiple_choice');
  const correctCount = $derived((options ?? []).filter((o) => o.is_correct).length);
  const held = $derived(ctx.busyQuestions.has(q.id));   // someone holds this question
  const sortByOrder = (list: AuthoringOption[]) => [...list].sort((a, b) => a.order - b.order);

  async function load() {
    const my = ++token;
    status = 'loading';
    try {
      const list = await listOptions(q.id);
      if (my !== token) return;
      options = sortByOrder(list);
      status = 'loaded';
      if (autoAdd) {
        onAutoAddDone();
        await tick();
        // Only if the author has not moved on meanwhile: no other edit open,
        // focus still on this card (its ✎) or dropped.
        const a = document.activeElement;
        const mine = a === null || a === document.body || (cardEl()?.contains(a) ?? false);
        if (alive() && ctx.edits.active === null && mine) void openAdd();
      }
    } catch {
      if (my !== token) return;
      status = 'error';
      if (autoAdd) { onAutoAddDone(); ctx.focusFallback(q.id); }
    }
  }
  onMount(() => { void load(); });

  async function retry() {
    await load();
    await tick();
    if (!alive()) return;
    // As QuizBody.retry: repair only a drop to <body> (the Retry unmounted).
    const a = document.activeElement;
    if (a !== null && a !== document.body) return;
    if (status === 'error') noteEl?.querySelector('button')?.focus();
    else ctx.focusFallback(q.id);
  }

  // After a failed write: the server's truth, without the loading state (an
  // open field stays mounted). Skipped when the question itself is gone.
  async function reload() {
    if (!alive() || !ctx.hasQuestion(q.id)) return;
    const my = ++token;
    let list: AuthoringOption[];
    try {
      list = await listOptions(q.id);
    } catch { return; /* keep what is shown; the failure was already reported */ }
    if (my !== token || !alive()) return;
    const a = document.activeElement;
    options = sortByOrder(list);
    // An answer deleted elsewhere takes its open field with it.
    if (editId !== null && !list.some((x) => x.id === editId)) { editId = null; textEdit = null; }
    // Re-ordered rows re-insert the focused control, and a removed row takes it
    // away: never leave focus on <body> (spec §Focus, Fallback).
    await tick();
    if (!alive() || document.activeElement !== document.body) return;
    if (a instanceof HTMLButtonElement && a.isConnected && !a.disabled && listEl?.contains(a)) a.focus();
    else ctx.focusFallback(q.id);
  }

  // One answer write at a time per question. `key` names the starting control.
  async function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
    ctx.busyQuestions.add(q.id);
    op = key;
    try {
      return await ctx.edits.track(run());
    } catch (e) {
      ctx.failed(e, q.id);    // 403/409: the tree reloads, so permissions re-derive
      // Awaited while the lock is still held: a retry cannot succeed before this
      // older snapshot lands and be overwritten by it.
      await reload();
      throw e;
    } finally {
      ctx.busyQuestions.delete(q.id);
      if (mounted) op = null;   // mounted, not alive(): the lock state must always reset
    }
  }
  // An action without a field reports its failure as a toast — always, even
  // after the modal closed (spec §Stale responses).
  async function act<T>(key: string, run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await locked(key, run);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
      return undefined;
    }
  }

  // ---- Disabling reasons (null = enabled). ----
  const busyFor = (key: string) => (held && op !== key ? WAIT_TITLE : null);
  const canDelete = (o: AuthoringOption) =>
    (options ?? []).length === 1 || !(o.is_correct && correctCount === 1);
  function markReason(o: AuthoringOption): string | null {
    if (ctx.edits.locked) return WAIT_TITLE;
    return busyFor(`mark:${o.id}`)
      ?? (multiple && o.is_correct && correctCount === 1 ? 'At least one answer must stay correct' : null);
  }
  const textReason = () => (ctx.edits.locked ? WAIT_TITLE : busyFor('-'));
  const upReason = (o: AuthoringOption, i: number) => busyFor(`move:${o.id}`) ?? (i === 0 ? 'Move up — already first' : null);
  const downReason = (o: AuthoringOption, i: number) =>
    busyFor(`move:${o.id}`) ?? (i === (options ?? []).length - 1 ? 'Move down — already last' : null);
  const deleteReason = (o: AuthoringOption) =>
    busyFor(`delete:${o.id}`) ?? (canDelete(o) ? null : 'Mark another answer correct first');
  const addReason = $derived(ctx.edits.locked ? WAIT_TITLE : busyFor('add'));

  // ---- Focus helpers ----
  const rowEl = (id: number) => listEl?.querySelector<HTMLElement>(`li.ans-row[data-a-id="${id}"]`) ?? null;
  const addBtn = () => addWrap?.querySelector<HTMLButtonElement>('button.ans-add-btn') ?? null;
  const markerEl = (id: number) => rowEl(id)?.querySelector<HTMLButtonElement>('button.ans-mark') ?? null;
  const trashEl = (id: number) => rowEl(id)?.querySelector<HTMLButtonElement>('button[data-glyph="trash"]') ?? null;
  // Back to the opener, or the §Focus fallback when it is gone or disabled.
  async function focusText(id: number) {
    await tick();
    if (!alive()) return;
    const el = rowEl(id)?.querySelector<HTMLButtonElement>('button.ans-edit');
    if (el && !el.disabled) el.focus();
    else ctx.focusFallback(q.id);
  }
  async function focusAdd() {
    await tick();
    if (!alive()) return;
    const b = addBtn();
    if (b && !b.disabled) b.focus();
    else ctx.focusFallback(q.id);
  }

  // ---- The marker ----
  // It may act: nothing running here, enabled, and it would change the key.
  // Re-run after every question against the live list (R49).
  function markable(id: number): boolean {
    const cur = (options ?? []).find((x) => x.id === id);
    if (!cur || !alive() || !ctx.canText || op !== null || markReason(cur) !== null) return false;
    const others = (options ?? []).some((x) => x.is_correct && x.id !== id);
    return multiple || !cur.is_correct || others;   // single choice: already the one correct answer
  }
  async function setCorrect(id: number) {
    const cur = (options ?? []).find((x) => x.id === id);
    if (!cur) return;
    const next = multiple ? !cur.is_correct : true;
    const echo = await act(`mark:${id}`, () => updateOption(id, { is_correct: next }));
    if (!echo || !alive()) return;
    // Only is_correct is written back; single choice clears the others (D12).
    options = (options ?? []).map((x) =>
      x.id === id ? { ...x, is_correct: echo.is_correct }
        : !multiple && echo.is_correct ? { ...x, is_correct: false } : x);
    ctx.say('Saved');
  }
  async function mark(o: AuthoringOption) {
    if (!markable(o.id)) return;
    if (!(await ctx.edits.request())) return;                 // D10 first (#14) …
    if (!markable(o.id)) return;
    const marker = () => markerEl(o.id);
    if (!ctx.published) {
      // After a D10 Discard the question took focus with it: the marker, not <body>.
      await focusAfter(marker);
      await setCorrect(o.id);
      return;
    }
    if (markAsk.open) { markAsk.focusCancel(); return; }    // R53: one question here
    markingId = o.id;
    const q = keyAsk();
    const a = await markAsk.ask(q);                          // … then the key question (#2)
    if (a === 'cancel') { void focusAfter(marker); return; }
    if (a !== 'confirm') return;
    if (!markable(o.id)) { withdraw(markAsk, q, marker); return; }
    try {
      await setCorrect(o.id);
    } finally {
      await settleTo(markAsk, q, marker);
    }
  }

  // ---- The inline text edit ----
  async function openEdit(o: AuthoringOption) {
    if (editId === o.id || textReason() !== null) return;
    if (!(await ctx.edits.request())) return;
    // R49: re-checked after the D10 question.
    if (editId === o.id || textReason() !== null || !alive() || !ctx.canText) return;
    if (!(options ?? []).some((x) => x.id === o.id)) return;
    editId = o.id;
    textEdit = new InlineEdit<string>({
      id: `answer-${o.id}`,
      edits: ctx.edits,
      initial: o.text,
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Enter the answer text' : null),
      allowed: () => ctx.canText,
      send: async (v) => {
        const echo = await locked(`text:${o.id}`, () => updateOption(o.id, { text: v.trim() }));
        if (alive()) options = (options ?? []).map((x) => (x.id === o.id ? { ...x, text: echo.text } : x));
      },
      close: (refocus) => {
        editId = null;
        textEdit = null;
        if (refocus) void focusText(o.id);
      },
    });
  }

  // ---- + Add answer: the row stays open for the next one ----
  async function openAdd() {
    if (addEdit || addReason !== null) return;
    if (!(await ctx.edits.request())) return;
    // R49: re-checked after the D10 question.
    if (addEdit || addReason !== null || !alive() || !ctx.canStruct) return;
    addEdit = new InlineEdit<string>({
      id: `add-${q.id}`,
      edits: ctx.edits,
      initial: '',
      same: (a, b) => a.trim() === b.trim(),     // empty = unchanged: Enter closes the row
      check: () => null,
      allowed: () => ctx.canStruct,
      send: async (v) => {
        const first = !multiple && (options ?? []).length === 0;   // D14
        const created = await locked('add', () => createOption(q.id, { text: v.trim(), is_correct: first }));
        if (!alive()) return;
        options = [...(options ?? []), created];
        void tick().then(() => addWrap?.querySelector<HTMLInputElement>('input')?.focus());
      },
      after: 'reset',
      close: (refocus) => {
        addEdit = null;
        if (refocus) void focusAdd();
      },
    });
  }

  // ---- Move: optimistic; the moved row's arrows keep focus ----
  async function move(o: AuthoringOption, dir: -1 | 1) {
    const at = () => {
      const i = (options ?? []).findIndex((x) => x.id === o.id);
      const j = i + dir;
      return i < 0 || j < 0 || j >= (options ?? []).length ? null : [i, j] as const;
    };
    if (op !== null || held || !at()) return;
    if (!(await ctx.edits.requestStructure())) return;   // moves follow their locks alone
    // R49: recomputed from the live list after the D10 question.
    const ij = at();
    if (op !== null || held || !alive() || !ij) return;
    const [i, j] = ij;
    const cur = options ?? [];
    const next = [...cur];
    [next[i], next[j]] = [next[j]!, next[i]!];
    options = next.map((x, k) => ({ ...x, order: k + 1 }));
    ctx.say(`Answer moved to position ${j + 1} of ${next.length}`);
    const order = options.map((x) => ({ id: x.id, order: x.order }));
    const done = act(`move:${o.id}`, () => reorderOptions(q.id, order));
    await tick();
    const row = rowEl(o.id);
    const same = row?.querySelector<HTMLButtonElement>(`button[data-glyph="${dir < 0 ? 'up' : 'down'}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`button[data-glyph="${dir < 0 ? 'down' : 'up'}"]`);
    (same && !same.disabled ? same : other)?.focus();
    row?.scrollIntoView?.({ block: 'nearest' });
    await done;
  }

  // ---- Delete: no confirmation (D14) ----
  async function remove(o: AuthoringOption) {
    if (op !== null || deleteReason(o) !== null) return;
    if (!(await ctx.edits.requestStructure())) return;   // deletes follow their locks alone
    // R49: re-checked after the D10 question.
    const cur = (options ?? []).find((x) => x.id === o.id);
    if (!cur || op !== null || deleteReason(cur) !== null || !alive()) return;
    // After a D10 Discard the question took focus with it: the trash, not <body>.
    await focusAfter(() => trashEl(o.id));
    const ids = (options ?? []).map((x) => x.id);
    const idx = ids.indexOf(o.id);
    const ok = await act(`delete:${o.id}`, async () => { await deleteOption(o.id); return true; });
    if (!ok || !alive()) return;
    options = (options ?? []).filter((x) => x.id !== o.id);
    await tick();
    const nextId = ids[idx + 1] ?? ids[idx - 1];
    const target = (nextId == null ? null : rowEl(nextId)?.querySelector<HTMLButtonElement>('button.ans-edit')) ?? addBtn();
    // Either may wait for another save (a title in flight): then §Focus fallback.
    if (target && !target.disabled) target.focus();
    else ctx.focusFallback(q.id);
  }
</script>

{#if status === 'loading'}
  <p class="ans-note">Loading answers…</p>
{:else if status === 'error'}
  <p class="ans-note" bind:this={noteEl}>Couldn't load answers <Button variant="ghost" onclick={() => void retry()}>Retry</Button></p>
{:else if options}
  <!-- svelte-ignore a11y_no_redundant_roles -->
  <ul class="ans-list" role="list" aria-label={`Answers to question ${n}`} bind:this={listEl}>
    {#each options as o, i (o.id)}
      <ChoiceRow
        opt={o}
        {multiple}
        edit={editId === o.id ? textEdit : null}
        canText={ctx.canText}
        canStruct={ctx.canStruct}
        markReason={markReason(o)}
        textReason={textReason()}
        upReason={upReason(o, i)}
        downReason={downReason(o, i)}
        deleteReason={deleteReason(o)}
        onMark={() => void mark(o)}
        onEdit={() => void openEdit(o)}
        onMove={(d) => void move(o, d)}
        onDelete={() => void remove(o)}
      />
    {/each}
  </ul>
  {#if markAsk.open}
    <!-- #2: the key question, under the list (R52). -->
    <div class="ans-ask"><AskSlot ask={markAsk} /></div>
  {/if}
  <!-- An open add row stays mounted even if a 403/409 reload removes the right to add. -->
  {#if ctx.canStruct || addEdit}
    <div class="ans-add" bind:this={addWrap}>
      {#if addEdit}
        <InlineInput edit={addEdit} label={`New answer for question ${n}`} saveTitle="Add answer" />
      {:else}
        <button type="button" class="ans-add-btn" aria-label={`Add answer to question ${n}`}
                title={addReason ?? 'Add answer'} disabled={addReason !== null} onclick={() => void openAdd()}>+ Add answer</button>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .ans-note { margin: 0; font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .ans-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .ans-add { margin-top: 4px; padding-left: 8px; display: flex; }
  .ans-add-btn { border: 0; padding: 2px 0; background: transparent; font: inherit; font-size: 12.5px; color: var(--primary); cursor: pointer; }
  .ans-add-btn:disabled { color: var(--faint); cursor: default; }
  .ans-add-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  /* Lines up with "+ Add answer" under the list. */
  .ans-ask { margin-top: 4px; padding-left: 8px; }
</style>
