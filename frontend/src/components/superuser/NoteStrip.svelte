<script lang="ts">
  // The panel's note under the page title (D5a, D25): it stays until closed or
  // replaced, unlike a toast, so the superuser can copy a command out of it.
  // An error reads as an alert in the danger look, so a refused confirm never
  // passes for a result (Review Focus 4).
  import type { Snippet } from 'svelte';
  import IconButton from '../ui/IconButton.svelte';

  type Props = { tone: 'info' | 'error'; onClose: () => void; children: Snippet };
  let { tone, onClose, children }: Props = $props();
</script>

<div class="note-strip {tone}" role={tone === 'error' ? 'alert' : 'status'}>
  <div class="text">{@render children()}</div>
  <IconButton glyph="close" title="Close" borderless onclick={onClose} />
</div>

<style>
  /* mock-2's note banner, from the tokens: info in the gold "you are here"
     family, an error in the destructive family. */
  .note-strip {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0 0 12px;
    padding: 8px 8px 8px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    font-size: 12.5px;
    line-height: 1.5;
  }
  .info { background: var(--gold-soft); color: var(--gold-text); }
  .error { background: var(--danger-off-bg); border-color: var(--danger-off-border); color: var(--danger); }
  .text { flex: 1; min-width: 0; padding-top: 2px; overflow-wrap: anywhere; }
</style>
