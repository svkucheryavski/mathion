<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    autofocusSelector = 'input, select, textarea, button',
    autofocusPriorityOrder = false,
    active = undefined,
    children,
  }: {
    autofocusSelector?: string;
    autofocusPriorityOrder?: boolean;
    // Slice-5d: a stacked Modal passes "am I the top modal"; without it the
    // trap is always active, as before (the run modals and side panels).
    active?: () => boolean;
    children: Snippet;
  } = $props();

  let containerEl: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;

  function getFocusable(): HTMLElement[] {
    if (!containerEl) return [];
    // A `hidden` element (e.g. a file input behind an upload button) or one in
    // an `inert` subtree can't take focus: `.focus()` on it is a no-op, so it
    // must never be the wrap target (Slice-5b T1 review).
    return Array.from(containerEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((el) => !el.closest('[hidden], [inert]'));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    if (active && !active()) return;
    const focusables = getFocusable();
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    previousFocus = (document.activeElement as HTMLElement) ?? null;
    document.addEventListener('keydown', onKeydown, true);
    queueMicrotask(() => {
      if (!containerEl) return;
      if (autofocusPriorityOrder) {
        // Comma-separated selector: try each in declaration order, return the
        // FIRST match (NOT first-in-DOM-order). Lets callers express a true
        // fallback chain — e.g. `'select[name="x"], [data-close]'` focuses the
        // select when present, else the close button.
        const selectors = autofocusSelector.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        for (const sel of selectors) {
          const el = containerEl.querySelector<HTMLElement>(sel);
          if (el) {
            el.focus();
            return;
          }
        }
      } else {
        const first = containerEl.querySelector<HTMLElement>(autofocusSelector);
        first?.focus();
      }
    });
    return () => {
      document.removeEventListener('keydown', onKeydown, true);
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  });
</script>

<div bind:this={containerEl}>{@render children()}</div>
