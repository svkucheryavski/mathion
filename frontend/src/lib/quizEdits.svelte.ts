// Slice-5d: the quiz modal's one open edit (D10) and its in-flight counter.
// Every edit — an inline field, a level-3 modal, the header title — takes the
// slot while it is open, and any other action asks first. The quiz body owns
// one instance and exposes it as ItemBodyApi.edits.
import { ApiError } from './api';
import { pushToast } from '../stores/toasts.svelte';

export const DISCARD_PROMPT = 'Discard unsaved changes and continue?';
export const WAIT_TITLE = 'Wait for the save to finish';
// An edit that stayed open through a 403/409 permission flip: it can only be cancelled (R10).
export const FORBIDDEN_TITLE = 'This version can no longer be edited';
export const KEY_CONFIRM =
  'This quiz is published. Changing the answer key does not re-score students who already ' +
  'attempted — their recorded scores keep the old key. To re-grade everyone, create a new ' +
  'version instead. Continue?';

export type EditHandle = {
  readonly id: string;
  readonly dirty: boolean;
  readonly saving: boolean;
  // Close without a request. `refocus` is false when another action takes over.
  close(refocus: boolean): void;
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

  /** D10: true when the caller may go ahead. `id` names the caller's own edit, if any. */
  request(id?: string): boolean {
    const a = this.active;
    if (a === null || a.id === id) return true;
    if (a.saving) return false;
    if (a.dirty && !window.confirm(DISCARD_PROMPT)) return false;
    this.#drop(a);
    return true;
  }

  /** A move or delete follows its locks alone (spec §While a request runs): a
   *  saving edit lets it through untouched; otherwise the D10 rule applies. */
  requestStructure(): boolean {
    return this.active?.saving ? true : this.request();
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
  // A published answer key asks first; false keeps the field open, unsent.
  confirmSend?: () => boolean;
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
  #o: InlineOptions<T>;
  #alive = true;

  constructor(o: InlineOptions<T>) {
    this.#o = o;
    this.value = o.initial;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.handle = {
      id: o.id,
      get dirty() { return !o.same(self.value, o.initial); },
      get saving() { return self.saving; },
      close: (refocus) => o.close(refocus),
    };
  }

  /** Call from the field's $effect: it takes the slot, and the cleanup releases it. */
  attach(): () => void {
    this.#alive = true;
    this.#o.edits.open(this.handle);
    return () => {
      this.#alive = false;
      this.#o.edits.release(this.handle);
    };
  }

  cancel(): void {
    if (!this.saving) this.#o.close(true);
  }

  /** The version still allows this save; ✓ is disabled with FORBIDDEN_TITLE otherwise. */
  get canSave(): boolean { return this.#o.allowed?.() ?? true; }

  async commit(): Promise<void> {
    if (this.saving || !this.canSave) return;
    const o = this.#o;
    // Unchanged first: an untouched empty Text key closes rather than erroring.
    if (o.unchanged ? o.unchanged(this.value) : o.same(this.value, o.initial)) { o.close(true); return; }
    const msg = o.check(this.value);
    if (msg !== null) { this.error = msg; return; }
    // Cleared before the key confirm, so a declined confirm leaves no stale message.
    this.error = null;
    if (o.confirmSend && !o.confirmSend()) return;
    this.saving = true;
    try {
      await o.edits.track(o.send(this.value));
    } catch (e) {
      const m = e instanceof ApiError ? e.displayMessage : 'Save failed';
      // A save always reports its failure: inline while the field is open on
      // this version, otherwise as a toast (spec §While a request runs).
      this.saving = false;   // never left "Saving…" (a field that outlived its version can still cancel)
      if (!this.#alive || !o.edits.live()) { pushToast(m, 'error'); return; }
      this.error = m;
      return;
    }
    this.saving = false;
    // A stale success writes nothing into the modal (spec §Stale responses).
    if (!o.edits.live()) return;
    o.edits.say('Saved');
    if (!this.#alive) return;
    if (o.after === 'reset') this.value = o.initial;
    else o.close(true);
  }

  /** Enter saves and Esc cancels; Esc never reaches the modal, even while saving. */
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
