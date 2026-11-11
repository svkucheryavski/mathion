// Set up D13: the shell's one copy of the wizard's state, passed to every page
// that reads it. Reads and writes carry a counter, and an answer older than one
// already applied is dropped (D3a). No read starts while a wizard write runs.
import { ApiError } from './api';
import { getSetup, type PanelSetup } from './setup';
import { panelError, type PanelOnAuth } from './superuser';

/** D3a: while a step has unsaved changes, a read every 4 minutes keeps the link alive… */
export const KEEP_ALIVE_MS = 240_000;
/** …for at most 2 hours after the last edit (the user's cap). */
export const KEEP_ALIVE_CAP_MS = 7_200_000;

export class SetupStore {
  state = $state.raw<PanelSetup | null>(null);
  /** D2: true only while no read has succeeded. */
  failed = $state(false);
  /** The failed first read's sentence, for the error state. */
  error = $state<string | null>(null);
  /** A wizard write is running or waiting its turn. */
  busy = $state(false);
  /** Set by a step around its own saves; the pills wait while it or `busy` is set (D3). */
  saving = $state(false);
  /** A read is running or waiting for a write (Try again shows it, on the Dashboard and on /setup). */
  reading = $state(false);

  readonly #token: string;
  readonly #onAuth: PanelOnAuth;
  #sent = 0;
  #applied = 0;
  #writes: Promise<unknown> = Promise.resolve();
  #queued = 0;
  #reads = 0;
  #gone = false;       // a 401 or 404 went to onAuth, or the shell unmounted
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastEdit = 0;

  constructor(token: string, onAuth: PanelOnAuth) {
    this.#token = token;
    this.#onAuth = onAuth;
  }

  #apply(n: number, s: PanelSetup): boolean {
    if (this.#gone || n < this.#applied) return false;
    this.#applied = n;
    this.state = s;
    this.failed = false;
    this.error = null;
    return true;
  }

  /** The answer applied, or null when it failed or was dropped. After a good
   *  read a failure changes nothing (D2); a 401 or 404 goes to onAuth once. */
  async read(): Promise<PanelSetup | null> {
    this.#reads++;
    this.reading = true;
    try {
      while (this.#queued > 0) await this.#writes;
      if (this.#gone) return null;
      const n = ++this.#sent;
      try {
        const s = await getSetup(this.#token);
        return this.#apply(n, s) ? s : null;
      } catch (e) {
        this.#failedRead(e);
        return null;
      }
    } finally {
      if (--this.#reads === 0) this.reading = false;
    }
  }

  #failedRead(e: unknown): void {
    if (this.#gone) return;
    if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
      this.#gone = true;
      this.#stopTimer();
      panelError(e, this.#onAuth);
      return;
    }
    if (this.state === null) {
      this.failed = true;
      this.error = panelError(e, this.#onAuth);
    }
  }

  /** One wizard write at a time. It throws on failure: the caller shows the
   *  error (through panelError, which also handles 401 and 404). */
  write(call: () => Promise<PanelSetup>): Promise<PanelSetup> {
    this.#queued++;
    this.busy = true;
    const run = this.#writes.then(async () => {
      const n = ++this.#sent;
      try {
        const s = await call();
        this.#apply(n, s);
        return s;
      } finally {
        if (--this.#queued === 0) this.busy = false;
      }
    });
    this.#writes = run.catch(() => {});
    return run;
  }

  /** D3a: read every 4 minutes while `dirty()`, until 2 hours after the last
   *  edit. A step calls it when it opens and the returned stop when it closes;
   *  `dispose()` is the shell's alone. */
  keepAlive(dirty: () => boolean): () => void {
    this.#stopTimer();
    if (this.#gone) return () => {};
    const timer = setInterval(() => {
      if (dirty() && Date.now() - this.#lastEdit < KEEP_ALIVE_CAP_MS) void this.read();
    }, KEEP_ALIVE_MS);
    this.#timer = timer;
    return () => { if (this.#timer === timer) this.#stopTimer(); };
  }

  noteEdit(): void {
    this.#lastEdit = Date.now();
  }

  #stopTimer(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  dispose(): void {
    this.#gone = true;
    this.#stopTimer();
  }
}
