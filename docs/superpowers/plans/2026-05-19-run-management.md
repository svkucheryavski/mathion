# Run Management (Admin Surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend admin-only UI for managing course runs end-to-end on the Mathion platform: create/edit/delete runs, configure settings, assign teachers, manage groups, manage roster (single + bulk via paste-CSV), and publish/unpublish.

**Architecture:** Two new routes (`/courses/:courseSlug/runs` and `/courses/:courseSlug/runs/:runId`) layered on the existing Svelte 5 hash router. `RunDetailPage` owns six data slices for one run via a single-commit-gate stale-guard pattern with `loadToken` + try/catch; child tabs consume the data via props and emit changes via typed callback props (`onNavigateTab`, `onPrefilterClear`, `onRefetchRosterData`). Three new shared UI primitives in `components/ui/` (`InlineConfirm`, `LoadingPlaceholder`, `FocusTrap`) — each consumed by ≥2 sites. The F1=A roster import behavior preserves student group on already-enrolled rows via client-side lookup with a required submit-time refetch to narrow the rename-race window.

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$bindable`, `$props`), TypeScript, Vitest + jsdom. Reuses: `lib/api.ts` (`api.get/post/patch/delete`), `lib/router.svelte.ts` (hash-based), `lib/dirty.svelte.ts` (`makeDirtyTracker`), `stores/toasts.svelte.ts` (`pushToast`), `lib/events.ts` (`emitUnauthorized` — used transitively via `api.ts`). Reactive collections: `SvelteSet` and `SvelteMap` from `svelte/reactivity`.

**Spec:** `docs/superpowers/specs/2026-05-19-run-management-admin-design.md` (1180 lines, R11 APPROVED FOR PLAN-WRITING).

**Working branch:** `frontend-run-management` (already checked out off `main`).

---

## File structure (19 tasks — T11 split into T11a + T11b)

| Task | Owns these new files | Modifies |
|---|---|---|
| 1 | `lib/runs.ts` + tests; type block in `lib/types.ts` | — |
| 2 | `lib/runTeachers.ts` + tests, `lib/runGroups.ts` + tests, `lib/runRoster.ts` + tests | — |
| 3 | `components/ui/InlineConfirm.svelte` + tests, `components/ui/LoadingPlaceholder.svelte` + tests, `components/ui/FocusTrap.svelte` + tests | — |
| 4 | `lib/runStatus.ts` + tests, `lib/csv.ts` + tests | — |
| 5 | `pages/runs/RunListPage.svelte` + tests | `routes.ts`, `App.svelte`, `components/course/CourseCard.svelte` |
| 6 | `components/runs/NewRunModal.svelte` + tests | — |
| 7 | `pages/runs/RunDetailPage.svelte` + tests | `routes.ts`, `App.svelte`, `components/runs/NewRunModal.svelte` + its test (Step 5 retrofit: nav target → detail page) |
| 8 | (added to `pages/runs/RunDetailPage.svelte` from T7) sticky publish bar logic + tests | (extends T7 tests) |
| 9 | `components/runs/RunOverviewTab.svelte` + tests (inline edits) | — |
| 10 | (extends `RunOverviewTab.svelte`) checklist + settings + danger zone | — |
| 11a | `components/runs/RunTeachersTab.svelte` + tests | (modify `RunDetailPage.svelte` to mount + add `refetchTeachers`) |
| 11b | `components/runs/RunGroupsTab.svelte` + tests | (modify `RunDetailPage.svelte` to mount + add `refetchGroups` / `refetchGroupsAndStudents`) |
| 12 | `components/runs/RunRosterTab.svelte` + tests (core) | — |
| 13 | (extends `RunRosterTab.svelte`) optimistic inline group edit + `prunePendingGroups` | — |
| 14 | (extends `RunRosterTab.svelte`) bulk-ops dispatcher | — |
| 15 | (extends `RunRosterTab.svelte`) bulk-ops banner + retry | — |
| 16 | `components/runs/RosterImportModal.svelte` + tests (scaffold) | — |
| 17 | (extends `RosterImportModal.svelte`) `buildBatchRow` + submit + result | — |
| 18 | — (manual smoke + verification) | — |

---

## Pre-task: dev environment sanity

Before Task 1, verify:

```bash
cd frontend
npm test -- --run 2>&1 | tail -5
```

Expected: existing tests pass (baseline). Note the count for later delta comparison.

```bash
npm run check 2>&1 | tail -5
```

Expected: `0 errors`. Note the warning count (typically 19) for later baseline comparison.

---

### Task 1: `lib/runs.ts` + types in `lib/types.ts`

**Files:**
- Create: `frontend/src/lib/runs.ts`
- Modify: `frontend/src/lib/types.ts` (append new types — do NOT redefine `Course` or `Version`, which already exist at lines 194 and 205)
- Test: `frontend/src/tests/runs.test.ts`

- [ ] **Step 1: Append run-management types to `lib/types.ts`**

Add at the end of `frontend/src/lib/types.ts`:

```ts
// ---- Run management (Phase 8 frontend) ----
// Backend mirrors from backend/mathion/schemas.py. Course and Version are
// already defined above; do not redefine.

export type RunResponse = {
  id: number;
  version_id: number;
  title: string;
  start_date: string;     // YYYY-MM-DD
  end_date: string;       // YYYY-MM-DD
  groups_enabled: boolean;
  is_published: boolean;
  created_at: string;     // ISO timestamp
};

export type RunCreateRequest = {
  title: string;
  start_date: string;
  end_date: string;
  groups_enabled: boolean;
};

export type RunUpdateRequest = {
  title?: string;
  start_date?: string;
  end_date?: string;
  groups_enabled?: boolean;
};

export type RunTeacherResponse = {
  id: number;
  run_id: number;
  user_id: number;
  user_email: string;
  user_full_name: string | null;
  created_at: string;
};

export type GroupResponse = {
  id: number;
  run_id: number;
  name: string;
  is_disabled: boolean;
  student_count: number;
};

export type RunStudentResponse = {
  id: number;
  run_id: number;
  user_id: number;
  user_email: string;
  user_full_name: string | null;
  group_id: number | null;
  created_at: string;
};

export type RunStudentBatchRow = {
  name?: string;
  email: string;
  group?: string;
};

export type RunStudentBatchResultRow = {
  email: string;
  status: 'added' | 'error';
  group_id?: number;
  detail?: string;
};

export type BulkRosterErrorCode =
  | 'not_in_run'
  | 'capacity_reached'
  | 'internal_error';

export type BulkOpSummary = { total: number; ok: number; error: number };

export type BulkMoveResultRow = {
  user_id: number;
  status: 'ok' | 'error';
  group_id?: number | null;
  detail?: string;
  error_code?: BulkRosterErrorCode | null;
};

export type BulkDeleteResultRow = {
  user_id: number;
  status: 'ok' | 'error';
  detail?: string;
  error_code?: BulkRosterErrorCode | null;
};

export type BulkMoveResponse = {
  results: BulkMoveResultRow[];
  summary: BulkOpSummary;
};

export type BulkDeleteResponse = {
  results: BulkDeleteResultRow[];
  summary: BulkOpSummary;
};

// (No shared ChecklistRow type added in T1 — the readiness checklist row shape
// lives locally in T8's RunDetailPage.svelte, where the $derived computes it
// from teachers/groups/students/run. T10 consumes the same prop. Centralizing
// the type here would create drift if either side adds a field.)
```

- [ ] **Step 2: Write the failing tests for `lib/runs.ts`**

Create `frontend/src/tests/runs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listRuns, listVersions, createRun, getRun, updateRun, deleteRun,
  publishRun, unpublishRun,
} from '../lib/runs';
import { ApiError } from '../lib/api';
import * as events from '../lib/events';
import type { RunResponse } from '../lib/types';

const sample: RunResponse = {
  id: 1, version_id: 7, title: 'Fall 2026', start_date: '2026-09-01',
  end_date: '2026-12-15', groups_enabled: true, is_published: false,
  created_at: '2026-05-19T10:00:00Z',
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'X',
    json: async () => body,
  }));
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('listRuns', () => {
  it('GETs /api/courses/{cid}/runs and returns the array', async () => {
    const f = mockFetch(200, [sample]);
    vi.stubGlobal('fetch', f);
    const result = await listRuns(42);
    expect(result).toEqual([sample]);
    expect(f).toHaveBeenCalledWith('/api/courses/42/runs', expect.objectContaining({ method: 'GET' }));
  });
  it('throws ApiError on 500', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { detail: 'boom' }));
    await expect(listRuns(42)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('listVersions', () => {
  it('GETs /api/courses/{cid}/versions and returns the array', async () => {
    const v = { id: 7, course_id: 42, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false };
    const f = mockFetch(200, [v]);
    vi.stubGlobal('fetch', f);
    const result = await listVersions(42);
    expect(result).toEqual([v]);
    expect(f).toHaveBeenCalledWith('/api/courses/42/versions', expect.objectContaining({ method: 'GET' }));
  });
});

describe('createRun', () => {
  it('POSTs body without version_id', async () => {
    const f = mockFetch(201, sample);
    vi.stubGlobal('fetch', f);
    const body = { title: 'X', start_date: '2026-09-01', end_date: '2026-12-15', groups_enabled: true };
    const result = await createRun(42, body);
    expect(result).toEqual(sample);
    const call = f.mock.calls[0]!;
    expect(call[0]).toBe('/api/courses/42/runs');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual(body);
    expect(JSON.parse((call[1] as RequestInit).body as string)).not.toHaveProperty('version_id');
  });
});

describe('getRun / updateRun / deleteRun', () => {
  it('getRun GETs /api/runs/{id}', async () => {
    const f = mockFetch(200, sample);
    vi.stubGlobal('fetch', f);
    await expect(getRun(1)).resolves.toEqual(sample);
    expect(f.mock.calls[0]![0]).toBe('/api/runs/1');
  });
  it('updateRun PATCHes /api/runs/{id}', async () => {
    const f = mockFetch(200, { ...sample, title: 'New' });
    vi.stubGlobal('fetch', f);
    await updateRun(1, { title: 'New' });
    expect(f.mock.calls[0]![1]).toMatchObject({ method: 'PATCH' });
  });
  it('deleteRun DELETEs /api/runs/{id}', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 204, statusText: 'No Content', json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    await expect(deleteRun(1)).resolves.toBeUndefined();
    expect(f.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
  });
});

describe('publishRun / unpublishRun', () => {
  it('publishRun POSTs /api/runs/{id}/publish', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ...sample, is_published: true }));
    const r = await publishRun(1);
    expect(r.is_published).toBe(true);
  });
  it('unpublishRun POSTs /api/runs/{id}/unpublish', async () => {
    vi.stubGlobal('fetch', mockFetch(200, sample));
    const r = await unpublishRun(1);
    expect(r.is_published).toBe(false);
  });
});

describe('401 emits unauthorized', () => {
  it('listRuns 401 → emitUnauthorized + throws', async () => {
    vi.stubGlobal('fetch', mockFetch(401, {}));
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => undefined);
    await expect(listRuns(42)).rejects.toBeInstanceOf(ApiError);
    expect(spy).toHaveBeenCalled();
  });
});

describe('type contract: RunCreateRequest has no version_id', () => {
  it('compile-time check via type assertion', () => {
    // @ts-expect-error — version_id is not a valid key on RunCreateRequest
    const _bad: import('../lib/types').RunCreateRequest = { title: '', start_date: '', end_date: '', groups_enabled: true, version_id: 1 };
    expect(_bad).toBeDefined();
  });
});
```

- [ ] **Step 3: Verify tests fail**

```bash
cd frontend && npx vitest run src/tests/runs.test.ts 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module '../lib/runs'".

- [ ] **Step 4: Implement `lib/runs.ts`**

Create `frontend/src/lib/runs.ts`:

```ts
import { api } from './api';
import type {
  RunResponse, RunCreateRequest, RunUpdateRequest, Version,
} from './types';

export function listRuns(courseId: number): Promise<RunResponse[]> {
  return api.get<RunResponse[]>(`/api/courses/${courseId}/runs`);
}

export function listVersions(courseId: number): Promise<Version[]> {
  return api.get<Version[]>(`/api/courses/${courseId}/versions`);
}

export function createRun(courseId: number, body: RunCreateRequest): Promise<RunResponse> {
  return api.post<RunResponse>(`/api/courses/${courseId}/runs`, body);
}

export function getRun(runId: number): Promise<RunResponse> {
  return api.get<RunResponse>(`/api/runs/${runId}`);
}

export function updateRun(runId: number, body: RunUpdateRequest): Promise<RunResponse> {
  return api.patch<RunResponse>(`/api/runs/${runId}`, body);
}

export function deleteRun(runId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}`);
}

export function publishRun(runId: number): Promise<RunResponse> {
  return api.post<RunResponse>(`/api/runs/${runId}/publish`);
}

export function unpublishRun(runId: number): Promise<RunResponse> {
  return api.post<RunResponse>(`/api/runs/${runId}/unpublish`);
}
```

- [ ] **Step 5: Verify tests pass**

```bash
cd frontend && npx vitest run src/tests/runs.test.ts 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 6: Run full test suite + svelte-check to confirm no regressions**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes, baseline `0 errors / 19 warnings` (or current baseline) unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/lib/types.ts frontend/src/lib/runs.ts frontend/src/tests/runs.test.ts
git commit -m "feat(frontend): add lib/runs.ts run-CRUD helpers + types"
```

---

### Task 2: `lib/runTeachers.ts` + `lib/runGroups.ts` + `lib/runRoster.ts`

**Files:**
- Create: `frontend/src/lib/runTeachers.ts`
- Create: `frontend/src/lib/runGroups.ts`
- Create: `frontend/src/lib/runRoster.ts`
- Test: `frontend/src/tests/runTeachers.test.ts`
- Test: `frontend/src/tests/runGroups.test.ts`
- Test: `frontend/src/tests/runRoster.test.ts`

- [ ] **Step 1: Write the failing tests for `lib/runTeachers.ts`**

Create `frontend/src/tests/runTeachers.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listRunTeachers, addRunTeacher, removeRunTeacher } from '../lib/runTeachers';
import { ApiError } from '../lib/api';
import type { RunTeacherResponse } from '../lib/types';

const t: RunTeacherResponse = {
  id: 1, run_id: 1, user_id: 5, user_email: 't@x.com', user_full_name: 'T', created_at: 'z',
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, statusText: '', json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('runTeachers', () => {
  it('listRunTeachers GETs /api/runs/{rid}/teachers', async () => {
    const f = mockFetch(200, [t]); vi.stubGlobal('fetch', f);
    await expect(listRunTeachers(1)).resolves.toEqual([t]);
    expect(f.mock.calls[0]![0]).toBe('/api/runs/1/teachers');
  });
  it('addRunTeacher POSTs {email}', async () => {
    const f = mockFetch(201, t); vi.stubGlobal('fetch', f);
    await addRunTeacher(1, 't@x.com');
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ email: 't@x.com' });
  });
  it('addRunTeacher 409 throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Already assigned' }));
    await expect(addRunTeacher(1, 't@x.com')).rejects.toBeInstanceOf(ApiError);
  });
  it('removeRunTeacher DELETEs /api/runs/{rid}/teachers/{uid}', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 204, statusText: '', json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    await removeRunTeacher(1, 5);
    expect(f.mock.calls[0]![0]).toBe('/api/runs/1/teachers/5');
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });
});
```

- [ ] **Step 2: Implement `lib/runTeachers.ts`**

Create `frontend/src/lib/runTeachers.ts`:

```ts
import { api } from './api';
import type { RunTeacherResponse } from './types';

export function listRunTeachers(runId: number): Promise<RunTeacherResponse[]> {
  return api.get<RunTeacherResponse[]>(`/api/runs/${runId}/teachers`);
}

export function addRunTeacher(runId: number, email: string): Promise<RunTeacherResponse> {
  return api.post<RunTeacherResponse>(`/api/runs/${runId}/teachers`, { email });
}

export function removeRunTeacher(runId: number, userId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}/teachers/${userId}`);
}
```

- [ ] **Step 3: Verify `runTeachers` tests pass**

```bash
cd frontend && npx vitest run src/tests/runTeachers.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 4: Write the failing tests for `lib/runGroups.ts` (incl. `getCapacityClass`)**

Create `frontend/src/tests/runGroups.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listGroups, createGroup, updateGroup, deleteGroup, getCapacityClass,
} from '../lib/runGroups';
import { ApiError } from '../lib/api';
import type { GroupResponse } from '../lib/types';

const g: GroupResponse = { id: 1, run_id: 1, name: 'A', is_disabled: false, student_count: 3 };

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, statusText: '', json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('runGroups CRUD', () => {
  it('listGroups GETs /api/runs/{rid}/groups', async () => {
    const f = mockFetch(200, [g]); vi.stubGlobal('fetch', f);
    await expect(listGroups(1)).resolves.toEqual([g]);
    expect(f.mock.calls[0]![0]).toBe('/api/runs/1/groups');
  });
  it('createGroup POSTs {name}', async () => {
    const f = mockFetch(201, g); vi.stubGlobal('fetch', f);
    await createGroup(1, 'A');
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ name: 'A' });
  });
  it('createGroup 409 throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Group exists' }));
    await expect(createGroup(1, 'A')).rejects.toBeInstanceOf(ApiError);
  });
  it('updateGroup PATCHes /api/groups/{gid}', async () => {
    const f = mockFetch(200, g); vi.stubGlobal('fetch', f);
    await updateGroup(1, { name: 'B' });
    expect(f.mock.calls[0]![0]).toBe('/api/groups/1');
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe('PATCH');
  });
  it('deleteGroup 409 "Group has students" throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Group has students; reassign or remove first' }));
    await expect(deleteGroup(1)).rejects.toBeInstanceOf(ApiError);
  });
  it('deleteGroup 409 "Group has submissions" throws ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { detail: 'Group has past submissions; disable instead' }));
    await expect(deleteGroup(1)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getCapacityClass', () => {
  it('0 → empty', () => expect(getCapacityClass(0)).toBe('empty'));
  it('1 → ok', () => expect(getCapacityClass(1)).toBe('ok'));
  it('7 → ok', () => expect(getCapacityClass(7)).toBe('ok'));
  it('8 → warn', () => expect(getCapacityClass(8)).toBe('warn'));
  it('9 → warn', () => expect(getCapacityClass(9)).toBe('warn'));
  it('10 → full', () => expect(getCapacityClass(10)).toBe('full'));
  it('11 → full (defensive over-cap)', () => expect(getCapacityClass(11)).toBe('full'));
  it('-1 → empty (defensive)', () => expect(getCapacityClass(-1)).toBe('empty'));
  it('NaN → empty (defensive)', () => expect(getCapacityClass(NaN)).toBe('empty'));
});
```

- [ ] **Step 5: Implement `lib/runGroups.ts`**

Create `frontend/src/lib/runGroups.ts`:

```ts
import { api } from './api';
import type { GroupResponse } from './types';

export function listGroups(runId: number): Promise<GroupResponse[]> {
  return api.get<GroupResponse[]>(`/api/runs/${runId}/groups`);
}

export function createGroup(runId: number, name: string): Promise<GroupResponse> {
  return api.post<GroupResponse>(`/api/runs/${runId}/groups`, { name });
}

export function updateGroup(
  groupId: number,
  body: { name?: string; is_disabled?: boolean },
): Promise<GroupResponse> {
  return api.patch<GroupResponse>(`/api/groups/${groupId}`, body);
}

export function deleteGroup(groupId: number): Promise<void> {
  return api.delete(`/api/groups/${groupId}`);
}

export type CapacityClass = 'empty' | 'ok' | 'warn' | 'full';

export function getCapacityClass(count: number): CapacityClass {
  if (!Number.isFinite(count) || count <= 0) return 'empty';
  if (count <= 7) return 'ok';
  if (count <= 9) return 'warn';
  return 'full';
}
```

- [ ] **Step 6: Verify `runGroups` tests pass**

```bash
cd frontend && npx vitest run src/tests/runGroups.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 7: Write the failing tests for `lib/runRoster.ts`**

Create `frontend/src/tests/runRoster.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listRunStudents, addRunStudent, updateRunStudent, removeRunStudent,
  batchAddRunStudents, bulkMoveRunStudents, bulkDeleteRunStudents,
} from '../lib/runRoster';
import { ApiError } from '../lib/api';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, statusText: '', json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('roster CRUD', () => {
  it('listRunStudents GETs /api/runs/{rid}/students', async () => {
    const f = mockFetch(200, []); vi.stubGlobal('fetch', f);
    await listRunStudents(1);
    expect(f.mock.calls[0]![0]).toBe('/api/runs/1/students');
  });
  it('addRunStudent POSTs {email, group_id: null} for Unassigned (not omitted)', async () => {
    const f = mockFetch(201, {}); vi.stubGlobal('fetch', f);
    await addRunStudent(1, 'a@x.com', null);
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ email: 'a@x.com', group_id: null });
    expect('group_id' in body).toBe(true);
  });
  it('updateRunStudent PATCHes {group_id}', async () => {
    const f = mockFetch(200, {}); vi.stubGlobal('fetch', f);
    await updateRunStudent(1, 5, 3);
    expect(f.mock.calls[0]![0]).toBe('/api/runs/1/students/5');
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ group_id: 3 });
  });
  it('removeRunStudent DELETEs /api/runs/{rid}/students/{uid}', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 204, statusText: '', json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    await removeRunStudent(1, 5);
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });
});

describe('batch', () => {
  it('batchAddRunStudents POSTs {rows} and returns {results}', async () => {
    const f = mockFetch(207, { results: [] }); vi.stubGlobal('fetch', f);
    await batchAddRunStudents(1, [{ email: 'a@x.com' }]);
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ rows: [{ email: 'a@x.com' }] });
  });
});

describe('bulk validation', () => {
  it('bulkMoveRunStudents rejects empty user_ids', async () => {
    await expect(bulkMoveRunStudents(1, [], null)).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents rejects >200 user_ids', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    await expect(bulkMoveRunStudents(1, ids, null)).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents rejects duplicate user_ids', async () => {
    await expect(bulkMoveRunStudents(1, [1, 2, 1], null)).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents accepts exactly 200 user_ids', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    vi.stubGlobal('fetch', mockFetch(207, { results: [], summary: { total: 200, ok: 200, error: 0 } }));
    await expect(bulkMoveRunStudents(1, ids, null)).resolves.toBeDefined();
  });
  it('bulkDeleteRunStudents enforces same validation', async () => {
    await expect(bulkDeleteRunStudents(1, [])).rejects.toBeInstanceOf(ApiError);
    await expect(bulkDeleteRunStudents(1, [1, 1])).rejects.toBeInstanceOf(ApiError);
  });
  it('bulkMoveRunStudents sends {user_ids, group_id} body', async () => {
    const f = mockFetch(207, { results: [], summary: { total: 1, ok: 1, error: 0 } });
    vi.stubGlobal('fetch', f);
    await bulkMoveRunStudents(1, [5], 3);
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ user_ids: [5], group_id: 3 });
  });
});
```

- [ ] **Step 8: Implement `lib/runRoster.ts`**

Create `frontend/src/lib/runRoster.ts`:

```ts
import { api, ApiError } from './api';
import type {
  RunStudentResponse, RunStudentBatchRow, RunStudentBatchResultRow,
  BulkMoveResponse, BulkDeleteResponse,
} from './types';

export function listRunStudents(runId: number): Promise<RunStudentResponse[]> {
  return api.get<RunStudentResponse[]>(`/api/runs/${runId}/students`);
}

export function addRunStudent(
  runId: number, email: string, groupId: number | null,
): Promise<RunStudentResponse> {
  return api.post<RunStudentResponse>(`/api/runs/${runId}/students`, { email, group_id: groupId });
}

export function updateRunStudent(
  runId: number, userId: number, groupId: number | null,
): Promise<RunStudentResponse> {
  return api.patch<RunStudentResponse>(`/api/runs/${runId}/students/${userId}`, { group_id: groupId });
}

export function removeRunStudent(runId: number, userId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}/students/${userId}`);
}

export function batchAddRunStudents(
  runId: number, rows: RunStudentBatchRow[],
): Promise<{ results: RunStudentBatchResultRow[] }> {
  return api.post<{ results: RunStudentBatchResultRow[] }>(
    `/api/runs/${runId}/students/batch`, { rows },
  );
}

function validateBulkIds(userIds: number[]): void {
  if (userIds.length < 1) {
    throw new ApiError(0, 'bulkUserIds: must contain at least one user_id');
  }
  if (userIds.length > 200) {
    throw new ApiError(0, 'bulkUserIds: max 200 per chunk (callers must chunk)');
  }
  if (new Set(userIds).size !== userIds.length) {
    throw new ApiError(0, 'bulkUserIds: duplicate user_ids');
  }
}

export function bulkMoveRunStudents(
  runId: number, userIds: number[], groupId: number | null,
): Promise<BulkMoveResponse> {
  validateBulkIds(userIds);
  return api.post<BulkMoveResponse>(
    `/api/runs/${runId}/students/bulk-move`, { user_ids: userIds, group_id: groupId },
  );
}

export function bulkDeleteRunStudents(
  runId: number, userIds: number[],
): Promise<BulkDeleteResponse> {
  validateBulkIds(userIds);
  return api.post<BulkDeleteResponse>(
    `/api/runs/${runId}/students/bulk-delete`, { user_ids: userIds },
  );
}
```

- [ ] **Step 9: Verify all three resource-module tests pass**

```bash
cd frontend && npx vitest run src/tests/runTeachers.test.ts src/tests/runGroups.test.ts src/tests/runRoster.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 10: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes, baseline unchanged.

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/lib/runTeachers.ts frontend/src/lib/runGroups.ts frontend/src/lib/runRoster.ts \
        frontend/src/tests/runTeachers.test.ts frontend/src/tests/runGroups.test.ts frontend/src/tests/runRoster.test.ts
git commit -m "feat(frontend): add run-teachers / run-groups / run-roster lib helpers"
```

---

### Task 3: Shared UI primitives — `InlineConfirm`, `LoadingPlaceholder`, `FocusTrap`

**Files:**
- Create: `frontend/src/components/ui/InlineConfirm.svelte`
- Create: `frontend/src/components/ui/LoadingPlaceholder.svelte`
- Create: `frontend/src/components/ui/FocusTrap.svelte`
- Test: `frontend/src/tests/InlineConfirm.svelte.test.ts`
- Test: `frontend/src/tests/LoadingPlaceholder.svelte.test.ts`
- Test: `frontend/src/tests/FocusTrap.svelte.test.ts`

- [ ] **Step 1: Write the failing tests for `InlineConfirm`**

Create `frontend/src/tests/InlineConfirm.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InlineConfirm from '../components/ui/InlineConfirm.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount<typeof InlineConfirm>>;

beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) unmount(component); document.body.removeChild(target); vi.restoreAllMocks(); });

describe('InlineConfirm', () => {
  it('renders [Confirm] [Cancel] pair when mounted', () => {
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {} } });
    flushSync();
    const buttons = Array.from(target.querySelectorAll('button'));
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.textContent?.trim()).toBe('Confirm');
    expect(buttons[1]!.textContent?.trim()).toBe('Cancel');
  });

  it('uses confirmLabel when provided', () => {
    component = mount(InlineConfirm, { target, props: { confirmLabel: 'Confirm Delete — 3 students', onConfirm: () => {} } });
    flushSync();
    expect(target.querySelectorAll('button')[0]!.textContent?.trim()).toBe('Confirm Delete — 3 students');
  });

  it('renders warning above the pair when provided', () => {
    component = mount(InlineConfirm, { target, props: { warning: 'Students lose access.', onConfirm: () => {} } });
    flushSync();
    expect(target.textContent).toContain('Students lose access.');
  });

  it('Confirm click invokes onConfirm', () => {
    const onConfirm = vi.fn();
    component = mount(InlineConfirm, { target, props: { onConfirm } });
    flushSync();
    (target.querySelectorAll('button')[0] as HTMLButtonElement).click();
    flushSync();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Cancel click invokes onCancel (when provided) and does NOT invoke onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    component = mount(InlineConfirm, { target, props: { onConfirm, onCancel } });
    flushSync();
    (target.querySelectorAll('button')[1] as HTMLButtonElement).click();
    flushSync();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cancel click without onCancel prop is a no-op (no throw)', () => {
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {} } });
    flushSync();
    expect(() => (target.querySelectorAll('button')[1] as HTMLButtonElement).click()).not.toThrow();
  });

  it('confirmDataAction is reflected on the confirm button when provided', () => {
    component = mount(InlineConfirm, { target, props: { confirmDataAction: 'confirm-delete-item', onConfirm: () => {} } });
    flushSync();
    const confirmBtn = target.querySelectorAll('button')[0]!;
    expect(confirmBtn.getAttribute('data-action')).toBe('confirm-delete-item');
  });
});
```

> **Design note.** `InlineConfirm` is a *confirm panel* only — it always renders the `[Confirm] [Cancel]` pair when mounted. The parent decides when to mount it (via `{#if pendingX}<InlineConfirm .../>{:else}<button .../>{/if}`) and handles the outer "Delete"/"Remove"/etc. idle button itself. This is intentional: the primitive does not duplicate the parent's state, and `onCancel` simply tells the parent to flip its pending flag back. The earlier two-stage design (idle button + open state) would have required *two* clicks to reach the confirm, since the parent is already gating mount.

- [ ] **Step 2: Verify InlineConfirm test fails**

```bash
cd frontend && npx vitest run src/tests/InlineConfirm.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL (file not found).

- [ ] **Step 3: Implement `InlineConfirm.svelte`**

Create `frontend/src/components/ui/InlineConfirm.svelte`:

```svelte
<script lang="ts">
  let {
    confirmLabel = 'Confirm',
    confirmDataAction,
    warning,
    onConfirm,
    onCancel,
  }: {
    confirmLabel?: string;
    confirmDataAction?: string;
    warning?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } = $props();
</script>

<div class="inline-confirm">
  {#if warning}<div class="warning">{warning}</div>{/if}
  <div class="actions">
    <button type="button" class="confirm" data-action={confirmDataAction} onclick={onConfirm}>{confirmLabel}</button>
    <button type="button" class="cancel" onclick={() => onCancel?.()}>Cancel</button>
  </div>
</div>

<style>
  .inline-confirm { display: inline-flex; flex-direction: column; gap: 4px; }
  .warning { color: var(--text-muted, #666); font-size: 0.85em; }
  .actions { display: inline-flex; gap: 6px; }
</style>
```

- [ ] **Step 4: Verify InlineConfirm tests pass**

```bash
cd frontend && npx vitest run src/tests/InlineConfirm.svelte.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Write tests for `LoadingPlaceholder`**

Create `frontend/src/tests/LoadingPlaceholder.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LoadingPlaceholder from '../components/ui/LoadingPlaceholder.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount<typeof LoadingPlaceholder>>;

beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) unmount(component); document.body.removeChild(target); });

describe('LoadingPlaceholder', () => {
  it('renders default "Loading…" label', () => {
    component = mount(LoadingPlaceholder, { target, props: {} });
    flushSync();
    expect(target.querySelector('.loading-placeholder')?.textContent?.trim()).toBe('Loading…');
  });
  it('renders custom label', () => {
    component = mount(LoadingPlaceholder, { target, props: { label: 'Fetching…' } });
    flushSync();
    expect(target.querySelector('.loading-placeholder')?.textContent?.trim()).toBe('Fetching…');
  });
});
```

- [ ] **Step 6: Implement `LoadingPlaceholder.svelte`**

Create `frontend/src/components/ui/LoadingPlaceholder.svelte`:

```svelte
<script lang="ts">
  let { label = 'Loading…' }: { label?: string } = $props();
</script>

<div class="loading-placeholder">{label}</div>

<style>
  .loading-placeholder { color: var(--text-muted, #777); padding: 8px 0; font-style: italic; }
</style>
```

- [ ] **Step 7: Verify LoadingPlaceholder tests pass**

```bash
cd frontend && npx vitest run src/tests/LoadingPlaceholder.svelte.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 8: Write tests for `FocusTrap` (jsdom-bounded — see spec §3.1)**

Create `frontend/src/tests/FocusTrap.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import FocusTrap from '../components/ui/FocusTrap.svelte';

let outer: HTMLDivElement;
let target: HTMLDivElement;
let component: ReturnType<typeof mount<typeof FocusTrap>> | null = null;

beforeEach(() => {
  outer = document.createElement('div');
  target = document.createElement('div');
  outer.appendChild(target);
  document.body.appendChild(outer);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(outer);
  vi.restoreAllMocks();
});

describe('FocusTrap', () => {
  it('attaches and detaches a keydown listener on document', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    component = mount(FocusTrap, { target, props: { children: () => '' } });
    flushSync();
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    unmount(component);
    component = null;
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });
  it('captures previousFocus from document.activeElement', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement?.id).toBe('trigger');
    component = mount(FocusTrap, { target, props: { children: () => '' } });
    flushSync();
    // FocusTrap should have captured trigger as previousFocus internally.
    // We assert behavior by destroying and checking trigger is re-focused.
    // (jsdom focus is partially broken; rely on focus call rather than activeElement.)
    const focusSpy = vi.spyOn(trigger, 'focus');
    unmount(component);
    component = null;
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(trigger);
  });
  it('isConnected=false branch: restore no-ops without throwing', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    component = mount(FocusTrap, { target, props: { children: () => '' } });
    flushSync();
    // Remove the trigger to simulate unmounted (e.g., success-navigate path).
    document.body.removeChild(trigger);
    expect(trigger.isConnected).toBe(false);
    // Should not throw.
    expect(() => { unmount(component!); component = null; }).not.toThrow();
  });
});
```

- [ ] **Step 9: Implement `FocusTrap.svelte`**

Create `frontend/src/components/ui/FocusTrap.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    autofocusSelector = 'input, select, textarea, button',
    children,
  }: {
    autofocusSelector?: string;
    children: Snippet;
  } = $props();

  let containerEl: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;

  function getFocusable(): HTMLElement[] {
    if (!containerEl) return [];
    return Array.from(containerEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusables = getFocusable();
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    previousFocus = (document.activeElement as HTMLElement) ?? null;
    document.addEventListener('keydown', onKeydown, true);
    queueMicrotask(() => {
      const first = containerEl?.querySelector<HTMLElement>(autofocusSelector);
      first?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKeydown, true);
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  });
</script>

<div bind:this={containerEl}>{@render children()}</div>
```

- [ ] **Step 10: Verify FocusTrap tests pass**

```bash
cd frontend && npx vitest run src/tests/FocusTrap.svelte.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 11: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes, baseline unchanged.

- [ ] **Step 12: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/ui/InlineConfirm.svelte \
        frontend/src/components/ui/LoadingPlaceholder.svelte \
        frontend/src/components/ui/FocusTrap.svelte \
        frontend/src/tests/InlineConfirm.svelte.test.ts \
        frontend/src/tests/LoadingPlaceholder.svelte.test.ts \
        frontend/src/tests/FocusTrap.svelte.test.ts
git commit -m "feat(frontend): add shared UI primitives — InlineConfirm, LoadingPlaceholder, FocusTrap"
```

---

### Task 4: `lib/runStatus.ts` + `lib/csv.ts` (pure functions)

**Files:**
- Create: `frontend/src/lib/runStatus.ts`
- Create: `frontend/src/lib/csv.ts`
- Test: `frontend/src/tests/runStatus.test.ts`
- Test: `frontend/src/tests/csv.test.ts`

**Context:** Two pure-function modules. `runStatus` computes `draft | upcoming | active | ended` from `is_published` + `start_date` + `end_date` in local time; DST test pins to `America/New_York`. `csv.ts` implements the 11-step parse rules from spec §5.7 (BOM strip, line-ending normalize, delimiter detection, header detection with positional fallback, per-row validation, in-paste duplicate detection, already-enrolled flagging, `willCreateGroups` computation).

- [ ] **Step 1: Write `runStatus` tests**

Create `frontend/src/tests/runStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runStatus } from '../lib/runStatus';

describe('runStatus', () => {
  it('returns draft when !is_published regardless of dates', () => {
    const r = { is_published: false, start_date: '2026-01-01', end_date: '2026-12-31' };
    expect(runStatus(r, new Date('2026-06-01T12:00:00'))).toBe('draft');
  });

  it('returns upcoming when now is before start_date (local midnight)', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-09T23:59:59'))).toBe('upcoming');
  });

  it('returns active on the start date at local midnight', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-10T00:00:00'))).toBe('active');
  });

  it('returns active mid-window', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-15T08:00:00'))).toBe('active');
  });

  it('returns active on the end date at 23:59:59 local', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-20T23:59:59'))).toBe('active');
  });

  it('returns ended one second past the end_date local end-of-day', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    // 2026-06-21T00:00:00 local is just past end-of-day on 2026-06-20.
    expect(runStatus(r, new Date('2026-06-21T00:00:00'))).toBe('ended');
  });
});
```

- [ ] **Step 2: Run runStatus test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/runStatus.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../lib/runStatus'`.

- [ ] **Step 3: Implement `lib/runStatus.ts`**

```ts
export type RunStatus = 'draft' | 'upcoming' | 'active' | 'ended';

function startOfDayLocal(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDayLocal(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function runStatus(
  run: { is_published: boolean; start_date: string; end_date: string },
  now: Date = new Date(),
): RunStatus {
  if (!run.is_published) return 'draft';
  if (now < startOfDayLocal(run.start_date)) return 'upcoming';
  if (now > endOfDayLocal(run.end_date)) return 'ended';
  return 'active';
}
```

- [ ] **Step 4: Verify runStatus tests pass**

```bash
cd frontend && npx vitest run src/tests/runStatus.test.ts 2>&1 | tail -10
```

Expected: 6/6 PASS.

- [ ] **Step 5: Write `csv` tests (boundary cases + 11-step rules)**

Create `frontend/src/tests/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCsv } from '../lib/csv';

describe('parseCsv — error cases', () => {
  it('empty input → ok=false', () => {
    const r = parseCsv('', [], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Paste is empty.');
  });

  it('whitespace-only → ok=false', () => {
    const r = parseCsv('   \n  \r\n  ', [], []);
    expect(r.ok).toBe(false);
  });

  it('header promises emails but all blank → No email column', () => {
    const r = parseCsv('Name,Email,Group\nAlice,,A\nBob,,B', [], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('No email column found.');
  });
});

describe('parseCsv — header + delimiter detection', () => {
  it('detects comma delimiter and header row', () => {
    const r = parseCsv('Name,Email,Group\nAlice,a@x.com,G1', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.delimiter).toBe(',');
      expect(r.hasHeader).toBe(true);
      expect(r.rows[0].parsed).toEqual({ name: 'Alice', email: 'a@x.com', group: 'G1' });
    }
  });

  it('detects tab delimiter when tabs dominate', () => {
    const r = parseCsv('Name\tEmail\tGroup\nAlice\ta@x.com\tG1', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.delimiter).toBe('\t');
  });

  it('tie between tab and comma → tab wins', () => {
    const r = parseCsv('a\tb,c', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.delimiter).toBe('\t');
  });

  it('positional fallback: first cell looks like email → [email, group?]', () => {
    const r = parseCsv('a@x.com,G1\nb@x.com,G2', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hasHeader).toBe(false);
      expect(r.rows[0].parsed).toEqual({ name: null, email: 'a@x.com', group: 'G1' });
    }
  });

  it('positional fallback: first cell not email → [name, email, group?]', () => {
    const r = parseCsv('Alice,a@x.com,G1', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed).toEqual({ name: 'Alice', email: 'a@x.com', group: 'G1' });
  });

  it('single-cell paste: bare email lands as {email}', () => {
    const r = parseCsv('a@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed).toEqual({ name: null, email: 'a@x.com', group: null });
  });
});

describe('parseCsv — normalization', () => {
  it('strips leading BOM', () => {
    const r = parseCsv('﻿Email\na@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed.email).toBe('a@x.com');
  });

  it('normalizes CRLF and CR line endings', () => {
    const r = parseCsv('Email\r\na@x.com\rb@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it('drops blank lines', () => {
    const r = parseCsv('a@x.com\n\n\nb@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it('lowercases emails on output', () => {
    const r = parseCsv('A@X.COM', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed.email).toBe('a@x.com');
  });
});

describe('parseCsv — validation, duplicates, already-enrolled, willCreateGroups', () => {
  it('marks invalid email rows', () => {
    const r = parseCsv('a@x.com\nnotanemail', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0].valid).toBe(true);
      expect(r.rows[1].valid).toBe(false);
      expect(r.invalidCount).toBe(1);
    }
  });

  it('flags in-paste duplicate as invalid; first occurrence stays valid', () => {
    const r = parseCsv('a@x.com\nA@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0].valid).toBe(true);
      expect(r.rows[1].valid).toBe(false);
      expect(r.rows[1].errors[0]).toMatch(/Duplicate in paste/);
      expect(r.duplicateInPasteCount).toBe(1);
    }
  });

  it('marks already-enrolled rows but keeps them valid', () => {
    const r = parseCsv('a@x.com\nb@x.com', [], ['a@x.com']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0].alreadyEnrolled).toBe(true);
      expect(r.rows[0].valid).toBe(true);
      expect(r.alreadyEnrolledEmails).toEqual(['a@x.com']);
    }
  });

  it('willCreateGroups lists only groups not in existing list (case-sensitive, trimmed)', () => {
    const r = parseCsv('a@x.com,Alpha\nb@x.com,Beta\nc@x.com,Beta', ['Alpha'], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.willCreateGroups).toEqual(['Beta']);
  });
});
```

- [ ] **Step 6: Run csv test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/csv.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../lib/csv'`.

- [ ] **Step 7: Implement `lib/csv.ts`**

```ts
export type CsvRow = {
  rowIndex: number;
  raw: string[];
  parsed: { name: string | null; email: string; group: string | null };
  valid: boolean;
  errors: string[];
  alreadyEnrolled: boolean;
};

export type CsvParseResult =
  | {
      ok: true;
      delimiter: ',' | '\t';
      hasHeader: boolean;
      rows: CsvRow[];
      validCount: number;
      invalidCount: number;
      duplicateInPasteCount: number;
      alreadyEnrolledEmails: string[];
      willCreateGroups: string[];
    }
  | { ok: false; error: string };

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function normalize(text: string): string[] {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  t = t.replace(/\r\n?/g, '\n');
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function detectDelimiter(line: string): ',' | '\t' {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

type HeaderMap = { name: number | null; email: number | null; group: number | null };

function detectHeader(cells: string[]): HeaderMap | null {
  const lower = cells.map((c) => c.toLowerCase().trim());
  const hasEmailHeader = lower.some((c) => c === 'email' || c === 'e-mail' || c === 'mail');
  if (!hasEmailHeader) return null;
  const map: HeaderMap = { name: null, email: null, group: null };
  lower.forEach((c, idx) => {
    if (c === 'name' || c === 'full name' || c === 'fullname') map.name = idx;
    else if (c === 'email' || c === 'e-mail' || c === 'mail') map.email = idx;
    else if (c === 'group' || c === 'group name') map.group = idx;
  });
  return map;
}

export function parseCsv(
  text: string,
  existingGroupNames: string[],
  existingRosterEmails: string[],
): CsvParseResult {
  const lines = normalize(text);
  if (lines.length === 0) return { ok: false, error: 'Paste is empty.' };

  const delimiter = detectDelimiter(lines[0]);
  const split = lines.map((l) => l.split(delimiter).map((c) => c.trim()));
  const header = detectHeader(split[0]);
  const hasHeader = header !== null;
  const dataRows = hasHeader ? split.slice(1) : split;

  // Positional fallback: peek first row to decide [email, group?] vs [name, email, group?]
  let positional: 'email-first' | 'name-first' = 'name-first';
  if (!hasHeader && dataRows.length > 0) {
    positional = EMAIL_RE.test(dataRows[0][0] || '') ? 'email-first' : 'name-first';
  }

  // No email column → all rows blank? signal pre-row error.
  if (hasHeader && header.email !== null) {
    const allEmailsBlank = dataRows.every((r) => !(r[header.email!] || '').trim());
    if (allEmailsBlank && dataRows.length > 0) {
      return { ok: false, error: 'No email column found.' };
    }
  }

  const seenEmails = new Map<string, number>(); // lowercased → first row index
  const existingLower = new Set(existingRosterEmails.map((e) => e.toLowerCase()));
  const existingGroupSet = new Set(existingGroupNames);

  const rows: CsvRow[] = dataRows.map((raw, i) => {
    const cells = raw;
    let name: string | null = null;
    let email = '';
    let group: string | null = null;

    if (hasHeader) {
      if (header.name !== null) name = cells[header.name] || '';
      if (header.email !== null) email = cells[header.email] || '';
      if (header.group !== null) group = cells[header.group] || '';
    } else if (positional === 'email-first') {
      email = cells[0] || '';
      group = cells[1] ?? null;
    } else {
      if (cells.length === 1) {
        // Single-cell row in name-first mode: treat the cell as email if it matches.
        const only = cells[0] || '';
        if (EMAIL_RE.test(only)) email = only;
        else name = only;
      } else {
        name = cells[0] || '';
        email = cells[1] || '';
        group = cells[2] ?? null;
      }
    }

    name = name && name.trim() ? name.trim() : null;
    email = email.trim().toLowerCase();
    group = group && group.trim() ? group.trim() : null;

    const errors: string[] = [];
    let valid = true;
    if (!email) {
      errors.push('Missing email');
      valid = false;
    } else if (!EMAIL_RE.test(email)) {
      errors.push('Invalid email format');
      valid = false;
    }

    return {
      rowIndex: i + 1,
      raw: cells,
      parsed: { name, email, group },
      valid,
      errors,
      alreadyEnrolled: false,
    };
  });

  // In-paste duplicate detection.
  let duplicateInPasteCount = 0;
  for (const row of rows) {
    if (!row.valid) continue;
    const key = row.parsed.email;
    if (seenEmails.has(key)) {
      row.valid = false;
      row.errors.push('Duplicate in paste (will skip)');
      duplicateInPasteCount += 1;
    } else {
      seenEmails.set(key, row.rowIndex);
    }
  }

  // Already-enrolled detection (only against rows that are still valid).
  const alreadyEnrolledSet = new Set<string>();
  for (const row of rows) {
    if (!row.valid) continue;
    if (existingLower.has(row.parsed.email)) {
      row.alreadyEnrolled = true;
      alreadyEnrolledSet.add(row.parsed.email);
    }
  }

  // willCreateGroups: sorted unique group names from valid rows whose name is NOT existing.
  const willCreateSet = new Set<string>();
  for (const row of rows) {
    if (!row.valid) continue;
    const g = row.parsed.group;
    if (g && !existingGroupSet.has(g)) willCreateSet.add(g);
  }

  const validCount = rows.filter((r) => r.valid).length;
  const invalidCount = rows.length - validCount;

  return {
    ok: true,
    delimiter,
    hasHeader,
    rows,
    validCount,
    invalidCount,
    duplicateInPasteCount,
    alreadyEnrolledEmails: Array.from(alreadyEnrolledSet).sort(),
    willCreateGroups: Array.from(willCreateSet).sort(),
  };
}
```

- [ ] **Step 8: Verify csv tests pass**

```bash
cd frontend && npx vitest run src/tests/csv.test.ts 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 9: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes, baseline unchanged.

- [ ] **Step 10: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/lib/runStatus.ts \
        frontend/src/lib/csv.ts \
        frontend/src/tests/runStatus.test.ts \
        frontend/src/tests/csv.test.ts
git commit -m "feat(frontend): add runStatus + csv parsers (lib/runStatus.ts, lib/csv.ts)"
```

---

### Task 5: `RunListPage` + routes + `App.svelte` componentMap + `CourseCard` restructure

**Files:**
- Create: `frontend/src/pages/runs/RunListPage.svelte`
- Modify: `frontend/src/routes.ts`
- Modify: `frontend/src/App.svelte` (componentMap lines 14-25)
- Modify: `frontend/src/components/course/CourseCard.svelte`
- Test: `frontend/src/tests/RunListPage.svelte.test.ts`

**Context:** First admin-facing page in this feature. Renders the per-course runs table in backend order (no frontend re-sort), with status badge from `runStatus`, version label resolution (`v{idx+1} ({created_at YYYY-MM-DD})` where `idx` is the index in versions sorted by `created_at`), and `Delete` action only when `!is_published`. Empty state has a `Create the first run` CTA. The `New run` button is disabled (with tooltip) when no published version exists. `CourseCard` admin-only branch is restructured to mirror the mixed-admin pattern: card-as-`<div>`, title-as-`<a href="/courses/:slug">`, sibling `Edit` + `Runs` buttons gated on `course.is_admin`.

- [ ] **Step 1: Write `RunListPage` test (empty + populated + delete-only-when-draft)**

Create `frontend/src/tests/RunListPage.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunListPage from '../pages/runs/RunListPage.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error monkeypatch
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
  // Hash router default
  location.hash = '#/courses/algebra/runs';
});

function ok(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe('RunListPage', () => {
  it('renders empty state with Create-the-first-run CTA when no runs', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.includes('/runs')) return ok([]);
      if (url.includes('/versions')) return ok([]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunListPage, { target, props: { params: { courseSlug: 'algebra' } } });
    await settle();

    expect(target.textContent).toContain('No runs yet');
    expect(target.textContent).toContain('Create the first run');
    unmount(cmp);
  });

  it('renders rows in backend order with status badge and version label', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.endsWith('/runs')) return ok([
        { id: 10, course_id: 1, version_id: 99, title: 'Spring 2026', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: false },
        { id: 11, course_id: 1, version_id: 99, title: 'Fall 2026', start_date: '2026-09-01', end_date: '2026-12-15', is_published: true, groups_enabled: true },
      ]);
      if (url.includes('/versions')) return ok([
        { id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false },
      ]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunListPage, { target, props: { params: { courseSlug: 'algebra' } } });
    await settle();

    const rows = target.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Spring 2026');
    expect(rows[1].textContent).toContain('Fall 2026');
    // Status badges
    expect(target.textContent).toMatch(/Draft/);
    // Version label format
    expect(target.textContent).toContain('v1 (2026-01-01)');
    // Delete only on the unpublished row
    const deleteButtons = target.querySelectorAll('button[data-action="delete-run"]');
    expect(deleteButtons.length).toBe(1);
    unmount(cmp);
  });

  it('disables New-run button with tooltip when no published version exists', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.endsWith('/runs')) return ok([]);
      if (url.includes('/versions')) return ok([
        { id: 99, course_id: 1, created_at: '2026-01-01', published_at: null, is_disabled: false },
      ]);
      return Promise.reject(new Error('unexpected ' + url));
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunListPage, { target, props: { params: { courseSlug: 'algebra' } } });
    await settle();

    const btn = target.querySelector('button[data-action="new-run"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Publish a course version');
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run RunListPage test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunListPage.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../pages/runs/RunListPage.svelte'`.

- [ ] **Step 3: Implement `pages/runs/RunListPage.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { listRuns, listVersions, deleteRun } from '../../lib/runs';
  import { runStatus } from '../../lib/runStatus';
  import { navigate } from '../../lib/router.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import InlineConfirm from '../../components/ui/InlineConfirm.svelte';
  import { api } from '../../lib/api';
  import type { Course, Version, RunResponse } from '../../lib/types';

  let { params }: { params: { courseSlug: string } } = $props();

  let course: Course | null = $state(null);
  let runs: RunResponse[] | null = $state(null);
  let versions: Version[] | null = $state(null);
  let loadError: string | null = $state(null);
  let showNewRun = $state(false);
  let pendingDelete: number | null = $state(null);

  const versionLabelById = $derived.by(() => {
    const map = new Map<number, string>();
    if (!versions) return map;
    const sorted = [...versions].sort((a, b) => a.created_at.localeCompare(b.created_at));
    sorted.forEach((v, idx) => {
      map.set(v.id, `v${idx + 1} (${v.created_at.slice(0, 10)})`);
    });
    return map;
  });

  const hasPublishedVersion = $derived(
    (versions ?? []).some((v) => v.published_at !== null && !v.is_disabled),
  );

  async function load() {
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${params.courseSlug}`);
      if (!c.is_admin) {
        navigate(`/courses/${params.courseSlug}`);
        return;
      }
      course = c;
      const [rs, vs] = await Promise.all([
        listRuns(c.id),
        listVersions(c.id),
      ]);
      runs = rs;
      versions = vs;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        loadError = 'Course not found.';
      } else if (e instanceof ApiError && e.status === 403) {
        navigate('/courses');
      } else {
        loadError = e instanceof ApiError ? e.displayMessage : 'Failed to load runs.';
      }
    }
  }

  async function confirmDelete(runId: number) {
    try {
      await deleteRun(runId);
      runs = (runs ?? []).filter((r) => r.id !== runId);
      pendingDelete = null;
      pushToast('Run deleted.', 'success');
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }

  onMount(load);
</script>

{#if loadError}
  <div class="error">{loadError} <a href="#/courses">Back to courses</a></div>
{:else if course === null || runs === null || versions === null}
  <LoadingPlaceholder label="Loading runs…" />
{:else}
  <header>
    <nav class="breadcrumb">
      <a href="#/courses">Courses</a> › <a href="#/courses/{course.slug}">{course.name}</a> › Runs
    </nav>
    <button
      data-action="new-run"
      disabled={!hasPublishedVersion}
      title={hasPublishedVersion ? '' : 'Publish a course version before creating a run.'}
      onclick={() => (showNewRun = true)}
    >
      New run
    </button>
  </header>

  {#if runs.length === 0}
    <div class="empty">
      <p>No runs yet</p>
      <button
        data-action="create-first-run"
        disabled={!hasPublishedVersion}
        title={hasPublishedVersion ? '' : 'Publish a course version before creating a run.'}
        onclick={() => (showNewRun = true)}
      >
        Create the first run
      </button>
    </div>
  {:else}
    <table>
      <thead>
        <tr><th>Title</th><th>Status</th><th>Version</th><th>Start</th><th>End</th><th>Actions</th></tr>
      </thead>
      <tbody>
        {#each runs as run (run.id)}
          {@const status = runStatus(run)}
          <tr>
            <td><a href="#/courses/{course.slug}/runs/{run.id}">{run.title}</a></td>
            <td><span class="badge badge-{status}">{status[0].toUpperCase() + status.slice(1)}</span></td>
            <td>{versionLabelById.get(run.version_id) ?? '—'}</td>
            <td>{run.start_date}</td>
            <td>{run.end_date}</td>
            <td>
              <a href="#/courses/{course.slug}/runs/{run.id}">Open</a>
              {#if !run.is_published}
                {#if pendingDelete === run.id}
                  <InlineConfirm
                    confirmLabel="Confirm Delete"
                    onConfirm={() => confirmDelete(run.id)}
                    onCancel={() => (pendingDelete = null)}
                  />
                {:else}
                  <button data-action="delete-run" onclick={() => (pendingDelete = run.id)}>Delete</button>
                {/if}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if showNewRun}
    <!-- T6 mounts NewRunModal here; placeholder for now -->
    {#await import('../../components/runs/NewRunModal.svelte') then mod}
      {@const NewRunModal = mod.default}
      <NewRunModal course={course} versions={versions} onClose={() => (showNewRun = false)} />
    {/await}
  {/if}
{/if}
```

> Note: The dynamic import of `NewRunModal.svelte` lets this task land before T6 implements that component — the modal is only loaded when `showNewRun` becomes true, so tests in this task that do not click `New run` still pass. T6 adds the actual modal **and converts this dynamic import into a static import** (move `import NewRunModal from '../../components/runs/NewRunModal.svelte';` to the top of the `<script>` block, drop the `{#await}` wrapper, and render `<NewRunModal ... />` directly when `showNewRun`). Same pattern is used in T7 / T12 for `RosterImportModal.svelte` and is converted to static in T16.

- [ ] **Step 4: Add the RunListPage route**

Modify `frontend/src/routes.ts` — append one entry to the `routes` array (location depends on existing layout; place near other course-nested routes):

```ts
{ path: '/courses/:courseSlug/runs', component: 'RunListPage' },
```

> The `RunDetailPage` route is **deliberately not registered here** — T5's `RunListPage` already renders links to detail URLs (`<a href="#/courses/{slug}/runs/{id}">`). If the route + componentMap entry existed before T7 implements the page, the router would try to resolve a component that doesn't exist yet. T7 Step 4 below adds both the route entry and the componentMap entry atomically.

- [ ] **Step 5: Register `RunListPage` in `App.svelte` componentMap**

Modify `frontend/src/App.svelte` lines 14-25 — add the import and the map entry:

```ts
import RunListPage from './pages/runs/RunListPage.svelte';
```

Update the componentMap object literal:

```ts
const componentMap: Record<string, ComponentType> = {
  // ...existing entries...
  RunListPage,
};
```

(Detail links rendered by `RunListPage` will produce a no-op navigation if clicked before T7 lands, since the route isn't registered. That's acceptable in mid-feature commits — fail-safe by design.)

- [ ] **Step 6: Restructure `CourseCard.svelte` admin-only branch**

Read the current file structure first. Then modify `frontend/src/components/course/CourseCard.svelte` so the admin branch mirrors the mixed-admin pattern: the card is a `<div>` (not an `<a>`), the title is an `<a href="#/courses/{slug}">`, and `Edit` / `Runs` are sibling buttons rendered only when `course.is_admin === true`.

```svelte
<!-- Replacement template for the admin-only / is_admin branch -->
<div class="course-card">
  <a class="course-title" href="#/courses/{course.slug}">{course.name}</a>
  <p class="course-summary">{course.summary}</p>
  {#if course.is_admin}
    <div class="card-actions">
      <a class="btn" href="#/admin/courses/{course.slug}/edit">Edit</a>
      <a class="btn" href="#/courses/{course.slug}/runs">Runs</a>
    </div>
  {/if}
</div>
```

Preserve existing class names and surrounding markup; only swap the admin branch's structure. Update any existing CourseCard tests if they probed `<a>` as the card root.

- [ ] **Step 7: Verify RunListPage tests pass**

```bash
cd frontend && npx vitest run src/tests/RunListPage.svelte.test.ts 2>&1 | tail -10
```

Expected: 3/3 PASS.

- [ ] **Step 8: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; svelte-check baseline unchanged.

- [ ] **Step 9: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/pages/runs/RunListPage.svelte \
        frontend/src/tests/RunListPage.svelte.test.ts \
        frontend/src/routes.ts \
        frontend/src/App.svelte \
        frontend/src/components/course/CourseCard.svelte
git commit -m "feat(frontend): RunListPage + routes + CourseCard Runs button"
```

---

### Task 6: `NewRunModal.svelte`

**Files:**
- Create: `frontend/src/components/runs/NewRunModal.svelte`
- Test: `frontend/src/tests/NewRunModal.svelte.test.ts`

**Context:** Modal opened from `RunListPage`. Wraps a `FocusTrap` from T3. Four validation rules (title empty after trim, start empty, end empty, end < start). Read-only Version row displays the label derived from the most recent published, non-disabled version. Submit payload omits `version_id` (backend auto-pins). On success → `onClose()` + `navigate(/courses/:slug/runs)` (the list page). On API error → top-of-body banner using `e.displayMessage`.

> **Note on success navigation.** The spec's create-flow lands on the run **detail** page, but the detail route + componentMap entry are not registered until T7 (this avoids reachable-but-broken routes in the T5→T7 gap, per the R3 codex pass). T6 therefore navigates to the list page initially, and T7 includes a one-line **retrofit step** that updates this `navigate(...)` call to `/courses/:slug/runs/:id` AND updates the corresponding test assertion. Same pattern as T5's dynamic→static `NewRunModal` import retrofit done here.

- [ ] **Step 1: Write modal tests (validation + submit shape + success navigation)**

Create `frontend/src/tests/NewRunModal.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NewRunModal from '../components/runs/NewRunModal.svelte';
import type { Course, Version } from '../lib/types';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error monkeypatch
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
  location.hash = '#/courses/algebra/runs';
});

const course: Course = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true } as Course;
const versions: Version[] = [
  { id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false } as Version,
];

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function mountModal(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onClose = vi.fn();
  const cmp = mount(NewRunModal, { target, props: { course, versions, onClose, ...extra } });
  return { target, cmp, onClose };
}

describe('NewRunModal', () => {
  it('blocks submit on empty title and surfaces inline error', async () => {
    const { target, cmp } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = '   ';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(target.textContent).toContain('Title is required');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('blocks submit when end < start', async () => {
    const { target, cmp } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-15';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(target.textContent).toMatch(/end date must be on or after start date/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('submits payload WITHOUT version_id and navigates on success', async () => {
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      expect(url).toContain('/api/courses/1/runs');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', groups_enabled: false });
      expect('version_id' in body).toBe(false);
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 42 }),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as Response);
    });

    const { target, cmp, onClose } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-30';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onClose).toHaveBeenCalled();
    // T6 navigates to the list page; T7 retrofits this to the detail page.
    // See T7 Step 5 (retrofit) — that step also updates this assertion to
    // `#/courses/algebra/runs/42`.
    expect(location.hash).toBe('#/courses/algebra/runs');
    unmount(cmp);
  });

  it('surfaces API error as banner without closing', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'Title already exists in this course' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response));

    const { target, cmp, onClose } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-30';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(target.textContent).toContain('Title already exists');
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run modal test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/NewRunModal.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../components/runs/NewRunModal.svelte'`.

- [ ] **Step 3: Implement `components/runs/NewRunModal.svelte`**

```svelte
<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { createRun } from '../../lib/runs';
  import { navigate } from '../../lib/router.svelte';
  import FocusTrap from '../ui/FocusTrap.svelte';
  import type { Course, Version } from '../../lib/types';

  let { course, versions, onClose }: {
    course: Course;
    versions: Version[];
    onClose: () => void;
  } = $props();

  let title = $state('');
  let start_date = $state('');
  let end_date = $state('');
  let groups_enabled = $state(false);

  let errors = $state<{ title?: string; start_date?: string; end_date?: string }>({});
  let submitError: string | null = $state(null);
  let submitting = $state(false);

  const versionLabel = $derived.by(() => {
    const eligible = versions.filter((v) => v.published_at !== null && !v.is_disabled);
    if (eligible.length === 0) return null;
    const sorted = [...versions].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const idx = sorted.findIndex((v) => v.id === eligible[eligible.length - 1].id);
    return `v${idx + 1} (${sorted[idx].created_at.slice(0, 10)})`;
  });

  function validate(): boolean {
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Title is required';
    if (!start_date) next.start_date = 'Start date is required';
    if (!end_date) next.end_date = 'End date is required';
    if (start_date && end_date && end_date < start_date) {
      next.end_date = 'End date must be on or after start date';
    }
    errors = next;
    return Object.keys(next).length === 0;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!validate()) return;
    submitting = true;
    submitError = null;
    try {
      await createRun(course.id, {
        title: title.trim(),
        start_date,
        end_date,
        groups_enabled,
      });
      onClose();
      // Navigate to the list page; T7 retrofits this to the detail page once
      // the `/courses/:courseSlug/runs/:runId` route + componentMap entry exist.
      // Until T7 ships, navigating to the detail URL would hit an unregistered
      // route and render nothing. Going to the list keeps the create-flow
      // observable (the new run appears at the top of the table).
      navigate(`/courses/${course.slug}/runs`);
    } catch (e) {
      if (e instanceof ApiError) submitError = e.displayMessage;
      else submitError = 'Unable to create run.';
    } finally {
      submitting = false;
    }
  }

  function onBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onclick={onBackdrop}>
  <FocusTrap>
    <div class="modal" role="dialog" aria-modal="true" aria-label="New run">
      <header>
        <h2>New run</h2>
        <button type="button" aria-label="Close" onclick={onClose}>×</button>
      </header>

      {#if submitError}
        <div class="error-banner">{submitError}</div>
      {/if}

      <form onsubmit={submit}>
        <label>
          Title
          <input name="title" maxlength="200" autofocus bind:value={title} />
          {#if errors.title}<span class="field-error">{errors.title}</span>{/if}
        </label>

        <label>
          Start date
          <input type="date" name="start_date" bind:value={start_date} />
          {#if errors.start_date}<span class="field-error">{errors.start_date}</span>{/if}
        </label>

        <label>
          End date
          <input type="date" name="end_date" bind:value={end_date} />
          {#if errors.end_date}<span class="field-error">{errors.end_date}</span>{/if}
        </label>

        <label>
          <input type="checkbox" bind:checked={groups_enabled} />
          Groups enabled
          <small>Enable to organize students into groups. Locked once the run is published.</small>
        </label>

        <p class="version-row">
          Version: {#if versionLabel}Will use {versionLabel}{:else}<em>No published version — close this modal and publish one first.</em>{/if}
        </p>

        <footer>
          <button type="button" onclick={onClose}>Cancel</button>
          <button type="submit" disabled={submitting || versionLabel === null}>
            {submitting ? 'Creating…' : 'Create run'}
          </button>
        </footer>
      </form>
    </div>
  </FocusTrap>
</div>
```

- [ ] **Step 4: Convert T5's dynamic import in `RunListPage.svelte` to a static import**

In `frontend/src/pages/runs/RunListPage.svelte`, replace the `{#await import('../../components/runs/NewRunModal.svelte') then mod}{@const NewRunModal = mod.default}<NewRunModal ... /> {/await}` block with:

```svelte
{#if showNewRun}
  <NewRunModal course={course} versions={versions} onClose={() => (showNewRun = false)} />
{/if}
```

Add the static import at the top of the `<script>` block:

```ts
import NewRunModal from '../../components/runs/NewRunModal.svelte';
```

This is purely a cleanup — the dynamic import was a T5-time scaffold for ordering.

- [ ] **Step 5: Verify modal tests pass**

```bash
cd frontend && npx vitest run src/tests/NewRunModal.svelte.test.ts 2>&1 | tail -10
```

Expected: 4/4 PASS.

- [ ] **Step 6: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/NewRunModal.svelte \
        frontend/src/tests/NewRunModal.svelte.test.ts \
        frontend/src/pages/runs/RunListPage.svelte
git commit -m "feat(frontend): NewRunModal with FocusTrap + validation + submit"
```

---

### Task 7: `RunDetailPage` shell (stale-guard + tabs scaffold + disabled-version banner + callback chain)

**Files:**
- Create: `frontend/src/pages/runs/RunDetailPage.svelte`
- Modify: `frontend/src/App.svelte` (componentMap)
- Modify: `frontend/src/routes.ts`
- Modify: `frontend/src/components/runs/NewRunModal.svelte` (Step 5 retrofit — nav target → detail page)
- Modify: `frontend/src/tests/NewRunModal.svelte.test.ts` (Step 5 retrofit — assertion update)
- Test: `frontend/src/tests/RunDetailPage.svelte.test.ts`

**Context:** The shell that hosts the four tab components implemented in T9–T17. Owns all six data slices (course, run, versions, teachers, groups, students) with the stale-guard pattern from spec §3.2 (single-commit gate; reset all slices to `null` at load start). Coerces `runId` from string with `Number.isInteger && > 0` guard. Computes `pinned` and `showDisabledBanner` via `$derived`. Implements `gotoTab(tab, prefilter?)`, `rosterPrefilter`, `onPrefilterClear`, and `refetchRosterData()` — the in-band refetch that re-reads `students` AND `groups` without bumping `loadToken`. Resets `activeTab` to `'overview'` and `rosterPrefilter` to `null` on `runId` change. Renders only the tab nav + an empty tab body in this task — actual tab components are placeholder stubs replaced in T9–T17.

- [ ] **Step 1: Write detail-page shell tests**

Create `frontend/src/tests/RunDetailPage.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error monkeypatch
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
  location.hash = '#/courses/algebra/runs/10';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

const courseFixture = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true };
const runFixture = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...overrides,
});
const versionFixture = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false, ...overrides,
});

function mockHappyPath() {
  fetchSpy.mockImplementation((url: string) => {
    if (url.includes('/courses/by-slug/')) return jres(courseFixture);
    // Match any positive integer runId so reset-on-runId-change tests work
    // when they remount with a different runId (e.g., 11) without rewiring fetch.
    const m = url.match(/\/api\/runs\/(\d+)$/);
    if (m) return jres(runFixture({ id: Number(m[1]) }));
    if (url.includes('/versions')) return jres([versionFixture()]);
    if (url.includes('/teachers')) return jres([]);
    if (url.includes('/groups')) return jres([]);
    if (url.includes('/students')) return jres([]);
    return Promise.reject(new Error('unexpected ' + url));
  });
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe('RunDetailPage shell', () => {
  it('shows loading placeholder until all 6 fetches resolve', async () => {
    mockHappyPath();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: '10' } } });
    expect(target.textContent).toContain('Loading');
    await settle();
    expect(target.textContent).toContain('Overview');
    unmount(cmp);
  });

  it('renders error placeholder on invalid runId (non-integer)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: 'abc' } } });
    await settle();
    expect(target.textContent).toContain('Invalid run');
    unmount(cmp);
  });

  it('shows disabled-version banner when pinned version is disabled', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions')) return jres([versionFixture({ is_disabled: true })]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: '10' } } });
    await settle();
    expect(target.textContent).toContain('course version is disabled');
    unmount(cmp);
  });

  it('renders loadError when by-slug returns 404', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ detail: 'Not found' }, 404);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: '10' } } });
    await settle();
    expect(target.textContent).toMatch(/(not found|Failed to load)/i);
    unmount(cmp);
  });

  it('resets activeTab to overview and rosterPrefilter to null on runId change', async () => {
    // Two consecutive mounts with different runIds — second mount must not preserve
    // tab state from the first (covered by the component-local $effect on runIdInt).
    mockHappyPath();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: '10' } } });
    await settle();
    // Switch to roster tab.
    const rosterBtn = Array.from(target.querySelectorAll('button[role="tab"]')).find((b) => b.textContent?.includes('Roster')) as HTMLButtonElement;
    rosterBtn.click();
    flushSync();
    expect(rosterBtn.getAttribute('aria-selected')).toBe('true');
    // Simulate navigation to another runId by re-mounting (App.svelte may reuse instance; the spec's $effect handles either).
    unmount(cmp);
    const cmp2 = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: '11' } } });
    await settle();
    const overviewBtn = Array.from(target.querySelectorAll('button[role="tab"]')).find((b) => b.textContent?.includes('Overview')) as HTMLButtonElement;
    expect(overviewBtn.getAttribute('aria-selected')).toBe('true');
    unmount(cmp2);
  });

});
```

> **Note on the in-band `refetchRosterData()` contract** (spec §3.2). T7 cannot exercise this directly without mounting `RunRosterTab` (which lands in T12). The contract — refetch writes `students` AND `groups` slices directly without bumping `loadToken`, so a concurrent navigation doesn't drop the refetched data — is verified later in T12's "single-row delete via InlineConfirm calls refetch" test and T17's "Done button refetch" test. Both flow through the `onRefetchRosterData` callback prop, which the parent wires to `RunDetailPage.refetchRosterData`. If you want a direct unit test on `refetchRosterData` here, add an `onMount` test hook that exposes it on `globalThis`; we deliberately skip that to avoid leaking implementation details.

- [ ] **Step 2: Run shell test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunDetailPage.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../pages/runs/RunDetailPage.svelte'`.

- [ ] **Step 3: Implement `pages/runs/RunDetailPage.svelte` shell**

```svelte
<script lang="ts">
  import { api, ApiError } from '../../lib/api';
  import { getRun, listVersions } from '../../lib/runs';
  import { listRunTeachers } from '../../lib/runTeachers';
  import { listGroups } from '../../lib/runGroups';
  import { listRunStudents } from '../../lib/runRoster';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import type { Course, Version, RunResponse, RunTeacherResponse, GroupResponse, RunStudentResponse } from '../../lib/types';

  type ActiveTab = 'overview' | 'teachers' | 'groups' | 'roster';

  let { params }: { params: { courseSlug: string; runId: string } } = $props();

  const runIdInt = $derived.by(() => {
    const n = Number(params.runId);
    return Number.isInteger(n) && n > 0 ? n : null;
  });

  let course = $state<Course | null>(null);
  let run = $state<RunResponse | null>(null);
  let versions = $state<Version[] | null>(null);
  let teachers = $state<RunTeacherResponse[] | null>(null);
  let groups = $state<GroupResponse[] | null>(null);
  let students = $state<RunStudentResponse[] | null>(null);
  let loadError = $state<ApiError | null>(null);

  let activeTab = $state<ActiveTab>('overview');
  let rosterPrefilter = $state<'unassigned' | null>(null);

  let loadToken = 0;

  async function loadAll(slug: string, rid: number) {
    const myToken = ++loadToken;
    course = null; run = null; versions = null; teachers = null;
    groups = null; students = null; loadError = null;
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${slug}`);
      if (myToken !== loadToken) return;
      const [r, vs, ts, gs, ss] = await Promise.all([
        getRun(rid),
        listVersions(c.id),
        listRunTeachers(rid),
        listGroups(rid),
        listRunStudents(rid),
      ]);
      if (myToken !== loadToken) return;
      course = c; run = r; versions = vs; teachers = ts; groups = gs; students = ss;
    } catch (e) {
      if (myToken !== loadToken) return;
      if (e instanceof ApiError && e.status === 401) return;
      loadError = (e instanceof ApiError) ? e : new ApiError(500, 'Failed to load run.');
    }
  }

  async function refetchRosterData(): Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }> {
    if (runIdInt === null) return { students: [], groups: [] };
    const [ss, gs] = await Promise.all([listRunStudents(runIdInt), listGroups(runIdInt)]);
    students = ss;
    groups = gs;
    return { students: ss, groups: gs };
  }

  function gotoTab(tab: ActiveTab, prefilter?: 'unassigned' | null): void {
    if (prefilter !== undefined) rosterPrefilter = prefilter;
    activeTab = tab;
  }

  function onPrefilterClear() {
    rosterPrefilter = null;
  }

  $effect(() => {
    void params.courseSlug;
    void runIdInt;
    if (runIdInt === null) return;
    loadAll(params.courseSlug, runIdInt);
  });

  $effect(() => {
    void runIdInt;
    activeTab = 'overview';
    rosterPrefilter = null;
  });

  const pinned = $derived(versions?.find((v) => v.id === run?.version_id));
  const showDisabledBanner = $derived(pinned?.is_disabled === true);
</script>

{#if runIdInt === null}
  <div class="error">Invalid run.</div>
{:else if loadError}
  <div class="error">{loadError.displayMessage}</div>
{:else if course === null || run === null || versions === null || teachers === null || groups === null || students === null}
  <LoadingPlaceholder label="Loading run…" />
{:else}
  <header class="run-header">
    <nav class="breadcrumb">
      <a href="#/courses">Courses</a> ›
      <a href="#/courses/{course.slug}">{course.name}</a> ›
      <a href="#/courses/{course.slug}/runs">Runs</a> ›
      {run.title}
    </nav>
    <!-- Publish bar comes in T8 -->
  </header>

  {#if showDisabledBanner}
    <div class="banner-warning">
      This run's course version is disabled. Re-enable it under Course Editor before publishing.
    </div>
  {/if}

  <nav class="tabs" role="tablist">
    <button role="tab" aria-selected={activeTab === 'overview'} onclick={() => (activeTab = 'overview')}>Overview</button>
    <button role="tab" aria-selected={activeTab === 'teachers'} onclick={() => (activeTab = 'teachers')}>Teachers</button>
    <button role="tab" aria-selected={activeTab === 'groups'} onclick={() => (activeTab = 'groups')}>Groups</button>
    <button role="tab" aria-selected={activeTab === 'roster'} onclick={() => (activeTab = 'roster')}>Roster</button>
  </nav>

  <section class="tab-body">
    {#if activeTab === 'overview'}
      <!-- T9 / T10 mount RunOverviewTab here -->
      <p>Overview tab (T9 + T10 implementation pending).</p>
    {:else if activeTab === 'teachers'}
      <!-- T11 -->
      <p>Teachers tab (T11 pending).</p>
    {:else if activeTab === 'groups'}
      <!-- T11 -->
      <p>Groups tab (T11 pending).</p>
    {:else if activeTab === 'roster'}
      <!-- T12-T17 -->
      <p>Roster tab (T12+ pending).</p>
    {/if}
  </section>
{/if}
```

> The placeholder `<p>` tags are removed when each downstream task lands; this lets the shell pass tests in isolation without depending on T9–T17.

- [ ] **Step 4: Register `RunDetailPage` route + componentMap entry**

Modify `frontend/src/routes.ts` — append one entry (T5 deferred this on purpose, see T5 Step 4):

```ts
{ path: '/courses/:courseSlug/runs/:runId', component: 'RunDetailPage' },
```

Modify `frontend/src/App.svelte` — add import and componentMap entry:

```ts
import RunDetailPage from './pages/runs/RunDetailPage.svelte';

const componentMap: Record<string, ComponentType> = {
  // ...existing entries...
  RunListPage,
  RunDetailPage,
};
```

- [ ] **Step 5: Retrofit T6's success navigation to the detail page**

Now that `/courses/:courseSlug/runs/:runId` is a registered route, update `NewRunModal` to navigate to the detail page on success (matches the spec's intended create-flow landing).

In `frontend/src/components/runs/NewRunModal.svelte`, locate the `submit()` function and replace its success branch:

```ts
// BEFORE (T6):
await createRun(course.id, { title: title.trim(), start_date, end_date, groups_enabled });
onClose();
// Navigate to the list page; T7 retrofits this to the detail page once
// the `/courses/:courseSlug/runs/:runId` route + componentMap entry exist.
// Until T7 ships, navigating to the detail URL would hit an unregistered
// route and render nothing. Going to the list keeps the create-flow
// observable (the new run appears at the top of the table).
navigate(`/courses/${course.slug}/runs`);
```

```ts
// AFTER (T7 retrofit):
const run = await createRun(course.id, { title: title.trim(), start_date, end_date, groups_enabled });
onClose();
navigate(`/courses/${course.slug}/runs/${run.id}`);
```

Update the corresponding test assertion in `frontend/src/tests/NewRunModal.svelte.test.ts`:

```ts
// BEFORE:
expect(location.hash).toBe('#/courses/algebra/runs');
// AFTER:
expect(location.hash).toBe('#/courses/algebra/runs/42');
```

Also drop the 5-line comment block above the `navigate(...)` call (the "Navigate to the list page; T7 retrofits this..." paragraph — no longer applicable).

- [ ] **Step 6: Verify shell tests + retrofit test pass**

```bash
cd frontend && npx vitest run src/tests/RunDetailPage.svelte.test.ts src/tests/NewRunModal.svelte.test.ts 2>&1 | tail -15
```

Expected: 5/5 (RunDetailPage) + 4/4 (NewRunModal) PASS.

- [ ] **Step 7: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 8: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/pages/runs/RunDetailPage.svelte \
        frontend/src/tests/RunDetailPage.svelte.test.ts \
        frontend/src/components/runs/NewRunModal.svelte \
        frontend/src/tests/NewRunModal.svelte.test.ts \
        frontend/src/App.svelte \
        frontend/src/routes.ts
git commit -m "feat(frontend): RunDetailPage shell + retrofit T6 nav to detail page"
```

---

### Task 8: Sticky publish bar + shared readiness `$derived`

**Files:**
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte`
- Test: `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`

**Context:** Lives at the top of `RunDetailPage`. Single `$derived` over already-loaded `run`/`teachers`/`groups`/`students` returns `{ checks: ChecklistRow[], firstViolation: string | null }`. T10 (Overview checklist) consumes `checks`; T8 (here) consumes `firstViolation` for the Publish button tooltip. Publish button disabled when `firstViolation !== null` OR `showDisabledBanner`. Unpublish uses `InlineConfirm` from T3. Both flows re-fetch `run` after success.

- [ ] **Step 1: Write publish-bar tests**

Create `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error monkeypatch
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
  location.hash = '#/courses/algebra/runs/10';
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
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function setup(opts: { teachers?: unknown[]; groups?: unknown[]; students?: unknown[]; run?: Record<string, unknown> } = {}) {
  fetchSpy.mockImplementation((url: string) => {
    if (url.includes('/courses/by-slug/')) return jres({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
    if (url.match(/\/api\/runs\/10$/)) return jres({
      id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
      is_published: false, groups_enabled: false, ...(opts.run ?? {}),
    });
    if (url.includes('/versions')) return jres([{ id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false }]);
    if (url.includes('/teachers')) return jres(opts.teachers ?? []);
    if (url.includes('/groups')) return jres(opts.groups ?? []);
    if (url.includes('/students')) return jres(opts.students ?? []);
    return Promise.reject(new Error('unexpected ' + url));
  });
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: '10' } } });
  return { target, cmp };
}

describe('Publish bar', () => {
  it('disables Publish when no teachers and shows first-violation tooltip', async () => {
    const { target, cmp } = setup({ teachers: [] });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('teacher');
    unmount(cmp);
  });

  it('enables Publish when all readiness checks pass', async () => {
    const { target, cmp } = setup({ teachers: [{ user_id: 1, user_email: 't@x.com' }] });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    unmount(cmp);
  });

  it('renders Unpublish + confirmation for published runs', async () => {
    const { target, cmp } = setup({ run: { is_published: true }, teachers: [{ user_id: 1, user_email: 't@x.com' }] });
    await settle();
    const btn = target.querySelector('button[data-action="unpublish"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    flushSync();
    expect(target.textContent).toContain('Confirm Unpublish');
    expect(target.textContent).toContain('lose access');
    unmount(cmp);
  });

  it('disables Publish when version is disabled', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true });
      if (url.match(/\/api\/runs\/10$/)) return jres({ id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: false });
      if (url.includes('/versions')) return jres([{ id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: true }]);
      if (url.includes('/teachers')) return jres([{ user_id: 1, user_email: 't@x.com' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { params: { courseSlug: 'algebra', runId: '10' } } });
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('disabled');
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run publish-bar test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunDetailPage.publish.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL — the publish bar is not yet rendered in the shell (T7 left the header bar's right side empty). The first test's `target.querySelector('button[data-action="publish"]')` returns `null` and the test errors with `Cannot read properties of null (reading 'disabled')`. That counts as a fail; we keep the cleaner assertion intent for after the implementation lands. (If you prefer a cleaner pre-implementation diagnostic, guard each test with `const btn = target.querySelector(...); expect(btn).not.toBeNull();` before reading properties — optional.)

- [ ] **Step 3: Add readiness `$derived` + publish bar to `RunDetailPage.svelte`**

Inside the `<script>` block (after the existing `pinned`/`showDisabledBanner` derivations), add:

```ts
import { publishRun, unpublishRun } from '../../lib/runs';
import { pushToast } from '../../stores/toasts.svelte';
import InlineConfirm from '../../components/ui/InlineConfirm.svelte';

type ChecklistState = 'ok' | 'violated' | 'na';
type ChecklistRow = { id: string; label: string; state: ChecklistState; hint?: string };

const readiness = $derived.by((): { checks: ChecklistRow[]; firstViolation: string | null } => {
  const checks: ChecklistRow[] = [];
  if (!run || teachers === null || groups === null || students === null) {
    return { checks: [], firstViolation: null };
  }
  // Teacher
  const teacherOk = teachers.length >= 1;
  checks.push({
    id: 'teacher',
    label: 'At least one teacher',
    state: teacherOk ? 'ok' : 'violated',
    hint: teacherOk ? undefined : 'Add at least one teacher.',
  });
  // Students assigned
  if (!run.groups_enabled) {
    checks.push({ id: 'assigned', label: 'All students assigned to a group', state: 'na' });
  } else {
    const unassigned = students.filter((s) => s.group_id === null).length;
    checks.push({
      id: 'assigned',
      label: 'All students assigned to a group',
      state: unassigned === 0 ? 'ok' : 'violated',
      hint: unassigned === 0 ? undefined : `${unassigned} students unassigned.`,
    });
  }
  // Group sizes
  if (!run.groups_enabled) {
    checks.push({ id: 'sizes', label: 'All groups have 1–10 students', state: 'na' });
  } else if (groups.length === 0) {
    checks.push({ id: 'sizes', label: 'All groups have 1–10 students', state: 'violated', hint: 'No groups defined.' });
  } else {
    const bad = groups.filter((g) => g.student_count < 1 || g.student_count > 10);
    checks.push({
      id: 'sizes',
      label: 'All groups have 1–10 students',
      state: bad.length === 0 ? 'ok' : 'violated',
      hint: bad.length === 0 ? undefined : bad.map((g) => `${g.name} (${g.student_count})`).join(', '),
    });
  }
  const violated = checks.find((c) => c.state === 'violated');
  return { checks, firstViolation: violated?.hint ?? null };
});

const publishBlocked = $derived(readiness.firstViolation !== null || showDisabledBanner);
const publishTooltip = $derived(showDisabledBanner
  ? "This run's course version is disabled. Re-enable it under Course Editor before publishing."
  : (readiness.firstViolation ?? ''));

let unpublishConfirmOpen = $state(false);

async function doPublish() {
  if (runIdInt === null) return;
  try {
    const r = await publishRun(runIdInt);
    run = r;
  } catch (e) {
    if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
  }
}

async function doUnpublish() {
  if (runIdInt === null) return;
  try {
    const r = await unpublishRun(runIdInt);
    run = r;
    unpublishConfirmOpen = false;
  } catch (e) {
    if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    unpublishConfirmOpen = false;
  }
}
```

Replace the existing `<header class="run-header">` block in the template with:

```svelte
<header class="run-header">
  <nav class="breadcrumb">
    <a href="#/courses">Courses</a> ›
    <a href="#/courses/{course.slug}">{course.name}</a> ›
    <a href="#/courses/{course.slug}/runs">Runs</a> ›
    {run.title}
  </nav>
  <div class="publish-bar">
    {#if !run.is_published}
      <button
        data-action="publish"
        disabled={publishBlocked}
        title={publishTooltip}
        onclick={doPublish}
      >
        Publish
      </button>
    {:else if unpublishConfirmOpen}
      <InlineConfirm
        confirmLabel="Confirm Unpublish"
        warning="Students will lose access immediately. Their progress data is preserved."
        onConfirm={doUnpublish}
        onCancel={() => (unpublishConfirmOpen = false)}
      />
    {:else}
      <button data-action="unpublish" onclick={() => (unpublishConfirmOpen = true)}>Unpublish</button>
    {/if}
  </div>
</header>
```

> The `readiness` `$derived` is exported via prop to `RunOverviewTab` in T10 (passed as `readiness={readiness}`). T10 consumes `readiness.checks` to render the checklist.

- [ ] **Step 4: Verify publish tests pass**

```bash
cd frontend && npx vitest run src/tests/RunDetailPage.publish.svelte.test.ts 2>&1 | tail -10
```

Expected: 4/4 PASS.

- [ ] **Step 5: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/pages/runs/RunDetailPage.svelte \
        frontend/src/tests/RunDetailPage.publish.svelte.test.ts
git commit -m "feat(frontend): publish bar + readiness derivation on RunDetailPage"
```

---

### Task 9: `RunOverviewTab` inline edits (`makeDirtyTracker` + cross-field revert)

**Files:**
- Create: `frontend/src/components/runs/RunOverviewTab.svelte`
- Test: `frontend/src/tests/RunOverviewTab.svelte.test.ts`
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte` (mount the tab)

**Context:** First section of `RunOverviewTab` — inline-edit `title`, `start_date`, `end_date`. One `makeDirtyTracker` bundling all three. Per-field commit on blur. Enter blurs the field (commits via onblur — exactly one PATCH). Escape reverts that field. Cross-field revert rule: on error, revert ONLY if the user has not since typed a new value into that field (compare `tracker.current[field]` with the captured `inFlightValue`).

- [ ] **Step 1: Write overview inline-edit tests**

Create `frontend/src/tests/RunOverviewTab.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab from '../components/runs/RunOverviewTab.svelte';
import type { RunResponse } from '../lib/types';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error monkeypatch
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

const makeRun = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...over,
} as RunResponse);

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function mountOverview(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  let run = makeRun();
  const setRun = vi.fn((r: RunResponse) => (run = r));
  const cmp = mount(RunOverviewTab, {
    target,
    props: {
      run,
      setRun,
      teachers: [], groups: [], students: [],
      readiness: { checks: [], firstViolation: null },
      onNavigateTab: vi.fn(),
      onDeleteRun: vi.fn(),
      ...extra,
    } as Record<string, unknown>,
  });
  return { target, cmp, setRun };
}

describe('RunOverviewTab inline edits', () => {
  it('PATCHes title on blur when changed', async () => {
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      expect(url).toContain('/api/runs/10');
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ title: 'Summer' });
      return jres(makeRun({ title: 'Summer' }));
    });
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('does NOT PATCH when blur fires with unchanged value', async () => {
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Enter blurs the field — exactly one PATCH (no double-fire from input event)', async () => {
    fetchSpy.mockImplementation(() => jres(makeRun({ title: 'Summer' })));
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('Escape reverts field to pristine without PATCH', async () => {
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(titleInput.value).toBe('Spring');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('on PATCH error: reverts only if user has not since typed a new value', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'fail' }, 500));
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    // User types a new value before PATCH rejects
    titleInput.value = 'Autumn';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(titleInput.value).toBe('Autumn'); // not reverted
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run overview test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunOverviewTab.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../components/runs/RunOverviewTab.svelte'`.

- [ ] **Step 3: Implement `components/runs/RunOverviewTab.svelte` (inline-edit section only — checklist/settings/danger zone land in T10)**

```svelte
<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { updateRun } from '../../lib/runs';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import type { DirtyTracker } from '../../lib/dirty.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { RunResponse, RunTeacherResponse, GroupResponse, RunStudentResponse } from '../../lib/types';

  type RunForm = { title: string; start_date: string; end_date: string };
  type ChecklistRow = { id: string; label: string; state: 'ok' | 'violated' | 'na'; hint?: string };
  type Readiness = { checks: ChecklistRow[]; firstViolation: string | null };

  let {
    run,
    setRun,
    teachers,
    groups,
    students,
    readiness,
    onNavigateTab,
    onDeleteRun,
  }: {
    run: RunResponse;
    setRun: (r: RunResponse) => void;
    teachers: RunTeacherResponse[];
    groups: GroupResponse[];
    students: RunStudentResponse[];
    readiness: Readiness;
    onNavigateTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster', prefilter?: 'unassigned' | null) => void;
    onDeleteRun: () => void;
  } = $props();

  let tracker = $state<DirtyTracker<RunForm> | null>(null);

  $effect(() => {
    if (run && tracker === null) {
      tracker = makeDirtyTracker<RunForm>({
        title: run.title,
        start_date: run.start_date,
        end_date: run.end_date,
      });
    }
  });

  async function commitField(field: keyof RunForm) {
    if (!tracker) return;
    const inFlightValue = tracker.current[field];
    const pristineValue = run[field];
    if (inFlightValue === pristineValue) return;
    try {
      const updated = await updateRun(run.id, { [field]: inFlightValue } as Record<string, string>);
      setRun(updated);
      tracker.reset({
        title: updated.title,
        start_date: updated.start_date,
        end_date: updated.end_date,
      });
    } catch (e) {
      if (tracker.current[field] === inFlightValue) {
        tracker.current[field] = pristineValue;
      }
      if (e instanceof ApiError) pushToast(`Could not update ${field}: ${e.displayMessage}`, 'error');
    }
  }

  function onFieldKey(e: KeyboardEvent, field: keyof RunForm) {
    if (!tracker) return;
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') {
      el.blur();
    } else if (e.key === 'Escape') {
      tracker.current[field] = run[field];
      el.blur();
    }
  }
</script>

{#if tracker}
  <section class="run-summary">
    <label>
      Title
      <input
        name="title"
        bind:value={tracker.current.title}
        onblur={() => commitField('title')}
        onkeydown={(e) => onFieldKey(e, 'title')}
        maxlength="200"
      />
    </label>
    <label>
      Start
      <input
        type="date"
        name="start_date"
        bind:value={tracker.current.start_date}
        onblur={() => commitField('start_date')}
        onkeydown={(e) => onFieldKey(e, 'start_date')}
      />
    </label>
    <label>
      End
      <input
        type="date"
        name="end_date"
        bind:value={tracker.current.end_date}
        onblur={() => commitField('end_date')}
        onkeydown={(e) => onFieldKey(e, 'end_date')}
      />
    </label>
  </section>

  <!-- T10 appends: settings panel, readiness checklist, danger zone -->
{/if}
```

- [ ] **Step 4: Wire the tab into `RunDetailPage.svelte`**

Replace the placeholder `<p>Overview tab (T9 + T10 implementation pending).</p>` with a real mount:

```svelte
{#if activeTab === 'overview'}
  <RunOverviewTab
    {run}
    setRun={(r) => (run = r)}
    {teachers}
    {groups}
    {students}
    {readiness}
    onNavigateTab={gotoTab}
    onDeleteRun={async () => { /* T10 wires deleteRun + navigate */ }}
  />
{:else if ...}
```

Add import: `import RunOverviewTab from '../../components/runs/RunOverviewTab.svelte';`.

- [ ] **Step 5: Verify overview tests pass**

```bash
cd frontend && npx vitest run src/tests/RunOverviewTab.svelte.test.ts 2>&1 | tail -10
```

Expected: 5/5 PASS.

- [ ] **Step 6: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunOverviewTab.svelte \
        frontend/src/tests/RunOverviewTab.svelte.test.ts \
        frontend/src/pages/runs/RunDetailPage.svelte
git commit -m "feat(frontend): RunOverviewTab inline edits with makeDirtyTracker"
```

---

### Task 10: `RunOverviewTab` checklist + settings + danger zone

**Files:**
- Modify: `frontend/src/components/runs/RunOverviewTab.svelte`
- Test: `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts`

**Context:** Append three sections to `RunOverviewTab` from T9. The checklist consumes the `checks` array from the parent's `readiness` prop (no duplicate computation). Settings panel toggles `groups_enabled` (locked when `is_published`). Danger zone: `Delete run` (visible only when `!is_published`) using `InlineConfirm` from T3. The "N students unassigned" hint button invokes `onNavigateTab('roster', 'unassigned')`.

- [ ] **Step 1: Write checklist + settings + danger-zone tests**

Create `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab from '../components/runs/RunOverviewTab.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error monkeypatch
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function mountTab(extra: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const setRun = vi.fn();
  const onNavigateTab = vi.fn();
  const onDeleteRun = vi.fn();
  const cmp = mount(RunOverviewTab, { target, props: {
    run: { id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: false } as unknown,
    setRun, teachers: [], groups: [], students: [],
    readiness: { checks: [], firstViolation: null },
    onNavigateTab, onDeleteRun,
    ...extra,
  } });
  return { target, cmp, setRun, onNavigateTab, onDeleteRun };
}

describe('RunOverviewTab checklist + settings + danger zone', () => {
  it('renders three checklist rows from readiness.checks', async () => {
    const { target, cmp } = mountTab({
      readiness: {
        checks: [
          { id: 'teacher', label: 'At least one teacher', state: 'ok' },
          { id: 'assigned', label: 'All students assigned to a group', state: 'na' },
          { id: 'sizes', label: 'All groups have 1–10 students', state: 'na' },
        ],
        firstViolation: null,
      },
    });
    await settle();
    expect(target.textContent).toContain('At least one teacher');
    expect(target.textContent).toContain('All groups have 1–10 students');
    unmount(cmp);
  });

  it('clicks unassigned hint and invokes onNavigateTab(roster, unassigned)', async () => {
    const { target, cmp, onNavigateTab } = mountTab({
      run: { id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: true },
      readiness: {
        checks: [
          { id: 'teacher', label: 'At least one teacher', state: 'ok' },
          { id: 'assigned', label: 'All students assigned to a group', state: 'violated', hint: '3 students unassigned.' },
          { id: 'sizes', label: 'All groups have 1–10 students', state: 'ok' },
        ],
        firstViolation: '3 students unassigned.',
      },
    });
    await settle();
    const hint = target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement;
    expect(hint).toBeTruthy();
    hint.click();
    flushSync();
    expect(onNavigateTab).toHaveBeenCalledWith('roster', 'unassigned');
    unmount(cmp);
  });

  it('PATCHes groups_enabled when checkbox toggled', async () => {
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ groups_enabled: true });
      return jres({ id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: true });
    });
    const { target, cmp, setRun } = mountTab({});
    await settle();
    const cb = target.querySelector('input[name="groups_enabled"]') as HTMLInputElement;
    cb.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(setRun).toHaveBeenCalled();
    unmount(cmp);
  });

  it('disables groups_enabled checkbox with tooltip when published', async () => {
    const { target, cmp } = mountTab({
      run: { id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', is_published: true, groups_enabled: false },
    });
    await settle();
    const cb = target.querySelector('input[name="groups_enabled"]') as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    const label = cb.closest('label')!;
    expect(label.getAttribute('title')).toContain('Locked once');
    unmount(cmp);
  });

  it('hides Delete-run when published, shows InlineConfirm flow when draft', async () => {
    const { target, cmp, onDeleteRun } = mountTab({});
    await settle();
    const del = target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    del.click();
    flushSync();
    expect(target.textContent).toContain('Confirm Delete');
    (target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement).click();
    expect(onDeleteRun).toHaveBeenCalled();
    unmount(cmp);

    const pub = mountTab({
      run: { id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', is_published: true, groups_enabled: false },
    });
    await settle();
    expect(pub.target.querySelector('button[data-action="delete-run"]')).toBeNull();
    unmount(pub.cmp);
  });
});
```

- [ ] **Step 2: Run checklist test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunOverviewTab.checklist.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL — checklist, settings, danger zone not yet implemented.

- [ ] **Step 3: Extend `RunOverviewTab.svelte`**

Append to the existing imports:

```ts
import { updateRun } from '../../lib/runs';
import InlineConfirm from '../ui/InlineConfirm.svelte';
```

Add helper after `commitField`:

```ts
let groupsEnabledBusy = $state(false);
let confirmDeleteOpen = $state(false);

async function toggleGroupsEnabled(event: Event) {
  const next = (event.currentTarget as HTMLInputElement).checked;
  groupsEnabledBusy = true;
  try {
    const updated = await updateRun(run.id, { groups_enabled: next });
    setRun(updated);
  } catch (e) {
    (event.currentTarget as HTMLInputElement).checked = run.groups_enabled;
    if (e instanceof ApiError) pushToast(`Could not update setting: ${e.displayMessage}`, 'error');
  } finally {
    groupsEnabledBusy = false;
  }
}
```

Replace the `<!-- T10 appends: ... -->` comment with these three sections:

```svelte
  <section class="run-settings">
    <h3>Settings</h3>
    <label title={run.is_published ? 'Locked once the run is published. Unpublish to change.' : ''}>
      <input
        type="checkbox"
        name="groups_enabled"
        checked={run.groups_enabled}
        disabled={run.is_published || groupsEnabledBusy}
        onchange={toggleGroupsEnabled}
      />
      Groups enabled
      <small>Disabling groups hides group assignments but does not delete them.</small>
    </label>
  </section>

  <section class="readiness">
    <h3>Publish readiness</h3>
    <ul>
      {#each readiness.checks as row (row.id)}
        <li class="state-{row.state}">
          {#if row.state === 'ok'}✓{:else if row.state === 'violated'}✗{:else}—{/if}
          {row.label}
          {#if row.state === 'violated' && row.id === 'assigned' && row.hint}
            <button
              data-action="goto-unassigned"
              onclick={() => onNavigateTab('roster', 'unassigned')}
            >{row.hint}</button>
          {:else if row.hint}
            <span class="hint">{row.hint}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if !run.is_published}
    <section class="danger-zone">
      <h3>Danger zone</h3>
      {#if confirmDeleteOpen}
        <InlineConfirm
          confirmLabel="Confirm Delete"
          confirmDataAction="confirm-delete"
          onConfirm={onDeleteRun}
          onCancel={() => (confirmDeleteOpen = false)}
        />
      {:else}
        <button data-action="delete-run" onclick={() => (confirmDeleteOpen = true)}>Delete run</button>
      {/if}
    </section>
  {/if}
```

Wire `onDeleteRun` in `RunDetailPage.svelte`:

```ts
async function onDeleteRun() {
  if (runIdInt === null || !run) return;
  try {
    await deleteRun(runIdInt);
    navigate(`/courses/${params.courseSlug}/runs`);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409 && /students/i.test(e.detail ?? '')) {
        pushToast('Clear roster before deleting.', 'error');
      } else if (e.status === 409 && /submission/i.test(e.detail ?? '')) {
        pushToast(e.displayMessage, 'error');
      } else {
        pushToast(e.displayMessage, 'error');
      }
    }
  }
}
```

Add imports: `import { deleteRun } from '../../lib/runs';` and `import { navigate } from '../../lib/router.svelte';`.

Replace the placeholder `onDeleteRun={async () => { /* T10 wires deleteRun + navigate */ }}` with `{onDeleteRun}`.

- [ ] **Step 4: Verify checklist tests pass**

```bash
cd frontend && npx vitest run src/tests/RunOverviewTab.checklist.svelte.test.ts 2>&1 | tail -10
```

Expected: 5/5 PASS.

- [ ] **Step 5: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunOverviewTab.svelte \
        frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts \
        frontend/src/pages/runs/RunDetailPage.svelte
git commit -m "feat(frontend): RunOverviewTab checklist + settings + danger zone"
```

---

### Task 11a: `RunTeachersTab`

**Files:**
- Create: `frontend/src/components/runs/RunTeachersTab.svelte`
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte` (mount + add `refetchTeachers`)
- Test: `frontend/src/tests/RunTeachersTab.svelte.test.ts`

**Context:** Top form (`email`, max 254, autofocus) → `POST /api/runs/{runId}/teachers`. Session-scoped `justInvited = new SvelteSet<userId>()` populated only by add-actions in this mount; cleared by unmount. Remove via `InlineConfirm` (with `confirmDataAction="confirm-remove"`). 409 → inline error "Teacher already assigned to this run." Empty state: "No teachers assigned yet. Add one above."

- [ ] **Step 1: Write Teachers tab tests**

Create `frontend/src/tests/RunTeachersTab.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunTeachersTab from '../components/runs/RunTeachersTab.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

function mountTab(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [], onRefetch: vi.fn().mockResolvedValue(undefined), ...props } });
  return { target, cmp };
}

describe('RunTeachersTab', () => {
  it('renders empty state', async () => {
    const { target, cmp } = mountTab({});
    await settle();
    expect(target.textContent).toContain('No teachers assigned');
    unmount(cmp);
  });

  it('adds teacher, prepends row, shows (invited) when user_full_name === null', async () => {
    fetchSpy.mockImplementation(() => jres({ user_id: 7, user_email: 'new@x.com', user_full_name: null }));
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ onRefetch: refetch });
    await settle();
    (target.querySelector('input[name="email"]') as HTMLInputElement).value = 'new@x.com';
    target.querySelector('input[name="email"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(target.textContent).toContain('(invited)');
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('renders inline error on 409', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Teacher already assigned' }, 409));
    const { target, cmp } = mountTab({});
    await settle();
    (target.querySelector('input[name="email"]') as HTMLInputElement).value = 't@x.com';
    target.querySelector('input[name="email"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(target.textContent).toContain('Teacher already assigned');
    unmount(cmp);
  });

  it('removes teacher with inline confirm', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({
      teachers: [{ user_id: 1, user_email: 't@x.com', user_full_name: 'T One' }],
      onRefetch: refetch,
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
```

- [ ] **Step 2: Run Teachers tab test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunTeachersTab.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../components/runs/RunTeachersTab.svelte'`.

- [ ] **Step 3: Implement `components/runs/RunTeachersTab.svelte`**

```svelte
<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import { addRunTeacher, removeRunTeacher } from '../../lib/runTeachers';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { RunTeacherResponse } from '../../lib/types';

  let { runId, teachers, onRefetch }: {
    runId: number;
    teachers: RunTeacherResponse[];
    onRefetch: () => Promise<void>;
  } = $props();

  let email = $state('');
  let addError: string | null = $state(null);
  let busy = $state(false);
  const justInvited = new SvelteSet<number>();
  let pendingRemove: number | null = $state(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    busy = true;
    try {
      const t = await addRunTeacher(runId, email.trim());
      if (t.user_full_name === null) justInvited.add(t.user_id);
      email = '';
      await onRefetch();
    } catch (e) {
      if (e instanceof ApiError) {
        addError = e.status === 409 ? 'Teacher already assigned to this run.' : e.displayMessage;
      }
    } finally {
      busy = false;
    }
  }

  async function confirmRemove(userId: number) {
    try {
      await removeRunTeacher(runId, userId);
      pendingRemove = null;
      await onRefetch();
    } catch (e) {
      pendingRemove = null;
    }
  }
</script>

<section class="teachers-tab">
  <form onsubmit={submit}>
    <input name="email" type="email" maxlength="254" autofocus placeholder="teacher@example.com" bind:value={email} />
    <button type="submit" disabled={busy || !email.trim()}>Add teacher</button>
  </form>
  {#if addError}<p class="error">{addError}</p>{/if}

  {#if teachers.length === 0}
    <p class="empty">No teachers assigned yet. Add one above.</p>
  {:else}
    <ul>
      {#each teachers as t (t.user_id)}
        <li>
          {t.user_full_name || '—'} ({t.user_email})
          {#if justInvited.has(t.user_id)}<span class="badge">(invited)</span>{/if}
          {#if pendingRemove === t.user_id}
            <InlineConfirm
              confirmLabel="Confirm Remove"
              confirmDataAction="confirm-remove"
              onConfirm={() => confirmRemove(t.user_id)}
              onCancel={() => (pendingRemove = null)}
            />
          {:else}
            <button data-action="remove" onclick={() => (pendingRemove = t.user_id)}>Remove</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
```

- [ ] **Step 4: Wire `RunTeachersTab` into `RunDetailPage.svelte`**

Add imports:

```ts
import RunTeachersTab from '../../components/runs/RunTeachersTab.svelte';
import { listRunTeachers } from '../../lib/runTeachers';
```

Add refetch helper:

```ts
async function refetchTeachers() {
  if (runIdInt === null) return;
  teachers = await listRunTeachers(runIdInt);
}
```

Replace the Teachers placeholder block in the template:

```svelte
{:else if activeTab === 'teachers'}
  <RunTeachersTab runId={runIdInt!} {teachers} onRefetch={refetchTeachers} />
```

- [ ] **Step 5: Verify Teachers tab tests pass**

```bash
cd frontend && npx vitest run src/tests/RunTeachersTab.svelte.test.ts 2>&1 | tail -10
```

Expected: 4/4 PASS.

- [ ] **Step 6: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunTeachersTab.svelte \
        frontend/src/tests/RunTeachersTab.svelte.test.ts \
        frontend/src/pages/runs/RunDetailPage.svelte
git commit -m "feat(frontend): RunTeachersTab with invited-badge + refetch"
```

---

### Task 11b: `RunGroupsTab`

**Files:**
- Create: `frontend/src/components/runs/RunGroupsTab.svelte`
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte` (mount + add `refetchGroups`/`refetchGroupsAndStudents`)
- Test: `frontend/src/tests/RunGroupsTab.svelte.test.ts`

**Context:** When `!groups_enabled`: placeholder card. When enabled: top form (`name`, max 80) → `POST /api/runs/{runId}/groups`. List ordered by `name ASC`. Inline-rename via `makeDirtyTracker`. Capacity badge from `getCapacityClass(student_count)`. Delete via `InlineConfirm` (with `confirmDataAction="confirm-delete-group"`), disabled when `student_count > 0`. Two 409 branches: "has students" → toast + refetch students AND groups; "has submissions" → toast + refetch groups only.

- [ ] **Step 1: Write Groups tab tests**

Create `frontend/src/tests/RunGroupsTab.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunGroupsTab from '../components/runs/RunGroupsTab.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

function mountTab(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunGroupsTab, { target, props: {
    runId: 10, groups: [], groupsEnabled: true,
    onRefetchGroups: vi.fn().mockResolvedValue(undefined),
    onRefetchGroupsAndStudents: vi.fn().mockResolvedValue(undefined),
    ...props,
  } });
  return { target, cmp };
}

describe('RunGroupsTab', () => {
  it('renders disabled placeholder when groupsEnabled=false', async () => {
    const { target, cmp } = mountTab({ groupsEnabled: false });
    await settle();
    expect(target.textContent).toContain('Groups are disabled');
    unmount(cmp);
  });

  it('adds a group via POST', async () => {
    fetchSpy.mockImplementation(() => jres({ id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }));
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ onRefetchGroups: refetch });
    await settle();
    (target.querySelector('input[name="name"]') as HTMLInputElement).value = 'Alpha';
    target.querySelector('input[name="name"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('disables Delete on group with students; allows on empty', async () => {
    const { target, cmp } = mountTab({
      groups: [
        { id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false },
        { id: 2, run_id: 10, name: 'Beta', student_count: 3, is_disabled: false },
      ],
    });
    await settle();
    const buttons = target.querySelectorAll('button[data-action="delete-group"]') as NodeListOf<HTMLButtonElement>;
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    unmount(cmp);
  });

  it('409 with "has students" triggers groups+students refetch', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Group has students; reassign or remove first' }, 409));
    const refetchBoth = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({
      groups: [{ id: 1, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      onRefetchGroupsAndStudents: refetchBoth,
    });
    await settle();
    (target.querySelector('button[data-action="delete-group"]') as HTMLButtonElement).click();
    flushSync();
    (target.querySelector('button[data-action="confirm-delete-group"]') as HTMLButtonElement).click();
    await settle();
    expect(refetchBoth).toHaveBeenCalled();
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run Groups tab test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunGroupsTab.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../components/runs/RunGroupsTab.svelte'`.

- [ ] **Step 3: Implement `components/runs/RunGroupsTab.svelte`**

```svelte
<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { createGroup, deleteGroup, getCapacityClass, updateGroup } from '../../lib/runGroups';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import type { DirtyTracker } from '../../lib/dirty.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { GroupResponse } from '../../lib/types';

  let {
    runId, groups, groupsEnabled,
    onRefetchGroups, onRefetchGroupsAndStudents,
  }: {
    runId: number;
    groups: GroupResponse[];
    groupsEnabled: boolean;
    onRefetchGroups: () => Promise<void>;
    onRefetchGroupsAndStudents: () => Promise<void>;
  } = $props();

  let newName = $state('');
  let addError: string | null = $state(null);
  let pendingDelete: number | null = $state(null);

  const sorted = $derived([...groups].sort((a, b) => a.name.localeCompare(b.name)));
  const renameTrackers = new Map<number, DirtyTracker<{ name: string }>>();

  function trackerFor(group: GroupResponse): DirtyTracker<{ name: string }> {
    let t = renameTrackers.get(group.id);
    if (!t) {
      t = makeDirtyTracker<{ name: string }>({ name: group.name });
      renameTrackers.set(group.id, t);
    }
    return t;
  }

  async function addGroup(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    try {
      await createGroup(runId, newName.trim());
      newName = '';
      await onRefetchGroups();
    } catch (e) {
      if (e instanceof ApiError) {
        addError = e.status === 409 ? 'A group with that name already exists in this run.' : e.displayMessage;
      }
    }
  }

  async function commitRename(group: GroupResponse) {
    const t = trackerFor(group);
    const next = t.current.name.trim();
    if (!next || next === group.name) {
      t.current.name = group.name;
      return;
    }
    try {
      await updateGroup(group.id, { name: next });
      await onRefetchGroups();
    } catch (e) {
      t.current.name = group.name;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }

  async function confirmDelete(groupId: number) {
    try {
      await deleteGroup(groupId);
      pendingDelete = null;
      await onRefetchGroups();
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) {
        if (e.status === 409 && /students/i.test(e.detail ?? '')) {
          pushToast(e.displayMessage, 'error');
          await onRefetchGroupsAndStudents();
        } else if (e.status === 409 && /submission/i.test(e.detail ?? '')) {
          pushToast(e.displayMessage, 'error');
          await onRefetchGroups();
        } else {
          pushToast(e.displayMessage, 'error');
        }
      }
    }
  }
</script>

{#if !groupsEnabled}
  <section class="groups-disabled-placeholder">
    Groups are disabled for this run. Enable in Overview → Settings to manage groups.
  </section>
{:else}
  <section class="groups-tab">
    <form onsubmit={addGroup}>
      <input name="name" maxlength="80" bind:value={newName} placeholder="Group name" />
      <button type="submit" disabled={!newName.trim()}>Add group</button>
    </form>
    {#if addError}<p class="error">{addError}</p>{/if}

    {#if sorted.length === 0}
      <p class="empty">No groups yet.</p>
    {:else}
      <ul>
        {#each sorted as g (g.id)}
          {@const t = trackerFor(g)}
          <li>
            <input
              name="rename-{g.id}"
              bind:value={t.current.name}
              onblur={() => commitRename(g)}
              onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') { t.current.name = g.name; (e.currentTarget as HTMLInputElement).blur(); } }}
            />
            <span class="badge badge-{getCapacityClass(g.student_count)}">
              {g.student_count === 0 ? 'empty' : `${g.student_count}/10`}
            </span>
            {#if pendingDelete === g.id}
              <InlineConfirm
                confirmLabel="Confirm Delete"
                confirmDataAction="confirm-delete-group"
                onConfirm={() => confirmDelete(g.id)}
                onCancel={() => (pendingDelete = null)}
              />
            {:else}
              <button
                data-action="delete-group"
                disabled={g.student_count > 0}
                title={g.student_count > 0 ? 'Move students out before deleting.' : ''}
                onclick={() => (pendingDelete = g.id)}
              >Delete</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
```

- [ ] **Step 4: Wire `RunGroupsTab` into `RunDetailPage.svelte`**

Add imports:

```ts
import RunGroupsTab from '../../components/runs/RunGroupsTab.svelte';
import { listGroups } from '../../lib/runGroups';
import { listRunStudents } from '../../lib/runRoster';
```

Add refetch helpers (these are also needed by T12+ but introduced here):

```ts
async function refetchGroups() {
  if (runIdInt === null) return;
  groups = await listGroups(runIdInt);
}

async function refetchGroupsAndStudents() {
  if (runIdInt === null) return;
  const [gs, ss] = await Promise.all([listGroups(runIdInt), listRunStudents(runIdInt)]);
  groups = gs; students = ss;
}
```

Replace the Groups placeholder block in the template:

```svelte
{:else if activeTab === 'groups'}
  <RunGroupsTab
    runId={runIdInt!}
    {groups}
    groupsEnabled={run.groups_enabled}
    onRefetchGroups={refetchGroups}
    onRefetchGroupsAndStudents={refetchGroupsAndStudents}
  />
```

- [ ] **Step 5: Verify Groups tab tests pass**

```bash
cd frontend && npx vitest run src/tests/RunGroupsTab.svelte.test.ts 2>&1 | tail -10
```

Expected: 4/4 PASS.

- [ ] **Step 6: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunGroupsTab.svelte \
        frontend/src/tests/RunGroupsTab.svelte.test.ts \
        frontend/src/pages/runs/RunDetailPage.svelte
git commit -m "feat(frontend): RunGroupsTab with inline rename + capacity badges"
```

---

### Task 12: `RunRosterTab` core (table, search, prefilter, tri-state header, add-row, single delete)

**Files:**
- Create: `frontend/src/components/runs/RunRosterTab.svelte`
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte` (mount + pass props)
- Test: `frontend/src/tests/RunRosterTab.svelte.test.ts`

**Context:** Core table without optimistic inline group editing (T13) or bulk ops (T14/T15). Renders sticky-header table; filters via search input + `rosterPrefilter`. Tri-state header checkbox derived from filtered-visible rows (indeterminate is derived-only, never user-settable). Persistent add-student row always mounted (stays in DOM across filter changes). Client-side duplicate pre-check via lowercased email comparison. Single-row delete via `InlineConfirm`. The rendered `<select>` value uses `selectValueFor(U)` helper with `.has()` guard — overlay still mostly inert in this task but the helper is in place for T13.

- [ ] **Step 1: Write roster core tests**

Create `frontend/src/tests/RunRosterTab.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

const fakeStudent = (over: Partial<RunStudentResponse> = {}): RunStudentResponse => ({
  user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice', group_id: null, ...over,
} as RunStudentResponse);

function mountTab(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunRosterTab, { target, props: {
    runId: 10,
    students: [],
    groups: [],
    groupsEnabled: false,
    rosterPrefilter: null,
    onPrefilterClear: vi.fn(),
    onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
    onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
    onOpenImport: vi.fn(),
    ...props,
  } });
  return { target, cmp };
}

describe('RunRosterTab core', () => {
  it('renders empty state with CTA when no students', async () => {
    const { target, cmp } = mountTab({});
    await settle();
    expect(target.textContent).toContain('No students yet');
    unmount(cmp);
  });

  it('client-side dup check blocks POST and shows inline error', async () => {
    const { target, cmp } = mountTab({
      students: [fakeStudent({ user_id: 1, user_email: 'a@x.com' })],
    });
    await settle();
    const emailInput = target.querySelector('input[name="new-email"]') as HTMLInputElement;
    emailInput.value = 'A@X.COM';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('button[data-action="add-student"]') as HTMLButtonElement).click();
    flushSync();
    expect(target.textContent).toContain('already enrolled');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('search narrows filtered rows', async () => {
    const { target, cmp } = mountTab({
      students: [
        fakeStudent({ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice' }),
        fakeStudent({ user_id: 2, user_email: 'b@y.com', user_full_name: 'Bob' }),
      ],
    });
    await settle();
    const search = target.querySelector('input[name="roster-search"]') as HTMLInputElement;
    search.value = 'alice';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelectorAll('tbody tr[data-row="student"]').length).toBe(1);
    expect(target.textContent).toContain('Alice');
    expect(target.textContent).not.toContain('Bob');
    unmount(cmp);
  });

  it('prefilter unassigned shows only unassigned rows, clears via typing OR ×', async () => {
    const onPrefilterClear = vi.fn();
    const { target, cmp } = mountTab({
      rosterPrefilter: 'unassigned',
      onPrefilterClear,
      students: [
        fakeStudent({ user_id: 1, group_id: null, user_full_name: 'Alice' }),
        fakeStudent({ user_id: 2, group_id: 99, user_full_name: 'Bob' }),
      ],
    });
    await settle();
    expect(target.querySelectorAll('tbody tr[data-row="student"]').length).toBe(1);
    (target.querySelector('button[data-action="clear-prefilter"]') as HTMLButtonElement).click();
    flushSync();
    expect(onPrefilterClear).toHaveBeenCalled();
    unmount(cmp);
  });

  it('header checkbox indeterminate when partial selection visible', async () => {
    const { target, cmp } = mountTab({
      students: [
        fakeStudent({ user_id: 1 }),
        fakeStudent({ user_id: 2 }),
      ],
    });
    await settle();
    const rowCheckboxes = target.querySelectorAll('input[data-row-checkbox]') as NodeListOf<HTMLInputElement>;
    rowCheckboxes[0].click();
    flushSync();
    const header = target.querySelector('input[data-header-checkbox]') as HTMLInputElement;
    expect(header.indeterminate).toBe(true);
    rowCheckboxes[1].click();
    flushSync();
    expect(header.indeterminate).toBe(false);
    expect(header.checked).toBe(true);
    unmount(cmp);
  });

  it('single-row delete via InlineConfirm calls refetch', async () => {
    fetchSpy.mockImplementation(() => jres('', 204));
    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    const { target, cmp } = mountTab({
      students: [fakeStudent({ user_id: 1 })],
      onRefetchRosterData: refetch,
    });
    await settle();
    (target.querySelector('button[data-action="delete-student"]') as HTMLButtonElement).click();
    flushSync();
    (target.querySelector('button[data-action="confirm-delete-student"]') as HTMLButtonElement).click();
    await settle();
    expect(refetch).toHaveBeenCalled();
    unmount(cmp);
  });

  it('persistent add-student row stays in DOM across filter changes', async () => {
    const { target, cmp } = mountTab({
      students: [
        fakeStudent({ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice', group_id: null }),
        fakeStudent({ user_id: 2, user_email: 'b@x.com', user_full_name: 'Bob', group_id: 99 }),
      ],
      rosterPrefilter: 'unassigned',
    });
    await settle();
    // Prefilter active: only Alice visible. Add row must still exist.
    expect(target.querySelector('input[name="new-email"]')).not.toBeNull();
    // Type a search that filters out everyone.
    const search = target.querySelector('input[name="roster-search"]') as HTMLInputElement;
    search.value = 'zzz-no-match';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('input[name="new-email"]')).not.toBeNull();
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run roster test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../components/runs/RunRosterTab.svelte'`.

- [ ] **Step 3: Implement `components/runs/RunRosterTab.svelte`**

```svelte
<script lang="ts">
  import { SvelteSet, SvelteMap } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import { addRunStudent, removeRunStudent } from '../../lib/runRoster';
  import { pushToast } from '../../stores/toasts.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { GroupResponse, RunStudentResponse } from '../../lib/types';

  let {
    runId, students, groups, groupsEnabled,
    rosterPrefilter, onPrefilterClear,
    onRefetchRosterData, onRefetchGroupsOnly, onOpenImport,
  }: {
    runId: number;
    students: RunStudentResponse[];
    groups: GroupResponse[];
    groupsEnabled: boolean;
    rosterPrefilter: 'unassigned' | null;
    onPrefilterClear: () => void;
    onRefetchRosterData: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onRefetchGroupsOnly: () => Promise<void>;
    onOpenImport: () => void;
  } = $props();

  let search = $state('');
  let newEmail = $state('');
  let newGroupId = $state<number | '__unassigned'>('__unassigned');
  let addError: string | null = $state(null);
  let pendingDelete = $state<number | null>(null);

  const pendingGroupId = new SvelteMap<number, number | null>();
  const selected = new SvelteSet<number>();

  function selectValueFor(s: RunStudentResponse): number | '__unassigned' {
    const effective = pendingGroupId.has(s.user_id) ? pendingGroupId.get(s.user_id)! : s.group_id;
    return effective === null ? '__unassigned' : effective;
  }

  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (rosterPrefilter === 'unassigned' && s.group_id !== null) return false;
      if (!q) return true;
      const email = s.user_email.toLowerCase();
      const name = (s.user_full_name ?? '').toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  });

  const visibleIds = $derived(new Set(visible.map((s) => s.user_id)));
  const selectedVisibleCount = $derived(visible.filter((s) => selected.has(s.user_id)).length);
  const headerChecked = $derived(visible.length > 0 && selectedVisibleCount === visible.length);
  const headerIndeterminate = $derived(selectedVisibleCount > 0 && selectedVisibleCount < visible.length);

  function onHeaderClick(event: Event) {
    event.preventDefault();
    if (headerChecked) {
      for (const s of visible) selected.delete(s.user_id);
    } else {
      for (const s of visible) selected.add(s.user_id);
    }
  }

  function onSearchInput(event: Event) {
    search = (event.currentTarget as HTMLInputElement).value;
    if (search && rosterPrefilter !== null) onPrefilterClear();
  }

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const dup = students.some((s) => s.user_email.toLowerCase() === email);
    if (dup) {
      addError = `${newEmail} is already enrolled. Edit their group in the table.`;
      return;
    }
    try {
      const groupId: number | null = newGroupId === '__unassigned' ? null : newGroupId;
      await addRunStudent(runId, newEmail.trim(), groupId);
      newEmail = '';
      newGroupId = '__unassigned';
      await onRefetchRosterData();
    } catch (e) {
      if (e instanceof ApiError) addError = e.displayMessage;
    }
  }

  async function confirmDelete(userId: number) {
    try {
      await removeRunStudent(runId, userId);
      pendingDelete = null;
      await onRefetchRosterData();
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }
</script>

<section class="roster-tab">
  <header class="roster-toolbar">
    <input
      name="roster-search"
      placeholder="Search by name or email…"
      value={search}
      oninput={onSearchInput}
    />
    {#if rosterPrefilter === 'unassigned'}
      {@const n = students.filter((s) => s.group_id === null).length}
      <span class="prefilter-pill">
        Showing: Unassigned ({n})
        <button data-action="clear-prefilter" aria-label="Clear filter" onclick={onPrefilterClear}>×</button>
      </span>
    {/if}
    <button data-action="open-import" onclick={onOpenImport}>Import roster</button>
  </header>

  {#if students.length === 0}
    <p class="empty">
      No students yet. Add one below or
      <button data-action="open-import-link" onclick={onOpenImport}>Import roster from CSV</button>.
    </p>
  {/if}

  <table>
    <thead>
      <tr>
        <th>
          <input
            type="checkbox"
            data-header-checkbox
            checked={headerChecked}
            onclick={onHeaderClick}
            bind:indeterminate={() => headerIndeterminate, () => {}}
          />
        </th>
        <th>Email</th>
        <th>Full name</th>
        <th>Group</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each visible as s (s.user_id)}
        <tr data-row="student">
          <td>
            <input
              type="checkbox"
              data-row-checkbox
              checked={selected.has(s.user_id)}
              onchange={(e) => {
                if ((e.currentTarget as HTMLInputElement).checked) selected.add(s.user_id);
                else selected.delete(s.user_id);
              }}
            />
          </td>
          <td>{s.user_email}</td>
          <td>{s.user_full_name || '—'}</td>
          <td>
            {#if groupsEnabled}
              <select value={selectValueFor(s)} disabled>
                <option value="__unassigned">Unassigned</option>
                {#each groups as g (g.id)}
                  <option value={g.id}>{g.name} ({g.student_count}/10){g.is_disabled ? ' (disabled)' : ''}</option>
                {/each}
              </select>
            {:else}
              —
            {/if}
          </td>
          <td>
            {#if pendingDelete === s.user_id}
              <InlineConfirm
                confirmLabel="Confirm Delete"
                confirmDataAction="confirm-delete-student"
                onConfirm={() => confirmDelete(s.user_id)}
                onCancel={() => (pendingDelete = null)}
              />
            {:else}
              <button data-action="delete-student" onclick={() => (pendingDelete = s.user_id)}>Delete</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if visible.length === 0 && students.length > 0}
    <p class="empty">
      {#if rosterPrefilter === 'unassigned'}
        No students are unassigned.
        <button data-action="clear-prefilter-link" onclick={onPrefilterClear}>Clear filter</button>.
      {:else}
        No students match '{search}'.
        <button data-action="clear-search-link" onclick={() => (search = '')}>Clear search</button>.
      {/if}
    </p>
  {/if}

  <form class="add-row" onsubmit={submitAdd}>
    <input name="new-email" type="email" maxlength="254" bind:value={newEmail} placeholder="student@example.com" />
    {#if groupsEnabled}
      <select bind:value={newGroupId}>
        <option value="__unassigned">Unassigned</option>
        {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
          <option value={g.id}>{g.name} ({g.student_count}/10)</option>
        {/each}
      </select>
    {:else}
      —
    {/if}
    <button data-action="add-student" type="submit" disabled={!newEmail.trim()}>Add</button>
  </form>
  {#if addError}<p class="error">{addError}</p>{/if}
</section>
```

> The `bind:indeterminate={() => headerIndeterminate, () => {}}` pattern uses Svelte 5's getter-setter form for a one-way derived bind. If the project's Svelte 5 version does not yet support this form on the `indeterminate` attribute, set it via a small `$effect(() => { const el = ...; el.indeterminate = headerIndeterminate; })` that fires after each render. Verify in `RunRosterTab`'s implementation against the local Svelte version; the goal is "indeterminate is derived-only, never user-settable" (spec §4.4).

- [ ] **Step 4: Mount in `RunDetailPage.svelte`**

Add import: `import RunRosterTab from '../../components/runs/RunRosterTab.svelte';`.

Add state for `showImportModal`:

```ts
let showImportModal = $state(false);
```

Replace the roster placeholder block:

```svelte
{:else if activeTab === 'roster'}
  <RunRosterTab
    runId={runIdInt!}
    {students}
    {groups}
    groupsEnabled={run.groups_enabled}
    {rosterPrefilter}
    {onPrefilterClear}
    onRefetchRosterData={refetchRosterData}
    onRefetchGroupsOnly={refetchGroups}
    onOpenImport={() => (showImportModal = true)}
  />
  {#if showImportModal}
    {#await import('../../components/runs/RosterImportModal.svelte') then mod}
      {@const RosterImportModal = mod.default}
      <RosterImportModal
        runId={runIdInt!}
        existingRoster={students}
        existingGroups={groups}
        onRefetchBeforeSubmit={refetchRosterData}
        onClose={() => (showImportModal = false)}
      />
    {/await}
  {/if}
{/if}
```

> The dynamic `import('../../components/runs/RosterImportModal.svelte')` is the same pattern used in T5 — it lets T16 land the modal later without breaking T12's tests.

- [ ] **Step 5: Verify tests pass**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.svelte.test.ts 2>&1 | tail -10
```

Expected: 7/7 PASS.

- [ ] **Step 6: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunRosterTab.svelte \
        frontend/src/tests/RunRosterTab.svelte.test.ts \
        frontend/src/pages/runs/RunDetailPage.svelte
git commit -m "feat(frontend): RunRosterTab core (search, prefilter, tri-state, add, delete)"
```

---

### Task 13: `RunRosterTab` optimistic inline group edit + `prunePendingGroups`

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte`
- Test: `frontend/src/tests/RunRosterTab.optimistic.svelte.test.ts`

**Context:** Wires up the optimistic inline group change. On select change for `user_id=U` → `pendingGroupId.set(U, G)` immediately, disable the row's select, PATCH `/api/runs/{rid}/students/{U}` with `{group_id: G}`. On success: `pendingGroupId.delete(U)`, update `student.group_id` from response, refetch `groups` only (no `prunePendingGroups()` needed — own entry already removed). On failure: revert (`pendingGroupId.delete(U)`), toast.

`prunePendingGroups` is implemented as a `$effect` inside `RunRosterTab` that fires whenever the parent's `students` prop changes. This automatically covers all 5 refetch paths from spec §4.4 without requiring the parent to wrap its `students` setter. (Earlier drafts of this task proposed wrapping the parent setter; the `$effect` approach is simpler and keeps the prune logic co-located with the overlay it cleans.)

- [ ] **Step 1: Write optimistic-edit tests**

Create `frontend/src/tests/RunRosterTab.optimistic.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

function mountTab(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunRosterTab, { target, props: {
    runId: 10,
    students: [{ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice', group_id: null }],
    groups: [
      { id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false },
      { id: 100, run_id: 10, name: 'Beta', student_count: 5, is_disabled: false },
    ],
    groupsEnabled: true,
    rosterPrefilter: null,
    onPrefilterClear: vi.fn(),
    onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
    onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
    onOpenImport: vi.fn(),
    ...extra,
  } });
  return { target, cmp };
}

describe('RunRosterTab optimistic inline group edit', () => {
  it('PATCHes group change and disables select during in-flight', async () => {
    let resolvePatch: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolvePatch = r; }));
    const { target, cmp } = mountTab();
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.value = '99';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(sel.disabled).toBe(true);
    resolvePatch({
      ok: true, status: 200,
      json: () => Promise.resolve({ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice', group_id: 99 }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    expect(sel.disabled).toBe(false);
    unmount(cmp);
  });

  it('reverts on 409 capacity_reached with toast', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Target group is full (10 students).', error_code: 'capacity_reached' }, 409));
    const { target, cmp } = mountTab();
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.value = '100';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // Select value reverted (pendingGroupId.delete unlocks → back to student.group_id = null = '__unassigned')
    expect(sel.value).toBe('__unassigned');
    unmount(cmp);
  });

  it('optimistic unassign renders __unassigned (.has() guard, not ??)', async () => {
    let resolvePatch: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolvePatch = r; }));
    const { target, cmp } = mountTab({
      students: [{ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice', group_id: 99 }],
    });
    await settle();
    const sel = target.querySelector('tbody select') as HTMLSelectElement;
    sel.value = '__unassigned';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    // Optimistic: pendingGroupId.set(1, null) → rendered value should be '__unassigned' immediately
    expect(sel.value).toBe('__unassigned');
    resolvePatch({
      ok: true, status: 200,
      json: () => Promise.resolve({ user_id: 1, user_email: 'a@x.com', user_full_name: 'Alice', group_id: null }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.optimistic.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL — select change is not yet wired to a PATCH; select is disabled (`disabled` attr in T12).

- [ ] **Step 3: Extend `RunRosterTab.svelte`**

Add import: `import { updateRunStudent } from '../../lib/runRoster';`.

Remove `disabled` from the row select, bind to a per-row handler:

```svelte
<select
  value={selectValueFor(s)}
  disabled={pendingGroupId.has(s.user_id)}
  onchange={(e) => onGroupChange(s, (e.currentTarget as HTMLSelectElement).value)}
>
  <option value="__unassigned">Unassigned</option>
  {#each groups as g (g.id)}
    <option value={g.id}>{g.name} ({g.student_count}/10){g.is_disabled ? ' (disabled)' : ''}</option>
  {/each}
</select>
```

Add helper inside `<script>`:

Extend the `RunRosterTab` props with a new callback `onRefetchGroupsOnly: () => Promise<void>` (supplied by the parent — wires to `RunDetailPage.refetchGroups` from T11b). Per spec §4.4 line 567: inline group change success refetches `groups` only (for capacity badges), NOT `students`. The pending-group entry for this row is removed by `pendingGroupId.delete(U)` directly, so `prunePendingGroups()` is not needed here.

```ts
async function onGroupChange(s: RunStudentResponse, raw: string) {
  const target: number | null = raw === '__unassigned' ? null : Number(raw);
  pendingGroupId.set(s.user_id, target);
  try {
    const updated = await updateRunStudent(runId, s.user_id, target);
    // Mutate the local student row in place — parent's `students` slice is the source
    // of truth, but until a refetch path runs, this keeps the row in sync. Spec §4.4
    // explicitly says the inline-edit success branch does NOT refetch students; only
    // groups (for capacity badges).
    s.group_id = updated.group_id;
    pendingGroupId.delete(s.user_id);
    await onRefetchGroupsOnly();
  } catch (e) {
    pendingGroupId.delete(s.user_id);
    if (e instanceof ApiError) {
      const code = (e as ApiError & { detail?: string }).detail ?? '';
      if (e.status === 409 && /capacity/i.test(code)) {
        pushToast('Target group is full (10 students).', 'error');
      } else if (e.status === 409 && /disabled/i.test(code)) {
        pushToast(e.displayMessage, 'error');
      } else {
        pushToast(e.displayMessage, 'error');
      }
    }
  }
}
```

**Verify the props wiring already done in T12 is intact** (no new edits to the prop declaration block or to the parent mount site should be needed in T13):

- T12 Step 3 already declares `onRefetchGroupsOnly: () => Promise<void>` in `RunRosterTab.svelte`'s props block (alongside `onRefetchRosterData`).
- T12 Step 4 already passes `onRefetchGroupsOnly={refetchGroups}` from `RunDetailPage.svelte`'s `<RunRosterTab .../>` mount site (the `refetchGroups` helper itself was introduced in T11b).

T13 only adds the *consumer* code — the `await onRefetchGroupsOnly()` line inside the `onGroupChange` success branch (shown above). If the implementing agent finds either the prop declaration or the parent mount site missing, T12 was incomplete and should be patched first.

- [ ] **Step 4: Wrap `students` setter with `prunePendingGroups()` in `RunDetailPage.svelte`**

The parent owns `students` as `$state`. To run `prunePendingGroups()` after every refetch, the child holds the pruning logic; the parent simply assigns a new array. The cleanest contract: expose `prunePendingGroups` from the child by ref. Since Svelte 5 prefers callback-driven design, we keep the prune INSIDE `RunRosterTab` and trigger it via a `$effect` on `students`:

In `RunRosterTab.svelte`, add:

```ts
$effect(() => {
  // Run after every students reassignment from the parent.
  void students;
  const liveIds = new Set(students.map((s) => s.user_id));
  for (const uid of Array.from(pendingGroupId.keys())) {
    if (!liveIds.has(uid)) pendingGroupId.delete(uid);
  }
});
```

This satisfies the spec's 5 refetch paths: every parent setter (single-row delete, bulk-op completion, modal Done, group-delete 409 race, submit-time refetch) ends with `students = <new array>`, which fires this `$effect`.

- [ ] **Step 5: Verify tests pass**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.optimistic.svelte.test.ts 2>&1 | tail -10
```

Expected: 3/3 PASS.

- [ ] **Step 6: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunRosterTab.svelte \
        frontend/src/tests/RunRosterTab.optimistic.svelte.test.ts
git commit -m "feat(frontend): optimistic inline group edit + pendingGroupId prune"
```

---

### Task 14: `RunRosterTab` bulk-ops core (chunked dispatcher + selection action strip)

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte`
- Test: `frontend/src/tests/RunRosterTab.bulk-core.svelte.test.ts`

**Context:** Build the chunked dispatcher: `dispatchBulkOp(kind, userIds, groupId?)` chunks by ≤200, fires sequentially (chunk[i+1] starts only after chunk[i] resolves), collects three result sets (`succeededIds`, `chunkErrorRowIds`, `cancelledIds`). After execution: refetch students + groups (via `onRefetchRosterData()`), update `selected` (remove succeeded, keep errored/cancelled). Per-row error → red border on that row. Selection action strip visible only when `selected.size > 0`. The 207 per-row error → tooltip mapping per spec §4.4. Whole-call 400/409 treated like chunk-level failure. Bulk-delete confirmation uses `InlineConfirm` with dynamic `confirmLabel`.

The dispatcher exposes `bulkOpResult` state + `dispatchBulkOp` function reference; T15 consumes both for banner + retry.

- [ ] **Step 1: Write bulk-core tests (dispatcher contract + chunking + selection-strip + per-row red border)**

Create `frontend/src/tests/RunRosterTab.bulk-core.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  // @ts-expect-error
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

const studentN = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ user_id: i + 1, user_email: `s${i+1}@x.com`, user_full_name: `S${i+1}`, group_id: null }));

function mountTab(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunRosterTab, { target, props: {
    runId: 10,
    students: studentN(3),
    groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
    groupsEnabled: true,
    rosterPrefilter: null,
    onPrefilterClear: vi.fn(),
    onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
    onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
    onOpenImport: vi.fn(),
    ...extra,
  } });
  return { target, cmp };
}

describe('RunRosterTab bulk-op dispatcher', () => {
  it('hides action strip when selection is empty, shows when ≥1 selected', async () => {
    const { target, cmp } = mountTab();
    await settle();
    expect(target.querySelector('[data-strip="bulk"]')).toBeNull();
    (target.querySelectorAll('input[data-row-checkbox]')[0] as HTMLInputElement).click();
    flushSync();
    expect(target.querySelector('[data-strip="bulk"]')).not.toBeNull();
    expect(target.textContent).toContain('1 selected');
    unmount(cmp);
  });

  it('chunks bulk-move >200 sequentially (chunk[i+1] after chunk[i] resolves)', async () => {
    const callOrder: number[] = [];
    let resolvers: Array<(r: Response) => void> = [];
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      if (!url.includes('bulk-move')) return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } }, 200);
      const body = JSON.parse(init.body as string);
      const len = body.user_ids.length;
      callOrder.push(len);
      return new Promise<Response>((res) => {
        resolvers.push((r) => res(r));
      });
    });

    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    const { target, cmp } = mountTab({
      students: studentN(250),
      onRefetchRosterData: refetch,
    });
    await settle();
    // Select all
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    // Click Move-to-group → Alpha
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(callOrder).toEqual([200]); // first chunk only
    // Resolve chunk 1
    resolvers[0]({
      ok: true, status: 200,
      json: () => Promise.resolve({
        results: Array.from({ length: 200 }, (_, i) => ({ user_id: i + 1, status: 'ok' })),
        summary: { total: 200, ok: 200, error: 0 },
      }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    expect(callOrder).toEqual([200, 50]); // second chunk fired
    resolvers[1]({
      ok: true, status: 200,
      json: () => Promise.resolve({
        results: Array.from({ length: 50 }, (_, i) => ({ user_id: i + 201, status: 'ok' })),
        summary: { total: 50, ok: 50, error: 0 },
      }),
      headers: new Headers(),
    } as unknown as Response);
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('paints red border on per-row error and keeps row in selection', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('bulk-move')) {
        return jres({
          results: [
            { user_id: 1, status: 'ok' },
            { user_id: 2, status: 'error', error_code: 'capacity_reached', detail: 'full' },
            { user_id: 3, status: 'ok' },
          ],
          summary: { total: 3, ok: 2, error: 1 },
        }, 200);
      }
      return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } }, 200);
    });

    const { target, cmp } = mountTab({
      students: studentN(3),
      onRefetchRosterData: vi.fn().mockResolvedValue({
        students: studentN(3),
        groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 2, is_disabled: false }],
      }),
    });
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // User 2 should have red-border class
    const row2 = target.querySelector('tr[data-user-id="2"]');
    expect(row2?.classList.contains('row-error')).toBe(true);
    unmount(cmp);
  });

  it('renders all 5 per-row tooltip mappings on bulk-op errors (spec §4.4)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (!url.includes('bulk-move')) return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } });
      return jres({
        results: [
          { user_id: 1, status: 'error', error_code: 'not_in_run', detail: '...' },
          { user_id: 2, status: 'error', error_code: 'capacity_reached', detail: '...' },
          { user_id: 3, status: 'error', error_code: 'internal_error', detail: '...' },
          { user_id: 4, status: 'error', error_code: null, detail: 'Custom backend message' },
          { user_id: 5, status: 'error', error_code: null }, // detail also missing
        ],
        summary: { total: 5, ok: 0, error: 5 },
      });
    });

    const { target, cmp } = mountTab({
      students: studentN(5),
      onRefetchRosterData: vi.fn().mockResolvedValue({
        students: studentN(5),
        groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
      }),
    });
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    const tooltipOf = (uid: number) =>
      (target.querySelector(`tr[data-user-id="${uid}"]`) as HTMLElement | null)?.getAttribute('title');

    expect(tooltipOf(1)).toBe('Student is no longer enrolled in this run.');
    expect(tooltipOf(2)).toBe('Target group is full (10 students).');
    expect(tooltipOf(3)).toBe('Server error — please retry.');
    expect(tooltipOf(4)).toBe('Custom backend message');
    expect(tooltipOf(5)).toBe('Unknown error.');
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.bulk-core.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL — selection action strip not yet rendered.

- [ ] **Step 3: Extend `RunRosterTab.svelte` with the dispatcher + action strip**

Inside `<script>` add:

```ts
import { bulkMoveRunStudents, bulkDeleteRunStudents } from '../../lib/runRoster';

export type BulkOpKind = 'move' | 'delete';
type BulkOpResult = {
  kind: 'idle' | 'in-flight' | 'success' | 'partial' | 'cancelled';
  succeededIds: number[];
  chunkErrorRowIds: number[];
  cancelledIds: number[];
  lastOp: BulkOpKind;
  // Records the move target for the last op. Reserved by the spec's §10 T14
  // contract for future "Repeat move" / "Retry to same group" UX; not consumed
  // by T15's current banner code (T15 retries on a different group, since the
  // chunk-level cancellation usually implies the original target was bad).
  lastTargetGroupId?: number | null;
  error?: ApiError;
};

let bulkOpResult = $state<BulkOpResult>({
  kind: 'idle', succeededIds: [], chunkErrorRowIds: [], cancelledIds: [], lastOp: 'move',
});

let rowErrorBorders = $state(new SvelteSet<number>());
let rowErrorMeta = $state(new SvelteMap<number, { error_code: string | null | undefined; detail: string | undefined }>());
let bulkDeleteConfirm = $state(false);

function bulkErrorTooltip(meta: { error_code: string | null | undefined; detail: string | undefined } | undefined): string {
  if (!meta) return '';
  const code = meta.error_code;
  if (code === 'not_in_run') return 'Student is no longer enrolled in this run.';
  if (code === 'capacity_reached') return 'Target group is full (10 students).';
  if (code === 'internal_error') return 'Server error — please retry.';
  if (code === null || code === undefined) return meta.detail ? meta.detail : 'Unknown error.';
  return meta.detail ?? 'Unknown error.';
}

async function dispatchBulkOp(kind: BulkOpKind, userIds: number[], groupId: number | null = null) {
  // Step 1: clear borders for this op.
  rowErrorBorders = new SvelteSet<number>();
  rowErrorMeta = new SvelteMap<number, { error_code: string | null | undefined; detail: string | undefined }>();
  bulkOpResult = {
    kind: 'in-flight', succeededIds: [], chunkErrorRowIds: [], cancelledIds: [],
    lastOp: kind, lastTargetGroupId: groupId,
  };

  const chunks: number[][] = [];
  for (let i = 0; i < userIds.length; i += 200) chunks.push(userIds.slice(i, i + 200));

  const succeededIds: number[] = [];
  const chunkErrorRowIds: number[] = [];
  let cancelledIds: number[] = [];
  let chunkLevelError: ApiError | undefined = undefined;

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    try {
      const response = kind === 'move'
        ? await bulkMoveRunStudents(runId, chunk, groupId!)
        : await bulkDeleteRunStudents(runId, chunk);
      for (const row of response.results) {
        if (row.status === 'ok') succeededIds.push(row.user_id);
        else {
          chunkErrorRowIds.push(row.user_id);
          rowErrorMeta.set(row.user_id, { error_code: row.error_code, detail: row.detail });
        }
      }
    } catch (e) {
      // Whole-chunk failure (network or non-207 like 400/409).
      const remainingFromThisChunk = chunk;
      const remainingFromLaterChunks = chunks.slice(ci + 1).flat();
      cancelledIds = [...remainingFromThisChunk, ...remainingFromLaterChunks];
      chunkLevelError = e instanceof ApiError ? e : new ApiError(500, 'Network error');
      break;
    }
  }

  // Refetch + selection mutate.
  await onRefetchRosterData();
  for (const id of succeededIds) selected.delete(id);
  for (const id of chunkErrorRowIds) {
    selected.add(id);
    rowErrorBorders.add(id);
  }
  for (const id of cancelledIds) selected.add(id);

  // Build final result kind.
  let finalKind: BulkOpResult['kind'];
  if (chunkLevelError) finalKind = 'cancelled';
  else if (chunkErrorRowIds.length > 0) finalKind = 'partial';
  else finalKind = 'success';

  bulkOpResult = {
    kind: finalKind,
    succeededIds, chunkErrorRowIds, cancelledIds,
    lastOp: kind, lastTargetGroupId: groupId,
    error: chunkLevelError,
  };
}

function bulkMoveSelected(event: Event) {
  const raw = (event.currentTarget as HTMLSelectElement).value;
  const target: number | null = raw === '__unassigned' ? null : Number(raw);
  dispatchBulkOp('move', Array.from(selected), target);
}

function bulkDeleteSelected() {
  dispatchBulkOp('delete', Array.from(selected));
  bulkDeleteConfirm = false;
}
```

Add the action strip above the `<table>` block:

```svelte
{#if selected.size > 0}
  <div data-strip="bulk" class="bulk-strip">
    <span>{selected.size} selected{visible.length < students.length ? ` (${visible.filter((s) => selected.has(s.user_id)).length} visible)` : ''}</span>
    {#if groupsEnabled}
      <select data-action="bulk-move-select" onchange={bulkMoveSelected} value="">
        <option value="" disabled>Move to group…</option>
        <option value="__unassigned">Unassign</option>
        {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
          <option value={g.id}>{g.name} ({g.student_count}/10)</option>
        {/each}
      </select>
    {/if}
    {#if bulkDeleteConfirm}
      <InlineConfirm
        confirmLabel={`Confirm Delete — ${selected.size} students will be removed.`}
        confirmDataAction="confirm-bulk-delete"
        onConfirm={bulkDeleteSelected}
        onCancel={() => (bulkDeleteConfirm = false)}
      />
    {:else}
      <button data-action="bulk-delete" onclick={() => (bulkDeleteConfirm = true)}>Delete selected</button>
    {/if}
    <button data-action="clear-selection" onclick={() => selected.clear()}>× clear</button>
  </div>
{/if}
```

On each `<tr data-row="student">`, add the row-error class, `data-user-id`, and `title` (tooltip) wired to `bulkErrorTooltip` from the per-row error metadata map. Replace the existing T12 `<tr data-row="student">` line with:

```svelte
<tr
  data-row="student"
  data-user-id={s.user_id}
  class:row-error={rowErrorBorders.has(s.user_id)}
  title={bulkErrorTooltip(rowErrorMeta.get(s.user_id))}
>
```

- [ ] **Step 4: Verify tests pass**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.bulk-core.svelte.test.ts 2>&1 | tail -10
```

Expected: 4/4 PASS.

- [ ] **Step 5: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunRosterTab.svelte \
        frontend/src/tests/RunRosterTab.bulk-core.svelte.test.ts
git commit -m "feat(frontend): bulk-op chunked dispatcher with selection action strip"
```

---

### Task 15: `RunRosterTab` bulk-op summary banner + retry

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte`
- Test: `frontend/src/tests/RunRosterTab.bulk-banner.svelte.test.ts`

**Context:** Consume `bulkOpResult` + `dispatchBulkOp` from T14. Render three banner shapes based on `bulkOpResult.kind`. Auto-dismiss only on full success (5s). Retry for partial (`chunkErrorRowIds`): inline `Retry N → group [▼]` for moves; `Retry N delete` for deletes. Retry for chunk-level cancellation: `Retry cancelled` re-enters the dispatcher with `cancelledIds ∪ chunkErrorRowIds`. Banner non-dismissible during in-flight retry.

- [ ] **Step 1: Write banner + retry tests**

Create `frontend/src/tests/RunRosterTab.bulk-banner.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy.mockReset();
  // @ts-expect-error
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

const studentN = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ user_id: i + 1, user_email: `s${i+1}@x.com`, user_full_name: `S${i+1}`, group_id: null }));

function mountTab(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunRosterTab, { target, props: {
    runId: 10,
    students: studentN(3),
    groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }],
    groupsEnabled: true,
    rosterPrefilter: null,
    onPrefilterClear: vi.fn(),
    onRefetchRosterData: vi.fn().mockResolvedValue({ students: studentN(3), groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 0, is_disabled: false }] }),
    onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
    onOpenImport: vi.fn(),
    ...extra,
  } });
  return { target, cmp };
}

describe('RunRosterTab bulk-op banner + retry', () => {
  it('full success: shows banner and auto-dismisses after 5s', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('bulk-move')) return jres({
        results: [
          { user_id: 1, status: 'ok' }, { user_id: 2, status: 'ok' }, { user_id: 3, status: 'ok' },
        ],
        summary: { total: 3, ok: 3, error: 0 },
      });
      return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } });
    });
    const { target, cmp } = mountTab();
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toContain('Moved 3 of 3');
    vi.advanceTimersByTime(5100);
    flushSync();
    expect(target.textContent).not.toContain('Moved 3 of 3');
    unmount(cmp);
  });

  it('per-row partial: Retry → group dropdown re-fires move on still-selected rows', async () => {
    let phase: 1 | 2 = 1;
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      if (!url.includes('bulk-move')) return jres({ results: [], summary: { total: 0, ok: 0, error: 0 } });
      if (phase === 1) {
        phase = 2;
        return jres({
          results: [
            { user_id: 1, status: 'ok' },
            { user_id: 2, status: 'error', error_code: 'capacity_reached', detail: 'full' },
            { user_id: 3, status: 'ok' },
          ],
          summary: { total: 3, ok: 2, error: 1 },
        });
      } else {
        const body = JSON.parse(init.body as string);
        expect(body.user_ids).toEqual([2]);
        return jres({ results: [{ user_id: 2, status: 'ok' }], summary: { total: 1, ok: 1, error: 0 } });
      }
    });
    const { target, cmp } = mountTab();
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.textContent).toMatch(/Moved 2 of 3.*1 failed/);
    (target.querySelector('[data-action="retry-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="retry-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    unmount(cmp);
  });

  it('chunk-level cancelled: shows banner with Retry-cancelled button', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Server error' }, 500));
    const { target, cmp } = mountTab();
    await settle();
    (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement).value = '99';
    (target.querySelector('[data-action="bulk-move-select"]') as HTMLSelectElement)
      .dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.querySelector('[data-action="retry-cancelled"]')).not.toBeNull();
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.bulk-banner.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL — no banner rendered yet.

- [ ] **Step 3: Add banner rendering inside `RunRosterTab.svelte`**

Inside `<script>`:

```ts
let bannerDismissed = $state(false);

$effect(() => {
  if (bulkOpResult.kind === 'success') {
    bannerDismissed = false;
    const t = setTimeout(() => (bannerDismissed = true), 5000);
    return () => clearTimeout(t);
  }
});

function summaryText(): string {
  const r = bulkOpResult;
  const total = r.succeededIds.length + r.chunkErrorRowIds.length + r.cancelledIds.length;
  const verb = r.lastOp === 'move' ? 'Moved' : 'Deleted';
  if (r.kind === 'success') return `${verb} ${r.succeededIds.length} of ${total} — 0 failed.`;
  if (r.kind === 'partial') return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed.`;
  if (r.kind === 'cancelled') {
    return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed, ${r.cancelledIds.length} cancelled (connection issue).`;
  }
  return '';
}

function retryMove(event: Event) {
  const raw = (event.currentTarget as HTMLSelectElement).value;
  const target: number | null = raw === '__unassigned' ? null : Number(raw);
  dispatchBulkOp('move', bulkOpResult.chunkErrorRowIds, target);
}

function retryDelete() {
  dispatchBulkOp('delete', bulkOpResult.chunkErrorRowIds);
}

function retryCancelledDelete() {
  // Only the chunk-level-cancelled bulk-DELETE branch uses this helper. The move
  // branch re-enters dispatchBulkOp directly from the template's retry <select>
  // (the user picks a different target group because the original target was bad).
  const ids = [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds];
  dispatchBulkOp('delete', ids);
}
```

Add the banner template above the action strip:

```svelte
{#if bulkOpResult.kind !== 'idle' && !(bulkOpResult.kind === 'success' && bannerDismissed)}
  <div class="bulk-banner bulk-banner-{bulkOpResult.kind}">
    <span>{summaryText()}</span>

    {#if bulkOpResult.kind === 'partial' && bulkOpResult.lastOp === 'move'}
      <select data-action="retry-move-select" onchange={retryMove} value="">
        <option value="" disabled>Retry {bulkOpResult.chunkErrorRowIds.length} → group…</option>
        <option value="__unassigned">Unassign</option>
        {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
          <option value={g.id}>{g.name} ({g.student_count}/10)</option>
        {/each}
      </select>
    {:else if bulkOpResult.kind === 'partial' && bulkOpResult.lastOp === 'delete'}
      <button data-action="retry-delete" onclick={retryDelete}>Retry {bulkOpResult.chunkErrorRowIds.length} delete</button>
    {:else if bulkOpResult.kind === 'cancelled'}
      {#if bulkOpResult.lastOp === 'move'}
        <select
          data-action="retry-cancelled"
          onchange={(e) => {
            const raw = (e.currentTarget as HTMLSelectElement).value;
            const target: number | null = raw === '__unassigned' ? null : Number(raw);
            dispatchBulkOp('move', [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds], target);
          }}
          value=""
        >
          <option value="" disabled>Retry cancelled → group…</option>
          <option value="__unassigned">Unassign</option>
          {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
            <option value={g.id}>{g.name} ({g.student_count}/10)</option>
          {/each}
        </select>
      {:else}
        <button data-action="retry-cancelled" onclick={retryCancelledDelete}>Retry cancelled</button>
      {/if}
    {/if}

    {#if bulkOpResult.kind !== 'in-flight'}
      <button data-action="dismiss-banner" onclick={() => (bulkOpResult = { ...bulkOpResult, kind: 'idle' })}>Dismiss</button>
    {/if}
  </div>
{/if}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd frontend && npx vitest run src/tests/RunRosterTab.bulk-banner.svelte.test.ts 2>&1 | tail -10
```

Expected: 3/3 PASS.

- [ ] **Step 5: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunRosterTab.svelte \
        frontend/src/tests/RunRosterTab.bulk-banner.svelte.test.ts
git commit -m "feat(frontend): bulk-op summary banner + retry controls"
```

---

### Task 16: `RosterImportModal` scaffold (Stage 1 paste + preview)

**Files:**
- Create: `frontend/src/components/runs/RosterImportModal.svelte`
- Test: `frontend/src/tests/RosterImportModal.scaffold.svelte.test.ts`

**Context:** Two-stage modal — this task implements Stage 1 only (paste + live preview + counts footer). Wraps `FocusTrap` from T3. Debounced live-parse (200ms with cancellation on rapid keystrokes). Preview table caps at ~10 visible rows (scrollable). Counts footer summarizes valid/invalid/duplicate counts + `Will auto-create groups: …` + `Already-enrolled emails …` with `, +N more` truncation. `Cancel` and `Import N valid rows` buttons (Import disabled when 0 valid). T17 wires the submit logic.

- [ ] **Step 1: Write Stage 1 tests**

Create `frontend/src/tests/RosterImportModal.scaffold.svelte.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RosterImportModal.scaffold.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../components/runs/RosterImportModal.svelte'`.

- [ ] **Step 3: Implement `components/runs/RosterImportModal.svelte` (Stage 1 only)**

```svelte
<script lang="ts">
  import FocusTrap from '../ui/FocusTrap.svelte';
  import { parseCsv } from '../../lib/csv';
  import type { CsvParseResult } from '../../lib/csv';
  import type { GroupResponse, RunStudentResponse } from '../../lib/types';

  let {
    runId, existingRoster, existingGroups,
    onRefetchBeforeSubmit, onClose,
  }: {
    runId: number;
    existingRoster: RunStudentResponse[];
    existingGroups: GroupResponse[];
    onRefetchBeforeSubmit: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onClose: () => void;
  } = $props();

  let text = $state('');
  let parsed = $state<CsvParseResult | null>(null);
  let parseTimer: ReturnType<typeof setTimeout> | null = null;

  function onTextInput(event: Event) {
    text = (event.currentTarget as HTMLTextAreaElement).value;
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      parsed = parseCsv(text, existingGroups.map((g) => g.name), existingRoster.map((r) => r.user_email));
    }, 200);
  }

  function truncatedAlreadyEnrolled(list: string[]): string {
    if (list.length <= 5) return list.join(', ');
    return `${list.slice(0, 5).join(', ')}, +${list.length - 5} more`;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }

  // Bind for T17 — exported as Svelte 5 props would be heavier; this scaffold keeps logic local.
  // T17 replaces the Import button's onclick with the real submit handler.
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <FocusTrap>
    <div class="modal modal-roster-import" role="dialog" aria-modal="true" aria-label="Import roster">
      <header>
        <h2>Import roster from CSV</h2>
        <button type="button" aria-label="Close" onclick={onClose}>×</button>
      </header>

      <p class="helper">
        Paste rows from Excel or Google Sheets. Columns: <code>name</code> (optional),
        <code>email</code> (required), <code>group</code> (optional — group is auto-created
        if it does not exist). Tab or comma separated.
      </p>

      <textarea rows="10" value={text} oninput={onTextInput} autofocus></textarea>

      {#if parsed && parsed.ok}
        <table class="preview">
          <thead>
            <tr><th>#</th><th>Name</th><th>Email</th><th>Group</th><th>Status</th></tr>
          </thead>
          <tbody>
            {#each parsed.rows.slice(0, 10) as row}
              <tr>
                <td>{row.rowIndex}</td>
                <td>{row.parsed.name ?? '—'}</td>
                <td>{row.parsed.email || '—'}</td>
                <td>{row.parsed.group ?? '—'}</td>
                <td>
                  {#if row.valid}✓{:else}✗ {row.errors.join('; ')}{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <footer class="counts">
          <p>
            {parsed.rows.length} rows — {parsed.validCount} valid,
            {parsed.invalidCount} will skip ({parsed.invalidCount - parsed.duplicateInPasteCount} invalid,
            {parsed.duplicateInPasteCount} duplicate-in-paste).
          </p>
          {#if parsed.willCreateGroups.length > 0}
            <p>Will auto-create groups: {parsed.willCreateGroups.join(', ')}</p>
          {/if}
          {#if parsed.alreadyEnrolledEmails.length > 0}
            <p>Already-enrolled emails will be re-bucketed: {truncatedAlreadyEnrolled(parsed.alreadyEnrolledEmails)}</p>
          {/if}
        </footer>
      {:else if parsed && !parsed.ok}
        <p class="error">{parsed.error}</p>
      {/if}

      <div class="modal-actions">
        <button type="button" data-action="cancel" onclick={onClose}>Cancel</button>
        <button
          type="button"
          data-action="import"
          disabled={!parsed || !parsed.ok || parsed.validCount === 0}
        >Import {parsed && parsed.ok ? parsed.validCount : 0} valid rows</button>
      </div>
    </div>
  </FocusTrap>
</div>
```

- [ ] **Step 4: Convert T12's dynamic import in `RunDetailPage.svelte` to a static import**

In `frontend/src/pages/runs/RunDetailPage.svelte`, replace the `{#await import('../../components/runs/RosterImportModal.svelte') then mod}{@const RosterImportModal = mod.default}<RosterImportModal ... />{/await}` block with:

```svelte
{#if showImportModal}
  <RosterImportModal
    runId={runIdInt!}
    existingRoster={students}
    existingGroups={groups}
    onRefetchBeforeSubmit={refetchRosterData}
    onClose={() => (showImportModal = false)}
  />
{/if}
```

Add the static import at the top of the `<script>` block:

```ts
import RosterImportModal from '../../components/runs/RosterImportModal.svelte';
```

- [ ] **Step 5: Verify Stage 1 tests pass**

```bash
cd frontend && npx vitest run src/tests/RosterImportModal.scaffold.svelte.test.ts 2>&1 | tail -10
```

Expected: 6/6 PASS.

- [ ] **Step 6: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RosterImportModal.svelte \
        frontend/src/tests/RosterImportModal.scaffold.svelte.test.ts \
        frontend/src/pages/runs/RunDetailPage.svelte
git commit -m "feat(frontend): RosterImportModal Stage 1 (paste + live preview)"
```

---

### Task 17: `RosterImportModal` `buildBatchRow` (F1=A) + submit + result

**Files:**
- Modify: `frontend/src/components/runs/RosterImportModal.svelte`
- Create: `frontend/src/lib/buildBatchRow.ts`
- Test: `frontend/src/tests/buildBatchRow.test.ts`
- Test: `frontend/src/tests/RosterImportModal.submit.svelte.test.ts`

**Context:** Wires the submit path. On `Import` click:
1. Disable Import + Cancel + Escape; render `Importing…`.
2. Call `onRefetchBeforeSubmit()` — returns fresh `{ students, groups }`.
3. For each valid CSV row, run `buildBatchRow(parsed, freshRoster, freshGroups)` (F1=A logic).
4. `POST /api/runs/{runId}/students/batch`.
5. Render Stage 2 result table; `Copy failed rows` available if any failures.
6. `Done` → parent's `onRefetchBeforeSubmit` (same function — re-uses the in-band refetch).

Extract `buildBatchRow` into a pure module so it can be unit-tested without mounting the modal — F1=A correctness is the highest-risk part of this feature.

- [ ] **Step 1: Write `buildBatchRow` unit tests**

Create `frontend/src/tests/buildBatchRow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildBatchRow } from '../lib/buildBatchRow';
import type { CsvRow } from '../lib/csv';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

const row = (over: Partial<CsvRow>): CsvRow => ({
  rowIndex: 1, raw: [], parsed: { name: null, email: '', group: null },
  valid: true, errors: [], alreadyEnrolled: false, ...over,
} as CsvRow);

const roster: RunStudentResponse[] = [
  { user_id: 1, user_email: 'a@x.com', user_full_name: null, group_id: 99 } as RunStudentResponse,
  { user_id: 2, user_email: 'b@x.com', user_full_name: null, group_id: null } as RunStudentResponse,
];

const groups: GroupResponse[] = [
  { id: 99, run_id: 10, name: 'Alpha', student_count: 1, is_disabled: false } as GroupResponse,
];

describe('buildBatchRow (F1=A)', () => {
  it('case 1: already-enrolled + empty group cell + has existing group → resolves current group name', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'a@x.com', group: null }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'a@x.com', group: 'Alpha' });
  });

  it('case 2: already-enrolled + empty group cell + null group → omits group field', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'b@x.com', group: null }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'b@x.com' });
    expect(Object.prototype.hasOwnProperty.call(r, 'group')).toBe(false);
  });

  it('case 3: brand-new + empty group cell → omits group field', () => {
    const r = buildBatchRow(
      row({ parsed: { name: 'Carol', email: 'c@x.com', group: null }, alreadyEnrolled: false }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'c@x.com', name: 'Carol' });
    expect(Object.prototype.hasOwnProperty.call(r, 'group')).toBe(false);
  });

  it('case 4: non-empty cell sent as-is (regardless of alreadyEnrolled)', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'a@x.com', group: 'Beta' }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'a@x.com', group: 'Beta' });
  });

  it('race fallback: already-enrolled email not in roster → omits group', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'gone@x.com', group: null }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'gone@x.com' });
    expect(Object.prototype.hasOwnProperty.call(r, 'group')).toBe(false);
  });
});
```

- [ ] **Step 2: Verify test fails**

```bash
cd frontend && npx vitest run src/tests/buildBatchRow.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../lib/buildBatchRow'`.

- [ ] **Step 3: Implement `lib/buildBatchRow.ts`**

```ts
import type { CsvRow } from './csv';
import type { GroupResponse, RunStudentBatchRow, RunStudentResponse } from './types';

export function buildBatchRow(
  parsed: CsvRow,
  existingRoster: RunStudentResponse[],
  groups: GroupResponse[],
): RunStudentBatchRow {
  let groupName: string | null = parsed.parsed.group;

  if (!groupName && parsed.alreadyEnrolled) {
    const existing = existingRoster.find(
      (r) => r.user_email.toLowerCase() === parsed.parsed.email,
    );
    if (existing && existing.group_id !== null) {
      const g = groups.find((g) => g.id === existing.group_id);
      if (g) groupName = g.name;
    }
  }

  const row: RunStudentBatchRow = { email: parsed.parsed.email };
  if (parsed.parsed.name) row.name = parsed.parsed.name;
  if (groupName) row.group = groupName;
  return row;
}
```

- [ ] **Step 4: Verify buildBatchRow tests pass**

```bash
cd frontend && npx vitest run src/tests/buildBatchRow.test.ts 2>&1 | tail -10
```

Expected: 5/5 PASS.

- [ ] **Step 5: Write submit-flow tests**

Create `frontend/src/tests/RosterImportModal.submit.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RosterImportModal from '../components/runs/RosterImportModal.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy.mockReset();
  // @ts-expect-error
  globalThis.fetch = fetchSpy;
  document.body.innerHTML = '';
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); flushSync(); }

function mountModal(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // Stale props show the OLD group name; the refetch returns the FRESH name.
  // The submit-time refetch contract requires `buildBatchRow` to run against
  // the callback's data, NOT the props. Asserting `group: 'Alpha'` on the POST
  // body therefore proves the fresh data path was taken.
  const refetch = vi.fn().mockResolvedValue({
    students: [{ user_id: 1, user_email: 'a@x.com', user_full_name: null, group_id: 99 }],
    groups: [{ id: 99, run_id: 10, name: 'Alpha', student_count: 1, is_disabled: false }],
  });
  const onClose = vi.fn();
  const cmp = mount(RosterImportModal, { target, props: {
    runId: 10,
    existingRoster: [{ user_id: 1, user_email: 'a@x.com', user_full_name: null, group_id: 99 }],
    existingGroups: [{ id: 99, run_id: 10, name: 'OldName', student_count: 1, is_disabled: false }],
    onRefetchBeforeSubmit: refetch,
    onClose,
    ...extra,
  } });
  return { target, cmp, refetch, onClose };
}

describe('RosterImportModal submit', () => {
  it('calls onRefetchBeforeSubmit exactly once, then POSTs batch with F1=A wire shape', async () => {
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      expect(url).toContain('/api/runs/10/students/batch');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.rows).toEqual([{ email: 'a@x.com', group: 'Alpha' }]);
      expect(Object.prototype.hasOwnProperty.call(body.rows[0], 'group')).toBe(true);
      return jres({ results: [{ email: 'a@x.com', status: 'ok' }] });
    });
    const { target, cmp, refetch } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('disables Import + Cancel during in-flight submit', async () => {
    let resolveRefetch: ((v: unknown) => void) | null = null;
    const refetch = vi.fn(() => new Promise((res) => { resolveRefetch = res; }));
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    const importBtn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    importBtn.click();
    flushSync();
    expect(importBtn.disabled).toBe(true);
    expect((target.querySelector('button[data-action="cancel"]') as HTMLButtonElement).disabled).toBe(true);
    resolveRefetch!({ students: [], groups: [] });
    unmount(cmp);
  });

  it('renders result table with error tooltip on stage 2; Done calls onClose + refetch', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'ok' },
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
    ] }));
    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com\nbad@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(target.textContent).toMatch(/1 added/);
    expect(target.textContent).toMatch(/1 failed/);
    const errorBadge = target.querySelector('[data-result="error"]') as HTMLElement;
    expect(errorBadge?.getAttribute('title')).toBe('Email invalid');
    (target.querySelector('button[data-action="done"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(2); // once for submit-time, once for Done
    unmount(cmp);
  });
});
```

- [ ] **Step 6: Run submit-flow test, verify it fails**

```bash
cd frontend && npx vitest run src/tests/RosterImportModal.submit.svelte.test.ts 2>&1 | tail -10
```

Expected: FAIL — Import button has no onclick handler.

- [ ] **Step 7: Extend `RosterImportModal.svelte` with submit + Stage 2**

Inside `<script>`, add:

```ts
import { ApiError } from '../../lib/api';
import { batchAddRunStudents } from '../../lib/runRoster';
import { buildBatchRow } from '../../lib/buildBatchRow';
import type { RunStudentBatchResultRow } from '../../lib/types';

type Stage = 'paste' | 'result';
let stage = $state<Stage>('paste');
let submitting = $state(false);
let resultRows = $state<RunStudentBatchResultRow[] | null>(null);
let copyFallbackVisible = $state(false);
let copyFallbackText = $state('');

async function onImport() {
  if (!parsed || !parsed.ok || parsed.validCount === 0 || submitting) return;
  submitting = true;
  try {
    const fresh = await onRefetchBeforeSubmit();
    const rows = parsed.rows
      .filter((r) => r.valid)
      .map((r) => buildBatchRow(r, fresh.students, fresh.groups));
    const response = await batchAddRunStudents(runId, rows);
    resultRows = response.results;
    stage = 'result';
  } catch (e) {
    // Top-of-modal banner via local state.
    if (e instanceof ApiError) {
      parsed = { ok: false, error: e.displayMessage };
    }
  } finally {
    submitting = false;
  }
}

function failedRowsAsText(): string {
  if (!resultRows) return '';
  return resultRows
    .filter((r) => r.status === 'error')
    .map((r) => `${r.email}\t${r.detail ?? ''}`)
    .join('\n');
}

async function onCopyFailed() {
  const text = failedRowsAsText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    copyFallbackText = text;
    copyFallbackVisible = true;
  }
}

async function onDone() {
  await onRefetchBeforeSubmit();
  onClose();
}
```

In the template, replace the existing `<div class="modal-actions">` block and add Stage 2 rendering:

```svelte
{#if stage === 'paste'}
  <div class="modal-actions">
    <button type="button" data-action="cancel" disabled={submitting} onclick={onClose}>Cancel</button>
    <button
      type="button"
      data-action="import"
      disabled={!parsed || !parsed.ok || parsed.validCount === 0 || submitting}
      onclick={onImport}
    >
      {submitting ? 'Importing…' : (parsed && parsed.ok ? `Import ${parsed.validCount} valid rows` : 'Import 0 valid rows')}
    </button>
  </div>
{:else if stage === 'result' && resultRows}
  {@const added = resultRows.filter((r) => r.status === 'ok').length}
  {@const failed = resultRows.filter((r) => r.status === 'error').length}
  <table class="result">
    <thead><tr><th>#</th><th>Email</th><th>Result</th></tr></thead>
    <tbody>
      {#each resultRows as r, i}
        <tr>
          <td>{i + 1}</td>
          <td>{r.email}</td>
          <td>
            {#if r.status === 'ok'}
              <span class="badge badge-ok">added</span>
            {:else}
              <span class="badge badge-error" data-result="error" title={r.detail ?? ''}>error</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <footer class="counts">
    <p>{added} added, {failed} failed.</p>
  </footer>
  <div class="modal-actions">
    {#if failed > 0}
      <button type="button" data-action="copy-failed" onclick={onCopyFailed}>Copy failed rows</button>
    {/if}
    <button type="button" data-action="done" onclick={onDone}>Done</button>
  </div>
  {#if copyFallbackVisible}
    <textarea readonly>{copyFallbackText}</textarea>
  {/if}
{/if}
```

Update the Escape handler to be stage-aware:

```ts
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (submitting) return;
  if (stage === 'paste') onClose();
  else onDone();
}
```

- [ ] **Step 8: Verify submit tests pass**

```bash
cd frontend && npx vitest run src/tests/RosterImportModal.submit.svelte.test.ts 2>&1 | tail -10
```

Expected: 3/3 PASS.

- [ ] **Step 9: Run full suite + svelte-check**

```bash
cd frontend && npm test -- --run 2>&1 | tail -3 && npm run check 2>&1 | tail -3
```

Expected: full suite passes; baseline unchanged.

- [ ] **Step 10: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RosterImportModal.svelte \
        frontend/src/lib/buildBatchRow.ts \
        frontend/src/tests/buildBatchRow.test.ts \
        frontend/src/tests/RosterImportModal.submit.svelte.test.ts
git commit -m "feat(frontend): RosterImportModal submit (F1=A buildBatchRow + Stage 2 result)"
```

---

### Task 18: Final integration — 24-step manual smoke + suite delta + svelte-check baseline

**Files:**
- None to create — this task is verification only.

**Context:** Walk the manual smoke plan (spec §7 "Manual smoke plan"). All 24 steps must turn green. Backend-side issues are filed as follow-ups (not blockers). Then take a count delta of vitest pass count vs main + a svelte-check warning-count diff vs main; both must be non-regressive.

- [ ] **Step 1: Boot dev server + log in as admin**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
./run-dev.sh  # if present; otherwise start backend + frontend in two terminals
```

Sign in via the existing PIN flow (per memory note: `MATHION_DEBUG=1` prints the PIN to stdout for testing).

- [ ] **Step 2: Walk the 24-step smoke plan in `docs/superpowers/specs/2026-05-19-run-management-admin-design.md` §7**

For each step, note pass/fail with a brief observation. Steps cover: course → runs index, create run, publish-readiness checklist, teachers add/remove, groups add/rename/delete, roster add/edit/bulk, CSV import full path (F1=A wire shapes), error toasts, publish/unpublish, disabled-version banner, route admin-gating, 401 redirect.

Record results in a temporary scratch buffer in this terminal (do NOT add a doc to the repo — these are verification notes, not artifacts).

- [ ] **Step 3: Vitest count delta vs main (use a temporary worktree — do NOT touch the current working tree)**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
# Create a throwaway worktree at main so the current branch stays untouched.
git worktree add /tmp/mathion-main-baseline main
cd /tmp/mathion-main-baseline/frontend && npm install --silent && npm test -- --run 2>&1 | tail -5
# Then back to feature branch for the comparison.
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test -- --run 2>&1 | tail -5
# Cleanup once you've noted the counts.
git worktree remove /tmp/mathion-main-baseline
```

Alternative (if you noted the baseline count BEFORE starting T1, per the "Pre-task: dev environment sanity" step at the top of this plan): just rerun `npm test -- --run` on the feature branch and compare against the noted baseline. No worktree needed.

The feature-branch run must have STRICTLY MORE passing tests than baseline, and zero failures.

- [ ] **Step 4: svelte-check baseline diff**

```bash
cd frontend && npm run check 2>&1 | tail -10
```

Compare the warning count to `main`'s. Warnings on `main` carry over; warnings added by this branch must be zero (or filed as follow-up issues with explicit justification).

- [ ] **Step 5: Final commit (if any housekeeping changes during smoke)**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git status
# Only commit if smoke uncovered tweaks (typos, minor copy fixes). Otherwise nothing to commit.
```

- [ ] **Step 6: Mark plan complete**

Apply `finishing-a-development-branch` workflow when the user is ready to merge or open a PR.

---

## Plan complete

This plan covers spec §1–§10 across 19 tasks (T11 split into T11a + T11b). Coverage map:

| Spec section | Task(s) |
|---|---|
| §2 Routes | T5, T7 |
| §3.1 File layout | T3 |
| §3.2 Stale-guard | T7 |
| §3.3 RunListPage | T5 |
| §3.4 NewRunModal | T6 |
| §3.5 RunDetailPage (header, banner, callback chain) | T7, T8 |
| §4.1 RunOverviewTab | T9, T10 |
| §4.2 RunTeachersTab | T11a |
| §4.3 RunGroupsTab | T11b |
| §4.4 RunRosterTab (core + optimistic + bulk + banner) | T12, T13, T14, T15 |
| §4.5 RosterImportModal | T16, T17 |
| §5.1 Types | T1 |
| §5.2 runs.ts | T1 |
| §5.3 runTeachers.ts | T2 |
| §5.4 runGroups.ts | T2 |
| §5.5 runRoster.ts | T2 |
| §5.6 runStatus.ts | T4 |
| §5.7 csv.ts | T4 |
| §6 Error handling | T8, T10, T11, T13, T17 |
| §7 Testing | All tasks (each step authored a test); manual smoke in T18 |
| §9 Acceptance criteria | T18 |
| Shared UI primitives | T3 |
