<script lang="ts">
  // Teacher avatar (D7): the drawn silhouette from base.css "Teacher avatar",
  // inline SVG so a missing photo never renders a broken tile. Decorative:
  // the row's name and email name the person.
</script>

<span class="avatar" aria-hidden="true">
  <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
    <circle class="fig" cx="8" cy="5.9" r="2.7" />
    <path class="fig" d="M2.6 14.4c.5-3 2.7-4.6 5.4-4.6s4.9 1.6 5.4 4.6z" />
  </svg>
</span>

<style>
  .avatar {
    display: inline-flex;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: var(--avatar);
    height: var(--avatar);
    border-radius: 50%;
    background: var(--avatar-bg);
    border: 1px solid var(--border-strong);
    overflow: hidden;
  }
  svg { width: 100%; height: 100%; }
  .fig { fill: var(--avatar-fig); }
</style>
