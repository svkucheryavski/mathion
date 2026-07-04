import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SubmissionThreadEntry from '../components/runs/SubmissionThreadEntry.svelte';
import type { ThreadSubmission } from '../lib/dashboards';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

function makeSubmission(overrides: Partial<ThreadSubmission> = {}): ThreadSubmission {
  return {
    id: 42, submission_number: 3, submitted_at: '2026-06-01T10:00:00Z',
    submitted_by: { user_id: 5, full_name: 'Alice' },
    is_late: false, is_resubmission: false, file_size: 2048,
    evaluation: {
      id: 11, evaluated_at: '2026-06-02T09:00:00Z',
      evaluated_by: { user_id: 3, full_name: 'Prof' },
      result: 'accepted', score: 90, feedback_text: 'Good', has_feedback_file: true,
    },
    ...overrides,
  };
}

function mountEntry(submission: ThreadSubmission, expanded: boolean, onToggle = () => {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(SubmissionThreadEntry, { target: host, props: { submission, expanded, onToggle } });
  flushSync();
  return host;
}

describe('SubmissionThreadEntry', () => {
  it('collapsed: shows summary + badge, hides submission/evaluation detail', () => {
    mountEntry(makeSubmission(), false);
    const toggle = host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).toContain('Submission 3');
    expect(host.textContent).toContain('Accepted'); // StatusBadge label for accepted
    expect(host.querySelector('a.download-link')).toBeNull();
  });

  it('expanded: shows submission block, evaluation, both download links', () => {
    mountEntry(makeSubmission(), true);
    const toggle = host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('File size:');
    expect(host.textContent).toContain('Result: accepted');
    const links = Array.from(host.querySelectorAll('a.download-link')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/api/submissions/42/file');
    expect(links).toContain('/api/evaluations/11/feedback-file');
  });

  it('expanded + null evaluation: shows "Awaiting evaluation" and awaiting badge', () => {
    mountEntry(makeSubmission({ evaluation: null }), true);
    expect(host.textContent).toContain('Awaiting evaluation');
    const badge = host.querySelector('.status-badge') as HTMLElement;
    expect(badge.getAttribute('data-status')).toBe('awaiting_eval');
  });

  it('expanded + is_resubmission: shows auto-accept banner', () => {
    mountEntry(makeSubmission({ is_resubmission: true }), true);
    expect(host.textContent).toContain('Auto-accepted on resubmission');
  });

  it('clicking the summary calls onToggle', () => {
    let toggled = 0;
    mountEntry(makeSubmission(), false, () => { toggled += 1; });
    (host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement).click();
    flushSync();
    expect(toggled).toBe(1);
  });
});
