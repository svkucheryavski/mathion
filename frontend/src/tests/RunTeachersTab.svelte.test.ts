import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunTeachersTab from '../components/runs/RunTeachersTab.svelte';
import type { Course, RunTeacherResponse } from '../lib/types';
import { toasts } from '../stores/toasts.svelte';

const baseCourse: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

describe('RunTeachersTab', () => {
  it('renders empty state', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, {
      target,
      props: { runId: 10, teachers: [], onRefetch: vi.fn().mockResolvedValue(undefined), course: baseCourse },
    });
    await settle();
    expect(target.textContent).toContain('No teachers assigned');
    unmount(cmp);
  });

  it('(invited) badge persists across page refresh — derived from user_full_name=null in props (spec §7 step 7)', async () => {
    // Refresh scenario: parent already supplies a teacher with user_full_name=null;
    // no submit happens. The badge must render purely from prop state.
    const invitedTeacher: RunTeacherResponse = {
      id: 50, run_id: 10, user_id: 7,
      user_email: 'newteacher@nowhere.test', user_full_name: null,
      created_at: '2026-05-22T00:00:00Z',
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: {
      runId: 10,
      teachers: [invitedTeacher],
      onRefetch: vi.fn(),
      course: baseCourse,
    } });
    await settle();
    expect(target.querySelector('.chip-invited')?.textContent?.trim()).toBe('invited');
    expect(target.textContent).toContain('newteacher@nowhere.test');
    unmount(cmp);
  });

  it('adds teacher, prepends row, shows (invited) when user_full_name === null', async () => {
    fetchSpy.mockImplementation(() =>
      jres({
        id: 50,
        run_id: 10,
        user_id: 7,
        user_email: 'new@x.com',
        user_full_name: null,
        created_at: '2026-05-22T00:00:00Z',
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10,
      teachers: [] as RunTeacherResponse[],
      onRefetch: vi.fn().mockImplementation(async () => {
        propsRef.teachers = [
          {
            id: 50,
            run_id: 10,
            user_id: 7,
            user_email: 'new@x.com',
            user_full_name: null,
            created_at: '2026-05-22T00:00:00Z',
          },
        ];
      }),
      course: baseCourse,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: propsRef });
    await settle();
    const emailInput = target.querySelector('input[name="email"]') as HTMLInputElement;
    emailInput.value = 'new@x.com';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(target.querySelector('.chip-invited')?.textContent?.trim()).toBe('invited');
    expect(propsRef.onRefetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('prepends new teacher to existing list (sorts DESC by created_at)', async () => {
    // Backend lists teachers ASC by created_at, so a newly-added teacher comes
    // back LAST. Spec §4.2:455 says "prepend the new row" — component sorts DESC.
    const newTeacher: RunTeacherResponse = {
      id: 50, run_id: 10, user_id: 7,
      user_email: 'new@x.com', user_full_name: 'New Teach',
      created_at: '2026-05-22T00:00:00Z',
    };
    const oldTeacher: RunTeacherResponse = {
      id: 1, run_id: 10, user_id: 1,
      user_email: 'old@x.com', user_full_name: 'Old',
      created_at: '2026-01-01T00:00:00Z',
    };
    fetchSpy.mockImplementation(() => jres(newTeacher));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10,
      teachers: [oldTeacher],
      onRefetch: vi.fn().mockImplementation(async () => {
        // Backend returns ASC: oldest first, newest last.
        propsRef.teachers = [oldTeacher, newTeacher];
      }),
      course: baseCourse,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: propsRef });
    await settle();
    const emailInput = target.querySelector('input[name="email"]') as HTMLInputElement;
    emailInput.value = 'new@x.com';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    const rows = target.querySelectorAll('li');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('new@x.com');
    expect(rows[1].textContent).toContain('old@x.com');
    unmount(cmp);
  });

  it('renders inline error on 409', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Already there' }, 409));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, {
      target,
      props: { runId: 10, teachers: [], onRefetch: vi.fn().mockResolvedValue(undefined), course: baseCourse },
    });
    await settle();
    const emailInput = target.querySelector('input[name="email"]') as HTMLInputElement;
    emailInput.value = 't@x.com';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(target.textContent).toContain('Teacher already assigned');
    unmount(cmp);
  });

  it('removes teacher with inline confirm', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    const refetch = vi.fn().mockResolvedValue(undefined);
    const teachers: RunTeacherResponse[] = [
      {
        id: 1,
        run_id: 10,
        user_id: 1,
        user_email: 't@x.com',
        user_full_name: 'T One',
        created_at: '2026-05-22T00:00:00Z',
      },
    ];
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, {
      target,
      props: { runId: 10, teachers, onRefetch: refetch, course: baseCourse },
    });
    await settle();
    (target.querySelector('button[data-action="remove"]') as HTMLButtonElement).click();
    await settle();
    expect(target.querySelector('.inline-confirm[role="group"]')?.getAttribute('aria-label')).toBe('Remove t@x.com?');
    (target.querySelector('button[data-action="confirm-remove"]') as HTMLButtonElement).click();
    await settle();
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('teacher view (course.is_admin=false): Add form and Remove buttons absent', async () => {
    const teachers: RunTeacherResponse[] = [
      {
        id: 1,
        run_id: 10,
        user_id: 1,
        user_email: 't@x.com',
        user_full_name: 'T One',
        created_at: '2026-05-22T00:00:00Z',
      },
    ];
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, {
      target,
      props: {
        runId: 10,
        teachers,
        onRefetch: vi.fn().mockResolvedValue(undefined),
        course: { ...baseCourse, is_admin: false },
      },
    });
    await settle();
    expect(target.querySelector('input[name="email"]')).toBeNull();
    expect(target.querySelector('form')).toBeNull();
    expect(target.querySelector('button[data-action="remove"]')).toBeNull();
    // Teacher still sees the roster row content.
    expect(target.textContent).toContain('t@x.com');
    unmount(cmp);
  });

  it('admin view (course.is_admin=true): Add form and Remove buttons present', async () => {
    const teachers: RunTeacherResponse[] = [
      {
        id: 1,
        run_id: 10,
        user_id: 1,
        user_email: 't@x.com',
        user_full_name: 'T One',
        created_at: '2026-05-22T00:00:00Z',
      },
    ];
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, {
      target,
      props: {
        runId: 10,
        teachers,
        onRefetch: vi.fn().mockResolvedValue(undefined),
        course: { ...baseCourse, is_admin: true },
      },
    });
    await settle();
    expect(target.querySelector('input[name="email"]')).not.toBeNull();
    expect(target.querySelectorAll('button[data-action="remove"]').length).toBeGreaterThan(0);
    unmount(cmp);
  });

  const tA: RunTeacherResponse = { id: 1, run_id: 10, user_id: 1, user_email: 'a@x.com', user_full_name: 'Ann', created_at: '2026-05-22T00:00:00Z' };
  const tB: RunTeacherResponse = { id: 2, run_id: 10, user_id: 2, user_email: 'b@x.com', user_full_name: null, created_at: '2026-05-21T00:00:00Z' };

  it('rows: avatar (aria-hidden), name or "—" + invited chip, mono email, 🗑 named by email', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [tA, tB], onRefetch: vi.fn(), course: baseCourse } });
    await settle();
    const rows = Array.from(target.querySelectorAll('li.t-row'));
    expect(rows[0]!.querySelector('.avatar')?.getAttribute('aria-hidden')).toBe('true');
    expect(rows[0]!.querySelector('.t-name')?.textContent?.trim()).toBe('Ann');
    expect(rows[0]!.querySelector('.t-email')?.textContent?.trim()).toBe('a@x.com');
    expect(rows[1]!.querySelector('.t-name')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('— invited');
    const rm = rows[0]!.querySelector('button[data-action="remove"]') as HTMLButtonElement;
    expect(rm.getAttribute('aria-label')).toBe('Remove a@x.com');
    expect(rm.getAttribute('data-glyph')).toBe('trash');
    expect(target.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Teachers 2');
    unmount(cmp);
  });

  it('the email field does not take focus when the tab opens; it has a hidden label', async () => {
    const before = document.activeElement;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [], onRefetch: vi.fn(), course: baseCourse } });
    await settle();
    expect(document.activeElement).toBe(before);
    const input = target.querySelector('input[name="email"]') as HTMLInputElement;
    expect((target.querySelector(`label[for="${input.id}"]`) as HTMLElement).textContent?.trim()).toBe('Teacher email');
    expect(target.querySelector('button[aria-label="Add teacher"]')?.getAttribute('data-glyph')).toBe('plus');
    unmount(cmp);
  });

  it('after an add the field is cleared and keeps focus', async () => {
    fetchSpy.mockImplementation(() => jres(tA));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [], onRefetch: vi.fn().mockResolvedValue(undefined), course: baseCourse } });
    await settle();
    const input = target.querySelector('input[name="email"]') as HTMLInputElement;
    input.value = 'a@x.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (target.querySelector('button[aria-label="Add teacher"]') as HTMLButtonElement).click();
    await settle();
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    unmount(cmp);
  });

  it('after removing the only teacher focus goes to the email field', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = $state({
      runId: 10, teachers: [tA], course: baseCourse,
      onRefetch: async () => { props.teachers = []; },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props });
    await settle();
    (target.querySelector('button[data-action="remove"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-remove"]') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('input[name="email"]'));
    unmount(cmp);
  });

  it('a failed add from the + button puts focus back in the field (never on <body>)', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Already there' }, 409));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [], onRefetch: vi.fn(), course: baseCourse } });
    await settle();
    const input = target.querySelector('input[name="email"]') as HTMLInputElement;
    input.value = 'a@x.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const plus = target.querySelector('button[aria-label="Add teacher"]') as HTMLButtonElement;
    plus.focus();
    plus.click();
    await settle();
    expect(target.querySelector('.t-err')?.textContent).toBe('Teacher already assigned to this run.');
    expect(document.activeElement).toBe(input);
    unmount(cmp);
  });
});

// Polish 3 §Behaviour "Offline failures say so".
describe('RunTeachersTab — offline failures', () => {
  const teacher: RunTeacherResponse = {
    id: 1, run_id: 10, user_id: 1, user_email: 't@x.com', user_full_name: 'T One', created_at: '2026-05-22T00:00:00Z',
  };
  function mountTab(teachers: RunTeacherResponse[] = []) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, {
      target,
      props: { runId: 10, teachers, onRefetch: vi.fn().mockResolvedValue(undefined), course: baseCourse },
    });
    return { target, cmp };
  }

  it('a rejected TypeError on add shows the inline error', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { target, cmp } = mountTab();
    await settle();
    const emailInput = target.querySelector('input[name="email"]') as HTMLInputElement;
    emailInput.value = 't@x.com';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Could not reach server. Check your connection.');
    expect(emailInput.getAttribute('aria-invalid')).toBe('true');
    unmount(cmp);
  });

  it('a rejected TypeError on Remove shows a toast', async () => {
    toasts.list.length = 0;
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { target, cmp } = mountTab([teacher]);
    await settle();
    (target.querySelector('button[data-action="remove"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-remove"]') as HTMLButtonElement).click();
    await settle();
    expect(toasts.list.map((t) => t.message)).toContain('Could not reach server. Check your connection.');
    unmount(cmp);
  });
});
