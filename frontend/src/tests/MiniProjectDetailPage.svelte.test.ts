import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

// Mock the student-MP wire layer BEFORE importing the page so the page's
// import binding resolves to the mock. We re-export the real REASON_LABELS /
// LATEST_STATUS_META so the page's runtime UI plumbing
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
import { uploadLimit, resetUploadLimit } from '../lib/uploadLimit.svelte';
import { fetchDetail, submit, REASON_LABELS } from '../lib/studentMiniProjects';
import { emitUnauthorized } from '../lib/events';
import { currentCourse, __test__setSlots } from '../stores/currentCourse.svelte';
import { formatFileSize } from '../lib/format';
import MiniProjectDetailPage from '../pages/MiniProjectDetailPage.svelte';
import { expectRoutesInApp } from './support/routeClickProbe';
import type {
  StudentMiniProjectDetail,
  StudentSubmissionHistoryEntry,
  StudentSubmissionHistoryEvaluation,
  StudentGroupSummary,
  StudentMiniProjectListItem,
} from '../lib/types';

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

// Spec line 980 — capture the original `visibilityState` descriptor ONCE at
// file load, restore it in afterEach so tests that mutate the seam can't
// leak state into following tests (or into the rest of the suite).
const ORIG_VISIBILITY_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  Document.prototype,
  'visibilityState',
);

beforeEach(() => {
  vi.mocked(fetchDetail).mockReset();
  vi.mocked(submit).mockReset();
  vi.mocked(emitUnauthorized).mockReset();
  __test__setSlots(null);
  uploadLimit.mb = 20; // the saved limit (Settings D11b); tests of other values set their own
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
  resetUploadLimit();
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
  __test__setSlots(null);
  // Spec line 980 — restore the original `visibilityState` to avoid leaking
  // state across tests. Per-test setup writes via
  // `Object.defineProperty(document, 'visibilityState', ...)`, which creates
  // an OWN property on the `document` instance — restoring the prototype
  // descriptor alone would leave that own property intact. So defensively
  // do BOTH:
  //  1. Delete the per-test own-property override on the `document` instance
  //     (the actual leak source).
  //  2. Restore the original `Document.prototype` descriptor (in case any
  //     test ever mutates the prototype).
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  if (ORIG_VISIBILITY_DESCRIPTOR) {
    Object.defineProperty(Document.prototype, 'visibilityState', ORIG_VISIBILITY_DESCRIPTOR);
  }
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
    deadline: '2026-06-20T23:59:00Z',
    deadline_kind: 'due',
    deadline_open: true,
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
    // No evaluation → no .feedback block.
    expect(entries[0].querySelector('.feedback')).toBeNull();
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
    expect(entries[0].querySelector('h3')?.textContent).toContain('Submission 2');
    expect(entries[1].querySelector('h3')?.textContent).toContain('Submission 1');
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
    expect(entries[0].querySelector('.feedback')).not.toBeNull();
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
      deadline: '2026-06-25T23:59:00Z', deadline_kind: 'resubmit',
    }));
    await mountPage();

    const pill = target.querySelector('header .pill');
    expect(pill?.textContent).toContain('Needs revision (minor)');

    const entries = target.querySelectorAll('section.history section.history-entry');
    expect(entries.length).toBe(1);
    expect(entries[0].querySelector('.feedback')).not.toBeNull();
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
    // Pill MUST exist within the header row, never inside the h3 (its parent is .pills, the h3's sibling).
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
  const btn = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary');
  if (!btn) throw new Error('expected submit button present');
  btn.click();
}

describe('MiniProjectDetailPage (D6 — submit flow)', () => {
  it('D6.1 happy 201 — submit succeeds → state success; new file pick → idle', async () => {
    const initial = makeDetail({ submission_history: [], latest_status: 'not_submitted', can_submit: true });
    // Keep can_submit=true on refetch so the submit section stays mounted —
    // we need the file input to exercise "pick a new file → state → idle".
    const refetched = makeDetail({
      submission_history: [makeEntry({ submission_number: 1 })],
      latest_status: 'rejected',
      can_submit: true,
    });
    vi.mocked(fetchDetail).mockResolvedValueOnce(initial).mockResolvedValueOnce(refetched);
    vi.mocked(submit).mockResolvedValue(undefined);

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();

    expect(vi.mocked(submit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(2);
    // State observable: pill flipped to "Rejected" via refetch.
    const pill = target.querySelector('header .pill');
    expect(pill?.textContent).toContain('Rejected');
    // Banner: none on success.
    expect(target.querySelector('[data-testid="mp-submit-error"]')).toBeNull();
    // In 'success' state with no file selected, button is disabled.
    const btn = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary');
    if (!btn) throw new Error('expected submit button present');
    expect(btn.disabled).toBe(true);

    // Pick a new file → handleFileChange transitions 'success' → 'idle'.
    // The button must become ENABLED again (state=idle + selectedFile!=null).
    await pickFile(makePdf('again.pdf'));
    const btn2 = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary');
    if (!btn2) throw new Error('expected submit button present after next pick');
    expect(btn2.disabled).toBe(false);
  });

  it('D6.2 409 — banner copy literal + detail refetched', async () => {
    const initial = makeDetail({ latest_status: 'not_submitted', can_submit: true });
    // Refetched still permits submission so the submit-section stays mounted
    // and we can assert the banner copy after the race-recovery refetch.
    const refetched = makeDetail({ latest_status: 'rejected', can_submit: true });

    // First call resolves immediately for the initial mount. Second call —
    // the 409-recovery refetch — is HELD pending so the banner is observable
    // in its post-set / pre-resolve window.
    let resolveRefetch: (v: StudentMiniProjectDetail) => void = () => {};
    vi.mocked(fetchDetail)
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(new Promise<StudentMiniProjectDetail>((res) => { resolveRefetch = res; }));
    vi.mocked(submit).mockRejectedValue(new ApiError(409, 'state changed'));

    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    // Drain the rejection microtask + the synchronous 409-branch state writes,
    // but DO NOT let the pending refetch resolve yet — the banner is set in
    // the 409 path BEFORE awaiting the refetch.
    await settle();

    // Banner is present with the spec-mandated copy.
    const banner = target.querySelector('[data-testid="mp-submit-error"]');
    if (!banner) throw new Error('expected 409 banner');
    // Byte-exact equality — copy drift would otherwise sneak through a
    // substring match. The banner is ErrorState inline: the title is a <p> too, so query .message
    // directly — a <p> query would return the constant title.
    const bannerMsg = banner.querySelector('.message');
    if (!bannerMsg) throw new Error('expected .message inside 409 banner');
    expect(bannerMsg.textContent?.trim()).toBe('Submission state changed — refreshing.');

    // Now resolve the pending refetch — state drops back to 'idle' and the
    // banner disappears.
    resolveRefetch(refetched);
    await settle();

    expect(vi.mocked(fetchDetail)).toHaveBeenCalledTimes(2);
    // Banner cleared.
    expect(target.querySelector('[data-testid="mp-submit-error"]')).toBeNull();
    const btn = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary');
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
    expect(banner.querySelector('.message')!.textContent).toBe("The upload didn't go through. Nothing has been lost — retrying sends the same file.");
    const retryBtn = banner.querySelector<HTMLButtonElement>('.btn');
    if (!retryBtn) throw new Error('expected Retry button on 503');
    expect(retryBtn.textContent).toContain('Retry');
    // Rendering Retry is not the contract — being wired to a real re-submit is.
    // The mock rejects 503 every time, so the second attempt ends in the same
    // banner; the assertion is the CALL COUNT, not the outcome.
    retryBtn.click();
    flushSync();
    await settle();
    expect(vi.mocked(submit)).toHaveBeenCalledTimes(2);
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
    expect(banner.querySelector('.message')!.textContent).toBe("The upload didn't go through. Nothing has been lost — retrying sends the same file.");
    expect(banner.querySelector('.btn')).not.toBeNull();
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
    expect(banner.textContent).toContain('File too large — 20 MB maximum.');
  });

  it('the size check says the saved limit (Settings D11b)', async () => {
    uploadLimit.mb = 50;
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    await mountPage();
    const big = new File([new Uint8Array(1)], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { configurable: true, value: 51 * 1024 * 1024 });
    await pickFile(big);
    clickSubmit();
    await settle();
    expect(vi.mocked(submit)).not.toHaveBeenCalled();
    expect(target.querySelector('[data-testid="mp-submit-error"]')?.textContent).toContain('File too large — 50 MB maximum.');
  });

  it('while the limit is unknown the browser skips its size check; the server decides (Settings D11b)', async () => {
    uploadLimit.mb = null;
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    vi.mocked(submit).mockReturnValue(new Promise(() => {}));
    await mountPage();
    const big = new File([new Uint8Array(1)], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { configurable: true, value: 60 * 1024 * 1024 });
    await pickFile(big);
    clickSubmit();
    await settle();
    expect(vi.mocked(submit)).toHaveBeenCalled();
  });

  it("a proxy's 413 (no sentence) says the server's upload limit (Settings D11a)", async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    vi.mocked(submit).mockRejectedValue(new ApiError(413, 'Submission failed'));
    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();
    const banner = target.querySelector('[data-testid="mp-submit-error"]')?.textContent ?? '';
    expect(banner).toContain("This file is over the server's upload limit.");
    expect(banner).not.toContain('Submission failed');
  });

  it("the server's 413 shows its own sentence (Settings D11a)", async () => {
    const sentence = 'This file is over the 20 MB limit.';
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    vi.mocked(submit).mockRejectedValue(new ApiError(413, sentence, undefined, { detail: sentence }));
    await mountPage();
    await pickFile(makePdf());
    clickSubmit();
    await settle();
    expect(target.querySelector('[data-testid="mp-submit-error"]')?.textContent).toContain(sentence);
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
    const btn = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary');
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

  it('D6.10 success — file cleared (input value empty) AND submit button disabled', async () => {
    // Both initial AND refetched return can_submit=true so the submit section
    // stays mounted. This is the realistic "test the success → idle transition
    // and the file-cleared invariant" scenario the spec calls out — when
    // can_submit flips to false, the input is removed by the {#if} and the
    // file-cleared check is trivially satisfied.
    const initial = makeDetail({ latest_status: 'not_submitted', can_submit: true });
    const refetched = makeDetail({
      submission_history: [makeEntry({ submission_number: 1 })],
      latest_status: 'rejected',
      can_submit: true,
    });
    vi.mocked(fetchDetail).mockResolvedValueOnce(initial).mockResolvedValueOnce(refetched);
    vi.mocked(submit).mockResolvedValue(undefined);

    await mountPage();
    await pickFile(makePdf());
    // pickFile() mutates input.files but NOT input.value — without an
    // explicit pre-submit sentinel write the post-submit `input.value === ''`
    // assertion is vacuous (the field was already empty). Set a sentinel
    // BEFORE clicking submit so the post-assertion can ONLY pass if the
    // production reset (`fileInputEl.value = ''` in the 201-success branch)
    // actually fires.
    const fileInputForSentinel = target.querySelector<HTMLInputElement>(
      'input[type="file"][data-testid="mp-file-input"]',
    );
    if (!fileInputForSentinel) throw new Error('expected file input before submit');
    try {
      fileInputForSentinel.value = 'sentinel-before-submit.pdf';
    } catch {
      // Some jsdom builds expose `value` as a getter-only property unless
      // redefined; fall through to defineProperty in that case.
      Object.defineProperty(fileInputForSentinel, 'value', {
        configurable: true,
        writable: true,
        value: 'sentinel-before-submit.pdf',
      });
    }
    // Sanity-check the sentinel landed — otherwise the post-assertion below
    // would still be vacuous against a silently-rejected write.
    expect(fileInputForSentinel.value).toBe('sentinel-before-submit.pdf');
    clickSubmit();
    await settle();

    // Section is still rendered (can_submit=true).
    const input = target.querySelector<HTMLInputElement>('input[type="file"][data-testid="mp-file-input"]');
    if (!input) throw new Error('expected file input present after success + can_submit=true refetch');
    // Native input value cleared so the user can re-pick the SAME filename.
    // Meaningful only because we set a sentinel before submit — this can
    // ONLY pass if the production fileInputEl.value = '' reset actually ran.
    expect(input.value).toBe('');
    // The submit button is disabled in 'success' state (canSubmitClick excludes
    // both 'submitting' and 'success').
    const btn = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary');
    if (!btn) throw new Error('expected submit button present');
    expect(btn.disabled).toBe(true);
  });
});

describe('MiniProjectDetailPage (D6 — misc)', () => {
  it('D6.11 external and file links open in a new tab; a page link and mailto stay (D58, D59)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      assignment_html: `<p><a href="https://example.com">ext</a><a href="/api/runs/1/assets/x.png">asset</a><a href="${location.origin}/courses/x">page</a><a href="mailto:t@x">mail</a></p>`,
    }));
    await mountPage();

    const box = target.querySelector('[data-testid="assignment-html"]')!;
    expect(box.classList.contains('prose')).toBe(true);
    expect(box.classList.contains('compact')).toBe(false);

    const ext = box.querySelector('a[href="https://example.com"]');
    if (!ext) throw new Error('expected external link');
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');

    // D59: Mathion's own files open in a new tab too, so unsubmitted work stays.
    const asset = box.querySelector('a[href="/api/runs/1/assets/x.png"]');
    if (!asset) throw new Error('expected asset link');
    expect(asset.getAttribute('target')).toBe('_blank');
    expect(asset.getAttribute('rel')).toBe('noopener noreferrer');

    const page = box.querySelector(`a[href="${location.origin}/courses/x"]`);
    if (!page) throw new Error('expected page link');
    expect(page.getAttribute('target')).toBeNull();

    const mail = box.querySelector('a[href="mailto:t@x"]');
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
      deadline: null,
      deadline_kind: null,
      deadline_open: true,
      latest_status: 'not_submitted',
    };
    __test__setSlots({
      slug: 'course-b',
      versionId: 1,
      course: { id: 1, slug: 'course-b', name: 'Other' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
      miniProjectsByBlockId: { '33': existingItem }, teachers: [],
    });

    clickSubmit();
    await settle();

    // Store still on course-b; the item's latest_status must be unchanged.
    expect(currentCourse.value?.slug).toBe('course-b');
    expect(currentCourse.value?.miniProjectsByBlockId['33'].latest_status).toBe('not_submitted');
  });

  it('D6.16 visibility refetch 403 — full-page banner copy', async () => {
    // Initial mount succeeds.
    vi.mocked(fetchDetail).mockResolvedValueOnce(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    await mountPage();
    expect(target.querySelector('[data-testid="fetch-error-banner"]')).toBeNull();

    // Visibility refetch — now the detail endpoint returns 403.
    vi.mocked(fetchDetail).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    const banner = target.querySelector('[data-testid="fetch-error-banner"]');
    if (!banner) throw new Error('expected full-page fetch-error banner after 403');
    // The full-page banner is ErrorState's page variant: <h1 class="title">, <p class="message">{copy}</p>,
    // and a "Back to course" action. Query .message so the comparison only sees the copy.
    const bannerP = banner.querySelector('.message');
    if (!bannerP) throw new Error('expected .message inside 403 fetch-error banner');
    expect(bannerP.textContent?.trim()).toBe(
      'This mini-project is no longer accessible. The run may have been closed.',
    );
  });

  it('D6.17 visibility refetch 404 — full-page banner copy', async () => {
    vi.mocked(fetchDetail).mockResolvedValueOnce(makeDetail({ latest_status: 'not_submitted', can_submit: true }));
    await mountPage();
    expect(target.querySelector('[data-testid="fetch-error-banner"]')).toBeNull();

    vi.mocked(fetchDetail).mockRejectedValueOnce(new ApiError(404, 'gone'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    const banner = target.querySelector('[data-testid="fetch-error-banner"]');
    if (!banner) throw new Error('expected full-page fetch-error banner after 404');
    // The full-page banner is ErrorState's page variant: <h1 class="title">, <p class="message">{copy}</p>,
    // and a "Back to course" action. Query .message so the comparison only sees the copy.
    const bannerP = banner.querySelector('.message');
    if (!bannerP) throw new Error('expected .message inside 404 fetch-error banner');
    expect(bannerP.textContent?.trim()).toBe(
      "This mini-project doesn't exist or has been unpublished.",
    );
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

// ---- Slice-4 T3 — 9c frame, header, assignment, group, history ----

describe('MiniProjectDetailPage 9c frame + header (Slice-4 T3)', () => {
  it('loading: Skeleton with 4 rows; the sr-live region stays outside it (C16)', async () => {
    vi.mocked(fetchDetail).mockReturnValueOnce(new Promise<StudentMiniProjectDetail>(() => {}));
    component = mount(MiniProjectDetailPage, { target, props: { courseSlug: 'course-x', blockSlug: 'block-y' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelectorAll('.skeleton .row').length).toBe(4);
    expect(target.querySelector('[data-testid="sr-live"]')).not.toBeNull();
    // C16 proper: the live region must be a SIBLING of the loading branch, not inside it —
    // its DOM identity has to survive the loading→loaded swap.
    expect(target.querySelector('.skeleton [data-testid="sr-live"]')).toBeNull();
  });

  // D70 (user, Safari pass): the player's breadcrumb — course / "{n}. {block}" / the page
  // in bold — with "Mini-project" as the last crumb (the mini-project is named by its block).
  const seedCourse = (blocks: Array<{ id: number; title: string }>) => __test__setSlots({
    slug: 'course-x', versionId: 1,
    course: { id: 1, slug: 'course-x', name: 'Course X' },
    version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
    blocks: blocks.map((b, i) => ({ ...b, slug: `b${b.id}`, order: i * 2 + 1, info: '', info_html: '', sequences: [] })),
    state: { version_id: 1, items: {} }, miniProjectsByBlockId: {}, teachers: [],
  });

  it('D70 breadcrumb: {course} / {n}. {block} / Mini-project, as the player builds it', async () => {
    seedCourse([{ id: 31, title: 'Intro' }, { id: 33, title: 'Final Project' }]);
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail());
    await mountPage();
    const nav = target.querySelector('nav.breadcrumb');
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute('aria-label')).toBe('Breadcrumb');
    // direct-child order: a → .sep → .crumb → .sep → .current (no "Courses" root)
    const kids = Array.from(nav!.children);
    expect(kids.map((k) => k.tagName === 'A' ? 'a' : k.className.split(' ')[0])).toEqual(['a', 'sep', 'crumb', 'sep', 'current']);
    expect(kids[0].getAttribute('href')).toBe('/courses/course-x');
    expect(kids[0].textContent!.trim()).toBe('Course X');
    // Numbered by its place in the list, as the course page and the player number it.
    expect(kids[2].textContent).toBe('2. Final Project');
    nav!.querySelectorAll('.sep').forEach((sp) => { expect(sp.getAttribute('aria-hidden')).toBe('true'); expect(sp.textContent).toBe('/'); });
    expect(kids[4].textContent).toBe('Mini-project');
    expect(kids[4].getAttribute('aria-current')).toBe('page');
    expect(nav!.textContent).not.toContain('<');
  });

  it('D70 breadcrumb: the course link navigates in the app (no full page load)', async () => {
    seedCourse([{ id: 33, title: 'Final Project' }]);
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail());
    await mountPage();
    const link = target.querySelector('nav.breadcrumb a') as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // navigate() awaits the route guards before it pushes the path.
    await new Promise((r) => setTimeout(r, 0));
    expect(window.location.pathname).toBe('/courses/course-x');
  });

  it('C6: the course crumb lets a ⌘-click through and routes a plain click', async () => {
    seedCourse([{ id: 33, title: 'Final Project' }]);
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail());
    await mountPage();
    await expectRoutesInApp(target.querySelector('nav.breadcrumb a')!, '/courses/course-x');
  });

  it('the course crumb and its separator render only when the loaded course is this one', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail());
    // No course loaded yet (or the load failed): no empty, nameless link.
    __test__setSlots(null);
    await mountPage();
    let nav = target.querySelector('nav.breadcrumb')!;
    expect(nav.querySelector('a')).toBeNull();
    expect(Array.from(nav.children).map((k) => k.className.split(' ')[0])).toEqual(['current']);
    unmount(component!);
    component = null;

    // Another course still in the store, after a cross-course move.
    __test__setSlots({
      slug: 'other', versionId: 2,
      course: { id: 2, slug: 'other', name: 'Other course' },
      version: { id: 2, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [{ id: 99, title: 'Elsewhere', slug: 'b99', order: 1, info: '', info_html: '', sequences: [] }],
      state: { version_id: 2, items: {} }, miniProjectsByBlockId: {}, teachers: [],
    });
    await mountPage();
    nav = target.querySelector('nav.breadcrumb')!;
    expect(nav.querySelector('a')).toBeNull();
    expect(nav.textContent).not.toContain('Other course');
    unmount(component!);
    component = null;

    seedCourse([{ id: 33, title: 'Final Project' }]);
    await mountPage();
    nav = target.querySelector('nav.breadcrumb')!;
    expect(nav.querySelector('a')!.textContent!.trim()).toBe('Course X');
  });

  it('D70 breadcrumb: without the block in the course store, course / Mini-project', async () => {
    seedCourse([]);
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail());
    await mountPage();
    const nav = target.querySelector('nav.breadcrumb');
    expect(nav!.querySelector('.crumb')).toBeNull();
    expect(nav!.querySelectorAll('.sep').length).toBe(1);
    expect(nav!.querySelector('.current')!.textContent).toBe('Mini-project');
  });

  it('D56: the breadcrumb sits above the white sheet, which holds the header and everything below it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [makeEntry({ submission_number: 1, evaluation: null })] }));
    await mountPage();
    const sheet = target.querySelector('.mp-col > .sheet');
    expect(sheet).not.toBeNull();
    const nav = target.querySelector('nav.breadcrumb');
    // The crumbs stay on the ground, as the player's do: before the sheet, not inside it.
    expect(nav!.parentElement!.classList.contains('mp-col')).toBe(true);
    expect(nav!.nextElementSibling).toBe(sheet);
    expect(sheet!.querySelector('header .title-row h1')).not.toBeNull();
    expect(sheet!.querySelector('header nav.breadcrumb')).toBeNull();
    expect(sheet!.querySelector('section.assignment')).not.toBeNull();
    expect(sheet!.querySelector('.mp-side')).not.toBeNull();
    expect(sheet!.querySelector('section.history')).not.toBeNull();
  });

  it('D69: assignment, the side column (group, submit) and the history share one body grid, in reading order', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true, submission_history: [makeEntry({ submission_number: 1, evaluation: null })] }));
    await mountPage();
    const body = target.querySelector('.sheet > .mp-body');
    expect(body).not.toBeNull();
    // DOM order is the narrow (one-column) order and the reading order: the grid only
    // moves the side column to the right on wide windows.
    const kids = Array.from(body!.children).map((el) => el.className.split(' ')[0]);
    expect(kids).toEqual(['assignment', 'mp-side', 'history']);
    const side = body!.querySelector('.mp-side');
    expect(side!.children[0].classList.contains('group-block')).toBe(true);
    expect(side!.children[1].getAttribute('data-testid')).toBe('mp-submit-section');
    expect(body!.classList.contains('has-history')).toBe(true);
  });

  it('D69: without a history the body grid has no history row', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [] }));
    await mountPage();
    const body = target.querySelector('.sheet > .mp-body');
    expect(body).not.toBeNull();
    expect(body!.querySelector('section.history')).toBeNull();
    expect(body!.classList.contains('has-history')).toBe(false);
  });

  it('D56: the loading and error states stay on the ground (no sheet)', async () => {
    vi.mocked(fetchDetail).mockReturnValueOnce(new Promise<StudentMiniProjectDetail>(() => {}));
    component = mount(MiniProjectDetailPage, { target, props: { courseSlug: 'course-x', blockSlug: 'block-y' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelector('.sheet')).toBeNull();
    unmount(component);
    component = null;
    target.innerHTML = '';
    vi.mocked(fetchDetail).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    await mountPage();
    expect(target.querySelector('[data-testid="fetch-error-banner"]')).not.toBeNull();
    expect(target.querySelector('.sheet')).toBeNull();
  });

  it('title row: h1 reads "Mini-project — {block title}" beside the StatusPill', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ block_title: 'Final Project' }));
    await mountPage();
    const row = target.querySelector('.title-row');
    expect(row!.querySelector('h1')!.textContent).toBe('Mini-project — Final Project');
    expect(row!.querySelector('.pill')).not.toBeNull();
  });

  // D80/D81 (user): a student sees ONE deadline -- the server picks it
  // (deadline, deadline_kind, deadline_open) and never sends the hidden hard
  // one; the page shows it on one line.
  describe('one student deadline (D80/D81)', () => {
    afterEach(() => { vi.useRealTimers(); });
    const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
    const line = () => target.querySelector('.deadlines .deadline') as HTMLElement;

    it('the one deadline is "Deadline"; no "hard"/"soft" wording anywhere on the page', async () => {
      at('2026-06-10T23:59:00Z');
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted' }));
      await mountPage();
      const dl = target.querySelector('.deadlines') as HTMLElement;
      expect(dl.querySelectorAll('p')).toHaveLength(1);
      expect(line().querySelector('strong')!.textContent).toBe('Deadline');
      expect(line().textContent).toBe('Deadline · 2026-06-21 01:59 GMT+2 — 10 days remaining');   // TZ=Europe/Copenhagen
      // Nowhere on the page: text, titles, aria labels.
      const attrs = [...target.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value));
      for (const s of [target.textContent!, ...attrs]) {
        expect(s.toLowerCase()).not.toMatch(/hard deadline|soft deadline/);
      }
    });

    it('past it while the window is open, with work to submit: "Overdue since", crimson', async () => {
      at('2026-06-25T23:59:00Z');
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ latest_status: 'not_submitted', deadline_open: true }));
      await mountPage();
      expect(line().classList.contains('deadline-overdue')).toBe(true);
      expect(line().querySelector('strong')!.textContent).toBe('Overdue since');
      expect(line().textContent).toBe('Overdue since 2026-06-21 01:59 GMT+2');
    });

    it('past it and closed, or nothing left to submit: "Deadline · … — passed N days ago"', async () => {
      at('2026-07-04T23:59:00Z');
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
        latest_status: 'not_submitted', deadline_open: false,
        can_submit: false, can_submit_reason_if_not: 'deadline_passed',
      }));
      await mountPage();
      expect(line().textContent).toBe('Deadline · 2026-06-21 01:59 GMT+2 — passed 14 days ago');
      expect(line().classList.contains('deadline-overdue')).toBe(false);
      unmount(component!); component = null;
      target.innerHTML = '';
      at('2026-06-25T23:59:00Z');
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
        latest_status: 'awaiting_evaluation', deadline_open: true,
        can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation',
      }));
      await mountPage();
      expect(line().textContent).toBe('Deadline · 2026-06-21 01:59 GMT+2 — passed 5 days ago');
    });

    it('a closed window reads "The submission deadline has passed."', async () => {
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
        deadline_open: false, can_submit: false, can_submit_reason_if_not: 'deadline_passed',
      }));
      await mountPage();
      expect(target.textContent).toContain('The submission deadline has passed.');
    });

    it('a revision with no resubmission deadline shows no deadline at all', async () => {
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
        latest_status: 'minor_revision', deadline: null, deadline_kind: null, deadline_open: true,
        submission_history: [makeEntry({ evaluation: makeEval({ result: 'minor_revision' }) })],
      }));
      await mountPage();
      expect(target.querySelector('.deadlines')).toBeNull();
    });

    it('the history\'s Late pill names no deadline: "Submitted late"', async () => {
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
        latest_status: 'awaiting_evaluation',
        can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation',
        submission_history: [makeEntry({ submission_number: 1, is_late: true })],
      }));
      await mountPage();
      expect((target.querySelector('.pill-late') as HTMLElement).title).toBe('Submitted late');
    });

    // D80 (user): a resubmission is bound only by the resubmission deadline,
    // past which the server refuses it -- so it is never late (D81: the server
    // no longer marks it; the page keeps the rule for older data).
    it('no Late pill on a resubmission; a first submission keeps it', async () => {
      vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
        latest_status: 'awaiting_evaluation',
        can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation',
        submission_history: [
          makeEntry({ submission_id: 2, submission_number: 2, is_late: true, is_resubmission: true }),
          makeEntry({ submission_id: 1, submission_number: 1, is_late: true, evaluation: makeEval({ result: 'major_revision' }) }),
        ],
      }));
      await mountPage();
      const entries = [...target.querySelectorAll('.history-entry')];
      expect(entries).toHaveLength(2);
      expect(entries[0].querySelector('.pill-late')).toBeNull();
      expect(entries[1].querySelector('.pill-late')).not.toBeNull();
    });
  });

  it('deadlines: the resubmission line in a revision state', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      latest_status: 'minor_revision', deadline: '2026-06-25T23:59:00Z', deadline_kind: 'resubmit',
      submission_history: [makeEntry({ evaluation: makeEval({ result: 'minor_revision' }) })],
    }));
    await mountPage();
    const resub = target.querySelector('.deadline-resub');
    expect(resub).not.toBeNull();
    expect(resub!.querySelector('strong')!.textContent).toBe('Resubmission deadline');
    expect(target.querySelectorAll('.deadlines p')).toHaveLength(1);
  });

  it('deadlines row is absent when nothing would render in it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ deadline: null, deadline_kind: null }));
    await mountPage();
    expect(target.querySelector('.deadlines')).toBeNull();
  });
});

describe('MiniProjectDetailPage 9c assignment + group (Slice-4 T3)', () => {
  it('assignment card: h2 "Assignment" above the bound assignment-html seam', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ assignment_html: '<p>Do <a href="https://x.y">it</a>.</p>' }));
    await mountPage();
    const card = target.querySelector('section.assignment');
    expect(card).not.toBeNull();
    expect(card!.querySelector('h2')!.textContent).toBe('Assignment');
    const html = card!.querySelector('[data-testid="assignment-html"]');
    expect(html).not.toBeNull();
    expect(html!.querySelector('a')!.getAttribute('target')).toBe('_blank');   // the externalLinks attachment (D58)
  });

  it('group card: "Your group", current member bold and first, group name in the sentence; no opacity class', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      group: makeGroup({ members: [TEAMMATE, ME], is_disabled: true }),
    }));
    await mountPage();
    const card = target.querySelector('section.group-block');
    expect(card!.querySelector('h2')!.textContent).toBe('Your group');
    const members = card!.querySelector('.members');
    expect(members!.textContent?.replace(/\s+/g, ' ').trim()).toBe('Group Team Alpha — Alice Student (you), Bob Other');
    const strong = members!.querySelectorAll('strong');
    expect(strong.length).toBe(1);
    expect(strong[0].textContent).toBe('Alice Student (you)');
    expect(card!.querySelector('.group-notice')!.textContent).toBe('This group is disabled — contact your teacher.');
    expect(card!.classList.contains('group-disabled')).toBe(false);
    expect(card!.closest('.mp-side')).not.toBeNull();
  });

  it('single-member group sentence', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ group: makeGroup({ members: [ME] }) }));
    await mountPage();
    const members = target.querySelector('.group-block .members');
    expect(members!.textContent?.replace(/\s+/g, ' ').trim()).toBe("Group Team Alpha — Alice Student (you) — you're the only member so far.");
    expect(members!.querySelector('strong')!.textContent).toBe('Alice Student (you)');
  });

  it("submit section is the side column's second direct child with its seam and inner controls", async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const submit = target.querySelector('[data-testid="mp-submit-section"]');
    // Position, not mere ancestry: `closest('.mp-side')` stayed green with the cells swapped.
    const grid = target.querySelector('.mp-side');
    expect(grid!.children[1]).toBe(submit);
    expect(submit!.classList.contains('can')).toBe(true);
    expect(submit!.querySelector('[data-testid="mp-file-input"]')).not.toBeNull();
  });
});

describe('MiniProjectDetailPage 9c history (Slice-4 T3)', () => {
  it('entry header: mono numeral, mono meta "{date} · {name} (you)", pills group beside the h3', async () => {
    const entry = makeEntry({ submission_number: 3, is_late: true, evaluation: makeEval({ result: 'rejected', score: 40 }) });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [entry], latest_status: 'rejected' }));
    await mountPage();
    const head = target.querySelector('.history-entry-header');
    const h3 = head!.querySelector('h3');
    expect(h3!.textContent).toBe('Submission 3');
    const num = h3!.querySelector('.mono');
    expect(num!.textContent).toBe('3');
    const meta = head!.querySelector('.entry-meta');
    expect(meta!.classList.contains('mono')).toBe(true);
    expect(meta!.textContent).toBe('2026-06-10 14:00 GMT+2 · Alice Student (you)');
    const pills = head!.querySelector('.pills');
    expect(pills).not.toBeNull();
    expect(pills!.previousElementSibling).toBe(meta);
    const inPills = pills!.querySelectorAll('.pill');
    expect(inPills.length).toBe(2);
    expect(inPills[0].classList.contains('pill-late')).toBe(true);
    expect(inPills[0].textContent).toBe('Late');
    expect(inPills[1].textContent).toContain('Rejected');          // StatusPill (D8)
    expect(h3!.querySelector('.pill')).toBeNull();                  // D15 invariant
  });

  it('file tile: PDF badge hidden from AT, name + mono size, icon download link with the filename in its label', async () => {
    const entry = makeEntry({ filename: 'thesis-final.pdf', file_size: 2_350_000, submission_id: 777 });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [entry], latest_status: 'awaiting_evaluation', can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation' }));
    await mountPage();
    const file = target.querySelector('.history-entry-body .file');
    expect(file).not.toBeNull();
    const kind = file!.querySelector('.file-kind');
    expect(kind!.getAttribute('aria-hidden')).toBe('true');
    expect(kind!.classList.contains('mono')).toBe(true);
    expect(kind!.textContent).toBe('PDF');
    expect(file!.querySelector('.file-name .name')!.textContent).toBe('thesis-final.pdf');
    const size = file!.querySelector('.file-name .size');
    expect(size!.classList.contains('mono')).toBe(true);
    expect(size!.textContent).toBe(formatFileSize(2_350_000));
    const dl = file!.querySelector<HTMLAnchorElement>('a.dl');
    expect(dl!.getAttribute('href')).toBe('/api/submissions/777/file');
    expect(dl!.hasAttribute('download')).toBe(true);
    expect(dl!.getAttribute('aria-label')).toBe('Download thesis-final.pdf');
    expect(dl!.getAttribute('title')).toBe('Download');
    const svg = dl!.querySelector('svg');
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(dl!.textContent?.trim()).toBe('');                       // icon-only; the label is aria
  });

  it('feedback block: result class, meta line with mono score + mono date, text, optional feedback file', async () => {
    const entry = makeEntry({ evaluation: makeEval({ result: 'minor_revision', score: 65, feedback_text: 'Fix typos.', has_feedback_file: true, eval_id: 909 }) });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [entry], latest_status: 'minor_revision' }));
    await mountPage();
    const fb = target.querySelector('.history-entry-body .feedback');
    expect(fb!.classList.contains('needs-revision')).toBe(true);
    const meta = fb!.querySelector('.feedback-meta');
    expect(meta!.textContent?.replace(/\s+/g, ' ').trim()).toBe('Needs revision (minor) · score 65/100 · Prof Smith, 2026-06-15 12:00 GMT+2');
    const monos = meta!.querySelectorAll('.mono');
    expect(monos.length).toBe(2);
    expect(monos[0].textContent).toBe('65/100');
    expect(fb!.querySelector('.feedback-text')!.textContent).toBe('Fix typos.');
    expect(fb!.querySelector<HTMLAnchorElement>('a.feedback-file')!.getAttribute('href')).toBe('/api/evaluations/909/feedback-file');
  });

  it('feedback block: null score omits the score segment; empty text falls back; rejected/accepted classes', async () => {
    const rejected = makeEntry({ submission_id: 1, submission_number: 1, evaluation: makeEval({ result: 'rejected', score: null, feedback_text: '' }) });
    const accepted = makeEntry({ submission_id: 2, submission_number: 2, evaluation: makeEval({ result: 'accepted' }) });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [accepted, rejected], latest_status: 'accepted', can_submit: false, can_submit_reason_if_not: 'already_accepted' }));
    await mountPage();
    const blocks = target.querySelectorAll('.feedback');
    expect(blocks[0].classList.contains('accepted')).toBe(true);
    expect(blocks[1].classList.contains('rejected')).toBe(true);
    expect(blocks[1].querySelector('.feedback-meta')!.textContent).not.toContain('score');
    expect(blocks[1].querySelector('.feedback-text')!.textContent).toBe('No written feedback');
  });

  it('fetch error: page ErrorState keeps the h1 "Mini-project unavailable" and a secondary Back action (D9)', async () => {
    vi.mocked(fetchDetail).mockRejectedValueOnce(new ApiError(404, 'gone'));
    await mountPage();
    const banner = target.querySelector('[data-testid="fetch-error-banner"]');
    const err = banner!.querySelector('.error-state.page');
    expect(err).not.toBeNull();
    expect(err!.querySelector('h1.title')!.textContent).toBe('Mini-project unavailable');
    const back = err!.querySelector('.action .btn');
    expect(back!.textContent?.trim()).toBe('Back to course');
    expect(back!.classList.contains('secondary')).toBe(true);
  });
});

// ---- Slice-4 T4 — drop zone (D5 / enumerated (A)1) ----

function dropEvent(type: 'dragover' | 'dragleave' | 'drop', files: File[] = []): Event {
  // jsdom has no DragEvent / DataTransfer constructor; a plain Event with a
  // synthetic dataTransfer carries what the handlers read.
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    configurable: true,
    value: { files: Object.assign(files.slice(), { item: (i: number) => files[i] ?? null }) },
  });
  return e;
}

// jsdom throws InvalidStateError when a file input's `value` is set to a
// non-empty string (the spec's "filename" mode); D6.10 works around it the same
// way. After the defineProperty fallback the production `fileInputEl.value = ''`
// writes the own data property, which is what the assertions read back.
function setFileInputValue(input: HTMLInputElement, v: string): void {
  try {
    input.value = v;
  } catch {
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value: v });
  }
  expect(input.value).toBe(v);
}

function dropZone(): HTMLLabelElement {
  const z = target.querySelector<HTMLLabelElement>('label.drop');
  if (!z) throw new Error('expected label.drop');
  return z;
}

describe('MiniProjectDetailPage (Slice-4 T4 — submit card)', () => {
  it('can-submit card: emphasised class, drop label wraps the input, Submit is a primary Button with the pick hint', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const section = target.querySelector('[data-testid="mp-submit-section"]')!;
    expect(section.classList.contains('can')).toBe(true);
    expect(section.querySelector('h2')!.textContent).toBe('Submit');
    const zone = dropZone();
    expect(zone.querySelector('input[type="file"][data-testid="mp-file-input"]')).not.toBeNull();
    expect(zone.querySelector('.drop-label')!.textContent).toBe('Drop a PDF or click to pick');
    expect(zone.classList.contains('has-file')).toBe(false);
    const btn = section.querySelector<HTMLButtonElement>('.submit-row .btn.primary')!;
    expect(btn.textContent?.trim()).toBe('Submit');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Pick a PDF first');
    expect(section.querySelector('.banner-error, .banner-info')).toBeNull();
  });

  it('picking a file swaps the label for the filename and clears the hint', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    await pickFile(makePdf('thesis.pdf'));
    const zone = dropZone();
    expect(zone.classList.contains('has-file')).toBe(true);
    expect(zone.querySelector('.drop-label')!.textContent).toBe('thesis.pdf');
    const btn = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary')!;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('title')).toBeNull();
  });

  it('dragover lights the zone and is cancelled; dragleave clears it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const zone = dropZone();
    const over = dropEvent('dragover');
    zone.dispatchEvent(over);
    flushSync();
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList.contains('dragover')).toBe(true);
    zone.dispatchEvent(dropEvent('dragleave'));
    flushSync();
    expect(zone.classList.contains('dragover')).toBe(false);
  });

  it('drop selects the first file through the same path as the picker and submits it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    vi.mocked(submit).mockResolvedValue(undefined);
    await mountPage();
    const zone = dropZone();
    // Light the zone first — otherwise the post-drop `dragover` assertion below is
    // vacuous (the class was never set) and could not see handleDrop dropping the clear.
    zone.dispatchEvent(dropEvent('dragover'));
    flushSync();
    expect(zone.classList.contains('dragover')).toBe(true);
    const drop = dropEvent('drop', [makePdf('dropped.pdf'), makePdf('second.pdf')]);
    zone.dispatchEvent(drop);
    await settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(zone.classList.contains('dragover')).toBe(false);
    expect(zone.querySelector('.drop-label')!.textContent).toBe('dropped.pdf');
    clickSubmit();
    await settle();
    expect(vi.mocked(submit)).toHaveBeenCalledTimes(1);
    expect((vi.mocked(submit).mock.calls[0][1] as File).name).toBe('dropped.pdf');
  });

  it('a fileless drop is a no-op: keeps the earlier pick and the native input untouched', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    await pickFile(makePdf('kept.pdf'));
    const input = target.querySelector<HTMLInputElement>('[data-testid="mp-file-input"]')!;
    setFileInputValue(input, 'sentinel.pdf');
    dropZone().dispatchEvent(dropEvent('drop', []));
    await settle();
    expect(dropZone().querySelector('.drop-label')!.textContent).toBe('kept.pdf');
    expect(input.value).toBe('sentinel.pdf');
  });

  it('pick A → drop B → re-pick A submits A (an accepted drop clears the native input, D5)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    vi.mocked(submit).mockResolvedValue(undefined);
    await mountPage();
    await pickFile(makePdf('a.pdf'));
    const input = target.querySelector<HTMLInputElement>('[data-testid="mp-file-input"]')!;
    setFileInputValue(input, 'a.pdf');                      // what a browser stores after the pick
    dropZone().dispatchEvent(dropEvent('drop', [makePdf('b.pdf')]));
    await settle();
    expect(input.value).toBe('');                           // cleared → the re-pick of a.pdf will fire change
    expect(dropZone().querySelector('.drop-label')!.textContent).toBe('b.pdf');
    await pickFile(makePdf('a.pdf'));
    clickSubmit();
    await settle();
    expect((vi.mocked(submit).mock.calls[0][1] as File).name).toBe('a.pdf');
  });

  it('while submitting: drop is cancelled but discarded, and dragover does not light the zone', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    let resolveSubmit: () => void = () => {};
    vi.mocked(submit).mockReturnValue(new Promise<void>((res) => { resolveSubmit = res; }));
    await mountPage();
    await pickFile(makePdf('first.pdf'));
    clickSubmit();
    await settle();
    const zone = dropZone();
    // A real file drag lists 'Files'; while submitting the window cancels it, not the zone (Polish 3 t6-r2).
    const over = fileDrag('dragover');
    zone.dispatchEvent(over); flushSync();
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList.contains('dragover')).toBe(false);
    const drop = dropEvent('drop', [makePdf('late.pdf')]);
    zone.dispatchEvent(drop); await settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(zone.querySelector('.drop-label')!.textContent).toBe('first.pdf');
    resolveSubmit(); await settle();
  });

  it('submit error renders the inline ErrorState with the constant title; network errors get Retry, guards do not', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    await pickFile(makeTxt());
    clickSubmit(); await settle();
    const err = target.querySelector('[data-testid="mp-submit-error"] .error-state.inline');
    expect(err).not.toBeNull();
    expect(err!.querySelector('.title')!.textContent).toBe("Couldn't submit");
    expect(err!.querySelector('.message')!.textContent).toBe('Only PDF files are accepted.');
    expect(err!.querySelector('.btn')).toBeNull();
  });

  it('cannot-submit: precondition banner replaces the card body, no heading, no controls', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation', latest_status: 'awaiting_evaluation' }));
    await mountPage();
    const section = target.querySelector('[data-testid="mp-submit-section"]')!;
    expect(section.classList.contains('can')).toBe(false);
    const pre = section.querySelector('.precondition[data-testid="mp-cannot-submit"]');
    expect(pre).not.toBeNull();
    expect(pre!.textContent?.trim()).toBe(REASON_LABELS.awaiting_evaluation);
    expect(section.querySelector('h2')).toBeNull();
    expect(section.querySelector('input, .btn')).toBeNull();
  });
});

// ---- Polish 3 Task 6 — a file dropped beside the zone ----

// A drag as the browser reports it: `types` lists 'Files' when files are carried.
function fileDrag(type: 'dragover' | 'drop', files: File[] = [], types: string[] = ['Files']): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    configurable: true,
    value: { types, dropEffect: 'copy', files: Object.assign(files.slice(), { item: (i: number) => files[i] ?? null }) },
  });
  return e;
}

describe('MiniProjectDetailPage (Polish 3 — a drop beside the zone)', () => {
  it('a file dropped beside the zone is defaultPrevented', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const over = fileDrag('dragover');
    const drop = fileDrag('drop', [makePdf('beside.pdf')]);
    document.body.dispatchEvent(over);
    document.body.dispatchEvent(drop);
    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    // Nothing is picked: the zone's label is unchanged.
    expect(dropZone().querySelector('.drop-label')!.textContent).toBe('Drop a PDF or click to pick');
  });

  it('a file dragged beside the zone shows no drop cursor; over the zone it keeps the copy cursor (review t6-r1)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const beside = fileDrag('dragover');
    document.body.dispatchEvent(beside);
    expect((beside as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none');
    const over = fileDrag('dragover');
    dropZone().dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy');
  });

  it('a drag without files beside the zone is left to the browser', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const over = fileDrag('dragover', [], ['text/plain']);
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy');
    const drop = fileDrag('drop', [], ['text/plain']);
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  it('a drop on the zone still picks the file', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const drop = fileDrag('drop', [makePdf('on-zone.pdf')]);
    dropZone().dispatchEvent(drop);
    await settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(dropZone().querySelector('.drop-label')!.textContent).toBe('on-zone.pdf');
  });

  it('a drop on the disabled zone while submitting does nothing', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    let resolveSubmit: () => void = () => {};
    vi.mocked(submit).mockReturnValue(new Promise<void>((res) => { resolveSubmit = res; }));
    await mountPage();
    await pickFile(makePdf('first.pdf'));
    clickSubmit();
    await settle();
    const drop = fileDrag('drop', [makePdf('late.pdf')]);
    dropZone().dispatchEvent(drop);
    await settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(dropZone().querySelector('.drop-label')!.textContent).toBe('first.pdf');
    resolveSubmit();
    await settle();
  });

  it('the disabled zone while submitting shows no drop cursor (review t6-r2)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    let resolveSubmit: () => void = () => {};
    vi.mocked(submit).mockReturnValue(new Promise<void>((res) => { resolveSubmit = res; }));
    await mountPage();
    await pickFile(makePdf('first.pdf'));
    clickSubmit();
    await settle();
    const over = fileDrag('dragover');
    dropZone().dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none');
    expect(dropZone().classList.contains('dragover')).toBe(false);
    resolveSubmit();
    await settle();
  });

  it('the window listeners are removed on unmount', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const before = fileDrag('drop', [makePdf('before.pdf')]);
    document.body.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    unmount(component!); component = null;
    const drop = fileDrag('drop', [makePdf('after.pdf')]);
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });
});
