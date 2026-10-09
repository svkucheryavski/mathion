import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  QuizEdits, InlineEdit, DISCARD_PROMPT, type EditHandle, type InlineOptions,
} from '../lib/quizEdits.svelte';
import { ApiError } from '../lib/api';
import { toasts, clearToasts } from '../stores/toasts.svelte';

afterEach(() => { vi.restoreAllMocks(); clearToasts(); });

function handle(over: { dirty?: boolean; saving?: boolean } = {}, id = 'a') {
  const close = vi.fn();
  const h: EditHandle = { id, dirty: over.dirty ?? false, saving: over.saving ?? false, close };
  return { h, close };
}

describe('QuizEdits (D10)', () => {
  it('lets any action through when nothing is open', () => {
    expect(new QuizEdits().request()).toBe(true);
  });

  it('lets the open edit act on itself', () => {
    const e = new QuizEdits();
    e.open(handle({ dirty: true }).h);
    expect(e.request('a')).toBe(true);
  });

  it('closes a clean edit silently, without moving focus', () => {
    const e = new QuizEdits();
    const { h, close } = handle();
    e.open(h);
    const ask = vi.spyOn(window, 'confirm');
    expect(e.request()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('asks before discarding a changed edit', () => {
    const e = new QuizEdits();
    const { h, close } = handle({ dirty: true });
    e.open(h);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(e.request()).toBe(false);
    expect(ask).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(close).not.toHaveBeenCalled();
    expect(e.active).toBe(h);
    ask.mockReturnValue(true);
    expect(e.request()).toBe(true);
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('never closes a saving edit, and a saving edit is not unsaved work', () => {
    const e = new QuizEdits();
    const { h, close } = handle({ dirty: true, saving: true });
    e.open(h);
    const ask = vi.spyOn(window, 'confirm');
    expect(e.request()).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(e.locked).toBe(true);
    expect(e.dirty).toBe(false);
    e.discardAll();
    expect(close).not.toHaveBeenCalled();
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

  it('a move or delete passes a saving edit untouched; otherwise it is D10', () => {
    const e = new QuizEdits();
    const saving = handle({ dirty: true, saving: true });
    e.open(saving.h);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(e.requestStructure()).toBe(true);
    expect(saving.close).not.toHaveBeenCalled();
    expect(e.active).toBe(saving.h);
    const changed = handle({ dirty: true }, 'b');
    e.open(changed.h);
    expect(e.requestStructure()).toBe(false);
    expect(ask).toHaveBeenCalledWith(DISCARD_PROMPT);
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
    const detach = ed.attach();
    return { edits, ed, close, send, detach };
  }

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

  it('a declined confirm keeps the field open and sends nothing', async () => {
    const { ed, send, close } = make({ confirmSend: () => false });
    ed.value = 'new';
    await ed.commit();
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
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

  it('a declined key confirm clears an earlier check message', async () => {
    const { ed, send } = make({ confirmSend: () => false });
    ed.value = ' ';
    await ed.commit();
    expect(ed.error).toBe('Required');
    ed.value = 'new';
    await ed.commit();
    expect(ed.error).toBeNull();
    expect(send).not.toHaveBeenCalled();
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
});
