<script lang="ts">
  import type { QuizItem, Question, QuizSubmitResponse, QuizRevealResponse } from '../../lib/types';
  import { api, ApiError } from '../../lib/api';
  import { markItemCovered, currentCourse } from '../../stores/currentCourse.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { assertNever } from '../../lib/types';
  import SingleChoice from './quiz/SingleChoiceQuestion.svelte';
  import MultiChoice from './quiz/MultiChoiceQuestion.svelte';
  import Numeric from './quiz/NumericQuestion.svelte';
  import Text from './quiz/TextQuestion.svelte';
  import Button from '../ui/Button.svelte';

  let { item }: { item: QuizItem } = $props();

  let answers = $state<Record<string, number[] | string>>({});
  let inflight = $state<Promise<QuizSubmitResponse> | null>(null);
  let lastResult = $state<QuizSubmitResponse | null>(null);
  let revealed = $state<QuizRevealResponse | null>(null);
  let autoRevealed = $state(false); // tracks "exhausted on mount" branch so we hide retry UI
  // Attempt count from the most recent successful submit, kept across
  // `tryAgain()` (which clears `lastResult`) so the attempts line does not fall
  // back to the never-bumped store count. Keyed off the RESPONSE's `item_id`,
  // not the reactive `item` prop: `item` is read after the `await`, so a
  // navigation while the submit is in flight would otherwise tag this item's
  // count onto the next one.
  let lastAttempt = $state<{ id: number; count: number } | null>(null);

  const revealById = $derived(
    revealed === null
      ? null
      : Object.fromEntries(revealed.questions.map((r) => [r.id, r])),
  );

  const locked = $derived(lastResult !== null || revealed !== null);

  const attemptsUsed = $derived(
    lastResult?.attempt_count
    ?? revealed?.attempt_count
    ?? (lastAttempt?.id === item.id ? lastAttempt.count : undefined)
    ?? currentCourse.value?.state.items[String(item.id)]?.attempt_count
    ?? 0,
  );

  const remaining = $derived(
    Math.max(0, (currentCourse.value?.version.max_quiz_attempts ?? 0) - attemptsUsed),
  );

  // Resolve the value to display per question: pre-fill from the student's
  // last submitted answers (revealed.student_answer) when we auto-loaded the
  // reveal; otherwise use the in-progress `answers` map.
  function valueFor(qid: number): number[] | string | undefined {
    const r = revealById?.[qid];
    if (r && autoRevealed && r.student_answer !== null && r.student_answer !== undefined) {
      return r.student_answer;
    }
    return answers[String(qid)];
  }

  // Auto-load reveal when the state shows attempts already exhausted (e.g.,
  // user reopens an item after using all attempts in a previous session).
  $effect(() => {
    const max = currentCourse.value?.version.max_quiz_attempts;
    const st = currentCourse.value?.state.items[String(item.id)];
    if (
      max !== undefined &&
      st !== undefined &&
      st.attempt_count >= max &&
      revealed === null &&
      lastResult === null &&
      inflight === null
    ) {
      autoRevealed = true;
      void revealAnswers();
    }
  });

  const allAnswered = $derived(
    item.questions.every((q) => {
      const a = answers[String(q.id)];
      if (a === undefined) return false;
      if (Array.isArray(a)) return a.length > 0;
      return typeof a === 'string' && a.trim().length > 0;
    })
  );

  function setAnswer(qid: number, ans: number[] | string): void {
    answers[String(qid)] = ans;
  }

  async function submit(): Promise<void> {
    if (inflight !== null) {
      void inflight;
      return;
    }
    try {
      inflight = api.post<QuizSubmitResponse>(`/api/items/${item.id}/submit`, { answers });
      const res = await inflight;
      lastResult = res;
      lastAttempt = { id: res.item_id, count: res.attempt_count };
      markItemCovered(res.item_id);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Submit failed.';
      pushToast(msg, 'error');
    } finally {
      inflight = null;
    }
  }

  function tryAgain(): void {
    answers = {};
    lastResult = null;
    revealed = null;
    autoRevealed = false;
  }

  async function revealAnswers(): Promise<void> {
    try {
      revealed = await api.get<QuizRevealResponse>(`/api/items/${item.id}/reveal`);
    } catch (e: unknown) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Could not load answers.', 'error');
    }
  }

  // Exhaustiveness check — keep `assertNever` reachable so future Question.type
  // additions surface as compile errors at this site.
  function checkExhaustive(q: Question): void {
    switch (q.type) {
      case 'single_choice':
      case 'multiple_choice':
      case 'numeric_answer':
      case 'text_answer':
        return;
      default:
        assertNever(q);
    }
  }
  $effect(() => { item.questions.forEach(checkExhaustive); });
</script>

{#if item.questions.length === 0}
  <article class="quiz">
    <h2>{item.title}</h2>
    <p class="empty">This quiz has no questions yet.</p>
  </article>
{:else}
  <article class="quiz">
    <h2>{item.title}</h2>
    {#each item.questions as q, i (q.id)}
      <!-- `{@const}` must stay an immediate {#each} child — Svelte rejects it
           inside a plain element. `r` is still in scope within .q-block. -->
      {@const r = revealById?.[q.id] ?? null}
      <div class="q-block">
        <span class="q-counter mono">Question {i + 1} of {item.questions.length}</span>
        {#if q.type === 'single_choice'}
          <SingleChoice question={q} value={valueFor(q.id)} onanswer={(a) => setAnswer(q.id, a)}
            disabled={locked} correctOptionIds={r?.correct_option_ids ?? null} />
        {:else if q.type === 'multiple_choice'}
          <MultiChoice question={q} value={valueFor(q.id)} onanswer={(a) => setAnswer(q.id, a)}
            disabled={locked} correctOptionIds={r?.correct_option_ids ?? null} />
        {:else if q.type === 'numeric_answer'}
          <Numeric question={q} value={valueFor(q.id)} onanswer={(a) => setAnswer(q.id, a)}
            disabled={locked} correctValue={r?.correct_numeric ?? null} />
        {:else if q.type === 'text_answer'}
          <Text question={q} value={valueFor(q.id)} onanswer={(a) => setAnswer(q.id, a)}
            disabled={locked} correctValue={r?.correct_text ?? null} />
        {/if}
        {#if r?.explanation_html}
          <div class="exp">{@html r.explanation_html}</div>
        {/if}
      </div>
    {/each}

    {#if !locked}
      <div class="submit-row">
        <Button
          onclick={submit}
          loading={inflight !== null}
          disabled={!allAnswered || inflight !== null}
          title={!allAnswered ? 'Answer every question first' : inflight !== null ? 'Submitting…' : undefined}
        >
          Submit answer
        </Button>
        <!-- The attempts line needs the snapshot's max_quiz_attempts; QuizItem
             is independently mountable (tests), so guard on the snapshot. -->
        {#if currentCourse.value !== null}
          <p class="hint"><span class="mono">{remaining}</span> {remaining === 1 ? 'attempt' : 'attempts'} left</p>
        {/if}
      </div>
    {:else}
      {@const max = currentCourse.value?.version.max_quiz_attempts ?? 0}
      {@const score = lastResult ? { correct: lastResult.score_correct, total: lastResult.score_total, attempt: lastResult.attempt_count, max: lastResult.max_attempts, canRetry: lastResult.can_retry } : revealed ? { correct: revealed.score_correct, total: revealed.score_total, attempt: revealed.attempt_count, max, canRetry: revealed.attempt_count < max } : null}
      {#if score}
        <div class="result">
          <p><strong>Score:</strong> <span class="mono">{score.correct} / {score.total}</span></p>
          <p class="meta">Attempt <span class="mono">{score.attempt}</span> of <span class="mono">{score.max}</span></p>
          {#if score.canRetry}
            <Button onclick={tryAgain}>Try again</Button>
          {:else if lastResult && !revealed}
            <Button variant="secondary" onclick={revealAnswers}>Show correct answers</Button>
          {/if}
        </div>
      {/if}
    {/if}
  </article>
{/if}

<style>
  /* The article gap is the sole vertical-rhythm owner, so every surviving
     child margin below is zeroed against it. */
  /* max-width 652px = ref 2120's measure ROUNDED DOWN from 652.8px (68ch at the
     reference document's 16px root, in the IBM Plex Sans its :14 font link
     loads; see the derivation on SequencePlayer's .content). Not "exactly the
     reference measure" — 0.8px short of it, which is why this says rounded. This article has
     `padding:0`, so 652px IS the content measure — no box-sizing adjustment
     needed, unlike PageItem. Kept as a px literal on purpose: re-expressing it as
     `68ch` re-introduces the 14px-vs-16px shrink this value exists to correct. */
  .quiz {
    display: flex;
    flex-direction: column;
    gap: 16px; /* ref 2120 */
    align-items: stretch;
    padding: 0;
    max-width: 652px;
  }
  .quiz h2 { font-size: 16px; /* ref 2122 */ font-weight: 600; color: var(--text); }
  .empty { color: var(--muted); }
  /* Counter + question + explanation read as one unit. */
  .q-block {
    display: flex;
    flex-direction: column;
    gap: 6px; /* Constraint 5(b) no-ref — the tight intra-group step, as on the player's item strip (ref 2112) */
  }
  /* GROUP BOUNDARY — a deliberate extension of the deviation spec:124 already
     records. The reference shows exactly ONE question per quiz card, with the
     counter inline on the h2 baseline, so it never had to express how two
     questions separate. This surface renders them all at once, where the
     article's 16px gap against .q-block's 6px left only 10px of
     differentiation and six questions read as one wall (browser pass on the
     real stack, 2026-09-04). The hairline is what the gap alone could not say.
     `+` not `:not(:first-child)`: only a q-block FOLLOWING another gets the
     rule, so the submit row and result card below are untouched. */
  .q-block + .q-block {
    /* --border, NOT --border-faint: theme-default.css:22 documents that token as
       "disabled control borders", and all 12 of its other uses in src/ are
       exactly that — including `.opt.locked .ctl` and `.opt.reveal-neutral .ctl`,
       which paint it on every option ring in THIS view once the quiz locks, so a
       divider drawn in it is the colour this design uses to mean "disabled".
       --border-soft is the semantically-labelled "row separators inside a card",
       but it is LIGHTER (contrast on --bg: --border 1.22:1, --border-faint
       1.11:1, --border-soft 1.09:1), which works against the very complaint this
       rule answers. --border is also what the two rules bracketing this quiz on
       the same screen use (SequencePlayer .strip bottom, footer top). */
    border-top: 1px solid var(--border);
    padding-top: 20px; /* Constraint 5(b) no-ref — the group-boundary step, above the 16px article gap */
  }
  /* 12.5px, NOT ref 2123's 11.5px. In the reference the counter sits beside a
     16px h2, where 11.5px reads as a subordinate annotation on the same line.
     Standing alone above each question it is too small to scan (reported on the
     real stack, 2026-09-04). 12.5px is NOT borrowed from .hint/.meta, which are
     sans secondary PROSE — this is mono positional chrome, and its sibling in
     that class is SequencePlayer's .counter, raised to 12.5px in the same edit
     so the two do not disagree ~40px apart on one screen. The rule that pairing
     establishes: positional counters 12.5px, progress ratios ({covered}/{total},
     e.g. CourseCard.svelte:105 and T7's SequenceLink) stay at 11.5px. */
  .q-counter { font-size: 12.5px; color: var(--muted); }
  .submit-row { display: flex; align-items: center; gap: 12px; /* ref 2132 */ }
  .hint { color: var(--muted); font-size: 12.5px; /* ref 2134 */ margin: 0; }
  /* --surface-2, not --surface-3: the card sits on the article's inherited
     --bg, against which --surface-3 is a near-invisible step. flex-start keeps
     the Button children from blockifying under the default stretch. */
  .result {
    background: var(--surface-2);
    border: 1px solid var(--border); /* Constraint 5(b) no-ref — the standard 1px card border */
    border-radius: var(--radius);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
    margin-top: 0;
  }
  .meta { color: var(--muted); font-size: 12.5px; /* Constraint 5(b) no-ref — the 12.5px secondary-text step, as on .hint (ref 2134) */ }
  /* Information panel: --surface-2 tint + --primary left rule (visual-spec §4). */
  .exp {
    background: var(--surface-2);
    border-left: 3px solid var(--primary); /* Constraint 5(b) no-ref — visual-spec §4's 3px information-banner rule */
    color: var(--text-2);
    font-size: 13px; /* Constraint 5(b) no-ref — the body-copy step below the 14.5px prompt */
    padding: 8px 10px; /* Constraint 5(b) no-ref — the code/textarea padding scale (--control-pad-textarea) */
    margin: 0;
    /* Reflow (WCAG 1.4.10), the same class as the prompt fix in both choice
       components. `.exp` renders unbounded `explanation_md` through `{@html}`
       (uncapped — backend/mathion/schemas.py:325). Measured at a 320px viewport
       before this: 614px of page scroll from one hyphen-free URL, 718px from a
       fenced code block. Unlike the <legend> there, `.exp` is an ordinary block
       in a column flex, so it needs no `max-width` — these two rules are the
       whole fix. */
    overflow-wrap: anywhere;
  }
  .exp :global(pre) { overflow-x: auto; max-width: 100%; }
</style>
