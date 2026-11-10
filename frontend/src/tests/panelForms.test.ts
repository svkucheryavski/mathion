import { it, expect, beforeEach, afterEach, describe } from 'vitest';
import { crc32 } from '../lib/pngCheck';
import { EmailForm } from '../lib/panelForms/emailForm.svelte';
import { SiteNameForm } from '../lib/panelForms/siteNameForm.svelte';
import { LogoPick } from '../lib/panelForms/logoPick.svelte';
import { CourseForm } from '../lib/panelForms/courseForm.svelte';
import { SignInForm } from '../lib/panelForms/signInForm.svelte';
import { LimitsForm } from '../lib/panelForms/limitsForm.svelte';
import type { PanelEmailSettings } from '../lib/superuser';

// Set up §6: the six panel forms, shared by the Settings, Branding and Courses
// dialogs and the Set up steps. Each keeps the dialog's behaviour.

const EMAIL: PanelEmailSettings = {
  on: true, host: 'mail.uni.dk', port: 587, encryption: 'starttls', skip_cert_check: false,
  username: 'u@uni.dk', password_saved: true, password_unreadable: false, from_address: 'noreply@uni.dk',
  dev_mode: null, card_test: null, failing: null,
};
const SIGN_IN = { pin_minutes: 10, pin_requests_per_hour: 3, pin_failures_per_hour: 5, longest_sign_in_days: 30 };

describe('EmailForm (Settings D7-D9)', () => {
  it('off sends the switch alone (D7c)', () => {
    const f = new EmailForm(EMAIL);
    expect(f.ready).toBe(false);
    f.on = false;
    f.host = 'changed.example';
    expect(f.ready).toBe(true);
    expect(f.saveBody()).toEqual({ on: false });
  });

  it('a port that is not a number is the server sentence, for a save and a test', () => {
    const f = new EmailForm(EMAIL);
    f.port = '58x';
    expect(f.saveBody()).toBe('The port must be from 1 to 65535.');
    expect(f.testBody()).toBe('The port must be from 1 to 65535.');
  });

  it('sends the password only when typed, and the fields trimmed', () => {
    const f = new EmailForm(EMAIL);
    f.host = ' mail2.uni.dk ';
    expect(f.saveBody()).toEqual({
      on: true, host: 'mail2.uni.dk', port: 587, encryption: 'starttls', skip_cert_check: false,
      username: 'u@uni.dk', from_address: 'noreply@uni.dk',
    });
    f.password = 'pw';
    expect(f.testBody()).toMatchObject({ password: 'pw' });
  });

  it('changed follows the fields; picking an encryption sets the usual port', () => {
    const f = new EmailForm(EMAIL);
    expect(f.changed).toBe(false);
    f.encryption = 'ssl';
    f.pickEncryption('ssl');
    expect(f.port).toBe('465');
    expect(f.changed).toBe(true);
  });

  it('an edit clears the error and the test answer and counts', () => {
    const f = new EmailForm(EMAIL);
    f.error = 'x';
    f.result = { ok: true, message: 'Sent.' };
    const before = f.edits;
    f.edited();
    expect([f.error, f.result, f.edits]).toEqual([null, null, before + 1]);
  });
});

describe('SiteNameForm (Branding D2, D3)', () => {
  it('sends the typed name, or reset after Reset to default', () => {
    const f = new SiteNameForm('Riverside');
    expect(f.changed).toBe(false);
    f.value = 'Lund';
    expect([f.changed, f.body()]).toEqual([true, { name: 'Lund' }]);
    f.resetToDefault();
    expect([f.value, f.body()]).toEqual(['Mathion', { reset: true }]);
    f.edited();
    expect(f.body()).toEqual({ name: 'Mathion' });
  });
});

describe('SignInForm and LimitsForm (Settings D11, D12)', () => {
  it('a value that is not a whole number is refused', () => {
    const f = new SignInForm(SIGN_IN);
    expect(f.changed).toBe(false);
    f.minutes = '1.5';
    expect(f.changed).toBe(true);
    expect(f.body()).toBe('Type a whole number.');
    f.minutes = ' 15 ';
    f.days = 7;
    expect(f.body()).toEqual({ ...SIGN_IN, pin_minutes: 15, longest_sign_in_days: 7 });
  });

  it('the limits keep their own sentence', () => {
    const f = new LimitsForm({ max_file_mb: 20, max_total_mb: 500 });
    expect(f.body()).toEqual({ max_file_mb: 20, max_total_mb: 500 });
    f.total = 'lots';
    expect(f.body()).toBe('Type a whole number of MB.');
  });
});

describe('CourseForm (Users/Courses D8, D13)', () => {
  it('the address follows the name until edited', () => {
    const f = new CourseForm();
    expect(f.ready).toBe(false);
    f.name = 'Lineær Algebra';
    f.onName();
    expect(f.slug).toBe('lineaer-algebra');
    f.slug = 'la';
    f.onSlug();
    f.name = 'Statistics';
    f.onName();
    expect(f.slug).toBe('la');
    f.email = ' ann@uni.dk ';
    expect(f.ready).toBe(true);
    expect(f.body()).toEqual({ name: 'Statistics', slug: 'la', admin_email: 'ann@uni.dk' });
  });
});

// A real PNG of the given size (the check reads only the header and the CRCs).
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(kind: string, data: number[]) {
  const k = [...kind].map((c) => c.charCodeAt(0));
  return [...u32(data.length), ...k, ...data, ...u32(crc32(new Uint8Array([...k, ...data])))];
}
function pngFile(width: number, height: number, name: string): File {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...chunk('IDAT', [0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1]),
    ...chunk('IEND', []),
  ]);
  return new File([bytes], name, { type: 'image/png' });
}

describe('LogoPick (Branding D4-D6)', () => {
  let decodes: { resolve: () => void; reject: () => void }[];
  beforeEach(() => {
    decodes = [];
    (HTMLImageElement.prototype as { decode?: () => Promise<void> }).decode = function () {
      return new Promise<void>((resolve, reject) => decodes.push({ resolve, reject: () => reject(new Error('x')) }));
    };
  });
  afterEach(() => { delete (HTMLImageElement.prototype as { decode?: unknown }).decode; });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

  it('of two quick choices, the last one wins', async () => {
    const p = new LogoPick('logo');
    const first = p.choose(pngFile(838, 174, 'first.png'));
    const second = p.choose(pngFile(400, 100, 'second.png'));
    await Promise.all([first, second]);
    expect(decodes).toHaveLength(1);
    expect(p.ready).toBe(false);   // Save waits for the decode
    decodes[0].resolve(); await settle();
    expect(p.ready).toBe(true);
    expect(p.pending?.kind === 'file' && p.pending.file.name).toBe('second.png');
    expect(p.shown).toMatchObject({ width: 400, height: 100 });
    expect(p.error).toBeNull();
  });

  it('a refused file drops the choice and says why; Reset is a pending change', async () => {
    const p = new LogoPick('icon', { width: 512, height: 512, version: 'v' });
    expect(p.shown?.src).toBe('/api/branding/icon.png?v=v');
    await p.choose(new File([new TextEncoder().encode('<svg/>')], 'x.svg'));
    expect([p.pending, p.error]).toEqual([null, 'The tab icon must be a PNG file.']);
    p.reset();
    expect([p.ready, p.shown, p.error]).toEqual([true, null, null]);
  });
});
