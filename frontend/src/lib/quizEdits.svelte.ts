// Slice-5d: the quiz modal's one open edit (D10) and its in-flight counter.
// Every edit — an inline field, a level-3 modal, the header title — takes the
// slot while it is open, and any other action asks first — at the open edit,
// in place (Polish 1 #14). The quiz body owns one instance and exposes it as
// ItemBodyApi.edits.
import { ApiError } from './api';
import { pushToast } from '../stores/toasts.svelte';
import { DISCARD_CONTINUE } from './editorReasons';
import {
  InPlaceAsk, DISCARD_NAV_ASK, focusAfter, settleTo, withdraw, type Ask, type Answer,
} from './askInPlace.svelte';

// R51: the D10 question asks with the navigation text.
export const DISCARD_PROMPT = DISCARD_CONTINUE;
export const WAIT_TITLE = 'Wait for the save to finish';
// An edit that stayed open through a 403/409 permission flip: it can only be cancelled (R10).
export const FORBIDDEN_TITLE = 'This version can no longer be edited';
export const KEY_CONFIRM =
  'This quiz is published. Changing the answer key does not re-score students who already ' +
  'attempted — their recorded scores keep the old key. To re-grade everyone, create a new ' +
  'version instead.';

export type EditHandle = {
  readonly id: string;
  readonly dirty: boolean;
  readonly saving: boolean;
  // Close without a request. `refocus` is false when another action takes over.
  close(refocus: boolean): void;
  // D10 in place (#14): asks at the edit. Absent on the level-3 modals: they
  // sit on top, so no other action can ask past them.
  ask?(q: Ask): Promise<Answer>;
};

export class QuizEdits {
  /** The modal is still showing this version (spec §Stale responses: `alive && vid === savedVid`). */
  readonly live: () => boolean;
  constructor(live: () => boolean = () => true) { this.live = live; }

  // RAW, never $state: $state would wrap each plain handle in a new proxy, so
  // release(h) / `active === h` would never match and the slot would leak.
  active = $state.raw<EditHandle | null>(null);
  /** The quiz's polite live-region text; QuizBody renders it. */
  message = $state('');
  #pending = $state(0);

  /** Any quiz request is in flight (structure writes and text saves alike). */
  get inFlight(): boolean { return this.#pending > 0; }
  /** A saving edit disables every edit-opening control. */
  get locked(): boolean { return this.active?.saving ?? false; }
  /** Unsaved work: an open edit with changes that is not saving. */
  get dirty(): boolean {
    const a = this.active;
    return a !== null && a.dirty && !a.saving;
  }

  /** D10: resolves true when the caller may go ahead. `id` names the caller's
   *  own edit, if any. A changed edit asks at itself (#14); Discard drops it. */
  async request(id?: string): Promise<boolean> {
    const a = this.active;
    if (a === null || a.id === id) return true;
    if (a.saving) return false;
    if (a.dirty) {
      if (!a.ask) return false;
      // A fresh object: settleTo and the attach cleanup compare questions by identity.
      if ((await a.ask({ ...DISCARD_NAV_ASK })) !== 'confirm') return false;
      // R49: the edit may have closed or started saving while it asked.
      if (this.active !== a || a.saving) return false;
    }
    this.#drop(a);
    return true;
  }

  /** A move or delete follows its locks alone (spec §While a request runs): a
   *  saving edit lets it through untouched, before or after the question;
   *  otherwise the D10 rule applies. */
  async requestStructure(): Promise<boolean> {
    if (this.active?.saving) return true;
    const ok = await this.request();
    return ok || (this.active?.saving ?? false);
  }

  open(h: EditHandle): void { this.active = h; }
  release(h: EditHandle): void { if (this.active === h) this.active = null; }

  /** The page's confirmed discard: close what is open, unless it is saving. */
  discardAll(): void {
    const a = this.active;
    if (a !== null && !a.saving) this.#drop(a);
  }

  /** Announce politely ("Saved", "Answer moved to position 2 of 3"). */
  say(text: string): void {
    // Cleared first, so the same text twice is announced twice.
    this.message = '';
    queueMicrotask(() => { this.message = text; });
  }

  /** Count a request toward `inFlight`. */
  async track<T>(p: Promise<T>): Promise<T> {
    this.#pending += 1;
    try { return await p; } finally { this.#pending -= 1; }
  }

  #drop(a: EditHandle): void {
    a.close(false);
    if (this.active === a) this.active = null;
  }
}

export type InlineOptions<T> = {
  id: string;
  edits: QuizEdits;
  initial: T;
  // True when `a` equals `b` (the initial value): the field holds no unsaved work.
  same: (a: T, b: T) => boolean;
  // True when sending `v` would change nothing on the server; Enter then closes
  // silently. Defaults to same(v, initial). Number compares canonical forms
  // against the STORED key, which may differ from the pre-filled fields.
  unchanged?: (v: T) => boolean;
  // An inline message, or null when the value may be sent.
  check: (v: T) => string | null;
  // A published answer key asks first (#6): the question, or null to send at once.
  confirm?: () => Ask | null;
  // Where the edit's questions ask. Default: its own. The quiz title passes the
  // item modal's body-top row, because the header has no room (#14).
  asking?: InPlaceAsk;
  // False once a 403/409 reload took away the right to this save: the field
  // stays open with its text (never lost silently) but can only be cancelled.
  allowed?: () => boolean;
  // Throws on failure (an ApiError's message is shown).
  send: (v: T) => Promise<void>;
  // The owner unmounts the field. `refocus`: return focus to its opener.
  close: (refocus: boolean) => void;
  // 'reset' keeps the field open and empty after a success (+ Add answer).
  after?: 'close' | 'reset';
};

/** One inline edit (spec §Saving): Enter or ✓ saves, Esc or ✕ cancels. */
export class InlineEdit<T> {
  // A $state FIELD initialiser, then set in the constructor. A bare `value: T;`
  // declaration would compile to an own property that shadows Svelte's state
  // accessor, and `bind:value` would stop updating.
  value = $state<T>() as T;
  error = $state<string | null>(null);
  saving = $state(false);
  readonly handle: EditHandle;
  /** The edit's questions: D10 (#14) and the key question (#6). While one
   *  asks, the field is readonly and Enter, ✓ and ✕ only bring it back. */
  readonly asking: InPlaceAsk;
  /** Where focus returns after Cancel; attach() records it. */
  fieldEl: HTMLElement | null = null;
  #o: InlineOptions<T>;
  #alive = true;
  #asked: Ask | null = null;   // this edit's last question (a shared `asking` may hold another's)

  constructor(o: InlineOptions<T>) {
    this.#o = o;
    this.value = o.initial;
    this.asking = o.asking ?? new InPlaceAsk();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.handle = {
      id: o.id,
      get dirty() { return !o.same(self.value, o.initial); },
      get saving() { return self.saving; },
      close: (refocus) => o.close(refocus),
      ask: async (q) => {
        const a = await self.ask(q);
        // D10's Discard sends nothing: it settles at once (R54).
        if (a === 'confirm' && self.asking.current === q) self.asking.settle();
        return a;
      },
    };
  }

  /** Call from the field's attachment with the field focus returns to: the edit
   *  takes the slot; the cleanup releases it and withdraws its own question. */
  attach(field: HTMLElement | null = null): () => void {
    this.#alive = true;
    this.fieldEl = field;
    this.#o.edits.open(this.handle);
    return () => {
      this.#alive = false;
      if (this.fieldEl === field) this.fieldEl = null;
      // Only this edit's own: the title shares the body-top row with #19.
      if (this.#asked && this.asking.current === this.#asked) this.asking.dismiss();
      this.#o.edits.release(this.handle);
    };
  }

  /** Asks at this edit. Cancel returns focus to the field, readonly no more (#14, #6). */
  async ask(q: Ask): Promise<Answer> {
    this.#asked = q;
    const a = await this.asking.ask(q);
    if (a === 'cancel') void focusAfter(() => this.fieldEl);
    return a;
  }

  cancel(): void {
    if (this.asking.open) { this.asking.focusCancel(); return; }
    if (!this.saving) this.#o.close(true);
  }

  /** The version still allows this save; ✓ is disabled with FORBIDDEN_TITLE otherwise. */
  get canSave(): boolean { return this.#o.allowed?.() ?? true; }

  #unchanged(): boolean {
    const o = this.#o;
    return o.unchanged ? o.unchanged(this.value) : o.same(this.value, o.initial);
  }

  async commit(): Promise<void> {
    if (this.asking.open) { this.asking.focusCancel(); return; }
    if (this.saving || !this.canSave) return;
    const o = this.#o;
    // Unchanged first: an untouched empty Text key closes rather than erroring.
    if (this.#unchanged()) { o.close(true); return; }
    const msg = o.check(this.value);
    if (msg !== null) { this.error = msg; return; }
    // Cleared before the key question, so a Cancel leaves no stale message.
    this.error = null;
    const q = o.confirm?.() ?? null;
    if (q) {
      if ((await this.ask(q)) !== 'confirm') return;
      // R49: the field may have closed or lost its right to save while it asked.
      if (!this.#alive || !this.canSave || this.saving) { withdraw(this.asking, q, () => this.fieldEl); return; }
    }
    this.saving = true;
    let ok = false;
    // R57: after a confirmed save, the field's opener takes focus back only if
    // focus stayed in the question (or nowhere) while the save ran.
    let free = true;
    try {
      await o.edits.track(o.send(this.value));
      ok = true;
    } catch (e) {
      const m = e instanceof ApiError ? e.displayMessage : 'Save failed';
      // A save always reports its failure: inline while the field is open on
      // this version, otherwise as a toast (spec §While a request runs).
      this.saving = false;   // never left "Saving…" (a field that outlived its version can still cancel)
      if (!this.#alive || !o.edits.live()) pushToast(m, 'error');
      else this.error = m;
    } finally {
      this.saving = false;
      // #6: the question leaves once the save settles (R54). After a failure
      // focus goes back to the field, which keeps the typed key and the error.
      if (q) {
        if (ok) { free = this.asking.focusFree; if (this.asking.current === q) this.asking.settle(); }
        else await settleTo(this.asking, q, () => this.fieldEl);
      }
    }
    if (!ok) return;
    // A stale success writes nothing into the modal (spec §Stale responses).
    if (!o.edits.live()) return;
    o.edits.say('Saved');
    if (!this.#alive) return;
    if (o.after === 'reset') this.value = o.initial;
    else o.close(free);
  }

  /** Enter saves and Esc cancels; Esc never reaches the modal, even while
   *  saving. While a question asks, both only bring it back. */
  keydown(e: KeyboardEvent): void {
    // Safari confirms an IME composition with an Enter whose isComposing is false.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void this.commit();
    }
  }
}
