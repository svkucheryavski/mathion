<script lang="ts">
  // Level 3: the explanation (spec §Level 3). Markdown with Edit/Preview in
  // the editor's no-assets mode (D11). Saving empty text — or "Remove
  // explanation" — sends explanation_md: null.
  import { getContext, untrack } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import Button from '../../ui/Button.svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import { DISCARD_PROMPT, FORBIDDEN_TITLE, type EditHandle } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { pushToast } from '../../../stores/toasts.svelte';
  import { updateQuestion, type AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n, onClose }: { q: AuthoringQuestion; n: number; onClose: (refocus: boolean) => void } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const labelId = `${uid}-title`;
  const errId = `${uid}-err`;
  const noteId = `${uid}-note`;
  const qid = untrack(() => q.id);
  const initial = untrack(() => q.explanation_md ?? '');
  const exists = initial.trim() !== '';

  let value = $state(initial);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let mounted = true;
  // Mounted AND still showing this version (spec §Stale responses).
  const alive = () => mounted && ctx.live();

  const handle: EditHandle = {
    id: `qexpl-${qid}`,
    get dirty() { return value !== initial; },
    get saving() { return saving; },
    close: (refocus) => onClose(refocus),
  };
  $effect(() => {
    untrack(() => ctx.edits.open(handle));
    return () => { mounted = false; ctx.edits.release(handle); };
  });

  function requestClose() {
    if (saving) return;
    if (handle.dirty && !window.confirm(DISCARD_PROMPT)) return;
    onClose(true);
  }

  async function send(md: string | null) {
    error = null;
    saving = true;
    try {
      const echo = await ctx.edits.track(updateQuestion(qid, { explanation_md: md }));
      // As InlineEdit.commit: never left saving, and a stale success says nothing.
      saving = false;
      ctx.patch(qid, { explanation_md: echo.explanation_md, explanation_html: echo.explanation_html });
      if (!alive()) return;
      ctx.say('Saved');
      onClose(true);
    } catch (e) {
      const m = ctx.failed(e, qid);
      if (!alive()) { saving = false; pushToast(m, 'error'); return; }
      saving = false;
      error = m;
    }
  }

  function save() {
    if (saving || !ctx.canText) return;   // R10: a lost right leaves Cancel only
    // Unchanged, or blank over no explanation: nothing to send.
    if (value === initial || (value.trim() === '' && !exists)) { onClose(true); return; }
    void send(value.trim() === '' ? null : value);
  }

  function remove() {
    if (saving || !ctx.canText) return;
    if (!window.confirm(`Remove the explanation for question ${n}?`)) return;
    void send(null);
  }

  // R10: a 403/409 reload can take the right to save away while Save or
  // Remove holds focus. Before the DOM disables it, focus moves to the text,
  // else Cancel.
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

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('section.modal-panel')?.getAttribute('aria-labelledby') !== labelId) return;
    e.preventDefault();
    save();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet head()}
  <h2 id={labelId} class="ex-title">Explanation · question {n}</h2>
  <span class="ex-sub">Shown to students after they answer.</span>
{/snippet}

{#snippet foot()}
  {#if exists}
    <!-- Stays enabled while its own request runs (re-entry is blocked in remove()), so focus is never dropped. -->
    <Button variant="danger" disabled={!ctx.canText} title={ctx.canText ? undefined : FORBIDDEN_TITLE}
            onclick={remove}>Remove explanation</Button>
  {/if}
  <span class="ex-gap"></span>
  <Button variant="ghost" disabled={saving} onclick={requestClose}>Cancel</Button>
  <Button variant="primary" loading={saving} disabled={!ctx.canText} title={ctx.canText ? undefined : FORBIDDEN_TITLE}
          onclick={save}>Save</Button>
{/snippet}

<Modal
  labelledby={labelId}
  width={560}
  onRequestClose={requestClose}
  closeDisabled={saving}
  autofocusSelector={'textarea, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <MarkdownEditor ariaLabel="Explanation" assetContext={ctx.assetContext} bind:value noAssets
                  frozen={saving} ariaDescribedby={error ? `${errId} ${noteId}` : noteId} />
  <p class="ex-note" id={noteId}>Markdown. Images already in an explanation keep working; new ones cannot be added here.</p>
  {#if error}<p class="ex-err" id={errId} role="alert">{error}</p>{/if}
</Modal>

<style>
  .ex-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .ex-sub { margin-right: auto; font-size: 12px; color: var(--muted); }   /* the × sits at the right edge */
  .ex-gap { flex: 1; }
  .ex-note { margin: 0; font-size: 12px; color: var(--muted); }
  .ex-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
