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
      {#if q.type === 'single_choice'}
        <SingleChoice question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {:else if q.type === 'multiple_choice'}
        <MultiChoice question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {:else if q.type === 'numeric_answer'}
        <Numeric question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {:else if q.type === 'text_answer'}
        <Text question={q} value={answers[String(q.id)]} onanswer={(a) => setAnswer(q.id, a)} />
      {/if}
    {/each}

    {#if !lastResult}
      <Button onclick={submit} loading={inflight !== null} disabled={!allAnswered || inflight !== null}>
        Submit
      </Button>
    {:else}
      <div class="result">
        <p><strong>Score:</strong> {lastResult.score_correct} / {lastResult.score_total}</p>
        <p class="meta">Attempt {lastResult.attempt_count} of {lastResult.max_attempts}</p>
        {#if lastResult.can_retry}
          <Button onclick={tryAgain}>Try again</Button>
        {:else if !revealed}
          <Button variant="secondary" onclick={revealAnswers}>Show correct answers</Button>
        {/if}
      </div>
      {#if revealed}
        <div class="reveal">
          <h3>Correct answers</h3>
          <ul>
            {#each revealed.questions as r (r.id)}
              <li>
                Q{r.id}:
                {#if r.correct_options}
                  options {r.correct_options.join(', ')}
                {:else if r.correct_value !== undefined}
                  {r.correct_value}
                {/if}
                {#if r.explanation_html}<div class="exp">{@html r.explanation_html}</div>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
    <p class="hint">Maximum {currentCourse.value?.version.max_quiz_attempts ?? '?'} attempts per quiz.</p>
  </article>
{/if}

<style>
  .quiz { padding: var(--space-3); }
  .empty { color: var(--muted); }
  .result { padding: var(--space-3); margin-top: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .meta { color: var(--muted); font-size: 0.875rem; }
  .hint { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-3); }
  .reveal { margin-top: var(--space-3); }
  .reveal li { margin-bottom: var(--space-2); }
  .exp { color: var(--muted); margin-top: var(--space-1); }
</style>
