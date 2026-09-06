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
  // The field has no visible <label>; the prompt IS its name, so it needs an
  // id to point at. Derived from question.id so two of these on one page
  // cannot collide (the choice questions get this from fieldset/legend).
  const promptId = $derived(`q-${question.id}-prompt`);
</script>

<div class="row">
  <div class="text" id={promptId}>{@html question.text_html}</div>
  <input
    class="num mono"
    type="text"
    inputmode="decimal"
    aria-labelledby={promptId}
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
     question share one rhythm — and, since the `.text` rule below, one prompt
     treatment too. (spec:131 pins the 14.5px treatment to `legend`; `.text`
     reproduces it on a div. Before that rule this prompt WAS body copy, which
     is what made the two question types read differently.) */
  .row { display: flex; flex-direction: column; gap: 16px; /* ref 2120 */ margin: 0; }
  /* The choice questions' prompt treatment (ref 2125), so both kinds of prompt
     read alike inside one quiz — without it this div inherits body copy
     (14px/1.5/--text) and a quiz mixing question types shows two prompt sizes.
     spec:131 pins the treatment to `legend`; this div takes the five
     declarations spec:131 lists. `font-weight:400` is inert TODAY (a div is
     already 400 — the legend needed it only to undo an authored 500), but it is
     pinned anyway so the prompt is immune to a future ancestor weight, exactly as
     T2's legend already is. NOTHING IN-REPO GUARDS THIS RULE: T3's grep list
     (plan:266) covers only the `.text` paragraph margins, not this typography
     rule and not the `overflow-wrap` above — deleting either leaves the suite,
     svelte-check and the build all green. */
  /* overflow-wrap: the prompt renders UNBOUNDED teacher markdown through
     {@html} — a long URL is likelier here than in the bounded answer below,
     and `.row` is a stretch column whose overflow escapes the quiz article
     (max-width:652px) and .page (max-width:960px), neither of which clips,
     giving page-level horizontal scroll (WCAG 1.4.10). Measured in Chromium
     at 320px: it takes NO break opportunity after `/` or `.`, only at `-`, so
     a slash- or dot-joined run, a hyphen-free URL, a hash and a base64 blob
     all overflow, and every one reaches 0px with this line. A HYPHENATED URL
     wraps unaided, which is why "long URLs are fine" is a trap. Pixel figures
     are deliberately omitted: they move with fixture length and with whether
     the webfont has loaded, and two earlier revisions of this comment quoted
     numbers that did not reproduce. This closes PROSE only — a <pre> needs its
     own rule (below). T2's `legend` carried both gaps when this was written and
     was left out of T3's scope; the whole-branch review measured it at 659-784px
     of page scroll and both choice questions now ship the same pair. */
  .text { overflow-wrap: anywhere; font-size: 14.5px; /* ref 2125 */ line-height: 1.6; /* ref 2125 */ font-weight: 400; color: var(--text-2); text-wrap: pretty; }
  /* Server-rendered markdown: keep the inter-paragraph rhythm (reset.css zeroes
     `p` globally, so this is its only source) and zero ONLY the trailing gap —
     the .row gap already owns prompt→field. */
  .text :global(p) { margin: 0 0 var(--space-2); }
  .text :global(p:last-child) { margin: 0; }
  /* CommonMark (markdown.py:7) emits fenced AND indented code blocks, and
     `text_md` is unbounded (schemas.py:323). `overflow-wrap` above IS inherited
     and computes to `anywhere` on the <pre> — what stops it is the UA's
     `white-space:pre`, which disables soft wrapping so there is no break
     opportunity to act on.
     `overflow-x:auto`, NOT `white-space:pre-wrap`: both reach 0px page
     overflow, but WCAG 1.4.10 excepts "content which requires two-dimensional
     layout for usage or meaning", and a fenced block is the canonical case —
     wrapping shreds ASCII diagrams, aligned tables and indentation. A
     scrollable <pre> is conforming; a mangled one is lost information.
     The scroller is keyboard-focusable in Chromium (measured: tabIndex -1,
     :focus-visible matches), which is what lets a keyboard user scroll it at
     all — but base.css:22's `outline:none` leaves only the --primary-soft halo
     at 1.12:1 on --bg, drawing nothing. So the ring below is load-bearing,
     exactly as `.txt:focus-visible` is for the field. */
  .text :global(pre) { overflow-x: auto; max-width: 100%; }
  .text :global(pre:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }
  /* A local <input> on the control tokens, NOT ui/Input — whose `mono` is the
     PIN-specific 17px/.34em (Input.svelte:40) and whose prop list has neither
     `disabled` nor `inputmode` and no rest-spread. Only the local field styling lives here;
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
  /* mechanism: the global `:focus-visible` (base.css:21-25) is (0,1,0) while
     this scoped field rule is (0,2,0), so the rule's own
     `border:1px solid var(--border-strong)` out-specifies the global
     `border-color:var(--primary)` and the only surviving focus signal is a
     3px --primary-soft halo at 1.12:1 against the page. Restoring it at
     (0,3,0) is the whole fix. Per-component, NOT a combined `.num,.txt` list:
     the absent member would warn, exactly as for `:disabled`. */
  .num:focus-visible { border-color: var(--primary); }
  /* Forced-colors drops box-shadow AND border colours are system-forced, and
     base.css:22's `outline:none` is still in force — so without this a focused
     field has no indicator at all in that mode. Same restoration T2 made for
     the option rows. */
  @media (forced-colors: active) {
    .num:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
  }
  /* Reveal shows the correct answer only — no client-side judging. The numeral
     is mono (Constraint 4) via the same global utility as the field. */
  /* overflow-wrap: an unbreakable answer would otherwise paint past the
     viewport and scroll the page.
     A numeral is bounded (the backend column caps the digits), so this is
     symmetry with its Text twin rather than a live case here. */
  .correct-line { overflow-wrap: anywhere; margin: 0; color: var(--status-accepted-fg); font-size: 13px; /* Constraint 5(b) no-ref — the same 13px step as QuizItem's .exp rule — cited by selector, not by line: this citation named :248 and has gone stale twice as comment blocks landed above it */ }
</style>
