<script lang="ts">
  // Draws an InPlaceAsk's open question (Polish 1 §The helper). The host puts
  // the slot where the question belongs; the slot records its element as the
  // question's host, so focusCancel() and answer() find the buttons. Keyed by
  // the question: a new question is a fresh InlineConfirm (its own 400 ms
  // guard, R50, and its own takeFocus).
  import InlineConfirm from './InlineConfirm.svelte';
  import type { InPlaceAsk } from '../../lib/askInPlace.svelte';

  let { ask }: { ask: InPlaceAsk } = $props();

  const own = (el: HTMLElement) => {
    const a = ask;
    a.host = el;
    return () => { if (a.host === el) a.host = null; };
  };
</script>

{#if ask.current}
  {#key ask.current}
    {@const q = ask.current}
    <div class="ask-slot" {@attach own}>
      <InlineConfirm
        label={q.label}
        warning={typeof q.warning === 'function' ? q.warning() : q.warning}
        message={q.message}
        confirmLabel={q.confirmLabel}
        confirmDataAction={q.confirmDataAction}
        tone={q.tone}
        layout={q.layout}
        align={q.align}
        busy={ask.busy}
        takeFocus
        onConfirm={() => ask.answer('confirm')}
        onCancel={() => ask.answer('cancel')}
      />
    </div>
  {/key}
{/if}

<style>
  /* The slot only anchors the question; the host's layout places it. Inside a
     modal body its child stays a full-size flex item, as Modal's own are; in a
     row (a bar, a footer, a field's row) it may shrink, so a long text wraps.
     D46: drawn directly in the body (the body-top row) it ends at the right,
     under the header's buttons, as a footer's question does. */
  .ask-slot { display: contents; }
  :global(.modal-body) > .ask-slot > :global(*) { flex: 0 0 auto; align-self: flex-end; }
</style>
