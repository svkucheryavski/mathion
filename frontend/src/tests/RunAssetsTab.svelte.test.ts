import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('../lib/runAssets', async () => {
  const actual = await vi.importActual<typeof import('../lib/runAssets')>('../lib/runAssets');
  return {
    ...actual,
    uploadRunAsset: vi.fn(),
    replaceRunAsset: vi.fn(),
    deleteRunAsset: vi.fn(),
  };
});

import RunAssetsTab from '../components/runs/RunAssetsTab.svelte';
import { uploadRunAsset, replaceRunAsset, deleteRunAsset } from '../lib/runAssets';
import type { Course, MiniProjectResponse, RunAssetResponse } from '../lib/types';

// jsdom doesn't ship DataTransfer/DragEvent constructors with a writable
// `files` property, so build a minimal shape via Object.defineProperty —
// mirrors AssetSidebar.run-mode.svelte.test.ts:14-19.
function makeDropEvent(files: File[]): DragEvent {
  const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
  Object.defineProperty(ev, 'dataTransfer', { value: { files } });
  return ev;
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function pickReplaceFile(file: File): void {
  const input = document.querySelector('input[type="file"][data-role="replace"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

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
  miniProjects: MiniProjectResponse[] | null;
  course: Course;
  versionIsDisabled: boolean;
  onEditMiniProject: (mp: MiniProjectResponse) => void;
}> = {}) {
  return {
    runId: 1,
    assets: [] as RunAssetResponse[],
    miniProjects: [] as MiniProjectResponse[] | null,
    course: baseCourse,
    versionIsDisabled: false,
    onRefetchAssets: vi.fn().mockResolvedValue(undefined),
    onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
    onEditMiniProject: vi.fn(),
    onReloadRun: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mkAsset(id: number, filename: string): RunAssetResponse {
  return {
    id, run_id: 1, filename, file_size: 100, mime_type: 'application/pdf',
    uploaded_at: '2026-05-20T12:00:00Z', uploaded_by: 7,
    uploaded_by_email: 'a@b.com', is_referenced: false,
  };
}

function mkMp(id: number, title: string, assignment_md: string): MiniProjectResponse {
  return {
    id, run_id: 1, block_id: 1, title,
    assignment_md, assignment_html: '',
    soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
    is_published: false, first_submitted_at: null,
    created_at: '2026-05-20T12:00:00Z', updated_at: '2026-05-20T12:00:00Z',
  };
}

function findButton(root: HTMLElement, label: RegExp): HTMLButtonElement | null {
  for (const b of root.querySelectorAll('button')) {
    if (label.test(b.textContent?.trim() ?? '')) return b as HTMLButtonElement;
  }
  return null;
}

function findAllButtons(root: HTMLElement, label: RegExp): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll('button')).filter((b) =>
    label.test(b.textContent?.trim() ?? ''),
  ) as HTMLButtonElement[];
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

describe('RunAssetsTab — filter pills', () => {
  const fixtureAssets = [
    mkAsset(1, 'orphan-a.pdf'),
    mkAsset(2, 'orphan-b.pdf'),
    mkAsset(3, 'referenced.pdf'),
  ];
  const fixtureMps = [mkMp(10, 'MP1', 'See ![ref](referenced.pdf).')];

  it('counts orphan vs referenced from extractAssetRefs scan', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: fixtureAssets, miniProjects: fixtureMps }),
    });
    flushSync();
    expect(findButton(target, /All \(3\)/)).toBeTruthy();
    expect(findButton(target, /Orphan \(2\)/)).toBeTruthy();
    expect(findButton(target, /Referenced \(1\)/)).toBeTruthy();
  });

  it('clicking Orphan narrows the table; aria-pressed updates', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: fixtureAssets, miniProjects: fixtureMps }),
    });
    flushSync();
    const orphanPill = findButton(target, /Orphan/)!;
    expect(orphanPill.getAttribute('aria-pressed')).toBe('false');

    orphanPill.click();
    flushSync();
    expect(orphanPill.getAttribute('aria-pressed')).toBe('true');

    // Only orphan rows visible
    const links = Array.from(target.querySelectorAll('a')).map((a) =>
      a.textContent?.trim(),
    );
    expect(links).toContain('orphan-a.pdf');
    expect(links).toContain('orphan-b.pdf');
    expect(links).not.toContain('referenced.pdf');
  });

  it('miniProjects === null → all assets show as orphan; filter counts treat MPs as empty', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: fixtureAssets, miniProjects: null }),
    });
    flushSync();
    expect(findButton(target, /Orphan \(3\)/)).toBeTruthy();
    expect(findButton(target, /Referenced \(0\)/)).toBeTruthy();
  });
});

describe('RunAssetsTab — sort', () => {
  const sortAssets = [
    mkAsset(1, 'banana.pdf'),
    mkAsset(2, 'apple.pdf'),
    mkAsset(3, 'cherry.pdf'),
  ];

  function rowFilenames(): string[] {
    const rows = Array.from(target.querySelectorAll('tbody tr'));
    return rows.flatMap((r) => {
      const a = r.querySelector('a');
      return a ? [a.textContent!.trim()] : [];
    });
  }

  it('default sort is filename ascending', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: sortAssets }),
    });
    flushSync();
    expect(rowFilenames()).toEqual(['apple.pdf', 'banana.pdf', 'cherry.pdf']);

    const ths = Array.from(target.querySelectorAll('th'));
    const filenameTh = ths.find((th) => th.textContent?.includes('Filename'))!;
    expect(filenameTh.getAttribute('aria-sort')).toBe('ascending');
  });

  it('clicking Filename header cycles asc → desc → none', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: sortAssets }),
    });
    flushSync();

    const filenameBtn = findButton(target, /^Filename$/)!;

    filenameBtn.click();
    flushSync();
    const ths1 = Array.from(target.querySelectorAll('th'));
    expect(ths1.find((th) => th.textContent?.includes('Filename'))!.getAttribute('aria-sort')).toBe(
      'descending',
    );
    expect(rowFilenames()).toEqual(['cherry.pdf', 'banana.pdf', 'apple.pdf']);

    filenameBtn.click();
    flushSync();
    const ths2 = Array.from(target.querySelectorAll('th'));
    expect(ths2.find((th) => th.textContent?.includes('Filename'))!.getAttribute('aria-sort')).toBe(
      'none',
    );
    // 'none' preserves insertion order from `assets`
    expect(rowFilenames()).toEqual(['banana.pdf', 'apple.pdf', 'cherry.pdf']);

    filenameBtn.click();
    flushSync();
    const ths3 = Array.from(target.querySelectorAll('th'));
    expect(ths3.find((th) => th.textContent?.includes('Filename'))!.getAttribute('aria-sort')).toBe(
      'ascending',
    );
  });

  it('sort persists across filter changes', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: sortAssets,
        miniProjects: [mkMp(10, 'MP1', '![](apple.pdf)')],
      }),
    });
    flushSync();

    // Switch to descending
    const filenameBtn = findButton(target, /^Filename$/)!;
    filenameBtn.click();
    flushSync();
    expect(rowFilenames()).toEqual(['cherry.pdf', 'banana.pdf', 'apple.pdf']);

    // Apply Orphan filter — sort should stay descending
    findButton(target, /Orphan/)!.click();
    flushSync();
    expect(rowFilenames()).toEqual(['cherry.pdf', 'banana.pdf']);
  });

  it('Size column sort: clicking cycles asc -> desc -> none', () => {
    const assetsBySize = [
      { ...mkAsset(1, 'medium.pdf'), file_size: 5000 },
      { ...mkAsset(2, 'small.pdf'), file_size: 100 },
      { ...mkAsset(3, 'large.pdf'), file_size: 50_000 },
    ];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: assetsBySize }),
    });
    flushSync();

    const sizeBtn = findButton(target, /^Size$/)!;
    const sizeTh = () =>
      Array.from(target.querySelectorAll('th')).find((th) =>
        th.textContent?.includes('Size'),
      )!;

    sizeBtn.click();
    flushSync();
    expect(rowFilenames()).toEqual(['small.pdf', 'medium.pdf', 'large.pdf']);
    expect(sizeTh().getAttribute('aria-sort')).toBe('ascending');

    sizeBtn.click();
    flushSync();
    expect(rowFilenames()).toEqual(['large.pdf', 'medium.pdf', 'small.pdf']);
    expect(sizeTh().getAttribute('aria-sort')).toBe('descending');

    sizeBtn.click();
    flushSync();
    // 'none' preserves the original insertion order from `assets`
    expect(rowFilenames()).toEqual(['medium.pdf', 'small.pdf', 'large.pdf']);
    expect(sizeTh().getAttribute('aria-sort')).toBe('none');
  });

  it('Uploaded column sort by uploaded_at', () => {
    const assetsByDate = [
      { ...mkAsset(1, 'middle.pdf'), uploaded_at: '2026-05-15T12:00:00Z' },
      { ...mkAsset(2, 'old.pdf'), uploaded_at: '2026-05-01T12:00:00Z' },
      { ...mkAsset(3, 'new.pdf'), uploaded_at: '2026-05-25T12:00:00Z' },
    ];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: assetsByDate }),
    });
    flushSync();

    findButton(target, /^Uploaded$/)!.click();
    flushSync();
    expect(rowFilenames()).toEqual(['old.pdf', 'middle.pdf', 'new.pdf']);

    const ths = Array.from(target.querySelectorAll('th'));
    expect(
      ths.find((th) => th.textContent?.includes('Uploaded'))!.getAttribute('aria-sort'),
    ).toBe('ascending');
  });

  it('switching sort field resets to ascending; previous field aria-sort becomes none', () => {
    // Use unequal sizes so we can verify row-order, not only aria-sort.
    const mixedAssets = [
      { ...mkAsset(1, 'banana.pdf'), file_size: 5000 },
      { ...mkAsset(2, 'apple.pdf'), file_size: 100 },
      { ...mkAsset(3, 'cherry.pdf'), file_size: 50_000 },
    ];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: mixedAssets }),
    });
    flushSync();

    // Cycle Filename to descending
    findButton(target, /^Filename$/)!.click();
    flushSync();
    expect(rowFilenames()).toEqual(['cherry.pdf', 'banana.pdf', 'apple.pdf']);

    // Switch to Size — sortField='size', sortDir='ascending'
    findButton(target, /^Size$/)!.click();
    flushSync();
    expect(rowFilenames()).toEqual(['apple.pdf', 'banana.pdf', 'cherry.pdf']);

    const ths = Array.from(target.querySelectorAll('th'));
    expect(ths.find((th) => th.textContent?.includes('Filename'))!.getAttribute('aria-sort')).toBe(
      'none',
    );
    expect(ths.find((th) => th.textContent?.includes('Size'))!.getAttribute('aria-sort')).toBe(
      'ascending',
    );
  });
});

describe('RunAssetsTab — filtered-empty state', () => {
  it('shows "No orphan assets" when all are referenced and Orphan filter is active', () => {
    const allRefd = [mkAsset(1, 'ref.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: allRefd,
        miniProjects: [mkMp(10, 'MP1', '![](ref.pdf)')],
      }),
    });
    flushSync();
    findButton(target, /Orphan/)!.click();
    flushSync();
    expect(target.textContent).toMatch(/No orphan assets/i);
    expect(target.querySelector('tbody')).toBeNull();
  });

  it('shows "No referenced assets" when all are orphan and Referenced filter is active', () => {
    const allOrphan = [mkAsset(1, 'a.pdf'), mkAsset(2, 'b.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: allOrphan, miniProjects: [] }),
    });
    flushSync();
    findButton(target, /Referenced/)!.click();
    flushSync();
    expect(target.textContent).toMatch(/No referenced assets/i);
  });
});

describe('RunAssetsTab — Esc collapses sub-panel', () => {
  it('Esc keydown on the uses badge collapses the open sub-panel', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: [mkAsset(1, 'foo.pdf')],
        miniProjects: [mkMp(10, 'MP A', '![](foo.pdf)')],
      }),
    });
    flushSync();

    const badge = findButton(target, /1 use$/)!;
    badge.click();
    flushSync();
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    expect(target.querySelector('.sub-panel')).not.toBeNull();

    badge.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    flushSync();
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(target.querySelector('.sub-panel')).toBeNull();
  });
});

describe('RunAssetsTab — miniProjects prop-update recomputes', () => {
  it('updating miniProjects on a STAYED-mounted instance re-derives filter counts', () => {
    const assetsFix = [mkAsset(1, 'doc.pdf')];

    // Reactive props box: mutating its fields propagates into the component's
    // $props() reads. This proves in-mount re-derivation, not a fresh render.
    const box = $state({
      ...baseProps({ assets: assetsFix, miniProjects: [] }),
    });

    component = mount(RunAssetsTab, { target, props: box });
    flushSync();
    expect(findButton(target, /Orphan \(1\)/)).toBeTruthy();
    expect(findButton(target, /Referenced \(0\)/)).toBeTruthy();

    // In-mount update: add a referencing MP
    box.miniProjects = [mkMp(10, 'MP1', '![](doc.pdf)')];
    flushSync();
    expect(findButton(target, /Orphan \(0\)/)).toBeTruthy();
    expect(findButton(target, /Referenced \(1\)/)).toBeTruthy();

    // And back to empty — refs should clear without unmount
    box.miniProjects = [];
    flushSync();
    expect(findButton(target, /Orphan \(1\)/)).toBeTruthy();
    expect(findButton(target, /Referenced \(0\)/)).toBeTruthy();
  });
});

describe('RunAssetsTab — uses badge + sub-panel', () => {
  const subPanelAssets = [mkAsset(1, 'foo.pdf')];
  const subPanelMps = [
    mkMp(10, 'MP A', '![](foo.pdf)'),
    mkMp(11, 'MP B', '[](foo.pdf)'),
  ];

  it('uses badge is a disclosure button with aria-expanded=false initially and aria-controls=uses-{id}', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: subPanelAssets, miniProjects: subPanelMps }),
    });
    flushSync();
    const badge = findButton(target, /2 uses/)!;
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(badge.getAttribute('aria-controls')).toBe('uses-1');
  });

  it('clicking badge toggles sub-panel; lists referencing MPs', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: subPanelAssets, miniProjects: subPanelMps }),
    });
    flushSync();

    const badge = findButton(target, /2 uses/)!;
    badge.click();
    flushSync();
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    expect(target.textContent).toContain('MP A');
    expect(target.textContent).toContain('MP B');

    badge.click();
    flushSync();
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(target.querySelector('.sub-panel')).toBeNull();
  });

  it('Edit button in sub-panel calls onEditMiniProject(mp)', () => {
    const onEditMiniProject = vi.fn();
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: subPanelAssets,
        miniProjects: subPanelMps,
        onEditMiniProject,
      }),
    });
    flushSync();

    findButton(target, /2 uses/)!.click();
    flushSync();

    const editButtons = findAllButtons(target, /^Edit$/);
    expect(editButtons.length).toBe(2);
    editButtons[0]!.click();
    flushSync();
    expect(onEditMiniProject).toHaveBeenCalledTimes(1);
    expect(onEditMiniProject.mock.calls[0]![0]).toMatchObject({ id: 10 });
  });

  it('only one sub-panel open at a time (opening another closes the first)', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: [mkAsset(1, 'a.pdf'), mkAsset(2, 'b.pdf')],
        miniProjects: [
          mkMp(10, 'M1', '![](a.pdf)'),
          mkMp(11, 'M2', '![](b.pdf)'),
        ],
      }),
    });
    flushSync();

    const badges = findAllButtons(target, /1 use$/);
    expect(badges.length).toBe(2);
    badges[0]!.click();
    flushSync();
    expect(badges[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(badges[1]!.getAttribute('aria-expanded')).toBe('false');

    badges[1]!.click();
    flushSync();
    expect(badges[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(badges[1]!.getAttribute('aria-expanded')).toBe('true');
  });

  it('miniProjects === null → uses cell renders em-dash, no badge', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: subPanelAssets, miniProjects: null }),
    });
    flushSync();
    expect(findButton(target, /use/)).toBeNull();
    // The uses cell should contain an em-dash
    const cells = Array.from(target.querySelectorAll('tbody td'));
    const dashCells = cells.filter((c) => c.textContent?.trim() === '—');
    expect(dashCells.length).toBeGreaterThan(0);
  });
});

describe('RunAssetsTab — upload via file picker', () => {
  beforeEach(() => {
    (uploadRunAsset as any).mockReset();
  });

  it('renders [+ Upload] button paired with a hidden multi-file <input>', () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();
    const uploadBtn = findButton(target, /\+ Upload/);
    expect(uploadBtn).not.toBeNull();
    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(hiddenInput).not.toBeNull();
    expect(hiddenInput!.multiple).toBe(true);
  });

  it('clicking [+ Upload] forwards the click to the hidden input', () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();
    const uploadBtn = findButton(target, /\+ Upload/)!;
    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(hiddenInput, 'click').mockImplementation(() => {});
    uploadBtn.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('selecting a file calls uploadRunAsset and fires onRefetchAssets on success', async () => {
    (uploadRunAsset as any).mockResolvedValue(mkAsset(99, 'new.pdf'));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ onRefetchAssets } as any),
    });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'new.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(uploadRunAsset).toHaveBeenCalledTimes(1);
    const callArgs = (uploadRunAsset as any).mock.calls[0];
    expect(callArgs[0]).toBe(1);
    expect(callArgs[1]).toBe(file);
    expect(onRefetchAssets).toHaveBeenCalled();
  });

  it('upload 409 collision shows banner naming the duplicate file', async () => {
    (uploadRunAsset as any).mockRejectedValue(
      Object.assign(new Error('Conflict'), { status: 409 }),
    );
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'dup.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(target.textContent).toMatch(/asset named .*dup\.pdf.* already exists/i);
  });

  it('upload 500 backend error surfaces as banner (not unhandled rejection)', async () => {
    (uploadRunAsset as any).mockRejectedValue(
      Object.assign(new Error('Failed to write asset file'), { status: 500 }),
    );
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(target.textContent).toMatch(/Failed to write asset file/i);
  });

  it('upload 413 quota error shows dedicated storage-quota banner', async () => {
    (uploadRunAsset as any).mockRejectedValue(
      Object.assign(new Error('Quota exceeded'), { status: 413 }),
    );
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(target.textContent).toMatch(/big\.pdf.*exceed.*storage quota/i);
  });

  it('multi-file partial success then failure refetches so the persisted file appears', async () => {
    let callCount = 0;
    (uploadRunAsset as any).mockImplementation((_rid: number, file: File) => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mkAsset(99, file.name));
      return Promise.reject(
        Object.assign(new Error('Failed to write asset file'), { status: 500 }),
      );
    });
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    component = mount(RunAssetsTab, { target, props: { ...baseProps(), onRefetchAssets } });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['x'], 'good.pdf', { type: 'application/pdf' });
    const file2 = new File(['y'], 'bad.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file1, file2], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(uploadRunAsset).toHaveBeenCalledTimes(2);
    expect(onRefetchAssets).toHaveBeenCalled();
    expect(target.textContent).toMatch(/Failed to write asset file/i);
  });

  it('picking an oversize file blocks upload and shows inline error', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    // Avoid actually allocating a 20MB+ buffer; stub size after construction.
    const file = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 + 1 });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(target.textContent).toMatch(/file too large/i);
    expect(uploadRunAsset).not.toHaveBeenCalled();
  });

  it('picking a wrong-extension file blocks upload and shows inline error', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'evil.exe', { type: 'application/octet-stream' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(target.textContent).toMatch(/extension not allowed/i);
    expect(uploadRunAsset).not.toHaveBeenCalled();
  });

  it('renders aria-live upload progress and clears it after completion', async () => {
    let release!: (a: RunAssetResponse) => void;
    (uploadRunAsset as any).mockImplementation(
      () => new Promise<RunAssetResponse>((res) => { release = res; }),
    );
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'p.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    flushSync();

    const live = target.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live!.textContent ?? '').toMatch(/Uploading\s+0\s+of\s+1/i);

    release(mkAsset(99, 'p.pdf'));
    await settle();
    // Progress region should be gone once the batch finishes.
    expect(target.querySelector('[aria-live="polite"]')).toBeNull();
  });
});

describe('RunAssetsTab — upload via drop zone', () => {
  beforeEach(() => {
    (uploadRunAsset as any).mockReset();
  });

  it('drops a valid file → uploadRunAsset is called with the file', async () => {
    (uploadRunAsset as any).mockResolvedValue(mkAsset(99, 'dropped.pdf'));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ onRefetchAssets } as any),
    });
    flushSync();

    const dropZone = target.querySelector('.run-assets-tab') as HTMLElement;
    const file = new File(['data'], 'dropped.pdf', { type: 'application/pdf' });
    dropZone.dispatchEvent(makeDropEvent([file]));
    await settle();

    expect(uploadRunAsset).toHaveBeenCalledTimes(1);
    expect((uploadRunAsset as any).mock.calls[0][1]).toBe(file);
    expect(onRefetchAssets).toHaveBeenCalled();
  });

  it('drops an oversize file → inline "file too large" error, no upload', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const dropZone = target.querySelector('.run-assets-tab') as HTMLElement;
    const file = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 + 1 });
    dropZone.dispatchEvent(makeDropEvent([file]));
    await settle();

    expect(target.textContent).toMatch(/file too large/i);
    expect(uploadRunAsset).not.toHaveBeenCalled();
  });

  it('drops a wrong-extension file → inline "extension not allowed" error', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const dropZone = target.querySelector('.run-assets-tab') as HTMLElement;
    const file = new File(['x'], 'evil.exe', { type: 'application/octet-stream' });
    dropZone.dispatchEvent(makeDropEvent([file]));
    await settle();

    expect(target.textContent).toMatch(/extension not allowed/i);
    expect(uploadRunAsset).not.toHaveBeenCalled();
  });

  it('dragover toggles the drag-over class on the section; dragleave clears it', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const dropZone = target.querySelector('.run-assets-tab') as HTMLElement;
    expect(dropZone.classList.contains('drag-over')).toBe(false);

    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    dropZone.dispatchEvent(dragOver);
    flushSync();
    expect(dropZone.classList.contains('drag-over')).toBe(true);
    expect(dragOver.defaultPrevented).toBe(true);

    dropZone.dispatchEvent(new Event('dragleave', { bubbles: true }));
    flushSync();
    expect(dropZone.classList.contains('drag-over')).toBe(false);
  });

  it('stop-on-first-invalid pre-pass: invalid file in batch blocks all uploads', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const dropZone = target.querySelector('.run-assets-tab') as HTMLElement;
    const good = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const bad = new File(['y'], 'b.exe', { type: 'application/octet-stream' });
    dropZone.dispatchEvent(makeDropEvent([good, bad]));
    await settle();

    expect(target.textContent).toMatch(/extension not allowed/i);
    expect(uploadRunAsset).not.toHaveBeenCalled();
  });
});

describe('RunAssetsTab — upload lifecycle hardening', () => {
  beforeEach(() => {
    (uploadRunAsset as any).mockReset();
  });

  it('unmounting during an in-flight upload aborts the controller', async () => {
    let capturedSignal: AbortSignal | undefined;
    (uploadRunAsset as any).mockImplementation(
      (_id: number, _f: File, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise<RunAssetResponse>(() => {
          /* never resolves */
        });
      },
    );
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'p.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    flushSync();
    expect(capturedSignal?.aborted).toBe(false);

    unmount(component);
    component = null;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('drop is rejected when versionIsDisabled is true (no upload, no banner)', async () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ versionIsDisabled: true }),
    });
    flushSync();

    const dropZone = target.querySelector('.run-assets-tab') as HTMLElement;
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    dropZone.dispatchEvent(makeDropEvent([file]));
    await settle();

    expect(uploadRunAsset).not.toHaveBeenCalled();
  });

  it('picker resets input.value so the same file can be re-picked', async () => {
    (uploadRunAsset as any).mockResolvedValue(mkAsset(99, 'same.pdf'));
    component = mount(RunAssetsTab, { target, props: baseProps() });
    flushSync();

    const hiddenInput = target.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'same.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file], configurable: true });
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(hiddenInput.value).toBe('');
  });
});

describe('RunAssetsTab — replace flow', () => {
  beforeEach(() => {
    (replaceRunAsset as any).mockReset();
  });

  it('clicking [↻ Replace] then picking same-ext file shows InlineConfirm; Confirm calls replaceRunAsset', async () => {
    (replaceRunAsset as any).mockResolvedValue(mkAsset(1, 'doc.pdf'));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, onRefetchAssets } as any),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'whatever.pdf', { type: 'application/pdf' }));
    await settle();

    expect(target.textContent).toMatch(/Replace.*doc\.pdf/i);

    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(replaceRunAsset).toHaveBeenCalledTimes(1);
    const args = (replaceRunAsset as any).mock.calls[0];
    expect(args[0]).toBe(1);   // runId
    expect(args[1]).toBe(1);   // assetId
    expect((args[2] as File).name).toBe('whatever.pdf');
    expect(onRefetchAssets).toHaveBeenCalled();
  });

  it('extension mismatch → inline error, no InlineConfirm shown', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.png', { type: 'image/png' }));
    await settle();

    expect(findButton(target, /^Confirm$/)).toBeNull();
    expect(target.textContent).toMatch(/same extension/i);
    expect(replaceRunAsset).not.toHaveBeenCalled();
  });

  it('.PDF replaces .pdf (case-insensitive extension match)', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'NEW.PDF', { type: 'application/pdf' }));
    await settle();

    expect(findButton(target, /^Confirm$/)).not.toBeNull();
  });

  it('oversize file → inline error before InlineConfirm', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 });
    pickReplaceFile(big);
    await settle();

    expect(target.textContent).toMatch(/file too large/i);
    expect(findButton(target, /^Confirm$/)).toBeNull();
  });

  it('Cancel on InlineConfirm clears state without calling replaceRunAsset', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    expect(findButton(target, /^Confirm$/)).not.toBeNull();

    findButton(target, /^Cancel$/)!.click();
    flushSync();
    expect(findButton(target, /^Confirm$/)).toBeNull();
    expect(replaceRunAsset).not.toHaveBeenCalled();
  });

  it('PUT 404 mid-flight → "deleted by another user" banner + auto-refetch', async () => {
    (replaceRunAsset as any).mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 }),
    );
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, onRefetchAssets } as any),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(target.textContent).toMatch(/deleted by another user/i);
    expect(onRefetchAssets).toHaveBeenCalled();
  });

  it('PUT 422 → "same extension" banner', async () => {
    (replaceRunAsset as any).mockRejectedValue(
      Object.assign(new Error('mismatch'), { status: 422 }),
    );
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(target.textContent).toMatch(/same extension/i);
  });

  it('PUT 413 → "exceed.*quota" banner', async () => {
    (replaceRunAsset as any).mockRejectedValue(
      Object.assign(new Error('too large'), { status: 413 }),
    );
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(target.textContent).toMatch(/exceed.*quota/i);
  });

  it('versionIsDisabled blocks [↻ Replace] button (disabled attribute)', () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, versionIsDisabled: true }),
    });
    flushSync();
    const btn = findButton(target, /↻ Replace/)!;
    expect(btn.disabled).toBe(true);
  });

  it('in-flight replace + unmount → AbortController.abort fires', async () => {
    let capturedSignal: AbortSignal | undefined;
    (replaceRunAsset as any).mockImplementation(
      (_rid: number, _aid: number, _f: File, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {
          /* never resolves */
        });
      },
    );
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    findButton(target, /^Confirm$/)!.click();
    await Promise.resolve();
    flushSync();
    expect(capturedSignal?.aborted).toBe(false);

    unmount(component);
    component = null;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('runId prop change while tab stays mounted → AbortController.abort fires', async () => {
    let capturedSignal: AbortSignal | undefined;
    (replaceRunAsset as any).mockImplementation(
      (_rid: number, _aid: number, _f: File, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {
          /* never resolves */
        });
      },
    );
    const assets = [mkAsset(1, 'doc.pdf')];
    const box = $state({ ...baseProps({ assets }) });
    component = mount(RunAssetsTab, { target, props: box });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    findButton(target, /^Confirm$/)!.click();
    await Promise.resolve();
    flushSync();
    expect(capturedSignal?.aborted).toBe(false);

    box.runId = 999;
    flushSync();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('runId prop change clears the open InlineConfirm', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    const box = $state({ ...baseProps({ assets }) });
    component = mount(RunAssetsTab, { target, props: box });
    flushSync();

    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['NEW'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    expect(findButton(target, /^Confirm$/)).not.toBeNull();

    box.runId = 999;
    flushSync();
    expect(findButton(target, /^Confirm$/)).toBeNull();
  });

  it('runId prop change clears a stale banner', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    const box = $state({ ...baseProps({ assets }) });
    component = mount(RunAssetsTab, { target, props: box });
    flushSync();

    // Trigger upload validation failure → banner set, no openConfirm.
    const uploadInput = target.querySelector('input[type="file"]:not([data-role])') as HTMLInputElement;
    const bad = new File(['x'], 'evil.exe', { type: 'application/octet-stream' });
    Object.defineProperty(uploadInput, 'files', { value: [bad], configurable: true });
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.querySelector('.banner')).not.toBeNull();

    box.runId = 999;
    flushSync();
    expect(target.querySelector('.banner')).toBeNull();
  });

  it('single banner slot: a new replace error overwrites a prior upload error', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    // First, surface an upload-side error via the wrong-ext rejection path.
    const uploadInput = target.querySelector('input[type="file"]:not([data-role])') as HTMLInputElement;
    const bad = new File(['x'], 'evil.exe', { type: 'application/octet-stream' });
    Object.defineProperty(uploadInput, 'files', { value: [bad], configurable: true });
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toMatch(/extension not allowed/i);

    // Now trigger a replace-side ext-mismatch error.
    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['x'], 'wrong.png', { type: 'image/png' }));
    await settle();

    // Only ONE banner visible — the replace one.
    const banners = target.querySelectorAll('.banner');
    expect(banners.length).toBe(1);
    expect(banners[0]!.textContent).toMatch(/same extension/i);
    expect(banners[0]!.textContent).not.toMatch(/not allowed/i);
  });
});

describe('RunAssetsTab — delete (orphan)', () => {
  beforeEach(() => {
    (deleteRunAsset as any).mockReset();
  });

  function findDeleteBtn(filename: string): HTMLButtonElement {
    return target.querySelector(`button[aria-label="Delete ${filename}"]`) as HTMLButtonElement;
  }

  it('clicking [×] on orphan opens "Delete this asset?" confirm; Confirm calls deleteRunAsset', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, onRefetchAssets } as any),
    });
    flushSync();

    findDeleteBtn('orphan.pdf').click();
    flushSync();
    expect(target.textContent).toMatch(/Delete this asset\?/);

    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(deleteRunAsset).toHaveBeenCalledTimes(1);
    const args = (deleteRunAsset as any).mock.calls[0];
    expect(args[0]).toBe(1);
    expect(args[1]).toBe(1);
    expect(args[2]).toMatchObject({ force: false });
    expect(onRefetchAssets).toHaveBeenCalled();
  });

  it('Cancel closes the InlineConfirm without calling deleteRunAsset', async () => {
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findDeleteBtn('orphan.pdf').click();
    flushSync();
    expect(findButton(target, /^Confirm$/)).not.toBeNull();

    findButton(target, /^Cancel$/)!.click();
    flushSync();
    expect(findButton(target, /^Confirm$/)).toBeNull();
    expect(deleteRunAsset).not.toHaveBeenCalled();
  });

  it('versionIsDisabled disables the [×] button', () => {
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, versionIsDisabled: true }),
    });
    flushSync();
    expect(findDeleteBtn('orphan.pdf').disabled).toBe(true);
  });
});

describe('RunAssetsTab — delete (referenced, force-confirm)', () => {
  beforeEach(() => {
    (deleteRunAsset as any).mockReset();
  });

  const refAssets = [{ ...mkAsset(1, 'ref.pdf'), is_referenced: true }];
  const refMps = [mkMp(10, 'M', '![](ref.pdf)')];

  function findDeleteBtn(filename: string): HTMLButtonElement {
    return target.querySelector(`button[aria-label="Delete ${filename}"]`) as HTMLButtonElement;
  }

  it('opens force-confirm view with checkbox + danger button (disabled until checked)', async () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: refAssets, miniProjects: refMps }),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    expect(target.textContent).toMatch(/referenced by 1 mini-project/i);
    const danger = findButton(target, /Force delete/i)!;
    expect(danger.disabled).toBe(true);

    const checkbox = target.querySelector('input[type="checkbox"][data-role="force-confirm"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(document.activeElement).toBe(checkbox);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(danger.disabled).toBe(false);
  });

  it('Force delete fires DELETE with force=true + both refetches', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: refAssets,
        miniProjects: refMps,
        onRefetchAssets,
        onRefetchMiniProjects,
      } as any),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    const checkbox = target.querySelector('input[type="checkbox"][data-role="force-confirm"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    findButton(target, /Force delete/i)!.click();
    await settle();

    expect(deleteRunAsset).toHaveBeenCalledTimes(1);
    const args = (deleteRunAsset as any).mock.calls[0];
    expect(args[2]).toMatchObject({ force: true });
    expect(onRefetchAssets).toHaveBeenCalled();
    expect(onRefetchMiniProjects).toHaveBeenCalled();
  });

  it('!course.is_admin → Force delete stays disabled with tooltip even after checkbox', async () => {
    const nonAdminCourse: Course = { ...baseCourse, is_admin: false };
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: refAssets,
        miniProjects: refMps,
        course: nonAdminCourse,
      }),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    const checkbox = target.querySelector('input[type="checkbox"][data-role="force-confirm"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    const danger = findButton(target, /Force delete/i)!;
    expect(danger.disabled).toBe(true);
    expect(danger.getAttribute('title') ?? '').toMatch(/course admins/i);
  });

  it('403 stale-permission → banner + onReloadRun called once', async () => {
    (deleteRunAsset as any).mockRejectedValue(
      Object.assign(new Error('forbidden'), { status: 403 }),
    );
    const onReloadRun = vi.fn().mockResolvedValue(undefined);
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: refAssets,
        miniProjects: refMps,
        onReloadRun,
      } as any),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    const checkbox = target.querySelector('input[type="checkbox"][data-role="force-confirm"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    findButton(target, /Force delete/i)!.click();
    await settle();

    expect(target.textContent).toMatch(/no longer have permission to force-delete/i);
    expect(onReloadRun).toHaveBeenCalledTimes(1);
  });

  it('404 cross-user → banner + auto-refetch (after 500ms storm window)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      (deleteRunAsset as any).mockRejectedValue(
        Object.assign(new Error('not found'), { status: 404 }),
      );
      const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
      component = mount(RunAssetsTab, {
        target,
        props: baseProps({
          assets: refAssets,
          miniProjects: refMps,
          onRefetchAssets,
        } as any),
      });
      flushSync();

      findDeleteBtn('ref.pdf').click();
      flushSync();
      const checkbox = target.querySelector('input[type="checkbox"][data-role="force-confirm"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      flushSync();
      findButton(target, /Force delete/i)!.click();
      // Let microtasks settle (rejection propagates + note404 schedules timer).
      for (let i = 0; i < 12; i++) await Promise.resolve();
      flushSync();

      // Window not yet elapsed; no banner.
      expect(target.textContent).not.toMatch(/deleted by another user/i);

      await vi.advanceTimersByTimeAsync(500);
      flushSync();

      expect(target.textContent).toMatch(/this asset was deleted by another user/i);
      expect(onRefetchAssets).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('warning aria-describedby points at the warning paragraph id', async () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: refAssets, miniProjects: refMps }),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    const danger = findButton(target, /Force delete/i)!;
    const describedBy = danger.getAttribute('aria-describedby');
    expect(describedBy).toBe('warn-1');
    const warningPara = target.querySelector('#warn-1');
    expect(warningPara).not.toBeNull();
    expect(warningPara!.textContent).toMatch(/referenced by/i);
  });

  it('orphan success does NOT call onRefetchMiniProjects', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, onRefetchAssets, onRefetchMiniProjects } as any),
    });
    flushSync();

    findDeleteBtn('orphan.pdf').click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(onRefetchAssets).toHaveBeenCalled();
    expect(onRefetchMiniProjects).not.toHaveBeenCalled();
  });

  it('generic 500 error → banner shows error message', async () => {
    (deleteRunAsset as any).mockRejectedValue(
      Object.assign(new Error('Server boom'), { status: 500 }),
    );
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findDeleteBtn('orphan.pdf').click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(target.textContent).toMatch(/Server boom|Delete failed/i);
  });

  it('double-click on Confirm fires deleteRunAsset only once', async () => {
    (deleteRunAsset as any).mockImplementation(
      () => new Promise(() => { /* hangs forever */ }),
    );
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findDeleteBtn('orphan.pdf').click();
    flushSync();
    const confirm = findButton(target, /^Confirm$/)!;
    confirm.click();
    confirm.click();
    await Promise.resolve();
    flushSync();

    expect(deleteRunAsset).toHaveBeenCalledTimes(1);
  });

  it('miniProjects==null + a.is_referenced=true shows generic "other mini-projects" copy', async () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: refAssets, miniProjects: null }),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    expect(target.textContent).toMatch(/referenced by other mini-projects/i);
    expect(target.textContent).not.toMatch(/referenced by 0 mini-projects/i);
  });

  it('slow successful delete does not clobber a newer banner set mid-flight', async () => {
    let resolveDelete!: () => void;
    (deleteRunAsset as any).mockImplementation(
      () => new Promise<void>((res) => { resolveDelete = res; }),
    );
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    findDeleteBtn('orphan.pdf').click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await Promise.resolve();
    flushSync();

    // Delete is in-flight. Trigger an upload validation banner now.
    const uploadInput = target.querySelector('input[type="file"]:not([data-role])') as HTMLInputElement;
    const bad = new File(['x'], 'evil.exe', { type: 'application/octet-stream' });
    Object.defineProperty(uploadInput, 'files', { value: [bad], configurable: true });
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toMatch(/extension not allowed/i);

    // Now resolve the in-flight delete. The success path must NOT clear the
    // newer upload banner.
    resolveDelete();
    await settle();
    expect(target.textContent).toMatch(/extension not allowed/i);
  });

  it('mutual exclusion: opening delete closes an open replace InlineConfirm', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets }),
    });
    flushSync();

    // Open replace confirm
    findButton(target, /↻ Replace/)!.click();
    flushSync();
    pickReplaceFile(new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    expect(target.textContent).toMatch(/Replace.*doc\.pdf/);

    // Click [×] → openConfirm flips to delete; replace InlineConfirm gone
    findDeleteBtn('doc.pdf').click();
    flushSync();
    expect(target.textContent).not.toMatch(/Replace.*doc\.pdf/);
    expect(target.textContent).toMatch(/Delete this asset\?/);
  });
});

describe('RunAssetsTab — bulk selection + action strip', () => {
  beforeEach(() => {
    (deleteRunAsset as any).mockReset();
  });

  const mixedAssets = [
    { ...mkAsset(1, 'a.pdf'), is_referenced: false },
    { ...mkAsset(2, 'b.pdf'), is_referenced: false },
    { ...mkAsset(3, 'c.pdf'), is_referenced: true },
  ];
  const mixedMps = [mkMp(10, 'M', '![](c.pdf)')];

  function selectAllCheckbox(): HTMLInputElement {
    return target.querySelector('input[type="checkbox"][aria-label="Select all"]') as HTMLInputElement;
  }

  function rowCheckbox(filename: string): HTMLInputElement {
    return target.querySelector(`input[type="checkbox"][aria-label="Select ${filename}"]`) as HTMLInputElement;
  }

  it('header checkbox selects all visible rows and shows the action strip', async () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: mixedAssets, miniProjects: mixedMps }),
    });
    flushSync();

    expect(target.textContent).not.toMatch(/3 selected/);
    selectAllCheckbox().click();
    flushSync();

    expect(target.textContent).toMatch(/3 selected/);
    expect(findButton(target, /Delete 3 selected/i)).not.toBeNull();
  });

  it('row checkbox toggles individual selection', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: mixedAssets, miniProjects: mixedMps }),
    });
    flushSync();

    rowCheckbox('a.pdf').click();
    flushSync();
    expect(target.textContent).toMatch(/1 selected/);

    rowCheckbox('b.pdf').click();
    flushSync();
    expect(target.textContent).toMatch(/2 selected/);

    rowCheckbox('a.pdf').click();
    flushSync();
    expect(target.textContent).toMatch(/1 selected/);
  });

  it('clicking header again when all selected deselects everything', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: mixedAssets, miniProjects: mixedMps }),
    });
    flushSync();
    selectAllCheckbox().click();
    flushSync();
    expect(target.textContent).toMatch(/3 selected/);

    selectAllCheckbox().click();
    flushSync();
    expect(target.textContent).not.toMatch(/selected/);
  });

  it('filter change clears the selection', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: mixedAssets, miniProjects: mixedMps }),
    });
    flushSync();
    selectAllCheckbox().click();
    flushSync();
    expect(target.textContent).toMatch(/3 selected/);

    findButton(target, /^Orphan/)!.click();
    flushSync();
    expect(target.textContent).not.toMatch(/selected/);
  });

  it('versionIsDisabled disables both the header checkbox and per-row checkboxes', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: mixedAssets, miniProjects: mixedMps, versionIsDisabled: true }),
    });
    flushSync();
    expect(selectAllCheckbox().disabled).toBe(true);
    expect(rowCheckbox('a.pdf').disabled).toBe(true);
  });
});

describe('RunAssetsTab — bulk delete execution', () => {
  beforeEach(() => {
    (deleteRunAsset as any).mockReset();
  });

  const mixedAssets = [
    { ...mkAsset(1, 'a.pdf'), is_referenced: false },
    { ...mkAsset(2, 'b.pdf'), is_referenced: false },
    { ...mkAsset(3, 'c.pdf'), is_referenced: true },
  ];
  const mixedMps = [mkMp(10, 'M', '![](c.pdf)')];

  function selectAllCheckbox(): HTMLInputElement {
    return target.querySelector('input[type="checkbox"][aria-label="Select all"]') as HTMLInputElement;
  }

  it('mixed batch: orphans send force=false, referenced send force=true; both refetches fire', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: mixedAssets,
        miniProjects: mixedMps,
        onRefetchAssets,
        onRefetchMiniProjects,
      } as any),
    });
    flushSync();

    selectAllCheckbox().click();
    flushSync();
    findButton(target, /Delete 3 selected/i)!.click();
    flushSync();
    // Referenced count > 0 → checkbox + Force delete
    const checkbox = target.querySelector('input[type="checkbox"][data-role="bulk-confirm"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    findButton(target, /Force delete/i)!.click();
    await settle();

    expect(deleteRunAsset).toHaveBeenCalledTimes(3);
    const callsByAid = new Map<number, any>();
    for (const call of (deleteRunAsset as any).mock.calls) {
      callsByAid.set(call[1], call[2]);
    }
    expect(callsByAid.get(1)?.force).toBe(false);
    expect(callsByAid.get(2)?.force).toBe(false);
    expect(callsByAid.get(3)?.force).toBe(true);
    expect(onRefetchAssets).toHaveBeenCalled();
    expect(onRefetchMiniProjects).toHaveBeenCalled();
    expect(target.textContent).toMatch(/Deleted 3 of 3/);
  });

  it('all-orphan batch shows plain Confirm (no checkbox / no Force button)', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    const orphans = [
      { ...mkAsset(1, 'a.pdf'), is_referenced: false },
      { ...mkAsset(2, 'b.pdf'), is_referenced: false },
    ];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: orphans,
        onRefetchAssets,
        onRefetchMiniProjects,
      } as any),
    });
    flushSync();

    selectAllCheckbox().click();
    flushSync();
    findButton(target, /Delete 2 selected/i)!.click();
    flushSync();
    // No checkbox needed in this branch
    expect(target.querySelector('input[type="checkbox"][data-role="bulk-confirm"]')).toBeNull();
    expect(findButton(target, /Force delete/i)).toBeNull();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(deleteRunAsset).toHaveBeenCalledTimes(2);
    expect((deleteRunAsset as any).mock.calls[0][2]).toMatchObject({ force: false });
    expect(onRefetchAssets).toHaveBeenCalled();
    expect(onRefetchMiniProjects).not.toHaveBeenCalled();
  });

  it('switching filter pill clears the error banner', async () => {
    (deleteRunAsset as any).mockRejectedValue(
      Object.assign(new Error('Delete failed: backend on fire'), { status: 500 }),
    );
    const orphans = [{ ...mkAsset(1, 'a.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: orphans } as any),
    });
    flushSync();

    // Single-row delete triggers banner via the 500 fallback.
    const deleteBtn = target.querySelector('button.row-action-delete') as HTMLButtonElement
      ?? findButton(target, /^×$/);
    deleteBtn!.click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(target.textContent).toMatch(/Delete failed: backend on fire/);

    findButton(target, /Orphan/)!.click();
    await settle();

    expect(target.textContent).not.toMatch(/Delete failed: backend on fire/);
  });

  it('error banner auto-dismisses after 30s', async () => {
    vi.useFakeTimers();
    try {
      (deleteRunAsset as any).mockRejectedValue(
        Object.assign(new Error('Delete failed: backend on fire'), { status: 500 }),
      );
      const orphans = [{ ...mkAsset(1, 'a.pdf'), is_referenced: false }];
      component = mount(RunAssetsTab, {
        target,
        props: baseProps({ assets: orphans } as any),
      });
      flushSync();

      const deleteBtn = target.querySelector('button.row-action-delete') as HTMLButtonElement
        ?? findButton(target, /^×$/);
      deleteBtn!.click();
      flushSync();
      findButton(target, /^Confirm$/)!.click();
      // Drain microtasks without real-time advance.
      for (let i = 0; i < 12; i++) await Promise.resolve();
      flushSync();

      expect(target.textContent).toMatch(/Delete failed: backend on fire/);

      vi.advanceTimersByTime(30_000);
      flushSync();

      expect(target.textContent).not.toMatch(/Delete failed: backend on fire/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('switching filter pill clears the bulk-delete summary banner', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    const orphans = [
      { ...mkAsset(1, 'a.pdf'), is_referenced: false },
      { ...mkAsset(2, 'b.pdf'), is_referenced: false },
    ];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: orphans,
        onRefetchAssets,
        onRefetchMiniProjects,
      } as any),
    });
    flushSync();

    selectAllCheckbox().click();
    flushSync();
    findButton(target, /Delete 2 selected/i)!.click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(target.textContent).toMatch(/Deleted 2 of 2/);

    findButton(target, /Orphan/)!.click();
    await settle();

    expect(target.textContent).not.toMatch(/Deleted 2 of 2/);
  });

  it('force flag is derived from backend is_referenced (not client scan)', async () => {
    // Backend flags it referenced, but no MPs reference the file in their assignment_md
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const staleAssets = [{ ...mkAsset(1, 'stale.pdf'), is_referenced: true }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: staleAssets, miniProjects: [] }),
    });
    flushSync();

    selectAllCheckbox().click();
    flushSync();
    findButton(target, /Delete 1 selected/i)!.click();
    flushSync();
    const checkbox = target.querySelector('input[type="checkbox"][data-role="bulk-confirm"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    findButton(target, /Force delete/i)!.click();
    await settle();

    expect((deleteRunAsset as any).mock.calls[0][2]).toMatchObject({ force: true });
  });

  it('partial failure → summary banner lists failed filenames', async () => {
    (deleteRunAsset as any).mockImplementation((_rid: number, aid: number) => {
      if (aid === 2) return Promise.reject(new Error('server boom'));
      return Promise.resolve(undefined);
    });
    const orphans = [
      { ...mkAsset(1, 'ok-1.pdf'), is_referenced: false },
      { ...mkAsset(2, 'fail.pdf'), is_referenced: false },
      { ...mkAsset(3, 'ok-3.pdf'), is_referenced: false },
    ];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: orphans }),
    });
    flushSync();

    selectAllCheckbox().click();
    flushSync();
    findButton(target, /Delete 3 selected/i)!.click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await settle();

    expect(target.textContent).toMatch(/Deleted 2 of 3/);
    expect(target.textContent).toMatch(/fail\.pdf/);
  });

  it('Cancel on the bulk-confirm closes the confirm without firing DELETE', async () => {
    const orphans = [{ ...mkAsset(1, 'a.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: orphans }),
    });
    flushSync();

    selectAllCheckbox().click();
    flushSync();
    findButton(target, /Delete 1 selected/i)!.click();
    flushSync();
    expect(findButton(target, /^Confirm$/)).not.toBeNull();
    findButton(target, /^Cancel$/)!.click();
    flushSync();

    expect(findButton(target, /^Confirm$/)).toBeNull();
    expect(deleteRunAsset).not.toHaveBeenCalled();
  });

  it('bulk delete with !course.is_admin keeps Force button disabled with tooltip', async () => {
    const nonAdminCourse: Course = { ...baseCourse, is_admin: false };
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({
        assets: mixedAssets,
        miniProjects: mixedMps,
        course: nonAdminCourse,
      }),
    });
    flushSync();

    selectAllCheckbox().click();
    flushSync();
    findButton(target, /Delete 3 selected/i)!.click();
    flushSync();
    const checkbox = target.querySelector('input[type="checkbox"][data-role="bulk-confirm"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    const danger = findButton(target, /Force delete/i)!;
    expect(danger.disabled).toBe(true);
    expect(danger.getAttribute('title') ?? '').toMatch(/course admins/i);
  });
});

describe('RunAssetsTab — 404 storm coalescing', () => {
  beforeEach(() => {
    (deleteRunAsset as any).mockReset();
  });

  function selectAllCheckbox(): HTMLInputElement {
    return target.querySelector('input[type="checkbox"][aria-label="Select all"]') as HTMLInputElement;
  }

  it('multiple 404s within 500ms → single banner + single refetch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      (deleteRunAsset as any).mockRejectedValue(
        Object.assign(new Error('not found'), { status: 404 }),
      );
      const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
      const assets = [
        { ...mkAsset(1, 'a.pdf'), is_referenced: false },
        { ...mkAsset(2, 'b.pdf'), is_referenced: false },
      ];
      component = mount(RunAssetsTab, {
        target,
        props: baseProps({ assets, onRefetchAssets } as any),
      });
      flushSync();

      // Bulk-delete both → both fail with 404, coalesced into one window
      selectAllCheckbox().click();
      flushSync();
      findButton(target, /Delete 2 selected/i)!.click();
      flushSync();
      findButton(target, /^Confirm$/)!.click();
      // Microtask drain so both rejections + note404 schedule the timer.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      flushSync();

      // Window not elapsed; no banner.
      expect(target.textContent).not.toMatch(/by another user/i);

      await vi.advanceTimersByTimeAsync(500);
      flushSync();

      expect(target.textContent).toMatch(/some assets were deleted by another user/i);
      // Spec L213: exactly one onRefetchAssets per storm window. The bulk
      // path must NOT also call refetch on completion when 404s scheduled
      // the storm timer.
      expect(onRefetchAssets).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('storm timer is cleared on unmount — no refetch fires after teardown', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      (deleteRunAsset as any).mockRejectedValue(
        Object.assign(new Error('not found'), { status: 404 }),
      );
      const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
      const assets = [{ ...mkAsset(1, 'a.pdf'), is_referenced: false }];
      component = mount(RunAssetsTab, {
        target,
        props: baseProps({ assets, onRefetchAssets } as any),
      });
      flushSync();

      // Trigger a single 404 via single-row delete (not bulk, so bulk's own
      // post-refetch can't muddy the assertion).
      const deleteBtn = target.querySelector(`button[aria-label="Delete a.pdf"]`) as HTMLButtonElement;
      deleteBtn.click();
      flushSync();
      findButton(target, /^Confirm$/)!.click();
      for (let i = 0; i < 12; i++) await Promise.resolve();
      flushSync();

      const callsBeforeUnmount = onRefetchAssets.mock.calls.length;

      // Unmount before the 500ms storm timer fires
      unmount(component);
      component = null;
      await vi.advanceTimersByTimeAsync(500);

      // Cleared timer means no new refetch + no banner write.
      expect(onRefetchAssets.mock.calls.length).toBe(callsBeforeUnmount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('storm coalesces a single-row 404 + a bulk 404 into one banner + one refetch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      (deleteRunAsset as any).mockRejectedValue(
        Object.assign(new Error('not found'), { status: 404 }),
      );
      const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
      const assets = [
        { ...mkAsset(1, 'one.pdf'), is_referenced: false },
        { ...mkAsset(2, 'two.pdf'), is_referenced: false },
        { ...mkAsset(3, 'three.pdf'), is_referenced: false },
      ];
      component = mount(RunAssetsTab, {
        target,
        props: baseProps({ assets, onRefetchAssets } as any),
      });
      flushSync();

      // Single-row delete fires first 404 → schedules storm timer.
      const deleteBtn = target.querySelector(
        `button[aria-label="Delete one.pdf"]`,
      ) as HTMLButtonElement;
      deleteBtn.click();
      flushSync();
      findButton(target, /^Confirm$/)!.click();
      for (let i = 0; i < 12; i++) await Promise.resolve();
      flushSync();

      // Within the 500ms window: bulk-delete the other two → 2 more 404s,
      // each note404()'d, sharing the same timer.
      target.querySelector<HTMLInputElement>(
        'input[type="checkbox"][aria-label="Select two.pdf"]',
      )!.click();
      flushSync();
      target.querySelector<HTMLInputElement>(
        'input[type="checkbox"][aria-label="Select three.pdf"]',
      )!.click();
      flushSync();
      findButton(target, /Delete 2 selected/i)!.click();
      flushSync();
      findButton(target, /^Confirm$/)!.click();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      flushSync();

      // Still pre-window: no banner, no refetch.
      expect(target.textContent).not.toMatch(/by another user/i);
      expect(onRefetchAssets).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      flushSync();

      // Single banner across both sources; single refetch across both.
      expect(target.querySelectorAll('.banner-error')).toHaveLength(1);
      expect(target.textContent).toMatch(/some assets were deleted by another user/i);
      expect(onRefetchAssets).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RunAssetsTab — versionIsDisabled tooltips', () => {
  const DISABLED_TOOLTIP = "This run's course version is disabled.";

  it('disables [+ Upload], [↻ Replace], and [×] with the version-disabled tooltip', () => {
    const assets = [{ ...mkAsset(1, 'doc.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, versionIsDisabled: true }),
    });
    flushSync();

    const upload = findButton(target, /\+ Upload/)!;
    expect(upload).not.toBeNull();
    expect(upload.disabled).toBe(true);
    expect(upload.title).toBe(DISABLED_TOOLTIP);

    const replace = findButton(target, /↻ Replace/)!;
    expect(replace).not.toBeNull();
    expect(replace.disabled).toBe(true);
    expect(replace.title).toBe(DISABLED_TOOLTIP);

    const del = target.querySelector(
      'button[aria-label="Delete doc.pdf"]',
    ) as HTMLButtonElement;
    expect(del).not.toBeNull();
    expect(del.disabled).toBe(true);
    expect(del.title).toBe(DISABLED_TOOLTIP);
  });

  it('bulk-strip [Delete N selected] reports disabled + tooltip when parent flips versionIsDisabled mid-selection', () => {
    const assets = [
      { ...mkAsset(1, 'a.pdf'), is_referenced: false },
      { ...mkAsset(2, 'b.pdf'), is_referenced: false },
    ];
    const box = $state({
      ...baseProps({ assets, versionIsDisabled: false }),
    });
    component = mount(RunAssetsTab, { target, props: box });
    flushSync();

    (target.querySelector(
      'input[type="checkbox"][aria-label="Select all"]',
    ) as HTMLInputElement).click();
    flushSync();
    const stripBtn = findButton(target, /Delete 2 selected/i)!;
    expect(stripBtn).not.toBeNull();
    expect(stripBtn.disabled).toBe(false);

    box.versionIsDisabled = true;
    flushSync();

    const stripBtnAfter = findButton(target, /Delete 2 selected/i)!;
    expect(stripBtnAfter).not.toBeNull();
    expect(stripBtnAfter.disabled).toBe(true);
    expect(stripBtnAfter.title).toBe(DISABLED_TOOLTIP);
  });
});

describe('RunAssetsTab — referenced-asset force-delete role gating (T11 regression)', () => {
  beforeEach(() => {
    (deleteRunAsset as any).mockReset();
    (uploadRunAsset as any).mockReset();
    (replaceRunAsset as any).mockReset();
  });

  function findDeleteBtn(filename: string): HTMLButtonElement {
    return target.querySelector(`button[aria-label="Delete ${filename}"]`) as HTMLButtonElement;
  }

  const refAssets = [{ ...mkAsset(1, 'ref.pdf'), is_referenced: true }];
  const refMps = [mkMp(10, 'M', '![](ref.pdf)')];

  it('teacher: Force delete button visible but disabled with tooltip (even after acknowledge)', async () => {
    const teacherCourse: Course = { ...baseCourse, is_admin: false };
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: refAssets, miniProjects: refMps, course: teacherCourse }),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    const danger = findButton(target, /Force delete/i)!;
    expect(danger).toBeTruthy();
    expect(danger.disabled).toBe(true);
    expect(danger.getAttribute('title') ?? '').toBe(
      'Only course admins can force-delete a referenced asset.',
    );
    // Acknowledging does NOT enable the button for teachers.
    const checkbox = target.querySelector(
      'input[type="checkbox"][data-role="force-confirm"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(danger.disabled).toBe(true);
    expect(danger.getAttribute('title') ?? '').toBe(
      'Only course admins can force-delete a referenced asset.',
    );
  });

  it('admin: Force delete visible, enabled after acknowledge, empty tooltip', async () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: refAssets, miniProjects: refMps }),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    const danger = findButton(target, /Force delete/i)!;
    expect(danger).toBeTruthy();
    expect(danger.disabled).toBe(true);  // gated by checkbox initially
    const checkbox = target.querySelector(
      'input[type="checkbox"][data-role="force-confirm"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(danger.disabled).toBe(false);
    expect(danger.getAttribute('title') ?? '').toBe('');
  });

  it('teacher: unreferenced asset delete is enabled (teacher-allowed orphan delete)', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const teacherCourse: Course = { ...baseCourse, is_admin: false };
    const orphans = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: orphans, course: teacherCourse }),
    });
    flushSync();
    const del = findDeleteBtn('orphan.pdf');
    expect(del).toBeTruthy();
    expect(del.disabled).toBe(false);

    del.click();
    flushSync();
    expect(target.textContent).toMatch(/Delete this asset\?/);
    findButton(target, /^Confirm$/)!.click();
    await settle();
    expect(deleteRunAsset).toHaveBeenCalledTimes(1);
    expect((deleteRunAsset as any).mock.calls[0][2]).toMatchObject({ force: false });
  });

  it('smoke: upload + list + replace UI render identically regardless of course.is_admin', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    const adminCourse: Course = { ...baseCourse, is_admin: true };
    const teacherCourse: Course = { ...baseCourse, is_admin: false };

    // Render once with admin
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets, course: adminCourse }),
    });
    flushSync();
    expect(findButton(target, /\+ Upload/)).not.toBeNull();
    expect(findButton(target, /↻ Replace/)).not.toBeNull();
    const adminLink = target.querySelector('a')!.textContent?.trim();
    expect(adminLink).toBe('doc.pdf');
    unmount(component);
    component = null;

    // Render again with teacher — same upload/list/replace UI.
    const target2 = document.createElement('div');
    document.body.appendChild(target2);
    try {
      const cmp2 = mount(RunAssetsTab, {
        target: target2,
        props: baseProps({ assets, course: teacherCourse }),
      });
      flushSync();
      const uploadBtn = Array.from(target2.querySelectorAll('button')).find((b) =>
        /\+ Upload/.test(b.textContent ?? ''),
      );
      const replaceBtn = Array.from(target2.querySelectorAll('button')).find((b) =>
        /↻ Replace/.test(b.textContent ?? ''),
      );
      expect(uploadBtn).toBeDefined();
      expect(replaceBtn).toBeDefined();
      const teacherLink = target2.querySelector('a')!.textContent?.trim();
      expect(teacherLink).toBe('doc.pdf');
      unmount(cmp2);
    } finally {
      document.body.removeChild(target2);
    }
  });
});
