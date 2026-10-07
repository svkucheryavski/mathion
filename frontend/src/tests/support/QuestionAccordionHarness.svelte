<script lang="ts">
  // Provides what QuizEditor provides in production: a private dirty registry
  // (mirrored at [data-testid="any-dirty"]) and the QUIZ_SAVE_KEY hub, whose
  // register() hands the accordion's save contributor to the test through
  // the `onContributor` prop. Every other prop passes through.
  import { setContext, untrack } from 'svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_SAVE_KEY, type QuizSaveHub } from '../../lib/quizSave';
  import QuestionAccordion from '../../components/editor/QuestionAccordion.svelte';
  let props = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  const hub: QuizSaveHub = {
    register(c) { untrack(() => props.onContributor)?.(c); },
    unregister() {},
  };
  setContext(QUIZ_SAVE_KEY, hub);
</script>
<output data-testid="any-dirty">{registry.isAnyDirty() ? 'dirty' : 'clean'}</output>
<QuestionAccordion {...props} />
