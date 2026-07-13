import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';

it('sets a no-referrer meta so the panel token never leaks via Referer', () => {
  // Use node:url's URL explicitly: under the jsdom test environment, the
  // global `URL` is jsdom's implementation, which resolves relative URLs
  // against jsdom's document base (http://localhost:3000/) rather than
  // import.meta.url, breaking fileURLToPath. Node's URL resolves correctly.
  const html = readFileSync(fileURLToPath(new NodeURL('../../index.html', import.meta.url)), 'utf-8');
  expect(html).toContain('<meta name="referrer" content="no-referrer">');
});
