<script lang="ts">
  // Provides the page's dirty registry (as VersionEditPage does) around one
  // ItemEditorModal, and mirrors registry.isAnyDirty() into the DOM. With
  // `withPage`, also the page question and its DirtyGuard (Polish 1 R46).
  import { setContext, untrack, type ComponentProps } from 'svelte';
  import ItemEditorModal from '../../components/editor/ItemEditorModal.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { PageAsk, PAGE_ASK_KEY } from '../../lib/askInPlace.svelte';

  let { modal, onRegistry, withPage = false }: {
    modal: ComponentProps<typeof ItemEditorModal>;
    onRegistry?: (r: DirtyRegistry) => void;
    withPage?: boolean;
  } = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  const page = untrack(() => withPage) ? new PageAsk() : null;
  if (page) setContext(PAGE_ASK_KEY, page);
  untrack(() => onRegistry)?.(registry);
  const anyDirty = $derived(registry.isAnyDirty());
</script>

<output data-testid="any-dirty">{anyDirty}</output>
<ItemEditorModal {...modal} />
{#if page}
  <DirtyGuard isDirty={() => registry.isAnyDirty()} onDiscard={() => registry.discardAll()} ask={() => page.guard()} />
{/if}
