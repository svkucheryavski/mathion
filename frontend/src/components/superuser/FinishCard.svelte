<script lang="ts">
  // Set up D12: the Dashboard's "Finish setting up" card. One line per step not
  // done, each with a Do it now link to the regular page, followed in the same
  // tab. The Sign-in and limits line also has Keep these values, the keep
  // write, which answers the whole state (D13), so no second read is needed.
  import { routeClick } from '../../lib/routeClick';
  import { finishLines, keepSignIn } from '../../lib/setup';
  import type { SetupStore } from '../../lib/setupStore.svelte';
  import { panelError, type PanelOnAuth } from '../../lib/superuser';

  let { setup, token, onAuth }: { setup: SetupStore; token: string; onAuth: PanelOnAuth } = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;

  const lines = $derived(setup.state ? finishLines(setup.state) : []);
  const done = $derived(setup.state ? setup.state.steps.filter((s) => s.done).length : 0);

  let keeping = $state(false);
  let error = $state<string | null>(null);

  // A reason in brackets reads as part of the title; any other follows a dash.
  const joint = (reason: string) => (reason.startsWith('(') ? ' ' : ' — ');

  async function onKeep(): Promise<void> {
    if (keeping) return;
    keeping = true;
    error = null;
    try {
      await setup.write(() => keepSignIn(token));
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      keeping = false;
    }
  }
</script>

{#if lines.length > 0}
  <section class="fc-card" aria-labelledby={titleId}>
    <div class="fc-head">
      <h2 id={titleId} class="fc-title">Finish setting up</h2>
      <span class="fc-count">{done} of 4 done</span>
    </div>
    <ul class="fc-lines">
      {#each lines as l (l.step)}
        {@const href = `/superuser/${token}/${l.page}`}
        <li class="fc-line">
          <span class="fc-text">{l.title}{#if l.reason}{joint(l.reason)}<span class="fc-reason">{l.reason}</span>{/if}</span>
          <span class="fc-actions">
            <a class="fc-link" {href} onclick={(e) => routeClick(e, href)}>Do it now</a>
            {#if l.keep}
              <!-- Blocked, not disabled, so focus stays on it while the write runs. -->
              <button type="button" class="fc-link fc-keep" data-action="keep"
                aria-disabled={keeping ? 'true' : undefined} onclick={() => void onKeep()}>Keep these values</button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if error}<p class="fc-err" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  /* The Dashboard's stat cards (.card): a white box on the grey ground, here at full width. */
  .fc-card {
    box-sizing: border-box;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .fc-head { display: flex; align-items: baseline; gap: var(--space-2); }
  .fc-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }
  .fc-count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .fc-lines { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
  .fc-line {
    display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    padding: 6px 0;
    font-size: 13px; color: var(--text);
  }
  .fc-line:not(:first-child) { border-top: 1px solid var(--border); }
  .fc-reason { color: var(--muted); }
  .fc-actions { display: inline-flex; gap: var(--space-3); white-space: nowrap; }
  .fc-link { font-size: 13px; color: var(--primary); }
  .fc-keep { background: none; border: 0; padding: 0; font: inherit; font-size: 13px; cursor: pointer; }
  .fc-keep:hover { text-decoration: underline; }
  .fc-keep[aria-disabled="true"] { color: var(--muted); cursor: default; text-decoration: none; }
  .fc-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
