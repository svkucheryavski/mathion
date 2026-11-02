<script module lang="ts">
  import { ensurePressRecorder } from '../../lib/pressRecorder';
  // F13: installed on import, so the press that opens the first trap is seen.
  ensurePressRecorder();
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { canHoldFocus } from '../../lib/askInPlace.svelte';
  import { lastPressed } from '../../lib/pressRecorder';

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

  // Polish 3 F13: Safari leaves a clicked opener unfocused, so focus is on
  // <body> or on an ancestor of it (WebKit focuses the nearest focusable one).
  // Then the last-pressed control is the opener.
  function opener(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    const pressed = lastPressed();
    if (canHoldFocus(pressed) && (!a || a === document.body || (a !== pressed && a.contains(pressed)))) return pressed;
    return a;
  }

  // Polish 3 F5: a match that cannot hold focus is skipped (focus() on it is a
  // no-op, which would leave focus behind the modal).
  function focusIn(el: HTMLElement | null | undefined): boolean {
    if (!canHoldFocus(el)) return false;
    el.focus();
    return document.activeElement === el;
  }

  $effect(() => {
    previousFocus = opener();
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
          for (const el of containerEl.querySelectorAll<HTMLElement>(sel)) if (focusIn(el)) return;
        }
      } else {
        for (const el of containerEl.querySelectorAll<HTMLElement>(autofocusSelector)) if (focusIn(el)) return;
      }
      // Nothing matched that can hold focus: the panel (Modal's tabindex -1).
      focusIn(containerEl.querySelector<HTMLElement>('[tabindex="-1"]'));
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
