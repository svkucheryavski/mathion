<script lang="ts">
  // Authorable item types offered by the create picker: static_page, video,
  // quiz, and interactive_app. Narrower than the full backend item-type union,
  // which also includes 'mini_project' (not authored via this picker). Widen
  // this union if the product scope expands.
  import ItemMark from '../course/ItemMark.svelte';

  type ItemType = 'static_page' | 'video' | 'quiz' | 'interactive_app';
  // Canonical Svelte 5 form: `$bindable()` without a type argument; the
  // prop type `value: ItemType` constrains it. Every call site
  // (SequenceAccordion) binds `value`, so no default is needed.
  let { value = $bindable() }: { value: ItemType } = $props();

  const TYPES: { value: ItemType; label: string }[] = [
    { value: 'static_page', label: 'Page' },
    { value: 'video', label: 'Video' },
    { value: 'quiz', label: 'Quiz' },
    { value: 'interactive_app', label: 'Interactive app' },
  ];
</script>

<fieldset class="type-picker">
  <legend>Item type</legend>
  <div class="cards">
    {#each TYPES as t (t.value)}
      <label class:selected={value === t.value}>
        <input type="radio" name="item-type" value={t.value} bind:group={value} />
        <ItemMark type={t.value} state="not-yet" />
        <span>{t.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .type-picker { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 4px; /* the 4px label/field step */ font-size: 12.5px; color: var(--muted); }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; /* the 8px create-form gap (spec §4) */ }
  /* position: relative anchors the visually-hidden radio inside its card. */
  label {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  label.selected { border-color: var(--primary); background: var(--primary-soft); }
  /* D12 exception — the established sr-only-radio focus idiom (Login .segment,
     quiz .opt): --primary is visible on both --surface and --primary-soft. */
  label:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }
  /* Constraint 2: the sr-only idiom for a still-focusable radio, not a dim. */
  label input { position: absolute; opacity: 0; pointer-events: none; }
  @media (forced-colors: active) {
    label.selected { border: 2px solid Highlight; }
    label:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
  }
</style>
