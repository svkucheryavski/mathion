// Polish 1 (spec §Ask in place): a question in place of the browser's confirm dialog.
// A host owns an InPlaceAsk and draws it with <AskSlot> where the question
// belongs; the site awaits ask() and acts only on 'confirm'.
import { getContext, setContext, tick, untrack, type Snippet } from 'svelte';
import { currentRoute } from './router.svelte';
import { DISCARD, DISCARD_CONTINUE } from './editorReasons';

/** R56: Cancel and a dismissal are different answers. */
export type Answer = 'confirm' | 'cancel' | 'dismissed';

type AskBase = {
  label?: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  layout?: 'row' | 'column';
  align?: 'start' | 'end';     // 'end': under a row, under its actions (D42)
  confirmDataAction: string;   // test hook, e.g. 'confirm-delete-block'
  key?: string | number;       // which row of a list asks (R53)
};
/** Field names match InlineConfirm's props; `warning` and `message` exclude each other (P62). */
export type Ask = AskBase & (
  | { warning: string | (() => string); message?: undefined }   // a getter keeps unsavedSuffix current
  | { message: Snippet; warning?: undefined }
);

/** What DirtyGuard holds of an owner's navigation question (R55). */
export type GuardAsk = { promise: Promise<boolean>; dismiss: () => void; focusCancel: () => void };

/** A guard call refused at once (R53): the navigation is cancelled, nothing to withdraw. */
export function refused(): GuardAsk {
  return { promise: Promise.resolve(false), dismiss: () => {}, focusCancel: () => {} };
}

/** A dirty modal's ×, Esc or Cancel (#7, #10, #11, #13, #15). */
export const DISCARD_ASK: Ask = {
  warning: DISCARD, confirmLabel: 'Discard', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-discard',
};
/** Every navigation question (D37). */
export const DISCARD_NAV_ASK: Ask = {
  warning: DISCARD_CONTINUE, confirmLabel: 'Discard', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-discard',
};

/** R57: focus is nowhere, on <body>, or inside `within`. */
export function focusIsFree(within?: Element | null): boolean {
  const a = document.activeElement;
  return !a || a === document.body || (!!within && within.contains(a));
}

/** §Focus: a target counts only if connected, enabled (natively and by aria) and not inert. */
export function usable(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected
    && !(el as HTMLButtonElement).disabled
    && el.getAttribute('aria-disabled') !== 'true'
    && !el.closest('[inert]');
}

/** After an answer: wait for the re-render, then focus the target if R57 allows and it counts. */
export async function focusAfter(target: () => Element | null | undefined): Promise<void> {
  await tick();
  if (!focusIsFree()) return;
  const t = target();
  if (usable(t)) t.focus();
}

/** §Focus: the first target in a site's chain that counts. */
export function firstUsable(...els: (Element | null | undefined)[]): HTMLElement | null {
  for (const el of els) if (usable(el)) return el;
  return null;
}

/** The modal panel whose heading has id `labelId`, and its ×. */
export function modalPanel(labelId: string): HTMLElement | null {
  return document.getElementById(labelId)?.closest<HTMLElement>('section.modal-panel') ?? null;
}
export function modalClose(labelId: string): HTMLElement | null {
  return modalPanel(labelId)?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]') ?? null;
}

export class InPlaceAsk {
  current = $state.raw<Ask | null>(null);
  busy = $state(false);
  /** Set by <AskSlot> while it draws this question. */
  host: HTMLElement | null = null;
  #resolve: ((a: Answer) => void) | null = null;

  get open(): boolean { return this.current !== null; }
  /** R57 for this question: focus is nowhere, on <body>, or inside it. */
  get focusFree(): boolean { return focusIsFree(this.host); }

  ask(q: Ask): Promise<Answer> {
    const open = this.current;
    if (open) {
      // R53: while busy every newcomer is dismissed quietly. The same key, or
      // a place without keys, brings the open question back. Another row's key
      // replaces it; the newcomer's takeFocus moves focus (D39).
      if (this.busy) return Promise.resolve('dismissed');
      if (open.key === undefined || q.key === undefined || open.key === q.key) {
        this.focusCancel();
        return Promise.resolve('dismissed');
      }
      this.#finish('dismissed');
    }
    this.current = q;
    return new Promise<Answer>((r) => { this.#resolve = r; });
  }

  answer(a: 'confirm' | 'cancel'): void {
    if (!this.current || this.busy) return;
    if (a === 'cancel') { this.#finish('cancel'); return; }
    // R54: the question stays, busy, until the site settles it. Safari leaves
    // a clicked button unfocused, so the busy confirm takes focus here.
    this.busy = true;
    this.host?.querySelector<HTMLElement>('.inline-confirm button.confirm')?.focus();
    const r = this.#resolve;
    this.#resolve = null;
    r?.('confirm');
  }

  /** Closes a confirmed question once its action settles (R54); otherwise does nothing. */
  settle(): void {
    if (this.current && this.busy) { this.current = null; this.busy = false; }
  }

  /** Withdraws the question (R49, R55, unmount): resolves 'dismissed'; nothing when closed. */
  dismiss(): void {
    if (this.current) this.#finish('dismissed');
  }

  /** Brings the open question back: its Cancel, scrolled into view. Not while busy (R53). */
  focusCancel(): void {
    if (!this.current || this.busy) return;
    const cancel = this.host?.querySelector<HTMLElement>('.inline-confirm button.cancel');
    cancel?.closest('.inline-confirm')?.scrollIntoView?.({ block: 'nearest' });
    cancel?.focus();
  }

  #finish(a: Answer): void {
    const r = this.#resolve;
    this.#resolve = null;
    this.current = null;
    this.busy = false;
    r?.(a);
  }
}

/** A modal that can draw the page question (R46). */
export type AskHost = {
  ownOpen(): boolean;        // its own question is open (R53)
  focusOwnCancel(): void;
  closeEl(): Element | null; // where Cancel on the page question drawn here sends focus: its ×
};

export const PAGE_ASK_KEY = Symbol('pageAsk');

/** VersionEditPage's one navigation question and the modals that can draw it (D38, R46). */
export class PageAsk {
  readonly ask = new InPlaceAsk();
  hosts = $state.raw<AskHost[]>([]);

  /** The top-most host, or null: then the row under the title draws the question. */
  get top(): AskHost | null { return this.hosts[this.hosts.length - 1] ?? null; }

  /** Added on mount, removed by identity (ItemEditorModal is keyed, so never pop()). */
  register(h: AskHost): () => void {
    this.hosts = [...this.hosts, h];
    return () => { this.hosts = this.hosts.filter((x) => x !== h); };
  }

  /** DirtyGuard's `ask`. Refused while the top host's own question is open (R53).
   *  `after` runs once with the answer and the host that drew the question
   *  (null: the page row); a refusal reports 'dismissed'. */
  guard(after: (a: Answer, host: AskHost | null) => void = () => {}): GuardAsk {
    const top = this.top;
    if (top?.ownOpen()) {
      top.focusOwnCancel();   // nothing while that question is busy (R53)
      after('dismissed', top);
      return refused();
    }
    const promise = this.ask.ask(DISCARD_NAV_ASK).then(async (a) => {
      const host = this.top;
      if (a === 'confirm') this.ask.settle();   // Discard has no request (R54)
      // Cancel: the host's ×, or its panel while × is disabled (it is saving).
      if (a === 'cancel' && host) {
        await focusAfter(() => {
          const x = host.closeEl();
          return usable(x) ? x : x?.closest<HTMLElement>('section.modal-panel');
        });
      }
      after(a, host);
      return a === 'confirm';
    });
    return { promise, dismiss: () => this.ask.dismiss(), focusCancel: () => this.ask.focusCancel() };
  }
}

/** A modal that asks: its own question (`own`: footer or body-top), and the page
 *  question while it is the top host (`here()`). Call during component init:
 *  it registers on mount and dismisses its own question on unmount. */
export function useModalAsk(labelId: string): { own: InPlaceAsk; page: PageAsk | null; here: () => boolean } {
  const own = new InPlaceAsk();
  const page = getContext<PageAsk | undefined>(PAGE_ASK_KEY) ?? null;
  const entry: AskHost = {
    ownOpen: () => own.open,
    focusOwnCancel: () => own.focusCancel(),
    closeEl: () => modalClose(labelId),
  };
  $effect(() => {
    // untrack: register() reads the stack it writes.
    const off = untrack(() => page?.register(entry));
    return () => { off?.(); own.dismiss(); };
  });
  return { own, page, here: () => !!page && page.ask.open && page.top === entry };
}

// ---- Task 3: settling, the second move, withdrawing; the course tree ----

/** R54: closes question `q` once its action settles and, after the re-render,
 *  focuses `target` — only if focus was in the question or nowhere and still
 *  is (R57). Returns what it focused. A no-op unless `q` is the busy question:
 *  a dismissed one, or another site's on a shared ask, is left alone. */
export async function settleTo(
  ask: InPlaceAsk, q: Ask, target: () => Element | null | undefined, opts?: FocusOptions,
): Promise<HTMLElement | null> {
  if (!ask.busy || ask.current !== q) return null;
  const host = ask.host;
  const free = ask.focusFree;
  ask.settle();
  await tick();
  if (!free || !focusIsFree(host)) return null;
  const t = target();
  if (!usable(t)) return null;
  t.focus(opts);
  return t;
}

/** R57's second move (R54): from the interim element a site focused to its
 *  final target, only while focus is still on the interim element or <body>. */
export async function moveOn(interim: HTMLElement, target: () => Element | null | undefined): Promise<void> {
  await tick();
  const a = document.activeElement;
  if (a && a !== document.body && a !== interim) return;
  const t = target();
  if (usable(t)) t.focus();
}

/** R49 after a confirm: the subject changed, so question `q` goes without
 *  acting, and focus that was in it follows to `target`. */
export function withdraw(ask: InPlaceAsk, q: Ask, target: () => Element | null | undefined): void {
  if (ask.current !== q) return;
  const free = ask.focusFree;
  ask.dismiss();
  if (free) void focusAfter(target);
}

export const TREE_ASK_KEY = Symbol('treeAsk');

/** The course tree's one question (R53), keyed `block-<id>`, `seq-<id>` or
 *  `item-<id>` (the three number their ids separately). The first caller —
 *  VersionEditPage, or an accordion mounted on its own — creates it and
 *  provides it to its subtree. It goes when the route moves on (R49) and with
 *  its creator. Call during component init. */
export function useTreeAsk(): InPlaceAsk {
  const shared = getContext<InPlaceAsk | undefined>(TREE_ASK_KEY);
  if (shared) return shared;
  const a = new InPlaceAsk();
  setContext(TREE_ASK_KEY, a);
  $effect(() => {
    void currentRoute.path;
    void currentRoute.search;
    untrack(() => a.dismiss());   // a no-op on the first run: nothing is open
  });
  $effect(() => () => a.dismiss());
  return a;
}
