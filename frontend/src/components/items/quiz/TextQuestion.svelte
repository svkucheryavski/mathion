<script lang="ts">
  import type { TextQuestion } from '../../../lib/types';

  let { question, value, onanswer, disabled = false, correctValue = null }: {
    question: TextQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: string) => void;
    disabled?: boolean;
    correctValue?: string | null;
  } = $props();

  const text = $derived(typeof value === 'string' ? value : '');
  // The field has no visible <label>; the prompt IS its name, so it needs an
  // id to point at. Derived from question.id so two of these on one page
  // cannot collide (the choice questions get this from fieldset/legend).
  const promptId = $derived(`q-${question.id}-prompt`);
</script>

<div class="row">
  <div class="text" id={promptId}>{@html question.text_html}</div>
  <input
    class="txt"
    type="text"
    aria-labelledby={promptId}
    value={text}
    {disabled}
    oninput={(e) => onanswer((e.currentTarget as HTMLInputElement).value)}
  />
  {#if correctValue !== null}
    <p class="correct-line">Correct answer: <strong>{correctValue}</strong></p>
  {/if}
</div>

<style>
  /* The gap is the sole owner of the vertical rhythm (§2), so every surviving
     child margin below is zeroed against it — including this row's own
     `margin-bottom`, whose job is now split between T4's `.q-block` gap (down to
     the explanation panel) and `.quiz`'s gap (on to the next question). 16px is
     the same prompt→control step a choice question uses, so the two kinds of
     question share one rhythm — and, since the `.text` rule below, one prompt
     treatment too. (spec:131 pins the 14.5px treatment to `legend`; `.text`
     reproduces it on a div. Before that rule this prompt WAS body copy, which
     is what made the two question types read differently.) */
  .row { display: flex; flex-direction: column; gap: 16px; /* ref 2120 */ margin: 0; }
  /* The choice questions' prompt treatment (ref 2125), so both kinds of prompt
     read alike inside one quiz — without it this div inherits body copy
     (14px/1.5/--text) and a quiz mixing question types shows two prompt sizes.
     spec:131 pins the treatment to `legend`; this div takes the four
     declarations spec:131 lists. `font-weight:400` is inert TODAY (a div is
     already 400 — the legend needed it only to undo an authored 500), but it is
     pinned anyway: the gate compares each rule's full declaration set, so it is
     falsifiable, and it makes the prompt immune to a future ancestor weight
     exactly as T2's legend already is. */
  .text { font-size: 14.5px; /* ref 2125 */ line-height: 1.6; /* ref 2125 */ font-weight: 400; color: var(--text-2); text-wrap: pretty; }
  /* Server-rendered markdown: keep the inter-paragraph rhythm (reset.css zeroes
     `p` globally, so this is its only source) and zero ONLY the trailing gap —
     the .row gap already owns prompt→field. */
  .text :global(p) { margin: 0 0 var(--space-2); }
  .text :global(p:last-child) { margin: 0; }
  /* A local <input> on the control tokens, NOT ui/Input — whose prop list has no
     `disabled` and no rest-spread, so the field would stay answerable after
     submit. No `.mono` here: a text answer is prose, not a numeral.
     `background` is pinned because the enabled field would otherwise fall back
     to the UA `Field` system colour — untokenised, and asymmetric with the
     `--surface-2` of `:disabled` below. The widths are retained from the rule
     this replaces; without them the field falls back to UA sizing. */
  .txt {
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    font-size: var(--control-font);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    width: 100%;
    max-width: 480px; /* both retained verbatim from the rule this replaces (pre-T3 TextQuestion.svelte:31); spec §3 pins the retention */
  }
  /* Disabled treatment through the reserved disabled-control tokens, never
     opacity (Constraint 2). Written per-component and NOT as a combined
     `.num:disabled, .txt:disabled` list: `.num` does not exist in this
     stylesheet, so the combined form would emit css_unused_selector for it. */
  .txt:disabled { background: var(--surface-2); color: var(--muted); border-color: var(--border-faint); /* theme-default.css:22, "disabled control borders" */ }
  /* mechanism: the global `:focus-visible` (base.css:21-25) is (0,1,0) while
     this scoped field rule is (0,2,0), so the rule's own
     `border:1px solid var(--border-strong)` out-specifies the global
     `border-color:var(--primary)` and the only surviving focus signal is a
     3px --primary-soft halo at 1.12:1 against the page. Restoring it at
     (0,3,0) is the whole fix. Per-component, NOT a combined `.num,.txt` list:
     the absent member would warn, exactly as for `:disabled`. */
  .txt:focus-visible { border-color: var(--primary); }
  /* Forced-colors drops box-shadow AND border colours are system-forced, and
     base.css:22's `outline:none` is still in force — so without this a focused
     field has no indicator at all in that mode. Same restoration T2 made for
     the option rows. */
  @media (forced-colors: active) {
    .txt:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
  }
  /* Reveal shows the correct answer only — no client-side judging. The value
     stays NON-mono: unlike the numeric answer it is prose. */
  /* overflow-wrap: an unbreakable answer would otherwise paint past the
     viewport and scroll the page.
     `correct_text` is teacher-authored and capped only at 500 chars
     (schemas.py:328), so one long unbreakable token scrolls the whole page
     at 320px — WCAG 1.4.10. `anywhere` for symmetry with `.opt`; here
     `break-word` would measure the same (0px overflow at 320px), because
     unlike `.opt`'s anonymous flex item this is a real <p> stretched by a
     column flex container whose ancestors are all definite-width, so its
     min-content contribution is never consulted. `anywhere` is the superset
     and costs nothing: ordinary prose still breaks only at word boundaries. */
  .correct-line { overflow-wrap: anywhere; margin: 0; color: var(--status-accepted-fg); font-size: 13px; /* Constraint 5(b) no-ref — the same 13px secondary step as QuizItem's .exp */ }
</style>
