import { describe, it, expect, afterEach } from 'vitest';
import { QuizServer, q, renderQuiz, cleanup, settle, cards, byName, text } from './support/quizHarness.svelte';

afterEach(cleanup);

const cardAsk = (card: HTMLElement) => card.querySelector<HTMLElement>('.qask .inline-confirm');

describe('QuizBody delete title (math plan T6)', () => {
  it('reads a typeset question as its visible text, never the LaTeX annotation', async () => {
    const html = '<p>a <math><semantics><msup><mi>x</mi><mn>2</mn></msup>'
      + '<annotation encoding="application/x-tex">x^2</annotation></semantics></math></p>';
    await renderQuiz(new QuizServer([q({ id: 1, text_md: 'a $x^2$', text_html: html })]));
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    expect(text(cardAsk(cards()[0])!.querySelector('.warning'))).toBe('Delete question "a x2"? This cannot be undone.');
  });
});
