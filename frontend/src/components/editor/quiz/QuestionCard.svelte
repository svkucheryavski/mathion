<script lang="ts">
  // One question in the overview (spec §A question card): the rendered text
  // (plain source when disabled), the type chip, D9 hints, the answers and the
  // explanation. Clicking the text never edits it.
  import { getContext } from 'svelte';
  import ChoiceAnswers from './ChoiceAnswers.svelte';
  import KeyAnswer from './KeyAnswer.svelte';
  import { newTabLinks } from '../../../lib/newTabLinks';
  import { TYPE_LABEL, questionHints } from '../../../lib/quizFormat';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import type { AuthoringOption, AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n }: { q: AuthoringQuestion; n: number } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const textId = `${uid}-text`;

  const choice = $derived(q.type === 'single_choice' || q.type === 'multiple_choice');
  let options = $state<AuthoringOption[] | null>(null);
  const hints = $derived(questionHints(q.type, choice ? options : null, q.precision));
  const hasExpl = $derived((q.explanation_md ?? '').trim() !== '');
</script>

<li class="qcard" data-q-id={q.id} aria-labelledby={textId}>
  <div class="qhead">
    <span class="qnum" aria-hidden="true">{n}.</span>
    {#if ctx.disabled}
      <pre class="qsrc" id={textId}>{q.text_md}</pre>
    {:else}
      <div class="qtext" id={textId} {@attach newTabLinks(q.text_html)}>{@html q.text_html}</div>
    {/if}
    <span class="qmeta">
      <span class="qchip">{TYPE_LABEL[q.type]}</span>
      {#each hints as h (h)}<span class="qhint">{h}</span>{/each}
    </span>
  </div>

  <div class="qanswers">
    {#if choice}
      <ChoiceAnswers {q} {n} bind:options />
    {:else}
      <KeyAnswer {q} {n} />
    {/if}
  </div>

  {#if hasExpl}
    <div class="qexpl">
      <span class="qexpl-label">Explanation</span>
      {#if ctx.disabled}
        <pre class="qsrc">{q.explanation_md}</pre>
      {:else}
        <div class="qexpl-body" {@attach newTabLinks(q.explanation_html ?? '')}>{@html q.explanation_html ?? ''}</div>
      {/if}
    </div>
  {/if}
</li>

<style>
  .qcard { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
  .qhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 10px 12px 6px; }
  .qnum { flex: 0 0 auto; min-width: 18px; color: var(--ordinal); font-weight: 600; font-size: 14.5px; }
  .qtext { flex: 1 1 260px; min-width: 0; font-size: 14.5px; color: var(--text); overflow-wrap: anywhere; }
  .qsrc { flex: 1 1 260px; min-width: 0; margin: 0; font: inherit; font-size: 13px; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .qmeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  .qchip { font-size: 11px; font-weight: 500; color: var(--muted); background: var(--surface-2); border-radius: 3px; padding: 2px 7px; white-space: nowrap; }
  .qhint { font-size: 11px; font-weight: 500; color: var(--status-needs-revision-fg); white-space: nowrap; }
  .qanswers { padding: 2px 12px 8px 38px; }
  .qexpl { margin: 0 12px 10px 38px; padding: 7px 10px; border-left: 3px solid var(--border-strong); background: var(--surface-2); font-size: 12.5px; color: var(--muted); }
  .qexpl-label { display: block; font-weight: 600; margin-bottom: 2px; }
  /* Rendered author content: images fit the card; headings keep their tags at body size. */
  .qtext :global(p), .qexpl-body :global(p) { margin: 0; }
  .qtext :global(p + p), .qexpl-body :global(p + p) { margin-top: 6px; }
  .qtext :global(img), .qexpl-body :global(img) { max-width: 100%; height: auto; }
  .qtext :global(:is(h1, h2, h3, h4, h5, h6)), .qexpl-body :global(:is(h1, h2, h3, h4, h5, h6)) { font-size: inherit; margin: 0; }
  @media (max-width: 560px) { .qmeta { flex-basis: 100%; margin-left: 26px; } }
</style>
