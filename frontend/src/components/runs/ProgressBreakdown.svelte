<script lang="ts">
  import ItemMark from '../course/ItemMark.svelte';
  import { ITEM_TYPE_NAME, drillItemType, type SequenceItemState } from '../../lib/dashboards';

  // The Progress drawer's Items card (6c §Progress variant): per item its type
  // mark (covered or not yet), the title, a hidden coverage word, the readable
  // type name and the last score. The panel keeps loading, error and empty.
  let { items }: { items: SequenceItemState[] } = $props();

  const uid = $props.id();
</script>

<section class="pb-card" aria-labelledby="{uid}-items">
  <div class="pb-head"><h3 class="pb-title" id="{uid}-items">Items</h3></div>
  <ol class="pb-list">
    {#each items as it (it.item_id)}
      {@const type = drillItemType(it.item_type)}
      <li class="pb-row">
        {#if type}
          <ItemMark {type} state={it.is_covered ? 'covered' : 'not-yet'} />
        {:else}
          <span class="pb-nomark" aria-hidden="true"></span>
        {/if}
        <span class="pb-text">
          <span class="pb-name">{it.item_title}</span>
          <span class="pb-sr">{it.is_covered ? 'covered' : 'not covered'}</span>
          <span class="pb-type">{type ? ITEM_TYPE_NAME[type] : it.item_type}</span>
        </span>
        {#if it.last_score}
          <span class="pb-score">{it.last_score.correct}/{it.last_score.total}</span>
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .pb-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
  }
  .pb-head {
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .pb-title {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .pb-list { margin: 0; padding: 0; list-style: none; }
  .pb-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border-soft);
  }
  .pb-row:last-child { border-bottom: 0; }
  /* An unknown type: ItemMark's empty 22px box. */
  .pb-nomark {
    box-sizing: border-box;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .pb-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .pb-name { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .pb-type { font-size: 11.5px; color: var(--muted); }
  .pb-score {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }
  .pb-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
