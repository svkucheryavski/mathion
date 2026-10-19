import { describe, it, expect } from 'vitest';
import { externalLinks, opensInNewTab } from '../lib/externalLinks';

// jsdom's origin is http://localhost:3000; same-origin hrefs are built from it, never hard-coded.
const here = location.origin;

function attach(href: string): HTMLAnchorElement {
  const el = document.createElement('div');
  const a = document.createElement('a');
  a.setAttribute('href', href);
  a.textContent = 'x';
  el.append(a);
  externalLinks('<p>unused</p>')(el);
  return a;
}

describe('externalLinks (Polish 2 D58, D59)', () => {
  it.each([
    ['https to another origin', 'https://example.org/x'],
    ['http to another origin', 'http://example.org'],
    ['an uppercase scheme (the renderer keeps scheme case)', 'HTTPS://EXAMPLE.ORG/A'],
    ['a protocol-relative host', '//cdn.example.org/x'],
    ['a course file, relative', '/assets/12/notes.pdf'],
    ['a run file, relative', '/api/runs/3/assets/data.csv'],
    ['a course file, same-origin absolute', `${here}/assets/12/notes.pdf`],
    ['a run file, same-origin absolute', `${here}/api/runs/3/assets/data.csv`],
  ])('%s opens in a new tab with rel=noopener noreferrer', (_label, href) => {
    const a = attach(href);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each([
    ['a Mathion page, same-origin absolute', `${here}/courses/demo`],
    ['a Mathion page, relative', '/courses/x'],
    ['an anchor', '#section-2'],
    ['mailto', 'mailto:a@b.org'],
    ['tel', 'tel:+4512345678'],
    ['an href that does not parse', 'http://[bad'],
  ])('%s stays in the tab', (_label, href) => {
    const a = attach(href);
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.hasAttribute('rel')).toBe(false);
  });

  it('leaves an anchor without href alone', () => {
    const el = document.createElement('div');
    el.innerHTML = '<a name="top">top</a>';
    externalLinks('')(el);
    expect(el.querySelector('a')!.hasAttribute('target')).toBe(false);
  });

  it('opensInNewTab is the same test', () => {
    expect(opensInNewTab('https://example.org')).toBe(true);
    expect(opensInNewTab('/assets/1/a.pdf')).toBe(true);
    expect(opensInNewTab('/courses/x')).toBe(false);
  });
});
