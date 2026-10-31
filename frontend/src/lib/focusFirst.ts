import { usable } from './askInPlace.svelte';

// The spec's focus fallback: focus the first candidate that can take focus —
// connected, not disabled, not aria-disabled, not inert (Polish 3), and
// actually focused. Callers list candidates in order (the opener, the same
// action on the next / previous row, the section's +, the section's h2 with
// tabindex=-1).
export function focusFirst(candidates: (HTMLElement | null | undefined)[]): boolean {
  for (const el of candidates) {
    if (!usable(el)) continue;
    el.focus();
    // A hidden or non-focusable element ignores focus(): try the next one.
    if (document.activeElement === el) return true;
  }
  return false;
}
