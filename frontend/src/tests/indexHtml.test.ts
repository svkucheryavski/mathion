/// <reference types="vite/client" />
import { it, expect } from 'vitest';
// Read index.html at transform time via Vite's `?raw` loader — avoids node:fs /
// node:url (the project ships no @types/node, so those imports fail `svelte-check`).
import indexHtml from '../../index.html?raw';

it('sets a no-referrer meta so the panel token never leaks via Referer', () => {
  expect(indexHtml).toContain('<meta name="referrer" content="no-referrer">');
});
