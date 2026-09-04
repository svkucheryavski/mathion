<script lang="ts">
  // Intentionally empty, and intentionally still `lang="ts"`. The component is
  // prop-less — T5 removed its only prop, `type` — but deleting the whole block
  // (which spec §2's wording says to do) leaves the component untyped, so every
  // importer resolves it as implicit `any`: `npm run check` went 0 -> 2 errors
  // at ItemRouter.svelte:8 and the T5 test's import. Keeping the empty typed
  // block is the smallest thing that satisfies both.
</script>

<div class="unsupported">
  <!-- Type-neutral by design (visual-spec:230 — human-readable type names, so
       "single choice", never single_choice). The copy used to interpolate the
       raw slug as `This item type ("mini_project") isn't available…`; dropping
       the identifier is cheaper than humanising it and leaves nothing to
       maintain when a new item type appears. That left the component prop-less
       — see the script block above for why it survives as an empty one. -->
  <p>This item isn't available in this view yet.</p>
</div>

<style>
  /* No <article> and no <h2> here, so §2's article-rhythm rule does not apply.
     The padding is this notice box's own inset — it keeps the text off the
     dashed border — and is retained, not the article padding §2 zeroes. */
  .unsupported { padding: var(--space-3); border: 1px dashed var(--border); border-radius: var(--radius); color: var(--muted); }
</style>
