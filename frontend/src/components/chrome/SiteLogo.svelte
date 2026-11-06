<script lang="ts">
  // Branding D4: the uploaded logo, or Mathion's drawn lockup (the mark plus the
  // "Mathion" wordmark, which the site name never replaces). Used by the app
  // header, the panel shell ('header') and the sign-in page ('login').
  // The image hugs its width: 20px tall up to 160px wide (28/224 on the sign-in
  // page). width/height give only its shape, so its space is kept while it loads.
  import { branding, PRODUCT_NAME } from '../../lib/branding.svelte';
  import Logo from '../ui/Logo.svelte';

  let { size }: { size: 'header' | 'login' } = $props();

  // The version that failed to load; a new upload is tried again.
  let failed = $state<string | null>(null);
  const logo = $derived(branding.logo && branding.logo.version !== failed ? branding.logo : null);
</script>

{#if logo}
  <img class={size === 'header' ? 'logo-header' : 'logo-login'}
       src={`/api/branding/logo.png?v=${logo.version}`}
       alt={branding.name} width={logo.width} height={logo.height}
       onerror={() => { failed = logo.version; }} />
{:else if size === 'header'}
  <span class="lockup-header">
    <span class="mark-header"><Logo /></span>
    <span class="wordmark-header">{PRODUCT_NAME}</span>
  </span>
{:else}
  <span class="lockup-login">
    <Logo form="login" />
    <span class="wordmark-login">{PRODUCT_NAME}</span>
  </span>
{/if}

<style>
  .logo-header {
    display: block;
    height: 20px;
    width: auto;
    max-width: 160px;
    object-fit: contain;
    object-position: left center;
  }
  .logo-login {
    display: block;
    height: 28px;
    width: auto;
    max-width: 224px;
    object-fit: contain;
    object-position: left center;
  }
  /* The lockup — exact geometry (visual refresh spec §2): mark + wordmark,
     centre-aligned, gap 7px, mark nudged up 4.35px so its stroke ends land on
     the wordmark baseline. */
  .lockup-header {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .mark-header {
    display: inline-flex;
    transform: translateY(-4.35px);
  }
  .wordmark-header {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .lockup-login {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .wordmark-login {
    font-size: 15px; /* ref 1990 */
    font-weight: 600;
    letter-spacing: -.01em;
    color: var(--text);
  }
</style>
