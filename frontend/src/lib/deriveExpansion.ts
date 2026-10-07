// deriveExpansion takes URL-parsed block/sequence/item ids and the loaded
// admin-tree and returns the matched entities plus stale-id flags. The
// accordion uses this to rebuild its expansion state from the URL alone —
// no parallel component state. Precedence staleBid > staleSid > staleIid by
// design: when a parent is gone, the nested URL is moot. An item id must match
// an item of the EXPANDED sequence exactly (String(id) === iid), so "05" or
// "abc" is stale too (Slice-5b D19).

import type { AdminTree, AdminTreeBlock, AdminTreeItem, AdminTreeSequence } from './types';

export type Expansion = {
  expandedBlock: AdminTreeBlock | null;
  expandedSequence: AdminTreeSequence | null;
  expandedItem: AdminTreeItem | null;
  staleBid: boolean;
  staleSid: boolean;
  staleIid: boolean;
};

const NONE: Expansion = {
  expandedBlock: null, expandedSequence: null, expandedItem: null,
  staleBid: false, staleSid: false, staleIid: false,
};

export function deriveExpansion(
  bid: string | null,
  sid: string | null,
  tree: AdminTree | null,
  iid: string | null = null,
): Expansion {
  if (!tree || bid === null) return NONE;
  const expandedBlock = tree.blocks.find((b) => String(b.id) === bid) ?? null;
  if (!expandedBlock) return { ...NONE, staleBid: true };
  if (sid === null) return { ...NONE, expandedBlock };
  const expandedSequence = expandedBlock.sequences.find((s) => String(s.id) === sid) ?? null;
  if (!expandedSequence) return { ...NONE, expandedBlock, staleSid: true };
  if (iid === null) return { ...NONE, expandedBlock, expandedSequence };
  const expandedItem = expandedSequence.items.find((it) => String(it.id) === iid) ?? null;
  return { ...NONE, expandedBlock, expandedSequence, expandedItem, staleIid: expandedItem === null };
}
