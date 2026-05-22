import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunTeachersTab from '../components/runs/RunTeachersTab.svelte';
import type { RunTeacherResponse } from '../lib/types';

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
      props: { runId: 10, teachers: [], onRefetch: vi.fn().mockResolvedValue(undefined) },
    });
    await settle();
    expect(target.textContent).toContain('No teachers assigned');
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
    expect(target.textContent).toContain('(invited)');
    expect(propsRef.onRefetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('renders inline error on 409', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Already there' }, 409));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, {
      target,
      props: { runId: 10, teachers: [], onRefetch: vi.fn().mockResolvedValue(undefined) },
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
      props: { runId: 10, teachers, onRefetch: refetch },
    });
    await settle();
    (target.querySelector('button[data-action="remove"]') as HTMLButtonElement).click();
    flushSync();
    (target.querySelector('button[data-action="confirm-remove"]') as HTMLButtonElement).click();
    await settle();
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });
});
