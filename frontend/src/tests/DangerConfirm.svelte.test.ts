import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet, type ComponentProps } from 'svelte';
import DangerConfirm from '../components/ui/DangerConfirm.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

const message = createRawSnippet(() => ({
  render: () => '<span>Deleting it will leave their <code>![ref]</code> markdown broken.</span>',
}));

function render(props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  component = mount(DangerConfirm, {
    target: host,
    props: { message, onConfirm, onCancel, ...props } as ComponentProps<typeof DangerConfirm>,
  });
  flushSync();
  const box = host.querySelector('input[data-role="danger-ack"]') as HTMLInputElement;
  const force = host.querySelector('button[data-action="force-delete"]') as HTMLButtonElement;
  const cancel = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel')!;
  return { onConfirm, onCancel, box, force, cancel };
}

function tick(box: HTMLInputElement) {
  box.click();
  flushSync();
}

async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); }

describe('DangerConfirm (handoff §4 Confirm-then-act)', () => {
  it('focus goes to the "I understand" box on open', () => {
    const { box } = render();
    expect(document.activeElement).toBe(box);
  });

  it('renders the message snippet with its markup; the group is described by it', () => {
    render();
    const group = host.querySelector('.danger-confirm') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    const msg = document.getElementById(group.getAttribute('aria-describedby')!)!;
    expect(msg.querySelector('code')?.textContent).toBe('![ref]');
  });

  it('unarmed: Force delete is aria-disabled with its title, not natively disabled, and does nothing', () => {
    const { force, onConfirm } = render();
    expect(force.textContent?.trim()).toBe('Force delete');
    expect(force.disabled).toBe(false);
    expect(force.getAttribute('aria-disabled')).toBe('true');
    expect(force.getAttribute('title')).toBe('Tick “I understand” first');
    force.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('armed: calls onConfirm once, then the box un-ticks when it settles', async () => {
    const { box, force, onConfirm } = render();
    tick(box);
    expect(force.hasAttribute('aria-disabled')).toBe(false);
    expect(force.classList.contains('armed')).toBe(true);
    force.click();
    await settle();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(box.checked).toBe(false);
  });

  it('a second click while onConfirm is in flight does not call it again', async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { box, force } = render({ onConfirm });
    tick(box);
    force.click();
    force.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolve();
    await settle();
  });

  it('the group is named by its confirm label', () => {
    render();
    expect(host.querySelector('.danger-confirm')?.getAttribute('aria-label')).toBe('Force delete');
  });

  it('a rejected onConfirm also un-ticks the box', async () => {
    const { box, force } = render({ onConfirm: vi.fn().mockRejectedValue(new Error('x')) });
    tick(box);
    force.click();
    await settle();
    expect(box.checked).toBe(false);
  });

  it('disabledReason: natively disabled with that title; the box can still be ticked', () => {
    const { box, force, onConfirm } = render({ disabledReason: 'Only a course admin can force delete.' });
    expect(force.disabled).toBe(true);
    expect(force.getAttribute('title')).toBe('Only a course admin can force delete.');
    tick(box);
    expect(box.checked).toBe(true);
    expect(force.disabled).toBe(true);
    expect(force.classList.contains('armed')).toBe(false);
    force.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('busy: Force delete and Cancel are disabled', () => {
    const { force, cancel } = render({ busy: true });
    expect(force.disabled).toBe(true);
    expect(force.getAttribute('aria-busy')).toBe('true');
    expect(cancel.disabled).toBe(true);
  });

  it('Esc inside the panel calls onCancel; Cancel does too', () => {
    const { box, cancel, onCancel } = render();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    cancel.click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('Esc while busy does nothing', () => {
    const { force, onCancel } = render({ busy: true });
    force.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('DangerConfirm after a request (R45)', () => {
  // A caller like the run's delete: busy while its request runs.
  function renderBusy() {
    host = document.createElement('div');
    document.body.appendChild(host);
    let release!: () => void;
    const props = $state({
      message,
      busy: false,
      onCancel: vi.fn(),
      onConfirm: async () => {
        props.busy = true;
        await new Promise<void>((r) => { release = r; });
        props.busy = false;
        throw new Error('failed');
      },
    });
    component = mount(DangerConfirm, { target: host, props: props as ComponentProps<typeof DangerConfirm> });
    flushSync();
    const box = host.querySelector('input[data-role="danger-ack"]') as HTMLInputElement;
    const force = host.querySelector('button[data-action="force-delete"]') as HTMLButtonElement;
    return { box, force, release: () => release() };
  }

  it('busy disabled the box and Force delete; once the request settles, focus is back on the box', async () => {
    const { box, force, release } = renderBusy();
    tick(box);
    force.focus();
    force.click();
    await settle();
    expect(force.disabled).toBe(true);
    expect(box.disabled).toBe(true);
    release();
    await settle();
    await settle();
    expect(box.checked).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it('focus the caller moved elsewhere during the request stays there', async () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    const { box, force, release } = renderBusy();
    tick(box);
    force.focus();
    force.click();
    await settle();
    other.focus();
    release();
    await settle();
    await settle();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('a caller that never sets busy (Assets) keeps focus where it was', async () => {
    const { box, force } = render({ onConfirm: vi.fn().mockRejectedValue(new Error('x')) });
    tick(box);
    force.focus();
    force.click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(force);
  });
});
