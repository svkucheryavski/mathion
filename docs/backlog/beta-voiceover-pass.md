---
worth: yes
added: 2026-11-12
---
# Screen-reader checks for the beta VoiceOver pass

Only what VoiceOver in Safari must confirm. The code fixes from the beta backlog round (2026-11-16) are tested in jsdom. Each one has a re-test line here, because only VoiceOver tells whether it reads well.

## Superuser panel

- Re-test: an info note after a Users or Courses action is read (its status region is mounted empty).
- Re-test: after a course delete, and after a confirmed Disable, Enable or Delete strip on Users, focus lands on the heading or the swapped button, and VoiceOver reads it.
- Re-test: a refused New or Edit account or course reads its error on the field it names.
- Re-test: the count line under Users is read after a search or a pill.
- Re-test: a role chip is a tab stop and reads its list once. The hover tip is aria-hidden; the hidden list is the text.
- CHECK: the blocked course trash has its reason in both `aria-label` and `title`. Is it read twice?
- Re-test: Branding's file line ("checking…" → "N colours") is announced.
- Re-test: Edit email opened with email off focuses the Switch; the test answer is read; "Encryption" and "Longest sign-in" are read as their groups' names.

## Student

- CHECK: the mini-project file input's name is the label's text, then the picked filename. Does it read sensibly?
- Re-test: Try again and Show correct answers read the score and attempt line after the button name. Is there a pause between "Score: 2 / 3" and "Attempt 1 of 3"? "/" read as "out of" or "slash" passes; a missing pause is a finding.
- CHECK: what is said on the result card after Show correct answers. Pre-existing; record only.
- Re-test: an authored link reads "(opens in a new tab)". Is it one VoiceOver stop or two?
- Re-test: a question input or legend named by a prompt with a new-tab link reads sensibly, with the note once.
- Re-test: the strip's current item is announced as current (`aria-current="step"`).
- CHECK: the 404 announces itself once, title then message, and not again on re-render.

## Authoring

- Re-test: an item row reads its type first ("Page: Intro").
- Re-test: "Add block", "Add sequence", "Add item" and the other add buttons are read without "plus".
- Re-test: the plain or read-only page body is a named group.
- Re-test: the disabled asset trash reads its reason. Is the reason read twice (name and title)?
- Re-test: while renaming a block or sequence, the panel region is named by the field: the draft, or the field label with an empty draft.
- Re-test: a refused Save in version settings moves focus to the first invalid field and reads its error.
- CHECK: Enter in a field that is already invalid and focused announces nothing. Is that too silent?
- Re-test: "Saved" is spoken after an inline save in the quiz editor (now said 150 ms later, after focus settles).
- CHECK: whether a repeated identical message ("Saved" twice) is read again.
- Re-test: the answer button reads its name once (its repeating "Edit answer" title is gone).

## Teaching

- CHECK: the confirm groups read "Delete X?, group" before their buttons. A key question reads its bold lead and the warning as one name (R52).
- CHECK: a busy confirm announces busy, and its Cancel is announced as unavailable.
- Re-test: the DangerConfirm group and its button no longer read the same words.
- Re-test: the Mini-projects and Assets delete questions are named after their row.
- Re-test: the out-of-scope cell reads "No data".
- Re-test: the run list's Actions header is read.
- CHECK: while a run tab loads, Tab from the tab list skips past the panel (the tabpanel has no `tabindex`, on purpose: see Kept). Is that acceptable?
- Re-test: the roster's added-student line is announced after an add.
- CHECK: the row group select is disabled while its request runs, and focus sits on `<body>` meanwhile. What does VoiceOver say?
- Re-test: the side panel's feedback-file error is read again when focus returns to "attach PDF".
- Re-test: the Version row's disabled ✎ reads "Edit the version".
- Re-test: a busy Publish reads its reason ("Wait for the publish to finish").
- Re-test: the Overview's wait hint is announced (its status line is mounted empty).
- Re-test: `.pc-emails`, the step marker and the precondition box are read as lists, and the box's "·" is not read.
- CHECK: the Switch reads "Groups enabled, switch, off".
- CHECK: is the disabled Publish too silent without a description? If so, add `aria-describedby` to the box heading.
- CHECK: Done reads its summary ("Done, button, 1 added, 1 failed"); the import tiles read "Valid" and "Will skip".
- CHECK: how "Import roster, button" sounds as the import opens from the empty-roster link.

## Kept on purpose

- The version heading link's purpose is in its `title` only: spec choice.
- The block and sequence panel names carry the progress phrase: informative, and the sr-only form mis-announced in Chrome.
- The MiniProjectModal publish group is named by its two-sentence warning: noted, no better name found.
- The run tabpanel has no `tabindex="0"`: Safari would focus the panel on every click inside it and break the focus repairs.
