<script lang="ts">
  // Settings D11: the file limits' fields, shared by the Edit file limits
  // dialog and Set up's Sign-in rules and limits step.
  import type { LimitsForm } from '../../../lib/panelForms/limitsForm.svelte';

  type Props = { form: LimitsForm; uid: string; busy: boolean };
  let { form, uid, busy }: Props = $props();
</script>

<label class="el-label" for="{uid}-file">Largest file (MB)</label>
<input id="{uid}-file" class="el-input" data-autofocus bind:value={form.file} readonly={busy}
  inputmode="numeric" autocomplete="off" oninput={() => form.edited()} />
<!-- D11c, verbatim. -->
<p class="el-hint el-proxy">Uploads also pass the server's proxy. With <code>mathion tls</code>, an up-to-date <code>mathion</code> allows 50 MB; another proxy must allow at least this.</p>
<label class="el-label" for="{uid}-total">Files per course version or run, in total (MB)</label>
<input id="{uid}-total" class="el-input" bind:value={form.total} readonly={busy}
  inputmode="numeric" autocomplete="off" oninput={() => form.edited()} />

<style>
  .el-label { font-size: 12.5px; color: var(--muted); }
  .el-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (EditCourseDialog .ec-input), as wide as a number. */
  .el-input {
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
  .el-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .el-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .el-hint code { font-family: var(--font-mono); font-size: 11.5px; }
</style>
