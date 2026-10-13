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

describe('SubmissionThreadEntry (6c 9b rows)', () => {
  const toggle = () => host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement;

  it('collapsed: a disclosure row with the name, the local date and the short badge; no content', () => {
    mountEntry(makeSubmission(), false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().querySelector('.te-name')!.textContent).toBe('Submission 3');
    expect(toggle().querySelector('.te-date')!.textContent).toBe('01 Jun 2026');
    const badge = toggle().querySelector('.status-badge') as HTMLElement;
    expect(badge.textContent).toBe('accepted');
    expect(badge.getAttribute('data-status')).toBe('accepted');
    expect(host.querySelector('[data-test="submission-content"]')).toBeNull();
    expect(host.querySelector('a[download]')).toBeNull();
  });

  it('a submission at 23:30 UTC shows the viewer\'s next day (Review Focus 5)', () => {
    mountEntry(makeSubmission({ submitted_at: '2026-08-01T23:30:00Z' }), false);
    expect(toggle().querySelector('.te-date')!.textContent).toBe('02 Aug 2026');
  });

  it('expanded: the submission and evaluation content, both downloads', () => {
    mountEntry(makeSubmission(), true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-test="submission-content"]')).toBeTruthy();
    expect(host.querySelector('.sc-file-meta')!.textContent).toBe('PDF · 2.0 kB');
    expect(host.querySelector('h4')!.textContent).toBe('Evaluation');
    const ev = host.querySelector('[data-test="evaluation-content"]') as HTMLElement;
    expect(ev.querySelector('.status-badge')!.textContent).toBe('Accepted');
    const links = Array.from(host.querySelectorAll('a[download]')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/api/submissions/42/file', '/api/evaluations/11/feedback-file']);
  });

  it('expanded + null evaluation: the placeholder, no evaluation content, the awaiting badge', () => {
    mountEntry(makeSubmission({ evaluation: null }), true);
    const placeholder = host.querySelector('[data-test="awaiting-evaluation-placeholder"]');
    expect(placeholder?.textContent).toBe('Awaiting evaluation');
    expect(host.querySelector('[data-test="evaluation-content"]')).toBeNull();
    const badge = host.querySelector('.status-badge') as HTMLElement;
    expect(badge.getAttribute('data-status')).toBe('awaiting_eval');
    expect(badge.textContent).toBe('awaiting eval');
  });

  it('expanded + is_resubmission: the chip and the auto-accept line', () => {
    mountEntry(makeSubmission({ is_resubmission: true }), true);
    expect(host.querySelector('.te-chips')!.textContent).toContain('resubmission');
    expect(host.querySelector('p.te-info[role="status"]')!.textContent)
      .toBe('Auto-accepted on resubmission. No manual evaluation needed.');
  });

  it('clicking the row calls onToggle', () => {
    let toggled = 0;
    mountEntry(makeSubmission(), false, () => { toggled += 1; });
    toggle().click();
    flushSync();
    expect(toggled).toBe(1);
  });
});
