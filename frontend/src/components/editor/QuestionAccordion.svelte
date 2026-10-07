<script lang="ts">
  // One quiz question (Slice-5b §5). The accordion is always mounted (only its
  // body collapses), so it owns the question's drafts: text, explanation, the
  // answer key, option text and correct marks. It registers one tracker in
  // QuizEditor's private dirty registry and one save contributor on the
  // QUIZ_SAVE_KEY hub; the modal's footer Save sends the drafts (D3). Option
  // structure (add / delete / reorder) still acts immediately.
  import { getContext, onMount, onDestroy, tick, untrack } from 'svelte';
  import type {
    AuthoringQuestion, AuthoringOption, OptionUpdateBody, QuestionUpdateBody,
  } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_GUARD_KEY, QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
  import {
    updateQuestion, validateNumericAnswer,
    listOptions, createOption, updateOption, deleteOption, reorderOptions,
  } from '../../lib/quizAuthoring';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Button from '../ui/Button.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import OptionRow from './OptionRow.svelte';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked,
    onExpandToggle, onDelete, onMoveUp, onMoveDown, versionDisabled = false, frozen = false,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
    // Slice-5b D6: plain source, no /render (a disabled version's /render is a 403).
    versionDisabled?: boolean;
    // Slice-5b D10/D9: a Save or an item delete is in flight. Inputs turn
    // read-only without losing focus; checkables and structure are disabled.
    frozen?: boolean;
  } = $props();

  const registry = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  const hub = getContext<QuizSaveHub>(QUIZ_SAVE_KEY);
  // T5b: the typed add-option form is guard-dirty (D5). Optional: a harness
  // without it simply has no guard.
  const guards = getContext<DirtyRegistry | undefined>(QUIZ_GUARD_KEY);

  // ---- Lifecycle guard (§4.1a): every post-await write checks
  //      `alive && vid === savedVid` (vid = the live route prop). ----
  let alive = true;
  let optLoadToken = 0;                                 // bumped per load and on destroy
  onDestroy(() => { alive = false; optLoadToken++; });

  // ---- Question drafts. `draft` is bound to the inputs; `saved` is the last
  //      persisted state. Both are seeded ONCE (the accordion is keyed by q.id);
  //      `saved` advances per field from each PATCH echo (D10). ----
  type QDraft = { text_md: string; explanation_md: string; numericInput: string; precision: number; correct_text: string };
  const fromServer = (x: AuthoringQuestion): QDraft => ({
    text_md: x.text_md,
    explanation_md: x.explanation_md ?? '',
    numericInput: x.correct_numeric == null ? '' : String(x.correct_numeric),
    precision: x.precision ?? 0,
    correct_text: x.correct_text ?? '',
  });
  let saved = $state(untrack(() => fromServer(question)));
  let draft = $state(untrack(() => fromServer(question)));
  let textHtml = $state(untrack(() => question.text_html));   // header snippet; advances on save
  const isChoice = untrack(() => question.type === 'single_choice' || question.type === 'multiple_choice');

  const editable = $derived(perms.canEditTextFields);
  const isPublished = $derived(perms.canEditTextFields && !perms.canEditStructure);  // §8.8

  // ---- Per-type answer validity ----
  const numericCheck = $derived(
    question.type === 'numeric_answer' ? validateNumericAnswer(draft.numericInput) : { ok: true as const, canonical: '' },
  );
  const numericError = $derived(numericCheck.ok ? null : numericCheck.reason);
  const precisionValid = $derived(
    Number.isInteger(draft.precision) && draft.precision >= 0 && draft.precision <= 10,
  );
  const textAnswerValid = $derived(draft.correct_text.trim().length >= 1 && draft.correct_text.length <= 500);
  const answerValid = $derived(
    question.type === 'numeric_answer' ? (numericCheck.ok && precisionValid)
      : question.type === 'text_answer' ? textAnswerValid : true,
  );

  // ---- Options (choice types). `options` is the SAVED state from the server
  //      (order, text, marks); `optDrafts` holds the author's drafts per id. ----
  let options = $state<AuthoringOption[]>([]);
  let optStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>(isChoice ? 'loading' : 'idle');
  let optError = $state<string | null>(null);
  type ODraft = { text: string; is_correct: boolean };
  // Keyed by option id, so add / delete / reorder / refetch never move a draft
  // to another option (§5.4).
  let optDrafts = $state<Record<number, ODraft>>({});

  // The single assignment point for `options`. A new id gets a draft from the
  // server and a gone id loses its draft. For a surviving id, each CLEAN field
  // follows the server and each dirty field keeps the author's draft.
  function setOptions(next: AuthoringOption[]) {
    const prev = new Map(options.map((o) => [o.id, o]));
    for (const o of next) {
      const d = optDrafts[o.id];
      const p = prev.get(o.id);
      if (!d) optDrafts[o.id] = { text: o.text, is_correct: o.is_correct };
      else if (p) {
        if (d.text === p.text) d.text = o.text;
        if (d.is_correct === p.is_correct) d.is_correct = o.is_correct;
      }
    }
    const ids = new Set(next.map((o) => o.id));
    for (const id of Object.keys(optDrafts).map(Number)) if (!ids.has(id)) delete optDrafts[id];
    options = next;
  }
  function applyOption(updated: AuthoringOption) {     // apply-if-current (§7.2 backstop)
    const i = options.findIndex((o) => o.id === updated.id);
    if (i < 0) return;                                 // option gone → ignore a stale response
    const next = [...options];
    next[i] = updated;
    setOptions(next);
  }
  const draftOf = (o: AuthoringOption): ODraft => optDrafts[o.id] ?? { text: o.text, is_correct: o.is_correct };

  const correctCount = $derived(options.filter((o) => o.is_correct).length);              // saved (C2)
  const draftCorrectCount = $derived(options.filter((o) => draftOf(o).is_correct).length); // D25
  const marksChanged = $derived(options.some((o) => draftOf(o).is_correct !== o.is_correct));
  const optTextChanged = $derived(options.some((o) => draftOf(o).text !== o.text));
  const optTextInvalid = $derived(options.some((o) => {
    const t = draftOf(o).text;
    return t.trim().length < 1 || t.length > 500;
  }));

  // ---- Dirty ----
  const answerChanged = $derived(
    (question.type === 'numeric_answer' && (draft.numericInput !== saved.numericInput || draft.precision !== saved.precision)) ||
    (question.type === 'text_answer' && draft.correct_text !== saved.correct_text),
  );
  const qDirty = $derived(
    draft.text_md !== saved.text_md || draft.explanation_md !== saved.explanation_md || answerChanged,
  );
  const dirty = $derived(qDirty || optTextChanged || marksChanged);
  const keyChanged = $derived(answerChanged || marksChanged);   // D20

  // ---- D10 validation: only a dirty question is checked. The inline errors
  //      show after a failed Save and then follow the drafts live. ----
  let validated = $state(false);
  const textError = $derived(draft.text_md.trim() === '' ? 'Question text is required' : null);
  const markError = $derived.by(() => {
    // Only when the marks changed, and only with at least one loaded option:
    // a choice question with no options (or whose options failed to load) is
    // exempt, as created by design.
    if (!isChoice || optStatus !== 'loaded' || options.length === 0 || !marksChanged) return null;
    if (question.type === 'single_choice') return draftCorrectCount === 1 ? null : 'Mark exactly one correct option';
    return draftCorrectCount >= 1 ? null : 'Mark at least one correct option';
  });
  const needsFix = $derived(
    dirty && (textError !== null || !answerValid || markError !== null || optTextInvalid),
  );
  const showErrors = $derived(validated && dirty);

  function validate(): boolean {
    validated = dirty;
    return !needsFix;
  }

  let bodyEl: HTMLElement | undefined = $state();
  let pendingInvalidFocus = false;
  function focusInvalidNow() {
    if (!bodyEl) return;
    const el =
      (textError ? bodyEl.querySelector<HTMLElement>('[data-field="text"] textarea') : null) ??
      bodyEl.querySelector<HTMLElement>('input[aria-invalid="true"]') ??
      (markError ? bodyEl.querySelector<HTMLElement>('[data-testid="option-group"] input') : null);
    el?.focus();
  }
  function focusFirstInvalid() {
    if (expanded && bodyEl) focusInvalidNow();
    else pendingInvalidFocus = true;                    // the expand effect focuses it once rendered
  }

  // ---- Correct marks are drafts (§5.2, D25) ----
  function mark(oid: number, next: boolean) {
    if (frozen || !editable) return;
    if (question.type === 'single_choice') {
      for (const o of options) { const d = optDrafts[o.id]; if (d) d.is_correct = o.id === oid; }
    } else {
      const d = optDrafts[oid];
      if (d) d.is_correct = next;
    }
  }

  // ---- Option structure: immediate, serialised by `optionsLocked` (§7.2) ----
  let optionsLocked = $state(false);
  let optMutError = $state<string | null>(null);
  let optionAnnounce = $state('');
  // §5.4: drafts are keyed by id, so structure no longer waits for a clean
  // question. Only an in-flight option mutation or a frozen modal locks it.
  const optionsDisabled = $derived(optionsLocked || frozen);
  const canDeleteOption = (o: AuthoringOption) =>
    options.length === 1 || !(o.is_correct && correctCount === 1);   // C2 (§8.6): judged on SAVED marks

  async function resyncOptions(savedVid: number) {     // §6 write-back on error
    try {
      const list = await listOptions(question.id);
      if (!(alive && vid === savedVid)) return;
      setOptions([...list].sort((a, b) => a.order - b.order));
    } catch { /* keep the prior inline error; the loaded list stays as-is */ }
  }
  async function afterOptionError(e: unknown, savedVid: number, fallback: string) {
    if (!(alive && vid === savedVid)) return;
    optMutError = e instanceof ApiError ? e.displayMessage : fallback;
    await resyncOptions(savedVid);
    if (!(alive && vid === savedVid)) return;           // §4.1a: re-check after the resync await
    if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
      await loadAdminTree(savedVid, { force: true });   // §10 re-gate
    }
  }

  async function loadOptions() {
    optLoadToken += 1;
    const myToken = optLoadToken;
    optStatus = 'loading';
    optError = null;
    try {
      const list = await listOptions(question.id);
      if (myToken !== optLoadToken) return;            // superseded / unmounted → discard
      setOptions([...list].sort((a, b) => a.order - b.order));
      optStatus = 'loaded';
    } catch (e) {
      if (myToken !== optLoadToken) return;
      optError = e instanceof ApiError ? e.displayMessage : 'Could not load options.';
      optStatus = 'error';
    }
  }
  onMount(() => { if (isChoice) void loadOptions(); });

  let addingOption = $state(false);
  let newOptionText = $state('');
  const newOptionValid = $derived(newOptionText.trim().length >= 1 && newOptionText.length <= 500);
  // The 5a create-form shim (D5): guard-dirty once something is typed; a
  // confirmed close collapses the form. Never save-dirty.
  const addOptionGuard: RegisteredTracker = {
    get isDirty() { return addingOption && newOptionText.trim() !== ''; },
    discard() { addingOption = false; newOptionText = ''; },
  };
  $effect(() => {
    if (!guards) return;
    guards.register(addOptionGuard);
    return () => guards.unregister(addOptionGuard);
  });

  async function addOption() {
    if (optionsDisabled || !perms.canEditStructure || !newOptionValid) return;
    const savedVid = vid;
    const text = newOptionText.trim();
    // §8.4: the first option of an empty single_choice list is correct; every
    // other new option (incl. every multiple_choice option) starts false.
    const is_correct = question.type === 'single_choice' && options.length === 0;
    optMutError = null;
    optionsLocked = true;
    try {
      const created = await createOption(question.id, { text, is_correct });
      if (!(alive && vid === savedVid)) return;
      setOptions([...options, created].sort((a, b) => a.order - b.order));
      addingOption = false; newOptionText = '';
      await tick();
      if (alive && vid === savedVid) bodyEl?.querySelector<HTMLElement>(`[data-option-id="${created.id}"]`)?.focus();
    } catch (e) {
      await afterOptionError(e, savedVid, 'Add option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function removeOption(oid: number) {
    if (optionsLocked || frozen || !perms.canEditStructure) return;
    const target = options.find((o) => o.id === oid);
    if (!target || !canDeleteOption(target)) return;
    // D24: a mark draft could point at a deleted row, so this question's marks
    // are reset by the delete, and the author is asked first. Text drafts survive.
    const resetMarks = marksChanged;
    if (resetMarks && !confirm(
      `Delete option "${draftOf(target).text}"? This cannot be undone. Your unsaved correct-answer change will be reset.`,
    )) return;
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      await deleteOption(oid);
      if (!(alive && vid === savedVid)) return;
      const idx = options.findIndex((o) => o.id === oid);
      const survivors = options.filter((o) => o.id !== oid);
      setOptions(survivors);
      if (resetMarks) {
        for (const o of options) { const d = optDrafts[o.id]; if (d) d.is_correct = o.is_correct; }
      }
      const focusId = survivors[Math.min(idx, survivors.length - 1)]?.id;
      await tick();
      if (alive && vid === savedVid && focusId != null) bodyEl?.querySelector<HTMLElement>(`[data-option-id="${focusId}"]`)?.focus();
    } catch (e) {
      await afterOptionError(e, savedVid, 'Delete option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function moveOption(oid: number, dir: -1 | 1) {
    if (optionsLocked || frozen || !perms.canEditStructure) return;
    const idx = options.findIndex((o) => o.id === oid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= options.length) return;
    const savedVid = vid;
    const next = [...options];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOptions(next.map((o, i) => ({ ...o, order: i + 1 })));
    const newIndex = options.findIndex((o) => o.id === oid) + 1;
    optionAnnounce = `Option moved to position ${newIndex} of ${options.length}`;
    const order = options.map((o) => ({ id: o.id, order: o.order }));
    optMutError = null;
    optionsLocked = true;
    try {
      await reorderOptions(question.id, order);        // success: the optimistic state is authoritative
    } catch (e) {
      await afterOptionError(e, savedVid, 'Reorder failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  // ---- Inner MarkdownEditor uploads feed `locked()` (D10: Save waits for them).
  //      A collapse unmounts the editors, so their flags are cleared with it. ----
  let upText = $state(false);
  let upExpl = $state(false);
  $effect(() => { if (!expanded) { upText = false; upExpl = false; } });

  // ---- save() — §5.3 / D10 ----
  let lastError = $state<string | null>(null);
  let saveNote = $state<string | null>(null);

  function fail(e: unknown, savedVid: number, fallback: string, landed: boolean): 'partial' | 'failed' {
    if (alive && vid === savedVid) {
      lastError = e instanceof ApiError ? e.displayMessage : fallback;
      if (e instanceof ApiError && (e.status === 403 || e.status === 409)) void loadAdminTree(savedVid, { force: true });
    }
    return landed ? 'partial' : 'failed';
  }

  // (a) The changed question fields, then (b) the option PATCHes: every
  // {is_correct:true} first, then every {is_correct:false}, then text-only, so
  // the server's ">=1 correct" rule holds mid-sequence. Stops at the first
  // failure; every part that succeeded has already advanced its baseline.
  // Inputs are frozen while this runs, so the per-field write-back can never
  // overwrite newer input.
  async function save(): Promise<'ok' | 'partial' | 'failed'> {
    if (!dirty) return 'ok';
    const savedVid = vid;
    let landed = false;                                // D10: any PATCH landed → 'partial' on failure
    lastError = null;
    saveNote = null;

    const body: QuestionUpdateBody = {};
    if (draft.text_md !== saved.text_md) body.text_md = draft.text_md;
    if (draft.explanation_md !== saved.explanation_md) {
      body.explanation_md = draft.explanation_md === '' ? null : draft.explanation_md;
    }
    if (question.type === 'numeric_answer' && answerChanged && numericCheck.ok) {
      body.correct_numeric = Number(numericCheck.canonical);
      body.precision = draft.precision;
    }
    if (question.type === 'text_answer' && answerChanged) body.correct_text = draft.correct_text.trim();
    if (Object.keys(body).length > 0) {
      try {
        const u = await updateQuestion(question.id, body);
        if (!(alive && vid === savedVid)) return 'failed';
        landed = true;
        const echo = fromServer(u);
        // Per-field write-back: only the fields this request carried.
        if ('text_md' in body) { saved.text_md = echo.text_md; draft.text_md = echo.text_md; }
        if ('explanation_md' in body) { saved.explanation_md = echo.explanation_md; draft.explanation_md = echo.explanation_md; }
        if ('correct_numeric' in body) {
          saved.numericInput = echo.numericInput; draft.numericInput = echo.numericInput;
          saved.precision = echo.precision; draft.precision = echo.precision;
        }
        if ('correct_text' in body) { saved.correct_text = echo.correct_text; draft.correct_text = echo.correct_text; }
        textHtml = u.text_html;
      } catch (e) {
        return fail(e, savedVid, 'Save failed', landed);
      }
    }

    const rank = (b: OptionUpdateBody) => (b.is_correct === true ? 0 : b.is_correct === false ? 1 : 2);
    const plan = options
      .map((o) => {
        const d = draftOf(o);
        const b: OptionUpdateBody = {};
        if (d.is_correct !== o.is_correct) b.is_correct = d.is_correct;
        if (d.text !== o.text) b.text = d.text;
        return { id: o.id, b };
      })
      .filter((p) => Object.keys(p.b).length > 0)
      .sort((x, y) => rank(x.b) - rank(y.b));          // stable: display order within a group
    let sentTrue = false;
    for (const p of plan) {
      try {
        const u = await updateOption(p.id, p.b);
        if (!(alive && vid === savedVid)) return 'failed';
        const d = optDrafts[u.id];
        if (d && 'text' in p.b) d.text = u.text;
        if (d && 'is_correct' in p.b) d.is_correct = u.is_correct;
        applyOption(u);
        landed = true;
        if (p.b.is_correct === true) sentTrue = true;
      } catch (e) {
        // D10: the server briefly holds two correct options; the draft still
        // shows exactly one, and the next Save finishes the key.
        if (alive && vid === savedVid && question.type === 'single_choice' && sentTrue && p.b.is_correct === false) {
          saveNote = 'Saved partly — save again to finish the answer key.';
        }
        return fail(e, savedVid, 'Save failed', landed);
      }
    }
    validated = false;
    return 'ok';
  }

  function discard() {
    draft = { ...saved };
    for (const o of options) {
      const d = optDrafts[o.id];
      if (d) { d.text = o.text; d.is_correct = o.is_correct; }
    }
    validated = false;
    lastError = null;
    saveNote = null;
  }

  // ---- Registration: one tracker in QuizEditor's private registry (the
  //      modal's footer and the page guard read it) and one save contributor. ----
  const snippet = $derived(textHtml.replace(/<[^>]*>/g, '').trim().slice(0, 80));
  const tracker: RegisteredTracker = { get isDirty() { return dirty; }, discard };
  const contributor: QuizContributor = {
    get questionId() { return question.id; },
    order: () => index,
    get isDirty() { return dirty; },
    locked: () => optionsLocked || upText || upExpl,
    keyChanged: () => keyChanged,
    validate,
    focusFirstInvalid,
    save,
    discard,
    get lastError() { return lastError; },
    title: () => snippet || `Question ${index}`,
  };
  $effect(() => {
    registry.register(tracker);
    hub.register(contributor);
    return () => { registry.unregister(tracker); hub.unregister(contributor); };
  });

  // Focus on expand (§10a): a pending invalid field first (D10), else the
  // body's first field, unless focus is already inside the body. tick() lets
  // the body render first.
  $effect(() => {
    if (expanded) {
      void tick().then(() => {
        if (!alive || !bodyEl) return;
        if (pendingInvalidFocus) {
          pendingInvalidFocus = false;
          // R9: a Title the modal has just flagged and focused keeps focus.
          if ((document.activeElement as HTMLElement | null)?.getAttribute('aria-invalid') === 'true') return;
          focusInvalidNow();
          return;
        }
        if (bodyEl.contains(document.activeElement)) return;
        bodyEl.querySelector<HTMLElement>('textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]), select:not([disabled])')?.focus();
      });
    }
  });

  // §7.2/§5.4: structure is off without the structure perm, while a question
  // add/delete/reorder is in flight (`locked`), and while the modal is frozen.
  // A dirty question no longer locks it (drafts are keyed by id).
  const structureDisabled = $derived(!perms.canEditStructure || locked || frozen);

  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'Single choice', multiple_choice: 'Multiple choice',
    numeric_answer: 'Numeric', text_answer: 'Text',
  };
  const toleranceHint = $derived(`± ${5 * Math.pow(10, -(draft.precision + 1))}`);
</script>

<div class="question" class:expanded>
  <div class="header" data-testid="question-header" aria-invalid={validated && needsFix ? 'true' : undefined}>
    <button type="button" class="expand" aria-expanded={expanded} onclick={onExpandToggle}>{expanded ? '▾' : '▸'}</button>
    <span class="num">{index}.</span>
    <span class="badge">{typeLabel[question.type]}</span>
    {#if isChoice}<span class="badge" data-testid="correct-count">{draftCorrectCount} correct</span>{/if}
    <span class="snippet">{snippet || '(no text)'}</span>
    {#if validated && needsFix}<span class="mono needs-fix" data-testid="needs-fixing">needs fixing</span>{/if}
    <span class="spacer"></span>
    <button type="button" aria-label="Move up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete question" disabled={structureDisabled} onclick={onDelete}>🗑</button>
  </div>

  {#if expanded}
    <div class="body" bind:this={bodyEl}>
      <span class="readonly-type">Type: {typeLabel[question.type]} (fixed)</span>
      {#if isPublished}
        <p class="muted" data-testid="published-type-note">Type can't be changed. To replace this question, create a new version.</p>
      {/if}
      <div class="text-field" data-field="text">
        <label>Question text
          <MarkdownEditor {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                          bind:value={draft.text_md} bind:uploading={upText} />
        </label>
        {#if showErrors && textError}<p class="err" role="alert" data-testid="text-error">{textError}</p>{/if}
      </div>
      <label>Explanation (optional)
        <MarkdownEditor {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                        bind:value={draft.explanation_md} bind:uploading={upExpl} />
      </label>

      {#if question.type === 'numeric_answer'}
        <label>Correct value
          <input data-testid="numeric-input" bind:value={draft.numericInput}
                 readonly={!editable || frozen} aria-required="true" aria-invalid={!numericCheck.ok} />
        </label>
        <label>Precision (0–10)
          <input data-testid="precision-input" type="number" min="0" max="10"
                 readonly={!editable || frozen} aria-invalid={!precisionValid} bind:value={draft.precision} />
        </label>
        <small class="hint">Accepted within {toleranceHint}</small>
        {#if numericError}<p class="err" role="alert">{numericError}</p>{/if}
        {#if !precisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
      {:else if question.type === 'text_answer'}
        <label>Correct answer
          <input data-testid="text-answer-input" bind:value={draft.correct_text}
                 readonly={!editable || frozen} maxlength="500" aria-required="true" aria-invalid={!textAnswerValid} />
        </label>
        <small class="hint">Case-insensitive, trimmed match. {draft.correct_text.length}/500</small>
        {#if !textAnswerValid}<p class="err" role="alert">Enter 1–500 characters.</p>{/if}
      {:else}
        {#if optStatus === 'loading'}
          <p class="muted">Loading options…</p>
        {:else if optStatus === 'error'}
          <p class="err" role="alert" data-testid="option-load-error">{optError}</p>
          <Button variant="ghost" onclick={() => void loadOptions()}>Retry</Button>
        {:else}
          {#if options.length === 0}
            <p class="muted">No options yet.</p>
          {:else}
            <fieldset class="option-group" data-testid="option-group">
              <legend>Answer options{question.type === 'single_choice' ? ' — select the correct option' : ' — select all correct options'}</legend>
              <ol class="options">
                {#each options as o, i (o.id)}
                  {@const d = optDrafts[o.id]}
                  {#if d}
                    <li>
                      <OptionRow
                        option={o} index={i + 1} count={options.length} questionType={question.type}
                        {perms} {frozen} optionsLocked={optionsDisabled} canDelete={canDeleteOption(o)}
                        mutating={optionsLocked}
                        correct={d.is_correct}
                        bind:draft={d.text}
                        onMark={(next) => mark(o.id, next)}
                        onDelete={() => void removeOption(o.id)}
                        onMoveUp={() => void moveOption(o.id, -1)}
                        onMoveDown={() => void moveOption(o.id, 1)}
                      />
                    </li>
                  {/if}
                {/each}
              </ol>
            </fieldset>
            {#if showErrors && markError}<p class="err" role="alert" data-testid="mark-error">{markError}</p>{/if}
          {/if}
          {#if isChoice && optStatus === 'loaded' && options.length < 2}<p class="muted" data-testid="few-options-warn">Add at least 2 options before publishing.</p>{/if}
          <p class="sr-only" aria-live="polite" data-testid="option-live">{optionAnnounce}</p>
          {#if optMutError}<p class="err" role="alert" data-testid="option-mut-error">{optMutError}</p>{/if}
          {#if perms.canEditStructure}
            {#if addingOption}
              <div class="add-option">
                <label>New option
                  <input data-testid="new-option-text" bind:value={newOptionText} maxlength="500" readonly={optionsDisabled} />
                </label>
                <Button onclick={() => void addOption()} disabled={optionsDisabled || !newOptionValid}>Add</Button>
                <Button variant="ghost" onclick={() => { addingOption = false; newOptionText = ''; }}>Cancel</Button>
              </div>
            {:else}
              <Button aria-label="Add option" onclick={() => { addingOption = true; }} disabled={optionsDisabled}>＋ Add option</Button>
            {/if}
          {/if}
        {/if}
      {/if}

      {#if saveNote}<p class="err" role="alert" data-testid="save-note">{saveNote}</p>{/if}
      {#if lastError}<p class="err" role="alert" data-testid="save-error">{lastError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .question { border: 1px solid var(--border); border-radius: var(--radius); }
  .header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); }
  .body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border-top: 1px solid var(--border); }
  .spacer { flex: 1; }
  .badge, .muted { font-size: 0.85em; color: var(--muted); }
  .needs-fix { font-size: 11.5px; color: var(--danger); }
  .err { color: var(--danger); }
  .options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .add-option { display: flex; align-items: end; gap: var(--space-2); }
  .option-group { border: none; margin: 0; padding: 0; }
  .option-group legend { font-size: 0.85em; color: var(--muted); padding: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
