<script lang="ts">
  import { setContext } from 'svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import QuestionAccordion from '../../components/editor/QuestionAccordion.svelte';
  let props = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
</script>
<output data-testid="any-dirty">{registry.isAnyDirty() ? 'dirty' : 'clean'}</output>
<QuestionAccordion {...props} />
