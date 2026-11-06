import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EditColoursDialog from '../components/superuser/EditColoursDialog.svelte';
import { ApiError } from '../lib/api';
import type { BrandingPart, PanelColours, ThemeCheck } from '../lib/superuser';
import { THEME_VARS } from './support/themeVars';

// Branding D2, D10: the Edit colours dialog. The file is read once and the same
// bytes go to the check and to Save; Save waits for the check; a refused
// choice drops every pending change; a late check answer is ignored; the
// preview declares the merged colours and never the raw file.

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
/** FileReader answers in a task, not a microtask. */
async function tick() { for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); await settle(); } }

const enc = new TextEncoder();
const PROXY = "This file is over the server's upload limit.";

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
// check() calls, in order, each answered by the test.
let checks: { bytes: number[]; filename: string; resolve: (c: ThemeCheck) => void; reject: (e: unknown) => void }[];
let saves: { part: BrandingPart; filename?: string }[];
let saveAnswer: () => Promise<void>;
let onDone: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let onAuth: ReturnType<typeof vi.fn>;

const colours = (changes: Record<string, string> = {}): PanelColours => ({ vars: THEME_VARS, changes, warnings: [] });
const answer = (over: Partial<ThemeCheck> = {}): ThemeCheck => ({ changes: {}, problems: [], more: 0, warnings: [], blocked: null, ...over });

beforeEach(() => {
  checks = [];
  saves = [];
  saveAnswer = async () => {};
  onDone = vi.fn(); onClose = vi.fn(); onAuth = vi.fn();
});
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

async function render(saved: PanelColours = colours()) {
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(EditColoursDialog, {
    target,
    props: {
      colours: saved, onDone, onClose, onAuth,
      check: (bytes: Uint8Array<ArrayBuffer>, filename: string) => new Promise<ThemeCheck>((resolve, reject) => {
        checks.push({ bytes: [...bytes], filename, resolve, reject });
      }),
      save: (part: BrandingPart, filename?: string) => { saves.push({ part, filename }); return saveAnswer(); },
    },
  });
  await settle();
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const footButton = (label: string) => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label);
const save = () => footButton('Save')!;
const blocked = () => save().getAttribute('aria-disabled') === 'true';
const preview = () => panel().querySelector<HTMLElement>('.ec-preview')!;
const fileLine = () => panel().querySelector('.ec-file')?.textContent ?? null;
const text = (sel: string) => [...panel().querySelectorAll(sel)].map((e) => e.textContent!.trim());

async function choose(source: string | Uint8Array, name = 'school.css') {
  const bytes = typeof source === 'string' ? enc.encode(source) : source;
  const input = panel().querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(bytes)], name, { type: 'text/css' })], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}
async function answerCheck(i: number, c: ThemeCheck) { checks[i].resolve(c); await settle(); }

describe('the Edit colours dialog (D2, D10)', () => {
  it('shows the title, the Choose button, the hint and the preview; Save blocked; no Reset for the default', async () => {
    await render();
    expect(panel().querySelector('h2')?.textContent).toBe('Edit colours');
    expect([...panel().querySelectorAll('button')].some((b) => b.textContent!.trim() === 'Choose a .css file…')).toBe(true);
    expect(panel().querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe('.css,text/css');
    expect(text('.ec-hint')).toEqual(["Only colour variables, as in the downloaded theme. A colour you leave out gets Mathion's."]);
    expect(preview()).not.toBeNull();
    expect(blocked()).toBe(true);
    expect(footButton('Reset to default')).toBeUndefined();
  });

  it('a chosen file is read once; the same bytes go to the check and to Save, which waits for the check', async () => {
    await render();
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    const css = ':root { --primary: #7a1f2b; --bg: #fff8e7; --text: #111; }';
    await choose(css);
    expect(read).toHaveBeenCalledTimes(1);
    expect(checks).toHaveLength(1);
    expect(checks[0].bytes).toEqual([...enc.encode(css)]);
    expect(checks[0].filename).toBe('school.css');
    expect(fileLine()).toBe('school.css: checking…');
    expect(blocked()).toBe(true);
    save().click(); await settle();
    expect(saves).toHaveLength(0);

    await answerCheck(0, answer({ changes: { '--primary': '#7a1f2b', '--bg': '#fff8e7', '--text': '#111' } }));
    expect(fileLine()).toBe('school.css: 3 colours');
    expect(blocked()).toBe(false);
    save().click(); await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(saves).toHaveLength(1);
    expect([...(saves[0].part as Uint8Array)]).toEqual([...enc.encode(css)]);
    expect(saves[0].filename).toBe('school.css');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("the check's blocked sentence shows and keeps Save blocked", async () => {
    await render(colours({ '--primary': '#7a1f2b' }));
    await choose(':root { --primary: #7a1f2b; }');
    await answerCheck(0, answer({ changes: { '--primary': '#7a1f2b' }, blocked: 'This file matches the saved colours.' }));
    expect(text('.ec-blocked')).toEqual(['This file matches the saved colours.']);
    expect(blocked()).toBe(true);
    save().click(); await settle();
    expect(saves).toHaveLength(0);
  });

  it('warnings are listed, with names as code, and never block Save', async () => {
    await render(colours({ '--primary': '#7a1f2b' }));
    await choose(':root { --muted: #aaa; }');
    await answerCheck(0, answer({
      changes: { '--muted': '#aaa' },
      warnings: [
        'Text may be hard to read: `--muted` on `--surface` is 2.3:1 (4.5:1 recommended).',
        "This file puts back Mathion's colour for `--primary`, which is changed now.",
      ],
    }));
    expect(text('.ec-warnings li')).toEqual([
      'Text may be hard to read: --muted on --surface is 2.3:1 (4.5:1 recommended).',
      "This file puts back Mathion's colour for --primary, which is changed now.",
    ]);
    expect(text('.ec-warnings li code')).toEqual(['--muted', '--surface', '--primary']);
    expect(blocked()).toBe(false);
  });

  it('a refused choice lists the problems with "and 10 more", and drops every pending change', async () => {
    await render(colours({ '--bg': '#fff8e7' }));
    await choose(':root { --primary: #7a1f2b; }', 'good.css');
    await answerCheck(0, answer({ changes: { '--primary': '#7a1f2b' } }));
    expect(preview().style.getPropertyValue('--primary')).toBe('#7a1f2b');

    const problems = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: \`--radius\` isn't a colour, so it can't be changed here.`);
    await choose(':root { --radius: 3px; }', 'bad.css');
    await answerCheck(1, answer({ problems, more: 10 }));
    expect(text('.ec-problems li')).toHaveLength(21);
    expect(text('.ec-problems li')[0]).toBe("Line 1: --radius isn't a colour, so it can't be changed here.");
    expect(text('.ec-problems li')[20]).toBe('and 10 more');
    expect(panel().querySelector('.ec-problems')!.getAttribute('role')).toBe('alert');
    expect(fileLine()).toBeNull();
    expect(blocked()).toBe(true);
    // The preview is the saved colours again.
    expect(preview().style.getPropertyValue('--primary')).toBe(THEME_VARS.find((v) => v.name === '--primary')!.default);
    expect(preview().style.getPropertyValue('--bg')).toBe('#fff8e7');
  });

  it('a refused choice drops a pending Reset too', async () => {
    await render(colours({ '--bg': '#fff8e7' }));
    footButton('Reset to default')!.click(); await settle();
    expect(blocked()).toBe(false);
    await choose(':root { --radius: 3px; }');
    await answerCheck(0, answer({ problems: ["Line 1: `--radius` isn't a colour, so it can't be changed here."] }));
    expect(blocked()).toBe(true);
    expect(preview().style.getPropertyValue('--bg')).toBe('#fff8e7');
  });

  it('a check answer for an earlier choice is ignored', async () => {
    await render();
    await choose(':root { --primary: #111; }', 'first.css');
    await choose(':root { --primary: #222; }', 'second.css');
    await answerCheck(1, answer({ changes: { '--primary': '#222' } }));
    await answerCheck(0, answer({ problems: ['Line 1: something.'] }));
    expect(text('.ec-problems li')).toEqual([]);
    expect(fileLine()).toBe('second.css: 1 colour');
    expect(preview().style.getPropertyValue('--primary')).toBe('#222');
    save().click(); await settle();
    expect(saves[0].filename).toBe('second.css');
  });

  it('a check still running when Reset is pressed is ignored', async () => {
    await render(colours({ '--bg': '#fff8e7' }));
    await choose(':root { --primary: #111; }');
    footButton('Reset to default')!.click(); await settle();
    await answerCheck(0, answer({ changes: { '--primary': '#111' } }));
    expect(fileLine()).toBeNull();
    expect(preview().style.getPropertyValue('--primary')).toBe(THEME_VARS.find((v) => v.name === '--primary')!.default);
    save().click(); await settle();
    expect(saves).toEqual([{ part: 'reset', filename: undefined }]);
  });

  it('Reset shows only with saved changes; it shows the defaults, moves focus to Save, and Save removes every change', async () => {
    await render(colours({ '--bg': '#fff8e7', '--primary': '#7a1f2b' }));
    expect(preview().style.getPropertyValue('--bg')).toBe('#fff8e7');
    footButton('Reset to default')!.click(); await settle();
    expect(document.activeElement).toBe(save());
    expect(preview().style.getPropertyValue('--bg')).toBe(THEME_VARS[0].default);
    expect(blocked()).toBe(false);
    save().click(); await settle();
    expect(saves).toEqual([{ part: 'reset', filename: undefined }]);
  });

  it("a proxy's bare 413 on the check refuses the choice with the upload-limit sentence", async () => {
    await render();
    await choose(':root { --primary: #111; }');
    checks[0].reject(new ApiError(413, 'Request Entity Too Large')); await settle();
    expect(text('.ec-err')).toEqual([PROXY]);
    expect(fileLine()).toBeNull();
    expect(blocked()).toBe(true);
  });

  it("a proxy's bare 413 on Save shows the upload-limit sentence; the server's 422 its own", async () => {
    await render();
    await choose(':root { --primary: #111; }');
    await answerCheck(0, answer({ changes: { '--primary': '#111' } }));
    saveAnswer = () => Promise.reject(new ApiError(413, 'Request Entity Too Large'));
    save().click(); await settle();
    expect(text('.ec-err')).toEqual([PROXY]);
    saveAnswer = () => Promise.reject(new ApiError(422, 'Line 1: `--x` is set twice.'));
    save().click(); await settle();
    expect(text('.ec-err')).toEqual(['Line 1: --x is set twice.']);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a file over 64 KB is refused at once, unread and unchecked', async () => {
    await render();
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    await choose(new Uint8Array(64 * 1024 + 1).fill(32));
    expect(read).not.toHaveBeenCalled();
    expect(checks).toHaveLength(0);
    expect(text('.ec-err')).toEqual(['The theme file can be at most 64 KB.']);
  });
});

describe('the preview (D10)', () => {
  it('is inert and holds the real primary and secondary Button and two StatusBadges', async () => {
    await render();
    expect(preview().hasAttribute('inert')).toBe(true);
    expect([...preview().querySelectorAll('button.btn')].map((b) => b.getAttribute('data-variant'))).toEqual(['primary', 'secondary']);
    expect(preview().querySelectorAll('.status-badge')).toHaveLength(2);
    expect(preview().querySelector('a')).not.toBeNull();
  });

  it("declares all 73 merged colours with style.setProperty, the 4 var() defaults again; never the raw file", async () => {
    await render();
    const set = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    const css = '/* RAW-SENTINEL */ :root { --primary: #7a1f2b; }';
    await choose(css);
    await answerCheck(0, answer({ changes: { '--primary': '#7a1f2b' } }));
    const declared = Object.fromEntries(THEME_VARS.map((v) => [v.name, preview().style.getPropertyValue(v.name)]));
    expect(Object.values(declared).every((v) => v !== '')).toBe(true);
    expect(declared['--primary']).toBe('#7a1f2b');
    expect(declared['--focus-0']).toBe('var(--surface)');
    expect(declared['--focus-page']).toBe('var(--bg)');
    expect(declared['--cancel-hover']).toBe('var(--focus-1)');
    expect(declared['--cancel-press']).toBe('var(--focus-2)');
    expect(set.mock.calls.some(([n, v]) => n === '--primary' && v === '#7a1f2b')).toBe(true);
    expect(document.documentElement.outerHTML).not.toContain('RAW-SENTINEL');
    expect(preview().querySelector('style')).toBeNull();
  });
});
