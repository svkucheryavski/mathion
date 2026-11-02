import { describe, it, expect } from 'vitest';
import { normalizeVideoUrl } from '../lib/normalizeVideoUrl';

describe('normalizeVideoUrl', () => {
  describe('YouTube', () => {
    it('converts watch URL to embed', () => {
      expect(normalizeVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('converts youtu.be short URL to embed', () => {
      expect(normalizeVideoUrl('https://youtu.be/dQw4w9WgXcQ'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('converts /shorts/ URL to embed', () => {
      expect(normalizeVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('converts m.youtube.com watch URL', () => {
      expect(normalizeVideoUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('preserves embed URL unchanged', () => {
      expect(normalizeVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('preserves t parameter as start (watch URL)', () => {
      expect(normalizeVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?start=42');
    });

    it('preserves t parameter with s suffix', () => {
      expect(normalizeVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?start=42');
    });

    it('preserves t parameter on youtu.be', () => {
      expect(normalizeVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=42'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?start=42');
    });

    it('strips share-tracking params (si, feature, etc.)', () => {
      expect(normalizeVideoUrl('https://youtu.be/dQw4w9WgXcQ?si=abc123&feature=share'))
        .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('returns trimmed input for unrecognized YouTube paths (playlist, channel)', () => {
      expect(normalizeVideoUrl('https://www.youtube.com/playlist?list=PLABC'))
        .toBe('https://www.youtube.com/playlist?list=PLABC');
    });
  });

  describe('Vimeo', () => {
    it('converts vimeo.com/ID to player.vimeo.com/video/ID', () => {
      expect(normalizeVideoUrl('https://vimeo.com/123456789'))
        .toBe('https://player.vimeo.com/video/123456789');
    });

    it('preserves player.vimeo.com URL unchanged', () => {
      expect(normalizeVideoUrl('https://player.vimeo.com/video/123456789'))
        .toBe('https://player.vimeo.com/video/123456789');
    });

    it('leaves non-numeric vimeo paths alone (channels, categories)', () => {
      expect(normalizeVideoUrl('https://vimeo.com/channels/staffpicks'))
        .toBe('https://vimeo.com/channels/staffpicks');
    });
  });

  describe('passthrough', () => {
    it('returns non-YouTube/Vimeo URLs unchanged', () => {
      expect(normalizeVideoUrl('https://example.com/video'))
        .toBe('https://example.com/video');
    });

    it('returns empty string unchanged', () => {
      expect(normalizeVideoUrl('')).toBe('');
    });

    it('returns non-URL strings unchanged (trimmed)', () => {
      expect(normalizeVideoUrl('not a url')).toBe('not a url');
    });

    it('trims surrounding whitespace on passthrough', () => {
      expect(normalizeVideoUrl('  https://example.com/v  '))
        .toBe('https://example.com/v');
    });
  });

  // Polish 3 C18 (slice5b T3c, slice5c T4): the backend's check is case-sensitive.
  describe('scheme-less and upper-case input', () => {
    it('youtu.be/x and www.youtube.com/watch?v=x and player.vimeo.com/video/1 gain https://', () => {
      expect(normalizeVideoUrl('youtu.be/x')).toBe('https://www.youtube.com/embed/x');
      expect(normalizeVideoUrl('www.youtube.com/watch?v=x')).toBe('https://www.youtube.com/embed/x');
      expect(normalizeVideoUrl('player.vimeo.com/video/1')).toBe('https://player.vimeo.com/video/1');
      expect(normalizeVideoUrl('vimeo.com/123')).toBe('https://player.vimeo.com/video/123');
      expect(normalizeVideoUrl('www.youtube.com/embed/x?rel=0')).toBe('https://www.youtube.com/embed/x?rel=0');
      expect(normalizeVideoUrl('youtube.com/playlist?list=PL1')).toBe('https://youtube.com/playlist?list=PL1');
    });

    it('HTTPS://example.com/v.mp4 returns https://example.com/v.mp4 and leaves the rest as typed', () => {
      expect(normalizeVideoUrl('HTTPS://example.com/v.mp4')).toBe('https://example.com/v.mp4');
      expect(normalizeVideoUrl('Http://Example.com/V.MP4?A=B')).toBe('http://Example.com/V.MP4?A=B');
      expect(normalizeVideoUrl('HTTPS://player.vimeo.com/video/1')).toBe('https://player.vimeo.com/video/1');
      expect(normalizeVideoUrl('HTTPS://www.youtube.com/embed/AbC')).toBe('https://www.youtube.com/embed/AbC');
    });

    it('an unknown scheme-less host is returned as typed', () => {
      expect(normalizeVideoUrl('example.com/v.mp4')).toBe('example.com/v.mp4');
      expect(normalizeVideoUrl('  Example.com/V  ')).toBe('Example.com/V');
    });
  });
});
