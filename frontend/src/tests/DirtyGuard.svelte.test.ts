import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DirtyGuard from '../components/editor/DirtyGuard.svelte';
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';
import type { GuardAsk } from '../lib/askInPlace.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

// The owner's question, answered by the test: what an InPlaceAsk host hands DirtyGuard.
function fakeOwner() {
  const o = { asked: 0, dismissed: 0, focused: 0, answer: (_ok: boolean) => {} };
  const ask = (): GuardAsk => {
    o.asked++;
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    o.answer = (ok) => resolve(ok);
    return { promise, dismiss: () => { o.dismissed++; resolve(false); }, focusCancel: () => { o.focused++; } };
  };
  return { o, ask };
}

function render(isDirty: () => boolean, onDiscard: () => void, ask: () => GuardAsk) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(DirtyGuard, { target: host, props: { isDirty, onDiscard, ask } });
  flushSync();
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); };

afterEach(async () => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
  __resetGuardsForTests();
  vi.restoreAllMocks();
  await navigate('/', { force: true });
});

describe('DirtyGuard — the owner asks in place (Polish 1 D37)', () => {
  it('Discard: onDiscard runs once and the navigation goes through', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/somewhere');
    await flush();
    expect(o.asked).toBe(1);
    o.answer(true);
    await nav;
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/somewhere');
  });

  it('Cancel: nothing is discarded and the navigation is cancelled', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/elsewhere');
    await flush();
    o.answer(false);
    await nav;
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).not.toBe('/elsewhere');
  });

  it('nothing dirty: no question, no discard', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => false, onDiscard, ask);
    await navigate('/clean');
    expect(o.asked).toBe(0);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/clean');
  });

  it('R47: a second navigation while asking joins the open question — one question, focus back on its Cancel, one discard', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const a = navigate('/first');
    await flush();
    const b = navigate('/second');
    await flush();
    expect(o.asked).toBe(1);
    expect(o.focused).toBe(1);
    o.answer(true);
    await a;
    await b;
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/second');
  });

  it('R55: a forced navigate while asking withdraws the question; nothing is discarded; a later navigation asks afresh', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/asked');
    await flush();
    await navigate('/forced', { force: true });
    await flush();
    expect(o.dismissed).toBe(1);
    await nav;
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/forced');
    const again = navigate('/later');
    await flush();
    expect(o.asked).toBe(2);
    o.answer(false);
    await again;
  });

  it('R55: no withdrawal on the effect\'s first run, nor on a hash-only change', async () => {
    const { o, ask } = fakeOwner();
    render(() => true, vi.fn(), ask);
    const nav = navigate('/asked-too');
    await flush();
    expect(o.dismissed).toBe(0);
    await navigate(`${location.pathname}${location.search}#frag`);
    await flush();
    expect(o.dismissed).toBe(0);
    o.answer(false);
    await nav;
  });

  it('R55: unmounting while asking withdraws the question', async () => {
    const { o, ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const nav = navigate('/gone');
    await flush();
    unmount(component!);
    component = null;
    expect(o.dismissed).toBe(1);
    await nav;
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('beforeunload warns but never discards', () => {
    const { ask } = fakeOwner();
    const onDiscard = vi.fn();
    render(() => true, onDiscard, ask);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
