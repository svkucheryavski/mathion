---
worth: yes
where: frontend/src/pages/NotFound.svelte
added: 2026-09-07
---
# the 404 page is unstyled

`NotFound.svelte` is a bare `<h1>Page not found</h1>` and a `Back` link, with no frame, no
card, and none of the refreshed page chrome. The user noticed it during the Slice-4 browser pass
("404 page looks unformatted").

It was never scheduled: the design handoff's 26-screen table
(`docs/design/visual-refresh/mathion-visual-spec.md`) has no 404 / not-found screen, so there is
no reference to restyle against. That makes it a design decision for the polish slice rather than
a defect in any slice.

Suggested shape, to be decided in the polish-slice spec: render it as the same page frame the
student pages use, with an `ErrorState`-style card (Slice-4 primitive,
`components/ui/ErrorState.svelte`) carrying the "Page not found" copy and a secondary
`Back` Button to `defaultLandingPath(session.user)`. That reuses two existing primitives and needs
no new tokens. Check both the signed-in and signed-out landing paths, and that the page is
reachable by typing a bad URL directly (App.svelte:74).

**User ruling 2026-09-07:** improvements "come later at the end" → polish slice.
