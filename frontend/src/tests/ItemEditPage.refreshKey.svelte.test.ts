import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RefreshKeyHarness from './ItemEditPage.refreshKey.harness.svelte';
import * as assetsModule from '../lib/assets';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
});

describe('ItemEditPage refreshKey wiring', () => {
  it('successful save bumps refreshKey once', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({ simulateSaveResult: 'ok' as 'ok' | 'error' });
    const cmp = mount(RefreshKeyHarness, { target, props });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    const btn = target.querySelector<HTMLElement>('[data-testid="simulate-save"]')!;
    btn.click();
    flushSync();
    const out = target.querySelector('[data-testid="refresh-key-value"]')!;
    expect(out.textContent).toBe('1');
  });

  it('failed save does NOT bump refreshKey', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({ simulateSaveResult: 'error' as 'ok' | 'error' });
    const cmp = mount(RefreshKeyHarness, { target, props });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    const btn = target.querySelector<HTMLElement>('[data-testid="simulate-save"]')!;
    btn.click();
    flushSync();
    const out = target.querySelector('[data-testid="refresh-key-value"]')!;
    expect(out.textContent).toBe('0');
  });

  // Real bind:refreshKey coverage on the actual MarkdownEditor component
  // lives at MarkdownEditor.svelte.test.ts ("drop on textarea uploads +
  // inserts + bumps refreshKey"). This test exercises the SIMULATED parent
  // refresh-key pattern used by ItemEditPage via the harness's local state
  // bump — it does not mount MarkdownEditor itself.
  it('parent harness refreshKey increments propagate via simulated child writes', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({ simulateSaveResult: 'ok' as 'ok' | 'error' });
    const cmp = mount(RefreshKeyHarness, { target, props });
    cleanup = () => unmount(cmp);
    await Promise.resolve(); flushSync();
    const childBump = target.querySelector<HTMLElement>('[data-testid="child-bump"]')!;
    childBump.click();
    flushSync();
    childBump.click();
    flushSync();
    const out = target.querySelector('[data-testid="refresh-key-value"]')!;
    expect(out.textContent).toBe('2');
  });
});
