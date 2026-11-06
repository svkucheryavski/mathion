<script lang="ts">
  // Branding D2, D4-D6: the Edit logo and Edit tab icon dialogs. A chosen file's
  // bytes are read once and run through the server's whole check at once
  // (pngCheck), so a refused file never previews; the preview then waits for
  // img.decode(), and Save waits for it too. Save sends those same bytes.
  // Reset to default is a pending change like a chosen file; the last one wins.
  // A refusal drops every pending change, so the preview is the saved item.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import SiteLogo from '../chrome/SiteLogo.svelte';
  import { ApiError } from '../../lib/api';
  import { checkPngBytes } from '../../lib/pngCheck';
  import { tooLargeSentence } from '../../lib/uploadLimit.svelte';
  import { panelError, type BrandingPart, type PanelImageSize, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    kind: 'logo' | 'icon';
    /** The saved upload's size and version, or null for the default. */
    saved: (PanelImageSize & { version: string }) | null;
    save: (part: BrandingPart, filename?: string) => Promise<void>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { kind, saved, save, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  const TEXT = {
    logo: {
      title: 'Edit logo',
      hint: "One PNG with your logo and name, at least 56 px tall so it stays sharp, also on the sign-in page. It's scaled to fit and never stretched. Up to 1 MB.",
    },
    icon: {
      title: 'Edit tab icon',
      hint: 'A square PNG, at least 180 px on a side, so it stays sharp in tabs and on phones. Up to 1 MB.',
    },
  };
  const text = untrack(() => TEXT[kind]);
  const savedItem = untrack(() => saved);

  type Chosen = {
    bytes: Uint8Array<ArrayBuffer>; name: string; width: number; height: number;
    advice: string[]; url: string; decoded: boolean;
  };
  let pending = $state<{ kind: 'file'; file: Chosen } | { kind: 'reset' } | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let picker = $state<HTMLInputElement | undefined>();
  let saveButton = $state<HTMLButtonElement | undefined>();
  // Each choice and each Reset counts; a read or decode answer for an earlier one is ignored.
  let turn = 0;

  const ready = $derived(pending?.kind === 'reset' || (pending?.kind === 'file' && pending.file.decoded));

  /** What the previews show: a decoded choice, the default after Reset, or the saved item. */
  const shown = $derived.by((): { src: string; width: number; height: number } | null => {
    if (pending?.kind === 'reset') return null;
    if (pending?.kind === 'file' && pending.file.decoded) {
      return { src: pending.file.url, width: pending.file.width, height: pending.file.height };
    }
    if (!savedItem) return null;
    return { src: `/api/branding/${kind}.png?v=${savedItem.version}`, width: savedItem.width, height: savedItem.height };
  });
  const iconSrc = $derived(shown?.src ?? '/api/branding/icon-default.svg');

  function readBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function dataUrl(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  }

  function refuse(sentence: string) {
    pending = null;
    error = sentence;
  }

  async function onChoose(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const mine = ++turn;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBytes(file);
    } catch {
      if (mine === turn) refuse("This file can't be read.");
      return;
    }
    if (mine !== turn) return;
    const checked = checkPngBytes(bytes, kind);
    if ('refused' in checked) { refuse(checked.refused); return; }
    error = null;
    const chosen: Chosen = { bytes, name: file.name, width: checked.width, height: checked.height,
      advice: checked.advice, url: dataUrl(bytes), decoded: false };
    pending = { kind: 'file', file: chosen };
    // D5: a partly corrupt PNG passes the check and can still fire load; decode is the test.
    const img = new Image();
    img.src = chosen.url;
    img.decode().then(
      () => { if (mine === turn && pending?.kind === 'file') pending.file.decoded = true; },
      () => { if (mine === turn) refuse("This PNG can't be shown by a browser."); },
    );
  }

  function onReset() {
    turn++;
    pending = { kind: 'reset' };
    error = null;
    saveButton?.focus();
  }

  async function onSave() {
    if (busy || !ready || !pending) return;
    error = null;
    busy = true;
    try {
      if (pending.kind === 'reset') await save('reset');
      else await save(pending.file.bytes, pending.file.name);
      onDone();
    } catch (e) {
      error = e instanceof ApiError && e.status === 413 ? tooLargeSentence(e) : panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="im-title">{text.title}</h2>
{/snippet}

{#snippet foot()}
  {#if savedItem}
    <Button variant="ghost" disabled={busy} onclick={onReset}>Reset to default</Button>
  {/if}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; onSave() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} bind:element={saveButton}
    onclick={() => void onSave()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={600} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <div class="im-body" aria-describedby={error ? errId : undefined}>
    {#if kind === 'logo'}
      <p class="im-label">In the header</p>
      <div class="im-box header"><SiteLogo size="header" image={shown} /></div>
      <p class="im-label">On the sign-in page</p>
      <div class="im-box login"><SiteLogo size="login" image={shown} /></div>
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
      <Button variant="secondary" disabled={busy} onclick={() => picker?.click()}>Choose a PNG…</Button>
      {#if pending?.kind === 'file'}
        <span class="im-file">{pending.file.name}, {pending.file.width} × {pending.file.height} px</span>
      {/if}
      <input bind:this={picker} type="file" accept="image/png" hidden onchange={onChoose} />
    </div>
    {#if pending?.kind === 'file' && pending.file.advice.length}
      <ul class="im-advice">
        {#each pending.file.advice as line (line)}<li>{line}</li>{/each}
      </ul>
    {/if}
    <p class="im-hint">{text.hint}</p>
    {#if error}<p id={errId} class="im-err" role="alert">{error}</p>{/if}
  </div>
</Modal>

<style>
  .im-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .im-body { display: flex; flex-direction: column; gap: 6px; }
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
  .im-advice { margin: 0; padding-left: 18px; font-size: 12px; color: var(--gold-text); }
  .im-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .im-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
