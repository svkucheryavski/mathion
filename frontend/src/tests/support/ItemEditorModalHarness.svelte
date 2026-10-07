<script lang="ts">
  // Provides the page's dirty registry (as VersionEditPage does) around one
  // ItemEditorModal, and mirrors registry.isAnyDirty() into the DOM.
  import { setContext, untrack, type ComponentProps } from 'svelte';
  import ItemEditorModal from '../../components/editor/ItemEditorModal.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';

  let { modal, onRegistry }: {
    modal: ComponentProps<typeof ItemEditorModal>;
    onRegistry?: (r: DirtyRegistry) => void;
  } = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  untrack(() => onRegistry)?.(registry);
  const anyDirty = $derived(registry.isAnyDirty());
</script>

<output data-testid="any-dirty">{anyDirty}</output>
<ItemEditorModal {...modal} />
