import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mount,
  unmount,
  flushSync,
  type Component,
  type MountOptions,
  type ComponentProps,
} from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';

const baseCourse: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };

// ComponentProps extracts the modal's prop shape from the compiled component
// type. Earlier draft used `Parameters<typeof MiniProjectModal>[0]` which
// resolves to Svelte's `Brand<"ComponentInternals">` (the internal handle the
// runtime passes as the first arg), not the prop interface — that produced
// 22 svelte-check errors at the `as ModalProps` cast sites.
type ModalProps = ComponentProps<typeof MiniProjectModal>;

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

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
      /* already unmounted */
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

const blocks: BlockResponse[] = [
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
];

// Helper: build a draft mini-project (is_published: false) with optional overrides.
// Far-future ISO timestamps so the publish-precondition "hard must be in future"
// check passes by default; tests that need "missing" set the field to null.
function draftMp(overrides: Partial<MiniProjectResponse> = {}): MiniProjectResponse {
  return {
    id: 99,
    run_id: 10,
    block_id: 1,
    title: 'Mini project for Block 1',
    assignment_md: 'orig text',
    assignment_html: '<p>orig text</p>',
    soft_deadline: '2026-06-01T10:00:00Z',
    hard_deadline: '2026-06-15T10:00:00Z',
    resubmission_deadline: '2026-06-20T10:00:00Z',
    is_published: false,
    first_submitted_at: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

// Default props builder. Tests override individual fields.
function defaultProps(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    runId: 10,
    mode: 'edit',
    initial: draftMp(),
    availableBlocks: [],
    currentBlock: blocks[0],
    runIsPublished: true,
    versionIsDisabled: false,
    runEndDate: '2026-06-30',
    course: baseCourse,
    onClose: vi.fn(),
    onSaved: vi.fn().mockResolvedValue(undefined),
    onNavigateToTab: vi.fn(),
    ...overrides,
  };
}

describe('MiniProjectModal publish — button visibility', () => {
  it('[Publish…] rendered in edit mode AND !initial.is_published', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps() as ModalProps });
    await settle();
    expect(target.querySelector('button[data-action="publish"]')).toBeTruthy();
  });

  it('[Publish…] NOT rendered in create mode', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ mode: 'create', initial: null, availableBlocks: blocks }) as ModalProps,
    });
    await settle();
    expect(target.querySelector('button[data-action="publish"]')).toBeNull();
  });

  it('[Publish…] NOT rendered when initial.is_published=true', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ initial: draftMp({ is_published: true }) }) as ModalProps,
    });
    await settle();
    expect(target.querySelector('button[data-action="publish"]')).toBeNull();
  });
});

describe('MiniProjectModal publish — confirm flow', () => {
  it('Publish click → InlineConfirm with spec copy "Once published, this cannot be undone..."', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps() as ModalProps });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Once published, this cannot be undone');
    expect(target.textContent).toContain('force-delete');
  });

  it('Publish confirm → POST /api/mini-projects/{id}/publish → onSaved + onClose', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (
        String(url).includes('/api/mini-projects/99/publish') &&
        (init as RequestInit | undefined)?.method === 'POST'
      ) {
        return jres(draftMp({ is_published: true }));
      }
      return jres([]);
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps({ onSaved, onClose }) as ModalProps });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-publish"]') as HTMLButtonElement).click();
    await settle();
    const postCall = fetchSpy.mock.calls.find(
      (c) =>
        String(c[0]).includes('/api/mini-projects/99/publish') &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('MiniProjectModal publish — preconditions', () => {
  it('missing hard_deadline: precondition bullet shows + POST not called', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ initial: draftMp({ hard_deadline: null }) }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Hard deadline must be set');
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('/publish'))).toBeFalsy();
  });

  it('hard_deadline in the past: bullet "Hard deadline must be in the future" + POST not called (spec line 499)', async () => {
    // Opus T6b r1 catch: spec mandates client-side proactive warning when
    // hard_iso is in the past, plan code prescribed `'Hard deadline must be
    // in the future'`, but the round-1 commit omitted it.
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        initial: draftMp({
          hard_deadline: '2020-01-01T00:00:00Z',
          resubmission_deadline: '2020-01-02T00:00:00Z',
        }),
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Hard deadline must be in the future');
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('/publish'))).toBeFalsy();
  });

  it('unsaved changes: bullet "Save your changes before publishing." + POST not called (T9 smoke catch)', async () => {
    // T9 smoke catch: publishCheckResult reads formData (unsaved inputs), but
    // the backend reads the persisted MP. If user fills deadlines and clicks
    // Publish without Save, form-side checks pass; backend rejects with
    // "hard_deadline required at publish". Gate Publish on `!dirty`.
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ initial: draftMp() }) as ModalProps,
    });
    await settle();
    // Mutate the assignment textarea so the form becomes dirty.
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'orig text + edits';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Save your changes before publishing.');
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('/publish'))).toBeFalsy();
  });

  it('missing resubmission_deadline: precondition bullet shows', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ initial: draftMp({ resubmission_deadline: null }) }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Resubmission deadline must be set');
  });

  it('!runIsPublished: bullet + "Open Overview" link calls onNavigateToTab("overview")', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onNav = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ runIsPublished: false, onNavigateToTab: onNav }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Run must be published');
    const overviewLink = target.querySelector(
      '[data-action="publish-nav-overview"]',
    ) as HTMLElement;
    expect(overviewLink).toBeTruthy();
    overviewLink.click();
    expect(onNav).toHaveBeenCalledWith('overview');
  });

  it('runEndDate=null: bullet "Run end date must be set — Open Overview to set it."', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ runEndDate: null }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Run end date must be set');
  });

  it('hard_iso > runEndDate end-of-day UTC: bullet with substituted runEndDate', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    // hard_deadline is way past runEndDate
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        initial: draftMp({
          hard_deadline: '2026-07-15T10:00:00Z',
          resubmission_deadline: '2026-07-20T10:00:00Z',
        }),
        runEndDate: '2026-06-30',
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Hard deadline must be before run end (2026-06-30)');
  });

  it('resub_iso > runEndDate end-of-day UTC: bullet with substituted runEndDate', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        initial: draftMp({
          // hard within run end, but resub past it
          hard_deadline: '2026-06-15T10:00:00Z',
          resubmission_deadline: '2026-07-15T10:00:00Z',
        }),
        runEndDate: '2026-06-30',
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Resubmission deadline must be before run end (2026-06-30)');
  });

  it('Save-validation preflight: soft > hard inverted → publish bullet "Soft deadline must be before hard deadline"', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        initial: draftMp({
          soft_deadline: '2026-06-20T10:00:00Z',
          hard_deadline: '2026-06-15T10:00:00Z',
        }),
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Soft deadline must be before hard deadline');
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('/publish'))).toBeFalsy();
  });

  it('Save-validation preflight: hard > resub inverted → publish bullet "Hard deadline must be before resubmission deadline"', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        initial: draftMp({
          hard_deadline: '2026-06-20T10:00:00Z',
          resubmission_deadline: '2026-06-15T10:00:00Z',
        }),
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Hard deadline must be before resubmission deadline');
  });

  it('Save-validation preflight: empty assignment_md → publish bullet "Assignment text is required"', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ initial: draftMp({ assignment_md: '' }) }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Assignment text is required');
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('/publish'))).toBeFalsy();
  });

  it('versionIsDisabled flips while modal already open: confirm-publish blocked + bullet shows (spec line 548)', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/publish') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres({ ok: true });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state(defaultProps({ versionIsDisabled: false }));
    trackedMount(MiniProjectModal, { target, props: propsRef as ModalProps });
    await settle();
    // Click [Publish…] — preconditions met, InlineConfirm should appear
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    expect(target.querySelector('button[data-action="confirm-publish"]')).toBeTruthy();
    // Parent flips versionIsDisabled to true
    propsRef.versionIsDisabled = true;
    await settle();
    // Click confirm — must be blocked by re-evaluated publishCheckResult
    (target.querySelector('button[data-action="confirm-publish"]') as HTMLButtonElement).click();
    await settle();
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('/publish'))).toBeFalsy();
    expect(target.textContent).toContain("This run's course version is disabled");
  });

  it('aria-describedby wires precondition bullet IDs onto the offending field inputs (spec line 512)', async () => {
    // Opus T6b r1 catch: server-validation fieldErrors get aria-describedby
    // but publishCheckResult bullets did not — spec mandates both.
    //
    // Set up a draft with assignment_md empty AND hard_deadline missing.
    // Two preconditions fire:
    //   - "Assignment text is required" (targets assignment_md → MarkdownEditor textarea)
    //   - "Hard deadline must be set" (targets hard_deadline input)
    // The corresponding inputs must carry aria-describedby pointing to the
    // bullet ID in the rendered <li> within the "Cannot publish" banner.
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        initial: draftMp({
          assignment_md: '',
          hard_deadline: null,
        }),
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    // Resolve the bullet IDs we expect to find on each input.
    const banner = target.querySelector('[data-testid="publish-preconditions"]') as HTMLElement;
    expect(banner).toBeTruthy();
    const assignBullet = Array.from(banner.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Assignment text is required'),
    ) as HTMLElement;
    const hardBullet = Array.from(banner.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Hard deadline must be set'),
    ) as HTMLElement;
    expect(assignBullet.id).toBeTruthy();
    expect(hardBullet.id).toBeTruthy();
    // Textarea (inner MarkdownEditor) wired to the assignment bullet.
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('aria-describedby')?.split(/\s+/)).toContain(assignBullet.id);
    // Hard-deadline datetime input wired to the hard bullet. The three
    // datetime-locals appear in DOM order: soft, hard, resub.
    const dtInputs = target.querySelectorAll('input[type="datetime-local"]');
    const hardInput = dtInputs[1] as HTMLInputElement;
    expect(hardInput.getAttribute('aria-describedby')?.split(/\s+/)).toContain(hardBullet.id);
  });
});

describe('MiniProjectModal publish — error mapping', () => {
  it('409 on publish: inline banner with displayMessage', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/publish') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres({ detail: 'Publish blocked: preconditions changed' }, 409);
      }
      return jres([]);
    });
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps({ onClose }) as ModalProps });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-publish"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('.banner-error') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Publish blocked: preconditions changed');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('422 on create (POST): #err-block_id span + select aria-describedby="err-block_id" (spec line 527)', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/mini-projects') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres(
          { detail: [{ loc: ['body', 'block_id'], msg: 'must be set', type: 'value_error' }] },
          422,
        );
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ mode: 'create', initial: null, availableBlocks: blocks }) as ModalProps,
    });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'x';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    const span = target.querySelector('#err-block_id');
    expect(span).toBeTruthy();
    expect(span!.textContent).toContain('must be set');
    const select = target.querySelector('select');
    expect(select!.getAttribute('aria-describedby')).toBe('err-block_id');
  });

  it('422 on PATCH (edit): #err-assignment_md span + inner <textarea> aria-describedby="err-assignment_md" (spec line 527 — locks MarkdownEditor forwarding in PATCH path too)', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects/99') && (init as RequestInit | undefined)?.method === 'PATCH') {
        return jres(
          { detail: [{ loc: ['body', 'assignment_md'], msg: 'must be non-empty', type: 'value_error' }] },
          422,
        );
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps() as ModalProps });
    await settle();
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    const span = target.querySelector('#err-assignment_md');
    expect(span).toBeTruthy();
    expect(span!.textContent).toContain('must be non-empty');
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.getAttribute('aria-describedby')).toBe('err-assignment_md');
    expect(target.textContent).toContain('Please correct the highlighted fields.');
  });

  it('422 on render preview (spec lines 514, 528): preview-pane shows backend "Referenced run-assets not found" message', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/10/render') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres({ detail: 'Referenced run-assets not found: foo.csv' }, 422);
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps() as ModalProps });
    await settle();
    // Click Preview tab inside MarkdownEditor
    (target.querySelector('button[data-action="preview"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Referenced run-assets not found: foo.csv');
  });

  it('5xx on publish (spec line 530): red banner stays, modal does NOT close', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/publish') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres({ detail: 'Service Unavailable' }, 503);
      }
      return jres([]);
    });
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps({ onClose }) as ModalProps });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-publish"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('.banner-error');
    expect(banner).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('MiniProjectModal publish — submitting + mounted-flag', () => {
  it('Save and Publish share submitting: clicking Publish disables Save AND label flips to "Publishing…"', async () => {
    let resolvePublish!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/publish') && (init as RequestInit | undefined)?.method === 'POST') {
        return new Promise((r) => {
          resolvePublish = r;
        });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps() as ModalProps });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-publish"]') as HTMLButtonElement).click();
    await settle();
    // Save button is gone (footer is now in submitting-progress state) OR disabled.
    // The InlineConfirm has cleared (pendingPublishConfirm=false). The normal
    // footer shows Save disabled + Publishing… label.
    const saveBtn = target.querySelector('button[data-action="save"]') as HTMLButtonElement | null;
    expect(saveBtn?.disabled).toBe(true);
    expect(target.textContent).toContain('Publishing…');
    // Cleanup
    resolvePublish({ ok: true, status: 200, json: () => Promise.resolve(draftMp({ is_published: true })) } as Response);
    await settle();
  });

  it('mounted-flag rule: close mid-publish → post-await writes do not fire AND late resolve does not throw', async () => {
    let resolvePublish!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/publish') && (init as RequestInit | undefined)?.method === 'POST') {
        return new Promise((r) => {
          resolvePublish = r;
        });
      }
      return jres([]);
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MiniProjectModal, { target, props: defaultProps({ onSaved }) as ModalProps });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-publish"]') as HTMLButtonElement).click();
    await settle();
    unmount(cmp);
    expect(() => {
      resolvePublish({
        ok: true,
        status: 200,
        json: () => Promise.resolve(draftMp({ is_published: true })),
      } as Response);
    }).not.toThrow();
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
