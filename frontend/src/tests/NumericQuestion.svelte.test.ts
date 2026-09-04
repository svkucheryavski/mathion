import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Numeric from '../components/items/quiz/NumericQuestion.svelte';
import type { NumericQuestion } from '../lib/types';

const CORRECT = 80;

function question(): NumericQuestion {
  return {
    id: 5,
    order: 1,
    type: 'numeric_answer',
    text_md: '',
    // TWO paragraphs on purpose: the prompt's inter-paragraph rhythm is exactly
    // what a blanket `.text p { margin:0 }` would destroy, so the fixture has to
    // be able to show it.
    text_html: '<p>A train covers 120 km in 90 minutes.</p><p>What is its speed in km/h?</p>',
  };
}

type Props = {
  question: NumericQuestion;
  value: number[] | string | undefined;
  onanswer: (ans: string) => void;
  disabled: boolean;
  correctValue: number | null;
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
    onanswer: (ans: string) => { props.value = ans; },
    disabled: false,
    correctValue: null,
    ...over,
  });
  props = reactive;
  component = mount(Numeric, { target: host, props: reactive });
  flushSync();
  return host;
}

function teardown(): void {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
}
afterEach(teardown);

function field(): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('input')!;
}
function correctLine(): HTMLElement | null {
  return host.querySelector<HTMLElement>('.correct-line');
}
function typeIn(text: string): void {
  field().value = text;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('NumericQuestion structure (T3)', () => {
  it('renders a local control field, not ui/Input, with the numeral in mono', () => {
    render();

    expect(field().classList.contains('num')).toBe(true);
    // ui/Input is NOT usable here: it renders `class="input"`, its `mono` prop is
    // the 17px/.34em PIN treatment, and its prop list carries neither `inputmode`
    // nor `disabled` (and no rest-spread) — so a swap would silently drop both.
    expect(field().classList.contains('input')).toBe(false);
    // Constraint 4: the numeral the student types is mono, and via the GLOBAL
    // `.mono` utility rather than a component-local font-family.
    expect(field().classList.contains('mono')).toBe(true);
    expect(field().getAttribute('inputmode')).toBe('decimal');
    expect(field().type).toBe('text');
    expect(field().disabled).toBe(false);
  });

  it('keeps both prompt paragraphs and hangs prompt, field and answer off .row', () => {
    render({ value: '75', disabled: true, correctValue: CORRECT });

    const row = host.querySelector('.row');
    expect(row).not.toBeNull();
    // A collapsed prompt would render one paragraph; the rhythm between them is
    // the last-paragraph-only margin rule's whole reason to exist.
    expect(host.querySelectorAll('.text p').length).toBe(2);
    // All three are direct .row children, so the single 16px gap — not any
    // surviving child margin — owns prompt→field→answer.
    expect(host.querySelector('.text')!.parentElement).toBe(row);
    expect(field().parentElement).toBe(row);
    expect(correctLine()!.parentElement).toBe(row);
  });

  it('shows the student value and reports every keystroke', () => {
    render();
    expect(field().value).toBe('');

    typeIn('80');

    expect(props.value).toBe('80');
    expect(field().value).toBe('80');
  });

  it('goes inert when disabled, still showing what the student typed', () => {
    render({ value: '75', disabled: true });

    expect(field().disabled).toBe(true);
    expect(field().value).toBe('75');
  });
});

describe('NumericQuestion reveal (D2, T3)', () => {
  it('shows nothing before the reveal', () => {
    render({ value: '75' });

    expect(correctLine()).toBeNull();
  });

  it('shows only the correct answer, with the numeral in mono', () => {
    render({ value: '75', disabled: true, correctValue: CORRECT });

    expect(correctLine()!.textContent).toBe('Correct answer: 80');
    const answer = correctLine()!.querySelector('strong')!;
    expect(answer.textContent).toBe('80');
    // Constraint 4: this numeral is mono too, so the answer reads at the same
    // font as the field above it.
    expect(answer.classList.contains('mono')).toBe(true);
  });

  it('does not judge the student value — the reveal reads the same right or wrong', () => {
    const seen = ['75', '80'].map((studentValue) => {
      render({ value: studentValue, disabled: true, correctValue: CORRECT });
      const line = correctLine()!;
      const snapshot = { text: line.textContent, cls: line.className, html: line.innerHTML };
      // No tick, no cross, no AT verdict: grading a numeric answer is the
      // backend's job, and D2 pins this reveal to the answer alone.
      expect(host.querySelector('svg')).toBeNull();
      expect(host.querySelector('.mark')).toBeNull();
      expect(host.querySelector('.sr-only')).toBeNull();
      teardown();
      return snapshot;
    });

    expect(seen[0]).toEqual(seen[1]);
  });
});
