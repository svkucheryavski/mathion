// Firefox before 125 has no Segmenter: there it counts code points, which can split a flag but never throws.
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** The visible characters of `s`: an emoji sequence or a letter with its accent is one. */
export function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);
}
