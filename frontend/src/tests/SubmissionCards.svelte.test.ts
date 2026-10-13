import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './support/SubmissionCardsHarness.svelte';
import { evaluatedLine } from '../components/runs/SubmissionCards.svelte';
import type { ThreadEvaluation, ThreadSubmissionBase } from '../lib/dashboards';
import { formatLocalWithTz } from '../lib/datetime';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

function sub(o: Partial<ThreadSubmissionBase> = {}): ThreadSubmissionBase {
  return {
    id: 42, submission_number: 3, submitted_at: '2026-06-01T10:00:00Z',
    submitted_by: { user_id: 5, full_name: 'Alice' },
    is_late: false, is_resubmission: false, file_size: 2_400_000, ...o,
  };
}

function ev(o: Partial<ThreadEvaluation> = {}): ThreadEvaluation {
  return {
    id: 11, evaluated_at: '2026-06-02T09:00:00Z', evaluated_by: { user_id: 3, full_name: 'Prof' },
    result: 'minor_revision', score: 72, feedback_text: 'Line 1\nLine 2', has_feedback_file: true, ...o,
  };
}

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(Harness, { target: host, props: props as { sub: ThreadSubmissionBase } });
  flushSync();
}

const part = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const rows = (el: Element) =>
  Array.from(el.querySelectorAll('dt')).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.trim()]);

describe('SubmissionCards — submissionChips', () => {
  it('no chips for a first, on-time submission', () => {
    render({ sub: sub() });
    expect(part('chips').querySelector('.sc-chip')).toBeNull();
    expect(part('chips').textContent!.trim()).toBe('');
  });
  it('"resubmission" and "late" chips when they apply', () => {
    render({ sub: sub({ is_resubmission: true, is_late: true }) });
    const chips = Array.from(part('chips').querySelectorAll('.sc-chip')).map((c) => c.textContent);
    expect(chips).toEqual(['resubmission', 'late']);
    expect(part('chips').querySelector('.sc-late')!.textContent).toBe('late');
  });
});

describe('SubmissionCards — submissionContent', () => {
  it('rows: Submitted (local, with zone), By, Number', () => {
    render({ sub: sub() });
    expect(rows(part('sub').querySelector('[data-test="submission-content"]')!)).toEqual([
      ['Submitted', formatLocalWithTz('2026-06-01T10:00:00Z')],
      ['By', 'Alice'],
      ['Number', '3'],
    ]);
  });
  it('By falls back to the user id, then to "—"', () => {
    render({ sub: sub({ submitted_by: { user_id: 5, full_name: null } }) });
    expect(rows(part('sub'))[1]).toEqual(['By', '5']);
    unmount(component!); component = null; host.remove();
    render({ sub: sub({ submitted_by: null, submitted_at: null }) });
    expect(rows(part('sub'))[0]).toEqual(['Submitted', '—']);
    expect(rows(part('sub'))[1]).toEqual(['By', '—']);
  });
  it('the file card (D26): "Submission 3", "PDF · 2.4 MB" and a download link', () => {
    render({ sub: sub() });
    const card = part('sub').querySelector('.sc-file') as HTMLElement;
    expect(card.querySelector('.sc-file-name')!.textContent).toBe('Submission 3');
    expect(card.querySelector('.sc-file-meta')!.textContent).toBe('PDF · 2.4 MB');
    const a = card.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/api/submissions/42/file');
    expect(a.hasAttribute('download')).toBe(true);
    expect(a.getAttribute('aria-label')).toBe('Download submission 3');
  });
});

describe('SubmissionCards — evaluationContent', () => {
  it('Result is a badge with the result\'s own label; Score; pre-wrapped Feedback; Evaluated', () => {
    const e = ev();
    render({ sub: sub(), ev: e, evaluated: evaluatedLine(e) });
    const box = part('ev').querySelector('[data-test="evaluation-content"]') as HTMLElement;
    const badge = box.querySelector('.status-badge') as HTMLElement;
    expect(badge.textContent).toBe('Minor revision');
    expect(badge.getAttribute('data-status')).toBe('needs_revision');
    expect(rows(box).slice(1)).toEqual([
      ['Score', '72'],
      ['Feedback', 'Line 1\nLine 2'],
      ['Evaluated', `Prof · ${formatLocalWithTz('2026-06-02T09:00:00Z')}`],
    ]);
  });
  it('"—" for an empty score and for empty or missing feedback', () => {
    render({ sub: sub(), ev: ev({ score: null, feedback_text: '' }), evaluated: 'You · Just now' });
    expect(rows(part('ev')).slice(1)).toEqual([
      ['Score', '—'], ['Feedback', '—'], ['Evaluated', 'You · Just now'],
    ]);
  });
  it('the feedback file card only when there is a file', () => {
    render({ sub: sub(), ev: ev(), evaluated: '' });
    const card = part('ev').querySelector('.sc-file') as HTMLElement;
    expect(card.querySelector('.sc-file-name')!.textContent).toBe('Feedback file');
    expect(card.querySelector('.sc-file-meta')!.textContent).toBe('PDF');
    const a = card.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/api/evaluations/11/feedback-file');
    expect(a.getAttribute('aria-label')).toBe('Download feedback file');
    unmount(component!); component = null; host.remove();
    render({ sub: sub(), ev: ev({ has_feedback_file: false }), evaluated: '' });
    expect(part('ev').querySelector('.sc-file')).toBeNull();
  });
  it('evaluatedLine: the user id, then "—", when the name or the time is missing', () => {
    expect(evaluatedLine(ev({ evaluated_by: { user_id: 3, full_name: null }, evaluated_at: null }))).toBe('3 · —');
    expect(evaluatedLine(ev({ evaluated_by: null }))).toBe(`— · ${formatLocalWithTz('2026-06-02T09:00:00Z')}`);
  });
});
