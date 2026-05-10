<script lang="ts">
  // Intentionally narrower than the backend item-type union (which also
  // includes 'quiz' and 'interactive_app'). For the MVP an admin can only
  // create static_page and video items; the picker exists specifically to
  // enforce that constraint at the call site. Widen this union if the
  // product scope expands.
  type ItemType = 'static_page' | 'video';
  let { value = $bindable<ItemType>('static_page') }: { value: ItemType } = $props();
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
  /* position: relative anchors the visually-hidden radio inside the label
     so its focus ring (when shown) and any future :focus styling stay
     scoped — without this the absolute-positioned input escapes to the
     nearest positioned ancestor (typically <body>). */
  label { position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
    padding: var(--space-2); border: 2px solid var(--border); border-radius: var(--radius); cursor: pointer; min-width: 96px; }
  label.selected { border-color: var(--primary); }
  /* Visible focus indicator for keyboard users: the radio itself is
     opacity:0, so without :focus-within on the label there is no
     indication of which option has focus when tabbing/arrow-keying. */
  label:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
  label input { position: absolute; opacity: 0; pointer-events: none; }
  .glyph { font-size: 1.5rem; }
</style>
