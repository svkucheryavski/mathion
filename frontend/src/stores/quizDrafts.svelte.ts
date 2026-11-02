import { session } from './session.svelte';

// D83: a student's unsubmitted quiz answers, kept per quiz while they move
// around the course. QuizItem keeps its own `answers`; this is its mirror.
// Item ids are global primary keys, so the id alone is unique.
export type Draft = Record<string, number[] | string>;

// C14: each draft records who typed it. A 401 → sign-in round trip keeps the
// drafts; an explicit sign-out or a different user signing in drops them.
const drafts = $state<Record<number, { owner: number; answers: Draft }>>({});

/** The same test as QuizItem's `allAnswered`: a non-empty array or a non-blank string. */
export function holdsAnswers(a: number[] | string | undefined): boolean {
  if (Array.isArray(a)) return a.length > 0;
  return typeof a === 'string' && a.trim().length > 0;
}

export function getDraft(itemId: number): Draft | undefined {
  const d = drafts[itemId];
  return d === undefined ? undefined : $state.snapshot(d.answers);
}

export function setDraft(itemId: number, answers: Draft): void {
  const user = session.user;
  if (user === null) return;
  listenForUnload();
  if (!Object.values(answers).some(holdsAnswers)) {
    delete drafts[itemId];
    return;
  }
  drafts[itemId] = { owner: user.id, answers: $state.snapshot(answers) };
}

export function clearDraft(itemId: number): void {
  delete drafts[itemId];
}

export function clearAllDrafts(): void {
  for (const id of Object.keys(drafts)) delete drafts[Number(id)];
}

export function dropDraftsNotOwnedBy(userId: number): void {
  for (const [id, d] of Object.entries(drafts)) {
    if (d.owner !== userId) delete drafts[Number(id)];
  }
}

/** A draft is stored only while it holds answers, so any entry counts. */
export function hasUnsavedDrafts(): boolean {
  return Object.keys(drafts).length > 0;
}

// P119: one listener, added on the first write and kept; it warns only while
// a draft holds answers (the mechanism DirtyGuard uses).
let listening = false;
function listenForUnload(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('beforeunload', (e) => {
    if (!hasUnsavedDrafts()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
