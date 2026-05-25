import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type Component, type MountOptions } from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import type { MiniProjectResponse, BlockResponse } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

// Round-5 reviewer-2 catch: T6a's modal registers a `window` keydown listener
// in onMount and removes it in onDestroy. If a test forgets `unmount(cmp)`,
// the listener leaks across tests — subsequent Escape dispatches fire stale
// onClose spies. Track mounted components and unmount them in afterEach.
//
// trackedMount must carry mount's own generic so the caller's specific Props
// type is preserved; `Parameters<typeof mount>` collapses the generic to its
// `Record<string, any>` default and TS rejects the precise prop shapes.
const mounted: ReturnType<typeof mount>[] = [];
function trackedMount<Props extends Record<string, any>, Exports extends Record<string, any>>(
  component: Component<Props, Exports, string>,
  options: MountOptions<Props>,
): Exports {
  const cmp = mount(component, options);
  mounted.push(cmp);
  return cmp;
}

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

afterEach(() => {
  while (mounted.length) {
    try {
      unmount(mounted.pop()!);
    } catch {
      /* already unmounted by test */
    }
  }
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

// jsdom doesn't ship DataTransfer/DragEvent constructors; mirror the pattern
// from T5b's run-mode tests.
function makeDropEvent(files: File[]): DragEvent {
  const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
  Object.defineProperty(ev, 'dataTransfer', { value: { files } });
  return ev;
}

// Round-2 reviewer-2/5 catch: the assignment textarea lives INSIDE MarkdownEditor
// (verified `frontend/src/components/editor/MarkdownEditor.svelte:266-278`), which
// renders a bare `<textarea>` with no `name` attribute. Since MiniProjectModal has
// exactly one textarea in its DOM tree, `target.querySelector('textarea')` is the
// canonical, unambiguous selector. If a future change introduces a second textarea
// (e.g., a notes field), narrow with `.body textarea` instead.

const blocks: BlockResponse[] = [
  // Round-2 reviewer-5 catch: full 7-field shape (schemas.py:69, types.ts T2.B).
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
];

describe('MiniProjectModal — create mode', () => {
  it('renders block picker for create; POST body shape correct on Save (including all-null deadlines)', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/mini-projects') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres({ id: 99 } as MiniProjectResponse);
      }
      return jres([]); // list endpoint
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'create',
        initial: null,
        availableBlocks: blocks,
        currentBlock: null,
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose,
        onSaved,
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    expect(target.textContent).toContain('Intro');
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'My assignment';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // Svelte's reactive re-render is scheduled — flush it so the Save button's
    // `disabled={!!saveError}` updates before we click. Without this, jsdom
    // sees disabled=true (initial render, assignment_md empty) and .click()
    // no-ops per HTML's disabled-button activation rules.
    await settle();
    const saveBtn = target.querySelector('button[data-action="save"]') as HTMLButtonElement;
    saveBtn.click();
    await settle();
    const postCall = fetchSpy.mock.calls.find(
      (c) =>
        String(c[0]).includes('/api/runs/10/mini-projects') &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.block_id).toBe(1);
    expect(body.assignment_md).toBe('My assignment');
    // Reviewer-2 catch: verify all three null deadlines are PRESENT (not undefined-removed by JSON.stringify)
    expect(body.soft_deadline).toBeNull();
    expect(body.hard_deadline).toBeNull();
    expect(body.resubmission_deadline).toBeNull();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Save disabled when availableBlocks is empty (block_id would be null)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'create',
        initial: null,
        availableBlocks: [], // empty
        currentBlock: null,
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const saveBtn = target.querySelector('button[data-action="save"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('422 on POST: renders field-level error spans + aria-describedby wiring (spec line 527)', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/mini-projects') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres(
          {
            detail: [
              { loc: ['body', 'assignment_md'], msg: 'must be non-empty', type: 'value_error' },
              { loc: ['body', 'hard_deadline'], msg: 'must be ISO 8601', type: 'value_error' },
            ],
          },
          422,
        );
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'create',
        initial: null,
        availableBlocks: blocks,
        currentBlock: null,
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'x'; // satisfy client saveError so handleSave proceeds to POST
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    const assignErr = target.querySelector('#err-assignment_md');
    expect(assignErr).toBeTruthy();
    expect(assignErr!.textContent).toContain('must be non-empty');
    const hardErr = target.querySelector('#err-hard_deadline');
    expect(hardErr).toBeTruthy();
    expect(hardErr!.textContent).toContain('must be ISO 8601');
    const hardInput = Array.from(target.querySelectorAll('input[type="datetime-local"]')).find(
      (el) => el.getAttribute('aria-describedby') === 'err-hard_deadline',
    );
    expect(hardInput).toBeTruthy();
    const textareaEl = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(textareaEl.getAttribute('aria-describedby')).toBe('err-assignment_md');
    expect(target.textContent).toContain('Please correct the highlighted fields.');
  });
});

describe('MiniProjectModal — edit mode + dirty close', () => {
  // Round-4 reviewer-1 catch: MiniProjectResponse requires `title` and `assignment_html`
  // (non-optional per types.ts T2.B addition). Old fixtures omitted them; strict TS would
  // reject. Widened to the full 11-field shape across all MP literals in this plan.
  const initial: MiniProjectResponse = {
    id: 99,
    run_id: 10,
    block_id: 1,
    title: 'Mini project for Block 1',
    assignment_md: 'orig text',
    assignment_html: '<p>orig text</p>',
    soft_deadline: null,
    hard_deadline: null,
    resubmission_deadline: null,
    is_published: false,
    first_submitted_at: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  };

  it('prefills assignment_md and disables block picker for edit', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('orig text');
  });

  it('clean close: backdrop click → onClose called', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose,
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const backdrop = target.querySelector('[data-role="backdrop"]') as HTMLElement;
    backdrop.click();
    await settle();
    expect(onClose).toHaveBeenCalled();
  });

  it('clean close: Escape key → onClose called (spec line 483 — backdrop/X/Escape route through closeForCurrentStage)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose,
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(onClose).toHaveBeenCalled();
    unmount(cmp);
  });

  it('dirty close: typing then X flips footer to InlineConfirm; Keep editing reverts; Discard closes', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose,
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'modified';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Discard unsaved changes?');
    expect(onClose).not.toHaveBeenCalled();
    // Keep editing — InlineConfirm cancel button selected by class (no data-action on cancel)
    (target.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).not.toContain('Discard unsaved changes?');
    // X again → InlineConfirm again → Discard via confirmDataAction
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-discard"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).toHaveBeenCalled();
  });

  it('mounted-flag rule: close during in-flight save → post-await writes do not fire AND no throw on late-resolve', async () => {
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects/99') && (init as RequestInit | undefined)?.method === 'PATCH') {
        return new Promise((r) => {
          resolvePost = r;
        });
      }
      return jres([]);
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved,
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    unmount(cmp);
    expect(() => {
      resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    }).not.toThrow();
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('inputs disabled while submitting: textarea, datetime fields, block picker, MarkdownEditor all set disabled', async () => {
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects') && (init as RequestInit | undefined)?.method === 'PATCH') {
        return new Promise((r) => {
          resolvePost = r;
        });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved: vi.fn().mockResolvedValue(undefined),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    expect((target.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    target.querySelectorAll('input[type="datetime-local"]').forEach((el) => {
      expect((el as HTMLInputElement).disabled).toBe(true);
    });
    expect((target.querySelector('button[data-action="save"]') as HTMLButtonElement).disabled).toBe(true);
    resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    await settle();
  });

  it('X during submitting is ignored; subsequent click after submit resolves closes normally', async () => {
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects') && (init as RequestInit | undefined)?.method === 'PATCH') {
        return new Promise((r) => {
          resolvePost = r;
        });
      }
      return jres([]);
    });
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose,
        onSaved: vi.fn().mockResolvedValue(undefined),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    await settle();
    // If save-success path didn't close, a fresh X should close cleanly.
    if (!onClose.mock.calls.length) {
      (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
      await settle();
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('close-during-upload aborts the in-flight upload via bind:uploadAbortController', async () => {
    // Spec line 614. Spy on AbortController.prototype.abort globally for this test.
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    let resolveUpload!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/assets') && (init as RequestInit | undefined)?.method === 'POST') {
        return new Promise((r) => {
          resolveUpload = r;
        });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(makeDropEvent([new File(['x'], 'x.png', { type: 'image/png' })]));
    await settle();
    (target.querySelector('button[data-action="close-x"]') as HTMLButtonElement).click();
    await settle();
    expect(abortSpy).toHaveBeenCalled();
    // Cleanup the hanging promise so vitest doesn't hold the worker
    resolveUpload({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1, filename: 'x.png' }),
    } as Response);
    abortSpy.mockRestore();
  });

  it('modal layout: container element + header + footer present (structural check, NOT computed-style)', async () => {
    // Round-2 reviewer-3 catch: jsdom does NOT implement CSSOM well — `getComputedStyle`
    // returns empty strings for unset properties and only echoes inline `style="..."`
    // attributes. Layout/visual regressions belong in Playwright; here we assert
    // structural presence only.
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    expect(target.querySelector('.modal')).toBeTruthy();
    expect(target.querySelector('.modal > header')).toBeTruthy();
    expect(target.querySelector('.modal > footer')).toBeTruthy();
    expect(target.querySelector('.backdrop')).toBeTruthy();
  });

  it('404 on Save: surfaces "deleted between open and Save" banner with Ctrl/Cmd+A/+C copy instructions (spec line 519)', async () => {
    // Codex T6a r1 catch: 404 banner copy is implemented but had no test.
    // Spec table row "404 on Save | MP deleted between open and Save | inline
    // banner: 'This mini-project has been deleted. Select-all (Ctrl/Cmd+A)
    // and copy (Ctrl/Cmd+C) from the assignment textarea if you want to
    // preserve your work before closing.'"
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects/99') && (init as RequestInit | undefined)?.method === 'PATCH') {
        return jres({ detail: 'Not found' }, 404);
      }
      return jres([]);
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose: vi.fn(),
        onSaved,
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('.banner-error') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('This mini-project has been deleted');
    expect(banner.textContent).toContain('Ctrl/Cmd+A');
    expect(banner.textContent).toContain('Ctrl/Cmd+C');
    // T9 smoke catch: 404 means the MP is gone server-side; modal fires
    // onSaved so the parent's list refreshes immediately (the stale row
    // is removed by the time the user clicks Discard to close).
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('409 on PATCH: surfaces displayMessage with "Refresh the page to see latest." suffix (spec line 524)', async () => {
    // Codex T6a r1 catch: 409 banner suffix is implemented but had no test.
    // Spec table row "409 on PATCH | locked-after-open OR concurrent state
    // change | inline banner with e.displayMessage and 'Refresh the page to
    // see latest.' Modal stays open so the user can copy markdown manually."
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects/99') && (init as RequestInit | undefined)?.method === 'PATCH') {
        return jres({ detail: 'Mini-project locked by concurrent edit' }, 409);
      }
      return jres([]);
    });
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        onClose,
        onSaved: vi.fn().mockResolvedValue(undefined),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('.banner-error') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Mini-project locked by concurrent edit');
    expect(banner.textContent).toContain('Refresh the page to see latest.');
    // Modal stays open: onClose NOT called.
    expect(onClose).not.toHaveBeenCalled();
    // Save button re-enabled (submitting reset in finally).
    expect((target.querySelector('button[data-action="save"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
