import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as apiModule from '../lib/api';
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
  });

  it('clearEditorVersion empties the store and invalidates pending', () => {
    clearEditorVersion();
    expect(currentEditorVersion.value).toBe(null);
    expect(currentEditorVersion.loading).toBe(false);
  });
});
