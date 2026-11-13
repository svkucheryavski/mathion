// Settings D7-D9: the email form. A save sends the switch alone when it is off
// (D7c), otherwise every field, with the password only when typed (D8: an
// empty field keeps the saved one).
import { PanelForm, whole } from './formBase.svelte';
import type { Encryption, EmailSaveBody, EmailTestBody, EmailTestResult, PanelEmailSettings } from '../superuser';

export const ENCRYPTIONS: { value: Encryption; label: string }[] = [
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'none', label: 'None' },
];
const USUAL_PORT: Record<Encryption, number> = { starttls: 587, ssl: 465, none: 25 };
// The server's own sentence, so a typo reads the same either side.
export const PORT_SENTENCE = 'The port must be from 1 to 65535.';
// Settings D7b (rev 8): the server drops white space and the invisible
// characters a paste can bring from both ends of the server, username and
// From (schemas.py EmailTestIn._trim); the form compares the same way.
// Python's \s also takes U+001C-U+001F and U+0085, which JavaScript's doesn't.
const ENDS = /^[\s\x1C-\x1F\x85\u200B\u200C\u200D\u2060\uFEFF]+|[\s\x1C-\x1F\x85\u200B\u200C\u200D\u2060\uFEFF]+$/g;
const clean = (v: string): string => v.replace(ENDS, '');

export class EmailForm extends PanelForm<PanelEmailSettings> {
  on = $state(this.saved.on);
  host = $state(this.saved.host);
  port = $state(String(this.saved.port));
  encryption = $state<Encryption>(this.saved.encryption);
  skipCert = $state(this.saved.skip_cert_check);
  username = $state(this.saved.username);
  password = $state('');
  from = $state(this.saved.from_address);
  /** D9: the latest test's answer, cleared by any edit. */
  result = $state<EmailTestResult | null>(null);
  /** Bumped when a save starts: a test sent before it is older than the
   *  save, so its answer is dropped (only the later-started one shows). */
  saves = 0;

  readonly fieldsChanged = $derived(
    clean(this.host) !== this.saved.host || this.port.trim() !== String(this.saved.port)
    || this.encryption !== this.saved.encryption || this.skipCert !== this.saved.skip_cert_check
    || clean(this.username) !== this.saved.username
    // With no username a typed password is thrown away (the note says so).
    || (this.password !== '' && clean(this.username) !== '')
    || clean(this.from) !== this.saved.from_address,
  );
  readonly changed = $derived(this.on !== this.saved.on || this.fieldsChanged);
  // Off writes only the switch, so greyed fields that differ change nothing.
  readonly ready = $derived(this.on !== this.saved.on || (this.on && this.fieldsChanged));
  /** D8a: the saved password is only used with the server, username and
   *  certificate check it was saved for; port and encryption may change. */
  readonly savedPasswordApplies = $derived(
    this.saved.password_saved && clean(this.username) !== ''
    && clean(this.host) === this.saved.host && clean(this.username) === this.saved.username
    && !(this.skipCert && !this.saved.skip_cert_check),
  );
  readonly placeholder = $derived(
    this.savedPasswordApplies && !this.saved.password_unreadable ? 'Saved: type a new one to replace it' : '',
  );
  /** No username, so no password is used: a save ignores a typed one and
   *  drops a saved one, and a test reads neither. The typed one is what the
   *  field shows, so its sentence wins (the user's, 2026-11-13). */
  readonly noUsernameNote = $derived.by((): string | null => {
    if (!this.on || clean(this.username) !== '') return null;
    if (this.password !== '') return "Without a username, the password isn't used.";
    return this.saved.password_saved ? "Without a username, the saved password isn't used." : null;
  });
  /** D7c: off needs no password. The fields show the username note instead
   *  when both apply (with no username no password is used). */
  readonly unreadableHint = $derived(this.on && this.saved.password_unreadable);

  override edited(): void {
    super.edited();
    this.result = null;
  }

  /** A refused save; only the newer of a save error and a test answer shows. */
  saveFailed(message: string | null): void {
    this.error = message;
    if (message !== null) this.result = null;
  }

  /** A test's answer; it replaces an older save error. `clearsError` is
   *  false when the error on show isn't a save's (Set up's "step 1 saved"). */
  answered(result: EmailTestResult, clearsError = true): void {
    this.result = result;
    if (clearsError) this.error = null;
  }

  pickEncryption(next: Encryption): void {
    this.port = String(USUAL_PORT[next]);
    this.edited();
  }

  /** The form as a test sends it, or the port sentence. */
  testBody(): EmailTestBody | string {
    if (!whole(this.port)) return PORT_SENTENCE;
    const body: EmailTestBody = {
      host: clean(this.host), port: Number(this.port.trim()), encryption: this.encryption,
      skip_cert_check: this.skipCert, username: clean(this.username), from_address: clean(this.from),
    };
    if (this.password !== '') body.password = this.password;
    return body;
  }

  saveBody(): EmailSaveBody | string {
    if (!this.on) return { on: false };
    const f = this.testBody();
    return typeof f === 'string' ? f : { on: true, ...f };
  }
}
