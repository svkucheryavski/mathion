<script lang="ts" generics="T extends string | number">
  // A segmented choice (Login's "Stay signed in for", Settings D7/D12): a
  // radiogroup of visually hidden radios, each inside its visible label, so
  // the arrow keys, Space and a screen reader come from the platform.
  // `fit` sizes the segments to their text instead of sharing the row.
  let {
    options,
    value = $bindable(),
    name,
    label,
    disabled = false,
    fit = false,
    onchange = undefined,
  }: {
    options: { value: T; label: string }[];
    value: T;
    name: string;
    label: string;
    disabled?: boolean;
    fit?: boolean;
    onchange?: (next: T) => void;
  } = $props();
</script>

<div class="segmented" class:fit class:disabled role="radiogroup" aria-label={label}>
  {#each options as o (o.value)}
    <label class="segment" class:selected={value === o.value}>
      <input type="radio" {name} value={o.value} bind:group={value} {disabled} onchange={() => onchange?.(o.value)} />
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
  }
</style>
