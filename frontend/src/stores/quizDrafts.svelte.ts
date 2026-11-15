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

/** What a submit holds while in flight: its draft as stored (owner kept, if
 *  there was one), which send it was, who sent it, and the sign-out count
 *  when it left. */
export type HeldDraft = {
  draft: { owner: number; answers: Draft } | undefined;
  send: number;
  userId: number | null;
  signOuts: number;
};

// Plain bookkeeping, not state: the latest send per quiz, how many explicit
// sign-outs (clearAllDrafts) there have been, and the sends whose answers are
// not safe yet (the unload warning counts them).
const sends: Record<number, number> = {};
let signOuts = 0;
const inFlight = new Set<HeldDraft>();

/** VR-B: a submit takes its draft out of the store when it sends the answers.
 *  Until endSend, the page still warns before closing. */
export function takeDraft(itemId: number): HeldDraft {
  const d = drafts[itemId];
  // Every send counts as the newest, with or without a draft: its answers are
  // the latest the student sent.
  const send = (sends[itemId] ?? 0) + 1;
  sends[itemId] = send;
  const held: HeldDraft = {
    draft: d === undefined ? undefined : $state.snapshot(d),
    send,
    userId: session.user?.id ?? null,
    signOuts,
  };
  if (held.draft !== undefined) inFlight.add(held);
  delete drafts[itemId];
  return held;
}

/** The send settled (answered or failed): its answers no longer need the warning. */
export function endSend(held: HeldDraft): void {
  inFlight.delete(held);
}

/** VR-B: whether a late answer still belongs in this tab: nobody signed out
 *  since (C14: an explicit sign-out drops everything) and nobody else is
 *  signed in. A 401 has already signed the student out (no user) when the
 *  catch runs; C14 keeps their work through that sign-in round trip, and
 *  dropDraftsNotOwnedBy decides at sign-in. A send made with nobody signed in
 *  (none today: a quiz needs a session) is owned only while nobody is. */
export function sendStillOwned(held: HeldDraft): boolean {
  const user = session.user;
  return held.signOuts === signOuts && (user === null || user.id === held.userId);
}

/** VR-B: a failed submit puts its draft back, but only if the send is still
 *  owned (above), it is the latest send of that quiz (an older send holds
 *  older answers) and no draft was typed since. */
export function restoreDraft(itemId: number, held: HeldDraft): void {
  const d = held.draft;
  if (d === undefined || held.send !== sends[itemId] || !sendStillOwned(held)) return;
  if (drafts[itemId] !== undefined) return;
  listenForUnload();
  drafts[itemId] = d;
}

export function clearAllDrafts(): void {
  signOuts += 1;
  inFlight.clear();
  for (const id of Object.keys(drafts)) delete drafts[Number(id)];
}

export function dropDraftsNotOwnedBy(userId: number): void {
  for (const [id, d] of Object.entries(drafts)) {
    if (d.owner !== userId) delete drafts[Number(id)];
  }
  for (const h of inFlight) if (h.userId !== userId) inFlight.delete(h);
}

/** A draft is stored only while it holds answers, so any entry counts; so
 *  does a send still carrying a draft's answers. */
export function hasUnsavedDrafts(): boolean {
  return Object.keys(drafts).length > 0 || inFlight.size > 0;
}

// P119: one listener, added on the first write and kept; it warns only while
// a draft holds answers or a send still carries one (the mechanism DirtyGuard
// uses).
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
