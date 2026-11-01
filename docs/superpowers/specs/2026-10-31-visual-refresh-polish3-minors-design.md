# Visual refresh — Polish 3: the reviewers' minors that users meet

**Status:** rev 12 (2026-11-01). Rev 4 approved by the user (`23f8afb`).
- Rev 1 (`e10671b`): the user's decisions D82–D87, the controller's calls C1–C15, after the builder check.
- Rev 2 folds in spec review round 1 (`spec-r1-opus-a.md`, `spec-r1-opus-b.md`, `spec-r1-fable.md`: 4 Critical, 18 Important, 34 Minor across the three lanes) and adds C16–C19.
- Rev 3 folds in round 2 (`spec-r2-opus.md`, `spec-r2-fable.md`: 1 Critical, 8 Important, 20 Minor; round 2 found 18 of round 1's 22 Critical/Important resolved, 4 partly, all four finished here).
- Rev 4 folds in round 3 (`spec-r3-opus.md`, `spec-r3-fable.md`: 0 Critical, 2 Important, 16 Minor; every round-2 Critical/Important resolved) and round 4's Minors (`spec-r4-opus.md`, `spec-r4-fable.md`: 0 Critical, 0 Important, 13 Minor; every round-3 finding resolved).
- Rev 5 records the 400px shots (`shots-400.html`) and the user's D88: only the student screens must work at phone width.
- Rev 6 records Task 2's review (rounds `t2-r1..r3-*.md`): `navigate()` reports whether it moved, and the handler scrolls on that; the player re-resolves its item after an in-app move to another sequence without `#item=`; `//` paths and empty fragments are left to the browser.
- Rev 7 records Task 3's review (rounds `t3-r1..r3-*.md`): with focus on `<body>` or on the panel itself, Tab and Shift+Tab go straight to the first and last control; the press record keeps only a primary press on a control that can hold focus (`[role=button]` only with a tabindex), and is used only while it can hold focus; on a modal panel, `repairFocus` acts only on that panel's controls; a Save or Discard blocked by an upload says "Wait for the upload to finish".
- Rev 8 records Task 4's review (rounds `t4-r1..r5-*.md`): Create and Create copy show the spinner only for their own request, and another action's busy leaves them blocked; a failed create or save puts back a focus the browser dropped on its disabled Cancel or × (F1, F2, F4); F9 repairs only when the load swaps the form away; F8's draft flip also repairs from the toolbar's buttons and the empty roster's links, and the select gets focus back as soon as its request lands; a failed asset reload closes an idle question (F11); a course switch also closes the duplicate row (F12).
- Rev 9 records Task 5's review (rounds `t5-r1..r2-*.md`): `--cancel-border` is `#71839E`; an invalid field turns red only for an error about its title, not for a network or server failure (C3); a closed version's raw prompt `.qsrc` takes `--text-2` with the open `.qtext` (C5).
- Rev 10 records Task 6's look check and review (rounds `t6-r1..r4-*.md`): the compact loose-list pair is `--space-1` / `--space-2` (user, option A of A 4/8px, B 8/16px); the inside-an-item spacing covers every block, not only `p` (user); the mini-project header keeps its space through `.title-row:only-child { margin-bottom: 18px }`; a file dragged beside the drop zone shows the no-drop cursor (`dropEffect = 'none'` when nothing has accepted the drag), also over the zone while submitting (r2); a heading inside a loose item keeps its em margins (r2 ruling); a loose list without `<p>` goes to the backlog (r2).
- Rev 11 records Task 7's look check (user OK, the legend on Progress moves aside while "Refreshing…" shows): on a change of run, Progress and Submissions drop the old run's rows, so the new run loads with the Skeleton, not "Refreshing…"; a chip that drops to 0 uses also drops its open "used by" panel, so the panel does not come back with the uses; the Assets drag-over outline marks the wrapper. Review rounds `t7-r1..r3-*.md`: focus inside the open panel is repaired too; at rest the empty "Refreshing…" status cancels its flex gap, so the toolbar spacing is as before, and the gate pins that gap.
- Rev 12 records Task 8's look check (user OK) and its calls: the create form asks nothing while Create's request runs, and its navigation question is the D37 wording; every offline write says "Could not reach server. Check your connection."; a bulk refetch that fails is quiet; New item's form is `novalidate`; the video body's prefix and length messages; the Teaching pill's address. Its review (r1) adds: a list error drops the create form, and InlineName shows the message of a plain `Error` only.

**Branch:** `feat/visual-refresh-polish3-minors`, cut from the Polish 2 tip `71dd8cc`. It stays local: no push, no merge.
**Workspace:** `.superpowers/sdd/2026-10-31-visual-refresh-polish3-minors/` (`inventory.html`: the grouped backlog and the recon; the review rounds `spec-r*-*.md`).

## Goal

Every slice of the visual refresh deferred its reviewers' Minor findings to `docs/backlog/`, about 300 of them in 15 files. Most are internal: gate patterns a future edit could slip past, missing tests, races the reviewers themselves graded "contrived". Polish 3 takes the ones a student, teacher or author actually meets before the beta:
- what looks wrong on screen;
- behaviour a user would notice. The biggest is that a student's unsubmitted quiz answers vanish on any move away from the quiz, and that going from one quiz straight to the next carries the first quiz's result over;
- keyboard focus that falls to the page (`<body>`) after an action. The next Tab then starts at the top, and in the item modal ⌘S opens the browser's own Save dialog.

Polish 1 (confirms) and Polish 2 (named items) are done. After Polish 3 comes the beta pass.

## Scope

**In:** the items in the sections below, from §Student quiz answers and in-app links to §Narrow screens. Each names the backlog entry it closes.

**Dead code** (backlog group 5) is in only where a task already edits the file. An example is the dead `data.can_submit !== null` conjunct in `MiniProjectDetailPage.svelte`, which the look and behaviour tasks touch anyway. A file is not opened just to clean it. `format-progress-helper-now-unused.md` follows that rule and stays.

**Not in:**
- rare races and timing edge cases (late responses after a version switch, double-clicks on controls with no in-flight guard, IME Enter in Safari);
- gate hardening and test-gap notes, except the gate rows and tests each change needs;
- the beta carry list: VoiceOver, forced colors / Windows High Contrast, reduced motion, iframe focus, touch devices, the 13d superuser page;
- anything below 400px wide (D82);
- the authoring and teaching screens at phone width (D88);
- the user-visible entries listed in §Left in the backlog, each with its reason.

## Decisions

The user's, made in the brainstorm on 2026-10-31.

- **D82 — The narrowest supported screen is 400px.** "Modern devices are quite large even cheap ones." Narrow-width shots and rules are taken at 400px. A finding that appears only below 400px is not a defect. Backlog entries measured at 320px, 375px or 390px are re-checked at 400px (§Narrow screens).
- **D83 — A student's unsubmitted quiz answers are kept while they move around.** Typed or picked answers that are not submitted stay in memory per quiz. Going to another item, another sequence, the course page or the course list and back shows them again. They go away on submit, on sign-out, on a reload and when the tab closes. A reload or a tab close with unsaved answers anywhere shows the browser's own leave-page warning. A link to another Mathion page stays in the app (no reload).
- **D84 — Course files open in the tab when the browser can show them.** A link to a course file (the `/assets/{version_id}/{filename}` endpoint) opens a PDF, PNG, JPEG or GIF in the new tab, in the browser's own viewer, which has its own download button. Every other type downloads as today. (The user chose "PDF and images". WebP and SVG are not accepted for upload, so they cannot arrive. Should either ever be allowed, SVG must download: it can carry script.)
- **D85 — Loose lists group by item.** In authored content, the blocks inside one list item (paragraphs, code, quotes, nested lists, rules, display math; rev 10) sit closer together than the items do: on the page scale 8px inside an item and 16px between items, on the compact scale 4px and 8px. A heading inside an item keeps its own em margins (D63). Tight lists are unchanged. (Today it is the reverse: items 8px apart, paragraphs inside an item 16px.)
- **D86 — One loading look: the skeleton rows.** The five teacher screens that show an italic "Loading…" line (`LoadingPlaceholder`) show the grey skeleton rows (`Skeleton`), like the student and editor pages. `LoadingPlaceholder` is deleted. The boot spinner in `App.svelte` and `Login.svelte` stays, because there is no page yet to hold skeleton rows.
- **D87 — "0 uses" is a label, not a button.** On a run's Assets tab, a file used by no mini-project shows its grey "0 uses" chip as plain text. It has no button and no empty "used by" panel, so there is one Tab stop fewer. A chip with uses keeps opening its list.
- **D88 — Only the student screens must work on a phone.** "This service can not be fully functional on small screen. We keep this option so student can do some quick actions on mobile phone, like check video, quiz or progress, but the part about course admin and teaching admin is not intended to be functional on small screens." (user, after the 400px shots). The 400px rule of D82 covers Login, the course list, the course page, the player and the mini-project page. The authoring screens (Versions, the editor and its modals) and the teaching screens (Teaching, a course's runs, a run's tabs) are laptop screens: a sideways scroll or a cramped header there at 400px is not a defect.

### The controller's calls

Not decided by the user. They are listed here so the user can check them while reading; each is detailed in its section.

- **C1** Error banners take the danger panel's colours (`--danger-panel-bg` / `--danger-panel-fg`). Status chips, badges and pills keep `--status-rejected-*`.
- **C2** `--cancel-border` gets a value of at least 3:1 against every background a Cancel sits on.
- **C3** The three invalid fields without a red edge get the editor's `1.5px solid var(--danger)` edge, staying red when focused.
- **C4** The Group columns of Progress and Submissions are capped at their set width; a long name wraps.
- **C5** The quiz card prompt in the editor takes `--text-2`, as the student view and the preview do.
- **C6** In-app links: a link with its own click handler uses one shared helper that lets Cmd/Ctrl/Shift/Alt-clicks and middle clicks through to the browser. One app-wide handler routes every other same-origin link to a Mathion page, including links in authored content and the two plain links that reload the app today.
- **C7** The focus mechanism of §Focus after an action:
  - a busy button keeps its spinner and stays focusable;
  - the item modal's footer keeps focus when it turns clean;
  - one repair helper;
  - the modal's ⌘S works with focus on `<body>`;
  - two FocusTrap changes.
- **C8** The Versions page create form asks before discarding a dirty form on Cancel and on in-app navigation.
- **C9** Staff notification e-mails link to the `/teaching/…` run address.
- **C10** The backend rejects a run start date after its end date. An explicit `null` gets a 422 only on fields that cannot be empty, field by field. Run dates stay editable one at a time, and the 422 says to change the end date first when moving a run later.
- **C11** A link the sanitiser strips the address from, bare or authored, stays plain text.
- **C12** File responses from both file endpoints carry `X-Content-Type-Options: nosniff`.
- **C13** Each player item gets its own component instance, which fixes quiz → quiz carrying the first quiz's result and answers. A submit records its attempt count in the course store, so coming back to a quiz shows the right attempts left, or the reveal once they are used up.
- **C14** Drafts survive an expired session (the 401 → sign-in round trip) and belong to the user who typed them. An explicit sign-out, or a different user signing in, drops them.
- **C15** The 400px shots are taken before the plan (done; §Narrow screens has the results). A finding is real breakage (sideways scroll, a clipped or unreachable control, unreadable text) or anything the user flags in the shots.
- **C16** A busy Save or Create shows the primary colour with its spinner, as the quiz modals already do, instead of grey with a spinner. This is shown at the look check.
- **C17** On Progress and Submissions the skeleton shows only on the first load. A Refresh over data keeps the table and shows a short muted "Refreshing…" beside the Refresh control.
- **C18** Taken from the reviewers' list of omitted user-visible entries. Each is cheap and sits in or beside a file this slice edits; the details are in §Behaviour, item C18:
  - the roster add error clears on typing;
  - New run drops a stale server banner and a fixed date error;
  - InlineName never shows an empty error;
  - the app preview no longer restarts on a title Save;
  - the evaluation form no longer re-fills over a teacher's edits;
  - Discard in the mini-project editor waits for an upload;
  - a scheme-less video URL is accepted;
  - the Teaching filter survives Back;
  - the Submissions ring is no longer clipped.
- **C19** The rest of the omitted entries stay in the backlog, each with its reason (§Left in the backlog).

## Student quiz answers and in-app links

### Where answers live today

`QuizItem.svelte:17` holds the answers in component state (`let answers = $state({})`). A move to a page, a video, an app, the course page or anywhere else unmounts it, and the answers are gone. That covers Previous / Next (`SequencePlayer.svelte:121`, where `gotoFlat` navigates), the strip, the breadcrumbs and content links. Nothing warns. A same-origin content link also reloads the whole app, since nothing intercepts it (`externalLinks.ts` only adds `target` to links that leave).

**A move from one quiz straight to another is worse: it does not unmount** (builder check, verified by all three review lanes). `SequencePlayer.svelte:212` renders `<ItemRouter item={currentItem}>` with nothing keyed on the item. `ItemRouter` stays on its quiz branch, so the same `QuizItem` instance gets the new `item`, and `answers`, `lastResult`, `revealed` and `autoRevealed` (`QuizItem.svelte:17-21`) carry over. After submitting quiz A, Next to quiz B shows B locked with A's result. B's submit sends the whole `answers` map (`:98`), A's question ids included. The same holds across sequences, since `SequencePlayer` itself is reused when only its address changes. `QuizItem.svelte.test.ts:565, 583` cover the attempt-count part of an `item` change, but no test drives a submit followed by a move to a second quiz.

**The attempt count in the course store is never raised.** `markItemCovered` (`stores/currentCourse.svelte.ts:103-108`) sets only `is_covered`, and `QuizItem.svelte:22-27` calls the store count "never-bumped". After a remount, `attemptsUsed` (`:38-44`) falls back to that stale count, and the auto-reveal effect (`:63-77`) compares it with the maximum. So a student who used every attempt this session, left and came back, sees an open form with attempts "left", and Submit fails on the server. Today that path is quiz → page → quiz; C13 makes quiz → quiz → back take it too.

### Each item its own instance, and the attempt count (C13)

- `{#key item.id}` wraps `ItemRouter`'s whole `{#if}` chain, inside `ItemRouter.svelte`. It is not placed in `SequencePlayer`: the gate's AST pin for SequencePlayer (`visual-refresh-gate.sh` ~`:1381`) allows no `KeyBlock`, and its SIG list pins `ItemRouter:[item={currentItem} …]`. The ItemRouter grep rows (~`:1171`) are unaffected by the `{#key}`. This also remounts `VideoItem` and `InteractiveAppItem` between two items of the same type. That is new: today video → video reuses the instance and carries its `busy` over.
- A successful submit also writes the response into the course store's item entry: `attempt_count`, plus any other per-item field the response carries that the store holds. A `recordQuizAttempt(res)` beside `markItemCovered` would do it. Coming back to a quiz then shows the right attempts left, or auto-loads the reveal once they are used up. Showing the last result again is not in scope.
- Tests:
  - quiz A → submit → Next to quiz B: B opens unanswered and unlocked, and B's submit sends only B's question ids;
  - submit A on its last attempt → Next → Previous: A shows the reveal, not an open form;
  - a submit with attempts left → Next → Previous: A shows an empty form and the right number left.

### Drafts (D83, C14)

- A small store (e.g. `stores/quizDrafts.svelte.ts`) holds the unsubmitted answers, keyed by item id. Item ids are global primary keys (`models.py:100`), each in exactly one version, so the id alone is unique.
- `QuizItem` keeps its own `answers`; the store is a mirror. `QuizItem` starts from the stored draft when one exists and writes every change back.
- Drafts are written only while a user is signed in (`session.user` is not null). Unit tests set a session user.
- **"Holds answers"** uses the same test as `allAnswered` (`QuizItem.svelte:79-86`): a non-empty array, or a string that is not blank. A draft with no such entry is removed. Otherwise text typed and erased leaves `{qid: ''}`, and the leave-page warning stays on with nothing to lose.
- A successful submit deletes the store entry, keyed by `res.item_id`. `item` must not be read after the `await`; `:22-27` explains why. The component's own `answers` stays, because the locked result reads it through `valueFor()` (`:53-59`). "Try again" starts from an empty draft, as today.
- **Sign-out versus an expired session (C14).** The session store has one `clearSession()` (`stores/session.svelte.ts:11`) with two callers:
  - `logout()` (`lib/auth.svelte.ts:49`), when the user chooses to sign out;
  - the 401 handler (`main.ts:12-17`), which sends the student to `/login?next=…` without a reload.

  The likeliest 401 is a Submit after a long time on a quiz, with exactly the answers D83 keeps. So:
  - drafts are not cleared in `clearSession()`;
  - `logout()` clears every draft;
  - every draft records the id of the user who typed it. When a session starts for a different user, all drafts are dropped. A session starts in two places: `verifyPin` (`auth.svelte.ts:40`) and `bootstrapSession`. The same student signing back in after a 401 finds their answers.
- While any draft holds answers, a `beforeunload` listener asks the browser to warn. It is the same mechanism `DirtyGuard.svelte:61` uses. Either form is fine; the builder picks one: the listener is added when the first draft fills and removed when the last empties, or one listener stays registered and warns only while a draft holds answers.
- In-app moves never ask: the answers are kept, so there is nothing to lose. This holds only if no in-app link does a full page load (next section).
- A revealed or exhausted quiz shows what it does today (`valueFor` prefers `revealed.student_answer` when the reveal auto-loaded).

### In-app links (C6)

Two mechanisms, with separate roles.

**1. The click helper, for links that have their own handler.** Every in-app link that handles its own click does `e.preventDefault(); navigate(…)` unconditionally, so Cmd/Ctrl-click and middle click cannot open a new tab. Only `VersionEditPage.svelte:551` returns early on a modifier or a non-primary button. One helper (e.g. `routeClick(e, href)` in `router.svelte.ts`) does that check, then `preventDefault` and `navigate`, and every such site uses it. `VersionEditPage`'s local version goes too. The sites found:
- `CourseCard.svelte:34, 37, 53, 64, 69, 77`;
- `SequenceLink.svelte:20`;
- `AppHeader.svelte:24, 33, 38`;
- `SequencePlayer.svelte:164`;
- `MiniProjectDetailPage.svelte:478`;
- `TeachingCrumbs.svelte`;
- the `go(e, href)` helpers in `TeacherRunListPage.svelte:88`, `RunListPage.svelte:98` and `RunDetailPage.svelte:392`;
- any others a grep for `preventDefault();` next to `navigate(` finds.

The Versions page row title (`VersionsPage.svelte:311-313`), a `<button disabled={busy}>` today, becomes an `<a href>` with the helper. An anchor cannot be disabled, so while `busy` it carries `aria-disabled="true"`, and the helper returns early on a plain click (still `preventDefault`) when the anchor is aria-disabled. A modifier click still opens a tab; a new tab is harmless. `.vtitle:disabled` (`:471`) becomes `.vtitle[aria-disabled='true']`, and `.vtitle` takes `text-decoration: none` (and keeps its button look) now that it is an anchor. `VersionsPage.slots.svelte.test.ts:530` and the gate's `.vtitle` row (~`:3830`) change with it. `firstUsable(#v-{id}-title)` (`:222`) keeps working.

**2. One app-wide handler, for every other same-origin link.** It is a single delegated `click` listener on `document` in the **bubble** phase, registered once (jsdom tests mount `App` repeatedly, so registration must be idempotent or torn down). In the bubble phase it runs after Svelte 5's delegated handlers (on `#app` and `document`), so a site's own `preventDefault` is seen. It routes a click through `navigate()` when all of these hold:
- the event is a plain primary click (no modifier, `button === 0`) and not already `defaultPrevented`, so the click-helper sites are left alone;
- the target is inside an `<a href>` with no `download` attribute, and no `target` other than `_self`;
- `opensInNewTab(href)` (`externalLinks.ts:15-25`) is false. This is checked at click time, so other sites and `/assets/…` and `/api/…` files are left to the browser whether or not the `externalLinks` attachment has run;
- the resolved URL (`new URL(href, location.href)`) is on Mathion's own origin, and `matchRoute(routes, pathname)` knows its path, or the path is `/`. `/` is not in `routes.ts`, but `App.svelte:44-45` handles it as the role redirect, so a pasted Mathion root address is routed too. A same-origin backend path such as `/version` is left to the browser and does not land on the SPA's 404. `matchRoute` decodes path segments (`decodeURIComponent` throws on a malformed `%`), so the call sits in a `try`, and a throw leaves the link to the browser;
- it is not a same-page anchor, meaning the href has a fragment and the resolved path and search equal the current ones. An empty fragment counts (`href="#"`, whose `URL.hash` is `''`). A path starting with `//` is left to the browser too: `pushState` would read it as another host (rev 6). Such a link keeps the browser's default. A same-path link without a fragment (`/courses/x/seq/5` from `…/seq/5#item=7`) is routed, because left to the browser it reloads.

It passes `u.pathname + u.search + u.hash` to `navigate()`, not the raw href: `navigate()` compares strings (`router.svelte.ts:105`), and `isHashOnlyChange` parses only path-form input (`:88-95`). After the move it scrolls to the top, **only if the route actually changed**. `navigate()` is a no-op on the same address (`:106`), on a DirtyGuard Cancel and when a newer navigate supersedes it, so it resolves a boolean: true only when that call moved the route (rev 6). The handler scrolls on it. Comparing the address before and after the move does not work: the player adds `#item=` as it mounts, and RunsRedirect replaces the path, before the handler reads the address (Task 2 review). Otherwise a Cancel in the editor preview's discard question would scroll the page under the modal. `navigate()` never scrolls by itself, and the reload used to.

This covers:
- links in authored content (`.prose`). The editor preview (`MarkdownEditor.svelte:332`) is included, where `navigate()` runs DirtyGuard;
- the two plain links that reload the app today: the course page's mini-project row (`MiniProjectLink.svelte:40-44`) and the Coming deadlines card (`CourseDeadlines.svelte:38`). With drafts, a reload there would raise the browser's leave-page warning on what the student sees as an in-app move. They may also adopt `routeClick`; either way the handler catches the next plain link someone adds.

Notes for the builder:
- A content link to another sequence of the course keeps the same SequencePlayer instance (one route). Without `#item=` in the link, the player re-resolves its item as a fresh load does, instead of keeping the previous sequence's (rev 6). A link with a non-member `#item=` still shows an empty player, as a test pins for a stale hash (backlog).
- The player keeps `#item=` in its own address, and a content `#heading` link does not match that pattern (`SequencePlayer.svelte:80-88`). Authored headings carry no `id` (`markdown.py` `_ALLOWED_ATTRS`), so such a link scrolls nowhere today. A test pins only that it leaves the player on its item.
- A link to the current address is a no-op: `navigate()` returns at `router.svelte.ts:106`. A test pins that it neither reloads nor scrolls.
- `externalLinks.ts` itself is unchanged, so its Polish 2 gate rows hold.

Tests, one each:
- a content link routes, with no reload and `defaultPrevented`;
- an `/assets/` link is left alone;
- a modifier click is left alone;
- the mini-project row and a deadline link route;
- a same-page `#anchor` is left alone;
- the scroll goes to the top after a real move, and stays put after a DirtyGuard Cancel;
- a link with a malformed `%` path is left to the browser;
- each click-helper site: a plain click navigates and a ⌘-click does not `preventDefault`.

### The course crumb while the course loads

`MiniProjectDetailPage.svelte:477-478` renders the course link with `currentCourse.value?.course.name ?? ''`. While `loadCourse` runs, or after it fails, it is an empty, focusable, nameless link; after a cross-course move it briefly shows the old course's name. The link and the separator after it (`:483`) render only when `currentCourse.value?.slug === courseSlug`. `currentBlock` (`:182-184`) is found by global block id, so it is never shown without the course. The player's crumbs need no change: they render only once the sequence is found inside `currentCourse` (`SequencePlayer.svelte:33-37, :195-200`). (polish2 D70 review)

## Course files open in the tab (D84, C12)

`backend/mathion/api/assets.py:189` returns `FileResponse(filepath, media_type=asset.mime_type, filename=filename)`, which sends `Content-Disposition: attachment`. For the stored MIME types `application/pdf`, `image/png`, `image/jpeg` and `image/gif`, it sends `inline` with the filename instead (Starlette 1.0.0's `content_disposition_type="inline"`, checked). Every other type keeps `attachment`, including `js` (interactive apps' scripts) and `csv`. Filenames are sanitised ASCII, so Starlette's `filename*` branch never triggers.

Every file response from this endpoint, and from the run-file endpoint (`api/run_assets.py:289-294`, already `inline` for every type), carries `X-Content-Type-Options: nosniff`. That is one header line in each. Error responses (JSON from `HTTPException`) are not covered and need not be. Interactive apps load their scripts by `fetch` into `srcdoc` (`lib/assets.ts:96`, `InteractiveFrame.svelte:29-33`), so neither header affects them. Images embedded with `<img>` are unaffected either way. The frontend needs no change: `externalLinks` already opens `/assets/…` links in a new tab.

Tests:
- one per inline type, asserting the disposition header;
- one attachment type each for `.csv` and `.js`;
- `nosniff` on both endpoints.

## Focus after an action (C7)

### What is still reachable

The recon (2026-10-31) re-checked every entry. These are fixed since they were filed, and close in the backlog:
- Versions Disable / Enable;
- deleting the expanded block;
- a successful create-block / create-sequence;
- the quiz Retry;
- the Publish ↔ Unpublish swap;
- DangerConfirm, which restores focus after it settles.

Still reachable:

| # | Site | What happens |
|---|---|---|
| F1 | `VersionsPage.svelte:345` Duplicate's Cancel; `:342` the Duplicate label input; Create copy / Create | Cancel unmounts itself. The label input is `disabled={busy}`, so Enter in it drops focus. The submit buttons are natively `disabled` while busy. |
| F2 | `BlockAccordion.svelte:398`, `VersionEditPage.svelte:686` the add rows' ✓ | A failed create from a clicked ✓ (an IconButton `type="submit"`, disabled while busy). Enter in the field is fine, because the input is only `readonly`. |
| F3 | `ItemEditorModal.svelte:91` `saveBlocked`, `:376-396` Save, Discard, ×; `AppBody.svelte:209-219`; `MarkdownEditor.svelte:316` | Save is natively disabled while saving *and once clean*, so **every successful Save** drops focus, by mouse or keyboard. Discard is disabled once clean, and × and the body's controls while frozen. With focus on `<body>`, ⌘S fails the modal's own check (`:242`, `e.target.closest('section.modal-panel')`), and the browser's Save dialog opens. |
| F4 | `NewItemModal.svelte:124`, `VersionSettingsModal.svelte:136-137` | Create / Save are disabled while busy; a failure leaves focus on `<body>`. VersionSettingsModal closes on success (`:126`), so its success path needs nothing. |
| F5 | `FocusTrap.svelte:52-64` | Autofocus picks the first matching `[data-autofocus]` even when it is disabled; `focus()` is a no-op and focus stays behind the modal. Reachable today only through ItemEditorModal's title pencil (`:353`) while `quizEdits.locked`. |
| F6 | `ItemEditorModal.svelte:344-346` the header title ✓ | A 403/409 reload flips `canSave` and disables the focused ✓. `InlineInput.svelte:31-35` solves the same case with a `$effect.pre` that moves focus before the disable. |
| F7 | `RunOverviewTab.svelte:171-198`, `:366-378` | A failed Publish whose refetch reveals a new violation natively disables Publish under focus, after the await. |
| F8 | `RunRosterTab.svelte:826` + `:534-563`; `:120`, `:639`, `:650` | The row group `<select>` is natively disabled from the request's start to its settle. The open add row unmounts if the run turns draft, and its toggle is disabled too. |
| F9 | `DashboardSidePanel.svelte:911-919`, `loadThread :195-218` | The first thread load swaps a focused create form for the evaluation card. |
| F10 | `RosterImportModal.svelte:184-197`, `:261` | Done sets `closing`, and `closeDisabled={submitting \|\| closing}` disables the focused ×. × and Esc at the summary call `onDone()` (`:202-204`), and `closeForCurrentStage` already ignores them while closing. |
| F11 | `AssetSidebar.svelte:67-71` | A failed list reload replaces the rows under a focused question. |
| F12 | `VersionsPage.svelte:35`, `:53-63`, `:280-281` | A course switch unmounts the whole frame, `<h1>` included, and nothing refocuses when the new course loads. `creating` and `createAsk` also survive the switch (backlog polish1 Task 4, slice5a T2). |
| F13 | `FocusTrap.svelte:48`, restored `:70-74` | Safari does not focus a clicked button, so a modal or panel opened by a mouse click records `<body>`, or an ancestor such as a modal panel, as its return target. Closing it then leaves focus nowhere, and the next Tab goes to the address bar. Openers: the grid cells that open the Progress and Submissions side panels (they call `openPanel`, `RunProgressTab.svelte:328` and `RunSubmissionTab.svelte:134`; `closePanel` is `:333` / `:138`), New run (`RunListPage.svelte:112,130`), Publish conflicts (`RunDetailPage.svelte:320`), Import roster from the toolbar, the Mini-project editor's edit path (`RunMiniProjectsTab.svelte:322`). Its create path already refocuses the new row's pencil (`:112-120`). |

### The mechanism

The codebase already separates two states (`Button.svelte:21-23`, `:75-76`): **blocked** (`aria-disabled`: looks disabled, keeps focus, must not act) and **busy** (`loading`: keeps its variant look and shows the spinner, `aria-busy`). Native `disabled` drops focus.

1. **A busy button keeps `loading` and drops native `disabled` for the busy reason only.** The quiz modals already do this (`NewQuestionModal.svelte:150` with its guard at `:97`, `QuestionTextModal`, `ExplanationModal`). The handler returns at once while busy. `save()` (via `saveBlocked`) and `submitCreate` (`:287`) already have that guard. **`createVersion` and `duplicateVersion` do not** (`VersionsPage.svelte:127-128`, `:253-254`): today the natively disabled buttons are their only protection. Each gains `if (busy) return;` first, with a test that presses Enter twice in the form and asserts one POST. A button's own busy gets no `aria-disabled`. On the Versions page `busy` is page-wide, so Create and Create copy each keep their own flag: `loading` only for their own request, `aria-disabled` while another action holds `busy` (rev 8). Applies to F1 (Create copy, Create; the label input becomes `readonly={busy}`, like the editor's add rows), F3 (Save while saving) and F4. Natively disabled stays right for a control that is unavailable for another reason (Create with an empty title).
   - **C16:** the busy Save / Create now shows the primary colour with the spinner instead of grey with the spinner. It goes to the look check.
   - The add rows' ✓ is an IconButton, which has no `loading` (F2). It takes `aria-disabled` while busy and looks disabled. Its re-entry guard sits in the form's `onsubmit`, as it does today (`createBusy`), because `aria-disabled` does not stop a submit.
   - F10: `closing` leaves `closeDisabled`.
   - Existing tests that assert native `disabled` while busy flip. That covers the ItemEditorModal, NewItemModal and VersionsPage create/duplicate tests. The flips are expected, not regressions. No gate row pins those `disabled={…}` expressions.
2. **The item modal's footer keeps focus when it turns clean (F3).** Save and Discard use `aria-disabled` (blocked) for "nothing to save / discard" instead of native `disabled`. A successful Save therefore leaves focus on Save. A ⌘S or click on a blocked Save does nothing: `save()` returns on `saveBlocked`. `discard()` gains its own guard (it returns when clean), since a blocked button still fires its click. Discard and × stay natively disabled while `frozen` (`ItemEditorModal.svelte:378`; `closeDisabled={deleting || saving}` at `:396`), so a ⌘S pressed with focus on one of them drops focus during the save. `save()`'s `finally` therefore runs `repairFocus(Save, Title, ×)`, guarded by `alive` like the line beside it.
3. **One repair helper, for repairs only.** `repairFocus(...chain)` in `lib/askInPlace.svelte.ts` is `focusAfter` (`:58-63`) widened over a chain. It runs after a tick. It and point 5's autofocus share **one predicate**, e.g. `canHoldFocus(el)`: connected, not natively disabled, not inside `[inert]`. `usable()` and `firstUsable` stay as they are for code that needs a control that can *act*. `focusFirst` (below) is rewritten on `usable`. It acts only when focus is on `<body>`, null, or a modal panel itself. It focuses the first element of the chain for which `canHoldFocus` is true, verifies that focus took, and otherwise moves down the chain. It never moves focus the user put somewhere else. Unlike `usable()`, it accepts a blocked (`aria-disabled`) control, the same rule as point 5's autofocus, because a blocked control holds focus. A Save that turned clean is therefore a valid target.
   - **`focusFirst` stays.** It has about 40 call sites, and most are deliberate moves, not repairs. For example, `RunMiniProjectsTab.svelte:111-119` moves focus from "+" to the new row's pencil, which a repair-only helper would refuse. It gains the `inert` check by being rewritten on top of `usable` and keeps its callers. The gate's `LIB_6A` list (`visual-refresh-gate.sh` ~`:4636`) names it, so the file must not move.
   - Only the scattered `if (document.activeElement === document.body)` checks in touched files switch to `repairFocus`.
   - The chains (each runs where the drop happens, after a tick):
     - F1 Cancel → the row's Duplicate, then the page `<h1>`;
     - F7, in `publish()`'s `'failed'` branch after the refetch → Publish, then the readiness heading;
     - F8 select, as soon as its request lands (again in `onGroupChange`'s `finally` once the request, and on success its groups refetch, has settled, unless a newer change of the same select is still running and repairs for itself) → the same select, then the roster search;
     - F8 draft flip, in an `$effect.pre` on `runIsPublished`, when the add row is open or focus is on the toolbar's buttons or the empty roster's links → the + toggle, then the search;
     - F9, only when the load swaps the form away → the Evaluation heading, then ×;
     - F11, only when focus was in the rows → the drop zone, then the panel. The failed reload also closes an idle question, so a later reload does not re-open it and take focus (a busy one waits for its DELETE);
     - the 0-uses chip that turns into a label under focus (§The look) → the row's next control, then the tab's heading (or the Upload button if the heading cannot take focus).
   - **A failed create** (F1, F2, F4) does not drop focus once point 1 holds: focus stays on the busy button. Today's behaviour of leaving focus there is kept. Where a failure shows a field error (F4's 409 "title taken"), the handler moves focus to the errored field with `focusFirst`. That is a deliberate move, not a repair. Cancel and × stay natively disabled while busy, so a focus Safari left on them drops; so when the request settles (in a `finally`, or the failure branch), F1's Create / Create copy, F2's ✓ (then the field) and F4's Create (then Title) and Save run `repairFocus` on themselves. After a success that navigates or closes, the button is gone and the repair does nothing (rev 8).
4. **The modal's ⌘S with focus on `<body>` (F3).** Moving focus inside a keydown handler does not change that event's `e.target`, and ItemEditorModal's window listener (`:318`) runs before Modal's (`Modal.svelte:137`). So:
   - Modal's module script exports `isTopModal(panel)` (the `stack` is already there);
   - ItemEditorModal's ⌘S test becomes: the target is inside my panel, **or** the target is `<body>` or `document.documentElement` and my panel is the top modal. Then it calls `preventDefault()` and saves (or does nothing while blocked or a question asks, as today);
   - **new in `Modal.svelte`'s window keydown handler** (`:85-99`, which today refocuses the panel only for a Tab with no candidates): when this modal is top and focus is on `<body>`, any key first puts focus on the panel (Esc already closes the modal from anywhere). A Tab or Shift+Tab with focus on `<body>` or on the panel itself goes straight to the first or last control: from the panel, the browser's own Shift+Tab would step out of the modal (rev 7);
   - the level-3 quiz modals (`NewQuestionModal`, `QuestionTextModal`, `ExplanationModal`) take the same `isTopModal` clause in their ⌘S test. Their primary button stays enabled while busy, but Cancel, ×, the type picker and the MarkdownEditor toolbar are disabled while saving (`NewQuestionModal.svelte:149, 160, 165`, `MarkdownEditor.svelte:316`). So focus can drop there too, and the next ⌘S would open the browser's dialog;
   - a test dispatches ⌘S on `document.body` with the modal open and asserts `defaultPrevented` and one save call.
5. **FocusTrap: focusable autofocus (F5).** The autofocus loop skips a match that cannot take focus (disconnected, natively disabled, or inside `[inert]`) and falls through to the next match, then the ×, then the container's first `[tabindex='-1']` child (Modal's panel). An `aria-disabled` match is still a valid target, since it holds focus, so this is not `usable()`, which rejects it. FocusTrap's `containerEl` is a wrapper div and does not know the panel otherwise.
6. **FocusTrap: the opener after a Safari click (F13).** One app-wide capture-phase `pointerdown` listener, registered once, remembers `target.closest('button, a[href], [role=button][tabindex]')` for a primary press, and any other press resets it to null (rev 7: a right or middle press, or a `[role=button]` focus cannot reach, is no opener). The record is taken only while it can hold focus (`canHoldFocus`). Any `keydown` clears the record, because a keyboard opener already holds focus, and the clear stops a mouse press from minutes ago becoming the return target of a modal opened later from the keyboard. When a FocusTrap mounts with focus on `<body>`, or on an ancestor of the recorded element (WebKit focuses the nearest focusable ancestor, e.g. a modal panel), it takes the recorded element as its return target if it is still connected. Nothing changes where focus was already on the opener (keyboard, Chrome). If tests show the record to be unreliable, the fallback is an explicit `returnTo` prop passed by each opener in the F13 list; the plan says which.
7. **F6** takes `InlineInput`'s move-before-disable `$effect.pre`.
8. **F12** gets an effect that focuses the `<h1>` once the new course has loaded, if focus is on `<body>`. The `courseSlug` effect also dismisses `createAsk`, calls `resetCreateForm()`, resets `creating` and closes the duplicate row (`duplicatingId`), all inside `untrack`. `createAsk.dismiss()` reads `current`, so without it every create question would re-run the effect, close at once and reload the list. `openCreate` (`VersionsPage.svelte:97-102`) does not clear the fields, so without the reset the next course's form would open with the old label.

Tests: each site gets a jsdom test that disables or unmounts the focused control as the real flow does and asserts `document.activeElement` afterwards. jsdom drops focus from an element only when the element is removed, or re-rendered disabled, so the builder confirms the red state first for each, as Polish 1 did. F13's Safari behaviour cannot be reproduced in jsdom, where a click does not focus either, which helps. The test focuses `<body>`, dispatches `pointerdown` on the opener, opens, closes, and asserts focus on the opener. For the Mini-project editor it uses the edit path, so it does not pass for the wrong reason.

## The look

| Item | Where | Change | Closes |
|---|---|---|---|
| Error banners (C1) | `RunOverviewTab .ov-err`, `DashboardSidePanel .sp-error` (`:974-978`), `RosterImportModal .ri-banner` (`:489-497`), `MiniProjectModal .mpm-banner` (`:755-764`), `RunMiniProjectsTab .mp-banner-err` (`:393-395`), `RunAssetsTab .banner-error`, `NewRunModal .nr-banner` (`:202-210`) | Banner fills and text take `--danger-panel-bg` / `--danger-panel-fg`; an existing `border-left: 3px solid var(--danger)` stays. These seven are all the banners (grep of `--status-rejected` and of `border-left…--danger`). The grep's two other `border-left --danger` hits, `AssetSidebar .error` and `ErrorState .inline`, use other tokens and are not banners of this kind: they stay. Statuses keep `--status-rejected-*`: badges, pills, the Groups `.cap-full`, RosterImportModal's per-row `.ri-failed` chip (`:510-513`, gate-pinned), the mini-project page's `.feedback.rejected`, and the quiz `reveal-wrong` options. | polish1 "two pinks" |
| Cancel border (C2) | `theme-default.css:84` | `--cancel-border` alone (not `--focus-line-strong`, which the focus panels' pins use) gets a value ≥3:1 against `--surface`, `--focus-2`, `--danger-panel-bg` and every other ground a Cancel sits on. Its two users are `InlineConfirm.svelte:132` and `DangerConfirm.svelte:143`. The value is computed, not eyeballed, and the comment states the ratios. | polish1 `--cancel-border` |
| Invalid fields (C3) | `VersionEditPage.svelte:671`, `BlockAccordion.svelte:391`, `AccordionHeader.svelte:199` (the fields' `aria-invalid`) | `.add-input[aria-invalid='true']` (VersionEditPage, BlockAccordion) and `.title-input[aria-invalid='true']` (AccordionHeader): `border: 1.5px solid var(--danger)`. Scoped, that scores (0,3,0) and beats the base focus rule (0,2,1) (`styles/base.css:22-31`), so the edge stays red when focused, like ItemEditorModal's `.plain-input[aria-invalid="true"]`. A bare `[aria-invalid='true']` scores (0,2,0) and turns blue on focus. The gate cannot see the cascade, so the look check focuses an errored field. The blue halo stays, as on the other editor fields. The fields set `aria-invalid` only for an error about the title (a 422 on `title`, a title conflict, the rename's empty title); a network or server failure shows its line under the field, `aria-describedby` as before, without the red edge. | polish1 "three fields" |
| Group column (C4) | `RunProgressTab` (6rem), `RunSubmissionTab` (12rem) | A wrapper like Progress's `.name-box` holds the name and the "disabled" chip. Its width is the column width less 24px of padding and the 1px `border-right` (`.name-box` is `calc(14rem - 25px)`), with `overflow-wrap: anywhere`. The scroll padding (D73, D74) then holds for any name. At 6rem the Progress cap leaves 71px; the look check shows a long name. | polish1 2.4.11; polish2 D73/D74 review |
| Code in a question | `InlineConfirm.svelte:109` | The chip's background changes from `--surface` to `--surface-2`. | polish1 Task 1 |
| Long words | `RunGroupsTab .g-name`, `RunRosterTab .ro-err`, `MiniProjectDetailPage .members` | `overflow-wrap: anywhere`. | slice6a T9, slice6c whole-branch, slice4 |
| Table corners | `.mp-table` (`RunMiniProjectsTab:400`), `.assets-table` (`RunAssetsTab:916`), `.teach-table` (`TeacherRunListPage:141`), `.runs-table` (`RunListPage:218`) | Each table's outer border and radius move to a wrapper with `overflow-x: auto`, as Progress and Submissions do with `.table-scroll` (`RunProgressTab.svelte:545`, `RunSubmissionTab.svelte:333`). It clips the corners just as well, and unlike `overflow: hidden` it does not cut off a table wider than its container: at 400px the assets and mini-project tables are, and `hidden` would put Replace and Delete out of reach. The table takes `border-collapse: separate; border-spacing: 0`. A table's own radius does not clip its grey `th` corner cells. With the wrapper, RunAssetsTab's drag-over `outline` moves to it, and `.teach-table`'s `margin-top: 14px` (`TeacherRunListPage.svelte:141`) moves to its wrapper. Left on the table, it would be a blank band inside the border. On `.mp-table` and `.assets-table`, `th` has `border-bottom` and the first row's `td` has `border-top`; under `separate` both would draw, so the first body row drops its `border-top` and the header line draws once. Shots of all four at a laptop width, zoomed on a corner. They are teaching screens, so no 400px shot (D88). | slice6a T10, T11 |
| Crumb hover | `MiniProjectDetailPage .breadcrumb a` | `color: var(--text); text-decoration: underline` on hover, the player's rule (`SequencePlayer.svelte:264-265`). | polish2 Safari pass |
| Mini-project header | `MiniProjectDetailPage` `header`, `.drop:has(input:disabled)` | The header keeps its bottom space when there is no deadline row. `.title-row:only-child` takes the 18px that `.deadlines` gives, so no pinned row changes. The disabled colour moves to `.drop:has(input:disabled) .drop-label`. The faint colour fails to paint today because `submitting` implies `.has-file`, and `.drop.has-file .drop-label` (`:724`) wins. The new rule's specificity beats it. | slice4 |
| 0 uses (D87) | `RunAssetsTab.svelte:773-777` | At 0 uses the chip is a `<span class="uses-chip uses-off">` with `cursor: default; display: inline-block`; the button's `cursor: pointer` (`:933`) must not carry over. If a reload drops a chip with an open panel to 0, `openSubPanelAssetId` closes (and stays closed when the uses come back, rev 11), and a focused chip that becomes a span repairs focus (point 3), as does focus inside its open panel (rev 11). The tests at `RunAssetsTab.svelte.test.ts:2353, 2441`, which query a 0-uses `button.uses-chip`, change with it. | slice6a "0 uses" |
| Loose lists (D85) | `styles/content.css:40-46` | Inside `.prose :where(ul, ol):has(> li > p)`, every block of an `li` but its last takes `margin-bottom: var(--space-2)`: `… > li > :where(p, ul, ol, pre, blockquote, hr, div.math):not(:last-child)` (rev 10, user, Task 6 review: not only a `p`, so a code block, a quote or a nested list groups with its item too). A heading keeps its D63 em margins (Task 6 r2 ruling: a heading opens a part, it does not group with the line above it). Loose `li + li` becomes `var(--space-3)`. Do not use `p + p { margin-top }`: it collapses into the 16px above and changes nothing. Specificity: the page pair scores (0,2,3) (inside) and (0,1,4) (`li + li`). The inside rule, which sets the same `margin-bottom` as the compact base rule (`.prose.compact :where(p…)`, (0,2,0), `content.css:35`), beats it; `li + li` sets `margin-top` on an `li`, which no base rule touches. The compact scale therefore needs its own pair, written in full: `.prose.compact :where(ul, ol):has(> li > p) > li > :where(…):not(:last-child)` (0,3,3) and `… > li + li` (0,2,4); a `:where()`-wrapped compact rule would lose to the page pair. The compact pair keeps the relation, inside closer than between: `--space-1` / `--space-2` (the user's pick at the look check). The `:not(:last-child)` keeps the existing zeroing of the last block (`content.css:38-39`, (0,2,0)) intact whatever the specificity; without it the compact form would beat the zeroing and the last block of a compact loose item would regain a margin, which source order cannot fix. The header comment (`content.css:22-32`) gains a sentence on the list rules. All four rules take their place in the gate's `WANT_ORDER`, after the last-child rule. Tight lists are unchanged. A loose list whose items hold no `<p>` (blocks only) is not detected: backlog. | polish2 Task 3 design question |
| Quiz card prompt (C5) | `QuestionCard.svelte:146` `.qtext`, and `.qsrc` (`:147`, a closed version's raw prompt in the same place) | `--text` → `--text-2`. | polish2 whole-branch |
| Loading (D86, C17) | `RunSubmissionTab`, `RunProgressTab`, `TeacherRunListPage`, `RunDetailPage`, `RunListPage` | `<Skeleton>` with a row count that suits each surface; the label carries over (`Skeleton` takes `label` and renders `role="status"`). `LoadingPlaceholder.svelte` and its tests are deleted. **Progress and Submissions** today show the placeholder whenever `loading`, including a Refresh over data (`RunProgressTab:372`, `RunSubmissionTab:232-234`). Submissions refreshes after every evaluation save (`onRefetch={refresh}`, `:305`), and a bordered skeleton box jumping in above the grid each time would be worse than today's thin line. So the Skeleton shows only when `loading && !data`. A Refresh over data keeps the table. A change of run clears `data`, so the new run loads with the Skeleton, not with "Refreshing…" over the old run's rows (rev 11). The Refresh control is an IconButton, which has no spinner, so the busy state is a short muted "Refreshing…" beside it, inside a `role="status"` element: visible to sighted users and announced. The status element stays mounted and empty between refreshes, and only its text changes, because a live region inserted together with its text is often not announced. Tests query the text "Refreshing…", not `[role="status"]`, which would always match. The look check shows it. Tests: the first load shows the Skeleton; a Refresh over data shows none and keeps the rows. `RunProgressTab.svelte.test.ts:476-479` and `RunSubmissionTab.svelte.test.ts:441-443, 467` change with it (`:467` queries `.loading-placeholder, [aria-busy="true"]`). | slice4 "three loading primitives" |
| New run strip | `NewRunModal.svelte:193`, `.nr-strip-val` | In the no-version branch the reason wraps instead of ending in an ellipsis. | slice6b Task 2 |

## Behaviour

- **Versions create form (C8).** `cancelCreate` (`VersionsPage.svelte:104`) asks `DISCARD_ASK` in place whenever `createDirty()` (`:114`) is true, the same predicate Esc uses (`:115-123`): label, info or attempts changed. VersionsPage has no DirtyGuard or dirty registry; both live only in `VersionEditPage`. So it mounts its own `<DirtyGuard isDirty={() => creating && createDirty()} …>`, as `DashboardSidePanel.svelte:950` and `MiniProjectModal.svelte:520` do, with the question drawn in the create form's slot (`createAsk`).
  - **A successful Create must not ask.** `createVersion` calls `navigate()` (`:147`) while `creating` is still true and the mandatory label is filled, so the new guard would ask "Discard unsaved changes?" after every Create. So on success the form is reset and `creating = false` *before* `navigate()`. (`runGuards` calls `isDirty()` synchronously before its first await, so the reset is seen.) Both VersionsPage test files already use the real DirtyGuard and mock only `navigate` (`src/tests/VersionsPage.slots.svelte.test.ts:5-8`). That is what would hide the bug: with `navigate` a `vi.fn()`, the guard never runs. One test therefore uses the **real `navigate`**, in a file without that mock or through `vi.importActual` of the router module (the mock factory's own copy is out of the test's scope), and asserts that a successful Create changes the route with no question open.

  - **No question while Create runs** (rev 12). The guard's test is `creating && !createBusy && createDirty()`. A navigation question opened during the POST would take the busy Create's place, and the success would close the form under it, leaving `navigate()` waiting on a question nobody can see. The data is being saved anyway. The navigation question uses the D37 wording, "Discard unsaved changes and continue?"; its Cancel returns to the form's Cancel, or to Label while a row action holds `busy` and disables Cancel (rev 12, r1).
  - **A list error drops the form** (rev 12, r1). A failed reload puts the page ErrorState in place of the frame, so the form and its question are no longer on screen. The form is reset and closed then, as a course switch does (F12), so no navigation waits on a question nobody can see.

  (polish1 "VersionsPage's create form")
- **A file dropped beside the drop zone.** While `MiniProjectDetailPage` is mounted, `dragover` and `drop` on the window are cancelled for drags carrying files. Beside the zone the window's `dragover` sets `dropEffect = 'none'`, so the cursor shows that a drop does nothing; the zone's own `dragover` runs first and keeps the copy cursor. While submitting the zone does not accept the drag (it returns before `preventDefault`), so the window's handler shows the no-drop cursor there too. A PDF dropped beside the dashed zone then no longer navigates the browser to the file. The zone's own handlers (`:571-573`) pick a dropped file as today; only while submitting does the zone's `dragover` leave the cancelling to the window. Tests:
  - a drop beside the zone is `defaultPrevented`;
  - beside the zone `dragover` sets `dropEffect = 'none'`; over the zone it keeps `copy`;
  - a drag without files (a `dragover` and a `drop`) is left to the browser;
  - a drop on the zone still picks the file;
  - a drop on the disabled zone while submitting does nothing;
  - while submitting the zone does not accept the drag, so the window shows the no-drop cursor (Task 6 r2);
  - the window listeners are removed on unmount.

  (slice4)
- **Course list error.** `CourseList.svelte` holds a `{ status, message } | null` and branches on `!== null`, as `CourseView` does (`CourseView.svelte:22, 43-49`). An `ApiError` gives its `displayMessage`, or "Something went wrong on the server. Try again." when that is empty. Any other error (a network failure) gives "Check your connection and try again." (the ErrorState title "Couldn't load courses", `CourseList.svelte:45`, pinned by `CourseList.svelte.test.ts:187`, already says what failed). So a dead network still shows the error with Retry, never the empty state. Tests: one with `detail: ''`, which is red today because it shows the empty state, and one with a rejected `TypeError`, which is red on the new wording. (`courselist-empty-api-error-detail-shows-empty-state.md`)
- **Offline failures say so.** Where a write catches only `ApiError`, a network `TypeError` passes silently today. An `else` branch fixes that at each site:
  - a toast for the Overview groups switch (`RunOverviewTab.svelte:156-158`), `doPublish` / `doUnpublish` (`RunDetailPage.svelte:323, 349`), Teachers remove (`RunTeachersTab.svelte:75`), group delete (`RunGroupsTab.svelte:117`), roster remove (`RunRosterTab.svelte:526`) and the row group select (`:550`);
  - inline under the field, as their other errors, for the two add forms: Teachers add (`RunTeachersTab.svelte:44`) and roster add (`RunRosterTab.svelte:486-488`).

  The builder greps for the same shape in the touched files. (slice6a T9, final; slice6c T1–T3, whole-branch)

  Every site says the same thing (rev 12): `OFFLINE_MESSAGE` in `lib/api.ts`, "Could not reach server. Check your connection.", the string `lib/assets.ts`, `runAssets.ts` and `evaluations.ts` already throw. The try blocks also hold the refetch after a successful write, so a "Could not remove …" would be wrong when only the refetch failed. The Overview switch drops its "Could not update setting:" prefix for this message.
- **InlineName's messages.** `InlineName.svelte:58-60` shows:
  - `displayMessage` for an `ApiError`, and "Could not save." when that is empty;
  - "Could not save." for a network failure (`e instanceof TypeError`), a parse error (a `SyntaxError` from a malformed body), or anything that is not a plain `Error`, never the browser's raw "Failed to fetch" / "Load failed";
  - `e.message` for a plain `Error` (`e.constructor === Error`) a caller throws on purpose (rev 12, r1). The Overview's R32 wait line (`RunOverviewTab.svelte:139`) and the Groups duplicate-name message (`RunGroupsTab.svelte:67`) are pinned by tests and stay.

  A test with a rejected `new TypeError('Failed to fetch')`, and one with an `ApiError` whose detail is `''`, are red first. (slice6c whole-branch, slice6a T3)
- **Bulk move never sticks.** In `RunRosterTab`'s bulk dispatch, the refetch after the operations (`await onRefetchRosterData()`, ~`:309`) is wrapped. A failure then still settles the result banner with Dismiss and unlocks the controls. The failure is quiet: the banner reports the operations, and the roster shows what it had (rev 12). (slice6c T4)
- **404 label.** The label for each landing path lives beside `defaultLandingPath` in `router.svelte.ts`, so path and name come from one place, and `NotFound.svelte:11-13` uses it. (polish2 Task 5)
- **Staff e-mails (C9).** `_staff_url` (`backend/mathion/notifications/templates.py:33-35`) builds the `/teaching/{course_slug}/runs/{id}` address (route `routes.ts:18`). `test_notifications_templates.py:44, 58` changes with it. The old routes and RunsRedirect stay for old e-mails and bookmarks. (slice6a T4)
- **Run dates (C10).** `api/runs.py` compares the new end date with `updates.get("start_date", run.start_date)`, and a new start date with the end date in force, so neither field alone can invert the range. The Overview keeps editing one date at a time, so moving a whole run later means changing the end date first. The 422 says so in plain words. The dates are in the app's short format, e.g. "31 Mar 2026", as `formatShortDate` (`lib/datetime.ts:52-54`) shows them; the backend cannot call that, so it formats the date itself with a fixed English month list (not `strftime('%b')`, which follows the locale). For example: "Start date must be on or before the end date (31 Mar 2026). To move the run later, change the end date first." The end date's message mirrors it. When a PATCH sends both dates, the end date's message wins. The detail is a string, so the field shows it as is. Tests cover both directions. (slice6c T1)
- **Explicit nulls (C10).** Field-scoped validators reject an explicit `null` with 422 only where the column is NOT NULL:
  - `OptionUpdate.text` and `OptionUpdate.is_correct`;
  - `QuestionUpdate.text_md` (the question's field is `text_md`, not `text`; `schemas.py:333-338`);
  - `RunUpdate.title`, `start_date`, `end_date` and `groups_enabled` (`schemas.py:454-458`). With the new date comparison, `{"start_date": null}` would otherwise be a TypeError and a 500.

  `explanation_md`, `correct_numeric`, `precision` and `correct_text` keep `null` as meaningful. `ExplanationModal.svelte:70` sends `explanation_md: null` to remove an explanation, and the numeric-key 422 stays the handler's (`api/questions.py:162-163`). A model-wide "no nulls" validator would break Remove explanation with both suites green, since no backend test sends `explanation_md: None` today. Tests:
  - each rejected field returns 422;
  - **`{"explanation_md": null}` still returns 200 and clears the explanation** (a new regression test);
  - `{"start_date": null}` returns 422, not 500.

  (slice5d T1)
- **Links the sanitiser breaks (C11).** After `nh3.clean`, `render_markdown` unwraps every `<a>` that has no `href`, keeping its text. Probed in round 1:
  - nh3 drops the href of `https://a.b:99999999`, `https://%zz.org` and `https:///`;
  - for `https://[::1]/x` the href is dropped only after markdown-it's `normalizeLink` percent-encodes the brackets;
  - so a `urlsplit` check in `_link_tokens` cannot match nh3, and is not used.

  The bare and the authored forms (`[t](…)`, `<…>`) behave alike. Tests: each of the four bare addresses stays plain text, and an authored link with a bad href stays plain text. Stored HTML changes only on its next save, publish or clone (D55); there is no backfill before the beta. (polish2 Task 6)
- **C18, taken from the reviewers' list.** Each is user-visible, cheap, and sits in or beside a file this slice edits:
  - **Roster add error clears on typing.** `addError` is cleared only on submit (`RunRosterTab.svelte:445, 464`); an `oninput` clears it. (slice6c T3)
  - **New run: no stale banner.** `submitError = null` moves above the validation return (`NewRunModal.svelte:65-72`). Editing Start date also clears "End date must be on or after start date" when the change fixes it. (slice6b Task 2)
  - **The app preview no longer restarts on a title Save.** `AppBody.svelte:66-67`'s fetch effect reads `item?.script_url` off a fresh `item` after every tree reload. It reads a `$derived(item?.script_url ?? null)` instead. A test asserts there is no second `/assets` GET after a title Save. (slice5b T4)
  - **The evaluation form no longer re-fills over a teacher's edits.** `DashboardSidePanel`'s prefill effect re-runs when `effectiveEvaluation` changes identity, for example on a grid Refresh. It re-fills only when the evaluation's id changes or the form is clean. The clean test is read `untrack`ed, so typing does not re-run the effect, and the focus move to the checked radio happens only when editing starts, never on a re-fill. A test covers an edit in progress, then a refresh: the text stays and focus stays in the field. (slice6c T6)
  - **Discard in the mini-project editor waits for an upload.** Discard takes the same `UPLOAD_WAIT` reason as Save and Publish while an upload runs, so the finished upload cannot re-dirty the form and orphan its asset. (slice6b Task 4)
  - **A scheme-less or uppercase video URL is accepted.** This is a **change to `normalizeVideoUrl` itself**. Today `new URL('youtu.be/x')` throws and the function returns the input unchanged (`lib/normalizeVideoUrl.ts:27-32`). Every pass-through branch also returns the input as typed (`:65-66`), so `HTTPS://example.com/v.mp4` keeps its upper-case scheme, and the backend's case-sensitive check (`schemas.py:148-153`) rejects it. The function gains two steps:
    - a scheme-less input whose host is one the function already recognises (YouTube's and Vimeo's hosts, `player.vimeo.com` included, exactly the set its parse branches handle) is retried with `https://` in front. From then on the retried string is the input, so the later pass-through paths return it;
    - every return path lowercases only the `^https?://` prefix, in place, and never returns `u.href`, which would rewrite the rest of the address.

    Its unit tests gain both cases. The new NewItemModal test clicks Create rather than calling `requestSubmit()`: jsdom's `requestSubmit()` runs constraint validation, and a scheme-less value fails `type="url"` (an existing test in `NewItemModal.svelte.test.ts` uses `requestSubmit()`). NewItemModal validates and sends the normalised value; today it validates and sends the raw `videoUrl` (`NewItemModal.svelte:53, 91` at `b47770c`). Its check then drops its `/i`, so it matches the backend. Its form is `novalidate` (rev 12): `type="url"` would block Enter on "youtu.be/x" while the Create click accepts it, and `ready` already is the check. VideoBody's `validate()` checks `normalizeVideoUrl(value)`, the value it sends (`VideoBody.svelte:72`), against the backend's prefix and 500-character rules, so a rejected URL shows inline, not only as a toast. The prefix message is the backend's, "URL must start with http:// or https://"; the length message, "URL must be at most 500 characters", is ours (Pydantic's own reads "String should have at most 500 characters"). It counts UTF-16 units where the backend counts code points, so a URL with astral characters near the limit can be refused here and accepted there (rev 12). (slice5b T3c, slice5c T4)
  - **The Teaching filter survives Back.** `TeacherRunListPage`'s status pill (`:19`) is kept in the address (`?status=`), so Back from a run restores it. The pill is a writable `$derived` of the address, so a click shows at once; the address follows with `replace`, as the run page's `?tab=` does. Active, the default, is the bare address; an unknown value reads as Active (rev 12). (slice6a final)
  - **The Submissions ring is not clipped.** `scroll-padding-right: 4px` on its `.table-scroll` keeps a focused button's outset ring inside the scrollport. (polish2 D74 review)

## Left in the backlog (C19)

User-visible entries the review round named, not taken, with the reason. They stay in their files.

- **5c header renames don't reload on 403/409**, and **a read-only flip drops a dirty title silently** (`slice5c…debt.md`). Both need another tab to publish mid-rename. Rare race.
- **Teachers add pulls focus back to the e-mail field** after a slow add (`slice6a…debt.md` T9). It needs the teacher to move on during a slow request. Rare race.
- **Focusing a pinned sort button scrolls the grid back to the start** (`polish2…debt.md`). Mild, and fixing it means a scroll-restoring rule on both grids. Left for the beta pass's look.
- **The mini-project editor's server-error banner can sit below the fold at 1000px** (`slice6b…debt.md`). Not reachable without a failed Save; check it at the beta pass.

## Narrow screens (D82, D88, C15)

**When:** the 400px shots come first, as recon before the plan is written. Each finding is then planned into the task that owns its file instead of reopening a committed task. A finding with no owning task becomes one small task of its own.

**What counts:**
- a page that scrolls sideways;
- a control that is clipped, overlapped or out of reach;
- text cut off with no way to read it.

Anything else that looks off counts only if the user flags it while looking at the shots.

**Results (2026-10-31, `shots-400.html`, 26 screens signed in as dev@):**
- **Student screens pass.** Login, the course list, the course page, the player (page, quiz, video, strip and "Item N of M"), the mini-project page and the 404: no sideways scroll, nothing clipped. The AppHeader fits at 400px. So no narrow-screen task is planned.
- **Authoring and teaching screens are out of scope (D88).** The shots found the Roster tab at 621px (Group column and row actions cut off), the Mini-projects tab at 702px, Teaching at 416px, the editor's item row breaking "Warm-up quiz" inside the word, the quiz editor header showing "Warm…", and the editor title wrapping to three lines. None of them is planned. The Overview `.ov-row` with a date field open fits anyway.

**Backlog entries this closes:**
- the AppHeader overflow measured at 320px (polish2 Task 2) and the memory's beta "375px top-bar" item: fits at 400px, closed;
- the course page at 390px, "keep as is" (`slice5c…debt.md` student-view follow-up 2): passes at 400px, closed;
- the run Overview's `.ov-row` at 375px (slice6c T1): a teaching screen (D88), closed;
- the player strip wrap (polish2 Task 2): wraps cleanly at 400px, closed.

Later student-screen changes in this slice are still shot at 400px (§Process).

## What the builder decides

- Store names, helper names and file placement.
- Which fields besides `attempt_count` `recordQuizAttempt` copies.
- The `--cancel-border` value and the compact list spacing, shown at the look check.
- The wording and placement of the Progress / Submissions "Refreshing…" line.
- Record-of-last-press versus `returnTo` for F13, after the tests.
- Whether the two plain course-page links also adopt `routeClick`; the app-wide handler covers them either way.
- How the tasks are cut. A suggestion:
  1. C13 per-item instance and the attempt count, quiz drafts, in-app links (the helper, the app-wide handler), the crumb;
  2. the focus mechanism;
  3. token-level look: banners, Cancel border, invalid fields, code chip, prompt colour;
  4. layout-level look: Group column, long words, table corners, crumb hover, MP header, 0 uses, lists, New run strip, plus the Skeleton;
  5. frontend behaviour, including C18;
  6. backend: files, e-mails, dates, nulls, links;
  7. plus any 400px finding without an owner.

## Gate rows that change

The plan names each, so every red/green is planned. Line numbers are from `visual-refresh-gate.sh` at `e10671b`:
- banners: `.mp-banner-err` ~4872, `.banner-error` ~4891, `.nr-banner` ~4960, `.ri-banner` ~4985, `.mpm-banner` ~5003, `.ov-err` ~5057; `.sp-error` is unpinned and gains a row; `.ri-failed` ~4983 stays;
- `.qtext` `color:var(--text)` ~4508 (C5), and a new `.qsrc` row;
- the MP `.drop:has(input:disabled)` `color:var(--faint)` ~3704 (the colour moves to `.drop-label`);
- new rows for the four table wrappers, in their owners' existing `own` / `uniq1` blocks (~4713, ~4723, ~4861, ~4882), and for the Group-column wrappers in Progress and Submissions;
- a row for every other CSS change in §The look and C18: the code chip, the long-word `overflow-wrap`s (`.g-name`, `.ro-err`, `.members`), the crumb hover, the mini-project header, the `.uses-off` span's cursor, `.nr-strip-val`, and the Submissions `scroll-padding-right`;
- the `:root` hash in `WANT_FULL` (C2 changes a token);
- content.css `WANT_FULL` / `WANT_ORDER` (~521-590) and the "49 rules" comment (D85);
- `.uses-chip` ~4888 stays (the span keeps the class);
- `.add-input` ~3903 and `.title-input` ~3959 stay, and gain the qualified `[aria-invalid]` rows (C3);
- `.vtitle` ~3830 (the row title as a link);
- the SequencePlayer AST/SIG rows (~1381, ~1540-1553) stay unchanged by C13's placement, and the ItemRouter grep rows (~1171) are unaffected by the `{#key}`;
- the MiniProjectLink SIG row, if the mini-project row adopts `routeClick` (its markup gains an `onclick`);
- `LIB_6A` (~4636) keeps `src/lib/focusFirst.ts`;
- no gate row pinned `LoadingPlaceholder` before (checked); Task 7 adds two that pin its deletion: the file is gone and nothing in `src` names it, and no `.loading-placeholder` rule is in the bundle (rev 11). Four `.refreshing` rows, two per grid (muted text; at rest the empty status cancels the flex gap of the right-hand group it sits in, `.pg-right` 8px or `.sub-right` 6px, and that gap is pinned beside it), join the Progress and Submissions rows.

## Testing

As in Polish 2. jsdom computes neither layout nor the cascade, so for CSS changes the gate row is the red/green: it is written first, run against the old dist (red), then against the change (green), with hashes derived from dist. A declaration-presence row cannot see the cascade either. For C3 and D85 the rows therefore pin the qualified selector and the margin rule named above, and the look check confirms the result.

Behaviour is TDD: a test that fails first, then the fix. The backend changes are pytest via `backend/.venv`.

## Backlog lifecycle

Each task removes the entries it resolves in the same commit. A standalone file is `git rm`'d (`courselist-empty-api-error-detail-shows-empty-state.md`, and `mp-can-submit-null-guard-is-dead.md` with the MiniProjectDetailPage edits). In the per-slice files the bullet is deleted.

The first task also closes, in its docs commit, the entries the recon and review round 1 found stale:
- `docs/backlog/not-found-page-unstyled.md` (`git rm`: Polish 2 `4b0ff63` restyled the 404);
- slice4: "Two back-navigation conventions coexist". Page headers use the round ← button, the player and the mini-project page use breadcrumbs, and "Back to course" appears only in error states;
- slice5a T1, the `InlineField` entries (the component no longer exists); T5a "slug / code badge wrap" and T6 "a long slug can squeeze the item title" (5c removed the badges); final review "N identical 'Editing closed' toasts" (no such toast exists) and "Create inputs lack maxlength" (all three have `maxlength={200}`);
- slice5a T2 "Focus after a row action" for Disable / Enable, and the final review's delete-block and create-success halves (fixed in Polish 1 and 5c). The Duplicate half stays as F1;
- slice5d T3 Retry; slice6a final "Publish ↔ Unpublish swap" (fixed in 6c); slice6a T3 DangerConfirm busy focus (it restores after settle);
- slice6c whole-branch "the row-confirm warning doesn't wrap" (`InlineConfirm .warning` has `overflow-wrap: anywhere`); the `.ro-err` half stays until the look task;
- `flex-1-titles-may-collapse-to-zero-width.md` is reworded, not deleted. `ItemRow.svelte:99` and `AccordionHeader.svelte:92` were rewritten and `OptionRow.svelte` is gone.

Entries measured below 400px are reworded to 400px or closed by §Narrow screens.

## Process

Per task, as in Polish 1 and 2:
1. TDD (for CSS, the gate row first);
2. vitest (`TZ=Europe/Copenhagen`), svelte-check and the gate (absolute `TMPDIR`); for backend tasks also `backend/.venv` pytest;
3. screenshots or a look check, at a laptop width, and at 400px for a student screen (D88);
4. the user's OK;
5. Opus and Fable review lanes on the uncommitted diff, re-run after every fix until clean;
6. the user's commit OK, then a docs commit and the code commit, with exact paths and the trailer;
7. a ledger line;
8. wait for "go".

Then a whole-branch review (fresh Opus and Fable) and a Safari pass, one step at a time.

## Carried to the Safari pass

- **Quiz drafts:**
  - answer two questions, go Next, Previous, the strip, the course page and the course list, and back: the answers are there;
  - submit: the draft is gone;
  - reload with answers: the browser warns;
  - sign out and in: no answers;
  - two quizzes in a row: submit the first, Next: the second opens unanswered and unlocked;
  - use the last attempt, leave, come back: the reveal shows.
- **In-app links:**
  - a link to another Mathion page in a quiz prompt mid-quiz moves without a reload (the top bar does not flash), the answers stay, and the new page opens at its top;
  - a `#heading` link leaves the player on its item;
  - from the course page, the mini-project row and a Coming deadlines link move with no leave-page warning while a draft holds answers;
  - a link in the editor preview leaves through the discard question when the item is dirty.
- **Course files:** a linked PDF and a PNG open in the new tab; a CSV downloads.
- **A file dragged on the mini-project page:** beside the drop zone the cursor shows no drop and a drop does nothing (the page stays); over the zone it shows copy and the drop picks the file; while a submission is in flight the zone shows no drop either.
- **Modifier clicks:** ⌘-click a course card, a sequence row, a crumb, a top-bar link, a run title on Teaching and a Versions row title. Each opens a new tab, and the current one stays.
- **Focus after a mouse click (F13):** open the Progress side panel, New run and the Mini-project editor (edit) with the mouse, close each with × or Esc, then Tab. Focus continues from the opener.
- **The item modal:** a mouse Save leaves focus on Save. ⌘S again does nothing while clean and never opens the browser's Save dialog. The busy Save shows primary with its spinner (C16).
- **The look:**
  - the error banners beside a danger panel (one pink);
  - a Cancel beside its action, on white and on a panel;
  - the three invalid fields, focused;
  - a long group name in Progress and Submissions, with keyboard scrolling;
  - the teacher tables' corners;
  - the 0-uses label;
  - a loose list;
  - the teacher screens loading (throttled network), and a Refresh over data on Progress and Submissions.
- **400px:** the student screens (D88).

No VoiceOver steps. The beta VoiceOver list gains two checks: whether an in-app link move is announced (focus and title after `navigate()`), and the Versions row title as a link, aria-disabled while busy.
