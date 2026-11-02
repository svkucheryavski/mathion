import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Skeleton from '../components/ui/Skeleton.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: { rows?: number; label?: string } = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(Skeleton, { target: host, props });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('Skeleton (Slice-4 §1.1)', () => {
  it('is a polite status region whose only text is the visually-hidden label', () => {
    const el = render();
    const root = el.querySelector('.skeleton');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('role')).toBe('status');
    expect(root!.getAttribute('aria-live')).toBe('polite');
    const label = root!.querySelector('.sr-only');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('Loading…');
    // The rows carry no text, so the region's text IS the label (trimmed: Svelte
    // keeps single spaces between sibling elements).
    expect(root!.textContent?.trim()).toBe('Loading…');
  });

  it('renders the default 3 rows, each hidden from AT with exactly 3 bars', () => {
    const el = render();
    const rows = el.querySelectorAll('.skeleton .row');
    expect(rows.length).toBe(3);
    rows.forEach((r) => {
      expect(r.getAttribute('aria-hidden')).toBe('true');
      expect(r.querySelectorAll('.bar').length).toBe(3);
      expect(r.querySelectorAll('.bar.end').length).toBe(1);
    });
  });

  it('renders `rows` rows and overrides the label', () => {
    const el = render({ rows: 1, label: 'Fetching courses' });
    expect(el.querySelectorAll('.row').length).toBe(1);
    expect(el.querySelector('.sr-only')!.textContent).toBe('Fetching courses');
  });

  it('cycles the three artboard width triples: row 4 repeats row 1', () => {
    const el = render({ rows: 4 });
    const rows = el.querySelectorAll('.row');
    expect(rows.length).toBe(4);
    const widths = (r: Element) =>
      Array.from(r.querySelectorAll<HTMLElement>('.bar')).map((b) => b.style.width);
    expect(widths(rows[0])).toEqual(['180px', '90px', '64px']);   // ref 1347
    expect(widths(rows[1])).toEqual(['220px', '70px', '64px']);   // ref 1348
    expect(widths(rows[2])).toEqual(['150px', '110px', '64px']);  // ref 1349
    expect(widths(rows[3])).toEqual(widths(rows[0]));
  });
});
