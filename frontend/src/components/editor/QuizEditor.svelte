<script lang="ts">
  import { onMount, onDestroy, setContext } from 'svelte';
  import type { AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import QuestionAccordion from './QuestionAccordion.svelte';
  import QuestionTypePicker from './QuestionTypePicker.svelte';
  import {
    listQuestions, createQuestion, deleteQuestion, reorderQuestions, renameItem,
    validateNumericAnswer,
    type AuthoringQuestion, type QuestionType, type QuestionCreateBody,
  } from '../../lib/quizAuthoring';

  let {
    itemId, vid, itemTitle, version, perms, assetContext, quizDirty = $bindable(false),
  }: {
    itemId: number; vid: number; itemTitle: string;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    quizDirty?: boolean;
  } = $props();
  void version; // threaded for Plan B (max_quiz_attempts); unused in Plan A

  // ---- Dirty registry (own; ItemEditPage has no DIRTY_REGISTRY_KEY context) ----
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  $effect(() => { quizDirty = registry.isAnyDirty(); });

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

  // ---- Quiz-title rename. `savedTitle` is the last-PERSISTED title — Discard
  //      reverts to it, NOT to the `itemTitle` prop (which only catches up after
  //      a successful forced reload; if that reload fails, the prop is stale). ----
  let savedTitle = $state(itemTitle);
  const titleTracker = makeDirtyTracker<{ title: string }>({ title: itemTitle });
  let titleBusy = $state(false);
  $effect(() => { registry.register(titleTracker); return () => registry.unregister(titleTracker); });

  async function saveTitle() {
    if (titleBusy || !titleTracker.isDirty || !perms.canEditTextFields) return;
    const savedVid = vid;
    const next = titleTracker.current.title;
    titleBusy = true;
    try {
      const res = await renameItem(itemId, next);     // server echoes the persisted title
      if (alive && vid === savedVid) {
        savedTitle = res.title;                        // advance baseline from the response
        titleTracker.reset({ title: res.title });      // reset BEFORE the reload await
        await loadAdminTree(savedVid, { force: true });
      }
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Rename failed', 'error');
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) titleBusy = false;
    }
  }
  function discardTitle() { titleTracker.reset({ title: savedTitle }); }

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
          : true   // choice types: options (hence correctness) are added in Plan B
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
    if (newType === 'text_answer') return { ...base, correct_text: newAnswer };
    return base;  // single_choice / multiple_choice — options added in Plan B
  }

  async function submitAdd() {
    if (questionsLocked || !perms.canEditStructure || !addValid) return;
    const savedVid = vid;                            // capture live vid BEFORE await
    const body = buildCreateBody();
    addError = null;
    questionsLocked = true;
    try {
      const created = await createQuestion(itemId, body);
      if (!(alive && vid === savedVid)) return;      // stale / navigated → discard
      questions = [...questions, created].sort((a, b) => a.order - b.order);
      adding = false; resetAddForm();
      expandedId = created.id;                        // open the new question for editing
      await loadAdminTree(savedVid, { force: true }); // refresh questions_count
    } catch (e) {
      if (alive && vid === savedVid) {
        addError = e instanceof ApiError ? e.displayMessage : 'Add failed';
        if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
          await load();                                  // resync question list/order
          if (alive && vid === savedVid) await loadAdminTree(savedVid, { force: true }); // §4.1a: re-check after load(); §10 re-gate
        }
      }
    } finally { if (alive) questionsLocked = false; }
  }

  // ---- Delete question ----
  async function removeQuestion(qid: number) {
    if (questionsLocked || !perms.canEditStructure) return;
    if (!questions.some((x) => x.id === qid)) return;
    if (!confirm('Delete this question? Its options and text are lost.')) return;
    const savedVid = vid;                            // capture live vid BEFORE await
    questionsLocked = true;
    try {
      await deleteQuestion(qid);
      if (!(alive && vid === savedVid)) return;
      questions = questions.filter((x) => x.id !== qid);
      if (expandedId === qid) expandedId = null;
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
        await load();                                 // resync the list (token-guarded)
        if (e instanceof ApiError && (e.status === 403 || e.status === 409) && alive && vid === savedVid) await loadAdminTree(savedVid, { force: true }); // §4.1a: re-check after load()
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  // ---- Reorder question (↑/↓): optimistic local swap, POST full id-set ----
  async function move(qid: number, dir: -1 | 1) {
    if (questionsLocked || !perms.canEditStructure) return;
    const idx = questions.findIndex((x) => x.id === qid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= questions.length) return;
    const savedVid = vid;                            // capture live vid BEFORE await
    const next = [...questions];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    questions = next.map((x, i) => ({ ...x, order: i + 1 }));
    const order = questions.map((x) => ({ id: x.id, order: x.order }));
    questionsLocked = true;
    try {
      await reorderQuestions(itemId, order);
      // success: optimistic state is authoritative; order is not shown in the
      // admin tree, so no forced reload is needed.
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
        await load();                                 // resync from server on error
        if (e instanceof ApiError && (e.status === 403 || e.status === 409) && alive && vid === savedVid) await loadAdminTree(savedVid, { force: true }); // §4.1a: re-check after load()
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  function toggleExpand(qid: number) { expandedId = expandedId === qid ? null : qid; }
  const titleReadOnly = $derived(!perms.canEditTextFields);
  const structureOff = $derived(!perms.canEditStructure);
  const readOnlyAll = $derived(!perms.canEditTextFields && !perms.canEditStructure);  // archived/disabled (§9)
</script>

<section class="quiz-editor" aria-label="Quiz editor">
  {#if readOnlyAll}<p class="muted" data-testid="quiz-readonly">This version is read-only — editing is disabled.</p>{/if}
  <div class="title-row">
    <label>Quiz title
      <input data-testid="quiz-title" bind:value={titleTracker.current.title} readonly={titleReadOnly} required />
    </label>
    {#if !titleReadOnly}
      <Button onclick={saveTitle} disabled={!titleTracker.isDirty || titleBusy} loading={titleBusy}>Save title</Button>
      <Button variant="ghost" onclick={discardTitle} disabled={!titleTracker.isDirty || titleBusy}>Discard</Button>
    {/if}
  </div>

  {#if loadStatus === 'loading'}
    <p class="muted">Loading questions…</p>
  {:else if loadStatus === 'error'}
    <p class="err" role="alert">{loadError}</p>
    <Button variant="ghost" onclick={() => void load()}>Retry</Button>
  {:else}
    {#if questions.length === 0}
      <p class="muted">No questions yet.</p>
    {:else}
      <ol class="questions">
        {#each questions as q, i (q.id)}
          <li>
            <QuestionAccordion
              question={q}
              {vid}
              index={i + 1}
              count={questions.length}
              {perms}
              {assetContext}
              locked={questionsLocked}
              expanded={expandedId === q.id}
              confirmKeyChange={() => true}
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
          <QuestionTypePicker bind:value={newType} disabled={questionsLocked} />
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
            <p class="muted">Add answer options after creating (next slice).</p>
          {/if}
          {#if addError}<p class="err" role="alert">{addError}</p>{/if}
          <Button onclick={() => void submitAdd()} disabled={questionsLocked || !addValid}>Add</Button>
          <Button variant="ghost" onclick={() => { adding = false; resetAddForm(); }}>Cancel</Button>
        </div>
      {:else}
        <Button onclick={() => { adding = true; }} disabled={questionsLocked}>＋ Add question</Button>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: var(--space-3); }
  .title-row { display: flex; align-items: end; gap: var(--space-2); }
  .questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .muted { color: var(--text-muted, #666); }
  .err { color: var(--danger, #c00); }
</style>
