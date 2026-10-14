import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, mkVersion, renderQuiz, cleanup, settle, panel, topPanel, cards, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';
import { DISCARD, DISCARD_CONTINUE } from '../lib/editorReasons';
import { FORBIDDEN_TITLE } from '../lib/quizEdits.svelte';
import { navigate } from '../lib/router.svelte';
import { versionPermissions } from '../lib/versionPermissions';

afterEach(cleanup);

const area = () => topPanel().querySelector<HTMLTextAreaElement>('textarea')!;
const footBtn = (label: string) =>
  [...topPanel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => text(b) === label)!;
const qWrites = (s: QuizServer) => s.writes().filter((c) => /^\/api\/questions\/\d+$/.test(c.path));
const isL3Open = () => document.querySelectorAll('section.modal-panel').length === 2;
// A question in place of the top modal's footer buttons (Polish 1).
const footAsk = () => topPanel().querySelector<HTMLElement>('footer.modal-foot .inline-confirm');
const footAskBtn = (k: 'confirm' | 'cancel') => footAsk()?.querySelector<HTMLButtonElement>(`button.${k}`) ?? null;
const xOf = (p: HTMLElement) => p.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;

async function openText(i = 0) { byName(cards()[i], `Edit question ${i + 1}`)!.click(); await settle(); }

describe('Question text modal (5d T7)', () => {
  it('opens on top, inside the quiz modal\'s DOM, titled "Question N" with the type; the textarea has focus', async () => {
    await renderQuiz(new QuizServer([q({ id: 1, text_md: 'What is x?' })]));
    await openText();
    expect(isL3Open()).toBe(true);
    expect(panel().contains(topPanel())).toBe(true);
    expect(text(topPanel().querySelector('h2'))).toBe('Question 1');
    expect(text(topPanel().querySelector('.qt-sub'))).toBe('Single choice');
    expect(area().value).toBe('What is x?');
    expect(document.activeElement).toBe(area());
  });

  it('Save sends text_md, re-renders the card (links in a new tab), returns focus to ✎, announces "Saved"', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    typeInto(area(), 'See <a href="https://x.test">x</a>');
    footBtn('Save').click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ text_md: 'See <a href="https://x.test">x</a>' }]);
    expect(isL3Open()).toBe(false);
    expect(cards()[0].querySelector('.qtext a')!.getAttribute('target')).toBe('_blank');
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
    expect(live()).toBe('Saved');
  });

  it('closing without changes just closes; with changes it asks in the footer (#15); Esc closes only the top modal', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openText();
    footBtn('Cancel').click();
    await settle();
    expect(isL3Open()).toBe(false);
    await openText();
    typeInto(area(), 'changed');
    expect(r.anyDirty()).toBe('true');
    press(area(), 'Escape');
    await settle();
    expect(text(footAsk()!.querySelector('.warning'))).toBe(DISCARD);
    expect(text(footAskBtn('confirm'))).toBe('Discard');
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    expect(topPanel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(isL3Open()).toBe(true);
    footAskBtn('cancel')!.click();
    await settle();
    expect(footAsk()).toBeNull();
    expect(document.activeElement).toBe(xOf(topPanel()));      // Esc counts as ×
    press(area(), 'Escape');
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
    expect(isL3Open()).toBe(false);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('the footer Cancel asks; Cancel on the question returns to it; ⌘S saves nothing while it asks (R48)', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    typeInto(area(), 'changed');
    footBtn('Cancel').click();
    await settle();
    const e = press(footAskBtn('cancel')!, 's', { metaKey: true });
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(qWrites(s)).toEqual([]);
    footAskBtn('cancel')!.click();
    await settle();
    expect(document.activeElement).toBe(footBtn('Cancel'));
  });

  it('empty text shows an error inside the modal and sends nothing', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    typeInto(area(), '   ');
    footBtn('Save').click();
    await settle();
    expect(text(topPanel().querySelector('.qt-err'))).toBe('Enter the question text');
    expect(qWrites(s)).toEqual([]);
  });

  it('while saving: read-only, Cancel and × disabled, Esc ignored, not unsaved work; a failure shows inside', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    const r = await renderQuiz(s);
    await openText();
    typeInto(area(), 'New');
    footBtn('Save').click();
    await settle();
    expect(area().readOnly).toBe(true);
    expect(footBtn('Cancel').disabled).toBe(true);
    expect(topPanel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.disabled).toBe(true);
    press(area(), 'Escape');
    await settle();
    expect(isL3Open()).toBe(true);
    expect(r.anyDirty()).toBe('false');
    hold.fail(422, 'Too long');
    await settle();
    expect(isL3Open()).toBe(true);
    expect(text(topPanel().querySelector('.qt-err'))).toBe('Too long');
    expect(area().value).toBe('New');
    expect(toastTexts()).toEqual([]);
  });

  it('Back during a level-3 save does not prompt; a late failure toasts', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    const r = await renderQuiz(s);
    await openText();
    typeInto(area(), 'New');
    footBtn('Save').click();
    await settle();
    expect(r.anyDirty()).toBe('false');
    r.closeModal();
    hold.fail(500, 'Boom');
    await settle();
    expect(toastTexts()).toEqual(['Boom']);
  });

  it('an upload in flight disables Save', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.hold('POST', /\/assets$/);
    await renderQuiz(s);
    await openText();
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['a'], 'a.png', { type: 'image/png' })], types: ['Files'] } });
    area().dispatchEvent(drop);
    await settle();
    expect(footBtn('Save').disabled).toBe(true);
  });

  it('Tab and Shift+Tab stay in the top modal; ⌘S saves the top modal only', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    const save = footBtn('Save');
    save.focus();
    press(save, 'Tab');
    expect(topPanel().contains(document.activeElement)).toBe(true);
    press(document.activeElement!, 'Tab', { shiftKey: true });
    expect(topPanel().contains(document.activeElement)).toBe(true);
    typeInto(area(), 'Via keyboard');
    const e = press(area(), 's', { metaKey: true });
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(qWrites(s).map((c) => c.body)).toEqual([{ text_md: 'Via keyboard' }]);
    expect(s.writes().filter((c) => c.path === '/api/items/7')).toEqual([]);
  });

  it('an echo writes back only the fields its request carried', async () => {
    const s = new QuizServer([q({ id: 1, type: 'numeric_answer', correct_numeric: 5, precision: 2 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    await renderQuiz(s);
    byName(cards()[0], 'Edit the answer to question 1')!.click();
    await settle();
    typeInto(cards()[0].querySelector<HTMLInputElement>('input[aria-label="Answer"]')!, '6');
    press(cards()[0].querySelector('input[aria-label="Answer"]')!, 'Enter');
    await settle();
    // Another tab changes the text meanwhile; this echo carries it.
    s.questions[0].text_md = 'Elsewhere';
    s.questions[0].text_html = '<p>Elsewhere</p>';
    hold.release();
    await settle();
    expect(text(cards()[0].querySelector('.qtext'))).toBe('Q1');
    expect(text(cards()[0].querySelector('p.key-line'))).toBe('Answer 6 · 2 decimals (± 0.005)');
  });
});

describe('Explanation modal (5d T7)', () => {
  it('"+ Add explanation" opens it with no asset sidebar and the note; Save adds; focus goes to the new ✎', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    byName(cards()[0], 'Add explanation to question 1')!.click();
    await settle();
    expect(text(topPanel().querySelector('h2'))).toBe('Explanation · question 1');
    expect(text(topPanel().querySelector('.ex-sub'))).toBe('Shown to students after they answer.');
    expect(text(topPanel().querySelector('.ex-note'))).toBe(
      'Markdown. Images already in an explanation keep working; new ones cannot be added here.');
    expect(topPanel().querySelector('[data-testid="asset-sidebar"]')).toBeNull();
    expect(byName(topPanel(), 'Remove explanation')).toBeUndefined();
    typeInto(area(), 'Because');
    footBtn('Save').click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ explanation_md: 'Because' }]);
    expect(text(cards()[0].querySelector('.qexpl-body'))).toBe('Because');
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit explanation for question 1'));
  });

  it('Remove asks in the footer (#8), sends null on Remove, and focus goes to "+ Add explanation"', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    expect(text(footAsk()!.querySelector('.warning'))).toBe('Remove the explanation for question 1?');
    expect(text(footAskBtn('confirm'))).toBe('Remove');
    expect(footAskBtn('confirm')!.classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    footAskBtn('cancel')!.click();
    await settle();
    expect(qWrites(s)).toEqual([]);
    expect(document.activeElement).toBe(byName(topPanel(), 'Remove explanation'));
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ explanation_md: null }]);
    expect(cards()[0].querySelector('.qexpl')).toBeNull();
    expect(document.activeElement).toBe(byName(cards()[0], 'Add explanation to question 1'));
  });

  it('saving an empty explanation also removes it', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    typeInto(area(), '  ');
    footBtn('Save').click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ explanation_md: null }]);
  });

  it('a page discard closes an open level-3 modal', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]));
    byName(cards()[0], 'Add explanation to question 1')!.click();
    await settle();
    typeInto(area(), 'typed');
    r.registry().discardAll();
    await settle();
    expect(isL3Open()).toBe(false);
  });

  it('published: text and explanation stay editable; archived: no pencils at all', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]), { version: { state: 'published' } });
    expect(byName(cards()[0], 'Edit question 1')).toBeDefined();
    expect(byName(cards()[0], 'Add explanation to question 1')).toBeDefined();
    cleanup();
    await renderQuiz(new QuizServer([q({ id: 1, explanation_md: 'e', explanation_html: '<p>e</p>' })]), { version: { state: 'archived' } });
    expect(byName(cards()[0], 'Edit question 1')).toBeUndefined();
    expect(byName(cards()[0], 'Edit explanation for question 1')).toBeUndefined();
  });
});

describe('Level 3 — review fixes (5d T7)', () => {
  const archive = (r: Awaited<ReturnType<typeof renderQuiz>>) => {
    const archived = mkVersion({ state: 'archived' });
    r.props.modal.version = archived;
    r.props.modal.perms = versionPermissions(archived);
  };

  it('⌘S from level 3 is handled once: it never reaches the item modal (T4 NOTE)', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openText();
    const e = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    const pd = vi.spyOn(e, 'preventDefault');
    area().dispatchEvent(e);
    await settle();
    expect(pd).toHaveBeenCalledTimes(1);
  });

  it('Remove: the busy confirm holds focus while the request runs; after a failure focus is on "Remove explanation" (R54)', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    const confirm = footAskBtn('confirm')!;
    confirm.click();
    await settle();
    expect(document.activeElement).toBe(confirm);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    confirm.click();                              // busy: nothing answers twice
    hold.fail(500, 'Boom');
    await settle();
    expect(qWrites(s).length).toBe(1);
    expect(footAsk()).toBeNull();
    expect(text(topPanel().querySelector('.ex-err'))).toBe('Boom');
    expect(document.activeElement).toBe(byName(topPanel(), 'Remove explanation'));
  });

  it('R10: a 409 on a focused Save keeps level 3 open, the text and error, and focus inside it', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    await openText();
    typeInto(area(), 'Late');
    const save = footBtn('Save');
    save.focus();
    save.click();
    await settle();
    archive(r);
    await settle();
    expect(isL3Open()).toBe(true);
    expect(area().value).toBe('Late');
    expect(text(topPanel().querySelector('.qt-err'))).toBe('Version is not editable');
    expect(footBtn('Save').disabled).toBe(true);
    expect(footBtn('Save').title).toBe(FORBIDDEN_TITLE);
    expect(document.activeElement).toBe(area());     // never left on the disabled Save
    footBtn('Cancel').click();
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
    expect(isL3Open()).toBe(false);
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('#8 R49: the right to edit goes while Remove asks; Remove sends nothing and focus goes to the text (never <body>)', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    const r = await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    archive(r);
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
    expect(qWrites(s)).toEqual([]);
    expect(footAsk()).toBeNull();
    expect(isL3Open()).toBe(true);
    expect(document.activeElement).toBe(area());
  });

  it('R10 in Preview (no textarea): a 409 on a focused Save moves focus to Cancel', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    await openText();
    typeInto(area(), 'Late');
    topPanel().querySelector<HTMLButtonElement>('button[data-action="preview"]')!.click();
    await settle();
    expect(topPanel().querySelector('textarea')).toBeNull();
    const save = footBtn('Save');
    save.focus();
    save.click();
    await settle();
    archive(r);
    await settle();
    expect(document.activeElement).toBe(footBtn('Cancel'));
  });

  it('R10: a 409 on a focused Remove moves focus into the explanation field', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    footAskBtn('confirm')!.click();
    await settle();
    archive(r);
    await settle();
    expect(isL3Open()).toBe(true);
    expect(byName(topPanel(), 'Remove explanation')!.disabled).toBe(true);
    expect(document.activeElement).toBe(area());
  });

  it('a stale success after the page left the version unlocks the modal and announces nothing', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    const r = await renderQuiz(s);
    await openText();
    typeInto(area(), 'New');
    footBtn('Save').click();
    await settle();
    (r.props.modal as { stillOnVid: () => boolean }).stillOnVid = () => false;
    hold.release();
    await settle();
    expect(live()).not.toBe('Saved');
    expect(footBtn('Cancel').disabled).toBe(false);
    expect(area().readOnly).toBe(false);
  });

  it('whitespace over no stored explanation closes without a request', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    byName(cards()[0], 'Add explanation to question 1')!.click();
    await settle();
    typeInto(area(), '   ');
    footBtn('Save').click();
    await settle();
    expect(qWrites(s)).toEqual([]);
    expect(isL3Open()).toBe(false);
  });
});

describe('Level 3 — the page question (Polish 1 R46, R53)', () => {
  it('a dirty level-3 modal + a navigation asks in its footer; Cancel keeps the text and focuses its ×', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]), { page: true });
    await openText();
    typeInto(area(), 'changed');
    const before = location.pathname;
    const nav = navigate('/l3-elsewhere');
    await settle();
    expect(text(footAsk()!.querySelector('.warning'))).toBe(DISCARD_CONTINUE);
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    expect(panel().querySelector('.inline-confirm')).toBe(footAsk());    // one question, at the top modal
    expect(topPanel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    footAskBtn('cancel')!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe(before);
    expect(area().value).toBe('changed');
    expect(document.activeElement).toBe(xOf(topPanel()));
  });

  it('with its own close question open, a navigation is refused: the address stays, focus on that question\'s Cancel', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]), { page: true });
    byName(cards()[0], 'Add explanation to question 1')!.click();
    await settle();
    typeInto(area(), 'typed');
    press(area(), 'Escape');
    await settle();
    const before = location.pathname;
    xOf(topPanel()).focus();
    await navigate('/l3-refused');
    await settle();
    expect(location.pathname).toBe(before);
    expect(document.activeElement).toBe(footAskBtn('cancel'));
    expect(text(footAsk()!.querySelector('.warning'))).toBe(DISCARD);
  });

  it('Discard on the page question drops the edit and lets the navigation through', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]), { page: true });
    await openText();
    typeInto(area(), 'changed');
    const nav = navigate('/l3-discarded');
    await settle();
    footAskBtn('confirm')!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe('/l3-discarded');
    expect(isL3Open()).toBe(false);
    expect(r.anyDirty()).toBe('false');
  });
});
