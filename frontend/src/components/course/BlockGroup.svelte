<script lang="ts">
  import type { BlockContent, VersionState } from '../../lib/types';
  import SequenceLink from './SequenceLink.svelte';

  let { courseSlug, block, state: vstate }: { courseSlug: string; block: BlockContent; state: VersionState } = $props();

  let expanded = $state(true);
</script>

<section class="block">
  <header onclick={() => (expanded = !expanded)}>
    <h2>{block.title}</h2>
    <span class="toggle">{expanded ? '▾' : '▸'}</span>
  </header>
  {#if expanded}
    {#if block.info_html}
      <div class="info">{@html block.info_html}</div>
    {/if}
    <ul>
      {#each block.sequences as s (s.id)}
        <li><SequenceLink {courseSlug} sequence={s} state={vstate} /></li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .block { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-3); padding: var(--space-3); }
  header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
  .info { color: var(--muted); margin: var(--space-2) 0; }
  .toggle { color: var(--muted); }
</style>
