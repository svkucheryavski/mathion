<script lang="ts">
  // Snippet harness for Modal.svelte.test.ts: a header button (stands in for
  // the item modal's trash), two body inputs and an optional footer button.
  import Modal from '../../components/ui/Modal.svelte';
  let {
    onRequestClose,
    closeOnBackdrop = false,
    closeDisabled = false,
    bodyInert = false,
    withFooter = true,
    autofocusTitle = true,
    headDisabled = false,
    saveDisabled = false,
    withHiddenFile = false,
    placement = 'center',
    closeTitle = undefined,
  }: {
    onRequestClose: () => void;
    closeOnBackdrop?: boolean;
    closeDisabled?: boolean;
    bodyInert?: boolean;
    withFooter?: boolean;
    autofocusTitle?: boolean;
    headDisabled?: boolean;
    // T3a's clean modal: Save/Discard disabled, and the body ends with
    // AssetSidebar's `hidden` file input (review T1-I1).
    saveDisabled?: boolean;
    withHiddenFile?: boolean;
    placement?: 'center' | 'right';
    closeTitle?: string;
  } = $props();
</script>

{#snippet head()}
  <h2 id="mh-title">Edit thing</h2>
  <button type="button" data-testid="head-trash" disabled={headDisabled}>Trash</button>
{/snippet}
{#snippet foot()}
  <button type="button" data-testid="save" disabled={saveDisabled}>Save</button>
{/snippet}

<button type="button" data-testid="outside">Outside</button>
<Modal
  labelledby="mh-title"
  {onRequestClose}
  {closeOnBackdrop}
  {closeDisabled}
  {bodyInert}
  {placement}
  {closeTitle}
  header={head}
  footer={withFooter ? foot : undefined}
>
  <input data-testid="title" data-autofocus={autofocusTitle ? '' : undefined} />
  <input data-testid="last" />
  {#if withHiddenFile}<input type="file" hidden data-testid="file" />{/if}
</Modal>
