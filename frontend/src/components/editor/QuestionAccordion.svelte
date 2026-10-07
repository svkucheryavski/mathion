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
  import IconButton from '../ui/IconButton.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import OptionRow from './OptionRow.svelte';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked,
    onExpandToggle, onDelete, onMoveUp, onMoveDown, versionDisabled = false, frozen = false,
    structReason = null,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
    // Slice-5b D6: plain source, no /render (a disabled version's /render is a 403).
    versionDisabled?: boolean;
    // Slice-5b D10/D9: a Save or an item delete is in flight. Inputs turn
    // read-only without losing focus; checkables and structure are disabled.
    frozen?: boolean;
    // Slice-5b D15: why the version forbids structure changes (the title of
    // every arrow and trash); null when it allows them.
    structReason?: string | null;
  } = $props();
  const uid = $props.id();
  const bodyId = `${uid}-body`;

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
  // The 5a collapsed-form toggle (+ ↔ ×): opening focuses the field; closing
  // drops what was typed.
  async function toggleAddOption() {
    if (optionsDisabled || !perms.canEditStructure) return;
    if (addingOption) { addingOption = false; newOptionText = ''; return; }
    addingOption = true;
    await tick();
    if (alive) bodyEl?.querySelector<HTMLInputElement>('[data-testid="new-option-text"]')?.focus();
  }

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
  // overwrite newer input. Once (b) starts it always finishes, even if the
  // modal unmounts (browser Back can't be frozen): stopping between a key's
  // true and false PATCHes would leave two correct options on the server.
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
        landed = true;
        if (!(alive && vid === savedVid)) continue;     // keep sending; no UI writes
        const d = optDrafts[u.id];
        if (d && 'text' in p.b) d.text = u.text;
        if (d && 'is_correct' in p.b) d.is_correct = u.is_correct;
        applyOption(u);
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
    if (!(alive && vid === savedVid)) return 'failed';
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

  // D15: lowercase mono type names (3f, ref 1894).
  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'single choice', multiple_choice: 'multiple choice',
    numeric_answer: 'numeric answer', text_answer: 'text answer',
  };
  // D15 / R12: the version's reason first, then the boundary.
  const upTitle = $derived(structReason ?? (index <= 1 ? 'Move up — already first' : 'Move up'));
  const downTitle = $derived(structReason ?? (index >= count ? 'Move down — already last' : 'Move down'));
  const toleranceHint = $derived(`± ${5 * Math.pow(10, -(draft.precision + 1))}`);
</script>


<div class="question" class:expanded>
  <div class="q-head" data-testid="question-header" aria-invalid={validated && needsFix ? 'true' : undefined}>
    <button type="button" class="q-toggle" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined}
            onclick={onExpandToggle}>
      <span class="mono q-badge">Q{index}</span>
      <span class="q-title">{snippet || '(no text)'}</span>
    </button>
    {#if validated && needsFix}<span class="mono needs-fix" data-testid="needs-fixing">needs fixing</span>{/if}
    {#if isChoice}<span class="mono q-meta" data-testid="correct-count">{draftCorrectCount} correct</span>{/if}
    <span class="mono q-type">{typeLabel[question.type]}</span>
    <span class="actions">
      <IconButton size="sm" glyph="up" title={upTitle} aria-label="Move up"
                  disabled={structureDisabled || index <= 1} onclick={onMoveUp} />
      <IconButton size="sm" glyph="down" title={downTitle} aria-label="Move down"
                  disabled={structureDisabled || index >= count} onclick={onMoveDown} />
      <IconButton size="sm" glyph="trash" danger title={structReason ?? 'Delete question'} aria-label="Delete question"
                  disabled={structureDisabled} onclick={onDelete} />
    </span>
  </div>

  {#if expanded}
    <div class="body" id={bodyId} bind:this={bodyEl}>
      {#if isPublished}
        <p class="note" data-testid="published-type-note">Type can't be changed. To replace this question, create a new version.</p>
      {/if}
      <!-- D23: stacked, so the asset sidebar fits beside the pane. -->
      <div class="stack" data-field="text">
        <span class="row-label">Question</span>
        <MarkdownEditor ariaLabel="Question text" {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                        bind:value={draft.text_md} bind:uploading={upText} />
        {#if showErrors && textError}<p class="err" role="alert" data-testid="text-error">{textError}</p>{/if}
      </div>
      <div class="stack" data-field="explanation">
        <span class="row-label">Explanation</span>
        <MarkdownEditor ariaLabel="Explanation" {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                        bind:value={draft.explanation_md} bind:uploading={upExpl} />
      </div>

      {#if question.type === 'numeric_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-num`}>Answer</label>
          <div class="field">
            <input id={`${uid}-num`} class="plain-input mono" data-testid="numeric-input" bind:value={draft.numericInput}
                   readonly={!editable || frozen} aria-required="true" aria-invalid={!numericCheck.ok}
                   aria-describedby={numericError ? `${uid}-num-err` : undefined} />
            {#if numericError}<p class="err" id={`${uid}-num-err`} role="alert">{numericError}</p>{/if}
          </div>
        </div>
        <div class="field-row">
          <label class="row-label" for={`${uid}-prec`}>Precision</label>
          <div class="field">
            <input id={`${uid}-prec`} class="plain-input mono" data-testid="precision-input" type="number" min="0" max="10"
                   readonly={!editable || frozen} aria-invalid={!precisionValid} bind:value={draft.precision}
                   aria-describedby={`${uid}-prec-hint`} />
            <small class="hint" id={`${uid}-prec-hint`}>Accepted within <span class="mono">{toleranceHint}</span></small>
            {#if !precisionValid}<p class="err" role="alert">Precision must be an integer <span class="mono">0–10</span>.</p>{/if}
          </div>
        </div>
      {:else if question.type === 'text_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-ans`}>Answer</label>
          <div class="field">
            <input id={`${uid}-ans`} class="plain-input" data-testid="text-answer-input" bind:value={draft.correct_text}
                   readonly={!editable || frozen} maxlength="500" aria-required="true" aria-invalid={!textAnswerValid}
                   aria-describedby={`${uid}-ans-hint`} />
            <small class="hint" id={`${uid}-ans-hint`}>Case-insensitive, trimmed match. <span class="mono">{draft.correct_text.length}/500</span></small>
            {#if !textAnswerValid}<p class="err" role="alert">Enter <span class="mono">1–500</span> characters.</p>{/if}
          </div>
        </div>
      {:else}
        <div class="opts-head">
          <span class="row-label opts-label">Options</span>
          {#if showErrors && markError}<p class="err" role="alert" data-testid="mark-error">{markError}</p>{/if}
          {#if perms.canEditStructure && optStatus === 'loaded'}
            <span class="opts-add">
              <IconButton primary size="sm" glyph={addingOption ? 'close' : 'plus'}
                          title={addingOption ? 'Cancel new option' : 'Add option'} aria-label="Add option"
                          aria-expanded={addingOption} disabled={optionsDisabled}
                          onclick={() => void toggleAddOption()} />
            </span>
          {/if}
        </div>
        {#if addingOption}
          <form class="add-form" novalidate onsubmit={(e) => { e.preventDefault(); void addOption(); }}>
            <input class="plain-input" data-testid="new-option-text" aria-label="New option" placeholder="Option text"
                   bind:value={newOptionText} maxlength="500" readonly={optionsDisabled} />
            <div class="add-actions">
              <Button type="submit" disabled={optionsDisabled || !newOptionValid}>Add</Button>
            </div>
          </form>
        {/if}
        {#if optStatus === 'loading'}
          <p class="muted">Loading options…</p>
        {:else if optStatus === 'error'}
          <p class="err" role="alert" data-testid="option-load-error">{optError}</p>
          <div><Button variant="ghost" onclick={() => void loadOptions()}>Retry</Button></div>
        {:else}
          {#if options.length === 0}
            <p class="muted">No options yet.</p>
          {:else}
            <fieldset class="option-group" data-testid="option-group">
              <legend class="sr-only">{question.type === 'single_choice'
                ? 'Answer options — select the correct option'
                : 'Answer options — select all correct options'}</legend>
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
          {/if}
          {#if options.length < 2}<p class="muted" data-testid="few-options-warn">Add at least <span class="mono">2</span> options before publishing.</p>{/if}
          <p class="sr-only" aria-live="polite" data-testid="option-live">{optionAnnounce}</p>
          {#if optMutError}<p class="err" role="alert" data-testid="option-mut-error">{optMutError}</p>{/if}
        {/if}
      {/if}

      {#if saveNote}<p class="err" role="alert" data-testid="save-note">{saveNote}</p>{/if}
      {#if lastError}<p class="err" role="alert" data-testid="save-error">{lastError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  /* 3f question card (ref 1890); #E9EBEF → --border (5a precedent). */
  .question { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
  .q-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface); /* ref 1891 */ }
  .question.expanded .q-head { background: var(--surface-2); border-bottom: 1px solid var(--border); /* ref 1891 */ }
  /* The whole badge + title is the toggle (D15: no chevron). */
  .q-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .q-badge { font-size: 11px; color: var(--primary); /* ref 1892 */ }
  .q-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; /* ref 1893 */ }
  .q-meta { font-size: 11.5px; color: var(--muted); /* R13, the ref 1894 type-name scale */ }
  .q-type { font-size: 11.5px; color: var(--muted); /* ref 1894 */ }
  .needs-fix { font-size: 11.5px; color: var(--danger); }
  .actions { display: flex; align-items: center; gap: 6px; /* ref 1895 */ }
  .body { padding: 12px; display: flex; flex-direction: column; gap: 10px; /* ref 1901 */ }
  /* D23: the label sits above a full-width editor (not the 132px grid). */
  .stack { display: flex; flex-direction: column; gap: 4px; /* the 4px label/field step */ min-width: 0; }
  .row-label { font-size: 12.5px; color: var(--muted); /* ref 1903 */ }
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; /* ref 1902 */ }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
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
  .hint { font-size: 12px; color: var(--muted); }
  .err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  .muted { margin: 0; font-size: 12.5px; color: var(--muted); }
  /* D6: the information-banner form (ItemEditorModal .ro-note). */
  .note { margin: 0; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--primary); font-size: 13px; color: var(--text); }
  .opts-head { display: flex; align-items: center; gap: 10px; /* ref 1907 */ }
  .opts-label { flex: 0 0 auto; width: 132px; /* ref 1908 */ }
  .opts-add { margin-left: auto; /* ref 1909 */ }
  .add-form { display: flex; flex-direction: column; gap: 8px; /* the 5a create-form gap */ }
  .add-actions { display: flex; justify-content: flex-end; }
  .option-group { border: 0; margin: 0; padding: 0; min-width: 0; }
  .options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; /* ref 1911 */ }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
