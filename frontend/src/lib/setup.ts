// Set up (superuser Set up spec): the wizard's state, its panel calls, and the
// shell's entry rules (D1, D2). The state mirrors backend/mathion/schemas.py.
import { api } from './api';
import type { PanelAdmin } from './superuser';

// Every panel call passes skipAuthRedirect: the shell handles 401 and 404 (D25).
const opts = { skipAuthRedirect: true };
const base = (token: string) => `/api/superuser/${token}/setup`;

/** D4, D6–D9: one step; `reason` is D6's or D7's not-done sentence. */
export type PanelSetupStep = { passed: boolean; done: boolean; reason: string | null };

/** D8: the lowest-id course with an admin, for the done view. */
export type PanelSetupCourse = { name: string; sign_in_url: string; admin: PanelAdmin };

/** D13: the one read, and every wizard write's answer. */
export type PanelSetup = {
  wizard_on: boolean;
  /** 1–4: the stored step while on, else 1. */
  step: number;
  /** Email, Site name and logo, First course, Sign-in rules and limits. */
  steps: PanelSetupStep[];
  course: PanelSetupCourse | null;
  course_without_admin: string | null;
  email_set_up: boolean;
  pin_minutes: number;
  defaults_in_use: boolean;
};

export function getSetup(token: string): Promise<PanelSetup> {
  return api.get<PanelSetup>(base(token), opts);
}

/** D4: go to step n. */
export function setupGo(token: string, step: number): Promise<PanelSetup> {
  return api.post<PanelSetup>(`${base(token)}/go`, { step }, opts);
}

/** D4, D4a: skip step n (steps 2 and 4 keep their defaults). */
export function setupSkip(token: string, step: number): Promise<PanelSetup> {
  return api.post<PanelSetup>(`${base(token)}/skip`, { step }, opts);
}

/** D4: step n saved, after its own saves or Continue. */
export function setupSaved(token: string, step: number): Promise<PanelSetup> {
  return api.post<PanelSetup>(`${base(token)}/saved`, { step }, opts);
}

/** D9, D12: keep the sign-in and limit values, whatever the wizard's state. */
export function keepSignIn(token: string): Promise<PanelSetup> {
  return api.post<PanelSetup>(`${base(token)}/keep-sign-in`, undefined, opts);
}

// --- D2: once per browser tab and link ---

/** The sessionStorage mark; it holds the link's token. */
export const SETUP_MARK = 'superuser_setup_seen';

/** This tab already saw the wizard on for this link; a mark for another token is none. */
export function markFor(token: string): boolean {
  try {
    return sessionStorage.getItem(SETUP_MARK) === token;
  } catch {
    return false;
  }
}

export function setMark(token: string): void {
  try {
    sessionStorage.setItem(SETUP_MARK, token);
  } catch {
    // Storage blocked: every open of the panel's own address lands on Set up.
  }
}

export function clearMark(): void {
  try {
    sessionStorage.removeItem(SETUP_MARK);
  } catch {
    // Nothing to clear.
  }
}

/**
 * D1, D2: where the shell goes when a state answers. `seg` is the segment
 * after the token (undefined on the panel's own address). The panel's own
 * address goes to Set up while on and not marked; Set up goes to the
 * Dashboard when over.
 */
export function entryMove(seg: string | undefined, state: PanelSetup, marked: boolean): 'to-setup' | 'to-dashboard' | null {
  if (seg === undefined) return state.wizard_on && !marked ? 'to-setup' : null;
  if (seg === 'setup') return state.wizard_on ? null : 'to-dashboard';
  return null;
}

// --- D12: the Finish setting up card ---

/** One line of the card: a step not done, with its reason and where to do it. */
export type FinishLine = {
  step: 1 | 2 | 3 | 4;
  title: string;
  reason: string | null;
  page: 'settings' | 'branding' | 'courses';
  /** D12: only the Sign-in and limits line has Keep these values. */
  keep: boolean;
};

const FINISH: { title: string; page: FinishLine['page'] }[] = [
  { title: 'Email', page: 'settings' },
  { title: 'Site name and logo', page: 'branding' },
  { title: 'First course and its admin', page: 'courses' },
  { title: 'Sign-in rules and limits', page: 'settings' },
];

/** D12: one line per step not done, in step order. D6's and D7's reasons come
 *  from the server; step 3 names the course with no admin; step 4 says when
 *  Mathion's defaults are in use. */
export function finishLines(state: PanelSetup): FinishLine[] {
  const lines: FinishLine[] = [];
  state.steps.forEach((s, i) => {
    if (s.done) return;
    const step = (i + 1) as FinishLine['step'];
    let reason = s.reason;
    if (step === 3) reason = state.course_without_admin ? `${state.course_without_admin} has no admin` : null;
    if (step === 4) reason = state.defaults_in_use ? "(Mathion's defaults are in use)" : null;
    lines.push({ step, ...FINISH[i], reason, keep: step === 4 });
  });
  return lines;
}
