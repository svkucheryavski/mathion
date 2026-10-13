import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ProgressBreakdown from '../components/runs/ProgressBreakdown.svelte';
import type { SequenceItemState } from '../lib/dashboards';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

function item(o: Partial<SequenceItemState> = {}): SequenceItemState {
  return {
    item_id: 1, item_order: 1, item_title: 'Item One', item_type: 'static_page',
    is_covered: true, last_score: null, last_visited_at: null, ...o,
  };
}

function render(items: SequenceItemState[]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(ProgressBreakdown, { target: host, props: { items } });
  flushSync();
}

const rows = () => Array.from(host.querySelectorAll<HTMLElement>('li.pb-row'));

describe('ProgressBreakdown (6c §Progress variant)', () => {
  it('one Items card, named by its <h3>, with one row per item in order', () => {
    render([item({ item_id: 1, item_title: 'First' }), item({ item_id: 2, item_title: 'Second' })]);
    const card = host.querySelector('section.pb-card') as HTMLElement;
    const h = document.getElementById(card.getAttribute('aria-labelledby')!)!;
    expect(h.tagName).toBe('H3');
    expect(h.textContent).toBe('Items');
    expect(rows().map((r) => r.querySelector('.pb-name')!.textContent)).toEqual(['First', 'Second']);
  });

  it('each row: the ItemMark of its state, the hidden state word and the readable type name', () => {
    render([
      item({ item_id: 1, item_type: 'static_page', is_covered: true }),
      item({ item_id: 2, item_type: 'video', is_covered: false }),
      item({ item_id: 3, item_type: 'quiz', is_covered: false }),
      item({ item_id: 4, item_type: 'interactive_app', is_covered: true }),
    ]);
    const r = rows();
    expect(r[0]!.querySelector('.item-mark')!.classList.contains('covered')).toBe(true);
    expect(r[1]!.querySelector('.item-mark')!.classList.contains('not-yet')).toBe(true);
    expect(r.map((x) => x.querySelector('.pb-sr')!.textContent)).toEqual(['covered', 'not covered', 'not covered', 'covered']);
    expect(r.map((x) => x.querySelector('.pb-type')!.textContent)).toEqual(['Page', 'Video', 'Quiz', 'Interactive app']);
    // The quiz mark is ItemMark's quiz glyph (its own stroke width).
    expect(r[2]!.querySelector('.item-mark svg')!.getAttribute('stroke-width')).toBe('1.9');
  });

  it('an unknown type gets an empty 22px box and its raw name', () => {
    render([item({ item_type: 'mini_project' })]);
    const r = rows()[0]!;
    expect(r.querySelector('.item-mark')).toBeNull();
    expect(r.querySelector('span.pb-nomark[aria-hidden="true"]')).not.toBeNull();
    expect(r.querySelector('.pb-type')!.textContent).toBe('mini_project');
  });

  it('the last score shows as "3/4"; no score, no score cell', () => {
    render([item({ item_id: 1, last_score: { correct: 3, total: 4 } }), item({ item_id: 2, last_score: null })]);
    expect(rows()[0]!.querySelector('.pb-score')!.textContent).toBe('3/4');
    expect(rows()[1]!.querySelector('.pb-score')).toBeNull();
  });
});
