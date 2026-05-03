# Mathion Frontend — Student Experience (Slice 1) Design

**Status:** Brainstormed 2026-05-03 · Awaiting plan.

**Goal:** Build the first slice of the Mathion frontend: a free-form (non-run) student experience covering login, course list, course view (syllabus), sequence player, and the static-page / video / quiz item viewers. This slice produces a usable, end-to-end student app.

**Out of scope for this slice** (each gets its own spec when needed):
- Run-based student features (mini-projects, group context, run dashboard).
- Math/LaTeX rendering in content.
- Interactive-app item type (Phase 8 backend work).
- Teacher tools, course creator, admin / run management.
- Theming, dark mode, web fonts.
- Backwards-compatibility shims; this is a green-field frontend.

---

## 1. Foundational decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| Q1 | Scope of "no JS deps" | Runtime-only. Build tooling (Vite, TypeScript, svelte-check, vitest) is fine — none ships to the browser. |
| Q2 | Framework | Plain Svelte 5 + Vite. **No SvelteKit.** Hand-rolled router. |
| Q3 | Slice scope | Free-form student only. No run features in V1. |
| Q4 | TypeScript | Yes. `lib/types.ts` mirrors backend Pydantic shapes. |
| Q5 | Markdown rendering | Server-side, **at write-time** (already implemented: `mathion/markdown.py` + `_html` columns on Block, Item, Question). |
| Q6 | Repo location | New `frontend/` directory at repo root, sibling of `backend/`. |
| Q7 | Math / LaTeX | Defer entirely from this slice. |
| Q8 | Auth flow | Two-step inline form on `/login`; backend cookie session; conventional error handling. |
| Q9 | Course view layout | Vertical block tree (collapsible blocks down the page). |
| Q10 | Sequence player layout | Top icon strip + full-width content + bottom prev/next. |
| Q11 | Quiz interaction | All questions on one page; submit at end; per-question results shown after submission. |
| Q12 | Coverage rules | Page: 30 s active time. Video: explicit "Mark as watched" button. Quiz: first submission. |
| — | URL design | Slug-based; **no version_id in URLs** (resolved server-side via `/api/courses/:slug/my-version`). |

---

## 2. Project structure

```
mathion/
├── backend/                       (existing)
└── frontend/                      ← new
    ├── package.json               # runtime deps: only "svelte"; build/dev: vite, typescript, svelte-check, vitest
    ├── tsconfig.json              # strict mode on
    ├── svelte.config.js
    ├── vite.config.ts             # dev :5173, /api proxy → :8000, build to ./dist
    ├── index.html                 # SPA entry
    ├── src/
    │   ├── main.ts                # bootstrap; mounts App.svelte; calls bootstrapSession()
    │   ├── App.svelte             # root: route guard + outlet
    │   ├── routes.ts              # route table
    │   ├── lib/
    │   │   ├── router.ts          # ~50-line history-API router using $state
    │   │   ├── api.ts             # fetch wrapper, error mapping, CSRF, 401-redirect
    │   │   ├── auth.ts            # request-pin / verify-pin / logout / bootstrapSession
    │   │   ├── types.ts           # hand-written types mirroring backend schemas
    │   │   ├── format.ts          # tiny date / duration / number formatters
    │   │   └── stores/
    │   │       ├── session.ts
    │   │       ├── currentCourse.ts
    │   │       └── toasts.ts
    │   ├── pages/
    │   │   ├── Login.svelte
    │   │   ├── CourseList.svelte
    │   │   ├── CourseView.svelte
    │   │   ├── SequencePlayer.svelte
    │   │   └── NotFound.svelte
    │   ├── components/
    │   │   ├── chrome/        AppHeader.svelte · AppFooter.svelte · Toaster.svelte
    │   │   ├── course/        CourseCard.svelte · BlockGroup.svelte · SequenceLink.svelte · ItemIcon.svelte
    │   │   ├── items/         ItemRouter.svelte · PageItem.svelte · VideoItem.svelte · QuizItem.svelte
    │   │   ├── items/quiz/    SingleChoiceQuestion · MultiChoiceQuestion · NumericQuestion · TextQuestion
    │   │   └── ui/            Button · Input · FormRow · Spinner · Toast
    │   └── styles/
    │       ├── reset.css      # ~30 lines, hand-rolled
    │       └── base.css       # CSS custom properties + base typography
    └── tests/                  # vitest unit tests for lib/* modules
```

**Build commands** (dev deps only — nothing in this list ships to the browser):

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server, hot reload |
| `npm run build` | Production build → `dist/` |
| `npm run check` | `svelte-check` (typechecks .svelte + .ts) |
| `npm run test` | `vitest` |

**What ships to the browser at runtime:** the Svelte 5 runtime (~5 KB gzipped) + this app's compiled JS + ~5–15 KB of CSS. No Vite, no TypeScript, no other libraries.

---

## 3. Architecture

Three runtime layers, each modular:

```
   Browser
   ──────────────────────────────────────────────────
       Pages (Login, CourseList, CourseView, SequencePlayer, NotFound)
                       │ subscribe / call
                       ▼
       Stores  ──  session ($state)  ──  currentCourse ($state)  ──  toasts ($state)
                       │ uses
                       ▼
       lib/api.ts  ──  fetch wrapper, error mapping, CSRF, auth
                       │ HTTP (cookies)
                       ▼
   FastAPI backend
```

**Properties:**
- Pages own their data lifecycle. Each page mounts → fetches via `lib/api.ts` → renders or shows error/loading. No global "data layer" magic.
- Stores hold only what's genuinely shared across pages.
- Components are dumb: receive props, emit events. They don't fetch.
- The router is a `$state` object plus a `navigate(path)` helper. `App.svelte` re-renders reactively on path change.
- No service workers, no SSR, no prerendering. SPA served by FastAPI's `StaticFiles` with an SPA fallback (`html=True`).

---

## 4. Routing

### Route table (`src/routes.ts`)

| Path | Component | Auth required? |
|---|---|---|
| `/login` | `Login.svelte` | no |
| `/` (redirects to `/courses`) | — | — |
| `/courses` | `CourseList.svelte` | yes |
| `/courses/:courseSlug` | `CourseView.svelte` | yes |
| `/courses/:courseSlug/seq/:sequenceId` | `SequencePlayer.svelte` | yes |
| `*` (anything else) | `NotFound.svelte` | no |

Inside `SequencePlayer`, the *current item* is in the URL hash: `…/seq/42#item=87`. Hashes don't trigger router transitions, so item flips are instant.

### Router (`src/lib/router.ts`)

- `currentRoute = $state({ path, params, hash })` populated from `location` on mount and on `popstate`.
- `navigate(path, { replace? })` calls `history.pushState`/`replaceState` and updates `currentRoute`. App re-renders.
- `App.svelte` is an `{#if}` ladder over `currentRoute.path` matched against the route table; the matched component receives `params` as props.

### Route guards (single layer in `App.svelte`)

- On every route change, if route requires auth and `session.user === null`, navigate to `/login?next=<encoded current path>`.
- On successful login, read `next` and navigate there (default `/courses`).

### Backend errors

| Status | Behavior |
|---|---|
| 401 | `lib/api.ts` clears session, redirects to `/login`. |
| 403 | Page-level inline panel ("You don't have access to this course"). No redirect. |
| 404 | Page-level inline panel. |
| 422 | Form-level inline error per field. |
| 409 with `error_code` | Page-level inline panel using a code → friendly-message map. |
| 5xx / network | Toast (top-right, auto-dismiss 5 s). |

---

## 5. API client + auth

### `src/lib/api.ts` (~80 lines)

```ts
class ApiError extends Error {
  constructor(public status: number, public detail: string, public errorCode?: string) { ... }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'mathion', ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) { session.clear(); router.navigate('/login?next=...'); throw new ApiError(401, ...); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.error_code);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get:    <T>(path) => request<T>(path, { method: 'GET' }),
  post:   <T>(path, body?) => request<T>(path, { method: 'POST', body: body && JSON.stringify(body), headers: {'Content-Type':'application/json'} }),
  patch:  <T>(path, body) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body), headers: {'Content-Type':'application/json'} }),
  delete: (path) => request<void>(path, { method: 'DELETE' }),
};
```

CSRF: backend requires the static header `X-Requested-With: mathion` on auth POSTs (per `mathion/api/auth.py:_require_csrf`). The wrapper sets it on every request unconditionally — cheap and safe.

### `src/lib/auth.ts`

```ts
export const session = $state<{ user: User | null; loading: boolean }>({ user: null, loading: true });

export async function bootstrapSession() {
  try { session.user = await api.get<User>('/api/auth/me'); }
  catch { session.user = null; }
  finally { session.loading = false; }
}

export async function requestPin(email: string)              { return api.post('/api/auth/request-pin', { email }); }
export async function verifyPin(email, pin, days)            { const u = await api.post<User>('/api/auth/verify-pin', { email, pin, duration_days: days }); session.user = u; return u; }
export async function logout()                               { await api.post('/api/auth/logout'); session.user = null; }
```

**Bootstrap order** (`src/main.ts`):
1. Mount `App.svelte`.
2. Show full-page spinner while `session.loading === true`.
3. `bootstrapSession()` populates session from `/api/auth/me`.
4. App renders the right route based on `session.user` + current path.

---

## 6. Stores

| Store | Shape | Purpose |
|---|---|---|
| `session` | `{ user: User \| null; loading: boolean }` | Bootstrapped at app start; updated by login/logout. |
| `currentCourse` | `{ versionId, course, blocks: Block[] } \| null` | In-tab cache so navigating CourseView ↔ SequencePlayer doesn't refetch. Cleared on logout. Not persisted to `localStorage` (avoids stale data after admin edits). |
| `toasts` | `Toast[]` | Push-and-auto-dismiss notifications. `<Toaster />` renders the list. |

Page-scoped state lives at the page level (`$state` rune inside the `.svelte` file). It does not belong in a global store if it doesn't outlive the page.

No global error store — errors surface where they happen (form-level, page-level, or as a toast).

---

## 7. Components

### Pages

| Page | Fetches | Renders |
|---|---|---|
| `Login.svelte` | nothing on mount | email step → PIN step inline; calls `lib/auth.ts` |
| `CourseList.svelte` | `GET /api/my-courses` | grid of `CourseCard` |
| `CourseView.svelte` | `GET /api/courses/:slug/my-version`, then `/api/versions/:id/content` + `/api/versions/:id/state` (parallel) | header + `BlockGroup` list (vertical block tree) |
| `SequencePlayer.svelte` | reads from cached content + state; `POST /api/items/:id/track` | top item strip + `ItemRouter` + bottom prev/next |
| `NotFound.svelte` | nothing | static |

### Course components

| Component | Responsibility |
|---|---|
| `CourseCard.svelte` | Course title + version + progress bar + "Continue" link |
| `BlockGroup.svelte` | One block: title, info_html, collapsible list of `SequenceLink` |
| `SequenceLink.svelte` | One row: title, item count, coverage indicator, link to player |
| `ItemIcon.svelte` | One icon in the sequence-player strip; props: `{ type, state, title, onClick }` |

### Item viewers

`ItemRouter.svelte` dispatches by `item.type`:

| Component | Notes |
|---|---|
| `PageItem.svelte` | Renders `{@html item.content_html}` (sanitized server-side at write-time). 30 s active-time timer → `track(is_covered=true)`. |
| `VideoItem.svelte` | `<iframe>` embed. Cross-provider time tracking from an embedded iframe is unreliable, so an explicit "Mark as watched" button is the covered trigger. Documented compromise. |
| `QuizItem.svelte` | Renders all questions, submit button, post-submit results panel. |

### Quiz subcomponents (one per backend question type)

```
components/items/quiz/
├── SingleChoiceQuestion.svelte    # radio buttons
├── MultiChoiceQuestion.svelte     # checkboxes
├── NumericQuestion.svelte         # <input type=number>
└── TextQuestion.svelte            # <input type=text>
```

Each emits an `answer` event up to `QuizItem`, which collects answers and submits.

### UI primitives (`components/ui/`)

| Component | Props / variants |
|---|---|
| `Button.svelte` | `variant: 'primary' \| 'secondary' \| 'ghost'`, `disabled`, `loading` |
| `Input.svelte` | `type`, `value` (bind), `error` |
| `FormRow.svelte` | wraps label + slot + helper/error text |
| `Spinner.svelte` | inline; CSS animation only |
| `Toast.svelte` + `Toaster.svelte` | reads `toasts` store |

Each is hand-rolled, ~30–60 lines; no UI library dependency.

---

## 8. CSS organization

Two global stylesheets imported once in `main.ts`, plus per-component scoped styles inside Svelte `<style>` blocks.

**`src/styles/reset.css`** (~30 lines, hand-rolled)
- `*, *::before, *::after { box-sizing: border-box }`
- Reset margins/paddings, list styling, form-element fonts.
- `img, video { max-width: 100%; height: auto }`.

**`src/styles/base.css`** (~50 lines)
- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`. No web fonts shipped.
- A small palette of CSS custom properties on `:root` (intentionally bland; design comes later):

  ```css
  :root {
    --bg: #fff;
    --text: #1a1a1a;
    --muted: #666;
    --border: #ddd;
    --primary: #2563eb;     /* placeholder; tune later */
    --danger: #c33;
    --space-1: .25rem; --space-2: .5rem; --space-3: 1rem; --space-4: 1.5rem; --space-6: 3rem;
    --radius: 4px;
    --font-size-base: 16px;
  }
  ```

- Base typography (heading sizes, body line-height, link color).

**Component styles** — every `.svelte` file may include a `<style>` block. Svelte scopes selectors automatically; collisions are impossible. Components reference `:root` variables; no hardcoded colors except via variable names.

**No CSS-in-JS, no preprocessor, no PostCSS plugins** beyond Vite's built-in CSS handling.

**Light/dark theme** — out of scope for V1. Variable structure means it can be added later via `prefers-color-scheme: dark` overrides; no component changes needed.

**Responsive breakpoints** — minimal: default targets ~360 px+; `min-width: 640px` (tablet) and `min-width: 1024px` (desktop, wider content max-width). No mobile-only paths.

---

## 9. Coverage tracking

Backend endpoint: `POST /api/items/:id/track` accepting `{ time_spent: int (seconds, additive), is_covered?: boolean }`. Frontend decides when to set `is_covered=true`.

| Item type | Rule |
|---|---|
| Static page | After 30 s of active time (visible tab) → set `is_covered=true`. |
| Video | Explicit "Mark as watched" button → set `is_covered=true`. (Cross-provider video time tracking from iframes is unreliable; this is honest.) |
| Quiz | Automatically on first submit (any score) → set `is_covered=true`. |

**Time-spent posts** (separate from the covered flag): every 15 s while the item is the active item AND the page is visible, frontend POSTs the elapsed delta. This is incremental so a tab close doesn't lose minutes. The `Page Visibility API` (`document.visibilityState`) gates the timer.

---

## 10. Backend dependencies (no additions needed)

This slice composes **only against existing backend endpoints**:

| Concern | Endpoint(s) |
|---|---|
| Auth | `POST /api/auth/request-pin`, `POST /api/auth/verify-pin`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Course list | `GET /api/my-courses` (already deduped to one row per course) |
| Slug → version | `GET /api/courses/:slug/my-version` |
| Course tree | `GET /api/versions/:id/content` (full block→sequence→item→question tree, with `_html` fields rendered at write-time) |
| Coverage state | `GET /api/versions/:id/state` |
| Coverage update | `POST /api/items/:id/track` |
| Quiz submit | `POST /api/items/:id/submit` (returns per-question scoring) |
| Quiz reveal (review answers) | `GET /api/items/:id/reveal` |

No new endpoints, no schema changes, no migrations.

---

## 11. Testing strategy

| Layer | Tooling | What's tested |
|---|---|---|
| Type safety | `svelte-check` | `lib/types.ts` mirrors backend; if a backend response field shape changes, every consumer breaks at check time. |
| Pure-logic unit | `vitest` | router (path → matched route + params), `api.ts` error mapping (status → `ApiError`), `format.ts`, store logic (toast push/auto-remove, currentCourse coverage update). |
| Component tests | *deferred to V2* | UI shape is intentionally pre-design. `@testing-library/svelte` adds a dep, and tests against placeholder visual structure rot fast. Revisit when design lands. |
| Manual | Vite dev server + real backend | All visual flows: login, course list, course view, sequence playback, quiz. Tracked via a dev-time checklist in the implementation plan. |
| Backend contract | already covered (513 backend tests) | No frontend-side contract tests needed. |

**Coverage target:** ~80 % line coverage on `lib/` modules. Pages have no automated tests in V1.

**Dev deps added (build-time only):** `vitest`, optionally `@vitest/ui`. Nothing ships to the browser.

---

## 12. Risks and known compromises

| Risk | Mitigation / accepted compromise |
|---|---|
| Video covered-trigger is manual (no auto-detection of 95% played). | Documented; cross-provider iframe APIs aren't reliable without their own JS. Acceptable in V1. |
| Bookmarked sequence URL can 404 if admin moved a student to a new course version that reorganized sequences. | Documented; matches expectation set by "students don't think about versions." |
| `currentCourse` cache may go stale if admin edits content while student is mid-session. | Refetch on route entry. Cache is in-tab only (not persisted). Worst case: student sees one slightly stale render. |
| Hand-rolled markdown subset on backend may miss edge cases. | Out of scope for this slice — backend is already in production with `markdown-it`. |
| `Page Visibility API` doesn't catch all "user is away" cases (e.g., monitor off, focus on another window with the same tab visible). | Acceptable for coverage tracking; this isn't a billing system. |

---

## 13. Frontend contract for future slices

This slice establishes patterns that later slices (teacher tools, course creator, run management) will follow:

- `lib/api.ts`, `lib/auth.ts`, `lib/router.ts`, `lib/stores/session.ts` are reusable foundations — built once, not re-invented.
- `components/ui/` primitives (Button, Input, FormRow, Spinner, Toast) are shared across all slices.
- Style variables in `base.css` are the theming surface — design polish lands once and applies everywhere.
- The route table grows; the router code does not.

When the next slice is brainstormed, only its slice-specific pages, components, and any new endpoints need fresh design.
