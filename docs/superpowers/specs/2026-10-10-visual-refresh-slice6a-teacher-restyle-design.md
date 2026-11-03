# Visual refresh — Slice 6a: the teacher screens, restyled (runs lists, run frame, six tabs)

**Status:** rev 5. Written 2026-10-10 for the user's review; rev 4 approved.
- Rev 2 folded in round 1 of the spec review (Opus code angle, Opus design angle, Fable second opinion).
- Rev 3 folds in round 2 (fresh Opus, fresh Fable) and the user's answers on R3, R9 and R10.
- Rev 4 folds in the rev 3 re-check (fresh Opus); its own re-check (Fable) found no Critical or Important, and its three minors are folded in.
- Review notes are in `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/spec-r*.md`.
- Rev 5 records the user's decisions in the 6a Safari pass (2026-10-11): R15 (one page width), the confirm rows in R14 and §Mini-projects, P19 kept, and one CSV button style.

**Branch:** `feat/visual-refresh-slice6-teacher`, cut from `feat/visual-refresh-slice5-authoring` at `65bcea2`. It stays local: no push, no merge.

**Authority:**
- The design handoff `docs/design/visual-refresh/` (`mathion-visual-spec.md`, `reference-screens.dc.html`) is the design authority. Its screens 10e, 2d, 9a, 10c, 10d, 10j and 10i are the 6a screens. Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/*.png`.
- The user walked through every teacher screen on 2026-10-10 and approved all of them "as drawn". The walkthrough and every decision are in `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/walkthrough.md`.
- `file:line` references are to the code at `65bcea2`.
- Where this spec is silent, the handoff's §1–§4 hold, and earlier slices' conventions hold: tokens only, no emoji, no literal colours.

## Why

The teacher screens were never restyled. The user, on the runs list: "looks like it has no design at all". Slice 6 brings the 14 teacher screens to the design. It is split in three (user, 2026-10-10):
- **6a (this spec):** the restyle, plus the navigation fix.
- **6b:** the four modals move onto the shared `ui/Modal` (New run, Publish conflicts, Import roster, Mini-project editor).
- **6c:** the behaviour-heavy screens: the Overview tab, the Roster tab, and the side panel (grading and the progress breakdown).

**Between 6a and 6c the look is mixed, and that is expected.** The new frame and six restyled tabs sit next to the old Overview and Roster tabs, the old modals and the old side panel. The Publish bar sits in the title row and moves again in 6c. The 6a browser pass does not log these as defects.

## Decisions

The user's (2026-10-10):
- **D1 — Restyle plus named pain points** (option B). The drawings are the target; behaviour changes only where a decision below says so.
- **D2 — Split S6 into 6a / 6b / 6c** as above.
- **D3 — Runs belong to Teaching, for everyone.**
  - Every run page and runs list lives under `/teaching` and lights the "Teaching" pill.
  - The breadcrumb is Teaching / Course / Run.
  - Course admins get the Teaching pill too. Their Teaching list includes the runs of the courses they administer.
  - Old `/courses/:slug/runs…` links forward to the new addresses.
  - This needs one small backend change (§Backend change), which the user was told about.
- **D4 — No ✎ on run rows.** The run title opens the run; title and dates are edited on Overview. 🗑 stays.
- **D5 — Nothing that works today is dropped** (stated to the user; no objection).
  - The drawings omit many working features: banners, empty states, Refresh, filters, retry paths and others. Each is kept and restyled in the same visual language. §Keep lists them per screen.
  - The only deliberate removals are named: R3, R6, R7, R8, and the Teaching list's summary sentence (§`/teaching`).
- **D6 — Mini-projects are shown by their block's title** wherever 6a shows a mini-project. The model has no mini-project title column. The drawn names ("Matrix explorer") are not real.
- **D7 — Teacher avatars are the drawn silhouette only.** There is no photo field.
- **D8 — Version numbers are the version id, written "v. N"** (the user's choice over "vN" as drawn and over today's rank; 2026-10-10). See R3.
- **D9 — Superusers see every run on the Teaching list** (the user's choice, 2026-10-10). This reverses the 2026-05-29 teacher-monitoring decision "There is NO superuser bypass" (`docs/superpowers/specs/2026-05-29-teacher-monitoring-slice-a-design.md:291`) and its test. See R9.
- **D10 — Leaving a tab with a half-written grade asks first** (the user's choice over switching silently, 2026-10-10). See R10.

Rulings taken at the controller's discretion (technical; the user defers these). Each states what it costs if wrong:
- **R1 — The open tab lives in the address** (`?tab=…`), so a reload keeps the tab. Switching tabs replaces the history entry; it does not push one. Back leaves the run page, and coming back restores the tab. *Cost if wrong:* the user wanted Back to step through tabs; that is a one-line change (push instead of replace).
- **R2 — Tab order and names as drawn:** Overview, Progress, Submissions, Roster, Groups, Mini-projects, Assets, Teachers. "Submission" becomes "Submissions".
- **R3 — Version numbers become the version id** (confirmed by the user as D8).
  - Today both the runs list and the run page show the version's *rank* by creation date, plus its date: "v2 (2026-02-04)" (`RunListPage.svelte:22-30`, `RunDetailPage.svelte:186-192`).
  - 6a shows the version **id** as "v. N", as the 5c editor does (`VersionsPage.svelte:236`). One number now means the same version everywhere. A teacher's rank was computed from the pinned versions only and differed from the admin's, and the admin's rank was computed from one page of a paginated list (`versions.py:198-204`). The date is dropped.
  - *Cost if wrong:* a run that showed "v2" now shows "v. 17"; this is visible, not data-changing.
- **R4 — Delete is a trash glyph everywhere.** The drawings use a red × for delete in 10i and 10j. 6a uses the same trash as 10e, 10c, 10d and the 5c editor.
- **R5 — Disabled-with-reason vs read-only on teacher screens.**
  - Follows the handoff §4: an action blocked for *this row* or *right now* renders disabled, with the reason in `title`.
  - When a force delete needs a right the user lacks, the panel opens and its Force delete is disabled with the reason (handoff §4 Confirm-then-act). This applies to both Mini-projects and Assets.
  - A *whole surface* a role cannot change is rendered read-only, without the controls (as drawn in 10d's teacher view): Teachers for non-admins; + and 🗑 on runs lists for non-admins.
  - This differs from 5c's D13 (hide what the version forbids). D13 governs the authoring constructor, not these screens.
- **R6 — The runs list drops its "Open" row link** (`RunListPage.svelte:122`). The title is the link (as drawn), so the second link to the same place goes.
- **R7 — One version-disabled banner.**
  - The frame shows it once, under the title row. Progress (`RunProgressTab.svelte:287-289`) and Mini-projects (`RunMiniProjectsTab.svelte:191-197`) no longer repeat the same sentence.
  - Each keeps only its own extra clause as one `--muted` line at the top of the tab, shown while the version is disabled:
    - Progress: "Coverage data reflects last-known state." (today's text);
    - Mini-projects, for admins only: "See Overview", a link through `setTab` (today it is admin-only, `RunMiniProjectsTab.svelte:198-204`). Non-admins get no line.
- **R8 — The Submissions column header drops "N groups".** Today: "N groups · a awaiting · b revision · c rejected" (`RunSubmissionTab.svelte:134-140`). As drawn: "B2 · a awaiting · b revision · c rejected", with zero parts omitted, as today. The rows already show the groups.
- **R9 — Superusers see every run on the Teaching list** (confirmed by the user as D9).
  - A superuser already gets the Authoring pill and is a course admin of every course in `by-slug` (`courses.py:84-86`, `auth.py:30`). So they get the Teaching pill under D3 too.
  - Without a bypass, their Teaching list would always be empty. The teaching endpoint gains the same superuser bypass the rest of the admin surface has.
  - *Cost if wrong:* a busy install shows a superuser a long list (the status filter keeps it usable).
- **R10 — Leaving a tab with unsaved work asks first** (confirmed by the user as D10).
  - A `?tab` change is a navigation, so the registered unsaved-changes guards run (`router.svelte.ts:88-112`). Today a tab click silently drops a half-written evaluation in the side panel (`DashboardSidePanel.svelte:770` mounts a `DirtyGuard`). After 6a it asks "Discard unsaved changes and continue?".
  - Cancelling keeps the tab and the address.
  - This is intended.
- **R12 — Mini-project deadlines keep their time and zone.** 10j draws "soft 07 Aug". 6a shows "soft 07 Aug 23:59", with the zone in the column header or each part's `title` (§Mini-projects). D5 forbids dropping the time; for a hard deadline it matters. *Cost if wrong:* a wider Deadlines column.
- **R13 — Block and sequence numbers follow list position, not the stored `order`.**
  - "B{n}" (Progress, Submissions) and "Block {n}" (Mini-projects, Assets' "used by") use the block's 1-based position in the pinned version's `blocks` list.
  - "S{n}" (Progress) is the sequence's 1-based position within its block, among that block's sequences in the Progress payload. Those are all the block's sequences, because the payload lists every sequence of the version.
  - The stored `order` keeps gaps after a delete. The student view and the editor already number by position (commit `5c73890`).
  - The dashboard payloads hold only some blocks (Progress: blocks with sequences; Submissions: blocks with mini-projects), so the number is taken from `blocks`, not from the payload. `RunDetailPage` passes `blocks` to Progress, Submissions and Assets, as it already does to Mini-projects.
  - If a block is not in `blocks` (e.g. `blocks` is empty because the pinned version was not found, `RunDetailPage.svelte:86-95`), the "B{n} · " / "Block {n} — " prefix is omitted and the title alone is shown.
  - This closes the 5c backlog item "Teacher run screens still label blocks 'Block {order}'" (`docs/backlog/slice5c-constructor-polish-debt.md:158-161`) for these screens. `MiniProjectModal` follows in 6b.
- **R14 — The Assets "used by" sub-panel and the danger panel render under their row**, as a full-width row inserted after it.
  - The sub-panel is already such a row (`RunAssetsTab.svelte:831-835`). The danger panel today sits inside the actions cell (`:773-814`); moving it to a full-width row is a change, because the panel's text and checkbox do not fit a narrow cell.
  - The Replace confirm (T11) and the plain single-row delete confirm for an unreferenced asset (Safari pass) are full-width rows under their row too. The plain one keeps its question and buttons on one line (`InlineConfirm`'s `row` layout).
  - A row has at most one panel under it: any delete or Replace confirm and the "used by" sub-panel close each other.
  - 10i draws both under the table, but with many files that puts them far from the row they act on. *Cost if wrong:* a position change.
- **R15 — One page width for the whole site (Safari pass, user 2026-10-11).** Every page column — student, authoring, teaching, NotFound — is `max-width: var(--page-max)` (1140px: the teacher drawings' content, 1180 artboard minus 20px gutters), centred. 960px came from the first frontend commit, not from a design.
  - The header bar keeps its full-width background; its nav row sits in the same column, so the logo and Logout line up with the page edges.
  - The mini-project page sits in the same column, its text in a 760px column at the left. The quiz and page items keep their 652px reading measure (the reference's 68ch at its 16px base, written in px on purpose; §(g) of the gate).
  - Outside the shared column on purpose: Login (a centred 380px card) and the superuser shell (its own header, full-width `.su-main`). *(2026-11-03, user, Safari pass step 13d: the superuser shell now sits in the shared column, with a bar in AppHeader's look and no links, and white stat cards; only Login stays outside.)*
- **R11 — Inline name edits on the Groups tab register no unsaved-changes guard** (none do today). An open add or rename field is dropped without asking when the tab changes. That keeps tab switching cheap, and the text is one short name.

## Scope

**In 6a:**
- `pages/teaching/TeacherRunListPage.svelte` — the Teaching list (`/teaching`), restyled like 10e. It has no drawing of its own.
- `pages/runs/RunListPage.svelte` — one course's runs (10e).
- `pages/runs/RunDetailPage.svelte` — the run frame: breadcrumb, title row, meta line, the existing publish bar, the version-disabled banner, the tab strip, tab-in-address.
- Tabs: `RunProgressTab` (2d), `RunSubmissionTab` (9a), `RunGroupsTab` (10c), `RunTeachersTab` (10d), `RunMiniProjectsTab` (10j), `RunAssetsTab` (10i).
- Routes, redirects, the header pill (`components/chrome/AppHeader.svelte`), and every in-app link to a run page — including the one-line link edits in files otherwise left for later (§Links).
- Shared pieces (§Shared pieces).
- One backend change (§Backend change).

**Not in 6a.** These keep their layout and behaviour; 6a changes only the link lines and tab-jump calls named in §Links and §The tab in the address.
- **6b:** `NewRunModal`, `PublishConflictsModal`, `RosterImportModal`, `MiniProjectModal`.
- **6c:**
  - `RunOverviewTab` (incl. moving Publish into the readiness card, run force delete, per-field editing);
  - `RunRosterTab`;
  - `DashboardSidePanel` and `SubmissionThreadEntry`.

  Until then, the publish bar stays in the run frame's title row (§The run frame).
- **Never in Slice 6:**
  - mini-project titles;
  - profile photos;
  - changing the 10-student group cap;
  - making the feedback file optional (the user kept it required, 2026-10-10);
  - a total column or summary row on Progress;
  - arrow-key navigation in the tab strip.

## Navigation and addresses (D3, R1, R2)

### Routes

| Address | Component | Notes |
|---|---|---|
| `/teaching` | `TeacherRunListPage` | all runs you teach or administer |
| `/teaching/:courseSlug` | `RunListPage` | one course's runs |
| `/teaching/:courseSlug/runs/:runId` | `RunDetailPage` | the run; `?tab=` selects the tab |
| `/courses/:courseSlug/runs` | `RunsRedirect` | → `/teaching/:courseSlug` |
| `/courses/:courseSlug/runs/:runId` | `RunsRedirect` | → `/teaching/:courseSlug/runs/:runId` |

- **Redirects.**
  - Both old routes stay in `routes.ts` with `auth: true`, so a signed-out bookmark still goes through login with `next` (`App.svelte:53-58`).
  - They map to one small component, `pages/runs/RunsRedirect.svelte`. In an `$effect` that tracks only its params and `session.user`, it calls `navigate(newPath + search + hash, { replace: true })`. It reads `search` and `hash` and calls `navigate` inside `untrack`, so the effect depends only on its params and `session.user`. It renders nothing, and makes no fetch.
  - **It does nothing while `session.user` is null.** App owns the signed-out case: it sends the visitor to login with `next`, and after login `next` brings back the old address, where the redirect runs. While the session is still loading, App mounts no routed component (`App.svelte:66`), so the redirect cannot run early. Without this guard, the redirect could read the login's `?next=…` and move the page off `/login`.
  - `newPath` re-encodes `courseSlug` with `encodeURIComponent` (`matchPattern` decodes it, `router.svelte.ts:196`).
  - Removing the routes and redirecting from App would show NotFound first, so it is not done.
- **Route matching** has no conflict: patterns match only paths with the same number of segments (`router.svelte.ts:191`).

### Links

Every in-app link to a run list or run page uses the new addresses:
- `CourseCard.svelte:9` (the course card's "Runs" link);
- `RunListPage` rows;
- `TeacherRunListPage` rows;
- the run breadcrumb;
- `NewRunModal.svelte:57`: after create, it navigates to the new run. This one line changes in 6a.
- `RunDetailPage.svelte:276` (`onDeleteRun`, back to the list after a delete). This one line changes in 6a.
- Any other builder of `/courses/…/runs…` under `src/` outside `/api/` paths, found by grep in the plan.

API paths (`lib/runs.ts:7,15` and others) are not page links and are untouched. Existing tests that assert old page addresses are updated (the plan lists them), and so is `AppHeader.svelte.test.ts:89`, which asserts that an admin has no Teaching pill.

### The header pill (`AppHeader.svelte:10-38`)

- "Teaching" renders when `has_run_teacher || has_course_admin`. Today it needs `has_run_teacher`. `has_course_admin` is already true for superusers (`auth.py:30`); with R9 their list is not empty.
- "Teaching" is active on `/teaching` and everything under it (unchanged rule; the run pages now live there).
- "Authoring" is active on `/courses…` (unchanged). Run pages no longer match it. No pill flashes on a redirect: the pill follows `currentRoute.path`, and the redirect replaces it before the next paint.
- `defaultLandingPath` is unchanged: admins still land on `/courses`.

### The breadcrumb

- **On a run page:** Teaching › Course name › Run title.
  - "Teaching" links to `/teaching`; the course name links to `/teaching/:courseSlug`.
  - The run title is plain text with `aria-current="page"`.
- **On `/teaching/:courseSlug`:** Teaching › Course name (`aria-current="page"`).
- **Markup:** `<nav aria-label="Breadcrumb">`. The separators are the drawn "/" in `--faint`, `aria-hidden="true"`.
- Today's admin breadcrumb (Courses › Course › Runs › Run, `RunDetailPage.svelte:326-336`) goes away. The Authoring side still reaches runs through the course card's Runs link, now pointing to `/teaching/:courseSlug`.

### The tab in the address (R1, R10)

- Tab keys: `overview`, `progress`, `submissions`, `roster`, `groups`, `mini-projects`, `assets`, `teachers`.
  - The `ActiveTab` type changes `submission` → `submissions`. `RunRosterTab.svelte:14` imports it.
- **One source of truth.**
  - `activeTab` becomes `$derived(parseTab(currentRoute.search))`. No `?tab`, or an unknown value, gives `overview`. The tab strip's `aria-selected` and the rendered panel follow it.
  - The run-change effect (`RunDetailPage.svelte:165-172`) no longer sets `activeTab`. Its other resets stay: prefilter, import modal, publish modal, conflicts.
  - The load effect (`:159-163`) never reads `currentRoute`, so a search-only change does not reload the run. `App.svelte:36` derives the matched route from the path only, so the page is not remounted either.
- **An unknown `?tab`:** the page rewrites the address once, with `replace`, dropping only `tab`. Other search parameters and the hash are kept. A missing `?tab` is not rewritten.
- **One helper for every switch:** `setTab(tab, extras?)`.
  - It calls `navigate(path + newSearch + hash, { replace: true })` and awaits it.
  - Only if `currentRoute` then shows the new tab does it apply `extras`: `rosterPrefilter`, `pendingEditTarget`. If a guard cancelled the switch, the extras are dropped. That avoids an edit modal opening later on an unrelated tab.
- **Every tab jump goes through `setTab`:**
  - the tab buttons;
  - `gotoTab` (`RunDetailPage.svelte:174`, used by Overview's readiness hints);
  - Roster's `onNavigateToTab` (`:422`, `RunRosterTab.svelte:390`);
  - Mini-projects' `onNavigateToTab` (`:453`), its banner links (`RunMiniProjectsTab.svelte:193,201,209`) and the copy passed into `MiniProjectModal` (`:322`);
  - Assets' "Edit" jump that sets `pendingEditTarget` (`:467`);
  - the Groups-disabled card's "Overview" link (§Groups).
- **After a jump from inside a panel** (a link or button that unmounts with the panel), focus moves to the newly active tab button. After a click on a tab button, focus stays on that button.
- Changing the run (a different `:runId`) still resets the page's per-run state. The tab comes from the address.

## The run frame (`RunDetailPage`)

As drawn in 10a–10j (all share it):
- **Breadcrumb** (§The breadcrumb).
- **Title row:**
  - the run title as the page `<h1>`;
  - the run status chip (§Run status chip);
  - a mono `--muted` meta line: "42 students · 8 groups · v. 17". Singulars: "1 student", "1 group". "· N groups" is shown only when groups are enabled. "v. N" is the pinned version's id (R3).
  - The counts come from data the page already loads (`students`, `groups`, `run.version_id`); there are no new fetches.
- **Publish bar:**
  - Today's Publish / Unpublish / InlineConfirm, unchanged in behaviour (`RunDetailPage.svelte:346-368`).
  - Restyled with `Button`, and placed at the right end of the title row.
  - 6c moves Publish into Overview's readiness card.
- **The version-disabled banner** (`:371-379`): shown once (R7), under the title row, as a warning precondition banner. Its tokens are `--status-needs-revision-bg` with a 3px `--gold` left rule (handoff §4). Both texts (admin / teacher) stay.
- **The tab strip:**
  - `role="tablist"` with `role="tab"` buttons, each with an `id` and `aria-selected`;
  - the panel is `role="tabpanel"` with `aria-labelledby` set to the active tab's id;
  - R2 order and names;
  - the drawn underline style: the active tab gets `--text` and a 2px `--primary` underline, inactive tabs `--muted`. Each tab is a button reachable with Tab.
- **Loading and errors:** the existing "Invalid run.", the load error and `LoadingPlaceholder` ("Loading run…") are kept. Errors use `ErrorState` (as the 5c/5d pages do), with a link back to `/teaching`.

### Run status chip

One small shared chip for run status, used on the run frame and both runs lists:

| Status (key) | Label | Tokens |
|---|---|---|
| `active` | active | `--status-awaiting-eval-bg / -fg` |
| `upcoming` | upcoming | `--primary-soft` / `--primary` |
| `ended` | finished | `--state-archived-bg / -fg` |
| `draft` | draft | `--state-created-bg / -fg` |

- The key `ended` stays internally (`lib/runStatus.ts`). Only the label changes, there and on the Teaching list's filter pills ("Finished").

### Chip and banner tokens used across 6a

| Element | Tokens |
|---|---|
| mini-project draft / published / locked | `--state-created-*` / `--state-published-*` / `--state-archived-*` |
| "disabled" and "invited" chips | `--state-disabled-*` |
| Uses > 0 / Uses = 0 | `--status-accepted-*` / `--status-not-submitted-*` |
| selected filter pill, selected segment | `--primary-soft` background, `--primary` text; unselected `--surface` with a `--border-strong` ring |
| info precondition banner (e.g. "require groups", run not published) | `--surface-2`, 3px `--primary` left rule |
| warning precondition banner (version disabled) | `--status-needs-revision-bg`, 3px `--gold` left rule |
| error banner (a failed delete or upload) | `--status-rejected-bg`, 3px `--danger` left rule, `role="alert"` |

Every chip's meaning is also in its text; colour is never the only signal.

## The runs lists

### `/teaching` (`TeacherRunListPage`)

- Page `<h1>` "Teaching". The existing status filter pills (Active / Upcoming / Finished / Draft / All; default Active) are restyled as filter pills with counts.
- The table is styled like 10e. Columns:
  - Title — links to the run;
  - Course — links to `/teaching/:courseSlug`;
  - Status chip;
  - Students (mono);
  - Start / End (mono, "01 Sep 2026").
- No row actions.
- Sorting is today's per-status ordering (unchanged).
- **Empty and error copy:**
  - With no runs at all: "No runs yet. Runs you teach or administer appear here." This replaces the teacher-only text at `:95-96`, which is false for admins after D3.
  - With runs but none for the selected pill: "No {label} runs.", with the pill's lowercase label ("No finished runs.").
  - Today that line also adds "You have N active, N upcoming, N ended, and N draft." (`:109-111`). That sentence goes: the pills now carry the counts.
  - The load error and its "Try again" button (`:92`) are kept, restyled with `ErrorState`.

### `/teaching/:courseSlug` (`RunListPage`)

The page first loads the course by slug (`/api/courses/by-slug`, as today). It answers for admins, superusers and teachers of the course; anyone else gets 403 (`courses.py:91-94`).

**Course admins** (`is_admin`, including superusers) see 10e:
- Breadcrumb Teaching › Course.
- `<h1>` "Runs", with a mono `--muted` count.
- **+ New run:** a 28px primary icon button titled "New run". It opens `NewRunModal` (unchanged until 6b, except §Links). When no version is published, it is disabled with today's reason.
- Columns:
  - Title (links to the run);
  - Status chip;
  - Version: "Label · v. N", with "v. N" mono `--muted` (R3). A version with an empty label shows "v. N" alone.
  - Start, End.
  - 🗑 per row (D4: no ✎; R6: no "Open" link).
- **🗑 per row:**
  - Enabled only for a draft run. That matches today's rule, which shows it only when `!is_published` (`:123`; `runStatus` is `draft` exactly then).
  - Otherwise it is disabled, titled "Only a draft run can be deleted". Today it is hidden.
  - Its `aria-label` is "Delete run {title}".
  - An enabled 🗑 opens today's inline confirm, restyled. What it sends, the "Run deleted." toast and the error toast (`:61-71`) are unchanged.
- The empty state "Create the first run" (`:95-105`) is kept.
- The footnote line under the table in 10e is a design note, not UI. It is not rendered.

**Teachers of the course who are not its admins** (`is_admin` false):
- Today they are sent away (`RunListPage.svelte:39-41`). In 6a they see a read-only list instead (R5): the runs of this course they teach, from `listTeachingRuns()` filtered by `course_id`.
- Breadcrumb Teaching › Course; `<h1>` "Runs".
- Columns: Title, Status, Students, Start, End. There is no Version column (the teacher payload has no version label), no + and no 🗑.

**Errors:**
- 404 → `ErrorState` "Course not found." with a link to `/teaching`. Today it links to `/courses` (`:52,77`).
- 403 (neither role) → `ErrorState` "You don't have access to this course's runs." with a link to `/teaching`. There is no breadcrumb, since the course name is unknown. Today a 403 bounces to `/courses/:slug` (`:53-54`).
- Other load errors → `ErrorState` with "Try again".

## The six tabs

Common to all six:
- A section header row: an `<h2>` title with a mono `--muted` count, and the section's primary action at the right (+ / + Upload). The `<h2>` has `tabindex="-1"`, so it can take focus as the last fallback (§Focus).
  - Progress and Submissions have no header row (P19, confirmed by the user in the Safari pass): as 2d and 9a draw, their toolbar sits straight under the tabs; neither has a primary action, and the tab names the panel.
- Tables use the handoff §4 table style:
  - header `--surface-2`, 12px/600 `--text-3`;
  - 1px `--border-soft` row separators;
  - 28px controls in rows.
- Icon buttons are 24px in rows and 28px for page-level actions.
- Every row icon button has an `aria-label` naming its row, e.g. "Rename Group A", "Delete group Group A", "Remove tomas@uni.edu", "Replace rubric.pdf", "Delete rubric.pdf", "Edit mini-project for Block 2". Its `title` is the short action ("Rename", "Delete") or, when it is disabled, the reason.
- Count words take their singular at 1: "1 use", "1 selected", "1 awaiting".

### Progress (2d, `RunProgressTab`)

- **Toolbar:**
  - Coverage / Quiz as a two-button segmented control (same state as today);
  - the group `<select>`, keeping "(Ungrouped)" and the "(disabled)" suffixes (`:305-309`);
  - search;
  - at the right:
    - the heat legend (§Heatmap);
    - ↻ Refresh as an icon button (`refresh` glyph, "Refresh"; today a text button, `:315`);
    - "Download CSV" as a secondary button.
- **Table (handoff §4 Tables):**
  - Student and Group columns sticky (already sticky; restyle only).
  - The existing block header row (`:325-336`) is restyled: "B1 · VECTORS", mono 10.5px uppercase `--muted`, spanning that block's sequences. The `B{n} ·` prefix (R13) is new.
  - Sequence headers "S1 Vectors": `S{n}` (R13) plus the title, from fields already in the payload (`lib/dashboards.ts:47-55`).
  - Cell values mono 11.5px.
  - The sort controls on Student, Group and sequences stay (today's sort).
- **Heatmap:**
  - Five steps replace the `hsl(120 * ratio)` sweep (`:190-201`). Cell background:

    | Ratio | Background |
    |---|---|
    | no data (the ratio is null; the cell shows "—", or "0/0" in Quiz mode with no questions) | none |
    | 0 | `--surface-muted` |
    | > 0 and ≤ 0.25 | `--heat-1` |
    | ≤ 0.5 | `--heat-2` |
    | ≤ 0.75 | `--heat-3` |
    | > 0.75 | `--heat-4` |

  - Text is always `--heat-fg`.
  - The legend: "0%", five swatches in that order, "100%". It is a `role="img"` with the name "Coverage scale, 0 to 100 percent" (or "Score scale, …" in Quiz mode).
  - Each cell keeps today's `aria-label` with its value (`cellAriaLabel`), so colour is not the only signal.
- **Disabled rows:**
  - Disabled students and students in disabled groups (`:353`): the name in italic `--muted`, plus a small "disabled" chip after the student's name (as drawn) or the group's name (`:360`).
  - Today's `.disabled-row { opacity: 0.55 }` and its hex fallbacks go.
- **Cell click** opens the existing side panel, unchanged (6c).
- **Keep (D5):**
  - R7's extra line, with today's text "Coverage data reflects last-known state." (`:288`);
  - "No sequences in this run." (`:320`);
  - "No students enrolled in this run." and "No matches for current filters." (`:375-377`);
  - the loading and error states.

### Submissions (9a, `RunSubmissionTab`)

- **Toolbar:** the group filter at the left; at the right, ↻ Refresh as an icon button (`refresh` glyph, title "Refresh") and "Download CSV" as a secondary text button, the same as Progress (Safari pass; 9a draws a ⤓ icon).
- **Grid:** groups down, mini-projects across.
  - **Column header line 1:** the block title (D6), e.g. "Matrices and transformations".
  - **Line 2,** mono `--muted`: "B2 · 3 awaiting · 1 revision · 1 rejected", with zero parts omitted (R8). "B2" is the block's position (R13).
    - When every in-scope group is "not submitted", it reads "B2 · no submissions".
    - When the parts are all zero but something was submitted (everything accepted), it reads just "B2".
  - **The column sort** on each mini-project (`:254`) and on Group stays.
- **Cells:**
  - A status badge per cell, with lowercase short labels: "accepted", "needs revision", "awaiting eval", "not submitted", "rejected".
  - The short labels are a new `STATUS_SHORT_LABEL` map in `lib/dashboards.ts`. `ui/StatusBadge.svelte` gains an optional `label` prop that overrides its text (default unchanged: `STATUS_LABEL`); Submissions passes the short label. The existing `STATUS_LABEL` ("Awaiting evaluation", …) stays for `DashboardSidePanel`, `SubmissionThreadEntry` (6c) and the cell `aria-label`.
  - The cell's `aria-label` names the group and the block title, not `mp.title` (`:275`).
  - "—" when the group is outside the mini-project's scope.
- **A disabled group:** its name in `--muted` with a "disabled" chip. Today's `.disabled-row` opacity rule (`:359`) goes.
- **Badge click** opens the existing side panel, unchanged (6c).
- **Keep (D5):** the groups-disabled and no-mini-projects empty states (`:214-218`); the loading and error states.
- The footnote under the drawing is a design note, not UI.

### Groups (10c, `RunGroupsTab`)

- **Header:** an `<h2>` "Groups" with the count. At the right, the add toggle (handoff §4 Collapsed forms):
  - closed: a + icon button (primary, 28px), titled "Add group", with `aria-expanded="false"`;
  - open: an × titled "Close", with `aria-expanded="true"`.
- **The add row.** Opening it shows an `InlineName` (label "New group name", maxlength 80) at the top of the list, focused.
  - Enter or ✓ adds.
  - Esc, ×, or the header toggle closes it and returns focus to the toggle.
  - The existing 409 text ("A group with that name already exists in this run.") and other errors show under the field.
  - On success the add row remounts its `InlineName` (`{#key}`), so the field is empty and focused again, for the next name.
- **Each group row:** the name, the capacity badge, then the action slot: ✎ ("Rename") and 🗑 ("Delete").
- **Renaming.** ✎ swaps the name for an `InlineName` (label "Group name", maxlength 80) with the current name.
  - The action slot becomes × then ✓, with ✓ where ✎ was (handoff §4 Inline field editing). The capacity badge stays.
  - Enter or ✓ saves. Esc or × cancels.
  - Saving an unchanged name closes the field without a request. An empty (trimmed) name keeps ✓ disabled. Today both silently revert (`:68-71`).
  - A failure keeps the field open, with the error under it. Today a failure resets the name and shows a toast.
  - Today's always-visible input that saves on blur (`:117-139`) and its per-group dirty trackers (`:37-46`) go. Nothing saves on blur.
- **One editor at a time.** Opening the add row or another rename closes the open one without saving (R11).
- **🗑:**
  - Disabled with "Move students out before deleting." when the group has students (today's rule and text).
  - When enabled, it opens today's inline confirm, restyled. The backend's "disable instead" error text is shown as today.
- **Groups disabled:** the list is replaced by a card.
  - Its header strip reads "Groups disabled for this run", styled mono uppercase `--muted` on `--surface-2`.
  - Its body is today's text for the case, one of three by role and publish state (`:104-111`).
  - In the first two texts, "Overview" is a link that switches to the Overview tab through `setTab`. The third ("Ask a course admin…", `:111`) has no link.
- **Keep:** the empty list text "No groups yet.".

**Capacity badge:** "empty" / "n/10", with the `n/10` text in mono. Colours come from `getCapacityClass` (`lib/runGroups.ts:24-29`, thresholds unchanged):

| Class | Tokens |
|---|---|
| empty | `--status-not-submitted-*` |
| ok | `--status-accepted-*` |
| warn | `--status-needs-revision-*` |
| full | `--status-rejected-*` |

The badge's `title` spells it out: "7 of 10 students".

### Teachers (10d, `RunTeachersTab`)

- **Header:** an `<h2>` "Teachers" with the count.
  - For course admins: the email field (visible label "Teacher email", visually hidden; placeholder "teacher@example.com"; maxlength 254 as today) and a + icon button ("Add teacher").
  - Enter in the field adds. Errors (e.g. "already assigned") show under the field, as today.
  - **The field no longer takes focus when the tab opens** (today it does, `:20-23`), so focus stays on the tab button.
- **Rows** (newest first, unchanged):
  - the avatar (§Avatar);
  - the name, or "—" plus an "invited" chip when `user_full_name` is null (`:84-85`);
  - the mono email under the name;
  - for admins, 🗑 at the right ("Remove {email}").
- **🗑** removes with today's flow (its confirm and errors unchanged, restyled).
- **Non-admins** see the same list without the field, + and 🗑 (R5, as drawn).
- **Keep:** the empty state.

### Mini-projects (10j, `RunMiniProjectsTab`)

- **Header:** an `<h2>` "Mini-projects", then mono `--muted` "3 of 4 blocks" (mini-projects / blocks in the pinned version).
  - "+" (primary, 28px) is titled "New mini-project" and opens `MiniProjectModal` (unchanged until 6b).
  - It is disabled, with today's reason as its `title`, in exactly the cases where today's New button is disabled. The plan lists them from the code.
- **Table:**
  - **Block:** "Block 1 — Vectors and vector spaces" (D6; the number per R13).
  - **Deadlines** (R12): mono, "soft 07 Aug 23:59 · hard 14 Aug 23:59 · resub 21 Aug 23:59". Absent deadlines are omitted. The labels soft / hard / resub are semi-bold `--text`, so they stand apart from the dates (Safari pass).
    - The short form uses fixed English month abbreviations (Jan…Dec) and 24-hour local time, not the browser's locale. It is one small helper in `lib/datetime.ts`.
    - Each part's `title` is today's full `formatLocalWithTz` value, e.g. "2026-08-14 23:59 GMT+2" (`RunMiniProjectsTab.svelte:238-240`).
    - The column header shows the zone. Each shown deadline's offset is `localTzLabel(new Date(iso))`, because the offset changes across daylight saving. If all of them agree, the header reads "Deadlines (GMT+2)" (`localTzLabel` already returns the parentheses). Otherwise it reads "Deadlines (local time)" and each part's `title` carries its own offset. With no deadlines shown, it reads "Deadlines".
    - The offset label keeps `localTzLabel`'s browser-locale formatting (a `shortOffset` such as "GMT+2"); only the date part is fixed English. Accepted.
  - **State chip:** draft / published / locked (§Chip tokens).
  - **Actions:** ✎ and 🗑.
- **✎ is disabled with a reason** in today's cases: a locked row ("Has submissions — editing is off"), and a disabled version (`:252-254`, today's reason). Today the locked case is hidden (`:249-268`; R5).
- **🗑 opens the shared danger panel** (§Shared pieces) for a mini-project with submissions, and today's inline confirm for one without. Both open as a full-width row under their row; the inline confirm keeps its question and buttons on one line (Safari pass).
  - Today's consequence text, the "I understand" box and the admin-only force rule are unchanged.
  - A non-admin who opens the panel sees Force delete disabled with "Only a course admin can force delete." (R5). Today their 🗑 is hidden on locked rows.
- **Keep (D5),** restyled as precondition banners (§Chip and banner tokens), at the top of the tab:
  - "Mini-projects require groups" (info). Its link "Enable on Overview" goes through `setTab`.
  - The run-not-published banner (info), with today's "Publish on Overview" link for admins only (`:205-212`, via `setTab`).
  - The delete-error banner (error), with its "Dismiss" button (`:217-224`).
  - "Cannot load — pinned version not found." (`:171-172`, error).
  - R7's version line.
  - The empty copy naming "+ New mini-project" (`:228-231`).
- The footnote under the drawing is a design note, not UI.

### Assets (10i, `RunAssetsTab`)

- **Toolbar:**
  - the filter pills All / Orphan / Referenced with counts (they exist; restyle);
  - "+ Upload" as a primary button at the right.
- **Bulk strip:** when rows are selected, a `--surface-2` strip reads "N selected", with "Delete N selected" at the right. It exists; restyle.
  - When any selected asset is referenced, the bulk delete uses the shared danger panel inside the strip, with today's counts message (`:633-669`).
  - Otherwise it uses today's plain confirm (`:665`), restyled.
- **Table:**
  - a checkbox column;
  - Filename (download link as today);
  - Size, Uploaded (mono);
  - Uploaded by (mono email, or "—");
  - Uses: a `<button>` chip ("2 uses", "1 use", "0 uses"; tokens per §Chip tokens), with `aria-expanded` and `aria-controls` pointing at the "used by" sub-panel;
  - actions: ↻ Replace (`refresh` glyph) and 🗑 Delete (R4).
  - Sortable columns keep today's sort.
- **The "used by" sub-panel** renders under its row (R14): "rubric.pdf — used by", the list, and "Edit" links (it exists; restyle). It keeps its `id="uses-{id}"` for the Uses button's `aria-controls`.
  - The list names each mini-project as "Block {n} — {block title}" (D6, R13). Today it uses `mp.title` (`:840`). `RunDetailPage` passes `blocks` to the tab (R13).
  - "Edit" goes through `setTab` with `pendingEditTarget` (§The tab in the address).
- **Deleting a referenced asset** uses the shared danger panel, under its row (R14). The admin-only force rule and its disabled reason (`:661-662`, `:808-809`) are unchanged.
- **Replace** keeps its inline confirm (`:760-773`), now a full-width row under its row (R14), and the same-extension rule with its error, restyled.
- **Keep (D5):**
  - the drop zone and upload progress;
  - both banner slots (`:578-583`);
  - the version-disabled locks;
  - the loading and error states.

## Shared pieces

All new pieces use tokens only and carry their own tests.

- **`ui/IconButton.svelte`:** add the glyphs `refresh` (circular arrow) and `download` (arrow into tray) to the `Glyph` union (`:9-11`), in the existing glyph style. `download` has no consumer since the Safari pass made Download CSV a text button (backlog, Polish).
- **`ui/Avatar.svelte` (new):**
  - a `--avatar` circle, `--avatar-bg` fill, 1px `--border-strong` ring;
  - the inline silhouette SVG exactly as documented in `base.css:55-68`, filled `--avatar-fig`;
  - `aria-hidden="true"`, because the row's text names the person;
  - no `src` prop (D7), and never an `<img>`.
- **`ui/DangerConfirm.svelte` (new), the danger panel** (handoff §4 Confirm-then-act):
  - **Layout:** an in-place panel with `--status-rejected-bg` and a 3px `--danger` left rule. Inside: the consequence message, an "I understand" checkbox, Force delete and Cancel.
  - **Props:**
    - `message` — a **snippet**, because today's texts hold markup such as `<code>![ref]</code>` (`RunAssetsTab.svelte:639,788`);
    - `confirmLabel = 'Force delete'`;
    - `busy`;
    - `disabledReason`;
    - `onConfirm`;
    - `onCancel`.
  - **Unarmed** (box not ticked): Force delete shows the `--danger-off-bg / -border / -text` tint and has `aria-disabled="true"` with the title "Tick “I understand” first". Clicking it does nothing.
  - **Armed** (ticked): `--danger` background with `--primary-text`.
  - **`disabledReason`** set: Force delete is natively `disabled`, with that `title`. The box can still be ticked.
  - **While `busy`:** Force delete shows busy, and both Force delete and Cancel are disabled.
  - **Focus and keys:**
    - the panel is a `role="group"` with `aria-describedby` set to the message;
    - focus moves to the checkbox when the panel opens;
    - Esc while focus is inside the panel, or Cancel, calls `onCancel`.
  - **Used by:** `RunMiniProjectsTab` (row), `RunAssetsTab` (row and bulk) replace their own panels with it; 6c's run force delete will reuse it. The behaviour of the existing panels (what is sent, what errors say) does not change.
- **`ui/InlineName.svelte` (new):**
  - **Parts:** an input, then × and ✓ icon buttons in that order, and an error line under them (`role="alert"`).
  - **Props:**
    - `label` (required) — the input's accessible name;
    - `value`;
    - `maxlength`;
    - `onSave(value): Promise<void>`;
    - `onCancel`;
    - `saveTitle = 'Save'`.
  - **Keys:**
    - Enter / ✓ saves the trimmed value.
    - An unchanged value calls `onCancel` instead of `onSave`.
    - An empty trimmed value keeps ✓ disabled, and Enter does nothing.
    - Esc / × calls `onCancel`.
  - **Saving:** the input is read-only and ✓ shows busy. If `onSave` rejects, the field stays open with the error; `aria-invalid` is set and `aria-describedby` points at the error.
  - The field takes focus on mount.
  - **Used by:** the group add row and the group rename. 6c reuses it for Overview's fields.
  - It is not the 5d quiz `InlineInput`, which is bound to the quiz edit slot (`editor/quiz/InlineInput.svelte`).
- **`runs/RunStatusChip.svelte` (new):** the §Run status chip.
- **`lib/dashboards.ts`:** the new `STATUS_SHORT_LABEL` map (§Submissions).
- **`ui/StatusBadge.svelte`:** an optional `label` prop overriding the text; the default is unchanged.
- **`lib/datetime.ts`:** the short deadline formatter (R12).
- **Filter pills and the segmented control** are styled locally in their tabs (two uses each), not as new shared components.

## Backend change (D3, R9)

`GET /api/teaching/runs` (`backend/mathion/api/teaching.py:14-50`) today returns the runs where the user has a `RunTeacher` row. It will return the runs where the user:
- has a `RunTeacher` row, **or**
- is a `CourseAdmin` of the run's course, **or**
- is a superuser (every run; R9).

**The query** (`Run` has no `course_id`; `models.py:204-213`):
- `select(Run, Course.id, Course.name, Course.slug, func.count(RunStudent.id))`, starting from `Run`;
- join `CourseVersion` on `Run.version_id`, then `Course`; outer-join `RunStudent`;
- for a non-superuser, add `WHERE Run.id IN (SELECT run_id FROM run_teachers WHERE user_id = :u) OR CourseVersion.course_id IN (SELECT course_id FROM course_admins WHERE user_id = :u)`; a superuser gets no filter;
- `GROUP BY Run.id, Course.id`, `ORDER BY Run.id ASC`.

Each run appears once, and student counts are not doubled. The response shape (`TeachingRunRow`) is unchanged. The docstring changes from "no superuser bypass" to "teach or administer; superusers see all".

**Tests** (`backend/tests/test_teaching.py`):
- Invert `test_excludes_runs_where_user_is_course_admin_but_not_teacher` (`:736`) into "includes the admin's course runs".
- Invert `test_superuser_sees_only_own_teacher_rows` (`:719`) into "superuser sees all runs".
- Add:
  - an admin who also teaches one of the course's runs sees it once, with the right student count;
  - a user who is neither sees none;
  - a teacher of one course who is the admin of another sees both sets.

Use a plain user plus a `CourseAdmin` row, as `:746` does. The `admin_client` fixture is a superuser (`conftest.py:336`).

There are no other backend changes in 6a.

## Focus

Focus never drops to `<body>` after an action in these screens. The rule, for any action whose control disappears or is re-created (a confirm opening or closing, a row deleted, a panel closed), is tried in order:
1. Return focus to the control that started the action, if it still exists.
2. Else the same action on the next row, then on the previous row.
3. Else the section's primary action (+), if it is enabled.
4. Else the section's `<h2>` (`tabindex="-1"`).

Applied:
- **Inline confirms** (runs-list 🗑, group 🗑, teacher remove, mini-project delete, asset delete, plain bulk delete):
  - Cancel returns focus to the 🗑 that opened it.
  - Confirm, then success, follows steps 2–4.
  - Confirm, then failure, returns focus to the 🗑 if the row is still there.
- **The danger panel:** the same rule. Cancel returns to its 🗑 (or, for the bulk panel, to "Delete N selected").
- **Groups:**
  - Closing the add row returns focus to the header toggle.
  - After a rename saves or is cancelled, focus returns to that row's ✎.
- **Teachers:**
  - After an add, focus stays in the email field, which is cleared.
  - After a remove, the rule applies, with the email field as step 3.
- **Tab jumps** from inside a panel: focus moves to the new active tab button (§The tab in the address).

## Code changes

- **Routes and links:**
  - `src/routes.ts`: the two `/teaching/...` routes, and the two old routes pointed at the redirect;
  - `App.svelte`: the route→component map;
  - new `pages/runs/RunsRedirect.svelte`;
  - the §Links lines (`CourseCard.svelte`, `NewRunModal.svelte:57`, `RunDetailPage.svelte:276`, and the others the plan's grep finds).
- **Header:** `components/chrome/AppHeader.svelte` (the pill condition).
- **Pages:** `pages/runs/RunDetailPage.svelte`, `pages/runs/RunListPage.svelte`, `pages/teaching/TeacherRunListPage.svelte`.
- **Tabs:** `components/runs/{RunProgressTab,RunSubmissionTab,RunGroupsTab,RunTeachersTab,RunMiniProjectsTab,RunAssetsTab}.svelte`.
- **Tab-jump calls only:** `RunRosterTab.svelte` (the `ActiveTab` import and `onNavigateToTab`), and `MiniProjectModal.svelte` (the `onNavigateToTab` it receives, if its type changes).
- **New:** `components/ui/{Avatar,DangerConfirm,InlineName}.svelte`, `components/runs/RunStatusChip.svelte`.
- **Changed:**
  - `components/ui/IconButton.svelte` (two glyphs);
  - `lib/runStatus.ts` (a label map; the key is unchanged);
  - `lib/dashboards.ts` (`STATUS_SHORT_LABEL`);
  - `components/ui/StatusBadge.svelte` (the `label` prop);
  - `lib/datetime.ts` (the short deadline formatter).
- **Backend:** `backend/mathion/api/teaching.py`, `backend/tests/test_teaching.py`.
- **Gate:** `frontend/scripts/visual-refresh-gate.sh` (§Gate).
- **Docs:** `docs/backlog/slice6a-teacher-restyle-debt.md` (deferred minors, task by task); the R13 note in `docs/backlog/slice5c-constructor-polish-debt.md`.

## Process

As in 5c/5d (the per-task loop):
1. TDD per step.
2. vitest (exit 0, no "Errors" / "Unhandled" line).
3. svelte-check with 0 errors.
4. The gate.
5. Screenshots of the real screens in an overlay → the user's OK.
6. Opus + Fable review lanes on the uncommitted diff until clean.
7. Commit with exact paths.
8. Wait for the user's "go".

Rules for the work:
- Screenshots use the dev data (run 8) plus network mocks. There are no writes to shared data unless the user agrees.
- The final whole-branch review and a Safari pass (one step at a time) close 6a.

## Testing

Component tests use `mount` / `unmount` / `flushSync` (not testing-library). At least:

- **Routes and redirects:**
  - `/courses/s/runs` → `/teaching/s` (replace).
  - `/courses/s/runs/8?tab=groups#x` → `/teaching/s/runs/8?tab=groups#x` (replace).
  - A signed-out visit to an old address goes through login and lands on the new one.
  - While `session.user` is null, `RunsRedirect` calls no `navigate` (the login page keeps its single `?next=`).
  - The course card's Runs link points to `/teaching/s`.
  - `NewRunModal` navigates to `/teaching/s/runs/{id}` after create.
  - Deleting a run from Overview lands on `/teaching/s`.
- **Header:**
  - The Teaching pill shows for an admin who teaches nothing, and for a superuser.
  - It is active on `/teaching/s/runs/8`. Authoring is not active there.
- **Tab in the address:**
  - `?tab=progress` on first load opens Progress (not Overview).
  - An unknown tab → Overview, with the address rewritten and other parameters and the hash kept.
  - A tab click rewrites the address with replace, and focus stays on the tab.
  - Switching tabs does not reload the run: spies on `getRun` and `listVersions` are not called again, and "Loading run…" does not appear.
  - Overview's "open Roster" lands on Roster with the Unassigned prefilter, the address says `?tab=roster`, and focus is on the Roster tab.
  - Assets → "Edit" lands on Mini-projects and opens the modal for that mini-project.
  - **A dirty guard that is cancelled** keeps the old tab, the old address, no prefilter and no pending edit. **An accepted guard** switches.
  - A different `:runId` resets the per-run state.
- **Breadcrumb:** Teaching › Course › Run with the right hrefs, `aria-current`, and `aria-hidden` separators, for an admin and for a teacher.
- **Frame:**
  - The meta line uses the version id, not the rank.
  - Singulars.
  - "· N groups" only with groups on.
  - One version-disabled banner.
  - `tabpanel` labelled by the active tab.
- **RunListPage:**
  - The admin view has no ✎ and no "Open".
  - 🗑 is disabled with its reason on non-draft runs, with the "Delete run {title}" name.
  - The Version column shows "Label · v. {id}", or "v. {id}" when the label is empty.
  - The empty state is kept.
  - The teacher read-only view shows only their runs of that course, with no + or 🗑.
  - 403 and 404 render `ErrorState` with a link to `/teaching`.
- **TeacherRunListPage:**
  - The Course column links to `/teaching/:slug`.
  - The "Finished" pill.
  - Both empty texts.
  - "Try again".
- **RunStatusChip:** each key's label and token.
- **Progress:**
  - The heat steps at 0, 0.25, 0.26, 0.5, 0.75, 0.76 and 1 give the expected token; "—" has no fill.
  - The legend's name in each mode.
  - The "B1 · TITLE" and "S1" headers number by position: a version whose blocks have stored orders 1, 3 shows B1, B2 (R13).
  - Refresh is an icon button and still refetches.
  - "(Ungrouped)" is kept.
  - Disabled rows get the chip, with no opacity rule.
  - The kept empty texts.
- **Submissions:**
  - Column header: the block title, plus the line-2 cases (parts, "no submissions", bare "B2"); "B{n}" by position (R13).
  - `StatusBadge` with and without the `label` prop.
  - Lowercase short labels.
  - The cell `aria-label` uses the block title.
  - "—" out of scope.
  - The column sort is kept.
  - The empty states are kept.
- **Groups:**
  - The toggle opens the add row with focus in the field; Esc returns focus to the toggle; `aria-expanded`.
  - The 409 text appears under the field.
  - Rename:
    - Enter saves, Esc cancels.
    - Unchanged → no request.
    - Empty → ✓ disabled.
    - A failure keeps the field open with the error.
    - No save on blur.
  - One editor at a time.
  - 🗑 is disabled with its reason when the group has students.
  - The capacity token per class.
  - The three disabled-state texts and their Overview link.
  - Focus after a delete.
- **Teachers:**
  - The avatar is present and `aria-hidden`.
  - The "invited" chip when `user_full_name` is null.
  - No autofocus on mount.
  - The read-only view for non-admins.
  - Focus after add and remove.
- **Mini-projects:**
  - The "3 of 4 blocks" count.
  - Deadlines with time, the `title`, and the header offset; a mixed-offset set (one summer and one winter deadline) gives "(local time)"; the short format is English whatever the locale.
  - "Block {n}" by position (R13).
  - Locked and version-disabled rows show a disabled ✎ with reasons.
  - Force delete uses the danger panel, and the request is unchanged.
  - A non-admin sees Force delete disabled with the reason.
  - All kept banners and the empty copy.
  - The plain delete confirm is a one-line row under its row (Cancel returns focus to the 🗑); the deadline labels are separate semi-bold spans.
- **Assets:**
  - The danger panel for a referenced asset (row and bulk); the plain confirm for an unreferenced bulk delete.
  - The Uses button's `aria-expanded`.
  - The sub-panel names "Block {n} — title" (R13), under its row (R14).
  - Any delete or Replace confirm and that row's sub-panel close each other; the plain delete confirm is a one-line row under its row.
  - A block missing from `blocks` drops the "Block {n} — " prefix.
  - Replace and its inline confirm.
  - The kept drop zone, progress and banner slots.
- **DangerConfirm:**
  - Unarmed: no `onConfirm` on click, `aria-disabled`, title.
  - Armed: calls `onConfirm`.
  - `disabledReason` disables it with the title.
  - `busy` disables both buttons.
  - Focus goes to the checkbox on open.
  - Esc inside the panel → `onCancel`.
  - The message snippet renders markup.
- **InlineName:**
  - Enter / ✓ / Esc / ×.
  - The order of × and ✓.
  - Unchanged → `onCancel`.
  - Empty → ✓ disabled.
  - Read-only while saving.
  - A rejection keeps the field open, with the error and `aria-invalid`.
- **Avatar:** the SVG, and no `<img>`.
- **Backend:** the tests in §Backend change.

## Gate

The gate gains a 6a section at the end of `scripts/visual-refresh-gate.sh`; the plan sets the exact rows and `EXPECTED_CHECKS`. It covers:
- `colour_scan 6a-teacher` and `emoji_scan` over every 6a-touched component (list `FILES_6A`).
- `RunProgressTab` contains no `hsl(`, and the five heat tokens are referenced.
- **No page link to an old run address remains.** No `['"\`]/courses/[^'"\`]*/runs` string under `src/` outside `src/tests/`, `routes.ts`, and strings that start with `/api/`.
- **No `.disabled-row` opacity rule** in `RunProgressTab` or `RunSubmissionTab`.
- **Token pins** for the new shared pieces (`Avatar`, `DangerConfirm`, `InlineName`, `RunStatusChip`), in the same style as the 5c/5d pins.

## Carried to the 6a browser pass

- The run frame and the tabs at a normal laptop width and at about 1000px. The Progress table scrolls sideways inside its card, never the page.
- Sticky Student/Group columns in Safari while scrolling sideways.
- The redirects from old bookmarks.
- The interim mixed look (§Why) is expected, not a finding.
