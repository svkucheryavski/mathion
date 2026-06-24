<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import type { AuthoringQuestion } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { updateQuestion, validateNumericAnswer } from '../../lib/quizAuthoring';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Button from '../ui/Button.svelte';
  import { pushToast } from '../../stores/toasts.svelte';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked,
    onExpandToggle, onDelete, onMoveUp, onMoveDown,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
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
  onDestroy(() => { alive = false; });

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

  let saveBusy = $state(false);
  const canSave = $derived(dirty && answerValid && !saveBusy && editable);

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
      if (alive && vid === savedVid) pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
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
        <MarkdownEditor {assetContext} readOnly={!editable} bind:value={draft.text_md} />
      </label>
      <label>Explanation (optional)
        <MarkdownEditor {assetContext} readOnly={!editable} bind:value={draft.explanation_md} />
      </label>

      {#if question.type === 'numeric_answer'}
        <label>Correct value
          <input data-testid="numeric-input" bind:value={draft.numericInput}
                 readonly={!editable} aria-required="true" aria-invalid={!numericCheck.ok} />
        </label>
        <label>Precision (0–10)
          <input data-testid="precision-input" type="number" min="0" max="10"
                 readonly={!editable} bind:value={draft.precision} />
        </label>
        <small class="hint">Accepted within {toleranceHint}</small>
        {#if numericError}<p class="err" role="alert">{numericError}</p>{/if}
        {#if !precisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
      {:else if question.type === 'text_answer'}
        <label>Correct answer
          <input data-testid="text-answer-input" bind:value={draft.correct_text}
                 readonly={!editable} maxlength="500" aria-required="true" aria-invalid={!textAnswerValid} />
        </label>
        <small class="hint">Case-insensitive, trimmed match. {draft.correct_text.length}/500</small>
        {#if !textAnswerValid}<p class="err" role="alert">Enter 1–500 characters.</p>{/if}
      {:else}
        <p class="muted">Options are edited in the next slice (Plan B).</p>
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
</style>
