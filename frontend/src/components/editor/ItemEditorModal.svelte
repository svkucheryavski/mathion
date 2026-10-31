<script lang="ts">
  // The item editor (Slice-5b §2): one modal for page / video / quiz /
  // interactive-app items, hosted by VersionEditPage while the item is in the
  // URL (D1). It owns the Title field, the footer Save/Discard (+ ⌘S), the one
  // tracker registered in the page's dirty registry, and the D9 delete freeze.
  // The type body owns everything else through ItemBodyApi (lib/itemBody.ts).
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import Modal, { isTopModal } from '../ui/Modal.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Button from '../ui/Button.svelte';
  import AskSlot from '../ui/AskSlot.svelte';
  import { focusAfter, modalClose, modalPanel, repairFocus, usable, useModalAsk } from '../../lib/askInPlace.svelte';
  import ItemMark from '../course/ItemMark.svelte';
  import PageBody from './item/PageBody.svelte';
  import VideoBody from './item/VideoBody.svelte';
  import QuizBody from './quiz/QuizBody.svelte';
  import AppBody from './item/AppBody.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { structureReason } from '../../lib/editorReasons';
  import { courseAssetContext } from '../../lib/assetContext';
  import { patchItem, reportSaveFailure, type ItemBodyApi, type SaveOutcome } from '../../lib/itemBody';
  import { loadAdminTree, type LoadResult } from '../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { ApiError } from '../../lib/api';
  import { FORBIDDEN_TITLE, InlineEdit, WAIT_TITLE } from '../../lib/quizEdits.svelte';
  import { renameItem } from '../../lib/quizAuthoring';
  import type { AdminTreeItem, AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';

  type Props = {
    vid: number;
    version: AdminTreeVersion;
    perms: VersionPermissions;
    // Slice-5c D11: the context line names the path, not "S1".
    blockTitle: string;
    seqTitle: string;
    item: AdminTreeItem;
    itemIndex: number;
    itemCount: number;
    stillOnVid: (savedVid: number) => boolean;
    onRequestClose: () => void;
    // #19: called after the body-top question's Delete; resolves when the page's DELETE settles.
    onDeleteItem: () => Promise<void>;
    // D9: the page's DELETE for THIS item is in flight.
    deleting?: boolean;
  };
  let {
    vid, version, perms, blockTitle, seqTitle, item, itemIndex, itemCount,
    stillOnVid, onRequestClose, onDeleteItem, deleting = false,
  }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-name`;
  const titleErrId = `${uid}-title-err`;
  const titleEditId = `${uid}-title-edit`;

  const versionDisabled = $derived(version.is_disabled);
  const canEditText = $derived(perms.canEditTextFields);
  // Slice-5d: a quiz saves each edit itself — no footer, no body Title row.
  const isQuiz = $derived(item.type === 'quiz');
  // ---- Polish 1: the body-top row (#19) and the page question while this is
  //      the top modal (R46). Without a footer (a quiz, a read-only item) the
  //      page question asks in the body-top row too; R53 keeps the two apart.
  const { own: bodyAsk, page, here: pageHere } = useModalAsk(labelId);
  const hasFoot = $derived(canEditText && !isQuiz);
  const asking = $derived(bodyAsk.open || pageHere());
  // Memoised per vid (as ItemEditPage did): bodies compare it by identity.
  const assetContext = $derived(courseAssetContext(vid));

  // ---- Title draft. Seeded once per mount ({#key item.id} upstream); a tree
  //      reload never re-seeds. `savedTitle` is the last server echo. ----
  let savedTitle = untrack(() => item.title);
  const titleTracker = makeDirtyTracker({ title: savedTitle });
  const titleDirty = $derived(titleTracker.isDirty);
  let titleError = $state<string | null>(null);
  let titleEl = $state<HTMLInputElement>();

  // ---- The type body (§2 contract). VideoBody has no `busy` (nothing
  //      uploads); AppBody has no drafts (its script row acts immediately), so
  //      it binds `busy` only. ----
  let body = $state<ItemBodyApi | null>(null);
  let bodySaveDirty = $state(false);
  let bodyGuardDirty = $state(false);
  let bodyBusy = $state(false);

  let saving = $state(false);
  const frozen = $derived(saving || deleting);
  const saveDirty = $derived(titleDirty || bodySaveDirty);    // footer, Save, Discard
  const guardDirty = $derived(titleDirty || bodyGuardDirty);  // the prompt, D9's delete gate
  const saveBlocked = $derived(!canEditText || !saveDirty || frozen || bodyBusy);
  // Polish 3 C7 (F3): "nothing to save / discard" and a body upload block the
  // footer with aria-disabled, which keeps focus; a busy Save keeps its
  // spinner. Native disabled stays only for the delete freeze (Save) and for
  // `frozen` (Discard).
  const saveAriaBlocked = $derived(!saving && (!canEditText || !saveDirty || bodyBusy));
  const discardAriaBlocked = $derived(!saveDirty || bodyBusy);
  let saveBtn = $state<HTMLButtonElement>();
  const footTitle = (none: string) =>
    (saving ? undefined : bodyBusy ? 'Wait for the upload to finish' : saveDirty ? undefined : none);

  let alive = true;
  onDestroy(() => { alive = false; });

  // ---- Slice-5d: the quiz's inline title (5c D8 rules). It takes the quiz
  //      body's one edit slot, so D10 and the page's DirtyGuard cover it. ----
  const quizEdits = $derived(isQuiz ? (body?.edits ?? null) : null);
  let shownTitle = $state(untrack(() => item.title));   // the last server echo
  let titleEdit = $state<InlineEdit<string> | null>(null);
  let titleEditBtn = $state<HTMLButtonElement>();
  // A tree reload (renamed elsewhere) shows through while no edit is open.
  $effect(() => {
    const t = item.title;
    untrack(() => { if (!titleEdit) shownTitle = t; });
  });

  async function openTitle() {
    if (!quizEdits || titleEdit || deleting || asking || quizEdits.locked) return;
    const edits = quizEdits;
    if (!(await edits.request())) return;
    // R49: re-checked after the D10 question.
    if (!alive || quizEdits !== edits || titleEdit || deleting || asking || edits.locked || !perms.canEditTextFields) return;
    const savedVid = vid;
    titleEdit = new InlineEdit<string>({
      id: 'title',
      edits,
      // The header has no room: the title's D10 question asks in the body-top row (#14).
      asking: bodyAsk,
      initial: shownTitle,
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Title is required' : null),
      allowed: () => perms.canEditTextFields,
      send: async (v) => {
        try {
          const echo = await renameItem(item.id, v.trim());
          if (alive && stillOnVid(savedVid)) shownTitle = echo.title;
          if (stillOnVid(savedVid)) void loadAdminTree(savedVid, { force: true });
        } catch (e) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(savedVid)) {
            void loadAdminTree(savedVid, { force: true });
          }
          throw e;
        }
      },
      close: (refocus) => {
        titleEdit = null;
        if (!refocus) return;
        // Back to ✎ — or to × when a 403/409 reload removed it.
        void tick().then(() => {
          if (!alive) return;
          if (titleEditBtn?.isConnected) titleEditBtn.focus();
          else trashEl?.closest('section.modal-panel')
            ?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]')?.focus();
        });
      },
    });
  }
  // The field focuses itself and holds the slot while mounted.
  const attachTitle = (el: HTMLInputElement) => {
    el.focus();
    el.select();
    return untrack(() => titleEdit!.attach(el));
  };
  // Polish 3 F6 (InlineInput's R10): a 403/409 reload can take the right to
  // save away while ✓ holds focus. Before the DOM disables it, focus moves to
  // the field the author must cancel.
  let titleOkEl = $state<HTMLButtonElement>();
  $effect.pre(() => {
    if (titleEdit && !titleEdit.canSave && titleOkEl && document.activeElement === titleOkEl) titleEdit.fieldEl?.focus();
  });

  // ---- One tracker in the page registry (D5): the page's DirtyGuard prompts
  //      on ×, Escape, Back and every in-app navigation. ----
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const pageTracker: RegisteredTracker = {
    get isDirty() { return guardDirty; },
    discard() { resetTitle(); body?.discardAll(); },
  };
  $effect(() => {
    if (!registry) return;
    registry.register(pageTracker);
    return () => registry.unregister(pageTracker);
  });

  function resetTitle() {
    titleTracker.reset({ title: savedTitle });
    titleError = null;
  }

  function validateTitle(): boolean {
    titleError = titleDirty && titleTracker.current.title.trim() === '' ? 'Title is required' : null;
    return titleError === null;
  }

  // No body (an item type this modal can't edit): the modal sends the title itself.
  async function saveTitleOnly(titleDraft: string | undefined): Promise<SaveOutcome> {
    if (titleDraft === undefined) return { outcome: 'ok' };
    const savedVid = vid;
    try {
      const echo = await patchItem(item.id, { title: titleDraft });
      return { outcome: 'ok', savedTitle: echo.title };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }

  async function save() {
    if (saveBlocked) return;
    // R9: the body validates first (and focuses its first invalid field); an
    // invalid Title then takes focus, because it is first on screen.
    const bodyOk = body ? body.validate() : true;
    const titleOk = validateTitle();
    if (!titleOk) titleEl?.focus();
    if (!bodyOk || !titleOk) {
      pushToast('Fix the highlighted fields', 'error');
      return;
    }
    const savedVid = vid;
    const titleDraft = titleDirty ? titleTracker.current.title : undefined;
    saving = true;
    try {
      const res = body ? await body.save(titleDraft) : await saveTitleOnly(titleDraft);
      if (alive && res.savedTitle !== undefined) {
        savedTitle = res.savedTitle;
        titleTracker.reset({ title: res.savedTitle });
      }
      if (res.outcome === 'failed') return;
      // D10: any success reloads the tree (header, item rows, `used` badges);
      // inputs stay frozen until it settles. Baselines came from the PATCH
      // echoes — nothing is re-seeded from the fresh tree.
      let refresh: LoadResult = 'discarded';
      if (stillOnVid(savedVid)) refresh = await loadAdminTree(savedVid, { force: true });
      // 'discarded' = the PATCH landed, only the refetch was superseded → "Saved".
      // A partial outcome's message was already toasted by the body.
      if (res.outcome === 'ok') {
        if (refresh === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
        else pushToast('Saved', 'success');
      }
    } finally {
      if (alive) {
        saving = false;
        // Discard and × were disabled while it ran; a ⌘S from one of them left
        // focus on <body>.
        void repairFocus(saveBtn, titleEl, modalClose(labelId));
      }
    }
  }

  function discard() {
    if (frozen || bodyBusy || !saveDirty) return;
    resetTitle();
    body?.discard();
  }

  // ⌘S / Ctrl+S inside this dialog only (D10). Default-prevented even when
  // blocked, so the browser's own Save dialog never opens over the editor.
  // Slice-5d: a level-3 modal on top handles its own ⌘S, and a quiz has no
  // Save, so there it is only swallowed. Polish 3 C7: with focus on <body>
  // (a control disabled under it), the top modal takes it.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element)) return;
    const loose = (e.target === document.body || e.target === document.documentElement) && isTopModal(modalPanel(labelId));
    if (!loose && e.target.closest('section.modal-panel')?.getAttribute('aria-labelledby') !== labelId) return;
    e.preventDefault();
    if (!isQuiz && !asking) void save();   // R48: nothing saves while a question asks
  }

  // ---- D9: the header trash. The page owns the delete flow. ----
  const structReason = $derived(structureReason(version));
  // Slice-5d: a quiz names which wait applies; the unsaved edit wins, because
  // it is the one the author has to act on.
  const trashTitle = $derived(
    structReason ?? (
      guardDirty
        ? (isQuiz ? 'Delete this item — finish or discard the open edit first'
                  : 'Delete this item — save or discard changes first')
        : isQuiz && bodyBusy ? 'Delete this item — wait for the save to finish' : 'Delete this item'
    ),
  );
  const trashDisabled = $derived(!!structReason || guardDirty || bodyBusy || frozen);
  let trashEl = $state<HTMLButtonElement>();
  // #19: the delete asks in the body-top row; the page owns the DELETE (D9).
  async function askDelete() {
    if (trashDisabled || asking) return;
    const a = await bodyAsk.ask({
      warning: `Delete item "${item.title}"? This cannot be undone.`,
      confirmLabel: 'Delete', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-delete-item',
    });
    // After the question goes: the trash, else × (the trash disables when the
    // right to delete goes), never <body>.
    const back = () => [trashEl, modalClose(labelId)].find(usable);
    if (a === 'cancel') { void focusAfter(back); return; }
    if (a !== 'confirm') return;
    // R49: a save or an edit may have started while it asked.
    if (!alive || trashDisabled) {
      const free = bodyAsk.focusFree;
      bodyAsk.dismiss();
      if (alive && free) void focusAfter(back);
      return;
    }
    try {
      await onDeleteItem();
    } finally {
      // Success unmounts this modal; a failure brings focus back to the trash
      // if it was still in the question (R54, R57).
      if (alive) {
        const free = bodyAsk.focusFree;
        bodyAsk.settle();
        if (free) void focusAfter(back);
      }
    }
  }

  // × and Esc: while the body-top row asks, back to its Cancel (R48). The page
  // handles its own question (VersionEditPage.requestCloseItem).
  function requestClose() {
    if (bodyAsk.open) { bodyAsk.focusCancel(); return; }
    onRequestClose();
  }
  // A failed DELETE un-freezes the modal: focus goes back to the trash, or to ×
  // if the trash is still disabled (the disabled trash had dropped it to body).
  let wasDeleting = untrack(() => deleting);
  $effect(() => {
    const now = deleting;
    if (wasDeleting && !now) {
      void tick().then(() => {
        if (!alive || !trashEl) return;
        const next = !trashEl.disabled
          ? trashEl
          : trashEl.closest('section.modal-panel')
              ?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]');
        next?.focus();
      });
    }
    wasDeleting = now;
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet head()}
  <span class="mark-slot"><ItemMark type={item.type} state="covered" /></span>
  <h2 id={labelId} class="item-name" class:editing={!!titleEdit}>
    {#if titleEdit}
      <input
        class="plain-input title-input"
        type="text"
        aria-label="Title"
        maxlength="200"
        readonly={titleEdit.saving || titleEdit.asking.open}
        aria-invalid={titleEdit.error ? 'true' : undefined}
        aria-describedby={titleEdit.error ? titleErrId : undefined}
        bind:value={
          // Null-safe: Svelte re-reads a bound value a tick after each input,
          // and Esc or a page discard can close the edit within that tick.
          () => titleEdit?.value ?? '', (v) => { if (titleEdit) titleEdit.value = v; }
        }
        onkeydown={(e) => titleEdit?.keydown(e)}
        oninput={() => { if (titleEdit) titleEdit.error = null; }}
        {@attach attachTitle}
      />
    {:else}{isQuiz ? shownTitle : item.title}{/if}
  </h2>
  {#if titleEdit}
    <IconButton glyph="check" size="sm"
                title={titleEdit.saving ? 'Saving…' : titleEdit.canSave ? 'Save title' : FORBIDDEN_TITLE}
                disabled={!titleEdit.canSave} bind:element={titleOkEl} onclick={() => void titleEdit?.commit()} />
    <IconButton glyph="close" size="sm" title="Cancel" disabled={titleEdit.saving}
                onclick={() => titleEdit?.cancel()} />
  {:else if isQuiz && canEditText}
    <IconButton glyph="pencil" size="sm" borderless id={titleEditId} bind:element={titleEditBtn}
                title={asking ? 'Answer the question first' : quizEdits?.locked ? WAIT_TITLE : 'Edit title'}
                aria-label="Edit title" aria-disabled={asking}
                disabled={!!quizEdits?.locked || deleting} onclick={openTitle} />
  {/if}
  <span class="item-ctx">{blockTitle} › {seqTitle} · item {itemIndex} of {itemCount}</span>
  <span class="head-actions">
    <IconButton
      glyph="trash"
      size="sm"
      danger
      title={asking ? 'Answer the question first' : trashTitle}
      aria-label="Delete item"
      aria-disabled={asking}
      disabled={trashDisabled}
      bind:element={trashEl}
      onclick={() => void askDelete()}
    />
  </span>
{/snippet}

{#snippet foot()}
  <span class="dirty mono">{saveDirty ? 'unsaved changes' : ''}</span>
  {#if pageHere()}
    <AskSlot ask={page!.ask} />
  {:else}
    <Button
      variant="ghost"
      disabled={frozen}
      aria-disabled={discardAriaBlocked}
      title={footTitle('No changes to discard')}
      onclick={discard}
    >Discard</Button>
    <Button
      variant="primary"
      disabled={deleting}
      aria-disabled={saveAriaBlocked}
      title={footTitle('No changes to save')}
      loading={saving}
      bind:element={saveBtn}
      onclick={() => void save()}
    >Save</Button>
  {/if}
{/snippet}

<Modal
  labelledby={labelId}
  autofocusSelector={`#${titleEditId}, [data-autofocus], header.modal-head button[aria-label="Close"]`}
  onRequestClose={requestClose}
  closeDisabled={deleting || saving}
  header={head}
  footer={hasFoot ? foot : undefined}
>
  {#if bodyAsk.open}
    <AskSlot ask={bodyAsk} />
  {:else if pageHere() && !hasFoot}
    <AskSlot ask={page!.ask} />
  {/if}
  <!-- R48: the rest of the body freezes while a question asks or the item
       deletes; the question itself stays live (so no bodyInert). The
       attribute, not the property: jsdom lacks `inert`. -->
  <div class="body-rest" {@attach (el) => { el.toggleAttribute('inert', deleting || asking); }}>
    {#if titleEdit?.error}<p class="field-err" id={titleErrId} role="alert">{titleEdit.error}</p>{/if}
    {#if !isQuiz}
      <div class="field-row">
        <span class="field-label">Title</span>
        {#if canEditText}
          <div class="field">
            <input
              bind:this={titleEl}
              class="plain-input"
              type="text"
              aria-label="Title"
              maxlength="200"
              required
              data-autofocus
              readonly={frozen}
              aria-invalid={titleError ? 'true' : undefined}
              aria-describedby={titleError ? titleErrId : undefined}
              bind:value={titleTracker.current.title}
              oninput={() => { if (titleError) titleError = null; }}
            />
            {#if titleError}<p class="field-err" id={titleErrId}>{titleError}</p>{/if}
          </div>
        {:else}
          <span class="ro-value">{item.title}</span>
        {/if}
      </div>
    {/if}

    {#if versionDisabled}
      <!-- A video's preview is an external iframe and still shows (§4), so its
           note names only editing (user, T3c review). -->
      <p class="ro-note">
        {item.type === 'video'
          ? 'Editing is unavailable while this version is disabled — enable it to edit.'
          : 'Preview is unavailable while this version is disabled — enable it to preview or edit.'}
      </p>
    {/if}

    {#if item.type === 'static_page'}
      <PageBody
        bind:this={body}
        {item}
        {vid}
        {assetContext}
        editable={canEditText}
        {versionDisabled}
        {frozen}
        {stillOnVid}
        bind:saveDirty={bodySaveDirty}
        bind:guardDirty={bodyGuardDirty}
        bind:busy={bodyBusy}
      />
    {:else if item.type === 'video'}
      <VideoBody
        bind:this={body}
        {item}
        {vid}
        editable={canEditText}
        {frozen}
        {stillOnVid}
        bind:saveDirty={bodySaveDirty}
        bind:guardDirty={bodyGuardDirty}
      />
    {:else if item.type === 'quiz'}
      <QuizBody
        bind:this={body}
        itemId={item.id}
        {vid}
        {version}
        {perms}
        {assetContext}
        {versionDisabled}
        {stillOnVid}
        bind:guardDirty={bodyGuardDirty}
        bind:busy={bodyBusy}
      />
    {:else if item.type === 'interactive_app'}
      <AppBody
        bind:this={body}
        {item}
        {vid}
        editable={canEditText}
        {versionDisabled}
        {frozen}
        {stillOnVid}
        bind:busy={bodyBusy}
      />
    {:else}
      <p class="muted">This item type can't be edited here.</p>
    {/if}
  </div>
</Modal>

<style>
  .mark-slot { display: flex; /* (c): ItemMark takes no class (Constraint 7) */ }
  .item-name {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 600;
    color: var(--text); /* ref 1687 */
  }
  /* Slice-5d: the open title field's focus ring must not be clipped. */
  .item-name.editing { overflow: visible; flex: 1 1 160px; min-width: 120px; }
  /* Fills its slot and shrinks with it, so ✓ / ✕ never sit on top of it on a narrow window. */
  .title-input { box-sizing: border-box; width: 100%; min-width: 0; font-size: 14px; font-weight: 600; }
  .item-ctx { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .head-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; /* ref 1689 */ }
  .field-row {
    display: grid;
    grid-template-columns: 132px 1fr; /* ref 1696 — D2 drops the 54px pencil slot */
    align-items: center;
    gap: 12px;
  }
  .field-label { font-size: 12.5px; color: var(--muted); /* ref 1697 */ }
  .field { display: flex; flex-direction: column; gap: 4px; /* the 4px step */ min-width: 0; }
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
    box-shadow: 0 0 0 3px var(--primary-soft); /* D12 — the open-editor ring */
  }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  .ro-value { font-size: 13px; color: var(--text); overflow-wrap: anywhere; /* ref 1698 */ }
  /* D6: the page banner's information form (VersionEditPage .banner). */
  .ro-note {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 13px;
    color: var(--text);
  }
  .muted { margin: 0; font-size: 13px; color: var(--muted); }
  .dirty { flex: 1; font-size: 11.5px; color: var(--status-needs-revision-fg); /* ref 1751 */ }
  /* Layout-free: the body's children stay the modal body's flex items, at full size. */
  .body-rest { display: contents; }
  .body-rest > :global(*) { flex: 0 0 auto; }
</style>
