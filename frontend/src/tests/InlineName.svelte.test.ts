import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet, type ComponentProps } from 'svelte';
import InlineName from '../components/ui/InlineName.svelte';
import { ApiError } from '../lib/api';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

function render(props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  component = mount(InlineName, {
    target: host,
    props: { label: 'Group name', value: 'Group A', maxlength: 80, onSave, onCancel, ...props } as ComponentProps<typeof InlineName>,
  });
  flushSync();
  const input = host.querySelector('input.in-input') as HTMLInputElement;
  const close = host.querySelector('button[data-glyph="close"]') as HTMLButtonElement;
  const check = host.querySelector('button[data-glyph="check"]') as HTMLButtonElement;
  return { onSave, onCancel, input, close, check };
}

function type(input: HTMLInputElement, v: string) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(el: HTMLElement, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
}
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); }

describe('InlineName (handoff §4 Inline field editing)', () => {
  it('takes focus, holds the value, is named by its label', () => {
    const { input } = render();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Group A');
    expect(input.getAttribute('aria-label')).toBe('Group name');
    expect(input.getAttribute('maxlength')).toBe('80');
  });

  it('× comes before ✓', () => {
    render();
    const glyphs = Array.from(host.querySelectorAll('button')).map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['close', 'check']);
  });

  it('the aside snippet renders between the field and ×', () => {
    render({ aside: createRawSnippet(() => ({ render: () => '<span class="probe">7/10</span>' })) });
    const row = host.querySelector('.in-row') as HTMLElement;
    expect(Array.from(row.children).map((c) => c.className.split(' ')[0])).toEqual(['in-input', 'probe', 'icon-btn', 'icon-btn']);
  });

  it('Enter saves the trimmed value', async () => {
    const { input, onSave } = render();
    type(input, '  Group B  ');
    key(input, 'Enter');
    await settle();
    expect(onSave).toHaveBeenCalledWith('Group B');
  });

  it('Enter while an IME is composing does not save', async () => {
    const { input, onSave } = render();
    type(input, 'Gruppe');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    await settle();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('✓ saves too', async () => {
    const { input, check, onSave } = render();
    type(input, 'Group C');
    check.click();
    await settle();
    expect(onSave).toHaveBeenCalledWith('Group C');
  });

  it('Esc and × cancel', () => {
    const { input, close, onCancel } = render();
    key(input, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    close.click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('an unchanged value cancels without a request', async () => {
    const { input, onSave, onCancel } = render();
    type(input, ' Group A ');
    key(input, 'Enter');
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('an empty value keeps ✓ disabled and Enter does nothing', async () => {
    const { input, check, onSave, onCancel } = render();
    type(input, '   ');
    expect(check.disabled).toBe(true);
    key(input, 'Enter');
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('while saving: read-only, ✓ busy, Esc does nothing', async () => {
    let resolve!: () => void;
    const { input, check, onCancel } = render({ onSave: vi.fn(() => new Promise<void>((r) => { resolve = r; })) });
    type(input, 'Group D');
    key(input, 'Enter');
    await settle();
    expect(input.readOnly).toBe(true);
    expect(check.disabled).toBe(true);
    expect(check.getAttribute('title')).toBe('Saving…');
    key(input, 'Escape');
    expect(onCancel).not.toHaveBeenCalled();
    resolve();
    await settle();
    expect(input.readOnly).toBe(false);
  });

  it('a rejection keeps the field open with the error; typing clears it', async () => {
    const { input } = render({
      onSave: vi.fn().mockRejectedValue(new Error('A group with that name already exists in this run.')),
    });
    type(input, 'Group E');
    key(input, 'Enter');
    await settle();
    const msg = host.querySelector('p.in-err') as HTMLElement;
    expect(msg.getAttribute('role')).toBe('alert');
    expect(msg.textContent).toBe('A group with that name already exists in this run.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(msg.id);
    expect(input.value).toBe('Group E');
    expect(document.activeElement).toBe(input);
    type(input, 'Group F');
    expect(host.querySelector('p.in-err')).toBeNull();
  });

  it('an ApiError shows its displayMessage', async () => {
    const { input } = render({ onSave: vi.fn().mockRejectedValue(new ApiError(500, 'Server exploded')) });
    type(input, 'Group G');
    key(input, 'Enter');
    await settle();
    expect(host.querySelector('p.in-err')?.textContent).toBe(new ApiError(500, 'Server exploded').displayMessage);
  });
});
