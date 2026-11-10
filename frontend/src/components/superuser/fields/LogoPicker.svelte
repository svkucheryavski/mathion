<script lang="ts">
  // Branding D4-D6: the image's previews, the file choice, its advice and the
  // hint, shared by the Edit logo / Edit tab icon dialogs and Set up's Site
  // name and logo step. The checks live in LogoPick. With `onRemove` (Set up
  // D7, U4), a chosen file's name has Remove beside it, which drops the choice;
  // focus then goes to Choose.
  import Button from '../../ui/Button.svelte';
  import SiteLogo from '../../chrome/SiteLogo.svelte';
  import { IMAGE_TEXT, type LogoPick } from '../../../lib/panelForms/logoPick.svelte';

  type Props = { form: LogoPick; busy: boolean; onRemove?: () => void };
  let { form, busy, onRemove }: Props = $props();

  let picker = $state<HTMLInputElement | undefined>();
  let chooseButton = $state<HTMLButtonElement | undefined>();
  const iconSrc = $derived(form.shown?.src ?? '/api/branding/icon-default.svg');

  function onChoose(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void form.choose(file);
  }

  function remove() {
    onRemove?.();
    chooseButton?.focus();
  }
</script>

{#if form.kind === 'logo'}
  <p class="im-label">In the header</p>
  <div class="im-box header"><SiteLogo size="header" image={form.shown} /></div>
  <p class="im-label">On the sign-in page</p>
  <div class="im-box login"><SiteLogo size="login" image={form.shown} /></div>
{:else}
  <!-- iOS fills a transparent icon's background, so it shows on light and dark. -->
  {#each ['light', 'dark'] as strip (strip)}
    <div class={['im-strip', strip === 'dark' && 'dark']}>
      <img src={iconSrc} width="32" height="32" alt="" />
      <img src={iconSrc} width="16" height="16" alt="" />
    </div>
  {/each}
{/if}

<div class="im-choose">
  <Button variant="secondary" disabled={busy} bind:element={chooseButton} onclick={() => picker?.click()}>Choose a PNG…</Button>
  {#if form.pending?.kind === 'file'}
    <span class="im-file">{form.pending.file.name}, {form.pending.file.width} × {form.pending.file.height} px</span>
    {#if onRemove}
      <button type="button" class="im-remove" data-action="remove" aria-label="Remove {form.pending.file.name}"
        disabled={busy} onclick={remove}>Remove</button>
    {/if}
  {/if}
  <input bind:this={picker} type="file" accept="image/png" hidden onchange={onChoose} />
</div>
{#if form.pending?.kind === 'file' && form.pending.file.advice.length}
  <ul class="im-advice">
    {#each form.pending.file.advice as line (line)}<li>{line}</li>{/each}
  </ul>
{/if}
<p class="im-hint">{IMAGE_TEXT[form.kind].hint}</p>

<style>
  .im-label { margin: 0; font-size: 12.5px; color: var(--muted); }
  /* The image at its real size inside a dashed box on the page's surface (D4). */
  .im-box {
    display: flex;
    align-items: center;
    box-sizing: content-box;
    padding: 2px;
    border: 1px dashed var(--border-strong);
    background: var(--surface);
  }
  .im-box.header { width: 160px; height: 20px; }
  .im-box.login { width: 224px; height: 28px; margin-bottom: 6px; }
  .im-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .im-strip.dark { background: var(--text); }
  .im-choose { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .im-file { font-size: 12.5px; color: var(--text-2); overflow-wrap: anywhere; }
  /* A link-look button, styled like FinishCard's Keep these values. */
  .im-remove { flex: none; background: none; border: 0; padding: 0; font: inherit; font-size: 12.5px; color: var(--primary); cursor: pointer; }
  .im-remove:hover { text-decoration: underline; }
  .im-remove:disabled { color: var(--muted); cursor: default; text-decoration: none; }
  .im-advice { margin: 0; padding-left: 18px; font-size: 12px; color: var(--gold-text); }
  .im-hint { margin: 0; font-size: 12px; color: var(--muted); }
</style>
