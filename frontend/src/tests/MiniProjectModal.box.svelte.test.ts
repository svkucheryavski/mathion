import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import { __resetGuardsForTests } from '../lib/router.svelte';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';

type ModalProps = ComponentProps<typeof MiniProjectModal>;

const course: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
const blocks: BlockResponse[] = [
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 5, info: '', info_html: '' },
  { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 9, info: '', info_html: '' },
];

// A draft whose publish preconditions are all met (2027 deadlines, before runEndDate).
function mp(o: Partial<MiniProjectResponse> = {}): MiniProjectResponse {
  return {
    id: 99, run_id: 10, block_id: 2, title: 'Mini project for Block 2',
    assignment_md: 'orig text', assignment_html: '<p>orig text</p>',
    soft_deadline: '2027-06-01T10:00:00Z', hard_deadline: '2027-06-15T10:00:00Z',
    resubmission_deadline: '2027-06-20T10:00:00Z',
    is_published: false, first_submitted_at: null,
    created_at: '2027-05-01T00:00:00Z', updated_at: '2027-05-01T00:00:00Z',
    ...o,
  };
}

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
let cmp: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres([]));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  __resetGuardsForTests();
});

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

function baseProps(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 10, mode: 'edit', initial: mp(), availableBlocks: [], currentBlock: blocks[1], blocks,
    runIsPublished: true, versionIsDisabled: false, runEndDate: '2027-06-30', course,
    onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined), onNavigateToTab: vi.fn(),
    ...over,
  };
}
function open(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(MiniProjectModal, { target, props: props as ModalProps });
}
function reopen(props: Record<string, unknown>) {
  if (cmp) unmount(cmp);
  cmp = null;
  document.body.innerHTML = '';
  open(props);
}

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const box = () => panel().querySelector<HTMLElement>('[data-testid="publish-preconditions"]');
const bullets = () => [...box()!.querySelectorAll('li')].map((li) => li.textContent);
const btn = (a: string) => panel().querySelector<HTMLButtonElement>(`button[data-action="${a}"]`);
const closeX = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const ta = () => panel().querySelector<HTMLTextAreaElement>('textarea')!;
const hardInput = () => panel().querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1];
function type(text: string) {
  ta().value = text;
  ta().dispatchEvent(new Event('input', { bubbles: true }));
}

describe('MiniProjectModal — the precondition box up front (D13, D21, R22)', () => {
  it('shows without a Publish click while editing an unpublished mini-project with an unmet precondition', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    expect(box()).not.toBeNull();
    expect(box()!.querySelector('.mpm-box-head')!.textContent).toBe('Cannot publish yet');
    expect(bullets()).toEqual(['Hard deadline must be set']);
  });

  it('never shows when creating, nor on a published mini-project', async () => {
    open(baseProps({ mode: 'create', initial: null, currentBlock: null, availableBlocks: blocks }));
    await settle();
    expect(box()).toBeNull();
    reopen(baseProps({ initial: mp({ is_published: true, hard_deadline: null }) }));
    await settle();
    expect(box()).toBeNull();
  });

  it('follows the fields on screen: fixing a deadline removes its line, clearing the assignment adds one (D21)', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    hardInput().value = '2027-06-16T10:00';
    hardInput().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(box()).toBeNull();
    type('');
    await settle();
    expect(bullets()).toEqual(['Assignment text is required']);
  });

  it('typing into a mini-project whose preconditions are all met never shows it (R22)', async () => {
    open(baseProps());
    await settle();
    expect(box()).toBeNull();
    type('more text');
    await settle();
    expect(box()).toBeNull();
    expect(btn('publish')!.title).toBe('Save your changes first');
  });

  it('is information, not an alert: it has no live role', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    expect(box()!.hasAttribute('role')).toBe(false);
  });

  it('wires each field\'s aria-describedby to its bullets whenever it shows, without a click', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null, assignment_md: '' }) }));
    await settle();
    const lis = [...box()!.querySelectorAll('li')];
    const assign = lis.find((li) => li.textContent === 'Assignment text is required')!;
    const hard = lis.find((li) => li.textContent === 'Hard deadline must be set')!;
    expect(ta().getAttribute('aria-describedby')?.split(/\s+/)).toContain(assign.id);
    expect(hardInput().getAttribute('aria-describedby')?.split(/\s+/)).toContain(hard.id);
  });

  it('Publish is disabled with D13\'s title while it shows, even when the form is also dirty', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    expect(btn('publish')!.disabled).toBe(true);
    expect(btn('publish')!.title).toBe('Resolve the listed preconditions first');
    type('more text');
    await settle();
    expect(btn('publish')!.title).toBe('Resolve the listed preconditions first');
  });

  it('a confirm opened before a precondition broke refuses it; focus goes to × (D13)', async () => {
    const props = $state(baseProps());
    open(props);
    await settle();
    btn('publish')!.click();
    await settle();
    props.versionIsDisabled = true;
    await settle();
    btn('confirm-publish')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('/publish'))).toBe(false);
    expect(bullets()).toContain("This run's course version is disabled — Open Overview to re-enable it.");
    expect(btn('publish')!.disabled).toBe(true);
    expect(document.activeElement).toBe(closeX());
  });
});
