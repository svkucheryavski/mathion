<script lang="ts">
  type ItemType = 'static_page' | 'video';
  let { value = $bindable() }: { value: ItemType } = $props();
</script>

<fieldset class="picker">
  <legend>Item type</legend>
  <label class:selected={value === 'static_page'}>
    <input type="radio" name="item-type" value="static_page" bind:group={value} />
    <span class="glyph" aria-hidden="true">📄</span>
    <span>Page</span>
  </label>
  <label class:selected={value === 'video'}>
    <input type="radio" name="item-type" value="video" bind:group={value} />
    <span class="glyph" aria-hidden="true">▶️</span>
    <span>Video</span>
  </label>
</fieldset>

<style>
  .picker { display: flex; gap: var(--space-3); border: 0; padding: 0; margin: 0; }
  legend { padding: 0; margin-bottom: var(--space-2); font-weight: 600; }
  label { display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
    padding: var(--space-2); border: 2px solid var(--border); border-radius: var(--radius); cursor: pointer; min-width: 96px; }
  label.selected { border-color: var(--primary); }
  label input { position: absolute; opacity: 0; pointer-events: none; }
  .glyph { font-size: 1.5rem; }
</style>
