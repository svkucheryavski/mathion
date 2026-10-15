import { describe, it, expect, afterEach } from 'vitest';
import {
  QuizServer, q, opt, mkVersion, renderQuiz, cleanup, settle, panel, cards, rows, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';
import { KEY_CONFIRM, DISCARD_PROMPT, WAIT_TITLE, FORBIDDEN_TITLE } from '../lib/quizEdits.svelte';
import { versionPermissions } from '../lib/versionPermissions';

afterEach(cleanup);

const marker = (r: HTMLElement) => r.querySelector<HTMLButtonElement>('button.ans-mark')!;
const textBtn = (r: HTMLElement) => r.querySelector<HTMLButtonElement>('button.ans-edit')!;
const field = (root: ParentNode) => root.querySelector<HTMLInputElement>('input.inline-input')!;
const marks = () => rows(cards()[0]).map((r) => r.classList.contains('ok'));
const optWrites = (s: QuizServer) => s.writes().filter((c) => /\/options/.test(c.path));
const single = () => new QuizServer([q({ id: 1 })], [opt(11, 1, 'Eleven', true), opt(12, 1, 'Twelve'), opt(13, 1, 'Thirteen')]);
// A question drawn in place (Polish 1): at an answer field (#14), or under the list (#2).
const rowAsk = (card: HTMLElement) => card.querySelector<HTMLElement>('.inline-row .inline-confirm');
const keyLine = (card: HTMLElement) => card.querySelector<HTMLElement>('.ans-ask .inline-confirm');
const btnOf = (ask: HTMLElement | null, k: 'confirm' | 'cancel') => ask!.querySelector<HTMLButtonElement>(`button.${k}`)!;

describe('Choice answers — the marker (5d T5)', () => {
  it('is a button: aria-pressed, name Mark "…" correct; arrow keys change nothing', async () => {
    const s = single();
    await renderQuiz(s);
    const [r1, r2] = rows(cards()[0]);
    expect(marker(r1).getAttribute('aria-pressed')).toBe('true');
    expect(marker(r2).getAttribute('aria-pressed')).toBe('false');
    expect(marker(r1).getAttribute('aria-label')).toBe('Mark "Eleven" correct');
    press(marker(r2), 'ArrowDown');
    press(marker(r2), 'ArrowUp');
    await settle();
    expect(optWrites(s)).toEqual([]);
  });

  it('single choice: one PATCH, then the others clear locally; focus stays on the marker', async () => {
    const s = single();
    await renderQuiz(s);
    const r2 = rows(cards()[0])[1];
    marker(r2).focus();
    marker(r2).click();
    await settle();
    expect(optWrites(s).map((c) => [c.method, c.path, c.body])).toEqual([['PATCH', '/api/options/12', { is_correct: true }]]);
    expect(marks()).toEqual([false, true, false]);
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });

  it('single choice: clicking the one correct answer does nothing', async () => {
    const s = single();
    await renderQuiz(s);
    marker(rows(cards()[0])[0]).click();
    await settle();
    expect(optWrites(s)).toEqual([]);
  });

  it('old two-correct data: clicking a correct answer sends the PATCH and leaves only it', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true), opt(12, 1, 'B', true)]);
    await renderQuiz(s);
    expect(text(cards()[0].querySelector('.qhint'))).toBe('More than one correct');
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ is_correct: true }]);
    expect(marks()).toEqual([false, true]);
    expect(cards()[0].querySelector('.qhint')).toBeNull();
  });

  it('multiple choice toggles; the last correct marker is disabled with its reason', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })], [opt(11, 1, 'A', true), opt(12, 1, 'B')]);
    await renderQuiz(s);
    const m1 = marker(rows(cards()[0])[0]);
    expect(m1.disabled).toBe(true);
    expect(m1.title).toBe('At least one answer must stay correct');
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(marks()).toEqual([true, true]);
    expect(marker(rows(cards()[0])[0]).disabled).toBe(false);
    marker(rows(cards()[0])[0]).click();
    await settle();
    expect(marks()).toEqual([false, true]);
  });

  it('a failed marker write toasts and re-fetches the answers', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/12$/, 500, 'Boom');
    await renderQuiz(s);
    const gets = () => s.calls.filter((c) => c.method === 'GET' && c.path === '/api/questions/1/options').length;
    const before = gets();
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(toastTexts()).toEqual(['Boom']);
    expect(gets()).toBe(before + 1);
    expect(marks()).toEqual([true, false, false]);
  });

  it('a 409 also reloads the version tree', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/12$/, 409, 'Version changed');
    await renderQuiz(s);
    const trees = () => s.calls.filter((c) => c.path.endsWith('/admin-tree')).length;
    const before = trees();
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(trees()).toBe(before + 1);
  });

  it('a held marker write locks this question\'s other controls but not itself; a second click sends nothing', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    await renderQuiz(s);
    const [r1, r2, r3] = rows(cards()[0]);
    marker(r2).click();
    await settle();
    expect(marker(r2).disabled).toBe(false);
    marker(r2).click();
    for (const b of [marker(r3), textBtn(r1), byName(r1, 'Move answer "Eleven" down')!, byName(r1, 'Delete answer "Eleven"')!]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(WAIT_TITLE);
    }
    hold.release();
    await settle();
    expect(optWrites(s).length).toBe(1);
    expect(marker(rows(cards()[0])[2]).disabled).toBe(false);
  });

  it('a stale echo after the page left the version is not written back', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    const r = await renderQuiz(s);
    marker(rows(cards()[0])[1]).click();
    await settle();
    (r.props.modal as { stillOnVid: () => boolean }).stillOnVid = () => false;   // the page moved to another version
    hold.release();
    await settle();
    expect(marks()).toEqual([true, false, false]);
    expect(live()).not.toBe('Saved');
    expect(toastTexts()).toEqual([]);
  });

  it('a stale echo after the modal closed writes nothing and throws nothing', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    const r = await renderQuiz(s);
    marker(rows(cards()[0])[1]).click();
    await settle();
    r.closeModal();
    hold.release();
    await settle();
    expect(toastTexts()).toEqual([]);
  });
});

describe('Choice answers — inline text (5d T5)', () => {
  it('the text button names the full answer with a hidden "Edit answer" prefix', async () => {
    const long = 'x'.repeat(45);
    await renderQuiz(new QuizServer([q({ id: 1 })], [opt(11, 1, long, true)]));
    const r1 = rows(cards()[0])[0];
    expect(text(textBtn(r1))).toBe(`Edit answer ${long}`);
    expect(text(textBtn(r1).querySelector('.sr-only'))).toBe('Edit answer');
    expect(marker(r1).getAttribute('aria-label')).toBe(`Mark "${'x'.repeat(40)}…" correct`);
    expect(byName(r1, `Delete answer "${'x'.repeat(40)}…"`)).toBeDefined();
  });

  it('Enter saves only the text; focus returns to the text button; "Saved" is announced', async () => {
    const s = single();
    await renderQuiz(s);
    textBtn(rows(cards()[0])[1]).click();
    await settle();
    const f = field(rows(cards()[0])[1]);
    expect(f.value).toBe('Twelve');
    expect(document.activeElement).toBe(f);
    typeInto(f, ' Twelve! ');
    press(f, 'Enter');
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ text: 'Twelve!' }]);
    expect(text(rows(cards()[0])[1].querySelector('.ans-edit'))).toBe('Edit answer Twelve!');
    expect(marks()).toEqual([true, false, false]);
    expect(document.activeElement).toBe(textBtn(rows(cards()[0])[1]));
    expect(live()).toBe('Saved');
  });

  it('unchanged closes silently; Esc cancels inside the modal; empty shows an error', async () => {
    const s = single();
    const r = await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(field(cards()[0])).toBeNull();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'zzz');
    expect(press(field(cards()[0]), 'Escape').defaultPrevented).toBe(true);
    await settle();
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(field(cards()[0])).toBeNull();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), '  ');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Enter the answer text');
    expect(optWrites(s)).toEqual([]);
  });

  it('a failed save keeps the field with its text and error, and re-fetches the answers', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/11$/, 422, 'Too long');
    await renderQuiz(s);
    const gets = () => s.calls.filter((c) => c.method === 'GET' && c.path === '/api/questions/1/options').length;
    const before = gets();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'New');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(field(cards()[0]).value).toBe('New');
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Too long');
    expect(gets()).toBe(before + 1);
    expect(toastTexts()).toEqual([]);
  });

  it('saving an answer another author deleted: the field goes, focus falls back, the next edit opens', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/12$/, 404, 'Option not found');
    await renderQuiz(s);
    textBtn(rows(cards()[0])[1]).click();
    await settle();
    s.options = s.options.filter((o) => o.id !== 12);
    typeInto(field(cards()[0]), 'Gone');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['11', '13']);
    expect(field(cards()[0])).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(panel().contains(document.activeElement)).toBe(true);
    textBtn(rows(cards()[0])[1]).click();
    await settle();
    expect(field(rows(cards()[0])[1]).value).toBe('Thirteen');
  });

  it('a saving answer field blocks the other edit controls; Esc does nothing; double Enter sends once', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2, explanation_md: 'e', explanation_html: '<p>e</p>' })],
      [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(21, 2, 'C', true)]);
    const hold = s.hold('PATCH', /\/api\/options\/11$/);
    const r = await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'A2');
    press(field(cards()[0]), 'Enter');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(field(cards()[0]).readOnly).toBe(true);
    expect(press(field(cards()[0]), 'Escape').defaultPrevented).toBe(true);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    const c2 = cards()[1];
    for (const b of [marker(rows(c2)[0]), textBtn(rows(c2)[0]), byName(c2, 'Add answer to question 2')!, byName(panel(), 'Edit title')!]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(WAIT_TITLE);
    }
    hold.release();
    await settle();
    expect(optWrites(s).length).toBe(1);
    expect(marker(rows(cards()[1])[0]).disabled).toBe(false);
  });

  it('#14: a changed field asks at itself, in place of ✓ and ✕; Cancel keeps it and returns to it; Discard drops it and acts', async () => {
    const s = single();
    await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'changed');
    marker(rows(cards()[0])[1]).click();
    await settle();
    const ask = rowAsk(cards()[0])!;
    expect(text(ask.querySelector('.warning'))).toBe(DISCARD_PROMPT);
    expect(ask.classList.contains('row')).toBe(true);
    expect(btnOf(ask, 'confirm').classList.contains('danger')).toBe(true);
    expect(byName(cards()[0], 'Save answer')).toBeUndefined();
    expect(field(cards()[0]).readOnly).toBe(true);
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    // Enter and Esc in the readonly field only bring the question back.
    field(cards()[0]).focus();
    press(field(cards()[0]), 'Enter');
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    field(cards()[0]).focus();
    press(field(cards()[0]), 'Escape');
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    btnOf(ask, 'cancel').click();
    await settle();
    expect(rowAsk(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(field(cards()[0]));
    expect(field(cards()[0]).value).toBe('changed');
    expect(field(cards()[0]).readOnly).toBe(false);
    expect(optWrites(s)).toEqual([]);
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(rowAsk(cards()[0]), 'confirm').click();
    await settle();
    expect(field(cards()[0])).toBeNull();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ is_correct: true }]);
    // #2 unpublished: the marker takes focus before it acts, never <body>.
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });

  it('D10: an unchanged open field closes silently when another action starts', async () => {
    const s = single();
    await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    textBtn(rows(cards()[0])[1]).click();
    await settle();
    expect(cards()[0].querySelector('.inline-confirm')).toBeNull();
    expect(field(rows(cards()[0])[1]).value).toBe('Twelve');
    expect(rows(cards()[0])[0].querySelector('input')).toBeNull();
  });
});

describe('Choice answers — add, move, delete (5d T5)', () => {
  it('+ Add answer: Enter creates and keeps the row open, empty and focused; Esc closes it', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    byName(cards()[0], 'Add answer to question 1')!.click();
    await settle();
    const f = () => cards()[0].querySelector<HTMLInputElement>('.ans-add input')!;
    typeInto(f(), 'First');
    press(f(), 'Enter');
    await settle();
    typeInto(f(), 'Second');
    press(f(), 'Enter');
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ text: 'First', is_correct: true }, { text: 'Second', is_correct: false }]);
    expect(rows(cards()[0]).map((r) => text(r.querySelector('.ans-edit')))).toEqual(['Edit answer First', 'Edit answer Second']);
    expect(f().value).toBe('');
    expect(document.activeElement).toBe(f());
    press(f(), 'Escape');
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Add answer to question 1'));
  });

  it('multiple choice: the first answer starts not correct', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })]);
    await renderQuiz(s);
    byName(cards()[0], 'Add answer to question 1')!.click();
    await settle();
    const f = cards()[0].querySelector<HTMLInputElement>('.ans-add input')!;
    typeInto(f, 'A');
    press(f, 'Enter');
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ text: 'A', is_correct: false }]);
  });

  it('row actions stay in the tab order, and Shift+Tab from the next marker reaches this row\'s delete', async () => {
    await renderQuiz(single());
    const [, r2, r3] = rows(cards()[0]);   // row 1 is the only correct answer: its delete is disabled
    expect(r2.querySelector('.row-acts')!.querySelectorAll('button').length).toBe(3);
    const focusables = [...panel().querySelectorAll<HTMLElement>('button:not([disabled]), input')];
    expect(focusables[focusables.indexOf(marker(r3)) - 1]).toBe(byName(r2, 'Delete answer "Twelve"'));
  });

  it('moving down: optimistic order, the announcement, one reorder, focus on the same arrow', async () => {
    const s = single();
    await renderQuiz(s);
    byName(rows(cards()[0])[0], 'Move answer "Eleven" down')!.click();
    await settle();
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['12', '11', '13']);
    expect(live()).toBe('Answer moved to position 2 of 3');
    expect(optWrites(s).map((c) => c.body)).toEqual([{ order: [{ id: 12, order: 1 }, { id: 11, order: 2 }, { id: 13, order: 3 }] }]);
    expect(document.activeElement).toBe(byName(rows(cards()[0])[1], 'Move answer "Eleven" down'));
  });

  it('moving to the top keeps focus on the other arrow', async () => {
    await renderQuiz(single());
    byName(rows(cards()[0])[1], 'Move answer "Twelve" up')!.click();
    await settle();
    const top = rows(cards()[0])[0];
    expect(byName(top, 'Move answer "Twelve" up')!.disabled).toBe(true);
    expect(document.activeElement).toBe(byName(top, 'Move answer "Twelve" down'));
  });

  it('a failed move toasts and restores the server order', async () => {
    const s = single();
    s.failNext('POST', /\/options\/reorder$/, 500, 'Nope');
    await renderQuiz(s);
    byName(rows(cards()[0])[0], 'Move answer "Eleven" down')!.click();
    await settle();
    expect(toastTexts()).toEqual(['Nope']);
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['11', '12', '13']);
  });

  it('a failed move keeps focus on the moved answer\'s arrow once the server order is back', async () => {
    const s = single();
    s.failNext('POST', /\/options\/reorder$/, 500, 'Nope');
    await renderQuiz(s);
    const up = byName(rows(cards()[0])[1], 'Move answer "Twelve" up')!;
    up.focus();
    up.click();
    await settle();
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['11', '12', '13']);
    // At the top, ↑ was disabled, so focus took ↓; it stays there once the row is back.
    expect(document.activeElement).toBe(byName(rows(cards()[0])[1], 'Move answer "Twelve" down'));
  });

  it('deleting an answer another author already deleted: toast, the row goes, focus falls back', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })], [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(13, 1, 'C')]);
    s.failNext('DELETE', /\/api\/options\/12$/, 404, 'Option not found');
    await renderQuiz(s);
    s.options = s.options.filter((o) => o.id !== 12);
    const del = byName(cards()[0], 'Delete answer "B"')!;
    del.focus();
    del.click();
    await settle();
    expect(toastTexts()).toEqual(['Option not found']);
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['11', '13']);
    expect(document.activeElement).not.toBe(document.body);
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('delete: no confirm; focus goes to the next answer, then the previous, then + Add answer', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })], [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(13, 1, 'C')]);
    await renderQuiz(s);
    byName(cards()[0], 'Delete answer "B"')!.click();
    await settle();
    expect(cards()[0].querySelector('.inline-confirm')).toBeNull();
    expect(document.activeElement).toBe(textBtn(rows(cards()[0])[1]));
    expect(text(document.activeElement)).toBe('Edit answer C');
    byName(cards()[0], 'Delete answer "C"')!.click();
    await settle();
    expect(text(document.activeElement)).toBe('Edit answer A');
    byName(cards()[0], 'Delete answer "A"')!.click();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Add answer to question 1'));
  });

  it('delete while the title saves: the next answer and + Add answer wait, so focus takes the §Focus fallback', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })], [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(13, 1, 'C')]);
    const hold = s.hold('PATCH', /\/api\/items\/7$/);
    await renderQuiz(s);
    byName(panel(), 'Edit title')!.click();
    await settle();
    const title = panel().querySelector<HTMLInputElement>('.title-input')!;
    typeInto(title, 'Slow');
    press(title, 'Enter');
    await settle();
    const del = byName(cards()[0], 'Delete answer "B"')!;
    del.focus();                       // a real click focuses the trash
    del.click();
    await settle();
    expect(textBtn(rows(cards()[0])[1]).disabled).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect(panel().contains(document.activeElement)).toBe(true);
    hold.release();
    await settle();
  });

  it('the only correct answer cannot be deleted, unless it is the only answer', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 }), q({ id: 2 })],
      [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(21, 2, 'Solo', true)]));
    const del = byName(cards()[0], 'Delete answer "A"')!;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe('Mark another answer correct first');
    expect(byName(cards()[1], 'Delete answer "Solo"')!.disabled).toBe(false);
  });
});

describe('Choice answers — version states (5d T5)', () => {
  it('#2 published: the marker asks under the list (R52); Cancel keeps the key; Change key saves; text saves', async () => {
    const s = single();
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    const ask = keyLine(cards()[0])!;
    expect(ask.classList.contains('row')).toBe(false);
    expect(text(ask.querySelector('.warning strong'))).toBe('Change the answer key?');
    expect(text(ask.querySelector('.warning'))).toBe(`Change the answer key? ${KEY_CONFIRM}`);
    expect(text(btnOf(ask, 'confirm'))).toBe('Change key');
    expect(btnOf(ask, 'confirm').classList.contains('primary')).toBe(true);
    expect(document.activeElement).toBe(btnOf(ask, 'cancel'));
    btnOf(ask, 'cancel').click();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
    expect(optWrites(s)).toEqual([]);
    expect(marks()).toEqual([true, false, false]);
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(keyLine(cards()[0]), 'confirm').click();
    await settle();
    expect(marks()).toEqual([false, true, false]);
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
    expect(cards()[0].querySelector('.row-acts')).toBeNull();
    expect(cards()[0].querySelector('.ans-add')).toBeNull();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'Renamed');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(optWrites(s).at(-1)!.body).toEqual({ text: 'Renamed' });
  });

  it('#2: while the key saves the question stays busy with focus on Change key; another marker is refused; then the marker', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(keyLine(cards()[0]), 'confirm').click();
    await settle();
    const ok = btnOf(keyLine(cards()[0]), 'confirm');
    expect(document.activeElement).toBe(ok);
    expect(ok.getAttribute('aria-busy')).toBe('true');
    press(ok, 'Escape');
    expect(keyLine(cards()[0])).not.toBeNull();     // Esc is ignored while busy
    marker(rows(cards()[0])[2]).click();
    await settle();
    expect(document.activeElement).toBe(ok);        // R53: refused quietly while busy
    hold.release();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    expect(optWrites(s).length).toBe(1);
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });

  it('#2 R57: focus moved away during the save stays where the author put it', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    btnOf(keyLine(cards()[0]), 'confirm').click();
    await settle();
    const elsewhere = byName(panel(), 'Edit title')!;
    elsewhere.focus();
    hold.release();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('#2 + #14: a changed field asks first, at itself; on Discard the key question follows under the list; its Cancel sends nothing', async () => {
    const s = single();
    await renderQuiz(s, { version: { state: 'published' } });
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'changed');
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(keyLine(cards()[0])).toBeNull();
    btnOf(rowAsk(cards()[0]), 'confirm').click();
    await settle();
    expect(field(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(btnOf(keyLine(cards()[0]), 'cancel'));
    btnOf(keyLine(cards()[0]), 'cancel').click();
    await settle();
    expect(optWrites(s)).toEqual([]);
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });

  it('#2 R49: the answer it asks about leaves the list (a reload) — the question goes; focus the author moved stays', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/11$/, 422, 'Nope');
    await renderQuiz(s, { version: { state: 'published' } });
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(keyLine(cards()[0])).not.toBeNull();
    s.options = s.options.filter((o) => o.id !== 12);   // deleted elsewhere
    textBtn(rows(cards()[0])[0]).click();               // the author moves on: a text edit
    await settle();
    typeInto(field(cards()[0]), 'Renamed');
    press(field(cards()[0]), 'Enter');                  // fails, so the list reloads without 12
    await settle();
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['11', '13']);
    expect(keyLine(cards()[0])).toBeNull();
    expect(document.activeElement).toBe(field(cards()[0]));
    expect(optWrites(s).filter((c) => /options\/12/.test(c.path))).toEqual([]);
  });

  it('R10: a 409 on ✓ that takes the right away keeps the text and error, moves focus into the field, and Cancel falls back', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/12$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    textBtn(rows(cards()[0])[1]).click();
    await settle();
    typeInto(field(cards()[0]), 'Late');
    const ok = byName(cards()[0], 'Save answer')!;
    ok.focus();
    ok.click();
    await settle();
    // The tree reload re-derives the permissions: the version is archived now.
    const archived = mkVersion({ state: 'archived' });
    r.props.modal.version = archived;
    r.props.modal.perms = versionPermissions(archived);
    await settle();
    expect(field(cards()[0]).value).toBe('Late');
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Version is not editable');
    const forbidden = byName(cards()[0], FORBIDDEN_TITLE)!;
    expect(forbidden.disabled).toBe(true);
    expect(document.activeElement).toBe(field(cards()[0]));   // never left on a disabled ✓
    byName(cards()[0], 'Cancel')!.click();
    await settle();
    expect(field(cards()[0])).toBeNull();
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('archived: a static marker (no button, no aria-pressed), plain text, "correct" in text', async () => {
    await renderQuiz(single(), { version: { state: 'archived' } });
    const r1 = rows(cards()[0])[0];
    expect(r1.querySelector('button')).toBeNull();
    expect(r1.querySelector('span.ans-mark')!.hasAttribute('aria-pressed')).toBe(false);
    expect(text(r1.querySelector('.ans-text'))).toBe('Eleven');
    expect(text(r1.querySelector('.ans-ok'))).toBe('correct');
  });
});
