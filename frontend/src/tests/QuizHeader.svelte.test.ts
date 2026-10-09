import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, mkVersion, renderQuiz, cleanup, settle, panel, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';
import { versionPermissions } from '../lib/versionPermissions';
import { FORBIDDEN_TITLE } from '../lib/quizEdits.svelte';

afterEach(cleanup);

const h2 = () => panel().querySelector<HTMLElement>('h2.item-name')!;
const pencil = () => byName(panel(), 'Edit title')!;
const field = () => h2().querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
const trash = () => panel().querySelector<HTMLButtonElement>('button[aria-label="Delete item"]')!;
const closeX = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const itemPatches = (s: QuizServer) => s.writes().filter((c) => c.path === '/api/items/7');

async function openTitle() {
  pencil().click();
  await settle();
}

describe('Quiz header (5d T4)', () => {
  it('first focus is the title pencil when text is editable, else the close button', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]));
    await settle();
    expect(document.activeElement).toBe(pencil());
    cleanup();
    await renderQuiz(new QuizServer([q({ id: 1 })]), { version: { state: 'archived' } });
    await settle();
    expect(byName(panel(), 'Edit title')).toBeUndefined();
    expect(document.activeElement).toBe(closeX());
  });

  it('only the field goes inside the h2; check and cancel sit after it; the dialog keeps its name', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openTitle();
    expect(field()).not.toBeNull();
    expect(document.activeElement).toBe(field());
    expect(h2().querySelectorAll('button').length).toBe(0);
    expect(byName(panel(), 'Save title')).toBeDefined();
    expect(byName(panel(), 'Cancel')).toBeDefined();
    expect(panel().getAttribute('aria-labelledby')).toBe(h2().id);
  });

  it('Enter saves once with renameItem, shows the echo, returns focus and announces "Saved"', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openTitle();
    typeInto(field(), '  New name ');
    press(field(), 'Enter');
    press(field(), 'Enter');
    await settle();
    expect(itemPatches(s).map((c) => c.body)).toEqual([{ title: 'New name' }]);
    expect(text(h2())).toBe('New name');
    expect(document.activeElement).toBe(pencil());
    expect(live()).toBe('Saved');
  });

  it('an unchanged value closes silently; Esc cancels and the modal stays open', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const r = await renderQuiz(s);
    await openTitle();
    press(field(), 'Enter');
    await settle();
    expect(h2().querySelector('input')).toBeNull();
    await openTitle();
    typeInto(field(), 'Other');
    const esc = press(field(), 'Escape');
    await settle();
    expect(esc.defaultPrevented).toBe(true);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(text(h2())).toBe('Test me');
    expect(document.activeElement).toBe(pencil());
    expect(itemPatches(s)).toEqual([]);
  });

  it('an empty title shows "Title is required" as the body\'s first line; nothing is sent', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openTitle();
    typeInto(field(), '   ');
    press(field(), 'Enter');
    await settle();
    const err = panel().querySelector('.modal-body .field-err')!;
    expect(text(err)).toBe('Title is required');
    expect(field().getAttribute('aria-describedby')).toBe(err.id);
    expect(itemPatches(s)).toEqual([]);
  });

  it('a failed save keeps the field with the typed text and the error, and it is unsaved work again', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.failNext('PATCH', /\/api\/items\/7$/, 422, 'Too long');
    const r = await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'Bad');
    press(field(), 'Enter');
    await settle();
    expect(field().value).toBe('Bad');
    expect(text(panel().querySelector('.modal-body .field-err'))).toBe('Too long');
    expect(r.anyDirty()).toBe('true');
  });

  it('an open changed title is unsaved work: the trash names it; a page discard closes it', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openTitle();
    typeInto(field(), 'Changed');
    expect(r.anyDirty()).toBe('true');
    expect(trash().disabled).toBe(true);
    expect(trash().title).toBe('Delete this item — finish or discard the open edit first');
    r.registry().discardAll();
    await settle();
    expect(h2().querySelector('input')).toBeNull();
    expect(r.anyDirty()).toBe('false');
  });

  it('while the title saves: readonly, "Saving…", cancel disabled, Esc swallowed, trash waits, nothing unsaved', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/items\/7$/);
    const r = await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'Slow');
    press(field(), 'Enter');
    await settle();
    expect(field().readOnly).toBe(true);
    expect(byName(panel(), 'Saving…')).toBeDefined();
    expect(byName(panel(), 'Cancel')!.disabled).toBe(true);
    const esc = press(field(), 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(field()).not.toBeNull();
    expect(trash().title).toBe('Delete this item — wait for the save to finish');
    expect(trash().disabled).toBe(true);
    expect(r.anyDirty()).toBe('false');
    hold.release();
    await settle();
    expect(trash().disabled).toBe(false);
  });

  it('closing during the save does not prompt, and a late failure toasts', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/items\/7$/);
    const r = await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'Late');
    press(field(), 'Enter');
    await settle();
    expect(r.anyDirty()).toBe('false');
    r.closeModal();
    hold.fail(500, 'Boom');
    await settle();
    expect(toastTexts()).toEqual(['Boom']);
  });

  it('a 403/409 that takes the right away: the field keeps text and error, ✓ is forbidden, Cancel goes to ×', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.failNext('PATCH', /\/api\/items\/7$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'Late rename');
    press(field(), 'Enter');
    await settle();
    // The tree reload re-derives the permissions: the version is archived now.
    const archived = mkVersion({ state: 'archived' });
    r.props.modal.version = archived;
    r.props.modal.perms = versionPermissions(archived);
    await settle();
    expect(field().value).toBe('Late rename');
    expect(text(panel().querySelector('.modal-body .field-err'))).toBe('Version is not editable');
    const ok = byName(panel(), FORBIDDEN_TITLE)!;
    expect(ok.disabled).toBe(true);
    byName(panel(), 'Cancel')!.click();
    await settle();
    expect(h2().querySelector('input')).toBeNull();
    expect(byName(panel(), 'Edit title')).toBeUndefined();
    expect(document.activeElement).toBe(closeX());
  });

  it('⌘S in the quiz modal is swallowed and sends nothing', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    const e = press(pencil(), 's', { metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    await settle();
    expect(s.writes()).toEqual([]);
  });

  it('the trash waits for any request in flight (a lock-free save)', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/items\/7$/);
    await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'X');
    byName(panel(), 'Save title')!.click();
    await settle();
    expect(trash().title).toBe('Delete this item — wait for the save to finish');
    hold.release();
    await settle();
    expect(trash().title).toBe('Delete this item');
    vi.restoreAllMocks();
  });
});
