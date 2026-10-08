import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ProgressMeter from '../components/course/ProgressMeter.svelte';
import type { Progress } from '../lib/progress';

// The bar + quiz chip pair shared by a sequence row and a block header
// (user, 2026-10-08). Presentational: it takes a computed Progress.

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

const P = (over: Partial<Progress> = {}): Progress => ({
  covered: 2, total: 3, pct: 66, barPct: 66, done: false, hasQuiz: false, quizPct: null, ...over,
});

function render(p: Progress, onStrip?: boolean) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(ProgressMeter, { target: host, props: onStrip === undefined ? { p } : { p, onStrip } });
  flushSync();
  return host;
}
afterEach(() => {
  if (component) unmount(component);
  host?.remove();
  component = null;
});

const chip = (r: HTMLElement) => r.querySelector('.quiz-chip') as HTMLElement;

describe('ProgressMeter', () => {
  it('renders exactly two hidden cells, bar then chip, as siblings (they sit in the parent row flex)', () => {
    const r = render(P());
    expect(Array.from(r.children).map((e) => e.className.split(' ')[0])).toEqual(['progress', 'quiz-chip']);
    for (const el of Array.from(r.children)) expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the fill at barPct and prints pct', () => {
    const r = render(P({ covered: 1, total: 220, pct: 0, barPct: 2 }));
    expect((r.querySelector('.fill') as HTMLElement).style.width).toBe('2%');
    expect((r.querySelector('.pct') as HTMLElement).textContent).toBe('0%');
  });

  it('marks a finished set .done (green)', () => {
    expect(render(P({ pct: 100, barPct: 100, done: true })).querySelector('.fill.done')).not.toBeNull();
  });

  it('chip: score with the quiz check, "Quiz –" when none tried, empty when no quizzes', () => {
    let r = render(P({ hasQuiz: true, quizPct: 75 }));
    expect(chip(r).textContent!.trim()).toBe('Quiz 75%');
    expect(chip(r).querySelector('svg polyline')).not.toBeNull();
    unmount(component!); host.remove();
    r = render(P({ hasQuiz: true, quizPct: null }));
    expect(chip(r).textContent!.trim()).toBe('Quiz –');
    expect(chip(r).classList.contains('none')).toBe(true);
    unmount(component!); host.remove();
    r = render(P());
    expect(chip(r).textContent!.trim()).toBe('');
    expect(chip(r).classList.contains('empty')).toBe(true);
  });

  it('onStrip flips the chip to the light fill used on a tinted header strip', () => {
    expect(chip(render(P({ hasQuiz: true, quizPct: 50 }), true)).classList.contains('on-strip')).toBe(true);
    unmount(component!); host.remove(); component = null;
    expect(chip(render(P({ hasQuiz: true, quizPct: 50 }))).classList.contains('on-strip')).toBe(false);
  });
});
