// Convert YouTube and Vimeo URLs to their iframe-embed form so the
// student-side <iframe> and the editor's live preview both load. Regular
// YouTube watch URLs (https://www.youtube.com/watch?v=…) refuse to load
// inside an iframe (X-Frame-Options DENY); the embed form
// (https://www.youtube.com/embed/…) is the supported path. Vimeo's plain
// URLs (vimeo.com/ID) need to become player.vimeo.com/video/ID.
//
// Also drops share-tracking params (?si=…, ?feature=share) and translates
// YouTube's ?t= start time into the embed-form ?start=N.
//
// Inputs that don't match a recognized provider pass through unchanged
// (after a trim) so users can still paste arbitrary embed URLs from other
// hosts. Empty / non-URL input also passes through. Validation of the
// resulting URL is done separately by safeIframeUrl before iframing.

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

export function normalizeVideoUrl(input: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return trimmed;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = u.hostname.toLowerCase();

  if (YT_HOSTS.has(host)) {
    // Already in embed form — respect the user's exact URL (could carry
    // params like ?start, ?rel=0, ?modestbranding=1 we shouldn't rewrite).
    if (u.pathname.startsWith('/embed/')) return trimmed;
    let videoId: string | null = null;
    if (u.pathname === '/watch') {
      videoId = u.searchParams.get('v');
    } else if (u.pathname.startsWith('/shorts/')) {
      videoId = u.pathname.slice('/shorts/'.length).split('/')[0] || null;
    }
    if (!videoId) return trimmed;
    return buildYouTubeEmbed(videoId, parseStartSeconds(u));
  }

  if (host === 'youtu.be') {
    const videoId = u.pathname.slice(1).split('/')[0];
    if (!videoId) return trimmed;
    return buildYouTubeEmbed(videoId, parseStartSeconds(u));
  }

  if (host === 'vimeo.com') {
    // vimeo.com/123456789 → embed; vimeo.com/channels/staffpicks → leave alone
    const seg = u.pathname.slice(1).split('/')[0];
    if (seg && /^\d+$/.test(seg)) {
      return `https://player.vimeo.com/video/${seg}`;
    }
    return trimmed;
  }

  // player.vimeo.com / unknown providers / other hosts — pass through.
  return trimmed;
}

function buildYouTubeEmbed(videoId: string, startSec: number | null): string {
  const out = new URL(`https://www.youtube.com/embed/${videoId}`);
  if (startSec !== null) out.searchParams.set('start', String(startSec));
  return out.toString();
}

function parseStartSeconds(u: URL): number | null {
  const t = u.searchParams.get('t');
  if (!t) return null;
  // YouTube accepts "?t=42" and "?t=42s"; we ignore "?t=1m30s" form for now
  // (uncommon in shared URLs and would require richer parsing).
  const m = t.match(/^(\d+)s?$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}
