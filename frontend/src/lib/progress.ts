import type { Item, VersionState } from './types';

// Progress and quiz score over any set of items (user, 2026-10-08): a sequence
// row, a block header and the course summary all call progressOf over their own
// items, so the three apply one set of rules and can never disagree.
export type Progress = {
  covered: number;
  total: number;
  /** Share of items done, rounded DOWN: "100%" only once every item is done. */
  pct: number;
  /** The bar's width: `pct`, but at least 2% once anything is done (CourseCard's rule). */
  barPct: number;
  done: boolean;
  hasQuiz: boolean;
  /** Points earned ÷ points possible over the quizzes TRIED (latest attempt),
   *  rounded; null when no quiz has been tried (or only zero-point ones).
   *  An untried quiz is left out, not counted as 0: students aren't sent its
   *  point total, and the bar already says how much is left. */
  quizPct: number | null;
};

export function progressOf(items: Item[], state: VersionState): Progress {
  const total = items.length;
  let covered = 0;
  let hasQuiz = false;
  let got = 0;
  let max = 0;
  for (const it of items) {
    const s = state.items[String(it.id)];
    if (s?.is_covered) covered++;
    if (it.type !== 'quiz') continue;
    hasQuiz = true;
    const ls = s?.last_score;
    if (!ls || ls.total <= 0) continue;
    got += ls.correct;
    max += ls.total;
  }
  const pct = total ? Math.floor((covered / total) * 100) : 0;
  return {
    covered,
    total,
    pct,
    barPct: covered > 0 ? Math.max(pct, 2) : 0,
    done: total > 0 && covered === total,
    hasQuiz,
    quizPct: max > 0 ? Math.round((got / max) * 100) : null,
  };
}

/** The same facts in words, for screen readers: the bar and chip are aria-hidden. */
export function progressPhrase(p: Progress): string {
  return (
    `${p.covered} of ${p.total} ${p.total === 1 ? 'item' : 'items'} completed` +
    (p.quizPct !== null ? `, quiz score ${p.quizPct}%` : p.hasQuiz ? ', no quizzes tried yet' : '')
  );
}
