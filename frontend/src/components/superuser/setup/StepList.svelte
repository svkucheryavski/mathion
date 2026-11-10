<script lang="ts">
  // Set up D3: the four steps on the left. Each shows its mark (a tick when
  // done, dashed when passed but not done, the number otherwise) and the
  // current one is marked. Any step can be clicked to go to it; the list waits
  // while the page does, and on All set it only shows its marks (D5).
  import { STEP_LABELS, stepMark, type PanelSetupStep, type StepN } from '../../../lib/setup';

  type Props = {
    steps: PanelSetupStep[];
    current: StepN | null;
    /** Clicks do nothing: a write runs (D3), or All set shows (D5). */
    blocked: boolean;
    onGo: (n: StepN) => void;
  };
  let { steps, current, blocked, onGo }: Props = $props();
</script>

<ol class="sl-list" aria-label="Set up steps">
  {#each STEP_LABELS as label, i (label)}
    {@const n = (i + 1) as StepN}
    {@const mark = stepMark(steps[i])}
    <li>
      <!-- Blocked, not disabled, so focus stays on it. -->
      <button type="button" class="sl-item" data-step={n} aria-current={n === current ? 'step' : undefined}
        aria-disabled={blocked ? 'true' : undefined} onclick={() => { if (!blocked) onGo(n); }}>
        <span class="sl-mark {mark}" aria-hidden="true">{mark === 'done' ? '✓' : n}</span>
        <span class="sl-label">{label}</span>
        {#if mark === 'done'}<span class="sl-vh">(done)</span>{:else if mark === 'passed'}<span class="sl-vh">(not done)</span>{/if}
      </button>
    </li>
  {/each}
</ol>

<style>
  .sl-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .sl-item {
    box-sizing: border-box;
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    font: inherit; font-size: 13px; text-align: left;
    color: var(--muted);
    cursor: pointer;
  }
  @media (hover: hover) {
    .sl-item:not([aria-disabled="true"]):hover { color: var(--text); }
  }
  /* The mockup's current step: a white box on the grey ground. */
  .sl-item[aria-current="step"] { background: var(--surface); border-color: var(--border); color: var(--text); font-weight: 500; }
  .sl-item[aria-disabled="true"] { cursor: default; }
  .sl-mark {
    box-sizing: border-box;
    display: inline-flex; align-items: center; justify-content: center;
    flex: none;
    width: 18px; height: 18px;
    /* The lightest grey at 3:1 on every ground (Polish 3 C2), so a dashed ring reads. */
    border: 1.5px solid var(--cancel-border);
    border-radius: 50%;
    font-size: 11px; font-weight: 500;
  }
  .sl-mark.done { background: var(--success); border-color: var(--success); color: var(--primary-text); }
  .sl-mark.passed { border-style: dashed; }
  /* Visually hidden, read by screen readers (the repo's 1px-box idiom, SuperuserCourses .vh). */
  .sl-vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .sl-item[aria-current="step"] .sl-mark.number { border-color: var(--primary); color: var(--primary); font-weight: 600; }
</style>
