import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, opt, renderQuiz, cleanup, settle, panel, topPanel, cards, rows, byName, typeInto, press, live,
  toastTexts, text, mkVersion,
} from './support/quizHarness.svelte';
import { DISCARD_PROMPT, FORBIDDEN_TITLE, WAIT_TITLE } from '../lib/quizEdits.svelte';
import { versionPermissions } from '../lib/versionPermissions';

afterEach(cleanup);

const addQ = () => byName(panel(), '+ Add question')!;
const area = () => topPanel().querySelector<HTMLTextAreaElement>('textarea')!;
const footBtn = (label: string) =>
  [...topPanel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => text(b) === label)!;
const posts = (s: QuizServer) => s.writes().filter((c) => c.method === 'POST' && c.path === '/api/items/7/questions');
const isL3Open = () => document.querySelectorAll('section.modal-panel').length === 2;
const radio = (label: string) =>
  [...topPanel().querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => text(r.closest('label')) === label)!;

describe('Adding a question (5d T8)', () => {
  it('"+ Add question" waits for the list; it is absent when the version forbids structure', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('GET', /\/items\/7\/questions$/);
    await renderQuiz(s);
    expect(addQ().disabled).toBe(true);
    hold.release();
    await settle();
    expect(addQ().disabled).toBe(false);
    cleanup();
    await renderQuiz(new QuizServer([q({ id: 1 })]), { version: { state: 'published' } });
    expect(byName(panel(), '+ Add question')).toBeUndefined();
  });

  it('opens New question directly with focus on the checked type; a type change alone is not a change', async () => {
    const s = new QuizServer([]);
    const r = await renderQuiz(s);
    addQ().click();
    await settle();
    expect(text(topPanel().querySelector('h2'))).toBe('New question');
    expect(document.activeElement).toBe(radio('Single choice'));
    radio('Number').click();
    await settle();
    expect(r.anyDirty()).toBe('false');
    expect(topPanel().querySelector('input[aria-label="Decimals"]')).not.toBeNull();
    const ask = vi.spyOn(window, 'confirm');
    footBtn('Cancel').click();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(isL3Open()).toBe(false);
    expect(posts(s)).toEqual([]);
    expect(document.activeElement).toBe(addQ());
  });

  it('typed text is unsaved work; Cancel asks first', async () => {
    const r = await renderQuiz(new QuizServer([]));
    addQ().click();
    await settle();
    typeInto(area(), 'Draft');
    expect(r.anyDirty()).toBe('true');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    footBtn('Cancel').click();
    await settle();
    expect(ask).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(isL3Open()).toBe(true);
  });

  it('choice: one create; the card is added at the end; its "+ Add answer" row opens with focus', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true), opt(12, 1, 'B')]);
    await renderQuiz(s);
    const trees = () => s.calls.filter((c) => c.path.endsWith('/admin-tree')).length;
    const before = trees();
    addQ().click();
    await settle();
    expect(footBtn('Add question').disabled).toBe(true);
    typeInto(area(), 'Pick one');
    footBtn('Add question').click();
    await settle();
    await settle();
    expect(posts(s).map((c) => c.body)).toEqual([{ text_md: 'Pick one', type: 'single_choice' }]);
    expect(isL3Open()).toBe(false);
    expect(cards().length).toBe(2);
    expect(trees()).toBe(before + 1);
    expect(document.activeElement).toBe(cards()[1].querySelector('.ans-add input'));
  });

  it('choice whose answers fail to load: focus goes to the new card\'s pencil', async () => {
    const s = new QuizServer([]);
    s.failNext('GET', /\/questions\/1000\/options$/, 500, 'Boom');
    await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'Pick one');
    footBtn('Add question').click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('Number: valid only with a number and decimals; one create with both; focus on the new card\'s pencil', async () => {
    const s = new QuizServer([]);
    await renderQuiz(s);
    addQ().click();
    await settle();
    radio('Number').click();
    await settle();
    typeInto(area(), 'How much?');
    expect(footBtn('Add question').disabled).toBe(true);
    typeInto(topPanel().querySelector<HTMLInputElement>('input[aria-label="Answer"]')!, '2.5');
    typeInto(topPanel().querySelector<HTMLInputElement>('input[aria-label="Decimals"]')!, '1');
    footBtn('Add question').click();
    await settle();
    expect(posts(s).map((c) => c.body)).toEqual([{ text_md: 'How much?', type: 'numeric_answer', correct_numeric: 2.5, precision: 1 }]);
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('Text: one create with the answer', async () => {
    const s = new QuizServer([]);
    await renderQuiz(s);
    addQ().click();
    await settle();
    radio('Text').click();
    await settle();
    typeInto(area(), 'Name it');
    typeInto(topPanel().querySelector<HTMLInputElement>('input[aria-label="Answer"]')!, ' vector ');
    footBtn('Add question').click();
    await settle();
    expect(posts(s).map((c) => c.body)).toEqual([{ text_md: 'Name it', type: 'text_answer', correct_text: 'vector' }]);
  });

  it('fields the chosen type hides are not unsaved work', async () => {
    const r = await renderQuiz(new QuizServer([]));
    addQ().click();
    await settle();
    radio('Number').click();
    await settle();
    typeInto(topPanel().querySelector<HTMLInputElement>('input[aria-label="Answer"]')!, '5');
    expect(r.anyDirty()).toBe('true');
    radio('Single choice').click();
    await settle();
    expect(r.anyDirty()).toBe('false');
    const ask = vi.spyOn(window, 'confirm');
    footBtn('Cancel').click();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(isL3Open()).toBe(false);
  });

  it('Number errors are linked to their own fields', async () => {
    await renderQuiz(new QuizServer([]));
    addQ().click();
    await settle();
    radio('Number').click();
    await settle();
    const ans = topPanel().querySelector<HTMLInputElement>('input[aria-label="Answer"]')!;
    const dec = topPanel().querySelector<HTMLInputElement>('input[aria-label="Decimals"]')!;
    typeInto(ans, 'abc');
    typeInto(dec, 'x');
    await settle();
    const said = (el: HTMLInputElement) => text(document.getElementById(el.getAttribute('aria-describedby') ?? ''));
    expect(said(ans)).not.toBeNull();
    expect(said(ans)).not.toBe('');
    expect(said(dec)).toBe('Decimals must be a whole number from 0 to 10.');
    expect(said(ans)).not.toBe(said(dec));
  });

  it('a slow answer load for a new choice question does not interrupt work the author moved on to', async () => {
    const s = new QuizServer([q({ id: 1, type: 'numeric_answer', correct_numeric: 5, precision: 0 })]);
    const hold = s.hold('GET', /\/questions\/1000\/options$/);
    await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'Pick one');
    footBtn('Add question').click();
    await settle();
    await settle();
    byName(cards()[0], 'Edit the answer to question 1')!.click();
    await settle();
    const f = cards()[0].querySelector<HTMLInputElement>('input[aria-label="Answer"]')!;
    typeInto(f, '9');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    hold.release();
    await settle();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(cards()[0].querySelector<HTMLInputElement>('input[aria-label="Answer"]')?.value).toBe('9');
    expect(cards()[1].querySelector('.ans-add input')).toBeNull();
    expect(document.activeElement).toBe(f);
  });

  it('a failed create keeps the modal open with the error inside', async () => {
    const s = new QuizServer([]);
    s.failNext('POST', /\/items\/7\/questions$/, 409, 'Version is not editable');
    await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'Q');
    footBtn('Add question').click();
    await settle();
    expect(isL3Open()).toBe(true);
    expect(text(topPanel().querySelector('.nq-err'))).toBe('Version is not editable');
  });

  it('R10: a 409 on a focused Add question keeps the modal open, the text and error, and focus inside it', async () => {
    const s = new QuizServer([]);
    s.failNext('POST', /\/items\/7\/questions$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'Late');
    const add = footBtn('Add question');
    add.focus();
    add.click();
    await settle();
    const published = mkVersion({ state: 'published' });
    r.props.modal.version = published;
    r.props.modal.perms = versionPermissions(published);
    await settle();
    expect(isL3Open()).toBe(true);
    expect(area().value).toBe('Late');
    expect(text(topPanel().querySelector('.nq-err'))).toBe('Version is not editable');
    expect(footBtn('Add question').disabled).toBe(true);
    expect(footBtn('Add question').title).toBe(FORBIDDEN_TITLE);
    expect(document.activeElement).toBe(area());     // never left on the disabled button
  });

  it('⌘S in New question creates once and never reaches the item modal', async () => {
    const s = new QuizServer([]);
    await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'Quick');
    const e = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    const pd = vi.spyOn(e, 'preventDefault');
    area().dispatchEvent(e);
    await settle();
    expect(pd).toHaveBeenCalledTimes(1);
    expect(posts(s).map((c) => c.body)).toEqual([{ text_md: 'Quick', type: 'single_choice' }]);
  });

  it('a stale create success after the page left the version unlocks the modal and announces nothing', async () => {
    const s = new QuizServer([]);
    const hold = s.hold('POST', /\/items\/7\/questions$/);
    const r = await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'New');
    footBtn('Add question').click();
    await settle();
    (r.props.modal as { stillOnVid: () => boolean }).stillOnVid = () => false;
    hold.release();
    await settle();
    expect(live()).not.toBe('Saved');
    expect(footBtn('Cancel').disabled).toBe(false);
  });
});

describe('Moving and deleting questions (5d T8)', () => {
  const two = () => new QuizServer([q({ id: 1 }), q({ id: 2 })], [opt(11, 1, 'A', true), opt(21, 2, 'B', true)]);

  it('move down: optimistic, announced, one reorder, focus on the other arrow at the end', async () => {
    const s = two();
    await renderQuiz(s);
    byName(cards()[0], 'Move question 1 down')!.click();
    await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['2', '1']);
    expect(live()).toBe('Question moved to position 2 of 2');
    expect(s.writes().map((c) => c.body)).toEqual([{ order: [{ id: 2, order: 1 }, { id: 1, order: 2 }] }]);
    expect(document.activeElement).toBe(byName(cards()[1], 'Move question 2 up'));
  });

  it('a failed move toasts and reloads the list', async () => {
    const s = two();
    s.failNext('POST', /\/questions\/reorder$/, 500, 'Nope');
    await renderQuiz(s);
    byName(cards()[0], 'Move question 1 down')!.click();
    await settle();
    expect(toastTexts()).toEqual(['Nope']);
    expect(cards().map((c) => c.dataset.qId)).toEqual(['1', '2']);
  });

  it('a failed move keeps focus on the moved card\'s arrows (both directions)', async () => {
    for (const [label, after] of [['Move question 2 up', 'Move question 2 up'], ['Move question 1 down', 'Move question 1 down']] as const) {
      const s = two();
      s.failNext('POST', /\/questions\/reorder$/, 500, 'Nope');
      await renderQuiz(s);
      const card = cards()[label.includes(' 2 ') ? 1 : 0];
      const b = byName(card, label)!;
      b.focus();
      b.click();
      for (let i = 0; i < 3; i++) await settle();
      expect(cards().map((c) => c.dataset.qId)).toEqual(['1', '2']);
      const want = byName(cards()[label.includes(' 2 ') ? 1 : 0], after)!;
      expect([label, document.activeElement]).toEqual([label, want]);
      expect(want.disabled).toBe(false);
      cleanup();
    }
  });

  it('a delete of a question already deleted elsewhere (404) moves focus to the next card', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 }), q({ id: 3 })]);
    s.failNext('DELETE', /\/api\/questions\/2$/, 404, 'Question not found');
    await renderQuiz(s);
    s.questions = s.questions.filter((x) => x.id !== 2);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const b = byName(cards()[1], 'Delete question 2')!;
    b.focus();
    b.click();
    for (let i = 0; i < 3; i++) await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['1', '3']);
    expect(toastTexts()).toEqual(['Question not found']);
    expect(document.activeElement).toBe(byName(cards()[1], 'Edit question 2'));
  });

  it('delete confirms; focus goes to the next card, then the previous, then + Add question', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 }), q({ id: 3 })]);
    await renderQuiz(s);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    expect(ask).toHaveBeenCalledWith('Delete question "Q2"? This cannot be undone.');
    expect(cards().length).toBe(3);
    ask.mockReturnValue(true);
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['1', '3']);
    expect(document.activeElement).toBe(byName(cards()[1], 'Edit question 2'));
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    expect(document.activeElement).toBe(addQ());
  });

  it('the per-quiz lock: during a move, other structure controls wait; the moving card\'s arrows do not', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 }), q({ id: 3 })]);
    const hold = s.hold('POST', /\/questions\/reorder$/);
    await renderQuiz(s);
    byName(cards()[1], 'Move question 2 down')!.click();
    await settle();
    const moved = cards()[2];
    expect(byName(moved, 'Move question 3 up')!.disabled).toBe(false);
    const other = cards()[0];
    for (const b of [byName(other, 'Move question 1 down')!, byName(other, 'Delete question 1')!, addQ()]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(WAIT_TITLE);
    }
    byName(moved, 'Move question 3 up')!.click();
    hold.release();
    await settle();
    expect(s.writes().length).toBe(1);
  });

  it('the per-question lock: an answer write disables that question\'s move and delete', async () => {
    const s = two();
    const hold = s.hold('PATCH', /\/api\/options\/11$/);
    await renderQuiz(s);
    rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!.click();
    await settle();
    typeInto(cards()[0].querySelector<HTMLInputElement>('input.inline-input')!, 'A2');
    press(cards()[0].querySelector('input.inline-input')!, 'Enter');
    await settle();
    expect(byName(cards()[0], 'Move question 1 down')!.disabled).toBe(true);
    expect(byName(cards()[0], 'Delete question 1')!.title).toBe(WAIT_TITLE);
    expect(byName(cards()[1], 'Move question 2 up')!.disabled).toBe(false);
    hold.release();
    await settle();
  });

  it('D10: deleting the question that holds a changed edit asks the discard prompt first', async () => {
    const s = two();
    await renderQuiz(s);
    rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!.click();
    await settle();
    typeInto(cards()[0].querySelector<HTMLInputElement>('input.inline-input')!, 'changed');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    expect(ask.mock.calls.map((c) => c[0])).toEqual([DISCARD_PROMPT]);
    expect(s.writes()).toEqual([]);
  });

  it('structure controls are absent when published, archived and disabled', async () => {
    for (const v of [{ state: 'published' as const }, { state: 'archived' as const }, { is_disabled: true }]) {
      await renderQuiz(two(), { version: v });
      expect(byName(cards()[0], 'Move question 1 down')).toBeUndefined();
      expect(byName(cards()[0], 'Delete question 1')).toBeUndefined();
      expect(byName(panel(), '+ Add question')).toBeUndefined();
      cleanup();
    }
  });
});

describe('Unsaved work across edit kinds (5d T8)', () => {
  it('each edit kind reports unsaved work only when changed; a page discard closes it', async () => {
    const s = new QuizServer(
      [q({ id: 1 }), q({ id: 2, type: 'numeric_answer', correct_numeric: 5, precision: 0 }),
       q({ id: 3, type: 'text_answer', correct_text: 'v' })],
      [opt(11, 1, 'A', true)],
    );
    const r = await renderQuiz(s);
    const field = () => panel().querySelector<HTMLInputElement>('input.inline-input, input[aria-label="Answer"]')!;
    const openers: [string, () => HTMLButtonElement][] = [
      ['answer text', () => rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!],
      ['add answer', () => cards()[0].querySelector<HTMLButtonElement>('button.ans-add-btn')!],
      ['Number', () => byName(cards()[1], 'Edit the answer to question 2')!],
      ['Text', () => byName(cards()[2], 'Edit the answer to question 3')!],
    ];
    for (const [kind, opener] of openers) {
      opener().click();
      await settle();
      expect([kind, r.anyDirty()]).toEqual([kind, 'false']);
      typeInto(field(), `${kind} changed`);
      expect([kind, r.anyDirty()]).toEqual([kind, 'true']);
      r.registry().discardAll();
      await settle();
      expect([kind, r.anyDirty(), panel().querySelector('input.inline-input, input[aria-label="Answer"]')])
        .toEqual([kind, 'false', null]);
    }
    addQ().click();
    await settle();
    typeInto(area(), 'Draft');
    expect(r.anyDirty()).toBe('true');
    r.registry().discardAll();
    await settle();
    expect(isL3Open()).toBe(false);
    expect(s.writes()).toEqual([]);
  });
});

describe('403/409 and the focus fallback (5d T8)', () => {
  it('a 409 on save keeps the field open with its text and reloads the tree; it survives the permission flip', async () => {
    const s = new QuizServer([q({ id: 1, type: 'text_answer', correct_text: 'old' })]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    const trees = () => s.calls.filter((c) => c.path.endsWith('/admin-tree')).length;
    const before = trees();
    byName(cards()[0], 'Edit the answer to question 1')!.click();
    await settle();
    const f = () => cards()[0].querySelector<HTMLInputElement>('input[aria-label="Answer"]')!;
    typeInto(f(), 'new');
    press(f(), 'Enter');
    await settle();
    expect(trees()).toBe(before + 1);
    expect(f().value).toBe('new');
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Version is not editable');
    // The reloaded tree says archived: controls the state forbids disappear, the open field stays.
    const archived = mkVersion({ state: 'archived' });
    r.props.modal.version = archived;
    r.props.modal.perms = versionPermissions(archived);
    await settle();
    expect(byName(cards()[0], 'Edit question 1')).toBeUndefined();
    expect(f().value).toBe('new');
    // R10: the field can now only be cancelled — ✓ is disabled and Enter sends nothing.
    const sent = s.writes().length;
    expect(byName(cards()[0], FORBIDDEN_TITLE)!.disabled).toBe(true);
    press(f(), 'Enter');
    await settle();
    expect(s.writes().length).toBe(sent);
    expect(f().value).toBe('new');
    press(f(), 'Escape');
    await settle();
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));
  });

  it('a 409 that removed the focused control moves focus to the card\'s ✎ (R6)', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'Eleven', true), opt(12, 1, 'Twelve')]);
    const hold = s.hold('POST', /\/options\/reorder$/);
    const r = await renderQuiz(s);
    byName(rows(cards()[0])[0], 'Move answer "Eleven" down')!.click();
    await settle();
    // Eleven is now last, so its "down" is disabled and focus sits on its "up".
    expect(document.activeElement).toBe(byName(rows(cards()[0])[1], 'Move answer "Eleven" up'));
    // The reload says published: the arrows go (D13), and focus with them.
    const published = mkVersion({ state: 'published' });
    r.props.modal.version = published;
    r.props.modal.perms = versionPermissions(published);
    hold.fail(409, 'Version is not editable');
    for (let i = 0; i < 3; i++) await settle();   // reject → tree reload → tick → fallback
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
    expect(toastTexts()).toEqual(['Version is not editable']);
  });

  it('a failed write\'s re-fetch is skipped when its question is gone', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 })], [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(21, 2, 'C', true)]);
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    s.failNext('POST', /\/questions\/reorder$/, 500, 'Nope');
    await renderQuiz(s);
    rows(cards()[0])[1].querySelector<HTMLButtonElement>('button.ans-mark')!.click();
    await settle();
    // Question 1 is deleted elsewhere; a failed move re-syncs the list without it.
    s.questions = s.questions.filter((x) => x.id !== 1);
    byName(cards()[1], 'Move question 2 up')!.click();
    await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['2']);
    const gets = () => s.calls.filter((c) => c.method === 'GET' && c.path === '/api/questions/1/options').length;
    const before = gets();
    hold.fail(404, 'Option not found');
    await settle();
    expect(gets()).toBe(before);
    expect(toastTexts()).toEqual(['Nope', 'Option not found']);
  });
});
