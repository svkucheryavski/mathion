<script lang="ts">
  import type { QuizItem, Question, QuizSubmitResponse, QuizRevealResponse } from '../../lib/types';
  import { api, ApiError } from '../../lib/api';
  import { recordQuizAttempt, currentCourse } from '../../stores/currentCourse.svelte';
  import { getDraft, setDraft, clearDraft, holdsAnswers } from '../../stores/quizDrafts.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { assertNever } from '../../lib/types';
  import { externalLinks } from '../../lib/externalLinks';
  import SingleChoice from './quiz/SingleChoiceQuestion.svelte';
  import MultiChoice from './quiz/MultiChoiceQuestion.svelte';
  import Numeric from './quiz/NumericQuestion.svelte';
  import Text from './quiz/TextQuestion.svelte';
  import Button from '../ui/Button.svelte';
  import EmptyState from '../ui/EmptyState.svelte';

  let { item }: { item: QuizItem } = $props();

  // D83: start from the draft kept while the student was elsewhere. ItemRouter
  // keys this component on the item id (C13), so `item` never changes under it.
  // svelte-ignore state_referenced_locally
  let answers = $state<Record<string, number[] | string>>(getDraft(item.id) ?? {});
  let inflight = $state<Promise<QuizSubmitResponse> | null>(null);
  let lastResult = $state<QuizSubmitResponse | null>(null);
  let revealed = $state<QuizRevealResponse | null>(null);
  let autoRevealed = $state(false); // tracks "exhausted on mount" branch so we hide retry UI
  // Attempt count from the most recent successful submit, kept across
  // `tryAgain()` (which clears `lastResult`) so the attempts line does not fall
  // back to a store count that `recordQuizAttempt` could not bump (no course
  // snapshot is loaded). Keyed off the RESPONSE's `item_id`, not
  // the `item` prop: a late response must only ever describe its own item.
  let lastAttempt = $state<{ id: number; count: number } | null>(null);
  // D89: a quiz opened after a submit with attempts left shows that result
  // (the store's last answers and score), until Try again. A draft kept from
  // a new attempt wins, so it is read once, as `answers` is.
  // svelte-ignore state_referenced_locally
  const openedWithDraft = getDraft(item.id) !== undefined;
  let retried = $state(false);
  const stored = $derived.by(() => {
    if (openedWithDraft || retried || lastResult !== null || revealed !== null) return null;
    const max = currentCourse.value?.version.max_quiz_attempts;
    const st = currentCourse.value?.state.items[String(item.id)];
    if (max === undefined || st === undefined || st.last_score === null) return null;
    if (st.attempt_count < 1 || st.attempt_count >= max) return null;
    return { answers: st.last_answers ?? {}, score: st.last_score, attempt: st.attempt_count, max };
  });

  const revealById = $derived(
    revealed === null
      ? null
      : Object.fromEntries(revealed.questions.map((r) => [r.id, r])),
  );

  const locked = $derived(lastResult !== null || revealed !== null || stored !== null);

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
  // reveal, or from the stored result (D89); otherwise use the in-progress
  // `answers` map.
  function valueFor(qid: number): number[] | string | undefined {
    if (stored !== null) return stored.answers[String(qid)];
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
      // Nothing left to submit: drop a restored draft, so it neither keeps
      // the leave-page warning on nor re-enables Submit while the reveal loads.
      clearDraft(item.id);
      answers = {};
      void revealAnswers();
    }
  });

  const allAnswered = $derived(
    item.questions.every((q) => holdsAnswers(answers[String(q.id)]))
  );

  function setAnswer(qid: number, ans: number[] | string): void {
    answers[String(qid)] = ans;
    setDraft(item.id, $state.snapshot(answers));
  }

  async function submit(): Promise<void> {
    if (inflight !== null) {
      void inflight;
      return;
    }
    try {
      const sent = $state.snapshot(answers);
      inflight = api.post<QuizSubmitResponse>(`/api/items/${item.id}/submit`, { answers: sent });
      const res = await inflight;
      lastResult = res;
      lastAttempt = { id: res.item_id, count: res.attempt_count };
      recordQuizAttempt(res, sent);
      clearDraft(res.item_id);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Submit failed.';
      pushToast(msg, 'error');
    } finally {
      inflight = null;
    }
  }

  function tryAgain(): void {
    retried = true;
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
    <EmptyState title="This quiz has no questions yet." />
  </article>
{:else}
  <article class="quiz">
    <h2>{item.title}</h2>
    {#each item.questions as q, i (q.id)}
      <!-- `{@const}` must stay an immediate {#each} child — Svelte rejects it
           inside a plain element. `r` is still in scope within .q-block. -->
      {@const r = revealById?.[q.id] ?? null}
      {#if i > 0}<hr class="q-sep" />{/if}
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
          <div class="exp prose compact" {@attach externalLinks(r.explanation_html)}>{@html r.explanation_html}</div>
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
      {@const score = lastResult ? { correct: lastResult.score_correct, total: lastResult.score_total, attempt: lastResult.attempt_count, max: lastResult.max_attempts, canRetry: lastResult.can_retry } : revealed ? { correct: revealed.score_correct, total: revealed.score_total, attempt: revealed.attempt_count, max, canRetry: revealed.attempt_count < max } : stored ? { correct: stored.score.correct, total: stored.score.total, attempt: stored.attempt, max: stored.max, canRetry: true } : null}
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
     child margin below is zeroed against it — except the separator's 8px,
     which adds to the gap on purpose (D75). */
  .quiz {
    display: flex;
    flex-direction: column;
    gap: 16px; /* ref 2120 */
    align-items: stretch;
    padding: 0;
  }
  /* The text measure. D75: it sits on each direct child, not the article, so
     the separator below can span the whole sheet while every block keeps
     652px; :global so EmptyState's root keeps it too.
     652px = ref 2120's measure ROUNDED DOWN from 652.8px (68ch at the
     reference document's 16px root, in the IBM Plex Sans its :14 font link
     loads; see the derivation on SequencePlayer's .content). Not "exactly the
     reference measure" — 0.8px short of it, which is why this says rounded. The
     article has `padding:0`, so 652px IS the content measure — no box-sizing
     adjustment needed, unlike PageItem. Kept as a px literal on purpose:
     re-expressing it as `68ch` re-introduces the 14px-vs-16px shrink this value
     exists to correct. */
  .quiz > :global(*) { max-width: 652px; }
  .quiz h2 { font-size: 16px; /* ref 2122 */ font-weight: 600; color: var(--text); }
  /* Counter + question + explanation read as one unit. */
  .q-block {
    display: flex;
    flex-direction: column;
    gap: 6px; /* Constraint 5(b) no-ref — the tight intra-group step, as on the player's item strip (ref 2112) */
  }
  /* GROUP BOUNDARY. The reference shows ONE question per quiz card, so it never
     had to say how two questions separate; this surface renders them all at
     once. D75 (Safari pass): the old 1px hairline over the 652px measure was too
     faint, so the separator is now the sheet's own frame — 2px --border — run
     edge to edge: the negative inline margin cancels the player's sheet padding
     (--sheet-pad-x, SequencePlayer's .content), so the line meets the frame on
     both sides. Outside the player the fallback 0px keeps it inside the box.
     The 8px margins add to the article's 16px gap: 24px above and below.
     --border, NOT --border-faint: that token means "disabled control" here (it
     paints every locked option ring in this view). */
  .quiz > .q-sep {
    border: 0;
    border-top: 2px solid var(--border);
    height: 0;
    margin: 8px calc(-1 * var(--sheet-pad-x, 0px));
    max-width: none;
  }
  /* 12.5px, NOT ref 2123's 11.5px. In the reference the counter sits beside a
     16px h2, where 11.5px reads as a subordinate annotation on the same line.
     Standing alone above each question it is too small to scan (reported on the
     real stack, 2026-09-04). 12.5px is NOT borrowed from .hint/.meta, which are
     sans secondary PROSE — this is mono positional chrome, and its sibling in
     that class is SequencePlayer's .counter, raised to 12.5px in the same edit
     so the two do not disagree ~40px apart on one screen. The rule that pairing
     establishes: positional counters 12.5px, progress ratios ({covered}/{total},
     e.g. CourseCard.svelte:105 and SequenceLink's `.pct`) stay at 11.5px. */
  .q-counter { font-size: 12.5px; color: var(--muted); }
  .submit-row { display: flex; align-items: center; gap: 12px; /* ref 2132 */ }
  .hint { color: var(--muted); font-size: 12.5px; /* ref 2134 */ margin: 0; }
  /* --surface-2, not --surface-3: the card sits on the white player sheet
     (D56), against which --surface-3 is a near-invisible step. flex-start keeps
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
       in a column flex, so it needs no `max-width`: this and content.css's
       `.prose pre` scroller are the whole fix. */
    overflow-wrap: anywhere;
  }
</style>
