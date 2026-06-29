// Validate a user-entered URL before passing it to an <iframe src>. Rejects
// empty/null, non-http(s) schemes (javascript:, data:, ftp:, file:), and
// malformed URLs the URL constructor refuses. Used directly by the video-item
// editor preview / readonly preview, and (via lib/safeAppUrl) by the
// interactive-app player, editor preview, and readonly preview.
//
// Returns the canonicalized URL string when accepted, or null when rejected.
// Caller renders a preview only when the result is non-null.
export function safeIframeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Empty hostname (e.g. "https://") parses on some engines but is useless
    // as an iframe src and almost always means a partial keystroke.
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}
