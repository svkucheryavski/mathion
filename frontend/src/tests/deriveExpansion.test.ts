import { describe, it, expect } from 'vitest';
import { deriveExpansion } from '../lib/deriveExpansion';
import type { AdminTree } from '../lib/types';

function makeTree(): AdminTree {
  return {
    course: { id: 1, name: 'CS 101', slug: 'cs101' },
    version: {
      id: 10,
      course_id: 1,
      state: 'created',
      is_disabled: false,
      info_md: '',
      info_html: '',
      max_quiz_attempts: 3,
      label: '',
      created_at: '2026-05-01T00:00:00Z',
      published_at: null,
      archived_at: null,
      content_updated_at: '2026-05-01T00:00:00Z',
    },
    blocks: [
      {
        id: 100,
        version_id: 10,
        title: 'B1',
        slug: 'b1',
        order: 1,
        info: '',
        info_html: '',
        sequences: [
          { id: 1000, block_id: 100, title: 'S1', slug: 's1', order: 1, items: [] },
          { id: 1001, block_id: 100, title: 'S2', slug: 's2', order: 2, items: [] },
        ],
      },
      {
        id: 101,
        version_id: 10,
        title: 'B2',
        slug: 'b2',
        order: 2,
        info: '',
        info_html: '',
        sequences: [
          { id: 1002, block_id: 101, title: 'S3', slug: 's3', order: 1, items: [] },
        ],
      },
    ],
  };
}

describe('deriveExpansion', () => {
  it('returns null entities when bid and sid are null', () => {
    const r = deriveExpansion(null, null, makeTree());
    expect(r.expandedBlock).toBeNull();
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });

  it('returns block when bid matches', () => {
    const r = deriveExpansion('100', null, makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });

  it('returns block AND sequence when both match', () => {
    const r = deriveExpansion('100', '1001', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence?.id).toBe(1001);
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });

  it('flags staleBid when bid does not match any block', () => {
    const r = deriveExpansion('999', null, makeTree());
    expect(r.expandedBlock).toBeNull();
    expect(r.staleBid).toBe(true);
    expect(r.staleSid).toBe(false);
  });

  it('flags staleSid when bid matches but sid does not match inside that block', () => {
    const r = deriveExpansion('100', '9999', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(true);
  });

  it('flags staleSid when sid matches a sequence in a different block', () => {
    const r = deriveExpansion('100', '1002', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence).toBeNull();
    expect(r.staleSid).toBe(true);
  });

  it('flags only staleBid (not staleSid) when both ids miss — caller cascades', () => {
    const r = deriveExpansion('999', '1001', makeTree());
    expect(r.expandedBlock).toBeNull();
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(true);
    expect(r.staleSid).toBe(false);
  });

  it('compares by string equality against String(block.id)', () => {
    const r = deriveExpansion('100', '1000', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence?.id).toBe(1000);
  });

  it('handles null tree (load not yet complete) — both stale flags false, null entities', () => {
    const r = deriveExpansion('100', '1000', null);
    expect(r.expandedBlock).toBeNull();
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });
});

describe('deriveExpansion — the item level (Slice-5b D19)', () => {
  const item = (id: number, sequence_id: number) => ({
    id, sequence_id, title: `I${id}`, slug: `i${id}`, order: 1, type: 'static_page' as const,
    content_md: '', content_html: '', video_url: null, script_url: null, questions_count: 0,
  });
  function treeWithItems() {
    const t = makeTree();
    t.blocks[0].sequences[0].items = [item(5000, 1000)];
    t.blocks[0].sequences[1].items = [item(5001, 1001)];
    return t;
  }

  it('no item id: expandedItem null, not stale', () => {
    const e = deriveExpansion('100', '1000', treeWithItems());
    expect(e.expandedItem).toBeNull();
    expect(e.staleIid).toBe(false);
  });

  it('an item of the expanded sequence is expanded', () => {
    const e = deriveExpansion('100', '1000', treeWithItems(), '5000');
    expect(e.expandedItem?.id).toBe(5000);
    expect(e.staleIid).toBe(false);
  });

  it('an item that is missing, or belongs to another sequence, is stale', () => {
    expect(deriveExpansion('100', '1000', treeWithItems(), '9999').staleIid).toBe(true);
    const other = deriveExpansion('100', '1000', treeWithItems(), '5001');
    expect(other.staleIid).toBe(true);
    expect(other.expandedItem).toBeNull();
  });

  it('a non-canonical id ("abc", "05000") is stale; a stale sequence wins over the item', () => {
    expect(deriveExpansion('100', '1000', treeWithItems(), 'abc').staleIid).toBe(true);
    expect(deriveExpansion('100', '1000', treeWithItems(), '05000').staleIid).toBe(true);
    const e = deriveExpansion('100', '9999', treeWithItems(), '5000');
    expect(e.staleSid).toBe(true);
    expect(e.staleIid).toBe(false);
  });
});
