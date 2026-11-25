---
worth: yes
added: 2026-11-14
---
# Browser checks by hand for the beta pass

Only the checks a person must make on real devices and a real proxy. They run against the deployed beta server, not the laptop: the dev servers stay on 127.0.0.1, and the office Wi-Fi blocks phone-to-laptop connections. The Safari checks, the keyboard-in-frames check and the hover-tip decisions were done on 2026-11-25. Their fixes are in the beta-pass fix round. The VoiceOver checks are in `beta-voiceover-pass.md`.

## Install on the rented server (before the beta)

The new one-command install (`feat/easy-install`), after the first `cli-v*` release that includes it is tagged. One run per line; note what the terminal printed.

- **Fresh Ubuntu 24.04:** run the one-liner, press Enter at `Set up Mathion on this server now?`, answer the questions, and let it install Docker. It ends with `✓ Mathion is running at https://<domain>` (or, if Let's Encrypt is slow, `… will work once the certificate arrives.`) and a first PIN, and the PIN signs you in. Right after the first boot, apt can be busy for a minute or two with its daily jobs: the install should wait for it (up to 2 minutes) instead of failing.
- **Debian 12, after the provider reinstalls the system:** the same run. Docker's apt key that Mathion writes is accepted (`apt-get update` shows no key error), and `systemctl is-enabled docker` says `enabled`.
- **DNS not pointing at the server yet:** point the domain elsewhere (or use a fresh name), run the install, answer no at `Turn on HTTPS anyway?`. The ending says HTTPS is off and why, and prints a `sudo mathion tls enable …` line. Fix DNS, run that line, then `sudo mathion pin <email>`: the site opens over HTTPS and the PIN signs you in.
- **Re-run the one-liner** on the installed server: it prints `Mathion is already set up here. Update with: sudo mathion self-update && sudo mathion update` and changes nothing in the deployment (it only replaces the `mathion` command).
- **`sudo mathion install` again** on the installed server: it prints `✓ Mathion is running at https://<domain>` and `Run sudo mathion pin <email> to get a sign-in PIN.`, and makes no new PIN.
- **`sudo mathion panel`:** sign in, then open the printed link in the same browser; the admin panel opens.

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
