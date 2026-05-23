import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RosterImportModal from '../components/runs/RosterImportModal.svelte';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

function mountModal(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RosterImportModal, { target, props: {
    runId: 10,
    existingRoster: [],
    existingGroups: [],
    onRefetchBeforeSubmit: vi.fn().mockResolvedValue({ students: [], groups: [] }),
    onClose: vi.fn(),
    ...extra,
  } });
  return { target, cmp };
}

describe('RosterImportModal — Stage 1 paste + preview', () => {
  it('renders heading and empty textarea on open', async () => {
    const { target, cmp } = mountModal();
    await settle();
    expect(target.textContent).toContain('Import roster from CSV');
    expect((target.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    unmount(cmp);
  });

  it('parses pasted CSV after 200ms debounce', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'name,email,group\nAlice,a@x.com,G1';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.textContent).not.toContain('a@x.com');
    vi.advanceTimersByTime(210);
    flushSync();
    expect(target.textContent).toContain('a@x.com');
    expect(target.textContent).toContain('Will auto-create groups: G1');
    unmount(cmp);
  });

  it('counts footer summarizes valid/invalid/duplicate', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com\nbad\nA@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    expect(target.textContent).toMatch(/3 rows/);
    expect(target.textContent).toMatch(/1 valid/);
    expect(target.textContent).toMatch(/(invalid)/);
    expect(target.textContent).toMatch(/(duplicate)/);
    unmount(cmp);
  });

  it('Import button disabled when 0 valid', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'bad';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    const btn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    unmount(cmp);
  });

  it('Cancel closes the modal', async () => {
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onClose });
    await settle();
    (target.querySelector('button[data-action="cancel"]') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalled();
    unmount(cmp);
  });

  it('truncates already-enrolled list with +N more', async () => {
    const roster = Array.from({ length: 7 }, (_, i) => ({ user_id: i+1, user_email: `e${i+1}@x.com`, user_full_name: '', group_id: null }));
    const csv = roster.map((r) => r.user_email).join('\n');
    const { target, cmp } = mountModal({ existingRoster: roster });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = csv;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    expect(target.textContent).toMatch(/, \+2 more/);
    unmount(cmp);
  });

  it('debounce cancellation: rapid keystrokes coalesce into one parse of the final text', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    // First keystroke
    ta.value = 'first@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    vi.advanceTimersByTime(100);
    // Second keystroke before debounce fires — must cancel the first parse
    ta.value = 'second@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    vi.advanceTimersByTime(100);
    // Still under the 200ms window since the second keystroke — nothing parsed yet
    flushSync();
    expect(target.textContent).not.toContain('first@x.com');
    expect(target.textContent).not.toContain('second@x.com');
    // Cross the 200ms window from the second keystroke
    vi.advanceTimersByTime(110);
    flushSync();
    // Only the latest text should be reflected; the first parse was cancelled
    expect(target.textContent).not.toContain('first@x.com');
    expect(target.textContent).toContain('second@x.com');
    unmount(cmp);
  });
});
