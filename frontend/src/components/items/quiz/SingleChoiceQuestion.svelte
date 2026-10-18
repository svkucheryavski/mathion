<script lang="ts">
  import type { SingleChoiceQuestion } from '../../../lib/types';

  let { question, value, onanswer, disabled = false, correctOptionIds = null }: {
    question: SingleChoiceQuestion;
    value: number[] | string | undefined;
    onanswer: (ans: number[]) => void;
    disabled?: boolean;
    correctOptionIds?: number[] | null;
  } = $props();

  const selected = $derived(Array.isArray(value) && value.length === 1 ? value[0] : null);
  const correctSet = $derived(new Set(correctOptionIds ?? []));
  // Every reveal predicate is guarded by this, so none can fire pre-submit.
  const isRevealed = $derived(correctOptionIds !== null);
  const studentAnswered = $derived(selected !== null);
</script>

<fieldset>
  <legend><div class="text">{@html question.text_html}</div></legend>
  <div class="opts">
    {#each question.options as opt (opt.id)}
      {@const isChosen = selected === opt.id}
      <!-- `isCorrect` is authored reveal-gated (the spec-pinned form), so it is
           false for every option pre-submit. That alone does NOT hold the other
           predicates back — isWrongPick/isRevealNeutral NEGATE isCorrect, so
           false makes their term true; their own explicit `isRevealed &&` is
           the load-bearing guard that stops a pick turning red/grey pre-submit. -->
      {@const isCorrect = isRevealed && correctSet.has(opt.id)}
      {@const isRevealCorrect = isCorrect && (isChosen || !studentAnswered)}
      {@const isWrongPick = isRevealed && isChosen && !isCorrect}
      {@const isMissedCorrect = isCorrect && !isChosen && studentAnswered}
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
          type="radio"
          name={`q-${question.id}`}
          value={opt.id}
          checked={isChosen}
          {disabled}
          onchange={() => onanswer([opt.id])}
        />
        <span class="ctl">{#if isChosen}<span class="dot"></span>{/if}</span>
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
  fieldset {
    border: 0;
    padding: 0;
    margin: 0; /* the article gap owns the rhythm */
    /* mechanism: the UA `min-inline-size:min-content` would let an over-long
       unbreakable word widen the whole group past its column — T2 raised the
       row's min-content width by making `.opt` a flex row whose `flex:0 0 auto`
       `.ctl` and `.mark` flank the text — which drags every SIBLING row wide
       too. `.opt`'s `overflow-wrap` already collapses that for OPTION text, so
       the case this still catches is the PROMPT: the legend's markdown is
       outside `.opt`, so zeroing here is what holds the option rows at the
       column width when a prompt carries an unbreakable token. */
    min-inline-size: 0;
  }
  /* A rendered <legend> is NOT a flex item (it is laid out at the block-start),
     so a fieldset `gap` cannot separate prompt from options — the legend's own
     margin owns that step. `padding:0` zeroes the UA padding-inline so the
     prompt sits flush-left with the option rows (ref 2125). */
  legend {
    display: block;
    padding: 0;
    margin: 0 0 16px; /* ref 2120 */
    font-size: 14.5px; /* ref 2125 */
    line-height: 1.6; /* ref 2125 */
    font-weight: 400;
    color: var(--text-2);
    text-wrap: pretty;
    /* Load-bearing for reflow, not defensive. A rendered <legend> is
       SHRINK-TO-FIT, so a <pre> inside it widens the legend itself and the
       scroller below never fires — measured 784px of page scroll at a 320px
       viewport with the `pre` rule present but this line absent. `.text {
       max-width: 100% }` does NOT substitute: the legend is the box that grows. */
    max-width: 100%;
  }
  /* Server-rendered markdown: keep the inter-paragraph rhythm (reset.css zeroes
     `p` globally, so this is its only source) and zero ONLY the trailing gap —
     the legend margin above already owns prompt→options. */
  /* Reflow (WCAG 1.4.10). The prompt renders UNBOUNDED teacher markdown through
     `{@html}` (`text_md` is uncapped — backend/mathion/schemas.py:323), and until
     the whole-branch review it carried NEITHER guard. Measured at a 320px
     viewport: one hyphen-free URL produced 659px of PAGE-level horizontal scroll,
     a fenced code block 784px. `overflow-wrap` closes the prose case and the
     `pre` scroller closes the code case — the identical pair already on
     TextQuestion, NumericQuestion and PageItem, each on its own `.text` /
     `.content` rule and its `:global(pre)` companion (cited by SELECTOR, not by
     line: the line form was stale on arrival — the same commit that added this
     comment added four lines to the PageItem block above the lines it named,
     which is the fourth time that has happened in this slice).

     The fieldset's `min-inline-size: 0` above is a DIFFERENT fix and does not
     cover this: it stops an unbreakable prompt token from dragging the OPTION
     rows wide, but never wraps the prompt itself. */
  .text { overflow-wrap: anywhere; }
  .text :global(pre) { overflow-x: auto; max-width: 100%; }
  .text :global(p) { margin: 0 0 var(--space-2); }
  .text :global(p:last-child) { margin: 0; }
  /* max-width matches `.txt`'s 480px (TextQuestion.svelte) so every answer
     control in a quiz — choice rows, text field, numeric field — stops at one
     shared right edge instead of each question type picking its own. Before
     the §103 correction the quiz sat at 571px, which hid the difference; the
     quiz article is now 652px, so an uncapped option row would run the full 652
     and `.mark`'s `margin-left:auto` would flush the tick far from its label.
     (An earlier revision of this comment said "now that the quiz fills the 960px
     page … ~928px" — true only during the brief uncapped window between the two
     halves of that correction, and false as shipped. revD-M3.)
     NOTHING IN-REPO GUARDS THE PAIRING: 480px is a literal in three files now
     (here, MultiChoiceQuestion, TextQuestion) with no shared token — spec §3
     pins `.txt`'s value as retained verbatim, so it is deliberately not
     refactored into one. Changing one and not the others silently unaligns
     the column, and nothing in the suite, svelte-check or the build says so. */
  .opts { display: flex; flex-direction: column; gap: 8px; /* ref 2126 */ max-width: 480px; }

  /* (1) base row */
  .opt {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px; /* ref 2127 */
    padding: var(--btn-pad-sm); /* 4px 9px — ref 2127 */
    border: 1px solid var(--border-strong); /* ref 2127 */
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 14px; /* ref 2127 */
    color: var(--text-2);
    cursor: pointer;
    /* mechanism: an unbreakable option token would otherwise cross the row's
       painted border and scroll the page (WCAG 1.4.10 reflow). `anywhere`, NOT
       `break-word`: only `anywhere` reduces the automatic minimum size of the
       anonymous flex item holding the option text, and that item has no element
       to give `min-width:0` to. */
    overflow-wrap: anywhere;
  }
  /* mechanism: visually-hidden native input — the real focusable/checkable
     control, NOT a disabled treatment (Constraint 2 exemption). */
  .opt input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: -1px; }
  /* Drawn control: a real element, never a pseudo-element (ref 2127).
     `flex:0 0 auto` so a long option text cannot shrink the ring. */
  .ctl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 15px; /* ref 2127 */
    height: 15px; /* ref 2127 */
    border: 1.5px solid var(--border-strong); /* ref 2127 ring weight; its #C4CAD4 is untokenised, so it resolves to the nearest enabled-control token */
    border-radius: 50%; /* ref 2127 */
    flex: 0 0 auto;
  }
  .ctl .dot { width: 7px; height: 7px; border-radius: 50%; /* ref 2128 */ background: var(--primary); }
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
  .opt.selected { border: 1.5px solid var(--primary); /* ref 2128 */ background: var(--primary-soft); font-weight: 500; color: var(--text); }
  /* (6) */
  .opt.selected .ctl { border-color: var(--primary); }
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

  .opt input:focus-visible { box-shadow: none; }              /* a no-op since Polish 2 (the field rule skips this input); kept for Polish 3 */
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
