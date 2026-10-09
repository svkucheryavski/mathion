import { describe, it, expect, afterEach } from 'vitest';
import {
  QuizServer, q, opt, renderQuiz, cleanup, settle, panel, cards, rows, byName, live, text,
} from './support/quizHarness.svelte';

afterEach(cleanup);

describe('Quiz overview (5d T3)', () => {
  it('one card per question: ordinal, rendered text, chip; no footer and no Title row', async () => {
    const s = new QuizServer([
      q({ id: 1, text_html: '<p>What is <em>x</em>?</p>' }),
      q({ id: 2, type: 'numeric_answer', correct_numeric: 5, precision: 2 }),
    ]);
    await renderQuiz(s);
    const [c1, c2] = cards();
    expect(text(c1.querySelector('.qnum'))).toBe('1.');
    expect(c1.querySelector('.qnum')!.getAttribute('aria-hidden')).toBe('true');
    expect(c1.querySelector('.qtext em')!.textContent).toBe('x');
    expect(text(c1.querySelector('.qchip'))).toBe('Single choice');
    expect(text(c2.querySelector('.qchip'))).toBe('Number');
    expect(c1.getAttribute('aria-labelledby')).toBe(c1.querySelector('.qtext')!.id);
    expect(text(panel().querySelector('.quiz-count'))).toBe('2');
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    expect(panel().querySelector('input[aria-label="Title"]')).toBeNull();
    // WebKit drops the list role under list-style:none; it is restated (Safari/VoiceOver).
    expect(panel().querySelector('ol.quiz-list')!.getAttribute('role')).toBe('list');
  });

  it('the explanation panel shows only when explanation_md has text', async () => {
    const s = new QuizServer([
      q({ id: 1, explanation_md: 'Because', explanation_html: '<p>Because</p>' }),
      q({ id: 2, explanation_md: '   ', explanation_html: '' }),
    ]);
    await renderQuiz(s);
    const [c1, c2] = cards();
    expect(text(c1.querySelector('.qexpl'))).toContain('Because');
    expect(c2.querySelector('.qexpl')).toBeNull();
  });

  it('choice hints wait for the answers, then name the problem', async () => {
    const s = new QuizServer(
      [q({ id: 1 }), q({ id: 2 }), q({ id: 3, type: 'multiple_choice' }), q({ id: 4 }), q({ id: 5 })],
      [opt(21, 2, 'A', true), opt(31, 3, 'A'), opt(32, 3, 'B'),
        opt(41, 4, 'A', true), opt(42, 4, 'B', true), opt(51, 5, 'A', true), opt(52, 5, 'B')],
    );
    const hold = s.hold('GET', /\/questions\/1\/options$/);
    await renderQuiz(s);
    const hints = (i: number) => [...cards()[i].querySelectorAll('.qhint')].map((h) => h.textContent);
    expect(hints(0)).toEqual([]);
    hold.release();
    await settle();
    expect(hints(0)).toEqual(['No answers yet']);
    expect(hints(1)).toEqual(['Add at least 2 answers']);
    expect(hints(2)).toEqual(['No correct answer']);
    expect(hints(3)).toEqual(['More than one correct']);
    expect(hints(4)).toEqual([]);
  });

  it('Number: "Decimals not set" hint and every display form', async () => {
    const s = new QuizServer([
      q({ id: 1, type: 'numeric_answer', correct_numeric: 5, precision: 2 }),
      q({ id: 2, type: 'numeric_answer', correct_numeric: 3, precision: 0 }),
      q({ id: 3, type: 'numeric_answer', correct_numeric: 0.5, precision: 1 }),
      q({ id: 4, type: 'numeric_answer', correct_numeric: 1e-7, precision: 6 }),
      q({ id: 5, type: 'numeric_answer', correct_numeric: 5, precision: null }),
      q({ id: 6, type: 'numeric_answer', correct_numeric: null, precision: 2 }),
    ]);
    await renderQuiz(s);
    const line = (i: number) => text(cards()[i].querySelector('p.key-line'));
    expect(line(0)).toBe('Answer 5 · 2 decimals (± 0.005)');
    expect(line(1)).toBe('Answer 3 · 0 decimals (± 0.5)');
    expect(line(2)).toBe('Answer 0.5 · 1 decimal (± 0.05)');
    expect(line(3)).toBe('Answer 0.0000001 · 6 decimals (± 0.0000005)');
    expect(line(4)).toBe('Answer 5 · decimals not set');
    expect(line(5)).toBe('Answer not set');
    expect([...cards()[4].querySelectorAll('.qhint')].map((h) => h.textContent)).toEqual(['Decimals not set']);
  });

  it('Text: the answer, or "Answer not set"', async () => {
    const s = new QuizServer([
      q({ id: 1, type: 'text_answer', correct_text: 'unit vector' }),
      q({ id: 2, type: 'text_answer', correct_text: null }),
    ]);
    await renderQuiz(s);
    expect(text(cards()[0].querySelector('p.key-line'))).toBe('Answer unit vector');
    expect(text(cards()[1].querySelector('p.key-line'))).toBe('Answer not set');
  });

  it('answer rows: text, and a "correct" tag on the correct one', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'Eleven', true), opt(12, 1, 'Twelve')]);
    await renderQuiz(s);
    const [r1, r2] = rows(cards()[0]);
    expect(text(r1.querySelector('.ans-text'))).toBe('Edit answer Eleven');   // the hidden prefix + the answer (T5)
    expect(r1.classList.contains('ok')).toBe(true);
    expect(text(r1.querySelector('.ans-ok'))).toBe('correct');
    expect(r2.querySelector('.ans-ok')).toBeNull();
  });

  it('links in question text and explanations open in a new tab', async () => {
    const s = new QuizServer([q({
      id: 1, text_html: '<p><a href="https://a.test" rel="noopener noreferrer">a</a></p>',
      explanation_md: 'see', explanation_html: '<p><a href="https://b.test" rel="noopener noreferrer">b</a></p>',
    })]);
    await renderQuiz(s);
    const links = [...cards()[0].querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank']);
  });

  it('question list: a skeleton, then "Couldn\'t load the questions" + Retry, which loads', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('GET', /\/items\/7\/questions$/);
    await renderQuiz(s);
    expect(panel().querySelector('.skeleton')).not.toBeNull();
    expect(panel().querySelector('[data-testid="quiz-live"]')).not.toBeNull();
    hold.fail(500, 'Boom');
    await settle();
    expect(text(panel().querySelector('.quiz-error'))).toContain("Couldn't load the questions");
    expect(panel().querySelector('[data-testid="quiz-live"]')).not.toBeNull();
    // The focused Retry unmounts while it reloads, so focus would drop to <body>.
    const r = byName(panel(), 'Retry')!;
    r.focus();
    expect(document.activeElement).toBe(r);
    r.click();
    await settle();
    expect(cards().length).toBe(1);
    // Focus never drops to <body>: the fallback is the card's ✎ (T7).
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('a card\'s answers: "Loading answers…", then "Couldn\'t load answers" + Retry', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true)]);
    const hold = s.hold('GET', /\/questions\/1\/options$/);
    await renderQuiz(s);
    expect(text(cards()[0].querySelector('.ans-note'))).toBe('Loading answers…');
    hold.fail(500, 'Boom');
    await settle();
    expect(text(cards()[0].querySelector('.ans-note'))).toContain("Couldn't load answers");
    const r = byName(cards()[0], 'Retry')!;
    r.focus();
    expect(document.activeElement).toBe(r);
    r.click();
    await settle();
    expect(rows(cards()[0]).length).toBe(1);
    expect(cards()[0].querySelector('ul.ans-list')!.getAttribute('role')).toBe('list');
    // Focus never drops to <body>: the fallback is the card's ✎ (T7).
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('a list Retry that fails again focuses the new Retry', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.failNext('GET', /\/items\/7\/questions$/, 500, 'Boom');
    await renderQuiz(s);
    s.failNext('GET', /\/items\/7\/questions$/, 500, 'Boom');
    const r = byName(panel(), 'Retry')!;
    r.focus();
    r.click();
    await settle();
    expect(document.activeElement).toBe(byName(panel(), 'Retry'));
  });

  it('a card Retry that fails again focuses the card\'s new Retry', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true)]);
    s.failNext('GET', /\/questions\/1\/options$/, 500, 'Boom');
    await renderQuiz(s);
    s.failNext('GET', /\/questions\/1\/options$/, 500, 'Boom');
    const r = byName(cards()[0], 'Retry')!;
    r.focus();
    r.click();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Retry'));
  });

  it('a Retry never takes focus back from a control the author moved to', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true)]);
    s.failNext('GET', /\/questions\/1\/options$/, 500, 'Boom');
    await renderQuiz(s);
    const hold = s.hold('GET', /\/questions\/1\/options$/);
    const r = byName(cards()[0], 'Retry')!;
    r.focus();
    r.click();
    await settle();
    const trash = panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Delete item"]')!;
    expect(trash.disabled).toBe(false);
    trash.focus();
    hold.release();
    await settle();
    expect(rows(cards()[0]).length).toBe(1);
    expect(document.activeElement).toBe(trash);
  });

  it('an empty quiz says so', async () => {
    await renderQuiz(new QuizServer([]));
    expect(text(panel().querySelector('.quiz-empty'))).toBe('No questions yet.');
    expect(live()).toBe('');
  });

  it('disabled: plain Markdown source under the note, and no /render call', async () => {
    const s = new QuizServer([q({ id: 1, text_md: 'What is $x$?', explanation_md: '**why**', explanation_html: '<p><b>why</b></p>' })]);
    await renderQuiz(s, { version: { is_disabled: true } });
    expect(text(panel().querySelector('.ro-note'))).toBe(
      'Preview is unavailable while this version is disabled — enable it to preview or edit.');
    const c = cards()[0];
    expect(c.querySelector('.qtext')).toBeNull();
    expect([...c.querySelectorAll('pre.qsrc')].map((p) => p.textContent)).toEqual(['What is $x$?', '**why**']);
    expect(c.getAttribute('aria-labelledby')).toBe(c.querySelector('pre.qsrc')!.id);
    expect(s.calls.filter((x) => x.path.endsWith('/render')).length).toBe(0);
  });
});
