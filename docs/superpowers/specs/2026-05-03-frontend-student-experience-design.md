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
    │   │   ├── router.svelte.ts   # ~50-line history-API router using $state (note: .svelte.ts because runes outside .svelte require this extension)
    │   │   ├── api.ts             # fetch wrapper, error mapping, CSRF
    │   │   ├── auth.svelte.ts     # request-pin / verify-pin / logout / bootstrapSession (.svelte.ts: exports $state)
    │   │   ├── events.ts          # tiny callback registry (e.g. onUnauthorized) injected at boot to break the api↔auth↔router cycle
    │   │   ├── coverage.svelte.ts # active-time + Page-Visibility-gated tracker (factory: createCoverageTracker(itemId))
    │   │   ├── types.ts           # hand-written types mirroring backend schemas (typed discriminated unions for Item.type and Question.type)
    │   │   ├── format.ts          # tiny date / duration / number formatters
    │   │   └── stores/
    │   │       ├── session.svelte.ts
    │   │       ├── currentCourse.svelte.ts
    │   │       └── toasts.svelte.ts
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

**What ships to the browser at runtime:** the Svelte 5 runtime + this app's compiled JS + ~5–15 KB of CSS. No Vite, no TypeScript, no other libraries. (Bundle size to be measured post-build, not estimated.)

**Svelte 5 idiom rules** (explicit so an implementer or LLM doesn't reach for Svelte 4 patterns):

- Reactive state outside `.svelte` files **requires** `.svelte.ts` (or `.svelte.js`) extension. A plain `.ts` file using `$state` will silently produce non-reactive values.
- Props: `let { foo, onbar } = $props()` — never `export let foo`.
- Events from child to parent: callback props (`onbar={(x) => ...}`) — never `createEventDispatcher` or `dispatch('bar')`.
- Slots: `{#snippet}` + `{@render}` — never `<slot>`.
- DOM events: `onclick={...}` — never `on:click={...}`.
- Stores: prefer `$state` in a `.svelte.ts` module exporting an object whose properties are reactive — never `svelte/store`'s `writable`/`readable`.

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
- Components are dumb: receive props, fire callback props. They don't fetch.
- The router is a `$state` object plus a `navigate(path)` helper. `App.svelte` re-renders reactively on path change.
- No service workers, no SSR, no prerendering.
- **Production serving:** SPA is served by FastAPI's `StaticFiles` mount with `html=True` (SPA fallback). This requires a small backend addition — see §10. The mount must come AFTER all `/api/*` routers in `main.py`.
- **Dev serving:** Vite dev server on `:5173`, FastAPI on `:8000`, Vite proxies `/api/*` → `:8000`. The frontend always uses relative `/api/*` paths so the same code works in both modes.

**Module dependency rule (cycle prevention):** `lib/api.ts` does NOT import from `lib/auth.svelte.ts` or `lib/router.svelte.ts`. Instead, `lib/events.ts` exports a tiny callback registry (`onUnauthorized(cb)`, `emitUnauthorized()`); `main.ts` wires `events.onUnauthorized` to `(path) => { session.user = null; router.navigate('/login?next=' + ...); }` at boot. `api.ts` calls `events.emitUnauthorized(currentPath)` on 401. This breaks the api↔auth↔router cycle that ESM partial-init would otherwise expose.

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

### Router (`src/lib/router.svelte.ts`)

- `currentRoute = $state({ path, params, hash })` populated from `location` on mount, on `popstate`, AND on `hashchange`. Hash-only changes do not fire `popstate`, so the `hashchange` listener is required for `#item=` updates to be observable.
- A `$derived` view exposes the matched route record (route entry + extracted params), so `App.svelte` is one expression instead of an `{#if}` ladder duplicating `routes.ts`.
- `navigate(path, { replace? })` calls `history.pushState`/`replaceState` and updates `currentRoute`. App re-renders.
- Hash navigation does NOT trigger route guard re-evaluation (intentional: item flips inside an authenticated sequence player are not protected boundaries).

### Route guards (single layer in `App.svelte`)

- On every route change (path-level, not hash-level), if the route requires auth and `session.user === null`, navigate to `/login?next=<encoded current path>`.
- On successful login, read `next` from the query string and navigate there. **`next` is validated**: must start with `/` AND not start with `//` (open-redirect guard); otherwise default to `/courses`.

### Backend errors

| Status | Behavior |
|---|---|
| 401 | `lib/api.ts` calls `events.emitUnauthorized(currentPath)` (UNLESS request was made with `{ skipAuthRedirect: true }` — used by `bootstrapSession`). The wired handler clears `session.user` and navigates to `/login?next=...`. |
| 403 | Page-level inline panel ("You don't have access to this course"). No redirect. |
| 404 | Page-level inline panel. UI distinguishes between "course doesn't exist" vs "you're not enrolled" via copy on the CourseView page (both backend cases return 404 from `/api/courses/:slug/my-version`). |
| 422 | FastAPI returns `detail: ValidationError[]` (an array). `ApiError.detail` is typed as `string \| ValidationErrorDetail[]`. Forms render per-field inline errors; non-form contexts fall back to a toast. |
| 409 with `error_code` | Page-level inline panel using a code → friendly-message map. **Note:** in slice 1 no endpoint actually returns `error_code` (only bulk-roster endpoints do). The map is forward-compatible scaffolding; keep it minimal. |
| 5xx / network | Toast (top-right, auto-dismiss 5 s). |

---

## 5. API client + auth

### `src/lib/api.ts` (~100 lines)

```ts
type ValidationErrorDetail = { loc: (string | number)[]; msg: string; type: string };

class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string | ValidationErrorDetail[],
    public errorCode?: string,
  ) { super(typeof detail === 'string' ? detail : 'Validation error'); }
}

type RequestOpts = RequestInit & { skipAuthRedirect?: boolean };

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { skipAuthRedirect, headers: callerHeaders, ...init } = opts;
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    // headers MUST come last in this object so callerHeaders can extend (not override) X-Requested-With.
    headers: { 'X-Requested-With': 'mathion', ...(callerHeaders ?? {}) },
  });
  if (res.status === 401 && !skipAuthRedirect) {
    events.emitUnauthorized(location.pathname + location.search);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.error_code);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get:    <T>(path, opts?: RequestOpts) => request<T>(path, { ...opts, method: 'GET' }),
  post:   <T>(path, body?) => request<T>(path, { method: 'POST', body: body && JSON.stringify(body), headers: {'Content-Type':'application/json'} }),
  patch:  <T>(path, body) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body), headers: {'Content-Type':'application/json'} }),
  delete: (path) => request<void>(path, { method: 'DELETE' }),
};
```

CSRF: backend requires the static header `X-Requested-With: mathion` on **every authenticated mutating request** (POST/PATCH/DELETE) — not only auth POSTs. `dependencies.py:get_current_user` enforces it for any non-GET/HEAD/OPTIONS method. The wrapper sets it on every request unconditionally so this is automatically satisfied.

### `src/lib/auth.svelte.ts`

```ts
// session lives in src/lib/stores/session.svelte.ts; imported here for the helpers below.
import { session, clearSession } from './stores/session.svelte';

// Note: backend `POST /api/auth/verify-pin` returns { user: User }, NOT User directly.
// Bootstrap call must opt out of the api.ts auth-redirect because anonymous users
// legitimately receive 401 here.
export async function bootstrapSession() {
  try {
    const u = await api.get<User>('/api/auth/me', { skipAuthRedirect: true });
    session.user = u;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;  // network errors propagate
    session.user = null;
  } finally {
    session.loading = false;
  }
}

export async function requestPin(email: string) {
  return api.post('/api/auth/request-pin', { email });
}

export async function verifyPin(email: string, pin: string, days: 1 | 7 | 30) {
  const { user } = await api.post<{ user: User }>(
    '/api/auth/verify-pin', { email, pin, duration_days: days }
  );
  session.user = user;
  return user;
}

export async function logout() {
  await api.post('/api/auth/logout');
  clearSession();        // also resets currentCourse via the onLogout hook in main.ts
}
```

**Bootstrap order** (`src/main.ts`):
1. Wire `events.onUnauthorized` to a handler that calls `clearSession()` and `router.navigate('/login?next=' + safeNext(...))`.
2. Wire a "session cleared" hook that also clears `currentCourse`.
3. Mount `App.svelte`.
4. Show full-page spinner while `session.loading === true`.
5. `bootstrapSession()` populates session from `/api/auth/me` (with `skipAuthRedirect: true`).
6. App renders the right route based on `session.user` + current path.

---

## 6. Stores

All store modules use the `.svelte.ts` extension (required for `$state` outside `.svelte` files). Each module exports an object whose properties are reactive and a small set of mutator helpers (so call sites don't sprinkle `session.user = null` everywhere — they call `clearSession()`).

| Store (file) | Shape | Helpers exported | Purpose |
|---|---|---|---|
| `session.svelte.ts` | `{ user: User \| null; loading: boolean }` | `clearSession()` | Bootstrapped at app start; updated by login/logout. |
| `currentCourse.svelte.ts` | `{ slug, versionId, course, version, blocks } \| null` | `loadCourse(slug)`, `clearCourse()`, `markItemCovered(itemId)` | In-tab cache so navigating CourseView ↔ SequencePlayer doesn't refetch. Cleared on logout (wired in `main.ts`). Not persisted to `localStorage` (avoids stale data after admin edits). **`SequencePlayer` calls `loadCourse(slug)` if the cache is empty or the slug doesn't match — direct URL entry / refresh / bookmark always works.** |
| `toasts.svelte.ts` | `Toast[]` | `pushToast(msg, kind?)` | Push-and-auto-dismiss notifications. `<Toaster />` renders the list. |

Page-scoped state lives at the page level (`$state` rune inside the `.svelte` file). It does not belong in a global store if it doesn't outlive the page.

No global error store — errors surface where they happen (form-level, page-level, or as a toast).

---

## 7. Components

### Pages

| Page | Fetches | Renders |
|---|---|---|
| `Login.svelte` | nothing on mount | email step → PIN step inline; remember-me selector (1 / 7 / 30 days, default 7); calls `lib/auth.svelte.ts` |
| `CourseList.svelte` | `GET /api/my-courses` | grid of `CourseCard`. Empty state: "You're not enrolled in any courses yet — ask your teacher for an invite." |
| `CourseView.svelte` | `GET /api/courses/:slug/my-version`, then `/api/versions/:id/content` + `/api/versions/:id/state` (parallel). 404 distinguishes "course doesn't exist" vs "not enrolled" via UI copy. | header + `BlockGroup` list (vertical block tree). Empty state: "This course has no published blocks yet." |
| `SequencePlayer.svelte` | **Always calls `currentCourse.loadCourse(slug)` if the cache is empty or the slug doesn't match** (handles direct URL entry, refresh, bookmark). `POST /api/items/:id/track` for time-spent + coverage. Hash item changes do not refetch. | top item strip + `ItemRouter` + bottom prev/next. Empty state for sequence with zero items: "This sequence has no items yet." |
| `NotFound.svelte` | nothing | static |

### Course components

| Component | Responsibility |
|---|---|
| `CourseCard.svelte` | Course title + version + progress bar (`covered_items / total_items`) + "Continue" link to `/courses/:slug` |
| `BlockGroup.svelte` | One block: title, `info_html`, collapsible list of `SequenceLink`. **Default state: expanded** (closed only if user explicitly collapsed in this tab; not persisted). |
| `SequenceLink.svelte` | One row: title, item count, **coverage indicator = small "n / total" text + check mark when n === total**, link to player. |
| `ItemIcon.svelte` | One icon in the sequence-player strip; props: `{ type, state, title, onclick }` (callback prop, not event). Coverage state via background color: covered / current / not-yet. Title shown on hover. |

### Item viewers

`ItemRouter.svelte` dispatches by `item.type` using a typed discriminated union (compiler-checked exhaustiveness). **Backend type strings are `static_page`, `video`, `quiz` — match `Item.type` exactly.**

| Component | Notes |
|---|---|
| `PageItem.svelte` | Renders `{@html item.content_html}` (sanitized server-side at write-time). Coverage timer comes from `lib/coverage.svelte.ts` (`createCoverageTracker(itemId, { type: 'static_page' })`) — the timer accrues active time from `performance.now()` deltas while `document.visibilityState === 'visible'`, NOT by interval count. At 30 s accumulated → `track(is_covered=true)`. **Trust boundary note**: `{@html ...}` is safe ONLY because the backend pre-sanitises with `bleach`. Any future content source (math rendering, draft preview, imports) MUST pass through the same sanitiser. |
| `VideoItem.svelte` | `<iframe>` embed. Explicit "Mark as watched" button is the covered trigger. Documented compromise. |
| `QuizItem.svelte` | Renders all questions, single Submit button. **Submit is disabled until every question has an answer.** Submit enters loading state immediately on click (single-flight; prevents double-submit). On success: shows aggregate `{score_correct} / {score_total}` and "Try again" button if `attempt_count < max_quiz_attempts`. **Per-question correctness is NOT shown after each submit** — backend `POST /api/items/:id/submit` returns aggregate only. Per-question reveal becomes available only after all attempts are exhausted (backend `GET /api/items/:id/reveal` returns 403 until then). When attempts are exhausted, render a "Show correct answers" link that fetches `/reveal`. On submit failure (5xx / network): keep answers in state, surface a toast, allow retry. Quiz coverage is set on first successful submit (any score). |

### Quiz subcomponents (one per backend question type)

```
components/items/quiz/
├── SingleChoiceQuestion.svelte    # radio buttons; backend type "single_choice"
├── MultiChoiceQuestion.svelte     # checkboxes;   backend type "multiple_choice"
├── NumericQuestion.svelte         # <input type=number>; backend type "numeric_answer"
└── TextQuestion.svelte            # <input type=text>;   backend type "text_answer"
```

Each takes a callback prop `onanswer={(ans) => ...}` and calls it on every change. `QuizItem` collects answers in a `$state` map keyed by question_id and submits.

**Numeric questions, V1 limitation:** `precision` and `unit` fields exist on the backend `Question` model but are NOT exposed in the `/api/versions/:id/content` payload at slice 1. Frontend numeric input is therefore tolerance-blind on the UI side (no decimal-separator hint, no unit suffix) — the backend still scores correctly using its stored `precision`. If the user finds this insufficient in practice, exposing `precision`/`unit` is a small follow-up.

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
    --primary: #444;        /* neutral grey on purpose — design polish picks the real value later */
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

**Implementation correctness:** the timer uses `performance.now()` deltas accumulated only while the page is visible — NOT a `setInterval(15s)` tick count. A user who is visible for 1 s and then hidden for 14 s would otherwise have a 15 s POST credited to them; with deltas, only the 1 s of actual visibility is recorded.

**Single module:** all of the above lives in `src/lib/coverage.svelte.ts` exposing `createCoverageTracker(itemId, opts)` returning `{ start(), stop(), markCovered() }`. `PageItem`, `VideoItem`, `QuizItem` all use it (each with its own covered-trigger condition). This factoring pays off in Slice 2 when `MiniProjectItem` and `InteractiveAppItem` need the same behavior.

---

## 10. Backend dependencies + small additions

### Existing endpoints used (no changes)

| Concern | Endpoint(s) |
|---|---|
| Auth | `POST /api/auth/request-pin`, `POST /api/auth/verify-pin` (returns `{user: User}`), `GET /api/auth/me`, `POST /api/auth/logout` |
| Course list | `GET /api/my-courses` (already deduped to one row per course) |
| Slug → version | `GET /api/courses/:slug/my-version` |
| Course tree | `GET /api/versions/:id/content` (full block→sequence→item→question tree, with `_html` fields rendered at write-time) |
| Coverage state | `GET /api/versions/:id/state` |
| Coverage update | `POST /api/items/:id/track` |
| Quiz submit | `POST /api/items/:id/submit` (aggregate score only) |
| Quiz reveal (review answers) | `GET /api/items/:id/reveal` (403 until `attempt_count >= max_attempts`) |

### Two backend additions (small, included in this slice)

**A1 — SPA static mount in `mathion/main.py`.**

Add at the very end of `main.py`, AFTER all `app.include_router(...)` calls:

```python
from fastapi.staticfiles import StaticFiles

app.mount(
    "/",
    StaticFiles(directory=settings.frontend_dist, html=True),
    name="spa",
)
```

Plus a new setting in `mathion/config.py`:

```python
frontend_dist: str = "../frontend/dist"   # overridable via MATHION_FRONTEND_DIST
```

The `html=True` flag makes any unmatched non-`/api/*` path serve `index.html`, giving SPA history-routing fallback for free. Routes registered before the mount (`/api/*`, `/health`) are unaffected — they keep returning JSON.

Tests: `/health` still works; `/api/courses/missing/my-version` still returns JSON 404 (not index.html); `/courses/some-deep-spa-path` returns index.html with status 200.

**A2 — `Block.info_html` column with write-time rendering.**

Add a sibling `info_html` column to `Block` (matches `CourseVersion.info_html` and `Item.content_html` pattern):

- New column on `blocks` table — Alembic migration adds the column nullable, backfills HTML from existing `info` markdown (one-shot data migration), then makes it `NOT NULL DEFAULT ''`.
- `Block` model gets `info_html: Mapped[str]`.
- The block-creation/update path renders markdown to HTML at write-time using the existing `mathion.markdown.render_markdown`.
- `mathion/api/content.py:_serialize_block` returns `info_html` (in addition to or instead of `info`).
- Tests: write a block with markdown, read back via `/content`, assert HTML rendering. Migration roundtrip test.

This finally lands the Phase 6 deferred item ("`Block.info` has no `info_html` field") without scope drift — it's the same render-at-write pattern already used elsewhere in the schema.

### Summary

No NEW endpoints. Two small backend additions (~1 file change + 1 migration + ~30 lines of code total, plus tests). Everything else composes against existing endpoints.

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
| Per-question quiz feedback isn't shown until all attempts are exhausted. | Backend `/reveal` endpoint enforces this. UI shows aggregate-only after each submit; "Show correct answers" link appears once attempts reach max. |
| Numeric question UI is tolerance-blind (no precision/unit shown). | Backend still scores correctly; frontend just doesn't surface precision yet. Small follow-up if needed. |
| Bookmark to `…/seq/42#item=87` could land on a page where item 87 no longer exists in the sequence. | SequencePlayer falls back to the first item if `#item=` is missing or invalid. |
| `error_code` map in `lib/api.ts` is unused in slice 1 (only bulk-roster endpoints emit codes). | Forward-compatible scaffolding kept minimal — one no-op fallback path. |

---

## 13. Frontend contract for future slices

This slice establishes patterns that later slices (teacher tools, course creator, run management) will follow:

- `lib/api.ts`, `lib/auth.ts`, `lib/router.ts`, `lib/stores/session.ts` are reusable foundations — built once, not re-invented.
- `components/ui/` primitives (Button, Input, FormRow, Spinner, Toast) are shared across all slices.
- Style variables in `base.css` are the theming surface — design polish lands once and applies everywhere.
- The route table grows; the router code does not.

When the next slice is brainstormed, only its slice-specific pages, components, and any new endpoints need fresh design.
