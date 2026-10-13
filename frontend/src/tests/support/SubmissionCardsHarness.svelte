<script lang="ts">
  // Renders SubmissionCards' snippets on their own (6c T6).
  import {
    submissionChips,
    submissionContent,
    evaluationContent,
    type EvaluationView,
  } from '../../components/runs/SubmissionCards.svelte';
  import type { ThreadSubmissionBase } from '../../lib/dashboards';

  let { sub, ev = null, evaluated = '' }: {
    sub: ThreadSubmissionBase;
    ev?: EvaluationView | null;
    evaluated?: string;
  } = $props();
</script>

<div data-testid="chips">{@render submissionChips(sub)}</div>
<div data-testid="sub">{@render submissionContent(sub)}</div>
{#if ev}<div data-testid="ev">{@render evaluationContent(ev, evaluated)}</div>{/if}
