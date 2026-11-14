# Slice 5a (authoring: Versions + version editor) — deferred Minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## T5b — accordion bodies

- **The closed-form create toast can lose part of a mixed 422.** With a field error and an unmapped entry
  together, `globalMessage` (the unmapped part) wins and the field message is dropped; a network failure
  reads `mapCreateError`'s generic "Save failed", odd wording for a create. Pre-existing mapper behaviour.
