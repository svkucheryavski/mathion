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
    expect(field().getAttribute('type')).toBe('text');
    // No inline style: it would beat every rule the dist gate pins, so the
    // gate is only meaningful while the element carries none.
    expect(field().hasAttribute('style')).toBe(false);
    expect(field().disabled).toBe(false);
  });

  it('keeps both prompt paragraphs and hangs prompt, field and answer off .row', () => {
    render({ value: '75', disabled: true, correctValue: CORRECT });

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
      .toEqual(['DIV.text', 'INPUT.num', 'P.correct-line']);
    // None of the five carries an inline style: it would beat every rule the
    // dist gate pins, so the gate is only meaningful while they carry none.
    // The reveal's <strong> is in the list because it carries no scoped class
    // of its own, so no hash-coupled dist grep can address it — an inline style
    // there would go unnoticed on both sides.
    [row!, host.querySelector('.text')!, field(), correctLine()!,
     correctLine()!.querySelector('strong')!]
      .forEach((el) => expect(el.hasAttribute('style')).toBe(false));
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

    typeIn('80');

    expect(props.value).toBe('80');
    expect(field().value).toBe('80');

    // ...and the field TRACKS the prop after mount, which is how QuizItem's
    // tryAgain() clears it and how the reveal path feeds the student's own
    // answer back in. `typeIn` writes field().value itself, so the assertion
    // above would also pass for a component that ignored `value` entirely.
    props.value = '19';
    flushSync();
    expect(field().value).toBe('19');
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

  it('reveals a correct answer of 0 — the guard is !== null, not truthiness', () => {
    render({ value: '5', disabled: true, correctValue: 0 });

    expect(correctLine()!.textContent).toBe('Correct answer: 0');
    expect(correctLine()!.querySelector('strong')!.classList.contains('mono')).toBe(true);
  });

  it('does not judge the student value — the reveal reads the same right or wrong', () => {
    const seen = ['7.5', '80'].map((studentValue) => {   // lengths differ: see the counter note below
      render({ value: studentValue, disabled: true, correctValue: CORRECT });
      const line = correctLine()!;
      // A markup snapshot is structurally blind to DOM PROPERTIES, and `value`
      // is one — Svelte writes it as a property, and that hole passed the whole
      // suite once. It legitimately differs between the two runs, so it is
      // asserted rather than snapshotted: the field must echo the student
      // verbatim. `validity` is pinned beside it as a FORWARD guard only —
      // setCustomValidity is inert while the field is disabled (a disabled
      // control is barred from constraint validation: no :invalid, no bubble,
      // and validationMessage spec-pinned to '' whatever you set), and this
      // reveal path always disables. So asserting validationMessage would be
      // an assertion that cannot fail; `validity.valid` still bites in jsdom
      // and would bite in a browser if the reveal ever stopped disabling.
      expect(field().value).toBe(studentValue);
      expect(field().validity.valid).toBe(true);
      // documentElement.outerHTML, not body.innerHTML: innerHTML serialises
      // body's CHILDREN, so a verdict carried on <body>'s own class — paired
      // with `:global(body.answer-wrong .correct-line::after){content:' x'}` —
      // escaped it with the whole suite green. outerHTML subsumes body, head,
      // and both elements' own attributes.
      // BOUNDARY: this sees the DOM and nothing else. A verdict pushed to a
      // STORE (pushToast) is invisible at component scope because its host is
      // not mounted; so are focus placement, scroll position and speech. Those
      // need an integration test, not a wider snapshot.
      // NOTE the false-FAIL surface this buys: a future NON-judging render
      // derived from the student's value (a `{text.length} / 500 characters`
      // counter, say — the fixtures above differ in length, so it would bite)
      // reds this test with a message accusing the component of judging.
      const snapshot = { text: line.textContent, cls: line.className,
                         html: line.innerHTML,
                         doc: document.documentElement.outerHTML };
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
