<script lang="ts">
  import type { TextQuestion } from '../../../lib/types';
  import { externalLinks } from '../../../lib/externalLinks';

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
  <div class="text prose compact" id={promptId} {@attach externalLinks(question.text_html)}>{@html question.text_html}</div>
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
     (max-width:652px) and .page (max-width:var(--page-max)), neither of which clips,
     giving page-level horizontal scroll (WCAG 1.4.10). Measured in Chromium
     at 320px: it takes NO break opportunity after `/` or `.`, only at `-`, so
     a slash- or dot-joined run, a hyphen-free URL, a hash and a base64 blob
     all overflow, and every one reaches 0px with this line. A HYPHENATED URL
     wraps unaided, which is why "long URLs are fine" is a trap. Pixel figures
     are deliberately omitted: they move with fixture length and with whether
     the webfont has loaded, and two earlier revisions of this comment quoted
     numbers that did not reproduce. This closes PROSE only; a <pre> scrolls
     by content.css's `.prose pre` (Polish 2). */
  .text { overflow-wrap: anywhere; font-size: 14.5px; /* ref 2125 */ line-height: 1.6; /* ref 2125 */ font-weight: 400; color: var(--text-2); text-wrap: pretty; }
  /* Code blocks scroll by content.css's `.prose pre` (Polish 2), and its
     paragraph spacing is content.css's too. The scroller is keyboard-focusable
     in Chromium, which is what lets a keyboard user scroll it at all; this ring
     is pinned by the T3 inventory, so a change to the global ring cannot drop it. */
  .text :global(pre:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }
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
  /* The global field rule (base.css) also sets this border colour since
     Polish 2. This rule stays pinned by the T3 inventory. Per-component, NOT a
     combined `.num,.txt` list: the absent member would warn, exactly as for
     `:disabled`. */
  .txt:focus-visible { border-color: var(--primary); }
  /* Forced colors drop box-shadow and force border colours. This offset keeps
     the global forced-colors outline (base.css) inside the field. */
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
  .correct-line { overflow-wrap: anywhere; margin: 0; color: var(--status-accepted-fg); font-size: 13px; /* Constraint 5(b) no-ref — the same 13px step as QuizItem's .exp rule — cited by selector, not by line: this citation named :248 and has gone stale twice as comment blocks landed above it */ }
</style>
