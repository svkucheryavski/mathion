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

it('quoted XML namespace names are not network addresses', () => {
  const src = "document.getElementById('app-root');"
    + " document.createElementNS(\"http://www.w3.org/2000/svg\", 'svg');"
    + " el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#a');"
    + " document.createElementNS(`http://www.w3.org/1998/Math/MathML`, 'math');"
    + " const x = 'http://www.w3.org/1999/xhtml', y = 'http://www.w3.org/2000/xmlns/', z = 'http://www.w3.org/XML/1998/namespace';";
  expect(scanAppSource(src)).toEqual([]);
});

it('still warns on look-alikes of a namespace name and on real addresses beside one', () => {
  for (const s of ["'http://www.w3.org/2000/svg/x.js'", "'https://www.w3.org/2000/svg'", "'http://www.w3.org/2000/svg", "\"http://www.w3.org/2000/svg'",
    "\"http://www.w3.org/2000/svg\"; fetch('/x')", "\"http://www.w3.org/2000/svg\" + 'https://cdn.example.com/x.js'",
    "'http://www.w3.org.evil.com/2000/svg'", "'http://evil.example/2000/svg'",
    "'https://svelte.dev/e/x/y.js'", "'https://svelte.dev/x.js'", "'http://svelte.dev/e/effect_orphan'", "'https://svelte.dev/e/ab.js'", "'https://svelte.dev.evil.com/e/x'", "'https://evil.example/e/x'",
    "'https://xsvelte.dev/e/x'", "'https://svelte.dev/e/x/y'", "'https://svelte.dev/docs/x'", "'https://x.io/?u=https://svelte.dev/e/ab'", "'see https://svelte.dev/e/ab and https://x.io'"]) {
    expect(scanAppSource(`document.getElementById('app-root'); ${s}`).some((w) => w.includes('Network')), s).toBe(true);
  }
});

it("Svelte's quoted error-doc links are not network addresses", () => {
  const src = "document.getElementById('app-root'); throw new Error(`https://svelte.dev/e/effect_orphan`);"
    + " e('https://svelte.dev/e/state_unsafe_mutation'); f(\"https://svelte.dev/e/bind_invalid_checkbox_value\");"
    + " g(\"Cannot do that\\nhttps://svelte.dev/e/state_unsafe_mutation\"); h.startsWith('https://svelte.dev/e/');";
  expect(scanAppSource(src)).toEqual([]);
});

it('a namespace name inside escaped quotes in a string is not an address', () => {
  expect(scanAppSource("document.getElementById('app-root'); el.innerHTML = \"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\"></svg>\";")).toEqual([]);
});
