<script lang="ts">
  // Set up D3: one step's card. The title (focused when the card opens, so on
  // every step change), the note, the step's fields, the error, and the footer:
  // Back (not on step 1), the skip button (D4a names it; a done step has none)
  // and Save and continue, or Continue. While the page waits (`busy`), Back and
  // the skip button wait too; Save is blocked, not disabled, so focus stays on
  // it. Enter in a field is Save and continue.
  import type { Snippet } from 'svelte';
  import Button from '../../ui/Button.svelte';
  import { skipLabel, type StepN } from '../../../lib/setup';

  type Props = {
    n: StepN;
    title: string;
    note: string | null;
    error: string | null;
    busy: boolean;
    mode: 'save' | 'continue' | 'none';
    canSave: boolean;
    onBack?: () => void;
    onSkip?: () => void;
    onSave: () => void;
    children?: Snippet;
  };
  let { n, title, note, error, busy, mode, canSave, onBack, onSkip, onSave, children }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  // D3: focus moves to the heading when the card opens.
  const focusOnOpen = (el: HTMLElement) => { el.focus(); };
</script>

<section class="st-card" aria-labelledby={titleId}>
  <h2 id={titleId} class="st-title" tabindex="-1" {@attach focusOnOpen}>{title}</h2>
  {#if note}<p class="st-note">{note}</p>{/if}
  <form class="st-body" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); if (mode !== 'none') onSave(); }}>
    {@render children?.()}
    {#if error}<p id={errId} class="st-err" role="alert">{error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
  <div class="st-foot">
    {#if onBack}
      <Button variant="ghost" data-action="back" aria-disabled={busy} onclick={onBack}>Back</Button>
    {/if}
    <span class="st-spacer" aria-hidden="true"></span>
    {#if onSkip}
      <Button variant="ghost" data-action="skip" aria-disabled={busy} onclick={onSkip}>{skipLabel(n)}</Button>
    {/if}
    {#if mode !== 'none'}
      <Button variant="primary" data-action="save" aria-disabled={busy || (mode === 'save' && !canSave)}
        onclick={onSave}>{mode === 'continue' ? 'Continue' : 'Save and continue'}</Button>
    {/if}
  </div>
</section>

<style>
  /* The panel's white cards (the Dashboard's .card, Branding's .b-card). */
  .st-card {
    box-sizing: border-box;
    display: flex; flex-direction: column;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .st-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .st-title:focus { outline: none; }
  .st-note { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }
  .st-body { display: flex; flex-direction: column; gap: 6px; margin: 12px 0 0; }
  .st-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
  .st-foot { display: flex; align-items: center; gap: var(--space-2); margin: 14px 0 0; }
  .st-spacer { flex: 1; }
</style>
