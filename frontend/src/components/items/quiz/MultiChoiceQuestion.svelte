<script lang="ts">
  import type { MultipleChoiceQuestion } from '../../../lib/types';

  let { question, value, onanswer, disabled = false, correctOptionIds = null }: {
    question: MultipleChoiceQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: number[]) => void;
    disabled?: boolean;
    correctOptionIds?: number[] | null;
  } = $props();

  const selected = $derived<Set<number>>(new Set(Array.isArray(value) ? value : []));
  const correctSet = $derived(new Set(correctOptionIds ?? []));
  // Every reveal predicate is guarded by this, so none can fire pre-submit.
  const isRevealed = $derived(correctOptionIds !== null);
  const studentAnswered = $derived(selected.size > 0);

  function toggle(id: number): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onanswer([...next].sort((a, b) => a - b));
  }
</script>

<fieldset>
  <legend><div class="text">{@html question.text_html}</div></legend>
  <div class="opts">
    {#each question.options as opt (opt.id)}
      {@const isChosen = selected.has(opt.id)}
      {@const isCorrect = correctSet.has(opt.id)}
      {@const isRevealCorrect = isRevealed && isCorrect && (isChosen || !studentAnswered)}
      {@const isWrongPick = isRevealed && isChosen && !isCorrect}
      {@const isMissedCorrect = isRevealed && isCorrect && !isChosen && studentAnswered}
      {@const isRevealNeutral = isRevealed && !isCorrect && !isChosen}
      {@const srLabel = isRevealCorrect
        ? (isChosen ? 'Correct answer — you chose this' : 'Correct answer')
        : isMissedCorrect ? 'Correct answer — you missed this'
        : isWrongPick ? 'Your answer — incorrect' : null}
      <label
        class="opt"
        class:selected={isChosen}
        class:locked={disabled && correctOptionIds === null}
        class:reveal-correct={isRevealCorrect}
        class:reveal-wrong={isWrongPick}
        class:reveal-missed={isMissedCorrect}
        class:reveal-neutral={isRevealNeutral}
      >
        <input
          type="checkbox"
          value={opt.id}
          checked={isChosen}
          {disabled}
          onchange={() => toggle(opt.id)}
        />
        <span class="ctl">
          {#if isChosen}
            <svg class="check" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3,8.6 6.4,12 13,4.6" />
            </svg>
          {/if}
        </span>
        {opt.text}
        {#if isRevealCorrect || isMissedCorrect}
          <svg class="mark" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3,8.6 6.4,12 13,4.6" />
          </svg>
        {:else if isWrongPick}
          <svg class="mark" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="4.2" y1="4.2" x2="11.8" y2="11.8" />
            <line x1="11.8" y1="4.2" x2="4.2" y2="11.8" />
          </svg>
        {/if}
        {#if srLabel}<span class="sr-only">{srLabel}</span>{/if}
      </label>
    {/each}
  </div>
</fieldset>

<style>
  fieldset { border: 0; padding: 0; margin: 0; /* the article gap owns the rhythm */ }
  /* A rendered <legend> is NOT a flex item (it is laid out at the block-start),
     so a fieldset `gap` cannot separate prompt from options — the legend's own
     margin owns that step. `padding:0` zeroes the UA padding-inline so the
     prompt sits flush-left with the option rows (ref 2125). */
  legend {
    display: block;
    padding: 0;
    margin: 0 0 16px; /* ref 2120 */
    font-size: 14.5px; /* ref 2125 */
    line-height: 1.6;
    font-weight: 400;
    color: var(--text-2);
    text-wrap: pretty;
  }
  /* Server-rendered markdown: keep the inter-paragraph rhythm (reset.css zeroes
     `p` globally, so this is its only source) and zero ONLY the trailing gap —
     the legend margin above already owns prompt→options. */
  .text :global(p) { margin: 0 0 var(--space-2); }
  .text :global(p:last-child) { margin: 0; }
  .opts { display: flex; flex-direction: column; gap: 8px; /* ref 2126 */ }

  /* (1) base row */
  .opt {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px; /* ref 2127 */
    padding: var(--btn-pad-sm); /* 4px 9px — ref 2127 */
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 14px; /* ref 2127 */
    color: var(--text-2);
    cursor: pointer;
  }
  /* mechanism: visually-hidden native input — the real focusable/checkable
     control, NOT a disabled treatment (Constraint 2 exemption). */
  .opt input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: -1px; }
  /* Drawn control: a real element, never a pseudo-element (ref 2127).
     `flex:0 0 auto` so a long option text cannot shrink the box. */
  .ctl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 15px; /* ref 2127 */
    height: 15px; /* ref 2127 */
    border: 1.5px solid var(--border-strong); /* symmetric with the radio ring; #C4CAD4 is untokenised, so it resolves to the nearest enabled-control token */
    border-radius: var(--radius); /* NOT --radius-pill, which is reserved for status/identifier badges */
    flex: 0 0 auto;
  }
  /* Flush right, and anti-shrink like .ctl so long text cannot squeeze it. */
  .mark { margin-left: auto; flex: 0 0 auto; }
  /* mechanism: visually-hidden, AT-only (Constraint 5c) */
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* (2) pre-reveal locked recede — gated by `class:locked` to the pre-reveal
     window, so it never contests the reveal rules. `cursor:default` is
     load-bearing: the row inherits the base `pointer` but ignores clicks. */
  .opt.locked { background: var(--surface-2); color: var(--muted); border-color: var(--border-faint); cursor: default; }
  /* (3) */
  .opt.locked .ctl { border-color: var(--border-faint); }
  /* (4) reveal .ctl recede — an unchosen option's ring would otherwise keep its
     enabled look. Authored BEFORE .opt.selected .ctl so a chosen reveal row
     re-applies its --primary ring. */
  .opt.reveal-correct .ctl,
  .opt.reveal-missed .ctl,
  .opt.reveal-wrong .ctl,
  .opt.reveal-neutral .ctl { border-color: var(--border-faint); }
  /* (5) selection — after .opt.locked, so a locked+selected row keeps the
     student's own pick visible on the score screen. */
  .opt.selected { border: 1.5px solid var(--primary); background: var(--primary-soft); font-weight: 500; color: var(--text); }
  /* (6) the filled box carries the check in --primary-text */
  .opt.selected .ctl { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
  /* (7) reveal rows — after .opt.selected, so reveal owns the row bg/border.
     `border-width:1.5px` is pinned on all three evaluative classes so a chosen
     and an unchosen correct row read at the same weight. */
  .opt.reveal-correct { background: var(--status-accepted-bg); border-color: var(--status-accepted-fg); border-width: 1.5px; color: var(--text-2); cursor: default; }
  .opt.reveal-wrong { background: var(--status-rejected-bg); border-color: var(--status-rejected-fg); border-width: 1.5px; color: var(--text-2); cursor: default; }
  .opt.reveal-missed { background: var(--status-accepted-bg); border: 1.5px dashed var(--status-accepted-fg); color: var(--text-2); cursor: default; }
  .opt.reveal-neutral { background: var(--surface-2); color: var(--muted); border-color: var(--border-faint); cursor: default; }
  /* (8) the row text stays --text-2 for readability, so the currentColor mark
     would render grey without these. */
  .opt.reveal-correct .mark,
  .opt.reveal-missed .mark { color: var(--status-accepted-fg); }
  .opt.reveal-wrong .mark { color: var(--status-rejected-fg); }

  .opt input:focus-visible { box-shadow: none; }              /* suppress the global glow (base.css:21-25) on the hidden input */
  .opt:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }
  /* Forced-colors drops background-color AND box-shadow, so both the selection
     fill and the focus ring vanish — restore them as outlines. The reveal rows
     are deliberately NOT outlined: their meaning survives via the .mark SVG,
     the .sr-only text and reveal-missed's dashed border. */
  @media (forced-colors: active) {
    .opt.selected { outline: 2px solid; outline-offset: -2px; }
    .opt:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
  }
</style>
