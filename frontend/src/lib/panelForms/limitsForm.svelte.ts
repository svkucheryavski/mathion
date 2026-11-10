// Settings D11: both limits in whole MB.
import { PanelForm, whole } from './formBase.svelte';
import type { PanelLimits } from '../superuser';

export class LimitsForm extends PanelForm<PanelLimits> {
  file = $state(String(this.saved.max_file_mb));
  total = $state(String(this.saved.max_total_mb));

  readonly changed = $derived(
    this.file.trim() !== String(this.saved.max_file_mb) || this.total.trim() !== String(this.saved.max_total_mb),
  );

  body(): PanelLimits | string {
    if (!whole(this.file) || !whole(this.total)) return 'Type a whole number of MB.';
    return { max_file_mb: Number(this.file.trim()), max_total_mb: Number(this.total.trim()) };
  }
}
