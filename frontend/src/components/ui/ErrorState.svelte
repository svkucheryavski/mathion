<script lang="ts">
  // ErrorState — inline (section-level, optional Retry) or page (heading +
  // action) error card (artboard 9d, ref 1376-1391). `onretry` renders only
  // for `inline`, `action` only for `page`; passing the other is a caller
  // error that is simply not rendered (spec §1.3). The page variant keeps an
  // <h1> so every page it replaces keeps its heading landmark (D9).
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';

  let {
    variant = 'inline',
    title,
    message = undefined,
    onretry = undefined,
    retryLabel = 'Retry',
    action = undefined,
  }: {
    variant?: 'inline' | 'page';
    title: string;
    message?: string;
    onretry?: () => void;
    retryLabel?: string;
    action?: Snippet;
  } = $props();
</script>

<div class="error-state {variant}" role="alert">
  <div class="body">
    {#if variant === 'page'}<h1 class="title">{title}</h1>{:else}<p class="title">{title}</p>{/if}
    {#if message}<p class="message">{message}</p>{/if}
  </div>
  {#if variant === 'inline' && onretry}<Button variant="secondary" onclick={onretry}>{retryLabel}</Button>{/if}
  {#if variant === 'page' && action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .error-state {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface); /* ref 1376/1386 */
  }
  /* Shared basics only. EVERY metric is qualified by its variant class below:
     an unqualified `.message { font-size }` would let the later rule win at
     equal specificity and leak the page metrics into the inline state. */
  .title { margin: 0; color: var(--text); font-weight: 600; }
  .message { margin: 0; color: var(--muted); }
  .body { display: flex; flex-direction: column; }

  /* inline — ref 1378-1383. `border-left` after the card's `border` shorthand
     replaces the shorthand's left component: the 3px danger rule sits on the
     card's own left edge. */
  .inline { display: flex; align-items: center; gap: 12px; padding: 14px 16px; /* ref 1378 */ border-left: 3px solid var(--danger); }
  /* 5(c): a flex item's min-width:auto refuses to shrink below its content;
     without this a long unbroken token in `message` (a URL or an opaque id from
     error.message) overflows the card or pushes Retry out. */
  .inline .body { gap: 3px; /* ref 1379 */ flex: 1; min-width: 0; }
  .inline .title { font-size: 13px; /* ref 1380 */ }
  /* 5(c): the other half of the pairing above — min-width:0 lets the cell shrink, this lets the token itself break. */
  .inline .message { font-size: 12.5px; /* ref 1381 */ overflow-wrap: anywhere; }

  /* page — ref 1388-1391 */
  .page { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 30px 20px; /* ref 1388 */ text-align: center; }
  .page .body { align-items: center; gap: 9px; /* ref 1388 — the root gap cannot separate the body's own children */ }
  .page .title { font-size: 14px; letter-spacing: 0; /* ref 1389 — overrides base.css:17's 21px/-.015em h1 */ }
  /* 5(c): max-width caps the box but cannot break a long unbroken token in `message` — same pairing as the inline variant. */
  .page .message { font-size: 13px; line-height: 1.5; max-width: 46ch; /* ref 1390 */ text-wrap: pretty; overflow-wrap: anywhere; }
  .page .action { margin-top: 4px; /* ref 1391 */ }
</style>
