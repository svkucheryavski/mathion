import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PublishConflictsModal from '../components/runs/PublishConflictsModal.svelte';
import type { PublishConflict } from '../lib/types';

// Per the codebase memory rule: component tests use mount/unmount/flushSync
// from `svelte`, NOT @testing-library/svelte.

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  document.body.removeChild(target);
});

// FocusTrap autofocuses in a microtask; Modal registers its listeners on mount.
async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flushSync();
}

const BASE_CONFLICT: PublishConflict = {
  user_id: 1,
  email: 'a@example.com',
  run_id: 10,
  run_title: 'Spring 2025',
};

describe('PublishConflictsModal', () => {
  it('renders singular sentence form for 1 conflict (spec §8 case 1)', () => {
    component = mount(PublishConflictsModal, {
      target,
      props: {
        open: true,
        conflicts: [{ ...BASE_CONFLICT }],
        onClose: () => {},
      },
    });
    flushSync();
    const heading = target.querySelector('h2');
    expect(heading?.textContent?.trim()).toBe("1 student can't be added");
    // Body contains the email and the run_title wrapped in <strong>
    const body = target.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(body).toContain('a@example.com');
    expect(body).toContain('Spring 2025');
    const strongs = target.querySelectorAll('.modal-body strong');
    expect(strongs.length).toBe(1);
    expect(strongs[0]?.textContent).toBe('Spring 2025');
    // Single-sentence form: no bullet list rendered.
    expect(target.querySelector('.modal-body ul')).toBeNull();
  });

  it('renders single run group with bullet list when all conflicts share same run_id (spec §8 case 2)', () => {
    const conflicts: PublishConflict[] = [
      { user_id: 1, email: 'a@example.com', run_id: 10, run_title: 'Spring 2025' },
      { user_id: 2, email: 'b@example.com', run_id: 10, run_title: 'Spring 2025' },
      { user_id: 3, email: 'c@example.com', run_id: 10, run_title: 'Spring 2025' },
    ];
    component = mount(PublishConflictsModal, {
      target,
      props: { open: true, conflicts, onClose: () => {} },
    });
    flushSync();
    const heading = target.querySelector('h2');
    expect(heading?.textContent?.trim()).toBe("3 students can't be added");
    // run_title rendered exactly once as <strong> (single-group layout).
    const strongs = target.querySelectorAll('.modal-body strong');
    expect(strongs.length).toBe(1);
    expect(strongs[0]?.textContent).toBe('Spring 2025');
    // One <ul> with 3 <li>s, one per email.
    const uls = target.querySelectorAll('.modal-body ul');
    expect(uls.length).toBe(1);
    const lis = uls[0]!.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(lis[0]?.textContent).toContain('a@example.com');
    expect(lis[1]?.textContent).toContain('b@example.com');
    expect(lis[2]?.textContent).toContain('c@example.com');
  });

  it('renders distinct groups by run_id even when two run_titles collide (spec §8 case 3 — G3 sentinel)', () => {
    // Runs 10 and 11 share the title "Spring 2025" but are distinct runs;
    // grouping MUST key on run_id (G3), not run_title.
    const conflicts: PublishConflict[] = [
      { user_id: 1, email: 'a@example.com', run_id: 10, run_title: 'Spring 2025' },
      { user_id: 2, email: 'b@example.com', run_id: 11, run_title: 'Spring 2025' },
      { user_id: 3, email: 'c@example.com', run_id: 12, run_title: 'Fall 2025' },
    ];
    component = mount(PublishConflictsModal, {
      target,
      props: { open: true, conflicts, onClose: () => {} },
    });
    flushSync();
    const heading = target.querySelector('h2');
    expect(heading?.textContent?.trim()).toBe("3 students can't be added");
    // THREE distinct groups (one per run_id) — NOT two (would mean grouping by title).
    const strongs = target.querySelectorAll('.modal-body strong');
    expect(strongs.length).toBe(3);
    const titles = Array.from(strongs).map((s) => s.textContent);
    // Two of the headings are "Spring 2025" (runs 10 + 11), one is "Fall 2025".
    expect(titles.filter((t) => t === 'Spring 2025').length).toBe(2);
    expect(titles.filter((t) => t === 'Fall 2025').length).toBe(1);
    // Each group has its own <ul> with the corresponding email.
    const uls = target.querySelectorAll('.modal-body ul');
    expect(uls.length).toBe(3);
  });

  it('dedupes same-user_id legacy duplicates in the heading count (spec §8 I4 dedupe)', () => {
    // Same user appears twice (different runs). Heading counts unique user_ids,
    // so it must say "1 student", not "2 students".
    const conflicts: PublishConflict[] = [
      { user_id: 1, email: 'same@example.com', run_id: 10, run_title: 'Spring 2025' },
      { user_id: 1, email: 'same@example.com', run_id: 11, run_title: 'Fall 2024' },
    ];
    component = mount(PublishConflictsModal, {
      target,
      props: { open: true, conflicts, onClose: () => {} },
    });
    flushSync();
    const heading = target.querySelector('h2');
    expect(heading?.textContent?.trim()).toBe("1 student can't be added");
    expect(heading?.textContent).not.toContain('2 students');
    // Grouped-list form: 2 distinct run groups, each containing the email once.
    const strongs = target.querySelectorAll('.modal-body strong');
    expect(strongs.length).toBe(2);
    const uls = target.querySelectorAll('.modal-body ul');
    expect(uls.length).toBe(2);
    // Each group's email bullet contains the email exactly once (no dedupe collision).
    expect(uls[0]!.querySelectorAll('li').length).toBe(1);
    expect(uls[1]!.querySelectorAll('li').length).toBe(1);
  });
});

describe('PublishConflictsModal — on ui/Modal (10l)', () => {
  const NOTE =
    'A student can only be active in one run of a course at a time. Remove them from the other run, or take them off this roster, then publish again.';
  const two: PublishConflict[] = [
    { user_id: 1, email: 'a@example.com', run_id: 10, run_title: 'Spring 2025' },
    { user_id: 2, email: 'b@example.com', run_id: 11, run_title: 'Fall 2025' },
  ];

  it('renders inside ui/Modal, named by its heading (R26)', async () => {
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose: () => {} } });
    await settle();
    const dialog = target.querySelector('section.modal-panel[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.hasAttribute('aria-label')).toBe(false);
    const heading = document.getElementById(dialog!.getAttribute('aria-labelledby') ?? '');
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe("2 students can't be added");
  });

  it('shows the drawn note in all three layouts, and the footer note', async () => {
    const layouts: PublishConflict[][] = [
      [{ ...BASE_CONFLICT }],
      [{ ...BASE_CONFLICT }, { ...BASE_CONFLICT, user_id: 2, email: 'b@example.com' }],
      two,
    ];
    for (const conflicts of layouts) {
      const cmp = mount(PublishConflictsModal, { target, props: { open: true, conflicts, onClose: () => {} } });
      await settle();
      expect(target.querySelector('.modal-body')?.textContent).toContain(NOTE);
      expect(target.querySelector('.modal-foot')?.textContent).toContain('Nothing was published — the run is unchanged.');
      unmount(cmp);
    }
  });

  it('the grouped layout leads with the drawn sentence; long values keep their full text as title', async () => {
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose: () => {} } });
    await settle();
    expect(target.querySelector('.pc-lead')?.textContent?.trim()).toBe('They are already active in other runs:');
    const titles = Array.from(target.querySelectorAll('.pc-title')).map((t) => t.getAttribute('title'));
    expect(titles).toEqual(['Spring 2025', 'Fall 2025']);
    const emails = Array.from(target.querySelectorAll('.pc-emails li')).map((li) => li.getAttribute('title'));
    expect(emails).toEqual(['a@example.com', 'b@example.com']);
  });

  it('focuses Close on open, and Close closes', async () => {
    const onClose = vi.fn();
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose } });
    await settle();
    const close = target.querySelector<HTMLButtonElement>('.modal-foot button[data-action="close"]')!;
    expect(close.textContent?.trim()).toBe('Close');
    expect(close.getAttribute('data-variant')).toBe('secondary');
    expect(document.activeElement).toBe(close);
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('× and Esc close it; a backdrop click does not (D11)', async () => {
    const onClose = vi.fn();
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose } });
    await settle();
    target.querySelector<HTMLElement>('.modal-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    target.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('mounts nothing while closed and releases the scroll lock on close (Review Focus 3)', async () => {
    const props = $state({ open: false, conflicts: two, onClose: () => {} });
    component = mount(PublishConflictsModal, { target, props });
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    props.open = true;
    await settle();
    expect(document.documentElement.style.overflow).toBe('hidden');
    props.open = false;
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    props.open = true;
    await settle();
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
