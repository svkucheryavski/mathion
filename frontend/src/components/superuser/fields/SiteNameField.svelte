<script lang="ts">
  // Branding D3: the site name's field and hint, shared by the Edit site name
  // dialog and Set up's Site name step.
  import type { SiteNameForm } from '../../../lib/panelForms/siteNameForm.svelte';

  type Props = { form: SiteNameForm; uid: string; busy: boolean };
  let { form, uid, busy }: Props = $props();
</script>

<label class="sn-label" for="{uid}-name">Site name</label>
<input id="{uid}-name" class="sn-input" data-autofocus bind:value={form.value} readonly={busy}
  autocomplete="off" oninput={() => form.edited()} />
<p class="sn-hint">Used for the tab title, emails and the logo's alt text.</p>

<style>
  .sn-label { font-size: 12.5px; color: var(--muted); }
  /* The item modal's field (EditCourseDialog .ec-input). */
  .sn-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .sn-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .sn-hint { margin: 0; font-size: 12px; color: var(--muted); }
</style>
