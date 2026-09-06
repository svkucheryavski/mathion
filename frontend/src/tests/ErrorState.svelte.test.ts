import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet, type ComponentProps } from 'svelte';
import ErrorState from '../components/ui/ErrorState.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  // Untyped bag + cast, the repo idiom (Button.svelte.test.ts): it satisfies
  // mount()'s required `title` prop without type-checking the variant-bound
  // props at each call site — the deliberately-wrong combinations below (page +
  // onretry, inline + action) are the point of the last test.
  component = mount(ErrorState, { target: host, props: props as ComponentProps<typeof ErrorState> });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

const action = createRawSnippet(() => ({
  render: () => '<button type="button" class="probe">Back</button>',
}));

describe('ErrorState (Slice-4 §1.3)', () => {
  it('defaults to the inline variant: role=alert, <p> title, message, no Retry without onretry', () => {
    const el = render({ title: "Couldn't load", message: 'Server said no.' });
    const root = el.querySelector('.error-state');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('role')).toBe('alert');
    expect(root!.classList.contains('inline')).toBe(true);
    expect(root!.classList.contains('page')).toBe(false);
    const title = root!.querySelector('.title');
    expect(title!.tagName).toBe('P');
    expect(title!.textContent).toBe("Couldn't load");
    expect(root!.querySelector('.message')!.textContent).toBe('Server said no.');
    expect(root!.querySelector('.btn')).toBeNull();
  });

  it('omits the message element when no message is given', () => {
    const el = render({ title: 'Sequence not found' });
    expect(el.querySelector('.message')).toBeNull();
    expect(el.querySelector('.title')!.textContent).toBe('Sequence not found');
  });

  it('inline + onretry renders a secondary Retry button that calls it', () => {
    const onretry = vi.fn();
    const el = render({ title: 'x', onretry });
    const btn = el.querySelector<HTMLButtonElement>('.error-state.inline .btn');
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains('secondary')).toBe(true);
    expect(btn!.textContent?.trim()).toBe('Retry');
    // Sibling of .body, not inside it — that layout is what gives `.inline .body { flex: 1 }` something to do.
    expect(btn!.parentElement).toBe(el.querySelector('.error-state'));
    btn!.click();
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  it('page variant: <h1> title (D9), message, action snippet rendered inside .action', () => {
    const el = render({ variant: 'page', title: 'Course not available', message: 'Ask your teacher.', action });
    const root = el.querySelector('.error-state.page');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('role')).toBe('alert');
    const title = root!.querySelector('.title');
    expect(title!.tagName).toBe('H1');
    expect(title!.textContent).toBe('Course not available');
    expect(root!.querySelector('.message')!.textContent).toBe('Ask your teacher.');
    expect(root!.querySelector('.action .probe')).not.toBeNull();
    // .action is a sibling of .body under the card root, not nested inside it.
    expect(el.querySelector('.action')!.parentElement).toBe(root);
  });

  it('page variant ignores onretry; inline variant ignores action (variant-bound props, D2)', () => {
    const onretry = vi.fn();
    const page = render({ variant: 'page', title: 'x', onretry });
    expect(page.querySelector('.btn')).toBeNull();
    unmount(component!); component = null; host.remove();

    const inline = render({ title: 'x', action });
    expect(inline.querySelector('.action')).toBeNull();
    expect(inline.querySelector('.probe')).toBeNull();
  });
});
