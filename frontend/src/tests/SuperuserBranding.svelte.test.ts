import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserBranding from '../pages/superuser/SuperuserBranding.svelte';
import type { PanelBranding } from '../lib/superuser';
import { branding, setBranding, DEFAULT_BRANDING } from '../lib/branding.svelte';
import { crc32 } from '../lib/pngCheck';

// Branding D1, D2, D3-D6, D14: the page's four cards, the name dialog and the
// image dialogs.

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
/** FileReader answers in a task, not a microtask. */
async function tick() { await new Promise((r) => setTimeout(r, 0)); await settle(); }
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const LOGO_V = 'a'.repeat(16);
const ICON_V = 'c'.repeat(16);

function base(): PanelBranding {
  return {
    name: 'Mathion', logo: null, icon: null,
    colours: { vars: [], changes: {}, warnings: [] },
    public: { name: 'Mathion', logo: null, icon: null, theme: null },
  };
}
function branded(): PanelBranding {
  return {
    name: 'Riverside', logo: { width: 838, height: 174 }, icon: { width: 512, height: 512 },
    colours: { vars: [], changes: { '--bg': '#fff', '--primary': '#123456', '--text': '#111' }, warnings: [] },
    public: { name: 'Riverside', logo: { version: LOGO_V, width: 838, height: 174 }, icon: ICON_V, theme: 'd'.repeat(16) },
  };
}

// A real PNG of the given size (the check reads only the header and the CRCs).
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(kind: string, data: number[]) {
  const k = [...kind].map((c) => c.charCodeAt(0));
  return [...u32(data.length), ...k, ...data, ...u32(crc32(new Uint8Array([...k, ...data])))];
}
function pngOf(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...chunk('IDAT', [0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1]),
    ...chunk('IEND', []),
  ]);
}

type Handler = (body: unknown) => [number, unknown] | Response;
let routes: Record<string, Handler>;
let calls: { key: string; body: unknown }[];
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let onAuth: ReturnType<typeof vi.fn>;
// img.decode() calls, in order, each answered by the test (jsdom has none).
let decodes: { resolve: () => void; reject: () => void; src: string }[];

beforeEach(() => {
  calls = [];
  decodes = [];
  routes = { 'GET /branding': () => [200, base()] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('/api/superuser/T', '')}`;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ key, body });
    const h = routes[key];
    if (!h) return jsonResponse(500, { detail: `no route ${key}` });
    const out = h(body);
    return out instanceof Response ? out : jsonResponse(out[0], out[1]);
  }));
  (HTMLImageElement.prototype as { decode?: () => Promise<void> }).decode = function (this: HTMLImageElement) {
    return new Promise<void>((resolve, reject) => decodes.push({ resolve, reject: () => reject(new Error('EncodingError')), src: this.src }));
  };
});
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  document.head.querySelectorAll('[data-branding]').forEach((e) => e.remove());
  setBranding(DEFAULT_BRANDING);
  vi.restoreAllMocks();
});

async function render(data: PanelBranding = base()) {
  routes['GET /branding'] = () => [200, data];
  target = document.createElement('div');
  document.body.appendChild(target);
  onAuth = vi.fn();
  cmp = mount(SuperuserBranding, { target, props: { token: 'T', onAuth } });
  await settle();
}
const cards = () => [...target.querySelectorAll<HTMLElement>('section.b-card')];
const card = (title: string) => cards().find((c) => c.querySelector('h2')?.textContent === title)!;
const rows = (c: HTMLElement) => Object.fromEntries([...c.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling as HTMLElement]));
const pencil = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-action="edit"]');
const panel = () => document.querySelector<HTMLElement>('section.modal-panel');
const footButton = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label);
const save = () => footButton('Save')!;
/** Save is blocked (aria-disabled), not disabled, so focus can stay on it. */
const blocked = () => save().getAttribute('aria-disabled') === 'true';
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
async function open(title: string) { pencil(card(title))!.click(); await settle(); }
const posts = (path: string) => calls.filter((c) => c.key === `POST ${path}` || c.key === `PUT ${path}`);
const previews = () => [...panel()!.querySelectorAll<HTMLImageElement>('img')].map((i) => i.getAttribute('src') ?? '');

/** Choose a file in the open image dialog, as the browser's picker would. */
async function choose(bytes: Uint8Array, name = 'school.png') {
  const input = panel()!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(bytes)], name, { type: 'image/png' })], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 3; i++) await tick();
}
function partBytes(part: Blob): Promise<number[]> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve([...new Uint8Array(r.result as ArrayBuffer)]);
    r.readAsArrayBuffer(part);
  });
}

describe('the page (D1, D2)', () => {
  it('shows a skeleton while loading, then the Branding heading and four cards in order', async () => {
    let release: () => void = () => {};
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((...a: Parameters<typeof fetch>) => new Promise<Response>((r) => { release = () => r(real(...a)); })));
    target = document.createElement('div');
    document.body.appendChild(target);
    cmp = mount(SuperuserBranding, { target, props: { token: 'T', onAuth: vi.fn() } });
    await settle();
    expect(target.querySelector('.panel-head h1')?.textContent).toBe('Branding');
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(cards()).toHaveLength(0);
    release(); await settle(); await settle();
    expect(target.querySelector('.skeleton')).toBeNull();
    expect(cards().map((c) => c.querySelector('h2')?.textContent)).toEqual(['Site name', 'Logo', 'Tab icon', 'Colours']);
  });

  it('the default cards: the name and its hint, the drawn lockup, the Mathion mark, no colour changes', async () => {
    await render();
    const name = card('Site name');
    expect(rows(name)['Name'].textContent).toBe('Mathion');
    expect(name.querySelector('.b-foot')?.textContent).toBe(
      "Used for the tab title, emails and the logo's alt text. The header shows your logo, or Mathion's when you haven't uploaded one.");
    const logo = rows(card('Logo'))['In the header'];
    expect(logo.querySelector('.b-box svg.logo')).not.toBeNull();
    expect(logo.querySelector('img')).toBeNull();
    expect(logo.querySelector('.b-note')?.textContent).toBe('default');
    const icon = rows(card('Tab icon'))['Icon'];
    expect([...icon.querySelectorAll('img')].map((i) => [i.getAttribute('src'), i.getAttribute('width')])).toEqual([
      ['/api/branding/icon-default.svg', '32'], ['/api/branding/icon-default.svg', '16'],
    ]);
    expect(icon.querySelector('.b-note')?.textContent).toBe('default: the Mathion mark');
    expect(rows(card('Colours'))['Theme'].textContent).toBe('default');
    expect(pencil(card('Site name'))?.getAttribute('aria-label')).toBe('Edit site name');
    expect(pencil(card('Logo'))?.getAttribute('aria-label')).toBe('Edit logo');
    expect(pencil(card('Tab icon'))?.getAttribute('aria-label')).toBe('Edit tab icon');
  });

  it('the branded cards: the uploads at their real sizes, and the changed colours', async () => {
    await render(branded());
    expect(rows(card('Site name'))['Name'].textContent).toBe('Riverside');
    const logo = rows(card('Logo'))['In the header'];
    const img = logo.querySelector('.b-box img')!;
    expect(img.getAttribute('src')).toBe(`/api/branding/logo.png?v=${LOGO_V}`);
    expect(img.classList.contains('logo-header')).toBe(true);
    expect(logo.querySelector('.b-note')?.textContent).toBe('your upload, 838 × 174 px');
    const icon = rows(card('Tab icon'))['Icon'];
    expect([...icon.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      `/api/branding/icon.png?v=${ICON_V}`, `/api/branding/icon.png?v=${ICON_V}`,
    ]);
    expect(icon.querySelector('.b-note')?.textContent).toBe('your upload');
    const theme = rows(card('Colours'))['Theme'];
    expect(theme.textContent).toBe('3 colours changed: --bg, --primary, --text');
    expect([...theme.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['--bg', '--primary', '--text']);
  });

  it('one changed colour reads "1 colour changed:"', async () => {
    const b = base();
    b.colours.changes = { '--bg': '#fff' };
    await render(b);
    expect(rows(card('Colours'))['Theme'].textContent).toBe('1 colour changed: --bg');
  });

  it("the read updates the store, so the panel's own logo shows the current branding", async () => {
    await render(branded());
    expect(branding.name).toBe('Riverside');
    expect(branding.logo).toEqual({ version: LOGO_V, width: 838, height: 174 });
  });

  it("a failed load shows the panel's error state with the server's sentence", async () => {
    routes['GET /branding'] = () => [409, { detail: 'Something is off.' }];
    target = document.createElement('div');
    document.body.appendChild(target);
    cmp = mount(SuperuserBranding, { target, props: { token: 'T', onAuth: vi.fn() } });
    await settle();
    expect(target.querySelector('.error-state')?.textContent).toContain('Something is off.');
    expect(cards()).toHaveLength(0);
  });

  it('a 404 hands the expired link to the shell', async () => {
    routes['GET /branding'] = () => [404, { detail: 'Not Found' }];
    target = document.createElement('div');
    document.body.appendChild(target);
    onAuth = vi.fn();
    cmp = mount(SuperuserBranding, { target, props: { token: 'T', onAuth } });
    await settle();
    expect(onAuth).toHaveBeenCalledWith('expired');
  });
});

describe('the Edit site name dialog (D2, D3)', () => {
  const field = () => panel()!.querySelector<HTMLInputElement>('input')!;

  it('Save is blocked until the name changes; a save shows it on the card and in the tab title', async () => {
    await render();
    await open('Site name');
    expect(panel()!.querySelector('h2')?.textContent).toBe('Edit site name');
    expect(field().value).toBe('Mathion');
    expect(blocked()).toBe(true);
    save().click(); await settle();
    expect(posts('/branding/name')).toHaveLength(0);
    routes['PUT /branding/name'] = () => {
      const b = base(); b.name = 'Riverside'; b.public.name = 'Riverside';
      return [200, b];
    };
    type(field(), 'Riverside');
    expect(blocked()).toBe(false);
    save().click(); await settle();
    expect(posts('/branding/name').map((c) => c.body)).toEqual([{ name: 'Riverside' }]);
    expect(panel()).toBeNull();
    expect(rows(card('Site name'))['Name'].textContent).toBe('Riverside');
    // D14: applyBranding ran with the answer's public branding.
    expect(document.title).toBe('Riverside');
    expect(branding.name).toBe('Riverside');
  });

  it("the server's sentence shows inside the dialog, which stays open", async () => {
    await render();
    await open('Site name');
    routes['PUT /branding/name'] = () => [422, { detail: 'The site name must be 1 to 60 characters on one line.' }];
    type(field(), 'x'.repeat(61));
    save().click(); await settle();
    expect(panel()!.querySelector('[role="alert"]')?.textContent).toBe('The site name must be 1 to 60 characters on one line.');
    expect(panel()).not.toBeNull();
  });

  it('Reset to default shows only when the name is not the default', async () => {
    await render();
    await open('Site name');
    expect(footButton('Reset to default')).toBeUndefined();
    footButton('Cancel')!.click(); await settle();
    expect(panel()).toBeNull();
    unmount(cmp!); cmp = null; target.remove();
    await render(branded());
    await open('Site name');
    expect(footButton('Reset to default')).toBeDefined();
  });

  it('Reset puts the default in the field, moves focus to Save, and Save stores it', async () => {
    await render(branded());
    await open('Site name');
    footButton('Reset to default')!.click(); await settle();
    expect(field().value).toBe('Mathion');
    expect(document.activeElement).toBe(save());
    expect(blocked()).toBe(false);
    routes['PUT /branding/name'] = () => [200, base()];
    save().click(); await settle();
    expect(posts('/branding/name').map((c) => c.body)).toEqual([{ reset: true }]);
    expect(rows(card('Site name'))['Name'].textContent).toBe('Mathion');
  });

  it('typing after Reset saves the typed name (the last change wins)', async () => {
    await render(branded());
    await open('Site name');
    footButton('Reset to default')!.click(); await settle();
    type(field(), 'Riverside High');
    routes['PUT /branding/name'] = () => [200, branded()];
    save().click(); await settle();
    expect(posts('/branding/name').map((c) => c.body)).toEqual([{ name: 'Riverside High' }]);
  });
});

describe('the Edit logo and Edit tab icon dialogs (D2, D4-D6)', () => {
  const answerWithLogo = () => {
    const b = base();
    b.logo = { width: 838, height: 174 };
    b.public.logo = { version: 'b'.repeat(16), width: 838, height: 174 };
    return b;
  };

  it("the logo dialog shows the saved logo's two sizes, a Choose button, the hint, and no Reset for the default", async () => {
    await render();
    await open('Logo');
    expect(panel()!.querySelector('h2')?.textContent).toBe('Edit logo');
    expect([...panel()!.querySelectorAll('.im-label')].map((l) => l.textContent)).toEqual(['In the header', 'On the sign-in page']);
    expect(panel()!.querySelectorAll('.im-box svg.logo')).toHaveLength(2);
    expect([...panel()!.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Choose a PNG…')).toBe(true);
    expect(panel()!.querySelector('.im-hint')?.textContent).toBe(
      "One PNG with your logo and name, at least 56 px tall so it stays sharp, also on the sign-in page. It's scaled to fit and never stretched. Up to 1 MB.");
    expect(panel()!.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe('image/png');
    expect(footButton('Reset to default')).toBeUndefined();
    expect(blocked()).toBe(true);
  });

  it('a chosen file is read once, previews after it decodes, and Save sends those same bytes', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    await render();
    await open('Logo');
    const bytes = pngOf(838, 174);
    await choose(bytes);
    expect(read).toHaveBeenCalledTimes(1);
    expect(panel()!.querySelector('.im-file')?.textContent).toBe('school.png, 838 × 174 px');
    // Save waits for the decode.
    expect(blocked()).toBe(true);
    expect(previews().some((s) => s.startsWith('data:'))).toBe(false);
    expect(decodes).toHaveLength(1);
    decodes[0].resolve(); await settle();
    expect(previews().filter((s) => s.startsWith('data:image/png;base64,'))).toHaveLength(2);
    expect(blocked()).toBe(false);

    routes['POST /branding/logo'] = () => [200, answerWithLogo()];
    save().click(); await settle(); await tick();
    const sent = posts('/branding/logo');
    expect(sent).toHaveLength(1);
    // Save read nothing again (the check below reads the sent part itself).
    expect(read).toHaveBeenCalledTimes(1);
    const part = (sent[0].body as FormData).get('file') as File;
    expect(part.name).toBe('school.png');
    expect(await partBytes(part)).toEqual([...bytes]);
    expect(panel()).toBeNull();
    expect(rows(card('Logo'))['In the header'].querySelector('.b-note')?.textContent).toBe('your upload, 838 × 174 px');
    // D14: the store follows the answer's public branding.
    expect(branding.logo).toEqual({ version: 'b'.repeat(16), width: 838, height: 174 });
  });

  it('advice shows under the file and never blocks Save', async () => {
    await render();
    await open('Logo');
    await choose(pngOf(64, 16));
    decodes[0].resolve(); await settle();
    expect([...panel()!.querySelectorAll('.im-advice li')].map((l) => l.textContent)).toEqual([
      'This logo is 16 px tall, so it may look soft (56 px or more recommended).',
    ]);
    expect(blocked()).toBe(false);
  });

  it('a refused file never previews, shows its sentence, and drops every pending change', async () => {
    await render(branded());
    await open('Logo');
    await choose(pngOf(838, 174));
    decodes[0].resolve(); await settle();
    expect(blocked()).toBe(false);
    await choose(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'evil.svg');
    expect(panel()!.querySelector('[role="alert"]')?.textContent).toBe('The logo must be a PNG file.');
    expect(previews().some((s) => s.startsWith('data:'))).toBe(false);
    // The preview is the saved logo again, and Save is blocked.
    expect(previews()).toEqual([`/api/branding/logo.png?v=${LOGO_V}`, `/api/branding/logo.png?v=${LOGO_V}`]);
    expect(blocked()).toBe(true);
    expect(decodes).toHaveLength(1);

    // A pending Reset is dropped too.
    footButton('Reset to default')!.click(); await settle();
    expect(blocked()).toBe(false);
    await choose(pngOf(5000, 10));
    expect(panel()!.querySelector('[role="alert"]')?.textContent).toBe(
      'The logo can be at most 4096 px on a side and 4 million pixels in all.');
    expect(blocked()).toBe(true);
    expect(previews()).toEqual([`/api/branding/logo.png?v=${LOGO_V}`, `/api/branding/logo.png?v=${LOGO_V}`]);
  });

  it("a file that won't decode is refused: \"This PNG can't be shown by a browser.\"", async () => {
    await render();
    await open('Logo');
    await choose(pngOf(838, 174));
    decodes[0].reject(); await settle();
    expect(panel()!.querySelector('[role="alert"]')?.textContent).toBe("This PNG can't be shown by a browser.");
    expect(previews().some((s) => s.startsWith('data:'))).toBe(false);
    expect(blocked()).toBe(true);
  });

  it("a decode answer for an earlier choice is ignored", async () => {
    await render();
    await open('Logo');
    await choose(pngOf(838, 174), 'first.png');
    await choose(pngOf(400, 100), 'second.png');
    expect(decodes).toHaveLength(2);
    decodes[1].resolve(); await settle();
    expect(blocked()).toBe(false);
    decodes[0].reject(); await settle();
    expect(panel()!.querySelector('[role="alert"]')).toBeNull();
    expect(panel()!.querySelector('.im-file')?.textContent).toBe('second.png, 400 × 100 px');
    expect(blocked()).toBe(false);
  });

  it('a decode still running when Reset is pressed is ignored', async () => {
    await render(branded());
    await open('Logo');
    await choose(pngOf(838, 174));
    footButton('Reset to default')!.click(); await settle();
    decodes[0].resolve(); await settle();
    // Reset stays the pending change: the preview is the default lockup.
    expect(previews()).toEqual([]);
    expect(panel()!.querySelectorAll('.im-box svg.logo')).toHaveLength(2);
    decodes[0].reject(); await settle();
    expect(panel()!.querySelector('[role="alert"]')).toBeNull();
  });

  it('Reset shows the default, moves focus to Save, and Save sends reset', async () => {
    await render(branded());
    await open('Logo');
    footButton('Reset to default')!.click(); await settle();
    expect(document.activeElement).toBe(save());
    expect(panel()!.querySelectorAll('.im-box svg.logo')).toHaveLength(2);
    routes['POST /branding/logo'] = () => [200, base()];
    save().click(); await settle();
    expect([...(posts('/branding/logo')[0].body as FormData).entries()]).toEqual([['reset', 'true']]);
    expect(rows(card('Logo'))['In the header'].querySelector('.b-note')?.textContent).toBe('default');
    expect(branding.logo).toBeNull();
  });

  it("a proxy's bare 413 says the server's upload limit; the server's 422 shows its own sentence", async () => {
    await render();
    await open('Logo');
    await choose(pngOf(838, 174));
    decodes[0].resolve(); await settle();
    routes['POST /branding/logo'] = () => new Response('<html>Request Entity Too Large</html>', { status: 413, headers: { 'content-type': 'text/html' } });
    save().click(); await settle(); await tick();
    expect(panel()!.querySelector('[role="alert"]')?.textContent).toBe("This file is over the server's upload limit.");
    routes['POST /branding/logo'] = () => [422, { detail: 'The logo must be a PNG file.' }];
    save().click(); await settle(); await tick();
    expect(panel()!.querySelector('[role="alert"]')?.textContent).toBe('The logo must be a PNG file.');
  });

  it('the tab icon dialog: 32 px and 16 px on a light and a dark strip, its own hint, advice and caps', async () => {
    await render();
    await open('Tab icon');
    expect(panel()!.querySelector('h2')?.textContent).toBe('Edit tab icon');
    const strips = [...panel()!.querySelectorAll<HTMLElement>('.im-strip')];
    expect(strips.map((s) => s.classList.contains('dark'))).toEqual([false, true]);
    for (const s of strips) {
      expect([...s.querySelectorAll('img')].map((i) => [i.getAttribute('src'), i.getAttribute('width')])).toEqual([
        ['/api/branding/icon-default.svg', '32'], ['/api/branding/icon-default.svg', '16'],
      ]);
    }
    expect(panel()!.querySelector('.im-hint')?.textContent).toBe(
      'A square PNG, at least 180 px on a side, so it stays sharp in tabs and on phones. Up to 1 MB.');
    await choose(pngOf(1025, 1025), 'big.png');
    expect(panel()!.querySelector('[role="alert"]')?.textContent).toBe('The tab icon can be at most 1024 px on a side.');
    await choose(pngOf(16, 16), 'tiny.png');
    decodes[0].resolve(); await settle();
    expect([...panel()!.querySelectorAll('.im-advice li')].map((l) => l.textContent)).toEqual([
      'This icon is 16 px, so it may look soft in tabs and on phones (180 px or more recommended).',
    ]);
    const answer = base();
    answer.icon = { width: 16, height: 16 };
    answer.public.icon = 'e'.repeat(16);
    routes['POST /branding/icon'] = () => [200, answer];
    save().click(); await settle();
    expect(rows(card('Tab icon'))['Icon'].querySelector('.b-note')?.textContent).toBe('your upload');
    // D14: the panel's own tab icon follows at once.
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe(`/api/branding/icon.png?v=${'e'.repeat(16)}`);
  });
});
