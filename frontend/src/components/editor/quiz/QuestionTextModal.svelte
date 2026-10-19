<script lang="ts">
  // Level 3: the question text (spec §Level 3). A modal stacked on the quiz
  // modal. It holds the edit slot while open, so a page discard closes it and
  // its changes count as unsaved work. Save sends one PATCH and closes.
  import { getContext, untrack } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import Button from '../../ui/Button.svelte';
  import AskSlot from '../../ui/AskSlot.svelte';
  import { DISCARD_ASK, focusAfter, modalClose, useModalAsk } from '../../../lib/askInPlace.svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import { FORBIDDEN_TITLE, type EditHandle } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { TYPE_LABEL } from '../../../lib/quizFormat';
  import { pushToast } from '../../../stores/toasts.svelte';
  import { updateQuestion, type AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n, onClose }: { q: AuthoringQuestion; n: number; onClose: (refocus: boolean) => void } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const labelId = `${uid}-title`;
  const errId = `${uid}-err`;
  const qid = untrack(() => q.id);
  const initial = untrack(() => q.text_md);

  let value = $state(initial);
  let saving = $state(false);
  let uploading = $state(false);
  let error = $state<string | null>(null);
  let mounted = true;
  // Mounted AND still showing this version (spec §Stale responses).
  const alive = () => mounted && ctx.live();

  const handle: EditHandle = {
    id: `qtext-${qid}`,
    get dirty() { return value !== initial; },
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

  async function save() {
    if (saving || uploading || !ctx.canText) return;   // R10: a lost right leaves Cancel only
    if (value.trim() === '') { error = 'Enter the question text'; return; }
    if (value === initial) { onClose(true); return; }
    error = null;
    saving = true;
    try {
      const echo = await ctx.edits.track(updateQuestion(qid, { text_md: value }));
      // As InlineEdit.commit: never left saving, and a stale success says nothing.
      saving = false;
      ctx.patch(qid, { text_md: echo.text_md, text_html: echo.text_html });
      if (!alive()) return;
      ctx.say('Saved');
      onClose(true);
    } catch (e) {
      const m = ctx.failed(e, qid);
      // A failed save always reports: inside the modal, or as a toast once it is gone.
      if (!alive()) { saving = false; pushToast(m, 'error'); return; }
      saving = false;
      error = m;
    }
  }

  // R10: a 403/409 reload can take the right to save away while Save holds
  // focus. Before the DOM disables it, focus moves to the text, else Cancel.
  $effect.pre(() => {
    if (ctx.canText) return;
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

  // ⌘S means this modal's Save — only for events from this panel.
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
  <h2 id={labelId} class="qt-title">Question {n}</h2>
  <span class="qt-sub">{TYPE_LABEL[q.type]}</span>
{/snippet}

{#snippet foot()}
  <span class="qt-gap"></span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={saving} bind:element={cancelEl} onclick={() => void requestClose('cancel')}>Cancel</Button>
    <Button variant="primary" loading={saving} disabled={uploading || !ctx.canText}
            title={!ctx.canText ? FORBIDDEN_TITLE : uploading ? 'Wait for the upload to finish' : undefined}
            onclick={() => void save()}>Save</Button>
  {/if}
{/snippet}

<Modal
  labelledby={labelId}
  width={760}
  onRequestClose={() => void requestClose('x')}
  bodyInert={asking}
  closeDisabled={saving}
  autofocusSelector={'textarea, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <MarkdownEditor ariaLabel="Question text" variant="prompt" assetContext={ctx.assetContext} bind:value bind:uploading
                  frozen={saving} ariaDescribedby={error ? errId : undefined} />
  {#if error}<p class="qt-err" id={errId} role="alert">{error}</p>{/if}
</Modal>

<style>
  .qt-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .qt-sub { margin-right: auto; font-size: 12px; color: var(--muted); }   /* the × sits at the right edge */
  .qt-gap { flex: 1; }
  .qt-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
