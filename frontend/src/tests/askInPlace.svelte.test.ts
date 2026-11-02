import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { InPlaceAsk, PageAsk, focusIsFree, usable, refused, settleTo, moveOn, withdraw, firstUsable, canHoldFocus, repairFocus, DISCARD_ASK, type Answer, type Ask, type AskHost } from '../lib/askInPlace.svelte';
import { DISCARD, DISCARD_CONTINUE } from '../lib/editorReasons';

const Q = (over: Partial<Ask> = {}): Ask =>
  ({ warning: 'Delete it?', confirmLabel: 'Delete', tone: 'danger', confirmDataAction: 'confirm-x', ...over }) as Ask;
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

// A hand-made host: what <AskSlot> draws, enough for focus and answer().
let host: HTMLDivElement;
function drawn(a: InPlaceAsk) {
  host.innerHTML = '<div class="inline-confirm"><button class="confirm">Delete</button><button class="cancel">Cancel</button></div>';
  a.host = host;
  return { confirm: host.querySelector<HTMLButtonElement>('button.confirm')!, cancel: host.querySelector<HTMLButtonElement>('button.cancel')! };
}
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
afterEach(() => { host.remove(); (document.activeElement as HTMLElement | null)?.blur?.(); });

describe('editorReasons — the two discard texts (R51)', () => {
  it('navigation asks "…and continue?", a close asks without it', () => {
    expect(DISCARD_CONTINUE).toBe('Discard unsaved changes and continue?');
    expect(DISCARD).toBe('Discard unsaved changes?');
    expect(DISCARD_ASK).toMatchObject({ warning: DISCARD, confirmLabel: 'Discard', tone: 'danger', layout: 'row' });
  });
});

describe('InPlaceAsk — answers (R56) and busy (R54)', () => {
  it('Cancel resolves "cancel" and closes', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    expect(a.open).toBe(true);
    a.answer('cancel');
    expect(await p).toBe('cancel');
    expect(a.open).toBe(false);
  });

  it('confirm resolves "confirm", stays open and busy, and moves focus to the confirm; settle() closes it', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    const { confirm } = drawn(a);
    a.answer('confirm');
    expect(await p).toBe('confirm');
    expect(a.open).toBe(true);
    expect(a.busy).toBe(true);
    expect(document.activeElement).toBe(confirm);
    a.answer('cancel');                       // busy: nothing answers twice
    expect(a.open).toBe(true);
    a.settle();
    expect(a.open).toBe(false);
    expect(a.busy).toBe(false);
  });

  it('settle() on an idle or closed question does nothing; dismiss() on a closed one does nothing', async () => {
    const a = new InPlaceAsk();
    a.settle();
    a.dismiss();
    const p = a.ask(Q());
    a.settle();                               // not confirmed: still open
    expect(a.open).toBe(true);
    a.dismiss();
    expect(await p).toBe('dismissed');
    a.dismiss();
    expect(a.open).toBe(false);
  });

  it('dismiss() closes a busy question too', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    a.answer('confirm');
    await p;
    a.dismiss();
    expect(a.open).toBe(false);
    expect(a.busy).toBe(false);
  });
});

describe('InPlaceAsk — a newcomer (R53)', () => {
  it('a place without keys: the newcomer is dismissed at once and focus goes back to the open Cancel', async () => {
    const a = new InPlaceAsk();
    const first = a.ask(Q());
    const { cancel } = drawn(a);
    const second = await a.ask(Q({ warning: 'Other?' }));
    expect(second).toBe('dismissed');
    expect(document.activeElement).toBe(cancel);
    expect(a.current!.warning).toBe('Delete it?');
    a.answer('cancel');
    expect(await first).toBe('cancel');
  });

  it('the same key: dismissed, the open one kept', async () => {
    const a = new InPlaceAsk();
    void a.ask(Q({ key: 'block-1' }));
    drawn(a);
    expect(await a.ask(Q({ key: 'block-1', warning: 'Again?' }))).toBe('dismissed');
    expect(a.current!.key).toBe('block-1');
    expect(a.current!.warning).toBe('Delete it?');
  });

  it('another key replaces the open question, which resolves "dismissed" (D39)', async () => {
    const a = new InPlaceAsk();
    const first = a.ask(Q({ key: 'block-1' }));
    const second = a.ask(Q({ key: 'seq-2' }));
    expect(await first).toBe('dismissed');
    expect(a.current!.key).toBe('seq-2');
    a.answer('cancel');
    expect(await second).toBe('cancel');
  });

  it('while busy every newcomer is dismissed and focus stays on the busy confirm', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q({ key: 'block-1' }));
    const { confirm } = drawn(a);
    a.answer('confirm');
    await p;
    expect(await a.ask(Q({ key: 'seq-2' }))).toBe('dismissed');
    expect(await a.ask(Q({ key: 'block-1' }))).toBe('dismissed');
    expect(a.current!.key).toBe('block-1');
    expect(document.activeElement).toBe(confirm);
  });
});

describe('focus helpers (R57, §Focus)', () => {
  it('focusIsFree: nowhere, <body>, or inside the question', () => {
    const a = new InPlaceAsk();
    void a.ask(Q());
    const { cancel } = drawn(a);
    expect(focusIsFree(host)).toBe(true);
    cancel.focus();
    expect(focusIsFree(host)).toBe(true);
    expect(a.focusFree).toBe(true);
    const out = document.createElement('button');
    document.body.appendChild(out);
    out.focus();
    expect(focusIsFree(host)).toBe(false);
    expect(a.focusFree).toBe(false);
    out.remove();
  });

  it('usable: connected, enabled, not aria-disabled, not inert', () => {
    const b = document.createElement('button');
    expect(usable(b)).toBe(false);
    host.appendChild(b);
    expect(usable(b)).toBe(true);
    b.disabled = true;
    expect(usable(b)).toBe(false);
    b.disabled = false;
    b.setAttribute('aria-disabled', 'true');
    expect(usable(b)).toBe(false);
    b.removeAttribute('aria-disabled');
    host.toggleAttribute('inert', true);
    expect(usable(b)).toBe(false);
    expect(usable(null)).toBe(false);
  });

  it('focusCancel does nothing while busy', async () => {
    const a = new InPlaceAsk();
    const p = a.ask(Q());
    const { confirm } = drawn(a);
    a.answer('confirm');
    await p;
    a.focusCancel();
    expect(document.activeElement).toBe(confirm);
  });
});

describe('PageAsk — the host stack and the guard (R46, R53)', () => {
  const entry = (own: InPlaceAsk, close: HTMLElement | null = null): AskHost =>
    ({ ownOpen: () => own.open, focusOwnCancel: () => own.focusCancel(), closeEl: () => close });

  it('the top is the last registered host; removal is by identity', () => {
    const page = new PageAsk();
    const a = entry(new InPlaceAsk());
    const b = entry(new InPlaceAsk());
    const offA = page.register(a);
    const offB = page.register(b);
    expect(page.top).toBe(b);
    offA();
    expect(page.top).toBe(b);
    offB();
    expect(page.top).toBeNull();
  });

  it('guard: asks with the navigation text; Discard resolves true and closes at once', async () => {
    const page = new PageAsk();
    const g = page.guard();
    expect(page.ask.current!.warning).toBe(DISCARD_CONTINUE);
    expect(page.ask.current!.confirmLabel).toBe('Discard');
    page.ask.answer('confirm');
    expect(await g.promise).toBe(true);
    expect(page.ask.open).toBe(false);
  });

  it('guard: Cancel at a modal host resolves false and focuses that host\'s ×', async () => {
    const page = new PageAsk();
    const x = document.createElement('button');
    host.appendChild(x);
    page.register(entry(new InPlaceAsk(), x));
    const seen: Array<[Answer, AskHost | null]> = [];
    const g = page.guard((a, h) => { seen.push([a, h]); });
    page.ask.answer('cancel');
    expect(await g.promise).toBe(false);
    flushSync();
    expect(document.activeElement).toBe(x);
    expect(seen).toEqual([['cancel', page.top]]);
  });

  it('guard: Cancel at a host whose × is disabled (it is saving) focuses that host\'s panel, never <body>', async () => {
    const page = new PageAsk();
    const panel = document.createElement('section');
    panel.className = 'modal-panel';
    panel.tabIndex = -1;
    const x = document.createElement('button');
    x.disabled = true;
    panel.appendChild(x);
    host.appendChild(panel);
    page.register(entry(new InPlaceAsk(), x));
    const g = page.guard();
    page.ask.answer('cancel');
    expect(await g.promise).toBe(false);
    flushSync();
    expect(document.activeElement).toBe(panel);
  });

  it('guard: refused while the top host\'s own question is open — false, focus on that Cancel, no page question', async () => {
    const page = new PageAsk();
    const own = new InPlaceAsk();
    page.register(entry(own));
    void own.ask(Q());
    const { cancel } = drawn(own);
    const seen: Answer[] = [];
    const g = page.guard((a) => { seen.push(a); });
    expect(await g.promise).toBe(false);
    expect(page.ask.open).toBe(false);
    expect(document.activeElement).toBe(cancel);
    expect(seen).toEqual(['dismissed']);
  });

  it('refused() resolves false and its dismiss / focusCancel do nothing', async () => {
    const r = refused();
    r.dismiss();
    r.focusCancel();
    expect(await r.promise).toBe(false);
    await flush();
  });
});

describe('settleTo / moveOn / withdraw (Task 3, R54, R57, R49)', () => {
  async function confirmed(a: InPlaceAsk, q: Ask) {
    const p = a.ask(q);
    const b = drawn(a);
    a.answer('confirm');
    await p;
    return b;
  }
  let t: HTMLButtonElement;
  beforeEach(() => { t = document.createElement('button'); document.body.appendChild(t); });
  afterEach(() => { t.remove(); });

  it('settleTo closes the busy question and focuses the target when focus was in it', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    expect(await settleTo(a, q, () => t)).toBe(t);
    expect(a.open).toBe(false);
    expect(document.activeElement).toBe(t);
  });

  it('settleTo still closes, but leaves focus the person moved (R57)', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    const away = document.createElement('input');
    document.body.appendChild(away);
    away.focus();
    expect(await settleTo(a, q, () => t)).toBeNull();
    expect(a.open).toBe(false);
    expect(document.activeElement).toBe(away);
    away.remove();
  });

  it('settleTo leaves another question and a dismissed one alone', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    a.dismiss();
    expect(await settleTo(a, q, () => t)).toBeNull();
    const other = Q({ warning: 'Other?' });
    await confirmed(a, other);
    expect(await settleTo(a, q, () => t)).toBeNull();
    expect(a.current).toBe(other);
    expect(a.busy).toBe(true);
  });

  it('moveOn moves only from the interim element or <body>; firstUsable skips a disabled one', async () => {
    const final = document.createElement('button');
    document.body.appendChild(final);
    t.focus();
    await moveOn(t, () => final);
    expect(document.activeElement).toBe(final);
    const away = document.createElement('input');
    document.body.appendChild(away);
    away.focus();
    await moveOn(t, () => final);
    expect(document.activeElement).toBe(away);
    final.disabled = true;
    expect(firstUsable(null, final, t)).toBe(t);
    final.remove();
    away.remove();
  });

  it('withdraw dismisses its own question and follows focus out of it; another question stays', async () => {
    const a = new InPlaceAsk();
    const q = Q();
    await confirmed(a, q);
    withdraw(a, Q(), () => t);
    expect(a.open).toBe(true);
    withdraw(a, q, () => t);
    expect(a.open).toBe(false);
    host.innerHTML = '';                       // the slot unmounts
    await flush();
    expect(document.activeElement).toBe(t);
  });
});

describe('repairFocus and canHoldFocus (C7 point 3)', () => {
  let box: HTMLDivElement;
  beforeEach(() => { box = document.createElement('div'); document.body.appendChild(box); });
  afterEach(() => { box.remove(); });
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, parent: Element = box): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e;
  }

  it('canHoldFocus accepts aria-disabled and rejects disabled, disconnected and inert', () => {
    expect(canHoldFocus(el('button', { 'aria-disabled': 'true' }))).toBe(true);
    expect(canHoldFocus(el('button', { disabled: '' }))).toBe(false);
    expect(canHoldFocus(document.createElement('button'))).toBe(false);
    const frozen = el('div', { inert: '' });
    expect(canHoldFocus(el('button', {}, frozen))).toBe(false);
    expect(canHoldFocus(null)).toBe(false);
    expect(canHoldFocus(undefined)).toBe(false);
  });

  it('repairFocus focuses the first holder when focus is on body', async () => {
    const off = el('button', { disabled: '' });
    const blocked = el('button', { 'aria-disabled': 'true' });
    const next = el('button');
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(await repairFocus(null, off, blocked, next)).toBe(true);
    expect(document.activeElement).toBe(blocked);
  });

  it('repairFocus acts when focus is on the modal panel', async () => {
    const panel = el('section', { class: 'modal-panel', tabindex: '-1' });
    const save = el('button', {}, panel);
    panel.focus();
    expect(document.activeElement).toBe(panel);
    expect(await repairFocus(save)).toBe(true);
    expect(document.activeElement).toBe(save);
  });

  it('repairFocus never moves focus the user put elsewhere', async () => {
    const save = el('button');
    const field = el('input');
    (document.activeElement as HTMLElement | null)?.blur?.();
    const p = repairFocus(save);
    field.focus();                            // during the tick repairFocus awaits
    expect(await p).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it('repairFocus skips a target whose focus() does not take', async () => {
    const h2 = el('h2');                       // no tabindex: focus() is ignored
    const ok = el('button');
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(await repairFocus(h2, ok)).toBe(true);
    expect(document.activeElement).toBe(ok);
    ok.blur();
    expect(await repairFocus(h2)).toBe(false);
  });

  // r1 Fable M2: focus on a modal panel is that modal's to repair.
  it('repairFocus on a panel skips chain elements outside that panel', async () => {
    const panel = el('section', { class: 'modal-panel', tabindex: '-1' });
    const inside = el('button', {}, panel);
    const outside = el('button');
    panel.focus();
    expect(await repairFocus(outside)).toBe(false);
    expect(document.activeElement).toBe(panel);
    expect(await repairFocus(outside, inside)).toBe(true);
    expect(document.activeElement).toBe(inside);
  });
});
