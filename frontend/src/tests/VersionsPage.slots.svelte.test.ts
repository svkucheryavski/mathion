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

  // 5c follow-up (user, 2026-10-08): the count is a heading chip, as the version
  // page's "max N quiz attempts"; the Versions row (h2 + count + "+") is gone.
  it('the version count is a chip after the course name; "Versions" stays as a hidden h2', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 5 })];
    await render();
    const chips = [...target.querySelectorAll('.heading .hchip')];
    expect(chips.map((c) => c.textContent)).toEqual(['2 versions']);
    const h2 = target.querySelector('h2')!;
    expect(h2.textContent).toBe('Versions');
    expect(h2.classList.contains('sr-only')).toBe(true);
    expect(target.querySelector('.versions-head')).toBeNull();
    expect(byLabel('New version')).toBeNull();
  });

  it('the chip is singular for one version', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    expect(target.querySelector('.heading .hchip')!.textContent).toBe('1 version');
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

  // 5c follow-up (user, 2026-10-08): the row reads like a block row — the label
  // as the title (a button that opens the version), then the id as a chip.
  it('a row is: the label as a title button, then a v{id} chip, then the state badge', async () => {
    versionsPageState.versions = [mkVersion({ id: 11, label: 'Draft B' })];
    await render();
    const row = byLabel('Open v11')!.closest('li')!;
    const title = row.querySelector<HTMLButtonElement>('button.vtitle')!;
    expect(title.textContent).toBe('Draft B');
    const chip = row.querySelector('.hchip')!;
    expect(chip.textContent).toBe('v. 11'); // "v. N" (user, 2026-10-08)
    const badge = row.querySelector('.vbadge')!;
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(title, chip) && follows(chip, badge)).toBe(true);
    expect(row.querySelector('.vnum')).toBeNull();
  });

  it('clicking the title opens the version, as the pencil does', async () => {
    versionsPageState.versions = [mkVersion({ id: 11, label: 'Draft B' })];
    await render();
    target.querySelector<HTMLButtonElement>('button.vtitle')!.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/11');
  });

  // Two versions may share a label ("Copy of …"): the title's name carries the id
  // so a screen reader can tell them apart (review, both lanes).
  it("the title's accessible name carries the id", async () => {
    versionsPageState.versions = [mkVersion({ id: 11, label: 'Fall' }), mkVersion({ id: 12, label: 'Fall' })];
    await render();
    expect([...target.querySelectorAll('button.vtitle')].map((b) => b.getAttribute('aria-label'))).toEqual(['Fall (v11)', 'Fall (v12)']);
  });

  // The label is mandatory and the migration names old versions "Version <id>";
  // an empty one can't arrive, but must not render an empty button if it does.
  it('an empty label falls back to "Version <id>", the migration\'s name', async () => {
    versionsPageState.versions = [mkVersion({ id: 10, label: '' })];
    await render();
    const title = target.querySelector<HTMLButtonElement>('button.vtitle')!;
    expect(title.textContent).toBe('Version 10');
    expect(title.getAttribute('aria-label')).toBe('Version 10 (v10)');
  });

  it('a disabled version title takes the muted hook (D5)', async () => {
    versionsPageState.versions = [mkVersion({ id: 3, label: 'A', is_disabled: true }), mkVersion({ id: 4, label: 'B' })];
    await render();
    const titles = [...target.querySelectorAll('button.vtitle')];
    expect(titles[0].classList.contains('off')).toBe(true);
    expect(titles[1].classList.contains('off')).toBe(false);
    expect([...target.querySelectorAll('.vrow .hchip')].map((c) => c.textContent)).toEqual(['v. 3', 'v. 4']);
  });

  it('Open navigates to the editor', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    byLabel('Open v7')!.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/7');
  });
});

// 5c follow-up (user, 2026-10-08): "+ Add version" is a quiet line UNDER the
// list, as "+ Add block" / "+ Add sequence"; the form opens in its place.
const addLine = () => target.querySelector<HTMLButtonElement>('button.add-line');
const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
describe('VersionsPage — "+ Add version" line (5c follow-up)', () => {
  it('sits after the list; opens the form in its place with Label focused', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    expect(target.querySelector('form.create')).toBeNull();
    const line = addLine()!;
    expect(line.textContent).toBe('+ Add version');
    expect(after(target.querySelector('ul.vlist')!, line)).toBe(true);
    line.click();
    await settle();
    const form = target.querySelector('form.create')!;
    expect(after(target.querySelector('ul.vlist')!, form)).toBe(true);
    expect(addLine()).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('input.new-label'));
  });

  it('Cancel closes the form, focuses the line again and resets the fields', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    addLine()!.click();
    await settle();
    const label = target.querySelector<HTMLInputElement>('input.new-label')!;
    label.value = 'Draft';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    [...target.querySelectorAll<HTMLButtonElement>('form.create button')].find((b) => b.textContent?.trim() === 'Cancel')!.click();
    await settle();
    expect(target.querySelector('form.create')).toBeNull();
    expect(document.activeElement).toBe(addLine());
    addLine()!.click();
    await settle();
    expect(target.querySelector<HTMLInputElement>('input.new-label')!.value).toBe('');
  });

  // The label is mandatory (user, 2026-10-08).
  it('the Label field is required: Create stays disabled until it has text', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    addLine()!.click();
    await settle();
    const form = target.querySelector('form.create')!;
    const label = form.querySelector<HTMLInputElement>('input.new-label')!;
    expect(label.closest('label')!.firstChild!.textContent!.trim()).toBe('Label');
    expect(label.required).toBe(true);
    const create = [...form.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Create')!;
    expect(create.disabled).toBe(true);
    label.value = '   ';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(create.disabled).toBe(true);
    label.value = 'Spring';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(create.disabled).toBe(false);
  });

  it('Escape in the form cancels it', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    addLine()!.click();
    await settle();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.querySelector('input.new-label')!.dispatchEvent(ev);
    await settle();
    expect(target.querySelector('form.create')).toBeNull();
    expect(document.activeElement).toBe(addLine());
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
    expect(target.querySelector('.heading .hchip')).not.toBeNull();
    expect(addLine()).not.toBeNull();
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

  it('empty renders an EmptyState (no button of its own) with "+ Add version" under it', async () => {
    await render();
    expect(target.querySelector('.heading .hchip')!.textContent).toBe('0 versions');
    const es = target.querySelector('.empty-state')!;
    expect(es.querySelector('.title')!.textContent).toBe('No versions yet');
    expect(es.querySelector('.tile')).not.toBeNull();
    expect(es.querySelector('.hint')!.textContent).toMatch(/^A version holds the blocks/);
    expect(es.querySelector('button')).toBeNull();
    expect(after(es, addLine()!)).toBe(true);
    addLine()!.click();
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

  it('while a request is in flight every slot and "+ Add version" are disabled', async () => {
    let release!: () => void;
    postMock.mockReturnValue(new Promise<undefined>((r) => { release = () => r(undefined); }));
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 8 })];
    await render();
    byLabel('Disable v7')!.click();
    await settle();
    for (const id of [7, 8]) expect(slots(id).every((b) => b.disabled)).toBe(true);
    expect([...target.querySelectorAll<HTMLButtonElement>('button.vtitle')].every((b) => b.disabled)).toBe(true);
    expect(addLine()!.disabled).toBe(true);
    release();
    await settle();
    expect(byLabel('Open v8')!.disabled).toBe(false);
  });
});
