<script lang="ts">
  // Branding D11: a thin line at the bottom of every page but the item player,
  // whatever the branding is. The link opens a new tab, the one deliberate
  // exception to the same-tab rule, so a student keeps their place.
</script>

<footer class="powered">
  Powered by <a href="https://mathion.org" target="_blank" rel="noopener noreferrer">Mathion</a>
</footer>

<style>
  .powered {
    padding: var(--space-3);
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  /* Underlined at rest: in the muted line, colour alone doesn't say "link". */
  .powered a { text-decoration: underline; }
</style>
