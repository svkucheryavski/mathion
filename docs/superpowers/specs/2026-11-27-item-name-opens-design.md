# Item name opens the item editor — design

Status: approved by the owner 2026-11-27 (short design, small change).

## Why

In the course editor a block or sequence name is clickable (it opens or closes its section), but an
item opens only from its pencil. Authors click the item name and nothing happens.

## What changes

`frontend/src/components/editor/ItemRow.svelte`:

- Clicking the item name opens the item editor, exactly as the pencil does (`onOpen`), in every
  version state (a published version opens read-only, as from the pencil).
- Look: pointer cursor on the name, as on block and sequence names; nothing else changes.
- While the row is busy (a move or delete saving) a click on the name does nothing, as the disabled
  pencil; the cursor is the default one then.
- Keyboard and screen readers: the pencil stays the one way in. The name is not a button, not a Tab
  stop, and is still read as text ("Page: Intro").
- Closing the editor returns focus as today (the opener, else the item's pencil).
- Dragging across the name to select its text does not open the item (review minor, Opus + Fable).

## Approaches considered

1. **Name as a mouse shortcut (chosen):** one more click target, no extra Tab stops in long lists.
2. Name as a real button: a second Tab stop per item doing what the pencil next to it does. Rejected.
3. The whole row clickable: a bigger target, but the owner asked for the name. Rejected.
