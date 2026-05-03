import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('lib/events', () => {
  let events: typeof import('../lib/events');

  beforeEach(async () => {
    vi.resetModules();
    events = await import('../lib/events');
  });

  it('replays a pre-wire emit when the handler wires up', () => {
    events.emitUnauthorized('/courses/foo');
    const calls: string[] = [];
    events.onUnauthorized((p) => calls.push(p));
    expect(calls).toEqual(['/courses/foo']);
  });

  it('coalesces multiple pre-wire emits to the most recent path', () => {
    events.emitUnauthorized('/first');
    events.emitUnauthorized('/second');
    events.emitUnauthorized('/third');
    const calls: string[] = [];
    events.onUnauthorized((p) => calls.push(p));
    expect(calls).toEqual(['/third']);
  });

  it('routes post-wire emits straight to the handler', () => {
    const calls: string[] = [];
    events.onUnauthorized((p) => calls.push(p));
    events.emitUnauthorized('/a');
    events.emitUnauthorized('/b');
    expect(calls).toEqual(['/a', '/b']);
  });

  it('clears the pending slot after replay so re-wiring doesnt re-fire', () => {
    events.emitUnauthorized('/once');
    const a: string[] = [];
    events.onUnauthorized((p) => a.push(p));
    expect(a).toEqual(['/once']);
    const b: string[] = [];
    events.onUnauthorized((p) => b.push(p));
    expect(b).toEqual([]);
  });
});
