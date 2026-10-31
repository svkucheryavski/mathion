<script lang="ts">
  // "+ Add item" (Slice-5c D10): pick a type, a title and, for a video, its
  // URL. A page asks only for the title (the user, 2026-10-08): it is created
  // with a "# <title>" starter, since ItemCreate requires content_md, and its
  // content is written in the item editor right after. `onCreate` owns the
  // request, the reload and the navigation into the new item's editor (R1: a
  // push), and THROWS on failure so the
  // errors land on these fields. Not a route: closing asks in the footer before
  // dropping typed input; browser Back goes through the page guard (tracker.discard).
  import { getContext, onDestroy } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import AskSlot from '../ui/AskSlot.svelte';
  import { DISCARD_ASK, focusAfter, modalClose, repairFocus, useModalAsk } from '../../lib/askInPlace.svelte';
  import ItemTypePicker from './ItemTypePicker.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { pushToast } from '../../stores/toasts.svelte';
  import { focusFirst } from '../../lib/focusFirst';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';

  type ItemType = 'static_page' | 'video' | 'quiz' | 'interactive_app';
  type Props = {
    blockTitle: string;
    seqTitle: string;
    position: number;
    onCreate: (body: Record<string, unknown>) => Promise<void>;
    onClose: () => void;
  };
  let { blockTitle, seqTitle, position, onCreate, onClose }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;
  const errId = (field: string) => `${uid}-${field}-err`;

  let type = $state<ItemType>('static_page');
  let title = $state('');
  let videoUrl = $state('');
  let errors = $state<FieldErrors>({});
  let globalError = $state<string | null>(null);
  let busy = $state(false);
  let titleEl = $state<HTMLInputElement>();
  let createEl = $state<HTMLButtonElement>();
  let videoEl = $state<HTMLInputElement>();
  let alive = true;
  onDestroy(() => { alive = false; });

  const dirty = $derived(
    title.trim() !== '' || (type === 'video' && videoUrl.trim() !== ''),
  );
  const ready = $derived(
    title.trim() !== ''
      // Spec D10: the URL is required and http(s)://.
      && (type !== 'video' || /^https?:\/\/\S/i.test(videoUrl.trim())),
  );

  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = {
    get isDirty() { return dirty; },
    discard() { onClose(); },
  };
  $effect(() => {
    if (!registry) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  // Polish 1: the close question in place of the footer buttons (#11), and the
  // page question while this is the top modal (R46).
  const { own: footAsk, page, here } = useModalAsk(labelId);
  let cancelEl = $state<HTMLButtonElement>();

  async function requestClose(from: 'x' | 'cancel') {
    if (busy) return;
    if (footAsk.open) { footAsk.focusCancel(); return; }
    if (here()) { page!.ask.focusCancel(); return; }
    if (!dirty) { onClose(); return; }
    const a = await footAsk.ask(DISCARD_ASK);
    if (a === 'confirm') {
      footAsk.settle();
      if (alive) onClose();
      return;
    }
    // Back to the control that asked; Esc counts as ×.
    if (a === 'cancel') void focusAfter(() => (from === 'cancel' ? cancelEl : modalClose(labelId)));
  }

  async function submit() {
    if (busy || !ready) return;
    const body: Record<string, unknown> = { title, type };
    if (type === 'static_page') body.content_md = `# ${title.trim()}\n`;
    if (type === 'video') body.video_url = videoUrl;
    errors = {};
    globalError = null;
    busy = true;
    try {
      await onCreate(body);
    } catch (e) {
      // Only the fields shown here; anything else (content_md, type) goes to
      // the alert rather than onto a field nobody can see.
      const known = type === 'video' ? ['title', 'video_url'] : ['title'];
      const mapped = mapCreateError(e, known);
      if (!alive) {
        pushToast(mapped.globalMessage ?? Object.values(mapped.fieldErrors)[0] ?? 'Create failed', 'error');
        return;
      }
      errors = mapped.fieldErrors;
      globalError = mapped.globalMessage ?? (Object.keys(mapped.fieldErrors).length === 0 ? 'Create failed' : null);
      // F4: to the field the error names (a 409 "title taken"); otherwise focus stays on Create.
      focusFirst([errors.title ? titleEl : null, errors.video_url ? videoEl : null]);
    } finally {
      // F4: Cancel and × are disabled while busy; a focus the browser dropped there comes back.
      if (alive) { busy = false; void repairFocus(createEl, titleEl); }
    }
  }
</script>

{#snippet head()}
  <h2 id={labelId} class="nm">New item</h2>
  <span class="ctx">{blockTitle} › {seqTitle} · will be item {position} of {position}</span>
{/snippet}

{#snippet foot()}
  <!-- Pushes the buttons right, as the item editor's footer (its .dirty slot). -->
  <span class="spacer" aria-hidden="true"></span>
  {#if footAsk.open}
    <AskSlot ask={footAsk} />
  {:else if here()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button variant="ghost" disabled={busy} bind:element={cancelEl} onclick={() => void requestClose('cancel')}>Cancel</Button>
    <!-- F4: busy keeps Create focusable with its spinner; submit() returns while busy. -->
    <Button variant="primary" disabled={!busy && !ready} loading={busy} bind:element={createEl} onclick={() => void submit()}>Create</Button>
  {/if}
{/snippet}

<Modal labelledby={labelId} width={640} maxHeight={600} onRequestClose={() => void requestClose('x')} closeDisabled={busy}
  bodyInert={footAsk.open || here()} header={head} footer={foot}>
  <form class="form" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <ItemTypePicker bind:value={type} />
    <div class="field-row">
      <span class="field-label">Title</span>
      <div class="field">
        <input class="plain-input" data-autofocus aria-label="Title" maxlength={200} bind:value={title} bind:this={titleEl} readonly={busy}
          aria-invalid={errors.title ? 'true' : undefined}
          aria-describedby={errors.title ? errId('title') : undefined}
          oninput={() => { if (errors.title) errors = { ...errors, title: '' }; }} />
        {#if errors.title}<small id={errId('title')} class="field-err">{errors.title}</small>{/if}
      </div>
    </div>
    {#if type === 'video'}
      <div class="field-row">
        <span class="field-label">Video URL</span>
        <div class="field">
          <input class="plain-input" type="url" aria-label="Video URL" placeholder="https://…" bind:value={videoUrl} bind:this={videoEl} readonly={busy}
            aria-invalid={errors.video_url ? 'true' : undefined}
            aria-describedby={errors.video_url ? errId('video') : undefined}
            oninput={() => { if (errors.video_url) errors = { ...errors, video_url: '' }; }} />
          {#if errors.video_url}<small id={errId('video')} class="field-err">{errors.video_url}</small>{/if}
        </div>
      </div>
    {/if}
    {#if globalError}<p class="field-err" role="alert">{globalError}</p>{/if}
  </form>
</Modal>

<style>
  .nm { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  /* Fills the head row, so Modal's × sits at the far right (as the item editor's). */
  .ctx { flex: 1 1 auto; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .spacer { flex: 1; }
  .form { display: flex; flex-direction: column; gap: 12px; }
  /* The 5b item-modal field look (ItemEditorModal .field-row / .plain-input). */
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
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
  .plain-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
