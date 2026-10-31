# Polish 2 (named items) — deferred minors

Minors the review lanes raised and the user did not take into the slice, by task.
Spec: `docs/superpowers/specs/2026-10-18-visual-refresh-polish2-named-items-design.md`.
Plan: `docs/superpowers/plans/2026-10-18-visual-refresh-polish2-named-items.md`.

## Task 1 — focus ring and reduced motion

- The video and app iframes get no focus ring (D67, Safari pass): CSS cannot style a focused frame in Safari, and in Chrome only `:focus-within` matches it. Focus inside the frame is shown by the embedded page itself (YouTube's controls; an app's own page). Check with the keyboard at the beta pass, including an admin-authored app that draws no focus of its own.
- **For the Safari pass (a question for the user):** D60's gray list is the user's exact list. The ✕ "Cancel" IconButtons beside a ✓ (InlineName, InlineInput, KeyAnswer, BlockAccordion), the borderless chevrons, the `.add-line` buttons and the CourseCard footer links keep the steel-blue ring. So an InlineConfirm "Cancel" rings gray while an inline field's ✕ "Cancel" rings blue (Opus r1 note).
- RunSubmissionTab's sort and status buttons have no inset rule: their cells are padded enough for the outset ring (P98).
- The gate's `--ring` count row sees only `--ring: var(…)` in the bundle. A wrapper setting `--ring: currentColor` or `transparent`, or a markup-level `style="--ring: …"` / `style:--ring`, would recolour the rings inside with the count still at ten. Fix: count any value, and add a source grep for markup-level `--ring` like (b5)'s inline scan (Opus r2 m1).
- `docs/backlog/polish1-confirms-debt.md`, the Polish 3 bullet: "16 per-component forced-colors blocks" is 17 since Task 1 added `.sp-seg-opt` (Opus r2 m2).

## Task 2 — the page ground and the sheets

- **For the Safari pass:** the focus ring on the current strip tab. It wraps the tab, so its lower stroke sits just inside the sheet below the joint; that is unavoidable for an outline on a tab that overlaps its sheet. If it reads badly, the current tab alone could take a negative `outline-offset` (both lanes, r1).
- **For the Safari pass:** the done tiles in the strip read by their `--muted` glyph (4.94:1); their `--border-strong` edge is 1.04:1 on the `--border` fill and cannot be seen. If the tiles read too faint, the edge needs a darker token (Opus r1 M2).
- **Not checked in a browser:** High Contrast (forced colors) for the strip. The review traced the cascade (solid done fill, dashed not-done, a three-sided Highlight tab), but neither Chrome here nor Safari emulates forced colors; check on Windows High Contrast before beta.
- A browser that predates the `forced-colors` media feature (Safari < 16) skips the `forced-colors: none` block: the strip then shows the shared ItemMark colours (blue = done) with the D62 tab geometry. Coherent, not broken; restating the colours unconditionally plus a fuller `forced-colors: active` block would remove the dependence (Fable r1, Opus r1 note).
- On a phone, a long sequence wraps the strip; a current item on an upper row cannot touch the sheet and reads as a white button (spec §The player strip, known limit).
- The gate row `none … "body:has\([^)]*\)\{[^}]*--focus-page"` misses a selector with nested parentheses (`body:has(.page:not(.x))`); loosen to `body:has\([^{]*\{[^}]*--focus-page` (Opus r1 M3).
- `theme-default.css`, the `--focus-page` comment: "below --focus-1/--focus-2" is ambiguous, since `--bg` is lighter than both (Fable r1).
- Two stale words from the D62 fix (r2): the spec's §The player strip Gate bullet says the ItemMark inventory "gains the five rules", now four (Fable r2); the gate comment above the (i) SPECS (`visual-refresh-gate.sh:2062-2064`) still says `.icon` is the whole of what ItemIcon may keep, now `.icon` and `.icon.current` (Opus r2 m1).

## Task 3 — authored content, page scale

- **Before Task 4 (six more surfaces take the same carve-out):** partly done in Task 4 (the r1 lanes found gaps, see `## Task 4`), two (an) rows: externalLinks.ts may only `setAttribute` target and rel (no style, class or DOM changes), and every content surface imports it once from the lib with no other binding. Was: the scanner's `attachOn` pins the source text `{@attach externalLinks(…)}`, not what the function does. An edit to `externalLinks.ts` that sets `.style` or `classList`, or a local `externalLinks` in PageItem that shadows the import, restyles the content box with the gate green. Fix: (an) source greps that PageItem imports `externalLinks` once from `'../../lib/externalLinks'` with no local binding, and that `externalLinks.ts` has no `.style`, `classList`, `setAttribute('style'` or `setAttribute('class'` (Opus r1 m2).
- The (an) stray-`prose` row matches only `class="… prose …"`. `class:prose`, a template-literal or array class, or `class="prose {x}"` adopt `.prose` uncounted. Fix: match the bare `prose` token in any class form and diff against CONTENT_SURFACES (Opus r1 m1, Fable r1 M3).
- MiniProjectDetailPage's attachment is pinned only by a fixed-string line count (the page is not in the scanner's SPEC set), so a second `{@attach}` elsewhere on the page passes, and a line-wrapped reformat of the div is a false red. Fix: add `grep -c '{@attach'` = 1 for the file (Fable r1 M2, Opus r1 m3).
- The (an) `nredecl` grep misses `:global(a:hover)`, `:global(p:not(…))`, `:global(img[src])`, `:global(.content p)` and the nested `:global { … }` block. Belt and braces only: (b3) GLOBAL_ALLOW equality catches any new `:global` on both surfaces (Fable r1 M4, Opus r1 m3).
- The (h) PageItem `none` row `\.content\.H [a-z]` misses the child combinator (`.content.svelte-H>p`); the (p) set-equal inventory catches it anyway. Fix: `[ >~+]` (Fable r1 M5).
- **Design question for the Safari pass:** in a loose list on the page scale a second paragraph in an item is 16px from its first and 16px from the next item, so `li + li { margin-top: var(--space-2) }` has no visible effect and items do not group. Not a regression (the old rules had no loose-list case). Fix, if wanted: `p + p` inside `li` at `--space-2`, or zero `p` margins in `li` and let `li + li` carry the gap (Fable r1 M1).

## Task 4 — authored content, compact surfaces

- The two (an) rows from the Task 3 ruling still have gaps. The "only target and rel" row is a deny-list: `a.removeAttribute(…)`, `a.href = …`, `a.textContent = …`, `a.hidden = true`, `addEventListener`, `before`/`after`/`insertBefore`/`replaceChildren`, `dataset`, bracket access `el['style']` and an `import` in externalLinks.ts that hands the element to a helper all pass. The import row accepts any depth (`(\.\./)+lib/externalLinks`), so a second `externalLinks.ts` under `src/components/lib/` would be imported with the gate green. Fix: an allow-list (method names ⊆ querySelectorAll, getAttribute, setAttribute, test; no element property write `\b\w+\.\w+\s*=[^=]`; no `import`), and pin each surface's exact relative path (Fable r1 M1, Opus r1 m2).
- A second attachment on another element of the unscanned surfaces (CourseView, VersionEditPage, QuestionCard, MarkdownEditor, MiniProjectDetailPage) passes: `src_count` pins the div line, and `nbind` rises on both sides for a second `externalLinks` attachment. Widens the Task 3 MiniProjectDetailPage item. Fix: per file, `grep -c '{@attach'` equals the known count (CourseView 2, QuestionCard 2, MarkdownEditor 1, VersionEditPage 3, MiniProjectDetailPage 1) (Fable r1 M2, Opus r1 m3).
- Which `variant` each editor host passes is pinned nowhere: dropping `variant="prompt"` from NewQuestionModal or QuestionTextModal, or `variant="explanation"` from ExplanationModal, renders that preview at the page scale with tests and gate green. Fix: a `src_count` per host, or one assertion per QuizModals test that `.preview` has `pv-prompt`/`pv-explanation` and `compact` (Opus r1 m1).
- **For the Safari pass:** "Rendering…" and the error preview carry no variant class, so they take the modal's 14px; in the explanation modal the text changes size (14px → 13px) as the preview resolves. Spec-consistent (`.preview` keeps only padding and min-height) (Fable r1 M3, Opus r1 note).

## Task 5 — the 404 page

- The 404 button's label is keyed on the literal `'/teaching'` (`NotFound.svelte:11-13`), apart from `defaultLandingPath`. A third landing path (a superuser landing on `/superuser`, say) would read "Back to courses" while going elsewhere. Fix: a label beside `defaultLandingPath` in router.svelte.ts, so path and name come from one place (Fable r1 M1, Opus r1 note).

## For the beta VoiceOver pass

- The 404 announces itself on load (ErrorState's `role="alert"`): check it reads once, title then message, and does not repeat on re-render.
- Nothing announces that an authored link opens a new tab. A visually hidden "(opens in a new tab)" added by `externalLinks` is the candidate.

## Task 6 — bare URLs

- A malformed bare address (out-of-range port `https://a.b:99999999`, `https://[::1]/x`, `https://%zz.org`, `https:///`) now becomes an `<a>` with no `href`: nh3 drops the href it cannot parse but keeps the tag, so it is underlined like a link (D57) yet does nothing. Before Task 6 it stayed plain text; the authored forms (`[t](…)`, `<…>`) already behave this way. Fix (also covers the authored forms): after `nh3.clean`, unwrap anchors that lost their href, or reject in `_link_tokens` what `urllib.parse.urlsplit` cannot parse; add a test that `https://a.b:99999999` stays plain (Opus r1 m1).
- An entity or a backslash escape that is not a letter or digit ends the link there: `https://x.org/?a=1&amp;b=2` links up to `1`. Same as markdown-it's own linkify (both run while escapes are separate tokens, which is what keeps `http\://x` plain). Realistic for URLs pasted from HTML with `&amp;`. One that IS a letter or digit (`&uuml;`, `\_`) leaves the whole address plain (D66, pinned). Pin the `&amp;` row (Fable r1 M2, Opus r1 note).
- The mirror seam before an address: `&uuml;https://x.org` and `\_https://x.org` still link (the `(?<!\w)` lookbehind sees only its own token), while `éhttps://x.org` stays plain. Harmless direction (a whole, valid address); a `prev_char` peek when `m.start() == 0` would close it (Fable r5 M1).
- The rule sits `before("text_join")`, which is also after `replacements` and `smartquotes`; both are off in the commonmark preset, so it is equivalent today. If typographer is ever enabled, curly quotes would end up inside links. `after("inline")` is markdown-it's linkify slot and keeps the escape behaviour (Fable r1 M3).
- Unpinned edges, probed correct: `'` as trailing punctuation, a stack of trailing marks (`!?`), a port and fragment (`https://x.org:8080/p?q=1#f`), and two addresses joined by a comma (`https://a.org,https://b.org` links as ONE). Add parametrized rows (Fable r1 M4, Opus r1 note).
- The timing test (20000 `)` under 1s) would also pass a per-character `str.count` re-count (~0.2s). Raise the input to 200000 `)` with the same bound: linear stays ~0.02s, quadratic goes to tens of seconds (Opus r1 m3; Fable measured 2 ms and found it robust in CI).
- Deleting `stored-content-html-not-rerendered-after-renderer-change.md` (per the plan) leaves one property only in D55: stored `content_html` re-renders only on save, publish and clone. After the beta every renderer change (this is the second) needs a backfill decision (Fable r1 M5, Opus r1 note).

## Whole-branch review (ba8ace4..9bb8607, fresh Opus + Fable, 2026-10-19)

First verdict, before the fix pass: both ready to merge, 0 Critical / 0 Important. Fixed in the review pass: D66 at every inline seam (Opus m1 + Fable m1, graded up: Python dunder URLs such as `datamodel.html#object.__init__` linked `…#object`). The first fix made an address last inside emphasis plain (`**https://x.org**`); re-review r2 (both lanes, Important) → closing delimiters are looked past.

- `_TRAILING` trims a trailing `_`, `~` or `*` that belongs to the address: `https://x.org/a_b_` links `https://x.org/a_b`. Kept: GitHub's autolink extension trims the same set; unpinned (Fable m2).
- D66 judges the seam on the raw match, before trimming: `(https://x.org)*note*` and `See https://x.org.**Note** that` stay plain as a whole, although `)` or `.` is a real word boundary. Safe direction, rare; trim first and glue only when nothing (or a word character) was trimmed (Fable final r2 M1).
- The look-past over closing delimiters stops at an empty `text` token (a spent delimiter, or dollarmath's empty token before `$…$`): `*https://x.org/caf*__é__` and `*https://x.org/caf*$x$` link `https://x.org/caf`, and `**https://x.org**$x$` links where `https://x.org$x$` stays plain. Contrived (a cut address, a closer and an opener with no space). Fix: also skip empty `text` tokens in `_glues`' loop, and pin `*https://x.org/caf*__é__` (Opus final r3 m1, Fable final r3 M2).
- Only D6.12 proves the `externalLinks` attachment re-runs when the same element's content changes; the QuizItem and MarkdownEditor tests mount fresh elements (Fable m3).
- `externalLinks` "stays in the tab" cases assert that `rel` is absent, which is true only of the hand-built anchor; in production nh3 adds `rel` (Fable m4).
- The `validateLink` branch in `_link_tokens` cannot fail for an `http(s)://` match; comment or remove it (Fable m5).
- QuestionCard (`QuestionCard.svelte:146`) shows the prompt in `--text`, the student view and the preview in `--text-2` (Opus m2).
- Safari pass: `.prose h1` inside a `<legend>`; the run tabs' hairline and the superuser dashboard's unfilled boxes on the new ground (Fable, Opus recommendations).
- For the beta VoiceOver pass: `aria-current` on the strip's current ItemIcon (Fable recommendation).

## Safari pass (2026-10-22/23)
- Course files linked from content download instead of opening: `api/assets.py:189` returns `FileResponse(..., filename=...)`, which sends `Content-Disposition: attachment`. Pre-existing. A product question: should PDFs (and images) open inline in the new tab?
- D70 review: while `loadCourse` is in flight (or after it fails, which is non-fatal) the course crumb is an empty, focusable, unnamed link and the row reads "/ Mini-project"; after a cross-course navigation the old course's name shows briefly. The player has the same expression. Fix both: render the course link (and its separator) only when `currentCourse.value?.slug === courseSlug` (Opus m1, Fable m1).
- Cmd/Ctrl-click on in-app links (the crumbs here, the player's, CourseCard, SequenceLink, AppHeader) is swallowed by the app-wide `preventDefault(); navigate()` idiom; middle-click still opens a tab. App-wide fix: return early on a modifier key or `button !== 0` (Opus m2).
- `.breadcrumb a` has no hover colour; the player's crumbs darken to `--text` on hover (Fable m2).
- `.mp-col` is now a wrapper with no CSS, so the D68 `none` row (no `max-width` on `.mp-col`) passes vacuously; drop the wrapper and the row (tests on `.page > .sheet`) or widen the row and pin the wrapper in the markup (Fable m3).
- Gate comment at `visual-refresh-gate.sh:3656` still cites `.grid2{...}` as its example anchor; say "the former `.grid2`" (Opus m3, Fable m4).
- D73/D74 review: neither grid holds its Group column to its set width (Progress 6rem, no cap like `.name-box`; Submissions 12rem), so a long one-word group name widens it past the scroll padding, and Safari could again leave a focused cell partly under it. Cap both (e.g. a `group-box` at the width less the cell padding, wrapping) with gate rows (Opus m1, Fable m3).
- D73/D74 review: in both grids, focusing a pinned sort button (Progress Student/Group, Submissions Group) scrolls the table back to the start, so ⇧Tab from a late sequence header loses the place. Mild (Opus m2).
- D74 review r3 (Fable note): tabbing forward aligns a Submissions button's right edge to the scrollport, so its outset ring is clipped 4px on the right by `overflow-x` (the button stays visible). `scroll-padding-right: 4px` would finish the symmetry; Progress is unaffected (inset rings).
