<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  let {
    type = 'text',
    value = $bindable(''),
    placeholder = '',
    error = '',
    autocomplete = undefined as HTMLInputAttributes['autocomplete'],
    autofocus = false,
    name = '',
    mono = false,
  } = $props();
</script>

<input
  {type}
  bind:value
  {placeholder}
  {autocomplete}
  {autofocus}
  {name}
  class="input"
  class:error={!!error}
  class:mono={mono}
/>

<style>
  .input {
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    font-size: var(--control-font);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    width: 100%;
  }
  .input::placeholder { color: var(--placeholder); }
  .input.error { border-color: var(--danger); }
  /* PIN/code display — IBM Plex Mono, reference #2a line 1997. */
  .input.mono { font-family: var(--font-mono); font-size: 17px; letter-spacing: .34em; }
</style>
