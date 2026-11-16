// Set up §6: what every shared panel form has. The dialogs and the Set up
// steps hold one of these and show its error.
export class PanelForm<S = undefined> {
  /** What the form was built with: the saved values. A plain copy. */
  readonly saved: S;
  error = $state<string | null>(null);
  /** The body field the error names (a 422), or null. */
  errorField = $state<string | null>(null);
  /** Bumped by every edit, so an answer about older values can be dropped.
   *  Every change goes through `edited()`. */
  edits = 0;

  constructor(saved: S) {
    this.saved = $state.snapshot(saved) as S;
  }

  edited(): void {
    this.edits++;
    this.error = null;
    this.errorField = null;
  }
}

/** The dialogs' whole-number check. */
export const whole = (v: string): boolean => /^\d+$/.test(v.trim());
