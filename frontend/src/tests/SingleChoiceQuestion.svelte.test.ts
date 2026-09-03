import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SingleChoice from '../components/items/quiz/SingleChoiceQuestion.svelte';
import type { SingleChoiceQuestion } from '../lib/types';

const IDS = [11, 12, 13, 14];
const CORRECT = 13;

function question(): SingleChoiceQuestion {
  return {
    id: 1,
    order: 1,
    type: 'single_choice',
    text_md: '',
    text_html: '<p>Which of these is prime?</p>',
    options: [
      { id: 11, text: 'Four' },
      { id: 12, text: 'Six' },
      { id: 13, text: 'Seven' },
      { id: 14, text: 'Nine' },
    ],
  };
}

type Props = {
  question: SingleChoiceQuestion;
  value: number[] | string | undefined;
  onanswer: (ans: number[]) => void;
  disabled: boolean;
  correctOptionIds: number[] | null;
};

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
let props: Props;

/** Mount with QuizItem's real contract: `onanswer` feeds the value back in. */
function render(over: Partial<Props> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const reactive = $state<Props>({
    question: question(),
    value: undefined,
    onanswer: (ans: number[]) => { props.value = ans; },
    disabled: false,
    correctOptionIds: null,
    ...over,
  });
  props = reactive;
  component = mount(SingleChoice, { target: host, props: reactive });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

const REVEAL = ['reveal-correct', 'reveal-wrong', 'reveal-missed', 'reveal-neutral'];

function rows(): HTMLLabelElement[] {
  return [...host.querySelectorAll<HTMLLabelElement>('label.opt')];
}
/** The reveal classes a row carries — the partition demands exactly one. */
function revealOf(row: Element): string[] {
  return REVEAL.filter((c) => row.classList.contains(c));
}
/**
 * Constraint 3: every decorative glyph is an `aria-hidden` 16-unit SVG painted
 * with `currentColor`. Asserting presence alone is not enough — the SVGs are
 * `fill="none"`, so deleting the stroke leaves an invisible glyph that every
 * class-level assertion still passes.
 */
function expectGlyph(svg: Element | null): void {
  expect(svg).not.toBeNull();
  expect(svg!.getAttribute('aria-hidden')).toBe('true');
  expect(svg!.getAttribute('viewBox')).toBe('0 0 16 16');
  expect(svg!.getAttribute('fill')).toBe('none');
  expect(svg!.getAttribute('stroke')).toBe('currentColor');
  expect(svg!.getAttribute('stroke-width')).toBe('1.9');
}

/** Indices whose NATIVE input reports checked — the drawn .ctl is decoration. */
function checkedOf(): number[] {
  return rows().flatMap((r, i) =>
    r.querySelector<HTMLInputElement>('input')!.checked ? [i] : []);
}
function pick(index: number): void {
  rows()[index].querySelector<HTMLInputElement>('input[type="radio"]')!.click();
  flushSync();
}

describe('SingleChoiceQuestion structure (T2)', () => {
  it('wraps the option rows in .opts, each a label.opt with a native input + drawn .ctl', () => {
    render();

    const opts = host.querySelector('.opts');
    expect(opts).not.toBeNull();
    expect(rows().length).toBe(4);
    rows().forEach((row) => {
      expect(row.parentElement).toBe(opts);
      // The native input stays the real focusable/checkable control, and the
      // shared `name` is what makes the four inputs one arrow-navigable group.
      expect(row.querySelector('input[type="radio"]')).not.toBeNull();
      expect(row.querySelector<HTMLInputElement>('input')!.name).toBe('q-1');
      // The drawn control is a real element, never a pseudo-element.
      expect(row.querySelector('span.ctl')).not.toBeNull();
    });
  });

  it('marks the picked row .selected and renders its inner dot only when chosen', () => {
    render();

    expect(rows().every((r) => !r.classList.contains('selected'))).toBe(true);
    expect(host.querySelector('.ctl .dot')).toBeNull();
    expect(checkedOf()).toEqual([]);

    pick(2);

    expect(rows()[2].classList.contains('selected')).toBe(true);
    expect(rows()[2].querySelector('.ctl .dot')).not.toBeNull();
    // The painted row is decoration; `checked` is what AT and the form read.
    expect(checkedOf()).toEqual([2]);
    // Single choice: exactly one row selected, one dot in the whole question.
    expect(rows().filter((r) => r.classList.contains('selected')).length).toBe(1);
    expect(host.querySelectorAll('.ctl .dot').length).toBe(1);
  });
});

describe('SingleChoiceQuestion pre-reveal (T2)', () => {
  it('fires no reveal class before submit, even after a pick', () => {
    render();
    pick(2);

    rows().forEach((row) => {
      expect(revealOf(row)).toEqual([]);
      // The inverse of the locked test: an answerable row must stay answerable.
      expect(row.classList.contains('locked')).toBe(false);
      expect(row.querySelector<HTMLInputElement>('input')!.disabled).toBe(false);
    });
    expect(host.querySelector('.mark')).toBeNull();
    expect(host.querySelector('.sr-only')).toBeNull();
  });

  it('recedes as .locked when disabled before the reveal, with no reveal class', () => {
    render({ value: [CORRECT], disabled: true });

    rows().forEach((row) => {
      expect(row.classList.contains('locked')).toBe(true);
      expect(revealOf(row)).toEqual([]);
      // `disabled` on the native input is the ONLY thing making the row inert:
      // the recede paints `cursor:default` but cannot stop a click.
      expect(row.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    });
    // The student's own pick stays visible on the score screen.
    expect(rows()[2].classList.contains('selected')).toBe(true);
    expect(checkedOf()).toEqual([2]);
  });
});

describe('SingleChoiceQuestion reveal (D2, T2)', () => {
  it('gives every option exactly one reveal class and drops .locked', () => {
    render({ value: [11], disabled: true, correctOptionIds: [CORRECT] });

    rows().forEach((row) => {
      expect(revealOf(row).length).toBe(1);
      expect(row.classList.contains('locked')).toBe(false);
      // A revealed row must stay inert — a click would mutate the answer map
      // underneath the reveal.
      expect(row.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    });
    // A revealed row still reports the student's own pick to AT.
    expect(checkedOf()).toEqual([0]);
  });

  it('labels a wrong pick and the correct option the student missed', () => {
    render({ value: [11], disabled: true, correctOptionIds: [CORRECT] });
    const [wrong, neutral, missed] = [rows()[0], rows()[1], rows()[2]];

    expect(revealOf(wrong)).toEqual(['reveal-wrong']);
    expectGlyph(wrong.querySelector('svg.mark'));
    expect(wrong.querySelector('.sr-only')?.textContent).toBe('Your answer — incorrect');

    expect(revealOf(missed)).toEqual(['reveal-missed']);
    expectGlyph(missed.querySelector('svg.mark'));
    expect(missed.querySelector('.sr-only')?.textContent).toBe('Correct answer — you missed this');

    // The leftover incorrect, unchosen rows recede with no mark and no SR label.
    expect(revealOf(neutral)).toEqual(['reveal-neutral']);
    expect(neutral.querySelector('svg.mark')).toBeNull();
    expect(neutral.querySelector('.sr-only')).toBeNull();
  });

  it('varies the correct row SR text by whether the student chose it', () => {
    render({ value: [CORRECT], disabled: true, correctOptionIds: [CORRECT] });

    const chosen = rows()[2];
    expect(revealOf(chosen)).toEqual(['reveal-correct']);
    expect(chosen.querySelector('.sr-only')?.textContent).toBe('Correct answer — you chose this');
  });

  it('still shows the correct answer when the student answered nothing', () => {
    render({ value: undefined, disabled: true, correctOptionIds: [CORRECT] });

    const correct = rows()[2];
    expect(revealOf(correct)).toEqual(['reveal-correct']);
    expectGlyph(correct.querySelector('svg.mark'));
    expect(correct.querySelector('.sr-only')?.textContent).toBe('Correct answer');
    // Unanswered is NOT "missed" — that reads as the student's failure.
    expect(correct.classList.contains('reveal-missed')).toBe(false);
    IDS.filter((id) => id !== CORRECT).forEach((_, i) => {
      const row = rows()[i === 2 ? 3 : i];
      if (row !== correct) expect(revealOf(row)).toEqual(['reveal-neutral']);
    });
  });
});
