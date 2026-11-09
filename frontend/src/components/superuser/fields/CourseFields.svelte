<script lang="ts">
  // Users/Courses D8, D13: a new course's three fields, shared by the New
  // course dialog and Set up's First course step.
  import AdminEmailField from '../AdminEmailField.svelte';
  import type { CourseForm } from '../../../lib/panelForms/courseForm.svelte';
  import type { PanelOnAuth } from '../../../lib/superuser';

  type Props = { form: CourseForm; uid: string; busy: boolean; token: string; onAuth: PanelOnAuth };
  let { form, uid, busy, token, onAuth }: Props = $props();
</script>

<label class="nc-label" for="{uid}-name">Course name</label>
<input id="{uid}-name" class="nc-input" data-autofocus bind:value={form.name} readonly={busy} autocomplete="off"
  oninput={() => form.onName()} />
<label class="nc-label" for="{uid}-slug">Address</label>
<input id="{uid}-slug" class="nc-input nc-mono" bind:value={form.slug} readonly={busy} autocomplete="off" spellcheck="false"
  oninput={() => form.onSlug()} />
<label class="nc-label" for="{uid}-email">Admin's email</label>
<AdminEmailField id="{uid}-email" {token} value={form.email} {onAuth} readonly={busy}
  oninput={(v) => { form.email = v; form.edited(); }} />

<style>
  .nc-label { font-size: 12.5px; color: var(--muted); }
  .nc-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (NewItemModal .plain-input). */
  .nc-input {
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
  .nc-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .nc-mono { font-family: var(--font-mono); }
</style>
