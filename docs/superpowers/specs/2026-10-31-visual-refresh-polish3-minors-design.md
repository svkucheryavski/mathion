# Visual refresh — Polish 3: the reviewers' minors that users meet

**Status:** rev 1 (2026-10-31), draft for review.
**Branch:** `feat/visual-refresh-polish3-minors`, cut from the Polish 2 tip `71dd8cc`. It stays local: no push, no merge.
**Workspace:** `.superpowers/sdd/2026-10-31-visual-refresh-polish3-minors/` (`inventory.html`: the grouped backlog and the recon results).

## Goal

Every slice of the visual refresh deferred its reviewers' Minor findings to `docs/backlog/`, about 300 of them in 15 files. Most are internal: gate patterns a future edit could slip past, missing tests, races the reviewers themselves graded "contrived". Polish 3 takes the ones a student, teacher or author actually meets before the beta:
- what looks wrong on screen;
- behaviour a user would notice, the biggest being that a student's unsubmitted quiz answers vanish on any move away from the quiz;
- keyboard focus that falls to the page (`<body>`) after an action, so the next Tab starts at the top, and in a modal ⌘S opens the browser's own Save dialog.

Polish 1 (confirms) and Polish 2 (named items) are done. After Polish 3 comes the beta pass.

## Scope

**In:** the items in §Student quiz answers and in-app links, §Course files open in the tab, §Focus after an action, §The look, §Behaviour, §Narrow screens. Each names the backlog entry it closes.

**Dead code** (backlog group 5) is in only where a task already edits the file: e.g. the dead `data.can_submit !== null` conjunct in `MiniProjectDetailPage.svelte`, which Tasks below touch anyway. A file is not opened just to clean it.

**Not in:**
- rare races and timing edge cases (late responses after a version switch, double-clicks on controls with no in-flight guard, IME Enter in Safari);
- gate hardening and test-gap notes, except the gate rows and tests each change needs;
- the beta carry list: VoiceOver, forced colors / Windows High Contrast, reduced motion, iframe focus, touch devices, the 13d superuser page;
- anything below 400px wide (D82).

These stay in their backlog files untouched, except the stale entries closed in §Backlog lifecycle.

## Decisions

The user's, made in the brainstorm on 2026-10-31.

- **D82 — The narrowest supported screen is 400px.** "Modern devices are quite large even cheap ones." Narrow-width shots and rules are taken at 400px. A finding that appears only below 400px is not a defect; backlog entries measured at 320px or 375px are re-checked at 400px (§Narrow screens).
- **D83 — A student's unsubmitted quiz answers are kept while they move around.** Typed or picked answers that are not submitted stay in memory per quiz, so going to another item, another sequence, the course page or the course list and back shows them again. They go away on submit, on sign-out, on a reload and when the tab closes. A reload or a tab close with unsaved answers anywhere shows the browser's own leave-page warning. A link to another Mathion page inside authored content stays in the app (no reload).
- **D84 — Course files open in the tab when the browser can show them.** A link to a course file (the `/assets/{version_id}/{filename}` endpoint) opens a PDF, PNG, JPEG or GIF in the new tab, in the browser's own viewer, which has its own download button. Every other type downloads as today. (The user chose "PDF and images"; WebP and SVG are not accepted for upload today, so they cannot arrive. Should either ever be allowed, SVG must download: it can carry script.)
- **D85 — Loose lists group by item.** In authored content, paragraphs inside one list item sit closer together than the items do: on the page scale 8px inside an item and 16px between items. Tight lists are unchanged.
- **D86 — One loading look: the skeleton rows.** The five teacher screens that show an italic "Loading…" line (`LoadingPlaceholder`) show the grey skeleton rows (`Skeleton`) like the student and editor pages. `LoadingPlaceholder` is deleted. The boot spinner in `App.svelte` and `Login.svelte` stays (there is no page yet to hold skeleton rows).
- **D87 — "0 uses" is a label, not a button.** On a run's Assets tab, a file used by no mini-project shows its grey "0 uses" chip as plain text: no button, no empty "used by" panel, one Tab stop fewer. A chip with uses keeps opening its list.

### The controller's calls

Not decided by the user; listed here so the user can check them while reading. Each is detailed in its section.

- **C1** Error banners take the danger panel's colours (`--danger-panel-bg` / `--danger-panel-fg`); status badges and pills keep `--status-rejected-*`.
- **C2** `--cancel-border` gets a value of at least 3:1 against every background a Cancel sits on.
- **C3** The three invalid fields without a red edge get the editor's `1.5px solid var(--danger)` edge.
- **C4** The Group columns of Progress and Submissions are capped at their set width; a long name wraps.
- **C5** The quiz card prompt in the editor takes `--text-2`, as the student view and the preview do.
- **C6** In-app links go through one shared click helper that lets Cmd/Ctrl/Shift/Alt-clicks and middle clicks through to the browser; one delegated handler routes same-origin links in authored content.
- **C7** The focus mechanism of §Focus after an action: busy buttons stay focusable, one repair helper, a modal backstop, two FocusTrap changes.
- **C8** The Versions page create form asks before discarding typed text on Cancel and on in-app navigation.
- **C9** Staff notification e-mails link to the `/teaching/…` run address.
- **C10** The backend rejects a run start date after its end date, and an explicit `null` for a required quiz field with a 422.
- **C11** A bare address the sanitiser cannot keep as a link stays plain text.
- **C12** A file's response carries `X-Content-Type-Options: nosniff`, so a browser never second-guesses its type.
- **C13** Each player item gets its own component instance, which fixes quiz → quiz carrying the first quiz's result and answers (found in the builder check); coming back to a submitted quiz behaves as a remount does today.
- **C14** Drafts survive an expired session (the 401 → sign-in round trip) and belong to the user who typed them; an explicit sign-out, or a different user signing in, drops them.
- **C15** The 400px shots are taken before the plan; a finding is real breakage (sideways scroll, a clipped or unreachable control, unreadable text) or anything the user flags in the shots.
- **C10 (detail)** Run dates stay editable one at a time; the 422 says to change the end date first when moving a run later.

## Student quiz answers and in-app links

### Where answers live today

`QuizItem.svelte:17` holds the answers in component state (`let answers = $state({})`). A move to a page, a video, an app, the course page or anywhere else unmounts it, and the answers are gone: Previous / Next (`SequencePlayer.svelte:121`, `gotoFlat` navigates), the strip, the breadcrumbs, a content link. Nothing warns. A same-origin content link also reloads the whole app, since nothing intercepts it (`externalLinks.ts` only adds `target` to links that leave).

**A move from one quiz straight to another is worse: it does not unmount** (builder check, verified). `SequencePlayer.svelte:212` renders `<ItemRouter item={currentItem}>` with nothing keyed on the item; `ItemRouter` stays on its quiz branch, so the same `QuizItem` instance gets the new `item`, and `answers`, `lastResult`, `revealed` and `autoRevealed` (`QuizItem.svelte:17-21`) carry over. After submitting quiz A, Next to quiz B likely shows B locked with A's result, and answers left in memory would be sent with B's submit (`:98`) under A's question ids. The same holds across sequences, since `SequencePlayer` itself is reused when only its address changes. No test covers two quizzes in a row.

**C13** — each item gets its own component instance (`{#key currentItem.id}` around `ItemRouter`, or inside it around the quiz; the builder picks and says why). A test drives quiz A → submit → Next to quiz B and asserts B opens unanswered and unlocked, and that B's submit sends only B's question ids. Coming back to a quiz already submitted shows what a remount shows today: an empty form with the attempts count, or the reveal once attempts are used up. Showing the last result again is not in scope.

### Drafts (D83)

- A small store (e.g. `stores/quizDrafts.svelte.ts`) holds the unsubmitted answers, keyed by course slug and item id. `QuizItem` starts from the stored draft when one exists and writes every change back. A key with no answers is removed, so "unsaved answers" means at least one question answered.
- A successful submit removes that quiz's draft (the result shows what was sent). "Try again" starts from an empty draft, as today.
- **Sign-out versus an expired session (C14).** The session store has one `clearSession()` (`stores/session.svelte.ts:11`) with two callers: `logout()` (`lib/auth.svelte.ts:49`), the user choosing to sign out, and the 401 handler (`main.ts:12-17`), which sends the student to `/login?next=…` without a reload. The likeliest 401 is a Submit after a long time on a quiz, exactly the answers D83 keeps. So:
  - drafts are not cleared in `clearSession()`;
  - `logout()` clears every draft;
  - every draft records the id of the user who typed it, and when a session starts (sign-in or bootstrap) for a different user, all drafts are dropped. The same student signing back in after a 401 finds their answers.
- While any draft holds answers, a `beforeunload` listener asks the browser to warn. It is the same mechanism `DirtyGuard.svelte:61` uses; the listener is added when the first draft fills and removed when the last empties.
- In-app moves never ask: the answers are kept, so there is nothing to lose.
- What a revealed or exhausted quiz shows is unchanged (`valueFor` prefers `revealed.student_answer` when the reveal auto-loaded).
- Left to the builder: whether the key also carries the version id (a student's enrolment pins one version, so the slug may be enough; say which and why in the plan).

### Content links stay in the app (D83)

One delegated click handler (on `document`, registered once in `App.svelte` or the router) routes a click on an `<a href>` inside authored content (`.prose`) through `navigate()` when all of these hold:
- the click is a plain primary click (no modifier, `button === 0`) and not already `defaultPrevented`;
- the link has no `target`, so `externalLinks` did not send it to a new tab (other sites, `/assets/…`, `/api/…`);
- it resolves to Mathion's own origin;
- it is not a same-page `#anchor`: those keep the browser's default. The player keeps `#item=` in its own address; a content `#heading` link does not match that pattern (builder check), and authored headings carry no `id` (`_ALLOWED_ATTRS`), so such a link scrolls nowhere today. A test pins only that it leaves the player on its item.

`externalLinks.ts` itself is unchanged, so its Polish 2 gate rows hold. In the editor preview the same handler applies; `navigate()` already runs DirtyGuard there.

### Modifier clicks (C6, backlog polish2 Safari pass "Cmd/Ctrl-click", slice5c "row title can't open in a new tab")

Today only `VersionEditPage.svelte:551` returns early on a modifier or a non-primary button. Every other in-app link does `e.preventDefault(); navigate(…)` unconditionally: `CourseCard.svelte` (five links), `SequenceLink.svelte:20`, `AppHeader.svelte:24,33,38`, `SequencePlayer.svelte:164`, `MiniProjectDetailPage.svelte:478`, `TeachingCrumbs.svelte`, and any others a grep for that idiom finds. One helper (e.g. `routeClick(e, href)` in `router.svelte.ts`) does the check and the navigate, and every site uses it; `VersionEditPage`'s local version goes too. The Versions page row title, a `<button>` today, becomes an `<a href>` with the helper.

### The course crumb while the course loads (backlog polish2 D70 review)

`MiniProjectDetailPage.svelte:477-478` renders the course link with `currentCourse.value?.course.name ?? ''`: while `loadCourse` runs, or after it fails, it is an empty, focusable, nameless link, and after a cross-course move it briefly shows the old course's name. The link and its separator render only when `currentCourse.value?.slug === courseSlug`. The player's crumbs have the same expression and get the same rule.

## Course files open in the tab (D84, C12)

`backend/mathion/api/assets.py:189` returns `FileResponse(filepath, media_type=asset.mime_type, filename=filename)`, which sends `Content-Disposition: attachment`. For the stored MIME types `application/pdf`, `image/png`, `image/jpeg` and `image/gif` it sends `inline` with the filename instead (Starlette's `content_disposition_type="inline"`); every other type keeps `attachment`, including `js` (interactive apps' scripts) and `csv`. Every response from this endpoint gets `X-Content-Type-Options: nosniff`. Images embedded with `<img>` are unaffected either way. The frontend needs no change: `externalLinks` already opens `/assets/…` links in a new tab.

Run files under `/api/…` (submission and feedback PDFs) are not course files and keep their behaviour.

Tests: one per inline type and one attachment type (`.csv`, `.js`) asserting the header, and `nosniff` on both.

## Focus after an action (C7)

### What is still reachable

The recon (2026-10-31) re-checked every entry. Fixed since they were filed, and closed in the backlog: Versions Disable / Enable, deleting the expanded block, a successful create-block / create-sequence, the quiz Retry, the Publish ↔ Unpublish swap, DangerConfirm (it restores after settle). Still reachable:

| # | Site | What happens |
|---|---|---|
| F1 | `VersionsPage.svelte:345` Duplicate's Cancel; Create copy / Create | Cancel unmounts itself; the submit buttons are natively `disabled` while busy, so a failure leaves focus on `<body>`. |
| F2 | `BlockAccordion.svelte:398`, `VersionEditPage.svelte:686` the add rows' ✓ | A failed create from a clicked ✓ (disabled while busy). Enter in the field is fine (the input is only `readonly`). |
| F3 | `ItemEditorModal.svelte:376-396` Save, Discard, ×; `AppBody.svelte:209-219`; `MarkdownEditor.svelte:316` | Save disables while saving, Discard once clean, × and the body's controls while frozen. With focus on `<body>`, ⌘S misses the modal's own check (`:242`, `e.target.closest('section.modal-panel')`) and opens the browser's Save dialog. |
| F4 | `NewItemModal.svelte:124`, `VersionSettingsModal.svelte:136-137` | Create / Save disabled while busy; a failure leaves focus on `<body>`. The quiz modals (`NewQuestionModal`, `QuestionTextModal`, `ExplanationModal`) already keep the button enabled with `loading` and a re-entry guard: the model to copy. |
| F5 | `FocusTrap.svelte:52-64` | Autofocus picks the first matching `[data-autofocus]` even when it is disabled; `focus()` is a no-op and focus stays behind the modal. Reachable today only through ItemEditorModal's title pencil (`:353`) while `quizEdits.locked`. |
| F6 | `ItemEditorModal.svelte:344-346` the header title ✓ | A 403/409 reload flips `canSave` and disables the focused ✓. `InlineInput.svelte:31-35` solves this with a `$effect.pre` that moves focus before the disable. |
| F7 | `RunOverviewTab.svelte:171-198`, `:366-378` | A failed Publish whose refetch reveals a new violation natively disables Publish under focus. |
| F8 | `RunRosterTab.svelte:826` + `:534-563`; `:120`, `:639`, `:650` | The row group `<select>` is natively disabled while its request runs; the open add row unmounts if the run turns draft (its toggle is disabled too). |
| F9 | `DashboardSidePanel.svelte:911-919`, `loadThread :195-218` | The first thread load swaps a focused create form for the evaluation card. |
| F10 | `RosterImportModal.svelte:184-197`, `:261` | Done sets `closing`; `closeDisabled={submitting \|\| closing}` disables the focused ×. `closeForCurrentStage` already ignores × and Esc while closing. |
| F11 | `AssetSidebar.svelte:67-71` | A failed list reload replaces the rows under a focused question. |
| F12 | `VersionsPage.svelte:35`, `:53-63`, `:280-281` | A course switch unmounts the whole frame, `<h1>` included; nothing refocuses when the new course loads. `creating` and `createAsk` also survive the switch (backlog polish1 Task 4, slice5a T2). |
| F13 | `FocusTrap.svelte:48`, restored `:70-74` | Safari does not focus a clicked button, so a modal or panel opened by a mouse click records `<body>` as its return target, and closing it leaves focus nowhere (the next Tab goes to the address bar). Openers: the Progress and Submissions side panels (`RunProgressTab.svelte:328,333`, `RunSubmissionTab.svelte:134,138`), New run (`RunListPage.svelte:112,130`), Publish conflicts (`RunDetailPage.svelte:320`), Import roster from the toolbar, the Mini-project editor (`RunMiniProjectsTab.svelte:259,322`). |

### The mechanism

1. **A busy button stays focusable.** Save, Create, Create copy and the add rows' ✓ use `aria-disabled` with a re-entry guard (`Button`'s `loading` already does this, `Button.svelte:21-23`) instead of native `disabled` while a request runs. They look the same. Natively disabled stays right for a control that is unavailable for a reason other than "busy" (Discard when clean, Create with an empty title). Applies to F1, F2, F3 (Save), F4, F10 (drop `closing` from `closeDisabled`).
2. **One repair helper.** `repairFocus(...chain)` in `lib/askInPlace.svelte.ts`, beside `usable` and `focusIsFree`: after a tick, if focus is on `<body>` (or null, or on a modal panel itself), focus the first `usable` element of the chain and verify it took. It never moves focus the user put somewhere else. It replaces `lib/focusFirst.ts` (which lacks the `inert` check) and the scattered `if (document.activeElement === document.body)` checks the builder meets in touched files. Each site passes its own chain, ending in a heading with `tabindex="-1"` or the modal panel:
   - F1 Cancel → the row's Duplicate, then the page `<h1>`;
   - F1, F2, F4 failure → the first errored field, then the add line / Cancel, then ×;
   - F3 Discard → Title, then ×;
   - F7 `'failed'` → Publish, then the readiness heading;
   - F8 select → the same select once enabled, then the roster search; the draft flip → the + toggle, then the search;
   - F9 → the Evaluation heading, then ×;
   - F11 → the drop zone, then the panel.
3. **A modal backstop.** In `Modal.svelte`'s keydown handling: when this modal is the top one and focus is on `<body>`, a key press first puts focus on the panel (and a ⌘S is then handled by the modal, never the browser). This catches any drop the chains miss, including the frozen-control drops of F3 while a save runs.
4. **FocusTrap: usable autofocus (F5).** The autofocus loop skips a match that is not `usable` and falls through to the next selector, then ×, then the panel.
5. **FocusTrap: the opener after a Safari click (F13).** A capture-phase `pointerdown` listener (one, app-wide) remembers the last pressed button or link. When a FocusTrap mounts with focus on `<body>`, it takes that element as its return target if it is still connected. Nothing changes where focus was already on the opener (keyboard, Chrome). If tests show the record to be unreliable, the fallback is an explicit `returnTo` prop passed by each opener in the list above; the plan says which.
6. **F6** takes `InlineInput`'s move-before-disable `$effect.pre`.
7. **F12** gets an effect that, when the new course has loaded and focus is on `<body>`, focuses the `<h1>`; the `courseSlug` effect also dismisses `createAsk` and resets `creating`.

Tests: each site gets a jsdom test that disables or unmounts the focused control as the real flow does and asserts `document.activeElement` afterwards. jsdom drops focus from a disabled element only if the test removes it or the component re-renders it; the builder confirms the red state first for each, as Polish 1 did. F13's Safari behaviour cannot be reproduced in jsdom (a click there does not focus either, which helps): the test focuses `<body>`, dispatches `pointerdown` on the opener, opens, closes, and asserts focus on the opener.

## The look

| Item | Where | Change | Closes |
|---|---|---|---|
| Error banners (C1) | `RunOverviewTab .ov-err`, `DashboardSidePanel:974-978`, `RosterImportModal:492-512`, `MiniProjectModal:759-763`, `RunMiniProjectsTab:393-395`, `RunAssetsTab .banner-error`, `NewRunModal:205` | Banner fills and text take `--danger-panel-bg` / `--danger-panel-fg`; existing `border-left: 3px solid var(--danger)` stays. Badges, pills, the Groups `.cap-full` badge and the quiz `reveal-wrong` options keep `--status-rejected-*` (they are statuses, not errors). The builder lists any banner the grep finds beyond these seven. | polish1 "two pinks" |
| Cancel border (C2) | `theme-default.css:84` | A value ≥3:1 against `--surface`, `--focus-2`, `--danger-panel-bg` and every other ground a Cancel sits on; computed, not eyeballed, and the comment states the ratios. | polish1 `--cancel-border` |
| Invalid fields (C3) | `VersionEditPage.svelte:676`, `BlockAccordion.svelte:388`, `AccordionHeader.svelte:194` | `[aria-invalid='true'] { border: 1.5px solid var(--danger) }`, staying red when focused, as the other editor fields. | polish1 "three fields" |
| Group column (C4) | `RunProgressTab` (6rem), `RunSubmissionTab` (12rem) | A wrapper like Progress's `.name-box`: width = the column's width less the cell padding, `overflow-wrap: anywhere`. The scroll padding (D73, D74) then holds for any name. | polish1 2.4.11; polish2 D73/D74 review |
| Code in a question | `InlineConfirm.svelte:109` | The chip's background `--surface` → `--surface-2`. | polish1 Task 1 |
| Long words | `RunGroupsTab .g-name`, `RunRosterTab .ro-err`, `MiniProjectDetailPage .members` | `overflow-wrap: anywhere`. | slice6a T9, slice6c whole-branch, slice4 |
| Table corners | `.mp-table`, `.assets-table`, `.teach-table`, `.runs-table` | `border-collapse: separate; border-spacing: 0`, as the Progress and Submissions grids; the row lines move to cell borders so they still draw once. Shots before and after. | slice6a T10, T11 |
| Crumb hover | `MiniProjectDetailPage .breadcrumb a` | Darkens to `--text` on hover, as the player's. | polish2 Safari pass |
| Mini-project header | `MiniProjectDetailPage` `header`, `.drop:has(input:disabled)` | The header keeps its bottom space when there is no deadline row; the disabled colour moves to `.drop:has(input:disabled) .drop-label`, where it paints. | slice4 |
| 0 uses (D87) | `RunAssetsTab.svelte:773-777` | At 0 uses the chip is a `<span>` with the same look. | slice6a "0 uses" |
| Loose lists (D85) | `styles/content.css:37` | Inside a list item, a paragraph after a paragraph sits `--space-2` below it; loose items sit `--space-3` apart. The compact scale keeps the same relation (inside closer than between) with values from the space scale, chosen at the look check. Tight lists unchanged. | polish2 Task 3 design question |
| Quiz card prompt (C5) | `QuestionCard.svelte:146` `.qtext` | `--text` → `--text-2`. | polish2 whole-branch |
| Loading (D86) | `RunSubmissionTab`, `RunProgressTab`, `TeacherRunListPage`, `RunDetailPage`, `RunListPage` | `<Skeleton>` with a row count that matches each surface; `LoadingPlaceholder.svelte` and its tests deleted. The label (`role="status"` text) carries over. | slice4 "three loading primitives" |
| New run strip | `NewRunModal.svelte:193`, `.nr-strip-val` | In the no-version branch the reason wraps instead of ending in an ellipsis. | slice6b Task 2 |

## Behaviour

- **Versions create form (C8).** `cancelCreate` (`VersionsPage.svelte:104`) asks `DISCARD_ASK` in place when the label holds typed text, as Esc already does (`:116-123`); the form registers with the dirty registry while it has text, so an in-app link asks through DirtyGuard. (polish1 "VersionsPage's create form")
- **A file dropped beside the drop zone.** While `MiniProjectDetailPage` is mounted, `dragover` and `drop` on the window are cancelled for drags carrying files, so a PDF dropped beside the dashed zone no longer navigates the browser to the file. The zone itself works as today. (slice4)
- **Course list error.** `CourseList.svelte` holds the `ApiError | null` and branches on `!== null`, like `CourseView`; a test with `detail: ''` is red first. (`courselist-empty-api-error-detail-shows-empty-state.md`)
- **Offline failures say so.** Where a write catches only `ApiError` and a network `TypeError` passes silently, an `else` toasts a plain message: the Overview groups switch (`RunOverviewTab.svelte:156-158`), `doPublish` / `doUnpublish` (`RunDetailPage`), Teachers add and remove, group delete, roster add. An Overview field shows `displayMessage` for an `ApiError` and "Could not save." otherwise, never the browser's raw "Failed to fetch" / "Load failed". The builder greps for the same shape in the touched files. (slice6a T9, final; slice6c T1, T2, T3, whole-branch)
- **Bulk move never sticks.** In `RunRosterTab`'s bulk dispatch, the refetch after the operations (`await onRefetchRosterData()`, ~`:309`) is wrapped so a failure still settles the result banner with Dismiss and unlocks the controls. (slice6c T4)
- **404 label.** The label for each landing path lives beside `defaultLandingPath` in `router.svelte.ts`, so path and name come from one place; `NotFound.svelte:12` uses it. (polish2 Task 5)
- **Staff e-mails (C9).** `_staff_url` (`backend/mathion/notifications/templates.py:35`) builds the `/teaching/{course_slug}/runs/{id}` address; `test_notifications_templates.py` changes with it. The old routes and RunsRedirect stay for old e-mails and bookmarks. (slice6a T4)
- **Run dates (C10).** `api/runs.py` compares the new end date with `updates.get("start_date", run.start_date)`, and a new start date with the end date in force, so neither field alone can invert the range; tests for both. The Overview keeps editing one date at a time, so moving a whole run later means changing the end date first. The 422 says so in plain words, e.g. "Start date must be on or before the end date (31 Mar). To move the run later, change the end date first." The end date's message mirrors it. The field shows the message through `displayMessage`, as today. (slice6c T1)
- **Explicit nulls (C10).** A quiz option or question PATCH with `{"is_correct": null}` or `{"text": null}` returns 422, not 500 (a validator on the update models). (slice5d T1)
- **Broken bare addresses (C11).** A bare address the sanitiser strips the `href` from (`https://a.b:99999999`, `https://[::1]/x`, `https://%zz.org`, `https:///`) stays plain text instead of becoming an underlined anchor that does nothing. Either reject it in `_link_tokens` with `urllib.parse.urlsplit` (including reading `.port`), or unwrap href-less anchors after `nh3.clean`, which also covers the authored forms; the plan says which. Tests: each of the four stays plain. (polish2 Task 6)

## Narrow screens (D82)

**When (C15):** the 400px shots come first, as recon before the plan is written, so each finding is planned into the task that owns its file instead of reopening a committed task. A finding left without an owning task becomes one small task of its own.

**What counts:** a page that scrolls sideways; a control that is clipped, overlapped or out of reach; text cut off with no way to read it. Anything else that looks off counts only if the user flags it while looking at the shots.

Shots of every screen family: Login, course list, course page, player (page, quiz, video), mini-project page, Teaching, a run's tabs, the editor, the Versions page, the 404. Known entries to re-check:
- the AppHeader ("Dev" and Logout ran to 390px at 320px wide; at 400px it likely fits) (polish2 Task 2; also the memory's beta "375px top-bar" item);
- the run Overview's `.ov-row` (`RunOverviewTab.svelte:439`, 132px + 1fr + 54px) with a date field open (slice6c T1);
- the player strip wrapping with a long sequence (polish2 Task 2, Safari pass).

## What the builder decides

- Store names, helper names and file placement.
- The draft key (slug, or slug + version) — say why in the plan.
- The `--cancel-border` value and the compact list spacing, shown at the look check.
- Record-of-last-press versus `returnTo` for F13, after the tests.
- `_link_tokens` rejection versus unwrapping for C11.
- How the tasks are cut. A suggestion: (1) quiz drafts, in-app content links, the click helper, the crumbs; (2) the focus mechanism; (3) token-level look (banners, Cancel border, invalid fields, code chip, prompt colour); (4) layout-level look (Group column, long words, table corners, crumb hover, MP header, 0 uses, lists, New run strip) and the Skeleton; (5) frontend behaviour; (6) backend (files, e-mails, dates, nulls, bare addresses); plus any 400px finding without an owner.

## Testing

As in Polish 2. jsdom computes neither layout nor the cascade, so for CSS changes the gate row is the red/green: written first, run against the old dist (red), then the change (green), hashes derived from dist. Behaviour is TDD: a test that fails first, then the fix. The backend changes are pytest via `backend/.venv`.

## Backlog lifecycle

Each task removes the entries it resolves in the same commit: a standalone file is `git rm`'d (`courselist-empty-api-error-detail-shows-empty-state.md`, `mp-can-submit-null-guard-is-dead.md` if its file is touched); in the per-slice files the bullet is deleted.

The first task also closes, in its docs commit, the entries the recon found stale:
- slice4: "Two back-navigation conventions coexist" (page headers use the round ← button, the player and the mini-project page use breadcrumbs, "Back to course" appears only on error states);
- slice5a T5a "slug / code badge wrap", T6 "a long slug can squeeze the item title" (5c removed the badges);
- slice5a T2 "Focus after a row action" for Disable / Enable, and the final review's delete-block and create-success halves (fixed in Polish 1 and 5c); the Duplicate half stays as F1;
- slice5d T3 Retry; slice6a final "Publish ↔ Unpublish swap" (fixed in 6c); slice6a T3 DangerConfirm busy focus (it restores after settle);
- slice6c whole-branch "the row-confirm warning doesn't wrap" (`InlineConfirm .warning` has `overflow-wrap: anywhere`); the `.ro-err` half stays.

Entries measured below 400px are reworded to 400px or closed by §Narrow screens.

## Process

Per task, as in Polish 1 and 2:
1. TDD (for CSS, the gate row first);
2. vitest (`TZ=Europe/Copenhagen`), svelte-check and the gate (absolute `TMPDIR`); for backend tasks also `backend/.venv` pytest;
3. screenshots or a look check at a laptop width and at 400px;
4. the user's OK;
5. Opus and Fable review lanes on the uncommitted diff, re-run after every fix until clean;
6. the user's commit OK; a docs commit, then the code commit, with exact paths and the trailer;
7. a ledger line;
8. wait for "go".

Then a whole-branch review (fresh Opus and Fable) and a Safari pass, one step at a time.

## Carried to the Safari pass

- **Quiz drafts:** answer two questions, go Next, Previous, the strip, the course page and the course list, and back: the answers are there. Submit: the draft is gone. Reload with answers: the browser warns. Sign out and in: no answers. Two quizzes in a row: submit the first, Next: the second opens unanswered and unlocked.
- **Content links:** a link to another Mathion page in a quiz prompt mid-quiz moves without a reload (the top bar does not flash) and the answers stay; a `#heading` link scrolls and the player stays on its item.
- **Course files:** a linked PDF and a PNG open in the new tab; a CSV downloads.
- **Modifier clicks:** ⌘-click a course card, a sequence row, a crumb, a top-bar link and a Versions row title: each opens a new tab and the current one stays.
- **Focus after a mouse click (F13):** open the Progress side panel, New run and the Mini-project editor with the mouse, close each with × or Esc, then Tab: focus continues from the opener.
- **⌘S after a mouse Save** in the item modal saves again (or does nothing while saving) and never opens the browser's Save dialog.
- **The look:** the error banners beside a danger panel (one pink), a Cancel beside its action on white and on a panel, the three invalid fields, a long group name in Progress and Submissions with keyboard scrolling, the teacher tables' corners, the 0-uses label, a loose list, the teacher screens loading (throttled network).
- **400px:** every screen family.

No VoiceOver steps. The beta VoiceOver list gains: whether the in-app content link move is announced (focus and title after `navigate()`), and the Versions row title as a link.
