import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount } from 'svelte';

// Same hoisted-mock idiom as VersionsPage.slots.svelte.test.ts.
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../lib/versionArchive', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionArchive')>();
  return { ...real, checkArchive: vi.fn(), startDownload: vi.fn() };
});

import { ApiError } from '../lib/api';
import { checkArchive, startDownload } from '../lib/versionArchive';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { Version } from '../lib/types';
import { settle } from './support/settle';

const checkMock = vi.mocked(checkArchive);
const startMock = vi.mocked(startDownload);

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
  checkMock.mockReset();
  startMock.mockReset();
  clearToasts();
  versionsPageState.course = { id: 1, slug: 'c', name: 'Applied Linear Algebra', description: '', is_admin: true };
  versionsPageState.versions = [mkVersion({ id: 7 })];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function render() {
  component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
  await settle();
}
const download = (id: number) => target.querySelector<HTMLButtonElement>(`button[aria-label="Download v${id}"]`);

describe('VersionsPage — Download', () => {
  it('the row\'s Download button is "Download v7", enabled for a disabled archived version', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, state: 'archived', is_disabled: true })];
    await render();
    const b = download(7)!;
    expect(b.title).toBe('Download');
    expect(b.getAttribute('data-glyph')).toBe('download');
    expect(b.id).toBe('v-7-download');
    expect(b.disabled).toBe(false);
  });

  it('a click checks, then starts the download', async () => {
    checkMock.mockResolvedValue(undefined);
    await render();
    download(7)!.click();
    await settle();
    expect(checkMock).toHaveBeenCalledWith(7);
    expect(startMock).toHaveBeenCalledWith('/api/versions/7/archive');
    expect(toasts.list).toEqual([]);
  });

  it('a refusal shows the server\'s sentence and downloads nothing', async () => {
    checkMock.mockRejectedValue(new ApiError(409, 'These files of the version are missing on the server: a.png'));
    await render();
    download(7)!.click();
    await settle();
    expect(startMock).not.toHaveBeenCalled();
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([
      ['These files of the version are missing on the server: a.png', 'error'],
    ]);
  });

  it('a second click while checking does nothing', async () => {
    let release!: () => void;
    checkMock.mockReturnValue(new Promise<void>((r) => { release = r; }));
    await render();
    download(7)!.click();
    download(7)!.click();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
    release();
    await settle();
    expect(startMock).toHaveBeenCalledTimes(1);
    download(7)!.click();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it('the second click of a double click does nothing, even after the check is done', async () => {
    checkMock.mockResolvedValue(undefined);
    await render();
    download(7)!.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    await settle();
    download(7)!.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('another row can download while one row is checking', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 8 })];
    checkMock.mockImplementation((id: number) => (id === 7 ? new Promise<void>(() => {}) : Promise.resolve()));
    await render();
    download(7)!.click();
    download(8)!.click();
    await settle();
    expect(checkMock.mock.calls.map((c) => c[0])).toEqual([7, 8]);
    expect(startMock).toHaveBeenCalledWith('/api/versions/8/archive');
  });

  it('a failure that is not the server\'s says "Could not download this version"', async () => {
    checkMock.mockRejectedValue(new Error('x'));
    await render();
    download(7)!.click();
    await settle();
    expect(startMock).not.toHaveBeenCalled();
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Could not download this version', 'error']]);
  });

  it('a quick second click after a refusal tries again', async () => {
    checkMock.mockRejectedValueOnce(new ApiError(409, 'no')).mockResolvedValueOnce(undefined);
    await render();
    download(7)!.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    await settle();
    download(7)!.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
