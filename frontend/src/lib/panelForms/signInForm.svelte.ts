// Settings D12: three whole numbers and the longest sign-in.
import { PanelForm, whole } from './formBase.svelte';
import type { PanelSignIn } from '../superuser';

export const LONGEST = [1, 7, 30].map((d) => ({ value: d, label: `${d} ${d === 1 ? 'day' : 'days'}` }));

export class SignInForm extends PanelForm<PanelSignIn> {
  minutes = $state(String(this.saved.pin_minutes));
  requests = $state(String(this.saved.pin_requests_per_hour));
  tries = $state(String(this.saved.pin_failures_per_hour));
  days = $state(this.saved.longest_sign_in_days);

  readonly changed = $derived(
    this.minutes.trim() !== String(this.saved.pin_minutes)
    || this.requests.trim() !== String(this.saved.pin_requests_per_hour)
    || this.tries.trim() !== String(this.saved.pin_failures_per_hour)
    || this.days !== this.saved.longest_sign_in_days,
  );

  body(): PanelSignIn | string {
    if (![this.minutes, this.requests, this.tries].every(whole)) return 'Type a whole number.';
    return {
      pin_minutes: Number(this.minutes.trim()),
      pin_requests_per_hour: Number(this.requests.trim()),
      pin_failures_per_hour: Number(this.tries.trim()),
      longest_sign_in_days: this.days,
    };
  }
}
