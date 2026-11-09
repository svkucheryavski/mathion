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

  readonly fieldsChanged = $derived(
    this.host.trim() !== this.saved.host || this.port.trim() !== String(this.saved.port)
    || this.encryption !== this.saved.encryption || this.skipCert !== this.saved.skip_cert_check
    || this.username.trim() !== this.saved.username || this.password !== ''
    || this.from.trim() !== this.saved.from_address,
  );
  readonly changed = $derived(this.on !== this.saved.on || this.fieldsChanged);
  // Off writes only the switch, so greyed fields that differ change nothing.
  readonly ready = $derived(this.on !== this.saved.on || (this.on && this.fieldsChanged));
  readonly placeholder = $derived(
    this.saved.password_saved && !this.saved.password_unreadable ? 'Saved: type a new one to replace it' : '',
  );

  override edited(): void {
    super.edited();
    this.result = null;
  }

  pickEncryption(next: Encryption): void {
    this.port = String(USUAL_PORT[next]);
    this.edited();
  }

  /** The form as a test sends it, or the port sentence. */
  testBody(): EmailTestBody | string {
    if (!whole(this.port)) return PORT_SENTENCE;
    const body: EmailTestBody = {
      host: this.host.trim(), port: Number(this.port.trim()), encryption: this.encryption,
      skip_cert_check: this.skipCert, username: this.username.trim(), from_address: this.from.trim(),
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
