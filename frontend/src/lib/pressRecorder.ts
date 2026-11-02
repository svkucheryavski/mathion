// Polish 3 C7 point 6 (F13): Safari does not focus a clicked button, so a
// FocusTrap opened by a mouse press finds focus on <body> (or on an ancestor
// such as a modal panel) and would return there on close. One app-wide
// capture-phase listener remembers the control the last primary press hit (a
// [role=button] only when focus can reach it, i.e. it has a tabindex); a
// press on anything else resets it, and any keydown clears it (a keyboard opener
// already holds focus, and an old press must not become a later return target).
let pressed: HTMLElement | null = null;
let installed = false;

export function ensurePressRecorder(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', (e) => {
    pressed = e.button === 0 && e.target instanceof Element
      ? e.target.closest<HTMLElement>('button, a[href], [role=button][tabindex]')
      : null;
  }, true);
  document.addEventListener('keydown', () => { pressed = null; }, true);
}

export function lastPressed(): HTMLElement | null {
  return pressed;
}
