<script lang="ts">
  // Lifecycle + disabled badges for a version (3a rows, 3b heading). A disabled
  // version drops EVERY badge — the lifecycle one included — to the disabled
  // treatment (D5; visual-spec :199-201, ref 1497). `.vbadge` is unique to this
  // component so gate anchors cannot collide with AccordionHeader's code badge.
  import type { VersionLifecycleState } from '../../lib/versionPermissions';
  // `outlined` (the editor heading, 5c T5): a 1px line, as the heading's chips,
  // so the pale created/disabled tones stay visible on the shaded page.
  let { state, isDisabled, outlined = false }: { state: VersionLifecycleState; isDisabled: boolean; outlined?: boolean } = $props();
</script>

<span class="vbadges">
  <span
    class="vbadge"
    class:created={!isDisabled && state === 'created'}
    class:published={!isDisabled && state === 'published'}
    class:archived={!isDisabled && state === 'archived'}
    class:off={isDisabled}
    class:outlined
  >{state}</span>
  {#if isDisabled}<span class="vbadge off" class:outlined>disabled</span>{/if}
</span>

<style>
  .vbadges { display: inline-flex; align-items: center; gap: 6px; /* ref 1497 */ }
  .vbadge {
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 3px; /* ref 1485 */
    white-space: nowrap;
  }
  .created { background: var(--state-created-bg); color: var(--state-created-fg); }
  .published { background: var(--state-published-bg); color: var(--state-published-fg); }
  .archived { background: var(--state-archived-bg); color: var(--state-archived-fg); }
  .off { background: var(--state-disabled-bg); color: var(--state-disabled-fg); }
  .vbadge.outlined { padding: 2px 7px; border: 1px solid var(--focus-line); }
</style>
