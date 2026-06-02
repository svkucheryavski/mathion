import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

import DashboardSidePanel from '../components/runs/DashboardSidePanel.svelte';
import type { PanelTarget } from '../components/runs/DashboardSidePanel.svelte';
import type { DashboardMpRow, DashboardMpGroupEntry } from '../lib/dashboards';

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
}

function mountPanel({ target, onClose = vi.fn() }: MountPanelOpts) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(DashboardSidePanel, { target: host, props: { target, onClose } });
  flushSync();
  return { host, onClose: onClose as ReturnType<typeof vi.fn> };
}

async function settle() {
  await tick(); await tick(); await tick();
  flushSync();
}

beforeEach(() => {
  vi.restoreAllMocks();
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

});
