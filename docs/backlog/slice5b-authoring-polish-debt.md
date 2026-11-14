# Slice 5b (authoring: item editor modal) — deferred Minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## T6 — Quiz look (3f)

- **(Round 2) The resync-failure toast is `'error'`.** It stacks a second red toast under the operation's own error. The modal's equivalent secondary notice is `'info'`. Fix: `'info'`.
