import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// The tracker is mocked at the module boundary so the lifecycle can be asserted
// directly. T5 only edits VideoItem's MARKUP (the `✓` glyph becomes an inline
// SVG) and its CSS, but the glyph sits inside the `{:else}` arm of the same
// `{#if !isCovered}` the tracker's button lives in — so an edit there can
// plausibly disturb the wiring. These spies are what make "untouched" checkable
// rather than asserted (spec §2 VideoItem: "Coverage tracker … untouched").
const start = vi.fn();
const stop = vi.fn(() => Promise.resolve());
const markCovered = vi.fn(() => Promise.resolve());
vi.mock('../lib/coverage.svelte', () => ({
  createCoverageTracker: vi.fn(() => ({ start, stop, markCovered })),
}));

import VideoItem from '../components/items/VideoItem.svelte';
import { createCoverageTracker } from '../lib/coverage.svelte';
import type { VideoItem as VItem } from '../lib/types';

const vidItem = (over: Partial<VItem> = {}): VItem => ({
  id: 9, sequence_id: 2, title: 'Determinants', slug: 'det', order: 1,
  type: 'video', video_url: 'https://example.org/embed/x', ...over,
});

let cleanup: (() => void) | null = null;
function render(props: { item?: VItem; isCovered: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const p = $state({ item: props.item ?? vidItem(), isCovered: props.isCovered });
  const cmp = mount(VideoItem, { target, props: p });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}

beforeEach(() => {
  start.mockClear(); stop.mockClear(); markCovered.mockClear();
  vi.mocked(createCoverageTracker).mockClear();
});
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('renders the watched confirmation as an inline SVG + text, with no ✓ glyph', () => {
  const target = render({ isCovered: true });
  const watched = target.querySelector('.watched');
  expect(watched).not.toBeNull();

  // The mark is a real inline SVG, hidden from AT (the adjacent text carries
  // the meaning) — the same treatment T2 gave the quiz reveal marks.
  const svg = watched!.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(svg!.getAttribute('aria-hidden')).toBe('true');

  // Scoped to THIS node, deliberately: StatusPill retains a `✓` elsewhere in
  // the app and a blanket document-wide assertion would forbid it.
  expect(watched!.textContent).not.toContain('✓');
  expect(watched!.textContent).toContain('Marked as watched');
});

it('passes item.video_url straight through to the iframe', () => {
  // The gate's markup scanner pins attribute NAMES and the values of the SVG
  // presentation attributes, but deliberately NOT the value of a non-visual
  // prop: `src="about:blank"` blanked every video with the gate at ALL PASS
  // (235) and all 1349 tests green, because nothing asserted the URL reached
  // the frame (codex, Slice-3 close-out round 3, reproduced). Content is this
  // lane's job, which is why the assertion lives here rather than in the gate.
  const target = render({ isCovered: true });
  const frame = target.querySelector('iframe');
  expect(frame).not.toBeNull();
  expect(frame!.getAttribute('src')).toBe('https://example.org/embed/x');
});

it('does not render the watched row (or its SVG) while uncovered', () => {
  const target = render({ isCovered: false });
  expect(target.querySelector('.watched')).toBeNull();
  expect(target.querySelector('button')).not.toBeNull();
});

it('starts the coverage tracker once on mount and stops it on unmount', () => {
  render({ isCovered: true });
  expect(vi.mocked(createCoverageTracker)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createCoverageTracker)).toHaveBeenCalledWith(9);
  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();

  cleanup!(); cleanup = null;
  expect(stop).toHaveBeenCalledTimes(1);
});

it('marks covered exactly once when "Mark as watched" is clicked', async () => {
  const target = render({ isCovered: false });
  const btn = target.querySelector('button')!;
  btn.click();
  await Promise.resolve(); await Promise.resolve();
  flushSync();
  expect(markCovered).toHaveBeenCalledTimes(1);
});

it('wraps the standalone action Button in a block .actions element', () => {
  // §2: the article is a stretch column and Button's root has no width guard,
  // so the wrapper is what absorbs the cross-axis stretch.
  const target = render({ isCovered: false });
  const actions = target.querySelector('.actions');
  expect(actions).not.toBeNull();
  expect(actions!.querySelector('button')).not.toBeNull();
});
