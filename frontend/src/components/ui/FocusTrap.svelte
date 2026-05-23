<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    autofocusSelector = 'input, select, textarea, button',
    children,
  }: {
    autofocusSelector?: string;
    children: Snippet;
  } = $props();

  let containerEl: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;

  function getFocusable(): HTMLElement[] {
    if (!containerEl) return [];
    return Array.from(containerEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
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
      const first = containerEl?.querySelector<HTMLElement>(autofocusSelector);
      first?.focus();
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
