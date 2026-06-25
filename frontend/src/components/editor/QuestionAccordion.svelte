<script lang="ts">
  import { getContext, onMount, onDestroy } from 'svelte';
  import type { AuthoringQuestion, AuthoringOption } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker, type DirtyTracker } from '../../lib/dirty.svelte';
  import {
    updateQuestion, validateNumericAnswer,
    listOptions, createOption, updateOption, deleteOption, reorderOptions,
  } from '../../lib/quizAuthoring';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Button from '../ui/Button.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import OptionRow from './OptionRow.svelte';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked, confirmKeyChange,
    onExpandToggle, onDelete, onMoveUp, onMoveDown,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    confirmKeyChange: (questionId: number) => boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  const registry = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);

  // ---- Lifecycle guard (§4.1a). A question Save does NOT reload the admin tree
  //      (§10: per-question Save → no extra reload), but per §4.1a EVERY post-await
  //      write is still gated by `alive && vid === savedVid` (vid = the live route
  //      prop). In practice the accordion remounts on a version change (item.id
  //      changes → `{#key item.id}` in ItemEditPage tears it down → alive=false),
  //      so `alive` alone usually suffices — the vid check makes the guard robust
  //      without depending on that item-id-uniqueness invariant. ----
  let alive = true;
  let optLoadToken = 0;                                 // plain; bumped per load + on destroy (§4.1a)
  onDestroy(() => {
    alive = false; optLoadToken++;
    for (const t of optionTrackers.values()) registry.unregister(t);
  });

  // ---- Working copy (`draft`, bound to the inputs) + last-persisted baseline
  //      (`saved`). Both seeded ONCE from the prop; the prop is NEVER mutated.
  //      `saved` advances on a successful PATCH so the form goes clean and
  //      Discard reverts to it — NOT to the original prop. ----
  const seed = () => ({
    text_md: question.text_md,
    explanation_md: question.explanation_md ?? '',
    numericInput: question.correct_numeric == null ? '' : String(question.correct_numeric),
    precision: question.precision ?? 0,
    correct_text: question.correct_text ?? '',
  });
  let saved = $state(seed());
  let draft = $state(seed());
  let textHtml = $state(question.text_html);   // header snippet; advances on Save

  const editable = $derived(perms.canEditTextFields);
  // optionsLocked must be declared before textLocked references it
  let optionsLocked = $state(false);                   // accordion-wide option lock (§7.2) — declared early for textLocked
  const textLocked = $derived(optionsLocked);          // text inputs frozen during an option mutation (§7.2)

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

  // ---- Dirty = draft differs from the saved baseline (text + per-type answer).
  //      One registered tracker on the ALWAYS-MOUNTED accordion — it survives
  //      body collapse (the body's inputs/MarkdownEditors unmount; this does not). ----
  const dirty = $derived(
    draft.text_md !== saved.text_md ||
    draft.explanation_md !== saved.explanation_md ||
    (question.type === 'numeric_answer' && (draft.numericInput !== saved.numericInput || draft.precision !== saved.precision)) ||
    (question.type === 'text_answer' && draft.correct_text !== saved.correct_text),
  );
  const tracker: RegisteredTracker = { get isDirty() { return dirty; } };
  $effect(() => { registry.register(tracker); return () => registry.unregister(tracker); });

  // ---- Options (choice types only). Each accordion loads & owns its own
  //      options (§4.1/§6) so a failed fetch is isolated to this question and
  //      is never confused with an empty list. Type is fixed for the
  //      instance's lifetime (keyed by q.id), so isChoice is a plain const. ----
  const isChoice = question.type === 'single_choice' || question.type === 'multiple_choice';
  let options = $state<AuthoringOption[]>([]);
  let optStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>(isChoice ? 'loading' : 'idle');
  let optError = $state<string | null>(null);
  const correctCount = $derived(options.filter((o) => o.is_correct).length);

  // ---- Option mutation state + accordion-wide lock (§7.2) ----
  // optionsLocked is declared above (near editable) so textLocked can reference it
  let optMutError = $state<string | null>(null);       // inline option-mutation error
  // Per-option text drafts + dirty trackers live on the always-mounted accordion
  // (§7.1) so an uncommitted draft survives collapse and feeds quizDirty. Plain
  // Map (membership need not be reactive — OptionRow binds the tracker's $state).
  const optionTrackers = new Map<number, DirtyTracker<{ text: string }>>();

  function reconcileTrackers() {
    const ids = new Set(options.map((o) => o.id));
    for (const o of options) {
      if (!optionTrackers.has(o.id)) {
        const t = makeDirtyTracker<{ text: string }>({ text: o.text });
        optionTrackers.set(o.id, t);
        registry.register(t);                          // feeds quizDirty
      }
    }
    for (const [id, t] of [...optionTrackers]) {
      if (!ids.has(id)) { registry.unregister(t); optionTrackers.delete(id); }
    }
  }
  // Single assignment point: reconcile trackers synchronously whenever options change.
  function setOptions(next: AuthoringOption[]) { options = next; reconcileTrackers(); }

  function applyOption(updated: AuthoringOption) {     // apply-if-current (§7.2 backstop)
    const i = options.findIndex((o) => o.id === updated.id);
    if (i < 0) return;                                 // option gone → ignore stale response
    const next = [...options];
    next[i] = updated;
    setOptions(next);
  }
  async function resyncOptions(savedVid: number) {     // §6 write-back on error
    try {
      const list = await listOptions(question.id);
      if (!(alive && vid === savedVid)) return;
      setOptions([...list].sort((a, b) => a.order - b.order));
    } catch { /* keep the prior inline error; the loaded list stays as-is */ }
  }
  const canDeleteOption = (o: AuthoringOption) =>
    options.length === 1 || !(o.is_correct && correctCount === 1);   // C2 (§8.6)
  const optionsDisabled = $derived(optionsLocked || dirty);          // effective UI lock (text↔option)

  async function afterOptionError(e: unknown, savedVid: number, fallback: string) {
    if (!(alive && vid === savedVid)) return;
    optMutError = e instanceof ApiError ? e.displayMessage : fallback;
    await resyncOptions(savedVid);                               // §6 write-back (option-level)
    if (!(alive && vid === savedVid)) return;                   // §4.1a: re-check after the resync await
    if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
      await loadAdminTree(savedVid, { force: true });           // §10 re-gate (refresh perms); act on the version the mutation targeted
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

  // ---- Inline add-option (like SequenceAccordion's inline create) ----
  let addingOption = $state(false);
  let newOptionText = $state('');
  const newOptionValid = $derived(newOptionText.trim().length >= 1 && newOptionText.length <= 500);

  async function addOption() {
    if (optionsDisabled || !perms.canEditStructure || !newOptionValid) return;
    const savedVid = vid;
    const text = newOptionText.trim();
    // §8.4: the first option of an empty single_choice list is auto-correct; all
    // other new options (incl. every multiple_choice option) default to false.
    const is_correct = question.type === 'single_choice' && options.length === 0;
    optMutError = null;
    optionsLocked = true;
    try {
      const created = await createOption(question.id, { text, is_correct });
      if (!(alive && vid === savedVid)) return;
      setOptions([...options, created].sort((a, b) => a.order - b.order));
      addingOption = false; newOptionText = '';
    } catch (e) {
      await afterOptionError(e, savedVid, 'Add option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function removeOption(oid: number) {
    if (optionsLocked || !perms.canEditStructure) return;
    const target = options.find((o) => o.id === oid);
    if (!target || !canDeleteOption(target)) return;
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      await deleteOption(oid);
      if (!(alive && vid === savedVid)) return;
      setOptions(options.filter((o) => o.id !== oid));
    } catch (e) {
      await afterOptionError(e, savedVid, 'Delete option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function moveOption(oid: number, dir: -1 | 1) {
    if (optionsLocked || !perms.canEditStructure) return;
    const idx = options.findIndex((o) => o.id === oid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= options.length) return;
    const savedVid = vid;
    const next = [...options];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOptions(next.map((o, i) => ({ ...o, order: i + 1 })));
    const order = options.map((o) => ({ id: o.id, order: o.order }));
    optMutError = null;
    optionsLocked = true;
    try {
      await reorderOptions(question.id, order);        // success: optimistic state is authoritative
    } catch (e) {
      await afterOptionError(e, savedVid, 'Reorder failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function commitText(oid: number) {
    if (optionsDisabled) return;
    const tracker = optionTrackers.get(oid);
    const target = options.find((o) => o.id === oid);
    if (!tracker || !target || !tracker.isDirty) return;
    const text = tracker.current.text;
    if (text.trim().length < 1 || text.length > 500) return;   // blocked: counter already red
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      const updated = await updateOption(oid, { text });
      if (!(alive && vid === savedVid)) return;
      applyOption(updated);
      optionTrackers.get(oid)?.reset({ text: updated.text });  // baseline → clean
    } catch (e) {
      await afterOptionError(e, savedVid, 'Save option text failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function toggleCorrect(oid: number, next: boolean) {
    if (optionsLocked) return;
    const target = options.find((o) => o.id === oid);
    if (!target) return;
    // §8.4 no-op: clicking the radio of the already-unique-correct single_choice option.
    if (question.type === 'single_choice' && correctCount === 1 && target.is_correct) return;
    if (!confirmKeyChange(question.id)) return;          // §8.7 — once, before any set-true
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      if (question.type === 'single_choice') {
        // Capture the others-to-unset BEFORE mutating (set-true doesn't change them).
        const othersToUnset = options.filter((o) => o.is_correct && o.id !== oid).map((o) => o.id);
        if (!target.is_correct) {
          const u = await updateOption(oid, { is_correct: true });    // set-true FIRST (awaited)
          if (!(alive && vid === savedVid)) return;
          applyOption(u);
        }
        for (const yid of othersToUnset) {                            // then unset each other
          const u = await updateOption(yid, { is_correct: false });
          if (!(alive && vid === savedVid)) return;
          applyOption(u);
        }
      } else {                                                        // multiple_choice: optimistic single toggle
        applyOption({ ...target, is_correct: next });               // optimistic local flip
        const u = await updateOption(oid, { is_correct: next });
        if (!(alive && vid === savedVid)) return;
        applyOption(u);                                             // confirm with server response
      }
    } catch (e) {
      await afterOptionError(e, savedVid, 'Correctness update failed');
    } finally {
      if (alive) optionsLocked = false;                              // whole sequence in ONE finally (§7.2)
    }
  }

  let saveBusy = $state(false);
  const canSave = $derived(dirty && answerValid && !saveBusy && editable && !optionsLocked);

  async function save() {
    if (!canSave) return;
    const savedVid = vid;                            // capture live vid BEFORE await (§4.1a)
    const body: Record<string, unknown> = {};
    if (draft.text_md !== saved.text_md) body.text_md = draft.text_md;
    body.explanation_md = draft.explanation_md === '' ? null : draft.explanation_md;
    if (question.type === 'numeric_answer' && numericCheck.ok) {
      body.correct_numeric = Number(numericCheck.canonical);
      body.precision = draft.precision;
    }
    if (question.type === 'text_answer') body.correct_text = draft.correct_text;
    saveBusy = true;
    try {
      const updated = await updateQuestion(question.id, body);
      if (!(alive && vid === savedVid)) return;      // unmounted / route changed → discard write
      saved = {
        text_md: updated.text_md,
        explanation_md: updated.explanation_md ?? '',
        numericInput: updated.correct_numeric == null ? '' : String(updated.correct_numeric),
        precision: updated.precision ?? 0,
        correct_text: updated.correct_text ?? '',
      };
      draft = { ...saved };                           // advance baseline → form goes clean
      textHtml = updated.text_html;
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
        if (e instanceof ApiError && (e.status === 403 || e.status === 409)) await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) saveBusy = false;
    }
  }
  function discard() { draft = { ...saved }; }        // revert to the last-saved baseline

  // §7.2 + shared lock: structural controls are disabled when there is no
  // structure perm, OR this question's form is dirty (text-side lock), OR an
  // accordion-wide add/delete/reorder is in flight (`locked`).
  const structureDisabled = $derived(!perms.canEditStructure || dirty || locked);

  const snippet = $derived(textHtml.replace(/<[^>]*>/g, '').trim().slice(0, 80));
  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'Single choice', multiple_choice: 'Multiple choice',
    numeric_answer: 'Numeric', text_answer: 'Text',
  };
  const toleranceHint = $derived(`± ${5 * Math.pow(10, -(draft.precision + 1))}`);
</script>

<div class="question" class:expanded>
  <div class="header" data-testid="question-header">
    <button type="button" class="expand" aria-expanded={expanded} onclick={onExpandToggle}>{expanded ? '▾' : '▸'}</button>
    <span class="num">{index}.</span>
    <span class="badge">{typeLabel[question.type]}</span>
    {#if isChoice}<span class="badge" data-testid="correct-count">{correctCount} correct</span>{/if}
    <span class="snippet">{snippet || '(no text)'}</span>
    <span class="spacer"></span>
    <button type="button" aria-label="Move up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete question" disabled={structureDisabled} onclick={onDelete}>🗑</button>
  </div>

  {#if expanded}
    <div class="body">
      <span class="readonly-type">Type: {typeLabel[question.type]} (fixed)</span>
      <label>Question text
        <MarkdownEditor {assetContext} readOnly={!editable || textLocked} bind:value={draft.text_md} />
      </label>
      <label>Explanation (optional)
        <MarkdownEditor {assetContext} readOnly={!editable || textLocked} bind:value={draft.explanation_md} />
      </label>

      {#if question.type === 'numeric_answer'}
        <label>Correct value
          <input data-testid="numeric-input" bind:value={draft.numericInput}
                 readonly={!editable || textLocked} aria-required="true" aria-invalid={!numericCheck.ok} />
        </label>
        <label>Precision (0–10)
          <input data-testid="precision-input" type="number" min="0" max="10"
                 readonly={!editable || textLocked} bind:value={draft.precision} />
        </label>
        <small class="hint">Accepted within {toleranceHint}</small>
        {#if numericError}<p class="err" role="alert">{numericError}</p>{/if}
        {#if !precisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
      {:else if question.type === 'text_answer'}
        <label>Correct answer
          <input data-testid="text-answer-input" bind:value={draft.correct_text}
                 readonly={!editable || textLocked} maxlength="500" aria-required="true" aria-invalid={!textAnswerValid} />
        </label>
        <small class="hint">Case-insensitive, trimmed match. {draft.correct_text.length}/500</small>
        {#if !textAnswerValid}<p class="err" role="alert">Enter 1–500 characters.</p>{/if}
      {:else}
        <!-- choice types (single_choice / multiple_choice): options list (§6) -->
        {#if optStatus === 'loading'}
          <p class="muted">Loading options…</p>
        {:else if optStatus === 'error'}
          <p class="err" role="alert" data-testid="option-load-error">{optError}</p>
          <Button variant="ghost" onclick={() => void loadOptions()}>Retry</Button>
        {:else}
          {#if options.length === 0}
            <p class="muted">No options yet.</p>
          {:else}
            <ol class="options">
              {#each options as o, i (o.id)}
                {@const t = optionTrackers.get(o.id)}
                {#if t}
                  <li>
                    <OptionRow
                      option={o} index={i + 1} count={options.length} questionType={question.type}
                      {perms} optionsLocked={optionsDisabled} canDelete={canDeleteOption(o)}
                      bind:draft={t.current.text}
                      onToggleCorrect={(next) => void toggleCorrect(o.id, next)}
                      onCommitText={() => void commitText(o.id)}
                      onDelete={() => void removeOption(o.id)}
                      onMoveUp={() => void moveOption(o.id, -1)}
                      onMoveDown={() => void moveOption(o.id, 1)}
                    />
                  </li>
                {/if}
              {/each}
            </ol>
          {/if}
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
              <Button onclick={() => { addingOption = true; }} disabled={optionsDisabled}>＋ Add option</Button>
            {/if}
          {/if}
        {/if}
      {/if}

      {#if editable}
        <div class="row">
          <Button onclick={() => void save()} disabled={!canSave} loading={saveBusy}>Save</Button>
          <Button variant="ghost" onclick={discard} disabled={!dirty || saveBusy}>Discard</Button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .question { border: 1px solid var(--border); border-radius: var(--radius); }
  .header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); }
  .body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border-top: 1px solid var(--border); }
  .spacer { flex: 1; }
  .badge, .muted { font-size: 0.85em; color: var(--text-muted, #666); }
  .err { color: var(--danger, #c00); }
  .options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .add-option { display: flex; align-items: end; gap: var(--space-2); }
</style>
