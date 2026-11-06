<script lang="ts">
  // Branding D1, D2: four cards (Site name, Logo, Tab icon, Colours). Each shows
  // its current value; one pencil per card opens one Edit dialog, which holds
  // the upload and Reset to default. A save shows the saved values the server
  // answers with, and the panel's own head and logo follow at once (D14).
  // The Colours card also downloads the current theme (D9), built in the browser.
  import {
    getBranding, saveSiteName, saveImage, checkTheme, saveTheme, panelError,
    type PanelBranding, type PanelOnAuth,
  } from '../../lib/superuser';
  import { applyBranding, setBranding } from '../../lib/branding.svelte';
  import { downloadTheme, ticked } from '../../lib/themeFile';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import EditSiteNameDialog from '../../components/superuser/EditSiteNameDialog.svelte';
  import EditImageDialog from '../../components/superuser/EditImageDialog.svelte';
  import EditColoursDialog from '../../components/superuser/EditColoursDialog.svelte';
  import Button from '../../components/ui/Button.svelte';
  import SiteLogo from '../../components/chrome/SiteLogo.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';

  let { token, onAuth }: { token: string; onAuth: PanelOnAuth } = $props();

  let data = $state.raw<PanelBranding | null>(null);
  let loading = $state(true);
  let loadError = $state('');
  let dialog = $state<'name' | 'logo' | 'icon' | 'colours' | null>(null);

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      data = await getBranding(token);
      // The panel's own logo shows what this read says, even if another
      // superuser saved since the page loaded; the head is left as it is.
      setBranding(data.public);
    } catch (err) {
      loadError = panelError(err, onAuth) ?? '';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  /** D14: show a save at once: the cards, and this panel's title, icons, theme and logo. */
  function show(answer: PanelBranding): void {
    data = answer;
    void applyBranding(answer.public, document);
  }

  const plural = (n: number) => `${n} ${n === 1 ? 'colour' : 'colours'} changed:`;
</script>

{#snippet pencil(label: string, kind: 'name' | 'logo' | 'icon' | 'colours')}
  <IconButton glyph="pencil" size="md" title="Edit" aria-label={label} data-action="edit" onclick={() => (dialog = kind)} />
{/snippet}

<div class="b-page">
  <PanelHead title="Branding" />

  {#if loading}
    <Skeleton rows={4} label="Loading branding…" />
  {:else if loadError || !data}
    <ErrorState title="Could not load branding." message={loadError} onretry={() => void load()} retryLabel="Try again" />
  {:else}
    {@const pub = data.public}
    {@const changed = Object.keys(data.colours.changes)}
    {@const iconSrc = pub.icon ? `/api/branding/icon.png?v=${pub.icon}` : '/api/branding/icon-default.svg'}
    <section class="b-card" aria-labelledby="b-name">
      <div class="b-card-head">
        <h2 id="b-name">Site name</h2>
        {@render pencil('Edit site name', 'name')}
      </div>
      <dl>
        <dt>Name</dt>
        <dd>{data.name}</dd>
      </dl>
      <p class="b-foot">Used for the tab title, emails and the logo's alt text. The header shows your logo, or Mathion's when you haven't uploaded one.</p>
    </section>

    <section class="b-card" aria-labelledby="b-logo">
      <div class="b-card-head">
        <h2 id="b-logo">Logo</h2>
        {@render pencil('Edit logo', 'logo')}
      </div>
      <dl>
        <dt>In the header</dt>
        <dd class="b-row">
          <span class="b-box">
            <SiteLogo size="header" image={pub.logo ? { src: `/api/branding/logo.png?v=${pub.logo.version}`, width: pub.logo.width, height: pub.logo.height } : null} />
          </span>
          <span class="b-note">{data.logo ? `your upload, ${data.logo.width} × ${data.logo.height} px` : 'default'}</span>
        </dd>
      </dl>
    </section>

    <section class="b-card" aria-labelledby="b-icon">
      <div class="b-card-head">
        <h2 id="b-icon">Tab icon</h2>
        {@render pencil('Edit tab icon', 'icon')}
      </div>
      <dl>
        <dt>Icon</dt>
        <dd class="b-row">
          <img src={iconSrc} width="32" height="32" alt="" />
          <img src={iconSrc} width="16" height="16" alt="" />
          <span class="b-note">{data.icon ? 'your upload' : 'default: the Mathion mark'}</span>
        </dd>
      </dl>
    </section>

    <section class="b-card" aria-labelledby="b-colours">
      <div class="b-card-head">
        <h2 id="b-colours">Colours</h2>
        {@render pencil('Edit colours', 'colours')}
      </div>
      <dl>
        <dt>Theme</dt>
        <dd>
          {#if changed.length === 0}default{:else}{plural(changed.length)} {#each changed as n, i (n)}<code>{n}</code>{i < changed.length - 1 ? ', ' : ''}{/each}{/if}
        </dd>
      </dl>
      {#if data.colours.warnings.length}
        <!-- D10: the saved colours' contrast warnings stay on the card. -->
        <ul class="b-warnings">
          {#each data.colours.warnings as w (w)}
            <li>{#each ticked(w) as part, i (i)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}</li>
          {/each}
        </ul>
      {/if}
      <div class="b-actions">
        <Button variant="secondary" onclick={() => data && downloadTheme(data.colours)}>Download the current theme</Button>
      </div>
    </section>

    {#if dialog === 'name'}
      <EditSiteNameDialog name={data.name} {onAuth} onClose={() => (dialog = null)} onDone={() => (dialog = null)}
        save={async (body) => { show(await saveSiteName(token, body)); }} />
    {:else if dialog === 'logo' || dialog === 'icon'}
      {@const kind = dialog}
      {@const size = data[kind]}
      {@const version = kind === 'logo' ? pub.logo?.version : pub.icon}
      <EditImageDialog {kind} saved={size && version ? { ...size, version } : null} {onAuth}
        onClose={() => (dialog = null)} onDone={() => (dialog = null)}
        save={async (part, filename) => { show(await saveImage(token, kind, part, filename)); }} />
    {:else if dialog === 'colours'}
      <EditColoursDialog colours={data.colours} {onAuth} onClose={() => (dialog = null)} onDone={() => (dialog = null)}
        check={(bytes, filename) => checkTheme(token, bytes, filename)}
        save={async (part, filename) => { show(await saveTheme(token, part, filename)); }} />
    {/if}
  {/if}
</div>

<style>
  /* The Settings page's column and cards (SuperuserSettings.svelte). */
  .b-page { max-width: 760px; }
  .b-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); margin: 0 0 14px; }
  .b-card-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--border); }
  .b-card-head h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  dl { display: grid; grid-template-columns: 210px 1fr; margin: 0; padding: 6px 16px 10px; font-size: 13px; }
  dt { padding: 5px 0; color: var(--muted); }
  dd { margin: 0; padding: 5px 0; color: var(--text); overflow-wrap: anywhere; }
  dd code { font-family: var(--font-mono); font-size: 12.5px; }
  .b-row { display: flex; align-items: center; gap: 10px; }
  /* The logo at its real header size, in the dialog's dashed box (D4). */
  .b-box {
    display: flex;
    align-items: center;
    box-sizing: content-box;
    width: 160px;
    height: 20px;
    padding: 2px;
    border: 1px dashed var(--border-strong);
  }
  .b-note { font-size: 12.5px; color: var(--muted); }
  .b-foot { margin: 0; padding: 0 16px 12px; font-size: 12.5px; color: var(--muted); }
  /* D10: advice, never a refusal, so the image dialogs' gold. */
  .b-warnings { margin: 0; padding: 0 16px 8px 34px; font-size: 12.5px; color: var(--gold-text); }
  .b-warnings code { font-family: var(--font-mono); font-size: 12px; }
  .b-actions { padding: 0 16px 14px; }
</style>
