import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NewItemModal from '../components/editor/NewItemModal.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { ApiError } from '../lib/api';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let registry: DirtyRegistry;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); document.documentElement.style.overflow = ''; vi.restoreAllMocks(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  registry = createDirtyRegistry();
  const props = { blockTitle: 'Vectors', seqTitle: 'Linear combinations', position: 3,
    onCreate: vi.fn(() => Promise.resolve()), onClose: vi.fn(), ...over };
  cmp = mount(NewItemModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const titleIn = () => panel().querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
const radio = (v: string) => panel().querySelector<HTMLInputElement>(`input[type="radio"][value="${v}"]`)!;
const create = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Create')!;
function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
function pick(v: string) { radio(v).checked = true; radio(v).dispatchEvent(new Event('change', { bubbles: true })); flushSync(); }

describe('NewItemModal (Slice-5c T4, D10)', () => {
  it('header names the path and the position; Title is focused; Page is the default', async () => {
    render(); await settle();
    expect(panel().querySelector('.ctx')!.textContent).toBe('Vectors › Linear combinations · will be item 3 of 3');
    expect(document.activeElement).toBe(titleIn());
    expect(radio('static_page').checked).toBe(true);
  });
  it('Page asks only for the title (content is written after creation), Video for a URL, Quiz and App for nothing more', () => {
    render();
    type(titleIn(), 'Dot product');
    expect(panel().querySelector('textarea')).toBeNull();
    expect(panel().querySelectorAll('input:not([type="radio"]), textarea').length).toBe(1);
    pick('video');
    expect(panel().querySelector('input[aria-label="Video URL"]')).not.toBeNull();
    expect(panel().querySelector('textarea')).toBeNull();
    pick('quiz');
    expect(panel().querySelector('input[aria-label="Video URL"]')).toBeNull();
    pick('interactive_app');
    expect(panel().querySelectorAll('input:not([type="radio"]), textarea').length).toBe(1);
  });
  it('Create is disabled until the required fields are filled', () => {
    render();
    pick('video');
    type(titleIn(), 'Clip');
    expect(create().disabled).toBe(true);
    type(panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!, 'https://youtu.be/x');
    expect(create().disabled).toBe(false);
  });
  it('Video: Create stays disabled until the URL starts with http(s):// (spec D10)', () => {
    render();
    pick('video');
    type(titleIn(), 'Clip');
    const url = panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!;
    type(url, 'youtu.be/x');
    expect(create().disabled).toBe(true);
    type(url, 'HTTP://youtu.be/x');
    expect(create().disabled).toBe(false);
  });
  it('Create sends exactly the body the backend expects per type', async () => {
    const p = render();
    pick('quiz'); type(titleIn(), 'Test me');
    create().click(); await settle();
    expect(p.onCreate).toHaveBeenCalledWith({ title: 'Test me', type: 'quiz' });
  });
  it('Page sends a "# Title" starter content (the backend requires content_md); Video its URL', async () => {
    const p = render();
    type(titleIn(), '  Dot ');
    create().click(); await settle();
    expect(p.onCreate).toHaveBeenLastCalledWith({ title: '  Dot ', type: 'static_page', content_md: '# Dot\n' });
    type(titleIn(), 'Dot');
    create().click(); await settle();
    expect(p.onCreate).toHaveBeenLastCalledWith({ title: 'Dot', type: 'static_page', content_md: '# Dot\n' });
    pick('video');
    type(panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!, 'https://youtu.be/x');
    create().click(); await settle();
    expect(p.onCreate).toHaveBeenLastCalledWith({ title: 'Dot', type: 'video', video_url: 'https://youtu.be/x' });
  });
  it('Enter in Title submits', async () => {
    const p = render();
    pick('quiz'); type(titleIn(), 'Q');
    titleIn().form!.requestSubmit(); await settle();
    expect(p.onCreate).toHaveBeenCalledTimes(1);
  });
  it('a 422 maps onto the field; the modal stays open', async () => {
    const err = new ApiError(422, [{ loc: ['body', 'title'], msg: 'Too long', type: 'x' }]);
    const p = render({ onCreate: vi.fn(() => Promise.reject(err)) });
    pick('quiz'); type(titleIn(), 'Q');
    create().click(); await settle();
    // On the Title field itself (its <small>, wired by aria-describedby), not the alert line.
    expect(titleIn().getAttribute('aria-invalid')).toBe('true');
    const err_ = document.getElementById(titleIn().getAttribute('aria-describedby')!)!;
    expect(err_.tagName).toBe('SMALL');
    expect(err_.textContent).toContain('Too long');
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    expect(p.onClose).not.toHaveBeenCalled();
  });
  it('a 422 on a field the modal does not show (content_md, type) surfaces as the alert, never silently', async () => {
    const err = new ApiError(422, [{ loc: ['body', 'content_md'], msg: 'Content too large', type: 'x' },
      { loc: ['body', 'type'], msg: 'Bad type', type: 'x' }]);
    render({ onCreate: vi.fn(() => Promise.reject(err)) });
    type(titleIn(), 'Dot');
    create().click(); await settle();
    const alert = panel().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Content too large');
    expect(alert?.textContent).toContain('Bad type');
  });
  it('close with typed input asks in place of the footer buttons (#11); Cancel goes back to the control that asked', async () => {
    const p = render();
    await settle();   // the mount's autofocus lands first, as it does on screen
    type(titleIn(), 'half');
    const row = () => panel().querySelector('footer.modal-foot .inline-confirm');
    const footCancel = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')]
      .find((b) => b.textContent!.trim() === 'Cancel' && !b.closest('.inline-confirm'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(row()!.querySelector('.warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
    expect(document.activeElement).toBe(row()!.querySelector('button.cancel'));
    (row()!.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));   // Esc counts as ×
    footCancel()!.click();
    flushSync();
    (row()!.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(footCancel());
    footCancel()!.click();
    flushSync();
    (row()!.querySelector('button.confirm') as HTMLButtonElement).click();
    await settle();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('close with nothing typed closes at once', () => {
    const p = render();
    panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('typed input is guard-dirty; discardAll closes the modal (browser Back)', () => {
    const p = render();
    type(titleIn(), 'half');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  // F4 (C7 point 1): Create stays focusable while busy, so a failure leaves focus on it.
  it('a failed Create keeps focus on Create', async () => {
    let fail!: () => void;
    render({ onCreate: vi.fn(() => new Promise<void>((_, rej) => { fail = () => rej(new ApiError(500, 'boom')); })) });
    await settle();   // the open's autofocus lands first
    pick('quiz'); type(titleIn(), 'Q');
    const btn = create();
    btn.focus();
    btn.click(); await settle();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(btn);
    fail(); await settle();
    expect(create()).toBe(btn);
    expect(document.activeElement).toBe(btn);
  });
  it('a failed Create repairs a focus the browser dropped during the request (review r1)', async () => {
    let fail!: () => void;
    render({ onCreate: vi.fn(() => new Promise<void>((_, rej) => { fail = () => rej(new ApiError(500, 'boom')); })) });
    await settle();
    pick('quiz'); type(titleIn(), 'Q');
    create().click(); await settle();
    // Cancel is natively disabled while busy: a Safari focus there drops.
    const stand = document.createElement('button');
    panel().append(stand); stand.focus(); stand.remove();
    fail(); await settle();
    expect(document.activeElement).toBe(create());
  });
  it('a 409 moves focus to the title field', async () => {
    render({ onCreate: vi.fn(() => Promise.reject(new ApiError(409, 'Title already taken'))) });
    await settle();   // the open's autofocus lands first
    pick('quiz'); type(titleIn(), 'Q');
    create().focus();
    create().click(); await settle();
    expect(titleIn().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(titleIn());
  });
  it('while creating: × and Escape are frozen', async () => {
    let release!: () => void;
    const p = render({ onCreate: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    pick('quiz'); type(titleIn(), 'Q');
    create().click(); await settle();
    expect(panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.disabled).toBe(true);
    release(); await settle();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});
