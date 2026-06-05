import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

import DashboardSidePanel from '../components/runs/DashboardSidePanel.svelte';
import type { PanelTarget } from '../components/runs/DashboardSidePanel.svelte';
import type { DashboardMpRow, DashboardMpGroupEntry } from '../lib/dashboards';

vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...actual, pushToast: vi.fn() };
});

import { pushToast } from '../stores/toasts.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function mockFetch(status: number, body: unknown) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

interface MountPanelOpts {
  target: PanelTarget;
  onClose?: () => void;
  isAdmin?: boolean;
  isTeacher?: boolean;
  onRefetch?: () => void;
}

function mountPanel(opts: MountPanelOpts) {
  const onClose = opts.onClose ?? vi.fn();
  const onRefetch = opts.onRefetch ?? vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(DashboardSidePanel, {
    target: host,
    props: {
      target: opts.target,
      onClose,
      isAdmin: opts.isAdmin ?? false,
      isTeacher: opts.isTeacher ?? false,
      onRefetch,
    },
  });
  flushSync();
  return { host, onClose: onClose as ReturnType<typeof vi.fn>, onRefetch: onRefetch as ReturnType<typeof vi.fn> };
}

async function settle() {
  await tick(); await tick(); await tick();
  flushSync();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(pushToast).mockClear();
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

// --- Fixtures ---

function makeProgressTarget(overrides: Partial<{ runId: number; user_id: number; sequence_id: number }> = {}) {
  return {
    kind: 'progress' as const,
    runId: 1,
    user_id: 100,
    sequence_id: 10,
    ...overrides,
  };
}

function makeItemsResponse(items: unknown[] = [
  { item_id: 1, item_order: 1, item_title: 'Item One', item_type: 'static_page', is_covered: true, last_score: null, last_visited_at: null },
]) {
  return {
    sequence: { sequence_id: 10, sequence_title: 'S1', sequence_order: 1, block_id: 5, block_title: 'B1' },
    student: { user_id: 100, full_name: 'Alice', email: 'alice@test.com' },
    items,
  };
}

function makeMp(overrides: Partial<DashboardMpRow> = {}): DashboardMpRow {
  return {
    id: 1, title: 'MP Alpha', block_id: 5, block_order: 1, block_title: 'Block X',
    is_published: true, first_submitted_at: null, soft_deadline: null,
    hard_deadline: null, resubmission_deadline: null,
    counts: { total_groups: 1, not_submitted: 0, awaiting_eval: 0, needs_revision: 0, accepted: 1, rejected: 0 },
    groups: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<DashboardMpGroupEntry> = {}): DashboardMpGroupEntry {
  return {
    group_id: 7,
    group_name: 'G7',
    group_is_disabled: false,
    status: 'accepted',
    latest_submission: {
      id: 42,
      submission_number: 2,
      submitted_at: '2026-03-01T10:00:00Z',
      submitted_by: { user_id: 200, full_name: 'Bob' },
      is_late: false,
      is_resubmission: true,
      file_size: 2048,
    },
    latest_evaluation: {
      id: 99,
      evaluated_at: '2026-03-02T09:00:00Z',
      evaluated_by: { user_id: 300, full_name: 'Prof C' },
      result: 'accepted',
      score: 95,
      feedback_text: 'Great work',
      has_feedback_file: true,
    },
    ...overrides,
  };
}

function submissionTarget(opts: {
  is_resubmission?: boolean;
  latest_evaluation?: DashboardMpGroupEntry['latest_evaluation'];
  status?: DashboardMpGroupEntry['status'];
  submissionId?: number;
} = {}) {
  const entry = makeEntry({
    status: opts.status ?? 'awaiting_eval',
    latest_submission: {
      id: opts.submissionId ?? 100,
      submission_number: opts.is_resubmission ? 2 : 1,
      submitted_at: '2026-06-04T10:00:00Z',
      submitted_by: { user_id: 5, full_name: 'Alice' },
      is_late: false,
      is_resubmission: opts.is_resubmission ?? false,
      file_size: 12345,
    },
    latest_evaluation: opts.latest_evaluation ?? null,
  });
  return { kind: 'submission' as const, mp: makeMp(), entry };
}

describe('DashboardSidePanel', () => {

  // 1. Progress variant: renders items list
  it('progress variant: renders items list from fetched data', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(host.textContent).toContain('Item One');
    expect(host.textContent).toContain('Alice');
    expect(host.textContent).toContain('B1');
    expect(host.textContent).toContain('S1');
  });

  // 2. Progress variant: empty items list
  it('progress variant: empty items list renders "No items in this sequence."', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse([])));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(host.textContent).toContain('No items in this sequence.');
  });

  // 3. Progress variant: fetch race — assert old signal aborted on target prop change
  it('progress variant: fetch race — first signal aborted when target prop changes', async () => {
    // Slow fetch that never resolves; capture signals from each call
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => {
      signals.push(opts.signal as AbortSignal);
      return new Promise<Response>(() => { /* never resolves */ });
    }));

    // Mount with target A via $state box (same pattern as RunProgressTab T23)
    const box = $state({ target: makeProgressTarget({ user_id: 100 }), onClose: vi.fn() });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, { target: host, props: box });
    flushSync();

    // First fetch should have fired; capture its signal
    expect(signals.length).toBe(1);
    const firstSignal = signals[0]!;
    expect(firstSignal.aborted).toBe(false);

    // Change target to B (different user_id) — $effect tracks user_id, should abort+restart
    box.target = makeProgressTarget({ user_id: 101 });
    flushSync();
    await tick();

    // First signal must be aborted; a second fetch must have started
    expect(firstSignal.aborted).toBe(true);
    expect(signals.length).toBeGreaterThanOrEqual(2);
  });

  // 4. Progress variant: 404 → uniform error message
  it('progress variant: 404 shows uniform error message', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { detail: 'Not found' }));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(host.textContent).toContain('Item details unavailable. The dashboard may be out of date — Refresh.');
  });

  // 5. Progress variant: non-404 error → same uniform message
  it('progress variant: network error shows same uniform error message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(host.textContent).toContain('Item details unavailable. The dashboard may be out of date — Refresh.');
  });

  // 6. Submission variant: renders submission + evaluation
  it('submission variant: renders mp title, group, submission, and evaluation details', async () => {
    const mp = makeMp();
    const entry = makeEntry();
    mountPanel({ target: { kind: 'submission', mp, entry } });
    expect(host.textContent).toContain('MP Alpha');
    expect(host.textContent).toContain('Block X');
    expect(host.textContent).toContain('G7');
    expect(host.textContent).toContain('Submission');
    expect(host.textContent).toContain('Evaluation');
    // submission_number
    expect(host.textContent).toContain('2');
    // result
    expect(host.textContent).toContain('accepted');
    // score
    expect(host.textContent).toContain('95');
    // feedback
    expect(host.textContent).toContain('Great work');
  });

  // 7. Submission variant: not_submitted
  it('submission variant: not_submitted renders "Not submitted yet." without Submission/Evaluation headings', async () => {
    const entry = makeEntry({ status: 'not_submitted', latest_submission: null, latest_evaluation: null });
    mountPanel({ target: { kind: 'submission', mp: makeMp(), entry } });
    expect(host.textContent).toContain('Not submitted yet.');
    // Should NOT have Submission or Evaluation section headings
    const h4s = Array.from(host.querySelectorAll('h4')).map((h) => h.textContent?.trim());
    expect(h4s).not.toContain('Submission');
    expect(h4s).not.toContain('Evaluation');
  });

  // 8. Submission variant: awaiting_eval omits Evaluation block
  it('submission variant: awaiting_eval shows Submission block but omits Evaluation block', async () => {
    const entry = makeEntry({
      status: 'awaiting_eval',
      latest_evaluation: null,
    });
    mountPanel({ target: { kind: 'submission', mp: makeMp(), entry } });
    const h4s = Array.from(host.querySelectorAll('h4')).map((h) => h.textContent?.trim());
    expect(h4s).toContain('Submission');
    expect(h4s).not.toContain('Evaluation');
  });

  // 9. Submission variant: download links
  it('submission variant: download links use verified URL patterns', async () => {
    const entry = makeEntry(); // has_feedback_file=true, submission.id=42, evaluation.id=99
    mountPanel({ target: { kind: 'submission', mp: makeMp(), entry } });
    const submissionLink = host.querySelector('a[href="/api/submissions/42/file"]');
    expect(submissionLink).toBeTruthy();
    const feedbackLink = host.querySelector('a[href="/api/evaluations/99/feedback-file"]');
    expect(feedbackLink).toBeTruthy();
  });

  // 10. Escape closes panel
  it('Escape key calls onClose', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    const { onClose } = mountPanel({ target: makeProgressTarget() });
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(onClose).toHaveBeenCalled();
  });

  // 11. Backdrop click closes panel
  it('backdrop click calls onClose', () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    const { onClose } = mountPanel({ target: makeProgressTarget() });
    const backdrop = host.querySelector('.panel-backdrop') as HTMLElement;
    expect(backdrop).toBeTruthy();
    backdrop.click();
    flushSync();
    expect(onClose).toHaveBeenCalled();
  });

  // 12. Close button closes panel
  it('close button calls onClose', () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    const { onClose } = mountPanel({ target: makeProgressTarget() });
    const closeBtn = host.querySelector('[aria-label="Close panel"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    flushSync();
    expect(onClose).toHaveBeenCalled();
  });

  // 13. Focus trap Tab/Shift+Tab cycle
  it('focus trap: Tab (last→first) and Shift+Tab (first→last) cycle per spec §13', async () => {
    const entry = makeEntry();
    mountPanel({ target: { kind: 'submission', mp: makeMp(), entry } });
    await settle();

    // FocusTrap's container div wraps the panel div; collect all focusables from host
    const focusables = Array.from(
      host.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    // Tab from last → first
    last.focus();
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(first);

    // Shift+Tab from first → last
    first.focus();
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(last);
  });

  // 14. Focus return on close
  it('focus return on close: FocusTrap restores focus to trigger button on unmount', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger-btn';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    mountPanel({ target: makeProgressTarget() });
    flushSync();

    // Focus moved into the panel by FocusTrap autofocus
    // Now unmount — FocusTrap cleanup should restore to trigger
    const focusSpy = vi.spyOn(trigger, 'focus');
    unmount(component!);
    component = null;
    expect(focusSpy).toHaveBeenCalled();

    document.body.removeChild(trigger);
  });

  // T15: form mount + focus on result <select>
  it('T15: shows form when canWrite + no eval + not auto-accept; focus on result <select>', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeTruthy();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(document.activeElement).toBe(select);
  });

  // T18: form DOM-absent when canWrite=false
  it('T18: form DOM-absent when canWrite=false', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
    });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T19a: auto-accept banner + no eval, no form, no eval block
  it('T19a: auto-accept banner when is_resubmission + no eval; no form, no eval block', async () => {
    mountPanel({
      target: submissionTarget({ is_resubmission: true, latest_evaluation: null }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('.banner-info')).toBeTruthy();
    expect(host.textContent).toContain('Auto-accepted on resubmission');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('section.evaluation-block')).toBeNull();
  });

  // T19b: auto-accept + eval present → banner + read-only eval block, no form, no [Edit]
  it('T19b: auto-accept + eval present → banner + read-only eval block, no form, no [Edit]', async () => {
    mountPanel({
      target: submissionTarget({
        is_resubmission: true,
        latest_evaluation: {
          id: 99, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: { user_id: 1, full_name: 'AutoAccept' },
          result: 'accepted', score: null, feedback_text: null, has_feedback_file: false,
        },
      }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('.banner-info')).toBeTruthy();
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
    expect(host.textContent).toContain('accepted');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('[data-test="edit-evaluation"]')).toBeNull();
  });

  // T20: validation blocks fetch (incl. score=0)
  it('T20: validation blocks fetch + score=0 valid; clearing error re-enables Save', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(fetchMock).not.toHaveBeenCalled();
    // After first submit attempt with blank result, the verbatim spec error appears.
    expect(host.textContent).toContain('Result is required.');
    select.value = 'major_revision';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Result is required.');
    expect(saveBtn.disabled).toBe(true);
    expect(host.textContent).toContain('Feedback is required when the result is not Accepted.');
    expect(host.textContent).toContain('PDF file required for non-accepted results.');
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '101';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '0';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '-1';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '10.5';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'Needs work';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(saveBtn.disabled).toBe(true);
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(saveBtn.disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // T27: file extension / empty / size / MIME
  it('T27: file extension/empty/size/MIME validation', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement;
    let f = new File(['x'], 'note.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Only PDF files accepted.');
    f = new File([], 'empty.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('File appears empty.');
    const big = new Uint8Array(21 * 1024 * 1024);
    f = new File([big], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('File exceeds 20 MB limit.');
    f = new File([new Uint8Array([0x50])], 'fake.pdf', { type: 'application/msword' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Only PDF files accepted.');
    f = new File([new Uint8Array([0x25, 0x50])], 'ok.pdf', { type: '' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Only PDF files accepted.');
    f = new File([new Uint8Array([0x25, 0x50])], 'ok2.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Only PDF files accepted.');
  });

  // T32: char counter — aria-live region updates only ≥900
  it('T32: char counter aria-live updates only when crossing 900 chars', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    const live = host.querySelector('[data-test="feedback-counter-live"]') as HTMLElement;
    const visible = host.querySelector('[data-test="feedback-counter-visible"]') as HTMLElement;
    expect(live).toBeTruthy();
    expect(visible).toBeTruthy();
    textarea.value = 'abcde';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(visible.textContent).toContain('5');
    expect(live.textContent).toBe('');
    textarea.value = 'a'.repeat(899);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(visible.textContent).toContain('899');
    expect(live.textContent).toBe('');
    textarea.value = 'a'.repeat(900);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(visible.textContent).toContain('900');
    expect(visible.textContent).toContain('approaching');
    expect(host.querySelector('[data-test="feedback-counter-visible"] strong')).toBeTruthy();
    // aria-live emits the CONSTANT 'Approaching limit' (NOT the running count) so
    // SR announces ONCE on the empty→constant transition at 900.
    expect(live.textContent).toBe('Approaching limit');
    // Typing past 900 must NOT mutate the live content (no re-announce).
    textarea.value = 'a'.repeat(950);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(live.textContent).toBe('Approaching limit');
    // Dropping back below 900 clears the live region (no announcement on emptying).
    textarea.value = 'a'.repeat(800);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(live.textContent).toBe('');
  });

  // T35: "Awaiting evaluation" placeholder
  it('T35: "Awaiting evaluation" placeholder when canWrite=false + no resubmission + no eval', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'awaiting_eval',
        is_resubmission: false,
        latest_evaluation: null,
      }),
    });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('.banner-info')).toBeNull();
    expect(host.textContent).toContain('Awaiting evaluation');
  });

  // T40: visible "(required)" + aria-describedby
  it('T40: result <select> has visible "(required)" helper text + aria-describedby', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const helper = host.querySelector('#evaluation-result-helper') as HTMLElement;
    expect(helper).toBeTruthy();
    expect(helper.textContent).toContain('(required)');
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    const desc = select.getAttribute('aria-describedby') ?? '';
    expect(desc.split(/\s+/)).toContain('evaluation-result-helper');
  });

  // T21: POST happy — FormData contents, URL, X-Requested-With, credentials; aria-busy on Save during submit
  it('T21: POST happy — FormData contents, URL, X-Requested-With, credentials; aria-busy during submit', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50])], 'fb.pdf', { type: 'application/pdf' });
    const evalResp = { id: 7, submission_id: 100, result: 'accepted', score: 95, feedback_text: 'OK', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    let resolveFetch!: (v: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '95';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'OK';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [pdf], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.getAttribute('aria-busy')).toBe('true');
    expect(saveBtn.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/submissions/100/evaluation');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('mathion');
    const fd = init.body as FormData;
    expect(fd.get('result')).toBe('accepted');
    expect(fd.get('score')).toBe('95');
    expect(fd.get('feedback_text')).toBe('OK');
    expect(fd.get('file')).toBe(pdf);
    // After resolveFetch the Save success path unmounts the form (cascade
    // transitions to read-only + [Edit]). The captured `saveBtn` is now detached
    // so don't assert on its post-resolution state — T30 covers focus-to-Edit.
    resolveFetch(new Response(JSON.stringify(evalResp), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(host.querySelector('button[data-test="edit-evaluation"]')).toBeTruthy();
  });

  // T23: toast pushed with success message + kind
  it('T23: pushToast called with success message + kind on POST success', async () => {
    const evalResp = { id: 8, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(evalResp), { status: 201, headers: { 'Content-Type': 'application/json' } })));
    vi.mocked(pushToast).mockClear();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(pushToast).toHaveBeenCalledWith('Evaluation saved; group notified', 'success');
  });

  // T26b: onRefetch invoked once on PATCH success (parallel to T26 for POST)
  it('T26b: onRefetch invoked exactly once on PATCH success', async () => {
    const initialEval = { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true };
    const updatedEval = { id: 42, submission_id: 100, result: 'accepted', score: 95, feedback_text: 'Good', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(updatedEval), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: initialEval,
        submissionId: 100,
      }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  // T26: onRefetch invoked once on POST success
  it('T26: onRefetch invoked exactly once on POST success', async () => {
    const evalResp = { id: 9, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(evalResp), { status: 201, headers: { 'Content-Type': 'application/json' } })));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  // T22: PATCH happy — JSON body, no file key, URL
  it('T22: PATCH happy — JSON body, no file key, URL /api/evaluations/{eid}', async () => {
    const initialEval = { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true };
    const updatedEval = { id: 42, submission_id: 100, result: 'accepted', score: 90, feedback_text: 'OK now', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(updatedEval), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: initialEval,
        submissionId: 100,
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '90';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'OK now';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/evaluations/42');
    expect(init.method).toBe('PATCH');
    // api.patch routes through request() which wraps headers via new Headers(...).
    // Read with Headers.get(), not bracket access on a plain object.
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('Content-Type')).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ result: 'accepted', score: 90, feedback_text: 'OK now' });
    expect('file' in body).toBe(false);
  });

  // T24: 4xx error → banner role=alert; form values preserved; Save re-enabled
  it('T24: 4xx error banner + form values preserved + Save re-enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Bad request' }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '75';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const banner = host.querySelector('[role="alert"].form-error') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Bad request');
    expect(select.value).toBe('accepted');
    expect(scoreInput.value).toBe('75');
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  // T31: 409 → onRefetch + form transitions to read-only (form gone)
  it('T31: 409 → onRefetch called + form removed from DOM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Already evaluated' }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T31b: 409 race where refetch populates the winning eval → read-only block renders
  it('T31b: 409 → onRefetch populates target.entry.latest_evaluation → read-only with winning eval', async () => {
    const winningEval = {
      id: 77, evaluated_at: '2026-06-04T11:50:00Z',
      evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'OK', has_feedback_file: false,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Already evaluated' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    ));
    const startTarget = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    // Wrap target in $state so we can mutate it from inside onRefetch (simulating
    // RunSubmissionTab's selectedIds-derived rebind after a refresh).
    const wrappedTarget = $state({ ...startTarget, entry: { ...startTarget.entry } });
    const onRefetch = vi.fn(() => {
      wrappedTarget.entry = { ...wrappedTarget.entry, latest_evaluation: winningEval, status: 'accepted' };
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, {
      target: host,
      props: { target: wrappedTarget, onClose: vi.fn(), isAdmin: true, isTeacher: false, onRefetch },
    });
    flushSync();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
    expect(host.textContent).toContain('88');
    expect(host.textContent).toContain('Other Prof');
  });

  // T29: timeout → banner + Save re-enabled + values preserved
  it('T29: timeout → "Upload timed out. Try again." banner; Save re-enabled', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    flushSync();
    await tick(); await tick();
    flushSync();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.getAttribute('aria-busy')).toBe('true');
    await vi.advanceTimersByTimeAsync(60_001);
    flushSync();
    expect(host.textContent).toContain('Upload timed out. Try again.');
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.getAttribute('aria-busy')).toBe('false');
    expect(select.value).toBe('accepted');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // T33: after POST, [Edit] uses stateLatestEvaluation.id for PATCH (refetch never resolves)
  it('T33: POST → state.latestEvaluation; [Edit] + Save → PATCH /api/evaluations/{newId}', async () => {
    const created = { id: 42, submission_id: 100, result: 'accepted', score: 80, feedback_text: '', has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    const patched = { id: 42, submission_id: 100, result: 'accepted', score: 95, feedback_text: '', has_feedback_file: false, evaluated_at: '2026-06-04T12:05:00Z', evaluated_by: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(patched), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onRefetch = vi.fn(() => new Promise<void>(() => {}));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100, latest_evaluation: null }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '80';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(editBtn).toBeTruthy();
    editBtn.click();
    await settle();
    const scoreInput2 = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput2.value = '95';
    scoreInput2.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form2 = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form2.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/evaluations/42');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
  });

  // T36: user-cancel during submit → no banner, form values preserved, Save re-enabled
  it('T36: user-cancel during submit → no banner, form values preserved', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    flushSync();
    await tick(); await tick();
    flushSync();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    const cancelBtn = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(host.querySelector('[role="alert"].form-error')).toBeNull();
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    expect(select.value).toBe('accepted');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

});
