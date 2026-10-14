<script lang="ts">
  // Level 3: New question (spec §Adding a question). The type picker first —
  // a type change alone is not a change — then the question text with assets,
  // and the Number / Text answer. "Add question" sends ONE create with all
  // fields; on success the quiz body closes this modal and moves focus.
  import { getContext, untrack } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import Button from '../../ui/Button.svelte';
  import AskSlot from '../../ui/AskSlot.svelte';
  import { DISCARD_ASK, focusAfter, modalClose, useModalAsk } from '../../../lib/askInPlace.svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import QuestionTypePicker from '../QuestionTypePicker.svelte';
  import { ApiError } from '../../../lib/api';
  import { FORBIDDEN_TITLE, type EditHandle } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { pushToast } from '../../../stores/toasts.svelte';
  import { validateNumericAnswer, type QuestionCreateBody, type QuestionType } from '../../../lib/quizAuthoring';

  let { onCreate, onClose }: {
    onCreate: (body: QuestionCreateBody) => Promise<void>;   // throws on failure
    onClose: (refocus: boolean) => void;
  } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const labelId = `${uid}-title`;
  const numErrId = `${uid}-num-err`;
  const decErrId = `${uid}-dec-err`;

  let type = $state<QuestionType>('single_choice');
  let text = $state('');
  let numeric = $state('');
  let decimals = $state('0');
  let answer = $state('');
  let saving = $state(false);
  let uploading = $state(false);
  let error = $state<string | null>(null);
  let mounted = true;
  // Mounted AND still showing this version (spec §Stale responses).
  const alive = () => mounted && ctx.live();

  const numCheck = $derived(validateNumericAnswer(numeric));
  const numError = $derived(numeric.trim() !== '' && !numCheck.ok ? numCheck.reason : null);
  const decimalsOk = $derived(/^\d{1,2}$/.test(decimals.trim()) && Number(decimals) <= 10);
  const valid = $derived(
    text.trim() !== '' && (
      type === 'numeric_answer' ? numCheck.ok && decimalsOk
        : type === 'text_answer' ? answer.trim() !== '' : true),
  );

  const handle: EditHandle = {
    id: 'new-question',
    // Any field the chosen type shows, against its default — the type alone is not a change.
    get dirty() {
      return text !== '' || (type === 'numeric_answer' ? numeric !== '' || decimals !== '0'
        : type === 'text_answer' ? answer !== '' : false);
    },
    get saving() { return saving; },
    close: (refocus) => onClose(refocus),
  };
  $effect(() => {
    untrack(() => ctx.edits.open(handle));
    return () => { mounted = false; ctx.edits.release(handle); };
  });

  // Polish 1: the close question in place of the footer buttons (#7, #13, #15),
  // and the page question while this is the top modal (R46).
  const { own: footAsk, page, here } = useModalAsk(labelId);
  const asking = $derived(footAsk.open || here());
  let cancelEl = $state<HTMLButtonElement>();

  async function requestClose(from: 'x' | 'cancel') {
    if (saving) return;
    // × and Esc while a question shows: back to its Cancel (R48).
    if (footAsk.open) { footAsk.focusCancel(); return; }
    if (here()) { page!.ask.focusCancel(); return; }
    if (!handle.dirty) { onClose(true); return; }
    const a = await footAsk.ask(DISCARD_ASK);
    if (a === 'confirm') {
      footAsk.settle();
      if (mounted) onClose(true);
      return;
    }
    // Back to the control that asked; Esc counts as ×.
    if (a === 'cancel') void focusAfter(() => (from === 'cancel' ? cancelEl : modalClose(labelId)));
  }

  function body(): QuestionCreateBody {
    const base = { text_md: text.trim(), type };
    if (type === 'numeric_answer' && numCheck.ok) {
      return { ...base, correct_numeric: Number(numCheck.canonical), precision: Number(decimals) };
    }
    if (type === 'text_answer') return { ...base, correct_text: answer.trim() };
    return base;   // choice: answers are added on the card
  }

  async function save() {
    if (saving || uploading || !valid || !ctx.canStruct) return;   // R10
    error = null;
    saving = true;
    try {
      await onCreate(body());
      saving = false;   // on success the quiz body unmounts this; a stale one must not stay locked
    } catch (e) {
      const m = e instanceof ApiError ? e.displayMessage : 'Add failed';
      if (!alive()) { saving = false; pushToast(m, 'error'); return; }
      saving = false;
      error = m;
    }
  }

  // R10: a 403/409 reload can take the right to add away while "Add question"
  // holds focus. Before the DOM disables it, focus moves to the text, else Cancel.
  $effect.pre(() => {
    if (ctx.canStruct) return;
    const a = document.activeElement;
    if (a instanceof HTMLElement && a.closest('footer.modal-foot')
        && a.closest('section.modal-panel')?.getAttribute('aria-labelledby') === labelId) {
      const panel = a.closest('section.modal-panel');
      // Preview mode has no textarea: then Cancel, which a lost right leaves enabled.
      const cancel = [...(panel?.querySelectorAll<HTMLButtonElement>('footer.modal-foot button') ?? [])]
        .find((b) => b.textContent?.trim() === 'Cancel');
      (panel?.querySelector<HTMLTextAreaElement>('textarea') ?? cancel)?.focus();
    }
  });

  // ⌘S means this modal's "Add question" — only for events from this panel.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('section.modal-panel')?.getAttribute('aria-labelledby') !== labelId) return;
    e.preventDefault();
    if (!asking) void save();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet head()}
  <h2 id={labelId} class="nq-title">New question</h2>
{/snippet}

{#snippet foot()}
  <span class="nq-gap"></span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={saving} bind:element={cancelEl} onclick={() => void requestClose('cancel')}>Cancel</Button>
    <Button variant="primary" loading={saving} disabled={!valid || uploading || !ctx.canStruct}
            title={ctx.canStruct ? undefined : FORBIDDEN_TITLE} onclick={() => void save()}>Add question</Button>
  {/if}
{/snippet}

<Modal
  labelledby={labelId}
  width={760}
  onRequestClose={() => void requestClose('x')}
  bodyInert={asking}
  closeDisabled={saving}
  autofocusSelector={'input[type="radio"]:checked, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <QuestionTypePicker bind:value={type} disabled={saving} />
  <MarkdownEditor ariaLabel="Question text" assetContext={ctx.assetContext} bind:value={text} bind:uploading frozen={saving} />
  {#if type === 'numeric_answer'}
    <div class="nq-row">
      <label class="nq-field">
        <span class="nq-label">Answer</span>
        <input class="nq-input mono" type="text" aria-label="Answer" maxlength="40" readonly={saving}
               aria-invalid={numError ? 'true' : undefined} aria-describedby={numError ? numErrId : undefined}
               bind:value={numeric} />
      </label>
      <label class="nq-field">
        <span class="nq-label">Decimals</span>
        <input class="nq-input nq-dec mono" type="text" inputmode="numeric" aria-label="Decimals" maxlength="2"
               readonly={saving} aria-invalid={decimalsOk ? undefined : 'true'}
               aria-describedby={decimalsOk ? undefined : decErrId} bind:value={decimals} />
      </label>
    </div>
    {#if numError}<p class="nq-err" id={numErrId}>{numError}</p>{/if}
    {#if !decimalsOk}<p class="nq-err" id={decErrId}>Decimals must be a whole number from 0 to 10.</p>{/if}
  {:else if type === 'text_answer'}
    <label class="nq-field">
      <span class="nq-label">Answer</span>
      <input class="nq-input" type="text" aria-label="Answer" maxlength="500" readonly={saving} bind:value={answer} />
    </label>
    <p class="nq-hint">Case-insensitive, trimmed match.</p>
  {/if}
  {#if error}<p class="nq-err" role="alert">{error}</p>{/if}
</Modal>

<style>
  .nq-title { margin: 0 auto 0 0; font-size: 15px; font-weight: 600; color: var(--text); }   /* the × sits at the right edge */
  .nq-gap { flex: 1; }
  .nq-row { display: flex; flex-wrap: wrap; gap: 12px; }
  .nq-field { display: flex; flex-direction: column; gap: 4px; }
  .nq-label { font-size: 12.5px; color: var(--muted); }
  .nq-input {
    box-sizing: border-box;
    width: 220px;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .nq-dec { width: 64px; }
  .nq-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  @media (forced-colors: active) { .nq-input:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; } }
  .nq-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .nq-err { margin: 0; font-size: 12px; color: var(--danger); }
  .nq-hint { margin: 0; font-size: 12px; color: var(--muted); }
</style>
