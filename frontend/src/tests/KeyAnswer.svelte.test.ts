import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, mkVersion, renderQuiz, panel, cleanup, settle, cards, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';
import { KEY_CONFIRM, DISCARD_PROMPT, FORBIDDEN_TITLE, WAIT_TITLE } from '../lib/quizEdits.svelte';
import { versionPermissions } from '../lib/versionPermissions';

afterEach(cleanup);

const num = (over = {}) => q({ id: 1, type: 'numeric_answer', correct_numeric: 5, precision: 2, ...over });
const txt = (over = {}) => q({ id: 2, type: 'text_answer', correct_text: 'unit vector', ...over });
const pencil = (i = 0) => byName(cards()[i], `Edit the answer to question ${i + 1}`)!;
const input = (i: number, label: string) => cards()[i].querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const qWrites = (s: QuizServer) => s.writes().filter((c) => /^\/api\/questions\/\d+$/.test(c.path));
const line = (i = 0) => text(cards()[i].querySelector('p.key-line'));

describe('Number answer (5d T6)', () => {
  it('opens pre-filled; Enter saves value and decimals in one PATCH; focus returns; "Saved"', async () => {
    const s = new QuizServer([num()]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    expect(input(0, 'Answer').value).toBe('5');
    expect(input(0, 'Decimals').value).toBe('2');
    expect(document.activeElement).toBe(input(0, 'Answer'));
    typeInto(input(0, 'Answer'), '4.5');
    typeInto(input(0, 'Decimals'), '1');
    press(input(0, 'Decimals'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_numeric: 4.5, precision: 1 }]);
    expect(line()).toBe('Answer 4.5 · 1 decimal (± 0.05)');
    expect(document.activeElement).toBe(pencil());
    expect(live()).toBe('Saved');
  });

  it('old data opens with an empty value and 0 decimals', async () => {
    await renderQuiz(new QuizServer([num({ correct_numeric: null, precision: null })]));
    pencil().click();
    await settle();
    expect(input(0, 'Answer').value).toBe('');
    expect(input(0, 'Decimals').value).toBe('0');
  });

  it('"5.0" against a stored 5 with the same decimals closes silently', async () => {
    const s = new QuizServer([num()]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), '5.0');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s)).toEqual([]);
    expect(cards()[0].querySelector('.key-edit')).toBeNull();
  });

  it('an unset precision is a change: Enter on the pre-filled 0 sends it', async () => {
    const s = new QuizServer([num({ precision: null })]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_numeric: 5, precision: 0 }]);
  });

  it('invalid input shows its reason and sends nothing; Esc cancels inside the modal', async () => {
    const s = new QuizServer([num()]);
    const r = await renderQuiz(s);
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), 'abc');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(text(cards()[0].querySelector('.key-err'))).toBe('Not a valid number.');
    typeInto(input(0, 'Answer'), '4');
    typeInto(input(0, 'Decimals'), '11');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(text(cards()[0].querySelector('.key-err'))).toBe('Decimals must be a whole number from 0 to 10.');
    expect(qWrites(s)).toEqual([]);
    expect(press(input(0, 'Answer'), 'Escape').defaultPrevented).toBe(true);
    await settle();
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(line()).toBe('Answer 5 · 2 decimals (± 0.005)');
  });

  it('a decimals error marks the Decimals field, not the Answer field', async () => {
    await renderQuiz(new QuizServer([num()]));
    pencil().click();
    await settle();
    typeInto(input(0, 'Decimals'), '11');
    press(input(0, 'Decimals'), 'Enter');
    await settle();
    const err = cards()[0].querySelector('.key-err')!;
    expect(input(0, 'Decimals').getAttribute('aria-invalid')).toBe('true');
    expect(input(0, 'Decimals').getAttribute('aria-describedby')).toBe(err.id);
    expect(input(0, 'Answer').hasAttribute('aria-invalid')).toBe(false);
    expect(input(0, 'Answer').hasAttribute('aria-describedby')).toBe(false);
    typeInto(input(0, 'Answer'), 'abc');
    typeInto(input(0, 'Decimals'), '1');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(input(0, 'Answer').getAttribute('aria-invalid')).toBe('true');
    expect(input(0, 'Decimals').hasAttribute('aria-invalid')).toBe(false);
  });

  it('while the key saves: the fields are read-only, ✕ waits, the other cards\' edit openers wait', async () => {
    const s = new QuizServer([num(), txt()]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    await renderQuiz(s);
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), '6');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(input(0, 'Answer').readOnly).toBe(true);
    expect(byName(cards()[0], 'Cancel')!.disabled).toBe(true);
    expect(pencil(1).disabled).toBe(true);
    expect(pencil(1).title).toBe(WAIT_TITLE);
    hold.release();
    await settle();
    expect(line()).toBe('Answer 6 · 2 decimals (± 0.005)');
    expect(pencil(1).disabled).toBe(false);
  });

  it('a failed save keeps the editor with its values and the error; nothing is re-fetched; no toast', async () => {
    const s = new QuizServer([num()]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 422, 'Out of range');
    await renderQuiz(s);
    const gets = () => s.calls.filter((c) => c.method === 'GET').length;
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), '7');
    const before = gets();
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(input(0, 'Answer').value).toBe('7');
    expect(text(cards()[0].querySelector('.key-err'))).toBe('Out of range');
    expect(gets()).toBe(before);
    expect(toastTexts()).toEqual([]);
  });
});

describe('Answer key after a 403/409 (5d T6, R10)', () => {
  it('Number: a 409 on a focused ✓ keeps the values and error, moves focus into the field, and Cancel falls back', async () => {
    const s = new QuizServer([num()]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), '7');
    const ok = byName(cards()[0], 'Save answer')!;
    ok.focus();
    ok.click();
    await settle();
    const archived = mkVersion({ state: 'archived' });
    r.props.modal.version = archived;
    r.props.modal.perms = versionPermissions(archived);
    await settle();
    expect(input(0, 'Answer').value).toBe('7');
    expect(text(cards()[0].querySelector('.key-err'))).toBe('Version is not editable');
    expect(byName(cards()[0], FORBIDDEN_TITLE)!.disabled).toBe(true);
    expect(document.activeElement).toBe(input(0, 'Answer'));   // never left on a disabled ✓
    byName(cards()[0], 'Cancel')!.click();
    await settle();
    expect(cards()[0].querySelector('.key-edit')).toBeNull();
    expect(panel().contains(document.activeElement)).toBe(true);
  });
});

describe('Text answer (5d T6)', () => {
  it('opens with the stored answer and the hint; Enter saves only correct_text', async () => {
    const s = new QuizServer([num(), txt()]);
    await renderQuiz(s);
    pencil(1).click();
    await settle();
    expect(input(1, 'Answer').value).toBe('unit vector');
    expect(text(cards()[1].querySelector('.inline-hint'))).toBe('Case-insensitive, trimmed match.');
    typeInto(input(1, 'Answer'), ' basis ');
    press(input(1, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_text: 'basis' }]);
    expect(line(1)).toBe('Answer basis');
  });

  it('an empty unset answer closes silently', async () => {
    const s = new QuizServer([txt({ id: 1, correct_text: null })]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(cards()[0].querySelector('input')).toBeNull();
    expect(qWrites(s)).toEqual([]);
  });
});

describe('Answer key in a published version (5d T6)', () => {
  it('the D10 prompt comes before the key confirm; Cancel on the confirm keeps the field', async () => {
    const s = new QuizServer([num(), txt()]);
    await renderQuiz(s, { version: { state: 'published' } });
    pencil(0).click();
    await settle();
    typeInto(input(0, 'Answer'), '9');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    pencil(1).click();
    await settle();
    typeInto(input(1, 'Answer'), 'changed');
    ask.mockReturnValue(false);
    press(input(1, 'Answer'), 'Enter');
    await settle();
    expect(ask.mock.calls.map((c) => c[0])).toEqual([DISCARD_PROMPT, KEY_CONFIRM]);
    expect(input(1, 'Answer').value).toBe('changed');
    expect(qWrites(s)).toEqual([]);
    ask.mockReturnValue(true);
    press(input(1, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_text: 'changed' }]);
  });

  it('archived: no pencil', async () => {
    await renderQuiz(new QuizServer([num()]), { version: { state: 'archived' } });
    expect(byName(cards()[0], 'Edit the answer to question 1')).toBeUndefined();
  });
});
