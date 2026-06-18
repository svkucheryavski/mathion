import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import StatusPill from '../components/course/StatusPill.svelte';
import type { LatestStatus } from '../lib/studentMiniProjects';

// Per the codebase memory rule: component tests use mount/unmount/flushSync
// from `svelte`, NOT @testing-library/svelte.

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) unmount(component);
  document.body.removeChild(target);
});

// Drives one render-and-introspect cycle so per-status assertions stay terse.
type Case = { status: LatestStatus; label: string; cls: string; token: string };
const CASES: Case[] = [
  { status: 'pending_group_assignment', label: 'Pending group',          cls: 'pill-neutral', token: '…' },
  { status: 'not_submitted',            label: 'Not yet submitted',      cls: 'pill-neutral', token: '·' },
  { status: 'awaiting_evaluation',      label: 'Awaiting evaluation',    cls: 'pill-info',    token: '~' },
  { status: 'rejected',                 label: 'Rejected',               cls: 'pill-danger',  token: '×' },
  { status: 'major_revision',           label: 'Needs revision (major)', cls: 'pill-warning', token: '!' },
  { status: 'minor_revision',           label: 'Needs revision (minor)', cls: 'pill-warning', token: '!' },
  { status: 'accepted',                 label: 'Accepted',               cls: 'pill-success', token: '✓' },
];

describe('StatusPill', () => {
  it.each(CASES)(
    'renders status="$status" with label "$label", class "$cls", token "$token"',
    ({ status, label, cls, token }) => {
      component = mount(StatusPill, { target, props: { status } });
      flushSync();
      const pill = target.querySelector('.pill');
      expect(pill).not.toBeNull();
      expect(pill!.classList.contains(cls)).toBe(true);
      expect(pill!.textContent).toContain(label);
      const tokenEl = pill!.querySelector('.pill-token');
      expect(tokenEl).not.toBeNull();
      expect(tokenEl!.textContent).toBe(token);
    },
  );

  it('does NOT set aria-label on the pill (D3: visible text suffices, detail page owns aria-live)', () => {
    component = mount(StatusPill, { target, props: { status: 'accepted' } });
    flushSync();
    const pill = target.querySelector('.pill');
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute('aria-label')).toBeNull();
  });

  it('marks the leading token with aria-hidden="true" (C14: non-color signal, but not double-read by AT)', () => {
    component = mount(StatusPill, { target, props: { status: 'rejected' } });
    flushSync();
    const tokenEl = target.querySelector('.pill .pill-token');
    expect(tokenEl).not.toBeNull();
    expect(tokenEl!.getAttribute('aria-hidden')).toBe('true');
  });
});
