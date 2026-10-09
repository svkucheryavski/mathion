<script lang="ts">
  // The Number / Text answer key (spec §Number, §Text): a display line, and an
  // inline editor behind ✎ "Edit the answer to question N". Number saves value
  // + decimals in one PATCH. A key save takes the per-question lock; a
  // published version confirms first (after the D10 prompt, which ran when the
  // editor opened). A failed save re-fetches nothing (R8): these answers are
  // question fields, and the editor keeps the typed values and the error.
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import InlineInput from './InlineInput.svelte';
  import { FORBIDDEN_TITLE, InlineEdit, KEY_CONFIRM, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { decimalsText, formatNumber, sameNumber, toleranceText } from '../../../lib/quizFormat';
  import {
    updateQuestion, validateNumericAnswer, type AuthoringQuestion, type QuestionUpdateBody,
  } from '../../../lib/quizAuthoring';

  let { q, n }: { q: AuthoringQuestion; n: number } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const errId = `${uid}-err`;
  let mounted = true;
  // Mounted AND still showing this version (spec §Stale responses).
  const alive = () => mounted && ctx.live();
  onDestroy(() => { mounted = false; });

  type NumDraft = { v: string; d: string };
  let numEdit = $state<InlineEdit<NumDraft> | null>(null);
  let textEdit = $state<InlineEdit<string> | null>(null);
  let pencil = $state<HTMLButtonElement>();
  // The fields bind through a null check: close() nulls numEdit, and bind:value
  // re-reads one tick after an input (T4).

  const isNumber = $derived(q.type === 'numeric_answer');
  const shown = $derived(
    isNumber ? (q.correct_numeric == null ? null : formatNumber(q.correct_numeric)) : q.correct_text,
  );
  const tail = $derived(
    !isNumber ? ''
      : q.precision == null ? ' · decimals not set'
        : ` · ${decimalsText(q.precision)} (${toleranceText(q.precision)})`,
  );
  const editReason = $derived(ctx.edits.locked || ctx.busyQuestions.has(q.id) ? WAIT_TITLE : null);
  const confirmKey = () => !ctx.published || window.confirm(KEY_CONFIRM);
  const DEC_MSG = 'Decimals must be a whole number from 0 to 10.';
  // The error marks the field it is about: Decimals for DEC_MSG, else Answer.
  const decBad = $derived(numEdit?.error === DEC_MSG);
  const decimalsOk = (d: string) => /^\d{1,2}$/.test(d.trim()) && Number(d) <= 10;

  // Back to ✎, or the §Focus fallback when a 403/409 reload removed it.
  async function refocusPencil() {
    await tick();
    if (!alive()) return;
    if (pencil?.isConnected && !pencil.disabled) pencil.focus();
    else ctx.focusFallback(q.id);
  }

  // One PATCH under the per-question lock; only the fields it carried are written back.
  async function sendKey(body: QuestionUpdateBody) {
    ctx.busyQuestions.add(q.id);
    try {
      const echo = await ctx.edits.track(updateQuestion(q.id, body));
      const fields: Record<string, unknown> = {};
      for (const k of Object.keys(body)) fields[k] = echo[k as keyof AuthoringQuestion];
      ctx.patch(q.id, fields as Partial<AuthoringQuestion>);
    } catch (e) {
      ctx.failed(e, q.id);   // 403/409: the tree reloads; the editor stays open with the error
      throw e;
    } finally {
      ctx.busyQuestions.delete(q.id);
    }
  }

  function openNumber() {
    if (numEdit || editReason !== null) return;
    if (!ctx.edits.request()) return;
    const stored = q.correct_numeric;
    const storedD = q.precision;
    numEdit = new InlineEdit<NumDraft>({
      id: `key-${q.id}`,
      edits: ctx.edits,
      initial: { v: stored == null ? '' : formatNumber(stored), d: String(storedD ?? 0) },
      same: (a, b) => a.v.trim() === b.v.trim() && a.d.trim() === b.d.trim(),
      // Unchanged against the STORED key: "5.0" equals 5; an unset precision is always a change.
      unchanged: (x) => sameNumber(x.v, stored) && storedD != null && decimalsOk(x.d) && Number(x.d) === storedD,
      check: (x) => {
        const c = validateNumericAnswer(x.v);
        if (!c.ok) return c.reason;
        return decimalsOk(x.d) ? null : DEC_MSG;
      },
      confirmSend: confirmKey,
      allowed: () => ctx.canText,
      send: (x) => {
        const c = validateNumericAnswer(x.v);
        return sendKey({ correct_numeric: c.ok ? Number(c.canonical) : null, precision: Number(x.d) });
      },
      close: (refocus) => { numEdit = null; if (refocus) void refocusPencil(); },
    });
  }

  function openText() {
    if (textEdit || editReason !== null) return;
    if (!ctx.edits.request()) return;
    textEdit = new InlineEdit<string>({
      id: `key-${q.id}`,
      edits: ctx.edits,
      initial: q.correct_text ?? '',
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Enter the answer' : null),
      confirmSend: confirmKey,
      allowed: () => ctx.canText,
      send: (v) => sendKey({ correct_text: v.trim() }),
      close: (refocus) => { textEdit = null; if (refocus) void refocusPencil(); },
    });
  }

  // A 403/409 reload can take the right to save away while ✓ holds focus (R10).
  // Before the DOM disables it, focus moves to the field the author must cancel.
  let editEl = $state<HTMLElement>();
  $effect.pre(() => {
    const a = document.activeElement;
    if (numEdit && !numEdit.canSave && a?.closest('[data-glyph="check"]') && editEl?.contains(a)) {
      editEl.querySelector<HTMLInputElement>('input')?.focus();
    }
  });

  const attachNum = (el: HTMLElement) => {
    el.querySelector<HTMLInputElement>('input')?.focus();
    return untrack(() => numEdit!.attach());
  };
</script>

{#if numEdit}
  <div class="key-edit" role="group" aria-label={`Answer to question ${n}`} bind:this={editEl} {@attach attachNum}>
    <div class="key-fields">
      <label class="key-field">
        <span class="key-label">Answer</span>
        <input class="key-input mono" type="text" aria-label="Answer" maxlength="40"
               readonly={numEdit.saving} aria-invalid={numEdit.error && !decBad ? 'true' : undefined}
               aria-describedby={numEdit.error && !decBad ? errId : undefined}
               bind:value={() => numEdit?.value.v ?? '', (v) => { if (numEdit) numEdit.value.v = v; }} onkeydown={(e) => numEdit?.keydown(e)}
               oninput={() => { if (numEdit) numEdit.error = null; }} />
      </label>
      <label class="key-field">
        <span class="key-label">Decimals</span>
        <input class="key-input key-dec mono" type="text" inputmode="numeric" aria-label="Decimals" maxlength="2"
               aria-invalid={decBad ? 'true' : undefined} aria-describedby={decBad ? errId : undefined}
               readonly={numEdit.saving} bind:value={() => numEdit?.value.d ?? '', (v) => { if (numEdit) numEdit.value.d = v; }} onkeydown={(e) => numEdit?.keydown(e)}
               oninput={() => { if (numEdit) numEdit.error = null; }} />
      </label>
      <IconButton glyph="check" size="sm"
                  title={numEdit.saving ? 'Saving…' : numEdit.canSave ? 'Save answer' : FORBIDDEN_TITLE}
                  disabled={!numEdit.canSave} onclick={() => void numEdit?.commit()} />
      <IconButton glyph="close" size="sm" title="Cancel" disabled={numEdit.saving} onclick={() => numEdit?.cancel()} />
    </div>
    {#if numEdit.error}<span class="key-err" id={errId} role="alert">{numEdit.error}</span>{/if}
  </div>
{:else if textEdit}
  <InlineInput edit={textEdit} label="Answer" saveTitle="Save answer" hint="Case-insensitive, trimmed match." />
{:else}
  <div class="key-row">
    <p class="key-line">
      {#if shown == null}Answer not set{:else}Answer <strong class="key-value">{shown}</strong>{tail}{/if}
    </p>
    {#if ctx.canText}
      <IconButton glyph="pencil" size="sm" borderless bind:element={pencil}
                  title={editReason ?? 'Edit the answer'} aria-label={`Edit the answer to question ${n}`}
                  disabled={editReason !== null} onclick={isNumber ? openNumber : openText} />
    {/if}
  </div>
{/if}

<style>
  .key-row { display: flex; align-items: center; gap: 6px; }
  .key-line { margin: 0; font-size: 13.5px; color: var(--text-2); overflow-wrap: anywhere; }
  .key-value { font-weight: 600; color: var(--text); }
  .key-edit { display: flex; flex-direction: column; gap: 4px; }
  .key-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
  .key-field { display: flex; flex-direction: column; gap: 4px; }
  .key-label { font-size: 12px; color: var(--muted); }
  .key-input {
    box-sizing: border-box;
    width: 160px;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .key-dec { width: 64px; }
  .key-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  @media (forced-colors: active) { .key-input:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; } }
  .key-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .key-err { font-size: 12px; color: var(--danger); }
</style>
