// Fake ResizeObserver: reports `width` on observe (none when null) and on every resize().
type Entry = { target: Element; contentRect: { width: number } };
type Callback = (entries: Entry[]) => void;

export function installResizeObserver(width: number | null) {
  const g = globalThis as { ResizeObserver?: unknown };
  const original = g.ResizeObserver;
  const live = new Set<{ cb: Callback; els: Set<Element> }>();
  let current = width;

  class FakeResizeObserver {
    private rec: { cb: Callback; els: Set<Element> };
    constructor(cb: Callback) { this.rec = { cb, els: new Set() }; live.add(this.rec); }
    observe(el: Element) {
      this.rec.els.add(el);
      if (current !== null) this.rec.cb([{ target: el, contentRect: { width: current } }]);
    }
    unobserve(el: Element) { this.rec.els.delete(el); }
    disconnect() { this.rec.els.clear(); live.delete(this.rec); }
  }
  g.ResizeObserver = FakeResizeObserver;

  return {
    resize(w: number) {
      current = w;
      for (const rec of [...live]) {
        const entries = [...rec.els].map((target) => ({ target, contentRect: { width: w } }));
        if (entries.length) rec.cb(entries);
      }
    },
    restore() { g.ResizeObserver = original; },
  };
}
