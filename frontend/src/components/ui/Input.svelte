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
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
  }
  .input.error { border-color: var(--danger); }
</style>
