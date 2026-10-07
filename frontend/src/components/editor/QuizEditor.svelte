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
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_GUARD_KEY, QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
  import { structureReason, unsavedSuffix } from '../../lib/editorReasons';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../lib/itemBody';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
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
  // D5: the typed add-question / add-option forms. They make closing prompt
  // (guardDirty) but never reach the footer or Save.
  const guards = createDirtyRegistry();
  setContext(QUIZ_GUARD_KEY, guards);

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
  $effect(() => { guardDirty = registry.isAnyDirty() || guards.isAnyDirty(); });
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

  // After a failed structure op: refetch WITHOUT the loading state, so the
  // keyed list stays mounted and every accordion keeps its drafts (§5.4). A
  // failed refetch keeps the current list rather than wiping it.
  async function resync() {
    if (loadStatus !== 'loaded') { await load(); return; }
    loadToken += 1;
    const myToken = loadToken;
    try {
      const list = await listQuestions(itemId);
      if (myToken !== loadToken) return;
      questions = [...list].sort((a, b) => a.order - b.order);
    } catch {
      if (myToken !== loadToken) return;
      pushToast("Couldn't reload the questions — reload the page to see the latest.", 'error');
    }
  }

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

  // The footer Discard: save drafts only.
  export function discard(): void { registry.discardAll(); }
  // A confirmed close (D5): save drafts, and the typed add forms collapse.
  export function discardAll(): void { discard(); guards.discardAll(); }

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
  // The 5a create-form shim (D5): guard-dirty once something is typed.
  const addFormGuard: RegisteredTracker = {
    get isDirty() {
      return adding && (newText.trim() !== '' || newNumeric.trim() !== '' || newAnswer.trim() !== '');
    },
    discard() { adding = false; resetAddForm(); },
  };
  $effect(() => { guards.register(addFormGuard); return () => guards.unregister(addFormGuard); });

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
          await resync();
          if (alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
        }
      }
    } finally { if (alive) questionsLocked = false; }
  }

  // ---- Delete question ----
  async function removeQuestion(qid: number) {
    if (questionsLocked || frozen || !perms.canEditStructure) return;
    if (!questions.some((x) => x.id === qid)) return;
    const c = [...contributors].find((x) => x.questionId === qid);
    const title = c?.title() ?? `Question ${questions.findIndex((x) => x.id === qid) + 1}`;
    if (!confirm(`Delete question "${title}"? This cannot be undone.` + unsavedSuffix(c?.isDirty ?? false))) return;
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
        await resync();
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
        await resync();
        if (e instanceof ApiError && (e.status === 403 || e.status === 409) && alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  function toggleExpand(qid: number) { expandedId = expandedId === qid ? null : qid; }
  const structureOff = $derived(!perms.canEditStructure);
  const readOnlyAll = $derived(!perms.canEditTextFields && !perms.canEditStructure);  // archived/disabled (§9)
  // D15: the version's reason titles every disabled question arrow and trash.
  const structReason = $derived(structureReason(version));
  const uid = $props.id();

  // The 5a collapsed-form toggle (+ ↔ ×): opening focuses the checked type;
  // closing drops what was typed.
  let addFormEl: HTMLFormElement | undefined = $state();
  async function toggleAdd() {
    if (questionsLocked || frozen || structureOff) return;
    if (adding) { adding = false; resetAddForm(); return; }
    adding = true;
    await tick();
    if (alive) addFormEl?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }
</script>


<section class="quiz-editor" aria-label="Quiz editor">
  {#if readOnlyAll}<p class="note" data-testid="quiz-readonly">This version is read-only — editing is disabled.</p>{/if}

  <div class="questions-head">
    <span class="questions-label">Questions</span>
    {#if loadStatus === 'loaded'}<span class="mono q-count" data-testid="question-count">{questions.length}</span>{/if}
    {#if !structureOff}
      <span class="head-add">
        <IconButton primary size="sm" glyph={adding ? 'close' : 'plus'}
                    title={adding ? 'Cancel new question' : 'Add question'} aria-label="Add question"
                    aria-expanded={adding} disabled={questionsLocked || frozen || loadStatus !== 'loaded'}
                    onclick={() => void toggleAdd()} />
      </span>
    {/if}
  </div>

  {#if adding && !structureOff}
    <form class="add-form" novalidate bind:this={addFormEl} onsubmit={(e) => { e.preventDefault(); void submitAdd(); }}>
      <QuestionTypePicker bind:value={newType} disabled={questionsLocked || frozen} />
      <input class="plain-input" data-testid="new-question-text" aria-label="Question text" placeholder="Question text"
             bind:value={newText} readonly={questionsLocked || frozen} />
      {#if newType === 'numeric_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-num`}>Answer</label>
          <input id={`${uid}-num`} class="plain-input mono" data-testid="new-numeric" bind:value={newNumeric}
                 readonly={questionsLocked || frozen} aria-invalid={!newNumericCheck.ok} />
        </div>
        <div class="field-row">
          <label class="row-label" for={`${uid}-prec`}>Precision</label>
          <input id={`${uid}-prec`} class="plain-input mono" data-testid="new-precision" type="number" min="0" max="10"
                 bind:value={newPrecision} readonly={questionsLocked || frozen} aria-invalid={!newPrecisionValid} />
        </div>
        {#if newNumericError}<p class="err" role="alert">{newNumericError}</p>{/if}
        {#if !newPrecisionValid}<p class="err" role="alert">Precision must be an integer <span class="mono">0–10</span>.</p>{/if}
      {:else if newType === 'text_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-ans`}>Answer</label>
          <input id={`${uid}-ans`} class="plain-input" data-testid="new-text-answer" bind:value={newAnswer}
                 maxlength="500" readonly={questionsLocked || frozen} />
        </div>
      {:else}
        <p class="muted">Add the answer options after creating the question.</p>
      {/if}
      {#if addError}<p class="err" role="alert">{addError}</p>{/if}
      <div class="add-actions">
        <Button type="submit" disabled={questionsLocked || frozen || !addValid}>Add</Button>
      </div>
    </form>
  {/if}

  {#if loadStatus === 'loading'}
    <p class="muted">Loading questions…</p>
  {:else if loadStatus === 'error'}
    <p class="err" role="alert">{loadError}</p>
    <div><Button variant="ghost" onclick={() => void load()}>Retry</Button></div>
  {:else if questions.length === 0}
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
            {structReason}
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
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: 12px; /* the 3f card gap (ref 1890) */ }
  .questions-head { display: flex; align-items: center; gap: 10px; padding-top: 2px; /* ref 1885 */ }
  .questions-label { font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1886 */ }
  .q-count { font-size: 11.5px; color: var(--muted); /* ref 1887 */ }
  .head-add { margin-left: auto; /* ref 1888 */ }
  .questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; /* ref 1890 */ }
  .add-form { display: flex; flex-direction: column; gap: 8px; /* the 5a create-form gap */ }
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; /* ref 1902 */ }
  .row-label { font-size: 12.5px; color: var(--muted); /* ref 1903 */ }
  /* D12: the 5a create-form input on the dense-control tokens. */
  .plain-input {
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
  .plain-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft); /* D12 — InlineField's open editor */
  }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .add-actions { display: flex; justify-content: flex-end; }
  /* The information-banner form (ItemEditorModal .ro-note). */
  .note { margin: 0; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--primary); font-size: 13px; color: var(--text); }
  .muted { margin: 0; font-size: 12.5px; color: var(--muted); }
  .err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
