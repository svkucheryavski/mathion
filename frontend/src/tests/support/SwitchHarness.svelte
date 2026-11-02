<script lang="ts">
  // Test host for ui/Switch: a bound value, a visible <label for>, a help line,
  // and a form that counts submits (a switch click must never submit).
  import Switch from '../../components/ui/Switch.svelte';
  let { disabled = false, frozen = false, title = undefined, onchange = undefined }: {
    disabled?: boolean;
    frozen?: boolean;
    title?: string;
    onchange?: (next: boolean) => void;
  } = $props();
  let checked = $state(false);
  let submits = $state(0);
</script>

<form onsubmit={(e) => { e.preventDefault(); submits += 1; }}>
  <label for="sw">Groups enabled</label>
  <Switch id="sw" bind:checked {disabled} {frozen} {title} {onchange} describedby="sw-help" />
  <p id="sw-help">Help text</p>
</form>
<output data-testid="value">{checked}</output>
<output data-testid="submits">{submits}</output>
