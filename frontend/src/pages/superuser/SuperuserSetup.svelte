<script lang="ts">
  // Set up D1, D3-D5: the wizard's page. The steps on the left, the shown card
  // on the right. The state is the shell's one copy (D13). The card follows a
  // re-read unless it holds an error, typed values or a note (D3a); this tab's
  // own moves always apply. Back, the skip button and a list click on a step
  // with unsaved changes ask first, under the card; Discard resets the form,
  // then the move is sent, and a failed move keeps the step with its error.
  // A first read that failed shows the panel's error state instead (D2).
  import { getContext, untrack } from 'svelte';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import AskSlot from '../../components/ui/AskSlot.svelte';
  import StepList from '../../components/superuser/setup/StepList.svelte';
  import StepCard from '../../components/superuser/setup/StepCard.svelte';
  import AllSetCard from '../../components/superuser/setup/AllSetCard.svelte';
  import StepEmail from '../../components/superuser/setup/StepEmail.svelte';
  import { DISCARD_NAV_ASK, focusAfter, InPlaceAsk } from '../../lib/askInPlace.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { session } from '../../stores/session.svelte';
  import {
    cardAfterOwn, cardAfterRead, setupGo, setupSkip, STEP_LABELS,
    type Card, type PanelSetup, type StepN,
  } from '../../lib/setup';
  import { panelError, type PanelOnAuth } from '../../lib/superuser';
  import type { SetupStore } from '../../lib/setupStore.svelte';

  let { setup, token, onAuth }: { setup: SetupStore; token: string; onAuth: PanelOnAuth } = $props();

  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const me = $derived(session.user?.email ?? null);

  let card = $state<Card | null>(null);
  /** A failed "go to" or "skip": it shows in the card and holds it (D3a). */
  let moveError = $state<string | null>(null);
  const busy = $derived(setup.busy || setup.saving);
  /** The shown step's own hold (D3a), set by the step when it opens. */
  const hold = { get: () => false };
  // D3a: an answer that lands while the card is busy (a write or a step's save) holds too.
  const held = () => moveError !== null || busy || hold.get();

  // D3a: the first state shows its step; later states move the card only when
  // nothing holds it. Own moves set the card themselves (show()).
  $effect(() => {
    const s = setup.state;
    untrack(() => {
      if (!s) return;
      setCard(card === null ? cardAfterOwn(s) : cardAfterRead(card, s, held()));
    });
  });

  // A new card's step tells the page its own hold when it opens.
  function setCard(next: Card): void {
    if (next !== card) hold.get = () => false;
    card = next;
  }

  function show(s: PanelSetup): void {
    moveError = null;
    setCard(cardAfterOwn(s));
  }


  // D3: the page's own leave question, under the card. Cancel puts focus back
  // on the control that asked (`from`, a selector inside the page).
  const ask = new InPlaceAsk();
  let pageEl = $state<HTMLElement | undefined>();
  async function leaveOk(from: string): Promise<boolean> {
    if (!registry?.isAnyDirty()) return true;
    const a = await ask.ask(DISCARD_NAV_ASK);
    if (a !== 'confirm') {
      if (a === 'cancel') void focusAfter(() => pageEl?.querySelector(from));
      return false;
    }
    ask.settle();
    registry.discardAll();
    return true;
  }

  async function move(write: () => Promise<PanelSetup>, from: string): Promise<void> {
    if (busy || ask.open) { ask.focusCancel(); return; }
    if (!(await leaveOk(from))) return;
    moveError = null;
    try {
      show(await setup.write(write));
    } catch (e) {
      moveError = panelError(e, onAuth);
    }
  }

  function go(n: StepN, from = `.sl-item[data-step="${n}"]`): void {
    if (n === card) return;
    void move(() => setupGo(token, n), from);
  }
  function skip(): void {
    if (typeof card === 'number') { const n = card; void move(() => setupSkip(token, n), '.st-foot [data-action="skip"]'); }
  }
  function back(): void {
    if (typeof card === 'number' && card > 1) go((card - 1) as StepN, '.st-foot [data-action="back"]');
  }

  function stepProps() {
    return {
      token, setup, onAuth, me, onDone: show, back, skip, moveError,
      onHold: (h: () => boolean) => { hold.get = h; },
    };
  }
</script>

<div class="sp-page" bind:this={pageEl}>
  <PanelHead title="Set up your site" />
  {#if setup.failed}
    <ErrorState title="Could not load set up." message={setup.error ?? undefined}
      onretry={() => void setup.read()} retryLabel="Try again" />
  {:else if setup.state && card !== null}
    <div class="sp-grid">
      <StepList steps={setup.state.steps} current={card === 'allset' ? null : card}
        blocked={busy || card === 'allset'} onGo={(n) => go(n)} />
      <div class="sp-main">
        {#key card}
          {#if card === 'allset'}
            <AllSetCard state={setup.state} {token} />
          {:else if card === 1}
            <StepEmail {...stepProps()} />
          {:else}
            <!-- Tasks 8 and 9 fill steps 2-4; until then, their frame alone. -->
            {@const n = card}
            <StepCard {n} title={STEP_LABELS[n - 1]} note={null} error={moveError} {busy} mode="none" canSave={false}
              onBack={back} onSkip={setup.state.steps[n - 1].done ? undefined : skip} onSave={() => {}} />
          {/if}
        {/key}
        {#if ask.open}<div class="sp-ask"><AskSlot {ask} /></div>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* The mockup's option A: the steps on the left, the card on the right. */
  .sp-grid { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 14px; align-items: start; }
  .sp-main { display: flex; flex-direction: column; gap: var(--space-3); max-width: 640px; }
</style>
