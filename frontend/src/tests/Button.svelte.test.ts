import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import Button from '../components/ui/Button.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  // Pass the props through an untyped bag so the widened `variant` union is not
  // type-checked at the `render(...)` call sites (the RED gate is the runtime
  // `data-variant` assertion, not a compile error). The cast only satisfies
  // mount()'s required `children` prop — it does not re-type-check `variant`.
  component = mount(Button, { target: host, props: props as ComponentProps<typeof Button> });
  flushSync();
  return host.querySelector('button') as HTMLButtonElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

describe('Button', () => {
  for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'danger-off'] as const) {
    it(`marks the ${variant} variant via data-variant + class`, () => {
      const btn = render({ variant });
      // data-variant is the RED-first guard: the current component renders
      // `class="btn {variant}"` (any string passes classList.contains), so it
      // does NOT set data-variant — this assertion fails until the rewrite adds it.
      expect(btn.getAttribute('data-variant')).toBe(variant);
      expect(btn.classList.contains('btn')).toBe(true);
      expect(btn.classList.contains(variant)).toBe(true);
    });
  }

  it('keeps disabled + title (token-based disabled, verified visually not here)', () => {
    // jsdom does not compute stylesheet styles, so the opacity→token swap is a
    // manual/visual check; this only guards the disabled attr + tooltip.
    const btn = render({ disabled: true, title: 'nope' });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('nope');
  });

  it('fires onclick when enabled', () => {
    const onclick = vi.fn();
    const btn = render({ onclick });
    btn.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('defaults to the primary variant', () => {
    const btn = render({});
    expect(btn.getAttribute('data-variant')).toBe('primary');
  });

  it('keeps the danger-off treatment when also natively disabled', () => {
    // The disabled Force-delete IS the danger-off state, so a disabled danger-off
    // button must NOT collapse to the generic grey disabled variant. jsdom can't
    // compute the cascade, so this guards that variant identity survives `disabled`;
    // the `.btn.danger-off:disabled` colour precedence itself is a visual check.
    const btn = render({ variant: 'danger-off', disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('data-variant')).toBe('danger-off');
  });

  // §2a full-width primary (Login "Sign in"). ONE render() per test — the helper
  // reassigns the module-level host/component, so afterEach cleans up only the last.
  it('full adds the full class', () => {
    expect(render({ full: true }).classList.contains('full')).toBe(true);
  });
  it('omits the full class by default', () => {
    expect(render({}).classList.contains('full')).toBe(false);
  });

  it('forwards data-action (6a P2)', () => {
    const btn = render({ 'data-action': 'download-csv' });
    expect(btn.getAttribute('data-action')).toBe('download-csv');
  });
  // Slice-6b R17 / P1: pass-throughs for the run modals.
  it('forwards form, so a footer button can submit a form it sits outside of', () => {
    expect(render({ type: 'submit', form: 'f1' }).getAttribute('form')).toBe('f1');
  });
  it('omits form by default', () => {
    expect(render({}).hasAttribute('form')).toBe(false);
  });
  it('marks data-autofocus when asked, so ui/Modal focuses it on open', () => {
    expect(render({ 'data-autofocus': true }).hasAttribute('data-autofocus')).toBe(true);
  });
  it('omits data-autofocus by default', () => {
    expect(render({}).hasAttribute('data-autofocus')).toBe(false);
  });
  it('forwards aria-describedby', () => {
    expect(render({ 'aria-describedby': 'sum' }).getAttribute('aria-describedby')).toBe('sum');
  });

  it('aria-disabled: not natively disabled, marked blocked, onclick still fires (R44)', () => {
    const onclick = vi.fn();
    const btn = render({ 'aria-disabled': true, title: 'Wait for the current change to save', onclick });
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.classList.contains('blocked')).toBe(true);
    btn.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });
  it('loading sets aria-busy and keeps the variant look (P23)', () => {
    const btn = render({ loading: true, 'aria-disabled': true });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.classList.contains('blocked')).toBe(false);
    expect(btn.querySelector('.spinner')).not.toBeNull();
  });
  it('omits aria-disabled and aria-busy by default', () => {
    const btn = render({});
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
  });

  it('forwards data-test (6c P48)', () => {
    expect(render({ 'data-test': 'edit-evaluation' }).getAttribute('data-test')).toBe('edit-evaluation');
  });

  it('omits data-test by default', () => {
    expect(render({}).hasAttribute('data-test')).toBe(false);
  });
});
