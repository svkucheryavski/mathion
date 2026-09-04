import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Text from '../components/items/quiz/TextQuestion.svelte';
import type { TextQuestion } from '../lib/types';

const CORRECT = 'Photosynthesis';

function question(): TextQuestion {
  return {
    id: 6,
    order: 1,
    type: 'text_answer',
    text_md: '',
    // TWO paragraphs on purpose: the prompt's inter-paragraph rhythm is exactly
    // what a blanket `.text p { margin:0 }` would destroy, so the fixture has to
    // be able to show it.
    text_html: '<p>Plants convert light into chemical energy.</p><p>Name that process.</p>',
  };
}

type Props = {
  question: TextQuestion;
  value: number[] | string | undefined;
  onanswer: (ans: string) => void;
  disabled: boolean;
  correctValue: string | null;
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
  component = mount(Text, { target: host, props: reactive });
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

describe('TextQuestion structure (T3)', () => {
  it('renders a local control field, not ui/Input, and keeps prose out of mono', () => {
    render();

    expect(field().classList.contains('txt')).toBe(true);
    // ui/Input is NOT usable here: it renders `class="input"` and its prop list
    // carries no `disabled` (and no rest-spread), so a swap would leave the
    // field answerable after submit.
    expect(field().classList.contains('input')).toBe(false);
    // The answer is prose, not a numeral — Constraint 4's mono is for numerals,
    // and this is also what tells the text field apart from the numeric one.
    expect(field().classList.contains('mono')).toBe(false);
    expect(field().hasAttribute('inputmode')).toBe(false);
    expect(field().getAttribute('type')).toBe('text');
    // No inline style: it would beat every rule the dist gate pins, so the
    // gate is only meaningful while the element carries none.
    expect(field().hasAttribute('style')).toBe(false);
    expect(field().disabled).toBe(false);
  });

  it('keeps both prompt paragraphs and hangs prompt, field and answer off .row', () => {
    render({ value: 'Respiration', disabled: true, correctValue: CORRECT });

    const row = host.querySelector('.row');
    expect(row).not.toBeNull();
    // The MARGIN between the paragraphs is CSS and is guarded by the dist gate,
    // not here. This asserts the precondition that rule styles: both authored
    // paragraphs reach the DOM, so there is an inter-paragraph gap to keep.
    expect(host.querySelectorAll('.text p').length).toBe(2);
    // All three are direct .row children, so the single 16px gap — not any
    // surviving child margin — owns prompt→field→answer.
    expect(host.querySelector('.text')!.parentElement).toBe(row);
    expect(field().parentElement).toBe(row);
    expect(correctLine()!.parentElement).toBe(row);
    // ...and in that ORDER: .row is a flex column, so membership alone would
    // also pass with the answer rendered above the field.
    expect([...row!.children].map((el) => `${el.tagName}.${el.className.split(' ')[0]}`))
      .toEqual(['DIV.text', 'INPUT.txt', 'P.correct-line']);
  });

  it('names the field with its own prompt for assistive tech', () => {
    render();

    const prompt = host.querySelector('.text')!;
    // Snapshot the STRING: `prompt` is the same live node after the swap below,
    // so reading `prompt.id` afterwards would read the updated value.
    const firstId = prompt.id;
    expect(firstId).not.toBe('');
    // Without this the a11y tree shows an unnamed textbox: a screen-reader user
    // tabbing in hears the value and no question. The choice questions get the
    // same association from <fieldset>/<legend>.
    expect(field().getAttribute('aria-labelledby')).toBe(firstId);

    // The id must TRACK the question, not be a literal — two of these on one
    // page would otherwise share an id, and both fields would be named by
    // whichever prompt the document happened to hold first.
    props.question = { ...question(), id: 9 };
    flushSync();
    const moved = host.querySelector('.text')!;
    expect(moved.id).not.toBe(firstId);
    expect(field().getAttribute('aria-labelledby')).toBe(moved.id);
  });

  it('shows the student value and reports every keystroke', () => {
    render();
    expect(field().value).toBe('');

    typeIn('Photo');

    expect(props.value).toBe('Photo');
    expect(field().value).toBe('Photo');

    // ...and the field TRACKS the prop after mount, which is how QuizItem's
    // tryAgain() clears it and how the reveal path feeds the student's own
    // answer back in. `typeIn` writes field().value itself, so the assertion
    // above would also pass for a component that ignored `value` entirely.
    props.value = 'Respiration';
    flushSync();
    expect(field().value).toBe('Respiration');
  });

  it('goes inert when disabled, still showing what the student typed', () => {
    render({ value: 'Respiration', disabled: true });

    expect(field().disabled).toBe(true);
    expect(field().value).toBe('Respiration');
  });
});

describe('TextQuestion reveal (D2, T3)', () => {
  it('shows nothing before the reveal', () => {
    render({ value: 'Respiration' });

    expect(correctLine()).toBeNull();
  });

  it('shows only the correct answer, and keeps that prose non-mono', () => {
    render({ value: 'Respiration', disabled: true, correctValue: CORRECT });

    expect(correctLine()!.textContent).toBe('Correct answer: Photosynthesis');
    const answer = correctLine()!.querySelector('strong')!;
    expect(answer.textContent).toBe('Photosynthesis');
    // Deliberately NOT mono — unlike the numeric reveal, this value is prose.
    expect(answer.classList.contains('mono')).toBe(false);
  });

  it('does not judge the student value — the reveal reads the same right or wrong', () => {
    const seen = ['Respiration', CORRECT].map((studentValue) => {
      render({ value: studentValue, disabled: true, correctValue: CORRECT });
      const line = correctLine()!;
      const snapshot = { text: line.textContent, cls: line.className, html: line.innerHTML };
      // No tick, no cross, no AT verdict: grading a free-text answer is the
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
