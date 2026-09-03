import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MultiChoice from '../components/items/quiz/MultiChoiceQuestion.svelte';
import type { MultipleChoiceQuestion } from '../lib/types';

const CORRECT = [21, 23];

function question(): MultipleChoiceQuestion {
  return {
    id: 2,
    order: 1,
    type: 'multiple_choice',
    text_md: '',
    text_html: '<p>Which of these are even?</p>',
    options: [
      { id: 21, text: 'Two' },
      { id: 22, text: 'Three' },
      { id: 23, text: 'Six' },
      { id: 24, text: 'Nine' },
    ],
  };
}

type Props = {
  question: MultipleChoiceQuestion;
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
  component = mount(MultiChoice, { target: host, props: reactive });
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
function revealOf(row: Element): string[] {
  return REVEAL.filter((c) => row.classList.contains(c));
}
function toggle(index: number): void {
  rows()[index].querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  flushSync();
}

describe('MultiChoiceQuestion structure (T2)', () => {
  it('wraps the option rows in .opts, each a label.opt with a native input + drawn .ctl', () => {
    render();

    const opts = host.querySelector('.opts');
    expect(opts).not.toBeNull();
    expect(rows().length).toBe(4);
    rows().forEach((row) => {
      expect(row.parentElement).toBe(opts);
      expect(row.querySelector('input[type="checkbox"]')).not.toBeNull();
      expect(row.querySelector('span.ctl')).not.toBeNull();
    });
  });

  it('marks each ticked row .selected and renders its check SVG only when chosen', () => {
    render();

    expect(host.querySelector('.ctl svg.check')).toBeNull();

    toggle(0);
    toggle(2);

    expect(rows()[0].classList.contains('selected')).toBe(true);
    expect(rows()[2].classList.contains('selected')).toBe(true);
    expect(rows()[1].classList.contains('selected')).toBe(false);
    expect(rows()[0].querySelector('.ctl svg.check[aria-hidden="true"]')).not.toBeNull();
    expect(rows()[1].querySelector('.ctl svg.check')).toBeNull();
    expect(host.querySelectorAll('.ctl svg.check').length).toBe(2);

    // Untick returns the row to unselected and removes its glyph.
    toggle(0);
    expect(rows()[0].classList.contains('selected')).toBe(false);
    expect(rows()[0].querySelector('.ctl svg.check')).toBeNull();
  });
});

describe('MultiChoiceQuestion pre-reveal (T2)', () => {
  it('fires no reveal class before submit, even after picks', () => {
    render();
    toggle(0);
    toggle(1);

    rows().forEach((row) => expect(revealOf(row)).toEqual([]));
    expect(host.querySelector('.mark')).toBeNull();
    expect(host.querySelector('.sr-only')).toBeNull();
  });

  it('recedes as .locked when disabled before the reveal, with no reveal class', () => {
    render({ value: [21], disabled: true });

    rows().forEach((row) => {
      expect(row.classList.contains('locked')).toBe(true);
      expect(revealOf(row)).toEqual([]);
      // `disabled` on the native input is the ONLY thing making the row inert:
      // the recede paints `cursor:default` but cannot stop a click.
      expect(row.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    });
    expect(rows()[0].classList.contains('selected')).toBe(true);
  });
});

describe('MultiChoiceQuestion reveal (D2, T2)', () => {
  // Correct = {21, 23}; the student picked {21, 22} — one right, one wrong, one
  // missed, one untouched: all four reveal classes on a single screen.
  const partial = { value: [21, 22], disabled: true, correctOptionIds: CORRECT };

  it('partitions a partial answer across all four reveal classes', () => {
    render(partial);

    expect(revealOf(rows()[0])).toEqual(['reveal-correct']);
    expect(revealOf(rows()[1])).toEqual(['reveal-wrong']);
    expect(revealOf(rows()[2])).toEqual(['reveal-missed']);
    // A revealed row must stay inert — a click would mutate the answer map
    // underneath the reveal.
    rows().forEach((row) => expect(row.querySelector<HTMLInputElement>('input')!.disabled).toBe(true));
    expect(revealOf(rows()[3])).toEqual(['reveal-neutral']);
    rows().forEach((row) => expect(row.classList.contains('locked')).toBe(false));
  });

  it('labels each evaluative row for assistive tech and leaves neutral unmarked', () => {
    render(partial);

    expect(rows()[0].querySelector('.sr-only')?.textContent).toBe('Correct answer — you chose this');
    expect(rows()[1].querySelector('.sr-only')?.textContent).toBe('Your answer — incorrect');
    expect(rows()[2].querySelector('.sr-only')?.textContent).toBe('Correct answer — you missed this');

    [0, 1, 2].forEach((i) => {
      expect(rows()[i].querySelector('svg.mark[aria-hidden="true"]')).not.toBeNull();
    });
    expect(rows()[3].querySelector('svg.mark')).toBeNull();
    expect(rows()[3].querySelector('.sr-only')).toBeNull();
  });

  it('keeps the selection glyph on a chosen reveal row', () => {
    render(partial);

    // The .ctl mark reports the student's SELECTION, the flush-right mark
    // reports CORRECTNESS — a chosen-correct row deliberately shows both.
    expect(rows()[0].querySelector('.ctl svg.check[aria-hidden="true"]')).not.toBeNull();
    expect(rows()[1].querySelector('.ctl svg.check[aria-hidden="true"]')).not.toBeNull();
    expect(rows()[2].querySelector('.ctl svg.check')).toBeNull();
    expect(rows()[3].querySelector('.ctl svg.check')).toBeNull();
  });

  it('still shows a correct answer the student answered nothing for', () => {
    render({ value: undefined, disabled: true, correctOptionIds: CORRECT });

    expect(revealOf(rows()[0])).toEqual(['reveal-correct']);
    expect(revealOf(rows()[2])).toEqual(['reveal-correct']);
    expect(rows()[0].querySelector('.sr-only')?.textContent).toBe('Correct answer');
    expect(revealOf(rows()[1])).toEqual(['reveal-neutral']);
    expect(revealOf(rows()[3])).toEqual(['reveal-neutral']);
  });
});
