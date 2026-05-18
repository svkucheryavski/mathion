<script lang="ts">
  let { simulateSaveResult }: {
    simulateSaveResult: 'ok' | 'error';
  } = $props();

  let refreshKey = $state(0);

  function simulateSave() {
    if (simulateSaveResult === 'ok') refreshKey++;
  }

  function childBump() { refreshKey++; }
</script>

<button type="button" data-testid="simulate-save" onclick={simulateSave}>save</button>
<button type="button" data-testid="child-bump" onclick={childBump}>child-bump</button>
<output data-testid="refresh-key-value">{refreshKey}</output>
