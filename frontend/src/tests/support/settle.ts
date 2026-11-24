// One shared wait for tests: a macrotask instead of a counted number of microtask turns.
import { flushSync } from 'svelte';
import { vi } from 'vitest';

/** Let pending promise chains finish (one macrotask; under fake timers only 0 ms timers run), then flush Svelte. */
export async function settle(): Promise<void> {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync();
}

/** Wait a task at a time until `done()` holds; throws after `tasks` tasks.
 *  Under fake timers it never moves the clock, so nested 0 ms timers (due 1 ms later) do not run. */
export async function until(done: () => boolean, tasks = 60): Promise<void> {
  for (let i = 0; i < tasks; i++) {
    flushSync();
    if (done()) return;
    await settle();
  }
  if (!done()) throw new Error('until: the condition was not reached');
}
