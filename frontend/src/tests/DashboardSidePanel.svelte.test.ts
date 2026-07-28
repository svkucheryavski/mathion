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
    mountPanel({ target: { kind: 'submission', runId: 1, mp, entry } });
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
    mountPanel({ target: { kind: 'submission', runId: 1, mp: makeMp(), entry } });
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
    mountPanel({ target: { kind: 'submission', runId: 1, mp: makeMp(), entry } });
    const h4s = Array.from(host.querySelectorAll('h4')).map((h) => h.textContent?.trim());
    expect(h4s).toContain('Submission');
    expect(h4s).not.toContain('Evaluation');
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
    const fetchMock = routedFetch();
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
    expect(evalCalls(fetchMock)).toHaveLength(0);
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
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 201, body: evalResp } }));
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
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 409, body: { detail: 'Already evaluated' } } }));
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
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle(); // POST → 409 branch → onRefetch + thread refetch → winning eval renders (two awaited hops)
    expect(host.textContent).toContain('88');          // winning score, from the post-409 thread refetch
    expect(host.textContent).toContain('Other Prof');  // winning evaluator
    expect(onRefetch).toHaveBeenCalledTimes(1);
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
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
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
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
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
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    expect(select.value).toBe('rejected');
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
    expect((host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement).value).toBe('major_revision');
    expect((host.querySelector('input[name="evaluation-score"]') as HTMLInputElement).value).toBe('60');
    expect((host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement).value).toBe('Needs work');
  });

  // T25: result-lock — disabled non-accepted options + verbatim text + Save guarded
  it('T25: result-lock — non-accepted options disabled + verbatim helper text + fetch not called', async () => {
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
    const opts = host.querySelectorAll('select[name="evaluation-result"] option');
    const optMap = new Map<string, HTMLOptionElement>();
    opts.forEach((o) => optMap.set((o as HTMLOptionElement).value, o as HTMLOptionElement));
    expect(optMap.get('rejected')?.disabled).toBe(true);
    expect(optMap.get('major_revision')?.disabled).toBe(true);
    expect(optMap.get('minor_revision')?.disabled).toBe(true);
    expect(optMap.get('accepted')?.disabled).toBe(false);
    expect(host.textContent).toContain('Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead.');
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'rejected';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
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
  it('T39: "Existing feedback file uploaded — replace not supported (Phase 9)" placeholder in edit', async () => {
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
    expect(host.textContent).toContain('Existing feedback file uploaded — replace not supported (Phase 9)');
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
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(editBtn);
  });

  // T30b: focus moves to result <select> after [Edit] click
  it('T30b: focus moves to result <select> after [Edit] click', async () => {
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
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    expect(document.activeElement).toBe(select);
  });

  // T28b: dirty create + Escape → InlineConfirm + focus on confirm button
  it('T28b: dirty create + Escape → InlineConfirm; focus on confirm button', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'unsaved';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    const confirmBtn = host.querySelector('.inline-confirm button') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(document.activeElement).toBe(confirmBtn);
    expect(onClose).not.toHaveBeenCalled();
  });

  // T28c: dirty + backdrop click → InlineConfirm + focus on confirm button
  it('T28c: dirty + backdrop click → InlineConfirm; focus on confirm button', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'unsaved';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const backdrop = host.querySelector('.panel-backdrop') as HTMLElement;
    backdrop.click();
    await settle();
    const confirmBtn = host.querySelector('.inline-confirm button') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(document.activeElement).toBe(confirmBtn);
  });

  // T28d: dirty + × Close button → InlineConfirm + focus on confirm button
  it('T28d: dirty + × Close → InlineConfirm; focus on confirm button', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'unsaved';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const closeBtn = host.querySelector('[data-side-panel-close]') as HTMLButtonElement;
    closeBtn.click();
    await settle();
    const confirmBtn = host.querySelector('.inline-confirm button') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(document.activeElement).toBe(confirmBtn);
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
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
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
    const closeBtn = host.querySelector('[data-side-panel-close]') as HTMLButtonElement;
    closeBtn.click();
    await settle();
    expect(host.querySelector('.inline-confirm')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('thread: renders historical entries collapsed under "Previous submissions"', async () => {
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
    expect(host.textContent).toContain('Previous submissions');
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
    expect(host.textContent).not.toContain('Previous submissions');
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
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
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
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
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
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
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
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle(); // POST → refetch lands the newer submission 200 (two awaited hops)
    // The bridge (submission 100's eval) must NOT attach to submission 200: the old eval's
    // feedback must not render under the newer submission, and a fresh create form shows.
    expect(host.textContent).not.toContain('OLD-EVAL-FEEDBACK');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeTruthy();
    // A subsequent write must CREATE against the new submission (200), never PATCH the old eval (42).
    const sel2 = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel2.value = 'accepted'; sel2.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
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
