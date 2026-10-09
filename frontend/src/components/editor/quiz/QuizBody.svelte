<script lang="ts">
  // The quiz body (Slice-5d): a calm overview of compact question cards. Every
  // edit saves itself (D3). One QuizEdits holds the single open edit (D10) and
  // counts requests in flight. ItemBodyApi for ItemEditorModal: save/validate
  // are no-ops (no footer), discard closes the open edit, and `edits` lets the
  // modal's inline title share the slot.
  import { onMount, onDestroy, setContext, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import { ApiError } from '../../../lib/api';
  import { QuizEdits } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { listQuestions, type AuthoringQuestion } from '../../../lib/quizAuthoring';
  import { loadAdminTree } from '../../../stores/currentEditorVersion.svelte';
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
  onDestroy(() => { alive = false; loadToken++; });

  let questions = $state<AuthoringQuestion[]>([]);
  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let quizLock = $state(false);
  const busyQuestions = new SvelteSet<number>();
  let rootEl = $state<HTMLElement>();
  let retryWrap = $state<HTMLElement>();

  const sorted = (list: AuthoringQuestion[]) => [...list].sort((a, b) => a.order - b.order);

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

  async function focusFallback(qid: number | null) {
    await tick();
    if (!live() || !rootEl) return;
    const card = qid == null ? null : rootEl.querySelector(`[data-q-id="${qid}"]`);
    const target =
      card?.querySelector<HTMLElement>('.qhead button[data-glyph="pencil"]:not([disabled])')
      ?? rootEl.querySelector<HTMLElement>('.q-add button:not([disabled])')
      ?? rootEl.closest('section.modal-panel')?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]');
    target?.focus();
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
    failed(e, qid = null) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(savedVid)) {
        void loadAdminTree(savedVid, { force: true }).then(async () => {
          await tick();
          if (!live()) return;
          const a = document.activeElement;
          if (a === null || a === document.body) void focusFallback(qid);
        });
      }
      return e instanceof ApiError ? e.displayMessage : 'Save failed';
    },
    patch(qid, fields) {
      if (live()) questions = questions.map((x) => (x.id === qid ? { ...x, ...fields } : x));
    },
    hasQuestion: (qid) => questions.some((x) => x.id === qid),
    focusFallback: (qid) => { void focusFallback(qid); },
  });
</script>

<section class="quiz-body" aria-label="Questions" bind:this={rootEl}>
  <div class="quiz-head">
    <span class="quiz-label">Questions</span>
    {#if status === 'loaded'}<span class="mono quiz-count">{questions.length}</span>{/if}
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
        <QuestionCard {q} n={i + 1} />
      {/each}
    </ol>
  {/if}

  <p class="sr-only" aria-live="polite" data-testid="quiz-live">{edits.message}</p>
</section>

<style>
  .quiz-body { display: flex; flex-direction: column; gap: 12px; }
  .quiz-head { display: flex; align-items: center; gap: 10px; }
  .quiz-label { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .quiz-count { font-size: 11.5px; color: var(--muted); }
  .quiz-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .quiz-empty { margin: 0; font-size: 13px; color: var(--muted); }
  .quiz-error { display: flex; align-items: center; gap: 10px; }
  .quiz-error p { margin: 0; font-size: 13px; color: var(--muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
