---
worth: yes
added: 2026-11-14
---
# Browser checks by hand for the beta pass

Only the checks a person must make on real devices and a real proxy. They run against the deployed beta server, not the laptop: the dev servers stay on 127.0.0.1, and the office Wi-Fi blocks phone-to-laptop connections. The Safari checks, the keyboard-in-frames check and the hover-tip decisions were done on 2026-11-25. Their fixes are in the beta-pass fix round. The VoiceOver checks are in `beta-voiceover-pass.md`.

## Install on the rented server (before the beta)

Done on 2026-11-26 with `cli-v0.9.0` and image `v0.3.0` on Ubuntu 24.04: the fresh install with its first PIN, the DNS-not-pointing-here path (answer n, then the printed `tls enable` line), re-running the one-liner, `sudo mathion install` again, and `sudo mathion panel` all worked. One check is left:

- **Debian 12, after the provider reinstalls the system:** run the one-liner, press Enter at `Set up Mathion on this server now?`, answer the questions and let it install Docker. Docker's apt key that Mathion writes is accepted (`apt-get update` shows no key error), `systemctl is-enabled docker` says `enabled`, and the ending shows the site address and a first PIN that signs you in.

## Windows High Contrast (on the deployed beta)

Chrome's emulation was read on every screen. Only a real theme settles the colours.

- **The selected run tab** has the only Highlight line under the tab row; a hovered tab shows a plain line.
- **Disabled fields** (Set up step 1 with email off, including the selected encryption option) grey their text and borders with GrayText. So does the student's file drop while a submission is sending.
- **The Evaluation result** (run side panel): the selected option has a ring, and the focused one has the Highlight ring.
- **The Switch:** on, off and disabled are all visible. A disabled Switch shows on or off by knob position only (accepted).
- **The item and question type pickers:** the selected card has a neutral ring and the focused card a Highlight ring. Check that Highlight and black are told apart in a real theme.
- **The open block or sequence panel:** the parent and the focused panel share one CanvasText ring. Is the focused one still clear?
- **The student strip:** a done item is solid, a not-done item dashed, and the current item a three-sided Highlight tab.
- **The header's current page** (Authoring or Teaching) shows by bold weight only, because the fill is dropped.

## Real HTTP/1.1 proxy (on the deployed beta)

- **A too-big upload through an old proxy:** HTTP/1.1 nginx can drop the connection instead of sending its 413. Upload 40 MB through one and note which message the student gets: the network copy with Retry, or the limit sentence. If it is the network copy, adjust the D11c paragraph ("Upload limit", `docs/self-hosting.md`) and `docs/release-notes/settings-release-order.md`, which quote the sentence.

## A real touch device (on the deployed beta)

- The quiz editor's always-shown answer controls (D8) on a phone or tablet: ↑, ↓ and delete show on every answer row without a tap.

## Kept on purpose

- Esc in a clean title edit while #19's question asks focuses that question's Cancel instead of cancelling the edit: R53, one question per place.
- Safari: Esc with a native date or date-time picker open also reaches the page. It cancels an inline run-date edit and closes a mini-project dialog with no changes; a dialog with changes still asks first. A page cannot tell when Safari's picker is open (owner, 2026-11-25).
- Hover tips: a reload that moves a hovered chip from under a still mouse can leave its tip until the next mouse move, and Esc on a keyboard-focused chip keeps its tip closed until focus leaves and comes back (owner, 2026-11-25).
- Safari draws no focus ring inside a YouTube frame. The player is not ours to style; its keys still work (owner, 2026-11-25).
