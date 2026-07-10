import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as apiModule from '../lib/api';
import { ApiError } from '../lib/api';
import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../stores/currentEditorVersion.svelte';

const tree = (id: number) => ({
  course: { id: 1, name: 'C', slug: 'c' },
  version: {
    id,
    course_id: 1,
    state: 'created' as const,
    is_disabled: false,
    info_md: '',
    info_html: '',
    max_quiz_attempts: 3,
    label: '',
    created_at: '',
    published_at: null,
    archived_at: null,
    content_updated_at: '',
  },
  blocks: [],
});

describe('currentEditorVersion', () => {
  beforeEach(() => clearEditorVersion());
  afterEach(() => vi.restoreAllMocks());

  it('loads a tree and stores it', async () => {
    vi.spyOn(apiModule.api, 'get').mockResolvedValue(tree(3));
    await loadAdminTree(3);
    expect(currentEditorVersion.value?.version.id).toBe(3);
  });

  it('dedupes concurrent reads of the same versionId', async () => {
    const mock = vi.spyOn(apiModule.api, 'get').mockResolvedValue(tree(3));
    await Promise.all([loadAdminTree(3), loadAdminTree(3), loadAdminTree(3)]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('force=true does NOT dedupe (post-mutation refetch)', async () => {
    const mock = vi.spyOn(apiModule.api, 'get').mockResolvedValue(tree(3));
    await loadAdminTree(3);
    await loadAdminTree(3, { force: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('stale-guard: a slow response for an older versionId does not overwrite', async () => {
    let resolveFirst!: (v: unknown) => void;
    const slow = new Promise((r) => {
      resolveFirst = r;
    });
    vi.spyOn(apiModule.api, 'get')
      .mockImplementationOnce(() => slow as Promise<unknown>)
      .mockResolvedValueOnce(tree(4));
    const p1 = loadAdminTree(3);
    const p2 = loadAdminTree(4);
    await p2;
    resolveFirst(tree(3));
    await p1;
    expect(currentEditorVersion.value?.version.id).toBe(4);
    // Both settled: loading must be false, error null. A regression that lets
    // the stale path leave loading=true would otherwise pass undetected.
    expect(currentEditorVersion.loading).toBe(false);
    expect(currentEditorVersion.error).toBe(null);
  });

  it('clearEditorVersion empties the store and invalidates pending', () => {
    clearEditorVersion();
    expect(currentEditorVersion.value).toBe(null);
    expect(currentEditorVersion.loading).toBe(false);
  });

  it('clearEditorVersion called mid-flight prevents the response from writing', async () => {
    // Direct repro of plan behavior #5 ("invalidates pending"). A regression
    // that removes token++ from clearEditorVersion would silently let the
    // stale response clobber the cleared store; the previous test only
    // exercised the empty-store case.
    let resolve!: (v: unknown) => void;
    const deferred = new Promise((r) => {
      resolve = r;
    });
    vi.spyOn(apiModule.api, 'get').mockImplementationOnce(() => deferred as Promise<unknown>);
    const p = loadAdminTree(7);
    clearEditorVersion();
    resolve(tree(7));
    await p;
    expect(currentEditorVersion.value).toBe(null);
    expect(currentEditorVersion.loading).toBe(false);
    expect(currentEditorVersion.error).toBe(null);
  });

  it('error path: ApiError uses displayMessage, other errors use generic message', async () => {
    // Covers the otherwise-untested branch at currentEditorVersion.svelte.ts:43-46.
    // First call: ApiError → displayMessage.
    vi.spyOn(apiModule.api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom'));
    await loadAdminTree(8);
    expect(currentEditorVersion.error).toBe('boom');
    expect(currentEditorVersion.loading).toBe(false);
    expect(currentEditorVersion.value).toBe(null);

    // Second call: plain Error → generic fallback. clearEditorVersion to reset.
    clearEditorVersion();
    vi.spyOn(apiModule.api, 'get').mockRejectedValueOnce(new Error('network down'));
    await loadAdminTree(9);
    expect(currentEditorVersion.error).toBe('Could not load version.');
    expect(currentEditorVersion.loading).toBe(false);
  });

  // Outcome contract (D-C1): loadAdminTree returns one of 'ok' | 'error' |
  // 'discarded' so callers can distinguish a refetch invalidated by a newer
  // navigation (clearEditorVersion / a newer load) from a true server error.
  // Without this, a save() followed by an unmount-driven clearEditorVersion
  // would leave the store with value=null and the page would mistake the
  // discarded refetch for a refetch failure and emit the misleading
  // "refresh failed — reload to see latest" toast.
  it('loadAdminTree returns "ok" on success', async () => {
    vi.spyOn(apiModule.api, 'get').mockResolvedValue(tree(3));
    const result = await loadAdminTree(3);
    expect(result).toBe('ok');
  });

  it('loadAdminTree returns "error" on ApiError', async () => {
    vi.spyOn(apiModule.api, 'get').mockRejectedValueOnce(new ApiError(500, 'boom'));
    const result = await loadAdminTree(8);
    expect(result).toBe('error');
  });

  it('loadAdminTree returns "discarded" when clearEditorVersion runs mid-flight', async () => {
    let resolve!: (v: unknown) => void;
    const deferred = new Promise((r) => {
      resolve = r;
    });
    vi.spyOn(apiModule.api, 'get').mockImplementationOnce(() => deferred as Promise<unknown>);
    const p = loadAdminTree(7);
    clearEditorVersion();
    resolve(tree(7));
    const result = await p;
    expect(result).toBe('discarded');
  });

  it('loadAdminTree returns "discarded" when a newer load supersedes it', async () => {
    let resolveFirst!: (v: unknown) => void;
    const slow = new Promise((r) => {
      resolveFirst = r;
    });
    vi.spyOn(apiModule.api, 'get')
      .mockImplementationOnce(() => slow as Promise<unknown>)
      .mockResolvedValueOnce(tree(4));
    const p1 = loadAdminTree(3);
    const p2 = loadAdminTree(4);
    const r2 = await p2;
    resolveFirst(tree(3));
    const r1 = await p1;
    expect(r2).toBe('ok');
    expect(r1).toBe('discarded');
  });

  it('dedupe path returns the in-flight result type', async () => {
    // Concurrent same-id calls share one promise — both must report 'ok' so
    // callers awaiting the dedupe path don't think their request was tossed.
    vi.spyOn(apiModule.api, 'get').mockResolvedValue(tree(3));
    const [a, b] = await Promise.all([loadAdminTree(3), loadAdminTree(3)]);
    expect(a).toBe('ok');
    expect(b).toBe('ok');
  });
});
