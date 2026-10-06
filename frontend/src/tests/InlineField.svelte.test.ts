import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Hoisted: inline vi.fn() in the factory, typed handle after the imports.
vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...real, pushToast: vi.fn() };
});

import { pushToast } from '../stores/toasts.svelte';
import InlineField from '../components/ui/InlineField.svelte';
import { ApiError } from '../lib/api';
import { DIRTY_REGISTRY_KEY, createDirtyRegistry, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';

const toastMock = vi.mocked(pushToast);

type Props = {
  label: string;
  value: string | number;
  kind: 'text' | 'textarea' | 'number';
  editTitle: string;
  disabledReason: string | null;
  required?: boolean;
  validate?: (p: string | number) => string | null;
  onCommit: (p: string | number) => Promise<void>;
};

let host: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function render(over: Partial<Props> = {}, registry?: DirtyRegistry) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const props: Props = $state({
    label: 'Label', value: 'Old', kind: 'text', editTitle: 'Edit the label',
    disabledReason: null, onCommit: vi.fn().mockResolvedValue(undefined), ...over,
  });
  cmp = mount(InlineField, {
    target: host, props,
    context: registry ? new Map<symbol, unknown>([[DIRTY_REGISTRY_KEY, registry]]) : undefined,
  });
  flushSync();
  return props;
}

const btn = (glyph: string) => host.querySelector<HTMLButtonElement>(`button[data-glyph="${glyph}"]`);
const editor = () => host.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
const err = () => host.querySelector('p.err');
async function open() { btn('pencil')!.click(); await settle(); }
function type(v: string) {
  const e = editor()!;
  e.value = v;
  e.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(k: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  const stop = vi.spyOn(ev, 'stopPropagation');
  editor()!.dispatchEvent(ev);
  flushSync();
  return { ev, stop };
}

beforeEach(() => { toastMock.mockReset(); });
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('InlineField — closed', () => {
  it('renders label, value and an enabled pencil named by editTitle', () => {
    render();
    expect(host.querySelector('.label')?.textContent).toBe('Label');
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('Old');
    const p = btn('pencil')!;
    expect(p.disabled).toBe(false);
    expect(p.getAttribute('aria-label')).toBe('Edit the label');
    expect(p.title).toBe('Edit the label');
    expect(editor()).toBeNull();
  });

  it('shows "Not set" for an empty value', () => {
    render({ value: '' });
    expect(host.querySelector('.value .not-set')?.textContent).toBe('Not set');
  });

  it('wraps a number value in .mono', () => {
    render({ kind: 'number', value: 3 });
    expect(host.querySelector('.value .mono')?.textContent).toBe('3');
  });

  it('the row is a labelled focus-parking group', () => {
    render();
    const row = host.querySelector<HTMLElement>('.inline-field')!;
    const labelId = host.querySelector('.label')!.id;
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('tabindex')).toBe('-1');
    expect(row.getAttribute('aria-labelledby')).toBe(labelId);
  });

  it('a disabledReason disables the pencil and becomes its title', () => {
    render({ disabledReason: 'Enable the version first' });
    const p = btn('pencil')!;
    expect(p.disabled).toBe(true);
    expect(p.title).toBe('Enable the version first');
    expect(p.getAttribute('aria-label')).toBe('Edit the label');
  });

  it('follows a value change while closed', () => {
    const props = render();
    props.value = 'New';
    flushSync();
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('New');
  });
});

describe('InlineField — open / cancel', () => {
  it('opening focuses the editor holding the value; ✕ and ✓ replace the pencil', async () => {
    render();
    await open();
    expect(editor()!.value).toBe('Old');
    expect(document.activeElement).toBe(editor());
    expect(btn('pencil')).toBeNull();
    expect(btn('close')!.getAttribute('aria-label')).toBe('Cancel editing Label');
    expect(btn('check')!.getAttribute('aria-label')).toBe('Save Label');
    expect(btn('check')!.classList.contains('primary')).toBe(true);
    expect(editor()!.getAttribute('aria-labelledby')).toBe(host.querySelector('.label')!.id);
  });

  it('✕ cancels, drops the draft and focuses the pencil', async () => {
    const props = render();
    await open();
    type('Draft');
    btn('close')!.click();
    await settle();
    expect(editor()).toBeNull();
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('Old');
    expect(document.activeElement).toBe(btn('pencil'));
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('Escape cancels, prevents default and does not propagate', async () => {
    render();
    await open();
    type('Draft');
    const { ev, stop } = key('Escape');
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(editor()).toBeNull();
    expect(document.activeElement).toBe(btn('pencil'));
  });

  it('keeps the draft when the value changes while open', async () => {
    const props = render();
    await open();
    type('Mine');
    props.value = 'Server';
    flushSync();
    expect(editor()!.value).toBe('Mine');
  });

  it('reopening clears a stale error', async () => {
    render({ required: true });
    await open();
    type('');
    btn('check')!.click();
    await settle();
    expect(err()).not.toBeNull();
    btn('close')!.click();
    await settle();
    await open();
    expect(err()).toBeNull();
  });
});

describe('InlineField — commit', () => {
  it('Enter commits the parsed draft, closes and focuses the pencil', async () => {
    const props = render();
    await open();
    type('New');
    const { ev } = key('Enter');
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(props.onCommit).toHaveBeenCalledWith('New');
    expect(editor()).toBeNull();
    expect(document.activeElement).toBe(btn('pencil'));
  });

  it('✓ commits too', async () => {
    const props = render();
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith('New');
  });

  it('Enter is ignored while composing', async () => {
    const props = render();
    await open();
    type('New');
    key('Enter', { isComposing: true });
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(editor()).not.toBeNull();
  });

  it('textarea: plain Enter does not commit, Ctrl+Enter and Cmd+Enter do', async () => {
    const props = render({ kind: 'textarea', value: 'a' });
    await open();
    expect(editor()!.tagName).toBe('TEXTAREA');
    expect(editor()!.classList.contains('mono')).toBe(true);
    const hintId = editor()!.getAttribute('aria-describedby')!;
    expect(document.getElementById(hintId)?.textContent).toMatch(/Control or Command plus Enter/);
    type('b');
    key('Enter');
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    key('Enter', { ctrlKey: true });
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith('b');
    await open();
    type('c');
    key('Enter', { metaKey: true });
    await settle();
    expect(props.onCommit).toHaveBeenLastCalledWith('c');
  });

  it('an unchanged draft closes without calling onCommit', async () => {
    const props = render();
    await open();
    btn('check')!.click();
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it('number: a draft equal in value ("3.0" vs 3) is unchanged — not dirty, closes without onCommit', async () => {
    const reg = createDirtyRegistry();
    const props = render({ kind: 'number', value: 3, label: 'Max quiz attempts' }, reg);
    await open();
    type('3.0');
    expect(reg.isAnyDirty()).toBe(false);
    btn('check')!.click();
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it('number: commits a number, blank → "Enter a number", validate blocks', async () => {
    const props = render({
      kind: 'number', value: 3, label: 'Max quiz attempts',
      validate: (n) => (typeof n === 'number' && n <= 10 ? null : 'Too many'),
    });
    await open();
    expect(editor()!.getAttribute('type')).toBe('number');
    type('');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Enter a number');
    type('11');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Too many');
    expect(props.onCommit).not.toHaveBeenCalled();
    type('5');
    btn('check')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith(5);
  });

  it('required: a blank draft shows "{label} is required" and does not commit', async () => {
    const props = render({ required: true, label: 'Block title' });
    await open();
    type('   ');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Block title is required');
    expect(err()?.getAttribute('role')).toBe('alert');
    expect(editor()!.getAttribute('aria-invalid')).toBe('true');
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('typing clears the error', async () => {
    render({ required: true });
    await open();
    type('');
    btn('check')!.click();
    await settle();
    expect(err()).not.toBeNull();
    type('x');
    expect(err()).toBeNull();
  });

  it('a rejected commit (string detail) keeps the draft, shows the detail and refocuses the editor', async () => {
    render({ onCommit: vi.fn().mockRejectedValue(new ApiError(400, 'Label taken')) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(editor()!.value).toBe('New');
    expect(err()?.textContent).toBe('Label taken');
    expect(editor()!.getAttribute('aria-describedby')).toContain(err()!.id);
    expect(document.activeElement).toBe(editor());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('a rejected commit (422 array detail) shows the first message', async () => {
    const e = new ApiError(422, [{ loc: ['body', 'label'], msg: 'String too long', type: 'x' }]);
    render({ onCommit: vi.fn().mockRejectedValue(e) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('String too long');
  });

  it('a non-API rejection shows "Save failed"', async () => {
    render({ onCommit: vi.fn().mockRejectedValue(new Error('boom')) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Save failed');
  });
});

describe('InlineField — busy and the generation guard', () => {
  it('busy makes the editor readonly and disables ✕ / ✓', async () => {
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(editor()!.readOnly).toBe(true);
    expect(btn('check')!.disabled).toBe(true);
    expect(btn('close')!.disabled).toBe(true);
    d.resolve();
    await settle();
    expect(editor()).toBeNull();
  });

  it('Enter / Escape / ✓ / ✕ while busy are ignored; Escape still does not propagate', async () => {
    const d = deferred();
    const props = render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    key('Enter');
    await settle();
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const enter = key('Enter');
    expect(enter.ev.defaultPrevented).toBe(true);
    const esc = key('Escape');
    expect(esc.ev.defaultPrevented).toBe(true);
    expect(esc.stop).toHaveBeenCalled();
    btn('check')!.click();
    btn('close')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(editor()).not.toBeNull();
    d.resolve();
    await settle();
  });

  it('discard during an in-flight commit: a late success does nothing, and reopening is writable', async () => {
    const reg = createDirtyRegistry();
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) }, reg);
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    reg.discardAll();
    flushSync();
    expect(editor()).toBeNull();
    d.resolve();
    await settle();
    expect(err()).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(btn('pencil'));
    await open();
    expect(editor()!.readOnly).toBe(false);
  });

  it('discard during an in-flight commit: the pencil stays disabled until it settles, then reopens on the refreshed value', async () => {
    // Reopening mid-flight would seed the draft from the pre-save value; once the
    // panel refreshed, a ✓ would PATCH that stale value back (silent revert).
    const reg = createDirtyRegistry();
    const d = deferred();
    const props = render({ onCommit: vi.fn(() => d.promise) }, reg);
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    reg.discardAll();
    flushSync();
    expect(btn('pencil')!.disabled).toBe(true);
    props.value = 'New'; // the panel's post-PATCH reload
    d.resolve();
    await settle();
    expect(btn('pencil')!.disabled).toBe(false);
    await open();
    expect(editor()!.value).toBe('New');
    expect(reg.isAnyDirty()).toBe(false);
  });

  it('discard during an in-flight commit: a late failure toasts once, no inline error, no focus', async () => {
    const reg = createDirtyRegistry();
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) }, reg);
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    reg.discardAll();
    flushSync();
    d.reject(new ApiError(400, 'Nope'));
    await settle();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('Nope', 'error');
    expect(editor()).toBeNull();
    expect(err()).toBeNull();
  });

  it('a late failure after unmount still toasts', async () => {
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    unmount(cmp!); cmp = null;
    d.reject(new ApiError(400, 'Gone'));
    await settle();
    expect(toastMock).toHaveBeenCalledWith('Gone', 'error');
  });
});

describe('InlineField — read-only flip', () => {
  it('closes a dirty open field, toasts once, and parks focus on the row', async () => {
    const props = render();
    await open();
    type('Draft');
    props.disabledReason = 'Only a created version can change its info';
    flushSync();
    await settle();
    expect(editor()).toBeNull();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('Editing closed — this version is no longer editable', 'info');
    expect(document.activeElement).toBe(host.querySelector('.inline-field'));
    expect(btn('pencil')!.disabled).toBe(true);
  });

  it('a clean open field closes without a toast', async () => {
    const props = render();
    await open();
    props.disabledReason = 'Enable the version first';
    flushSync();
    await settle();
    expect(editor()).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('does not steal focus when focus was outside the field', async () => {
    const props = render();
    await open();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    props.disabledReason = 'Enable the version first';
    flushSync();
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('while busy: closes immediately, no "Editing closed"; late success → no toast', async () => {
    const d = deferred();
    const props = render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    props.disabledReason = 'Only a created version can change its info';
    flushSync();
    expect(editor()).toBeNull();
    d.resolve();
    await settle();
    expect(toastMock).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it('while busy: late failure → exactly one error toast, no inline error', async () => {
    const d = deferred();
    const props = render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    props.disabledReason = 'Only a created version can change its info';
    flushSync();
    d.reject(new ApiError(409, 'Version was published'));
    await settle();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('Version was published', 'error');
    expect(err()).toBeNull();
  });
});

describe('InlineField — dirty registry', () => {
  it('is dirty only while open and changed', async () => {
    const reg = createDirtyRegistry();
    render({}, reg);
    expect(reg.isAnyDirty()).toBe(false);
    await open();
    expect(reg.isAnyDirty()).toBe(false);
    type('Changed');
    expect(reg.isAnyDirty()).toBe(true);
    type('Old');
    expect(reg.isAnyDirty()).toBe(false);
    type('Changed');
    btn('close')!.click();
    await settle();
    expect(reg.isAnyDirty()).toBe(false);
  });

  it('a number field opened and left unchanged is not dirty', async () => {
    const reg = createDirtyRegistry();
    render({ kind: 'number', value: 3 }, reg);
    await open();
    expect(editor()!.value).toBe('3');
    expect(reg.isAnyDirty()).toBe(false);
  });

  it('discardAll() closes the field without moving focus', async () => {
    const reg = createDirtyRegistry();
    render({}, reg);
    await open();
    type('Changed');
    reg.discardAll();
    flushSync();
    expect(editor()).toBeNull();
    expect(reg.isAnyDirty()).toBe(false);
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('Old');
  });

  it('mounts and commits with no registry in context', async () => {
    const props = render();
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith('New');
  });
});
