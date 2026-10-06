import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DirtyGuard from '../components/editor/DirtyGuard.svelte';
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(isDirty: () => boolean, onDiscard: () => void) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(DirtyGuard, { target: host, props: { isDirty, onDiscard } });
  flushSync();
}

afterEach(async () => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
  __resetGuardsForTests();
  vi.restoreAllMocks();
  await navigate('/', { force: true });
});

describe('DirtyGuard — onDiscard (Slice-5a D3)', () => {
  it('calls onDiscard after the user confirms the prompt', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDiscard = vi.fn();
    render(() => true, onDiscard);
    await navigate('/somewhere');
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/somewhere');
  });

  it('does not call onDiscard when the user cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDiscard = vi.fn();
    render(() => true, onDiscard);
    await navigate('/elsewhere');
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).not.toBe('/elsewhere');
  });

  it('does not prompt or discard when nothing is dirty', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const onDiscard = vi.fn();
    render(() => false, onDiscard);
    await navigate('/clean');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('beforeunload warns but never discards', () => {
    const onDiscard = vi.fn();
    render(() => true, onDiscard);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
