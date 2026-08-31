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
</style>
