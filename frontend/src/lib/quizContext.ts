// Slice-5d: what the quiz body shares with its cards (setContext in QuizBody).
// The getters read the body's props, so they stay reactive.
import type { SvelteSet } from 'svelte/reactivity';
import type { QuizEdits } from './quizEdits.svelte';
import type { AuthoringQuestion } from './quizAuthoring';
import type { AssetContext } from './assetContext';

export const QUIZ_CTX = Symbol('quiz');

export type QuizCtx = {
  readonly edits: QuizEdits;
  readonly itemId: number;
  readonly assetContext: AssetContext;
  readonly canText: boolean;      // text fields and the answer key (created, published)
  readonly canStruct: boolean;    // add, move, delete (created)
  readonly published: boolean;    // answer-key changes confirm first
  readonly disabled: boolean;     // plain source, no rendered HTML (5b D6)
  readonly busyQuestions: SvelteSet<number>;  // the per-question lock
  readonly quizLock: boolean;     // the per-quiz lock (question add, move, delete)
  live(): boolean;                // still mounted and still on this version
  say(message: string): void;     // the polite live region
  // The message for a failed request. On 403/409 it also reloads the tree, so
  // permissions re-derive; if that removed the focused control, focus falls back
  // to question `qid`'s ✎, else "+ Add question", else × (R6).
  failed(e: unknown, qid?: number | null): string;
  // Write echo fields back into the question list (only the fields a request carried).
  patch(qid: number, fields: Partial<AuthoringQuestion>): void;
  hasQuestion(qid: number): boolean;
  // Focus the card's ✎, else "+ Add question", else × (spec §Focus, Fallback).
  focusFallback(qid: number | null): void;
};
