// Stubs for the app zoom in jsdom: --app-zoom on <html>, the probe's width, the window size.
import { vi } from 'vitest';

export const rect = (left: number, right: number, top = 300, bottom = 330) =>
  ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** probes() counts probe measurements; setProbe() changes the next width. The scale cache lives per file: one probe width per zoom value.
 *  view is the fixed window probe's rect size (window less classic scrollbars); omitted, it measures 0 as in jsdom. */
export function stubZoom(zoom: string, probeWidth: number, width = 1512, height = 860, view?: [number, number]): { probes: () => number; setProbe: (w: number) => void } {
  const realStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const cs = realStyle(el, pseudo);
    if (el !== document.documentElement) return cs;
    return { getPropertyValue: (n: string) => (n === '--app-zoom' ? zoom : cs.getPropertyValue(n)) } as CSSStyleDeclaration;
  });
  let probes = 0;
  const realRect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (view && this.hasAttribute('data-view-probe')) return rect(0, view[0], 0, view[1]);
    if (!this.hasAttribute('data-zoom-probe')) return realRect.call(this);
    probes++;
    return rect(0, probeWidth, 0, 0);
  });
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  return { probes: () => probes, setProbe: (w: number) => { probeWidth = w; } };
}
