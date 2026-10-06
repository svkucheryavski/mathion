import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Inline vi.fn() in the (hoisted) factory — never capture a top-level const
// (TDZ under Vitest 2). Grab the typed handle via vi.mocked after imports.
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, patch: vi.fn() } };
});
vi.mock('../stores/currentEditorVersion.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentEditorVersion.svelte')>();
  return { ...real, loadAdminTree: vi.fn().mockResolvedValue('ok') };
});

import { api } from '../lib/api';
import { loadAdminTree } from '../stores/currentEditorVersion.svelte';
import VersionMetaForm from '../components/editor/VersionMetaForm.svelte';
import type { AdminTreeVersion } from '../lib/types';
import { DIRTY_REGISTRY_KEY, createDirtyRegistry } from '../lib/dirtyRegistry.svelte';

const patchMock = vi.mocked(api.patch);
const loadMock = vi.mocked(loadAdminTree);

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 5, course_id: 1, state: 'created', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: 'Old',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => { patchMock.mockReset(); loadMock.mockClear(); target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) { unmount(component); component = null; } if (target.parentNode) target.parentNode.removeChild(target); });

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

describe('VersionMetaForm — label (inline commit)', () => {
  it('PATCHes {label} only, then force-refreshes the tree', async () => {
    patchMock.mockResolvedValue({});
    component = mount(VersionMetaForm, {
      target,
      props: { vid: 5, version: mkVersion() },
      context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]),
    });
    await settle();

    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the label"]')!.click();
    await settle();
    const input = target.querySelector<HTMLInputElement>('.inline-field input')!;
    input.value = 'New Label';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label="Save Label"]')!.click();
    await settle();

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith('/api/versions/5', { label: 'New Label' });
    expect(loadMock).toHaveBeenCalledWith(5, { force: true });
  });

  it('PATCHes max_quiz_attempts as a number and rejects out-of-range input inline', async () => {
    patchMock.mockResolvedValue({});
    component = mount(VersionMetaForm, {
      target,
      props: { vid: 5, version: mkVersion() },
      context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]),
    });
    await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the attempt limit"]')!.click();
    await settle();
    const input = target.querySelector<HTMLInputElement>('.inline-field input[type="number"]')!;
    input.value = '11';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label="Save Max quiz attempts"]')!.click();
    await settle();
    expect(target.querySelector('.inline-field .err')!.textContent).toBe('Max quiz attempts must be a whole number between 1 and 10');
    expect(patchMock).not.toHaveBeenCalled();
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label="Save Max quiz attempts"]')!.click();
    await settle();
    expect(patchMock).toHaveBeenCalledWith('/api/versions/5', { max_quiz_attempts: 4 });
  });
});
