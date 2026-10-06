import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Same hoisted-mock idiom as VersionsPage.duplicate.svelte.test.ts.
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, post: vi.fn(), delete: vi.fn() } };
});

import { navigate } from '../lib/router.svelte';
import { api } from '../lib/api';
import { loadVersionsPage } from '../lib/versionsPageLoader.svelte';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import type { Version } from '../lib/types';

const navigateMock = vi.mocked(navigate);

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: '',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  navigateMock.mockReset();
  versionsPageState.course = { id: 1, slug: 'c', name: 'Applied Linear Algebra', description: '', is_admin: true };
  versionsPageState.versions = [];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
async function render() {
  component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
  await settle();
}
const byLabel = (l: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`);
const slots = (id: number) => {
  const row = byLabel(`Open v${id}`)!.closest('li')!;
  return [...row.querySelectorAll<HTMLButtonElement>('.slots button')];
};

describe('VersionsPage — heading (3a)', () => {
  it('h1 is the course name only, with a round back button', async () => {
    await render();
    expect(target.querySelector('h1')!.textContent).toBe('Applied Linear Algebra');
    const back = byLabel('Back to courses')!;
    expect(back.classList.contains('round')).toBe(true);
    expect(back.getAttribute('data-glyph')).toBe('back');
    back.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses');
  });

  it('shows the version count in .mono', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 5 })];
    await render();
    const count = target.querySelector('.count')!;
    expect(count.textContent).toBe('2');
    expect(count.classList.contains('mono')).toBe(true);
  });
});

describe('VersionsPage — four fixed slots (§5.4)', () => {
  it('a created, enabled version: all four enabled with plain titles', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    const s = slots(7);
    expect(s.map((b) => b.getAttribute('data-glyph'))).toEqual(['pencil', 'duplicate', 'disable', 'trash']);
    expect(s.map((b) => b.title)).toEqual(['Open', 'Duplicate', 'Disable', 'Delete']);
    expect(s.every((b) => !b.disabled)).toBe(true);
    expect(s[3].classList.contains('danger')).toBe(true);
  });

  it('a published version: Delete disabled with its reason', async () => {
    versionsPageState.versions = [mkVersion({ id: 5, state: 'published' })];
    await render();
    const del = byLabel('Delete v5')!;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe('Delete — only for a created version');
    expect(byLabel('Duplicate v5')!.disabled).toBe(false);
  });

  it('an archived + disabled version (ref 1498): Enable slot, Duplicate and Delete disabled with reasons', async () => {
    versionsPageState.versions = [mkVersion({ id: 3, state: 'archived', is_disabled: true })];
    await render();
    const s = slots(3);
    expect(s.map((b) => b.getAttribute('data-glyph'))).toEqual(['pencil', 'duplicate', 'enable', 'trash']);
    expect(s[1].disabled).toBe(true);
    expect(s[1].title).toBe('Duplicate — enable the version first');
    expect(s[2].disabled).toBe(false);
    expect(s[3].title).toBe('Delete — only for a created version');
  });

  it('a created + disabled version: Delete says "enable the version first"', async () => {
    versionsPageState.versions = [mkVersion({ id: 9, is_disabled: true })];
    await render();
    expect(byLabel('Delete v9')!.title).toBe('Delete — enable the version first');
  });

  it('a disabled version number takes the muted hook (D5)', async () => {
    versionsPageState.versions = [mkVersion({ id: 3, is_disabled: true }), mkVersion({ id: 4 })];
    await render();
    const nums = [...target.querySelectorAll('.vnum')];
    expect(nums.map((n) => n.textContent)).toEqual(['v3', 'v4']);
    expect(nums[0].classList.contains('off')).toBe(true);
    expect(nums[1].classList.contains('off')).toBe(false);
    expect(nums[0].classList.contains('mono')).toBe(true);
  });

  it('Open navigates to the editor', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    byLabel('Open v7')!.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/7');
  });
});

describe('VersionsPage — collapsed create form (§5.3)', () => {
  it('starts collapsed; + opens it, focuses Label, swaps to close; close resets the fields', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    expect(target.querySelector('form.create')).toBeNull();
    const toggle = byLabel('New version')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.classList.contains('primary')).toBe(true);
    toggle.click();
    await settle();
    const label = target.querySelector<HTMLInputElement>('input.new-label')!;
    expect(document.activeElement).toBe(label);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('data-glyph')).toBe('close');
    expect(toggle.title).toBe('Cancel new version');
    label.value = 'Draft';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    toggle.click();
    await settle();
    expect(target.querySelector('form.create')).toBeNull();
    toggle.click();
    await settle();
    expect(target.querySelector<HTMLInputElement>('input.new-label')!.value).toBe('');
  });
});

describe('VersionsPage — states (9d)', () => {
  it('initial loading (no course yet) renders a page Skeleton', async () => {
    versionsPageState.course = null;
    versionsPageState.loading = true;
    await render();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelector('h1')).toBeNull();
  });

  it('a reload keeps the heading and header; the Skeleton takes the list position (spec §2)', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    versionsPageState.loading = true;
    await render();
    expect(target.querySelector('h1')!.textContent).toBe('Applied Linear Algebra');
    expect(target.querySelector('.versions-head')).not.toBeNull();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(byLabel('Open v7')).toBeNull();
  });

  it('a stale course from another slug is not shown while the new slug loads', async () => {
    versionsPageState.course = { id: 2, slug: 'other', name: 'Other Course', description: '', is_admin: true };
    versionsPageState.loading = true;
    await render();
    expect(target.querySelector('h1')).toBeNull();
    expect(target.querySelector('.skeleton')).not.toBeNull();
  });

  it('error renders a page ErrorState with Back to courses', async () => {
    versionsPageState.error = { status: 500, message: 'Server down' };
    await render();
    const es = target.querySelector('.error-state.page')!;
    expect(es.querySelector('h1')!.textContent).toBe("Couldn't load");
    expect(es.textContent).toContain('Server down');
    const back = [...es.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Back to courses')!;
    back.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses');
  });

  it('empty renders the header plus an EmptyState whose action opens the form', async () => {
    await render();
    expect(target.querySelector('h2')!.textContent).toBe('Versions');
    const es = target.querySelector('.empty-state')!;
    expect(es.querySelector('.title')!.textContent).toBe('No versions yet');
    expect(es.querySelector('.tile')).not.toBeNull();
    expect(es.querySelector('.hint')!.textContent).toMatch(/^A version holds the blocks/);
    const act = [...es.querySelectorAll('button')].find((b) => b.textContent?.trim() === '+ New version')!;
    act.click();
    await settle();
    expect(target.querySelector('form.create')).not.toBeNull();
  });
});

describe('VersionsPage — row actions through the slots', () => {
  const postMock = vi.mocked(api.post);
  const deleteMock = vi.mocked(api.delete);
  const loadMock = vi.mocked(loadVersionsPage);
  beforeEach(() => {
    postMock.mockReset().mockResolvedValue(undefined);
    deleteMock.mockReset().mockResolvedValue(undefined);
    loadMock.mockClear();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('Disable POSTs /disable then reloads', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    loadMock.mockClear();
    byLabel('Disable v7')!.click();
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/versions/7/disable');
    expect(deleteMock).not.toHaveBeenCalled();
    expect(loadMock).toHaveBeenCalledWith('c');
  });

  it('Enable POSTs /enable', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, is_disabled: true })];
    await render();
    byLabel('Enable v7')!.click();
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/versions/7/enable');
  });

  it('Delete sends DELETE /api/versions/{id} and no transition', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    byLabel('Delete v7')!.click();
    await settle();
    expect(deleteMock).toHaveBeenCalledWith('/api/versions/7');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('a cancelled confirm sends nothing', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    byLabel('Disable v7')!.click();
    byLabel('Delete v7')!.click();
    await settle();
    expect(postMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('while a request is in flight every slot and the + are disabled', async () => {
    let release!: () => void;
    postMock.mockReturnValue(new Promise<undefined>((r) => { release = () => r(undefined); }));
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 8 })];
    await render();
    byLabel('Disable v7')!.click();
    await settle();
    for (const id of [7, 8]) expect(slots(id).every((b) => b.disabled)).toBe(true);
    expect(byLabel('New version')!.disabled).toBe(true);
    release();
    await settle();
    expect(byLabel('Open v8')!.disabled).toBe(false);
  });
});
