import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

import DashboardSidePanel from '../components/runs/DashboardSidePanel.svelte';
import type { PanelTarget } from '../components/runs/DashboardSidePanel.svelte';
import type { DashboardMpRow, DashboardMpGroupEntry } from '../lib/dashboards';
import { formatLocalWithTz } from '../lib/datetime';
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';

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

// Routes fetch by URL+method: thread GET → `thread`; evaluation POST/PATCH → `evalResponse`.
function routedFetch(opts: { thread?: unknown; evalResponse?: { status: number; body: unknown } } = {}) {
  const threadBody = opts.thread ?? { submissions: [] };
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    if (method === 'GET' && u.includes('/groups/') && u.endsWith('/submissions')) {
      return Promise.resolve(new Response(JSON.stringify(threadBody), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    const er = opts.evalResponse ?? { status: 201, body: {} };
    return Promise.resolve(new Response(JSON.stringify(er.body), {
      status: er.status, headers: { 'Content-Type': 'application/json' },
    }));
  });
}

// Serves thread GETs from `threads` in order (last entry sticks); eval POST/PATCH from `evalResponse`.
// Use when the thread body must DIFFER across fetches (mount vs post-write/409 refetch).
function sequencedThreadFetch(threads: unknown[], evalResponse?: { status: number; body: unknown }) {
  let i = 0;
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    if (method === 'GET' && u.includes('/groups/') && u.endsWith('/submissions')) {
      const t = threads[Math.min(i, threads.length - 1)] ?? { submissions: [] };
      i += 1;
      return Promise.resolve(new Response(JSON.stringify(t), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    const er = evalResponse ?? { status: 201, body: {} };
    return Promise.resolve(new Response(JSON.stringify(er.body), {
      status: er.status, headers: { 'Content-Type': 'application/json' },
    }));
  });
}

// Thread body whose single entry mirrors a submission target's cell entry.
function echoThread(target: { entry: DashboardMpGroupEntry }) {
  const s = target.entry.latest_submission!;
  return { submissions: [{ ...s, evaluation: target.entry.latest_evaluation }] };
}

// Eval-endpoint calls only (thread GETs are filtered out). The `u` slot is elided
// with a leading comma — `noUnusedParameters` is on, so a named-but-unused `u` fails.
function evalCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, i]) => {
    const method = ((i as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return method === 'POST' || method === 'PATCH';
  }) as [string, RequestInit][];
}

// The drawer's frame (6c D27): Modal's ×, the dialog's title, the footer confirm.
const closeX = () => host.querySelector('.modal-head button[aria-label="Close"]') as HTMLButtonElement;
function panelTitle(): HTMLElement | null {
  const dialog = host.querySelector('section.modal-panel') as HTMLElement;
  return document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
}
// The discard confirm sits in the form's button row (user, 6c Safari pass, rev 8).
const discardCancel = () => host.querySelector<HTMLButtonElement>('form[aria-label="Write evaluation"] .sp-discard .inline-confirm button.cancel');
const discardConfirm = () => host.querySelector<HTMLButtonElement>('form[aria-label="Write evaluation"] .sp-discard button.confirm[data-action="confirm-discard"]');
// While the confirm asks, everything else in the drawer body is inert.
const frozen = () => [
  host.querySelector('.modal-body > section.sp-card'),
  host.querySelector('#evaluation-result'),
  host.querySelector('.sp-fields'),
  host.querySelector('.sp-bottom'),
].map((el) => el!.hasAttribute('inert'));

// The Result radios (R37); a click picks one (a disabled one stays unpicked).
const resultRadio = (value: string) =>
  host.querySelector(`input[name="evaluation-result"][value="${value}"]`) as HTMLInputElement;
function pickResult(value: string) {
  resultRadio(value).click();
  flushSync();
}
const checkedResult = () =>
  (host.querySelector('input[name="evaluation-result"]:checked') as HTMLInputElement | null)?.value ?? '';

// Types into Feedback with focus in it (makes the form dirty).
async function typeFeedback(text: string) {
  const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
  textarea.focus();
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return textarea;
}

const NEEDS_REVISION_EVAL = {
  id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' },
  result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true,
};

interface MountPanelOpts {
  target: PanelTarget;
  onClose?: () => void;
  isAdmin?: boolean;
  isTeacher?: boolean;
  onRefetch?: () => void;
  blockLabel?: string;
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
      blockLabel: opts.blockLabel,
    },
  });
  flushSync();
  return { host, onClose: onClose as ReturnType<typeof vi.fn>, onRefetch: onRefetch as ReturnType<typeof vi.fn> };
}

// Drain the async chain deterministically. A fixed count of `tick()`s (microtask
// hops) is environment-fragile: node 22's undici uses one more microtask to read a
// Response body than newer nodes, so a 3-tick wait passed locally but left the panel
// mid-load in CI. Crossing a macrotask boundary (`setTimeout` 0) flushes the ENTIRE
// pending microtask queue regardless of its length; interleaving `flushSync()` applies
// Svelte effects (incl. the `tick().then(() => …focus())` handlers) between rounds. A
// few rounds cover chained load → $effect → focus stages. Every test that asserts a
// still-pending/loading state uses a never-resolving fetch, so full draining is safe.
async function settle() {
  for (let i = 0; i < 5; i++) {
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(pushToast).mockClear();
  vi.stubGlobal('fetch', routedFetch()); // default: empty thread; tests needing a body/eval override this
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
  return { kind: 'submission' as const, runId: 1, mp: makeMp(), entry };
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
    expect(host.textContent).toContain('Item details unavailable. The dashboard may be out of date — close this panel and refresh the table.');
  });

  // 5. Progress variant: non-404 error → same uniform message
  it('progress variant: network error shows same uniform error message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(host.textContent).toContain('Item details unavailable. The dashboard may be out of date — close this panel and refresh the table.');
  });

  // 6. Submission variant: renders submission + evaluation
  it('submission variant: renders the block title, group, submission, and evaluation details', async () => {
    const mp = makeMp();
    const entry = makeEntry();
    mountPanel({ target: { kind: 'submission', runId: 1, mp, entry } });
    expect(panelTitle()!.textContent).toBe('Block X');
    expect(host.textContent).toContain('Block X');
    expect(host.textContent).toContain('G7');
    expect(host.textContent).toContain('Submission');
    expect(host.textContent).toContain('Evaluation');
    // submission_number
    expect(host.textContent).toContain('2');
    // result (RESULT_LABEL)
    expect(host.textContent).toContain('Accepted');
    // score
    expect(host.textContent).toContain('95');
    // feedback
    expect(host.textContent).toContain('Great work');
  });

  // 7. Submission variant: not_submitted
  it('submission variant: not_submitted renders "Not submitted yet." without Submission/Evaluation headings', async () => {
    const entry = makeEntry({ status: 'not_submitted', latest_submission: null, latest_evaluation: null });
    mountPanel({ target: { kind: 'submission', runId: 1, mp: makeMp(), entry } });
    expect(host.textContent).toContain('Not submitted yet.');
    // Should NOT have Submission or Evaluation section headings
    const h3s = Array.from(host.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(h3s).not.toContain('Latest submission');
    expect(h3s).not.toContain('Evaluation');
  });

  // 8. Submission variant: awaiting_eval omits Evaluation block
  it('submission variant: awaiting_eval shows Submission block but omits Evaluation block', async () => {
    const entry = makeEntry({
      status: 'awaiting_eval',
      latest_evaluation: null,
    });
    mountPanel({ target: { kind: 'submission', runId: 1, mp: makeMp(), entry } });
    const h3s = Array.from(host.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(h3s).toContain('Latest submission');
    expect(h3s).not.toContain('Evaluation');
  });

  // 9. Submission variant: download links
  it('submission variant: download links use verified URL patterns', async () => {
    const entry = makeEntry(); // has_feedback_file=true, submission.id=42, evaluation.id=99
    mountPanel({ target: { kind: 'submission', runId: 1, mp: makeMp(), entry } });
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

  // 11. D29: a click on the dimmed page does not close the panel
  it('backdrop click does nothing (D29)', () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    const { onClose } = mountPanel({ target: makeProgressTarget() });
    const backdrop = host.querySelector('div.modal-backdrop') as HTMLElement;
    expect(backdrop).toBeTruthy();
    backdrop.click();
    flushSync();
    expect(onClose).not.toHaveBeenCalled();
  });

  // 12. Close button closes panel
  it('close button calls onClose', () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    const { onClose } = mountPanel({ target: makeProgressTarget() });
    const closeBtn = closeX();
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    flushSync();
    expect(onClose).toHaveBeenCalled();
  });

  // 13. Focus trap Tab/Shift+Tab cycle
  it('focus trap: Tab (last→first) and Shift+Tab (first→last) cycle per spec §13', async () => {
    const entry = makeEntry();
    mountPanel({ target: { kind: 'submission', runId: 1, mp: makeMp(), entry } });
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
  it('T15: shows form when canWrite + no eval + not auto-accept; focus on the first Result radio', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeTruthy();
    expect(document.activeElement).toBe(resultRadio('accepted'));
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
    expect(host.querySelector('[data-test="evaluation-card"]')).toBeNull();
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
    expect(host.querySelector('[data-test="evaluation-card"]')).toBeTruthy();
    expect(host.textContent).toContain('accepted');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('[data-test="edit-evaluation"]')).toBeNull();
  });

  // T20: validation blocks fetch (incl. score=0)
  it('T20: validation blocks fetch + score=0 valid; clearing error re-enables Save', async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(evalCalls(fetchMock)).toHaveLength(0);
    // After first submit attempt with blank result, the verbatim spec error appears.
    expect(host.textContent).toContain('Result is required.');
    pickResult('major_revision');
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
    pickResult('accepted');
    expect(saveBtn.disabled).toBe(false);
    expect(evalCalls(fetchMock)).toHaveLength(0);
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
  it('T40: the Result radiogroup shows "(required)", is aria-required, and its error describes it', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const group = host.querySelector('fieldset#evaluation-result') as HTMLFieldSetElement;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-required')).toBe('true');
    expect(group.querySelector('legend')!.textContent).toBe('Result (required)');
    expect(group.hasAttribute('aria-describedby')).toBe(false);
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect((group.getAttribute('aria-describedby') ?? '').split(/\s+/)).toContain('evaluation-result-error');
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
    pickResult('accepted');
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
    // R44: busy, not disabled — it keeps focus.
    expect(saveBtn.getAttribute('aria-disabled')).toBe('true');
    expect(saveBtn.disabled).toBe(false);
    expect(evalCalls(fetchMock)).toHaveLength(1);
    const [url, init] = evalCalls(fetchMock)[0];
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
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 201, body: evalResp } }));
    vi.mocked(pushToast).mockClear();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    pickResult('accepted');
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(pushToast).toHaveBeenCalledWith('Evaluation saved; group notified', 'success');
  });

  // T26b: onRefetch invoked once on PATCH success (parallel to T26 for POST)
  it('T26b: onRefetch invoked exactly once on PATCH success', async () => {
    const initialEval = { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true };
    const updatedEval = { id: 42, submission_id: 100, result: 'accepted', score: 95, feedback_text: 'Good', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 200, body: updatedEval } }));
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
    pickResult('accepted');
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  // T26: onRefetch invoked once on POST success
  it('T26: onRefetch invoked exactly once on POST success', async () => {
    const evalResp = { id: 9, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 201, body: evalResp } }));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    pickResult('accepted');
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  // T22: PATCH happy — JSON body, no file key, URL
  it('T22: PATCH happy — JSON body, no file key, URL /api/evaluations/{eid}', async () => {
    const initialEval = { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true };
    const updatedEval = { id: 42, submission_id: 100, result: 'accepted', score: 90, feedback_text: 'OK now', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    const fetchMock = routedFetch({ evalResponse: { status: 200, body: updatedEval } });
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
    pickResult('accepted');
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
    const calls = evalCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
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
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 400, body: { detail: 'Bad request' } } }));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    pickResult('accepted');
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
    expect(checkedResult()).toBe('accepted');
    expect(scoreInput.value).toBe('75');
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  // T31: 409 → onRefetch + form transitions to read-only (form gone)
  it('T31: 409 → onRefetch called + form removed from DOM', async () => {
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 409, body: { detail: 'Already evaluated' } } }));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    pickResult('accepted');
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T31b: 409 race — the winning eval now arrives via the post-409 thread refetch (Step 11(3)),
  // NOT via onRefetch mutating the cell. Use a sequenced thread: awaiting at mount (form shows),
  // winning after the 409.
  it('T31b: 409 → post-409 thread refetch surfaces the winning eval read-only', async () => {
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const winning = { submissions: [{ ...start.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Winner', has_feedback_file: false } }] };
    vi.stubGlobal('fetch', sequencedThreadFetch(
      [echoThread(start), winning],
      { status: 409, body: { detail: 'Already evaluated' } },
    ));
    const { onRefetch } = mountPanel({ target: start, isAdmin: true });
    await settle();
    // fill result + submit → POST returns 409 → 409 branch calls onRefetch + refetches thread → winning eval
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle(); // POST → 409 branch → onRefetch + thread refetch → winning eval renders (two awaited hops)
    expect(host.textContent).toContain('88');          // winning score, from the post-409 thread refetch
    expect(host.textContent).toContain('Other Prof');  // winning evaluator
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  // Rev 8: the discard confirm lives in the form, so with the form gone (here a
  // 409 race, the edits still in state) × must close, not ask an unseen question.
  it('after a 409 race replaces the form, × closes the panel; nothing is left inert', async () => {
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const winning = { submissions: [{ ...start.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Winner', has_feedback_file: false } }] };
    vi.stubGlobal('fetch', sequencedThreadFetch(
      [echoThread(start), winning],
      { status: 409, body: { detail: 'Already evaluated' } },
    ));
    const { onClose } = mountPanel({ target: start, isAdmin: true });
    await settle();
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    closeX().click();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[inert]')).toBeNull();
    vi.unstubAllGlobals();
  });

  // Rev 8: a stale cell — the confirm is open when the first thread load lands
  // with an evaluation and takes the form (and the confirm) away; the drawer must
  // not stay frozen on a question nobody can see (round 2 review).
  it('the confirm goes with the form when the thread brings an evaluation; × then closes', async () => {
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let release: (body: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      release = (body) => resolve(new Response(JSON.stringify(body), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    })));
    const { onClose } = mountPanel({ target: start, isAdmin: true });
    flushSync();
    pickResult('accepted');
    closeX().click();
    flushSync();
    expect(discardCancel()).not.toBeNull();
    release({ submissions: [{ ...start.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Winner', has_feedback_file: false } }] });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('[inert]')).toBeNull();
    closeX().click();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  // A 409 race leaves the lost edits behind; a later resubmission's create form
  // must start empty, not with the old submission's feedback (round 2 review).
  it('after a 409 race, a later resubmission opens an empty create form', async () => {
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const winning = { submissions: [{ ...start.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Winner', has_feedback_file: false } }] };
    const next = submissionTarget({ status: 'awaiting_eval', submissionId: 101 });
    const resubmitted = { submissions: [
      { ...next.entry.latest_submission!, evaluation: null },
      winning.submissions[0],
    ] };
    vi.stubGlobal('fetch', sequencedThreadFetch(
      [echoThread(start), winning, resubmitted],
      { status: 409, body: { detail: 'Already evaluated' } },
    ));
    const box = $state({ target: start as PanelTarget, onClose: vi.fn(), isAdmin: true, isTeacher: false, onRefetch: vi.fn() });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, { target: host, props: box });
    await settle();
    pickResult('accepted');
    await typeFeedback('Written for the old submission');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    box.target = next;
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).not.toBeNull();
    expect(checkedResult()).toBe('');
    expect((host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement).value).toBe('');
    vi.unstubAllGlobals();
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
    pickResult('accepted');
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.getAttribute('aria-busy')).toBe('true');
    await vi.advanceTimersByTimeAsync(60_001);
    flushSync();
    expect(host.textContent).toContain('Upload timed out. Try again.');
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.getAttribute('aria-busy')).toBeNull();
    expect(checkedResult()).toBe('accepted');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // T33: after POST, [Edit] uses stateLatestEvaluation.id for PATCH (refetch never resolves)
  it('T33: POST → state.latestEvaluation; [Edit] + Save → PATCH /api/evaluations/{newId}', async () => {
    // POST returns id 42; default empty thread → post-write clear (Step 12) does NOT fire
    // (res.submissions.length === 0), so effectiveEvaluation stays the flat POST eval → PATCH targets 42.
    const created = { id: 42, submission_id: 100, result: 'accepted', score: 80, feedback_text: '', has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    const fetchMock = routedFetch({ evalResponse: { status: 201, body: created } });
    vi.stubGlobal('fetch', fetchMock);
    const onRefetch = vi.fn(() => new Promise<void>(() => {}));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100, latest_evaluation: null }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    pickResult('accepted');
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
    const calls = evalCalls(fetchMock);
    const patch = calls.find(([, i]) => (i.method ?? '').toUpperCase() === 'PATCH')!;
    expect(patch[0]).toBe('/api/evaluations/42');
    expect(patch[1].method).toBe('PATCH');
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
    pickResult('accepted');
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
    expect(checkedResult()).toBe('accepted');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // T16: read-only block + [Edit] when canWrite + eval present
  it('T16: read-only block + [Edit] when canWrite + eval present', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('[data-test="evaluation-card"]')).toBeTruthy();
    expect(host.querySelector('button[data-test="edit-evaluation"]')).toBeTruthy();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T34: canWrite=false + eval → read-only, no [Edit]
  it('T34: canWrite=false + eval → read-only block, no [Edit]', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'accepted',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'accepted', score: 95, feedback_text: 'Good', has_feedback_file: true },
      }),
    });
    await settle();
    expect(host.querySelector('[data-test="evaluation-card"]')).toBeTruthy();
    expect(host.querySelector('button[data-test="edit-evaluation"]')).toBeNull();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T17: Edit pre-fills with existing values (null and non-null variants)
  it('T17: [Edit] expands pre-filled form; null score → empty input, null text → empty textarea', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'rejected',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'rejected', score: null, feedback_text: null, has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect(checkedResult()).toBe('rejected');
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    expect(scoreInput.value).toBe('');
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  // T17 non-null variant: pre-fill round-trips full values from existing eval
  it('T17 non-null: [Edit] pre-fills select/score/textarea with existing values', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect(checkedResult()).toBe('major_revision');
    expect((host.querySelector('input[name="evaluation-score"]') as HTMLInputElement).value).toBe('60');
    expect((host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement).value).toBe('Needs work');
  });

  // T25: result-lock — disabled non-accepted options + verbatim text + Save guarded
  it('T25: result-lock — three radios disabled with the lock line; a click on one changes nothing', async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({
        status: 'accepted',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'accepted', score: 85, feedback_text: null, has_feedback_file: false },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const LOCK = 'Without a feedback file the result can only be Accepted.';
    for (const v of ['minor_revision', 'major_revision', 'rejected']) {
      expect(resultRadio(v).disabled).toBe(true);
      expect(resultRadio(v).title).toBe(LOCK);
    }
    expect(resultRadio('accepted').disabled).toBe(false);
    expect(checkedResult()).toBe('accepted');
    expect(host.querySelector('#evaluation-result-lock')!.textContent).toBe(LOCK);
    const desc = host.querySelector('fieldset#evaluation-result')!.getAttribute('aria-describedby') ?? '';
    expect(desc.split(/\s+/)).toContain('evaluation-result-lock');
    pickResult('rejected');
    expect(checkedResult()).toBe('accepted');
    expect(evalCalls(fetchMock)).toHaveLength(0);
  });

  // T38: file picker hidden in edit
  it('T38: file picker hidden in edit', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });

  // T39: "Replace not supported (Phase 9)" placeholder in edit
  it('T39: "The feedback file cannot be replaced." placeholder in edit', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect(host.textContent).toContain('The feedback file cannot be replaced.');
  });

  // T37: Cancel button DOM-absent in clean create
  it('T37: Cancel button is DOM-absent in clean create (no edit + no submit)', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('button[data-test="cancel-button"]')).toBeNull();
  });

  // T28: clean create + Escape → close without prompt
  it('T28: clean create + Escape → onClose (no InlineConfirm)', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.inline-confirm')).toBeNull();
  });

  // T30: focus moves to [Edit] after successful Save
  it('T30: focus moves to [Edit] after successful Save', async () => {
    const evalResp = { id: 8, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 201, body: evalResp } }));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    pickResult('accepted');
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(editBtn);
  });

  // T30b: focus moves to result <select> after [Edit] click
  it('T30b: focus moves to the checked Result radio after [Edit] click', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect(document.activeElement).toBe(resultRadio('major_revision'));
  });

  // T28b: dirty create + Escape → the confirm in the form's button row, focus on its Cancel, the rest inert
  it("T28b: dirty create + Escape → the confirm replaces the form's buttons; focus on its Cancel; the rest inert", async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    await typeFeedback('unsaved');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(host.querySelector('footer.modal-foot')).toBeNull();
    expect(host.querySelector('form[aria-label="Write evaluation"] .sp-discard')!.textContent).toContain('Discard unsaved changes?');
    expect(discardConfirm()).toBeTruthy();
    expect(host.querySelector('form[aria-label="Write evaluation"] button[type="submit"]')).toBeNull();
    expect(document.activeElement).toBe(discardCancel());
    expect(host.querySelector('.modal-body')!.hasAttribute('inert')).toBe(false);
    expect(frozen()).toEqual([true, true, true, true]);
    expect(discardCancel()!.closest('[inert]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  // T28c (D29): a click on the dimmed page does nothing, even with edits
  it('T28c: dirty + backdrop click → nothing (D29)', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    await typeFeedback('unsaved');
    (host.querySelector('div.modal-backdrop') as HTMLElement).click();
    await settle();
    expect(discardCancel()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  // T28d: dirty + × → the footer confirm, focus on its Cancel
  it('T28d: dirty + × → the footer confirm; focus on its Cancel', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    await typeFeedback('unsaved');
    closeX().click();
    await settle();
    expect(discardConfirm()).toBeTruthy();
    expect(document.activeElement).toBe(discardCancel());
  });

  // T28e: during submit, Escape is a no-op
  it('T28e: during submit, Escape → no InlineConfirm, no onClose', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    pickResult('accepted');
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(host.querySelector('.inline-confirm')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    const cancelBtn = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();
    await settle();
  });

  // T30c: focus moves to [Edit] after Cancel-in-edit (clean, no prompt)
  it('T30c: Cancel in clean edit-mode → focus moves to [Edit]', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const cancelBtn = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();
    await settle();
    expect(host.querySelector('.inline-confirm')).toBeNull();
    const editBtnAfter = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(editBtnAfter);
  });

  // T8FIX: post-save × Close should NOT raise InlineConfirm — formState/prefillSnapshot
  // must be cleared in handleSave success path so isDirty is false.
  it('T8FIX: post-save × Close → no InlineConfirm + onClose called (form state cleared)', async () => {
    const evalResp = { id: 9, submission_id: 100, result: 'accepted', score: 80, feedback_text: '', has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 201, body: evalResp } }));
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    pickResult('accepted');
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '80';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const closeBtn = closeX();
    closeBtn.click();
    await settle();
    expect(host.querySelector('.inline-confirm')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('thread: renders historical entries collapsed under "Earlier submissions"', async () => {
    const t = submissionTarget({ status: 'accepted', submissionId: 100 });
    const thread = {
      submissions: [
        { ...t.entry.latest_submission!, evaluation: t.entry.latest_evaluation },
        { id: 55, submission_number: 1, submitted_at: '2026-06-01T09:00:00Z',
          submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
          file_size: 500,
          evaluation: { id: 7, evaluated_at: '2026-06-01T12:00:00Z', evaluated_by: { user_id: 3, full_name: 'Prof' },
            result: 'rejected', score: 10, feedback_text: 'Redo', has_feedback_file: false } },
      ],
    };
    vi.stubGlobal('fetch', routedFetch({ thread }));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-history"]')).toBeTruthy();
    expect(host.textContent).toContain('Earlier submissions');
    const toggles = host.querySelectorAll('[data-test="thread-entry-toggle"]');
    expect(toggles).toHaveLength(1); // only the ONE older entry (newest is panel-rendered)
    // collapsed: detail hidden until clicked
    expect(host.textContent).not.toContain('Redo');
    (toggles[0] as HTMLButtonElement).click();
    flushSync();
    expect(host.textContent).toContain('Redo');
  });

  it('thread: single-entry thread renders no historical region', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    vi.stubGlobal('fetch', routedFetch({ thread: echoThread(t) }));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-history"]')).toBeNull();
    expect(host.textContent).not.toContain('Earlier submissions');
  });

  it('thread: error state shows retry; retry re-fetches', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let calls = 0;
    const failing = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url); const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'GET' && u.endsWith('/submissions')) {
        calls += 1;
        if (calls === 1) return Promise.reject(new TypeError('network down'));
        return Promise.resolve(new Response(JSON.stringify(echoThread(t)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', failing);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeTruthy();
    (host.querySelector('[data-test="thread-retry"]') as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeNull();
    expect(calls).toBe(2);
  });

  it('thread wins: create posts to thread[0].id, not the stale cell submission id', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    // Group resubmitted after the grid loaded: thread newest id 200 (no eval yet).
    const thread = { submissions: [
      // is_resubmission MUST be false: a true value renders the auto-accept banner
      // (DashboardSidePanel `{#if sub.is_resubmission}` at ~:417) instead of the write form,
      // so the create form would be absent and the submit dispatch would find nothing to submit.
      { id: 200, submission_number: 3, submitted_at: '2026-06-05T10:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
        file_size: 999, evaluation: null },
    ] };
    const fetchMock = routedFetch({ thread, evalResponse: { status: 201, body: { id: 9, submission_id: 200, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: 1 } } });
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    // fill + submit the create form (result = accepted needs no feedback file)
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const posted = evalCalls(fetchMock).find(([, i]) => (i.method ?? '').toUpperCase() === 'POST')!;
    expect(posted[0]).toBe('/api/submissions/200/evaluation'); // thread[0].id, not 100
  });

  it('write success refetches the thread and calls onRefetch', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const fetchMock = routedFetch({ thread: echoThread(t), evalResponse: { status: 201, body: { id: 9, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: 1 } } });
    vi.stubGlobal('fetch', fetchMock);
    const { onRefetch } = mountPanel({ target: t, isAdmin: true });
    await settle();
    const threadGetsBefore = fetchMock.mock.calls.filter(([u, i]) => ((i as RequestInit)?.method ?? 'GET') === 'GET' && String(u).endsWith('/submissions')).length;
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const threadGetsAfter = fetchMock.mock.calls.filter(([u, i]) => ((i as RequestInit)?.method ?? 'GET') === 'GET' && String(u).endsWith('/submissions')).length;
    expect(threadGetsAfter).toBe(threadGetsBefore + 1); // post-write refetch
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it('not_submitted: no thread fetch, no history, no write form', async () => {
    const entry = makeEntry({ status: 'not_submitted', latest_submission: null, latest_evaluation: null });
    const t = { kind: 'submission' as const, runId: 1, mp: makeMp(), entry };
    const fetchMock = routedFetch();
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.textContent).toContain('Not submitted yet.');
    expect(host.querySelector('[data-test="thread-history"]')).toBeNull();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    const threadGets = fetchMock.mock.calls.filter(([u, i]) => ((i as RequestInit)?.method ?? 'GET') === 'GET' && String(u).endsWith('/submissions'));
    expect(threadGets).toHaveLength(0);
  });

  it('thread: an expanded historical entry survives a write (real grid-reload onRefetch)', async () => {
    // This MUST drive a data-mutating onRefetch — the production regression only fires
    // when onRefetch changes the cell's evaluation id (null→N), which makes the thread
    // effect refire. A no-op onRefetch (mountPanel's default) never triggers the refire,
    // so it would pass even against the broken code. We mount via a $state box (same
    // pattern as the progress-race test at :176) and mutate the target in onRefetch,
    // mirroring RunSubmissionTab.refresh().
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const thread = { submissions: [
      { ...t.entry.latest_submission!, is_resubmission: false, evaluation: null }, // newest: write form
      { id: 55, submission_number: 1, submitted_at: '2026-06-01T09:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
        file_size: 500,
        evaluation: { id: 7, evaluated_at: '2026-06-01T12:00:00Z', evaluated_by: { user_id: 3, full_name: 'Prof' },
          result: 'rejected', score: 10, feedback_text: 'Redo', has_feedback_file: false } },
    ] };
    vi.stubGlobal('fetch', routedFetch({ thread, evalResponse: { status: 201, body: { id: 9, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: 1 } } }));
    const box = $state<{ target: PanelTarget; onClose: () => void; isAdmin: boolean; isTeacher: boolean; onRefetch: () => void }>({
      target: t,
      onClose: vi.fn(),
      isAdmin: true,
      isTeacher: false,
      onRefetch: () => {
        // grid reload lands the just-created evaluation on THIS cell → cell eval id null→9,
        // which makes submissionLatestEvalId change and the thread effect refire.
        box.target = { ...t, entry: { ...t.entry, status: 'accepted', latest_evaluation: {
          id: 9, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' },
          result: 'accepted', score: null, feedback_text: null, has_feedback_file: false } } };
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, { target: host, props: box });
    flushSync();
    await settle();
    // expand the single historical entry
    (host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement).click();
    flushSync();
    expect(host.textContent).toContain('Redo');
    // write an evaluation on the newest submission → onRefetch mutates the cell eval id → effect refires
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle(); // POST → onRefetch mutates target → effect refires → thread refetch (two awaited hops)
    // expandedById is keyed by submission id and is NEVER reset by the effect → entry 55 stays open
    expect(host.textContent).toContain('Redo');
  });

  it('thread: a cell switch aborts the in-flight thread fetch and does not render the stale thread', async () => {
    // Mirrors the progress-race test (:176) for the submission/thread variant.
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => {
      signals.push(opts.signal as AbortSignal);
      return new Promise<Response>(() => { /* never resolves */ });
    }));
    const a = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const b: PanelTarget = { kind: 'submission', runId: 1, mp: makeMp(), entry: makeEntry({
      group_id: 8, group_name: 'G8', status: 'awaiting_eval', latest_evaluation: null,
      latest_submission: { id: 200, submission_number: 1, submitted_at: '2026-06-05T10:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false, file_size: 999 },
    }) };
    const box = $state<{ target: PanelTarget; onClose: () => void; isAdmin: boolean; isTeacher: boolean; onRefetch: () => void }>({
      target: a, onClose: vi.fn(), isAdmin: true, isTeacher: false, onRefetch: vi.fn(),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, { target: host, props: box });
    flushSync();
    expect(signals.length).toBe(1);
    const first = signals[0]!;
    expect(first.aborted).toBe(false);
    box.target = b; // switch to a different group (cell switch)
    flushSync();
    await tick();
    expect(first.aborted).toBe(true);                 // in-flight fetch for cell A aborted
    expect(signals.length).toBeGreaterThanOrEqual(2); // a fresh fetch started for cell B
  });

  it('thread: shows the loading indicator (newest still rendered) while the thread is in flight', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never resolves */ })));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-loading"]')).toBeTruthy();
    // the newest entry renders optimistically from the cell even while the thread is pending
    expect(host.textContent).toContain('Submission');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeTruthy();
  });

  it('thread: a 4xx (ApiError) also shows the retry error state', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let calls = 0;
    const stub = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url); const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'GET' && u.endsWith('/submissions')) {
        calls += 1;
        if (calls === 1) {
          // non-2xx → api.get throws ApiError (not a raw TypeError) → the catch-all must still show the error state
          return Promise.resolve(new Response(JSON.stringify({ detail: 'Resource not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.resolve(new Response(JSON.stringify(echoThread(t)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', stub);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeTruthy();
    (host.querySelector('[data-test="thread-retry"]') as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeNull();
    expect(calls).toBe(2);
  });

  // FIX #1: the post-write bridge (stateLatestEvaluation) carries the OLD submission's
  // evaluation. If a reject/revision→resubmit race lands a NEWER unevaluated submission
  // as thread[0] between the write's POST and the immediate refetch, the bridge must be
  // dropped — never attached/PATCHed against the newer submission.
  it('FIX #1: post-write refetch landing a newer unevaluated submission drops the stale bridge (no PATCH of old eval)', async () => {
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100, latest_evaluation: null });
    // thread #1 (mount): echoes the cell → newest submission 100, no eval → create form for 100.
    // thread #2 (post-write refetch): a NEWER unevaluated submission 200 landed (resubmission race).
    const newerUneval = { submissions: [
      { id: 200, submission_number: 3, submitted_at: '2026-06-06T10:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
        file_size: 777, evaluation: null },
    ] };
    // The create POST for submission 100 returns an eval carrying submission_id 100.
    const createdForOld = { id: 42, submission_id: 100, result: 'accepted', score: 77,
      feedback_text: 'OLD-EVAL-FEEDBACK', has_feedback_file: false,
      evaluated_at: '2026-06-06T09:00:00Z', evaluated_by: 1 };
    const fetchMock = sequencedThreadFetch(
      [echoThread(start), newerUneval],
      { status: 201, body: createdForOld },
    );
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({ target: start, isAdmin: true });
    await settle();
    // write an eval on the currently-newest submission (100) — accepted needs no file
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle(); // POST → refetch lands the newer submission 200 (two awaited hops)
    // The bridge (submission 100's eval) must NOT attach to submission 200: the old eval's
    // feedback must not render under the newer submission, and a fresh create form shows.
    expect(host.textContent).not.toContain('OLD-EVAL-FEEDBACK');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeTruthy();
    // A subsequent write must CREATE against the new submission (200), never PATCH the old eval (42).
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const calls = evalCalls(fetchMock);
    const post200 = calls.find(([u, i]) => (i.method ?? '').toUpperCase() === 'POST' && String(u) === '/api/submissions/200/evaluation');
    expect(post200).toBeTruthy();
    expect(calls.some(([, i]) => (i.method ?? '').toUpperCase() === 'PATCH')).toBe(false);
  });

  // FIX #2: the header status badge must reflect the thread-authoritative newest, not the
  // stale grid cell snapshot. Grid cell says needs_revision (sub 100), but the group
  // resubmitted → thread[0] is a newer awaiting submission (eval null) → badge = awaiting_eval.
  it('FIX #2: header badge reflects thread newest status, not the stale grid cell status', async () => {
    const t = submissionTarget({
      status: 'needs_revision',
      submissionId: 100,
      latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' },
        result: 'major_revision', score: 40, feedback_text: 'Redo', has_feedback_file: true },
    });
    const thread = { submissions: [
      { id: 200, submission_number: 3, submitted_at: '2026-06-06T10:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
        file_size: 777, evaluation: null },
    ] };
    vi.stubGlobal('fetch', routedFetch({ thread }));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    const badge = host.querySelector('.status-badge') as HTMLElement;
    expect(badge).toBeTruthy();
    // thread newest (submission 200) is awaiting_eval; NOT the grid cell's needs_revision.
    expect(badge.getAttribute('data-status')).toBe('awaiting_eval');
  });

});

// --- 6c Task 5: the drawer frame, the header, the discard footer, Progress ---

describe('DashboardSidePanel — drawer frame (6c T5)', () => {
  it('renders inside a 520px .modal-panel.right, named by its <h2> title (D27, R30)', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }) });
    await settle();
    const panel = host.querySelector('section.modal-panel') as HTMLElement;
    expect(panel.classList.contains('right')).toBe(true);
    expect(host.querySelector('div.modal-backdrop')!.classList.contains('right')).toBe(true);
    expect(panel.style.getPropertyValue('--modal-w')).toBe('520px');
    expect(panel.getAttribute('aria-label')).toBeNull();
    const title = panelTitle()!;
    expect(title.tagName).toBe('H2');
    expect(title.getAttribute('tabindex')).toBe('-1');
  });

  it('submission header: the block title, the group, and the short status badge', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }) });
    await settle();
    expect(panelTitle()!.textContent).toBe('Block X');
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('G7');
    const badge = host.querySelector('.modal-head .status-badge') as HTMLElement;
    expect(badge.textContent).toBe('awaiting eval');
    expect(badge.getAttribute('data-status')).toBe('awaiting_eval');
  });

  it('progress header: "Item details" while loading, no subtitle, no badge', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never resolves */ })));
    mountPanel({ target: makeProgressTarget() });
    expect(panelTitle()!.textContent).toBe('Item details');
    expect(host.querySelector('.modal-head .sp-sub')).toBeNull();
    expect(host.querySelector('.modal-head .status-badge')).toBeNull();
    expect(host.textContent).toContain('Loading…');
  });

  it('progress header after the load: the student and "Block — Sequence"', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(panelTitle()!.textContent).toBe('Alice');
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('B1 — S1');
  });

  it('progress header: the e-mail when the student has no name', async () => {
    const body = makeItemsResponse();
    vi.stubGlobal('fetch', mockFetch(200, { ...body, student: { ...body.student, full_name: null } }));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(panelTitle()!.textContent).toBe('alice@test.com');
  });

  it('progress header after an error stays "Item details"', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { detail: 'boom' }));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(panelTitle()!.textContent).toBe('Item details');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('close this panel and refresh the table.');
  });

  it('the Items card: ItemMark rows with the readable type name and the score', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse([
      { item_id: 1, item_order: 1, item_title: 'Item One', item_type: 'static_page', is_covered: true, last_score: null, last_visited_at: null },
      { item_id: 2, item_order: 2, item_title: 'Check', item_type: 'quiz', is_covered: false, last_score: { correct: 3, total: 4 }, last_visited_at: null },
    ])));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    const rows = host.querySelectorAll('li.pb-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.item-mark')!.classList.contains('covered')).toBe(true);
    expect(rows[0]!.textContent).toContain('Page');
    expect(rows[1]!.querySelector('.item-mark')!.classList.contains('not-yet')).toBe(true);
    expect(rows[1]!.textContent).toContain('Quiz');
    expect(rows[1]!.textContent).toContain('3/4');
  });

  it('nothing closes while a save runs; × is disabled with "Wait for the save to finish"', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ submissions: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      return new Promise<Response>(() => { /* the save never answers */ });
    }));
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    flushSync();
    expect(closeX().disabled).toBe(true);
    expect(closeX().getAttribute('title')).toBe('Wait for the save to finish');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    closeX().click();
    flushSync();
    expect(onClose).not.toHaveBeenCalled();
    expect(discardCancel()).toBeNull();
  });

  it('× while the confirm shows focuses its Cancel and keeps the confirm', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    closeX().click();
    await settle();
    expect(document.activeElement).toBe(discardCancel());
    closeX().focus();
    closeX().click();
    await settle();
    expect(discardConfirm()).toBeTruthy();
    expect(document.activeElement).toBe(discardCancel());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc on the confirm\'s Cancel closes it; focus returns to the field focused when it opened', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    const textarea = await typeFeedback('unsaved');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    const cancel = discardCancel()!;
    expect(document.activeElement).toBe(cancel);
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(discardCancel()).toBeNull();
    expect(frozen()).toEqual([false, false, false, false]);
    expect(host.querySelector('form[aria-label="Write evaluation"] button[type="submit"]')).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('R36: a dirty edit → Cancel → Discard ends the edit; the panel stays; focus on Edit', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'needs_revision', latest_evaluation: NEEDS_REVISION_EVAL }),
      isAdmin: true,
    });
    await settle();
    (host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement).click();
    await settle();
    await typeFeedback('Changed');
    (host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(discardCancel());
    discardConfirm()!.click();
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(discardCancel()).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button[data-test="edit-evaluation"]'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Safari: × clicked with focus on <body> → the confirm's Cancel focuses the checked Result radio", async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    pickResult('major_revision');
    await typeFeedback('unsaved');
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    closeX().click();
    await settle();
    discardCancel()!.click();
    await settle();
    expect(document.activeElement).toBe(resultRadio('major_revision'));
  });

  // Safari moves a mouse click's focus to the nearest focusable ancestor, the
  // drawer's own panel (tabindex -1): that is no return target either (Safari pass).
  it("Safari: × clicked with focus on the drawer panel → the confirm's Cancel focuses the checked Result radio", async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    pickResult('major_revision');
    await typeFeedback('unsaved');
    const panel = host.querySelector('section.modal-panel') as HTMLElement;
    panel.focus();
    expect(document.activeElement).toBe(panel);
    closeX().click();
    await settle();
    discardCancel()!.click();
    await settle();
    expect(document.activeElement).toBe(resultRadio('major_revision'));
  });

  it("a dirty edit → the form's Cancel → the confirm's Cancel: focus back on the form's Cancel", async () => {
    mountPanel({
      target: submissionTarget({ status: 'needs_revision', latest_evaluation: NEEDS_REVISION_EVAL }),
      isAdmin: true,
    });
    await settle();
    (host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement).click();
    await settle();
    await typeFeedback('Changed');
    const formCancel = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    formCancel.focus();
    formCancel.click();
    await settle();
    expect(host.querySelector('button[data-test="cancel-button"]')).toBeNull();
    discardCancel()!.click();
    await settle();
    expect(document.activeElement).toBe(host.querySelector('button[data-test="cancel-button"]'));
  });

  it('R36: a dirty edit → × → Discard closes the panel', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'needs_revision', latest_evaluation: NEEDS_REVISION_EVAL }),
      isAdmin: true,
    });
    await settle();
    (host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement).click();
    await settle();
    await typeFeedback('Changed');
    closeX().click();
    await settle();
    discardConfirm()!.click();
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('R36: a dirty create → Esc → Discard closes the panel', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    discardConfirm()!.click();
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// --- 6c Task 6: the submission cards and the evaluation form ---

const sectionTitled = (text: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('section.sp-card')).find((s) => s.querySelector('h3')?.textContent === text) ?? null;

describe('DashboardSidePanel — submission cards (6c T6)', () => {
  it('header subtitle: "{Group} · B2" with blockLabel, the group alone without (R35)', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), blockLabel: 'B2' });
    await settle();
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('G7 · B2');
    unmount(component!); component = null; host.remove();
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }) });
    await settle();
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('G7');
  });

  it('the Latest submission card: its <h3>, the chips, the rows and the file card (D26)', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    t.entry.latest_submission = { ...t.entry.latest_submission!, submission_number: 3, file_size: 2_400_000, is_late: true };
    mountPanel({ target: t });
    await settle();
    const card = sectionTitled('Latest submission')!;
    expect(document.getElementById(card.getAttribute('aria-labelledby')!)!.tagName).toBe('H3');
    expect(Array.from(card.querySelectorAll('.sp-card-head .sc-chip')).map((c) => c.textContent)).toEqual(['late']);
    const dds = Array.from(card.querySelectorAll('[data-test="submission-content"] dd')).map((d) => d.textContent?.trim());
    expect(dds).toEqual([formatLocalWithTz('2026-06-04T10:00:00Z'), 'Alice', '3']);
    expect(card.querySelector('.sc-file-name')!.textContent).toBe('Submission 3');
    expect(card.querySelector('.sc-file-meta')!.textContent).toBe('PDF · 2.4 MB');
    const a = card.querySelector('a[href="/api/submissions/100/file"]') as HTMLAnchorElement;
    expect(a.hasAttribute('download')).toBe(true);
    expect(a.getAttribute('aria-label')).toBe('Download submission 3');
  });

  it('the Evaluation card: "Minor revision", "—" for empty score and feedback, the file, Edit', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        latest_evaluation: { ...NEEDS_REVISION_EVAL, result: 'minor_revision', score: null, feedback_text: '' },
      }),
      isAdmin: true,
    });
    await settle();
    const card = host.querySelector('[data-test="evaluation-card"]') as HTMLElement;
    const h = document.getElementById(card.getAttribute('aria-labelledby')!)!;
    expect(h.tagName).toBe('H3');
    expect(h.textContent).toBe('Evaluation');
    expect(h.getAttribute('tabindex')).toBe('-1');
    const badge = card.querySelector('[data-test="evaluation-content"] .status-badge') as HTMLElement;
    expect(badge.textContent).toBe('Minor revision');
    expect(badge.getAttribute('data-status')).toBe('needs_revision');
    const dds = Array.from(card.querySelectorAll('[data-test="evaluation-content"] dd')).map((d) => d.textContent?.trim());
    expect(dds.slice(1)).toEqual(['—', '—', `Prof · ${formatLocalWithTz('2026-06-01T10:00:00Z')}`]);
    expect(card.querySelector('a[href="/api/evaluations/42/feedback-file"]')!.hasAttribute('download')).toBe(true);
    const edit = card.querySelector('.sp-card-head button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(edit.textContent!.trim()).toBe('Edit');
    expect(edit.getAttribute('data-variant')).toBe('secondary');
  });

  it('after a save the card reads "You · Just now" until the refetch brings the evaluation', async () => {
    const evalResp = { id: 8, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 201, body: evalResp } }));
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }), isAdmin: true });
    await settle();
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const dds = Array.from(host.querySelectorAll('[data-test="evaluation-card"] dd')).map((d) => d.textContent?.trim());
    expect(dds[0]).toBe('Accepted');
    expect(dds[3]).toBe('You · Just now');
  });
});

describe('DashboardSidePanel — the Evaluate form (6c T6, R37, R44)', () => {
  async function mountCreate() {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }), isAdmin: true });
    await settle();
  }
  const save = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
  const submit = () =>
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  it('the "Evaluate" card; Result as four radios in the drawn order, none checked', async () => {
    await mountCreate();
    expect(host.querySelector('section.sp-evaluate h3')!.textContent).toBe('Evaluate');
    const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[name="evaluation-result"]'));
    expect(radios.map((r) => r.value)).toEqual(['accepted', 'minor_revision', 'major_revision', 'rejected']);
    expect(radios.map((r) => r.closest('label')!.textContent!.trim()))
      .toEqual(['Accepted', 'Minor revision', 'Major revision', 'Rejected']);
    expect(radios.some((r) => r.checked)).toBe(false);
    pickResult('major_revision');
    expect(resultRadio('major_revision').closest('label')!.classList.contains('checked')).toBe(true);
  });

  it('Feedback and the feedback file say "(required)" unless Accepted', async () => {
    await mountCreate();
    const fb = () => host.querySelector('label[for="evaluation-feedback"]')!.textContent;
    const attach = () => host.querySelector('button[data-action="attach-feedback-file"]') as HTMLButtonElement;
    const file = () => document.getElementById(attach().getAttribute('aria-describedby')!.split(' ')[0]!)!.textContent;
    expect(fb()).toBe('Feedback (required)');
    expect(file()).toBe('Feedback file (required)');
    pickResult('accepted');
    expect(fb()).toBe('Feedback (optional)');
    expect(file()).toBe('Feedback file (optional)');
    pickResult('rejected');
    expect(file()).toBe('Feedback file (required)');
  });

  it('"attach PDF" is one tab stop that opens the hidden input, described by the label and the help', async () => {
    await mountCreate();
    const input = host.querySelector('input#evaluation-file') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.hidden).toBe(true);
    const attach = host.querySelector('button[data-action="attach-feedback-file"]') as HTMLButtonElement;
    expect(attach.textContent).toBe('attach PDF');
    const described = attach.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent);
    expect(described).toEqual(['Feedback file (required)', 'PDF only, max 20 MB.']);
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    attach.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('a chosen file shows "{name} · {size}" with its remove × focused; remove clears the input and focuses "attach PDF"', async () => {
    await mountCreate();
    const input = host.querySelector('input#evaluation-file') as HTMLInputElement;
    const pdf = new File([new Uint8Array(2048)], 'notes.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [pdf], configurable: true });
    const setValue = vi.fn();
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: setValue });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const chosen = host.querySelector('.sp-chosen') as HTMLElement;
    expect(chosen.textContent).toContain('notes.pdf');
    expect(chosen.textContent).toContain('· 2.0 kB');
    expect(host.querySelector('button[data-action="attach-feedback-file"]')).toBeNull();
    const remove = host.querySelector('[data-action="remove-feedback-file"]') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove notes.pdf');
    expect(document.activeElement).toBe(remove);
    remove.click();
    await settle();
    expect(setValue).toHaveBeenCalledWith('');
    expect(host.querySelector('.sp-chosen')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button[data-action="attach-feedback-file"]'));
  });

  it("Save's disabled reason, first match wins", async () => {
    await mountCreate();
    expect(save().disabled).toBe(true);
    expect(save().title).toBe('Choose a result');
    pickResult('rejected');
    const score = host.querySelector('#evaluation-score') as HTMLInputElement;
    score.value = '101';
    score.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(save().title).toBe('Score must be a whole number between 0 and 100');
    score.value = '';
    score.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(save().title).toBe('Write feedback for a non-accepted result');
    await typeFeedback('Redo the proof');
    expect(save().title).toBe('Attach the feedback PDF');
    pickResult('accepted');
    expect(save().disabled).toBe(false);
    expect(save().hasAttribute('title')).toBe(false);
    expect(save().textContent!.trim()).toBe('Save');
  });

  it('while saving: Save keeps focus, busy and not disabled; the fields freeze; a second submit sends nothing', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ submissions: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      return new Promise<Response>(() => { /* the save never answers */ });
    });
    vi.stubGlobal('fetch', fetchMock);
    await mountCreate();
    pickResult('accepted');
    save().focus();
    submit();
    await tick();
    flushSync();
    expect(document.activeElement).toBe(save());
    expect(save().disabled).toBe(false);
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(save().getAttribute('aria-busy')).toBe('true');
    expect(save().title).toBe('Wait for the save to finish');
    expect(save().textContent!.trim()).toBe('Saving…');
    expect((host.querySelector('#evaluation-feedback') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((host.querySelector('#evaluation-score') as HTMLInputElement).readOnly).toBe(true);
    expect((host.querySelector('fieldset#evaluation-result') as HTMLFieldSetElement).disabled).toBe(true);
    expect(host.querySelector('.sp-file-ctl')!.hasAttribute('inert')).toBe(true);
    save().click();
    submit();
    await tick();
    expect(evalCalls(fetchMock)).toHaveLength(1);
  });

  it('a failed save → after the un-freeze, focus on Save (no field has an error)', async () => {
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 400, body: { detail: 'Bad request' } } }));
    await mountCreate();
    pickResult('accepted');
    resultRadio('accepted').focus();
    submit();
    await settle();
    expect(host.querySelector('[role="alert"].form-error')!.textContent).toContain('Bad request');
    expect((host.querySelector('fieldset#evaluation-result') as HTMLFieldSetElement).disabled).toBe(false);
    expect(document.activeElement).toBe(save());
  });

  it('Cancel upload → the form stays, focus on Save', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ submissions: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      return new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }));
    await mountCreate();
    pickResult('accepted');
    submit();
    await tick();
    flushSync();
    const cancel = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    expect(cancel.textContent!.trim()).toBe('Cancel upload');
    cancel.click();
    await settle();
    expect(host.querySelector('button[data-test="cancel-button"]')).toBeNull();
    expect(checkedResult()).toBe('accepted');
    expect(document.activeElement).toBe(save());
  });

  it('a 409 → focus on the winning Evaluation card\'s <h3> once it renders', async () => {
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const winning = { submissions: [{ ...start.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Winner', has_feedback_file: false } }] };
    vi.stubGlobal('fetch', sequencedThreadFetch(
      [echoThread(start), winning],
      { status: 409, body: { detail: 'Already evaluated' } },
    ));
    mountPanel({ target: start, isAdmin: true });
    await settle();
    pickResult('accepted');
    submit();
    await settle();
    await settle();
    const card = host.querySelector('[data-test="evaluation-card"]') as HTMLElement;
    expect(card.textContent).toContain('Other Prof');
    expect(document.activeElement).toBe(card.querySelector('h3'));
  });

  it('Edit with no feedback file: Accepted is focused, the other results lock, the lock line shows', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        latest_evaluation: { ...NEEDS_REVISION_EVAL, result: 'major_revision', has_feedback_file: false },
      }),
      isAdmin: true,
    });
    await settle();
    (host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement).click();
    await settle();
    // The lock keeps the stored non-accepted result until the teacher picks Accepted.
    expect(resultRadio('major_revision').disabled).toBe(true);
    expect(document.activeElement).toBe(resultRadio('accepted'));
    expect(host.querySelector('#evaluation-result-lock')!.textContent)
      .toBe('Without a feedback file the result can only be Accepted.');
  });
});

describe('DashboardSidePanel — earlier submissions and Retry (6c T6)', () => {
  it('the loading line first; then a card with the count; rows toggle; an auto-accepted entry keeps its line', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const older = (id: number, n: number, extra: Record<string, unknown> = {}) => ({
      id, submission_number: n, submitted_at: '2026-06-01T09:00:00Z',
      submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
      file_size: 500, evaluation: null, ...extra,
    });
    const thread = { submissions: [
      { ...t.entry.latest_submission!, evaluation: null },
      older(56, 2, { is_resubmission: true, evaluation: { id: 8, evaluated_at: '2026-06-02T09:00:00Z',
        evaluated_by: { user_id: 3, full_name: 'Prof' }, result: 'accepted', score: null, feedback_text: null,
        has_feedback_file: false } }),
      older(55, 1),
    ] };
    let resolveThread!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolveThread = r; })));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-loading"]')!.textContent).toBe('Loading earlier submissions…');
    expect(host.querySelector('[data-test="thread-history"]')).toBeNull();
    resolveThread(new Response(JSON.stringify(thread), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(host.querySelector('[data-test="thread-loading"]')).toBeNull();
    const card = sectionTitled('Earlier submissions')!;
    expect(card.querySelector('.sp-count-n')!.textContent).toBe('2');
    const toggles = card.querySelectorAll<HTMLButtonElement>('[data-test="thread-entry-toggle"]');
    expect(toggles).toHaveLength(2);
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false');
    toggles[0]!.click();
    flushSync();
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(toggles[0]!.closest('[data-test="thread-entry"]')!.textContent)
      .toContain('Auto-accepted on resubmission. No manual evaluation needed.');
  });

  // F9: the first load can find the newest already evaluated (another teacher), which
  // swaps the focused create form for the evaluation card.
  it('the first thread load moves focus to the Evaluation heading, else ×', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const evaluated = { submissions: [{ ...t.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Done', has_feedback_file: false } }] };
    let resolveThread!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolveThread = r; })));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    resultRadio('accepted').focus();
    expect(document.activeElement).toBe(resultRadio('accepted'));
    resolveThread(new Response(JSON.stringify(evaluated), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Evaluation');
    expect(document.activeElement?.tagName).toBe('H3');
  });

  it('a thread load that swaps nothing leaves focus where it is, even on the panel (review r1)', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let resolveThread!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolveThread = r; })));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    // Safari: a click on a radio focuses the nearest focusable ancestor, the panel.
    const panel = host.querySelector<HTMLElement>('section.modal-panel')!;
    panel.focus();
    resolveThread(new Response(JSON.stringify(echoThread(t)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).not.toBeNull();
    expect(document.activeElement).toBe(panel);
  });

  it('Retry → focus on the panel title', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'GET' && String(url).endsWith('/submissions')) {
        calls += 1;
        if (calls === 1) return Promise.reject(new TypeError('network down'));
        return Promise.resolve(new Response(JSON.stringify(echoThread(t)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    const err = host.querySelector('[data-test="thread-error"]') as HTMLElement;
    expect(err.textContent).toContain("Couldn't load submission history.");
    (host.querySelector('[data-test="thread-retry"]') as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeNull();
    expect(document.activeElement).toBe(panelTitle());
  });
});

describe('DashboardSidePanel — leaving with an unsaved evaluation (Polish 1 D37)', () => {
  beforeEach(() => { __resetGuardsForTests(); });
  afterEach(async () => { __resetGuardsForTests(); await navigate('/', { force: true }); });

  it('a navigation asks in the form with "…and continue?"; Cancel keeps the text and refocuses the field', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    const textarea = await typeFeedback('unsaved');
    const start = location.pathname;
    const nav = navigate('/sp-nav-away');
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"] .sp-discard .warning')!.textContent!.trim())
      .toBe('Discard unsaved changes and continue?');
    expect(document.activeElement).toBe(discardCancel());
    expect(frozen()).toEqual([true, true, true, true]);
    discardCancel()!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe(start);
    expect(textarea.value).toBe('unsaved');
    expect(document.activeElement).toBe(textarea);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Discard ends the edit and lets the navigation through', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    const nav = navigate('/sp-nav-gone');
    await settle();
    discardConfirm()!.click();
    await nav;
    await settle();
    expect(location.pathname).toBe('/sp-nav-gone');
    expect(discardCancel()).toBeNull();
    expect((host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('R53: with the × question open, a navigation is refused; focus stays on its Cancel', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    const start = location.pathname;
    closeX().click();
    await settle();
    closeX().focus();
    await navigate('/sp-nav-refused');
    await settle();
    expect(location.pathname).toBe(start);
    expect(document.activeElement).toBe(discardCancel());
    expect(host.querySelector('.sp-discard .warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
  });
});
