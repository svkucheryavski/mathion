import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CommandText from '../components/superuser/CommandText.svelte';

// D5a, Set up D8: a note's text with its command as code, when the text holds it.

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); });

function render(props: { text: string; command?: string }) {
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(CommandText, { target, props });
  flushSync();
}

it('the command inside the text shows as code, the text around it as it is', () => {
  render({ text: 'Run mathion pin a@b.dk on the server.', command: 'mathion pin a@b.dk' });
  expect(target.textContent).toBe('Run mathion pin a@b.dk on the server.');
  expect(target.querySelector('code')?.textContent).toBe('mathion pin a@b.dk');
});

it('no command: only the text', () => {
  render({ text: 'Anna Holm is its admin.' });
  expect(target.textContent).toBe('Anna Holm is its admin.');
  expect(target.querySelector('code')).toBeNull();
});

it('a command the text does not hold: only the text, no code', () => {
  render({ text: 'Anna Holm is its admin.', command: 'mathion pin a@b.dk' });
  expect(target.textContent).toBe('Anna Holm is its admin.');
  expect(target.querySelector('code')).toBeNull();
});
