<script lang="ts" generics="T extends string | number">
  // A segmented choice (Login's "Stay signed in for", Settings D7/D12): a
  // radiogroup of visually hidden radios, each inside its visible label, so
  // the arrow keys, Space and a screen reader come from the platform.
  // `fit` sizes the segments to their text instead of sharing the row.
  // `frozen` (Switch's R19): a request is running, so the choice keeps its
  // look and focus but ignores clicks and the arrow keys.
  let {
    options,
    value = $bindable(),
    name,
    label,
    labelledby = undefined,
    disabled = false,
    frozen = false,
    fit = false,
    onchange = undefined,
  }: {
    options: { value: T; label: string }[];
    value: T;
    name: string;
    label: string;
    // A visible caption's id: it names the group instead of `label`.
    labelledby?: string;
    disabled?: boolean;
    frozen?: boolean;
    fit?: boolean;
    onchange?: (next: T) => void;
  } = $props();

  const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  // A cancelled click puts the radio back, so no change fires; the arrow keys
  // would move the choice without a click, so they stop here too. Browsers
  // also re-check the radio that was on; jsdom doesn't, so once the click is
  // over the radios are set from the value again.
  function hold(e: Event): void {
    if (!frozen) return;
    e.preventDefault();
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]');
    queueMicrotask(() => {
      group?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
        .forEach((r, i) => { r.checked = options[i]?.value === value; });
    });
  }
  function holdKey(e: KeyboardEvent): void {
    if (frozen && ARROWS.has(e.key)) e.preventDefault();
  }
</script>

<div class="segmented" class:fit class:disabled role="radiogroup"
  aria-labelledby={labelledby} aria-label={labelledby ? undefined : label}>
  {#each options as o (o.value)}
    <label class="segment" class:selected={value === o.value}>
      <input type="radio" {name} value={o.value} bind:group={value} {disabled} aria-disabled={frozen ? 'true' : undefined}
        onclick={hold} onkeydown={holdKey} onchange={() => onchange?.(o.value)} />
      {o.label}
    </label>
  {/each}
</div>

<style>
  .segmented { display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .segment { position: relative; flex: 1; text-align: center; font-size: 13px; /* ref 2004 */ color: var(--muted); padding: var(--btn-pad-segment); background: var(--surface); cursor: pointer; }
  .segment:not(:first-child) { border-left: 1px solid var(--border); }
  .segment.selected { background: var(--primary-soft); color: var(--text); font-weight: 500; }
  .segment input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: -1px; }        /* visually-hidden radio (sr-only, not a disabled treatment) */
  .segment input:focus-visible { box-shadow: none; }                                                /* a no-op since Polish 2 (the field rule skips this input); kept for Polish 3 */
  .segment:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }                 /* --primary: visible on both --surface and the selected --primary-soft */
  /* Settings D7: the segments as wide as their text, at the row's start. */
  .segmented.fit { display: inline-flex; align-self: flex-start; }
  .fit .segment { flex: none; padding: 5px 12px; }
  /* Settings D7c: greyed with the dialog's other fields, by colour, never by opacity. */
  .disabled .segment { cursor: default; background: var(--surface-2); color: var(--muted); }
  .disabled .segment.selected { color: var(--text-2); }
  /* Forced-colors (Windows High Contrast) drops background-color AND box-shadow, so
     both the selected fill (.segment.selected) and the focus ring above vanish —
     the native <select> this replaced had system-drawn cues. Restore both with
     outlines (forced-colors keeps outlines): neutral for selection, Highlight for focus. */
  @media (forced-colors: active) {
    .segment.selected { outline: 2px solid; outline-offset: -2px; }
    .segment:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
    /* The grey fill is dropped here: a disabled control greys its text and lines instead. */
    .segmented.disabled { border-color: GrayText; }
    .disabled .segment { color: GrayText; border-left-color: GrayText; }
    .disabled .segment.selected { color: GrayText; }
  }
</style>
