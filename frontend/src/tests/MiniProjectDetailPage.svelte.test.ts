import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

// Mock the student-MP wire layer BEFORE importing the page so the page's
// import binding resolves to the mock. We re-export the real REASON_LABELS /
// LATEST_STATUS_META / rewriteExternalLinks so the page's runtime UI plumbing
// stays intact; only `fetchDetail` is replaced with a vi.fn() the tests can
// program per-scenario.
vi.mock('../lib/studentMiniProjects', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/studentMiniProjects')>();
  return {
    ...real,
    fetchDetail: vi.fn(),
  };
});

// Mock currentCourse store so `loadCourse` resolves immediately (no real
// network) and the breadcrumb stays at the placeholder for these tests —
// the D5 scope only asserts on the detail-fetch payload.
vi.mock('../stores/currentCourse.svelte', () => {
  return {
    currentCourse: { value: null },
    loadCourse: vi.fn(() => Promise.resolve()),
  };
});

import { fetchDetail } from '../lib/studentMiniProjects';
import MiniProjectDetailPage from '../pages/MiniProjectDetailPage.svelte';
import type {
  StudentMiniProjectDetail,
  StudentSubmissionHistoryEntry,
  StudentSubmissionHistoryEvaluation,
  StudentGroupSummary,
} from '../lib/types';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  vi.mocked(fetchDetail).mockReset();
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function settle() {
  for (let i = 0; i < 8; i++) await tick();
  flushSync();
}

// ---- Fixture builders ----

const ME: StudentGroupSummary['members'][number] = {
  user_id: 1,
  full_name: 'Alice Student',
  is_me: true,
};
const TEAMMATE: StudentGroupSummary['members'][number] = {
  user_id: 2,
  full_name: 'Bob Other',
  is_me: false,
};

function makeGroup(overrides: Partial<StudentGroupSummary> = {}): StudentGroupSummary {
  return {
    id: 50,
    name: 'Team Alpha',
    is_disabled: false,
    members: [ME, TEAMMATE],
    ...overrides,
  };
}

function makeEval(overrides: Partial<StudentSubmissionHistoryEvaluation> = {}): StudentSubmissionHistoryEvaluation {
  return {
    eval_id: 700,
    result: 'accepted',
    score: 88,
    feedback_text: 'Nice work.',
    has_feedback_file: false,
    evaluated_by_full_name: 'Prof Smith',
    evaluated_at: '2026-06-15T10:00:00Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<StudentSubmissionHistoryEntry> = {}): StudentSubmissionHistoryEntry {
  return {
    submission_id: 100,
    submission_number: 1,
    filename: 'project.pdf',
    submitted_by_full_name: 'Alice Student',
    submitter_is_me: true,
    submitted_at: '2026-06-10T12:00:00Z',
    file_size: 2_350_000,
    is_late: false,
    is_resubmission: false,
    evaluation: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<StudentMiniProjectDetail> = {}): StudentMiniProjectDetail {
  return {
    mp_id: 11,
    run_id: 22,
    block_id: 33,
    block_slug: 'block-y',
    block_title: 'Final Project',
    assignment_html: '<p>Write your project.</p>',
    soft_deadline: '2026-06-20T23:59:00Z',
    hard_deadline: '2026-06-30T23:59:00Z',
    resubmission_deadline: null,
    group: makeGroup(),
    submission_history: [],
    latest_status: 'not_submitted',
    can_submit: true,
    can_submit_reason_if_not: null,
    ...overrides,
  };
}

async function mountPage() {
  component = mount(MiniProjectDetailPage, {
    target,
    props: { courseSlug: 'course-x', blockSlug: 'block-y' },
  });
  await settle();
}

// ---- Spec §8 — 7 fixture-scenario tests ----

describe('MiniProjectDetailPage (D5 scope)', () => {
  it('scenario 1 — empty + grouped + can_submit=true: history absent, group renders with members, no error banner', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      submission_history: [],
      latest_status: 'not_submitted',
      can_submit: true,
    }));
    await mountPage();

    expect(target.querySelector('section.history')).toBeNull();
    const group = target.querySelector('section.group-block');
    if (!group) throw new Error('expected section.group-block to be present');
    expect(group.textContent).toContain('Team Alpha');
    expect(group.textContent).toContain('Alice Student (you)');
    expect(group.textContent).toContain('Bob Other');
    expect(target.querySelector('[data-testid="fetch-error-banner"]')).toBeNull();
    expect(target.querySelector('[data-testid="assignment-html"]')).not.toBeNull();
  });

  it('scenario 2 — pending evaluation: pill shows "Awaiting evaluation" + history has 1 entry without eval block', async () => {
    const entry = makeEntry({ submission_number: 1, evaluation: null });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      submission_history: [entry],
      latest_status: 'awaiting_evaluation',
      can_submit: false,
      can_submit_reason_if_not: 'awaiting_evaluation',
    }));
    await mountPage();

    const pill = target.querySelector('header .pill');
    if (!pill) throw new Error('expected header .pill to be present');
    expect(pill.textContent).toContain('Awaiting evaluation');

    const entries = target.querySelectorAll('section.history section.history-entry');
    expect(entries.length).toBe(1);
    // No evaluation block — heuristic: no "Evaluated:" text.
    expect(entries[0].textContent).not.toContain('Evaluated:');
  });

  it('scenario 3 — accepted: 2 submissions in DESC order (newest first) + pill "Accepted"', async () => {
    const older = makeEntry({
      submission_id: 100,
      submission_number: 1,
      submitted_at: '2026-06-05T12:00:00Z',
      evaluation: makeEval({ eval_id: 700, result: 'rejected', score: 30 }),
    });
    const newer = makeEntry({
      submission_id: 101,
      submission_number: 2,
      submitted_at: '2026-06-10T12:00:00Z',
      evaluation: makeEval({ eval_id: 701, result: 'accepted', score: 92 }),
    });
    // Backend returns DESC — newest first.
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      submission_history: [newer, older],
      latest_status: 'accepted',
      can_submit: false,
      can_submit_reason_if_not: 'already_accepted',
    }));
    await mountPage();

    const pill = target.querySelector('header .pill');
    expect(pill?.textContent).toContain('Accepted');

    const entries = target.querySelectorAll('section.history section.history-entry');
    expect(entries.length).toBe(2);
    // First rendered = newest = submission #2; second rendered = #1.
    expect(entries[0].querySelector('h3')?.textContent).toContain('Submission #2');
    expect(entries[1].querySelector('h3')?.textContent).toContain('Submission #1');
  });

  it('scenario 4 — rejected: 1 entry with eval block visible showing "Rejected" + pill "Rejected"', async () => {
    const entry = makeEntry({
      submission_number: 1,
      evaluation: makeEval({ result: 'rejected', score: 20, feedback_text: 'Needs more work.' }),
    });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      submission_history: [entry],
      latest_status: 'rejected',
      can_submit: true,
    }));
    await mountPage();

    const pill = target.querySelector('header .pill');
    expect(pill?.textContent).toContain('Rejected');

    const entries = target.querySelectorAll('section.history section.history-entry');
    expect(entries.length).toBe(1);
    expect(entries[0].textContent).toContain('Evaluated:');
    expect(entries[0].textContent).toContain('Rejected');
    expect(entries[0].textContent).toContain('Needs more work.');
  });

  it('scenario 5 — minor revision required: history shows entry + eval; pill "Needs revision (minor)"', async () => {
    const entry = makeEntry({
      submission_number: 1,
      evaluation: makeEval({ result: 'minor_revision', score: 65, feedback_text: 'Fix typos.' }),
    });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      submission_history: [entry],
      latest_status: 'minor_revision',
      can_submit: true,
      resubmission_deadline: '2026-06-25T23:59:00Z',
    }));
    await mountPage();

    const pill = target.querySelector('header .pill');
    expect(pill?.textContent).toContain('Needs revision (minor)');

    const entries = target.querySelectorAll('section.history section.history-entry');
    expect(entries.length).toBe(1);
    expect(entries[0].textContent).toContain('Evaluated:');
    expect(entries[0].textContent).toContain('Fix typos.');
  });

  it('scenario 6 — pending group assignment (D4): friendly banner renders, no member list, history absent', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      group: null,
      submission_history: [],
      latest_status: 'pending_group_assignment',
      can_submit: false,
      can_submit_reason_if_not: 'pending_group_assignment',
    }));
    await mountPage();

    const group = target.querySelector('section.group-block');
    if (!group) throw new Error('expected section.group-block to be present');
    // D4 friendly banner copy.
    expect(group.textContent).toMatch(/not yet assigned to a group/i);
    // No member list — heuristic: no "(you)" marker, no "Team Alpha".
    expect(group.textContent).not.toContain('Team Alpha');
    expect(group.textContent).not.toContain('(you)');
    // History absent.
    expect(target.querySelector('section.history')).toBeNull();
  });

  it('scenario 7 — late submission (D15): "Late" pill is a sibling of <h3>, NOT nested inside it', async () => {
    const entry = makeEntry({
      submission_number: 1,
      is_late: true,
    });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      submission_history: [entry],
      latest_status: 'awaiting_evaluation',
      // `awaiting_evaluation` mandates can_submit=false with matching reason
      // (spec §3.2 lines 358-362). Without these overrides we'd inherit
      // can_submit=true from makeDetail() — an unreachable state in
      // production that D6 tests will share.
      can_submit: false,
      can_submit_reason_if_not: 'awaiting_evaluation',
    }));
    await mountPage();

    const entryEl = target.querySelector('section.history-entry');
    if (!entryEl) throw new Error('expected section.history-entry to be present');
    // D15: pill must NOT be inside the <h3>.
    expect(entryEl.querySelector('h3 .pill')).toBeNull();
    // Pill MUST exist as a sibling within the header row.
    const headerRow = entryEl.querySelector('.history-entry-header');
    if (!headerRow) throw new Error('expected .history-entry-header to be present');
    const latePill = headerRow.querySelector('.pill');
    if (!latePill) throw new Error('expected Late .pill in header row');
    expect(latePill.textContent).toContain('Late');
  });
});
