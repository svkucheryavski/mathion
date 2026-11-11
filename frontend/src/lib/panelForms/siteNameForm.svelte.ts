// Branding D2, D3: the site name. Reset to default is a pending change like
// any edit; typing after it saves the typed name.
import { PanelForm } from './formBase.svelte';
import { PRODUCT_NAME } from '../branding.svelte';

export class SiteNameForm extends PanelForm<string> {
  value = $state(this.saved);
  resetting = $state(false);

  readonly changed = $derived(this.resetting || this.value !== this.saved);

  override edited(): void {
    super.edited();
    this.resetting = false;
  }

  resetToDefault(): void {
    this.edited();
    this.value = PRODUCT_NAME;
    this.resetting = true;
  }

  body(): { name: string } | { reset: true } {
    return this.resetting ? { reset: true } : { name: this.value };
  }
}
