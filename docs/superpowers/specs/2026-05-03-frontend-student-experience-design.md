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
    │   │   ├── events.ts          # plain .ts (no runes) — tiny callback registry (e.g. onUnauthorized) injected at boot to break the api↔auth↔router cycle
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

**Module dependency rule (cycle prevention):** `lib/api.ts` does NOT import from `lib/auth.svelte.ts` or `lib/router.svelte.ts`. Instead, `lib/events.ts` (plain `.ts` — no runes, so no `.svelte.ts` extension) exports a tiny callback registry (`onUnauthorized(cb)`, `emitUnauthorized(path)`); `main.ts` wires `events.onUnauthorized` to `(path) => { clearSession(); router.navigate('/login?next=' + safeNext(path)); }` at boot. `api.ts` calls `events.emitUnauthorized(currentPath)` on 401. This breaks the api↔auth↔router cycle that ESM partial-init would otherwise expose.

**Pre-wire safety:** `events.ts` initialises with a default no-op listener that, in dev (`import.meta.env.DEV`), `console.error`s `'events.onUnauthorized fired before main.ts wired it'`. This catches the brief window between module side-effects and `main.ts`'s wiring step. In prod the default is a silent no-op (avoids leaking diagnostics into production logs).

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

- On every route change (path-level, not hash-level), if the route requires auth and `session.user === null`, navigate to `/login?next=<encoded path+search+hash>`. **Hash is preserved** so `/courses/foo/seq/12#item=87` resumes correctly after login.
- On successful login, read `next` from the query string and navigate there. **`next` is validated as same-origin** using the URL constructor — `new URL(next, location.origin)`; if `result.origin !== location.origin` OR if it raises (malformed input, decoded `javascript:`, backslash variants), fall back to `/courses`.

### Backend errors

| Status | Behavior |
|---|---|
| 401 | `lib/api.ts` calls `events.emitUnauthorized(currentPath)` (UNLESS request was made with `{ skipAuthRedirect: true }` — used by `bootstrapSession`). The wired handler clears `session.user` and navigates to `/login?next=...` (with hash preserved). |
| 403 | Page-level inline panel ("You don't have access to this course"). No redirect. **`SequencePlayer`'s coverage tracker silently stops on 403 from `/track`** (e.g., admin archived the version mid-session) — the toast path is suppressed for that case to avoid a 15 s repeat. |
| 404 | Page-level inline panel. **`/api/courses/:slug/my-version` returns the same `{detail:"Not found"}` for both "course doesn't exist" and "user not enrolled" — the spec previously claimed UI could distinguish; it cannot from one request. The CourseView 404 panel uses one neutral message: "This course isn't available to you. Ask your teacher for an invite link, or check the URL."** |
| 409 | Page-level inline panel. Known strings to map: `"Max attempts reached"` (quiz submit retry past cap), `"Quiz has no questions"` (admin error — should already be guarded by §7 empty-state). |
| 422 | FastAPI returns `detail: ValidationError[]` (an array). `ApiError.detail` is typed as `string \| ValidationErrorDetail[]`. Forms call `e.validationErrors()` and render per-field inline errors; non-form contexts call `e.displayMessage` (always-string) and toast. |
| 429 | Rate-limit (e.g., `request-pin` is capped at `max_pin_requests_per_hour=3`). **Form-level inline message**: "Too many attempts. Please try again later." Do NOT lump into 5xx/toast bucket. |
| 5xx / network | Toast (top-right, auto-dismiss 5 s) using `e.displayMessage`. |
| `error_code` (forward-compat) | Page-level inline panel using a code → friendly-message map. **Note:** in slice 1 no endpoint actually returns `error_code` (only bulk-roster endpoints do). The map is forward-compatible scaffolding; keep it minimal. |

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

  // Always-stringified human message — useful in toasts and panels.
  get displayMessage(): string {
    return typeof this.detail === 'string' ? this.detail : 'Please correct the highlighted fields.';
  }

  // Form consumers call this to render per-field errors; returns null when not a 422.
  validationErrors(): ValidationErrorDetail[] | null {
    return Array.isArray(this.detail) ? this.detail : null;
  }
}

type RequestOpts = RequestInit & { skipAuthRedirect?: boolean };

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { skipAuthRedirect, headers: callerHeaders, ...init } = opts;
  // Build headers via the Headers class so X-Requested-With is set LAST and
  // therefore wins over any caller-provided value (a regression in the previous
  // revision had the spread order reversed). Caller headers are still
  // honored for everything else (e.g. Content-Type).
  const headers = new Headers(callerHeaders ?? {});
  headers.set('X-Requested-With', 'mathion');

  const res = await fetch(path, { credentials: 'include', ...init, headers });

  if (res.status === 401 && !skipAuthRedirect) {
    // Preserve hash so e.g. `/courses/foo/seq/12#item=87` survives the login bounce.
    events.emitUnauthorized(location.pathname + location.search + location.hash);
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
| `currentCourse.svelte.ts` | `{ slug, versionId, course, version, blocks } \| null` | `loadCourse(slug)`, `clearCourse()`, `markItemCovered(itemId)` | In-tab cache so navigating CourseView ↔ SequencePlayer doesn't refetch. Cleared on logout (wired in `main.ts`). Not persisted to `localStorage` (avoids stale data after admin edits). **`SequencePlayer` calls `loadCourse(slug)` if the cache is empty or the slug doesn't match — direct URL entry / refresh / bookmark always works.** **Single-flight + abortable**: keep an in-flight `Promise` keyed by slug; reuse it if a second call comes in for the same slug; if a call comes in for a *different* slug, abort the previous via `AbortController` and start the new one. Prevents mount/unmount/remount races from swapping cached data. |
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
| `SequencePlayer.svelte` | **Always calls `currentCourse.loadCourse(slug)` if the cache is empty or the slug doesn't match** (handles direct URL entry, refresh, bookmark). `POST /api/items/:id/track` for time-spent + coverage. Hash item changes do not refetch. **Initial item resolution**: if URL hash is `#item=<id>` and the id exists in this sequence, use it; otherwise fall back to the most recently visited item in this sequence (derived from `state.items[].last_visited_at` — backend's `current_item_id` is always `None` and cannot be used); otherwise use the first item. | top item strip + `ItemRouter` + bottom prev/next. Empty state for sequence with zero items: "This sequence has no items yet." |
| `NotFound.svelte` | nothing | static |

### Course components

| Component | Responsibility |
|---|---|
| `CourseCard.svelte` | Course title + version + progress bar (`covered_items / total_items`) + "Continue" link to `/courses/:slug` |
| `BlockGroup.svelte` | One block: title, `info_html` (rendered between the title and the sequence list — wrapped in `{#if block.info_html}` so empty values produce no padding/wrapper element), collapsible list of `SequenceLink`. **Default state: expanded** (closed only if user explicitly collapsed in this tab; not persisted). |
| `SequenceLink.svelte` | One row: title, item count, **coverage indicator = small "n / total" text + check mark when n === total**, link to player. |
| `ItemIcon.svelte` | One icon in the sequence-player strip; props: `{ type, state, title, onclick }` (callback prop, not event). Coverage state via background color: covered / current / not-yet. Title shown on hover. |

### Item viewers

`ItemRouter.svelte` dispatches by `item.type` using a typed discriminated union over the **full backend `Item.type` union** (`static_page`, `video`, `quiz`, `mini_project`, `interactive_app`). For non-slice-1 types it renders `<UnsupportedItem type={item.type} />` — a small placeholder component showing "This item type isn't available in this view yet." The exhaustiveness check is satisfied (no fallthrough), and future slices replace the placeholder branch with a real component without touching the union or the dispatch logic.

| Component | Notes |
|---|---|
| `PageItem.svelte` | Renders `{@html item.content_html}` (sanitized server-side at write-time). Coverage timer comes from `lib/coverage.svelte.ts` (`createCoverageTracker(itemId, { type: 'static_page' })`) — the timer accrues active time from `performance.now()` deltas while `document.visibilityState === 'visible'`, NOT by interval count. Each `/track` POST is **clamped to ≤ 60 s of `time_spent`** so a tab returning after a long absence doesn't post a single huge value (well under the backend's 86400 cap; also prevents anomalous "10-hour reading session" spikes). On `403` from `/track` — e.g., admin archived the version mid-session — the tracker **silently stops** for the rest of the page lifetime; no toast. At 30 s accumulated active time → `track(is_covered=true)`. **Trust boundary note**: `{@html ...}` is safe ONLY because the backend pre-sanitises with `bleach`. Any future content source (math rendering, draft preview, imports) MUST pass through the same sanitiser. |
| `VideoItem.svelte` | `<iframe>` embed. Explicit "Mark as watched" button is the covered trigger. Documented compromise. |
| `QuizItem.svelte` | Renders all questions, single Submit button. **Special case**: if the quiz has zero questions, render "This quiz has no questions yet." and hide Submit (matches backend `409 "Quiz has no questions"` so we never attempt the call). **Submit is disabled until every question has an answer.** Single-flight via **promise reuse, not just `disabled`**: a `let inflight: Promise<...> \| null = $state(null)` guards re-entry — if Submit is clicked again while `inflight` is set, the existing promise is reused. This closes the race window between `$state` batching and the user double-clicking. On success: shows aggregate `{score_correct} / {score_total}` and "Try again" button if `attempt_count < max_quiz_attempts`. **"Try again" CLEARS the answer state** (fresh attempt — simpler state machine and cleaner UX expectation). **Per-question correctness is NOT shown after each submit** — backend `POST /api/items/:id/submit` returns aggregate only. Per-question reveal becomes available only after all attempts are exhausted (backend `GET /api/items/:id/reveal` returns 403 until then). When attempts are exhausted, render a "Show correct answers" link that fetches `/reveal`. On submit failure (5xx / network): keep answers in state, surface a toast (`e.displayMessage`), allow retry. Quiz coverage is set on first successful submit (any score). |

### Quiz subcomponents (one per backend question type)

```
components/items/quiz/
├── SingleChoiceQuestion.svelte    # radio buttons; backend type "single_choice"
├── MultiChoiceQuestion.svelte     # checkboxes;   backend type "multiple_choice"
├── NumericQuestion.svelte         # <input type=number>; backend type "numeric_answer"
└── TextQuestion.svelte            # <input type=text>;   backend type "text_answer"
```

Each takes a callback prop `onanswer={(ans) => ...}` and calls it on every change. `QuizItem` collects answers in a `$state` map keyed by question_id and submits.

**Numeric questions, V1 limitation:** `precision` and `unit` fields exist on the backend `Question` model but are NOT exposed in the `/api/versions/:id/content` payload at slice 1 — they only appear in the `/reveal` payload. Frontend numeric input is therefore tolerance-blind on the UI side (no decimal-separator hint, no unit suffix) — the backend still scores correctly using its stored `precision`. If the user finds this insufficient in practice, exposing `precision`/`unit` in `/content` is a small follow-up.

**Quiz state types (mirroring backend wire shape):**
- `state.items[].last_answers` is `Record<string, number[] | string> | null` (keys are question_ids as strings; values are option-id arrays for choice questions or strings for numeric/text).
- Submit request body: `{ answers: Record<string, number[] | string> }` — must contain every question_id in the quiz.
- Submit response: `{ item_id, attempt_count, max_attempts, score_correct, score_total, can_retry }`.

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

**Lifecycle requirements** (must be in implementation):
- `start()` is **idempotent** — re-calling it (e.g., due to `$effect` re-run on reactive deps) doesn't double-attach `visibilitychange` listeners or reset accumulated time.
- `stop()` removes the `visibilitychange` listener, cancels the 15 s POST interval, and flushes any pending `time_spent` delta in a final POST.
- Consumers wire start/stop via `$effect`'s **cleanup return** (`$effect(() => { tracker.start(); return () => tracker.stop(); })`) — NOT via Svelte 4's `onMount`/`onDestroy`.
- Each `track()` POST is clamped to ≤ 60 s of `time_spent` per call (see PageItem note).
- Test seam: `createCoverageTracker(itemId, { now?, postTrack? })` accepts optional `now` (clock injection) and `postTrack` (transport override) so unit tests can advance time and assert POST payloads without a real clock or network.

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
from pathlib import Path
from fastapi.staticfiles import StaticFiles

# Conditional mount: only attach when the build artifact exists. Otherwise
# StaticFiles(html=True) raises at init when the directory is missing —
# which would break every backend test before a frontend build has run,
# and break `uvicorn` startup in pure-backend dev. The check happens once
# at import time; in production deploys the dist directory always exists.
if Path(settings.frontend_dist).is_dir():
    app.mount(
        "/",
        StaticFiles(directory=settings.frontend_dist, html=True, check_dir=False),
        name="spa",
    )
```

Plus a new setting in `mathion/config.py`:

```python
frontend_dist: str = "../frontend/dist"   # overridable via MATHION_FRONTEND_DIST
```

The `html=True` flag makes any unmatched non-`/api/*` path serve `index.html`, giving SPA history-routing fallback for free. Routes registered before the mount (`/api/*`, `/health`, `/assets/...`) are unaffected — they keep returning JSON / file content.

**Important caveat (from review):** with the SPA mount in place, an unknown `/api/foo` no longer reaches the catch-all SPA fallback — FastAPI's router-matching exhausts before the mount is consulted, and unmatched `/api/*` paths return JSON 404 from FastAPI. That's the desired behavior; documenting so a future contributor doesn't add a routes-vs-mount catch-all by mistake.

Tests:
- `/health` still works (router match, no SPA).
- `/api/courses/missing/my-version` still returns JSON 404 (router match → 404, not SPA fallback).
- `/courses/some-deep-spa-path` returns `index.html` with status 200 (SPA fallback).
- Backend tests run cleanly without a frontend build (the conditional mount means missing `dist/` is fine).

**A2 — `Block.info_html` column with write-time rendering.**

Add a sibling `info_html` column to `Block` (matches `CourseVersion.info_html` and `Item.content_html` pattern). **Both `info` (raw markdown) and `info_html` (rendered HTML) ship in `/content`** — the raw `info` stays so admin/editor flows can edit. Frontend reads `info_html`; admin will read `info` later.

Concrete steps:

1. **Model**: add `info_html: Mapped[str] = mapped_column(Text, nullable=False, default="")` to `Block` in `mathion/models.py` (next to existing `info` column).
2. **Alembic migration** (Python data migration, NOT raw SQL — needs to call `render_with_assets`):
   - `op.add_column('blocks', sa.Column('info_html', sa.Text(), nullable=True))`
   - Data migration: iterate rows, render each `info` to HTML using the existing helper `mathion.api.helpers.render_with_assets(db, block.version_id, block.info)` (asset-aware to match the `CourseVersion.info_html` and `Item.content_html` pattern), write to `info_html`. Empty `info` → empty `info_html`.
   - `op.alter_column('blocks', 'info_html', nullable=False, server_default='')`.
3. **Write paths in `mathion/api/blocks.py`**:
   - `:53` (create endpoint): after setting `block.info = data.info`, also set `block.info_html = render_with_assets(db, version_id, data.info)` and call `sync_asset_references(db, ...)` to register asset refs (matches the existing pattern in `versions.py:82,212` and item write paths).
   - `:96` (update endpoint): same — re-render on every PATCH that touches `info`.
4. **Read path**: `mathion/api/content.py:_serialize_block` adds `"info_html": block.info_html` to the returned dict (keep existing `"info": block.info` too — ambiguity in the previous draft is resolved: ship both).
5. **Tests**: write a block with markdown including an asset reference (`![alt](/assets/.../foo.png)`), read back via `/content`, assert `info_html` contains the rewritten asset URL. Migration roundtrip: existing block with `info="hello **world**"` → `info_html="<p>hello <strong>world</strong></p>"` after upgrade.

This finally lands the Phase 6 deferred item ("`Block.info` has no `info_html` field") using the existing asset-aware rendering — consistent with how `CourseVersion.info_html` and `Item.content_html` already work.

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

- `lib/api.ts`, `lib/auth.svelte.ts`, `lib/router.svelte.ts`, `lib/stores/session.svelte.ts`, `lib/events.ts`, `lib/coverage.svelte.ts` are reusable foundations — built once, not re-invented.
- `components/ui/` primitives (Button, Input, FormRow, Spinner, Toast) are shared across all slices.
- Style variables in `base.css` are the theming surface — design polish lands once and applies everywhere.
- The route table grows; the router code does not.
- `ItemRouter`'s discriminated union covers all backend `Item.type` values; future slices replace the `<UnsupportedItem>` placeholder branches with real components without restructuring.

When the next slice is brainstormed, only its slice-specific pages, components, and any new endpoints need fresh design.
