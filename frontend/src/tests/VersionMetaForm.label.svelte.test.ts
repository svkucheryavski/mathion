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
  return { ...real, loadAdminTree: vi.fn().mockResolvedValue('discarded') };
});

import { api } from '../lib/api';
import VersionMetaForm from '../components/editor/VersionMetaForm.svelte';
import type { AdminTreeVersion } from '../lib/types';
import { DIRTY_REGISTRY_KEY, createDirtyRegistry } from '../lib/dirtyRegistry.svelte';

const patchMock = vi.mocked(api.patch);

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 5, course_id: 1, state: 'created', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: 'Old',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}

// The component reads the dirty registry from getContext(DIRTY_REGISTRY_KEY)
// and throws if it's missing. Svelte 5's mount() takes a `context` Map — the
// same pattern the existing DIRTY_REGISTRY_KEY mount-context tests use.
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => { patchMock.mockReset(); target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) { unmount(component); component = null; } if (target.parentNode) target.parentNode.removeChild(target); });

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

describe('VersionMetaForm — label', () => {
  it('PATCHes the edited label (created state)', async () => {
    patchMock.mockResolvedValue({});
    component = mount(VersionMetaForm, {
      target,
      props: { vid: 5, version: mkVersion() },
      context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]),
    });
    await settle();

    const input = target.querySelector<HTMLInputElement>('input.meta-label');
    if (!input) throw new Error('label input missing');
    input.value = 'New Label';
    input.dispatchEvent(new Event('input'));
    flushSync();

    const saveBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save');
    if (!saveBtn) throw new Error('Save button missing');
    saveBtn.click();
    await settle();

    expect(patchMock).toHaveBeenCalledWith('/api/versions/5', expect.objectContaining({ label: 'New Label' }));
  });
});
