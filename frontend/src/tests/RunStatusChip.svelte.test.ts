import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunStatusChip from '../components/runs/RunStatusChip.svelte';
import type { RunStatus } from '../lib/runStatus';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

const CASES: [RunStatus, string][] = [
  ['active', 'active'], ['upcoming', 'upcoming'], ['ended', 'finished'], ['draft', 'draft'],
];

describe('RunStatusChip (spec §Run status chip)', () => {
  for (const [status, label] of CASES) {
    it(`${status} reads "${label}" and carries its class`, () => {
      host = document.createElement('div');
      document.body.appendChild(host);
      component = mount(RunStatusChip, { target: host, props: { status } });
      flushSync();
      const el = host.querySelector('.run-chip') as HTMLElement;
      expect(el.textContent).toBe(label);
      expect(el.getAttribute('data-status')).toBe(status);
      expect(el.classList.contains(`run-chip-${status}`)).toBe(true);
    });
  }
});
