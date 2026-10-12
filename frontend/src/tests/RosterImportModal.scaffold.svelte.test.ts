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

function paste(target: HTMLElement, text: string) {
  const ta = target.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(210);
  flushSync();
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
    expect(target.textContent).toContain('Will create groups: G1.');
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

  it('truncates the re-bucketed list with +N more', async () => {
    const roster = Array.from({ length: 7 }, (_, i) => ({ user_id: i+1, user_email: `e${i+1}@x.com`, user_full_name: '', group_id: null }));
    const csv = roster.map((r) => `${r.user_email},G1`).join('\n');
    const { target, cmp } = mountModal({ existingRoster: roster });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = csv;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    expect(target.textContent).toMatch(/Already enrolled, will be re-bucketed: e1@x\.com, e2@x\.com, e3@x\.com, e4@x\.com, e5@x\.com, \+2 more\./);
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

  it('autofocuses the textarea, not the × close button', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    unmount(cmp);
  });
});

describe('RosterImportModal — paste stage on ui/Modal (10f)', () => {
  it('renders inside ui/Modal; a backdrop click does not close (D11); Esc does (D16)', async () => {
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onClose });
    await settle();
    const dialog = target.querySelector('section.modal-panel[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Import roster from CSV');
    target.querySelector<HTMLElement>('.modal-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    // Paste stage: Esc closes at once, with no prompt (D16).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('the step marker: Paste is the current step, Result is not', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const steps = Array.from(target.querySelectorAll('header.modal-head ol > li'));
    expect(steps.map((s) => s.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['1 Paste', '2 Result']);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(steps[1].hasAttribute('aria-current')).toBe(false);
    unmount(cmp);
  });

  it('the paste box is named and described by the drawn help', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea')!;
    expect(ta.getAttribute('aria-label')).toBe('Rows to import');
    expect(document.getElementById(ta.getAttribute('aria-describedby')!)?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "Paste rows from Excel or Google Sheets, tab or comma separated. Columns: name optional, email required, group optional — a group that doesn't exist yet is created.",
    );
    unmount(cmp);
  });

  it('a skipping row shows its reasons as text and in its tile; the status column has a hidden header (D20, R24)', async () => {
    const { target, cmp } = mountModal();
    await settle();
    paste(target, 'a@x.com\nbad');
    const rows = target.querySelectorAll('table.preview tbody tr');
    const ok = rows[0].querySelector('[role="img"]')!;
    expect(ok.getAttribute('aria-label')).toBe('Valid');
    expect(ok.getAttribute('title')).toBe('Valid');
    const skip = rows[1].querySelector('[role="img"]')!;
    expect(skip.getAttribute('aria-label')).toBe('Will skip');
    expect(skip.getAttribute('title')).toBe('Invalid email format');
    expect(rows[1].querySelector('.ri-why')?.textContent).toBe('Invalid email format');
    expect(rows[0].querySelector('.ri-why')).toBeNull();
    expect(target.querySelector('table.preview thead th:last-child')?.textContent?.trim()).toBe('Status');
    unmount(cmp);
  });

  it('"Showing the first 10 of N rows." appears only above 10 rows (D17)', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const emails = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}@x.com`).join('\n');
    paste(target, emails(10));
    expect(target.textContent).not.toContain('Showing the first');
    paste(target, emails(12));
    expect(target.textContent).toContain('Showing the first 10 of 12 rows.');
    expect(target.textContent).not.toContain('will skip.');
    expect(target.querySelectorAll('table.preview tbody tr').length).toBe(10);
    unmount(cmp);
  });

  it('names skipped rows past the first 10, cut after 5 (D22, P7), singular at one', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ten = Array.from({ length: 10 }, (_, i) => `s${i + 1}@x.com`);
    paste(target, [...ten, 'bad11'].join('\n'));
    expect(target.textContent).toContain('Showing the first 10 of 11 rows. Row 11 will skip.');
    paste(target, [...ten, 'bad11', 'bad12', 'bad13', 'bad14', 'bad15', 'bad16', 'bad17', 's18@x.com'].join('\n'));
    expect(target.textContent).toContain('Showing the first 10 of 18 rows. Rows 11, 12, 13, 14, 15, +2 more will skip.');
    unmount(cmp);
  });

  it('counts take their singular at one, with the drawn wording', async () => {
    const { target, cmp } = mountModal();
    await settle();
    paste(target, 'a@x.com');
    expect(target.textContent).toContain('1 row — 1 valid, 0 will skip (0 invalid, 0 duplicate in paste).');
    expect(target.querySelector('button[data-action="import"]')?.textContent?.trim()).toBe('Import 1 valid row');
    paste(target, 'a@x.com\nb@x.com');
    expect(target.textContent).toContain('2 rows — 2 valid, 0 will skip (0 invalid, 0 duplicate in paste).');
    expect(target.querySelector('button[data-action="import"]')?.textContent?.trim()).toBe('Import 2 valid rows');
    unmount(cmp);
  });

  it('Import is disabled with its reason while nothing valid is pasted', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const btn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('No valid rows to import');
    unmount(cmp);
  });

  it('the re-bucketed line lists only real moves, matching e-mails case-blind (D23, Review Focus 2)', async () => {
    const roster = [
      { user_id: 1, user_email: 'a@x.com', user_full_name: '', group_id: 1 },
      { user_id: 2, user_email: 'b@x.com', user_full_name: '', group_id: 1 },
      { user_id: 3, user_email: 'c@x.com', user_full_name: '', group_id: 1 },
      { user_id: 4, user_email: 'Dee@X.com', user_full_name: '', group_id: 2 },
    ];
    const groups = [
      { id: 1, run_id: 10, name: 'G1', is_disabled: false, student_count: 3 },
      { id: 2, run_id: 10, name: 'G2', is_disabled: false, student_count: 1 },
    ];
    const { target, cmp } = mountModal({ existingRoster: roster, existingGroups: groups });
    await settle();
    // a: same group (no move); b: empty group cell (keeps G1, no move);
    // c: G1 → G2 (move); dee: G2 → G1, roster e-mail in another case (move).
    paste(target, 'a@x.com,G1\nb@x.com\nc@x.com,G2\ndee@x.com,G1');
    expect(target.textContent).toContain('Already enrolled, will be re-bucketed: c@x.com, dee@x.com.');
    paste(target, 'a@x.com,G1\nb@x.com');
    expect(target.textContent).not.toContain('Already enrolled');
    unmount(cmp);
  });
});
