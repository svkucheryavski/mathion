<script lang="ts">
  // Provides what QuizEditor provides in production: a private dirty registry
  // (mirrored at [data-testid="any-dirty"]) and the QUIZ_SAVE_KEY hub, whose
  // register() hands the accordion's save contributor to the test through
  // the `onContributor` prop. Every other prop passes through.
  import { setContext, untrack } from 'svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_GUARD_KEY, QUIZ_SAVE_KEY, type QuizSaveHub } from '../../lib/quizSave';
  import QuestionAccordion from '../../components/editor/QuestionAccordion.svelte';
  let props = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  const hub: QuizSaveHub = {
    register(c) { untrack(() => props.onContributor)?.(c); },
    unregister() {},
  };
  setContext(QUIZ_SAVE_KEY, hub);
  // T5b: the typed add-option form registers here (guard-dirty, never save-dirty).
  const guards = createDirtyRegistry();
  setContext(QUIZ_GUARD_KEY, guards);
  untrack(() => props.onGuards)?.(guards);
</script>
<output data-testid="any-dirty">{registry.isAnyDirty() ? 'dirty' : 'clean'}</output>
<output data-testid="guard-dirty">{guards.isAnyDirty() ? 'dirty' : 'clean'}</output>
<QuestionAccordion {...props} />
