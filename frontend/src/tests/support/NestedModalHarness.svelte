<script lang="ts">
  // Slice-5d: a level-3 modal mounted INSIDE a level-2 modal's DOM, as the
  // quiz cards mount theirs.
  import Modal from '../../components/ui/Modal.svelte';
  let { inner = false, onOuterClose = () => {}, onInnerClose = () => {} }:
    { inner?: boolean; onOuterClose?: () => void; onInnerClose?: () => void } = $props();
</script>

{#snippet outerHead()}<h2 id="outer-t">Outer</h2>{/snippet}
{#snippet innerHead()}<h2 id="inner-t">Inner</h2>{/snippet}
<Modal labelledby="outer-t" onRequestClose={onOuterClose} header={outerHead}>
  <button id="outer-a">Outer A</button>
  {#if inner}
    <Modal labelledby="inner-t" width={560} onRequestClose={onInnerClose} header={innerHead}>
      <button id="inner-a">Inner A</button>
      <button id="inner-b">Inner B</button>
    </Modal>
  {/if}
</Modal>
