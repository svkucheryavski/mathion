import type { AdminTree, AdminTreeBlock, AdminTreeSequence } from './types';

export type Expansion = {
  expandedBlock: AdminTreeBlock | null;
  expandedSequence: AdminTreeSequence | null;
  staleBid: boolean;
  staleSid: boolean;
};

export function deriveExpansion(
  bid: string | null,
  sid: string | null,
  tree: AdminTree | null,
): Expansion {
  if (!tree) {
    return { expandedBlock: null, expandedSequence: null, staleBid: false, staleSid: false };
  }
  if (bid === null) {
    return { expandedBlock: null, expandedSequence: null, staleBid: false, staleSid: false };
  }
  const expandedBlock = tree.blocks.find((b) => String(b.id) === bid) ?? null;
  if (!expandedBlock) {
    return { expandedBlock: null, expandedSequence: null, staleBid: true, staleSid: false };
  }
  if (sid === null) {
    return { expandedBlock, expandedSequence: null, staleBid: false, staleSid: false };
  }
  const expandedSequence = expandedBlock.sequences.find((s) => String(s.id) === sid) ?? null;
  if (!expandedSequence) {
    return { expandedBlock, expandedSequence: null, staleBid: false, staleSid: true };
  }
  return { expandedBlock, expandedSequence, staleBid: false, staleSid: false };
}
