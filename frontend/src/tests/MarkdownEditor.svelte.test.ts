import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MarkdownEditor from '../components/editor/MarkdownEditor.svelte';
import * as assetsModule from '../lib/assets';
import type { AssetResponse } from '../lib/assets';

const mkAsset = (overrides: Partial<AssetResponse> = {}): AssetResponse => ({
  id: 1,
  version_id: 42,
  filename: 'histogram.png',
  file_size: 1024,
  mime_type: 'image/png',
  uploaded_at: '2026-05-17T12:00:00Z',
  uploaded_by: 3,
  is_referenced: false,
  ...overrides,
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountEditor(overrides: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const propsRef: any = $state({
    versionId: 42,
    value: '',
    readOnly: false,
    ...overrides,
  });
  const cmp = mount(MarkdownEditor, { target, props: propsRef });
  cleanup = () => unmount(cmp);
  return { cmp, target, propsRef };
}

describe('MarkdownEditor — sidebar mount', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('mounts AssetSidebar in Edit mode and unmounts it in Preview mode', async () => {
    const { target } = mountEditor();
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeTruthy();
    const previewBtn = Array.from(target.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent === 'Preview',
    )!;
    previewBtn.click();
    flushSync();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeNull();
  });

  it('does NOT mount AssetSidebar in readOnly mode', async () => {
    const { target } = mountEditor({ readOnly: true });
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeNull();
  });
});

describe('MarkdownEditor — click insert at cursor', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', mime_type: 'image/png' }),
    ]);
  });

  it('clicking a sidebar row inserts the markdown reference at end-of-content when textarea not focused', async () => {
    const { target, propsRef } = mountEditor({ value: 'hello' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
    flushSync();
    expect(propsRef.value).toBe('hello\n![a](a.png)\n');
  });

  it('clicking a sidebar row inserts at the textarea cursor position when textarea has been focused', async () => {
    const { target, propsRef } = mountEditor({ value: 'hello world' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.focus();
    ta.setSelectionRange(5, 5);
    ta.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    ta.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
    flushSync();
    expect(propsRef.value).toBe('hello\n![a](a.png)\n world');
  });
});

describe('MarkdownEditor — cursorReady', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([
      mkAsset({ id: 1, filename: 'a.png', mime_type: 'image/png' }),
    ]);
  });

  it('cursorReady flips to true on textarea first focus and the banner disappears', async () => {
    const { target } = mountEditor();
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeTruthy();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.focus();
    ta.dispatchEvent(new Event('focus', { bubbles: true }));
    flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeNull();
  });

  it('cursorReady flips to true on first onInsert call even before textarea focus', async () => {
    const { target } = mountEditor({ value: 'hello' });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeTruthy();
    const row = target.querySelector<HTMLElement>('[data-testid="asset-row-1"]')!;
    const clickBtn = row.querySelector<HTMLElement>('.row-click')!;
    clickBtn.click();
    flushSync();
    expect(target.querySelector('[data-testid="cursor-banner"]')).toBeNull();
  });
});

describe('MarkdownEditor — value prop bind:value', () => {
  beforeEach(() => {
    vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
  });

  it('typing in the textarea updates parent value', async () => {
    const { target, propsRef } = mountEditor({ value: 'start' });
    await Promise.resolve(); flushSync();
    const ta = target.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'changed';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(propsRef.value).toBe('changed');
  });
});
