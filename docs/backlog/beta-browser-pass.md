---
worth: yes
added: 2026-11-14
---
# Browser checks by hand for the beta pass

Only the checks a person must make: Safari, Windows High Contrast, a real HTTP/1.1 proxy, a touch device and the keyboard inside an iframe, plus one decision for the pass. Chrome's forced-colours and reduced-motion emulation, the superuser pages, the Evaluation control and most Task 4-5 fixes were checked in agent-browser on 2026-11-16 (beta backlog round, Task 9). The rest are below. The VoiceOver checks are in `beta-voiceover-pass.md`.

## Safari

- **Asset table at 1000px** (Run → Assets, a long filename and a long uploader email, delete question open): the Filename column keeps about 12rem and the question sits in its own row. Does WebKit honour `min-width` on the `td`? Where does the email break? Chrome breaks it mid-word.
- **Pinned sort buttons keep the scroll.** Progress (Student, Group) and Submissions (Group): scroll the grid sideways, then Tab or ⇧Tab onto a pinned button. The table should stay where it was. The hold relies on async scroll events, which were checked only in Chrome.
- **Confirm rows leave room for the focus ring.** Tab to Cancel in a roster, asset or mini-project delete question. The ring should not touch the row above.
- **A wrapped end-aligned warning** (a delete question with a long email or filename, 1000px): its lines end at the right edge.
- **Esc with a native `datetime-local` or `date` picker open** (mini-project deadlines, run dates): note whether Esc closes only the picker or also the edit or dialog.
- **A failed Save in the mini-project editor at about 1000px** brings the error banner into view at the top of the body, not under the padding.
- **New run and the Publish conflicts at 1000px:** they fit without a sideways scroll. They were checked only in Chrome.
- **Copying a paragraph with an authored link** leaves out the hidden "(opens in a new tab)". Chromium does. Also note whether find-in-page counts it (record only).

## Windows High Contrast

Chrome's emulation was read on every screen. Only a real theme settles the colours.

- **The selected run tab** has the only Highlight line under the tab row; a hovered tab shows a plain line.
- **Disabled fields** (Set up step 1 with email off, including the selected encryption option) grey their text and borders with GrayText. So does the student's file drop while a submission is sending.
- **The Evaluation result** (run side panel): the selected option has a ring, and the focused one has the Highlight ring.
- **The Switch:** on, off and disabled are all visible. A disabled Switch shows on or off by knob position only (accepted).
- **The item and question type pickers:** the selected card has a neutral ring and the focused card a Highlight ring. Check that Highlight and black are told apart in a real theme.
- **The open block or sequence panel:** the parent and the focused panel share one CanvasText ring. Is the focused one still clear?
- **The student strip:** a done item is solid, a not-done item dashed, and the current item a three-sided Highlight tab.
- **The header's current page** (Authoring or Teaching) shows by bold weight only, because the fill is dropped.

## Real HTTP/1.1 proxy

- **A too-big upload through an old proxy:** HTTP/1.1 nginx can drop the connection instead of sending its 413. Upload 40 MB through one and note which message the student gets: the network copy with Retry, or the limit sentence. If it is the network copy, adjust the README's D11c paragraph ("Upload limit", README.md) and `docs/release-notes/settings-release-order.md`, which quote the sentence.

## Any browser, to decide at the pass

- **Hover tips on Users chips and Progress cells:**
  - A reload that moves a hovered chip from under a still mouse can leave its tip beside the pointer until the next mouse move.
  - Escape on a keyboard-focused chip keeps its tip closed until you Tab away and back.
  - The tip cannot be hovered (`pointer-events: none`). That is a WCAG 1.4.13 "hoverable" gap: decide whether a long list needs it.

## A real touch device

- The quiz editor's always-shown answer controls (D8) on a phone or tablet.

## Keyboard in an iframe

- The video and app frames get no focus ring (D67): CSS cannot style a focused frame in Safari. Tab into a YouTube video and into an interactive app, including an admin-authored app that draws no focus of its own, and check that the focus is still findable.

## Kept on purpose

- Esc in a clean title edit while #19's question asks focuses that question's Cancel instead of cancelling the edit: R53, one question per place.
