// Window and element boxes in the zoomed layout space of position: fixed tooltips.

export interface TipBox { left: number; right: number; top: number; bottom: number }
export interface TipSpace { width: number; height: number; box(r: DOMRectReadOnly): TipBox }

const good = (n: number) => Number.isFinite(n) && n > 0;

/** The computed --app-zoom on <html>; 1 when it is not a positive number. */
export function appZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom'));
  return good(z) ? z : 1;
}

const scales = new Map<number, number>();

/** How much getBoundingClientRect scales at this zoom: about the zoom in current engines, 1 in Safari before 26.4. */
export function rectScale(zoom: number): number {
  if (zoom === 1) return 1;
  const hit = scales.get(zoom);
  if (hit !== undefined) return hit;
  const probe = document.createElement('div');
  probe.setAttribute('data-zoom-probe', '');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:100px;height:0;transform:none;pointer-events:none';
  document.body.appendChild(probe);
  const s = probe.getBoundingClientRect().width / 100;
  probe.remove();
  if (!good(s)) return 1;
  scales.set(zoom, s);
  return s;
}

/** The window size and a converter for element rects, both in layout px. */
export function tipSpace(): TipSpace {
  const zoom = appZoom();
  const s = rectScale(zoom);
  return {
    width: window.innerWidth / zoom,
    height: window.innerHeight / zoom,
    box: (r) => ({ left: r.left / s, right: r.right / s, top: r.top / s, bottom: r.bottom / s }),
  };
}
