// The spec's focus fallback: focus the first candidate that can take focus —
// connected, not disabled, not aria-disabled, and actually focused. Callers
// list candidates in order (the opener, the same action on the next / previous
// row, the section's +, the section's h2 with tabindex=-1).
export function focusFirst(candidates: (HTMLElement | null | undefined)[]): boolean {
  for (const el of candidates) {
    if (!el || !el.isConnected) continue;
    if ((el as HTMLButtonElement).disabled) continue;
    if (el.getAttribute('aria-disabled') === 'true') continue;
    el.focus();
    // A hidden or non-focusable element ignores focus(): try the next one.
    if (document.activeElement === el) return true;
  }
  return false;
}
