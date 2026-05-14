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
