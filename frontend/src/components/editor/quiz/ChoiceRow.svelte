<script lang="ts">
  // One answer row (spec §Single and multiple choice): the correct marker, the
  // text, and the "correct" tag that conveys correctness in text.
  import type { AuthoringOption } from '../../../lib/quizAuthoring';
  let { opt, multiple }: { opt: AuthoringOption; multiple: boolean } = $props();
</script>

<li class="ans-row" class:ok={opt.is_correct} data-a-id={opt.id}>
  <span class="ans-mark" class:multi={multiple} class:on={opt.is_correct} aria-hidden="true"></span>
  <span class="ans-text">{opt.text}</span>
  {#if opt.is_correct}<span class="ans-ok">correct</span>{/if}
</li>

<style>
  .ans-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: var(--radius); font-size: 13.5px; color: var(--text-2); }
  .ans-row.ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ans-mark { flex: 0 0 auto; box-sizing: border-box; width: 15px; height: 15px; border: 1.5px solid var(--muted); border-radius: 50%; background: var(--surface); }
  .ans-mark.multi { border-radius: 3px; }
  .ans-mark.on { border-color: var(--status-accepted-fg); background: var(--status-accepted-fg); }
  .ans-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .ans-ok { flex: 0 0 auto; font-size: 11px; font-weight: 500; }
</style>
