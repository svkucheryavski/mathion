<script lang="ts">
  // The item editor (Slice-5b §2): one modal for page / video / quiz /
  // interactive-app items, hosted by VersionEditPage while the item is in the
  // URL (D1). It owns the Title field, the footer Save/Discard (+ ⌘S), the one
  // tracker registered in the page's dirty registry, and the D9 delete freeze.
  // The type body owns everything else through ItemBodyApi (lib/itemBody.ts).
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Button from '../ui/Button.svelte';
  import ItemMark from '../course/ItemMark.svelte';
  import PageBody from './item/PageBody.svelte';
  import VideoBody from './item/VideoBody.svelte';
  import QuizEditor from './QuizEditor.svelte';
  import AppBody from './item/AppBody.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { structureReason } from '../../lib/editorReasons';
  import { courseAssetContext } from '../../lib/assetContext';
  import { patchItem, reportSaveFailure, type ItemBodyApi, type SaveOutcome } from '../../lib/itemBody';
  import { loadAdminTree, type LoadResult } from '../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
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
    onDeleteItem: () => void;
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

  const versionDisabled = $derived(version.is_disabled);
  const canEditText = $derived(perms.canEditTextFields);
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

  let alive = true;
  onDestroy(() => { alive = false; });

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
      if (alive) saving = false;
    }
  }

  function discard() {
    if (frozen || bodyBusy) return;
    resetTitle();
    body?.discard();
  }

  // ⌘S / Ctrl+S inside this dialog only (D10). Default-prevented even when
  // blocked, so the browser's own Save dialog never opens over the editor.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element) || !e.target.closest('section.modal-panel')) return;
    e.preventDefault();
    void save();
  }

  // ---- D9: the header trash. The page owns the delete flow. ----
  const structReason = $derived(structureReason(version));
  const trashTitle = $derived(
    structReason ?? (guardDirty ? 'Delete this item — save or discard changes first' : 'Delete this item'),
  );
  const trashDisabled = $derived(!!structReason || guardDirty || bodyBusy || frozen);
  let trashEl = $state<HTMLButtonElement>();
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
  <h2 id={labelId} class="item-name">{item.title}</h2>
  <span class="item-ctx">{blockTitle} › {seqTitle} · item {itemIndex} of {itemCount}</span>
  <span class="head-actions">
    <IconButton
      glyph="trash"
      size="sm"
      danger
      title={trashTitle}
      aria-label="Delete item"
      disabled={trashDisabled}
      bind:element={trashEl}
      onclick={onDeleteItem}
    />
  </span>
{/snippet}

{#snippet foot()}
  <span class="dirty mono">{saveDirty ? 'unsaved changes' : ''}</span>
  <Button
    variant="ghost"
    disabled={!saveDirty || frozen || bodyBusy}
    title={saveDirty ? undefined : 'No changes to discard'}
    onclick={discard}
  >Discard</Button>
  <Button
    variant="primary"
    disabled={saveBlocked}
    title={saveDirty ? undefined : 'No changes to save'}
    loading={saving}
    onclick={() => void save()}
  >Save</Button>
{/snippet}

<Modal
  labelledby={labelId}
  {onRequestClose}
  closeDisabled={deleting || saving}
  bodyInert={deleting}
  header={head}
  footer={canEditText ? foot : undefined}
>
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
    <QuizEditor
      bind:this={body}
      itemId={item.id}
      {vid}
      {version}
      {perms}
      {assetContext}
      {versionDisabled}
      {frozen}
      {stillOnVid}
      bind:saveDirty={bodySaveDirty}
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
</style>
