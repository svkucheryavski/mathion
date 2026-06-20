import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { ComponentProps } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';

let target: HTMLDivElement | null = null;
let component: unknown = null;

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target) { target.remove(); target = null; }
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

type TabProps = ComponentProps<typeof RunRosterTab>;

const BASE_PROPS: TabProps = {
  runId: 10,
  runIsPublished: true,
  courseSlug: 'calc-101',
  students: [],
  groups: [],
  groupsEnabled: false,
  rosterPrefilter: null,
  onPrefilterClear: () => {},
  onRefetchRosterData: async () => ({ students: [], groups: [] }),
  onRefetchGroupsOnly: async () => {},
  onOpenImport: () => {},
  onNavigateToTab: () => {},
};

function mountTab(propOverrides: Partial<TabProps> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(RunRosterTab, { target, props: { ...BASE_PROPS, ...propOverrides } });
  flushSync();
}

async function clickAdd(email: string) {
  const input = target!.querySelector('input[name="new-email"]') as HTMLInputElement;
  input.value = email;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  (target!.querySelector('button[data-action="add-student"]') as HTMLButtonElement).click();
  await settle();
}

function errorText(): string | null {
  const el = target!.querySelector('p.error[role="alert"]');
  return el?.textContent ?? null;
}

describe('RunRosterTab single-add error handling (mp-followup #1)', () => {
  it('409 student_already_active_in_course shows backend detail inline', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (/\/api\/runs\/\d+\/students$/.test(url)) {
        return jres(
          {
            detail: 'alice@x.com is already active in run "Spring 2025" of the same course.',
            error_code: 'student_already_active_in_course',
            conflicts: [{ user_id: 99, email: 'alice@x.com', run_id: 7, run_title: 'Spring 2025' }],
          },
          409,
        );
      }
      return jres({}, 200);
    });
    mountTab({});
    await clickAdd('alice@x.com');
    expect(errorText()).toBe(
      'alice@x.com is already active in run "Spring 2025" of the same course.',
    );
  });

  it('409 capacity_reached (no error_code) shows backend detail inline', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (/\/api\/runs\/\d+\/students$/.test(url)) {
        return jres({ detail: 'Group capacity reached' }, 409);
      }
      return jres({}, 200);
    });
    mountTab({});
    await clickAdd('bob@x.com');
    expect(errorText()).toBe('Group capacity reached');
  });

  it('409 run_unpublished surfaces backend detail (regression locks existing UX)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (/\/api\/runs\/\d+\/students$/.test(url)) {
        return jres(
          { detail: 'Cannot add students to an unpublished run', error_code: 'run_unpublished' },
          409,
        );
      }
      return jres({}, 200);
    });
    mountTab({});
    await clickAdd('carol@x.com');
    expect(errorText()).toBe('Cannot add students to an unpublished run');
  });
});
