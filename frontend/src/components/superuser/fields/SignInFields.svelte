<script lang="ts">
  // Settings D12: the sign-in values' fields, shared by the Edit sign-in dialog
  // and Set up's Sign-in rules and limits step.
  import Segmented from '../../ui/Segmented.svelte';
  import { LONGEST, type SignInForm } from '../../../lib/panelForms/signInForm.svelte';

  type Props = { form: SignInForm; uid: string; busy: boolean };
  let { form, uid, busy }: Props = $props();
</script>

<label class="es-label" for="{uid}-min">A PIN lasts (minutes)</label>
<input id="{uid}-min" class="es-input" data-autofocus bind:value={form.minutes} readonly={busy}
  inputmode="numeric" autocomplete="off" oninput={() => form.edited()} />
<label class="es-label" for="{uid}-req">PIN requests per hour</label>
<input id="{uid}-req" class="es-input" bind:value={form.requests} readonly={busy}
  inputmode="numeric" autocomplete="off" oninput={() => form.edited()} />
<label class="es-label" for="{uid}-try">Wrong PIN tries per hour</label>
<input id="{uid}-try" class="es-input" bind:value={form.tries} readonly={busy}
  inputmode="numeric" autocomplete="off" oninput={() => form.edited()} />
<span class="es-label" id="{uid}-longest-label">Longest sign-in</span>
<Segmented options={LONGEST} bind:value={form.days} name="{uid}-longest" label="Longest sign-in" labelledby="{uid}-longest-label"
  fit disabled={busy} onchange={() => form.edited()} />

<style>
  .es-label { font-size: 12.5px; color: var(--muted); }
  .es-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (EditCourseDialog .ec-input), as wide as a number. */
  .es-input {
    box-sizing: border-box;
    width: 120px;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .es-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
</style>
