import { it, expect, vi, afterEach, describe } from 'vitest';
import { themeFileText, downloadTheme, mergedColours, THEME_FILE_NAME } from '../lib/themeFile';
import { THEME_VARS } from './support/themeVars';

// Branding D9: the downloaded theme, built in the browser from the panel's read.

const HEADER = "Mathion colours. Change the values you want and upload the whole file on the Branding page. "
  + "A line left at Mathion's value changes nothing; a line you delete goes back to Mathion's colour. "
  + 'Only colours can be changed here.';

const colours = (changes: Record<string, string> = {}) => ({ vars: THEME_VARS, changes, warnings: [] });
const declarations = (text: string) => text.split('\n').filter((l) => /^\s*--/.test(l)).map((l) => l.trim());

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
/** jsdom's Blob has no text(); FileReader reads it. */
function blobText(b: Blob): Promise<string> {
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsText(b); });
}

describe('themeFileText (D9)', () => {
  it('the fixture is the real list: 73 colours, 14 headings', () => {
    expect(THEME_VARS).toHaveLength(73);
    expect(new Set(THEME_VARS.map((v) => v.heading)).size).toBe(14);
  });

  it("starts with D9's header comment, word for word, and nothing from theme-default.css", () => {
    const text = themeFileText(colours());
    expect(text.startsWith(`/* ${HEADER} */\n`)).toBe(true);
    expect(text).not.toMatch(/\bD\d+\b/);
    expect(text).not.toContain("Don't");
  });

  it('writes one :root block: the 73 colours in order at their defaults, each family under its heading', () => {
    const text = themeFileText(colours());
    expect((text.match(/:root\s*\{/g) ?? [])).toHaveLength(1);
    expect(text.trimEnd().endsWith('}')).toBe(true);
    expect(declarations(text)).toEqual(THEME_VARS.map((v) => `${v.name}: ${v.default};`));
    // Each heading is a comment just before its family's first colour, once.
    const lines = text.split('\n').map((l) => l.trim());
    const headings = [...new Set(THEME_VARS.map((v) => v.heading))];
    for (const h of headings) {
      const at = lines.indexOf(`/* ${h} */`);
      expect(at, h).toBeGreaterThan(0);
      expect(lines.filter((l) => l === `/* ${h} */`)).toHaveLength(1);
      const first = THEME_VARS.find((v) => v.heading === h)!;
      expect(lines[at + 1]).toBe(`${first.name}: ${first.default};`);
    }
  });

  it('writes the changes in use in place of the defaults', () => {
    const text = themeFileText(colours({ '--primary': '#7a1f2b', '--focus-0': 'var(--surface-2)', '--bg': 'white' }));
    const d = declarations(text);
    expect(d).toContain('--primary: #7a1f2b;');
    expect(d).toContain('--focus-0: var(--surface-2);');
    expect(d).toContain('--bg: white;');
    expect(d).toContain('--text: #16181D;');
    expect(d).toHaveLength(73);
  });

  it('a dead stored value is written as the default: a name no longer a theme colour, a var() to one', () => {
    const d = declarations(themeFileText(colours({ '--gone': '#123456', '--primary': 'var(--radius)' })));
    expect(d).toHaveLength(73);
    expect(d.some((l) => l.startsWith('--gone'))).toBe(false);
    const primary = THEME_VARS.find((v) => v.name === '--primary')!;
    expect(d).toContain(`--primary: ${primary.default};`);
  });
});

describe('mergedColours (D10 preview)', () => {
  it('every colour: the change where there is one, else the default, the 4 var() defaults included', () => {
    const m = mergedColours(THEME_VARS, { '--bg': '#fff8e7', '--gone': 'red' });
    expect(Object.keys(m)).toEqual(THEME_VARS.map((v) => v.name));
    expect(m['--bg']).toBe('#fff8e7');
    expect(m['--focus-0']).toBe('var(--surface)');
    expect(m['--focus-page']).toBe('var(--bg)');
    expect(m['--cancel-hover']).toBe('var(--focus-1)');
    expect(m['--cancel-press']).toBe('var(--focus-2)');
  });
});

describe('downloadTheme (D9)', () => {
  it('saves theme.css from a Blob made in the browser: no panel address, no new tab', async () => {
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => { blob = b; return 'blob:theme'; });
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let clicked: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked = this; });

    vi.useFakeTimers();
    downloadTheme(colours({ '--primary': '#7a1f2b' }));
    expect(THEME_FILE_NAME).toBe('theme.css');
    expect(clicked!.download).toBe('theme.css');
    expect(clicked!.getAttribute('href')).toBe('blob:theme');
    expect(clicked!.target).toBe('');
    expect(clicked!.isConnected).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(blob!.type).toBe('text/css');
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:theme');
    vi.useRealTimers();
    expect(await blobText(blob!)).toBe(themeFileText(colours({ '--primary': '#7a1f2b' })));
  });
});
