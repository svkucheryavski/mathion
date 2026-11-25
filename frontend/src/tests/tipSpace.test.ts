import { describe, it, expect, afterEach, vi } from 'vitest';
import { appZoom, rectScale, tipSpace } from '../lib/tipSpace';
import { rect, stubZoom } from './support/zoomStubs';

// The rectScale cache is module-level, so every case below uses its own zoom value.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const left = () => document.querySelectorAll('[data-zoom-probe]').length;

describe('appZoom', () => {
  it('reads --app-zoom on <html>', () => {
    stubZoom(' 1.15', 115);
    expect(appZoom()).toBe(1.15);
  });

  it.each(['', 'abc', '0', '-2', 'Infinity'])('falls back to 1 for %j', (v) => {
    stubZoom(v, 115);
    expect(appZoom()).toBe(1);
  });
});

describe('rectScale', () => {
  it('is 1 at zoom 1 without a probe', () => {
    const z = stubZoom('1', 115);
    expect(rectScale(1)).toBe(1);
    expect(z.probes()).toBe(0);
  });

  it('measures the probe and removes it', () => {
    const z = stubZoom('1.17', 117);
    expect(rectScale(1.17)).toBe(1.17);
    expect(z.probes()).toBe(1);
    expect(left()).toBe(0);
  });

  it.each([[1.3, 0, 130], [1.4, NaN, 140], [1.5, Infinity, 150]])(
    'at zoom %s a probe of %s falls back to 1 and is not cached',
    (zoom, bad, good) => {
      const z = stubZoom(String(zoom), bad);
      expect(rectScale(zoom)).toBe(1);
      z.setProbe(good);
      expect(rectScale(zoom)).toBe(zoom);
      expect(z.probes()).toBe(2);
      expect(left()).toBe(0);
    },
  );

  it('caches a good measurement per zoom', () => {
    const z = stubZoom('1.2', 120);
    expect(rectScale(1.2)).toBe(1.2);
    z.setProbe(100);
    expect(rectScale(1.2)).toBe(1.2);
    expect(z.probes()).toBe(1);
  });
});

describe('tipSpace', () => {
  it('model (a): rects scale with the zoom', () => {
    stubZoom('1.15', 115);
    const s = tipSpace();
    expect(s.width).toBeCloseTo(1512 / 1.15);
    expect(s.height).toBeCloseTo(860 / 1.15);
    const b = s.box(rect(115, 230, 57.5, 115));
    expect(b.left).toBeCloseTo(100);
    expect(b.right).toBeCloseTo(200);
    expect(b.top).toBeCloseTo(50);
    expect(b.bottom).toBeCloseTo(100);
  });

  it('model (b): rects stay in layout px', () => {
    stubZoom('1.16', 100);
    const s = tipSpace();
    expect(s.width).toBeCloseTo(1512 / 1.16);
    expect(s.box(rect(115, 230, 57.5, 115))).toEqual({ left: 115, right: 230, top: 57.5, bottom: 115 });
  });

  it('model (a): a classic scrollbar is left out of the window', () => {
    stubZoom('1.19', 119, 1512, 860, [1495, 843]);
    const s = tipSpace();
    expect(s.width).toBeCloseTo(1495 / 1.19);
    expect(s.height).toBeCloseTo(843 / 1.19);
    expect(document.querySelectorAll('[data-view-probe]').length).toBe(0);
  });

  it('model (b): the window probe is read in layout px', () => {
    stubZoom('1.21', 100, 1512, 860, [1235.5, 710.7]);
    const s = tipSpace();
    expect(s.width).toBeCloseTo(1235.5);
    expect(s.height).toBeCloseTo(710.7);
  });

  it('at zoom 1 a classic scrollbar is left out too', () => {
    stubZoom('1', 115, 1512, 860, [1497, 860]);
    expect(tipSpace().width).toBe(1497);
  });

  it('at zoom 1 it is the raw window and rects', () => {
    const z = stubZoom('1', 115);
    const s = tipSpace();
    expect(s.width).toBe(1512);
    expect(s.height).toBe(860);
    expect(s.box(rect(10, 20, 30, 40))).toEqual({ left: 10, right: 20, top: 30, bottom: 40 });
    expect(z.probes()).toBe(0);
  });
});
