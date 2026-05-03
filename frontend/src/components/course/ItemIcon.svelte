<script lang="ts">
  import type { Item } from '../../lib/types';

  type State = 'covered' | 'current' | 'not-yet';
  let { item, state: istate, onclick }: { item: Item; state: State; onclick: () => void } = $props();

  const icon = $derived(
    item.type === 'static_page' ? '📄' :
    item.type === 'video' ? '▶' :
    item.type === 'quiz' ? '?' :
    item.type === 'mini_project' ? '★' :
    '⌘'
  );
</script>

<button class="icon {istate}" {onclick} title={item.title} aria-label={item.title}>
  {icon}
</button>

<style>
  .icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
  }
  .covered { background: #cde; }
  .current { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
  .not-yet { opacity: 0.65; }
</style>
