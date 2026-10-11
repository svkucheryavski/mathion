import { describe, it, expect, afterEach } from 'vitest';
import { focusFirst } from '../lib/focusFirst';

afterEach(() => { document.body.innerHTML = ''; });

function btn(attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = document.createElement('button');
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  document.body.appendChild(b);
  return b;
}

describe('focusFirst (spec §Focus order)', () => {
  it('skips null, disconnected, disabled and aria-disabled candidates', () => {
    const gone = document.createElement('button');            // never connected
    const off = btn({ disabled: '' });
    const ariaOff = btn({ 'aria-disabled': 'true' });
    const ok = btn();
    expect(focusFirst([null, undefined, gone, off, ariaOff, ok])).toBe(true);
    expect(document.activeElement).toBe(ok);
  });
  it('focuses an h2 with tabindex=-1 as the last resort', () => {
    const h2 = document.createElement('h2');
    h2.tabIndex = -1;
    document.body.appendChild(h2);
    expect(focusFirst([btn({ disabled: '' }), h2])).toBe(true);
    expect(document.activeElement).toBe(h2);
  });
  it('moves on when the browser refuses focus (an h2 without tabindex)', () => {
    const h2 = document.createElement('h2');
    document.body.appendChild(h2);
    const ok = btn();
    expect(focusFirst([h2, ok])).toBe(true);
    expect(document.activeElement).toBe(ok);
  });
  it('returns false when nothing can take focus', () => {
    expect(focusFirst([null, btn({ disabled: '' })])).toBe(false);
  });
});
