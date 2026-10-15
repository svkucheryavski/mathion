<script lang="ts">
  // The quiz body (Slice-5d): a calm overview of compact question cards. Every
  // edit saves itself (D3). One QuizEdits holds the single open edit (D10) and
  // counts requests in flight. ItemBodyApi for ItemEditorModal: save/validate
  // are no-ops (no footer), discard closes the open edit, and `edits` lets the
  // modal's inline title share the slot. Question add / move / delete take the
  // per-quiz lock; a move or delete also holds that question's lock.
  import { onMount, onDestroy, setContext, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import NewQuestionModal from './NewQuestionModal.svelte';
  import { ApiError } from '../../../lib/api';
  import { QuizEdits, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
  import { InPlaceAsk, firstUsable, focusAfter, settleTo, withdraw, type Ask } from '../../../lib/askInPlace.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import {
    listQuestions, createQuestion, deleteQuestion, reorderQuestions,
    type AuthoringQuestion, type QuestionCreateBody,
  } from '../../../lib/quizAuthoring';
  import { loadAdminTree } from '../../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../../stores/toasts.svelte';
  import type { SaveOutcome } from '../../../lib/itemBody';
  import type { AdminTreeVersion } from '../../../lib/types';
  import type { VersionPermissions } from '../../../lib/versionPermissions';
  import type { AssetContext } from '../../../lib/assetContext';

  let {
    itemId, vid, version, perms, assetContext, stillOnVid,
    versionDisabled = false,
    guardDirty = $bindable(false), busy = $bindable(false),
  }: {
    itemId: number; vid: number;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    stillOnVid: (savedVid: number) => boolean;
    versionDisabled?: boolean;
    guardDirty?: boolean; busy?: boolean;
  } = $props();

  // `live` is read only after a request settles, when everything below exists.
  export const edits = new QuizEdits(() => live());
  export async function save(_titleDraft: string | undefined): Promise<SaveOutcome> { return { outcome: 'ok' }; }
  export function validate(): boolean { return true; }
  export function discard(): void { edits.discardAll(); }
  export function discardAll(): void { edits.discardAll(); }

  $effect(() => { guardDirty = edits.dirty; });
  $effect(() => { busy = edits.inFlight; });

  const savedVid = untrack(() => vid);
  let alive = true;
  // Still showing this version (spec §Stale responses: today's `alive && vid === savedVid`).
  const live = () => alive && stillOnVid(savedVid);
  let loadToken = 0;
  // #12: one question for the cards, keyed by question id: another card's
  // trash moves it there (D39). QuestionCard draws it under its head.
  const cardAsk = new InPlaceAsk();
  let askedIds: number[] = [];   // the list when it asked: the nearest card if its own goes
  onDestroy(() => { alive = false; loadToken++; cardAsk.dismiss(); });

  let questions = $state<AuthoringQuestion[]>([]);
  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let quizLock = $state(false);
  let movingId = $state<number | null>(null);
  let deletingId = $state<number | null>(null);   // its trash stays enabled (focus never drops)
  let adding = $state(false);
  let autoAddId = $state<number | null>(null);
  const busyQuestions = new SvelteSet<number>();
  let rootEl = $state<HTMLElement>();
  let retryWrap = $state<HTMLElement>();

  const sorted = (list: AuthoringQuestion[]) => [...list].sort((a, b) => a.order - b.order);
  const isChoice = (x: AuthoringQuestion) => x.type === 'single_choice' || x.type === 'multiple_choice';

  async function load() {
    const my = ++loadToken;
    status = 'loading';
    try {
      const list = await listQuestions(itemId);
      if (my !== loadToken) return;
      questions = sorted(list);
      status = 'loaded';
    } catch {
      if (my !== loadToken) return;
      status = 'error';
    }
  }
  onMount(() => { void load(); });

  async function retry() {
    await load();
    await tick();
    if (!live()) return;
    // The focused Retry unmounted while it reloaded; only a drop to <body> is
    // repaired, never a control the author moved to meanwhile.
    const a = document.activeElement;
    if (a !== null && a !== document.body) return;
    if (status === 'error') retryWrap?.querySelector('button')?.focus();
    else void focusFallback(questions[0]?.id ?? null);
  }

  // After a failed structure write: the server's list, without the loading
  // state, so open cards and their edits stay mounted.
  async function resync() {
    const my = ++loadToken;
    try {
      const list = await listQuestions(itemId);
      if (my === loadToken && live()) questions = sorted(list);
    } catch {
      if (my === loadToken && live()) {
        pushToast("Couldn't reload the questions — reload the page to see the latest.", 'error');
      }
    }
  }

  // On 403/409 the tree reloads so permissions re-derive; when that removed the
  // focused control, focus falls back (R6).
  function failed(e: unknown, qid: number | null = null): string {
    if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(savedVid)) {
      void loadAdminTree(savedVid, { force: true }).then(async () => {
        await tick();
        if (!live()) return;
        const a = document.activeElement;
        if (a === null || a === document.body) void focusFallback(qid);
      });
    }
    return e instanceof ApiError ? e.displayMessage : 'Save failed';
  }

  function fallbackTarget(qid: number | null): HTMLElement | null {
    if (!rootEl) return null;
    const card = qid == null ? null : rootEl.querySelector(`[data-q-id="${qid}"]`);
    return card?.querySelector<HTMLElement>('.qhead button[data-glyph="pencil"]:not([disabled])')
      ?? rootEl.querySelector<HTMLElement>('.q-add button:not([disabled])')
      ?? rootEl.closest('section.modal-panel')?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]')
      ?? null;
  }
  async function focusFallback(qid: number | null) {
    await tick();
    if (live()) fallbackTarget(qid)?.focus();
  }
  // The nearest card still listed after `qid`, else before it, in `ids`' order.
  function nearOf(qid: number, ids: number[]): number | null {
    const i = ids.indexOf(qid);
    const left = (id: number) => questions.some((x) => x.id === id);
    return ids.slice(i + 1).find(left) ?? ids.slice(0, i).reverse().find(left) ?? null;
  }
  // R49: a card leaving the list (a resync, a 404) takes its question, busy or
  // not — the card was its host; focus that was in it goes to the nearest card.
  // The right to delete going (a 403/409 reload) takes an idle one; focus goes
  // to the card's ✎.
  $effect(() => {
    const list = questions;
    const can = perms.canEditStructure && !versionDisabled;
    untrack(() => {
      const k = cardAsk.current?.key;
      if (typeof k !== 'number') return;
      const here = list.some((x) => x.id === k);
      if (here && (can || cardAsk.busy)) return;
      const free = cardAsk.focusFree;
      cardAsk.dismiss();
      if (free) void focusFallback(here ? k : nearOf(k, askedIds));
    });
  });

  // ---- Add ----
  const addReason = $derived(
    status !== 'loaded' ? 'Wait for the questions to load'
      : quizLock || edits.locked ? WAIT_TITLE : null,
  );
  async function openAdd() {
    if (adding || addReason !== null) return;
    if (!(await edits.request())) return;
    // R49: re-checked after the D10 question.
    if (adding || addReason !== null || !live() || !perms.canEditStructure) return;
    adding = true;
  }
  async function closeAdd(refocus: boolean) {
    adding = false;
    if (!refocus) return;
    await tick();
    if (live()) void focusFallback(null);
  }
  async function create(body: QuestionCreateBody) {
    quizLock = true;
    try {
      const created = await edits.track(createQuestion(itemId, body));
      if (!live()) return;
      ++loadToken;   // a resync from an earlier failed create must not overwrite this card
      questions = sorted([...questions, created]);
      autoAddId = isChoice(created) ? created.id : null;
      adding = false;                          // close the modal before moving focus
      if (stillOnVid(savedVid)) void loadAdminTree(savedVid, { force: true });   // questions_count
      edits.say('Saved');
      await tick();
      if (!live()) return;
      const card = rootEl?.querySelector<HTMLElement>(`[data-q-id="${created.id}"]`);
      card?.scrollIntoView?.({ block: 'nearest' });
      // Focus the new card's ✎ now (no gap on <body>); a choice card's
      // "+ Add answer" row takes focus over once its answers load — and if
      // they loaded first, the open row keeps it.
      if (!card?.contains(document.activeElement)) fallbackTarget(created.id)?.focus();
    } catch (e) {
      failed(e);                 // 403/409: the tree reloads
      if (live()) void resync();  // spec: a failed structure write re-fetches the list
      throw e;                   // the modal shows the error inside
    } finally {
      quizLock = false;
    }
  }

  // A re-sync after a failed write can re-insert or remove the focused control,
  // or disable it: then focus has dropped and needs repair (spec §Focus).
  function dropped(): boolean {
    const a = document.activeElement;
    return a === null || a === document.body || (a instanceof HTMLButtonElement && a.disabled);
  }
  // The moved card's arrow for `dir`, else its other arrow, while enabled.
  function arrowTarget(qid: number, dir: -1 | 1): HTMLButtonElement | null {
    const card = rootEl?.querySelector<HTMLElement>(`[data-q-id="${qid}"]`);
    const pick = (g: 'up' | 'down') => card?.querySelector<HTMLButtonElement>(`.qhead button[data-glyph="${g}"]:not([disabled])`) ?? null;
    return pick(dir < 0 ? 'up' : 'down') ?? pick(dir < 0 ? 'down' : 'up');
  }

  // ---- Move: optimistic; the moved card's arrows keep focus ----
  async function move(qid: number, dir: -1 | 1) {
    const at = () => {
      const i = questions.findIndex((x) => x.id === qid);
      const j = i + dir;
      return i < 0 || j < 0 || j >= questions.length ? null : [i, j] as const;
    };
    if (quizLock || busyQuestions.has(qid) || !at()) return;
    if (!(await edits.requestStructure())) return;   // moves follow their locks alone
    // R49: recomputed from the live list after the D10 question.
    const ij = at();
    if (quizLock || busyQuestions.has(qid) || !live() || !ij) return;
    const [i, j] = ij;
    const next = [...questions];
    [next[i], next[j]] = [next[j]!, next[i]!];
    questions = next.map((x, k) => ({ ...x, order: k + 1 }));
    edits.say(`Question moved to position ${j + 1} of ${next.length}`);
    const order = questions.map((x) => ({ id: x.id, order: x.order }));
    quizLock = true;
    busyQuestions.add(qid);
    movingId = qid;
    const done = edits.track(reorderQuestions(itemId, order));
    done.catch(() => {});   // handled by the `await done` below; no unhandled-rejection window
    await tick();
    arrowTarget(qid, dir)?.focus();
    rootEl?.querySelector<HTMLElement>(`[data-q-id="${qid}"]`)?.scrollIntoView?.({ block: 'nearest' });
    try {
      await done;
    } catch (e) {
      pushToast(failed(e, qid), 'error');
      if (live()) {
        await resync();
        await tick();
        // The list is back in the server's order; the card's arrows take focus again.
        if (live() && dropped()) (arrowTarget(qid, dir) ?? fallbackTarget(qid))?.focus();
      }
    } finally {
      busyQuestions.delete(qid);
      if (alive) { quizLock = false; movingId = null; }
    }
  }

  // ---- Delete: asks under the card's head (D14, #12) ----
  async function remove(qid: number) {
    if (quizLock || busyQuestions.has(qid) || !questions.some((x) => x.id === qid)) return;
    if (!(await edits.requestStructure())) return;   // D10 first (#14); deletes follow their locks alone
    let idx = questions.findIndex((x) => x.id === qid);
    if (quizLock || busyQuestions.has(qid) || !live() || idx < 0) return;
    // Inert parse (no image loads), so entities read as characters.
    const plain = new DOMParser().parseFromString(questions[idx]!.text_html, 'text/html').body.textContent ?? '';
    const title = plain.replace(/\s+/g, ' ').trim().slice(0, 80) || `Question ${idx + 1}`;
    const trash = () => rootEl?.querySelector<HTMLElement>(`[data-q-id="${qid}"] .qhead button[data-glyph="trash"]`) ?? null;
    // The trash, or the §Focus fallback while it is disabled or gone (never <body>).
    const back = () => firstUsable(trash(), fallbackTarget(qid));
    const q: Ask = {
      key: qid, warning: `Delete question "${title}"? This cannot be undone.`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', align: 'end', confirmDataAction: 'confirm-delete-question',
    };
    askedIds = questions.map((x) => x.id);
    const a = await cardAsk.ask(q);                 // … then the delete question (#12)
    if (a === 'cancel') { void focusAfter(back); return; }
    if (a !== 'confirm') return;
    // R49: re-checked, and the index recomputed, after the question.
    idx = questions.findIndex((x) => x.id === qid);
    if (quizLock || busyQuestions.has(qid) || !live() || idx < 0 || !perms.canEditStructure) {
      withdraw(cardAsk, q, back);
      return;
    }
    const ids = questions.map((x) => x.id);
    quizLock = true;
    busyQuestions.add(qid);
    deletingId = qid;
    try {
      await edits.track(deleteQuestion(qid));
      if (!live()) return;
      // R54: the card goes, and its question with it, so the question settles
      // first; focus moves on only if it was in the question or on the card
      // that goes (its trash stays enabled while it deletes) (R57).
      const free = cardAsk.focusFree || !!rootEl?.querySelector(`[data-q-id="${qid}"]`)?.contains(document.activeElement);
      if (cardAsk.current === q) cardAsk.settle();
      questions = questions.filter((x) => x.id !== qid);
      if (stillOnVid(savedVid)) void loadAdminTree(savedVid, { force: true });
      if (free) void focusFallback(ids[idx + 1] ?? ids[idx - 1] ?? null);
    } catch (e) {
      pushToast(failed(e, qid), 'error');
      if (live()) {
        await resync();
        await tick();
        // Gone already (deleted elsewhere): the R49 effect took the question and
        // its focus. This repairs only a drop, over the cards left.
        if (live() && dropped()) fallbackTarget(questions.some((x) => x.id === qid) ? qid : nearOf(qid, ids))?.focus();
      }
    } finally {
      busyQuestions.delete(qid);
      if (alive) { quizLock = false; deletingId = null; }
      // A failure keeps the card: back to its trash once enabled (R54).
      await settleTo(cardAsk, q, back);
    }
  }

  setContext<QuizCtx>(QUIZ_CTX, {
    edits,
    get itemId() { return itemId; },
    get assetContext() { return assetContext; },
    get canText() { return perms.canEditTextFields; },
    get canStruct() { return perms.canEditStructure; },
    get published() { return version.state === 'published'; },
    get disabled() { return versionDisabled; },
    busyQuestions,
    get quizLock() { return quizLock; },
    live,
    say: (message) => edits.say(message),
    failed,
    patch(qid, fields) {
      if (live()) questions = questions.map((x) => (x.id === qid ? { ...x, ...fields } : x));
    },
    hasQuestion: (qid) => questions.some((x) => x.id === qid),
    focusFallback: (qid) => { void focusFallback(qid); },
    fallbackTarget,
  });
</script>

<section class="quiz-body" aria-label="Questions" bind:this={rootEl}>
  <div class="quiz-head">
    <span class="quiz-label">Questions</span>
    {#if status === 'loaded'}<span class="mono quiz-count">{questions.length}</span>{/if}
    {#if perms.canEditStructure}
      <!-- 5c D9 exception: in the quiz overview, adding a question is the main action. -->
      <span class="q-add">
        <Button variant="primary" disabled={addReason !== null} title={addReason ?? undefined} onclick={() => void openAdd()}>+ Add question</Button>
      </span>
    {/if}
  </div>

  {#if status === 'loading'}
    <Skeleton rows={3} label="Loading questions" />
  {:else if status === 'error'}
    <div class="quiz-error" bind:this={retryWrap}>
      <p>Couldn't load the questions</p>
      <Button variant="secondary" onclick={() => void retry()}>Retry</Button>
    </div>
  {:else if questions.length === 0}
    <p class="quiz-empty">No questions yet.</p>
  {:else}
    <!-- WebKit drops the list role under list-style:none; restate it. -->
    <!-- svelte-ignore a11y_no_redundant_roles -->
    <ol class="quiz-list" role="list">
      {#each questions as q, i (q.id)}
        <QuestionCard
          {q}
          n={i + 1}
          count={questions.length}
          moving={movingId === q.id}
          deleting={deletingId === q.id}
          autoAdd={autoAddId === q.id}
          onAutoAddDone={() => { autoAddId = null; }}
          ask={cardAsk}
          onMove={(d) => void move(q.id, d)}
          onDelete={() => void remove(q.id)}
        />
      {/each}
    </ol>
  {/if}

  <p class="sr-only" aria-live="polite" data-testid="quiz-live">{edits.message}</p>

  {#if adding}<NewQuestionModal onCreate={create} onClose={(r) => void closeAdd(r)} />{/if}
</section>

<style>
  .quiz-body { display: flex; flex-direction: column; gap: 12px; }
  .quiz-head { display: flex; align-items: center; gap: 10px; }
  .quiz-label { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .quiz-count { font-size: 11.5px; color: var(--muted); }
  .q-add { margin-left: auto; }
  .quiz-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .quiz-empty { margin: 0; font-size: 13px; color: var(--muted); }
  .quiz-error { display: flex; align-items: center; gap: 10px; }
  .quiz-error p { margin: 0; font-size: 13px; color: var(--muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
