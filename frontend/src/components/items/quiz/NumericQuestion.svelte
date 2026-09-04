<script lang="ts">
  import type { NumericQuestion } from '../../../lib/types';

  let { question, value, onanswer, disabled = false, correctValue = null }: {
    question: NumericQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: string) => void;
    disabled?: boolean;
    correctValue?: number | null;
  } = $props();

  const text = $derived(typeof value === 'string' ? value : '');
</script>

<div class="row">
  <div class="text">{@html question.text_html}</div>
  <input
    class="num mono"
    type="text"
    inputmode="decimal"
    value={text}
    {disabled}
    oninput={(e) => onanswer((e.currentTarget as HTMLInputElement).value)}
  />
  {#if correctValue !== null}
    <p class="correct-line">Correct answer: <strong class="mono">{correctValue}</strong></p>
  {/if}
</div>

<style>
  /* The gap is the sole owner of the vertical rhythm (§2), so every surviving
     child margin below is zeroed against it — including this row's own
     `margin-bottom`, whose job is now split between T4's `.q-block` gap (down to
     the explanation panel) and `.quiz`'s gap (on to the next question). 16px is
     the same prompt→control step a choice question uses, so the two kinds of
     question share one RHYTHM — not one prompt type: a choice prompt is a
     14.5px `legend` (spec:131 pins that treatment to `legend` alone), this one
     is body copy. */
  .row { display: flex; flex-direction: column; gap: 16px; /* ref 2120 */ margin: 0; }
  /* Server-rendered markdown: keep the inter-paragraph rhythm (reset.css zeroes
     `p` globally, so this is its only source) and zero ONLY the trailing gap —
     the .row gap already owns prompt→field. */
  .text :global(p) { margin: 0 0 var(--space-2); }
  .text :global(p:last-child) { margin: 0; }
  /* A local <input> on the control tokens, NOT ui/Input — whose `mono` is the
     PIN-specific 17px/.34em (Input.svelte:40) and whose prop list has neither
     `disabled` nor `inputmode` and no rest-spread. Only the geometry lives here;
     `--font-mono` comes from the global `.mono` utility (base.css:10).
     `background` is pinned because the enabled field would otherwise fall back
     to the UA `Field` system colour — untokenised, and asymmetric with the
     `--surface-2` of `:disabled` below. The 160px width is retained from the
     rule this replaces; without it the field falls back to UA sizing. */
  .num {
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    font-size: var(--control-font);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    width: 160px; /* retained verbatim from the rule this replaces (pre-T3 NumericQuestion.svelte:32); spec §3 pins the retention */
  }
  /* Disabled treatment through the reserved disabled-control tokens, never
     opacity (Constraint 2). Written per-component and NOT as a combined
     `.num:disabled, .txt:disabled` list: `.txt` does not exist in this
     stylesheet, so the combined form would emit css_unused_selector for it. */
  .num:disabled { background: var(--surface-2); color: var(--muted); border-color: var(--border-faint); /* theme-default.css:22, "disabled control borders" */ }
  /* Reveal shows the correct answer only — no client-side judging. The numeral
     is mono (Constraint 4) via the same global utility as the field. */
  .correct-line { margin: 0; color: var(--status-accepted-fg); font-size: 13px; /* Constraint 5(b) no-ref — the same 13px secondary step as QuizItem's .exp */ }
</style>
