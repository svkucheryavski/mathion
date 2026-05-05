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

  const revealById = $derived(
    revealed === null
      ? null
      : Object.fromEntries(revealed.questions.map((r) => [r.id, r])),
  );

  const locked = $derived(lastResult !== null || revealed !== null);

  const attemptsUsed = $derived(
    lastResult?.attempt_count
    ?? revealed?.attempt_count
    ?? currentCourse.value?.state.items[String(item.id)]?.attempt_count
    ?? 0,
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
      markItemCovered(item.id);
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
    {#each item.questions as q (q.id)}
      {@const r = revealById?.[q.id] ?? null}
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
    {/each}

    {#if !locked}
      <Button onclick={submit} loading={inflight !== null} disabled={!allAnswered || inflight !== null}>
        Submit
      </Button>
    {:else}
      {@const max = currentCourse.value?.version.max_quiz_attempts ?? 0}
      {@const score = lastResult ? { correct: lastResult.score_correct, total: lastResult.score_total, attempt: lastResult.attempt_count, max: lastResult.max_attempts, canRetry: lastResult.can_retry } : revealed ? { correct: revealed.score_correct, total: revealed.score_total, attempt: revealed.attempt_count, max, canRetry: revealed.attempt_count < max } : null}
      {#if score}
        <div class="result">
          <p><strong>Score:</strong> {score.correct} / {score.total}</p>
          <p class="meta">Attempt {score.attempt} of {score.max}</p>
          {#if score.canRetry}
            <Button onclick={tryAgain}>Try again</Button>
          {:else if lastResult && !revealed}
            <Button variant="secondary" onclick={revealAnswers}>Show correct answers</Button>
          {/if}
        </div>
      {/if}
    {/if}
    <p class="hint">Maximum {currentCourse.value?.version.max_quiz_attempts ?? '?'} attempts per quiz ({attemptsUsed} used).</p>
  </article>
{/if}

<style>
  .quiz { padding: var(--space-3); }
  .empty { color: var(--muted); }
  .result { padding: var(--space-3); margin-top: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .meta { color: var(--muted); font-size: 0.875rem; }
  .hint { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-3); }
  .exp {
    color: var(--muted);
    font-size: 0.9rem;
    margin: calc(-1 * var(--space-2)) 0 var(--space-3) var(--space-3);
    padding-left: var(--space-2);
    border-left: 2px solid var(--border);
  }
</style>
