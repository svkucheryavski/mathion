<script module lang="ts">
  // Open modals, bottom → top. Only the top one handles Escape/Tab and holds
  // focus (two containment listeners would bounce focus forever); the first
  // takes the scroll lock and the last one out releases it.
  const stack: HTMLElement[] = [];
  let savedOverflow = '';
</script>

<script lang="ts">
  // Generic modal frame (Slice-5b spec §1). It knows nothing about items: the
  // parent supplies header/body/footer snippets and decides what closing
  // means — Modal holds no dirty state. Slice 6 adopts it for the run modals.
  import { onMount, type Snippet } from 'svelte';
  import FocusTrap from './FocusTrap.svelte';
  import IconButton from './IconButton.svelte';

  type Props = {
    label?: string;
    labelledby?: string;
    width?: number;
    maxHeight?: number;
    onRequestClose: () => void;
    closeOnBackdrop?: boolean;
    autofocusSelector?: string;
    autofocusPriorityOrder?: boolean;
    closeDisabled?: boolean;
    bodyInert?: boolean;
    header: Snippet;
    children: Snippet;
    footer?: Snippet;
  };

  // A stable per-instance id for ×, so the default autofocus chain can name it
  // and never fall through to FocusTrap's own default (the header trash, D18).
  const uid = $props.id();
  const closeId = `${uid}-close`;

  let {
    label = undefined,
    labelledby = undefined,
    width = 920,
    maxHeight = 600,
    onRequestClose,
    closeOnBackdrop = false,
    autofocusSelector = `[data-autofocus], #${closeId}`,
    autofocusPriorityOrder = true,
    closeDisabled = false,
    bodyInert = false,
    header,
    children,
    footer = undefined,
  }: Props = $props();

  let panelEl: HTMLElement | undefined = $state();

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  // querySelectorAll still returns `hidden` elements and ones inside an `inert`
  // subtree, and .focus() on them is a silent no-op — filter them out here.
  function candidates(): HTMLElement[] {
    if (!panelEl) return [];
    return [...panelEl.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden], [inert]'));
  }
  function refocus(preferLast: boolean) {
    if (!panelEl) return;
    const list = candidates();
    if (preferLast) list.reverse();
    // Walk until focus lands (CSS-hidden elements refuse it too); the panel
    // (tabindex -1) is the last-resort target.
    for (const el of list) {
      el.focus();
      if (panelEl.contains(document.activeElement)) return;
    }
    panelEl.focus();
  }
  const isTop = () => !!panelEl && stack[stack.length - 1] === panelEl;

  function onKeydown(e: KeyboardEvent) {
    if (!isTop()) return;
    if (e.key === 'Tab') {
      // FocusTrap wraps Tab only on the exact first/last focusable; with
      // nothing focusable left (body inert, buttons disabled) hold the panel.
      if (candidates().length === 0) { e.preventDefault(); panelEl?.focus(); }
      return;
    }
    // keyCode 229 is Safari's IME-composition signal; inner widgets that own
    // an Escape (AccordionHeader's title field, AssetSidebar's inline
    // confirm) preventDefault first.
    if (e.key !== 'Escape' || closeDisabled || e.repeat || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    e.preventDefault();
    onRequestClose();
  }

  // D8: the backdrop never steals focus, and clicks on it close only on request.
  function onBackdropMousedown(e: MouseEvent) {
    if (e.target === e.currentTarget) e.preventDefault();
  }
  function onBackdropClick(e: MouseEvent) {
    if (closeOnBackdrop && e.target === e.currentTarget) onRequestClose();
  }

  onMount(() => {
    const html = document.documentElement;
    const panel = panelEl!;
    if (stack.length === 0) {
      savedOverflow = html.style.overflow;
      html.style.overflow = 'hidden';
    }
    stack.push(panel);
    // D18 containment. On teardown Svelte detaches the DOM and runs FocusTrap's
    // restore-to-opener BEFORE this cleanup; the isConnected bail keeps this
    // listener from fighting that restore.
    const onFocusIn = (e: FocusEvent) => {
      if (!panelEl || !panelEl.isConnected || !isTop()) return;
      const t = e.target as Node | null;
      if (t && panelEl.contains(t)) return;
      const from = e.relatedTarget as HTMLElement | null;
      refocus(from !== null && from === candidates()[0]);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      const i = stack.indexOf(panel);
      if (i !== -1) stack.splice(i, 1);
      if (stack.length === 0) html.style.overflow = savedOverflow;
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onmousedown={onBackdropMousedown} onclick={onBackdropClick}>
  <FocusTrap {autofocusSelector} {autofocusPriorityOrder} active={isTop}>
    <!-- HTML-ARIA allows role="dialog" on <section>; the lint is stricter than the spec. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section
      bind:this={panelEl}
      class="modal-panel"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledby}
      tabindex="-1"
      style:--modal-w="{width}px"
      style:--modal-h="{maxHeight}px"
    >
      <header class="modal-head">
        {@render header()}
        <IconButton id={closeId} glyph="close" size="md" title="Close" aria-label="Close" disabled={closeDisabled} onclick={onRequestClose} />
      </header>
      <!-- The attribute, not the property: Svelte compiles `inert={…}` to
           `el.inert = …`, which jsdom lacks, and candidates() reads [inert]. -->
      <div class="modal-body" {@attach (el) => { el.toggleAttribute('inert', bodyInert); }}>
        {@render children()}
      </div>
      {#if footer}
        <footer class="modal-foot">{@render footer()}</footer>
      {/if}
    </section>
  </FocusTrap>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100; /* (c): above the app header — the existing modals' value (D17) */
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 26px; /* ref 1684 */
    background: color-mix(in srgb, var(--text) 34%, transparent); /* ref 1682 */
    -webkit-backdrop-filter: blur(1px); /* (c): Safari < 18 */
    backdrop-filter: blur(1px); /* ref 1682 */
  }
  /* --modal-w / --modal-h are component-local, set from props — not theme tokens. */
  .modal-panel {
    box-sizing: border-box;
    width: min(var(--modal-w), 100vw - 32px); /* (c): 16px gutter each side */
    max-height: min(var(--modal-h), 100vh - 52px); /* (c): 26px above and below */
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 16px 44px rgba(20,24,35,.22); /* ref 1684 */
  }
  .modal-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px 12px 16px;
    border-bottom: 1px solid var(--border); /* ref 1685 */
  }
  .modal-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px; /* ref 1695 */
  }
  /* Children never shrink: the body scrolls instead (spec :220-221). */
  .modal-body > :global(*) { flex: 0 0 auto; }
  .modal-foot {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface-3); /* ref 1750 */
  }
</style>
