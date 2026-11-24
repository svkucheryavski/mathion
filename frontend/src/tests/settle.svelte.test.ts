import { afterEach, describe, expect, it, vi } from 'vitest';
import { settle, until } from './support/settle';

const reply = () => new Response(JSON.stringify({ n: 3 }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('settle', () => {
  it('waits for a stubbed fetch json', async () => {
    vi.stubGlobal('fetch', async () => reply());
    const box = $state({ n: 0 });
    void fetch('/x').then((r) => r.json()).then((d: { n: number }) => { box.n = d.n; });
    await settle();
    expect(box.n).toBe(3);
  });

  it('waits for a stubbed fetch json under fake timers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => reply());
    const box = $state({ n: 0 });
    void fetch('/x').then((r) => r.json()).then((d: { n: number }) => { box.n = d.n; });
    await settle();
    expect(box.n).toBe(3);
  });

  it('under fake timers runs a 0 ms timer but no later one', async () => {
    vi.useFakeTimers();
    let soon = false;
    let later = false;
    setTimeout(() => { soon = true; }, 0);
    setTimeout(() => { later = true; }, 300);
    await settle();
    expect(soon).toBe(true);
    expect(later).toBe(false);
  });

  it('until waits task by task for a state, and throws if it never comes', async () => {
    let n = 0;
    const step = () => { n += 1; if (n < 5) setTimeout(step, 0); };
    setTimeout(step, 0);
    await until(() => n === 5);
    expect(n).toBe(5);
    await expect(until(() => false, 3)).rejects.toThrow('until: the condition was not reached');
  });

  it('until under fake timers waits for a promise chain and never moves the clock', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => reply());
    let n = 0;
    let later = false;
    setTimeout(() => { later = true; }, 300);
    void fetch('/x').then((r) => r.json()).then((d: { n: number }) => { n = d.n; });
    await until(() => n === 3);
    expect(later).toBe(false);
  });
});
