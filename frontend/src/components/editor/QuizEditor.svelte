<script lang="ts">
  // The quiz body (Slice-5b §5): implements ItemBodyApi (lib/itemBody.ts) for
  // ItemEditorModal. Each QuestionAccordion owns its drafts and registers a
  // save contributor (QUIZ_SAVE_KEY). The footer Save validates the dirty ones
  // and sends them in display order after the title (§5.3). Structure (add /
  // delete / reorder of questions) acts immediately.
  import { onMount, onDestroy, setContext, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../lib/itemBody';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import QuestionAccordion from './QuestionAccordion.svelte';
  import QuestionTypePicker from './QuestionTypePicker.svelte';
  import {
    listQuestions, createQuestion, deleteQuestion, reorderQuestions,
    validateNumericAnswer,
    type AuthoringQuestion, type QuestionType, type QuestionCreateBody,
  } from '../../lib/quizAuthoring';

  let {
    itemId, vid, version, perms, assetContext, stillOnVid,
    versionDisabled = false, frozen = false,
    saveDirty = $bindable(false), guardDirty = $bindable(false), busy = $bindable(false),
  }: {
    itemId: number; vid: number;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    stillOnVid: (savedVid: number) => boolean;
    // D6: question editors show plain source, with no /render call.
    versionDisabled?: boolean;
    // D10/D9: a Save or an item delete is in flight.
    frozen?: boolean;
    saveDirty?: boolean; guardDirty?: boolean; busy?: boolean;
  } = $props();

  // ---- Save drafts (§5.1). This private registry shadows the page's, so the
  //      modal's ONE page tracker covers the quiz. Each accordion registers one
  //      tracker here and one save contributor on the hub. ----
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  const contributors = new SvelteSet<QuizContributor>();
  const hub: QuizSaveHub = {
    register(c) { contributors.add(c); },
    unregister(c) { contributors.delete(c); },
  };
  setContext(QUIZ_SAVE_KEY, hub);
  const ordered = () => [...contributors].sort((a, b) => a.order() - b.order());

  const KEY_CONFIRM =
    'This quiz is published. Changing the answer key does not re-score students who already ' +
    'attempted — their recorded scores keep the old key. To re-grade everyone, create a new ' +
    'version instead. Continue?';

  // ---- Lifecycle guard (§4.1a) ----
  let alive = true;
  let loadToken = 0;
  onDestroy(() => { alive = false; loadToken++; });

  // ---- Question list (authoritative; metadata + order) ----
  let questions = $state<AuthoringQuestion[]>([]);
  let loadStatus = $state<'loading' | 'loaded' | 'error'>('loading');
  let loadError = $state<string | null>(null);
  let expandedId = $state<number | null>(null);
  let questionsLocked = $state(false); // serialize add/delete/reorder (§7.2)
  let questionAnnounce = $state('');

  // ---- The §2 body contract's bindables ----
  $effect(() => { saveDirty = registry.isAnyDirty(); });
  // T5b adds the typed add-question / add-option forms here (QUIZ_GUARD_KEY).
  $effect(() => { guardDirty = registry.isAnyDirty(); });
  $effect(() => { busy = questionsLocked || [...contributors].some((c) => c.locked()); });

  async function load() {
    loadToken += 1;
    const myToken = loadToken;
    loadStatus = 'loading';
    loadError = null;
    try {
      const list = await listQuestions(itemId);
      if (myToken !== loadToken) return;
      questions = [...list].sort((a, b) => a.order - b.order);
      loadStatus = 'loaded';
    } catch (e) {
      if (myToken !== loadToken) return;
      loadError = e instanceof ApiError ? e.displayMessage : 'Could not load questions.';
      loadStatus = 'error';
    }
  }
  onMount(() => { void load(); });

  // ---- ItemBodyApi ----

  // D10: every contributor validates (so each invalid question shows its
  // errors); a clean one always passes. The first invalid question is
  // expanded and its first invalid field focused.
  export function validate(): boolean {
    const bad = ordered().filter((c) => !c.validate());
    if (bad.length === 0) return true;
    bad[0].focusFirstInvalid();
    expandedId = bad[0].questionId;
    return false;
  }

  export function discard(): void { registry.discardAll(); }
  export function discardAll(): void { discard(); }

  // §5.3: one D20 confirm, then the title, then the dirty questions in display
  // order. Stops at the first failure; 'partial' when anything had landed.
  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    const savedVid = vid;
    const dirtyOnes = ordered().filter((c) => c.isDirty);
    if (version.state === 'published' && dirtyOnes.some((c) => c.keyChanged()) && !confirm(KEY_CONFIRM)) {
      return { outcome: 'failed' };
    }
    let savedTitle: string | undefined;
    let progressed = false;
    if (titleDraft !== undefined) {
      try {
        savedTitle = (await patchItem(itemId, { title: titleDraft })).title;
        progressed = true;
      } catch (e) {
        reportSaveFailure(e, savedVid, stillOnVid);
        return { outcome: 'failed' };
      }
    }
    for (const c of dirtyOnes) {
      if (!alive) return { outcome: progressed ? 'partial' : 'failed', savedTitle };
      const r = await c.save();
      if (r === 'ok') { progressed = true; continue; }
      if (r === 'partial') progressed = true;
      if (alive && stillOnVid(savedVid)) {
        const n = questions.findIndex((x) => x.id === c.questionId) + 1;
        pushToast(`Question ${n}: ${c.lastError ?? 'Save failed'} — Save again to send the rest.`, 'error');
        expandedId = c.questionId;
      }
      return { outcome: progressed ? 'partial' : 'failed', savedTitle };
    }
    return { outcome: 'ok', savedTitle };
  }

  // ---- Add-question form: collects the per-type CORRECT ANSWER at creation,
  //      because the backend does NOT validate correctness on create
  //      (questions.py:116 validates only on update; §3.6/§8). Fabricated
  //      defaults are NOT acceptable — they ship a wrong-but-valid-looking key. ----
  let adding = $state(false);
  let newType = $state<QuestionType>('single_choice');
  let newText = $state('');
  let newNumeric = $state('');     // numeric_answer: raw string, validated via §8.3
  let newPrecision = $state(0);    // numeric_answer: integer 0–10
  let newAnswer = $state('');      // text_answer: 1–500 chars
  let addError = $state<string | null>(null);

  const newNumericCheck = $derived(
    newType === 'numeric_answer' ? validateNumericAnswer(newNumeric) : { ok: true as const, canonical: '' },
  );
  const newNumericError = $derived(newNumericCheck.ok ? null : newNumericCheck.reason);
  const newPrecisionValid = $derived(
    Number.isInteger(newPrecision) && newPrecision >= 0 && newPrecision <= 10,
  );
  const addValid = $derived(
    newText.trim() !== '' && (
      newType === 'numeric_answer' ? (newNumericCheck.ok && newPrecisionValid)
        : newType === 'text_answer' ? (newAnswer.trim().length >= 1 && newAnswer.length <= 500)
          : true   // choice types: options (hence correctness) are added afterwards
    ),
  );

  function resetAddForm() {
    newText = ''; newNumeric = ''; newPrecision = 0; newAnswer = ''; addError = null;
  }

  function buildCreateBody(): QuestionCreateBody {
    const base = { text_md: newText.trim(), type: newType };
    if (newType === 'numeric_answer' && newNumericCheck.ok) {
      return { ...base, correct_numeric: Number(newNumericCheck.canonical), precision: newPrecision };
    }
    if (newType === 'text_answer') return { ...base, correct_text: newAnswer.trim() };
    return base;  // single_choice / multiple_choice — options are added afterwards
  }

  async function submitAdd() {
    if (questionsLocked || frozen || !perms.canEditStructure || !addValid) return;
    const savedVid = vid;
    const body = buildCreateBody();
    addError = null;
    questionsLocked = true;
    try {
      const created = await createQuestion(itemId, body);
      if (!(alive && vid === savedVid)) return;
      questions = [...questions, created].sort((a, b) => a.order - b.order);
      adding = false; resetAddForm();
      expandedId = created.id;                        // open the new question for editing
      await loadAdminTree(savedVid, { force: true }); // refresh questions_count
    } catch (e) {
      if (alive && vid === savedVid) {
        addError = e instanceof ApiError ? e.displayMessage : 'Add failed';
        if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
          await load();
          if (alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
        }
      }
    } finally { if (alive) questionsLocked = false; }
  }

  // ---- Delete question ----
  async function removeQuestion(qid: number) {
    if (questionsLocked || frozen || !perms.canEditStructure) return;
    if (!questions.some((x) => x.id === qid)) return;
    if (!confirm('Delete this question? Its options and text are lost.')) return;
    const savedVid = vid;
    const idx = questions.findIndex((x) => x.id === qid);
    questionsLocked = true;
    try {
      await deleteQuestion(qid);
      if (!(alive && vid === savedVid)) return;
      questions = questions.filter((x) => x.id !== qid);
      if (expandedId === qid) expandedId = null;
      const focusId = questions[Math.min(idx, questions.length - 1)]?.id;
      await loadAdminTree(savedVid, { force: true });
      await tick();
      if (alive && vid === savedVid && focusId != null) {
        document.querySelector<HTMLElement>(`[data-q-id="${focusId}"] [data-testid="question-header"] button[aria-expanded]`)?.focus();
      }
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
        await load();
        if (e instanceof ApiError && (e.status === 403 || e.status === 409) && alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  // ---- Reorder question (↑/↓): optimistic local swap, POST the full id-set ----
  async function move(qid: number, dir: -1 | 1) {
    if (questionsLocked || frozen || !perms.canEditStructure) return;
    const idx = questions.findIndex((x) => x.id === qid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= questions.length) return;
    const savedVid = vid;
    const next = [...questions];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    questions = next.map((x, i) => ({ ...x, order: i + 1 }));
    const newIndex = questions.findIndex((x) => x.id === qid) + 1;
    questionAnnounce = `Question moved to position ${newIndex} of ${questions.length}`;
    const order = questions.map((x) => ({ id: x.id, order: x.order }));
    questionsLocked = true;
    try {
      await reorderQuestions(itemId, order);
      // success: the optimistic state is authoritative; order is not shown in
      // the admin tree, so no forced reload is needed.
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
        await load();
        if (e instanceof ApiError && (e.status === 403 || e.status === 409) && alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  function toggleExpand(qid: number) { expandedId = expandedId === qid ? null : qid; }
  const structureOff = $derived(!perms.canEditStructure);
  const readOnlyAll = $derived(!perms.canEditTextFields && !perms.canEditStructure);  // archived/disabled (§9)
</script>

<section class="quiz-editor" aria-label="Quiz editor">
  {#if readOnlyAll}<p class="muted" data-testid="quiz-readonly">This version is read-only — editing is disabled.</p>{/if}

  {#if loadStatus === 'loading'}
    <p class="muted">Loading questions…</p>
  {:else if loadStatus === 'error'}
    <p class="err" role="alert">{loadError}</p>
    <Button variant="ghost" onclick={() => void load()}>Retry</Button>
  {:else}
    {#if questions.length === 0}
      <p class="muted">No questions yet.</p>
    {:else}
      <p class="sr-only" aria-live="polite" data-testid="question-live">{questionAnnounce}</p>
      <ol class="questions">
        {#each questions as q, i (q.id)}
          <li data-q-id={q.id}>
            <QuestionAccordion
              question={q}
              {vid}
              index={i + 1}
              count={questions.length}
              {perms}
              {assetContext}
              {versionDisabled}
              {frozen}
              locked={questionsLocked}
              expanded={expandedId === q.id}
              onExpandToggle={() => toggleExpand(q.id)}
              onDelete={() => void removeQuestion(q.id)}
              onMoveUp={() => void move(q.id, -1)}
              onMoveDown={() => void move(q.id, 1)}
            />
          </li>
        {/each}
      </ol>
    {/if}

    {#if !structureOff}
      {#if adding}
        <div class="add-form">
          <QuestionTypePicker bind:value={newType} disabled={questionsLocked || frozen} />
          <label>Question text
            <input data-testid="new-question-text" bind:value={newText} required />
          </label>
          {#if newType === 'numeric_answer'}
            <label>Correct value
              <input data-testid="new-numeric" bind:value={newNumeric} aria-invalid={!newNumericCheck.ok} />
            </label>
            <label>Precision (0–10)
              <input data-testid="new-precision" type="number" min="0" max="10" bind:value={newPrecision} />
            </label>
            {#if newNumericError}<p class="err" role="alert">{newNumericError}</p>{/if}
            {#if !newPrecisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
          {:else if newType === 'text_answer'}
            <label>Correct answer
              <input data-testid="new-text-answer" bind:value={newAnswer} maxlength="500" />
            </label>
          {:else}
            <p class="muted">Add the answer options after creating the question.</p>
          {/if}
          {#if addError}<p class="err" role="alert">{addError}</p>{/if}
          <Button onclick={() => void submitAdd()} disabled={questionsLocked || frozen || !addValid}>Add</Button>
          <Button variant="ghost" onclick={() => { adding = false; resetAddForm(); }}>Cancel</Button>
        </div>
      {:else}
        <Button aria-label="Add question" onclick={() => { adding = true; }} disabled={questionsLocked || frozen}>＋ Add question</Button>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: var(--space-3); }
  .questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .muted { color: var(--muted); }
  .err { color: var(--danger); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
