import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

import RunAssetsTab from '../components/runs/RunAssetsTab.svelte';
import type { Course, MiniProjectResponse, RunAssetResponse } from '../lib/types';

const baseCourse: Course = {
  id: 1,
  slug: 'c',
  name: 'C',
  description: '',
  is_admin: true,
};

function baseProps(overrides: Partial<{
  runId: number;
  assets: RunAssetResponse[];
  miniProjects: MiniProjectResponse[];
  course: Course;
  versionIsDisabled: boolean;
}> = {}) {
  return {
    runId: 1,
    assets: [] as RunAssetResponse[],
    miniProjects: [] as MiniProjectResponse[],
    course: baseCourse,
    versionIsDisabled: false,
    onRefetchAssets: vi.fn().mockResolvedValue(undefined),
    onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
    onEditMiniProject: vi.fn(),
    onReloadRun: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = null;
});

afterEach(() => {
  if (component) unmount(component);
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

describe('RunAssetsTab — skeleton', () => {
  it('renders empty-state CTA when assets is empty', () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();
    expect(target.textContent).toMatch(/No assets yet/i);
  });
});

describe('RunAssetsTab — table rendering', () => {
  it('renders one row per asset with filename / size / uploaded_by columns', () => {
    const assets: RunAssetResponse[] = [
      {
        id: 1, run_id: 1, filename: 'doc.pdf', file_size: 1234,
        mime_type: 'application/pdf',
        uploaded_at: '2026-05-20T12:00:00Z', uploaded_by: 7,
        uploaded_by_email: 'admin@example.com', is_referenced: false,
      },
      {
        id: 2, run_id: 1, filename: 'fig.png', file_size: 180_000,
        mime_type: 'image/png',
        uploaded_at: '2026-05-21T13:00:00Z', uploaded_by: null,
        uploaded_by_email: null, is_referenced: true,
      },
    ];
    component = mount(RunAssetsTab, { target, props: baseProps({ assets }) });
    flushSync();

    // Filenames present
    const links = Array.from(target.querySelectorAll('a'));
    const linkTexts = links.map((a) => a.textContent?.trim());
    expect(linkTexts).toContain('doc.pdf');
    expect(linkTexts).toContain('fig.png');

    // formatFileSize: 1234 -> "1.2 kB", 180000 -> "180.0 kB"
    expect(target.textContent).toContain('1.2 kB');
    expect(target.textContent).toContain('180.0 kB');

    // uploaded_by_email populated for doc.pdf
    expect(target.textContent).toContain('admin@example.com');

    // fig.png row has em-dash for null uploaded_by_email (find the row by
    // its filename link, then assert the row contains an em-dash cell).
    const figRow = links.find((a) => a.textContent?.trim() === 'fig.png')?.closest('tr');
    expect(figRow).toBeTruthy();
    expect(figRow!.textContent).toMatch(/—/);
  });

  it('filename links to the GET serve URL in a new tab, with encodeURIComponent', () => {
    const assets: RunAssetResponse[] = [
      {
        id: 1, run_id: 1, filename: 'has space.pdf', file_size: 100,
        mime_type: 'application/pdf',
        uploaded_at: '2026-05-20T12:00:00Z', uploaded_by: 7,
        uploaded_by_email: 'a@b.com', is_referenced: false,
      },
    ];
    component = mount(RunAssetsTab, { target, props: baseProps({ assets }) });
    flushSync();

    const link = Array.from(target.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'has space.pdf',
    );
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/api/runs/1/assets/has%20space.pdf');
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toContain('noopener');
  });
});
