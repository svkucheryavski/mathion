# Visual Refresh — Slice 4: Student Remainder (9c + 9d) — Design Spec

**Status:** Design — rev 1 (brainstormed 2026-09-06, awaiting user review, then codex + first-party spec review).

**Authority:** `docs/design/visual-refresh/reference-screens.dc.html` (line refs below are into that file: artboard **9c** is `:1251-1334`, artboard **9d** is `:1336-1395`) and `docs/design/visual-refresh/mathion-visual-spec.md` (§3 colour of state, §4 precondition banners `:289-293`, §6 table `:344-345`). Where the two disagree, the spec's *rules* win over the artboard's *pixels* and the deviation is recorded here (there is exactly one: D3).

**What this slice restyles.** Two reference screens, the last two student-facing ones:

| ref | screen | source component today |
|---|---|---|
| 9c | Mini-project — student | `frontend/src/pages/MiniProjectDetailPage.svelte` (the README's `pages/MiniProject.svelte` name is stale — this is the file) |
| 9d | Loading, empty and error states | new `ui/Skeleton.svelte`, `ui/EmptyState.svelte`, `ui/ErrorState.svelte`, applied to the five student surfaces |

Branch `feat/visual-refresh-slice4-student-remainder` off the Slice-3 tip `22549e2`. **LOCAL — not pushed, not merged**; the whole redesign lands as one stack when every slice is done.

---

## Global Constraints

Inherited verbatim from the Slice-3 spec (`2026-09-01-visual-refresh-slice3-student-content-design.md` §Global Constraints 1-10) — every task implicitly includes these. Restated with only what changes for this slice:

1. **Colours → tokens.** No hardcoded hex outside comments. **No new colour tokens.** Every reference hex in 9c/9d resolves to an existing token in `frontend/src/styles/theme-default.css`; the five substitutions where the artboard's hex has no exact token, or where the exact-hex token is semantically wrong, are pinned in the table below and annotated at each pin site. Forced-colors system-colour keywords inside `@media (forced-colors: active)` are not token violations (Slice-3 exemption).
2. **No opacity-based disabled/dim.** This slice **removes** one violation: `.group-disabled { opacity: 0.7 }` (`MiniProjectDetailPage.svelte:570`) — see §3.4. The visually-hidden native file input uses the Slice-2 `opacity:0` sr-only idiom (`Login.svelte:137`), which is hiding a still-focusable control, not a disabled treatment; annotate it so.
3. **No decorative glyphs.** New SVGs (the download arrow, the empty-state page mark) follow the repo convention: `aria-hidden="true"`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, `stroke-width` 1.6, round caps/joins, colour inherited. `LATEST_STATUS_META`'s glyph tokens stay (Slice-3 carve-out, C14).
4. **Mono for every numeral** via the global `.mono` class (`base.css:10`): the history header's date/author line, file sizes, the `{score}/100` score, the soft-deadline aside, the evaluator date. **Carve-out, recorded:** the main deadline sentence (`ref 1273`) is prose at 12.5px sans in the artboard and stays sans — it is a sentence that happens to contain a date, and its numerals are inside `formatRelativeDeadline`'s output string, which the page renders as one text node. Splitting that string to wrap its digits would mean re-implementing the formatter; the aside (`ref 1274`) carries the mono numeral instead.
5. **Per-component literals — three forms** ((a) `/* ref NNNN */`, (b) no-ref with the scale named, (c) mechanism). Geometry only, never colour.
6. **Dense control metrics are final.** Buttons come from `ui/Button.svelte` as-is: the artboard's secondary button padding `4px 9px` (`ref 1383/1391`) vs Button's `--btn-pad` `4px 10px` is a Slice-1 decision, not this slice's — do not fork Button.
7. **`ItemMark` states** — unchanged, not touched here.
8. **No backend/API/route/schema change.** None. Every touch is client-side and enumerated below.
9. **Commit trailer (user decision 2026-09-06, replaces the Slice-1-3 pin):** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` — **no `Claude-Session` line.** `git add` exact named paths only, never `-A`/`.`.
10. **Model / effort / review discipline.** Implementation is done directly by the controller. Reviewers: codex @ high + a first-party lane @ Opus xhigh, per task, fix every Critical/Important, re-review until both lanes are clean, explicit user OK before a task is closed. Whole-branch final review at the end, then the user-owned browser pass.

**svelte-check baseline on the branch tip `22549e2`: 0 errors / 31 warnings.** Warnings must not grow.

### Colour substitutions (the only non-exact token mappings in this slice)

| artboard hex | where | token used | why not the exact-hex token |
|---|---|---|---|
| `#8B919E` | empty-state icon glyph, `ref 1356` | `--muted` (#5A616E) | no token has this hex; `--faint` is reserved for disabled glyphs and separators (`mathion-visual-spec.md:62-66`) and this glyph is neither; `--muted` is the next step up and AA-safe |
| `#E9EBEF` | history header-strip bottom border, `ref 1299/1317/1325`; skeleton/empty/error card strips in 9d | `--border-soft` (#F0F1F4) | the exact hex is `--state-archived-bg`, a *state* token — using it as a border would make a white-label override of "archived" repaint row separators |
| `#F0F1F4` | PDF badge background, `ref 1306` | `--surface-2` (#F5F6F9) | the exact hex is `--border-soft`, a *border* token; a background wants a surface token |
| `#EDEFF2` | skeleton bars, `ref 1347-1349` | `--border-faint` (#EDEFF2) | exact; recorded because it is a border token used as a fill — the skeleton bar *is* a placeholder stroke, the same role `--border-faint` plays on disabled controls |
| `#FCFCFD` | file tile background, `ref 1305` | `--surface-3` (#FCFCFD) | exact; listed for completeness (nested/inset panel, the token's documented role) |

Every other hex in 9c/9d maps exactly: `#16181D`→`--text`, `#2A2F3A`→`--text-2`, `#3D4350`→`--text-3`, `#5A616E`→`--muted`, `#B4B9C4`→`--faint`, `#E3E5EA`→`--border`, `#DDE1E9`→`--border-strong`, `#3F5C77`→`--primary`, `#EAEFF4`→`--primary-soft`, `#991B1B`→`--danger`, `#FDECC8`/`#7A4E0B`→`--status-needs-revision-bg/fg`, `#fee2e2`/`#991b1b`→`--status-rejected-bg/fg`, `#F5F6F9`→`--surface-2`, `#fff`→`--surface`. The artboard-chrome hexes (`#1C1C1A`, `#5C5C57`, `#8A8A85`, `#DEE1E7`) are canvas labels and frames, not screen content.

### Decisions (locked in brainstorming 2026-09-06)

- **D1 — Slice order and scope.** Student remainder (this slice) → Authoring → Teacher → one final polish slice. 9d is applied to the **five student surfaces only** (`CourseList`, `CourseView`, `SequencePlayer`, `QuizItem`'s empty branch, `MiniProjectDetailPage`); teacher/authoring tabs adopt the primitives in their own slices. Polish/taste findings go to `docs/backlog/`, one file each.
- **D2 — Three small primitives, not one.** `Skeleton`, `EmptyState`, `ErrorState`, each with one job, its own test file, and no props for states it does not render. `Spinner` stays for in-flight buttons (`Login`, editor pages); `LoadingPlaceholder` stays for its teacher-page users. Neither is deleted.
- **D3 — The "Late" pill is grey, not amber.** `ref 1320` paints it `--status-needs-revision-*`; `mathion-visual-spec.md:134-135` says *"`needs revision` is the only amber in the product"*. The spec rule wins: "late" is a fact about the past, not a call to act. Late uses `--status-not-submitted-bg/fg`. **The one recorded pixel deviation from the artboard.**
- **D4 — Deadline dates keep the shared helper's format** (`formatLocalWithTz`, `lib/datetime.ts:21-27`: `2026-08-21 23:59 GMT+2`, pinned to `shortOffset` for cross-browser stability). The artboard's `21 Aug 2026, 23:59 CEST` wording is not reproduced; no second formatter. Wording deviation only.
- **D5 — Drop zone: click to pick AND drag-and-drop.** A `<label>` styled as the dashed box over a visually-hidden native `<input type="file">`; `dragover`/`dragleave`/`drop` handlers feed the **same** `handleFileChange` path so the `.pdf` / 20 MB guards and the `success → idle` transition apply identically. Copy is the artboard's: `Drop a PDF or click to pick`.
- **D6 — Uniform full card for every history entry.** The artboard collapses older rejected submissions to one mono line (`ref 1322/1330`); Mathion renders every entry the same way (header strip + file tile + feedback block when evaluated), because a rejected evaluation can carry a feedback file that must stay reachable, and one template is one test. Deviation from the artboard in *density* only; every element of the full card is on the artboard.
- **D7 — The 9d states render inside their own card.** The artboard wraps each state in a bordered `--surface` card whose label strip is annotation (`ref 1345` "loading — skeleton rows, never a spinner"). The card border is taken as product chrome (it is what gives a skeleton its row height and an empty state its extent inside a page that otherwise has no container); the label strips are not.
- **D8 — Evaluation-result pills reuse `StatusPill`.** `StudentSubmissionHistoryEvaluation.result` (`types.ts:490`) is a 4-value subset of `LatestStatus`, so `<StatusPill status={ev.result} />` is type-correct as-is and yields the same label/class/glyph the page header uses. No new pill component, no second copy of the status table.

---

## Enumerated changes (the non-pure-CSS touches)

All client-side; no route, schema, or backend change.

**(A) Behaviour / state:**
1. **Drag-and-drop file pick** (D5, `MiniProjectDetailPage`): new `isDragOver` `$state(false)`; `ondragover` (`preventDefault`, set true), `ondragleave` (false), `ondrop` (`preventDefault`, false, take `e.dataTransfer?.files?.[0] ?? null`, then run the **same** body as `handleFileChange` — factor that body into `acceptFile(f: File | null)` which both call). A drop while `submitState === 'submitting'` is ignored (the native input is `disabled` in that state, `:485`; the drop path must match). Only the first dropped file is taken.
2. **CourseList Retry** (`CourseList.svelte:17-23`): new `reloadTick = $state(0)`; the load `$effect` reads `reloadTick` at its top and resets `loading = true; error = ''` there (today it resets only `loading`, `:18`) so incrementing it re-runs the fetch with a clean error; Retry only increments. No stale-response race is introduced: Retry is reachable only after the previous request has settled (the error branch), so at most one request is in flight. No other page gains Retry (D-scope: CourseView/SequencePlayer/MiniProject errors are page-level and keep their Back action).
3. **`.group-disabled` opacity removed** (Constraint 2): the disabled-group meaning is carried by the notice line alone (§3.4).

**(B) Copy / rendered strings** (`MiniProjectDetailPage` unless noted):
4. Breadcrumb `< Courses › {course}` → `Courses / {course} / {block title}` — the `<` prefix and `›` go; the block title becomes the current crumb (`ref 1267`).
5. `<h1>{block title} — Mini-project</h1>` → **`Mini-project — {block title}`** (`ref 1269`; `titleForHeading`'s "Untitled block" fallback stays).
6. Deadline lines: `Resubmission deadline: …` / `Hard deadline: …` / `(Soft deadline: …)` → one row: `<strong>Resubmission deadline</strong> · {formatRelativeDeadline}` (or `Hard deadline`), plus a mono aside `soft deadline · {formatLocalWithTz}` (`ref 1273-1274`).
7. `Submission #{n}` → **`Submission {n}`** (`ref 1300`).
8. History meta: `By {name} (you) on {date}` → mono `{date} · {name}{ (you)}` (`ref 1301`); `File: {name} ({size}) Download` → the file tile (§3.6); `Evaluated: {label} — score N/100` / `By {evaluator} on {date}` / `Feedback: …` → the feedback block's meta line `{label} · score {n}/100 · {evaluator}, {date}` + the text (`ref 1311-1312`).
9. Submit error copy: the banner gains a constant title **`Couldn't submit`**; the two network-class messages `"Couldn't submit — retry?"` (`:334`, `:350`) become **`The upload didn't go through. Nothing has been lost — retrying sends the same file.`** (5(b) copy modelled on `ref 1381`). Guard messages (`Only PDF files are accepted.`, `File too large — 20 MB maximum.`), the 409/403/400 messages and backend `displayMessage` are unchanged and become the `message` under the title.
10. Group card heading `Group` → **`Your group`** (`ref 1285`); the member line becomes `Group {name} — **{me} (you)**, {others}` with the current user bold and first (`ref 1286`; `orderedMembers` already puts them first).
11. Submit heading unchanged (`Submit` / `Submit revision`, `ref 1289`); drop-zone label `Drop a PDF or click to pick` (`ref 1291`), replaced by the picked filename once a file is selected.
12. **Other student pages:** no copy change. `CourseList` `You're not enrolled…`, `CourseView` `This course has no published blocks yet.` / the three error headings, `SequencePlayer` `This sequence has no items yet.` / its error headings, `QuizItem` `This quiz has no questions yet.` are carried into the primitives verbatim as `title` (and the error `message` bodies as `message`). `SequencePlayer`'s two `← Course` ghost buttons (`:172`, `:175`) become `Back to course` secondary Buttons inside the page-variant `ErrorState` action (drops the `←` glyph, visual-spec §5.8) — **the only copy touch outside the MP page.**

**(C) Structural / accessibility:**
13. **Three new primitives** `ui/Skeleton.svelte`, `ui/EmptyState.svelte`, `ui/ErrorState.svelte` (§1).
14. **Loading:** `Spinner` (`CourseList.svelte:32`, `CourseView.svelte:31`, `SequencePlayer.svelte:163`) and `<p>Loading…</p>` (`MiniProjectDetailPage.svelte:407`) → `<Skeleton />`. The four `Spinner` imports go; `Spinner.svelte` itself is untouched.
15. **Empty:** `<p class="empty">` (`CourseList:36`, `CourseView:53`, `SequencePlayer:179`, `QuizItem:143`) → `<EmptyState title=… />`; the four scoped `.empty` rules go.
16. **Error:** `CourseList:34` → inline `ErrorState` with Retry; `CourseView:32-43`, `SequencePlayer:164-175`, `MiniProjectDetailPage:408-415` → page-variant `ErrorState` with the existing Back action as a secondary `Button` in the `action` snippet. `ErrorState`'s root carries `role="alert"`; `Skeleton`'s root carries `role="status"` with visually-hidden `Loading…` text (`ref 1350`).
17. **Breadcrumb:** the current crumb carries `aria-current="page"`; separators are `aria-hidden="true"` spans.
18. **Drop zone focus:** the hidden input's `:focus-visible` is suppressed and re-drawn on the label with `:has(input:focus-visible)` (inset 2px `--primary` ring) plus a forced-colors `outline: 2px solid Highlight` — the Slice-2 segmented-control pattern (`Login.svelte:137-147`), copied with its annotation.
19. **History pills:** the raw `<span class="pill pill-warning">Late</span>` (`:527`) is restyled in place (class `pill pill-late`, D3 tokens), still a **sibling of `<h3>`** inside `.history-entry-header` (D15 of the original page spec — the existing test `MiniProjectDetailPage.svelte.test.ts:321-347` pins it). The evaluation result pill (`<StatusPill status={ev.result} />`, D8) is new and renders **after** the Late pill in the same right-aligned group, so the existing `header .pill`-first-match assertions keep finding Late.
20. **Download link:** `<a … download>Download</a>` (`:540`) becomes the file-tile's icon link — still an `<a download>` (it must remain a link: it navigates to a file, and an `<a>` is what carries `download`), with `aria-label="Download {filename}"`, `title="Download"`, and the artboard's arrow SVG (`ref 1308`). **Not an `IconButton`** — that primitive is a `<button>`.
21. **Test seams kept:** `data-testid` `sr-live`, `fetch-error-banner`, `assignment-html`, `mp-submit-section`, `mp-file-input`, `mp-submit-error`, `mp-cannot-submit`; classes `history`, `history-entry`, `history-entry-header`; elements `header .pill`, `h3`. **Seams that change** (the existing test file is updated in the same task): `mp-submit-btn` → `.submit-row .btn.primary` (the `Button` primitive does not forward `data-testid`; adding a passthrough to a Slice-1 primitive for one test is not worth it); `mp-retry-btn` → `[data-testid="mp-submit-error"] .btn`; `.banner-error` → `[data-testid="fetch-error-banner"] [role="alert"]`; the `Evaluated:` text heuristics (`:221`, `:273`, `:296`) → presence/absence of `.feedback`; `Submission #2` → `Submission 2`.

Everything not in (A)-(C) or implied by the per-surface styling is pure CSS/token work.

---

## Scope

### In scope
**New primitives:** `frontend/src/components/ui/Skeleton.svelte`, `EmptyState.svelte`, `ErrorState.svelte` + `frontend/src/tests/Skeleton.svelte.test.ts`, `EmptyState.svelte.test.ts`, `ErrorState.svelte.test.ts` (all verified absent).
**Student pages (9d adoption):** `pages/CourseList.svelte`, `pages/CourseView.svelte`, `pages/SequencePlayer.svelte`, `components/items/QuizItem.svelte` (empty branch only, `:141-145`) and their existing tests.
**Mini-project page (9c):** `pages/MiniProjectDetailPage.svelte` + `tests/MiniProjectDetailPage.svelte.test.ts`.
**Tokens:** `styles/theme-default.css` — **verify-only.**

### Out of scope / deferred
- Teacher, authoring and superuser surfaces, including every `runs/*` tab's loading/empty/error markup (they adopt the primitives in Slices 5/6) and the two 9d variants only they need — "empty — filtered to nothing" (`ref 1362-1368`) and "not applicable" (`ref 1370-1374`). `EmptyState` gets no `compact` prop until a consumer exists.
- `chrome/AppHeader.svelte`, `chrome/Toaster.svelte`/`Toast.svelte` — shared chrome, untouched (Slice-3 ruling).
- `ui/Button.svelte`, `ui/IconButton.svelte`, `ui/Spinner.svelte`, `ui/LoadingPlaceholder.svelte` — untouched.
- The `<Course Name>` breadcrumb fallback (`MiniProjectDetailPage.svelte:421`, shown while `loadCourse` is in flight) — pre-existing placeholder copy; unchanged. Filed to `docs/backlog/` if the user wants it in the polish slice.
- `PageItem`'s content-typography block is **not** shared with the assignment card (see §3.3 for the deliberately smaller subset used there).
- The carried tech debt list (forced-colors focus gap in `base.css:21-25`, `--dimmed`, `IconButton` glyph union, `Button` non-primary weight) — final polish slice.
- The quiz-state-hygiene follow-up and the stored-`<ol>` backfill — separate branches, unchanged.

---

## Per-surface design

### 1. The 9d primitives — T1

All three are `components/ui/*`, presentational, no store access, no `navigate`. Geometry pins cite artboard 9d; every colour is a token.

**1.1 `Skeleton.svelte`** — props `rows: number = 3`, `label: string = 'Loading…'`.
```svelte
<div class="skeleton" role="status" aria-live="polite">
  <span class="sr-only">{label}</span>
  {#each { length: rows } as _, i}
    <div class="row" aria-hidden="true">
      <span class="bar" style:width="{W[i % 3][0]}px"></span>
      <span class="bar" style:width="{W[i % 3][1]}px"></span>
      <span class="bar end" style:width="{W[i % 3][2]}px"></span>
    </div>
  {/each}
</div>
```
`W = [[180, 90, 64], [220, 70, 64], [150, 110, 64]]` — the three artboard rows (`ref 1347/1348/1349`), cycling. Card: `border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 12px /* ref 1346 */; display:flex; flex-direction:column; gap: 9px /* ref 1346 */`. Row: `display:flex; align-items:center; gap: 12px /* ref 1347 */`. Bar: `display:block; height: 13px; border-radius: 3px /* ref 1347 */; background: var(--border-faint)`; `.end { margin-left: auto }`. **No animation, no shimmer** — the artboard has none, and "never a spinner" (`ref 1345`) means a static placeholder that holds row height. `.sr-only` is the repo's 1px-box idiom (`MiniProjectDetailPage.svelte:581-591`, Constraint 5(c)). `rows` below 1 renders the card with no rows (still announces) — not clamped, not a supported input; tests use 1 and 3.

**1.2 `EmptyState.svelte`** — props `title: string`, `hint?: string`, `icon?: Snippet`, `action?: Snippet`.
```svelte
<div class="empty-state">
  {#if icon}<span class="icon" aria-hidden="true">{@render icon()}</span>{/if}
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>
```
Card as in 1.1 (`ref 1353`) with inner `padding: 34px 20px /* ref 1355 */; display:flex; flex-direction:column; align-items:center; gap: 9px /* ref 1355 */; text-align:center`. `.icon`: `display:flex; align-items:center; justify-content:center; width:38px; height:38px; border-radius: var(--radius-lg) /* 8px, ref 1356 */; background: var(--surface-2); border: 1px solid var(--border-soft); color: var(--muted)` (substitution table); the consumer's SVG is 18×18 (`ref 1356`). `.title`: `font-size:14px; font-weight:600 /* ref 1357 */; color: var(--text)`. `.hint`: `font-size:13px; line-height:1.5; max-width:44ch /* ref 1358 */; color: var(--muted); text-wrap: pretty`. `.action { margin-top: 4px /* ref 1359 */ }`. No `icon` on any Slice-4 consumer — the prop exists because the artboard's canonical empty state has one and the authoring slice's "No versions yet" (`ref 1357`) will need it; it is tested here so that consumer inherits a guard, and the SVG lives with the consumer, not the primitive.

**1.3 `ErrorState.svelte`** — props `variant: 'inline' | 'page' = 'inline'`, `title: string`, `message?: string`, `onretry?: () => void`, `action?: Snippet`. The Retry label is the constant `Retry` (`ref 1383`); no label prop until a consumer needs another word.
```svelte
<div class="error-state {variant}" role="alert">
  <div class="body">
    <p class="title">{title}</p>
    {#if message}<p class="message">{message}</p>{/if}
  </div>
  {#if onretry}<Button variant="secondary" onclick={onretry}>Retry</Button>{/if}
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>
```
Card as in 1.1 (`ref 1376/1386`). **inline** (`ref 1378-1383`): root `display:flex; align-items:center; gap: 12px; padding: 14px 16px /* ref 1378 */; border-left: 3px solid var(--danger)` — the rule sits on the card's own left edge, so the card's 1px `--border` is replaced on that side (`border-left` overrides the shorthand's left component; annotate); `.body { display:flex; flex-direction:column; gap:3px /* ref 1379 */; flex:1 }`; `.title { font-size:13px; font-weight:600 /* ref 1380 */; color:var(--text) }`; `.message { font-size:12.5px /* ref 1381 */; color:var(--muted) }`. **page** (`ref 1388-1391`): root `display:flex; flex-direction:column; align-items:center; gap: 9px; padding: 30px 20px /* ref 1388 */; text-align:center`; `.title { font-size:14px /* ref 1389 */ }`; `.message { font-size:13px; line-height:1.5; max-width:46ch /* ref 1390 */; text-wrap:pretty }`; `.action { margin-top:4px /* ref 1391 */ }`. `onretry` and `action` may both be given (renders both; no consumer does); `onretry` on the page variant renders the same secondary Retry after the body. The `title` is a `<p>`, not a heading — the page variant sits where a page's `<h1>` used to be (`CourseView:34/37/40`, `SequencePlayer:166/169/174`), which drops the document's h1 on those error paths; accepted, because an error card is not the page's content and the `role="alert"` announcement carries the text. The `role="alert"` fires once on mount, which is the intended announcement.

**1.4 Contract tests** (one file each, repo idiom): Skeleton — `role="status"`, hidden label text, `rows` count and the 3-bar row shape, width cycle at row 4 = row 1; EmptyState — title/hint/icon/action presence and absence, `aria-hidden` on the icon slot; ErrorState — `role="alert"`, both variants' class, Retry button rendered only with `onretry` and it calls it, `action` snippet rendered.

### 2. Student page adoption (9d) — T2

| page | loading (`:line`) | empty (`:line`) | error (`:line`) |
|---|---|---|---|
| `CourseList` | `Spinner` `:32` → `<Skeleton />` | `:36` → `<EmptyState title="You're not enrolled in any courses yet — ask your teacher for an invite." />` | `:34` → `<ErrorState title="Couldn't load courses" message={error} onretry={retry} />` — inline, the only Retry (enumerated 2) |
| `CourseView` | `:31` → `<Skeleton rows={4} />` | `:53` → `<EmptyState title="This course has no published blocks yet." />` (inside the existing header/info layout) | `:32-43` → one `<ErrorState variant="page" {title} {message}>{#snippet action()}<Button variant="secondary" onclick={() => navigate('/courses')}>Back to courses</Button>{/snippet}</ErrorState>` fed by a `$derived` pair: 404 → `Course not available` / `This course isn't available to you. Ask your teacher for an invite link, or check the URL.`; 403 → `Access denied` / `You don't have access to this course.`; otherwise `Couldn't load course` / `error.message` — the three branches at `:34-41`, text verbatim |
| `SequencePlayer` | `:163` → `<Skeleton />` | `:179` → `<EmptyState title="This sequence has no items yet." />` (crumbs + h1 kept above it, `:177-178`) | `:164-175` → page-variant `ErrorState`, titles/messages verbatim from `:166-170`/`:174`, action `Back to course` (enumerated 12) |
| `QuizItem` | — | `:143` → `<EmptyState title="This quiz has no questions yet." />` inside the existing `.quiz` article (`:141-145`; the `<h2>` stays) | — |
| `MiniProjectDetailPage` | `:407` → `<Skeleton rows={4} />` | — (empty history hides the section, unchanged) | `:408-415` → §3.7 |

The four `.empty` scoped rules (`CourseList:53`, `CourseView:66`, `SequencePlayer:320`, `QuizItem:226`) and `CourseList:54 .error` are deleted (otherwise `css_unused_selector` warnings grow). `CourseList`'s `.page`/`.page-head`/`.grid` and the other pages' layout rules are untouched. Existing tests: `SequencePlayer.svelte.test.ts:152` and `QuizItem.svelte.test.ts:201` assert `.empty` → `.empty-state`; `CourseView.svelte.test.ts:39` is a comment. New assertions: CourseList Retry re-fetches (mock `api.get` rejecting then resolving; assert the second call and the grid), each page's loading branch renders `[role="status"]`.

### 3. Mini-project page (9c) — T3 (header, assignment, group, history) + T4 (submit card)

The page keeps its script wholesale — the load/refetch machinery (`:56-172`), `rewriteExternalLinks` effect (`:178-182`), `formatRelativeDeadline` (`:198-208`), `fetchErrorMessage` (`:211-220`), `orderedMembers` (`:223-229`), the submit state machine (`:240-384`) and `statusLiveLabel` (`:390-393`) are preserved verbatim except where enumerated (A)1 factors `handleFileChange`'s body into `acceptFile` and (B)9 changes two message strings. The `sr-only` live region stays **outside** all branching (`:397-404`, C16).

**3.1 Page frame.** `.page { max-width: 760px /* ref 1266 */; margin: 0 auto; padding: 18px 20px 24px /* ref 1265 */ }` (replaces `max-width:960px; padding:var(--space-3)`, `:561`). `header` keeps `display:flex; flex-direction:column` but its `gap`/`margin-bottom` go — the three rows below carry their own artboard margins.

**3.2 Breadcrumb + title + deadlines.**
- `.breadcrumb { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--muted); margin-bottom:10px /* ref 1267 */ }`; links inherit `--muted` (they are `<a>` — base.css paints `--primary`, override to `--muted`, hover underline stays); `.sep { color: var(--faint) }` (`ref 1267`, `aria-hidden`); `.current { color: var(--text) }` with `aria-current="page"`. Copy per (B)4. The course-name crumb links to `/courses/{courseSlug}` as today.
- `.title-row { display:flex; align-items:center; gap:12px; margin-bottom:6px /* ref 1268 */ }`; `h1 { flex:1 }` (global 21px/600 already matches `ref 1269`); the `flex-wrap: wrap` goes (the pill is `white-space:nowrap` and the h1 wraps its own text; the backlog item `flex-1-titles-may-collapse-to-zero-width` does not apply — the h1 has text and `min-width:auto`). `<StatusPill status={data.latest_status} />` unchanged.
- `.deadlines { display:flex; align-items:center; gap:14px; margin-bottom:18px /* ref 1272 */; flex-wrap:wrap }` (wrap is 5(b): the mono aside drops under the sentence at narrow widths rather than overflowing); rendered only when it would have content: `showResub = data.resubmission_deadline !== null && (latest_status is major_revision or minor_revision)` (the existing `:429` predicate), and the row renders when `showResub || data.hard_deadline !== null || data.soft_deadline !== null` — so a resubmission deadline outside a revision state, with no hard/soft deadline, renders no row (as today, where the same case renders an empty `.deadlines` div). `.deadline { font-size:12.5px; color:var(--muted) }`, `.deadline-resub { color: var(--status-needs-revision-fg) }` (`ref 1273` amber — this *is* the one amber: it names the revision the student must act on); `strong { font-weight:600 }`; `.deadline-soft { font-size:11.5px; color:var(--muted) }` + class `mono` (`ref 1274`). Branching as today (`:429-442`): resubmission line when in a revision state and it exists, else hard-deadline line when it exists; soft aside when it exists.

**3.3 Assignment card.** `.assignment { border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); padding:16px 18px; margin-bottom:14px /* ref 1277 */ }` wrapping `<h2>Assignment</h2>` (`font-size:14px; margin:0 0 8px /* ref 1278 */` — overrides the global 15px h2) and the existing `data-testid="assignment-html"` div (bind:this + `{@html}` on the same element, L1/M1 — unchanged). Content typography, scoped with the `.assignment-html :global(…)` form (never a bare `:global`): `p { font-size:14px; line-height:1.65; color:var(--text-2); margin:0 0 10px /* ref 1279 */ }`, `p:last-child { margin-bottom:0 /* ref 1280 */ }`, `a { color: var(--primary) }`, `ul, ol { padding-left: var(--space-4); margin: 0 0 10px }`, `ul > li { list-style: disc }`, `ol > li { list-style: decimal }` (the Slice-3 split form, `PageItem.svelte:51-63` — `reset.css:16` strips list markers, so without these an assignment's list renders as bare lines, which is what happens today), `code { font-family: var(--font-mono) }`. This is deliberately the assignment subset (a mini-project assignment is a short brief: paragraphs, a list, a link) — headings/pre/img rules from `PageItem` are not copied; if a teacher authors those they render at the reset's defaults, as today. Root `.assignment-html { overflow-wrap: anywhere }` (`PageItem.svelte:43` precedent).

**3.4 Group + submit grid.** `.grid2 { display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px; margin-bottom:14px /* ref 1283 — 1fr 1fr; auto-fit collapses to one column under ~600px, 5(b) */ }`. Both cells are `--surface` cards with `padding:14px 16px /* ref 1284 */` and an `<h2>` at `font-size:13px; margin:0 0 8px /* ref 1285 */`.
- **Group card** (`section.group-block`, seam kept): `<h2>Your group</h2>`; body `font-size:13px; line-height:1.7; color:var(--text-2) /* ref 1286 */`. Branches as today (`:454-467`): `group === null` → the existing D4 sentence (`:456-458`) as the body; one member → `Group {name} — <strong>{me} (you)</strong> — you're the only member so far.`; otherwise `Group {name} — ` + `orderedMembers` joined by `, `, with the `is_me` member wrapped in `<strong>` (`ref 1286`). `is_disabled` → the existing notice sentence (`:469`) as a `.notice { font-size:12.5px; color:var(--text-3); margin-top:6px /* 5(b), matches the hint scale */ }`; **`.group-disabled` (opacity) and `.group-disabled-notice`'s `var(--warning, #b85c00)` are deleted** (undefined token + hex fallback + opacity, three Constraint-1/2 violations in two lines).
- **Submit card** (`section.submit-block`, `data-testid="mp-submit-section"` kept; renders under the same `data.group !== null && data.can_submit !== null` guard, `:477`): when `can_submit === true` → §3.5; when a reason is present → §3.6.

**3.5 Submit card, can submit** (`ref 1288-1293`). `.submit-block.can { border:1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft) /* ref 1288 */ }` (the only card with an emphasised border — it is the one action on the page); `<h2>{submitHeading}</h2>` at `margin:0 0 9px /* ref 1289 */`; `.submit-row { display:flex; align-items:center; gap:9px /* ref 1290 */ }`.
- **Drop zone** = `<label class="drop" class:dragover={isDragOver} class:has-file={selectedFile !== null} ondragover ondragleave ondrop>`: `flex:1; display:flex; align-items:center; gap:8px; min-width:0; border:2px dashed var(--border-strong); border-radius:var(--radius); padding:4px 9px; font-size:12.5px; color:var(--muted) /* ref 1291 */; cursor:pointer`. Inside: the native `<input type="file" accept="application/pdf" data-testid="mp-file-input" disabled={submitState==='submitting'} onchange={handleFileChange} bind:this={fileInputEl}>` made visually hidden (`position:absolute; width:1px; height:1px; opacity:0; margin:-1px` — the `Login.svelte:137` idiom with its "sr-only, not a disabled treatment" annotation) and a `<span class="drop-label">` reading `Drop a PDF or click to pick`, or the picked filename (`--text`, `overflow-wrap:anywhere`) when `selectedFile !== null`. `.drop.dragover { border-color: var(--primary); background: var(--primary-soft) }` (5(b): the affordance the artboard cannot show). Focus: `.drop input:focus-visible { box-shadow:none }` + `.drop:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary) }` + `@media (forced-colors: active) { .drop:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset:-2px } .drop.dragover { outline: 2px dashed } }` (enumerated 18). Disabled (submitting): `.drop:has(input:disabled) { border-color: var(--border-faint); color: var(--faint); cursor: not-allowed }` — tokens, no opacity.
- **Submit** = `<Button variant="primary" disabled={!canSubmitClick} loading={submitState === 'submitting'} onclick={handleSubmit}>{submitState === 'submitting' ? 'Submitting…' : 'Submit'}</Button>` (`ref 1292`; `Button` supplies the spinner + disabled tokens). Disabled reason `title` (visual-spec:159): `selectedFile === null ? 'Pick a PDF first' : undefined` while idle/error; none while submitting (the label says it).
- **Submit error** (`submitState === 'error'`): `<div data-testid="mp-submit-error"><ErrorState title="Couldn't submit" message={submitErrorMessage ?? undefined} onretry={submitErrorIsNetwork ? handleSubmit : undefined} /></div>` rendered under `.submit-row` with `margin-top:10px` (5(b), the history body gap). The existing `retry-without-re-pick` semantics (`:264-267`, the file is kept in `error`) are unchanged.

**3.6 Submit card, cannot submit** (precondition banner, `mathion-visual-spec.md:289-293`, geometry `ref 1372-1373`): the card body is replaced by `<div class="precondition" data-testid="mp-cannot-submit">{REASON_LABELS[reason]}</div>` — `border-left: 3px solid var(--primary); background: var(--surface-2); padding: 14px 16px /* 5(b): no artboard counterpart for this banner's box — matches the inline-state row, ref 1378 */; font-size:13px; line-height:1.55; color:var(--text-3) /* ref 1373 */; border-radius: var(--radius)`; no `<h2>`. The card's own `--border` stays; the `.banner-info` rule with its `var(--info, #ccd)`/`var(--info-bg, #eef)` fallbacks (`:578`) is deleted (two undefined tokens + hexes).

**3.7 Fetch-error and loading branches.** `{#if isLoading}` → `<Skeleton rows={4} />`. `{:else if fetchErrorMessage !== null}` → `<div data-testid="fetch-error-banner"><ErrorState variant="page" title="Mini-project unavailable" message={fetchErrorMessage}>{#snippet action()}<Button variant="secondary" onclick={() => navigate(`/courses/${courseSlug}`)}>Back to course</Button>{/snippet}</ErrorState></div>` (`ref 1389-1391`; the 403/404/generic messages `:213-219` unchanged). `.banner`, `.banner-error` (`:577`, `var(--danger-bg, #fee)`) are deleted.

**3.8 Submission history** (`ref 1297-1332`, D6 uniform). `section.history` (seam) with `<h2>Submission history</h2>` at `font-size:14px; margin:0 0 10px /* ref 1297 */`; entries newest-first as today (`data.submission_history` order is preserved; the existing test pins `Submission 2` before `Submission 1`).
- `section.history-entry { border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); overflow:hidden; margin-bottom:10px /* ref 1298 */ }`, `:last-child { margin-bottom:0 }`.
- `.history-entry-header { display:flex; align-items:center; gap:9px; padding:9px 12px; background:var(--surface-2); border-bottom:1px solid var(--border-soft) /* ref 1299, substitution table */ ; flex-wrap:wrap }`: `<h3>Submission {n}</h3>` at `font-size:13px /* ref 1300 */` (overrides global 14px); `<span class="meta mono">{formatLocalWithTz(entry.submitted_at)} · {entry.submitted_by_full_name}{entry.submitter_is_me ? ' (you)' : ''}</span>` at `font-size:11.5px; color:var(--muted) /* ref 1301 */`; `.pills { margin-left:auto; display:flex; align-items:center; gap:6px /* ref 1302 */ }` holding, in order, the Late pill (`{#if entry.is_late}<span class="pill pill-late" title=…>Late</span>` — geometry from `StatusPill.svelte` `padding:3px 8px /* ref 1112 */; border-radius:var(--radius-pill); font-size:11px; font-weight:500; white-space:nowrap`, tokens `--status-not-submitted-bg/fg` per D3; the `title` string logic `:528-530` unchanged) then `{#if entry.evaluation}<StatusPill status={entry.evaluation.result} />{/if}` (D8).
- `.history-entry-body { padding:12px; display:flex; flex-direction:column; gap:10px /* ref 1304 */ }`.
- **File tile** `.file { display:flex; align-items:center; gap:9px; padding:8px 10px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface-3) /* ref 1305 */ }`: `.file-kind { display:flex; align-items:center; justify-content:center; width:32px; height:28px; border-radius:4px /* ref 1306 */; background:var(--surface-2) (substitution table); font-size:9.5px; font-weight:600; color:var(--muted); flex:0 0 auto }` with class `mono` and text `PDF` (`aria-hidden="true"` — the filename carries the meaning); `.file-name { display:flex; flex-direction:column; gap:1px; flex:1; min-width:0 /* ref 1307 */ }` → `<span class="name">{entry.filename}</span>` (`font-size:12.5px; color:var(--text); overflow-wrap:anywhere`) + `<span class="size mono">{formatFileSize(entry.file_size)}</span>` (`font-size:11.5px; color:var(--muted)`); `<a class="dl" href="/api/submissions/{id}/file" download title="Download" aria-label="Download {entry.filename}">` with the arrow SVG (`ref 1308`: `<line x1="8" y1="3" x2="8" y2="10.6"/><polyline points="4.8,7.6 8,10.8 11.2,7.6"/><line x1="3.4" y1="13" x2="12.6" y2="13"/>`, 12×12) styled `display:flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:var(--radius); border:1px solid var(--border-strong); background:var(--surface); color:var(--text-3); flex:0 0 auto /* ref 1308 */` and `:hover { text-decoration:none; color: var(--text) }`.
- **Feedback block** (`{#if entry.evaluation}`): `.feedback { border-left: 3px solid …; padding: 2px 0 2px 11px; display:flex; flex-direction:column; gap:5px /* ref 1310 */ }` with the rule colour by result via a class: `.feedback.needs-revision { border-color: var(--status-needs-revision-bg) }` (major + minor), `.feedback.rejected { border-color: var(--status-rejected-bg) }`, `.feedback.accepted { border-color: var(--status-accepted-bg) }` — the *background* tokens, as the artboard's `#FDECC8` is the pill background, not its text. `.feedback-meta { font-size:12.5px; color:var(--muted) /* ref 1311 */ }` reading `{LATEST_STATUS_META[ev.result].label}` + `{#if ev.score !== null} · score <span class="mono">{ev.score}/100</span>{/if}` + ` · {ev.evaluated_by_full_name}, <span class="mono">{formatLocalWithTz(ev.evaluated_at)}</span>`; `.feedback-text { font-size:13px; line-height:1.6; color:var(--text-2); text-wrap:pretty /* ref 1312 */ }` reading `ev.feedback_text || 'No written feedback'` (today's fallback, `:548`); `{#if ev.has_feedback_file}<a class="feedback-file" href="/api/evaluations/{ev.eval_id}/feedback-file" download>Download feedback</a>{/if}` at `font-size:12.5px` (no artboard counterpart — 5(b), a text link at the meta scale; the app has a feedback file where the artboard has none).
- `evaluationResultLabel` (`:236-238`) stays as the label source for `.feedback-meta`.

### 4. Cross-cutting

- **Page background.** Cards are `--surface` on the `--bg` page; the backlog item `page-background-reads-gray-against-header` is a polish-slice question and this slice follows the artboard (`ref 1257` `#FBFBFC` = `--bg`).
- **Forced colors.** Beyond the drop-zone block (enumerated 18), no new forced-colors rules: the card borders, the `--danger`/`--primary` left rules and the pill borders survive forced-colors as borders; the skeleton bars become invisible there (background-color is dropped) but the `role="status"` text still announces — accepted, and identical to how any placeholder fill behaves under forced colors.
- **Reduced motion.** Nothing animates in this slice except `Button`'s existing spinner.

---

## Data flow & error handling

No change to fetching, refetch sequencing, the single-flight gate, the `lastRefetchId` monotonic guard, the visibilitychange listener, the 409 refetch, or the success-path write-back (`:356-384`). The submit state machine's four states and transitions are unchanged; the drop path enters it through the same `acceptFile` as the picker. `CourseList`'s `reloadTick` is the only new reactive input (enumerated 2), read at the top of the existing effect so the fetch re-runs on Retry and still runs on mount.

---

## Testing strategy

`mount`/`unmount`/`flushSync` only (never `@testing-library`); TDD RED→GREEN per task; assert **load-bearing structure/classes/text/aria**. jsdom cannot compute the cascade → geometry/colour pins are verified by `svelte-check` (no `css_unused_selector` growth), `vite build`, and the **hash-coupled dist-CSS greps** of the Slice-3 gate (declaration-level regexes terminated at both ends, anchored on a gate-verified-unique class hash, parentage checked for the forced-colors block). Per task, the plan supplies: the test code, the source greps, the dist greps with their anchor classes (`skeleton`, `empty-state`, `error-state`, `drop`, `history-entry-header`, `feedback`, `precondition`), and the mutation checks ("delete the line, watch the named test fail, restore") for every guard the gate would otherwise miss — the Slice-3 lesson.

**Per-task gate** (inherited): svelte-autofixer clean on each edited `.svelte` → `npm test` (full suite) → `npm run check` (0 errors, warnings ≤ 31) → `npm run build` → the task's greps. Then codex@high + first-party@Opus-xhigh review, fix, re-review until clean, user OK.

**Correctness-axis lane.** One review round per task is pointed explicitly at *rendered* correctness (not gate-detectability): narrow widths (320px: the grid collapses, the filename wraps, the deadline aside drops under), a 24-character status label in the header strip, a group with eight members, an assignment with a list.

**Browser pass (user-owned, end of slice)** against the real stack: `./run-slice3-surfaces.sh` (backend :8000, six mini-project states with real submission and feedback files; `--ungrouped` for the pending-group card), `npm run dev` in `frontend/` (:5173), the reference canvas open beside it. Checklist: the six 9c states (not submitted / awaiting / rejected / major / minor / accepted) + pending group; a submit with a dropped PDF and with a picked PDF; a non-PDF drop (guard error inline); the fetch-error page (`/courses/demo-course/blocks/no-such-block/mini-project` → 404 state); `/courses` skeleton (throttle the network in devtools) and its inline error with Retry (stop the backend, Retry, start it); the empty course list needs a user with no enrolments — verify the `EmptyState` visually on `/courses` by temporarily withdrawing the demo enrolment via the seed's `--remove` or accept the primitive's own test as sufficient (user's call at pass time).

---

## Task decomposition (4 tasks; carried verbatim into the implementation plan)

| task | delivers | files |
|---|---|---|
| **T1 — primitives** | `Skeleton`, `EmptyState`, `ErrorState` + 3 test files (§1) | `components/ui/{Skeleton,EmptyState,ErrorState}.svelte`, `tests/{Skeleton,EmptyState,ErrorState}.svelte.test.ts` |
| **T2 — student page adoption** | §2 table; `reloadTick` Retry; `.empty`/`.error` rule removals; test updates + Retry/loading tests | `pages/{CourseList,CourseView,SequencePlayer}.svelte`, `components/items/QuizItem.svelte`, `tests/{CourseList,CourseView,SequencePlayer,QuizItem}.svelte.test.ts` |
| **T3 — MP page: frame, header, assignment, group, history, fetch-error, loading** | §3.1-3.3, §3.4 (the grid + the group card; the submit `section` moves into the grid's second cell **with its current markup untouched** — native input, raw button, `.banner-*` divs — so the page renders correctly between T3 and T4), §3.7, §3.8; copy (B)4-8, 10; structural 17, 19-21; the `.group-disabled` and fetch-error `.banner-error` deletions | `pages/MiniProjectDetailPage.svelte`, `tests/MiniProjectDetailPage.svelte.test.ts` |
| **T4 — MP page: submit card** | §3.5-3.6; drop zone (A)1 + focus (18); `Button` primary; inline `ErrorState` for submit errors; copy (B)9, 11; precondition banner; the `.banner`/`.banner-info` deletions and the `mp-submit-btn`/`mp-retry-btn` seam changes (21) | same two files |

Order T1 → T2 → T3 → T4 (T2-T4 consume T1; T4 builds on T3's frame). Then the **whole-branch final review** (both lanes) and the **browser pass**.

## Git stacking (decided)

`main` ← `feat/visual-refresh-slice2-student-core` ← `feat/visual-refresh-slice3-student-content` (`22549e2`) ← **`feat/visual-refresh-slice4-student-remainder`** (this branch). One commit per task (amend-in-place after review fixes, as in Slice 3), plus the spec and plan commits. Nothing is pushed or merged until the final polish slice is done and the user says so.
