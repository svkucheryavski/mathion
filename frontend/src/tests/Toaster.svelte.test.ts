import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Toaster from '../components/chrome/Toaster.svelte';
import { pushToast, clearToasts } from '../stores/toasts.svelte';

let host: HTMLDivElement;
let cmp: ReturnType<typeof mount>;

afterEach(() => {
  if (cmp) unmount(cmp);
  host?.remove();
  clearToasts();
});

describe('Toaster SR announcement', () => {
  // Single live region: each Toast has role="status" (polite + atomic).
  // The container is purely presentational so SRs don't see nested live
  // regions, which historically caused macOS VoiceOver to drop announcements.
  it('TT1: success toast renders with role="status"', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    cmp = mount(Toaster, { target: host });
    flushSync();
    pushToast('Evaluation saved; group notified', 'success');
    flushSync();
    const liveEl = host.querySelector('[role="status"]') as HTMLElement;
    expect(liveEl).toBeTruthy();
    expect(liveEl.textContent).toContain('Evaluation saved; group notified');
  });

  it('TT1b: error toast renders with role="alert" (assertive)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    cmp = mount(Toaster, { target: host });
    flushSync();
    pushToast('Something went wrong', 'error');
    flushSync();
    const alertEl = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alertEl).toBeTruthy();
    expect(alertEl.textContent).toContain('Something went wrong');
  });
});
