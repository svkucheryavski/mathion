// R13: a block's number is its 1-based position in the pinned version's block
// list (the API orders it by `order`, then id), never the stored `order`,
// which keeps gaps after a delete.
export function blockPositions(blocks: { id: number }[]): Map<number, number> {
  return new Map(blocks.map((b, i) => [b.id, i + 1]));
}
