import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  QuizEdits, InlineEdit, DISCARD_PROMPT, type EditHandle, type InlineOptions,
} from '../lib/quizEdits.svelte';
import { InPlaceAsk, DISCARD_NAV_ASK, type Ask, type Answer } from '../lib/askInPlace.svelte';
import { ApiError } from '../lib/api';
import { toasts, clearToasts } from '../stores/toasts.svelte';

afterEach(() => { vi.restoreAllMocks(); clearToasts(); document.body.replaceChildren(); });

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function handle(over: { dirty?: boolean; saving?: boolean; ask?: (q: Ask) => Promise<Answer> } = {}, id = 'a') {
  const close = vi.fn();
  const h: EditHandle = { id, dirty: over.dirty ?? false, saving: over.saving ?? false, close, ask: over.ask };
  return { h, close };
}

/** Stands in for <AskSlot>: a drawn question with its two buttons. Returns its Cancel. */
function drawn(a: InPlaceAsk): HTMLButtonElement {
  const el = document.body.appendChild(document.createElement('div'));
  el.innerHTML = '<div class="inline-confirm"><button class="confirm">OK</button><button class="cancel">Cancel</button></div>';
  a.host = el;
  return el.querySelector<HTMLButtonElement>('button.cancel')!;
}

describe('QuizEdits (D10)', () => {
  it('lets any action through when nothing is open', async () => {
    expect(await new QuizEdits().request()).toBe(true);
  });

  it('lets the open edit act on itself', async () => {
    const e = new QuizEdits();
    e.open(handle({ dirty: true }).h);
    expect(await e.request('a')).toBe(true);
  });

  it('closes a clean edit silently, without asking or moving focus', async () => {
    const e = new QuizEdits();
    const ask = vi.fn(async () => 'cancel' as Answer);
    const { h, close } = handle({ ask });
    e.open(h);
    expect(await e.request()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('#14: a changed edit asks at itself; Cancel and a dismissal keep it, Discard drops it', async () => {
    const e = new QuizEdits();
    const ask = vi.fn(async (_q: Ask): Promise<Answer> => 'cancel');
    const { h, close } = handle({ dirty: true, ask });
    e.open(h);
    expect(await e.request()).toBe(false);
    const q = ask.mock.calls[0]![0];
    expect(q).toMatchObject({ warning: DISCARD_PROMPT, confirmLabel: 'Discard', tone: 'danger', layout: 'row' });
    expect(q).not.toBe(DISCARD_NAV_ASK);   // a fresh object per question: sites compare by identity
    expect(close).not.toHaveBeenCalled();
    expect(e.active).toBe(h);
    ask.mockResolvedValue('dismissed');
    expect(await e.request()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    ask.mockResolvedValue('confirm');
    expect(await e.request()).toBe(true);
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('a changed edit that cannot ask (a level-3 modal) is kept', async () => {
    const e = new QuizEdits();
    const { h, close } = handle({ dirty: true });
    e.open(h);
    expect(await e.request()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('never closes a saving edit, and a saving edit is not unsaved work', async () => {
    const e = new QuizEdits();
    const ask = vi.fn(async () => 'confirm' as Answer);
    const { h, close } = handle({ dirty: true, saving: true, ask });
    e.open(h);
    expect(await e.request()).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(e.locked).toBe(true);
    expect(e.dirty).toBe(false);
    e.discardAll();
    expect(close).not.toHaveBeenCalled();
  });

  it('an edit that starts saving while it asks is never closed, even on Discard', async () => {
    const e = new QuizEdits();
    const st = { saving: false };
    const close = vi.fn();
    const h: EditHandle = {
      id: 'a', dirty: true, get saving() { return st.saving; }, close,
      ask: async () => { st.saving = true; return 'confirm'; },
    };
    e.open(h);
    expect(await e.request()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(e.active).toBe(h);
  });

  it('dirty is an open, changed, not-saving edit; discardAll closes it', () => {
    const e = new QuizEdits();
    expect(e.dirty).toBe(false);
    const { h, close } = handle({ dirty: true });
    e.open(h);
    expect(e.dirty).toBe(true);
    e.discardAll();
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('release clears only its own handle', () => {
    const e = new QuizEdits();
    const a = handle().h;
    const b = handle({}, 'b').h;
    e.open(a);
    e.release(b);
    expect(e.active).toBe(a);
    e.release(a);
    expect(e.active).toBeNull();
  });

  it('a move or delete passes a saving edit untouched, before or after the question; otherwise it is D10', async () => {
    const e = new QuizEdits();
    const saving = handle({ dirty: true, saving: true });
    e.open(saving.h);
    expect(await e.requestStructure()).toBe(true);
    expect(saving.close).not.toHaveBeenCalled();
    expect(e.active).toBe(saving.h);
    const ask = vi.fn(async (_q: Ask): Promise<Answer> => 'cancel');
    const changed = handle({ dirty: true, ask }, 'b');
    e.open(changed.h);
    expect(await e.requestStructure()).toBe(false);
    expect(ask.mock.calls[0]![0]).toMatchObject({ warning: DISCARD_PROMPT });
    const st = { saving: false };
    const late: EditHandle = {
      id: 'c', dirty: true, get saving() { return st.saving; }, close: vi.fn(),
      ask: async () => { st.saving = true; return 'cancel'; },
    };
    e.open(late);
    expect(await e.requestStructure()).toBe(true);
    expect(late.close).not.toHaveBeenCalled();
  });

  it('say clears the message, then sets it', async () => {
    const e = new QuizEdits();
    e.say('Saved');
    expect(e.message).toBe('');
    await Promise.resolve();
    expect(e.message).toBe('Saved');
  });

  it('track counts requests in flight, success or failure', async () => {
    const e = new QuizEdits();
    let resolve!: () => void;
    const p = e.track(new Promise<void>((r) => { resolve = r; }));
    expect(e.inFlight).toBe(true);
    resolve();
    await p;
    expect(e.inFlight).toBe(false);
    await expect(e.track(Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(e.inFlight).toBe(false);
  });
});

describe('InlineEdit', () => {
  function make(over: Partial<InlineOptions<string>> = {}) {
    const edits = new QuizEdits();
    const close = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    const ed = new InlineEdit<string>({
      id: 'x', edits, initial: 'old',
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Required' : null),
      send, close, ...over,
    });
    const field = document.body.appendChild(document.createElement('input'));
    const detach = ed.attach(field);
    return { edits, ed, close, send, detach, field };
  }
  const keyQ = (): Ask => ({
    warning: 'Change the key?', confirmLabel: 'Change key', tone: 'primary', layout: 'column', confirmDataAction: 'confirm-change-key',
  });

  it('takes the slot while attached', () => {
    const { edits, ed, detach } = make();
    expect(edits.active).toBe(ed.handle);
    detach();
    expect(edits.active).toBeNull();
  });

  it('an unchanged value closes without a request', async () => {
    const { ed, close, send } = make();
    ed.value = ' old ';
    await ed.commit();
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('unchanged (when given) decides the silent close, before the check', async () => {
    const { ed, close, send } = make({ initial: '', unchanged: (v) => v.trim() === '', check: () => 'Required' });
    await ed.commit();
    expect(close).toHaveBeenCalledWith(true);
    expect(ed.error).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('the check message shows and nothing is sent', async () => {
    const { ed, send } = make();
    ed.value = ' ';
    await ed.commit();
    expect(ed.error).toBe('Required');
    expect(send).not.toHaveBeenCalled();
  });

  it('saves, then closes; while saving it is locked but not unsaved', async () => {
    const { ed, send, close, edits } = make();
    ed.value = 'new';
    const p = ed.commit();
    expect(ed.saving).toBe(true);
    expect(edits.locked).toBe(true);
    expect(edits.dirty).toBe(false);
    expect(edits.inFlight).toBe(true);
    await p;
    expect(send).toHaveBeenCalledWith('new');
    expect(close).toHaveBeenCalledWith(true);
    await Promise.resolve();
    expect(edits.message).toBe('Saved');
  });

  it('a second commit while saving sends nothing more (double Enter)', async () => {
    const { ed, send } = make();
    ed.value = 'new';
    const p = ed.commit();
    await ed.commit();
    await p;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a failure stays open with the server message and the typed text', async () => {
    const { ed, close } = make({ send: vi.fn().mockRejectedValue(new ApiError(422, 'Nope')) });
    ed.value = 'new';
    await ed.commit();
    expect(ed.saving).toBe(false);
    expect(ed.error).toBe('Nope');
    expect(ed.value).toBe('new');
    expect(close).not.toHaveBeenCalled();
    expect(ed.handle.dirty).toBe(true);
  });

  it('a failure after the field closed is a toast', async () => {
    let reject!: (e: unknown) => void;
    const { ed, detach } = make({ send: () => new Promise<void>((_, r) => { reject = r; }) });
    ed.value = 'new';
    const p = ed.commit();
    detach();
    reject(new ApiError(500, 'Boom'));
    await p;
    expect(toasts.list.map((t) => t.message)).toEqual(['Boom']);
  });

  it('a failure after the version changed is a toast, even while attached', async () => {
    let live = true;
    const edits = new QuizEdits(() => live);
    let reject!: (e: unknown) => void;
    const ed = new InlineEdit<string>({
      id: 'x', edits, initial: 'old', same: (a, b) => a === b, check: () => null,
      send: () => new Promise<void>((_, r) => { reject = r; }), close: vi.fn(),
    });
    ed.attach();
    ed.value = 'new';
    const p = ed.commit();
    live = false;
    reject(new ApiError(500, 'Boom'));
    await p;
    expect(toasts.list.map((t) => t.message)).toEqual(['Boom']);
    expect(ed.error).toBeNull();
  });

  it('a save the version no longer allows sends nothing; the field and its text stay', async () => {
    let ok = true;
    const { ed, send, close } = make({ allowed: () => ok });
    expect(ed.canSave).toBe(true);
    ed.value = 'new';
    ok = false;
    expect(ed.canSave).toBe(false);
    await ed.commit();
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(ed.value).toBe('new');
    ed.cancel();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('a success after the version changed announces nothing (stale response)', async () => {
    let live = true;
    const edits = new QuizEdits(() => live);
    let resolve!: () => void;
    const close = vi.fn();
    const ed = new InlineEdit<string>({
      id: 'x', edits, initial: 'old', same: (a, b) => a === b, check: () => null,
      send: () => new Promise<void>((r) => { resolve = r; }), close,
    });
    ed.attach();
    ed.value = 'new';
    const p = ed.commit();
    live = false;
    resolve();
    await p;
    await Promise.resolve();
    expect(edits.message).toBe('');
    expect(ed.saving).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('an IME-confirming Enter (Safari keyCode 229) does not save', async () => {
    const { ed, send } = make();
    ed.value = 'new';
    const ime = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, cancelable: true });
    ed.keydown(ime);
    await Promise.resolve();
    expect(ime.defaultPrevented).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("after: 'reset' keeps the field open and empties it", async () => {
    const { ed, close } = make({ initial: '', after: 'reset' });
    ed.value = 'A';
    await ed.commit();
    expect(close).not.toHaveBeenCalled();
    expect(ed.value).toBe('');
    expect(ed.saving).toBe(false);
  });

  it('Escape cancels and is swallowed; Enter commits', async () => {
    const { ed, close, send } = make();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    ed.keydown(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledWith(true);
    ed.value = 'new';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    ed.keydown(enter);
    expect(enter.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith('new');
  });

  it('Escape while saving does nothing but is still swallowed', async () => {
    const { ed, close } = make();
    ed.value = 'new';
    const p = ed.commit();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    ed.keydown(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    await p;
  });

  it('#14: its handle asks with the edit\'s own question; Cancel returns focus to the field', async () => {
    const { edits, ed, field } = make();
    ed.value = 'new';
    const p = edits.request();
    expect(ed.asking.current).toMatchObject({ warning: DISCARD_PROMPT });
    ed.asking.answer('cancel');
    expect(await p).toBe(false);
    await flush();
    expect(document.activeElement).toBe(field);
    expect(edits.active).toBe(ed.handle);
  });

  it('#14: Discard settles the question at once (no request) and drops the edit', async () => {
    const { edits, ed, close } = make();
    ed.value = 'new';
    const p = edits.request();
    ed.asking.answer('confirm');
    expect(await p).toBe(true);
    expect(ed.asking.open).toBe(false);
    expect(close).toHaveBeenCalledWith(false);
    expect(edits.active).toBeNull();
  });

  it('while it asks, Enter, ✓, ✕ and Esc only bring the question back', async () => {
    const { edits, ed, close, send, field } = make();
    ed.value = 'new';
    void edits.request();
    const cancel = drawn(ed.asking);
    field.focus();
    ed.keydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(document.activeElement).toBe(cancel);
    field.focus();
    await ed.commit();
    expect(document.activeElement).toBe(cancel);
    field.focus();
    ed.cancel();
    expect(document.activeElement).toBe(cancel);
    field.focus();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    ed.keydown(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(ed.asking.open).toBe(true);
  });

  it('closing the field withdraws its own question, never another site\'s on a shared row', async () => {
    const shared = new InPlaceAsk();
    const { edits, ed, detach } = make({ asking: shared });
    ed.value = 'new';
    const p = edits.request();
    detach();
    expect(await p).toBe(false);
    expect(shared.open).toBe(false);
    const other = make({ asking: shared });
    const theirs = shared.ask({ warning: 'Delete it?', confirmLabel: 'Delete', tone: 'danger', confirmDataAction: 'confirm-x' });
    other.detach();
    expect(shared.open).toBe(true);
    shared.answer('cancel');
    expect(await theirs).toBe('cancel');
  });

  it('#6 confirm: asks after the checks, with the old message cleared; Cancel sends nothing and focuses the field', async () => {
    const { ed, send, close, field } = make({ confirm: keyQ });
    ed.value = ' ';
    await ed.commit();
    expect(ed.error).toBe('Required');
    expect(ed.asking.open).toBe(false);          // the check comes first
    ed.value = 'new';
    const p = ed.commit();
    expect(ed.error).toBeNull();
    expect(ed.asking.current).toMatchObject({ confirmLabel: 'Change key' });
    ed.asking.answer('cancel');
    await p;
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it('#6 confirm: the save runs with the question busy; it settles when the save succeeds', async () => {
    let resolve!: () => void;
    // make() returns its default `send`; keep the spy passed in.
    const send = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { ed, close } = make({ confirm: keyQ, send });
    ed.value = 'new';
    const p = ed.commit();
    ed.asking.answer('confirm');
    await flush();
    expect(send).toHaveBeenCalledWith('new');
    expect(ed.asking.busy).toBe(true);
    expect(ed.saving).toBe(true);
    resolve();
    await p;
    expect(ed.asking.open).toBe(false);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('#6 confirm (R57): focus moved elsewhere while the key saved stays there; the field closes without refocusing (whole-branch review)', async () => {
    let resolve!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { ed, close } = make({ confirm: keyQ, send });
    ed.value = 'new';
    const p = ed.commit();
    drawn(ed.asking);
    ed.asking.answer('confirm');
    await flush();
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    resolve();
    await p;
    expect(ed.asking.open).toBe(false);
    expect(close).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('#6 confirm (R57): focus still in the busy question when the key saves → the field closes and refocuses its opener', async () => {
    let resolve!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { ed, close } = make({ confirm: keyQ, send });
    ed.value = 'new';
    const p = ed.commit();
    drawn(ed.asking);
    ed.asking.answer('confirm');
    await flush();
    expect(ed.asking.host?.contains(document.activeElement)).toBe(true);
    resolve();
    await p;
    expect(close).toHaveBeenCalledWith(true);
  });

  it('#6 confirm: a failed save keeps the field and its error; the question settles and focus returns to the field', async () => {
    const { ed, close, field } = make({ confirm: keyQ, send: vi.fn().mockRejectedValue(new ApiError(422, 'Nope')) });
    ed.value = 'new';
    const p = ed.commit();
    ed.asking.answer('confirm');
    await p;
    expect(ed.asking.open).toBe(false);
    expect(ed.error).toBe('Nope');
    expect(ed.value).toBe('new');
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it('#6 confirm (R49): a save the version stopped allowing while it asked sends nothing; the field stays', async () => {
    let ok = true;
    const { ed, send, close } = make({ confirm: keyQ, allowed: () => ok });
    ed.value = 'new';
    const p = ed.commit();
    ok = false;
    ed.asking.answer('confirm');
    await p;
    expect(send).not.toHaveBeenCalled();
    expect(ed.asking.open).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(ed.value).toBe('new');
  });
});
