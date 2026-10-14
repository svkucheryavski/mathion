import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet, type ComponentProps } from 'svelte';
import InlineConfirm from '../components/ui/InlineConfirm.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

function render(props: Partial<ComponentProps<typeof InlineConfirm>> = {}) {
  component = mount(InlineConfirm, {
    target,
    props: { confirmLabel: 'Delete', onConfirm: () => {}, ...props } as ComponentProps<typeof InlineConfirm>,
  });
  flushSync();
  const [confirm, cancel] = Array.from(target.querySelectorAll('button')) as HTMLButtonElement[];
  return { confirm: confirm!, cancel: cancel!, group: target.querySelector('.inline-confirm') as HTMLElement };
}

const esc = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

describe('InlineConfirm', () => {
  it('renders the confirm label, then Cancel', () => {
    const { confirm, cancel } = render();
    expect(confirm.textContent?.trim()).toBe('Delete');
    expect(cancel.textContent?.trim()).toBe('Cancel');
  });

  it('renders warning above the pair when provided', () => {
    render({ warning: 'Students lose access.' });
    expect(target.querySelector('.warning')?.textContent).toBe('Students lose access.');
  });

  it('Confirm click invokes onConfirm', () => {
    const onConfirm = vi.fn();
    render({ onConfirm }).confirm.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Cancel click invokes onCancel (when provided) and does NOT invoke onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render({ onConfirm, onCancel }).cancel.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cancel click without onCancel prop is a no-op (no throw)', () => {
    const { cancel } = render();
    expect(() => cancel.click()).not.toThrow();
  });

  it('confirmDataAction is reflected on the confirm button when provided', () => {
    expect(render({ confirmDataAction: 'confirm-delete-item' }).confirm.getAttribute('data-action')).toBe('confirm-delete-item');
  });

  it('takeFocus: Cancel takes focus on mount (6a P3)', () => {
    const { cancel } = render({ onCancel: () => {}, takeFocus: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('takeFocus: the group scrolls into view before Cancel takes focus (Polish 1)', () => {
    const calls: string[] = [];
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: (o?: unknown) => void };
    const had = 'scrollIntoView' in proto;
    proto.scrollIntoView = function (this: HTMLElement, o?: unknown) {
      calls.push(`${this.className.split(' ')[0]} ${JSON.stringify(o)}`);
    };
    try {
      render({ takeFocus: true });
      expect(calls).toEqual(['inline-confirm {"block":"nearest"}']);
    } finally {
      if (!had) delete proto.scrollIntoView;
    }
  });

  it('takeFocus: Esc on either button cancels', () => {
    const onCancel = vi.fn();
    const { confirm, cancel } = render({ onCancel, takeFocus: true });
    cancel.dispatchEvent(esc());
    confirm.dispatchEvent(esc());
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('without takeFocus: focus is untouched and Esc is ignored', () => {
    const onCancel = vi.fn();
    const before = document.activeElement;
    const { cancel } = render({ onCancel });
    expect(document.activeElement).toBe(before);
    cancel.dispatchEvent(esc());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('is a group named by its warning, so a screen reader says what Cancel cancels (final review)', () => {
    const { group } = render({ warning: 'Delete this asset?', takeFocus: true });
    expect(group.getAttribute('role')).toBe('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('Delete this asset?');
  });

  it('a label names the group when there is no warning (final review)', () => {
    const { group } = render({ label: 'Delete Alpha?' });
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Delete Alpha?');
  });

  it('with a label and a warning, the warning describes the group and both buttons (Polish 1)', () => {
    const { group, confirm, cancel } = render({ label: 'Replace doc.pdf?', warning: 'The content is overwritten.' });
    const id = target.querySelector('.warning')!.id;
    expect(id).not.toBe('');
    expect(group.getAttribute('aria-label')).toBe('Replace doc.pdf?');
    expect(group.hasAttribute('aria-labelledby')).toBe(false);
    expect(group.getAttribute('aria-describedby')).toBe(id);
    expect(confirm.getAttribute('aria-describedby')).toBe(id);
    expect(cancel.getAttribute('aria-describedby')).toBe(id);
  });

  it('without a label, the buttons carry no aria-describedby (the warning already names the group)', () => {
    const { confirm, cancel } = render({ warning: 'Delete this asset?' });
    expect(confirm.hasAttribute('aria-describedby')).toBe(false);
    expect(cancel.hasAttribute('aria-describedby')).toBe(false);
  });

  it('with neither, it is no group', () => {
    expect(render().group.hasAttribute('role')).toBe(false);
  });

  it('a message snippet renders in the .warning slot with its markup and names the group (R52)', () => {
    const message = createRawSnippet(() => ({
      render: () => '<span><strong>Change the answer key?</strong> Scores keep the old key.</span>',
    }));
    const { group } = render({ message, confirmLabel: 'Change key', tone: 'primary' });
    const warn = target.querySelector('.warning')!;
    expect(warn.querySelector('strong')?.textContent).toBe('Change the answer key?');
    expect(group.getAttribute('aria-labelledby')).toBe(warn.id);
  });

  it('`row` lays the question and the two buttons out on one line (Safari pass)', () => {
    expect(render({ warning: 'Delete this asset?', row: true }).group.classList.contains('row')).toBe(true);
  });

  it('without `row` or `layout` it stays stacked', () => {
    expect(render({ warning: 'Delete this asset?' }).group.classList.contains('row')).toBe(false);
  });

  it('layout="row" is the same as `row`; layout="column" wins over `row`', () => {
    expect(render({ warning: 'x', layout: 'row' }).group.classList.contains('row')).toBe(true);
    unmount(component!);
    component = null;
    expect(render({ warning: 'x', layout: 'column', row: true }).group.classList.contains('row')).toBe(false);
  });

  it('align="end" puts the question at the end of its line, under the row\'s actions (D42); start by default', () => {
    expect(render({ warning: 'x', row: true, align: 'end' }).group.classList.contains('end')).toBe(true);
    unmount(component!);
    component = null;
    expect(render({ warning: 'x', row: true }).group.classList.contains('end')).toBe(false);
  });

  it('tone: the confirm carries danger by default and primary on request; both buttons are ic-btn', () => {
    const { confirm, cancel } = render();
    expect(confirm.classList.contains('danger')).toBe(true);
    expect(confirm.classList.contains('ic-btn')).toBe(true);
    expect(cancel.classList.contains('ic-btn')).toBe(true);
    unmount(component!);
    component = null;
    const p = render({ tone: 'primary', confirmLabel: 'Publish' });
    expect(p.confirm.classList.contains('primary')).toBe(true);
    expect(p.confirm.classList.contains('danger')).toBe(false);
  });

  it('busy: both buttons are aria-disabled with the reason, the confirm is aria-busy with a spinner, and nothing acts (R54)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { confirm, cancel } = render({ onConfirm, onCancel, takeFocus: true, busy: true });
    for (const b of [confirm, cancel]) {
      expect(b.disabled).toBe(false);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('title')).toBe('Wait for the request to finish');
    }
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(cancel.hasAttribute('aria-busy')).toBe(false);
    expect(confirm.querySelector('.spinner')).not.toBeNull();
    confirm.click();
    cancel.click();
    const e = esc();
    cancel.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('idle: no aria-disabled, no aria-busy, no spinner, no title', () => {
    const { confirm, cancel } = render();
    for (const b of [confirm, cancel]) {
      expect(b.hasAttribute('aria-disabled')).toBe(false);
      expect(b.hasAttribute('title')).toBe(false);
    }
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
    expect(confirm.querySelector('.spinner')).toBeNull();
  });

  it('R50: a pointer click within 400 ms of opening is ignored; keyboard / el.click() (detail 0) is not', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { confirm, cancel } = render({ onConfirm, onCancel });
    now.mockReturnValue(1200);
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    confirm.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1401);
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
