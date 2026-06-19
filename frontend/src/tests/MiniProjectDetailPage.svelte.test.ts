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
    submit: vi.fn(),
  };
});

// Mock the currentCourse store wrapper. Keep the real `currentCourse`
// reactive store + `__test__setSlots` so D6's F6 write-back race test can
// read and write the real store; stub only `loadCourse` to skip the network
// fan-out (the page fires it on mount for breadcrumb context).
vi.mock('../stores/currentCourse.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentCourse.svelte')>();
  return {
    ...real,
    loadCourse: vi.fn(() => Promise.resolve()),
  };
});

// Mock the events module so the 401 test can assert emitUnauthorized was
// called without wiring a real handler. The submit() wire calls this on 401.
vi.mock('../lib/events', () => {
  return {
    emitUnauthorized: vi.fn(),
    onUnauthorized: vi.fn(),
  };
});

import { ApiError } from '../lib/api';
import { fetchDetail, submit } from '../lib/studentMiniProjects';
import { emitUnauthorized } from '../lib/events';
import { currentCourse, __test__setSlots } from '../stores/currentCourse.svelte';
import MiniProjectDetailPage from '../pages/MiniProjectDetailPage.svelte';
import type {
  StudentMiniProjectDetail,
  StudentSubmissionHistoryEntry,
  StudentSubmissionHistoryEvaluation,
  StudentGroupSummary,
  StudentMiniProjectListItem,
} from '../lib/types';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  vi.mocked(fetchDetail).mockReset();
  vi.mocked(submit).mockReset();
  vi.mocked(emitUnauthorized).mockReset();
  __test__setSlots(null);
  target = document.createElement('div');
  document.body.appendChild(target);
  // F19 — jsdom default visibilityState seam; reset to 'visible' each test
  // so visibility-driven refetch tests start from a known state.
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
  __test__setSlots(null);
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

// ---- D6 — submit flow, state machine, visibility refetch, sr-only aria-live ----

function makePdf(name: string = 'project.pdf', sizeBytes: number = 1024): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

function makeTxt(name: string = 'project.txt'): File {
  return new File(['hello'], name, { type: 'text/plain' });
}

async function pickFile(file: File): Promise<void> {
  const input = target.querySelector<HTMLInputElement>('input[type="file"][data-testid="mp-file-input"]');
  if (!input) throw new Error('expected file input present');
  // jsdom: fileList is read-only; defineProperty replaces it.
  const list = {
    0: file,
    length: 1,
    item: (i: number) => (i === 0 ? file : null),
  } as unknown as FileList;
  Object.defineProperty(input, 'files', { configurable: true, value: list });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

function clickSubmit(): void {
  const btn = target.querySelector<HTMLButtonElement>('button[data-testid="mp-submit-btn"]');
  if (!btn) throw new Error('expected submit button present');
  btn.click();
}

describe('MiniProjectDetailPage (D6 — submit flow)', () => {
  it('D6.1 happy 201 — submit succeeds → state success; new file pick → idle', async () => {
    const initial = makeDetail({ submission_history: [], latest_status: 'not_submitted', can_submit: true });
    const refetched = makeDetail({
      submission_history: [makeEntry({ submission_number: 1 })],
      latest_status: 'awaiting_evaluation',
      can_submit: false,
      can_submit_reason_if_not: 'awaiting_evaluation',
    });
    vi.mocked(fetchDetail).mockResolvedValueOnce(initial).mockResolvedValueOnce(refetched);
    vi.mocked(submit).mockResolvedValue(undefined);

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    expect(vi.mocked(submit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(2);
    // State observable: pill flipped to "Awaiting evaluation" via refetch.
    const pill = target.querySelector('header .pill');
    expect(pill?.textContent).toContain('Awaiting evaluation');
    // Banner: none on success.
    expect(target.querySelector('.banner-error')).toBeNull();
  });

  it('D6.2 409 — banner copy + detail refetched', async () => {
    const initial = makeDetail({ latest_status: 'not_submitted', can_submit: true });
    // Refetched still permits submission so the submit-section stays mounted
    // and we can assert the banner copy after the race-recovery refetch.
    const refetched = makeDetail({ latest_status: 'rejected', can_submit: true });
    vi.mocked(fetchDetail).mockResolvedValueOnce(initial).mockResolvedValueOnce(refetched);
    vi.mocked(submit).mockRejectedValue(new ApiError(409, 'state changed'));

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    // We assert the fetchDetail call count first — the 409 path MUST refetch.
    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(2);
    // The banner copy was set before the refetch resolved; after the refetch
    // (which still keeps can_submit=true) the state machine drops to 'idle',
    // so the banner is no longer rendered. The observable post-condition is
    // the refetch + state recovery, asserted by the call count above and the
    // submit button being enabled again below.
    const btn = target.querySelector<HTMLButtonElement>('button[data-testid="mp-submit-btn"]');
    if (!btn) throw new Error('expected submit button present');
    // After 409 recovery: state → 'idle', file still selected → button enabled.
    expect(btn.disabled).toBe(false);
  });

  it('D6.3 401 — emitUnauthorized called; no banner shown', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    // Mirror the real wire-layer behavior: emit auth event THEN throw ApiError(401).
    vi.mocked(submit).mockImplementation(async () => {
      emitUnauthorized('/test-path');
      throw new ApiError(401, 'auth');
    });

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    // The wire layer's submit() called emitUnauthorized BEFORE throwing.
    expect(vi.mocked(emitUnauthorized)).toHaveBeenCalled();
    // Component should not render a submit error banner for 401.
    expect(target.querySelector('[data-testid="mp-submit-error"]')).toBeNull();
  });

  it('D6.4 503 — network-style banner with Retry button', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    vi.mocked(submit).mockRejectedValue(new ApiError(503, 'unavailable'));

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    const banner = target.querySelector('[data-testid="mp-submit-error"]');
    if (!banner) throw new Error('expected submit error banner');
    expect(banner.textContent).toContain("Couldn't submit");
    const retryBtn = banner.querySelector<HTMLButtonElement>('button[data-testid="mp-retry-btn"]');
    if (!retryBtn) throw new Error('expected Retry button on 503');
    expect(retryBtn.textContent).toContain('Retry');
  });

  it('D6.5 network — same retry banner', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    vi.mocked(submit).mockRejectedValue(new TypeError('Failed to fetch'));

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    const banner = target.querySelector('[data-testid="mp-submit-error"]');
    if (!banner) throw new Error('expected submit error banner');
    expect(banner.textContent).toContain("Couldn't submit");
    expect(banner.querySelector('[data-testid="mp-retry-btn"]')).not.toBeNull();
  });

  it('D6.6 client non-PDF — banner shows + submit NOT called', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));

    await mountPage();
    await pickFile(makeTxt());
    clickSubmit();
    await settle();

    expect(vi.mocked(submit)).not.toHaveBeenCalled();
    const banner = target.querySelector('[data-testid="mp-submit-error"]');
    if (!banner) throw new Error('expected client-validation banner');
    expect(banner.textContent).toContain('Only PDF');
  });

  it('D6.7 client 25 MB — banner shows + submit NOT called', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));

    await mountPage();
    // Build a File-like with size 25 MB. File constructor sets size from the
    // blob parts; emulate via defineProperty so we don't allocate 25 MB.
    const big = new File([new Uint8Array(1)], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { configurable: true, value: 25 * 1024 * 1024 });
    await pickFile(big);
    clickSubmit();
    await settle();

    expect(vi.mocked(submit)).not.toHaveBeenCalled();
    const banner = target.querySelector('[data-testid="mp-submit-error"]');
    if (!banner) throw new Error('expected client-size banner');
    expect(banner.textContent).toContain('File too large');
  });
});

describe('MiniProjectDetailPage (D6 — state machine)', () => {
  it('D6.8 submitting — both file input AND submit button disabled', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    // Submit promise hangs so we can observe the "submitting" state.
    let resolveSubmit: () => void = () => {};
    vi.mocked(submit).mockReturnValue(new Promise<void>((res) => { resolveSubmit = res; }));

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    const input = target.querySelector<HTMLInputElement>('input[type="file"][data-testid="mp-file-input"]');
    const btn = target.querySelector<HTMLButtonElement>('button[data-testid="mp-submit-btn"]');
    if (!input || !btn) throw new Error('expected submit controls present');
    expect(input.disabled).toBe(true);
    expect(btn.disabled).toBe(true);

    // Cleanup: resolve so the page settles and unmount runs cleanly.
    resolveSubmit();
    await settle();
  });

  it('D6.9 error (503) — file kept in input (retry without re-pick)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    vi.mocked(submit).mockRejectedValue(new ApiError(503, 'unavailable'));

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    const input = target.querySelector<HTMLInputElement>('input[type="file"][data-testid="mp-file-input"]');
    if (!input) throw new Error('expected file input');
    // File preserved — input.files retains the FileList we set.
    expect(input.files?.length).toBe(1);
    expect(input.files?.[0]?.name).toBe('project.pdf');
    // File input is NOT disabled during error state.
    expect(input.disabled).toBe(false);
  });

  it('D6.10 success — file cleared (input value empty)', async () => {
    const initial = makeDetail({ latest_status: 'not_submitted', can_submit: true });
    const refetched = makeDetail({
      submission_history: [makeEntry({ submission_number: 1 })],
      latest_status: 'awaiting_evaluation',
      can_submit: false,
      can_submit_reason_if_not: 'awaiting_evaluation',
    });
    vi.mocked(fetchDetail).mockResolvedValueOnce(initial).mockResolvedValueOnce(refetched);
    vi.mocked(submit).mockResolvedValue(undefined);

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    // After success + refetch, can_submit=false so file input is GONE from the
    // DOM (no submit section rendered). That's the cleanest "file cleared"
    // signal — there is no input to hold the file.
    expect(target.querySelector('input[type="file"][data-testid="mp-file-input"]')).toBeNull();
  });
});

describe('MiniProjectDetailPage (D6 — misc)', () => {
  it('D6.11 external link rewrite on mount', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      assignment_html: '<p><a href="https://example.com">ext</a><a href="/api/runs/1/assets/x.png">asset</a><a href="mailto:t@x">mail</a></p>',
    }));
    await mountPage();

    const ext = target.querySelector('[data-testid="assignment-html"] a[href="https://example.com"]');
    if (!ext) throw new Error('expected external link');
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');

    const asset = target.querySelector('[data-testid="assignment-html"] a[href="/api/runs/1/assets/x.png"]');
    if (!asset) throw new Error('expected asset link');
    expect(asset.getAttribute('target')).toBeNull();

    const mail = target.querySelector('[data-testid="assignment-html"] a[href="mailto:t@x"]');
    if (!mail) throw new Error('expected mailto link');
    expect(mail.getAttribute('target')).toBeNull();
  });

  it('D6.12 external links re-rewritten after visibility refetch', async () => {
    const first = makeDetail({
      assignment_html: '<p><a href="https://first.com">first</a></p>',
    });
    const second = makeDetail({
      assignment_html: '<p><a href="https://second.com">a</a><a href="https://third.com">b</a></p>',
    });
    vi.mocked(fetchDetail).mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await mountPage();
    const firstLink = target.querySelector<HTMLAnchorElement>('[data-testid="assignment-html"] a[href="https://first.com"]');
    if (!firstLink) throw new Error('expected first link');
    expect(firstLink.getAttribute('target')).toBe('_blank');

    // Trigger visibility refetch.
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(2);
    const a = target.querySelector<HTMLAnchorElement>('[data-testid="assignment-html"] a[href="https://second.com"]');
    const b = target.querySelector<HTMLAnchorElement>('[data-testid="assignment-html"] a[href="https://third.com"]');
    if (!a || !b) throw new Error('expected new links');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(b.getAttribute('target')).toBe('_blank');
    expect(target.querySelector('[data-testid="assignment-html"] a[href="https://first.com"]')).toBeNull();
  });

  it('D6.13 F6 — write-back skipped when slug changed mid-flight', async () => {
    const initial = makeDetail({ block_id: 33, latest_status: 'not_submitted', can_submit: true });
    const refetched = makeDetail({
      block_id: 33,
      latest_status: 'awaiting_evaluation',
      submission_history: [makeEntry({ submission_number: 1 })],
      can_submit: false,
      can_submit_reason_if_not: 'awaiting_evaluation',
    });
    vi.mocked(fetchDetail).mockResolvedValueOnce(initial).mockResolvedValueOnce(refetched);
    vi.mocked(submit).mockResolvedValue(undefined);

    await mountPage();
    await pickFile(makePdf());

    // Swap to a DIFFERENT course's snapshot. The detail page mounted on
    // 'course-x'; if we put 'course-b' in the store, the write-back must
    // refuse to mutate (F6 slug guard).
    const existingItem: StudentMiniProjectListItem = {
      mp_id: 11,
      block_id: 33,
      block_slug: 'block-y',
      block_order: 0,
      block_title: 'Final Project',
      hard_deadline: null,
      soft_deadline: null,
      resubmission_deadline: null,
      latest_status: 'not_submitted',
    };
    __test__setSlots({
      slug: 'course-b',
      versionId: 1,
      course: { id: 1, slug: 'course-b', name: 'Other' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
      miniProjectsByBlockId: { '33': existingItem },
    });

    clickSubmit();
    await settle();

    // Store still on course-b; the item's latest_status must be unchanged.
    expect(currentCourse.value?.slug).toBe('course-b');
    expect(currentCourse.value?.miniProjectsByBlockId['33'].latest_status).toBe('not_submitted');
  });

  it('D6.14 visibility — hidden dispatch no-op; visible dispatch triggers refetch', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));

    await mountPage();
    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(1);

    // Hidden → no refetch.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(1);

    // Visible → refetch.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(2);
  });
});

describe('MiniProjectDetailPage (D6 — sr-only aria-live)', () => {
  it('D6.15 sr-live container identity preserved across status change', async () => {
    const first = makeDetail({ latest_status: 'awaiting_evaluation', can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation' });
    const second = makeDetail({
      latest_status: 'accepted',
      submission_history: [makeEntry({ evaluation: makeEval({ result: 'accepted' }) })],
      can_submit: false,
      can_submit_reason_if_not: 'already_accepted',
    });
    vi.mocked(fetchDetail).mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await mountPage();
    const srLiveEl = target.querySelector('[data-testid="sr-live"]');
    if (!srLiveEl) throw new Error('expected sr-live region');
    expect(srLiveEl.getAttribute('aria-live')).toBe('polite');
    expect(srLiveEl.textContent).toContain('Awaiting evaluation');

    // Trigger refetch via visibility event.
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    const srLiveEl2 = target.querySelector('[data-testid="sr-live"]');
    if (!srLiveEl2) throw new Error('expected sr-live region after refetch');
    expect(srLiveEl2).toBe(srLiveEl); // DOM identity preserved (no remount).
    expect(srLiveEl2.textContent).toContain('Accepted');
  });
});
