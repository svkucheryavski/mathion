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
