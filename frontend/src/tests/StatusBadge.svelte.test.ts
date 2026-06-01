import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

import StatusBadge from '../components/ui/StatusBadge.svelte';
import { STATUS_LABEL, STATUS_ICON, type MpGroupStatus } from '../lib/dashboards';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function mountBadge(status: MpGroupStatus) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(StatusBadge, { target: host, props: { status } });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

const ALL_STATUSES: MpGroupStatus[] = [
  'not_submitted', 'awaiting_eval', 'needs_revision', 'accepted', 'rejected',
];

describe('StatusBadge', () => {
  for (const status of ALL_STATUSES) {
    it(`renders label "${STATUS_LABEL[status]}" + icon "${STATUS_ICON[status]}" + data-status for ${status}`, () => {
      mountBadge(status);
      const badge = host.querySelector('.status-badge') as HTMLElement;
      // (a) Content
      expect(badge.textContent?.trim()).toContain(STATUS_LABEL[status]);
      expect(badge.textContent?.trim()).toContain(STATUS_ICON[status]);
      // (b) data-status attribute (spec §6.6 test list)
      expect(badge.getAttribute('data-status')).toBe(status);
      // (c) Inline style references the correct CSS variables
      const inlineStyle = badge.getAttribute('style') ?? '';
      const cssKey = status.replace(/_/g, '-');
      expect(inlineStyle).toContain(`--badge-bg: var(--status-${cssKey}-bg)`);
      expect(inlineStyle).toContain(`--badge-fg: var(--status-${cssKey}-fg)`);
    });
  }
});
