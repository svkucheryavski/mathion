# Slice 5b (authoring: item editor modal) — deferred Minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## T2 — MarkdownEditor + AssetSidebar

- **AssetSidebar: disabled rows do not recede** (`.row-click:disabled` changes only the cursor). Add a
  token colour (`--faint`) on the name under `:disabled`.
- **[open]** **AssetSidebar: Escape while a confirm is open but focus is on the row's insert button** still closes an
  enclosing modal (R7 scopes Escape to the pair). Polish if "confirm open ⇒ Escape = Cancel" is wanted.

## T3a — ItemEditorModal + PageBody (interim quiz/app)

- **[open]** **Header spacing: trash and × sit 10px apart** (Modal's head gap) where ref 1689 groups them at 6px.
  Spec §2's "Modal adds ×" sanctions it. Fix: a Modal `actions` snippet rendered beside ×, or document it.

## T3b — Item route hosted by VersionEditPage

- **A late DELETE success can steal focus.** Open an item in-page and press Trash with a slow DELETE.
  Press Back, open "New item" and type. When the DELETE resolves, `deleteOpenItem` focuses
  `#seq-…-header` (VersionEditPage ~:297) and the next Space toggles the sequence. The code follows
  D9's wording, but D18 says focus is never stolen. Fix: focus the header only when focus has dropped
  to `body`/null; the normal path still works because the reload removes the restored pencil.
- **B's trash does nothing while A's DELETE is in flight.** Back during A's DELETE, open B, click
  Trash: `deleteOpenItem` returns early with no confirm and no feedback. Fix: pass
  `deleteBusy={deletingIid !== null}` into the modal's `trashDisabled`, or toast from the early return.
- **No toast after a DELETE that succeeds following a version switch.** The `!stillOnVid` bail
  returns before "Item deleted". Fix: toast before the bail, or document why it is silent.

## T4 — Video preview card, AppBody, frame heights

- **The wrong message when the link PATCH fails** (predates T4). Scenario: the version is archived in another tab mid-upload. `PATCH script_url` returns 409, the user sees "A file with that name already exists…", and the 403/409 forced reload never happens. Fix: show the duplicate-name message only when `!uploaded`. On 403/409 with `stillOnVid`, force `loadAdminTree`.
- **"App uploaded" / "App removed" toast success even when the refresh fails.** `loadAdminTree` returns `'error'` rather than rejecting, so the row keeps showing the stale value. Fix: check the result and use the modal's "(refresh failed — reload to see latest)" info toast. The "linked asset kept when only the refresh fails" test mocks a rejection that cannot occur in practice. It still guards the `linked` gate.
- **AppBody `.field-err` sits under the label column**, not under the value as in the D12 Title/Video URL pattern. Fix: wrap `.script-row` and the error in a `.field` column, as VideoBody does.

## T6 — Quiz look (3f)

- **(Round 2) The resync-failure toast is `'error'`.** It stacks a second red toast under the operation's own error. The modal's equivalent secondary notice is `'info'`. Fix: `'info'`.

## Final whole-branch review — deferred minors

- **The trash, when disabled by `bodyBusy`/`frozen`, still reads "Delete this item"** (Fable). A disabled control should state its reason. Fix: a third title branch.
- **× has no reason tooltip while frozen** (saving/deleting). It is disabled with the plain "Close" title.
