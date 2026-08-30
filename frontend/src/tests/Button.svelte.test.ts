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
});
