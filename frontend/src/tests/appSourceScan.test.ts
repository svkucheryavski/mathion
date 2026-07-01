import { it, expect } from 'vitest';
import { scanAppSource } from '../lib/appSourceScan';

it('warns on ES-module tokens', () => {
  expect(scanAppSource("import x from 'y';").some((w) => w.includes('ES module'))).toBe(true);
  expect(scanAppSource("export const a = 1;").some((w) => w.includes('ES module'))).toBe(true);
});

it('warns when #app-root is not referenced', () => {
  expect(scanAppSource("console.log(1)").some((w) => w.includes('app-root'))).toBe(true);
});

it('does not warn about app-root when present', () => {
  expect(scanAppSource("document.getElementById('app-root')").some((w) => w.includes('app-root'))).toBe(false);
});

it('warns on network/external calls', () => {
  for (const s of ['fetch(1)', 'new XMLHttpRequest()', 'new WebSocket(x)', 'new EventSource(x)', 'navigator.sendBeacon(x)', "import('x')", 'https://cdn.example.com/x.js']) {
    expect(scanAppSource(s).some((w) => w.includes('Network')), s).toBe(true);
  }
});

it('a clean self-contained file yields no warnings', () => {
  const clean = "const r = document.getElementById('app-root'); r.textContent = 'ok';";
  expect(scanAppSource(clean)).toEqual([]);
});
