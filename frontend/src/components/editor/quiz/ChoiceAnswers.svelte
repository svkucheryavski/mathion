<script lang="ts">
  // A choice question's answers (spec §Answers). Each card loads its own.
  import { getContext, onDestroy, onMount, tick } from 'svelte';
  import Button from '../../ui/Button.svelte';
  import ChoiceRow from './ChoiceRow.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { listOptions, type AuthoringOption, type AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n, options = $bindable(null) }: {
    q: AuthoringQuestion; n: number; options?: AuthoringOption[] | null;
  } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);

  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let noteEl = $state<HTMLElement>();
  let mounted = true;
  // Mounted AND still showing this version (spec §Stale responses).
  const alive = () => mounted && ctx.live();
  let token = 0;
  onDestroy(() => { mounted = false; token++; });

  async function load() {
    const my = ++token;
    status = 'loading';
    try {
      const list = await listOptions(q.id);
      if (my !== token) return;
      options = [...list].sort((a, b) => a.order - b.order);
      status = 'loaded';
    } catch {
      if (my !== token) return;
      status = 'error';
    }
  }
  onMount(() => { void load(); });

  async function retry() {
    await load();
    await tick();
    if (!alive()) return;
    // As QuizBody.retry: repair only a drop to <body> (the Retry unmounted).
    const a = document.activeElement;
    if (a !== null && a !== document.body) return;
    if (status === 'error') noteEl?.querySelector('button')?.focus();
    else ctx.focusFallback(q.id);
  }
</script>

{#if status === 'loading'}
  <p class="ans-note">Loading answers…</p>
{:else if status === 'error'}
  <p class="ans-note" bind:this={noteEl}>Couldn't load answers <Button variant="ghost" onclick={() => void retry()}>Retry</Button></p>
{:else if options}
  <!-- svelte-ignore a11y_no_redundant_roles -->
  <ul class="ans-list" role="list" aria-label={`Answers to question ${n}`}>
    {#each options as o (o.id)}
      <ChoiceRow opt={o} multiple={q.type === 'multiple_choice'} />
    {/each}
  </ul>
{/if}

<style>
  .ans-note { margin: 0; font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .ans-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
</style>
