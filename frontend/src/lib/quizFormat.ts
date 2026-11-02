// Slice-5d display rules for the quiz overview (spec §A question card,
// §Answers): the type chips, the Number line and the light hints.
import { validateNumericAnswer, type AuthoringOption, type QuestionType } from './quizAuthoring';

export const TYPE_LABEL: Record<QuestionType, string> = {
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  numeric_answer: 'Number',
  text_answer: 'Text',
};

// The stored answer is a JSON float; this prints it as authors typed it and
// never in exponent notation (String(1e-7) would give "1e-7").
const NUMBER = new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 15 });
export function formatNumber(n: number): string {
  return NUMBER.format(n === 0 ? 0 : n);   // -0 prints "0"
}

export function decimalsText(d: number): string {
  return d === 1 ? '1 decimal' : `${d} decimals`;
}

/** "± 0.005" for 2 decimals: half a unit in the last place. */
export function toleranceText(d: number): string {
  return `± ${(5 * 10 ** -(d + 1)).toFixed(d + 1)}`;
}

/** Answer text in the names of the marker, the arrows and delete. */
export function cutName(text: string, max = 40): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** D9: light hints, in display order. `options` is null until they load. */
export function questionHints(
  type: QuestionType, options: AuthoringOption[] | null, precision: number | null,
): string[] {
  if (type === 'numeric_answer') return precision == null ? ['Decimals not set'] : [];
  if (type === 'text_answer' || options === null) return [];
  if (options.length === 0) return ['No answers yet'];
  const hints: string[] = [];
  if (options.length === 1) hints.push('Add at least 2 answers');
  const correct = options.filter((o) => o.is_correct).length;
  if (correct === 0) hints.push('No correct answer');
  if (type === 'single_choice' && correct > 1) hints.push('More than one correct');
  return hints;
}

/** A Number edit is unchanged when its canonical form matches the stored one ("5.0" vs 5). */
export function sameNumber(typed: string, stored: number | null): boolean {
  if (stored == null) return typed.trim() === '';
  const t = validateNumericAnswer(typed);
  const s = validateNumericAnswer(formatNumber(stored));
  return t.ok && s.ok && t.canonical === s.canonical;
}
